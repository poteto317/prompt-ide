import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FileTreeNode, AgentInstructionsPanelState } from '../../types'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { useAgentInstructionFiles } from '../useAgentInstructionFiles'
import type { UseAgentInstructionFilesOptions } from '../useAgentInstructionFiles'
import type { AgentInstructionCreateOutcome } from '../agentInstructionFileCreation'
import {
  AGENT_INSTRUCTION_OPEN_AFTER_CREATE_FAILED,
  agentInstructionCreateFailureMessage
} from '../../lib/agentInstructionMessages'

const claudeNode: FileTreeNode = { name: 'CLAUDE.md', path: '/p/CLAUDE.md', type: 'file' }

function renderFiles(
  overrides: Partial<UseAgentInstructionFilesOptions> = {}
): RenderHookResult<AgentInstructionsPanelState, UseAgentInstructionFilesOptions> {
  const initialProps: UseAgentInstructionFilesOptions = {
    folderPath: '/p',
    fileTree: [],
    cliKind: 'claude',
    createFile: vi.fn<UseAgentInstructionFilesOptions['createFile']>(),
    openFile: vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true),
    ...overrides
  }
  return renderHook((props) => useAgentInstructionFiles(props), { initialProps })
}

describe('useAgentInstructionFiles', () => {
  it('claude → 3 行。ツリーにある行だけ node が入る', () => {
    const { result } = renderFiles({ fileTree: [claudeNode] })
    expect(result.current.rows.map((r) => r.relativePath)).toEqual([
      'CLAUDE.md',
      '.claude/CLAUDE.md',
      'CLAUDE.local.md'
    ])
    expect(result.current.rows[0].node).toBe(claudeNode)
    expect(result.current.rows[1].node).toBeNull()
  })

  it('CLI を copilot に切り替える → copilot の 2 行に変わる', () => {
    const { result, rerender } = renderFiles()
    rerender({
      folderPath: '/p',
      fileTree: [],
      cliKind: 'copilot' as AgentCliKind,
      createFile: vi.fn(),
      openFile: vi.fn()
    })
    expect(result.current.cliKind).toBe('copilot')
    expect(result.current.rows.map((r) => r.relativePath)).toEqual([
      'AGENTS.md',
      '.github/copilot-instructions.md'
    ])
  })

  it('open → その node で openFile を呼ぶ', () => {
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
    const { result } = renderFiles({ fileTree: [claudeNode], openFile })
    act(() => result.current.open(result.current.rows[0]))
    expect(openFile).toHaveBeenCalledWith(claudeNode)
  })

  it('create の成功 → 読み直したツリーのノードを開く', async () => {
    const createFile = vi
      .fn<UseAgentInstructionFilesOptions['createFile']>()
      .mockResolvedValue({ status: 'created', tree: [claudeNode] })
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
    const { result } = renderFiles({ createFile, openFile })
    await act(async () => {
      await result.current.create(result.current.rows[0])
    })
    expect(createFile).toHaveBeenCalledWith('claude', result.current.rows[0].file)
    expect(openFile).toHaveBeenCalledWith(claudeNode)
    expect(result.current.message).toBeNull()
    expect(result.current.isCreating).toBe(false)
  })

  it.each<[string, AgentInstructionCreateOutcome]>([
    ['tree が null', { status: 'created', tree: null }],
    ['ノードが見つからない', { status: 'created', tree: [] }]
  ])('create の後に %s → 開けなかった文言を出し、開かない', async (_label, outcome) => {
    const createFile = vi
      .fn<UseAgentInstructionFilesOptions['createFile']>()
      .mockResolvedValue(outcome)
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>()
    const { result } = renderFiles({ createFile, openFile })
    await act(async () => {
      await result.current.create(result.current.rows[0])
    })
    expect(result.current.message).toBe(AGENT_INSTRUCTION_OPEN_AFTER_CREATE_FAILED)
    expect(openFile).not.toHaveBeenCalled()
  })

  it('create の失敗 → 理由の文言を出し、開かない', async () => {
    const createFile = vi
      .fn<UseAgentInstructionFilesOptions['createFile']>()
      .mockResolvedValue({ status: 'failed', reason: 'outside' })
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>()
    const { result } = renderFiles({ createFile, openFile })
    await act(async () => {
      await result.current.create(result.current.rows[1])
    })
    expect(result.current.message).toBe(agentInstructionCreateFailureMessage('outside'))
    expect(openFile).not.toHaveBeenCalled()
  })

  it('create が skipped → 文言を出さない', async () => {
    const createFile = vi
      .fn<UseAgentInstructionFilesOptions['createFile']>()
      .mockResolvedValue({ status: 'skipped' })
    const { result } = renderFiles({ createFile })
    await act(async () => {
      await result.current.create(result.current.rows[0])
    })
    expect(result.current.message).toBeNull()
  })

  it('作成の途中の 2 回目の create → 無視する(ref で判定。L-653)', async () => {
    let resolveCreate: (outcome: AgentInstructionCreateOutcome) => void = () => {}
    const createFile = vi.fn<UseAgentInstructionFilesOptions['createFile']>(
      () => new Promise((resolve) => (resolveCreate = resolve))
    )
    const { result } = renderFiles({ createFile })
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.create(result.current.rows[0])
      void result.current.create(result.current.rows[1])
    })
    expect(createFile).toHaveBeenCalledTimes(1)
    expect(result.current.isCreating).toBe(true)
    await act(async () => {
      resolveCreate({ status: 'skipped' })
      await first
    })
    expect(result.current.isCreating).toBe(false)
  })

  it('次の操作で文言を消す', async () => {
    const createFile = vi
      .fn<UseAgentInstructionFilesOptions['createFile']>()
      .mockResolvedValue({ status: 'failed', reason: 'exists' })
    const { result } = renderFiles({ createFile, fileTree: [claudeNode] })
    await act(async () => {
      await result.current.create(result.current.rows[1])
    })
    expect(result.current.message).not.toBeNull()
    act(() => result.current.open(result.current.rows[0]))
    expect(result.current.message).toBeNull()
  })

  it('フォルダが切り替わる → 文言を消す', async () => {
    const createFile = vi
      .fn<UseAgentInstructionFilesOptions['createFile']>()
      .mockResolvedValue({ status: 'failed', reason: 'exists' })
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>()
    const { result, rerender } = renderFiles({ createFile, openFile })
    await act(async () => {
      await result.current.create(result.current.rows[0])
    })
    expect(result.current.message).not.toBeNull()
    rerender({ folderPath: '/q', fileTree: [], cliKind: 'claude', createFile, openFile })
    expect(result.current.message).toBeNull()
  })

  it('失敗の文言の後に CLI を切り替える → 文言を消す', async () => {
    const createFile = vi
      .fn<UseAgentInstructionFilesOptions['createFile']>()
      .mockResolvedValue({ status: 'failed', reason: 'exists' })
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>()
    const { result, rerender } = renderFiles({ createFile, openFile })
    await act(async () => {
      await result.current.create(result.current.rows[0])
    })
    expect(result.current.message).not.toBeNull()
    rerender({ folderPath: '/p', fileTree: [], cliKind: 'copilot', createFile, openFile })
    expect(result.current.message).toBeNull()
  })

  it.each<[string, AgentInstructionCreateOutcome]>([
    ['作成の成功', { status: 'created', tree: [claudeNode] }],
    ['作成の失敗', { status: 'failed', reason: 'exists' }],
    ['開けなかった', { status: 'created', tree: null }]
  ])(
    '作成の結果を待つ間にフォルダが切り替わる(%s) → 前のフォルダのノードを開かず、文言も出さない',
    async (_label, outcome) => {
      let resolveCreate: (value: AgentInstructionCreateOutcome) => void = () => {}
      const createFile = vi.fn<UseAgentInstructionFilesOptions['createFile']>(
        () => new Promise((resolve) => (resolveCreate = resolve))
      )
      const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
      const { result, rerender } = renderFiles({ createFile, openFile })
      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current.create(result.current.rows[0])
      })
      rerender({ folderPath: '/q', fileTree: [], cliKind: 'claude', createFile, openFile })
      await act(async () => {
        resolveCreate(outcome)
        await pending
      })
      expect(openFile).not.toHaveBeenCalled()
      expect(result.current.message).toBeNull()
      expect(result.current.isCreating).toBe(false)
    }
  )

  it.each<[string, AgentInstructionCreateOutcome, boolean]>([
    ['作成の失敗', { status: 'failed', reason: 'exists' }, false],
    ['開けなかった', { status: 'created', tree: null }, false],
    ['作成の成功', { status: 'created', tree: [claudeNode] }, true]
  ])(
    '作成の結果を待つ間に CLI が切り替わる(%s) → 切り替え先の節に文言を出さない。作れたファイルは開く',
    async (_label, outcome, opens) => {
      let resolveCreate: (value: AgentInstructionCreateOutcome) => void = () => {}
      const createFile = vi.fn<UseAgentInstructionFilesOptions['createFile']>(
        () => new Promise((resolve) => (resolveCreate = resolve))
      )
      const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
      const { result, rerender } = renderFiles({ createFile, openFile })
      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current.create(result.current.rows[0])
      })
      rerender({ folderPath: '/p', fileTree: [], cliKind: 'copilot', createFile, openFile })
      await act(async () => {
        resolveCreate(outcome)
        await pending
      })
      expect(result.current.message).toBeNull()
      expect(openFile).toHaveBeenCalledTimes(opens ? 1 : 0)
    }
  )

  it('createFile が拒否 → failed の文言を出し、作成中を戻す', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const createFile = vi
        .fn<UseAgentInstructionFilesOptions['createFile']>()
        .mockRejectedValue(new Error('boom'))
      const { result } = renderFiles({ createFile })
      await act(async () => {
        await result.current.create(result.current.rows[0])
      })
      expect(result.current.message).toBe(agentInstructionCreateFailureMessage('failed'))
      expect(result.current.isCreating).toBe(false)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})
