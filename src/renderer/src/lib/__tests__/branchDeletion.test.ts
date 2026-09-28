import { describe, it, expect, vi } from 'vitest'
import {
  buildDeleteConfirmMessage,
  buildForceDeleteConfirmMessage,
  deleteBranchConfirmingForce
} from '../branchDeletion'

describe('buildDeleteConfirmMessage / buildForceDeleteConfirmMessage', () => {
  it('1回目の確認文言', () => {
    expect(buildDeleteConfirmMessage('feature/x')).toBe('ブランチ feature/x を削除しますか？')
  })

  it('2回目(強制削除)の確認文言', () => {
    expect(buildForceDeleteConfirmMessage('feature/x')).toBe(
      'ブランチ feature/x にはマージされていないコミットがあります。強制削除するとこれらのコミットは失われます。削除しますか？'
    )
  })
})

describe('deleteBranchConfirmingForce', () => {
  it('安全削除で削除できたら true を返し、確認も強制削除もしない', async () => {
    const deleteBranch = vi.fn().mockResolvedValue({ deleted: true })
    const confirm = vi.fn()
    await expect(
      deleteBranchConfirmingForce({ branchName: 'feature/x', deleteBranch, confirm })
    ).resolves.toBe(true)
    expect(deleteBranch).toHaveBeenCalledExactlyOnceWith('feature/x', false)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('未マージなら強制削除の確認を出し、承諾されたら強制削除して結果を返す', async () => {
    const deleteBranch = vi
      .fn()
      .mockResolvedValueOnce({ deleted: false, reason: 'not-fully-merged' })
      .mockResolvedValueOnce({ deleted: true })
    const confirm = vi.fn().mockReturnValue(true)
    await expect(
      deleteBranchConfirmingForce({ branchName: 'feature/x', deleteBranch, confirm })
    ).resolves.toBe(true)
    expect(confirm).toHaveBeenCalledExactlyOnceWith(buildForceDeleteConfirmMessage('feature/x'))
    expect(deleteBranch).toHaveBeenNthCalledWith(1, 'feature/x', false)
    expect(deleteBranch).toHaveBeenNthCalledWith(2, 'feature/x', true)
  })

  it('強制削除の確認をキャンセルしたら強制削除せずに false を返す', async () => {
    const deleteBranch = vi.fn().mockResolvedValue({ deleted: false, reason: 'not-fully-merged' })
    const confirm = vi.fn().mockReturnValue(false)
    await expect(
      deleteBranchConfirmingForce({ branchName: 'feature/x', deleteBranch, confirm })
    ).resolves.toBe(false)
    expect(deleteBranch).toHaveBeenCalledExactlyOnceWith('feature/x', false)
  })

  // 強制削除でも deleted: false が返った場合は、削除されていないものとして扱う
  it('強制削除の結果が deleted: false なら false を返す', async () => {
    const deleteBranch = vi.fn().mockResolvedValue({ deleted: false, reason: 'not-fully-merged' })
    const confirm = vi.fn().mockReturnValue(true)
    await expect(
      deleteBranchConfirmingForce({ branchName: 'feature/x', deleteBranch, confirm })
    ).resolves.toBe(false)
    expect(deleteBranch).toHaveBeenCalledTimes(2)
  })

  // エラーは呼び出し元(排他実行ヘルパー)がエラー state へ反映するため、握りつぶさない
  it('安全削除が reject したらそのまま伝播し、確認は出さない', async () => {
    const deleteBranch = vi.fn().mockRejectedValue(new Error('safe failed'))
    const confirm = vi.fn()
    await expect(
      deleteBranchConfirmingForce({ branchName: 'feature/x', deleteBranch, confirm })
    ).rejects.toThrow('safe failed')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('強制削除が reject したらそのまま伝播する', async () => {
    const deleteBranch = vi
      .fn()
      .mockResolvedValueOnce({ deleted: false, reason: 'not-fully-merged' })
      .mockRejectedValueOnce(new Error('force failed'))
    await expect(
      deleteBranchConfirmingForce({
        branchName: 'feature/x',
        deleteBranch,
        confirm: vi.fn().mockReturnValue(true)
      })
    ).rejects.toThrow('force failed')
  })
})
