import { constants as fsConstants } from 'node:fs'
import { copyFile, lstat, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { SimpleGit } from 'simple-git'
import type { AgentChangesState } from '@shared/types'
import {
  createBaselineGit,
  createModeGit,
  createRepoGit,
  readRecordHead,
  runBaselineGitDetectingUnreadablePath,
  runBaselineGitWithInput
} from './agentBaselineGit'
import type { BaselineGitLocation, BaselineGitOptions } from './agentBaselineGit'
import { createHiddenGit, hiddenGitEmptyIndexPath } from './agentBaselineHiddenGit'
import { resolveBaselineMode } from './agentBaselineMode'
import type { BaselineMode } from './agentBaselineMode'
import { baselineTempDirPrefix } from './agentBaselineTempSweep'
import { parseNulSeparatedPaths, stripTrailingNewline } from './gitPathParsing'
import { isGitTimeoutError } from './gitStepErrors'

// エージェントの実行の前の作業ツリーを、利用者の index・stash・HEAD を変えずに記録する(設計書「記録の中身」)。
// .git/index（区切りは直前の記録のインデックス）をアプリの一時ディレクトリ(0700)へ写し、GIT_INDEX_FILE をその写しにして `git add -A` する(確認の結果 2)。
// 記録のインデックスは消さずに残し、一覧・diff・戻すが GIT_INDEX_FILE で使う(確認の結果 5)。.git の中には置かない
// Git 管理外のフォルダは、記録の一時ディレクトリの中の隠れた git(agentBaselineHiddenGit)に GIT_DIR・GIT_WORK_TREE で記録する
// (2026-10-15 の設計書。利用者のフォルダには何も書かない)。方式は resolveBaselineMode(agentBaselineMode)で決め、方式ごとの関数で記録する

/** 記録の時点の未追跡(ignore されていない)のファイルの数の上限。超えると記録しない */
export const AGENT_BASELINE_MAX_UNTRACKED_FILES = 5_000
/** 記録の時点の未追跡のファイル(除外の後)の合計の大きさの上限(バイト)。超えると記録しない */
export const AGENT_BASELINE_MAX_UNTRACKED_BYTES = 100 * 1024 * 1024
/** これを超える大きさの未追跡のファイルは記録から除外する(バイト。diff の未追跡の上限と同じ値) */
export const AGENT_BASELINE_EXCLUDE_FILE_BYTES = 5 * 1024 * 1024

/**
 * 記録の時点に大きすぎて除外した未追跡のファイル。一覧で変わったかを見るため、大きさと更新時刻を控える。
 * dev・ino は、エージェントが別の名前へ移した(同じファイルシステムの rename は inode を保つ)ときに、移した先の「追加」の行を
 * 記録していないものとして扱うために控える(PR #47 レビュー A-1)。ino が Number の精度を超える環境では別のファイルと一致しうるが、
 * その誤りは「戻せない」側に倒れる
 */
export interface ExcludedBaselineFile {
  path: string
  size: number
  mtimeMs: number
  dev: number
  ino: number
}

/** 1 つの記録。renderer には渡さない(場所を IPC に出さない。パターン 144) */
export interface BaselineSnapshot {
  /** 記録を取ったときの許可のフォルダ(リポジトリの方式はリポジトリの最上位、隠れた git は開いた Git 管理外のフォルダ) */
  folderPath: string
  /** 記録のインデックスを置いた一時ディレクトリ。記録を捨てるときに消す */
  tempDir: string
  indexPath: string
  /** 隠れた git(記録専用の bare リポジトリ。累積の始点の一時ディレクトリの中)の場所。null はリポジトリの方式(利用者の .git を使う) */
  gitDir: string | null
  startedAt: number
  /** 記録の時点の利用者の HEAD(コミットが無ければ null。隠れた git の記録は常に null。readRecordHead) */
  head: string | null
  /** 記録のインデックスから `git write-tree` で作った tree の ID。途中の実行の比較(tree どうし)に使う(利用者の index を読まない) */
  tree: string
  excluded: ExcludedBaselineFile[]
  /** 記録の時点からあった、コミットの無い入れ子のリポジトリ(末尾 '/')。記録に入れていないため、一覧では notRecorded の行にする */
  skippedRepos: string[]
  /**
   * 記録の時点に ignore されていた未追跡のファイル・フォルダ(`ls-files --others --ignored --exclude-standard --directory`。
   * フォルダは末尾 '/')。記録に入れていないため、記録の後に ignore の規則から外れて一覧に現れても notRecorded の行にする
   * (PR #47 レビュー A-1。一覧・戻すの判定は「いまの」規則を使うため、控えないと記録の前からあった .env などが「追加」に見える)
   */
  ignoredAtBaseline: string[]
}

export type AgentChangesUnavailable = Extract<AgentChangesState, { kind: 'unavailable' }>

export type BaselineSnapshotResult =
  | { kind: 'recorded'; snapshot: BaselineSnapshot }
  | { kind: 'unavailable'; state: AgentChangesUnavailable }
  /** 待つ間に記録が取り消された(フォルダの切り替え・記録の破棄・アプリの終了)。一時ディレクトリは消してある */
  | { kind: 'canceled' }

/**
 * 区切りの写しの元: 写す記録のインデックス(実行の区切りは直前の取れた記録、区別の判定の区切りは直前の判定の区切り)と、記録の隠れた
 * git の場所(リポジトリの方式は null)。組み立ては agentChangesRecord の checkpointBaseOf
 */
export interface BaselineCheckpointBase {
  indexPath: string
  gitDir: string | null
}

export interface TakeBaselineOptions extends BaselineGitOptions {
  /** await のたびに呼び、true なら一時ディレクトリを消して canceled を返す(パターン 141) */
  isCanceled?: () => boolean
  now?: () => number
  /** 一時ディレクトリの親(既定は OS の一時ディレクトリ)。本番は ipcHandlers.ts が起動時の掃除と同じ値を渡し、テストで差し替える */
  tempRoot?: string
  /** main の起動ごとの ID(<pid>-<16 進 8 桁>。保護の ref と同じ値)。記録の一時ディレクトリの名前に入れ、起動時の掃除が使う(必須。L-060) */
  instanceId: string
  /**
   * 区切りの写しの元(BaselineCheckpointBase)。区切りは写す記録のインデックスと記録の隠れた git の場所を渡す(前の記録の stat の情報が使える)。
   * 指定が無ければ累積の始点(リポジトリの方式は利用者の index から写す)。指定した写しの元が無ければ空から始めず git-failed にする(L-002)
   */
  base?: BaselineCheckpointBase
}

// object の ID(SHA-1 は 40 桁・SHA-256 は 64 桁)
const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

class SnapshotCanceled extends Error {}

/**
 * 記録の一時ディレクトリを消す(失敗は握る。残った記録の一時ディレクトリは次の起動の掃除〈agentBaselineTempSweep〉で消す)。
 * registry は取り消しの控えの削除にも使い、残った控えは OS の一時ディレクトリの掃除に任せる
 */
export async function removeBaselineDir(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
}

/** アプリの終了(before-quit)で、待たずに消す */
export function removeBaselineDirSync(tempDir: string): void {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // 消せなかったものは removeBaselineDir と同じ扱い(記録の一時ディレクトリは次の起動の掃除で消す)
  }
}

