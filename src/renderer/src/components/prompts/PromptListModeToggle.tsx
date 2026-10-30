'use client'
import type { PromptListModePanelState } from '../../types'
import { isActivationKey } from '../../lib/activationKey'

interface Props {
  state: PromptListModePanelState
}

// プロンプト一覧の編集モード / 表示モードのトグルの行(パネルの最上部)。0 件・検索中・読み込み中でも常に出す
// (隠すとモードを戻せなくなる。L-475)。保存の途中(isSaving)は押した結果なので disabled ではなく aria-disabled にし、押しても切り替えない
// (disabled にするとフォーカスが body へ落ちる。L-157)。ラベルは固定で、状態は aria-pressed で伝え、見える文言は現在の状態にする
// (L-154・L-497・L-511)。読み込み中(mode が null)は押せず、`編集`・`削除` も出ないので「オフ」と表示する
export default function PromptListModeToggle({ state }: Props): React.JSX.Element {
  const { mode, saveError, isSaving, onChange } = state
  const isEditMode = mode === 'edit'
  return (
    <div className="prompts-panel__mode">
      <button
        type="button"
        className="prompts-panel__mode-toggle"
        aria-label="編集モード"
        aria-pressed={isEditMode}
        disabled={mode === null}
        aria-disabled={isSaving ? true : undefined}
        onClick={() => {
          if (!isSaving) onChange(isEditMode ? 'view' : 'edit')
        }}
        // Enter・Space の押しっぱなしで click が合成されると、保存が終わった直後のリピートが新しい操作として通り、モードが往復する。リピートの Enter・Space では押さない
        onKeyDown={(e) => {
          if (e.repeat && isActivationKey(e.key)) e.preventDefault()
        }}
      >
        {isEditMode ? '編集モード: オン' : '編集モード: オフ'}
      </button>
      {/* 保存の失敗の文言の領域は常設にし、中身だけを出し入れする(文言の出し入れで読み上げが欠けないように。L-153) */}
      <p className="prompts-panel__mode-error" aria-live="polite">
        {saveError ?? ''}
      </p>
    </div>
  )
}
