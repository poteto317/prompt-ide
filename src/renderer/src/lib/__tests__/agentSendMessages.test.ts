import { describe, it, expect } from 'vitest'
import type { AgentSendFailure } from '../agentPromptSend'
import {
  AGENT_SEND_FAILURE_COMMON_TEXTS,
  AGENT_SENT_AFTER_CLEAR_NOTICE,
  AGENT_SENT_NOTICE,
  PROMPT_RUN_ARIA_LABEL_AGENT,
  PROMPT_RUN_ARIA_LABEL_LEGACY,
  RUN_DISABLED_INTERRUPTING,
  agentPromptSendUnsupportedReason,
  agentSendBlockedByActivityReason,
  agentSendFailureMessage
} from '../agentSendMessages'

describe('送信の通知の文言', () => {
  // clearedDraft は「書きかけがあると判定できたか」で、偽陰性・偽陽性がある(設計書の既知の制約)。
  // そのため書きかけを消した旨は参考として添え、送信したことを先に伝える
  it('書きかけを消したときの通知は、送信したことを先に伝え、書きかけについては断定しない', () => {
    expect(AGENT_SENT_AFTER_CLEAR_NOTICE.startsWith(AGENT_SENT_NOTICE)).toBe(true)
    expect(AGENT_SENT_AFTER_CLEAR_NOTICE).toContain('書きかけがあったようなので')
  })
})

describe('実行ボタンの aria-label', () => {
  it('エージェント CLI 方式は可視の文言「実行」で始める', () => {
    expect(PROMPT_RUN_ARIA_LABEL_AGENT).toBe('実行（エージェントに送信）')
  })

  it('従来の方式は「プロンプトを実行」', () => {
    expect(PROMPT_RUN_ARIA_LABEL_LEGACY).toBe('プロンプトを実行')
  })
})

describe('送信に対応しない CLI の理由(agentPromptSendUnsupportedReason)', () => {
  it('実行・再実行・送信前の確認の理由は CLI の名前で作る', () => {
    expect(agentPromptSendUnsupportedReason('copilot')).toBe(
      'copilot へのプロンプトの送信には、まだ対応していません（ターミナルに直接入力してください）'
    )
  })
})

