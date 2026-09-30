import { join } from 'path'
import simpleGit, { GitError, GitPluginError } from 'simple-git'
import type { BranchSummary, SimpleGit } from 'simple-git'
import type { GitStatusResult, GitLogEntry, GitBranch, DeleteBranchResult } from '@shared/types'
import {
  buildUntrackedDiff,
  isBinaryContent,
  decodeUtf8OrNull,
  buildBinaryDiffMessage,
  buildSymlinkDiffMessage,
  buildTooLargeDiffMessage,
  buildEmptyFileDiffMessage
} from './gitDiffFormatter'
import { parseGitLogOutput } from './gitLogFormatter'
import { parseWorktreeBranches } from './gitWorktreeParser'
import { findConflictingBranchName, getBranchNameRuleViolation } from '@shared/branchName'
import { readFileBuffer, isExecutableFile, isSymbolicLink, getFileSize } from './fileSystem'
import { convertFsAccessError } from './fsErrorConverter'
import { buildMergeAbortMessage } from './gitMergeMessages'

// この上限を超える未追跡ファイルは、全文読み込んで疑似diff化する処理そのものを
// スキップする。Electron のメインプロセスは全ウィンドウで共有されているため、
// 巨大ファイルでのメモリ/CPU スパイクはこのプロセス全体をブロックしてしまう
const MAX_UNTRACKED_DIFF_FILE_SIZE_BYTES = 5 * 1024 * 1024

export async function getGitStatus(folderPath: string): Promise<GitStatusResult> {
  const git = simpleGit(folderPath)
  const isRepo = await git.checkIsRepo()
  if (!isRepo) {
    return { isRepo: false, branch: null, ahead: 0, behind: 0, files: [] }
  }
  const status = await git.status()
  return {
    isRepo: true,
    branch: status.current,
    ahead: status.ahead,
    behind: status.behind,
    files: status.files.map((f) => ({
      path: f.path,
      index: f.index,
      workingDir: f.working_dir,
      // simple-git はリネームのとき from に旧パスを入れる。undefined の
      // プロパティを持たせるとテストの toEqual や IPC の構造化クローンで
      // 余計な差異になるため、値があるときだけ含める
      ...(f.from === undefined ? {} : { from: f.from })
    }))
  }
}

// pathspec のグロブ展開を止めて、パスを文字列そのものとして扱わせる。
// git は `--` の後ろでも [ ] * ? を pathspec magic として解釈するため
// (`--` はオプション解析を止めるだけ)、"a[1].txt" を指定すると別ファイルの
// "a1.txt" が対象になる。diff なら別ファイルの差分が表示され、
// add/reset ならユーザーが選んでいないファイルがステージ/アンステージされる
// (いずれも実機で再現確認済み)
function toLiteralPathspec(filePath: string): string {
  return `:(literal)${filePath}`
}

export async function stageFile(folderPath: string, filePath: string): Promise<void> {
  const git = simpleGit(folderPath)
  await git.add(toLiteralPathspec(filePath))
}

export async function unstageFile(
  folderPath: string,
  filePath: string,
  /** リネーム(git status の index === 'R')のときの旧パス。新パスだけを
   *  reset すると、旧パスの削除だけが index に残ったまま(D old.txt /
   *  ?? new.txt)になり、アンステージのつもりが壊れた状態を作ってしまう
   *  (実機で再現確認済み)。旧パスも reset の対象に含める必要がある */
  renamedFrom?: string
): Promise<void> {
  const git = simpleGit(folderPath)
  const pathspecs = [toLiteralPathspec(filePath)]
  if (renamedFrom !== undefined) pathspecs.push(toLiteralPathspec(renamedFrom))
  await git.reset(['--', ...pathspecs])
}

// 取り消し対象の状態。状態ごとに取り消しの手段が異なる(discardFileChanges 参照)
type DiscardTargetKind =
  | 'conflicted'
  | 'untracked'
  | 'unknown'
  | 'intent-to-add'
  | 'overlaps-untracked'
  | 'tracked'

// -z(NUL 区切り)で出力されたパスの一覧。ls-files -u の行は「mode sha stage<TAB>path」の
// 形式のため、withStageInfo のときは最初の TAB より後ろをパスとして取り出す
function parseNulSeparatedPaths(output: string, withStageInfo = false): string[] {
  return output
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => (withStageInfo ? entry.slice(entry.indexOf('\t') + 1) : entry))
}

