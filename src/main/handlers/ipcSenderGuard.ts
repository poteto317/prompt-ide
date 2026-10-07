// IPC の送信元の確認。どの受け口でも使える汎用の規則なので、特定の機能のパーサーではなくここに置く

/** 送信元がトップのフレーム(そのウィンドウのメインフレーム)か。iframe などのサブフレームからの依頼は受け付けない */
export function isMainFrameSender(event: { senderFrame: { parent: unknown } | null }): boolean {
  return event.senderFrame !== null && event.senderFrame.parent === null
}
