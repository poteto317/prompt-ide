import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS, AGENT_CLI_PROFILES, agentCliCapabilities } from '@shared/agentCliKinds'
import type { AgentLaunchRequest } from '@shared/types'
import { AGENT_CLI_LAUNCH_SPECS } from '../agentCliLaunchSpecs'

const ID = '11111111-1111-4111-8111-111111111111'
// 英字を含む ID(大文字にすると値が変わる)
const LETTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const HOOKS = '/tmp/prompt-ide-agent-hooks-x/a.json'
const PLUGIN_DIR = '/u/agent-hooks-copilot/slot-1'
const NEW: AgentLaunchRequest = { kind: 'new' }
const RESUME: AgentLaunchRequest = { kind: 'resume', claudeSessionId: ID, cliKind: 'claude' }
const UNKNOWN = { kind: 'fork', claudeSessionId: ID } as unknown as AgentLaunchRequest

/** fn が投げた例外の文言(投げなければ空文字) */
function thrownMessage(fn: () => unknown): string {
  try {
    fn()
    return ''
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

describe('AGENT_CLI_LAUNCH_SPECS(表)', () => {
  it.each(AGENT_CLI_KINDS)('%s: 探すコマンドの名前は能力の表の commandName', (kind) => {
    expect(AGENT_CLI_LAUNCH_SPECS[kind].commandName).toBe(AGENT_CLI_PROFILES[kind].commandName)
  })

  it('追加で取り除く環境変数は copilot の COPILOT_ALLOW_ALL だけ', () => {
    expect(AGENT_CLI_LAUNCH_SPECS.claude.extraRemovedEnvKeys).toEqual([])
    expect(AGENT_CLI_LAUNCH_SPECS.copilot.extraRemovedEnvKeys).toEqual(['COPILOT_ALLOW_ALL'])
  })

  it('足す環境変数は copilot の COPILOT_DISABLE_RESUME_AUTO_CD=1 と COPILOT_HOOK_ALLOW_LOCALHOST=1(保存先への自動の移動を止める・127.0.0.1 の http の hook を読ませる)', () => {
    expect(AGENT_CLI_LAUNCH_SPECS.claude.extraEnv).toEqual({})
    expect(AGENT_CLI_LAUNCH_SPECS.copilot.extraEnv).toEqual({
      COPILOT_DISABLE_RESUME_AUTO_CD: '1',
      COPILOT_HOOK_ALLOW_LOCALHOST: '1'
    })
  })

  // win32 では環境変数の名前を大文字にそろえて比べるため、表の名前は大文字で書く(小文字だと取りこぼす)
  it.each(AGENT_CLI_KINDS)('%s: 取り除く・足す環境変数の名前はすべて大文字', (kind) => {
    const spec = AGENT_CLI_LAUNCH_SPECS[kind]
    for (const key of [...spec.extraRemovedEnvKeys, ...Object.keys(spec.extraEnv)]) {
      expect(key).toBe(key.toUpperCase())
    }
  })

  // 能力の表と起動の表の引数の整合(呼び出し側の取り違えを黙って捨てない。L-044)。起動の表は能力の表を読まないので、表の今の値に
  // 応じた期待で全種類を回す(どの種類も 1 件以上の確かめを作る。何も確かめずに通る行を作らない)
  it.each(AGENT_CLI_KINDS)(
    '%s: 会話の再開に対応する種類は ID が無いと投げ、対応しない種類は ID があると投げる',
    (kind) => {
      const { buildArgs } = AGENT_CLI_LAUNCH_SPECS[kind]
      const call = agentCliCapabilities(kind).sessionResume
        ? (): string[] => buildArgs(NEW, null, null)
        : (): string[] => buildArgs(NEW, ID, null)
      expect(call).toThrow()
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

describe('AGENT_CLI_LAUNCH_SPECS.copilot.buildArgs(段階 3a)', () => {
  const { buildArgs } = AGENT_CLI_LAUNCH_SPECS.copilot

  it('new は --session-id <ID>(2 つの要素)、resume は --resume=<ID>(1 つの要素。-C・--allow-*・--yolo などを付けない)', () => {
    expect(buildArgs(NEW, ID, null)).toEqual(['--session-id', ID])
    expect(buildArgs(RESUME, ID, null)).toEqual([`--resume=${ID}`])
    expect(buildArgs(RESUME, ID, null)).toHaveLength(1)
  })

  it('会話の ID が無いと投げる(new・resume とも)', () => {
    expect(() => buildArgs(NEW, null, null)).toThrow('copilot の起動には会話の ID が要ります')
    expect(() => buildArgs(RESUME, null, null)).toThrow('copilot の起動には会話の ID が要ります')
  })

  it.each<[string, string]>([
    ['大文字', LETTER_ID.toUpperCase()],
    ['36 文字でない', ID.slice(0, 35)],
    ['UUID の先頭 8 文字(copilot の前方一致で別の会話が開きうる)', ID.slice(0, 8)],
    ['- 始まり', '--yolo'],
    ['UUID でない語(copilot では新しいセッションに落ちる)', 'my-session'],
    ['v4 以外', '11111111-1111-1111-8111-111111111111']
  ])(
    '会話の ID が小文字の UUID v4 の完全な形でなければ(%s)、値を文言に入れずに投げる(L-007・L-017)',
    (_label, value) => {
      for (const launch of [NEW, RESUME]) {
        const message = thrownMessage(() => buildArgs(launch, value, null))
        expect(message).toBe('copilot の起動の会話の ID の形が正しくありません')
        expect(message).not.toContain(value)
      }
    }
  )

  it('hooks のフォルダのパスがあれば、後ろに --plugin-dir <パス> を足す(new・resume とも。ほかの引数は足さない)', () => {
    expect(buildArgs(NEW, ID, PLUGIN_DIR)).toEqual(['--session-id', ID, '--plugin-dir', PLUGIN_DIR])
    expect(buildArgs(RESUME, ID, PLUGIN_DIR)).toEqual([
      `--resume=${ID}`,
      '--plugin-dir',
      PLUGIN_DIR
    ])
  })

  it.each<[string, string]>([
    ['相対パス', 'agent-hooks-copilot/slot-1'],
    ['- 始まり', '--yolo'],
    ['空文字', '']
  ])(
    'hooks のフォルダのパスが絶対パスでなければ(%s)、値を文言に入れずに投げる(L-017・L-034)',
    (_label, value) => {
      for (const launch of [NEW, RESUME]) {
        const message = thrownMessage(() => buildArgs(launch, ID, value))
        expect(message).toBe('copilot の起動の hooks のフォルダのパスが正しくありません')
        if (value !== '') expect(message).not.toContain(value)
      }
    }
  )

  it('未知の kind は投げる', () => {
    expect(() => buildArgs(UNKNOWN, ID, null)).toThrow('未知の起動の指定です')
  })
})
