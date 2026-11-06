// src/renderer/src/lib/agentPermissionAnswer.ts
import { AGENT_CLI_PROFILES, agentCliCapabilities } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentActivity } from './agentActivity'
import type { AgentSessionStatus } from './agentSessionTabState'
import type { ViewportLine } from './agentViewport'
import { classifyAgentScreenFor } from './agentScreenClassifiers'
import type {
  AgentPermissionChoice,
  AgentPermissionOption,
  AgentPermissionPrompt
} from './agentPermissionPrompt'
import { findAgentPermissionOption, isSameAgentPermissionPrompt } from './agentPermissionPrompt'
import { AGENT_PERMISSION_PROMPT_READERS } from './agentPermissionPromptReaders'
import {
  AGENT_PERMISSION_ANSWER_DISABLED_BODY_CUT,
  AGENT_PERMISSION_ANSWER_DISABLED_CLOSING,
  AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN,
  AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING,
  AGENT_PERMISSION_ANSWER_DISABLED_JUST_APPEARED,
  AGENT_PERMISSION_ANSWER_DISABLED_PANEL_CLOSED,
  AGENT_PERMISSION_ANSWER_DISABLED_SCROLLED_UP,
  AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM,
  AGENT_PERMISSION_ANSWER_DISABLED_SENDING,
  AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE,
  AGENT_PERMISSION_ANSWER_PROMPT_CHANGED,
  agentPermissionAnswerNoLongerPermissionReason,
  agentPermissionAnswerNotPermissionReason,
  agentPermissionAnswerNotRunningReason,
  agentPermissionAnswerNumberKeysRejectedReason,
  agentPermissionAnswerOptionMissingReason,
  agentPermissionAnswerUnsupportedReason
} from './agentPermissionAnswerMessages'

// 帯の 許可・拒否 を押せるかの判定(設計書 2026-11-06「押せるかの判定」)。描画(useAgentPermissionAnswer が求め、表示の値〈agentPermissionAnswerView.ts〉の
// disabledReason にする)と、押した処理の先頭の判定(checkAgentPermissionAnswerAtPress の段階 (a)。L-058)で同じ関数を使う。帯に出す条件
// (isAgentPermissionAnswerVisible。描画の読み取りが働く条件)と、押した時点の画面の読み直し(段階 (b)〜(f))もここで決める

/**
 * 押してから、そのタブの 許可・拒否 を押せない間。claude は許可した直後に同じ問い・選択肢・本文の許可の確認を続けて出すことがあり、
 * 照合では区別できないため、2 回目のタップが読んでいない確認に答えるのを防ぐ。値は中断と同じ(L-408)
 */
export const AGENT_PERMISSION_ANSWER_COOLDOWN_MS = 1_000

/**
 * 許可の確認が帯に出てから(またはその確認が別の確認に替わってから)、そのタブの 許可・拒否 を押せない間。許可・拒否 は利用者の操作では
 * なく CLI の出力をきっかけに 中断 の直前へ挿し込まれ、幅が足りず帯の要素が縮んでいるとき(帯があふれる幅、または記録があって 変更を確認 が縮む幅)は 中断・終了 が右へずれて、中断 のあった位置に 許可、終了 のあった位置に
 * 拒否 が来る。中断 を押そうとした 1 回目のクリック(detail 1)が、出たばかりの 許可 に届いて Yes を送るのを防ぐ
 * (useAgentPermissionAnswerAppearGrace)
 */
export const AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS = 1_000

