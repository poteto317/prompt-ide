import type { editor } from 'monaco-editor'

export const editorOptions: editor.IStandaloneEditorConstructionOptions = {
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
}
