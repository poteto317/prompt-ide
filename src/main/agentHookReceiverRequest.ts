import type { IncomingMessage } from 'node:http'
import { agentHookEventOfPath } from './agentHookProtocol'
import type { AgentHookEventName } from './agentHookProtocol'
import type { AgentHookBody } from './agentHookEvents'

// claude の http の hook の要求の受け付けの規則(設計書「受け口」)。本文を読む前の検査(メソッド・パス・Host・Origin・トークン・
// Content-Type の順)と、上限つきの本文の読み込み。待ち受けの状態(サーバー・ポート・トークンの表・件数)を持たない。
// 待ち受け・トークンの表・拒んだ理由の件数のログ・PreToolUse の待ちは agentHookReceiver.ts

export const AGENT_HOOK_MAX_BODY_BYTES = 16 * 1024 * 1024

/**
 * 拒んだ要求の件数のログの理由。too-large だけは checkAgentHookRequest が返さず、本文を読んだ後に受け口が数える
 * (照合が通っているので拒まずに ID なしの知らせとして渡すが、同じ件数のログに数える)
 */
export type AgentHookRejectReason =
  | 'method'
  | 'path'
  | 'host'
  | 'origin'
  | 'token'
  | 'content-type'
  | 'too-large'

export interface AgentHookOwner {
  ownerId: number
  sessionId: string
}

export type AgentHookRequestCheck =
  | { kind: 'accepted'; event: AgentHookEventName; owner: AgentHookOwner }
  | { kind: 'rejected'; status: number; reason: AgentHookRejectReason }

/**
 * 本文を読む前の要求の検査(メソッド → パス → Host → Origin → トークン → Content-Type の順。最初に外れた理由で拒む)。
 * ownerOf は Authorization の値から所有者を引く(トークンの表は受け口が持つ)
 */
export function checkAgentHookRequest(
  req: Pick<IncomingMessage, 'method' | 'url' | 'headers'>,
  port: number,
  ownerOf: (authorization: string | undefined) => AgentHookOwner | null
): AgentHookRequestCheck {
  const rejected = (status: number, reason: AgentHookRejectReason): AgentHookRequestCheck => ({
    kind: 'rejected',
    status,
    reason
  })
  if (req.method !== 'POST') return rejected(405, 'method')
  const event = agentHookEventOfPath(req.url ?? '')
  if (event === null) return rejected(404, 'path')
  if (req.headers.host !== `127.0.0.1:${port}`) return rejected(403, 'host')
  if (req.headers.origin !== undefined) return rejected(403, 'origin')
  const owner = ownerOf(req.headers.authorization)
  if (owner === null) return rejected(401, 'token')
  const contentType = req.headers['content-type']
  if (contentType === undefined || !contentType.toLowerCase().startsWith('application/json')) {
    return rejected(415, 'content-type')
  }
  return { kind: 'accepted', event, owner }
}

/** maxBytes までを持ち、超えたら先を持たずに最後まで読み捨てる。読み込みの失敗も unreadable として返す(L-002) */
export const readAgentHookBody = (
  req: IncomingMessage,
  maxBytes: number = AGENT_HOOK_MAX_BODY_BYTES
): Promise<AgentHookBody> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      size += chunk.length
      if (size > maxBytes) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () =>
      resolve(
        tooLarge
          ? { kind: 'too-large' }
          : { kind: 'text', text: Buffer.concat(chunks).toString('utf8') }
      )
    )
    req.on('error', () => resolve({ kind: 'unreadable' }))
    req.on('close', () => {
      if (!req.complete) resolve({ kind: 'unreadable' })
    })
  })
