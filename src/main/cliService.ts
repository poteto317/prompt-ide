import { spawn } from 'node:child_process'
import type { CLIOnlyToolId } from '@shared/types'
import { appendSearchPaths, getCliSearchPaths } from './cliSearchPaths'

interface ToolConfig {
  command: string
  buildArgs: (content: string) => string[]
  // useStdin は buildArgs が content を引数に含めるかどうかと対で管理する。
  // true なら buildArgs は content を無視し、stdin 書き込みのみでプロンプトを渡すこと
  // （両方に content を渡すと二重送信になり、どちらにも渡さないと空プロンプトになる）
  useStdin: boolean
}

const TOOL_COMMANDS: Record<CLIOnlyToolId, ToolConfig> = {
  claude: { command: 'claude', buildArgs: () => ['--print'], useStdin: true },
  // gh copilot はプロンプトを -p フラグの引数として受け取る（gh models run とは別コマンド。
  // stdin 経由のプロンプト入力はサポートされない。また -p は argv 経由のため、
  // OS のコマンドライン引数長上限（ARG_MAX 等）を超える巨大な添付ファイル内容は送信できない）
  copilot: {
    command: 'gh',
    buildArgs: (content) => ['copilot', '-p', content],
    useStdin: false
  }
}

const CLI_TIMEOUT_MS = 30_000
const SIGKILL_GRACE_MS = 5_000

function buildEnv(): NodeJS.ProcessEnv {
  // Windows ではシステムの PATH をそのまま使う（Unix 固有パスや ':' 区切りは不要）
  if (process.platform === 'win32') {
    return { ...process.env }
  }
  // 既定の探索先はエージェントの起動(agentCommand)と共有する(cliSearchPaths)
  return {
    ...process.env,
    PATH: appendSearchPaths(process.env.PATH, getCliSearchPaths(process.env.HOME))
  }
}

export interface RunCLIPromptOptions {
  /** stdout のチャンクを受信するたびに呼ばれる(逐次表示用) */
  onChunk?: (chunk: string) => void
  /** キャンセル関数を受け取るコールバック。呼び出し側はこれをレジストリ等に登録する */
  registerCancel?: (cancel: () => void) => void
}

export function runCLIPrompt(
  toolId: CLIOnlyToolId,
  content: string,
  options?: RunCLIPromptOptions
): Promise<string> {
  // TypeScript が CLIOnlyToolId を保証するが、型バイパス（as any 等）への防御として維持する
  const config = TOOL_COMMANDS[toolId]
  if (!config) return Promise.reject(new Error(`不明な CLI ツール: ${toolId}`))

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let settled = false
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      fn()
    }

    const child = spawn(config.command, config.buildArgs(content), { env: buildEnv() })

    // close イベントの発火有無で「実際にプロセスが終了したか」を追跡する
    // （テスト用モックには exitCode/signalCode が無いため、実プロセスの状態に依存しない）。
    // settled は「Promise が確定したか」を表し settle() 内で true になるため、
    // killWithEscalation はその後に呼ばれる → settled では代用できず exited が必要
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

    // ユーザー起因のキャンセルとタイムアウト等のシグナル終了を区別するためのフラグ
    let cancelled = false
    options?.registerCancel?.(() => {
      cancelled = true
      killWithEscalation()
    })

    // キャンセル要求後に発生したエラー(stdin書き込み失敗・プロセス起動失敗等)は、
    // 本来の原因がキャンセルによる kill 由来である可能性が高いため、close ハンドラと
    // 同様に「キャンセルされました」に合流させる。close だけを対象にすると、
    // stdin/spawn の error イベントが close より先に発火した場合にキャンセル操作が
    // 反映されない(元のエラーメッセージのまま reject される)抜け道が残ってしまう。
    const rejectUnlessCancelled = (message: string): void => {
      reject(new Error(cancelled ? 'キャンセルされました' : message))
    }

    let output = ''
    let errorOutput = ''

    // タイムアウトは「無出力が CLI_TIMEOUT_MS 続いたら」のアイドル方式。
    // 逐次出力が続いている限りはリセットされ、長い応答でも途中で切られない
    const startTimeout = (): void => {
      timer = setTimeout(() => {
        settle(() => {
          killWithEscalation()
          reject(new Error(`CLI ツールがタイムアウトしました（${CLI_TIMEOUT_MS / 1000}秒）`))
        })
      }, CLI_TIMEOUT_MS)
    }
    const resetTimeout = (): void => {
      if (settled) return
      if (timer !== null) clearTimeout(timer)
      startTimeout()
    }

    // setEncoding で StringDecoder に委ねることでチャンク境界でのマルチバイト文字化けを防ぐ
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      options?.onChunk?.(chunk)
      resetTimeout()
    })
    child.stderr.on('data', (chunk: string) => {
      errorOutput += chunk
      resetTimeout()
    })
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      settle(() => {
        killWithEscalation()
        rejectUnlessCancelled(`stdin への書き込みに失敗しました: ${err.message}`)
      })
    })

    // stdin 操作より先に close/error を登録して起動失敗時の早期イベントを確実に捕捉する
    child.on('close', (code, signal) => {
      exited = true
      // キャンセル要求後は終了コードに関わらず「キャンセルされました」に合流させる。
      // SIGTERM を受けたプロセスが正常終了扱いの 0 で終了することがあり、
      // code === 0 を先にチェックすると意図しない成功 resolve になってしまう
      // (Claude API 側の AbortController によるキャンセルと挙動を揃える)。
      if (cancelled) {
        settle(() => reject(new Error('キャンセルされました')))
      } else if (code === 0) {
        settle(() => resolve(output))
      } else if (signal) {
        settle(() => reject(new Error(`CLI ツールがシグナル ${signal} で終了しました`)))
      } else {
        settle(() =>
          reject(new Error(errorOutput.trim() || `プロセスが終了コード ${code} で終了しました`))
        )
      }
    })

    child.on('error', (err) => {
      settle(() => rejectUnlessCancelled(`CLI ツールの起動に失敗しました: ${err.message}`))
    })

    // リスナー登録後にタイマーと stdin 書き込みを開始する
    startTimeout()

    // useStdin が false のツールはプロンプトを引数として渡し済みのため、stdin には何も書かず閉じるだけにする
    if (config.useStdin) {
      child.stdin.write(content, 'utf-8')
    }
    child.stdin.end()
  })
}
