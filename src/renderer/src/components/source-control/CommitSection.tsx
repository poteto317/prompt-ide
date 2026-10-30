import { useEffect, useRef, useState } from 'react'
import ActionMenu from './ActionMenu'
import { formatSyncCounts, getSyncChangesAriaLabel } from '../../lib/syncChangesLabel'

interface Props {
  stagedCount: number
  isCommitting: boolean
  onCommit: (message: string) => Promise<boolean>
  lastCommitMessage: string | null
  onAmend: (message: string) => Promise<boolean>
  /** コミット履歴と lastCommitMessage を取得中か。フォルダ切替直後は useGitHistory の
   *  headCommitMessage が前フォルダの値のまま残るため、取得完了まで amend を
   *  無効化しないと、別リポジトリの直前コミットを誤って amend してしまう */
  isLoadingFolder?: boolean
  /** stage/unstage(useGitOperations)やハンク操作(useDiffOperations の
   *  git apply --cached)が実行中か。この間 runCommitOperation は
   *  .git/index の競合を避けてサイレントに no-op するため、ボタン側でも
   *  揃えないと押しても反応しないように見えてしまう */
  isBlockedByOtherOperation?: boolean
  ahead?: number
  behind?: number
  /** マージ中か。解決の途中で同期しないよう、主ボタンを同期にしない */
  mergeInProgress?: boolean
  /** 同期の実行中か(useGitRemoteOperations。ステータスバーから始めた同期でも true) */
  isSyncing?: boolean
  /** 同期を要求しても実行できない状態か(useGitRemoteOperations) */
  isSyncBlocked?: boolean
  onSync?: () => Promise<void>
}

