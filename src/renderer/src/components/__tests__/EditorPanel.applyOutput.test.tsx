import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  mockEditor,
  mockEditorModel,
  mockFocus
} from '../../__tests__/__mocks__/@monaco-editor/react'
import type { OpenedFileEvent } from '../../hooks/useFileSystem'
import type { OpenFile } from '../../types'
import type { DiffTabKey } from '../../hooks/useDiffTabs'
import EditorPanel from '../EditorPanel'
import { makeConflictFileState } from '../../__tests__/makeConflictFileState'
import { APPLY_DISABLED_REASONS } from '../../lib/applyDisabledReason'
import { selectionOf } from '../../__tests__/makeFakeApplyEditor'
import type { ApplySelection } from '../../lib/applyToEditor'

// EditorPanel.test.tsx と同じく、dnd-kit は jsdom 上でクリックの伝播を阻害するためモックする
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PointerSensor: class {},
  KeyboardSensor: class {},
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => [])
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: {},
  horizontalListSortingStrategy: {},
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

// 偽のエディタ(@monaco-editor/react のモック)を通した配線の確認。実物の Monaco での undo・改行コード・
// カーソルは applyToEditor.monaco.test.ts、実機では manual-test-spec の APL で確かめる
const file: OpenFile = {
  path: '/project/src/index.ts',
  name: 'index.ts',
  content: 'const x = 1',
  savedContent: 'const x = 1',
  language: 'typescript'
}

const RESULT = '例です\n\n```ts\nconst y = 2\n```'

const onChangeContent = vi.fn<(content: string) => void>()

const baseProps = {
  openFiles: [file] as OpenFile[],
  activeFilePath: file.path as string | null,
  isDirty: false,
  isSaving: false,
  saveError: null as Error | null,
  onChangeContent,
  onSave: vi.fn(),
  onActivateTab: vi.fn(() => true),
  onCloseTab: vi.fn(),
  onReorderTabs: vi.fn(),
  isExecuting: false,
  result: RESULT as string | null,
  streamingText: '',
  executionError: null as Error | null,
  onClearResult: vi.fn(),
  onCancelExecution: vi.fn(),
  isOverlayOpen: false,
  openedFileSignal: { events: [] as OpenedFileEvent[] },
  diffTabs: [] as DiffTabKey[],
  activeDiffTab: null as DiffTabKey | null,
  onActivateDiffTab: vi.fn(),
  onCloseDiffTab: vi.fn(),
  onDeactivateDiffTab: vi.fn(),
  diffContent: null as string | null,
  diffStaged: false,
  diffError: null as Error | null,
  isHunkOperationInProgress: false,
  onStageHunk: vi.fn(),
  onUnstageHunk: vi.fn(),
  onDiscardHunk: vi.fn(),
  canDiscardHunk: false,
  isActiveFileUntracked: false,
  isActiveFileConflicted: false,
  conflictFile: makeConflictFileState(),
  isConflictBlocked: false
}

const select = (selection: ApplySelection): void => {
  act(() => mockEditor.current?.select(selection))
}

// 1 行目の前向きの選択(カーソルは終わり)
const range = (startColumn: number, endColumn: number): ApplySelection =>
  selectionOf(1, startColumn, 1, endColumn, 1, endColumn)

const headerButton = (name: RegExp): HTMLElement =>
  within(document.querySelector('.output-panel__header') as HTMLElement).getByRole('button', {
    name
  })

const codeBlockButton = (name: RegExp): HTMLElement =>
  within(document.querySelector('.code-block') as HTMLElement).getByRole('button', { name })

beforeEach(() => {
  onChangeContent.mockReset()
})

