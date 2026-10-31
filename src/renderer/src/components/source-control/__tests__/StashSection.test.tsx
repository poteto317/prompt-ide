import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { StashPanelState } from '../../../types'
import StashSection from '../StashSection'

const makeStash = (overrides: Partial<StashPanelState> = {}): StashPanelState => ({
  entries: [],
  pendingOperation: null,
  error: null,
  onPush: vi.fn().mockResolvedValue(undefined),
  onPop: vi.fn().mockResolvedValue(undefined),
  onDrop: vi.fn().mockResolvedValue(true),
  ...overrides
})
const e1 = {
  sha: 'a'.repeat(40),
  message: 'first',
  branch: 'main',
  createdAt: '2026-10-01T10:00:00+09:00'
}
const e2 = {
  sha: 'b'.repeat(40),
  message: 'second',
  branch: 'dev',
  createdAt: '2026-09-30T10:00:00+09:00'
}

describe('StashSection', () => {
  it('見出しに件数を出す', () => {
    render(<StashSection stash={makeStash({ entries: [e1, e2] })} isBlocked={false} />)
    expect(screen.getByRole('heading', { name: 'stash 2' })).toBeInTheDocument()
  })

  it('0 件のときは件数を出さない', () => {
    render(<StashSection stash={makeStash()} isBlocked={false} />)
    expect(screen.getByRole('heading', { name: 'stash' })).toBeInTheDocument()
  })

  it('「stash する」は見出しの操作の枠に置き、閉じても押せる', async () => {
    render(<StashSection stash={makeStash()} isBlocked={false} />)
    const action = screen.getByRole('button', { name: '変更を stash する' })
    expect(action.parentElement).toHaveClass('collapsible-section__actions')
    await userEvent.click(screen.getByRole('button', { name: 'stash' }))
    expect(action).toBeVisible()
    expect(screen.getByText('stash はありません')).not.toBeVisible()
  })

  it('閉じてもエラーは見える', async () => {
    render(<StashSection stash={makeStash({ error: new Error('失敗') })} isBlocked={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'stash' }))
    expect(screen.getByRole('alert')).toBeVisible()
  })

  it('メッセージの入力ダイアログは section の外に出て、閉じていても見える', async () => {
    render(<StashSection stash={makeStash()} isBlocked={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'stash' }))
    await userEvent.click(screen.getByRole('button', { name: '変更を stash する' }))
    const input = screen.getByRole('textbox')
    expect(input).toBeVisible()
    expect(screen.getByRole('region', { name: 'stash' })).not.toContainElement(input)
  })

  it('0 件のとき「stash はありません」を出す', () => {
    render(<StashSection stash={makeStash()} isBlocked={false} />)
    expect(screen.getByText('stash はありません')).toBeInTheDocument()
  })

  it('各 stash を一覧で表示する(新しい順のまま)', () => {
    render(<StashSection stash={makeStash({ entries: [e1, e2] })} isBlocked={false} />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('first')
    expect(items[1]).toHaveTextContent('second')
  })

  it('「stash する」でメッセージ入力ダイアログを開き、OK で onPush を呼ぶ', async () => {
    const stash = makeStash()
    render(<StashSection stash={stash} isBlocked={false} />)
    await userEvent.click(screen.getByRole('button', { name: '変更を stash する' }))
    await userEvent.type(screen.getByRole('textbox'), 'wip')
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(stash.onPush).toHaveBeenCalledWith('wip')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ダイアログをキャンセルしたら閉じて「stash する」ボタンへフォーカスを戻し、onPush は呼ばない', async () => {
    const stash = makeStash()
    render(<StashSection stash={stash} isBlocked={false} />)
    const button = screen.getByRole('button', { name: '変更を stash する' })
    await userEvent.click(button)
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
    expect(stash.onPush).not.toHaveBeenCalled()
  })

  it('他の操作中(isBlocked)は「stash する」が disabled', () => {
    render(<StashSection stash={makeStash()} isBlocked />)
    expect(screen.getByRole('button', { name: '変更を stash する' })).toBeDisabled()
  })

  it('stash の実行中は「stash 中...」(aria-label は「stash 中」)で disabled', () => {
    render(
      <StashSection
        stash={makeStash({ pendingOperation: { kind: 'push', sha: null } })}
        isBlocked={false}
      />
    )
    const button = screen.getByRole('button', { name: 'stash 中' })
    expect(button).toHaveTextContent('stash 中...')
    expect(button).toBeDisabled()
  })

  it('エラーがあれば role=alert で表示する', () => {
    render(
      <StashSection
        stash={makeStash({ error: new Error('stash する変更がありません') })}
        isBlocked={false}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('stash する変更がありません')
  })

  // 行の key は stash の SHA(番号や表示メッセージは使わない)。同じメッセージの stash が並んでも崩れない
  it('同じメッセージの stash が複数あっても、すべて表示する', () => {
    const dup = { ...e2, message: 'first' }
    // key が重複すると React は console.error で警告するため、警告が出ないことも確認する
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(<StashSection stash={makeStash({ entries: [e1, dup] })} isBlocked={false} />)
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('stash の「戻す」ボタンをクリックすると stash.onPop が SHA で呼ばれる', async () => {
    const stash = makeStash({ entries: [e1] })
    render(<StashSection stash={stash} isBlocked={false} />)
    const popBtn = screen.getByRole('button', { name: `stash ${e1.message} を戻す` })
    await userEvent.click(popBtn)
    expect(stash.onPop).toHaveBeenCalledWith(e1.sha)
  })

  it('stash の「捨てる」ボタンをクリックすると stash.onDrop が entry で呼ばれる', async () => {
    const stash = makeStash({ entries: [e1] })
    render(<StashSection stash={stash} isBlocked={false} />)
    const dropBtn = screen.getByRole('button', { name: `stash ${e1.message} を捨てる` })
    await userEvent.click(dropBtn)
    expect(stash.onDrop).toHaveBeenCalledWith(e1)
  })
})
