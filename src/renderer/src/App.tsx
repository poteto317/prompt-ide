import { useCallback } from 'react'
import { useAppState } from './hooks/useAppState'
import ActivityBar from './components/ActivityBar'
import Sidebar from './components/Sidebar'
import EditorPanel from './components/EditorPanel'
import StatusBar from './components/StatusBar'

export default function App(): React.JSX.Element {
  const {
    activePanel,
    sidebarOpen,
    handlePanelChange,
    folderPath,
    fileTree,
    openFile,
    error,
    openFolder,
    selectFile,
    prompts,
    addPrompt,
    deletePrompt,
    updatePrompt,
    reorderPrompts,
    togglePromptPin,
    tasks,
    addTask,
    deleteTask,
    recordEvent,
    completeStage,
    reopenStage,
    skipStage,
    advanceStage,
    gitStatus,
    gitLoading,
    gitError,
    refreshGitStatus,
    hasKey,
    apiKeyLoaded,
    keyStoreError,
    saveApiKey,
    isExecuting,
    result,
    executionError,
    executePrompt,
    clearResult
  } = useAppState()

  const handleRunPrompt = useCallback(
    (content: string) => executePrompt(content, openFile?.content ?? null),
    [executePrompt, openFile]
  )

  return (
    <>
      <div className="ide-root">
        <ActivityBar
          activePanel={activePanel}
          sidebarOpen={sidebarOpen}
          onPanelChange={handlePanelChange}
        />
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
              onEditPrompt={updatePrompt}
              onReorderPrompt={reorderPrompts}
              onTogglePromptPin={togglePromptPin}
              onRunPrompt={handleRunPrompt}
              isExecuting={isExecuting}
              tasks={tasks}
              onAddTask={addTask}
              onDeleteTask={deleteTask}
              onRecordEvent={recordEvent}
              onCompleteStage={completeStage}
              onReopenStage={reopenStage}
              onSkipStage={skipStage}
              onAdvanceStage={advanceStage}
              gitStatus={gitStatus}
              gitLoading={gitLoading}
              gitError={gitError}
              onRefreshGitStatus={refreshGitStatus}
              hasKey={hasKey}
              apiKeyLoaded={apiKeyLoaded}
              keyStoreError={keyStoreError}
              onSaveApiKey={saveApiKey}
            />
          )}
          <EditorPanel
            openFile={openFile}
            isExecuting={isExecuting}
            result={result}
            executionError={executionError}
            onClearResult={clearResult}
          />
        </div>
      </div>
      <StatusBar />
    </>
  )
}
