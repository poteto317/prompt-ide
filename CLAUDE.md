# 共通ルール

- **すべての返答・コードレビューコメント・提案は必ず日本語で行うこと。** ただしコードブロック・技術固有名詞・ライブラリ名はそのまま英語表記でよい。
- コードの修正や提案を行った後は、必ずターミナルで検証コマンドを実行して動作確認を行うこと。
- 修正内容に自信がある場合でも、検証ステップを省略しないこと。
- **`git commit` や `git push` はユーザーから明示的に指示がある場合のみ実行すること。** 自動実行は禁止。
- **`gh` コマンドで日本語を含む PR / Issue 本文を扱う場合、Windows (PowerShell) では必ず UTF-8 に固定してから実行すること。**
  文字コード設定は、`gh` コマンドを実行する前に**毎回**以下を設定すること。
  ```powershell
  chcp 65001
  [Console]::InputEncoding = [System.Text.Encoding]::UTF8
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [Console]::OutputEncoding
  ```
  文字化けした既存本文は再利用せず、正常なテキストで上書きすること。

# PR レビューフロー

**指摘が 0 件になるまで自走すること。** ユーザーに「レビューが来ているか」を目視で確認させたり、
1 周ごとに指示を待ったりしない。巡回数が増えたことを理由に打ち切らない。

具体的なコマンド・スクリプト・落とし穴は [docs/pr-review-loop.md](docs/pr-review-loop.md) にまとめてある。
セッションをまたぐ場合や別の端末で作業する場合も、この手順書に従えば同じループを再現できる。

PR へのコミットをプッシュした後は、以下を 1 周として繰り返す。

1. **指摘の取得**
   - `gh api graphql` で `reviewThreads`（`id`, `isResolved`, `comments` を含む）を取得する
   - **レビュー本文も必ず読む。** suppressed comments はスレッドにならず、本文の `<details>` 内にしか現れない
   - `reviews` / `reviewThreads` は `first` ではなく **`last`** を使う。件数が増えると `first` は古い方から埋まり、最新の到着を取りこぼす

2. **妥当性の検証**
   - 指摘の前提を自分で確かめる。「テストが落ちる」と書かれていたら実際に走らせ、数値が書かれていたら自分で計算する
   - 前提が誤っていれば、根拠（実行結果・計算過程）を添えて対応しない判断を返信し、PR 本文にも残す

3. **TDD で修正**
   - 失敗するテストを先に書き、実装後に通す
   - **実装を戻すとそのテストが落ちること**まで確認する（`git stash push <実装ファイル>` → テスト → `git stash pop`）
   - `act(...).then(...)` 形式で書かない。失敗が unhandled rejection として握り潰され、通ったように見える

4. **検証**
   - `npm test` / `npm run typecheck` / 変更したファイルへの `npx eslint`
   - 実機（Electron）でも確認する。**起動したアプリは検証後に必ず自分で停止する**（Electron 本体と dev サーバーの両方）
   - `pkill -f` を使う前に `pgrep -fl` で対象を確認する。パターンにはリポジトリ名を含んだパスを使い、無関係なプロセスを巻き込まない

5. **コミットとプッシュ**
   - `git add -A` は使わない（無関係な未追跡ファイルを巻き込む）。`git add -u` を使う
   - コミットメッセージは日本語・Conventional Commit 形式

6. **対応済みスレッドの Resolve**
   - **対応済みの指摘のみ** `resolveReviewThread` ミューテーションで Resolve する（未対応の指摘を機械的に Resolve しないこと）
   - 返信には「何が起きていたか」「どう直したか」「どのテストで固定したか」を書く

7. **PR 本文の更新**
   - コミットごとに「指摘 → 対応」の表を追記する。対応しない判断とその理由もここに残す

8. **再レビューの依頼と監視**
   - `bash scripts/request-copilot-review.sh <owner> <repo> <pr>` で依頼し、**登録されたことを出力で確認する**
   - `bash scripts/watch-pr-review.sh <owner> <repo> <pr> "<baseline>"` で監視を張り直す
   - 収束の判断は監視が出す `NO FINDINGS` で行う。`NO PENDING REVIEW` や `WATCH TIMEOUT` は「指摘なし」ではない
   - `NO FINDINGS` が出た場合も、GraphQL で `reviews` と `reviewThreads` の最新を直接確認してから収束と判断する

# コーディングルール（汎用）

## 型定義

型としてのみ使用する import は必ず `import type` を使用する。

```typescript
// ✅ 正しい
import type { Foo } from '@/types/foo'

// ❌ 間違い
import { Foo } from '@/types/foo'
```

## コンポーネント設計

- **'use client'**: クライアントコンポーネントには必ず宣言
- **ダークモード対応**: Tailwind の `dark:` プレフィックスを使用
- **アクセシビリティ**: `aria-label` を適切に設定

### ドラッグハンドルとスワイプの競合防止