export interface AgentPermissionAnswerAvailabilityInput {
  status: AgentSessionStatus
  cliKind: AgentCliKind
  isClosing: boolean
  activity: AgentActivity
  isSending: boolean
  isSendConfirmOpen: boolean
  /** 対象のタブが中断の流れの間(useAgentInterrupt の isInterruptPending / isInterrupting) */
  isInterrupting: boolean
  /**
   * 対象のタブが、答えを送っている途中か、押してから 1,000ms 以内か、送った後の画面の読み直し待ち(タブごと。3 つの和。
   * useAgentPermissionAnswerCooldown の isPending / isPendingNow)。読み直し待ちを含めるので、読み直す前に prompt が null でも
   * 「読み取れない」ではなく「答えを押した直後です」の理由になる
   */
  isAnswering: boolean
  /**
   * 許可の確認が帯に出た(または別の確認に替わった)描画から AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS 以内
   * (useAgentPermissionAnswerAppearGrace の isJustAppeared / isJustAppearedNow)
   */
  isJustAppeared: boolean
  /**
   * エージェントのパネルを開いているか(useAgentTerminalPanel の isOpen)。閉じている間はターミナル本体が隠れ、許可する内容(コマンドなど)を
   * 確かめられないため 許可 だけを押せなくする(拒否 は実行されない側なので押せる)
   */
  isPanelOpen: boolean
  /**
   * ターミナルの表示が画面の末尾にあるか(isViewportAtBottom。描画は controller の onScroll・onOutputWritten・onResized をきっかけに読んだ値
   * 〈useAgentTerminalScrolledToBottom〉、押した時点は controller.isScrolledToBottom() を直接読んだ値)。上へスクロールして前の出力を
   * 読み返している間は、画面の末尾に描かれた許可の確認が見えないため 許可 だけを押せなくする(拒否 は押せる)
   */
  isScrolledToBottom: boolean
  /** 描画に使った読み取り(useAgentPermissionPrompt の prompt) */
  prompt: AgentPermissionPrompt | null
}

export interface AgentPermissionAnswerAvailability {
  /** 帯に出すか(running・能力あり・permission) */
  visible: boolean
  /**
   * 押せない理由。押せるなら null。送る選択肢は返さない(送る番号は押した時点の判定〈checkAgentPermissionAnswerAtPress〉の結果だけ。
   * 名前の番号は表示の値〈agentPermissionAnswerView.ts〉が描画の読み取りから引く。L-594)
   */
  reason: string | null
}

const commandNameOf = (kind: AgentCliKind): string => AGENT_CLI_PROFILES[kind].commandName

/** 帯に出すかを決める値(描画の読み取り〈useAgentPermissionPrompt〉が働く条件と同じ) */
export type AgentPermissionAnswerVisibilityInput = Pick<
  AgentPermissionAnswerAvailabilityInput,
  'status' | 'cliKind' | 'activity'
>

/** 帯に出さない理由(動いていない → 能力が無い → 許可待ちでない) */
function hiddenReasonOf(input: AgentPermissionAnswerVisibilityInput): string | null {
  // starting の間は活動が unknown なので許可待ちにならない。running だけで出す
  if (input.status !== 'running')
    return agentPermissionAnswerNotRunningReason(commandNameOf(input.cliKind))
  if (!agentCliCapabilities(input.cliKind).permissionAnswer) {
    return agentPermissionAnswerUnsupportedReason(commandNameOf(input.cliKind))
  }
  if (input.activity !== 'permission') {
    return agentPermissionAnswerNotPermissionReason(commandNameOf(input.cliKind))
  }
  return null
}

/**
 * 帯に 許可・拒否 を出すか(running・能力あり・permission)。描画の読み取り(useAgentPermissionPrompt)が働く条件にも使い、
 * 出す条件と読む条件を 1 か所で決める(片方だけ変えると、出ているのに「読み取れない」になる・出ていないのに読み続ける)
 */
export function isAgentPermissionAnswerVisible(
  input: AgentPermissionAnswerVisibilityInput
): boolean {
  return hiddenReasonOf(input) === null
}

/**
 * 帯に出したうえで押せない理由のうち、画面の読み取りに依らないもの(閉じる途中 → 送信中 → 確認の表示中 → 中断の流れ → 答えた直後)。
 * 答えた直後を先に見るのは、答えた後に続けて出た確認では「答えを押した直後です」のほうが利用者に役立つため。確認が出た直後はここに入れない
 * (getAgentPermissionAnswerAvailability の最後に見る)
 */
