const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/'
const PERSIST_PREFIX = '/sandbox'  // Files under this path are persisted
const DB_NAME = 'sandpy-storage'
const STORE_NAME = 'files'

let pyodide = null
let storage = null

// ============ Storage Abstraction ============

class OPFSStorage {
  constructor(root) {
    this.root = root
  }

  static async create() {
    if (!navigator.storage?.getDirectory) {
      return null
    }
    try {
      const root = await navigator.storage.getDirectory()
      const sandpyDir = await root.getDirectoryHandle('sandpy', { create: true })
      console.log('[worker] Using OPFS storage')
      return new OPFSStorage(sandpyDir)
    } catch (e) {
      console.warn('[worker] OPFS not available:', e.message)
      return null
    }
  }

  async write(path, content) {
    const parts = path.split('/').filter(Boolean)
    const fileName = parts.pop()

    let dir = this.root
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true })
    }

    const fileHandle = await dir.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(content)
    await writable.close()
  }

  async read(path) {
    const parts = path.split('/').filter(Boolean)
    const fileName = parts.pop()

    let dir = this.root
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part)
    }

    const fileHandle = await dir.getFileHandle(fileName)
    const file = await fileHandle.getFile()
    return await file.text()
  }

  async delete(path) {
    const parts = path.split('/').filter(Boolean)
    const fileName = parts.pop()

    let dir = this.root
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part)
    }

    await dir.removeEntry(fileName)
  }

  async list(dirPath = '') {
    const parts = dirPath.split('/').filter(Boolean)
    const files = []

    let dir = this.root
    try {
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part)
      }
    } catch {
      return files
    }

    await this._listRecursive(dir, dirPath, files)
    return files
  }

  async _listRecursive(dir, basePath, files) {
    for await (const [name, handle] of dir) {
      const fullPath = basePath ? `${basePath}/${name}` : name
      if (handle.kind === 'file') {
        files.push(fullPath)
      } else {
        await this._listRecursive(handle, fullPath, files)
      }
    }
  }
}

class IndexedDBStorage {
  constructor(db) {
    this.db = db
  }

  static async create() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)

      request.onerror = () => reject(request.error)

      request.onupgradeneeded = (event) => {
        const db = event.target.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }

      request.onsuccess = () => {
        console.log('[worker] Using IndexedDB storage')
        resolve(new IndexedDBStorage(request.result))
      }
    })
  }

  async write(path, content) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.put(content, path)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async read(path) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(path)
      request.onsuccess = () => {
        if (request.result === undefined) {
          reject(new Error(`File not found: ${path}`))
        } else {
          resolve(request.result)
        }
      }
      request.onerror = () => reject(request.error)
    })
  }

  async delete(path) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.delete(path)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async list() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.getAllKeys()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
}

async function initStorage() {
  // Try OPFS first, fall back to IndexedDB
  storage = await OPFSStorage.create()
  if (!storage) {
    storage = await IndexedDBStorage.create()
  }
}

// ============ Pyodide Functions ============

async function initPyodide() {
  console.log('[worker] Loading pyodide.js from CDN...')
  const t0 = performance.now()

  importScripts(`${PYODIDE_CDN}pyodide.js`)
  console.log(`[worker] pyodide.js loaded in ${((performance.now() - t0) / 1000).toFixed(2)}s`)

  console.log('[worker] Initializing Pyodide runtime...')
  const t1 = performance.now()

  pyodide = await loadPyodide({
    indexURL: PYODIDE_CDN
  })

  // Load micropip for package installation
  await pyodide.loadPackage('micropip')

  // Initialize storage
  await initStorage()

  // Create persist directory and restore files
  try {
    pyodide.FS.mkdir(PERSIST_PREFIX)
  } catch (e) {
    // Directory may already exist
  }

  await restorePersistedFiles()

  console.log(`[worker] Pyodide ready in ${((performance.now() - t1) / 1000).toFixed(2)}s`)
  console.log(`[worker] Total init time: ${((performance.now() - t0) / 1000).toFixed(2)}s`)
}

