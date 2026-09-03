import { useState, useCallback, useEffect } from 'react'
import { useAppState } from './hooks/useAppState'
import ActivityBar from './components/ActivityBar'
import Sidebar from './components/Sidebar'
import EditorPanel from './components/EditorPanel'
import StatusBar from './components/StatusBar'
import QuickOpenDialog from './components/quick-open/QuickOpenDialog'
import * as gitApi from './lib/gitApi'
import * as fileSystemApi from './lib/fileSystemApi'
import type { FileTreeNode } from './types'

export default function App(): React.JSX.Element {
  const {
    activePanel,
    sidebarOpen,
    handlePanelChange,
    folderPath,
    fileTree,
    openFile,
    openFiles,
    activeFilePath,
    openedFileSignal,
    isDirty,
    isSaving,
    error,
    saveError,
    openFolder,
    selectFile,
    activateTab,
    closeTab,
    reorderTabs,
    updateFileContent,
    saveFile,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry,
    prompts,
    addPrompt,
    deletePrompt,
    updatePrompt,
    reorderPrompts,
    togglePromptPin,
    exportPrompts,
    importPrompts,
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
    stagingPaths,
    stageFile,
    unstageFile,
    isCommitting,
    commit,
    operationError,
    diffTabs,
    activeDiffTab,
    openDiffTab,
    closeDiffTab,
    activateDiffTab,
    amend,
    log,
    branches,
    tags,
    hasMore,
    isLoading: isLoadingHistory,
    loadMore,
    refresh: refreshHistory,
    hasKey,
    apiKeyLoaded,
    keyStoreError,
    saveApiKey,
    modelSettings,
    modelSettingsLoaded,
    saveModelSettings,
    isExecuting,
    result,
    streamingText,
    executionError,
    clearResult,
    cancelExecution,
    history,
    deleteHistoryEntry,
    clearHistory,
    runPrompt,
    rerunHistoryEntry,
    quickOpen
  } = useAppState()

  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [diffStaged, setDiffStaged] = useState(false)

  const handleOpenDiff = useCallback(
    async (path: string, staged: boolean): Promise<void> => {
      openDiffTab({ path, staged })
      const content = await gitApi.getDiff(path, staged)
      setDiffContent(content)
      setDiffStaged(staged)
    },
    [openDiffTab]
  )

  useEffect(() => {
    if (activeDiffTab === null) return
    // diff 内容の取得は activeDiffTab の変更を起点とする外部システム(git)との
    // 同期であり、取得結果を setState する正当なデータフェッチパターンのため抑制する
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void handleOpenDiff(activeDiffTab.path, activeDiffTab.staged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDiffTab])

  const handleStageHunk = async (patch: string): Promise<void> => {
    if (activeDiffTab === null) return
    await gitApi.stageHunk(activeDiffTab.path, patch)
    await refreshGitStatus()
    const content = await gitApi.getDiff(activeDiffTab.path, activeDiffTab.staged)
    setDiffContent(content)
  }

  const handleUnstageHunk = async (patch: string): Promise<void> => {
    if (activeDiffTab === null) return
    await gitApi.unstageHunk(activeDiffTab.path, patch)
    await refreshGitStatus()
    const content = await gitApi.getDiff(activeDiffTab.path, activeDiffTab.staged)
    setDiffContent(content)
  }

  const handleCommit = async (message: string): Promise<boolean> => {
    const succeeded = await commit(message)
    if (succeeded) void refreshHistory()
    return succeeded
  }

  const handleAmend = async (message: string): Promise<boolean> => {
    const succeeded = await amend(message)
    if (succeeded) void refreshHistory()
    return succeeded
  }

  const handleAddToGitignore = (node: FileTreeNode): void => {
    void fileSystemApi.addToGitignore(node.path)
  }

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
              onCreateFile={createFile}
              onCreateDirectory={createDirectory}
              onRenameEntry={renameEntry}
              onDeleteEntry={deleteEntry}
              prompts={prompts}
              onAddPrompt={addPrompt}
              onDeletePrompt={deletePrompt}
              onEditPrompt={updatePrompt}
              onReorderPrompt={reorderPrompts}
              onTogglePromptPin={togglePromptPin}
              onExportPrompts={exportPrompts}
              onImportPrompts={importPrompts}
              onRunPrompt={runPrompt}
              isExecuting={isExecuting}
              tasks={tasks}
              onAddTask={addTask}
              onDeleteTask={deleteTask}
              onRecordEvent={recordEvent}
              onCompleteStage={completeStage}
              onReopenStage={reopenStage}
              onSkipStage={skipStage}
              onAdvanceStage={advanceStage}
              history={history}
              onDeleteHistoryEntry={deleteHistoryEntry}
              onClearHistory={clearHistory}
              onRerunHistoryEntry={rerunHistoryEntry}
              gitStatus={gitStatus}
              gitLoading={gitLoading}
              gitError={gitError}
              onRefreshGitStatus={refreshGitStatus}
              stagingPaths={stagingPaths}
              onStageFile={stageFile}
              onUnstageFile={unstageFile}
              isCommitting={isCommitting}
              onCommit={handleCommit}
              gitOperationError={operationError}
              onOpenDiff={handleOpenDiff}
              onAmend={handleAmend}
              lastCommitMessage={log[0]?.message ?? null}
              log={log}
              branches={branches}
              tags={tags}
              hasMoreLog={hasMore}
              isLoadingLog={isLoadingHistory}
              onLoadMoreLog={loadMore}
              onAddToGitignore={handleAddToGitignore}
              hasKey={hasKey}
              apiKeyLoaded={apiKeyLoaded}
              keyStoreError={keyStoreError}
              onSaveApiKey={saveApiKey}
              modelSettings={modelSettings}
              modelSettingsLoaded={modelSettingsLoaded}
              onSaveModelSettings={saveModelSettings}
            />
          )}
          <EditorPanel
            openFiles={openFiles}
            activeFilePath={activeFilePath}
            isDirty={isDirty}
            isSaving={isSaving}
            saveError={saveError}
            onChangeContent={updateFileContent}
            onSave={saveFile}
            onActivateTab={activateTab}
            onCloseTab={closeTab}
            onReorderTabs={reorderTabs}
            isExecuting={isExecuting}
            result={result}
            streamingText={streamingText}
            executionError={executionError}
            onClearResult={clearResult}
            onCancelExecution={cancelExecution}
            isOverlayOpen={quickOpen.isOpen}
            openedFileSignal={openedFileSignal}
            diffTabs={diffTabs}
            activeDiffTab={activeDiffTab}
            onActivateDiffTab={activateDiffTab}
            onCloseDiffTab={closeDiffTab}
            diffContent={diffContent}
            diffStaged={diffStaged}
            onStageHunk={handleStageHunk}
            onUnstageHunk={handleUnstageHunk}
          />
        </div>
      </div>
      <StatusBar />
      <QuickOpenDialog controller={quickOpen} />
    </>
  )
}
