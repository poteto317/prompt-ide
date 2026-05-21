import { sidebarTitles, sidebarPlaceholders } from '../config/sidebarTitles'
import { Panel } from '../types'

interface Props {
  activePanel: Panel
}

export default function Sidebar({ activePanel }: Props) {
  return (
    <div className="sidebar">
      <div className="sidebar__header">{sidebarTitles[activePanel]}</div>
      <div className="sidebar__placeholder">{sidebarPlaceholders[activePanel]}</div>
    </div>
  )
}