async function restorePersistedFiles() {
  if (!storage) return

  try {
    const files = await storage.list()
    console.log(`[worker] Restoring ${files.length} persisted files`)

    for (const path of files) {
      try {
        const content = await storage.read(path)
        const fullPath = PERSIST_PREFIX + '/' + path

        // Ensure parent directories exist
        const parts = fullPath.split('/').filter(Boolean)
        let currentPath = ''
        for (let i = 0; i < parts.length - 1; i++) {
          currentPath += '/' + parts[i]
          try {
            pyodide.FS.mkdir(currentPath)
          } catch (e) {
            // Directory may already exist
          }
        }

        pyodide.FS.writeFile(fullPath, content)
        console.log(`[worker] Restored: ${fullPath}`)
      } catch (e) {
        console.warn(`[worker] Failed to restore ${path}:`, e.message)
      }
    }
  } catch (e) {
    console.warn('[worker] Failed to restore files:', e.message)
  }
}

async function runPython(code) {
  if (!pyodide) {
    throw new Error('Pyodide not initialized')
  }

  let output = ''

  pyodide.setStdout({
    batched: (text) => {
      output += text + '\n'
    }
  })

  pyodide.setStderr({
    batched: (text) => {
      output += text + '\n'
    }
  })

  try {
    const result = await pyodide.runPythonAsync(code)
    if (result !== undefined && result !== null && output === '') {
      output = String(result)
    }
    return { output: output.trimEnd() }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { output: output.trimEnd(), error }
  }
}

async function writeFile(path, content) {
  if (!pyodide) {
    throw new Error('Pyodide not initialized')
  }

  // Ensure parent directories exist in Pyodide FS
  const parts = path.split('/').filter(Boolean)
  let currentPath = ''
  for (let i = 0; i < parts.length - 1; i++) {
    currentPath += '/' + parts[i]
    try {
      pyodide.FS.mkdir(currentPath)
    } catch (e) {
      // Directory may already exist
    }
  }

  pyodide.FS.writeFile(path, content)

  // Persist if under PERSIST_PREFIX
  if (path.startsWith(PERSIST_PREFIX + '/') && storage) {
    const storagePath = path.slice(PERSIST_PREFIX.length + 1)
    await storage.write(storagePath, content)
    console.log(`[worker] Persisted: ${path}`)
  }
}

function readFile(path) {
  if (!pyodide) {
    throw new Error('Pyodide not initialized')
  }

  return pyodide.FS.readFile(path, { encoding: 'utf8' })
}

async function deleteFile(path) {
  if (!pyodide) {
    throw new Error('Pyodide not initialized')
  }

  pyodide.FS.unlink(path)

  // Remove from persistent storage if under PERSIST_PREFIX
  if (path.startsWith(PERSIST_PREFIX + '/') && storage) {
    const storagePath = path.slice(PERSIST_PREFIX.length + 1)
    try {
      await storage.delete(storagePath)
      console.log(`[worker] Deleted from storage: ${path}`)
    } catch (e) {
      // File may not exist in storage
    }
  }
}

async function installPackages(packages) {
  if (!pyodide) {
    throw new Error('Pyodide not initialized')
  }

  const micropip = pyodide.pyimport('micropip')
  for (const pkg of packages) {
    console.log(`[worker] Installing ${pkg}...`)
    await micropip.install(pkg)
    console.log(`[worker] Installed ${pkg}`)
  }
}

// ============ Message Handler ============

self.onmessage = async (event) => {
  const { id, type, code, path, content, packages } = event.data
  let response

  try {
    switch (type) {
      case 'init':
        await initPyodide()
        response = { id, success: true }
        break

      case 'run':
        if (!code) {
          response = { id, success: false, error: 'No code provided' }
        } else {
          const result = await runPython(code)
          response = {
            id,
            success: !result.error,
            output: result.output,
            error: result.error
          }
        }
        break

      case 'writeFile':
        if (!path || content === undefined) {
          response = { id, success: false, error: 'Path and content required' }
        } else {
          await writeFile(path, content)
          response = { id, success: true }
        }
        break

      case 'readFile':
        if (!path) {
          response = { id, success: false, error: 'Path required' }
        } else {
          const fileContent = readFile(path)
          response = { id, success: true, content: fileContent }
        }
        break

      case 'deleteFile':
        if (!path) {
          response = { id, success: false, error: 'Path required' }
        } else {
          await deleteFile(path)
          response = { id, success: true }
        }
        break

      case 'install':
        if (!packages || packages.length === 0) {
          response = { id, success: false, error: 'Packages array required' }
        } else {
          await installPackages(packages)
          response = { id, success: true }
        }
        break

      case 'destroy':
        pyodide = null
        response = { id, success: true }
        break

      default:
        response = { id, success: false, error: `Unknown message type: ${type}` }
    }
  } catch (err) {
    response = {
      id,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }

  self.postMessage(response)
}
