import { Sandpy } from './sandpy'
import type { Artifact } from './types'

const WIDGET_STYLES = `
  :host {
    display: block;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .sandpy-widget {
    border: 1px solid #e1e4e8;
    border-radius: 8px;
    overflow: hidden;
    background: #fff;
  }
  .sandpy-widget.dark {
    background: #0d1117;
    border-color: #30363d;
  }
  .sandpy-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: #f6f8fa;
    border-bottom: 1px solid #e1e4e8;
    font-size: 13px;
    color: #57606a;
  }
  .dark .sandpy-header {
    background: #161b22;
    border-color: #30363d;
    color: #8b949e;
  }
  .sandpy-status {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sandpy-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #d97706;
  }
  .sandpy-dot.ready {
    background: #22c55e;
  }
  .sandpy-editor {
    width: 100%;
    min-height: 120px;
    padding: 12px;
    border: none;
    font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;
    background: #fff;
    color: #24292f;
  }
  .dark .sandpy-editor {
    background: #0d1117;
    color: #c9d1d9;
  }
  .sandpy-editor:focus {
    outline: none;
  }
  .sandpy-toolbar {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid #e1e4e8;
    background: #f6f8fa;
  }
  .dark .sandpy-toolbar {
    background: #161b22;
    border-color: #30363d;
  }
  .sandpy-btn {
    padding: 6px 12px;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    background: #fff;
    color: #24292f;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }
  .sandpy-btn:hover:not(:disabled) {
    background: #f3f4f6;
  }
  .sandpy-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .sandpy-btn-primary {
    background: #2563eb;
    border-color: #2563eb;
    color: #fff;
  }
  .sandpy-btn-primary:hover:not(:disabled) {
    background: #1d4ed8;
  }
  .dark .sandpy-btn {
    background: #21262d;
    border-color: #30363d;
    color: #c9d1d9;
  }
  .dark .sandpy-btn:hover:not(:disabled) {
    background: #30363d;
  }
  .dark .sandpy-btn-primary {
    background: #238636;
    border-color: #238636;
    color: #fff;
  }
  .sandpy-output {
    padding: 12px;
    border-top: 1px solid #e1e4e8;
    font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow: auto;
    background: #f6f8fa;
    color: #24292f;
  }
  .dark .sandpy-output {
    background: #161b22;
    border-color: #30363d;
    color: #c9d1d9;
  }
  .sandpy-output.error {
    color: #cf222e;
  }
  .dark .sandpy-output.error {
    color: #f85149;
  }
  .sandpy-output:empty {
    display: none;
  }
  .sandpy-artifact {
    max-width: 100%;
    border-radius: 4px;
    margin-top: 8px;
  }
`

export class SandpyWidget extends HTMLElement {
  private shadow: ShadowRoot
  private sandbox: Sandpy | null = null
  private editor!: HTMLTextAreaElement
  private output!: HTMLDivElement
  private runBtn!: HTMLButtonElement
  private statusDot!: HTMLDivElement
  private statusText!: HTMLSpanElement

