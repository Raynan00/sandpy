import type { RunResult, RunOptions, InstallResult, CreateOptions, WorkerRequest, WorkerResponse, Artifact, Snapshot } from './types'
import { workerCode } from './worker-code'

export class Sandpy {
  private worker: Worker
  private workerUrl: string
  private messageId = 0
  private pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>()
  private streamCallbacks = new Map<number, (text: string) => void>()
  private options: CreateOptions

  private constructor(worker: Worker, workerUrl: string, options: CreateOptions) {
    this.worker = worker
    this.workerUrl = workerUrl
    this.options = options
    this.setupWorkerHandlers()
  }

  private setupWorkerHandlers() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id, streaming, stdout } = event.data

      // Handle streaming chunks
      if (streaming && stdout !== undefined) {
        const callback = this.streamCallbacks.get(id)
        if (callback) {
          callback(stdout)
        }
        return
      }

      // Handle final response
      const handler = this.pending.get(id)
      if (handler) {
        this.pending.delete(id)
        this.streamCallbacks.delete(id)
        handler.resolve(event.data)
      }
    }
    this.worker.onerror = (error) => {
      console.error('Worker error:', error)
    }
  }

  private sendMessage(request: Omit<WorkerRequest, 'id'> & { streaming?: boolean }): Promise<WorkerResponse> {
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
    const instance = new Sandpy(worker, workerUrl, options)

    const response = await instance.sendMessage({
      type: 'init',
      preload: options.preload
    })
    if (!response.success) {
      throw new Error(response.error || 'Failed to initialize Pyodide')
    }

    return instance
  }

  /**
   * Execute Python code and return the result with artifacts
   * @param code - Python code to execute
   * @param options.timeout - Timeout in milliseconds (default: no timeout)
   * @param options.onOutput - Callback for streaming stdout in real-time
   */
  async run(code: string, options: RunOptions = {}): Promise<RunResult> {
    const { timeout, onOutput } = options
    const streaming = !!onOutput

    // Setup streaming callback
    const messageId = this.messageId + 1
    if (onOutput) {
      this.streamCallbacks.set(messageId, onOutput)
    }

    // Create the run promise
    const runPromise = this.sendMessage({ type: 'run', code, streaming } as any)

    // If no timeout, just await normally
    if (!timeout) {
      const response = await runPromise
      return this.formatRunResult(response)
    }

    // Race between execution and timeout
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), timeout)
    })

    const result = await Promise.race([runPromise, timeoutPromise])

    if (result === 'timeout') {
      // Terminate the worker and create a new one
      this.worker.terminate()
      URL.revokeObjectURL(this.workerUrl)

      // Recreate worker
      const blob = new Blob([workerCode], { type: 'application/javascript' })
      this.workerUrl = URL.createObjectURL(blob)
      this.worker = new Worker(this.workerUrl)
      this.setupWorkerHandlers()

      // Reinitialize
      await this.sendMessage({
        type: 'init',
        preload: this.options.preload
      })

      return {
        success: false,
        stdout: '',
        stderr: '',
        artifacts: [],
        error: `Execution timed out after ${timeout}ms`,
        timedOut: true
      }
    }

    return this.formatRunResult(result)
  }

  private formatRunResult(response: WorkerResponse): RunResult {
    return {
      success: response.success,
      stdout: response.stdout || '',
      stderr: response.stderr || '',
      result: response.result,
      artifacts: (response.artifacts || []) as Artifact[],
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

  /**
   * Create a snapshot of the current Python state
   * Captures all user-defined variables (uses dill for serialization)
   */
  async snapshot(): Promise<Snapshot> {
    const response = await this.sendMessage({ type: 'snapshot' })
    if (!response.success) {
      throw new Error(response.error || 'Failed to create snapshot')
    }
    return {
      state: response.snapshot || '',
      timestamp: Date.now(),
      packages: response.packages || []
    }
  }

  /**
   * Restore Python state from a snapshot
   * @param snapshot - Snapshot created by snapshot()
   */
  async restore(snapshot: Snapshot): Promise<void> {
    const response = await this.sendMessage({
      type: 'restore',
      snapshot: snapshot.state,
      packages: snapshot.packages
    } as any)
    if (!response.success) {
      throw new Error(response.error || 'Failed to restore snapshot')
    }
  }

  /** Destroy the sandbox and terminate the worker */
  async destroy(): Promise<void> {
    await this.sendMessage({ type: 'destroy' })
    this.worker.terminate()
    URL.revokeObjectURL(this.workerUrl)
  }
}
