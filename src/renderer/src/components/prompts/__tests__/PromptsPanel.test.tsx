import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import PromptsPanel from '../PromptsPanel'

describe('PromptsPanel', () => {
  it('初期状態で空状態メッセージが表示される', () => {
    render(<PromptsPanel />)
    expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
  })

  it('プロンプトを追加すると一覧に表示される', async () => {
    render(<PromptsPanel />)
    await userEvent.type(screen.getByRole('textbox', { name: 'タイトル' }), 'テストタイトル')
    await userEvent.type(screen.getByRole('textbox', { name: 'プロンプト内容' }), 'テスト内容')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()
    expect(screen.queryByText('プロンプトがありません')).not.toBeInTheDocument()
  })

  it('プロンプトを追加すると空状態メッセージが消える', async () => {
    render(<PromptsPanel />)
    await userEvent.type(screen.getByRole('textbox', { name: 'タイトル' }), 'タイトル')
    await userEvent.type(screen.getByRole('textbox', { name: 'プロンプト内容' }), '内容')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(screen.queryByText('プロンプトがありません')).not.toBeInTheDocument()
  })

  it('プロンプトを削除すると一覧から消える', async () => {
    render(<PromptsPanel />)
    await userEvent.type(screen.getByRole('textbox', { name: 'タイトル' }), 'タイトル')
    await userEvent.type(screen.getByRole('textbox', { name: 'プロンプト内容' }), '内容')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを削除' }))
    expect(screen.queryByText('タイトル')).not.toBeInTheDocument()
    expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
  })

  it('複数プロンプトを追加すると全件表示される', async () => {
    render(<PromptsPanel />)
    for (const i of [1, 2, 3]) {
      await userEvent.type(screen.getByRole('textbox', { name: 'タイトル' }), `タイトル${i}`)
      await userEvent.type(screen.getByRole('textbox', { name: 'プロンプト内容' }), `内容${i}`)
      await userEvent.click(screen.getByRole('button', { name: '追加' }))
    }
    expect(screen.getByText('タイトル1')).toBeInTheDocument()
    expect(screen.getByText('タイトル2')).toBeInTheDocument()
    expect(screen.getByText('タイトル3')).toBeInTheDocument()
  })
})
