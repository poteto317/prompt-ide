import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRows,
  countItems,
  embedJson,
  findArrow,
  inline,
  parseSpec,
  renderDataScript,
  renderHtml
} from '../build-manual-test-spec.mjs'

const specPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/manual-test-spec.md')

// 生成した HTML を jsdom に流し込み、ブラウザ用のスクリプトを実行する(データの script は body に残す)
const runPage = (html) => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1]
  document.body.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/, '')
  new Function(script)()
}

const SAMPLE = `# サンプル仕様書

導入の段落。

## 領域A

> 前提: テスト用フォルダを開く

### 機能1

- [ ] **AAA-001** ボタンを押す → 結果が表示される
- [ ] **AAA-002** \`a → b\` を入力する→ 変換される

### 機能2

- [ ] **AAA-003** 何もしない → 何も起きない

<!-- 要確認: これは表示されない -->

## 領域B

- [ ] **BBB-001** 開く → 開く
`

describe('findArrow', () => {
  it('最初の → の位置を返す', () => {
    expect(findArrow('手順 → 結果')).toBe(3)
  })
  it('バッククォートの中の → は区切りに数えない', () => {
    expect(findArrow('`a → b` を入力→ 結果')).toBe('`a → b` を入力'.length)
  })
  it('→ が無ければ -1', () => {
    expect(findArrow('手順だけ')).toBe(-1)
  })
})

describe('parseSpec', () => {
  it('タイトル・導入・領域・機能・前提・項目を解析し、コメントは無視する', () => {
    const spec = parseSpec(SAMPLE)
    expect(spec.title).toBe('サンプル仕様書')
    expect(spec.intro).toEqual(['導入の段落。'])
    expect(spec.areas.map((a) => a.name)).toEqual(['領域A', '領域B'])
    // 領域の直下(最初の ### より前)の前提は、名前の無い機能として持つ
    const [areaNotes, feature1, feature2] = spec.areas[0].features
    expect(areaNotes).toEqual({ name: '', notes: ['前提: テスト用フォルダを開く'], items: [] })
    expect(feature1.name).toBe('機能1')
    expect(feature1.items[0]).toEqual({
      id: 'AAA-001',
      step: 'ボタンを押す',
      expect: '結果が表示される'
    })
    expect(feature1.items[1]).toEqual({
      id: 'AAA-002',
      step: '`a → b` を入力する',
      expect: '変換される'
    })
    expect(feature2.items.map((i) => i.id)).toEqual(['AAA-003'])
  })

  it('機能の見出しが無い領域でも項目を持てる', () => {
    const spec = parseSpec(SAMPLE)
    expect(spec.areas[1].features).toHaveLength(1)
    expect(spec.areas[1].features[0].name).toBe('')
    expect(spec.areas[1].features[0].items[0].id).toBe('BBB-001')
  })

  it.each([
    ['ID の重複', '## A\n- [ ] **AAA-001** a → b\n- [ ] **AAA-001** c → d\n', 'ID が重複'],
    ['→ が無い', '## A\n- [ ] **AAA-001** 手順だけ\n', '「→」で手順と期待結果を区切って'],
    ['期待結果が空', '## A\n- [ ] **AAA-001** 手順 →\n', '手順と期待結果の両方'],
    ['ID の書式が不正', '## A\n- [ ] **A-1** a → b\n', 'チェック項目の書式が不正'],
    ['領域より前の項目', '- [ ] **AAA-001** a → b\n', '領域'],
    ['領域より前の機能', '### 機能\n', '領域']
  ])('不正な仕様書を拒否する: %s', (_, markdown, message) => {
    expect(() => parseSpec(markdown)).toThrow(message)
  })

  it('チェック済みの [x] で書かれた項目も項目として読む', () => {
    const spec = parseSpec('## A\n- [x] **AAA-001** a → b\n')
    expect(spec.areas[0].features[0].items).toHaveLength(1)
  })
})

const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)
const BS = String.fromCharCode(92)

