import { describe, it, expect, vi, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import {
  AGENT_SESSION_RECORDS_PER_FOLDER,
  AGENT_SESSION_RECORD_FOLDERS_MAX,
  createAgentSessionRecordStore,
  prependRecord,
  toAgentFolderKey
} from '../agentSessionRecordStore'
import type { AgentSessionRecordIo } from '../agentSessionRecordStore'
import { makeFakeRecordIo, noRecordFile, recordFileOf } from './helpers/fakeAgentSessionRecordIo'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-9222-222222222222'
const C = '33333333-3333-4333-a333-333333333333'

/** n 番目の UUID(テスト用。小文字の v4) */
const idOf = (n: number): string => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
} {
  let resolve: (value: T) => void = () => undefined
  let reject: (err: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let consoleErrorSpy: MockInstance<typeof console.error> | null = null

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
})

describe('toAgentFolderKey', () => {
  it('Windows では小文字にそろえ、ほかはそのまま', () => {
    expect(toAgentFolderKey('C:\\Work\\Proj', 'win32')).toBe('c:\\work\\proj')
    expect(toAgentFolderKey('/Users/Me/Proj', 'darwin')).toBe('/Users/Me/Proj')
    expect(toAgentFolderKey('/home/Me/Proj', 'linux')).toBe('/home/Me/Proj')
  })
})

