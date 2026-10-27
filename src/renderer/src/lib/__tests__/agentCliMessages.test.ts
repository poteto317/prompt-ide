import { describe, it, expect, vi, afterEach } from 'vitest'
import { AGENT_CLI_KINDS, agentCliCapabilities } from '@shared/agentCliKinds'
import {
  AGENT_CLI_ATTRIBUTION_PRECISION_NOTES,
  AGENT_CLI_CAPABILITY_NAMES,
  AGENT_CLI_KIND_LOCKED_WHILE_STARTING,
  AGENT_CLI_KIND_SAVE_ERROR_PREFIX,
  AGENT_CLI_KIND_SECTION_NOTE,
  AGENT_CLI_KIND_SECTION_TITLE,
  agentCliFallbackNote,
  agentCliKindOptionLabel,
  agentCliUnsupportedFeaturesNote,
  agentNotificationUnsupportedNote,
  isAgentCliKindResaveAllowed
} from '../agentCliMessages'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

// 注記が出る経路(能力が無い種類)を確かめるため、能力の表の screenActivity・interrupt と promptSend を種類ごとに偽にできるようにする
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({
    unsupportedKinds: new Set<AgentCliKind>(),
    promptSendUnsupportedKinds: new Set<AgentCliKind>(),
    sessionResumeUnsupportedKinds: new Set<AgentCliKind>(),
    changeAttributionUnsupportedKinds: new Set<AgentCliKind>()
  })
)
vi.mock('@shared/agentCliKinds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/agentCliKinds')>()
  const { overrideAgentCliCapabilities } =
    await import('../../__tests__/agentCliCapabilityOverrides')
  return {
    ...actual,
    agentCliCapabilities: overrideAgentCliCapabilities(
      actual.agentCliCapabilities,
      capabilityOverrides
    )
  }
})

afterEach(() => {
  capabilityOverrides.unsupportedKinds.clear()
  capabilityOverrides.promptSendUnsupportedKinds.clear()
  capabilityOverrides.sessionResumeUnsupportedKinds.clear()
  capabilityOverrides.changeAttributionUnsupportedKinds.clear()
})

