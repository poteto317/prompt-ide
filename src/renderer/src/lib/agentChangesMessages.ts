import type {
  AgentChangeStatus,
  AgentChangesState,
  AgentChangesUnavailableReason
} from '@shared/types'

// エージェントの変更のセクション・確認のダイアログの文言(設計書「A の詳細」「確認ダイアログの文言」)。
// 純粋関数だけを置く。押せる条件(どの理由を選ぶかの優先順位)は agentChangesAvailability.ts に置く

export const AGENT_CHANGES_HEADING = 'エージェントの変更'
export const AGENT_CHANGES_NONE_HINT = 'プロンプトの「実行」で、実行の前の状態の記録を始めます'
export const AGENT_CHANGES_EMPTY = '記録を始めてから、変わったファイルはありません'
export const AGENT_CHANGES_HEAD_CHANGED =
  '記録を始めた後に HEAD が変わりました（コミット・ブランチの切り替えなど）。戻すのはファイルの内容だけです'
export const AGENT_CHANGES_CLEARED_NOTICE = '記録を終えました。次の「実行」で新しい記録を始めます'
export const AGENT_CHANGES_SAVED_MARK = 'あなたの保存を含む'
export const AGENT_CHANGES_NOT_RECORDED_MARK = '記録していないため戻せません'
export const AGENT_CHANGES_LOADING = '更新中…'

export const AGENT_CHANGES_UNAVAILABLE_MESSAGES: Record<AgentChangesUnavailableReason, string> = {
  'not-repository': 'Git 管理外のフォルダでは、エージェントの変更を記録できません',
  'not-toplevel': 'リポジトリの最上位のフォルダを開いたときだけ、エージェントの変更を記録できます',
  'too-many-untracked':
    '未追跡のファイルが多すぎるため、記録できません。.gitignore を確かめてください',
  timeout: '記録に時間がかかりすぎたため、中止しました',
  'git-failed': 'git を実行できないため、記録できません'
}

/** 記録できない理由の文言。未追跡が多すぎるときは件数と合計を添える */
export function describeAgentChangesUnavailable(
  state: Extract<AgentChangesState, { kind: 'unavailable' }>
): string {
  const base = AGENT_CHANGES_UNAVAILABLE_MESSAGES[state.reason]
  if (state.reason !== 'too-many-untracked' || state.untrackedCount === undefined) return base
  const bytes = state.untrackedBytes ?? 0
  const size = bytes > 0 ? `・${(bytes / (1024 * 1024)).toFixed(1)} MB` : ''
  return `${base}（${state.untrackedCount.toLocaleString('ja-JP')} 件${size}）`
}

