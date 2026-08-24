# 共通ルール

- **すべての返答・コードレビューコメント・提案は必ず日本語で行うこと。** ただしコードブロック・技術固有名詞・ライブラリ名はそのまま英語表記でよい。
- コードの修正や提案を行った後は、必ずターミナルで検証コマンドを実行して動作確認を行うようにしてください。
- 修正内容に自信がある場合でも、検証ステップを省略しないでください。
- **`git commit` や `git push` は絶対に自動実行しないでください。** コミット・プッシュは必ずユーザーが確認・承認した上で行います。ユーザーから明示的に指示がある場合のみ実行してください。
- **GitHub CLI (`gh`) で日本語を含む PR / Issue 本文を読む・書く場合は、PowerShell の文字コードを必ず UTF-8 に固定してから実行してください。**
  - 文字コード設定は、`gh` コマンドを実行する前に毎回以下を設定してください。

    ```powershell
    chcp 65001
    [Console]::InputEncoding = [System.Text.Encoding]::UTF8
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [Console]::OutputEncoding
    ```

  - 実行例:

    ```powershell
    gh pr view --json body
    gh pr edit --body-file <file>
    ```

  - 既存本文が文字化けした場合は、壊れた本文を再利用しないでください。
  - 正常なスナップショット、または手元で復元した UTF-8 テキストから上書きしてください。

# PR レビューフロー

**指摘が 0 件になるまで自走すること。** ユーザーに「レビューが来ているか」を目視で確認させたり、
1 周ごとに指示を待ったりしない。巡回数が増えたことを理由に打ち切らない。

具体的なコマンド・スクリプト・落とし穴は [docs/pr-review-loop.md](../docs/pr-review-loop.md) に
まとめてある。ここはその要約で、詳細と実行例は手順書側を参照すること。

スクリプトは bash と python3 に依存する。Windows では Git Bash / WSL から実行する。

PR へのコミットをプッシュした後は、以下を 1 周として繰り返す。

1. **指摘の取得**
   - `reviewThreads` は `first:100` + `pageInfo` でページングして全件取る。`last` と `after` は
     噛み合わないため、途中で打ち切ると古い未解決スレッドを見落とす
   - `reviews` は逆に `first` ではなく **`last`** を使う。件数が増えると `first` は古い方から
     埋まり、最新の到着を取りこぼす
   - **レビュー本文も必ず読む。** suppressed comments はスレッドにならず、本文の `<details>` 内に
     しか現れない。スレッドへの返信も review として記録されるため、`reviews(last:1)` では返信を
     掴んで「指摘なし」と誤読する

   ```bash
   # 未解決スレッドの一覧（hasNextPage が true なら after で続きを辿る）
   gh api graphql -f query='
   {repository(owner:"<OWNER>",name:"<REPO>"){pullRequest(number:<PR_NUMBER>){
     reviewThreads(first:100){totalCount pageInfo{hasNextPage endCursor}
       nodes{id isResolved path line comments(last:2){nodes{author{login} body}}}}
   }}}'

   # レビュー本文（Bot が書いた、本文がレビューの形をしている最新のものを読む）
   gh api graphql -f query='
   {repository(owner:"<OWNER>",name:"<REPO>"){pullRequest(number:<PR_NUMBER>){
     reviews(last:100){nodes{author{__typename login} submittedAt body}}
   }}}'
   ```

2. **妥当性の検証**
   - 指摘の前提を自分で確かめる。「テストが落ちる」と書かれていたら実際に走らせ、数値が
     書かれていたら自分で計算する
   - 前提が誤っていれば、根拠（実行結果・計算過程）を添えて対応しない判断を返信し、
     PR 本文にも残す

3. **TDD で修正**
   - 失敗するテストを先に書き、実装後に通す
   - **実装を戻すとそのテストが落ちること**まで確認する（`git stash push <実装ファイル>` →
     テスト → `git stash pop`）
   - `act(...).then(...)` 形式で書かない。失敗が unhandled rejection として握り潰される

4. **検証**
   - `npm test` / `npm run typecheck` / 変更したファイルへの `npx eslint`
   - 実機（Electron）でも確認する。**起動したアプリは検証後に必ず自分で停止する**
   - `pkill -f` を使う前に `pgrep -fl` で対象を確認する。パターンにはリポジトリ名を含んだ
     パスを使い、無関係なプロセスを巻き込まない

5. **コミットとプッシュ**
   - `git add -A` は使わない（無関係な未追跡ファイルを巻き込む）。`git add -u` を使う
   - コミットメッセージは日本語・Conventional Commit 形式

6. **対応済みスレッドの Resolve**
   - **対応済みの指摘のみ** `resolveReviewThread` ミューテーションで Resolve する
     （未対応の指摘を機械的に Resolve しないこと）
   - 返信には「何が起きていたか」「どう直したか」「どのテストで固定したか」を書く

   ```bash
   gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' \
     -f t='<THREAD_ID>'
   ```

