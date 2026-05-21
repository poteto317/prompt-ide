import ExplorerIcon from '../components/icons/ExplorerIcon'
import GitIcon from '../components/icons/GitIcon'
import PromptIcon from '../components/icons/PromptIcon'
import { Panel } from '../types'

export interface ActivityBarPanel {
  panel: Panel
  Icon: React.ComponentType
  title: string
}

export const activityBarPanels: ActivityBarPanel[] = [
  { panel: 'explorer', Icon: ExplorerIcon, title: 'エクスプローラー' },
  { panel: 'source-control', Icon: GitIcon, title: 'ソース管理' },
  { panel: 'prompts', Icon: PromptIcon, title: 'プロンプト' },
]
