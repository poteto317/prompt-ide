import { useRef } from 'react'
import type React from 'react'

interface OverlayDismissHandlers {
  onMouseDown: (e: React.MouseEvent<HTMLElement>) => void
  onMouseUp: (e: React.MouseEvent<HTMLElement>) => void
  onClick: (e: React.MouseEvent<HTMLElement>) => void
}

// ダイアログのオーバーレイのクリックで閉じる。押したのも離したのもオーバーレイ自体のときだけ onDismiss を呼ぶ。
// 押した要素と離した要素が違うと、Chromium は両者に共通する祖先(オーバーレイ)へ click を送る。ダイアログの中
// (入力欄で長い URL をドラッグ選択するなど)で押してオーバーレイで離した場合も、オーバーレイで押してダイアログの中で
// 離した場合も(Electron の sendInputEvent で確認)、click の target はオーバーレイになる。ダイアログ側の
// stopPropagation はこの経路に入らないため、click だけで判定すると閉じて入力が消える。そのため押下(mousedown)と
// 離した位置(mouseup)の target をそれぞれ記録し、click で両方を見る。記録は click ごとに捨て、次の click に
// 持ち越さない。RemoteSetupInputDialog・CreateTagDialog で共通(パターン 55・88)。
// 実行中に閉じさせない判定は onDismiss(各ダイアログの requestCancel)が持つ
export function useOverlayDismiss(onDismiss: () => void): OverlayDismissHandlers {
  const pressedOnOverlayRef = useRef(false)
  const releasedOnOverlayRef = useRef(false)
  return {
    onMouseDown: (e) => {
      pressedOnOverlayRef.current = e.target === e.currentTarget
    },
    onMouseUp: (e) => {
      releasedOnOverlayRef.current = e.target === e.currentTarget
    },
    onClick: (e) => {
      const shouldDismiss =
        pressedOnOverlayRef.current && releasedOnOverlayRef.current && e.target === e.currentTarget
      pressedOnOverlayRef.current = false
      releasedOnOverlayRef.current = false
      if (shouldDismiss) onDismiss()
    }
  }
}
