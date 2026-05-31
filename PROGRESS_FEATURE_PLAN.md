# 開発進捗管理機能 設計プラン

開発タスクが「プラン作成」から「PR マージ」までのワークフローのどの段階にあるかを
可視化・管理するための機能の設計プランです。

> このドキュメントは **設計プラン（仕様・画面設計・実装順）** であり、実装は別途行います。
> 記述順は **実装順（＝ワークフローの進行順）** に揃えています。

---

## 1. 概要・目的

- 1 つの開発タスクが、定義された **ステージ（状態）** をどこまで進んだかを管理する
- 「一度で終わるステージ」と「複数回繰り返すステージ」が混在するため、
  それぞれに適した表現で進捗を可視化する
- 各ステージの **履歴（いつ・何回・どんなメモ）** を残し、振り返り可能にする

---

## 2. 用語・状態モデル

### 2.1 タスク（Task）

開発作業の単位。1 タスクが 8 つのステージを順に進む。

### 2.2 ステージ（Stage）

ワークフロー上の各段階。実装順（進行順）は以下のとおり。

| #   | ステージ                   | 種別     | 完了条件の例                          |
| --- | -------------------------- | -------- | ------------------------------------- |
| 1   | プラン作成                 | 改訂あり | 実装方針が定まり承認された            |
| 2   | 機能の実装                 | 進行中   | 想定した機能が一通り動作する          |
| 3   | 単一責任にリファクタリング | 繰り返し | 責務分割が完了し可読性が確保された    |
| 4   | ローカルレビュー           | 繰り返し | セルフ/ローカルでの指摘が解消された   |
| 5   | コミット                   | 繰り返し | 変更がコミットされた                  |
| 6   | PR 作成                    | 一度きり | PR が作成された                       |
| 7   | PR コードレビュー          | 繰り返し | レビュー指摘が解消され approve された |
| 8   | PR マージ                  | 一度きり | PR がマージされた                     |

### 2.3 ステージの種別（繰り返し可否）

機能設計上、ステージを次の 3 種別に分類する。

- **一度きり（once）**: 完了すると再発生しない。状態は「未完了 / 完了」の 2 値。
  - 対象: `PR 作成`, `PR マージ`
- **繰り返し（repeatable）**: 複数回発生しうる。**回数と履歴** を持つ。
  - 対象: `単一責任にリファクタリング`, `ローカルレビュー`, `コミット`, `PR コードレビュー`
- **改訂あり / 進行中（revisable）**: 基本は 1 つだが更新・やり直しが起こりうる。
  履歴を持てると望ましい。
  - 対象: `プラン作成`, `機能の実装`

### 2.4 ステージのステータス

各ステージは次のステータスを取りうる。

- `not_started`（未着手）
- `in_progress`（進行中）
- `done`（完了）
- `skipped`（スキップ。例: リファクタ不要だった場合）

### 2.5 状態遷移の考え方

- 原則として上から順に進む（1 → 8）
- 繰り返しステージは `done` の後でも、後続ステージから戻って再度 `in_progress` に
  できる（例: PR コードレビュー指摘 → リファクタリングへ戻る）
- 戻った場合、前に `done` だった後続ステージは「再確認が必要」状態として扱う

---

## 3. ステージ詳細（実装順）

### 3.1 プラン作成（revisable）

- 目的: 実装方針・スコープを決める
- 完了条件: 方針が定まり承認される
- 履歴: 改訂のたびに版を残せると望ましい

### 3.2 機能の実装（revisable / in_progress 中心）

- 目的: 計画した機能を実装する
- 完了条件: 想定機能が一通り動作する
- 履歴: 着手・完了のタイムスタンプ

### 3.3 単一責任にリファクタリング（repeatable）

- 目的: 責務を分割し単一責任に整える
- 完了条件: 対象範囲の責務分割が完了
- 履歴: 実施ごとに「対象・内容メモ・日時」を記録（複数回）

