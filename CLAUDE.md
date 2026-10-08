# 共通ルール

- **すべての返答・コードレビューコメント・提案は必ず日本語で行うこと。** ただしコードブロック・技術固有名詞・ライブラリ名はそのまま英語表記でよい。
- コードの修正や提案を行った後は、必ずターミナルで検証コマンドを実行して動作確認を行うこと。
- 修正内容に自信がある場合でも、検証ステップを省略しないこと。
- **`git commit` や `git push` はユーザーから明示的に指示がある場合のみ実行すること。** 自動実行は禁止。
- **実装プランを実行するときは、サブエージェント駆動開発（`superpowers:subagent-driven-development`）で進めること。** 「サブエージェント方式かインライン方式か」をユーザーに確認しない。タスクごとに新しいサブエージェントで実装し、タスクごとにレビューを挟み、最後にブランチ全体のレビューを行う。
- **実装プランを作成したら、ユーザーの確認を待たずに、そのまま実装まで進めること。** 「プランを確認してください」「実装に進んでよいか」と止まらない。設計書（仕様）の承認は従来どおり取る。実装中も、コミット・プッシュはユーザーの明示的な指示があるまで行わない。
- **機能を開発するたびに、実機テスト仕様書 `docs/manual-test-spec.md` へ確認項目を追記すること。** 実機（Electron）での確認はユーザーがまとめて行うため、プランや PR 本文に実機確認の手順を個別に書かず、仕様書の ID を参照する。
  - 書式: `- [ ] **<接頭辞>-<3 桁の連番>** <手順> → <期待結果>`（1 行 1 項目）。領域は `##`、機能は `###`、前提は `> 前提:`。新しい領域は新しい接頭辞を使う。**一度振った ID は変更・再利用しない**（チェック状態の保存キーのため）。詳しい書式は仕様書の冒頭と `scripts/build-manual-test-spec.mjs` を参照。
  - 既存の機能の挙動を変えたら、該当する項目の手順・期待結果も直す（ID は変えない）。機能を削除したら、該当する項目を消す（欠番は許容する。他の項目の ID を振り直さない）。新しい項目の連番は、その接頭辞の最大値の次を使う。
  - 追記したら `node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact（<manual-test-spec-artifact-url>）を同じファイルパス（`.superpowers/manual-test-spec.html`）で再公開する。`npx vitest run scripts` が通ること（ID の一意性・接頭辞ごとの連番が昇順であること・書式を検査する）。
  - 実装プランの最終タスク（ROADMAP 更新と全体検証）には、実機確認の手順の代わりに「テスト仕様書への追記と Artifact の再公開」を入れる。
- **`gh` コマンドで日本語を含む PR / Issue 本文を扱う場合、Windows (PowerShell) では必ず UTF-8 に固定してから実行すること。**
  文字コード設定は、`gh` コマンドを実行する前に**毎回**以下を設定すること。
  ```powershell
  chcp 65001
  [Console]::InputEncoding = [System.Text.Encoding]::UTF8
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [Console]::OutputEncoding
  ```
  文字化けした既存本文は再利用せず、正常なテキストで上書きすること。

# PR レビュー対応フロー

PR にレビュー指摘がある場合は、以下の手順に従って対応する。

1. **指摘の取得**
   - `gh api graphql` で `reviewThreads`（`id`, `isResolved`, `comments` を含む）を取得する
   - **レビュー本文も必ず読む。** suppressed comments はスレッドにならず、本文の `<details>` 内にしか現れない
   - `reviews` は `first` ではなく **`last`** を使う。件数が増えると `first` は古い方から埋まり、最新の到着を取りこぼす
   - `reviewThreads` は逆に **`first` + `pageInfo` でページングして全件取る**。`last` と `after` は噛み合わず、途中で打ち切ると古い未解決スレッドを見落とす

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
- **Copilot へのレビュー依頼・監視の実行** — `scripts/request-copilot-review.sh` や `scripts/watch-pr-review.sh`、`gh pr review --request` などによる Copilot へのレビュー依頼やその監視は絶対に行わない（2026-10-03 から。理由: トークンの消費量が多く、利用上限にすぐ達するため。スクリプトは削除せず、`ALLOW_COPILOT_REVIEW=1` を付けないと実行できないようにしてある）

# 開発フロー（dev-flow-kit）

機能開発は、dev-flow-kit（https://github.com/poteto317/dev-flow-kit 、ローカルの clone は `$DEV_FLOW_KIT`）の開発ループで進める。

- **起動方法**: Claude Code で `/feature [機能の説明]` を実行する。機能の説明を省くと、ロードマップから次の未完了項目を選ぶ。以降は確認が必要なときだけ止まり、次の順に自動で進む。
  `feature` → `refactor-srp` → `review-loop` → `commit-ja` → `pr-ja` → `pr-review-loop` → `review-digest` → `lessons-push`
- **依頼の言い換え**: 「次の機能を実装して」「ロードマップを進めて」「開発ループを回して」などの依頼は、`/feature` の起動として扱い、Skill ツールで `dev-flow-kit:feature` を起動する。途中のステップだけを頼まれた場合（例: 「SRP リファクタリングして」「レビューループを回して」「PR を作って」）は、該当するコマンド（`dev-flow-kit:refactor-srp` など）を起動する。その 1 ステップだけでよい場合は `--only` を付ける。
- **再開**: 中断したフローは `/dev-flow --resume` で再開する。状態はこのリポジトリの `.claude/dev-flow/` に保存される（git 管理外）。
- **実装前の確認**: `$DEV_FLOW_KIT/lessons/review-lessons.md` の「優先度 A のチェックリスト」を確認し、今回の変更に関係する項目は本文も読む。
- **プラグインが使えない環境**（Codex など）: `$DEV_FLOW_KIT/commands/` の各コマンドのファイルを上の順に読み、その手順に従う。
- **優先順位**: このファイルのほかのルールと dev-flow-kit のコマンドの指示が食い違う場合は、このリポジトリのルールに従う。
