import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Sandpy } from './sandpy'

describe('Sandpy', () => {
  let sandbox: Sandpy

  beforeAll(async () => {
    sandbox = await Sandpy.create()
  }, 60000)

  afterAll(async () => {
    await sandbox?.destroy()
  })

  describe('run()', () => {
    it('should execute print statement', async () => {
      const result = await sandbox.run('print("hello")')
      expect(result.success).toBe(true)
      expect(result.output).toBe('hello')
    })

    it('should return expression result', async () => {
      const result = await sandbox.run('2 + 2')
      expect(result.success).toBe(true)
      expect(result.output).toBe('4')
    })

    it('should handle syntax errors', async () => {
      const result = await sandbox.run('print("unclosed')
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle runtime errors', async () => {
      const result = await sandbox.run('undefined_variable')
      expect(result.success).toBe(false)
      expect(result.error).toContain('NameError')
    })

    it('should persist variables across runs', async () => {
      await sandbox.run('test_var = 42')
      const result = await sandbox.run('print(test_var)')
      expect(result.success).toBe(true)
      expect(result.output).toBe('42')
    })
  })

  describe('file operations', () => {
    it('should write and read files', async () => {
      await sandbox.writeFile('/sandbox/test.txt', 'hello world')
      const content = await sandbox.readFile('/sandbox/test.txt')
      expect(content).toBe('hello world')
    })

    it('should list files', async () => {
      await sandbox.writeFile('/sandbox/list-test.txt', 'test')
      const files = await sandbox.listFiles('/sandbox')
      expect(files).toContain('/sandbox/list-test.txt')
    })

    it('should delete files', async () => {
      await sandbox.writeFile('/sandbox/delete-me.txt', 'temp')
      await sandbox.deleteFile('/sandbox/delete-me.txt')
      const files = await sandbox.listFiles('/sandbox')
      expect(files).not.toContain('/sandbox/delete-me.txt')
    })

    it('should access files from Python', async () => {
      await sandbox.writeFile('/sandbox/py-test.txt', 'from js')
      const result = await sandbox.run(`
with open('/sandbox/py-test.txt') as f:
    print(f.read())
`)
      expect(result.success).toBe(true)
      expect(result.output).toBe('from js')
    })
  })

  describe('install()', () => {
    it('should install packages', async () => {
      const result = await sandbox.install('cowsay')
      expect(result.success).toBe(true)
    }, 30000)

    it('should use installed packages', async () => {
      const result = await sandbox.run('import cowsay; print("ok")')
      expect(result.success).toBe(true)
      expect(result.output).toBe('ok')
    })
  })
})
