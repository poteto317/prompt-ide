import { userInfo } from 'node:os'
import { spawn as ptySpawn } from 'node-pty'
import type { PtySpawn, StopTree } from './agentSession'
import { isExecutableRegularFile, resolveAgentLaunch } from './agentCommand'
import type { AgentLaunchResolution } from './agentCommand'
import { readLoginShellPath } from './agentShellEnv'
import { stopProcessTree } from './agentProcessTree'
import { getAgentCliKindSetting } from './agentCliKindStore'

// 実物の依存(node-pty・ログインシェル・ps・シグナル・設定ファイル)の組み立て。ipcHandlers.ts から使い、テストではこのモジュールごと差し替える

function currentUserShell(): string | null {
  try {
    return userInfo().shell
  } catch {
    return null
  }
}

export const spawnAgentPty: PtySpawn = (file, args, options) => ptySpawn(file, args, options)

// 起動のたびに main が設定を読む(renderer の値は使わない。L-019)。保存した値は、保存の後に始まった起動から使われる(L-466)。
// 読んだ種類は計画に入れ、後の手順(探索・引数・環境変数・hooks・再開の可否・記録)はその値を使う(L-018)
export const resolveAgentLaunchFromSystem = async (): Promise<AgentLaunchResolution> =>
  resolveAgentLaunch({
    env: process.env,
    platform: process.platform,
    cliKind: (await getAgentCliKindSetting()).kind,
    readLoginShellPath: () => readLoginShellPath({ userShell: currentUserShell() }),
    isExecutable: isExecutableRegularFile
  })

export const stopAgentPtyTree: StopTree = (pty, exited) =>
  stopProcessTree({ pid: pty.pid, exited, killPty: () => pty.kill() })
