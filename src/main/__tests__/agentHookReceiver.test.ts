import { request } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_HOOK_HEADERS_TIMEOUT_MS,
  AGENT_HOOK_REQUEST_TIMEOUT_MS,
  AGENT_PRE_TOOL_USE_WAIT_MS,
  createAgentHookReceiver
} from '../agentHookReceiver'
import type { AgentHookReceiver, AgentHookReceiverDeps } from '../agentHookReceiver'
import { AGENT_HOOK_MAX_BODY_BYTES } from '../agentHookReceiverRequest'
import type { AgentHookEvent } from '../agentHookEvents'
import { sendHookRequest } from './helpers/agentHookHttp'
import type { HookResponse } from './helpers/agentHookHttp'

// 受け口が作った server(待ち受けの後の error を起こすため)。実物の createServer に渡して作る
const createdServers = vi.hoisted((): Server[] => [])
vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  const createServer = (...args: unknown[]): Server => {
    const server = (actual.createServer as (...rest: unknown[]) => Server)(...args)
    createdServers.push(server)
    return server
  }
  return { ...actual, default: { ...actual, createServer }, createServer }
})

const TOKEN = 'ab'.repeat(32)
const OTHER_TOKEN = 'cd'.repeat(32)

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

let receiver: AgentHookReceiver | null = null
let port = 0
let calls: string[] = []
let delivered: Array<[number, string, AgentHookEvent]> = []
let deps: {
  deliver: ReturnType<typeof vi.fn<AgentHookReceiverDeps['deliver']>>
  onToolStart: ReturnType<typeof vi.fn<AgentHookReceiverDeps['onToolStart']>>
  onToolStartTimedOut: ReturnType<typeof vi.fn<AgentHookReceiverDeps['onToolStartTimedOut']>>
  log: ReturnType<typeof vi.fn<AgentHookReceiverDeps['log']>>
}

afterEach(() => {
  receiver?.close()
  receiver = null
  vi.useRealTimers()
})

async function start(overrides: Partial<AgentHookReceiverDeps> = {}): Promise<void> {
  createdServers.length = 0
  calls = []
  delivered = []
  deps = {
    deliver: vi.fn<AgentHookReceiverDeps['deliver']>((ownerId, sessionId, event) => {
      calls.push(`deliver:${event.kind}`)
      delivered.push([ownerId, sessionId, event])
    }),
    onToolStart: vi.fn<AgentHookReceiverDeps['onToolStart']>(async () => {
      calls.push('onToolStart')
    }),
    onToolStartTimedOut: vi.fn<AgentHookReceiverDeps['onToolStartTimedOut']>(() => {
      calls.push('timedOut')
    }),
    log: vi.fn<AgentHookReceiverDeps['log']>()
  }
  receiver = createAgentHookReceiver({ ...deps, preToolUseWaitMs: 200, ...overrides })
  const { baseUrl } = await receiver.ensureListening()
  expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  port = Number(new URL(baseUrl).port)
  receiver.addToken(TOKEN, { ownerId: 7, sessionId: 'sid-1', cli: { kind: 'claude' } })
}

const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const post = (
  segment: string,
  body: unknown,
  headers: Record<string, string> = HEADERS
): Promise<HookResponse> =>
  sendHookRequest(port, {
    path: `/prompt-ide/agent-hooks/v1/${segment}`,
    headers,
    body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  })

describe('createAgentHookReceiver(定数と待ち受け)', () => {
  it('上限の定数は設計書の値', () => {
    expect(AGENT_PRE_TOOL_USE_WAIT_MS).toBe(5_000)
    expect(AGENT_HOOK_HEADERS_TIMEOUT_MS).toBe(5_000)
    expect(AGENT_HOOK_REQUEST_TIMEOUT_MS).toBe(15_000)
  })

  it('127.0.0.1 のランダムなポートで待ち受け、2 回目の ensureListening は同じ URL を返す', async () => {
    await start()
    expect(port).toBeGreaterThan(0)
    await expect(receiver?.ensureListening()).resolves.toEqual({
      baseUrl: `http://127.0.0.1:${port}`
    })
  })
})

