import { useAppState } from './hooks/useAppState'
import ActivityBar from './components/ActivityBar'
import Sidebar from './components/Sidebar'
import EditorPanel from './components/EditorPanel'
import StatusBar from './components/StatusBar'

export default function App(): React.JSX.Element {
  const {
    activePanel, sidebarOpen, handlePanelChange,
    folderPath, fileTree, openFile, error, openFolder, selectFile,
    prompts, addPrompt, deletePrompt,
  } = useAppState()

  return (
    <>
      <div className="ide-root">
        <ActivityBar activePanel={activePanel} sidebarOpen={sidebarOpen} onPanelChange={handlePanelChange} />
        <div className="ide-main">
          {sidebarOpen && (
            <Sidebar
              activePanel={activePanel}
              folderPath={folderPath}
              fileTree={fileTree}
              openFilePath={openFile?.path ?? null}
              onOpenFolder={openFolder}
              onSelectFile={selectFile}
              error={error}
              prompts={prompts}
              onAddPrompt={addPrompt}
              onDeletePrompt={deletePrompt}
            />
          )}
          <EditorPanel openFile={openFile} />
        </div>
      </div>
      <StatusBar />
    </>
  )
}
