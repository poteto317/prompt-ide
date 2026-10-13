import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { parseAgentHookRequest } from './agentHookEvents'
import type { AgentHookEvent, AgentHookParseNote } from './agentHookEvents'
import { checkAgentHookRequest, readAgentHookBody } from './agentHookReceiverRequest'
import type { AgentHookOwner, AgentHookRejectReason } from './agentHookReceiverRequest'

// claude の http の hook の受け口(設計書「受け口」)。127.0.0.1 のランダムなポートだけで待ち受け、セッションごとのトークンの
// SHA-256 で照合する(文字列の比較の時間で推測させない)。トークン・本文はログ・応答に出さない(L-017)。拒んだ要求は理由ごとの
// 件数だけを出す。PreToolUse は deliver(追跡の更新と段階の通知)を終えてから onToolStart を待ち、上限で打ち切る(L-052)。
// 本文を読む前の検査(checkAgentHookRequest)と本文の読み込み(readAgentHookBody)の規則は agentHookReceiverRequest.ts

export const AGENT_PRE_TOOL_USE_WAIT_MS = 5_000
export const AGENT_HOOK_HEADERS_TIMEOUT_MS = 5_000
export const AGENT_HOOK_REQUEST_TIMEOUT_MS = 15_000

export interface AgentHookReceiverDeps {
  /** 照合の通った知らせ 1 件につき 1 回だけ呼ぶ(同期。追跡の deliver をそのまま渡す) */
  deliver(ownerId: number, sessionId: string, event: AgentHookEvent): void
  /** PreToolUse で deliver の後に呼んで待つ(段階 A はすぐ解決する。段階 B で waitForAgentPhase につなぐ) */
  onToolStart(ownerId: number, signal: AbortSignal): Promise<void>
  /** onToolStart の待ちを上限で打ち切ったときに 1 回呼ぶ(段階 A は何もしない。段階 B で markPeriodUnassignable につなぐ) */
  onToolStartTimedOut(ownerId: number): void
  /** 常に出すログ(拒んだ要求の件数など。トークン・本文は渡さない) */
  log(message: string): void
  /** テスト用。PreToolUse の待ちの上限(既定 AGENT_PRE_TOOL_USE_WAIT_MS) */
  preToolUseWaitMs?: number
}

export interface AgentHookReceiver {
  /** 初回に listen する。Promise を共有し、失敗したら捨てて次の呼び出しで始め直す */
  ensureListening(): Promise<{ baseUrl: string }>
  addToken(token: string, owner: AgentHookOwner): void
  removeToken(token: string): void
  /** 待ち受けをやめ、つながっている接続も切る(will-quit) */
  close(): void
}

const BEARER_PATTERN = /^Bearer ([0-9a-f]{64})$/
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function createAgentHookReceiver({
  deliver,
  onToolStart,
  onToolStartTimedOut,
  log,
  preToolUseWaitMs = AGENT_PRE_TOOL_USE_WAIT_MS
}: AgentHookReceiverDeps): AgentHookReceiver {
  const owners = new Map<string, AgentHookOwner>()
  const counts = new Map<string, number>()
  let server: Server | null = null
  let listening: Promise<{ baseUrl: string }> | null = null
  let port = 0
  let closed = false

  /** 最初の 1 件と 100 件ごとにだけログに出す */
  const count = (
    label: '拒んだ要求' | '読めない知らせ',
    reason: AgentHookRejectReason | AgentHookParseNote
  ): void => {
    const key = `${label}\u0000${reason}`
    const next = (counts.get(key) ?? 0) + 1
    counts.set(key, next)
    if (next === 1 || next % 100 === 0) log(`[agent-hooks] ${label}: ${reason} ${next} 件`)
  }

  const respond = (res: ServerResponse, status: number): void => {
    if (res.destroyed || res.writableEnded) return
    res.writeHead(status, { 'Content-Length': '0' })
    res.end()
  }

  const ownerOf = (authorization: string | undefined): AgentHookOwner | null => {
    const match = BEARER_PATTERN.exec(authorization ?? '')
    if (match === null) return null
    return owners.get(sha256(match[1])) ?? null
  }

  const waitForToolStart = async (ownerId: number): Promise<void> => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), preToolUseWaitMs)
    })
    const started = onToolStart(ownerId, controller.signal).then(
      () => 'started' as const,
      (err: unknown) => {
        log(`[agent-hooks] ツールの開始の待ちに失敗しました: ${messageOf(err)}`)
        return 'failed' as const
      }
    )
    const result = await Promise.race([started, timedOut])
    clearTimeout(timer)
    if (result === 'timeout') {
      controller.abort()
      onToolStartTimedOut(ownerId)
    }
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const check = checkAgentHookRequest(req, port, ownerOf)
    if (check.kind === 'rejected') {
      count('拒んだ要求', check.reason)
      req.resume()
      respond(res, check.status)
      return
    }
    const { event, owner } = check
    const body = await readAgentHookBody(req)
    if (body.kind === 'too-large') count('拒んだ要求', 'too-large')
    const { event: parsed, notes } = parseAgentHookRequest(event, body)
    for (const note of notes) count('読めない知らせ', note)
    // 知らせ 1 件につき 1 回。追跡はこの中で段階の通知まで同期的に済ませる
    deliver(owner.ownerId, owner.sessionId, parsed)
    if (event === 'PreToolUse') await waitForToolStart(owner.ownerId)
    respond(res, 200)
  }

  return {
    ensureListening() {
      if (closed) return Promise.reject(new Error('受け口は閉じています'))
      if (listening === null) {
        const attempt = new Promise<{ baseUrl: string }>((resolve, rejectListen) => {
          const created = createServer((req, res) => {
            void handle(req, res).catch((err: unknown) => {
              log(`[agent-hooks] 要求の処理に失敗しました: ${messageOf(err)}`)
              respond(res, 500)
            })
          })
          created.headersTimeout = AGENT_HOOK_HEADERS_TIMEOUT_MS
          created.requestTimeout = AGENT_HOOK_REQUEST_TIMEOUT_MS
          created.once('error', (err) => {
            created.close()
            rejectListen(err)
          })
          created.listen({ host: '127.0.0.1', port: 0 }, () => {
            const address = created.address()
            if (closed || address === null || typeof address === 'string') {
              created.close()
              rejectListen(new Error('受け口は閉じています'))
              return
            }
            port = address.port
            server = created
            resolve({ baseUrl: `http://127.0.0.1:${port}` })
          })
        })
        listening = attempt
        attempt.catch(() => {
          if (listening === attempt) listening = null
        })
      }
      return listening
    },
    addToken(token, owner) {
      owners.set(sha256(token), owner)
    },
    removeToken(token) {
      owners.delete(sha256(token))
    },
    close() {
      closed = true
      owners.clear()
      if (server !== null) {
        server.close()
        server.closeAllConnections()
        server = null
      }
    }
  }
}
