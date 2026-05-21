import PromptsPanel from './prompts/PromptsPanel'
import { sidebarTitles, sidebarPlaceholders } from '../config/sidebarTitles'
import type { Panel } from '../types'

interface Props {
  activePanel: Panel
}

export default function Sidebar({ activePanel }: Props) {
  return (
    <div className="sidebar">
      <div className="sidebar__header">{sidebarTitles[activePanel]}</div>
      {/*
        PromptsPanel は常時マウントして usePrompts の state を維持する。
        activePanel に応じて表示/非表示のみ切り替える。
      */}
      <div
        className={
          activePanel === 'prompts'
            ? 'sidebar__panel'
            : 'sidebar__panel sidebar__panel--hidden'
        }
      >
        <PromptsPanel />
      </div>
      {activePanel !== 'prompts' && (
        <div className="sidebar__placeholder">{sidebarPlaceholders[activePanel]}</div>
      )}
    </div>
  )
}
