import { render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  mockAddCommand,
  mockFocus,
  mockEditorModel
} from '../../__tests__/__mocks__/@monaco-editor/react'
import type { OpenedFileEvent } from '../../hooks/useFileSystem'
import type { OpenFile } from '../../types'
import type { DiffTabKey } from '../../hooks/useDiffTabs'
import type { SelectionRangeEditor } from '../../hooks/useEditorSelectionRange'
import EditorPanel from '../EditorPanel'
import { makeConflictFileState } from '../../__tests__/makeConflictFileState'
import { makeAgentDiffActions } from '../../__tests__/makeAgentChangesState'
import { useOnChange } from '../../hooks/useOnChange'

// dnd-kit の実装（PointerSensor によるポインタ検知等）は jsdom 上でクリックの伝播を阻害するため、
// EditorTabs.test.tsx と同じ方針で DndContext/SortableContext/useSortable をモックする
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

const mockOpenFile: OpenFile = {
  path: '/project/src/index.ts',
  name: 'index.ts',
  content: 'const x = 1',
  savedContent: 'const x = 1',
  language: 'typescript'
}

// タブの isDirty は EditorPanel 内で content !== savedContent から算出されるため、
// 「未保存」状態を再現するテストではこちらを使う
const dirtyMockOpenFile: OpenFile = {
  ...mockOpenFile,
  content: 'const x = 2'
}

const defaultProps = {
  openFiles: [] as OpenFile[],
  activeFilePath: null as string | null,
  isDirty: false,
  isSaving: false,
  saveError: null as Error | null,
  onChangeContent: vi.fn(),
  onSave: vi.fn(),
  onActivateTab: vi.fn().mockReturnValue(true),
  onCloseTab: vi.fn(),
  onReorderTabs: vi.fn(),
  isExecuting: false,
  result: null as string | null,
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
  isConflictBlocked: false,
  onEditorMount: vi.fn()
}

/** openFile 単体を渡す旧APIのテストをそのまま活かすためのヘルパー。
 *  openFile が非 null なら openFiles=[openFile]・activeFilePath=openFile.path に変換する */
function withOpenFile(
  openFile: OpenFile | null
): Pick<typeof defaultProps, 'openFiles' | 'activeFilePath'> {
  return openFile === null
    ? { openFiles: [], activeFilePath: null }
    : { openFiles: [openFile], activeFilePath: openFile.path }
}

describe('EditorPanel — openFile なし', () => {
  it('.editor-panel が入れ子にならない（WelcomeView との二重ラッパー防止）', () => {
    const { container } = render(<EditorPanel {...defaultProps} />)
    expect(container.querySelectorAll('.editor-panel')).toHaveLength(1)
  })

  it('"welcome.ts" タブが描画される', () => {
    render(<EditorPanel {...defaultProps} />)
    expect(screen.getByText('welcome.ts')).toBeInTheDocument()
  })

  it('タブに editor-tab--active クラスが付く', () => {
    render(<EditorPanel {...defaultProps} />)
    expect(screen.getByText('welcome.ts')).toHaveClass('editor-tab--active')
  })

  it('Monaco Editor のモックが描画される', () => {
    render(<EditorPanel {...defaultProps} />)
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
  })

  it('"welcome.ts" タブに閉じるボタンを表示しない（プレースホルダーのため）', () => {
    // WelcomeView のタブは openFiles に属さないプレースホルダーで、閉じる操作を
    // 持たない。以前は共通コンポーネントの都合で押しても何も起きない no-op の
    // 閉じるボタンが表示されていたが、押せるのに何も起きないボタンを見せないよう
    // closable={false} でボタン自体を非表示にする
    render(<EditorPanel {...defaultProps} onCloseTab={vi.fn()} />)
    expect(screen.queryByLabelText('タブを閉じる')).not.toBeInTheDocument()
  })
})

