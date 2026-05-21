import Editor from '@monaco-editor/react'
import { WELCOME_CODE } from '../config/welcomeCode'
import { editorOptions } from '../lib/editorOptions'

export default function EditorPanel() {
  return (
    <div className="editor-panel">
      <div className="editor-tabs">
        <div className="editor-tab editor-tab--active">welcome.ts</div>
      </div>
      <div className="editor-body">
        <Editor
          height="100%"
          language="typescript"
          theme="vs-dark"
          defaultValue={WELCOME_CODE}
          options={editorOptions}
        />
      </div>
    </div>
  )
}