  static get observedAttributes() {
    return ['theme', 'code', 'readonly']
  }

  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'open' })
  }

  async connectedCallback() {
    this.render()
    await this.init()
  }

  disconnectedCallback() {
    this.sandbox?.destroy()
  }

  attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
    if (name === 'theme') {
      const container = this.shadow.querySelector('.sandpy-widget')
      if (container) {
        container.classList.toggle('dark', newValue === 'dark')
      }
    }
    if (name === 'code' && this.editor) {
      this.editor.value = newValue || ''
    }
    if (name === 'readonly' && this.editor) {
      this.editor.readOnly = newValue !== null
    }
  }

  private render() {
    const theme = this.getAttribute('theme') || 'light'
    const code = this.getAttribute('code') || 'print("Hello from Python!")'
    const readonly = this.hasAttribute('readonly')

    this.shadow.innerHTML = `
      <style>${WIDGET_STYLES}</style>
      <div class="sandpy-widget ${theme === 'dark' ? 'dark' : ''}">
        <div class="sandpy-header">
          <span>Python</span>
          <div class="sandpy-status">
            <div class="sandpy-dot"></div>
            <span class="sandpy-status-text">Loading...</span>
          </div>
        </div>
        <textarea class="sandpy-editor" spellcheck="false" ${readonly ? 'readonly' : ''}>${code}</textarea>
        <div class="sandpy-toolbar">
          <button class="sandpy-btn sandpy-btn-primary" disabled>Run</button>
          <button class="sandpy-btn" disabled>Clear</button>
        </div>
        <div class="sandpy-output"></div>
      </div>
    `

    this.editor = this.shadow.querySelector('.sandpy-editor')!
    this.output = this.shadow.querySelector('.sandpy-output')!
    this.runBtn = this.shadow.querySelector('.sandpy-btn-primary')!
    this.statusDot = this.shadow.querySelector('.sandpy-dot')!
    this.statusText = this.shadow.querySelector('.sandpy-status-text')!

    const clearBtn = this.shadow.querySelectorAll('.sandpy-btn')[1] as HTMLButtonElement

    this.runBtn.onclick = () => this.run()
    clearBtn.onclick = () => {
      this.output.textContent = ''
      this.output.className = 'sandpy-output'
    }

    this.editor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        this.run()
      }
    })
  }

  private async init() {
    try {
      const t0 = performance.now()
      this.sandbox = await Sandpy.create()
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
      this.statusText.textContent = `Ready (${elapsed}s)`
      this.statusDot.classList.add('ready')
      this.runBtn.disabled = false
      const clearBtn = this.shadow.querySelectorAll('.sandpy-btn')[1] as HTMLButtonElement
      clearBtn.disabled = false

      // Dispatch ready event
      this.dispatchEvent(new CustomEvent('ready', { detail: { sandbox: this.sandbox } }))
    } catch (err: any) {
      this.statusText.textContent = 'Failed'
      this.output.textContent = err.message
      this.output.className = 'sandpy-output error'
    }
  }

  private async run() {
    if (!this.sandbox) return

    const code = this.editor.value
    this.runBtn.disabled = true
    this.output.textContent = ''
    this.output.className = 'sandpy-output'

    try {
      const timeout = this.hasAttribute('timeout')
        ? parseInt(this.getAttribute('timeout')!, 10)
        : undefined

      const result = await this.sandbox.run(code, { timeout })

      if (!result.success) {
        this.output.textContent = result.error || 'Unknown error'
        this.output.className = 'sandpy-output error'
      } else {
        this.output.textContent = result.stdout
        this.renderArtifacts(result.artifacts)
      }

      // Dispatch result event
      this.dispatchEvent(new CustomEvent('result', { detail: result }))
    } catch (err: any) {
      this.output.textContent = err.message
      this.output.className = 'sandpy-output error'
    }

    this.runBtn.disabled = false
  }

  private renderArtifacts(artifacts: Artifact[]) {
    for (const artifact of artifacts) {
      if (artifact.type === 'image/png' || artifact.type === 'image/jpeg') {
        const img = document.createElement('img')
        img.src = `data:${artifact.type};base64,${artifact.content}`
        img.className = 'sandpy-artifact'
        img.alt = artifact.alt || 'Generated image'
        this.output.appendChild(img)
      }
    }
  }

  // Public API
  async execute(code: string) {
    if (!this.sandbox) throw new Error('Sandbox not ready')
    return this.sandbox.run(code)
  }

  getSandbox() {
    return this.sandbox
  }

  setCode(code: string) {
    this.editor.value = code
  }

  getCode() {
    return this.editor.value
  }
}

// Auto-register if in browser
if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  if (!customElements.get('sandpy-editor')) {
    customElements.define('sandpy-editor', SandpyWidget)
  }
}