// 利用者の index の場所(worktree の .git はファイルのため、git に聞く。相対ならリポジトリの最上位から)
async function userIndexPathOf(repoGit: SimpleGit, folderPath: string): Promise<string> {
  const userIndex = stripTrailingNewline(await repoGit.raw(['rev-parse', '--git-path', 'index']))
  return isAbsolute(userIndex) ? userIndex : join(folderPath, userIndex)
}

/**
 * 写しの元の index を記録のインデックスへ写す。写しから始めると stat の情報が使え、変わっていないファイルを読み直さない。
 * 写しの元が無ければ false を返し空から始める(コミットの無いリポジトリは index が無い。確認の結果 15)。required なら無くても例外。
 * copyFile は(macOS では)更新時刻を引き継がず、写しの更新時刻が今の時刻になる。git は index の更新時刻以上の
 * 更新時刻を持つエントリを中身まで比べる(racy-git の守り)ため、写しの元を書いたのと同じ秒に同じ大きさで書き換えた
 * 変更を stat の一致で見落とす。写しの元の時刻を引き継ぎ、写しの元と同じ守りにする
 */
export async function copyIndexPreservingTimes(
  sourceIndex: string,
  indexPath: string,
  { required }: { required: boolean }
): Promise<boolean> {
  // 更新時刻は写す前に読む。写した後に読むと、その間に写しの元が書き直されたとき(git status の index の更新など)、
  // 古い中身に新しい時刻が付いて racy-git の守りが外れる。写す前の時刻なら、書き直されても守りが広がるだけ
  const missingAsNull = (error: NodeJS.ErrnoException): null => {
    if (required || error.code !== 'ENOENT') throw error
    return null
  }
  const sourceStat = await stat(sourceIndex).catch(missingAsNull)
  if (sourceStat === null) return false
  // 読んだ後に消えた場合も、無いときと同じに扱う
  const copied = await copyFile(sourceIndex, indexPath, fsConstants.COPYFILE_EXCL).then(
    () => true,
    missingAsNull
  )
  if (copied === null) return false
  await utimes(indexPath, sourceStat.atime, sourceStat.mtime)
  return true
}

