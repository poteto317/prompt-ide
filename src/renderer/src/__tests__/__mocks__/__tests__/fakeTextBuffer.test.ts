import { describe, it, expect } from 'vitest'
import {
  applyEdit,
  collapsedSelection,
  offsetAt,
  selectionFromCursorState,
  selectionOf
} from '../fakeTextBuffer'

const range = (
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number
): { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } => ({
  startLineNumber,
  startColumn,
  endLineNumber,
  endColumn
})

describe('offsetAt', () => {
  it('行・列(1 始まり)を文字列の位置へ変換する', () => {
    expect(offsetAt('abc', 1, 1)).toBe(0)
    expect(offsetAt('abc', 1, 4)).toBe(3)
  })

  it('2 行目以降は、前の行の長さと改行(\\n)の 1 文字を足す', () => {
    expect(offsetAt('ab\ncde\nf', 2, 1)).toBe(3)
    expect(offsetAt('ab\ncde\nf', 2, 3)).toBe(5)
    expect(offsetAt('ab\ncde\nf', 3, 2)).toBe(8)
  })
})

describe('applyEdit', () => {
  it('単一行の挿入: 文字列に入れ、挿入した範囲の末尾は開始の列 + 文字数', () => {
    expect(applyEdit('abcd', { range: range(1, 3, 1, 3), text: 'XY' })).toEqual([
      'abXYcd',
      range(1, 3, 1, 5)
    ])
  })

  it('複数行の挿入: 末尾は最後の行の、挿入した最後の行の長さ + 1 の列', () => {
    expect(applyEdit('abc', { range: range(1, 2, 1, 2), text: 'X\nYZ' })).toEqual([
      'aX\nYZbc',
      range(1, 2, 2, 3)
    ])
  })

  it('2 行目以降への複数行の挿入: 末尾の行は開始の行 + 挿入の行数 - 1', () => {
    expect(applyEdit('ab\ncd', { range: range(2, 2, 2, 2), text: '1\n2\n3' })).toEqual([
      'ab\nc1\n2\n3d',
      range(2, 2, 4, 2)
    ])
  })

  it('範囲の置換: 範囲の文字列を置き換え、挿入した範囲は開始から数える', () => {
    expect(applyEdit('ab\ncd', { range: range(1, 2, 2, 2), text: 'Z' })).toEqual([
      'aZd',
      range(1, 2, 1, 3)
    ])
  })

  it('空文字列で置換すると削除になり、挿入した範囲は空', () => {
    expect(applyEdit('abcd', { range: range(1, 2, 1, 4), text: '' })).toEqual([
      'ad',
      range(1, 2, 1, 2)
    ])
  })
})

describe('selectionOf / collapsedSelection', () => {
  it('selectionOf は [開始の行, 列, 終わりの行, 列, カーソルの行, 列] の順に受け取る', () => {
    expect(selectionOf(1, 2, 3, 4, 5, 6)).toEqual({
      startLineNumber: 1,
      startColumn: 2,
      endLineNumber: 3,
      endColumn: 4,
      positionLineNumber: 5,
      positionColumn: 6
    })
  })

  it('collapsedSelection は、カーソルもその位置にある空の選択', () => {
    expect(collapsedSelection(2, 3)).toEqual(selectionOf(2, 3, 2, 3, 2, 3))
  })
})

describe('selectionFromCursorState', () => {
  it('前向きの選択(起点が前)は、起点を開始・カーソルを終わりにする', () => {
    expect(
      selectionFromCursorState({
        selectionStartLineNumber: 1,
        selectionStartColumn: 2,
        positionLineNumber: 3,
        positionColumn: 4
      })
    ).toEqual(selectionOf(1, 2, 3, 4, 3, 4))
  })

  it('後ろ向きの選択(カーソルが前)は、カーソルを開始・起点を終わりにする', () => {
    expect(
      selectionFromCursorState({
        selectionStartLineNumber: 2,
        selectionStartColumn: 5,
        positionLineNumber: 2,
        positionColumn: 1
      })
    ).toEqual(selectionOf(2, 1, 2, 5, 2, 1))
  })

  it('起点とカーソルが同じなら空の選択', () => {
    expect(
      selectionFromCursorState({
        selectionStartLineNumber: 4,
        selectionStartColumn: 7,
        positionLineNumber: 4,
        positionColumn: 7
      })
    ).toEqual(collapsedSelection(4, 7))
  })
})
