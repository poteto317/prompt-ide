import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import NameInputDialog from '../NameInputDialog'

const defaultProps = {
  title: '新規ファイル',
  onSubmit: vi.fn(),
  onCancel: vi.fn()
}

describe('NameInputDialog', () => {
  it('タイトルと入力欄が表示される', () => {
    render(<NameInputDialog {...defaultProps} />)
    expect(screen.getByRole('dialog', { name: '新規ファイル' })).toBeInTheDocument()
    expect(screen.getByLabelText('名前')).toBeInTheDocument()
  })

  it('inputLabel を渡すと、入力欄をその名前で取得できる', () => {
    render(<NameInputDialog {...defaultProps} inputLabel="退避のメッセージ" />)
    expect(screen.getByRole('textbox', { name: '退避のメッセージ' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '名前' })).not.toBeInTheDocument()
  })

  it('inputLabel を渡さなければ、入力欄の名前は「名前」', () => {
    render(<NameInputDialog {...defaultProps} />)
    expect(screen.getByRole('textbox', { name: '名前' })).toBeInTheDocument()
  })

  it('initialValue が入力欄の初期値になる', () => {
    render(<NameInputDialog {...defaultProps} initialValue="old.ts" />)
    expect((screen.getByLabelText('名前') as HTMLInputElement).value).toBe('old.ts')
  })

  it('名前を入力して OK で trim 済みの値が onSubmit に渡される', async () => {
    const onSubmit = vi.fn()
    render(<NameInputDialog {...defaultProps} onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('名前'), '  new.ts  ')
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onSubmit).toHaveBeenCalledWith('new.ts')
  })

  it('Enter キーでも submit される', async () => {
    const onSubmit = vi.fn()
    render(<NameInputDialog {...defaultProps} onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('名前'), 'new.ts{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('new.ts')
  })

  it('空の名前はエラーを表示し onSubmit を呼ばない', async () => {
    const onSubmit = vi.fn()
    render(<NameInputDialog {...defaultProps} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.getByRole('alert')).toHaveTextContent('名前を入力してください')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each(['a/b', 'a\\b', '.', '..'])(
    '使用できない名前 %j はエラーを表示し onSubmit を呼ばない',
    async (name) => {
      const onSubmit = vi.fn()
      render(<NameInputDialog {...defaultProps} onSubmit={onSubmit} />)
      // '/' などを含む文字列は type のキー解釈を避けるため fireEvent で直接入力する
      fireEvent.change(screen.getByLabelText('名前'), { target: { value: name } })
      await userEvent.click(screen.getByRole('button', { name: 'OK' }))
      expect(screen.getByRole('alert')).toHaveTextContent('使用できない名前です')
      expect(onSubmit).not.toHaveBeenCalled()
    }
  )

  it('再入力するとエラーが消える', async () => {
    render(<NameInputDialog {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('名前'), 'a')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('キャンセルボタンで onCancel が呼ばれる', async () => {
    const onCancel = vi.fn()
    render(<NameInputDialog {...defaultProps} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('Escape キーで onCancel が呼ばれる', async () => {
    const onCancel = vi.fn()
    render(<NameInputDialog {...defaultProps} onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByLabelText('名前'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('オーバーレイのクリックで onCancel が呼ばれるがダイアログ内クリックでは呼ばれない', async () => {
    const onCancel = vi.fn()
    const { container } = render(<NameInputDialog {...defaultProps} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('dialog'))
    expect(onCancel).not.toHaveBeenCalled()
    await userEvent.click(container.querySelector('.name-input-dialog__overlay')!)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('入力欄に自動フォーカスされる', () => {
    render(<NameInputDialog {...defaultProps} />)
    expect(screen.getByLabelText('名前')).toHaveFocus()
  })

  it('validate を渡すと、その結果でエラーを表示し onSubmit を呼ばない', async () => {
    const onSubmit = vi.fn()
    render(
      <NameInputDialog
        title="新しいブランチ名"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        validate={(name) => (name === 'main' ? '同じ名前のブランチが既に存在します' : null)}
      />
    )
    await userEvent.type(screen.getByRole('textbox', { name: '名前' }), 'main')
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.getByRole('alert')).toHaveTextContent('同じ名前のブランチが既に存在します')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // ブランチ名に '/' は使えるが、ファイル名検証(isSafeEntryName)では拒否される
  it('validate を渡すと従来のファイル名検証は使わない', async () => {
    const onSubmit = vi.fn()
    render(
      <NameInputDialog
        title="新しいブランチ名"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        validate={() => null}
      />
    )
    await userEvent.type(screen.getByRole('textbox', { name: '名前' }), 'feature/x')
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onSubmit).toHaveBeenCalledWith('feature/x')
  })

  it('validate に渡す名前は前後の空白を trim したもの', async () => {
    const validate = vi.fn().mockReturnValue(null)
    render(
      <NameInputDialog
        title="新しいブランチ名"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        validate={validate}
      />
    )
    await userEvent.type(screen.getByRole('textbox', { name: '名前' }), '  feature/x  ')
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(validate).toHaveBeenCalledWith('feature/x')
  })
})
