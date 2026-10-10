import type { AgentReferenceUnavailableReason } from './agentReferenceCandidates'

// エージェントへ送るプロンプトの参照(チップ・エクスプローラのメニュー・読み上げ・送信前の確認の注意)の文言

/** プロンプトパネルの参照の行の名前 */
export const AGENT_REFERENCE_GROUP_LABEL = '参照'

/** 押せないチップに、パスの代わりに出す文言 */
export const AGENT_REFERENCE_CHIP_FALLBACK_LABELS = {
  openFile: '開いているファイル',
  selection: '選択範囲'
} as const

/** 押せるチップの title(何を添えるか) */
export const AGENT_REFERENCE_TOGGLE_TITLES = {
  openFile: '開いているファイルを参照として添える',
  selection: '選択範囲を参照として添える'
} as const

/** チップを押せない理由(title と aria-describedby で出す。差分のタブ・フォルダの外は参照の行に画面の文字としても出す) */
export const AGENT_REFERENCE_DISABLED_REASONS = {
  noOpenFile: '開いているファイルがありません',
  diffTab: '差分のタブは参照にできません',
  outsideFolder: 'フォルダの外のファイルは参照にできません',
  noSelection: 'エディタで範囲を選ぶと添えられます'
} as const satisfies Record<AgentReferenceUnavailableReason, string>

/** オンにしたチップのファイルに未保存の変更があるときの印 */
export const AGENT_REFERENCE_UNSAVED_MARK = '未保存'

/** エクスプローラの右クリックのメニューの項目 */
export const AGENT_REFERENCE_MENU_LABEL = '参照として添える'

/** エクスプローラから足したときの読み上げ */
export const formatAgentReferenceAddedAnnouncement = (label: string): string =>
  `参照に ${label} を足しました`

/** エクスプローラからすでに足してあるファイルをもう一度足そうとしたときの読み上げ */
export const formatAgentReferenceAlreadyAddedAnnouncement = (label: string): string =>
  `${label} はすでに参照にあります`

/** エクスプローラから足したファイルを外すボタンの名前 */
export const formatAgentReferenceRemoveLabel = (label: string): string => `${label} を参照から外す`

/** 送信前の確認のダイアログの未保存の注意(パスは表示用の相対パス) */
export const formatAgentUnsavedNotice = (paths: readonly string[]): string =>
  `未保存の変更があるファイルは、保存するまで claude に見えません: ${paths.join('、')}`
