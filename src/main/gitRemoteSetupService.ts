import { GitConstructError } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { getBranchNameRuleViolation, normalizeInitialBranchName } from '@shared/branchName'
import { getRemoteUrlRuleViolation, normalizeRemoteUrl } from '@shared/remoteUrl'
import { GIT_REMOTE_TIMEOUT_MS } from '@shared/remoteTimeout'
import { assertValidNewBranchName } from './gitBranchNameGuard'
import { getCurrentBranchRef } from './gitHeadState'
import { isInsideGitDirectory } from './gitRepoDetection'
import { ORIGIN_REMOTE, hasOriginRemote } from './gitRemoteNames'
import { REMOTE_URL_RULE_MESSAGES } from './gitRemoteUrlMessages'
import { REMOTE_OPERATION_TIMEOUT_MESSAGE, simpleGitWithRemoteTimeout } from './gitRemoteTimeout'
import { failure, redactCredentials, runGitStep, toStepError } from './gitStepErrors'
import { createAppGit } from './gitInheritedEnv'

// リモートの管理(新規リポジトリの init・origin の追加・初回 push)。責務はこのファイルにまとめ、
// gitService.ts には足さない(パターン 55)。どの操作も、前の検証に失敗したら後の git 呼び出しには進まない

// init と remote add は通信も対話もしないが、実行中のダイアログは閉じられない設計(パターン 85)のため、
// 最長の待ち時間を保証する(パターン 84)。テストでは第 3 引数で短くする
export const REMOTE_SETUP_LOCAL_TIMEOUT_MS = 30_000

export const ALREADY_REPOSITORY_MESSAGE =
  'このフォルダは既に Git リポジトリ（または親フォルダのリポジトリ）の中にあります'
export const INIT_TIMEOUT_MESSAGE = 'リポジトリの初期化が時間内に終わりませんでした'
export const NOT_REPOSITORY_MESSAGE = 'Git リポジトリではありません'
export const ORIGIN_EXISTS_MESSAGE = 'リモート origin は既に設定されています'
export const ADD_ORIGIN_TIMEOUT_MESSAGE = 'リモートの追加が時間内に終わりませんでした'
export const NO_ORIGIN_FOR_PUSH_MESSAGE = 'リモート origin が未設定のため、初回 push できません'
export const NOT_ON_BRANCH_FOR_PUSH_MESSAGE =
  'ブランチ上にいないため（detached HEAD・リベース中など）、初回 push できません'
export const NO_COMMIT_FOR_PUSH_MESSAGE =
  'コミットが無いため、初回 push できません。先にコミットしてください'
export const UPSTREAM_CONFIG_EXISTS_MESSAGE =
  'upstream の設定が既にあるため、初回 push できません（設定先のリモートが無いか、fetch の設定が無いため表示されていません）'
export const FOLDER_NOT_FOUND_MESSAGE = 'フォルダが見つかりません'
export const UPSTREAM_NOT_CONFIRMED_MESSAGE =
  'push は完了しましたが、upstream を設定できませんでした'

const INIT_FAILURE = 'リポジトリを初期化できませんでした'
const ADD_ORIGIN_FAILURE = 'リモートを追加できませんでした'
const SET_UPSTREAM_FAILURE = '初回 push に失敗しました'
const HEADS_NAMESPACE = 'refs/heads/'

// simple-git を作る。フォルダが存在しない(開いた後に削除・移動された)と、createAppGit() は git を呼ぶ前に
// 英語の GitConstructError を投げる(生成の時点で同期的に投げるため、runGitStep の外で漏れる)。
// フォルダが見つからない旨の日本語にする(パターン 74)。GitConstructError を投げるのはこの確認だけ(simple-git 3.36.0)
function openGit(
  folderPath: string,
  create: () => SimpleGit,
  toError: (err: unknown) => Error
): SimpleGit {
  try {
    return create()
  } catch (err) {
    if (err instanceof GitConstructError) throw failure(FOLDER_NOT_FOUND_MESSAGE, folderPath)
    throw toError(err)
  }
}

