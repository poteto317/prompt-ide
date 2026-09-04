import { useEffect, useRef, useState } from 'react'
import * as gitApi from '../lib/gitApi'
import type { DiffTabKey } from './useDiffTabs'

export interface DiffOperationsState {
  diffContent: string | null
  diffStaged: boolean
  /** diff の取得・ハンク操作で発生したエラー。ユーザーに見せるための状態 */
  diffError: Error | null
  /** ハンクのステージ/アンステージが実行中か。多重実行防止のガードにも使う */
  isHunkOperationInProgress: boolean
  stageHunk: (patch: string) => Promise<void>
  unstageHunk: (patch: string) => Promise<void>
}

/**
 * diff タブの内容取得と、ハンク単位のステージ/アンステージを担う。
 * activeDiffTab が変わるたびに diff を再取得し、ハンク操作後は明示的な
 * トリガー(diffRefreshSignal)で同じタブのまま再取得する。
 */
export function useDiffOperations(
  activeDiffTab: DiffTabKey | null,
  refreshGitStatus: () => Promise<void>
): DiffOperationsState {
  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [diffStaged, setDiffStaged] = useState(false)
  const [diffError, setDiffError] = useState<Error | null>(null)
  const [isHunkOperationInProgress, setIsHunkOperationInProgress] = useState(false)
  // 即座に判定できるガード用。state 更新は非同期のため、連打を防ぐには ref が必要
  const isHunkOperationInProgressRef = useRef(false)
  // ハンクのステージ/アンステージ後に同じ activeDiffTab のまま diff を再取得させるための
  // 明示的なトリガー。activeDiffTab 自体は変わらないため、依存配列に activeDiffTab だけを
  // 置いた effect では変化を検知できない
  const [diffRefreshSignal, setDiffRefreshSignal] = useState(0)

  useEffect(() => {
    if (activeDiffTab === null) return
    // タブ切替中に古い fetch が後から解決しても、現在のタブの表示を上書きしないよう
    // cancelled フラグで無効化する
    let cancelled = false
    void (async (): Promise<void> => {
      try {
        const content = await gitApi.getDiff(activeDiffTab.path, activeDiffTab.staged)
        if (cancelled) return
        setDiffContent(content)
        setDiffStaged(activeDiffTab.staged)
        setDiffError(null)
      } catch (err) {
        if (cancelled) return
        setDiffError(err instanceof Error ? err : new Error(String(err)))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeDiffTab, diffRefreshSignal])

  const runHunkOperation = async (
    operation: (path: string, patch: string) => Promise<void>,
    patch: string
  ): Promise<void> => {
    if (activeDiffTab === null || isHunkOperationInProgressRef.current) return
    isHunkOperationInProgressRef.current = true
    setIsHunkOperationInProgress(true)
    try {
      await operation(activeDiffTab.path, patch)
      await refreshGitStatus()
      setDiffError(null)
      // diff の再取得は上の effect に一任する(stale closure による古いタブの上書きを防ぐため)
      setDiffRefreshSignal((n) => n + 1)
    } catch (err) {
      setDiffError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      isHunkOperationInProgressRef.current = false
      setIsHunkOperationInProgress(false)
    }
  }

  const stageHunk = (patch: string): Promise<void> => runHunkOperation(gitApi.stageHunk, patch)
  const unstageHunk = (patch: string): Promise<void> => runHunkOperation(gitApi.unstageHunk, patch)

  return { diffContent, diffStaged, diffError, isHunkOperationInProgress, stageHunk, unstageHunk }
}