function flagReasonOf(input: AgentPermissionAnswerAvailabilityInput): string | null {
  if (input.isClosing) return AGENT_PERMISSION_ANSWER_DISABLED_CLOSING
  if (input.isSending) return AGENT_PERMISSION_ANSWER_DISABLED_SENDING
  if (input.isSendConfirmOpen) return AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM
  if (input.isInterrupting) return AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING
  if (input.isAnswering) return AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN
  return null
}

/**
 * 読み取れた許可の確認で番号キーが効かない理由。効くなら null。その選択肢があるかの judgeOption と組で、描画の判定〈promptReasonOf〉と
 * 押した時点の判定〈checkAgentPermissionAnswerAtPress の段階 (d)・(f)〉が同じ規則を使う。どちらもこの理由を選択肢より先に見る
 */
function numberKeysReasonOf(prompt: AgentPermissionPrompt, cliKind: AgentCliKind): string | null {
  return prompt.numberKeysAccepted ? null : agentPermissionAnswerNumberKeysRejectedReason(cliKind)
}

/** その選択肢があるかの判定(judgeOption)の結果。押せるときの option は押した時点の判定(段階 (f))だけが送る番号に使う */
type OptionJudgement =
  | { reason: string; option: null }
  | { reason: null; option: AgentPermissionOption }

function judgeOption(
  prompt: AgentPermissionPrompt,
  choice: AgentPermissionChoice
): OptionJudgement {
  const option = findAgentPermissionOption(prompt, choice)
  if (option === null)
    return { reason: agentPermissionAnswerOptionMissingReason(choice), option: null }
  return { reason: null, option }
}

/** 読み取りに依る理由(読み取れない → 番号キーが効かない → その選択肢が無い)。どれにも当たらなければ null */
function promptReasonOf(
  prompt: AgentPermissionPrompt | null,
  cliKind: AgentCliKind,
  choice: AgentPermissionChoice
): string | null {
  if (prompt === null) return AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE
  return numberKeysReasonOf(prompt, cliKind) ?? judgeOption(prompt, choice).reason
}

/** パネルを閉じている間の理由(許可 だけ。拒否 は実行されない側なので止めない) */
function panelReasonOf(isPanelOpen: boolean, choice: AgentPermissionChoice): string | null {
  return !isPanelOpen && choice === 'allow' ? AGENT_PERMISSION_ANSWER_DISABLED_PANEL_CLOSED : null
}

/** ターミナルを上へスクロールしている間の理由(許可 だけ) */
function scrollReasonOf(isScrolledToBottom: boolean, choice: AgentPermissionChoice): string | null {
  return !isScrolledToBottom && choice === 'allow'
    ? AGENT_PERMISSION_ANSWER_DISABLED_SCROLLED_UP
    : null
}

/**
 * 本文の上の端が画面に無い間の理由(許可 だけ)。読み取り(描画のもの、押した時点では読み直したもの)の bodyStartVisible を見る。
 * 描画の判定と押した時点の判定(段階 (f) の後)が同じ規則を使う
 */
function bodyReasonOf(prompt: AgentPermissionPrompt, choice: AgentPermissionChoice): string | null {
  return !prompt.bodyStartVisible && choice === 'allow'
    ? AGENT_PERMISSION_ANSWER_DISABLED_BODY_CUT
    : null
}

