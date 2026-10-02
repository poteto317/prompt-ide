// タグ名のうち、git 本体の規則(check-ref-format)より手前でアプリ独自に拒否する規則。
// main 側(gitTagService)と renderer 側(tagValidation)が同じ判定を使うために共有する
// (片方だけ規則を変えると、ダイアログは通るのに main で拒否される等の食い違いが起きる。パターン 14)。
// 文言は文脈ごとに異なるため、ここでは違反の種類だけを返す
// タグ名の入口(main の createTag と renderer のダイアログ)で使う正規化。前後の空白を除き、Unicode の NFC に
// そろえる。'é' などは NFC(1 文字)と NFD(e + 結合文字)で見た目が同じでも別の文字列になり、
// check-ref-format --normalize も NFD をそのまま返す。正規化しないと次が起きる(いずれも実機 git 2.50.1 で確認):
// - core.precomposeunicode=false: packed-refs の NFC のタグがあると NFD のタグが終了コード 0 で作られ、
//   `git rev-parse <NFC>` が NFD のタグのコミットを返す(既存のタグの解決を奪う)
// - 既定(precomposeunicode=true): git が argv を NFC に直すため、NFC のタグがあると英語の
//   `already exists` になり、reftable では NFC 名で作られて作成後の確認(NFD の ref)が見つからない
// renderer が送る値も main が git に渡す値も、この関数の結果にそろえる
export function normalizeTagName(name: string): string {
  return name.trim().normalize('NFC')
}

// 衝突の判定に使う比較用の形(NFC にそろえてから、Unicode の完全な case folding で大文字小文字を無視する)。
// 既存のタグ・ブランチは NFD で保存されていることがある(precomposeunicode=false のリポジトリや他のツールが
// 作った ref)ため、要求側と既存側の両方に適用する。
// macOS の APFS は完全な case folding で名前を比べるため、toLowerCase だけでは一致しない 'ß' と 'ss'・'ẞ'、
// 'ſ' と 's'、'µ' と 'μ'、'ς' と 'σ'、'ﬁ' と 'fi' なども同じ名前になる。packed-refs の 'ss' があると 'ß' が
// 終了コード 0 で作られ、`git rev-parse refs/tags/ss` が新しいコミットを返す(実機 git 2.50.1 / APFS で確認)。
// JavaScript に case folding の API は無いため、1 文字ずつ小文字 → 大文字 → 小文字の順に変換して近づける:
// - 大文字化で 'ß' → 'SS'、'ﬁ' → 'FI'、'ſ' → 'S' のように展開・統一し、最初の小文字化で 'ẞ' を 'ß' に寄せる
// - 'ς'(語末の σ)も大文字化で 'Σ' になり、1 文字ずつ小文字化するので常に 'σ' にそろう(文字列全体の
//   toLowerCase は語末の 'Σ' を文脈に応じて 'ς' にするため、文字単位にして比較用の形を文脈に依存させない)
// - 'ı'(点の無い i)は大文字化で 'I' になり 'i' と同じになるが、APFS は別の名前として扱うため変換しない
//   (文字単位にしているのは、この例外を入れるためでもある)
// Unicode の全文字の単一文字の同値類(2295 個)が APFS と一致することを実機で確認した
function caseFoldChar(char: string): string {
  if (char === '\u0131') return char
  return char.toLowerCase().toUpperCase().toLowerCase()
}

function collisionKey(name: string): string {
  return Array.from(name.normalize('NFC'), caseFoldChar).join('').normalize('NFC')
}

export type TagNameRuleViolation = 'empty' | 'leading-dash' | 'reserved'

