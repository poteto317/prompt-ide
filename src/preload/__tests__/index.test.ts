import { describe, it, expect, vi, afterEach } from 'vitest'

const mockExposeInMainWorld = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockExposeInMainWorld },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }
}))

afterEach(() => {
  vi.resetModules()
  Reflect.deleteProperty(process, 'contextIsolated')
})

describe('preload の公開', () => {
  it('window.api だけを公開し、汎用の IPC(window.electron)は公開しない', async () => {
    Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true })
    await import('../index')
    expect(mockExposeInMainWorld.mock.calls.map(([name]) => name)).toEqual(['api'])
  })
})
