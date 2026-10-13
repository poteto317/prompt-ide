# エージェントの変更の戻した操作の取り消しと記録の gc からの保護 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エージェントの変更のセクションで、直前の 1 回の戻す操作（行の `↶`・diff タブのハンク・`すべて戻す`）を帯の `戻した操作を取り消す` で取り消せるようにし、記録中だけ専用の ref（`refs/prompt-ide/agent-changes/<instanceId>/<recordSerial>`）から記録の tree をたどれるようにして `git gc --prune=now` で記録の object が消えないようにする。

**Architecture:** main は、新規 `agentChangesProtectionRef.ts`（ref の名前・`cat-file --batch-check`・`mktree`・`update-ref -z --stdin` の compare-and-swap・同期の削除・読み直し・掃除）を registry の依存として受け、記録の形が変わるたびに所有者の列へ「保護の同期」を並べる。取り消しは新規 `agentChangesUndo.ts`（戻す前のバイト列の控え・戻した後の指紋・全件の照合・一時の名前 + `rename`/`link` の書き戻し）で行い、`agentChangesRevert.ts` の戻す 3 関数が検査と適用の間で控えを取る。控えは記録（`AgentChangesRecord.undo`）に持ち、registry の `commitRevertUndo`・`undoLastRevert` が `undoId` で照合して置き換え・実行する。IPC は戻す系の戻り値に `undo`・`undoSummary` を足し、新しい `agentChanges:undoRevert` を足す。renderer は、`useAgentChangesRevert` の実行の部分を `useAgentChangesWriteRunner` に切り出して戻す・取り消しで共有し、新規 `useAgentChangesUndo` と `AgentChangesUndoBand` で帯を出す。写しの `undo` は main の値を写し、戻す・取り消しの結果を受け取った時点（実行中の印を下ろす前）にも置き換える。

**Tech Stack:** Electron（main・preload）, React 19, TypeScript, Node の `fs/promises`・`child_process`（`spawn`・`spawnSync`）・`crypto`, simple-git, 実 git 2.50.1（結合テスト）, Vitest, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-13-agent-changes-revert-undo-and-gc-protection-design.md`（承認済み。実装の前に必ず読む）。前提の設計書 `docs/superpowers/specs/2026-10-06-agent-changes-review-design.md`・`docs/superpowers/specs/2026-10-12-agent-changes-runs-and-auto-refresh-design.md`。

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
> - 取り消しの実行（照合と書き戻し。`undoLastAgentRevert`）は、設計書の分割案の Task 4 ではなく **Task 3** に含める（git を使わず実ファイルだけで単体テストできるため、控え・照合・書き戻しの部品と同じタスクにする）。Task 4 は戻す操作への組み込み・registry の `commitRevertUndo`・`undoLastRevert`・`undoId` の採番・実 git の往復の結合テスト。
> - 新しい共有の型（`AgentChangesUndoAction`・`AgentChangesUndoOperation`・`AgentChangesUndoSummary`・`AgentRevertUndoUnavailableReason`・`AgentRevertUndoOutcome`・`AgentRevertResult`・`AgentRevertAllResult`・`AgentChangesUndoResult`）は Task 3 で足す（main が先に使う）。既存の型（`AgentChangesState` の `recording`・`AgentChangesListResult`・preload の戻す系の戻り値）の変更は Task 5 で行う。
> - `AgentRevertAllResult` に **`revertedCount: number`（戻せた件数）** を足す。`すべて戻す` の `partial` の警告の `<理由>ため、戻せた k 件は取り消せません` の k は、控えが取れなかったときに `undoSummary` から分からないため。
> - 戻す関数の文脈 `AgentRevertContext` に **`undo: AgentChangesUndoCaptureOptions`（`{ tempRoot: string; maxBytes: number }`。必須）** を足す。控えは毎回取る（取らない経路を作らない）ため、置き場所と上限だけを渡す。handler の依存 `AgentChangesHandlerDeps` に `undoCapture: AgentChangesUndoCaptureOptions` を足し、`ipcHandlers.ts` が `{ tempRoot: tmpdir(), maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES }` を渡す。テストは fixture の `tempRoot` を渡して後始末し、上限を小さくして境界を試す。
> - 戻す関数が例外で終わった（適用が 0 件）ときは、handler が `commitRevertUndo` を **呼ばない**（設計書の「適用が 0 件: 前の控えを残す」を、呼ばないことで満たす）。`commitRevertUndo(ownerId, record, commit)` の `commit` は `{ operation: AgentChangesUndoOperation; capture: AgentChangesUndoCapture }`。
> - 作り直しの「目的の名前に直接書く」方式（`link` が `EPERM`・`ENOTSUP`・`EXDEV`）は、`open(パス, 'wx', before.mode)` の権限が umask で欠けるため、書いた後に `chmod(before.mode)` も行う（作り直したファイルの権限を `before.mode` にする要件を、この経路でも満たす）。
> - `cat-file --batch-check` は、`<ID> tree <大きさ>` と答えた項目だけを使う（`missing` のほか、tree 以外の種類と答えた項目も除く。tree 以外を `mktree` の `040000 tree` に入れると失敗し続けるため）。
> - 実行中（`runningOperation !== null`）に、一覧の上の理由（`shownReason`）が null で、帯も出ていない（写しの `undo` が null。取り消しの結果で帯が先に消えた直後など）ときは、帯の理由と同じ id（`undoReasonId`）の理由の要素をセクションに出す。押せない `確認を終える`・範囲の選択に必ず理由を結ぶため（パターン 126）。
> - 失敗の表示（`useAgentChangesWriteRunner` の `error`）は戻す・取り消しで共有し、今の `AgentChangesRevertState` の `error`・`errorPath`・`isErrorAnnouncedInDiff` のまま出す（取り消しの失敗も `revert.error` に `source: 'undo'` で出て、セクションの `role="alert"` で読まれる）。`AgentChangesUndoState` は失敗を持たない。
> - `AgentChangesRevertState.isReverting` と `AgentRevertAvailability.isReverting` は、Task 6（切り出し）で `runningOperation: AgentChangesRunningOperation | null` に置き換える（挙動は変えない。`source === 'undo'` の実行は Task 7 まで起きない）。
> - 戻す系の結果の読み上げは `agentChangesMessages.ts` の関数で作り、定数 `AGENT_CHANGES_HUNK_REVERTED_NOTICE` は `formatAgentChangesHunkRevertedNotice(undo)` に置き換える（Task 7）。
> - 保護の掃除に渡す「残す番号」は関数 `keepSerials: () => ReadonlySet<number>` で渡し、掃除が一覧の結果を受け取った後に `await` を挟まずに呼ぶ。
> - hook の無いディレクトリの用意は `prepareAgentChangesNoHooksDir(userDataPath): string`（`agentChangesProtectionRef.ts`。`mkdirSync`〈`recursive`・0700〉の失敗は握る）にし、`ipcHandlers.ts` が呼ぶ。`core.hooksPath` が存在しないディレクトリを指しても hook は動かない（設計書の確認の結果 5）ため、用意の失敗で保護を止めない。
> - 設計書のテスト方針の「前の記録の置き換えで前を消す」（`begin` の中の `previous !== undefined`）は、今の公開の操作の組み合わせでは起きない守り（同じ世代・同じフォルダの依頼は合流し、世代が変わった依頼は取れた記録を捨てる）のため、単体テストは書かない。同じ並べ方のコードは残す（Task 2）。
> - 実機テスト仕様書の AGC-086 の変数は、前提のテスト用のリポジトリの `R` と重なるため `R2` にする（Task 9）。AGC-026 に「終了が目に見えて遅れない」を足し、未確認事項 1 の Electron の `before-quit` の確認に当てる。
> - typecheck の期間: Task 1〜4 は既存の型を変えない（`npm run typecheck` が通る）。Task 5 は共有の型を変えるため、同じタスクで renderer の API（`lib/agentChangesApi.ts`）・テストの偽物（`__tests__/makeAgentChangesState.ts`・`__tests__/setup.ts`）・`useAgentChangesRevert` の呼び出しを合わせ、`npm run typecheck` を通したままにする。Task 7 で写し（`AgentChangesView`）に `undo` を足すときも、同じタスクで view を作るテストの値を合わせる。

## Global Constraints

- コメント・文言は日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`。ダークの配色は既存の `.agent-changes__*` と同じ色を使う
- **コミットしない。** 各タスクの最後は検証だけ（`npx vitest run <変更したテスト>`、タスクに書いた typecheck、変更した TypeScript のファイルへの `npx eslint --fix <ファイル>` → `npx eslint --max-warnings 0 <ファイル>`）
- 共有の型（`src/shared/types/agentChanges.ts`。後のタスクはこのとおりに使う）:
  ```ts
  import type { DiscardAllResult } from './git'
  /** 取り消しの動作。rewrite: 戻す前の内容へ書き戻す、recreate: ゴミ箱へ移したファイルを作り直す、trash: 戻すときに作り直したファイルをゴミ箱へ移す */
  export type AgentChangesUndoAction = 'rewrite' | 'recreate' | 'trash'
  /** 戻した操作の種類(帯の文言に使う) */
  export type AgentChangesUndoOperation = 'file' | 'hunk' | 'all'
  /** 取り消しの控えの要約(パスの昇順。renderer は帯・確認に使う。控えの一時ディレクトリは渡さない) */
  export interface AgentChangesUndoSummary {
    undoId: number
    operation: AgentChangesUndoOperation
    entries: { path: string; action: AgentChangesUndoAction }[]
  }
  export type AgentRevertUndoUnavailableReason = 'directory' | 'unsupported-type' | 'too-large' | 'capture-failed'
  export type AgentRevertUndoOutcome = { kind: 'saved' } | { kind: 'unavailable'; reason: AgentRevertUndoUnavailableReason }
  export interface AgentRevertResult { undo: AgentRevertUndoOutcome; undoSummary: AgentChangesUndoSummary | null }
  export type AgentRevertAllResult = DiscardAllResult & AgentRevertResult & { revertedCount: number }
  export type AgentChangesUndoResult =
    | { status: 'done'; restoredPaths: string[]; trashedPaths: string[]; undoSummary: AgentChangesUndoSummary | null }
    | { status: 'partial'; message: string; restoredPaths: string[]; trashedPaths: string[]; undoSummary: AgentChangesUndoSummary | null }
  // Task 5 から:
  // AgentChangesState の recording: { kind: 'recording'; startedAt: number; runs: AgentChangesRun[]; undo: AgentChangesUndoSummary | null }
  // AgentChangesListResult の recording・scope-unavailable にも undo: AgentChangesUndoSummary | null
  ```
  `restoredPaths`（書き戻した・作り直したパス）・`trashedPaths`（ゴミ箱へ移したパス）はリポジトリ相対（末尾の `/` なし）
- IPC（preload の関数名・チャンネル・引数・戻り値）: `revertAgentChange(path, scope)` → `agentChanges:revertFile` → `AgentRevertResult`、`revertAgentChangeHunk(path, patch, scope)` → `agentChanges:revertHunk` → `AgentRevertResult`、`revertAllAgentChanges(expected, scope)` → `agentChanges:revertAll` → `AgentRevertAllResult`、**新規** `undoAgentChangesRevert(undoId)` → `agentChanges:undoRevert` → `AgentChangesUndoResult`。`undoId` は必須（省略を既定に流さない。L-044）。検証の順序は「送信元のメインフレーム → `undoId`（`parseAgentChangesUndoId`。`Number.isSafeInteger` でない・1 未満で `undoId は 1 以上の整数である必要があります`）→ フォルダ（無ければ `AGENT_CHANGES_NO_RECORD_MESSAGE`）→ 記録の列」
- main の定数と文言（`src/main/agentChangesUndo.ts`）:
  - `AGENT_CHANGES_UNDO_MAX_BYTES = 100 * 1024 * 1024`、控えの一時ディレクトリの接頭辞 `AGENT_CHANGES_UNDO_TEMP_PREFIX = 'prompt-ide-agent-undo-'`、書き戻しの一時の名前の接頭辞 `AGENT_UNDO_WRITE_TEMP_PREFIX = '.prompt-ide-undo-'`（後ろに `randomBytes(8).toString('hex')` の 16 桁）
  - 控えの準備の失敗 `取り消しの準備に失敗したため、戻すのを中止しました: <path>`（`AGENT_UNDO_PREPARE_FAILED_MESSAGE` + `: <path>`）
  - 控えが無い・`undoId` が違う `取り消せる操作が変わりました。一覧を更新してください`（`AGENT_UNDO_STALE_MESSAGE`）
  - 全件の照合の不一致 `戻した後に変わったファイルがあるため、取り消せません（<listPathsForMessage(不一致のパス)>）`、読み込みの失敗だけ `取り消しの対象を読み込めませんでした（<listPathsForMessage(パス)>）: <最初の理由>`
  - 書き換えの途中: 1 件以上済み `取り消しが途中で失敗しました（k / n 件を取り消し済み）: <詳細>`（詳細は `<path> が戻した後に変わりました`・`<path> を読み込めませんでした: <理由>`・`<path>: <理由>`）、0 件 `戻した後に変わったファイルがあるため、取り消せません（<path>）`・`取り消しに失敗しました: <path> を読み込めませんでした: <理由>`・`取り消しに失敗しました: <path>: <理由>`
- 保護の ref: 名前 `refs/prompt-ide/agent-changes/<instanceId>/<recordSerial>`、`instanceId = ${process.pid}-${randomBytes(4).toString('hex')}`（`ipcHandlers.ts` で 1 回だけ作る）、`recordSerial` はインスタンスの中で 1 から増える整数（registry が累積の始点を取るたびに振る）。指す先は `mktree -z` の tree（項目 `baseline` と `run-<runId>`。`start.kind === 'snapshot'` の実行だけ）。git の設定は `core.hooksPath=<userData>/agent-changes-no-hooks`・`core.logAllRefUpdates=false`（`runBaselineGitWithInput` の `config` に渡す。`core.splitIndex=false` は関数が足す）。非同期は打ち切り 10 秒（`AGENT_BASELINE_GIT_TIMEOUT_MS`）、同期の削除は 1 つにつき 2 秒（`AGENT_CHANGES_PROTECTION_SYNC_TIMEOUT_MS = 2000`）
- 画面の文字（renderer。`lib/agentChangesMessages.ts` に置く）:
  - 帯 `直前に戻した操作: <対象>`、ボタン `戻した操作を取り消す`（`aria-label="直前に戻した操作（<対象>）を取り消す"`）。対象は `file` → `<path>`、`hunk` → `<path> のハンク`、`all` → `<件数> 件（すべて戻す）`（1 件でも `1 件（すべて戻す）`）
  - 取り消しの押せない理由: 戻す操作の実行中 `戻す操作の実行中です`（既存の `AGENT_CHANGES_BUSY_REVERTING`）、取り消しの実行中 `取り消しの実行中です`（`AGENT_CHANGES_BUSY_UNDOING`）、他の Git 操作 `他の Git 操作の実行中です`（既存の `AGENT_CHANGES_BUSY_GIT`）。この 3 つだけ（一覧の取得中・失敗では押せる）
  - 戻す確認の取り消せる旨 `戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。`、取り消せない旨（フォルダ）`フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。`
  - 戻した結果 `N 件を実行前の状態に戻しました。「戻した操作を取り消す」で取り消せます`・`N 件を実行前の状態に戻しました。<理由>ため、この操作は取り消せません`（理由: `directory` → `フォルダを含む`、`unsupported-type` → `ファイル以外のものを含む`、`too-large` → `内容が大きすぎる`、`capture-failed` → `戻した後の状態を控えられなかった`）
  - ハンクを戻した結果 `ハンクを実行前の状態に戻しました。ソース管理の「エージェントの変更」で取り消せます`・`ハンクを実行前の状態に戻しました。<理由>ため、この操作は取り消せません`
  - すべて戻すの `partial` の警告 `<main の警告>。戻せた k 件は「戻した操作を取り消す」で取り消せます`・`<main の警告>。<理由>ため、戻せた k 件は取り消せません`
  - 取り消しの確認 `直前に戻した操作を取り消しますか？次のファイルが、戻す前の内容に戻ります。` + `\n\n` + パス（1 行に 1 つ、最大 5 件。超えたら最後の行に `ほか N 件`）+ 該当するときだけ `\n\n` 区切りで `うち M 件は、戻したときに作り直したファイルのため、ゴミ箱へ移動します。`・`ゴミ箱へ移したファイルは、ゴミ箱に残したまま元の場所に作り直します。`・`エディタの未保存の編集も破棄されます。`・`エージェントが動いている間は、取り消した後に同じファイルが書き換えられることがあります。`
  - 取り消しの結果 `戻した操作を取り消しました（N 件）`（N は `restoredPaths.length + trashedPaths.length`）
- 実行の共有: `useAgentChangesWriteRunner` の `run<T>(source, path, execute, hooks)`（`source: 'file' | 'hunk' | 'all' | 'undo'`）。実行中の印 `runningOperation` は `source === 'undo'` なら `'undo'`、それ以外は `'revert'`。`hooks.onResult`・`hooks.onError` は実行中の印を下ろす `finally` より前に、記録の世代に関わらず呼ぶ。`hooks.onFailure` は記録の世代が同じときだけ失敗の表示の後に呼ぶ
- 写しの `undo` の即時の反映: `useAgentChanges` の `applyUndoSummary(summary, startedAt)`。今の写しが記録中で `startedAt` が同じときだけ置き換える。戻す・取り消しの hook は依頼の前に写しの `startedAt` を控え、`onResult` で `applyUndoSummary(result.undoSummary, startedAt)`、`onError` で `applyUndoSummary(null, startedAt)` を呼ぶ
- `react-hooks/set-state-in-effect`（eslint-plugin-react-hooks 7）: effect の本体で setState を直接呼ぶと lint が落ちる。値の変化の後始末は既存の `useOnChange` を使う
- テストの規約: タイマー（`vi.useFakeTimers()`）は `afterEach` で `vi.useRealTimers()` まで戻す（CLAUDE.md のタイマーリークの防止）。`act(...).then(...)` で書かない（Promise は変数に控え、`await act(async () => { ... })` の中で待つ）。`console.error`・`console.warn` の spy は `afterEach` で戻す。テストの補助関数にも戻り値の型を書く（`@typescript-eslint/explicit-function-return-type`）。実 git のテストは `createAgentBaselineRepo` / `disposeAgentBaselineRepo`（`src/main/__tests__/helpers/agentBaselineFixtures.ts`）で準備・後始末する。実ファイルのテストは `mkdtempSync(join(tmpdir(), ...))` で作り `afterEach` で `rmSync(..., { recursive: true, force: true })` する
- 実装を戻すとテストが落ちることを、各タスクの TDD の手順で確かめる（失敗するテストを先に書いて走らせる）。変異のテスト（照合を外す・同期を外す）は、実装の該当行をコメントにしてテストが落ちることを確かめてから戻す

### 気をつける知見（dev-flow-kit の `lessons/review-lessons.md`）

- **L-001**（戻す操作は控えの成否〈`saved`・`unavailable`〉を、取り消しは書き戻した・ゴミ箱へ移したパスを結果で返し、renderer は結果で読み上げ・タブの同期を決める。保護の同期は成功したときだけ `value` を進める）: Task 2・3・4・5・7
- **L-002**（控えの準備・照合の読み込みの失敗を「無い」「一致」と読まない。ref の書き込みの失敗は読み直しで分類し、読み直しの失敗を「ref が無い」と読まない。終了コード 0 で出力が空のときだけ「無い」）: Task 1・2・3
- **L-003**（控えは作業ツリーを変える前に取り、取れなければ戻さない。前の控えを捨てるのは新しい戻す操作が作業ツリーを変えた後）: Task 3・4
- **L-004**（ref の更新・削除は自分が書いた値との compare-and-swap。掃除は自分の形の名前と値だけ。書き戻しの一時ファイルは自分が作れたものだけ消す。`commitRevertUndo` は捨てられた記録の控えを自分で消す）: Task 1・2・3・4
- **L-005**（取り消しが書き換えうるもの〈対象・親の各段・作り直す位置〉を照合で確かめる）: Task 3
- **L-006**（取り消しの動作を `before`・`after` の肯定の根拠で決める）: Task 3
- **L-008**（取り消しの後に書き戻したパスのタブを読み直し、ゴミ箱へ移したパスのタブを閉じる）: Task 7
- **L-010**（`close` は ref と一時ディレクトリの削除を、1 つが失敗しても残りを試す。取り消しの途中の失敗は `partial`）: Task 2・3・4
- **L-011**（照合は「無かったパスに現れた」「ディレクトリに置き換わった」「親がリンクになった」を不一致にし、作り直しは `EEXIST` で上書きしない）: Task 3
- **L-012**（確認の後の編集の再確認は足さない。確認はモーダルで承諾の直後に同期で実行を始める）: Task 7
- **L-014**（書き戻しは同じフォルダの一時ファイル + `rename`・`link`）: Task 3
- **L-018**（照合と書き換えは同じリポジトリ相対のパスから同じ規則〈`join(folderPath, path)`〉で求めた絶対パスに対して行う）: Task 3
- **L-019**（renderer が渡すのは `undoId` だけ。パス・控え・ref の名前は main が決め、renderer に一時ディレクトリ・ref の名前を返さない）: Task 5
- **L-034**（ref の名前と値は `update-ref -z --stdin` の標準入力で渡す。取り消しは git にパスを渡さない）: Task 1・3
- **L-035**（「直前の操作」を位置でなく `undoId` で指す）: Task 4・5・7
- **L-036**（取り消してよいかを中身・権限・種類の組で完全に照合する）: Task 3
- **L-037**（`undoId` を記録をまたいで重ならない値にし、写しの比較に `undo` を含める）: Task 4・7
- **L-038**（照合を全件済ませてから書き換え、途中の失敗で控えを捨てて `partial`）: Task 3・4
- **L-039**（結果の `undoSummary` を実行中の印を下ろす前に写しへ反映し、例外では帯を隠す。取り消しの後に状態を取り直し、実行中は戻す系と範囲の選択を押せなくする）: Task 6・7・8
- **L-040**（帯は一覧の結果の `undo` から出し、renderer で別の状態を持たない）: Task 7
- **L-101**（同じ `undoId` の 2 回目は main の列で直列になり失敗になる。renderer の実行中の守りはボタンの操作だけ）: Task 4・7
- **L-057**（取り消せない理由を確認・結果の読み上げで伝え、帯の押せない理由を見える文字で出して `aria-describedby` で結ぶ）: Task 7・8
- **L-058**（帯の `disabled` に加え、hook は写しに控えが無ければ何もせず、main は `undoId` を照合する）: Task 4・7・8
- **L-408**（戻す操作の後のフォーカスを取り消しのボタンへ移さない。ダブルクリックの 2 回目を無視し、`repeat` の Enter・Space を `preventDefault`）: Task 8
- **L-422**（照合は更新時刻でなく中身で比べる。保護の同期は記録のインデックスを写さない）: Task 2・3
- **L-423**（静かな取り直しは `undo` を含めた中身の比較で、変わったときだけ写しを置き換える）: Task 7
- **L-424**（取り消しの失敗は実行の共有の失敗の表示に出し、背景の取り直しで消えない）: Task 6・7

### ファイルの構成（作る・変えるもの）

| ファイル | 責務 | タスク |
| --- | --- | --- |
| `src/main/agentChangesProtectionRef.ts`（新規） | ref の名前の組み立てと解釈・項目の存在の確認・`mktree`・`create`/`update`/`delete`（非同期・同期）・読み直し・掃除・`isProcessAliveOnThisMachine`・`prepareAgentChangesNoHooksDir` | 1 |
| `src/main/agentBaselineGit.ts` | `runBaselineGitWithInputSync`（同期の版）、`runBaselineGitWithInput` の説明の更新 | 1 |
| `src/main/agentChangesRecord.ts` | `recordSerial`・`protection`・`undo` の項目、`createAgentChangesRecord`、`protectionTreeEntries`、`agentChangesRecordTempDirs` に控えの一時ディレクトリ | 2・4 |
| `src/main/agentBaselineRegistry.ts` | `recordSerial`・保護の同期・`protectedRecords`・`abandonedSerials`・`close` の ref の削除、`undoId` の採番・`commitRevertUndo`・`undoLastRevert`、依存 `protection`・`trash` | 2・4・5 |
| `src/main/agentChangesUndo.ts`（新規） | 控えの型・`startAgentChangesUndoRecorder`・指紋・照合・書き戻し・`undoLastAgentRevert`・要約 | 3 |
| `src/main/agentChangesRevert.ts` | 控えの準備と `after` の控えを挟み、結果に控えを返す | 4 |
| `src/main/handlers/agentChangesPayloadParser.ts` | `parseAgentChangesUndoId` | 5 |
| `src/main/handlers/agentChangesHandlers.ts` | 戻す系の結果の型と `commitRevertUndo`、`agentChanges:undoRevert` | 5 |
| `src/main/agentChangesScopedQuery.ts` | 一覧の結果に `undo` | 5 |
| `src/main/ipcHandlers.ts` | `instanceId`・hook の無いディレクトリ・registry の依存 `protection`・`trash`、handler の `undoCapture` | 2・5 |
| `src/shared/types/agentChanges.ts` | 上の共有の型 | 3・5 |
| `src/preload/api.ts`・`src/preload/index.d.ts` | `undoAgentChangesRevert`・戻り値の型 | 5 |
| `src/renderer/src/lib/agentChangesApi.ts` | 同上 | 5 |
| `src/renderer/src/hooks/useAgentChangesWriteRunner.ts`（新規） | 実行の共有 | 6 |
| `src/renderer/src/hooks/useAgentChangesRevert.ts` | 実行の共有を使う・結果の読み上げ・写しの `undo` の即時の反映 | 6・7 |
| `src/renderer/src/lib/agentChangesAvailability.ts` | `runningOperation`・`agentUndoDisabledReason` | 6・7 |
| `src/renderer/src/lib/agentChangesMessages.ts` | 確認・結果・取り消しの文言、対象の文言 | 6・7 |
| `src/renderer/src/types.ts`・`lib/agentChangesView.ts`・`hooks/useAgentChanges.ts` | 写しの `undo`・`applyUndoSummary` | 7 |
| `src/renderer/src/hooks/useAgentChangesUndo.ts`（新規） | 取り消し | 7 |
| `src/renderer/src/components/source-control/AgentChangesUndoBand.tsx`（新規） | 帯 | 8 |
| `src/renderer/src/components/source-control/AgentChangesSection.tsx`・`hooks/useAgentChangesWiring.ts`・`assets/main.css` | 帯の配置・`disabled`・`aria-describedby`・配線・CSS | 6・8 |
| `ROADMAP.md`・前の 2 つの設計書・`docs/manual-test-spec.md` | 記録の更新と実機テスト仕様書 | 9 |

---

### Task 1: 実測（未確認事項 1）と保護の ref の部品（`agentChangesProtectionRef.ts`・`runBaselineGitWithInputSync`）

**Files:**
- Create: `src/main/agentChangesProtectionRef.ts`
- Modify: `src/main/agentBaselineGit.ts`（import に `spawnSync`。`runBaselineGitWithInput` の JSDoc〈L115-120〉を「出力のある `mktree`・`cat-file`・`for-each-ref`・`ls-tree` にも使う」に直す。末尾に `runBaselineGitWithInputSync` を足す）
- Test: `src/main/__tests__/agentChangesProtectionRef.test.ts`（新規。純粋な解釈の関数・`isProcessAliveOnThisMachine`・`prepareAgentChangesNoHooksDir`）
- Test: `src/main/__tests__/agentChangesProtectionRef.integration.test.ts`（新規。**実 git**。設計書の確認の結果 1〜8 の回帰と掃除）
- Test: `src/main/__tests__/agentBaselineGit.spawn.test.ts`（`spawnSync` の偽物と `runBaselineGitWithInputSync` の describe）
- 一時ファイル（計測の後に消す）: `src/main/__tests__/agentChangesProtectionRef.timing.local.test.ts`

**Interfaces:**
- Consumes: `runBaselineGitWithInput(folderPath, indexPath, args, input, options?: BaselineGitOptions): Promise<string>`（`src/main/agentBaselineGit.ts`。終了コードが 0 でなければ reject）、`buildBaselineGitEnv`、`AGENT_BASELINE_GIT_TIMEOUT_MS`
- Produces:
```ts
// src/main/agentBaselineGit.ts
/** 同期で git を実行し、終了コード 0 なら true(打ち切り・起動の失敗・0 以外は false)。アプリの終了の ref の削除に使う */
export function runBaselineGitWithInputSync(
  folderPath: string,
  indexPath: string,
  args: readonly string[],
  input: string,
  options?: BaselineGitOptions
): boolean

// src/main/agentChangesProtectionRef.ts
export const AGENT_CHANGES_PROTECTION_REF_PREFIX = 'refs/prompt-ide/agent-changes/'
export const AGENT_CHANGES_PROTECTION_SYNC_TIMEOUT_MS = 2_000
export const AGENT_CHANGES_NO_HOOKS_DIR_NAME = 'agent-changes-no-hooks'
export interface ProtectionTreeEntry { name: string; tree: string }
export interface ProtectionGitContext { folderPath: string; indexPath: string; noHooksDir: string; timeoutMs?: number }
export interface ProtectionRefListing { refName: string; value: string; objectType: string }
export interface ParsedProtectionRefName { pid: number; instanceId: string; recordSerial: number }
export interface SweepProtectionRefsOptions {
  instanceId: string
  /** 残す番号。一覧を受け取った後に await を挟まずに呼ぶ */
  keepSerials: () => ReadonlySet<number>
  isProcessAlive: (pid: number) => boolean
}
export interface AgentChangesProtectionGit {
  filterExistingTrees(ctx: ProtectionGitContext, entries: readonly ProtectionTreeEntry[]): Promise<ProtectionTreeEntry[]>
  makeTree(ctx: ProtectionGitContext, entries: readonly ProtectionTreeEntry[]): Promise<string>
  create(ctx: ProtectionGitContext, refName: string, value: string): Promise<void>
  update(ctx: ProtectionGitContext, refName: string, value: string, expected: string): Promise<void>
  remove(ctx: ProtectionGitContext, refName: string, expected: string): Promise<void>
  removeSync(ctx: ProtectionGitContext, refName: string, expected: string): boolean
  read(ctx: ProtectionGitContext, refName: string): Promise<string | null>
  sweep(ctx: ProtectionGitContext, options: SweepProtectionRefsOptions): Promise<void>
}
export function createProtectionInstanceId(pid: number, randomHex: string): string
export function protectionRefName(instanceId: string, recordSerial: number): string
export function parseProtectionRefName(refName: string): ParsedProtectionRefName | null
export function parseBatchCheckOutput(output: string, entries: readonly ProtectionTreeEntry[]): ProtectionTreeEntry[]
export function parseProtectionRefListing(output: string): ProtectionRefListing[]
export function isOwnProtectionTreeListing(lsTreeOutput: string): boolean
export async function filterExistingProtectionTrees(ctx: ProtectionGitContext, entries: readonly ProtectionTreeEntry[]): Promise<ProtectionTreeEntry[]>
export async function makeProtectionTree(ctx: ProtectionGitContext, entries: readonly ProtectionTreeEntry[]): Promise<string>
export async function createProtectionRef(ctx: ProtectionGitContext, refName: string, value: string): Promise<void>
export async function updateProtectionRef(ctx: ProtectionGitContext, refName: string, value: string, expected: string): Promise<void>
export async function deleteProtectionRef(ctx: ProtectionGitContext, refName: string, expected: string): Promise<void>
export function deleteProtectionRefSync(ctx: ProtectionGitContext, refName: string, expected: string): boolean
export async function readProtectionRef(ctx: ProtectionGitContext, refName: string): Promise<string | null>
export async function listProtectionRefs(ctx: ProtectionGitContext): Promise<ProtectionRefListing[]>
export async function isOwnProtectionTree(ctx: ProtectionGitContext, value: string): Promise<boolean>
export async function sweepStaleProtectionRefs(ctx: ProtectionGitContext, options: SweepProtectionRefsOptions): Promise<void>
export function isProcessAliveOnThisMachine(pid: number): boolean
export function prepareAgentChangesNoHooksDir(userDataPath: string): string
export const protectionRefGit: AgentChangesProtectionGit
```

- [ ] **Step 1: 実測（未確認事項 1）**

`src/main/__tests__/agentChangesProtectionRef.timing.local.test.ts` を作る（計測の後に消す。コミットしない）:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitAll, runGit, writeRepoFile } from './helpers/realGitRepo'
import { createAgentBaselineRepo, disposeAgentBaselineRepo } from './helpers/agentBaselineFixtures'
import type { AgentBaselineRepo } from './helpers/agentBaselineFixtures'
import { runBaselineGitWithInput } from '../agentBaselineGit'

// 未確認事項 1: mktree・update-ref --stdin・spawnSync の削除の時間(Electron の before-quit の中の spawnSync は実機テスト仕様書の AGC-026 で確かめる)
let dirs: AgentBaselineRepo
let noHooks: string
beforeEach(() => {
  dirs = createAgentBaselineRepo('agent-protection-timing-')
  noHooks = mkdtempSync(join(tmpdir(), 'agent-protection-nohooks-'))
})
afterEach(() => {
  disposeAgentBaselineRepo(dirs)
  rmSync(noHooks, { recursive: true, force: true })
})

describe('計測', () => {
  it('mktree・update-ref・spawnSync の削除の時間を出す', async () => {
    writeRepoFile(dirs.repo, 'a.txt', 'a\n')
    commitAll(dirs.repo, 'init')
    const tree = runGit(dirs.repo, 'write-tree').trim()
    const config = { config: [`core.hooksPath=${noHooks}`, 'core.logAllRefUpdates=false'] }
    const index = join(dirs.repo, '.git/index')
    const times: Record<string, number[]> = { mktree: [], create: [], deleteSync: [] }
    for (let i = 1; i <= 20; i++) {
      let start = performance.now()
      const value = (
        await runBaselineGitWithInput(dirs.repo, index, ['mktree', '-z'], `040000 tree ${tree}\tbaseline\0`, config)
      ).trim()
      times.mktree.push(performance.now() - start)
      const ref = `refs/prompt-ide/agent-changes/1-00000000/${i}`
      start = performance.now()
      await runBaselineGitWithInput(dirs.repo, index, ['update-ref', '-z', '--stdin'], `create ${ref}\0${value}\0`, config)
      times.create.push(performance.now() - start)
      start = performance.now()
      const result = spawnSync('git', ['-c', `core.hooksPath=${noHooks}`, 'update-ref', '-z', '--stdin'], {
        cwd: dirs.repo,
        input: `delete ${ref}\0${value}\0`,
        timeout: 2000
      })
      times.deleteSync.push(performance.now() - start)
      expect(result.status).toBe(0)
    }
    const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
    console.log(JSON.stringify(Object.fromEntries(Object.entries(times).map(([k, v]) => [k, { median: median(v), max: Math.max(...v) }]))))
  })
})
```
Run: `npx vitest run src/main/__tests__/agentChangesProtectionRef.timing.local.test.ts`
Expected: PASS。出力の中央値・最大値（ミリ秒）を控え、タスクの報告に書く。中央値が 1 つでも 200ms を超えたら、続けずに止めて報告する（設計書は約 10ms を前提にしている）。控えたら `rm src/main/__tests__/agentChangesProtectionRef.timing.local.test.ts` で消す。

- [ ] **Step 2: 純粋な関数の失敗するテストを書く**

`src/main/__tests__/agentChangesProtectionRef.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createProtectionInstanceId,
  isOwnProtectionTreeListing,
  isProcessAliveOnThisMachine,
  parseBatchCheckOutput,
  parseProtectionRefListing,
  parseProtectionRefName,
  prepareAgentChangesNoHooksDir,
  protectionRefName
} from '../agentChangesProtectionRef'

const T1 = 'a'.repeat(40)
const T2 = 'b'.repeat(40)
// ls-tree -z の 1 行
const lsEntry = (type: string, name: string, sha = T1): string =>
  `${type === 'tree' ? '040000' : '100644'} ${type} ${sha}\t${name}\0`

afterEach(() => vi.restoreAllMocks())

describe('ref の名前', () => {
  it('instanceId は <pid>-<16 進>、名前は接頭辞/instanceId/番号', () => {
    expect(createProtectionInstanceId(123, '0a1b2c3d')).toBe('123-0a1b2c3d')
    expect(protectionRefName('123-0a1b2c3d', 4)).toBe('refs/prompt-ide/agent-changes/123-0a1b2c3d/4')
  })

  it('自分の形の名前だけを解釈する', () => {
    expect(parseProtectionRefName('refs/prompt-ide/agent-changes/123-0a1b2c3d/4')).toEqual({
      pid: 123,
      instanceId: '123-0a1b2c3d',
      recordSerial: 4
    })
  })

  it.each([
    'refs/prompt-ide/agent-changes/foo/1',
    'refs/prompt-ide/agent-changes/123-0A1B2C3D/1',
    'refs/prompt-ide/agent-changes/123-0a1b2c3/1',
    'refs/prompt-ide/agent-changes/123-0a1b2c3d/01',
    'refs/prompt-ide/agent-changes/123-0a1b2c3d/0',
    'refs/prompt-ide/agent-changes/0123-0a1b2c3d/1',
    'refs/prompt-ide/agent-changes/123-0a1b2c3d/1/x',
    'refs/heads/main'
  ])('形の違う名前 %s は null', (name) => {
    expect(parseProtectionRefName(name)).toBeNull()
  })
})

describe('parseBatchCheckOutput', () => {
  const entries = [
    { name: 'baseline', tree: T1 },
    { name: 'run-2', tree: T2 }
  ]
  it('tree と答えた項目だけを残す(missing・tree 以外は除く)', () => {
    expect(parseBatchCheckOutput(`${T1} tree 40\n${T2} missing\n`, entries)).toEqual([entries[0]])
    expect(parseBatchCheckOutput(`${T1} blob 3\n${T2} tree 9\n`, entries)).toEqual([entries[1]])
  })
  it('行の数・ID が入力と合わなければ例外(空の出力を「無い」と読まない。L-002)', () => {
    expect(() => parseBatchCheckOutput('', entries)).toThrow()
    expect(() => parseBatchCheckOutput(`${T2} tree 9\n${T1} tree 40\n`, entries)).toThrow()
  })
})

describe('parseProtectionRefListing', () => {
  it('1 行を名前・値・種類に分け、形の違う行は飛ばす', () => {
    const output = `refs/prompt-ide/agent-changes/1-00000000/1\0${T1}\0tree\nbroken-line\n`
    expect(parseProtectionRefListing(output)).toEqual([
      { refName: 'refs/prompt-ide/agent-changes/1-00000000/1', value: T1, objectType: 'tree' }
    ])
    expect(parseProtectionRefListing('')).toEqual([])
  })
})

describe('isOwnProtectionTreeListing', () => {
  it.each([
    ['baseline と run', lsEntry('tree', 'baseline') + lsEntry('tree', 'run-3'), true],
    ['run だけ(gc で始点が消えた後の値)', lsEntry('tree', 'run-3'), true],
    ['空', '', false],
    ['baseline が 2 つ', lsEntry('tree', 'baseline') + lsEntry('tree', 'baseline', T2), false],
    ['子の名前が違う', lsEntry('tree', 'other'), false],
    ['run の番号が 0 始まり', lsEntry('tree', 'run-01'), false],
    ['子が blob', lsEntry('blob', 'run-1'), false]
  ])('%s → %s', (_label, output, expected) => {
    expect(isOwnProtectionTreeListing(output)).toBe(expected)
  })
})

describe('isProcessAliveOnThisMachine', () => {
  it('自分の pid は生きている', () => {
    expect(isProcessAliveOnThisMachine(process.pid)).toBe(true)
  })
  it('ESRCH だけを死んでいるとみなす(EPERM は生きているとみなす)', () => {
    const kill = vi.spyOn(process, 'kill')
    kill.mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })
    expect(isProcessAliveOnThisMachine(99999)).toBe(false)
    kill.mockImplementation(() => {
      throw Object.assign(new Error('not permitted'), { code: 'EPERM' })
    })
    expect(isProcessAliveOnThisMachine(1)).toBe(true)
  })
})

describe('prepareAgentChangesNoHooksDir', () => {
  it('userData の下に 0700 の空のディレクトリを作り、そのパスを返す', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-nohooks-'))
    try {
      const dir = prepareAgentChangesNoHooksDir(root)
      expect(dir).toBe(join(root, 'agent-changes-no-hooks'))
      expect(statSync(dir).mode & 0o777).toBe(0o700)
      // 2 回目(起動のたび)も例外にしない
      expect(prepareAgentChangesNoHooksDir(root)).toBe(dir)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('作れなくても例外にせずパスを返す(存在しない hooksPath でも hook は動かない。確認の結果 5)', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-nohooks-'))
    try {
      const file = join(root, 'file')
      writeFileSync(file, 'x')
      expect(prepareAgentChangesNoHooksDir(file)).toBe(join(file, 'agent-changes-no-hooks'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 3: 実 git の失敗するテストを書く**

`src/main/__tests__/agentChangesProtectionRef.integration.test.ts`（`createAgentBaselineRepo` の `repo`・`tempRoot` と、`mkdtempSync` の hook の無いディレクトリを使う。各テストは `ctx = { folderPath: repo, indexPath: join(repo, '.git/index'), noHooksDir }`）。次のケースを書く（期待値どおりに `expect` する）:

1. **確認の結果 1**: `a.txt` をコミットし `tree = runGit(repo, 'write-tree').trim()`。`value = await makeProtectionTree(ctx, [{ name: 'baseline', tree }, { name: 'run-2', tree }])` → `createProtectionRef(ctx, ref, value)`（`ref = protectionRefName('1-00000000', 1)`）。`runGit(repo, 'for-each-ref', '--format=%(objecttype) %(objectname)', 'refs/prompt-ide/')` が `tree <value>\n`、`runGit(repo, 'ls-tree', value)` の名前が `baseline`・`run-2`、`await readProtectionRef(ctx, ref)` が `value`
2. **確認の結果 2**: ref を作る前と後で `git log --all --oneline`・`git rev-list --all`・`git branch -a`・`git describe --all`（`describe` は `runGit` が例外にならないこと）の出力が同じ
3. **確認の結果 3**: `only.txt` を書いて `recordBaseline(repo, tempRoot)` → `blob = runGit(repo, 'rev-parse', `${snapshot.tree}:only.txt`).trim()`、ref を作り `only.txt` を消して `git gc -q --prune=now` → `runGit(repo, 'cat-file', '-t', blob)` が `blob\n`。`deleteProtectionRef(ctx, ref, value)` の後に同じ gc → `expect(() => runGit(repo, 'cat-file', '-t', blob)).toThrow()`
4. **確認の結果 4（compare-and-swap）**: 作った ref に `createProtectionRef` → reject し値は変わらない。`deleteProtectionRef(ctx, ref, otherTree)` → reject し値は変わらない。`updateProtectionRef(ctx, ref, newValue, otherTree)` → reject。`git pack-refs --all` の後に正しい値の `deleteProtectionRef` → resolve し `readProtectionRef` が `null`
5. **確認の結果 5（hook）**: tree を作るコミット（`commitAll`）と `write-tree` を hook を置く**前**に済ませる（コミットも reference-transaction の hook を動かすため）。`.git/hooks/reference-transaction` に `` `#!/bin/sh\necho ran >> '${join(repo, 'hook-ran')}'\n` ``（書き込み先はテストが埋め込む絶対パス。git 2.50.1 の reference-transaction の hook の環境には `GIT_DIR` が無く〈cwd は作業ツリーの最上位〉、`"$GIT_DIR/../hook-ran"` だと `/../hook-ran` に書けずに hook が非 0 で終わり `fatal: ref updates aborted by hook` になる）を書いて `chmod 755`。さらに利用者の設定 `runGit(repo, 'config', 'core.hooksPath', '.git/hooks')` も置く。`createProtectionRef`・`updateProtectionRef`・`deleteProtectionRef`・`deleteProtectionRefSync` の後も `existsSync(join(repo, 'hook-ran'))` が `false`。対照として `runGit(repo, 'update-ref', 'refs/x', 'HEAD')` の後は `true`（hook が有効なことの確認）
6. `deleteProtectionRefSync`: 正しい値で `true` を返して消える、違う値で `false` を返して残る
7. **読み直し（L-002）**: 無い ref は `null`。Git 管理外のディレクトリ（`mkdtempSync`）を `folderPath` にすると reject（終了コード 0 以外を「無い」と読まない）
8. **項目の存在**: `filterExistingProtectionTrees(ctx, [{ name: 'baseline', tree }, { name: 'run-9', tree: '1'.repeat(40) }])` が `[{ name: 'baseline', tree }]`。`makeProtectionTree(ctx, [{ name: 'run-9', tree: '1'.repeat(40) }])` は reject（`--missing` なしの mktree は存在を確かめる。文言は検査しない）
9. **確認の結果 8（SHA-256・worktree）**: `git init -q --object-format=sha256 -b main` の別のリポジトリでコミットし、`write-tree` の 64 桁の tree で作れて `readProtectionRef` が 64 桁を返す。`git worktree add -q ../wt-<乱数>` で作った worktree を `folderPath` にした `ctx` で作った ref が、元のリポジトリの `for-each-ref refs/prompt-ide/` に出る（worktree は `afterEach` で消す）
10. **確認の結果 7**: `git init -q --bare` の送り先へ `git push -q --mirror <bare>` すると送り先の `for-each-ref refs/prompt-ide/` に出る。送り先から `git clone -q <bare> <dir>` した先には出ない
11. **掃除**（`sweepStaleProtectionRefs(ctx, { instanceId: '1-00000000', keepSerials, isProcessAlive })`。`keepSerials = vi.fn(() => new Set([1]))`、`isProcessAlive = (pid) => pid === 2`）。置く ref と値:
    - `1-00000000/1`（自分・残す番号・`baseline` の tree）→ 残る
    - `1-00000000/2`（自分・使っていない番号・`baseline` + `run-1` の tree）→ 消える
    - `3-00000000/1`（死んだ pid・`run-1` だけの tree）→ 消える
    - `2-00000000/1`（生きている pid・`baseline` の tree）→ 残る
    - `3-00000000/2`（死んだ pid・値が HEAD のコミット〈`update-ref` で置く〉）→ 残る
    - `3-00000000/3`（死んだ pid・空の tree〈`makeProtectionTree(ctx, [])`〉）→ 残る
    - `3-00000000/4`（死んだ pid・子の名前が `other` の tree）→ 残る
    - `3-00000000/5`（死んだ pid・子 `run-1` が blob の tree〈`runBaselineGitWithInput(repo, index, ['mktree', '-z'], `100644 blob ${blob}\trun-1\0`)` で作る〉）→ 残る
    - `refs/prompt-ide/agent-changes/foo/1`（形の違う名前・`baseline` の tree）→ 残る
    - `keepSerials` は 1 回だけ呼ばれる。ref の名前の一覧は `runGit(repo, 'for-each-ref', '--format=%(refname)', 'refs/prompt-ide/')` で比べる

Run: `npx vitest run src/main/__tests__/agentChangesProtectionRef.test.ts src/main/__tests__/agentChangesProtectionRef.integration.test.ts`
Expected: FAIL（`Cannot find module '../agentChangesProtectionRef'`）

- [ ] **Step 4: `runBaselineGitWithInputSync` の失敗するテストを書く**

`src/main/__tests__/agentBaselineGit.spawn.test.ts` の `vi.mock('node:child_process', ...)` に `spawnSync: spawnSyncMock` を足し（`const spawnSyncMock = vi.hoisted(() => vi.fn())`。`default` の中にも同じく足す）、import に `runBaselineGitWithInputSync` を足して、次の describe を末尾に足す:
```ts
describe('runBaselineGitWithInputSync', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset()
    spawnSyncMock.mockReturnValue({ status: 0, error: undefined })
  })

  it('cwd・記録のインデックスの環境・入力・打ち切り・windowsHide: true で同期で起動し、終了コード 0 なら true', () => {
    const ok = runBaselineGitWithInputSync('/repo', '/tmp/index', ['update-ref', '-z', '--stdin'], 'delete r\0v\0', {
      env: { PATH: '/bin' },
      timeoutMs: 2000,
      config: ['core.hooksPath=/nohooks']
    })
    expect(ok).toBe(true)
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'git',
      ['-c', 'core.splitIndex=false', '-c', 'core.hooksPath=/nohooks', 'update-ref', '-z', '--stdin'],
      expect.objectContaining({
        cwd: '/repo',
        env: { PATH: '/bin', GIT_INDEX_FILE: '/tmp/index' },
        input: 'delete r\0v\0',
        timeout: 2000,
        windowsHide: true
      })
    )
  })

  it.each([
    ['終了コードが 0 でない', { status: 1, error: undefined }],
    ['打ち切り・起動の失敗(error がある)', { status: null, error: new Error('ETIMEDOUT') }]
  ])('%s なら false', (_label, result) => {
    spawnSyncMock.mockReturnValue(result)
    expect(runBaselineGitWithInputSync('/repo', '/tmp/index', ['x'], '')).toBe(false)
  })

  it('spawnSync が投げても false(アプリの終了の後始末を止めない)', () => {
    spawnSyncMock.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(runBaselineGitWithInputSync('/repo', '/tmp/index', ['x'], '')).toBe(false)
  })
})
```
Run: `npx vitest run src/main/__tests__/agentBaselineGit.spawn.test.ts`
Expected: FAIL（`runBaselineGitWithInputSync is not a function`）

- [ ] **Step 5: `runBaselineGitWithInputSync` を実装する**

`src/main/agentBaselineGit.ts` の 1 行目を `import { spawn, spawnSync } from 'node:child_process'` にし、`runBaselineGitWithInput` の JSDoc の「使うのは出力の無い短い操作(update-index --stdin)だけのため」を「出力のある短い操作(update-index --stdin・mktree・cat-file --batch-check・for-each-ref・ls-tree・update-ref --stdin)に使う。出力は小さいため」に直し、末尾に足す:
```ts
/**
 * runBaselineGitWithInput の同期の版(アプリの終了〈before-quit〉の保護の ref の削除。待たずに終わる処理にする。L-010)。
 * 終了コード 0 なら true。打ち切り(timeoutMs)・起動の失敗・0 以外の終了・spawnSync の例外は false(後始末を止めない)
 */
export function runBaselineGitWithInputSync(
  folderPath: string,
  indexPath: string,
  args: readonly string[],
  input: string,
  {
    timeoutMs = AGENT_BASELINE_GIT_TIMEOUT_MS,
    config = [],
    env = process.env
  }: BaselineGitOptions = {}
): boolean {
  const configArgs = ['core.splitIndex=false', ...config].flatMap((entry) => ['-c', entry])
  try {
    const result = spawnSync('git', [...configArgs, ...args], {
      cwd: folderPath,
      env: buildBaselineGitEnv(env, indexPath),
      input,
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'ignore']
    })
    return result.error === undefined && result.status === 0
  } catch {
    return false
  }
}
```

- [ ] **Step 6: `agentChangesProtectionRef.ts` を実装する**

```ts
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { runBaselineGitWithInput, runBaselineGitWithInputSync } from './agentBaselineGit'

// 記録の tree を gc から守る専用の ref(設計書「記録の blob を gc から守る」)。名前は main が作った形
// (refs/prompt-ide/agent-changes/<pid>-<16 進 8 桁>/<記録の番号>)だけを使い、名前と値は update-ref -z --stdin の標準入力で渡す
// (L-034)。更新・削除は前に書いた値との compare-and-swap(L-004)。git は記録の git と同じ環境(GIT_DIR などを除く)で、
// reference-transaction の hook を動かさない(core.hooksPath を hook の無いディレクトリにする。確認の結果 5)。
// simple-git は stderr が空で終了コードが 0 でないときに reject しない(2026-10-06 の確認の結果 21)ため使わず、
// runBaselineGitWithInput(終了コード 0 以外で reject)だけで実行する。「無い」と読むのは終了コード 0 で出力が空のときだけ(L-002)

export const AGENT_CHANGES_PROTECTION_REF_PREFIX = 'refs/prompt-ide/agent-changes/'
/** アプリの終了の同期の削除の打ち切り(1 つにつき) */
export const AGENT_CHANGES_PROTECTION_SYNC_TIMEOUT_MS = 2_000
/** hook の無いディレクトリの名前(userData の下) */
export const AGENT_CHANGES_NO_HOOKS_DIR_NAME = 'agent-changes-no-hooks'

const REF_NAME_PATTERN =
  /^refs\/prompt-ide\/agent-changes\/([1-9][0-9]*)-([0-9a-f]{8})\/([1-9][0-9]*)$/
// object の ID(SHA-1 は 40 桁・SHA-256 は 64 桁)
const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const RUN_ENTRY_PATTERN = /^run-[1-9][0-9]*$/

/** 保護の tree の項目(baseline: 累積の始点の tree、run-<runId>: 区切りの tree) */
export interface ProtectionTreeEntry {
  name: string
  tree: string
}

/** 保護の git を実行する場所。indexPath は記録のインデックス(GIT_INDEX_FILE。ref の操作には使われない) */
export interface ProtectionGitContext {
  folderPath: string
  indexPath: string
  noHooksDir: string
  timeoutMs?: number
}

export interface ProtectionRefListing {
  refName: string
  value: string
  objectType: string
}

export interface ParsedProtectionRefName {
  pid: number
  instanceId: string
  recordSerial: number
}

export interface SweepProtectionRefsOptions {
  instanceId: string
  /** 残す番号。一覧を受け取った後に await を挟まずに呼ぶ(一覧の取得中に作られた ref を消さない) */
  keepSerials: () => ReadonlySet<number>
  isProcessAlive: (pid: number) => boolean
}

/** registry が使う保護の git の操作(テストで偽物に差し替える) */
export interface AgentChangesProtectionGit {
  filterExistingTrees(
    ctx: ProtectionGitContext,
    entries: readonly ProtectionTreeEntry[]
  ): Promise<ProtectionTreeEntry[]>
  makeTree(ctx: ProtectionGitContext, entries: readonly ProtectionTreeEntry[]): Promise<string>
  create(ctx: ProtectionGitContext, refName: string, value: string): Promise<void>
  update(ctx: ProtectionGitContext, refName: string, value: string, expected: string): Promise<void>
  remove(ctx: ProtectionGitContext, refName: string, expected: string): Promise<void>
  removeSync(ctx: ProtectionGitContext, refName: string, expected: string): boolean
  read(ctx: ProtectionGitContext, refName: string): Promise<string | null>
  sweep(ctx: ProtectionGitContext, options: SweepProtectionRefsOptions): Promise<void>
}

export function createProtectionInstanceId(pid: number, randomHex: string): string {
  return `${pid}-${randomHex}`
}

export function protectionRefName(instanceId: string, recordSerial: number): string {
  return `${AGENT_CHANGES_PROTECTION_REF_PREFIX}${instanceId}/${recordSerial}`
}

/** 自分の形の名前なら pid・instanceId・番号。形が違えば null(掃除で触らない) */
export function parseProtectionRefName(refName: string): ParsedProtectionRefName | null {
  const match = REF_NAME_PATTERN.exec(refName)
  if (match === null) return null
  const pid = Number(match[1])
  const recordSerial = Number(match[3])
  if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(recordSerial)) return null
  return { pid, instanceId: `${match[1]}-${match[2]}`, recordSerial }
}

// 自分が作った形の名前だけを git に渡す(L-034)
function assertOwnRefName(refName: string): void {
  if (parseProtectionRefName(refName) === null) {
    throw new Error(`保護の ref の名前が不正です: ${refName}`)
  }
}

function assertObjectId(value: string): void {
  if (!OBJECT_ID_PATTERN.test(value)) throw new Error(`object の ID が不正です: ${value}`)
}

const configOf = (ctx: ProtectionGitContext): string[] => [
  `core.hooksPath=${ctx.noHooksDir}`,
  'core.logAllRefUpdates=false'
]

const runProtectionGit = (
  ctx: ProtectionGitContext,
  args: readonly string[],
  input = ''
): Promise<string> =>
  runBaselineGitWithInput(ctx.folderPath, ctx.indexPath, args, input, {
    config: configOf(ctx),
    timeoutMs: ctx.timeoutMs
  })

/**
 * cat-file --batch-check の出力から、tree と答えた項目だけを返す(missing・tree 以外は除く)。
 * 行の数・ID が入力と合わなければ例外(空の出力を「全部無い」と読まない。L-002)
 */
export function parseBatchCheckOutput(
  output: string,
  entries: readonly ProtectionTreeEntry[]
): ProtectionTreeEntry[] {
  const lines = output.split('\n').filter((line) => line !== '')
  if (lines.length !== entries.length) {
    throw new Error('cat-file --batch-check の出力の行の数が合いません')
  }
  return entries.filter((entry, index) => {
    const [id, type] = lines[index].split(' ')
    if (id !== entry.tree) throw new Error('cat-file --batch-check の出力の ID が合いません')
    return type === 'tree'
  })
}

/** for-each-ref の `%(refname)%00%(objectname)%00%(objecttype)` の出力(1 行が 1 つ)。形の違う行は飛ばす */
export function parseProtectionRefListing(output: string): ProtectionRefListing[] {
  return output
    .split('\n')
    .filter((line) => line !== '')
    .flatMap((line) => {
      const parts = line.split('\0')
      if (parts.length !== 3) return []
      const [refName, value, objectType] = parts
      return [{ refName, value, objectType }]
    })
}

/**
 * ls-tree -z の出力が自分の書く形か: 子が 1 つ以上ですべて tree、baseline は 0 か 1 つ、ほかはすべて run-<整数>
 * (baseline が 0 の形は、gc で累積の始点の tree が消えた後に同期が run だけで作る値)
 */
export function isOwnProtectionTreeListing(lsTreeOutput: string): boolean {
  const records = lsTreeOutput.split('\0').filter((record) => record !== '')
  if (records.length === 0) return false
  let baselines = 0
  for (const record of records) {
    const tab = record.indexOf('\t')
    if (tab === -1) return false
    const [, type] = record.slice(0, tab).split(' ')
    const name = record.slice(tab + 1)
    if (type !== 'tree') return false
    if (name === 'baseline') baselines += 1
    else if (!RUN_ENTRY_PATTERN.test(name)) return false
  }
  return baselines <= 1
}

/** 項目の tree が object の DB にあるものだけを返す(stderr の文言では判定しない。L-002) */
export async function filterExistingProtectionTrees(
  ctx: ProtectionGitContext,
  entries: readonly ProtectionTreeEntry[]
): Promise<ProtectionTreeEntry[]> {
  if (entries.length === 0) return []
  entries.forEach((entry) => assertObjectId(entry.tree))
  const output = await runProtectionGit(
    ctx,
    ['cat-file', '--batch-check'],
    entries.map((entry) => `${entry.tree}\n`).join('')
  )
  return parseBatchCheckOutput(output, entries)
}

/** 項目を子に持つ tree を作る(mktree -z。項目の tree が無ければ git が失敗する) */
export async function makeProtectionTree(
  ctx: ProtectionGitContext,
  entries: readonly ProtectionTreeEntry[]
): Promise<string> {
  entries.forEach((entry) => assertObjectId(entry.tree))
  const input = entries.map((entry) => `040000 tree ${entry.tree}\t${entry.name}\0`).join('')
  const value = (await runProtectionGit(ctx, ['mktree', '-z'], input)).trim()
  assertObjectId(value)
  return value
}

/** 無いことを確かめて作る(既にあれば git が失敗する) */
export async function createProtectionRef(
  ctx: ProtectionGitContext,
  refName: string,
  value: string
): Promise<void> {
  assertOwnRefName(refName)
  assertObjectId(value)
  await runProtectionGit(ctx, ['update-ref', '-z', '--stdin'], `create ${refName}\0${value}\0`)
}

/** 前に書いた値(expected)のときだけ置き換える */
export async function updateProtectionRef(
  ctx: ProtectionGitContext,
  refName: string,
  value: string,
  expected: string
): Promise<void> {
  assertOwnRefName(refName)
  assertObjectId(value)
  assertObjectId(expected)
  await runProtectionGit(
    ctx,
    ['update-ref', '-z', '--stdin'],
    `update ${refName}\0${value}\0${expected}\0`
  )
}

/** 前に書いた値(expected)のときだけ消す */
export async function deleteProtectionRef(
  ctx: ProtectionGitContext,
  refName: string,
  expected: string
): Promise<void> {
  assertOwnRefName(refName)
  assertObjectId(expected)
  await runProtectionGit(ctx, ['update-ref', '-z', '--stdin'], `delete ${refName}\0${expected}\0`)
}

/** アプリの終了で、待たずに消す(1 つにつき 2 秒の打ち切り)。消せたら true */
export function deleteProtectionRefSync(
  ctx: ProtectionGitContext,
  refName: string,
  expected: string
): boolean {
  if (parseProtectionRefName(refName) === null || !OBJECT_ID_PATTERN.test(expected)) return false
  return runBaselineGitWithInputSync(
    ctx.folderPath,
    ctx.indexPath,
    ['update-ref', '-z', '--stdin'],
    `delete ${refName}\0${expected}\0`,
    { config: configOf(ctx), timeoutMs: AGENT_CHANGES_PROTECTION_SYNC_TIMEOUT_MS }
  )
}

/** ref の今の値。終了コード 0 で出力が空のときだけ null(無い)。それ以外の失敗は reject(L-002) */
export async function readProtectionRef(
  ctx: ProtectionGitContext,
  refName: string
): Promise<string | null> {
  assertOwnRefName(refName)
  const output = await runProtectionGit(ctx, ['for-each-ref', '--format=%(objectname)', refName])
  const lines = output.split('\n').filter((line) => line !== '')
  if (lines.length === 0) return null
  if (lines.length !== 1 || !OBJECT_ID_PATTERN.test(lines[0])) {
    throw new Error(`保護の ref の値を読めませんでした: ${refName}`)
  }
  return lines[0]
}

/** refs/prompt-ide/agent-changes/ の下の ref の一覧(for-each-ref には -z が無いため、行の中を %00 で分ける) */
export async function listProtectionRefs(
  ctx: ProtectionGitContext
): Promise<ProtectionRefListing[]> {
  const output = await runProtectionGit(ctx, [
    'for-each-ref',
    '--format=%(refname)%00%(objectname)%00%(objecttype)',
    AGENT_CHANGES_PROTECTION_REF_PREFIX
  ])
  return parseProtectionRefListing(output)
}

/** 値が自分の書く形の tree か(ls-tree が失敗したら reject。呼び出し側は消さない) */
export async function isOwnProtectionTree(
  ctx: ProtectionGitContext,
  value: string
): Promise<boolean> {
  assertObjectId(value)
  return isOwnProtectionTreeListing(await runProtectionGit(ctx, ['ls-tree', '-z', value]))
}

/**
 * 異常終了などで残った ref を消す(記録の ref を作る前に 1 回)。消すのは、自分のインスタンスで残す番号に無いもの・別のインスタンスで
 * その pid のプロセスが無いもののうち、一覧の種類が tree で値が自分の書く形のものだけ。一覧で読んだ値との compare-and-swap で消す。
 * 形の違う名前・形を確かめられない値・形の違う値には触らない(L-004)。失敗は握って次へ進む
 */
export async function sweepStaleProtectionRefs(
  ctx: ProtectionGitContext,
  options: SweepProtectionRefsOptions
): Promise<void> {
  let listings: ProtectionRefListing[]
  try {
    listings = await listProtectionRefs(ctx)
  } catch {
    return
  }
  // 一覧の結果を受け取った後に、await を挟まずに残す番号を作る
  const keep = options.keepSerials()
  for (const listing of listings) {
    const parsed = parseProtectionRefName(listing.refName)
    if (parsed === null) continue
    const stale =
      parsed.instanceId === options.instanceId
        ? !keep.has(parsed.recordSerial)
        : !options.isProcessAlive(parsed.pid)
    if (!stale || listing.objectType !== 'tree' || !OBJECT_ID_PATTERN.test(listing.value)) continue
    try {
      if (!(await isOwnProtectionTree(ctx, listing.value))) continue
      await deleteProtectionRef(ctx, listing.refName, listing.value)
    } catch {
      // 形を確かめられない・消せないものは残し、次へ進む
    }
  }
}

/** このマシンにその pid のプロセスがあるか。ESRCH だけを「無い」とみなす(EPERM は別の利用者のプロセスとして残す) */
export function isProcessAliveOnThisMachine(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/**
 * hook の無いディレクトリ(userData の下。0700。消さない)を用意してパスを返す。起動のたびに呼ぶ。
 * 作れなくても握る(core.hooksPath が存在しないディレクトリを指しても hook は動かない。確認の結果 5)
 */
export function prepareAgentChangesNoHooksDir(userDataPath: string): string {
  const dir = join(userDataPath, AGENT_CHANGES_NO_HOOKS_DIR_NAME)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch {
    // 用意できなくても保護は続ける
  }
  return dir
}

/** registry に渡す実物 */
export const protectionRefGit: AgentChangesProtectionGit = {
  filterExistingTrees: filterExistingProtectionTrees,
  makeTree: makeProtectionTree,
  create: createProtectionRef,
  update: updateProtectionRef,
  remove: deleteProtectionRef,
  removeSync: deleteProtectionRefSync,
  read: readProtectionRef,
  sweep: sweepStaleProtectionRefs
}
```

- [ ] **Step 7: テストを通す**

Run: `npx vitest run src/main/__tests__/agentChangesProtectionRef.test.ts src/main/__tests__/agentChangesProtectionRef.integration.test.ts src/main/__tests__/agentBaselineGit.spawn.test.ts src/main/__tests__/agentBaselineGit.test.ts`
Expected: PASS。実測と違う結果（例: 確認の結果 2 で `git log --all` がエラーになる、確認の結果 5 で hook が動く）が出たら、期待値を合わせて通さずに止めて報告する。

変異の確認: `createProtectionRef` などの `configOf(ctx)` の `core.hooksPath` の行を一時的に外すとケース 5 が落ち、`sweepStaleProtectionRefs` の `isOwnProtectionTree` の確認を外すとケース 11 の commit・空の tree・`other`・blob の ref が消えて落ちることを確かめてから戻す。

- [ ] **Step 8: 型・lint**

Run: `npm run typecheck:node`
Expected: PASS
Run: `npx eslint --fix src/main/agentChangesProtectionRef.ts src/main/agentBaselineGit.ts src/main/__tests__/agentChangesProtectionRef.test.ts src/main/__tests__/agentChangesProtectionRef.integration.test.ts src/main/__tests__/agentBaselineGit.spawn.test.ts && npx eslint --max-warnings 0 src/main/agentChangesProtectionRef.ts src/main/agentBaselineGit.ts src/main/__tests__/agentChangesProtectionRef.test.ts src/main/__tests__/agentChangesProtectionRef.integration.test.ts src/main/__tests__/agentBaselineGit.spawn.test.ts`
Expected: エラー・警告なし。`ls src/main/__tests__/ | grep timing.local` が何も出さない（計測のファイルを消してある）

---

### Task 2: registry の保護の同期（`recordSerial`・`protection`・`protectedRecords`・`close`）

**Files:**
- Modify: `src/main/agentChangesRecord.ts`（import に `ProtectionTreeEntry`。`AgentChangesRecord` L26-33 に `recordSerial`・`protection`、`AgentChangesProtectionState`・`createAgentChangesRecord`・`protectionTreeEntries` を足す）
- Modify: `src/main/agentBaselineRegistry.ts`（`AgentBaselineRegistryDeps` L20-38 に `protection`、フィールド L41-51 に `nextRecordSerial`・`protectedRecords`・`abandonedSerials`、`begin` の記録の作成 L100-106、`clear` L140-146、`close` L149-161、`addRun` L181-184、保護の同期の private メソッド）
- Modify: `src/main/ipcHandlers.ts`（L1 の import に `randomBytes`、`AgentBaselineRegistry` の組み立て L116-121 に `protection`）
- Modify: `src/main/__tests__/helpers/agentBaselineFixtures.ts`（`makeAgentChangesRecord` の既定に `recordSerial`・`protection`、`createFakeProtectionGit`・`makeFakeProtectionDeps`）
- Test: `src/main/__tests__/helpers/agentBaselineFixtures.test.ts`（`makeAgentChangesRecord` の期待値）
- Test: `src/main/__tests__/agentChangesRecord.test.ts`（`createAgentChangesRecord`・`protectionTreeEntries`）
- Test: `src/main/__tests__/agentBaselineRegistry.test.ts`（`setup` に保護の偽物、新しい describe）
- Test: `src/main/__tests__/handlers/agentChangesHandlers.test.ts`（L79-85 の registry の組み立てに `protection: makeFakeProtectionDeps()`）
- Test: `src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`（**実 git**。registry に実物の保護を渡し、gc の後も一覧・diff・戻すが成功する describe）
- Test: `src/main/__tests__/ipcHandlers.test.ts`（`node:fs` の偽物に `mkdirSync`、L255 の it に保護の依存の確認）

**Interfaces:**
- Consumes: Task 1 の `AgentChangesProtectionGit`・`ProtectionGitContext`・`ProtectionTreeEntry`・`protectionRefName`・`createProtectionInstanceId`・`protectionRefGit`・`isProcessAliveOnThisMachine`・`prepareAgentChangesNoHooksDir`
- Produces:
```ts
// src/main/agentChangesRecord.ts
export interface AgentChangesProtectionState { refName: string; value: string | null; abandoned: boolean; swept: boolean }
export interface AgentChangesRecord {
  baseline: BaselineSnapshot
  runs: AgentChangesRecordRun[]
  nextNumber: number
  recordSerial: number
  protection: AgentChangesProtectionState
}
export function createAgentChangesRecord(baseline: BaselineSnapshot, recordSerial: number, refName: string): AgentChangesRecord
export function protectionTreeEntries(record: AgentChangesRecord): ProtectionTreeEntry[]
// src/main/agentBaselineRegistry.ts
export interface AgentBaselineProtectionDeps {
  instanceId: string
  noHooksDir: string
  git: AgentChangesProtectionGit
  isProcessAlive: (pid: number) => boolean
}
export interface AgentBaselineRegistryDeps { /* 既存 */ protection: AgentBaselineProtectionDeps }
// src/main/__tests__/helpers/agentBaselineFixtures.ts
export type FakeProtectionOp = 'filter' | 'mktree' | 'create' | 'update' | 'remove' | 'removeSync' | 'read' | 'sweep'
export interface FakeProtectionGit extends AgentChangesProtectionGit {
  refs: Map<string, string>
  calls: string[]
  missingTrees: Set<string>
  failNext: Set<FakeProtectionOp>
  holdNext: (op: FakeProtectionOp) => () => void
  sweptKeeps: number[][]
}
export function createFakeProtectionGit(): FakeProtectionGit
export function makeFakeProtectionDeps(git?: FakeProtectionGit): AgentBaselineProtectionDeps
export const FAKE_PROTECTION_INSTANCE_ID = '1-00000000'
```

> **設計書との差（テスト）:** 「前の記録を新しい記録で置き換えた（`begin` の中）」の並べ方（`begin` の L100-101 の `previous !== undefined`）は、今の公開の操作の組み合わせでは起きない守り（同じ世代・同じフォルダの依頼は合流し、世代が変わった依頼は取れた記録を捨てる）のため、単体テストは書かない。同じ並べ方のコード（前の記録の同期〈削除〉を新しい記録の同期の前に並べる）は残す。

- [ ] **Step 1: fixture と記録の失敗するテストを書く**

`src/main/__tests__/helpers/agentBaselineFixtures.test.ts` の `describe('makeAgentChangesRecord')` の 2 つの `toEqual` に `recordSerial: 1, protection: { refName: 'refs/prompt-ide/agent-changes/1-00000000/1', value: null, abandoned: false, swept: false }` を足す。

`src/main/__tests__/agentChangesRecord.test.ts` に足す（import に `createAgentChangesRecord`・`protectionTreeEntries`。`baselineRun`・`snapshotRun`・`failedRun` はこのファイルの既存の補助関数。`snapshotRun(n)` の区切りの tree は `makeBaselineSnapshot` の既定〈`EMPTY_TREE`〉のため、tree を分けたいケースは直接 `{ runId, number, start: { kind: 'snapshot', snapshot: makeBaselineSnapshot({ tempDir: '/tmp/r', tree: 'c'.repeat(40) }) } }` を作る）:
```ts
describe('createAgentChangesRecord', () => {
  it('実行なし・番号 1・保護はまだ作っていない状態で作る', () => {
    expect(createAgentChangesRecord(baseline, 3, 'refs/prompt-ide/agent-changes/1-00000000/3')).toEqual({
      baseline,
      runs: [],
      nextNumber: 1,
      recordSerial: 3,
      protection: {
        refName: 'refs/prompt-ide/agent-changes/1-00000000/3',
        value: null,
        abandoned: false,
        swept: false
      }
    })
  })
})

describe('protectionTreeEntries', () => {
  it('累積の始点(baseline)と、開始が区切りの実行(run-<runId>)だけを項目にする(baseline・failed の実行は作らない)', () => {
    const tree = 'c'.repeat(40)
    const record = makeAgentChangesRecord(
      [
        baselineRun(1),
        { runId: 2, number: 2, start: { kind: 'snapshot', snapshot: makeBaselineSnapshot({ tempDir: '/tmp/r2', tree }) } },
        failedRun(3)
      ],
      { baseline: makeBaselineSnapshot({ tree: 'd'.repeat(40) }) }
    )
    expect(protectionTreeEntries(record)).toEqual([
      { name: 'baseline', tree: 'd'.repeat(40) },
      { name: 'run-2', tree }
    ])
  })
})
```

Run: `npx vitest run src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentChangesRecord.test.ts`
Expected: FAIL（`createAgentChangesRecord is not a function`・期待値に `recordSerial` が無い）

- [ ] **Step 2: 記録の型と fixture を実装する**

`src/main/agentChangesRecord.ts`:
- import に `import type { ProtectionTreeEntry } from './agentChangesProtectionRef'` を足す
- `AgentChangesRecord` の前に足す:
```ts
/**
 * 保護の ref の状態(設計書「ref の名前と指す先」)。value は最後に書けた ref の値(無ければ null)、abandoned は保護をやめた印
 * (利用者が ref を消した・書き換えた。以後は作り直さず消さない)、swept は残った ref の掃除を済ませた印
 */
export interface AgentChangesProtectionState {
  refName: string
  value: string | null
  abandoned: boolean
  swept: boolean
}
```
- `AgentChangesRecord` の `nextNumber` の後に足す:
```ts
  /** インスタンスの中で記録を取るたびに 1 から増える番号(保護の ref の名前に使う) */
  recordSerial: number
  /** 保護の ref の状態(registry の保護の同期だけが書き換える) */
  protection: AgentChangesProtectionState
```
- ファイルの末尾に足す:
```ts
/** 累積の始点を取ったときの記録(実行なし・保護はまだ作っていない) */
export function createAgentChangesRecord(
  baseline: BaselineSnapshot,
  recordSerial: number,
  refName: string
): AgentChangesRecord {
  return {
    baseline,
    runs: [],
    nextNumber: 1,
    recordSerial,
    protection: { refName, value: null, abandoned: false, swept: false }
  }
}

/**
 * 保護の tree の項目: 累積の始点(baseline)と、開始が区切りの実行(run-<runId>)。開始が累積の始点の実行(baseline)は始点と同じ
 * tree のため、取れなかった実行(failed)は tree が無いため項目を作らない
 */
export function protectionTreeEntries(record: AgentChangesRecord): ProtectionTreeEntry[] {
  return [
    { name: 'baseline', tree: record.baseline.tree },
    ...record.runs.flatMap((run) =>
      run.start.kind === 'snapshot'
        ? [{ name: `run-${run.runId}`, tree: run.start.snapshot.tree }]
        : []
    )
  ]
}
```

`src/main/__tests__/helpers/agentBaselineFixtures.ts`:
- import に `import type { AgentChangesProtectionGit } from '../../agentChangesProtectionRef'` と `import type { AgentBaselineProtectionDeps } from '../../agentBaselineRegistry'` を足す
- `makeAgentChangesRecord` の戻り値に `recordSerial: overrides.recordSerial ?? 1` と `protection: overrides.protection ?? { refName: 'refs/prompt-ide/agent-changes/1-00000000/1', value: null, abandoned: false, swept: false }` を足す
- 末尾に足す:
```ts
/** 偽物の保護の instanceId(<pid>-<16 進 8 桁> の形) */
export const FAKE_PROTECTION_INSTANCE_ID = '1-00000000'

export type FakeProtectionOp =
  | 'filter'
  | 'mktree'
  | 'create'
  | 'update'
  | 'remove'
  | 'removeSync'
  | 'read'
  | 'sweep'

export interface FakeProtectionGit extends AgentChangesProtectionGit {
  /** ref の名前 → 値(create・update・remove は compare-and-swap で書き換える) */
  refs: Map<string, string>
  /** 呼ばれた操作('create <ref>' など。filter・mktree・sweep は名前だけ) */
  calls: string[]
  /** object の DB に無いことにする tree */
  missingTrees: Set<string>
  /** 次のその操作を失敗させる(1 回で外れる) */
  failNext: Set<FakeProtectionOp>
  /** 次のその操作を待たせ、待ちを解く関数を返す */
  holdNext: (op: FakeProtectionOp) => () => void
  /** sweep に渡された keepSerials() の結果(昇順。呼ばれた順) */
  sweptKeeps: number[][]
}

// 保護の git の偽物。値は項目から決まる文字列(`tree(baseline=<tree>,run-2=<tree>)`)
export function createFakeProtectionGit(): FakeProtectionGit {
  const refs = new Map<string, string>()
  const calls: string[] = []
  const missingTrees = new Set<string>()
  const failNext = new Set<FakeProtectionOp>()
  const holds = new Map<FakeProtectionOp, Promise<void>>()
  const sweptKeeps: number[][] = []
  const enter = async (op: FakeProtectionOp, detail?: string): Promise<void> => {
    calls.push(detail === undefined ? op : `${op} ${detail}`)
    const hold = holds.get(op)
    if (hold !== undefined) {
      holds.delete(op)
      await hold
    }
    if (failNext.delete(op)) throw new Error(`偽物の ${op} の失敗`)
  }
  return {
    refs,
    calls,
    missingTrees,
    failNext,
    sweptKeeps,
    holdNext: (op) => {
      let release = (): void => undefined
      holds.set(
        op,
        new Promise<void>((resolve) => {
          release = resolve
        })
      )
      return () => release()
    },
    filterExistingTrees: async (_ctx, entries) => {
      await enter('filter')
      return entries.filter((entry) => !missingTrees.has(entry.tree))
    },
    makeTree: async (_ctx, entries) => {
      await enter('mktree')
      return `tree(${entries.map((entry) => `${entry.name}=${entry.tree}`).join(',')})`
    },
    create: async (_ctx, refName, value) => {
      await enter('create', refName)
      if (refs.has(refName)) throw new Error('reference already exists')
      refs.set(refName, value)
    },
    update: async (_ctx, refName, value, expected) => {
      await enter('update', refName)
      if (refs.get(refName) !== expected) throw new Error('is at another value')
      refs.set(refName, value)
    },
    remove: async (_ctx, refName, expected) => {
      await enter('remove', refName)
      if (refs.get(refName) !== expected) throw new Error('is at another value')
      refs.delete(refName)
    },
    removeSync: (_ctx, refName, expected) => {
      calls.push(`removeSync ${refName}`)
      if (failNext.delete('removeSync') || refs.get(refName) !== expected) return false
      refs.delete(refName)
      return true
    },
    read: async (_ctx, refName) => {
      await enter('read', refName)
      return refs.get(refName) ?? null
    },
    sweep: async (_ctx, options) => {
      await enter('sweep')
      sweptKeeps.push([...options.keepSerials()].sort((a, b) => a - b))
    }
  }
}

/** registry の保護の依存(偽物の git・すべての pid を生きているとみなす) */
export function makeFakeProtectionDeps(
  git: FakeProtectionGit = createFakeProtectionGit()
): AgentBaselineProtectionDeps {
  return { instanceId: FAKE_PROTECTION_INSTANCE_ID, noHooksDir: '/nohooks', git, isProcessAlive: () => true }
}
```

Run: `npx vitest run src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentChangesRecord.test.ts`
Expected: `agentChangesRecord.test.ts` は PASS。fixture は `AgentBaselineProtectionDeps` がまだ無いため型だけ未解決（vitest は型を検査しないので PASS する）

- [ ] **Step 3: registry の失敗するテストを書く**

`src/main/__tests__/agentBaselineRegistry.test.ts`:
1. import に `createFakeProtectionGit`・`makeFakeProtectionDeps`・`FAKE_PROTECTION_INSTANCE_ID` と `import type { FakeProtectionGit } from './helpers/agentBaselineFixtures'` を足す
2. `setup()` の戻り値の型と値に `protection: FakeProtectionGit` を足し、`const protection = createFakeProtectionGit()` を作って `new AgentBaselineRegistry({ ..., protection: makeFakeProtectionDeps(protection) })` に渡す（引数 `setup(options: { isProcessAlive?: (pid: number) => boolean } = {})` を足し、`{ ...makeFakeProtectionDeps(protection), ...(options.isProcessAlive ? { isProcessAlive: options.isProcessAlive } : {}) }` にする）
3. ファイルの末尾に次の describe を足す:
```ts
const TB = 'b'.repeat(40)
const TR = 'c'.repeat(40)
const REF1 = `refs/prompt-ide/agent-changes/${FAKE_PROTECTION_INSTANCE_ID}/1`
const recordedTree = (folderPath: string, tempDir: string, tree: string): BaselineSnapshotResult => ({
  kind: 'recorded',
  snapshot: makeBaselineSnapshot({ folderPath, tempDir, startedAt: 100, tree })
})

// begin(send) を記録まで進め、保護の同期が終わるのを待つ
async function sendFor(s: ReturnType<typeof setup>, ownerId: number, tree: string, tempDir: string): Promise<void> {
  const begun = s.registry.begin(ownerId, '/repo', 'send')
  await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalled())
  s.release(recordedTree('/repo', tempDir, tree))
  await begun
  s.takeSnapshot.mockClear()
}

describe('AgentBaselineRegistry の保護の ref', () => {
  it('累積の始点を取ると ref を作る。begin は作成を待たない', async () => {
    const s = setup()
    const release = s.protection.holdNext('create')
    await sendFor(s, 1, TB, '/tmp/a')
    expect(s.protection.refs.size).toBe(0)
    release()
    await vi.waitFor(() => expect(s.protection.refs.get(REF1)).toBe(`tree(baseline=${TB})`))
    expect(s.protection.calls).toEqual(['filter', 'mktree', 'sweep', `create ${REF1}`])
  })

  it('実行を足すと区切りの tree を足した値に更新し、10 件を超えて外した実行の項目を除く', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    const added = s.registry.begin(1, '/repo', 'send')
    await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalled())
    s.release(recordedTree('/repo', '/tmp/r2', TR))
    await added
    await vi.waitFor(() =>
      expect(s.protection.refs.get(REF1)).toBe(`tree(baseline=${TB},run-2=${TR})`)
    )
    // 実行 3〜11 を足すと実行 1・2 が外れる(区切りの tree は一意に)
    for (let n = 3; n <= 12; n++) {
      s.takeSnapshot.mockClear()
      const next = s.registry.begin(1, '/repo', 'send')
      await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalled())
      s.release(recordedTree('/repo', `/tmp/r${n}`, n.toString(16).padStart(40, '0')))
      await next
    }
    await vi.waitFor(() => expect(s.protection.refs.get(REF1)).not.toContain(`run-2=`))
    expect(s.protection.refs.get(REF1)).toContain(`baseline=${TB}`)
    expect(s.protection.refs.get(REF1)).toContain('run-12=')
  })

  it('あるべき値が今の値と同じなら update-ref を呼ばない(区切りを取れなかった実行)', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    s.protection.calls.length = 0
    const added = s.registry.begin(1, '/repo', 'send')
    await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalled())
    s.release({ kind: 'unavailable', state: { kind: 'unavailable', reason: 'timeout' } })
    await added
    await vi.waitFor(() => expect(s.protection.calls).toEqual(['filter', 'mktree']))
  })

  it('clear で ref を消してから一時ディレクトリを消す', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    await s.registry.clear(1)
    expect(s.protection.refs.size).toBe(0)
    expect(s.protection.calls.at(-1)).toBe(`remove ${REF1}`)
    expect(s.removeDir).toHaveBeenCalledWith('/tmp/a')
  })

  it('作成の実行中に clear しても、作成の成功の後に後ろの同期で消える', async () => {
    const s = setup()
    const release = s.protection.holdNext('create')
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.calls).toContain(`create ${REF1}`))
    const cleared = s.registry.clear(1)
    release()
    await cleared
    expect(s.protection.refs.size).toBe(0)
  })

  it('失敗の後の読み直しがあるべき値なら成功として扱う', async () => {
    const s = setup()
    s.protection.failNext.add('create')
    s.protection.refs.set(REF1, `tree(baseline=${TB})`)
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.calls).toContain(`read ${REF1}`))
    // 成功として扱ったので、clear で消す(protectedRecords に入っている)
    await s.registry.clear(1)
    expect(s.protection.refs.size).toBe(0)
  })

  it('削除の失敗の後の読み直しで ref が無ければ成功として扱い、protectedRecords から外す(close で消そうとしない)', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    // 別の経路で先に消えていた(削除の compare-and-swap は失敗する)
    s.protection.refs.delete(REF1)
    await s.registry.clear(1)
    expect(s.protection.calls).toContain(`read ${REF1}`)
    s.registry.close()
    expect(s.protection.calls.filter((call) => call.startsWith('removeSync'))).toEqual([])
  })

  it('失敗の後の読み直しが前の値なら次の同期で試し直す', async () => {
    const s = setup()
    s.protection.failNext.add('create')
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.calls).toContain(`read ${REF1}`))
    expect(s.protection.refs.size).toBe(0)
    await sendFor(s, 1, TR, '/tmp/r2')
    await vi.waitFor(() => expect(s.protection.refs.get(REF1)).toBe(`tree(baseline=${TB},run-2=${TR})`))
  })

  it('読み直しが前の値でもあるべき値でもない(利用者が消した・書き換えた)なら保護をやめ、以後は作り直さず消さない', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    s.protection.refs.set(REF1, 'user-value')
    await sendFor(s, 1, TR, '/tmp/r2')
    await vi.waitFor(() => expect(s.protection.calls).toContain(`read ${REF1}`))
    s.protection.calls.length = 0
    await sendFor(s, 1, 'e'.repeat(40), '/tmp/r3')
    await s.registry.clear(1)
    s.registry.close()
    expect(s.protection.refs.get(REF1)).toBe('user-value')
    expect(s.protection.calls).toEqual([])
  })

  it('読み直し自体が失敗したら何も変えずに次で試し直す(保護をやめない・空を「無い」と読まない)', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    s.protection.failNext.add('update')
    s.protection.failNext.add('read')
    await sendFor(s, 1, TR, '/tmp/r2')
    await vi.waitFor(() => expect(s.protection.calls).toContain(`read ${REF1}`))
    expect(s.protection.refs.get(REF1)).toBe(`tree(baseline=${TB})`)
    await sendFor(s, 1, 'e'.repeat(40), '/tmp/r3')
    await vi.waitFor(() => expect(s.protection.refs.get(REF1)).toContain('run-3='))
  })

  it('無い項目を除いて作り、1 つも無ければ作らない(保護はやめない。後の clear で前の ref を消す)', async () => {
    const s = setup()
    s.protection.missingTrees.add(TB)
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.calls).toEqual(['filter']))
    expect(s.protection.refs.size).toBe(0)
    await sendFor(s, 1, TR, '/tmp/r2')
    await vi.waitFor(() => expect(s.protection.refs.get(REF1)).toBe(`tree(run-2=${TR})`))
    s.protection.missingTrees.add(TR)
    await sendFor(s, 1, TB, '/tmp/r3')
    // 項目が 1 つも無い同期は ref を変えない
    expect(s.protection.refs.get(REF1)).toBe(`tree(run-2=${TR})`)
    await s.registry.clear(1)
    expect(s.protection.refs.size).toBe(0)
  })

  it.each(['filter', 'mktree'] as const)('%s の失敗では何も変えずに次の同期で試し直す', async (op) => {
    const s = setup()
    s.protection.failNext.add(op)
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.calls).toContain(op))
    expect(s.protection.refs.size).toBe(0)
    await sendFor(s, 1, TR, '/tmp/r2')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
  })

  it('close は ref を同期で消し、1 つが失敗しても残りを試す', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await sendFor(s, 2, TR, '/tmp/b')
    const ref2 = `refs/prompt-ide/agent-changes/${FAKE_PROTECTION_INSTANCE_ID}/2`
    await vi.waitFor(() => expect(s.protection.refs.size).toBe(2))
    s.protection.failNext.add('removeSync')
    s.registry.close()
    expect(s.protection.calls.filter((call) => call.startsWith('removeSync'))).toEqual([
      `removeSync ${REF1}`,
      `removeSync ${ref2}`
    ])
    expect([...s.protection.refs.keys()]).toEqual([REF1])
    expect(s.removeDirSync).toHaveBeenCalledWith('/tmp/a')
  })

  it('作成が close の後に成功したら、その場で新しい値の ref を同期で消す', async () => {
    const s = setup()
    const release = s.protection.holdNext('create')
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.calls).toContain(`create ${REF1}`))
    s.registry.close()
    release()
    await vi.waitFor(() => expect(s.protection.calls).toContain(`removeSync ${REF1}`))
    expect(s.protection.refs.size).toBe(0)
  })

  it('終了中に走っていた同期は ref を作らない(終了の後に書き込みへ進まない)', async () => {
    const s = setup()
    const release = s.protection.holdNext('filter')
    await sendFor(s, 1, TB, '/tmp/a')
    s.registry.close()
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(s.protection.calls).toEqual(['filter', 'mktree'])
    expect(s.protection.refs.size).toBe(0)
  })

  it('掃除の残す番号は、すべての所有者の今の記録・削除を待つ記録・保護をやめた番号(一覧の後に作る)', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    // 所有者 1 の記録の削除を待たせる(削除待ち)
    const releaseRemove = s.protection.holdNext('remove')
    const cleared = s.registry.clear(1)
    await vi.waitFor(() => expect(s.protection.calls).toContain(`remove ${REF1}`))
    // 所有者 2 の掃除の一覧の取得を待たせ、その間に所有者 3 の記録の作成を終わらせる
    const releaseSweep = s.protection.holdNext('sweep')
    await sendFor(s, 2, TR, '/tmp/b')
    await vi.waitFor(() => expect(s.protection.calls.filter((c) => c === 'sweep')).toHaveLength(2))
    const ref3 = `refs/prompt-ide/agent-changes/${FAKE_PROTECTION_INSTANCE_ID}/3`
    await sendFor(s, 3, 'e'.repeat(40), '/tmp/c')
    await vi.waitFor(() => expect(s.protection.refs.has(ref3)).toBe(true))
    // 所有者 1 の最初の掃除と、待たずに終わった所有者 3 の掃除
    expect(s.protection.sweptKeeps).toEqual([[1], [1, 2, 3]])
    releaseSweep()
    await vi.waitFor(() => expect(s.protection.sweptKeeps).toHaveLength(3))
    // 所有者 2 の掃除の残す番号: 削除待ちの 1・自分の 2・一覧の取得中に作られた 3
    expect(s.protection.sweptKeeps[2]).toEqual([1, 2, 3])
    releaseRemove()
    await cleared
  })

  it('保護をやめた記録の番号は、掃除の残す番号に入る(利用者が書き換えた ref を消さない)', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    s.protection.refs.set(REF1, 'user-value')
    await sendFor(s, 1, TR, '/tmp/r2')
    await vi.waitFor(() => expect(s.protection.calls).toContain(`read ${REF1}`))
    await s.registry.clear(1)
    await sendFor(s, 2, TB, '/tmp/b')
    await vi.waitFor(() => expect(s.protection.sweptKeeps).toHaveLength(2))
    expect(s.protection.sweptKeeps[1]).toEqual([1, 2])
  })
})
```

Run: `npx vitest run src/main/__tests__/agentBaselineRegistry.test.ts`
Expected: FAIL（保護の同期が無いので ref が作られない）

- [ ] **Step 4: registry に保護の同期を実装する**

`src/main/agentBaselineRegistry.ts`:
- import を直す:
```ts
import type { AgentChangesProtectionGit, ProtectionGitContext } from './agentChangesProtectionRef'
import { protectionRefName } from './agentChangesProtectionRef'
import {
  agentChangesRecordTempDirs,
  createAgentChangesRecord,
  dropRunsOverLimit,
  latestRecordedIndexPath,
  protectionTreeEntries,
  runStartFromSnapshotResult,
  summarizeAgentChangesRuns
} from './agentChangesRecord'
```
- ファイルの冒頭のコメントの最後に 1 行足す: `// - 保護: 記録の形が変わるたびに、所有者の列の後ろに「保護の同期」を並べる(設計書「記録の blob を gc から守る」)。begin・addRun は同期を待たない`
- `AgentBaselineRegistryDeps` の前に足し、`AgentBaselineRegistryDeps` に `protection: AgentBaselineProtectionDeps` を足す:
```ts
/** 記録の tree を gc から守る ref の依存(設計書「保護の ref の名前」「残った ref の掃除」) */
export interface AgentBaselineProtectionDeps {
  /** main の起動ごとの ID(<pid>-<乱数 8 桁の 16 進>) */
  instanceId: string
  /** hook の無いディレクトリ(core.hooksPath に渡す) */
  noHooksDir: string
  git: AgentChangesProtectionGit
  /** その pid のプロセスがこのマシンにあるか(掃除で使う) */
  isProcessAlive: (pid: number) => boolean
}
```
- フィールドに足す（`private closed = false` の前）:
```ts
  // インスタンスの中で記録を取るたびに増える番号(保護の ref の名前)
  private nextRecordSerial = 1
  // ref を作れた記録(今の記録と、捨てて削除を待っている記録)。close と掃除はこの集合だけを見る
  private readonly protectedRecords = new Set<AgentChangesRecord>()
  // 保護をやめた記録の番号(利用者が消した・書き換えた ref を掃除で消さない)
  private readonly abandonedSerials = new Set<number>()
```
- `begin` の L103-105 を置き換える:
```ts
      // 始点を取り終えたときに実行 1 を足すかは、始点の取得を始めた依頼の trigger で決める(pending には持たせない)
      const recordSerial = this.nextRecordSerial++
      const record = createAgentChangesRecord(
        result.snapshot,
        recordSerial,
        protectionRefName(this.deps.protection.instanceId, recordSerial)
      )
      if (trigger === 'send') this.appendRun(ownerId, record, { kind: 'baseline' })
      this.records.set(ownerId, record)
      // 保護の同期(待たない)。前の記録の削除を、新しい記録の作成より先に並べる
      if (previous !== undefined) this.enqueueProtectionSync(ownerId, previous)
      this.enqueueProtectionSync(ownerId, record)
      return this.recordingState(record)
```
- `clear` の L145 を置き換える:
```ts
    // 捨てた記録の ref を消してから一時ディレクトリを消す(同じ列の中で直列。実行中の操作は最後まで行う)
    await this.queue.enqueue(ownerId, async () => {
      await this.syncProtection(ownerId, record).catch(() => undefined)
      await this.removeDirs(agentChangesRecordTempDirs(record))
    })
```
- `close` の `this.closed = true` の直後に足す:
```ts
    // ref を作れた記録の ref を同期で消す(1 つが失敗しても残りを試す。L-010)。消せなかったものは次の記録の掃除で消える
    for (const record of [...this.protectedRecords]) this.removeProtectionRefSync(record)
```
- `addRun` の `await this.removeDirs(dropRunsOverLimit(record, AGENT_CHANGES_MAX_RUNS))` の後に足す:
```ts
      // 記録の形が変わった(実行を足した・外した)ので保護を同期する(待たない。送信の前の待ちに含めない)
      this.enqueueProtectionSync(ownerId, record)
```
- private メソッドを足す（`recordingState` の前）:
```ts
  // 保護の同期を所有者の列の後ろに並べる(待たない)。失敗は握り、次の同期で試し直す
  private enqueueProtectionSync(ownerId: number, record: AgentChangesRecord): void {
    void this.queue.enqueue(ownerId, () => this.syncProtection(ownerId, record)).catch(() => undefined)
  }

  private protectionContextOf(record: AgentChangesRecord): ProtectionGitContext {
    return {
      folderPath: record.baseline.folderPath,
      indexPath: record.baseline.indexPath,
      noHooksDir: this.deps.protection.noHooksDir
    }
  }

  /**
   * 保護の同期(設計書「同期」)。列の番が来た時点の記録から ref のあるべき値を求め、今の値と違えば作る・更新する・消す。
   * 今の記録なら項目のうち object の DB にあるものだけで tree を作る(1 つも無ければ何もしない)。捨てた記録なら null(消す)。
   * cat-file・mktree の失敗は投げる(呼び出し側が握り、次の同期で試し直す)。ref の書き込みの失敗は読み直しで分類する
   */
  private async syncProtection(ownerId: number, record: AgentChangesRecord): Promise<void> {
    const state = record.protection
    if (this.closed || state.abandoned) return
    const { git } = this.deps.protection
    const ctx = this.protectionContextOf(record)
    let desired: string | null = null
    if (this.records.get(ownerId) === record) {
      const entries = await git.filterExistingTrees(ctx, protectionTreeEntries(record))
      if (entries.length === 0) return
      desired = await git.makeTree(ctx, entries)
    }
    if (this.closed || state.abandoned || desired === state.value) return
    try {
      if (state.value === null) {
        if (desired === null) return
        if (!state.swept) {
          state.swept = true
          await git
            .sweep(ctx, {
              instanceId: this.deps.protection.instanceId,
              keepSerials: () => this.keptSerials(),
              isProcessAlive: this.deps.protection.isProcessAlive
            })
            .catch(() => undefined)
        }
        await git.create(ctx, state.refName, desired)
      } else if (desired !== null) {
        await git.update(ctx, state.refName, desired, state.value)
      } else {
        await git.remove(ctx, state.refName, state.value)
      }
    } catch {
      await this.reconcileProtection(record, desired)
      return
    }
    this.applyProtectionValue(record, desired)
  }

  // 書き込みの失敗の後に ref の今の値を読み直して分類する。読み直し自体の失敗は何も変えない(空を「無い」と読まない。L-002)
  private async reconcileProtection(record: AgentChangesRecord, desired: string | null): Promise<void> {
    const state = record.protection
    let current: string | null
    try {
      current = await this.deps.protection.git.read(this.protectionContextOf(record), state.refName)
    } catch {
      return
    }
    if (current === desired) {
      this.applyProtectionValue(record, desired)
      return
    }
    // 前に書いた値のまま(作るときは「無い」まま)なら次の同期で試し直す
    if (current === state.value) return
    // 利用者が消した・書き換えた。以後は作り直さず、消さない(掃除でも残す)
    state.abandoned = true
    this.abandonedSerials.add(record.recordSerial)
    this.protectedRecords.delete(record)
  }

  // 書けた値を記録に反映する。作れた・更新できた時点で終了中なら、新しい値でその場で同期で消す(close の後に残さない)
  private applyProtectionValue(record: AgentChangesRecord, value: string | null): void {
    record.protection.value = value
    if (value === null) {
      this.protectedRecords.delete(record)
      return
    }
    this.protectedRecords.add(record)
    if (this.closed) this.removeProtectionRefSync(record)
  }

  // アプリの終了の同期の削除。消せたら value を null にして集合から外す
  private removeProtectionRefSync(record: AgentChangesRecord): void {
    const { refName, value } = record.protection
    if (value === null) return
    try {
      if (this.deps.protection.git.removeSync(this.protectionContextOf(record), refName, value)) {
        record.protection.value = null
        this.protectedRecords.delete(record)
      }
    } catch {
      // 消せなかった ref は、次にそのリポジトリで記録を取るときの掃除で消える
    }
  }

  // 掃除で残す番号: すべての所有者の今の記録・ref を作れた記録(削除待ちを含む)・保護をやめた番号
  private keptSerials(): ReadonlySet<number> {
    return new Set([
      ...[...this.records.values()].map((record) => record.recordSerial),
      ...[...this.protectedRecords].map((record) => record.recordSerial),
      ...this.abandonedSerials
    ])
  }
```

- [ ] **Step 5: 既存の registry の組み立てを直す**

- `src/main/__tests__/handlers/agentChangesHandlers.test.ts` の L79-85 の `new AgentBaselineRegistry({ ... })` に `protection: makeFakeProtectionDeps()` を足す（import に `makeFakeProtectionDeps`）
- `src/main/ipcHandlers.ts`:
  - L1 を `import { randomBytes, randomUUID } from 'node:crypto'` にする
  - import に足す:
```ts
import {
  createProtectionInstanceId,
  isProcessAliveOnThisMachine,
  prepareAgentChangesNoHooksDir,
  protectionRefGit
} from './agentChangesProtectionRef'
```
  - L116-121 を置き換える:
```ts
  // エージェントの変更の記録(所有者ごと)。フォルダの切り替え・リロード・破棄・アプリの終了で捨てる。
  // 記録中は記録の tree を専用の ref から守る(instanceId は起動ごとに 1 回だけ作る。hook の無いディレクトリは userData の下)
  const agentBaselineRegistry = new AgentBaselineRegistry({
    takeSnapshot: (folderPath, options) => takeBaselineSnapshot(folderPath, options),
    removeDir: removeBaselineDir,
    removeDirSync: removeBaselineDirSync,
    now: Date.now,
    protection: {
      instanceId: createProtectionInstanceId(process.pid, randomBytes(4).toString('hex')),
      noHooksDir: prepareAgentChangesNoHooksDir(app.getPath('userData')),
      git: protectionRefGit,
      isProcessAlive: isProcessAliveOnThisMachine
    }
  })
```
- `src/main/__tests__/ipcHandlers.test.ts`:
  - `const mockMkdirSync = vi.hoisted(() => vi.fn())` を足し、`vi.mock('node:fs', ...)` の戻り値を `{ ...actual, default: { ...actual, watch: mockWatch, mkdirSync: mockMkdirSync }, watch: mockWatch, mkdirSync: mockMkdirSync }` にする
  - L255 の it の末尾に足す:
```ts
    // 記録の tree を守る ref の hook の無いディレクトリを userData の下に 0700 で用意する
    expect(mockMkdirSync).toHaveBeenCalledWith('/mock/userData/agent-changes-no-hooks', {
      recursive: true,
      mode: 0o700
    })
```

- [ ] **Step 6: 実 git の失敗するテストを書く（gc の後も戻せる）**

`src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`:
1. import に `mkdirSync`・`existsSync`・`writeFileSync`・`chmodSync`（`node:fs`）・`join`（`node:path`）、`createProtectionInstanceId`・`isProcessAliveOnThisMachine`・`protectionRefGit`（`../../agentChangesProtectionRef`）、`runGit`（`../helpers/realGitRepo`）を足す
2. `beforeEach` の registry の組み立てに足す（`noHooksDir` は `tempRoot` の下に作る）:
```ts
  const noHooksDir = join(tempRoot, 'no-hooks')
  mkdirSync(noHooksDir, { mode: 0o700 })
  registry = new AgentBaselineRegistry({
    takeSnapshot: (folderPath, options) => takeBaselineSnapshot(folderPath, { ...options, tempRoot }),
    removeDir: removeBaselineDir,
    removeDirSync: removeBaselineDirSync,
    now: Date.now,
    protection: {
      instanceId: INSTANCE_ID,
      noHooksDir,
      git: protectionRefGit,
      isProcessAlive: isProcessAliveOnThisMachine
    }
  })
```
（`const INSTANCE_ID = createProtectionInstanceId(process.pid, 'abcdef01')` をファイルの上に置く。ref の一覧は `const protectionRefs = (): string => runGit(repo, 'for-each-ref', '--format=%(refname) %(objecttype)', 'refs/prompt-ide/')`、同期の完了は、そのケースで期待する項目まで `await vi.waitFor(() => expect(lsTree()).toBe('baseline\nrun-2\n'))` の形で待つ〈`const lsTree = (): string => runGit(repo, 'ls-tree', '--name-only', 'refs/prompt-ide/agent-changes/' + INSTANCE_ID + '/1')`。`twoRuns()` が返った時点では 2 回目の send の同期がまだ走っていないことがあり、「ref が空でない」まで待つだけでは `baseline` だけの回がある〉。`vi` を import に足す）
3. registry を作り直す補助関数を足す。`folderAccess` は今 `beforeEach` の中の `const` のため、ファイルの `let folderAccess: FolderAccessManager` に出す。handler は登録の時点の registry を掴むため、作り直しでは古い registry を閉じてから登録し直す（`afterEach` は `registry` 変数の今の値だけを `close()` する）:
```ts
// 古い registry を閉じ、保護の依存を差し替えた新しい registry で handler を登録し直す
function rebuildRegistry(protection: Partial<AgentBaselineProtectionDeps> = {}): void {
  registry.close()
  handles.clear()
  registry = new AgentBaselineRegistry({
    takeSnapshot: (folderPath, options) => takeBaselineSnapshot(folderPath, { ...options, tempRoot }),
    removeDir: removeBaselineDir,
    removeDirSync: removeBaselineDirSync,
    now: Date.now,
    protection: {
      instanceId: INSTANCE_ID,
      noHooksDir,
      git: protectionRefGit,
      isProcessAlive: isProcessAliveOnThisMachine,
      ...protection
    }
  })
  registerAgentChangesHandlers(ipcMain as never, { registry, folderAccess, trash: trash.trash })
}
```
（`noHooksDir` も `beforeEach` から ファイルの `let` に出す。import に `import type { AgentBaselineProtectionDeps } from '../../agentBaselineRegistry'`。**Task 4 以降**は、この補助関数の registry に `trash: trash.trash` を、`registerAgentChangesHandlers` に `undoCapture: { tempRoot, maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES }` を、`beforeEach` の組み立てと同じく足す〈Task 4 Step 6・Step 8 の「registry の依存を組み立てる箇所」「handler のテストの registerAgentChangesHandlers の呼び出し」に、この補助関数も含める〉）
4. 新しい describe `'記録の gc からの保護(実 git)'` に次のケースを書く:
   - **ref の形**: `twoRuns()` の後、`await vi.waitFor(() => expect(lsTree()).toBe('baseline\nrun-2\n'))` で 2 回目の同期まで待ってから、`protectionRefs()` が `refs/prompt-ide/agent-changes/${INSTANCE_ID}/1 tree\n`。`runGit(repo, 'ls-tree', '--name-only', 'refs/prompt-ide/agent-changes/' + INSTANCE_ID + '/1')` が `baseline\nrun-2\n`（実行 1 の開始は累積の始点のため項目を作らない）
   - **gc の後も使える（確認の結果 12・22 の回帰の逆）**: 記録だけが持つ blob を作るため `twoRuns()` を使わずに、`a.txt`（`a\n`）・`b.txt`（`b\n`）をコミット → `write('a.txt', 'a\nuser\n')`（コミットしない利用者の変更）→ `invoke('agentChanges:begin', 'send')` → `write('a.txt', 'a\nuser\nrun1\n')` → `invoke('agentChanges:begin', 'send')` → `write('b.txt', 'b\nrun2\n')` → ref の `ls-tree --name-only` が `baseline\nrun-2\n` になるまで待つ → `runGit(repo, 'gc', '-q', '--prune=now')` → `pathsOf(ALL)` が `['a.txt', 'b.txt']`、`pathsOf(RUN_1)` が `['a.txt']`（途中の実行。両端の tree が記録だけの object）、`invoke('agentChanges:getDiff', 'a.txt', ALL)` が `+run1` を含む文字列で resolve、`invoke('agentChanges:revertFile', 'a.txt', ALL)` が resolve し `readRepoFile(repo, 'a.txt')` が `a\nuser\n`（記録だけが持つ blob から戻る）
   - **変異**: `syncProtection` の呼び出し（`begin` の `this.enqueueProtectionSync(ownerId, record)`・`addRun` の同じ行）をコメントにすると、上のケースの戻す操作が `実行前の内容が見つかりません` で落ちることを確かめてから戻す（手順に従って手で確かめる。テストのコードには書かない）
   - **clear で消える**: `twoRuns()` の後に `invoke('agentChanges:clear')` → `protectionRefs()` が `''`。区切りだけが持つ blob（実行 1 で書いた `a.txt` の `a\nrun1\n`。`runGit(repo, 'rev-parse', 'refs/prompt-ide/agent-changes/' + INSTANCE_ID + '/1:run-2/a.txt').trim()` を clear の前に控える）が、`git gc -q --prune=now` の後に `runGit(repo, 'cat-file', '-t', blob)` で例外になる
   - **利用者の状態を変えない**: 記録の前に `runGit(repo, 'log', '--all', '--oneline')`・`runGit(repo, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags')`・`runGit(repo, 'rev-parse', 'HEAD')`・`runGit(repo, 'stash', 'list')`・`.git/index` の内容（base64）と更新時刻（`statSync(..., { bigint: true }).mtimeNs`）を控え、`twoRuns()` と ref の作成の後に同じ
   - **hook が動かない**: `twoRuns()` を使わずに、`a.txt`（`a\n`）・`b.txt`（`b\n`）を先にコミットする（`commitAll` も hook を動かすため、hook はコミットの**後**に置く）。続けて `.git/hooks/reference-transaction` に `` `#!/bin/sh\necho ran >> '${join(repo, 'hook-ran')}'\n` ``（書き込み先はテストが埋め込む絶対パス。hook の環境には `GIT_DIR` が無い）を書いて `chmodSync(..., 0o755)` し、`existsSync(join(repo, 'hook-ran'))` が `false` であることを確かめてから、`invoke('agentChanges:begin', 'send')` → `write('a.txt', 'a\nrun1\n')` → `invoke('agentChanges:begin', 'send')` → ref の `run-2` ができるまで待つ → `existsSync(join(repo, 'hook-ran'))` が `false`。`invoke('agentChanges:clear')` の後も `false`（記録の一時ディレクトリを消した後の削除でも動かない）
   - **利用者が消したら作り直さない**: `twoRuns()` → ref ができたら `runGit(repo, 'update-ref', '-d', <ref>)` → `write('c.txt', 'c\n')` → `invoke('agentChanges:begin', 'send')` → 列が進むのを待つ（`invoke('agentChanges:list', ALL)` を 1 回待つ）→ `protectionRefs()` が `''`
   - **無い項目を除く**: `rebuildRegistry({ git: ... })`（下の補助関数）で registry を作り直し、`git` に `{ ...protectionRefGit, filterExistingTrees: async (ctx, entries) => { await gate; return protectionRefGit.filterExistingTrees(ctx, entries) } }`（`gate` は 2 回目の同期だけを待たせる Promise。1 回目は通す）を渡す。1 回目の send で ref（`baseline`）ができたら `write('a.txt', 'a\nrun1\n')` → 2 回目の send（区切りの tree は新しい）→ 2 回目の同期が待っている間に `git gc -q --prune=now` → 待ちを解く → ref の `ls-tree --name-only` が `baseline\n` のまま（`run-2` は object が無いため除いた）。3 回目の send の前に `write('b.txt', 'b\nrun3\n')` と、**`a.txt` も大きさの違う内容で書き直す** `write('a.txt', 'a\nrun3-x\n')`（写しの元〈run-2 の記録のインデックス。更新時刻も引き継ぐ〉にある `a.txt` の blob は gc で消えているため、stat が一致すると `add -A` が読み直さず、`write-tree` が `invalid object … for 'a.txt'` で失敗する。大きさを変えて読み直させ、blob を作り直させる。秒の境目で結果が変わらないようにするため）→ send → `baseline\nrun-3\n`。`invoke('agentChanges:clear')` で消える
   - **SHA-256 のリポジトリ**: `const shaRepo = realpathSync(mkdtempSync(join(tmpdir(), 'agent-changes-sha256-')))` で作る（macOS の `tmpdir()` は `/var/...` で、`git rev-parse --show-toplevel` は `/private/var/...` を返すため、realpath にしないと `takeBaselineSnapshot` が `not-toplevel` にする）。`runGit(shaRepo, 'init', '-q', '--object-format=sha256', '-b', 'main')`・`runGit(shaRepo, 'config', 'user.name', 'tester')`・`runGit(shaRepo, 'config', 'user.email', 'tester@example.com')`（`initRepo` と同じ設定）の後に `writeRepoFile(shaRepo, 'a.txt', 'a\n')`・`commitAll(shaRepo, 'init')` でコミットし、`folderAccess.set(1, shaRepo)` → `rebuildRegistry()` → send（`try`/`finally` でテストの中で `rmSync(shaRepo, { recursive: true, force: true })`） → `await vi.waitFor(...)` で `runGit(shaRepo, 'for-each-ref', '--format=%(objectname)', 'refs/prompt-ide/')` の値が 64 桁の ID 1 つになるまで待つ
   - **残った ref の掃除**: `rebuildRegistry({ isProcessAlive: (pid) => pid !== 4242 })` で作り直す。記録の前に、`a.txt` をコミットした tree（`runGit(repo, 'write-tree').trim()`）を子 `baseline` に持つ tree（`runBaselineGitWithInput(repo, join(repo, '.git/index'), ['mktree', '-z'], `040000 tree ${tree}\tbaseline\0`)`）を作り、`refs/prompt-ide/agent-changes/4242-00000000/1`（死んだ pid・自分の形の値）、`refs/prompt-ide/agent-changes/4242-00000000/2`（値が HEAD のコミット）、`refs/prompt-ide/agent-changes/4242-00000000/3`（値が空の tree〈`mktree -z` に空の入力〉）、`refs/prompt-ide/agent-changes/foo/1`（形の違う名前）を `runGit(repo, 'update-ref', <名前>, <値>)` で置く → send して自分の ref ができるまで待つ → `4242-00000000/1` だけが消え、ほかの 3 つと自分の ref が残る

Run: `npx vitest run src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`
Expected: Step 4 を入れる前に書いた場合は FAIL（ref が無い・gc の後に戻せない）。Step 4 の後は PASS

- [ ] **Step 7: テストを通す**

Run: `npx vitest run src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/agentBaselineLifecycle.test.ts src/main/__tests__/agentChangesScope.test.ts src/main/__tests__/agentChangesScopedQuery.test.ts src/main/__tests__/agentChangesRuns.integration.test.ts`
Expected: PASS（既存のテストも変えずに通る。既存の registry のテストが保護の同期の並びで落ちたら、偽物の保護の git がすぐに終わることを確かめ、落ちたテストの待ち方〈`vi.waitFor`〉だけを直す。期待値は変えない）

- [ ] **Step 8: 型・lint**

Run: `npm run typecheck`
Expected: PASS
Run: このタスクの **Files** に挙げた `.ts`・`.tsx` のファイル（作成・変更・テスト）をすべて並べて `npx eslint --fix <ファイル…> && npx eslint --max-warnings 0 <ファイル…>`（`src/main/agentChangesRecord.ts src/main/agentBaselineRegistry.ts src/main/ipcHandlers.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/ipcHandlers.test.ts`）
Expected: エラー・警告なし

---

### Task 3: 実測（未確認事項 2）と取り消しの控え・照合・書き戻しの部品（`agentChangesUndo.ts`）

**Files:**
- Modify: `src/shared/types/agentChanges.ts`（先頭に `import type { DiscardAllResult } from './git'`。末尾に Global Constraints の新しい共有の型〈`AgentChangesUndoAction` 〜 `AgentChangesUndoResult`〉を足す。既存の型は変えない）
- Create: `src/main/agentChangesUndo.ts`
- Test: `src/main/__tests__/agentChangesUndo.test.ts`（新規。一時ディレクトリの実ファイル）
- Test: `src/main/__tests__/agentChangesUndo.mocked.test.ts`（新規。`node:fs/promises` の `readFile`・`lstat`・`open` を包んだ偽物で、ストリームの計算・書く直前の照合・書き込みの途中の失敗を確かめる）
- Test: `src/main/__tests__/openFileWatcher.integration.test.ts`（`it.each` に取り消しの書き戻しの形〈`.prompt-ide-undo-<16 桁>` + `rename`〉を足す。未確認事項 2）

**Interfaces:**
- Consumes: `listPathsForMessage(paths: string[]): string`（`src/main/discardBatch.ts`）、共有の型 `AgentChangesUndoAction`・`AgentChangesUndoOperation`・`AgentChangesUndoSummary`・`AgentRevertUndoOutcome`・`AgentRevertUndoUnavailableReason`
- Produces:
```ts
// src/main/agentChangesUndo.ts
export const AGENT_CHANGES_UNDO_MAX_BYTES: number // 100 * 1024 * 1024
export const AGENT_CHANGES_UNDO_TEMP_PREFIX = 'prompt-ide-agent-undo-'
export const AGENT_UNDO_WRITE_TEMP_PREFIX = '.prompt-ide-undo-'
export const AGENT_UNDO_PREPARE_FAILED_MESSAGE = '取り消しの準備に失敗したため、戻すのを中止しました'
export const AGENT_UNDO_STALE_MESSAGE = '取り消せる操作が変わりました。一覧を更新してください'
export const AGENT_UNDO_CHANGED_MESSAGE = '戻した後に変わったファイルがあるため、取り消せません'
export type AgentChangesUndoBefore = { kind: 'absent' } | { kind: 'file'; savedName: string; mode: number } | { kind: 'symlink'; target: string }
export type AgentChangesUndoAfter = { kind: 'absent' } | { kind: 'file'; size: number; sha256: string; mode: number } | { kind: 'symlink'; target: string }
export interface AgentChangesUndoItem { path: string; before: AgentChangesUndoBefore; after: AgentChangesUndoAfter }
export interface AgentChangesUndo { undoId: number; operation: AgentChangesUndoOperation; dir: string; items: AgentChangesUndoItem[] }
export interface AgentChangesUndoCaptureOptions { tempRoot: string; maxBytes: number }
export interface AgentChangesUndoTarget { path: string; isDirectory: boolean }
export type AgentChangesUndoCapture =
  | { kind: 'saved'; dir: string; items: AgentChangesUndoItem[] }
  | { kind: 'unavailable'; reason: AgentRevertUndoUnavailableReason }
export interface AgentChangesUndoRecorder {
  /** 1 件を適用した後に呼ぶ(例外を投げない。控えられなければ capture-failed にして一時ディレクトリを消す) */
  recordAfter(path: string): Promise<void>
  /** 結果を返す。saved なら一時ディレクトリの持ち主は呼び出し側に移る */
  finish(): Promise<AgentChangesUndoCapture>
  /** 戻す操作が例外で終わるときに呼ぶ(作った一時ディレクトリを消す) */
  discard(): Promise<void>
}
export async function startAgentChangesUndoRecorder(
  folderPath: string,
  targets: readonly AgentChangesUndoTarget[],
  options: AgentChangesUndoCaptureOptions
): Promise<AgentChangesUndoRecorder>
export function hashFileSha256(absolutePath: string): Promise<string>
export async function writeFileExclusive(path: string, data: Buffer, mode: number): Promise<void>
export function undoActionOf(item: Pick<AgentChangesUndoItem, 'before' | 'after'>): AgentChangesUndoAction
export function summarizeAgentChangesUndo(undo: AgentChangesUndo | null): AgentChangesUndoSummary | null
export function toAgentRevertUndoOutcome(capture: AgentChangesUndoCapture): AgentRevertUndoOutcome
export interface AgentChangesUndoFs { link: (existingPath: string, newPath: string) => Promise<void> }
export interface AgentChangesUndoContext {
  folderPath: string
  undo: AgentChangesUndo
  trash: (absolutePath: string) => Promise<void>
  /** テストで link を差し替える(ハードリンクを作れないファイルシステムの再現) */
  fs?: Partial<AgentChangesUndoFs>
}
export type AgentChangesUndoExecution =
  /** 何も書き換えずに拒否した。keepUndo は控えを残すか(読み込みの失敗だけ) */
  | { kind: 'rejected'; message: string; keepUndo: boolean }
  /** 書き換えを始めた後、1 件も済まずに止まった */
  | { kind: 'failed'; message: string }
  | { kind: 'done'; restoredPaths: string[]; trashedPaths: string[] }
  | { kind: 'partial'; message: string; restoredPaths: string[]; trashedPaths: string[] }
export async function undoLastAgentRevert(context: AgentChangesUndoContext): Promise<AgentChangesUndoExecution>
```

- [ ] **Step 1: 共有の型を足す**

`src/shared/types/agentChanges.ts` の先頭（コメントの次の行）に `import type { DiscardAllResult } from './git'` を足し、末尾に Global Constraints の「共有の型」のコードブロックの `AgentChangesUndoAction` から `AgentChangesUndoResult` までを、JSDoc を付けて足す（`// Task 5 から:` のコメントの行は足さない）。

Run: `npm run typecheck`
Expected: PASS（型を足しただけ）

- [ ] **Step 2: 実ファイルの失敗するテストを書く**

`src/main/__tests__/agentChangesUndo.test.ts`。準備と補助関数:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { link } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_CHANGES_UNDO_MAX_BYTES,
  startAgentChangesUndoRecorder,
  summarizeAgentChangesUndo,
  toAgentRevertUndoOutcome,
  undoLastAgentRevert
} from '../agentChangesUndo'
import type {
  AgentChangesUndo,
  AgentChangesUndoCapture,
  AgentChangesUndoTarget
} from '../agentChangesUndo'
import { createFakeTrash } from './helpers/agentBaselineFixtures'

let root: string
let folder: string
let tempRoot: string
const abs = (path: string): string => join(folder, path)
const write = (path: string, content: string | Buffer, mode = 0o644): void => {
  mkdirSync(join(abs(path), '..'), { recursive: true })
  writeFileSync(abs(path), content)
  chmodSync(abs(path), mode)
}
const sha = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex')
// root(uid 0)では権限の拒否が起きないため、権限のテストを飛ばす
const isRoot = process.getuid?.() === 0

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-undo-')))
  folder = join(root, 'repo')
  tempRoot = join(root, 'temp')
  mkdirSync(folder)
  mkdirSync(tempRoot)
})

afterEach(() => {
  // 権限を落としたディレクトリも消せるように戻す
  for (const dir of [folder, join(folder, 'sub')]) {
    if (existsSync(dir)) chmodSync(dir, 0o755)
  }
  rmSync(root, { recursive: true, force: true })
})

// 戻す操作の流れ(控えの準備 → 適用 → 1 件ごとの after → 結果)を再現する
async function capture(
  targets: AgentChangesUndoTarget[],
  apply: () => void,
  maxBytes = AGENT_CHANGES_UNDO_MAX_BYTES
): Promise<AgentChangesUndoCapture> {
  const recorder = await startAgentChangesUndoRecorder(folder, targets, { tempRoot, maxBytes })
  apply()
  for (const target of targets) await recorder.recordAfter(target.path)
  return recorder.finish()
}

const fileTarget = (path: string): AgentChangesUndoTarget => ({ path, isDirectory: false })

function undoOf(result: AgentChangesUndoCapture): AgentChangesUndo {
  if (result.kind !== 'saved') throw new Error(`控えが取れなかった: ${JSON.stringify(result)}`)
  return { undoId: 1, operation: 'file', dir: result.dir, items: result.items }
}

const leftoverTemps = (dir = folder): string[] =>
  readdirSync(dir).filter((name) => name.startsWith('.prompt-ide-undo-'))
```
次のケースを書く（括弧の中が期待値）:

**控え（`startAgentChangesUndoRecorder`）**
1. 変更: `write('a.txt', 'agent')` → `capture([fileTarget('a.txt')], () => writeFileSync(abs('a.txt'), 'base'))`（`kind: 'saved'`。`items` が `[{ path: 'a.txt', before: { kind: 'file', savedName: '0', mode: 0o644 }, after: { kind: 'file', size: 4, sha256: sha('base'), mode: 0o644 } }]`。`dir` は `tempRoot` の直下で名前が `prompt-ide-agent-undo-` で始まり、`statSync(dir).mode & 0o777` が `0o700`、`readFileSync(join(dir, '0'), 'utf8')` が `agent`、`statSync(join(dir, '0')).mode & 0o777` が `0o600`）
2. 追加のファイルをゴミ箱へ: `write('z.txt', 'z', 0o755)` → apply で `unlinkSync`（`before: { kind: 'file', savedName: '0', mode: 0o755 }`、`after: { kind: 'absent' }`）
3. 削除を作り直す: `z` が無い状態から apply で `write('d.txt', 'base')`（`before: { kind: 'absent' }`、`after` は `file`）
4. リンク: `symlinkSync('x', abs('l'))` → apply で `unlinkSync` して `writeFileSync(abs('l'), 'base')`（`before: { kind: 'symlink', target: 'x' }`）
5. `summarizeAgentChangesUndo` と `toAgentRevertUndoOutcome`: 2・3・1 をまとめた 3 件の控え（`b.txt` 書き戻し・`d.txt` 作り直したもの・`z.txt` ゴミ箱へ移したもの）の要約が `{ undoId: 1, operation: 'all', entries: [{ path: 'b.txt', action: 'rewrite' }, { path: 'd.txt', action: 'trash' }, { path: 'z.txt', action: 'recreate' }] }`（`items` はパスの昇順。対象を逆順に渡しても昇順）。`summarizeAgentChangesUndo(null)` は `null`。`toAgentRevertUndoOutcome` は `saved` → `{ kind: 'saved' }`、`unavailable` → `{ kind: 'unavailable', reason }`
6. 追加されたフォルダ: `{ path: 'nd', isDirectory: true }` を含むと `{ kind: 'unavailable', reason: 'directory' }`、`readdirSync(tempRoot)` が `[]`
7. ファイル・リンク以外: パスがディレクトリ（`mkdirSync(abs('dir'))`。`isDirectory: false` で渡す）→ `unsupported-type`。FIFO（`execFileSync('mkfifo', [abs('fifo')])`。`process.platform === 'win32'` なら飛ばす）→ `unsupported-type`。どちらも `tempRoot` は空
8. 上限の境界: `maxBytes = 10` で 10 バイトのファイル → `saved`、11 バイト → `too-large`、6 バイトと 5 バイトの 2 件 → `too-large`（`tempRoot` は空）。上限を超えても読み込まない（`too-large` のときに控えのディレクトリを作らない）
9. `after` の控えの失敗 → `{ kind: 'unavailable', reason: 'capture-failed' }` で `tempRoot` が空: (a) apply でパスをディレクトリにする、(b) apply でパスを FIFO にする（win32 は飛ばす）、(c) 前も後も無い（対象 `none.txt` が無く、apply で何もしない）、(d) `lstat` の失敗（`sub/a.txt` を対象にし、apply で `chmodSync(join(folder, 'sub'), 0o600)`。`isRoot` なら飛ばす）
10. 控えの準備の失敗: `write('a.txt', 'x')` → `chmodSync(abs('a.txt'), 0o000)` → `startAgentChangesUndoRecorder(folder, [fileTarget('a.txt')], ...)` が `取り消しの準備に失敗したため、戻すのを中止しました: a.txt` で reject し、`tempRoot` が空（`isRoot` なら飛ばす）
11. `discard()` は作った一時ディレクトリを消す（`startAgentChangesUndoRecorder` の後に `discard` → `tempRoot` が空）。`finish()` の後の `discard()` は `saved` の一時ディレクトリを消さない（持ち主が移った）

**取り消し（`undoLastAgentRevert`）**。`trash` は `createFakeTrash()` の `trash`（移したパスを控えて実際に消す）
12. 書き戻し: 1 の控え → `undoLastAgentRevert({ folderPath: folder, undo, trash })` が `{ kind: 'done', restoredPaths: ['a.txt'], trashedPaths: [] }`、`a.txt` が `agent`、権限 `0o644`、`leftoverTemps()` が `[]`（未確認事項 2: APFS で一時ファイルが残らない）
13. 作り直し: 2 の控え（`0o755`）→ `z.txt` が `z` で権限 `0o755`、`restoredPaths: ['z.txt']`、`leftoverTemps()` が `[]`
14. ゴミ箱へ: 3 の控え → `trashed` が `[abs('d.txt')]`、`existsSync(abs('d.txt'))` が `false`、`trashedPaths: ['d.txt']`
15. リンク: 4 の控え → `readlinkSync(abs('l'))` が `x`。リンクの作り直し（`symlinkSync('x', abs('k'))` → apply で `unlinkSync`）→ `readlinkSync(abs('k'))` が `x`
16. バイト列: `write('crlf.txt', Buffer.from('a\r\nb\r\n'))` → apply で `writeFileSync(abs('crlf.txt'), 'a\nb\n')` → 取り消しの後の `readFileSync(abs('crlf.txt'))` が `Buffer.from('a\r\nb\r\n')` と等しい
17. 長い名前: `const name = 'x'.repeat(251) + '.txt'`（255 バイト）で 12 と同じ流れ → `done`
18. 照合の不一致（何も書かずに `{ kind: 'rejected', keepUndo: false, message: '戻した後に変わったファイルがあるため、取り消せません（a.txt）' }`。ファイルは取り消しの前のまま）を `it.each` で: 中身だけ変わった（同じ大きさ `BASE`）、大きさが変わった、権限が変わった（`chmodSync(abs('a.txt'), 0o600)`）、リンクに置き換わった、ディレクトリに置き換わった。リンクの指す先が変わった（4 の控えの後に `l` を `y` を指すリンクにする。メッセージの path は `l`）。`after` が無いのに現れた（2 の控えの後に `write('z.txt', 'other')`。path は `z.txt`。`z.txt` は `other` のまま）。親がリンクに置き換わった（`sub/a.txt` で 1 の流れ → `renameSync(join(folder, 'sub'), join(folder, 'sub2'))` → `symlinkSync('sub2', join(folder, 'sub'))`。path は `sub/a.txt`）。親が無い（`sub/z.txt` で 2 の流れ → `rmSync(join(folder, 'sub'), { recursive: true })`）
19. 不一致が 6 件 → メッセージが `listPathsForMessage` の形（最大 5 件と `、ほか 1 件`）
20. 不一致と読み込みの失敗が混ざる → 不一致の `rejected`（`keepUndo: false`）。読み込みの失敗だけ（`sub/a.txt` の控えの後に `chmodSync(join(folder, 'sub'), 0o600)`。`isRoot` なら飛ばす）→ `{ kind: 'rejected', keepUndo: true }` で、メッセージが `取り消しの対象を読み込めませんでした（sub/a.txt）: ` で始まる
21. `link` が `EPERM`・`ENOTSUP`・`EXDEV` で失敗（`fs: { link: async () => { throw Object.assign(new Error('not supported'), { code }) } }`）→ 目的の名前に直接書いて `done`、中身 `z`・権限 `0o755`、`leftoverTemps()` が `[]`
22. 作り直しは既にあるものを上書きしない: `fs: { link: async (existing, target) => { writeFileSync(target, 'other'); await link(existing, target) } }` → `{ kind: 'failed' }` でメッセージが `取り消しに失敗しました: z.txt: ` で始まり `EEXIST` を含む、`z.txt` は `other`、`leftoverTemps()` が `[]`
23. 書き換えの失敗: 0 件（`sub/a.txt` の控えの後に `chmodSync(join(folder, 'sub'), 0o555)`。`isRoot` なら飛ばす）→ `{ kind: 'failed' }` でメッセージが `取り消しに失敗しました: sub/a.txt: ` で始まる。1 件済み（`a.txt` と `sub/b.txt` の 2 件。`sub` を `0o555`）→ `{ kind: 'partial', message: '取り消しが途中で失敗しました（1 / 2 件を取り消し済み）: sub/b.txt: ...', restoredPaths: ['a.txt'], trashedPaths: [] }`（メッセージは `toMatch(/^取り消しが途中で失敗しました（1 \/ 2 件を取り消し済み）: sub\/b\.txt: /)`）
24. 書く直前の照合の不一致で止まる（1 件済み）: `a.txt`（ゴミ箱へ。3 の形）と `b.txt`（書き戻し。1 の形）の控え → `trash` を「`a.txt` を消し、続けて `b.txt` を `CHANGED` に書き換える」偽物にする → `{ kind: 'partial', message: '取り消しが途中で失敗しました（1 / 2 件を取り消し済み）: b.txt が戻した後に変わりました', restoredPaths: [], trashedPaths: ['a.txt'] }`、`b.txt` は `CHANGED` のまま
25. ゴミ箱の失敗: `trash` が reject → 0 件なら `{ kind: 'failed', message: '取り消しに失敗しました: d.txt: ゴミ箱へ移動できませんでした' }`

Run: `npx vitest run src/main/__tests__/agentChangesUndo.test.ts`
Expected: FAIL（`Cannot find module '../agentChangesUndo'`）

- [ ] **Step 3: 偽物の fs で確かめる失敗するテストを書く**

`src/main/__tests__/agentChangesUndo.mocked.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// fs/promises の readFile・lstat・open を包む(実物を呼ぶ前に差し込みを呼ぶ)
const hooks = vi.hoisted(() => ({
  readFilePaths: [] as string[],
  beforeLstat: null as ((path: string) => void) | null,
  failWriteFor: null as string | null
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const wrapped = {
    ...actual,
    readFile: (async (...args: Parameters<typeof actual.readFile>) => {
      hooks.readFilePaths.push(String(args[0]))
      return actual.readFile(...args)
    }) as typeof actual.readFile,
    lstat: (async (...args: Parameters<typeof actual.lstat>) => {
      hooks.beforeLstat?.(String(args[0]))
      return actual.lstat(...args)
    }) as typeof actual.lstat,
    open: (async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      if (hooks.failWriteFor !== String(args[0])) return handle
      return Object.assign(Object.create(Object.getPrototypeOf(handle)), handle, {
        writeFile: async () => {
          throw new Error('ENOSPC: no space left on device')
        },
        close: () => handle.close(),
        chmod: (mode: number) => handle.chmod(mode)
      })
    }) as typeof actual.open
  }
  return { ...wrapped, default: wrapped }
})

import {
  startAgentChangesUndoRecorder,
  undoLastAgentRevert,
  writeFileExclusive
} from '../agentChangesUndo'
import { createFakeTrash } from './helpers/agentBaselineFixtures'
```
`beforeEach` で `root`・`folder`・`tempRoot` を作り `hooks` を初期値に戻し、`afterEach` で消す。次のケースを書く:
1. **ストリームの計算**: `maxBytes: 10` で、前が無い `big.bin` を対象に控えを始め、`writeFileSync(join(folder, 'big.bin'), Buffer.alloc(3 * 1024 * 1024, 7))` してから `recordAfter('big.bin')` → `finish()` の `after.sha256` が `createHash('sha256').update(Buffer.alloc(3 * 1024 * 1024, 7)).digest('hex')`、`hooks.readFilePaths` に `join(folder, 'big.bin')` が無い（上限の対象外の作り直しのファイルを、全体をメモリに読まない）
2. **書く直前の照合の不一致（0 件）**: `a.txt` の書き戻しの控え（`agent` → apply で `base`）を取り終えてから（控えの準備・`after` も `lstat` を呼ぶため、差し込みは控えの後に設定する）、`hooks.beforeLstat` を「`join(folder, 'a.txt')` の 2 回目の呼び出しで `writeFileSync(join(folder, 'a.txt'), 'BASE')` する」にする（1 回目は全件の照合、2 回目は書く直前の照合）→ `{ kind: 'failed', message: '戻した後に変わったファイルがあるため、取り消せません（a.txt）' }`、`a.txt` が `BASE`
3. **書く直前の照合で読み込めない（0 件）**: 同じ控えを取り終えてから、`a.txt` の 2 回目の `lstat` の前に `throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })` → `{ kind: 'failed', message: '取り消しに失敗しました: a.txt を読み込めませんでした: EACCES: permission denied' }`
4. **書き込みの途中の失敗で自分が作ったファイルだけを消す**: `hooks.failWriteFor = join(folder, 'new.txt')` → `writeFileExclusive(join(folder, 'new.txt'), Buffer.from('x'), 0o644)` が `ENOSPC` で reject し、`existsSync(join(folder, 'new.txt'))` が `false`。既にあるファイル（`writeFileSync(join(folder, 'old.txt'), 'keep')`）への `writeFileExclusive` は `EEXIST` で reject し、`old.txt` は `keep` のまま（自分が作れなかったものは消さない）

Run: `npx vitest run src/main/__tests__/agentChangesUndo.mocked.test.ts`
Expected: FAIL（`Cannot find module '../agentChangesUndo'`）

- [ ] **Step 4: 開いているタブの監視の失敗しないことを確かめるケースを足す（未確認事項 2）**

`src/main/__tests__/openFileWatcher.integration.test.ts` の `it.each` に足す:
```ts
    [
      '取り消しの書き戻し(同じフォルダの一時の名前 + rename)',
      (file: string) => {
        const temp = join(dir, '.prompt-ide-undo-0123456789abcdef')
        writeFileSync(temp, 'four')
        renameSync(temp, file)
      }
    ],
```
Run: `npx vitest run src/main/__tests__/openFileWatcher.integration.test.ts`
Expected: PASS（今の監視のまま通る。落ちたら止めて報告する〈監視の作りを変える判断が要る〉）

- [ ] **Step 5: `agentChangesUndo.ts` を実装する**

```ts
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  link as fsLink,
  lstat,
  mkdtemp,
  open,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  unlink
} from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  AgentChangesUndoAction,
  AgentChangesUndoOperation,
  AgentChangesUndoSummary,
  AgentRevertUndoOutcome,
  AgentRevertUndoUnavailableReason
} from '@shared/types'
import { listPathsForMessage } from './discardBatch'

// 戻した操作の取り消し(設計書「戻した操作の取り消し(main)」)。戻す操作が書き換える各パスについて、戻す直前の状態
// (無い・ファイルのバイト列と権限・リンクの指す先)を記録と同じアプリの一時ディレクトリへ控え、戻した直後の指紋(大きさ・SHA-256・
// 権限・リンクの指す先)を控える。取り消しは全件を指紋と照合してから(L-036・L-038)、同じフォルダの一時の名前 + rename・link で
// 書き戻す(L-014)。git は使わない(フィルタ・改行の変換がかからず、控えたバイト列のまま戻る)。パスは控えたリポジトリ相対のパスから
// join(folderPath, path) の 1 つの規則で求める(L-018)。renderer の値は undoId だけ(L-019)

/** 控えるファイルの中身の合計の上限(記録の未追跡のファイルの合計の上限と同じ値) */
export const AGENT_CHANGES_UNDO_MAX_BYTES = 100 * 1024 * 1024
export const AGENT_CHANGES_UNDO_TEMP_PREFIX = 'prompt-ide-agent-undo-'
/** 書き戻しの一時の名前の接頭辞(後ろに乱数 16 桁の 16 進。元の名前によらない) */
export const AGENT_UNDO_WRITE_TEMP_PREFIX = '.prompt-ide-undo-'
export const AGENT_UNDO_PREPARE_FAILED_MESSAGE =
  '取り消しの準備に失敗したため、戻すのを中止しました'
export const AGENT_UNDO_STALE_MESSAGE = '取り消せる操作が変わりました。一覧を更新してください'
export const AGENT_UNDO_CHANGED_MESSAGE = '戻した後に変わったファイルがあるため、取り消せません'

/** 戻す直前の状態。savedName は控えの一時ディレクトリの中の連番のファイル名(パスを名前に使わない)。mode は mode & 0o777 */
export type AgentChangesUndoBefore =
  | { kind: 'absent' }
  | { kind: 'file'; savedName: string; mode: number }
  | { kind: 'symlink'; target: string }

/** 戻した直後の指紋 */
export type AgentChangesUndoAfter =
  | { kind: 'absent' }
  | { kind: 'file'; size: number; sha256: string; mode: number }
  | { kind: 'symlink'; target: string }

export interface AgentChangesUndoItem {
  /** リポジトリ相対(末尾の / なし) */
  path: string
  before: AgentChangesUndoBefore
  after: AgentChangesUndoAfter
}

/** 記録に持つ取り消しの控え(0 か 1 つ) */
export interface AgentChangesUndo {
  undoId: number
  operation: AgentChangesUndoOperation
  dir: string
  /** パスの昇順 */
  items: AgentChangesUndoItem[]
}

export interface AgentChangesUndoCaptureOptions {
  /** 控えの一時ディレクトリを作る場所(本番は os.tmpdir()) */
  tempRoot: string
  maxBytes: number
}

export interface AgentChangesUndoTarget {
  path: string
  /** 追加されたフォルダの行(ゴミ箱へ移す。控えない) */
  isDirectory: boolean
}

export type AgentChangesUndoCapture =
  | { kind: 'saved'; dir: string; items: AgentChangesUndoItem[] }
  | { kind: 'unavailable'; reason: AgentRevertUndoUnavailableReason }

export interface AgentChangesUndoRecorder {
  recordAfter(path: string): Promise<void>
  finish(): Promise<AgentChangesUndoCapture>
  discard(): Promise<void>
}

const errorCode = (error: unknown): string | undefined =>
  (error as NodeJS.ErrnoException | null)?.code
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
const removeDir = (dir: string): Promise<void> =>
  rm(dir, { recursive: true, force: true }).catch(() => undefined)
const comparePaths = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0

/** 中身の SHA-256(ストリームで計算し、ファイル全体をメモリに読まない) */
export function hashFileSha256(absolutePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(absolutePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * 無いことを確かめて作り(wx。既にあれば EEXIST で作らない)、data を書いて権限を mode にする。書き込みの途中で失敗したら、
 * 自分が作ったそのファイルを消す(自分が作れなかったものは消さない。L-004)。作る間の権限は 0600
 */
export async function writeFileExclusive(path: string, data: Buffer, mode: number): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(data)
    await handle.chmod(mode)
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(path).catch(() => undefined)
    throw error
  }
  try {
    await handle.close()
  } catch (error) {
    await unlink(path).catch(() => undefined)
    throw error
  }
}

const prepareFailed = (path: string, error: unknown): Error =>
  new Error(`${AGENT_UNDO_PREPARE_FAILED_MESSAGE}: ${path}`, { cause: error })

type PlannedBefore =
  | { path: string; kind: 'absent' }
  | { path: string; kind: 'file'; size: number; mode: number }
  | { path: string; kind: 'symlink' }

// 戻す前のパスの種類(読み込まない)。ファイル・リンク以外は null(控えない)。ENOENT は無い。それ以外の失敗は投げる
async function planBefore(folderPath: string, path: string): Promise<PlannedBefore | null> {
  let stat: Stats
  try {
    stat = await lstat(join(folderPath, path))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { path, kind: 'absent' }
    throw error
  }
  if (stat.isFile()) return { path, kind: 'file', size: stat.size, mode: stat.mode & 0o777 }
  if (stat.isSymbolicLink()) return { path, kind: 'symlink' }
  return null
}

async function saveBefore(
  folderPath: string,
  dir: string,
  index: number,
  plan: PlannedBefore
): Promise<AgentChangesUndoBefore> {
  const absolutePath = join(folderPath, plan.path)
  switch (plan.kind) {
    case 'absent':
      return { kind: 'absent' }
    case 'symlink':
      return { kind: 'symlink', target: await readlink(absolutePath) }
    case 'file': {
      const savedName = String(index)
      await writeFileExclusive(join(dir, savedName), await readFile(absolutePath), 0o600)
      return { kind: 'file', savedName, mode: plan.mode }
    }
  }
}

// 戻した直後の指紋。控えられない(lstat・読み込みの失敗、ディレクトリ・ファイルとリンク以外)なら null
async function captureAfter(absolutePath: string): Promise<AgentChangesUndoAfter | null> {
  let stat: Stats
  try {
    stat = await lstat(absolutePath)
  } catch (error) {
    return errorCode(error) === 'ENOENT' ? { kind: 'absent' } : null
  }
  try {
    if (stat.isFile()) {
      return {
        kind: 'file',
        size: stat.size,
        sha256: await hashFileSha256(absolutePath),
        mode: stat.mode & 0o777
      }
    }
    if (stat.isSymbolicLink()) return { kind: 'symlink', target: await readlink(absolutePath) }
  } catch {
    return null
  }
  return null
}

function unavailableRecorder(reason: AgentRevertUndoUnavailableReason): AgentChangesUndoRecorder {
  return {
    recordAfter: async () => undefined,
    finish: async () => ({ kind: 'unavailable', reason }),
    discard: async () => undefined
  }
}

function capturingRecorder(
  folderPath: string,
  dir: string,
  befores: ReadonlyMap<string, AgentChangesUndoBefore>
): AgentChangesUndoRecorder {
  const items: AgentChangesUndoItem[] = []
  let failed = false
  // 一時ディレクトリをまだ持っているか(finish で saved を返したら持ち主が移る)
  let owned = true
  const drop = async (): Promise<void> => {
    if (!owned) return
    owned = false
    await removeDir(dir)
  }
  return {
    recordAfter: async (path) => {
      if (failed) return
      const before = befores.get(path)
      const after = before === undefined ? null : await captureAfter(join(folderPath, path))
      if (
        before === undefined ||
        after === null ||
        (before.kind === 'absent' && after.kind === 'absent')
      ) {
        // 戻す操作は成功のまま、控えを捨てる(作業ツリーを変えた後の失敗を、戻す操作の失敗にしない。L-001)
        failed = true
        await drop()
        return
      }
      items.push({ path, before, after })
    },
    finish: async () => {
      if (failed || items.length === 0) {
        await drop()
        return { kind: 'unavailable', reason: 'capture-failed' }
      }
      owned = false
      return { kind: 'saved', dir, items: [...items].sort(comparePaths) }
    },
    discard: drop
  }
}

/**
 * 戻す操作の控えを始める(作業ツリーを変える前に呼ぶ。L-003)。追加されたフォルダを含む → directory、ファイル・リンク以外 →
 * unsupported-type、ファイルの中身の合計が上限を超える → too-large(読み込まない)。どれでもなければ一時ディレクトリ(0700)に
 * 戻す前のファイルを写す。上限以外の理由で控えられなければ、作った一時ディレクトリを消して例外(戻す操作を中止する)
 */
export async function startAgentChangesUndoRecorder(
  folderPath: string,
  targets: readonly AgentChangesUndoTarget[],
  options: AgentChangesUndoCaptureOptions
): Promise<AgentChangesUndoRecorder> {
  if (targets.some((target) => target.isDirectory)) return unavailableRecorder('directory')
  const planned: PlannedBefore[] = []
  let totalBytes = 0
  for (const target of targets) {
    let plan: PlannedBefore | null
    try {
      plan = await planBefore(folderPath, target.path)
    } catch (error) {
      throw prepareFailed(target.path, error)
    }
    if (plan === null) return unavailableRecorder('unsupported-type')
    if (plan.kind === 'file') totalBytes += plan.size
    planned.push(plan)
  }
  if (totalBytes > options.maxBytes) return unavailableRecorder('too-large')
  let dir: string
  try {
    dir = await mkdtemp(join(options.tempRoot, AGENT_CHANGES_UNDO_TEMP_PREFIX))
  } catch (error) {
    throw prepareFailed(targets[0]?.path ?? '', error)
  }
  const befores = new Map<string, AgentChangesUndoBefore>()
  for (const [index, plan] of planned.entries()) {
    try {
      befores.set(plan.path, await saveBefore(folderPath, dir, index, plan))
    } catch (error) {
      await removeDir(dir)
      throw prepareFailed(plan.path, error)
    }
  }
  return capturingRecorder(folderPath, dir, befores)
}

/** 取り消しの動作を before・after の肯定の根拠で決める(L-006) */
export function undoActionOf(
  item: Pick<AgentChangesUndoItem, 'before' | 'after'>
): AgentChangesUndoAction {
  if (item.before.kind === 'absent') return 'trash'
  if (item.after.kind === 'absent') return 'recreate'
  return 'rewrite'
}

/** renderer に渡す要約(控えの一時ディレクトリ・指紋は渡さない) */
export function summarizeAgentChangesUndo(
  undo: AgentChangesUndo | null
): AgentChangesUndoSummary | null {
  if (undo === null) return null
  return {
    undoId: undo.undoId,
    operation: undo.operation,
    entries: undo.items.map((item) => ({ path: item.path, action: undoActionOf(item) }))
  }
}

/** 戻す操作の結果に入れる控えの成否 */
export function toAgentRevertUndoOutcome(capture: AgentChangesUndoCapture): AgentRevertUndoOutcome {
  return capture.kind === 'saved'
    ? { kind: 'saved' }
    : { kind: 'unavailable', reason: capture.reason }
}

type ItemCheck = { kind: 'match' } | { kind: 'mismatch' } | { kind: 'unreadable'; reason: string }
const MATCH: ItemCheck = { kind: 'match' }
const MISMATCH: ItemCheck = { kind: 'mismatch' }

// 親のフォルダの各段(許可のフォルダの直下から親まで)が本物のディレクトリか(リンク・無いは不一致)
async function checkParents(folderPath: string, path: string): Promise<ItemCheck> {
  const segments = path.split('/')
  for (let depth = 1; depth < segments.length; depth++) {
    try {
      const stat = await lstat(join(folderPath, ...segments.slice(0, depth)))
      if (!stat.isDirectory()) return MISMATCH
    } catch (error) {
      const code = errorCode(error)
      if (code === 'ENOENT' || code === 'ENOTDIR') return MISMATCH
      return { kind: 'unreadable', reason: messageOf(error) }
    }
  }
  return MATCH
}

// 今の状態が戻した直後の指紋と完全に一致するか(L-036。時刻ではなく中身で比べる。L-422)
async function checkItem(folderPath: string, item: AgentChangesUndoItem): Promise<ItemCheck> {
  const parents = await checkParents(folderPath, item.path)
  if (parents.kind !== 'match') return parents
  const absolutePath = join(folderPath, item.path)
  let stat: Stats
  try {
    stat = await lstat(absolutePath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return item.after.kind === 'absent' ? MATCH : MISMATCH
    return { kind: 'unreadable', reason: messageOf(error) }
  }
  const after = item.after
  try {
    switch (after.kind) {
      case 'absent':
        // 戻した直後に無かったパスに何かが現れた(ディレクトリを含む。L-011)
        return MISMATCH
      case 'symlink':
        return stat.isSymbolicLink() && (await readlink(absolutePath)) === after.target
          ? MATCH
          : MISMATCH
      case 'file':
        // 大きさ・権限・種類を先に比べ、違えば読まない
        if (!stat.isFile() || stat.size !== after.size || (stat.mode & 0o777) !== after.mode) {
          return MISMATCH
        }
        return (await hashFileSha256(absolutePath)) === after.sha256 ? MATCH : MISMATCH
    }
  } catch (error) {
    return { kind: 'unreadable', reason: messageOf(error) }
  }
}

const writeTempName = (absolutePath: string): string =>
  join(dirname(absolutePath), `${AGENT_UNDO_WRITE_TEMP_PREFIX}${randomBytes(8).toString('hex')}`)

// 書き戻す: 同じフォルダの一時の名前に書いて権限を before.mode にしてから rename で置き換える(L-014)
async function rewrite(
  absolutePath: string,
  before: Exclude<AgentChangesUndoBefore, { kind: 'absent' }>,
  undoDir: string
): Promise<void> {
  const temp = writeTempName(absolutePath)
  if (before.kind === 'file') {
    await writeFileExclusive(temp, await readFile(join(undoDir, before.savedName)), before.mode)
  } else {
    await symlink(before.target, temp)
  }
  try {
    await rename(temp, absolutePath)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

// ハードリンクを作れないファイルシステムの link の失敗
const LINK_UNSUPPORTED_CODES = new Set(['EPERM', 'ENOTSUP', 'EXDEV'])

// 作り直す: 一時の名前に書いて権限を before.mode にしてから link で目的の名前を作る(既にあれば EEXIST で止まる。L-011)。
// link を作れないファイルシステムでは、目的の名前に wx で直接書く(既にあれば EEXIST)
async function recreate(
  absolutePath: string,
  before: Exclude<AgentChangesUndoBefore, { kind: 'absent' }>,
  undoDir: string,
  linkFile: AgentChangesUndoFs['link']
): Promise<void> {
  if (before.kind === 'symlink') {
    await symlink(before.target, absolutePath)
    return
  }
  const data = await readFile(join(undoDir, before.savedName))
  const temp = writeTempName(absolutePath)
  await writeFileExclusive(temp, data, before.mode)
  try {
    await linkFile(temp, absolutePath)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    if (!LINK_UNSUPPORTED_CODES.has(errorCode(error) ?? '')) throw error
    await writeFileExclusive(absolutePath, data, before.mode)
    return
  }
  await unlink(temp).catch(() => undefined)
}

export interface AgentChangesUndoFs {
  link: (existingPath: string, newPath: string) => Promise<void>
}

export interface AgentChangesUndoContext {
  folderPath: string
  undo: AgentChangesUndo
  /** OS のゴミ箱へ移す(戻すときに作り直したファイルを消すとき。完全な削除をしない) */
  trash: (absolutePath: string) => Promise<void>
  fs?: Partial<AgentChangesUndoFs>
}

export type AgentChangesUndoExecution =
  | { kind: 'rejected'; message: string; keepUndo: boolean }
  | { kind: 'failed'; message: string }
  | { kind: 'done'; restoredPaths: string[]; trashedPaths: string[] }
  | { kind: 'partial'; message: string; restoredPaths: string[]; trashedPaths: string[] }

/**
 * 控えで取り消す(設計書「取り消しの流れ」3・4)。全件を照合してから判定し、不一致が 1 件でもあれば何も書かずに拒否して控えを捨てる。
 * 不一致が無く読み込みの失敗だけなら、何も書かずに拒否して控えを残す。書き換えはパスの昇順で、各項目の直前にもう一度照合し、
 * 合わない・読み込めない・書き換えの失敗でそこで止める(1 件以上済んでいれば partial、0 件なら failed)。控えの扱いは呼び出し側
 * (registry)が結果で決める
 */
export async function undoLastAgentRevert(
  context: AgentChangesUndoContext
): Promise<AgentChangesUndoExecution> {
  const { folderPath, undo, trash } = context
  const linkFile = context.fs?.link ?? fsLink
  const mismatched: string[] = []
  const unreadable: { path: string; reason: string }[] = []
  for (const item of undo.items) {
    const check = await checkItem(folderPath, item)
    if (check.kind === 'mismatch') mismatched.push(item.path)
    else if (check.kind === 'unreadable') unreadable.push({ path: item.path, reason: check.reason })
  }
  if (mismatched.length > 0) {
    return {
      kind: 'rejected',
      keepUndo: false,
      message: `${AGENT_UNDO_CHANGED_MESSAGE}（${listPathsForMessage(mismatched)}）`
    }
  }
  if (unreadable.length > 0) {
    return {
      kind: 'rejected',
      keepUndo: true,
      message: `取り消しの対象を読み込めませんでした（${listPathsForMessage(unreadable.map((u) => u.path))}）: ${unreadable[0].reason}`
    }
  }
  const restoredPaths: string[] = []
  const trashedPaths: string[] = []
  const total = undo.items.length
  for (const item of undo.items) {
    const done = restoredPaths.length + trashedPaths.length
    const stop = (detail: string, zeroMessage: string): AgentChangesUndoExecution =>
      done > 0
        ? {
            kind: 'partial',
            message: `取り消しが途中で失敗しました（${done} / ${total} 件を取り消し済み）: ${detail}`,
            restoredPaths,
            trashedPaths
          }
        : { kind: 'failed', message: zeroMessage }
    const check = await checkItem(folderPath, item)
    if (check.kind === 'mismatch') {
      return stop(`${item.path} が戻した後に変わりました`, `${AGENT_UNDO_CHANGED_MESSAGE}（${item.path}）`)
    }
    if (check.kind === 'unreadable') {
      return stop(
        `${item.path} を読み込めませんでした: ${check.reason}`,
        `取り消しに失敗しました: ${item.path} を読み込めませんでした: ${check.reason}`
      )
    }
    const absolutePath = join(folderPath, item.path)
    try {
      if (item.before.kind === 'absent') {
        try {
          await trash(absolutePath)
        } catch {
          throw new Error('ゴミ箱へ移動できませんでした')
        }
        trashedPaths.push(item.path)
      } else if (item.after.kind === 'absent') {
        await recreate(absolutePath, item.before, undo.dir, linkFile)
        restoredPaths.push(item.path)
      } else {
        await rewrite(absolutePath, item.before, undo.dir)
        restoredPaths.push(item.path)
      }
    } catch (error) {
      const reason = messageOf(error)
      return stop(`${item.path}: ${reason}`, `取り消しに失敗しました: ${item.path}: ${reason}`)
    }
  }
  return { kind: 'done', restoredPaths, trashedPaths }
}
```

- [ ] **Step 6: テストを通す**

Run: `npx vitest run src/main/__tests__/agentChangesUndo.test.ts src/main/__tests__/agentChangesUndo.mocked.test.ts src/main/__tests__/openFileWatcher.integration.test.ts`
Expected: PASS

変異の確認: `undoLastAgentRevert` の全件の照合のループ（`mismatched`・`unreadable` を集める部分）をコメントにするとケース 18 が落ち、`checkParents` の呼び出しを外すと「親がリンクに置き換わった」が落ちることを確かめてから戻す。

- [ ] **Step 7: 型・lint**

Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/shared/types/agentChanges.ts src/main/agentChangesUndo.ts src/main/__tests__/agentChangesUndo.test.ts src/main/__tests__/agentChangesUndo.mocked.test.ts src/main/__tests__/openFileWatcher.integration.test.ts && npx eslint --max-warnings 0 src/shared/types/agentChanges.ts src/main/agentChangesUndo.ts src/main/__tests__/agentChangesUndo.test.ts src/main/__tests__/agentChangesUndo.mocked.test.ts src/main/__tests__/openFileWatcher.integration.test.ts`
Expected: エラー・警告なし

---

### Task 4: 戻す操作への組み込みと取り消しの実行（未確認事項 4 の実測を含む）

**Files:**
- Modify: `src/main/agentChangesRevert.ts`（import、`AgentRevertContext` L32-37 に `undo`、`AgentRevertOutcome` の型、`revertAgentChange` L136-146・`revertAgentChangeHunk` L149-181・`revertAllAgentChanges` L187-214）
- Modify: `src/main/agentChangesRecord.ts`（`AgentChangesRecord` に `undo`、`createAgentChangesRecord` の既定に `undo: null`、`agentChangesRecordTempDirs` L142-150 に控えの一時ディレクトリ）
- Modify: `src/main/agentBaselineRegistry.ts`（`AgentBaselineRegistryDeps` に `trash`、フィールドに `nextUndoIds`、`commitRevertUndo`・`undoLastRevert`・`removeUndoDir`）
- Modify: `src/main/ipcHandlers.ts`（registry の依存に `trash: moveToTrash`、handler の依存に `undoCapture`。import に `tmpdir`・`AGENT_CHANGES_UNDO_MAX_BYTES`）
- Modify: `src/main/handlers/agentChangesHandlers.ts`（`AgentChangesHandlerDeps` に `undoCapture`、戻す 3 か所の文脈に `undo: undoCapture`。戻り値の型は Task 5 で変える）
- Modify: `src/main/__tests__/helpers/agentBaselineFixtures.ts`（`makeAgentChangesRecord` の既定に `undo: null`）
- Test: `src/main/__tests__/helpers/agentBaselineFixtures.test.ts`・`src/main/__tests__/agentChangesRecord.test.ts`（期待値に `undo: null`、`agentChangesRecordTempDirs` に控え）
- Test: `src/main/__tests__/agentChangesRevert.integration.test.ts`・`src/main/__tests__/agentChangesRevert.toctou.integration.test.ts`（`record()` の文脈に `undo: { tempRoot, maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES }`、戻り値の確認を足す）
- Test: `src/main/__tests__/agentChangesUndo.integration.test.ts`（新規。**実 git**。戻す → 取り消すの往復）
- Test: `src/main/__tests__/agentBaselineRegistry.test.ts`（`setup` の依存に `trash`、新しい describe）
- Test: `src/main/__tests__/handlers/agentChangesHandlers.test.ts`・`agentChangesHandlers.integration.test.ts`・`src/main/__tests__/ipcHandlers.test.ts`（registry の依存に `trash`。handler の戻す系の呼び出しの期待値は Task 5 で直す）
- 一時ファイル（計測の後に消す）: `src/main/__tests__/agentChangesUndo.timing.local.test.ts`

**Interfaces:**
- Consumes: Task 3 の `startAgentChangesUndoRecorder`・`AgentChangesUndoCaptureOptions`・`AgentChangesUndoCapture`・`AgentChangesUndo`・`undoLastAgentRevert`・`summarizeAgentChangesUndo`・`AGENT_UNDO_STALE_MESSAGE`・`AGENT_CHANGES_UNDO_MAX_BYTES`、共有の型 `AgentChangesUndoOperation`・`AgentChangesUndoSummary`・`AgentChangesUndoResult`
- Produces:
```ts
// src/main/agentChangesRevert.ts
export interface AgentRevertContext {
  snapshot: BaselineSnapshot
  trash: (absolutePath: string) => Promise<void>
  gitOptions?: BaselineGitOptions
  /** 取り消しの控えの置き場所と上限(控えは毎回取る) */
  undo: AgentChangesUndoCaptureOptions
}
export interface AgentRevertOutcome { applied: number; undo: AgentChangesUndoCapture }
export async function revertAgentChange(context: AgentRevertContext, filePath: string): Promise<AgentRevertOutcome>
export async function revertAgentChangeHunk(context: AgentRevertContext, filePath: string, patch: string): Promise<AgentRevertOutcome>
export async function revertAllAgentChanges(context: AgentRevertContext, expected: AgentRevertAllEntry[]): Promise<DiscardAllResult & AgentRevertOutcome>
// src/main/agentChangesRecord.ts
export interface AgentChangesRecord { /* Task 2 のもの */ undo: AgentChangesUndo | null }
// src/main/agentBaselineRegistry.ts
export interface AgentRevertUndoCommit { operation: AgentChangesUndoOperation; capture: AgentChangesUndoCapture }
export interface AgentBaselineRegistryDeps { /* 既存 */ trash: (absolutePath: string) => Promise<void> }
class AgentBaselineRegistry {
  /** 戻す操作の結果の控えを記録へ移す(withRecord のタスクの中で、戻す関数が resolve したときだけ呼ぶ) */
  commitRevertUndo(ownerId: number, record: AgentChangesRecord, commit: AgentRevertUndoCommit): Promise<AgentChangesUndoSummary | null>
  /** 直前の戻す操作を取り消す。記録が無ければ null */
  undoLastRevert(ownerId: number, folderPath: string, undoId: number): Promise<AgentChangesUndoResult | null>
}
```

- [ ] **Step 1: 記録の控えの失敗するテストを書く**

- `src/main/__tests__/helpers/agentBaselineFixtures.test.ts` の 2 つの `toEqual` と、Task 2 の `createAgentChangesRecord` のテストの `toEqual` に `undo: null` を足す
- `src/main/__tests__/agentChangesRecord.test.ts` の `agentChangesRecordTempDirs` の describe に足す:
```ts
  it('取り消しの控えの一時ディレクトリも返す(記録を捨てるときに消す)', () => {
    const record = makeAgentChangesRecord([], {
      baseline,
      undo: { undoId: 1, operation: 'file', dir: '/tmp/undo', items: [] }
    })
    expect(agentChangesRecordTempDirs(record)).toEqual([baseline.tempDir, '/tmp/undo'])
  })
```
Run: `npx vitest run src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentChangesRecord.test.ts`
Expected: FAIL

- [ ] **Step 2: 記録の控えを実装する**

`src/main/agentChangesRecord.ts`:
- import に `import type { AgentChangesUndo } from './agentChangesUndo'`
- `AgentChangesRecord` の `protection` の後に:
```ts
  /** 直前の戻す操作の取り消しの控え(0 か 1 つ。registry の commitRevertUndo・undoLastRevert だけが書き換える) */
  undo: AgentChangesUndo | null
```
- `createAgentChangesRecord` の戻り値に `undo: null` を足す
- `agentChangesRecordTempDirs` を次にする:
```ts
/** 記録を捨てるときに消す一時ディレクトリ(累積の始点・実行が持つもの・取り消しの控え) */
export function agentChangesRecordTempDirs(record: AgentChangesRecord): string[] {
  return [
    record.baseline.tempDir,
    ...record.runs.flatMap((run) => {
      const dir = runOwnedTempDir(run)
      return dir === null ? [] : [dir]
    }),
    ...(record.undo === null ? [] : [record.undo.dir])
  ]
}
```
`src/main/__tests__/helpers/agentBaselineFixtures.ts` の `makeAgentChangesRecord` に `undo: overrides.undo ?? null` を足す。

Run: `npx vitest run src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentChangesRecord.test.ts`
Expected: PASS

- [ ] **Step 3: 戻す → 取り消すの実 git の失敗するテストを書く**

`src/main/__tests__/agentChangesUndo.integration.test.ts`（準備は `agentChangesRevert.integration.test.ts` と同じ: `createAgentBaselineRepo('agent-changes-undo-')`・`createFakeTrash()`・`disposeAgentBaselineRepo`。`record = async (maxBytes = AGENT_CHANGES_UNDO_MAX_BYTES): Promise<AgentRevertContext> => ({ snapshot: await recordBaseline(repo, tempRoot), trash, undo: { tempRoot, maxBytes } })`。往復の補助関数:
```ts
// 戻した結果の控えで取り消す(registry を通さず、関数どうしをつなぐ)
async function undoFrom(outcome: AgentRevertOutcome, operation: AgentChangesUndoOperation = 'file'): Promise<AgentChangesUndoExecution> {
  if (outcome.undo.kind !== 'saved') throw new Error(`控えが取れなかった: ${JSON.stringify(outcome.undo)}`)
  return undoLastAgentRevert({
    folderPath: repo,
    undo: { undoId: 1, operation, dir: outcome.undo.dir, items: outcome.undo.items },
    trash
  })
}
const bytes = (path: string): Buffer => readFileSync(join(repo, path))
const modeOf = (path: string): number => statSync(join(repo, path)).mode & 0o777
```
`lines(n, overrides)` と `firstHunk(diff)` は `agentChangesRevert.integration.test.ts` の同名の補助関数と同じものをこのファイルにも置く）。次のケースを書く:
1. **変更（M）**: `a.txt`（`a\n`）をコミット → `write('a.txt', 'a\nuser\n')` → `record()` → `write('a.txt', 'a\nuser\nagent\n')` と `chmodSync(join(repo, 'a.txt'), 0o755)` → `revertAgentChange(context, 'a.txt')` が `{ applied: 1, undo: { kind: 'saved', ... } }`（`undo.items[0].before.kind` が `file`）→ `undoFrom(outcome)` が `{ kind: 'done', restoredPaths: ['a.txt'], trashedPaths: [] }`、`bytes('a.txt')` が `a\nuser\nagent\n`、`modeOf('a.txt')` が `0o755`
2. **削除（D）**: `c.txt` をコミット → `record()` → `unlinkSync` → 戻すと `c.txt` が戻る → 取り消すと `trashed` に `join(repo, 'c.txt')` が入り `c.txt` が無い（`trashedPaths: ['c.txt']`）
3. **追加（A）のファイル**: `record()` → `write('new.txt', 'n\n')`・`chmodSync(..., 0o755)` → 戻すとゴミ箱へ → 取り消すと `new.txt` が `n\n`・`0o755` で戻る（`restoredPaths: ['new.txt']`。OS のゴミ箱の偽物の `trashed` には戻す操作の 1 件だけ）
4. **種類の変更（T）**: `l.txt`（ファイル）をコミット → `record()` → `unlinkSync` して `symlinkSync('target', join(repo, 'l.txt'))` → 戻すとファイルに → 取り消すと `readlinkSync(join(repo, 'l.txt'))` が `target`
5. **ハンク**: `d.txt` に `lines(20)` をコミット → `record()` → `lines(20, { 2: 'A2', 18: 'A18' })` → `revertAgentChangeHunk(context, 'd.txt', firstHunk(diff))` → 取り消すと `lines(20, { 2: 'A2', 18: 'A18' })` に戻る
6. **すべて**: 1〜3 の変更を同時に作り（`a.txt` 変更・`c.txt` 削除・`new.txt` 追加）、`revertAllAgentChanges(context, [{ path: 'a.txt', status: 'M' }, { path: 'c.txt', status: 'D' }, { path: 'new.txt', status: 'A' }])` が `{ status: 'done', applied: 3, undo: { kind: 'saved' } }`（`undo.items` のパスが `['a.txt', 'c.txt', 'new.txt']`）→ `undoFrom(outcome, 'all')` で 3 つとも戻す前の状態（`a.txt` の中身、`c.txt` 無し、`new.txt` の中身）
7. **すべて の partial**: `a.txt` の変更と `zz/m.txt` の変更（`zz` を `chmodSync(..., 0o555)` にして restore が失敗する。`isRoot` なら飛ばす）→ `{ status: 'partial', applied: 1 }` で `undo.items` のパスが `['a.txt']`（適用した項目だけ）。`afterEach` の前に `zz` を `0o755` に戻す
8. **改行の変換**: `runGit(repo, 'config', 'core.autocrlf', 'true')`・`.gitattributes` に `* text=auto` を書いてコミット、`crlf.txt` に `a\r\nb\r\n` を書いてコミット → `record()` → `write('crlf.txt', 'a\r\nb\r\nc\r\n')` → 戻す（バイト列は問わない）→ 取り消すと `bytes('crlf.txt')` が `Buffer.from('a\r\nb\r\nc\r\n')` と等しい
9. **戻した後に変えると拒否する**: 1 の流れで戻した後に `write('a.txt', 'a\nuser\nlater\n')` → `undoFrom(outcome)` が `{ kind: 'rejected', keepUndo: false, message: '戻した後に変わったファイルがあるため、取り消せません（a.txt）' }`、`bytes('a.txt')` が `a\nuser\nlater\n`（変異: Task 3 の全件の照合を外すとこのテストが落ちる〈パターン 130〉）
10. **利用者の状態を変えない**: 1 の流れで、取り消しの前後の `userRepoState(repo)` が等しい
11. **上限・フォルダ・種類**: `record(10)` で、11 バイトの追加のファイルを戻すと `{ applied: 1, undo: { kind: 'unavailable', reason: 'too-large' } }`（ファイルはゴミ箱へ移る。`tempRoot` に `prompt-ide-agent-undo-` の名前が無い）。追加されたフォルダ（`nd/a.txt` を書いて `revertAgentChange(context, 'nd')`）は `reason: 'directory'`
12. **例外のときに控えを残さない**: 一覧に無いパスの `revertAgentChange` は `AGENT_CHANGES_STALE_MESSAGE` で reject し、`tempRoot` に `prompt-ide-agent-undo-` の名前が無い。ハンクのパッチの検査で拒否される（`verifyHunkPatch` が拒否するパッチ〈別のファイルのパッチ〉）ときも控えを作らない。`discardHunkPatch` が失敗する（diff を取った後に文脈を変える）と `AGENT_REVERT_HUNK_FAILED_MESSAGE` で reject し、控えのディレクトリが残らない

`agentChangesRevert.integration.test.ts`・`agentChangesRevert.toctou.integration.test.ts` の `record()` の戻り値に `undo: { tempRoot, maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES }` を足す（import に `AGENT_CHANGES_UNDO_MAX_BYTES`）。戻り値に `applied`・`undo` が加わるため、`revertAllAgentChanges` の結果を `toEqual` で比べている既存の 4 か所を新しい形に直す（`grep -n "resolves.toEqual" src/main/__tests__/agentChangesRevert*.ts` で拾った、計画の時点の全件。`revertAgentChange`・`revertAgentChangeHunk` の結果を比べているものは無い）:
- `agentChangesRevert.integration.test.ts` L389-391（3 件をすべて戻す）: `resolves.toEqual({ status: 'done' })` → `resolves.toMatchObject({ status: 'done', applied: 3, undo: expect.objectContaining({ kind: 'saved' }) })`
- 同 L428-432（2 / 3 件で partial）: `resolves.toEqual({ status: 'partial', message: ... })` → `resolves.toMatchObject({ status: 'partial', message: <今の文言のまま>, applied: 2, undo: expect.objectContaining({ kind: 'saved' }) })`
- 同 L460・L756（`entries` をすべて戻す）: `resolves.toEqual({ status: 'done' })` → `resolves.toMatchObject({ status: 'done', applied: entries.length })`（控えの成否はそのテストの対象のファイルの種類で変わるため比べない）

Run: `npx vitest run src/main/__tests__/agentChangesUndo.integration.test.ts`
Expected: FAIL（戻す関数が控えを返さない）

- [ ] **Step 4: 戻す関数に控えを組み込む**

`src/main/agentChangesRevert.ts`:
- import に足す:
```ts
import type {
  AgentChangesUndoCapture,
  AgentChangesUndoCaptureOptions
} from './agentChangesUndo'
import { startAgentChangesUndoRecorder } from './agentChangesUndo'
```
- ファイルの冒頭のコメントの最後に足す: `// 戻す 3 関数は、検査の後・作業ツリーを変える前に取り消しの控えを取り(取れなければ中止。L-003)、1 件を適用するたびに戻した後の指紋を控える(agentChangesUndo.ts)`
- `AgentRevertContext` に `undo` を足し、その後に `AgentRevertOutcome` を足す:
```ts
export interface AgentRevertContext {
  snapshot: BaselineSnapshot
  /** OS のゴミ箱へ移す(trash.ts の moveToTrash)。テストで偽物を注入する */
  trash: (absolutePath: string) => Promise<void>
  gitOptions?: BaselineGitOptions
  /** 取り消しの控えの置き場所と上限(控えは毎回取る) */
  undo: AgentChangesUndoCaptureOptions
}

/** 戻す操作の結果。applied は作業ツリーに適用した件数、undo は取り消しの控え(取れなかったら理由) */
export interface AgentRevertOutcome {
  applied: number
  undo: AgentChangesUndoCapture
}
```
- `revertAgentChange` を置き換える:
```ts
/** ファイル単位で戻す。変更・削除・種類の変更は記録の時点の内容へ、追加(ファイル・フォルダ)はゴミ箱へ */
export async function revertAgentChange(
  context: AgentRevertContext,
  filePath: string
): Promise<AgentRevertOutcome> {
  const entry = await findCurrentEntry(context, filePath)
  const gits = gitsFor(context)
  const assessment = await assess(gits, entry)
  if (!assessment.ok) throw new Error(assessment.reason)
  const { folderPath } = context.snapshot
  const recorder = await startAgentChangesUndoRecorder(
    folderPath,
    [{ path: assessment.path, isDirectory: entry.isDirectory }],
    context.undo
  )
  try {
    await applyDiscard(gits.baseline, folderPath, assessment.kind, assessment.path, context.trash)
  } catch (error) {
    await recorder.discard()
    throw error
  }
  await recorder.recordAfter(assessment.path)
  return { applied: 1, undo: await recorder.finish() }
}
```
- `revertAgentChangeHunk` の戻り値の型を `Promise<AgentRevertOutcome>` にし、L175-180 を置き換える:
```ts
  const { folderPath } = context.snapshot
  const contentPatch = await verifyHunkPatch(folderPath, filePath, patch)
  // パッチの検査を通った後に控えを取る(検査で拒否したら控えを作らない)
  const recorder = await startAgentChangesUndoRecorder(
    folderPath,
    [{ path: filePath, isDirectory: false }],
    context.undo
  )
  try {
    await discardHunkPatch(folderPath, filePath, contentPatch)
  } catch (error) {
    await recorder.discard()
    throw new Error(AGENT_REVERT_HUNK_FAILED_MESSAGE, { cause: error })
  }
  await recorder.recordAfter(filePath)
  return { applied: 1, undo: await recorder.finish() }
```
- `revertAllAgentChanges` の戻り値の型を `Promise<DiscardAllResult & AgentRevertOutcome>` にし、`targets` の型を `{ path: string; kind: RevertKind; isDirectory: boolean }[]`、ループの `if (assessment.ok) targets.push(assessment)` を `if (assessment.ok) targets.push({ path: assessment.path, kind: assessment.kind, isDirectory: entry.isDirectory })` にして、L207-213 の `return applyInOrder(...)` を置き換える:
```ts
  const { folderPath } = context.snapshot
  const recorder = await startAgentChangesUndoRecorder(
    folderPath,
    targets.map(({ path, isDirectory }) => ({ path, isDirectory })),
    context.undo
  )
  let applied = 0
  let result: DiscardAllResult
  try {
    result = await applyInOrder(
      targets,
      async ({ path, kind }) => {
        await applyDiscard(gits.baseline, folderPath, kind, path, context.trash)
        applied += 1
        // partial では適用した項目だけを控える(recordAfter は投げない)
        await recorder.recordAfter(path)
      },
      (done, total, reason) =>
        `すべて戻すが途中で失敗しました（${done} / ${total} 件を戻し済み）: ${reason}`
    )
  } catch (error) {
    await recorder.discard()
    throw error
  }
  return { ...result, applied, undo: await recorder.finish() }
```

Run: `npx vitest run src/main/__tests__/agentChangesUndo.integration.test.ts src/main/__tests__/agentChangesRevert.integration.test.ts src/main/__tests__/agentChangesRevert.toctou.integration.test.ts`
Expected: PASS

- [ ] **Step 5: registry の控えの失敗するテストを書く**

`src/main/__tests__/agentBaselineRegistry.test.ts`:
- `setup()` の依存に `trash`（`const trash = vi.fn<AgentBaselineRegistryDeps['trash']>(async (path) => rmSync(path, { force: true }))`）を足し、戻り値にも `trash` を足す
- 新しい describe `'AgentBaselineRegistry の取り消しの控え'` を足す。記録のフォルダは実ファイルの一時ディレクトリ（`beforeEach` で `folder = realpathSync(mkdtempSync(join(tmpdir(), 'agent-registry-undo-')))`・`tempRoot` を作り、`afterEach` で消す）にし、`recordFor(s, 1, folder, '/tmp/a')` で記録を作る。控えは実物で取る補助関数:
```ts
// folder の path を before → after に書き換える戻す操作を再現して控えを取る
async function captureOf(path: string, before: string | null, after: string | null): Promise<AgentChangesUndoCapture> {
  if (before === null) rmSync(join(folder, path), { force: true })
  else writeFileSync(join(folder, path), before)
  const recorder = await startAgentChangesUndoRecorder(folder, [{ path, isDirectory: false }], {
    tempRoot,
    maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES
  })
  if (after === null) rmSync(join(folder, path), { force: true })
  else writeFileSync(join(folder, path), after)
  await recorder.recordAfter(path)
  return recorder.finish()
}
// 列の中で commitRevertUndo を呼ぶ(handler と同じ)
const commit = (s: ReturnType<typeof setup>, capture: AgentChangesUndoCapture, operation: AgentChangesUndoOperation = 'file'): Promise<AgentChangesUndoSummary | null | undefined> =>
  s.registry.withRecord(1, folder, (record) => s.registry.commitRevertUndo(1, record, { operation, capture })).then((r) => r ?? undefined)
const undoOfRecord = (s: ReturnType<typeof setup>): Promise<unknown> =>
  s.registry.withRecord(1, folder, async (record) => record.undo)
```
次のケースを書く:
1. 取れた控えは `undoId` 1 の要約を返し、記録に持つ（`commit(s, await captureOf('a.txt', 'agent', 'base'))` が `{ undoId: 1, operation: 'file', entries: [{ path: 'a.txt', action: 'rewrite' }] }`）
2. 次の取れた控えは `undoId` 2 になり、前の控えの一時ディレクトリを消す（`s.removeDir` が 1 つ目の `dir` で呼ばれる）
3. 取れなかった控え（`{ kind: 'unavailable', reason: 'too-large' }`）は `null` を返し、記録の控えを null にして前の一時ディレクトリを消す
4. `undoId` は `clear` の後の新しい記録でも重ならない（1 → `clear` → 記録 → 2。L-037）
5. 戻す操作の途中に `clear` された（`withRecord` の中で `void s.registry.clear(1)` してから `commitRevertUndo`）→ `null` を返し、新しい控えの `dir` を `removeDir` で消し、記録に付けない
6. `close` の後の `commitRevertUndo`（`withRecord` の中で `s.registry.close()` してから呼ぶ）→ `null` を返し、新しい控えの `dir` を `removeDirSync` で消す
7. `clear` は控えの一時ディレクトリも消す・`close` は同期で消す（`s.removeDir`・`s.removeDirSync` が控えの `dir` で呼ばれる）
8. `undoLastRevert` の成功: 1 の控えで `s.registry.undoLastRevert(1, folder, 1)` が `{ status: 'done', restoredPaths: ['a.txt'], trashedPaths: [], undoSummary: null }`、`a.txt` が `agent`、`undoOfRecord(s)` が `null`、控えの `dir` を `removeDir` で消す
9. 同じ `undoId` の 2 回目は `取り消せる操作が変わりました。一覧を更新してください` で reject（L-101）
10. `undoId` が違う → 同じ文言で reject し、控えは残る（`undoOfRecord(s)` の `undoId` が 1 のまま）
11. 照合の不一致（取り消しの前に `a.txt` を `later` にする）→ `戻した後に変わったファイルがあるため、取り消せません（a.txt）` で reject し、控えを捨てる（`undoOfRecord(s)` が `null`）
12. 読み込みの失敗だけ（`sub/a.txt` の控えの後に `sub` を `0o600`。`isRoot` なら飛ばす。`afterEach` で戻す）→ `取り消しの対象を読み込めませんでした（sub/a.txt）: ` で始まる文言で reject し、控えは残る
13. ゴミ箱へ移す項目（`captureOf('d.txt', null, 'base')`）は依存の `trash` で移す（`s.trash` が `join(folder, 'd.txt')` で呼ばれ、結果の `trashedPaths` が `['d.txt']`）
14. 記録が無い（別のフォルダ）なら `null`

Run: `npx vitest run src/main/__tests__/agentBaselineRegistry.test.ts`
Expected: FAIL（`commitRevertUndo is not a function`）

- [ ] **Step 6: registry に控えの置き換えと取り消しを実装する**

`src/main/agentBaselineRegistry.ts`:
- import に足す:
```ts
import type {
  AgentChangesUndoOperation,
  AgentChangesUndoResult,
  AgentChangesUndoSummary
} from '@shared/types'
import type { AgentChangesUndoCapture } from './agentChangesUndo'
import {
  AGENT_UNDO_STALE_MESSAGE,
  summarizeAgentChangesUndo,
  undoLastAgentRevert
} from './agentChangesUndo'
```
- `AgentBaselineRegistryDeps` に足す:
```ts
  /** OS のゴミ箱へ移す(取り消しで、戻すときに作り直したファイルを消す。handler の trash と同じ moveToTrash) */
  trash: (absolutePath: string) => Promise<void>
```
- `AgentBaselineRegistryDeps` の後に足す:
```ts
/** 戻す操作の結果の控え(handler が commitRevertUndo に渡す) */
export interface AgentRevertUndoCommit {
  operation: AgentChangesUndoOperation
  capture: AgentChangesUndoCapture
}
```
- フィールドに足す: `// 所有者ごとの次の undoId。記録を捨てても戻さない(L-037)` + `private readonly nextUndoIds = new Map<number, number>()`
- `close` の上に public メソッドを 2 つ足す:
```ts
  /**
   * 戻す操作(1 件以上を適用した)の控えを記録へ移す(設計書「戻す操作の流れの変更」)。withRecord のタスクの中で呼ぶ。
   * registry が終了中・記録が今の記録でない(戻す操作の途中に clear・begin の置き換え)なら、新しい控えを付けずに消して null。
   * 取れた控えは undoId を振って記録に持ち、その後に前の控えを消す。取れなかったなら控えを null にして前の控えを消す
   * (新しい操作が取り消せないのに、古い操作を「直前」として出し続けない)。前の控えを捨てるのは新しい結果が決まった後(L-003)
   */
  async commitRevertUndo(
    ownerId: number,
    record: AgentChangesRecord,
    { operation, capture }: AgentRevertUndoCommit
  ): Promise<AgentChangesUndoSummary | null> {
    if (this.closed || this.records.get(ownerId) !== record) {
      if (capture.kind === 'saved') await this.removeUndoDir(capture.dir)
      return null
    }
    const previous = record.undo
    if (capture.kind === 'saved') {
      const undoId = this.nextUndoIds.get(ownerId) ?? 1
      this.nextUndoIds.set(ownerId, undoId + 1)
      record.undo = { undoId, operation, dir: capture.dir, items: capture.items }
    } else {
      record.undo = null
    }
    if (previous !== null) await this.removeUndoDir(previous.dir)
    return summarizeAgentChangesUndo(record.undo)
  }

  /**
   * 直前の戻す操作を取り消す(設計書「取り消しの流れ」)。記録の列の中で、今の控えの undoId と照合する(違えば何も変えずに例外。
   * L-035)。何も書き換えずに読み込みの失敗だけで拒否したら控えを残し、それ以外(照合の不一致・書き換えを始めた)は控えを捨てる。
   * 記録が無ければ null
   */
  undoLastRevert(
    ownerId: number,
    folderPath: string,
    undoId: number
  ): Promise<AgentChangesUndoResult | null> {
    return this.withRecord(ownerId, folderPath, async (record) => {
      const undo = record.undo
      if (undo === null || undo.undoId !== undoId) throw new Error(AGENT_UNDO_STALE_MESSAGE)
      const execution = await undoLastAgentRevert({
        folderPath: record.baseline.folderPath,
        undo,
        trash: this.deps.trash
      })
      if (execution.kind === 'rejected' && execution.keepUndo) throw new Error(execution.message)
      if (record.undo === undo) record.undo = null
      await this.removeUndoDir(undo.dir)
      switch (execution.kind) {
        case 'rejected':
        case 'failed':
          throw new Error(execution.message)
        case 'done':
          return {
            status: 'done',
            restoredPaths: execution.restoredPaths,
            trashedPaths: execution.trashedPaths,
            undoSummary: null
          }
        case 'partial':
          return {
            status: 'partial',
            message: execution.message,
            restoredPaths: execution.restoredPaths,
            trashedPaths: execution.trashedPaths,
            undoSummary: null
          }
      }
    })
  }
```
- private に足す（`discardSnapshot` の後）:
```ts
  // 控えの一時ディレクトリを消す(アプリの終了中は待てないので同期で消す)
  private async removeUndoDir(dir: string): Promise<void> {
    if (this.closed) this.deps.removeDirSync(dir)
    else await this.deps.removeDir(dir).catch(() => undefined)
  }
```
- `registry` の依存を組み立てる 4 か所に `trash` を足す: `src/main/ipcHandlers.ts`（`trash: moveToTrash`）、`src/main/__tests__/handlers/agentChangesHandlers.test.ts`（既存の `trash`）、`src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`（`trash.trash`。`beforeEach` と Task 2 の `rebuildRegistry` の 2 か所）、`src/main/__tests__/agentBaselineRegistry.test.ts`（上の偽物）。`src/main/__tests__/ipcHandlers.test.ts` の L255 の it に「registry と handler に同じ `moveToTrash` を渡す」確認は足さない（registry の依存は非公開のため。handler へ渡すことは今のテストのまま）

Run: `npx vitest run src/main/__tests__/agentBaselineRegistry.test.ts`
Expected: PASS

- [ ] **Step 7: 実測（未確認事項 4）**

`src/main/__tests__/agentChangesUndo.timing.local.test.ts` を作る（計測の後に消す）。`createAgentBaselineRepo` の中で:
1. `record()` の後に `head -c` 相当で 120MB のファイル（`writeFileSync(join(repo, 'big.bin'), Buffer.alloc(120 * 1024 * 1024))`）を作り、`revertAgentChange(context, 'big.bin')` の時間と結果（`undo` が `{ kind: 'unavailable', reason: 'too-large' }`）を `console.log` する
2. 95MB の追跡済みのファイル（コミットしておく）を記録の後に書き換え、`revertAgentChange` の時間（控えの書き込みを含む）と結果（`saved`）を出す
Run: `npx vitest run src/main/__tests__/agentChangesUndo.timing.local.test.ts`
Expected: PASS。時間を控えてタスクの報告に書く（1 は 1 秒以内、2 は 5 秒以内を目安にし、超えたら止めて報告する）。控えたら `rm src/main/__tests__/agentChangesUndo.timing.local.test.ts` で消す

- [ ] **Step 8: テスト・型・lint**

Run: `npx vitest run src/main/__tests__/agentChangesUndo.integration.test.ts src/main/__tests__/agentChangesRevert.integration.test.ts src/main/__tests__/agentChangesRevert.toctou.integration.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/handlers src/main/__tests__/ipcHandlers.test.ts`
Expected: PASS（handler のテストの `revertAgentChange`・`revertAgentChangeHunk` の偽物は `undefined` を返すが、Task 4 の handler は戻り値を使わないため通る。`revertAllAgentChanges` の偽物は型が変わるため下で直す）
Run: `npm run typecheck`
Expected: PASS（handler は `revertAgentChange({ snapshot: record.baseline, trash }, ...)` のままだと `undo` が無いため型で落ちる。**この Task では handler の 3 か所の文脈に `undo: undoCapture` を足し、`AgentChangesHandlerDeps` に `undoCapture: AgentChangesUndoCaptureOptions` を、`ipcHandlers.ts` の `registerAgentChangesHandlers` の引数に `undoCapture: { tempRoot: tmpdir(), maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES }`〈import に `tmpdir`〈`node:os`〉と `AGENT_CHANGES_UNDO_MAX_BYTES`〉を、handler のテスト 2 つの `registerAgentChangesHandlers` の呼び出しに `undoCapture: { tempRoot: <テストの一時ディレクトリ>, maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES }` を足し、`agentChangesHandlers.test.ts` の L181・L185・L214 の `toHaveBeenCalledWith({ snapshot: snapshotFor(folder), trash }, ...)` を `{ snapshot: snapshotFor(folder), trash, undo: UNDO_CAPTURE }` にする**〈`UNDO_CAPTURE` はテストの上に置く定数〉。同じファイルの L210 の `vi.mocked(revertAllAgentChanges).mockResolvedValue({ status: 'done' })` は戻り値の型が変わって型で落ちるため、`mockResolvedValue({ status: 'done', applied: 1, undo: { kind: 'unavailable', reason: 'too-large' } })` にする（L213 の `resolves.toEqual({ status: 'done' })` は、Task 4 の handler が戻す関数の結果をそのまま返すため `resolves.toEqual({ status: 'done', applied: 1, undo: { kind: 'unavailable', reason: 'too-large' } })` にし、Task 5 で新しい形に直す）。`src/main/__tests__/ipcHandlers.test.ts` の L255 の it に `expect(deps.undoCapture).toEqual({ tempRoot: tmpdir(), maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES })` を足す。戻り値の型の変更は Task 5）
Run: このタスクの **Files** に挙げた `.ts`・`.tsx` のファイル（作成・変更・テスト）をすべて並べて `npx eslint --fix <ファイル…> && npx eslint --max-warnings 0 <ファイル…>`
Expected: エラー・警告なし。`ls src/main/__tests__/ | grep timing.local` が何も出さない

---

### Task 5: IPC・parser・preload・共有の型（`agentChanges:undoRevert`・戻り値・state と一覧の `undo`）

**Files:**
- Modify: `src/shared/types/agentChanges.ts`（`AgentChangesState` の `recording` L58 と `AgentChangesListResult` L112-126 に `undo`）
- Modify: `src/main/handlers/agentChangesPayloadParser.ts`（`parseAgentChangesUndoId`）
- Modify: `src/main/handlers/agentChangesHandlers.ts`（import、`AgentChangesHandlerDeps.registry` の `Pick` L33、`withRecordAtPath` L66-77 の task に `ownerId`、戻す 3 チャンネル L120-160、`agentChanges:undoRevert`）
- Modify: `src/main/agentBaselineRegistry.ts`（`recordingState` L199-205 に `undo`）
- Modify: `src/main/agentChangesScopedQuery.ts`（`listAgentChangesInScope` の `common` L20-24 に `undo`）
- Modify: `src/preload/api.ts`（L1-12 の import、L285-293）・`src/preload/index.d.ts`（L5-8 の import、L158-164）
- Modify: `src/renderer/src/lib/agentChangesApi.ts`（戻り値の型・`undoAgentChangesRevert`）
- Modify: `src/renderer/src/hooks/useAgentChangesRevert.ts`（`revertFile`・`revertHunk` の `execute` を `async () => { await ... }` に包む。挙動は変えない）
- Modify: `src/renderer/src/__tests__/makeAgentChangesState.ts`（state・一覧の結果に `undo`、`makeAgentChangesUndoSummary`・`makeAgentRevertResult`・`makeAgentRevertAllResult`・`makeAgentChangesUndoResult`）
- Modify: `src/renderer/src/__tests__/setup.ts`（L77-80 の戻り値と `undoAgentChangesRevert`）
- Test: `src/main/__tests__/handlers/agentChangesPayloadParser.test.ts`・`src/main/__tests__/handlers/agentChangesHandlers.test.ts`・`src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`（**実 git**）・`src/main/__tests__/agentBaselineRegistry.test.ts`・`src/main/__tests__/agentChangesScopedQuery.test.ts`・`src/preload/__tests__/api.test.ts`・`src/renderer/src/lib/__tests__/agentChangesApi.test.ts`・`src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts`・`src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`（偽物の戻り値）

**Interfaces:**
- Consumes: Task 4 の `AgentRevertOutcome`・`AgentRevertContext`・`registry.commitRevertUndo`・`registry.undoLastRevert`、Task 3 の `toAgentRevertUndoOutcome`・`summarizeAgentChangesUndo`・`AgentChangesUndoCaptureOptions`
- Produces:
```ts
// src/main/handlers/agentChangesPayloadParser.ts
export const AGENT_CHANGES_UNDO_ID_INVALID_MESSAGE = 'undoId は 1 以上の整数である必要があります'
export function parseAgentChangesUndoId(value: unknown): number
// src/preload/api.ts・index.d.ts・src/renderer/src/lib/agentChangesApi.ts
revertAgentChange(path: string, scope: AgentChangesScope): Promise<AgentRevertResult>
revertAgentChangeHunk(path: string, patch: string, scope: AgentChangesScope): Promise<AgentRevertResult>
revertAllAgentChanges(expected: AgentRevertAllEntry[], scope: AgentChangesScope): Promise<AgentRevertAllResult>
undoAgentChangesRevert(undoId: number): Promise<AgentChangesUndoResult>
// src/renderer/src/__tests__/makeAgentChangesState.ts
export function makeAgentChangesRecordingState(overrides?: { startedAt?: number; runs?: AgentChangesRun[]; undo?: AgentChangesUndoSummary | null }): Extract<AgentChangesState, { kind: 'recording' }>
export function makeAgentChangesUndoSummary(overrides?: Partial<AgentChangesUndoSummary>): AgentChangesUndoSummary // 既定 { undoId: 1, operation: 'file', entries: [{ path: 'a.txt', action: 'rewrite' }] }
export function makeAgentRevertResult(overrides?: Partial<AgentRevertResult>): AgentRevertResult // 既定 { undo: { kind: 'saved' }, undoSummary: makeAgentChangesUndoSummary() }
export function makeAgentRevertAllResult(overrides?: { status?: 'done' | 'partial'; message?: string; revertedCount?: number; undo?: AgentRevertUndoOutcome; undoSummary?: AgentChangesUndoSummary | null }): AgentRevertAllResult // 既定 { status: 'done', revertedCount: 1, undo: { kind: 'saved' }, undoSummary: makeAgentChangesUndoSummary({ operation: 'all' }) }。partial の message の既定は 'partial'
export function makeAgentChangesUndoResult(overrides?: Partial<Extract<AgentChangesUndoResult, { status: 'done' }>>): AgentChangesUndoResult // 既定 { status: 'done', restoredPaths: ['a.txt'], trashedPaths: [], undoSummary: null }
```

- [ ] **Step 1: parser の失敗するテストを書く**

`src/main/__tests__/handlers/agentChangesPayloadParser.test.ts` に足す:
```ts
describe('parseAgentChangesUndoId', () => {
  it('1 以上の安全な整数をそのまま返す', () => {
    expect(parseAgentChangesUndoId(1)).toBe(1)
    expect(parseAgentChangesUndoId(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
  })
  it.each([undefined, null, 0, -1, 1.5, '1', Number.NaN, 2 ** 53, Infinity])(
    '%s は例外(省略を既定に流さない。L-044)',
    (value) => {
      expect(() => parseAgentChangesUndoId(value)).toThrow('undoId は 1 以上の整数である必要があります')
    }
  )
})
```
Run: `npx vitest run src/main/__tests__/handlers/agentChangesPayloadParser.test.ts`
Expected: FAIL

- [ ] **Step 2: parser を実装する**

`src/main/handlers/agentChangesPayloadParser.ts` の末尾に足す:
```ts
export const AGENT_CHANGES_UNDO_ID_INVALID_MESSAGE = 'undoId は 1 以上の整数である必要があります'

/** 取り消しの ID(renderer から受け取るのはこれだけ。取り消すパス・控えは main が決める。L-019)。省略・未知の形は例外 */
export function parseAgentChangesUndoId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(AGENT_CHANGES_UNDO_ID_INVALID_MESSAGE)
  }
  return value
}
```
Run: `npx vitest run src/main/__tests__/handlers/agentChangesPayloadParser.test.ts`
Expected: PASS

- [ ] **Step 3: handler・registry・一覧の失敗するテストを書く**

`src/main/__tests__/handlers/agentChangesHandlers.test.ts`:
- `beforeEach` に `vi.mocked(revertAgentChange).mockResolvedValue({ applied: 1, undo: { kind: 'unavailable', reason: 'too-large' } })`・`vi.mocked(revertAgentChangeHunk).mockResolvedValue({ applied: 1, undo: { kind: 'unavailable', reason: 'too-large' } })`・`vi.mocked(revertAllAgentChanges).mockResolvedValue({ status: 'done', applied: 2, undo: { kind: 'unavailable', reason: 'directory' } })` を足す
- L208 の it（`revertAll は確認の一覧を検証して詰め直したものを渡し、結果を返す`）の L213 の期待値を新しい形 `resolves.toEqual({ status: 'done', revertedCount: 1, undo: { kind: 'unavailable', reason: 'too-large' }, undoSummary: null })` にする（L210 の偽物は Task 4 で直した `{ status: 'done', applied: 1, undo: { kind: 'unavailable', reason: 'too-large' } }` のまま。この it の中の上書きがあるため、`beforeEach` に足す偽物だけに頼らない）
- `'8 つのチャンネル'` の it を `'9 つのチャンネル'` にし、一覧に `'agentChanges:undoRevert'` を足す
- `toEqual({ kind: 'recording', ... })` の期待値（7 か所）に `undo: null` を足す
- 新しい describe `'戻す系の結果と取り消し'` を足す:
  1. `revertFile` は `{ undo: { kind: 'unavailable', reason: 'too-large' }, undoSummary: null }` を返す
  2. 戻す関数が `saved` の控え（`{ applied: 1, undo: { kind: 'saved', dir: '/tmp/undo-1', items: [{ path: 'a.txt', before: { kind: 'file', savedName: '0', mode: 0o644 }, after: { kind: 'file', size: 1, sha256: 'x', mode: 0o644 } }] } }`）を返すと、結果が `{ undo: { kind: 'saved' }, undoSummary: { undoId: 1, operation: 'file', entries: [{ path: 'a.txt', action: 'rewrite' }] } }` で、`invoke('agentChanges:getState', makeEvent())` の `undo` も同じ要約（renderer に `dir` を返さない: `JSON.stringify(result)` が `/tmp/undo-1` を含まない。L-019）
  3. `revertHunk` は `operation: 'hunk'`、`revertAll` は `{ status: 'done', revertedCount: 2, undo: { kind: 'unavailable', reason: 'directory' }, undoSummary: null }`。`partial` の結果（`{ status: 'partial', message: 'm', applied: 1, undo: ... }`）は `{ status: 'partial', message: 'm', revertedCount: 1, ... }`
  4. 戻す関数が reject したら `commitRevertUndo` を呼ばない（`vi.spyOn(registry, 'commitRevertUndo')` が呼ばれない）
  4b. 適用が 0 件の `すべて戻す`（`revertAllAgentChanges` の偽物が `{ status: 'done', applied: 0, undo: { kind: 'unavailable', reason: 'capture-failed' } }`、`expected` は `[]`）の前に、2 の形の `saved` の控えで `revertFile` を 1 回済ませておく → `revertAll` の結果が `{ status: 'done', revertedCount: 0, undo: { kind: 'unavailable', reason: 'capture-failed' }, undoSummary: { undoId: 1, operation: 'file', entries: [{ path: 'a.txt', action: 'rewrite' }] } }`、`commitRevertUndo` は `revertAll` では呼ばれず（spy の呼び出しは `revertFile` の 1 回だけ）、`getState` の `undo` も前の控えのまま（何も変えなかった依頼で前の取り消しの機会を消さない）
  5. `undoRevert`: メインフレーム以外は `AGENT_CHANGES_NOT_MAIN_FRAME`（不正な `undoId` でも）、不正な `undoId`（`undefined`・`0`・`'1'`）は `AGENT_CHANGES_UNDO_ID_INVALID_MESSAGE` で、`vi.spyOn(registry, 'undoLastRevert')` が呼ばれない。フォルダが無い・記録が無いは `AGENT_CHANGES_NO_RECORD_MESSAGE`。控えが無い記録への `undoRevert(1)` は `AGENT_UNDO_STALE_MESSAGE`
- `vi.mock('../../agentChangesRevert', ...)` はそのまま。`registry.commitRevertUndo` は本物（記録に控えを持つ）。2 の `dir` は実在しないパスで、後の `clear` の `removeDir` は偽物

`src/main/__tests__/agentBaselineRegistry.test.ts`: `toEqual({ kind: 'recording', ... })`（22 か所のうち `toEqual` のもの）に `undo: null` を足す。Task 4 の describe に「控えがあれば `getState`・`begin(manual)` の `recording` に要約を入れる」ケースを足す（1 の控えの後の `s.registry.getState(1, folder)` が `{ kind: 'recording', startedAt: 100, runs: [], undo: { undoId: 1, operation: 'file', entries: [{ path: 'a.txt', action: 'rewrite' }] } }`）。

`src/main/__tests__/agentChangesScopedQuery.test.ts`: 結果の期待値に `undo: null` を足し、控えのある記録（`makeAgentChangesRecord([], { undo: { undoId: 3, operation: 'all', dir: '/tmp/u', items: [] } })`）の `recording`・`scope-unavailable` の結果に `undo: { undoId: 3, operation: 'all', entries: [] }` が入るケースを足す。

`src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts` に describe `'戻す → 取り消すの往復(実 git)'` を足す:
1. `a.txt`（`a\n`）をコミット → `invoke('agentChanges:begin', 'send')` → `write('a.txt', 'a\nagent\n')` → `invoke('agentChanges:revertFile', 'a.txt', ALL)` が `{ undo: { kind: 'saved' }, undoSummary: { undoId: 1, operation: 'file', entries: [{ path: 'a.txt', action: 'rewrite' }] } }` → `invoke('agentChanges:list', ALL)` の `undo` が同じ → `invoke('agentChanges:undoRevert', 1)` が `{ status: 'done', restoredPaths: ['a.txt'], trashedPaths: [], undoSummary: null }`、`readRepoFile(repo, 'a.txt')` が `a\nagent\n`、`invoke('agentChanges:list', ALL)` の `undo` が `null`・`entries` に `a.txt`
2. 2 回目の `invoke('agentChanges:undoRevert', 1)` は `取り消せる操作が変わりました。一覧を更新してください` で reject
3. `すべて戻す`（`a.txt` 変更・`new.txt` 追加）の結果が `{ status: 'done', revertedCount: 2, undo: { kind: 'saved' }, undoSummary: { undoId: <n>, operation: 'all', entries: [{ path: 'a.txt', action: 'rewrite' }, { path: 'new.txt', action: 'recreate' }] } }`
4. 戻した後に `write('a.txt', 'later\n')` → `undoRevert` が `戻した後に変わったファイルがあるため、取り消せません（a.txt）` で reject し、`list` の `undo` が `null`
5. `invoke('agentChanges:clear')` の後、`readdirSync(tempRoot).filter((n) => n.startsWith('prompt-ide-agent-undo-'))` が `[]`

Run: `npx vitest run src/main/__tests__/handlers src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/agentChangesScopedQuery.test.ts`
Expected: FAIL

- [ ] **Step 4: 共有の型・registry・一覧・handler を実装する**

`src/shared/types/agentChanges.ts`:
```ts
  /** runs は実行の一覧(古い順。最大 AGENT_CHANGES_MAX_RUNS 件)。undo は直前の戻す操作の取り消しの控えの要約(無ければ null) */
  | { kind: 'recording'; startedAt: number; runs: AgentChangesRun[]; undo: AgentChangesUndoSummary | null }
```
`AgentChangesListResult` の `recording` と `scope-unavailable` の両方に `undo: AgentChangesUndoSummary | null` を足す（`AgentChangesUndoSummary` は同じファイルの後ろで宣言していても型なので参照できる）。

`src/main/agentBaselineRegistry.ts` の `recordingState` に `undo: summarizeAgentChangesUndo(record.undo)` を足す。

`src/main/agentChangesScopedQuery.ts`: import に `import { summarizeAgentChangesUndo } from './agentChangesUndo'`、`common` に `undo: summarizeAgentChangesUndo(record.undo)` を足す。

`src/main/handlers/agentChangesHandlers.ts`:
- import を直す:
```ts
import type {
  AgentChangesListResult,
  AgentChangesState,
  AgentChangesUndoOperation,
  AgentChangesUndoResult,
  AgentRevertAllResult,
  AgentRevertResult
} from '@shared/types'
import type { AgentRevertContext, AgentRevertOutcome } from '../agentChangesRevert'
import type { AgentChangesUndoCaptureOptions } from '../agentChangesUndo'
import { summarizeAgentChangesUndo, toAgentRevertUndoOutcome } from '../agentChangesUndo'
```
  と `parseAgentChangesUndoId` を parser の import に足す
- 冒頭のコメントに「取り消しで受け取るのは undoId だけ」を足す
- `AgentChangesHandlerDeps`:
```ts
export interface AgentChangesHandlerDeps {
  registry: Pick<
    AgentBaselineRegistry,
    'begin' | 'getState' | 'withRecord' | 'clear' | 'commitRevertUndo' | 'undoLastRevert'
  >
  folderAccess: FolderAccessManager
  /** OS のゴミ箱へ移す(trash.ts の moveToTrash) */
  trash: (absolutePath: string) => Promise<void>
  /** 取り消しの控えの置き場所と上限(本番は os.tmpdir() と AGENT_CHANGES_UNDO_MAX_BYTES) */
  undoCapture: AgentChangesUndoCaptureOptions
}
```
- `withRecordAtPath` の task の型を `(record: AgentChangesRecord, relativePath: string, args: A, ownerId: number) => Promise<T>` にし、呼び出しを `task(record, relativePath, args, ownerId)` にする
- `registerAgentChangesHandlers` の中に補助関数を足す:
```ts
  const revertContextOf = (record: AgentChangesRecord): AgentRevertContext => ({
    snapshot: record.baseline,
    trash,
    undo: undoCapture
  })
  // 戻した結果の控えを記録へ移し、renderer に返す控えの成否と要約を作る(記録の列の中で、戻す関数が resolve したときだけ呼ぶ)
  const commitRevert = async (
    ownerId: number,
    record: AgentChangesRecord,
    operation: AgentChangesUndoOperation,
    outcome: AgentRevertOutcome
  ): Promise<AgentRevertResult> => {
    const undoSummary = await registry.commitRevertUndo(ownerId, record, {
      operation,
      capture: outcome.undo
    })
    return { undo: toAgentRevertUndoOutcome(outcome.undo), undoSummary }
  }
```
- 戻す 3 チャンネルを置き換える:
```ts
  ipcMain.handle(
    'agentChanges:revertFile',
    (event, path: unknown, scope: unknown): Promise<AgentRevertResult> =>
      withRecordAtPath(
        event,
        path,
        () => parseRevertScope(scope),
        async (record, relativePath, _scope, ownerId) =>
          commitRevert(ownerId, record, 'file', await revertAgentChange(revertContextOf(record), relativePath))
      )
  )

  ipcMain.handle(
    'agentChanges:revertHunk',
    (event, path: unknown, patch: unknown, scope: unknown): Promise<AgentRevertResult> =>
      withRecordAtPath(
        event,
        path,
        () => {
          const parsedPatch = parseAgentChangePatch(patch)
          parseRevertScope(scope)
          return parsedPatch
        },
        async (record, relativePath, parsedPatch, ownerId) =>
          commitRevert(
            ownerId,
            record,
            'hunk',
            await revertAgentChangeHunk(revertContextOf(record), relativePath, parsedPatch)
          )
      )
  )

  ipcMain.handle(
    'agentChanges:revertAll',
    async (event, expected: unknown, scope: unknown): Promise<AgentRevertAllResult> => {
      const { ownerId, folder } = ownerOf(event)
      const entries = parseAgentRevertAllEntries(expected)
      parseRevertScope(scope)
      return withRecordOrThrow(ownerId, folder, async (record) => {
        const { applied, undo, ...result } = await revertAllAgentChanges(revertContextOf(record), entries)
        // 作業ツリーを 1 件も変えなかった(確認の一覧も今の一覧も空)なら前の控えを残す。commitRevertUndo を呼ぶと
        // capture-failed で前の控えを捨ててしまう(何も変えなかった依頼で前の取り消しの機会を消さない)
        const committed: AgentRevertResult =
          applied === 0
            ? { undo: toAgentRevertUndoOutcome(undo), undoSummary: summarizeAgentChangesUndo(record.undo) }
            : await commitRevert(ownerId, record, 'all', { applied, undo })
        return { ...result, revertedCount: applied, ...committed }
      })
    }
  )

  // 直前の戻す操作の取り消し。受け取るのは undoId だけで、取り消すパス・控えは main の記録が決める(L-019)。
  // 検証の失敗は記録の列に入る前に拒否する
  ipcMain.handle(
    'agentChanges:undoRevert',
    async (event, undoId: unknown): Promise<AgentChangesUndoResult> => {
      const { ownerId, folder } = ownerOf(event)
      const parsedUndoId = parseAgentChangesUndoId(undoId)
      if (folder === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
      const result = await registry.undoLastRevert(ownerId, folder, parsedUndoId)
      if (result === null) throw new Error(AGENT_CHANGES_NO_RECORD_MESSAGE)
      return result
    }
  )
```
（`{ ...result, revertedCount: applied, ...committed }` の型が `AgentRevertAllResult` に当てはまらないと型検査が言う場合は、`result.status === 'partial' ? { status: 'partial', message: result.message, revertedCount: applied, ...committed } : { status: 'done', revertedCount: applied, ...committed }` に書き下す）

Run: `npx vitest run src/main/__tests__/handlers src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/agentChangesScopedQuery.test.ts`
Expected: PASS

- [ ] **Step 5: preload と renderer の API・偽物を合わせる**

`src/preload/api.ts`（import に `AgentChangesUndoResult`・`AgentRevertAllResult`・`AgentRevertResult` を足し、使わなくなった `DiscardAllResult` は他で使っていなければ外す）:
```ts
  revertAgentChange: (path: string, scope: AgentChangesScope): Promise<AgentRevertResult> =>
    ipcRenderer.invoke('agentChanges:revertFile', path, scope),
  revertAgentChangeHunk: (
    path: string,
    patch: string,
    scope: AgentChangesScope
  ): Promise<AgentRevertResult> => ipcRenderer.invoke('agentChanges:revertHunk', path, patch, scope),
  revertAllAgentChanges: (
    expected: AgentRevertAllEntry[],
    scope: AgentChangesScope
  ): Promise<AgentRevertAllResult> => ipcRenderer.invoke('agentChanges:revertAll', expected, scope),
  undoAgentChangesRevert: (undoId: number): Promise<AgentChangesUndoResult> =>
    ipcRenderer.invoke('agentChanges:undoRevert', undoId),
  clearAgentChanges: (): Promise<void> => ipcRenderer.invoke('agentChanges:clear')
```
`src/preload/index.d.ts` の L158-164 を同じ戻り値の型にし、`undoAgentChangesRevert(undoId: number): Promise<AgentChangesUndoResult>` を足す。`src/preload/__tests__/api.test.ts` の表に `['undoAgentChangesRevert は agentChanges:undoRevert に undoId を渡す', () => api.undoAgentChangesRevert(3), ['agentChanges:undoRevert', 3]]` の形のケースを足す。

`src/renderer/src/lib/agentChangesApi.ts`: `revertAgentChange`・`revertAgentChangeHunk` の戻り値を `Promise<AgentRevertResult>`、`revertAllAgentChanges` を `Promise<AgentRevertAllResult>` にし、足す:
```ts
/** 直前の戻す操作を取り消す。undoId は帯に出した写しの控えの ID(main が今の控えと照合する) */
export function undoAgentChangesRevert(undoId: number): Promise<AgentChangesUndoResult> {
  return window.api.undoAgentChangesRevert(undoId)
}
```
`src/renderer/src/lib/__tests__/agentChangesApi.test.ts`: `mockApi` に `undoAgentChangesRevert: vi.fn()` を足し、`beginAgentChanges` の期待値に `undo: null`、`revertAllAgentChanges` の偽物と期待値を `makeAgentRevertAllResult()` にし、`await agentChangesApi.undoAgentChangesRevert(4)` と `expect(mockApi.undoAgentChangesRevert).toHaveBeenCalledWith(4)` を足す。

`src/renderer/src/__tests__/makeAgentChangesState.ts`: import に `AgentChangesUndoResult`・`AgentChangesUndoSummary`・`AgentRevertAllResult`・`AgentRevertResult`・`AgentRevertUndoOutcome` を足し、`makeAgentChangesRecordingState` を `{ startedAt = 100, runs = [], undo = null }` で `{ kind: 'recording', startedAt, runs, undo }` を返すようにし、`makeAgentChangesListResult`（`undo = null` を分割代入に足し、結果に `undo`）・`makeAgentChangesScopeUnavailableListResult`（overrides に `undo?`、結果に `undo`）を直し、Interfaces の 4 つの関数を足す:
```ts
/** 取り消しの控えの要約。既定は undoId 1・ファイル・a.txt の書き戻し */
export function makeAgentChangesUndoSummary(
  overrides: Partial<AgentChangesUndoSummary> = {}
): AgentChangesUndoSummary {
  return {
    undoId: 1,
    operation: 'file',
    entries: [{ path: 'a.txt', action: 'rewrite' }],
    ...overrides
  }
}

/** ファイル・ハンクを戻した結果。既定は控えが取れた */
export function makeAgentRevertResult(overrides: Partial<AgentRevertResult> = {}): AgentRevertResult {
  return { undo: { kind: 'saved' }, undoSummary: makeAgentChangesUndoSummary(), ...overrides }
}

/** すべて戻した結果。既定は done・1 件・控えが取れた。status: 'partial' なら message(既定 'partial')を付ける */
export function makeAgentRevertAllResult(
  overrides: {
    status?: 'done' | 'partial'
    message?: string
    revertedCount?: number
    undo?: AgentRevertUndoOutcome
    undoSummary?: AgentChangesUndoSummary | null
  } = {}
): AgentRevertAllResult {
  const common = {
    revertedCount: overrides.revertedCount ?? 1,
    undo: overrides.undo ?? { kind: 'saved' as const },
    undoSummary:
      overrides.undoSummary === undefined
        ? makeAgentChangesUndoSummary({ operation: 'all' })
        : overrides.undoSummary
  }
  return overrides.status === 'partial'
    ? { status: 'partial', message: overrides.message ?? 'partial', ...common }
    : { status: 'done', ...common }
}

/** 取り消しの結果。既定は done・a.txt を書き戻した */
export function makeAgentChangesUndoResult(
  overrides: Partial<Extract<AgentChangesUndoResult, { status: 'done' }>> = {}
): AgentChangesUndoResult {
  return { status: 'done', restoredPaths: ['a.txt'], trashedPaths: [], undoSummary: null, ...overrides }
}
```
`src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts` の state・一覧の結果の期待値（8 か所のうち該当するもの）に `undo: null` を足し、新しい 4 つの関数の既定値のケースを足す。

`src/renderer/src/__tests__/setup.ts` の L77-80 を次にする:
```ts
    revertAgentChange: () => Promise.resolve({ undo: { kind: 'saved' }, undoSummary: null }),
    revertAgentChangeHunk: () => Promise.resolve({ undo: { kind: 'saved' }, undoSummary: null }),
    revertAllAgentChanges: () =>
      Promise.resolve({ status: 'done', revertedCount: 0, undo: { kind: 'saved' }, undoSummary: null }),
    undoAgentChangesRevert: () =>
      Promise.resolve({ status: 'done', restoredPaths: [], trashedPaths: [], undoSummary: null }),
    clearAgentChanges: () => Promise.resolve()
```
`src/renderer/src/hooks/useAgentChangesRevert.ts` の `revertFile`・`revertHunk` の `execute` を `async () => { await agentChangesApi.revertAgentChange(entry.path, list.scope) }`・`async () => { await agentChangesApi.revertAgentChangeHunk(path, patch, diffScope) }` にする（`run` の `execute: () => Promise<void>` に合わせる。挙動は変えない）。`src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts` の `beforeEach` の偽物を `mockResolvedValue(makeAgentRevertResult())`（2 か所）と `mockResolvedValue(makeAgentRevertAllResult({ undoSummary: null }))` にし、`{ status: 'partial', message: ... }` を返す偽物を `makeAgentRevertAllResult({ status: 'partial', message: ... })` にする。待たせる偽物（`mockReturnValueOnce(new Promise<void>(...))`・`resolveRevert({ status: 'done' })` の形。L343-391 など）は、`new Promise<AgentRevertResult>((resolve) => { resolveRevert = () => resolve(makeAgentRevertResult()) })`・`new Promise<AgentRevertAllResult>(...)` と `resolveRevert(makeAgentRevertAllResult())` に直す（`grep -n "mockReturnValueOnce\|resolveRevert" src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts` で拾う）。

- [ ] **Step 6: テスト・型・lint**

Run: `npx vitest run src/main/__tests__/handlers src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/agentChangesScopedQuery.test.ts src/preload src/renderer/src/lib/__tests__/agentChangesApi.test.ts src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts src/renderer/src/hooks/__tests__/useAgentChanges.test.ts src/renderer/src/lib/__tests__/agentChangesView.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`
Expected: PASS（renderer の写しはまだ `undo` を持たないため、view の期待値は変わらない）
Run: `npm run typecheck`
Expected: PASS
Run: このタスクの **Files** に挙げた `.ts`・`.tsx` のファイル（作成・変更・テスト）をすべて並べて `npx eslint --fix <ファイル…> && npx eslint --max-warnings 0 <ファイル…>`
Expected: エラー・警告なし

---

### Task 6: renderer の実行の共有の切り出し（挙動を変えない）

**Files:**
- Create: `src/renderer/src/hooks/useAgentChangesWriteRunner.ts`
- Modify: `src/renderer/src/types.ts`（`AgentChangesRunningOperation` の型。lib と hook の両方から読むため types に置く）
- Modify: `src/renderer/src/hooks/useAgentChangesRevert.ts`（全体。実行の部分を runner へ移す）
- Modify: `src/renderer/src/lib/agentChangesAvailability.ts`（`AgentRevertAvailability.isReverting` L37-38 → `runningOperation`、`agentRevertDisabledReason` L46-53）
- Modify: `src/renderer/src/lib/agentChangesMessages.ts`（`AGENT_CHANGES_BUSY_UNDOING` を L150 の後に足す）
- Modify: `src/renderer/src/hooks/useAgentChangesWiring.ts`（runner を作って `useAgentChangesRevert` に渡す。L179-193）
- Modify: `src/renderer/src/components/source-control/AgentChangesSection.tsx`（`revert.isReverting` の 4 か所 L166・L170・L258・L260 を `revert.runningOperation !== null` に）
- Modify: `src/renderer/src/__tests__/makeAgentChangesState.ts`（`makeAgentChangesRevertState` の `isReverting: false` → `runningOperation: null`）
- Test: `src/renderer/src/hooks/__tests__/useAgentChangesWriteRunner.test.ts`（新規）
- Test: `src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`（runner と組で描画する補助関数に置き換え、`isReverting` の 3 か所を `runningOperation` に）
- Test: `src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts`（`isReverting` の組み合わせを `runningOperation` の 3 値に）
- Test: `src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts`（L364-372 の期待値に `runner`）
- Test: `src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`（L462）・`src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts`（L220）

**Interfaces:**
- Consumes: `FileOperationLock`（`hooks/useFileOperationLock`）、`useOnChange`、`toError`（`lib/errorUtils`）
- Produces:
```ts
// src/renderer/src/types.ts
/** エージェントの変更の書き換えの実行中の印(戻す操作・取り消し) */
export type AgentChangesRunningOperation = 'revert' | 'undo'
// src/renderer/src/hooks/useAgentChangesWriteRunner.ts
export type AgentChangesWriteSource = 'file' | 'hunk' | 'all' | 'undo'
export interface AgentChangesWriteError { message: string; path: string | null; source: AgentChangesWriteSource }
export interface AgentChangesWriteHooks<T> {
  onResult: (result: T) => void
  onError: (error: unknown) => void
  onFailure?: (message: string) => void
}
export type AgentChangesWriteOutcome<T> = { ok: true; result: T } | { ok: false }
export interface AgentChangesWriteRunnerOptions {
  folderPath: string | null
  /** 写しの記録の開始の時刻(記録中でなければ null)。変わったら記録の世代を進める */
  recordStartedAt: number | null
  fileLock: FileOperationLock
}
export interface AgentChangesWriteRunner {
  runningOperation: AgentChangesRunningOperation | null
  error: AgentChangesWriteError | null
  isRunning: () => boolean
  run: <T>(
    source: AgentChangesWriteSource,
    path: string | null,
    execute: () => Promise<T>,
    hooks: AgentChangesWriteHooks<T>
  ) => Promise<AgentChangesWriteOutcome<T>>
  captureGeneration: () => number
  isCurrentGeneration: (generation: number) => boolean
  showWarning: (message: string, source: AgentChangesWriteSource, generation: number) => void
}
export function useAgentChangesWriteRunner(options: AgentChangesWriteRunnerOptions): AgentChangesWriteRunner
// src/renderer/src/hooks/useAgentChangesRevert.ts
export interface AgentChangesRevertOptions { /* 既存 */ runner: AgentChangesWriteRunner }
export interface AgentChangesRevertState {
  /** 実行の共有の実行中の印(戻す操作・取り消し) */
  runningOperation: AgentChangesRunningOperation | null
  /* error・errorPath・isErrorAnnouncedInDiff・hunkNotice・revertDisabledReason・revertAllDisabledReason・revertFile・revertHunk・revertAll は既存のまま */
}
// src/renderer/src/lib/agentChangesAvailability.ts
export interface AgentRevertAvailability {
  isLoading: boolean
  isGitBusy: boolean
  /** 戻す操作・取り消しの実行中 */
  runningOperation: AgentChangesRunningOperation | null
  hasListError: boolean
  isRunScope: boolean
}
// src/renderer/src/lib/agentChangesMessages.ts
export const AGENT_CHANGES_BUSY_UNDOING = '取り消しの実行中です'
```

- [ ] **Step 1: runner の失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAgentChangesWriteRunner.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAgentChangesWriteRunner } from '../useAgentChangesWriteRunner'
import type { AgentChangesWriteRunnerOptions } from '../useAgentChangesWriteRunner'
import type { FileOperationLock } from '../useFileOperationLock'

const makeLock = (): FileOperationLock => ({
  isLocked: vi.fn(() => false),
  lock: vi.fn(),
  unlock: vi.fn(),
  isAnyLocked: vi.fn(() => false),
  lockGlobal: vi.fn(),
  unlockGlobal: vi.fn()
})

function setup(initial: Partial<AgentChangesWriteRunnerOptions> = {}): {
  result: { current: ReturnType<typeof useAgentChangesWriteRunner> }
  rerender: (props: AgentChangesWriteRunnerOptions) => void
  options: AgentChangesWriteRunnerOptions
} {
  const options: AgentChangesWriteRunnerOptions = {
    folderPath: '/repo',
    recordStartedAt: 1,
    fileLock: makeLock(),
    ...initial
  }
  const { result, rerender } = renderHook((props: AgentChangesWriteRunnerOptions) => useAgentChangesWriteRunner(props), {
    initialProps: options
  })
  return { result, rerender, options }
}

const noHooks = { onResult: (): void => undefined, onError: (): void => undefined }

describe('useAgentChangesWriteRunner', () => {
  it('全体ロックの中で実行し、結果を返す。onResult は実行中の印を下ろす(ロックを外す)前に呼ぶ', async () => {
    const { result, options } = setup()
    const onResult = vi.fn()
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.run('file', 'a.txt', async () => 'done', { ...noHooks, onResult })
    })
    expect(outcome).toEqual({ ok: true, result: 'done' })
    expect(onResult).toHaveBeenCalledWith('done')
    expect(onResult.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(options.fileLock.unlockGlobal).mock.invocationCallOrder[0]
    )
    expect(options.fileLock.lockGlobal).toHaveBeenCalledOnce()
    expect(result.current.runningOperation).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it.each([
    ['file', 'revert'],
    ['hunk', 'revert'],
    ['all', 'revert'],
    ['undo', 'undo']
  ] as const)('source %s の実行中の印は %s で、isRunning は同じ描画の中でも真', async (source, expected) => {
    const { result } = setup()
    let release: () => void = () => undefined
    let pending: Promise<unknown> = Promise.resolve()
    await act(async () => {
      pending = result.current.run(source, null, () => new Promise<void>((r) => (release = r)), noHooks)
      expect(result.current.isRunning()).toBe(true)
    })
    expect(result.current.runningOperation).toBe(expected)
    await act(async () => {
      release()
      await pending
    })
    expect(result.current.isRunning()).toBe(false)
  })

  it('失敗したら onError を印を下ろす前に呼び、失敗の表示を出し、世代が同じなら onFailure を呼ぶ', async () => {
    const { result, options } = setup()
    const onError = vi.fn()
    const onFailure = vi.fn()
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.run('hunk', 'a.txt', async () => {
        throw new Error('戻せません')
      }, { onResult: vi.fn(), onError, onFailure })
    })
    expect(outcome).toEqual({ ok: false })
    expect(onError.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(options.fileLock.unlockGlobal).mock.invocationCallOrder[0]
    )
    expect(result.current.error).toEqual({ message: '戻せません', path: 'a.txt', source: 'hunk' })
    expect(onFailure).toHaveBeenCalledWith('戻せません')
  })

  it('実行中に記録が変わったら(新しい記録)、失敗を出さず onFailure を呼ばない。onError は呼ぶ', async () => {
    const { result, rerender, options } = setup()
    let reject: (error: Error) => void = () => undefined
    const onError = vi.fn()
    const onFailure = vi.fn()
    let pending: Promise<unknown> = Promise.resolve()
    await act(async () => {
      pending = result.current.run('hunk', 'a.txt', () => new Promise<void>((_r, j) => (reject = j)), {
        onResult: vi.fn(),
        onError,
        onFailure
      })
    })
    rerender({ ...options, recordStartedAt: 2 })
    await act(async () => {
      reject(new Error('古い失敗'))
      await pending
    })
    expect(onError).toHaveBeenCalledOnce()
    expect(onFailure).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
  })

  it('captureGeneration・isCurrentGeneration はフォルダ・記録の変化で古くなり、失敗の表示を消す', async () => {
    const { result, rerender, options } = setup()
    await act(async () => {
      await result.current.run('file', 'a.txt', async () => {
        throw new Error('x')
      }, noHooks)
    })
    const generation = result.current.captureGeneration()
    expect(result.current.isCurrentGeneration(generation)).toBe(true)
    rerender({ ...options, folderPath: '/other' })
    expect(result.current.isCurrentGeneration(generation)).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('showWarning は世代が同じときだけ警告を出す(path は null)', () => {
    const { result, rerender, options } = setup()
    const generation = result.current.captureGeneration()
    act(() => result.current.showWarning('途中で失敗', 'all', generation))
    expect(result.current.error).toEqual({ message: '途中で失敗', path: null, source: 'all' })
    rerender({ ...options, recordStartedAt: null })
    act(() => result.current.showWarning('古い警告', 'all', generation))
    expect(result.current.error).toBeNull()
  })
})
```
Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesWriteRunner.test.ts`
Expected: FAIL（`Cannot find module '../useAgentChangesWriteRunner'`）

- [ ] **Step 2: runner を実装する**

`src/renderer/src/types.ts` の `AgentChangesView` の前に足す:
```ts
/** エージェントの変更の書き換えの実行中の印(戻す操作・取り消し。実行の共有〈useAgentChangesWriteRunner〉が持つ) */
export type AgentChangesRunningOperation = 'revert' | 'undo'
```
`src/renderer/src/hooks/useAgentChangesWriteRunner.ts`:
```ts
import { useRef, useState } from 'react'
import type { AgentChangesRunningOperation } from '../types'
import { toError } from '../lib/errorUtils'
import type { FileOperationLock } from './useFileOperationLock'
import { useOnChange } from './useOnChange'

// エージェントの変更を書き換える操作(戻す操作・取り消し)の実行の共有(設計書「実行の共有」)。同じ実行中の印・同じ失敗の表示・
// 同じ全体ロック(fileLock.lockGlobal。他の Git 操作と排他。パターン 111)を持ち、片方の実行中はもう片方を押せなくする(L-058)。
// 失敗の文言はその記録・そのフォルダについてのもの: フォルダの切り替え・記録の終了・新しい記録で記録の世代を進めて消し、
// 実行中に変わったら終わった後に古い失敗を出さない(L-424 の失敗の表示は背景の取り直しと別に持つ)

export type AgentChangesWriteSource = 'file' | 'hunk' | 'all' | 'undo'

export interface AgentChangesWriteError {
  message: string
  /** 失敗の対象のパス(ファイル・ハンク。すべて戻す・取り消しは null)。diff タブは自分のパスの失敗だけを出す */
  path: string | null
  /** 失敗の発生源(どこで読み上げるかの出し分け。hunk は diff タブ側の常設の aria-live が読む) */
  source: AgentChangesWriteSource
}

export interface AgentChangesWriteHooks<T> {
  /** execute が解決した直後(実行中の印を下ろす前)。記録の世代に関わらず呼ぶ */
  onResult: (result: T) => void
  /** execute が reject した直後(実行中の印を下ろす前)。記録の世代に関わらず呼ぶ */
  onError: (error: unknown) => void
  /** reject したときに、記録の世代が依頼の時点と同じ場合だけ、失敗の表示の後に呼ぶ */
  onFailure?: (message: string) => void
}

export type AgentChangesWriteOutcome<T> = { ok: true; result: T } | { ok: false }

export interface AgentChangesWriteRunnerOptions {
  folderPath: string | null
  recordStartedAt: number | null
  fileLock: FileOperationLock
}

export interface AgentChangesWriteRunner {
  runningOperation: AgentChangesRunningOperation | null
  error: AgentChangesWriteError | null
  /** 同じ描画の中の 2 回目の依頼を止める(state は次の描画まで変わらない) */
  isRunning: () => boolean
  run: <T>(
    source: AgentChangesWriteSource,
    path: string | null,
    execute: () => Promise<T>,
    hooks: AgentChangesWriteHooks<T>
  ) => Promise<AgentChangesWriteOutcome<T>>
  /** 依頼の前に呼んで控える記録の世代 */
  captureGeneration: () => number
  isCurrentGeneration: (generation: number) => boolean
  /** 世代が同じときだけ警告を出す(すべて戻す・取り消しの partial を、タブの読み直しの後に出す) */
  showWarning: (message: string, source: AgentChangesWriteSource, generation: number) => void
}

export function useAgentChangesWriteRunner({
  folderPath,
  recordStartedAt,
  fileLock
}: AgentChangesWriteRunnerOptions): AgentChangesWriteRunner {
  const [runningOperation, setRunningOperation] = useState<AgentChangesRunningOperation | null>(null)
  const [error, setError] = useState<AgentChangesWriteError | null>(null)
  // 記録の世代(一覧・diff の範囲〈AgentChangesScope〉とは別のもの)
  const generationRef = useRef(0)
  const runningRef = useRef(false)
  const resetForRecordChange = (): void => {
    generationRef.current += 1
    setError(null)
  }
  useOnChange(folderPath, resetForRecordChange)
  useOnChange(recordStartedAt, resetForRecordChange)

  const run = async <T>(
    source: AgentChangesWriteSource,
    path: string | null,
    execute: () => Promise<T>,
    hooks: AgentChangesWriteHooks<T>
  ): Promise<AgentChangesWriteOutcome<T>> => {
    const generation = generationRef.current
    runningRef.current = true
    setRunningOperation(source === 'undo' ? 'undo' : 'revert')
    setError(null)
    fileLock.lockGlobal()
    try {
      let result: T
      try {
        result = await execute()
      } catch (err) {
        hooks.onError(err)
        if (generation === generationRef.current) {
          const message = toError(err).message
          setError({ message, path, source })
          hooks.onFailure?.(message)
        }
        return { ok: false }
      }
      hooks.onResult(result)
      return { ok: true, result }
    } finally {
      fileLock.unlockGlobal()
      runningRef.current = false
      setRunningOperation(null)
    }
  }

  return {
    runningOperation,
    error,
    isRunning: () => runningRef.current,
    run,
    captureGeneration: () => generationRef.current,
    isCurrentGeneration: (generation) => generation === generationRef.current,
    showWarning: (message, source, generation) => {
      if (generation === generationRef.current) setError({ message, path: null, source })
    }
  }
}
```
Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesWriteRunner.test.ts`
Expected: PASS

- [ ] **Step 3: 戻す操作の hook のテストを runner と組にする（失敗させる）**

`src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`:
1. import に `useAgentChangesWriteRunner` と `import type { AgentChangesRevertState } from '../useAgentChangesRevert'` を足す
2. `makeOptions` の戻り値の型を `Omit<AgentChangesRevertOptions, 'runner'>` にする
3. 補助の hook を足し、`renderHook(() => useAgentChangesRevert(options))`・`renderHook((props) => useAgentChangesRevert(props), ...)` の 34 か所を `useRevertWithRunner` に置き換える（`grep -n "useAgentChangesRevert(" ` で拾う。`ReturnType<typeof useAgentChangesRevert>` の型の注記はそのまま）:
```ts
// 実行の共有(runner)と組で描画する(useAgentChangesWiring と同じ組み立て)
function useRevertWithRunner(options: Omit<AgentChangesRevertOptions, 'runner'>): AgentChangesRevertState {
  const view = options.changes.view
  const runner = useAgentChangesWriteRunner({
    folderPath: options.folderPath,
    recordStartedAt: view.kind === 'recording' ? view.startedAt : null,
    fileLock: options.fileLock
  })
  return useAgentChangesRevert({ ...options, runner })
}
```
4. `result.current.isReverting` の 3 か所（L106・L360・L391）を `result.current.runningOperation` にし、期待値を `toBe(false)` → `toBeNull()`、`toBe(true)` → `toBe('revert')` にする

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`
Expected: FAIL（`runner` を使わない hook のため `runningOperation` が無い）

- [ ] **Step 4: 戻す操作の hook・可否・セクション・配線を書き直す**

`src/renderer/src/lib/agentChangesMessages.ts` の `AGENT_CHANGES_BUSY_REVERTING` の次に足す:
```ts
export const AGENT_CHANGES_BUSY_UNDOING = '取り消しの実行中です'
```
`src/renderer/src/lib/agentChangesAvailability.ts`:
- import に `AGENT_CHANGES_BUSY_UNDOING` と `import type { AgentChangesRunningOperation, AgentChangesView } from '../types'`
- `AgentRevertAvailability` の `isReverting` を次に置き換える:
```ts
  /** 戻す操作・取り消しの実行中(実行の共有の実行中の印) */
  runningOperation: AgentChangesRunningOperation | null
```
- `agentRevertDisabledReason` の 1 行目を次の 2 行にする:
```ts
  if (availability.runningOperation === 'revert') return AGENT_CHANGES_BUSY_REVERTING
  if (availability.runningOperation === 'undo') return AGENT_CHANGES_BUSY_UNDOING
```
`src/renderer/src/hooks/useAgentChangesRevert.ts` を次にする（変わるのは実行の部分だけ。確認の文言・タブの同期・読み上げは今のまま）:
```ts
import type { AgentChangeEntry, AgentChangesScope } from '@shared/types'
import type { AgentChangesRunningOperation, Announcement } from '../types'
import * as agentChangesApi from '../lib/agentChangesApi'
import {
  agentRevertAllDisabledReason,
  agentRevertDisabledReason
} from '../lib/agentChangesAvailability'
import {
  buildAgentRevertAllConfirmMessage,
  buildAgentRevertFileConfirmMessage,
  buildAgentRevertHunkConfirmMessage,
  formatAgentChangesRevertedNotice,
  AGENT_CHANGES_HUNK_REVERTED_NOTICE
} from '../lib/agentChangesMessages'
import { agentChangeAbsolutePath, isEntrySavedInApp, isSavedInApp } from '../lib/agentChangesPaths'
import { getListedAgentChanges } from '../lib/agentChangesScope'
import { AGENT_CHANGES_NOTICE_DURATION_MS } from './useAgentChanges'
import type { AgentChangesController } from './useAgentChanges'
import type { AgentChangesWriteRunner } from './useAgentChangesWriteRunner'
import type { FileOperationLock } from './useFileOperationLock'
import { useOnChange } from './useOnChange'
import { useTransientNotice } from './useTransientNotice'

// エージェントの変更を戻す(ファイル・ハンク・すべて)。既存の取り消し(useDiscardFileChanges・useDiscardHunk・
// useDiscardAllChanges)と同じく「押せるか → 確認 → ロック → 実行 → 成功したときだけタブとツリーを同期」の順で行う
// (パターン 20・52)。実行中の印・失敗の表示・全体ロック・記録の世代は、取り消しと共有する実行の共有(runner)が持つ

export interface AgentChangesRevertOptions {
  /* folderPath 〜 onConfirm は既存のまま(JSDoc も残す) */
  /** 戻す操作と取り消しで共有する実行(useAgentChangesWriteRunner) */
  runner: AgentChangesWriteRunner
}

export interface AgentChangesRevertState {
  /** 戻す操作・取り消しの実行中の印 */
  runningOperation: AgentChangesRunningOperation | null
  /* error 〜 revertAll は既存のまま(JSDoc も残す) */
}

// 切り出しの最初の段階では、結果を写しへ反映しない(Task 7 で applyUndoSummary を呼ぶ)
const IGNORE_RESULT = { onResult: (): void => undefined, onError: (): void => undefined }

export function useAgentChangesRevert({
  folderPath,
  changes,
  fileLock,
  agentRunning,
  hasDirtyTabAtOrInside,
  reloadOpenFile,
  closeTabsAtOrInside,
  confirmDiscardAnyDirty,
  reloadOpenFiles,
  refreshTree,
  refreshGitStatus,
  refreshDiff,
  runner,
  onConfirm = confirm
}: AgentChangesRevertOptions): AgentChangesRevertState {
  const {
    notice: hunkNotice,
    announce: announceHunk,
    clear: clearHunkNotice
  } = useTransientNotice(AGENT_CHANGES_NOTICE_DURATION_MS)
  // ハンクの結果の読み上げは、その記録・そのフォルダについてのもの(失敗の表示は runner が同じ契機で消す)
  useOnChange(folderPath, clearHunkNotice)
  useOnChange(changes.view.kind === 'recording' ? changes.view.startedAt : null, clearHunkNotice)
  const list = getListedAgentChanges(changes.view)
  const availability = {
    isLoading: changes.isLoading,
    isGitBusy: fileLock.isAnyLocked(),
    runningOperation: runner.runningOperation,
    hasListError: changes.listError !== null,
    // 選んでいる範囲か、表示中の一覧の範囲が実行なら戻せない(実行ごとの表示は見るだけ。L-061)
    isRunScope: changes.scope.kind !== 'all' || (list !== null && list.scope.kind !== 'all')
  }
  const revertDisabledReason = agentRevertDisabledReason(availability)
  const revertAllDisabledReason = agentRevertAllDisabledReason({
    ...availability,
    truncated: list?.truncated ?? false,
    // main へ渡す expected からは除かない(完全一致の照合のため)。押せなくして、必ず失敗する確認を出さない
    hasNotRecorded: list?.entries.some((entry) => entry.notRecorded) ?? false
  })

  const absoluteOf = (path: string): string | null => agentChangeAbsolutePath(folderPath, path)

  // 成功・失敗のどちらでも一覧と git status を取り直す(状態が変わりうる)。タブの読み直しは呼び出し側が成功したときだけ行う
  const refreshAfter = async (): Promise<void> => {
    await refreshTree().catch(() => undefined)
    await refreshGitStatus().catch(() => undefined)
    await changes.refresh()
    refreshDiff()
  }

  const canStart = (): boolean => !runner.isRunning() && revertDisabledReason === null

  const revertFile = async (entry: AgentChangeEntry): Promise<void> => {
    const absolutePath = absoluteOf(entry.path)
    // 処理の側の守り: 表示中の一覧が累積でなければ、確認を出さずに何もしない(L-058)
    if (absolutePath === null || list === null || list.scope.kind !== 'all') return
    if (!canStart() || entry.notRecorded) return
    const message = buildAgentRevertFileConfirmMessage({
      path: entry.path,
      status: entry.status,
      isDirectory: entry.isDirectory,
      savedInApp: isSavedInApp(changes.savedPaths, absolutePath),
      hasUnsavedEdits: hasDirtyTabAtOrInside(absolutePath),
      agentRunning
    })
    if (!onConfirm(message)) return
    const outcome = await runner.run(
      'file',
      entry.path,
      async () => {
        await agentChangesApi.revertAgentChange(entry.path, list.scope)
      },
      IGNORE_RESULT
    )
    if (outcome.ok) {
      // 追加はゴミ箱へ移したのでタブを閉じ、それ以外は記録の時点の内容を読み直す
      if (entry.status === 'A') closeTabsAtOrInside(absolutePath)
      else await reloadOpenFile(absolutePath)
      changes.announce(formatAgentChangesRevertedNotice(1))
    }
    await refreshAfter()
  }

  // diffScope は diff の内容を取った範囲。累積でなければ、実行の開始の時点との差分のパッチになるため戻さない(L-058)
  const revertHunk = async (
    path: string,
    patch: string,
    hunkHeader: string,
    diffScope: AgentChangesScope
  ): Promise<void> => {
    const absolutePath = absoluteOf(path)
    if (absolutePath === null || diffScope.kind !== 'all' || !canStart()) return
    const message = buildAgentRevertHunkConfirmMessage({
      path,
      hunkHeader,
      savedInApp: isSavedInApp(changes.savedPaths, absolutePath),
      hasUnsavedEdits: hasDirtyTabAtOrInside(absolutePath),
      agentRunning
    })
    if (!onConfirm(message)) return
    // 結果は diff タブ側の aria-live で読み上げる(PR #47 の 2 回目のレビューで二重の読み上げを修正)
    const generation = runner.captureGeneration()
    const outcome = await runner.run(
      'hunk',
      path,
      async () => {
        await agentChangesApi.revertAgentChangeHunk(path, patch, diffScope)
      },
      { ...IGNORE_RESULT, onFailure: announceHunk }
    )
    if (outcome.ok) {
      await reloadOpenFile(absolutePath)
      if (runner.isCurrentGeneration(generation)) announceHunk(AGENT_CHANGES_HUNK_REVERTED_NOTICE)
    }
    await refreshAfter()
  }

  const revertAll = async (): Promise<void> => {
    if (list === null || list.scope.kind !== 'all' || list.entries.length === 0) return
    if (runner.isRunning() || revertAllDisabledReason !== null) return
    const message = buildAgentRevertAllConfirmMessage({
      count: list.entries.length,
      trashCount: list.entries.filter((entry) => entry.status === 'A').length,
      // セクションの行の印と同じ判定(フォルダの行は配下の保存を含む)
      savedInApp: list.entries.some((entry) =>
        isEntrySavedInApp(folderPath, changes.savedPaths, entry.path)
      ),
      agentRunning
    })
    if (!onConfirm(message)) return
    // 未保存の編集の破棄は、既存の「すべて取り消す」と同じく別の確認で承諾させる
    if (!confirmDiscardAnyDirty()) return
    // 確認で見せた一覧(パスと状態の文字)を main へ渡す。実行時の一覧と完全一致しなければ main が中止する
    const expected = list.entries.map(({ path, status }) => ({ path, status }))
    const generation = runner.captureGeneration()
    const outcome = await runner.run(
      'all',
      null,
      () => agentChangesApi.revertAllAgentChanges(expected, list.scope),
      IGNORE_RESULT
    )
    if (outcome.ok) {
      // partial も作業ツリーが変わっているので読み直す(パターン 52)。警告は読み直しの後に出す
      await reloadOpenFiles()
      if (outcome.result.status === 'partial') {
        runner.showWarning(outcome.result.message, 'all', generation)
      } else changes.announce(formatAgentChangesRevertedNotice(expected.length))
    }
    await refreshAfter()
  }

  return {
    runningOperation: runner.runningOperation,
    error: runner.error?.message ?? null,
    errorPath: runner.error?.path ?? null,
    isErrorAnnouncedInDiff: runner.error?.source === 'hunk',
    hunkNotice,
    revertDisabledReason,
    revertAllDisabledReason,
    revertFile,
    revertHunk,
    revertAll
  }
}
```
（`/* ... は既存のまま */` の箇所は、今のファイルの該当のフィールドと JSDoc をそのまま残す。`useRef`・`useState`・`toError` の import は使わなくなるので外す）

`src/renderer/src/hooks/useAgentChangesWiring.ts`:
- import に `import { useAgentChangesWriteRunner } from './useAgentChangesWriteRunner'`
- `const revert = useAgentChangesRevert({` の前に足し、`useAgentChangesRevert` の引数の最後に `runner` を足す:
```ts
  // 戻す操作と取り消しで共有する実行(同じ実行中の印・失敗の表示・全体ロック)
  const runner = useAgentChangesWriteRunner({
    folderPath,
    recordStartedAt: view.kind === 'recording' ? view.startedAt : null,
    fileLock
  })
```
`src/renderer/src/components/source-control/AgentChangesSection.tsx`: `revert.isReverting` の 4 か所を、`const isWriting = revert.runningOperation !== null`（`shownReason` の後に宣言）を使って `isWriting` に置き換える（L166 `disabled={isWriting}`、L170 `if (!isWriting) changes.selectScope(next)`、L258 `disabled={isWriting}`、L260 `isWriting && shownReason !== null ? reasonId : undefined`）。

`src/renderer/src/__tests__/makeAgentChangesState.ts` の `makeAgentChangesRevertState` の `isReverting: false` を `runningOperation: null` にし、`src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts` の L220 も同じにする。`AgentChangesSection.test.tsx` の L462 の `isReverting: true` を `runningOperation: 'revert'` にする。

`src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts`: `isReverting` の真偽の組み合わせ（L60-170）を `runningOperation` の `null`・`'revert'`・`'undo'` の 3 値にし、`'revert'` → `AGENT_CHANGES_BUSY_REVERTING`、`'undo'` → `AGENT_CHANGES_BUSY_UNDOING`（どちらも他の理由より優先）の期待値にする。`[ 'isReverting', AGENT_CHANGES_BUSY_REVERTING ]` の行は `['runningOperation: revert', ...]`・`['runningOperation: undo', AGENT_CHANGES_BUSY_UNDOING]` の 2 行にする。

`src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts` の L364-372 の期待値に `runner: expect.objectContaining({ run: expect.any(Function), runningOperation: null })` を足す。

- [ ] **Step 5: テストを通す（既存のテストがすべて通る）**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesWriteRunner.test.ts src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts src/renderer/src/components/source-control src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.agentChanges.test.tsx src/renderer/src/components/__tests__/EditorPanel.test.tsx`
Expected: PASS（期待値を変えたのは `isReverting` → `runningOperation` の置き換えだけ）

- [ ] **Step 6: 型・lint**

Run: `npm run typecheck`
Expected: PASS
Run: このタスクの **Files** に挙げた `.ts`・`.tsx` のファイル（作成・変更・テスト）をすべて並べて `npx eslint --fix <ファイル…> && npx eslint --max-warnings 0 <ファイル…>`
Expected: エラー・警告なし

---

### Task 7: 写しの `undo`・取り消しの hook・文言と可否（`useAgentChangesUndo`）

**Files:**
- Modify: `src/renderer/src/types.ts`（`AgentChangesView` の `recording` L177-182 に `undo`、import に `AgentChangesUndoSummary`）
- Modify: `src/renderer/src/lib/agentChangesView.ts`（`planRecordingState` L82-87・`planListResult` L114・L136-141 に `undo`）
- Modify: `src/renderer/src/hooks/useAgentChanges.ts`（`AgentChangesController` に `applyUndoSummary`、実装、戻り値）
- Modify: `src/renderer/src/lib/agentChangesMessages.ts`（戻す確認の文言 L188-242、結果の読み上げ L140-146、取り消しの文言）
- Modify: `src/renderer/src/lib/agentChangesAvailability.ts`（`agentUndoDisabledReason`）
- Create: `src/renderer/src/hooks/useAgentChangesUndo.ts`
- Modify: `src/renderer/src/hooks/useAgentChangesRevert.ts`（`changes` の `Pick` に `applyUndoSummary`、`IGNORE_RESULT` を写しへの反映に置き換え、結果の読み上げ・`partial` の警告・すべて戻すの確認の `hasDirectory`）
- Modify: `src/renderer/src/__tests__/makeAgentChangesState.ts`（`makeAgentChangesRecordingView`・`makeAgentChangesScopeUnavailableView` に `undo`、`makeAgentChangesController` に `applyUndoSummary`、`makeAgentChangesUndoState`）
- Test: `src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`・`agentChangesAvailability.test.ts`・`agentChangesView.test.ts`
- Test: `src/renderer/src/hooks/__tests__/useAgentChanges.test.ts`・`useAgentChangesRevert.test.ts`・`useAgentChangesUndo.test.ts`（新規）
- Test: `src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts`・`src/renderer/src/components/__tests__/App.agentChanges.test.tsx`（L83-84 の偽物の戻り値）

**Interfaces:**
- Consumes: Task 5 の `agentChangesApi.undoAgentChangesRevert`・戻す系の戻り値の型・偽物（`makeAgentChangesUndoSummary`・`makeAgentRevertResult`・`makeAgentRevertAllResult`・`makeAgentChangesUndoResult`）、Task 6 の `AgentChangesWriteRunner`・`AGENT_CHANGES_BUSY_UNDOING`
- Produces:
```ts
// src/renderer/src/types.ts
| { kind: 'recording'; startedAt: number; runs: AgentChangesRun[]; list: AgentChangesViewList | null; undo: AgentChangesUndoSummary | null }
// src/renderer/src/hooks/useAgentChanges.ts
interface AgentChangesController {
  /** 戻す・取り消しの結果の控えの要約を写しへ反映する。startedAt は依頼の時点の写しの記録の開始の時刻(違えば捨てる) */
  applyUndoSummary: (summary: AgentChangesUndoSummary | null, startedAt: number) => void
}
// src/renderer/src/lib/agentChangesMessages.ts
export const AGENT_REVERT_UNDOABLE_NOTE = '戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。'
export const AGENT_REVERT_DIRECTORY_NOT_UNDOABLE_NOTE = 'フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。'
export const AGENT_UNDO_UNAVAILABLE_REASON_TEXT: Record<AgentRevertUndoUnavailableReason, string>
export const AGENT_CHANGES_UNDO_BUTTON = '戻した操作を取り消す'
export function formatAgentChangesRevertedNotice(count: number, undo: AgentRevertUndoOutcome): string
export function formatAgentChangesHunkRevertedNotice(undo: AgentRevertUndoOutcome): string
export function formatAgentRevertPartialWarning(message: string, revertedCount: number, undo: AgentRevertUndoOutcome): string
export function formatAgentChangesUndoTarget(summary: AgentChangesUndoSummary): string
export function formatAgentChangesUndoBandText(target: string): string
export function formatAgentChangesUndoButtonLabel(target: string): string
export function buildAgentUndoConfirmMessage(options: { summary: AgentChangesUndoSummary; hasUnsavedEdits: boolean; agentRunning: boolean }): string
export function formatAgentChangesUndoneNotice(count: number): string
export function buildAgentRevertAllConfirmMessage(options: { count: number; trashCount: number; hasDirectory: boolean; savedInApp: boolean; agentRunning: boolean }): string
// （AGENT_CHANGES_HUNK_REVERTED_NOTICE は消す）
// src/renderer/src/lib/agentChangesAvailability.ts
export function agentUndoDisabledReason(availability: Pick<AgentRevertAvailability, 'runningOperation' | 'isGitBusy'>): string | null
// src/renderer/src/hooks/useAgentChangesUndo.ts
export interface AgentChangesUndoOptions {
  folderPath: string | null
  changes: Pick<AgentChangesController, 'view' | 'refresh' | 'announce' | 'applyUndoSummary'>
  runner: AgentChangesWriteRunner
  fileLock: FileOperationLock
  agentRunning: boolean
  hasDirtyTabAtOrInside: (absolutePath: string) => boolean
  reloadOpenFile: (absolutePath: string) => Promise<void>
  closeTabsAtOrInside: (absolutePath: string) => void
  refreshTree: () => Promise<unknown>
  refreshGitStatus: () => Promise<void>
  refreshDiff: () => void
  onConfirm?: (message: string) => boolean
}
export interface AgentChangesUndoState {
  /** 写しの控えの要約(帯に出す。記録中でなければ null) */
  summary: AgentChangesUndoSummary | null
  /** 取り消しのボタンを押せない理由(押せるなら null) */
  undoDisabledReason: string | null
  undoLastRevert: () => Promise<void>
}
export function useAgentChangesUndo(options: AgentChangesUndoOptions): AgentChangesUndoState
// src/renderer/src/__tests__/makeAgentChangesState.ts
export function makeAgentChangesUndoState(overrides?: Partial<AgentChangesUndoState>): AgentChangesUndoState // 既定 { summary: null, undoDisabledReason: null, undoLastRevert: vi.fn(async () => undefined) }
// makeAgentChangesRecordingView・makeAgentChangesScopeUnavailableView の overrides に undo?: AgentChangesUndoSummary | null(既定 null)
```

- [ ] **Step 1: 文言と可否の失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`（既存の「この操作は元に戻せません。」を含む期待値と `formatAgentChangesRevertedNotice(1)`・`AGENT_CHANGES_HUNK_REVERTED_NOTICE` の期待値を、下の新しい文言に直す）に足す:
```ts
describe('取り消し', () => {
  const saved = { kind: 'saved' } as const
  it.each([
    [{ kind: 'unavailable', reason: 'directory' }, 'フォルダを含む'],
    [{ kind: 'unavailable', reason: 'unsupported-type' }, 'ファイル以外のものを含む'],
    [{ kind: 'unavailable', reason: 'too-large' }, '内容が大きすぎる'],
    [{ kind: 'unavailable', reason: 'capture-failed' }, '戻した後の状態を控えられなかった']
  ] as const)('戻した結果: 取れなかった理由 %j → %s', (undo, reason) => {
    expect(formatAgentChangesRevertedNotice(2, undo)).toBe(
      `2 件を実行前の状態に戻しました。${reason}ため、この操作は取り消せません`
    )
    expect(formatAgentChangesHunkRevertedNotice(undo)).toBe(
      `ハンクを実行前の状態に戻しました。${reason}ため、この操作は取り消せません`
    )
    expect(formatAgentRevertPartialWarning('途中で失敗', 1, undo)).toBe(
      `途中で失敗。${reason}ため、戻せた 1 件は取り消せません`
    )
  })
  it('戻した結果: 取れた', () => {
    expect(formatAgentChangesRevertedNotice(1, saved)).toBe(
      '1 件を実行前の状態に戻しました。「戻した操作を取り消す」で取り消せます'
    )
    expect(formatAgentChangesHunkRevertedNotice(saved)).toBe(
      'ハンクを実行前の状態に戻しました。ソース管理の「エージェントの変更」で取り消せます'
    )
    expect(formatAgentRevertPartialWarning('途中で失敗', 1, saved)).toBe(
      '途中で失敗。戻せた 1 件は「戻した操作を取り消す」で取り消せます'
    )
  })
  it('対象の文言は operation で決まる(all は 1 件でも「すべて戻す」)', () => {
    expect(formatAgentChangesUndoTarget(makeAgentChangesUndoSummary({ operation: 'file' }))).toBe('a.txt')
    expect(formatAgentChangesUndoTarget(makeAgentChangesUndoSummary({ operation: 'hunk' }))).toBe('a.txt のハンク')
    expect(formatAgentChangesUndoTarget(makeAgentChangesUndoSummary({ operation: 'all' }))).toBe('1 件（すべて戻す）')
    expect(
      formatAgentChangesUndoTarget(
        makeAgentChangesUndoSummary({
          operation: 'all',
          entries: [
            { path: 'a.txt', action: 'rewrite' },
            { path: 'b.txt', action: 'trash' },
            { path: 'c.txt', action: 'recreate' }
          ]
        })
      )
    ).toBe('3 件（すべて戻す）')
    expect(formatAgentChangesUndoBandText('a.txt')).toBe('直前に戻した操作: a.txt')
    expect(formatAgentChangesUndoButtonLabel('a.txt')).toBe('直前に戻した操作（a.txt）を取り消す')
    expect(formatAgentChangesUndoneNotice(3)).toBe('戻した操作を取り消しました（3 件）')
  })
  it('取り消しの確認: パスの一覧と、該当するときだけの追記', () => {
    expect(
      buildAgentUndoConfirmMessage({
        summary: makeAgentChangesUndoSummary(),
        hasUnsavedEdits: false,
        agentRunning: false
      })
    ).toBe('直前に戻した操作を取り消しますか？次のファイルが、戻す前の内容に戻ります。\n\na.txt')
    const entries = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name, index) => ({
      path: `${name}.txt`,
      action: index === 0 ? ('trash' as const) : index === 1 ? ('recreate' as const) : ('rewrite' as const)
    }))
    expect(
      buildAgentUndoConfirmMessage({
        summary: makeAgentChangesUndoSummary({ operation: 'all', entries }),
        hasUnsavedEdits: true,
        agentRunning: true
      })
    ).toBe(
      '直前に戻した操作を取り消しますか？次のファイルが、戻す前の内容に戻ります。\n\na.txt\nb.txt\nc.txt\nd.txt\ne.txt\nほか 2 件' +
        '\n\nうち 1 件は、戻したときに作り直したファイルのため、ゴミ箱へ移動します。' +
        '\n\nゴミ箱へ移したファイルは、ゴミ箱に残したまま元の場所に作り直します。' +
        '\n\nエディタの未保存の編集も破棄されます。' +
        '\n\nエージェントが動いている間は、取り消した後に同じファイルが書き換えられることがあります。'
    )
  })
  it('戻す確認の文言は取り消せる旨を出し、フォルダは取り消せない旨を出す', () => {
    const none = { savedInApp: false, hasUnsavedEdits: false, agentRunning: false }
    expect(buildAgentRevertFileConfirmMessage({ path: 'a.txt', status: 'M', isDirectory: false, ...none })).toBe(
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。'
    )
    expect(buildAgentRevertFileConfirmMessage({ path: 'z.txt', status: 'A', isDirectory: false, ...none })).toBe(
      'z.txt をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。'
    )
    expect(buildAgentRevertFileConfirmMessage({ path: 'nd/', status: 'A', isDirectory: true, ...none })).toBe(
      'nd/ をゴミ箱へ移動しますか？フォルダとその中身（.gitignore の対象を含む）がすべて移動します。フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。'
    )
    expect(buildAgentRevertHunkConfirmMessage({ path: 'a.txt', hunkHeader: '@@ -1 +1 @@', ...none })).toBe(
      'a.txt の次のハンクを実行前の状態に戻しますか？戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。\n\n@@ -1 +1 @@'
    )
    const all = { count: 2, trashCount: 1, savedInApp: false, agentRunning: false }
    expect(buildAgentRevertAllConfirmMessage({ ...all, hasDirectory: false })).toBe(
      'エージェントの変更 2 件を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。\nうち 1 件の新しいファイル・フォルダはゴミ箱へ移動します。\nステージ（index）・コミット・ブランチは戻しません。'
    )
    expect(buildAgentRevertAllConfirmMessage({ ...all, hasDirectory: true })).toContain(
      '戻ります。フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。\nうち 1 件'
    )
  })
})
```
（import に `makeAgentChangesUndoSummary` と新しい関数を足す）

`src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts` に足す:
```ts
describe('agentUndoDisabledReason', () => {
  it.each([
    [null, false, null],
    [null, true, AGENT_CHANGES_BUSY_GIT],
    ['revert', false, AGENT_CHANGES_BUSY_REVERTING],
    ['revert', true, AGENT_CHANGES_BUSY_REVERTING],
    ['undo', false, AGENT_CHANGES_BUSY_UNDOING],
    ['undo', true, AGENT_CHANGES_BUSY_UNDOING]
  ] as const)('実行中 %s・他の Git 操作 %s → %s(押せないなら必ず理由。パターン 126)', (runningOperation, isGitBusy, expected) => {
    expect(agentUndoDisabledReason({ runningOperation, isGitBusy })).toBe(expected)
  })
})
```
Run: `npx vitest run src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts`
Expected: FAIL

- [ ] **Step 2: 文言と可否を実装する**

`src/renderer/src/lib/agentChangesMessages.ts`:
- import に `AgentChangesUndoSummary`・`AgentRevertUndoOutcome`・`AgentRevertUndoUnavailableReason` を足す
- `formatAgentChangesRevertedNotice`（L140-143）と `AGENT_CHANGES_HUNK_REVERTED_NOTICE`（L145-146）を置き換える:
```ts
/** 戻す確認の取り消せる旨(大きさの上限は main でしか分からないため、結果で伝える) */
export const AGENT_REVERT_UNDOABLE_NOTE =
  '戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。'
/** 戻す確認の取り消せない旨(追加されたフォルダ。renderer で先に分かる) */
export const AGENT_REVERT_DIRECTORY_NOT_UNDOABLE_NOTE =
  'フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。'
/** 控えが取れなかった理由(結果の読み上げ。L-057) */
export const AGENT_UNDO_UNAVAILABLE_REASON_TEXT: Record<AgentRevertUndoUnavailableReason, string> = {
  directory: 'フォルダを含む',
  'unsupported-type': 'ファイル以外のものを含む',
  'too-large': '内容が大きすぎる',
  'capture-failed': '戻した後の状態を控えられなかった'
}
const UNDO_HINT = '「戻した操作を取り消す」で取り消せます'
const notUndoable = (undo: Extract<AgentRevertUndoOutcome, { kind: 'unavailable' }>): string =>
  `${AGENT_UNDO_UNAVAILABLE_REASON_TEXT[undo.reason]}ため、この操作は取り消せません`

/** 戻した後の読み上げ(取り消せるか・取り消せない理由を添える) */
export function formatAgentChangesRevertedNotice(count: number, undo: AgentRevertUndoOutcome): string {
  const base = `${count} 件を実行前の状態に戻しました。`
  return undo.kind === 'saved' ? `${base}${UNDO_HINT}` : `${base}${notUndoable(undo)}`
}

/** diff タブでハンクを戻した後の読み上げ(帯が見えていないときにも、どこで取り消すかを伝える) */
export function formatAgentChangesHunkRevertedNotice(undo: AgentRevertUndoOutcome): string {
  const base = 'ハンクを実行前の状態に戻しました。'
  return undo.kind === 'saved'
    ? `${base}ソース管理の「エージェントの変更」で取り消せます`
    : `${base}${notUndoable(undo)}`
}

/** すべて戻すの partial の警告(main の警告の後ろに、戻せた件数を取り消せるかを足す) */
export function formatAgentRevertPartialWarning(
  message: string,
  revertedCount: number,
  undo: AgentRevertUndoOutcome
): string {
  return undo.kind === 'saved'
    ? `${message}。戻せた ${revertedCount} 件は${UNDO_HINT}`
    : `${message}。${AGENT_UNDO_UNAVAILABLE_REASON_TEXT[undo.reason]}ため、戻せた ${revertedCount} 件は取り消せません`
}

/** 帯のボタンの見える文字 */
export const AGENT_CHANGES_UNDO_BUTTON = '戻した操作を取り消す'

/** 帯の対象(戻した操作の種類で決める。all は件数に関わらず「すべて戻す」) */
export function formatAgentChangesUndoTarget(summary: AgentChangesUndoSummary): string {
  const first = summary.entries[0]?.path ?? ''
  switch (summary.operation) {
    case 'all':
      return `${summary.entries.length} 件（すべて戻す）`
    case 'hunk':
      return `${first} のハンク`
    case 'file':
      return first
    default: {
      const unknownOperation: never = summary.operation
      throw new Error(`未知の戻した操作の種類です: ${JSON.stringify(unknownOperation)}`)
    }
  }
}

export function formatAgentChangesUndoBandText(target: string): string {
  return `直前に戻した操作: ${target}`
}

export function formatAgentChangesUndoButtonLabel(target: string): string {
  return `直前に戻した操作（${target}）を取り消す`
}

const MAX_UNDO_LISTED_PATHS = 5

/** 取り消しの確認(何が戻るかを見せる。押し間違いの取り消しをさらに押し間違えない) */
export function buildAgentUndoConfirmMessage({
  summary,
  hasUnsavedEdits,
  agentRunning
}: {
  summary: AgentChangesUndoSummary
  /** 書き戻す・ゴミ箱へ移すパスのタブに未保存の編集があるか */
  hasUnsavedEdits: boolean
  agentRunning: boolean
}): string {
  const paths = summary.entries.map((entry) => entry.path)
  const rest = paths.length - MAX_UNDO_LISTED_PATHS
  const listed = [...paths.slice(0, MAX_UNDO_LISTED_PATHS), ...(rest > 0 ? [`ほか ${rest} 件`] : [])]
  const trashCount = summary.entries.filter((entry) => entry.action === 'trash').length
  const hasRecreate = summary.entries.some((entry) => entry.action === 'recreate')
  const appendix = [
    trashCount > 0
      ? `うち ${trashCount} 件は、戻したときに作り直したファイルのため、ゴミ箱へ移動します。`
      : null,
    hasRecreate ? 'ゴミ箱へ移したファイルは、ゴミ箱に残したまま元の場所に作り直します。' : null,
    hasUnsavedEdits ? 'エディタの未保存の編集も破棄されます。' : null,
    agentRunning
      ? 'エージェントが動いている間は、取り消した後に同じファイルが書き換えられることがあります。'
      : null
  ]
    .filter((text): text is string => text !== null)
    .map((text) => `\n\n${text}`)
    .join('')
  return `直前に戻した操作を取り消しますか？次のファイルが、戻す前の内容に戻ります。\n\n${listed.join('\n')}${appendix}`
}

/** 取り消しの結果の読み上げ */
export function formatAgentChangesUndoneNotice(count: number): string {
  return `戻した操作を取り消しました（${count} 件）`
}
```
- `buildAgentRevertFileConfirmMessage` の `base` を次にする:
```ts
  const base =
    status !== 'A'
      ? `${path} を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。${AGENT_REVERT_UNDOABLE_NOTE}`
      : isDirectory
        ? `${path} をゴミ箱へ移動しますか？フォルダとその中身（.gitignore の対象を含む）がすべて移動します。${AGENT_REVERT_DIRECTORY_NOT_UNDOABLE_NOTE}`
        : `${path} をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）${AGENT_REVERT_UNDOABLE_NOTE}`
```
- `buildAgentRevertHunkConfirmMessage` の `この操作は元に戻せません。` を `${AGENT_REVERT_UNDOABLE_NOTE}` にする
- `buildAgentRevertAllConfirmMessage` の引数に `hasDirectory: boolean`（JSDoc `/** 追加されたフォルダの行を含むか(取り消せない旨を出す) */`）を足し、`この操作は元に戻せません。` を `${hasDirectory ? AGENT_REVERT_DIRECTORY_NOT_UNDOABLE_NOTE : AGENT_REVERT_UNDOABLE_NOTE}` にする

`src/renderer/src/lib/agentChangesAvailability.ts` の末尾に足す:
```ts
/**
 * 「戻した操作を取り消す」を押せない理由(押せるなら null)。戻す操作・取り消しの実行中と、他の Git 操作の実行中の 2 つだけ
 * (取り消しは一覧を使わないため、一覧の取得中・失敗では押せる)
 */
export function agentUndoDisabledReason(
  availability: Pick<AgentRevertAvailability, 'runningOperation' | 'isGitBusy'>
): string | null {
  if (availability.runningOperation === 'revert') return AGENT_CHANGES_BUSY_REVERTING
  if (availability.runningOperation === 'undo') return AGENT_CHANGES_BUSY_UNDOING
  if (availability.isGitBusy) return AGENT_CHANGES_BUSY_GIT
  return null
}
```
Run: `npx vitest run src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts`
Expected: PASS

- [ ] **Step 3: 写しの `undo` の失敗するテストを書く**

`src/renderer/src/__tests__/makeAgentChangesState.ts`: `makeAgentChangesRecordingView` の overrides に `undo?: AgentChangesUndoSummary | null` を足して `{ startedAt = 100, runs = [], scope = { kind: 'all' }, undo = null, ...listOverrides }` で結果に `undo` を入れ、`makeAgentChangesScopeUnavailableView` の overrides にも `undo?` を足す（`makeAgentChangesRecordingState(overrides)` から写る）。`makeAgentChangesController` に `applyUndoSummary: vi.fn<AgentChangesController['applyUndoSummary']>()` を足す。`makeAgentChangesUndoState` を足す:
```ts
/** useAgentChangesUndo の戻り値。既定は控えなし・押せる */
export function makeAgentChangesUndoState(
  overrides: Partial<AgentChangesUndoState> = {}
): AgentChangesUndoState {
  return {
    summary: null,
    undoDisabledReason: null,
    undoLastRevert: vi.fn<AgentChangesUndoState['undoLastRevert']>(async () => undefined),
    ...overrides
  }
}
```
（`import type { AgentChangesUndoState } from '../hooks/useAgentChangesUndo'`。hook のファイルは Step 6 で作るため、それまでは型だけ未解決）

`src/renderer/src/lib/__tests__/agentChangesView.test.ts`（view の `toEqual` の期待値〈5 か所〉に `undo: null` を足す）に足す:
1. `planRecordingState(previous, makeAgentChangesRecordingState({ undo: summary }), ALL)` の `view.undo` が `summary`（`summary = makeAgentChangesUndoSummary()`）
2. `planListResult(makeAgentChangesListResult([], { undo: summary }), previous)` の `view.undo` が `summary`。`makeAgentChangesScopeUnavailableListResult(RUN, 'end-not-recorded', { undo: summary })` の `view.undo` も `summary`
3. `isSameAgentChangesView(makeAgentChangesRecordingView([]), makeAgentChangesRecordingView([], { undo: summary }))` が `false`、同じ `undo` どうしは `true`（L-423）

`src/renderer/src/hooks/__tests__/useAgentChanges.test.ts`（view の `toEqual` の期待値〈11 か所のうち該当するもの〉に `undo: null` を足す）に describe `'取り消しの控えの写し'` を足す:
1. `getAgentChangesState` が `makeAgentChangesRecordingState({ undo: summary })` を返すと `view.undo` が `summary`
2. 一覧の取り直しの結果の `undo` を写す（`listAgentChanges` が `makeAgentChangesListResult([], { undo: summary })`）
3. `applyUndoSummary(summary, 100)`（写しの `startedAt` が 100）で `view.undo` が `summary` になり、`applyUndoSummary(null, 100)` で `null`
4. `startedAt` が違う（`applyUndoSummary(summary, 999)`）・記録中でない（`clear` の後）なら捨てる（`view` は変わらない）
5. 戻す操作の結果の到着の前に確認を終えて新しい記録（`startedAt: 200`）を始めると、前の記録の `startedAt`（100）での `applyUndoSummary` は捨てられ、新しい記録に帯が出ない
6. 静かな取り直し（`refresh({ quiet: true })`）で、行が同じで `undo` だけが変わったときは写しを置き換え、`undo` も同じなら置き換えない（参照が同じ）

Run: `npx vitest run src/renderer/src/lib/__tests__/agentChangesView.test.ts src/renderer/src/hooks/__tests__/useAgentChanges.test.ts`
Expected: FAIL

- [ ] **Step 4: 写しの `undo` を実装する**

`src/renderer/src/types.ts`: import に `AgentChangesUndoSummary` を足し、`AgentChangesView` の `recording` を次にする:
```ts
  /** runs は main の実行の一覧(古い順)。list は取り直す前・範囲を変えた直後は null。undo は main の取り消しの控えの要約(無ければ null) */
  | {
      kind: 'recording'
      startedAt: number
      runs: AgentChangesRun[]
      list: AgentChangesViewList | null
      undo: AgentChangesUndoSummary | null
    }
```
`src/renderer/src/lib/agentChangesView.ts`: `planRecordingState` の `view` に `undo: state.undo`、`planListResult` の `base` に `undo: result.undo`、`listed` の `view` に `undo: result.undo` を足す（分割代入に `undo` を足す）。

`src/renderer/src/hooks/useAgentChanges.ts`:
- import に `AgentChangesUndoSummary` を足し、`isSameAgentChangesView` は既に import 済み
- `AgentChangesController` の `announce` の後に Interfaces の `applyUndoSummary` を足す
- `markSaved` の後に実装を足し、戻り値に `applyUndoSummary` を足す:
```ts
  // 戻す・取り消しの結果の控えの要約を写しへ反映する(一覧の取り直しを待たずに、main に無い undoId の帯を押せなくする。L-039)。
  // 依頼の時点の記録(startedAt)と今の写しが違えば捨てる(前の記録の帯を新しい記録に出さない)
  const applyUndoSummary = useCallback(
    (summary: AgentChangesUndoSummary | null, startedAt: number): void => {
      const current = viewRef.current
      if (current.kind !== 'recording' || current.startedAt !== startedAt) return
      const next = { ...current, undo: summary }
      if (!isSameAgentChangesView(current, next)) applyView(next)
    },
    [applyView]
  )
```

Run: `npx vitest run src/renderer/src/lib/__tests__/agentChangesView.test.ts src/renderer/src/hooks/__tests__/useAgentChanges.test.ts`
Expected: PASS

- [ ] **Step 5: 取り消しの hook と戻す操作の結果の反映の失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAgentChangesUndo.test.ts`（`vi.mock('../../lib/agentChangesApi')`。runner は本物と組にする: `function useUndoWithRunner(options: Omit<AgentChangesUndoOptions, 'runner'>): AgentChangesUndoState & { runner: AgentChangesWriteRunner }` を Task 6 の `useRevertWithRunner` と同じ形で作り、runner も返す。`makeOptions` は `changes: makeAgentChangesController({ view: makeAgentChangesRecordingView([], { startedAt: 1, undo: makeAgentChangesUndoSummary() }) })`・`fileLock: makeLock()`・`onConfirm: vi.fn(() => true)`・タブとツリーの操作は `vi.fn`。`beforeEach` で `vi.mocked(agentChangesApi.undoAgentChangesRevert).mockResolvedValue(makeAgentChangesUndoResult())`）。ケース:
1. `summary` は写しの `undo`、`undoDisabledReason` は `null`。他の Git 操作の実行中（`isAnyLocked` が true）は `AGENT_CHANGES_BUSY_GIT`
2. キャンセル（`onConfirm` が false）なら IPC を呼ばず、ロックも取らない。確認の文言は `buildAgentUndoConfirmMessage({ summary, hasUnsavedEdits: false, agentRunning: false })`
3. 未保存の編集は `rewrite`・`trash` のパスだけで判定する（`entries` が `[{ path: 'a.txt', action: 'recreate' }, { path: 'b.txt', action: 'rewrite' }]`、`hasDirtyTabAtOrInside` が `/repo/b.txt` だけ true → 確認に `エディタの未保存の編集も破棄されます。`。`/repo/a.txt` だけ true なら含まない）
4. 写しに控えが無い（`undo: null`）・記録中でない → 確認も IPC も呼ばない（L-058）
5. 成功: `undoAgentChangesRevert(1)` を呼び、結果の `undoSummary` を `applyUndoSummary(null, 1)` で反映し、その呼び出しが `fileLock.unlockGlobal` より前（`invocationCallOrder`）。`restoredPaths: ['a.txt']` → `reloadOpenFile('/repo/a.txt')`、`trashedPaths: ['b.txt']` → `closeTabsAtOrInside('/repo/b.txt')`、`changes.announce('戻した操作を取り消しました（2 件）')`、`refreshTree`・`refreshGitStatus`・`changes.refresh`・`refreshDiff` を 1 回ずつ
6. `partial`: `makeAgentChangesUndoResult` の代わりに `{ status: 'partial', message: '取り消しが途中で失敗しました（1 / 2 件を取り消し済み）: b.txt: x', restoredPaths: ['a.txt'], trashedPaths: [], undoSummary: null }` → `reloadOpenFile` の後に runner の `error` が `{ message: <その文言>, path: null, source: 'undo' }`、`announce` は呼ばない
7. 失敗: IPC が `取り消せる操作が変わりました。一覧を更新してください` で reject → `applyUndoSummary(null, 1)` を `unlockGlobal` より前に呼び、runner の `error.message` がその文言、タブの読み直しはしない、取り直しは行う
8. 実行中は 2 回目を呼ばない（同じ描画の中で `undoLastRevert()` を 2 回 → IPC は 1 回）。実行中の `undoDisabledReason` は `AGENT_CHANGES_BUSY_UNDOING`、戻す操作の実行中（runner に `run('file', ...)` を待たせる）は `AGENT_CHANGES_BUSY_REVERTING`

`src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`:
- `makeOptions` の写しの `startedAt` は 1 のまま。新しい期待値:
  1. ファイルを戻す成功: `changes.applyUndoSummary` が `(makeAgentChangesUndoSummary(), 1)` で `unlockGlobal` より前に呼ばれ、読み上げが `1 件を実行前の状態に戻しました。「戻した操作を取り消す」で取り消せます`
  2. 控えが取れなかった結果（`makeAgentRevertResult({ undo: { kind: 'unavailable', reason: 'too-large' }, undoSummary: null })`）の読み上げが `1 件を実行前の状態に戻しました。内容が大きすぎるため、この操作は取り消せません`、`applyUndoSummary(null, 1)`
  3. 失敗（reject）: `applyUndoSummary(null, 1)` を `unlockGlobal` より前に呼ぶ
  4. ハンクの成功の `hunkNotice.text` が `ハンクを実行前の状態に戻しました。ソース管理の「エージェントの変更」で取り消せます`
  5. すべて戻すの `partial`（`makeAgentRevertAllResult({ status: 'partial', message: 'すべて戻すが途中で失敗しました（1 / 2 件を戻し済み）: x', revertedCount: 1 })`）の `error` が `すべて戻すが途中で失敗しました（1 / 2 件を戻し済み）: x。戻せた 1 件は「戻した操作を取り消す」で取り消せます`。`undo` が `{ kind: 'unavailable', reason: 'capture-failed' }` なら `…: x。戻した後の状態を控えられなかったため、戻せた 1 件は取り消せません`
  6. すべて戻すの確認: フォルダの行（`makeAgentChangeEntry('nd/', { status: 'A', isDirectory: true })`）を含む一覧なら、確認に `フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。` が含まれる
- 既存の期待値の `'1 件を実行前の状態に戻しました'`・`AGENT_CHANGES_HUNK_REVERTED_NOTICE`・追加されたフォルダの確認の文言（L117-119）を新しい文言に直す（偽物の既定は `makeAgentRevertResult()` で控えが取れた結果）

`src/renderer/src/components/__tests__/App.agentChanges.test.tsx` の L83-84 を `vi.fn().mockResolvedValue(makeAgentRevertResult())` にする（import に `makeAgentRevertResult`）。

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesUndo.test.ts src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`
Expected: FAIL

- [ ] **Step 6: 取り消しの hook と戻す操作の結果の反映を実装する**

`src/renderer/src/hooks/useAgentChangesUndo.ts`:
```ts
import type { AgentChangesUndoSummary } from '@shared/types'
import * as agentChangesApi from '../lib/agentChangesApi'
import { agentUndoDisabledReason } from '../lib/agentChangesAvailability'
import {
  buildAgentUndoConfirmMessage,
  formatAgentChangesUndoneNotice
} from '../lib/agentChangesMessages'
import { agentChangeAbsolutePath } from '../lib/agentChangesPaths'
import type { AgentChangesController } from './useAgentChanges'
import type { AgentChangesWriteRunner } from './useAgentChangesWriteRunner'
import type { FileOperationLock } from './useFileOperationLock'

// 直前の戻す操作の取り消し(設計書「取り消しの hook」)。帯に出す控えは写し(main の値)から読み、renderer で別の状態を持たない
// (L-040)。押せるか → 確認 → 実行の共有で依頼(結果の undoSummary を実行中の印を下ろす前に写しへ反映。L-039)→ 成功・partial なら
// 書き戻したパスのタブを読み直し、ゴミ箱へ移したパスのタブを閉じる(main の結果で決める。L-001・L-008)→ 成功・失敗のどちらでも取り直す

export interface AgentChangesUndoOptions {
  folderPath: string | null
  changes: Pick<AgentChangesController, 'view' | 'refresh' | 'announce' | 'applyUndoSummary'>
  /** 戻す操作と共有する実行(useAgentChangesWriteRunner) */
  runner: AgentChangesWriteRunner
  /** 他の Git 操作と共有するロック(isAnyLocked なら押せない) */
  fileLock: FileOperationLock
  /** エージェントのセッションが動いているか(確認の文言に足す) */
  agentRunning: boolean
  hasDirtyTabAtOrInside: (absolutePath: string) => boolean
  reloadOpenFile: (absolutePath: string) => Promise<void>
  closeTabsAtOrInside: (absolutePath: string) => void
  refreshTree: () => Promise<unknown>
  refreshGitStatus: () => Promise<void>
  /** 開いている diff タブを取り直す(useDiffOperations.refreshDiff) */
  refreshDiff: () => void
  onConfirm?: (message: string) => boolean
}

export interface AgentChangesUndoState {
  summary: AgentChangesUndoSummary | null
  undoDisabledReason: string | null
  undoLastRevert: () => Promise<void>
}

export function useAgentChangesUndo({
  folderPath,
  changes,
  runner,
  fileLock,
  agentRunning,
  hasDirtyTabAtOrInside,
  reloadOpenFile,
  closeTabsAtOrInside,
  refreshTree,
  refreshGitStatus,
  refreshDiff,
  onConfirm = confirm
}: AgentChangesUndoOptions): AgentChangesUndoState {
  const view = changes.view
  const summary = view.kind === 'recording' ? view.undo : null
  const undoDisabledReason = agentUndoDisabledReason({
    runningOperation: runner.runningOperation,
    isGitBusy: fileLock.isAnyLocked()
  })

  const refreshAfter = async (): Promise<void> => {
    await refreshTree().catch(() => undefined)
    await refreshGitStatus().catch(() => undefined)
    await changes.refresh()
    refreshDiff()
  }

  const undoLastRevert = async (): Promise<void> => {
    // ボタンの disabled に加えた処理の側の守り(L-058)
    if (view.kind !== 'recording' || summary === null) return
    if (runner.isRunning() || undoDisabledReason !== null) return
    const startedAt = view.startedAt
    // 作り直すパス(今は無い)を除き、書き戻す・ゴミ箱へ移すパスのタブの未保存の編集を確かめる
    const hasUnsavedEdits = summary.entries.some((entry) => {
      if (entry.action === 'recreate') return false
      const absolutePath = agentChangeAbsolutePath(folderPath, entry.path)
      return absolutePath !== null && hasDirtyTabAtOrInside(absolutePath)
    })
    if (!onConfirm(buildAgentUndoConfirmMessage({ summary, hasUnsavedEdits, agentRunning }))) return
    const generation = runner.captureGeneration()
    // 帯に出した控えの undoId を渡す(main が今の控えと照合する。L-035)
    const outcome = await runner.run(
      'undo',
      null,
      () => agentChangesApi.undoAgentChangesRevert(summary.undoId),
      {
        onResult: (result) => changes.applyUndoSummary(result.undoSummary, startedAt),
        // 例外では main の控えが変わったかが分からないため、帯を隠して一覧の取り直しを待つ
        onError: () => changes.applyUndoSummary(null, startedAt)
      }
    )
    if (outcome.ok) {
      const { result } = outcome
      for (const path of result.restoredPaths) {
        const absolutePath = agentChangeAbsolutePath(folderPath, path)
        if (absolutePath !== null) await reloadOpenFile(absolutePath)
      }
      for (const path of result.trashedPaths) {
        const absolutePath = agentChangeAbsolutePath(folderPath, path)
        if (absolutePath !== null) closeTabsAtOrInside(absolutePath)
      }
      // partial は読み直しの後に警告を出す(パターン 52)
      if (result.status === 'partial') runner.showWarning(result.message, 'undo', generation)
      else {
        changes.announce(
          formatAgentChangesUndoneNotice(result.restoredPaths.length + result.trashedPaths.length)
        )
      }
    }
    await refreshAfter()
  }

  return { summary, undoDisabledReason, undoLastRevert }
}
```

`src/renderer/src/hooks/useAgentChangesRevert.ts`:
- `AgentChangesRevertOptions.changes` の `Pick` に `'applyUndoSummary'` を足す
- import の `formatAgentChangesRevertedNotice`・`AGENT_CHANGES_HUNK_REVERTED_NOTICE` を `formatAgentChangesHunkRevertedNotice`・`formatAgentChangesRevertedNotice`・`formatAgentRevertPartialWarning` にする
- `IGNORE_RESULT` を消し、写しの記録の開始の時刻を返す補助と、結果を写しへ反映する hooks を作る関数を hook の中に足す:
```ts
  // 依頼の時点の写しの記録の開始の時刻(結果を写しへ反映するときに照合する)
  const startedAtNow = (): number | null =>
    changes.view.kind === 'recording' ? changes.view.startedAt : null
  // 結果の控えの要約を、実行中の印を下ろす前に写しへ反映する。例外では帯を隠す(L-039)。
  // 型引数は run の結果の型(すべて戻すの status を失わないよう、run の推論を execute の戻り値に任せる)
  const undoSummaryHooks = <T extends AgentRevertResult>(
    startedAt: number
  ): AgentChangesWriteHooks<T> => ({
    onResult: (result) => changes.applyUndoSummary(result.undoSummary, startedAt),
    onError: () => changes.applyUndoSummary(null, startedAt)
  })
```
  （import に `import type { AgentRevertResult } from '@shared/types'` と `import type { AgentChangesWriteHooks } from './useAgentChangesWriteRunner'`。呼び出しは `undoSummaryHooks<AgentRevertResult>(startedAt)`・`undoSummaryHooks<AgentRevertAllResult>(startedAt)` と型引数を書く〈`AgentRevertAllResult` も import する〉）
- `revertFile`: 確認の前に `const startedAt = startedAtNow(); if (startedAt === null) return` を足し、`runner.run('file', entry.path, () => agentChangesApi.revertAgentChange(entry.path, list.scope), undoSummaryHooks(startedAt))`（`async () => { await ... }` の包みを外して結果を返す）、成功の読み上げを `changes.announce(formatAgentChangesRevertedNotice(1, outcome.result.undo))` にする
- `revertHunk`: 同じく `startedAt` を控え、`{ ...undoSummaryHooks(startedAt), onFailure: announceHunk }`、成功の読み上げを `announceHunk(formatAgentChangesHunkRevertedNotice(outcome.result.undo))` にする
- `revertAll`: 同じく `startedAt` を控え、確認の引数に `hasDirectory: list.entries.some((entry) => entry.isDirectory)` を足し、`runner.run('all', null, () => agentChangesApi.revertAllAgentChanges(expected, list.scope), undoSummaryHooks(startedAt))`、`partial` を `runner.showWarning(formatAgentRevertPartialWarning(outcome.result.message, outcome.result.revertedCount, outcome.result.undo), 'all', generation)`、成功の読み上げを `changes.announce(formatAgentChangesRevertedNotice(expected.length, outcome.result.undo))` にする

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesUndo.test.ts src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`
Expected: PASS

- [ ] **Step 7: テスト・型・lint**

Run: `npx vitest run src/renderer/src/lib src/renderer/src/hooks src/renderer/src/__tests__ src/renderer/src/components/__tests__/App.agentChanges.test.tsx src/renderer/src/components/source-control`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS（view を作るテストの値で `undo` が足りないと型で落ちる。`grep -rn "kind: 'recording'" src/renderer/src --include='*.test.ts' --include='*.test.tsx'` で拾い、view の値〈`list` を持つもの〉に `undo: null` を足す）
Run: このタスクの **Files** に挙げた `.ts`・`.tsx` のファイル（作成・変更・テスト）をすべて並べて `npx eslint --fix <ファイル…> && npx eslint --max-warnings 0 <ファイル…>`
Expected: エラー・警告なし

---

### Task 8: セクションの帯と配線（`AgentChangesUndoBand`・`AgentChangesSection`・`useAgentChangesWiring`・CSS）

**Files:**
- Create: `src/renderer/src/components/source-control/AgentChangesUndoBand.tsx`
- Modify: `src/renderer/src/components/source-control/AgentChangesSection.tsx`（props の分割代入に `undo`、`undoReasonId`、帯の配置〈範囲の選択 L161-173 の直後〉、範囲の選択の `disabledReasonId`、`確認を終える` の `aria-describedby` L259-261、帯の無いときの理由の要素）
- Modify: `src/renderer/src/hooks/useAgentChangesWiring.ts`（`AgentChangesPanelState` に `undo`、`useAgentChangesUndo` の組み立て、パネルの値）
- Modify: `src/renderer/src/assets/main.css`（`.agent-changes__scope-select:disabled` L1708-1711 の後に `.agent-changes__undo` など）
- Modify: `src/renderer/src/__tests__/makeAgentChangesState.ts`（`makeAgentChangesPanelState` の既定に `undo: makeAgentChangesUndoState()`）
- Test: `src/renderer/src/components/source-control/__tests__/AgentChangesUndoBand.test.tsx`（新規）・`AgentChangesUndoBand.styles.test.tsx`（新規）・`AgentChangesSection.test.tsx`
- Test: `src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts`（`useAgentChangesUndo` の偽物と渡す値）
- Test: `src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`（本物の hook どうしの結合テスト）
- Test: `src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts`（パネルの既定値）

**Interfaces:**
- Consumes: Task 7 の `useAgentChangesUndo`・`AgentChangesUndoState`・`makeAgentChangesUndoState`・`formatAgentChangesUndoTarget`・`formatAgentChangesUndoBandText`・`formatAgentChangesUndoButtonLabel`・`AGENT_CHANGES_UNDO_BUTTON`、Task 6 の `useAgentChangesWriteRunner`（wiring で作った `runner`）、`useAgentChangesSectionFocus` の `reserveFocusRestore`
- Produces:
```ts
// src/renderer/src/components/source-control/AgentChangesUndoBand.tsx
export interface AgentChangesUndoBandProps {
  summary: AgentChangesUndoSummary
  /** 押せない理由(押せるなら null。帯の中に見える文字で出し aria-describedby で結ぶ) */
  disabledReason: string | null
  /** 理由の要素の id(セクションが useId で作る。押せない確認を終える・範囲の選択もこの要素を指すことがある) */
  reasonId: string
  /** 押したとき(セクションがフォーカスの予約と取り消しを行う) */
  onUndo: () => void
}
export default function AgentChangesUndoBand(props: AgentChangesUndoBandProps): React.JSX.Element
// src/renderer/src/hooks/useAgentChangesWiring.ts
export interface AgentChangesPanelState { /* 既存 */ undo: AgentChangesUndoState }
```

- [ ] **Step 1: 帯の失敗するテストを書く**

`src/renderer/src/components/source-control/__tests__/AgentChangesUndoBand.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgentChangesUndoBand from '../AgentChangesUndoBand'
import { makeAgentChangesUndoSummary } from '../../../__tests__/makeAgentChangesState'

const renderBand = (disabledReason: string | null = null): { onUndo: ReturnType<typeof vi.fn> } => {
  const onUndo = vi.fn()
  render(
    <AgentChangesUndoBand
      summary={makeAgentChangesUndoSummary()}
      disabledReason={disabledReason}
      reasonId="undo-reason"
      onUndo={onUndo}
    />
  )
  return { onUndo }
}

describe('AgentChangesUndoBand', () => {
  it('対象の文言と、対象を含む名前のボタンを出す(読み上げの領域は持たない)', () => {
    const { container } = render(
      <AgentChangesUndoBand summary={makeAgentChangesUndoSummary({ operation: 'hunk' })} disabledReason={null} reasonId="r" onUndo={vi.fn()} />
    )
    expect(screen.getByText('直前に戻した操作: a.txt のハンク')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: '直前に戻した操作（a.txt のハンク）を取り消す' })
    expect(button).toHaveTextContent('戻した操作を取り消す')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).not.toHaveAttribute('aria-describedby')
    expect(container.querySelector('[role="alert"], [aria-live]')).toBeNull()
  })

  it('押せないときは帯の中に理由を見える文字で出し、aria-describedby で結ぶ(L-057)', () => {
    renderBand('取り消しの実行中です')
    const button = screen.getByRole('button', { name: '直前に戻した操作（a.txt）を取り消す' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-describedby', 'undo-reason')
    expect(document.getElementById('undo-reason')).toHaveTextContent('取り消しの実行中です')
  })

  it('押すと onUndo を呼ぶ。ダブルクリックの 2 回目(detail > 1)は無視する(L-408)', async () => {
    const { onUndo } = renderBand()
    await userEvent.click(screen.getByRole('button'))
    expect(onUndo).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button'), { detail: 2 })
    expect(onUndo).toHaveBeenCalledOnce()
  })

  it.each([
    ['Enter', true, false],
    [' ', true, false],
    ['Enter', false, true],
    ['a', true, true]
  ] as const)('keydown %j repeat=%s は既定の動作を %s(止めるのはキーリピートの Enter・Space だけ)', (key, repeat, notPrevented) => {
    renderBand()
    expect(fireEvent.keyDown(screen.getByRole('button'), { key, repeat })).toBe(notPrevented)
  })
})
```
`src/renderer/src/components/source-control/__tests__/AgentChangesUndoBand.styles.test.tsx`（`AgentChangesScopeSelect.styles.test.tsx` と同じく `main.css` を読み込む）: ボタンの `getComputedStyle` の `minHeight` が `32px`・`whiteSpace` が `nowrap`・`flexShrink` が `0`、帯（`.agent-changes__undo`）の `flexWrap` が `wrap`、文言（`.agent-changes__undo-text`）の `minWidth` が `0px`・`textOverflow` が `ellipsis`・`whiteSpace` が `nowrap`・`overflow` が `hidden`。

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/AgentChangesUndoBand.test.tsx src/renderer/src/components/source-control/__tests__/AgentChangesUndoBand.styles.test.tsx`
Expected: FAIL（`Cannot find module '../AgentChangesUndoBand'`）

- [ ] **Step 2: 帯と CSS を実装する**

`src/renderer/src/components/source-control/AgentChangesUndoBand.tsx`:
```tsx
'use client'
import type { AgentChangesUndoSummary } from '@shared/types'
import {
  AGENT_CHANGES_UNDO_BUTTON,
  formatAgentChangesUndoBandText,
  formatAgentChangesUndoButtonLabel,
  formatAgentChangesUndoTarget
} from '../../lib/agentChangesMessages'

export interface AgentChangesUndoBandProps {
  summary: AgentChangesUndoSummary
  disabledReason: string | null
  reasonId: string
  onUndo: () => void
}

// セクション「エージェントの変更」の帯「直前に戻した操作」(設計書「セクションの帯」)。一覧が空になった後も見える位置
// (範囲の選択の直後)に出す。結果の読み上げはセクションの常設の aria-live が行うため、帯は role="alert"・aria-live を持たない。
// 押せない理由は帯の中に見える文字で出して aria-describedby で結ぶ(L-057)。戻す操作の続きの入力(ダブルクリックの 2 回目・
// キーリピート)が逆の操作に届かないようにする(L-408。PromptItemView・AgentSendConfirmDialog と同じ)
export default function AgentChangesUndoBand({
  summary,
  disabledReason,
  reasonId,
  onUndo
}: AgentChangesUndoBandProps): React.JSX.Element {
  const target = formatAgentChangesUndoTarget(summary)
  const isDisabled = disabledReason !== null
  return (
    <div className="agent-changes__undo">
      <p className="agent-changes__undo-text">{formatAgentChangesUndoBandText(target)}</p>
      <button
        type="button"
        className="agent-changes__button agent-changes__undo-button"
        disabled={isDisabled}
        aria-describedby={isDisabled ? reasonId : undefined}
        aria-label={formatAgentChangesUndoButtonLabel(target)}
        onClick={(event) => {
          if (event.detail > 1) return
          onUndo()
        }}
        onKeyDown={(event) => {
          if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault()
        }}
      >
        {AGENT_CHANGES_UNDO_BUTTON}
      </button>
      {isDisabled && (
        <p id={reasonId} className="agent-changes__note agent-changes__undo-reason">
          {disabledReason}
        </p>
      )}
    </div>
  )
}
```
`src/renderer/src/assets/main.css` の `.agent-changes__scope-select:disabled { ... }` の後に足す:
```css
/* 帯「直前に戻した操作」。狭い幅では理由が次の行へ折り返し、長い対象は末尾を省略する。ボタンは折り返さずに押せる */
.agent-changes__undo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
}

.agent-changes__undo-text {
  flex: 1 1 0;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #cccccc;
  font-size: 12px;
}

.agent-changes__undo-button {
  flex: none;
  white-space: nowrap;
}

.agent-changes__undo-reason {
  flex-basis: 100%;
  padding: 0;
}
```
Run: `npx vitest run src/renderer/src/components/source-control/__tests__/AgentChangesUndoBand.test.tsx src/renderer/src/components/source-control/__tests__/AgentChangesUndoBand.styles.test.tsx`
Expected: PASS

- [ ] **Step 3: セクションの失敗するテストを書く**

`src/renderer/src/__tests__/makeAgentChangesState.ts` の `makeAgentChangesPanelState` の既定に `undo: makeAgentChangesUndoState()` を足し、`makeAgentChangesState.test.ts` のパネルの既定値の期待値にも足す。

`src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx` に describe `'直前に戻した操作の帯'` を足す（`summary = makeAgentChangesUndoSummary()`。記録中の写しは `makeAgentChangesRecordingView(entries, { undo: summary, runs })`。パネルは `makeAgentChangesPanelState({ changes: makeAgentChangesPanelChanges({ view }), undo: makeAgentChangesUndoState({ summary }) })`）:
1. 写しの `undo` があれば、範囲に関わらず帯を出す（`runs: [makeAgentChangesRun()]`・`changes.scope` が `{ kind: 'run', runId: 1 }` でも `直前に戻した操作: a.txt` が出る）。帯は範囲の選択の後・失敗の文言（`revert.error: 'x'`）の前（`screen.getByRole('combobox', { name: '表示' }).compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING` が真、`band.compareDocumentPosition(screen.getByText('x')) & Node.DOCUMENT_POSITION_FOLLOWING` が真）
2. 写しの `undo` が null なら帯を出さない。一覧が空（`entries: []`）でも `undo` があれば出す
3. 押すと `undo.undoLastRevert` を 1 回呼ぶ。帯が消える（`rerender` で `undo: null` の写しにする）と、フォーカスが見出しのボタンへ戻る（`userEvent.click` の後。パターン 152）
4. 戻す操作の後にフォーカスが取り消しのボタンへ行かない（`a.txt` の `↶` を `userEvent.click` → `rerender` で帯を出す → `document.activeElement` が `直前に戻した操作（a.txt）を取り消す` のボタンではない。L-408）
5. 取り消しの実行中（`revert: makeAgentChangesRevertState({ runningOperation: 'undo', revertAllDisabledReason: '取り消しの実行中です', revertDisabledReason: '取り消しの実行中です' })`、`undo: makeAgentChangesUndoState({ summary, undoDisabledReason: '取り消しの実行中です' })`）で一覧が空のとき: `確認を終える` が disabled で、`aria-describedby` の id の要素が帯の中の `取り消しの実行中です`。範囲の選択（`runs` が 1 件以上）も disabled で同じ id を指す
6. 実行中で一覧が空・写しの `undo` が null（帯が先に消えた）のとき: `確認を終える` の `aria-describedby` の id の要素があり、文字が `undo.undoDisabledReason`（`取り消しの実行中です`）
7. 一覧に行があり実行中のとき: `確認を終える` の `aria-describedby` は今どおり一覧の上の理由の要素（`shownReason`）を指す

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`
Expected: FAIL

- [ ] **Step 4: セクションに帯を配置する**

`src/renderer/src/components/source-control/AgentChangesSection.tsx`:
- import に `import AgentChangesUndoBand from './AgentChangesUndoBand'`
- 分割代入に `undo` を足す
- `const reasonId = useId()` の次に `const undoReasonId = useId()` を足す
- `const isWriting = revert.runningOperation !== null`（Task 6）の次に足す:
```ts
  // 戻す操作・取り消しの実行中に押せない確認を終える・範囲の選択が指す理由: 一覧の上の理由があればそれ、無ければ帯の理由
  // (帯が先に消えたときはセクションに同じ id の理由を出す。押せないボタンには必ず理由を結ぶ。パターン 126)
  const writingReasonId = shownReason !== null ? reasonId : undoReasonId
```
- 範囲の選択の `disabledReasonId={shownReason !== null ? reasonId : null}` を `disabledReasonId={isWriting ? writingReasonId : shownReason !== null ? reasonId : null}` にする
- 範囲の選択（`{recording.runs.length > 0 && (...)}`）の直後に足す:
```tsx
              {recording.undo !== null && (
                <AgentChangesUndoBand
                  summary={recording.undo}
                  disabledReason={undo.undoDisabledReason}
                  reasonId={undoReasonId}
                  onUndo={() => {
                    // 押すと帯が消える(取り消しの結果で写しの undo が null になる)。見出しへ戻す予約をする
                    reserveFocusRestore()
                    void undo.undoLastRevert()
                  }}
                />
              )}
              {isWriting && shownReason === null && recording.undo === null && (
                <p id={undoReasonId} className="agent-changes__note">
                  {undo.undoDisabledReason}
                </p>
              )}
```
- `確認を終える` の `aria-describedby={isWriting && shownReason !== null ? reasonId : undefined}` を `aria-describedby={isWriting ? writingReasonId : undefined}` にする

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`
Expected: PASS

- [ ] **Step 5: 配線の失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts`:
- `useAgentChangesRevert` と同じ形で `useAgentChangesUndo` を偽物にする（`const mockUseAgentChangesUndo = vi.hoisted(() => vi.fn<(options: AgentChangesUndoOptions) => AgentChangesUndoState>())`・`vi.mock('../useAgentChangesUndo', () => ({ useAgentChangesUndo: mockUseAgentChangesUndo }))`。`beforeEach` で `mockUseAgentChangesUndo.mockReturnValue(undoState)`、`const undoState = makeAgentChangesUndoState({ undoDisabledReason: 'busy' })`）
- L364 の it の近くに足す:
```ts
  it('取り消しの hook に、戻す操作と同じ runner・ロック・写しとタブの操作を渡し、パネルへ戻り値をそのまま渡す', () => {
    const { result, options } = setup()
    const o = options()
    const undoOptions = mockUseAgentChangesUndo.mock.lastCall![0]
    expect(undoOptions).toEqual({
      folderPath: '/repo',
      changes: o.recording.changes,
      runner: mockUseAgentChangesRevert.mock.lastCall![0].runner,
      fileLock: lock,
      agentRunning: true,
      hasDirtyTabAtOrInside: o.fileSystem.hasDirtyTabAtOrInside,
      reloadOpenFile: o.fileSystem.reloadOpenFile,
      closeTabsAtOrInside: o.fileSystem.closeTabsAtOrInside,
      refreshTree: o.fileSystem.refreshTree,
      refreshGitStatus: o.refreshGitStatus,
      refreshDiff: o.refreshDiff
    })
    expect(result.current.agentChangesPanel.undo).toBe(undoState)
  })
```
（`setup`・`options` の形はこのファイルの既存の補助関数に合わせる。`agentRunning: true` は既存の L364 の it と同じ前提）

`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts` の describe `'エージェントの変更の配線'` に足す（本物の hook どうし。L-060）:
```ts
      it('↶ で戻すと帯の控えが出て、取り消すと帯が消えて一覧に戻る。取り消しの実行中は戻す系が押せない(本物の hook どうし)', async () => {
        const entry = makeAgentChangeEntry('a.txt')
        const summary = makeAgentChangesUndoSummary()
        let listed = makeAgentChangesListResult([entry])
        window.api.listAgentChanges = vi.fn(() => Promise.resolve(listed))
        window.api.revertAgentChange = vi.fn(async () => {
          listed = makeAgentChangesListResult([], { undo: summary })
          return makeAgentRevertResult({ undoSummary: summary })
        })
        let finishUndo: () => void = () => undefined
        window.api.undoAgentChangesRevert = vi.fn(
          () =>
            new Promise((resolve) => {
              finishUndo = () => {
                listed = makeAgentChangesListResult([entry])
                resolve(makeAgentChangesUndoResult())
              }
            })
        )
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
        try {
          const { result } = renderHook(() => useAppState())
          const beforeAgentSend = mockUseAgentWorkspace.mock.lastCall![0].beforeAgentSend!
          await act(async () => {
            await beforeAgentSend()
          })
          await waitFor(() =>
            expect(result.current.agentChangesPanel.changes.view).toMatchObject({
              kind: 'recording',
              list: { entries: [entry] }
            })
          )
          await act(async () => {
            await result.current.agentChangesPanel.revert.revertFile(entry)
          })
          // 戻した結果の控えが写しに入り、パネルの取り消しに渡る(undo の渡し忘れで落ちる)
          await waitFor(() => expect(result.current.agentChangesPanel.undo.summary).toEqual(summary))
          let undoing: Promise<void> = Promise.resolve()
          act(() => {
            undoing = result.current.agentChangesPanel.undo.undoLastRevert()
          })
          await waitFor(() => expect(result.current.agentChangesPanel.revert.runningOperation).toBe('undo'))
          expect(window.api.undoAgentChangesRevert).toHaveBeenCalledWith(1)
          expect(result.current.agentChangesPanel.revert.revertDisabledReason).toBe(AGENT_CHANGES_BUSY_UNDOING)
          expect(result.current.agentChangesPanel.revert.revertAllDisabledReason).toBe(AGENT_CHANGES_BUSY_UNDOING)
          expect(result.current.agentChangesPanel.undo.undoDisabledReason).toBe(AGENT_CHANGES_BUSY_UNDOING)
          await act(async () => {
            finishUndo()
            await undoing
          })
          await waitFor(() => expect(result.current.agentChangesPanel.undo.summary).toBeNull())
          expect(result.current.agentChangesPanel.changes.view).toMatchObject({ list: { entries: [entry] } })
        } finally {
          confirmSpy.mockRestore()
        }
      })
```
（import に `makeAgentChangesUndoSummary`・`makeAgentRevertResult`・`makeAgentChangesUndoResult`・`AGENT_CHANGES_BUSY_UNDOING` を足す。`useFileSystem` の偽物にタブの操作〈`reloadOpenFile` など〉が無い場合は、このテストの中で `mockUseFileSystem.mockReturnValue({ ...defaultUseFileSystem(), folderPath: '/repo', reloadOpenFile: vi.fn(async () => undefined), closeTabsAtOrInside: vi.fn(), hasDirtyTabAtOrInside: vi.fn(() => false), refreshTree: vi.fn(async () => true), reloadOpenFiles: vi.fn(async () => undefined), confirmDiscardAnyDirty: vi.fn(() => true) })` にする）

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`
Expected: FAIL（`agentChangesPanel.undo` が無い）

- [ ] **Step 6: 配線を実装する**

`src/renderer/src/hooks/useAgentChangesWiring.ts`:
- import に `import { useAgentChangesUndo } from './useAgentChangesUndo'` と `import type { AgentChangesUndoState } from './useAgentChangesUndo'`
- `AgentChangesPanelState` の `revert` の後に足す:
```ts
  /** 直前の戻す操作の取り消し(セクションの帯) */
  undo: AgentChangesUndoState
```
- `const revert = useAgentChangesRevert({...})` の後に足す:
```ts
  // 直前の戻す操作の取り消し(戻す操作と同じ runner で、同じ実行中の印・失敗の表示・全体ロックを共有する)
  const undo = useAgentChangesUndo({
    folderPath,
    changes,
    runner,
    fileLock,
    agentRunning,
    hasDirtyTabAtOrInside: fileSystem.hasDirtyTabAtOrInside,
    reloadOpenFile: fileSystem.reloadOpenFile,
    closeTabsAtOrInside: fileSystem.closeTabsAtOrInside,
    refreshTree: fileSystem.refreshTree,
    refreshGitStatus,
    refreshDiff
  })
```
- `agentChangesPanel` の `revert,` の後に `undo,` を足す
- ファイルの冒頭のコメントの「戻す操作(useAgentChangesRevert)」を「戻す操作(useAgentChangesRevert)と取り消し(useAgentChangesUndo。実行の共有 useAgentChangesWriteRunner を共有する)」にする

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`
Expected: PASS

変異の確認: `agentChangesPanel` の `undo,` を一時的に `undo: { summary: null, undoDisabledReason: null, undoLastRevert: async () => undefined },`（型を通す固定値）に置き換えると `useAppState.agent.test.ts` の新しいテストが落ちることを確かめてから戻す。

- [ ] **Step 7: テスト・型・lint**

Run: `npx vitest run src/renderer`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: このタスクの **Files** に挙げた `.ts`・`.tsx` のファイル（作成・変更・テスト）をすべて並べて `npx eslint --fix <ファイル…> && npx eslint --max-warnings 0 <ファイル…>`
Expected: エラー・警告なし

---

### Task 9: ROADMAP 更新と全体検証（テスト仕様書への追記と Artifact の再公開）

**Files:**
- Modify: `docs/manual-test-spec.md`（「## エージェントの変更の確認」の末尾〈AGC-063 の行の後、`## ソース管理（基本）` の前〉に 2 つの `###` と AGC-064〜086 を足す。AGC-010・012・014・015・016・020・026・034・046 の手順・期待結果を直す〈ID は変えない〉）
- Modify: `ROADMAP.md`（L421-425 の項目、L207-208・L370 の既知の制約、「エージェントの変更の実行ごとの記録と一覧の自動の取り直し」の節〈L357〜〉の後に新しい節）
- Modify: `docs/superpowers/specs/2026-10-06-agent-changes-review-design.md`（確認の結果 12〈L119-120〉・確認ダイアログの文言の表〈L381-385〉・「undo の可否」〈L392-395〉・エラー処理の表〈L552〉・既知の制約〈L617〉・「この機能の後の候補」〈L653〜〉に注記）
- Modify: `docs/superpowers/specs/2026-10-12-agent-changes-runs-and-auto-refresh-design.md`（L146・既知の制約 L325 に注記）
- 生成（git 管理外）: `.superpowers/manual-test-spec.html`

**Interfaces:**
- Consumes: Task 1〜8 の実装（文言は `src/renderer/src/lib/agentChangesMessages.ts`・`src/main/agentChangesUndo.ts` の定数と一字一句同じにする）、Task 1・4 の実測の結果
- Produces: 実機テスト仕様書の AGC-064〜086（コントローラーが Artifact を再公開する）

- [ ] **Step 1: 実機テスト仕様書に追記する**

`docs/manual-test-spec.md` の AGC-063 の行の後（空行を 1 つ挟む）に、次をそのまま足す（1 行 1 項目。書式は仕様書の冒頭と `scripts/build-manual-test-spec.mjs` のとおり）:
```markdown
### 戻した操作の取り消し

> 前提: この領域の冒頭の前提（テスト用のリポジトリ・`claude` の起動・`実行` で送る）と同じ。取り消せるのは直前の 1 回の戻す操作だけで、取り消しの取り消し（やり直し）は無い。
> 前提: 実装の自動テストでは、実物の Electron の画面・OS のゴミ箱・VoiceOver は使っていない。期待と違ったら、その画面と `git status --porcelain` の出力を記録する。

- [ ] **AGC-064** AGC-001 の状態で `a.txt` をエディタでも開き（未編集）、一覧の `a.txt` の `↶` を押して OK → `1 件を実行前の状態に戻しました。「戻した操作を取り消す」で取り消せます` が読み上げられ、セクションの上に `直前に戻した操作: a.txt` と `戻した操作を取り消す` が出る。フォーカスは見出しにある（取り消しのボタンではない）。`戻した操作を取り消す` を押すと確認に `直前に戻した操作を取り消しますか？次のファイルが、戻す前の内容に戻ります。` と `a.txt` が出て、OK で `a.txt` が `agent` の行を含む内容に戻り、開いているタブも読み直され、一覧に `M a.txt` が戻る。帯が消え、`戻した操作を取り消しました（1 件）` が読み上げられ、フォーカスは見出しにある
- [ ] **AGC-065** 追加された `z.txt` の `↶` で OK（ゴミ箱へ移る）してから `戻した操作を取り消す` を押す → 確認に `ゴミ箱へ移したファイルは、ゴミ箱に残したまま元の場所に作り直します。` が出て、OK で `z.txt` が同じ内容で元の場所に現れる（OS のゴミ箱にも残る）
- [ ] **AGC-066** 削除された `b.txt` の `↶` で OK（作り直される）してから `戻した操作を取り消す` を押す → 確認に `うち 1 件は、戻したときに作り直したファイルのため、ゴミ箱へ移動します。` が出て、OK で `b.txt` が OS のゴミ箱へ移り、一覧に `D b.txt` が戻る
- [ ] **AGC-067** diff タブのハンクを `このハンクを実行前に戻す` で戻す → diff タブ側で `ハンクを実行前の状態に戻しました。ソース管理の「エージェントの変更」で取り消せます` が読み上げられ、セクションの帯が `直前に戻した操作: a.txt のハンク` になる。取り消すと、そのハンクが戻る
- [ ] **AGC-068** フォルダの行が無い状態で `すべて戻す` を押して OK → 帯が `直前に戻した操作: 3 件（すべて戻す）`（件数は戻した数）になり、一覧が空でも帯が見える。取り消すと、すべての行が戻す前と同じ一覧に戻る
- [ ] **AGC-069** `a.txt` を戻した後、アプリで `a.txt` を編集して保存してから（別の回に端末で `echo x >> a.txt` を実行してから）取り消す → `戻した後に変わったファイルがあるため、取り消せません（a.txt）` が出て、`a.txt` は変わらず、帯が消える
- [ ] **AGC-070** `a.txt` を戻し、続けて `c.txt` を戻す（AGC-002 の状態）→ 帯は `直前に戻した操作: c.txt` だけになり、取り消すと `c.txt` だけが戻り、`a.txt` は戻したまま
- [ ] **AGC-071** `a.txt` を戻した後、`実行` で 1 回送り（「ls を実行して」などファイルを変えない指示）、`表示` で `実行 1` を選ぶ → 帯は残り、`戻した操作を取り消す` は押せる（実行の範囲でも取り消せる）。`確認を終える`・フォルダの切り替え・リロード（`Cmd+R`）のどれでも帯が消える
- [ ] **AGC-072** 帯がある状態で、エージェントに `node_modules/` を作らせてその `↶` を押す → 確認に `フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。` が出る。OK の後、帯は消え、`1 件を実行前の状態に戻しました。フォルダを含むため、この操作は取り消せません` が読み上げられる
- [ ] **AGC-073** 記録がある状態で、端末で `head -c 120000000 /dev/zero > big.bin` を実行して `更新` を押し、`A big.bin` の `↶` で OK → `1 件を実行前の状態に戻しました。内容が大きすぎるため、この操作は取り消せません` が読み上げられ、帯は出ない（`big.bin` はゴミ箱へ移る。終わるまでの時間を記録する）
- [ ] **AGC-074** `a.txt` を戻した後、`a.txt` のタブで未保存の編集をしてから `戻した操作を取り消す` を押す → 確認に `エディタの未保存の編集も破棄されます。` が含まれる。キャンセルすると、ファイル・タブの編集・帯のどれも変わらない
- [ ] **AGC-075** 帯がある状態で、ソース管理の `プル`（リモートがあるリポジトリ）を押した直後に帯を見る → `戻した操作を取り消す` が押せず、帯の中に `他の Git 操作の実行中です` が出る（VoiceOver でボタンを選ぶと理由が読まれる）。取り消しの実行中は `↶`・`すべて戻す`・`表示` の選択・`確認を終える` が押せない
- [ ] **AGC-076** `戻した操作を取り消す` をダブルクリックする → 確認は 1 回だけ出る。`Tab` で `戻した操作を取り消す` へ移って Enter を押し続けても、確認は 1 回だけ出る。`↶` を押して OK の直後に Enter を押し続けても、取り消しは始まらない
- [ ] **AGC-077** `戻した操作を取り消す` を押した直後（取り消しの実行中から一覧の取り直しが終わるまで）に、もう一度押そうとする → 押せない（淡色。帯が消えるか、押せない理由が出る）。`a.txt` を戻した後、別の回に端末で `echo x >> a.txt` を実行してから取り消す → 失敗の直後から帯は消え（押せない）、一覧の取り直しの後も出ない（照合が合わず控えが捨てられたため）
- [ ] **AGC-078** 記録が無い状態で、端末で `mkdir -p zz && echo z > zz/m.txt && git add zz && git commit -qm zz` を実行してから `いまから記録する` を押し、端末で `echo agent >> a.txt && echo agent >> zz/m.txt && chmod 555 zz` を実行して `更新` を押す。`すべて戻す` で OK → `a.txt` だけが戻り、`すべて戻すが途中で失敗しました（1 / 2 件を戻し済み）: …` の警告の後ろに `。戻せた 1 件は「戻した操作を取り消す」で取り消せます` が出て、帯が `直前に戻した操作: 1 件（すべて戻す）` になる。取り消すと `a.txt` だけが `agent` の行を含む内容に戻る。確かめたら端末で `chmod 755 zz` を実行し、`確認を終える` を押す
- [ ] **AGC-079** VS Code の Git Graph（拡張があれば）・`gitk --all` で、記録中のリポジトリを開く → エラーが出ず、`refs/prompt-ide/` の ref はコミットとして出ない（出る・エラーになる場合は記録して既知の制約に足す）
- [ ] **AGC-080** ウィンドウ幅 500・640・1280px で帯を見る → 文言が長いときは末尾が省略され、`戻した操作を取り消す` は折り返さずに押せる（32px 以上）。VoiceOver でボタンを選ぶと `直前に戻した操作（a.txt）を取り消す` と読まれる

### 記録の gc からの保護

> 前提: この領域の冒頭の前提と同じ。端末のコマンドはテスト用のリポジトリ（`$R`）で実行する。

- [ ] **AGC-081** 記録がある状態で、端末で `git for-each-ref refs/prompt-ide/` を実行する → `refs/prompt-ide/agent-changes/<数字>-<16 進>/<数字>` の `tree` の ref が 1 つ出る。`git log --all --oneline`・`git branch -a`・`git tag` の出力は記録の前と同じ。アプリのブランチ・タグ・履歴の表示も変わらない
- [ ] **AGC-082** 記録の後にエージェントが `a.txt` を変え、`実行` をもう 1 回送ってから、端末で `git gc --prune=now` を実行して `更新` を押す → 一覧は出て、`表示` の `実行 1` も表示できる。`a.txt` の `↶` で `a.txt` が記録の時点の内容に戻る
- [ ] **AGC-083** `確認を終える` を押す → `git for-each-ref refs/prompt-ide/` が何も出さない。フォルダの切り替え・リロードの後も同じ
- [ ] **AGC-084** 記録がある状態で、端末で `kill -9 <アプリの main の pid>` を実行してアプリを止め、`git for-each-ref refs/prompt-ide/` で ref が残っていることを確かめる。アプリを起動して同じリポジトリを開き、`いまから記録する` を押す → 前の ref が消え、新しい ref が 1 つだけ出る
- [ ] **AGC-085** 記録がある状態で、端末で `git for-each-ref --format='delete %(refname)' refs/prompt-ide/ | git update-ref --stdin` を実行してから `実行` を 1 回送る → ref は作り直されない（`git for-each-ref refs/prompt-ide/` が何も出さない）
- [ ] **AGC-086** 記録がある状態で、端末で `R2=$(git for-each-ref --format='%(refname)' refs/prompt-ide/) && git update-ref "$R2" HEAD` を実行してから `実行` を 1 回送り、`確認を終える` を押す。アプリを終了して起動し直し、同じリポジトリで `いまから記録する` を押す → `$R2` はどの時点でも消えず、HEAD のコミットを指したまま残る（利用者が書き換えた ref は消さない）。確かめたら端末で `git update-ref -d "$R2"` を実行する
```
（設計書の AGC-086 の変数 `R` は、前提のテスト用のリポジトリの `R` と重なるため `R2` にした）

- [ ] **Step 2: 既存の項目を直す（ID は変えない。パターン 160）**

`docs/manual-test-spec.md` の次の箇所を置き換える（ほかの文字は変えない）:
- **AGC-010**: `` `ハンクを実行前の状態に戻しました` が読み上げられる `` → `` `ハンクを実行前の状態に戻しました。ソース管理の「エージェントの変更」で取り消せます` が読み上げられる ``
- **AGC-034**: `` `ハンクを実行前の状態に戻しました` が読み上げられる `` → 同じ置き換え
- **AGC-012**: `この操作は元に戻せません。` → `戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。`、`` `1 件を実行前の状態に戻しました` が読み上げられる `` → `` `1 件を実行前の状態に戻しました。「戻した操作を取り消す」で取り消せます` が読み上げられ、セクションの上に `直前に戻した操作: a.txt` が出る ``
- **AGC-014**: `` 確認に `z.txt をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）` が出る `` → `` 確認に `z.txt をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。` が出る ``
- **AGC-015**: `` 確認に `フォルダとその中身（.gitignore の対象を含む）がすべて移動します。` が含まれ、OK でフォルダがゴミ箱へ移る `` → `` 確認に `フォルダとその中身（.gitignore の対象を含む）がすべて移動します。フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。` が含まれ、OK でフォルダがゴミ箱へ移り、`1 件を実行前の状態に戻しました。フォルダを含むため、この操作は取り消せません` が読み上げられる ``
- **AGC-016**: `` 確認に件数・`うち N 件の新しいファイル・フォルダはゴミ箱へ移動します。`・ `` → `` 確認に件数・取り消せるか（フォルダの行が無ければ `戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。`、あれば `フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。`）・`うち N 件の新しいファイル・フォルダはゴミ箱へ移動します。`・ ``
- **AGC-020**: `` 記録の後にエージェントが変えた `a.txt` があり、端末で `git gc --prune=now` を実行してから `` → `` 記録の後にエージェントが変えた `a.txt` があり、端末で `git for-each-ref --format='delete %(refname)' refs/prompt-ide/ | git update-ref --stdin`（記録を守る ref を消し、守りが効かない場合を作る）と `git gc --prune=now` を実行してから ``
- **AGC-026**: `` → 何も出ない（記録の一時ディレクトリが残らない） `` → `` → 何も出ない（記録の一時ディレクトリが残らない）。`ls "$TMPDIR" | grep prompt-ide-agent-undo` も何も出さず、テスト用のリポジトリで `git for-each-ref refs/prompt-ide/` も何も出さない。終了は記録が無いときと比べて目に見えて遅れない ``
- **AGC-046**: `` アプリの外の端末で `git gc --prune=now` を実行して `` → `` アプリの外の端末で `git for-each-ref --format='delete %(refname)' refs/prompt-ide/ | git update-ref --stdin` と `git gc --prune=now` を実行して ``

（置き換えの前の文字が見つからないときは、その項目の今の文を読み、同じ意味の箇所だけを直す。ID・ほかの項目は変えない）

- [ ] **Step 3: HTML を再生成し、仕様書の検査を通す**

Run: `node scripts/build-manual-test-spec.mjs`
Expected: `.superpowers/manual-test-spec.html (N 領域 / M 項目)` が出る（項目の数が 23 増えている）
Run: `npx vitest run scripts`
Expected: PASS（ID の一意性・接頭辞ごとの連番の昇順・書式）

Artifact（<manual-test-spec-artifact-url>）の再公開は、このタスクの実装者ではなく**コントローラーが** `.superpowers/manual-test-spec.html` を同じファイルパスで公開して行う（実装者は HTML の生成までで止め、報告に「再公開が必要」と書く）。

- [ ] **Step 4: ROADMAP を更新する**

`ROADMAP.md`:
1. L421-425 の項目の `実装済み（2026-10-12 …）` の行の後に足し、`残り:` の行を直す:
```markdown
      - 実装済み（2026-10-13。設計書 `docs/superpowers/specs/2026-10-13-agent-changes-revert-undo-and-gc-protection-design.md`）: 戻した操作の取り消し（直前の 1 回）、記録の blob を gc から守る（記録中だけ専用の ref から記録の tree をたどれるようにする）。実装済み機能の「エージェントの変更の戻した操作の取り消しと記録の gc からの保護」を参照
      - 残り: `claude` の hooks で利用者の編集と区別する、Git 管理外のフォルダでの記録
```
2. 「エージェントが変更したファイルの確認」の既知の制約の 2 行を直す（過去の状態は過去形で書き、どの時点で変えたかを書く）:
   - L207: `戻した操作は取り消せない（ゴミ箱へ移したものは OS のゴミ箱から戻せる）` → `戻した操作は取り消せなかった（2026-10-13 から、直前の 1 回の戻す操作をセクションの帯の「戻した操作を取り消す」で取り消せる。「エージェントの変更の戻した操作の取り消しと記録の gc からの保護」を参照。ゴミ箱へ移したものは OS のゴミ箱からも戻せる）`
   - L208: `記録の blob はどの ref からもたどれないため、`git gc --prune=now` などの後は戻せない（戻す前に拒否する）。既定の gc（2 週間）では消えない` → `記録の blob はどの ref からもたどれなかったため、`git gc --prune=now` などの後は戻せなかった（2026-10-13 から、記録中は専用の ref から記録の tree をたどれるため、`git gc --prune=now` でも消えない。守りが効かない場合〈ref を作るまでの短い間の gc・利用者が ref を消した後の gc・ref の作成の失敗〉は今も戻す前に拒否する）。確認を終えた後は既定の gc（2 週間）の後に消える`
3. 「エージェントの変更の実行ごとの記録と一覧の自動の取り直し」の既知の制約の L370 の `` `git gc --prune=now` などの後は、途中の実行が表示できない `` → `` `git gc --prune=now` などの後は、途中の実行が表示できなかった（2026-10-13 から、記録中は専用の ref が区切りの tree も守るため表示できる。守りが効かない場合は今も表示できない） ``
4. その節の既知の制約の最後の行（`- フォーカスの復帰の自動の取り直しは、…`）の後、`---` の前に新しい節を足す:
```markdown

### エージェントの変更の戻した操作の取り消しと記録の gc からの保護

設計書: `docs/superpowers/specs/2026-10-13-agent-changes-revert-undo-and-gc-protection-design.md`（2026-10-13）。

- [x] ソース管理パネルの「エージェントの変更」で戻した直後（行の `↶`・diff タブのハンクの `このハンクを実行前に戻す`・`すべて戻す`）に、セクションの帯 `直前に戻した操作: <対象>` の `戻した操作を取り消す` で、直前の 1 回の戻す操作を取り消す（戻す前のバイト列と権限に戻す。確認のダイアログで何が戻るかを見せる。取り消しの後はタブを読み直し、ゴミ箱へ移したパスのタブを閉じる）
- [x] 戻す操作の確認と結果の読み上げで、取り消せるか（取り消せないときは理由）を伝える
- [x] 戻した後にそのファイルが変わっていたら、取り消しを拒否する（中身・大きさ・権限・種類・リンクの指す先で照合する）
- [x] 記録中だけ、専用の ref（`refs/prompt-ide/agent-changes/…`。tree を指し、`git log --all`・ブランチ・タグには出ない）から記録の tree をたどれるようにし、`git gc --prune=now` でも記録の object が消えないようにする。確認を終える・フォルダの切り替え・アプリの終了で消し、異常終了で残った ref は次にそのリポジトリで記録を取るときに消す

既知の制約（設計書の「既知の制約」と同じ。実装で分かったものを足した）:
- 取り消せるのは直前の 1 回の戻す操作だけで、取り消しの取り消し（やり直し）は無い。取り消しの後にもう一度戻すことはできる（記録は残る）
- 追加されたフォルダをゴミ箱へ移した操作と、控えるファイルの中身の合計が 100MB を超える戻す操作は取り消せない（OS のゴミ箱から戻す）
- 取り消しは、戻した後に利用者・エージェントがそのファイルを変えていると拒否する（同じ中身・権限に戻してあれば取り消せる）。照合から書き換えまでの短い間にエージェントが書いた変更は上書きされうる。また、戻す操作で控えを取ってから適用するまでの短い間にエージェントが書いた変更は、戻す操作で上書きされ、取り消しでも戻らない（取り消しは控えの時点の内容に戻す）
- 取り消しで作り直した追加のファイルは、OS のゴミ箱にも残る（ゴミ箱を空にしない）。削除を作り直したファイルの取り消しはゴミ箱へ移し、戻すときに作られた空のフォルダは残る
- 取り消しの書き換えは、同じフォルダの一時の名前（`.prompt-ide-undo-<乱数 16 桁の 16 進>`）を経由する。書き換えの途中でアプリが異常終了すると、その一時ファイルが残ることがある
- ハードリンクを作れないファイルシステム（exFAT・FAT・一部のネットワークのフォルダ）では、作り直しは目的の名前に直接書く。書き込みの途中でアプリが異常終了すると、中身が途中までのファイルが残ることがある
- 取り消しの控え（戻す前のファイルの中身）は、記録と同じアプリの一時ディレクトリ（0700）に置く。異常終了で残った控えは OS の一時ディレクトリの掃除に任せる
- 取り消しの帯はセクションにだけ出る（diff タブ・ターミナルの帯・ショートカットからは取り消せない）
- 記録中は、ウィンドウごとに `refs/prompt-ide/agent-changes/…` の tree の ref が 1 つ、利用者のリポジトリにできる（`git for-each-ref`・`git show-ref` に出る。`git log --all`・ブランチ・タグには出ない）。`git push --mirror` など `refs/*` を送る操作では、ref と記録の tree（記録の時点の、ignore されていない未追跡のファイルを含む）が送り先へ送られる
- 記録中は `git gc --prune=now` でも記録の object は消えない。ただし、記録を取ってから ref を作るまでの短い間の gc・利用者が ref を消した後の gc・ref の作成に失敗したときは、今までどおり gc の後は戻せない（戻す前に拒否する）。確認を終えた後は到達できない object に戻り、既定の gc で 2 週間の後に消える
- 異常終了などで残った ref は、次にアプリがそのリポジトリで記録を取るときに消す（その pid のプロセスがこのマシンに無く、値が自分の書く形〈子が 1 つ以上ですべて tree、`baseline` は 0 か 1 つ、ほかはすべて `run-<整数>` の tree〉のとき）。保護をやめるのは利用者が ref を消した・書き換えたときだけで、消した場合は消すものが無い。書き換えた ref は、そのインスタンスが動いている間はアプリが消さない。インスタンスが終わった後は、別のインスタンスの掃除が、値が自分の書く形のときだけ消す（書き換えた値が自分の書く形でなければ、アプリが消すことは無く、手で消す）。そのリポジトリを開かなければ残る（`git for-each-ref --format='delete %(refname)' refs/prompt-ide/ | git update-ref --stdin` で消せる）。ネットワーク上のフォルダなどを別のマシンのアプリと同時に使うと、別のマシンの記録の ref を消すことがある（そのときは gc の後に戻せないだけで、ファイルは消えない）
- 保護の ref の作成・更新は `reference-transaction` の hook を動かさない（`core.hooksPath` を、`userData` の下の hook の無い空のディレクトリ〈0700。消さない〉にして実行する）
```
   Task 1・4 の実測で目に見える遅れ（中央値が 50ms を超える ref の操作、1 秒を超える控え）が分かったときは、その数字を既知の制約の最後に 1 行足す（無ければ足さない）。

- [ ] **Step 5: 前の 2 つの設計書に注記する（過去形で、どの設計書で変えたかを書く）**

`docs/superpowers/specs/2026-10-06-agent-changes-review-design.md`:
- 確認の結果 12（L119-120）の段落の末尾に: `（2026-10-13 の設計書 `2026-10-13-agent-changes-revert-undo-and-gc-protection-design.md` で、記録中は専用の ref から記録の tree をたどれるようにしたため、記録中の gc ではこの状態は起きなくなった。守りが効かない場合のために、戻す前の検査は残した）`
- 確認ダイアログの文言の表（L381-385）の直後に: `> 2026-10-13 に変更: 「この操作は元に戻せません。」は、取り消せる旨（フォルダは取り消せない旨）の文言に変えた（2026-10-13 の設計書の「確認・読み上げの文言」）。この表は変更の前の文言。`
- 「undo の可否」（L392-395）の末尾に: `（2026-10-13 の設計書で、直前の 1 回の戻す操作を取り消せるようにした。控えは記録のインデックスではなく、アプリの一時ディレクトリに戻す前のバイト列として持つ。この節の判断は当時のもの）`
- エラー処理の表の `記録の blob が消えた（`gc --prune=now`）` の行（L552）の後に: `> 2026-10-13 から、記録中は専用の ref が記録の object を守るため、この行は守りが効かない場合（ref を作るまでの短い間の gc・利用者が ref を消した後の gc・ref の作成の失敗）だけに当てはまる。`
- 既知の制約の L617 の行の末尾に: `（2026-10-13 から、記録中は専用の ref から記録の tree をたどれるため、記録中の `git gc --prune=now` では消えない。2026-10-13 の設計書の「既知の制約」を参照）`
- 「この機能の後の候補」（L653〜）の「戻した操作を取り消す」に当たる行の末尾に: `（2026-10-13 に実装した）`（該当する行が無ければ、節の末尾に `- 戻した操作の取り消しと、記録の blob を gc から守ることは、2026-10-13 に実装した（2026-10-13 の設計書）` を足す）

`docs/superpowers/specs/2026-10-12-agent-changes-runs-and-auto-refresh-design.md`:
- L146 の行の末尾に: `（2026-10-13 から、記録中は専用の ref が区切りの tree も守るため、記録中の gc ではこの失敗は起きなくなった）`
- 既知の制約の L325 の行の末尾に: `（2026-10-13 から、記録中は専用の ref から記録の tree をたどれるため、記録中の `git gc --prune=now` の後も途中の実行を表示できる。守りが効かない場合は今も表示できない）`

- [ ] **Step 6: 全体の検証**

Run: `npx vitest run`
Expected: PASS（すべてのテスト）
Run: `npm run typecheck`
Expected: PASS
Run: `git diff --name-only -- '*.ts' '*.tsx' && git ls-files --others --exclude-standard -- '*.ts' '*.tsx'` で、このプランで変更・作成した TypeScript のファイルを列挙し、`npx eslint --max-warnings 0 <列挙したファイル>`
Expected: エラー・警告なし
Run: `ls src/main/__tests__/ | grep timing.local`
Expected: 何も出ない（計測のファイルを消してある）
Run: `git status --short`
Expected: このプランで変えたファイルと、設計書・プランの未追跡のファイルだけが出る（`.superpowers/` は git 管理外）。コミットはしない
