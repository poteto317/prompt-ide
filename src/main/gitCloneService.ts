import { lstat, mkdir, realpath, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { getCloneFolderNameViolation } from '@shared/cloneFolderName'
import type { CloneFolderNameViolation } from '@shared/cloneFolderName'
import { GIT_CLONE_IDLE_TIMEOUT_MS } from '@shared/remoteTimeout'
import { getRemoteUrlRuleViolation, normalizeRemoteUrl } from '@shared/remoteUrl'
import type { CloneRepositoryResult } from '@shared/types'
import { CLONE_KILL_GRACE_MS, runGitCloneProcess } from './gitCloneProcess'
import { REMOTE_URL_RULE_MESSAGES } from './gitRemoteUrlMessages'
import { isFsError, isMissingPathError } from './fsErrors'
import { errorDetail, failure, redactCredentials } from './gitStepErrors'

export const CLONE_FAILURE = 'リポジトリを clone できませんでした'
export const CLONE_PARENT_NOT_FOUND_MESSAGE = '保存先の親フォルダが見つかりません'
export const CLONE_DESTINATION_EXISTS_MESSAGE = '保存先に同名のフォルダがあります'
export const CLONE_CANCELED_MESSAGE = 'clone を中止しました'
export const CLONE_TIMEOUT_MESSAGE =
  'clone が時間内に進みませんでした（認証の待ち、または通信の停止の可能性があります）'
// renderer(cloneValidation)の表と同じ文言。層ごとに表を持つ(パターン 88)
export const CLONE_FOLDER_NAME_MESSAGES: Record<CloneFolderNameViolation, string> = {
  empty: 'フォルダ名を入力してください',
  invalid: 'フォルダ名に使えない文字が含まれています'
}

// 失敗・中止の後に、作った保存先を削除できなかったときに文言の後ろへ添える
export function cleanupFailedNote(destination: string): string {
  return `（途中まで作られた保存先のフォルダを削除できませんでした: ${destination}）`
}

// git の前に置く設定(clone の `-c` ではなく git の `-c`。clone の `-c` は新しいリポジトリの .git/config に
// 書き残す。実機 git 2.50.1 で確認)。URL の許可リストが ext:: と fd:: を拒否するが、利用者の protocol.allow の
// 設定に関わらず、この実行では使わせない(防御の 2 層。git の既定では fd:: は許可されていて、`git clone fd::3` は
// 入力を待ち続けた。実機で確認)。https・http・ssh・git・file・scp 形式・絶対パスの clone には影響しない(実機で確認)
const CLONE_PROTOCOL_GUARD_ARGS = [
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'protocol.fd.allow=never'
] as const

export interface CloneRepositoryOptions {
  /** 出力が途絶えてから打ち切るまでの時間(テストで実時間を待たないための引数。パターン 84) */
  idleTimeoutMs?: number
  /** SIGTERM から SIGKILL までの猶予(テスト用) */
  killGraceMs?: number
  /** Windows のドライブの形の URL を許可するか(テスト用。既定は実行中の OS) */
  windowsPaths?: boolean
}

// 進捗の行(`Receiving objects:  50% (1/2)`・`remote: Counting objects: 100% (32/32), done.`)。失敗の文言からは除く
// (数値の形で判定する。文言の言語には依存しない)
const PROGRESS_LINE_PATTERN = /\d+% \(\d+\/\d+\)/

// git の標準エラーから、失敗の詳細に添える行だけを残す(進捗の行と空行を除き、行の末尾の空白を落とす)
export function toCloneFailureDetail(stderr: string): string {
  return stderr
    .split(/\r\n|\r|\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line !== '' && !PROGRESS_LINE_PATTERN.test(line))
    .join('\n')
}

// 保存先の親フォルダを、実体のパスにして返す。無い・フォルダでない・相対パスは「見つからない」
async function resolveParentDir(parentDir: string): Promise<string> {
  if (!isAbsolute(parentDir)) throw new Error(CLONE_PARENT_NOT_FOUND_MESSAGE)
  let resolved: string
  try {
    resolved = await realpath(parentDir)
  } catch (err) {
    if (isMissingPathError(err)) throw new Error(CLONE_PARENT_NOT_FOUND_MESSAGE)
    throw failure(CLONE_FAILURE, errorDetail(err))
  }
  // realpath と stat の間に親が消える競合は「見つからない」に寄せる(英語の ENOENT を画面に出さない)
  let isDirectory: boolean
  try {
    isDirectory = (await stat(resolved)).isDirectory()
  } catch (err) {
    if (isMissingPathError(err)) throw new Error(CLONE_PARENT_NOT_FOUND_MESSAGE)
    throw failure(CLONE_FAILURE, errorDetail(err))
  }
  if (!isDirectory) throw new Error(CLONE_PARENT_NOT_FOUND_MESSAGE)
  return resolved
}

// 保存先を作る。再帰しない mkdir は、既にある(空のフォルダ・ファイル・壊れたシンボリックリンクでも)と EEXIST で
// 失敗するため、「このサービスが作った」ことと「既存を上書きしない」ことを 1 回で確かめられる(存在の確認と作成の間に
// 別のプロセスが作る競合も起きない。パターン 1)。git clone は空のフォルダへの clone を受け付ける(実機で確認)
async function createDestination(destination: string): Promise<void> {
  try {
    await mkdir(destination)
  } catch (err) {
    if (isFsError(err, 'EEXIST')) throw new Error(CLONE_DESTINATION_EXISTS_MESSAGE)
    // 親が消えた(ENOENT)・ファイルに変わった(ENOTDIR)競合は、親を探す側と同じ文言にする
    if (isMissingPathError(err)) throw new Error(CLONE_PARENT_NOT_FOUND_MESSAGE)
    throw failure(CLONE_FAILURE, errorDetail(err))
  }
}

// このサービスが作った保存先を削除する。削除できなかったら、そのパスを返す(呼び出し側が文言に添える)。
// 保存先が親フォルダの直下でない、または別のプロセスがシンボリックリンクなどフォルダ以外に差し替えていたら、
// 自分が作ったものではないため削除しない(リンクの先を消さない)。git は SIGTERM で中断すると中身を消して空の
// フォルダを残し、SIGKILL では .git を残す(実機で確認)。どちらもここで消す
async function removeCreatedDestination(
  destination: string,
  parent: string
): Promise<string | null> {
  if (dirname(destination) !== parent) return null
  try {
    if (!(await lstat(destination)).isDirectory()) return null
  } catch (err) {
    if (isMissingPathError(err)) return null
    return destination
  }
  try {
    await rm(destination, { recursive: true, force: true })
    return null
  } catch {
    return destination
  }
}

function withCleanupNote(error: Error, leftover: string | null): Error {
  return leftover === null ? error : new Error(`${error.message}${cleanupFailedNote(leftover)}`)
}

// URL とフォルダ名を検証し、正規化した URL を返す(git も OS のダイアログも使わない)。IPC ハンドラが保存先の選択
// (OS のダイアログ)の前に呼び、cloneRepository も実行の前に呼ぶ(パターン 94)。URL は前後の空白だけを除き、
// リモートの追加と同じ許可リスト(@shared/remoteUrl。パスワード入りの URL は拒否する)で検証する
export function assertValidCloneRequest(
  rawUrl: string,
  folderName: string,
  windowsPaths: boolean = process.platform === 'win32'
): string {
  const url = normalizeRemoteUrl(rawUrl)
  const urlViolation = getRemoteUrlRuleViolation(url, { windowsPaths })
  if (urlViolation !== null) throw new Error(REMOTE_URL_RULE_MESSAGES[urlViolation])
  const nameViolation = getCloneFolderNameViolation(folderName)
  if (nameViolation !== null) throw new Error(CLONE_FOLDER_NAME_MESSAGES[nameViolation])
  return url
}

// リポジトリを clone する。url と folderName は IPC 境界から届く任意の文字列、parentDir は OS のダイアログで選ばれた
// 親フォルダ。検証はすべて実行の前に行う(パターン 94)。成功したら保存先の実体のパスを返す。中止(signal)は
// { status: 'canceled' }。失敗は日本語の Error。失敗・中止のときは、作った保存先を削除する(既存のフォルダには触れない)
export async function cloneRepository(
  rawUrl: string,
  folderName: string,
  parentDir: string,
  signal: AbortSignal,
  options: CloneRepositoryOptions = {}
): Promise<CloneRepositoryResult> {
  const {
    idleTimeoutMs = GIT_CLONE_IDLE_TIMEOUT_MS,
    killGraceMs = CLONE_KILL_GRACE_MS,
    windowsPaths = process.platform === 'win32'
  } = options
  const url = assertValidCloneRequest(rawUrl, folderName, windowsPaths)
  const parent = await resolveParentDir(parentDir)
  if (signal.aborted) return { status: 'canceled' }
  const destination = join(parent, folderName)
  await createDestination(destination)

  const result = await runGitCloneProcess({
    args: [...CLONE_PROTOCOL_GUARD_ARGS, 'clone', '--progress', '--', url, destination],
    cwd: parent,
    signal,
    idleTimeoutMs,
    killGraceMs
  })
  // 中止の要求が届いていれば、git が先に終わっていても中止として扱う(利用者が押した結果に合わせる)
  if (result.kind === 'exited' && result.code === 0 && !signal.aborted) {
    return { status: 'cloned', path: await realpath(destination) }
  }
  const leftover = await removeCreatedDestination(destination, parent)
  if (result.kind === 'aborted' || signal.aborted) {
    if (leftover !== null) throw withCleanupNote(new Error(CLONE_CANCELED_MESSAGE), leftover)
    return { status: 'canceled' }
  }
  if (result.kind === 'timed-out') {
    throw withCleanupNote(new Error(CLONE_TIMEOUT_MESSAGE), leftover)
  }
  // git の出力は URL の資格情報を伏せない場合がある(ssh の `user@host: Permission denied` など)。検証はパスワード入りの
  // URL を拒否するが、scp 形式・ssh:// のユーザー名は残るため、詳細を伏せる(防御の 2 層。パターン 93)
  const detail =
    result.kind === 'spawn-failed' ? result.error.message : toCloneFailureDetail(result.stderr)
  throw withCleanupNote(failure(CLONE_FAILURE, redactCredentials(detail)), leftover)
}
