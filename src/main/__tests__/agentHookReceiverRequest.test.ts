import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_HOOK_MAX_BODY_BYTES,
  checkAgentHookRequest,
  readAgentHookBody
} from '../agentHookReceiverRequest'
import type { AgentHookOwner } from '../agentHookReceiverRequest'
import { agentHookPathOf } from '../agentHookProtocol'

const PORT = 41234
const OWNER: AgentHookOwner = { ownerId: 1, sessionId: 's1' }

type RequestLike = Pick<IncomingMessage, 'method' | 'url' | 'headers'>

const validRequest = (overrides: Partial<RequestLike> = {}): RequestLike => ({
  method: 'POST',
  url: agentHookPathOf('PreToolUse'),
  ...overrides,
  headers: {
    host: `127.0.0.1:${PORT}`,
    authorization: 'Bearer ok',
    'content-type': 'application/json; charset=utf-8',
    ...overrides.headers
  }
})

const ownerOf = (authorization: string | undefined): AgentHookOwner | null =>
  authorization === 'Bearer ok' ? OWNER : null

describe('checkAgentHookRequest(本文を読む前の検査)', () => {
  it('すべて通ればパスのイベントと所有者を返す', () => {
    expect(checkAgentHookRequest(validRequest(), PORT, ownerOf)).toEqual({
      kind: 'accepted',
      event: 'PreToolUse',
      owner: OWNER
    })
  })

  it.each([
    ['メソッド', validRequest({ method: 'GET' }), 405, 'method'],
    ['パス', validRequest({ url: '/other' }), 404, 'path'],
    ['Host', validRequest({ headers: { host: 'localhost:41234' } }), 403, 'host'],
    ['Origin', validRequest({ headers: { origin: 'http://example.com' } }), 403, 'origin'],
    ['トークン', validRequest({ headers: { authorization: 'Bearer ng' } }), 401, 'token'],
    [
      'Content-Type',
      validRequest({ headers: { 'content-type': 'text/plain' } }),
      415,
      'content-type'
    ],
    [
      'Content-Type なし',
      validRequest({ headers: { 'content-type': undefined } }),
      415,
      'content-type'
    ]
  ])('%s が違えば拒む', (_name, req, status, reason) => {
    expect(checkAgentHookRequest(req, PORT, ownerOf)).toEqual({
      kind: 'rejected',
      status,
      reason
    })
  })

  it('Content-Type は大文字小文字を区別しない', () => {
    const req = validRequest({ headers: { 'content-type': 'Application/JSON' } })
    expect(checkAgentHookRequest(req, PORT, ownerOf).kind).toBe('accepted')
  })

  it('最初に外れた理由で拒み、それより後の検査(所有者の引き当て)をしない', () => {
    const spy = vi.fn(ownerOf)
    const req = validRequest({ method: 'PUT', headers: { origin: 'http://example.com' } })
    expect(checkAgentHookRequest(req, PORT, spy)).toMatchObject({ reason: 'method' })
    expect(spy).not.toHaveBeenCalled()
  })
})

/** 本文の読み込みに使う欄(on と complete)だけの偽物 */
function fakeRequest(): EventEmitter & { complete: boolean } {
  return Object.assign(new EventEmitter(), { complete: false })
}

describe('readAgentHookBody', () => {
  it('既定の上限は設計書の値(16 MiB)', () => {
    expect(AGENT_HOOK_MAX_BODY_BYTES).toBe(16 * 1024 * 1024)
  })

  it('上限までは utf8 の文字列として返す', async () => {
    const req = fakeRequest()
    const body = readAgentHookBody(req as unknown as IncomingMessage, 10)
    req.emit('data', Buffer.from('あい'))
    req.complete = true
    req.emit('end')
    await expect(body).resolves.toEqual({ kind: 'text', text: 'あい' })
  })

  it('上限を超えたら too-large(最後まで読み捨てる)', async () => {
    const req = fakeRequest()
    const body = readAgentHookBody(req as unknown as IncomingMessage, 4)
    req.emit('data', Buffer.from('abc'))
    req.emit('data', Buffer.from('de'))
    req.emit('data', Buffer.from('f'))
    req.complete = true
    req.emit('end')
    await expect(body).resolves.toEqual({ kind: 'too-large' })
  })

  it('読み込みの失敗は unreadable', async () => {
    const req = fakeRequest()
    const body = readAgentHookBody(req as unknown as IncomingMessage, 10)
    req.emit('error', new Error('boom'))
    await expect(body).resolves.toEqual({ kind: 'unreadable' })
  })

  it('最後まで届かずに閉じたら unreadable', async () => {
    const req = fakeRequest()
    const body = readAgentHookBody(req as unknown as IncomingMessage, 10)
    req.emit('data', Buffer.from('ab'))
    req.emit('close')
    await expect(body).resolves.toEqual({ kind: 'unreadable' })
  })
})
