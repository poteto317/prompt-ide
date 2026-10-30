import { describe, it, expect } from 'vitest'
import { findOpenFile, pickFallbackActivePath, replaceTabWithDisk } from '../openTabs'
import type { OpenFile } from '../../types'

const tab = (path: string, content = 'c', savedContent = content): OpenFile => ({
  path,
  name: path.split('/').pop() ?? path,
  content,
  savedContent,
  language: 'plaintext'
})

const paths = (files: OpenFile[]): string[] => files.map((f) => f.path)

describe('findOpenFile', () => {
  it('path が null なら null', () => {
    expect(findOpenFile([tab('/p/a.ts')], null)).toBeNull()
  })

  it('開いていない path なら null', () => {
    expect(findOpenFile([tab('/p/a.ts')], '/p/b.ts')).toBeNull()
  })

  it('同じ path のタブを返す', () => {
    const b = tab('/p/b.ts')
    expect(findOpenFile([tab('/p/a.ts'), b], '/p/b.ts')).toBe(b)
  })

  it('Windows では大文字小文字・区切りだけ違う path も同じタブとみなす', () => {
    const a = tab('C:\\Proj\\A.ts')
    expect(findOpenFile([a], 'c:/proj/a.ts')).toBe(a)
  })
})

describe('pickFallbackActivePath', () => {
  const a = tab('/p/a.ts')
  const b = tab('/p/b.ts')
  const c = tab('/p/c.ts')
  const d = tab('/p/d.ts')

  it('1 つ閉じたら右隣を選ぶ', () => {
    expect(pickFallbackActivePath([a, b, c], [a, c], '/p/b.ts')).toBe('/p/c.ts')
  })

  it('右端を閉じたら左隣を選ぶ', () => {
    expect(pickFallbackActivePath([a, b, c], [a, b], '/p/c.ts')).toBe('/p/b.ts')
  })

  it('最後の 1 つを閉じたら null', () => {
    expect(pickFallbackActivePath([a], [], '/p/a.ts')).toBeNull()
  })

  it('要素数が同じ(リネームで自分の path が変わった)なら、同じ位置のタブを選ぶ', () => {
    const renamed = tab('/p/b-renamed.ts')
    expect(pickFallbackActivePath([a, b, c], [a, renamed, c], '/p/b.ts')).toBe('/p/b-renamed.ts')
  })

  it('アクティブと右隣が同時に消えたら(ディレクトリ削除)、消えた範囲の直後の生き残りを選ぶ', () => {
    expect(pickFallbackActivePath([a, b, c, d], [a, d], '/p/b.ts')).toBe('/p/d.ts')
  })

  it('アクティブより前のタブも一緒に消えたとき、位置ではなく内容で直後の生き残りを選ぶ', () => {
    // a・b(アクティブ)が消え、c・d が残る。位置(prevIndex = 1)で選ぶと d を選んでしまう
    expect(pickFallbackActivePath([a, b, c, d], [c, d], '/p/b.ts')).toBe('/p/c.ts')
  })

  it('右側がすべて消えたら、左へ辿って最も近い生き残りを選ぶ', () => {
    expect(pickFallbackActivePath([a, b, c, d], [a], '/p/c.ts')).toBe('/p/a.ts')
  })

  it('アクティブが前の配列にも無く要素数が減ったなら、次の配列の先頭', () => {
    expect(pickFallbackActivePath([a, b, c], [b, c], '/p/x.ts')).toBe('/p/b.ts')
  })

  it('アクティブが前の配列にも無く要素数が同じなら、次の配列の先頭', () => {
    expect(pickFallbackActivePath([a, b], [c, d], '/p/x.ts')).toBe('/p/c.ts')
  })
})

describe('replaceTabWithDisk', () => {
  it('対象のタブをディスクの内容に置き換え、未編集にする', () => {
    const files = [tab('/p/a.ts'), tab('/p/b.ts', 'edited', 'old')]
    const next = replaceTabWithDisk(files, '/p/b.ts', 'disk')
    expect(next[1]).toMatchObject({ path: '/p/b.ts', content: 'disk', savedContent: 'disk' })
  })

  it('対象以外のタブは同じ参照のまま残す', () => {
    const a = tab('/p/a.ts', 'edited', 'old')
    const next = replaceTabWithDisk([a, tab('/p/b.ts')], '/p/b.ts', 'disk')
    expect(next[0]).toBe(a)
  })

  it('disk が null なら対象のタブを除く', () => {
    const next = replaceTabWithDisk([tab('/p/a.ts'), tab('/p/b.ts')], '/p/a.ts', null)
    expect(paths(next)).toEqual(['/p/b.ts'])
  })

  it('開いていない path なら中身の同じ配列を返す(渡した配列は変えない)', () => {
    const files = [tab('/p/a.ts')]
    const next = replaceTabWithDisk(files, '/p/x.ts', 'disk')
    expect(next).toEqual(files)
    expect(next).not.toBe(files)
  })

  it('空文字の内容でも閉じずに置き換える(null と区別する)', () => {
    const next = replaceTabWithDisk([tab('/p/a.ts', 'x')], '/p/a.ts', '')
    expect(next).toHaveLength(1)
    expect(next[0].content).toBe('')
  })
})
