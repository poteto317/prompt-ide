import { userInfo } from 'node:os'
import { spawn as ptySpawn } from 'node-pty'
import type { PtySpawn, StopTree } from './agentSession'
import { isExecutableRegularFile, resolveAgentLaunch } from './agentCommand'
import type { AgentLaunchResolution } from './agentCommand'
import { readLoginShellPath } from './agentShellEnv'
import { stopProcessTree } from './agentProcessTree'

// 実物の依存(node-pty・ログインシェル・ps・シグナル)の組み立て。ipcHandlers.ts から使い、テストではこのモジュールごと差し替える

function currentUserShell(): string | null {
  try {
    return userInfo().shell
  } catch {
    return null
  }
}

export const spawnAgentPty: PtySpawn = (file, args, options) => ptySpawn(file, args, options)

export const resolveAgentLaunchFromSystem = (): Promise<AgentLaunchResolution> =>
  resolveAgentLaunch({
    env: process.env,
    platform: process.platform,
    readLoginShellPath: () => readLoginShellPath({ userShell: currentUserShell() }),
    isExecutable: isExecutableRegularFile
  })

export const stopAgentPtyTree: StopTree = (pty, exited) =>
  stopProcessTree({ pid: pty.pid, exited, killPty: () => pty.kill() })