describe('送信の失敗の文言(agentSendFailureMessage)', () => {
  it('unsupported-cli は実行ボタンの理由と同じ関数の文言', () => {
    expect(agentSendFailureMessage('unsupported-cli', 'copilot')).toBe(
      agentPromptSendUnsupportedReason('copilot')
    )
  })

  it.each<[AgentSendFailure, string]>([
    ['empty', '送信する内容がありません'],
    ['too-long', 'プロンプトが長すぎます'],
    [
      'leading-bang',
      '先頭が「!」のプロンプトは、エージェントのシェルのコマンドとして実行されるため送信できません（先頭に空白を入れると送れます）'
    ],
    ['not-accepting', 'エージェントが入力を受け付けていません'],
    [
      'input-not-found',
      'エージェントの入力欄が見つかりません。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください'
    ],
    [
      'clear-failed',
      'エージェントの入力欄を空にできませんでした。ターミナルで入力欄を確かめてから、もう一度実行してください'
    ],
    [
      'not-echoed',
      'エージェントの入力欄に入りませんでした。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください'
    ]
  ])('claude の %s は段階 2b の前と 1 文字も変わらない', (reason, text) => {
    expect(agentSendFailureMessage(reason, 'claude')).toBe(text)
  })

  it.each<[AgentSendFailure, string]>([
    [
      'leading-bang',
      '先頭（空白を除く）が「!」のプロンプトは、copilot のシェルのコマンドとして実行されるため送信できません（先頭に空白・「!」・「/」以外の文字を足すと送れます）'
    ],
    [
      'not-echoed',
      'copilot の入力欄に本文が入ったか確かめられなかったため、Enter を送りませんでした。ターミナルの画面を確かめてください（入力欄に本文が入っていれば、送るか消してください）'
    ],
    [
      'leading-slash',
      '先頭（空白を除く）が「/」のプロンプトは、copilot のスラッシュコマンドとして実行されるため送信できません（先頭に空白・「!」・「/」以外の文字を足すと送れます）'
    ],
    [
      'interrupting',
      '中断を送ったばかりのため送信できません（2 秒ほど待ってから、もう一度実行してください）'
    ],
    [
      'screen-working',
      'copilot が作業中のため送信できません（作業が終わって入力待ちになってから、もう一度実行してください）'
    ],
    [
      'screen-permission',
      'copilot が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）'
    ],
    [
      'screen-confirm',
      'copilot が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）'
    ],
    [
      'screen-unknown',
      'copilot が入力待ちか判定できないため送信できません（ターミナルの画面を確かめてから、もう一度実行してください）'
    ],
    [
      'shell-mode',
      'copilot がシェルのモードのため送信できません（ターミナルでシェルのモードを抜けてから、もう一度実行してください）'
    ],
    [
      'draft-present',
      'copilot の入力欄に書きかけがあるため送信できません（書きかけは消していません。ターミナルで送るか消してから、もう一度実行してください）'
    ],
    [
      'input-undetermined',
      'copilot の入力欄が空か確かめられなかったため送信できません（ターミナルの画面を確かめてから、もう一度実行してください）'
    ],
    [
      'shell-mode-after-paste',
      'copilot の入力欄がシェルのモードに変わったため、Enter を送りませんでした。入力欄の本文は送らずに、ターミナルで消してからシェルのモードを抜けてください（Enter を押すとシェルのコマンドとして実行されます）'
    ],
    [
      'not-confirmed',
      'copilot に送れたか確かめられませんでした。ターミナルの画面を確かめてください（入力欄に本文が残っていれば、送るか消してください）'
    ]
  ])('copilot の %s', (reason, text) => {
    expect(agentSendFailureMessage(reason, 'copilot')).toBe(text)
  })

  it('screen-* の失敗は、押せない理由(agentSendBlockedByActivityReason)と同じ文(L-058)', () => {
    for (const activity of ['working', 'permission', 'confirm', 'unknown'] as const) {
      expect(agentSendFailureMessage(`screen-${activity}`, 'copilot')).toBe(
        agentSendBlockedByActivityReason(activity, 'copilot')
      )
    }
  })

  it('interrupting の失敗は、押せない理由 RUN_DISABLED_INTERRUPTING と同じ文', () => {
    expect(agentSendFailureMessage('interrupting', 'copilot')).toBe(RUN_DISABLED_INTERRUPTING)
  })

  it('共通の表は、CLI で文が違う失敗(unsupported-cli・leading-bang・not-echoed)を持たない', () => {
    const keys = Object.keys(AGENT_SEND_FAILURE_COMMON_TEXTS)
    for (const reason of ['unsupported-cli', 'leading-bang', 'not-echoed']) {
      expect(keys).not.toContain(reason)
    }
  })
})

describe('送り先のタブの活動の理由(agentSendBlockedByActivityReason)', () => {
  it.each([
    [
      'working',
      'copilot が作業中のため送信できません（作業が終わって入力待ちになってから、もう一度実行してください）'
    ],
    [
      'permission',
      'copilot が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）'
    ],
    [
      'confirm',
      'copilot が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）'
    ],
    [
      'unknown',
      'copilot が入力待ちか判定できないため送信できません（ターミナルの画面を確かめてから、もう一度実行してください）'
    ]
  ] as const)('%s', (activity, text) => {
    expect(agentSendBlockedByActivityReason(activity, 'copilot')).toBe(text)
  })

  it('中断の流れの間の理由', () => {
    expect(RUN_DISABLED_INTERRUPTING).toBe(
      '中断を送ったばかりのため送信できません（2 秒ほど待ってから、もう一度実行してください）'
    )
  })
})
