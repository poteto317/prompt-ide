import { sidebarTitles, sidebarPlaceholders } from '../config/sidebarTitles'
import { sidebarPanelComponents } from '../config/sidebarPanelComponents'
import type { Panel } from '../types'

interface Props {
  activePanel: Panel
}

export default function Sidebar({ activePanel }: Props) {
  const PanelComponent = sidebarPanelComponents[activePanel]
  return (
    <div className="sidebar">
      <div className="sidebar__header">{sidebarTitles[activePanel]}</div>
      {PanelComponent ? (
        <PanelComponent />
      ) : (
        <div className="sidebar__placeholder">{sidebarPlaceholders[activePanel]}</div>
      )}
    </div>
  )
}
