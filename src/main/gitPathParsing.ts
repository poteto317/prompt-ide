// -z(NUL 区切り)で出力されたパスの一覧。ls-files -u の行は「mode sha stage<TAB>path」の
// 形式のため、withStageInfo のときは最初の TAB より後ろをパスとして取り出す
export function parseNulSeparatedPaths(output: string, withStageInfo = false): string[] {
  return output
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => (withStageInfo ? entry.slice(entry.indexOf('\t') + 1) : entry))
}