describe('agentCliMessages(設定の画面)', () => {
  it('見出し・説明・選択肢・選べない理由・保存の失敗の接頭辞', () => {
    expect(AGENT_CLI_KIND_SECTION_TITLE).toBe('使うエージェント CLI')
    expect(AGENT_CLI_KIND_SECTION_NOTE).toBe(
      'エージェント CLI 方式で使います。切り替えると、次の起動から使われます'
    )
    expect(agentCliKindOptionLabel('claude')).toBe('Claude Code（claude）')
    expect(agentCliKindOptionLabel('copilot')).toBe('GitHub Copilot CLI（copilot）')
    expect(AGENT_CLI_KIND_LOCKED_WHILE_STARTING).toBe(
      'エージェントの起動中は、使う CLI を切り替えられません'
    )
    expect(AGENT_CLI_KIND_SAVE_ERROR_PREFIX).toBe('使うエージェント CLI を保存できませんでした: ')
  })

  it('能力の名前の表は 5 つの能力を網羅する(並びは能力の表と同じ)', () => {
    expect(AGENT_CLI_CAPABILITY_NAMES).toEqual({
      promptSend: 'プロンプトの送信（実行・再実行）',
      screenActivity: '作業中・入力待ちの表示と通知',
      interrupt: '中断',
      changeAttribution: '利用者の変更との区別',
      sessionResume: '前回の続きから・このセッションで再開'
    })
    expect(Object.keys(AGENT_CLI_CAPABILITY_NAMES)).toEqual(
      Object.keys(agentCliCapabilities('claude'))
    )
  })

  it('使えない機能の注記: copilot も claude もすべての機能を使えるので出さない(段階 2a〜3b で対応した)', () => {
    expect(agentCliUnsupportedFeaturesNote('copilot')).toBeNull()
    expect(agentCliUnsupportedFeaturesNote('claude')).toBeNull()
  })

  it('使えない機能の注記: 区別が無い種類(能力の表を差し替えた copilot)は、区別の名前を並べる', () => {
    capabilityOverrides.changeAttributionUnsupportedKinds.add('copilot')
    expect(agentCliUnsupportedFeaturesNote('copilot')).toBe(
      'copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別'
    )
  })

  it('使えない機能の注記: 画面の判定と中断が無い種類(能力の表を差し替えた copilot)は、その 2 つの名前を並べる', () => {
    capabilityOverrides.unsupportedKinds.add('copilot')
    expect(agentCliUnsupportedFeaturesNote('copilot')).toBe(
      'copilot では次の機能を使えません（ターミナルで直接操作します）: 作業中・入力待ちの表示と通知、中断'
    )
  })

  it('使えない機能の注記: 送信が無い種類(能力の表を差し替えた copilot)は、送信の名前を並べる', () => {
    capabilityOverrides.promptSendUnsupportedKinds.add('copilot')
    expect(agentCliUnsupportedFeaturesNote('copilot')).toBe(
      'copilot では次の機能を使えません（ターミナルで直接操作します）: プロンプトの送信（実行・再実行）'
    )
  })

  it('使えない機能の注記: 再開が無い種類(能力の表を差し替えた copilot)は、再開の名前を並べる', () => {
    capabilityOverrides.sessionResumeUnsupportedKinds.add('copilot')
    expect(agentCliUnsupportedFeaturesNote('copilot')).toBe(
      'copilot では次の機能を使えません（ターミナルで直接操作します）: 前回の続きから・このセッションで再開'
    )
  })

  it.each(AGENT_CLI_KINDS)('%s: 使えない機能の注記は、false の能力の名前だけを含む', (kind) => {
    const note = agentCliUnsupportedFeaturesNote(kind) ?? ''
    const capabilities = agentCliCapabilities(kind)
    for (const [key, name] of Object.entries(AGENT_CLI_CAPABILITY_NAMES)) {
      expect(note.includes(name)).toBe(!capabilities[key as keyof typeof capabilities])
    }
  })

  it('既定に戻した旨', () => {
    expect(agentCliFallbackNote(null)).toBeNull()
    expect(agentCliFallbackNote('invalid-value')).toBe(
      '保存されていた値を読めなかったため claude を使っています（選び直すと保存します）'
    )
    expect(agentCliFallbackNote('read-failed')).toBe(
      '設定ファイルを読めなかったため claude を使っています'
    )
  })

  it('通知の注記: 今の表ではどの種類にも出さない(copilot も画面を判定する)', () => {
    expect(agentNotificationUnsupportedNote('copilot')).toBeNull()
    expect(agentNotificationUnsupportedNote('claude')).toBeNull()
  })

  it('通知の注記: 画面の判定が無い種類(能力の表を差し替えた copilot)にだけ出す', () => {
    capabilityOverrides.unsupportedKinds.add('copilot')
    expect(agentNotificationUnsupportedNote('copilot')).toBe(
      'copilot では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）'
    )
    expect(agentNotificationUnsupportedNote('claude')).toBeNull()
  })
})

describe('isAgentCliKindResaveAllowed', () => {
  it('不正な値(invalid-value)の間だけ、今と同じ種類の選び直しで保存する(注記の「選び直すと保存します」のとおり)', () => {
    expect(isAgentCliKindResaveAllowed('invalid-value')).toBe(true)
    expect(isAgentCliKindResaveAllowed('read-failed')).toBe(false)
    expect(isAgentCliKindResaveAllowed(null)).toBe(false)
  })
})

describe('AGENT_CLI_ATTRIBUTION_PRECISION_NOTES(区別の精度の注記。段階 3b)', () => {
  it('claude は null、copilot は区別が粗い旨', () => {
    expect(AGENT_CLI_ATTRIBUTION_PRECISION_NOTES).toEqual({
      claude: null,
      copilot:
        'copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）'
    })
  })
})
