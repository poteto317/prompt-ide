import type { ComponentType } from 'react'
import ExplorerIcon from '../components/icons/ExplorerIcon'
import GitIcon from '../components/icons/GitIcon'
import PromptIcon from '../components/icons/PromptIcon'
import ProgressIcon from '../components/icons/ProgressIcon'
import SettingsIcon from '../components/icons/SettingsIcon'
import type { Panel } from '../types'

export interface ActivityBarPanel {
  panel: Panel
  Icon: ComponentType
  title: string
}

export const activityBarPanels: ActivityBarPanel[] = [
  { panel: 'explorer', Icon: ExplorerIcon, title: 'エクスプローラー' },
  { panel: 'source-control', Icon: GitIcon, title: 'ソース管理' },
  { panel: 'prompts', Icon: PromptIcon, title: 'プロンプト' },
  { panel: 'progress', Icon: ProgressIcon, title: '進捗管理' },
  { panel: 'settings', Icon: SettingsIcon, title: '設定' }
]
