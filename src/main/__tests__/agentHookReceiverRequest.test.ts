import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_HOOK_MAX_BODY_BYTES,
  agentHookResponseStatus,
  checkAgentHookRequest,
  readAgentHookBody
} from '../agentHookReceiverRequest'
import type { AgentHookOwner } from '../agentHookReceiverRequest'
import { agentHookPathOf, copilotHookPathOf } from '../agentHookProtocol'

const PORT = 41234
const OWNER: AgentHookOwner = { ownerId: 1, sessionId: 's1', cli: { kind: 'claude' } }

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
      route: { cliKind: 'claude', event: 'PreToolUse' },
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

describe('checkAgentHookRequest(copilot の経路。段階 3b)', () => {
  const COPILOT_OWNER: AgentHookOwner = {
    ownerId: 2,
    sessionId: 's2',
    cli: { kind: 'copilot', main: { kind: 'known', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }
  }
  const owners = (authorization: string | undefined): AgentHookOwner | null =>
    authorization === 'Bearer ok'
      ? OWNER
      : authorization === 'Bearer copilot'
        ? COPILOT_OWNER
        : null
  const copilotRequest = (overrides: Partial<RequestLike> = {}): RequestLike =>
    validRequest({
      url: copilotHookPathOf('PreToolUse'),
      ...overrides,
      headers: { authorization: 'Bearer copilot', ...overrides.headers }
    })

  it('copilot の持ち主のトークンで copilot のパスなら、copilot の経路と持ち主を返す', () => {
    expect(checkAgentHookRequest(copilotRequest(), PORT, owners)).toEqual({
      kind: 'accepted',
      route: { cliKind: 'copilot', event: 'PreToolUse' },
      owner: COPILOT_OWNER
    })
  })

  it.each([
    ['メソッド', copilotRequest({ method: 'GET' }), 'method'],
    ['パス', copilotRequest({ url: '/prompt-ide/agent-hooks/copilot/v1/session-start' }), 'path'],
    ['Host', copilotRequest({ headers: { host: 'localhost:41234' } }), 'host'],
    ['Origin', copilotRequest({ headers: { origin: 'http://example.com' } }), 'origin'],
    ['トークン', copilotRequest({ headers: { authorization: 'Bearer ng' } }), 'token'],
    ['Content-Type', copilotRequest({ headers: { 'content-type': 'text/plain' } }), 'content-type']
  ])('copilot の経路で %s が違えば、状態コード 200 で拒む(理由は同じ)', (_name, req, reason) => {
    expect(checkAgentHookRequest(req, PORT, owners)).toEqual({
      kind: 'rejected',
      status: 200,
      reason
    })
  })

  it('経路の種類と持ち主の種類が違えば、トークンの照合の失敗(claude の経路は 401、copilot の経路は 200)', () => {
    expect(
      checkAgentHookRequest(
        copilotRequest({ headers: { authorization: 'Bearer ok' } }),
        PORT,
        owners
      )
    ).toEqual({ kind: 'rejected', status: 200, reason: 'token' })
    expect(
      checkAgentHookRequest(
        validRequest({ headers: { authorization: 'Bearer copilot' } }),
        PORT,
        owners
      )
    ).toEqual({ kind: 'rejected', status: 401, reason: 'token' })
  })
})

/** 本文の読み込みに使う欄(on と complete)だけの偽物 */
function fakeRequest(): EventEmitter & { complete: boolean } {
  return Object.assign(new EventEmitter(), { complete: false })
}

describe('agentHookResponseStatus(応答の状態コード)', () => {
  it('copilot の経路(7 つに一致しないパス・クエリ付きを含む)は常に 200', () => {
    for (const status of [401, 404, 500, 503]) {
      expect(agentHookResponseStatus(copilotHookPathOf('PreToolUse'), status)).toBe(200)
      expect(agentHookResponseStatus('/prompt-ide/agent-hooks/copilot/v1/unknown', status)).toBe(
        200
      )
      expect(agentHookResponseStatus(`${copilotHookPathOf('Stop')}?x=1`, status)).toBe(200)
    }
  })

  it('claude の経路・どれでもないパスは渡した値のまま', () => {
    for (const status of [200, 401, 404, 500, 503]) {
      expect(agentHookResponseStatus(agentHookPathOf('PreToolUse'), status)).toBe(status)
      expect(agentHookResponseStatus('/other', status)).toBe(status)
      expect(agentHookResponseStatus('', status)).toBe(status)
    }
  })
})

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
