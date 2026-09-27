import { useEffect, useState } from 'react'

interface Props {
  stagedCount: number
  isCommitting: boolean
  onCommit: (message: string) => Promise<boolean>
  lastCommitMessage: string | null
  onAmend: (message: string) => Promise<boolean>
  /** コミット履歴(lastCommitMessage の元)を取得中か。フォルダ切替直後は
   *  useGitHistory の log が前フォルダの値のまま残るため、取得完了まで amend を
   *  無効化しないと、別リポジトリの直前コミットを誤って amend してしまう */
  isLoadingFolder?: boolean
  /** stage/unstage(useGitOperations)やハンク操作(useDiffOperations の
   *  git apply --cached)が実行中か。この間 runCommitOperation は
   *  .git/index の競合を避けてサイレントに no-op するため、ボタン側でも
   *  揃えないと押しても反応しないように見えてしまう */
  isBlockedByOtherOperation?: boolean
}

export default function CommitSection({
  stagedCount,
  isCommitting,
  onCommit,
  lastCommitMessage,
  onAmend,
  isLoadingFolder = false,
  isBlockedByOtherOperation = false
}: Props): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [isAmend, setIsAmend] = useState(false)
  // message が「amend 用に直前コミットから自動で入れたもの」で、ユーザーがまだ
  // 手を加えていないか。amend を解除したときにそれを取り下げるかどうかの判断に使う
  const [isMessagePrefilled, setIsMessagePrefilled] = useState(false)
  const isDisabled =
    message.trim() === '' ||
    (!isAmend && stagedCount === 0) ||
    isCommitting ||
    isBlockedByOtherOperation

  // フォルダ切替時に isAmend/message を持ち越すと、フォルダ A で amend にチェックし
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
      // amend 成功後もチェックがオンのまま残ると、次に新しいメッセージで押したときに
      // ユーザーが新規コミットのつもりで直前のコミットを再度amendしてしまう事故が起きる
      setIsAmend(false)
    }
  }

  return (
    <div className="source-control-panel__commit">
      <textarea
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
      <label className="source-control-panel__amend-label">
        <input
          type="checkbox"
          aria-label="amend"
          checked={isAmend}
          onChange={(e) => handleAmendToggle(e.target.checked)}
          // lastCommitMessage は log[0]?.message 由来のため、null は
          // 「コミットが1件も無いリポジトリ」を意味する。amend の対象が
          // 無い状態でチェックを入れられると、メッセージ入力だけで
          // コミットボタンが有効化されてしまい、実行して初めて
          // git の `fatal: you have nothing to amend` エラーに気づくことになる。
          // isBlockedByOtherOperation も見ないと、stage/unstage やハンク操作の
          // 実行中に amend をチェックして直前コミットメッセージを仕込め、
          // その操作が完了した瞬間コミットボタンが有効になり、新規コミットの
          // つもりで押すと直前コミットを意図せず書き換えてしまう
          disabled={
            isCommitting ||
            lastCommitMessage === null ||
            isLoadingFolder ||
            isBlockedByOtherOperation
          }
        />
        amend
      </label>
      <button
        type="button"
        className="source-control-panel__commit-btn"
        onClick={handleCommit}
        disabled={isDisabled}
      >
        {isCommitting ? 'コミット中...' : 'コミット'}
      </button>
    </div>
  )
}
