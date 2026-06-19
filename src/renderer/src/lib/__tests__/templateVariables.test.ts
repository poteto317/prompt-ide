import { describe, it, expect } from 'vitest'
import { extractVariables, interpolatePrompt } from '../templateVariables'

describe('extractVariables', () => {
  it('変数がないとき空配列を返す', () => {
    expect(extractVariables('ただのテキスト')).toEqual([])
  })

  it('単一の変数を抽出する', () => {
    expect(extractVariables('こんにちは {{name}}')).toEqual(['name'])
  })

  it('複数の変数を出現順に抽出する', () => {
    expect(extractVariables('{{greeting}} {{name}} さん')).toEqual(['greeting', 'name'])
  })

  it('重複した変数は1つに排除する（出現順は維持）', () => {
    expect(extractVariables('{{name}} と {{topic}} と {{name}}')).toEqual(['name', 'topic'])
  })

  it('プレースホルダ内の前後空白を無視する', () => {
    expect(extractVariables('{{ name }} と {{  topic  }}')).toEqual(['name', 'topic'])
  })

  it('アンダースコア・ハイフンを含む変数名を許可する', () => {
    expect(extractVariables('{{user_name}} {{user-id}}')).toEqual(['user_name', 'user-id'])
  })

  it('日本語の変数名を許可する', () => {
    expect(extractVariables('{{名前}} さんへ、{{話題}} について')).toEqual(['名前', '話題'])
  })

  it('空のプレースホルダ {{}} は無視する', () => {
    expect(extractVariables('{{}} と {{name}}')).toEqual(['name'])
  })

  it('空白のみのプレースホルダ {{  }} は無視する', () => {
    expect(extractVariables('{{   }} と {{name}}')).toEqual(['name'])
  })
})

describe('interpolatePrompt', () => {
  it('変数を値で差し込む', () => {
    expect(interpolatePrompt('こんにちは {{name}}', { name: 'Alice' })).toBe('こんにちは Alice')
  })

  it('複数・重複の変数をすべて置換する', () => {
    expect(interpolatePrompt('{{name}} と {{name}} と {{topic}}', { name: 'A', topic: 'B' })).toBe(
      'A と A と B'
    )
  })

  it('前後空白を含むプレースホルダも置換する', () => {
    expect(interpolatePrompt('{{ name }}', { name: 'Bob' })).toBe('Bob')
  })

  it('値が未指定（キーなし）の変数はリテラルを残す', () => {
    expect(interpolatePrompt('{{name}} と {{missing}}', { name: 'A' })).toBe('A と {{missing}}')
  })

  it('変数がないテンプレートはそのまま返す', () => {
    expect(interpolatePrompt('変数なしテキスト', {})).toBe('変数なしテキスト')
  })

  it('値に空文字が明示指定された場合は空に置換する', () => {
    expect(interpolatePrompt('[{{x}}]', { x: '' })).toBe('[]')
  })

  it('プロトタイプ継承プロパティ名（toString 等）は未指定としてリテラルを残す', () => {
    // values[name] のプロトタイプチェーン参照を防ぐ（Object.hasOwn 判定）
    expect(interpolatePrompt('[{{toString}}]', {})).toBe('[{{toString}}]')
    expect(interpolatePrompt('[{{constructor}}]', {})).toBe('[{{constructor}}]')
    expect(interpolatePrompt('[{{hasOwnProperty}}]', {})).toBe('[{{hasOwnProperty}}]')
  })

  it('プロトタイプ名でも自身のプロパティとして値があれば置換する', () => {
    expect(interpolatePrompt('[{{toString}}]', { toString: 'X' })).toBe('[X]')
  })
})
