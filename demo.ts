import { Sandpy } from './src/index'

let sandbox: Sandpy | null = null

// Expose to window for console testing
declare global {
  interface Window {
    sandbox: Sandpy | null
  }
}
const $ = (id: string) => document.getElementById(id) as HTMLElement

const elements = {
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  code: $('code') as HTMLTextAreaElement,
  output: $('output'),
  runBtn: $('runBtn') as HTMLButtonElement,
  clearBtn: $('clearBtn') as HTMLButtonElement,
  writeFileBtn: $('writeFileBtn') as HTMLButtonElement,
  listFilesBtn: $('listFilesBtn') as HTMLButtonElement,
  installBtn: $('installBtn') as HTMLButtonElement,
  numpyBtn: $('numpyBtn') as HTMLButtonElement,
  persistBtn: $('persistBtn') as HTMLButtonElement,
  cowsayBtn: $('cowsayBtn') as HTMLButtonElement,
  plotBtn: $('plotBtn') as HTMLButtonElement,
  refreshFilesBtn: $('refreshFilesBtn') as HTMLButtonElement,
  filesList: $('filesList')
}

interface Artifact {
  type: string
  content: string
  alt?: string
}

function setOutput(text: string, isError = false, artifacts: Artifact[] = []) {
  elements.output.innerHTML = ''
  elements.output.className = 'output' + (isError ? ' error' : '')

  if (text) {
    const textNode = document.createTextNode(text)
    elements.output.appendChild(textNode)
  } else if (artifacts.length === 0) {
    elements.output.textContent = '(no output)'
  }

  for (const artifact of artifacts) {
    if (artifact.type === 'image/png' || artifact.type === 'image/jpeg') {
      const img = document.createElement('img')
      img.src = `data:${artifact.type};base64,${artifact.content}`
      img.className = 'artifact-image'
      img.alt = artifact.alt || 'Generated image'
      elements.output.appendChild(img)

      if (artifact.alt) {
        const label = document.createElement('div')
        label.className = 'artifact-label'
        label.textContent = artifact.alt
        elements.output.appendChild(label)
      }
    }
  }
}

function setStatus(text: string, ready = false) {
  elements.statusText.textContent = text
  elements.statusDot.className = 'status-dot' + (ready ? ' ready' : '')
}

function enableButtons(enabled = true) {
  const btns = [
    elements.runBtn, elements.writeFileBtn, elements.listFilesBtn,
    elements.installBtn, elements.numpyBtn, elements.persistBtn,
    elements.cowsayBtn, elements.plotBtn, elements.refreshFilesBtn
  ]
  btns.forEach(btn => btn.disabled = !enabled)
}

async function refreshFiles() {
  if (!sandbox) return
  try {
    const files = await sandbox.listFiles('/sandbox')
    if (files.length === 0) {
      elements.filesList.innerHTML = '<div class="output-placeholder">No files yet</div>'
    } else {
      elements.filesList.innerHTML = files.map(f => `
        <div class="file-item">
          <span>${f}</span>
          <button onclick="window.deleteFile('${f}')" title="Delete">🗑️</button>
        </div>
      `).join('')
    }
  } catch {
    elements.filesList.innerHTML = '<div class="output-placeholder">Error loading files</div>'
  }
}

(window as any).deleteFile = async (path: string) => {
  if (!sandbox) return
  enableButtons(false)
  try {
    await sandbox.deleteFile(path)
    setOutput(`Deleted: ${path}`)
    await refreshFiles()
  } catch (e: any) {
    setOutput(e.message, true)
  }
  enableButtons(true)
}

async function init() {
  const t0 = performance.now()
  sandbox = await Sandpy.create()
  window.sandbox = sandbox  // Expose for console testing
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
  setStatus(`Ready in ${elapsed}s`, true)
  enableButtons(true)
  await refreshFiles()
}

// Run code
elements.runBtn.onclick = async () => {
  if (!sandbox) return
  enableButtons(false)
  setOutput('Running...')
  const result = await sandbox.run(elements.code.value)
  if (!result.success && result.error) {
    setOutput(result.error, true)
  } else {
    setOutput(result.stdout, false, result.artifacts as Artifact[])
  }
  enableButtons(true)
}