export default function CommitSection({
  stagedCount,
  isCommitting,
  onCommit,
  lastCommitMessage,
  onAmend,
  isLoadingFolder = false,
  isBlockedByOtherOperation = false,
  ahead = 0,
  behind = 0,
  mergeInProgress = false,
  isSyncing = false,
  isSyncBlocked = false,
  onSync
}: Props): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [isAmend, setIsAmend] = useState(false)
  // message が「amend 用に直前コミットから自動で入れたもの」で、ユーザーがまだ
  // 手を加えていないか。amend を解除したときにそれを取り下げるかどうかの判断に使う
  const [isMessagePrefilled, setIsMessagePrefilled] = useState(false)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const isDisabled =
    message.trim() === '' ||
    (!isAmend && stagedCount === 0) ||
    isCommitting ||
    isBlockedByOtherOperation
  // コミットするものが無く、リモートとの差があるときは、主ボタンをコミットの代わりに同期にする。
  // マージ中はプッシュもプルもできない(useGitRemoteOperations の syncChanges も実行しない)
  const isSyncAction =
    !isCommitting &&
    stagedCount === 0 &&
    message.trim() === '' &&
    !isAmend &&
    !mergeInProgress &&
    (ahead > 0 || behind > 0)
  // lastCommitMessage は HEAD のメッセージ(useGitHistory の headCommitMessage)で、
  // null は「コミットが1件も無いリポジトリ」を意味する(取得に失敗したときも
  // null になり、amend できないものとして扱う)。amend の対象が
  // 無い状態で amend にできると、メッセージ入力だけで
  // コミットボタンが有効化されてしまい、実行して初めて
  // git の `fatal: you have nothing to amend` エラーに気づくことになる。
  // isBlockedByOtherOperation も見ないと、stage/unstage やハンク操作の
  // 実行中に amend にして直前コミットメッセージを仕込め、
  // その操作が完了した瞬間コミットボタンが有効になり、新規コミットの
  // つもりで押すと直前コミットを意図せず書き換えてしまう
  const isAmendDisabled =
    isCommitting || lastCommitMessage === null || isLoadingFolder || isBlockedByOtherOperation

  // フォルダ切替時に isAmend/message を持ち越すと、フォルダ A で amend を選び
  // メッセージ欄に A の直前コミットメッセージが入った状態のまま無関係な B へ
  // 切り替わり、B でステージ済みファイルがあればそのままコミットボタンが有効に
  // なってしまい、A の古いメッセージで B の直前コミットを誤って amend してしまう。
  // isLoadingFolder は「新しいフォルダの履歴取得中」を示す既存のシグナルなので、
  // これが true になった時点でリセットする。
  // 現在は useGitStatus がフォルダ切替時に gitStatus を null へクリアし、
  // SourceControlPanel の `gitStatus !== null` ガードによって GitRepoView ごと
  // アンマウント・再マウントされるため、ローカル state は実際にはそこで破棄される。
  // ただしそれは SourceControlPanel 側の描画条件に依存した間接的な効果であり、
  // その条件が変われば静かに失われる。このリセットは二重の安全策として残す
  useEffect(() => {
    if (!isLoadingFolder) return
    const resetForFolderSwitch = (): void => {
      setIsAmend(false)
      setMessage('')
      setIsMessagePrefilled(false)
    }
    resetForFolderSwitch()
  }, [isLoadingFolder])

  const handleAmendToggle = (checked: boolean): void => {
    setIsAmend(checked)
    if (checked) {
      if (message.trim() === '' && lastCommitMessage !== null) {
        setMessage(lastCommitMessage)
        setIsMessagePrefilled(true)
      }
      return
    }
    // amend を解除したら、amend 用に入れた「直前コミットのメッセージ」は取り下げる。
    // 残したままにすると、ステージ済みファイルがある状態でそのままコミットを
    // 押せてしまい、直前のコミットと同じメッセージを持つ新規コミットが
    // 意図せず作られる。ユーザー自身が打った/書き足した内容は
    // isMessagePrefilled が下りているため、ここでは消さない
    if (isMessagePrefilled) {
      setMessage('')
      setIsMessagePrefilled(false)
    }
  }

  const handleCommit = async (): Promise<void> => {
    const succeeded = isAmend ? await onAmend(message) : await onCommit(message)
    if (succeeded) {
      setMessage('')
      setIsMessagePrefilled(false)
      // amend 成功後も選択が残ったままだと、次に新しいメッセージで押したときに
      // ユーザーが新規コミットのつもりで直前のコミットを再度amendしてしまう事故が起きる
      setIsAmend(false)
    }
  }

  // コミットの直後に同じ位置のボタンが同期へ変わるため、ダブルクリックの続きで確認なしにプッシュしない。
  // 押した側だけが完了後のフォーカスを扱う(ステータスバーから始めた同期では動かさない)。実行中はボタンが
  // 押せなくなってフォーカスが body へ落ちるので、戻す先はメッセージ欄にする。利用者が移した先は奪わない
  const handleSync = async (event: React.MouseEvent): Promise<void> => {
    if (event.detail > 1) return
    await onSync?.()
    const active = document.activeElement
    if (active === null || active === document.body) messageRef.current?.focus()
  }

  // 長押しの Enter の続きで、コミットの後に変わった同期を実行しない
  const handleMainButtonKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' && event.repeat) event.preventDefault()
  }

  const renderMainButtonContent = (): React.ReactNode => {
    if (isSyncing) return '同期中...'
    if (isCommitting) return 'コミット中...'
    if (isSyncAction) {
      return (
        <>
          <span aria-hidden="true">↻</span> 変更の同期 {formatSyncCounts(ahead, behind)}
        </>
      )
    }
    return (
      <>
        <span aria-hidden="true">✓</span> {isAmend ? 'コミット (amend)' : 'コミット'}
      </>
    )
  }

  return (
    <div className="source-control-panel__commit">
      <textarea
        ref={messageRef}
        className="source-control-panel__commit-input"
        placeholder="コミットメッセージ"
        aria-label="コミットメッセージ"
        value={message}
        onChange={(e) => {
          setMessage(e.target.value)
          // 一度でも手を加えたら、以降は「ユーザーが書いたメッセージ」として扱い、
          // amend 解除時にも消さない
          setIsMessagePrefilled(false)
        }}
        disabled={isCommitting}
        rows={3}
      />
      <div className="source-control-panel__commit-actions">
        <button
          type="button"
          className="source-control-panel__commit-btn"
          onClick={isSyncAction ? handleSync : handleCommit}
          onKeyDown={handleMainButtonKeyDown}
          disabled={isSyncing || (isSyncAction ? isSyncBlocked : isDisabled)}
          aria-label={
            isSyncAction && !isSyncing ? getSyncChangesAriaLabel(ahead, behind) : undefined
          }
        >
          {renderMainButtonContent()}
        </button>
        <ActionMenu
          buttonLabel="コミットのオプション"
          buttonContent="▾"
          buttonClassName="source-control-panel__commit-menu-btn"
          items={[
            {
              id: 'amend',
              label: '前回のコミットを修正 (amend)',
              checked: isAmend,
              disabled: isAmendDisabled,
              onSelect: () => handleAmendToggle(!isAmend)
            }
          ]}
        />
      </div>
    </div>
  )
}
