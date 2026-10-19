// diff の出力をパッチとして使える形に固定する引数。gitService.getDiff(ソース管理の diff)と agentChangeDiff
// (エージェントの変更の diff)が共有する(同じ規則の写しを作らない。パターン 88)。
// 利用者の gitconfig がそのまま効くため、パッチの形式を左右する設定を明示的にすべて打ち消す。いずれも実機で再現確認済み:
// - diff.noprefix=true: 出力に a/ b/ が付かず、gitApply の `git apply`(既定は -p1 = 先頭 1 階層を剥がす)が
//   "git diff header lacks filename information" で全ハンクのステージ/アンステージに失敗する
// - diff.external: パッチとして適用できない出力になる(--no-ext-diff)
// - textconv(.gitattributes の diff=<driver> + diff.<driver>.textconv): 変換後のテキストで diff が作られるため、変換結果が
//   同一だと「差分はありません」と表示され、異なる場合は実体と食い違うパッチが作られる。--no-ext-diff では無効化されない
//   ので --no-textconv が別途必要
// - color.ui / color.diff = always: パイプ出力でも ANSI エスケープが混入し、DiffView にエスケープ列が文字として表示され、
//   パッチも壊れる
// 未追跡ファイルの疑似 diff(buildUntrackedDiff)は常に a/ b/ を付けるので、揃えるべきはこちら側
export const PATCH_FORMAT_ARGS: readonly string[] = [
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--src-prefix=a/',
  '--dst-prefix=b/'
]

// diff のオプションでは打ち消せない設定は、diff を作る git の -c(simple-git の config)で打ち消す。PATCH_FORMAT_ARGS と
// 一緒に使う。実機で再現確認済み:
// - diff.suppressBlankEmpty=true: 空の文脈行が先頭の空白なしの空行で出力され、ハンクのパッチの検査(gitHunkPatch の
//   assertHunkPatchTargets)が食い違いとして拒否し、空行を文脈に含むハンクの破棄とエージェントの変更の ↶ が失敗する
//   (ステージ・アンステージはこの検査を通らず、git apply も空行を空の文脈行として受け付けるため失敗しない)
export const PATCH_FORMAT_CONFIG: readonly string[] = ['diff.suppressBlankEmpty=false']
