import { sidebarTitles, sidebarPlaceholders } from '../config/sidebarTitles'
import type { Panel } from '../types'
import PromptsPanel from './prompts/PromptsPanel'

interface Props {
  activePanel: Panel
}

export default function Sidebar({ activePanel }: Props) {
  return (
    <div className="sidebar">
      <div className="sidebar__header">{sidebarTitles[activePanel]}</div>
      {activePanel === 'prompts' ? (
        <PromptsPanel />
      ) : (
        <div className="sidebar__placeholder">{sidebarPlaceholders[activePanel]}</div>
      )}
    </div>
  )
}
