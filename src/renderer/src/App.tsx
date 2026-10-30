import { useCallback, useState } from 'react'
import { useAppState } from './hooks/useAppState'
import { useOnChange } from './hooks/useOnChange'
import { useLatestRef } from './hooks/useLatestRef'
import ActivityBar from './components/ActivityBar'
import Sidebar from './components/Sidebar'
import EditorPanel from './components/EditorPanel'
import StatusBar from './components/StatusBar'
import AgentAnnouncer from './components/agent/AgentAnnouncer'
import AgentSendConfirmDialog from './components/agent/AgentSendConfirmDialog'
import QuickOpenDialog from './components/quick-open/QuickOpenDialog'
import * as fileSystemApi from './lib/fileSystemApi'
import { toError } from './lib/errorUtils'
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
    refreshTree,
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
    isLocked,
    isAnyLocked,
    stageFile,
    discardFile,
    unstageFile,
    isCommitting,
    commit,
    operationError,
    isPushing,
    isPulling,
    isFetching,
    isPushBlocked,
    isPullBlocked,
    isRemoteOperationDisabled,
    push,
    pull,
    fetchRemote,
    syncChanges,
    isSyncing,
    isSyncBlocked,
    remoteOperationError,
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
    isActiveFileUntracked,
    stageHunk,
    unstageHunk,
    discardHunk,
    canDiscardHunk,
    amend,
    log,
    branches,
    tags,
    headCommitMessage,
    hasMore,
    isLoading: isLoadingHistory,
    isLoadingFolder,
    historyError,
    loadMore,
    refresh: refreshHistory,
    pendingBranchOperation,
    checkoutBranch,
    createBranch,
    deleteBranch,
    mergeBranch,
    stash,
    discardAll,
    mergeState,
    gitTag,
    remoteSetup,
    clone,
    conflictFile,
    isActiveFileConflicted,
    branchOperationError,
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
    getHistoryActions,
    onResume,
    quickOpen,
    executionModePanel,
    agentNotificationPanel,
    agentSendConfirmPanel,
    agentCliKindPanel,
    agentSendConfirmDialog,
    promptRun,
    bottomPanel,
    agentTerminal,
    statusBarAgent,
    agentAnnouncement,
    externalChangeBanner,
    attachEditorSelection,
    agentReferences,
    agentReferenceAnnouncement,
    promptListMode,
    agentChangesPanel,
    agentDiffActions,
    agentChangesReview
  } = useAppState()

  // タブを開く操作(openDiffTab の呼び出し)と、diff 内容の取得(activeDiffTab の変化に対する
  // 反応、および実行中フラグ・エラー状態)は useDiffOperations(useAppState 経由)に分離する。
  // 以前は同じ関数内で両方行っていたため、
  // openDiffTab → activeDiffTab 更新(常に新しいオブジェクト参照) → 監視 effect 発火 →
  // handleOpenDiff が再度 openDiffTab を呼ぶ → … という無限ループが発生していた
  const handleOpenDiff = useCallback(
    (path: string, staged: boolean): void => {
      openDiffTab({ path, kind: staged ? 'staged' : 'unstaged' })
    },
    [openDiffTab]
  )

  // commit()/amend() には refreshHistory を extraRefresh として渡す。
  // useGitOperations 側で refreshGitStatus(git status)と並列に実行され、
  // 両方完了するまで isCommitting が true のまま保たれるため、
  // 「commit() 完了後に別のフラグで後処理中を保護する」という二重管理が不要になる。
  // isCommitting だけで、コミットボタンの再クリックによる二重実行
  // (amend の場合は古いコミットメッセージのプリフィルも)を防げる
  const handleCommit = (message: string): Promise<boolean> => commit(message, refreshHistory)

  const handleAmend = (message: string): Promise<boolean> => amend(message, refreshHistory)

  // ソース管理の「更新」。端末でのコミットや fetch を反映するため、Git の状態と履歴の両方を
  // 取り直す。片方の失敗で他方を止めないよう、それぞれ独立に走らせる
  const handleRefreshSourceControl = (): void => {
    void Promise.allSettled([refreshGitStatus(), refreshHistory()])
  }

  // フォルダ/ファイル読み込み系の error(useFileSystem 由来)とは別スロットにする。
  // 共有すると、フォルダ読み込みエラー表示中に gitignore 追加が失敗した場合(逆も)、
  // 片方が他方の表示を上書きし気づかれないまま消えてしまう
  const [gitignoreError, setGitignoreError] = useState<Error | null>(null)

  // フォルダを切り替えたら前のフォルダのエラー表示は消す。残すと、フォルダ A で
  // .gitignore 追加に失敗(権限エラー・シンボリックリンク拒否等)した後に B を
  // 開いても、B のエクスプローラーに A のパスを含むエラーが出たままになる。
  // useFileSystem の error は openFolder 内で明示的にクリアされており、
  // gitignoreError だけがその扱いから漏れていた。
  // 初回マウントは folderPath の「変化」ではないため、実際に変わった場合のみ行う
  useOnChange(folderPath, () => {
    setGitignoreError(null)
  })
  // handleAddToGitignore は非同期処理の途中で folderPath が別フォルダへ
  // 切り替わったかを判定する必要があるが、handleAddToGitignore 自体は毎レンダー
  // 再生成される通常の関数のため、await 後に読む時点では folderPath の最新値を
  // ref 経由で確認する(useGitHistory.ts の loadMore/refresh と同じパターン)
  const folderPathRef = useLatestRef(folderPath)

  const handleAddToGitignore = (node: FileTreeNode): void => {
    const requestedFolderPath = folderPath
    void (async () => {
      try {
        await fileSystemApi.addToGitignore(node.path)
        if (folderPathRef.current === requestedFolderPath) {
          setGitignoreError(null)
        }
      } catch (err) {
        // addToGitignore の実行中に別フォルダへ切り替えられていたら、この
        // エラーは既に無関係になった旧フォルダのものなので、現在の画面には
        // 反映しない。反映すると、切り替え先の無関係なフォルダの
        // エクスプローラーに古いフォルダのエラーが表示されてしまう
        if (folderPathRef.current === requestedFolderPath) {
          setGitignoreError(toError(err))
        }
        // 書き込みに失敗しているので、以降の再取得は行わない
        return
      }
      // ここから先は .gitignore への書き込みが成功した後の後片付け。
      // 失敗しても「.gitignore への追加が失敗した」わけではないので
      // gitignoreError には流さない(refreshGitStatus は自身の gitError、
      // refreshTree は自身の folderLoadError スロットで既に報告している)。
      // 混ぜると、書き込みは成功しているのにエクスプローラーへ追加失敗の
      // エラーが出て、ユーザーが再実行してしまう。
      //
      // 未追跡ファイルは .gitignore 追加によって追跡対象外になる。refreshGitStatus を
      // 呼ばないと、別の stage/unstage 操作等で git status が再取得されるまで
      // Changes 一覧に消えたはずのファイルが残り続けてしまう。
      // (既に追跡済みのファイルは git が追跡を続けるため Changes に残る。これは
      //  git の仕様で、解除には別途 git rm --cached が必要)
      // .gitignore がまだ無いフォルダでは新規作成されるため、ツリーも読み直さないと
      // 作成されたファイルがエクスプローラーに現れない
      await Promise.allSettled([refreshGitStatus(), refreshTree()])
    })()
  }

  // isGitOperationDisabled は型を絞り込まないため、ここでは直接判定する
  const statusBarBranch =
    gitStatus === null || !gitStatus.isRepo
      ? null
      : {
          currentBranch: gitStatus.detached ? null : gitStatus.branch,
          branches,
          pendingBranchOperation,
          isBlocked: stagingPaths.size > 0 || isAnyLocked(),
          error: branchOperationError,
          remoteError: remoteOperationError,
          ahead: gitStatus.ahead,
          behind: gitStatus.behind,
          isSyncing,
          isSyncBlocked,
          onCheckoutBranch: checkoutBranch,
          onSync: syncChanges,
          onCreateBranch: createBranch,
          onDeleteBranch: deleteBranch,
          onMergeBranch: mergeBranch
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
              gitignoreError={gitignoreError}
              onCreateFile={createFile}
              onCreateDirectory={createDirectory}
              onRenameEntry={renameEntry}
              onDeleteEntry={deleteEntry}
              clone={clone}
              prompts={prompts}
              onAddPrompt={addPrompt}
              onDeletePrompt={deletePrompt}
              onEditPrompt={updatePrompt}
              onReorderPrompt={reorderPrompts}
              onTogglePromptPin={togglePromptPin}
              onExportPrompts={exportPrompts}
              onImportPrompts={importPrompts}
              promptListMode={promptListMode}
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
              getHistoryActions={getHistoryActions}
              onResumeHistoryEntry={onResume}
              gitStatus={gitStatus}
              gitLoading={gitLoading}
              gitError={gitError}
              onRefreshGitStatus={handleRefreshSourceControl}
              stagingPaths={stagingPaths}
              isLocked={isLocked}
              isAnyLocked={isAnyLocked}
              onStageFile={stageFile}
              onDiscardFile={(path) => void discardFile(path)}
              onUnstageFile={unstageFile}
              isCommitting={isCommitting}
              onCommit={handleCommit}
              gitOperationError={operationError}
              isPushing={isPushing}
              isPulling={isPulling}
              isFetching={isFetching}
              isPushBlocked={isPushBlocked}
              isPullBlocked={isPullBlocked}
              isRemoteOperationDisabled={isRemoteOperationDisabled}
              onPush={push}
              onPull={pull}
              onFetch={fetchRemote}
              isSyncing={isSyncing}
              isSyncBlocked={isSyncBlocked}
              onSync={syncChanges}
              gitRemoteOperationError={remoteOperationError}
              stash={stash}
              discardAll={discardAll}
              mergeState={mergeState}
              gitTag={gitTag}
              remoteSetup={remoteSetup}
              agentChanges={agentChangesPanel}
              gitBranchOperationError={branchOperationError}
              onOpenDiff={handleOpenDiff}
              onAmend={handleAmend}
              lastCommitMessage={headCommitMessage}
              log={log}
              branches={branches}
              tags={tags}
              hasMoreLog={hasMore}
              isLoadingLog={isLoadingHistory}
              isLoadingFolder={isLoadingFolder}
              historyError={historyError}
              onLoadMoreLog={loadMore}
              onAddToGitignore={handleAddToGitignore}
              hasKey={hasKey}
              apiKeyLoaded={apiKeyLoaded}
              keyStoreError={keyStoreError}
              onSaveApiKey={saveApiKey}
              modelSettings={modelSettings}
              modelSettingsLoaded={modelSettingsLoaded}
              onSaveModelSettings={saveModelSettings}
              promptRun={promptRun}
              executionMode={executionModePanel}
              agentNotification={agentNotificationPanel}
              agentSendConfirm={agentSendConfirmPanel}
              agentCliKind={agentCliKindPanel}
              agentReferences={agentReferences}
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
            isActiveFileUntracked={isActiveFileUntracked}
            isActiveFileConflicted={isActiveFileConflicted}
            conflictFile={conflictFile}
            isConflictBlocked={isAnyLocked()}
            onStageHunk={stageHunk}
            onUnstageHunk={unstageHunk}
            onDiscardHunk={discardHunk}
            canDiscardHunk={canDiscardHunk}
            bottomPanel={bottomPanel}
            agentTerminal={agentTerminal}
            externalChangeBanner={externalChangeBanner}
            agentDiffActions={agentDiffActions}
            agentChangesReview={agentChangesReview}
            onEditorMount={attachEditorSelection}
          />
        </div>
      </div>
      <StatusBar agent={statusBarAgent} branch={statusBarBranch} />
      <AgentAnnouncer message={agentAnnouncement} />
      {/* エクスプローラから参照を足したとき・すでに足してあったときの読み上げ。エクスプローラを開いている間はプロンプトパネルが隠れるため、パネルの外に常設する */}
      <AgentAnnouncer message={agentReferenceAnnouncement} />
      <QuickOpenDialog controller={quickOpen} />
      <AgentSendConfirmDialog state={agentSendConfirmDialog} />
    </>
  )
}
