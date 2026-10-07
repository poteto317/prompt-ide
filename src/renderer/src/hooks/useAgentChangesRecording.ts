import { useCallback } from 'react'
import { useAgentChanges } from './useAgentChanges'
import type { AgentChangesController } from './useAgentChanges'

// エージェントの変更の組み立ての前段(useAppState の中で useAgentWorkspace より前に呼ぶ)。記録の写し(useAgentChanges)と、
// 送信の前の準備に渡す「記録を始めてから一覧を取る」を持つ。一覧を取り直す契機・diff タブ・表示用の値は後段の
// useAgentChangesWiring が持つ

export interface AgentChangesRecording {
  /** エージェントの変更の記録・一覧(main の registry の写し) */
  changes: AgentChangesController
  /**
   * 記録を始めてから一覧を取る(取り直しは一覧が空でも「変わったファイルはありません」を出すため)。送信の前の準備と
   * 「いまから記録する」で使う。reject しない。参照は描画をまたいで変わらない(useAgentPromptSender.send の依存)
   */
  beginAndRefresh: () => Promise<void>
}

export function useAgentChangesRecording(folderPath: string | null): AgentChangesRecording {
  const changes = useAgentChanges(folderPath)
  // begin・refresh はどちらも useCallback(参照が安定)。送信は 10 秒で待つのを打ち切るが、その後に記録が
  // 終わっても記録として扱い一覧を取る(送信の後、記録が終わるまでにエージェントが書いた変更は記録の時点に含まれうる。既知の制約)
  const { begin, refresh } = changes
  const beginAndRefresh = useCallback(async (): Promise<void> => {
    await begin()
    void refresh()
  }, [begin, refresh])
  return { changes, beginAndRefresh }
}