describe('buildRows', () => {
  it('領域・機能・前提・項目を 1 行 1 件の行の列にする(機能ごとに f → n → i の順)', () => {
    const rows = buildRows(parseSpec(SAMPLE))
    expect(rows).toEqual([
      ['a', '領域A'],
      ['f', ''],
      ['n', '前提: テスト用フォルダを開く'],
      ['f', '機能1'],
      ['i', 'AAA-001', 'ボタンを押す', '結果が表示される'],
      ['i', 'AAA-002', '`a → b` を入力する', '変換される'],
      ['f', '機能2'],
      ['i', 'AAA-003', '何もしない', '何も起きない'],
      ['a', '領域B'],
      ['f', ''],
      ['i', 'BBB-001', '開く', '開く']
    ])
  })
  it('countItems は項目の数を返す', () => {
    expect(countItems(parseSpec(SAMPLE))).toBe(4)
  })
})

describe('embedJson', () => {
  it('< と U+2028・U+2029 を ASCII のエスケープにし、JSON.parse で元に戻る', () => {
    const original = { text: `</script><!--${LS}${PS}` }
    const embedded = embedJson(JSON.stringify(original))
    expect(embedded).not.toContain('<')
    expect(embedded).not.toContain(LS)
    expect(embedded).not.toContain(PS)
    expect(embedded).toContain(`${BS}u003c`)
    expect(JSON.parse(embedded)).toEqual(original)
  })
})

describe('renderDataScript', () => {
  it('total と、1 行 1 件の行を持つ JSON を、application/json の script に入れる', () => {
    const script = renderDataScript(parseSpec(SAMPLE))
    expect(script.startsWith('<script type="application/json" id="spec-data">\n')).toBe(true)
    expect(script.endsWith('\n</script>')).toBe(true)
    const body = script.slice(script.indexOf('\n') + 1, script.lastIndexOf('\n</script>'))
    const lines = body.split('\n')
    expect(lines[0]).toBe('{"total":4,"rows":[')
    expect(lines.at(-1)).toBe(']}')
    // 行は 1 行 1 件(最後以外は行末にカンマ)
    const rowLines = lines.slice(1, -1)
    expect(rowLines).toHaveLength(11)
    for (const [index, line] of rowLines.entries()) {
      const json = index === rowLines.length - 1 ? line : line.replace(/,$/, '')
      expect(['a', 'f', 'n', 'i']).toContain(JSON.parse(json)[0])
    }
    const parsed = JSON.parse(body)
    expect(parsed.rows).toEqual(buildRows(parseSpec(SAMPLE)))
  })
})

