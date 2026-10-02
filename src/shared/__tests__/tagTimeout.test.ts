import { describe, it, expect } from 'vitest'
import { TAG_CREATE_TIMEOUT_MINUTES, TAG_CREATE_TIMEOUT_MS } from '../tagTimeout'

// main の打ち切り(gitTagService の createTag)と renderer の作成中の案内(CreateTagDialog の「最大 N 分」)が
// 同じ値を使う。値を変えるときは、設計書の「120 秒」「最大 2 分」の記述と manual-test-spec の TAG-026 も直す
describe('TAG_CREATE_TIMEOUT_MS', () => {
  it('120 秒', () => {
    expect(TAG_CREATE_TIMEOUT_MS).toBe(120_000)
  })

  // 案内は「最大 N 分」と分で表すため、整数分でない値(90 秒など)を入れると「最大 1.5 分」のような
  // 文言になる。秒で表す分岐は作らず、60 秒の倍数であることをここで固定する
  it('60 秒の倍数で、TAG_CREATE_TIMEOUT_MINUTES はその分数', () => {
    expect(TAG_CREATE_TIMEOUT_MS % 60_000).toBe(0)
    expect(TAG_CREATE_TIMEOUT_MINUTES).toBe(TAG_CREATE_TIMEOUT_MS / 60_000)
    expect(Number.isInteger(TAG_CREATE_TIMEOUT_MINUTES)).toBe(true)
    expect(TAG_CREATE_TIMEOUT_MINUTES).toBeGreaterThan(0)
  })
})
