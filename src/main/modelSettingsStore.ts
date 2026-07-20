import type { ModelSettings } from '@shared/types'
import { AVAILABLE_MODELS, DEFAULT_MODEL_SETTINGS } from '@shared/types'
import { readSettingsFile, writeSettingsFile } from './settingsFileStore'

function findModel(modelId: string | undefined): (typeof AVAILABLE_MODELS)[number] | undefined {
  return AVAILABLE_MODELS.find((m) => m.id === modelId)
}

export async function getModelSettings(): Promise<ModelSettings> {
  const data = await readSettingsFile()
  const model = findModel(data.modelId)
  if (!model) return DEFAULT_MODEL_SETTINGS

  const maxTokens = data.maxTokens
  if (
    typeof maxTokens !== 'number' ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > model.maxOutputTokens
  ) {
    return DEFAULT_MODEL_SETTINGS
  }

  return { modelId: model.id, maxTokens }
}

export async function setModelSettings(settings: ModelSettings): Promise<void> {
  const model = findModel(settings.modelId)
  if (!model) {
    throw new Error(`不明なモデルです: ${settings.modelId}`)
  }
  if (
    !Number.isInteger(settings.maxTokens) ||
    settings.maxTokens < 1 ||
    settings.maxTokens > model.maxOutputTokens
  ) {
    throw new Error(`max_tokens は 1〜${model.maxOutputTokens} の整数である必要があります`)
  }
  await writeSettingsFile({ modelId: settings.modelId, maxTokens: settings.maxTokens })
}
