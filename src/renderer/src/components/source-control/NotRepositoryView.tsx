import { useRef } from 'react'
import type { RemoteSetupPanelState } from '../../types'
import type { RemoteSetupFocusTarget } from '../../lib/remoteSetupState'
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn'
import InitRepositoryDialog from './InitRepositoryDialog'
import AgentChangesSection from './AgentChangesSection'
import type { AgentChangesPanelState } from '../../hooks/useAgentChangesWiring'

interface Props {
  remoteSetup: RemoteSetupPanelState
  /** 他の Git 操作のロック中で、初期化しても no-op になる状態(ダイアログの「初期化」を disabled にする) */
  isBlocked: boolean
  /** 成功の後に、次の操作のボタンへのフォーカスを要求する(SourceControlPanel の useRemoteSetupFocus) */
  requestFocus: (target: RemoteSetupFocusTarget) => void
  /** セクション「エージェントの変更」(Git 管理外の理由を出す) */
  agentChanges?: AgentChangesPanelState
}

// Git 管理外のフォルダの表示。「リポジトリを初期化」とダイアログの開閉を持つ。初期化に成功すると、ステータスの
// 取り直しでパネルがリポジトリの表示に切り替わり、この部品ごと外れる(開閉の状態は別のフォルダへ持ち越さない。差分 5)
export default function NotRepositoryView({
  remoteSetup,
  isBlocked,
  requestFocus,
  agentChanges
}: Props): React.JSX.Element {
  // 開くときに前回の失敗の表示を消す(キャンセルしたダイアログのエラーを持ち越さない)。キャンセル・Escape・
  // オーバーレイのクリックで閉じたら、初期化中でもなくなった描画の後にボタンへフォーカスを戻す(useDialogFocusReturn)
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const dialog = useDialogFocusReturn({
    isRunning: remoteSetup.isInitializing,
    onOpen: remoteSetup.clearInitError,
    openerRef: openButtonRef
  })

  // 成功したときだけ閉じ、次の操作のボタン(「リモートを追加」)へのフォーカスを要求する。要求はダイアログを閉じるのと
  // 同じ描画に入れ、SourceControlPanel が描画の後に移す(差分 4)。通常はステータスの取り直しでリポジトリの表示に
  // 切り替わり、この部品ごと外れるため、close の「戻す予約」は捨てられて要求の先(バナー)へ移る。取り直しが失敗して
  // (握りつぶされる)Git 管理外の表示のままなら、移す先が無いため、予約どおり開いたボタンへ戻す(子の effect が
  // 親の useRemoteSetupFocus より先に走り、body でなくなったフォーカスを親は奪わない)。
  // 失敗(false)はダイアログ内に initError を表示したまま残す
  const handleSubmit = async (branch: string): Promise<void> => {
    if (!(await remoteSetup.initRepository(branch))) return
    dialog.close()
    requestFocus('add-remote')
  }

  return (
    <div className="source-control-panel__no-repo-view">
      <p className="source-control-panel__no-repo">Git リポジトリではありません</p>
      <div className="source-control-panel__no-repo-actions">
        <button
          ref={openButtonRef}
          type="button"
          className="source-control-panel__init-btn"
          aria-label="リポジトリを初期化"
          // 初期化中も押せない(開き直したダイアログが、前の初期化の成功で閉じられるのを防ぐ。パターン 73)
          disabled={remoteSetup.isInitializing}
          onClick={dialog.open}
        >
          リポジトリを初期化
        </button>
      </div>
      {agentChanges !== undefined && <AgentChangesSection {...agentChanges} isNotRepository />}
      {dialog.isOpen && (
        <InitRepositoryDialog
          isRunning={remoteSetup.isInitializing}
          isBlocked={isBlocked}
          error={remoteSetup.initError}
          onSubmit={(branch) => void handleSubmit(branch)}
          onCancel={dialog.close}
        />
      )}
    </div>
  )
}
