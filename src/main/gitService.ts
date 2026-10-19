import { join } from 'path'
import simpleGit, { GitError } from 'simple-git'
import type { BranchSummary, SimpleGit } from 'simple-git'
import type {
  GitStatusResult,
  GitLogEntry,
  GitBranch,
  DeleteBranchResult,
  MergeBranchResult
} from '@shared/types'
import {
  buildUntrackedDiff,
  isBinaryContent,
  decodeUtf8OrNull,
  buildBinaryDiffMessage,
  buildSymlinkDiffMessage,
  buildTooLargeDiffMessage,
  buildEmptyFileDiffMessage
} from './gitDiffFormatter'
import { toLiteralPathspec } from './gitPathParsing'
import { PATCH_FORMAT_ARGS, PATCH_FORMAT_CONFIG } from './gitDiffArgs'
import { parseGitLogOutput } from './gitLogFormatter'
import { parseWorktreeBranches } from './gitWorktreeParser'
import { findConflictingBranchName } from '@shared/branchName'
import { readFileBuffer, isExecutableFile, isSymbolicLink, getFileSize } from './fileSystem'
import { convertFsAccessError } from './fsErrorConverter'
import { buildMergeAbortMessage, buildMergeConflictMessage } from './gitMergeMessages'
import {
  hasMergeInProgress,
  hasUnmergedFiles,
  isUnmergedPath,
  listUnresolvedFiles
} from './gitMergeState'
import { ORIGIN_REMOTE, listRemoteNames } from './gitRemoteNames'
import { assertValidNewBranchName } from './gitBranchNameGuard'
import { getCurrentBranchRef } from './gitHeadState'
import { simpleGitWithRemoteTimeout, toRemoteOperationError } from './gitRemoteTimeout'

// この上限を超える未追跡ファイルは、全文読み込んで疑似diff化する処理そのものを
// スキップする。Electron のメインプロセスは全ウィンドウで共有されているため、
// 巨大ファイルでのメモリ/CPU スパイクはこのプロセス全体をブロックしてしまう
export const MAX_UNTRACKED_DIFF_FILE_SIZE_BYTES = 5 * 1024 * 1024

