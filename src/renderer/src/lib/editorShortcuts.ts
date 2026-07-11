import type { editor } from 'monaco-editor'
import type { Monaco } from '@monaco-editor/react'

export function registerSaveCommand(
  editorInstance: editor.IStandaloneCodeEditor,
  monaco: Monaco,
  onSave: () => void
): void {
  editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, onSave)
}
