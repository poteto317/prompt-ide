import { isClaudeSessionId } from '@shared/types'
import { isEnoentError } from './fsErrors'
import { WriteQueue } from './writeQueue'

// フォルダごとの claude のセッションの起動の記録(設計書「記録の置き場」「記録の中身」)。main が振った ID の一覧を新しい順に持ち、
// 先頭が「前回」。再開の ID が main の振ったものかを照合する相手で、main だけが書く(renderer が丸ごと保存する履歴は信頼しない)。
// 記録はメモリに持ち、has・last は同期で引く(starter の resume の照合は await を挟まない区間にあるため)。読み込みは作った時点で
// 一度だけ始め、使う側は whenLoaded を待ってから同期の区間に入る。ファイルの形は { version: 1, folders: [{ key, ids }] }。
// ファイルの入出力は注入する(AgentSessionRecordIo。実物は agentSessionRecordFileIo.ts)。fs・Electron に依存しない

/** フォルダごとの記録の上限(renderer の履歴の上限 HISTORY_CAP と同じ。履歴に残っているセッションは通常は再開できる) */
export const AGENT_SESSION_RECORDS_PER_FOLDER = 200
/** 記録を持つフォルダの数の上限(最後に記録したのが古いフォルダから捨てる) */
export const AGENT_SESSION_RECORD_FOLDERS_MAX = 50

/** 記録のフォルダのキー(許可のフォルダの正規化した実パス)。Windows のパスは大文字小文字を区別しないため小文字にそろえる */
export function toAgentFolderKey(canonicalPath: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath
}

export interface AgentSessionRecordIo {
  /** 記録のファイルを読む。無ければ ENOENT の例外 */
  read(): Promise<string>
  write(content: string): Promise<void>
}

export interface AgentSessionRecordStore {
  /** 読み込みの完了(失敗しても解決する)。has・last・record の同期の区間に入る前に待つ */
  whenLoaded(): Promise<void>
  has(folderKey: string, claudeSessionId: string): boolean
  /** フォルダの記録の先頭(前回)。無ければ null */
  last(folderKey: string): string | null
  /**
   * ID を先頭として記録する。メモリを同期で更新してから、ファイルへの書き込みを直列に始める(完了は待たない)。
   * 読み込みが ENOENT 以外で失敗していたら、書く前に読み直し、読めたら(または ENOENT なら)ファイルの記録とメモリを
   * 合わせて書く。読めないままならファイルへ書かない(メモリだけで記録する)
   */
  record(folderKey: string, claudeSessionId: string): void
}