/** 記録に入れないパス(5MB を超える未追跡のファイルと、コミットの無い入れ子のリポジトリ。リポジトリは末尾の '/' を外す) */
export function notRecordedPathsOf(inspection: {
  excluded: readonly ExcludedBaselineFile[]
  skippedRepos: readonly string[]
}): string[] {
  return [
    ...inspection.excluded.map((file) => file.path),
    ...inspection.skippedRepos.map((path) => path.slice(0, -1))
  ]
}

// 写しの元から引き継いだエントリのうち paths を記録のインデックスからだけ外す。pathspec は引数の長さの上限に触れないよう
// pathspecFile に書いて渡す。-f: 記録のインデックスの内容が HEAD とも作業ツリーとも違うと git rm は拒むため
async function removeInheritedPaths(
  baselineGit: SimpleGit,
  pathspecFile: string,
  paths: readonly string[]
): Promise<void> {
  await writeFile(pathspecFile, paths.map((path) => `:(literal)${path}\0`).join(''), {
    flag: 'wx'
  })
  await baselineGit.raw([
    'rm',
    '-r',
    '-q',
    '-f',
    '--cached',
    '--ignore-unmatch',
    `--pathspec-from-file=${pathspecFile}`,
    '--pathspec-file-nul'
  ])
}

/**
 * 写しの元から引き継いだエントリのうち、利用者から見て未追跡(trackedByUser に無い)で、今の規則で ignore されるパス。
 * 前の記録に未追跡として入った後に .gitignore に足された・利用者が git rm --cached してから ignore したファイルは、
 * 記録のインデックスでは追跡中のまま残る(git add -A は追跡中のファイルを ignore の規則に関わらず更新する)。
 * .git/index から作った場合には記録に入らないため、区切りでも外して同じ tree・ignoredAtBaseline にする。
 * trackedByUser はリポジトリの方式は利用者の index の一覧、隠れた git は空の集合(フォルダ全体が利用者から見て未追跡)
 */
async function inheritedIgnoredPaths(
  baselineGit: SimpleGit,
  trackedByUser: () => Promise<ReadonlySet<string>>
): Promise<string[]> {
  const ignoredInRecord = parseNulSeparatedPaths(
    await baselineGit.raw(['ls-files', '-z', '--cached', '--ignored', '--exclude-standard'])
  )
  if (ignoredInRecord.length === 0) return []
  const tracked = await trackedByUser()
  // コンフリクト中のエントリは段ごとに並ぶため、重ねない
  return [...new Set(ignoredInRecord.filter((path) => !tracked.has(path)))]
}

