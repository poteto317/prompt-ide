import { vi } from 'vitest'
import type { GitTagPanelState } from '../types'

/**
 * テスト用の GitTagPanelState(useGitTagOperations の戻り値)のモック。既定は「実行していない・
 * エラーなし・作成は成功する」。各操作は GitTagPanelState の型で vi.fn を作るため、戻り値の契約
 * (createTag は Promise<boolean>)から外れたモックは型検査で検出される(パターン 78)
 */
export const makeGitTagPanelState = (
  overrides: Partial<GitTagPanelState> = {}
): GitTagPanelState => ({
  isCreating: false,
  error: null,
  createTag: vi.fn<GitTagPanelState['createTag']>().mockResolvedValue(true),
  clearError: vi.fn<GitTagPanelState['clearError']>(),
  ...overrides
})
