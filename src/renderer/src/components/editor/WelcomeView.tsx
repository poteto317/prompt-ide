import Editor from '@monaco-editor/react'
import { WELCOME_CODE } from '../../config/welcomeCode'
import { editorOptions } from '../../lib/editorOptions'
import EditorTabs from './EditorTabs'

export default function WelcomeView() {
  return (
    <>
      <EditorTabs fileName="welcome.ts" />
      <div className="editor-body">
        <Editor
          height="100%"
          language="typescript"
          theme="vs-dark"
          defaultValue={WELCOME_CODE}
          options={editorOptions}
        />
      </div>
    </>
  )
}
