'use client'

import { useRef } from 'react'
import type { CloneRepositoryPanelState } from '../../types'
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn'
import CloneRepositoryDialog from './CloneRepositoryDialog'

interface Props {
  /** リポジトリの clone の状態と操作 */
  clone: CloneRepositoryPanelState
}

// エクスプローラーの「リポジトリを clone」の入口。ボタンと、ダイアログの開閉・成功の判定・閉じた後のフォーカスの戻しを
// 持つ。ダイアログは固定のオーバーレイのため、ボタンの隣に描いても表示の位置は変わらない。ExplorerPanel は
// 「フォルダを開く」と「フォルダを変更」の 2 つの分岐の同じ位置に置くため、clone に成功してフォルダが開いても
// この部品は作り直されず、開閉の状態とフォーカスを戻す予約が保たれる
export default function CloneRepositoryEntry({ clone }: Props): React.JSX.Element {
  // 閉じたら(キャンセル・Escape・オーバーレイ・成功)、clone 中でもなくなった描画の後に「リポジトリを clone」へ
  // フォーカスを戻す(useDialogFocusReturn。パターン 86)。開くときに前回の失敗を消す
  const cloneButtonRef = useRef<HTMLButtonElement>(null)
  const dialog = useDialogFocusReturn({
    isRunning: clone.isCloning,
    onOpen: clone.clearError,
    openerRef: cloneButtonRef
  })

  // 成功(フォルダを開いた)ときだけ閉じる。取り消し・中止・失敗はダイアログに残す(入力を保持する)
  const handleSubmit = async (url: string, folderName: string): Promise<void> => {
    if (await clone.cloneRepository(url, folderName)) dialog.close()
  }

  return (
    <>
      {/* clone は他の Git 操作の実行中も押せない。clone の実行中のフォルダの変更の禁止は ExplorerPanel が持つ */}
      <button
        ref={cloneButtonRef}
        type="button"
        className="explorer-panel__clone-btn"
        aria-label="リポジトリを clone"
        disabled={clone.isCloning || clone.isBlocked}
        onClick={dialog.open}
      >
        リポジトリを clone
      </button>
      {dialog.isOpen && (
        <CloneRepositoryDialog
          isCloning={clone.isCloning}
          isBlocked={clone.isBlocked}
          error={clone.error}
          onSubmit={(url, folderName) => void handleSubmit(url, folderName)}
          onCancelClone={clone.cancelClone}
          onClose={dialog.close}
        />
      )}
    </>
  )
}
