import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentSessionRecordIo } from './agentSessionRecordStore'

// エージェント CLI のセッションの起動の記録のファイルの入出力(agentSessionRecordStore に注入する実物)。記録の規則は agentSessionRecordStore.ts。
// 種類ごとに別のファイルにする(古い版のアプリは claude のファイルだけを読み書きし、copilot の記録を消さない。設計書 2026-10-23「起動の記録」。L-459)

/** 種類ごとの起動の記録のファイル名(userData の下)。claude は段階 3a より前と同じファイル(形も中身も変えない) */
export const AGENT_SESSION_RECORD_FILE_NAMES: Record<AgentCliKind, string> = {
  claude: 'agent-sessions.json',
  copilot: 'agent-sessions-copilot.json'
}

/** userData の fileName を読み書きする(ディレクトリが無ければ作る) */
export function createAgentSessionRecordFileIo(
  userDataDir: string,
  fileName: string
): AgentSessionRecordIo {
  const filePath = join(userDataDir, fileName)
  return {
    read: () => readFile(filePath, 'utf-8'),
    write: async (content) => {
      await mkdir(userDataDir, { recursive: true })
      await writeFile(filePath, content, 'utf-8')
    }
  }
}