describe('createAgentSessionRecordStore: 読み込み', () => {
  it('作った時点で読み込みを始め、whenLoaded の後に has・last が同期で記録を引く', async () => {
    const io = makeFakeRecordIo(recordFileOf([{ key: '/w', ids: [B, A] }]))
    const store = createAgentSessionRecordStore(io)
    expect(io.read).toHaveBeenCalledOnce()
    await store.whenLoaded()
    expect(store.last('/w')).toBe(B)
    expect(store.has('/w', A)).toBe(true)
    expect(store.has('/w', C)).toBe(false)
    expect(store.has('/other', A)).toBe(false)
    expect(store.last('/other')).toBeNull()
  })

  it('読み込みの完了の前は記録が見えず、whenLoaded は読み込みの完了まで待つ', async () => {
    const read = deferred<string>()
    const io = makeFakeRecordIo(read.promise)
    const store = createAgentSessionRecordStore(io)
    let loaded = false
    void store.whenLoaded().then(() => {
      loaded = true
    })
    await Promise.resolve()
    expect(loaded).toBe(false)
    expect(store.has('/w', A)).toBe(false)
    read.resolve(recordFileOf([{ key: '/w', ids: [A] }]))
    await store.whenLoaded()
    expect(loaded).toBe(true)
    expect(store.has('/w', A)).toBe(true)
  })

  it('ファイルが無ければ空(ログは出さない)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const store = createAgentSessionRecordStore(makeFakeRecordIo(noRecordFile()))
    await store.whenLoaded()
    expect(store.last('/w')).toBeNull()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['読み込みの失敗(ENOENT 以外)', new Error('EACCES')],
    ['JSON として壊れている', '{'],
    ['オブジェクトでない', '[]'],
    ['folders が配列でない', JSON.stringify({ version: 1, folders: {} })]
  ])('%s は空として扱い、ログに残す(whenLoaded は拒否しない)', async (_label, content) => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const store = createAgentSessionRecordStore(makeFakeRecordIo(content))
    await expect(store.whenLoaded()).resolves.toBeUndefined()
    expect(store.last('/w')).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('読み込みが ENOENT 以外で失敗して読み直しても読めないままなら、ファイルへ書かずメモリだけで記録する。書き込みを飛ばしたログは 1 回だけ(L-002)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const eacces = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const io = makeFakeRecordIo(eacces)
    const store = createAgentSessionRecordStore(io)
    await store.whenLoaded()
    store.record('/w', A)
    store.record('/w', B)
    store.record('/w', C)
    expect(store.last('/w')).toBe(C)
    expect(store.has('/w', A)).toBe(true)
    // 書き込みのたびに読み直す(作った時点の 1 回 + record の 3 回)
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(4))
    await vi.waitFor(() =>
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[agentSessionRecordStore] 起動の記録を読み込めなかったため、ファイルへは書き込みません'
      )
    )
    expect(io.write).not.toHaveBeenCalled()
    const skipLogs = consoleErrorSpy.mock.calls.filter(
      (args) =>
        args[0] ===
        '[agentSessionRecordStore] 起動の記録を読み込めなかったため、ファイルへは書き込みません'
    )
    expect(skipLogs).toHaveLength(1)
  })

  it('読み込みが ENOENT 以外で失敗しても、次の record の前に読み直せたら、ファイルの記録とメモリを合わせて書き込みを再開する', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ebusy = Object.assign(new Error('busy'), { code: 'EBUSY' })
    const io = makeFakeRecordIo(
      recordFileOf([
        { key: '/w', ids: [A] },
        { key: '/other', ids: [C] }
      ])
    )
    vi.mocked(io.read).mockRejectedValueOnce(ebusy)
    const store = createAgentSessionRecordStore(io)
    await store.whenLoaded()
    expect(store.last('/other')).toBeNull()
    store.record('/w', B)
    await vi.waitFor(() => expect(io.writes).toHaveLength(1))
    expect(JSON.parse(io.writes[0]).folders).toEqual([
      { key: '/w', ids: [B, A] },
      { key: '/other', ids: [C] }
    ])
    // 読み直した記録はメモリにも入る
    expect(store.last('/other')).toBe(C)
    expect(store.has('/w', A)).toBe(true)
    // 再開した後は読み直さずに書く
    store.record('/w', C)
    await vi.waitFor(() => expect(io.writes).toHaveLength(2))
    expect(io.read).toHaveBeenCalledTimes(2)
  })

  it('読み込みが ENOENT 以外で失敗しても、読み直しで ENOENT(ファイルが無い)なら書き込みを再開する', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const eperm = Object.assign(new Error('not permitted'), { code: 'EPERM' })
    const io = makeFakeRecordIo(noRecordFile())
    vi.mocked(io.read).mockRejectedValueOnce(eperm)
    const store = createAgentSessionRecordStore(io)
    await store.whenLoaded()
    store.record('/w', A)
    await vi.waitFor(() => expect(io.writes).toHaveLength(1))
    expect(JSON.parse(io.writes[0]).folders).toEqual([{ key: '/w', ids: [A] }])
  })

  it('読み直しで読めたが中身が壊れていたら、メモリの記録でファイルを上書きする', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const eacces = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const io = makeFakeRecordIo('{')
    vi.mocked(io.read).mockRejectedValueOnce(eacces)
    const store = createAgentSessionRecordStore(io)
    await store.whenLoaded()
    store.record('/w', A)
    await vi.waitFor(() => expect(io.writes).toHaveLength(1))
    expect(JSON.parse(io.writes[0]).folders).toEqual([{ key: '/w', ids: [A] }])
  })

  it('読み直しを待っている間に record が来ても、両方の ID がメモリとファイルに残る', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ebusy = Object.assign(new Error('busy'), { code: 'EBUSY' })
    const reread = deferred<string>()
    const io = makeFakeRecordIo()
    vi.mocked(io.read).mockRejectedValueOnce(ebusy).mockReturnValueOnce(reread.promise)
    const store = createAgentSessionRecordStore(io)
    await store.whenLoaded()
    // 1 件目の record が読み直し(io.read)で止まっている間に、2 件目が来る
    store.record('/w', C)
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2))
    store.record('/w', B)
    reread.resolve(recordFileOf([{ key: '/w', ids: [A] }]))
    await vi.waitFor(() => expect(io.writes.length).toBeGreaterThanOrEqual(1))
    const written = JSON.parse(io.writes[0]).folders
    expect(written).toEqual([{ key: '/w', ids: [B, C, A] }])
    expect(store.last('/w')).toBe(B)
    expect(store.has('/w', C)).toBe(true)
    expect(store.has('/w', A)).toBe(true)
  })

  it('中身が壊れたファイルは、次の record で新しい中身に書き直す', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const io = makeFakeRecordIo('{')
    const store = createAgentSessionRecordStore(io)
    await store.whenLoaded()
    store.record('/w', A)
    await vi.waitFor(() => expect(io.writes).toHaveLength(1))
    expect(JSON.parse(io.writes[0]).folders).toEqual([{ key: '/w', ids: [A] }])
  })

  it('不正な要素だけを捨てる(キーの無いフォルダ・UUID でない ID・重複の ID・重複のフォルダ・ID が空のフォルダ)', async () => {
    const store = createAgentSessionRecordStore(
      makeFakeRecordIo(
        recordFileOf([
          { key: '', ids: [A] },
          { key: 1, ids: [A] },
          { key: '/w', ids: [A, 'abc', '--resume', A.toUpperCase(), A, B, 3] },
          { key: '/w', ids: [C] },
          { key: '/empty', ids: ['x'] },
          { key: '/bad', ids: 'x' }
        ])
      )
    )
    await store.whenLoaded()
    expect(store.last('/w')).toBe(A)
    expect(store.has('/w', B)).toBe(true)
    expect(store.has('/w', C)).toBe(false)
    expect(store.last('/empty')).toBeNull()
    expect(store.last('/bad')).toBeNull()
  })

  it('読み込んだ記録も上限(フォルダごと 200 件・フォルダ 50)に切りそろえる', async () => {
    const ids = Array.from({ length: AGENT_SESSION_RECORDS_PER_FOLDER + 5 }, (_, i) => idOf(i + 1))
    const folders = Array.from({ length: AGENT_SESSION_RECORD_FOLDERS_MAX + 3 }, (_, i) => ({
      key: `/f${i}`,
      ids: i === 0 ? ids : [idOf(1)]
    }))
    const store = createAgentSessionRecordStore(makeFakeRecordIo(recordFileOf(folders)))
    await store.whenLoaded()
    expect(store.has('/f0', idOf(AGENT_SESSION_RECORDS_PER_FOLDER))).toBe(true)
    expect(store.has('/f0', idOf(AGENT_SESSION_RECORDS_PER_FOLDER + 1))).toBe(false)
    expect(store.last(`/f${AGENT_SESSION_RECORD_FOLDERS_MAX - 1}`)).toBe(idOf(1))
    expect(store.last(`/f${AGENT_SESSION_RECORD_FOLDERS_MAX}`)).toBeNull()
  })
})

