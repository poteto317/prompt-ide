import { describe, it, expect, vi } from 'vitest'
import { applyInOrder, assertSameEntries, listPathsForMessage } from '../discardBatch'

// 「すべて取り消す」(gitDiscardService)と「すべて戻す」(agentChangesRevert)に共通の手順。
// 呼び出し側の文言・照合の入力の作り方は gitDiscardService.test.ts・agentChangesRevert.integration.test.ts で見る

const MISMATCH = '一致しません'
const e = (status: string, path: string): { status: string; path: string } => ({ status, path })

describe('listPathsForMessage', () => {
  it.each([
    [[], ''],
    [['a'], 'a'],
    [['a', 'b', 'c', 'd', 'e'], 'a、b、c、d、e'],
    [['a', 'b', 'c', 'd', 'e', 'f'], 'a、b、c、d、e、ほか 1 件'],
    [['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'a、b、c、d、e、ほか 2 件']
  ])('%j → %s', (paths, expected) => {
    expect(listPathsForMessage(paths)).toBe(expected)
  })
})

describe('assertSameEntries', () => {
  it('同じ組なら、順序が違っても通す', () => {
    expect(() =>
      assertSameEntries([e(' M', 'b'), e('??', 'a')], [e('??', 'a'), e(' M', 'b')], MISMATCH)
    ).not.toThrow()
  })

  it('両方とも空なら通す', () => {
    expect(() => assertSameEntries([], [], MISMATCH)).not.toThrow()
  })

  it('件数が違えば mismatchMessage で投げる', () => {
    expect(() => assertSameEntries([e(' M', 'a')], [], MISMATCH)).toThrow(MISMATCH)
    expect(() => assertSameEntries([], [e(' M', 'a')], MISMATCH)).toThrow(MISMATCH)
  })

  it('件数が同じでもパスが入れ替わっていれば投げる', () => {
    expect(() => assertSameEntries([e('A ', 'scratch')], [e('??', 'other')], MISMATCH)).toThrow(
      MISMATCH
    )
  })

  it('同じパスでも status が違えば投げる(?? → AM のような変化を止める)', () => {
    expect(() => assertSameEntries([e('AM', 'x')], [e('??', 'x')], MISMATCH)).toThrow(MISMATCH)
  })

  it('重複の数の違いを区別する(件数が同じでも、多重集合として一致しなければ投げる)', () => {
    expect(() =>
      assertSameEntries([e(' M', 'a'), e(' M', 'a')], [e(' M', 'a'), e(' M', 'b')], MISMATCH)
    ).toThrow(MISMATCH)
    expect(() =>
      assertSameEntries([e(' M', 'a'), e(' M', 'a')], [e(' M', 'a'), e(' M', 'a')], MISMATCH)
    ).not.toThrow()
  })

  // パスは NUL を含められない前提で、status と path を NUL で区切ってキーにする。区切りが無いと
  // ('A', ' Mx') と ('A ', 'Mx') が同じキーになり、別の組を一致とみなす
  it('status と path の境界をずらした組を一致とみなさない', () => {
    expect(() => assertSameEntries([e('A', ' Mx')], [e('A ', 'Mx')], MISMATCH)).toThrow(MISMATCH)
  })

  it('照合に使うのは status と path だけ(他のプロパティは見ない)', () => {
    const actual = [{ status: 'A', path: 'd/', isDirectory: true, notRecorded: false }]
    expect(() => assertSameEntries(actual, [e('A', 'd/')], MISMATCH)).not.toThrow()
  })

  it('末尾の / の有無は正規化しない(表記の揃え方は呼び出し側の責務)', () => {
    expect(() => assertSameEntries([e('A', 'd/')], [e('A', 'd')], MISMATCH)).toThrow(MISMATCH)
  })
})

describe('applyInOrder', () => {
  const format = (done: number, total: number, reason: string): string =>
    `失敗（${done} / ${total} 件済み）: ${reason}`

  it('すべて成功したら、順に実行して done を返す', async () => {
    const calls: string[] = []
    const apply = vi.fn(async (t: string) => {
      calls.push(t)
    })
    await expect(applyInOrder(['a', 'b', 'c'], apply, format)).resolves.toEqual({
      status: 'done'
    })
    expect(calls).toEqual(['a', 'b', 'c'])
  })

  it('対象が 0 件なら何もせず done を返す', async () => {
    const apply = vi.fn()
    await expect(applyInOrder([], apply, format)).resolves.toEqual({ status: 'done' })
    expect(apply).not.toHaveBeenCalled()
  })

  it('前の実行が終わるまで次を始めない', async () => {
    const log: string[] = []
    await applyInOrder(
      ['a', 'b'],
      async (t) => {
        log.push(`start ${t}`)
        await new Promise<void>((resolve) => queueMicrotask(resolve))
        log.push(`end ${t}`)
      },
      format
    )
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b'])
  })

  it('1 件目で失敗したら、件数つきの文言で投げ、cause に元のエラーを保ち、残りは実行しない', async () => {
    const cause = new Error('denied')
    const apply = vi.fn().mockRejectedValueOnce(cause)
    const error = await applyInOrder(['a', 'b'], apply, format).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('失敗（0 / 2 件済み）: denied')
    expect((error as Error).cause).toBe(cause)
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('2 件目以降で失敗したら、例外ではなく partial を返し、残りは実行しない', async () => {
    const apply = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('denied'))
    await expect(applyInOrder(['a', 'b', 'c', 'd'], apply, format)).resolves.toEqual({
      status: 'partial',
      message: '失敗（2 / 4 件済み）: denied'
    })
    expect(apply).toHaveBeenCalledTimes(3)
  })

  it('Error でない値で失敗したら、String にした値を理由にする', async () => {
    const apply = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce('boom')
    await expect(applyInOrder(['a', 'b'], apply, format)).resolves.toEqual({
      status: 'partial',
      message: '失敗（1 / 2 件済み）: boom'
    })
  })
})
