import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { GitBranch } from '@shared/types'
import CreateBranchDialog from '../CreateBranchDialog'

const branches: GitBranch[] = [
  { name: 'main', current: true },
  { name: 'feature/x', current: false }
]

describe('CreateBranchDialog', () => {
  it('「新しいブランチ名」というダイアログを表示する', () => {
    render(
      <CreateBranchDialog
        branches={branches}
        isBlocked={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByRole('dialog', { name: '新しいブランチ名' })).toBeInTheDocument()
  })

  it("'/' を含む名前も受け付け、trim した名前で onSubmit を呼ぶ", async () => {
    const onSubmit = vi.fn()
    render(
      <CreateBranchDialog
        branches={branches}
        isBlocked={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    )
    await userEvent.type(screen.getByRole('textbox', { name: '名前' }), '  feature/new  ')
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onSubmit).toHaveBeenCalledWith('feature/new')
  })

  it('initialValue を入力欄の初期値にし、そのまま確定できる', async () => {
    const onSubmit = vi.fn()
    render(
      <CreateBranchDialog
        branches={branches}
        initialValue="feature/new"
        isBlocked={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByRole('textbox', { name: '名前' })).toHaveValue('feature/new')
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onSubmit).toHaveBeenCalledWith('feature/new')
  })

  it('initialValue を省くと入力欄は空', () => {
    render(
      <CreateBranchDialog
        branches={branches}
        isBlocked={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByRole('textbox', { name: '名前' })).toHaveValue('')
  })

  // 規則ごとの文言(空文字・'-' 始まり・'@')は branchNameValidation.test.ts で固定する。
  // ここでは branches から作った既存名の一覧が検証へ渡っていること(配線)だけを見る
  it('既存のブランチ名はダイアログ内でエラーになり onSubmit を呼ばない', async () => {
    const onSubmit = vi.fn()
    render(
      <CreateBranchDialog
        branches={branches}
        isBlocked={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    )
    await userEvent.type(screen.getByRole('textbox', { name: '名前' }), 'feature/x')
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.getByRole('alert')).toHaveTextContent('同じ名前のブランチが既に存在します')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each([
    ['キャンセルボタン', () => userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))],
    ['Escape キー', () => userEvent.keyboard('{Escape}')]
  ])('%s で onCancel が呼ばれる', async (_label, close) => {
    const onCancel = vi.fn()
    render(
      <CreateBranchDialog
        branches={branches}
        isBlocked={false}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />
    )
    await close()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('isBlocked の間は OK を押せず、案内を出す', () => {
    render(
      <CreateBranchDialog branches={branches} isBlocked onSubmit={vi.fn()} onCancel={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('他の操作が完了するまで実行できません')
  })

  // 重複判定は描画時点のブランチ一覧に対して行う(props の更新に追従する)
  it('branches が更新されたら、新しい一覧に対して重複を判定する', async () => {
    const onSubmit = vi.fn()
    const { rerender } = render(
      <CreateBranchDialog
        branches={branches}
        isBlocked={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    )
    rerender(
      <CreateBranchDialog
        branches={[...branches, { name: 'feature/new', current: false }]}
        isBlocked={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    )
    await userEvent.type(screen.getByRole('textbox', { name: '名前' }), 'feature/new')
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.getByRole('alert')).toHaveTextContent('同じ名前のブランチが既に存在します')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