describe('renderHtml', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })
  const mountText = (markdown, transform = (html) => html) => {
    const html = transform(renderHtml(parseSpec(markdown)))
    runPage(html)
    return html
  }

  it('<title> と <h1> と導入の段落はエスケープして HTML に書き、導入のコードは <code> にする', () => {
    const html = renderHtml(
      parseSpec('# T<script>\n\n導入の `<i>` です。\n\n## A\n- [ ] **AAA-001** a → b\n')
    )
    expect(html).toContain('<title>T&lt;script&gt;</title>')
    expect(html).toContain('<h1>T&lt;script&gt;</h1>')
    expect(html).toContain('<p class="intro">導入の <code>&lt;i&gt;</code> です。</p>')
  })

  it('領域名・機能名・前提・手順・期待結果の特殊文字はテキストとして出て、コードは <code> になる', () => {
    mountText(
      '## A&B `x`\n### 機能 `<u>`\n> 前提 `<s>`\n- [ ] **AAA-001** `<b>` を入力 → "ok" になる\n'
    )
    expect(document.querySelector('.area__name').textContent).toBe('A&B x')
    expect(document.querySelector('.area__name code').textContent).toBe('x')
    expect(document.querySelector('.feature__title').textContent).toBe('機能 <u>')
    expect(document.querySelector('.note').textContent).toBe('前提 <s>')
    expect(document.querySelector('.item__step code').textContent).toBe('<b>')
    expect(document.querySelector('.item__expect').textContent).toContain('"ok" になる')
    expect(document.querySelector('b')).toBeNull()
    expect(document.querySelector('u')).toBeNull()
    expect(document.querySelector('s')).toBeNull()
  })

  it('期待結果の中のバッククォートも <code> になり、ビルド側の inline と同じ結果になる', () => {
    const expectText = '`<i>` と `x` が出る'
    mountText(`## A\n- [ ] **AAA-001** 開く → ${expectText}\n`)
    const codes = [...document.querySelectorAll('.item__expect code')].map((c) => c.textContent)
    expect(codes).toEqual(['<i>', 'x'])
    expect(document.querySelector('.item__expect').innerHTML).toContain(inline(expectText))
  })

  it('バッククォートが奇数個・2 つ続く本文でも、現行の inline と同じ <code> の数とテキストにする', () => {
    const body = '`a` と `` と `b と `c` d`'
    mountText(`## A\n- [ ] **AAA-001** ${body} → ok\n`)
    const codes = [...document.querySelectorAll('.item__step code')].map((c) => c.textContent)
    // ビルド側の inline(導入・見出しに使う)と、ブラウザ側の描画が同じ結果になる
    expect(document.querySelector('.item__step').innerHTML).toBe(inline(body))
    expect(codes).toEqual([...body.matchAll(/`([^`]+)`/g)].map((m) => m[1]))
    expect(document.querySelector('.item__step').textContent).toBe(body.replace(/`([^`]+)`/g, '$1'))
  })

  it('現行の DOM と同じ要素・クラス・属性を作る(名前の無い機能には見出しを出さない)', () => {
    mountText(SAMPLE)
    expect(document.querySelectorAll('details.area[open]')).toHaveLength(2)
    // #root の直下は 見出し → 導入 → 進捗バー → 領域 → 空の表示 の順(領域は #empty より前)
    expect(
      [...document.getElementById('root').children].map(
        (c) => c.tagName + (c.className ? `.${c.className}` : '')
      )
    ).toEqual(['H1', 'P.intro', 'DIV.bar', 'DETAILS.area', 'DETAILS.area', 'P.empty'])
    expect(document.querySelectorAll('section.feature')).toHaveLength(4)
    // 名前のある機能(機能1・機能2)にだけ h3
    expect([...document.querySelectorAll('.feature__title')].map((h) => h.textContent)).toEqual([
      '機能1',
      '機能2'
    ])
    expect(document.querySelectorAll('p.note')).toHaveLength(1)
    expect(document.querySelectorAll('ul.items')).toHaveLength(4)
    const item = document.querySelector('li.item[data-id="AAA-001"]')
    expect(item.querySelector('label.item__label')).not.toBeNull()
    const box = item.querySelector('input.item__check[type="checkbox"]')
    expect(box.id).toBe('chk-AAA-001')
    expect(box.getAttribute('data-id')).toBe('AAA-001')
    expect(item.querySelector('.item__body .item__id').textContent).toBe('AAA-001')
    expect(item.querySelector('.item__arrow').getAttribute('aria-hidden')).toBe('true')
    expect(item.querySelector('.item__expect .visually-hidden').textContent).toBe('期待結果: ')
    expect(document.querySelector('summary.area__summary .area__name').textContent).toBe('領域A')
    expect(document.querySelector('details.area[data-area="0"]')).not.toBeNull()
    expect(document.querySelector('details.area[data-area="1"]')).not.toBeNull()
    expect(document.querySelector('[data-area-count="1"]').textContent).toBe('0 / 1')
  })

  it('機能の中は 見出し → 前提 → 項目の順に並ぶ', () => {
    mountText('## A\n### 機能\n- [ ] **AAA-001** a → b\n> 前提\n')
    const children = [...document.querySelector('section.feature').children]
    expect(children.map((c) => c.tagName + (c.className ? `.${c.className}` : ''))).toEqual([
      'H3.feature__title',
      'P.note',
      'UL.items'
    ])
  })

  it('本文に </script>・<!--・U+2028 があってもページが壊れず、データとして読み出せる', () => {
    // U+2028・U+2029 は行末に置くと parseSpec の trim で削られるため、行の途中に置く
    const body = `</script><script>window.__x=1</script><!-- ${LS}${PS} x`
    const html = renderHtml(parseSpec(`## A ${body}\n- [ ] **AAA-001** a → b\n`))
    // エスケープしていなければ、最初の </script> でデータが途切れる
    const dataEnd = html.indexOf('</script>', html.indexOf('id="spec-data"'))
    expect(html.slice(html.indexOf('id="spec-data"'), dataEnd)).toContain('AAA-001')
    mountText(`## A ${body}\n- [ ] **AAA-001** a → b\n`)
    expect(document.querySelector('.area__name').textContent).toBe(`A ${body}`)
  })

  it('ページに埋めた JSON は buildRows の出力と同じで、描画スクリプトより前にある', () => {
    const html = renderHtml(parseSpec(SAMPLE))
    const body = /id="spec-data">\n([\s\S]*?)\n<\/script>/.exec(html)[1]
    expect(JSON.parse(body).rows).toEqual(buildRows(parseSpec(SAMPLE)))
    expect(html.indexOf('id="spec-data"')).toBeLessThan(html.indexOf('<script>'))
  })

  it('データが壊れているとき、#root の中身を失敗の 1 文に置き換え、原因を console.error に残す', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mountText(SAMPLE, (html) => html.replace('{"total":4,"rows":[', '{"total":4,"rows":[,,'))
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
    expect(document.getElementById('root').textContent).toBe(
      'ページを表示できませんでした。仕様書を作り直してください'
    )
  })

  it('領域より前の項目など、行の種類や並びが不正なとき、失敗の 1 文に置き換える', () => {
    mountText(SAMPLE, (html) =>
      html.replace('{"total":4,"rows":[', '{"total":4,"rows":[["i","AAA-001","a","b"],')
    )
    expect(document.getElementById('root').textContent).toContain('ページを表示できませんでした')
    mountText(SAMPLE, (html) => html.replace('{"total":4,"rows":[', '{"total":4,"rows":[["x"],'))
    expect(document.getElementById('root').textContent).toContain('ページを表示できませんでした')
  })

  it('描画の後の初期化で投げても、失敗の 1 文に置き換え、描いた項目は残らない', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // 描画の後の refresh が #done を引いて投げる
      mountText(SAMPLE, (html) => html.replace('id="done"', 'id="x"'))
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
    expect(document.getElementById('root').textContent).toBe(
      'ページを表示できませんでした。仕様書を作り直してください'
    )
    expect(document.querySelectorAll('.item__check')).toHaveLength(0)
  })

  it('total と描画した項目の数が違うとき、失敗の 1 文に置き換える', () => {
    mountText(SAMPLE, (html) => html.replace('{"total":4,', '{"total":5,'))
    expect(document.getElementById('root').textContent).toContain('ページを表示できませんでした')
  })
})

