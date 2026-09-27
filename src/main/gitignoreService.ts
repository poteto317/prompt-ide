import { join } from 'path'
import { readFileBuffer, writeFileContent } from './fileSystem'
import { decodeUtf8OrNull } from './gitDiffFormatter'
import { isMissingPathError } from './fsErrors'

// フォルダごとに直列化するためのキュー。read-then-write の間に排他制御が無いと、
// 同じフォルダへの2つの呼び出しがほぼ同時に来た場合、両方が同じ(古い)内容を
// 読み込み、後勝ちの書き込みが先の追記を消してしまう
const pendingWrites = new Map<string, Promise<void>>()

// gitignore のパターン構文で特別な意味を持つ文字(*, ?, [, ], \)をエスケープし、
// 単なるファイル名として書き込む。エスケープしないと、例えば
// "component[Test].tsx" が「component + T/e/s/t のいずれか1文字 + .tsx」という
// 文字クラス(bracket expression)として解釈され、意図したファイルが無視されなかったり、
// 無関係な似た名前のファイルまで無視されたりする。
// 行頭の '#'(コメント)・'!'(否定)も、その位置だけ特別な意味を持つため合わせてエスケープする。
// 末尾の空白(エスケープされていないもの)は git の .gitignore パーサー自体が
// トリムするため、末尾に空白を含むファイル名(POSIX では有効)がマッチしなく
// なるのを防ぐため、末尾の空白もエスケープする。
function escapeGitignorePattern(pattern: string): string {
  // '\' 自体を最初にエスケープしないと、後続の置換で追加した '\' がさらに
  // エスケープ対象になってしまう
  const escaped = pattern
    .replace(/\\/g, '\\\\')
    .replace(/([*?[\]])/g, '\\$1')
    .replace(/ +$/, (spaces) => spaces.replace(/ /g, '\\ '))
  return /^[#!]/.test(escaped) ? `\\${escaped}` : escaped
}

// .gitignore はテキストファイルとしての読み書きのみで、simple-git 経由の git コマンドを
// 一切使わない。git 呼び出しをラップする gitService.ts とは責務が異なるため分離している。
export function addToGitignore(folderPath: string, relativePath: string): Promise<void> {
  const previous = pendingWrites.get(folderPath) ?? Promise.resolve()
  // 前回の呼び出しが失敗していても、それが今回の待機をブロックしないようにする
  const current = previous.catch(() => {}).then(() => doAddToGitignore(folderPath, relativePath))
  pendingWrites.set(folderPath, current)
  // 完了後、pendingWrites がまだこの呼び出しの Promise(current)を指している
  // 場合のみエントリを削除する。削除しないと、多数のフォルダを開いて
  // .gitignore に追加するたびにエントリが無限に増え続け、プロセスの寿命が
  // 尽きるまで解放されないメモリリークになる。「まだ自分自身を指しているか」を
  // 確認するのは、current が完了する前に同じフォルダへの次の呼び出しが来て、
  // 既に新しい Promise に置き換わっている場合、それを誤って削除しないため。
  // 呼び出し元が await した時点で確実に削除済みにするため、クリーンアップを
  // 挟んだ新しい Promise(.finally は結果をそのまま透過する)を返す
  return current.finally(() => {
    if (pendingWrites.get(folderPath) === current) {
      pendingWrites.delete(folderPath)
    }
  })
}

// テスト専用: 直列化キューのサイズ(メモリリーク検出用)。本番コードからは使わない
export function _getPendingWritesSizeForTest(): number {
  return pendingWrites.size
}

async function doAddToGitignore(folderPath: string, relativePath: string): Promise<void> {
  // 改行を含むパスは拒否する。POSIX では改行もファイル名に使えるが、
  // .gitignore は 1 行 1 パターンの形式なので書き込むと 2 行に割れ、2 行目は
  // アンカー(先頭の /)が無いためリポジトリ全階層の同名ファイルを無視してしまう
  // (書いた本人には理由が分からないまま無関係なファイルが消える)。
  // git 自身もそのようなパスを .gitignore で無視する手段を持たない
  if (/[\r\n]/.test(relativePath)) {
    throw new Error(`改行を含むパスは .gitignore に追加できません: ${JSON.stringify(relativePath)}`)
  }
  const gitignorePath = join(folderPath, '.gitignore')
  const escaped = escapeGitignorePattern(relativePath)
  // git はスラッシュを含まないパターンを全階層でマッチさせる。"notes.txt" と
  // 書くと、ユーザーが選んだルート直下の 1 ファイルだけでなく sub/notes.txt や
  // sub/deep/notes.txt まで無視されてしまう。VS Code と同じく先頭に "/" を付けて
  // リポジトリルートからのパスとしてアンカーし、選択したものだけを無視する
  const pattern = `/${escaped}`
  let existingContent = ''
  try {
    const buffer = await readFileBuffer(gitignorePath)
    // fs.readFile(path, 'utf-8') は不正なバイト列があってもエラーを投げず、
    // 静かに U+FFFD(置換文字)へ変換してしまう(Node.js の仕様)。この文字列を
    // そのまま書き戻すと、Shift_JIS 等 UTF-8 以外で書かれた .gitignore の
    // 既存内容(日本語コメント等)が読み込んだ瞬間に永続的に文字化けする。
    // gitDiffFormatter.ts の decodeUtf8OrNull(fatal decode)と同じ方式で
    // 検証し、デコードできない場合は書き込まずエラーにする
    const decoded = decodeUtf8OrNull(buffer)
    if (decoded === null) {
      throw new Error(
        `.gitignore の文字コードが UTF-8 として読み取れません。手動で確認してください: ${gitignorePath}`
      )
    }
    existingContent = decoded
  } catch (err) {
    if (!isMissingPathError(err)) throw err
  }
  // escaped は escapeGitignorePattern により末尾の空白がエスケープ済み
  // ("notes.txt\ " のようにバックスラッシュ+スペースで終わる)ことがあるため、
  // .trim() で既存行を比較すると、バックスラッシュの後ろのスペースまで
  // 削り取られてしまい、書き込み済みの行と一致しなくなる(重複追記の原因になる)。
  // Windows の CRLF(\r\n)だけを吸収したいので、行末の \r のみを取り除く
  const existingLines = existingContent.split('\n').map((line) => line.replace(/\r$/, ''))
  // 手書きの .gitignore にはアンカー無しの形("dist/")で書かれていることが多い。
  // 文字列が一致しないからと追記すると、意味的に同じ行が 2 行並んでしまうため、
  // アンカーの有無だけが違う行も重複と見なす。
  // さらに、glob 特殊文字([]等)を含むファイル名をエスケープせずに手書きしている
  // ケースもあるため、エスケープ前の生の relativePath(アンカー有無の両方)も
  // 重複チェックに含める。escaped/pattern だけを見ていると、この生の行を
  // 「既に無視されている」と認識できず、同じファイルに対して意味は同じだが
  // 文字列としては別の行を重複して追記してしまう。
  // ただし relativePath の先頭が '#'(コメント)・'!'(否定)の場合は例外にする。
  // これらは行頭に来ると gitignore の構文上まったく別の意味になるため、既存の
  // 「!important.txt」(無関係な否定パターン)のような行と生の relativePath が
  // たまたま文字列一致しても、それは「このファイルは既に無視されている」ことを
  // 意味しない。それを重複と誤認すると、実際にはエスケープ済みパターンが
  // 一度も書き込まれておらず、ファイルが無視されないまま addToGitignore が
  // 「成功」を返してしまう
  const rawFormChangesGitignoreSemantics = /^[#!]/.test(relativePath)
  if (
    existingLines.includes(pattern) ||
    existingLines.includes(escaped) ||
    (!rawFormChangesGitignoreSemantics &&
      (existingLines.includes(relativePath) || existingLines.includes(`/${relativePath}`)))
  ) {
    return
  }
  // 重複判定(existingLines)は行末の \r を吸収して比較しているため CRLF でも
  // 正しく動くが、追記する行の改行コードは既存ファイルに合わせる必要がある。
  // \n 決め打ちのままだと、Windows で作成された CRLF の .gitignore に追記した
  // 場合、既存行は \r\n のまま新規行だけ \n で終わる混在ファイルになる
  const lineEnding = existingContent.includes('\r\n') ? '\r\n' : '\n'
  // needsNewline の判定には常に素の '\n' への endsWith を使う。CRLF も '\n' で
  // 終わるため、これだけで「既に改行済みか」を lineEnding の種類に関わらず
  // 正しく判定できる。lineEnding への endsWith にすると、CRLF の行を含みつつ
  // 末尾は素の '\n' で終わっている(既に改行済みの)混在改行ファイルを
  // 「改行が無い」と誤判定し、不要な空行を挿入してしまう
  const needsNewline = existingContent.length > 0 && !existingContent.endsWith('\n')
  const newContent = existingContent + (needsNewline ? lineEnding : '') + pattern + lineEnding
  await writeFileContent(gitignorePath, newContent)
}
