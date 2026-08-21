import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import {
  mockAddCommand,
  mockFocus,
  mockEditorModel
} from '../../__tests__/__mocks__/@monaco-editor/react'
import type { OpenedFileEvent } from '../../hooks/useFileSystem'
import type { OpenFile } from '../../types'
import EditorPanel from '../EditorPanel'

const mockOpenFile: OpenFile = {
  path: '/project/src/index.ts',
  name: 'index.ts',
  content: 'const x = 1',
  savedContent: 'const x = 1',
  language: 'typescript'
}

const defaultProps = {
  openFile: null as OpenFile | null,
  isDirty: false,
  isSaving: false,
  saveError: null as Error | null,
  onChangeContent: vi.fn(),
  onSave: vi.fn(),
  onCloseFile: vi.fn(),
  isExecuting: false,
  result: null as string | null,
  streamingText: '',
  executionError: null as Error | null,
  onClearResult: vi.fn(),
  onCancelExecution: vi.fn(),
  isOverlayOpen: false,
  openedFileSignal: { events: [] as OpenedFileEvent[] }
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

  it('"welcome.ts" タブには閉じるボタンが表示されない（実ファイルが開かれていないため）', () => {
    render(<EditorPanel {...defaultProps} />)
    expect(screen.queryByLabelText('タブを閉じる')).not.toBeInTheDocument()
  })
})