// restore --worktree が、対象と重なる未追跡(ignored を含む)のファイルを確認なしで消してしまう
// 配置かを調べる。どちらも実機で再現した(レビュー指摘):
// - 配下: 追跡済みのファイル 'foo' を消して同名のディレクトリ 'foo/' を作ると ' D foo' と
//   '?? foo/x' になり、'foo' の restore が 'foo/x' を消す
// - 親(祖先): 追跡済みの 'foo/a.ts' を消して同名のファイル 'foo' を作ると ' D foo/a.ts' と
//   '?? foo' になり、'foo/a.ts' の restore が 'foo' を中身ごと消してディレクトリにする
//   (親が外部を指すシンボリックリンクの場合もリンク自体が消える。git はリンクを 1 エントリとして扱う)
// 対象と親をすべて pathspec に渡して 1 回で問い合わせる。親の pathspec は、親が通常の
// ディレクトリなら配下の無関係な未追跡ファイルにも一致するため、「親そのもの」または
// 「対象自身か配下」と一致する出力だけを重なりとみなす。ignored のファイルも restore で
// 消えるため --exclude-standard は付けない。
// 大文字小文字を区別しないファイルシステム(macOS・Windows の既定)では、restore が大文字小文字
// だけ違う既存のエントリ('Foo/a.ts' に対する 'foo' など)も置き換えて消す。core.ignorecase を
// 読まずに常に icase で問い合わせ、出力も大文字小文字を無視して比べる(区別するファイル
// システムでは拒否が増えるだけで、データを失う側には倒れない)
// 削除した追跡済みファイルの位置にネストした git リポジトリがあると --others には出ないが、
// restore はそれを .git ごと消す。-k(checkout のために消す必要があるもの)を併用すると
// '<path>/' として出るため、同じ 1 回の問い合わせで「対象の配下」として検出できる
// --directory で未追跡のディレクトリは 1 行('<dir>/')にまとめる。親の pathspec は配下の無関係な
// 未追跡ファイルにも一致するため、付けないと親の下の大きな ignored のディレクトリ(node_modules 等)を
// 1 ファイルずつ全件列挙してしまう。まとめても '<dir>/' は「対象の配下」と同じ前方一致で判定できる
async function overlapsUntracked(git: SimpleGit, filePath: string): Promise<boolean> {
  const segments = filePath.split('/')
  const ancestors = segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join('/'))
  const output = await git.raw([
    'ls-files',
    '-z',
    '--others',
    '-k',
    '--directory',
    '--',
    ...[filePath, ...ancestors].map((path) => `:(literal,icase)${path}`)
  ])
  const target = filePath.toLowerCase()
  const lowerAncestors = ancestors.map((path) => path.toLowerCase())
  return parseNulSeparatedPaths(output)
    .map((entry) => entry.toLowerCase())
    .some(
      (entry) =>
        lowerAncestors.includes(entry) || entry === target || entry.startsWith(`${target}/`)
    )
}

// 追跡済みに完全一致しないことは「未追跡」の根拠にならない。渡されたパスの表記が index と
// ずれていると(NFD の日本語ディレクトリ名、大文字小文字だけ違うディレクトリ名)、追跡済みの
// 変更ファイルを未追跡と誤判定してゴミ箱へ移してしまう(PR レビュー指摘、実機で再現)。
// ls-files --others で未追跡であることを肯定的に確かめる。
// - icase で問い合わせる: 大文字小文字を区別しない FS で index が 'Src/a.ts' のとき、
//   ':(literal)src/a.ts' は --others に 'src/a.ts' を返してしまう。icase なら index の
//   エントリと突き合わされて出力されない(実機で確認)
// - 出力とは大文字小文字も区別して完全一致で比べる(表記のずれは判定不能として拒否する側に倒す)
// - --directory: 未追跡ディレクトリは '<dir>/' の 1 行で出る(IPC 側で末尾の / は落ちている)
// - --exclude-standard は付けない(ignored も未追跡として扱う。status には出ないため実害は無い)
async function isUntracked(git: SimpleGit, filePath: string): Promise<boolean> {
  const output = await git.raw([
    'ls-files',
    '-z',
    '--others',
    '--directory',
    '--',
    `:(literal,icase)${filePath}`
  ])
  return parseNulSeparatedPaths(output).some(
    (entry) => entry === filePath || entry === `${filePath}/`
  )
}

// 取り消し対象の状態を git に問い合わせて判定する。先の判定で決まれば後の問い合わせは行わない。
// pathspec はディレクトリの前方一致として働く(':(literal)foo' は 'foo/a.ts' にも一致する)ため、
// 出力の有無ではなく、対象のパスと完全に一致するエントリがあるかで判定する。出力の有無で
// 判定すると、追跡済みの 'foo/a.ts' を消して同名のファイル 'foo' を作ったときに、未追跡の
// 'foo' を追跡済みと誤判定し、restore が 'foo' を置き換えて内容が失われる(レビュー指摘)。
// パスに改行等が含まれても区切りを誤らないよう -z を使う。
// - コンフリクト中: ls-files -u に一致するエントリがある
// - 未追跡: ls-files に一致するエントリが無く、ls-files --others に一致するエントリがある
//   (isUntracked。どちらにも一致しなければ判定不能 'unknown')
// - intent-to-add(git add -N、status は ' A'): ls-files には出るが index には空の
//   エントリしか無い。working tree と index の差分が「追加」になるのは intent-to-add
//   だけなので diff --diff-filter=A で判定する
// - 未追跡と重なる: restore が未追跡(ignored を含む)のファイルを消してしまう配置(overlapsUntracked)
// - それ以外は追跡済み
async function classifyDiscardTarget(
  git: SimpleGit,
  filePath: string,
  pathspec: string
): Promise<DiscardTargetKind> {
  const unmerged = await git.raw(['ls-files', '-u', '-z', '--', pathspec])
  if (parseNulSeparatedPaths(unmerged, true).includes(filePath)) return 'conflicted'
  const tracked = await git.raw(['ls-files', '-z', '--', pathspec])
  if (!parseNulSeparatedPaths(tracked).includes(filePath)) {
    return (await isUntracked(git, filePath)) ? 'untracked' : 'unknown'
  }
  const added = await git.raw(['diff', '--name-only', '-z', '--diff-filter=A', '--', pathspec])
  if (parseNulSeparatedPaths(added).includes(filePath)) return 'intent-to-add'
  if (await overlapsUntracked(git, filePath)) return 'overlaps-untracked'
  return 'tracked'
}

