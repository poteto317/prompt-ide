import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AgentHookEvent, AgentHookParseNote } from './agentHookEvents'
import { interpretAgentHookRequest } from './agentHookInterpretation'
import { isCopilotHookPath } from './agentHookProtocol'
import {
  agentHookResponseStatus,
  checkAgentHookRequest,
  readAgentHookBody
} from './agentHookReceiverRequest'
import type { AgentHookOwner, AgentHookRejectReason } from './agentHookReceiverRequest'

// claude・copilot の http の hook の受け口(設計書「受け口」、段階 3b の設計書「受け口」)。copilot の経路は、照合の失敗・閉じた後・処理の
// 例外でも常に 200 の空の本文を返す(状態コードの規則は agentHookResponseStatus)。本文を経路ごとに知らせにする規則(copilot の主の
// 会話の ID の振り分けを含む)は agentHookInterpretation.ts。127.0.0.1 のランダムなポートだけで待ち受け、セッションごとのトークンの
// SHA-256 で照合する(文字列の比較の時間で推測させない)。トークン・本文はログ・応答に出さない(L-017)。拒んだ要求は理由ごとの
// 件数だけを出す。PreToolUse は deliver(追跡の更新と段階の通知)を終えてから onToolStart を待ち、上限で打ち切る(L-052)。
// 本文を読む前の検査(checkAgentHookRequest)と本文の読み込み(readAgentHookBody)の規則は agentHookReceiverRequest.ts

export const AGENT_PRE_TOOL_USE_WAIT_MS = 5_000
export const AGENT_HOOK_HEADERS_TIMEOUT_MS = 5_000
export const AGENT_HOOK_REQUEST_TIMEOUT_MS = 15_000

export interface AgentHookReceiverDeps {
  /** 照合の通った知らせ 1 件につき 1 回だけ呼ぶ(同期。追跡の deliver をそのまま渡す) */
  deliver(ownerId: number, sessionId: string, event: AgentHookEvent): void
  /** PreToolUse で deliver の後に呼んで待つ(記録の registry の waitForAgentPhase につなぐ。同期の throw・reject は待ちの失敗として打ち切りと同じに扱う) */
  onToolStart(ownerId: number, signal: AbortSignal): Promise<void>
  /** onToolStart の待ちを上限で打ち切ったときに 1 回呼ぶ(記録の registry の markToolStartTimedOut につなぐ。待ちの失敗でも呼ぶ。close の後は呼ばない) */
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

/** 待っている PreToolUse 1 件(close でタイマーを外し、signal を中止して待ちを終わらせる) */
interface ToolStartWait {
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  /** close で待ちを終わらせる(onToolStartTimedOut を呼ばない) */
  close: () => void
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
  const waits = new Set<ToolStartWait>()

  /** 最初の 1 件と 100 件ごとにだけログに出す */
  const count = (
    label: '拒んだ要求' | '拒んだ要求（copilot）' | '読めない知らせ',
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
    let settle: (result: 'timeout' | 'closed') => void = () => undefined
    const stopped = new Promise<'timeout' | 'closed'>((resolve) => {
      settle = resolve
    })
    const wait: ToolStartWait = {
      controller,
      timer: setTimeout(() => settle('timeout'), preToolUseWaitMs),
      close: () => settle('closed')
    }
    waits.add(wait)
    // 同期の throw も reject と同じ「待ちの失敗」にする(L-055)
    const started = Promise.resolve()
      .then(() => onToolStart(ownerId, controller.signal))
      .then(
        () => 'started' as const,
        (err: unknown) => {
          log(`[agent-hooks] ツールの開始の待ちに失敗しました: ${messageOf(err)}`)
          return 'failed' as const
        }
      )
    const result = await Promise.race([started, stopped])
    clearTimeout(wait.timer)
    waits.delete(wait)
    // close の後は、記録の側も閉じているため打ち切りを知らせない(L-435)
    if (closed || result === 'closed' || result === 'started') return
    // 打ち切り・待ちの失敗は、覆えたか分からない区間として知らせる(L-002)
    controller.abort()
    onToolStartTimedOut(ownerId)
  }

  /** 拒んだ要求の件数のラベル(copilot の経路は分けて数える。claude のラベルと件数は今のまま) */
  const rejectLabelOf = (path: string): '拒んだ要求' | '拒んだ要求（copilot）' =>
    isCopilotHookPath(path) ? '拒んだ要求（copilot）' : '拒んだ要求'

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = req.url ?? ''
    // close の後に残った接続から届いた要求は、追跡に渡さない(L-435)。copilot の経路は 200(ツールを拒否させない)
    if (closed) {
      req.resume()
      respond(res, agentHookResponseStatus(path, 503))
      return
    }
    const check = checkAgentHookRequest(req, port, ownerOf)
    if (check.kind === 'rejected') {
      count(rejectLabelOf(path), check.reason)
      req.resume()
      respond(res, check.status)
      return
    }
    const { route, owner } = check
    const body = await readAgentHookBody(req)
    // 本文を読んでいる間に close した(接続が切れて unreadable になった)要求も渡さない
    if (closed) {
      respond(res, agentHookResponseStatus(path, 503))
      return
    }
    if (body.kind === 'too-large') count(rejectLabelOf(path), 'too-large')
    const { event, notes } = interpretAgentHookRequest(route, owner, body)
    for (const note of notes) count('読めない知らせ', note)
    // 知らせ 1 件につき 1 回。追跡はこの中で段階の通知まで同期的に済ませる
    deliver(owner.ownerId, owner.sessionId, event)
    if (route.event === 'PreToolUse') await waitForToolStart(owner.ownerId)
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
              // copilot の経路は 200(copilot は 5xx をツールの拒否にする)。claude の経路は今どおり 500
              respond(res, agentHookResponseStatus(req.url ?? '', 500))
            })
          })
          created.headersTimeout = AGENT_HOOK_HEADERS_TIMEOUT_MS
          created.requestTimeout = AGENT_HOOK_REQUEST_TIMEOUT_MS
          let listened = false
          // listen の失敗と、待ち受けの後の error(EMFILE など)の両方を 1 つの常駐のハンドラで受ける(頑健性の 1)。
          // 待ち受けの後に止まったら、控えた listening・server を捨てて次の ensureListening で始め直す(L-436)
          created.on('error', (err) => {
            created.close()
            if (!listened) {
              rejectListen(err)
              return
            }
            log(`[agent-hooks] 受け口が止まりました: ${messageOf(err)}`)
            if (server === created) {
              server = null
              listening = null
              port = 0
            }
          })
          created.listen({ host: '127.0.0.1', port: 0 }, () => {
            listened = true
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
      // 待っている PreToolUse の上限のタイマーを外し、記録の側の待ちも止める(L-435)
      for (const wait of waits) {
        clearTimeout(wait.timer)
        wait.controller.abort()
        wait.close()
      }
      waits.clear()
      if (server !== null) {
        server.close()
        server.closeAllConnections()
        server = null
      }
    }
  }
}
