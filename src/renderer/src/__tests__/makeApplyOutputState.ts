import { vi } from 'vitest'
import type { ApplyOutputState } from '../types'
import type { ApplyActions } from '../components/output/ApplyButtons'

/**
 * テスト用の ApplyOutputState のモック。既定は「挿入も置換もできる・通知なし」。
 * apply は ApplyOutputState の型で vi.fn を作るため、契約から外れたモックは型検査で検出される(パターン 78)
 */
export const makeApplyOutputState = (
  overrides: Partial<ApplyOutputState> = {}
): ApplyOutputState => ({
  insertDisabledReason: null,
  replaceDisabledReason: null,
  apply: vi.fn<ApplyOutputState['apply']>(),
  notice: null,
  ...overrides
})

/** makeApplyActions の既定の reasonId(無効の理由を表示する要素の id) */
export const TEST_REASON_ID = 'apply-reason'

/**
 * テスト用の ApplyActions(コードブロック・ApplyButtons が使う反映の可否と操作)。可否と apply の既定は
 * makeApplyOutputState と同じで、reasonId は TEST_REASON_ID
 */
export const makeApplyActions = (overrides: Partial<ApplyActions> = {}): ApplyActions => {
  const { insertDisabledReason, replaceDisabledReason, apply } = makeApplyOutputState()
  return {
    insertDisabledReason,
    replaceDisabledReason,
    apply,
    reasonId: TEST_REASON_ID,
    ...overrides
  }
}
