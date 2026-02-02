import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    dts({ rollupTypes: true })
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Sandpy',
      fileName: 'sandpy',
      formats: ['es']
    },
    rollupOptions: {
      external: ['pyodide'],
      output: {
        globals: {
          pyodide: 'loadPyodide'
        }
      }
    }
  },
  worker: {
    format: 'es'
  }
})
