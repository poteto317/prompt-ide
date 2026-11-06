// src/renderer/src/lib/__tests__/agentPermissionAnswerMessages.test.ts
import { describe, it, expect } from 'vitest'
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
  AGENT_PERMISSION_ANSWER_ERROR_PREFIX,
  AGENT_PERMISSION_ANSWER_PROMPT_CHANGED,
  AGENT_PERMISSION_ANSWER_TEXTS,
  agentPermissionAnswerAriaLabel,
  agentPermissionAnswerError,
  agentPermissionAnswerFailureError,
  agentPermissionAnswerLabel,
  agentPermissionAnswerNoLongerPermissionReason,
  agentPermissionAnswerNotPermissionReason,
  agentPermissionAnswerNotRunningReason,
  agentPermissionAnswerNumberKeysRejectedReason,
  agentPermissionAnswerOptionMissingReason,
  agentPermissionAnswerSentNotice,
  agentPermissionAnswerUnsupportedReason
} from '../agentPermissionAnswerMessages'
import { AGENT_PERMISSION_OPTION_WORDS } from '../agentPermissionPrompt'

describe('帯の 許可・拒否 の文言(設計書 2026-11-06「画面」)', () => {
  it('見える文字', () => {
    expect(agentPermissionAnswerLabel('allow')).toBe('許可')
    expect(agentPermissionAnswerLabel('deny')).toBe('拒否')
  })

  it('名前: 選択肢を読み取れたときは、問い(全文)と番号を入れる(見える文字で始める)', () => {
    expect(agentPermissionAnswerAriaLabel('allow', 'claude 1', 'Do you want to proceed?', 1)).toBe(
      '許可（claude 1 の「Do you want to proceed?」に 1 番の Yes で答える）'
    )
    expect(agentPermissionAnswerAriaLabel('deny', 'claude 1', 'Do you want to proceed?', 4)).toBe(
      '拒否（claude 1 の「Do you want to proceed?」に 4 番の No で答える）'
    )
    expect(
      agentPermissionAnswerAriaLabel('deny', 'copilot 1', 'Do you want to run this command?', 2)
    ).toBe('拒否（copilot 1 の「Do you want to run this command?」に 2 番の No で答える）')
  })

  it.each<[string | null, number | null]>([
    [null, null],
    ['Do you want to proceed?', null],
    [null, 1]
  ])(
    '名前: 問い %o・番号 %o のどちらかが無いときは、許可の確認に Yes・No で答える',
    (question, number) => {
      expect(agentPermissionAnswerAriaLabel('allow', 'claude 1', question, number)).toBe(
        '許可（claude 1 の許可の確認に Yes で答える）'
      )
      expect(agentPermissionAnswerAriaLabel('deny', 'claude 1', question, number)).toBe(
        '拒否（claude 1 の許可の確認に No で答える）'
      )
    }
  )

  it.each(['allow', 'deny'] as const)(
    '%s の名前・その選択肢が無い理由・読み上げは、選択肢の規則と同じ語(AGENT_PERMISSION_OPTION_WORDS)を出す',
    (choice) => {
      const word = AGENT_PERMISSION_OPTION_WORDS[choice]
      expect(agentPermissionAnswerAriaLabel(choice, 'claude 1', null, null)).toContain(
        ` ${word} で答える`
      )
      expect(agentPermissionAnswerOptionMissingReason(choice)).toContain(`「${word}」`)
      expect(agentPermissionAnswerSentNotice('claude 1', 'claude', choice, 2)).toContain(
        `2 番の ${word}`
      )
    }
  )

  it('押せない理由(帯に出さない 3 つ)', () => {
    expect(agentPermissionAnswerNotRunningReason('claude')).toBe(
      'claude が動いていないため答えられません'
    )
    expect(agentPermissionAnswerUnsupportedReason('claude')).toBe(
      'claude では許可のボタンを使えません（ターミナルで答えてください）'
    )
    expect(agentPermissionAnswerNotPermissionReason('claude')).toBe(
      'claude は許可待ちではありません'
    )
  })

  it('押せない理由(帯に出すもの)', () => {
    expect(AGENT_PERMISSION_ANSWER_DISABLED_JUST_APPEARED).toBe(
      '許可の確認が出た直後です（少し待つと押せます）'
    )
    expect(AGENT_PERMISSION_ANSWER_DISABLED_PANEL_CLOSED).toBe(
      'ターミナルを開いて、許可する内容を確かめてから押してください'
    )
    expect(AGENT_PERMISSION_ANSWER_DISABLED_SCROLLED_UP).toBe(
      'ターミナルを一番下までスクロールして、許可する内容を確かめてから押してください'
    )
    expect(AGENT_PERMISSION_ANSWER_DISABLED_CLOSING).toBe('閉じる途中のタブでは答えられません')
    expect(AGENT_PERMISSION_ANSWER_DISABLED_SENDING).toBe(
      'プロンプトを送信している間は答えられません'
    )
    expect(AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM).toBe(
      '送信前の確認を開いている間は答えられません'
    )
    expect(AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING).toBe(
      '中断を送った直後は答えられません（少し待つと押せます）'
    )
    expect(AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN).toBe(
      '答えを押した直後です（少し待つと押せます）'
    )
    expect(AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE).toBe(
      '画面の選択肢を読み取れませんでした（ターミナルで答えてください）'
    )
    expect(agentPermissionAnswerNumberKeysRejectedReason('claude')).toBe(
      'カーソルが Yes・No 以外にあるか、答えの文の入力欄が開いているため押せません（ターミナルで答えてください）'
    )
    expect(agentPermissionAnswerNumberKeysRejectedReason('copilot')).toBe(
      'copilot は、代わりにしてほしいことの入力を待っています（ターミナルで入力して Enter を押してください。何も入れずに Esc を押すと操作ごと取り消します）'
    )
    expect(agentPermissionAnswerOptionMissingReason('allow')).toBe(
      '画面に「Yes」の選択肢が見つかりません（ターミナルで答えてください）'
    )
    expect(agentPermissionAnswerOptionMissingReason('deny')).toBe(
      '画面に「No」の選択肢が見つかりません（ターミナルで答えてください）'
    )
  })

  it('押した時点の読み直しだけで出る理由', () => {
    expect(agentPermissionAnswerNoLongerPermissionReason('claude')).toBe(
      'claude は許可待ちではなくなりました。画面を確かめてください'
    )
    expect(AGENT_PERMISSION_ANSWER_PROMPT_CHANGED).toBe(
      '許可の確認の内容が変わりました。ターミナルで内容を確かめてからもう一度押してください'
    )
  })

  it('読み上げ: 許可・claude の拒否・copilot の拒否(copilot だけ案内が付く)', () => {
    expect(agentPermissionAnswerSentNotice('claude 1', 'claude', 'allow', 1)).toBe(
      'claude 1 に許可（1 番の Yes）を送りました'
    )
    expect(agentPermissionAnswerSentNotice('copilot 1', 'copilot', 'allow', 1)).toBe(
      'copilot 1 に許可（1 番の Yes）を送りました'
    )
    expect(agentPermissionAnswerSentNotice('claude 1', 'claude', 'deny', 4)).toBe(
      'claude 1 に拒否（4 番の No）を送りました'
    )
    expect(agentPermissionAnswerSentNotice('copilot 1', 'copilot', 'deny', 2)).toBe(
      'copilot 1 で拒否（2 番）を選びました。ターミナルで、代わりにしてほしいことを入力して Enter を押してください'
    )
    expect(AGENT_PERMISSION_ANSWER_TEXTS.claude.denyFollowUp).toBeNull()
  })

  it('送れなかったときの文言', () => {
    expect(AGENT_PERMISSION_ANSWER_ERROR_PREFIX).toBe('許可の答えを送れませんでした: ')
    expect(agentPermissionAnswerFailureError('no-session', 'claude')).toBe(
      '許可の答えを送れませんでした: claude が終了したか、起動し直しました'
    )
    expect(agentPermissionAnswerFailureError('write-failed', 'claude')).toBe(
      '許可の答えを送れませんでした: ターミナルへの書き込みに失敗しました'
    )
    expect(agentPermissionAnswerError('ipc down')).toBe('許可の答えを送れませんでした: ipc down')
  })

  it('本文が切れている理由は、最大化しても収まらないときにターミナルで答える道を添える', () => {
    expect(AGENT_PERMISSION_ANSWER_DISABLED_BODY_CUT).toBe(
      'ターミナルを広げて、許可する内容が全部見える状態で押してください（最大化しても収まらないときはターミナルで答えてください）'
    )
  })
})
