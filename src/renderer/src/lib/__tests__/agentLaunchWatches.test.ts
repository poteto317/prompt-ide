import { describe, expect, it } from 'vitest'
import { createAgentLaunchWatches } from '../agentLaunchWatches'

const FAILED_EXIT = { exitCode: 1, reason: 'exited' } as const

describe('createAgentLaunchWatches(起動ごとの控え)', () => {
  it('resume で控え、活動を見ないまま 0 以外で終わると再開の失敗', () => {
    const watches = createAgentLaunchWatches()
    watches.begin('slot-1', 'resume')
    expect(watches.isResumeFailure('slot-1', FAILED_EXIT)).toBe(true)
  })

  it('控えの無いタブは再開の失敗にしない', () => {
    const watches = createAgentLaunchWatches()
    expect(watches.isResumeFailure('slot-1', FAILED_EXIT)).toBe(false)
  })

  it('new で控えたタブは再開の失敗にしない', () => {
    const watches = createAgentLaunchWatches()
    watches.begin('slot-1', 'new')
    expect(watches.isResumeFailure('slot-1', FAILED_EXIT)).toBe(false)
  })

  it('活動を見たタブは再開の失敗にしない(ほかのタブの控えは変えない)', () => {
    const watches = createAgentLaunchWatches()
    watches.begin('slot-1', 'resume')
    watches.begin('slot-2', 'resume')
    watches.noteScreenActivity('slot-1')
    expect(watches.isResumeFailure('slot-1', FAILED_EXIT)).toBe(false)
    expect(watches.isResumeFailure('slot-2', FAILED_EXIT)).toBe(true)
  })

  it('控え直すと前の起動で見た活動を持ち越さない', () => {
    const watches = createAgentLaunchWatches()
    watches.begin('slot-1', 'resume')
    watches.noteScreenActivity('slot-1')
    watches.begin('slot-1', 'resume')
    expect(watches.isResumeFailure('slot-1', FAILED_EXIT)).toBe(true)
  })

  it('new で控え直すと、resume の控えを上書きする(already-running・合わせ込み)', () => {
    const watches = createAgentLaunchWatches()
    watches.begin('slot-1', 'resume')
    watches.begin('slot-1', 'new')
    expect(watches.isResumeFailure('slot-1', FAILED_EXIT)).toBe(false)
  })

  it('控えの無いタブの活動は何もしない(後から resume で控えても活動を見たことにしない)', () => {
    const watches = createAgentLaunchWatches()
    watches.noteScreenActivity('slot-1')
    watches.begin('slot-1', 'resume')
    expect(watches.isResumeFailure('slot-1', FAILED_EXIT)).toBe(true)
  })

  it('forget で控えを消す', () => {
    const watches = createAgentLaunchWatches()
    watches.begin('slot-1', 'resume')
    watches.forget('slot-1')
    expect(watches.isResumeFailure('slot-1', FAILED_EXIT)).toBe(false)
  })

  it('終了の見分けは isAgentResumeFailure に従う(利用者の停止・終了コード 0 は偽)', () => {
    const watches = createAgentLaunchWatches()
    watches.begin('slot-1', 'resume')
    expect(watches.isResumeFailure('slot-1', { exitCode: 1, reason: 'stopped' })).toBe(false)
    expect(watches.isResumeFailure('slot-1', { exitCode: 0, reason: 'exited' })).toBe(false)
    expect(watches.isResumeFailure('slot-1', { exitCode: null, reason: 'exited' })).toBe(true)
  })
})
