import type { RunResult, Artifact, InstallProgress } from './types'

// Types for the component props
export interface SandpyArtifactProps {
  /** The result from sandbox.run() */
  result?: RunResult
  /** Current execution status */
  status?: 'idle' | 'running' | 'installing' | 'complete' | 'failed'
  /** Installation progress (when status='installing') */
  installProgress?: InstallProgress
  /** The code that was executed */
  code?: string
  /** Theme */
  theme?: 'light' | 'dark'
  /** Custom class name */
  className?: string
  /** Which tab to show by default */
  defaultTab?: 'code' | 'console' | 'result'
}

// Check if we're in a React environment
const hasReact = typeof window !== 'undefined' && (window as any).React

// CSS styles as a string for injection
const STYLES = `
.sandpy-artifact {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  border: 1px solid #e1e4e8;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}
.sandpy-artifact.dark {
  background: #0d1117;
  border-color: #30363d;
  color: #c9d1d9;
}
.sandpy-artifact-tabs {
  display: flex;
  border-bottom: 1px solid #e1e4e8;
  background: #f6f8fa;
}
.dark .sandpy-artifact-tabs {
  background: #161b22;
  border-color: #30363d;
}
.sandpy-artifact-tab {
  padding: 8px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: #57606a;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.dark .sandpy-artifact-tab {
  color: #8b949e;
}
.sandpy-artifact-tab:hover {
  color: #24292f;
}
.dark .sandpy-artifact-tab:hover {
  color: #c9d1d9;
}
.sandpy-artifact-tab.active {
  color: #24292f;
  border-bottom-color: #fd8c73;
  font-weight: 500;
}
.dark .sandpy-artifact-tab.active {
  color: #c9d1d9;
  border-bottom-color: #f78166;
}
.sandpy-artifact-content {
  padding: 12px;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow: auto;
}
.sandpy-artifact-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: #57606a;
}
.dark .sandpy-artifact-loading {
  color: #8b949e;
}
.sandpy-artifact-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #e1e4e8;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: sandpy-spin 0.8s linear infinite;
}
.dark .sandpy-artifact-spinner {
  border-color: #30363d;
  border-top-color: #58a6ff;
}
@keyframes sandpy-spin {
  to { transform: rotate(360deg); }
}
.sandpy-artifact-error {
  color: #cf222e;
  background: #ffebe9;
  padding: 12px;
  border-radius: 4px;
  margin: 8px;
}
.dark .sandpy-artifact-error {
  color: #f85149;
  background: #490202;
}
.sandpy-artifact-image {
  max-width: 100%;
  border-radius: 4px;
}
.sandpy-artifact-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.sandpy-artifact-table th,
.sandpy-artifact-table td {
  padding: 6px 10px;
  border: 1px solid #e1e4e8;
  text-align: left;
}
.dark .sandpy-artifact-table th,
.dark .sandpy-artifact-table td {
  border-color: #30363d;
}
.sandpy-artifact-table th {
  background: #f6f8fa;
  font-weight: 600;
}
.dark .sandpy-artifact-table th {
  background: #161b22;
}
.sandpy-artifact-progress {
  padding: 12px;
}
.sandpy-artifact-progress-bar {
  height: 4px;
  background: #e1e4e8;
  border-radius: 2px;
  overflow: hidden;
  margin-top: 8px;
}
.dark .sandpy-artifact-progress-bar {
  background: #30363d;
}
.sandpy-artifact-progress-fill {
  height: 100%;
  background: #2563eb;
  transition: width 0.3s ease;
}
.dark .sandpy-artifact-progress-fill {
  background: #58a6ff;
}
`

// Inject styles once
let stylesInjected = false
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.textContent = STYLES
  document.head.appendChild(style)
  stylesInjected = true
}

/**
 * Try to parse stdout as a DataFrame-like structure
 * Returns null if not a table format
 */
function parseDataFrame(stdout: string): { headers: string[]; rows: string[][] } | null {
  const lines = stdout.trim().split('\n')
  if (lines.length < 2) return null

  // Check if it looks like pandas output (has consistent spacing)
  const firstLine = lines[0]
  if (!firstLine.includes('  ')) return null

  // Try to parse as space-separated table
  const headers = firstLine.trim().split(/\s{2,}/)
  if (headers.length < 2) return null

  const rows: string[][] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    // Remove index column (first element if it's a number)
    const cells = line.split(/\s{2,}/)
    if (cells.length > 0 && /^\d+$/.test(cells[0])) {
      cells.shift()
    }
    if (cells.length === headers.length) {
      rows.push(cells)
    }
  }

  if (rows.length === 0) return null
  return { headers, rows }
}

/**
 * Render artifacts (images, etc.)
 */
function renderArtifacts(artifacts: Artifact[], isDark: boolean): any[] {
  if (!hasReact) return []
  const React = (window as any).React

  return artifacts.map((artifact, i) => {
    if (artifact.type === 'image/png' || artifact.type === 'image/jpeg') {
      return React.createElement('img', {
        key: i,
        src: `data:${artifact.type};base64,${artifact.content}`,
        alt: artifact.alt || 'Generated image',
        className: 'sandpy-artifact-image',
        style: { marginTop: i > 0 ? '8px' : 0 }
      })
    }
    return null
  }).filter(Boolean)
}

