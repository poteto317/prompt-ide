import { useEffect, useId, useRef, useState } from 'react'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { useFocusOnRunningEnd } from '../../hooks/useFocusOnRunningEnd'
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss'

interface Props {
  /** 見出し(ダイアログの名前) */
  title: string
  /** 説明(ダイアログの aria-describedby) */
  description: string
  /** 入力欄の可視のラベル */
  label: string
  /** 開いたときの値(開いたときに全選択する) */
  initialValue: string
  /** 実行ボタンの文言と、実行中の文言 */
  submitLabel: string
  runningSubmitLabel: string
  /** 実行中の案内(role="status") */
  runningNotice: string
  /** main の入口と同じ正規化。検証と送信値の両方に使う(パターン 83) */
  normalize: (value: string) => string
  /** 正規化した値の検証。違反の文言か null(UX 用。セキュリティ境界は main) */
  validate: (normalized: string) => string | null
  /** 実行中か(入力・実行ボタン・キャンセルを disabled にし、閉じさせない) */
  isRunning: boolean
  /** 他の操作中で、実行しても no-op になる状態か */
  isBlocked: boolean
  /** 実行の失敗(main のエラー)。role="alert" で表示する */
  error: Error | null
  /** 検証を通過した、正規化済みの値 */
  onSubmit: (normalized: string) => void
  /** キャンセル・Escape・オーバーレイのクリックのいずれでも呼ばれる(実行中は呼ばない) */
  onCancel: () => void
}

// リポジトリの初期化・リモートの追加の共通のダイアログ(1 項目の入力・実行中の案内・エラー・閉じる経路・フォーカス)。
// 見た目の枠(.name-input-dialog__*)はタグの作成のダイアログと共有する。2 つのダイアログに同じ実行中の処理を
// 書かないよう、InitRepositoryDialog / AddRemoteDialog はここに検証と文言を渡すだけにする(パターン 55)。
// 閉じるのは呼び出し元が成功を受け取ったとき(失敗はダイアログ内に残す)
export default function RemoteSetupInputDialog({
  title,
  description,
  label,
  initialValue,
  submitLabel,
  runningSubmitLabel,
  runningNotice,
  normalize,
  validate,
  isRunning,
  isBlocked,
  error,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const errorId = useId()

  const normalized = normalize(value)
  const validationError = validate(normalized)
  // 失敗の直後は、取り直しの間だけ isRunning が true のまま error がセットされる。その間も案内(status)と
  // aria-busy を出さず、エラー(alert)だけを伝える(パターン 87)
  const showRunningNotice = isRunning && error === null
  const canSubmit = validationError === null && !isRunning && !isBlocked

  // 開いたときに初期値を全選択する(既定のブランチ名 main をそのまま打ち替えられるように)。autoFocus の後に選ぶ
  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit(normalized)
  }

  // 実行中は閉じさせない。閉じると、遅れて届いた失敗がダイアログの外に出ず(開き直すと clearError で消える)、
  // 遅れて届いた成功が閉じた後のフォーカスを奪う(パターン 73・85)。閉じる経路はすべてここを通す
  const requestCancel = (): void => {
    if (!isRunning) onCancel()
  }

  // オーバーレイで押して離したときだけ閉じる(中とオーバーレイをまたぐドラッグでは、どちら向きでも閉じない。useOverlayDismiss)
  const overlayHandlers = useOverlayDismiss(requestCancel)

  // 実行中は入力欄と実行ボタンが disabled になり、ブラウザはフォーカスを body に落とす。失敗して実行中が解けても
  // body のままだと、Escape がフォームに届かず閉じられない。そのため実行中が解けたとき(ダイアログが開いたまま=失敗)に、
  // フォーカスが body かダイアログ内にあれば入力欄へ戻す(useFocusOnRunningEnd。パターン 86)。
  // 成功ではこの描画の前に閉じられている
  useFocusOnRunningEnd(isRunning, inputRef, { containerRef: formRef })

  // モーダル(aria-modal="true")として、Tab / Shift+Tab をダイアログの中(入力欄・実行・キャンセル)で循環させ、
  // 背後のコミット欄やツールバーへ出さない。実行中にすべて disabled になったときはフォーム自体に留める
  // (useDialogFocusTrap。このダイアログは開いている間だけマウントされる)
  useDialogFocusTrap(formRef, true)

  return (
    <div className="name-input-dialog__overlay" role="presentation" {...overlayHandlers}>
      <form
        ref={formRef}
        className="name-input-dialog remote-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={showRunningNotice}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // IME の変換を取り消す Escape ではダイアログを閉じない(入力中の値が消えるため)
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) requestCancel()
        }}
        onSubmit={handleSubmit}
      >
        <p id={titleId} className="name-input-dialog__title">
          {title}
        </p>
        <p id={descriptionId} className="remote-setup-dialog__note">
          {description}
        </p>
        <label className="remote-setup-dialog__field">
          <span className="remote-setup-dialog__label">{label}</span>
          <input
            // ダイアログを開いた直後に入力を始められるようにする(モーダルの慣例。autoFocus は React がマウント時に focus() を呼ぶ)
            ref={inputRef}
            autoFocus
            type="text"
            className="name-input-dialog__input"
            value={value}
            disabled={isRunning}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={validationError !== null}
            aria-describedby={validationError !== null ? errorId : undefined}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {validationError !== null && (
          <p id={errorId} className="name-input-dialog__error">
            {validationError}
          </p>
        )}
        {/* 実行中は入力欄とボタンが disabled になりフォーカスが body に落ちるため、ボタンの文言だけでは
            スクリーンリーダーに伝わらない。role="status" で案内する(完了・失敗で消え、失敗は下の alert が伝える) */}
        {showRunningNotice && (
          <p className="remote-setup-dialog__note" role="status">
            {runningNotice}
          </p>
        )}
        {error !== null && (
          <p className="name-input-dialog__error" role="alert">
            {error.message}
          </p>
        )}
        <div className="name-input-dialog__actions">
          <button type="submit" className="name-input-dialog__ok" disabled={!canSubmit}>
            {isRunning ? runningSubmitLabel : submitLabel}
          </button>
          <button
            type="button"
            className="name-input-dialog__cancel"
            disabled={isRunning}
            onClick={requestCancel}
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  )
}
