import { useEffect, useId, useRef, useState } from 'react'
import type { CreateTagRequest, TagKind } from '@shared/types'
import { normalizeTagName } from '@shared/tagName'
import { validateTagMessage, validateTagName } from '../../lib/tagValidation'

interface Props {
  /** 重複・階層の衝突の判定に使う既存のタグ */
  tags: string[]
  /** 同名の判定に使う既存のローカルブランチ名 */
  branchNames: string[]
  /** 作成の実行中か(作成ボタンと入力を disabled にし、二重送信を防ぐ) */
  isCreating: boolean
  /** 他の操作中で、作成しても no-op になる状態か */
  isBlocked: boolean
  /** 作成の失敗(main のエラー)。role="alert" で表示する */
  error: Error | null
  /** 検証を通過した要求(名前は normalizeTagName 済み=前後の空白を除き NFC。軽量ではメッセージは空) */
  onSubmit: (request: CreateTagRequest) => void
  /** キャンセル・Escape・オーバーレイのクリックのいずれでも呼ばれる(作成中は呼ばない) */
  onCancel: () => void
}

const KIND_OPTIONS: ReadonlyArray<{ value: TagKind; label: string }> = [
  { value: 'lightweight', label: '軽量' },
  { value: 'annotated', label: '注釈付き' }
]

// 矢印キーで選択肢を移る量(radiogroup の慣例。端で折り返す)
const KIND_KEY_DELTAS: Partial<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1
}

// 作成中の打ち切りまでの時間(分)。main の TAG_CREATE_TIMEOUT_MS(120 秒。src/main/gitTagService.ts)と
// 合わせる。renderer は main のモジュールを import できないため値を持ち、TAG_CREATE_TIMEOUT_MS を変えたら
// ここも直す(gitTagService.test.ts の TAG_CREATE_TIMEOUT_MS の値のテストにも同じ注記がある)
const TAG_CREATE_TIMEOUT_MINUTES = 2
const CREATING_STATUS_MESSAGE = `作成中です。署名の入力待ちなどで最大 ${TAG_CREATE_TIMEOUT_MINUTES} 分かかることがあります`

