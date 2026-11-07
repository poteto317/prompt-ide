import { renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { vi } from 'vitest'
import type { AgentInstructionsPanelState } from '../types'
import { useAgentInstructionFiles } from '../hooks/useAgentInstructionFiles'
import type { UseAgentInstructionFilesOptions } from '../hooks/useAgentInstructionFiles'

type Options = UseAgentInstructionFilesOptions

/**
 * useAgentInstructionFiles を既定の引数で描画するテスト用の補助。
 * 既定は claude・ツリー空・全体の指示ファイルは無い。
 * rerender には差分だけ渡せる（渡さなかった引数は初回の値のまま）。
 */
export function renderAgentInstructionFiles(overrides: Partial<Options> = {}): Omit<
  RenderHookResult<AgentInstructionsPanelState, Options>,
  'rerender'
> & {
  rerender: (next: Partial<Options>) => void
} {
  const initialProps: Options = {
    folderPath: '/p',
    fileTree: [],
    cliKind: 'claude',
    createFile: vi.fn<Options['createFile']>(),
    openFile: vi.fn<Options['openFile']>().mockResolvedValue(true),
    refreshTree: vi.fn<Options['refreshTree']>().mockResolvedValue(true),
    getGlobalStatus: vi
      .fn<Options['getGlobalStatus']>()
      .mockResolvedValue({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' }),
    createGlobalFile: vi.fn<Options['createGlobalFile']>().mockResolvedValue({ ok: true }),
    ...overrides
  }
  const rendered = renderHook((props: Options) => useAgentInstructionFiles(props), {
    initialProps
  })
  return {
    ...rendered,
    rerender: (next) => rendered.rerender({ ...initialProps, ...next })
  }
}
