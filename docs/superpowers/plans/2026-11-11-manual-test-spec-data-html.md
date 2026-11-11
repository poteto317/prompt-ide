# 実機テスト仕様書の HTML のデータ駆動化 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `scripts/build-manual-test-spec.mjs` が作る HTML を、項目を JSON で持ち、ブラウザの JavaScript で描く形に変え、約 1.57MB のファイルを約 0.67MB にする。

**Architecture:** `parseSpec` の結果を、1 行 1 件の「行の列」（`a`・`f`・`n`・`i`）にして `<script type="application/json" id="spec-data">` に埋め込む。同じページの `<script>`（属性なし）が JSON を読んで DOM を作り、既存のチェック・保存・リセットの動作を引き継ぐ。ビルド側は `<title>`・`<h1>`・導入・進捗バーの枠だけを HTML で出す。

**Tech Stack:** Node.js（ESM）、Vitest（jsdom 環境で `scripts/__tests__` を実行）。

設計書: `docs/superpowers/specs/2026-11-11-manual-test-spec-data-html-design.md`（以下「設計書」）。

## Global Constraints

- チェック状態の保存: localStorage のキー `manual-test-spec:v1`、値 `{ "<ID>": true }`。キーも ID の書式も変えない（L-455）。
- 描画側は `innerHTML` を使わない。文字列は `textContent` と `createElement` で入れる。
- 描画側のコードの区切りは、現行の `inline` と同じ正規表現 ``/`([^`]+)`/g`` と等価にする。
- **U+2028・U+2029 の文字そのものを、`build-manual-test-spec.mjs` とテストファイルのソースに書かない。** `String.fromCharCode(0x2028)`・`String.fromCharCode(0x2029)` で作る。バックスラッシュも `String.fromCharCode(92)` で作る（`<` のような表記をシェルや書き込みの経由で書くと、文字そのものに変わる事故が起きるため）。
- 描画スクリプトの中に、バッククォートと `${` を書かない（テンプレートリテラルの中に入れるため）。バッククォートは `String.fromCharCode(96)` で作る。
- 描画スクリプトに `</script>` を書かない。
- 後始末で再帰削除をしない（L-618）。テストは `document.body.innerHTML = ''` で後始末する。
- 検証コマンド: `NODE_ENV=test npx vitest run scripts`、`npx prettier --check scripts`、`npx eslint scripts`（eslint の対象でなければ省略してよいが、ruleset に含まれる場合は通す）。

## ファイル構成

- 変更: `scripts/build-manual-test-spec.mjs`（データの組み立て・埋め込みのエスケープ・描画スクリプト・`renderHtml`）
- 変更: `scripts/__tests__/build-manual-test-spec.test.mjs`
- 変更: `docs/developer-guide.md`（1 文）
- 再生成（git 管理外）: `.superpowers/manual-test-spec.html`

---

### Task 1: データの組み立てと埋め込みのエスケープ

**Files:**

- Modify: `scripts/build-manual-test-spec.mjs`
- Modify: `scripts/__tests__/build-manual-test-spec.test.mjs`

**Interfaces:**

- Produces: `export function buildRows(spec)`（`[['a',名前],['f',名前],['n',本文],['i',ID,手順,期待結果],…]`）、`export function embedJson(text)`、`export function renderDataScript(spec)`（`<script type="application/json" id="spec-data">…</script>` の文字列）、`export function countItems(spec)`。
- Consumes: 既存の `parseSpec` の戻り値 `{ title, intro, areas:[{ name, features:[{ name, notes, items:[{id,step,expect}] }] }] }`。

- [ ] **Step 1: 失敗するテストを書く**

`build-manual-test-spec.test.mjs` の import を `import { buildRows, countItems, embedJson, findArrow, parseSpec, renderDataScript, renderHtml } from '../build-manual-test-spec.mjs'` に直し、`describe('renderHtml', …)` の前に次を足す。

```js
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
```

- [ ] **Step 2: 失敗を確認する**

Run: `NODE_ENV=test npx vitest run scripts/__tests__/build-manual-test-spec.test.mjs`
Expected: FAIL（`buildRows` などが export されていない）

- [ ] **Step 3: 実装する**

`build-manual-test-spec.mjs` の `renderItem` の定義の直前に、次を足す（既存の `renderItem`・`renderFeature`・`renderArea` はこのタスクではまだ消さない）。

```js
export function countItems(spec) {
  return spec.areas.reduce((n, a) => n + a.features.reduce((m, f) => m + f.items.length, 0), 0)
}

/** parseSpec の結果を、1 行 1 件の行の列にする。機能ごとに f → n(全件) → i(全件) の順 */
export function buildRows(spec) {
  const rows = []
  for (const area of spec.areas) {
    rows.push(['a', area.name])
    for (const feature of area.features) {
      rows.push(['f', feature.name])
      for (const note of feature.notes) rows.push(['n', note])
      for (const item of feature.items) rows.push(['i', item.id, item.step, item.expect])
    }
  }
  return rows
}

const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)
const BACKSLASH = String.fromCharCode(92)

