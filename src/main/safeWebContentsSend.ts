import { webContents } from 'electron'
import type { WebContents } from 'electron'

// 破棄済みかもしれない webContents へ安全に送る。破棄済みの webContents の send は例外になり、監視や pty のコールバック
// (node-pty の emitter など)から投げると未処理例外になるため、isDestroyed の確認に加え、確認と送信の間の破棄の競合で
// 投げる例外も握りつぶす(届かない通知は捨ててよい)

/** isDestroyed が例外を投げたら破棄済みとみなす */
export function isDestroyedSafely(target: Pick<WebContents, 'isDestroyed'>): boolean {
  try {
    return target.isDestroyed()
  } catch {
    return true
  }
}

export function sendSafely(
  target: Pick<WebContents, 'isDestroyed' | 'send'>,
  channel: string,
  payload: unknown
): void {
  try {
    if (!target.isDestroyed()) target.send(channel, payload)
  } catch {
    // 送信先が無くなった通知は捨てる
  }
}

/** 所有者(webContents の id)へ送る。見つからない・破棄済みなら送らない */
export function sendToOwner(ownerId: number, channel: string, payload: unknown): void {
  try {
    const target = webContents.fromId(ownerId)
    if (target !== undefined) sendSafely(target, channel, payload)
  } catch {
    // 送信先が無くなった通知は捨てる
  }
}