describe('createAgentSessionRecordStore: 記録', () => {
  it('record はメモリを同期で更新し(書き込みの完了を待たない)、先頭へ移して重複させない', async () => {
    const store = createAgentSessionRecordStore(
      makeFakeRecordIo(recordFileOf([{ key: '/w', ids: [A, B] }]))
    )
    await store.whenLoaded()
    store.record('/w', C)
    expect(store.last('/w')).toBe(C)
    store.record('/w', B)
    expect(store.last('/w')).toBe(B)
    await store.whenLoaded()
    // 先頭へ移しても、ほかの ID は残る
    expect(store.has('/w', A)).toBe(true)
    expect(store.has('/w', C)).toBe(true)
  })

  it('書き込むファイルは新しい順で、同じ ID を 1 回だけ持つ', async () => {
    const io = makeFakeRecordIo(recordFileOf([{ key: '/w', ids: [A, B] }]))
    const store = createAgentSessionRecordStore(io)
    await store.whenLoaded()
    store.record('/w', B)
    await vi.waitFor(() => expect(io.writes).toHaveLength(1))
    expect(JSON.parse(io.writes[0])).toEqual({ version: 1, folders: [{ key: '/w', ids: [B, A] }] })
  })

  it('フォルダごとに 200 件まで(古い ID から捨てる)', async () => {
    const store = createAgentSessionRecordStore(makeFakeRecordIo())
    await store.whenLoaded()
    for (let i = 1; i <= AGENT_SESSION_RECORDS_PER_FOLDER + 1; i += 1) store.record('/w', idOf(i))
    expect(store.last('/w')).toBe(idOf(AGENT_SESSION_RECORDS_PER_FOLDER + 1))
    expect(store.has('/w', idOf(2))).toBe(true)
    expect(store.has('/w', idOf(1))).toBe(false)
  })

  it('フォルダは 50 まで(最後に記録したのが古いフォルダから捨てる)', async () => {
    const store = createAgentSessionRecordStore(makeFakeRecordIo())
    await store.whenLoaded()
    for (let i = 0; i < AGENT_SESSION_RECORD_FOLDERS_MAX; i += 1) store.record(`/f${i}`, A)
    // /f0 を記録し直すと最新になり、次に足したフォルダで捨てられるのは /f1
    store.record('/f0', B)
    store.record('/new', C)
    expect(store.last('/f0')).toBe(B)
    expect(store.last('/f1')).toBeNull()
    expect(store.last('/new')).toBe(C)
  })

  it('書き込みは直列(前の書き込みの完了を待ってから次を書く。L-040)', async () => {
    const first = deferred<void>()
    const io = makeFakeRecordIo()
    const order: string[] = []
    io.write = vi.fn(async (data: string) => {
      order.push(`start:${JSON.parse(data).folders[0].ids[0]}`)
      if (order.length === 1) await first.promise
      order.push('end')
    })
    const store = createAgentSessionRecordStore(io)
    await store.whenLoaded()
    store.record('/w', A)
    store.record('/w', B)
    await vi.waitFor(() => expect(order).toEqual([`start:${B}`]))
    first.resolve()
    await vi.waitFor(() => expect(order).toEqual([`start:${B}`, 'end', `start:${B}`, 'end']))
  })

  it('書き込みの失敗はログに残すだけで、メモリの記録と次の書き込みは続く(L-001)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const io = makeFakeRecordIo()
    io.write = vi
      .fn<AgentSessionRecordIo['write']>()
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValue(undefined)
    const store = createAgentSessionRecordStore(io)
    await store.whenLoaded()
    expect(() => store.record('/w', A)).not.toThrow()
    store.record('/w', B)
    await vi.waitFor(() => expect(io.write).toHaveBeenCalledTimes(2))
    expect(store.last('/w')).toBe(B)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[agentSessionRecordStore] 起動の記録を書き込めませんでした:',
      expect.any(Error)
    )
  })

  it('読み込みの完了の前に記録したものは、読み込んだ記録の前に置き、書き込みは読み込みの完了を待つ', async () => {
    const read = deferred<string>()
    const io = makeFakeRecordIo(read.promise)
    const store = createAgentSessionRecordStore(io)
    store.record('/w', C)
    expect(store.last('/w')).toBe(C)
    await Promise.resolve()
    expect(io.write).not.toHaveBeenCalled()
    read.resolve(
      recordFileOf([
        { key: '/w', ids: [A, C] },
        { key: '/x', ids: [B] }
      ])
    )
    await store.whenLoaded()
    expect(store.last('/w')).toBe(C)
    expect(store.has('/w', A)).toBe(true)
    expect(store.last('/x')).toBe(B)
    await vi.waitFor(() => expect(io.writes).toHaveLength(1))
    expect(JSON.parse(io.writes[0]).folders).toEqual([
      { key: '/w', ids: [C, A] },
      { key: '/x', ids: [B] }
    ])
  })
})

