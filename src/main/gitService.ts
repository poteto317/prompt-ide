import { join } from 'path'
import simpleGit, { GitError, GitPluginError } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import type { GitStatusResult, GitLogEntry, GitBranch } from '@shared/types'
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
import { readFileBuffer, isExecutableFile, isSymbolicLink, getFileSize } from './fileSystem'
import { convertFsAccessError } from './fsErrorConverter'

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