// 「変更」セクションのファイル単位の取り消し。filePath はリポジトリ相対パス。
// 状態の判定は classifyDiscardTarget に任せ、ここでは状態ごとの手段だけを決める:
// - コンフリクト中は git restore が 'is unmerged' の英語エラーで失敗するため、
//   日本語で拒否する(解決 UI とセットで別対応)
// - 未追跡は git の履歴に内容が無く、完全に削除すると復元できないため、OS のゴミ箱へ移す
// - 判定不能(追跡済みにも未追跡にも一致しない)は、どちらの手段も誤った対象に働きうるため拒否する
// - intent-to-add は restore --worktree がファイルを空にするだけで ' A' のまま残り、
//   履歴の無い内容が失われる(git 2.50.1 の実機で確認)。先に index から外してから
//   ゴミ箱へ移す(ゴミ箱への移動が失敗しても、ゴミ箱にあるファイルを指す宙ぶらりんの
//   index エントリではなく、通常の未追跡ファイルが残るようにする)
// - 未追跡と重なる場合は、restore が未追跡のファイルを確認なしで消すため拒否する
// - 追跡済みは restore --worktree で index の内容へ戻す(ステージ済みの内容は残る)
export async function discardFileChanges(
  folderPath: string,
  filePath: string,
  trash: (absolutePath: string) => Promise<void>
): Promise<void> {
  const git = simpleGit(folderPath)
  const pathspec = toLiteralPathspec(filePath)
  const moveToTrash = async (): Promise<void> => {
    try {
      await trash(join(folderPath, filePath))
    } catch {
      throw new Error(`ゴミ箱へ移動できませんでした: ${filePath}`)
    }
  }
  switch (await classifyDiscardTarget(git, filePath, pathspec)) {
    case 'conflicted':
      throw new Error(`コンフリクト中のファイルは取り消せません: ${filePath}`)
    case 'untracked':
      await moveToTrash()
      return
    case 'unknown':
      throw new Error(`状態を判定できないため取り消せません: ${filePath}`)
    case 'intent-to-add':
      await git.raw(['rm', '--cached', '-q', '--', pathspec])
      await moveToTrash()
      return
    case 'overlaps-untracked':
      throw new Error(`未追跡のファイルと重なるため取り消せません: ${filePath}`)
    case 'tracked':
      await git.raw(['restore', '--worktree', '--', pathspec])
      return
  }
}

export async function commit(folderPath: string, message: string): Promise<void> {
  const git = simpleGit(folderPath)
  await git.commit(message)
}

// 「renamedFrom(旧パス)を実際に diff へ反映すべきステージ済みリネームか」の判定。
// getDiff 内部でのパッチ組み立てと、gitHandlers.ts の境界チェック省略判定
// (使われない値のために renamedFrom を律儀にチェックして未ステージ diff の
// 取得ごと失敗させないための最適化)が同じ条件を独立に持っていた。片方だけ
// 見直された場合、境界チェック側と実際の diff 生成側で「いつ renamedFrom が
// 有効か」の認識がずれるため、1箇所にまとめる
export function isStagedRenameDiff(
  staged: boolean,
  renamedFrom: string | undefined
): renamedFrom is string {
  return staged && renamedFrom !== undefined
}

