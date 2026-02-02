# sandpy

Browser-native Python sandbox library for AI agents.

## What this is
- Thin wrapper around Pyodide
- Runs Python in browser via WebAssembly
- Designed for AI agent integration

## Technical requirements
- Cold boot: <5s, Warm boot: <2s
- Pre-bundled: pandas, numpy
- Persistence: OPFS primary, IndexedDB fallback
- Package size: <15MB gzipped
- API surface: <10 methods

## Architecture
- Main thread: Public API
- Web Worker: Pyodide runtime (isolated)
- Storage: OPFS/IndexedDB for file persistence

## API (target)
```typescript
const sandbox = await Sandpy.create()
const result = await sandbox.run('print("hello")')
await sandbox.writeFile('/data.csv', csvContent)
await sandbox.install('scikit-learn')
await sandbox.destroy()
```

## Stack
- TypeScript
- Vite (bundling)
- Vitest (testing)
- Pyodide (Python runtime)
```

Then just open Claude Code in that directory and say:
```
Let's build this. Start with project setup and a minimal run() that executes Python and returns output.