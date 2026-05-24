import Editor from '@monaco-editor/react'
import { editorOptions } from '../lib/editorOptions'
import type { OpenFile } from '../types'
import WelcomeView from './editor/WelcomeView'
import EditorTabs from './editor/EditorTabs'
import OutputPanel from './output/OutputPanel'

const fileEditorOptions = { ...editorOptions, readOnly: true }

interface Props {
  openFile: OpenFile | null
  isExecuting: boolean
  result: string | null
  executionError: Error | null
  onClearResult: () => void
}

export default function EditorPanel({ openFile, isExecuting, result, executionError, onClearResult }: Props) {
  return (
    <div className="editor-panel">
      {openFile === null ? (
        <WelcomeView />
      ) : (
        <>
          <EditorTabs fileName={openFile.name} />
          <div className="editor-body">
            <Editor
              key={openFile.path}
              height="100%"
              language={openFile.language}
              theme="vs-dark"
              value={openFile.content}
              options={fileEditorOptions}
            />
          </div>
        </>
      )}
      <OutputPanel
        isExecuting={isExecuting}
        result={result}
        executionError={executionError}
        onClear={onClearResult}
      />
    </div>
  )
}
