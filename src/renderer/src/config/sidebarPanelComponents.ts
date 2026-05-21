import type { ComponentType } from 'react'
import type { Panel } from '../types'
import PromptsPanel from '../components/prompts/PromptsPanel'

export const sidebarPanelComponents: Partial<Record<Panel, ComponentType>> = {
  prompts: PromptsPanel,
}
