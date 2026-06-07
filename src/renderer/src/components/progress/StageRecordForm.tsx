'use client'
import { useStageRecordForm } from '../../hooks/useStageRecordForm'

interface Props {
  onRecord: (note?: string) => void
}

export default function StageRecordForm({ onRecord }: Props) {
  const { note, setNote, handleRecord } = useStageRecordForm(onRecord)

  return (
    <div className="stage-history__record">
      <input
        className="stage-history__record-input"
        type="text"
        placeholder="メモ（任意）"
        aria-label="実施メモ"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button
        type="button"
        className="stage-history__record-btn"
        aria-label="実施を記録する"
        onClick={handleRecord}
      >
        実施を記録する
      </button>
    </div>
  )
}
