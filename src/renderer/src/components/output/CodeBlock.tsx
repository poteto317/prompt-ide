'use client'

import { useContext } from 'react'
import type { ComponentProps } from 'react'
import type { ExtraProps } from 'react-markdown'
import { getCodeBlockSource } from '../../lib/codeBlockSource'
import { CodeBlockActionsContext } from './codeBlockActions'
import ApplyButtons from './ApplyButtons'

type Props = ComponentProps<'pre'> & ExtraProps

// 出力のコードブロック(MarkdownRenderer の pre の差し替え)。pre の外側のラッパーに、言語名と
// 「挿入」「置換」(ApplyButtons)を置く(Markdown の構造の中には入れない)。反映するのは hast から取り出した原文。
// コードが空のブロックは反映しても何も変わらないため、ボタンを出さない
export default function CodeBlock({ node, children, ...props }: Props): React.JSX.Element {
  const actions = useContext(CodeBlockActionsContext)
  const source = getCodeBlockSource(node)
  if (actions === null || source === null) {
    return <pre {...props}>{children}</pre>
  }
  const { code, language } = source
  return (
    <div className="code-block">
      <div className="code-block__toolbar">
        <span className="code-block__language">{language ?? 'コード'}</span>
        {code !== '' && (
          <span className="code-block__actions">
            <ApplyButtons
              {...actions}
              text={code}
              insertHint="このコードブロックをカーソル位置へ"
              replaceHint="選択範囲をこのコードブロックで"
              className="code-block__button"
            />
          </span>
        )}
      </div>
      <pre {...props} className="code-block__pre">
        {children}
      </pre>
    </div>
  )
}
