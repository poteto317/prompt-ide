import type {
  AgentCliKind,
  AgentCliKindSetting,
  ModelSettings,
  PromptExecutionMode,
  PromptListMode
} from '@shared/types'

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

export function getPromptListMode(): Promise<PromptListMode> {
  return window.api.getPromptListMode()
}

export function setPromptListMode(mode: PromptListMode): Promise<void> {
  return window.api.setPromptListMode(mode)
}

export function getAgentNotificationsEnabled(): Promise<boolean> {
  return window.api.getAgentNotificationsEnabled()
}

export function setAgentNotificationsEnabled(enabled: boolean): Promise<void> {
  return window.api.setAgentNotificationsEnabled(enabled)
}

export function getAgentSendConfirmEnabled(): Promise<boolean> {
  return window.api.getAgentSendConfirmEnabled()
}

export function setAgentSendConfirmEnabled(enabled: boolean): Promise<void> {
  return window.api.setAgentSendConfirmEnabled(enabled)
}

export function getAgentCliKind(): Promise<AgentCliKindSetting> {
  return window.api.getAgentCliKind()
}

export function setAgentCliKind(kind: AgentCliKind): Promise<void> {
  return window.api.setAgentCliKind(kind)
}
