import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { getApiKey } from '../apiKeyStore'
import { getModelSettings } from '../modelSettingsStore'
import { runPromptStream } from '../claudeService'
import { parseClaudePayload } from './claudePayloadParser'
import { registerCancellation } from '../cancellationRegistry'
import { createChunkSender, withCancellationCleanup } from './streamDelivery'

export function registerClaudeHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('claude:runPromptStream', async (event: IpcMainInvokeEvent, payload: unknown) => {
    const { requestId, promptContent, fileContent } = parseClaudePayload(payload)
    // 設定ファイルの読み込み(getApiKey/getModelSettings)は非同期I/Oのため、
    // その完了を待ってから登録するとその間のキャンセル要求が「未登録」として
    // 黙って無視される。キャンセルは最初の await より前に登録する。
    const controller = new AbortController()
    registerCancellation(requestId, () => controller.abort())
    return withCancellationCleanup(requestId, async () => {
      // getApiKey/getModelSettings は互いに依存しない独立したI/O(いずれも
      // settingsFileStore.readSettingsFile を個別に呼ぶ)なので並行実行する
      const [apiKey, modelSettings] = await Promise.all([getApiKey(), getModelSettings()])
      const trimmedKey = apiKey.trim()
      if (trimmedKey.length === 0) throw new Error('API キーが設定されていません')
      // 設定読み込み中にキャンセルされていたら API 呼び出し自体を行わない
      if (controller.signal.aborted) throw new Error('キャンセルされました')
      return runPromptStream(trimmedKey, promptContent, fileContent, {
        model: modelSettings.modelId,
        maxTokens: modelSettings.maxTokens,
        signal: controller.signal,
        onChunk: createChunkSender(event, requestId)
      })
    })
  })
}
