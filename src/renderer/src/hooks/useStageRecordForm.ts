import { useState } from 'react'

interface StageRecordFormState {
  note: string
  setNote: (value: string) => void
  handleRecord: () => void
}

export function useStageRecordForm(onRecord: (note?: string) => void): StageRecordFormState {
  const [note, setNote] = useState('')

  const handleRecord = (): void => {
    const trimmed = note.trim()
    onRecord(trimmed === '' ? undefined : trimmed)
    setNote('')
  }

  return { note, setNote, handleRecord }
}
