import Editor from '@monaco-editor/react'
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
  onCancelExecution
}: Props) {
  // Monaco の onMount はファイル切替時の再マウント以外では再発火しないため、
  // Ctrl/Cmd+S が常に最新の onSave を呼べるよう ref 経由で参照する。
  const onSaveRef = useLatestRef(onSave)

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
              onMount={(editorInstance, monaco) =>
                registerSaveCommand(editorInstance, monaco, () => onSaveRef.current())
              }
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
