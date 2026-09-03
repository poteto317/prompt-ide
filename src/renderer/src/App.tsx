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
  // ハンクのステージ/アンステージ後に同じ activeDiffTab のまま diff を再取得させるための
  // 明示的なトリガー。activeDiffTab 自体は変わらないため、依存配列に activeDiffTab だけを
  // 置いた effect では変化を検知できない
  const [diffRefreshSignal, setDiffRefreshSignal] = useState(0)

  // タブを開く操作(openDiffTab の呼び出し)と、diff 内容の取得(activeDiffTab の変化に対する
  // 反応)を分離する。以前は同じ関数内で両方行っていたため、
  // openDiffTab → activeDiffTab 更新(常に新しいオブジェクト参照) → 監視 effect 発火 →
  // handleOpenDiff が再度 openDiffTab を呼ぶ → … という無限ループが発生していた
  const handleOpenDiff = useCallback(
    (path: string, staged: boolean): void => {
      openDiffTab({ path, staged })
    },
    [openDiffTab]
  )

  useEffect(() => {
    if (activeDiffTab === null) return
    // タブ切替中に古い fetch が後から解決しても、現在のタブの表示を上書きしないよう
    // cancelled フラグで無効化する
    let cancelled = false
    void (async (): Promise<void> => {
      const content = await gitApi.getDiff(activeDiffTab.path, activeDiffTab.staged)
      if (cancelled) return
      setDiffContent(content)
      setDiffStaged(activeDiffTab.staged)
    })()
    return () => {
      cancelled = true
    }
  }, [activeDiffTab, diffRefreshSignal])

  const handleStageHunk = async (patch: string): Promise<void> => {
    if (activeDiffTab === null) return
    await gitApi.stageHunk(activeDiffTab.path, patch)
    await refreshGitStatus()
    // diff の再取得は上の effect に一任する(stale closure による古いタブの上書きを防ぐため)
    setDiffRefreshSignal((n) => n + 1)
  }

  const handleUnstageHunk = async (patch: string): Promise<void> => {
    if (activeDiffTab === null) return
    await gitApi.unstageHunk(activeDiffTab.path, patch)
    await refreshGitStatus()
    setDiffRefreshSignal((n) => n + 1)
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