describe('EditorPanel — openFile あり', () => {
  it('ファイル名がタブに表示される', () => {
    render(<EditorPanel {...defaultProps} {...withOpenFile(mockOpenFile)} />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  it('タブに editor-tab--active クラスが付く', () => {
    render(<EditorPanel {...defaultProps} {...withOpenFile(mockOpenFile)} />)
    expect(screen.getByText('index.ts')).toHaveClass('editor-tab--active')
  })

  it('"welcome.ts" タブは表示されない', () => {
    render(<EditorPanel {...defaultProps} {...withOpenFile(mockOpenFile)} />)
    expect(screen.queryByText('welcome.ts')).not.toBeInTheDocument()
  })

  it('実ファイルが開かれているときは閉じるボタンが表示される', () => {
    render(<EditorPanel {...defaultProps} {...withOpenFile(mockOpenFile)} />)
    expect(screen.getByLabelText('タブを閉じる')).toBeInTheDocument()
  })

  it('閉じるボタンクリックで onCloseTab がそのファイルの path で呼ばれる', async () => {
    const user = userEvent.setup()
    const onCloseTab = vi.fn()
    render(
      <EditorPanel {...defaultProps} {...withOpenFile(mockOpenFile)} onCloseTab={onCloseTab} />
    )
    await user.click(screen.getByLabelText('タブを閉じる'))
    expect(onCloseTab).toHaveBeenCalledWith(mockOpenFile.path)
  })

  it('Monaco Editor のモックが描画される', () => {
    render(<EditorPanel {...defaultProps} {...withOpenFile(mockOpenFile)} />)
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
  })

  it('エディタは読み取り専用ではない（編集可能）', () => {
    render(<EditorPanel {...defaultProps} {...withOpenFile(mockOpenFile)} />)
    expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-readonly', 'false')
  })

  it('エディタでの入力が onChangeContent を呼ぶ', async () => {
    const user = userEvent.setup()
    const onChangeContent = vi.fn()
    render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        onChangeContent={onChangeContent}
      />
    )
    await user.type(screen.getByTestId('monaco-editor-textarea'), 'x')
    expect(onChangeContent).toHaveBeenCalled()
  })

  it('isDirty=true のとき保存ボタンが有効化される', () => {
    render(<EditorPanel {...defaultProps} {...withOpenFile(dirtyMockOpenFile)} isDirty={true} />)
    expect(screen.getByLabelText('保存')).not.toBeDisabled()
  })

  it('isDirty=false のとき保存ボタンが無効化される', () => {
    render(<EditorPanel {...defaultProps} {...withOpenFile(mockOpenFile)} isDirty={false} />)
    expect(screen.getByLabelText('保存')).toBeDisabled()
  })

  it('保存ボタンクリックで onSave が呼ばれる', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(dirtyMockOpenFile)}
        isDirty={true}
        onSave={onSave}
      />
    )
    await user.click(screen.getByLabelText('保存'))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('isSaving=true のとき、isDirty=true でも保存ボタンが無効化される（多重保存防止）', () => {
    render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(dirtyMockOpenFile)}
        isDirty={true}
        isSaving={true}
      />
    )
    expect(screen.getByLabelText('保存')).toBeDisabled()
  })

  it('未保存インジケータは isDirty=true のときのみ表示される', () => {
    const { rerender } = render(
      <EditorPanel {...defaultProps} {...withOpenFile(mockOpenFile)} isDirty={false} />
    )
    expect(document.querySelector('.editor-tab__dirty-dot')).not.toBeInTheDocument()

    rerender(<EditorPanel {...defaultProps} {...withOpenFile(dirtyMockOpenFile)} isDirty={true} />)
    expect(document.querySelector('.editor-tab__dirty-dot')).toBeInTheDocument()
  })

  it('ファイルを開いたときエディタにフォーカスする', () => {
    // クイックオープンから Enter でファイルを開くと、ダイアログの復帰先だった
    // 旧エディタは key 変更で再マウントされて DOM から消えている。
    // 新しいエディタが自分でフォーカスを取らないと body に取り残される
    render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).toHaveBeenCalled()
  })

  it('オーバーレイが開いている間はフォーカスを奪わない', () => {
    // 読み込み中にクイックオープンを開き直した場合、エディタの再マウントで
    // フォーカスを奪うと、続けて打った文字がファイルへ入ってしまう
    render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        isOverlayOpen
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('オーバーレイが閉じた時点でエディタにフォーカスする', () => {
    const { rerender } = render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        isOverlayOpen
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
    rerender(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        isOverlayOpen={false}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).toHaveBeenCalled()
  })

  it('同じファイルを閉じて開き直してもフォーカスする', () => {
    // 閉じると Monaco はアンマウントされる。破棄済みインスタンスの参照が残ると
    // 同じパスを開き直したときに古い側でフォーカス要求が消費されてしまう
    const { rerender } = render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).toHaveBeenCalledTimes(1)
    rerender(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(null)}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    mockFocus.mockClear()
    rerender(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        openedFileSignal={{ events: [{ id: 2, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).toHaveBeenCalled()
  })

  it('他のダイアログがフォーカスを持っているときは奪わない', () => {
    // Explorer のリネームダイアログ等が開いている間に読み込みが完了しても、
    // 入力中のダイアログからフォーカスを奪わない
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const input = document.createElement('input')
    dialog.appendChild(input)
    document.body.appendChild(dialog)
    input.focus()

    render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
    expect(input).toHaveFocus()
    dialog.remove()
  })

  it('リネームでパスが変わっただけではフォーカスを奪わない', () => {
    // 開いているファイル(や祖先ディレクトリ)のリネームでも openFile.path は変わる。
    // エクスプローラーで作業中のユーザーからフォーカスを持っていかない
    const { rerender } = render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    mockFocus.mockClear()
    rerender(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile({ ...mockOpenFile, path: '/project/renamed.ts', name: 'renamed.ts' })}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('ダイアログにフォーカスを譲ったあと、無関係な操作でフォーカスを奪い返さない', () => {
    // 譲った時点で要求を取り下げないと、あとからオーバーレイの開閉などで
    // 消費され、別のところへフォーカスが飛ぶ
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const input = document.createElement('input')
    dialog.appendChild(input)
    document.body.appendChild(dialog)
    input.focus()

    const { rerender } = render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
    dialog.remove()

    // 無関係なオーバーレイの開閉(クイックオープンを開いて閉じただけ)
    rerender(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
        isOverlayOpen
      />
    )
    rerender(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('破棄済みのエディタにはフォーカスしない', () => {
    // 同じ path を閉じて開き直した場合、path の比較だけでは旧インスタンスと
    // 区別できない。破棄済みの Monaco はモデルを失うため、それで弾く
    mockEditorModel.current = null
    render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('エクスプローラー経由で最初のファイルを開いてもフォーカスを奪わない', () => {
    // openedFileSignal が進まない経路(moveFocusToEditor 未指定)では、
    // ファイル無し → 有りの変化だけでフォーカス要求を立ててはいけない
    const { rerender } = render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(null)}
        openedFileSignal={{ events: [{ id: 0, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    rerender(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        openedFileSignal={{ events: [{ id: 0, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('要求したファイルと別のファイルが開かれたらフォーカス要求を破棄する', () => {
    // クイックオープンで A を開いた直後、Monaco の onMount 前にエクスプローラーで
    // B を開くと、A の要求が B のマウントで消費されツリーからフォーカスを奪う
    mockEditorModel.current = null // onMount 時点ではまだフォーカスさせない
    const { rerender } = render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    mockEditorModel.current = {}
    mockFocus.mockClear()
    // エクスプローラー経由(信号は進まない)で別ファイルを開く
    rerender(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile({ ...mockOpenFile, path: '/project/other.ts', name: 'other.ts' })}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('フォーカス移動を伴わない信号を受けたら保留中の要求を取り下げる', () => {
    // Quick Open の要求が残っていると、後着の onMount がフォーカスを奪う
    mockEditorModel.current = null
    const { rerender } = render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    mockEditorModel.current = {}
    mockFocus.mockClear()
    // 同じファイルをエクスプローラー経由で開き直す(フォーカス移動を伴わない)
    rerender(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        openedFileSignal={{
          events: [{ id: 2, path: mockOpenFile.path, moveFocusToEditor: false }]
        }}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('信号を伴わない path 変更でも、対象が変われば要求を破棄する', () => {
    // リネームは信号を進めずに openFile.path を変える。要求が残ったままだと
    // 後着の onMount がそれを消費してフォーカスを奪う
    mockEditorModel.current = null // onMount 時点では消費させない
    const signal = {
      events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }]
    }
    const { rerender } = render(
      <EditorPanel {...defaultProps} {...withOpenFile(mockOpenFile)} openedFileSignal={signal} />
    )
    mockEditorModel.current = {}
    mockFocus.mockClear()
    // 信号は据え置きで path だけ変わる(リネーム相当)
    rerender(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile({ ...mockOpenFile, path: '/project/renamed.ts', name: 'renamed.ts' })}
        openedFileSignal={signal}
      />
    )
    // オーバーレイの開閉で要求が消費されないこと
    rerender(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile({ ...mockOpenFile, path: '/project/renamed.ts', name: 'renamed.ts' })}
        openedFileSignal={signal}
        isOverlayOpen
      />
    )
    rerender(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile({ ...mockOpenFile, path: '/project/renamed.ts', name: 'renamed.ts' })}
        openedFileSignal={signal}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('他の要素がフォーカスを持っているときは奪わない(ツリー操作中など)', () => {
    // Quick Open の要求が残ったまま、エクスプローラーのクリックで選択が確定する
    // 前に遅延 onMount が届くと、treeitem からフォーカスを奪ってしまう
    const treeItem = document.createElement('div')
    treeItem.setAttribute('tabindex', '0')
    document.body.appendChild(treeItem)
    treeItem.focus()

    render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        openedFileSignal={{
          events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }]
        }}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
    expect(treeItem).toHaveFocus()
    treeItem.remove()
  })

  it('ファイルを開いていないときはフォーカスしない', () => {
    render(<EditorPanel {...defaultProps} {...withOpenFile(null)} />)
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('Ctrl/Cmd+S コマンドが登録され、実行すると最新の onSave が呼ばれる', () => {
    const onSave = vi.fn()
    const { rerender } = render(
      <EditorPanel {...defaultProps} {...withOpenFile(mockOpenFile)} onSave={onSave} />
    )
    // キーバインド値の算出ロジック（OR演算）自体は editorShortcuts.test.ts で検証済みのため、
    // ここでは EditorPanel が onMount 経由でコマンドを登録することのみを確認する
    expect(mockAddCommand).toHaveBeenCalledWith(expect.any(Number), expect.any(Function))
    const registeredCommand = mockAddCommand.mock.calls[0][1] as () => void

    // onMount 後に onSave が差し替わっても、ref 経由で最新の onSave を呼ぶことを確認する
    const nextOnSave = vi.fn()
    rerender(<EditorPanel {...defaultProps} {...withOpenFile(mockOpenFile)} onSave={nextOnSave} />)

    registeredCommand()

    expect(onSave).not.toHaveBeenCalled()
    expect(nextOnSave).toHaveBeenCalledOnce()
  })

  it('saveError があるときエディタ上部にエラーメッセージが表示される', () => {
    render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        saveError={new Error('保存に失敗しました')}
      />
    )
    expect(screen.getByText('保存に失敗しました')).toBeInTheDocument()
  })
})

describe('EditorPanel — OutputPanel 連携', () => {
  it('isExecuting=true のとき「実行中...」が表示される', () => {
    render(<EditorPanel {...defaultProps} isExecuting={true} />)
    expect(screen.getByText('実行中...')).toBeInTheDocument()
  })

  it('result があるとき OutputPanel にテキストが表示される', () => {
    render(<EditorPanel {...defaultProps} result="回答テキスト" />)
    expect(screen.getByText('回答テキスト')).toBeInTheDocument()
  })

  it('executionError があるときエラーメッセージが表示される', () => {
    render(<EditorPanel {...defaultProps} executionError={new Error('api error')} />)
    expect(screen.getByText('api error')).toBeInTheDocument()
  })

  it('クリアボタンクリックで onClearResult が呼ばれる', async () => {
    const user = userEvent.setup()
    const onClearResult = vi.fn()
    render(<EditorPanel {...defaultProps} result="テキスト" onClearResult={onClearResult} />)
    await user.click(screen.getByRole('button', { name: '出力をクリア' }))
    expect(onClearResult).toHaveBeenCalledOnce()
  })
})

describe('EditorPanel — 複数タブ', () => {
  it('非アクティブなタブのファイルは Monaco にレンダーされない', () => {
    const fileA = {
      path: '/a.ts',
      name: 'a.ts',
      content: 'a',
      savedContent: 'a',
      language: 'typescript'
    }
    const fileB = {
      path: '/b.ts',
      name: 'b.ts',
      content: 'b',
      savedContent: 'b',
      language: 'typescript'
    }
    render(<EditorPanel {...defaultProps} openFiles={[fileA, fileB]} activeFilePath={fileA.path} />)
    expect(screen.getByRole('tab', { name: /^a\.ts/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /^b\.ts/ })).toHaveAttribute('aria-selected', 'false')
  })
})

describe('EditorPanel — diff タブ', () => {
  it('agent の diff の内容が実行の範囲なら、アクティブな diff タブのラベルに実行の番号を付ける', () => {
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'a.txt', kind: 'agent' }]}
        activeDiffTab={{ path: 'a.txt', kind: 'agent' }}
        diffContent={'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n'}
        agentDiffActions={makeAgentDiffActions({ canRevertHunk: false, contentRunNumber: 2 })}
      />
    )
    expect(
      screen.getByRole('tab', { name: /a\.txt \(エージェントの変更・実行 2\)/ })
    ).toBeInTheDocument()
  })

  // agentDiffActions は省略可能な props のため、渡し忘れ・種類の取り違えを型で検知できない(パターン 155)
  it.each([
    ['agent', 1],
    ['unstaged', 0]
  ] as const)('%s の diff タブでは「このハンクを実行前に戻す」を %i 個出す', (kind, count) => {
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'src/index.ts', kind }]}
        activeDiffTab={{ path: 'src/index.ts', kind }}
        diffContent={'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'}
        agentDiffActions={makeAgentDiffActions()}
      />
    )
    expect(screen.queryAllByRole('button', { name: 'このハンクを実行前に戻す' })).toHaveLength(
      count
    )
  })

  // エージェントの変更の diff は patch から戻すため、打ち切ったハンクには戻すボタンを出さない。
  // git status で未追跡でも agent のタブでは useDiffOperations が isActiveFileUntracked を false にする
  // (useDiffOperations.test.ts で固定)。EditorPanel はその値をそのまま DiffView へ渡す
  it('agent の diff タブは、打ち切ったハンクに戻すボタンを出さず、全て表示されているハンクには出す', () => {
    const hunk = (n: number, count: number): string =>
      `@@ -${n},0 +${n},${count} @@\n` +
      Array.from({ length: count }, (_, i) => `+h${n}line${i}`).join('\n') +
      '\n'
    render(
      <EditorPanel
        {...defaultProps}
        isActiveFileUntracked={false}
        diffTabs={[{ path: 'big.txt', kind: 'agent' }]}
        activeDiffTab={{ path: 'big.txt', kind: 'agent' }}
        diffContent={'diff --git a/big.txt b/big.txt\n' + hunk(1, 10) + hunk(100, 2500)}
        agentDiffActions={makeAgentDiffActions()}
      />
    )
    expect(screen.getAllByRole('button', { name: 'このハンクを実行前に戻す' })).toHaveLength(1)
  })

  it('isActiveFileUntracked をそのまま DiffView の isUntracked へ渡す(未追跡の diff は打ち切ってもステージのボタンを出す)', () => {
    const hunk = (n: number, count: number): string =>
      `@@ -${n},0 +${n},${count} @@\n` +
      Array.from({ length: count }, (_, i) => `+h${n}line${i}`).join('\n') +
      '\n'
    render(
      <EditorPanel
        {...defaultProps}
        isActiveFileUntracked
        diffTabs={[{ path: 'big.txt', kind: 'unstaged' }]}
        activeDiffTab={{ path: 'big.txt', kind: 'unstaged' }}
        diffContent={'diff --git a/big.txt b/big.txt\n' + hunk(1, 2500)}
      />
    )
    expect(screen.getAllByRole('button', { name: 'このハンクをステージ' })).toHaveLength(1)
  })

  it('activeDiffTab がある場合、DiffView を表示しMonaco Editorは表示しない', () => {
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'src/index.ts', kind: 'unstaged' }]}
        activeDiffTab={{ path: 'src/index.ts', kind: 'unstaged' }}
        diffContent={'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'}
      />
    )
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('-a')).toBeInTheDocument()
  })

  it('アクティブなファイルが未解決(isActiveFileConflicted)なら、DiffView の代わりに ConflictResolver を表示する', () => {
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'c.txt', kind: 'unstaged' }]}
        activeDiffTab={{ path: 'c.txt', kind: 'unstaged' }}
        diffContent={'diff --cc c.txt\n@@@ -1,1 -1,1 +1,1 @@@\n- a\n'}
        isActiveFileConflicted
        conflictFile={makeConflictFileState({
          file: {
            status: 'parsed',
            stages: { ours: true, theirs: true },
            eol: '\n',
            digests: ['d'],
            segments: [
              {
                kind: 'conflict',
                ours: ['自分の行'],
                theirs: ['相手の行'],
                oursLabel: 'HEAD',
                theirsLabel: 'feature'
              }
            ]
          }
        })}
      />
    )
    expect(screen.getByText('自分の行')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ブロック 1 の自分を採用' })).toBeInTheDocument()
    expect(screen.queryByText('差分はありません')).not.toBeInTheDocument()
    expect(document.querySelector('.diff-view')).toBeNull()
  })

  it('未解決でなければ(解決済み)DiffView を表示し、ConflictResolver は出さない', () => {
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'c.txt', kind: 'unstaged' }]}
        activeDiffTab={{ path: 'c.txt', kind: 'unstaged' }}
        diffContent={'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'}
        isActiveFileConflicted={false}
      />
    )
    expect(screen.getByText('-a')).toBeInTheDocument()
    expect(document.querySelector('.conflict-resolver')).toBeNull()
  })

  it('未解決のとき、diff の読み込み前(diffContent が null)でも解決ビューを出す', () => {
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'c.txt', kind: 'unstaged' }]}
        activeDiffTab={{ path: 'c.txt', kind: 'unstaged' }}
        diffContent={null}
        isActiveFileConflicted
        conflictFile={makeConflictFileState({ isLoading: true })}
      />
    )
    expect(document.querySelector('.conflict-resolver')).not.toBeNull()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('isConflictBlocked のとき、解決ビューのボタンがすべて disabled になる', () => {
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'c.txt', kind: 'unstaged' }]}
        activeDiffTab={{ path: 'c.txt', kind: 'unstaged' }}
        isActiveFileConflicted
        isConflictBlocked
        conflictFile={makeConflictFileState({
          file: {
            status: 'parsed',
            stages: { ours: true, theirs: true },
            eol: '\n',
            digests: [],
            segments: []
          }
        })}
      />
    )
    const buttons = within(
      document.querySelector('.conflict-resolver') as HTMLElement
    ).getAllByRole('button')
    for (const button of buttons) expect(button).toBeDisabled()
  })

  it('diffTabs がある場合、タブバーに diff タブが表示される', () => {
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'src/index.ts', kind: 'unstaged' }]}
        activeDiffTab={{ path: 'src/index.ts', kind: 'unstaged' }}
        diffContent={'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'}
      />
    )
    expect(screen.getByText('src/index.ts (未ステージ差分)')).toBeInTheDocument()
  })

  it('diff タブをクリックすると onActivateDiffTab が呼ばれる', async () => {
    const onActivateDiffTab = vi.fn()
    const otherFile: OpenFile = { ...mockOpenFile, path: '/project/src/other.ts', name: 'other.ts' }
    render(
      <EditorPanel
        {...defaultProps}
        openFiles={[otherFile]}
        activeFilePath={otherFile.path}
        diffTabs={[{ path: 'src/index.ts', kind: 'unstaged' }]}
        activeDiffTab={null}
        onActivateDiffTab={onActivateDiffTab}
        diffContent={null}
      />
    )
    await userEvent.click(screen.getByText('src/index.ts (未ステージ差分)'))
    expect(onActivateDiffTab).toHaveBeenCalledWith({ path: 'src/index.ts', kind: 'unstaged' })
  })

  it('実ファイルタブが無くても、非アクティブな diff タブが残っていれば WelcomeView ではなくタブバーを表示する', () => {
    // openFile/activeDiffTab がどちらも無い状態を「タブが何も無い」とみなして
    // WelcomeView を表示すると、diffTabs に残っている非アクティブな diff タブへ
    // 二度とアクセスできなくなる(タブバー自体が消えるため)。
    // 実ファイルタブに切り替えてから最後の実ファイルタブを閉じた場合に発生しうる
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'src/index.ts', kind: 'unstaged' }]}
        activeDiffTab={null}
      />
    )
    expect(screen.queryByText('welcome.ts')).not.toBeInTheDocument()
    expect(screen.getByText('src/index.ts (未ステージ差分)')).toBeInTheDocument()
  })

  it('実ファイルタブが無く、diff タブも非アクティブな場合、本文が完全な空白にならずプレースホルダーを表示する', () => {
    // タブバーは表示されるようになったが、本文側(editor-body)は
    // activeDiffTab !== null / openFile !== null のどちらも false のままで
    // 何も描画しない分岐が残っており、ユーザーがタブを選び直すまで空白のままになる
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'src/index.ts', kind: 'unstaged' }]}
        activeDiffTab={null}
      />
    )
    expect(screen.getByText('タブを選択してください')).toBeInTheDocument()
  })

  it('ファイルタブをクリックすると onDeactivateDiffTab が呼ばれ、diff タブが非アクティブになると Monaco Editor が表示される', async () => {
    // 以前は diff タブを開くとファイルタブへ戻る経路が無く、activeFilePath は
    // 更新されてもタブバー・本文表示が diff タブに固定されたままになっていた
    const onDeactivateDiffTab = vi.fn()
    const onActivateTab = vi.fn().mockReturnValue(true)
    const { rerender } = render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        diffTabs={[{ path: 'src/other.ts', kind: 'unstaged' }]}
        activeDiffTab={{ path: 'src/other.ts', kind: 'unstaged' }}
        diffContent={'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'}
        onDeactivateDiffTab={onDeactivateDiffTab}
        onActivateTab={onActivateTab}
      />
    )
    // diff タブがアクティブな間は Monaco Editor が表示されない
    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('index.ts'))
    expect(onDeactivateDiffTab).toHaveBeenCalled()
    expect(onActivateTab).toHaveBeenCalledWith(mockOpenFile.path)

    // 親が activeDiffTab を null に更新した状態を再現する
    rerender(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        diffTabs={[{ path: 'src/other.ts', kind: 'unstaged' }]}
        activeDiffTab={null}
        diffContent={'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'}
        onDeactivateDiffTab={onDeactivateDiffTab}
        onActivateTab={onActivateTab}
      />
    )
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
  })

  it('diffError があるとき、diff の上部にエラーメッセージが表示される', () => {
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'src/index.ts', kind: 'unstaged' }]}
        activeDiffTab={{ path: 'src/index.ts', kind: 'unstaged' }}
        diffContent={null}
        diffError={new Error('diff の取得に失敗しました')}
      />
    )
    expect(screen.getByText('diff の取得に失敗しました')).toBeInTheDocument()
  })

  it('diff タブがアクティブで diffContent も diffError も無いとき（取得中）、読み込み中の表示をする', () => {
    // diffContent が null のまま何も表示しないと、取得完了までの間 diff エリアが
    // 完全な空白になり、ユーザーはタブ切替が効いているのか固まっているのか
    // 区別できない
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'src/index.ts', kind: 'unstaged' }]}
        activeDiffTab={{ path: 'src/index.ts', kind: 'unstaged' }}
        diffContent={null}
        diffError={null}
      />
    )
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('isHunkOperationInProgress のとき DiffView に disabled が渡り、ハンクボタンが無効化される', () => {
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'src/index.ts', kind: 'unstaged' }]}
        activeDiffTab={{ path: 'src/index.ts', kind: 'unstaged' }}
        diffContent={'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'}
        isHunkOperationInProgress={true}
      />
    )
    expect(screen.getByRole('button', { name: 'このハンクをステージ' })).toBeDisabled()
  })
})

