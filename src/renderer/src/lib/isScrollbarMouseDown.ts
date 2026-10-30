// スクロールバー上の mousedown か。既定動作を止めるとドラッグできなくなる。
// jsdom などレイアウトを持たない環境では各値が 0 になり false を返す。
// overflow-y: auto は横方向も auto として計算されるため、長い名前では
// 下側に横スクロールバーが出る。縦横どちらも見る
export function isScrollbarMouseDown(e: React.MouseEvent): boolean {
  const target = e.target
  if (!(target instanceof HTMLElement)) return false
  const rect = target.getBoundingClientRect()
  // clientWidth/clientHeight はスクロールバーを含まないため、その外側なら操作対象
  const onVerticalBar =
    target.scrollHeight > target.clientHeight && e.clientX - rect.left > target.clientWidth
  const onHorizontalBar =
    target.scrollWidth > target.clientWidth && e.clientY - rect.top > target.clientHeight
  return onVerticalBar || onHorizontalBar
}
