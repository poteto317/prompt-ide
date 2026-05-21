import { usePanelState } from './hooks/usePanelState'
import ActivityBar from './components/ActivityBar'
import Sidebar from './components/Sidebar'
import EditorPanel from './components/EditorPanel'
import StatusBar from './components/StatusBar'

export default function App(): React.JSX.Element {
  const { activePanel, sidebarOpen, handlePanelChange } = usePanelState()

  return (
    <>
      <div className="ide-root">
        <ActivityBar activePanel={activePanel} sidebarOpen={sidebarOpen} onPanelChange={handlePanelChange} />
        <div className="ide-main">
          {sidebarOpen && <Sidebar activePanel={activePanel} />}
          <EditorPanel />
        </div>
      </div>
      <StatusBar />
    </>
  )
}
