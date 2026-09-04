import { useCallback } from 'react'
import { useAppState } from './hooks/useAppState'
import ActivityBar from './components/ActivityBar'
import Sidebar from './components/Sidebar'
import EditorPanel from './components/EditorPanel'
import StatusBar from './components/StatusBar'
import QuickOpenDialog from './components/quick-open/QuickOpenDialog'
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
    deactivateDiffTab,
    diffContent,
    diffStaged,
    diffError,
    isHunkOperationInProgress,
    stageHunk,
    unstageHunk,
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

  // タブを開く操作(openDiffTab の呼び出し)と、diff 内容の取得(activeDiffTab の変化に対する
  // 反応、および実行中フラグ・エラー状態)は useDiffOperations(useAppState 経由)に分離する。
  // 以前は同じ関数内で両方行っていたため、
  // openDiffTab → activeDiffTab 更新(常に新しいオブジェクト参照) → 監視 effect 発火 →
  // handleOpenDiff が再度 openDiffTab を呼ぶ → … という無限ループが発生していた
  const handleOpenDiff = useCallback(
    (path: string, staged: boolean): void => {
      openDiffTab({ path, staged })
    },
    [openDiffTab]
  )

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
            onDeactivateDiffTab={deactivateDiffTab}
            diffContent={diffContent}
            diffStaged={diffStaged}
            diffError={diffError}
            isHunkOperationInProgress={isHunkOperationInProgress}
            onStageHunk={stageHunk}
            onUnstageHunk={unstageHunk}
          />
        </div>
      </div>
      <StatusBar />
      <QuickOpenDialog controller={quickOpen} />
    </>
  )
}