// 空のリポジトリを作る(初期コミットや .gitignore は作らない)。branch は IPC 境界から届く任意の文字列。
// git init は、名前の検証で失敗しても HEAD の無い .git を残し、既存のリポジトリでは終了コード 0 で再初期化する
// (--initial-branch は無視される。実機 git 2.50.1 で確認)。そのため名前の検証と「既にリポジトリか」の判定を
// git init の前に行う。--initial-branch を指定すれば利用者の init.defaultBranch は使われない(入力した名前を優先する)。
// init.templateDir などのテンプレートは上書きしない(フックはコピーされるが init のときには実行されない。パターン 45・81)
export async function initRepository(
  folderPath: string,
  rawBranch: string,
  timeoutMs: number = REMOTE_SETUP_LOCAL_TIMEOUT_MS
): Promise<void> {
  // 入口で 1 回だけ正規化し、以後の検証・git init・作成の確認・エラーの文言はこの名前を使う(パターン 83)
  const branch = normalizeInitialBranchName(rawBranch)
  const toInitError = (err: unknown): Error => toStepError(err, INIT_TIMEOUT_MESSAGE, INIT_FAILURE)
  const git = openGit(
    folderPath,
    () => createAppGit(folderPath, { timeout: { block: timeoutMs } }),
    toInitError
  )
  // 1・2. アプリ独自の規則と git の check-ref-format --branch(ブランチの作成と同じ。HEAD・-x・@・a..b を拒否する)
  try {
    await assertValidNewBranchName(git, branch)
  } catch (err) {
    // 壊れた .git ファイル(存在しない gitdir を指す)があると、check-ref-format --branch はリポジトリを探す途中で
    // `fatal: not a git repository` になり、どの名前でも失敗する(実機で確認。差分 1)。名前の誤りと見せないよう、
    // アプリ独自の規則を通った名前のときだけ、名前と関係の無い main で git がこのフォルダで動くかを確かめる
    if (getBranchNameRuleViolation(branch) === null) {
      await runGitStep(() => git.raw(['check-ref-format', '--branch', 'main']), toInitError)
    }
    throw err
  }
  // 3. 親フォルダのリポジトリも含めて判定する(gitignore されたサブフォルダでも親を拾う。実機で確認)。
  //    壊れた .git ファイル・HEAD の無い .git(失敗した init の残骸)は false になる(差分 1)。
  //    bare リポジトリと .git ディレクトリの中も false になるため、rev-parse --git-dir でも確かめる(差分 15。そこで git init
  //    すると成功して中に .git を作ってしまう。実機で確認)
  if (
    (await runGitStep(() => git.checkIsRepo(), toInitError)) ||
    (await runGitStep(() => isInsideGitDirectory(git), toInitError))
  ) {
    throw new Error(ALREADY_REPOSITORY_MESSAGE)
  }
  // 4. 値を 1 つの引数にする(パターン 49)
  await runGitStep(() => git.raw(['init', `--initial-branch=${branch}`]), toInitError)
  // 5. 終了コード 0 は効果があったことを意味しない(パターン 69)
  const head = await runGitStep(() => getCurrentBranchRef(git), toInitError)
  if (head !== `${HEADS_NAMESPACE}${branch}`) throw failure(INIT_FAILURE, '')
}

// リモート origin を追加する(この時点では通信しない。-f を付けない)。url は IPC 境界から届く任意の文字列。
// 許可リスト(@shared/remoteUrl)が唯一の防御: simple-git は `git remote add -- origin <url>` で ext::・fd::・
// --upload-pack=... も止めない(実機で確認)。url.<base>.insteadOf などの書き換えは利用者の設定として尊重し、
// 検証は入力した URL に対して行う(既知の制約)。windowsPaths はテスト用(既定は実行中の OS)
export async function addOrigin(
  folderPath: string,
  rawUrl: string,
  timeoutMs: number = REMOTE_SETUP_LOCAL_TIMEOUT_MS,
  windowsPaths: boolean = process.platform === 'win32'
): Promise<void> {
  // 前後の空白だけを除く(NFC にはそろえない。URL の中の文字を変えるとサーバー側で別のパスになる)
  const url = normalizeRemoteUrl(rawUrl)
  const violation = getRemoteUrlRuleViolation(url, { windowsPaths })
  if (violation !== null) throw new Error(REMOTE_URL_RULE_MESSAGES[violation])
  // remote add は config.lock が残っていると URL をそのまま出して失敗する(実機で確認)。検証はパスワード入りの URL を
  // 拒否するが、scp 形式・ssh:// の user は残る。文言は IPC で画面まで届くため、詳細の userinfo を伏せる(防御の 2 層)
  const toAddError = (err: unknown): Error =>
    toStepError(err, ADD_ORIGIN_TIMEOUT_MESSAGE, ADD_ORIGIN_FAILURE, redactCredentials)
  const git = openGit(
    folderPath,
    () => createAppGit(folderPath, { timeout: { block: timeoutMs } }),
    toAddError
  )
  if (!(await runGitStep(() => git.checkIsRepo(), toAddError))) {
    throw new Error(NOT_REPOSITORY_MESSAGE)
  }
  // git remote add は already exists の英語で失敗する。先に日本語で弾く(バナーの hasOrigin と同じ判定)
  if (await runGitStep(() => hasOriginRemote(git), toAddError)) {
    throw new Error(ORIGIN_EXISTS_MESSAGE)
  }
  // URL は `--` の後に置く(パターン 21)
  await runGitStep(() => git.raw(['remote', 'add', '--', ORIGIN_REMOTE, url]), toAddError)
  // 終了コード 0 は効果があったことを意味しない(パターン 69)
  const actual = await runGitStep(
    () => git.raw(['config', '--get', `remote.${ORIGIN_REMOTE}.url`]),
    toAddError
  )
  if (actual.trim() !== url) throw failure(ADD_ORIGIN_FAILURE, '')
}

