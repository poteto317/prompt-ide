import type { SimpleGit } from 'simple-git'
import type { GitStashEntry, StashPopResult } from '@shared/types'
import { findStashIndex, parseStashList } from './gitStashParser'
import { buildStashRestoreFailureMessage } from './gitStashMessages'
import { listUnresolvedFiles } from './gitMergeState'
import { assertRestorable, assertStashable } from './gitStashGuards'
import { createAppGit } from './gitInheritedEnv'

// stash(git stash)。stash の識別には番号(stash@{n})ではなく stash コミットの SHA を使う。番号は他の操作
// (別の stash の追加・削除、外部ターミナルの操作)でずれ、別の stash を指すようになるため

// 一覧は simple-git の stashList() ではなく stash list -z の出力を自分で解析する(パターン 44)。
// stash が無ければ何も出力されず、空配列になる
async function listStashes(git: SimpleGit): Promise<GitStashEntry[]> {
  const output = await git.raw(['stash', 'list', '-z', '--format=%H%x00%gs%x00%cI'])
  return parseStashList(output)
}

export async function getStashes(folderPath: string): Promise<GitStashEntry[]> {
  return listStashes(createAppGit(folderPath))
}

// 追跡済みの変更(ステージ済み・未ステージ)と未追跡ファイルを stash する(git stash push -u)。
// ignored のファイルは対象外で、そのまま残る(実機で確認)。
// メッセージは --message=<message> の 1 引数で渡す(パターン 21・41): simple-git の
// blockUnsafeOperationsPlugin は引数列の中の --upload-pack=... / --template=... / -c ... を
// 値であってもオプションとして検出して拒否するため、`-m <message>` の 2 引数だと、そのような
// メッセージの stash が英語のエラーで失敗する。1 引数にすれば '-' で始まる文字列も含め、
// 件名としてそのまま残る(実機で確認)。
// コミッター情報が無いときは git が作業ツリーを変えずに失敗する(実機で確認)ため、
// そのエラーをそのまま投げる
export async function stashPush(folderPath: string, message: string): Promise<void> {
  if (message.includes('\0')) throw new Error('メッセージに使用できない文字が含まれています')
  const git = createAppGit(folderPath)
  await assertStashable(git)
  const args =
    message.trim() === ''
      ? ['stash', 'push', '-u']
      : ['stash', 'push', '-u', `--message=${message}`]
  await git.raw(args)
}

const STASH_SHA_PATTERN = /^[0-9a-f]{40}$/

function stashNotFoundError(): Error {
  return new Error('stash が見つかりません（すでに削除された可能性があります）')
}

// sha が「形式として正しく」かつ「現在の stash 一覧にある」ことを確認し、一覧と位置を返す(許可リスト方式。パターン 21)。
// IPC 境界から届く任意の文字列のため、形式で弾いてから git に渡す。さらに、一覧にあることも確認する:
// git は、すでに drop した stash の SHA でもぶら下がったコミットが残っている間は stash apply で復元できてしまう
// (実機で確認)。確認しないと、捨てたはずの stash が復活し、その後の drop が見つけられなくなる
async function findExistingStash(
  git: SimpleGit,
  sha: string
): Promise<{ stashes: GitStashEntry[]; index: number }> {
  if (!STASH_SHA_PATTERN.test(sha)) throw stashNotFoundError()
  const stashes = await listStashes(git)
  const index = findStashIndex(stashes, sha)
  if (index === -1) throw stashNotFoundError()
  return { stashes, index }
}

// 未解決ファイル(コンフリクト)のパス。表示用の補足でしかないため、取得に失敗しても空配列にする。
// 巻き戻すと未解決の状態は取れなくなるので、巻き戻しより前に呼ぶ
async function readConflictedPaths(git: SimpleGit): Promise<string[]> {
  try {
    return await listUnresolvedFiles(git)
  } catch {
    return []
  }
}

// 作業ツリーを復元前のきれいな状態へ戻す。reset が失敗しても clean は試みる(片方だけでも作業ツリーを
// 戻せる)。最初のエラーを返し、失敗が無ければ undefined。
// 事前の確認(status --ignore-submodules=all)はサブモジュール内の変更を見ないため、ユーザー設定の
// submodule.recurse=true だと reset --hard がサブモジュールの中まで戻して、そのローカル変更を消す
// (実機で確認)。引数 --no-recurse-submodules で固定する。clean -fd はこの設定でも中身を消さない
async function rollbackToCleanTree(git: SimpleGit): Promise<unknown> {
  let firstError: unknown
  for (const args of [
    ['reset', '--hard', '--no-recurse-submodules'],
    ['clean', '-fd']
  ]) {
    try {
      await git.raw(args)
    } catch (error) {
      firstError ??= error
    }
  }
  return firstError
}