/** 記録を始めた時刻(HH:MM。表示用) */
export function formatAgentChangesStartedAt(startedAt: number): string {
  const date = new Date(startedAt)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 見出し。記録中は開始の時刻、変更があれば件数(打ち切る前の全件数)を添える */
export function buildAgentChangesHeading(
  recording: { startedAt: number; totalCount: number | null } | null
): string {
  if (recording === null) return AGENT_CHANGES_HEADING
  const since = `（${formatAgentChangesStartedAt(recording.startedAt)} から）`
  const count =
    recording.totalCount !== null && recording.totalCount > 0 ? ` (${recording.totalCount})` : ''
  return `${AGENT_CHANGES_HEADING}${count}${since}`
}

/** 打ち切った残りの件数 */
export function formatAgentChangesMore(hiddenCount: number): string {
  return `ほか ${hiddenCount} 件`
}

/** 取り直した後の読み上げ */
export function formatAgentChangesListedNotice(totalCount: number): string {
  return `エージェントの変更: ${totalCount} 件`
}

/** 戻した後の読み上げ */
export function formatAgentChangesRevertedNotice(count: number): string {
  return `${count} 件を実行前の状態に戻しました`
}

/** diff タブでハンクを戻した後の読み上げ */
export const AGENT_CHANGES_HUNK_REVERTED_NOTICE = 'ハンクを実行前の状態に戻しました'

export const AGENT_CHANGES_BUSY_LOADING = '一覧を取得しています'
export const AGENT_CHANGES_BUSY_GIT = '他の Git 操作の実行中です'
export const AGENT_CHANGES_BUSY_REVERTING = '戻す操作の実行中です'
export const AGENT_CHANGES_LIST_FAILED =
  '一覧の取得に失敗したため、戻す操作は使えません。「更新」で取り直してください'
export const AGENT_CHANGES_TRUNCATED_REASON =
  '変更が多すぎるため、すべて戻すは使えません。ファイルごとに戻すか、ターミナルで操作してください'
export const AGENT_CHANGES_NOT_RECORDED_REASON =
  '記録していないファイルがあるため、すべて戻すは使えません。ファイルごとに戻すか、ターミナルで操作してください'

interface RevertAppendix {
  /** 記録を始めた後にアプリで保存したファイルか(すべて戻すでは、そのようなファイルを含むか) */
  savedInApp: boolean
  /** 対象(フォルダなら配下)のタブに未保存の編集があるか */
  hasUnsavedEdits: boolean
  /** エージェントのセッションが動いているか */
  agentRunning: boolean
}

const appendices = ({ savedInApp, hasUnsavedEdits, agentRunning }: RevertAppendix): string =>
  [
    savedInApp ? 'このファイルは、記録を始めた後にアプリで保存されています。' : null,
    hasUnsavedEdits ? 'エディタの未保存の編集も破棄されます。' : null,
    agentRunning
      ? 'エージェントが動いている間は、戻した後に同じファイルが書き換えられることがあります。'
      : null
  ]
    .filter((text): text is string => text !== null)
    .map((text) => `\n\n${text}`)
    .join('')

/** ファイル単位で戻す確認の文言 */
export function buildAgentRevertFileConfirmMessage({
  path,
  status,
  isDirectory,
  ...appendix
}: { path: string; status: AgentChangeStatus; isDirectory: boolean } & RevertAppendix): string {
  const base =
    status !== 'A'
      ? `${path} を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。この操作は元に戻せません。`
      : isDirectory
        ? `${path} をゴミ箱へ移動しますか？フォルダとその中身（.gitignore の対象を含む）がすべて移動します。`
        : `${path} をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）`
  return base + appendices(appendix)
}

/** ハンクを戻す確認の文言 */
export function buildAgentRevertHunkConfirmMessage({
  path,
  hunkHeader,
  ...appendix
}: { path: string; hunkHeader: string } & RevertAppendix): string {
  return (
    `${path} の次のハンクを実行前の状態に戻しますか？この操作は元に戻せません。\n\n${hunkHeader}` +
    appendices(appendix)
  )
}

/** すべて戻す確認の文言。未保存の編集の破棄は confirmDiscardAnyDirty が別に確かめる */
export function buildAgentRevertAllConfirmMessage({
  count,
  trashCount,
  savedInApp,
  agentRunning
}: {
  count: number
  /** そのうちゴミ箱へ移す(追加された)ファイル・フォルダの数 */
  trashCount: number
  savedInApp: boolean
  agentRunning: boolean
}): string {
  const trash =
    trashCount > 0 ? `\nうち ${trashCount} 件の新しいファイル・フォルダはゴミ箱へ移動します。` : ''
  const saved = savedInApp ? '\n\n記録を始めた後にアプリで保存したファイルを含みます。' : ''
  const running = agentRunning
    ? '\n\nエージェントが動いている間は、戻した後に同じファイルが書き換えられることがあります。'
    : ''
  return (
    `エージェントの変更 ${count} 件を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。この操作は元に戻せません。` +
    trash +
    '\nステージ（index）・コミット・ブランチは戻しません。' +
    saved +
    running
  )
}
