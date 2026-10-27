import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createAgentToolActivity } from './agentToolActivity'
import type { AgentToolActivity, AgentToolActivityDeps } from './agentToolActivity'
import { createAgentHookReceiver } from './agentHookReceiver'
import type { AgentHookReceiverDeps } from './agentHookReceiver'
import {
  createAgentHookSettingsDir,
  removeAgentHookSettingsFile,
  writeAgentHookSettingsFile
} from './agentHookSettings'
import { createClaudeVersionReader } from './agentClaudeVersion'
import type { ExecFileLike } from './agentClaudeVersion'
import { createAgentHookSessions } from './agentHookSessions'
import {
  COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME,
  createCopilotHookPluginSlots
} from './agentCopilotHookPlugin'
import type { AgentHookSessions } from './agentHookSessions'
import type { AgentHooksLifecycleParts } from './agentHooksLifecycle'

// claude・copilot の hooks の実物の依存(子プロセス・ファイル・HTTP の受け口)の組み立て(agentRuntime.ts と同じく、ipcHandlers.ts から使い、
// テストではこのモジュールごと差し替える)。Electron に依存しない。追跡・受け口のつなぎ先(合図の変化の通知・PreToolUse の待ち・
// 待ちの打ち切り)と開発版のログの有無は ipcHandlers.ts が決めて渡す

/** 実物の execFile(出力は utf8 の文字列) */
export const nodeExecFile: ExecFileLike = (file, args, options, callback) =>
  execFile(file, [...args], { ...options, encoding: 'utf8' }, callback)

/**
 * Windows の cmd.exe の絶対パス(Node の shell: true と同じ ComSpec。無いか空なら SystemRoot の System32。Windows 以外では使われない)。
 * 空の値は使わない(Node と同じく || で選ぶ。空の file は execFile が ERR_INVALID_ARG_VALUE で拒む)
 */
const windowsComspec = (): string =>
  process.env.ComSpec || join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')

export interface AgentHooksRuntimeOptions {
  /** 追跡の合図が変わったとき(記録の registry の notifyAttributionSignal) */
  onPhaseChange: AgentToolActivityDeps['onPhaseChange']
  /** 受け口の PreToolUse の待ち(registry の waitForAgentPhase) */
  onToolStart: AgentHookReceiverDeps['onToolStart']
  /** 受け口の待ちの打ち切り(registry の markToolStartTimedOut) */
  onToolStartTimedOut: AgentHookReceiverDeps['onToolStartTimedOut']
  /** 開発版のログ(1 行ずつ)。null なら出さない */
  devLog: AgentToolActivityDeps['devLog']
  /** アプリのデータのフォルダ(copilot のプラグインのフォルダ <userData>/agent-hooks-copilot の置き場)。ipcHandlers.ts が
   *  app.getPath('userData') を渡す(このモジュールは Electron に依存しない) */
  userDataDir: string
}

export interface AgentHooksRuntime {
  /** ツールの区間の追跡(作業中・作業の終わりの知らせの受け口に reportWorking・reportWorkingEnded を渡す) */
  tracker: AgentToolActivity
  /** 起動ごとの hooks の準備・結び付け・解放(starter の hooks) */
  sessions: AgentHookSessions
  /** will-quit で片付けるもの(setupAgentHooksLifecycle に渡す) */
  lifecycleParts: AgentHooksLifecycleParts
}

export function createAgentHooksRuntime({
  onPhaseChange,
  onToolStart,
  onToolStartTimedOut,
  devLog,
  userDataDir
}: AgentHooksRuntimeOptions): AgentHooksRuntime {
  const warn = (message: string): void => console.warn(message)
  const tracker = createAgentToolActivity({ onPhaseChange, devLog, warn })
  // 受け口(127.0.0.1)は照合の通った知らせを追跡の deliver にそのまま渡す
  const receiver = createAgentHookReceiver({
    deliver: (ownerId, sessionId, event) => tracker.deliver(ownerId, sessionId, event),
    onToolStart,
    onToolStartTimedOut,
    log: warn
  })
  const settingsDir = createAgentHookSettingsDir()
  const copilotPlugins = createCopilotHookPluginSlots({
    rootDir: join(userDataDir, COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME)
  })
  // 起動ごとの hooks の準備(claude は版の確認 → 受け口 → 設定のファイル、copilot は受け口 → 枠 → プラグインのフォルダ)・結び付け・解放
  const sessions = createAgentHookSessions({
    receiver,
    settingsDir,
    tracker,
    versions: createClaudeVersionReader({
      execFile: nodeExecFile,
      stat: (path) => stat(path),
      platform: process.platform,
      comspec: windowsComspec(),
      log: warn
    }),
    writeSettingsFile: writeAgentHookSettingsFile,
    removeSettingsFile: removeAgentHookSettingsFile,
    copilotPlugins,
    log: warn
  })
  return { tracker, sessions, lifecycleParts: { receiver, settingsDir, copilotPlugins, tracker } }
}
