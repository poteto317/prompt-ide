import { describe, it, expect } from 'vitest'
import {
  AGENT_ADD_TAB_DISABLED_LIMIT,
  AGENT_RESUME_CLI_MISMATCH,
  AGENT_RESUME_UNSUPPORTED,
  AGENT_TOO_MANY_SESSIONS,
  agentStartAriaLabel,
  agentCloseTabConfirm,
  describeAgentTabStatus,
  formatAgentTabLabel,
  AGENT_START_ERROR_PREFIX,
  AGENT_STOP_ERROR_PREFIX,
  describeAgentStartError,
  describeAgentActivity,
  describeAgentStatus,
  agentResumeEntryUnsupportedReason,
  agentResumeLastUnsupportedReason,
  agentResumeLastAriaLabel,
  agentResumeEntryCliMismatch,
  agentResumeEntryUnknownCli,
  AGENT_RESUME_FAILURE_NOTES
} from '../agentSessionMessages'

describe('describeAgentStatus', () => {
  it.each([
    ['none', null, '未起動'],
    ['starting', null, '起動中'],
    ['running', null, '実行中'],
    ['exited', { exitCode: 0, reason: 'exited' }, '終了しました（終了コード 0）'],
    ['exited', { exitCode: null, reason: 'stopped' }, '終了しました'],
    ['exited', null, '終了しました']
  ] as const)('%s・%o → %s', (status, exit, expected) => {
    expect(describeAgentStatus(status, exit)).toBe(expected)
  })
})

describe('起動・終了の失敗の接頭辞', () => {
  it('起動の失敗の接頭辞', () => {
    expect(AGENT_START_ERROR_PREFIX).toBe('エージェントを起動できませんでした: ')
  })

  it('終了の失敗の接頭辞', () => {
    expect(AGENT_STOP_ERROR_PREFIX).toBe('エージェントを終了できませんでした: ')
  })

  it('spawn-failed の文言は起動の失敗の接頭辞に detail を付ける', () => {
    expect(describeAgentStartError({ kind: 'error', error: 'spawn-failed', detail: 'boom' })).toBe(
      `${AGENT_START_ERROR_PREFIX}boom`
    )
  })
})

describe('too-many-sessions の文言', () => {
  it('同時に動かせる数を出す', () => {
    expect(describeAgentStartError({ kind: 'error', error: 'too-many-sessions' })).toBe(
      '同時に動かせるエージェントは 4 つまでです'
    )
  })
})

describe('+ を押せない理由の文言', () => {
  it('動いている数ではなくタブの数の上限で、閉じれば追加できることを伝える', () => {
    expect(AGENT_ADD_TAB_DISABLED_LIMIT).toBe(
      'タブは 4 つまでです（使わないタブを閉じると追加できます）'
    )
  })

  it('main が拒否したとき用の文言とは別', () => {
    expect(AGENT_ADD_TAB_DISABLED_LIMIT).not.toBe(AGENT_TOO_MANY_SESSIONS)
  })
})

describe('タブの文言', () => {
  // 活動は必ず渡す(running のときだけ使う。running でないタブに活動の文言を出さない)
  it.each([
    ['none', 'unknown', '未起動'],
    ['starting', 'working', '起動中'],
    ['running', 'unknown', '実行中'],
    ['running', 'idle', '入力待ち'],
    ['exited', 'permission', '終了']
  ] as const)('%s・%s → %s', (status, activity, expected) => {
    expect(describeAgentTabStatus(status, activity)).toBe(expected)
  })

  it('ラベルと閉じる確認', () => {
    expect(formatAgentTabLabel(2, 'claude')).toBe('claude 2')
    expect(agentCloseTabConfirm('claude 2')).toBe(
      'claude 2 のエージェントを終了してタブを閉じますか？'
    )
  })
})

describe('describeAgentActivity', () => {
  it.each([
    ['working', '作業中'],
    ['idle', '入力待ち'],
    ['permission', '許可待ち'],
    ['confirm', '確認待ち'],
    ['unknown', '実行中']
  ] as const)('%s → %s', (activity, text) => {
    expect(describeAgentActivity(activity)).toBe(text)
  })
})

describe('再開の失敗の文言', () => {
  it.each([
    [
      'unknown-session' as const,
      'このセッションは再開できません（アプリの起動の記録にありません）'
    ],
    ['session-in-use' as const, 'このセッションはほかのタブかウィンドウで動いています']
  ])('%s', (error, message) => {
    expect(describeAgentStartError({ kind: 'error', error })).toBe(message)
  })
})

