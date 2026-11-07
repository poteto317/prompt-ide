import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileTreeNode } from '@shared/types'

// jsdom では xterm を開けないため、App.agentReferences.test.tsx と同じく偽の controller にする
vi.mock('../../lib/xtermFactory', async () => {
  const { makeFakeAgentSessionTabs } = await import('../../__tests__/makeFakeAgentSessionTabs')
  const tabs = makeFakeAgentSessionTabs()
  return { getAgentSessionTabs: () => tabs }
})

import App from '../../App'

// App → useAppState(useAgentInstructionFiles)→ Sidebar → ExplorerPanel → 節、の配線を、作成から開くまでで確かめる
const before: FileTreeNode[] = [{ name: 'notes.md', path: '/p/notes.md', type: 'file' }]
const after: FileTreeNode[] = [{ name: 'CLAUDE.md', path: '/p/CLAUDE.md', type: 'file' }, ...before]

describe('App: 指示ファイルの配線', () => {
  const original = { ...window.api }

  beforeEach(() => {
    window.api.openFolder = vi.fn().mockResolvedValue('/p')
    // 作成が呼ばれた後だけ CLAUDE.md を含むツリーを返す(読み込みの回数に頼らない)
    window.api.readDirectory = vi.fn(async () =>
      vi.mocked(window.api.createAgentInstructionFile).mock.calls.length > 0 ? after : before
    )
    window.api.readFile = vi.fn().mockResolvedValue('# プロジェクトの指示\n')
    window.api.createAgentInstructionFile = vi.fn().mockResolvedValue({ ok: true })
    window.api.getGlobalAgentInstructionStatus = vi
      .fn()
      .mockResolvedValue({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
    window.api.createGlobalAgentInstructionFile = vi.fn().mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    Object.assign(window.api, original)
  })

  it('作成 → main へ開いているフォルダと claude の id を送り、作ったファイルをタブで開く', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await userEvent.click(await screen.findByRole('button', { name: 'CLAUDE.md を作成' }))
    expect(window.api.createAgentInstructionFile).toHaveBeenCalledWith(
      '/p',
      'claude',
      'claude-root'
    )
    await waitFor(() => expect(window.api.readFile).toHaveBeenCalledWith('/p/CLAUDE.md'))
    expect(await screen.findByRole('button', { name: 'CLAUDE.md を開く' })).toBeInTheDocument()
  })

  it('作成の失敗 → 節に文言を出し、エクスプローラーの上部のエラーには出さない', async () => {
    window.api.createAgentInstructionFile = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'exists' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await userEvent.click(await screen.findByRole('button', { name: 'CLAUDE.md を作成' }))
    const section = screen.getByRole('region', { name: 'エージェントの指示ファイル(Claude Code)' })
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      '同じ名前のファイルかフォルダが既にあります'
    )
    expect(
      screen.queryByText(/指示ファイルを作成できませんでした|Error invoking/)
    ).not.toBeInTheDocument()
    expect(window.api.readFile).not.toHaveBeenCalled()
  })

  it('exists で失敗 → ツリーを読み直し、外で作られたファイルの行が 開く に変わる', async () => {
    window.api.createAgentInstructionFile = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'exists' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await userEvent.click(await screen.findByRole('button', { name: 'CLAUDE.md を作成' }))
    expect(await screen.findByRole('button', { name: 'CLAUDE.md を開く' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'CLAUDE.md を作成' })).not.toBeInTheDocument()
  })

  it('サブフォルダの CLAUDE.md → 開閉のボタンを開いて 開く を押すとそのファイルを読む', async () => {
    const withSub: FileTreeNode[] = [
      {
        name: 'src',
        path: '/p/src',
        type: 'directory',
        children: [{ name: 'CLAUDE.md', path: '/p/src/CLAUDE.md', type: 'file' }]
      },
      ...before
    ]
    window.api.readDirectory = vi.fn().mockResolvedValue(withSub)
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await userEvent.click(await screen.findByRole('button', { name: 'サブフォルダ(1 件)' }))
    await userEvent.click(screen.getByRole('button', { name: 'src/CLAUDE.md を開く' }))
    await waitFor(() => expect(window.api.readFile).toHaveBeenCalledWith('/p/src/CLAUDE.md'))
  })

  it('更新 → ツリーを読み直し、外で足したサブフォルダのファイルとこのフォルダの行が新しくなる', async () => {
    const added: FileTreeNode[] = [
      { name: 'CLAUDE.md', path: '/p/CLAUDE.md', type: 'file' },
      {
        name: 'src',
        path: '/p/src',
        type: 'directory',
        children: [{ name: 'CLAUDE.md', path: '/p/src/CLAUDE.md', type: 'file' }]
      },
      ...before
    ]
    // 読み込みの回数に頼らず、フォルダを開いた後に外で足したことにする
    let tree = before
    window.api.readDirectory = vi.fn(async () => tree)
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    expect(await screen.findByRole('button', { name: 'サブフォルダ(0 件)' })).toBeInTheDocument()
    tree = added
    const refreshButton = screen.getByRole('button', { name: '指示ファイルの一覧を更新' })
    await userEvent.click(refreshButton)
    expect(await screen.findByRole('button', { name: 'サブフォルダ(1 件)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CLAUDE.md を開く' })).toBeInTheDocument()
    // 読み直しの後もフォーカスは押した `更新` に残る(body に落ちない)
    expect(document.activeElement).toBe(refreshButton)
  })

  it('サブフォルダを開いた状態で 更新 → 節は作り直されず、開いたまま', async () => {
    const withSub: FileTreeNode[] = [
      {
        name: 'src',
        path: '/p/src',
        type: 'directory',
        children: [{ name: 'CLAUDE.md', path: '/p/src/CLAUDE.md', type: 'file' }]
      },
      ...before
    ]
    window.api.readDirectory = vi.fn().mockResolvedValue(withSub)
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    const toggle = await screen.findByRole('button', { name: 'サブフォルダ(1 件)' })
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const readsBefore = vi.mocked(window.api.readDirectory).mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: '指示ファイルの一覧を更新' }))
    await waitFor(() =>
      expect(vi.mocked(window.api.readDirectory).mock.calls.length).toBeGreaterThan(readsBefore)
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '指示ファイルの一覧を更新' })).not.toHaveAttribute(
        'aria-disabled'
      )
    )
    expect(screen.getByRole('button', { name: 'サブフォルダ(1 件)' })).toBe(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'src/CLAUDE.md を開く' })).toBeInTheDocument()
  })

  it('更新の失敗 → 節に固定の文言を出し、例外の文言は出さない', async () => {
    let fails = false
    window.api.readDirectory = vi.fn(async () => {
      if (fails) throw new Error('EACCES: /p/secret')
      return before
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(<App />)
      await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
      const refreshButton = await screen.findByRole('button', { name: '指示ファイルの一覧を更新' })
      fails = true
      await userEvent.click(refreshButton)
      const section = screen.getByRole('region', {
        name: 'エージェントの指示ファイル(Claude Code)'
      })
      expect(await within(section).findByRole('alert')).toHaveTextContent(
        'ファイルツリーを読み直せませんでした'
      )
      expect(screen.queryByText(/EACCES/)).not.toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('全体の指示ファイルが exists → 開く を押すとそのパスで読み、タブの名前が ~/… になる', async () => {
    window.api.getGlobalAgentInstructionStatus = vi.fn().mockResolvedValue({
      kind: 'exists',
      filePath: '/home/u/.claude/CLAUDE.md',
      displayPath: '~/.claude/CLAUDE.md'
    })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await userEvent.click(await screen.findByRole('button', { name: '~/.claude/CLAUDE.md を開く' }))
    await waitFor(() =>
      expect(window.api.readFile).toHaveBeenCalledWith('/home/u/.claude/CLAUDE.md')
    )
    expect(await screen.findByRole('tab', { name: /~\/\.claude\/CLAUDE\.md/ })).toBeInTheDocument()
    expect(screen.queryByText('/home/u/.claude/CLAUDE.md')).not.toBeInTheDocument()
  })

  it('全体の指示ファイルが missing → 作成 を押すと claude で作成を呼ぶ', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await userEvent.click(await screen.findByRole('button', { name: '~/.claude/CLAUDE.md を作成' }))
    expect(window.api.createGlobalAgentInstructionFile).toHaveBeenCalledWith('claude')
  })

  it('更新 → 全体の指示ファイルをもう一度問い合わせる', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await screen.findByRole('button', { name: '~/.claude/CLAUDE.md を作成' })
    const before = vi.mocked(window.api.getGlobalAgentInstructionStatus).mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: '指示ファイルの一覧を更新' }))
    await waitFor(() =>
      expect(
        vi.mocked(window.api.getGlobalAgentInstructionStatus).mock.calls.length
      ).toBeGreaterThan(before)
    )
  })
})
