import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { Components } from 'react-markdown'
import CodeBlock from './CodeBlock'
import { CodeBlockActionsContext } from './codeBlockActions'
import type { ApplyActions } from './ApplyButtons'

interface Props {
  content: string
  /** 渡されたときだけ、コードブロックに言語名と「挿入」「置換」を付ける(出力パネル) */
  codeBlockActions?: ApplyActions
}

const LINK_SAFE_SCHEMES = ['http:', 'https:', 'mailto:']
const IMG_SAFE_SCHEMES = ['http:', 'https:']

const components: Components = {
  // node(hast)は DOM の属性へ渡さないよう、分割代入で取り除く(使わない)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  a: ({ href, children, node: _node, ...props }) => {
    const trimmedHref = href?.trim() ?? ''
    const isSafe = LINK_SAFE_SCHEMES.some((s) => trimmedHref.toLowerCase().startsWith(s))
    if (!isSafe) return <span>{children}</span>
    return (
      <a {...props} href={trimmedHref} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  img: ({ src, alt, node: _node, ...props }) => {
    const trimmedSrc = src?.trim() ?? ''
    const isSafe = IMG_SAFE_SCHEMES.some((s) => trimmedSrc.toLowerCase().startsWith(s))
    if (!isSafe) return <span>{alt ?? ''}</span>
    return <img {...props} src={trimmedSrc} alt={alt} />
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  table: ({ children, node: _node, ...props }) => (
    <div className="markdown-renderer__table-wrapper">
      <table {...props}>{children}</table>
    </div>
  )
}

// コードブロックに反映のボタンを付けるときの components。定数にし、描画ごとに作り直さない(codeBlockActions.ts)
const componentsWithCodeBlock: Components = { ...components, pre: CodeBlock }

export default function MarkdownRenderer({ content, codeBlockActions }: Props): React.JSX.Element {
  return (
    <div className="markdown-renderer">
      <CodeBlockActionsContext.Provider value={codeBlockActions ?? null}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          components={codeBlockActions === undefined ? components : componentsWithCodeBlock}
        >
          {content}
        </ReactMarkdown>
      </CodeBlockActionsContext.Provider>
    </div>
  )
}
