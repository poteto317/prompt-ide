import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { FileTreeNode } from '../../types'
import { AGENT_INSTRUCTION_FILES } from '@shared/agentInstructionFiles'

vi.mock('../../lib/agentInstructionsApi')

import * as agentInstructionsApi from '../../lib/agentInstructionsApi'
import { runAgentInstructionFileCreation } from '../agentInstructionFileCreation'
import type { AgentInstructionFileCreationDeps } from '../agentInstructionFileCreation'
import { SAVE_ABORTED_BY_CREATE } from '../useFileEditing'
import type { FileOperationResult } from '../useFileEditing'

const mockCreate = vi.mocked(agentInstructionsApi.createAgentInstructionFile)
const dotFile = AGENT_INSTRUCTION_FILES.claude[1] // .claude/CLAUDE.md
const tree: FileTreeNode[] = [{ name: 'CLAUDE.md', path: '/p/CLAUDE.md', type: 'file' }]

interface Harness {
  deps: AgentInstructionFileCreationDeps
  release: Mock<(result?: FileOperationResult) => void>
  setFolder: (folder: string | null) => void
}

const makeDeps = (reloadTree: () => Promise<FileTreeNode[] | null> = async () => tree): Harness => {
  let folder: string | null = '/p'
  const release = vi.fn<(result?: FileOperationResult) => void>()
  const deps: AgentInstructionFileCreationDeps = {
    getFolderPath: () => folder,
    lockPathForFileOperation: vi.fn(async () => release),
    reloadTree: vi.fn(reloadTree)
  }
  return { deps, release, setFolder: (next) => (folder = next) }
}

