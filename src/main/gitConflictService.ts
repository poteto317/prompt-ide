import { access, lstat, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import simpleGit from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { CONFLICT_CHOICES } from '@shared/types'
import type { ConflictChoice, ConflictFile, ConflictUnparsableReason } from '@shared/types'
import {
  DEFAULT_CONFLICT_MARKER_SIZE,
  applyConflictChoices,
  digestConflictBlocks,
  hasConflictMarker,
  parseConflictFile
} from './gitConflictParser'
import { getUnmergedEntries, hasMergeInProgress, hasUnmergedFiles } from './gitMergeState'
import { toLiteralPathspec } from './gitPathParsing'

const NOT_CONFLICTED_MESSAGE = 'コンフリクト中のファイルではありません'
const NOT_MERGING_MESSAGE = 'マージ中ではありません'

const NOT_MERGING_FOR_RESOLVE_MESSAGE =
  'マージ中ではないため、コンフリクトを解決できません(リベース・チェリーピックなどの途中のコンフリクトは対象外です。ターミナルで解決してください)'

// 解決ビューの操作はマージ中(MERGE_HEAD がある)だけに限る。CLI の rebase 中は ours/theirs の
// 意味がマージと逆(--ours が upstream 側)で、「自分を採用」でユーザー自身の変更を捨ててしまう。
// cherry-pick / revert / stash の復元のコンフリクトも、ラベルと完了の手順が違うため対象外にする
async function assertMerging(git: SimpleGit): Promise<void> {
  if (!(await hasMergeInProgress(git))) throw new Error(NOT_MERGING_FOR_RESOLVE_MESSAGE)
}

// サブモジュール(gitlink)のステージのモード
const GITLINK_MODE = '160000'

const SUBMODULE_MESSAGE =
  'サブモジュールのコンフリクトはターミナルで解決してください(サブモジュールの中で採用するコミットを選んでから git add します)'

type UnmergedInfo = { stages: number[]; submodule: boolean }

// マージ中であることと、対象のパスが未解決であることを確かめ、未解決のステージ番号と、
// サブモジュールのコンフリクトか(どれかのステージが gitlink か)を返す。
// サブモジュールは作業ツリーではディレクトリだが、lstat の種類ではなくステージのモードで判定する
// (通常のディレクトリとファイルの衝突は git がファイルを `<path>~HEAD` へ退避するため、
// 未解決のパスがディレクトリになるのは実質サブモジュールだけだが、モードの方が確実)
async function assertUnmerged(git: SimpleGit, filePath: string): Promise<UnmergedInfo> {
  await assertMerging(git)
  const entries = await getUnmergedEntries(git, filePath)
  if (entries.length === 0) throw new Error(NOT_CONFLICTED_MESSAGE)
  return {
    stages: entries.map((e) => e.stage),
    submodule: entries.some((e) => e.mode === GITLINK_MODE)
  }
}

// 書き換える操作の共通の検査。サブモジュールのコンフリクトは拒否する。実 git(2.50)では
// checkout --ours/--theirs が終了コード 0 のまま index も作業ツリーも変えず、続けて add すると
// 作業ツリーのサブモジュールの HEAD(=自分側のコミット)が黙って記録される。rm はサブモジュールの
// 作業ツリーを消して .gitmodules からも外してしまう。マーカーの解析・書き戻しも対象外
async function assertUnmergedFile(git: SimpleGit, filePath: string): Promise<number[]> {
  const { stages, submodule } = await assertUnmerged(git, filePath)
  if (submodule) throw new Error(SUBMODULE_MESSAGE)
  return stages
}

// UTF-8 として往復できる本文か。不正(Shift_JIS など)なら null
// (NUL の検査は readWorkingFileBuffer が先に行う)
function decodeText(buffer: Buffer): string | null {
  const text = buffer.toString('utf8')
  return Buffer.from(text, 'utf8').equals(buffer) ? text : null
}

// 作業ツリーのファイルの種類。lstat でリンクをたどらずに調べる
async function lstatOrNull(
  folderPath: string,
  filePath: string
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(join(folderPath, filePath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

// 作業ツリーのファイルを、本文として扱える通常ファイルのバッファで読む。無い(DU / UD で削除された側)・
// 通常ファイル以外(シンボリックリンク・ディレクトリ)・バイナリ(NUL を含む)は reason を返す。
// リンクをたどるとリポジトリの外を読み、書き戻しでリンクが通常ファイルに置き換わるため読まない
type WorkingBuffer = { buffer: Buffer } | { reason: 'missing' | 'not-regular' | 'binary' }

async function readWorkingFileBuffer(folderPath: string, filePath: string): Promise<WorkingBuffer> {
  const stats = await lstatOrNull(folderPath, filePath)
  if (stats === null) return { reason: 'missing' }
  if (!stats.isFile()) return { reason: 'not-regular' }
  let buffer: Buffer
  try {
    buffer = await readFile(join(folderPath, filePath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { reason: 'missing' }
    throw error
  }
  if (buffer.includes(0)) return { reason: 'binary' }
  return { buffer }
}

type WorkingFile = { text: string } | { reason: ConflictUnparsableReason }

async function inspectWorkingFile(folderPath: string, filePath: string): Promise<WorkingFile> {
  const read = await readWorkingFileBuffer(folderPath, filePath)
  if (!('buffer' in read)) return read
  const text = decodeText(read.buffer)
  return text === null ? { reason: 'markers' } : { text }
}

// git の ll-merge は conflict-marker-size の値を 10 進の int として厳密に読み(strtol_i)、
// 正でなければ既定の 7 を使う。set / unset / 後ろにごみ(10abc) / int の範囲外も 7。
// 先頭ゼロ(010)と + 付き(+10)は git と同じく 10 として受け付ける(実 git 2.50 で確認)
const INT_MAX = 2147483647

/** `git check-attr -z conflict-marker-size -- <path>` の出力(path NUL 属性名 NUL 値 NUL)からマーカーの長さを得る */
export function parseConflictMarkerSizeAttr(output: string): number {
  const [, name, value] = output.split('\0')
  if (name !== 'conflict-marker-size' || value === undefined) return DEFAULT_CONFLICT_MARKER_SIZE
  if (!/^\+?\d+$/.test(value)) return DEFAULT_CONFLICT_MARKER_SIZE
  const size = Number(value)
  return size > 0 && size <= INT_MAX ? size : DEFAULT_CONFLICT_MARKER_SIZE
}

/**
 * ファイルのマーカーの長さ(.gitattributes の conflict-marker-size)。git はこの長さのマーカーを書く。
 * check-attr はパス名を pathspec ではなくリテラルとして読むため、`--` の後ろにそのまま渡す。
 * 失敗したら既定の 7。解析(getConflictFile / resolveConflictBlocks)とマーカーの検査
 * (markConflictResolved)は必ずこの長さを使う(get と resolve でずれるとダイジェストが合わない)
 */
export async function getConflictMarkerSize(git: SimpleGit, filePath: string): Promise<number> {
  try {
    return parseConflictMarkerSizeAttr(
      await git.raw(['check-attr', '-z', 'conflict-marker-size', '--', filePath])
    )
  } catch {
    return DEFAULT_CONFLICT_MARKER_SIZE
  }
}

async function readText(folderPath: string, filePath: string): Promise<string | null> {
  const file = await inspectWorkingFile(folderPath, filePath)
  return 'text' in file ? file.text : null
}

export async function getConflictFile(folderPath: string, filePath: string): Promise<ConflictFile> {
  const git = simpleGit(folderPath)
  const unmerged = await assertUnmerged(git, filePath)
  const stages = { ours: unmerged.stages.includes(2), theirs: unmerged.stages.includes(3) }
  // サブモジュールは作業ツリー(ディレクトリ)を調べない。解決はターミナルへ案内する
  if (unmerged.submodule) return { status: 'unparsable', reason: 'submodule', stages }
  const file = await inspectWorkingFile(folderPath, filePath)
  if (!('text' in file)) return { status: 'unparsable', reason: file.reason, stages }
  const parsed = parseConflictFile(file.text, await getConflictMarkerSize(git, filePath))
  if (!parsed) return { status: 'unparsable', reason: 'markers', stages }
  return {
    status: 'parsed',
    stages,
    segments: parsed.segments,
    digests: digestConflictBlocks(parsed.segments),
    eol: parsed.eol
  }
}

// 同じディレクトリの一時ファイルへ書いてから rename する(書き込みの途中で失敗しても
// 元のファイルは壊れない)。失敗時は一時ファイルの削除を試み、元の例外を投げる
async function writeFileAtomically(absolutePath: string, text: string): Promise<void> {
  const tmpPath = `${absolutePath}.conflict-${process.pid}-${Date.now()}.tmp`
  try {
    const { mode } = await stat(absolutePath)
    await writeFile(tmpPath, text, { mode: mode & 0o777 })
    await rename(tmpPath, absolutePath)
  } catch (error) {
    await unlink(tmpPath).catch(() => {})
    throw error
  }
}

// 選択の値の検査だけを行う。ブロックの番号(キー)の範囲検査は applyConflictChoices が担う
function assertValidChoiceValues(choices: Record<number, ConflictChoice>): void {
  for (const value of Object.values(choices)) {
    if (!(CONFLICT_CHOICES as readonly unknown[]).includes(value)) {
      throw new Error('Invalid choices')
    }
  }
}

export async function resolveConflictBlocks(
  folderPath: string,
  filePath: string,
  expectedDigests: string[],
  choices: Record<number, ConflictChoice>
): Promise<void> {
  const git = simpleGit(folderPath)
  await assertUnmergedFile(git, filePath)
  const text = await readText(folderPath, filePath)
  const parsed =
    text === null ? null : parseConflictFile(text, await getConflictMarkerSize(git, filePath))
  if (!parsed)
    throw new Error('コンフリクトのマーカーを解析できません。エディタで直接編集してください')
  // 確認時(画面に表示した時点)から構成が変わっていれば、別のブロックを解決してしまうため中止する
  const digests = digestConflictBlocks(parsed.segments)
  if (
    digests.length !== expectedDigests.length ||
    digests.some((digest, i) => digest !== expectedDigests[i])
  ) {
    throw new Error('ファイルが変更されたため中止しました。開き直してください')
  }
  assertValidChoiceValues(choices)
  const resolved = applyConflictChoices(parsed, choices)
  await writeFileAtomically(join(folderPath, filePath), resolved)
}

export async function resolveConflictWholeFile(
  folderPath: string,
  filePath: string,
  side: 'ours' | 'theirs'
): Promise<void> {
  const git = simpleGit(folderPath)
  const stages = await assertUnmergedFile(git, filePath)
  // 自分 = ステージ 2、相手 = ステージ 3。削除された側は存在しない(DU / UD)
  if (!stages.includes(side === 'ours' ? 2 : 3)) {
    throw new Error(
      'この側にはファイルがありません。「ファイルを残す」か「削除する」を選んでください'
    )
  }
  await git.raw(['checkout', `--${side}`, '--', toLiteralPathspec(filePath)])
}

// 削除された側があるコンフリクト(DU / UD)でファイルを残す。実機(git 2.50.1)では、
// 残っている側の版が作業ツリーに置かれているため git add だけで解決できる。
// 作業ツリーに無いまま add すると、削除として解決してしまうため、
// 先に存在するステージの版を checkout する
export async function keepConflictFile(folderPath: string, filePath: string): Promise<void> {
  const git = simpleGit(folderPath)
  const stages = await assertUnmergedFile(git, filePath)
  // 自分と相手の両方がある(UU / AA)と、作業ツリーのマーカー入りの内容をそのままステージしてしまう
  if (stages.includes(2) && stages.includes(3)) {
    throw new Error(
      '「ファイルを残す」はこのファイルでは使えません。ブロックを選ぶか、自分/相手をすべて採用してください'
    )
  }
  const pathspec = toLiteralPathspec(filePath)
  const exists = await access(join(folderPath, filePath)).then(
    () => true,
    () => false
  )
  if (!exists) {
    await git.raw(['checkout', stages.includes(3) ? '--theirs' : '--ours', '--', pathspec])
  }
  await git.raw(['add', '--', pathspec])
}

export async function removeConflictFile(folderPath: string, filePath: string): Promise<void> {
  const git = simpleGit(folderPath)
  await assertUnmergedFile(git, filePath)
  await git.raw(['rm', '--', toLiteralPathspec(filePath)])
}

export async function markConflictResolved(folderPath: string, filePath: string): Promise<void> {
  const git = simpleGit(folderPath)
  await assertUnmergedFile(git, filePath)
  // マーカーの検査は通常ファイルだけ。シンボリックリンクは読まずに(リンクの先を見ずに)
  // そのまま add する(リンクのコンフリクトの解決)。バイナリ(NUL を含む)も検査を飛ばす。
  // マーカーは ASCII なので、UTF-8 として不正な本文(Shift_JIS など)は latin1 で読んで検査する。
  // マーカーの判定規則は gitConflictParser の hasConflictMarker(解析と共有)。
  // 長さは解析と同じく .gitattributes の conflict-marker-size に従う
  const read = await readWorkingFileBuffer(folderPath, filePath)
  // ファイルが無いまま add すると削除として解決してしまう。削除して解決するのは「削除する」の役割
  if ('reason' in read && read.reason === 'missing') {
    throw new Error(
      'ファイルが存在しないため解決済みにできません。「削除する」を使うか、ファイルを復元してください'
    )
  }
  if (
    'buffer' in read &&
    hasConflictMarker(read.buffer.toString('latin1'), await getConflictMarkerSize(git, filePath))
  ) {
    throw new Error('コンフリクトのマーカーが残っています')
  }
  await git.raw(['add', '--', toLiteralPathspec(filePath)])
}

export async function completeMerge(folderPath: string): Promise<void> {
  const git = simpleGit(folderPath)
  if (!(await hasMergeInProgress(git))) throw new Error(NOT_MERGING_MESSAGE)
  if (await hasUnmergedFiles(git)) throw new Error('未解決のファイルがあるため完了できません')
  await git.raw(['commit', '--no-edit'])
}

export async function abortMerge(folderPath: string): Promise<void> {
  const git = simpleGit(folderPath)
  if (!(await hasMergeInProgress(git))) throw new Error(NOT_MERGING_MESSAGE)
  await git.raw(['merge', '--abort'])
}
