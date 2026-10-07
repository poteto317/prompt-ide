import type { SimpleGit } from 'simple-git'

// check-attr -z の出力(path NUL 属性名 NUL 値 NUL)から、filter が付いているか(`unspecified`・`unset` 以外)を判定する。
// 形の違う出力は付いているとみなす(データを失わない側に倒す)
export function isFilterSetInCheckAttrOutput(output: string): boolean {
  const [, name, value] = output.split('\0')
  if (name !== 'filter' || value === undefined) return true
  return value !== 'unspecified' && value !== 'unset'
}

// .gitattributes の filter 属性が、記録の時点か今の作業ツリーのどちらかで付いているか。git は記録のインデックスで
// 問い合わせる git(GIT_INDEX_FILE が記録を指す)を渡す。
// - 記録の時点の属性: 記録の `git add -A` が clean filter を通したかを決める。記録のインデックスの .gitattributes を
//   `--cached` で読む(既定の check-attr は作業ツリーの .gitattributes を読み、記録の後の編集で filter の行が消えると
//   すり抜ける。コードレビュー ループ 2 の I1)。$GIT_DIR/info/attributes は --cached でも読まれる
// - 今の作業ツリーの属性: restore の smudge は今の属性で動くため、記録の後に付いた filter も拒否する(保守的)
// check-attr はパス名を pathspec ではなくリテラルとして読むため、`--` の後ろにそのまま渡す(gitConflictService と同じ)。
// どちらかの問い合わせに失敗したら付いているとみなす
export async function hasFilterAttribute(git: SimpleGit, filePath: string): Promise<boolean> {
  try {
    const outputs = await Promise.all([
      git.raw(['check-attr', '--cached', '-z', 'filter', '--', filePath]),
      git.raw(['check-attr', '-z', 'filter', '--', filePath])
    ])
    return outputs.some(isFilterSetInCheckAttrOutput)
  } catch {
    return true
  }
}
