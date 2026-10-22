import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { lineText } from '../agentViewport'
import {
  copilotInputScreen,
  copilotInputSequence,
  screenFromTexts
} from './fixtures/copilotInputScreens'
import data from './fixtures/copilotInputScreens.json'

// copilot の入力欄の台帳(fixtures/copilotInputScreens.json)の改変と、個人情報の混入を検知する。
// 台帳は段階 2b の追加の記録から個人情報を同じ長さの中立な文字列へ置き換えたもの(手順は fixtures/README.md の
// copilotInputScreens.json の節)。copilot の版を上げて記録し直したら、README.md の手順で置き換え、このファイルの個人情報の
// テストが通ることを確かめてから COPILOT_INPUT_SCREENS_SHA256 を更新する
const COPILOT_INPUT_SCREENS_SHA256 =
  'b2015f3d08d739570b384bccd5291e79f2aad6a1a47fde81b890300bc71cac6e'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

const raw = readFileSync(resolve(__dirname, 'fixtures/copilotInputScreens.json'))
const text = raw.toString('utf-8')

describe('copilotInputScreens.json(copilot の入力欄の台帳)', () => {
  it('置き換えた後の内容から変わっていない(SHA-256)', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(COPILOT_INPUT_SCREENS_SHA256)
  })

  it('段階 2b の追加の記録から選んだ 45 の画面と 6 つの列を持つ', () => {
    expect(Object.keys(data.screens)).toHaveLength(45)
    expect(Object.keys(data.sequences)).toHaveLength(6)
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

  it('ゼロ以外の UUID を含まない(折り返された UUID の後半も)', () => {
    const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []
    expect(uuids.filter((uuid) => uuid !== ZERO_UUID)).toEqual([])
    const tails = text.match(/[0-9a-f]*-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []
    expect(tails.filter((tail) => /[1-9a-f]/.test(tail))).toEqual([])
  })

  it('画面の読み出しは行の数だけ行を返し、記録の無い行は空の行にする(空の入力欄の記号の行と帯)', () => {
    const screen = copilotInputScreen('empty')
    expect(screen).toMatchObject({ cols: 100, rows: 30 })
    expect(screen.lines).toHaveLength(30)
    expect(screen.lines[1]).toEqual([])
    expect(lineText(screen.lines[27])).toBe('❯')
    expect(lineText(screen.lines[29])).toMatch(/^ ← open sidebar · \/ commands/)
  })

  it('フォルダの名前に大きさのある記録は、その大きさで読む(tallIdle は 60 × 12)', () => {
    const screen = copilotInputScreen('tallIdle')
    expect(screen).toMatchObject({ cols: 60, rows: 12 })
    expect(screen.lines).toHaveLength(12)
    expect(lineText(screen.lines[8])).toBe('❯')
  })

  it('列の読み出しは、書き込みからの時刻と、画面の末尾の行を属性の無い行で返す(aeInstant は Enter から 52・63・99・2405ms)', () => {
    const frames = copilotInputSequence('aeInstant')
    expect(frames.map((frame) => frame.dt)).toEqual([52, 63, 99, 2405])
    expect(frames[0].lines.map(lineText)).toContain('❯ prompt instant')
    expect(frames[0].lines.flat().some((cell) => cell.dim || cell.inverse)).toBe(false)
  })

  it('screenFromTexts は文字列の行を属性の無い行にする(空の文字列は空の行)', () => {
    expect(screenFromTexts(['ab', ''])).toEqual([
      [
        { char: 'a', dim: false, inverse: false },
        { char: 'b', dim: false, inverse: false }
      ],
      []
    ])
  })
})
