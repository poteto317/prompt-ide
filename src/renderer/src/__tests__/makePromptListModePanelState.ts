import { vi } from 'vitest'
import type { PromptListModePanelState } from '../types'

// 一覧の編集モード / 表示モードの状態の型付きの偽物(1 か所から作る)。既定は「読み込み済みの編集モード・保存の失敗なし」

export function makePromptListModePanelState(
  overrides: Partial<PromptListModePanelState> = {}
): PromptListModePanelState {
  return {
    mode: 'edit',
    saveError: null,
    isSaving: false,
    onChange: vi.fn<PromptListModePanelState['onChange']>(),
    ...overrides
  }
}
