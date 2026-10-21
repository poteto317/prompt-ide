import { app } from 'electron'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir, chmod, rename, rm } from 'node:fs/promises'
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

// 読み込みは書き込みのキューを通さない。書き込みを「一時ファイル → rename」の原子的な置き換えにしたので、
// 読み込みが書き込みと重なっても前の内容か新しい内容のどちらかを丸ごと読み、書きかけの JSON は見ない
// (キューに通すと、エージェントの起動のたびの読み込みが無関係な保存を待つことになるため)。
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
    await writeFileAtomically(getSettingsPath(), JSON.stringify(next, null, 2))
  })
}

// 同じディレクトリの一時ファイルへ書き切ってから rename で置き換える(同じファイルシステム内の rename は原子的)。
// 一時ファイルは 0o600 で作り、chmod でも 0o600 に揃える(umask に左右されない。API キーの暗号文を含むため、
// 置き換え後の settings.json も含めて他の利用者から読めないようにする)。失敗したら一時ファイルを消す。
// Windows の rename(MoveFileEx の置き換え)は、ほかのプロセスが settings.json を共有削除なしで開いていると
// EPERM・EBUSY で失敗し得る。その場合も元のファイルはそのまま残り、保存の失敗として呼び出し元へ返す。
async function writeFileAtomically(target: string, content: string): Promise<void> {
  const tempPath = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(tempPath, content, { encoding: 'utf-8', mode: 0o600 })
    await chmod(tempPath, 0o600)
    await rename(tempPath, target)
  } catch (err) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw err
  }
}
