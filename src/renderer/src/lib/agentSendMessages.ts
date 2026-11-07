import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentActivity } from './agentActivity'
import type { AgentSendFailure } from './agentPromptSend'

// プロンプトの送信の文言(設計書「プロンプトの送信」「セッションが無いときのボタン」「エラー処理」、2026-10-22「文言」)。
// claude の文言は段階 2b で 1 文字も変えていない。CLI で文が違う失敗は種類の表(AGENT_SEND_FAILURE_KIND_TEXTS)、ほかは CLI に
// 依らない共通の表(AGENT_SEND_FAILURE_COMMON_TEXTS)で、CLI の名前は AGENT_CLI_PROFILES[kind].commandName から作る。
// 文言には次の行動(待つ・答える・抜ける・送るか消す)と、消していない・Enter を送っていない・送り直していないことを入れる(L-597)

/** 送り先のタブの活動が入力待ちでないときの理由。押せない理由と送った後の失敗(screen-*)で同じ文にする(L-058)。活動を足したときの決め忘れを型エラーにする。
 *  外からは agentSendBlockedByActivityReason で引く(表は export しない) */
const AGENT_SEND_BLOCKED_BY_ACTIVITY: Record<
  Exclude<AgentActivity, 'idle'>,
  (commandName: string) => string
> = {
  working: (commandName) =>
    `${commandName} が作業中のため送信できません（作業が終わって入力待ちになってから、もう一度実行してください）`,
  permission: (commandName) =>
    `${commandName} が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）`,
  confirm: (commandName) =>
    `${commandName} が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）`,
  unknown: (commandName) =>
    `${commandName} が入力待ちか判定できないため送信できません（ターミナルの画面を確かめてから、もう一度実行してください）`
}

/** 実行・再実行・送信前の確認の押せない理由と、send の screen-* の文言(送り先のタブの活動が入力待ちでない) */
export function agentSendBlockedByActivityReason(
  activity: Exclude<AgentActivity, 'idle'>,
  commandName: string
): string {
  return AGENT_SEND_BLOCKED_BY_ACTIVITY[activity](commandName)
}

/**
 * 送り先のタブが中断の流れの間(1 回目を送ってから 2 回目の流れが終わり、1,000ms の待ちが明けるまで)の、実行・再実行・送信前の
 * 確認の押せない理由と、send の interrupting の文言。copilot は押せない間が約 1.1 秒＋IPC 2 往復なので、それを超える 2 秒で案内する
 */
export const RUN_DISABLED_INTERRUPTING =
  '中断を送ったばかりのため送信できません（2 秒ほど待ってから、もう一度実行してください）'

/** CLI で文が違う失敗の文言 */
interface AgentSendFailureKindTexts {
  /** 先頭が「!」(leading-bang) */
  leadingBang: (commandName: string) => string
  /** 本文が入力欄に入ったかを確かめられなかった(not-echoed) */
  notEchoed: (commandName: string) => string
}

/** 種類ごとの文言の表。外からは agentSendFailureMessage で引く(表は export しない) */
const AGENT_SEND_FAILURE_KIND_TEXTS: Record<AgentCliKind, AgentSendFailureKindTexts> = {
  claude: {
    leadingBang: () =>
      '先頭が「!」のプロンプトは、エージェントのシェルのコマンドとして実行されるため送信できません（先頭に空白を入れると送れます）',
    notEchoed: () =>
      'エージェントの入力欄に入りませんでした。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください'
  },
  // copilot は先頭の空白の後の ! ・ / も断る(案内は規則と同じ範囲で、空白・!・/ 以外の文字を足す)。not-echoed のときは Enter を送っておらず、本文が入力欄に
  // 残りうる
  copilot: {
    leadingBang: (commandName) =>
      `先頭（空白を除く）が「!」のプロンプトは、${commandName} のシェルのコマンドとして実行されるため送信できません（先頭に空白・「!」・「/」以外の文字を足すと送れます）`,
    notEchoed: (commandName) =>
      `${commandName} の入力欄に本文が入ったか確かめられなかったため、Enter を送りませんでした。ターミナルの画面を確かめてください（入力欄に本文が入っていれば、送るか消してください）`
  }
}

/** CLI に依らない失敗の文言。CLI で文が違う失敗(種類の表)と unsupported-cli(関数)は持たない。種類を足したときの決め忘れを型エラーにする */
export const AGENT_SEND_FAILURE_COMMON_TEXTS: Record<
  Exclude<AgentSendFailure, 'unsupported-cli' | 'leading-bang' | 'not-echoed'>,
  (commandName: string) => string