スワイプジェスチャーを検知する祖先コンポーネントの内部にドラッグハンドルを配置する場合、ハンドルの `button` に `onTouchStartCapture` と `onMouseDownCapture` で `e.stopPropagation()` を設定する。これにより、ハンドルへのタッチ・クリックがスワイプ検知に到達しなくなる。`onPointerDownCapture` は dnd-kit の PointerSensor を無効化するため追加してはならない。

```tsx
// ❌ 悪い例 — ハンドルを触るとスワイプも同時に開始してしまう
<SwipeableItem ...>
  <div {...listeners}>
    <button aria-label="並び替え">⨿</button>
  </div>
</SwipeableItem>

// ✅ 良い例 — capture で伝播を止め、スワイプと干渉しない
// attributes・listeners は dnd-kit の useSortable / useDraggable の戻り値
<SwipeableItem ...>
  <button
    {...attributes}
    {...listeners}
    style={{ touchAction: "none" }}
    aria-label="並び替え"
    onTouchStartCapture={(e) => e.stopPropagation()}
    onMouseDownCapture={(e) => e.stopPropagation()}
  >
    ⨿
  </button>
</SwipeableItem>
```

### 選択状態の ARIA

色スウォッチなど「どれが選択中か」を視覚的に表現する場合、支援技術にも状態を伝える。グループコンテナに `role="radiogroup"`、各選択肢に `role="radio"` + `aria-checked={currentValue === c.value}` を付与する。

```tsx
// ❌ 悪い例 — ring だけでは支援技術に選択状態が伝わらない
<div className="flex gap-1">
  {colors.map((c) => (
    <button key={c.value} className={currentValue === c.value ? "ring-2" : ""} />
  ))}
</div>

// ✅ 良い例 — radiogroup + radio + aria-checked で状態を明示
<div role="radiogroup" aria-label="背景色" className="flex gap-1">
  {colors.map((c) => (
    <button
      key={c.value ?? "__default__"}
      role="radio"
      aria-checked={currentValue === c.value}
      className={currentValue === c.value ? "ring-2" : ""}
    />
  ))}
</div>
```

### 混在状態の表現

`undefined` が「未選択/デフォルト」として有効な値である場合、「複数の値が混在している」状態を `undefined` で表してはならない。`null` などの別の sentinel 値を使い、`undefined` と明確に区別すること。

### React の `key`

リストレンダリングでは表示文言（label）を `key` に使わない。`undefined` になり得る値には固定フォールバック文字列（例: `"__default__"`）を使い、安定した識別子を `key` にする。

```tsx
// ❌ 悪い例
{
  items.map((item) => <button key={item.label} />)
}

// ✅ 良い例
{
  items.map((item) => <button key={item.value ?? '__default__'} />)
}
```

## テスト

- **タイマーリークの防止**: テスト内で `setInterval` / `setTimeout` を使ったモック実装を書く場合は、返ってくる ID を変数に保持し、`afterEach` で必ず `clearInterval` / `clearTimeout` すること。`jest.useFakeTimers()` 下でも interval はテスト間をまたいで残る場合があり、予期せぬ tick / open handle の原因になる。

```typescript
// ❌ 悪い例 — interval ID を捨てているためテスト間をまたいでリークする
const activateTimer = () => {
  mockStart.mockImplementation((onTick: () => void) => {
    setInterval(onTick, INTERVAL_MS)
  })
}

// ✅ 良い例 — ID を保持して afterEach で確実にクリアする
let activeIntervalId: ReturnType<typeof setInterval> | null = null
const activateTimer = () => {
  mockStart.mockImplementation((onTick: () => void) => {
    activeIntervalId = setInterval(onTick, INTERVAL_MS)
  })
}
// beforeEach: activeIntervalId = null にリセット
// afterEach:
//   if (activeIntervalId !== null) clearInterval(activeIntervalId)  ← null チェック必須（型エラー防止）
//   jest.useRealTimers()
```

## ドキュメントの同期管理

コードを変更した際は、関連するドキュメントも必ず同時に更新する。

- **コード例の同期**: ドキュメントに掲載しているコードサンプルは、実装変更時に現行コードと一致しているか確認し、ずれがあれば同じコミットで修正する。
- **過去の状態と現在の状態の区別**: バグ修正記録で「修正前の状態」を記述する場合は過去形（「〜していた」「〜だった」）を使い、現在も同じ状態であるかのような誤読を防ぐ。
- **修正済みであることの明記**: 「このPRで修正」「このコミットで変更」など、どのタイミングで対応したかを明記する。

## Hooks・関数の実装ルール

### デフォルト引数の参照安定性

カスタム hook やファクトリー関数のオプション引数に関数デフォルトを設定する場合、`(arg) => fn(arg)` のようなラッパーを使わず、`fn` を直接渡す。

```ts
// ❌ 悪い例 — 毎レンダーで新しい関数インスタンスが生成される
const useFoo = ({ onConfirm = (msg) => confirm(msg) } = {}) => { ... };

// ✅ 良い例 — confirm は安定した参照
const useFoo = ({ onConfirm = confirm } = {}) => { ... };
```

## 禁止事項

- **`git commit` / `git push` の自動実行** — ユーザーの明示的な指示なしにコミット・プッシュを行わない
