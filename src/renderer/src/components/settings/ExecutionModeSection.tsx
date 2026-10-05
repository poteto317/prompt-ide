'use client'
import { useId } from 'react'
import type { PromptExecutionMode } from '@shared/types'

interface Props {
  /** 読み込み中は null(選べない) */
  mode: PromptExecutionMode | null
  saveError: string | null
  /** 読み込み中・エージェントの起動中・従来の方式の実行中は選べない */
  isLocked: boolean
  /** 選べない理由(表示し、選択肢から参照する)。理由を出さないときは null */
  lockedReason?: string | null
  onSelect: (mode: PromptExecutionMode) => void
}

const OPTIONS: ReadonlyArray<{ value: PromptExecutionMode; label: string }> = [
  { value: 'agent-cli', label: 'エージェント CLI（アプリ内のターミナルで Claude Code を動かす）' },
  { value: 'legacy', label: '従来の方式（Claude API・非対話の CLI で実行し、出力パネルに表示）' }
]

// 設定パネルの最上部の「プロンプトの実行方式」(設計書「実行方式の切り替え」)。選ぶとすぐ保存する
export default function ExecutionModeSection({
  mode,
  saveError,
  isLocked,
  lockedReason = null,
  onSelect
}: Props): React.JSX.Element {
  const labelId = useId()
  const reasonId = useId()
  return (
    <div className="settings-panel__section">
      <p className="settings-panel__label" id={labelId}>
        プロンプトの実行方式
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="execution-mode-section__options">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            // 読み込み前に選ぶと、保存の失敗・後から届く読み込みでの上書きになるため、mode が null の間も選べなくする
            disabled={isLocked || mode === null}
            aria-describedby={lockedReason !== null ? reasonId : undefined}
            className={`execution-mode-section__option${mode === option.value ? ' execution-mode-section__option--selected' : ''}`}
            onClick={() => {
              if (mode !== option.value) onSelect(option.value)
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      {lockedReason !== null && (
        <p className="settings-panel__status" id={reasonId}>
          {lockedReason}
        </p>
      )}
      {mode === null && <p className="settings-panel__status">読み込み中...</p>}
      {saveError !== null && (
        <p className="settings-panel__error" role="alert">
          {saveError}
        </p>
      )}
    </div>
  )
}
