import { vi } from 'vitest'
import type { RemoteSetupPanelState } from '../types'

/**
 * テスト用の RemoteSetupPanelState のモック。既定は「Git 操作を何も実行していない・エラーなし・各操作は成功する」。
 * 各操作は RemoteSetupPanelState の型で vi.fn を作るため、戻り値の契約(Promise<boolean>)から外れたモックは
 * 型検査で検出される(パターン 78)
 */
export const makeRemoteSetupPanelState = (
  overrides: Partial<RemoteSetupPanelState> = {}
): RemoteSetupPanelState => ({
  isInitializing: false,
  initError: null,
  initRepository: vi.fn<RemoteSetupPanelState['initRepository']>().mockResolvedValue(true),
  clearInitError: vi.fn<RemoteSetupPanelState['clearInitError']>(),
  isAddingOrigin: false,
  addOriginError: null,
  addOrigin: vi.fn<RemoteSetupPanelState['addOrigin']>().mockResolvedValue(true),
  clearAddOriginError: vi.fn<RemoteSetupPanelState['clearAddOriginError']>(),
  isSettingUpstream: false,
  isPushing: false,
  isPushBlocked: false,
  remoteOperationError: null,
  pushSetUpstream: vi.fn<RemoteSetupPanelState['pushSetUpstream']>().mockResolvedValue(true),
  ...overrides
})
