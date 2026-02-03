import { Sandpy } from './sandpy'
import type { RunResult, Snapshot } from './types'

export interface SandpyToolOptions {
  /** Timeout for code execution in milliseconds (default: 30000) */
  timeout?: number
  /** Packages to preload on init */
  preload?: string[]
  /** Whether to auto-install missing packages on ModuleNotFoundError */
  autoInstall?: boolean
}

/**
 * AI Tool for executing Python code in a sandboxed environment.
 * Compatible with Vercel AI SDK, LangChain, and other AI frameworks.
 */
export class SandpyTool {
  private sandbox: Sandpy | null = null
  private initPromise: Promise<Sandpy> | null = null
  private options: SandpyToolOptions

  // Tool metadata (compatible with most AI frameworks)
  readonly name = 'python_sandbox'
  readonly description = `Execute Python code in a secure browser-based sandbox.
Use this tool to run Python code, perform calculations, data analysis, or create visualizations.
The sandbox has access to numpy, pandas, matplotlib, and can install other packages.
Returns stdout, stderr, and any generated artifacts (like matplotlib plots as base64 images).`

  // JSON Schema for the tool parameters (OpenAI/Vercel AI SDK format)
  readonly parameters = {
    type: 'object' as const,
    properties: {
      code: {
        type: 'string',
        description: 'Python code to execute'
      },
      packages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional packages to install before running (e.g., ["requests", "beautifulsoup4"])'
      }
    },
    required: ['code']
  }

  constructor(options: SandpyToolOptions = {}) {
    this.options = {
      timeout: 30000,
      autoInstall: true,
      ...options
    }
  }

  /**
   * Initialize the sandbox (called automatically on first use)
   */
  async init(): Promise<Sandpy> {
    if (this.sandbox) return this.sandbox
    if (this.initPromise) return this.initPromise

    this.initPromise = Sandpy.create({
      preload: this.options.preload as any
    })

    this.sandbox = await this.initPromise
    return this.sandbox
  }

  /**
   * Execute Python code (main tool function)
   * @param input - Code string or object with code and packages
   */
  async execute(input: string | { code: string; packages?: string[] }): Promise<RunResult> {
    const sandbox = await this.init()

    const { code, packages } = typeof input === 'string'
      ? { code: input, packages: undefined }
      : input

    // Install requested packages
    if (packages && packages.length > 0) {
      await sandbox.install(packages)
    }

    // Run the code
    let result = await sandbox.run(code, { timeout: this.options.timeout })

    // Auto-install on ModuleNotFoundError if enabled
    if (this.options.autoInstall && !result.success && result.error) {
      const match = result.error.match(/No module named ['"]([\w-]+)['"]/)
      if (match) {
        const missingModule = match[1]
        await sandbox.install(missingModule)
        result = await sandbox.run(code, { timeout: this.options.timeout })
      }
    }

    return result
  }

  /**
   * Alias for execute() - compatible with LangChain's _call pattern
   */
  async call(input: string | { code: string; packages?: string[] }): Promise<string> {
    const result = await this.execute(input)
    if (!result.success) {
      return `Error: ${result.error}`
    }
    let output = result.stdout
    if (result.artifacts.length > 0) {
      output += `\n\n[Generated ${result.artifacts.length} artifact(s)]`
      for (const artifact of result.artifacts) {
        if (artifact.alt) {
          output += `\n- ${artifact.alt} (${artifact.type})`
        }
      }
    }
    return output
  }

  /**
   * Alias for execute() - compatible with Vercel AI SDK
   */
  async invoke(args: { code: string; packages?: string[] }): Promise<RunResult> {
    return this.execute(args)
  }

  /**
   * Install packages
   */
  async install(packages: string | string[]): Promise<void> {
    const sandbox = await this.init()
    const result = await sandbox.install(packages)
    if (!result.success) {
      throw new Error(result.error || 'Failed to install packages')
    }
  }

  /**
   * Write a file to the sandbox
   */
  async writeFile(path: string, content: string): Promise<void> {
    const sandbox = await this.init()
    await sandbox.writeFile(path, content)
  }

  /**
   * Read a file from the sandbox
   */
  async readFile(path: string): Promise<string> {
    const sandbox = await this.init()
    return sandbox.readFile(path)
  }

  /**
   * Create a snapshot of the current state
   */
  async snapshot(): Promise<Snapshot> {
    const sandbox = await this.init()
    return sandbox.snapshot()
  }

  /**
   * Restore state from a snapshot
   */
  async restore(snapshot: Snapshot): Promise<void> {
    const sandbox = await this.init()
    await sandbox.restore(snapshot)
  }

  /**
   * Destroy the sandbox
   */
  async destroy(): Promise<void> {
    if (this.sandbox) {
      await this.sandbox.destroy()
      this.sandbox = null
      this.initPromise = null
    }
  }
}

/**
 * Create a tool definition compatible with Vercel AI SDK
 */
export function createVercelAITool(options: SandpyToolOptions = {}) {
  const tool = new SandpyTool(options)

  return {
    description: tool.description,
    parameters: tool.parameters,
    execute: async (args: { code: string; packages?: string[] }) => {
      const result = await tool.execute(args)
      return {
        success: result.success,
        output: result.stdout,
        error: result.error,
        artifacts: result.artifacts.map(a => ({
          type: a.type,
          alt: a.alt,
          // Include base64 for images
          ...(a.type.startsWith('image/') ? { base64: a.content } : {})
        }))
      }
    }
  }
}

/**
 * Create a tool compatible with LangChain's DynamicTool
 */
export function createLangChainTool(options: SandpyToolOptions = {}) {
  const tool = new SandpyTool(options)

  return {
    name: tool.name,
    description: tool.description,
    func: async (input: string) => tool.call(input)
  }
}
