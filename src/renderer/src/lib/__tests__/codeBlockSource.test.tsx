import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { getCodeBlockSource } from '../codeBlockSource'
import type { CodeBlockSource } from '../codeBlockSource'

// MarkdownRenderer と同じプラグインで実際に描画し、pre に渡る hast の要素から取り出す(hast の形は
// react-markdown 10.1.0 / mdast-util-to-hast の実際の出力に依存するため、手で組み立てた木では確かめない)
function extract(markdown: string): (CodeBlockSource | null)[] {
  const sources: (CodeBlockSource | null)[] = []
  render(
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        pre: ({ node, children }) => {
          sources.push(getCodeBlockSource(node))
          return <pre>{children}</pre>
        }
      }}
    >
      {markdown}
    </ReactMarkdown>
  )
  return sources
}

describe('getCodeBlockSource', () => {
  it.each<[string, string, CodeBlockSource]>([
    [
      '言語付き',
      '```ts\nconst a = 1\nconst b = 2\n```',
      { code: 'const a = 1\nconst b = 2', language: 'ts' }
    ],
    ['言語なし', '```\nplain\n```', { code: 'plain', language: null }],
    ['情報文字列は先頭の語だけが言語', '```ts title="x.ts"\nx\n```', { code: 'x', language: 'ts' }],
    ['チルダのフェンス', '~~~py\nprint(1)\n~~~', { code: 'print(1)', language: 'py' }],
    ['空のコードブロック', '```js\n```', { code: '', language: 'js' }],
    [
      '末尾の空行は残す(足された改行を 1 つだけ除く)',
      '```js\na\n\n\n```',
      { code: 'a\n\n', language: 'js' }
    ],
    [
      'インデントのコードブロック',
      'para\n\n    indented\n    line2\n',
      { code: 'indented\nline2', language: null }
    ],
    [
      '引用の中(> を除く)',
      '> ```ts\n> quoted\n>   indented\n> ```',
      { code: 'quoted\n  indented', language: 'ts' }
    ],
    [
      'リストの中(リストのインデントを除く)',
      '- item\n\n  ```ts\n  in list\n    deeper\n  ```',
      { code: 'in list\n  deeper', language: 'ts' }
    ],
    [
      '長いフェンスの中のフェンス',
      '````md\n```ts\ninner\n```\n````',
      { code: '```ts\ninner\n```', language: 'md' }
    ],
    [
      '閉じていないフェンスは末尾まで',
      '```ts\nno close\nmore',
      { code: 'no close\nmore', language: 'ts' }
    ],
    [
      'タブと HTML の文字はそのまま',
      '```html\n\t<div>&amp;</div>\n```',
      { code: '\t<div>&amp;</div>', language: 'html' }
    ],
    ['言語名の大文字・記号はそのまま', '```c++\nx\n```', { code: 'x', language: 'c++' }],
    ['remark-breaks は改行を変えない', '```txt\na\nb\n```', { code: 'a\nb', language: 'txt' }],
    ['コードの途中の空行は残す', '```txt\na\n\nb\n```', { code: 'a\n\nb', language: 'txt' }]
  ])('%s', (_name, markdown, expected) => {
    expect(extract(markdown)).toEqual([expected])
  })

  it('インラインコードは pre にならない', () => {
    expect(extract('use `foo()` here')).toEqual([])
  })

  it('複数のコードブロックは出現順', () => {
    expect(extract('```a\n1\n```\n\ntext\n\n```b\n2\n```')).toEqual([
      { code: '1', language: 'a' },
      { code: '2', language: 'b' }
    ])
  })

  it('要素が無い・code の子を持たない pre は null', () => {
    expect(getCodeBlockSource(undefined)).toBeNull()
    expect(
      getCodeBlockSource({ type: 'element', tagName: 'pre', properties: {}, children: [] })
    ).toBeNull()
  })

  it('span・text だけを子に持つ pre(code が無い)は null(code 以外の要素から取り出さない)', () => {
    expect(
      getCodeBlockSource({
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          { type: 'text', value: 'lead ' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['language-js'] },
            children: [{ type: 'text', value: 'not code' }]
          }
        ]
      })
    ).toBeNull()
  })

  it('code の子が分かれていても(将来のハイライト等)、テキストをつなげて取り出す', () => {
    expect(
      getCodeBlockSource({
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            // language- で始まらない class(ハイライトの class 等)は言語名にしない
            properties: { className: ['code-highlight', 'language-js'] },
            children: [
              {
                type: 'element',
                tagName: 'span',
                properties: {},
                children: [{ type: 'text', value: 'const' }]
              },
              { type: 'text', value: ' a\n' }
            ]
          }
        ]
      })
    ).toEqual({ code: 'const a', language: 'js' })
  })
})
