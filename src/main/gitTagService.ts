import simpleGit, { GitError } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import type { CreateTagRequest } from '@shared/types'
import { getTagNameCollision, getTagNameRuleViolation, normalizeTagName } from '@shared/tagName'
import type { TagNameCollision, TagNameCollisionKind } from '@shared/tagName'
import { getTagMessageRuleViolation } from '@shared/tagMessage'
import type { TagMessageRuleViolation } from '@shared/tagMessage'

// タグの作成(git tag)。付ける先は常に現在の HEAD。タグの責務はこのファイルにまとめ、gitService.ts には
// 足さない(パターン 55)。ref を 1 つ増やすだけで作業ツリー・index・HEAD を変えないため、
// マージ中・detached HEAD・rebase / bisect の途中でも許可する

export const COMMITTER_UNKNOWN_MESSAGE =
  'コミッター情報（user.name / user.email）が未設定のため、注釈付きタグを作成できません'

const MESSAGE_RULE_VIOLATION_MESSAGES: Record<TagMessageRuleViolation, string> = {
  empty: '注釈付きタグにはメッセージが必要です',
  nul: 'メッセージに使用できない文字が含まれています'
}

// 衝突の種類ごとの文言。判定の順序は renderer と同じ getTagNameCollision(@shared/tagName)に従う
const COLLISION_MESSAGES: Record<
  TagNameCollisionKind,
  (collision: TagNameCollision, name: string) => string
> = {
  duplicate: (_collision, name) => `同じ名前のタグが既に存在します: ${name}`,
  conflict: (collision, name) => `既存のタグ ${collision.with} と名前が衝突します: ${name}`,
  branch: (_collision, name) => `同じ名前のブランチが存在するため、タグを作成できません: ${name}`
}

const TAGS_NAMESPACE = 'refs/tags/'
const HEADS_NAMESPACE = 'refs/heads/'

function invalidTagNameError(name: string): Error {
  return new Error(`タグ名として使用できない名前です: ${name}`)
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message.trim() : String(err).trim()
}

function tagCreateFailureError(detail: string): Error {
  return new Error(
    detail === '' ? 'タグを作成できませんでした' : `タグを作成できませんでした: ${detail}`
  )
}

// 名前空間の配下の ref 名を、名前空間を除いて返す。完全な refname で列挙するため、短い名前の解決
// (タグとブランチの曖昧さ)の影響を受けない(パターン 43)。行末の \r は分割で落とす(パターン 27)。
// 一覧が取れないと衝突を判定できないため、英語の GitError を見せずに作成の失敗として投げる(パターン 74)
async function listRefNames(git: SimpleGit, namespace: string): Promise<string[]> {
  let output: string
  try {
    output = await git.raw(['for-each-ref', '--format=%(refname)', namespace])
  } catch (err) {
    throw tagCreateFailureError(errorDetail(err))
  }
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(namespace))
    .map((line) => line.slice(namespace.length))
}

// 1. アプリ独自の規則(@shared/tagName)。'-' 始まりは check-ref-format 自体にもオプションとして
//    解釈されるため、git に渡す前に弾く(パターン 21)
// 2. git 本体の規則は check-ref-format --normalize に委ねる。--normalize が無いと成功時も何も出力せず、
//    失敗時は終了コード 1・stderr 空で simple-git は空文字で resolve する。出力(trim)が入力の ref と
//    完全一致しなければ拒否することで、失敗と正規化(`a//b` → `a/b`)の両方を弾く(パターン 25)。
//    reject(git が起動できない等)も判定できないので拒否する(拒否側に倒す。パターン 74)
async function assertValidTagName(git: SimpleGit, name: string): Promise<void> {
  const violation = getTagNameRuleViolation(name)
  if (violation === 'leading-dash') {
    throw new Error(`\`-\` で始まるタグ名は使用できません: ${name}`)
  }
  if (violation !== null) throw invalidTagNameError(name)
  const ref = `${TAGS_NAMESPACE}${name}`
  let normalized: string
  try {
    normalized = (await git.raw(['check-ref-format', '--normalize', ref])).trim()
  } catch {
    throw invalidTagNameError(name)
  }
  if (normalized !== ref) throw invalidTagNameError(name)
}

// 3〜5. 同名のタグ・衝突するタグ(階層の衝突と大文字小文字だけの違い)・同名のブランチを、
// NFC にそろえて(衝突とブランチは大文字小文字も無視して)、git の英語のエラー
// (`already exists` / `cannot lock ref`)や、黙って作られる曖昧なタグ(パターン 43)より先に日本語で弾く。
// 判定の順序は renderer と共有する(@shared/tagName の getTagNameCollision)ため、一覧は先に両方取る
async function assertNoNameCollision(git: SimpleGit, name: string): Promise<void> {
  const tags = await listRefNames(git, TAGS_NAMESPACE)
  const branches = await listRefNames(git, HEADS_NAMESPACE)
  const collision = getTagNameCollision(name, tags, branches)
  if (collision !== null) throw new Error(COLLISION_MESSAGES[collision.kind](collision, name))
}

