// ボタンのように「押す」操作として扱うキー(Enter と Space)。ネイティブの button と同じキーで、
// role="treeitem"・role="tab" などの div を押せるようにするときや、ボタンの既定の動作をリピートで止めるときに使う。
// KeyboardEvent.key の値で比べる(Space は ' '。'Spacebar' は古いブラウザの値で、Electron の Chromium は返さない)

/** key が Enter か Space(押す操作のキー)か */
export function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' '
}
