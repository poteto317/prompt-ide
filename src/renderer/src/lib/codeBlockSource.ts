import type { ExtraProps } from 'react-markdown'

// hast(react-markdown が components に渡す構文木)の型。hast は react-markdown の依存で、このアプリの直接の
// 依存ではないため、react-markdown の公開の型から取り出す。DOM のグローバル型 Element を隠さないよう Hast を付ける
type HastElement = NonNullable<ExtraProps['node']>
type HastElementContent = HastElement['children'][number]

export interface CodeBlockSource {
  /** コードの原文(フェンスと言語名を除き、末尾の改行を 1 つだけ除いたもの) */
  code: string
  /** フェンスの言語名(```ts の ts)。無ければ null */
  language: string | null
}

const LANGUAGE_CLASS_PREFIX = 'language-'

const collectText = (nodes: HastElementContent[]): string =>
  nodes
    .map((node) =>
      node.type === 'text' ? node.value : node.type === 'element' ? collectText(node.children) : ''
    )
    .join('')

const findLanguage = (code: HastElement): string | null => {
  const className = code.properties.className
  if (!Array.isArray(className)) return null
  for (const name of className) {
    if (typeof name === 'string' && name.startsWith(LANGUAGE_CLASS_PREFIX)) {
      const language = name.slice(LANGUAGE_CLASS_PREFIX.length)
      if (language !== '') return language
    }
  }
  return null
}

/**
 * react-markdown が pre に渡す hast の要素から、コードブロックの原文と言語名を取り出す。表示用の React の
 * children ではなく hast のテキストを使い、表示の加工(将来のハイライト等)の影響を受けない。
 * mdast-util-to-hast はコードが空でなければ末尾に改行を 1 つ足すため、それを 1 つだけ除く
 * (コードの中の末尾の空行は残す)。code の子を持たない pre(このアプリでは生の HTML を描画しないため
 * 実際には来ない)は null
 */
export function getCodeBlockSource(pre: HastElement | undefined): CodeBlockSource | null {
  if (pre === undefined) return null
  const code = pre.children.find(
    (child): child is HastElement => child.type === 'element' && child.tagName === 'code'
  )
  if (code === undefined) return null
  const text = collectText(code.children)
  return {
    code: text.endsWith('\n') ? text.slice(0, -1) : text,
    language: findLanguage(code)
  }
}
