import {
  AGENT_CLI_PROFILES,
  DEFAULT_AGENT_CLI_COMMAND_NAME,
  agentCliCapabilities
} from '@shared/agentCliKinds'
import type { AgentCliCapabilities, AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliKindSetting } from '@shared/types'

// 使うエージェント CLI の設定の文言(設計書 2026-10-20「文言」「設定」の「画面」)。設定の画面の項目・使えない機能の注記・
// 区別の精度の注記・既定に戻した旨・保存の失敗と、設定の エージェントの通知 に添える注記を置く。入口ごとの使えない理由は、その入口の文言の
// ファイル(agentSendMessages・agentInterruptMessages・agentSessionMessages)に置く。能力の名前は Record で持ち、
// 能力を足したときの決め忘れを型エラーにする

/** 能力の名前(設定の画面の「使えない機能」に並べる。並びは能力の表と同じ) */
export const AGENT_CLI_CAPABILITY_NAMES: Record<keyof AgentCliCapabilities, string> = {
  promptSend: 'プロンプトの送信（実行・再実行）',
  screenActivity: '作業中・入力待ちの表示と通知',
  interrupt: '中断',
  changeAttribution: '利用者の変更との区別',
  sessionResume: '前回の続きから・このセッションで再開'
}

export const AGENT_CLI_KIND_SECTION_TITLE = '使うエージェント CLI'
export const AGENT_CLI_KIND_SECTION_NOTE =
  'エージェント CLI 方式で使います。切り替えると、次の起動から使われます'
/** 設定の画面で、起動中のタブがあるときに選べない理由 */
export const AGENT_CLI_KIND_LOCKED_WHILE_STARTING =
  'エージェントの起動中は、使う CLI を切り替えられません'
/** 保存の失敗の文言の接頭辞。後ろに固定の理由(lib/settingsMessages の SETTINGS_FILE_ERROR_REASON)を付ける */
export const AGENT_CLI_KIND_SAVE_ERROR_PREFIX = '使うエージェント CLI を保存できませんでした: '

/** 選択肢の名前(`Claude Code（claude）`) */
export function agentCliKindOptionLabel(kind: AgentCliKind): string {
  const { displayName, commandName } = AGENT_CLI_PROFILES[kind]
  return `${displayName}（${commandName}）`
}

/** 選んだ CLI で使えない機能の注記(能力の表で false のものを並べる)。すべて使えるなら null */
export function agentCliUnsupportedFeaturesNote(kind: AgentCliKind): string | null {
  const capabilities = agentCliCapabilities(kind)
  const names = (Object.keys(AGENT_CLI_CAPABILITY_NAMES) as (keyof AgentCliCapabilities)[])
    .filter((key) => !capabilities[key])
    .map((key) => AGENT_CLI_CAPABILITY_NAMES[key])
  if (names.length === 0) return null
  return `${AGENT_CLI_PROFILES[kind].commandName} では次の機能を使えません（ターミナルで直接操作します）: ${names.join('、')}`
}

/**
 * 利用者の変更との区別の精度の注記(設計書 2026-10-26「画面の表示と文言」)。claude より粗い種類だけ文を持つ。設定の画面・変更の一覧の
 * 区別の状態の 1 行・すべて戻すの確認に出す。種類をキーにした表で、種類を足したときの決め忘れを型エラーにする
 */
export const AGENT_CLI_ATTRIBUTION_PRECISION_NOTES: Record<AgentCliKind, string | null> = {
  claude: null,
  copilot:
    'copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）'
}

/** 既定に戻した旨(main が読めなかった理由)。戻していなければ null */
export function agentCliFallbackNote(fallback: AgentCliKindSetting['fallback']): string | null {
  switch (fallback) {
    case null:
      return null
    case 'invalid-value':
      return `保存されていた値を読めなかったため ${DEFAULT_AGENT_CLI_COMMAND_NAME} を使っています（選び直すと保存します）`
    case 'read-failed':
      return `設定ファイルを読めなかったため ${DEFAULT_AGENT_CLI_COMMAND_NAME} を使っています`
  }
}

/** 今と同じ種類を選んでも保存するか。不正な値(invalid-value)の間だけ真(注記の「選び直すと保存します」のとおりに、選ばれている
 *  claude を押しても保存して不正な値を消す)。read-failed の注記は保存を約束していないので偽。設定の画面の部品と
 *  selectAgentCliKind が同じ規則を使う */
export function isAgentCliKindResaveAllowed(fallback: AgentCliKindSetting['fallback']): boolean {
  return fallback === 'invalid-value'
}

/** 設定の エージェントの通知 に添える注記。選んだ CLI が画面を判定しない(screenActivity が無い)ときだけ */
export function agentNotificationUnsupportedNote(kind: AgentCliKind): string | null {
  if (agentCliCapabilities(kind).screenActivity) return null
  return `${AGENT_CLI_PROFILES[kind].commandName} では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）`
}