export async function getDiff(
  folderPath: string,
  filePath: string,
  staged: boolean,
  isUntracked: boolean,
  /** リネーム(git status の index === 'R')のときの旧パス。ステージ済み diff を
   *  取るときだけ pathspec に併記する */
  renamedFrom?: string
): Promise<string> {
  // core.quotePath(既定 true)を打ち消さないと、ファイル名に非ASCII文字を含む
  // 場合 git diff の出力がダブルクォート+オクタルエスケープされる
  // (例: "b/\346\227\245\346\234\254.txt")。toSelfDiffHeaderLines(diffParser.ts)
  // は "+++ b/" の固定長プレフィックスで新パスを切り出すため、エスケープされた
  // 形式だとリネームを伴うファイルのハンク単位ステージ/アンステージが壊れる
  // (実機で再現確認済み)
  const git = simpleGit(folderPath, { config: ['core.quotePath=false'] })
  // 未追跡かどうかは呼び出し元(renderer)が既に持っている git status 由来の情報を
  // そのまま受け取る。ここで改めて git.status() を呼んでリポジトリ全体を再スキャン
  // すると、diff タブを開くたびに無駄な I/O が発生する
  if (!staged && isUntracked) {
    try {
      // readFileBuffer(fs.readFile)はシンボリックリンクを辿った先の実体を
      // 読んでしまうため、実体を読む前に検出する。検出せずに疑似diff化して
      // git apply --cached すると、実体の内容がコピーされた通常ファイルとして
      // ステージされ、シンボリックリンクとしての git 上の表現(mode 120000)に
      // ならない
      if (await isSymbolicLink(join(folderPath, filePath))) {
        return buildSymlinkDiffMessage(filePath)
      }
      // ファイル内容を全文読み込む前にサイズを確認する。読み込んでから
      // 判定すると、判定のために既に巨大ファイルをメモリへ読み切ってしまい
      // ガードの意味が無くなる
      const size = await getFileSize(join(folderPath, filePath))
      if (size > MAX_UNTRACKED_DIFF_FILE_SIZE_BYTES) {
        return buildTooLargeDiffMessage(filePath)
      }
      // 空ファイルはハンク(@@)を持てないため疑似diffを組み立てられない。
      // ヘッダのみの diff を返すと DiffView がそのヘッダ行をそのまま描画し、
      // "diff --git a/x b/x" などの内部表現がユーザーに露出してしまう
      if (size === 0) {
        return buildEmptyFileDiffMessage(filePath)
      }
      const buffer = await readFileBuffer(join(folderPath, filePath))
      // バイナリファイルや非UTF-8テキスト(Shift_JIS 等)を utf-8 として無条件に
      // 読み込むと、バイト列が破壊された(あるいは無条件デコードで文字化けした)
      // 状態で疑似diffが組み立てられ、それを git apply --cached したとき
      // 破損した内容がそのままインデックスにステージされてしまう。
      // decodeUtf8OrNull は「バリデーション+デコード」を1回で行うため、
      // buffer.toString('utf-8') で同じ内容を再デコードする無駄が無い
      const decoded = decodeUtf8OrNull(buffer)
      if (isBinaryContent(buffer) || decoded === null) {
        return buildBinaryDiffMessage(filePath)
      }
      // readFileBuffer だけでなく isExecutableFile(fs.stat)も同じ try に含める。
      // untracked 判定からここまでの間にファイルが削除されるレースは、
      // readFileBuffer と isExecutableFile の間でも起こり得るため
      const isExecutable = await isExecutableFile(join(folderPath, filePath))
      return buildUntrackedDiff(filePath, decoded, isExecutable)
    } catch (err) {
      // untracked 判定とファイル読み込み/stat の間にファイルが削除される等の
      // レースが起きた場合、生の Node エラー(OS絶対パスを含む)をそのまま伝播すると、
      // 他の fs 系ハンドラ(fileSystemHandlers.ts)が convertFsAccessError で
      // 統一している「わかりやすい日本語メッセージ」から外れてしまう。
      // 同じ変換ロジックを別実装として複製すると、片方だけ文言や判定を
      // 変更したときにずれるため、共通関数を使う
      throw convertFsAccessError(err, `ファイルが見つかりません: ${filePath}`, filePath)
    }
  }
  // ユーザーの gitconfig がそのまま効くため、パッチの形式を左右する設定を
  // 明示的にすべて打ち消す。いずれも実機で再現確認済み:
  // - diff.noprefix=true: 出力に a/ b/ が付かず、gitApply の `git apply`
  //   (既定は -p1 = 先頭1階層を剥がす)が "git diff header lacks filename
  //   information" で全ハンクのステージ/アンステージに失敗する
  // - diff.external: パッチとして適用できない出力になる(--no-ext-diff)
  // - textconv(.gitattributes の diff=<driver> + diff.<driver>.textconv):
  //   変換後のテキストで diff が作られるため、変換結果が同一だと「差分は
  //   ありません」と表示され、異なる場合は実体と食い違うパッチが作られる。
  //   --no-ext-diff では無効化されないので --no-textconv が別途必要
  // - color.ui / color.diff = always: パイプ出力でも ANSI エスケープが混入し、
  //   DiffView にエスケープ列が文字として表示され、パッチも壊れる
  // 未追跡ファイルの疑似diff(buildUntrackedDiff)は常に a/ b/ を付けるので、
  // 揃えるべきはこちら側
  const patchFormatArgs = [
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    '--src-prefix=a/',
    '--dst-prefix=b/'
  ]
  const literalPathspec = toLiteralPathspec(filePath)
  // ステージ済みリネームは、新パスだけを pathspec に渡すと旧パス側が対象から
  // 外れるため git がリネーム検出を行わず、「新規ファイル + 全行追加」として
  // 出力される。その diff を「このハンクをアンステージ」で reverse apply すると、
  // index から新パスが消えるだけで旧パスの削除はステージに残り、そのまま
  // コミットするとファイルが消えてしまう(実機で再現確認済み)。
  // 旧パスも渡せばリネームとして出力され、reverse apply も正しく元へ戻る。
  // 未ステージ側の変更はリネーム後のパスに対するものなので旧パスは混ぜない
  const isStagedRename = isStagedRenameDiff(staged, renamedFrom)
  const pathspecs = isStagedRename
    ? [literalPathspec, toLiteralPathspec(renamedFrom)]
    : [literalPathspec]
  // diff.renames=false のユーザー設定では、旧パスを pathspec に含めても git は
  // リネーム検出を行わず「新規追加 + 削除」の 2 ファイル分の diff を返す
  // (status.renames=true なら git status 側はリネームと報告するので、
  //  renderer は renamedFrom を渡してくる)。単一ファイル前提の parseDiff は
  // 2 ファイル目の配管行(diff --git / deleted file mode / index / --- / +++)を
  // 1 ファイル目のハンク本文へ混入させ、DiffView がそれを差分行として描画し、
  // buildHunkPatch が作るパッチも corrupt patch で apply に失敗する
  // (実機で再現確認済み)。--find-renames で設定に依存させない
  const renameArgs = isStagedRename ? ['--find-renames'] : []
  const args = staged
    ? [...patchFormatArgs, '--cached', ...renameArgs, '-U3', '--', ...pathspecs]
    : [...patchFormatArgs, '-U3', '--', ...pathspecs]
  return git.diff(args)
}

