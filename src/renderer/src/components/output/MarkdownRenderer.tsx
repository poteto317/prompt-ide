import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { Components } from 'react-markdown'

interface Props {
  content: string
}

const components: Components = {
  a: ({ href, children, node: _node, ...props }) => {
    const safeHref = href?.toLowerCase().startsWith('javascript:') ? '#' : href
    return (
      <a {...props} href={safeHref} target="_blank" rel="noopener noreferrer">
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