// タグの作成ダイアログ(名前・種類・メッセージ)。NameInputDialog は名前 1 つの入力の前提のため、
// 見た目の枠(.name-input-dialog__*)だけを共有した別コンポーネントにする。
// 検証は UX 用(セキュリティ境界は main 側)。検証エラーは入力欄の説明(aria-describedby)として常に表示し、
// 作成ボタンを disabled にする。作成の失敗は role="alert" で表示し、ダイアログは閉じない
// (閉じるのは呼び出し元 HistorySection が成功を受け取ったとき)
export default function CreateTagDialog({
  tags,
  branchNames,
  isCreating,
  isBlocked,
  error,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<TagKind>('lightweight')
  const [message, setMessage] = useState('')
  const kindRefs = useRef<Partial<Record<TagKind, HTMLButtonElement | null>>>({})
  const nameInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const wasCreatingRef = useRef(isCreating)
  const titleId = useId()
  const descriptionId = useId()
  const kindLabelId = useId()
  const nameErrorId = useId()
  const messageErrorId = useId()

  // main の入口と同じ正規化(前後の空白を除き NFC)をした名前を検証し、そのまま送る
  const normalizedName = normalizeTagName(name)
  const nameError = validateTagName(normalizedName, tags, branchNames)
  const messageError = validateTagMessage(kind, message)
  const canSubmit = nameError === null && messageError === null && !isCreating && !isBlocked

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({ name: normalizedName, kind, message: kind === 'annotated' ? message : '' })
  }

  // 作成中は閉じさせない。閉じると、遅れて届いた失敗がダイアログの外に出ず(開き直すと clearError で
  // 消える)、遅れて届いた成功が閉じた後のフォーカスを奪う(パターン 73)。キャンセルボタンは disabled にし、
  // Escape・オーバーレイのクリックはここで無視する
  const requestCancel = (): void => {
    if (!isCreating) onCancel()
  }

  // 作成中は入力欄と作成ボタンが disabled になり、ブラウザはフォーカスを body に落とす。失敗して作成中が
  // 解けても body のままだと、Escape がフォームに届かず閉じられない(Tab で中へ戻るまで)。そのため作成中が
  // 解けたとき(ダイアログが開いたまま=失敗)に、フォーカスが body かダイアログ内にあればタグ名の入力欄へ戻す。
  // 成功ではこの描画の前に閉じられている(HistorySection がアンマウントする)ため、ここには来ない
  useEffect(() => {
    const wasCreating = wasCreatingRef.current
    wasCreatingRef.current = isCreating
    if (!wasCreating || isCreating) return
    const active = document.activeElement
    if (active === null || active === document.body || formRef.current?.contains(active)) {
      nameInputRef.current?.focus()
    }
  }, [isCreating])

  const handleKindKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    const delta = KIND_KEY_DELTAS[e.key]
    if (delta === undefined) return
    e.preventDefault()
    const index = KIND_OPTIONS.findIndex((option) => option.value === kind)
    const next = KIND_OPTIONS[(index + delta + KIND_OPTIONS.length) % KIND_OPTIONS.length].value
    setKind(next)
    kindRefs.current[next]?.focus()
  }

  return (
    <div className="name-input-dialog__overlay" role="presentation" onClick={requestCancel}>
      <form
        ref={formRef}
        className="name-input-dialog create-tag-dialog"
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isCreating}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // IME の変換を取り消す Escape ではダイアログを閉じない(入力中の名前が消えるため)
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) requestCancel()
        }}
        onSubmit={handleSubmit}
      >
        <p id={titleId} className="name-input-dialog__title">
          タグを作成
        </p>
        <p id={descriptionId} className="create-tag-dialog__note">
          現在の HEAD にタグを付けます
        </p>
        <label className="create-tag-dialog__field">
          <span className="create-tag-dialog__label">タグ名</span>
          <input
            // ダイアログを開いた直後に入力を始められるようにする(モーダルの慣例。autoFocus は React がマウント時に focus() を呼ぶ)
            ref={nameInputRef}
            autoFocus
            type="text"
            className="name-input-dialog__input"
            value={name}
            disabled={isCreating}
            aria-invalid={nameError !== null}
            aria-describedby={nameError !== null ? nameErrorId : undefined}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {nameError !== null && (
          <p id={nameErrorId} className="name-input-dialog__error">
            {nameError}
          </p>
        )}
        <div className="create-tag-dialog__field">
          <span id={kindLabelId} className="create-tag-dialog__label">
            種類
          </span>
          <div role="radiogroup" aria-labelledby={kindLabelId} className="create-tag-dialog__kinds">
            {KIND_OPTIONS.map((option) => (
              <button
                key={option.value}
                ref={(element) => {
                  kindRefs.current[option.value] = element
                }}
                type="button"
                role="radio"
                aria-checked={kind === option.value}
                tabIndex={kind === option.value ? 0 : -1}
                className="create-tag-dialog__kind"
                disabled={isCreating}
                onClick={() => setKind(option.value)}
                onKeyDown={handleKindKeyDown}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {kind === 'annotated' && (
          <>
            <label className="create-tag-dialog__field">
              <span className="create-tag-dialog__label">メッセージ</span>
              <textarea
                className="name-input-dialog__input create-tag-dialog__message"
                rows={3}
                value={message}
                disabled={isCreating}
                aria-invalid={messageError !== null}
                aria-describedby={messageError !== null ? messageErrorId : undefined}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            {messageError !== null && (
              <p id={messageErrorId} className="name-input-dialog__error">
                {messageError}
              </p>
            )}
          </>
        )}
        {/* 作成中は入力欄とボタンが disabled になりフォーカスが body に落ちるため、ボタンの「作成中...」だけでは
            スクリーンリーダーに伝わらない。role="status" で案内する(完了・失敗で消え、失敗は下の alert が伝える) */}
        {isCreating && (
          <p className="create-tag-dialog__note" role="status">
            {CREATING_STATUS_MESSAGE}
          </p>
        )}
        {error !== null && (
          <p className="name-input-dialog__error" role="alert">
            {error.message}
          </p>
        )}
        <div className="name-input-dialog__actions">
          <button type="submit" className="name-input-dialog__ok" disabled={!canSubmit}>
            {isCreating ? '作成中...' : '作成'}
          </button>
          <button
            type="button"
            className="name-input-dialog__cancel"
            disabled={isCreating}
            onClick={onCancel}
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  )
}