describe('createAgentHookReceiver(受け付ける要求)', () => {
  it('正しい要求に本文の無い 200 を返し、deliver を 1 回だけ呼ぶ', async () => {
    await start()
    const response = await post('user-prompt-submit', {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'hi'
    })
    expect(response.status).toBe(200)
    expect(response.body).toBe('')
    expect(response.headers['content-length']).toBe('0')
    expect(deps.deliver).toHaveBeenCalledOnce()
    expect(delivered).toEqual([
      [
        7,
        'sid-1',
        {
          kind: 'confirm-only',
          reason: 'prompt-submit',
          hookEventName: 'UserPromptSubmit',
          toolName: null
        }
      ]
    ])
    expect(deps.onToolStart).not.toHaveBeenCalled()
  })

  it('PostToolBatch のパス(post-tool-batch)も受け付け、batch-end を deliver する', async () => {
    await start()
    const response = await post('post-tool-batch', {
      hook_event_name: 'PostToolBatch',
      session_id: 'c1'
    })
    expect(response.status).toBe(200)
    expect(delivered).toEqual([
      [7, 'sid-1', { kind: 'batch-end', hookEventName: 'PostToolBatch', toolName: null }]
    ])
  })

  it('Content-Type は大文字小文字を区別せず、charset が付いても受け付ける', async () => {
    await start()
    const response = await post(
      'stop',
      { hook_event_name: 'Stop' },
      {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'Application/JSON; charset=utf-8'
      }
    )
    expect(response.status).toBe(200)
    expect(deps.deliver).toHaveBeenCalledOnce()
  })
})

describe('createAgentHookReceiver(拒む要求)', () => {
  const body = JSON.stringify({ hook_event_name: 'Stop' })
  it.each<[string, () => Promise<HookResponse>, number, string]>([
    [
      'GET',
      () =>
        sendHookRequest(port, {
          method: 'GET',
          path: '/prompt-ide/agent-hooks/v1/stop',
          headers: HEADERS
        }),
      405,
      'method'
    ],
    [
      '知らないパス',
      () =>
        sendHookRequest(port, {
          path: '/prompt-ide/agent-hooks/v1/session-start',
          headers: HEADERS,
          body
        }),
      404,
      'path'
    ],
    [
      'Host が localhost',
      () =>
        sendHookRequest(port, {
          path: '/prompt-ide/agent-hooks/v1/stop',
          headers: { ...HEADERS, Host: `localhost:${port}` },
          body
        }),
      403,
      'host'
    ],
    [
      'Origin がある',
      () =>
        sendHookRequest(port, {
          path: '/prompt-ide/agent-hooks/v1/stop',
          headers: { ...HEADERS, Origin: 'http://evil.example' },
          body
        }),
      403,
      'origin'
    ],
    [
      'Authorization が無い',
      () =>
        sendHookRequest(port, {
          path: '/prompt-ide/agent-hooks/v1/stop',
          headers: { 'Content-Type': 'application/json' },
          body
        }),
      401,
      'token'
    ],
    [
      'Bearer の形が違う',
      () =>
        sendHookRequest(port, {
          path: '/prompt-ide/agent-hooks/v1/stop',
          headers: { ...HEADERS, Authorization: `Bearer ${TOKEN.toUpperCase()}` },
          body
        }),
      401,
      'token'
    ],
    [
      '表に無いトークン',
      () =>
        sendHookRequest(port, {
          path: '/prompt-ide/agent-hooks/v1/stop',
          headers: { ...HEADERS, Authorization: `Bearer ${OTHER_TOKEN}` },
          body
        }),
      401,
      'token'
    ],
    [
      'Content-Type が text/plain',
      () =>
        sendHookRequest(port, {
          path: '/prompt-ide/agent-hooks/v1/stop',
          headers: { ...HEADERS, 'Content-Type': 'text/plain' },
          body
        }),
      415,
      'content-type'
    ]
  ])(
    '%s は状態を変えずに 4xx(本文なし)を返し、理由の件数をログに出す',
    async (_label, send, status, reason) => {
      await start()
      const response = await send()
      expect(response.status).toBe(status)
      expect(response.body).toBe('')
      expect(deps.deliver).not.toHaveBeenCalled()
      expect(deps.log).toHaveBeenCalledWith(`[agent-hooks] 拒んだ要求: ${reason} 1 件`)
      for (const [message] of deps.log.mock.calls) {
        expect(message).not.toContain(TOKEN)
        expect(message).not.toContain('Stop')
      }
    }
  )

  it('activate の前(addToken の前)と release の後(removeToken の後)のトークンは 401', async () => {
    await start()
    receiver?.addToken(OTHER_TOKEN, { ownerId: 8, sessionId: 'sid-2', cli: { kind: 'claude' } })
    receiver?.removeToken(OTHER_TOKEN)
    const other = { Authorization: `Bearer ${OTHER_TOKEN}`, 'Content-Type': 'application/json' }
    expect((await post('stop', { hook_event_name: 'Stop' }, other)).status).toBe(401)
    expect(deps.deliver).not.toHaveBeenCalled()
  })

  it('拒んだ件数は最初の 1 件と 100 件ごとにだけログに出す', async () => {
    await start()
    for (let i = 0; i < 100; i++) {
      await sendHookRequest(port, {
        method: 'GET',
        path: '/prompt-ide/agent-hooks/v1/stop',
        headers: HEADERS
      })
    }
    expect(deps.log.mock.calls.map(([message]) => message)).toEqual([
      '[agent-hooks] 拒んだ要求: method 1 件',
      '[agent-hooks] 拒んだ要求: method 100 件'
    ])
  })
})