export async function getGitStatus(folderPath: string): Promise<GitStatusResult> {
  const git = simpleGit(folderPath)
  const isRepo = await git.checkIsRepo()
  if (!isRepo) {
    return {
      isRepo: false,
      branch: null,
      ahead: 0,
      behind: 0,
      files: [],
      mergeInProgress: false,
      hasOrigin: false,
      hasRemote: false,
      upstream: null,
      detached: false
    }
  }
  // リモートの名前は git remote で 1 回だけ問い合わせ、origin の有無(hasOrigin)とリモートの有無(hasRemote)を
  // 同じ出力から決める。upstream と detached は git.status() の結果に含まれる(追加の git 呼び出しは無い)。
  // リモートのバナー(renderer の remoteSetupState)がこの 4 つで表示を決める
  const [status, mergeInProgress, remoteNames] = await Promise.all([
    git.status(),
    hasMergeInProgress(git),
    listRemoteNames(git)
  ])
  return {
    isRepo: true,
    branch: status.current,
    ahead: status.ahead,
    behind: status.behind,
    mergeInProgress,
    hasOrigin: remoteNames.includes(ORIGIN_REMOTE),
    hasRemote: remoteNames.length > 0,
    // gone(リモートの ref が消えた)でも origin/<b> が入る。既存の push は gone の upstream にも送れるため、
    // 「設定済み」として扱う(実機で確認)
    upstream: status.tracking ?? null,
    // `## HEAD (no branch)` のとき真。リベースで止めている間も真になる(実機で確認)
    detached: status.detached,
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

export async function stageFile(folderPath: string, filePath: string): Promise<void> {
  const git = simpleGit(folderPath)
  // 未解決のファイルを git add すると、マーカー入りのまま解決済みになり、そのまま完了すると
  // マーカー入りのマージコミットができる(実 git で再現済み)。解決ビューの「解決済みにする」
  // (マーカーを検査する)に誘導する。ChangesFileItem も未解決の行には + を出さない(二重防御)
  if (await isUnmergedPath(git, filePath)) {
    throw new Error(
      'コンフリクト中のファイルはステージできません。コンフリクト解決ビューの「解決済みにする」を使ってください'
    )
  }
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

export async function commit(folderPath: string, message: string): Promise<void> {
  const git = simpleGit(folderPath)
  // 未解決のまま git commit すると英語の生のエラーになるため、日本語で拒否する(何も実行しない)
  if (await hasUnmergedFiles(git)) {
    throw new Error(
      '未解決のコンフリクトがあるためコミットできません。解決するか、マージを中止してください'
    )
  }
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
  const git = simpleGit(folderPath, { config: ['core.quotePath=false', ...PATCH_FORMAT_CONFIG] })
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
  // パッチの形式を左右する利用者の設定を打ち消す引数は gitDiffArgs.ts(エージェントの変更の diff と共有)
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
    ? [...PATCH_FORMAT_ARGS, '--cached', ...renameArgs, '-U3', '--', ...pathspecs]
    : [...PATCH_FORMAT_ARGS, '-U3', '--', ...pathspecs]
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
  // マージ中の pull は git が英語('You have not concluded your merge (MERGE_HEAD exists).')で
  // 失敗する。ブランチの切り替えと同じく、git に渡す前に日本語で拒否する
  await assertNotMerging(git, PULL_WHILE_MERGING_MESSAGE)
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

const SWITCH_WHILE_MERGING_MESSAGE =
  'マージ中のためブランチを切り替えられません。マージを完了または中止してください'
const PULL_WHILE_MERGING_MESSAGE =
  'マージ中のため pull できません。マージを完了または中止してください'

// マージ中(MERGE_HEAD あり)の操作を拒否する。既定はブランチの切り替え: 切り替えると、
// 解決済みの内容が切り替え先と一致するとき MERGE_HEAD ごとマージ中の状態が黙って失われる(実機で確認)。
// pull も message を変えて使う
async function assertNotMerging(
  git: SimpleGit,
  message: string = SWITCH_WHILE_MERGING_MESSAGE
): Promise<void> {
  if (await hasMergeInProgress(git)) throw new Error(message)
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
  // マージ中に切り替えると、解決済みの内容が切り替え先と一致するとき MERGE_HEAD ごと
  // マージ中の状態が黙って失われる(実機で確認)。git に渡す前に拒否する
  await assertNotMerging(git)
  await git.checkout(branchName)
}

// 新しいブランチ名として使えるかを検証する。branchName は IPC 境界から届く任意の文字列の
// ため、次の順で検証する(前の検証に失敗したら後の git 呼び出しには進まない):
// 1・2. 名前の形式(アプリ独自の規則と git の check-ref-format --branch)。リポジトリの初期化と
//    共有する(gitBranchNameGuard の assertValidNewBranchName)
// 3. 同名の既存ブランチ、および階層が衝突する既存ブランチ('main' に対する 'main/sub' 等)は、
//    checkout -b の失敗(英語のエラー文)を見せる前に日本語で弾く
async function assertCreatableBranchName(git: SimpleGit, branchName: string): Promise<void> {
  await assertValidNewBranchName(git, branchName)
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
  // checkoutBranch と同じ理由: マージ中に作成して切り替えると MERGE_HEAD ごとマージ中の状態が失われる
  await assertNotMerging(git)
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

// HEAD がブランチを指しているか。判定の理由(branchLocal().detached を使わない)は gitHeadState の
// getCurrentBranchRef を参照(初回 push と同じ判定を使う)
async function isOnBranch(git: SimpleGit): Promise<boolean> {
  return (await getCurrentBranchRef(git)) !== null
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
// ファイルは git の既定どおり黙って上書きされ、マージを中止しても復元されない)
async function assertMergeStartable(git: SimpleGit): Promise<void> {
  if (await hasMergeInProgress(git)) {
    throw new Error('マージ中のため実行できません')
  }
  const dirty = await git.raw(['status', '--porcelain', '-z', '--untracked-files=no'])
  if (dirty !== '') {
    throw new Error('未コミットの変更があるためマージできません。先にコミットしてください')
  }
}

// 未解決のファイルが無いのに MERGE_HEAD が残ったマージ(pre-merge-commit フックの失敗等。
// 実機で確認)を元に戻し、日本語のエラーを投げる。解決する対象が無く、途中の状態を残しても
// ユーザーにできることが無いため中止する。mergeError はその git のエラー。
// 未解決のファイルがある場合(コンフリクト)は呼ばない: 中止せずに状態を残す
async function abortFailedMerge(git: SimpleGit, mergeError: unknown): Promise<never> {
  await git.raw(['merge', '--abort'])
  const detail = mergeError instanceof Error ? mergeError.message : String(mergeError ?? '')
  throw new Error(buildMergeAbortMessage(detail))
}

// 指定したローカルブランチを現在のブランチへマージする(git merge --no-edit --commit
// --no-squash。「コミットする・squash しない」は引数で固定し、早送りするかは git の設定
// (merge.ff 等)に従う。既定では早送りできれば早送りし、できなければマージコミットを作る)。
// コンフリクトしたら(MERGE_HEAD が残り、未解決のファイルが 1 件以上)中止せず、途中の状態を
// 残し、例外ではなく conflict の結果で返す(作業ツリーが変わったため。renderer が例外のときは
// タブを再読込しないので、結果で返さないと古いタブが保存でマーカーを消す。パターン52)。
// 解決・完了・中止はコンフリクト解決 UI(gitConflictService)が担う。
// 未解決のファイルが無いのに MERGE_HEAD が残る場合(フックの失敗等)は従来どおり中止して元に戻す。
// 判定はエラー文ではなく MERGE_HEAD の有無で行う(パターン28): コンフリクトでは git が
// 終了コード 1・stderr 空で終わり simple-git が resolve するため、例外の有無も当てにならない。
// MERGE_HEAD が無いまま失敗した場合は git が何も変えていない(無関係な履歴の拒否、
// 上書きされる未追跡ファイル、コミッター情報なし等)ので、checkout と同じく git のエラーを
// そのまま投げる。ローカルの操作でネットワーク I/O を伴わないため、リモート用のタイムアウトは使わない
export async function mergeBranch(
  folderPath: string,
  branchName: string
): Promise<MergeBranchResult> {
  const git = simpleGit(folderPath)
  await assertMergeTargetBranch(git, branchName)
  await assertMergeStartable(git)
  let mergeError: unknown = null
  try {
    // branch.<現在のブランチ>.mergeoptions は CLI 引数より先に適用され、CLI 引数が優先される。
    // --commit --no-squash で固定する理由:
    // - --squash: コンフリクトしても MERGE_HEAD が作られず、下の中止の判定をすり抜けて
    //   コンフリクトマーカー入りのまま成功扱いになる(merge --abort でも戻せない)
    // - --no-commit: 分岐したマージは MERGE_HEAD が残り、毎回「完了できなかった」で止まる
    // --ff / -s / -X は固定しない: ユーザーの ff の方針(merge.ff / --ff-only / --no-ff)と
    // 戦略の設定を尊重する(--ff を付けると merge.ff=only 等まで上書きしてしまう)
    await git.raw(['merge', '--no-edit', '--commit', '--no-squash', branchName])
  } catch (err) {
    mergeError = err
  }
  if (await hasMergeInProgress(git)) {
    const conflicted = await listUnresolvedFiles(git)
    if (conflicted.length > 0) {
      return { status: 'conflict', message: buildMergeConflictMessage(conflicted) }
    }
    await abortFailedMerge(git, mergeError)
  }
  if (mergeError !== null) throw mergeError
  return { status: 'merged' }
}

export async function amendCommit(folderPath: string, message: string): Promise<void> {
  const git = simpleGit(folderPath)
  // マージ中の amend は git が英語('You are in the middle of a merge -- cannot amend.')で失敗する。
  // 日本語で拒否する(何も実行しない)
  if (await hasMergeInProgress(git)) {
    throw new Error('マージ中のためコミットを修正できません。マージを完了または中止してください')
  }
  // '--amend' は files ではなくオプション引数(第3)で渡す。simple-git の
  // commit(message, files, options) は ['commit', '-m', msg, ...files, ...options] を
  // 組み立てるため、files スロットに渡しても今は git がオプションを位置に関係なく
  // 解釈して動く。ただし simple-git が他タスクと同様に files の前へ '--' を挿入する
  // 実装に変われば `git commit -m msg -- --amend` となり、amend ではなく
  // 「--amend という名前のファイル」を対象にした新規コミットに静かに化ける。
  // options は Record<string, OptionsValues> 型のため、値なしフラグは null を渡す
  await git.commit(message, undefined, { '--amend': null })
}