/**
 * 写しの元から引き継いだエントリのうち、利用者から見て未追跡(trackedByUser に無い)の入れ子のリポジトリの gitlink(160000)。
 * 記録のインデックスに gitlink があると、`git add -A` は作業ツリーとの比較で gitlink ごとに入れ子のリポジトリの中で `git status` を
 * 起動し、入れ子の .git/config の filter.<名前>.clean が動き、入れ子の .git/index も書き直す。add は .gitmodules の ignore と
 * diff.ignoreSubmodules を見ずに常に調べ、--ignore-submodules も受け付けない(実測。git 2.50.1)。gitlink の無いところへの add は
 * 入れ子のリポジトリの HEAD を読むだけなので、add の前に外して入れ直させる(結果の gitlink は外さないときと同じ HEAD になる。
 * ローカルレビュー第 13 周の指摘 1)。利用者が追跡しているサブモジュールは利用者のリポジトリの通常の git の挙動のため外さない
 */
async function inheritedNestedRepoPaths(
  baselineGit: SimpleGit,
  trackedByUser: () => Promise<ReadonlySet<string>>
): Promise<string[]> {
  const gitlinks: string[] = []
  for (const record of (await baselineGit.raw(['ls-files', '-s', '-z'])).split('\0')) {
    const tab = record.indexOf('\t')
    if (tab !== -1 && record.startsWith('160000 ')) gitlinks.push(record.slice(tab + 1))
  }
  if (gitlinks.length === 0) return []
  const tracked = await trackedByUser()
  return gitlinks.filter((path) => !tracked.has(path))
}

/**
 * update-index -z --force-remove --stdin に渡す入力。git は外すたびにその位置より後ろのエントリを詰める(memmove)ため、
 * index の昇順に渡すと件数の 2 乗の時間になる(30 万件で 5 秒台。打ち切りの 10 秒に近づく)。index の並び(名前の
 * UTF-8 のバイト列の順)の降順に渡し、動かすのを後ろに残るエントリだけにする。JS の文字列の比較は UTF-16 の順で、
 * 非 ASCII の名前でバイト列の順とずれるため、Buffer で比べる(ローカルレビュー第 3 周の指摘 1)
 */
export function forceRemoveStdinInput(paths: readonly string[]): string {
  return paths
    .map((path) => ({ path, bytes: Buffer.from(path, 'utf8') }))
    .sort((a, b) => Buffer.compare(b.bytes, a.bytes))
    .map(({ path }) => `${path}\0`)
    .join('')
}

/**
 * `git write-tree` の出力を tree の ID にする。simple-git は stderr の無い非 0 の終了を失敗にしないため、
 * 出力が object の ID の形でなければ例外にする
 */
export function parseWriteTreeOutput(output: string): string {
  const tree = output.trim()
  if (!OBJECT_ID_PATTERN.test(tree)) throw new Error(`write-tree の出力が不正です: ${tree}`)
  return tree
}

/**
 * 記録の前の検査: 未追跡(ignore されていない)のファイルの数・大きさ。大きいファイルは除外の対象として返す。未追跡の一覧の問い合わせ
 * (ls-files --others。入れ子のリポジトリは末尾 '/' の 1 行)とその出力の解釈をここにまとめ、方式ごとの関数は問い合わせ先の git
 * (リポジトリの方式は利用者の index、隠れた git は空の index)だけを選ぶ。選択肢は打ち切りだけ(入れ子のリポジトリの HEAD を
 * createRepoGit で問い合わせる。利用者の git の環境のまま問い合わせ、記録の環境変数・-c は付けない)
 */
