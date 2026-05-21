import { useState } from 'react'
import ActivityBar from './components/ActivityBar'
import Sidebar from './components/Sidebar'
import EditorPanel from './components/EditorPanel'
import StatusBar from './components/StatusBar'
import { Panel } from './types'

export default function App(): React.JSX.Element {
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

  return (
    <>
      <div className="ide-root">
        <ActivityBar activePanel={activePanel} onPanelChange={handlePanelChange} />
        <div className="ide-main">
          {sidebarOpen && <Sidebar activePanel={activePanel} />}
          <EditorPanel />
        </div>
      </div>
      <StatusBar />
    </>
  )
}
