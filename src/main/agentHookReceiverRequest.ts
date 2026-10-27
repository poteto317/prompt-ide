import type { IncomingMessage } from 'node:http'
import { agentHookRouteOfPath, isCopilotHookPath } from './agentHookProtocol'
import type { AgentHookRoute } from './agentHookProtocol'
import type { AgentHookBody } from './agentHookEvents'
import type { CopilotMainSession } from './agentCopilotHookEvents'

// claude・copilot の http の hook の要求の受け付けの規則(設計書「受け口」、段階 3b の設計書「受け口」)。本文を読む前の検査(メソッド・パス・Host・Origin・トークン・
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

/**
 * トークンの持ち主の CLI の種類。copilot は主の会話の ID の状態を持つ(振り分けのたびに agentHookInterpretation.ts の
 * interpretAgentHookRequest が書き戻す。受け口はそれを呼ぶだけ)
 */
export type AgentHookOwnerCli = { kind: 'claude' } | { kind: 'copilot'; main: CopilotMainSession }

export interface AgentHookOwner {
  ownerId: number
  sessionId: string
  cli: AgentHookOwnerCli
}

export type AgentHookRequestCheck =
  | { kind: 'accepted'; route: AgentHookRoute; owner: AgentHookOwner }
  | { kind: 'rejected'; status: number; reason: AgentHookRejectReason }

/**
 * 応答の状態コード。copilot の経路(isCopilotHookPath が真のパス)では、拒む・閉じた後・処理の例外でも常に 200 にする(copilot は
 * preToolUse の 4xx・5xx・接続の失敗をツールの拒否にするため。200 の空の本文は何の情報も返さない)。claude の経路は渡した値のまま
 */
export function agentHookResponseStatus(path: string, status: number): number {
  return isCopilotHookPath(path) ? 200 : status
}

/**
 * 本文を読む前の要求の検査(メソッド → パス → Host → Origin → トークン → Content-Type の順。最初に外れた理由で拒む)。
 * ownerOf は Authorization の値から所有者を引く(トークンの表は受け口が持つ)。経路の種類と持ち主の種類が違えばトークンの照合の失敗。
 * 拒むときの状態コードは agentHookResponseStatus を通す(copilot の経路は 200)
 */
export function checkAgentHookRequest(
  req: Pick<IncomingMessage, 'method' | 'url' | 'headers'>,
  port: number,
  ownerOf: (authorization: string | undefined) => AgentHookOwner | null
): AgentHookRequestCheck {
  const path = req.url ?? ''
  const rejected = (status: number, reason: AgentHookRejectReason): AgentHookRequestCheck => ({
    kind: 'rejected',
    status: agentHookResponseStatus(path, status),
    reason
  })
  if (req.method !== 'POST') return rejected(405, 'method')
  const route = agentHookRouteOfPath(path)
  if (route === null) return rejected(404, 'path')
  if (req.headers.host !== `127.0.0.1:${port}`) return rejected(403, 'host')
  if (req.headers.origin !== undefined) return rejected(403, 'origin')
  const owner = ownerOf(req.headers.authorization)
  if (owner === null || owner.cli.kind !== route.cliKind) return rejected(401, 'token')
  const contentType = req.headers['content-type']
  if (contentType === undefined || !contentType.toLowerCase().startsWith('application/json')) {
    return rejected(415, 'content-type')
  }
  return { kind: 'accepted', route, owner }
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