export async function inspectUntracked(
  folderPath: string,
  untrackedGit: Pick<SimpleGit, 'raw'>,
  gitOptions: Pick<BaselineGitOptions, 'timeoutMs'>
): Promise<
  | { kind: 'ok'; excluded: ExcludedBaselineFile[]; skippedRepos: string[] }
  | { kind: 'too-many'; count: number; bytes: number }
> {
  const paths = parseNulSeparatedPaths(
    await untrackedGit.raw(['ls-files', '-z', '--others', '--exclude-standard'])
  )
  if (paths.length > AGENT_BASELINE_MAX_UNTRACKED_FILES) {
    return { kind: 'too-many', count: paths.length, bytes: 0 }
  }
  const excluded: ExcludedBaselineFile[] = []
  const skippedRepos: string[] = []
  let bytes = 0
  for (const path of paths) {
    // 入れ子のリポジトリ('sub/')は gitlink として記録され、中身は数えない。ただしコミットの無いもの(git init しただけ)は
    // `git add -A` が exit 128 で失敗するため、記録から外す
    if (path.endsWith('/')) {
      const nestedHead = await createRepoGit(join(folderPath, path), gitOptions).raw([
        'rev-parse',
        '--verify',
        '-q',
        'HEAD'
      ])
      if (nestedHead.trim() === '') skippedRepos.push(path)
      continue
    }
    const stat = await lstat(join(folderPath, path)).catch(() => null)
    if (stat === null || !stat.isFile()) continue
    if (stat.size > AGENT_BASELINE_EXCLUDE_FILE_BYTES) {
      excluded.push({
        path,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        dev: stat.dev,
        ino: stat.ino
      })
    } else {
      bytes += stat.size
    }
  }
  if (bytes > AGENT_BASELINE_MAX_UNTRACKED_BYTES) {
    return { kind: 'too-many', count: paths.length, bytes }
  }
  return { kind: 'ok', excluded, skippedRepos }
}

/** 方式ごとの手順が共有するもの */
interface SnapshotStep {
  folderPath: string
  tempDir: string
  indexPath: string
  startedAt: number
  gitOptions: BaselineGitOptions
  /** await のたびに呼ぶ(取り消されていたら SnapshotCanceled を投げる) */
  checkpoint: () => void
}

type UntrackedInspection = Extract<Awaited<ReturnType<typeof inspectUntracked>>, { kind: 'ok' }>

/** 方式ごとの手順の結果。too-many は理由(リポジトリは too-many-untracked、隠れた git は too-many-files)と数を返す */
type SnapshotOutcome =
  | { kind: 'recorded'; snapshot: BaselineSnapshot }
  | {
      kind: 'too-many'
      reason: 'too-many-untracked' | 'too-many-files'
      count: number
      bytes: number
    }

/**
 * リポジトリの方式: 写し(base の記録のインデックス、無ければ .git/index。.git/index が無ければ空)→ 未追跡の事前の検査(区切りでも
 * 利用者の index で問い合わせる)→ 共通の手順(finishSnapshot)
 */
async function recordRepositorySnapshot(
  step: SnapshotStep,
  repoGit: SimpleGit,
  baseIndexPath: string | undefined
): Promise<SnapshotOutcome> {
  const { folderPath, indexPath, gitOptions, checkpoint } = step
  const sourceIndex = baseIndexPath ?? (await userIndexPathOf(repoGit, folderPath))
  checkpoint()
  // 区切りの写しの元が無いのは記録の一時ディレクトリが失われた異常で、空から始めると全ファイルを追加として記録するため、
  // 例外にして git-failed にする(L-002)
  await copyIndexPreservingTimes(sourceIndex, indexPath, { required: baseIndexPath !== undefined })
  checkpoint()
  // 未追跡の事前の検査は、区切りでも利用者の index で問い合わせる(累積の始点と同じ基準)。記録のインデックスで問い合わせると、
  // 前の記録に未追跡として入ったファイルが後で 5MB を超えても追跡済みに見えて除外されず、送るたびに丸ごと hash する
  const inspection = await inspectUntracked(folderPath, repoGit, gitOptions)
  checkpoint()
  if (inspection.kind === 'too-many') {
    return {
      kind: 'too-many',
      reason: 'too-many-untracked',
      count: inspection.count,
      bytes: inspection.bytes
    }
  }
  return finishSnapshot(step, null, inspection, {
    inherited: baseIndexPath !== undefined,
    trackedByUser: async () =>
      new Set(parseNulSeparatedPaths(await repoGit.raw(['ls-files', '-z', '--cached'])))
  })
}

