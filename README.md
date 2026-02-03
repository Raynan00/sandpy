# sandpy

[![npm version](https://img.shields.io/npm/v/sandpy.svg)](https://www.npmjs.com/package/sandpy)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Browser-native Python sandbox for AI agents.

**[Try the live demo](https://sandpy.vercel.app/)**

## Features

- **Isolated execution** - Python runs in a Web Worker, won't block your UI
- **Timeout support** - Prevent runaway code with configurable timeouts
- **Streaming output** - Real-time stdout via callbacks
- **Snapshot/restore** - Save and restore Python state across sessions
- **Artifact capture** - Auto-capture matplotlib plots as base64 images
- **Vision hook** - Connect GPT-4V or other vision models for intelligent plot descriptions
- **React component** - `<SandpyArtifact />` for displaying results with tabs and loading states
- **Embeddable widget** - Drop-in `<sandpy-editor>` web component
- **AI integrations** - Ready-made tools for LangChain, Vercel AI SDK
- **Install progress** - Real-time callbacks during package installation
- **Persistent files** - Files in `/sandbox/` survive page reloads
- **Package installation** - Install any pure Python package from PyPI
- **TypeScript** - Full type definitions included

## Install

```bash
npm install sandpy
```

## Quick Start

```typescript
import { Sandpy } from 'sandpy'

const sandbox = await Sandpy.create()

// Run Python code
const result = await sandbox.run('print("Hello from Python!")')
console.log(result.stdout) // "Hello from Python!"

// Cleanup when done
await sandbox.destroy()
```

## Embeddable Widget

Drop a Python editor into any webpage:

```html
<script type="module">
  import 'sandpy'
</script>

<sandpy-editor theme="dark" code="print('Hello!')"></sandpy-editor>
```

Widget attributes:
- `theme` - "light" or "dark"
- `code` - Initial code
- `timeout` - Execution timeout in ms
- `readonly` - Make editor read-only

Widget events:
```javascript
const editor = document.querySelector('sandpy-editor')

editor.addEventListener('ready', (e) => {
  console.log('Sandbox ready:', e.detail.sandbox)
})

editor.addEventListener('result', (e) => {
  console.log('Execution result:', e.detail)
})
```

## AI Tool Integrations

### Vercel AI SDK

```typescript
import { createVercelAITool } from 'sandpy'
import { generateText } from 'ai'

const pythonTool = createVercelAITool({ timeout: 30000 })

const result = await generateText({
  model: yourModel,
  tools: { python: pythonTool },
  prompt: 'Calculate the first 10 fibonacci numbers using Python'
})
```

### LangChain

```typescript
import { createLangChainTool } from 'sandpy'
import { DynamicTool } from 'langchain/tools'

const pythonTool = new DynamicTool(createLangChainTool({ timeout: 30000 }))

// Use with your agent
const agent = new Agent({
  tools: [pythonTool]
})
```

### Direct Tool Usage

```typescript
import { SandpyTool } from 'sandpy'

const tool = new SandpyTool({
  timeout: 30000,
  autoInstall: true  // Auto-install missing packages
})

// Execute code
const result = await tool.execute('print(2 + 2)')
console.log(result.stdout) // "4"

// Or with packages
const result = await tool.execute({
  code: 'import requests; print(requests.__version__)',
  packages: ['requests']
})

// Cleanup
await tool.destroy()
```

## React Component

Display execution results with a beautiful UI:

```tsx
import { SandpyArtifact } from 'sandpy'

function PythonOutput({ result, status }) {
  return (
    <SandpyArtifact
      result={result}
      status={status}  // 'idle' | 'running' | 'installing' | 'complete' | 'failed'
      code={pythonCode}
      theme="dark"
      defaultTab="console"
    />
  )
}
```

Features:
- **Loading states** - Spinner during execution and package installation
- **Tabs** - Toggle between Code, Console, and Result views
- **DataFrame rendering** - Auto-detects pandas output and renders as sortable table
- **Artifact display** - Shows matplotlib plots inline
- **Progress bar** - Shows package installation progress

## Vision Hook

Connect a vision model (like GPT-4V) to generate intelligent descriptions for plots:

```typescript
const result = await sandbox.run(plotCode, {
  describeArtifact: async (artifact) => {
    // Call your vision model
    const response = await openai.chat.completions.create({
      model: 'gpt-4-vision-preview',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this chart in one sentence.' },
          { type: 'image_url', image_url: { url: `data:${artifact.type};base64,${artifact.content}` }}
        ]
      }]
    })
    return response.choices[0].message.content
  }
})

// Now artifact.alt contains an intelligent description like:
// "A line chart showing exponential growth from 0 to 100 with a sharp increase after x=7"
```

## API

### `Sandpy.create(options?)`

Create a new sandbox instance.

```typescript
// Basic
const sandbox = await Sandpy.create()

// With preloaded packages (faster first use)
const sandbox = await Sandpy.create({
  preload: ['numpy', 'pandas']
})
```

### `sandbox.run(code, options?)`

Execute Python code and return the result.

```typescript
const result = await sandbox.run(`
import sys
print(f"Python {sys.version}")
`)

// result = {
//   success: true,
//   stdout: "Python 3.11.3 ...",
//   stderr: "",
//   artifacts: [],
//   result: undefined
// }
```

#### Options

```typescript
// With timeout (prevents infinite loops)
const result = await sandbox.run('while True: pass', {
  timeout: 5000  // 5 seconds
})
// result.timedOut === true if it timed out

// With streaming output
const result = await sandbox.run('for i in range(10): print(i)', {
  onOutput: (text) => console.log('Got:', text)
})
```

### `sandbox.snapshot()`

Create a snapshot of the current Python state (variables, etc).

```typescript
// Set up some state
await sandbox.run('x = 42')
await sandbox.run('data = [1, 2, 3]')

// Save snapshot
const snap = await sandbox.snapshot()

// Later, restore it (even after page reload if you persist the snapshot)
await sandbox.restore(snap)

// Variables are back!
const result = await sandbox.run('print(x)')  // "42"
```

### `sandbox.restore(snapshot)`

Restore Python state from a snapshot.

```typescript
await sandbox.restore(snap)
```

### `sandbox.writeFile(path, content)`

Write a file. Files under `/sandbox/` are persisted.

```typescript
await sandbox.writeFile('/sandbox/data.csv', 'name,value\nalice,100')
```

### `sandbox.readFile(path)`

Read a file.

```typescript
const content = await sandbox.readFile('/sandbox/data.csv')
```

### `sandbox.deleteFile(path)`

Delete a file.

```typescript
await sandbox.deleteFile('/sandbox/data.csv')
```

### `sandbox.listFiles(path?)`

List files in a directory. Defaults to `/sandbox/`.

```typescript
const files = await sandbox.listFiles()
// ["/sandbox/data.csv", "/sandbox/config.json"]
```

### `sandbox.install(packages, options?)`

Install packages from PyPI via micropip.

```typescript
await sandbox.install('requests')
await sandbox.install(['numpy', 'pandas'])

// With progress callback
await sandbox.install(['numpy', 'pandas', 'matplotlib'], {
  onProgress: (info) => {
    console.log(`Installing ${info.package}... (${info.current}/${info.total})`)
    // info.status: 'installing' | 'installed' | 'failed'
  }
})
```

### `sandbox.destroy()`

Terminate the worker and clean up.

```typescript
await sandbox.destroy()
```

## Artifacts (Matplotlib Vision Bridge)

When you call `plt.show()`, sandpy automatically captures the plot as a base64 image:

```typescript
await sandbox.install('matplotlib')

const result = await sandbox.run(`
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 10, 100)
plt.plot(x, np.sin(x))
plt.title('Sine Wave')
plt.show()
`)

// result.artifacts = [{
//   type: 'image/png',
//   content: 'iVBORw0KGgo...',  // base64
//   alt: 'Sine Wave'            // from plt.title()
// }]

// Display in browser:
const img = document.createElement('img')
img.src = `data:image/png;base64,${result.artifacts[0].content}`
```

This is designed for AI agents that need to "see" visualizations.

## Examples

### AI Agent with Timeout Protection

```typescript
const sandbox = await Sandpy.create()

// Safe execution with timeout
async function executeUserCode(code: string) {
  const result = await sandbox.run(code, { timeout: 10000 })

  if (result.timedOut) {
    return 'Code execution timed out'
  }
  if (!result.success) {
    return `Error: ${result.error}`
  }
  return result.stdout
}
```

### Data Analysis with Pandas

```typescript
const sandbox = await Sandpy.create({ preload: ['pandas'] })

await sandbox.writeFile('/sandbox/sales.csv', `
date,amount
2024-01-01,100
2024-01-02,150
2024-01-03,200
`)

const result = await sandbox.run(`
import pandas as pd

df = pd.read_csv('/sandbox/sales.csv')
print(f"Total: ${df['amount'].sum()}")
print(f"Average: ${df['amount'].mean():.2f}")
`)
```

### Session Persistence with Snapshots

```typescript
const sandbox = await Sandpy.create()

// User builds up state over multiple interactions
await sandbox.run('import pandas as pd')
await sandbox.run('data = pd.DataFrame({"x": [1,2,3]})')

// Save session
const snapshot = await sandbox.snapshot()
localStorage.setItem('sandpy-session', JSON.stringify(snapshot))

// Later (even after page reload)
const saved = JSON.parse(localStorage.getItem('sandpy-session'))
await sandbox.restore(saved)

// State is restored
await sandbox.run('print(data)')  // Works!
```

## Browser Support

Requires modern browser with:
- Web Workers
- WebAssembly
- OPFS (optional, falls back to IndexedDB)

## Performance

- **Cold boot**: ~3-5s (downloads ~15MB Pyodide runtime)
- **Warm boot**: <1s (cached by browser)
- **Preload**: Add a few seconds per package

## Contributing

Contributions welcome! Please read the contributing guidelines first.

## License

MIT