/** JSON を <script> に埋め込める形にする。< と U+2028・U+2029 を ASCII のエスケープにする(JSON.parse で元に戻る) */
export function embedJson(text) {
  return text
    .split('<')
    .join(`${BACKSLASH}u003c`)
    .split(LINE_SEPARATOR)
    .join(`${BACKSLASH}u2028`)
    .split(PARAGRAPH_SEPARATOR)
    .join(`${BACKSLASH}u2029`)
}

/** 仕様全体を application/json の script にする。行は 1 行 1 件(長い 1 行を作らない) */
export function renderDataScript(spec) {
  const rows = buildRows(spec).map((row) => JSON.stringify(row))
  const json = `{"total":${countItems(spec)},"rows":[\n${rows.join(',\n')}\n]}`
  return `<script type="application/json" id="spec-data">\n${embedJson(json)}\n</script>`
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `NODE_ENV=test npx vitest run scripts/__tests__/build-manual-test-spec.test.mjs`
Expected: PASS（新しい 4 件を含む。既存のテストも通る）

- [ ] **Step 5: 整形・検査**

Run: `npx prettier --write scripts/build-manual-test-spec.mjs scripts/__tests__/build-manual-test-spec.test.mjs && npx eslint scripts/build-manual-test-spec.mjs scripts/__tests__/build-manual-test-spec.test.mjs`
Expected: エラーなし（eslint が対象外とするだけなら無視してよい）

---

### Task 2: 描画スクリプトと renderHtml の置き換え

**Files:**

- Modify: `scripts/build-manual-test-spec.mjs`
- Modify: `scripts/__tests__/build-manual-test-spec.test.mjs`

**Interfaces:**

- Consumes: Task 1 の `renderDataScript`・`countItems`。
- Produces: `renderHtml(spec)` が、静的な見出し・進捗バーの枠＋`#spec-data`＋描画スクリプト（`<script>` 属性なし）を返す。DOM の構造は現行の `renderItem`・`renderFeature`・`renderArea` と同じ。

- [ ] **Step 1: 失敗するテストを書く**

テストファイルで、次の 4 点を直す。

(a) `mount` を、描画スクリプトだけを取り出して実行する形にし、`#spec-data` は `innerHTML` に残す。`renderHtml` の出力を加工できるよう引数を取る。

```js
const mount = (transform = (html) => html, spec = SAMPLE) => {
  const html = transform(renderHtml(parseSpec(spec)))
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1]
  document.body.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/, '')
  new Function(script)()
}
```

(b) 既存の `describe('renderHtml', …)` を、次の内容に置き換える（HTML の文字列ではなく、描画後の DOM で確かめる）。

```js
describe('renderHtml', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })
  const mountText = (markdown, transform = (html) => html) => {
    const html = transform(renderHtml(parseSpec(markdown)))
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1]
    document.body.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/, '')
    new Function(script)()
    return html
  }

  it('<title> と <h1> と導入の段落はエスケープして HTML に書き、導入のコードは <code> にする', () => {
    const html = renderHtml(
      parseSpec('# T<script>\n\n導入の `<i>` です。\n\n## A\n- [ ] **AAA-001** a → b\n')
    )
    expect(html).toContain('<title>T&lt;script&gt;</title>')
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

  it('バッククォートが奇数個・2 つ続く本文でも、現行の inline と同じ <code> の数とテキストにする', () => {
    const body = '`a` と `` と `b と `c` d`'
    mountText(`## A\n- [ ] **AAA-001** ${body} → ok\n`)
    const codes = [...document.querySelectorAll('.item__step code')].map((c) => c.textContent)
    // 現行の inline: escapeHtml してから /`([^`]+)`/g で <code> にする
    const expected = [...body.matchAll(/`([^`]+)`/g)].map((m) => m[1])
    expect(codes).toEqual(expected)
    expect(document.querySelector('.item__step').textContent).toBe(body.replace(/`([^`]+)`/g, '$1'))
  })

  it('現行の DOM と同じ要素・クラス・属性を作る(名前の無い機能には見出しを出さない)', () => {
    mountText(SAMPLE)
    expect(document.querySelectorAll('details.area[open]')).toHaveLength(2)
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
    expect(document.querySelector('[data-area-count="1"]').textContent).toBe('0 / 1')
  })

  it('本文に </script>・<!--・U+2028 があってもページが壊れず、データとして読み出せる', () => {
    // U+2028・U+2029 は行末に置くと parseSpec の trim で削られるため、行の途中に置く
    const body = `</script><script>window.__x=1</script><!-- ${LS}${PS} x`
    const html = renderHtml(parseSpec(`## A ${body}\n- [ ] **AAA-001** a → b\n`))
    // エスケープしていなければ、最初の </script> でデータが途切れる
    const dataEnd = html.indexOf('</script>', html.indexOf('id="spec-data"'))
    expect(html.slice(html.indexOf('id="spec-data"'), dataEnd)).toContain('AAA-001')
    mountText(`## A ${body}\n- [ ] **AAA-001** a → b\n`)
    expect(window.__x).toBeUndefined()
    expect(document.querySelector('.area__name').textContent).toBe(`A ${body}`)
  })

  it('ページの JSON を読み出すと parseSpec の結果と一致する', () => {
    const html = renderHtml(parseSpec(SAMPLE))
    const body = /id="spec-data">\n([\s\S]*?)\n<\/script>/.exec(html)[1]
    expect(JSON.parse(body).rows).toEqual(buildRows(parseSpec(SAMPLE)))
    expect(html.indexOf('id="spec-data"')).toBeLessThan(html.indexOf('<script>'))
  })

  it('データが壊れているとき、#root の中身を失敗の 1 文に置き換える', () => {
    mountText(SAMPLE, (html) => html.replace('{"total":4,"rows":[', '{"total":4,"rows":[,,'))
    expect(document.getElementById('root').textContent).toBe(
      'ページを表示できませんでした。仕様書を作り直してください'
    )
  })

  it('total と描画した項目の数が違うとき、失敗の 1 文に置き換える', () => {
    mountText(SAMPLE, (html) => html.replace('{"total":4,', '{"total":5,'))
    expect(document.getElementById('root').textContent).toContain('ページを表示できませんでした')
  })
})
```

(c) `describe('docs/manual-test-spec.md(実物)', …)` の末尾に、サイズと行の検査を足す（`readFileSync` と `specPath` は既存の import を使う）。

```js
it('生成した HTML は、枠が小さく(HTML − データ JSON ≤ 40,000 バイト)、md の 1.1 倍以下で、最長の行が 4,000 バイト以下', () => {
  const markdown = readFileSync(specPath, 'utf-8')
  const html = renderHtml(parseSpec(markdown))
  const data = renderDataScript(parseSpec(markdown))
  const bytes = (text) => Buffer.byteLength(text, 'utf-8')
  expect(
    bytes(html) - bytes(data),
    'データ以外（CSS・JS・見出し）が大きくなりすぎた'
  ).toBeLessThanOrEqual(40000)
  expect(bytes(html), 'HTML が md の 1.1 倍を超えた').toBeLessThanOrEqual(bytes(markdown) * 1.1)
  // 長い 1 行は Artifact の再公開で読めないため、最長の行を上限で縛る(超えたら、その項目や前提を短くするか分ける)
  const longest = html.split('\n').reduce((a, line) => (bytes(line) > bytes(a) ? line : a), '')
  expect(bytes(longest), `最長の行(先頭: ${longest.slice(0, 80)})`).toBeLessThanOrEqual(4000)
})