/**
 * 隠れた git: 新規なら記録の一時ディレクトリの中に作る(区切りは base の隠れた git を共有する)→ 写し(新規は写さず空から、区切りは
 * base の記録のインデックス。無ければ例外)→ 未追跡の事前の検査(始点でも区切りでも空の index で数える。フォルダ全体が利用者から見て
 * 未追跡)→ 共通の手順。失敗したら呼び出し側が自分の一時ディレクトリだけを消す(区切りは共有の隠れた git に触れない。L-004)
 */
async function recordHiddenSnapshot(
  step: SnapshotStep,
  mode: Extract<BaselineMode, { kind: 'hidden-new' } | { kind: 'hidden' }>,
  baseIndexPath: string | undefined
): Promise<SnapshotOutcome> {
  const { folderPath, tempDir, indexPath, gitOptions, checkpoint } = step
  const gitDir = mode.kind === 'hidden' ? mode.gitDir : await createHiddenGit(tempDir, gitOptions)
  checkpoint()
  if (baseIndexPath !== undefined) {
    await copyIndexPreservingTimes(baseIndexPath, indexPath, { required: true })
    checkpoint()
  }
  const inspection = await inspectUntracked(
    folderPath,
    createBaselineGit(
      { folderPath, indexPath: hiddenGitEmptyIndexPath(tempDir), gitDir },
      gitOptions
    ),
    gitOptions
  )
  checkpoint()
  if (inspection.kind === 'too-many') {
    return {
      kind: 'too-many',
      reason: 'too-many-files',
      count: inspection.count,
      bytes: inspection.bytes
    }
  }
  return finishSnapshot(step, gitDir, inspection, {
    inherited: baseIndexPath !== undefined,
    trackedByUser: async () => new Set()
  })
}

/**
 * 方式に共通の手順: `git add -A`(除外したファイルを pathspec で外し、区切りは写しの元から引き継いだ除外のパスと、利用者から見て
 * 未追跡で今 ignore されるパスを記録のインデックスから外す)→ ignore 済みの一覧 → HEAD(隠れた git は null)→ tree を控える。
 * 記録の git の場所は step のフォルダ・記録のインデックスと gitDir(リポジトリの方式は null)から組み立てる
 */
