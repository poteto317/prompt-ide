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
  isOverlayOpen
}: Props) {
  // Monaco の onMount はファイル切替時の再マウント以外では再発火しないため、
  // Ctrl/Cmd+S が常に最新の onSave を呼べるよう ref 経由で参照する。
  const onSaveRef = useLatestRef(onSave)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const openFilePath = openFile?.path ?? null
  // ファイルを開いた直後にそのまま入力を始められるようにする。
  // key={openFile.path} により切替のたびに再マウントされるため、ここで取らないと
  // クイックオープン経由ではフォーカスが body に残ってしまう。
  const pendingFocusRef = useRef(false)
  // 現在 editorRef が保持しているインスタンスがどのファイルのものか。
  // ファイル切替直後は前のファイルの(破棄済みの)インスタンスが残っているため、
  // これを見ないと古いインスタンスでフォーカス要求を消費してしまう
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
    if (editorRef.current === null || mountedPathRef.current !== openFilePathRef.current) return
    pendingFocusRef.current = false
    editorRef.current.focus()
  }, [isOverlayOpenRef, openFilePathRef])

  useEffect(() => {
    if (openFilePath === null) return
    pendingFocusRef.current = true
  }, [openFilePath])

  useEffect(() => {
    focusEditorIfPending()
  }, [openFilePath, isOverlayOpen, focusEditorIfPending])

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