7. **PR 本文の更新**
   - コミットごとに「指摘 → 対応」の表を追記する。対応しない判断とその理由もここに残す

8. **再レビューの依頼と監視**
   - `bash scripts/request-copilot-review.sh <owner> <repo> <pr>` で依頼し、**登録されたことを
     出力で確認する**
   - `bash scripts/watch-pr-review.sh <owner> <repo> <pr> "<baseline>"` で監視を張り直す
   - 収束の判断は監視が出す `NO FINDINGS` で行う。`NO PENDING REVIEW` や `WATCH TIMEOUT` は
     「指摘なし」ではない
   - `NO FINDINGS` が出た場合も、それだけで収束と判断しない。GraphQL で `reviews` と
     `reviewThreads` の最新を直接確認してから収束と判断する
   - `GITHUB_TOKEN`（GitHub Actions）からは Copilot レビューをトリガーできないため、必ず
     ローカルターミナルから実行する
   - REST の `pulls/:number/requested_reviewers` は bot を返さないため、依頼も確認も GraphQL で
     行う（スクリプトがそうしている）

# コーディングルール（汎用）

## 型定義

型としてのみ使用する import は必ず `import type` を使用する。これにより実行時バンドルへの不要な依存混入を防ぎ、意図が明確になる。

```typescript
// ✅ 正しい — 型のみ使用する場合
import type { Foo } from '@/types/foo'

// ❌ 間違い — 型のみ使うのに値 import になっている
import { Foo } from '@/types/foo'
```

## コンポーネント設計

- **'use client'**: クライアントコンポーネントには必ず宣言
- **ダークモード対応**: Tailwindの `dark:` プレフィックスを使用
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

色スウォッチなど「どれが選択中か」を視覚的に表現する場合、支援技術にも状態を伝える。グループコンテナに `role="radiogroup"`、各選択肢に `role="radio"` + `aria-checked={isSelected}` を付与する。

### 混在状態の表現

`undefined` が「未選択/デフォルト」として有効な値である場合、「複数の値が混在している」状態を `undefined` で表してはならない。`null` などの別の sentinel 値を使い、`undefined` と明確に区別すること。

### React の `key`

リストレンダリングでは表示文言（label）を `key` に使わない。`undefined` になり得る値には固定フォールバック文字列（例: `"__default__"`）を使い、安定した識別子を `key` にする。

```tsx
// ❌ 悪い例 — 文言変更や i18n 対応で key が変わり不要な再マウントが起きる
{
  items.map((item) => <button key={item.label} />)
}

// ✅ 良い例 — value は安定した識別子。undefined には固定フォールバックを使う
{
  items.map((item) => <button key={item.value ?? '__default__'} />)
}
```

```tsx
// ❌ 悪い例 — ring だけでは支援技術に選択状態が伝わらない
<div className="flex gap-1">
  {colors.map((c) => (
    <button key={c.value} className={isSelected ? "ring-2" : ""} />
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
// beforeEach で activeIntervalId = null にリセット
// afterEach で clearInterval(activeIntervalId) してから jest.useRealTimers()
```

## ドキュメントの同期管理

コードを変更した際は、関連するドキュメントも必ず同時に更新する。

- **コード例の同期**: ドキュメントに掲載しているコードサンプルは、実装を変更したタイミングで現行コードと一致しているか確認し、ずれがあれば同じコミットで修正する。
- **過去の状態と現在の状態の区別**: バグ修正記録で「修正前の状態」を記述する場合は、過去形（「〜していた」「〜だった」）を使い、現在も同じ状態であるかのような誤読を防ぐ。
- **修正済みであることの明記**: 「このPRで修正」「このコミットで変更」など、どのタイミングで対応したかを明記する。

## Hooks・関数の実装ルール

### デフォルト引数の参照安定性

カスタム hook やファクトリー関数のオプション引数に関数デフォルトを設定する場合、`(arg) => fn(arg)` のようなラッパーを使わず、`fn` を直接渡す。ラッパーは呼び出しごとに新しいインスタンスを生成し、`useCallback` などの依存配列が常に変化する原因になる。

```ts
// ❌ 悪い例 — 毎レンダーで新しい関数インスタンスが生成される
const useFoo = ({ onConfirm = (msg) => confirm(msg) } = {}) => {
  const handler = useCallback(() => {
    onConfirm('...')
  }, [onConfirm])
}

// ✅ 良い例 — confirm は安定した参照なので useCallback の依存が変化しない
const useFoo = ({ onConfirm = confirm } = {}) => {
  const handler = useCallback(() => {
    onConfirm('...')
  }, [onConfirm])
}
```

## 禁止事項

- **`git commit` / `git push` の自動実行** - ユーザーの明示的な指示なしにコミット・プッシュを行わない
