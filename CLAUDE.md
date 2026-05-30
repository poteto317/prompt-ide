# 共通ルール

- **すべての返答・コードレビューコメント・提案は必ず日本語で行うこと。** ただしコードブロック・技術固有名詞・ライブラリ名はそのまま英語表記でよい。
- コードの修正や提案を行った後は、必ずターミナルで検証コマンドを実行して動作確認を行うこと。
- 修正内容に自信がある場合でも、検証ステップを省略しないこと。
- **`git commit` や `git push` はユーザーから明示的に指示がある場合のみ実行すること。** 自動実行は禁止。

# PR レビューフロー

PR へのコミットをプッシュした後は、以下の手順を必ず実施すること。

1. **未解決スレッドの確認**
   - `gh api graphql` で PR の reviewThreads を取得し、未解決スレッドがないか確認する
   - 未解決スレッドがある場合は `resolveReviewThread` ミューテーションですべて Resolve してから次へ

2. **コードレビューの依頼**
   - 未解決スレッドが 0 件になったら `/code-review` スキルを実行してレビューを依頼する

# コーディングルール（汎用）

## 型定義

型としてのみ使用する import は必ず `import type` を使用する。

```typescript
// ✅ 正しい
import type { Foo } from "@/types/foo";

// ❌ 間違い
import { Foo } from "@/types/foo";
```

## コンポーネント設計

- **'use client'**: クライアントコンポーネントには必ず宣言
- **アクセシビリティ**: `aria-label` を適切に設定

### ドラッグハンドルとスワイプの競合防止

スワイプジェスチャーを検知する祖先コンポーネントの内部にドラッグハンドルを配置する場合、ハンドルの `button` に `onTouchStartCapture` と `onMouseDownCapture` で `e.stopPropagation()` を設定する。`onPointerDownCapture` は dnd-kit の PointerSensor を無効化するため追加してはならない。

### 選択状態の ARIA

色スウォッチなど「どれが選択中か」を視覚的に表現する場合、グループコンテナに `role="radiogroup"`、各選択肢に `role="radio"` + `aria-checked={isSelected}` を付与する。

### 混在状態の表現

`undefined` が「未選択/デフォルト」として有効な値である場合、「複数の値が混在している」状態を `undefined` で表してはならない。`null` などの別の sentinel 値を使い、`undefined` と明確に区別すること。

### React の `key`

リストレンダリングでは表示文言（label）を `key` に使わない。`undefined` になり得る値には固定フォールバック文字列（例: `"__default__"`）を使い、安定した識別子を `key` にする。

```tsx
// ❌ 悪い例
{items.map((item) => <button key={item.label} />)}

// ✅ 良い例
{items.map((item) => <button key={item.value ?? "__default__"} />)}
```

## テスト

- **タイマーリークの防止**: テスト内で `setInterval` / `setTimeout` を使ったモック実装を書く場合は、返ってくる ID を変数に保持し、`afterEach` で必ず `clearInterval` / `clearTimeout` すること。

```typescript
// ❌ 悪い例 — interval ID を捨てているためテスト間をまたいでリークする
mockStart.mockImplementation((onTick: () => void) => {
  setInterval(onTick, INTERVAL_MS);
});

// ✅ 良い例 — ID を保持して afterEach で確実にクリアする
let activeIntervalId: ReturnType<typeof setInterval> | null = null;
mockStart.mockImplementation((onTick: () => void) => {
  activeIntervalId = setInterval(onTick, INTERVAL_MS);
});
// afterEach: clearInterval(activeIntervalId)
```

## ドキュメントの同期管理

コードを変更した際は、関連するドキュメントも必ず同時に更新する。

- **コード例の同期**: ドキュメントに掲載しているコードサンプルは、実装変更時に現行コードと一致しているか確認し、ずれがあれば同じコミットで修正する。
- **過去の状態と現在の状態の区別**: バグ修正記録で「修正前の状態」を記述する場合は過去形を使い、現在も同じ状態であるかのような誤読を防ぐ。

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
