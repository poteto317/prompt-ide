import { useRef } from 'react'
import type { RemoteSetupPanelState } from '../../types'
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn'
import { useFocusOnRunningEnd } from '../../hooks/useFocusOnRunningEnd'
import { SETTING_UPSTREAM_NOTICE, buildRemoteSetupBannerText } from '../../lib/remoteSetupState'
import type { RemoteSetupFocusTarget, RemoteSetupKind } from '../../lib/remoteSetupState'
import AddRemoteDialog from './AddRemoteDialog'

interface Props {
  /** getRemoteSetupState(gitStatus) の結果。null ならバナーを出さない(開いている追加のダイアログは出し続ける) */
  kind: RemoteSetupKind | null
  /** 現在のブランチ名(upstream が未設定の文言に使う) */
  branch: string | null
  remoteSetup: RemoteSetupPanelState
  /** 他の操作中(ステージ・ハンク操作・commit・pull・ブランチ操作・退避・解決ビューの操作)で、押しても no-op になる状態 */
  isBlocked: boolean
  /** 成功の後に、次の操作のボタンへのフォーカスを要求する(SourceControlPanel の useRemoteSetupFocus) */
  requestFocus: (target: RemoteSetupFocusTarget) => void
}

// リモートの状態バナー(MergeBanner と同じ作り: section、文言は role="status"、ボタンの並び)。
// origin が無ければ「リモートを追加」(ダイアログの開閉もここで持つ)、upstream が無ければ「初回 push（upstream を設定）」。
// 追加のダイアログは、バナーの種類が変わっても(別のプロセスが先に origin を追加した失敗など)閉じずに出し続け、
// 失敗を見せる(差分 5。パターン 85)。成功の後のフォーカスの要求は、成功を受け取ったここで出す(差分 4)
export default function RemoteSetupBanner({
  kind,
  branch,
  remoteSetup,
  isBlocked,
  requestFocus
}: Props): React.JSX.Element {
  // 開くときに前回の失敗の表示を消す。キャンセル等で閉じたら、追加中でもなくなった描画の後に「リモートを追加」へ
  // フォーカスを戻す(body のときだけ。useDialogFocusReturn。NotRepositoryView と同じ)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const addDialog = useDialogFocusReturn({
    isRunning: remoteSetup.isAddingOrigin,
    onOpen: remoteSetup.clearAddOriginError,
    openerRef: addButtonRef
  })

  // 成功すると「リモートを追加」は消える(バナーが upstream の未設定に変わる)ため、戻さずに閉じ、次の操作のボタンへ移す
  const handleAddOrigin = async (url: string): Promise<void> => {
    if (!(await remoteSetup.addOrigin(url))) return
    addDialog.closeWithoutReturn()
    requestFocus('set-upstream')
  }

  // 成功するとバナーごと消えるため、ツールバーの「プッシュ」へ移す
  const handleSetUpstream = async (): Promise<void> => {
    if (await remoteSetup.pushSetUpstream()) requestFocus('push')
  }

  const isSettingUpstream = remoteSetup.isSettingUpstream
  // 失敗の直後(取り直しの間は実行中のままエラーが入る)は案内を出さない(パターン 87)
  const showSettingUpstreamNotice = isSettingUpstream && remoteSetup.remoteOperationError === null

  // 初回 push の実行中はボタンが disabled になり、ブラウザはフォーカスを body に落とす。失敗して押せるに戻っても
  // body のままだと、キーボードの利用者がボタンへ戻れない。そのため実行中が解けたとき(エラーがある=失敗)に、
  // フォーカスが body ならボタンへ戻す(外の要素にあるフォーカスは奪わない。useFocusOnRunningEnd。パターン 86)。
  // 成功ではバナーが消えるか、残っても(upstream が表示されない origin)成功の後のフォーカスの要求
  // (ツールバーの「プッシュ」。useRemoteSetupFocus)に任せるため、ここでは移さない(enabled をエラーの有無にする)
  const setUpstreamButtonRef = useRef<HTMLButtonElement>(null)
  useFocusOnRunningEnd(isSettingUpstream, setUpstreamButtonRef, {
    enabled: remoteSetup.remoteOperationError !== null
  })

  return (
    <>
      {kind !== null && (
        <section className="remote-setup-banner">
          <p className="remote-setup-banner__message" role="status">
            {buildRemoteSetupBannerText(kind, branch)}
          </p>
          <div className="remote-setup-banner__actions">
            {kind === 'no-origin' ? (
              <button
                ref={addButtonRef}
                type="button"
                className="remote-setup-banner__button"
                // 値は RemoteSetupFocusTarget と型で結ぶ(綴りの食い違いを typecheck で検出する。パターン 88)
                data-remote-setup-focus={'add-remote' satisfies RemoteSetupFocusTarget}
                aria-label="リモートを追加"
                disabled={remoteSetup.isAddingOrigin || isBlocked}
                onClick={addDialog.open}
              >
                リモートを追加
              </button>
            ) : (
              <button
                ref={setUpstreamButtonRef}
                type="button"
                className="remote-setup-banner__button"
                data-remote-setup-focus={'set-upstream' satisfies RemoteSetupFocusTarget}
                aria-label={isSettingUpstream ? 'push 中' : '初回 push（upstream を設定）'}
                // push と実行中フラグを共有する(ツールバーの push 中・pull 中・ロック中も押せない)
                disabled={remoteSetup.isPushing || remoteSetup.isPushBlocked || isBlocked}
                onClick={() => void handleSetUpstream()}
              >
                {isSettingUpstream ? 'push 中...' : '初回 push（upstream を設定）'}
              </button>
            )}
          </div>
          {kind === 'no-upstream' && showSettingUpstreamNotice && (
            <p className="remote-setup-banner__note" role="status">
              {SETTING_UPSTREAM_NOTICE}
            </p>
          )}
        </section>
      )}
      {addDialog.isOpen && (
        <AddRemoteDialog
          isRunning={remoteSetup.isAddingOrigin}
          isBlocked={isBlocked}
          error={remoteSetup.addOriginError}
          onSubmit={(url) => void handleAddOrigin(url)}
          onCancel={addDialog.close}
        />
      )}
    </>
  )
}
