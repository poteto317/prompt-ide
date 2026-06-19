// プロンプト本文中の変数プレースホルダ `{{name}}` を扱うユーティリティ。
// 変数名は Unicode 文字・数字・アンダースコア・ハイフンを許可し（日本語名も可）、
// プレースホルダ内の前後空白は無視する（例: `{{ name }}` は変数 `name`）。
const VARIABLE_PATTERN = /\{\{\s*([\p{L}\p{N}_-]+)\s*\}\}/gu

/**
 * テンプレート内の変数名を出現順に重複なく抽出する。
 * @example extractVariables('{{name}} さん、{{topic}} と {{name}}') → ['name', 'topic']
 */
export function extractVariables(template: string): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = match[1]
    if (!seen.has(name)) {
      seen.add(name)
      result.push(name)
    }
  }
  return result
}

/**
 * テンプレートに値を差し込む。値が未指定（自身のプロパティとして存在しない）変数は
 * `{{name}}` のリテラルを残す（防御的フォールバック）。
 * `Object.hasOwn` で判定し、`toString`/`constructor` などプロトタイプ継承プロパティを
 * 誤って拾わないようにする。
 * @example interpolatePrompt('Hi {{name}}', { name: 'Alice' }) → 'Hi Alice'
 */
export function interpolatePrompt(template: string, values: Record<string, string>): string {
  return template.replace(VARIABLE_PATTERN, (_full, name: string) =>
    Object.hasOwn(values, name) ? values[name] : `{{${name}}}`
  )
}
