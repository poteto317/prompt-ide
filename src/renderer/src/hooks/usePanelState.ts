import { useState } from 'react'
import type { Panel } from '../types'

interface PanelState {
  activePanel: Panel
  sidebarOpen: boolean
  handlePanelChange: (panel: Panel) => void
  /** パネルを切り替えて開く(同じパネルでも閉じない。ターミナルの帯の「変更を確認」から使う) */
  showPanel: (panel: Panel) => void
}

export function usePanelState(): PanelState {
  const [activePanel, setActivePanel] = useState<Panel>('explorer')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const handlePanelChange = (panel: Panel): void => {
    if (activePanel === panel) {
      setSidebarOpen((prev) => !prev)
    } else {
      setActivePanel(panel)
      setSidebarOpen(true)
    }
  }

  const showPanel = (panel: Panel): void => {
    setActivePanel(panel)
    setSidebarOpen(true)
  }

  return { activePanel, sidebarOpen, handlePanelChange, showPanel }
}
