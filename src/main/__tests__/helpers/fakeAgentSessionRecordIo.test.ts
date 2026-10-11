import { describe, it, expect } from 'vitest'
import { createAgentSessionRecordStore } from '../../agentSessionRecordStore'
import { makeFakeRecordIo, noRecordFile, recordFileOf } from './fakeAgentSessionRecordIo'

const A = '11111111-1111-4111-8111-111111111111'

describe('makeFakeRecordIo', () => {
  it('既定は「ファイルが無い」(ENOENT で失敗する)', async () => {
    await expect(makeFakeRecordIo().read()).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('文字列はそのまま返し、Error は投げ、Promise はその完了を待つ', async () => {
    await expect(makeFakeRecordIo('abc').read()).resolves.toBe('abc')
    const error = new Error('EACCES')
    await expect(makeFakeRecordIo(error).read()).rejects.toBe(error)
    let resolve: (value: string) => void = () => undefined
    const pending = new Promise<string>((r) => {
      resolve = r
    })
    const read = makeFakeRecordIo(pending).read()
    resolve('later')
    await expect(read).resolves.toBe('later')
  })

  it('write は中身を呼ばれた順に writes へ積み、呼ぶたびに別の偽物を作る', async () => {
    const io = makeFakeRecordIo()
    await io.write('1')
    await io.write('2')
    expect(io.writes).toEqual(['1', '2'])
    expect(io.write).toHaveBeenCalledTimes(2)
    expect(makeFakeRecordIo().writes).toEqual([])
  })
})

describe('noRecordFile・recordFileOf', () => {
  it('本物の記録ストアが、noRecordFile を空の記録として、recordFileOf を記録のファイルとして読む', async () => {
    const empty = createAgentSessionRecordStore(makeFakeRecordIo(noRecordFile()))
    await empty.whenLoaded()
    expect(empty.last('/w')).toBeNull()
    const loaded = createAgentSessionRecordStore(
      makeFakeRecordIo(recordFileOf([{ key: '/w', ids: [A] }]))
    )
    await loaded.whenLoaded()
    expect(loaded.last('/w')).toBe(A)
  })

  it('recordFileOf は記録ストアが書き込む形と同じ', async () => {
    const io = makeFakeRecordIo()
    const store = createAgentSessionRecordStore(io)
    await store.whenLoaded()
    store.record('/w', A)
    await expect.poll(() => io.writes).toHaveLength(1)
    expect(io.writes[0]).toBe(recordFileOf([{ key: '/w', ids: [A] }]))
  })
})
