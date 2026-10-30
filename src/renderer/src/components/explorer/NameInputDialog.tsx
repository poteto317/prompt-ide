import { useRef, useState } from 'react'
import { isSafeEntryName } from '@shared/entryName'

interface Props {
  title: string
  initialValue?: string
  /** 入力値(trim 済み)を検証し、エラー文言か null を返す。省略時はファイル名の検証
   *  (isSafeEntryName)。ブランチ名のように '/' を含められる名前に流用するため */
  validate?: (name: string) => string | null
  /** 入力欄のアクセシブルネーム。省略時は「名前」 */
  inputLabel?: string
  /** 他の操作中で、確定しても実行できない状態か。OK を押せなくして案内を出す */
  isBlocked?: boolean
  onSubmit: (name: string) => void
  onCancel: () => void
}

// 入力チェックは UX 用(セキュリティ境界は main 側の assertValidEntryName)。
// 判定条件は isSafeEntryName に一本化してあり、main / renderer の保存ロックの
// 無効化範囲（useFileTreeOperations）と食い違わせない。
// 呼び出し側（handleSubmit）が前後の空白を trim してから渡すため、
// isSafeEntryName の「前後に空白がある名前を拒否する」分岐はここでは発火しない
// （自動で削って受け付ける UX にしている）。main 側の直接呼び出し
// （このダイアログを経由しない IPC）に対しては、その分岐が引き続き有効
function validateName(name: string): string | null {
  if (name.length === 0) return '名前を入力してください'
  if (!isSafeEntryName(name)) return '使用できない名前です'
  return null
}

export default function NameInputDialog({
  title,
  initialValue = '',
  validate = validateName,
  inputLabel = '名前',
  isBlocked = false,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (isBlocked) return
    const trimmed = value.trim()
    const validationError = validate(trimmed)
    if (validationError !== null) {
      setError(validationError)
      return
    }
    onSubmit(trimmed)
  }

  // 開く操作のダブルクリックの 2 回目がオーバーレイに落ちても閉じない。押した時点でフォーカスが body へ
  // 落ちると Escape が入力欄に届かなくなるため、入力欄へ戻す
  const handleOverlayClick = (e: React.MouseEvent): void => {
    if (e.detail > 1) {
      inputRef.current?.focus()
      return
    }
    onCancel()
  }

  return (
    <div className="name-input-dialog__overlay" role="presentation" onClick={handleOverlayClick}>
      <form
        className="name-input-dialog"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <p className="name-input-dialog__title">{title}</p>
        <input
          // ダイアログを開いた直後に入力を始められるようにする(モーダルの慣例)。
          // jsx-a11y は導入していないため、no-autofocus の無効化コメントは書かない(未定義の規則への参照は lint のエラーになる)
          ref={inputRef}
          autoFocus
          type="text"
          className="name-input-dialog__input"
          aria-label={inputLabel}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
          }}
        />
        {error && (
          <p className="name-input-dialog__error" role="alert">
            {error}
          </p>
        )}
        {isBlocked && (
          <p className="create-tag-dialog__note" role="status">
            他の操作が完了するまで実行できません
          </p>
        )}
        <div className="name-input-dialog__actions">
          <button type="submit" className="name-input-dialog__ok" disabled={isBlocked}>
            OK
          </button>
          <button type="button" className="name-input-dialog__cancel" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      </form>
    </div>
  )
}