it('U+2028・U+2029 の文字をソースに含めない', () => {
  for (const file of ['../build-manual-test-spec.mjs', './build-manual-test-spec.test.mjs']) {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), file), 'utf-8')
    expect(source.includes(String.fromCharCode(0x2028)), file).toBe(false)
    expect(source.includes(String.fromCharCode(0x2029)), file).toBe(false)
  }
})
```

(d) 既存の `describe('生成した HTML のチェック動作', …)` の `mount` の定義を (a) の形に置き換える（`box` はそのまま）。他のテスト本体は変えない。`dirname`・`fileURLToPath`・`resolve` は既に import されている。

- [ ] **Step 2: 失敗を確認する**

Run: `NODE_ENV=test npx vitest run scripts/__tests__/build-manual-test-spec.test.mjs`
Expected: FAIL（`renderHtml` がまだ旧形式のため、新しいテストと、`mount` を変えたチェック動作のテストが落ちる）

- [ ] **Step 3: 実装する**

> 注記: 実装後に、`renderHtml` を `PAGE_STYLE`・`PAGE_SCRIPT`・`renderShell` の定数と関数に分けた（コミット a6c0e90）。下のコードはその分け方の前の形で、描画スクリプトの中身は `PAGE_SCRIPT` と同じ。

`build-manual-test-spec.mjs` を次のとおり直す。

1. `renderItem`・`renderFeature`・`renderArea` を削除する。`inline`・`escapeHtml` は残す（導入の段落と `<title>`・`<h1>` で使う）。ファイル先頭のコメントに「項目は JSON で持ち、ブラウザで描く」旨を 1 行足す。
2. `renderHtml` の中の `total` の計算を `countItems(spec)` に置き換える。
3. `renderHtml` のテンプレートのうち、`${spec.areas.map(renderArea).join('')}` の行を削除する（`<p class="empty" id="empty">…</p>` は残す。領域は、描画スクリプトが `#empty` の直前に挿入する）。
4. テンプレートの `<p class="empty" id="empty">…</p>` の次の、`#root` を閉じる `</div>` の直後（既存の `<script>` ブロックの直前）に `${renderDataScript(spec)}` を置く。
5. 既存の `<script>…</script>` のブロック全体（`<script>` から `</script>` まで）を、次のブロックに置き換える。`<style>` はそのまま。