async function finishSnapshot(
  step: SnapshotStep,
  gitDir: string | null,
  inspection: UntrackedInspection,
  inheritance: { inherited: boolean; trackedByUser: () => Promise<ReadonlySet<string>> }
): Promise<SnapshotOutcome> {
  const { folderPath, tempDir, indexPath, startedAt, gitOptions, checkpoint } = step
  const location: BaselineGitLocation = { folderPath, indexPath, gitDir }
  // 除外の pathspec は数が多くても引数の長さの上限に触れないよう、一時ディレクトリのファイルで渡す
  const pathspecFile = join(tempDir, 'pathspec')
  const notRecordedPaths = notRecordedPathsOf(inspection)
  const pathspecs = ['.', ...notRecordedPaths.map((path) => `:(exclude,literal)${path}`)]
  await writeFile(pathspecFile, pathspecs.map((spec) => `${spec}\0`).join(''), { flag: 'wx' })
  const baselineGit = createBaselineGit(location, {
    ...gitOptions,
    // core.splitIndex=false は createBaselineGit が常に付ける
    config: ['advice.addEmbeddedRepo=false']
  })
  // 区切りは写しの元から引き継いだエントリに、除外・記録しない入れ子のリポジトリのパス(前の記録の後に 5MB を超えた・
  // 利用者が git rm --cached した)と、利用者から見て未追跡で今 ignore されるパス(前の記録の後に ignore された)が残りうる。
  // 記録のインデックスからだけ外し、.git/index から作ったときと同じ tree・ignoredAtBaseline にする
  // 除外・入れ子のリポジトリのパスは、フォルダの下に残ったエントリも外すため git rm -r の pathspec で外す(未追跡の上限の
  // 5,000 件までに収まる)。ignore 済みのパスは数に上限が無く(node_modules を追跡から外して ignore した、など)、git rm は
  // エントリの数 × pathspec の数の時間になって数万件で打ち切りを超えるため、index のエントリと完全に一致するパスとして
  // update-index --force-remove --stdin で外す(pathspec として解釈しない。ローカルレビュー第 2 周の指摘 1)。
  // 利用者から見て未追跡の入れ子のリポジトリの gitlink も、add -A が入れ子の中の命令を動かさないよう同じ手段で外す(inheritedNestedRepoPaths)
  if (inheritance.inherited) {
    // 利用者の index の一覧は 2 つの問い合わせで共有する(リポジトリの方式は ls-files を 1 度だけ)
    let tracked: Promise<ReadonlySet<string>> | undefined
    const trackedByUser = (): Promise<ReadonlySet<string>> =>
      (tracked ??= inheritance.trackedByUser())
    const ignoredPaths = await inheritedIgnoredPaths(baselineGit, trackedByUser)
    checkpoint()
    const nestedRepoPaths = await inheritedNestedRepoPaths(baselineGit, trackedByUser)
    checkpoint()
    const removedPaths = [...new Set([...ignoredPaths, ...nestedRepoPaths])]
    if (removedPaths.length > 0) {
      await runBaselineGitWithInput(
        location,
        ['update-index', '-z', '--force-remove', '--stdin'],
        forceRemoveStdinInput(removedPaths),
        gitOptions
      )
    }
    checkpoint()
    // gitlink を外してから git rm を動かす。git rm は gitlink を外すとき、記録のインデックスと作業ツリーの .gitmodules が違えば
    // --cached・-f でも exit 128 で止まる(HEAD が生まれていない状態に戻った入れ子のリポジトリは skippedRepos に入る。
    // ローカルレビュー第 14 周の指摘 1)。利用者から見て未追跡の gitlink は上の update-index で外れている
    if (notRecordedPaths.length > 0) {
      await removeInheritedPaths(baselineGit, join(tempDir, 'dropped'), notRecordedPaths)
    }
  }
  checkpoint()
  // 読めないフォルダは add -A が警告だけ出して飛ばし(exit 0)、記録にも ignoredAtBaseline にも入らない。後で読めるようになると
  // 「追加」に見え、戻すと記録の前からあったフォルダがゴミ箱へ移るため、読めないファイル(add -A が exit 128)と同じく記録しない
  // (例外にして git-failed。ローカルレビュー第 33 周の指摘 1)。読める(r)が実行(x)できないフォルダの中の追跡済みのファイルも
  // 「<パス>: Permission denied」だけ出して飛ばし(exit 0)、古い内容のまま記録に残るため、同じく記録しない(ローカルレビュー
  // 第 35 周の指摘 1)。両方式・累積の始点と区切りのどちらもこの add を通る
  const added = await runBaselineGitDetectingUnreadablePath(
    location,
    ['add', '-A', `--pathspec-from-file=${pathspecFile}`, '--pathspec-file-nul'],
    { ...gitOptions, config: ['advice.addEmbeddedRepo=false'] }
  )
  if (added.unreadablePath) throw new Error('読めないフォルダ・ファイルがあるため記録できません')
  checkpoint()
  // 記録の時点の ignore 済みの一覧(A-1)。--directory で ignore されたフォルダは 1 行にまとまり、git はその中へ降りないため、
  // node_modules などが大きくても未追跡の検査(inspectUntracked の ls-files --others)と同程度の走査で済む。打ち切りは他の git と同じ
  const ignoredAtBaseline = parseNulSeparatedPaths(
    await baselineGit.raw([
      'ls-files',
      '-z',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory'
    ])
  )
  checkpoint()
  // リポジトリの方式は利用者の HEAD(コミットが無ければ null。打ち切りなどの失敗は握らない)、隠れた git は git を呼ばずに null
  const head = await readRecordHead(location, gitOptions)
  checkpoint()
  // 途中の実行の比較(tree どうしの diff-tree・diff)のため、記録のインデックスから tree を作る。blob は add で書いてあり、
  // ここで書くのは tree の object だけ(利用者の index は変えない)。失敗・打ち切りは記録の失敗と同じ扱い
  const tree = parseWriteTreeOutput(await baselineGit.raw(['write-tree']))
  checkpoint()
  return {
    kind: 'recorded',
    snapshot: {
      folderPath,
      tempDir,
      indexPath,
      gitDir,
      startedAt,
      head,
      tree,
      excluded: inspection.excluded,
      skippedRepos: inspection.skippedRepos,
      ignoredAtBaseline
    }
  }
}