describe('EditorPanel — ハンクの取り消しの配線', () => {
  const diff = 'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'

  it('canDiscardHunk が真なら DiffView に届き、押すと onDiscardHunk が呼ばれる', async () => {
    const onDiscardHunk = vi.fn()
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'src/index.ts', kind: 'unstaged' }]}
        activeDiffTab={{ path: 'src/index.ts', kind: 'unstaged' }}
        diffContent={diff}
        canDiscardHunk
        onDiscardHunk={onDiscardHunk}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'このハンクを取り消す' }))
    expect(onDiscardHunk).toHaveBeenCalledTimes(1)
    expect(onDiscardHunk).toHaveBeenCalledWith(expect.stringContaining('+b'), '@@ -1,1 +1,1 @@')
  })

  it('canDiscardHunk が偽なら取り消しボタンは出ない', () => {
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'src/index.ts', kind: 'unstaged' }]}
        activeDiffTab={{ path: 'src/index.ts', kind: 'unstaged' }}
        diffContent={diff}
      />
    )
    expect(screen.queryByRole('button', { name: 'このハンクを取り消す' })).not.toBeInTheDocument()
  })
})

// エージェントの変更の diff タブでハンクを戻した後の読み上げとフォーカス(PR #47 B-2。パターン 86・87・152)
describe('EditorPanel — エージェントの変更のハンクを戻した後', () => {
  const agentDiff = 'diff --git a/a.txt b/a.txt\n@@ -1,1 +1,1 @@\n-a\n+b\n'
  const agentTabProps = {
    diffTabs: [{ path: 'a.txt', kind: 'agent' }] as DiffTabKey[],
    activeDiffTab: { path: 'a.txt', kind: 'agent' } as DiffTabKey,
    diffContent: agentDiff
  }

  it('結果の読み上げの要素は、diff タブが無い間も常設し、diff の作り直し・タブを閉じても同じ要素に文言を入れる', () => {
    const { container, rerender } = render(
      <EditorPanel {...defaultProps} {...agentTabProps} agentDiffActions={makeAgentDiffActions()} />
    )
    const live = container.querySelector('.agent-diff__live')
    expect(live).not.toBeNull()
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toHaveTextContent('')
    // 最後のハンクを戻すとタブが閉じる(Welcome に戻る)
    rerender(
      <EditorPanel
        {...defaultProps}
        agentDiffActions={makeAgentDiffActions({
          notice: { text: 'ハンクを実行前の状態に戻しました', id: 1 }
        })}
      />
    )
    expect(container.querySelector('.agent-diff__live')).toBe(live)
    expect(live).toHaveTextContent('ハンクを実行前の状態に戻しました')
  })

  it('押したボタンが diff の作り直しで消えたら、フォーカスをアクティブなタブへ戻す', async () => {
    const user = userEvent.setup()
    const actions = makeAgentDiffActions()
    const { rerender } = render(
      <EditorPanel {...defaultProps} {...agentTabProps} agentDiffActions={actions} />
    )
    const button = screen.getByRole('button', { name: 'このハンクを実行前に戻す' })
    await user.click(button)
    expect(actions.onRevertHunk).toHaveBeenCalledOnce()
    expect(button).toHaveFocus()
    // 取り直しの間は diffContent が null になり、DiffView ごと消える
    rerender(
      <EditorPanel
        {...defaultProps}
        {...agentTabProps}
        diffContent={null}
        agentDiffActions={actions}
      />
    )
    expect(screen.getByRole('tab', { selected: true })).toHaveFocus()
  })

  it('最後のハンクを戻してタブが閉じたら、次にアクティブになったタブへ戻す', async () => {
    const user = userEvent.setup()
    const actions = makeAgentDiffActions()
    const { rerender } = render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        {...agentTabProps}
        agentDiffActions={actions}
      />
    )
    await user.click(screen.getByRole('button', { name: 'このハンクを実行前に戻す' }))
    rerender(
      <EditorPanel {...defaultProps} {...withOpenFile(mockOpenFile)} agentDiffActions={actions} />
    )
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('index.ts')
    expect(screen.getByRole('tab', { selected: true })).toHaveFocus()
  })

  it('利用者がエディタの外へ移したフォーカスは奪わない', async () => {
    const user = userEvent.setup()
    const actions = makeAgentDiffActions()
    const { rerender } = render(
      <>
        <button type="button">外</button>
        <EditorPanel {...defaultProps} {...agentTabProps} agentDiffActions={actions} />
      </>
    )
    await user.click(screen.getByRole('button', { name: 'このハンクを実行前に戻す' }))
    await user.click(screen.getByRole('button', { name: '外' }))
    rerender(
      <>
        <button type="button">外</button>
        <EditorPanel
          {...defaultProps}
          {...agentTabProps}
          diffContent={null}
          agentDiffActions={actions}
        />
      </>
    )
    expect(screen.getByRole('button', { name: '外' })).toHaveFocus()
  })

  it('ハンクを戻していなければ、diff が消えてもフォーカスを動かさない', () => {
    const { rerender } = render(
      <EditorPanel {...defaultProps} {...agentTabProps} agentDiffActions={makeAgentDiffActions()} />
    )
    screen.getByRole('button', { name: 'このハンクを実行前に戻す' }).focus()
    rerender(
      <EditorPanel
        {...defaultProps}
        {...agentTabProps}
        diffContent={null}
        agentDiffActions={makeAgentDiffActions()}
      />
    )
    expect(screen.getByRole('tab', { selected: true })).not.toHaveFocus()
  })
})

