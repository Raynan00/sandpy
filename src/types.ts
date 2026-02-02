export interface RunResult {
  success: boolean
  output: string
  error?: string
}

export interface FileResult {
  success: boolean
  content?: string
  error?: string
}

export interface InstallResult {
  success: boolean
  error?: string
}

export interface CreateOptions {
  preload?: ('pandas' | 'numpy')[]
}

export type WorkerMessageType =
  | 'init'
  | 'run'
  | 'destroy'
  | 'writeFile'
  | 'readFile'
  | 'deleteFile'
  | 'listFiles'
  | 'install'

export interface WorkerRequest {
  id: number
  type: WorkerMessageType
  code?: string
  path?: string
  content?: string
  packages?: string[]
  preload?: string[]
}

export interface WorkerResponse {
  id: number
  success: boolean
  output?: string
  content?: string
  files?: string[]
  error?: string
}
