import type { AgentCliCapabilities, AgentCliKind } from '@shared/agentCliKinds'

// 能力の表を差し替えて「能力が無い種類」を作るテストの補助(設計書 2026-10-21「段階 1 の『判定しない・押せない』の扱い」、
// 2026-10-22「文言」の agentPromptSendUnsupportedReason、2026-10-23「実装の分割」の 3)。今の表には画面の判定・中断・送信・再開・利用者の変更との区別の
// 能力が無い種類が無いため、vi.mock('@shared/agentCliKinds') の factory から使う

/** 差し替える種類(テストが足し、afterEach で消す) */
export interface AgentCliCapabilityOverrides {
  /** 画面の判定(screenActivity)・中断(interrupt)・許可の確認への答え(permissionAnswer)を偽にする種類 */
  unsupportedKinds: Set<AgentCliKind>
  /** 許可の確認への答え(permissionAnswer)だけを偽にする種類(screenActivity・interrupt は真のまま。能力の項目を読んでいることの区別に使う。足さないテストは省略できる) */
  permissionAnswerUnsupportedKinds?: Set<AgentCliKind>
  /** プロンプトの送信(promptSend)を偽にする種類(段階 2b で copilot も送信に対応したため、送信に対応しない種類を作るときに使う) */
  promptSendUnsupportedKinds: Set<AgentCliKind>
  /** 会話の再開(sessionResume)を偽にする種類(段階 3a で copilot も再開に対応したため、再開に対応しない種類を作るときに使う) */
  sessionResumeUnsupportedKinds: Set<AgentCliKind>
  /** 利用者の変更との区別(changeAttribution)を偽にする種類(段階 3b で copilot も区別に対応したため、区別に対応しない種類を作るときに使う) */
  changeAttributionUnsupportedKinds: Set<AgentCliKind>
}

/**
 * 本物の agentCliCapabilities を包み、unsupportedKinds の種類は screenActivity・interrupt・permissionAnswer を、promptSendUnsupportedKinds の種類は
 * promptSend を、sessionResumeUnsupportedKinds の種類は sessionResume を、changeAttributionUnsupportedKinds の種類は changeAttribution を偽にして返す(能力の表の不変条件「interrupt・permissionAnswer が真なら
 * screenActivity も真」を保つため、1 つ目は 3 つとも偽にする)
 */
export function overrideAgentCliCapabilities(
  actual: (kind: AgentCliKind) => AgentCliCapabilities,
  overrides: AgentCliCapabilityOverrides
): (kind: AgentCliKind) => AgentCliCapabilities {
  return (kind) => {
    const capabilities = { ...actual(kind) }
    if (overrides.unsupportedKinds.has(kind)) {
      capabilities.screenActivity = false
      capabilities.interrupt = false
      capabilities.permissionAnswer = false
    }
    if (overrides.permissionAnswerUnsupportedKinds?.has(kind)) capabilities.permissionAnswer = false
    if (overrides.promptSendUnsupportedKinds.has(kind)) capabilities.promptSend = false
    if (overrides.sessionResumeUnsupportedKinds.has(kind)) capabilities.sessionResume = false
    if (overrides.changeAttributionUnsupportedKinds.has(kind))
      capabilities.changeAttribution = false
    return capabilities
  }
}
