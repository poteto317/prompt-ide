import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS, AGENT_CLI_PROFILES, agentCliCapabilities } from '@shared/agentCliKinds'
import type { AgentLaunchRequest } from '@shared/types'
import { AGENT_CLI_LAUNCH_SPECS } from '../agentCliLaunchSpecs'

const ID = '11111111-1111-4111-8111-111111111111'
const HOOKS = '/tmp/prompt-ide-agent-hooks-x/a.json'
const NEW: AgentLaunchRequest = { kind: 'new' }
const RESUME: AgentLaunchRequest = { kind: 'resume', claudeSessionId: ID }
const UNKNOWN = { kind: 'fork', claudeSessionId: ID } as unknown as AgentLaunchRequest

describe('AGENT_CLI_LAUNCH_SPECS(表)', () => {
  it.each(AGENT_CLI_KINDS)('%s: 探すコマンドの名前は能力の表の commandName', (kind) => {
    expect(AGENT_CLI_LAUNCH_SPECS[kind].commandName).toBe(AGENT_CLI_PROFILES[kind].commandName)
  })

  it('追加で取り除く環境変数は copilot の COPILOT_ALLOW_ALL だけ', () => {
    expect(AGENT_CLI_LAUNCH_SPECS.claude.extraRemovedEnvKeys).toEqual([])
    expect(AGENT_CLI_LAUNCH_SPECS.copilot.extraRemovedEnvKeys).toEqual(['COPILOT_ALLOW_ALL'])
  })

  // win32 では環境変数の名前を大文字にそろえて比べるため、表の名前は大文字で書く(小文字だと取りこぼす)
  it.each(AGENT_CLI_KINDS)('%s: 追加で取り除く環境変数の名前はすべて大文字', (kind) => {
    for (const key of AGENT_CLI_LAUNCH_SPECS[kind].extraRemovedEnvKeys) {
      expect(key).toBe(key.toUpperCase())
    }
  })

  // 能力が false の種類に会話の ID・設定のファイルが渡ったら投げる(呼び出し側の取り違えを黙って捨てない。L-044)。
  // 能力が true の項目は確かめることが無いので、false の種類だけで回す(何も確かめずに通る行を作らない)
  it.each(AGENT_CLI_KINDS.filter((kind) => !agentCliCapabilities(kind).sessionResume))(
    '%s: 会話の再開に対応しない種類に会話の ID が渡ったら投げる',
    (kind) => {
      expect(() => AGENT_CLI_LAUNCH_SPECS[kind].buildArgs(NEW, ID, null)).toThrow()
    }
  )

  it.each(AGENT_CLI_KINDS.filter((kind) => !agentCliCapabilities(kind).changeAttribution))(
    '%s: hooks に対応しない種類に設定のファイルが渡ったら投げる',
    (kind) => {
      expect(() => AGENT_CLI_LAUNCH_SPECS[kind].buildArgs(NEW, null, HOOKS)).toThrow()
    }
  )
})

describe('AGENT_CLI_LAUNCH_SPECS.claude.buildArgs(MVP からの claude の起動の引数)', () => {
  const { buildArgs } = AGENT_CLI_LAUNCH_SPECS.claude

  it('new は --session-id、resume は --resume に、渡した ID をそのまま続ける(hooks なしは 2 つだけ)', () => {
    expect(buildArgs(NEW, ID, null)).toEqual(['--session-id', ID])
    expect(buildArgs(RESUME, ID, null)).toEqual(['--resume', ID])
  })

  it('設定のファイルのパスがあれば、後ろに --settings <パス> を足す(ほかの引数は足さない)', () => {
    expect(buildArgs(NEW, ID, HOOKS)).toEqual(['--session-id', ID, '--settings', HOOKS])
    expect(buildArgs(RESUME, ID, HOOKS)).toEqual(['--resume', ID, '--settings', HOOKS])
  })

  it('会話の ID が null なら投げる(claude は必ず ID を付けて起動する)', () => {
    expect(() => buildArgs(NEW, null, null)).toThrow('claude の起動には会話の ID が要ります')
  })

  it('未知の kind は既定の --session-id へ流さず投げる', () => {
    expect(() => buildArgs(UNKNOWN, ID, null)).toThrow('未知の起動の指定です')
  })
})

describe('AGENT_CLI_LAUNCH_SPECS.copilot.buildArgs', () => {
  const { buildArgs } = AGENT_CLI_LAUNCH_SPECS.copilot

  it('new は引数なし(対話のセッション。-C・--allow-*・--yolo などを付けない)', () => {
    expect(buildArgs(NEW, null, null)).toEqual([])
  })

  it('resume は投げる(starter が先に resume-unsupported で断るので届かない)', () => {
    expect(() => buildArgs(RESUME, null, null)).toThrow(
      'copilot はセッションの再開に対応していません'
    )
  })

  it('会話の ID・hooks の設定のファイルが渡ったら投げる', () => {
    expect(() => buildArgs(NEW, ID, null)).toThrow('copilot の起動に会話の ID は渡せません')
    expect(() => buildArgs(NEW, null, HOOKS)).toThrow(
      'copilot の起動に hooks の設定のファイルは渡せません'
    )
  })

  it('未知の kind は投げる', () => {
    expect(() => buildArgs(UNKNOWN, null, null)).toThrow('未知の起動の指定です')
  })
})
