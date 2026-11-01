# サイドバーとターミナルのパネルの大きさの変更 設計書

## 目的

左のサイドバーの幅と、エディタの下のターミナルのパネルの高さを、境界のドラッグで変えられるようにする。変えた大きさは次の起動でも保つ。

## 決めたこと

- 対象はサイドバーの幅とターミナルのパネルの高さの 2 つ。出力パネル(従来の方式)の高さは対象外
- ドラッグは Pointer Events とポインタのキャプチャで作る。マウスとタッチの両方で動く
- 境界は `role="separator"` にし、キーボードの矢印でも変えられる(プロジェクトのアクセシビリティの規約)
- サイドバーの幅は px、ターミナルの高さはエディタの領域に対する % で持つ。ウィンドウの高さが変わっても比率を保つため
- 既定値は今と同じ(幅 240px、高さ 45%)
- 範囲: 幅 220〜600px(220px はソース管理のバナーのボタンとセクションの見出しが収まる幅)、高さ 15〜85%。パネルの既存の最小の高さ 160px は残す
- 値は `userData/settings.json` の `panelLayout` に保存する。ドラッグ中は保存せず、確定したときに 1 回保存する
- 既定値へ戻す操作、配置の変更、レイアウトのプリセットは作らない
- CSS の上限・下限で止まっている間に値だけが動かないよう、境界の操作と `aria-value*` は `lib/panelLayoutLimits.ts` の今の範囲に揃える。サイドバーの上限は `window.innerWidth - 400`、ターミナルの下限は最小の高さ 160px に当たる %

## 画面

- サイドバーとエディタの間に縦の境界を置く。サイドバーを閉じている間は出さない
- ターミナルのパネルの上端に横の境界を置く。パネルが閉じている間と最大化の間は出さない
- 境界はカーソルが `col-resize` / `row-resize` に変わる。hover、フォーカス、ドラッグ中は青(`#007acc`)で示す
- ポインタのドラッグではフォーカスを動かさず、文字も選択しない。`mousedown` の既定の動作を止め、境界に `user-select: none` を付ける。カーソルがターミナルや Monaco の上へ出てもドラッグは続く
- フォーカスが境界へ移るのはキーボードの Tab だけ。青の表示は `:hover`・`:focus-visible`・ドラッグ中の 3 つ
- 境界はレイアウトの幅を取らない。縦の境界は `.ide-main` の flex の子で `width: 6px; margin: 0 -3px; position: relative; z-index: 12`。実際のサイドバーの端に追従する
- 横の境界は section の先頭に置き、上へだけ出す。`height: 6px; margin-top: -6px; position: relative; z-index: 12`。帯には重ねない。Monaco のスクロールバー(`z-index: 11`)より手前にするための値で、理由をコメントに残す
- タッチの端末(`@media (pointer: coarse)`)では太さを 16px にする
- ウィンドウが狭いとき、サイドバーはエディタの領域(最小 352px。AGT-040 のウィンドウ 640px のときの幅)を残す。`.sidebar` の CSS の `max-width: calc(100vw - 400px)`(アクティビティバー 48px を含む)で抑える。`min-width: 220px` が優先する
- 狭いサイドバーのために、コミットの `コミットのオプション` のメニューは行の幅に揃えて項目を折り返す。`戻した操作を取り消す` の帯の文字は基準の幅 60px を持ち、足りなければボタンが次の行へ折り返す
- Monaco は `automaticLayout`、xterm は既存の `ResizeObserver` で追従する

## 部品

### `src/shared/panelLayout.ts`

`PanelLayout { sidebarWidth: number; terminalHeightPercent: number }`、`DEFAULT_PANEL_LAYOUT`、範囲の定数 `SIDEBAR_WIDTH_MIN = 220`・`SIDEBAR_WIDTH_MAX = 600`・`TERMINAL_HEIGHT_PERCENT_MIN = 15`・`TERMINAL_HEIGHT_PERCENT_MAX = 85`、`isPanelLayout(value)`(有限の数で範囲の中)、`clampNumber(value, min, max)`。

### `src/main/panelLayoutStore.ts`

`promptListModeStore.ts` と同じ形。`settingsFileStore.ts` の `SettingsFile` に `panelLayout` を足す。`getPanelLayout()` は不正なら既定値、`setPanelLayout(value)` は `isPanelLayout` で検証して、不正なら書かずに投げる。文言に値を入れない。IPC は `settings:getPanelLayout`・`settings:setPanelLayout`。`settingsHandlers.ts`、preload の `api.ts`・`index.d.ts`、`renderer/src/lib/settingsApi.ts`、テストの `renderer/src/__tests__/setup.ts` の `window.api` のモックに足す。

### `src/renderer/src/hooks/usePanelLayout.ts`

`{ layout, changeSidebarWidth, changeTerminalHeightPercent, commit }` を返す。

- `settingsApi` を経由して起動時に読み込む。読み込みの失敗は `console.error` だけにして既定値のまま続ける
- 読み込みの前に利用者が変えた項目は今の値を残し、残りの項目は読み込んだ値を入れる
- `change*` は範囲へ丸める。丸めた後の値が同じなら state を更新しない
- `change*` の中で `ref` を同期に更新する(`useLatestRef` は使わない。同じ tick の `commit` が新しい値を保存するため)
- `commit` は `ref` の値を保存する。失敗は `console.error` だけにする(画面の操作は続けられる)
- 保存は全項目を書くので、読み込みの前の `commit` は読み込みの後へ待たせて 1 回だけ保存する。読み込みに失敗したら、その起動では保存しない(変えていない項目を既定値で上書きしない)

