// Worker code as a string - will be bundled with the library
export const workerCode = `
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/'
const PERSIST_PREFIX = '/sandbox'
const DB_NAME = 'sandpy-storage'
const STORE_NAME = 'files'
const ARTIFACT_MARKER = '__SANDPY_ARTIFACT__:'

let pyodide = null
let storage = null
let installedPackages = []  // Track installed packages for snapshots

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

// Matplotlib monkey-patch to capture plots as base64 images
const MATPLOTLIB_PATCH = \`
import sys

def _sandpy_setup_matplotlib():
    try:
        import matplotlib
        matplotlib.use('Agg')  # Non-interactive backend
        import matplotlib.pyplot as plt
        import io
        import base64

        _original_show = plt.show
        _original_savefig = plt.savefig

        def _sandpy_show(*args, **kwargs):
            buf = io.BytesIO()
            plt.savefig(buf, format='png', bbox_inches='tight', dpi=100)
            buf.seek(0)
            img_b64 = base64.b64encode(buf.read()).decode('utf-8')
            # Get figure title or generate description
            fig = plt.gcf()
            title = fig._suptitle.get_text() if fig._suptitle else ''
            if not title:
                axes = fig.get_axes()
                if axes and axes[0].get_title():
                    title = axes[0].get_title()
            alt = title if title else 'matplotlib plot'
            print(f'__SANDPY_ARTIFACT__:image/png:{alt}:{img_b64}')
            plt.clf()
            plt.close('all')

        plt.show = _sandpy_show
        return True
    except ImportError:
        return False

_sandpy_setup_matplotlib()
\`

// Snapshot code using dill
const SNAPSHOT_CODE = \`
import dill
import base64
import sys

def _sandpy_create_snapshot():
    # Get user-defined globals (exclude builtins and modules)
    user_globals = {}
    for name, value in globals().items():
        if name.startswith('_'):
            continue
        if isinstance(value, type(sys)):  # Skip modules
            continue
        try:
            # Test if it can be pickled
            dill.dumps(value)
            user_globals[name] = value
        except:
            pass
    return base64.b64encode(dill.dumps(user_globals)).decode('utf-8')

def _sandpy_restore_snapshot(state_b64):
    state = dill.loads(base64.b64decode(state_b64))
    globals().update(state)
    return True
\`

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
    installedPackages.push(...preload)
  }

  await initStorage()
  try { pyodide.FS.mkdir(PERSIST_PREFIX) } catch (e) {}
  await restorePersistedFiles()

  // Setup matplotlib patch (will silently fail if matplotlib not installed)
  try {
    await pyodide.runPythonAsync(MATPLOTLIB_PATCH)
  } catch (e) {
    // matplotlib not available yet, that's fine
  }

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

function parseArtifacts(output) {
  const artifacts = []
  const lines = output.split('\\n')
  const cleanLines = []

  for (const line of lines) {
    if (line.startsWith(ARTIFACT_MARKER)) {
      // Parse: __SANDPY_ARTIFACT__:type:alt:content
      const rest = line.slice(ARTIFACT_MARKER.length)
      const firstColon = rest.indexOf(':')
      const secondColon = rest.indexOf(':', firstColon + 1)

      if (firstColon > 0 && secondColon > 0) {
        const type = rest.slice(0, firstColon)
        const alt = rest.slice(firstColon + 1, secondColon)
        const content = rest.slice(secondColon + 1)
        artifacts.push({ type, alt, content })
      }
    } else {
      cleanLines.push(line)
    }
  }

  return { cleanOutput: cleanLines.join('\\n'), artifacts }
}

async function runPython(code, messageId, streaming = false) {
  if (!pyodide) throw new Error('Pyodide not initialized')

  let stdout = ''
  let stderr = ''

  // Setup stdout handler - stream if requested
  pyodide.setStdout({
    batched: (text) => {
      stdout += text + '\\n'
      if (streaming && !text.startsWith(ARTIFACT_MARKER)) {
        // Send streaming chunk
        self.postMessage({
          id: messageId,
          streaming: true,
          stdout: text
        })
      }
    }
  })
  pyodide.setStderr({ batched: (text) => { stderr += text + '\\n' } })

  try {
    // Re-apply matplotlib patch in case it was just installed
    try {
      await pyodide.runPythonAsync(MATPLOTLIB_PATCH)
    } catch (e) {}

    const result = await pyodide.runPythonAsync(code)

    // Parse artifacts from stdout
    const { cleanOutput, artifacts } = parseArtifacts(stdout.trimEnd())

    // Try to serialize the result
    let serializedResult = undefined
    if (result !== undefined && result !== null) {
      try {
        // Try to convert to JS and then JSON
        const jsResult = result.toJs ? result.toJs({ dict_converter: Object.fromEntries }) : result
        serializedResult = JSON.parse(JSON.stringify(jsResult))
      } catch (e) {
        // If serialization fails, convert to string
        serializedResult = String(result)
      }
    }

    return {
      stdout: cleanOutput,
      stderr: stderr.trimEnd(),
      result: serializedResult,
      artifacts,
      // Legacy field for backwards compat
      output: cleanOutput
    }
  } catch (err) {
    const { cleanOutput, artifacts } = parseArtifacts(stdout.trimEnd())
    return {
      stdout: cleanOutput,
      stderr: stderr.trimEnd(),
      result: undefined,
      artifacts,
      output: cleanOutput,
      error: err instanceof Error ? err.message : String(err)
    }
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

  // Auto-install dependencies for common packages
  const expanded = []
  for (const pkg of packages) {
    // matplotlib requires pillow for image handling
    if (pkg === 'matplotlib') {
      expanded.push('pillow')
    }
    expanded.push(pkg)
  }

  for (const pkg of expanded) {
    await micropip.install(pkg)
    if (!installedPackages.includes(pkg)) {
      installedPackages.push(pkg)
    }
  }
  // Re-apply matplotlib patch after installing packages
  try {
    await pyodide.runPythonAsync(MATPLOTLIB_PATCH)
  } catch (e) {}
}

async function createSnapshot() {
  if (!pyodide) throw new Error('Pyodide not initialized')

  // Install dill if not already installed
  if (!installedPackages.includes('dill')) {
    const micropip = pyodide.pyimport('micropip')
    await micropip.install('dill')
    installedPackages.push('dill')
  }

  // Run snapshot code
  await pyodide.runPythonAsync(SNAPSHOT_CODE)
  const state = await pyodide.runPythonAsync('_sandpy_create_snapshot()')

  return {
    state: state,
    packages: [...installedPackages]
  }
}

async function restoreSnapshot(state, packages) {
  if (!pyodide) throw new Error('Pyodide not initialized')

  // Reinstall packages
  if (packages && packages.length > 0) {
    await installPackages(packages)
  }

  // Install dill if needed
  if (!installedPackages.includes('dill')) {
    const micropip = pyodide.pyimport('micropip')
    await micropip.install('dill')
    installedPackages.push('dill')
  }

  // Restore state
  await pyodide.runPythonAsync(SNAPSHOT_CODE)
  await pyodide.runPythonAsync(\`_sandpy_restore_snapshot('\${state}')\`)

  return true
}

self.onmessage = async (event) => {
  const { id, type, code, path, content, packages, preload, snapshot, streaming } = event.data
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
          const result = await runPython(code, id, streaming)
          response = {
            id,
            success: !result.error,
            stdout: result.stdout,
            stderr: result.stderr,
            result: result.result,
            artifacts: result.artifacts,
            output: result.output,  // Legacy
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
      case 'snapshot':
        const snap = await createSnapshot()
        response = { id, success: true, snapshot: snap.state, packages: snap.packages }
        break
      case 'restore':
        if (!snapshot) {
          response = { id, success: false, error: 'Snapshot data required' }
        } else {
          await restoreSnapshot(snapshot, packages)
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
