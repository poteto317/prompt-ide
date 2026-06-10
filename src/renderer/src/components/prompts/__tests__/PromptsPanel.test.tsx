import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { Prompt } from '../../../types'
import PromptsPanel from '../PromptsPanel'

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd
  }: {
    children: React.ReactNode
    onDragEnd: (e: unknown) => void
  }) => <div data-testid="dnd-context" data-on-drag-end={String(!!onDragEnd)}>{children}</div>,
  PointerSensor: class {},
  KeyboardSensor: class {},
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => [])
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: {},
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false
  })
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } }
}))

const defaultProps = {
  prompts: [] as Prompt[],
  onAdd: vi.fn(),
  onDelete: vi.fn(),
  onRun: vi.fn(),
  onEdit: vi.fn(),
  onReorder: vi.fn()
}

const samplePrompt: Prompt = {
  id: 'p1',
  title: 'テストタイトル',
  content: 'テスト内容',
  createdAt: 1000000,
}

const anotherPrompt: Prompt = {
  id: 'p2',
  title: 'バグ修正',
  content: 'エラーログを確認して修正する',
  createdAt: 2000000,
}

describe('PromptsPanel', () => {
  describe('検索 UI', () => {
    it('検索 input が常に描画される', () => {
      render(<PromptsPanel {...defaultProps} />)
      expect(screen.getByRole('searchbox', { name: 'プロンプトを検索' })).toBeInTheDocument()
    })

    it('prompts があるとき検索 input に入力すると title で絞り込まれる', async () => {
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} />)
      await userEvent.type(screen.getByRole('searchbox'), 'テスト')
      expect(screen.getByText('テストタイトル')).toBeInTheDocument()
      expect(screen.queryByText('バグ修正')).not.toBeInTheDocument()
    })

    it('content にマッチする query で絞り込まれる', async () => {
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} />)
      await userEvent.type(screen.getByRole('searchbox'), 'エラーログ')
      expect(screen.queryByText('テストタイトル')).not.toBeInTheDocument()
      expect(screen.getByText('バグ修正')).toBeInTheDocument()
    })

    it('一致なしのとき no-results メッセージが表示される', async () => {
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} />)
      await userEvent.type(screen.getByRole('searchbox'), '存在しないキーワード')
      expect(screen.getByText(/に一致するプロンプトはありません/)).toBeInTheDocument()
      expect(screen.queryByText('プロンプトがありません')).not.toBeInTheDocument()
    })

    it('query をクリアすると全件が表示される', async () => {
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} />)
      const input = screen.getByRole('searchbox')
      await userEvent.type(input, 'バグ')
      expect(screen.queryByText('テストタイトル')).not.toBeInTheDocument()
      await userEvent.clear(input)
      expect(screen.getByText('テストタイトル')).toBeInTheDocument()
      expect(screen.getByText('バグ修正')).toBeInTheDocument()
    })

    it('prompts が空のとき検索 input と empty メッセージが両方描画される', () => {
      render(<PromptsPanel {...defaultProps} prompts={[]} />)
      expect(screen.getByRole('searchbox', { name: 'プロンプトを検索' })).toBeInTheDocument()
      expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
    })
  })

  it('prompts が空のとき「プロンプトがありません」が表示される', () => {
    render(<PromptsPanel {...defaultProps} />)
    expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
  })

  it('prompts がある場合は空状態メッセージが表示されない', () => {
    render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} />)
    expect(screen.queryByText('プロンプトがありません')).not.toBeInTheDocument()
  })

  it('prompts の title が表示される', () => {
    render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} />)
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()
  })

  it('AddPromptForm が常に表示される', () => {
    render(<PromptsPanel {...defaultProps} />)
    expect(screen.getByRole('button', { name: '追加' })).toBeInTheDocument()
  })

  it('削除ボタンクリックで onDelete が呼ばれる', async () => {
    const onDelete = vi.fn()
    render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを削除' }))
    expect(onDelete).toHaveBeenCalledWith('p1')
  })

  it('実行ボタンクリックで onRun がプロンプト内容とともに呼ばれる', async () => {
    const onRun = vi.fn()
    render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} onRun={onRun} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを実行' }))
    expect(onRun).toHaveBeenCalledWith('テスト内容')
  })

  it('isRunDisabled=true のとき実行ボタンが disabled になる', () => {
    render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} isRunDisabled={true} />)
    expect(screen.getByRole('button', { name: 'プロンプトを実行' })).toBeDisabled()
  })

  describe('query の自動リセット', () => {
    it('全件削除後に追加した新規プロンプトが表示される（Bug 1）', async () => {
      const { rerender } = render(
        <PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} />
      )
      await userEvent.type(screen.getByRole('searchbox'), 'xyz')
      expect(screen.getByText(/に一致するプロンプトはありません/)).toBeInTheDocument()

      rerender(<PromptsPanel {...defaultProps} prompts={[]} />)
      expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()

      const newPrompt = { id: 'p3', title: '新規プロンプト', content: '内容', createdAt: 3000000 }
      rerender(<PromptsPanel {...defaultProps} prompts={[newPrompt]} />)
      expect(screen.getByText('新規プロンプト')).toBeInTheDocument()
      expect(screen.queryByText(/に一致するプロンプトはありません/)).not.toBeInTheDocument()
    })

    it('isActive が false に変わると query がリセットされる（Bug 2）', async () => {
      const { rerender } = render(
        <PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} isActive={true} />
      )
      await userEvent.type(screen.getByRole('searchbox'), 'テスト')
      expect(screen.queryByText('バグ修正')).not.toBeInTheDocument()

      rerender(
        <PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} isActive={false} />
      )
      await act(async () => {})
      rerender(
        <PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} isActive={true} />
      )
      expect(screen.getByText('テストタイトル')).toBeInTheDocument()
      expect(screen.getByText('バグ修正')).toBeInTheDocument()
      expect(screen.getByRole('searchbox')).toHaveValue('')
    })

    it('isActive が初回から false でも query はリセットされない', async () => {
      render(
        <PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} isActive={false} />
      )
      await userEvent.type(screen.getByRole('searchbox'), 'テスト')
      expect(screen.getByRole('searchbox')).toHaveValue('テスト')
    })
  })

  describe('DnD コンテキスト', () => {
    it('プロンプトがあるとき DndContext がレンダリングされる', () => {
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} />)
      expect(screen.getByTestId('dnd-context')).toBeInTheDocument()
    })

    it('検索フィルタが active のときドラッグハンドルが表示されない', async () => {
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} />)
      await userEvent.type(screen.getByRole('searchbox'), 'テスト')
      expect(screen.queryByRole('button', { name: '並び替え' })).not.toBeInTheDocument()
    })

    it('検索フィルタが空のときドラッグハンドルが表示される', () => {
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} />)
      expect(screen.getByRole('button', { name: '並び替え' })).toBeInTheDocument()
    })
  })
})