export function getTagNameRuleViolation(name: string): TagNameRuleViolation | null {
  if (name.length === 0) return 'empty'
  // '-' 始まりは git 自身(check-ref-format を含む)にオプションとして解釈される(パターン 21)
  if (name.startsWith('-')) return 'leading-dash'
  // check-ref-format は 'HEAD' と '@' を通すが、git tag は 'HEAD' を拒否し、'@' のタグは作れても
  // 以後の HEAD の解決を曖昧にする(`refname 'HEAD' is ambiguous`)。'head' は大文字小文字を区別しない
  // FS で `git rev-parse head` が .git/HEAD を返し、タグに届かない(いずれも実機 git 2.50.1 で確認)
  if (name === '@' || name.toLowerCase() === 'head') return 'reserved'
  return null
}

// 既存のタグと衝突する名前を返す。無ければ null。次のいずれも NFC にそろえ、大文字小文字を無視して判定する:
// - 階層の衝突: refs/tags 配下も refs/heads と同じくディレクトリ構造で保存されるため、一方が他方の
//   親階層になる名前('v1' と 'v1/x')は共存できない
// - 大文字小文字だけの違い('v1' と 'V1'): 大文字小文字を区別しない FS(macOS)では、packed-refs の 'v1' が
//   あると 'V1' が終了コード 0 で作られ、`git rev-parse v1` が 'V1' のコミットを返す(既存のタグの解決を
//   奪う)。loose なら git の英語のエラーになる(いずれも実機 git 2.50.1 で確認)。FS に依存させず一律に弾く
// 同名(NFC にそろえて完全一致)の重複はここでは扱わない(getTagNameCollision が先に duplicate として判定する)
function findConflictingTagName(name: string, existingTags: readonly string[]): string | null {
  const lowered = collisionKey(name)
  return (
    existingTags.find((existing) => {
      const existingLowered = collisionKey(existing)
      return (
        existingLowered === lowered ||
        lowered.startsWith(`${existingLowered}/`) ||
        existingLowered.startsWith(`${lowered}/`)
      )
    }) ?? null
  )
}

// 同名のローカルブランチ(NFC にそろえ、大文字小文字を無視)を返す。無ければ null。
// 同名のタグとブランチが共存すると、git merge <name> などが refs/tags を優先して別のコミットを選ぶ
// (パターン 43)。大文字小文字を区別しない FS では、タグ 'FEAT' がブランチ 'feat' の解決を奪う
// (実機で確認)ため、FS の性質に依存させず一律に大文字小文字を無視して比べる
function findSameNameBranch(name: string, branchNames: readonly string[]): string | null {
  const lowered = collisionKey(name)
  return branchNames.find((branch) => collisionKey(branch) === lowered) ?? null
}

export type TagNameCollisionKind = 'duplicate' | 'conflict' | 'branch'

// 衝突の種類と、文言に使う既存の名前(duplicate は同名のタグ、conflict は衝突するタグ、
// branch は同名のブランチ)
export interface TagNameCollision {
  kind: TagNameCollisionKind
  with: string
}

// 既存のタグ・ブランチとの衝突を、同名のタグ(NFC にそろえて一致)→ 衝突するタグ(階層・大文字小文字)→
// 同名のブランチの順に判定する。main(gitTagService)と renderer(tagValidation)の両方がこの順序を使う
// (片方だけ順序を変えると、ダイアログと main で報告する衝突が食い違う。パターン 14)。
// 文言は文脈ごとに異なるため、ここでは種類と相手の名前だけを返す
export function getTagNameCollision(
  name: string,
  existingTags: readonly string[],
  existingBranches: readonly string[]
): TagNameCollision | null {
  const normalized = name.normalize('NFC')
  const duplicate = existingTags.find((existing) => existing.normalize('NFC') === normalized)
  if (duplicate !== undefined) return { kind: 'duplicate', with: duplicate }
  const conflicting = findConflictingTagName(name, existingTags)
  if (conflicting !== null) return { kind: 'conflict', with: conflicting }
  const branch = findSameNameBranch(name, existingBranches)
  if (branch !== null) return { kind: 'branch', with: branch }
  return null
}
