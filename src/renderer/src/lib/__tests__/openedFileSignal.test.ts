import { describe, it, expect } from 'vitest'
import { appendOpenedFileEvent, MAX_OPENED_FILE_EVENTS } from '../openedFileSignal'
import type { OpenedFileEvent, OpenedFileSignal } from '../openedFileSignal'

const event = (id: number, path: string, moveFocusToEditor = false): OpenedFileEvent => ({
  id,
  path,
  moveFocusToEditor
})

const EMPTY: OpenedFileSignal = { events: [] }

describe('appendOpenedFileEvent', () => {
  it('空の信号に足すと 1 件になる', () => {
    expect(appendOpenedFileEvent(EMPTY, event(1, '/p/a.ts')).events).toEqual([event(1, '/p/a.ts')])
  })

  it('末尾に足し、id の昇順を保つ', () => {
    const one = appendOpenedFileEvent(EMPTY, event(1, '/p/a.ts'))
    const two = appendOpenedFileEvent(one, event(2, '/p/b.ts'))
    expect(two.events.map((e) => e.id)).toEqual([1, 2])
  })

  it('同じパスの古いイベントは畳み、新しいイベントを末尾に置く', () => {
    let signal = appendOpenedFileEvent(EMPTY, event(1, '/p/a.ts'))
    signal = appendOpenedFileEvent(signal, event(2, '/p/b.ts'))
    signal = appendOpenedFileEvent(signal, event(3, '/p/a.ts', true))
    expect(signal.events).toEqual([event(2, '/p/b.ts'), event(3, '/p/a.ts', true)])
  })

  it('Windows では表記だけ違うパスも同じファイルとして畳む', () => {
    const signal = appendOpenedFileEvent(
      appendOpenedFileEvent(EMPTY, event(1, 'C:\\Proj\\A.ts')),
      event(2, 'c:/proj/a.ts')
    )
    expect(signal.events).toEqual([event(2, 'c:/proj/a.ts')])
  })

  it('渡した信号は変えない', () => {
    const prev: OpenedFileSignal = { events: [event(1, '/p/a.ts')] }
    appendOpenedFileEvent(prev, event(2, '/p/a.ts'))
    expect(prev.events).toEqual([event(1, '/p/a.ts')])
  })

  it('上限を超えたら古い方から落とす(既定の上限は MAX_OPENED_FILE_EVENTS)', () => {
    let signal = EMPTY
    for (let i = 1; i <= MAX_OPENED_FILE_EVENTS + 1; i++) {
      signal = appendOpenedFileEvent(signal, event(i, `/p/${i}.ts`))
    }
    expect(signal.events).toHaveLength(MAX_OPENED_FILE_EVENTS)
    expect(signal.events[0].id).toBe(2)
    expect(signal.events.at(-1)?.id).toBe(MAX_OPENED_FILE_EVENTS + 1)
  })

  it('上限ちょうどまでは落とさない', () => {
    let signal = EMPTY
    for (let i = 1; i <= 3; i++) signal = appendOpenedFileEvent(signal, event(i, `/p/${i}.ts`), 3)
    expect(signal.events.map((e) => e.id)).toEqual([1, 2, 3])
  })

  it('重複を畳んでから件数で切るので、重複が枠を埋めて別ファイルの履歴を落とさない', () => {
    let signal = appendOpenedFileEvent(EMPTY, event(1, '/p/keep.ts'), 2)
    // 同じファイルを何度開き直しても 1 件に畳まれ、keep.ts は残る
    for (let i = 2; i <= 5; i++) signal = appendOpenedFileEvent(signal, event(i, '/p/a.ts'), 2)
    expect(signal.events.map((e) => e.path)).toEqual(['/p/keep.ts', '/p/a.ts'])
  })
})
