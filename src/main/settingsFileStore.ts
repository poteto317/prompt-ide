import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { isEnoentError } from './fsErrors'
import { WriteQueue } from './writeQueue'

export interface SettingsFile {
  encryptedApiKey?: string
  apiKey?: string
  modelId?: string
  maxTokens?: number
  /** プロンプトの実行方式(executionModeStore が検証する) */
  promptExecutionMode?: string
  /** エージェントの通知のオン・オフ(agentNotificationSettingStore が検証する) */
  agentNotificationsEnabled?: boolean
  /** エージェントへの送信前の確認のオン・オフ(agentSendConfirmSettingStore が検証する) */
  agentSendConfirmEnabled?: boolean
  /** 使うエージェント CLI(agentCliKindStore が検証する) */
  agentCliKind?: string
}

const getSettingsPath = (): string => join(app.getPath('userData'), 'settings.json')

export async function readSettingsFile(): Promise<SettingsFile> {
  try {
    const content = await readFile(getSettingsPath(), 'utf-8')
    return JSON.parse(content) as SettingsFile
  } catch (err) {
    if (isEnoentError(err)) return {}
    throw err
  }
}

// settings.json への書き込みを直列化するキュー。read-modify-write の read と write の間に
// 別の write が割り込むと、後勝ちの書き込みが先勝ちの変更フィールドを消してしまう
// (lost update)。例えば APIキーのレガシー平文からの自動再暗号化保存と、ユーザーによる
// モデル設定保存がほぼ同時に走った場合に発生しうるため、read-modify-write 全体を
// キューで直列化する。
const writeQueue = new WriteQueue()

// Merge write: settings.json は複数の関心事(APIキー・モデル設定など)のフィールドを
// 共有するため、既存内容を読み込んでから部分更新する(undefined を指定したキーは削除される)
export function writeSettingsFile(partial: Partial<SettingsFile>): Promise<void> {
  return writeQueue.enqueue(async () => {
    const current = await readSettingsFile()
    const next = { ...current, ...partial }
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(getSettingsPath(), JSON.stringify(next, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    })
    await chmod(getSettingsPath(), 0o600)
  })
}
