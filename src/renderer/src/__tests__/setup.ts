import '@testing-library/jest-dom'

// jsdom はレイアウトを持たないため scrollIntoView が未実装。
// 選択項目を可視領域に送る処理を含むコンポーネントのために no-op を用意する。
Element.prototype.scrollIntoView = (): void => {}

// window.api stub for renderer tests that don't mock it individually
Object.defineProperty(window, 'api', {
  configurable: true,
  writable: true,
  value: {
    openFolder: () => Promise.resolve(null),
    readDirectory: () => Promise.resolve([]),
    readFile: () => Promise.resolve(''),
    writeFile: () => Promise.resolve(),
    createFile: () => Promise.resolve(),
    createDirectory: () => Promise.resolve(),
    renameEntry: () => Promise.resolve(),
    deleteEntry: () => Promise.resolve(),
    getGitStatus: () =>
      Promise.resolve({
        isRepo: false,
        mergeInProgress: false,
        hasOrigin: false,
        hasRemote: false,
        upstream: null,
        detached: false,
        branch: null,
        ahead: 0,
        behind: 0,
        files: []
      }),
    hasApiKey: () => Promise.resolve(false),
    setApiKey: () => Promise.resolve(),
    getModelSettings: () => Promise.resolve({ modelId: 'claude-haiku-4-5', maxTokens: 4096 }),
    setModelSettings: () => Promise.resolve(),
    runPromptStream: () => Promise.resolve(''),
    loadPrompts: () => Promise.resolve([]),
    savePrompts: () => Promise.resolve(),
    loadTasks: () => Promise.resolve([]),
    saveTasks: () => Promise.resolve(),
    runCLIPromptStream: () => Promise.resolve(''),
    cancelPrompt: () => Promise.resolve(false),
    onPromptStreamChunk: () => () => {},
    loadHistory: () => Promise.resolve([]),
    saveHistory: () => Promise.resolve(),
    // 既存のテストは従来の方式の画面を前提にしている。エージェント CLI 方式の画面のテストは個別に差し替える
    getPromptExecutionMode: () => Promise.resolve('legacy'),
    setPromptExecutionMode: () => Promise.resolve(),
    getAgentNotificationsEnabled: () => Promise.resolve(true),
    setAgentNotificationsEnabled: () => Promise.resolve(),
    getAgentSendConfirmEnabled: () => Promise.resolve(true),
    setAgentSendConfirmEnabled: () => Promise.resolve(),
    startAgentSession: () => Promise.resolve({ kind: 'error', error: 'no-folder' }),
    writeAgentSession: () => {},
    resizeAgentSession: () => {},
    stopAgentSession: () => Promise.resolve(),
    interruptAgentSession: () => Promise.resolve({ kind: 'sent' }),
    getAgentSessions: () => Promise.resolve([]),
    getLastAgentSession: () => Promise.resolve(null),
    onAgentData: () => () => {},
    onAgentExit: () => () => {},
    setAgentTerminalFocused: () => {},
    reportAgentSessionWorking: () => {},
    reportAgentSessionWorkingEnded: () => {},
    // エージェントの通知。既定は何もしない(個別のテストで差し替える)
    showAgentNotification: () => Promise.resolve(),
    setAgentNotificationBadge: () => Promise.resolve(),
    dismissAgentNotification: () => Promise.resolve(),
    onAgentNotificationActivated: () => () => {},
    writeFileChecked: () => Promise.resolve({ kind: 'written' }),
    setWatchedFiles: () => Promise.resolve(),
    onExternalFileChange: () => () => {},
    openExternalLink: () => Promise.resolve(true),
    // エージェントの変更。既定は記録なし(個別のテストで差し替える)
    beginAgentChanges: () => Promise.resolve({ kind: 'none' }),
    getAgentChangesState: () => Promise.resolve({ kind: 'none' }),
    listAgentChanges: () => Promise.resolve({ kind: 'none' }),
    getAgentChangeDiff: () => Promise.resolve(''),
    revertAgentChange: () => Promise.resolve({ undo: { kind: 'saved' }, undoSummary: null }),
    revertAgentChangeHunk: () => Promise.resolve({ undo: { kind: 'saved' }, undoSummary: null }),
    revertAllAgentChanges: () =>
      Promise.resolve({
        status: 'done',
        revertedCount: 0,
        undo: { kind: 'saved' },
        undoSummary: null
      }),
    undoAgentChangesRevert: () =>
      Promise.resolve({ status: 'done', restoredPaths: [], trashedPaths: [], undoSummary: null }),
    clearAgentChanges: () => Promise.resolve()
  }
})
