import { useCallback, useEffect, useState } from 'react'
import type { GitStashEntry } from '@shared/types'
import * as gitApi from '../lib/gitApi'
import { useLatestRef } from './useLatestRef'

export interface GitStashesState {
  stashes: GitStashEntry[]
  refreshStashes: () => Promise<void>
}

// useGitHistory の fetchGitHistoryData と同じく、setState を呼ぶ処理をフック本体の外に置く
// (react-hooks/set-state-in-effect に、effect 内のローカル関数由来と認識させる)。
// git 管理外のフォルダでは getStashes が失敗するため、空にフォールバックする
// (リポジトリかどうかは gitStatus が持つ。getBranches/getTags の失敗と同じ扱い)
async function loadStashes(
  folderPath: string | null,
  setStashes: (stashes: GitStashEntry[]) => void,
  isStale: () => boolean
): Promise<void> {
  if (folderPath === null) {
    setStashes([])
    return
  }
  let entries: GitStashEntry[]
  try {
    entries = await gitApi.getStashes()
  } catch {
    entries = []
  }
  if (!isStale()) setStashes(entries)
}

// stash の一覧の取得と保持だけを担う(操作の実行は useGitStashOperations)。
// 操作の後に呼ぶ refreshStashes が、フォルダ切り替え後に遅れて解決しても古い結果で上書きしない
export function useGitStashes(folderPath: string | null): GitStashesState {
  const [stashes, setStashes] = useState<GitStashEntry[]>([])
  const folderPathRef = useLatestRef(folderPath)

  useEffect(() => {
    let cancelled = false
    void loadStashes(folderPath, setStashes, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [folderPath])

  const refreshStashes = useCallback(
    () => loadStashes(folderPath, setStashes, () => folderPathRef.current !== folderPath),
    [folderPath, folderPathRef]
  )

  return { stashes, refreshStashes }
}
