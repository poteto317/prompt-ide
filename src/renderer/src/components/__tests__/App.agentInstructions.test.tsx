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
})
