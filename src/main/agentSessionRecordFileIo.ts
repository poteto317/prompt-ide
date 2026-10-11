import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSessionRecordIo } from './agentSessionRecordStore'

// claude のセッションの起動の記録のファイルの入出力(agentSessionRecordStore に注入する実物)。記録の規則は agentSessionRecordStore.ts

export const AGENT_SESSION_RECORDS_FILE_NAME = 'agent-sessions.json'

/** userData の agent-sessions.json を読み書きする(ディレクトリが無ければ作る) */
export function createAgentSessionRecordFileIo(userDataDir: string): AgentSessionRecordIo {
  const filePath = join(userDataDir, AGENT_SESSION_RECORDS_FILE_NAME)
  return {
    read: () => readFile(filePath, 'utf-8'),
    write: async (content) => {
      await mkdir(userDataDir, { recursive: true })
      await writeFile(filePath, content, 'utf-8')
    }
  }
}
