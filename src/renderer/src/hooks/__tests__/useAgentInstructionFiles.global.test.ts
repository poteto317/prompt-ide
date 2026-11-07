import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { useAgentInstructionFiles } from '../useAgentInstructionFiles'
import type { UseAgentInstructionFilesOptions } from '../useAgentInstructionFiles'
import { renderAgentInstructionFiles as renderFiles } from '../../__tests__/renderAgentInstructionFiles'
import type { GlobalAgentInstructionStatus } from '@shared/types'
import {
  AGENT_GLOBAL_INSTRUCTION_OPEN_AFTER_CREATE_FAILED,
  agentGlobalInstructionCreateFailureMessage
} from '../../lib/agentInstructionMessages'

const existsStatus: GlobalAgentInstructionStatus = {
  kind: 'exists',
  filePath: '/home/u/.claude/CLAUDE.md',
  displayPath: '~/.claude/CLAUDE.md'
}
const globalNode = { type: 'file', name: '~/.claude/CLAUDE.md', path: '/home/u/.claude/CLAUDE.md' }

/** 解決を外から決められる Promise(古い問い合わせを遅れて解決させる) */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('useAgentInstructionFiles(全体の指示ファイル)', () => {
  // console.error の spy を後のテストに残さない
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('マウント時に問い合わせ → 結果が出るまで loading、出たら行になる', async () => {
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockResolvedValue(existsStatus)
    const { result } = renderFiles({ getGlobalStatus })
    expect(result.current.globalRow).toEqual({ kind: 'loading' })
    await act(async () => {})
    expect(getGlobalStatus).toHaveBeenCalledWith('claude')
    expect(result.current.globalRow).toMatchObject({ kind: 'exists', node: globalNode })
  })

  it('フォルダを変える → 問い合わせ直す', async () => {
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockResolvedValue(existsStatus)
    const props: UseAgentInstructionFilesOptions = {
      folderPath: '/p',
      fileTree: [],
      cliKind: 'claude',
      createFile: vi.fn(),
      openFile: vi.fn(),
      refreshTree: vi.fn().mockResolvedValue(true),
      getGlobalStatus,
      createGlobalFile: vi.fn()
    }
    const { rerender } = renderHook(
      (p: UseAgentInstructionFilesOptions) => useAgentInstructionFiles(p),
      {
        initialProps: props
      }
    )
    await act(async () => {})
    getGlobalStatus.mockClear()
    rerender({ ...props, folderPath: '/q' })
    await act(async () => {})
    expect(getGlobalStatus).toHaveBeenCalledTimes(1)
  })

  it('前の CLI の結果が出た後に CLI を切り替える → 問い合わせの結果が出るまで前の CLI の行を出さず loading', async () => {
    const copilot = deferred<GlobalAgentInstructionStatus>()
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockResolvedValueOnce(existsStatus)
      .mockReturnValueOnce(copilot.promise)
    const props: UseAgentInstructionFilesOptions = {
      folderPath: '/p',
      fileTree: [],
      cliKind: 'claude',
      createFile: vi.fn(),
      openFile: vi.fn(),
      refreshTree: vi.fn().mockResolvedValue(true),
      getGlobalStatus,
      createGlobalFile: vi.fn()
    }
    const { result, rerender } = renderHook(
      (p: UseAgentInstructionFilesOptions) => useAgentInstructionFiles(p),
      { initialProps: props }
    )
    await act(async () => {})
    expect(result.current.globalRow).toMatchObject({ kind: 'exists' })
    rerender({ ...props, cliKind: 'copilot' })
    expect(result.current.globalRow).toEqual({ kind: 'loading' })
    await act(async () => {
      copilot.resolve({ kind: 'missing', displayPath: '~/.copilot/copilot-instructions.md' })
    })
    expect(result.current.globalRow).toMatchObject({
      kind: 'missing',
      displayPath: '~/.copilot/copilot-instructions.md'
    })
  })

  it('CLI を切り替える → loading になり、古い問い合わせの結果を反映しない', async () => {
    const first = deferred<GlobalAgentInstructionStatus>()
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ kind: 'missing', displayPath: '~/.copilot/copilot-instructions.md' })
    const base = {
      folderPath: '/p',
      fileTree: [],
      createFile: vi.fn(),
      openFile: vi.fn(),
      refreshTree: vi.fn().mockResolvedValue(true),
      getGlobalStatus,
      createGlobalFile: vi.fn()
    }
    const { result, rerender } = renderHook(
      (props: UseAgentInstructionFilesOptions) => useAgentInstructionFiles(props),
      {
        initialProps: { ...base, cliKind: 'claude' as AgentCliKind }
      }
    )
    rerender({ ...base, cliKind: 'copilot' as AgentCliKind })
    // 切り替えた直後(問い合わせの結果が出る前)は、前の CLI の行を出さずに loading
    expect(result.current.globalRow).toEqual({ kind: 'loading' })
    await act(async () => {})
    expect(result.current.globalRow).toMatchObject({
      kind: 'missing',
      displayPath: '~/.copilot/copilot-instructions.md'
    })
    await act(async () => {
      first.resolve(existsStatus)
    })
    expect(result.current.globalRow).toMatchObject({
      kind: 'missing',
      displayPath: '~/.copilot/copilot-instructions.md'
    })
  })

  it('CLI が同じまま、古い問い合わせが後から解決 → 新しい結果のまま(世代で捨てる)', async () => {
    const first = deferred<GlobalAgentInstructionStatus>()
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
    const props: UseAgentInstructionFilesOptions = {
      folderPath: '/p',
      fileTree: [],
      cliKind: 'claude',
      createFile: vi.fn(),
      openFile: vi.fn(),
      refreshTree: vi.fn().mockResolvedValue(true),
      getGlobalStatus,
      createGlobalFile: vi.fn()
    }
    const { result, rerender } = renderHook(
      (p: UseAgentInstructionFilesOptions) => useAgentInstructionFiles(p),
      {
        initialProps: props
      }
    )
    // マウント時の問い合わせ(first)が終わる前に、フォルダを変えて問い合わせ直す(missing)
    rerender({ ...props, folderPath: '/q' })
    await act(async () => {})
    expect(result.current.globalRow).toMatchObject({ kind: 'missing' })
    // 古い方(exists)を後から解決しても、missing のまま
    await act(async () => {
      first.resolve(existsStatus)
    })
    expect(result.current.globalRow).toMatchObject({ kind: 'missing' })
  })

  it('問い合わせの拒否 → blocked(確かめられない)で、missing にならない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockRejectedValue(new Error('x'))
    const { result } = renderFiles({ getGlobalStatus })
    await act(async () => {})
    expect(result.current.globalRow).toMatchObject({ kind: 'blocked', displayPath: null })
  })

  it('openGlobal → exists のノードを openFile に渡す', async () => {
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
    const { result } = renderFiles({
      openFile,
      getGlobalStatus: vi
        .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
        .mockResolvedValue(existsStatus)
    })
    await act(async () => {})
    act(() => result.current.openGlobal())
    expect(openFile).toHaveBeenCalledWith(globalNode)
  })

  it('作成の途中に openGlobal → openFile を呼ばない', async () => {
    const pending = deferred<{ ok: false; reason: 'exists' }>()
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
    const { result } = renderFiles({
      openFile,
      getGlobalStatus: vi
        .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
        .mockResolvedValue(existsStatus),
      createGlobalFile: vi
        .fn<UseAgentInstructionFilesOptions['createGlobalFile']>()
        .mockReturnValue(pending.promise)
    })
    await act(async () => {})
    let done!: Promise<void>
    act(() => {
      done = result.current.createGlobal()
    })
    act(() => result.current.openGlobal())
    expect(openFile).not.toHaveBeenCalled()
    await act(async () => {
      pending.resolve({ ok: false, reason: 'exists' })
      await done
    })
  })

  it('createGlobal の成功 → 開始時の CLI で作り、問い合わせ直してから開く', async () => {
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockResolvedValueOnce({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
      .mockResolvedValue(existsStatus)
    const createGlobalFile = vi
      .fn<UseAgentInstructionFilesOptions['createGlobalFile']>()
      .mockResolvedValue({ ok: true })
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
    const { result } = renderFiles({ getGlobalStatus, createGlobalFile, openFile })
    await act(async () => {})
    await act(async () => {
      await result.current.createGlobal()
    })
    expect(createGlobalFile).toHaveBeenCalledWith('claude')
    expect(openFile).toHaveBeenCalledWith(globalNode)
    expect(result.current.globalRow).toMatchObject({ kind: 'exists' })
    expect(result.current.isCreating).toBe(false)
  })

  it('createGlobal の後も exists でない → 開けない文言', async () => {
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockResolvedValue({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>()
    const { result } = renderFiles({ getGlobalStatus, openFile })
    await act(async () => {})
    await act(async () => {
      await result.current.createGlobal()
    })
    expect(openFile).not.toHaveBeenCalled()
    expect(result.current.message).toBe(AGENT_GLOBAL_INSTRUCTION_OPEN_AFTER_CREATE_FAILED)
  })

  it.each(['exists', 'outside', 'failed', 'unavailable'] as const)(
    'createGlobal の失敗(%s) → 理由の文言を出し、問い合わせ直す',
    async (reason) => {
      const getGlobalStatus = vi
        .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
        .mockResolvedValue({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
      const { result } = renderFiles({
        getGlobalStatus,
        createGlobalFile: vi
          .fn<UseAgentInstructionFilesOptions['createGlobalFile']>()
          .mockResolvedValue({ ok: false, reason })
      })
      await act(async () => {})
      getGlobalStatus.mockClear()
      await act(async () => {
        await result.current.createGlobal()
      })
      expect(result.current.message).toBe(agentGlobalInstructionCreateFailureMessage(reason))
      expect(getGlobalStatus).toHaveBeenCalledTimes(1)
    }
  )

  it('createGlobal の IPC の拒否 → failed の文言', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result } = renderFiles({
      createGlobalFile: vi
        .fn<UseAgentInstructionFilesOptions['createGlobalFile']>()
        .mockRejectedValue(new Error('/secret'))
    })
    await act(async () => {})
    await act(async () => {
      await result.current.createGlobal()
    })
    expect(result.current.message).toBe(agentGlobalInstructionCreateFailureMessage('failed'))
    expect(console.error).toHaveBeenCalled()
  })

  it('createGlobal で作れたあと openFile が拒否 → 開けない文言を出し、hook は拒否で返らない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockResolvedValueOnce({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
      .mockResolvedValue(existsStatus)
    const openFile = vi
      .fn<UseAgentInstructionFilesOptions['openFile']>()
      .mockRejectedValue(new Error('/secret'))
    const { result } = renderFiles({
      getGlobalStatus,
      openFile,
      createGlobalFile: vi
        .fn<UseAgentInstructionFilesOptions['createGlobalFile']>()
        .mockResolvedValue({ ok: true })
    })
    await act(async () => {})
    await act(async () => {
      await expect(result.current.createGlobal()).resolves.toBeUndefined()
    })
    expect(openFile).toHaveBeenCalledWith(globalNode)
    expect(result.current.message).toBe(AGENT_GLOBAL_INSTRUCTION_OPEN_AFTER_CREATE_FAILED)
    expect(result.current.isCreating).toBe(false)
    expect(console.error).toHaveBeenCalled()
  })

  it('createGlobal で作れたあと getGlobalStatus が拒否 → 開けない文言を出し、開かず、hook は拒否で返らない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockResolvedValueOnce({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
      .mockRejectedValue(new Error('/secret'))
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>()
    const { result } = renderFiles({
      getGlobalStatus,
      openFile,
      createGlobalFile: vi
        .fn<UseAgentInstructionFilesOptions['createGlobalFile']>()
        .mockResolvedValue({ ok: true })
    })
    await act(async () => {})
    await act(async () => {
      await expect(result.current.createGlobal()).resolves.toBeUndefined()
    })
    expect(openFile).not.toHaveBeenCalled()
    expect(result.current.message).toBe(AGENT_GLOBAL_INSTRUCTION_OPEN_AFTER_CREATE_FAILED)
    expect(result.current.globalRow).toMatchObject({ kind: 'blocked' })
    expect(result.current.isCreating).toBe(false)
    expect(console.error).toHaveBeenCalled()
  })

  it.each([
    ['フォルダ', { folderPath: '/q' }],
    ['CLI', { cliKind: 'copilot' as const }]
  ])('createGlobal の失敗(exists)を待つ間に%sを変える → 文言を出さない', async (_name, change) => {
    const pending = deferred<{ ok: false; reason: 'exists' }>()
    const props: UseAgentInstructionFilesOptions = {
      folderPath: '/p',
      fileTree: [],
      cliKind: 'claude',
      createFile: vi.fn(),
      openFile: vi.fn(),
      refreshTree: vi.fn().mockResolvedValue(true),
      getGlobalStatus: vi
        .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
        .mockResolvedValue({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' }),
      createGlobalFile: vi
        .fn<UseAgentInstructionFilesOptions['createGlobalFile']>()
        .mockReturnValue(pending.promise)
    }
    const { result, rerender } = renderHook(
      (p: UseAgentInstructionFilesOptions) => useAgentInstructionFiles(p),
      { initialProps: props }
    )
    await act(async () => {})
    let done!: Promise<void>
    act(() => {
      done = result.current.createGlobal()
    })
    rerender({ ...props, ...change })
    await act(async () => {
      pending.resolve({ ok: false, reason: 'exists' })
      await done
    })
    expect(result.current.message).toBeNull()
  })

  it.each([
    [
      'openFile の拒否',
      (getGlobalStatus: ReturnType<typeof vi.fn>, gate: { promise: Promise<unknown> }) => {
        getGlobalStatus.mockResolvedValueOnce({
          kind: 'missing',
          displayPath: '~/.claude/CLAUDE.md'
        })
        getGlobalStatus.mockResolvedValue(existsStatus)
        return { openFile: vi.fn().mockReturnValue(gate.promise) }
      }
    ],
    [
      '作成後の問い合わせ',
      (getGlobalStatus: ReturnType<typeof vi.fn>, gate: { promise: Promise<unknown> }) => {
        getGlobalStatus.mockResolvedValueOnce({
          kind: 'missing',
          displayPath: '~/.claude/CLAUDE.md'
        })
        getGlobalStatus.mockImplementation((kind: AgentCliKind) =>
          kind === 'claude'
            ? gate.promise
            : Promise.resolve({
                kind: 'missing',
                displayPath: '~/.copilot/copilot-instructions.md'
              })
        )
        return { openFile: vi.fn() }
      }
    ]
  ])(
    'createGlobal の作成のあと(%s)を待つ間に CLI を変える → 文言を出さない',
    async (name, setup) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const gate = deferred<unknown>()
      let reject!: (e: unknown) => void
      const rejecting = new Promise<unknown>((_, r) => {
        reject = r
      })
      // 保留の Promise: 拒否で決着させるのは openFile の場合、missing で決着させるのは問い合わせの場合
      const isOpen = name === 'openFile の拒否'
      const gatePromise = isOpen ? rejecting : gate.promise
      const getGlobalStatus = vi.fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      const { openFile } = setup(getGlobalStatus as never, { promise: gatePromise })
      const props: UseAgentInstructionFilesOptions = {
        folderPath: '/p',
        fileTree: [],
        cliKind: 'claude',
        createFile: vi.fn(),
        openFile,
        refreshTree: vi.fn().mockResolvedValue(true),
        getGlobalStatus,
        createGlobalFile: vi
          .fn<UseAgentInstructionFilesOptions['createGlobalFile']>()
          .mockResolvedValue({ ok: true })
      }
      const { result, rerender } = renderHook(
        (p: UseAgentInstructionFilesOptions) => useAgentInstructionFiles(p),
        { initialProps: props }
      )
      await act(async () => {})
      let done!: Promise<void>
      act(() => {
        done = result.current.createGlobal()
      })
      // 保留の呼び出しまで進める
      await act(async () => {})
      rerender({ ...props, cliKind: 'copilot' })
      await act(async () => {
        if (isOpen) reject(new Error('/secret'))
        else gate.resolve({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
        await done
      })
      expect(result.current.message).toBeNull()
      // 名前の経路を通ったことも確かめる(openFile の拒否は開こうとした、問い合わせは exists でないので開かない)
      if (isOpen) expect(openFile).toHaveBeenCalledTimes(1)
      else expect(openFile).not.toHaveBeenCalled()
    }
  )

  it('createGlobal を同じ tick で 2 回 → 作成は 1 回', async () => {
    const createGlobalFile = vi
      .fn<UseAgentInstructionFilesOptions['createGlobalFile']>()
      .mockResolvedValue({ ok: true })
    const { result } = renderFiles({ createGlobalFile })
    await act(async () => {})
    await act(async () => {
      await Promise.all([result.current.createGlobal(), result.current.createGlobal()])
    })
    expect(createGlobalFile).toHaveBeenCalledTimes(1)
  })

  it('createGlobal を待つ間にフォルダを変える → 開かず、文言も出さない', async () => {
    const pending = deferred<{ ok: true }>()
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>()
    const props: UseAgentInstructionFilesOptions = {
      folderPath: '/p',
      fileTree: [],
      cliKind: 'claude',
      createFile: vi.fn(),
      openFile,
      refreshTree: vi.fn().mockResolvedValue(true),
      getGlobalStatus: vi
        .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
        .mockResolvedValue(existsStatus),
      createGlobalFile: vi
        .fn<UseAgentInstructionFilesOptions['createGlobalFile']>()
        .mockReturnValue(pending.promise)
    }
    const { result, rerender } = renderHook(
      (p: UseAgentInstructionFilesOptions) => useAgentInstructionFiles(p),
      {
        initialProps: props
      }
    )
    await act(async () => {})
    let done!: Promise<void>
    act(() => {
      done = result.current.createGlobal()
    })
    rerender({ ...props, folderPath: '/q' })
    await act(async () => {
      pending.resolve({ ok: true })
      await done
    })
    expect(openFile).not.toHaveBeenCalled()
    expect(result.current.message).toBeNull()
  })

  it('createGlobal を待つ間に CLI だけを変える → 開始時の CLI で問い合わせて開き、文言は出さない', async () => {
    const pending = deferred<{ ok: true }>()
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockImplementation(async (kind) =>
        kind === 'claude'
          ? existsStatus
          : { kind: 'missing', displayPath: '~/.copilot/copilot-instructions.md' }
      )
    const props: UseAgentInstructionFilesOptions = {
      folderPath: '/p',
      fileTree: [],
      cliKind: 'claude',
      createFile: vi.fn(),
      openFile,
      refreshTree: vi.fn().mockResolvedValue(true),
      getGlobalStatus,
      createGlobalFile: vi
        .fn<UseAgentInstructionFilesOptions['createGlobalFile']>()
        .mockReturnValue(pending.promise)
    }
    const { result, rerender } = renderHook(
      (p: UseAgentInstructionFilesOptions) => useAgentInstructionFiles(p),
      {
        initialProps: props
      }
    )
    await act(async () => {})
    let done!: Promise<void>
    act(() => {
      done = result.current.createGlobal()
    })
    rerender({ ...props, cliKind: 'copilot' })
    await act(async () => {
      pending.resolve({ ok: true })
      await done
    })
    expect(openFile).toHaveBeenCalledWith(globalNode)
    expect(result.current.message).toBeNull()
  })

  it('refresh → refreshTree と問い合わせの両方を呼び、両方が終わるまで isRefreshing', async () => {
    const status = deferred<GlobalAgentInstructionStatus>()
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockResolvedValueOnce({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
      .mockReturnValueOnce(status.promise)
    const refreshTree = vi
      .fn<UseAgentInstructionFilesOptions['refreshTree']>()
      .mockResolvedValue(true)
    const { result } = renderFiles({ getGlobalStatus, refreshTree })
    await act(async () => {})
    let done!: Promise<void>
    act(() => {
      done = result.current.refresh()
    })
    await act(async () => {})
    expect(refreshTree).toHaveBeenCalledTimes(1)
    expect(result.current.isRefreshing).toBe(true)
    await act(async () => {
      status.resolve(existsStatus)
      await done
    })
    expect(result.current.isRefreshing).toBe(false)
    expect(result.current.globalRow).toMatchObject({ kind: 'exists' })
  })

  it('refresh で問い合わせだけが拒否 → 失敗の文言の枠には何も出さない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockResolvedValueOnce({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
      .mockRejectedValueOnce(new Error('x'))
    const { result } = renderFiles({ getGlobalStatus })
    await act(async () => {})
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.message).toBeNull()
    expect(result.current.globalRow).toMatchObject({ kind: 'blocked' })
  })
})