// Clear output
elements.clearBtn.onclick = () => {
  elements.output.innerHTML = '<span class="output-placeholder">Run some code to see output...</span>'
  elements.output.className = 'output'
}

// Write file
elements.writeFileBtn.onclick = async () => {
  if (!sandbox) return
  enableButtons(false)
  const csv = 'name,score\nalice,95\nbob,87\ncharlie,92'
  await sandbox.writeFile('/sandbox/data.csv', csv)
  setOutput('Wrote /sandbox/data.csv:\n\n' + csv)
  await refreshFiles()
  enableButtons(true)
}

// List files
elements.listFilesBtn.onclick = async () => {
  if (!sandbox) return
  enableButtons(false)
  const files = await sandbox.listFiles('/sandbox')
  setOutput(files.length ? 'Files in /sandbox:\n\n' + files.join('\n') : 'No files in /sandbox')
  enableButtons(true)
}

// Install package
elements.installBtn.onclick = async () => {
  if (!sandbox) return
  enableButtons(false)
  setOutput('Installing cowsay...')
  const result = await sandbox.install('cowsay')
  setOutput(result.success ? 'Installed cowsay!' : result.error || 'Install failed', !result.success)
  enableButtons(true)
}

// NumPy demo
elements.numpyBtn.onclick = async () => {
  if (!sandbox) return
  enableButtons(false)
  setOutput('Loading NumPy (first time takes a moment)...')
  await sandbox.install('numpy')

  const result = await sandbox.run(`
import numpy as np

arr = np.array([1, 2, 3, 4, 5])
print(f"Array: {arr}")
print(f"Mean: {np.mean(arr)}")
print(f"Std: {np.std(arr):.2f}")
print(f"Sum: {np.sum(arr)}")

# Matrix operations
matrix = np.array([[1, 2], [3, 4]])
print(f"\\nMatrix:\\n{matrix}")
print(f"Transpose:\\n{matrix.T}")
print(f"Determinant: {np.linalg.det(matrix):.0f}")
`)
  setOutput(result.success ? result.stdout : result.error || 'Error', !result.success)
  enableButtons(true)
}

// Persistence demo
elements.persistBtn.onclick = async () => {
  if (!sandbox) return
  enableButtons(false)
  await sandbox.writeFile('/sandbox/persist-test.txt', 'This file survives page reload!')
  setOutput('Wrote /sandbox/persist-test.txt\n\nRefresh the page and check Files panel - it will still be there!')
  await refreshFiles()
  enableButtons(true)
}

// Cowsay demo
elements.cowsayBtn.onclick = async () => {
  if (!sandbox) return
  enableButtons(false)
  setOutput('Installing cowsay...')
  await sandbox.install('cowsay')

  const result = await sandbox.run(`
import cowsay
cowsay.cow('Sandpy is awesome!')
`)
  setOutput(result.success ? result.stdout : result.error || 'Error', !result.success)
  enableButtons(true)
}

// Matplotlib demo
elements.plotBtn.onclick = async () => {
  if (!sandbox) return
  enableButtons(false)
  setOutput('Installing matplotlib (first time takes a moment)...')
  await sandbox.install('matplotlib')

  const result = await sandbox.run(`
import matplotlib.pyplot as plt
import numpy as np

# Create sample data
x = np.linspace(0, 10, 100)
y1 = np.sin(x)
y2 = np.cos(x)

# Create the plot
plt.figure(figsize=(8, 5))
plt.plot(x, y1, label='sin(x)', linewidth=2)
plt.plot(x, y2, label='cos(x)', linewidth=2)
plt.title('Sine and Cosine Waves')
plt.xlabel('x')
plt.ylabel('y')
plt.legend()
plt.grid(True, alpha=0.3)
plt.show()
`)
  if (!result.success) {
    setOutput(result.error || 'Error', true)
  } else {
    setOutput(result.stdout, false, result.artifacts as Artifact[])
  }
  enableButtons(true)
}

// Refresh files
elements.refreshFilesBtn.onclick = refreshFiles

// Keyboard shortcut
elements.code.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    elements.runBtn.click()
  }
})

init().catch(err => {
  setStatus('Failed to initialize', false)
  setOutput(err.message, true)
})