### 3.4 ローカルレビュー（repeatable）

- 目的: コミット前にローカル/セルフでレビューする
- 完了条件: ローカル指摘が解消
- 履歴: レビュー実施ごとに記録（複数回）

### 3.5 コミット（repeatable）

- 目的: 変更を記録する
- 完了条件: コミット済み
- 履歴: コミットごとに「ハッシュ・メッセージ・日時」を記録（複数回）

### 3.6 PR 作成（once）

- 目的: プルリクエストを作成する
- 完了条件: PR が作成済み
- 履歴: 1 回。PR 番号・URL を保持

### 3.7 PR コードレビュー（repeatable）

- 目的: レビュー指摘に対応する
- 完了条件: 指摘が解消され approve される
- 履歴: レビューラウンドごとに「指摘件数・対応状況・日時」を記録（複数回）

### 3.8 PR マージ（once）

- 目的: PR をマージする
- 完了条件: マージ済み
- 履歴: 1 回。マージ日時・マージコミットを保持

---

## 4. データモデル

```text
Task
  id: string
  title: string
  createdAt: number
  updatedAt: number
  currentStageId: StageId        // 現在アクティブなステージ
  stages: Stage[]

Stage
  id: StageId                    // 'plan' | 'implement' | 'refactor' | ...
  kind: 'once' | 'repeatable' | 'revisable'
  status: 'not_started' | 'in_progress' | 'done' | 'skipped'
  events: StageEvent[]           // 履歴（繰り返し/改訂で複数件）

StageEvent
  id: string
  occurredAt: number
  note?: string                  // メモ
  meta?: Record<string, string>  // コミットハッシュ, PR 番号など
```

- `once` ステージは `events` を最大 1 件として扱う
- `repeatable` / `revisable` ステージは `events` を複数件保持し、回数 = `events.length`

---

## 5. 画面設計

### 5.1 全体レイアウト（縦ステッパー / タイムライン）

```text
┌────────────────────────────────────────────┐
│  タスク: ◯◯機能の追加         進捗 5/8       │
├────────────────────────────────────────────┤
│ ● 1. プラン作成            done   [v] 履歴1  │
│ │                                            │
│ ● 2. 機能の実装            done   [v]        │
│ │                                            │
│ ● 3. リファクタリング      done ×2 [v] 履歴  │  ← 繰り返し: 回数バッジ
│ │                                            │
│ ◐ 4. ローカルレビュー      進行中 ×1 [v]     │  ← 現在地を強調
│ │                                            │
│ ○ 5. コミット              未着手            │
│ │                                            │
│ ○ 6. PR 作成               未着手 (一度きり) │
│ │                                            │
│ ○ 7. PR コードレビュー     未着手            │
│ │                                            │
│ ○ 8. PR マージ             未着手 (一度きり) │
└────────────────────────────────────────────┘
```

### 5.2 ステージ行の構成要素

- **状態アイコン**: `●`=完了 / `◐`=進行中 / `○`=未着手 / `⊘`=スキップ
- **ステージ名**
- **種別ラベル**: 一度きりステージには `(一度きり)` を明示
- **回数バッジ**: 繰り返し/改訂ステージのみ `×N`（N = 実施回数）を表示
- **展開トグル `[v]`**: 履歴の開閉

### 5.3 繰り返しステージ vs 一度きりステージの表現差

| 観点         | 一度きり（once）         | 繰り返し（repeatable/revisable）       |
| ------------ | ------------------------ | -------------------------------------- |
| 状態表現     | 未完了 / 完了 のチェック | ステータス + 回数バッジ `×N`           |
| 履歴展開     | 1 件（または非表示）     | 複数件のリスト（日時・メモ・メタ情報） |
| 主アクション | 「完了にする」           | 「実施を記録する（+ 追加）」           |
| 戻り操作     | 原則なし                 | 後続から戻って再実施が可能             |