describe('createAgentHookReceiver(本文)', () => {
  it('16 MiB を超える本文は先を持たずに読み捨て、ID なしの知らせとして deliver して 200 を返す(too-large を数える)', async () => {
    await start()
    const huge = Buffer.alloc(AGENT_HOOK_MAX_BODY_BYTES + 1, 0x20)
    const response = await post('pre-tool-use', huge)
    expect(response.status).toBe(200)
    expect(delivered).toEqual([
      [
        7,
        'sid-1',
        {
          kind: 'tool-start',
          hookEventName: 'PreToolUse',
          toolName: null,
          toolId: { kind: 'unreadable' },
          agentId: null
        }
      ]
    ])
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] 拒んだ要求: too-large 1 件')
  })

  const UNREADABLE_TOOL_END: AgentHookEvent = {
    kind: 'tool-end',
    hookEventName: 'PostToolUse',
    toolName: null,
    toolId: { kind: 'unreadable' },
    agentId: null
  }

  it('JSON でない本文は、パスのイベントだけで扱い、unreadable-body をログに出す', async () => {
    await start()
    await post('post-tool-use', '{')
    expect(delivered.map(([, , event]) => event)).toEqual([UNREADABLE_TOOL_END])
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] 読めない知らせ: unreadable-body 1 件')
  })

  it('イベント名がパスと違う本文は、パスのイベントだけで扱い、event-name-mismatch をログに出す', async () => {
    await start()
    await post('post-tool-use', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_use_id: 'toolu_1'
    })
    expect(delivered.map(([, , event]) => event)).toEqual([UNREADABLE_TOOL_END])
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] 読めない知らせ: event-name-mismatch 1 件')
  })

  it('本文の途中で接続が切れた PreToolUse も、ID なしの知らせとして deliver する(L-002)', async () => {
    await start()
    const req = request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/prompt-ide/agent-hooks/v1/pre-tool-use',
      headers: { ...HEADERS, 'Content-Length': '100' }
    })
    req.on('error', () => undefined)
    req.write('{"hook_event_name":')
    await vi.waitFor(() => expect(req.socket).toBeTruthy())
    // 本文を送り切る前に切る
    await new Promise((resolve) => setTimeout(resolve, 50))
    req.destroy()
    await vi.waitFor(() =>
      expect(delivered).toEqual([
        [
          7,
          'sid-1',
          {
            kind: 'tool-start',
            hookEventName: 'PreToolUse',
            toolName: null,
            toolId: { kind: 'unreadable' },
            agentId: null
          }
        ]
      ])
    )
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] 読めない知らせ: unreadable-body 1 件')
  })
})

