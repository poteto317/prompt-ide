import { useState } from 'react'

interface Props {
  stagedCount: number
  isCommitting: boolean
  onCommit: (message: string) => Promise<boolean>
}

export default function CommitSection({
  stagedCount,
  isCommitting,
  onCommit
}: Props): React.JSX.Element {
  const [message, setMessage] = useState('')
  const isDisabled = message.trim() === '' || stagedCount === 0 || isCommitting

  const handleCommit = async (): Promise<void> => {
    const succeeded = await onCommit(message)
    if (succeeded) setMessage('')
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
