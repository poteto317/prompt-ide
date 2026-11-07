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
  AGENT_INSTRUCTION_REFRESH_FAILED,
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
    refreshTree: vi.fn<UseAgentInstructionFilesOptions['refreshTree']>().mockResolvedValue(true),
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
      openFile: vi.fn(),
      refreshTree: vi.fn().mockResolvedValue(true)
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
    rerender({
      folderPath: '/q',
      fileTree: [],
      cliKind: 'claude',
      createFile,
      openFile,
      refreshTree: vi.fn().mockResolvedValue(true)
    })
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
    rerender({
      folderPath: '/p',
      fileTree: [],
      cliKind: 'copilot',
      createFile,
      openFile,
      refreshTree: vi.fn().mockResolvedValue(true)
    })
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
      rerender({
        folderPath: '/q',
        fileTree: [],
        cliKind: 'claude',
        createFile,
        openFile,
        refreshTree: vi.fn().mockResolvedValue(true)
      })
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
      rerender({
        folderPath: '/p',
        fileTree: [],
        cliKind: 'copilot',
        createFile,
        openFile,
        refreshTree: vi.fn().mockResolvedValue(true)
      })
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
  describe('サブフォルダ', () => {
    const srcDir = (children: FileTreeNode[]): FileTreeNode => ({
      name: 'src',
      path: '/p/src',
      type: 'directory',
      children
    })
    const srcClaude: FileTreeNode = { name: 'CLAUDE.md', path: '/p/src/CLAUDE.md', type: 'file' }
    const srcAgents: FileTreeNode = { name: 'AGENTS.md', path: '/p/src/AGENTS.md', type: 'file' }

    it('ツリーのサブフォルダの CLAUDE.md → 行と件数に出る。claude の注は無い', () => {
      const { result } = renderFiles({ fileTree: [srcDir([srcClaude])] })
      expect(result.current.subfolderRows).toEqual([
        { relativePath: 'src/CLAUDE.md', description: '共有の指示', node: srcClaude }
      ])
      expect(result.current.subfolderTotal).toBe(1)
      expect(result.current.subfolderNote).toBeNull()
    })

    it('今の表の位置(根の .claude/CLAUDE.md)→ 一覧に出さず、src/CLAUDE.md だけが出る', () => {
      const dotClaude: FileTreeNode = {
        name: '.claude',
        path: '/p/.claude',
        type: 'directory',
        children: [{ name: 'CLAUDE.md', path: '/p/.claude/CLAUDE.md', type: 'file' }]
      }
      const { result } = renderFiles({ fileTree: [dotClaude, srcDir([srcClaude])] })
      expect(result.current.subfolderRows.map((r) => r.relativePath)).toEqual(['src/CLAUDE.md'])
    })

    it('ツリーを差し替える(読み直し)→ 一覧が変わる', () => {
      const props: UseAgentInstructionFilesOptions = {
        folderPath: '/p',
        fileTree: [],
        cliKind: 'claude',
        createFile: vi.fn(),
        openFile: vi.fn(),
        refreshTree: vi.fn().mockResolvedValue(true)
      }
      const { result, rerender } = renderHook((p) => useAgentInstructionFiles(p), {
        initialProps: props
      })
      expect(result.current.subfolderTotal).toBe(0)
      rerender({ ...props, fileTree: [srcDir([srcClaude])] })
      expect(result.current.subfolderRows.map((r) => r.relativePath)).toEqual(['src/CLAUDE.md'])
    })

    it('CLI を copilot に切り替える → AGENTS.md と注に変わる', () => {
      const props: UseAgentInstructionFilesOptions = {
        folderPath: '/p',
        fileTree: [srcDir([srcClaude, srcAgents])],
        cliKind: 'claude',
        createFile: vi.fn(),
        openFile: vi.fn(),
        refreshTree: vi.fn().mockResolvedValue(true)
      }
      const { result, rerender } = renderHook((p) => useAgentInstructionFiles(p), {
        initialProps: props
      })
      rerender({ ...props, cliKind: 'copilot' })
      expect(result.current.subfolderRows.map((r) => r.relativePath)).toEqual(['src/AGENTS.md'])
      expect(result.current.subfolderNote).toContain('AGENTS.md を読まないことがあります')
    })

    it('openSubfolderFile → そのノードで openFile を呼び、失敗の文言を消す', async () => {
      const createFile = vi
        .fn<UseAgentInstructionFilesOptions['createFile']>()
        .mockResolvedValue({ status: 'failed', reason: 'exists' })
      const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
      const { result } = renderFiles({ fileTree: [srcDir([srcClaude])], createFile, openFile })
      await act(async () => {
        await result.current.create(result.current.rows[1])
      })
      expect(result.current.message).not.toBeNull()
      act(() => result.current.openSubfolderFile(result.current.subfolderRows[0]))
      expect(openFile).toHaveBeenCalledWith(srcClaude)
      expect(result.current.message).toBeNull()
    })

    it('作成の途中の openSubfolderFile → openFile を呼ばない', async () => {
      let resolveCreate: (outcome: AgentInstructionCreateOutcome) => void = () => undefined
      const createFile = vi.fn<UseAgentInstructionFilesOptions['createFile']>(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve
          })
      )
      const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
      const { result } = renderFiles({ fileTree: [srcDir([srcClaude])], createFile, openFile })
      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current.create(result.current.rows[1])
      })
      act(() => result.current.openSubfolderFile(result.current.subfolderRows[0]))
      expect(openFile).not.toHaveBeenCalled()
      await act(async () => {
        resolveCreate({ status: 'skipped' })
        await pending
      })
    })
  })
  describe('refresh', () => {
    it('refreshTree を 1 回呼び、待つ間は isRefreshing。2 回目は呼ばない', async () => {
      let resolveRefresh: (applied: boolean) => void = () => undefined
      const refreshTree = vi.fn<UseAgentInstructionFilesOptions['refreshTree']>(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve
          })
      )
      const { result } = renderFiles({ refreshTree })
      let first: Promise<void> = Promise.resolve()
      let second: Promise<void> = Promise.resolve()
      act(() => {
        first = result.current.refresh()
        // 同じ tick の 2 回目も止める(state の反映を待たない。L-653)
        second = result.current.refresh()
      })
      expect(result.current.isRefreshing).toBe(true)
      expect(refreshTree).toHaveBeenCalledTimes(1)
      await act(async () => {
        resolveRefresh(true)
        await first
        await second
      })
      expect(result.current.isRefreshing).toBe(false)
      expect(result.current.message).toBeNull()
    })

    it('1 回目が解決した後の 2 回目も効く(refreshTree が 2 回呼ばれる)', async () => {
      const refreshTree = vi
        .fn<UseAgentInstructionFilesOptions['refreshTree']>()
        .mockResolvedValue(true)
      const { result } = renderFiles({ refreshTree })
      await act(async () => {
        await result.current.refresh()
      })
      await act(async () => {
        await result.current.refresh()
      })
      expect(refreshTree).toHaveBeenCalledTimes(2)
    })

    it('1 回目が拒否された後の 2 回目も効く(refreshTree が 2 回呼ばれる)', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const refreshTree = vi
          .fn<UseAgentInstructionFilesOptions['refreshTree']>()
          .mockRejectedValue(new Error('boom'))
        const { result } = renderFiles({ refreshTree })
        await act(async () => {
          await result.current.refresh()
        })
        await act(async () => {
          await result.current.refresh()
        })
        expect(refreshTree).toHaveBeenCalledTimes(2)
      } finally {
        consoleError.mockRestore()
      }
    })

    it('作成の途中 → refreshTree を呼ばない', async () => {
      let resolveCreate: (outcome: AgentInstructionCreateOutcome) => void = () => undefined
      const createFile = vi.fn<UseAgentInstructionFilesOptions['createFile']>(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve
          })
      )
      const refreshTree = vi
        .fn<UseAgentInstructionFilesOptions['refreshTree']>()
        .mockResolvedValue(true)
      const { result } = renderFiles({ createFile, refreshTree })
      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current.create(result.current.rows[0])
      })
      await act(async () => {
        await result.current.refresh()
      })
      expect(refreshTree).not.toHaveBeenCalled()
      await act(async () => {
        resolveCreate({ status: 'skipped' })
        await pending
      })
    })

    it('押す → 前の失敗の文言を消す', async () => {
      const createFile = vi
        .fn<UseAgentInstructionFilesOptions['createFile']>()
        .mockResolvedValue({ status: 'failed', reason: 'exists' })
      const { result } = renderFiles({ createFile })
      await act(async () => {
        await result.current.create(result.current.rows[0])
      })
      expect(result.current.message).not.toBeNull()
      await act(async () => {
        await result.current.refresh()
      })
      expect(result.current.message).toBeNull()
    })

    it('refreshTree が拒否する → 固定の文言を出し、例外の文言は出さない。refresh は拒否しない', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const refreshTree = vi
          .fn<UseAgentInstructionFilesOptions['refreshTree']>()
          .mockRejectedValue(new Error('ENOENT: /secret/path'))
        const { result } = renderFiles({ refreshTree })
        await act(async () => {
          await result.current.refresh()
        })
        expect(result.current.message).toBe(AGENT_INSTRUCTION_REFRESH_FAILED)
        expect(result.current.message).not.toContain('/secret/path')
        expect(result.current.isRefreshing).toBe(false)
        expect(consoleError).toHaveBeenCalled()
      } finally {
        consoleError.mockRestore()
      }
    })

    it('refreshTree が false(反映しなかった)→ 文言を出さない', async () => {
      const refreshTree = vi
        .fn<UseAgentInstructionFilesOptions['refreshTree']>()
        .mockResolvedValue(false)
      const { result } = renderFiles({ refreshTree })
      await act(async () => {
        await result.current.refresh()
      })
      expect(result.current.message).toBeNull()
    })

    it.each<[string, Partial<UseAgentInstructionFilesOptions>]>([
      ['フォルダ', { folderPath: '/q' }],
      ['CLI の種類', { cliKind: 'copilot' }]
    ])('待つ間に%sが切り替わってから拒否される → 文言を出さない', async (_label, change) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        let rejectRefresh: (err: Error) => void = () => undefined
        const refreshTree = vi.fn<UseAgentInstructionFilesOptions['refreshTree']>(
          () =>
            new Promise((_resolve, reject) => {
              rejectRefresh = reject
            })
        )
        const props: UseAgentInstructionFilesOptions = {
          folderPath: '/p',
          fileTree: [],
          cliKind: 'claude',
          createFile: vi.fn(),
          openFile: vi.fn(),
          refreshTree
        }
        const { result, rerender } = renderHook((p) => useAgentInstructionFiles(p), {
          initialProps: props
        })
        let pending: Promise<void> = Promise.resolve()
        act(() => {
          pending = result.current.refresh()
        })
        rerender({ ...props, ...change })
        await act(async () => {
          rejectRefresh(new Error('failed'))
          await pending
        })
        expect(result.current.message).toBeNull()
        expect(result.current.isRefreshing).toBe(false)
      } finally {
        consoleError.mockRestore()
      }
    })
  })
})