describe('runAgentInstructionFileCreation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('フォルダの根をロックし、作るファイルのパスを SAVE_ABORTED_BY_CREATE で無効にする', async () => {
    mockCreate.mockResolvedValue({ ok: true })
    const { deps } = makeDeps()
    await runAgentInstructionFileCreation(deps, 'claude', dotFile)
    expect(deps.lockPathForFileOperation).toHaveBeenCalledWith('/p', {
      invalidatesPaths: ['/p/.claude/CLAUDE.md'],
      abortMessage: SAVE_ABORTED_BY_CREATE
    })
    expect(mockCreate).toHaveBeenCalledWith('/p', 'claude', 'claude-dot')
  })

  it('成功 → ロックを成功で解放し、読み直したツリーを返す', async () => {
    mockCreate.mockResolvedValue({ ok: true })
    const { deps, release } = makeDeps()
    await expect(runAgentInstructionFileCreation(deps, 'claude', dotFile)).resolves.toEqual({
      status: 'created',
      tree
    })
    expect(release).toHaveBeenCalledWith({ succeeded: true })
  })

  it('読み直しが反映されない → tree: null', async () => {
    mockCreate.mockResolvedValue({ ok: true })
    const { deps } = makeDeps(async () => null)
    await expect(runAgentInstructionFileCreation(deps, 'claude', dotFile)).resolves.toEqual({
      status: 'created',
      tree: null
    })
  })

  it('読み直しが失敗 → 投げずに tree: null(作成の成功を失敗にしない。L-001)', async () => {
    mockCreate.mockResolvedValue({ ok: true })
    const { deps } = makeDeps(async () => {
      throw new Error('read failed')
    })
    await expect(runAgentInstructionFileCreation(deps, 'claude', dotFile)).resolves.toEqual({
      status: 'created',
      tree: null
    })
  })

  it.each(['exists', 'outside', 'failed'] as const)(
    '{ ok: false, reason: %s } → 失敗で解放し、ツリーを読み直してから、理由を返す',
    async (reason) => {
      mockCreate.mockResolvedValue({ ok: false, reason })
      const { deps, release } = makeDeps()
      await expect(runAgentInstructionFileCreation(deps, 'claude', dotFile)).resolves.toEqual({
        status: 'failed',
        reason
      })
      expect(release).toHaveBeenCalledWith({ succeeded: false })
      expect(deps.reloadTree).toHaveBeenCalledTimes(1)
      expect(release.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(deps.reloadTree).mock.invocationCallOrder[0]
      )
    }
  )

  it('{ ok: false } の後の読み直しが失敗しても、理由を返す(握りつぶす)', async () => {
    mockCreate.mockResolvedValue({ ok: false, reason: 'exists' })
    const { deps } = makeDeps()
    vi.mocked(deps.reloadTree).mockRejectedValue(new Error('read failed'))
    await expect(runAgentInstructionFileCreation(deps, 'claude', dotFile)).resolves.toEqual({
      status: 'failed',
      reason: 'exists'
    })
  })

  it('{ ok: false } の読み直しの途中でフォルダが切り替わる → skipped', async () => {
    mockCreate.mockResolvedValue({ ok: false, reason: 'exists' })
    const harness = makeDeps()
    vi.mocked(harness.deps.reloadTree).mockImplementation(async () => {
      harness.setFolder('/other')
      return null
    })
    await expect(runAgentInstructionFileCreation(harness.deps, 'claude', dotFile)).resolves.toEqual(
      { status: 'skipped' }
    )
  })

  it('IPC が拒否 → 失敗で解放し、failed を返す', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mockCreate.mockRejectedValue(new Error('ipc'))
      const { deps, release } = makeDeps()
      await expect(runAgentInstructionFileCreation(deps, 'claude', dotFile)).resolves.toEqual({
        status: 'failed',
        reason: 'failed'
      })
      expect(release).toHaveBeenCalledWith({ succeeded: false })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('フォルダが無い → skipped で、ロックも IPC も呼ばない', async () => {
    const { deps, setFolder } = makeDeps()
    setFolder(null)
    await expect(runAgentInstructionFileCreation(deps, 'claude', dotFile)).resolves.toEqual({
      status: 'skipped'
    })
    expect(deps.lockPathForFileOperation).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('作成の途中でフォルダが切り替わる → skipped で、読み直さない', async () => {
    const harness = makeDeps()
    mockCreate.mockImplementation(async () => {
      harness.setFolder('/other')
      return { ok: false, reason: 'exists' }
    })
    await expect(runAgentInstructionFileCreation(harness.deps, 'claude', dotFile)).resolves.toEqual(
      { status: 'skipped' }
    )
    expect(harness.deps.reloadTree).not.toHaveBeenCalled()
  })

  it('ロックを待つ間にフォルダが切り替わる → IPC を呼ばず skipped、ロックは失敗で解放', async () => {
    const harness = makeDeps()
    vi.mocked(harness.deps.lockPathForFileOperation).mockImplementation(async () => {
      harness.setFolder('/other')
      return harness.release
    })
    await expect(runAgentInstructionFileCreation(harness.deps, 'claude', dotFile)).resolves.toEqual(
      { status: 'skipped' }
    )
    expect(mockCreate).not.toHaveBeenCalled()
    expect(harness.release).toHaveBeenCalledWith({ succeeded: false })
    expect(harness.deps.reloadTree).not.toHaveBeenCalled()
  })

  it('main が folderChanged を返す → skipped(文言を出さない)で、失敗で解放し、読み直さない', async () => {
    mockCreate.mockResolvedValue({ ok: false, reason: 'folderChanged' })
    const { deps, release } = makeDeps()
    await expect(runAgentInstructionFileCreation(deps, 'claude', dotFile)).resolves.toEqual({
      status: 'skipped'
    })
    expect(release).toHaveBeenCalledWith({ succeeded: false })
    expect(deps.reloadTree).not.toHaveBeenCalled()
  })

  it.each<[string, () => Promise<FileTreeNode[] | null>]>([
    ['反映されない(null)', async () => null],
    [
      '失敗',
      async () => {
        throw new Error('read failed')
      }
    ]
  ])(
    '読み直しの途中でフォルダが切り替わり、読み直しが%s → skipped(切り替え先の節に文言を出さない)',
    async (_label, reload) => {
      mockCreate.mockResolvedValue({ ok: true })
      const harness = makeDeps()
      vi.mocked(harness.deps.reloadTree).mockImplementation(async () => {
        harness.setFolder('/other')
        return reload()
      })
      await expect(
        runAgentInstructionFileCreation(harness.deps, 'claude', dotFile)
      ).resolves.toEqual({ status: 'skipped' })
    }
  )
})
