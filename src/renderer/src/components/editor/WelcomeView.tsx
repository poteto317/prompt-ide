import Editor from '@monaco-editor/react'
import { WELCOME_CODE } from '../../config/welcomeCode'
import { editorOptions } from '../../lib/editorOptions'
import EditorTabs from './EditorTabs'

export default function WelcomeView(): React.JSX.Element {
  return (
    <>
      <EditorTabs
        // プレースホルダタブは実ファイルではなく、並び替える対象も相手も無いため
        // ドラッグ自体を無効にする
        tabs={[{ path: 'welcome.ts', name: 'welcome.ts', isDirty: false, isReorderable: false }]}
        activePath="welcome.ts"
        // プレースホルダタブは実ファイルではないため、保存対象は無い
        saveTargetPath={null}
        isSaving={false}
        saveError={null}
        onSave={() => {}}
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onReorderTabs={() => {}}
        closable={false}
      />
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
