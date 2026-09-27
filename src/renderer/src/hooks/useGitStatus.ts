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

export function useGitStatus(folderPath: string | null): GitStatusState {
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [gitError, setGitError] = useState<Error | null>(null)
  const latestRequestId = useRef(0)

  const refreshGitStatus = useCallback(async (): Promise<void> => {
    const requestId = ++latestRequestId.current
    if (folderPath === null) {
      setGitStatus(null)
      setGitLoading(false)
      setGitError(null)
      return
    }
    setGitLoading(true)
    setGitError(null)
    try {
      const result = await gitApi.getGitStatus()
      if (requestId === latestRequestId.current) {
        setGitStatus(result)
      }
    } catch (err) {
      if (requestId === latestRequestId.current) {
        setGitError(toError(err))
      }
    } finally {
      if (requestId === latestRequestId.current) {
        setGitLoading(false)
      }
    }
  }, [folderPath])

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

  useEffect(() => {
    refreshGitStatus()
  }, [refreshGitStatus])

  return { gitStatus, gitLoading, gitError, refreshGitStatus }
}
