// 新規作成・リネームの名前として安全か。main 側の検証条件（handlers/entryNameValidator）
// と揃える。renderer 側は、この名前をもとに保存ロックの無効化範囲（joinPath）を
// 決めるためにも使うため、main と食い違うと範囲を誤る
export function isSafeEntryName(name: string): boolean {
  const trimmed = name.trim()
  return (
    trimmed.length > 0 &&
    trimmed !== '.' &&
    trimmed !== '..' &&
    !/[/\\]/.test(trimmed) &&
    trimmed === name
  )
}
