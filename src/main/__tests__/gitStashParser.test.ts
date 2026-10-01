import { describe, it, expect } from 'vitest'
import { findStashIndex, parseStashList, parseStashSubject } from '../gitStashParser'

describe('parseStashSubject', () => {
  // git stash push -m "msg" の件名は "On <branch>: msg"
  it('メッセージ付きの退避(On <branch>: <msg>)からメッセージとブランチを取り出す', () => {
    expect(parseStashSubject('On main: my message')).toEqual({
      branch: 'main',
      message: 'my message'
    })
  })

  // メッセージ無しの退避の件名は "WIP on <branch>: <短縮ハッシュ> <最後のコミットの件名>"
  it('メッセージ無しの退避(WIP on <branch>: <hash> <subject>)は件名だけをメッセージにする', () => {
    expect(parseStashSubject('WIP on main: 745da1d fix the bug')).toEqual({
      branch: 'main',
      message: 'fix the bug'
    })
  })

  it('detached HEAD の退避は branch が (no branch) になる', () => {
    expect(parseStashSubject('On (no branch): detached')).toEqual({
      branch: '(no branch)',
      message: 'detached'
    })
  })

  it('ブランチ名に / を含んでもよい', () => {
    expect(parseStashSubject('On feature/x: wip')).toEqual({ branch: 'feature/x', message: 'wip' })
  })

  // 最初の ': ' までをブランチ名とする。メッセージ側に ': ' があっても崩れない
  it('メッセージに ": " を含んでいても、最初の区切りでブランチとメッセージに分ける', () => {
    expect(parseStashSubject('On main: fix: handle null')).toEqual({
      branch: 'main',
      message: 'fix: handle null'
    })
  })

  it('どちらの形式にも当てはまらない件名は、件名をそのままメッセージにする', () => {
    expect(parseStashSubject('something else')).toEqual({ branch: '', message: 'something else' })
  })

  it('WIP の件名で先頭のハッシュが無い形式は、残りをそのままメッセージにする', () => {
    expect(parseStashSubject('WIP on main: plain subject')).toEqual({
      branch: 'main',
      message: 'plain subject'
    })
  })
})

describe('parseStashList', () => {
  const sha1 = 'a'.repeat(40)
  const sha2 = 'b'.repeat(40)

  it('空の出力は空配列', () => {
    expect(parseStashList('')).toEqual([])
  })

  it('NUL 区切りの SHA・件名・日時を 1 件ずつの退避にする(新しい順のまま)', () => {
    const output = `${sha1}\0On main: first\0${'2026-10-01T10:00:00+09:00'}\0${sha2}\0WIP on dev: 123abcd second\0${'2026-09-30T09:00:00+09:00'}\0`
    expect(parseStashList(output)).toEqual([
      { sha: sha1, message: 'first', branch: 'main', createdAt: '2026-10-01T10:00:00+09:00' },
      { sha: sha2, message: 'second', branch: 'dev', createdAt: '2026-09-30T09:00:00+09:00' }
    ])
  })

  it('末尾の NUL が無くても解析できる', () => {
    const output = `${sha1}\0On main: x\0${'2026-10-01T10:00:00+09:00'}`
    expect(parseStashList(output)).toHaveLength(1)
  })

  // メッセージが空の退避(件名が "On main: ")でも、3 フィールドごとの区切りがずれない
  it('件名が空に近い退避があっても、後ろの退避の区切りがずれない', () => {
    const output = `${sha1}\0On main: \0${'2026-10-01T10:00:00+09:00'}\0${sha2}\0On main: y\0${'2026-10-01T11:00:00+09:00'}\0`
    const entries = parseStashList(output)
    expect(entries.map((e) => e.sha)).toEqual([sha1, sha2])
    expect(entries[0].message).toBe('')
  })

  it('フィールドが 3 の倍数に満たない不完全な末尾は捨てる', () => {
    const output = `${sha1}\0On main: x\0${'2026-10-01T10:00:00+09:00'}\0${sha2}\0On main: y\0`
    expect(parseStashList(output).map((e) => e.sha)).toEqual([sha1])
  })
})

describe('findStashIndex', () => {
  const entries = [
    { sha: 'a'.repeat(40), message: '', branch: '', createdAt: '' },
    { sha: 'b'.repeat(40), message: '', branch: '', createdAt: '' }
  ]
  it('SHA の一覧での位置(0 始まり)を返す', () => {
    expect(findStashIndex(entries, 'b'.repeat(40))).toBe(1)
  })
  it('一覧に無い SHA は -1', () => {
    expect(findStashIndex(entries, 'c'.repeat(40))).toBe(-1)
  })
})
