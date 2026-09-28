import type { GitBranch } from '@shared/types'

interface Props {
  branch: GitBranch
  /** roving tabindex で、このブランチが radiogroup 内の唯一の Tab 停止点か */
  isTabbable: boolean
  /** 親(BranchSwitcherMenu)が矢印キーでフォーカスを移すための要素登録。アンマウント時は null */
  registerRef: (branchName: string, el: HTMLButtonElement | null) => void
  onFocus: (branchName: string) => void
  onSelect: (branchName: string) => void
  onDelete: (branchName: string) => void
}

// ブランチ一覧の1行(選択用の radio と削除ボタン)。メニュー全体の開閉や矢印キーによる
// フォーカス移動は親(BranchSwitcherMenu)の責務で、ここでは1ブランチ分の表示と操作だけを担う。
// 現在ブランチは選択も削除もできないため、radio を disabled にし削除ボタンを出さない
export default function BranchMenuItem({
  branch,
  isTabbable,
  registerRef,
  onFocus,
  onSelect,
  onDelete
}: Props): React.JSX.Element {
  const canDelete = !branch.current
  return (
    <div className="source-control-panel__branch-menu-row">
      <button
        ref={(el) => registerRef(branch.name, el)}
        type="button"
        role="radio"
        aria-checked={branch.current}
        aria-keyshortcuts={canDelete ? 'Delete' : undefined}
        className="source-control-panel__branch-menu-item"
        disabled={branch.current}
        tabIndex={isTabbable ? 0 : -1}
        onFocus={() => onFocus(branch.name)}
        onClick={() => onSelect(branch.name)}
        onKeyDown={(e) => {
          if (e.key === 'Delete' && canDelete) {
            e.preventDefault()
            onDelete(branch.name)
          }
        }}
      >
        {branch.current ? '✓ ' : ''}
        {branch.name}
      </button>
      {canDelete && (
        // roving tabindex を崩さないよう Tab 停止点にしない。キーボードでは
        // radio 上の Delete キーで同じ操作ができる(aria-keyshortcuts で告知)
        <button
          type="button"
          tabIndex={-1}
          className="source-control-panel__branch-menu-delete"
          aria-label={`ブランチ ${branch.name} を削除`}
          onClick={() => onDelete(branch.name)}
        >
          🗑
        </button>
      )}
    </div>
  )
}
