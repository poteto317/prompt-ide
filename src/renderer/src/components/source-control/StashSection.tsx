import { useRef, useState } from 'react'
import type { StashPanelState } from '../../types'
import CollapsibleSection from './CollapsibleSection'
import StashItem from './StashItem'
import StashMessageDialog from './StashMessageDialog'

interface Props {
  stash: StashPanelState
  /** 他の操作中(ステージ・ハンク操作・commit・pull・ブランチ操作)で押しても no-op になる状態 */
  isBlocked: boolean
}

// 「退避」セクション(見出し・件数・「退避する」ボタン・一覧)。メッセージ入力ダイアログの開閉と、
// 閉じたときのフォーカスの戻し(パターン 22)をここで持つ。操作の実行・排他・確認は
// 呼び出し元(useAppState / useGitStashOperations)の責務
export default function StashSection({ stash, isBlocked }: Props): React.JSX.Element {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const pushButtonRef = useRef<HTMLButtonElement>(null)
  const isPushing = stash.pendingOperation?.kind === 'push'
  const isDisabled = isBlocked || stash.pendingOperation !== null

  // ダイアログを閉じたら(OK・キャンセル・Escape・オーバーレイクリックのいずれも)ボタンへフォーカスを戻す。
  // OK の場合は、ボタンが実行中に disabled になる前にフォーカスを戻すため、onPush より先に呼ぶ
  const closeDialog = (): void => {
    setIsDialogOpen(false)
    pushButtonRef.current?.focus()
  }

  const handleSubmit = (message: string): void => {
    closeDialog()
    void stash.onPush(message)
  }

  return (
    <>
      <CollapsibleSection
        title="退避"
        count={stash.entries.length}
        actions={
          <button
            ref={pushButtonRef}
            type="button"
            className="stash-section__push"
            aria-label={isPushing ? '退避中' : '変更を退避する'}
            disabled={isDisabled}
            onClick={() => setIsDialogOpen(true)}
          >
            {isPushing ? '退避中...' : '退避する'}
          </button>
        }
        alwaysVisible={
          stash.error !== null && (
            <p className="stash-section__error" role="alert">
              {stash.error.message}
            </p>
          )
        }
      >
        {stash.entries.length === 0 ? (
          <p className="stash-section__empty">退避はありません</p>
        ) : (
          <ul className="stash-section__list">
            {stash.entries.map((entry) => (
              <StashItem
                key={entry.sha}
                entry={entry}
                pending={stash.pendingOperation}
                isBlocked={isBlocked}
                onPop={(sha) => void stash.onPop(sha)}
                onDrop={(target) => void stash.onDrop(target)}
              />
            ))}
          </ul>
        )}
      </CollapsibleSection>
      {isDialogOpen && <StashMessageDialog onSubmit={handleSubmit} onCancel={closeDialog} />}
    </>
  )
}
