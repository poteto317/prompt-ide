import type { IpcMainInvokeEvent } from 'electron'
import { unregisterCancellation } from '../cancellationRegistry'

// レンダラのリロード等で送信先が消えた後に send するとクラッシュするため必ずチェックする
export function createChunkSender(
  event: IpcMainInvokeEvent,
  requestId: string
): (chunk: string) => void {
  return (chunk: string) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('prompt:streamChunk', { requestId, chunk })
    }
  }
}

// キャンセルの登録解除を、成功・失敗いずれの経路でも確実に行う
export async function withCancellationCleanup<T>(
  requestId: string,
  task: () => Promise<T>
): Promise<T> {
  try {
    return await task()
  } finally {
    unregisterCancellation(requestId)
  }
}
