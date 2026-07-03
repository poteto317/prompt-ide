import { spawn } from 'node:child_process'
import type { CLIOnlyToolId } from '@shared/types'

interface ToolConfig {
  command: string
  buildArgs: (content: string) => string[]
  // false の場合、プロンプト内容は引数として渡すため stdin には書き込まない
  useStdin: boolean
}

const TOOL_COMMANDS: Record<CLIOnlyToolId, ToolConfig> = {
  claude: { command: 'claude', buildArgs: () => ['--print'], useStdin: true },
  // gh copilot はプロンプトを -p フラグの引数として受け取る（gh models run とは別コマンド。
  // stdin 経由のプロンプト入力はサポートされない）
  copilot: {
    command: 'gh',
    buildArgs: (content) => ['copilot', '-p', content],
    useStdin: false,
  },
}

const CLI_TIMEOUT_MS = 30_000
const SIGKILL_GRACE_MS = 5_000

function buildEnv(): NodeJS.ProcessEnv {
  // Windows ではシステムの PATH をそのまま使う（Unix 固有パスや ':' 区切りは不要）
  if (process.platform === 'win32') {
    return { ...process.env }
  }
  const extra = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/snap/bin',
    process.env.HOME && `${process.env.HOME}/.local/bin`,
    process.env.HOME && `${process.env.HOME}/.cargo/bin`,
  ].filter(Boolean) as string[]
  const extraStr = extra.join(':')
  const basePath = process.env.PATH ? `${process.env.PATH}:${extraStr}` : extraStr
  return { ...process.env, PATH: basePath }
}

export function runCLIPrompt(toolId: CLIOnlyToolId, content: string): Promise<string> {
  // TypeScript が CLIOnlyToolId を保証するが、型バイパス（as any 等）への防御として維持する
  const config = TOOL_COMMANDS[toolId]
  if (!config) return Promise.reject(new Error(`不明な CLI ツール: ${toolId}`))

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      fn()
    }

    const child = spawn(config.command, config.buildArgs(content), { env: buildEnv() })

    // close イベントの発火有無で「実際にプロセスが終了したか」を追跡する
    // （テスト用モックには exitCode/signalCode が無いため、実プロセスの状態に依存しない）
    let exited = false

    // SIGTERM を無視するプロセスがバックグラウンドに残り続けないよう、
    // 猶予時間内に終了しなければ SIGKILL へエスカレーションする
    const killWithEscalation = (): void => {
      child.kill()
      const escalationTimer = setTimeout(() => {
        if (!exited) child.kill('SIGKILL')
      }, SIGKILL_GRACE_MS)
      escalationTimer.unref()
    }

    let output = ''
    let errorOutput = ''

    // setEncoding で StringDecoder に委ねることでチャンク境界でのマルチバイト文字化けを防ぐ
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { output += chunk })
    child.stderr.on('data', (chunk: string) => { errorOutput += chunk })
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      settle(() => { killWithEscalation(); reject(new Error(`stdin への書き込みに失敗しました: ${err.message}`)) })
    })

    // stdin 操作より先に close/error を登録して起動失敗時の早期イベントを確実に捕捉する
    child.on('close', (code, signal) => {
      exited = true
      if (code === 0) {
        settle(() => resolve(output))
      } else if (signal) {
        settle(() => reject(new Error(`CLI ツールがシグナル ${signal} で終了しました`)))
      } else {
        settle(() => reject(new Error(errorOutput.trim() || `プロセスが終了コード ${code} で終了しました`)))
      }
    })

    child.on('error', (err) => {
      settle(() => reject(new Error(`CLI ツールの起動に失敗しました: ${err.message}`)))
    })

    // リスナー登録後にタイマーと stdin 書き込みを開始する
    timer = setTimeout(() => {
      settle(() => {
        killWithEscalation()
        reject(new Error(`CLI ツールがタイムアウトしました（${CLI_TIMEOUT_MS / 1000}秒）`))
      })
    }, CLI_TIMEOUT_MS)

    // useStdin が false のツールはプロンプトを引数として渡し済みのため、stdin には何も書かず閉じるだけにする
    if (config.useStdin) {
      child.stdin.write(content, 'utf-8')
    }
    child.stdin.end()
  })
}
