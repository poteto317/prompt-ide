import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import Sidebar from '../Sidebar'
import { sidebarTitles } from '../../config/sidebarTitles'

const defaultProps = {
  folderPath: null as string | null,
  fileTree: [],
  openFilePath: null as string | null,
  onOpenFolder: vi.fn(),
  onSelectFile: vi.fn(),
  error: null as Error | null,
  prompts: [],
  onAddPrompt: vi.fn(),
  onDeletePrompt: vi.fn(),
}

describe('Sidebar', () => {
  it('explorer: 正しいヘッダーが表示され ExplorerPanel が描画される', () => {
    render(<Sidebar activePanel="explorer" {...defaultProps} />)
    expect(screen.getByText(sidebarTitles.explorer)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'フォルダを開く' })).toBeInTheDocument()
  })

  it('source-control: 正しいヘッダーが表示される', () => {
    render(<Sidebar activePanel="source-control" {...defaultProps} />)
    expect(screen.getByText(sidebarTitles['source-control'])).toBeInTheDocument()
  })

  it('prompts: ヘッダーが表示され PromptsPanel が描画される', () => {
    render(<Sidebar activePanel="prompts" {...defaultProps} />)
    expect(screen.getByText(sidebarTitles.prompts)).toBeInTheDocument()
    expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
  })

  it('prompts 以外のパネルに切り替えると PromptsPanel のラッパーに sidebar__panel--hidden クラスが付く', () => {
    const { rerender, container } = render(<Sidebar activePanel="prompts" {...defaultProps} />)

    rerender(<Sidebar activePanel="explorer" {...defaultProps} />)

    // explorer に切り替え: PromptsPanel のラッパーが hidden
    const panels = container.querySelectorAll('.sidebar__panel')
    const promptsWrapper = Array.from(panels).find((el) =>
      el.textContent?.includes('プロンプトがありません')
    )
    expect(promptsWrapper).toHaveClass('sidebar__panel--hidden')
    // PromptsPanel 自体は DOM に残っている
    expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
  })

  it('source-control: ExplorerPanel と PromptsPanel の両ラッパーが hidden になる', () => {
    const { container } = render(<Sidebar activePanel="source-control" {...defaultProps} />)
    const panels = container.querySelectorAll('.sidebar__panel')
    panels.forEach((panel) => {
      expect(panel).toHaveClass('sidebar__panel--hidden')
    })
  })

  it('explorer に切り替えても PromptsPanel は DOM に残る（常時マウント）', () => {
    const { rerender } = render(<Sidebar activePanel="prompts" {...defaultProps} />)
    rerender(<Sidebar activePanel="explorer" {...defaultProps} />)
    expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
  })

  it('error が渡されたとき ExplorerPanel に error.message が表示される', () => {
    render(
      <Sidebar
        activePanel="explorer"
        {...defaultProps}
        error={new Error('folder open failed')}
      />
    )
    expect(screen.getByText('folder open failed')).toBeInTheDocument()
  })
})
