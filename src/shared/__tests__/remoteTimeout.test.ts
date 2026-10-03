import { describe, it, expect } from 'vitest'
import {
  GIT_CLONE_IDLE_TIMEOUT_MS,
  GIT_CLONE_IDLE_TIMEOUT_SECONDS,
  GIT_REMOTE_TIMEOUT_MS,
  GIT_REMOTE_TIMEOUT_SECONDS
} from '../remoteTimeout'

// main の打ち切り(push / pull / fetch / 初回 push)と renderer の初回 push 中の案内(「応答が N 秒途絶えると
// 打ち切ります」)が同じ値を使う(パターン 88)。値を変えるときは manual-test-spec の RMT の項目も直す
describe('GIT_REMOTE_TIMEOUT_MS', () => {
  it('30 秒', () => {
    expect(GIT_REMOTE_TIMEOUT_MS).toBe(30_000)
  })

  // 案内は秒で表すため、1000 の倍数でない値を入れると「30.5 秒」のような文言になる
  it('1000 の倍数で、GIT_REMOTE_TIMEOUT_SECONDS はその秒数', () => {
    expect(GIT_REMOTE_TIMEOUT_MS % 1000).toBe(0)
    expect(GIT_REMOTE_TIMEOUT_SECONDS).toBe(GIT_REMOTE_TIMEOUT_MS / 1000)
    expect(Number.isInteger(GIT_REMOTE_TIMEOUT_SECONDS)).toBe(true)
  })
})

// main の clone の打ち切り(出力が途絶えた時間)と renderer の clone 中の案内が同じ値を使う(パターン 88)。
// 値を変えるときは manual-test-spec の CLN の項目も直す
describe('GIT_CLONE_IDLE_TIMEOUT_MS', () => {
  it('60 秒', () => {
    expect(GIT_CLONE_IDLE_TIMEOUT_MS).toBe(60_000)
  })

  it('1000 の倍数で、GIT_CLONE_IDLE_TIMEOUT_SECONDS はその秒数', () => {
    expect(GIT_CLONE_IDLE_TIMEOUT_MS % 1000).toBe(0)
    expect(GIT_CLONE_IDLE_TIMEOUT_SECONDS).toBe(GIT_CLONE_IDLE_TIMEOUT_MS / 1000)
    expect(Number.isInteger(GIT_CLONE_IDLE_TIMEOUT_SECONDS)).toBe(true)
  })
})
