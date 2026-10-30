import { useState, useEffect, useCallback, useRef } from 'react'
import type { GitStatusResult } from '@shared/types'
import * as gitApi from '../lib/gitApi'
import { toError } from '../lib/errorUtils'
import { useOnChange } from './useOnChange'

interface GitStatusState {
  gitStatus: GitStatusResult | null
  gitLoading: boolean
  gitError: Error | null
  refreshGitStatus: () => Promise<void>
}

interface GitStatusSetters {
  setGitStatus: (status: GitStatusResult | null) => void
  setGitLoading: (loading: boolean) => void
  setGitError: (error: Error | null) => void
}

// status を取り直す。後から始まった取得があれば、古い取得の結果・失敗・読み込み中の解除は反映しない
// (latestRequestId で判定する)。useGitHistory の fetchGitHistoryData と同じく、setState を呼ぶ処理を
// フック本体の外に置く(react-hooks/set-state-in-effect に、effect 内から呼ぶ関数を正しく認識させる)
async function fetchGitStatus(
  folderPath: string | null,
  setters: GitStatusSetters,
  latestRequestId: { current: number }
): Promise<void> {
  const requestId = ++latestRequestId.current
  if (folderPath === null) {
    setters.setGitStatus(null)
    setters.setGitLoading(false)
    setters.setGitError(null)
    return
  }
  setters.setGitLoading(true)
  setters.setGitError(null)
  try {
    const result = await gitApi.getGitStatus()
    if (requestId === latestRequestId.current) {
      setters.setGitStatus(result)
    }
  } catch (err) {
    if (requestId === latestRequestId.current) {
      setters.setGitError(toError(err))
    }
  } finally {
    if (requestId === latestRequestId.current) {
      setters.setGitLoading(false)
    }
  }
}

export function useGitStatus(folderPath: string | null): GitStatusState {
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [gitError, setGitError] = useState<Error | null>(null)
  const latestRequestId = useRef(0)

  const refreshGitStatus = useCallback(
    (): Promise<void> =>
      fetchGitStatus(folderPath, { setGitStatus, setGitLoading, setGitError }, latestRequestId),
    [folderPath]
  )

  // フォルダが切り替わった時点で、前のフォルダの status を捨てる。
  // 残したままにすると、新しいフォルダの取得が終わるまでの間、ソース管理パネルに
  // 前のフォルダのブランチ名とファイル一覧が「操作可能な状態で」表示される。
  // その間に「+」を押すと、前のフォルダのファイルパスが新しい allowedFolder に
  // 対して解決され、切替先の同名ファイルをステージしてしまう。
  // refreshGitStatus 内でクリアしないのは、同一フォルダの再取得
  // (stage/unstage/保存のたびに走る)まで巻き込むと、SourceControlPanel が
  // GitRepoView をアンマウントし、入力中のコミットメッセージが失われるため
  useOnChange(folderPath, () => {
    setGitStatus(null)
  })

  // フォルダが変わるたび(初回を含む)に取り直す。refreshGitStatus と同じ取得を、effect からは直接呼ぶ
  useEffect(() => {
    void fetchGitStatus(folderPath, { setGitStatus, setGitLoading, setGitError }, latestRequestId)
  }, [folderPath])

  return { gitStatus, gitLoading, gitError, refreshGitStatus }
}