/**
 * SandpyArtifact - React component for displaying Python execution results
 *
 * @example
 * ```tsx
 * import { SandpyArtifact } from 'sandpy/react'
 *
 * <SandpyArtifact
 *   result={executionResult}
 *   status={isRunning ? 'running' : 'complete'}
 *   code={pythonCode}
 *   theme="dark"
 * />
 * ```
 */
export function SandpyArtifact(props: SandpyArtifactProps) {
  if (!hasReact) {
    console.warn('SandpyArtifact requires React. Import React before using this component.')
    return null
  }

  const React = (window as any).React
  const { useState, useEffect } = React

  // Inject styles on first render
  injectStyles()

  const {
    result,
    status = 'idle',
    installProgress,
    code,
    theme = 'light',
    className = '',
    defaultTab = 'console'
  } = props

  const [activeTab, setActiveTab] = useState(defaultTab)
  const isDark = theme === 'dark'

  // Auto-switch to result tab when we have artifacts
  useEffect(() => {
    if (result?.artifacts && result.artifacts.length > 0) {
      setActiveTab('result')
    }
  }, [result?.artifacts])

  const containerClass = `sandpy-artifact ${isDark ? 'dark' : ''} ${className}`.trim()

  // Loading state
  if (status === 'running') {
    return React.createElement('div', { className: containerClass },
      React.createElement('div', { className: 'sandpy-artifact-loading' },
        React.createElement('div', { className: 'sandpy-artifact-spinner' }),
        React.createElement('span', null, 'Running Python code...')
      )
    )
  }

  // Installing state
  if (status === 'installing' && installProgress) {
    const percent = (installProgress.current / installProgress.total) * 100
    return React.createElement('div', { className: containerClass },
      React.createElement('div', { className: 'sandpy-artifact-progress' },
        React.createElement('div', { className: 'sandpy-artifact-loading' },
          React.createElement('div', { className: 'sandpy-artifact-spinner' }),
          React.createElement('span', null, `Installing ${installProgress.package}...`)
        ),
        React.createElement('div', { className: 'sandpy-artifact-progress-bar' },
          React.createElement('div', {
            className: 'sandpy-artifact-progress-fill',
            style: { width: `${percent}%` }
          })
        ),
        React.createElement('div', {
          style: { fontSize: '12px', color: isDark ? '#8b949e' : '#57606a', marginTop: '4px' }
        }, `${installProgress.current} of ${installProgress.total} packages`)
      )
    )
  }

  // No result yet
  if (!result) {
    return React.createElement('div', { className: containerClass },
      React.createElement('div', { className: 'sandpy-artifact-content' }, 'No output yet')
    )
  }

  // Tabs
  const tabs = []
  if (code) tabs.push({ id: 'code', label: 'Code' })
  tabs.push({ id: 'console', label: 'Console' })
  if (result.artifacts.length > 0 || result.result !== undefined) {
    tabs.push({ id: 'result', label: 'Result' })
  }

  const tabElements = tabs.map(tab =>
    React.createElement('button', {
      key: tab.id,
      className: `sandpy-artifact-tab ${activeTab === tab.id ? 'active' : ''}`,
      onClick: () => setActiveTab(tab.id)
    }, tab.label)
  )

  // Content based on active tab
  let content
  if (activeTab === 'code' && code) {
    content = React.createElement('div', { className: 'sandpy-artifact-content' }, code)
  } else if (activeTab === 'console') {
    if (!result.success && result.error) {
      content = React.createElement('div', { className: 'sandpy-artifact-error' }, result.error)
    } else {
      // Try to render as table if it looks like DataFrame output
      const table = parseDataFrame(result.stdout)
      if (table) {
        content = React.createElement('div', { className: 'sandpy-artifact-content' },
          React.createElement('table', { className: 'sandpy-artifact-table' },
            React.createElement('thead', null,
              React.createElement('tr', null,
                table.headers.map((h, i) => React.createElement('th', { key: i }, h))
              )
            ),
            React.createElement('tbody', null,
              table.rows.map((row, i) =>
                React.createElement('tr', { key: i },
                  row.map((cell, j) => React.createElement('td', { key: j }, cell))
                )
              )
            )
          )
        )
      } else {
        content = React.createElement('div', { className: 'sandpy-artifact-content' },
          result.stdout || '(no output)'
        )
      }
    }
  } else if (activeTab === 'result') {
    const elements = []

    // Render artifacts (images)
    if (result.artifacts.length > 0) {
      elements.push(...renderArtifacts(result.artifacts, isDark))
    }

    // Render result value if present
    if (result.result !== undefined) {
      elements.push(
        React.createElement('div', {
          key: 'result-value',
          className: 'sandpy-artifact-content',
          style: { marginTop: elements.length > 0 ? '8px' : 0 }
        }, JSON.stringify(result.result, null, 2))
      )
    }

    content = React.createElement('div', { style: { padding: '12px' } }, ...elements)
  }

  return React.createElement('div', { className: containerClass },
    React.createElement('div', { className: 'sandpy-artifact-tabs' }, ...tabElements),
    content
  )
}

// Export types for consumers
export type { RunResult, Artifact, InstallProgress }
