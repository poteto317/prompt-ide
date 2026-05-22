import Editor from '@monaco-editor/react'
import { editorOptions } from '../lib/editorOptions'
import type { OpenFile } from '../types'
import WelcomeView from './editor/WelcomeView'
import EditorTabs from './editor/EditorTabs'

const fileEditorOptions = { ...editorOptions, readOnly: false }

interface Props {
  openFile: OpenFile | null
}

export default function EditorPanel({ openFile }: Props) {
  if (openFile === null) {
    return <WelcomeView />
  }

  return (
    <div className="editor-panel">
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
    </div>
  )
}
