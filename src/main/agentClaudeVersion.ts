import type { ExecFileException, ExecFileOptions } from 'node:child_process'
import type { AgentLaunchPlan } from './agentCommand'

// 起動する claude の版の確認(設計書「claude の版の確認」)。http の hook を受け付け、知らないイベント名で設定のファイル全体を
// 無視しない最初の版(2.1.101。確認の結果 10)以上と分かったときだけ hooks を渡す。claude --version はシェルを通さず
// (Windows の .cmd・.bat は cmd.exe の形を固定して)、起動と同じ環境で、打ち切り 5 秒・出力 4 KiB まで実行し、打ち切りの
// 1 秒後にまだ終わっていなければ SIGKILL を送る(L-052)。版を読めた結果と形の違う出力だけを、パス・mtime・大きさを鍵に控える。
// 一時的な失敗は控えず、次の起動で確かめ直す(L-427)。実物の execFile は agentHooksRuntime.ts が注入する

export type ClaudeVersion = readonly [number, number, number]

export const AGENT_HOOKS_MIN_CLAUDE_VERSION: ClaudeVersion = [2, 1, 101]
export const CLAUDE_VERSION_TIMEOUT_MS = 5_000
export const CLAUDE_VERSION_KILL_GRACE_MS = 1_000
export const CLAUDE_VERSION_MAX_OUTPUT_BYTES = 4_096

const LOG_OUTPUT_HEAD_LENGTH = 80

export function parseClaudeVersion(output: string): ClaudeVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(output.trimStart())
  if (match === null) return null
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const
  return parts.every((part) => Number.isSafeInteger(part)) ? parts : null
}

export function supportsHttpHooks(version: ClaudeVersion): boolean {
  for (let i = 0; i < 3; i++) {
    if (version[i] !== AGENT_HOOKS_MIN_CLAUDE_VERSION[i])
      return version[i] > AGENT_HOOKS_MIN_CLAUDE_VERSION[i]
  }
  return true
}

export type ClaudeVersionUnknownReason =
  | 'malformed-output'
  | 'timeout'
  | 'spawn-failed'
  | 'exit-nonzero'

export type ClaudeVersionCheck =
  | { kind: 'supported'; version: string }
  | { kind: 'unsupported'; version: string }
  | { kind: 'unknown'; reason: ClaudeVersionUnknownReason; detail: string }

export interface ExecFileChild {
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  kill(signal: NodeJS.Signals): boolean
}

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void
) => ExecFileChild

export interface ClaudeVersionReaderDeps {
  execFile: ExecFileLike
  stat: (path: string) => Promise<{ mtimeMs: number; size: number }>
  platform: NodeJS.Platform
  /** Windows の cmd.exe の絶対パス(.cmd・.bat の実行に使う。win32 以外では使わない) */
  comspec: string
  log: (message: string) => void
}

export interface ClaudeVersionReader {
  readClaudeVersion(plan: Pick<AgentLaunchPlan, 'file' | 'env'>): Promise<ClaudeVersionCheck>
}

/** 実行の結果を判定にする(版を読めた・形の違う出力 → 控えてよい、それ以外 → 控えない) */
function classify(error: ExecFileException | null, stdout: string): ClaudeVersionCheck {
  if (error !== null) {
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      return {
        kind: 'unknown',
        reason: 'malformed-output',
        detail: `出力が ${CLAUDE_VERSION_MAX_OUTPUT_BYTES} バイトを超えました`
      }
    }
    if (error.killed === true)
      return { kind: 'unknown', reason: 'timeout', detail: `シグナル ${error.signal ?? '不明'}` }
    if (typeof error.code === 'number')
      return { kind: 'unknown', reason: 'exit-nonzero', detail: `終了コード ${error.code}` }
    return { kind: 'unknown', reason: 'spawn-failed', detail: String(error.code ?? error.message) }
  }
  const version = parseClaudeVersion(stdout)
  if (version === null) {
    return {
      kind: 'unknown',
      reason: 'malformed-output',
      detail: stdout.slice(0, LOG_OUTPUT_HEAD_LENGTH)
    }
  }
  const text = version.join('.')
  return supportsHttpHooks(version)
    ? { kind: 'supported', version: text }
    : { kind: 'unsupported', version: text }
}

