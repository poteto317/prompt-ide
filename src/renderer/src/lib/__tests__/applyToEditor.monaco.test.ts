import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
// 実物の Monaco(@monaco-editor/react ではなく monaco-editor 本体)。editor.main は全言語と worker を読み込むため、
// 言語を含まない editor.api を使う
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { applyToEditor } from '../applyToEditor'

// jsdom で Monaco のエディタを作るのに足りないもの(プラン作成時に実測): matchMedia(テーマの判定)と
// canvas の 2D コンテキスト(文字幅の計測・概観ルーラーの描画)。描画の結果は検査しないため、何もしない偽物で足りる
beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      new Proxy(
        {},
        {
          get: (_target, key) =>
            key === 'measureText' ? (text: string) => ({ width: text.length * 8 }) : () => {}
        }
      ) as unknown as CanvasRenderingContext2D
  )
})

afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const created: { editor: monaco.editor.IStandaloneCodeEditor; model: monaco.editor.ITextModel }[] =
  []

afterEach(() => {
  for (const { editor, model } of created.splice(0)) {
    editor.dispose()
    model.dispose()
  }
  document.body.innerHTML = ''
})

function createEditor(
  text: string,
  options: monaco.editor.IStandaloneEditorConstructionOptions = {}
): { editor: monaco.editor.IStandaloneCodeEditor; model: monaco.editor.ITextModel } {
  const model = monaco.editor.createModel(text, 'plaintext')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const editor = monaco.editor.create(container, { model, automaticLayout: false, ...options })
  created.push({ editor, model })
  return { editor, model }
}

const undo = (editor: monaco.editor.IStandaloneCodeEditor): void =>
  editor.trigger('test', 'undo', null)
const redo = (editor: monaco.editor.IStandaloneCodeEditor): void =>
  editor.trigger('test', 'redo', null)
const type = (editor: monaco.editor.IStandaloneCodeEditor, text: string): void =>
  editor.trigger('keyboard', 'type', { text })