describe('生成した HTML のチェック動作', () => {
  let storage
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
  beforeEach(() => {
    storage = {}
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key) => (key in storage ? storage[key] : null),
        setItem: (key, value) => {
          storage[key] = String(value)
        }
      }
    })
  })
  afterEach(() => {
    document.body.innerHTML = ''
    if (original) Object.defineProperty(window, 'localStorage', original)
    else delete window.localStorage
  })

  const mount = (transform = (html) => html, spec = SAMPLE) => {
    runPage(transform(renderHtml(parseSpec(spec))))
  }
  const box = (id) => document.getElementById(`chk-${id}`)

  it('項目ごとの ID を持つチェックボックスと、全体の件数を表示する', () => {
    mount()
    expect(document.querySelectorAll('.item__check')).toHaveLength(4)
    expect(document.getElementById('total').textContent).toBe('4')
    expect(document.getElementById('meter').getAttribute('aria-valuemax')).toBe('4')
    expect(document.getElementById('done').textContent).toBe('0')
  })

  it('チェックすると件数・割合・領域ごとの件数が更新され、localStorage に ID で保存される', () => {
    mount()
    box('AAA-001').click()
    expect(document.getElementById('done').textContent).toBe('1')
    expect(document.getElementById('percent').textContent).toBe('25%')
    expect(document.getElementById('fill').style.width).toBe('25%')
    expect(document.querySelector('[data-area-count="0"]').textContent).toBe('1 / 3')
    expect(JSON.parse(storage['manual-test-spec:v1'])).toEqual({ 'AAA-001': true })
  })

  it('外すと保存から消える', () => {
    mount()
    box('AAA-001').click()
    box('AAA-001').click()
    expect(JSON.parse(storage['manual-test-spec:v1'])).toEqual({})
    expect(document.getElementById('done').textContent).toBe('0')
  })

  it('保存済みの状態を ID から復元する(仕様書が更新されても ID が同じなら残る)', () => {
    storage['manual-test-spec:v1'] = JSON.stringify({ 'AAA-002': true, 'ZZZ-999': true })
    mount()
    expect(box('AAA-002').checked).toBe(true)
    expect(box('AAA-001').checked).toBe(false)
    expect(document.getElementById('done').textContent).toBe('1')
  })

  describe('localStorage が使えない環境', () => {
    const denyStorage = (define) => {
      Object.defineProperty(window, 'localStorage', { configurable: true, ...define })
    }
    const denied = () => {
      throw new Error('denied')
    }
    const warn = () => document.getElementById('storage-warn').style.display

    it('保存できる環境では警告を出さない', () => {
      mount()
      box('AAA-001').click()
      expect(warn()).toBe('none')
    })

    it.each([
      ['window.localStorage の取得が投げる', { get: denied }, 'block'],
      ['getItem が投げる', { value: { getItem: denied, setItem: () => {} } }, 'block'],
      ['setItem が投げる(容量超過など)', { value: { getItem: () => null, setItem: denied } }, '']
    ])('%s とき、項目は表示され、メモリ上でチェックでき、警告を出す', (_, define, initial) => {
      denyStorage(define)
      mount()
      expect(document.querySelectorAll('.item__check')).toHaveLength(4)
      // 読み出しの時点で使えないと分かる環境では、チェックする前から警告を出す
      expect(warn()).toBe(initial)
      box('AAA-001').click()
      expect(document.getElementById('done').textContent).toBe('1')
      expect(warn()).toBe('block')
    })
  })

  it.each(['null', '"x"', '[1]', '{'])(
    '保存データが %s のように壊れていても、項目は表示され、チェックできる',
    (raw) => {
      storage['manual-test-spec:v1'] = raw
      mount()
      expect(document.querySelectorAll('.item__check')).toHaveLength(4)
      expect(document.getElementById('root').textContent).not.toContain(
        'ページを表示できませんでした'
      )
      box('AAA-001').click()
      expect(JSON.parse(storage['manual-test-spec:v1'])).toEqual({ 'AAA-001': true })
    }
  )

  it('「すべて未確認に戻す」は確認を挟み、キャンセルすると何も変わらない', () => {
    mount()
    box('AAA-001').click()
    document.getElementById('reset').click()
    expect(document.getElementById('confirm').hidden).toBe(false)
    document.getElementById('confirm-no').click()
    expect(document.getElementById('confirm').hidden).toBe(true)
    expect(box('AAA-001').checked).toBe(true)
    document.getElementById('reset').click()
    document.getElementById('confirm-yes').click()
    expect(document.getElementById('confirm').hidden).toBe(true)
    expect(box('AAA-001').checked).toBe(false)
    expect(JSON.parse(storage['manual-test-spec:v1'])).toEqual({})
  })

  it('「未確認のみ表示」で hide-done が切り替わる', () => {
    mount()
    const toggle = document.getElementById('toggle-done')
    toggle.click()
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(document.getElementById('root').classList.contains('hide-done')).toBe(true)
    toggle.click()
    expect(document.getElementById('root').classList.contains('hide-done')).toBe(false)
  })

  it('すべてチェックすると all-done になる', () => {
    mount()
    const root = document.getElementById('root')
    box('AAA-001').click()
    expect(root.classList.contains('all-done')).toBe(false)
    document.querySelectorAll('.item__check').forEach((c) => {
      if (!c.checked) c.click()
    })
    expect(root.classList.contains('all-done')).toBe(true)
    expect(document.getElementById('meter').getAttribute('aria-valuenow')).toBe('4')
    // 領域の全件が確認済みになると data-done が true、1 件でも欠ければ false
    expect(document.querySelector('[data-area-count="0"]').getAttribute('data-done')).toBe('true')
    box('AAA-003').click()
    expect(document.querySelector('[data-area-count="0"]').getAttribute('data-done')).toBe('false')
  })
})

