import type {
  AgentNotificationActivated,
  AgentNotificationDismissRequest,
  AgentNotificationShowRequest
} from '@shared/types'

// エージェントの通知の IPC の窓口(window.api)。renderer の部品は window.api を直接触らずここを使う

export function showAgentNotification(request: AgentNotificationShowRequest): Promise<void> {
  return window.api.showAgentNotification(request)
}

export function setAgentNotificationBadge(count: number): Promise<void> {
  return window.api.setAgentNotificationBadge(count)
}

export function dismissAgentNotification(request: AgentNotificationDismissRequest): Promise<void> {
  return window.api.dismissAgentNotification(request)
}

export function onAgentNotificationActivated(
  listener: (payload: AgentNotificationActivated) => void
): () => void {
  return window.api.onAgentNotificationActivated(listener)
}
