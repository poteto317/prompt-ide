import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import StageRecordForm from '../StageRecordForm'

describe('StageRecordForm', () => {
  it('入力したメモ付きで onRecord を呼ぶ', async () => {
    const onRecord = vi.fn()
    render(<StageRecordForm onRecord={onRecord} />)
    await userEvent.type(screen.getByLabelText('実施メモ'), 'メモ内容')
    await userEvent.click(screen.getByRole('button', { name: '実施を記録する' }))
    expect(onRecord).toHaveBeenCalledWith('メモ内容')
  })

  it('空メモなら undefined で onRecord を呼ぶ', async () => {
    const onRecord = vi.fn()
    render(<StageRecordForm onRecord={onRecord} />)
    await userEvent.click(screen.getByRole('button', { name: '実施を記録する' }))
    expect(onRecord).toHaveBeenCalledWith(undefined)
  })

  it('空白のみのメモは trim され undefined で呼ばれる', async () => {
    const onRecord = vi.fn()
    render(<StageRecordForm onRecord={onRecord} />)
    await userEvent.type(screen.getByLabelText('実施メモ'), '   ')
    await userEvent.click(screen.getByRole('button', { name: '実施を記録する' }))
    expect(onRecord).toHaveBeenCalledWith(undefined)
  })

  it('前後の空白を trim して onRecord を呼ぶ', async () => {
    const onRecord = vi.fn()
    render(<StageRecordForm onRecord={onRecord} />)
    await userEvent.type(screen.getByLabelText('実施メモ'), '  メモ  ')
    await userEvent.click(screen.getByRole('button', { name: '実施を記録する' }))
    expect(onRecord).toHaveBeenCalledWith('メモ')
  })

  it('記録後に入力欄がクリアされる', async () => {
    render(<StageRecordForm onRecord={vi.fn()} />)
    const input = screen.getByLabelText('実施メモ')
    await userEvent.type(input, 'メモ内容')
    await userEvent.click(screen.getByRole('button', { name: '実施を記録する' }))
    expect(input).toHaveValue('')
  })
})
