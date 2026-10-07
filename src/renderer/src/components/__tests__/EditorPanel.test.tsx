import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import {
  mockAddCommand,
  mockFocus,
  mockEditorModel
} from '../../__tests__/__mocks__/@monaco-editor/react'
import type { OpenedFileEvent } from '../../hooks/useFileSystem'
import type { OpenFile } from '../../types'
import type { DiffTabKey } from '../../hooks/useDiffTabs'
import EditorPanel from '../EditorPanel'
import { makeConflictFileState } from '../../__tests__/makeConflictFileState'

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
  isConflictBlocked: false
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
        agentDiffActions={{
          canRevertHunk: true,
          disabledReason: null,
          error: null,
          onRevertHunk: vi.fn()
        }}
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
        agentDiffActions={{
          canRevertHunk: true,
          disabledReason: null,
          error: null,
          onRevertHunk: vi.fn()
        }}
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
