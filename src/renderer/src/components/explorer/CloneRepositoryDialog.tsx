'use client'

import { useId, useRef, useState } from 'react'
import { deriveCloneFolderName } from '@shared/cloneFolderName'
import { GIT_CLONE_IDLE_TIMEOUT_SECONDS } from '@shared/remoteTimeout'
import { normalizeRemoteUrl } from '@shared/remoteUrl'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { useFocusOnRunningEnd } from '../../hooks/useFocusOnRunningEnd'
import { useFocusOnRunningStart } from '../../hooks/useFocusOnRunningStart'
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss'
import { validateCloneFolderName } from '../../lib/cloneValidation'
import { validateRemoteUrl } from '../../lib/remoteUrlValidation'

// 実行中の案内。打ち切りの秒数は main の打ち切りと同じ定数から組み立てる(パターン 87・88)
export const CLONE_RUNNING_NOTICE = `clone 中です。キャンセルで中止できます（応答が ${GIT_CLONE_IDLE_TIMEOUT_SECONDS} 秒途絶えると打ち切ります）`
export const CLONE_BLOCKED_NOTICE = '他の Git 操作の実行中は clone できません'

interface Props {
  /** clone の依頼中(保存先の選択・clone・開くまで)。入力と実行ボタンを disabled にし、閉じさせない */
  isCloning: boolean
  /** 他の Git 操作の実行中で、clone を始められない */
  isBlocked: boolean
  /** clone の失敗(main のエラー)。role="alert" で表示する */
  error: Error | null
  /** 検証を通過した、正規化済みの URL とフォルダ名 */
  onSubmit: (url: string, folderName: string) => void
  /** 実行中の `キャンセル`(clone の中止) */
  onCancelClone: () => void
  /** 実行中でないときの `キャンセル`・Escape・オーバーレイのクリック(閉じる) */
  onClose: () => void
}

// リポジトリの clone のダイアログ(URL・フォルダ名・実行中の案内・エラー・閉じる経路・フォーカス)。作りはリモートの
// 入力ダイアログ(RemoteSetupInputDialog)と同じ(aria-modal・フォーカストラップ・form の tabIndex=-1・オーバーレイで
// 押して離したときだけ閉じる・IME の Escape を除く。パターン 97)。違いは、項目が 2 つあることと、実行中も `キャンセル`
// だけは押せて clone を中止すること(閉じる経路の Escape・オーバーレイは実行中は塞ぐ。パターン 85)。
// 閉じるのは呼び出し元が成功を受け取ったとき(失敗・中止はダイアログに残し、入力も保持する)
export default function CloneRepositoryDialog({
  isCloning,
  isBlocked,
  error,
  onSubmit,
  onCancelClone,
  onClose
}: Props): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [folderName, setFolderName] = useState('')
  // 利用者がフォルダ名を編集したら、URL を変えても既定値で上書きしない
  const [isFolderNameEdited, setIsFolderNameEdited] = useState(false)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const urlErrorId = useId()
  const folderNameErrorId = useId()

  const urlError = validateRemoteUrl(url)
  const folderNameError = validateCloneFolderName(folderName)
  // 失敗の直後(開き直しの待ちなど)に案内と alert を重ねない(パターン 87)
  const showRunningNotice = isCloning && error === null
  const canSubmit = urlError === null && folderNameError === null && !isCloning && !isBlocked

  const handleUrlChange = (value: string): void => {
    setUrl(value)
    if (!isFolderNameEdited) setFolderName(deriveCloneFolderName(value))
  }

  const handleFolderNameChange = (value: string): void => {
    setIsFolderNameEdited(true)
    setFolderName(value)
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit(normalizeRemoteUrl(url), folderName)
  }

  // 閉じる経路(Escape・オーバーレイ・実行中でないときの `キャンセル`)はすべてここを通す。実行中は閉じない
  // (閉じると、遅れて届いた失敗・成功の行き先が無くなる。パターン 73・85)
  const requestClose = (): void => {
    if (!isCloning) onClose()
  }

  // `キャンセル` は実行中なら clone を中止し、実行中でなければ閉じる
  const handleCancelButton = (): void => {
    if (isCloning) onCancelClone()
    else onClose()
  }

  const overlayHandlers = useOverlayDismiss(requestClose)

  // 実行が始まると入力欄と実行ボタンが disabled になり、フォーカスが body に落ちる。押せる `キャンセル` へ移す
  // (フォーカスがダイアログの外に移されていたら奪わない。パターン 86)
  useFocusOnRunningStart(isCloning, cancelButtonRef, { containerRef: formRef })

  // 実行が解けたとき(ダイアログが開いたまま=失敗・中止)に、フォーカスが body かダイアログ内なら URL の入力欄へ戻す
  useFocusOnRunningEnd(isCloning, urlInputRef, { containerRef: formRef })

  // Tab / Shift+Tab をダイアログの中で循環させる(このダイアログは開いている間だけマウントされる)
  useDialogFocusTrap(formRef, true)

  return (
    <div className="name-input-dialog__overlay" role="presentation" {...overlayHandlers}>
      <form
        ref={formRef}
        className="name-input-dialog clone-repository-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={showRunningNotice}
        // ダイアログ内の文字・余白のクリックで form にフォーカスを置き、Escape を下の onKeyDown に届ける
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // IME の変換を取り消す Escape ではダイアログを閉じない
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) requestClose()
        }}
        onSubmit={handleSubmit}
      >
        <p id={titleId} className="name-input-dialog__title">
          リポジトリを clone
        </p>
        <p id={descriptionId} className="clone-repository-dialog__note">
          保存先の親フォルダを選ぶと、その中にフォルダを作って取得し、そのフォルダを開きます
        </p>
        <label className="clone-repository-dialog__field">
          <span className="clone-repository-dialog__label">URL</span>
          <input
            ref={urlInputRef}
            autoFocus
            type="text"
            className="name-input-dialog__input"
            value={url}
            disabled={isCloning}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={urlError !== null}
            aria-describedby={urlError !== null ? urlErrorId : undefined}
            onChange={(e) => handleUrlChange(e.target.value)}
          />
        </label>
        {urlError !== null && (
          <p id={urlErrorId} className="name-input-dialog__error">
            {urlError}
          </p>
        )}
        <label className="clone-repository-dialog__field">
          <span className="clone-repository-dialog__label">フォルダ名</span>
          <input
            type="text"
            className="name-input-dialog__input"
            value={folderName}
            disabled={isCloning}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={folderNameError !== null}
            aria-describedby={folderNameError !== null ? folderNameErrorId : undefined}
            onChange={(e) => handleFolderNameChange(e.target.value)}
          />
        </label>
        {folderNameError !== null && (
          <p id={folderNameErrorId} className="name-input-dialog__error">
            {folderNameError}
          </p>
        )}
        {isBlocked && (
          <p className="clone-repository-dialog__note" role="status">
            {CLONE_BLOCKED_NOTICE}
          </p>
        )}
        {showRunningNotice && (
          <p className="clone-repository-dialog__note" role="status">
            {CLONE_RUNNING_NOTICE}
          </p>
        )}
        {error !== null && (
          <p className="name-input-dialog__error" role="alert">
            {error.message}
          </p>
        )}
        <div className="name-input-dialog__actions">
          <button type="submit" className="name-input-dialog__ok" disabled={!canSubmit}>
            {isCloning ? 'clone 中…' : '保存先を選んで clone'}
          </button>
          <button
            ref={cancelButtonRef}
            type="button"
            className="name-input-dialog__cancel"
            onClick={handleCancelButton}
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  )
}
