import { randomBytes } from 'node:crypto'
import { agentCliCapabilities } from '@shared/agentCliKinds'
import { buildAgentHookSettings } from './agentHookSettings'
import type { AgentHookSettingsDir, AgentHookSettingsJson } from './agentHookSettings'
import type { AgentHookReceiver } from './agentHookReceiver'
import type { AgentHooksUnavailableReason, AgentToolActivity } from './agentToolActivity'
import type { ClaudeVersionReader } from './agentClaudeVersion'
import type { AgentLaunchPlan } from './agentCommand'

// starter に注入する hooks の準備・結び付け・解放(設計書「起動への組み込み」)。prepare は pty の sessionId を使わない
// (sessionId は spawn の直前の await を挟まない区間で振るため)。トークンは spawn の後の activate で初めて表に足す。
// prepare は失敗しても null を返さず、hooks なしで起動する理由を返す(L-001)

export type PreparedAgentHooks =
  | { ownerId: number; hooks: { settingsPath: string; token: string }; unavailableReason: null }
  | { ownerId: number; hooks: null; unavailableReason: AgentHooksUnavailableReason }

export interface AgentHookSessions {
  prepare(ownerId: number, plan: AgentLaunchPlan): Promise<PreparedAgentHooks>
  activate(prepared: PreparedAgentHooks, sessionId: string): void
  release(prepared: PreparedAgentHooks, sessionId: string | null): void
}

export interface AgentHookSessionsDeps {
  receiver: Pick<AgentHookReceiver, 'ensureListening' | 'addToken' | 'removeToken'>
  settingsDir: Pick<AgentHookSettingsDir, 'ensure'>
  tracker: Pick<AgentToolActivity, 'addSession' | 'removeSession'>
  versions: Pick<ClaudeVersionReader, 'readClaudeVersion'>
  writeSettingsFile: (dir: string, settings: AgentHookSettingsJson) => Promise<string>
  removeSettingsFile: (path: string) => Promise<void>
  log: (message: string) => void
  createToken?: () => string
}

const createRandomToken = (): string => randomBytes(32).toString('hex')
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function createAgentHookSessions({
  receiver,
  settingsDir,
  tracker,
  versions,
  writeSettingsFile,
  removeSettingsFile,
  log,
  createToken = createRandomToken
}: AgentHookSessionsDeps): AgentHookSessions {
  const without = (
    ownerId: number,
    unavailableReason: AgentHooksUnavailableReason
  ): PreparedAgentHooks => ({
    ownerId,
    hooks: null,
    unavailableReason
  })

  return {
    async prepare(ownerId, plan) {
      // 区別に対応しない種類(copilot)は、版の確認も受け口の用意もしない(copilot の実行ファイルに --version を渡して claude の版
      // として読まない。L-043)。activate は今の hooks === null の経路で、追跡に unconfirmed(cli-unsupported)で足す
      if (!agentCliCapabilities(plan.cliKind).changeAttribution) {
        return without(ownerId, 'cli-unsupported')
      }
      try {
        const check = await versions.readClaudeVersion(plan)
        if (check.kind !== 'supported') return without(ownerId, 'claude-version-unsupported')
      } catch (err) {
        log(`[agent-hooks] claude の版を確かめられませんでした: ${messageOf(err)}`)
        return without(ownerId, 'claude-version-unsupported')
      }
      try {
        const { baseUrl } = await receiver.ensureListening()
        const dir = await settingsDir.ensure()
        const token = createToken()
        const settingsPath = await writeSettingsFile(
          dir,
          buildAgentHookSettings({ baseUrl, token })
        )
        return { ownerId, hooks: { settingsPath, token }, unavailableReason: null }
      } catch (err) {
        // 例外の文言にトークンは含まれない(トークンは JSON の中身だけで、パス・URL に入れない)
        log(`[agent-hooks] hooks の受け口・設定のファイルを用意できませんでした: ${messageOf(err)}`)
        return without(ownerId, 'receiver-unavailable')
      }
    },
    activate(prepared, sessionId) {
      if (prepared.hooks === null) {
        tracker.addSession(prepared.ownerId, sessionId, {
          kind: 'unconfirmed',
          reason: prepared.unavailableReason
        })
        return
      }
      // 追跡に先に足す(addToken で投げても、追跡は pending〈段階は agent〉で残る。安全側。頑健性の 5)
      tracker.addSession(prepared.ownerId, sessionId, { kind: 'pending' })
      receiver.addToken(prepared.hooks.token, { ownerId: prepared.ownerId, sessionId })
    },
    release(prepared, sessionId) {
      if (prepared.hooks !== null) {
        receiver.removeToken(prepared.hooks.token)
        void removeSettingsFile(prepared.hooks.settingsPath)
      }
      if (sessionId !== null) tracker.removeSession(prepared.ownerId, sessionId)
    }
  }
}