/**
 * 記録を取る。方式を決め(resolveBaselineMode)、記録の一時ディレクトリ(名前に起動ごとの ID)を作って方式ごとの手順で記録する。
 * 方式で決まる記録できない理由(not-repository・not-toplevel・inside-git-dir)は一時ディレクトリを作る前に返す。数の上限
 * (too-many-untracked・too-many-files)は検査の後に、失敗・取り消しのときは例外を受けて、どちらもここで自分の一時ディレクトリだけを
 * 消す(新規の隠れた git は一時ディレクトリの中なので一緒に消える。区切りは共有の隠れた git に触れない)。各 git に打ち切り(既定は agentBaselineGit の AGENT_BASELINE_GIT_TIMEOUT_MS)
 */
export async function takeBaselineSnapshot(
  folderPath: string,
  {
    isCanceled = () => false,
    now = Date.now,
    tempRoot = tmpdir(),
    base,
    instanceId,
    ...gitOptions
  }: TakeBaselineOptions
): Promise<BaselineSnapshotResult> {
  const startedAt = now()
  const repoGit = createRepoGit(folderPath, gitOptions)
  let tempDir: string | null = null
  const checkpoint = (): void => {
    if (isCanceled()) throw new SnapshotCanceled()
  }
  try {
    const mode = await resolveBaselineMode(
      folderPath,
      createModeGit(folderPath, gitOptions),
      base,
      checkpoint
    )
    if (mode.kind === 'unavailable') {
      return { kind: 'unavailable', state: { kind: 'unavailable', reason: mode.reason } }
    }
    tempDir = await mkdtemp(join(tempRoot, baselineTempDirPrefix(instanceId)))
    const step: SnapshotStep = {
      folderPath,
      tempDir,
      indexPath: join(tempDir, 'index'),
      startedAt,
      gitOptions,
      checkpoint
    }
    const outcome =
      mode.kind === 'repository'
        ? await recordRepositorySnapshot(step, repoGit, base?.indexPath)
        : await recordHiddenSnapshot(step, mode, base?.indexPath)
    if (outcome.kind === 'too-many') {
      await removeBaselineDir(tempDir)
      return {
        kind: 'unavailable',
        state: {
          kind: 'unavailable',
          reason: outcome.reason,
          untrackedCount: outcome.count,
          untrackedBytes: outcome.bytes
        }
      }
    }
    return { kind: 'recorded', snapshot: outcome.snapshot }
  } catch (error) {
    if (tempDir !== null) await removeBaselineDir(tempDir)
    if (error instanceof SnapshotCanceled) return { kind: 'canceled' }
    if (isGitTimeoutError(error)) {
      return { kind: 'unavailable', state: { kind: 'unavailable', reason: 'timeout' } }
    }
    return { kind: 'unavailable', state: { kind: 'unavailable', reason: 'git-failed' } }
  }
}
