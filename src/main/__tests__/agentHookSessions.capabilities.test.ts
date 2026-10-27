import { describe, expect, it, vi } from 'vitest'
import type { AgentCliCapabilities, AgentCliKind } from '@shared/agentCliKinds'

// 能力の表の changeAttribution が偽の種類の流れ(cli-unsupported)を確かめるため、能力の表を差し替える(段階 3b で copilot も区別に
// 対応し、今の表には該当する種類が無い。将来の種類の守り)。差し替えはこのファイルの中だけ(agentHookSessions.test.ts の copilot の
// 準備のテストにかからないよう、ファイルを分けた)
const capabilityOverrides = vi.hoisted(() => ({
  changeAttributionUnsupportedKinds: new Set<AgentCliKind>(['copilot'])
}))
vi.mock('@shared/agentCliKinds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/agentCliKinds')>()
  return {
    ...actual,
    agentCliCapabilities: (kind: AgentCliKind): AgentCliCapabilities => {
      const capabilities = { ...actual.agentCliCapabilities(kind) }
      if (capabilityOverrides.changeAttributionUnsupportedKinds.has(kind)) {
        capabilities.changeAttribution = false
      }
      return capabilities
    }
  }
})

import { createAgentHookSessions } from '../agentHookSessions'
import type { AgentHookSessionsDeps } from '../agentHookSessions'
import type { AgentLaunchPlan } from '../agentCommand'

describe('createAgentHookSessions(区別に対応しない種類)', () => {
  it('種類の能力に区別(changeAttribution)が無ければ、版の読み取りも受け口・枠の用意もせず cli-unsupported(L-043)', async () => {
    const deps = {
      receiver: { ensureListening: vi.fn(), addToken: vi.fn(), removeToken: vi.fn() },
      settingsDir: { ensure: vi.fn() },
      tracker: { addSession: vi.fn(), removeSession: vi.fn() },
      versions: { readClaudeVersion: vi.fn() },
      writeSettingsFile: vi.fn(),
      removeSettingsFile: vi.fn(),
      copilotPlugins: { acquire: vi.fn(), release: vi.fn(), write: vi.fn() },
      log: vi.fn()
    }
    const plan: AgentLaunchPlan = {
      cliKind: 'copilot',
      file: '/bin/copilot',
      args: [],
      env: { PATH: '/p' }
    }
    const sessions = createAgentHookSessions(deps as unknown as AgentHookSessionsDeps)
    await expect(sessions.prepare(7, plan)).resolves.toEqual({
      ownerId: 7,
      cliKind: 'copilot',
      hooks: null,
      unavailableReason: 'cli-unsupported'
    })
    for (const fn of [
      deps.receiver.ensureListening,
      deps.settingsDir.ensure,
      deps.versions.readClaudeVersion,
      deps.writeSettingsFile,
      deps.copilotPlugins.acquire,
      deps.copilotPlugins.write,
      deps.log
    ]) {
      expect(fn).not.toHaveBeenCalled()
    }
  })
})
