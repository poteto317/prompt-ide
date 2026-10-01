#!/usr/bin/env node
// 実機テスト仕様書(docs/manual-test-spec.md)を、タップでチェックできる 1 枚の HTML に変換する。
// 使い方: node scripts/build-manual-test-spec.mjs [入力 md] [出力 html]
//   既定の入力: docs/manual-test-spec.md / 既定の出力: .superpowers/manual-test-spec.html (git 管理外)
// チェック状態は ID(`- [ ] **EXP-001** …` の EXP-001)をキーに、閲覧しているブラウザの localStorage へ保存する。
// そのため md を更新して HTML を作り直しても、ID が変わらない限りチェックは残る。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const inputPath = resolve(process.argv[2] ?? `${root}/docs/manual-test-spec.md`)
const outputPath = resolve(process.argv[3] ?? `${root}/.superpowers/manual-test-spec.html`)

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// インライン記法はバッククォートのコードだけを扱う(仕様書の書式で他は使わない)
const inline = (text) => escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)

// 手順と期待結果を区切る最初の「→」の位置(バッククォートで囲まれたコードの中は除く)。無ければ -1
export function findArrow(text) {
  let inCode = false
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '`') inCode = !inCode
    else if (text[i] === '→' && !inCode) return i
  }
  return -1
}

const ITEM_PATTERN = /^- \[[ xX]\] \*\*([A-Z]+-\d{3})\*\* (.+)$/

/** md を { title, intro[], areas[{ name, features[{ name, notes[], items[{id, step, expect}] }] }] } に解析する */
export function parseSpec(markdown) {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, '')
  const lines = withoutComments.split('\n')
  const spec = { title: 'テスト仕様書', intro: [], areas: [] }
  const ids = new Set()
  let area = null
  let feature = null
  const ensureFeature = () => {
    if (area === null) throw new Error('領域(## …)より前にチェック項目があります')
    if (feature === null) {
      feature = { name: '', notes: [], items: [] }
      area.features.push(feature)
    }
    return feature
  }
  for (const [index, raw] of lines.entries()) {
    const line = raw.trimEnd()
    if (line.trim() === '') continue
    if (line.startsWith('# ')) {
      spec.title = line.slice(2).trim()
    } else if (line.startsWith('## ')) {
      area = { name: line.slice(3).trim(), features: [] }
      spec.areas.push(area)
      feature = null
    } else if (line.startsWith('### ')) {
      if (area === null)
        throw new Error(`${index + 1} 行目: 領域(## …)より前に機能(### …)があります`)
      feature = { name: line.slice(4).trim(), notes: [], items: [] }
      area.features.push(feature)
    } else if (line.startsWith('- [')) {
      const match = ITEM_PATTERN.exec(line)
      if (match === null)
        throw new Error(`${index + 1} 行目: チェック項目の書式が不正です: ${line}`)
      const [, id, body] = match
      if (ids.has(id)) throw new Error(`${index + 1} 行目: ID が重複しています: ${id}`)
      ids.add(id)
      const arrow = findArrow(body)
      if (arrow === -1)
        throw new Error(`${index + 1} 行目: 「→」で手順と期待結果を区切ってください: ${line}`)
      const step = body.slice(0, arrow).trim()
      const expect = body.slice(arrow + 1).trim()
      if (step === '' || expect === '')
        throw new Error(`${index + 1} 行目: 手順と期待結果の両方を書いてください: ${line}`)
      ensureFeature().items.push({ id, step, expect })
    } else if (line.startsWith('> ')) {
      if (area === null) spec.intro.push(line.slice(2).trim())
      else ensureFeature().notes.push(line.slice(2).trim())
    } else if (area === null) {
      spec.intro.push(line.trim())
    }
    // 領域の中のその他の行(箇条書きや段落)は表示しない
  }
  return spec
}

const renderItem = (item) => `
        <li class="item" data-id="${item.id}">
          <label class="item__label">
            <input class="item__check" type="checkbox" id="chk-${item.id}" data-id="${item.id}">
            <span class="item__body">
              <span class="item__id">${item.id}</span>
              <span class="item__step">${inline(item.step)}</span>
              <span class="item__expect"><span class="item__arrow" aria-hidden="true">→</span><span class="visually-hidden">期待結果: </span>${inline(item.expect)}</span>
            </span>
          </label>
        </li>`

const renderFeature = (feature) => `
      <section class="feature">
        ${feature.name === '' ? '' : `<h3 class="feature__title">${inline(feature.name)}</h3>`}
        ${feature.notes.map((note) => `<p class="note">${inline(note)}</p>`).join('\n        ')}
        <ul class="items">${feature.items.map(renderItem).join('')}
        </ul>
      </section>`

