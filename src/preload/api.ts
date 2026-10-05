import { ipcRenderer } from 'electron'
import type {
  AgentSessionData,
  AgentSessionExit,
  AgentSessionSnapshot,
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
import { isAgentExitReason } from '@shared/types'

export const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  readDirectory: (path: string): Promise<FileTreeNode[]> =>
    ipcRenderer.invoke('fs:readDirectory', path),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeFile', path, content),
  createFile: (parentPath: string, name: string): Promise<void> =>
    ipcRenderer.invoke('fs:createFile', parentPath, name),
  createDirectory: (parentPath: string, name: string): Promise<void> =>
    ipcRenderer.invoke('fs:createDirectory', parentPath, name),
  renameEntry: (path: string, newName: string): Promise<void> =>
    ipcRenderer.invoke('fs:renameEntry', path, newName),
  deleteEntry: (path: string): Promise<void> => ipcRenderer.invoke('fs:deleteEntry', path),
  getGitStatus: (): Promise<GitStatusResult> => ipcRenderer.invoke('git:getStatus'),
  stageFile: (filePath: string): Promise<void> => ipcRenderer.invoke('git:stage', filePath),
  unstageFile: (filePath: string, renamedFrom?: string): Promise<void> =>
    ipcRenderer.invoke('git:unstage', filePath, renamedFrom),
  discardChanges: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('git:discardChanges', filePath),
  discardHunk: (filePath: string, patch: string): Promise<void> =>
    ipcRenderer.invoke('git:discardHunk', filePath, patch),
  discardAll: (expected: DiscardAllEntry[]): Promise<DiscardAllResult> =>
    ipcRenderer.invoke('git:discardAll', expected),
  getConflictFile: (filePath: string): Promise<ConflictFile> =>
    ipcRenderer.invoke('git:getConflictFile', filePath),
  resolveConflictBlocks: (
    filePath: string,
    expectedDigests: string[],
    choices: Record<number, ConflictChoice>
  ): Promise<void> =>
    ipcRenderer.invoke('git:resolveConflictBlocks', filePath, expectedDigests, choices),
  resolveConflictWholeFile: (filePath: string, side: 'ours' | 'theirs'): Promise<void> =>
    ipcRenderer.invoke('git:resolveConflictWholeFile', filePath, side),
  keepConflictFile: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('git:keepConflictFile', filePath),
  removeConflictFile: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('git:removeConflictFile', filePath),
  markConflictResolved: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('git:markConflictResolved', filePath),
  completeMerge: (): Promise<void> => ipcRenderer.invoke('git:completeMerge'),
  abortMerge: (): Promise<void> => ipcRenderer.invoke('git:abortMerge'),
  commitChanges: (message: string): Promise<void> => ipcRenderer.invoke('git:commit', message),
  getDiff: (
    filePath: string,
    staged: boolean,
    isUntracked: boolean,
    renamedFrom?: string
  ): Promise<string> =>
    ipcRenderer.invoke('git:getDiff', filePath, staged, isUntracked, renamedFrom),
  stageHunk: (filePath: string, patch: string): Promise<void> =>
    ipcRenderer.invoke('git:stageHunk', filePath, patch),
  unstageHunk: (filePath: string, patch: string): Promise<void> =>
    ipcRenderer.invoke('git:unstageHunk', filePath, patch),
  getLog: (limit: number, skip: number): Promise<GitLogEntry[]> =>
    ipcRenderer.invoke('git:getLog', limit, skip),
  getBranches: (): Promise<GitBranch[]> => ipcRenderer.invoke('git:getBranches'),
  getTags: (): Promise<string[]> => ipcRenderer.invoke('git:getTags'),
  amendCommit: (message: string): Promise<void> => ipcRenderer.invoke('git:amendCommit', message),
  push: (): Promise<void> => ipcRenderer.invoke('git:push'),
  pull: (): Promise<void> => ipcRenderer.invoke('git:pull'),
  fetchRemote: (): Promise<void> => ipcRenderer.invoke('git:fetch'),
  checkoutBranch: (branchName: string): Promise<void> =>
    ipcRenderer.invoke('git:checkoutBranch', branchName),
  createBranch: (branchName: string): Promise<void> =>
    ipcRenderer.invoke('git:createBranch', branchName),
  deleteBranch: (branchName: string, force: boolean): Promise<DeleteBranchResult> =>
    ipcRenderer.invoke('git:deleteBranch', branchName, force),
  mergeBranch: (branchName: string): Promise<MergeBranchResult> =>
    ipcRenderer.invoke('git:mergeBranch', branchName),
  getStashes: (): Promise<GitStashEntry[]> => ipcRenderer.invoke('git:getStashes'),
  stashPush: (message: string): Promise<void> => ipcRenderer.invoke('git:stashPush', message),
  stashPop: (sha: string): Promise<StashPopResult> => ipcRenderer.invoke('git:stashPop', sha),
  stashDrop: (sha: string): Promise<void> => ipcRenderer.invoke('git:stashDrop', sha),
  createTag: (request: CreateTagRequest): Promise<void> =>
    ipcRenderer.invoke('git:createTag', request),
  initRepository: (branch: string): Promise<void> => ipcRenderer.invoke('git:init', branch),
  addOrigin: (url: string): Promise<void> => ipcRenderer.invoke('git:addOrigin', url),
  pushSetUpstream: (): Promise<void> => ipcRenderer.invoke('git:pushSetUpstream'),
  cloneRepository: (url: string, folderName: string): Promise<CloneRepositoryResult> =>
    ipcRenderer.invoke('git:cloneRepository', url, folderName),
  cancelCloneRepository: (): Promise<void> => ipcRenderer.invoke('git:cancelCloneRepository'),
  addToGitignore: (targetPath: string): Promise<void> =>
    ipcRenderer.invoke('fs:addToGitignore', targetPath),
  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke('settings:hasApiKey'),
  setApiKey: (apiKey: string): Promise<void> => ipcRenderer.invoke('settings:setApiKey', apiKey),
  getModelSettings: (): Promise<ModelSettings> => ipcRenderer.invoke('settings:getModelSettings'),
  setModelSettings: (settings: ModelSettings): Promise<void> =>
    ipcRenderer.invoke('settings:setModelSettings', settings),
  runPromptStream: (
    requestId: string,
    promptContent: string,
    fileContent: string | null
  ): Promise<string> =>
    ipcRenderer.invoke('claude:runPromptStream', { requestId, promptContent, fileContent }),
  loadPrompts: (): Promise<Prompt[]> => ipcRenderer.invoke('prompts:load'),
  savePrompts: (prompts: Prompt[]): Promise<void> => ipcRenderer.invoke('prompts:save', prompts),
  exportPrompts: (prompts: Prompt[]): Promise<boolean> =>
    ipcRenderer.invoke('prompts:export', prompts),
  importPrompts: (): Promise<Prompt[] | null> => ipcRenderer.invoke('prompts:import'),
  loadTasks: (): Promise<Task[]> => ipcRenderer.invoke('progress:load'),
  saveTasks: (tasks: Task[]): Promise<void> => ipcRenderer.invoke('progress:save', tasks),
  runCLIPromptStream: (
    requestId: string,
    toolId: CLIOnlyToolId,
    promptContent: string
  ): Promise<string> =>
    ipcRenderer.invoke('cli:runPromptStream', { requestId, toolId, promptContent }),
  cancelPrompt: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke('prompt:cancel', { requestId }),
  // ipcRenderer を直接 renderer に渡さず preload 内で wrap し、解除関数を返す
  // (contextBridge 越しでは removeListener が正しく機能しないリスナーリークを防ぐ)
  onPromptStreamChunk: (listener: (requestId: string, chunk: string) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (typeof payload !== 'object' || payload === null) return
      const { requestId, chunk } = payload as Record<string, unknown>
      if (typeof requestId !== 'string' || typeof chunk !== 'string') return
      listener(requestId, chunk)
    }
    ipcRenderer.on('prompt:streamChunk', wrapped)
    return () => {
      ipcRenderer.removeListener('prompt:streamChunk', wrapped)
    }
  },
  loadHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:load'),
  saveHistory: (entries: HistoryEntry[]): Promise<void> =>
    ipcRenderer.invoke('history:save', entries),
  getPromptExecutionMode: (): Promise<PromptExecutionMode> =>
    ipcRenderer.invoke('settings:getPromptExecutionMode'),
  setPromptExecutionMode: (mode: PromptExecutionMode): Promise<void> =>
    ipcRenderer.invoke('settings:setPromptExecutionMode', mode),
  // エージェントのセッション。起動のコマンド・作業ディレクトリ・環境変数は main が決める
  startAgentSession: (request: AgentStartRequest): Promise<AgentStartResult> =>
    ipcRenderer.invoke('agentTerminal:start', request),
  // キー入力・xterm の応答・貼り付けの順序を保つため send(fire-and-forget)にする
  writeAgentSession: (sessionId: string, data: string): void =>
    ipcRenderer.send('agentTerminal:write', sessionId, data),
  resizeAgentSession: (sessionId: string, cols: number, rows: number): void =>
    ipcRenderer.send('agentTerminal:resize', sessionId, cols, rows),
  stopAgentSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('agentTerminal:stop', sessionId),
  getAgentSession: (): Promise<AgentSessionSnapshot> =>
    ipcRenderer.invoke('agentTerminal:getState'),
  onAgentData: (listener: (payload: AgentSessionData) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (typeof payload !== 'object' || payload === null) return
      const { sessionId, data } = payload as Record<string, unknown>
      if (typeof sessionId !== 'string' || typeof data !== 'string') return
      listener({ sessionId, data })
    }
    ipcRenderer.on('agentTerminal:data', wrapped)
    return () => {
      ipcRenderer.removeListener('agentTerminal:data', wrapped)
    }
  },
  onAgentExit: (listener: (payload: AgentSessionExit) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (typeof payload !== 'object' || payload === null) return
      const { sessionId, exitCode, signal, reason } = payload as Record<string, unknown>
      if (typeof sessionId !== 'string') return
      if (!isAgentExitReason(reason)) return
      listener({
        sessionId,
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        signal: typeof signal === 'number' ? signal : null,
        reason
      })
    }
    ipcRenderer.on('agentTerminal:exit', wrapped)
    return () => {
      ipcRenderer.removeListener('agentTerminal:exit', wrapped)
    }
  },
  setAgentTerminalFocused: (focused: boolean): void =>
    ipcRenderer.send('agentTerminal:focus', focused),
  // baseContent はタブが最後にディスクと一致した内容。null は照合せずに書く(上書きの確認の後)
  writeFileChecked: (
    path: string,
    content: string,
    baseContent: string | null
  ): Promise<WriteFileCheckedResult> =>
    ipcRenderer.invoke('fs:writeFileChecked', path, content, baseContent),
  setWatchedFiles: (paths: string[]): Promise<void> =>
    ipcRenderer.invoke('fs:setWatchedFiles', paths),
  onExternalFileChange: (listener: (event: ExternalFileChangeEvent) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (typeof payload !== 'object' || payload === null) return
      const { paths } = payload as Record<string, unknown>
      if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) return
      listener({ paths })
    }
    ipcRenderer.on('fs:externalChange', wrapped)
    return () => {
      ipcRenderer.removeListener('fs:externalChange', wrapped)
    }
  },
  openExternalLink: (url: string): Promise<boolean> =>
    ipcRenderer.invoke('shell:openExternalLink', url)
}