```js
<script>
(function () {
  var KEY = 'manual-test-spec:v1';
  var root = document.getElementById('root');
  var BT = String.fromCharCode(96);
  var CODE = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');
  function fail(error) {
    if (error && window.console) console.error(error);
    root.textContent = 'ページを表示できませんでした。仕様書を作り直してください';
  }
  function make(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function appendInline(parent, text) {
    var last = 0;
    var match;
    CODE.lastIndex = 0;
    while ((match = CODE.exec(text)) !== null) {
      if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
      parent.appendChild(make('code', '', match[1]));
      last = match.index + match[0].length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }
  function inline(tag, className, text) {
    var element = make(tag, className);
    appendInline(element, text);
    return element;
  }
  function renderItem(row) {
    var li = make('li', 'item');
    li.setAttribute('data-id', row[1]);
    var label = make('label', 'item__label');
    var box = make('input', 'item__check');
    box.type = 'checkbox';
    box.id = 'chk-' + row[1];
    box.setAttribute('data-id', row[1]);
    var body = make('span', 'item__body');
    body.appendChild(make('span', 'item__id', row[1]));
    body.appendChild(inline('span', 'item__step', row[2]));
    var expect = make('span', 'item__expect');
    var arrow = make('span', 'item__arrow', '→');
    arrow.setAttribute('aria-hidden', 'true');
    expect.appendChild(arrow);
    expect.appendChild(make('span', 'visually-hidden', '期待結果: '));
    appendInline(expect, row[3]);
    body.appendChild(expect);
    label.appendChild(box);
    label.appendChild(body);
    li.appendChild(label);
    return li;
  }
  function render(data) {
    var fragment = document.createDocumentFragment();
    var areaCount = -1;
    var section = null;
    var list = null;
    var area = null;
    var items = 0;
    data.rows.forEach(function (row) {
      var kind = row[0];
      if (kind === 'a') {
        areaCount++;
        area = make('details', 'area');
        area.setAttribute('data-area', String(areaCount));
        area.open = true;
        var summary = make('summary', 'area__summary');
        summary.appendChild(inline('span', 'area__name', row[1]));
        var count = make('span', 'area__count');
        count.setAttribute('data-area-count', String(areaCount));
        summary.appendChild(count);
        area.appendChild(summary);
        fragment.appendChild(area);
        section = null;
      } else if (kind === 'f' && area !== null) {
        section = make('section', 'feature');
        if (row[1] !== '') section.appendChild(inline('h3', 'feature__title', row[1]));
        list = make('ul', 'items');
        section.appendChild(list);
        area.appendChild(section);
      } else if (kind === 'n' && section !== null) {
        section.insertBefore(inline('p', 'note', row[1]), list);
      } else if (kind === 'i' && section !== null) {
        list.appendChild(renderItem(row));
        items++;
      } else {
        throw new Error('unknown row');
      }
    });
    if (items !== data.total) throw new Error('total mismatch');
    root.insertBefore(fragment, document.getElementById('empty'));
  }
  try {
    render(JSON.parse(document.getElementById('spec-data').textContent));
    var memory = {};
    var persistent = true;
    var load = function () {
      try {
        var raw = window.localStorage.getItem(KEY);
        var saved = raw ? JSON.parse(raw) : {};
        var isMap = saved !== null && typeof saved === 'object' && !Array.isArray(saved);
        return isMap ? saved : {};
      } catch (e) {
        persistent = false;
        return memory;
      }
    };
    var save = function (next) {
      memory = next;
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch (e) {
        persistent = false;
      }
      document.getElementById('storage-warn').style.display = persistent ? 'none' : 'block';
    };
    var state = load();
    var checks = Array.prototype.slice.call(document.querySelectorAll('.item__check'));
    var refresh = function () {
      var done = 0;
      checks.forEach(function (c) { if (c.checked) done++; });
      document.getElementById('done').textContent = done;
      var percent = checks.length === 0 ? 0 : Math.round((done / checks.length) * 100);
      document.getElementById('percent').textContent = percent + '%';
      document.getElementById('fill').style.width = percent + '%';
      document.getElementById('meter').setAttribute('aria-valuenow', String(done));
      document.querySelectorAll('.area').forEach(function (areaElement) {
        var boxes = areaElement.querySelectorAll('.item__check');
        var n = 0;
        boxes.forEach(function (b) { if (b.checked) n++; });
        var label = areaElement.querySelector('.area__count');
        label.textContent = n + ' / ' + boxes.length;
        label.setAttribute('data-done', String(boxes.length > 0 && n === boxes.length));
      });
      root.classList.toggle('all-done', done === checks.length && checks.length > 0);
    };
    checks.forEach(function (c) {
      c.checked = state[c.getAttribute('data-id')] === true;
      c.addEventListener('change', function () {
        var next = Object.assign({}, state);
        if (c.checked) next[c.getAttribute('data-id')] = true;
        else delete next[c.getAttribute('data-id')];
        state = next;
        save(state);
        refresh();
      });
    });
    var toggle = document.getElementById('toggle-done');
    toggle.addEventListener('click', function () {
      var on = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(on));
      root.classList.toggle('hide-done', on);
    });
    var confirmBox = document.getElementById('confirm');
    document.getElementById('reset').addEventListener('click', function () { confirmBox.hidden = false; });
    document.getElementById('confirm-no').addEventListener('click', function () { confirmBox.hidden = true; });
    document.getElementById('confirm-yes').addEventListener('click', function () {
      state = {};
      save(state);
      checks.forEach(function (c) { c.checked = false; });
      confirmBox.hidden = true;
      refresh();
    });
    if (!persistent) document.getElementById('storage-warn').style.display = 'block';
    refresh();
  } catch (error) {
    fail(error);
  }
})();
</script>
```