export async function getLog(
  folderPath: string,
  limit: number,
  skip: number
): Promise<GitLogEntry[]> {
  const git = simpleGit(folderPath)
  // 「リポジトリでない」の判定は、git の生エラーメッセージへの文字列一致
  // (将来の git バージョンやロケール差異で揺らぎうる)ではなく、checkIsRepo() という
  // 構造的な API に委ねる(getGitStatus と同じ判定方法)。getBranches/getTags は
  // non-repo フォルダで throw しても呼び出し元(useGitHistory)が .catch(() => []) で
  // 正常系として扱うため、getLog だけ非対称に扱うと非gitフォルダを開いただけで
  // historyError がセットされてしまう
  const isRepo = await git.checkIsRepo()
  if (!isRepo) return []
  // %s(subject 1行のみ)ではなく %B(生のコミットメッセージ全体、複数行本文を含む)を使う。
  // amend 時にこの message をそのままメッセージ欄へ入れるため、%s のままだと複数行の
  // コミット本文が amend のたびに1行に切り詰められてしまう
  const format = '%H%x1f%B%x1f%aI%x1f%an%x1e'
  let output: string
  try {
    // env() は使わない。環境変数を明示的に渡すと simple-git の
    // blockUnsafeOperationsPlugin が spawn 前に内容を検査し、EDITOR / PAGER /
    // GIT_EDITOR / GIT_SSH_COMMAND 等が含まれていると GitPluginError を throw する
    // (実機で再現確認済み)。これらはほぼすべての開発者のシェルに設定されており
    // main プロセスがそのまま継承するため、履歴パネルが常にエラー+空になり、
    // lastCommitMessage が null のままで amend も永久に使えなくなってしまう。
    // 以前はロケール固定(LANG/LC_ALL=C)のために env() を使っていたが、
    // 「コミットがまだ無い」判定を下の rev-parse による構造的な判定へ移したため
    // ロケールに依存する必要自体が無くなった
    output = await git.raw([
      'log',
      `--max-count=${limit}`,
      `--skip=${skip}`,
      `--pretty=format:${format}`
    ])
  } catch (err) {
    // 「コミットがまだ無い」ケースかどうかを、git の生エラーメッセージへの
    // 英語部分文字列一致ではなく rev-parse の成否で判定する。文字列一致は
    // ローカライズされた git で通常の新規リポジトリをエラー扱いにしてしまう。
    // rev-parse も失敗する = HEAD が指すコミットが無い(unborn HEAD)ので空配列。
    // それ以外(git が PATH に無い、リポジトリ破損等)は握りつぶさず伝播させる。
    // 握りつぶすと履歴パネルが静かに「コミットなし」と表示され、ユーザーに
    // 実際の問題が伝わらない
    const hasCommits = await git
      .raw(['rev-parse', '--verify', 'HEAD'])
      .then(() => true)
      .catch((revParseErr) => {
        // rev-parse 自体が GitError(git プロセスは起動できたが exit code 非0)
        // 以外の理由で失敗した場合(git バイナリ不在等の spawn レベルの異常)、
        // それは log の失敗と同じ根本原因である可能性が高い。unborn HEAD と
        // 誤判定して元の log 失敗のエラー(err)を握りつぶさないよう、
        // GitError 以外はここで rethrow する
        if (!(revParseErr instanceof GitError)) throw err
        return false
      })
    if (!hasCommits) return []
    throw err
  }
  return parseGitLogOutput(output)
}

export async function getBranches(folderPath: string): Promise<GitBranch[]> {
  const git = simpleGit(folderPath)
  const summary = await git.branchLocal()
  return summary.all.map((name) => ({ name, current: name === summary.current }))
}

export async function getTags(folderPath: string): Promise<string[]> {
  const git = simpleGit(folderPath)
  const result = await git.tags()
  return result.all
}

// push/pull/fetch はネットワークI/Oを伴う。認証プロンプト待ち(認証情報未設定で
// 端末から起動した場合、git が /dev/tty を開いてプロンプトを出し誰も応答しない)や
// 到達不能なホストへの接続では、タイムアウトが無いと simple-git の Promise が
// 永久に解決せず、呼び出し元(useGitRemoteOperations.ts)の実行中フラグが true の
// まま戻らずボタンが恒久的に disabled のまま固まる(pull の場合は共有ロックも
// 解除されず commit/ハンク操作まで巻き添えになる、runGitApply の
// GIT_APPLY_TIMEOUT_MS と同じ理由)。simple-git 標準の timeout プラグイン
// (stdout/stderr に一定時間データが来ないと強制終了する)を使う。
// env() 経由で GIT_TERMINAL_PROMPT 等を渡す方式は、blockUnsafeOperationsPlugin が
// GIT_SSH_COMMAND 等の継承環境変数を検査して GitPluginError を投げる既存の地雷
// (getLog 参照)を再び踏むため採用しない
const GIT_REMOTE_TIMEOUT_MS = 30_000

function simpleGitWithRemoteTimeout(folderPath: string): SimpleGit {
  return simpleGit(folderPath, {
    timeout: { block: GIT_REMOTE_TIMEOUT_MS },
    // git は stderr が tty に接続されていないと既定で進捗行を出力しない。
    // simple-git は progress オプションを渡した場合のみ push/pull/fetch に
    // --progress を自動付与する(渡さないと timeout プラグインが見ている
    // stdout/stderr に実際の転送中(圧縮・送受信)も何も流れず、正常に進行中の
    // 操作まで誤ってタイムアウトしてしまう)。コールバックの中身は使わないため
    // no-op
    progress: () => {}
  })
}

// timeout プラグインが投げる GitPluginError のメッセージは "block timeout
// reached" という固定の英語の内部文字列で、ユーザーに見せても原因が伝わらない
// (アプリの他の文言はすべて日本語)。plugin === 'timeout' のときだけ、原因の
// 推測もセットにした日本語メッセージへ差し替える。それ以外の GitPluginError
// (timeout プラグイン以外が投げたもの)は素通しする
function toRemoteOperationError(err: unknown): unknown {
  if (err instanceof GitPluginError && err.plugin === 'timeout') {
    return new Error(
      '操作がタイムアウトしました。認証情報が未設定か、ネットワークに問題がある可能性があります'
    )
  }
  return err
}

// 既に origin が設定され、現在のブランチに upstream が設定済みであることを前提に
// 引数なしで呼ぶ(git 自身のデフォルト解決に委ねる)。remote の追加・作成・
// upstream の設定は別スコープ(ROADMAP 上も別項目)
export async function push(folderPath: string): Promise<void> {
  const git = simpleGitWithRemoteTimeout(folderPath)
  try {
    await git.push()
  } catch (err) {
    throw toRemoteOperationError(err)
  }
}

