import { randomBytes } from 'node:crypto'
import { agentCliCapabilities } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { buildAgentHookSettings } from './agentHookSettings'
import { buildCopilotHookConfig } from './agentCopilotHookConfig'
import type { CopilotHookPluginSlots } from './agentCopilotHookPlugin'
import type { AgentHookSettingsDir, AgentHookSettingsJson } from './agentHookSettings'
import type { AgentHookReceiver } from './agentHookReceiver'
import type { AgentHookOwnerCli } from './agentHookReceiverRequest'
import type { AgentHooksUnavailableReason, AgentToolActivity } from './agentToolActivity'
import type { ClaudeVersionReader } from './agentClaudeVersion'
import type { AgentLaunchPlan } from './agentCommand'
import { errorMessageOf } from './errorMessage'

// starter に注入する hooks の準備・結び付け・解放(設計書「起動への組み込み」、段階 3b の設計書「プラグインのフォルダ」)。prepare は
// pty の sessionId を使わない(sessionId は spawn の直前の await を挟まない区間で振るため)。準備は種類ごとの表で決める(claude は版の確認 →
// 受け口 → 設定のファイル、copilot は版を確かめず受け口 → 枠 → プラグインのフォルダの書き直し。L-052・L-060)。トークンは spawn の後の
// activate で初めて表に足す。prepare は失敗しても null を返さず、hooks なしで起動する理由を返す(L-001)

/** hooks を渡す起動の準備の結果 */
export interface AgentHookPreparation {
  /** 起動の引数に渡す絶対パス(claude は設定のファイル、copilot はプラグインのフォルダ) */
  configPath: string
  token: string
  /** 起動しなかった・終了したときの後始末(claude は設定のファイルを消し、copilot は枠を返す。hooks.json は消さない) */
  discard: () => void
}

export type PreparedAgentHooks =
  | {
      ownerId: number
      /** 起動の計画の種類(main が読んだ設定。L-018) */
      cliKind: AgentCliKind
      hooks: AgentHookPreparation
      unavailableReason: null
    }
  | {
      ownerId: number
      cliKind: AgentCliKind
      hooks: null
      unavailableReason: AgentHooksUnavailableReason
    }

export interface AgentHookSessions {
  prepare(ownerId: number, plan: AgentLaunchPlan): Promise<PreparedAgentHooks>
  /** cliSessionId は起動に使った会話の ID(--session-id・--resume に渡した ID。持たない種類は null)。copilot の主の会話の ID の初めの値 */
  activate(prepared: PreparedAgentHooks, sessionId: string, cliSessionId: string | null): void
  release(prepared: PreparedAgentHooks, sessionId: string | null): void
}

export interface AgentHookSessionsDeps {
  receiver: Pick<AgentHookReceiver, 'ensureListening' | 'addToken' | 'removeToken'>
  settingsDir: Pick<AgentHookSettingsDir, 'ensure'>
  tracker: Pick<AgentToolActivity, 'addSession' | 'removeSession'>
  versions: Pick<ClaudeVersionReader, 'readClaudeVersion'>
  writeSettingsFile: (dir: string, settings: AgentHookSettingsJson) => Promise<string>
  removeSettingsFile: (path: string) => Promise<void>
  /** copilot のプラグインのフォルダの枠(main 全体で 1 つ。組み立ては agentHooksRuntime.ts) */
  copilotPlugins: Pick<CopilotHookPluginSlots, 'acquire' | 'release' | 'write'>
  log: (message: string) => void
  createToken?: () => string
}

const createRandomToken = (): string => randomBytes(32).toString('hex')

/** 種類ごとの準備。成功なら hooks の値、失敗なら hooks なしで起動する理由を返す(例外にしない) */
type KindPreparer = (
  plan: AgentLaunchPlan,
  token: string
) => Promise<AgentHookPreparation | AgentHooksUnavailableReason>

/**
 * トークンの持ち主の CLI の種類(種類をキーにした表。種類を足したときの決め忘れを型エラーにする。L-060)。copilot の主の会話の ID は
 * 起動に使った ID から始める(L-018。持たないなら awaiting で、次の主のプロンプトの ID を採る)
 */
const OWNER_CLI_OF: Record<AgentCliKind, (cliSessionId: string | null) => AgentHookOwnerCli> = {
  claude: () => ({ kind: 'claude' }),
  copilot: (cliSessionId) => ({
    kind: 'copilot',
    main: cliSessionId === null ? { kind: 'awaiting' } : { kind: 'known', id: cliSessionId }
  })
}

