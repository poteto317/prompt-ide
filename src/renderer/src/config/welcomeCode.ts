export const WELCOME_CODE = `// Welcome to prompt-ide
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
