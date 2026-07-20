import type { ModelSettings } from '@shared/types'

export function getModelSettings(): Promise<ModelSettings> {
  return window.api.getModelSettings()
}

export function setModelSettings(settings: ModelSettings): Promise<void> {
  return window.api.setModelSettings(settings)
}