const isCacheable = (check: ClaudeVersionCheck): boolean =>
  check.kind !== 'unknown' || check.reason === 'malformed-output'

/** 結果のログの 1 行 */
export function describeClaudeVersionCheck(check: ClaudeVersionCheck): string {
  return check.kind === 'unknown'
    ? `[agent-hooks] claude の版を確かめられませんでした(${check.reason}): ${check.detail}`
    : `[agent-hooks] claude の版: ${check.version}(${check.kind === 'supported' ? 'hooks を渡す' : 'hooks を渡さない'})`
}

export interface ClaudeVersionCommand {
  file: string
  args: string[]
  /** 打ち切り・出力の上限・環境変数を除いた、形ごとのオプション */
  options: Pick<ExecFileOptions, 'windowsVerbatimArguments' | 'windowsHide'>
}

/**
 * claude --version の実行の形(シェルを通さない)。Windows の .cmd・.bat は Node の shell: true と同じ形の引数(/d /s /c)で、
 * 実行するのは注入された cmd.exe の絶対パス(Node の shell: true と同じく ComSpec。名前だけだと libuv が PATH より先に
 * 作業ディレクトリから探し、そこの cmd.exe を実行しうる)。/s は最初と最後の " だけを外すため、パスの引用が残る
 */
export function claudeVersionCommand(
  file: string,
  platform: NodeJS.Platform,
  comspec: string
): ClaudeVersionCommand {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    return {
      file: comspec,
      args: ['/d', '/s', '/c', `""${file}" --version"`],
      options: { windowsVerbatimArguments: true, windowsHide: true }
    }
  }
  return { file, args: ['--version'], options: { windowsHide: true } }
}

export function createClaudeVersionReader({
  execFile: run,
  stat,
  platform,
  comspec,
  log
}: ClaudeVersionReaderDeps): ClaudeVersionReader {
  const cache = new Map<string, ClaudeVersionCheck>()
  // 同じ鍵の実行中の確認(同時の起動で claude --version を起動の数だけ走らせない)
  const inflight = new Map<string, Promise<ClaudeVersionCheck>>()

  const keyOf = async (file: string): Promise<string | null> => {
    try {
      const stats = await stat(file)
      return `${file}\u0000${stats.mtimeMs}\u0000${stats.size}`
    } catch {
      return null
    }
  }

  const execute = (file: string, env: Record<string, string>): Promise<ClaudeVersionCheck> =>
    new Promise((resolve) => {
      const common = {
        env,
        timeout: CLAUDE_VERSION_TIMEOUT_MS,
        killSignal: 'SIGTERM' as const,
        maxBuffer: CLAUDE_VERSION_MAX_OUTPUT_BYTES
      }
      const command = claudeVersionCommand(file, platform, comspec)
      // 打ち切り(SIGTERM)の 1 秒後にまだ終わっていなければ SIGKILL を送る(L-052)
      let child: ExecFileChild | null = null
      const killTimer = setTimeout(() => {
        if (child !== null && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
        }
      }, CLAUDE_VERSION_TIMEOUT_MS + CLAUDE_VERSION_KILL_GRACE_MS)
      killTimer.unref()
      const callback = (error: ExecFileException | null, stdout: string): void => {
        clearTimeout(killTimer)
        resolve(classify(error, stdout))
      }
      try {
        child = run(command.file, command.args, { ...command.options, ...common }, callback)
      } catch (err) {
        // 同期の例外(引数の検査など)はタイマーを止めてから reject する(呼び出し側は版が分からないとして扱う)
        clearTimeout(killTimer)
        throw err
      }
    })

  const executeAndRecord = async (
    key: string | null,
    file: string,
    env: Record<string, string>
  ): Promise<ClaudeVersionCheck> => {
    const check = await execute(file, env)
    log(describeClaudeVersionCheck(check))
    if (key !== null && isCacheable(check)) cache.set(key, check)
    return check
  }

  return {
    async readClaudeVersion({ file, env }) {
      const key = await keyOf(file)
      if (key === null) return executeAndRecord(key, file, env)
      const cached = cache.get(key)
      if (cached !== undefined) return cached
      const running = inflight.get(key)
      if (running !== undefined) return running
      const promise = executeAndRecord(key, file, env).finally(() => {
        inflight.delete(key)
      })
      inflight.set(key, promise)
      return promise
    }
  }
}
