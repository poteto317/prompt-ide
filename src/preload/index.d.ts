import type {
  AgentCliKind,
  AgentCliKindSetting,
  AgentNotificationActivated,
  AgentNotificationDismissRequest,
  AgentNotificationShowRequest,
  AgentChangesBeginTrigger,
  AgentChangesListResult,
  AgentChangesScope,
  AgentChangesState,
  AgentChangesUndoResult,
  AgentInterruptFollowUpResult,
  AgentInterruptResult,
  AgentRevertAllEntry,
  AgentRevertAllResult,
  AgentRevertResult,
  AgentLastSession,
  AgentSessionData,
  AgentSessionExit,
  AgentSessionSnapshotEntry,
  AgentStartRequest,
  AgentStartResult,
  CLIOnlyToolId,
  ExternalFileChangeEvent,
  PromptExecutionMode,
  WriteFileCheckedResult,
  CloneRepositoryResult,
  ConflictChoice,
  ConflictFile,
  CreateTagRequest,
  DeleteBranchResult,
  MergeBranchResult,
  DiscardAllEntry,
  DiscardAllResult,
  FileTreeNode,
  GitStatusResult,
  GitLogEntry,
  GitBranch,
  GitStashEntry,
  StashPopResult,
  HistoryEntry,
  ModelSettings,
  Prompt,
  Task
} from '@shared/types'
import type { ApiKeyStatus } from '@shared/apiKeyStatus'

