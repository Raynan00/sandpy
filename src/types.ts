/** Artifact generated during code execution (images, files, etc.) */
export interface Artifact {
  type: 'image/png' | 'image/jpeg' | 'file' | 'html'
  content: string  // Base64 for images, path or content for files
  alt?: string     // Description for LLMs to understand the artifact
}

/** Options for run() method */
export interface RunOptions {
  /** Timeout in milliseconds (default: no timeout) */
  timeout?: number
  /** Callback for streaming stdout in real-time */
  onOutput?: (text: string) => void
}

/** Result from executing Python code */
export interface RunResult {
  success: boolean
  stdout: string       // Standard output (print statements)
  stderr: string       // Standard error output
  result?: any         // Final expression value (auto-serialized)
  artifacts: Artifact[] // Generated artifacts (images, files)
  error?: string       // Error message if success=false
  timedOut?: boolean   // True if execution was terminated due to timeout
}

/** @deprecated Use RunResult instead */
export interface LegacyRunResult {
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

/** Snapshot of Python interpreter state */
export interface Snapshot {
  /** Base64-encoded dill serialization of globals */
  state: string
  /** Timestamp when snapshot was created */
  timestamp: number
  /** List of installed packages at snapshot time */
  packages: string[]
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
  | 'snapshot'
  | 'restore'
  | 'interrupt'

export interface WorkerRequest {
  id: number
  type: WorkerMessageType
  code?: string
  path?: string
  content?: string
  packages?: string[]
  preload?: string[]
  snapshot?: string  // For restore
}

export interface WorkerResponse {
  id: number
  success: boolean
  stdout?: string
  stderr?: string
  result?: any
  artifacts?: Artifact[]
  output?: string  // Legacy field for backwards compat
  content?: string
  files?: string[]
  error?: string
  snapshot?: string  // For snapshot response
  packages?: string[]  // For snapshot response
  streaming?: boolean  // Indicates this is a streaming chunk
}
