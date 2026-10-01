import { join } from 'path'
import simpleGit from 'simple-git'
import type { SimpleGit } from 'simple-git'
import type { DiscardAllResult } from '@shared/types'
import { discardHunkPatch, listPatchPaths } from './gitApply'
import {
  assertHunkPatchTargets,
  stripModeChangeLines,
  PATCH_MISMATCH_MESSAGE
} from './gitHunkPatch'
import { parseUnstagedStatusPaths, toLiteralPathspec } from './gitPathParsing'
import {
  assertDiscardable,
  classifyDiscardTarget,
  isApplicableDiscardKind
} from './gitDiscardClassifier'
import type { ApplicableDiscardKind } from './gitDiscardClassifier'

// 状態ごとの取り消しの実行。拒否する状態(conflicted / unknown / overlaps-untracked)は
// 呼び出し側が assertDiscardable で先に弾く。状態ごとの手段とその理由:
// - 未追跡は git の履歴に内容が無く、完全に削除すると復元できないため、OS のゴミ箱へ移す
// - intent-to-add は restore --worktree がファイルを空にするだけで ' A' のまま残り、
//   履歴の無い内容が失われる(git 2.50.1 の実機で確認)。先に index から外してから
//   ゴミ箱へ移す(ゴミ箱への移動が失敗しても、ゴミ箱にあるファイルを指す宙ぶらりんの
//   index エントリではなく、通常の未追跡ファイルが残るようにする)
// - 追跡済みは restore --worktree で index の内容へ戻す(ステージ済みの内容は残る)
export async function applyDiscard(
  git: SimpleGit,
  folderPath: string,
  kind: ApplicableDiscardKind,
  filePath: string,
  trash: (absolutePath: string) => Promise<void>
): Promise<void> {
  const pathspec = toLiteralPathspec(filePath)
  const moveToTrash = async (): Promise<void> => {
    try {
      await trash(join(folderPath, filePath))
    } catch {
      throw new Error(`ゴミ箱へ移動できませんでした: ${filePath}`)
    }
  }
  switch (kind) {
    case 'untracked':
      await moveToTrash()
      return
    case 'intent-to-add':
      await git.raw(['rm', '--cached', '-q', '--', pathspec])
      await moveToTrash()
      return
    case 'tracked':
      await git.raw(['restore', '--worktree', '--', pathspec])
      return
  }
}

// 「変更」セクションのファイル単位の取り消し。filePath はリポジトリ相対パス。
// 分類(classifyDiscardTarget)→ 拒否(assertDiscardable)→ 実行(applyDiscard)の順に進める。
export async function discardFileChanges(
  folderPath: string,
  filePath: string,
  trash: (absolutePath: string) => Promise<void>
): Promise<void> {
  const git = simpleGit(folderPath)
  const kind = await classifyDiscardTarget(git, filePath)
  assertDiscardable(kind, filePath)
  await applyDiscard(git, folderPath, kind, filePath, trash)
}

// 「変更」セクションのハンク単位の取り消し。作業ツリーだけへパッチを逆適用する(index は変わらない)。
// - 分類はファイル単位と同じ classifyDiscardTarget を使う。ハンクで扱えるのは追跡済みだけ
//   (未追跡・intent-to-add はファイルごとゴミ箱へ移す対象で、ハンクの粒度では取り消せない)
// - IPC の境界で届いた任意のパッチが、対象以外のファイルを書き換えないよう、git apply に
//   パッチの対象を列挙させて filePath 1 件だけであることを確かめる
export async function discardHunk(
  folderPath: string,
  filePath: string,
  patch: string
): Promise<void> {
  const git = simpleGit(folderPath)
  const kind = await classifyDiscardTarget(git, filePath)
  assertDiscardable(kind, filePath)
  if (kind === 'untracked' || kind === 'intent-to-add') {
    throw new Error(`ゴミ箱へ移す対象のため、ハンクでは取り消せません: ${filePath}`)
  }
  // 許可リストで構造を検証し(rename / copy / 新規作成 / a と b の不一致などを拒否)、さらに
  // git apply の解釈でも順方向・逆方向の両方で対象が filePath 1 件だけであることを確かめる
  assertHunkPatchTargets(patch, filePath)
  // chmod を伴う変更の old mode / new mode は取り除いて適用する(内容だけが戻り、モードは残る)
  const contentPatch = stripModeChangeLines(patch)
  for (const reverse of [false, true]) {
    const targets = await listPatchPaths(folderPath, contentPatch, { reverse }).catch(() => null)
    if (targets === null || targets.length !== 1 || targets[0] !== filePath) {
      throw new Error(PATCH_MISMATCH_MESSAGE)
    }
  }
  try {
    await discardHunkPatch(folderPath, filePath, contentPatch)
  } catch (error) {
    throw new Error(
      'ハンクを取り消せませんでした。ファイルが変更された可能性があります。diff を開き直してください',
      { cause: error }
    )
  }
}

const MAX_LISTED_PATHS = 5

function listPathsForMessage(paths: string[]): string {
  const shown = paths.slice(0, MAX_LISTED_PATHS).join('、')
  const rest = paths.length - MAX_LISTED_PATHS
  return rest > 0 ? `${shown}、ほか ${rest} 件` : shown
}

// 「変更」セクションの一括の取り消し。
// - renderer が持つ一覧は信用せず、実行時の status から対象を作り直す。確認ダイアログで見せた件数と
//   違えば、見せていない取り消しを実行してしまうため中止する(状態は確認と実行の間に変わりうる)
// - 全ファイルを先に分類し、1 件でも取り消せなければ何も変えずに全体を拒否する
// - 実行中の失敗は元に戻せないため、そこで中断し済んだ件数を文言に含める。1 件以上済んでいれば作業ツリーが
//   変わっているので例外ではなく partial で返す(renderer がタブ・ツリーを再読込できるように。パターン52)。
//   1 件目で失敗したなら何も変わっていないので例外
export async function discardAllChanges(
  folderPath: string,
  expectedCount: number,
  trash: (absolutePath: string) => Promise<void>
): Promise<DiscardAllResult> {
  const git = simpleGit(folderPath)
  const paths = parseUnstagedStatusPaths(
    await git.raw(['status', '--porcelain', '-z', '--untracked-files=all'])
  )
  if (paths.length !== expectedCount) {
    throw new Error('変更の状態が変わったため取り消しを中止しました。もう一度操作してください')
  }
  const targets: { path: string; kind: ApplicableDiscardKind }[] = []
  const blocked: string[] = []
  for (const path of paths) {
    const kind = await classifyDiscardTarget(git, path)
    if (isApplicableDiscardKind(kind)) targets.push({ path, kind })
    else blocked.push(path)
  }
  if (blocked.length > 0) {
    throw new Error(
      `取り消せないファイルがあるため、何も取り消しませんでした（${listPathsForMessage(blocked)}）`
    )
  }
  let done = 0
  for (const { path, kind } of targets) {
    try {
      await applyDiscard(git, folderPath, kind, path, trash)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const message = `一括の取り消しが途中で失敗しました（${done} / ${targets.length} 件を取り消し済み）: ${reason}`
      if (done > 0) return { status: 'partial', message }
      throw new Error(message, { cause: error })
    }
    done++
  }
  return { status: 'done' }
}
