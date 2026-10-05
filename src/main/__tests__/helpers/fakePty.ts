import { vi } from 'vitest'
import type { PtyLike } from '../../agentSession'

// 偽の pty。onData・onExit の購読者を持ち、テストから emitData・emitExit で起こす
export interface FakePty extends PtyLike {
  write: ReturnType<typeof vi.fn<PtyLike['write']>>
  resize: ReturnType<typeof vi.fn<PtyLike['resize']>>
  kill: ReturnType<typeof vi.fn<PtyLike['kill']>>
  emitData(data: string): void
  emitExit(exitCode: number, signal?: number): void
  /** 購読が解除されずに残っている数 */
  listenerCount(): number
}

export function makeFakePty(pid = 1000): FakePty {
  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()
  return {
    pid,
    onData(listener) {
      dataListeners.add(listener)
      return { dispose: () => dataListeners.delete(listener) }
    },
    onExit(listener) {
      exitListeners.add(listener)
      return { dispose: () => exitListeners.delete(listener) }
    },
    write: vi.fn<PtyLike['write']>(),
    resize: vi.fn<PtyLike['resize']>(),
    kill: vi.fn<PtyLike['kill']>(),
    emitData(data) {
      for (const listener of [...dataListeners]) listener(data)
    },
    emitExit(exitCode, signal) {
      for (const listener of [...exitListeners]) listener({ exitCode, signal })
    },
    listenerCount() {
      return dataListeners.size + exitListeners.size
    }
  }
}
