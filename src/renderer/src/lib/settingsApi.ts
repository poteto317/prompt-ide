import type { ModelSettings, PromptExecutionMode } from '@shared/types'

export function getModelSettings(): Promise<ModelSettings> {
  return window.api.getModelSettings()
}

export function setModelSettings(settings: ModelSettings): Promise<void> {
  return window.api.setModelSettings(settings)
}

export function getPromptExecutionMode(): Promise<PromptExecutionMode> {
  return window.api.getPromptExecutionMode()
}

export function setPromptExecutionMode(mode: PromptExecutionMode): Promise<void> {
  return window.api.setPromptExecutionMode(mode)
}

export function getAgentNotificationsEnabled(): Promise<boolean> {
  return window.api.getAgentNotificationsEnabled()
}

export function setAgentNotificationsEnabled(enabled: boolean): Promise<void> {
  return window.api.setAgentNotificationsEnabled(enabled)
}