export function getAgentPermissionAnswerAvailability(
  input: AgentPermissionAnswerAvailabilityInput,
  choice: AgentPermissionChoice
): AgentPermissionAnswerAvailability {
  const hidden = hiddenReasonOf(input)
  if (hidden !== null) return { visible: false, reason: hidden }
  // パネルを閉じている(許可 だけ)は、読み取りに依る理由の後・確認が出た直後の前に見る。パネルを開いても押せない理由(読み取れない・
  // 番号キーが効かない・その選択肢が無い)を隠さず、待っても解けない理由を「少し待つと押せます」で隠さない。
  // ターミナルを上へスクロールしている(許可 だけ)はパネルを閉じている理由の次に見る(閉じている間は、まず開いてもらう)。
  // 本文の上の端が画面に無い(許可 だけ)はスクロールしている理由の次に見る(末尾へ戻した後の高さで決まる)。
  // 確認が出た直後は「それさえ無ければ押せる」ときだけ出す理由なので最後に見る。読み取りに依る理由(特に番号キーが効かない)より先に
  // 見ると、入力欄に文字を打つたびに別の確認として猶予が始め直され、待っても押せない本来の理由が「少し待つと押せます」で隠れる
  return {
    visible: true,
    reason:
      flagReasonOf(input) ??
      promptReasonOf(input.prompt, input.cliKind, choice) ??
      panelReasonOf(input.isPanelOpen, choice) ??
      scrollReasonOf(input.isScrolledToBottom, choice) ??
      (input.prompt === null ? null : bodyReasonOf(input.prompt, choice)) ??
      (input.isJustAppeared ? AGENT_PERMISSION_ANSWER_DISABLED_JUST_APPEARED : null)
  }
}

/** 押した時点の判定の結果(useAgentPermissionAnswer の手順 2) */
export type AgentPermissionAnswerPressCheck =
  /** optionNumber は押した時点の読み取りの選択肢の番号(送る値はこれだけ。L-594) */
  | { kind: 'send'; optionNumber: number }
  /** 押せない(理由を読み上げる) */
  | { kind: 'blocked'; reason: string }
  /** 画面を読めない(送らず、読み上げもしない。呼び出し側が console に記録する) */
  | { kind: 'unreadable'; error: unknown }

/**
 * 押した時点の値で送ってよいかを決める(設計書「押した時点の判定のやり直し」の段階 (a)〜(g))。
 * (a) 描画と同じ規則の可否(画面は読まない) → (b) 画面を 1 回だけ読み、許可待ちか → (c) 同じ行を読み取れるか → (d) 番号キーが効くか →
 * (e) 描画の読み取りと完全一致か(L-036) → (f) その選択肢があるか → (f') 許可 なら本文の上の端が画面にあるか → (g) 送る。(d) を (e) より先に見るのは、入力欄が開いた画面は
 * 選択肢の文言も変わりうるが、利用者に役立つのは入力欄のほうの理由のため
 */
export function checkAgentPermissionAnswerAtPress(
  input: AgentPermissionAnswerAvailabilityInput,
  choice: AgentPermissionChoice,
  readScreen: () => readonly ViewportLine[]
): AgentPermissionAnswerPressCheck {
  const { reason } = getAgentPermissionAnswerAvailability(input, choice)
  if (reason !== null) return { kind: 'blocked', reason }
  let lines: readonly ViewportLine[]
  try {
    lines = readScreen()
  } catch (error) {
    return { kind: 'unreadable', error }
  }
  if (classifyAgentScreenFor(input.cliKind, lines) !== 'permission') {
    return {
      kind: 'blocked',
      reason: agentPermissionAnswerNoLongerPermissionReason(commandNameOf(input.cliKind))
    }
  }
  const pressed = AGENT_PERMISSION_PROMPT_READERS[input.cliKind](lines)
  if (pressed === null)
    return { kind: 'blocked', reason: AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE }
  const numberKeysReason = numberKeysReasonOf(pressed, input.cliKind)
  if (numberKeysReason !== null) return { kind: 'blocked', reason: numberKeysReason }
  // (a) を通ったので input.prompt は null でない(型のために確かめる)
  if (input.prompt === null || !isSameAgentPermissionPrompt(input.prompt, pressed)) {
    return { kind: 'blocked', reason: AGENT_PERMISSION_ANSWER_PROMPT_CHANGED }
  }
  const judged = judgeOption(pressed, choice)
  if (judged.option === null) return { kind: 'blocked', reason: judged.reason }
  // 照合は bodyStartVisible を比べないので、押した時点で読み直した値で確かめる(罫線だけが画面から流れ、本文が同じ画面でも止める)
  const bodyReason = bodyReasonOf(pressed, choice)
  if (bodyReason !== null) return { kind: 'blocked', reason: bodyReason }
  return { kind: 'send', optionNumber: judged.option.number }
}