declare global {
  interface Window {
    api: {
      openFolder(): Promise<string | null>
      readDirectory(path: string): Promise<FileTreeNode[]>
      readFile(path: string): Promise<string>
      /** 照合を通さない書き込み(fs:writeFile)。保存には使わない(保存は writeFileChecked) */
      writeFile(path: string, content: string): Promise<void>
      createFile(parentPath: string, name: string): Promise<void>
      createDirectory(parentPath: string, name: string): Promise<void>
      renameEntry(path: string, newName: string): Promise<void>
      deleteEntry(path: string): Promise<void>
      getGitStatus(): Promise<GitStatusResult>
      stageFile(filePath: string): Promise<void>
      unstageFile(filePath: string, renamedFrom?: string): Promise<void>
      discardChanges(filePath: string): Promise<void>
      discardHunk(filePath: string, patch: string): Promise<void>
      discardAll(expected: DiscardAllEntry[]): Promise<DiscardAllResult>
      getConflictFile(filePath: string): Promise<ConflictFile>
      resolveConflictBlocks(
        filePath: string,
        expectedDigests: string[],
        choices: Record<number, ConflictChoice>
      ): Promise<void>
      resolveConflictWholeFile(filePath: string, side: 'ours' | 'theirs'): Promise<void>
      keepConflictFile(filePath: string): Promise<void>
      removeConflictFile(filePath: string): Promise<void>
      markConflictResolved(filePath: string): Promise<void>
      completeMerge(): Promise<void>
      abortMerge(): Promise<void>
      commitChanges(message: string): Promise<void>
      getDiff(
        filePath: string,
        staged: boolean,
        isUntracked: boolean,
        renamedFrom?: string
      ): Promise<string>
      stageHunk(filePath: string, patch: string): Promise<void>
      unstageHunk(filePath: string, patch: string): Promise<void>
      getLog(limit: number, skip: number): Promise<GitLogEntry[]>
      getHeadCommitMessage(): Promise<string | null>
      getBranches(): Promise<GitBranch[]>
      getTags(): Promise<string[]>
      amendCommit(message: string): Promise<void>
      push(): Promise<void>
      pull(): Promise<void>
      fetchRemote(): Promise<void>
      checkoutBranch(branchName: string): Promise<void>
      createBranch(branchName: string): Promise<void>
      deleteBranch(branchName: string, force: boolean): Promise<DeleteBranchResult>
      mergeBranch(branchName: string): Promise<MergeBranchResult>
      getStashes(): Promise<GitStashEntry[]>
      stashPush(message: string): Promise<void>
      stashPop(sha: string): Promise<StashPopResult>
      stashDrop(sha: string): Promise<void>
      createTag(request: CreateTagRequest): Promise<void>
      initRepository(branch: string): Promise<void>
      addOrigin(url: string): Promise<void>
      pushSetUpstream(): Promise<void>
      cloneRepository(url: string, folderName: string): Promise<CloneRepositoryResult>
      cancelCloneRepository(): Promise<void>
      addToGitignore(targetPath: string): Promise<void>
      hasApiKey(): Promise<ApiKeyStatus>
      setApiKey(apiKey: string): Promise<void>
      getModelSettings(): Promise<ModelSettings>
      setModelSettings(settings: ModelSettings): Promise<void>
      runPromptStream(
        requestId: string,
        promptContent: string,
        fileContent: string | null
      ): Promise<string>
      loadPrompts(): Promise<Prompt[]>
      savePrompts(prompts: Prompt[]): Promise<void>
      exportPrompts(prompts: Prompt[]): Promise<boolean>
      importPrompts(): Promise<Prompt[] | null>
      loadTasks(): Promise<Task[]>
      saveTasks(tasks: Task[]): Promise<void>
      runCLIPromptStream(
        requestId: string,
        toolId: CLIOnlyToolId,
        promptContent: string
      ): Promise<string>
      cancelPrompt(requestId: string): Promise<boolean>
      onPromptStreamChunk(listener: (requestId: string, chunk: string) => void): () => void
      loadHistory(): Promise<HistoryEntry[]>
      saveHistory(entries: HistoryEntry[]): Promise<void>
      getPromptExecutionMode(): Promise<PromptExecutionMode>
      setPromptExecutionMode(mode: PromptExecutionMode): Promise<void>
      getAgentNotificationsEnabled(): Promise<boolean>
      setAgentNotificationsEnabled(enabled: boolean): Promise<void>
      getAgentSendConfirmEnabled(): Promise<boolean>
      setAgentSendConfirmEnabled(enabled: boolean): Promise<void>
      getAgentCliKind(): Promise<AgentCliKindSetting>
      setAgentCliKind(kind: AgentCliKind): Promise<void>
      startAgentSession(request: AgentStartRequest): Promise<AgentStartResult>
      writeAgentSession(sessionId: string, data: string): void
      resizeAgentSession(sessionId: string, cols: number, rows: number): void
      stopAgentSession(sessionId: string): Promise<void>
      interruptAgentSession(sessionId: string): Promise<AgentInterruptResult>
      interruptAgentSessionFollowUp(sessionId: string): Promise<AgentInterruptFollowUpResult>
      getAgentSessions(): Promise<AgentSessionSnapshotEntry[]>
      getLastAgentSession(
        folderPath: string,
        cliKind: AgentCliKind
      ): Promise<AgentLastSession | null>
      onAgentData(listener: (payload: AgentSessionData) => void): () => void
      onAgentExit(listener: (payload: AgentSessionExit) => void): () => void
      setAgentTerminalFocused(focused: boolean): void
      reportAgentSessionWorking(sessionId: string): void
      reportAgentSessionWorkingEnded(sessionId: string): void
      showAgentNotification(request: AgentNotificationShowRequest): Promise<void>
      setAgentNotificationBadge(count: number): Promise<void>
      dismissAgentNotification(request: AgentNotificationDismissRequest): Promise<void>
      onAgentNotificationActivated(
        listener: (payload: AgentNotificationActivated) => void
      ): () => void
      writeFileChecked(
        path: string,
        content: string,
        baseContent: string | null
      ): Promise<WriteFileCheckedResult>
      setWatchedFiles(paths: string[]): Promise<void>
      onExternalFileChange(listener: (event: ExternalFileChangeEvent) => void): () => void
      openExternalLink(url: string): Promise<boolean>
      beginAgentChanges(trigger: AgentChangesBeginTrigger): Promise<AgentChangesState>
      getAgentChangesState(): Promise<AgentChangesState>
      listAgentChanges(scope: AgentChangesScope): Promise<AgentChangesListResult>
      getAgentChangeDiff(path: string, scope: AgentChangesScope): Promise<string>
      revertAgentChange(path: string, scope: AgentChangesScope): Promise<AgentRevertResult>
      revertAgentChangeHunk(
        path: string,
        patch: string,
        scope: AgentChangesScope
      ): Promise<AgentRevertResult>
      revertAllAgentChanges(
        expected: AgentRevertAllEntry[],
        scope: AgentChangesScope
      ): Promise<AgentRevertAllResult>
      undoAgentChangesRevert(undoId: number): Promise<AgentChangesUndoResult>
      clearAgentChanges(): Promise<void>
    }
  }
}