describe('docs/manual-test-spec.md(実物)', () => {
  const spec = parseSpec(readFileSync(specPath, 'utf-8'))
  const items = spec.areas.flatMap((a) => a.features.flatMap((f) => f.items))

  it('解析でき、領域と項目がある', () => {
    expect(spec.areas.length).toBeGreaterThan(0)
    expect(items.length).toBeGreaterThan(0)
  })

  it('ID は一意で、接頭辞ごとに連番が 1 以上の昇順(欠番は許容する)', () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
    for (const area of spec.areas) {
      const byPrefix = new Map()
      for (const item of area.features.flatMap((f) => f.items)) {
        const [prefix, number] = item.id.split('-')
        byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), Number(number)])
      }
      for (const [prefix, numbers] of byPrefix) {
        expect(numbers[0], `${area.name} の ${prefix}`).toBeGreaterThanOrEqual(1)
        numbers.slice(1).forEach((n, i) => {
          expect(n, `${area.name} の ${prefix}`).toBeGreaterThan(numbers[i])
        })
      }
    }
  })

  it('同じ接頭辞は 1 つの領域だけで使う', () => {
    const owner = new Map()
    for (const area of spec.areas) {
      for (const item of area.features.flatMap((f) => f.items)) {
        const prefix = item.id.split('-')[0]
        expect(owner.get(prefix) ?? area.name, prefix).toBe(area.name)
        owner.set(prefix, area.name)
      }
    }
  })

  it('すべての項目に手順と期待結果がある', () => {
    for (const item of items) {
      expect(item.step, item.id).not.toBe('')
      expect(item.expect, item.id).not.toBe('')
    }
  })

  it('生成した HTML は、枠が小さく(HTML − データ JSON ≤ 40,000 バイト)、md の 1.1 倍以下で、最長の行が 4,000 バイト以下', () => {
    const markdown = readFileSync(specPath, 'utf-8')
    const html = renderHtml(parseSpec(markdown))
    const data = renderDataScript(parseSpec(markdown))
    const bytes = (text) => Buffer.byteLength(text, 'utf-8')
    expect(bytes(html) - bytes(data)).toBeLessThanOrEqual(40000)
    expect(bytes(html)).toBeLessThanOrEqual(bytes(markdown) * 1.1)
    const longest = Math.max(...html.split('\n').map(bytes))
    expect(longest).toBeLessThanOrEqual(4000)
  })

  it('ブラウザ側の描画が失敗せず、すべての項目を描く', () => {
    const spec = parseSpec(readFileSync(specPath, 'utf-8'))
    runPage(renderHtml(spec))
    try {
      expect(document.getElementById('root').textContent).not.toContain(
        'ページを表示できませんでした'
      )
      expect(document.querySelectorAll('.item__check')).toHaveLength(countItems(spec))
      expect(document.querySelectorAll('details.area')).toHaveLength(spec.areas.length)
      // 領域ごとの項目の並びと、機能・前提の数が、解析の結果と一致する
      spec.areas.forEach((area, index) => {
        const ids = [
          ...document.querySelectorAll(`details.area[data-area="${index}"] .item__check`)
        ]
        expect(ids.map((box) => box.getAttribute('data-id'))).toEqual(
          area.features.flatMap((f) => f.items.map((item) => item.id))
        )
      })
      const features = spec.areas.flatMap((a) => a.features)
      expect(document.querySelectorAll('section.feature')).toHaveLength(features.length)
      expect(document.querySelectorAll('.feature__title')).toHaveLength(
        features.filter((f) => f.name !== '').length
      )
      expect(document.querySelectorAll('p.note')).toHaveLength(
        features.reduce((n, f) => n + f.notes.length, 0)
      )
      // 手順と期待結果の文字が、バッククォートを外した素のテキストと一致する
      const rows = new Map(
        [...document.querySelectorAll('li.item')].map((li) => [li.getAttribute('data-id'), li])
      )
      const plain = (text) => text.replace(/`([^`]+)`/g, '$1')
      for (const item of features.flatMap((f) => f.items)) {
        const li = rows.get(item.id)
        expect(li.querySelector('.item__step').textContent, item.id).toBe(plain(item.step))
        expect(li.querySelector('.item__expect').textContent, item.id).toBe(
          `→期待結果: ${plain(item.expect)}`
        )
      }
    } finally {
      document.body.innerHTML = ''
    }
  })

  it('U+2028・U+2029 の文字をソースに含めない', () => {
    for (const file of ['../build-manual-test-spec.mjs', './build-manual-test-spec.test.mjs']) {
      const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), file), 'utf-8')
      expect(source.includes(String.fromCharCode(0x2028)), file).toBe(false)
      expect(source.includes(String.fromCharCode(0x2029)), file).toBe(false)
    }
  })
})
