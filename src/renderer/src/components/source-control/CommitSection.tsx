import { useState } from 'react'

interface Props {
  stagedCount: number
  isCommitting: boolean
  onCommit: (message: string) => Promise<boolean>
  lastCommitMessage: string | null
  onAmend: (message: string) => Promise<boolean>
}

export default function CommitSection({
  stagedCount,
  isCommitting,
  onCommit,
  lastCommitMessage,
  onAmend
}: Props): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [isAmend, setIsAmend] = useState(false)
  const isDisabled =
    message.trim() === '' || (!isAmend && stagedCount === 0) || isCommitting

  const handleAmendToggle = (checked: boolean): void => {
    setIsAmend(checked)
    if (checked && message.trim() === '' && lastCommitMessage !== null) {
      setMessage(lastCommitMessage)
    }
  }

  const handleCommit = async (): Promise<void> => {
    const succeeded = isAmend ? await onAmend(message) : await onCommit(message)
    if (succeeded) {
      setMessage('')
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
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
      />
      <label className="source-control-panel__amend-label">
        <input
          type="checkbox"
          aria-label="amend"
          checked={isAmend}
          onChange={(e) => handleAmendToggle(e.target.checked)}
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
