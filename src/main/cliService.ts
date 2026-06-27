import { spawn } from 'node:child_process'
import type { CLIOnlyToolId } from '@shared/types'

const TOOL_COMMANDS: Record<CLIOnlyToolId, { command: string; args: string[] }> = {
  claude: { command: 'claude', args: ['--print'] },
  copilot: { command: 'gh', args: ['models', 'run', 'copilot'] },
}

const CLI_TIMEOUT_MS = 30_000

function buildEnv(): NodeJS.ProcessEnv {
  // Windows ではシステムの PATH をそのまま使う（Unix 固有パスや ':' 区切りは不要）
  if (process.platform === 'win32') {
    return { ...process.env }
  }
  const extra = ['/usr/local/bin', '/opt/homebrew/bin', process.env.HOME && `${process.env.HOME}/.local/bin`]
    .filter(Boolean) as string[]
  const extraStr = extra.join(':')
  const basePath = process.env.PATH ? `${process.env.PATH}:${extraStr}` : extraStr
  return { ...process.env, PATH: basePath }
}

export function runCLIPrompt(toolId: CLIOnlyToolId, content: string): Promise<string> {
  // TypeScript が CLIOnlyToolId を保証するが、型バイパス（as any 等）への防御として維持する
  const config = TOOL_COMMANDS[toolId]
  if (!config) return Promise.reject(new Error(`不明な CLI ツール: ${toolId}`))

  return new Promise((resolve, reject) => {
    // timer を settle より前に let 宣言することで TDZ を回避する
    let timer: ReturnType<typeof setTimeout>
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const child = spawn(config.command, config.args, { env: buildEnv() })
    let output = ''
    let errorOutput = ''

    timer = setTimeout(() => {
      child.kill()
      settle(() => reject(new Error(`CLI ツールがタイムアウトしました（${CLI_TIMEOUT_MS / 1000}秒）`)))
    }, CLI_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf-8') })
    child.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString('utf-8') })

    child.stdin.on('error', () => {})
    child.stdin.write(content, 'utf-8')
    child.stdin.end()

    child.on('close', (code, signal) => {
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
  })
}
