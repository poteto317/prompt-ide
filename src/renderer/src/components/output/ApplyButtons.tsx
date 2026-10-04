'use client'

import type { ApplyOutputState } from '../../types'

/** 挿入・置換のボタンの対が使う、反映の可否と操作(ヘッダーとコードブロックで共有する) */
export interface ApplyActions {
  insertDisabledReason: ApplyOutputState['insertDisabledReason']
  replaceDisabledReason: ApplyOutputState['replaceDisabledReason']
  apply: ApplyOutputState['apply']
  /** 無効の理由を表示している要素の id(無効なボタンの aria-describedby) */
  reasonId: string
}

type Props = ApplyActions & {
  /** 反映するテキスト(出力全体・コードブロックの原文) */
  text: string
  /** 挿入のボタンのアクセシブルネームの補足(「挿入（…）」の括弧の中) */
  insertHint: string
  /** 置換のボタンのアクセシブルネームの補足(「置換（…）」の括弧の中) */
  replaceHint: string
  /** 2 つのボタンに付けるクラス */
  className: string
}

// 「挿入」「置換」のボタンの対(出力パネルのヘッダーとコードブロックで共有する)。無効なボタンは disabled にし、
// 理由を title と aria-describedby(理由を表示している要素の reasonId)で示す。名前は表示文言で始め、補足を
// 括弧で続ける(パターン 76)
export default function ApplyButtons({
  text,
  insertHint,
  replaceHint,
  className,
  insertDisabledReason,
  replaceDisabledReason,
  apply,
  reasonId
}: Props): React.JSX.Element {
  const buttons = [
    { mode: 'insert', label: '挿入', hint: insertHint, reason: insertDisabledReason },
    { mode: 'replace', label: '置換', hint: replaceHint, reason: replaceDisabledReason }
  ] as const
  return (
    <>
      {buttons.map(({ mode, label, hint, reason }) => (
        <button
          key={mode}
          type="button"
          className={className}
          aria-label={`${label}（${hint}）`}
          disabled={reason !== null}
          title={reason ?? undefined}
          aria-describedby={reason !== null ? reasonId : undefined}
          onClick={() => apply(mode, text)}
        >
          {label}
        </button>
      ))}
    </>
  )
}