### `src/renderer/src/components/PanelResizer.tsx`

```ts
interface Props {
  orientation: 'vertical' | 'horizontal'
  label: string
  value: number
  step: number
  /** 今の画面で取れる範囲。操作のたびに読む */
  limits: () => PanelSizeLimits
  /** ポインタの位置から値を求める */
  valueFromPointer: (clientX: number, clientY: number) => number
  onChange: (value: number) => void
  onCommit: () => void
}
```

`role="separator"`、`aria-orientation`(縦の境界は `vertical`)、`aria-label`、`aria-valuenow`・`aria-valuemin`・`aria-valuemax`、`tabIndex={0}`。

- `pointerdown`(主ボタンだけ)で開始の値と `pointerId` を控えて `setPointerCapture` し、`pointermove` で `onChange(valueFromPointer(...))`
- ドラッグ中のほかの `pointerdown` と、ID の違う `pointermove`・`pointerup`・`pointercancel` は無視する
- `pointerup`・`pointercancel`・`lostpointercapture` で終え、動かしていて、最後の値が押した時点の保存値と違うときだけ `onCommit` を 1 回呼ぶ
- キーボード: 縦の境界は `ArrowRight` で増やし `ArrowLeft` で減らす。横の境界は `ArrowUp` で増やし `ArrowDown` で減らす。`step` ずつ変えて `onCommit` する。範囲の端で値が変わらないときは `onChange`・`onCommit` を呼ばない。IME やリピートの除外は要らない(文字を受けない)。既定の動作は止める
- 今の画面の範囲への丸めは `PanelResizer` が行い、絶対の範囲への丸めは `usePanelLayout` が行う

### `src/renderer/src/lib/panelLayoutLimits.ts`

`sidebarWidthLimits(windowWidth)` と `terminalHeightLimits(editorAreaHeight)`。CSS の `max-width`・`min-height` と同じ値から、今の画面で取れる範囲を返す純粋な関数。

### 配線

- `App.tsx`: `usePanelLayout` を使い、`Sidebar` へ `width`、サイドバーを開いている間だけ `PanelResizer`(label `サイドバーの幅`、step 16)を描く。`.ide-main` に ref を付け、`valueFromPointer` は `clientX` からその `left` を引く
- `EditorPanel` → `AgentTerminalPanel`: `terminalSize?: AgentTerminalSize`(`heightPercent`・`onChange`・`onCommit`)を渡す。`--agent-terminal-height` を section の `style` に置き、`.agent-terminal-panel--open` の `flex: 0 0 var(--agent-terminal-height, 45%)` で使う。`isOpen && !isMaximized` のときだけ `PanelResizer`(label `ターミナルの高さ`、step 2)を section の先頭に描く。`valueFromPointer` は `sectionRef.current.parentElement`(`.editor-panel`。`flex-basis` の % の基準)の矩形から `(bottom - clientY) / height * 100`
- `height` が 0 のときは今の値を返す
- 両方の境界に `limits` を渡す。ターミナルの `value` は `Math.round` した値を渡す
- ドラッグの開始の値は押した時点の範囲で求め、丸めた値が直前と同じ間は `onChange` しない

## 既知の制約

- 出力パネルの高さは変えられない
- 既定の大きさへ戻す操作は無い
- 保存に失敗しても画面には出さない(起動し直すと前の大きさに戻る)。設定の読み込みに失敗した起動では保存しない
- 起動の直後は、読み込みが終わるまで既定の大きさで描く
- 既定より狭い幅では、履歴の `+N` が切れることがある

## テスト

- `panelLayout`: `isPanelLayout` の範囲・非数・不正な型、`clampNumber`
- `panelLayoutStore`: 既定値、不正な保存値、保存の検証と拒否
- preload の `api.test.ts`、`settingsHandlers.test.ts`、`settingsApi.test.ts`
- `usePanelLayout`: 丸め、同じ値で state を更新しない、読み込みが利用者の変えた項目だけを残す、読み込みの失敗、`change` の直後に同じ tick で `commit` した値、保存の失敗
- `PanelResizer`: ARIA、ポインタの開始・移動・終了、主ボタン以外、2 本目のポインタ、`mousedown` の既定の動作を止める、値が変わらなければ `onCommit` しない、`pointercancel`、矢印キー
- `AgentTerminalPanel`: 開閉と最大化で境界の出し分け、`--agent-terminal-height`
- `main.css`: 境界のカーソル、`touch-action: none`、`z-index: 12`、サイドバーの最小・最大幅
- 実装を戻すと落ちることを確かめる

実機の確認は `docs/manual-test-spec.md` の `BASE` に追記する。既存の項目は ID を変えずに直す: BASE-016(サイドバーの幅は `max-width` で縮む)、APL-027 の後半(600px 以下)、AGT-046(境界が Tab の順に入る)、BASE-008・PRM-098・GIT-136(「約 240px」は既定の幅のとき)。`main.css` のコメントも直す: 2208 行目の 45%、3855 行目の固定幅のサイドバーの根拠。`useAgentTerminalPanel.ts` の「保存しない」は開閉と最大化のことなので直さない。実機の項目に、横に長い行があるファイルでエディタに載せたまま境界を押せることを入れる。ROADMAP の「リサイズ可能・配置変更可能なパネル、レイアウトプリセット」は一部実装として書き添える。