describe('EditorPanel — 出力のエディタへの反映', () => {
  it('コードブロックの「挿入」で、カーソル位置にコードが入った内容を onChangeContent に渡し、エディタへフォーカスを戻す', async () => {
    const user = userEvent.setup()
    render(<EditorPanel {...baseProps} />)
    select(range(12, 12))
    mockFocus.mockClear()

    await user.click(codeBlockButton(/^挿入/))

    expect(onChangeContent).toHaveBeenCalledWith('const x = 1const y = 2')
    expect(mockEditor.current?.pushUndoStop).toHaveBeenCalledTimes(2)
    expect(mockFocus).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('挿入しました')
  })

  it('選択範囲があるときの「置換」で、選択範囲を置き換えた内容を onChangeContent に渡す', async () => {
    const user = userEvent.setup()
    render(<EditorPanel {...baseProps} />)
    // 「x」を選ぶ
    select(range(7, 8))

    await user.click(codeBlockButton(/^置換/))

    expect(onChangeContent).toHaveBeenCalledWith('const const y = 2 = 1')
    expect(screen.getByRole('status')).toHaveTextContent('置換しました')
  })

  it('ヘッダーの「挿入」は出力全体(Markdown の原文)を入れる', async () => {
    const user = userEvent.setup()
    render(<EditorPanel {...baseProps} />)

    await user.click(headerButton(/^挿入/))

    expect(onChangeContent).toHaveBeenCalledWith(`${RESULT}const x = 1`)
  })

  it('選択範囲が空の間は「置換」が無効で、選ぶと有効になる', () => {
    render(<EditorPanel {...baseProps} />)
    expect(headerButton(/^置換/)).toBeDisabled()
    expect(headerButton(/^置換/)).toHaveAccessibleDescription(APPLY_DISABLED_REASONS.noSelection)

    select(range(1, 6))

    expect(headerButton(/^置換/)).toBeEnabled()
    expect(codeBlockButton(/^置換/)).toBeEnabled()
  })

  it('ファイルを開いていない(Welcome)ときは無効', () => {
    render(<EditorPanel {...baseProps} openFiles={[]} activeFilePath={null} />)

    expect(headerButton(/^挿入/)).toBeDisabled()
    expect(headerButton(/^挿入/)).toHaveAccessibleDescription(APPLY_DISABLED_REASONS.noEditor)
  })

  it('diff タブをアクティブにすると無効になり、ファイルのタブへ戻ると有効になる', () => {
    const diff = { path: 'src/index.ts', staged: false }
    const { rerender } = render(<EditorPanel {...baseProps} diffTabs={[diff]} />)
    expect(headerButton(/^挿入/)).toBeEnabled()

    rerender(
      <EditorPanel
        {...baseProps}
        diffTabs={[diff]}
        activeDiffTab={diff}
        diffContent={'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'}
      />
    )
    expect(headerButton(/^挿入/)).toBeDisabled()
    expect(headerButton(/^挿入/)).toHaveAccessibleDescription(APPLY_DISABLED_REASONS.noEditor)

    rerender(<EditorPanel {...baseProps} diffTabs={[diff]} />)
    expect(headerButton(/^挿入/)).toBeEnabled()
  })

  it('ファイルを切り替えると、新しいファイルのエディタへ反映する(選択範囲の状態も新しいエディタのもの)', async () => {
    const user = userEvent.setup()
    const other: OpenFile = { ...file, path: '/project/b.ts', name: 'b.ts', content: 'b' }
    const { rerender } = render(<EditorPanel {...baseProps} openFiles={[file, other]} />)
    select(range(1, 6))
    expect(headerButton(/^置換/)).toBeEnabled()

    rerender(<EditorPanel {...baseProps} openFiles={[file, other]} activeFilePath={other.path} />)
    expect(headerButton(/^置換/)).toBeDisabled()

    await user.click(headerButton(/^挿入/))
    expect(onChangeContent).toHaveBeenCalledWith(`${RESULT}b`)
  })

  it('マウントの時点でモデルが無い(破棄済み)エディタは反映先にしない', () => {
    mockEditorModel.current = null
    render(<EditorPanel {...baseProps} />)

    expect(headerButton(/^挿入/)).toBeDisabled()
  })

  it('挿入の直後にクリアして再実行すると、実行中のヘッダーに前の通知を残さない', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<EditorPanel {...baseProps} />)
    await user.click(codeBlockButton(/^挿入/))
    expect(screen.getByRole('status')).toHaveTextContent('挿入しました')

    // クリア(出力パネルが消える)→ 再実行
    rerender(<EditorPanel {...baseProps} result={null} />)
    rerender(<EditorPanel {...baseProps} result={null} isExecuting={true} />)

    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('実行中は挿入・置換を出さない', () => {
    render(<EditorPanel {...baseProps} isExecuting={true} />)

    expect(screen.queryByRole('button', { name: /^(挿入|置換)/ })).not.toBeInTheDocument()
  })
})
