import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { FileTreeNode } from '../../types'
import type { UseAgentInstructionFilesOptions } from '../useAgentInstructionFiles'

vi.mock('../../lib/fileSystemApi')
vi.mock('../../lib/agentInstructionsApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import * as agentInstructionsApi from '../../lib/agentInstructionsApi'
import { useFileSystem } from '../useFileSystem'
import { useAgentInstructionFiles } from '../useAgentInstructionFiles'

// 実物の useFileSystem と節の hook を一緒に描画し、作成の後の読み直し(手動)の途中に静かな読み直しが届いても、
// 作成したファイルが開くことを確かめる(設計書 2026-11-08「ツリーの静かな読み直し」の (a))
const claudeNode: FileTreeNode = { name: 'CLAUDE.md', path: '/p/CLAUDE.md', type: 'file' }
const getGlobalStatus: UseAgentInstructionFilesOptions['getGlobalStatus'] = async () => ({
  kind: 'missing',
  displayPath: '~/.claude/CLAUDE.md'
})
const createGlobalFile: UseAgentInstructionFilesOptions['createGlobalFile'] = async () => ({
  ok: true
})

function useCombined(): {
  fs: ReturnType<typeof useFileSystem>
  files: ReturnType<typeof useAgentInstructionFiles>
} {
  const fs = useFileSystem({ onConfirm: () => true })
  const files = useAgentInstructionFiles({
    folderPath: fs.folderPath,
    fileTree: fs.fileTree,
    cliKind: 'claude',
    createFile: fs.createAgentInstructionFile,
    openFile: fs.selectFile,
    refreshTree: fs.refreshTree,
    getGlobalStatus,
    createGlobalFile
  })
  return { fs, files }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('指示ファイルの作成と静かな読み直し', () => {
  it('作成の後の読み直しの途中に静かな読み直しを頼んでも → 作成したファイルが開き、開けなかった文言は出ない', async () => {
    vi.mocked(fileSystemApi.openFolder).mockResolvedValue('/p')
    vi.mocked(fileSystemApi.readDirectory).mockResolvedValue([])
    vi.mocked(fileSystemApi.readFileContent).mockResolvedValue('# 指示\n')
    vi.mocked(agentInstructionsApi.createAgentInstructionFile).mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useCombined())
    await act(async () => {
      await result.current.fs.openFolder()
    })
    let resolveReload: (tree: FileTreeNode[]) => void = () => {}
    vi.mocked(fileSystemApi.readDirectory).mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveReload = resolve
        })
    )
    const readsBefore = vi.mocked(fileSystemApi.readDirectory).mock.calls.length
    let creating: Promise<void> = Promise.resolve()
    await act(async () => {
      creating = result.current.files.create(result.current.files.rows[0])
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    // 作成の後の読み直し(手動)が始まっている
    expect(vi.mocked(fileSystemApi.readDirectory).mock.calls.length).toBe(readsBefore + 1)
    await act(async () => {
      await result.current.fs.refreshTreeQuietly()
    })
    vi.mocked(fileSystemApi.readDirectory).mockResolvedValue([claudeNode])
    await act(async () => {
      resolveReload([claudeNode])
      await creating
    })
    expect(fileSystemApi.readFileContent).toHaveBeenCalledWith('/p/CLAUDE.md')
    expect(result.current.files.message).toBeNull()
  })
})
