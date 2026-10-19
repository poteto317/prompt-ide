import type {
  AgentChangeAuthor,
  AgentChangeStatus,
  AgentChangesAttributionLostReason,
  AgentChangesAttributionSummary,
  AgentChangesRun,
  AgentChangesState,
  AgentChangesUnavailableReason,
  AgentChangesUndoSummary,
  AgentRevertUndoOutcome,
  AgentRevertUndoUnavailableReason
} from '@shared/types'

// エージェントの変更のセクション・確認のダイアログの文言(設計書「A の詳細」「確認ダイアログの文言」と、2026-10-13 の設計書の利用者の変更との区別の「確認の文言」)。
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
/** 記録の置き場の注記(記録中で、記録がアプリの一時領域の隠れた git のとき) */
export const AGENT_CHANGES_APP_STORAGE_NOTE =
  'Git 管理外のフォルダのため、アプリの一時領域に記録しています（node_modules などは記録しません）'
/** 記録の置き場の注記(記録の前で、Git 管理外のフォルダのとき) */
export const AGENT_CHANGES_APP_STORAGE_HINT =
  'Git 管理外のフォルダのため、記録はアプリの一時領域に置きます（node_modules などは記録しません）'

/** 行の印(累積の一覧で、エージェントのツールが動いていない間に変わった行・両方が変えた行) */
export const AGENT_CHANGES_USER_MARK = '利用者の変更'
export const AGENT_CHANGES_MIXED_MARK = '利用者の変更を含む'

/** 行の author の印(user・mixed だけ。agent・区別なし〈null〉は印を出さない) */
export function agentChangeAuthorMark(author: AgentChangeAuthor | null): string | null {
  if (author === 'user') return AGENT_CHANGES_USER_MARK
  if (author === 'mixed') return AGENT_CHANGES_MIXED_MARK
  return null
}

/** すべて戻すの上の除く旨(除く行が 1 件以上のとき) */
export function formatAgentChangesExcludedNote(count: number): string {
  return `すべて戻すは、利用者の変更（${count} 件）を除いて戻します`
}

/** 区別をやめた理由の文言(理由の型ごとに分ける。L-439) */
export const AGENT_CHANGES_ATTRIBUTION_LOST_REASONS: Record<
  AgentChangesAttributionLostReason,
  string
> = {
  'hooks-not-confirmed': 'claude の hooks から知らせが届きません',
  'receiver-unavailable': 'hooks の知らせの受け口を用意できませんでした',
  'claude-version-unsupported': 'claude の版が古いか、版を確かめられませんでした',
  'checkpoint-failed': '作業ツリーの記録に失敗しました'
}

/**
 * 区別している記録か(main の authorsOf の「区別していない記録」の逆。tracking なら区別を始めた後、lost なら印が残っている)。
 * 区別していない記録の確認の文言は今までどおり
 */
export function isAgentChangesAttributionDistinguishing(
  summary: AgentChangesAttributionSummary
): boolean {
  return summary.kind === 'tracking' ? summary.since !== null : summary.hadMarks
}

/** 区別の状態の 1 行の、印を付けていない間があった旨(tracking・lost の hadUnassignedSince) */
export const AGENT_CHANGES_UNASSIGNED_NOTE =
  'アプリの中で claude が動いていなかった間などの変更には、印を付けていません'

/**
 * 累積の一覧の上の区別の状態の 1 行(出さないなら null)。区別をやめた理由、区別を始めたのが記録の開始より後であること、
 * 印を付けていない間があったことを見える文字で伝える(L-057)
 */
export function describeAgentChangesAttribution(
  attribution: AgentChangesAttributionSummary,
  startedAt: number
): string | null {
  if (attribution.kind === 'lost') {
    const reason = AGENT_CHANGES_ATTRIBUTION_LOST_REASONS[attribution.reason]
    if (!attribution.hadMarks) {
      return `利用者の変更を区別できません（${reason}）。すべてエージェントの変更として表示します`
    }
    // やめた時点で開いていた区間(最後の区切りから lostAt まで)は印が付かないため、lostAt より前にも印の無い間があることを伝える
    const lost = `${formatAgentChangesStartedAt(attribution.lostAt)} から利用者の変更を区別できなくなりました（${reason}）。それ以降の変更には印を付けません`
    return attribution.hadUnassignedSince ? `${lost}。${AGENT_CHANGES_UNASSIGNED_NOTE}` : lost
  }
  if (attribution.since === null) return null
  const parts = [
    attribution.since > startedAt
      ? `利用者の変更の区別は ${formatAgentChangesStartedAt(attribution.since)} からです（それより前の変更には印を付けません）`
      : null,
    attribution.hadUnassignedSince ? AGENT_CHANGES_UNASSIGNED_NOTE : null
  ].filter((text): text is string => text !== null)
  return parts.length === 0 ? null : parts.join('。')
}