export async function pull(folderPath: string): Promise<void> {
  const git = simpleGitWithRemoteTimeout(folderPath)
  try {
    await git.pull()
  } catch (err) {
    throw toRemoteOperationError(err)
  }
}

// グローバルの fetch() と名前が衝突するため関数名は fetchRemote にする
// (IPC チャンネル名・preload 側のメソッド名は 'git:fetch' のまま)
export async function fetchRemote(folderPath: string): Promise<void> {
  const git = simpleGitWithRemoteTimeout(folderPath)
  try {
    await git.fetch()
  } catch (err) {
    throw toRemoteOperationError(err)
  }
}

// 許可リスト検証(パターン21)の境界: branchName は IPC 境界から届く任意の文字列のため、
// 実在するローカルブランチ名だけを通す。checkout・削除・マージで共通。
// '-' で始まる名前('--force' 等)がオプションとして git に渡るのをここで止める。
// current の判定には同じ summary を使うため、branchLocal() は呼び出し元で取得する
function assertLocalBranchExists(summary: Pick<BranchSummary, 'all'>, branchName: string): void {
  if (!summary.all.includes(branchName)) {
    throw new Error(`存在しないブランチです: ${branchName}`)
  }
}

// checkout はローカルの working tree/index/HEAD を書き換えるのみでネットワークI/O
// を伴わないため、push/pull/fetch の simpleGitWithRemoteTimeout は不要。
// 未コミットの変更が切り替え先ブランチと衝突する場合、simple-git は通常の
// GitError(GitPluginError ではない)を投げる。gitコマンド自体が返す情報が
// ユーザーにとって意味のある内容("Your local changes... would be overwritten"等)
// なので、push/pull/fetch のタイムアウトエラーとは異なり変換せず素通しする
//
// branchName は checkout() の positional 引数として git へそのまま渡る。
// simple-git はシェル経由で spawn しないためシェルインジェクションは起きないが、
// '-' で始まる文字列は git 自身にオプションとして解釈されてしまう
// (例: '--orphan' で意図しない孤立ブランチが作られる)。UI は必ず getBranches() が
// 返した実在のローカルブランチ名からのみ選択させているため実害は無いが、
// IPC 境界(gitHandlers.ts)は任意の文字列を受け付けてしまうため、ここで
// 許可リスト方式(実在するローカルブランチ名のみ)で検証する
export async function checkoutBranch(folderPath: string, branchName: string): Promise<void> {
  const git = simpleGit(folderPath)
  const summary = await git.branchLocal()
  assertLocalBranchExists(summary, branchName)
  await git.checkout(branchName)
}

// ブランチ名が不正なときのエラー。形式違反(アプリ独自の規則・git の check-ref-format)は
// 原則この同じ文言にし、呼び出し元(エラーバナー)が違反の種類を区別する必要が無いように
// する。例外は '-' 始まりで、直し方が明確なため assertCreatableBranchName が専用の文言を返す
function invalidBranchNameError(branchName: string): Error {
  return new Error(`ブランチ名として使用できない名前です: ${branchName}`)
}

// 新しいブランチ名として使えるかを検証する。branchName は IPC 境界から届く任意の文字列の
// ため、次の順で検証する(前の検証に失敗したら後の git 呼び出しには進まない):
// 1. アプリ独自の規則(@shared/branchName)。'-' 始まりは check-ref-format 自体にも
//    オプションとして解釈されるため、git に渡す前に弾く(docs/review-findings-patterns.md
//    パターン21)。'@' のみは `git checkout @` が HEAD と解釈され、作成後に切り替えられない
// 2. git 本体の規則(`..`、空白、`~^:?*[\`、末尾の .lock 等)は check-ref-format --branch
//    に委ねる。--branch は '@{-1}'(直前のブランチ)を実在のブランチ名へ展開して成功扱いに
//    するため、出力(正規化後の名前)が入力と一致することも確認する
// 3. 同名の既存ブランチ、および階層が衝突する既存ブランチ('main' に対する 'main/sub' 等)は、
//    checkout -b の失敗(英語のエラー文)を見せる前に日本語で弾く
async function assertCreatableBranchName(git: SimpleGit, branchName: string): Promise<void> {
  const violation = getBranchNameRuleViolation(branchName)
  if (violation === 'leading-dash') {
    throw new Error(`\`-\` で始まるブランチ名は使用できません: ${branchName}`)
  }
  if (violation !== null) throw invalidBranchNameError(branchName)
  let normalized: string
  try {
    normalized = (await git.raw(['check-ref-format', '--branch', branchName])).trim()
  } catch {
    throw invalidBranchNameError(branchName)
  }
  if (normalized !== branchName) throw invalidBranchNameError(branchName)
  const summary = await git.branchLocal()
  if (summary.all.includes(branchName)) {
    throw new Error(`同じ名前のブランチが既に存在します: ${branchName}`)
  }
  const conflicting = findConflictingBranchName(branchName, summary.all)
  if (conflicting !== null) {
    throw new Error(`既存のブランチ ${conflicting} と名前が衝突します: ${branchName}`)
  }
}

// 現在の HEAD から新しいブランチを作り、そのブランチへ切り替える(git checkout -b)。
// HEAD の指すコミットは変わらないため working tree/index は変化せず、未コミットの
// 変更はそのまま新しいブランチへ持ち越される(renderer 側で未保存編集の破棄確認や
// エディタの再読込が不要な理由)
export async function createBranch(folderPath: string, branchName: string): Promise<void> {
  const git = simpleGit(folderPath)
  await assertCreatableBranchName(git, branchName)
  await git.checkoutLocalBranch(branchName)
}