describe('再開に対応しない CLI の理由(設定の種類)', () => {
  it('前回の続きから・このセッションで再開は、CLI の名前と既定の claude に戻す案内で作る', () => {
    expect(agentResumeLastUnsupportedReason('copilot')).toBe(
      'copilot では「前回の続きから」を使えません（設定で claude に戻すと使えます）'
    )
    expect(agentResumeEntryUnsupportedReason('copilot')).toBe(
      'copilot では「このセッションで再開」を使えません（設定で claude に戻すと使えます）'
    )
  })
})

describe('起動の失敗の文言(CLI の種類・再開の拒否)', () => {
  const NOT_FOUND_SUFFIX = '（探した場所: ログインシェルの PATH）'
  const PATH_UNAVAILABLE =
    '（ログインシェルから PATH を取得できなかったため、既定の場所だけを探しました）'
  it.each([
    [
      'claude',
      false,
      `claude コマンドが見つかりません。Claude Code をインストールしてください${NOT_FOUND_SUFFIX}`
    ],
    [
      'copilot',
      false,
      `copilot コマンドが見つかりません。GitHub Copilot CLI をインストールしてください${NOT_FOUND_SUFFIX}`
    ],
    [
      'copilot',
      true,
      `copilot コマンドが見つかりません。GitHub Copilot CLI をインストールしてください${NOT_FOUND_SUFFIX}${PATH_UNAVAILABLE}`
    ]
  ] as const)(
    'command-not-found は結果の種類のコマンド名と表示名で出す(%s・PATH を取れなかった %s)',
    (cliKind, shellPathUnavailable, message) => {
      expect(
        describeAgentStartError({
          kind: 'error',
          error: 'command-not-found',
          cliKind,
          shellPathUnavailable
        })
      ).toBe(message)
    }
  )

  it('resume-unsupported', () => {
    expect(AGENT_RESUME_UNSUPPORTED).toBe(
      '使っているエージェント CLI は、セッションの再開に対応していません'
    )
    expect(describeAgentStartError({ kind: 'error', error: 'resume-unsupported' })).toBe(
      AGENT_RESUME_UNSUPPORTED
    )
  })

  it('resume-cli-mismatch は、設定が変わった旨を CLI の名前を含めずに出す', () => {
    expect(AGENT_RESUME_CLI_MISMATCH).toBe(
      '使うエージェント CLI の設定が変わったため、再開しませんでした（設定を確かめてから、もう一度押してください）'
    )
    expect(describeAgentStartError({ kind: 'error', error: 'resume-cli-mismatch' })).toBe(
      AGENT_RESUME_CLI_MISMATCH
    )
  })
})

describe('起動の名前', () => {
  it('可視の文言「起動」で始め、起動するコマンドの名前を入れる', () => {
    expect(agentStartAriaLabel('claude')).toBe('起動（開いているフォルダで claude を起動）')
    expect(agentStartAriaLabel('copilot')).toBe('起動（開いているフォルダで copilot を起動）')
  })
})

describe('再開の入口の文言(CLI の種類。段階 3a)', () => {
  it('前回の続きからの aria-label は設定の種類のコマンド名で作り、claude では段階 3a より前と同じ文字列', () => {
    expect(agentResumeLastAriaLabel('claude')).toBe(
      '前回の続きから（このフォルダで最後に起動した claude のセッションを再開）'
    )
    expect(agentResumeLastAriaLabel('copilot')).toBe(
      '前回の続きから（このフォルダで最後に起動した copilot のセッションを再開）'
    )
  })

  it('エントリの種類と設定の種類が違うときの理由は、切り替えれば再開できる旨を出す', () => {
    expect(agentResumeEntryCliMismatch('claude', 'copilot')).toBe(
      'claude のセッションのため、copilot では再開できません（設定の「使うエージェント CLI」で claude に切り替えると再開できます）'
    )
    expect(agentResumeEntryCliMismatch('copilot', 'claude')).toBe(
      'copilot のセッションのため、claude では再開できません（設定の「使うエージェント CLI」で copilot に切り替えると再開できます）'
    )
  })

  it('知らない種類のエントリの理由は、種類の値をそのまま出す', () => {
    expect(agentResumeEntryUnknownCli('gemini')).toBe(
      'このアプリの版が知らないエージェント CLI（gemini）のセッションのため、再開できません'
    )
  })
})

describe('再開の失敗の文言(種類ごとの表。段階 3a)', () => {
  it('claude は出さない(今の「起動の直後に終了しました」のまま)、copilot は何も送らずに閉じたセッションを案内する', () => {
    expect(AGENT_RESUME_FAILURE_NOTES).toEqual({
      claude: null,
      copilot:
        'copilot がセッションを再開できずに終了しました。ターミナルの表示を確かめてください（何も送らずに閉じたセッションは、copilot が保存しないため再開できません）'
    })
  })
})