### 5.4 展開時の履歴表示（繰り返しステージ）

```text
● 3. リファクタリング   done ×2  [∧]
   ├─ 2026/05/31 10:20  PromptItem を分割
   └─ 2026/05/31 11:05  hooks の責務整理
   [ + 実施を記録する ]
```

### 5.5 操作

- 各ステージの主アクションボタン
  - once: `完了にする` / `未完了に戻す`
  - repeatable: `実施を記録する`（メモ入力可）
- 現在ステージの次への進行ボタン
- ステージのスキップ操作（リファクタ不要時など）

### 5.6 凡例

画面下部または別枠に状態アイコン・種別の凡例を表示する。

---

## 6. 実装ステップ（このプラン自身の進め方）

本機能自体も、本ドキュメントで定義したワークフロー順に実装する。

1. **プラン作成**: 本ドキュメント（完了）
2. **機能の実装**: 状態モデル・データ層 → ステッパー UI → 操作（記録/完了/戻る）
3. **単一責任にリファクタリング**: ステージ行・履歴・状態管理フックを責務分割
4. **ローカルレビュー**: セルフレビュー・テスト追加
5. **コミット**: Conventional Commits 形式で段階的にコミット
6. **PR 作成**: PR を作成
7. **PR コードレビュー**: 指摘対応（複数ラウンド想定）
8. **PR マージ**: マージ

---

## 7. 実装方針（現状のアーキテクチャからの想定）

> 本リポジトリの既存機能（プロンプト機能）と同じレイヤ構成・命名規約に倣う想定です。
> 確定仕様ではなく、現状コードから読み取れる範囲での実装イメージです。

### 7.1 レイヤ構成とファイル配置

既存のプロンプト機能は以下のレイヤで構成されており、本機能も同じ流れで実装する。

```text
shared/types.ts                         … 型定義（Task / Stage / StageEvent）
main/progressStore.ts                   … 永続化（userData/progress.json）
main/progressUtils.ts                   … バリデーション / サニタイズ
main/handlers/progressHandlers.ts       … IPC ハンドラ（load / save）
main/ipcHandlers.ts                     … registerProgressHandlers の登録
preload/api.ts, preload/index.d.ts      … window.api への公開
renderer/src/lib/progressApi.ts         … window.api の薄いラッパ
renderer/src/lib/taskFactory.ts         … createTask / createStageEvent
renderer/src/lib/stageMachine.ts        … 状態遷移の純粋関数
renderer/src/config/stageConfig.ts      … ステージ定義（順序・種別）
renderer/src/hooks/useProgressTasks.ts  … ロード/保存・ミューテーション
renderer/src/components/progress/*      … ProgressPanel / StageStepper など
```

### 7.2 型定義（`src/shared/types.ts` に追加）

既存の `Prompt` 型と同様に shared に置き、main / renderer 双方から参照する。

```ts
export type StageId =
  | 'plan'
  | 'implement'
  | 'refactor'
  | 'localReview'
  | 'commit'
  | 'prCreate'
  | 'prReview'
  | 'prMerge'

export type StageKind = 'once' | 'repeatable' | 'revisable'
export type StageStatus = 'not_started' | 'in_progress' | 'done' | 'skipped'

export type StageEvent = {
  id: string
  occurredAt: number
  note?: string
  meta?: Record<string, string> // 例: { commit: 'abc123' } / { prNumber: '14' }
}

export type Stage = {
  id: StageId
  status: StageStatus
  events: StageEvent[]
}

export type Task = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  currentStageId: StageId
  stages: Stage[]
}
```

### 7.3 永続化（`src/main/progressStore.ts`）

`promptStore.ts` のパターンをそのまま踏襲する。

- 保存先: `app.getPath('userData')` 配下の `progress.json`
- 読み込み: `readFile` → `JSON.parse` → `Array.isArray` チェック →
  `isValidTask` でフィルタ → `sanitizeTask`
