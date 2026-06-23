'use client'

interface Props {
  onImport: () => void
  onExport: () => void
  isExportDisabled: boolean
}

export default function PromptsToolbar({ onImport, onExport, isExportDisabled }: Props) {
  return (
    <div className="prompts-panel__toolbar">
      <button
        type="button"
        className="prompts-panel__toolbar-button"
        onClick={onImport}
        aria-label="プロンプトをインポート"
      >
        インポート
      </button>
      <button
        type="button"
        className="prompts-panel__toolbar-button"
        onClick={onExport}
        disabled={isExportDisabled}
        aria-label="プロンプトをエクスポート"
      >
        エクスポート
      </button>
    </div>
  )
}
