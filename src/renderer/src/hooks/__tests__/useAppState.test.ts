import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const mockUsePanelState = vi.hoisted(() =>
  vi.fn(() => ({
    activePanel: 'explorer' as const,
    sidebarOpen: true,
    handlePanelChange: vi.fn(),
  }))
)

const mockUseFileSystem = vi.hoisted(() =>
  vi.fn(() => ({
    folderPath: null,
    fileTree: [],
    openFile: null,
    error: null,
    openFolder: vi.fn(),
    selectFile: vi.fn(),
  }))
)

const mockUsePrompts = vi.hoisted(() =>
  vi.fn(() => ({
    prompts: [],
    addPrompt: vi.fn(),
    deletePrompt: vi.fn(),
  }))
)

const mockUseGitStatus = vi.hoisted(() =>
  vi.fn(() => ({
    gitStatus: null,
    gitLoading: false,
    gitError: null,
    refreshGitStatus: vi.fn(),
  }))
)

const mockUseSettings = vi.hoisted(() =>
  vi.fn(() => ({
    hasKey: false,
    apiKeyLoaded: false,
    saveApiKey: vi.fn(),
  }))
)

const mockUsePromptExecution = vi.hoisted(() =>
  vi.fn(() => ({
    isExecuting: false,
    result: null,
    executionError: null,
    executePrompt: vi.fn(),
    clearResult: vi.fn(),
  }))
)

vi.mock('../usePanelState', () => ({ usePanelState: mockUsePanelState }))
vi.mock('../useFileSystem', () => ({ useFileSystem: mockUseFileSystem }))
vi.mock('../usePrompts', () => ({ usePrompts: mockUsePrompts }))
vi.mock('../useGitStatus', () => ({ useGitStatus: mockUseGitStatus }))
vi.mock('../useSettings', () => ({ useSettings: mockUseSettings }))
vi.mock('../usePromptExecution', () => ({ usePromptExecution: mockUsePromptExecution }))

import { useAppState } from '../useAppState'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useAppState', () => {
  it('usePanelState を呼び出す', () => {
    renderHook(() => useAppState())
    expect(mockUsePanelState).toHaveBeenCalledOnce()
  })

  it('useFileSystem を呼び出す', () => {
    renderHook(() => useAppState())
    expect(mockUseFileSystem).toHaveBeenCalledOnce()
  })

  it('usePrompts を呼び出す', () => {
    renderHook(() => useAppState())
    expect(mockUsePrompts).toHaveBeenCalledOnce()
  })

  it('useGitStatus を呼び出す（folderPath を引数に）', () => {
    renderHook(() => useAppState())
    expect(mockUseGitStatus).toHaveBeenCalledOnce()
    expect(mockUseGitStatus).toHaveBeenCalledWith(null)
  })

  it('panelState の値が含まれる（activePanel, sidebarOpen, handlePanelChange）', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current).toHaveProperty('activePanel', 'explorer')
    expect(result.current).toHaveProperty('sidebarOpen', true)
    expect(result.current).toHaveProperty('handlePanelChange')
  })

  it('fileSystem の値が含まれる（folderPath, fileTree, openFile, error, openFolder, selectFile）', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current).toHaveProperty('folderPath', null)
    expect(result.current).toHaveProperty('fileTree')
    expect(result.current).toHaveProperty('openFile', null)
    expect(result.current).toHaveProperty('error', null)
    expect(result.current).toHaveProperty('openFolder')
    expect(result.current).toHaveProperty('selectFile')
  })

  it('6フックの返り値にキーの重複がない（各フックのキー集合が互いに素）', () => {
    const keysets = [
      Object.keys(mockUsePanelState()),
      Object.keys(mockUseFileSystem()),
      Object.keys(mockUsePrompts()),
      Object.keys(mockUseGitStatus()),
      Object.keys(mockUseSettings()),
      Object.keys(mockUsePromptExecution()),
    ]
    for (let i = 0; i < keysets.length; i++) {
      for (let j = i + 1; j < keysets.length; j++) {
        const intersection = keysets[i].filter((k) => keysets[j].includes(k))
        expect(intersection).toHaveLength(0)
      }
    }
  })

  it('useSettings を呼び出す', () => {
    renderHook(() => useAppState())
    expect(mockUseSettings).toHaveBeenCalledOnce()
  })

  it('usePromptExecution を呼び出す', () => {
    renderHook(() => useAppState())
    expect(mockUsePromptExecution).toHaveBeenCalledOnce()
  })

  it('settings の値が含まれる（hasKey, apiKeyLoaded, saveApiKey）', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current).toHaveProperty('hasKey', false)
    expect(result.current).toHaveProperty('apiKeyLoaded', false)
    expect(result.current).toHaveProperty('saveApiKey')
  })

  it('execution の値が含まれる（isExecuting, result, executionError, executePrompt, clearResult）', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current).toHaveProperty('isExecuting', false)
    expect(result.current).toHaveProperty('result', null)
    expect(result.current).toHaveProperty('executionError', null)
    expect(result.current).toHaveProperty('executePrompt')
    expect(result.current).toHaveProperty('clearResult')
  })

  it('prompts の値が含まれる（prompts, addPrompt, deletePrompt）', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current).toHaveProperty('prompts')
    expect(result.current).toHaveProperty('addPrompt')
    expect(result.current).toHaveProperty('deletePrompt')
  })

  it('git の値が含まれる（gitStatus, gitLoading, gitError, refreshGitStatus）', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current).toHaveProperty('gitStatus', null)
    expect(result.current).toHaveProperty('gitLoading', false)
    expect(result.current).toHaveProperty('gitError', null)
    expect(result.current).toHaveProperty('refreshGitStatus')
  })
})
