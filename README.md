# sandpy

[![npm version](https://img.shields.io/npm/v/sandpy.svg)](https://www.npmjs.com/package/sandpy)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Browser-native Python sandbox for AI agents.

**[Try the live demo](https://sandpy.vercel.app/)**

## Features

- **Isolated execution** - Python runs in a Web Worker, won't block your UI
- **Persistent files** - Files in `/sandbox/` survive page reloads (OPFS/IndexedDB)
- **Package installation** - Install any pure Python package from PyPI
- **Zero config** - Just import and use, worker is bundled inline
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
console.log(result.output) // "Hello from Python!"

// Cleanup when done
await sandbox.destroy()
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

### `sandbox.run(code)`

Execute Python code and return the result.

```typescript
const result = await sandbox.run(`
import sys
print(f"Python {sys.version}")
`)

// result = { success: true, output: "Python 3.11.3 ..." }
// On error: { success: false, output: "...", error: "..." }
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

### `sandbox.install(packages)`

Install packages from PyPI via micropip.

```typescript
await sandbox.install('requests')
await sandbox.install(['numpy', 'pandas'])
```

### `sandbox.destroy()`

Terminate the worker and clean up.

```typescript
await sandbox.destroy()
```

## File Persistence

Files written to `/sandbox/` are automatically persisted using the Origin Private File System (OPFS), with IndexedDB as a fallback for older browsers.

```typescript
// This file will survive page reloads
await sandbox.writeFile('/sandbox/important.txt', 'data')

// This file is temporary (lost on reload)
await sandbox.writeFile('/tmp/temp.txt', 'temporary')
```

## Examples

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

### Using External Packages

```typescript
await sandbox.install('cowsay')

const result = await sandbox.run(`
import cowsay
cowsay.cow('Hello World!')
`)
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
