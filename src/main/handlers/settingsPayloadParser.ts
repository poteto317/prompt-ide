import type { ModelId, ModelSettings } from '@shared/types'
import { AVAILABLE_MODELS } from '@shared/types'
import { assertPlainObject } from './payloadValidators'

export function parseModelSettingsPayload(payload: unknown): ModelSettings {
  assertPlainObject(payload)
  const { modelId, maxTokens } = payload

  if (typeof modelId !== 'string') {
    throw new Error('modelId は文字列である必要があります')
  }
  const modelIds = AVAILABLE_MODELS.map((m) => m.id) as readonly string[]
  if (!modelIds.includes(modelId)) {
    const allowed = AVAILABLE_MODELS.map((m) => `'${m.id}'`).join(' または ')
    throw new Error(`modelId は ${allowed} である必要があります（受け取った値: ${modelId}）`)
  }

  if (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens)) {
    throw new Error('maxTokens は整数である必要があります')
  }

  return { modelId: modelId as ModelId, maxTokens }
}
