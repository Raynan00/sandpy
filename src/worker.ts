import type { WorkerRequest, WorkerResponse } from './types'

declare const loadPyodide: any

let pyodide: any = null

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/'

async function initPyodide(): Promise<void> {
  // Load Pyodide from CDN
  importScripts(`${PYODIDE_CDN}pyodide.js`)
  pyodide = await loadPyodide({
    indexURL: PYODIDE_CDN
  })
}

async function runPython(code: string): Promise<{ output: string; error?: string }> {
  if (!pyodide) {
    throw new Error('Pyodide not initialized')
  }

  let output = ''

  // Capture stdout
  pyodide.setStdout({
    batched: (text: string) => {
      output += text + '\n'
    }
  })

  // Capture stderr
  pyodide.setStderr({
    batched: (text: string) => {
      output += text + '\n'
    }
  })

  try {
    const result = await pyodide.runPythonAsync(code)
    // If there's a return value and no printed output, include it
    if (result !== undefined && result !== null && output === '') {
      output = String(result)
    }
    return { output: output.trimEnd() }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { output: output.trimEnd(), error }
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, code } = event.data
  let response: WorkerResponse

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
