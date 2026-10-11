'use client'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { AgentSendConfirmDialogState, AgentSendConfirmPending } from '../../types'
import { buildAgentSendPreview } from '../../lib/agentSendPreview'
import { formatAgentUnsavedNotice } from '../../lib/agentReferenceMessages'
import { findSendConfirmReturnTarget } from '../../lib/promptRunButton'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss'

interface Props {
  state: AgentSendConfirmDialogState
}

const LENGTH_FORMAT = new Intl.NumberFormat('ja-JP')

// 送信前の確認(設計書「ダイアログ」)。開閉は useAgentSendConfirm の pending が持つので、開いている間だけ本体をマウントする
export default function AgentSendConfirmDialog({ state }: Props): React.JSX.Element | null {
  if (state.pending === null) return null
  return (
    <AgentSendConfirmDialogBody
      pending={state.pending}
      targetBlockedReason={state.targetBlockedReason}
      onConfirm={state.onConfirm}
      onCancel={state.onCancel}
    />
  )
}

interface BodyProps {
  pending: AgentSendConfirmPending
  targetBlockedReason: string | null
  onConfirm: () => void
  onCancel: () => void
}

function AgentSendConfirmDialogBody({
  pending,
  targetBlockedReason,
  onConfirm,
  onCancel
}: BodyProps): React.JSX.Element {
  // 開いた時点のフォーカス(キャンセルで閉じたときの戻り先)。マウントの後では送信へ移っているため、描画の時点で控える。
  // 変数のフォームから開いた場合、ここで控えるフォームの実行ボタンはこの描画のコミットで外れる(戻すときに一覧の実行を探す)
  const [opener] = useState(() => document.activeElement)
  const dialogRef = useRef<HTMLDivElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const reasonId = useId()
  const targetId = useId()
  const unsavedId = useId()

  // 本文は最大 20 万字になりうるため、描画のたびに正規化し直さない
  const preview = useMemo(() => buildAgentSendPreview(pending.text), [pending.text])
  // 本文の理由はキャンセルして直すしかないため先に出す。1 つだけ出す
  const reason = preview.rejection ?? targetBlockedReason
  const isSubmitDisabled = reason !== null
  // 参照として添えたファイルの未保存の注意(送信は止めない)。実行を押した時点の写し
  const hasUnsaved = pending.unsavedPaths.length > 0
  // 開いたときのフォーカスは送信(送れない理由があるとキャンセル)なので、送り先・未保存の注意・送れない理由をこの順に説明として
  // 読ませる(本文は最大 20 万字になりうるので含めない)
  const describedBy = [targetId, hasUnsaved ? unsavedId : null, reason !== null ? reasonId : null]
    .filter((id): id is string => id !== null)
    .join(' ')

  const handleCancel = (): void => {
    findSendConfirmReturnTarget(opener, pending.promptId)?.focus()
    onCancel()
  }
  const handleConfirm = (): void => {
    if (!isSubmitDisabled) onConfirm()
  }
  // 実行をダブルクリックすると、1 回目で開いた確認に 2 回目の click が届く。狭いウィンドウでは 2 回目が送信・キャンセルの上に
  // 落ち、読む前に送られる・開いた直後に閉じて変数の値が失われる。連続のクリックの 2 回目以降(detail > 1)は押したとみなさない
  // (キーボードで押した click は detail が 0 なので影響しない)
  const ignoreRepeatedClick =
    (handler: () => void) =>
    (e: ReactMouseEvent): void => {
      if (e.detail > 1) return
      handler()
    }

  // 背景で押して離したときだけ閉じる(中と背景をまたぐドラッグでは閉じない。useOverlayDismiss)
  const overlayHandlers = useOverlayDismiss(handleCancel)
  // モーダルとして、Tab / Shift+Tab をダイアログの中(本文・送信・キャンセル)で回す(開いている間だけマウントする)
  useDialogFocusTrap(dialogRef, true)

  // 開いたら送信へ。送れない(押せない)ときはキャンセルへ。開いたときだけ
  useEffect(() => {
    const submit = submitRef.current
    if (submit !== null && !submit.disabled) submit.focus()
    else cancelRef.current?.focus()
  }, [])

  // 開いている間に送信を押せなくなった(送り先のセッションが終わった など)とき、フォーカスが送信に残る・body に落ちると
  // Esc がダイアログに届かないため、キャンセルへ移す
  useEffect(() => {
    if (!isSubmitDisabled) return
    const active = document.activeElement
    if (active === submitRef.current || active === document.body) cancelRef.current?.focus()
  }, [isSubmitDisabled])

  return (
    <div
      className="agent-send-confirm__overlay"
      role="presentation"
      {...overlayHandlers}
      onMouseDown={(e) => {
        // 背景はフォーカスできない要素なので、押すとフォーカスが body へ落ちて Esc が届かなくなる(右クリック・中クリックや、
        // 背景で押して中で離したときのように閉じない押し方で残る)。背景そのものの押下は既定の動作を止めてフォーカスを動かさない。
        // 閉じる判定(useOverlayDismiss)は target を記録するだけなので影響しない
        if (e.target === e.currentTarget) e.preventDefault()
        overlayHandlers.onMouseDown(e)
      }}
      onClick={(e) => {
        // 実行(変数のフォームの実行を含む)をダブルクリックすると、1 回目で開いた確認の背景に 2 回目の mousedown・mouseup・
        // click が届き、開いた直後に閉じてしまう。連続のクリックの 2 回目以降(detail > 1)は背景で閉じる操作とみなさない。
        // useOverlayDismiss の記録は次の mousedown・mouseup で上書きされるので、ここで捨てなくても次の判定に持ち越さない
        if (e.detail > 1) return
        overlayHandlers.onClick(e)
      }}
    >
      <div
        ref={dialogRef}
        className="agent-send-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        // ダイアログの中の文字・余白をクリックしたときも、フォーカスが body に落ちず Esc が届くようにする(Tab の順には入らない)
        tabIndex={-1}
        // 一覧の実行・変数のフォームで押した Enter を押し続けると、リピートの keydown が開いた直後の送信を押し、全文を読む前に
        // 送られる。ボタンの Enter・Space の既定の動作(押す)をリピートでは止める(本文の領域の Space のスクロールは止めない)
        onKeyDownCapture={(e) => {
          if (
            e.repeat &&
            (e.key === 'Enter' || e.key === ' ') &&
            e.target instanceof HTMLButtonElement
          ) {
            e.preventDefault()
          }
        }}
        onKeyDown={(e) => {
          // IME の変換を取り消す Esc では閉じない
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            handleCancel()
          }
        }}
      >
        <p id={titleId} className="agent-send-confirm__title">
          送信前の確認
        </p>
        <p id={targetId} className="agent-send-confirm__target">
          送り先: {pending.label}
        </p>
        {/* 読むだけ。長い本文は枠の中でスクロールし、Tab で止まってキーボードでもスクロールできる */}
        <pre className="agent-send-confirm__body" role="region" aria-label="送る内容" tabIndex={0}>
          {preview.text}
        </pre>
        <p className="agent-send-confirm__count">{LENGTH_FORMAT.format(preview.length)} 文字</p>
        {hasUnsaved && (
          <p id={unsavedId} className="agent-send-confirm__unsaved">
            {formatAgentUnsavedNotice(pending.unsavedPaths)}
          </p>
        )}
        {reason !== null && (
          <p id={reasonId} className="agent-send-confirm__reason" role="alert">
            {reason}
          </p>
        )}
        <div className="agent-send-confirm__actions">
          <button
            ref={submitRef}
            type="button"
            className="agent-send-confirm__submit"
            disabled={isSubmitDisabled}
            aria-describedby={reason !== null ? reasonId : undefined}
            onClick={ignoreRepeatedClick(handleConfirm)}
          >
            送信
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="agent-send-confirm__cancel"
            onClick={ignoreRepeatedClick(handleCancel)}
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}
