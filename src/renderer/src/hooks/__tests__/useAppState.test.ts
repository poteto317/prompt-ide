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

vi.mock('../usePanelState', () => ({ usePanelState: mockUsePanelState }))
vi.mock('../useFileSystem', () => ({ useFileSystem: mockUseFileSystem }))
vi.mock('../usePrompts', () => ({ usePrompts: mockUsePrompts }))
vi.mock('../useGitStatus', () => ({ useGitStatus: mockUseGitStatus }))

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

  it('4フックの返り値にキーの重複がない', () => {
    const { result } = renderHook(() => useAppState())
    const keys = Object.keys(result.current)
    const uniqueKeys = new Set(keys)
    expect(keys.length).toBe(uniqueKeys.size)
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
