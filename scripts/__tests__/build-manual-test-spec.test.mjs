import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findArrow, parseSpec, renderHtml } from '../build-manual-test-spec.mjs'

const specPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/manual-test-spec.md')

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

describe('renderHtml', () => {
  it('HTML の特殊文字をエスケープし、コードを <code> にする', () => {
    const html = renderHtml(
      parseSpec('# T<script>\n## A&B\n- [ ] **AAA-001** `<b>` を入力 → "ok" になる\n')
    )
    expect(html).toContain('<title>T&lt;script&gt;</title>')
    expect(html).toContain('A&amp;B')
    expect(html).toContain('<code>&lt;b&gt;</code>')
    expect(html).toContain('&quot;ok&quot;')
    expect(html).not.toContain('<b>')
  })
})

describe('生成した HTML のチェック動作', () => {
  let storage
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
  })

  const mount = () => {
    const html = renderHtml(parseSpec(SAMPLE))
    const script = /<script>([\s\S]*)<\/script>/.exec(html)[1]
    document.body.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '')
    new Function(script)()
  }
  const box = (id) => document.getElementById(`chk-${id}`)

  it('項目ごとの ID を持つチェックボックスと、全体の件数を表示する', () => {
    mount()
    expect(document.querySelectorAll('.item__check')).toHaveLength(4)
    expect(document.getElementById('total').textContent).toBe('4')
    expect(document.getElementById('done').textContent).toBe('0')
  })

  it('チェックすると件数・割合・領域ごとの件数が更新され、localStorage に ID で保存される', () => {
    mount()
    box('AAA-001').click()
    expect(document.getElementById('done').textContent).toBe('1')
    expect(document.getElementById('percent').textContent).toBe('25%')
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
    document.querySelectorAll('.item__check').forEach((c) => c.click())
    expect(document.getElementById('root').classList.contains('all-done')).toBe(true)
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
})
