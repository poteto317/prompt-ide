import { isSafeEntryName } from './entryName'
import { normalizeRemoteUrl } from './remoteUrl'

// clone の保存先のフォルダ名の規則。既定のフォルダ名の導出(deriveCloneFolderName)は renderer(CloneRepositoryDialog)だけが
// 使うが、URL の形式の網羅(@shared/remoteUrl のテスト)と揃えて規則を 1 か所で固定するため shared に置く(パターン 88)。
// 名前の検証(getCloneFolderNameViolation)は main(gitCloneService の入口)と renderer(ダイアログ)が同じ判定を使い、
// 文言は各側の表で持つ

// URL の形式(`<scheme>://`)。query・fragment を落とすのはこの形だけ(scp 形式・絶対パスの `?` `#` はパスの一部)
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//
// 末尾のリポジトリ名の区切り。git は `/` と `:` で切る(`https://h/a/b:c.git` は `c`。実機 git 2.50.1 で確認)。
// Windows のドライブの形(`C:\repos\x.git`)のために `\` も区切りにする
const SEGMENT_SEPARATOR_PATTERN = /[/\\:]/

// URL から既定のフォルダ名を決める(git clone が保存先を省略したときの名前の規則に揃える。実機 git 2.50.1 で確認)。
// 1. 前後の空白を除く(normalizeRemoteUrl。main の入口と同じ)
// 2. `<scheme>://` の形だけ、最初の `?` `#` から後ろを落とす(git は `b.git?x=1` をそのまま名前にするが、名前として
//    使いにくいため落とす。利用者は編集できる)
// 3. 末尾の `/` `\` を除き、続けて末尾の `/.git`、末尾の `.git`(1 回だけ。大文字小文字を区別する)を除く
// 4. 最後の `/` `\` `:` より後ろを名前にする(`%XX` は decode しない。git と同じ)
// 5. 名前として使えない(空・`.`・`..`・前後の空白)なら空文字(ホストだけの URL など。利用者が入力する)
export function deriveCloneFolderName(url: string): string {
  let rest = normalizeRemoteUrl(url)
  if (SCHEME_PATTERN.test(rest)) {
    const authorityStart = rest.indexOf('://') + 3
    const cut = rest.slice(authorityStart).search(/[?#]/)
    if (cut !== -1) rest = rest.slice(0, authorityStart + cut)
    // ホストだけ(`https://h`・`https://h/`)は名前が無い
    const pathStart = rest.indexOf('/', authorityStart)
    if (pathStart === -1) return ''
    rest = rest.slice(pathStart)
  }
  rest = rest.replace(/[/\\]+$/, '')
  if (rest.endsWith('/.git') || rest.endsWith('\\.git')) rest = rest.slice(0, -'/.git'.length)
  if (rest.endsWith('.git')) rest = rest.slice(0, -'.git'.length)
  const segments = rest.split(SEGMENT_SEPARATOR_PATTERN)
  const name = segments[segments.length - 1] ?? ''
  return isSafeEntryName(name) ? name : ''
}

export type CloneFolderNameViolation = 'empty' | 'invalid'

// 保存先のフォルダ名として使えるか。空(空白だけを含む) → 'empty'、パス区切り・`.`・`..`・前後の空白 → 'invalid'
// (新規作成・リネームと同じ @shared/entryName の規則)。保存先は親フォルダの直下に限るため、パス区切りを拒否する
export function getCloneFolderNameViolation(name: string): CloneFolderNameViolation | null {
  if (name.trim() === '') return 'empty'
  return isSafeEntryName(name) ? null : 'invalid'
}
