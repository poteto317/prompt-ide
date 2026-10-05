import { describe, it, expect } from 'vitest'
import { createPendingOutputBuffer } from '../agentPendingOutput'

describe('createPendingOutputBuffer', () => {
  it('begin の前に届いた出力は捨てる', () => {
    const buffer = createPendingOutputBuffer(100)
    expect(buffer.isCollecting()).toBe(false)
    buffer.push('s1', 'early')
    expect(buffer.take('s1')).toEqual([])
  })

  it('begin の後に届いた出力を、セッションごとに届いた順で溜める', () => {
    const buffer = createPendingOutputBuffer(100)
    buffer.begin()
    expect(buffer.isCollecting()).toBe(true)
    buffer.push('s1', 'a')
    buffer.push('s2', 'x')
    buffer.push('s1', 'b')
    expect(buffer.take('s1')).toEqual(['a', 'b'])
  })

  it('take は溜めるのを終え、別のセッションの出力を捨てる', () => {
    const buffer = createPendingOutputBuffer(100)
    buffer.begin()
    buffer.push('s1', 'a')
    buffer.push('s2', 'x')
    expect(buffer.take('s1')).toEqual(['a'])
    expect(buffer.isCollecting()).toBe(false)
    // 終えた後に届いた出力は溜めない
    buffer.push('s2', 'y')
    expect(buffer.take('s2')).toEqual([])
  })

  it('take(null)(起動の失敗)も溜めるのを終え、すべて捨てる', () => {
    const buffer = createPendingOutputBuffer(100)
    buffer.begin()
    buffer.push('s1', 'a')
    expect(buffer.take(null)).toEqual([])
    expect(buffer.isCollecting()).toBe(false)
  })

  it('begin し直すと前に溜めた出力を捨てる', () => {
    const buffer = createPendingOutputBuffer(100)
    buffer.begin()
    buffer.push('s1', 'old')
    buffer.begin()
    buffer.push('s1', 'new')
    expect(buffer.take('s1')).toEqual(['new'])
  })

  it('合計がちょうど上限までは溜め、超えるチャンクは溜めない', () => {
    const buffer = createPendingOutputBuffer(10)
    buffer.begin()
    buffer.push('s1', '12345')
    buffer.push('s1', '67890')
    buffer.push('s1', 'x')
    expect(buffer.take('s1')).toEqual(['12345', '67890'])
  })

  it('上限を超えたセッションは、その後の小さいチャンクも溜めない(途中が欠けた出力にしない)', () => {
    const buffer = createPendingOutputBuffer(10)
    buffer.begin()
    buffer.push('s1', '1234567')
    buffer.push('s1', 'abcdef')
    buffer.push('s1', 'z')
    expect(buffer.take('s1')).toEqual(['1234567'])
  })

  it('上限は全セッションの合計で数え、超えていない別のセッションの出力は溜め続ける', () => {
    const buffer = createPendingOutputBuffer(10)
    buffer.begin()
    buffer.push('s1', '1234567')
    buffer.push('s1', 'abcdef')
    buffer.push('s2', 'q')
    buffer.push('s1', 'z')
    buffer.push('s2', 'r')
    expect(buffer.take('s2')).toEqual(['q', 'r'])
  })

  it('begin し直すと合計と上限を超えた印を戻す', () => {
    const buffer = createPendingOutputBuffer(10)
    buffer.begin()
    buffer.push('s1', '1234567890')
    buffer.push('s1', 'x')
    buffer.begin()
    buffer.push('s1', '1234567890')
    expect(buffer.take('s1')).toEqual(['1234567890'])
  })
})
