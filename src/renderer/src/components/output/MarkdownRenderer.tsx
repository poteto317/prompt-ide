import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { Components } from 'react-markdown'

interface Props {
  content: string
}

const LINK_SAFE_SCHEMES = ['http:', 'https:', 'mailto:']
const IMG_SAFE_SCHEMES = ['http:', 'https:']

const components: Components = {
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
  img: ({ src, alt, node: _node, ...props }) => {
    const trimmedSrc = src?.trim() ?? ''
    const isSafe = IMG_SAFE_SCHEMES.some((s) => trimmedSrc.toLowerCase().startsWith(s))
    if (!isSafe) return <span>{alt ?? ''}</span>
    return <img {...props} src={trimmedSrc} alt={alt} />
  },
  table: ({ children, node: _node, ...props }) => (
    <div className="markdown-renderer__table-wrapper">
      <table {...props}>{children}</table>
    </div>
  ),
}

export default function MarkdownRenderer({ content }: Props) {
  return (
    <div className="markdown-renderer">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