注意: 上の描画スクリプトを JS のテンプレートリテラルに入れるため、ソース上は `${`・バッククォート・バックスラッシュを新たに書いていない（`String.fromCharCode(96)` を使う）。`'→'`・日本語の文字列はそのまま書いてよい。

6. 末尾の CLI 部分の `count` の計算を `countItems(spec)` に置き換える。

- [ ] **Step 4: 通ることを確認する**

Run: `NODE_ENV=test npx vitest run scripts`
Expected: PASS（新しいテストと、既存のチェック動作のテストがすべて通る。`docs/manual-test-spec.md` の実物の検査も通る）

- [ ] **Step 5: 実物で生成して大きさを確かめる**

Run: `node scripts/build-manual-test-spec.mjs && wc -c .superpowers/manual-test-spec.html && awk '{ if (length($0) > m) m = length($0) } END { print m }' .superpowers/manual-test-spec.html`
Expected: `(19 領域 / 1565 項目)` に近い表示（項目の数は変わらない）、HTML が 750,000 バイト（設計書の「約 0.75MB 以下」）以下、最長の行が 4,000 バイト以下（`awk` の `length` はロケールにより文字数のため、バイト数はテストで確かめる）。

- [ ] **Step 6: 整形・検査**

Run: `npx prettier --write scripts/build-manual-test-spec.mjs scripts/__tests__/build-manual-test-spec.test.mjs && npx eslint scripts`
Expected: エラーなし。prettier が描画スクリプトの文字列（テンプレートリテラルの中）を変えないことを確かめる（変えない）。