// upstream の無い現在のブランチを origin へ送り、upstream を設定する(git push --set-upstream)。
// 既存の push と同じ打ち切り(GIT_REMOTE_TIMEOUT_MS・progress あり)を使い、事前検証の git 呼び出しも同じ simple-git で行う。
// 引数は IPC 境界から受け取らない(対象は常に現在のブランチ)。timeoutMs はテスト用
export async function pushSetUpstream(
  folderPath: string,
  timeoutMs: number = GIT_REMOTE_TIMEOUT_MS
): Promise<void> {
  // ssh:// と scp 形式の push の失敗では、ssh 自身が `u:pw@github.com: Permission denied (publickey).` のように
  // 接続先を資格情報ごと出し、git はそのまま流す(https・http は git が取り除く。実機 git 2.50.1 で確認)。
  // 文言は IPC で画面まで届くため、addOrigin と同じく詳細の資格情報を伏せる
  const toPushError = (err: unknown): Error =>
    toStepError(err, REMOTE_OPERATION_TIMEOUT_MESSAGE, SET_UPSTREAM_FAILURE, redactCredentials)
  const git = openGit(
    folderPath,
    () => simpleGitWithRemoteTimeout(folderPath, timeoutMs),
    toPushError
  )
  // 1. リポジトリ
  if (!(await runGitStep(() => git.checkIsRepo(), toPushError))) {
    throw new Error(NOT_REPOSITORY_MESSAGE)
  }
  // 2. origin(バナーの hasOrigin と同じ判定)
  if (!(await runGitStep(() => hasOriginRemote(git), toPushError))) {
    throw new Error(NO_ORIGIN_FOR_PUSH_MESSAGE)
  }
  // 3. 現在のブランチ(detached・リベース中・bisect 中は null。マージの isOnBranch と同じ判定)
  const ref = await runGitStep(() => getCurrentBranchRef(git), toPushError)
  if (ref === null) throw new Error(NOT_ON_BRANCH_FOR_PUSH_MESSAGE)
  // 4. コミット(git に任せると `src refspec main does not match any` の英語になる)
  const head = await runGitStep(() => git.raw(['rev-parse', '-q', '--verify', 'HEAD']), toPushError)
  if (head.trim() === '') throw new Error(NO_COMMIT_FOR_PUSH_MESSAGE)
  // 5. upstream が既にあれば上書きしない(-u は既存の branch.<b>.remote / merge を黙って上書きする。パターン 45)。
  //    判定はバナーの status.tracking と同じく ref の解決で行う(パターン 59)。出力は短い名前(origin/main)
  const upstream = (
    await runGitStep(
      () => git.raw(['for-each-ref', '--format=%(upstream:short)', ref]),
      toPushError
    )
  ).trim()
  if (upstream !== '') throw new Error(`upstream は既に設定されています: ${upstream}`)
  //    %(upstream:short) は、削除済みの remote や fetch の refspec の無い remote を指す upstream を空にする
  //    (実機で確認)。その branch.<b>.remote / merge も上書きしないよう、設定そのものも確かめる(差分 16)。
  //    ブランチ名の . や / はキーのサブセクションにそのまま入る(実機で確認)
  const branch = ref.slice(HEADS_NAMESPACE.length)
  const readBranchConfig = async (key: 'remote' | 'merge'): Promise<string> =>
    (
      await runGitStep(() => git.raw(['config', '--get', `branch.${branch}.${key}`]), toPushError)
    ).trim()
  if ((await readBranchConfig('remote')) !== '' || (await readBranchConfig('merge')) !== '') {
    throw new Error(UPSTREAM_CONFIG_EXISTS_MESSAGE)
  }
  // 6. 完全な refspec で送る: (a) 同名のタグがあると短い名前は `matches more than one` で失敗する(パターン 43)、
  //    (b) refs/ で始まるので - で始まるブランチ名もオプションにならない(パターン 21)、(c) `--` は使えない
  //    (progress プラグインが末尾に足す --progress が refspec になる)。明示した refspec のため push.default・
  //    push.autoSetupRemote・remote.origin.push に影響されない(いずれも実機で確認)。pre-push フックは実行する
  await runGitStep(
    () => git.raw(['push', '--set-upstream', ORIGIN_REMOTE, `${ref}:${ref}`]),
    toPushError
  )
  // 7. 設定の確認(パターン 69)。for-each-ref %(upstream) で確かめないのは、fetch の refspec の無い origin では
  //    branch.<b>.remote / merge が設定されても空のままになるため(既知の制約)
  const remote = await readBranchConfig('remote')
  const merge = await readBranchConfig('merge')
  if (remote !== ORIGIN_REMOTE || merge !== ref) {
    throw new Error(UPSTREAM_NOT_CONFIRMED_MESSAGE)
  }
}