describe('prependRecord', () => {
  it('記録の無いフォルダは、その ID だけの記録として先頭に足す', () => {
    expect(prependRecord([{ key: '/b', ids: [B] }], '/a', A)).toEqual([
      { key: '/a', ids: [A] },
      { key: '/b', ids: [B] }
    ])
  })

  it('既にある ID は先頭へ移し(重複させない)、そのフォルダを先頭へ移す', () => {
    const folders = [
      { key: '/b', ids: [C] },
      { key: '/a', ids: [B, A] }
    ]
    expect(prependRecord(folders, '/a', A)).toEqual([
      { key: '/a', ids: [A, B] },
      { key: '/b', ids: [C] }
    ])
    // 元の配列は変えない
    expect(folders).toEqual([
      { key: '/b', ids: [C] },
      { key: '/a', ids: [B, A] }
    ])
  })

  it('フォルダごとの ID の数とフォルダの数を上限に切りそろえる(古い方から捨てる)', () => {
    const ids = Array.from({ length: AGENT_SESSION_RECORDS_PER_FOLDER }, (_, i) => idOf(i + 1))
    const [first] = prependRecord([{ key: '/a', ids }], '/a', A)
    expect(first.ids).toHaveLength(AGENT_SESSION_RECORDS_PER_FOLDER)
    expect(first.ids[0]).toBe(A)
    expect(first.ids).not.toContain(ids[ids.length - 1])

    const folders = Array.from({ length: AGENT_SESSION_RECORD_FOLDERS_MAX }, (_, i) => ({
      key: `/f${i}`,
      ids: [idOf(i + 1)]
    }))
    const next = prependRecord(folders, '/new', A)
    expect(next).toHaveLength(AGENT_SESSION_RECORD_FOLDERS_MAX)
    expect(next[0]).toEqual({ key: '/new', ids: [A] })
    expect(next.some((folder) => folder.key === `/f${AGENT_SESSION_RECORD_FOLDERS_MAX - 1}`)).toBe(
      false
    )
  })
})
