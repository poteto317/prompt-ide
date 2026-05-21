import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import Sidebar from '../Sidebar'
import { sidebarTitles, sidebarPlaceholders } from '../../config/sidebarTitles'

describe('Sidebar', () => {
  it('explorer: 正しいヘッダーとプレースホルダーが表示される', () => {
    render(<Sidebar activePanel="explorer" />)
    expect(screen.getByText(sidebarTitles.explorer)).toBeInTheDocument()
    expect(screen.getByText(sidebarPlaceholders.explorer)).toBeInTheDocument()
  })

  it('source-control: 正しいヘッダーとプレースホルダーが表示される', () => {
    render(<Sidebar activePanel="source-control" />)
    expect(screen.getByText(sidebarTitles['source-control'])).toBeInTheDocument()
    expect(screen.getByText(sidebarPlaceholders['source-control'])).toBeInTheDocument()
  })

  it('prompts: ヘッダーが表示され PromptsPanel が描画される', () => {
    render(<Sidebar activePanel="prompts" />)
    expect(screen.getByText(sidebarTitles.prompts)).toBeInTheDocument()
    expect(screen.queryByText(sidebarPlaceholders.prompts)).not.toBeInTheDocument()
    expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
  })

  it('prompts 以外のパネルに切り替えると PromptsPanel のラッパーに sidebar__panel--hidden クラスが付く', () => {
    const { rerender, container } = render(<Sidebar activePanel="prompts" />)

    // prompts 表示中: hidden クラスなし
    expect(container.querySelector('.sidebar__panel--hidden')).toBeNull()
    expect(container.querySelector('.sidebar__panel')).not.toBeNull()

    rerender(<Sidebar activePanel="explorer" />)

    // explorer に切り替え: hidden クラスが付いて非表示になる
    expect(container.querySelector('.sidebar__panel--hidden')).not.toBeNull()
    // PromptsPanel 自体は DOM に残っている（アンマウントされていない）
    expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
  })

  it('パネルを切り替えて prompts に戻っても追加したプロンプトが保持される', async () => {
    const { rerender } = render(<Sidebar activePanel="prompts" />)

    // プロンプトを追加
    await userEvent.type(screen.getByRole('textbox', { name: 'タイトル' }), 'テストタイトル')
    await userEvent.type(screen.getByRole('textbox', { name: 'プロンプト内容' }), 'テスト内容')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()

    // explorer に切り替え
    rerender(<Sidebar activePanel="explorer" />)
    expect(screen.getByText(sidebarTitles.explorer)).toBeInTheDocument()

    // prompts に戻す
    rerender(<Sidebar activePanel="prompts" />)

    // 追加したプロンプトが保持されている
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()
    expect(screen.queryByText('プロンプトがありません')).not.toBeInTheDocument()
  })
})
