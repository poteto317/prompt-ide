import { useRef, useState } from 'react'
import type { AgentChangesRunningOperation } from '../types'
import { toError } from '../lib/errorUtils'
import type { FileOperationLock } from './useFileOperationLock'
import { useOnChange } from './useOnChange'

// エージェントの変更を書き換える操作(戻す操作・取り消し)の実行の共有(設計書「実行の共有」)。同じ実行中の印・同じ失敗の表示・
// 同じ全体ロック(fileLock.lockGlobal。他の Git 操作と排他。パターン 111)を持ち、片方の実行中はもう片方を押せなくする(L-058)。
// 失敗の文言はその記録・そのフォルダについてのもの: フォルダの切り替え・記録の終了・新しい記録で記録の世代を進めて消し、
// 実行中に変わったら終わった後に古い失敗を出さない(L-424 の失敗の表示は背景の取り直しと別に持つ)

export type AgentChangesWriteSource = 'file' | 'hunk' | 'all' | 'undo'

export interface AgentChangesWriteError {
  message: string
  /** 失敗の対象のパス(ファイル・ハンク。すべて戻す・取り消しは null)。diff タブは自分のパスの失敗だけを出す */
  path: string | null
  /** 失敗の発生源(どこで読み上げるかの出し分け。hunk は diff タブ側の常設の aria-live が読む) */
  source: AgentChangesWriteSource
}

export interface AgentChangesWriteHooks<T> {
  /** execute が解決した直後(実行中の印を下ろす前)。記録の世代に関わらず呼ぶ */
  onResult: (result: T) => void
  /** execute が reject した直後(実行中の印を下ろす前)。記録の世代に関わらず呼ぶ */
  onError: (error: unknown) => void
  /** reject したときに、記録の世代が依頼の時点と同じ場合だけ、失敗の表示の後に呼ぶ */
  onFailure?: (message: string) => void
}

export type AgentChangesWriteOutcome<T> = { ok: true; result: T } | { ok: false }

export interface AgentChangesWriteRunnerOptions {
  folderPath: string | null
  recordStartedAt: number | null
  fileLock: FileOperationLock
}

export interface AgentChangesWriteRunner {
  runningOperation: AgentChangesRunningOperation | null
  error: AgentChangesWriteError | null
  /** 同じ描画の中の 2 回目の依頼を止める(state は次の描画まで変わらない) */
  isRunning: () => boolean
  run: <T>(
    source: AgentChangesWriteSource,
    path: string | null,
    execute: () => Promise<T>,
    hooks: AgentChangesWriteHooks<T>
  ) => Promise<AgentChangesWriteOutcome<T>>
  /** 依頼の前に呼んで控える記録の世代 */
  captureGeneration: () => number
  isCurrentGeneration: (generation: number) => boolean
  /** 世代が同じときだけ警告を出す(すべて戻す・取り消しの partial を、タブの読み直しの後に出す) */
  showWarning: (message: string, source: AgentChangesWriteSource, generation: number) => void
}

export function useAgentChangesWriteRunner({
  folderPath,
  recordStartedAt,
  fileLock
}: AgentChangesWriteRunnerOptions): AgentChangesWriteRunner {
  const [runningOperation, setRunningOperation] = useState<AgentChangesRunningOperation | null>(
    null
  )
  const [error, setError] = useState<AgentChangesWriteError | null>(null)
  // 記録の世代(一覧・diff の範囲〈AgentChangesScope〉とは別のもの)
  const generationRef = useRef(0)
  const runningRef = useRef(false)
  const resetForRecordChange = (): void => {
    generationRef.current += 1
    setError(null)
  }
  useOnChange(folderPath, resetForRecordChange)
  useOnChange(recordStartedAt, resetForRecordChange)

  const run = async <T>(
    source: AgentChangesWriteSource,
    path: string | null,
    execute: () => Promise<T>,
    hooks: AgentChangesWriteHooks<T>
  ): Promise<AgentChangesWriteOutcome<T>> => {
    const generation = generationRef.current
    runningRef.current = true
    setRunningOperation(source === 'undo' ? 'undo' : 'revert')
    setError(null)
    fileLock.lockGlobal()
    try {
      let result: T
      try {
        result = await execute()
      } catch (err) {
        hooks.onError(err)
        if (generation === generationRef.current) {
          const message = toError(err).message
          setError({ message, path, source })
          hooks.onFailure?.(message)
        }
        return { ok: false }
      }
      hooks.onResult(result)
      return { ok: true, result }
    } finally {
      fileLock.unlockGlobal()
      runningRef.current = false
      setRunningOperation(null)
    }
  }

  return {
    runningOperation,
    error,
    isRunning: () => runningRef.current,
    run,
    captureGeneration: () => generationRef.current,
    isCurrentGeneration: (generation) => generation === generationRef.current,
    showWarning: (message, source, generation) => {
      if (generation === generationRef.current) setError({ message, path: null, source })
    }
  }
}