// 削除してよいブランチかを検証する。branchName は IPC 境界から届く任意の文字列のため、
// checkoutBranch と同じく許可リスト(実在するローカルブランチ名)で検証してから git に
// 渡す(パターン21)。いずれかの worktree でチェックアウト中のブランチは、git 自身も
// 削除を拒否するが、そのエラーは未マージの失敗と同じ `error: ... '<name>'` 形式で区別
// できない(実機で確認)。事前に弾かないと「強制削除しますか？」と誤って聞いてしまう
async function assertDeletableBranch(git: SimpleGit, branchName: string): Promise<void> {
  const summary = await git.branchLocal()
  assertLocalBranchExists(summary, branchName)
  if (branchName === summary.current) {
    throw new Error(`現在のブランチは削除できません: ${branchName}`)
  }
  const checkedOut = parseWorktreeBranches(await git.raw(['worktree', 'list', '--porcelain']))
  if (checkedOut.has(branchName)) {
    throw new Error(`他のワークツリーで使用中のブランチは削除できません: ${branchName}`)
  }
}

// git branch -d と同じ基準でマージ済みかを判定する。基準は「upstream が設定され、
// その ref が実在すれば upstream、そうでなければ HEAD」(git 本体の branch_merged と同じ)。
// 削除失敗のエラーから未マージを判定しないのは次の理由(spec 参照):
// - simple-git が GitResponseError に変換するのは git の出力が英語の `error: ... '<name>'`
//   形式のときだけで、日本語化された git では変換されない
// - ロケールを固定する env() は blockUnsafeOperationsPlugin の地雷を踏む(getLog 参照)
// 使うコマンドはいずれも「出力の有無」だけで判定でき、ロケールに依存しない。
// rev-parse --verify --quiet は ref が無いと exit 1・stderr 空で終わるが、simple-git は
// stderr が空なら reject しないため空文字で resolve する
async function isBranchMerged(git: SimpleGit, branchName: string): Promise<boolean> {
  const ref = `refs/heads/${branchName}`
  const upstream = (await git.raw(['for-each-ref', '--format=%(upstream)', ref])).trim()
  let base = 'HEAD'
  if (upstream !== '') {
    const resolved = (await git.raw(['rev-parse', '--verify', '--quiet', upstream])).trim()
    if (resolved !== '') base = upstream
  }
  const merged = await git.raw(['for-each-ref', `--merged=${base}`, '--format=%(refname)', ref])
  return merged.trim() === ref
}

// 事前チェックと削除の間に別プロセスがマージや worktree 追加を行う競合は対象外とする。
// その場合は git 自身が削除を拒否してエラーになるだけで、コミットは失われない
export async function deleteBranch(
  folderPath: string,
  branchName: string,
  force: boolean
): Promise<DeleteBranchResult> {
  const git = simpleGit(folderPath)
  await assertDeletableBranch(git, branchName)
  if (!force && !(await isBranchMerged(git, branchName))) {
    return { deleted: false, reason: 'not-fully-merged' }
  }
  await git.deleteLocalBranch(branchName, force)
  return { deleted: true }
}

