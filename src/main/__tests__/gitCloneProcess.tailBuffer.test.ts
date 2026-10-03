import { describe, it, expect } from 'vitest'
import { createTailBuffer } from '../gitCloneProcess'

const bytes = (text: string): Buffer => Buffer.from(text, 'utf8')

// 標準エラーの末尾を残すバッファ。捨てるのはチャンク単位(バイト単位で切り詰めない)。runGitCloneProcess への
// 組み込み(進捗で上限を超えても最後の fatal を失わない)は gitCloneProcess.test.ts が実際の子プロセスで見る
describe('createTailBuffer', () => {
  it('何も入れていなければ空文字列', () => {
    expect(createTailBuffer(8).toString()).toBe('')
  })

  it('上限内なら、入れたチャンクをそのまま順に連結する', () => {
    const buffer = createTailBuffer(10)
    buffer.push(bytes('abc'))
    buffer.push(bytes('def'))
    expect(buffer.toString()).toBe('abcdef')
  })

  it('上限を超えると、残りが上限以上である限り先頭のチャンクから捨てる', () => {
    const buffer = createTailBuffer(4)
    buffer.push(bytes('aa'))
    buffer.push(bytes('bb'))
    buffer.push(bytes('cc'))
    // 'aa' を捨てても残り 4 バイト(上限ちょうど)。'bb' まで捨てると 2 バイトになるため残す
    expect(buffer.toString()).toBe('bbcc')
  })

  it('先頭のチャンクを捨てると上限を下回るなら、上限を超えていても残す(バイト単位では切り詰めない)', () => {
    const buffer = createTailBuffer(4)
    buffer.push(bytes('aaa'))
    buffer.push(bytes('bbb'))
    expect(buffer.toString()).toBe('aaabbb')
  })

  it('最後のチャンクは、それだけで上限を超えていても残す', () => {
    const buffer = createTailBuffer(0)
    buffer.push(bytes('first'))
    buffer.push(bytes('last'))
    expect(buffer.toString()).toBe('last')
  })

  it('チャンクの境界で分かれたマルチバイト文字は、両方のチャンクが残っていれば壊れない(連結してから復号する)', () => {
    const buffer = createTailBuffer(64)
    const split = bytes('fatal: あ')
    buffer.push(split.subarray(0, split.length - 2))
    buffer.push(split.subarray(split.length - 2))
    expect(buffer.toString()).toBe('fatal: あ')
  })

  // 既知の挙動: 捨てた先頭のチャンクに文字の前半があれば、残った先頭は置換文字になる。失敗の文言は末尾に出るため、
  // 末尾の側(最後に入れたチャンクまで)は壊れない
  it('文字の途中で先頭のチャンクを捨てると先頭は壊れうるが、末尾の側は壊れない', () => {
    const buffer = createTailBuffer(5)
    const a = bytes('あ') // 3 バイト
    buffer.push(a.subarray(0, 1))
    buffer.push(Buffer.concat([a.subarray(1), bytes('bbbb')]))
    const tail = bytes('い')
    buffer.push(tail.subarray(0, 2))
    buffer.push(tail.subarray(2))
    const text = buffer.toString()
    expect(text.startsWith('�')).toBe(true)
    expect(text.endsWith('bbbbい')).toBe(true)
  })
})
