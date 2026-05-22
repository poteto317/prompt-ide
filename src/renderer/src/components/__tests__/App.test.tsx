import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import App from '../../App'
import { sidebarTitles } from '../../config/sidebarTitles'
import { activityBarPanels } from '../../config/activityBarPanels'

describe('App', () => {
  it('初期状態でサイドバーが表示されている', () => {
    render(<App />)
    expect(screen.getByText(sidebarTitles.explorer)).toBeInTheDocument()
  })

  it('アクティブなパネルを再クリックするとサイドバーが非表示になる', async () => {
    render(<App />)
    const explorerBtn = screen.getByTitle(activityBarPanels[0].title)
    await userEvent.click(explorerBtn)
    expect(screen.queryByText(sidebarTitles.explorer)).not.toBeInTheDocument()
  })

  it('別パネルに切り替えるとサイドバーが開いたまま内容が変わる', async () => {
    render(<App />)
    const gitBtn = screen.getByTitle(activityBarPanels[1].title)
    await userEvent.click(gitBtn)
    expect(screen.getByText(sidebarTitles['source-control'])).toBeInTheDocument()
  })

  it('サイドバーを閉じて再度開いてもプロンプトが保持される', async () => {
    render(<App />)

    // prompts パネルへ切り替え
    const promptsBtn = screen.getByTitle(activityBarPanels[2].title)
    await userEvent.click(promptsBtn)

    // プロンプトを追加
    await userEvent.type(screen.getByRole('textbox', { name: 'タイトル' }), 'テストタイトル')
    await userEvent.type(screen.getByRole('textbox', { name: 'プロンプト内容' }), 'テスト内容')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()

    // 同じパネルを再クリックしてサイドバーを閉じる
    await userEvent.click(promptsBtn)
    expect(screen.queryByText('テストタイトル')).not.toBeInTheDocument()

    // 再度開く
    await userEvent.click(promptsBtn)
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()
  })
})
