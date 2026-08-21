import { useCallback, useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { editorOptions } from '../lib/editorOptions'
import { registerSaveCommand } from '../lib/editorShortcuts'
import { useLatestRef } from '../hooks/useLatestRef'
import type { OpenFile } from '../types'
import WelcomeView from './editor/WelcomeView'
import EditorTabs from './editor/EditorTabs'
import OutputPanel from './output/OutputPanel'

interface Props {
  openFile: OpenFile | null
  isDirty: boolean
  isSaving: boolean
  saveError: Error | null
  onChangeContent: (content: string) => void
  onSave: () => void
  onCloseFile: () => void
  isExecuting: boolean
  result: string | null
  streamingText: string
  executionError: Error | null
  onClearResult: () => void
  onCancelExecution: () => void
  /** フォーカスを持つモーダル(クイックオープン等)が開いているか */
  isOverlayOpen: boolean
  /** ファイルを開くたびに増える信号。リネームによる path 変更と区別するために使う */
  openedFileSignal: number
}

// フォーカスを保持しているのがダイアログの中かどうか。
// isOverlayOpen が示すクイックオープン以外にも、Explorer のリネームダイアログなど
// フォーカスを持つモーダルがあるため、実際のフォーカス位置からも判定する
const isFocusInsideDialog = (): boolean => {
  const active = document.activeElement
  return active instanceof Element && active.closest('[role="dialog"]') !== null
}

export default function EditorPanel({
  openFile,
  isDirty,
  isSaving,
  saveError,
  onChangeContent,
  onSave,
  onCloseFile,
  isExecuting,
  result,
  streamingText,
  executionError,
  onClearResult,
  onCancelExecution,
  isOverlayOpen,
  openedFileSignal
}: Props) {
  // Monaco の onMount はファイル切替時の再マウント以外では再発火しないため、
  // Ctrl/Cmd+S が常に最新の onSave を呼べるよう ref 経由で参照する。
  const onSaveRef = useLatestRef(onSave)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const openFilePath = openFile?.path ?? null
  const hasOpenFile = openFilePath !== null
  // ファイルを開いた直後にそのまま入力を始められるようにする。
  // key={openFile.path} により切替のたびに再マウントされるため、ここで取らないと
  // クイックオープン経由ではフォーカスが body に残ってしまう。
  const pendingFocusRef = useRef(false)
  // editorRef が保持しているインスタンスがどのファイルのものか。
  // ファイル切替直後は前のファイルのインスタンスが残っているため、これを見ないと
  // 古いインスタンスでフォーカス要求を消費してしまう
  const mountedPathRef = useRef<string | null>(null)
  // Monaco の onMount は非同期に発火するため、ハンドラ側から最新の値を読む
  const isOverlayOpenRef = useLatestRef(isOverlayOpen)
  const openFilePathRef = useLatestRef(openFilePath)

  // オーバーレイが開いている間はフォーカスを奪わない。読み込み中にクイックオープンを
  // 開き直した場合に持っていくと、続けて打った文字がファイルへ入ってしまうため。
  // エディタのマウントとオーバーレイが閉じるのはどちらが先になるか決まらないので、
  // 両方から呼んで先に条件が揃ったほうで受け取る。
  const focusEditorIfPending = useCallback((): void => {
    if (!pendingFocusRef.current || isOverlayOpenRef.current) return
    if (isFocusInsideDialog()) {
      // 入力中のダイアログへ譲った時点で要求は取り下げる。残しておくと、
      // 無関係なオーバーレイの開閉であとから消費され、フォーカスが飛ぶ
      pendingFocusRef.current = false
      return
    }
    const editorInstance = editorRef.current
    if (editorInstance === null || mountedPathRef.current !== openFilePathRef.current) return
    // 同じ path を閉じて開き直した場合、path の比較だけでは旧インスタンスと
    // 区別できない。破棄済みの Monaco はモデルを失うため、生存確認で弾く
    if (editorInstance.getModel() === null) return
    pendingFocusRef.current = false
    editorInstance.focus()
  }, [isOverlayOpenRef, openFilePathRef])

  // 「開いた」信号でのみ要求を立てる。openFilePath はリネームでも変わるため、
  // path の変化を使うとエクスプローラーで作業中にフォーカスを奪ってしまう
  useEffect(() => {
    if (!hasOpenFile) {
      // ファイルを閉じると Monaco はアンマウントされる。破棄済みのインスタンスを
      // 掴んだままだと、同じパスを開き直したときに古い側でフォーカス要求を
      // 消費してしまい、新しいエディタが入力を受け取れない
      editorRef.current = null
      mountedPathRef.current = null
      pendingFocusRef.current = false
      return
    }
    pendingFocusRef.current = true
  }, [openedFileSignal, hasOpenFile])

  useEffect(() => {
    focusEditorIfPending()
  }, [openedFileSignal, isOverlayOpen, focusEditorIfPending])

  return (
    <div className="editor-panel">
      {openFile === null ? (
        <WelcomeView />
      ) : (
        <>
          <EditorTabs
            fileName={openFile.name}
            isDirty={isDirty}
            isSaving={isSaving}
            saveError={saveError}
            onSave={onSave}
            onClose={onCloseFile}
          />
          <div className="editor-body">
            <Editor
              key={openFile.path}
              height="100%"
              language={openFile.language}
              theme="vs-dark"
              value={openFile.content}
              options={editorOptions}
              onChange={(value) => onChangeContent(value ?? '')}
              onMount={(editorInstance, monaco) => {
                // onMount は非同期に発火するため、素早く切り替えたときに
                // 破棄済みの古いファイルの callback が後から届くことがある。
                // 現在のファイルのものだけを保持する
                if (openFilePathRef.current !== openFile.path) return
                // 破棄済みインスタンスの遅延 callback で現在の参照を壊さない
                if (editorInstance.getModel() === null) return
                editorRef.current = editorInstance
                mountedPathRef.current = openFile.path
                registerSaveCommand(editorInstance, monaco, () => onSaveRef.current())
                focusEditorIfPending()
              }}
            />
          </div>
        </>
      )}
      <OutputPanel
        isExecuting={isExecuting}
        result={result}
        streamingText={streamingText}
        executionError={executionError}
        onClear={onClearResult}
        onCancel={onCancelExecution}
      />
    </div>
  )
}