describe('createAgentHookReceiver(PreToolUse の順序と上限)', () => {
  const PRE = { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'toolu_1' }

  it('deliver(tool-start)を呼び終えてから onToolStart を呼び、その解決まで応答しない', async () => {
    const gate = deferred<void>()
    await start({
      onToolStart: vi.fn(async () => {
        calls.push('onToolStart')
        await gate.promise
      })
    })
    let answered = false
    const response = post('pre-tool-use', PRE).then((r) => {
      answered = true
      return r
    })
    await vi.waitFor(() => expect(calls).toEqual(['deliver:tool-start', 'onToolStart']))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(answered).toBe(false)
    gate.resolve()
    expect((await response).status).toBe(200)
    expect(calls).toEqual(['deliver:tool-start', 'onToolStart'])
  })

  it('onToolStart が解決しなければ上限で 200 を返し、signal を中止して onToolStartTimedOut を 1 回呼ぶ', async () => {
    // コールバックの中の代入は絞り込みに反映されないため、as で型を広げて宣言する
    let captured = null as AbortSignal | null
    await start({
      onToolStart: vi.fn((_ownerId: number, signal: AbortSignal) => {
        calls.push('onToolStart')
        captured = signal
        return new Promise<void>(() => undefined)
      })
    })
    const response = await post('pre-tool-use', PRE)
    expect(response.status).toBe(200)
    expect(captured?.aborted).toBe(true)
    expect(deps.onToolStartTimedOut).toHaveBeenCalledExactlyOnceWith(7)
    expect(calls).toEqual(['deliver:tool-start', 'onToolStart', 'timedOut'])
  })

  it('onToolStart が reject したらログを出し、打ち切りと同じく signal を中止して onToolStartTimedOut を 1 回呼んで 200 を返す(L-002)', async () => {
    let captured = null as AbortSignal | null
    await start({
      onToolStart: vi.fn(async (_ownerId: number, signal: AbortSignal) => {
        captured = signal
        throw new Error('boom')
      })
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    expect((await post('pre-tool-use', PRE)).status).toBe(200)
    expect(captured?.aborted).toBe(true)
    expect(deps.onToolStartTimedOut).toHaveBeenCalledExactlyOnceWith(7)
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] ツールの開始の待ちに失敗しました: boom')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('onToolStart が同期で投げても 200 を返し、onToolStartTimedOut を 1 回呼び、上限のタイマーを残さない(L-055)', async () => {
    let captured = null as AbortSignal | null
    await start({
      onToolStart: vi.fn((_ownerId: number, signal: AbortSignal): Promise<void> => {
        captured = signal
        throw new Error('sync boom')
      })
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    expect((await post('pre-tool-use', PRE)).status).toBe(200)
    expect(captured?.aborted).toBe(true)
    expect(deps.onToolStartTimedOut).toHaveBeenCalledExactlyOnceWith(7)
    expect(deps.log).toHaveBeenCalledWith(
      '[agent-hooks] ツールの開始の待ちに失敗しました: sync boom'
    )
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(AGENT_PRE_TOOL_USE_WAIT_MS)
    expect(deps.onToolStartTimedOut).toHaveBeenCalledOnce()
  })

  it('PreToolUse 以外は onToolStart を待たない', async () => {
    await start()
    await post('post-tool-use', {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_use_id: 'toolu_1'
    })
    expect(deps.onToolStart).not.toHaveBeenCalled()
  })
})

describe('createAgentHookReceiver(close)', () => {
  it('close で待っている接続も切り、その後の要求は接続できない', async () => {
    await start({
      onToolStart: vi.fn(() => new Promise<void>(() => undefined)),
      preToolUseWaitMs: 10_000
    })
    const pending = post('pre-tool-use', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_use_id: 't'
    })
    await vi.waitFor(() => expect(deps.deliver).toHaveBeenCalledOnce())
    receiver?.close()
    await expect(pending).rejects.toThrow()
    await expect(post('stop', { hook_event_name: 'Stop' })).rejects.toThrow()
    await expect(receiver?.ensureListening()).rejects.toThrow('受け口は閉じています')
  })

  it('close で待っている PreToolUse の上限のタイマーを外して signal を中止し、上限が過ぎても onToolStartTimedOut を呼ばない(L-435)', async () => {
    let captured = null as AbortSignal | null
    await start({
      onToolStart: vi.fn((_ownerId: number, signal: AbortSignal) => {
        captured = signal
        return new Promise<void>(() => undefined)
      }),
      // vi.waitFor は偽のタイマーを interval ずつ進めるため、上限に届かない長さにする
      preToolUseWaitMs: 60_000
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = post('pre-tool-use', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_use_id: 't'
    })
    await vi.waitFor(() => expect(captured).not.toBeNull())
    receiver?.close()
    expect(captured?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(120_000)
    await expect(pending).rejects.toThrow()
    expect(deps.onToolStartTimedOut).not.toHaveBeenCalled()
  })

  it('本文を読んでいる間に close したら、その要求を deliver しない(L-435)', async () => {
    await start()
    const server = createdServers[0]
    const arrived = new Promise<IncomingMessage>((resolve) => {
      server.once('request', (req: IncomingMessage) => resolve(req))
    })
    const req = request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/prompt-ide/agent-hooks/v1/pre-tool-use',
      headers: { ...HEADERS, 'Content-Length': '100' }
    })
    req.on('error', () => undefined)
    req.write('{"hook_event_name":')
    // 受け口の request のハンドラは先に登録されているため、この時点で本文の読み込みを待っている
    const serverReq = await arrived
    const closedReq = new Promise((resolve) => serverReq.once('close', resolve))
    receiver?.close()
    await closedReq
    await new Promise((resolve) => setImmediate(resolve))
    expect(deps.deliver).not.toHaveBeenCalled()
  })
})

describe('createAgentHookReceiver(待ち受けの後の error。頑健性の 1)', () => {
  it('待ち受けの後の server の error でログを出して閉じ、次の ensureListening は新しい server で始め直す(L-436)', async () => {
    await start()
    const first = createdServers[0]
    first.emit('error', new Error('EMFILE'))
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] 受け口が止まりました: EMFILE')
    await vi.waitFor(() => expect(first.listening).toBe(false))
    const { baseUrl } = (await receiver?.ensureListening()) ?? { baseUrl: '' }
    expect(createdServers).toHaveLength(2)
    expect(createdServers[1].listening).toBe(true)
    // トークンの表は残るため、新しい受け口でそのまま受け付ける
    port = Number(new URL(baseUrl).port)
    expect((await post('stop', { hook_event_name: 'Stop' })).status).toBe(200)
  })

  it('listen が失敗したら ensureListening は reject し、止まったログは出さず、次の ensureListening は新しい server で待ち受ける', async () => {
    createdServers.length = 0
    const log = vi.fn<AgentHookReceiverDeps['log']>()
    receiver = createAgentHookReceiver({
      deliver: vi.fn(),
      onToolStart: vi.fn(async () => undefined),
      onToolStartTimedOut: vi.fn(),
      log,
      preToolUseWaitMs: 200
    })
    const failed = receiver.ensureListening()
    // listen の完了より前(同期のうち)に error を起こして、listen の失敗として扱わせる
    createdServers[0].emit('error', new Error('EADDRINUSE'))
    await expect(failed).rejects.toThrow('EADDRINUSE')
    expect(log).not.toHaveBeenCalled()
    const { baseUrl } = await receiver.ensureListening()
    expect(createdServers).toHaveLength(2)
    expect(createdServers[1].listening).toBe(true)
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(log).not.toHaveBeenCalled()
  })
})

describe('createAgentHookReceiver(copilot の経路。段階 3b)', () => {
  const COPILOT_TOKEN = 'ef'.repeat(32)
  const MAIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const COPILOT_HEADERS = {
    Authorization: `Bearer ${COPILOT_TOKEN}`,
    'Content-Type': 'application/json'
  }

  async function startCopilot(overrides: Partial<AgentHookReceiverDeps> = {}): Promise<void> {
    await start(overrides)
    receiver?.addToken(COPILOT_TOKEN, {
      ownerId: 9,
      sessionId: 'sid-c',
      cli: { kind: 'copilot', main: { kind: 'known', id: MAIN } }
    })
  }

  const postCopilot = (
    segment: string,
    body: unknown,
    headers: Record<string, string> = COPILOT_HEADERS
  ): Promise<HookResponse> =>
    sendHookRequest(port, {
      path: `/prompt-ide/agent-hooks/copilot/v1/${segment}`,
      headers,
      body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
    })

  it('主の会話の UserPromptSubmit は 200 の空の本文で、prompt-submit を deliver する', async () => {
    await startCopilot()
    const response = await postCopilot('user-prompt-submit', {
      hook_event_name: 'UserPromptSubmit',
      session_id: MAIN,
      prompt: 'hi'
    })
    expect(response.status).toBe(200)
    expect(response.body).toBe('')
    expect(delivered).toEqual([
      [
        9,
        'sid-c',
        {
          kind: 'confirm-only',
          reason: 'prompt-submit',
          hookEventName: 'UserPromptSubmit',
          toolName: null
        }
      ]
    ])
  })

  it('PreToolUse は ID を持たない区間(主のグループ)を deliver してから onToolStart を待ち、200 を返す', async () => {
    await startCopilot()
    const response = await postCopilot('pre-tool-use', {
      hook_event_name: 'PreToolUse',
      session_id: MAIN,
      tool_name: 'Edit'
    })
    expect(response.status).toBe(200)
    expect(delivered.map(([, , event]) => event)).toEqual([
      {
        kind: 'tool-start',
        hookEventName: 'PreToolUse',
        toolName: 'Edit',
        toolId: { kind: 'none' },
        agentId: null
      }
    ])
    expect(calls).toEqual(['deliver:tool-start', 'onToolStart'])
  })

  it('PreToolUse の待ちが上限で打ち切られても 200 を返す(onToolStartTimedOut を 1 回呼ぶ)', async () => {
    await startCopilot({ onToolStart: vi.fn(() => new Promise<void>(() => undefined)) })
    const response = await postCopilot('pre-tool-use', {
      hook_event_name: 'PreToolUse',
      session_id: MAIN,
      tool_name: 'Edit'
    })
    expect(response.status).toBe(200)
    expect(deps.onToolStartTimedOut).toHaveBeenCalledExactlyOnceWith(9)
  })

  it('表の持ち主をそのまま解釈に渡し、主の会話の ID の状態が要求をまたいで残る: /clear の SessionEnd → 新しい ID の prompt → その ID の PreToolUse は主のグループ', async () => {
    await startCopilot()
    await postCopilot('session-end', { hook_event_name: 'SessionEnd', session_id: MAIN })
    await postCopilot('user-prompt-submit', {
      hook_event_name: 'UserPromptSubmit',
      session_id: NEW
    })
    await postCopilot('pre-tool-use', {
      hook_event_name: 'PreToolUse',
      session_id: NEW,
      tool_name: 'Edit'
    })
    expect(delivered.map(([, , event]) => event)).toEqual([
      { kind: 'session-end', hookEventName: 'SessionEnd', toolName: null },
      {
        kind: 'confirm-only',
        reason: 'prompt-submit',
        hookEventName: 'UserPromptSubmit',
        toolName: null
      },
      {
        kind: 'tool-start',
        hookEventName: 'PreToolUse',
        toolName: 'Edit',
        toolId: { kind: 'none' },
        agentId: null
      }
    ])
  })

  it('16 MiB を超える本文は主のグループの tool-start として deliver し、拒んだ要求（copilot）の too-large を数える', async () => {
    await startCopilot()
    const response = await postCopilot(
      'pre-tool-use',
      Buffer.alloc(AGENT_HOOK_MAX_BODY_BYTES + 1, 0x20)
    )
    expect(response.status).toBe(200)
    expect(delivered.map(([, , event]) => event)).toEqual([
      {
        kind: 'tool-start',
        hookEventName: 'PreToolUse',
        toolName: null,
        toolId: { kind: 'none' },
        agentId: null
      }
    ])
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] 拒んだ要求（copilot）: too-large 1 件')
  })

  const body = JSON.stringify({ hook_event_name: 'Stop', session_id: MAIN })
  it.each<[string, () => Promise<HookResponse>, string]>([
    [
      'GET',
      () =>
        sendHookRequest(port, {
          method: 'GET',
          path: '/prompt-ide/agent-hooks/copilot/v1/stop',
          headers: COPILOT_HEADERS
        }),
      'method'
    ],
    ['知らないパス', () => postCopilot('session-start', body), 'path'],
    [
      'Host が localhost',
      () => postCopilot('stop', body, { ...COPILOT_HEADERS, Host: `localhost:${port}` }),
      'host'
    ],
    [
      'Origin がある',
      () => postCopilot('stop', body, { ...COPILOT_HEADERS, Origin: 'http://evil.example' }),
      'origin'
    ],
    [
      'Authorization が無い',
      () => postCopilot('stop', body, { 'Content-Type': 'application/json' }),
      'token'
    ],
    [
      '表に無いトークン',
      () =>
        postCopilot('stop', body, { ...COPILOT_HEADERS, Authorization: `Bearer ${OTHER_TOKEN}` }),
      'token'
    ],
    [
      'claude の持ち主のトークン(経路と持ち主の種類の食い違い)',
      () => postCopilot('stop', body, HEADERS),
      'token'
    ],
    [
      'Content-Type が text/plain',
      () => postCopilot('stop', body, { ...COPILOT_HEADERS, 'Content-Type': 'text/plain' }),
      'content-type'
    ]
  ])(
    '%s は 200 の空の本文を返し、deliver せず、拒んだ要求（copilot）の件数をログに出す(トークン・本文は出さない)',
    async (_label, send, reason) => {
      await startCopilot()
      const response = await send()
      expect(response.status).toBe(200)
      expect(response.body).toBe('')
      expect(deps.deliver).not.toHaveBeenCalled()
      expect(deps.log).toHaveBeenCalledWith(`[agent-hooks] 拒んだ要求（copilot）: ${reason} 1 件`)
      for (const [message] of deps.log.mock.calls) {
        expect(message).not.toContain(COPILOT_TOKEN)
        expect(message).not.toContain(MAIN)
      }
    }
  )

  it('copilot の持ち主のトークンで claude のパスに送ると 401(claude の経路の応答は変えない)', async () => {
    await startCopilot()
    const response = await post('stop', { hook_event_name: 'Stop' }, COPILOT_HEADERS)
    expect(response.status).toBe(401)
    expect(deps.deliver).not.toHaveBeenCalled()
  })

  it('処理の例外は、copilot の経路では 200、claude の経路では今どおり 500', async () => {
    await startCopilot({
      deliver: vi.fn(() => {
        throw new Error('boom')
      })
    })
    expect((await postCopilot('stop', body)).status).toBe(200)
    expect((await post('stop', { hook_event_name: 'Stop' })).status).toBe(500)
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] 要求の処理に失敗しました: boom')
  })

  it('閉じた後に残った接続から届いた要求は、copilot の経路では 200、claude の経路では今どおり 503 で返し、deliver しない', async () => {
    await startCopilot()
    const server = createdServers[0]
    receiver?.close()
    receiver = null
    const respondTo = async (url: string): Promise<ReturnType<typeof vi.fn>> => {
      const res = { destroyed: false, writableEnded: false, writeHead: vi.fn(), end: vi.fn() }
      const req = { url, method: 'POST', headers: {}, resume: vi.fn() }
      server.emit('request', req, res)
      await vi.waitFor(() => expect(res.end).toHaveBeenCalled())
      return res.writeHead
    }
    expect(await respondTo('/prompt-ide/agent-hooks/copilot/v1/stop')).toHaveBeenCalledWith(200, {
      'Content-Length': '0'
    })
    expect(await respondTo('/prompt-ide/agent-hooks/v1/stop')).toHaveBeenCalledWith(503, {
      'Content-Length': '0'
    })
    expect(deps.deliver).not.toHaveBeenCalled()
  })
})