/** フォルダの記録(キーと、新しい順の ID) */
export interface FolderRecord {
  key: string
  ids: string[]
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** ファイルの中身を記録にする。不正な要素(キーの無いフォルダ・UUID でない ID・重複)だけを捨て、上限に切りそろえる */
function parseRecords(raw: string): FolderRecord[] {
  const parsed: unknown = JSON.parse(raw)
  if (!isPlainObject(parsed) || !Array.isArray(parsed.folders)) {
    throw new Error('記録のファイルの形が不正です')
  }
  const folders: FolderRecord[] = []
  for (const item of parsed.folders) {
    if (folders.length >= AGENT_SESSION_RECORD_FOLDERS_MAX) break
    if (!isPlainObject(item) || typeof item.key !== 'string' || item.key === '') continue
    if (!Array.isArray(item.ids)) continue
    const key = item.key
    if (folders.some((folder) => folder.key === key)) continue
    const ids = [...new Set(item.ids.filter(isClaudeSessionId))].slice(
      0,
      AGENT_SESSION_RECORDS_PER_FOLDER
    )
    if (ids.length > 0) folders.push({ key, ids })
  }
  return folders
}

/** 読み込みの前に記録した分(current)を前に、読み込んだ記録(loaded)を後ろに合わせる */
function mergeRecords(current: FolderRecord[], loaded: FolderRecord[]): FolderRecord[] {
  const merged = current.map((folder) => {
    const older = loaded.find((l) => l.key === folder.key)?.ids ?? []
    return {
      key: folder.key,
      ids: [...new Set([...folder.ids, ...older])].slice(0, AGENT_SESSION_RECORDS_PER_FOLDER)
    }
  })
  const rest = loaded.filter((l) => !current.some((folder) => folder.key === l.key))
  return [...merged, ...rest].slice(0, AGENT_SESSION_RECORD_FOLDERS_MAX)
}

/**
 * ID をフォルダの記録の先頭(前回)に置き、そのフォルダを最新のフォルダとして先頭に移す。同じ ID の重複は外し、
 * フォルダごと・フォルダの数の上限に切りそろえる(元の配列は変えない)
 */
export function prependRecord(
  folders: readonly FolderRecord[],
  folderKey: string,
  claudeSessionId: string
): FolderRecord[] {
  const previous = folders.find((folder) => folder.key === folderKey)?.ids ?? []
  const ids = [claudeSessionId, ...previous.filter((id) => id !== claudeSessionId)].slice(
    0,
    AGENT_SESSION_RECORDS_PER_FOLDER
  )
  return [{ key: folderKey, ids }, ...folders.filter((folder) => folder.key !== folderKey)].slice(
    0,
    AGENT_SESSION_RECORD_FOLDERS_MAX
  )
}

export function createAgentSessionRecordStore(io: AgentSessionRecordIo): AgentSessionRecordStore {
  // 最後に記録した順(先頭が最新のフォルダ)
  let folders: FolderRecord[] = []
  const queue = new WriteQueue()

  // 読み込みが ENOENT 以外の I/O の理由で失敗した(ファイルはあるのに読めなかった)ときは false。読み直せるまでファイルへ
  // 書かない(空のメモリ + 新しい記録でファイルを上書きし、ほかのフォルダの記録を消さない。L-002)
  let writable = true
  // 書き込みを飛ばしたログを出したか(読めない間に record のたびに同じログを積まないよう、読めなくなった時点の 1 回だけ出す)
  let skipLogged = false

  /** ファイルを読んでメモリと合わせる。ENOENT 以外の I/O の理由で読めなければ writable を false にし、失敗の理由を返す(ログは呼ぶ側) */
  const load = async (): Promise<{ ok: true } | { ok: false; err: unknown }> => {
    let raw: string
    try {
      raw = await io.read()
    } catch (err) {
      // 記録は再開の補助なので、読めなければ空として続ける(前回の続きから は押せず、履歴からの再開は unknown-session)
      if (isEnoentError(err)) {
        writable = true
        return { ok: true }
      }
      writable = false
      return { ok: false, err }
    }
    writable = true
    try {
      // await の後で folders を読む(読み込み中に record された分を落とさない)
      folders = mergeRecords(folders, parseRecords(raw))
    } catch (err) {
      // 中身が壊れている(JSON・形の不正)ときは空として続け、次の record で新しい中身に書き直す
      console.error('[agentSessionRecordStore] 起動の記録を読み込めませんでした:', err)
    }
    return { ok: true }
  }

  const loaded: Promise<void> = (async () => {
    const result = await load()
    if (!result.ok) {
      console.error('[agentSessionRecordStore] 起動の記録を読み込めませんでした:', result.err)
    }
  })()

  const find = (folderKey: string): FolderRecord | undefined =>
    folders.find((folder) => folder.key === folderKey)

  return {
    whenLoaded: () => loaded,
    has: (folderKey, claudeSessionId) => find(folderKey)?.ids.includes(claudeSessionId) ?? false,
    last: (folderKey) => find(folderKey)?.ids[0] ?? null,
    record(folderKey, claudeSessionId) {
      folders = prependRecord(folders, folderKey, claudeSessionId)
      // 書き込みは直列にし(L-040)、読み込む前の空の記録でファイルを上書きしないよう読み込みの完了を待つ。書く中身は書く時点のメモリ。
      // 読み込みが ENOENT 以外で失敗していたら、同じ直列の中で読み直し(一時的な EBUSY・EPERM・EMFILE から書き込みについて回復する。
      // has・last を引く再開の入口では読み直さないので、読めなかった間は次に起動を確定するまで再開できない。既知の制約)、読めたら
      // ファイルの記録とメモリを合わせて書く。読めないままなら書かない(メモリだけで記録する。L-002)。
      // 失敗はログだけ(起動は成功しているため。L-001)。メモリは先に更新しているので、このプロセスの間の 前回の続きから・照合は
      // 新しい記録を使う。古い記録になるのは、ファイルに残らなかった分をアプリを起動し直した後に読む場合だけ
      queue
        .enqueue(async () => {
          await loaded
          if (!writable) await load()
          if (!writable) {
            if (!skipLogged) {
              skipLogged = true
              console.error(
                '[agentSessionRecordStore] 起動の記録を読み込めなかったため、ファイルへは書き込みません'
              )
            }
            return
          }
          skipLogged = false
          await io.write(JSON.stringify({ version: 1, folders }))
        })
        .catch((err: unknown) => {
          console.error('[agentSessionRecordStore] 起動の記録を書き込めませんでした:', err)
        })
    }
  }
}