> = {
  empty: () => '送信する内容がありません',
  'too-long': () => 'プロンプトが長すぎます',
  'leading-slash': (commandName) =>
    `先頭（空白を除く）が「/」のプロンプトは、${commandName} のスラッシュコマンドとして実行されるため送信できません（先頭に空白・「!」・「/」以外の文字を足すと送れます）`,
  'not-accepting': () => 'エージェントが入力を受け付けていません',
  'input-not-found': () =>
    'エージェントの入力欄が見つかりません。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください',
  'clear-failed': () =>
    'エージェントの入力欄を空にできませんでした。ターミナルで入力欄を確かめてから、もう一度実行してください',
  interrupting: () => RUN_DISABLED_INTERRUPTING,
  'screen-working': (commandName) => agentSendBlockedByActivityReason('working', commandName),
  'screen-permission': (commandName) => agentSendBlockedByActivityReason('permission', commandName),
  'screen-confirm': (commandName) => agentSendBlockedByActivityReason('confirm', commandName),
  'screen-unknown': (commandName) => agentSendBlockedByActivityReason('unknown', commandName),
  'shell-mode': (commandName) =>
    `${commandName} がシェルのモードのため送信できません（ターミナルでシェルのモードを抜けてから、もう一度実行してください）`,
  'draft-present': (commandName) =>
    `${commandName} の入力欄に書きかけがあるため送信できません（書きかけは消していません。ターミナルで送るか消してから、もう一度実行してください）`,
  'input-undetermined': (commandName) =>
    `${commandName} の入力欄が空か確かめられなかったため送信できません（ターミナルの画面を確かめてから、もう一度実行してください）`,
  // 本文が入ったシェルのモードで Enter を押すと、本文がシェルのコマンドとして実行される(report.md の 1)ので、送るよう案内しない
  'shell-mode-after-paste': (commandName) =>
    `${commandName} の入力欄がシェルのモードに変わったため、Enter を送りませんでした。入力欄の本文は送らずに、ターミナルで消してからシェルのモードを抜けてください（Enter を押すとシェルのコマンドとして実行されます）`,
  'not-confirmed': (commandName) =>
    `${commandName} に送れたか確かめられませんでした。ターミナルの画面を確かめてください（入力欄に本文が残っていれば、送るか消してください）`
}

/**
 * 送信の失敗の文言。送り先の CLI の種類で引く(kind は省略できない。L-060)。unsupported-cli は実行ボタンの理由と同じ関数、
 * leading-bang・not-echoed は種類の表、ほかは共通の表
 */
export function agentSendFailureMessage(reason: AgentSendFailure, kind: AgentCliKind): string {
  const { commandName } = AGENT_CLI_PROFILES[kind]
  switch (reason) {
    case 'unsupported-cli':
      return agentPromptSendUnsupportedReason(commandName)
    case 'leading-bang':
      return AGENT_SEND_FAILURE_KIND_TEXTS[kind].leadingBang(commandName)
    case 'not-echoed':
      return AGENT_SEND_FAILURE_KIND_TEXTS[kind].notEchoed(commandName)
    default:
      return AGENT_SEND_FAILURE_COMMON_TEXTS[reason](commandName)
  }
}

/**
 * 送信の手順が止まった失敗のうち表の discardHeldInputOn に載るもの(AGENT_PROMPT_SEND_SPECS。copilot は貼り付けの後の失敗、
 * claude は許可待ち・確認待ち)で、送信の手順の間に利用者が打ったキー入力を捨てたときに、
 * 失敗の文言の後ろに添える文。捨てた入力があったときだけ添える
 */
export const AGENT_SEND_HELD_INPUT_DISCARDED_SUFFIX =
  '。送信の間にターミナルで打ったキー入力は、送らずに捨てました'

/** 送信の途中で例外が起きたとき(pty への書き込みの失敗など)の文言の接頭辞。後ろに理由を付ける */
export const AGENT_SEND_ERROR_PREFIX = 'エージェントへ送信できませんでした: '

export const AGENT_SENT_NOTICE = 'エージェントに送信しました'

/** 実行ボタンの aria-label。可視の文言「実行」で始める(パターン 76) */
export const PROMPT_RUN_ARIA_LABEL_AGENT = '実行（エージェントに送信）'
export const PROMPT_RUN_ARIA_LABEL_LEGACY = 'プロンプトを実行'
/**
 * 書きかけがあると判定できたとき(clearedDraft)の通知。clearedDraft は画面の属性からの判定で、書きかけを
 * 見逃す(空と判定される形の書きかけ)・空のシェルのモードを書きかけとみなす場合がある(設計書の既知の制約)。
 * そのため、送信したことを先に伝え、書きかけについては参考として断定しない言い方で添える
 */
export const AGENT_SENT_AFTER_CLEAR_NOTICE =
  'エージェントに送信しました（入力欄に書きかけがあったようなので、消してから送りました）'

export const RUN_DISABLED_LOADING_MODE = '設定を読み込んでいます'
export const RUN_DISABLED_NO_SESSION =
  'エージェントが起動していません（ターミナルの「起動」を押してください）'
export const RUN_DISABLED_SENDING = 'エージェントへ送信しています'
export const RUN_DISABLED_CLOSING = 'このタブを閉じています（エージェントを終了しています）'
/** 実行・履歴の再実行・送信前の確認の送れない理由と、send の unsupported-cli の文言(送り先の CLI が送信に対応していない) */
export function agentPromptSendUnsupportedReason(commandName: string): string {
  return `${commandName} へのプロンプトの送信には、まだ対応していません（ターミナルに直接入力してください）`
}
export const RERUN_DISABLED_AGENT_MODE =
  'エージェント CLI 方式では再実行できません（設定で従来の方式に切り替えると使えます）'
/** エージェント CLI 方式で記録した履歴(agent のあるエントリ)を、従来の方式で再実行しようとしたとき */
export const RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE =
  'エージェント CLI 方式で記録した履歴は、エージェント CLI 方式でだけ再実行できます'
/**
 * エージェントのエントリを、記録したフォルダと違うフォルダで(またはフォルダを開かずに)再実行しようとしたとき。記録した全文の
 * @相対パス は記録したフォルダからのもので、別のフォルダの claude には別のファイルとして解釈されるため(このセッションで再開 の
 * agentResumeEntryFolderMismatch と同じ形)
 */
export function rerunDisabledAgentEntryFolderMismatch(folderPath: string): string {
  return `記録したフォルダ（${folderPath}）を開いているときだけ再実行できます`
}
