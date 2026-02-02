// Worker code as a string - will be bundled with the library
export const workerCode = `
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/'
const PERSIST_PREFIX = '/sandbox'
const DB_NAME = 'sandpy-storage'
const STORE_NAME = 'files'

let pyodide = null
let storage = null

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
      console.log('[sandpy] Using OPFS storage')
      return new OPFSStorage(sandpyDir)
    } catch (e) {
      console.warn('[sandpy] OPFS not available:', e.message)
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
      const fullPath = basePath ? basePath + '/' + name : name
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
        console.log('[sandpy] Using IndexedDB storage')
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
          reject(new Error('File not found: ' + path))
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
  storage = await OPFSStorage.create()
  if (!storage) {
    storage = await IndexedDBStorage.create()
  }
}

async function initPyodide(preload = []) {
  console.log('[sandpy] Loading Pyodide...')
  const t0 = performance.now()
  importScripts(PYODIDE_CDN + 'pyodide.js')
  pyodide = await loadPyodide({ indexURL: PYODIDE_CDN })
  await pyodide.loadPackage('micropip')

  // Preload requested packages
  if (preload.length > 0) {
    console.log('[sandpy] Preloading: ' + preload.join(', '))
    await pyodide.loadPackage(preload)
  }

  await initStorage()
  try { pyodide.FS.mkdir(PERSIST_PREFIX) } catch (e) {}
  await restorePersistedFiles()
  console.log('[sandpy] Ready in ' + ((performance.now() - t0) / 1000).toFixed(2) + 's')
}

async function restorePersistedFiles() {
  if (!storage) return
  try {
    const files = await storage.list()
    for (const path of files) {
      try {
        const content = await storage.read(path)
        const fullPath = PERSIST_PREFIX + '/' + path
        const parts = fullPath.split('/').filter(Boolean)
        let currentPath = ''
        for (let i = 0; i < parts.length - 1; i++) {
          currentPath += '/' + parts[i]
          try { pyodide.FS.mkdir(currentPath) } catch (e) {}
        }
        pyodide.FS.writeFile(fullPath, content)
      } catch (e) {}
    }
  } catch (e) {}
}

async function runPython(code) {
  if (!pyodide) throw new Error('Pyodide not initialized')
  let output = ''
  pyodide.setStdout({ batched: (text) => { output += text + '\\n' } })
  pyodide.setStderr({ batched: (text) => { output += text + '\\n' } })
  try {
    const result = await pyodide.runPythonAsync(code)
    if (result !== undefined && result !== null && output === '') {
      output = String(result)
    }
    return { output: output.trimEnd() }
  } catch (err) {
    return { output: output.trimEnd(), error: err instanceof Error ? err.message : String(err) }
  }
}

async function writeFile(path, content) {
  if (!pyodide) throw new Error('Pyodide not initialized')
  const parts = path.split('/').filter(Boolean)
  let currentPath = ''
  for (let i = 0; i < parts.length - 1; i++) {
    currentPath += '/' + parts[i]
    try { pyodide.FS.mkdir(currentPath) } catch (e) {}
  }
  pyodide.FS.writeFile(path, content)
  if (path.startsWith(PERSIST_PREFIX + '/') && storage) {
    const storagePath = path.slice(PERSIST_PREFIX.length + 1)
    await storage.write(storagePath, content)
  }
}

function readFile(path) {
  if (!pyodide) throw new Error('Pyodide not initialized')
  return pyodide.FS.readFile(path, { encoding: 'utf8' })
}

async function deleteFile(path) {
  if (!pyodide) throw new Error('Pyodide not initialized')
  pyodide.FS.unlink(path)
  if (path.startsWith(PERSIST_PREFIX + '/') && storage) {
    const storagePath = path.slice(PERSIST_PREFIX.length + 1)
    try { await storage.delete(storagePath) } catch (e) {}
  }
}

function listFiles(dirPath = PERSIST_PREFIX) {
  if (!pyodide) throw new Error('Pyodide not initialized')
  const files = []

  function listDir(path) {
    try {
      const entries = pyodide.FS.readdir(path)
      for (const entry of entries) {
        if (entry === '.' || entry === '..') continue
        const fullPath = path + '/' + entry
        try {
          const stat = pyodide.FS.stat(fullPath)
          if (pyodide.FS.isDir(stat.mode)) {
            listDir(fullPath)
          } else {
            files.push(fullPath)
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  listDir(dirPath)
  return files
}

async function installPackages(packages) {
  if (!pyodide) throw new Error('Pyodide not initialized')
  const micropip = pyodide.pyimport('micropip')
  for (const pkg of packages) {
    await micropip.install(pkg)
  }
}

self.onmessage = async (event) => {
  const { id, type, code, path, content, packages, preload } = event.data
  let response
  try {
    switch (type) {
      case 'init':
        await initPyodide(preload || [])
        response = { id, success: true }
        break
      case 'run':
        if (!code) {
          response = { id, success: false, error: 'No code provided' }
        } else {
          const result = await runPython(code)
          response = { id, success: !result.error, output: result.output, error: result.error }
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
          response = { id, success: true, content: readFile(path) }
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
      case 'listFiles':
        response = { id, success: true, files: listFiles(path || PERSIST_PREFIX) }
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
        response = { id, success: false, error: 'Unknown message type: ' + type }
    }
  } catch (err) {
    response = { id, success: false, error: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage(response)
}
`