export const AGENT_CHANGES_UNAVAILABLE_MESSAGES: Record<AgentChangesUnavailableReason, string> = {
  // not-repository は記録の区切り(addRun の takeSnapshot)でだけ返り、実行の availability に入って範囲の選択に短い形（「実行の開始を記録していません: Git 管理外のフォルダです」）で出る。
  // セクションの理由は累積の始点の結果からしか来ず、始点は Git 管理外のフォルダを隠れた git で記録するため not-repository を返さない。この文言は型の網羅のためで、画面には届かない
  'not-repository': 'Git 管理外のフォルダになったため、記録できません',
  'not-toplevel': 'リポジトリの最上位のフォルダを開いたときだけ、エージェントの変更を記録できます',
  'too-many-untracked':
    '未追跡のファイルが多すぎるため、記録できません。.gitignore を確かめてください',
  'too-many-files':
    'ファイルが多すぎるため、記録できません。リポジトリを初期化してコミットするか、.gitignore で記録しないファイルを指定してください',
  'inside-git-dir':
    'Git のデータのフォルダ（.git の中・bare リポジトリ）では、エージェントの変更を記録できません',
  timeout: '記録に時間がかかりすぎたため、中止しました',
  'git-failed': 'git を実行できないため、記録できません'
}

/** 記録できない理由の文言。ファイルが多すぎるとき(too-many-untracked・too-many-files)は件数と合計を添える */
export function describeAgentChangesUnavailable(
  state: Extract<AgentChangesState, { kind: 'unavailable' }>
): string {
  const base = AGENT_CHANGES_UNAVAILABLE_MESSAGES[state.reason]
  const isTooMany = state.reason === 'too-many-untracked' || state.reason === 'too-many-files'
  if (!isTooMany || state.untrackedCount === undefined) return base
  const bytes = state.untrackedBytes ?? 0
  const size = bytes > 0 ? `・${(bytes / (1024 * 1024)).toFixed(1)} MB` : ''
  return `${base}（${state.untrackedCount.toLocaleString('ja-JP')} 件${size}）`
}

/** 時刻(HH:MM。表示用)。記録・実行の開始と終わりのほか、区別を始めた時刻(since)・区別をやめた時刻(lostAt)にも使う */
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
  'too-many-files': 'ファイルが多すぎます',
  'inside-git-dir': 'Git のデータのフォルダです',
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

/** すべて戻すの対象が 0 件(行がすべて利用者の変更・利用者の変更を含む)の理由 */
export const AGENT_CHANGES_ONLY_USER_REASON =
  '利用者の変更だけのため、すべて戻すの対象がありません。ファイルごとに戻してください'

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

/**
 * 区別している記録のすべて戻すの確認の順 1(エージェントの変更として戻る利用者の編集〈ツールの実行中・猶予・許可の確認の待ち・
 * claude の起動から最初のプロンプトまで・中断の後〉をすべて言う。L-152)
 */
export const AGENT_REVERT_ALL_DISTINGUISHING_NOTE =
  'エージェントのツールが動いている間（終わってから 2 秒・許可の確認を待つ間を含む）と、claude を起動してから最初のプロンプトを送るまで・中断（Esc）の後にあなたが編集した内容は、エージェントの変更として戻ります。'

/** 利用者の変更の行(user・mixed)を行の ↶ で戻す確認の追記(user も言い切らず mixed と同じ文。L-006) */
const AGENT_REVERT_FILE_USER_NOTE =
  'このファイル（フォルダ）には、エージェントのツールが動いていない間の変更（利用者の変更）が含まれます。'

