import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { Components } from 'react-markdown'

interface Props {
  content: string
}

const SAFE_SCHEMES = ['http:', 'https:', 'mailto:']

const components: Components = {
  a: ({ href, children, node: _node, ...props }) => {
    const normalized = href?.toLowerCase() ?? ''
    const isSafe = SAFE_SCHEMES.some((s) => normalized.startsWith(s))
    if (!isSafe) return <span>{children}</span>
    return (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  },
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
