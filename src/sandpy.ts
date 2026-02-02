import type { RunResult, InstallResult, CreateOptions, WorkerRequest, WorkerResponse } from './types'
import { workerCode } from './worker-code'

export class Sandpy {
  private worker: Worker
  private messageId = 0
  private pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>()

  private constructor(worker: Worker) {
    this.worker = worker
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id } = event.data
      const handler = this.pending.get(id)
      if (handler) {
        this.pending.delete(id)
        handler.resolve(event.data)
      }
    }
    this.worker.onerror = (error) => {
      console.error('Worker error:', error)
    }
  }

  private sendMessage(request: Omit<WorkerRequest, 'id'>): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...request, id })
    })
  }

  /**
   * Create a new Sandpy instance with Python runtime
   * @param options.preload - Packages to preload (e.g., ['pandas', 'numpy'])
   */
  static async create(options: CreateOptions = {}): Promise<Sandpy> {
    const blob = new Blob([workerCode], { type: 'application/javascript' })
    const workerUrl = URL.createObjectURL(blob)
    const worker = new Worker(workerUrl)
    const instance = new Sandpy(worker)

    const response = await instance.sendMessage({
      type: 'init',
      preload: options.preload
    })
    if (!response.success) {
      throw new Error(response.error || 'Failed to initialize Pyodide')
    }

    return instance
  }

  /** Execute Python code and return the result */
  async run(code: string): Promise<RunResult> {
    const response = await this.sendMessage({ type: 'run', code })
    return {
      success: response.success,
      output: response.output || '',
      error: response.error
    }
  }

  /** Write a file (files in /sandbox/ are persisted) */
  async writeFile(path: string, content: string): Promise<void> {
    const response = await this.sendMessage({ type: 'writeFile', path, content })
    if (!response.success) {
      throw new Error(response.error || 'Failed to write file')
    }
  }

  /** Read a file */
  async readFile(path: string): Promise<string> {
    const response = await this.sendMessage({ type: 'readFile', path })
    if (!response.success) {
      throw new Error(response.error || 'Failed to read file')
    }
    return response.content || ''
  }

  /** Delete a file */
  async deleteFile(path: string): Promise<void> {
    const response = await this.sendMessage({ type: 'deleteFile', path })
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete file')
    }
  }

  /** List files in a directory (defaults to /sandbox/) */
  async listFiles(path: string = '/sandbox'): Promise<string[]> {
    const response = await this.sendMessage({ type: 'listFiles', path })
    if (!response.success) {
      throw new Error(response.error || 'Failed to list files')
    }
    return response.files || []
  }

  /** Install packages from PyPI via micropip */
  async install(packages: string | string[]): Promise<InstallResult> {
    const pkgArray = Array.isArray(packages) ? packages : [packages]
    const response = await this.sendMessage({ type: 'install', packages: pkgArray })
    return {
      success: response.success,
      error: response.error
    }
  }

  /** Destroy the sandbox and terminate the worker */
  async destroy(): Promise<void> {
    await this.sendMessage({ type: 'destroy' })
    this.worker.terminate()
  }
}