export function createAgentHookSessions({
  receiver,
  settingsDir,
  tracker,
  versions,
  writeSettingsFile,
  removeSettingsFile,
  copilotPlugins,
  log,
  createToken = createRandomToken
}: AgentHookSessionsDeps): AgentHookSessions {
  const without = (
    ownerId: number,
    cliKind: AgentCliKind,
    unavailableReason: AgentHooksUnavailableReason
  ): PreparedAgentHooks => ({ ownerId, cliKind, hooks: null, unavailableReason })

  const prepareClaude: KindPreparer = async (plan, token) => {
    try {
      const check = await versions.readClaudeVersion(plan)
      if (check.kind !== 'supported') return 'claude-version-unsupported'
    } catch (err) {
      log(`[agent-hooks] claude の版を確かめられませんでした: ${errorMessageOf(err)}`)
      return 'claude-version-unsupported'
    }
    try {
      const { baseUrl } = await receiver.ensureListening()
      const dir = await settingsDir.ensure()
      const configPath = await writeSettingsFile(dir, buildAgentHookSettings({ baseUrl, token }))
      return { configPath, token, discard: () => void removeSettingsFile(configPath) }
    } catch (err) {
      // 例外の文言にトークンは含まれない(トークンは JSON の中身だけで、パス・URL に入れない)
      log(
        `[agent-hooks] hooks の受け口・設定のファイルを用意できませんでした: ${errorMessageOf(err)}`
      )
      return 'receiver-unavailable'
    }
  }

  // copilot の版は確かめない(L-052)。受け口 → 枠 → 書き直しの順。失敗の各段で hooks なしの起動にし、取った枠は返す。枠は書き直しを
  // 待ってから prepare を解決し、release(pty の終了・起動しなかったとき)まで返さないので、同じ枠への書き込みは重ならない
  const prepareCopilot: KindPreparer = async (_plan, token) => {
    let baseUrl: string
    try {
      ;({ baseUrl } = await receiver.ensureListening())
    } catch (err) {
      log(`[agent-hooks] hooks の受け口を用意できませんでした: ${errorMessageOf(err)}`)
      return 'receiver-unavailable'
    }
    const slot = copilotPlugins.acquire()
    if (slot === null) {
      log('[agent-hooks] copilot の hooks のフォルダの枠が空いていません')
      return 'receiver-unavailable'
    }
    try {
      await copilotPlugins.write(slot, buildCopilotHookConfig({ baseUrl, token }))
    } catch (err) {
      copilotPlugins.release(slot)
      // fs の例外にはパス(利用者名)が入りうるので、ログにだけ出す(画面に出さない。L-017)
      log(`[agent-hooks] copilot の hooks のフォルダを用意できませんでした: ${errorMessageOf(err)}`)
      return 'receiver-unavailable'
    }
    return { configPath: slot.dir, token, discard: () => copilotPlugins.release(slot) }
  }

  /** 種類ごとの準備の表(種類を足したときの決め忘れを型エラーにする。L-060) */
  const preparers: Record<AgentCliKind, KindPreparer> = {
    claude: prepareClaude,
    copilot: prepareCopilot
  }

  return {
    async prepare(ownerId, plan) {
      // 区別に対応しない種類(今の表には無い。将来の種類の守り)は、版の確認も受け口の用意もしない(L-043)。activate は
      // hooks === null の経路で、追跡に unconfirmed(cli-unsupported)で足す
      if (!agentCliCapabilities(plan.cliKind).changeAttribution) {
        return without(ownerId, plan.cliKind, 'cli-unsupported')
      }
      const result = await preparers[plan.cliKind](plan, createToken())
      return typeof result === 'string'
        ? without(ownerId, plan.cliKind, result)
        : { ownerId, cliKind: plan.cliKind, hooks: result, unavailableReason: null }
    },
    activate(prepared, sessionId, cliSessionId) {
      if (prepared.hooks === null) {
        tracker.addSession(prepared.ownerId, sessionId, {
          kind: 'unconfirmed',
          reason: prepared.unavailableReason
        })
        return
      }
      // 追跡に先に足す(addToken で投げても、追跡は pending〈段階は agent〉で残る。安全側。頑健性の 5)
      tracker.addSession(prepared.ownerId, sessionId, { kind: 'pending' })
      receiver.addToken(prepared.hooks.token, {
        ownerId: prepared.ownerId,
        sessionId,
        cli: OWNER_CLI_OF[prepared.cliKind](cliSessionId)
      })
    },
    release(prepared, sessionId) {
      if (prepared.hooks !== null) {
        const { token, discard } = prepared.hooks
        // 1 つが投げても残りを試す(枠を返し損ねると、以後の copilot が hooks なしで起動する。L-001・L-053)
        try {
          receiver.removeToken(token)
        } catch (err) {
          log(`[agent-hooks] hooks のトークンを外せませんでした: ${errorMessageOf(err)}`)
        }
        try {
          discard()
        } catch (err) {
          log(`[agent-hooks] hooks の後始末に失敗しました: ${errorMessageOf(err)}`)
        }
      }
      if (sessionId !== null) tracker.removeSession(prepared.ownerId, sessionId)
    }
  }
}