// 6. コミットが 1 つも無いリポジトリでは HEAD がコミットを指さない。rev-parse -q --verify は ref が
// 無いと終了コード 1・stderr 空で終わり、simple-git は空文字で resolve する。reject は本物の失敗なので
// 握りつぶさず投げる(パターン 74)
async function assertHeadIsCommit(git: SimpleGit): Promise<void> {
  const head = await git.raw(['rev-parse', '-q', '--verify', 'HEAD^{commit}'])
  if (head.trim() === '') throw new Error('コミットが無いため、タグを作成できません')
}

// 7. 注釈付きタグはタグオブジェクトにコミッター情報を書く。git var GIT_COMMITTER_IDENT は git tag -a と
// 同じ規則(user.name / user.email、user.useConfigOnly、自動推定)で解決し、解決できないと終了コード 128・
// stderr ありで失敗する(simple-git は GitError で reject。実機で確認)。英語の `Please tell me who you are`
// を見せる前に日本語で弾く。GitError 以外(git が起動できない等)は原因を取り違えないようそのまま投げる
async function assertAnnotatable(git: SimpleGit, message: string): Promise<void> {
  // メッセージの規則は renderer と同じ判定(@shared/tagMessage)を使う。文言は main 側のもの
  const violation = getTagMessageRuleViolation('annotated', message)
  if (violation !== null) throw new Error(MESSAGE_RULE_VIOLATION_MESSAGES[violation])
  try {
    await git.raw(['var', 'GIT_COMMITTER_IDENT'])
  } catch (err) {
    if (!(err instanceof GitError)) throw err
    throw new Error(COMMITTER_UNKNOWN_MESSAGE)
  }
}

// 作成してよいかを検証する。request は IPC 境界から届く任意の値(型だけ検証済み)のため、
// 次の順で検証し、前の検証に失敗したら後の git 呼び出しには進まない(設計書「main の検証と実行」)。
// request.name は入口(createTag)で normalizeTagName 済み
async function assertCreatableTag(git: SimpleGit, request: CreateTagRequest): Promise<void> {
  await assertValidTagName(git, request.name)
  await assertNoNameCollision(git, request.name)
  await assertHeadIsCommit(git)
  if (request.kind === 'annotated') await assertAnnotatable(git, request.message)
}

// 名前は `--` の後の位置引数、付ける先は HEAD と明示する。
// - 軽量: --no-sign。tag.gpgSign=true だと、付けない限り「署名付きの注釈付きタグ」に変わり、メッセージを
//   求めてエディタを起動して待つ(実機で確認)。軽量タグは署名できないため、軽量の意味を保つだけで、
//   注釈付きタグの署名の方針は上書きしない(パターン 45)
// - 注釈付き: --message=<message> の 1 引数。-m <message> の 2 引数だと simple-git の
//   blockUnsafeOperationsPlugin が `--upload-pack=...` 等の値をオプションとみなして拒否する(パターン 49)。
//   --message だけで注釈付きになるため -a(--annotate)は付けない。-a を明示すると tag.forceSignAnnotated=true
//   より優先され、署名なしのタグが黙って作られる(実機 git 2.50.1 で確認。パターン 45)。
//   --cleanup=whitespace は、既定の strip が `#` で始まる行を消すのを防ぐ(実機で確認)
function buildTagArgs(request: CreateTagRequest): string[] {
  if (request.kind === 'annotated') {
    return [
      'tag',
      '--cleanup=whitespace',
      `--message=${request.message}`,
      '--',
      request.name,
      'HEAD'
    ]
  }
  return ['tag', '--no-sign', '--', request.name, 'HEAD']
}

// 現在の HEAD にタグを作る。署名の失敗・他のプロセスとの競合などの git のエラーは、git のメッセージを
// 添えて返す(署名の設定は上書きしない)。終了コード 0 でもタグができたとは限らないため、
// 作成後に ref を確かめる(パターン 69)
export async function createTag(folderPath: string, rawRequest: CreateTagRequest): Promise<void> {
  // 名前は前後の空白を除き NFC にそろえる(@shared/tagName の normalizeTagName。renderer の送信値と同じ)。
  // 検証・衝突の判定・git tag・作成後の確認のすべてで、この名前を使う(NFD のまま渡すと、
  // check-ref-format を通り、既存の NFC のタグの解決を奪うか、作成後の確認で見つからない。実機で確認)
  const request: CreateTagRequest = { ...rawRequest, name: normalizeTagName(rawRequest.name) }
  const git = simpleGit(folderPath)
  await assertCreatableTag(git, request)
  try {
    await git.raw(buildTagArgs(request))
  } catch (err) {
    throw tagCreateFailureError(errorDetail(err))
  }
  // 確認の reject も成功扱いにせず、英語の GitError を見せずに作成の失敗として投げる(パターン 74)
  let created: string
  try {
    created = await git.raw(['rev-parse', '-q', '--verify', `${TAGS_NAMESPACE}${request.name}`])
  } catch (err) {
    throw tagCreateFailureError(errorDetail(err))
  }
  if (created.trim() === '') throw tagCreateFailureError('')
}
