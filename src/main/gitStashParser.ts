import type { GitStashEntry } from '@shared/types'

// git stash list -z --format=%H%x00%gs%x00%cI の 1 件は「SHA・件名・日時」の 3 フィールドで、
// 出力はそれらを NUL でつないだ列になる(件名に改行があれば git が空白に置き換える。実機で確認)。
// simple-git の stashList() の解析には頼らない: 解析が git の出力の特殊な場合を覆うか
// 確かめられないため、安全性に関わる識別子(SHA)は自分で解析する(パターン 44)
const FIELDS_PER_ENTRY = 3

// 件名は次の 2 形式(実機で確認):
// - git stash push -m "msg" → "On <branch>: msg"
// - メッセージ無し → "WIP on <branch>: <短縮ハッシュ> <最後のコミットの件名>"
// ブランチ名に ': ' は含まれないため、最初の ': ' までをブランチ名とする。
// detached HEAD では <branch> が "(no branch)" になる
const SUBJECT_PATTERNS = [/^On (.+?): (.*)$/s, /^WIP on (.+?): (?:[0-9a-f]{7,40} )?(.*)$/s]

export function parseStashSubject(subject: string): { message: string; branch: string } {
  for (const pattern of SUBJECT_PATTERNS) {
    const match = pattern.exec(subject)
    if (match !== null) return { branch: match[1], message: match[2] }
  }
  return { branch: '', message: subject }
}

export function parseStashList(output: string): GitStashEntry[] {
  const fields = output.split('\0')
  // 各レコードの後ろにも NUL が付くため、末尾に空要素ができる
  if (fields[fields.length - 1] === '') fields.pop()
  const entries: GitStashEntry[] = []
  for (let i = 0; i + FIELDS_PER_ENTRY <= fields.length; i += FIELDS_PER_ENTRY) {
    const [sha, subject, createdAt] = fields.slice(i, i + FIELDS_PER_ENTRY)
    const { message, branch } = parseStashSubject(subject)
    entries.push({ sha, message, branch, createdAt })
  }
  return entries
}

// stash の番号(stash@{n})は、他の stash の追加・削除でずれる。実行時に SHA から引き直すための位置の検索
export function findStashIndex(entries: GitStashEntry[], sha: string): number {
  return entries.findIndex((entry) => entry.sha === sha)
}
