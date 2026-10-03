import { vi } from 'vitest'
import type { CloneRepositoryPanelState } from '../types'

/**
 * テスト用の CloneRepositoryPanelState のモック。既定は「clone していない・他の操作中でない・エラーなし・clone は成功する」。
 * 各操作は CloneRepositoryPanelState の型で vi.fn を作るため、戻り値の契約から外れたモックは型検査で検出される(パターン 78)
 */
export const makeCloneRepositoryPanelState = (
  overrides: Partial<CloneRepositoryPanelState> = {}
): CloneRepositoryPanelState => ({
  isCloning: false,
  isBlocked: false,
  error: null,
  cloneRepository: vi.fn<CloneRepositoryPanelState['cloneRepository']>().mockResolvedValue(true),
  cancelClone: vi.fn<CloneRepositoryPanelState['cancelClone']>(),
  clearError: vi.fn<CloneRepositoryPanelState['clearError']>(),
  ...overrides
})
