import { render, screen } from '@testing-library/react'
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
  onEditPrompt: vi.fn(),
  onReorderPrompt: vi.fn(),
  onRunPrompt: vi.fn(),
  isExecuting: false,
  tasks: [],
  onAddTask: vi.fn(),
  onDeleteTask: vi.fn(),
  onRecordEvent: vi.fn(),
  onCompleteStage: vi.fn(),
  onReopenStage: vi.fn(),
  onSkipStage: vi.fn(),
  onAdvanceStage: vi.fn(),
  gitStatus: null,
  gitLoading: false,
  gitError: null,
  onRefreshGitStatus: vi.fn(),
  hasKey: false,
  apiKeyLoaded: true,
  keyStoreError: null as string | null,
  onSaveApiKey: vi.fn()
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

  it('source-control: explorer/prompts/progress/settings パネルは非表示で SourceControlPanel が表示される', () => {
    const { container } = render(<Sidebar activePanel="source-control" {...defaultProps} />)
    const panels = Array.from(container.querySelectorAll('.sidebar__panel'))
    const hiddenPanels = panels.filter((p) => p.classList.contains('sidebar__panel--hidden'))
    const activePanels = panels.filter((p) => !p.classList.contains('sidebar__panel--hidden'))
    expect(hiddenPanels).toHaveLength(4)
    expect(activePanels).toHaveLength(1)
    expect(screen.getByText('フォルダを開いてください')).toBeInTheDocument()
  })

  it('progress: 正しいヘッダーが表示され ProgressPanel が描画される', () => {
    render(<Sidebar activePanel="progress" {...defaultProps} />)
    expect(screen.getByText(sidebarTitles.progress)).toBeInTheDocument()
    // tasks=[] なので ProgressPanel の空メッセージが表示される
    expect(screen.getByText('タスクがありません')).toBeInTheDocument()
  })

  it('settings: 正しいヘッダーが表示され SettingsPanel が描画される', () => {
    render(<Sidebar activePanel="settings" {...defaultProps} />)
    expect(screen.getByText(sidebarTitles.settings)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument()
  })

  it('explorer に切り替えても PromptsPanel は DOM に残る（常時マウント）', () => {
    const { rerender } = render(<Sidebar activePanel="prompts" {...defaultProps} />)
    rerender(<Sidebar activePanel="explorer" {...defaultProps} />)
    expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
  })

  it('error が渡されたとき ExplorerPanel に error.message が表示される', () => {
    render(
      <Sidebar activePanel="explorer" {...defaultProps} error={new Error('folder open failed')} />
    )
    expect(screen.getByText('folder open failed')).toBeInTheDocument()
  })

  it('prompts: 並び替えボタンが存在し、ドラッグ操作後に onReorderPrompt が呼ばれる準備ができている', () => {
    const onReorderPrompt = vi.fn()
    render(
      <Sidebar
        activePanel="prompts"
        {...defaultProps}
        onReorderPrompt={onReorderPrompt}
        prompts={[{ id: 'p1', title: 'プロンプト1', content: '内容1', createdAt: 1000000 }]}
      />
    )
    expect(screen.getByRole('button', { name: '並び替え' })).toBeInTheDocument()
  })
})
