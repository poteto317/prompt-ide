import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { Prompt } from '../../../types'
import PromptsPanel from '../PromptsPanel'

// DndContext に渡された onDragEnd を捕捉し、テストから直接起動できるようにする
const dndState = vi.hoisted(() => ({
  onDragEnd: undefined as ((e: unknown) => void) | undefined
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd
  }: {
    children: React.ReactNode
    onDragEnd: (e: unknown) => void
  }) => {
    dndState.onDragEnd = onDragEnd
    return <div data-testid="dnd-context" data-on-drag-end={String(!!onDragEnd)}>{children}</div>
  },
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
  onReorder: vi.fn(),
  onTogglePin: vi.fn(),
  onExport: vi.fn(),
  onImport: vi.fn()
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

  it('実行ボタンクリックで onRun がプロンプト内容と selectedTool とともに呼ばれる', async () => {
    const onRun = vi.fn()
    render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} onRun={onRun} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを実行' }))
    expect(onRun).toHaveBeenCalledWith('テスト内容', 'claude')
  })

  it('ツールセレクタで copilot に変更してから実行すると toolId が copilot で onRun に渡る', async () => {
    const onRun = vi.fn()
    render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} onRun={onRun} />)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '実行ツールを選択' }),
      'copilot'
    )
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを実行' }))
    expect(onRun).toHaveBeenCalledWith('テスト内容', 'copilot')
  })

  it('ツールセレクタで api に変更してから実行すると toolId が api で onRun に渡る', async () => {
    const onRun = vi.fn()
    render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} onRun={onRun} />)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '実行ツールを選択' }),
      'api'
    )
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを実行' }))
    expect(onRun).toHaveBeenCalledWith('テスト内容', 'api')
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

    it('空白のみの query ではドラッグハンドルが表示される（usePromptFilter と同じ trim ベース判定）', async () => {
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} />)
      await userEvent.type(screen.getByRole('searchbox'), '   ')
      expect(screen.getByRole('button', { name: '並び替え' })).toBeInTheDocument()
    })
  })

  describe('handleDragEnd → onReorder', () => {
    it('over が存在し active と異なる ID のとき onReorder が両 ID で呼ばれる', () => {
      const onReorder = vi.fn()
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} onReorder={onReorder} />)
      act(() => dndState.onDragEnd?.({ active: { id: 'p1' }, over: { id: 'p2' } }))
      expect(onReorder).toHaveBeenCalledWith('p1', 'p2')
      expect(onReorder).toHaveBeenCalledOnce()
    })

    it('over が null のとき onReorder は呼ばれない（ドロップ先なし）', () => {
      const onReorder = vi.fn()
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} onReorder={onReorder} />)
      act(() => dndState.onDragEnd?.({ active: { id: 'p1' }, over: null }))
      expect(onReorder).not.toHaveBeenCalled()
    })

    it('active と over が同一 ID のとき onReorder は呼ばれない（順序不変）', () => {
      const onReorder = vi.fn()
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} onReorder={onReorder} />)
      act(() => dndState.onDragEnd?.({ active: { id: 'p1' }, over: { id: 'p1' } }))
      expect(onReorder).not.toHaveBeenCalled()
    })

    it('数値 ID でも String 化して onReorder に渡される', () => {
      const onReorder = vi.fn()
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} onReorder={onReorder} />)
      act(() => dndState.onDragEnd?.({ active: { id: 1 }, over: { id: 2 } }))
      expect(onReorder).toHaveBeenCalledWith('1', '2')
    })

    it('ピン済み→非ピンの境界をまたぐドラッグは onReorder を呼ばない', () => {
      const onReorder = vi.fn()
      const pinnedPrompt = { ...anotherPrompt, pinned: true }
      // 表示順は [pinnedPrompt(p2), samplePrompt(p1)]
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt, pinnedPrompt]} onReorder={onReorder} />)
      // 非ピン p1 → ピン済み p2 の位置へドラッグ（境界をまたぐ）
      act(() => dndState.onDragEnd?.({ active: { id: 'p1' }, over: { id: 'p2' } }))
      expect(onReorder).not.toHaveBeenCalled()
    })

    it('同じグループ内（未ピン同士）のドラッグは onReorder が呼ばれる', () => {
      const onReorder = vi.fn()
      const pinnedPrompt = { ...anotherPrompt, pinned: true }
      const thirdPrompt = { id: 'p3', title: 'C', content: 'C内容', createdAt: 3000000 }
      // 表示順は [pinnedPrompt(p2), samplePrompt(p1), thirdPrompt(p3)]
      render(
        <PromptsPanel
          {...defaultProps}
          prompts={[samplePrompt, pinnedPrompt, thirdPrompt]}
          onReorder={onReorder}
        />
      )
      // 未ピン同士（p1 → p3）のドラッグは通常通り
      act(() => dndState.onDragEnd?.({ active: { id: 'p1' }, over: { id: 'p3' } }))
      expect(onReorder).toHaveBeenCalledWith('p1', 'p3')
    })
  })

  describe('ツールバー（PromptsToolbar 統合）', () => {
    // ボタンの詳細仕様は PromptsToolbar.test.tsx で網羅。ここでは描画と disabled 連動のみ確認。
    it('ツールバーが描画され、0 件時はエクスポートが prompts.length に連動して disabled になる', () => {
      render(<PromptsPanel {...defaultProps} prompts={[]} />)
      expect(screen.getByRole('button', { name: 'プロンプトをインポート' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'プロンプトをエクスポート' })).toBeDisabled()
    })

    it('プロンプトがあるときエクスポートが有効になる', () => {
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} />)
      expect(screen.getByRole('button', { name: 'プロンプトをエクスポート' })).toBeEnabled()
    })
  })

  describe('タグフィルター', () => {
    const taggedPrompt: Prompt = {
      id: 'p1',
      title: 'タグ付きA',
      content: 'コンテンツA',
      createdAt: 1000000,
      tags: ['React', 'TypeScript'],
    }
    const otherTaggedPrompt: Prompt = {
      id: 'p2',
      title: 'タグ付きB',
      content: 'コンテンツB',
      createdAt: 2000000,
      tags: ['Vue'],
    }
    const noTagPrompt: Prompt = {
      id: 'p3',
      title: 'タグなし',
      content: 'コンテンツC',
      createdAt: 3000000,
    }

    it('タグを持つプロンプトがあるときタグフィルターバーが表示される', () => {
      render(<PromptsPanel {...defaultProps} prompts={[taggedPrompt]} />)
      expect(screen.getByRole('button', { name: 'React' })).toBeInTheDocument()
    })

    it('タグが一切ないときタグフィルターバーは表示されない', () => {
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} />)
      expect(screen.queryByRole('group', { name: 'タグで絞り込み' })).not.toBeInTheDocument()
    })

    it('タグをクリックすると該当タグを持つプロンプトだけが表示される', async () => {
      render(
        <PromptsPanel
          {...defaultProps}
          prompts={[taggedPrompt, otherTaggedPrompt, noTagPrompt]}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'React' }))
      expect(screen.getByText('タグ付きA')).toBeInTheDocument()
      expect(screen.queryByText('タグ付きB')).not.toBeInTheDocument()
      expect(screen.queryByText('タグなし')).not.toBeInTheDocument()
    })

    it('同じタグをもう一度クリックすると絞り込みが解除される', async () => {
      render(
        <PromptsPanel {...defaultProps} prompts={[taggedPrompt, noTagPrompt]} />
      )
      await userEvent.click(screen.getByRole('button', { name: 'React' }))
      expect(screen.queryByText('タグなし')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'React' }))
      expect(screen.getByText('タグなし')).toBeInTheDocument()
    })

    it('タグ絞り込み中はドラッグハンドルが非表示になる', async () => {
      render(<PromptsPanel {...defaultProps} prompts={[taggedPrompt]} />)
      await userEvent.click(screen.getByRole('button', { name: 'React' }))
      expect(screen.queryByRole('button', { name: '並び替え' })).not.toBeInTheDocument()
    })

    it('選択中タグは aria-pressed=true になる', async () => {
      render(<PromptsPanel {...defaultProps} prompts={[taggedPrompt]} />)
      const chip = screen.getByRole('button', { name: 'React' })
      expect(chip).toHaveAttribute('aria-pressed', 'false')
      await userEvent.click(chip)
      expect(chip).toHaveAttribute('aria-pressed', 'true')
    })

    it('タグフィルターで 0 件になったとき no-results メッセージが表示される', async () => {
      render(
        <PromptsPanel {...defaultProps} prompts={[taggedPrompt, otherTaggedPrompt]} />
      )
      // React のみ持つ taggedPrompt と Vue のみ持つ otherTaggedPrompt を AND 選択 → 0 件
      await userEvent.click(screen.getByRole('button', { name: 'React' }))
      await userEvent.click(screen.getByRole('button', { name: 'Vue' }))
      expect(screen.getByText('条件に一致するプロンプトはありません')).toBeInTheDocument()
    })
  })

  describe('ピン留め', () => {
    it('ピン留め済みプロンプトが上部に表示される', () => {
      render(
        <PromptsPanel
          {...defaultProps}
          prompts={[samplePrompt, { ...anotherPrompt, pinned: true }]}
        />
      )
      const titles = screen.getAllByText(/テストタイトル|バグ修正/)
      // anotherPrompt（ピン済み「バグ修正」）が先頭
      expect(titles[0]).toHaveTextContent('バグ修正')
      expect(titles[1]).toHaveTextContent('テストタイトル')
    })

    it('ピン留めボタンクリックで onTogglePin が prompt.id とともに呼ばれる', async () => {
      const onTogglePin = vi.fn()
      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} onTogglePin={onTogglePin} />)
      await userEvent.click(screen.getByRole('button', { name: 'ピン留め' }))
      expect(onTogglePin).toHaveBeenCalledWith('p1')
    })
  })
})