describe('applyToEditor(実物の Monaco)', () => {
  it('カーソル位置に挿入し、カーソルを挿入したテキストの末尾に置く', () => {
    const { editor, model } = createEditor('abc\ndef')
    editor.setSelection(new monaco.Selection(1, 2, 1, 2))

    expect(applyToEditor(editor, 'insert', 'XY\nZ')).toBe('applied')

    expect(model.getValue()).toBe('aXY\nZbc\ndef')
    expect(editor.getSelection()?.toString()).toBe(new monaco.Selection(2, 2, 2, 2).toString())
  })

  it('選択範囲があるときの挿入は、カーソルの位置に入れて選択された文字列を残し、選択を解除する', () => {
    const { editor, model } = createEditor('abcdef')
    // 前向きの選択 b〜d(カーソルは d の後ろ)
    editor.setSelection(new monaco.Selection(1, 2, 1, 5))

    applyToEditor(editor, 'insert', 'XY')

    expect(model.getValue()).toBe('abcdXYef')
    expect(editor.getSelection()?.isEmpty()).toBe(true)
    expect(editor.getPosition()?.toString()).toBe('(1,7)')
  })

  it('選択範囲を置換する(後ろ向きの選択でも)', () => {
    const { editor, model } = createEditor('hello world')
    editor.setSelection(new monaco.Selection(1, 6, 1, 1))

    expect(applyToEditor(editor, 'replace', 'HI')).toBe('applied')

    expect(model.getValue()).toBe('HI world')
    expect(editor.getPosition()?.toString()).toBe('(1,3)')
  })

  it('1 回の undo で反映の前に戻り、選択範囲も戻る', () => {
    const { editor, model } = createEditor('hello world')
    editor.setSelection(new monaco.Selection(1, 1, 1, 6))

    applyToEditor(editor, 'replace', 'HI\nTHERE')
    undo(editor)

    expect(model.getValue()).toBe('hello world')
    expect(editor.getSelection()?.toString()).toBe(new monaco.Selection(1, 1, 1, 6).toString())
  })

  it('undo → redo の後も、カーソルは挿入したテキストの末尾で選択は空(打鍵で反映が消えない)', () => {
    const { editor, model } = createEditor('abcdef')
    // 前向きの選択 b〜d(カーソルは d の後ろ)
    editor.setSelection(new monaco.Selection(1, 2, 1, 5))

    applyToEditor(editor, 'insert', 'XY')
    undo(editor)
    redo(editor)

    expect(model.getValue()).toBe('abcdXYef')
    expect(editor.getSelection()?.toString()).toBe(new monaco.Selection(1, 7, 1, 7).toString())
    type(editor, 'q')
    expect(model.getValue()).toBe('abcdXYqef')
  })

  it('選択範囲の置換も、undo → redo の後はカーソルが置換したテキストの末尾で選択は空', () => {
    const { editor, model } = createEditor('const a = 1')
    editor.setSelection(new monaco.Selection(1, 7, 1, 12))

    applyToEditor(editor, 'replace', 'X\nY')
    undo(editor)
    expect(editor.getSelection()?.toString()).toBe(new monaco.Selection(1, 7, 1, 12).toString())
    redo(editor)

    expect(model.getValue()).toBe('const X\nY')
    expect(editor.getSelection()?.toString()).toBe(new monaco.Selection(2, 2, 2, 2).toString())
    type(editor, 'q')
    expect(model.getValue()).toBe('const X\nYq')
  })

  it('直前の入力とは別の undo になる(前の pushUndoStop が無いと入力とまとめて戻る)', () => {
    const { editor, model } = createEditor('abc')
    editor.setSelection(new monaco.Selection(1, 4, 1, 4))
    type(editor, 'q')

    applyToEditor(editor, 'insert', 'ZZ')
    undo(editor)

    expect(model.getValue()).toBe('abcq')
  })

  it('2 回の反映は 2 回の undo で 1 つずつ戻る', () => {
    const { editor, model } = createEditor('')

    applyToEditor(editor, 'insert', 'A')
    applyToEditor(editor, 'insert', 'B')
    expect(model.getValue()).toBe('AB')
    undo(editor)
    expect(model.getValue()).toBe('A')
    undo(editor)
    expect(model.getValue()).toBe('')
  })

  it('モデルの改行コードが CRLF なら、\\n のテキストも CRLF で入る', () => {
    const { editor, model } = createEditor('a\r\nb')
    editor.setSelection(new monaco.Selection(1, 2, 1, 2))

    applyToEditor(editor, 'insert', 'X\nY')

    expect(model.getValue()).toBe('aX\r\nY\r\nb')
    expect(editor.getPosition()?.toString()).toBe('(2,2)')
  })

  it('複数カーソルのときは主カーソルの選択範囲だけを置換する', () => {
    const { editor, model } = createEditor('aaa\nbbb\nccc')
    // 先頭の選択が主カーソル
    editor.setSelections([new monaco.Selection(2, 1, 2, 2), new monaco.Selection(1, 1, 1, 3)])

    applyToEditor(editor, 'replace', 'X')

    expect(model.getValue()).toBe('aaa\nXbb\nccc')
  })

  it('複数カーソルで反映すると選択は 1 つ(反映したテキストの末尾)になり、undo で元の複数のカーソルが戻る', () => {
    // endCursorState が選択を 1 つだけ返すため、主カーソル以外は解除される(null を返すと他のカーソルが残る。PR #45 で実測)
    const { editor, model } = createEditor('aaa\nbbb\nccc')
    const before = [new monaco.Selection(1, 1, 1, 2), new monaco.Selection(2, 4, 2, 4)]
    editor.setSelections(before)

    applyToEditor(editor, 'replace', 'X')

    expect(model.getValue()).toBe('Xaa\nbbb\nccc')
    expect(editor.getSelections()?.map(String)).toEqual([
      new monaco.Selection(1, 2, 1, 2).toString()
    ])

    undo(editor)

    expect(model.getValue()).toBe('aaa\nbbb\nccc')
    expect(editor.getSelections()?.map(String)).toEqual(before.map(String))
  })

  // 表示範囲は、editor.layout で大きさを決めると jsdom でも getVisibleRanges・getScrollTop で観測できる(実測)。
  // minimap は切る(付けると、破棄の後にミニマップの描画が走り、未処理のエラーが出る)
  const createSizedEditor = (text: string): monaco.editor.IStandaloneCodeEditor => {
    const { editor } = createEditor(text, { minimap: { enabled: false } })
    editor.layout({ width: 400, height: 200 })
    return editor
  }
  const lines = (count: number, prefix: string): string =>
    Array.from({ length: count }, (_, i) => `${prefix}${i}`).join('\n')
  const visibleLineRange = (editor: monaco.editor.IStandaloneCodeEditor): [number, number] => {
    const ranges = editor.getVisibleRanges()
    return [ranges[0].startLineNumber, ranges[ranges.length - 1].endLineNumber]
  }

  it('エディタより長いテキストを挿入すると、挿入の末尾(カーソル)が見える位置までスクロールする(貼り付けと同じ)', () => {
    // 1 行目にカーソル、下に 100 行ある。挿入の末尾は 60 行目で、最初の表示範囲(1〜11 行目)の外
    const editor = createSizedEditor(`\n${lines(100, 't')}`)
    editor.setSelection(new monaco.Selection(1, 1, 1, 1))
    expect(visibleLineRange(editor)[1]).toBeLessThan(60)

    applyToEditor(editor, 'insert', lines(60, 'line'))

    expect(editor.getPosition()?.toString()).toBe('(60,7)')
    const [first, last] = visibleLineRange(editor)
    expect(first).toBeLessThanOrEqual(60)
    expect(last).toBeGreaterThanOrEqual(60)
  })

  it('挿入の末尾がすでに見えているなら、スクロールしない', () => {
    const editor = createSizedEditor(lines(100, 't'))
    editor.setSelection(new monaco.Selection(5, 1, 5, 1))

    applyToEditor(editor, 'insert', 'ab')

    expect(editor.getPosition()?.toString()).toBe('(5,3)')
    expect(editor.getScrollTop()).toBe(0)
  })

  it('反映の後はエディタにフォーカスがある', () => {
    const { editor } = createEditor('abc')

    applyToEditor(editor, 'insert', 'X')

    expect(editor.hasTextFocus()).toBe(true)
  })

  it('読み取り専用のエディタは rejected で、内容を変えない', () => {
    const { editor, model } = createEditor('abc', { readOnly: true })

    expect(applyToEditor(editor, 'insert', 'X')).toBe('rejected')

    expect(model.getValue()).toBe('abc')
  })

  it('破棄済みのエディタは unavailable で、何もしない', () => {
    const { editor, model } = createEditor('abc')
    editor.dispose()

    expect(applyToEditor(editor, 'insert', 'X')).toBe('unavailable')

    expect(model.getValue()).toBe('abc')
  })
})
