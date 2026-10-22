import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { lineText } from '../agentViewport'
import { copilotScreen } from './fixtures/copilotScreens'
import data from './fixtures/copilotScreens.json'

// copilot の画面の台帳(fixtures/copilotScreens.json)の改変と、個人情報の混入を検知する。
// 台帳は段階 0 の記録から個人情報を同じ長さの中立な文字列へ置き換えたもの(手順は fixtures/README.md の copilotScreens.json の節)。
// copilot の版を上げて記録し直したら、README.md の手順で置き換えてから COPILOT_SCREENS_SHA256 を更新する
const COPILOT_SCREENS_SHA256 = '8fe11e4ae5507f1859cbe61dc754062e904e15fd106adff978d1479a41154aaf'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

const raw = readFileSync(resolve(__dirname, 'fixtures/copilotScreens.json'))
const text = raw.toString('utf-8')

describe('copilotScreens.json(copilot の画面の台帳)', () => {
  it('置き換えた後の内容から変わっていない(SHA-256)', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(COPILOT_SCREENS_SHA256)
  })

  it('段階 0 の記録から選んだ 48 の画面を持つ', () => {
    expect(Object.keys(data.screens)).toHaveLength(48)
  })

  it.each<[string, RegExp]>([
    ['ホームのパス', /\/Users\//],
    ['ホームのパスを符号化したもの', /-Users-/],
    ['/home/user/ 以外のホームのパス', /\/home\/(?!user\/)/],
    ['一時ディレクトリ', /claude-\d+/],
    ['/private/tmp', /\/private\/tmp/],
    ['メールアドレス', /[\w.+-]+@[\w-]+\.[\w.-]+/],
    ['API キー', /sk-[A-Za-z0-9]/],
    ['GitHub のトークン', /gh[pousr]_[A-Za-z0-9]/]
  ])('%s を含まない', (_label, pattern) => {
    expect(text).not.toMatch(pattern)
  })

  it('ゼロ以外の UUID を含まない(信頼の確認のパス・終了の画面の --resume の UUID も 0 にしてある)', () => {
    const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []
    expect(uuids.length).toBeGreaterThan(0)
    expect(uuids.filter((uuid) => uuid !== ZERO_UUID)).toEqual([])
    const tails = text.match(/[0-9a-f]*-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []
    expect(tails.filter((tail) => /[1-9a-f]/.test(tail))).toEqual([])
  })

  it('読み出しは行の数だけ行を返し、記録の無い行は空の行にする(入力待ちの入力欄の記号の行と帯)', () => {
    const screen = copilotScreen('idle')
    expect(screen).toMatchObject({ cols: 100, rows: 30 })
    expect(screen.lines).toHaveLength(30)
    expect(screen.lines[1]).toEqual([])
    expect(lineText(screen.lines[27])).toBe('❯')
    expect(lineText(screen.lines[29])).toMatch(/^ ← open sidebar · \/ commands/)
  })

  it('記録の label に大きさのある場面は、その大きさで読む(resized60 は 60 × 20)', () => {
    const screen = copilotScreen('resized60')
    expect(screen).toMatchObject({ cols: 60, rows: 20 })
    expect(screen.lines).toHaveLength(20)
  })
})
