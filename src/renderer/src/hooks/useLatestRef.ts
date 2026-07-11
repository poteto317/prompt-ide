import { useLayoutEffect, useRef, type RefObject } from 'react'

export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  // useEffect だとコミット後〜エフェクト実行までの間 ref.current が1レンダー
  // 古い値のままになる。この間にユーザー操作（Cmd/Ctrl+S 等、EditorPanel.tsx の
  // onSaveRef 経由）が挟まると、古いクロージャ（古い openFile/content を
  // 閉じ込めた関数）が呼ばれてしまう可能性があるため、ブラウザが描画・ユーザー
  // 操作を処理する前に同期的に実行される useLayoutEffect で確実に最新化する。
  useLayoutEffect(() => {
    ref.current = value
  }, [value])
  return ref
}
