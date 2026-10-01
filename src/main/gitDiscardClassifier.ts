import type { SimpleGit } from 'simple-git'
import { parseNulSeparatedPaths, toLiteralPathspec } from './gitPathParsing'

// 取り消し対象の状態。状態ごとに取り消しの手段が異なる(applyDiscard 参照)
export type DiscardTargetKind =
  | 'conflicted'
  | 'untracked'
  | 'unknown'
  | 'intent-to-add'
  | 'overlaps-untracked'
  | 'tracked'

// 取り消しを実行できる状態(拒否する状態を除いたもの)
export type ApplicableDiscardKind = Exclude<
  DiscardTargetKind,
  'conflicted' | 'unknown' | 'overlaps-untracked'
>

export function isApplicableDiscardKind(kind: DiscardTargetKind): kind is ApplicableDiscardKind {
  return kind !== 'conflicted' && kind !== 'unknown' && kind !== 'overlaps-untracked'
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
export async function classifyDiscardTarget(
  git: SimpleGit,
  filePath: string
): Promise<DiscardTargetKind> {
  const pathspec = toLiteralPathspec(filePath)
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

// 拒否する状態(conflicted / unknown / overlaps-untracked)なら日本語のエラーを投げる。
// ファイル単位の取り消しとハンク単位の取り消しで共通の拒否。拒否する理由:
// - コンフリクト中は git restore が 'is unmerged' の英語エラーで失敗するため、
//   日本語で拒否する(解決 UI とセットで別対応)
// - 判定不能(追跡済みにも未追跡にも一致しない)は、ゴミ箱へ移す手段も restore も
//   誤った対象に働きうるため拒否する
// - 未追跡と重なる場合は、restore が未追跡(ignored を含む)のファイルを確認なしで消すため拒否する
export function assertDiscardable(
  kind: DiscardTargetKind,
  filePath: string
): asserts kind is ApplicableDiscardKind {
  switch (kind) {
    case 'conflicted':
      throw new Error(`コンフリクト中のファイルは取り消せません: ${filePath}`)
    case 'unknown':
      throw new Error(`状態を判定できないため取り消せません: ${filePath}`)
    case 'overlaps-untracked':
      throw new Error(`未追跡のファイルと重なるため取り消せません: ${filePath}`)
  }
}