- 書き込み: **書き込みキュー**（`writeQueue`）で並行 `writeFile` 競合を防止
- `ENOENT`（未作成）は空配列を返す

### 7.4 バリデーション（`src/main/progressUtils.ts`）

`promptUtils.ts` と同様、`isValidTask` / `sanitizeTask` を用意する。

- `StageId` / `StageKind` / `StageStatus` は許可値の集合に含まれるか検証
- `events[]` の各要素の `occurredAt` は `Number.isFinite` で検証
- 不正なタスク・ステージは除外し、未知のプロパティは落として保存

### 7.5 IPC（main / preload）

既存の `prompts:load` / `prompts:save` と同じ 2 本構成。

```ts
// main/handlers/progressHandlers.ts
ipcMain.handle('progress:load', async () => loadTasks())
ipcMain.handle('progress:save', async (_e, payload: unknown) => {
  if (!Array.isArray(payload)) throw new Error('引数は配列である必要があります')
  return saveTasks(payload.map(toTask))
})
```

- `src/main/ipcHandlers.ts` に `registerProgressHandlers(ipcMain)` を追加
- `src/preload/api.ts` に `loadTasks` / `saveTasks` を追加
- `src/preload/index.d.ts` の `window.api` 型に同メソッドを追記

### 7.6 renderer 側 lib（api / factory）

```ts
// lib/progressApi.ts
export function loadTasks(): Promise<Task[]> {
  return window.api.loadTasks()
}
export function saveTasks(tasks: Task[]): Promise<void> {
  return window.api.saveTasks(tasks)
}

// lib/taskFactory.ts
export function createTask(title: string): Task {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    currentStageId: 'plan',
    stages: STAGES.map((s) => ({ id: s.id, status: 'not_started', events: [] }))
  }
}
export function createStageEvent(note?: string, meta?: Record<string, string>): StageEvent {
  return { id: crypto.randomUUID(), occurredAt: Date.now(), note, meta }
}
```

`createPrompt` と同じく `crypto.randomUUID()` / `Date.now()` を使用する。

### 7.7 ステージ定義（`src/renderer/src/config/stageConfig.ts`）

ステージの **順序・表示名・種別** を 1 箇所に集約する（UI と状態遷移の両方が参照）。

```ts
export const STAGES = [
  { id: 'plan', label: 'プラン作成', kind: 'revisable' },
  { id: 'implement', label: '機能の実装', kind: 'revisable' },
  { id: 'refactor', label: '単一責任にリファクタリング', kind: 'repeatable' },
  { id: 'localReview', label: 'ローカルレビュー', kind: 'repeatable' },
  { id: 'commit', label: 'コミット', kind: 'repeatable' },
  { id: 'prCreate', label: 'PR 作成', kind: 'once' },
  { id: 'prReview', label: 'PR コードレビュー', kind: 'repeatable' },
  { id: 'prMerge', label: 'PR マージ', kind: 'once' }
] as const satisfies readonly { id: StageId; label: string; kind: StageKind }[]
```

### 7.8 状態遷移ロジック（`src/renderer/src/lib/stageMachine.ts`）

副作用を持たない **純粋関数** として実装し、単体テストしやすくする。

- `recordStageEvent(task, stageId, event)`: 繰り返し系。`events` に追加し
  `status` を `in_progress`/`done` に更新
- `completeStage(task, stageId)`: 一度きり系。`status='done'`、必要なら `events` を 1 件化
- `reopenStage(task, stageId)`: 後続から戻る。対象を `in_progress` にし、
  後続の `done` を「要再確認」に落とす（種別に応じて）
- `skipStage(task, stageId)`: `status='skipped'`
- `advanceCurrentStage(task)`: `currentStageId` を次に進める
- いずれも新しい `task` を返し、`updatedAt` を更新（イミュータブル更新）

