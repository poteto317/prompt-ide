import { useState } from 'react'
import { Panel } from '../types'

interface PanelState {
  activePanel: Panel
  sidebarOpen: boolean
  handlePanelChange: (panel: Panel) => void
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

  return { activePanel, sidebarOpen, handlePanelChange }
}
