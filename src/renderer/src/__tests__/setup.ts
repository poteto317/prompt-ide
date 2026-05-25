import '@testing-library/jest-dom'

// window.api stub for renderer tests that don't mock it individually
Object.defineProperty(window, 'api', {
  configurable: true,
  writable: true,
  value: {
    openFolder: () => Promise.resolve(null),
    readDirectory: () => Promise.resolve([]),
    readFile: () => Promise.resolve(''),
    getGitStatus: () => Promise.resolve({ isRepo: false, branch: null, ahead: 0, behind: 0, files: [] }),
    hasApiKey: () => Promise.resolve(false),
    setApiKey: () => Promise.resolve(),
    runPrompt: () => Promise.resolve(''),
    loadPrompts: () => Promise.resolve([]),
    savePrompts: () => Promise.resolve(),
  },
})
