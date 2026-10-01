import { vi } from 'vitest'
import type { ConflictFileState } from '../hooks/useConflictFile'

/**
 * テスト用の ConflictFileState(useConflictFile の戻り値)のモック。既定は「未選択・読み込み済み・
 * 操作は成功する」。各操作は ConflictFileState の型で vi.fn を作るため、戻り値の契約
 * (chooseBlock は Promise<boolean> など)から外れたモックは型検査で検出される
 */
export const makeConflictFileState = (
  overrides: Partial<ConflictFileState> = {}
): ConflictFileState => ({
  file: null,
  isLoading: false,
  error: null,
  pendingOperation: null,
  chooseBlock: vi.fn<ConflictFileState['chooseBlock']>().mockResolvedValue(true),
  resolveWholeFile: vi.fn<ConflictFileState['resolveWholeFile']>().mockResolvedValue(undefined),
  keepFile: vi.fn<ConflictFileState['keepFile']>().mockResolvedValue(undefined),
  removeFile: vi.fn<ConflictFileState['removeFile']>().mockResolvedValue(undefined),
  markResolved: vi.fn<ConflictFileState['markResolved']>().mockResolvedValue(undefined),
  ...overrides
})