/** すべて戻すの確認の、記録を始めた後の利用者の編集の部分(順 1〜5。区切りの空白・改行は入れずにつなぐ) */
function revertAllUserEditsNote(
  attribution: AgentChangesAttributionSummary,
  startedAt: number,
  excludedCount: number
): string {
  const parts: string[] = []
  if (!isAgentChangesAttributionDistinguishing(attribution)) {
    parts.push('記録を始めた後にあなたが編集した内容も戻ります。')
  } else {
    parts.push(AGENT_REVERT_ALL_DISTINGUISHING_NOTE)
    if (attribution.since !== null && attribution.since > startedAt) {
      parts.push(
        `${formatAgentChangesStartedAt(attribution.since)} より前のあなたの編集も戻ります。`
      )
    }
    if (attribution.hadUnassignedSince) {
      parts.push('アプリの中で claude が動いていなかった間などのあなたの編集も戻ります。')
    }
    if (attribution.kind === 'lost') {
      parts.push(
        `区別をやめた後（${formatAgentChangesStartedAt(attribution.lostAt)} から）のあなたの編集も戻ります。`
      )
    }
  }
  // 区別していない要約でも出す(一覧が古いまま記録だけが lost になった組み合わせで、除く行を伝えずに件数だけが減ることを防ぐ)
  if (excludedCount > 0) {
    parts.push(
      `利用者の変更 ${excludedCount} 件（印の付いた行）は戻しません。行の ↶ で個別に戻せます。`
    )
  }
  return parts.join('')
}

/** ファイル単位で戻す確認の文言。利用者の変更の行(user・mixed)は、今の文言の後(アプリで保存した旨などの前)にその旨を足す */
export function buildAgentRevertFileConfirmMessage({
  path,
  status,
  isDirectory,
  author,
  ...appendix
}: {
  path: string
  status: AgentChangeStatus
  isDirectory: boolean
  /** 行の区別(写しの entry.author。必須。L-060) */
  author: AgentChangeAuthor | null
} & RevertAppendix): string {
  const base =
    status !== 'A'
      ? `${path} を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。${AGENT_REVERT_UNDOABLE_NOTE}`
      : isDirectory
        ? `${path} をゴミ箱へ移動しますか？フォルダとその中身（.gitignore の対象を含む）がすべて移動します。${AGENT_REVERT_DIRECTORY_NOT_UNDOABLE_NOTE}`
        : `${path} をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）${AGENT_REVERT_UNDOABLE_NOTE}`
  const userNote =
    author === 'user' || author === 'mixed' ? `\n\n${AGENT_REVERT_FILE_USER_NOTE}` : ''
  return base + userNote + appendices(appendix)
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

/**
 * すべて戻す確認の文言。count・trashCount・hasDirectory・savedInApp は対象(除く行を除いた行)で求める。記録を始めた後の利用者の編集の
 * 部分は区別の状態で変える(順 1〜5)。未保存の編集の破棄は confirmDiscardAnyDirty が別に確かめる
 */
export function buildAgentRevertAllConfirmMessage({
  count,
  trashCount,
  hasDirectory,
  savedInApp,
  agentRunning,
  attribution,
  startedAt,
  excludedCount
}: {
  count: number
  /** そのうちゴミ箱へ移す(追加された)ファイル・フォルダの数 */
  trashCount: number
  /** 追加されたフォルダの行を含むか(取り消せない旨を出す) */
  hasDirectory: boolean
  savedInApp: boolean
  agentRunning: boolean
  /** 写しの記録の区別の要約(必須。L-060) */
  attribution: AgentChangesAttributionSummary
  /** 記録を始めた時刻(区別を始めたのが後かを比べる) */
  startedAt: number
  /** 除く行(利用者の変更・利用者の変更を含む)の件数 */
  excludedCount: number
}): string {
  const trash =
    trashCount > 0 ? `\nうち ${trashCount} 件の新しいファイル・フォルダはゴミ箱へ移動します。` : ''
  const saved = savedInApp ? '\n\n記録を始めた後にアプリで保存したファイルを含みます。' : ''
  const running = agentRunning
    ? '\n\nエージェントが動いている間は、戻した後に同じファイルが書き換えられることがあります。'
    : ''
  return (
    `エージェントの変更 ${count} 件を実行前の状態に戻しますか？${revertAllUserEditsNote(attribution, startedAt, excludedCount)}${hasDirectory ? AGENT_REVERT_DIRECTORY_NOT_UNDOABLE_NOTE : AGENT_REVERT_UNDOABLE_NOTE}` +
    trash +
    '\nステージ（index）・コミット・ブランチは戻しません。' +
    saved +
    running
  )
}
