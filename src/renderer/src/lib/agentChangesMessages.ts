import type {
  AgentChangeStatus,
  AgentChangesRun,
  AgentChangesState,
  AgentChangesUnavailableReason,
  AgentChangesUndoSummary,
  AgentRevertUndoOutcome,
  AgentRevertUndoUnavailableReason
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

/** 範囲の選択の見える文字のラベル */
export const AGENT_CHANGES_SCOPE_LABEL = '表示'
/** 実行の範囲の空の文言 */
export const AGENT_CHANGES_RUN_EMPTY = 'この実行では、変わったファイルはありません'
/** 実行の範囲の HEAD の帯(実行ごとの表示は戻せないため「戻すのはファイルの内容だけです」は付けない) */
export const AGENT_CHANGES_RUN_HEAD_CHANGED =
  'この実行の間に HEAD が変わりました（コミット・ブランチの切り替えなど）'
export const AGENT_CHANGES_START_NOT_RECORDED = '開始の状態を記録できませんでした'
export const AGENT_CHANGES_END_NOT_RECORDED = '次の実行の開始を記録できなかったため比べられません'

/** 区切りを取れなかった理由の短い形(選択の項目の文字に含める。L-057) */
export const AGENT_CHANGES_RUN_UNAVAILABLE_SHORT: Record<AgentChangesUnavailableReason, string> = {
  'not-repository': 'Git 管理外のフォルダです',
  'not-toplevel': 'リポジトリの最上位のフォルダではありません',
  'too-many-untracked': '未追跡のファイルが多すぎます',
  timeout: '時間がかかりすぎました',
  'git-failed': 'git を実行できませんでした'
}

// 開始の区切りを取れなかった理由の文字(選択の項目と、範囲の一覧が取れないときの理由で同じ文字にする)
const startNotRecordedText = (reason: AgentChangesUnavailableReason): string =>
  `${AGENT_CHANGES_START_NOT_RECORDED}: ${AGENT_CHANGES_RUN_UNAVAILABLE_SHORT[reason]}`

/** 選択の累積の項目 */
export function formatAgentChangesAllScopeOption(startedAt: number): string {
  return `すべて（累積・${formatAgentChangesStartedAt(startedAt)} から）`
}

// 実行の期間(HH:MM から・HH:MM〜HH:MM)
const runPeriod = (run: AgentChangesRun): string =>
  run.endedAt === null
    ? `${formatAgentChangesStartedAt(run.startedAt)} から`
    : `${formatAgentChangesStartedAt(run.startedAt)}〜${formatAgentChangesStartedAt(run.endedAt)}`

/** 選択の実行の項目。選べない実行は理由を含める */
export function formatAgentChangesRunOption(run: AgentChangesRun): string {
  const start = formatAgentChangesStartedAt(run.startedAt)
  switch (run.availability.kind) {
    case 'start-not-recorded':
      return `実行 ${run.number}（${start}・${startNotRecordedText(run.availability.reason)}）`
    case 'end-not-recorded':
      return `実行 ${run.number}（${start}〜・${AGENT_CHANGES_END_NOT_RECORDED}）`
    case 'available':
      return `実行 ${run.number}（${runPeriod(run)}）`
    default: {
      // 未知の種類を「選べる」項目の文字に黙って流さない
      const unknownAvailability: never = run.availability
      throw new Error(`未知の実行の選べるかの種類です: ${JSON.stringify(unknownAvailability)}`)
    }
  }
}

/** 実行の範囲の見出し。変更があれば件数(打ち切る前の全件数)を添える */
export function buildAgentChangesRunHeading(
  run: AgentChangesRun,
  totalCount: number | null
): string {
  const count = totalCount !== null && totalCount > 0 ? ` (${totalCount})` : ''
  return `${AGENT_CHANGES_HEADING}${count}（実行 ${run.number}・${runPeriod(run)}）`
}

/** 範囲の一覧が取れない理由(選択の項目と同じ理由。写しの実行に理由があれば添える) */
export function describeAgentChangesScopeUnavailable(
  reason: 'start-not-recorded' | 'end-not-recorded',
  run: AgentChangesRun | undefined
): string {
  if (reason === 'end-not-recorded') return AGENT_CHANGES_END_NOT_RECORDED
  return run?.availability.kind === 'start-not-recorded'
    ? startNotRecordedText(run.availability.reason)
    : AGENT_CHANGES_START_NOT_RECORDED
}

/** 打ち切った残りの件数 */
export function formatAgentChangesMore(hiddenCount: number): string {
  return `ほか ${hiddenCount} 件`
}

/** 取り直した後の読み上げ */
export function formatAgentChangesListedNotice(totalCount: number): string {
  return `エージェントの変更: ${totalCount} 件`
}

/** 戻す確認の取り消せる旨(大きさの上限は main でしか分からないため、結果で伝える) */
const AGENT_REVERT_UNDOABLE_NOTE =
  '戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。'
/** 戻す確認の取り消せない旨(追加されたフォルダ。renderer で先に分かる) */
const AGENT_REVERT_DIRECTORY_NOT_UNDOABLE_NOTE =
  'フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。'
/** 控えが取れなかった理由(結果の読み上げ。L-057) */
const AGENT_UNDO_UNAVAILABLE_REASON_TEXT: Record<AgentRevertUndoUnavailableReason, string> = {
  directory: 'フォルダを含む',
  'unsupported-type': 'ファイル以外のものを含む',
  'too-large': '内容が大きすぎる',
  'capture-failed': '戻した後の状態を控えられなかった'
}
const UNDO_HINT = '「戻した操作を取り消す」で取り消せます'
// 控えが取れなかったときの「<理由>ため、<対象>は取り消せません」(読み上げ・partial の警告で同じ形にする)
const notUndoable = (
  undo: Extract<AgentRevertUndoOutcome, { kind: 'unavailable' }>,
  subject = 'この操作'
): string => `${AGENT_UNDO_UNAVAILABLE_REASON_TEXT[undo.reason]}ため、${subject}は取り消せません`

/**
 * 戻した結果の文言に足す、取り消せるか・取り消せない理由。discarded(記録が置き換わった・終了中で控えを付けなかった)は
 * 帯が無いので取り消せるとは言えず、取り消せない理由を言うものでもないため、何も足さない
 */
const undoSuffix = (undo: AgentRevertUndoOutcome, savedText: string, subject?: string): string => {
  switch (undo.kind) {
    case 'saved':
      return savedText
    case 'unavailable':
      return notUndoable(undo, subject)
    case 'discarded':
      return ''
  }
}

/** 戻した後の読み上げ(取り消せるか・取り消せない理由を添える) */
export function formatAgentChangesRevertedNotice(
  count: number,
  undo: AgentRevertUndoOutcome
): string {
  return `${count} 件を実行前の状態に戻しました。${undoSuffix(undo, UNDO_HINT)}`
}

/** diff タブでハンクを戻した後の読み上げ(帯が見えていないときにも、どこで取り消すかを伝える) */
export function formatAgentChangesHunkRevertedNotice(undo: AgentRevertUndoOutcome): string {
  return `ハンクを実行前の状態に戻しました。${undoSuffix(undo, 'ソース管理の「エージェントの変更」で取り消せます')}`
}

/** すべて戻すの partial の警告(main の警告の後ろに、戻せた件数を取り消せるかを足す) */
export function formatAgentRevertPartialWarning(
  message: string,
  revertedCount: number,
  undo: AgentRevertUndoOutcome
): string {
  const suffix = undoSuffix(
    undo,
    `戻せた ${revertedCount} 件は${UNDO_HINT}`,
    `戻せた ${revertedCount} 件`
  )
  return suffix === '' ? message : `${message}。${suffix}`
}

/** 帯のボタンの見える文字 */
export const AGENT_CHANGES_UNDO_BUTTON = '戻した操作を取り消す'

/** 帯の対象(戻した操作の種類で決める。all は件数に関わらず「すべて戻す」) */
export function formatAgentChangesUndoTarget(summary: AgentChangesUndoSummary): string {
  const first = summary.entries[0]?.path ?? ''
  switch (summary.operation) {
    case 'all':
      return `${summary.entries.length} 件（すべて戻す）`
    case 'hunk':
      return `${first} のハンク`
    case 'file':
      return first
    default: {
      const unknownOperation: never = summary.operation
      throw new Error(`未知の戻した操作の種類です: ${JSON.stringify(unknownOperation)}`)
    }
  }
}

/** 帯の見える文字 */
export function formatAgentChangesUndoBandText(target: string): string {
  return `直前に戻した操作: ${target}`
}

/** 帯のボタンの aria-label。見える文字を切れ目なく先頭に置き、対象を後ろに足す(WCAG 2.5.3) */
export function formatAgentChangesUndoButtonLabel(target: string): string {
  return `${AGENT_CHANGES_UNDO_BUTTON}（直前: ${target}）`
}

const MAX_UNDO_LISTED_PATHS = 5

/** 取り消しの確認(何が戻るかを見せる。押し間違いの取り消しをさらに押し間違えない) */
export function buildAgentUndoConfirmMessage({
  summary,
  hasUnsavedEdits,
  agentRunning
}: {
  summary: AgentChangesUndoSummary
  /** 書き戻す・ゴミ箱へ移すパスのタブに未保存の編集があるか */
  hasUnsavedEdits: boolean
  agentRunning: boolean
}): string {
  const paths = summary.entries.map((entry) => entry.path)
  const rest = paths.length - MAX_UNDO_LISTED_PATHS
  const listed = [
    ...paths.slice(0, MAX_UNDO_LISTED_PATHS),
    ...(rest > 0 ? [formatAgentChangesMore(rest)] : [])
  ]
  const trashCount = summary.entries.filter((entry) => entry.action === 'trash').length
  const hasRecreate = summary.entries.some((entry) => entry.action === 'recreate')
  const appendix = [
    trashCount > 0
      ? `うち ${trashCount} 件は、戻したときに作り直したファイルのため、ゴミ箱へ移動します。`
      : null,
    hasRecreate ? 'ゴミ箱へ移したファイルは、ゴミ箱に残したまま元の場所に作り直します。' : null,
    hasUnsavedEdits ? 'エディタの未保存の編集も破棄されます。' : null,
    agentRunning
      ? 'エージェントが動いている間は、取り消した後に同じファイルが書き換えられることがあります。'
      : null
  ]
    .filter((text): text is string => text !== null)
    .map((text) => `\n\n${text}`)
    .join('')
  return `直前に戻した操作を取り消しますか？次のファイルが、戻す前の内容に戻ります。\n\n${listed.join('\n')}${appendix}`
}

/** 取り消しの結果の読み上げ */
export function formatAgentChangesUndoneNotice(count: number): string {
  return `戻した操作を取り消しました（${count} 件）`
}

export const AGENT_CHANGES_BUSY_LOADING = '一覧を取得しています'
export const AGENT_CHANGES_BUSY_GIT = '他の Git 操作の実行中です'
export const AGENT_CHANGES_BUSY_REVERTING = '戻す操作の実行中です'
export const AGENT_CHANGES_BUSY_UNDOING = '取り消しの実行中です'
export const AGENT_CHANGES_LIST_FAILED =
  '一覧の取得に失敗したため、戻す操作は使えません。「更新」で取り直してください'
export const AGENT_CHANGES_TRUNCATED_REASON =
  '変更が多すぎるため、すべて戻すは使えません。ファイルごとに戻すか、ターミナルで操作してください'
export const AGENT_CHANGES_NOT_RECORDED_REASON =
  '記録していないファイルがあるため、すべて戻すは使えません。ファイルごとに戻すか、ターミナルで操作してください'

/** 実行の範囲(読み取り専用)では戻すボタンを押せない理由 */
export const AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE =
  '実行ごとの表示では戻せません。「すべて（累積）」を選ぶと戻せます'

/** 選んでいた実行が消えた(保持の上限〈AGENT_CHANGES_MAX_RUNS〉を超えて捨てた・記録を捨てた)ときの読み上げ */
export function formatAgentChangesRunMissingNotice(runNumber: number): string {
  return `実行 ${runNumber} の記録は古くなったため消えました。すべて（累積）を表示します`
}

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
      ? `${path} を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。${AGENT_REVERT_UNDOABLE_NOTE}`
      : isDirectory
        ? `${path} をゴミ箱へ移動しますか？フォルダとその中身（.gitignore の対象を含む）がすべて移動します。${AGENT_REVERT_DIRECTORY_NOT_UNDOABLE_NOTE}`
        : `${path} をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）${AGENT_REVERT_UNDOABLE_NOTE}`
  return base + appendices(appendix)
}

/** ハンクを戻す確認の文言 */
export function buildAgentRevertHunkConfirmMessage({
  path,
  hunkHeader,
  ...appendix
}: { path: string; hunkHeader: string } & RevertAppendix): string {
  return (
    `${path} の次のハンクを実行前の状態に戻しますか？${AGENT_REVERT_UNDOABLE_NOTE}\n\n${hunkHeader}` +
    appendices(appendix)
  )
}

/** すべて戻す確認の文言。未保存の編集の破棄は confirmDiscardAnyDirty が別に確かめる */
export function buildAgentRevertAllConfirmMessage({
  count,
  trashCount,
  hasDirectory,
  savedInApp,
  agentRunning
}: {
  count: number
  /** そのうちゴミ箱へ移す(追加された)ファイル・フォルダの数 */
  trashCount: number
  /** 追加されたフォルダの行を含むか(取り消せない旨を出す) */
  hasDirectory: boolean
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
    `エージェントの変更 ${count} 件を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。${hasDirectory ? AGENT_REVERT_DIRECTORY_NOT_UNDOABLE_NOTE : AGENT_REVERT_UNDOABLE_NOTE}` +
    trash +
    '\nステージ（index）・コミット・ブランチは戻しません。' +
    saved +
    running
  )
}
