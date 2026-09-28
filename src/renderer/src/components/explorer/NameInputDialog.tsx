import { useState } from 'react'
import { isSafeEntryName } from '@shared/entryName'

interface Props {
  title: string
  initialValue?: string
  /** 入力値(trim 済み)を検証し、エラー文言か null を返す。省略時はファイル名の検証
   *  (isSafeEntryName)。ブランチ名のように '/' を含められる名前に流用するため */
  validate?: (name: string) => string | null
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
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    const trimmed = value.trim()
    const validationError = validate(trimmed)
    if (validationError !== null) {
      setError(validationError)
      return
    }
    onSubmit(trimmed)
  }

  return (
    <div className="name-input-dialog__overlay" role="presentation" onClick={onCancel}>
      <form
        className="name-input-dialog"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <p className="name-input-dialog__title">{title}</p>
        <input
          // ダイアログを開いた直後に入力を始められるようにする(モーダルの慣例)
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          type="text"
          className="name-input-dialog__input"
          aria-label="名前"
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
        <div className="name-input-dialog__actions">
          <button type="submit" className="name-input-dialog__ok">
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
