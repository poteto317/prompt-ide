import type { AgentLaunchRequest, AgentStartResult } from '@shared/types'
import type { AgentSessionRecordStore } from './agentSessionRecordStore'

// 起動に使うエージェント CLI の会話の ID を決める(再開に対応する種類〈claude・copilot〉。records は起動の計画の種類の記録。
// セッションの再開の設計書「起動の流れ」2)。新しく起動するときは main が振り、再開は
// 許可のフォルダの記録にある ID だけを受け付ける(renderer が乗っ取られても、ほかのプロジェクトの会話や任意の ID を再開させない。
// L-019)。同期で判定する(starter の spawn までの await を挟まない区間から呼ぶため)。Electron に依存しない

export type CliSessionIdSelection =
  | { kind: 'selected'; cliSessionId: string }
  | { kind: 'rejected'; result: Extract<AgentStartResult, { kind: 'error' }> }

export function selectCliSessionId(
  launch: AgentLaunchRequest,
  folderKey: string,
  records: Pick<AgentSessionRecordStore, 'has'>,
  createCliSessionId: () => string
): CliSessionIdSelection {
  // 起動の種類を足したときに、記録との照合を通っただけで受け付けないよう、kind ごとに分けて未知の kind は投げる(L-044)
  switch (launch.kind) {
    case 'new':
      return { kind: 'selected', cliSessionId: createCliSessionId() }
    case 'resume':
      if (!records.has(folderKey, launch.cliSessionId)) {
        return { kind: 'rejected', result: { kind: 'error', error: 'unknown-session' } }
      }
      return { kind: 'selected', cliSessionId: launch.cliSessionId }
    default: {
      const unknownLaunch: never = launch
      throw new Error(`未知の起動の指定です: ${JSON.stringify(unknownLaunch)}`)
    }
  }
}
