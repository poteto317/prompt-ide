import { app } from 'electron'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  readFile,
  writeFile,
  mkdir,
  chmod,
  rename,
  rm,
  open,
  lstat,
  realpath
} from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { isEnoentError, isFsError } from './fsErrors'
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

// sync してから close する。sync が失敗して close も失敗したら、close の失敗は console.error に記録し、sync の例外を投げる
// (本当の原因を残すため)。sync が成功して close だけが失敗したら、close の例外を投げる(書き込みの成功を装わない)
async function syncAndClose(handle: FileHandle): Promise<void> {
  let syncFailed = false
  let syncError: unknown
  try {
    await handle.sync()
  } catch (err) {
    syncFailed = true
    syncError = err
  }
  try {
    await handle.close()
  } catch (closeErr) {
    if (!syncFailed) throw closeErr
    console.error('[settingsFileStore] failed to close temp file:', closeErr)
  }
  if (syncFailed) throw syncError
}

// 同じディレクトリの一時ファイルへ書き切ってから rename で置き換える(同じファイルシステム内の rename は原子的)。
// 一時ファイルは 0o600 で作り、chmod でも 0o600 に揃える(umask に左右されない。API キーの暗号文を含むため、
// 置き換え後の settings.json も含めて他の利用者から読めないようにする)。
// 一時ファイルは wx(排他の作成)で作る。名前が万一ほかのファイルと重なっても、そのファイルを切り詰めずに EEXIST で
// 失敗する(mode も新しく作るときにだけ効くため、確実に 0o600 で作れる)。EEXIST のときはそのファイルを消さない。
// rename の前に一時ファイルを sync する。しないと、電源断や OS のクラッシュが書き込みの直後に重なったとき、rename だけが
// 永続化されて 0 バイトの settings.json が残りうる。その JSON は読み込めないため、利用者が手で消すまで、すべての設定の
// 保存が失敗し続ける(書き込みは先に読み込むため)。ディレクトリの sync はしない(rename の永続化が遅れても、前の内容が
// 残るだけで壊れない)。sync は writeFile とは別の fd で行う(writeFile は 1 回の呼び出しで書き切るため)。
// close の失敗は sync の例外を置き換えない(syncAndClose)。close が失敗したら rename しない(保存の成功を装わない)。
// 失敗したら一時ファイルを消す。消せなかったときは console.error に記録し、元の例外を返す。
// Windows の rename(MoveFileEx の置き換え)は、ほかのプロセスが settings.json を共有削除なしで開いていると
// EPERM・EBUSY で失敗し得る。その場合も元のファイルはそのまま残り、保存の失敗として呼び出し元へ返す。
// settings.json がシンボリックリンクなら realpath でたどり、リンク先と同じディレクトリに一時ファイルを作ってリンク先へ
// rename する(リンクを通常のファイルに置き換えず、リンク先の内容を更新する)。ただし以前の writeFile(リンク先のファイルを
// その場で上書き)と同じ結果ではない。リンク先のフォルダへの書き込み権限が要る(一時ファイルの作成と rename のため。
// ファイルにだけ書き込み権限があるときは、以前は成功し、今は EACCES で失敗する)。またリンク先は新しいファイルに置き換わる
// ので、元のファイルの所有者・ACL・ハードリンクは引き継がれない(所有者は保存した利用者になり、ほかのハードリンクは古い
// 内容のまま切り離される)。
async function writeFileAtomically(target: string, content: string): Promise<void> {
  const resolvedTarget = await resolveWriteTarget(target)
  const tempPath = `${resolvedTarget}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(tempPath, content, { encoding: 'utf-8', mode: 0o600, flag: 'wx' })
    const handle = await open(tempPath, 'r+')
    await syncAndClose(handle)
    await chmod(tempPath, 0o600)
    await rename(tempPath, resolvedTarget)
  } catch (err) {
    // EEXIST は wx の作成で、同じ名前のほかのファイルがあったとき。自分が作ったファイルではないので消さない
    if (!isFsError(err, 'EEXIST')) {
      await rm(tempPath, { force: true }).catch((rmErr: unknown) => {
        console.error('[settingsFileStore] failed to remove temp file:', rmErr)
      })
    }
    throw err
  }
}

// 書き込み先のシンボリックリンクをたどった実体のパスを返す。realpath は lstat でシンボリックリンクと分かったときだけ呼ぶ
// (Windows の RAM ディスクや一部の仮想・ネットワークドライブでは realpath(realpath.native)が失敗することがあり、
// 通常のファイルでも呼ぶと、リンクを使っていない利用者の保存がすべて失敗しうるため)。通常のファイルなら今のパスのまま。
// ファイルが無ければ(lstat が ENOENT)今のパスのまま。リンク切れ(リンクはあるがリンク先が無い)は realpath が ENOENT に
// なるので今のパスのままで、リンクを通常のファイルに置き換える(リンク先の場所に新しいファイルを作らない)。
// lstat・realpath の ENOENT 以外の失敗は保存の失敗として投げる。lstat が失敗したときはリンクかどうかが分からず、今のパスの
// まま進めるとリンクを通常のファイルに置き換えてしまいうるため(元のファイルとリンクは壊さずに残す)。
async function resolveWriteTarget(target: string): Promise<string> {
  try {
    const stats = await lstat(target)
    if (!stats.isSymbolicLink()) return target
    return await realpath(target)
  } catch (err) {
    if (isEnoentError(err)) return target
    throw err
  }
}