const renderArea = (area, index) => `
    <details class="area" data-area="${index}" open>
      <summary class="area__summary">
        <span class="area__name">${inline(area.name)}</span>
        <span class="area__count" data-area-count="${index}"></span>
      </summary>${area.features.map(renderFeature).join('')}
    </details>`

export function renderHtml(spec) {
  const total = spec.areas.reduce(
    (n, a) => n + a.features.reduce((m, f) => m + f.items.length, 0),
    0
  )
  return `<title>${escapeHtml(spec.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans+JP:wght@400;500;600&display=swap">
<style>
  /* Layout: 画面上部に固定の進捗バー、その下に領域ごとの折りたたみ。1 項目 = 画面幅いっぱいのタップ領域 */
  :root {
    --bg: #f4f6f5;
    --surface: #ffffff;
    --ink: #1c2422;
    --ink-soft: #55625e;
    --line: #d9e0dd;
    --accent: #0f7b61;
    --accent-soft: #dff1ea;
    --warn: #a4531b;
    --focus: #0b5cad;
    --font-ui: 'IBM Plex Sans JP', system-ui, -apple-system, 'Hiragino Sans', 'Yu Gothic UI', sans-serif;
    --font-mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme='light']) {
      --bg: #121816;
      --surface: #1a2220;
      --ink: #e4ebe8;
      --ink-soft: #9aa9a4;
      --line: #2c3834;
      --accent: #46c8a2;
      --accent-soft: #1d3a31;
      --warn: #e0925c;
      --focus: #6db3f5;
      color-scheme: dark;
    }
  }
  :root[data-theme='dark'] {
    --bg: #121816;
    --surface: #1a2220;
    --ink: #e4ebe8;
    --ink-soft: #9aa9a4;
    --line: #2c3834;
    --accent: #46c8a2;
    --accent-soft: #1d3a31;
    --warn: #e0925c;
    --focus: #6db3f5;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 15px/1.6 var(--font-ui);
    padding-inline: 16px;
  }
  .wrap { max-width: 860px; margin: 0 auto; padding-block: 20px 72px; }
  h1 { font-size: 22px; line-height: 1.3; margin: 0 0 6px; text-wrap: balance; }
  .intro { color: var(--ink-soft); margin: 0 0 4px; font-size: 14px; }
  .bar {
    position: sticky;
    top: env(safe-area-inset-top, 0px);
    z-index: 5;
    background: var(--bg);
    padding-block: 12px;
    margin-top: 12px;
    border-bottom: 1px solid var(--line);
  }
  .bar__row { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; }
  .bar__count { font-variant-numeric: tabular-nums; font-weight: 600; }
  .bar__count small { color: var(--ink-soft); font-weight: 400; }
  .meter { height: 8px; border-radius: 4px; background: var(--line); overflow: hidden; margin-top: 8px; }
  .meter__fill { height: 100%; width: 0; background: var(--accent); transition: width 0.2s; }
  .tools { display: flex; flex-wrap: wrap; gap: 8px; }
  .tool {
    appearance: none;
    font: inherit;
    font-size: 13px;
    min-height: 36px;
    padding: 4px 12px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    cursor: pointer;
  }
  .tool[aria-pressed='true'] { background: var(--accent-soft); border-color: var(--accent); }
  .tool--danger { color: var(--warn); }
  .confirm { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; font-size: 13px; }
  .area { margin-top: 20px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
  .area__summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: baseline;
    padding: 12px 14px;
    font-weight: 600;
    font-size: 17px;
  }
  .area__summary::-webkit-details-marker { display: none; }
  .area__summary::before { content: '▸'; color: var(--ink-soft); margin-right: 8px; font-size: 12px; }
  .area[open] > .area__summary::before { content: '▾'; }
  .area__name { flex: 1; }
  .area__count { font-size: 13px; color: var(--ink-soft); font-weight: 400; font-variant-numeric: tabular-nums; }
  .area__count[data-done='true'] { color: var(--accent); font-weight: 600; }
  .feature { border-top: 1px solid var(--line); padding: 10px 0 4px; }
  .feature__title { font-size: 14px; margin: 0; padding: 4px 14px; color: var(--ink-soft); font-weight: 600; letter-spacing: 0.02em; }
  .note { margin: 4px 14px; padding: 6px 10px; border-left: 3px solid var(--line); color: var(--ink-soft); font-size: 13px; }
  .items { list-style: none; margin: 0; padding: 0; }
  .item { border-top: 1px solid var(--line); }
  .item:first-child { border-top: 0; }
  .item__label { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; min-height: 48px; cursor: pointer; }
  .item__check { flex: none; width: 24px; height: 24px; margin: 2px 0 0; accent-color: var(--accent); cursor: pointer; }
  .item__check:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  .item__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .item__id { font: 500 11px/1.4 var(--font-mono); color: var(--ink-soft); letter-spacing: 0.04em; }
  .item__step { overflow-wrap: anywhere; }
  .item__expect { color: var(--ink-soft); font-size: 14px; overflow-wrap: anywhere; }
  .item__arrow { color: var(--accent); margin-right: 6px; }
  .item:has(.item__check:checked) .item__step { color: var(--ink-soft); text-decoration: line-through; text-decoration-color: var(--line); }
  .item:has(.item__check:checked) { background: var(--accent-soft); }
  code { font: 500 0.88em var(--font-mono); background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .hide-done .item:has(.item__check:checked) { display: none; }
  .empty { display: none; margin: 24px 0; text-align: center; color: var(--accent); font-weight: 600; }
  .hide-done.all-done .empty { display: block; }
  .storage-warn { display: none; margin-top: 8px; font-size: 13px; color: var(--warn); }
  @media (max-width: 480px) { h1 { font-size: 19px; } .area__summary { font-size: 16px; } }
  @media (prefers-reduced-motion: reduce) { .meter__fill { transition: none; } }
</style>
<div class="wrap" id="root">
  <h1>${escapeHtml(spec.title)}</h1>
  ${spec.intro.map((p) => `<p class="intro">${inline(p)}</p>`).join('\n  ')}
  <div class="bar">
    <div class="bar__row">
      <div class="bar__count"><span id="done">0</span> / <span id="total">${total}</span> 確認済み <small id="percent">0%</small></div>
      <div class="tools">
        <button class="tool" type="button" id="toggle-done" aria-pressed="false">未確認のみ表示</button>
        <button class="tool tool--danger" type="button" id="reset">すべて未確認に戻す</button>
      </div>
    </div>
    <div class="meter" role="progressbar" aria-label="確認の進捗" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="0" id="meter"><div class="meter__fill" id="fill"></div></div>
    <div class="confirm" id="confirm" hidden>
      <span>チェックをすべて外します。よろしいですか？</span>
      <button class="tool tool--danger" type="button" id="confirm-yes">外す</button>
      <button class="tool" type="button" id="confirm-no">キャンセル</button>
    </div>
    <p class="storage-warn" id="storage-warn">この環境ではチェックを保存できません。ページを閉じると消えます。</p>
  </div>
  ${spec.areas.map(renderArea).join('')}
  <p class="empty" id="empty">未確認の項目はありません。</p>
</div>
<script>
(function () {
  var KEY = 'manual-test-spec:v1';
  var memory = {};
  var persistent = true;
  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      persistent = false;
      return memory;
    }
  }
  function save(state) {
    memory = state;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      persistent = false;
    }
    document.getElementById('storage-warn').style.display = persistent ? 'none' : 'block';
  }
  var state = load();
  var checks = Array.prototype.slice.call(document.querySelectorAll('.item__check'));
  var root = document.getElementById('root');
  function refresh() {
    var done = 0;
    checks.forEach(function (c) { if (c.checked) done++; });
    document.getElementById('done').textContent = done;
    var percent = checks.length === 0 ? 0 : Math.round((done / checks.length) * 100);
    document.getElementById('percent').textContent = percent + '%';
    document.getElementById('fill').style.width = percent + '%';
    document.getElementById('meter').setAttribute('aria-valuenow', String(done));
    document.querySelectorAll('.area').forEach(function (area) {
      var boxes = area.querySelectorAll('.item__check');
      var n = 0;
      boxes.forEach(function (b) { if (b.checked) n++; });
      var label = area.querySelector('.area__count');
      label.textContent = n + ' / ' + boxes.length;
      label.setAttribute('data-done', String(boxes.length > 0 && n === boxes.length));
    });
    root.classList.toggle('all-done', done === checks.length && checks.length > 0);
  }
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
})();
</script>
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const spec = parseSpec(readFileSync(inputPath, 'utf-8'))
  const count = spec.areas.reduce(
    (n, a) => n + a.features.reduce((m, f) => m + f.items.length, 0),
    0
  )
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, renderHtml(spec), 'utf-8')
  console.log(`${outputPath} (${spec.areas.length} 領域 / ${count} 項目)`)
}
