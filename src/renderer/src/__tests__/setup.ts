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
    saveHistory: () => Promise.resolve()
  }
})