- [ ] **Step 7: 実際のブラウザで確認する（実装者が行う）**

`node scripts/build-manual-test-spec.mjs` で作った HTML を、Browser ツール（`mcp__Claude_Browser__*`）か、使えなければ jsdom で、`file://` で開く。項目数（`document.querySelectorAll('.item__check').length`）が 1565、`#total` が 1565、いくつかチェックしてリロードしても残ることを確かめる。確かめたら、Browser のタブを閉じる。

---

### Task 3: ドキュメントと全体検証

**Files:**

- Modify: `docs/developer-guide.md`
- Modify: `ROADMAP.md`（該当する項目があれば。無ければ変更しない）

- [ ] **Step 1: developer-guide に 1 文を足す**

`docs/developer-guide.md` の 221〜222 行目あたりの「実機テスト仕様書の ID は振り直さない…再生成して `npx vitest run scripts` を通す」の段落の直後に、次の 1 行を足す。

```markdown
- 実機テスト仕様書の HTML（`.superpowers/manual-test-spec.html`、Artifact として公開）は、項目を JSON で持ち、ブラウザの JavaScript で描く作りになっている（`scripts/build-manual-test-spec.mjs`）。ファイルを小さく保つのは、Artifact を再公開するとき、公開中の版を最後の行まで読む必要があるため。1 行 1 件で出す形を崩さない。
```

書式は周囲の箇条書きに合わせる（周囲が箇条書きでなければ、段落にする）。

- [ ] **Step 2: ROADMAP を確認する**

Run: `grep -n 'manual-test-spec\|実機テスト仕様書' ROADMAP.md | head`
該当する未完了の項目があれば完了にし、無ければ変更しない。

- [ ] **Step 3: 全体を検証する**

Run: `NODE_ENV=test npx vitest run scripts && npx prettier --check scripts docs/developer-guide.md && npx eslint scripts && npm run typecheck 2>&1 | tail -3`
Expected: すべて成功。

- [ ] **Step 4: HTML を再生成する**

Run: `node scripts/build-manual-test-spec.mjs`
Expected: `(19 領域 / 1565 項目)`。（Artifact の再公開は、コミットとレビューの後に、コントローラーが Artifact ツールで行う。実装者は行わない。）