### 7.9 フック（`src/renderer/src/hooks/useProgressTasks.ts`）

`usePrompts` + `usePromptsPersistence` のパターンを踏襲。

- 起動時に `loadTasks()`、ロード前ミューテーションは
  `pendingOperationsMerger` 同様の仕組みでマージ（必要なら汎用化）
- 変更系は `stageMachine` の純粋関数で次状態を計算 → `setState` → `saveTasks`
- 公開 API 例: `addTask` / `recordEvent` / `completeStage` / `reopenStage` /
  `skipStage` / `advanceStage`

### 7.10 UI コンポーネント（`src/renderer/src/components/progress/`）

責務ごとに分割（単一責任）。

- `ProgressPanel.tsx`: パネル全体。タスク選択 + ステッパー
- `StageStepper.tsx`: 縦ステッパー。`STAGES` を順に描画
- `StageRow.tsx`: 1 ステージ行。状態アイコン・回数バッジ・展開トグル
- `StageHistory.tsx`: 展開時の履歴リスト + 「実施を記録する」
- `StageActions.tsx`: 種別に応じた操作ボタン（once/repeatable で分岐）

アクティビティバー・サイドバーへの組み込み:

- `src/renderer/src/types.ts` の `Panel` に `'progress'` を追加
- `src/renderer/src/config/activityBarPanels.ts` にエントリ追加（アイコン用意）
- `src/renderer/src/config/sidebarTitles.ts` にタイトル追加
- `src/renderer/src/components/Sidebar.tsx` に `PanelContainer` + `ProgressPanel` 追加
- 状態は `useAppState` 経由で配線（既存パネルと同様）

### 7.11 種別による UI 分岐（要点）

- `kind==='once'`: チェック表示。主ボタンは「完了にする / 未完了に戻す」。回数バッジ非表示
- `kind==='repeatable'`: `×N` バッジ + 履歴リスト。主ボタンは「実施を記録する」
- `kind==='revisable'`: 基本 1 件だが履歴を許容。改訂で `events` 追加可
- `key` には `stage.id`（安定 ID）を使用。表示ラベルを `key` にしない（規約準拠）

### 7.12 アクセシビリティ / ダークモード（既存規約に準拠）

- クライアントコンポーネントには `'use client'` を付与
- ステータスアイコン・操作ボタンに `aria-label`
- ステッパーは `role="list"` / 各行 `role="listitem"`、現在地は `aria-current="step"`
- Tailwind の `dark:` プレフィックスでダークモード対応

### 7.13 テスト方針（vitest + Testing Library）

- `stageMachine` 純粋関数: 遷移・履歴追加・戻り・skip の単体テスト（最重要）
- `taskFactory`: 初期ステージ生成・UUID/タイムスタンプ
- `progressUtils`: `isValidTask` の不正入力除外
- `useProgressTasks`: ロード/保存・ミューテーション・ロード前マージ
- コンポーネント: once/repeatable の表示差・記録/完了操作・履歴展開
- main `progressStore`: load の ENOENT、書き込みキューの直列化

### 7.14 段階的な実装順（PR 分割の目安）

1. shared 型 + main store/utils + IPC + preload（永続化の土台）
2. renderer lib（api/factory）+ `stageMachine` + テスト
3. `useProgressTasks` フック + テスト
4. UI（ProgressPanel / Stepper / Row / History）+ パネル組み込み
5. リファクタリング（責務分割）・アクセシビリティ仕上げ・テスト拡充

---

## 8. 今後の拡張余地

- [ ] 複数タスクの一覧・横断進捗ダッシュボード
- [ ] ステージ定義のカスタマイズ（プロジェクトごとに段階を追加/削除）
- [ ] Git / PR 連携による自動進捗更新（コミット・PR 作成・マージを自動検知）
- [ ] ステージ滞留時間の可視化・ボトルネック分析
- [ ] テンプレート（よく使うワークフロー）からのタスク生成