// マージ中か(MERGE_HEAD があるか)。rev-parse -q --verify は ref が無いと終了コード 1・
// stderr 空で終わり、simple-git は reject せず空文字で resolve する(isBranchMerged と同じ)
async function hasMergeInProgress(git: SimpleGit): Promise<boolean> {
  const head = await git.raw(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
  return head.trim() !== ''
}

// HEAD がブランチを指しているか。simple-git の branchLocal() の summary.detached は使わない:
// `git branch -v` の先頭行が `(HEAD detached at X)` / `(HEAD detached from X)` の形のときしか
// detached と認識せず、rebase 中の `(no branch, rebasing main)` や bisect 中の
// `(no branch, bisect started on main)` は current: "(no"・detached: false と解析されるため、
// rebase を edit で止めている間などに検証をすり抜けてしまう(実機で確認)。
// symbolic-ref -q HEAD はブランチ上なら `refs/heads/<name>` を返し、ブランチ上にいなければ
// (detached・rebase 中・bisect 中)終了コード 1・stderr 空で終わる。simple-git は reject せず
// 空文字で resolve する(hasMergeInProgress と同じ)
async function isOnBranch(git: SimpleGit): Promise<boolean> {
  const ref = await git.raw(['symbolic-ref', '-q', 'HEAD'])
  return ref.trim() !== ''
}

// 同名のタグ等があると git は refs/tags を優先し、警告だけで終了コード 0 のまま別のコミットを
// マージする(実機で確認)。名前の解決先がブランチの先端と食い違えば、選んでいないコミットを
// マージしないよう拒否する。同じコミットを指すタグは無害なので拒否しない。
// ブランチの先端は rev-parse ではなく for-each-ref で取る: 大文字小文字を区別しない FS
// (macOS・Windows の既定)で `feat`(packed-refs)と `Feat`(loose ref のファイル)が共存すると、
// rev-parse は両方とも loose の `Feat` のファイルへ解決して同じ値になり、検証を素通りする
// (実機で確認)。for-each-ref は ref 名で返すので `feat` の正しい SHA を得られ、解決先との
// 食い違いで検出できる。出力は `<refname> <objectname>` の行で、git の refname は空白を含められない
// ため空白で分割できる。パターンは配下(refs/heads/<name>/x)にも一致しうるので、refname が
// 完全一致する行だけを先端とする
async function assertBranchRefUnambiguous(git: SimpleGit, branchName: string): Promise<void> {
  const ref = `refs/heads/${branchName}`
  const [resolved, listing] = await Promise.all([
    git.raw(['rev-parse', '--verify', '-q', `${branchName}^{commit}`]),
    git.raw(['for-each-ref', '--format=%(refname) %(objectname)', ref])
  ])
  const tip = listing
    .split('\n')
    .map((line) => line.trim().split(' '))
    .find(([refname]) => refname === ref)?.[1]
  if (tip === undefined || resolved.trim() === '' || resolved.trim() !== tip) {
    throw new Error(`同名のタグ等があり、ブランチを特定できないためマージできません: ${branchName}`)
  }
}

// マージ対象のブランチを特定できるかを検証する。branchName は IPC 境界から届く任意の文字列のため、
// checkoutBranch と同じく許可リスト(実在するローカルブランチ名)で検証してから git に渡す
// (パターン21)。前の検証に失敗したら後の git 呼び出しには進まない。
// 曖昧さの判定は実在確認(許可リスト)の後、マージ中・未コミットの判定(assertMergeStartable)の
// 前に置く: ブランチを特定できない状態では、以降の判定結果をユーザーに見せても意味がないため
async function assertMergeTargetBranch(git: SimpleGit, branchName: string): Promise<void> {
  const summary = await git.branchLocal()
  assertLocalBranchExists(summary, branchName)
  if (!(await isOnBranch(git))) {
    throw new Error('ブランチをチェックアウトしてからマージしてください')
  }
  // ブランチ上にいることが確定した後なので、current は実在のブランチ名になる
  if (branchName === summary.current) {
    throw new Error(`現在のブランチ自身はマージできません: ${branchName}`)
  }
  await assertBranchRefUnambiguous(git, branchName)
}

// リポジトリの状態がマージを始められるかを検証する。
// 追跡済みファイルに未コミットの変更があるときは開始しない: 重ならない変更なら git は
// そのままマージを始めるが、その後 git merge --abort が未コミットの変更を元に戻せない場合が
// あると git の公式ドキュメントが警告している。未追跡ファイルだけなら開始できる
// (マージで上書きされる未追跡ファイル(ignored を除く)があれば git が拒否する。ignored の
// ファイルは git の既定どおり黙って上書きされ、コンフリクトで自動中止しても復元されない)
async function assertMergeStartable(git: SimpleGit): Promise<void> {
  if (await hasMergeInProgress(git)) {
    throw new Error('マージ中のため実行できません')
  }
  const dirty = await git.raw(['status', '--porcelain', '-z', '--untracked-files=no'])
  if (dirty !== '') {
    throw new Error('未コミットの変更があるためマージできません。先にコミットしてください')
  }
}

// 途中で止まったマージを元に戻し、日本語のエラーを投げる。未解決のファイルは中止すると
// 取れなくなるため、必ず中止より前に取得する。未解決のファイルが無いのに MERGE_HEAD が
// 残るのは、pre-merge-commit フックの失敗等(実機で確認)。mergeError はその git のエラー
async function abortFailedMerge(git: SimpleGit, mergeError: unknown): Promise<never> {
  const conflicted = parseNulSeparatedPaths(
    await git.raw(['diff', '--name-only', '-z', '--diff-filter=U'])
  )
  await git.raw(['merge', '--abort'])
  const detail = mergeError instanceof Error ? mergeError.message : String(mergeError ?? '')
  throw new Error(buildMergeAbortMessage(conflicted, detail))
}

// 指定したローカルブランチを現在のブランチへマージする(git merge --no-edit。早送りできれば
// 早送りし、できなければマージコミットを作る。git の既定)。
// コンフリクトはアプリ内に解決手段が無いため、自動で中止して元に戻す。中止するかは
// エラー文ではなく MERGE_HEAD の有無で判定する(パターン28): コンフリクトでは git が
// 終了コード 1・stderr 空で終わり simple-git が resolve するため、例外の有無も当てにならない。
// MERGE_HEAD が無いまま失敗した場合は git が何も変えていない(無関係な履歴の拒否、
// 上書きされる未追跡ファイル、コミッター情報なし等)ので、checkout と同じく git のエラーを
// そのまま投げる。ローカルの操作でネットワーク I/O を伴わないため、リモート用のタイムアウトは使わない
export async function mergeBranch(folderPath: string, branchName: string): Promise<void> {
  const git = simpleGit(folderPath)
  await assertMergeTargetBranch(git, branchName)
  await assertMergeStartable(git)
  let mergeError: unknown = null
  try {
    await git.raw(['merge', '--no-edit', branchName])
  } catch (err) {
    mergeError = err
  }
  if (await hasMergeInProgress(git)) await abortFailedMerge(git, mergeError)
  if (mergeError !== null) throw mergeError
}

export async function amendCommit(folderPath: string, message: string): Promise<void> {
  const git = simpleGit(folderPath)
  // '--amend' は files ではなくオプション引数(第3)で渡す。simple-git の
  // commit(message, files, options) は ['commit', '-m', msg, ...files, ...options] を
  // 組み立てるため、files スロットに渡しても今は git がオプションを位置に関係なく
  // 解釈して動く。ただし simple-git が他タスクと同様に files の前へ '--' を挿入する
  // 実装に変われば `git commit -m msg -- --amend` となり、amend ではなく
  // 「--amend という名前のファイル」を対象にした新規コミットに静かに化ける。
  // options は Record<string, OptionsValues> 型のため、値なしフラグは null を渡す
  await git.commit(message, undefined, { '--amend': null })
}