// ハンクを戻した後のフォーカスを、実機(createRoot)と同じ描画の順で確かめる(PR #47 の 2 回目のレビュー)。
// act の中では更新がまとめて流されるため、実際の順(押した描画で実行中の disabled → 戻す操作の完了〈マイクロタスク〉 →
// 一覧の取り直しの描画〈Scheduler のタスク〉 → 一覧が変わった描画の effect でタブを閉じる描画)を通らない。
// act を使わずに createRoot で描画し、イベントはネイティブに送る。配線は useAgentChangesRevert・useAgentChangesWiring と同じ順に組む
describe('EditorPanel — ハンクを戻した後のフォーカス(実機と同じ描画の順)', () => {
  const agentDiff = 'diff --git a/a.txt b/a.txt\n@@ -1,1 +1,1 @@\n-a\n+b\n'
  const agentTab: DiffTabKey = { path: 'a.txt', kind: 'agent' }
  const REVERTING = '戻す操作の実行中です'

  interface Deferred {
    promise: Promise<void>
    resolve: () => void
  }
  const deferred = (): Deferred => {
    let resolve = (): void => undefined
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  interface HarnessOptions {
    /** 戻した後の一覧に、戻したファイルが残るか(途中のハンクなら残る。最後のハンクなら消えてタブが閉じる) */
    remainsInList: boolean
    /** 確認の結果 */
    confirmResult: boolean
    /** 戻す操作(main への依頼)。resolve するまで実行中のまま */
    revertApi: Deferred
    withOtherFile: boolean
  }

  // 一覧の取り直し(更新ボタン)を外から呼ぶ
  let refreshFromOutside: () => void = () => undefined

  function Harness({
    remainsInList,
    confirmResult,
    revertApi,
    withOtherFile
  }: HarnessOptions): React.JSX.Element {
    const [isReverting, setIsReverting] = useState(false)
    const [listVersion, setListVersion] = useState(0)
    const [isInList, setIsInList] = useState(true)
    const [diffTabs, setDiffTabs] = useState<DiffTabKey[]>([agentTab])
    const [activeDiffTab, setActiveDiffTab] = useState<DiffTabKey | null>(agentTab)
    const [diffContent, setDiffContent] = useState<string | null>(agentDiff)

    // useAgentChanges.refresh: 取得(非同期)の後に setView。await の後なので、イベントの外の既定の優先度の描画になる
    const refreshList = async (): Promise<void> => {
      await Promise.resolve()
      setIsInList(remainsInList)
      setListVersion((v) => v + 1)
    }
    refreshFromOutside = () => void refreshList()
    // useAgentChangesWiring: 一覧が変わった描画の effect で、一覧から消えたパスの diff タブを閉じる
    useOnChange(listVersion, () => {
      if (isInList) return
      setDiffTabs([])
      setActiveDiffTab(null)
    })
    // useDiffOperations.refreshDiff: 取り直しの間は diffContent が null
    const refreshDiff = (): void => {
      setDiffContent(null)
      void Promise.resolve().then(() => setDiffContent(agentDiff))
    }
    // useAgentChangesRevert.revertHunk と同じ順(確認 → run〈同期で実行中に〉 → 完了で実行中を外す → 読み直し → 一覧の取り直し)
    const revertHunk = async (): Promise<void> => {
      if (!confirmResult) return
      setIsReverting(true)
      try {
        await revertApi.promise
      } finally {
        setIsReverting(false)
      }
      await Promise.resolve() // reloadOpenFile
      await Promise.resolve() // refreshTree
      await Promise.resolve() // refreshGitStatus
      await refreshList()
      refreshDiff()
    }
    const files = withOtherFile ? withOpenFile(mockOpenFile) : withOpenFile(null)
    return (
      <>
        <button type="button">外</button>
        <EditorPanel
          {...defaultProps}
          {...files}
          diffTabs={diffTabs}
          activeDiffTab={activeDiffTab}
          diffContent={diffContent}
          agentDiffActions={makeAgentDiffActions({
            disabledReason: isReverting ? REVERTING : null,
            onRevertHunk: () => void revertHunk()
          })}
        />
      </>
    )
  }

  let container: HTMLDivElement
  let root: Root
  let previousActEnvironment: unknown
  const globalWithAct = globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }

  beforeEach(() => {
    previousActEnvironment = globalWithAct.IS_REACT_ACT_ENVIRONMENT
    globalWithAct.IS_REACT_ACT_ENVIRONMENT = false
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    root.unmount()
    container.remove()
    globalWithAct.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  // Scheduler のタスク(マクロタスク)とマイクロタスクを流す
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await new Promise<void>((r) => setTimeout(r, 0))
  }
  const mount = async (options: Partial<HarnessOptions> = {}): Promise<Deferred> => {
    const revertApi = options.revertApi ?? deferred()
    root.render(
      <Harness
        remainsInList={false}
        confirmResult={true}
        withOtherFile={true}
        {...options}
        revertApi={revertApi}
      />
    )
    await settle()
    return revertApi
  }
  const revertButton = (): HTMLButtonElement =>
    within(container).getByRole('button', { name: 'このハンクを実行前に戻す' })
  const selectedTab = (): HTMLElement => within(container).getByRole('tab', { selected: true })
  // マウスで押す(押下 → フォーカス → click の順)
  const pressWithPointer = (element: HTMLElement): void => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    element.focus()
    element.click()
  }
  // キーボードで押す(フォーカスのあるボタンで Enter の keydown → click の順)
  const pressWithEnter = (element: HTMLElement): void => {
    element.focus()
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    element.click()
  }

  it('最後のハンクを戻すと、実行中に押したボタンが押せなくなり、一覧の取り直しの後にタブが閉じても、次にアクティブになったタブへ戻す', async () => {
    const revertApi = await mount()
    pressWithPointer(revertButton())
    await settle()
    // 実行中は押したボタンが disabled になる。フォーカスはアクティブなタブ(diff タブ)へ移る
    expect(revertButton()).toBeDisabled()
    expect(selectedTab()).toHaveTextContent('a.txt')
    expect(selectedTab()).toHaveFocus()
    revertApi.resolve()
    await settle()
    expect(within(container).queryByRole('tab', { name: /a\.txt/ })).toBeNull()
    expect(selectedTab()).toHaveTextContent('index.ts')
    expect(selectedTab()).toHaveFocus()
  })

  it('キーボード(Enter)で押した場合も、次にアクティブになったタブへ戻す', async () => {
    const revertApi = await mount()
    pressWithEnter(revertButton())
    await settle()
    expect(selectedTab()).toHaveFocus()
    revertApi.resolve()
    await settle()
    expect(selectedTab()).toHaveTextContent('index.ts')
    expect(selectedTab()).toHaveFocus()
  })

  it('途中のハンクを戻した後も、作り直された diff のタブにフォーカスが残る', async () => {
    const revertApi = await mount({ remainsInList: true, withOtherFile: false })
    pressWithPointer(revertButton())
    await settle()
    revertApi.resolve()
    await settle()
    // diff は作り直されて、押せるボタンが戻っている
    expect(revertButton()).toBeEnabled()
    expect(selectedTab()).toHaveTextContent('a.txt')
    expect(selectedTab()).toHaveFocus()
  })

  it('戻す確認をキャンセルした後、本文をクリックしてフォーカスが外れても、タブへ飛ばない', async () => {
    await mount({ confirmResult: false, remainsInList: true, withOtherFile: false })
    const button = revertButton()
    pressWithPointer(button)
    await settle()
    expect(button).toHaveFocus()
    // diff の本文の文字(フォーカスできない要素)をクリックすると、フォーカスは body に落ちる
    const text = container.querySelector<HTMLElement>('.editor-body')
    expect(text).not.toBeNull()
    text?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    button.blur()
    expect(document.activeElement).toBe(document.body)
    // その後の無関係な描画(一覧の取り直し)
    refreshFromOutside()
    await settle()
    expect(selectedTab()).not.toHaveFocus()
    expect(document.activeElement).toBe(document.body)
  })

  // 予約の間だけ document に付けるリスナー(pointerdown・keydown の capture)が、予約を捨てたとき・アンマウントで外れるか
  const documentListeners = (): {
    added: () => string[]
    removed: () => string[]
    restore: () => void
  } => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const pick = (calls: unknown[][]): string[] =>
      calls
        .filter(
          ([type, , options]) => (type === 'pointerdown' || type === 'keydown') && options === true
        )
        .map(([type]) => String(type))
    return {
      added: () => pick(add.mock.calls),
      removed: () => pick(remove.mock.calls),
      restore: () => {
        add.mockRestore()
        remove.mockRestore()
      }
    }
  }

  it('予約の間だけ document にリスナーを付け、利用者の次の操作・アンマウントで外す', async () => {
    const listeners = documentListeners()
    try {
      await mount({ confirmResult: false, remainsInList: true, withOtherFile: false })
      pressWithPointer(revertButton())
      expect(listeners.added()).toEqual(['pointerdown', 'keydown'])
      expect(listeners.removed()).toEqual([])
      // 利用者の次の操作で外す
      within(container)
        .getByRole('button', { name: '外' })
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      expect(listeners.removed()).toEqual(['pointerdown', 'keydown'])
      // 予約し直してからアンマウントしても外す
      pressWithPointer(revertButton())
      expect(listeners.added()).toHaveLength(4)
      root.unmount()
      expect(listeners.removed()).toHaveLength(4)
      root = createRoot(container)
    } finally {
      listeners.restore()
    }
  })

  it('アクティブなタブが無くなったら予約を捨て、リスナーを外す', async () => {
    const listeners = documentListeners()
    try {
      const user = userEvent.setup()
      const other: DiffTabKey = { path: 'b.txt', kind: 'agent' }
      const actions = makeAgentDiffActions()
      root.unmount()
      root = createRoot(container)
      const renderPanel = (tabs: DiffTabKey[], active: DiffTabKey | null): void =>
        root.render(
          <EditorPanel
            {...defaultProps}
            diffTabs={tabs}
            activeDiffTab={active}
            diffContent={agentDiff}
            agentDiffActions={actions}
          />
        )
      renderPanel([agentTab, other], agentTab)
      await settle()
      await user.click(revertButton())
      expect(listeners.removed()).toEqual([])
      // 非アクティブな diff タブだけが残る(アクティブなタブが無い)
      renderPanel([other], null)
      await settle()
      expect(listeners.removed()).toEqual(['pointerdown', 'keydown'])
      // 後で b.txt がアクティブになっても、フォーカスを奪わない
      ;(document.activeElement as HTMLElement | null)?.blur()
      renderPanel([other], other)
      await settle()
      expect(selectedTab()).not.toHaveFocus()
    } finally {
      listeners.restore()
    }
  })

  it('実行中に利用者がエディタの外へ移したフォーカスは、タブが閉じても奪わない', async () => {
    const revertApi = await mount()
    pressWithPointer(revertButton())
    await settle()
    pressWithPointer(within(container).getByRole('button', { name: '外' }))
    revertApi.resolve()
    await settle()
    expect(within(container).getByRole('button', { name: '外' })).toHaveFocus()
  })
})

describe('EditorPanel: エディタのマウントの通知(onEditorMount)', () => {
  it('現在のファイルのエディタがマウントされたら、そのエディタとマウントの時点のファイルのパスを渡す', () => {
    const onEditorMount = vi.fn<(editor: SelectionRangeEditor, filePath: string) => void>()
    render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        onEditorMount={onEditorMount}
      />
    )
    expect(onEditorMount).toHaveBeenCalledOnce()
    const [instance, filePath] = onEditorMount.mock.calls[0]
    expect(filePath).toBe(mockOpenFile.path)
    expect(instance.getModel()).toBe(mockEditorModel.current)
  })

  it('差分のタブの表示中はエディタをマウントしないので呼ばない', () => {
    const onEditorMount = vi.fn<(editor: SelectionRangeEditor, filePath: string) => void>()
    const diffTab: DiffTabKey = { path: mockOpenFile.path, kind: 'unstaged' }
    render(
      <EditorPanel
        {...defaultProps}
        {...withOpenFile(mockOpenFile)}
        diffTabs={[diffTab]}
        activeDiffTab={diffTab}
        diffContent=""
        onEditorMount={onEditorMount}
      />
    )
    expect(onEditorMount).not.toHaveBeenCalled()
  })
})