// 復元に失敗したとき、作業ツリーを復元前の状態へ戻す。呼び出し前に作業ツリーが完全にきれい
// (未コミットの変更も未追跡ファイルも無い)ことが保証されている前提で、失うものは無い:
// reset --hard が追跡済みの変更と index を、clean -fd が復元された未追跡ファイルを消す。
// clean -fd は ignored のファイルに触れない。
// 失敗の検出は例外で足りる: コンフリクトでも、同名の ignored ファイルとの衝突でも、パスが追跡済みの
// ファイルに変わっていても、simple-git は reject する(実機で確認。マージのコンフリクトが
// stderr 空で resolve されたのとは違う)
// 巻き戻しにも失敗したことを表す。作業ツリーが変わり得るため、stashPop が結果(rollbackFailed)に
// 変換する(ほかのエラーは変換せずそのまま投げる)
class RollbackFailedError extends Error {
  constructor(options: { cause: unknown }) {
    super(ROLLBACK_FAILED_MESSAGE, options)
    this.name = 'RollbackFailedError'
  }
}

const ROLLBACK_FAILED_MESSAGE =
  'stash の変更を作業ツリーへ戻せず、戻す前の状態への復旧にも失敗しました。作業ツリーに途中の変更が残っている可能性があります。stash は残っています'
const DROP_FAILED_MESSAGE =
  'stash の変更は作業ツリーへ戻しましたが、この stash を一覧から削除できませんでした。不要なら「捨てる」で削除してください'

async function applyOrRollback(git: SimpleGit, sha: string): Promise<void> {
  try {
    await git.raw(['stash', 'apply', '--index', sha])
  } catch (applyError) {
    const conflicted = await readConflictedPaths(git)
    const rollbackError = await rollbackToCleanTree(git)
    // 巻き戻しにも失敗したら、英語の git のエラーではなく、途中の変更が残っているおそれを日本語で
    // 伝える(stashPop が rollbackFailed の結果に変換する)
    if (rollbackError !== undefined) throw new RollbackFailedError({ cause: rollbackError })
    throw new Error(buildStashRestoreFailureMessage(conflicted), { cause: applyError })
  }
}

// 一覧から sha の現在の位置を引き直して drop し、git が出力する `Dropped stash@{n} (<sha>)` の
// <sha> が要求した sha と一致することを確認する。検索と削除の間に stash が増減すると、同じ番号が
// 別の stash を指すため、一致しなければ誤って消した stash を stash store で一覧に戻す。
// 出力から SHA を取れなかったとき(書式が想定外)は、確認できないので成功として扱う
async function dropStashBySha(git: SimpleGit, sha: string): Promise<void> {
  const { stashes, index } = await findExistingStash(git, sha)
  const output = await git.raw(['stash', 'drop', `stash@{${index}}`])
  const dropped = /\(([0-9a-f]{40})\)/.exec(output)?.[1]
  if (dropped !== undefined && dropped !== sha) {
    const message = stashes.find((entry) => entry.sha === dropped)?.message ?? ''
    await git.raw(['stash', 'store', `--message=${message}`, dropped])
    throw new Error('stash の状態が変わったため削除を取り消しました。もう一度操作してください')
  }
}

// stash を戻して、一覧から消す(git stash pop 相当)。作業ツリーが完全にきれいなときだけ実行する:
// 失敗時の巻き戻し(applyOrRollback)が未コミットの変更・未追跡ファイルを消すため。
// --index で、ステージ済みと未ステージの区別まで stash した時点に戻す(付けないとステージ済みだった
// 変更が未ステージになる。実機で確認)。
// 作業ツリーが変わっていないとき(事前検証の失敗、巻き戻しに成功した apply の失敗)は例外を投げる。
// 作業ツリーが変わったうえで警告が要るとき(apply 成功後の drop の失敗、巻き戻しの失敗)は、例外ではなく
// 結果で返す: renderer は例外のときタブを再読込しないが、これらは変更後のディスクを古いタブが
// 上書きしないよう再読込が要るため
export async function stashPop(folderPath: string, sha: string): Promise<StashPopResult> {
  const git = createAppGit(folderPath)
  await findExistingStash(git, sha)
  // 作業ツリーが完全にきれいか(stashPush の assertStashable と同じ status 判定 + 途中の操作と
  // assume-unchanged の確認)
  await assertRestorable(git)
  try {
    await applyOrRollback(git, sha)
  } catch (error) {
    if (error instanceof RollbackFailedError) {
      return { status: 'rollbackFailed', message: ROLLBACK_FAILED_MESSAGE }
    }
    throw error
  }
  // 復元は済んでいるため、ここでの失敗(SHA 不一致での再保存、別プロセスが先に drop、git の失敗)を
  // そのまま見せると、失敗と誤解して二重に適用されうる。復元済みであることを伝える
  try {
    await dropStashBySha(git, sha)
  } catch {
    return { status: 'dropFailed', message: DROP_FAILED_MESSAGE }
  }
  return { status: 'restored' }
}

export async function stashDrop(folderPath: string, sha: string): Promise<void> {
  await dropStashBySha(createAppGit(folderPath), sha)
}
