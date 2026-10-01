import type { SimpleGit } from 'simple-git'
import { parseNulSeparatedPaths, toLiteralPathspec } from './gitPathParsing'

// マージ中か(MERGE_HEAD があるか)。rev-parse -q --verify は ref が無いと終了コード 1・
// stderr 空で終わり、simple-git は reject せず空文字で resolve する。reject は本物の失敗なので
// 握りつぶさず投げる(false にすると、マージ中の拒否がすり抜け、バナーも消える)。
// gitService.ts と gitConflictService.ts の両方が使うため、
// 循環 import を避けて小さなモジュールに切り出している
export async function hasMergeInProgress(git: SimpleGit): Promise<boolean> {
  return (await git.raw(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).trim() !== ''
}

// ls-files -u -z の出力は `<mode> <sha> <stage>\t<path>` の NUL 区切り。
// 対象のパスと完全一致するエントリのステージ番号(1=共通祖先 2=自分 3=相手)とモードを返す。
// 空なら未解決ではない。リテラル pathspec で絞るため、グロブ文字を含むパスや前方一致のパスを
// 取り違えない。モードはサブモジュール(gitlink = 160000)の判定に使う(gitConflictService)
export type UnmergedEntry = { stage: number; mode: string }

export async function getUnmergedEntries(
  git: SimpleGit,
  filePath: string
): Promise<UnmergedEntry[]> {
  const output = await git.raw(['ls-files', '-u', '-z', '--', toLiteralPathspec(filePath)])
  const paths = parseNulSeparatedPaths(output, true)
  const entries: UnmergedEntry[] = []
  output
    .split('\0')
    .filter((e) => e !== '')
    .forEach((entry, i) => {
      if (paths[i] !== filePath) return
      const [mode, , stageText] = entry.slice(0, entry.indexOf('\t')).split(' ')
      const stage = Number(stageText)
      if (Number.isInteger(stage)) entries.push({ stage, mode })
    })
  return entries
}

// 対象のパスの未解決のステージ番号。gitDiscardClassifier と stageFile は isUnmergedPath 経由でこれを共有する
export async function getUnmergedStages(git: SimpleGit, filePath: string): Promise<number[]> {
  return (await getUnmergedEntries(git, filePath)).map((e) => e.stage)
}

// 対象のパスが未解決(コンフリクト中)か。パスと完全一致するエントリがあれば未解決。
// gitDiscardClassifier の conflicted 判定と stageFile の拒否で共有する
export async function isUnmergedPath(git: SimpleGit, filePath: string): Promise<boolean> {
  return (await getUnmergedStages(git, filePath)).length > 0
}

// 未解決のファイルが 1 件でもあるか(コミットできない状態か)。
// 有無だけを見るため、パスを解析しない ls-files -u の出力の有無で判定する
// (一覧が要る場合は listUnresolvedFiles。判定方法の統一は挙動が変わり得るため行っていない)
export async function hasUnmergedFiles(git: SimpleGit): Promise<boolean> {
  return (await git.raw(['ls-files', '-u', '-z'])) !== ''
}

// 未解決(コンフリクト中)のファイルのパスの一覧。gitService(マージのコンフリクト判定)と
// gitStashService(復元時のコンフリクト表示)で共有する。git の失敗はそのまま投げる
export async function listUnresolvedFiles(git: SimpleGit): Promise<string[]> {
  return parseNulSeparatedPaths(await git.raw(['diff', '--name-only', '-z', '--diff-filter=U']))
}
