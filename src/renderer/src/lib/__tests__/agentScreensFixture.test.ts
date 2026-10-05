import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// claude の画面の台帳(fixtures/agentScreens.json)の改変と、個人情報の混入を検知する。
// 台帳は記録した画面から個人情報を同じ長さの中立な文字列へ置き換えたもの(手順は fixtures/README.md)。
// claude の版を上げて記録し直したら、README.md の手順で置き換えてから AGENT_SCREENS_SHA256 を更新する
const AGENT_SCREENS_SHA256 = '6e9c974e411fcff545460a5b739089ca3c6ce5d309823453889556d8eda36c8d'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

const raw = readFileSync(resolve(__dirname, 'fixtures/agentScreens.json'))
const text = raw.toString('utf-8')

describe('agentScreens.json(claude の画面の台帳)', () => {
  it('置き換えた後の内容から変わっていない(SHA-256)', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(AGENT_SCREENS_SHA256)
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

  it('ゼロ以外の UUID を含まない(折り返された UUID の片方も 16 進の 0 以外が残らない)', () => {
    const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []
    expect(uuids.length).toBeGreaterThan(0)
    expect(uuids.filter((uuid) => uuid !== ZERO_UUID)).toEqual([])
    // 画面の右端で折り返された UUID の後半(次の行の字下げの後に続く部分)
    const tails = text.match(/[0-9a-f]*-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []
    expect(tails.filter((tail) => /[1-9a-f]/.test(tail))).toEqual([])
  })
})
