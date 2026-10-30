'use client'

import type { GitLogRef, GitLogRefKind } from '@shared/types'
import { BranchIcon, CloudIcon, TagIcon } from '../icons'

const MAX_VISIBLE_REFS = 2

// 優先の順(要件 8)。小さいほど先に出す
const REF_KIND_PRIORITY: Record<GitLogRefKind, number> = {
  current: 0,
  remote: 1,
  tag: 2,
  branch: 3
}

const REF_KIND_ICONS: Record<GitLogRefKind, () => React.JSX.Element> = {
  current: BranchIcon,
  branch: BranchIcon,
  remote: CloudIcon,
  tag: TagIcon
}

// 種類を色とアイコンだけで示さないよう、読み上げ用の隠しテキストにも出す
const REF_KIND_LABELS: Record<GitLogRefKind, string> = {
  current: '現在のブランチ',
  branch: 'ブランチ',
  remote: 'リモート',
  tag: 'タグ'
}

const describeRef = (ref: GitLogRef): string => `${REF_KIND_LABELS[ref.kind]} ${ref.name}`

interface Props {
  refs: readonly GitLogRef[]
}

export default function GitLogRefLabels({ refs }: Props): React.JSX.Element | null {
  if (refs.length === 0) return null

  const sortedRefs = [...refs].sort((a, b) => REF_KIND_PRIORITY[a.kind] - REF_KIND_PRIORITY[b.kind])
  const visibleRefs = sortedRefs.slice(0, MAX_VISIBLE_REFS)
  const hiddenRefs = sortedRefs.slice(MAX_VISIBLE_REFS)

  return (
    <span
      className={
        visibleRefs.length >= 2
          ? 'history-section__refs history-section__refs--multiple'
          : 'history-section__refs'
      }
    >
      {visibleRefs.map((ref) => {
        const Icon = REF_KIND_ICONS[ref.kind]
        return (
          <span
            key={`${ref.kind}:${ref.name}`}
            className={`history-section__ref history-section__ref--${ref.kind}`}
            title={ref.name}
          >
            <Icon />
            <span className="history-section__visually-hidden">{REF_KIND_LABELS[ref.kind]} </span>
            <span className="history-section__ref-name">{ref.name}</span>
          </span>
        )
      })}
      {hiddenRefs.length > 0 && (
        <span
          className="history-section__ref history-section__ref--more"
          title={hiddenRefs.map((ref) => ref.name).join('\n')}
        >
          +{hiddenRefs.length}
          <span className="history-section__visually-hidden">
            {` ${hiddenRefs.map(describeRef).join('、')}`}
          </span>
        </span>
      )}
    </span>
  )
}
