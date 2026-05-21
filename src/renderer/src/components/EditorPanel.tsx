import Editor from '@monaco-editor/react'

const WELCOME_CODE = `// Welcome to prompt-ide
// プロンプト駆動型の開発ツール — Electron + React + TypeScript

interface Prompt {
  id: string
  title: string
  content: string
  createdAt: Date
}

function runPrompt(prompt: Prompt): void {
  console.log(\`Running: \${prompt.title}\`)
}

const examplePrompt: Prompt = {
  id: '1',
  title: 'コンポーネント生成',
  content: 'React コンポーネントを生成してください。',
  createdAt: new Date(),
}

runPrompt(examplePrompt)
`

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
          options={{
            fontSize: 14,
            fontFamily: "'Fira Code', 'Cascadia Code', Menlo, Monaco, Consolas, monospace",
            fontLigatures: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderWhitespace: 'none',
            tabSize: 2,
            lineNumbers: 'on',
            wordWrap: 'off',
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  )
}