describe('EditorPanel — openFile あり', () => {
  it('ファイル名がタブに表示される', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  it('タブに editor-tab--active クラスが付く', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} />)
    expect(screen.getByText('index.ts')).toHaveClass('editor-tab--active')
  })

  it('"welcome.ts" タブは表示されない', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} />)
    expect(screen.queryByText('welcome.ts')).not.toBeInTheDocument()
  })

  it('実ファイルが開かれているときは閉じるボタンが表示される', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} />)
    expect(screen.getByLabelText('タブを閉じる')).toBeInTheDocument()
  })

  it('閉じるボタンクリックで onCloseFile が呼ばれる', async () => {
    const user = userEvent.setup()
    const onCloseFile = vi.fn()
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} onCloseFile={onCloseFile} />)
    await user.click(screen.getByLabelText('タブを閉じる'))
    expect(onCloseFile).toHaveBeenCalledOnce()
  })

  it('Monaco Editor のモックが描画される', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} />)
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
  })

  it('エディタは読み取り専用ではない（編集可能）', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} />)
    expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-readonly', 'false')
  })

  it('エディタでの入力が onChangeContent を呼ぶ', async () => {
    const user = userEvent.setup()
    const onChangeContent = vi.fn()
    render(
      <EditorPanel {...defaultProps} openFile={mockOpenFile} onChangeContent={onChangeContent} />
    )
    await user.type(screen.getByTestId('monaco-editor-textarea'), 'x')
    expect(onChangeContent).toHaveBeenCalled()
  })

  it('isDirty=true のとき保存ボタンが有効化される', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} isDirty={true} />)
    expect(screen.getByLabelText('保存')).not.toBeDisabled()
  })

  it('isDirty=false のとき保存ボタンが無効化される', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} isDirty={false} />)
    expect(screen.getByLabelText('保存')).toBeDisabled()
  })

  it('保存ボタンクリックで onSave が呼ばれる', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} isDirty={true} onSave={onSave} />)
    await user.click(screen.getByLabelText('保存'))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('isSaving=true のとき、isDirty=true でも保存ボタンが無効化される（多重保存防止）', () => {
    render(<EditorPanel {...defaultProps} openFile={mockOpenFile} isDirty={true} isSaving={true} />)
    expect(screen.getByLabelText('保存')).toBeDisabled()
  })

  it('未保存インジケータは isDirty=true のときのみ表示される', () => {
    const { rerender } = render(
      <EditorPanel {...defaultProps} openFile={mockOpenFile} isDirty={false} />
    )
    expect(document.querySelector('.editor-tab__dirty-dot')).not.toBeInTheDocument()

    rerender(<EditorPanel {...defaultProps} openFile={mockOpenFile} isDirty={true} />)
    expect(document.querySelector('.editor-tab__dirty-dot')).toBeInTheDocument()
  })

  it('ファイルを開いたときエディタにフォーカスする', () => {
    // クイックオープンから Enter でファイルを開くと、ダイアログの復帰先だった
    // 旧エディタは key 変更で再マウントされて DOM から消えている。
    // 新しいエディタが自分でフォーカスを取らないと body に取り残される
    render(
      <EditorPanel
        {...defaultProps}
        openFile={mockOpenFile}
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
        openFile={mockOpenFile}
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
        openFile={mockOpenFile}
        isOverlayOpen
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
    rerender(
      <EditorPanel
        {...defaultProps}
        openFile={mockOpenFile}
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
        openFile={mockOpenFile}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).toHaveBeenCalledTimes(1)
    rerender(
      <EditorPanel
        {...defaultProps}
        openFile={null}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    mockFocus.mockClear()
    rerender(
      <EditorPanel
        {...defaultProps}
        openFile={mockOpenFile}
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
        openFile={mockOpenFile}
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
        openFile={mockOpenFile}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    mockFocus.mockClear()
    rerender(
      <EditorPanel
        {...defaultProps}
        openFile={{ ...mockOpenFile, path: '/project/renamed.ts', name: 'renamed.ts' }}
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
        openFile={mockOpenFile}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
    dialog.remove()

    // 無関係なオーバーレイの開閉(クイックオープンを開いて閉じただけ)
    rerender(
      <EditorPanel
        {...defaultProps}
        openFile={mockOpenFile}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
        isOverlayOpen
      />
    )
    rerender(
      <EditorPanel
        {...defaultProps}
        openFile={mockOpenFile}
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
        openFile={mockOpenFile}
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
        openFile={null}
        openedFileSignal={{ events: [{ id: 0, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    rerender(
      <EditorPanel
        {...defaultProps}
        openFile={mockOpenFile}
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
        openFile={mockOpenFile}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    mockEditorModel.current = {}
    mockFocus.mockClear()
    // エクスプローラー経由(信号は進まない)で別ファイルを開く
    rerender(
      <EditorPanel
        {...defaultProps}
        openFile={{ ...mockOpenFile, path: '/project/other.ts', name: 'other.ts' }}
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
        openFile={mockOpenFile}
        openedFileSignal={{ events: [{ id: 1, path: mockOpenFile.path, moveFocusToEditor: true }] }}
      />
    )
    mockEditorModel.current = {}
    mockFocus.mockClear()
    // 同じファイルをエクスプローラー経由で開き直す(フォーカス移動を伴わない)
    rerender(
      <EditorPanel
        {...defaultProps}
        openFile={mockOpenFile}
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
      <EditorPanel {...defaultProps} openFile={mockOpenFile} openedFileSignal={signal} />
    )
    mockEditorModel.current = {}
    mockFocus.mockClear()
    // 信号は据え置きで path だけ変わる(リネーム相当)
    rerender(
      <EditorPanel
        {...defaultProps}
        openFile={{ ...mockOpenFile, path: '/project/renamed.ts', name: 'renamed.ts' }}
        openedFileSignal={signal}
      />
    )
    // オーバーレイの開閉で要求が消費されないこと
    rerender(
      <EditorPanel
        {...defaultProps}
        openFile={{ ...mockOpenFile, path: '/project/renamed.ts', name: 'renamed.ts' }}
        openedFileSignal={signal}
        isOverlayOpen
      />
    )
    rerender(
      <EditorPanel
        {...defaultProps}
        openFile={{ ...mockOpenFile, path: '/project/renamed.ts', name: 'renamed.ts' }}
        openedFileSignal={signal}
      />
    )
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('ファイルを開いていないときはフォーカスしない', () => {
    render(<EditorPanel {...defaultProps} openFile={null} />)
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('Ctrl/Cmd+S コマンドが登録され、実行すると最新の onSave が呼ばれる', () => {
    const onSave = vi.fn()
    const { rerender } = render(
      <EditorPanel {...defaultProps} openFile={mockOpenFile} onSave={onSave} />
    )
    // キーバインド値の算出ロジック（OR演算）自体は editorShortcuts.test.ts で検証済みのため、
    // ここでは EditorPanel が onMount 経由でコマンドを登録することのみを確認する
    expect(mockAddCommand).toHaveBeenCalledWith(expect.any(Number), expect.any(Function))
    const registeredCommand = mockAddCommand.mock.calls[0][1] as () => void

    // onMount 後に onSave が差し替わっても、ref 経由で最新の onSave を呼ぶことを確認する
    const nextOnSave = vi.fn()
    rerender(<EditorPanel {...defaultProps} openFile={mockOpenFile} onSave={nextOnSave} />)

    registeredCommand()

    expect(onSave).not.toHaveBeenCalled()
    expect(nextOnSave).toHaveBeenCalledOnce()
  })

  it('saveError があるときエディタ上部にエラーメッセージが表示される', () => {
    render(
      <EditorPanel
        {...defaultProps}
        openFile={mockOpenFile}
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
