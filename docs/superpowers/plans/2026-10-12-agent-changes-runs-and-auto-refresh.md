# エージェントの変更の実行ごとの記録と一覧の自動の取り直し 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プロンプトの `実行` の直前に毎回「実行の区切り」の記録を足し、ソース管理パネルの「エージェントの変更」で `すべて（累積）` と `実行 N` を切り替えて、その実行で変わったファイルと差分だけを見られるようにする。あわせて、エージェントの完了・許可待ち・確認待ちの出来事とウィンドウのフォーカスの復帰を契機に、記録がある間だけ一覧を自動で取り直す。

**Architecture:** main は、`takeBaselineSnapshot` に写しの元（`baseIndexPath`）と `write-tree` の `tree` を足し、registry の 1 所有者の記録を「累積の始点 + 実行の一覧（最大 10 件）」（新規 `agentChangesRecord.ts`）に広げる。`begin(trigger)` の `send` は所有者の列の中で直前の取れた記録から区切りを取り、実行を足す。範囲（`all` / `run`）は新規 `agentChangesScope.ts` の純粋な関数で記録から解決し、最後の実行は既存の一覧・diff に開始の区切りを渡し、途中の実行は tree どうしの `diff-tree`・`diff`（`listAgentChangesBetween`・`getAgentChangeDiffBetween`）で比べる。IPC は `trigger`・`scope` を必須の引数にし、parser で厳密に検証し、戻す系は `all` 以外を列に入る前に拒む。renderer は、写し（`useAgentChanges`）に実行の一覧・選んでいる範囲・`selectScope` を持ち、一覧・diff の内容を取った範囲と組で持つ。セクションに範囲の `<select>`（新規 `AgentChangesScopeSelect.tsx`）を置き、実行の範囲では戻すボタンを押せなくする。新規 `useAgentChangesAutoRefresh` が、通知と同じ `advanceAgentNotifications` の出来事と `focus`・`visibilitychange` を、待ち 300ms・上限 1,000ms で合流して一覧を取り直す。

**Tech Stack:** Electron（main・preload）, React 19, TypeScript, simple-git（実 git の結合テスト）, Vitest, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-12-agent-changes-runs-and-auto-refresh-design.md`（承認済み。実装の前に必ず読む）。前提の設計書 `docs/superpowers/specs/2026-10-06-agent-changes-review-design.md`。

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
> - 記録の型（`AgentChangesRecord`・`AgentChangesRecordRun`・`AgentChangesRunStart`）と `summarizeAgentChangesRuns` は、設計書の `agentChangesScope.ts` ではなく新規 `src/main/agentChangesRecord.ts` に置く（Task 3 の registry が `begin` の結果に実行の一覧を入れるため先に要る）。`agentChangesScope.ts`（Task 4）は `resolveAgentChangesScope` だけを持つ。
> - registry の依存に `now: () => number` を足す（区切りを取れなかった実行の `startedAt` は、取得を始めた時刻。`takeBaselineSnapshot` の `unavailable` は時刻を持たない）。
> - `takeBaselineSnapshot` の手順を「一時ディレクトリ → 写し → 未追跡の事前の検査」の順に揃える（`baseIndexPath` のときは写した記録のインデックスで検査するため。指定が無いときも同じ順にする）。確認（`checkpoint`）は `write-tree` の後の 1 つが増えて 10 か所。未追跡が上限を超えたときは、作った一時ディレクトリを消してから返す。
> - 途中の実行の blob・tree が gc で消えたとき、`git diff-tree <tree> <tree>`・`git diff <tree> <tree>` は `fatal: unable to read <sha>` ではなく **`fatal: bad object <sha>`** で失敗する（計画の時点に git 2.50.1 で実測）。`toBaselineQueryError` の判定に `bad object <sha>` を足す（Task 2）。
> - 未確認事項 2・3（写しの元を直前の記録にしたときと `.git/index` から作ったときの tree・`write-tree` の失敗）は、計画の時点に git 2.50.1 の CLI で同じ手順（写し → 検査 → 除外の pathspec 付きの `add -A` → `write-tree`）を再現して確かめた: 未追跡・削除・ignore・入れ子のリポジトリ（コミットあり・なし）・5MB を超える新しいファイル・intent-to-add・コンフリクト中のエントリ（作業ツリーに残す・消す）はどれも同じ tree になり、`write-tree` は失敗しなかった。違ったのは「前の記録で追跡していた 5MB を超えるファイルを、利用者が `git rm --cached` した」場合だけ（直前の記録を写しの元にすると記録し続け、`.git/index` からだと除外する）。Task 1 の結合テストでこれらを固定し、違いは既知の制約に足す（Task 8）。テストが計画の時点の結果と違ったら、期待値を合わせて通さずに止めて報告する。
> - 途中の実行の一覧の「記録しなかったパス」の扱い（設計書「範囲ごとの一覧と diff」の細部）: tree の差分に出たパスのうち、どちらかの端で記録しなかったもの（除外・コミットの無い入れ子のリポジトリ・ignore 済み）は、片方は tree・もう片方は記録の外で両端に何かがあるため `M` の `notRecorded` の 1 行にする。tree の差分に出ないもの: 除外は両端の控えで（両方 → 大きさか更新時刻が違えば `M`、終わりだけ → `A`、始まりだけ → `D`。もう片方の端で別の理由で記録していなければ出さない）、コミットの無い入れ子のリポジトリは有無で（`<dir>/` の `A`・`D`。`isDirectory: true`）。**ignore 済みは、片方の端にだけあっても行にしない**（設計書は「終わりにだけある → A、始まりにだけある → D」としていたが、累積の一覧は ignore されたファイルの出現・削除を出さない〈既知の制約「ignore されたファイルの変更は一覧に出ない」〉。実行の範囲だけ `npm install` などの ignore 済みの生成物が `A` で並ぶと、累積と実行で見え方がずれるため、累積に揃える）。
> - renderer の写しの `list` は、設計書の `{ scope; …AgentChangesList } | { scope; unavailable }` を判別できる形 `AgentChangesViewList`（`({ kind: 'listed'; scope } & AgentChangesList) | { kind: 'scope-unavailable'; scope; reason }`）にし、行を読む側は `getListedAgentChanges(view)`（新規 `lib/agentChangesScope.ts`）で取り出す。
> - 開始を記録できなかった理由の短い形（選択の項目・範囲の一覧が取れないときの理由）: `too-many-untracked` → `未追跡のファイルが多すぎます`、`timeout` → `時間がかかりすぎました`、`git-failed` → `git を実行できませんでした`、`not-repository` → `Git 管理外のフォルダです`、`not-toplevel` → `リポジトリの最上位のフォルダではありません`（後の 2 つは区切りでは起きないが、型を網羅する）。
> - diff タブのラベルの実行の番号は `AgentDiffActions.contentRunNumber`（表示中の diff の内容を取った範囲の実行の番号。累積・内容が無い間は null）で EditorPanel へ渡し、`useCombinedEditorTabs` の `agentDiffRunNumber` として**アクティブな agent の diff タブにだけ**付ける（ほかの agent の diff タブは内容を持たないため `(エージェントの変更)` のまま）。
> - `useDiffOperations` の引数に `agentScope`（必須）を 4 番目に足し、省略できる `fileLock` を 5 番目へ移す。既存のテストの 46 か所の呼び出しは、テストのファイルの中の補助関数（累積で呼ぶ）に置き換える。範囲は取得の effect の依存に入れず（範囲を変えた直後に前の一覧のまま取り直さない）、一覧が届いた後の `refreshDiff`（今の流れ）で新しい範囲で取り直す。
> - 戻す操作の実行中は、範囲の `<select>` を `disabled` にするのに加え、セクションの変更の処理でも何もしない（L-058）。
> - 自動の取り直しの合流は、タイマー・実行中・「もう 1 回」の印・世代を `useRef` の控えに置き、モジュールの関数で操作する（`useAgentActivity` の `TabWatch` と同じ作り）。
> - Task 3 の時点の handler の `begin` は `registry.begin(ownerId, folder, 'manual')`（今の挙動のまま）にし、Task 4 で renderer から受けた `trigger` に置き換える。
> - typecheck の期間: Task 3 は共有の `AgentChangesState` に `runs` を足すが、renderer の型付きのテストの値（`{ kind: 'recording', startedAt: N }`）に `runs: []` を足して `npm run typecheck:web` を通したままにする。**Task 4 で共有の一覧の結果の型・preload の引数を変えてから、Task 5 で renderer の API・写しを合わせるまでの間は `npm run typecheck:web` が落ちる**（`lib/agentChangesApi.ts`・`hooks/useAgentChanges.ts`・`__tests__/makeAgentChangesState.ts` など）。Task 4 の検証は `npm run typecheck:node` と変更したテストで行い、Task 5 以降は `npm run typecheck`（両方）を通す。
> - 設計書の `patchFormatArgs` は実在の `PATCH_FORMAT_ARGS`（`src/main/gitDiffArgs.ts`）で、累積の diff と同じく `-U3` を付ける。

## Global Constraints

- コメント・文言は日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`
- **コミットしない。** 各タスクの最後は検証だけ（`npx vitest run <変更したテスト>`、タスクに書いた typecheck、変更した TypeScript のファイルへの `npx eslint --fix` → `npx eslint --max-warnings 0`）
- 共有の型（`src/shared/types/agentChanges.ts`）の名前と形（後のタスクはこのとおりに使う）:
  - `AGENT_CHANGES_MAX_RUNS = 10`
  - `AgentChangesBeginTrigger = 'send' | 'manual'`
  - `AgentChangesRunAvailability = { kind: 'available' } | { kind: 'start-not-recorded'; reason: AgentChangesUnavailableReason } | { kind: 'end-not-recorded' }`
  - `AgentChangesRun = { runId: number; number: number; startedAt: number; endedAt: number | null; availability: AgentChangesRunAvailability }`（`endedAt` は次の実行の開始の時刻。最後の実行は null）
  - `AgentChangesState` の `recording` は `{ kind: 'recording'; startedAt: number; runs: AgentChangesRun[] }`（`runs` は古い順。新しい順に並べ替えるのは renderer）
  - `AgentChangesScope = { kind: 'all' } | { kind: 'run'; runId: number }`、`AgentChangesScopeUnavailableReason = 'run-missing' | 'start-not-recorded' | 'end-not-recorded'`、`isSameAgentChangesScope(a, b): boolean`
  - `AgentChangesListResult = { kind: 'none' } | ({ kind: 'recording'; startedAt: number; runs: AgentChangesRun[]; scope: AgentChangesScope } & AgentChangesList) | { kind: 'scope-unavailable'; startedAt: number; runs: AgentChangesRun[]; scope: AgentChangesScope; reason: AgentChangesScopeUnavailableReason }`
- IPC の引数（preload の関数名・チャンネル・順序）: `beginAgentChanges(trigger)` → `agentChanges:begin`、`listAgentChanges(scope)` → `agentChanges:list`、`getAgentChangeDiff(path, scope)` → `agentChanges:getDiff`、`revertAgentChange(path, scope)` → `agentChanges:revertFile`、`revertAgentChangeHunk(path, patch, scope)` → `agentChanges:revertHunk`、`revertAllAgentChanges(expected, scope)` → `agentChanges:revertAll`。`getAgentChangesState()`・`clearAgentChanges()` は変えない。どの引数も必須（省略を既定に流さない。L-044）
- 入力の検証（`agentChangesPayloadParser.ts`）: `parseAgentChangesBeginTrigger` は `'send'`・`'manual'` 以外（`undefined` を含む）で `trigger は send か manual である必要があります`。`parseAgentChangesScope` はプレーンなオブジェクトでない・キーが許可リスト（`all` は `kind` だけ、`run` は `kind`・`runId` だけ）の外・`kind` が列挙の外・`runId` が `Number.isSafeInteger` でない・1 未満で `範囲(scope)が不正です`。`parseRevertScope` は `parseAgentChangesScope` の後に `kind !== 'all'` で `AGENT_CHANGES_REVERT_SCOPE_MESSAGE`。検証の順序は「送信元のメインフレームの確認 → 既存の引数（パッチ・確認の一覧）→ 範囲 → フォルダ → パス → 記録の列」で、検証の失敗は記録の列に入る前に拒否する
- main のエラーの文言: 戻す系に実行の範囲 `実行ごとの表示では戻せません。「すべて（累積）」を選んでから戻してください`（`AGENT_CHANGES_REVERT_SCOPE_MESSAGE`）、選べない範囲の diff `この実行の変更は表示できません（記録がありません）`（`AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE`）、blob・tree が消えた `実行前の内容が見つかりません（git gc などで消えた可能性があります）`（既存の `AGENT_BASELINE_BLOB_MISSING_MESSAGE`）
- 画面の文字（renderer。`lib/agentChangesMessages.ts` に置く）:
  - 範囲の選択のラベル `表示`（見える文字の `<label for>`）。項目: `すべて（累積・HH:MM から）`、選べる最後の実行 `実行 N（HH:MM から）`、選べる途中の実行 `実行 N（HH:MM〜HH:MM）`、開始を記録できなかった実行 `実行 N（HH:MM・開始の状態を記録できませんでした: <理由の短い形>）`、終わりを記録できなかった実行 `実行 N（HH:MM〜・次の実行の開始を記録できなかったため比べられません）`。項目は `すべて` の後に実行を新しい順。選べない実行は `disabled` の `<option>`。実行が 1 件も無い間は選択を出さない
  - 見出し: 累積は今どおり `エージェントの変更 (N)（HH:MM から）`。実行の範囲は `エージェントの変更 (N)（実行 3・HH:MM から）`（途中の実行は `（実行 3・HH:MM〜HH:MM）`）。件数 `(N)` は今と同じく 1 件以上のときだけ
  - 空の文言（実行の範囲）`この実行では、変わったファイルはありません`。HEAD の帯（実行の範囲）`この実行の間に HEAD が変わりました（コミット・ブランチの切り替えなど）`（`戻すのはファイルの内容だけです` は付けない）
  - 戻すの無効の理由 `実行ごとの表示では戻せません。「すべて（累積）」を選ぶと戻せます`（`AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE`。今の理由〈戻す操作の実行中・一覧の失敗・取得中・他の Git 操作〉の後の優先順位。一覧の上の理由の領域〈`reasonId`〉に出し `aria-describedby` で結ぶ）
  - 消えた実行の読み上げ `実行 N の記録は古くなったため消えました。すべて（累積）を表示します`（セクションの常設の aria-live。N は消える前の写しの番号）
  - 範囲の一覧が取れない（`scope-unavailable`）: `start-not-recorded` → `開始の状態を記録できませんでした: <理由の短い形>`（写しの実行に理由が無ければ `: <理由>` を付けない）、`end-not-recorded` → `次の実行の開始を記録できなかったため比べられません`
  - diff タブのラベル: 累積 `<path> (エージェントの変更)`、実行 `<path> (エージェントの変更・実行 N)`（N は diff の内容を取った範囲の実行の番号）
- 保持の上限: 実行は新しい方から `AGENT_CHANGES_MAX_RUNS`（10）件。11 件目を足したら一番古い実行を外し、その開始が区切り（`snapshot`）なら一時ディレクトリを列の中で消す（累積の始点・`failed` は消さない）。記録できなかった実行も 1 件に数える
- 実行の ID: `runId` は所有者ごとに 1 から単調に増える正の整数で、`clear`・所有者の文脈の終わりでも戻さない。`number` は記録の中の 1 からの番号（表示用）。renderer が範囲に渡すのは `runId`
- 自動の取り直し: `AUTO_REFRESH_WAIT_MS = 300`（最後の契機からの待ち）・`AUTO_REFRESH_MAX_WAIT_MS = 1000`（最初の未処理の契機からの上限）。どちらかが鳴ったら両方を取り消して走らせる。実行中の契機は終わった後に 1 回だけ走らせ直す。記録中でない間は契機を捨ててタイマーを張らない。契機は `advanceAgentNotifications` の `events`（通知の設定・方式に依らない）と、`window` の `focus`・`document` の `visibilitychange`（`visible` のときだけ）。取り直すのはエージェントの変更の一覧だけ（git status は取り直さない）で、`refresh({ announce: false })`
- 既存の契機（`変更を確認`・`更新`・git status の更新・セッションの終了）は今どおりすぐ取り直し、自動の合流に入れない
- 気をつける知見（dev-flow-kit の review-lessons.md）: **L-002**（終わりの区切りが無い実行を「今まで」に読み替えず選べなくする・写しの元が無いときに空から始めない）、**L-003**（一番古い区切りを消すのは新しい実行を一覧に足した後）、**L-004**（消すのは自分が作った区切りの一時ディレクトリだけ。累積の始点と共有する実行 1 は消さない）、**L-010**（`clear`・`close` はすべての区切りの削除を、1 つが失敗しても試す）、**L-019**（renderer が渡すのは範囲の列挙と `runId` だけ。記録のインデックス・tree は main が決める）、**L-034**（`runId` を git の引数に入れない。パスは `--` と `:(literal)` で渡す）、**L-037**（`runId` を記録をまたいで重ならない値にし、一覧・diff の結果を範囲と組で持って照合する）、**L-039**（戻す操作の実行中は範囲を変えられない）、**L-040**（範囲の違う古い一覧の結果を要求の番号と範囲で捨てる）、**L-044**（`trigger`・`scope` の省略・未知の値を例外にする）、**L-052**（区切りは git のコマンドごとの 10 秒の打ち切りと送信の前の 10 秒の待ちを引き継ぐ）、**L-057**（選べない実行の理由を項目の文字に、戻すの無効の理由を見える文字で出して `aria-describedby` で結ぶ）、**L-058**（戻すボタンを `disabled` にするだけでなく hook と main でも累積以外を拒む・範囲の選択も処理の側で止める）、**L-059**（実物の `claude` の活動の移り変わりと実物の git の区切りは、実 git の結合テストと実機テスト仕様書で確かめる）、**L-060**（`trigger`・`scope`・`agentTabs`・`agentActivities`・`agentScope`・`agentDiffScope` を必須にし、本物の hook どうしの結合テストを書く）、**L-061**（「実行の範囲（読み取り専用）」に対し、作業ツリーを書き換える入口〈行の `↶`・`すべて戻す`・diff タブのハンク〉をすべて塞ぐ）、**L-153**（消えた実行の読み上げは今の常設の aria-live に入れ、表示の切り替えで作り直さない）、**L-399**（デバウンスに最初の契機からの上限を付ける）、**L-417**（自動の取り直しの契機を出来事〈活動の確かな移り変わり・フォーカスのイベント〉にし、表示用の派生値の並びにしない）、**L-297**（実機テスト仕様書の項目が設計書の「エラー処理」の画面から通れる行と対応し、手順が確かめたい経路を通る）
- `react-hooks/set-state-in-effect`（eslint-plugin-react-hooks 7）: effect の本体で setState を直接呼ぶと lint が落ちる。値の変化の後始末は既存の `useOnChange` を使い、非同期の取得は Promise の解決の中で setState する
- テストの規約: タイマー（`setTimeout` の偽物・`vi.useFakeTimers()`）は `afterEach` で `vi.useRealTimers()` まで戻す（CLAUDE.md のタイマーリークの防止）。`act(...).then(...)` で書かない（Promise は変数に控え、`await act(async () => { ... })` の中で待つ）。`console.error`・`console.warn` の spy は `afterEach` で戻す。テストの補助関数にも戻り値の型を書く（`@typescript-eslint/explicit-function-return-type`）。実 git のテストは `createAgentBaselineRepo` / `disposeAgentBaselineRepo`（`src/main/__tests__/helpers/agentBaselineFixtures.ts`）で準備・後始末する
- 実装を戻すとテストが落ちることを、各タスクの TDD の手順で確かめる（失敗するテストを先に書いて走らせる）

---

### Task 1: 実測（未確認事項 1〜3）と `takeBaselineSnapshot` の拡張（`baseIndexPath`・`tree`）

**Files:**
- Modify: `src/main/agentBaselineSnapshot.ts`（`BaselineSnapshot` の型 L37-56 に `tree`、`TakeBaselineOptions` L66-72 に `baseIndexPath`、`takeBaselineSnapshot` L147-268 の手順）
- Modify: `src/main/__tests__/helpers/agentBaselineFixtures.ts`（`EMPTY_TREE`・`makeBaselineSnapshot` の既定の `tree`・`recordBaselineFrom`）
- Test: `src/main/__tests__/helpers/agentBaselineFixtures.test.ts`（既定値に `tree`）
- Test: `src/main/__tests__/agentBaselineSnapshot.integration.test.ts`（確認の数・新しい describe）
- 一時ファイル（計測の後に消す）: `src/main/__tests__/agentBaselineSnapshot.timing.local.test.ts`

**Interfaces:**
- Produces:
```ts
// src/main/agentBaselineSnapshot.ts
export interface BaselineSnapshot {
  /* 既存のフィールド */
  /** 記録のインデックスから `git write-tree` で作った tree の ID。途中の実行の比較(tree どうし)に使う */
  tree: string
}
export interface TakeBaselineOptions extends BaselineGitOptions {
  isCanceled?: () => boolean
  now?: () => number
  tempRoot?: string
  /** 写しの元(区切りは直前の取れた記録の indexPath)。指定が無ければ利用者の index。指定したファイルが無ければ git-failed */
  baseIndexPath?: string
}
export async function takeBaselineSnapshot(folderPath: string, options?: TakeBaselineOptions): Promise<BaselineSnapshotResult>
// src/main/__tests__/helpers/agentBaselineFixtures.ts
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
export function makeBaselineSnapshot(overrides?: Partial<BaselineSnapshot>): BaselineSnapshot // tree の既定は EMPTY_TREE
export async function recordBaselineFrom(repo: string, tempRoot: string, base: BaselineSnapshot): Promise<BaselineSnapshot>
```

- [ ] **Step 1: 補助関数のテストを直す（失敗させる）**

`src/main/__tests__/helpers/agentBaselineFixtures.test.ts` の import に `EMPTY_TREE` を足し、`describe('makeBaselineSnapshot')` の 2 つの `toEqual` の `head` の次の行に `tree: EMPTY_TREE,` を足す:
```ts
    expect(makeBaselineSnapshot()).toEqual({
      folderPath: '/repo',
      tempDir: '/tmp/baseline',
      indexPath: '/tmp/baseline/index',
      startedAt: 0,
      head: null,
      tree: EMPTY_TREE,
      excluded: [],
      skippedRepos: [],
      ignoredAtBaseline: []
    })
```
（2 つめの `toEqual` も `head: 'abc',` の次に `tree: EMPTY_TREE,`）

- [ ] **Step 2: 結合テストを書く（失敗させる）**

`src/main/__tests__/agentBaselineSnapshot.integration.test.ts`:

1. `node:fs` の import に `unlinkSync` を足す。`./helpers/agentBaselineFixtures` の import はそのまま（`recordedSnapshot` を使う）。
2. 既存の 2 つの確認の数のテスト（`it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])` と `'9 回の確認のどれでも取り消されなければ記録を返す'`）を次に置き換える:
```ts
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    '%i 回目の確認で取り消されたら canceled を返し、一時ディレクトリを残さない(パターン 141)',
    async (cancelAt) => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      let calls = 0
      const result = await takeBaselineSnapshot(repo, {
        tempRoot,
        isCanceled: () => ++calls >= cancelAt
      })
      expect(result).toEqual({ kind: 'canceled' })
      expect(readdirSync(tempRoot)).toEqual([])
    }
  )

  // 確認は 10 か所(リポジトリか・最上位・写しの元・写し・未追跡の検査・pathspec の書き込み・add・ignore 済みの一覧・HEAD・tree の後)。
  // 取り消されなければ記録が返る
  it('10 回の確認のどれでも取り消されなければ記録を返す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    let calls = 0
    const result = await takeBaselineSnapshot(repo, { tempRoot, isCanceled: () => ++calls >= 11 })
    expect(result.kind).toBe('recorded')
    expect(calls).toBe(10)
  })
```
3. ファイルの末尾に次の describe を足す（`realGit` を使う 2 つのテストは、既存の `'HEAD の取得が打ち切りになったら…'` と同じ偽の git の作り方）:
```ts
describe('takeBaselineSnapshot の tree と区切り(baseIndexPath)(実 git)', () => {
  const takeFrom = async (base?: BaselineSnapshot): Promise<BaselineSnapshot> =>
    recordedSnapshot(
      await takeBaselineSnapshot(repo, { tempRoot, baseIndexPath: base?.indexPath })
    )
  const treePaths = (tree: string): string[] =>
    runGit(repo, 'ls-tree', '-r', '--name-only', tree)
      .split('\n')
      .filter((path) => path !== '')
  // 偽の git: 引数に word があれば script を実行し、それ以外は本物の git に渡す
  const fakeGitOn = (word: string, script: string): void => {
    const realGit = execFileSync('which', ['git']).toString().trim()
    const bin = join(home, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(
      join(bin, 'git'),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = "${word}" ] && ${script}; done\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 }
    )
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
  }

  it('記録のインデックスから作った tree を控え、利用者の index・stash・ref・HEAD を変えない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('a.txt', 'a\nb\n')
    write('n.txt', 'n\n')
    runGit(repo, 'status', '--porcelain')
    const before = userState()
    const snapshot = await takeFrom()
    expect(userState()).toEqual(before)
    expect(snapshot.tree).toMatch(/^[0-9a-f]{40}$/)
    expect(runGit(repo, 'cat-file', '-t', snapshot.tree).trim()).toBe('tree')
    expect(treePaths(snapshot.tree)).toEqual(['a.txt', 'n.txt'])
  })

  it('区切りは直前の記録のインデックスを写し、利用者の index を変えずに、直前の記録の後の変更を入れる', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const first = await takeFrom()
    write('a.txt', 'a\nrun1\n')
    write('new.txt', 'n\n')
    runGit(repo, 'status', '--porcelain')
    const before = userState()
    const second = await takeFrom(first)
    expect(userState()).toEqual(before)
    expect(second.tempDir).not.toBe(first.tempDir)
    expect(await baselinePaths(second)).toEqual(['a.txt', 'new.txt'])
    expect(
      runGit(repo, 'diff-tree', '-r', '--name-status', '--no-renames', first.tree, second.tree)
        .trim()
        .split('\n')
    ).toEqual(['M\ta.txt', 'A\tnew.txt'])
  })

  it('区切りの未追跡の事前の検査は、直前の記録の後に現れたファイルだけを数える', async () => {
    mkdirSync(join(repo, 'many'))
    for (let i = 0; i < 5_000; i++) writeFileSync(join(repo, 'many', `${i}.txt`), '')
    const first = await takeFrom()
    write('one-more.txt', 'x\n')
    // 利用者の index から数えると 5,001 件で記録できない
    expect((await takeBaselineSnapshot(repo, { tempRoot })).kind).toBe('unavailable')
    const second = await takeFrom(first)
    expect(await baselinePaths(second)).toContain('one-more.txt')
  })

  it('写しの元が無ければ空から始めず git-failed にし、一時ディレクトリを残さない(L-002)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const first = await takeFrom()
    rmSync(first.tempDir, { recursive: true, force: true })
    const result = await takeBaselineSnapshot(repo, { tempRoot, baseIndexPath: first.indexPath })
    expect(result).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'git-failed' }
    })
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it('write-tree が打ち切りの時間を超えたら timeout を返し、一時ディレクトリを消す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    fakeGitOn('write-tree', 'exec sleep 5')
    const result = await takeBaselineSnapshot(repo, { tempRoot, timeoutMs: 500 })
    expect(result).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'timeout' }
    })
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it('write-tree が失敗したら git-failed を返し、一時ディレクトリを消す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    fakeGitOn('write-tree', 'exit 1')
    const result = await takeBaselineSnapshot(repo, { tempRoot })
    expect(result).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'git-failed' }
    })
    expect(readdirSync(tempRoot)).toEqual([])
  })

  // 未確認事項 2・3。計画の時点に git 2.50.1 の CLI で同じ手順を再現し、同じ tree になることを確かめた
  it('写しの元を直前の記録にしても .git/index から作っても同じ tree になる(未追跡・削除・ignore・入れ子のリポジトリ・5MB を超える新しいファイル)', async () => {
    write('a.txt', 'one\n')
    write('b.txt', 'b\n')
    write('.gitignore', 'ign/\n')
    commitAll(repo, 'init')
    write('user-untracked.txt', 'u\n')
    write('ign/x', 'i\n')
    const first = await takeFrom()
    write('a.txt', 'one\ntwo\n')
    unlinkSync(join(repo, 'b.txt'))
    write('new.txt', 'n\n')
    write('ign/y', 'j\n')
    write('bignew.bin', '')
    truncateSync(join(repo, 'bignew.bin'), 6 * 1024 * 1024)
    const nested = join(repo, 'nested')
    mkdirSync(nested)
    initRepo(nested)
    writeRepoFile(nested, 'z.txt', 'z\n')
    commitAll(nested, 'z')
    const empty = join(repo, 'emptyrepo')
    mkdirSync(empty)
    initRepo(empty)
    writeRepoFile(empty, 'n.txt', 'n\n')
    const fromRecord = await takeFrom(first)
    const fromUserIndex = await takeFrom()
    expect(fromRecord.tree).toBe(fromUserIndex.tree)
    expect(fromRecord.excluded.map((file) => file.path)).toEqual(['bignew.bin'])
    expect(fromUserIndex.excluded.map((file) => file.path)).toEqual(['bignew.bin'])
    expect(fromRecord.skippedRepos).toEqual(['emptyrepo/'])
    expect(fromUserIndex.skippedRepos).toEqual(['emptyrepo/'])
  })

  it('intent-to-add のエントリがあっても記録でき(write-tree が失敗しない)、どちらの写しの元でも同じ tree になる', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('ita0.txt', 'ita0\n')
    runGit(repo, 'add', '-N', 'ita0.txt')
    const first = await takeFrom()
    write('ita1.txt', 'ita1\n')
    runGit(repo, 'add', '-N', 'ita1.txt')
    const fromRecord = await takeFrom(first)
    const fromUserIndex = await takeFrom()
    expect(fromRecord.tree).toBe(fromUserIndex.tree)
    expect(treePaths(fromRecord.tree)).toEqual(['a.txt', 'ita0.txt', 'ita1.txt'])
  })

  it('コンフリクト中のエントリがあっても記録でき、どちらの写しの元でも同じ tree になる(作業ツリーに残す・消す)', async () => {
    write('f.txt', 'base\n')
    commitAll(repo, 'base')
    runGit(repo, 'checkout', '-qb', 'other')
    write('f.txt', 'other\n')
    commitAll(repo, 'other')
    runGit(repo, 'checkout', '-q', 'main')
    write('f.txt', 'mine\n')
    commitAll(repo, 'mine')
    const first = await takeFrom()
    expect(() => runGit(repo, 'merge', '-q', 'other')).toThrow()
    expect(runGit(repo, 'ls-files', '-u').trim()).not.toBe('')
    const kept = await takeFrom(first)
    expect(kept.tree).toBe((await takeFrom()).tree)
    unlinkSync(join(repo, 'f.txt'))
    const removed = await takeFrom(kept)
    expect(removed.tree).toBe((await takeFrom()).tree)
  })

  // 計画の時点の実測で、写しの元によって tree が違った唯一の場合(既知の制約に書く)
  it('前の記録で追跡していた 5MB を超えるファイルを利用者が git rm --cached すると、区切りは記録し続け、.git/index からは除外する', async () => {
    write('big.bin', '')
    truncateSync(join(repo, 'big.bin'), 6 * 1024 * 1024)
    commitAll(repo, 'big')
    const first = await takeFrom()
    runGit(repo, 'rm', '-q', '--cached', 'big.bin')
    const fromRecord = await takeFrom(first)
    const fromUserIndex = await takeFrom()
    expect(await baselinePaths(fromRecord)).toEqual(['big.bin'])
    expect(fromRecord.excluded).toEqual([])
    expect(await baselinePaths(fromUserIndex)).toEqual([])
    expect(fromUserIndex.excluded.map((file) => file.path)).toEqual(['big.bin'])
  })
})
```

- [ ] **Step 3: テストを走らせて失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts`
Expected: FAIL（`tree` が無い・`baseIndexPath` が効かない・確認が 9 回など）

- [ ] **Step 4: 実装する**

`src/main/agentBaselineSnapshot.ts`:

1. import に `import type { SimpleGit } from 'simple-git'` を足す。
2. `BaselineSnapshot` の `head` の次に足す:
```ts
  /** 記録のインデックスから `git write-tree` で作った tree の ID。途中の実行の比較(tree どうし)に使う(利用者の index を読まない) */
  tree: string
```
3. `TakeBaselineOptions` に足す:
```ts
  /**
   * 写しの元。区切りは直前の取れた記録の indexPath を渡す(直前の記録の stat の情報が使え、未追跡の事前の検査が直前の記録の後に
   * 現れたファイルだけを数える)。指定が無ければ利用者の index。指定したファイルが無ければ空から始めず git-failed にする(L-002)
   */
  baseIndexPath?: string
```
4. `canonical` の後に足す:
```ts
// 利用者の index の場所(worktree の .git はファイルのため、git に聞く。相対ならリポジトリの最上位から)
async function userIndexPathOf(repoGit: SimpleGit, folderPath: string): Promise<string> {
  const userIndex = stripTrailingNewline(await repoGit.raw(['rev-parse', '--git-path', 'index']))
  return isAbsolute(userIndex) ? userIndex : join(folderPath, userIndex)
}
```
5. `takeBaselineSnapshot` の説明と本体を次にする（`inspectUntracked`・`removeBaselineDir` などはそのまま）:
```ts
/**
 * 記録を取る。手順: リポジトリの最上位か → 一時ディレクトリ → 写し(baseIndexPath、無ければ .git/index。.git/index が無ければ空)→
 * 未追跡の事前の検査(写しの元と同じ index で問い合わせる)→ `git add -A`(除外したファイルを pathspec で外す)→ HEAD → tree を控える。
 * 各 git に打ち切り(既定 10 秒)
 */
export async function takeBaselineSnapshot(
  folderPath: string,
  {
    isCanceled = () => false,
    now = Date.now,
    tempRoot = tmpdir(),
    baseIndexPath,
    ...gitOptions
  }: TakeBaselineOptions = {}
): Promise<BaselineSnapshotResult> {
  const startedAt = now()
  const repoGit = createRepoGit(folderPath, gitOptions)
  let tempDir: string | null = null
  const checkpoint = (): void => {
    if (isCanceled()) throw new SnapshotCanceled()
  }
  try {
    const isRepo = await repoGit.checkIsRepo()
    checkpoint()
    if (!isRepo)
      return { kind: 'unavailable', state: { kind: 'unavailable', reason: 'not-repository' } }
    const toplevel = stripTrailingNewline(await repoGit.raw(['rev-parse', '--show-toplevel']))
    checkpoint()
    if ((await canonical(toplevel)) !== (await canonical(folderPath))) {
      return { kind: 'unavailable', state: { kind: 'unavailable', reason: 'not-toplevel' } }
    }
    tempDir = await mkdtemp(join(tempRoot, TEMP_DIR_PREFIX))
    const indexPath = join(tempDir, 'index')
    const sourceIndex = baseIndexPath ?? (await userIndexPathOf(repoGit, folderPath))
    checkpoint()
    // 写しから始めると stat の情報が使え、変わっていないファイルを読み直さない。コミットの無いリポジトリは index が無く、
    // 空から始める(確認の結果 15)。区切りの写しの元が無いのは記録の一時ディレクトリが失われた異常で、空から始めると
    // 全ファイルを追加として記録するため、例外にして git-failed にする(L-002)
    await copyFile(sourceIndex, indexPath, fsConstants.COPYFILE_EXCL).catch(
      (error: NodeJS.ErrnoException) => {
        if (baseIndexPath !== undefined || error.code !== 'ENOENT') throw error
      }
    )
    checkpoint()
    // 未追跡の事前の検査。区切りは写した記録のインデックスで問い合わせ、直前の記録の後に現れたファイルだけを数える
    // (実行の前から利用者が持っていた未追跡のファイルを、送るたびに数え直さない)
    const inspectGit =
      baseIndexPath === undefined ? repoGit : createBaselineGit(folderPath, indexPath, gitOptions)
    const inspection = await inspectUntracked(
      folderPath,
      await inspectGit.raw(['ls-files', '-z', '--others', '--exclude-standard']),
      gitOptions
    )
    checkpoint()
    if (inspection.kind === 'too-many') {
      await removeBaselineDir(tempDir)
      return {
        kind: 'unavailable',
        state: {
          kind: 'unavailable',
          reason: 'too-many-untracked',
          untrackedCount: inspection.count,
          untrackedBytes: inspection.bytes
        }
      }
    }
    // 除外の pathspec は数が多くても引数の長さの上限に触れないよう、一時ディレクトリのファイルで渡す
    const pathspecFile = join(tempDir, 'pathspec')
    const pathspecs = [
      '.',
      ...[
        ...inspection.excluded.map((file) => file.path),
        ...inspection.skippedRepos.map((path) => path.slice(0, -1))
      ].map((path) => `:(exclude,literal)${path}`)
    ]
    await writeFile(pathspecFile, pathspecs.map((spec) => `${spec}\0`).join(''), { flag: 'wx' })
    checkpoint()
    const baselineGit = createBaselineGit(folderPath, indexPath, {
      ...gitOptions,
      // core.splitIndex=false は createBaselineGit が常に付ける
      config: ['advice.addEmbeddedRepo=false']
    })
    await baselineGit.raw([
      'add',
      '-A',
      `--pathspec-from-file=${pathspecFile}`,
      '--pathspec-file-nul'
    ])
    checkpoint()
    // 記録の時点の ignore 済みの一覧(A-1)。--directory で ignore されたフォルダは 1 行にまとまり、git はその中へ降りないため、
    // node_modules などが大きくても未追跡の検査(上の ls-files --others)と同程度の走査で済む。打ち切りは他の git と同じ
    const ignoredAtBaseline = parseNulSeparatedPaths(
      await baselineGit.raw([
        'ls-files',
        '-z',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--directory'
      ])
    )
    checkpoint()
    // コミットが無いときは -q で出力が空になる(失敗にならない)。打ち切りなどの失敗は握らず、呼び出し側で扱う
    const head = (await repoGit.raw(['rev-parse', '--verify', '-q', 'HEAD'])).trim() || null
    checkpoint()
    // 途中の実行の比較(tree どうしの diff-tree・diff)のため、記録のインデックスから tree を作る。blob は add で書いてあり、
    // ここで書くのは tree の object だけ(利用者の index は変えない)。失敗・打ち切りは記録の失敗と同じ扱い
    const tree = (await baselineGit.raw(['write-tree'])).trim()
    checkpoint()
    return {
      kind: 'recorded',
      snapshot: {
        folderPath,
        tempDir,
        indexPath,
        startedAt,
        head,
        tree,
        excluded: inspection.excluded,
        skippedRepos: inspection.skippedRepos,
        ignoredAtBaseline
      }
    }
  } catch (error) {
    if (tempDir !== null) await removeBaselineDir(tempDir)
    if (error instanceof SnapshotCanceled) return { kind: 'canceled' }
    if (isGitTimeoutError(error)) {
      return { kind: 'unavailable', state: { kind: 'unavailable', reason: 'timeout' } }
    }
    return { kind: 'unavailable', state: { kind: 'unavailable', reason: 'git-failed' } }
  }
}
```
6. ファイルの冒頭のコメント（L12-14）の 2 行目を「.git/index（区切りは直前の記録のインデックス）をアプリの一時ディレクトリ(0700)へ写し、…」に直す。

`src/main/__tests__/helpers/agentBaselineFixtures.ts`:
```ts
/** 空の tree の ID(makeBaselineSnapshot の tree の既定値) */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
```
を `makeBaselineSnapshot` の前に足し、`makeBaselineSnapshot` の戻り値の `head: null,` の次に `tree: EMPTY_TREE,` を足す。`recordBaseline` の次に足す:
```ts
// 区切りを取る(写しの元は base の記録のインデックス)。recorded でなければ例外
export async function recordBaselineFrom(
  repo: string,
  tempRoot: string,
  base: BaselineSnapshot
): Promise<BaselineSnapshot> {
  return recordedSnapshot(await takeBaselineSnapshot(repo, { tempRoot, baseIndexPath: base.indexPath }))
}
```

- [ ] **Step 5: テストを走らせて通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentBaselineSnapshot.integration.test.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentBaselineSnapshot.test.ts`
Expected: PASS。未確認事項 2・3 の 3 つのテスト（同じ tree・intent-to-add・コンフリクト）と `git rm --cached` のテストが計画の時点の結果と違って落ちたら、期待値を書き換えずに止め、実際の tree の違い（`git ls-tree -r <tree>` の差）を報告する。

- [ ] **Step 6: 区切りの取得の時間を計る（未確認事項 1。一時ファイル）**

`src/main/__tests__/agentBaselineSnapshot.timing.local.test.ts` を作る:
```ts
import { it, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { takeBaselineSnapshot } from '../agentBaselineSnapshot'
import { commitAll, initRepo, runGit, stubGitHome, stubIsolatedGitEnv } from './helpers/realGitRepo'

// 未確認事項 1 の計測(一時ファイル。計測が終わったら消す)。2 回目以降の値を見る
let root: string
beforeEach(() => {
  stubIsolatedGitEnv()
  root = mkdtempSync(join(tmpdir(), 'baseline-timing-'))
  stubGitHome(root)
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

async function measure(label: string, folder: string, base?: string): Promise<string> {
  const times: number[] = []
  let indexPath = ''
  for (let i = 0; i < 3; i++) {
    const started = performance.now()
    const result = await takeBaselineSnapshot(folder, { tempRoot: root, baseIndexPath: base })
    times.push(performance.now() - started)
    if (result.kind !== 'recorded') throw new Error(`${label}: ${JSON.stringify(result)}`)
    indexPath = result.snapshot.indexPath
  }
  console.log(`${label}: ${times.map((t) => t.toFixed(1)).join(' / ')} ms`)
  return indexPath
}

it('このリポジトリの写し', async () => {
  const copy = join(root, 'copy')
  runGit(root, 'clone', '-q', '--local', process.cwd(), copy)
  const first = await measure('写し: .git/index から', copy)
  for (let i = 0; i < 5; i++) writeFileSync(join(copy, `changed-${i}.txt`), `${i}\n`)
  await measure('写し: 直前の記録から(5 ファイルの変更)', copy, first)
  await measure('写し: .git/index から(5 ファイルの変更)', copy)
}, 120_000)

it('追跡済み 10,000 ファイル', async () => {
  const repo = join(root, 'big')
  mkdirSync(repo)
  initRepo(repo)
  for (let d = 0; d < 100; d++) {
    mkdirSync(join(repo, `d${d}`))
    for (let f = 0; f < 100; f++) writeFileSync(join(repo, `d${d}`, `f${f}.txt`), `${d}-${f}\n`)
  }
  commitAll(repo, 'init')
  const first = await measure('10,000: .git/index から', repo)
  for (let i = 0; i < 50; i++) writeFileSync(join(repo, `d${i}`, 'f0.txt'), `changed ${i}\n`)
  await measure('10,000: 直前の記録から(50 ファイルの変更)', repo, first)
  await measure('10,000: .git/index から(50 ファイルの変更)', repo)
}, 300_000)
```
Run: `npx vitest run src/main/__tests__/agentBaselineSnapshot.timing.local.test.ts --reporter verbose`
Expected: PASS。出力の各行の値（ミリ秒）をタスクの報告にそのまま書く（コントローラーが Task 8 の既知の制約「送るたびに区切りの取得の分だけ送信が遅れる」の見込みの値を実測の値に直すのに使う）。1 回が 1 秒を超える行があれば、報告で目立たせる。
計測が終わったら消す: `rm src/main/__tests__/agentBaselineSnapshot.timing.local.test.ts`

- [ ] **Step 7: 検証**

Run: `npx vitest run src/main/__tests__/agentBaseline* src/main/__tests__/helpers src/main/__tests__/agentChanges* src/main/__tests__/handlers/agentChanges*`
Expected: PASS（`tree` の既定値が入り、既存の一覧・戻す・handler のテストも変わらず通る）
Run: `npm run typecheck`
Expected: エラーなし
Run: `npx eslint --fix src/main/agentBaselineSnapshot.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts && npx eslint --max-warnings 0 src/main/agentBaselineSnapshot.ts src/main/__tests__/helpers/agentBaselineFixtures.ts src/main/__tests__/helpers/agentBaselineFixtures.test.ts src/main/__tests__/agentBaselineSnapshot.integration.test.ts`
Expected: エラー・警告なし。`git status --porcelain` に計測の一時ファイルが残っていない

---
### Task 2: 途中の実行の一覧と diff（`listAgentChangesBetween`・`getAgentChangeDiffBetween`）

**Files:**
- Modify: `src/main/agentBaselineCoverage.ts`（`toBaselineQueryError` L13-18 の判定に `bad object <sha>`）
- Modify: `src/main/agentChangesQuery.ts`（パスの順の比較を `byPath` に切り出し、`collectAgentChangeEntriesBetween`・`listAgentChangesBetween` を足す）
- Modify: `src/main/agentChangeDiff.ts`（`getAgentChangeDiffBetween` を足す）
- Test: `src/main/__tests__/agentBaselineCoverage.test.ts`（`describe('toBaselineQueryError')` に 1 件）
- Create: `src/main/__tests__/agentChangesRuns.integration.test.ts`

**Interfaces:**
- Consumes: `BaselineSnapshot.tree`、`recordBaseline(repo, tempRoot)`・`recordBaselineFrom(repo, tempRoot, base)`（Task 1）
- Produces:
```ts
// src/main/agentChangesQuery.ts
/** 途中の実行(開始の区切り start → 次の区切り end)の変更のすべて(打ち切らない)。パスの順。tree どうしを比べ、利用者の index と作業ツリーを読まない */
export async function collectAgentChangeEntriesBetween(start: BaselineSnapshot, end: BaselineSnapshot, options?: BaselineGitOptions): Promise<AgentChangeEntry[]>
/** 上を AGENT_CHANGES_LIST_LIMIT 件で打ち切り、headChanged は start.head !== end.head */
export async function listAgentChangesBetween(start: BaselineSnapshot, end: BaselineSnapshot, options?: BaselineGitOptions): Promise<AgentChangesList>
// src/main/agentChangeDiff.ts
/** 途中の実行の 1 ファイルの diff(start.tree → end.tree)。どちらかの端で記録しなかったパスは NOT_RECORDED_DIFF_MESSAGE */
export async function getAgentChangeDiffBetween(start: BaselineSnapshot, end: BaselineSnapshot, filePath: string, options?: BaselineGitOptions): Promise<string>
```

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentBaselineCoverage.test.ts` の `describe('toBaselineQueryError')` に足す:
```ts
  it('bad object <sha>(tree が gc で消えた。diff-tree・tree どうしの diff)も blob 欠落の文言に置き換える', () => {
    const original = new Error('fatal: bad object 08585692ce06452da6f82ae66b90d98b55536fca')
    const converted = toBaselineQueryError(original)
    expect((converted as Error).message).toBe(AGENT_BASELINE_BLOB_MISSING_MESSAGE)
    expect((converted as Error).cause).toBe(original)
  })
```

`src/main/__tests__/agentChangesRuns.integration.test.ts` を作る:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, truncateSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_BASELINE_BLOB_MISSING_MESSAGE } from '../agentBaselineCoverage'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import {
  NOT_RECORDED_DIFF_MESSAGE,
  getAgentChangeDiff,
  getAgentChangeDiffBetween
} from '../agentChangeDiff'
import { listAgentChanges, listAgentChangesBetween } from '../agentChangesQuery'
import { commitAll, initRepo, runGit, writeRepoFile } from './helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  disposeAgentBaselineRepo,
  recordBaseline,
  recordBaselineFrom,
  userRepoState
} from './helpers/agentBaselineFixtures'

// 実行ごとの記録(設計書「範囲ごとの一覧と diff」)。累積の始点 → 区切り → 区切り と取り、途中の実行は tree どうし、
// 最後の実行は開始の区切りと作業ツリーを比べる

let repo: string
let home: string
let tempRoot: string
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)

beforeEach(() => {
  ;({ repo, home, tempRoot } = createAgentBaselineRepo('agent-changes-runs-'))
})

afterEach(() => disposeAgentBaselineRepo({ repo, home, tempRoot }))

const startRun = (base: BaselineSnapshot): Promise<BaselineSnapshot> =>
  recordBaselineFrom(repo, tempRoot, base)

const entry = (
  path: string,
  status: 'A' | 'M' | 'D' | 'T',
  extra: { isDirectory?: boolean; notRecorded?: boolean } = {}
): unknown => ({ path, status, isDirectory: false, notRecorded: false, ...extra })

// diff の変更の行(+++・--- のヘッダーを除く)
const changedLines = (diff: string): string[] =>
  diff.split('\n').filter((line) => /^[+-][^+-]/.test(line))

const big = 6 * 1024 * 1024
const writeBig = (path: string, size = big): void => {
  write(path, '')
  truncateSync(join(repo, path), size)
}

describe('実行ごとの一覧と diff(実 git)', () => {
  it('区切りを 2 つ取ると、途中の実行・最後の実行・累積の一覧が、それぞれの範囲の変更だけになる', async () => {
    write('a.txt', 'one\ntwo\nthree\n')
    write('b.txt', 'b\n')
    commitAll(repo, 'init')
    const baseline = await recordBaseline(repo, tempRoot)
    write('a.txt', 'one\ntwo\nthree\nrun1\n')
    const run2 = await startRun(baseline)
    write('a.txt', 'ONE\ntwo\nthree\nrun1\n')
    write('c.txt', 'c\n')
    const run3 = await startRun(run2)
    write('b.txt', 'b\nrun3\n')
    // 実行 1(途中): a.txt だけ
    expect((await listAgentChangesBetween(baseline, run2)).entries).toEqual([entry('a.txt', 'M')])
    // 実行 2(途中): a.txt と c.txt
    expect((await listAgentChangesBetween(run2, run3)).entries).toEqual([
      entry('a.txt', 'M'),
      entry('c.txt', 'A')
    ])
    // 実行 3(最後): 開始の区切り → 作業ツリー
    expect((await listAgentChanges(run3)).entries).toEqual([entry('b.txt', 'M')])
    // 累積: 始点 → 作業ツリー
    expect((await listAgentChanges(baseline)).entries).toEqual([
      entry('a.txt', 'M'),
      entry('b.txt', 'M'),
      entry('c.txt', 'A')
    ])
  })

  it('同じファイルを実行 1 と実行 2 で変えると、実行 2 の diff は実行 2 の行だけで、文脈に実行 1 の行が入る', async () => {
    write('a.txt', 'one\ntwo\nthree\n')
    commitAll(repo, 'init')
    const baseline = await recordBaseline(repo, tempRoot)
    write('a.txt', 'one\ntwo\nthree\nrun1\n')
    const run2 = await startRun(baseline)
    write('a.txt', 'ONE\ntwo\nthree\nrun1\n')
    expect(changedLines(await getAgentChangeDiffBetween(baseline, run2, 'a.txt'))).toEqual([
      '+run1'
    ])
    // 最後の実行(開始の区切り → 作業ツリー)
    const lastDiff = await getAgentChangeDiff(run2, 'a.txt')
    expect(changedLines(lastDiff)).toEqual(['-one', '+ONE'])
    expect(lastDiff).toContain(' run1')
    // 同じ範囲を途中の実行として比べても同じ(tree どうし)
    const run3 = await startRun(run2)
    const betweenDiff = await getAgentChangeDiffBetween(run2, run3, 'a.txt')
    expect(changedLines(betweenDiff)).toEqual(['-one', '+ONE'])
    expect(betweenDiff).toContain(' run1')
    expect(betweenDiff).toContain('--- a/a.txt')
  })

  it('区切り・diff-tree・tree どうしの diff の前後で、利用者の index・stash・ref・HEAD が変わらない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('a.txt', 'a\nuser\n')
    runGit(repo, 'add', 'a.txt')
    runGit(repo, 'status', '--porcelain')
    const before = userRepoState(repo)
    const baseline = await recordBaseline(repo, tempRoot)
    write('a.txt', 'a\nuser\nrun1\n')
    const run2 = await startRun(baseline)
    await listAgentChangesBetween(baseline, run2)
    await getAgentChangeDiffBetween(baseline, run2, 'a.txt')
    expect(userRepoState(repo)).toEqual(before)
  })

  it('途中の実行は新しいフォルダを 1 行にまとめず、ファイルごとの行にする', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const baseline = await recordBaseline(repo, tempRoot)
    write('newdir/x.txt', 'x\n')
    write('newdir/y.txt', 'y\n')
    const run2 = await startRun(baseline)
    expect((await listAgentChangesBetween(baseline, run2)).entries).toEqual([
      entry('newdir/x.txt', 'A'),
      entry('newdir/y.txt', 'A')
    ])
    // 最後の実行(作業ツリーとの比較)は今どおり 1 行にまとめる
    expect((await listAgentChanges(baseline)).entries).toEqual([
      entry('newdir/', 'A', { isDirectory: true })
    ])
  })

  it('途中の実行の一覧は 500 件で打ち切り、全件数を返す', async () => {
    write('keep.txt', 'k\n')
    commitAll(repo, 'init')
    const baseline = await recordBaseline(repo, tempRoot)
    mkdirSync(join(repo, 'many'))
    for (let i = 0; i < 501; i++)
      writeFileSync(join(repo, 'many', `${String(i).padStart(3, '0')}.txt`), `${i}\n`)
    const run2 = await startRun(baseline)
    const list = await listAgentChangesBetween(baseline, run2)
    expect(list.entries).toHaveLength(500)
    expect(list.totalCount).toBe(501)
    expect(list.truncated).toBe(true)
  })

  it('途中の実行の間に HEAD が変わったら headChanged、変わらなければ false', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const baseline = await recordBaseline(repo, tempRoot)
    write('a.txt', 'b\n')
    const run2 = await startRun(baseline)
    commitAll(repo, 'agent')
    write('c.txt', 'c\n')
    const run3 = await startRun(run2)
    expect((await listAgentChangesBetween(baseline, run2)).headChanged).toBe(false)
    expect((await listAgentChangesBetween(run2, run3)).headChanged).toBe(true)
  })

  describe('記録しなかったパス', () => {
    it('5MB を超えるファイルを実行の途中で作ると A、消すと D、大きさ・更新時刻を変えると M で、どれも notRecorded', async () => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      writeBig('kept.bin')
      writeBig('resized.bin')
      writeBig('touched.bin')
      writeBig('gone.bin')
      const baseline = await recordBaseline(repo, tempRoot)
      writeBig('created.bin')
      truncateSync(join(repo, 'resized.bin'), big + 1)
      utimesSync(join(repo, 'touched.bin'), new Date(), new Date(Date.now() + 5_000))
      unlinkSync(join(repo, 'gone.bin'))
      const run2 = await startRun(baseline)
      expect((await listAgentChangesBetween(baseline, run2)).entries).toEqual([
        entry('created.bin', 'A', { notRecorded: true }),
        entry('gone.bin', 'D', { notRecorded: true }),
        entry('resized.bin', 'M', { notRecorded: true }),
        entry('touched.bin', 'M', { notRecorded: true })
      ])
      expect(await getAgentChangeDiffBetween(baseline, run2, 'created.bin')).toBe(
        NOT_RECORDED_DIFF_MESSAGE
      )
    })

    it('実行の途中で作ったコミットの無い入れ子のリポジトリは、フォルダの A の notRecorded の行', async () => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      const baseline = await recordBaseline(repo, tempRoot)
      const nested = join(repo, 'emptyrepo')
      mkdirSync(nested)
      initRepo(nested)
      writeRepoFile(nested, 'n.txt', 'n\n')
      const run2 = await startRun(baseline)
      expect((await listAgentChangesBetween(baseline, run2)).entries).toEqual([
        entry('emptyrepo/', 'A', { isDirectory: true, notRecorded: true })
      ])
      expect(await getAgentChangeDiffBetween(baseline, run2, 'emptyrepo')).toBe(
        NOT_RECORDED_DIFF_MESSAGE
      )
    })

    // 計画の時点で調整した細部: 累積の一覧と同じく、ignore されたファイルの出現・削除は出さない
    it('実行の途中で ignore されたファイル・フォルダが現れても消えても、行にしない', async () => {
      write('.gitignore', 'build/\ndist/\n*.log\n')
      write('build/old.js', 'o\n')
      write('old.log', 'o\n')
      commitAll(repo, 'init')
      const baseline = await recordBaseline(repo, tempRoot)
      write('build/new.js', 'n\n')
      write('dist/app.js', 'a\n')
      write('new.log', 'n\n')
      unlinkSync(join(repo, 'old.log'))
      const run2 = await startRun(baseline)
      expect(run2.ignoredAtBaseline).toContain('dist/')
      expect((await listAgentChangesBetween(baseline, run2)).entries).toEqual([])
    })

    it('始まりで ignore されていて終わりで記録したパスは、M の notRecorded の 1 行(両端に何かがある)', async () => {
      write('.gitignore', 'secret.txt\n')
      commitAll(repo, 'init')
      write('secret.txt', 's\n')
      const baseline = await recordBaseline(repo, tempRoot)
      write('.gitignore', '')
      const run2 = await startRun(baseline)
      expect((await listAgentChangesBetween(baseline, run2)).entries).toEqual([
        entry('.gitignore', 'M'),
        entry('secret.txt', 'M', { notRecorded: true })
      ])
      expect(await getAgentChangeDiffBetween(baseline, run2, 'secret.txt')).toBe(
        NOT_RECORDED_DIFF_MESSAGE
      )
    })
  })

  it('gc --prune=now の後は、途中の実行の一覧・diff が gc の文言で失敗する', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const baseline = await recordBaseline(repo, tempRoot)
    write('a.txt', 'a\nrun1\n')
    const run2 = await startRun(baseline)
    runGit(repo, 'gc', '-q', '--prune=now')
    await expect(listAgentChangesBetween(baseline, run2)).rejects.toThrow(
      AGENT_BASELINE_BLOB_MISSING_MESSAGE
    )
    await expect(getAgentChangeDiffBetween(baseline, run2, 'a.txt')).rejects.toThrow(
      AGENT_BASELINE_BLOB_MISSING_MESSAGE
    )
  })
})
```

- [ ] **Step 2: テストを走らせて失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesRuns.integration.test.ts src/main/__tests__/agentBaselineCoverage.test.ts`
Expected: FAIL（`listAgentChangesBetween`・`getAgentChangeDiffBetween` が無い・`bad object` を置き換えない）

- [ ] **Step 3: 実装する**

`src/main/agentBaselineCoverage.ts` の `toBaselineQueryError` を次にする（コメントも直す）:
```ts
// 記録のインデックスが指す blob が無いと、diff は `fatal: unable to read <sha>` で失敗する。途中の実行の tree が無いと、
// diff-tree・tree どうしの diff は `fatal: bad object <sha>` で失敗する(計画の時点に git 2.50.1 で実測)。分かる文言に置き換える
export function toBaselineQueryError(error: unknown): unknown {
  return error instanceof Error && /(?:unable to read|bad object) [0-9a-f]{7,}/.test(error.message)
    ? new Error(AGENT_BASELINE_BLOB_MISSING_MESSAGE, { cause: error })
    : error
}
```

`src/main/agentChangesQuery.ts`:
1. import を直す: `@shared/types` から `toAgentChangeRelativePath` を値として足す。`./agentBaselineCoverage` から `isNotRecordedPath` を足す。
2. `toStatus` の前に足す:
```ts
// 一覧の並び(パスの順。git の表記のままバイト順に近い比較)
const byPath = (a: AgentChangeEntry, b: AgentChangeEntry): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0
```
3. `collectAgentChangeEntries` の最後の `return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))` を `return entries.sort(byPath)` にする。
4. ファイルの末尾に足す:
```ts
// 途中の実行の、記録から除外した(5MB を超える)ファイルの変化。両端の控え(有無・大きさ・更新時刻)で分かるものだけを出す。
// 片方の端にだけ控えがあるときは、もう片方の端で別の理由(ignore 済み・入れ子のリポジトリ)で記録していなければ、出現・削除とする
function excludedChangesBetween(start: BaselineSnapshot, end: BaselineSnapshot): AgentChangeEntry[] {
  const before = new Map(start.excluded.map((file) => [file.path, file]))
  const after = new Map(end.excluded.map((file) => [file.path, file]))
  const result: AgentChangeEntry[] = []
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(path)
    const a = after.get(path)
    let status: AgentChangeStatus | null
    if (b !== undefined && a !== undefined) {
      status = b.size !== a.size || b.mtimeMs !== a.mtimeMs ? 'M' : null
    } else if (a !== undefined) {
      status = isNotRecordedPath(start, path) ? null : 'A'
    } else {
      status = isNotRecordedPath(end, path) ? null : 'D'
    }
    if (status !== null) result.push({ path, status, isDirectory: false, notRecorded: true })
  }
  return result
}

// 途中の実行の、コミットの無い入れ子のリポジトリ('<dir>/')の出現・削除。中身を記録していないため有無だけで見る
// (両端にあるときは出さない。中身が変わっても分からない。既知の制約)
function skippedRepoChangesBetween(
  start: BaselineSnapshot,
  end: BaselineSnapshot
): AgentChangeEntry[] {
  const result: AgentChangeEntry[] = []
  for (const repo of new Set([...start.skippedRepos, ...end.skippedRepos])) {
    const inStart = start.skippedRepos.includes(repo)
    const inEnd = end.skippedRepos.includes(repo)
    if (inStart === inEnd) continue
    // もう片方の端で ignore 済みなどで記録していなければ、有無が分からないため出さない
    if (isNotRecordedPath(inEnd ? start : end, toAgentChangeRelativePath(repo))) continue
    result.push({ path: repo, status: inEnd ? 'A' : 'D', isDirectory: true, notRecorded: true })
  }
  return result
}

/**
 * 途中の実行(開始の区切り start → 次の区切り end)の変更のすべて(打ち切らない)。パスの順。
 * `git diff-tree` で tree どうしを比べ、利用者の index と作業ツリーを読まない(設計書「範囲ごとの一覧と diff」)。
 * 新しいフォルダを 1 行にまとめない。どちらかの端で記録しなかったパスは、tree の差分の行から外して notRecorded の行にする。
 * ignore 済みのファイルの出現・削除は、累積の一覧と同じく出さない
 */
export async function collectAgentChangeEntriesBetween(
  start: BaselineSnapshot,
  end: BaselineSnapshot,
  options: BaselineGitOptions = {}
): Promise<AgentChangeEntry[]> {
  // 記録の git と同じ環境(利用者の別のリポジトリ・object の置き場を指す変数を除く)で問い合わせる。diff-tree は index を読まない
  const git = createBaselineGit(start.folderPath, start.indexPath, options)
  const tracked = parseNameStatus(
    await git
      .raw(['diff-tree', '-r', '-z', '--name-status', '--no-renames', start.tree, end.tree])
      .catch((error: unknown) => {
        throw toBaselineQueryError(error)
      })
  )
  const entries: AgentChangeEntry[] = []
  const listed = new Set<string>()
  const add = (entry: AgentChangeEntry): void => {
    entries.push(entry)
    listed.add(toAgentChangeRelativePath(entry.path))
  }
  for (const { path, status } of tracked) {
    // どちらかの端で記録しなかったパスは、片方は tree・もう片方は記録の外にある(両端に何かがある)。中身を比べられないため
    // M の notRecorded の 1 行にする
    if (isNotRecordedPath(start, path) || isNotRecordedPath(end, path)) {
      add({ path, status: 'M', isDirectory: false, notRecorded: true })
    } else {
      add({ path, status, isDirectory: false, notRecorded: false })
    }
  }
  for (const entry of [
    ...excludedChangesBetween(start, end),
    ...skippedRepoChangesBetween(start, end)
  ]) {
    if (!listed.has(toAgentChangeRelativePath(entry.path))) add(entry)
  }
  return entries.sort(byPath)
}

/** 途中の実行の変更の一覧。AGENT_CHANGES_LIST_LIMIT 件で打ち切り、範囲の両端で HEAD が変わったかを添える */
export async function listAgentChangesBetween(
  start: BaselineSnapshot,
  end: BaselineSnapshot,
  options: BaselineGitOptions = {}
): Promise<AgentChangesList> {
  const entries = await collectAgentChangeEntriesBetween(start, end, options)
  return {
    entries: entries.slice(0, AGENT_CHANGES_LIST_LIMIT),
    totalCount: entries.length,
    truncated: entries.length > AGENT_CHANGES_LIST_LIMIT,
    headChanged: start.head !== end.head
  }
}
```

`src/main/agentChangeDiff.ts` の末尾に足す:
```ts
/**
 * 途中の実行の 1 ファイルの diff(開始の区切り start の tree → 次の区切り end の tree)。getDiff と同じ引数(-U3)。
 * 追加・削除のファイルも git の出力のまま。どちらかの端で記録しなかったパスは、記録していない旨の 1 行。
 * tree どうしの比較で、利用者の index と作業ツリーを読まない
 */
export async function getAgentChangeDiffBetween(
  start: BaselineSnapshot,
  end: BaselineSnapshot,
  filePath: string,
  options: BaselineGitOptions = {}
): Promise<string> {
  if (isNotRecordedPath(start, filePath) || isNotRecordedPath(end, filePath)) {
    return NOT_RECORDED_DIFF_MESSAGE
  }
  const git = createBaselineGit(start.folderPath, start.indexPath, {
    ...options,
    config: ['core.quotePath=false']
  })
  return git
    .raw(['diff', ...PATCH_FORMAT_ARGS, '-U3', start.tree, end.tree, '--', toLiteralPathspec(filePath)])
    .catch((error: unknown) => {
      throw toBaselineQueryError(error)
    })
}
```

- [ ] **Step 4: テストを走らせて通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesRuns.integration.test.ts src/main/__tests__/agentBaselineCoverage.test.ts src/main/__tests__/agentChangesQuery.integration.test.ts`
Expected: PASS

- [ ] **Step 5: 検証**

Run: `npx vitest run src/main/__tests__/agentBaseline* src/main/__tests__/agentChanges*`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: `npx eslint --fix src/main/agentBaselineCoverage.ts src/main/agentChangesQuery.ts src/main/agentChangeDiff.ts src/main/__tests__/agentBaselineCoverage.test.ts src/main/__tests__/agentChangesRuns.integration.test.ts && npx eslint --max-warnings 0 src/main/agentBaselineCoverage.ts src/main/agentChangesQuery.ts src/main/agentChangeDiff.ts src/main/__tests__/agentBaselineCoverage.test.ts src/main/__tests__/agentChangesRuns.integration.test.ts`
Expected: エラー・警告なし

---

### Task 3: registry の記録の形と区切り・保持・後始末（`agentChangesRecord.ts`・`begin(trigger)`）

**Files:**
- Modify: `src/shared/types/agentChanges.ts`（`AGENT_CHANGES_MAX_RUNS`・`AgentChangesBeginTrigger`・`AgentChangesRunAvailability`・`AgentChangesRun`、`AgentChangesState` の `recording` に `runs`）
- Modify: `src/shared/types.ts`（値の再 export L39-45 に `AGENT_CHANGES_MAX_RUNS`）
- Create: `src/main/agentChangesRecord.ts`
- Modify: `src/main/agentBaselineRegistry.ts`（全体）
- Modify: `src/main/handlers/agentChangesHandlers.ts`（`withRecord` の task が記録全体を受ける・`begin` に `'manual'`）
- Modify: `src/main/ipcHandlers.ts`（L116-120 の registry の依存に `now: Date.now`）
- Test: `src/shared/__tests__/agentChanges.test.ts`、`src/main/__tests__/agentChangesRecord.test.ts`（新規）、`src/main/__tests__/agentBaselineRegistry.test.ts`、`src/main/__tests__/handlers/agentChangesHandlers.test.ts`
- Test（型を合わせるだけ。`runs: []` を足す）: `src/renderer/src/hooks/__tests__/useAgentChanges.test.ts`、`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`、`src/renderer/src/components/__tests__/App.agentChanges.test.tsx`、`src/renderer/src/lib/__tests__/agentChangesApi.test.ts`

**Interfaces:**
- Consumes: `BaselineSnapshot`（`tree` を含む。Task 1）、`TakeBaselineOptions.baseIndexPath`（Task 1）
- Produces:
```ts
// src/shared/types/agentChanges.ts
export const AGENT_CHANGES_MAX_RUNS = 10
export type AgentChangesBeginTrigger = 'send' | 'manual'
export type AgentChangesRunAvailability =
  | { kind: 'available' }
  | { kind: 'start-not-recorded'; reason: AgentChangesUnavailableReason }
  | { kind: 'end-not-recorded' }
export interface AgentChangesRun {
  runId: number
  number: number
  startedAt: number
  endedAt: number | null
  availability: AgentChangesRunAvailability
}
export type AgentChangesState =
  | { kind: 'none' }
  | { kind: 'unavailable'; reason: AgentChangesUnavailableReason; untrackedCount?: number; untrackedBytes?: number }
  | { kind: 'recording'; startedAt: number; runs: AgentChangesRun[] }
// src/main/agentChangesRecord.ts
export type AgentChangesRunStart =
  | { kind: 'baseline' }
  | { kind: 'snapshot'; snapshot: BaselineSnapshot }
  | { kind: 'failed'; reason: AgentChangesUnavailableReason; startedAt: number }
export interface AgentChangesRecordRun { runId: number; number: number; start: AgentChangesRunStart }
export interface AgentChangesRecord { baseline: BaselineSnapshot; runs: AgentChangesRecordRun[]; nextNumber: number }
export function runStartSnapshot(record: AgentChangesRecord, run: AgentChangesRecordRun): BaselineSnapshot | null
export function summarizeAgentChangesRuns(record: AgentChangesRecord): AgentChangesRun[]
export function latestRecordedIndexPath(record: AgentChangesRecord): string
export function agentChangesRecordTempDirs(record: AgentChangesRecord): string[]
// src/main/agentBaselineRegistry.ts
export interface AgentBaselineRegistryDeps {
  takeSnapshot: (folderPath: string, options: { isCanceled: () => boolean; baseIndexPath?: string }) => Promise<BaselineSnapshotResult>
  removeDir: (tempDir: string) => Promise<void>
  removeDirSync: (tempDir: string) => void
  now: () => number
}
export class AgentBaselineRegistry {
  begin(ownerId: number, folderPath: string, trigger: AgentChangesBeginTrigger): Promise<AgentChangesState>
  getState(ownerId: number, folderPath: string): AgentChangesState
  withRecord<T>(ownerId: number, folderPath: string, task: (record: AgentChangesRecord) => Promise<T>): Promise<T | null>
  clear(ownerId: number): Promise<void>
  close(): void
  generationOf(ownerId: number): number
}
```

- [ ] **Step 1: 既存のテストの値を新しい形に合わせる（機械的な置き換え）**

```bash
# registry: begin に 'manual' を足し、withRecord の task の引数を記録全体にする
perl -pi -e "s/registry\.begin\((\w+), ('[^']*'|\w+)\)/registry.begin(\$1, \$2, 'manual')/g; s/async \(snapshot\) =>/async (record) =>/g; s/snapshot\.tempDir/record.baseline.tempDir/g" \
  src/main/__tests__/agentBaselineRegistry.test.ts
# 記録中の状態に runs: [] を足す(1 行の値と、kind・startedAt が 2 行に分かれた値)
perl -pi -e "s/\{ kind: 'recording', startedAt: (\w+) \}/{ kind: 'recording', startedAt: \$1, runs: [] }/g" \
  src/main/__tests__/agentBaselineRegistry.test.ts \
  src/main/__tests__/handlers/agentChangesHandlers.test.ts \
  src/renderer/src/hooks/__tests__/useAgentChanges.test.ts \
  src/renderer/src/hooks/__tests__/useAppState.agent.test.ts \
  src/renderer/src/components/__tests__/App.agentChanges.test.tsx \
  src/renderer/src/lib/__tests__/agentChangesApi.test.ts
perl -0pi -e "s/kind: 'recording',\n(\s*)startedAt: (\w+)\n/kind: 'recording',\n\$1startedAt: \$2,\n\$1runs: []\n/g" \
  src/main/__tests__/agentBaselineRegistry.test.ts \
  src/main/__tests__/handlers/agentChangesHandlers.test.ts \
  src/renderer/src/lib/__tests__/agentChangesApi.test.ts
git diff --stat
```
Expected: 上の 6 ファイルだけが変わる。`git diff` で、`runs: []` が記録の状態（`begin`・`getState` の結果・`beginAgentChanges` の偽物の値）にだけ足され、一覧の結果（`entries` を持つ値）と renderer の写しの値（`list` を持つ値）には足されていないことを目で確かめる。`agentChangesApi.test.ts` の `beginAgentChanges` の期待値（`toEqual({ kind: 'recording', startedAt: 1 })` の 2 行の形）にも `runs: []` が足されていること。

`src/main/__tests__/handlers/agentChangesHandlers.test.ts` の `beforeEach` の registry の依存に `now: () => 0,` を足す（`removeDirSync: vi.fn()` の次）。

`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts` の `'送信の前の準備の記録が遅れて終わっても、記録中になり一覧を取る'` の `let resolveBegin: (state: { kind: 'recording'; startedAt: number }) => void` を `let resolveBegin: (state: AgentChangesState) => void` にする（`runs: []` を足した値を渡すと余分なプロパティの型エラーになるため。import の `@shared/types` に `AgentChangesState` を足す）。

- [ ] **Step 2: 失敗するテストを書く**

`src/shared/__tests__/agentChanges.test.ts` の `describe('共有の上限と再公開')` の `it` に足す（import に `AGENT_CHANGES_MAX_RUNS` を `'../types'` から足す）:
```ts
    expect(AGENT_CHANGES_MAX_RUNS).toBe(10)
```

`src/main/__tests__/agentChangesRecord.test.ts` を作る:
```ts
import { describe, it, expect } from 'vitest'
import type { AgentChangesRecord, AgentChangesRecordRun } from '../agentChangesRecord'
import {
  agentChangesRecordTempDirs,
  latestRecordedIndexPath,
  runStartSnapshot,
  summarizeAgentChangesRuns
} from '../agentChangesRecord'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import { makeBaselineSnapshot } from './helpers/agentBaselineFixtures'

const baseline = makeBaselineSnapshot({ tempDir: '/tmp/base', startedAt: 100 })
const snap = (n: number): BaselineSnapshot =>
  makeBaselineSnapshot({ tempDir: `/tmp/r${n}`, startedAt: n * 100 })
const recordOf = (runs: AgentChangesRecordRun[]): AgentChangesRecord => ({
  baseline,
  runs,
  nextNumber: runs.length + 1
})
const baselineRun = (runId: number): AgentChangesRecordRun => ({
  runId,
  number: runId,
  start: { kind: 'baseline' }
})
const snapshotRun = (runId: number): AgentChangesRecordRun => ({
  runId,
  number: runId,
  start: { kind: 'snapshot', snapshot: snap(runId) }
})
const failedRun = (runId: number): AgentChangesRecordRun => ({
  runId,
  number: runId,
  start: { kind: 'failed', reason: 'too-many-untracked', startedAt: runId * 100 + 50 }
})

describe('summarizeAgentChangesRuns', () => {
  it('開始の時刻・終わりの時刻(次の実行の開始。最後は null)・番号を古い順に並べる', () => {
    expect(summarizeAgentChangesRuns(recordOf([baselineRun(1), snapshotRun(2)]))).toEqual([
      { runId: 1, number: 1, startedAt: 100, endedAt: 200, availability: { kind: 'available' } },
      { runId: 2, number: 2, startedAt: 200, endedAt: null, availability: { kind: 'available' } }
    ])
  })

  it('開始を記録できなかった実行は start-not-recorded(理由つき)、その 1 つ前の実行は end-not-recorded(L-002)', () => {
    expect(
      summarizeAgentChangesRuns(recordOf([baselineRun(1), failedRun(2), snapshotRun(3)]))
    ).toEqual([
      { runId: 1, number: 1, startedAt: 100, endedAt: 250, availability: { kind: 'end-not-recorded' } },
      {
        runId: 2,
        number: 2,
        startedAt: 250,
        endedAt: 300,
        availability: { kind: 'start-not-recorded', reason: 'too-many-untracked' }
      },
      { runId: 3, number: 3, startedAt: 300, endedAt: null, availability: { kind: 'available' } }
    ])
  })

  it('実行が無ければ空', () => {
    expect(summarizeAgentChangesRuns(recordOf([]))).toEqual([])
  })
})

describe('latestRecordedIndexPath', () => {
  it('新しい方から見て最初の取れた記録のインデックス(取れなかった実行を飛ばす)', () => {
    expect(latestRecordedIndexPath(recordOf([baselineRun(1), snapshotRun(2), failedRun(3)]))).toBe(
      '/tmp/r2/index'
    )
  })

  it.each<[string, AgentChangesRecordRun[]]>([
    ['実行が無い', []],
    ['取れなかった実行だけ', [failedRun(1)]],
    ['開始が累積の始点の実行だけ', [baselineRun(1), failedRun(2)]]
  ])('%s なら累積の始点のインデックス', (_label, runs) => {
    expect(latestRecordedIndexPath(recordOf(runs))).toBe('/tmp/base/index')
  })
})

describe('agentChangesRecordTempDirs', () => {
  it('累積の始点と区切りの一時ディレクトリ(開始が累積の始点・取れなかった実行は足さない)', () => {
    expect(
      agentChangesRecordTempDirs(recordOf([baselineRun(1), snapshotRun(2), failedRun(3), snapshotRun(4)]))
    ).toEqual(['/tmp/base', '/tmp/r2', '/tmp/r4'])
  })
})

describe('runStartSnapshot', () => {
  it('累積の始点・区切りの記録を返し、取れなかった実行は null', () => {
    const record = recordOf([baselineRun(1), snapshotRun(2), failedRun(3)])
    expect(runStartSnapshot(record, record.runs[0])).toBe(baseline)
    expect(runStartSnapshot(record, record.runs[1])?.tempDir).toBe('/tmp/r2')
    expect(runStartSnapshot(record, record.runs[2])).toBeNull()
  })
})
```

`src/main/__tests__/agentBaselineRegistry.test.ts`:

1. import に足す: `import type { AgentChangesRun, AgentChangesState, AgentChangesUnavailableReason } from '@shared/types'`。
2. `setup` を次にする（`now` と、受け取った写しの元を控える）:
```ts
// 記録を取る偽物。release で結果を返し、isCanceled・写しの元を控える。now は 500 を返す
function setup(): {
  registry: AgentBaselineRegistry
  takeSnapshot: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['takeSnapshot']>>
  removeDir: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['removeDir']>>
  removeDirSync: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['removeDirSync']>>
  /** index 番目(既定は最後)の記録の依頼に結果を返す */
  release: (result: BaselineSnapshotResult, index?: number) => void
  canceled: () => boolean
  /** 記録の依頼ごとの写しの元(累積の始点は undefined) */
  baseIndexPaths: () => (string | undefined)[]
} {
  const resolvers: ((result: BaselineSnapshotResult) => void)[] = []
  const baseIndexPaths: (string | undefined)[] = []
  let isCanceled: () => boolean = () => false
  const takeSnapshot = vi.fn<AgentBaselineRegistryDeps['takeSnapshot']>(
    (_folder, options) =>
      new Promise<BaselineSnapshotResult>((r) => {
        resolvers.push(r)
        isCanceled = options.isCanceled
        baseIndexPaths.push(options.baseIndexPath)
      })
  )
  const removeDir = vi.fn<AgentBaselineRegistryDeps['removeDir']>(async () => undefined)
  const removeDirSync = vi.fn<AgentBaselineRegistryDeps['removeDirSync']>()
  const registry = new AgentBaselineRegistry({
    takeSnapshot,
    removeDir,
    removeDirSync,
    now: () => 500
  })
  return {
    registry,
    takeSnapshot,
    removeDir,
    removeDirSync,
    release: (result, index = resolvers.length - 1) => resolvers[index](result),
    canceled: () => isCanceled(),
    baseIndexPaths: () => [...baseIndexPaths]
  }
}
```
3. ファイルの末尾に足す:
```ts
// 実行の区切り(設計書「依頼の流れ」)。send は記録が無ければ累積の始点 + 実行 1、記録があれば列の中で区切りを取り実行を足す
describe('AgentBaselineRegistry の実行の区切り', () => {
  const runOf = (
    runId: number,
    number: number,
    startedAt: number,
    endedAt: number | null,
    availability: AgentChangesRun['availability'] = { kind: 'available' }
  ): AgentChangesRun => ({ runId, number, startedAt, endedAt, availability })

  const failed = (
    reason: AgentChangesUnavailableReason = 'too-many-untracked'
  ): BaselineSnapshotResult => ({ kind: 'unavailable', state: { kind: 'unavailable', reason } })

  // 所有者 1・'/repo' に send を 1 回送り、記録(始点か区切り)の依頼が届いたら result を返す。begin の結果を返す
  async function send(
    s: ReturnType<typeof setup>,
    result: BaselineSnapshotResult
  ): Promise<AgentChangesState> {
    const calls = s.takeSnapshot.mock.calls.length
    const begun = s.registry.begin(1, '/repo', 'send')
    await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalledTimes(calls + 1))
    s.release(result)
    return begun
  }

  const numbersOf = (state: AgentChangesState): number[] =>
    state.kind === 'recording' ? state.runs.map((run) => run.number) : []

  it('記録が無い send は累積の始点を取り、それを開始とする実行 1 を足す', async () => {
    const s = setup()
    const expected = { kind: 'recording', startedAt: 100, runs: [runOf(1, 1, 100, null)] }
    await expect(send(s, recorded('/repo', '/tmp/base', 100))).resolves.toEqual(expected)
    expect(s.baseIndexPaths()).toEqual([undefined])
    expect(s.registry.getState(1, '/repo')).toEqual(expected)
  })

  it('manual は実行を足さず、記録がある間の manual は区切りを取らない', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/base')
    await expect(s.registry.begin(1, '/repo', 'manual')).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: []
    })
    expect(s.takeSnapshot).not.toHaveBeenCalled()
  })

  it('記録がある send は、直前の取れた記録のインデックスを写しの元にして区切りを取り、実行を足す', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    await expect(send(s, recorded('/repo', '/tmp/r2', 200))).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 100, 200), runOf(2, 2, 200, null)]
    })
    await send(s, recorded('/repo', '/tmp/r3', 300))
    expect(s.baseIndexPaths()).toEqual([undefined, '/tmp/base/index', '/tmp/r2/index'])
  })

  it('manual の記録の後の最初の send が実行 1 になる(開始は区切り)', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/base')
    await expect(send(s, recorded('/repo', '/tmp/r1', 200))).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 200, null)]
    })
  })

  it('区切りを取れなかったら failed の実行を足し(開始の時刻は取得を始めた時刻)、その実行と 1 つ前の実行を選べなくする。次の写しの元は取れた記録', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    await expect(send(s, failed())).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [
        runOf(1, 1, 100, 500, { kind: 'end-not-recorded' }),
        runOf(2, 2, 500, null, { kind: 'start-not-recorded', reason: 'too-many-untracked' })
      ]
    })
    await send(s, recorded('/repo', '/tmp/r3', 600))
    expect(s.baseIndexPaths()).toEqual([undefined, '/tmp/base/index', '/tmp/base/index'])
    expect(s.registry.getState(1, '/repo')).toMatchObject({
      runs: [
        { availability: { kind: 'end-not-recorded' } },
        { availability: { kind: 'start-not-recorded', reason: 'too-many-untracked' } },
        { runId: 3, number: 3, availability: { kind: 'available' } }
      ]
    })
  })

  it('send の始点の取得中に届いた send は合流せず、始点を取り終えてから区切りを取り実行 2 にする', async () => {
    const s = setup()
    const first = s.registry.begin(1, '/repo', 'send')
    const second = s.registry.begin(1, '/repo', 'send')
    expect(s.takeSnapshot).toHaveBeenCalledOnce()
    s.release(recorded('/repo', '/tmp/base', 100), 0)
    await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalledTimes(2))
    s.release(recorded('/repo', '/tmp/r2', 200), 1)
    await expect(first).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 100, null)]
    })
    await expect(second).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 100, 200), runOf(2, 2, 200, null)]
    })
    expect(s.baseIndexPaths()).toEqual([undefined, '/tmp/base/index'])
  })

  it('manual の始点の取得中に届いた send は、始点の完了の後に区切りを取り実行 1 にする', async () => {
    const s = setup()
    const first = s.registry.begin(1, '/repo', 'manual')
    const second = s.registry.begin(1, '/repo', 'send')
    s.release(recorded('/repo', '/tmp/base', 100), 0)
    await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalledTimes(2))
    s.release(recorded('/repo', '/tmp/r1', 200), 1)
    await expect(first).resolves.toEqual({ kind: 'recording', startedAt: 100, runs: [] })
    await expect(second).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 200, null)]
    })
  })

  it('始点が取れなければ、待っていた send は区切りを取らずにその状態を返す', async () => {
    const s = setup()
    const first = s.registry.begin(1, '/repo', 'send')
    const second = s.registry.begin(1, '/repo', 'send')
    s.release(failed('timeout'), 0)
    await expect(first).resolves.toEqual({ kind: 'unavailable', reason: 'timeout' })
    await expect(second).resolves.toEqual({ kind: 'unavailable', reason: 'timeout' })
    expect(s.takeSnapshot).toHaveBeenCalledOnce()
  })

  it('manual は取得中の始点(send の依頼)に合流する', async () => {
    const s = setup()
    const first = s.registry.begin(1, '/repo', 'send')
    const second = s.registry.begin(1, '/repo', 'manual')
    s.release(recorded('/repo', '/tmp/base', 100), 0)
    const expected = { kind: 'recording', startedAt: 100, runs: [runOf(1, 1, 100, null)] }
    await expect(first).resolves.toEqual(expected)
    await expect(second).resolves.toEqual(expected)
    expect(s.takeSnapshot).toHaveBeenCalledOnce()
  })

  it('11 件目を足したら一番古い実行を外し、外した実行の区切りの一時ディレクトリだけを消す(累積の始点は消さない。L-003・L-004)', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    for (let n = 2; n <= 10; n++) await send(s, recorded('/repo', `/tmp/r${n}`, n * 100))
    expect(s.removeDir).not.toHaveBeenCalled()
    // 11 件目: 外すのは累積の始点を開始とする実行 1(消すものが無い)
    const eleventh = await send(s, recorded('/repo', '/tmp/r11', 1100))
    expect(numbersOf(eleventh)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(s.removeDir).not.toHaveBeenCalled()
    // 12 件目: 外すのは区切りを開始とする実行 2
    await send(s, recorded('/repo', '/tmp/r12', 1200))
    expect(s.removeDir.mock.calls).toEqual([['/tmp/r2']])
    await expect(
      s.registry.withRecord(1, '/repo', async (record) => record.baseline.tempDir)
    ).resolves.toBe('/tmp/base')
  })

  it('記録できなかった実行も 1 件に数え、外すときに消すものは無い', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/base')
    await send(s, failed())
    for (let n = 2; n <= 10; n++) await send(s, recorded('/repo', `/tmp/r${n}`, n * 100))
    const eleventh = await send(s, recorded('/repo', '/tmp/r11', 1100))
    expect(numbersOf(eleventh)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(s.removeDir).not.toHaveBeenCalled()
  })

  it.each<[string, (s: ReturnType<typeof setup>) => unknown]>([
    ['確認を終える(clear)', (s) => s.registry.clear(1)],
    ['フォルダの切り替え(別のフォルダの getState)', (s) => s.registry.getState(1, '/other')]
  ])(
    '区切りの取得中の %s で、実行を足さず、取れた区切りの一時ディレクトリを消す',
    async (_label, interrupt) => {
      const s = setup()
      await send(s, recorded('/repo', '/tmp/base', 100))
      const begun = s.registry.begin(1, '/repo', 'send')
      await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalledTimes(2))
      // clear は列の後ろで一時ディレクトリを消すため、取得中の区切りの完了を待つ。ここでは待たない
      void interrupt(s)
      expect(s.canceled()).toBe(true)
      s.release(recorded('/repo', '/tmp/r2', 200))
      await expect(begun).resolves.toEqual({ kind: 'none' })
      await vi.waitFor(() => expect(s.removeDir).toHaveBeenCalledWith('/tmp/base'))
      expect(s.removeDir).toHaveBeenCalledWith('/tmp/r2')
      expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'none' })
    }
  )

  it('区切りの取得は所有者の列に並び、先に並んだ操作の後に行う', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    let releaseTask: () => void = () => undefined
    let started = false
    const running = s.registry.withRecord(1, '/repo', async () => {
      started = true
      await new Promise<void>((r) => (releaseTask = r))
    })
    await vi.waitFor(() => expect(started).toBe(true))
    const begun = s.registry.begin(1, '/repo', 'send')
    await Promise.resolve()
    await Promise.resolve()
    expect(s.takeSnapshot).toHaveBeenCalledTimes(1)
    releaseTask()
    await running
    await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalledTimes(2))
    s.release(recorded('/repo', '/tmp/r2', 200))
    await expect(begun).resolves.toMatchObject({ runs: [{ runId: 1 }, { runId: 2 }] })
  })

  it('clear はすべての区切りの一時ディレクトリを消し、1 つの削除が失敗しても残りを試す(L-010)', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    await send(s, recorded('/repo', '/tmp/r2', 200))
    await send(s, failed())
    await send(s, recorded('/repo', '/tmp/r4', 400))
    s.removeDir.mockRejectedValueOnce(new Error('EBUSY'))
    await s.registry.clear(1)
    expect(s.removeDir.mock.calls).toEqual([['/tmp/base'], ['/tmp/r2'], ['/tmp/r4']])
  })

  it('close はすべての区切りの一時ディレクトリを待たずに消し、1 つが投げても残りを試す', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    await send(s, recorded('/repo', '/tmp/r2', 200))
    s.removeDirSync.mockImplementationOnce(() => {
      throw new Error('EBUSY')
    })
    s.registry.close()
    expect(s.removeDirSync.mock.calls).toEqual([['/tmp/base'], ['/tmp/r2']])
  })

  it('runId は確認を終えた後の新しい記録でも重ならず、番号は 1 から振り直す(L-037)', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    await send(s, recorded('/repo', '/tmp/r2', 200))
    await s.registry.clear(1)
    await expect(send(s, recorded('/repo', '/tmp/base2', 300))).resolves.toEqual({
      kind: 'recording',
      startedAt: 300,
      runs: [runOf(3, 1, 300, null)]
    })
  })

  it('withRecord は記録全体(累積の始点と実行の一覧)を渡す', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    await send(s, recorded('/repo', '/tmp/r2', 200))
    await expect(
      s.registry.withRecord(1, '/repo', async (record) => ({
        base: record.baseline.tempDir,
        starts: record.runs.map((run) => run.start.kind)
      }))
    ).resolves.toEqual({ base: '/tmp/base', starts: ['baseline', 'snapshot'] })
  })
})
```

`src/main/__tests__/handlers/agentChangesHandlers.test.ts` は Step 1 の置き換えだけ（`begin`・`getState` の結果に `runs: []`、registry の依存に `now`）。

- [ ] **Step 3: テストを走らせて失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/shared/__tests__/agentChanges.test.ts`
Expected: FAIL（`agentChangesRecord` が無い・`runs` が無い・`begin` が `trigger` を受けない）

- [ ] **Step 4: 実装する**

`src/shared/types/agentChanges.ts`: `AgentChangesUnavailableReason` の定義の後に足し、`AgentChangesState` の `recording` を変える:
```ts
/** 実行の区切りを保つ数(新しい方から)。11 件目を取ったら一番古い実行を捨てる(累積の始点は残す) */
export const AGENT_CHANGES_MAX_RUNS = 10

/** 記録の開始の依頼の種類。send: プロンプトの「実行」の直前(記録があれば区切りを足す)、manual: 「いまから記録する」(実行に数えない) */
export type AgentChangesBeginTrigger = 'send' | 'manual'

/**
 * 実行を選べるか(main が決め、renderer は表示だけに使う)。start-not-recorded: その実行の開始の区切りを取れなかった、
 * end-not-recorded: 終わり(次の実行の開始)の区切りを取れなかった。終わりの無い実行を「今まで」に読み替えない(L-002)
 */
export type AgentChangesRunAvailability =
  | { kind: 'available' }
  | { kind: 'start-not-recorded'; reason: AgentChangesUnavailableReason }
  | { kind: 'end-not-recorded' }

/** 実行 1 つ(プロンプトを送るたびに足す)。範囲は「開始 → 次の実行の開始(最後の実行は今まで)」 */
export interface AgentChangesRun {
  /** 所有者ごとに単調に増える ID(記録をまたいで重ならない。範囲の指定に使う) */
  runId: number
  /** 記録の中の 1 からの番号(表示用) */
  number: number
  /** 開始の時刻(エポックミリ秒) */
  startedAt: number
  /** 次の実行の開始の時刻。最後の実行は null */
  endedAt: number | null
  availability: AgentChangesRunAvailability
}
```
```ts
  /** runs は実行の一覧(古い順。最大 AGENT_CHANGES_MAX_RUNS 件) */
  | { kind: 'recording'; startedAt: number; runs: AgentChangesRun[] }
```

`src/shared/types.ts` の `./types/agentChanges` の値の再 export に `AGENT_CHANGES_MAX_RUNS,` を足す。

`src/main/agentChangesRecord.ts` を作る:
```ts
import type { AgentChangesRun, AgentChangesUnavailableReason } from '@shared/types'
import type { BaselineSnapshot } from './agentBaselineSnapshot'

// 1 所有者の記録(設計書「記録の持ち方」)。累積の始点と、プロンプトを送るたびに足す実行の一覧(古い順)。
// 実行 N の範囲は「実行 N の開始の区切り → 実行 N+1 の開始の区切り(最後の実行は作業ツリー)」で、終わりの記録は別に持たない
// (隣り合う実行が同じ記録を共有する)。registry が作って書き換え、範囲の解決と handler が読む。renderer には渡さない

/** 実行の開始。baseline: 累積の始点(記録が無い状態から送った実行 1)、snapshot: 区切り、failed: 区切りを取れなかった */
export type AgentChangesRunStart =
  | { kind: 'baseline' }
  | { kind: 'snapshot'; snapshot: BaselineSnapshot }
  | { kind: 'failed'; reason: AgentChangesUnavailableReason; startedAt: number }

export interface AgentChangesRecordRun {
  /** 所有者ごとに単調に増える ID(記録を捨てても戻さない) */
  runId: number
  /** 記録の中の 1 からの番号(表示用) */
  number: number
  start: AgentChangesRunStart
}

export interface AgentChangesRecord {
  /** 累積の始点。一覧・diff・戻すの累積の範囲はこれを使う(古い実行を捨てても変わらない) */
  baseline: BaselineSnapshot
  /** 実行の一覧(古い順) */
  runs: AgentChangesRecordRun[]
  /** 次の実行の番号 */
  nextNumber: number
}

/** 実行の開始の記録(baseline は累積の始点)。開始を取れなかった実行は null */
export function runStartSnapshot(
  record: AgentChangesRecord,
  run: AgentChangesRecordRun
): BaselineSnapshot | null {
  if (run.start.kind === 'baseline') return record.baseline
  if (run.start.kind === 'snapshot') return run.start.snapshot
  return null
}

function runStartedAt(record: AgentChangesRecord, run: AgentChangesRecordRun): number {
  return run.start.kind === 'failed'
    ? run.start.startedAt
    : (runStartSnapshot(record, run) ?? record.baseline).startedAt
}

/** IPC に渡す実行の一覧(古い順)。選べるかは、開始と終わり(次の実行の開始)の区切りが取れているかで決める */
export function summarizeAgentChangesRuns(record: AgentChangesRecord): AgentChangesRun[] {
  return record.runs.map((run, index) => {
    const next = record.runs[index + 1]
    return {
      runId: run.runId,
      number: run.number,
      startedAt: runStartedAt(record, run),
      endedAt: next === undefined ? null : runStartedAt(record, next),
      availability:
        run.start.kind === 'failed'
          ? { kind: 'start-not-recorded', reason: run.start.reason }
          : next !== undefined && next.start.kind === 'failed'
            ? { kind: 'end-not-recorded' }
            : { kind: 'available' }
    }
  })
}

/** 区切りの写しの元: 実行の一覧を新しい方から見て、最初の取れた記録のインデックス(無ければ累積の始点) */
export function latestRecordedIndexPath(record: AgentChangesRecord): string {
  for (let index = record.runs.length - 1; index >= 0; index--) {
    const snapshot = runStartSnapshot(record, record.runs[index])
    if (snapshot !== null) return snapshot.indexPath
  }
  return record.baseline.indexPath
}

/** 記録を捨てるときに消す一時ディレクトリ(累積の始点と、区切りのもの。開始が累積の始点の実行は始点と同じものなので足さない) */
export function agentChangesRecordTempDirs(record: AgentChangesRecord): string[] {
  return [
    record.baseline.tempDir,
    ...record.runs.flatMap((run) => (run.start.kind === 'snapshot' ? [run.start.snapshot.tempDir] : []))
  ]
}
```

`src/main/agentBaselineRegistry.ts` を次にする:
```ts
import type { AgentChangesBeginTrigger, AgentChangesState } from '@shared/types'
import { AGENT_CHANGES_MAX_RUNS } from '@shared/types'
import type { BaselineSnapshot, BaselineSnapshotResult } from './agentBaselineSnapshot'
import type { AgentChangesRecord, AgentChangesRunStart } from './agentChangesRecord'
import {
  agentChangesRecordTempDirs,
  latestRecordedIndexPath,
  summarizeAgentChangesRuns
} from './agentChangesRecord'
import { KeyedSerialQueue } from './keyedSerialQueue'

// 所有者(webContents の id)→ 記録(0 か 1 つ。累積の始点と実行の一覧)。Electron に依存しない(設計書「状態の持ち主」「記録の持ち方」)。
// - 世代: 記録の開始の依頼・clear・所有者の文脈の終わりで進める。記録・区切りを取る間に世代が変わったら、取れたものを捨てる(パターン 141)
// - 列: 記録のインデックスを使う操作(一覧・diff・戻す)と区切りの取得は、所有者ごとに 1 本の列に並べる(index.lock の衝突を避け、
//   写しの元を同じ所有者の git が同時に読み書きせず、送った順と実行の番号の順が一致する)。
//   clear は記録をすぐに外し(以後の依頼は記録なしになる)、一時ディレクトリの削除は列の後ろで行う(実行中の操作は最後まで行う)

export interface AgentBaselineRegistryDeps {
  /** 記録を取る(agentBaselineSnapshot.takeBaselineSnapshot)。isCanceled は await のたびに呼ばれる。baseIndexPath は区切りの写しの元 */
  takeSnapshot: (
    folderPath: string,
    options: { isCanceled: () => boolean; baseIndexPath?: string }
  ) => Promise<BaselineSnapshotResult>
  /** 一時ディレクトリを消す(removeBaselineDir) */
  removeDir: (tempDir: string) => Promise<void>
  /** アプリの終了で、待たずに消す(removeBaselineDirSync) */
  removeDirSync: (tempDir: string) => void
  /** 今の時刻(区切りを取れなかった実行の開始の時刻) */
  now: () => number
}

export class AgentBaselineRegistry {
  private readonly records = new Map<number, AgentChangesRecord>()
  private readonly generations = new Map<number, number>()
  // 累積の始点を取っている途中の依頼(同じ世代・同じフォルダの手動の依頼はこれにまとめる)
  private readonly pending = new Map<
    number,
    { generation: number; folderPath: string; run: Promise<AgentChangesState> }
  >()
  // 所有者ごとの次の runId。記録を捨てても戻さない(古い写しから届いた範囲が、新しい記録の別の実行を指さない。L-037)
  private readonly nextRunIds = new Map<number, number>()
  private readonly queue = new KeyedSerialQueue()
  private closed = false

  constructor(private readonly deps: AgentBaselineRegistryDeps) {}

  generationOf(ownerId: number): number {
    return this.generations.get(ownerId) ?? 0
  }

  /**
   * 記録を始める(設計書「依頼の流れ」)。manual: 記録があれば何もせずに recording を返し、取得中の始点があれば合流し、無ければ始点を取る。
   * send: 記録が無ければ始点を取って実行 1(開始は始点)を足し、記録があれば列の中で区切りを取って実行を足す。始点の取得中の send は
   * 合流せず、始点を取り終えてから区切りを取る(送信ごとに 1 つの実行)。記録・区切りを取る間に clear・所有者の文脈の終わり・
   * アプリの終了が来たら、取れたものを捨てて none を返す
   */
  async begin(
    ownerId: number,
    folderPath: string,
    trigger: AgentChangesBeginTrigger
  ): Promise<AgentChangesState> {
    if (this.closed) return { kind: 'none' }
    const existing = this.currentRecord(ownerId, folderPath)
    if (existing !== null) {
      return trigger === 'send' ? this.addRun(ownerId, folderPath) : this.recordingState(existing)
    }
    const inFlight = this.pending.get(ownerId)
    if (
      inFlight !== undefined &&
      inFlight.generation === this.generationOf(ownerId) &&
      inFlight.folderPath === folderPath
    ) {
      if (trigger === 'manual') return inFlight.run
      const state = await inFlight.run
      return state.kind === 'recording' ? this.addRun(ownerId, folderPath) : state
    }
    // 取得中の依頼が別のフォルダなら、世代を進めて古い取得を取り消す(先の記録が後の記録を上書きしない)
    if (inFlight !== undefined && inFlight.folderPath !== folderPath) {
      this.generations.set(ownerId, this.generationOf(ownerId) + 1)
    }
    const generation = this.generationOf(ownerId)
    const isCanceled = (): boolean => this.closed || this.generationOf(ownerId) !== generation
    const run = (async (): Promise<AgentChangesState> => {
      const result = await this.deps.takeSnapshot(folderPath, { isCanceled })
      if (result.kind === 'canceled') return { kind: 'none' }
      if (result.kind === 'unavailable') return result.state
      if (isCanceled()) {
        await this.discardSnapshot(result.snapshot)
        return { kind: 'none' }
      }
      const previous = this.records.get(ownerId)
      if (previous !== undefined) await this.removeDirs(agentChangesRecordTempDirs(previous))
      // 始点を取り終えたときに実行 1 を足すかは、始点の取得を始めた依頼の trigger で決める(pending には持たせない)
      const record: AgentChangesRecord = { baseline: result.snapshot, runs: [], nextNumber: 1 }
      if (trigger === 'send') this.appendRun(ownerId, record, { kind: 'baseline' })
      this.records.set(ownerId, record)
      return this.recordingState(record)
    })()
    const entry = { generation, folderPath, run }
    this.pending.set(ownerId, entry)
    try {
      return await run
    } finally {
      if (this.pending.get(ownerId) === entry) this.pending.delete(ownerId)
    }
  }

  /** いまの状態(一覧を作らない)。記録のフォルダがいまの許可のフォルダと違えば、記録を捨てて none */
  getState(ownerId: number, folderPath: string): AgentChangesState {
    const record = this.currentRecord(ownerId, folderPath)
    return record === null ? { kind: 'none' } : this.recordingState(record)
  }

  /**
   * 記録を使う操作を所有者の列に並べて行う。列の順番が来た時点で記録が無い(clear 済み・フォルダが違う)なら
   * task を呼ばずに null を返す。フォルダが違っても記録は捨てない: folderPath は依頼の入り口で取ったもので、列で待つ間に
   * フォルダが切り替わり新しい記録が作られていることがある(PR #47 レビュー A-2。古い依頼が新しい記録を捨てていた)
   */
  withRecord<T>(
    ownerId: number,
    folderPath: string,
    task: (record: AgentChangesRecord) => Promise<T>
  ): Promise<T | null> {
    return this.queue.enqueue(ownerId, async () => {
      const record = this.matchingRecord(ownerId, folderPath)
      return record === null ? null : task(record)
    })
  }

  /** 記録を捨てる(確認を終える・所有者の文脈の終わり)。記録・区切りを取る途中の依頼も取り消す */
  async clear(ownerId: number): Promise<void> {
    this.generations.set(ownerId, this.generationOf(ownerId) + 1)
    const record = this.records.get(ownerId)
    if (record === undefined) return
    this.records.delete(ownerId)
    await this.queue.enqueue(ownerId, () => this.removeDirs(agentChangesRecordTempDirs(record)))
  }

  /** アプリの終了。以後の記録を取らず、すべての一時ディレクトリを待たずに消す(1 つが投げても残りを試す。L-010) */
  close(): void {
    this.closed = true
    for (const record of this.records.values()) {
      for (const dir of agentChangesRecordTempDirs(record)) {
        try {
          this.deps.removeDirSync(dir)
        } catch {
          // 消せなかったものは OS の一時ディレクトリの掃除に任せ、残りを試す
        }
      }
    }
    this.records.clear()
  }

  // 区切りを取り、実行を足す(列の中で行う)。列の番が来た時点で記録が無い・フォルダが違う・世代が変わったなら何もせず none
  private addRun(ownerId: number, folderPath: string): Promise<AgentChangesState> {
    const generation = this.generationOf(ownerId)
    const isCanceled = (): boolean => this.closed || this.generationOf(ownerId) !== generation
    return this.queue.enqueue(ownerId, async (): Promise<AgentChangesState> => {
      const record = this.matchingRecord(ownerId, folderPath)
      if (record === null || isCanceled()) return { kind: 'none' }
      const startedAt = this.deps.now()
      const result = await this.deps.takeSnapshot(folderPath, {
        isCanceled,
        baseIndexPath: latestRecordedIndexPath(record)
      })
      if (result.kind === 'canceled') return { kind: 'none' }
      if (isCanceled()) {
        if (result.kind === 'recorded') await this.discardSnapshot(result.snapshot)
        return { kind: 'none' }
      }
      // 区切りを取れなくても送信は止めない(記録はおまけ)。実行は足し、その実行と 1 つ前の実行を選べなくする
      const start: AgentChangesRunStart =
        result.kind === 'recorded'
          ? { kind: 'snapshot', snapshot: result.snapshot }
          : { kind: 'failed', reason: result.state.reason, startedAt }
      this.appendRun(ownerId, record, start)
      // 保持の上限。消すのは新しい実行を足した後(L-003)で、消す対象は外した実行の区切りの一時ディレクトリだけ
      // (開始が累積の始点の実行・取れなかった実行には消すものが無い。L-004)
      if (record.runs.length > AGENT_CHANGES_MAX_RUNS) {
        const dropped = record.runs.shift()
        if (dropped?.start.kind === 'snapshot') {
          await this.deps.removeDir(dropped.start.snapshot.tempDir).catch(() => undefined)
        }
      }
      return this.recordingState(record)
    })
  }

  private appendRun(ownerId: number, record: AgentChangesRecord, start: AgentChangesRunStart): void {
    const runId = this.nextRunIds.get(ownerId) ?? 1
    this.nextRunIds.set(ownerId, runId + 1)
    record.runs.push({ runId, number: record.nextNumber, start })
    record.nextNumber += 1
  }

  private recordingState(record: AgentChangesRecord): AgentChangesState {
    return {
      kind: 'recording',
      startedAt: record.baseline.startedAt,
      runs: summarizeAgentChangesRuns(record)
    }
  }

  // 取り消された記録・区切りの一時ディレクトリを消す(アプリの終了中は待てないので同期で消す)
  private async discardSnapshot(snapshot: BaselineSnapshot): Promise<void> {
    if (this.closed) this.deps.removeDirSync(snapshot.tempDir)
    else await this.deps.removeDir(snapshot.tempDir)
  }

  // 1 つの削除が失敗しても残りを試す(removeBaselineDir は失敗を握るが、依存の差し替えにも備える。L-010)
  private async removeDirs(dirs: string[]): Promise<void> {
    for (const dir of dirs) await this.deps.removeDir(dir).catch(() => undefined)
  }

  // 記録があり、そのフォルダが folderPath と同じなら返す(照合だけ。記録は捨てない)
  private matchingRecord(ownerId: number, folderPath: string): AgentChangesRecord | null {
    const record = this.records.get(ownerId)
    return record !== undefined && record.baseline.folderPath === folderPath ? record : null
  }

  // matchingRecord に加え、フォルダが違えば記録を捨てる(フォルダの切り替えの通知より先に依頼が来た場合)。
  // begin・getState は呼ばれた時点のいまの許可のフォルダと同期で比べるため、記録の方が古いと言える。withRecord では使わない
  private currentRecord(ownerId: number, folderPath: string): AgentChangesRecord | null {
    const record = this.matchingRecord(ownerId, folderPath)
    if (record === null && this.records.has(ownerId)) void this.clear(ownerId)
    return record
  }
}
```

`src/main/handlers/agentChangesHandlers.ts`:
1. `import type { BaselineSnapshot } from '../agentBaselineSnapshot'` を `import type { AgentChangesRecord } from '../agentChangesRecord'` に替える。
2. `withRecordOrThrow` の `task` の型を `(record: AgentChangesRecord) => Promise<T>`、`withRecordAtPath` の `task` の型を `(record: AgentChangesRecord, relativePath: string, args: A) => Promise<T>` にし、`withRecordAtPath` の最後を `return withRecordOrThrow(ownerId, folder, (record) => task(record, relativePath, args))` にする。
3. `agentChanges:begin` の `return registry.begin(ownerId, folder)` を `return registry.begin(ownerId, folder, 'manual')` にする。
4. 記録を受ける箇所の `snapshot` を `record.baseline` にする:
```ts
    const result = await registry.withRecord(ownerId, folder, async (record) => ({
      kind: 'recording' as const,
      startedAt: record.baseline.startedAt,
      ...(await listAgentChanges(record.baseline))
    }))
```
```ts
      withRecordAtPath(event, path, noArgs, (record, relativePath) =>
        getAgentChangeDiff(record.baseline, relativePath)
      )
```
```ts
    await withRecordAtPath(event, path, noArgs, (record, relativePath) =>
      revertAgentChange({ snapshot: record.baseline, trash }, relativePath)
    )
```
```ts
        (record, relativePath, parsedPatch) =>
          revertAgentChangeHunk({ snapshot: record.baseline, trash }, relativePath, parsedPatch)
```
```ts
      return withRecordOrThrow(ownerId, folder, (record) =>
        revertAllAgentChanges({ snapshot: record.baseline, trash }, entries)
      )
```

`src/main/ipcHandlers.ts` の `new AgentBaselineRegistry({ … })` の `removeDirSync: removeBaselineDirSync` の後に `,\n    now: Date.now` を足す。

- [ ] **Step 5: テストを走らせて通ることを確かめる**

Run: `npx vitest run src/main/__tests__/agentChangesRecord.test.ts src/main/__tests__/agentBaselineRegistry.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts src/main/__tests__/agentBaselineLifecycle.test.ts src/shared/__tests__/agentChanges.test.ts`
Expected: PASS

- [ ] **Step 6: 検証**

Run: `npx vitest run src/main src/shared src/renderer/src/hooks/__tests__/useAgentChanges.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.agentChanges.test.tsx src/renderer/src/lib/__tests__/agentChangesApi.test.ts`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし（`typecheck:web` も通る。落ちたら、型付きのテストの値に `runs: []` が足りない箇所を Step 1 と同じ形で足す）
Run: 変更・作成した TypeScript のファイル（Files の一覧）へ `npx eslint --fix` → `npx eslint --max-warnings 0`
Expected: エラー・警告なし

---

### Task 4: 範囲の解決・IPC・parser・preload・共有の型（戻す系の範囲の検査を含む）

**Files:**
- Modify: `src/shared/types/agentChanges.ts`（`AgentChangesScope`・`AgentChangesScopeUnavailableReason`・`isSameAgentChangesScope`、`AgentChangesListResult` の形）
- Modify: `src/shared/types.ts`（値の再 export に `isSameAgentChangesScope`）
- Create: `src/main/agentChangesScope.ts`
- Modify: `src/main/handlers/agentChangesPayloadParser.ts`（`parseAgentChangesBeginTrigger`・`parseAgentChangesScope`・`parseRevertScope`・`AGENT_CHANGES_REVERT_SCOPE_MESSAGE`）
- Modify: `src/main/handlers/agentChangesHandlers.ts`（範囲の引数・解決・戻す系の検査・`trigger`）
- Modify: `src/preload/api.ts`（L274-287）、`src/preload/index.d.ts`（L152-159 と import）
- Test: `src/shared/__tests__/agentChanges.test.ts`、`src/main/__tests__/agentChangesScope.test.ts`（新規）、`src/main/__tests__/handlers/agentChangesPayloadParser.test.ts`、`src/main/__tests__/handlers/agentChangesHandlers.test.ts`、`src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts`（新規）、`src/preload/__tests__/api.test.ts`

**Interfaces:**
- Consumes: `AgentChangesRecord`・`runStartSnapshot`・`summarizeAgentChangesRuns`（Task 3）、`registry.begin(ownerId, folderPath, trigger)`・`withRecord(…, (record) => …)`（Task 3）、`listAgentChangesBetween(start, end)`・`getAgentChangeDiffBetween(start, end, path)`（Task 2）
- Produces:
```ts
// src/shared/types/agentChanges.ts
export type AgentChangesScope = { kind: 'all' } | { kind: 'run'; runId: number }
export type AgentChangesScopeUnavailableReason = 'run-missing' | 'start-not-recorded' | 'end-not-recorded'
export function isSameAgentChangesScope(a: AgentChangesScope, b: AgentChangesScope): boolean
export type AgentChangesListResult =
  | { kind: 'none' }
  | ({ kind: 'recording'; startedAt: number; runs: AgentChangesRun[]; scope: AgentChangesScope } & AgentChangesList)
  | { kind: 'scope-unavailable'; startedAt: number; runs: AgentChangesRun[]; scope: AgentChangesScope; reason: AgentChangesScopeUnavailableReason }
// src/main/agentChangesScope.ts
export type ResolvedAgentChangesScope =
  | { kind: 'cumulative'; snapshot: BaselineSnapshot }
  | { kind: 'toWorktree'; snapshot: BaselineSnapshot }
  | { kind: 'between'; start: BaselineSnapshot; end: BaselineSnapshot }
  | { kind: 'unavailable'; reason: AgentChangesScopeUnavailableReason }
export function resolveAgentChangesScope(record: AgentChangesRecord, scope: AgentChangesScope): ResolvedAgentChangesScope
// src/main/handlers/agentChangesPayloadParser.ts
export const AGENT_CHANGES_REVERT_SCOPE_MESSAGE = '実行ごとの表示では戻せません。「すべて（累積）」を選んでから戻してください'
export function parseAgentChangesBeginTrigger(value: unknown): AgentChangesBeginTrigger
export function parseAgentChangesScope(value: unknown): AgentChangesScope
export function parseRevertScope(value: unknown): { kind: 'all' }
// src/main/handlers/agentChangesHandlers.ts
export const AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE = 'この実行の変更は表示できません（記録がありません）'
// src/preload/api.ts・index.d.ts(window.api)
beginAgentChanges(trigger: AgentChangesBeginTrigger): Promise<AgentChangesState>
listAgentChanges(scope: AgentChangesScope): Promise<AgentChangesListResult>
getAgentChangeDiff(path: string, scope: AgentChangesScope): Promise<string>
revertAgentChange(path: string, scope: AgentChangesScope): Promise<void>
revertAgentChangeHunk(path: string, patch: string, scope: AgentChangesScope): Promise<void>
revertAllAgentChanges(expected: AgentRevertAllEntry[], scope: AgentChangesScope): Promise<DiscardAllResult>
```

> このタスクの後、Task 5 が終わるまで `npm run typecheck:web` は落ちる（renderer の `lib/agentChangesApi.ts`・`hooks/useAgentChanges.ts`・`__tests__/makeAgentChangesState.ts` など）。このタスクの検証は `npm run typecheck:node` で行う。

- [ ] **Step 1: 既存の handler のテストの呼び出しに引数を足す（機械的な置き換え）**

```bash
perl -pi -e "
s/(invoke\('agentChanges:begin', makeEvent\([^)]*\))\)/\$1, 'manual')/g;
s/(invoke\('agentChanges:list', makeEvent\([^)]*\))\)/\$1, ALL)/g;
s/(invoke\('agentChanges:(?:getDiff|revertFile)', makeEvent\([^)]*\), (?:'[^']*'|\w+))\)/\$1, ALL)/g;
s/(invoke\('agentChanges:revertHunk', makeEvent\([^)]*\), (?:'[^']*'|\w+), (?:'[^']*'|\w+))\)/\$1, ALL)/g;
s/(invoke\('agentChanges:revertAll', makeEvent\([^)]*\), '[^']*')\)/\$1, ALL)/g
" src/main/__tests__/handlers/agentChangesHandlers.test.ts
git diff src/main/__tests__/handlers/agentChangesHandlers.test.ts | grep '^+' | grep -c "ALL\|'manual'"
```
Expected: 置き換えの行が出る（`begin` に `'manual'`、`list`・`getDiff`・`revertFile`・`revertHunk`・`revertAll` に `ALL`）。

続けて同じファイルを手で直す:
1. import の後（`type Listener` の前）に `const ALL = { kind: 'all' } as const` を足す。
2. `it.each([['agentChanges:begin', []], …])('%s はメインフレーム以外からの依頼を拒否する', …)` の表を次にする:
```ts
  it.each([
    ['agentChanges:begin', ['manual']],
    ['agentChanges:getState', []],
    ['agentChanges:list', [ALL]],
    ['agentChanges:getDiff', ['a.txt', ALL]],
    ['agentChanges:revertFile', ['a.txt', ALL]],
    ['agentChanges:revertHunk', ['a.txt', 'patch', ALL]],
    ['agentChanges:revertAll', [[], ALL]],
    ['agentChanges:clear', []]
  ])('%s はメインフレーム以外からの依頼を拒否する', async (channel, args) => {
```
3. `'begin は送信元の許可のフォルダで記録を始め、getState・list はその記録を返す'` の `list` の期待値に `runs: [],` と `scope: { kind: 'all' },` を足す（`startedAt: 42,` の次）。
4. `'revertAll は確認の一覧を検証して詰め直したものを渡し、結果を返す'` の `invoke('agentChanges:revertAll', makeEvent(), [{ path: 'a.txt', status: 'M', x: 1 }])` を `invoke('agentChanges:revertAll', makeEvent(), [{ path: 'a.txt', status: 'M', x: 1 }], ALL)` にする。
5. `'記録が無ければ getDiff・revertFile・revertHunk・revertAll は例外にする'` の表を次にする:
```ts
      ['agentChanges:getDiff', ['a.txt', ALL]],
      ['agentChanges:revertFile', ['a.txt', ALL]],
      ['agentChanges:revertHunk', ['a.txt', 'p', ALL]],
      ['agentChanges:revertAll', [[], ALL]]
```
6. `describe('パスを受けるハンドラの前処理')` の `pathHandlers` の 2 列目を `[ALL] as unknown[]`・`[ALL] as unknown[]`・`['patch', ALL] as unknown[]` にする。
7. `vi.mock('../../agentChangesQuery', …)` を `({ listAgentChanges: vi.fn(), listAgentChangesBetween: vi.fn() })`、`vi.mock('../../agentChangeDiff', …)` を `({ getAgentChangeDiff: vi.fn(), getAgentChangeDiffBetween: vi.fn() })` にし、import にも足す。
8. 記録の偽物を、テストが積んだ結果から返すようにする（`let folder: string` の近くに `let snapshotResults: BaselineSnapshotResult[] = []` を足し、`beforeEach` で `snapshotResults = []` にし、registry の `takeSnapshot` を `async (folderPath) => snapshotResults.shift() ?? { kind: 'recorded', snapshot: snapshotFor(folderPath) }` にする。import に `BaselineSnapshotResult` を足す）。

- [ ] **Step 2: 失敗するテストを書く**

`src/shared/__tests__/agentChanges.test.ts` に足す（import に `isSameAgentChangesScope` を `'../types'` から）:
```ts
describe('isSameAgentChangesScope', () => {
  it.each<[string, AgentChangesScope, AgentChangesScope, boolean]>([
    ['累積どうし', { kind: 'all' }, { kind: 'all' }, true],
    ['同じ実行', { kind: 'run', runId: 2 }, { kind: 'run', runId: 2 }, true],
    ['違う実行', { kind: 'run', runId: 2 }, { kind: 'run', runId: 3 }, false],
    ['累積と実行', { kind: 'all' }, { kind: 'run', runId: 1 }, false],
    ['実行と累積', { kind: 'run', runId: 1 }, { kind: 'all' }, false]
  ])('%s: %s', (_label, a, b, expected) => {
    expect(isSameAgentChangesScope(a, b)).toBe(expected)
  })
})
```
（`import type { AgentChangesScope } from '../types/agentChanges'` を足す）

`src/main/__tests__/agentChangesScope.test.ts` を作る:
```ts
import { describe, it, expect } from 'vitest'
import type { AgentChangesRecord, AgentChangesRecordRun } from '../agentChangesRecord'
import { resolveAgentChangesScope } from '../agentChangesScope'
import { makeBaselineSnapshot } from './helpers/agentBaselineFixtures'

const baseline = makeBaselineSnapshot({ tempDir: '/tmp/base' })
const r2 = makeBaselineSnapshot({ tempDir: '/tmp/r2' })
const r4 = makeBaselineSnapshot({ tempDir: '/tmp/r4' })
// 実行 1(開始は累積の始点)・実行 2(区切り)・実行 3(取れなかった)・実行 4(区切り。最後)
const runs: AgentChangesRecordRun[] = [
  { runId: 1, number: 1, start: { kind: 'baseline' } },
  { runId: 2, number: 2, start: { kind: 'snapshot', snapshot: r2 } },
  { runId: 3, number: 3, start: { kind: 'failed', reason: 'timeout', startedAt: 3 } },
  { runId: 4, number: 4, start: { kind: 'snapshot', snapshot: r4 } }
]
const record: AgentChangesRecord = { baseline, runs, nextNumber: 5 }

describe('resolveAgentChangesScope(設計書「範囲の解決」の表)', () => {
  it('all は累積(始点 → 作業ツリー)', () => {
    expect(resolveAgentChangesScope(record, { kind: 'all' })).toEqual({
      kind: 'cumulative',
      snapshot: baseline
    })
  })

  it('一覧に無い runId は run-missing', () => {
    expect(resolveAgentChangesScope(record, { kind: 'run', runId: 99 })).toEqual({
      kind: 'unavailable',
      reason: 'run-missing'
    })
  })

  it('開始が failed の実行は start-not-recorded', () => {
    expect(resolveAgentChangesScope(record, { kind: 'run', runId: 3 })).toEqual({
      kind: 'unavailable',
      reason: 'start-not-recorded'
    })
  })

  it('次の実行の開始が failed の実行は end-not-recorded(今までに読み替えない。L-002)', () => {
    expect(resolveAgentChangesScope(record, { kind: 'run', runId: 2 })).toEqual({
      kind: 'unavailable',
      reason: 'end-not-recorded'
    })
  })

  it('最後の実行は開始の記録 → 作業ツリー', () => {
    expect(resolveAgentChangesScope(record, { kind: 'run', runId: 4 })).toEqual({
      kind: 'toWorktree',
      snapshot: r4
    })
  })

  it('途中の実行は開始の記録(baseline は累積の始点)と次の実行の開始の記録', () => {
    expect(resolveAgentChangesScope(record, { kind: 'run', runId: 1 })).toEqual({
      kind: 'between',
      start: baseline,
      end: r2
    })
  })

  it('開始が累積の始点の最後の実行は、累積の始点 → 作業ツリー', () => {
    const only: AgentChangesRecord = { baseline, runs: [runs[0]], nextNumber: 2 }
    expect(resolveAgentChangesScope(only, { kind: 'run', runId: 1 })).toEqual({
      kind: 'toWorktree',
      snapshot: baseline
    })
  })
})
```

`src/main/__tests__/handlers/agentChangesPayloadParser.test.ts` に足す（import に `AGENT_CHANGES_REVERT_SCOPE_MESSAGE`・`parseAgentChangesBeginTrigger`・`parseAgentChangesScope`・`parseRevertScope`）:
```ts
describe('parseAgentChangesBeginTrigger', () => {
  it.each(['send', 'manual'] as const)('%s を返す', (value) => {
    expect(parseAgentChangesBeginTrigger(value)).toBe(value)
  })
  it.each<[string, unknown]>([
    ['省略(undefined)', undefined],
    ['未知の値', 'auto'],
    ['大文字', 'SEND'],
    ['数', 1],
    ['null', null]
  ])('%s なら投げる(既定に流さない。L-044)', (_label, value) => {
    expect(() => parseAgentChangesBeginTrigger(value)).toThrow(
      'trigger は send か manual である必要があります'
    )
  })
})

describe('parseAgentChangesScope', () => {
  it('累積と実行を返す', () => {
    expect(parseAgentChangesScope({ kind: 'all' })).toEqual({ kind: 'all' })
    expect(parseAgentChangesScope({ kind: 'run', runId: 3 })).toEqual({ kind: 'run', runId: 3 })
    expect(parseAgentChangesScope({ kind: 'run', runId: Number.MAX_SAFE_INTEGER })).toEqual({
      kind: 'run',
      runId: Number.MAX_SAFE_INTEGER
    })
  })
  it.each<[string, unknown]>([
    ['省略(undefined)', undefined],
    ['null', null],
    ['文字列', 'all'],
    ['配列', [{ kind: 'all' }]],
    ['プロトタイプの無いオブジェクト', Object.assign(Object.create(null), { kind: 'all' })],
    ['未知の kind', { kind: 'latest' }],
    ['kind が無い', { runId: 1 }],
    ['all に余分なキー', { kind: 'all', runId: 1 }],
    ['run に余分なキー', { kind: 'run', runId: 1, path: 'x' }],
    ['run に runId が無い', { kind: 'run' }],
    ['runId が 0', { kind: 'run', runId: 0 }],
    ['runId が負', { kind: 'run', runId: -1 }],
    ['runId が小数', { kind: 'run', runId: 1.5 }],
    ['runId が文字列', { kind: 'run', runId: '1' }],
    ['runId が NaN', { kind: 'run', runId: Number.NaN }],
    ['runId が安全でない整数', { kind: 'run', runId: Number.MAX_SAFE_INTEGER + 1 }]
  ])('%s なら投げる', (_label, value) => {
    expect(() => parseAgentChangesScope(value)).toThrow('範囲(scope)が不正です')
  })
})

describe('parseRevertScope', () => {
  it('累積だけを受け付ける', () => {
    expect(parseRevertScope({ kind: 'all' })).toEqual({ kind: 'all' })
  })
  it('実行の範囲は戻せない旨で投げる', () => {
    expect(() => parseRevertScope({ kind: 'run', runId: 1 })).toThrow(
      AGENT_CHANGES_REVERT_SCOPE_MESSAGE
    )
  })
  it('形が不正なら範囲の検証の文言で投げる', () => {
    expect(() => parseRevertScope(undefined)).toThrow('範囲(scope)が不正です')
  })
})
```

`src/main/__tests__/handlers/agentChangesHandlers.test.ts` の末尾に足す（import に `AgentChangesScope` 型〈`@shared/types`〉、`listAgentChangesBetween`・`getAgentChangeDiffBetween`、`AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE`〈`../../handlers/agentChangesHandlers`〉、`AGENT_CHANGES_REVERT_SCOPE_MESSAGE`〈`../../handlers/agentChangesPayloadParser`〉を足す）:
```ts
// 範囲(設計書「IPC の範囲の引数」「戻す系の IPC」)。send で実行 1(開始は累積の始点)・実行 2(区切り)を作って試す
describe('範囲と実行', () => {
  const runScope = (runId: number): AgentChangesScope => ({ kind: 'run', runId })
  const runSnapshot = (n: number): BaselineSnapshot =>
    makeBaselineSnapshot({ folderPath: folder, startedAt: 42 + n, tempDir: `/tmp/run-${n}` })
  const emptyList = { entries: [], totalCount: 0, truncated: false, headChanged: false }

  async function twoRuns(second: BaselineSnapshotResult): Promise<void> {
    snapshotResults.push({ kind: 'recorded', snapshot: snapshotFor(folder) }, second)
    await invoke('agentChanges:begin', makeEvent(), 'send')
    await invoke('agentChanges:begin', makeEvent(), 'send')
  }

  beforeEach(() => {
    vi.mocked(listAgentChanges).mockResolvedValue(emptyList)
    vi.mocked(listAgentChangesBetween).mockResolvedValue(emptyList)
    vi.mocked(getAgentChangeDiff).mockResolvedValue('diff')
    vi.mocked(getAgentChangeDiffBetween).mockResolvedValue('between')
  })

  it('begin は trigger を registry へ渡し、send は実行を足す', async () => {
    const begin = vi.spyOn(registry, 'begin')
    const run2 = runSnapshot(2)
    snapshotResults.push({ kind: 'recorded', snapshot: snapshotFor(folder) }, { kind: 'recorded', snapshot: run2 })
    await invoke('agentChanges:begin', makeEvent(), 'send')
    await expect(invoke('agentChanges:begin', makeEvent(), 'send')).resolves.toEqual({
      kind: 'recording',
      startedAt: 42,
      runs: [
        { runId: 1, number: 1, startedAt: 42, endedAt: 44, availability: { kind: 'available' } },
        { runId: 2, number: 2, startedAt: 44, endedAt: null, availability: { kind: 'available' } }
      ]
    })
    expect(begin).toHaveBeenLastCalledWith(1, folder, 'send')
  })

  it('list は範囲を解決し、累積・最後の実行・途中の実行の一覧を、実行の一覧と範囲を添えて返す', async () => {
    const run2 = runSnapshot(2)
    await twoRuns({ kind: 'recorded', snapshot: run2 })
    await expect(invoke('agentChanges:list', makeEvent(), ALL)).resolves.toMatchObject({
      kind: 'recording',
      startedAt: 42,
      scope: ALL,
      runs: [{ runId: 1 }, { runId: 2 }],
      ...emptyList
    })
    expect(listAgentChanges).toHaveBeenLastCalledWith(snapshotFor(folder))
    await expect(invoke('agentChanges:list', makeEvent(), runScope(2))).resolves.toMatchObject({
      kind: 'recording',
      scope: runScope(2)
    })
    expect(listAgentChanges).toHaveBeenLastCalledWith(run2)
    await expect(invoke('agentChanges:list', makeEvent(), runScope(1))).resolves.toMatchObject({
      kind: 'recording',
      scope: runScope(1)
    })
    expect(listAgentChangesBetween).toHaveBeenCalledWith(snapshotFor(folder), run2)
  })

  it('getDiff は範囲を解決し、累積・最後の実行・途中の実行の diff の関数を呼ぶ', async () => {
    const run2 = runSnapshot(2)
    await twoRuns({ kind: 'recorded', snapshot: run2 })
    await expect(invoke('agentChanges:getDiff', makeEvent(), 'a.txt', ALL)).resolves.toBe('diff')
    expect(getAgentChangeDiff).toHaveBeenLastCalledWith(snapshotFor(folder), 'a.txt')
    await expect(invoke('agentChanges:getDiff', makeEvent(), 'a.txt', runScope(2))).resolves.toBe(
      'diff'
    )
    expect(getAgentChangeDiff).toHaveBeenLastCalledWith(run2, 'a.txt')
    await expect(invoke('agentChanges:getDiff', makeEvent(), 'a.txt', runScope(1))).resolves.toBe(
      'between'
    )
    expect(getAgentChangeDiffBetween).toHaveBeenCalledWith(snapshotFor(folder), run2, 'a.txt')
  })

  it.each<[string, number, string]>([
    ['一覧に無い実行', 99, 'run-missing'],
    ['開始を記録できなかった実行', 2, 'start-not-recorded'],
    ['終わりを記録できなかった実行', 1, 'end-not-recorded']
  ])(
    '%s: list は scope-unavailable を返し、getDiff は例外にし、一覧・diff の関数を呼ばない',
    async (_label, runId, reason) => {
      await twoRuns({
        kind: 'unavailable',
        state: { kind: 'unavailable', reason: 'too-many-untracked' }
      })
      await expect(invoke('agentChanges:list', makeEvent(), runScope(runId))).resolves.toEqual({
        kind: 'scope-unavailable',
        startedAt: 42,
        runs: expect.any(Array),
        scope: runScope(runId),
        reason
      })
      await expect(
        invoke('agentChanges:getDiff', makeEvent(), 'a.txt', runScope(runId))
      ).rejects.toThrow(AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE)
      expect(listAgentChanges).not.toHaveBeenCalled()
      expect(listAgentChangesBetween).not.toHaveBeenCalled()
      expect(getAgentChangeDiff).not.toHaveBeenCalled()
      expect(getAgentChangeDiffBetween).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['agentChanges:revertFile', ['a.txt'], () => vi.mocked(revertAgentChange)],
    ['agentChanges:revertHunk', ['a.txt', 'patch'], () => vi.mocked(revertAgentChangeHunk)],
    ['agentChanges:revertAll', [[{ path: 'a.txt', status: 'M' }]], () => vi.mocked(revertAllAgentChanges)]
  ] as const)(
    '%s は実行の範囲を記録の列に入る前に拒み、作業ツリーを変える関数を呼ばない(L-058)',
    async (channel, args, domainFn) => {
      await twoRuns({ kind: 'recorded', snapshot: runSnapshot(2) })
      const withRecord = vi.spyOn(registry, 'withRecord')
      await expect(invoke(channel, makeEvent(), ...args, runScope(1))).rejects.toThrow(
        AGENT_CHANGES_REVERT_SCOPE_MESSAGE
      )
      expect(withRecord).not.toHaveBeenCalled()
      expect(domainFn()).not.toHaveBeenCalled()
    }
  )

  it('begin は trigger の省略・未知の値を例外にし、記録を始めない(L-044)', async () => {
    const begin = vi.spyOn(registry, 'begin')
    await expect(invoke('agentChanges:begin', makeEvent())).rejects.toThrow(
      'trigger は send か manual である必要があります'
    )
    await expect(invoke('agentChanges:begin', makeEvent(), 'auto')).rejects.toThrow(
      'trigger は send か manual である必要があります'
    )
    expect(begin).not.toHaveBeenCalled()
  })

  it.each<[string, unknown[]]>([
    ['agentChanges:list', []],
    ['agentChanges:list', [{ kind: 'run' }]],
    ['agentChanges:getDiff', ['a.txt']],
    ['agentChanges:getDiff', ['a.txt', { kind: 'all', extra: 1 }]],
    ['agentChanges:revertFile', ['a.txt']],
    ['agentChanges:revertHunk', ['a.txt', 'patch']],
    ['agentChanges:revertAll', [[]]]
  ])('%s %j は範囲の形が不正なので例外にし、記録の列に入らない', async (channel, args) => {
    await invoke('agentChanges:begin', makeEvent(), 'manual')
    const withRecord = vi.spyOn(registry, 'withRecord')
    await expect(invoke(channel, makeEvent(), ...args)).rejects.toThrow('範囲(scope)が不正です')
    expect(withRecord).not.toHaveBeenCalled()
  })

  it('getDiff は範囲をパスより先に検証する', async () => {
    await invoke('agentChanges:begin', makeEvent(), 'manual')
    await expect(
      invoke('agentChanges:getDiff', makeEvent(), '../outside.txt', { kind: 'nope' })
    ).rejects.toThrow('範囲(scope)が不正です')
  })
})
```

`src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts` を作る:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FolderAccessManager } from '../../folderAccessManager'
import { AgentBaselineRegistry } from '../../agentBaselineRegistry'
import {
  removeBaselineDir,
  removeBaselineDirSync,
  takeBaselineSnapshot
} from '../../agentBaselineSnapshot'
import { registerAgentChangesHandlers } from '../../handlers/agentChangesHandlers'
import { AGENT_CHANGES_REVERT_SCOPE_MESSAGE } from '../../handlers/agentChangesPayloadParser'
import { commitAll, readRepoFile, writeRepoFile } from '../helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  createFakeTrash,
  disposeAgentBaselineRepo
} from '../helpers/agentBaselineFixtures'
import type { FakeTrash } from '../helpers/agentBaselineFixtures'

// 実 git で、送信ごとの区切り → 範囲ごとの一覧・diff → 戻す系の範囲の検査を handler から通す(設計書「テスト方針」の結合)

type Listener = (...args: unknown[]) => unknown
const handles = new Map<string, Listener>()
const ipcMain = {
  handle: (channel: string, listener: Listener): void => {
    handles.set(channel, listener)
  }
}
const event = { sender: { id: 1 }, senderFrame: { parent: null } }
const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve().then(() => {
    const handler = handles.get(channel)
    if (handler === undefined) throw new Error(`未登録: ${channel}`)
    return handler(event, ...args)
  })

const ALL = { kind: 'all' }
const RUN_1 = { kind: 'run', runId: 1 }
const RUN_2 = { kind: 'run', runId: 2 }

let repo: string
let home: string
let tempRoot: string
let registry: AgentBaselineRegistry
let trash: FakeTrash
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)

beforeEach(() => {
  ;({ repo, home, tempRoot } = createAgentBaselineRepo('agent-changes-handlers-int-'))
  handles.clear()
  trash = createFakeTrash()
  const folderAccess = new FolderAccessManager()
  folderAccess.set(1, repo)
  registry = new AgentBaselineRegistry({
    takeSnapshot: (folderPath, options) => takeBaselineSnapshot(folderPath, { ...options, tempRoot }),
    removeDir: removeBaselineDir,
    removeDirSync: removeBaselineDirSync,
    now: Date.now
  })
  registerAgentChangesHandlers(ipcMain as never, { registry, folderAccess, trash: trash.trash })
})

afterEach(() => {
  registry.close()
  disposeAgentBaselineRepo({ repo, home, tempRoot })
})

// 実行 1 で a.txt、実行 2 で b.txt を変える
async function twoRuns(): Promise<void> {
  write('a.txt', 'a\n')
  write('b.txt', 'b\n')
  commitAll(repo, 'init')
  await invoke('agentChanges:begin', 'send')
  write('a.txt', 'a\nrun1\n')
  await invoke('agentChanges:begin', 'send')
  write('b.txt', 'b\nrun2\n')
}

const pathsOf = async (scope: unknown): Promise<string[]> => {
  const result = (await invoke('agentChanges:list', scope)) as { entries: { path: string }[] }
  return result.entries.map((entry) => entry.path)
}

describe('agentChanges の handler(実 git)', () => {
  it('送信ごとに区切りを取り、範囲ごとの一覧・diff がその実行の変更だけになる', async () => {
    await twoRuns()
    expect(await pathsOf(RUN_1)).toEqual(['a.txt'])
    expect(await pathsOf(RUN_2)).toEqual(['b.txt'])
    expect(await pathsOf(ALL)).toEqual(['a.txt', 'b.txt'])
    expect(await invoke('agentChanges:getDiff', 'a.txt', RUN_1)).toContain('+run1')
    expect(await invoke('agentChanges:getDiff', 'b.txt', RUN_2)).toContain('+run2')
  })

  it('戻す系に実行の範囲を渡すと拒み、作業ツリーを変えない(範囲の検査を外すとこのテストが落ちる)', async () => {
    await twoRuns()
    const before = { a: readRepoFile(repo, 'a.txt'), b: readRepoFile(repo, 'b.txt') }
    const patch = (await invoke('agentChanges:getDiff', 'a.txt', ALL)) as string
    await expect(invoke('agentChanges:revertFile', 'a.txt', RUN_1)).rejects.toThrow(
      AGENT_CHANGES_REVERT_SCOPE_MESSAGE
    )
    await expect(invoke('agentChanges:revertHunk', 'a.txt', patch, RUN_1)).rejects.toThrow(
      AGENT_CHANGES_REVERT_SCOPE_MESSAGE
    )
    await expect(
      invoke(
        'agentChanges:revertAll',
        [
          { path: 'a.txt', status: 'M' },
          { path: 'b.txt', status: 'M' }
        ],
        RUN_2
      )
    ).rejects.toThrow(AGENT_CHANGES_REVERT_SCOPE_MESSAGE)
    expect({ a: readRepoFile(repo, 'a.txt'), b: readRepoFile(repo, 'b.txt') }).toEqual(before)
    expect(trash.trashed).toEqual([])
    // 累積の範囲なら戻せる(拒むのは範囲だけ)
    await invoke('agentChanges:revertFile', 'a.txt', ALL)
    expect(readRepoFile(repo, 'a.txt')).toBe('a\n')
  })
})
```

`src/preload/__tests__/api.test.ts` の `describe('エージェントの変更の API')` の表を次にする:
```ts
    [
      'beginAgentChanges は agentChanges:begin に trigger を渡す',
      () => api.beginAgentChanges('send'),
      ['agentChanges:begin', 'send']
    ],
    [
      'getAgentChangesState は agentChanges:getState を呼ぶ',
      () => api.getAgentChangesState(),
      ['agentChanges:getState']
    ],
    [
      'listAgentChanges は agentChanges:list に範囲を渡す',
      () => api.listAgentChanges({ kind: 'run', runId: 2 }),
      ['agentChanges:list', { kind: 'run', runId: 2 }]
    ],
    [
      'getAgentChangeDiff は agentChanges:getDiff にパスと範囲を渡す',
      () => api.getAgentChangeDiff('a.txt', { kind: 'all' }),
      ['agentChanges:getDiff', 'a.txt', { kind: 'all' }]
    ],
    [
      'revertAgentChange は agentChanges:revertFile にパスと範囲を渡す',
      () => api.revertAgentChange('a.txt', { kind: 'all' }),
      ['agentChanges:revertFile', 'a.txt', { kind: 'all' }]
    ],
    [
      'revertAgentChangeHunk は agentChanges:revertHunk にパス・パッチ・範囲を渡す',
      () => api.revertAgentChangeHunk('a.txt', 'patch', { kind: 'all' }),
      ['agentChanges:revertHunk', 'a.txt', 'patch', { kind: 'all' }]
    ],
    [
      'revertAllAgentChanges は agentChanges:revertAll に確認の一覧と範囲を渡す',
      () => api.revertAllAgentChanges([{ path: 'a.txt', status: 'M' }], { kind: 'all' }),
      ['agentChanges:revertAll', [{ path: 'a.txt', status: 'M' }], { kind: 'all' }]
    ],
    [
      'clearAgentChanges は agentChanges:clear を呼ぶ',
      () => api.clearAgentChanges(),
      ['agentChanges:clear']
    ]
```

- [ ] **Step 3: テストを走らせて失敗を確かめる**

Run: `npx vitest run src/shared/__tests__/agentChanges.test.ts src/main/__tests__/agentChangesScope.test.ts src/main/__tests__/handlers src/preload/__tests__/api.test.ts`
Expected: FAIL（`agentChangesScope`・parser の関数が無い・handler が範囲を受けない・preload が引数を渡さない）

- [ ] **Step 4: 実装する**

`src/shared/types/agentChanges.ts`: `AgentChangesList` の後の `AgentChangesListResult` を次にし、その前に範囲の型と判定を足す:
```ts
/** 一覧・diff の範囲。all: 累積(始点から)、run: 実行 1 つ(runId は AgentChangesRun.runId) */
export type AgentChangesScope = { kind: 'all' } | { kind: 'run'; runId: number }

/** 範囲の一覧を出せない理由(写しが古い)。run-missing: 実行が一覧に無い、start-not-recorded・end-not-recorded: 区切りを取れなかった */
export type AgentChangesScopeUnavailableReason =
  | 'run-missing'
  | 'start-not-recorded'
  | 'end-not-recorded'

/** 2 つの範囲が同じか(renderer が結果の範囲と今の範囲を照合する。L-037・L-040) */
export function isSameAgentChangesScope(a: AgentChangesScope, b: AgentChangesScope): boolean {
  return a.kind === 'all' ? b.kind === 'all' : b.kind === 'run' && a.runId === b.runId
}

/** 一覧の結果。recording・scope-unavailable は、実行の一覧と、一覧を取った範囲を添える */
export type AgentChangesListResult =
  | { kind: 'none' }
  | ({
      kind: 'recording'
      startedAt: number
      runs: AgentChangesRun[]
      scope: AgentChangesScope
    } & AgentChangesList)
  | {
      kind: 'scope-unavailable'
      startedAt: number
      runs: AgentChangesRun[]
      scope: AgentChangesScope
      reason: AgentChangesScopeUnavailableReason
    }
```
`src/shared/types.ts` の値の再 export に `isSameAgentChangesScope,` を足す。

`src/main/agentChangesScope.ts` を作る:
```ts
import type { AgentChangesScope, AgentChangesScopeUnavailableReason } from '@shared/types'
import type { BaselineSnapshot } from './agentBaselineSnapshot'
import type { AgentChangesRecord } from './agentChangesRecord'
import { runStartSnapshot } from './agentChangesRecord'

// 範囲(renderer が渡す列挙と runId)を、記録のどの記録で比べるかに解決する(設計書「範囲の解決」)。renderer の値は範囲の指定だけで、
// どの記録のインデックス・tree を使うかは main が決める(L-019)。runId は git の引数に入らない(L-034)

export type ResolvedAgentChangesScope =
  /** 累積: 始点 → 作業ツリー */
  | { kind: 'cumulative'; snapshot: BaselineSnapshot }
  /** 最後の実行: 開始の記録 → 作業ツリー(累積と同じ比べ方) */
  | { kind: 'toWorktree'; snapshot: BaselineSnapshot }
  /** 途中の実行: 開始の記録の tree → 次の実行の開始の記録の tree */
  | { kind: 'between'; start: BaselineSnapshot; end: BaselineSnapshot }
  | { kind: 'unavailable'; reason: AgentChangesScopeUnavailableReason }

export function resolveAgentChangesScope(
  record: AgentChangesRecord,
  scope: AgentChangesScope
): ResolvedAgentChangesScope {
  if (scope.kind === 'all') return { kind: 'cumulative', snapshot: record.baseline }
  const index = record.runs.findIndex((run) => run.runId === scope.runId)
  if (index === -1) return { kind: 'unavailable', reason: 'run-missing' }
  const start = runStartSnapshot(record, record.runs[index])
  if (start === null) return { kind: 'unavailable', reason: 'start-not-recorded' }
  const next = record.runs[index + 1]
  if (next === undefined) return { kind: 'toWorktree', snapshot: start }
  // 終わりの無い実行を「今まで」や次の取れた区切りまでに読み替えない(別の実行の変更が混ざる。L-002)
  const end = runStartSnapshot(record, next)
  if (end === null) return { kind: 'unavailable', reason: 'end-not-recorded' }
  return { kind: 'between', start, end }
}
```

`src/main/handlers/agentChangesPayloadParser.ts`: import を `import type { AgentChangesBeginTrigger, AgentChangesScope, AgentRevertAllEntry } from '@shared/types'` にし、末尾に足す:
```ts
/** 戻す系の IPC に実行の範囲が来たとき(実行ごとの表示は見るだけ。ボタンを押せなくするだけでなく main でも拒む。L-058) */
export const AGENT_CHANGES_REVERT_SCOPE_MESSAGE =
  '実行ごとの表示では戻せません。「すべて（累積）」を選んでから戻してください'

const SCOPE_INVALID_MESSAGE = '範囲(scope)が不正です'

/** 記録の開始の依頼の種類。省略・未知の値を既定に流さず例外にする(L-044) */
export function parseAgentChangesBeginTrigger(value: unknown): AgentChangesBeginTrigger {
  if (value !== 'send' && value !== 'manual') {
    throw new Error('trigger は send か manual である必要があります')
  }
  return value
}

/**
 * 一覧・diff の範囲。プレーンなオブジェクトで、キーは all なら kind だけ、run なら kind・runId だけ。runId は 1 以上の安全な整数。
 * どれかが外れたら例外(省略を all に流さない。L-044)。値は詰め直して返す
 */
export function parseAgentChangesScope(value: unknown): AgentChangesScope {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(SCOPE_INVALID_MESSAGE)
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (record.kind === 'all' && keys.length === 1) return { kind: 'all' }
  if (
    record.kind === 'run' &&
    keys.length === 2 &&
    keys.includes('runId') &&
    typeof record.runId === 'number' &&
    Number.isSafeInteger(record.runId) &&
    record.runId >= 1
  ) {
    return { kind: 'run', runId: record.runId }
  }
  throw new Error(SCOPE_INVALID_MESSAGE)
}

/** 戻す系の範囲。累積だけを受け付ける */
export function parseRevertScope(value: unknown): { kind: 'all' } {
  const scope = parseAgentChangesScope(value)
  if (scope.kind !== 'all') throw new Error(AGENT_CHANGES_REVERT_SCOPE_MESSAGE)
  return scope
}
```
冒頭のコメント（L5-6）の「ここは型と粗い上限だけ」の前に「範囲・trigger の列挙の検証、」を足す。

`src/main/handlers/agentChangesHandlers.ts`:
1. import を次にする:
```ts
import type {
  AgentChangesListResult,
  AgentChangesScope,
  AgentChangesState,
  DiscardAllResult
} from '@shared/types'
import type { AgentBaselineRegistry } from '../agentBaselineRegistry'
import { getAgentChangeDiff, getAgentChangeDiffBetween } from '../agentChangeDiff'
import { listAgentChanges, listAgentChangesBetween } from '../agentChangesQuery'
import type { AgentChangesRecord } from '../agentChangesRecord'
import { summarizeAgentChangesRuns } from '../agentChangesRecord'
import { resolveAgentChangesScope } from '../agentChangesScope'
import {
  revertAgentChange,
  revertAgentChangeHunk,
  revertAllAgentChanges
} from '../agentChangesRevert'
import type { FolderAccessManager } from '../folderAccessManager'
import { isMainFrameSender } from './ipcSenderGuard'
import {
  parseAgentChangePatch,
  parseAgentChangePath,
  parseAgentChangesBeginTrigger,
  parseAgentChangesScope,
  parseAgentRevertAllEntries,
  parseRevertScope
} from './agentChangesPayloadParser'
import { resolveAndAssertStatusRelativePath } from './gitPathResolver'
```
2. 冒頭のコメントを「renderer から受け取るのはパス・パッチ・確認の一覧・記録の開始の種類・範囲（列挙と runId）だけで、記録のインデックスの場所・tree・フォルダ・git の引数は main が決める」に直す。
3. `AGENT_CHANGES_NO_RECORD_MESSAGE` の次に足す:
```ts
export const AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE =
  'この実行の変更は表示できません（記録がありません）'

// 範囲の一覧(設計書「範囲ごとの一覧と diff」)。累積・最後の実行は作業ツリーとの比較、途中の実行は tree どうし。
// 選べない範囲(写しが古い)は一覧を作らず理由を返す
async function listInScope(
  record: AgentChangesRecord,
  scope: AgentChangesScope
): Promise<AgentChangesListResult> {
  const common = {
    startedAt: record.baseline.startedAt,
    runs: summarizeAgentChangesRuns(record),
    scope
  }
  const resolved = resolveAgentChangesScope(record, scope)
  switch (resolved.kind) {
    case 'unavailable':
      return { kind: 'scope-unavailable', ...common, reason: resolved.reason }
    case 'between':
      return {
        kind: 'recording',
        ...common,
        ...(await listAgentChangesBetween(resolved.start, resolved.end))
      }
    default:
      return { kind: 'recording', ...common, ...(await listAgentChanges(resolved.snapshot)) }
  }
}

// 範囲の 1 ファイルの diff。選べない範囲は例外
async function diffInScope(
  record: AgentChangesRecord,
  scope: AgentChangesScope,
  relativePath: string
): Promise<string> {
  const resolved = resolveAgentChangesScope(record, scope)
  if (resolved.kind === 'unavailable') {
    throw new Error(AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE)
  }
  if (resolved.kind === 'between') {
    return getAgentChangeDiffBetween(resolved.start, resolved.end, relativePath)
  }
  return getAgentChangeDiff(resolved.snapshot, relativePath)
}
```
4. `withRecordAtPath` の説明のコメントを「送信元の確認 → 引数の検証(parseArgs。パッチ・範囲) → フォルダが無ければ例外 → パスの検証 → 記録の列、の順」に直す。`const noArgs = …` は消す。
5. ハンドラを次にする（`getState`・`clear` はそのまま）:
```ts
  ipcMain.handle(
    'agentChanges:begin',
    async (event, trigger: unknown): Promise<AgentChangesState> => {
      const { ownerId, folder } = ownerOf(event)
      const parsedTrigger = parseAgentChangesBeginTrigger(trigger)
      if (folder === null) return { kind: 'none' }
      return registry.begin(ownerId, folder, parsedTrigger)
    }
  )
```
```ts
  ipcMain.handle(
    'agentChanges:list',
    async (event, scope: unknown): Promise<AgentChangesListResult> => {
      const { ownerId, folder } = ownerOf(event)
      const parsedScope = parseAgentChangesScope(scope)
      if (folder === null) return { kind: 'none' }
      const result = await registry.withRecord(ownerId, folder, (record) =>
        listInScope(record, parsedScope)
      )
      return result ?? { kind: 'none' }
    }
  )

  ipcMain.handle(
    'agentChanges:getDiff',
    (event, path: unknown, scope: unknown): Promise<string> =>
      withRecordAtPath(
        event,
        path,
        () => parseAgentChangesScope(scope),
        (record, relativePath, parsedScope) => diffInScope(record, parsedScope, relativePath)
      )
  )

  // 戻す系は累積の範囲だけを受け付け、実行の範囲は記録の列に入る前に拒む(L-058)。戻す先は累積の始点
  ipcMain.handle(
    'agentChanges:revertFile',
    async (event, path: unknown, scope: unknown): Promise<void> => {
      await withRecordAtPath(
        event,
        path,
        () => parseRevertScope(scope),
        (record, relativePath) => revertAgentChange({ snapshot: record.baseline, trash }, relativePath)
      )
    }
  )

  ipcMain.handle(
    'agentChanges:revertHunk',
    async (event, path: unknown, patch: unknown, scope: unknown): Promise<void> => {
      await withRecordAtPath(
        event,
        path,
        () => {
          const parsedPatch = parseAgentChangePatch(patch)
          parseRevertScope(scope)
          return parsedPatch
        },
        (record, relativePath, parsedPatch) =>
          revertAgentChangeHunk({ snapshot: record.baseline, trash }, relativePath, parsedPatch)
      )
    }
  )

  ipcMain.handle(
    'agentChanges:revertAll',
    async (event, expected: unknown, scope: unknown): Promise<DiscardAllResult> => {
      const { ownerId, folder } = ownerOf(event)
      const entries = parseAgentRevertAllEntries(expected)
      parseRevertScope(scope)
      return withRecordOrThrow(ownerId, folder, (record) =>
        revertAllAgentChanges({ snapshot: record.baseline, trash }, entries)
      )
    }
  )
```

`src/preload/api.ts`: import に `AgentChangesBeginTrigger`・`AgentChangesScope` を足し、エージェントの変更の関数を次にする（コメントの「記録の場所・フォルダ・git の引数は main が決める」は残す）:
```ts
  beginAgentChanges: (trigger: AgentChangesBeginTrigger): Promise<AgentChangesState> =>
    ipcRenderer.invoke('agentChanges:begin', trigger),
  getAgentChangesState: (): Promise<AgentChangesState> =>
    ipcRenderer.invoke('agentChanges:getState'),
  listAgentChanges: (scope: AgentChangesScope): Promise<AgentChangesListResult> =>
    ipcRenderer.invoke('agentChanges:list', scope),
  getAgentChangeDiff: (path: string, scope: AgentChangesScope): Promise<string> =>
    ipcRenderer.invoke('agentChanges:getDiff', path, scope),
  revertAgentChange: (path: string, scope: AgentChangesScope): Promise<void> =>
    ipcRenderer.invoke('agentChanges:revertFile', path, scope),
  revertAgentChangeHunk: (path: string, patch: string, scope: AgentChangesScope): Promise<void> =>
    ipcRenderer.invoke('agentChanges:revertHunk', path, patch, scope),
  revertAllAgentChanges: (
    expected: AgentRevertAllEntry[],
    scope: AgentChangesScope
  ): Promise<DiscardAllResult> => ipcRenderer.invoke('agentChanges:revertAll', expected, scope),
  clearAgentChanges: (): Promise<void> => ipcRenderer.invoke('agentChanges:clear')
```
`src/preload/index.d.ts`: import に `AgentChangesBeginTrigger`・`AgentChangesScope` を足し、宣言を次にする:
```ts
      beginAgentChanges(trigger: AgentChangesBeginTrigger): Promise<AgentChangesState>
      getAgentChangesState(): Promise<AgentChangesState>
      listAgentChanges(scope: AgentChangesScope): Promise<AgentChangesListResult>
      getAgentChangeDiff(path: string, scope: AgentChangesScope): Promise<string>
      revertAgentChange(path: string, scope: AgentChangesScope): Promise<void>
      revertAgentChangeHunk(path: string, patch: string, scope: AgentChangesScope): Promise<void>
      revertAllAgentChanges(
        expected: AgentRevertAllEntry[],
        scope: AgentChangesScope
      ): Promise<DiscardAllResult>
```

- [ ] **Step 5: テストを走らせて通ることを確かめる**

Run: `npx vitest run src/shared/__tests__/agentChanges.test.ts src/main/__tests__/agentChangesScope.test.ts src/main/__tests__/handlers src/preload/__tests__/api.test.ts`
Expected: PASS

- [ ] **Step 6: 範囲の検査を外すと結合テストが落ちることを確かめる（変異）**

`src/main/handlers/agentChangesHandlers.ts` の 3 か所の `parseRevertScope(scope)` を一時的に `parseAgentChangesScope(scope)` に書き換えて走らせる:
Run: `npx vitest run src/main/__tests__/handlers/agentChangesHandlers.integration.test.ts src/main/__tests__/handlers/agentChangesHandlers.test.ts`
Expected: FAIL（`戻す系に実行の範囲を渡すと拒み…` と `…は実行の範囲を記録の列に入る前に拒み…` が落ちる）
書き換えた 3 か所を `parseRevertScope(scope)` に戻し、もう一度走らせて PASS を確かめる（`grep -c "parseRevertScope(scope)" src/main/handlers/agentChangesHandlers.ts` が 3）。

- [ ] **Step 7: 検証**

Run: `npx vitest run src/main src/shared src/preload`
Expected: PASS
Run: `npm run typecheck:node`
Expected: エラーなし（`typecheck:web` は Task 5 まで落ちる。このタスクでは走らせなくてよい）
Run: 変更・作成した TypeScript のファイル（Files の一覧）へ `npx eslint --fix` → `npx eslint --max-warnings 0`
Expected: エラー・警告なし

---

### Task 5: renderer の API・写しと範囲・送信の `begin`・戻すと diff の範囲の受け渡し

**Files:**
- Modify: `src/renderer/src/lib/agentChangesApi.ts`（全体）
- Create: `src/renderer/src/lib/agentChangesScope.ts`
- Modify: `src/renderer/src/lib/agentChangesMessages.ts`（`AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE`・`formatAgentChangesRunMissingNotice`）
- Modify: `src/renderer/src/lib/agentChangesAvailability.ts`（`AgentRevertAvailability.isRunScope`）
- Modify: `src/renderer/src/lib/agentChangesWiring.ts`（`findAgentDiffTabsToClose`・`findActiveAgentEntry` が `getListedAgentChanges` を使う）
- Modify: `src/renderer/src/hooks/useAgentChanges.ts`（全体）
- Modify: `src/renderer/src/hooks/useAgentChangesRecording.ts`（全体）
- Modify: `src/renderer/src/hooks/useAgentChangesRevert.ts`（範囲の守りと受け渡し）
- Modify: `src/renderer/src/lib/diffTabSource.ts`（`agentScope`）
- Modify: `src/renderer/src/hooks/useDiffOperations.ts`（引数 `agentScope`・戻り値 `agentDiffScope`）
- Modify: `src/renderer/src/hooks/useAgentChangesWiring.ts`（`beginManuallyAndRefresh`・`agentDiffScope`・ハンクの範囲）
- Modify: `src/renderer/src/components/source-control/AgentChangesSection.tsx`（L68-69 の一覧の取り出しだけ。表示は Task 6）
- Modify: `src/renderer/src/hooks/useAppState.ts`（L156-161・L203-208・L525-538）、`src/renderer/src/hooks/useAgentWorkspace.ts`（L69 のコメント）
- Modify: `src/renderer/src/__tests__/makeAgentChangesState.ts`（`makeAgentChangesRun`・写しと一覧の結果の既定値・controller の `scope`・`selectScope`）
- Test: `src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts`、`src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`（`makeProps`）、`src/renderer/src/hooks/__tests__/useAgentChangesClearFocus.test.tsx`、`src/renderer/src/lib/__tests__/agentChangesApi.test.ts`、`src/renderer/src/lib/__tests__/agentChangesScope.test.ts`（新規）、`src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts`、`src/renderer/src/lib/__tests__/agentChangesWiring.test.ts`、`src/renderer/src/lib/__tests__/diffTabSource.test.ts`、`src/renderer/src/hooks/__tests__/useAgentChanges.test.ts`、`src/renderer/src/hooks/__tests__/useAgentChangesRecording.test.ts`、`src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`、`src/renderer/src/hooks/__tests__/useDiffOperations.test.ts`、`src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts`、`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`、`src/renderer/src/components/__tests__/App.agentChanges.test.tsx`

**Interfaces:**
- Consumes: 共有の型 `AgentChangesBeginTrigger`・`AgentChangesRun`・`AgentChangesScope`・`AgentChangesScopeUnavailableReason`・`AgentChangesListResult`・`isSameAgentChangesScope`（Task 3・4）、`window.api` の新しい引数（Task 4）
- Produces:
```ts
// src/renderer/src/lib/agentChangesApi.ts
export function beginAgentChanges(trigger: AgentChangesBeginTrigger): Promise<AgentChangesState>
export function listAgentChanges(scope: AgentChangesScope): Promise<AgentChangesListResult>
export function getAgentChangeDiff(path: string, scope: AgentChangesScope): Promise<string>
export function revertAgentChange(path: string, scope: AgentChangesScope): Promise<void>
export function revertAgentChangeHunk(path: string, patch: string, scope: AgentChangesScope): Promise<void>
export function revertAllAgentChanges(expected: AgentRevertAllEntry[], scope: AgentChangesScope): Promise<DiscardAllResult>
// src/renderer/src/lib/agentChangesScope.ts
export const AGENT_CHANGES_ALL_SCOPE: AgentChangesScope // { kind: 'all' }
export type ListedAgentChanges = Extract<AgentChangesViewList, { kind: 'listed' }>
export function getListedAgentChanges(view: AgentChangesView): ListedAgentChanges | null
export function findAgentChangesRun(runs: readonly AgentChangesRun[], runId: number): AgentChangesRun | undefined
// src/renderer/src/hooks/useAgentChanges.ts
export type AgentChangesViewList =
  | ({ kind: 'listed'; scope: AgentChangesScope } & AgentChangesList)
  | { kind: 'scope-unavailable'; scope: AgentChangesScope; reason: AgentChangesScopeUnavailableReason }
export type AgentChangesView =
  | { kind: 'none' }
  | { kind: 'unavailable'; state: Extract<AgentChangesState, { kind: 'unavailable' }> }
  | { kind: 'recording'; startedAt: number; runs: AgentChangesRun[]; list: AgentChangesViewList | null }
export interface AgentChangesController {
  /* 既存 */
  scope: AgentChangesScope
  selectScope: (scope: AgentChangesScope) => void
  begin: (trigger: AgentChangesBeginTrigger) => Promise<void>
}
// src/renderer/src/hooks/useAgentChangesRecording.ts
export interface AgentChangesRecording {
  changes: AgentChangesController
  beginForSendAndRefresh: () => Promise<void>
  beginManuallyAndRefresh: () => Promise<void>
}
// src/renderer/src/lib/agentChangesMessages.ts
export const AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE = '実行ごとの表示では戻せません。「すべて（累積）」を選ぶと戻せます'
export function formatAgentChangesRunMissingNotice(runNumber: number): string
// src/renderer/src/lib/agentChangesAvailability.ts
export interface AgentRevertAvailability { isLoading: boolean; isGitBusy: boolean; isReverting: boolean; hasListError: boolean; isRunScope: boolean }
// src/renderer/src/hooks/useAgentChangesRevert.ts
revertHunk: (path: string, patch: string, hunkHeader: string, scope: AgentChangesScope) => Promise<void>
// src/renderer/src/lib/diffTabSource.ts
export interface DiffTabFetchContext { isUntracked: boolean; renamedFrom: string | undefined; agentScope: AgentChangesScope }
// src/renderer/src/hooks/useDiffOperations.ts
export function useDiffOperations(activeDiffTab: DiffTabKey | null, refreshGitStatus: () => Promise<void>, gitStatusFiles: GitFileStatus[], agentScope: AgentChangesScope, fileLock?: FileOperationLock): DiffOperationsState
export interface DiffOperationsState { /* 既存 */ agentDiffScope: AgentChangesScope | null }
// src/renderer/src/hooks/useAgentChangesWiring.ts
export interface AgentChangesWiringOptions { /* 既存 */ agentDiffScope: AgentChangesScope | null }
export interface AgentChangesPanelState {
  changes: Omit<Pick<AgentChangesController, 'view' | 'isLoading' | 'isBeginning' | 'listError' | 'notice' | 'savedPaths' | 'begin' | 'refresh' | 'clear'>, 'begin'> & { begin: () => Promise<void> }
  /* 既存 */
}
// src/renderer/src/__tests__/makeAgentChangesState.ts
export function makeAgentChangesRun(overrides?: Partial<AgentChangesRun>): AgentChangesRun
/** セクションへ渡す changes(begin は引数なし)。既定は makeAgentChangesController の既定と、resolve する begin の vi.fn */
export function makeAgentChangesPanelChanges(overrides?: Partial<AgentChangesPanelState['changes']>): AgentChangesPanelState['changes']
export function makeAgentChangesRecordingView(entries: AgentChangeEntry[] | null, overrides?: { startedAt?: number; totalCount?: number; truncated?: boolean; headChanged?: boolean; runs?: AgentChangesRun[]; scope?: AgentChangesScope }): AgentChangesView
```

- [ ] **Step 1: テストの偽物を新しい形にする**

`src/renderer/src/__tests__/makeAgentChangesState.ts`:
1. import を `import type { AgentChangeEntry, AgentChangesList, AgentChangesListResult, AgentChangesRun, AgentChangesScope } from '@shared/types'` にする。
2. `makeAgentChangesList` の次に足す:
```ts
/** 実行 1 つ。既定は runId・number 1、開始 100、最後の実行(終わり null)、選べる */
export function makeAgentChangesRun(overrides: Partial<AgentChangesRun> = {}): AgentChangesRun {
  return {
    runId: 1,
    number: 1,
    startedAt: 100,
    endedAt: null,
    availability: { kind: 'available' },
    ...overrides
  }
}
```
3. `makeAgentChangesRecordingView`・`makeAgentChangesListResult` を次にする:
```ts
/** 記録中の view。entries が null なら一覧をまだ取っていない記録中。startedAt の既定は 100、実行なし、一覧の範囲は累積 */
export function makeAgentChangesRecordingView(
  entries: AgentChangeEntry[] | null,
  overrides: {
    startedAt?: number
    totalCount?: number
    truncated?: boolean
    headChanged?: boolean
    runs?: AgentChangesRun[]
    scope?: AgentChangesScope
  } = {}
): AgentChangesView {
  const { startedAt = 100, runs = [], scope = { kind: 'all' }, ...listOverrides } = overrides
  return {
    kind: 'recording',
    startedAt,
    runs,
    list:
      entries === null
        ? null
        : { kind: 'listed', scope, ...makeAgentChangesList(entries, listOverrides) }
  }
}

/** IPC の list の結果(kind: 'recording')。startedAt の既定は 100、実行なし、範囲は累積 */
export function makeAgentChangesListResult(
  entries: AgentChangeEntry[],
  overrides: Partial<
    Omit<Extract<AgentChangesListResult, { kind: 'recording' }>, 'kind' | 'entries'>
  > = {}
): AgentChangesListResult {
  const { startedAt = 100, runs = [], scope = { kind: 'all' }, ...listOverrides } = overrides
  return {
    kind: 'recording',
    startedAt,
    runs,
    scope,
    ...makeAgentChangesList(entries, listOverrides)
  }
}
```
4. `makeAgentChangesController` の `savedPaths: new Set(),` の次に `scope: { kind: 'all' },`、`announce` の次に `selectScope: vi.fn<AgentChangesController['selectScope']>(),` を足す。
5. `makeAgentChangesRevertState` の前に足し、`makeAgentChangesPanelState` の `changes: makeAgentChangesController(),` を `changes: makeAgentChangesPanelChanges(),` にする（controller の `begin` は `trigger` が必須で、パネルの `begin`〈引数なし〉に流し込めないため）:
```ts
/** セクションへ渡す changes(パネルの begin は引数なし)。既定は makeAgentChangesController の既定と、resolve する begin の vi.fn */
export function makeAgentChangesPanelChanges(
  overrides: Partial<AgentChangesPanelState['changes']> = {}
): AgentChangesPanelState['changes'] {
  return {
    ...makeAgentChangesController(),
    begin: vi.fn<AgentChangesPanelState['changes']['begin']>(async () => undefined),
    ...overrides
  }
}
```
6. パネルの changes を controller から作っているテストを直す:
   - `src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx` の `makeProps` の `makeAgentChangesPanelState({ changes: makeAgentChangesController({ view, ...changes }) })` を `makeAgentChangesPanelState({ changes: makeAgentChangesPanelChanges({ view, ...changes }) })` にする（import に `makeAgentChangesPanelChanges`。`makeAgentChangesController` を使わなくなったら import から外す）。
   - `src/renderer/src/hooks/__tests__/useAgentChangesClearFocus.test.tsx` の `changes: makeAgentChangesController({ view, clear })` を `changes: makeAgentChangesPanelChanges({ view, clear })` にする（import も同じく直す）。
   - `src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts` の `describe('makeAgentChangesPanelState')` の `const changes = makeAgentChangesController({ isLoading: true })` を `const changes = makeAgentChangesPanelChanges({ isLoading: true })` にし、末尾に足す:
```ts
describe('makeAgentChangesPanelChanges', () => {
  it('begin は引数なしで resolve する vi.fn で、ほかは controller の既定。指定した項目だけを上書きする', async () => {
    const changes = makeAgentChangesPanelChanges({ isLoading: true })
    expect(vi.isMockFunction(changes.begin)).toBe(true)
    await expect(changes.begin()).resolves.toBeUndefined()
    expect(changes.isLoading).toBe(true)
    expect(changes.view).toEqual({ kind: 'none' })
  })
})
```

`src/renderer/src/__tests__/__tests__/makeAgentChangesState.test.ts`:
1. `makeAgentChangesRecordingView` の 3 つの期待値に `runs: [],` を足し、`list` を `{ kind: 'listed', scope: { kind: 'all' }, entries…}` にする（`list: null` はそのまま）。
2. `makeAgentChangesListResult` の 2 つの期待値に `runs: [],` と `scope: { kind: 'all' },` を足す。
3. `makeAgentChangesController` の既定のテストの `for (const fn of [controller.begin, controller.refresh, controller.clear])` を `for (const fn of [controller.refresh, controller.clear])` にし、その後に足す:
```ts
    await expect(controller.begin('manual')).resolves.toBeUndefined()
    expect(controller.scope).toEqual({ kind: 'all' })
    expect(vi.isMockFunction(controller.selectScope)).toBe(true)
```
4. ファイルの末尾に足す（import に `makeAgentChangesRun`）:
```ts
describe('makeAgentChangesRun', () => {
  it('既定は runId・number 1、開始 100、最後の実行、選べる。指定した項目だけを上書きする', () => {
    expect(makeAgentChangesRun()).toEqual({
      runId: 1,
      number: 1,
      startedAt: 100,
      endedAt: null,
      availability: { kind: 'available' }
    })
    expect(makeAgentChangesRun({ runId: 3, endedAt: 200 })).toMatchObject({
      runId: 3,
      number: 1,
      endedAt: 200
    })
  })
})
```

- [ ] **Step 2: 既存のテストの呼び出し・期待値を新しい引数に合わせる（機械的な置き換え）**

```bash
# useAgentChanges: begin に 'manual'、記録中の写しに runs: []
perl -pi -e "s/\.begin\(\)/.begin('manual')/g; s/\{ kind: 'recording', startedAt: (\d+), list: null \}/{ kind: 'recording', startedAt: \$1, runs: [], list: null }/g" \
  src/renderer/src/hooks/__tests__/useAgentChanges.test.ts
# useAppState.agent・App.agentChanges: セクションの begin は引数なし(beginManuallyAndRefresh)のまま。window.api の呼び出しの期待値は下で手で直す
# useAgentChangesRevert: revertHunk に範囲
perl -pi -e "s/revertHunk\(('[^']*'), 'patch', '([^']*)'\)/revertHunk(\$1, 'patch', '\$2', ALL_SCOPE)/g" \
  src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts
# useAgentChangesWiring: recording の 2 つの関数
perl -pi -e "s/beginAndRefresh: vi\.fn\(async \(\) => undefined\)/beginForSendAndRefresh: vi.fn(async () => undefined), beginManuallyAndRefresh: vi.fn(async () => undefined)/g; s/\bbeginAndRefresh\b/beginManuallyAndRefresh/g" \
  src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts
# agentChangesAvailability: 範囲の条件を足す
perl -pi -e "s/const none = \{ isLoading: false, isGitBusy: false, isReverting: false, hasListError: false \}/const none = { isLoading: false, isGitBusy: false, isReverting: false, hasListError: false, isRunScope: false }/g" \
  src/renderer/src/lib/__tests__/agentChangesAvailability.test.ts
# useDiffOperations: 既存の呼び出しを、累積で呼ぶ補助関数に替える(import の行は `useDiffOperations(` を含まない)
perl -pi -e "s/\buseDiffOperations\(/useDiffOperationsForTest(/g" \
  src/renderer/src/hooks/__tests__/useDiffOperations.test.ts
git diff --stat
```
Expected: 6 ファイルが変わる。

続けて手で直す:
1. `useAgentChanges.test.ts` の 1 つめのテストの `list` の期待値（L56-66）を次にする:
```ts
    expect(result.current.view).toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [],
      list: {
        kind: 'listed',
        scope: { kind: 'all' },
        entries: [{ path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false }],
        totalCount: 1,
        truncated: false,
        headChanged: false
      }
    })
```
   ほかに `toEqual` で写しの `list` の中身（`entries` を持つ値）を比べている箇所があれば、同じく `kind: 'listed'`・`scope: { kind: 'all' }` と写しの `runs: []` を足す（`grep -n "list: {" src/renderer/src/hooks/__tests__/useAgentChanges.test.ts`）。
2. `useAgentChangesRevert.test.ts`: import に `import type { AgentChangesScope } from '@shared/types'` を足し、`const makeLock` の前に `const ALL_SCOPE: AgentChangesScope = { kind: 'all' }` を足す。`makeOptions` の `changes: makeAgentChangesController({ view: { kind: 'recording', startedAt: 1, list } })` を `changes: makeAgentChangesController({ view: { kind: 'recording', startedAt: 1, runs: [], list: list === null ? null : { kind: 'listed', scope: ALL_SCOPE, ...list } } })` にする。`describe('useAgentChangesRevert — 失敗の文言を消す契機')` の `recordingAt` を次にする:
```ts
  const recordingAt = (startedAt: number): AgentChangesRevertOptions['changes']['view'] => ({
    kind: 'recording',
    startedAt,
    runs: [],
    list: {
      kind: 'listed',
      scope: ALL_SCOPE,
      ...makeAgentChangesList([makeAgentChangeEntry('a.txt')])
    }
  })
```
IPC の期待値に範囲を足す: `revertAgentChange).toHaveBeenCalledWith('src/a.txt')` → `('src/a.txt', ALL_SCOPE)`、`revertAgentChangeHunk).toHaveBeenCalledWith('a.txt', 'patch')` → `('a.txt', 'patch', ALL_SCOPE)`、`revertAllAgentChanges).toHaveBeenCalledWith([ … ])` → 第 2 引数に `ALL_SCOPE`（`grep -n "toHaveBeenCalledWith\|ExactlyOnceWith" src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts` で、`agentChangesApi.` の呼び出しの期待値をすべて直す）。
3. `useAgentChangesWiring.test.ts`: `makeOptions` の戻り値に `agentDiffScope: { kind: 'all' },` を足す。`'ハンクを戻すと、開いている agent のタブのパスで戻す'` の期待値を `('a.txt', 'patch', '@@ -1 +1 @@', { kind: 'all' })` にする。
4. `agentChangesAvailability.test.ts`: `combinations` に `isRunScope` の組を足す（`flags.map((hasNotRecorded) => …)` を `flags.flatMap((hasNotRecorded) => flags.map((isRunScope) => ({ …, hasNotRecorded, isRunScope })))` にする）。`blocked` に `|| availability.isRunScope` を足し、`fileOrder` の `[availability.isGitBusy, AGENT_CHANGES_BUSY_GIT]` の次に `[availability.isRunScope, AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE]` を足す（import に `AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE`）。
5. `useDiffOperations.test.ts`: import に `import type { AgentChangesScope, GitFileStatus } from '@shared/types'` と `import type { DiffOperationsState } from '../useDiffOperations'` を足し、`const makeFileLock` の前に足す:
```ts
// 既存のテストは累積の範囲で呼ぶ(範囲を試すテストは useDiffOperations を直接呼ぶ)
const ALL_SCOPE: AgentChangesScope = { kind: 'all' }
function useDiffOperationsForTest(
  activeDiffTab: DiffTabKey | null,
  refreshGitStatus: () => Promise<void>,
  gitStatusFiles: GitFileStatus[],
  fileLock?: FileOperationLock
): DiffOperationsState {
  return useDiffOperations(activeDiffTab, refreshGitStatus, gitStatusFiles, ALL_SCOPE, fileLock)
}
```
6. `useAppState.agent.test.ts` の `'送信の前の準備(beforeAgentSend)は記録を始めてから一覧を取る'` の `expect(window.api.beginAgentChanges).toHaveBeenCalledOnce()` を `expect(window.api.beginAgentChanges).toHaveBeenCalledExactlyOnceWith('send')` にする。
7. `App.agentChanges.test.tsx`: `expect(window.api.beginAgentChanges).toHaveBeenCalledOnce()` → `toHaveBeenCalledExactlyOnceWith('manual')`、`getAgentChangeDiff).toHaveBeenCalledWith('a.txt')` → `('a.txt', { kind: 'all' })`、`revertAgentChangeHunk).toHaveBeenCalledWith('a.txt', expect.stringContaining('@@ -1 +1 @@'))` → 第 3 引数に `{ kind: 'all' }`、`revertAgentChange).toHaveBeenCalledWith('new.txt')` → `('new.txt', { kind: 'all' })`。
8. `agentChangesApi.test.ts` の呼び出しと期待値に引数を足す: `beginAgentChanges('send')`、`listAgentChanges({ kind: 'all' })`、`getAgentChangeDiff('a.txt', { kind: 'all' })`、`revertAgentChange('a.txt', { kind: 'all' })`、`revertAgentChangeHunk('a.txt', 'patch', { kind: 'all' })`、`revertAllAgentChanges([{ path: 'a.txt', status: 'M' }], { kind: 'all' })`。期待値も同じ引数（`beginAgentChanges` は `toHaveBeenCalledWith('send')`、`listAgentChanges` は `toHaveBeenCalledWith({ kind: 'all' })`）。

- [ ] **Step 3: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentChangesScope.test.ts` を作る:
```ts
import { describe, it, expect } from 'vitest'
import {
  AGENT_CHANGES_ALL_SCOPE,
  findAgentChangesRun,
  getListedAgentChanges
} from '../agentChangesScope'
import {
  makeAgentChangeEntry,
  makeAgentChangesRecordingView,
  makeAgentChangesRun
} from '../../__tests__/makeAgentChangesState'

describe('getListedAgentChanges', () => {
  it('記録中で範囲の一覧が取れていれば、その一覧を返す', () => {
    const view = makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
    expect(getListedAgentChanges(view)?.entries.map((entry) => entry.path)).toEqual(['a.txt'])
  })

  it('記録なし・取り直す前・範囲の一覧が取れない(scope-unavailable)なら null', () => {
    expect(getListedAgentChanges({ kind: 'none' })).toBeNull()
    expect(getListedAgentChanges(makeAgentChangesRecordingView(null))).toBeNull()
    expect(
      getListedAgentChanges({
        kind: 'recording',
        startedAt: 1,
        runs: [],
        list: { kind: 'scope-unavailable', scope: { kind: 'run', runId: 2 }, reason: 'end-not-recorded' }
      })
    ).toBeNull()
  })
})

describe('findAgentChangesRun', () => {
  it('runId の実行を返し、無ければ undefined', () => {
    const runs = [makeAgentChangesRun({ runId: 1 }), makeAgentChangesRun({ runId: 4, number: 2 })]
    expect(findAgentChangesRun(runs, 4)?.number).toBe(2)
    expect(findAgentChangesRun(runs, 9)).toBeUndefined()
  })
})

it('累積の範囲', () => {
  expect(AGENT_CHANGES_ALL_SCOPE).toEqual({ kind: 'all' })
})
```

`src/renderer/src/lib/__tests__/agentChangesWiring.test.ts` の `findAgentDiffTabsToClose` の describe に足す:
```ts
  it('範囲の一覧が取れない(scope-unavailable)間は、消えたかが分からないため null', () => {
    expect(
      findAgentDiffTabsToClose([{ path: 'a.txt', kind: 'agent' }], {
        kind: 'recording',
        startedAt: 1,
        runs: [],
        list: { kind: 'scope-unavailable', scope: { kind: 'run', runId: 1 }, reason: 'start-not-recorded' }
      })
    ).toBeNull()
  })
```

`src/renderer/src/lib/__tests__/diffTabSource.test.ts`: 3 つの呼び出しの文脈に `agentScope: { kind: 'all' }` を足し（agent のテストは `agentScope: { kind: 'run', runId: 2 }`）、agent のテストの期待値を `expect(agentChangesApi.getAgentChangeDiff).toHaveBeenCalledWith('a.ts', { kind: 'run', runId: 2 })` にする。

`src/renderer/src/hooks/__tests__/useAgentChanges.test.ts` の末尾に足す（import に `AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE` は不要。`makeAgentChangesRun` を足す）:
```ts
describe('useAgentChanges の範囲と実行', () => {
  const run1 = makeAgentChangesRun({ runId: 1, number: 1, startedAt: 100, endedAt: 200 })
  const run2 = makeAgentChangesRun({ runId: 2, number: 2, startedAt: 200 })
  const recordingWith = (runs: AgentChangesRun[], startedAt = 100): AgentChangesState => ({
    kind: 'recording',
    startedAt,
    runs
  })
  const listIn = (
    scope: AgentChangesScope,
    paths: string[],
    runs: AgentChangesRun[] = [run1, run2]
  ): AgentChangesListResult =>
    makeAgentChangesListResult(
      paths.map((path) => makeAgentChangeEntry(path)),
      { scope, runs }
    )
  const RUN_1: AgentChangesScope = { kind: 'run', runId: 1 }

  // 記録中(実行 1・2)にして累積の一覧を取った状態にする
  async function recordingTwoRuns(): Promise<{ current: AgentChangesController }> {
    window.api.beginAgentChanges = vi.fn().mockResolvedValue(recordingWith([run1, run2]))
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listIn({ kind: 'all' }, ['a.txt']))
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin('send')
      await result.current.refresh()
    })
    return result
  }

  it('begin は trigger を main へ渡し、写しに実行の一覧を持つ', async () => {
    const result = await recordingTwoRuns()
    expect(window.api.beginAgentChanges).toHaveBeenCalledWith('send')
    expect(result.current.view).toMatchObject({ kind: 'recording', runs: [run1, run2] })
    expect(result.current.scope).toEqual({ kind: 'all' })
  })

  it('範囲を選ぶと一覧を空にして、その範囲で取り直す', async () => {
    const result = await recordingTwoRuns()
    const pending = deferred<AgentChangesListResult>()
    window.api.listAgentChanges = vi.fn(() => pending.promise)
    act(() => result.current.selectScope(RUN_1))
    expect(result.current.scope).toEqual(RUN_1)
    expect(result.current.view).toMatchObject({ kind: 'recording', list: null })
    expect(window.api.listAgentChanges).toHaveBeenCalledWith(RUN_1)
    await act(async () => {
      pending.resolve(listIn(RUN_1, ['b.txt']))
    })
    expect(result.current.view).toMatchObject({
      kind: 'recording',
      list: { kind: 'listed', scope: RUN_1, entries: [{ path: 'b.txt' }] }
    })
  })

  it('範囲の違う古い一覧の結果を捨てる(L-040)', async () => {
    const result = await recordingTwoRuns()
    const old = deferred<AgentChangesListResult>()
    const fresh = deferred<AgentChangesListResult>()
    window.api.listAgentChanges = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise)
    let refreshing: Promise<void> = Promise.resolve()
    act(() => {
      refreshing = result.current.refresh()
    })
    act(() => result.current.selectScope(RUN_1))
    await act(async () => {
      old.resolve(listIn({ kind: 'all' }, ['old.txt']))
      await refreshing
    })
    expect(result.current.view).toMatchObject({ list: null })
    await act(async () => {
      fresh.resolve(listIn(RUN_1, ['b.txt']))
    })
    expect(result.current.view).toMatchObject({ list: { scope: RUN_1, entries: [{ path: 'b.txt' }] } })
  })

  it('main が run-missing を返したら、範囲を累積に戻して取り直し、消える前の番号で読み上げる', async () => {
    const result = await recordingTwoRuns()
    window.api.listAgentChanges = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'scope-unavailable',
        startedAt: 100,
        runs: [run2],
        scope: RUN_1,
        reason: 'run-missing'
      })
      .mockResolvedValueOnce(listIn({ kind: 'all' }, ['a.txt'], [run2]))
    await act(async () => {
      result.current.selectScope(RUN_1)
    })
    await waitFor(() =>
      expect(result.current.view).toMatchObject({ list: { kind: 'listed', scope: { kind: 'all' } } })
    )
    expect(result.current.scope).toEqual({ kind: 'all' })
    expect(window.api.listAgentChanges).toHaveBeenLastCalledWith({ kind: 'all' })
    expect(toAnnouncementText(result.current.notice)).toBe(
      '実行 1 の記録は古くなったため消えました。すべて（累積）を表示します'
    )
  })

  it('begin の結果の実行の一覧に選んでいる実行が無ければ、範囲を累積に戻して取り直し、読み上げる', async () => {
    const result = await recordingTwoRuns()
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listIn(RUN_1, ['a.txt']))
    await act(async () => {
      result.current.selectScope(RUN_1)
    })
    window.api.beginAgentChanges = vi.fn().mockResolvedValue(recordingWith([run2]))
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listIn({ kind: 'all' }, ['a.txt'], [run2]))
    await act(async () => {
      await result.current.begin('send')
    })
    await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalledWith({ kind: 'all' }))
    expect(result.current.scope).toEqual({ kind: 'all' })
    expect(toAnnouncementText(result.current.notice)).toBe(
      '実行 1 の記録は古くなったため消えました。すべて（累積）を表示します'
    )
  })

  it('範囲の一覧が取れない(start-not-recorded など)ときは、一覧の代わりに理由を持つ', async () => {
    const result = await recordingTwoRuns()
    window.api.listAgentChanges = vi.fn().mockResolvedValue({
      kind: 'scope-unavailable',
      startedAt: 100,
      runs: [run1, run2],
      scope: RUN_1,
      reason: 'end-not-recorded'
    })
    await act(async () => {
      result.current.selectScope(RUN_1)
    })
    await waitFor(() =>
      expect(result.current.view).toMatchObject({
        list: { kind: 'scope-unavailable', scope: RUN_1, reason: 'end-not-recorded' }
      })
    )
    expect(result.current.scope).toEqual(RUN_1)
  })

  it('記録がある間の send の begin が例外になっても、写しを変えない', async () => {
    const result = await recordingTwoRuns()
    const before = result.current.view
    window.api.beginAgentChanges = vi.fn().mockRejectedValue(new Error('ipc'))
    await act(async () => {
      await result.current.begin('send')
    })
    expect(result.current.view).toBe(before)
  })

  it('新しい記録(startedAt が変わった)・確認を終える・フォルダの切り替えで、範囲を累積に戻す', async () => {
    const result = await recordingTwoRuns()
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listIn(RUN_1, ['a.txt']))
    await act(async () => {
      result.current.selectScope(RUN_1)
    })
    window.api.getAgentChangesState = vi.fn().mockResolvedValue(recordingWith([run1], 999))
    window.api.beginAgentChanges = vi.fn().mockResolvedValue(recordingWith([run1], 999))
    await act(async () => {
      await result.current.begin('manual')
    })
    expect(result.current.scope).toEqual({ kind: 'all' })
    await act(async () => {
      result.current.selectScope(RUN_1)
    })
    await act(async () => {
      await result.current.clear()
    })
    expect(result.current.scope).toEqual({ kind: 'all' })
  })

  it('フォルダを切り替えると、範囲を累積に戻す', async () => {
    window.api.beginAgentChanges = vi.fn().mockResolvedValue(recordingWith([run1, run2]))
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listIn(RUN_1, ['a.txt']))
    const { result, rerender } = renderHook(({ folder }) => useAgentChanges(folder), {
      initialProps: { folder: '/a' as string | null }
    })
    await act(async () => {
      await result.current.begin('send')
      result.current.selectScope(RUN_1)
    })
    expect(result.current.scope).toEqual(RUN_1)
    rerender({ folder: '/b' })
    expect(result.current.scope).toEqual({ kind: 'all' })
  })
})
```
（import に `AgentChangesRun`・`AgentChangesScope` の型〈`@shared/types`〉、`AgentChangesController` の型〈`../useAgentChanges`〉、`makeAgentChangesRun` を足す）

`src/renderer/src/hooks/__tests__/useAgentChangesRecording.test.ts` を次にする:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AgentChangesController } from '../useAgentChanges'

// 記録の写しそのものは useAgentChanges.test.ts で確かめる。ここでは前段の合成(begin → 一覧の取り直し・trigger・参照の安定)だけを見る
const mockUseAgentChanges = vi.hoisted(() =>
  vi.fn<(folderPath: string | null) => AgentChangesController>()
)
vi.mock('../useAgentChanges', () => ({ useAgentChanges: mockUseAgentChanges }))

import { useAgentChangesRecording } from '../useAgentChangesRecording'
import type { AgentChangesRecording } from '../useAgentChangesRecording'
import { makeAgentChangesController } from '../../__tests__/makeAgentChangesState'

beforeEach(() => {
  vi.clearAllMocks()
})

const variants = [
  ['beginForSendAndRefresh', 'send'],
  ['beginManuallyAndRefresh', 'manual']
] as const satisfies readonly (readonly [keyof Omit<AgentChangesRecording, 'changes'>, string])[]

describe('useAgentChangesRecording', () => {
  it('開いているフォルダを useAgentChanges に渡し、その戻り値を changes として返す', () => {
    const controller = makeAgentChangesController()
    mockUseAgentChanges.mockReturnValue(controller)
    const { result } = renderHook(() => useAgentChangesRecording('/repo'))
    expect(mockUseAgentChanges).toHaveBeenCalledWith('/repo')
    expect(result.current.changes).toBe(controller)
  })

  it.each(variants)('%s は %s で記録を始め終えてから、件数を読み上げずに一覧を取り直す', async (name, trigger) => {
    const calls: string[] = []
    let resolveBegin: () => void = () => undefined
    const controller = makeAgentChangesController({
      begin: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            calls.push('begin')
            resolveBegin = resolve
          })
      ),
      refresh: vi.fn(async () => {
        calls.push('refresh')
      })
    })
    mockUseAgentChanges.mockReturnValue(controller)
    const { result } = renderHook(() => useAgentChangesRecording('/repo'))
    let done: Promise<void> = Promise.resolve()
    act(() => {
      done = result.current[name]()
    })
    expect(calls).toEqual(['begin'])
    expect(controller.begin).toHaveBeenCalledExactlyOnceWith(trigger)
    await act(async () => {
      resolveBegin()
      await done
    })
    expect(calls).toEqual(['begin', 'refresh'])
    expect(controller.refresh).toHaveBeenCalledExactlyOnceWith()
  })

  it.each(variants)('%s は一覧の取り直しの終わりを待たない', async (name) => {
    const controller = makeAgentChangesController({
      refresh: vi.fn(() => new Promise<void>(() => undefined))
    })
    mockUseAgentChanges.mockReturnValue(controller)
    const { result } = renderHook(() => useAgentChangesRecording('/repo'))
    let settled = false
    await act(async () => {
      await result.current[name]()
      settled = true
    })
    expect(settled).toBe(true)
    expect(controller.refresh).toHaveBeenCalledOnce()
  })

  // 送信の関数(useAgentPromptSender.send)とセクションのボタンの依存になるため、描画のたびに作り直さない
  it.each(variants)('%s の参照は、begin・refresh が同じなら描画をまたいで変わらない', (name) => {
    const begin = vi.fn(async () => undefined)
    const refresh = vi.fn(async () => undefined)
    mockUseAgentChanges.mockImplementation(() => makeAgentChangesController({ begin, refresh }))
    const { result, rerender } = renderHook(() => useAgentChangesRecording('/repo'))
    const first = result.current[name]
    rerender()
    expect(result.current[name]).toBe(first)
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts` の末尾に足す（import に `AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE`）:
```ts
describe('実行の範囲では戻さない(L-058・L-061)', () => {
  const RUN: AgentChangesScope = { kind: 'run', runId: 2 }
  const runView = (scope: AgentChangesScope): AgentChangesRevertOptions['changes'] =>
    makeAgentChangesController({
      scope,
      view: {
        kind: 'recording',
        startedAt: 1,
        runs: [],
        list: { kind: 'listed', scope, ...makeAgentChangesList([makeAgentChangeEntry('a.txt')]) }
      }
    })

  it('選んでいる範囲が実行なら、戻すボタンの理由に実行の範囲の文言を出す', () => {
    const { result } = renderHook(() => useAgentChangesRevert(makeOptions({ changes: runView(RUN) })))
    expect(result.current.revertDisabledReason).toBe(AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE)
    expect(result.current.revertAllDisabledReason).toBe(AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE)
  })

  it('表示中の一覧の範囲が実行なら、選んでいる範囲が累積でも押せない(切り替えの直後)', () => {
    const changes = { ...runView(RUN), scope: ALL_SCOPE }
    const { result } = renderHook(() => useAgentChangesRevert(makeOptions({ changes })))
    expect(result.current.revertDisabledReason).toBe(AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE)
  })

  it.each(['ファイル', 'すべて'] as const)(
    '表示中の一覧の範囲が実行なら、%s を戻す操作は確認も IPC も呼ばない',
    async (operation) => {
      const options = makeOptions({ changes: runView(RUN) })
      const { result } = renderHook(() => useAgentChangesRevert(options))
      await act(async () => {
        if (operation === 'ファイル') await result.current.revertFile(makeAgentChangeEntry('a.txt'))
        else await result.current.revertAll()
      })
      expect(options.onConfirm).not.toHaveBeenCalled()
      expect(agentChangesApi.revertAgentChange).not.toHaveBeenCalled()
      expect(agentChangesApi.revertAllAgentChanges).not.toHaveBeenCalled()
    }
  )

  it('ハンクの内容の範囲が実行なら、確認も IPC も呼ばない', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', RUN)
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(agentChangesApi.revertAgentChangeHunk).not.toHaveBeenCalled()
  })
})
```

`src/renderer/src/hooks/__tests__/useDiffOperations.test.ts` の末尾に足す（`agentChangesApi` は既に `vi.mock` されている）:
```ts
describe('エージェントの変更の diff の範囲', () => {
  const RUN: AgentChangesScope = { kind: 'run', runId: 2 }
  const tab: DiffTabKey = { path: 'a.txt', kind: 'agent' }
  const refreshGitStatus = vi.fn().mockResolvedValue(undefined)

  it('agent のタブは取得の時点の範囲で取り、内容と組で agentDiffScope を返す', async () => {
    vi.mocked(agentChangesApi.getAgentChangeDiff).mockResolvedValue('AGENT_DIFF')
    const { result } = renderHook(() => useDiffOperations(tab, refreshGitStatus, [], RUN))
    expect(result.current.agentDiffScope).toBeNull()
    await waitFor(() => expect(result.current.diffContent).toBe('AGENT_DIFF'))
    expect(agentChangesApi.getAgentChangeDiff).toHaveBeenCalledWith('a.txt', RUN)
    expect(result.current.agentDiffScope).toEqual(RUN)
  })

  it('範囲を変えただけでは取り直さず、refreshDiff で新しい範囲で取り直す', async () => {
    vi.mocked(agentChangesApi.getAgentChangeDiff).mockResolvedValue('AGENT_DIFF')
    const { result, rerender } = renderHook(
      ({ scope }: { scope: AgentChangesScope }) => useDiffOperations(tab, refreshGitStatus, [], scope),
      { initialProps: { scope: ALL_SCOPE } }
    )
    await waitFor(() => expect(result.current.agentDiffScope).toEqual(ALL_SCOPE))
    rerender({ scope: RUN })
    expect(agentChangesApi.getAgentChangeDiff).toHaveBeenCalledTimes(1)
    expect(result.current.agentDiffScope).toEqual(ALL_SCOPE)
    act(() => result.current.refreshDiff())
    await waitFor(() => expect(result.current.agentDiffScope).toEqual(RUN))
    expect(agentChangesApi.getAgentChangeDiff).toHaveBeenLastCalledWith('a.txt', RUN)
  })

  it('agent でないタブの agentDiffScope は null', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const unstaged: DiffTabKey = { path: 'a.txt', kind: 'unstaged' }
    const { result } = renderHook(() => useDiffOperations(unstaged, refreshGitStatus, [], RUN))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))
    expect(result.current.agentDiffScope).toBeNull()
    expect(agentChangesApi.getAgentChangeDiff).not.toHaveBeenCalled()
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts` の `describe('diff タブのハンクの操作(agentDiffActions)')` に足す:
```ts
    it.each<[string, AgentChangesScope | null]>([
      ['実行の範囲', { kind: 'run', runId: 2 }],
      ['まだ取っていない(null)', null]
    ])('diff の内容の範囲が %s なら、ハンクを戻せず、押しても戻さない', (_label, agentDiffScope) => {
      const base = makeOptions({
        recording: {
          changes: makeAgentChangesController({
            view: makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
          }),
          beginForSendAndRefresh: vi.fn(async () => undefined),
          beginManuallyAndRefresh: vi.fn(async () => undefined)
        },
        agentDiffScope
      })
      const { result } = setup({
        ...base,
        diffTabs: { ...base.diffTabs, activeDiffTab: { path: 'a.txt', kind: 'agent' } }
      })
      expect(result.current.agentDiffActions.canRevertHunk).toBe(false)
      result.current.agentDiffActions.onRevertHunk('patch', '@@ -1 +1 @@')
      expect(revertState.revertHunk).not.toHaveBeenCalled()
    })
```
（import に `import type { AgentChangesScope } from '@shared/types'`）。`'「いまから記録する」・「もう一度試す」は…'` などで `panel.changes.begin` を `beginManuallyAndRefresh` と比べているテストは、Step 2 の置き換えで名前が替わっている。

`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts` の `describe('エージェントの変更の配線')` に足す:
```ts
      it('セクションの「いまから記録する」は manual で記録を始める(実行に数えない)', async () => {
        const { result } = renderHook(() => useAppState())
        await act(async () => {
          await result.current.agentChangesPanel.changes.begin()
        })
        expect(window.api.beginAgentChanges).toHaveBeenCalledExactlyOnceWith('manual')
      })
```

- [ ] **Step 4: テストを走らせて失敗を確かめる**

Run: `npx vitest run src/renderer/src/__tests__ src/renderer/src/lib/__tests__/agentChanges* src/renderer/src/lib/__tests__/diffTabSource.test.ts src/renderer/src/hooks/__tests__/useAgentChanges* src/renderer/src/hooks/__tests__/useDiffOperations.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.agentChanges.test.tsx`
Expected: FAIL（範囲・`runs`・`selectScope`・`agentDiffScope`・`beginForSendAndRefresh` が無いなど）

- [ ] **Step 5: 実装する**

`src/renderer/src/lib/agentChangesApi.ts` を次にする:
```ts
import type {
  AgentChangesBeginTrigger,
  AgentChangesListResult,
  AgentChangesScope,
  AgentChangesState,
  AgentRevertAllEntry,
  DiscardAllResult
} from '@shared/types'

// エージェントの変更の IPC の窓口(window.api)。renderer の部品は window.api を直接触らずここを使う。
// 記録の開始の種類と範囲は省略できない(渡し忘れを既定の解釈に流さない。L-044・L-060)

export function beginAgentChanges(trigger: AgentChangesBeginTrigger): Promise<AgentChangesState> {
  return window.api.beginAgentChanges(trigger)
}

export function getAgentChangesState(): Promise<AgentChangesState> {
  return window.api.getAgentChangesState()
}

export function listAgentChanges(scope: AgentChangesScope): Promise<AgentChangesListResult> {
  return window.api.listAgentChanges(scope)
}

export function getAgentChangeDiff(path: string, scope: AgentChangesScope): Promise<string> {
  return window.api.getAgentChangeDiff(path, scope)
}

export function revertAgentChange(path: string, scope: AgentChangesScope): Promise<void> {
  return window.api.revertAgentChange(path, scope)
}

export function revertAgentChangeHunk(
  path: string,
  patch: string,
  scope: AgentChangesScope
): Promise<void> {
  return window.api.revertAgentChangeHunk(path, patch, scope)
}

export function revertAllAgentChanges(
  expected: AgentRevertAllEntry[],
  scope: AgentChangesScope
): Promise<DiscardAllResult> {
  return window.api.revertAllAgentChanges(expected, scope)
}

export function clearAgentChanges(): Promise<void> {
  return window.api.clearAgentChanges()
}
```

`src/renderer/src/lib/agentChangesScope.ts` を作る:
```ts
import type { AgentChangesRun, AgentChangesScope } from '@shared/types'
import type { AgentChangesView, AgentChangesViewList } from '../hooks/useAgentChanges'

// エージェントの変更の範囲(累積・実行 N)の写しの読み方。行を読む部品(戻す・diff タブの同期・セクション)が同じ規則で一覧を取り出す

/** 累積の範囲(既定) */
export const AGENT_CHANGES_ALL_SCOPE: AgentChangesScope = { kind: 'all' }

export type ListedAgentChanges = Extract<AgentChangesViewList, { kind: 'listed' }>

/** 写しの一覧のうち、行を持つもの(記録中で、範囲の一覧が取れている)。記録なし・取り直す前・範囲の一覧が取れないときは null */
export function getListedAgentChanges(view: AgentChangesView): ListedAgentChanges | null {
  return view.kind === 'recording' && view.list?.kind === 'listed' ? view.list : null
}

/** runId の実行(無ければ undefined) */
export function findAgentChangesRun(
  runs: readonly AgentChangesRun[],
  runId: number
): AgentChangesRun | undefined {
  return runs.find((run) => run.runId === runId)
}
```

`src/renderer/src/lib/agentChangesMessages.ts` の `AGENT_CHANGES_NOT_RECORDED_REASON` の次に足す:
```ts
/** 実行の範囲(読み取り専用)では戻すボタンを押せない理由 */
export const AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE =
  '実行ごとの表示では戻せません。「すべて（累積）」を選ぶと戻せます'

/** 選んでいた実行が消えた(10 件を超えて捨てた・記録を捨てた)ときの読み上げ */
export function formatAgentChangesRunMissingNotice(runNumber: number): string {
  return `実行 ${runNumber} の記録は古くなったため消えました。すべて（累積）を表示します`
}
```

`src/renderer/src/lib/agentChangesAvailability.ts`: import に `AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE` を足し、`AgentRevertAvailability` の `hasListError` の次に足す:
```ts
  /** 選んでいる範囲か、表示中の一覧の範囲が実行(実行ごとの表示は見るだけ) */
  isRunScope: boolean
```
`agentRevertDisabledReason` の `if (availability.isGitBusy) return AGENT_CHANGES_BUSY_GIT` の次に `if (availability.isRunScope) return AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE` を足す（今の理由の後の優先順位）。

`src/renderer/src/lib/agentChangesWiring.ts`: import に `import { getListedAgentChanges } from './agentChangesScope'` を足し、2 つの関数を次にする:
```ts
/**
 * エージェントの変更の一覧から消えたパスの agent の diff タブ(記録が無くなったらすべての agent のタブ)。
 * 記録中で一覧をまだ取っていない(list が null)・範囲の一覧が取れない(scope-unavailable)ときは、消えたかが分からないため
 * null(何もしない)を返す。一覧の行のフォルダ('<dir>/')とタブのパス('<dir>')は同じものとして扱う。unstaged・staged のタブは対象外
 */
export function findAgentDiffTabsToClose(
  tabs: readonly DiffTabKey[],
  view: AgentChangesView
): DiffTabKey[] | null {
  if (view.kind === 'recording' && view.list?.kind !== 'listed') return null
  const paths = (getListedAgentChanges(view)?.entries ?? []).map((entry) =>
    toAgentChangeRelativePath(entry.path)
  )
  return tabs.filter(
    (tab) => tab.kind === 'agent' && !paths.some((path) => isSamePath(path, tab.path))
  )
}
```
```ts
export function findActiveAgentEntry(
  view: AgentChangesView,
  activeDiffTab: DiffTabKey | null
): AgentChangeEntry | undefined {
  if (activeDiffTab?.kind !== 'agent') return undefined
  return getListedAgentChanges(view)?.entries.find((entry) =>
    isSamePath(entry.path, activeDiffTab.path)
  )
}
```

`src/renderer/src/hooks/useAgentChanges.ts` を次にする:
```ts
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  AgentChangesBeginTrigger,
  AgentChangesList,
  AgentChangesRun,
  AgentChangesScope,
  AgentChangesScopeUnavailableReason,
  AgentChangesState
} from '@shared/types'
import { isSameAgentChangesScope } from '@shared/types'
import type { Announcement } from '../types'
import * as agentChangesApi from '../lib/agentChangesApi'
import {
  AGENT_CHANGES_CLEARED_NOTICE,
  formatAgentChangesListedNotice,
  formatAgentChangesRunMissingNotice
} from '../lib/agentChangesMessages'
import { AGENT_CHANGES_ALL_SCOPE, findAgentChangesRun } from '../lib/agentChangesScope'
import { toError } from '../lib/errorUtils'
import { useOnChange } from './useOnChange'
import { useTransientNotice } from './useTransientNotice'

// エージェントの変更の記録の状態と一覧(設計書「データフロー」「状態の持ち主」「記録の写しと範囲」)。記録の真実の源は main の registry で、
// ここは写し(表示と押せる条件に使う。戻す操作は main が実行時に照合する)。一覧は要求の番号と範囲で古い結果を捨てる
// (useGitStatus と同じ作り。L-037・L-040)。一覧はそれを取った範囲と組で持つ。実行中にアプリで保存したパスの真実の源はここ
// (記録ごとに持ち、記録が変われば捨てる。実行を足しても捨てない)

/** 読み上げの通知を消すまでの時間 */
export const AGENT_CHANGES_NOTICE_DURATION_MS = 5_000

/** 写しの一覧。listed: 範囲の一覧(scope はそれを取った範囲)、scope-unavailable: 範囲の一覧を出せない(写しが古い)理由 */
export type AgentChangesViewList =
  | ({ kind: 'listed'; scope: AgentChangesScope } & AgentChangesList)
  | {
      kind: 'scope-unavailable'
      scope: AgentChangesScope
      reason: AgentChangesScopeUnavailableReason
    }

export type AgentChangesView =
  | { kind: 'none' }
  | { kind: 'unavailable'; state: Extract<AgentChangesState, { kind: 'unavailable' }> }
  /** runs は main の実行の一覧(古い順)。list は取り直す前・範囲を変えた直後は null */
  | {
      kind: 'recording'
      startedAt: number
      runs: AgentChangesRun[]
      list: AgentChangesViewList | null
    }

export interface AgentChangesController {
  view: AgentChangesView
  /** 一覧の取得中 */
  isLoading: boolean
  /** 記録の開始の依頼中(いまから記録する・実行の前) */
  isBeginning: boolean
  /** 直前の一覧の取得の失敗(前回の一覧は残す。戻す操作は押せない) */
  listError: string | null
  /** セクションの aria-live の通知 */
  notice: Announcement | null
  /** 記録を始めた後にアプリで保存したファイル(絶対パス) */
  savedPaths: ReadonlySet<string>
  /** 選んでいる範囲(既定は累積) */
  scope: AgentChangesScope
  /** 範囲を選ぶ。一覧を空にして、その範囲で取り直す */
  selectScope: (scope: AgentChangesScope) => void
  /** 記録を始める(send: 記録があれば区切りを足す、manual: 記録があれば何もしない)。失敗しても reject しない */
  begin: (trigger: AgentChangesBeginTrigger) => Promise<void>
  /** 記録があれば選んでいる範囲の一覧を取り直す。announce なら結果の件数を読み上げる */
  refresh: (options?: { announce?: boolean }) => Promise<void>
  /** 確認を終える(記録を捨てる) */
  clear: () => Promise<void>
  /** アプリで保存した(useFileSystem の onSaveSucceeded から呼ぶ)。記録中だけ覚える */
  markSaved: (absolutePath: string) => void
  /** 戻す操作の結果などをセクションの通知に出す */
  announce: (text: string) => void
}

export function useAgentChanges(folderPath: string | null): AgentChangesController {
  const [view, setView] = useState<AgentChangesView>({ kind: 'none' })
  const [scope, setScope] = useState<AgentChangesScope>(AGENT_CHANGES_ALL_SCOPE)
  const [isLoading, setIsLoading] = useState(false)
  const [isBeginning, setIsBeginning] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [savedPaths, setSavedPaths] = useState<ReadonlySet<string>>(new Set())
  const { notice, announce } = useTransientNotice(AGENT_CHANGES_NOTICE_DURATION_MS)
  const viewRef = useRef(view)
  const scopeRef = useRef<AgentChangesScope>(AGENT_CHANGES_ALL_SCOPE)
  const folderPathRef = useRef(folderPath)
  const requestIdRef = useRef(0)
  // 記録の写しの世代。フォルダの切り替え・確認の終了で進め、送った時と違う世代の begin・状態の結果は捨てる
  // (/a → /b → /a と戻ったときに、フォルダの文字列では古い結果を見分けられない。最終レビュー B の I-1)
  const generationRef = useRef(0)
  // 実行中の begin の数(2 回続けても、両方が終わるまで isBeginning を下ろさない)
  const beginCountRef = useRef(0)
  // 取り直しの依頼で読み上げを頼まれたか。後の依頼に追い越されても、最後に反映した結果を読み上げる。
  // フォルダの切り替え・確認の終了・取得の失敗・main に記録が無かったときは捨てる(頼んだ操作の結果ではないため)
  const announcePendingRef = useRef(false)
  // 範囲を戻した後の取り直しで、自分(refresh)を呼ぶための参照。描画の後に最新にする
  const refreshRef = useRef<AgentChangesController['refresh']>(async () => undefined)

  const changeScope = useCallback((next: AgentChangesScope): void => {
    scopeRef.current = next
    setScope(next)
  }, [])

  // 選んでいた実行が消えた(10 件を超えて捨てた・記録を捨てた)。範囲を累積に戻し、消える前の写しの番号で、
  // セクションの常設の aria-live に読み上げる(L-153)
  const dropMissingRun = useCallback(
    (runId: number, previousRuns: readonly AgentChangesRun[]): void => {
      changeScope(AGENT_CHANGES_ALL_SCOPE)
      const run = findAgentChangesRun(previousRuns, runId)
      if (run !== undefined) announce(formatAgentChangesRunMissingNotice(run.number))
    },
    [changeScope, announce]
  )

  const applyView = useCallback((next: AgentChangesView): void => {
    const previous = viewRef.current
    viewRef.current = next
    setView(next)
    // 記録が変わったら(無くなった・別の記録になった)、実行中に保存したパスを捨てる
    const sameRecording =
      previous.kind === 'recording' &&
      next.kind === 'recording' &&
      previous.startedAt === next.startedAt
    if (!sameRecording) setSavedPaths(new Set())
  }, [])

  const applyState = useCallback(
    (state: AgentChangesState): void => {
      if (state.kind === 'recording') {
        const previous = viewRef.current
        const sameRecording =
          previous.kind === 'recording' && previous.startedAt === state.startedAt ? previous : null
        const selected = scopeRef.current
        // 新しい記録では範囲を累積に戻す(runId は記録をまたいで重ならないため、前の記録の実行を指したまま空の一覧を見せない)
        if (sameRecording === null && selected.kind !== 'all') changeScope(AGENT_CHANGES_ALL_SCOPE)
        const missing =
          sameRecording !== null &&
          selected.kind === 'run' &&
          findAgentChangesRun(state.runs, selected.runId) === undefined
        if (missing) dropMissingRun(selected.runId, sameRecording.runs)
        applyView({
          kind: 'recording',
          startedAt: state.startedAt,
          runs: state.runs,
          list: sameRecording !== null && !missing ? sameRecording.list : null
        })
        if (missing) void refreshRef.current()
      } else if (state.kind === 'unavailable') {
        applyView({ kind: 'unavailable', state })
      } else {
        applyView({ kind: 'none' })
      }
    },
    [applyView, changeScope, dropMissingRun]
  )

  // 写しを捨てる前に、送ってある依頼(begin・状態・一覧)の結果と読み上げの依頼をすべて捨てる。フォルダの切り替えと
  // 確認の終了の 2 か所で同じ規則にする(世代・要求の番号を片方だけ進めると、古い結果が混ざる)。isBeginning は
  // begin の数で下ろすため、ここでは触らない(送った begin は結果を捨てても終わるまで数える)
  const invalidateInFlight = useCallback((): void => {
    generationRef.current++
    requestIdRef.current++
    announcePendingRef.current = false
    setIsLoading(false)
  }, [])

  // フォルダが変わったら記録の写しを捨て、範囲を累積に戻す(main もフォルダの切り替えで記録を捨てる)
  useOnChange(folderPath, () => {
    folderPathRef.current = folderPath
    invalidateInFlight()
    setListError(null)
    changeScope(AGENT_CHANGES_ALL_SCOPE)
    applyView({ kind: 'none' })
  })

  // 部品の作り直しの後に main の記録に合わせる(リロードでは main が記録を捨てるため、通常は none)
  useEffect(() => {
    if (folderPath === null) return
    let cancelled = false
    const generation = generationRef.current
    void agentChangesApi
      .getAgentChangesState()
      .then((state) => {
        if (!cancelled && generationRef.current === generation && state.kind === 'recording') {
          applyState(state)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [folderPath, applyState])

  const begin = useCallback(
    async (trigger: AgentChangesBeginTrigger): Promise<void> => {
      if (folderPathRef.current === null) return
      const generation = generationRef.current
      beginCountRef.current++
      setIsBeginning(true)
      try {
        const state = await agentChangesApi.beginAgentChanges(trigger)
        // 送った後にフォルダが変わった(戻ってきた場合も含む)・確認を終えたら、前の世代の結果は捨てる
        if (generationRef.current !== generation) return
        applyState(state)
      } catch {
        if (generationRef.current !== generation) return
        // 記録がある間の send の失敗は写しを変えない(記録はある。区切りを取れなかったことは main の runs で分かる)
        if (trigger === 'send' && viewRef.current.kind === 'recording') return
        applyView({ kind: 'unavailable', state: { kind: 'unavailable', reason: 'git-failed' } })
      } finally {
        beginCountRef.current--
        if (beginCountRef.current === 0) setIsBeginning(false)
      }
    },
    [applyState, applyView]
  )

  const refresh = useCallback(
    async (options: { announce?: boolean } = {}): Promise<void> => {
      if (viewRef.current.kind !== 'recording') return
      if (options.announce === true) announcePendingRef.current = true
      const requestId = ++requestIdRef.current
      const requested = scopeRef.current
      setIsLoading(true)
      try {
        const result = await agentChangesApi.listAgentChanges(requested)
        // 後の依頼に追い越された・範囲が変わった結果は捨てる(L-037・L-040)
        if (
          requestId !== requestIdRef.current ||
          !isSameAgentChangesScope(requested, scopeRef.current)
        ) {
          return
        }
        setListError(null)
        if (result.kind === 'none') {
          // main が記録を捨てていた(フォルダの切り替えの直後など)
          announcePendingRef.current = false
          applyView({ kind: 'none' })
          return
        }
        const previous = viewRef.current
        const previousRuns = previous.kind === 'recording' ? previous.runs : []
        if (result.kind === 'scope-unavailable') {
          announcePendingRef.current = false
          if (result.reason === 'run-missing' && result.scope.kind === 'run') {
            // 選んでいた実行が main で消えていた。範囲を累積に戻して取り直す
            applyView({
              kind: 'recording',
              startedAt: result.startedAt,
              runs: result.runs,
              list: null
            })
            dropMissingRun(result.scope.runId, previousRuns)
            void refreshRef.current()
            return
          }
          applyView({
            kind: 'recording',
            startedAt: result.startedAt,
            runs: result.runs,
            list: { kind: 'scope-unavailable', scope: result.scope, reason: result.reason }
          })
          return
        }
        const { startedAt, runs, entries, totalCount, truncated, headChanged } = result
        applyView({
          kind: 'recording',
          startedAt,
          runs,
          list: { kind: 'listed', scope: result.scope, entries, totalCount, truncated, headChanged }
        })
        if (announcePendingRef.current) {
          announcePendingRef.current = false
          announce(formatAgentChangesListedNotice(totalCount))
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return
        announcePendingRef.current = false
        setListError(toError(err).message)
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false)
      }
    },
    [applyView, announce, dropMissingRun]
  )

  useLayoutEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  const selectScope = useCallback(
    (next: AgentChangesScope): void => {
      if (isSameAgentChangesScope(next, scopeRef.current)) return
      changeScope(next)
      // 前の範囲の一覧を新しい範囲の見出しの下に残さない
      const current = viewRef.current
      if (current.kind === 'recording') applyView({ ...current, list: null })
      void refreshRef.current()
    },
    [applyView, changeScope]
  )

  const clear = useCallback(async (): Promise<void> => {
    // main の応答を待つ前に捨てる(応答待ちに届いた前の依頼の結果で写しを戻さない。応答待ちに新しく送った依頼は捨てない)
    invalidateInFlight()
    changeScope(AGENT_CHANGES_ALL_SCOPE)
    try {
      await agentChangesApi.clearAgentChanges()
    } catch {
      // main で消せなくても写しは捨てる(次の取り直しで main の状態に合わせる)
    }
    setListError(null)
    applyView({ kind: 'none' })
    announce(AGENT_CHANGES_CLEARED_NOTICE)
  }, [invalidateInFlight, changeScope, applyView, announce])

  const markSaved = useCallback((absolutePath: string): void => {
    if (viewRef.current.kind !== 'recording') return
    setSavedPaths((previous) =>
      previous.has(absolutePath) ? previous : new Set([...previous, absolutePath])
    )
  }, [])

  return {
    view,
    isLoading,
    isBeginning,
    listError,
    notice,
    savedPaths,
    scope,
    selectScope,
    begin,
    refresh,
    clear,
    markSaved,
    announce
  }
}
```

`src/renderer/src/hooks/useAgentChangesRecording.ts` を次にする:
```ts
import { useCallback } from 'react'
import { useAgentChanges } from './useAgentChanges'
import type { AgentChangesController } from './useAgentChanges'

// エージェントの変更の組み立ての前段(useAppState の中で useAgentWorkspace より前に呼ぶ)。記録の写し(useAgentChanges)と、
// 送信の前の準備・セクションのボタンに渡す「記録を始めてから一覧を取る」を持つ。一覧を取り直す契機・diff タブ・表示用の値は後段の
// useAgentChangesWiring が持つ

export interface AgentChangesRecording {
  /** エージェントの変更の記録・一覧(main の registry の写し) */
  changes: AgentChangesController
  /**
   * 送信の前の準備(プロンプトの「実行」・履歴の「再実行」)。send で記録を始め(記録があれば区切りを足す)、一覧を取る。
   * reject しない。参照は描画をまたいで変わらない(useAgentPromptSender.send の依存)
   */
  beginForSendAndRefresh: () => Promise<void>
  /** セクションの「いまから記録する」「もう一度試す」。manual で記録を始め(実行に数えない)、一覧を取る。reject しない */
  beginManuallyAndRefresh: () => Promise<void>
}

export function useAgentChangesRecording(folderPath: string | null): AgentChangesRecording {
  const changes = useAgentChanges(folderPath)
  // begin・refresh はどちらも useCallback(参照が安定)。送信は 10 秒で待つのを打ち切るが、その後に記録が
  // 終わっても記録として扱い一覧を取る(送信の後、記録が終わるまでにエージェントが書いた変更は記録の時点に含まれうる。既知の制約)。
  // 取り直しは一覧が空でも「変わったファイルはありません」を出すため
  const { begin, refresh } = changes
  const beginForSendAndRefresh = useCallback(async (): Promise<void> => {
    await begin('send')
    void refresh()
  }, [begin, refresh])
  const beginManuallyAndRefresh = useCallback(async (): Promise<void> => {
    await begin('manual')
    void refresh()
  }, [begin, refresh])
  return { changes, beginForSendAndRefresh, beginManuallyAndRefresh }
}
```

`src/renderer/src/hooks/useAgentChangesRevert.ts`:
1. import に `import type { AgentChangeEntry, AgentChangesScope } from '@shared/types'`（既存の `AgentChangeEntry` の import を置き換え）と `import { getListedAgentChanges } from '../lib/agentChangesScope'` を足す。
2. `AgentChangesRevertOptions.changes` の Pick に `'scope'` を足す。`AgentChangesRevertState.revertHunk` を `(path: string, patch: string, hunkHeader: string, scope: AgentChangesScope) => Promise<void>` にし、説明に「scope は diff の内容を取った範囲。累積でなければ何もしない」を足す。
3. `const list = changes.view.kind === 'recording' ? changes.view.list : null` を `const list = getListedAgentChanges(changes.view)` にし、`availability` に足す:
```ts
    // 選んでいる範囲か、表示中の一覧の範囲が実行なら戻せない(実行ごとの表示は見るだけ。L-061)
    isRunScope: changes.scope.kind !== 'all' || (list !== null && list.scope.kind !== 'all')
```
4. `revertFile` の先頭の守りと IPC を次にする:
```ts
    const absolutePath = absoluteOf(entry.path)
    // 処理の側の守り: 表示中の一覧が累積でなければ、確認を出さずに何もしない(L-058)
    if (absolutePath === null || list === null || list.scope.kind !== 'all') return
    if (!canStart() || entry.notRecorded) return
```
```ts
    const succeeded = await run(entry.path, 'file', () =>
      agentChangesApi.revertAgentChange(entry.path, list.scope)
    )
```
5. `revertHunk` を `async (path: string, patch: string, hunkHeader: string, scope: AgentChangesScope)` にし、先頭の守りを `if (absolutePath === null || scope.kind !== 'all' || !canStart()) return` に、IPC を `agentChangesApi.revertAgentChangeHunk(path, patch, scope)` にする（diff の内容の範囲が累積でなければ、実行の開始の時点との差分のパッチになるため戻さない）。
6. `revertAll` の先頭を `if (list === null || list.scope.kind !== 'all' || list.entries.length === 0) return` にし、IPC を `agentChangesApi.revertAllAgentChanges(expected, list.scope)` にする。

`src/renderer/src/lib/diffTabSource.ts`: import に `import type { AgentChangesScope } from '@shared/types'` を足し、`DiffTabFetchContext` に足す:
```ts
  /** エージェントの変更の diff の範囲(agent のタブだけが使う。どの記録と比べるかは main が決める) */
  agentScope: AgentChangesScope
```
`fetchDiffForTab` の agent の行を `if (tab.kind === 'agent') return agentChangesApi.getAgentChangeDiff(tab.path, context.agentScope)` にする。

`src/renderer/src/hooks/useDiffOperations.ts`:
1. import に `import type { AgentChangesScope, GitFileStatus } from '@shared/types'`（既存の `GitFileStatus` の import を置き換え）。
2. `DiffOperationsState` の `isActiveFileUntracked` の次に足す:
```ts
  /** 表示中の diff の内容を取った範囲(エージェントの変更の diff だけ。内容が無い間・agent でないタブは null)。
   *  セクションで今選んでいる範囲ではなく、内容と組で持つ(範囲を切り替えた直後の古い内容から、累積でないハンクを戻さない) */
  agentDiffScope: AgentChangesScope | null
```
3. 関数の引数を `(activeDiffTab, refreshGitStatus, gitStatusFiles, agentScope: AgentChangesScope, fileLock?: FileOperationLock)` にし、説明のコメントに「agentScope はエージェントの変更の diff の範囲。取得の effect の依存には入れない（範囲を変えた後は一覧の取り直しの後の refreshDiff で取り直す）」を足す。
4. `const activeDiffTabRef = useLatestRef(activeDiffTab)` の次に足す:
```ts
  // 取得の時点の範囲を読む(effect の依存に入れず、範囲を変えただけでは取り直さない)
  const agentScopeRef = useLatestRef(agentScope)
  const [agentDiffScope, setAgentDiffScope] = useState<AgentChangesScope | null>(null)
```
5. 取得の effect の中の `setDiffContent(null)` の次に `setAgentDiffScope(null)` を足し、`fetchDiffForTab` の呼び出しを次にする:
```ts
        const scopeAtFetch = agentScopeRef.current
        const content = await fetchDiffForTab(activeDiffTab, {
          isUntracked,
          renamedFrom: activeFileStatus?.from,
          agentScope: scopeAtFetch
        })
        if (cancelled) return
        setDiffContent(content)
        setAgentDiffScope(activeDiffTab.kind === 'agent' ? scopeAtFetch : null)
        setFetchError(null)
```
6. `runHunkOperation` の catch の `setDiffContent(null)` の次に `setAgentDiffScope(null)` を足す。
7. 戻り値に `agentDiffScope` を足す。

`src/renderer/src/hooks/useAgentChangesWiring.ts`:
1. import に `import type { AgentChangesScope, GitStatusResult } from '@shared/types'`（既存の `GitStatusResult` の import を置き換え）。
2. `AgentChangesWiringOptions` の `refreshDiff` の次に足す:
```ts
  /** 表示中の agent の diff の内容を取った範囲(useDiffOperations.agentDiffScope)。累積のときだけハンクを戻せる */
  agentDiffScope: AgentChangesScope | null
```
3. 引数の分割に `agentDiffScope` を足し、`const { changes, beginAndRefresh } = recording` を `const { changes, beginManuallyAndRefresh } = recording` にする。
4. `agentDiffActions` の `canRevertHunk` と `onRevertHunk` を次にする:
```ts
    // 内容の範囲が累積のときだけ(実行の範囲の diff から作ったパッチは、逆適用すると戻す先が実行の開始の時点になる)
    canRevertHunk:
      agentDiffScope?.kind === 'all' &&
      canRevertAgentHunk(findActiveAgentEntry(view, diffTabs.activeDiffTab)),
```
```ts
    // canRevertHunk と同じ条件(内容の範囲が累積のときだけ)で処理の側でも止める(L-058)
    onRevertHunk: (patch, hunkHeader) => {
      if (activeAgentPath !== null && agentDiffScope?.kind === 'all') {
        void revert.revertHunk(activeAgentPath, patch, hunkHeader, agentDiffScope)
      }
    }
```
5. `agentChangesPanel.changes` の `begin: beginAndRefresh,` を `begin: beginManuallyAndRefresh,` にする。
6. `AgentChangesPanelState.changes` の型を、controller の `begin`（`trigger` が必須）をそのまま流し込まない形にする（セクションの `void changes.begin()` は引数なしのまま。`'manual'` は `beginManuallyAndRefresh` の中で渡す）:
```ts
  changes: Omit<
    Pick<
      AgentChangesController,
      | 'view'
      | 'isLoading'
      | 'isBeginning'
      | 'listError'
      | 'notice'
      | 'savedPaths'
      | 'begin'
      | 'refresh'
      | 'clear'
    >,
    'begin'
  > & {
    /** 「いまから記録する」「もう一度試す」。manual で記録を始めてから一覧を取る(useAgentChangesRecording.beginManuallyAndRefresh) */
    begin: () => Promise<void>
  }
```
   （Task 6 はこの `Pick` の列挙に `'scope'`・`'selectScope'` を足す）

`src/renderer/src/components/source-control/AgentChangesSection.tsx`: import に `import { getListedAgentChanges } from '../../lib/agentChangesScope'` を足し、`const list = recording?.list ?? null` を `const list = getListedAgentChanges(view)` にする（表示の変更は Task 6）。

`src/renderer/src/hooks/useAppState.ts`:
1. `useDiffOperations(` の引数の `git.gitStatus?.files ?? [],` の次に `agentChangesRecording.changes.scope,` を足す（`fileOperationLock` は 5 番目）。
2. `useAgentWorkspace` の `beforeAgentSend: agentChangesRecording.beginAndRefresh` を `beforeAgentSend: agentChangesRecording.beginForSendAndRefresh` にし、直前のコメントを「プロンプトの「実行」で送る前に、エージェントの変更の記録を始める（記録があれば実行の区切りを足す）」にする。
3. `useAgentChangesWiring({ … })` の `refreshDiff: diffOperations.refreshDiff,` の次に `agentDiffScope: diffOperations.agentDiffScope,` を足す。

`src/renderer/src/hooks/useAgentWorkspace.ts` の L69 のコメントの `beginAndRefresh` を `beginForSendAndRefresh` にし、「エージェントの変更の記録を始め（記録があれば実行の区切りを足し）、一覧を取り直す」にする。

- [ ] **Step 6: テストを走らせて通ることを確かめる**

Run: `npx vitest run src/renderer/src/__tests__ src/renderer/src/lib/__tests__/agentChanges* src/renderer/src/lib/__tests__/diffTabSource.test.ts src/renderer/src/hooks/__tests__/useAgentChanges* src/renderer/src/hooks/__tests__/useDiffOperations.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.agentChanges.test.tsx src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`
Expected: PASS

- [ ] **Step 7: 処理の側の守りを外すとテストが落ちることを確かめる（変異）**

`useAgentChangesRevert.ts` の `revertFile` の `|| list.scope.kind !== 'all'` と `availability` の `isRunScope` の式を一時的に `false` にして走らせる:
Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesRevert.test.ts`
Expected: FAIL（`実行の範囲では戻さない` の describe が落ちる）。元に戻して PASS を確かめる。

- [ ] **Step 8: 検証**

Run: `npx vitest run src/renderer src/main src/shared src/preload`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし（`typecheck:web` もここから通る）
Run: 変更・作成した TypeScript のファイル（Files の一覧）へ `npx eslint --fix` → `npx eslint --max-warnings 0`
Expected: エラー・警告なし

---

### Task 6: セクションの範囲の選択・実行の範囲の表示・戻すの無効・diff タブの範囲のラベル

**Files:**
- Modify: `src/renderer/src/lib/agentChangesMessages.ts`（範囲の項目・見出し・空の文言・HEAD の帯・範囲の一覧が取れない理由）
- Create: `src/renderer/src/components/source-control/AgentChangesScopeSelect.tsx`
- Modify: `src/renderer/src/components/source-control/AgentChangesSection.tsx`（範囲の選択・実行の範囲の表示）
- Modify: `src/renderer/src/assets/main.css`（`.agent-changes__live` の前に範囲の選択のスタイル）
- Modify: `src/renderer/src/hooks/useAgentChangesWiring.ts`（`AgentChangesPanelState.changes` の Pick に `scope`・`selectScope`、`agentDiffActions.contentRunNumber`）
- Modify: `src/renderer/src/types.ts`（`AgentDiffActions.contentRunNumber` L159-170）
- Modify: `src/renderer/src/hooks/useCombinedEditorTabs.ts`（`agentDiffRunNumber`・`diffTabLabel(tab, runNumber)`）、`src/renderer/src/components/EditorPanel.tsx`（L151-162）
- Test: `src/renderer/src/lib/__tests__/agentChangesMessages.test.ts`、`src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx`、`src/renderer/src/components/source-control/__tests__/AgentChangesScopeSelect.styles.test.tsx`（新規）、`src/renderer/src/hooks/__tests__/useCombinedEditorTabs.test.ts`、`src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts`、`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`、`src/renderer/src/components/__tests__/EditorPanel.test.tsx`
- Test（`contentRunNumber: null` を足すだけ）: `src/renderer/src/components/source-control/__tests__/DiffView.test.tsx`、`src/renderer/src/components/source-control/__tests__/AgentHunkRevertAction.test.tsx`

**Interfaces:**
- Consumes: `AgentChangesController.scope`・`selectScope`・`view.runs`・`AgentChangesViewList`（Task 5）、`getListedAgentChanges`・`findAgentChangesRun`（Task 5）、`AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE`（Task 5）、`AgentChangesWiringOptions.agentDiffScope`（Task 5）
- Produces:
```ts
// src/renderer/src/lib/agentChangesMessages.ts
export const AGENT_CHANGES_SCOPE_LABEL = '表示'
export const AGENT_CHANGES_RUN_EMPTY = 'この実行では、変わったファイルはありません'
export const AGENT_CHANGES_RUN_HEAD_CHANGED = 'この実行の間に HEAD が変わりました（コミット・ブランチの切り替えなど）'
export const AGENT_CHANGES_START_NOT_RECORDED = '開始の状態を記録できませんでした'
export const AGENT_CHANGES_END_NOT_RECORDED = '次の実行の開始を記録できなかったため比べられません'
export const AGENT_CHANGES_RUN_UNAVAILABLE_SHORT: Record<AgentChangesUnavailableReason, string>
export function formatAgentChangesAllScopeOption(startedAt: number): string
export function formatAgentChangesRunOption(run: AgentChangesRun): string
export function buildAgentChangesRunHeading(run: AgentChangesRun, totalCount: number | null): string
export function describeAgentChangesScopeUnavailable(reason: 'start-not-recorded' | 'end-not-recorded', run: AgentChangesRun | undefined): string
// src/renderer/src/components/source-control/AgentChangesScopeSelect.tsx(default export)
interface AgentChangesScopeSelectProps {
  startedAt: number
  runs: readonly AgentChangesRun[]
  scope: AgentChangesScope
  disabled: boolean
  disabledReasonId: string | null
  onSelect: (scope: AgentChangesScope) => void
}
// src/renderer/src/types.ts
export interface AgentDiffActions { /* 既存 */ contentRunNumber: number | null }
// src/renderer/src/hooks/useCombinedEditorTabs.ts
export function diffTabLabel(tab: DiffTabKey, runNumber: number | null): string
// Params に agentDiffRunNumber: number | null(必須)
```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentChangesMessages.test.ts` に足す（import に新しい関数・定数と `makeAgentChangesRun`〈`../../__tests__/makeAgentChangesState`〉を足す）:
```ts
describe('範囲の項目・見出し・理由の文言', () => {
  const at = (hours: number, minutes: number): number => new Date(2026, 9, 12, hours, minutes).getTime()

  it('累積の項目は開始の時刻を添える', () => {
    expect(formatAgentChangesAllScopeOption(at(10, 42))).toBe('すべて（累積・10:42 から）')
  })

  it.each<[string, ReturnType<typeof makeAgentChangesRun>, string]>([
    ['選べる最後の実行', makeAgentChangesRun({ number: 3, startedAt: at(11, 5) }), '実行 3（11:05 から）'],
    [
      '選べる途中の実行',
      makeAgentChangesRun({ number: 1, startedAt: at(10, 42), endedAt: at(10, 50) }),
      '実行 1（10:42〜10:50）'
    ],
    [
      '開始を記録できなかった実行',
      makeAgentChangesRun({
        number: 3,
        startedAt: at(11, 5),
        availability: { kind: 'start-not-recorded', reason: 'too-many-untracked' }
      }),
      '実行 3（11:05・開始の状態を記録できませんでした: 未追跡のファイルが多すぎます）'
    ],
    [
      '終わりを記録できなかった実行',
      makeAgentChangesRun({
        number: 2,
        startedAt: at(10, 50),
        endedAt: at(11, 5),
        availability: { kind: 'end-not-recorded' }
      }),
      '実行 2（10:50〜・次の実行の開始を記録できなかったため比べられません）'
    ]
  ])('%s の項目', (_label, run, expected) => {
    expect(formatAgentChangesRunOption(run)).toBe(expected)
  })

  it('開始を記録できなかった理由の短い形は、記録できない理由をすべて網羅する', () => {
    expect(AGENT_CHANGES_RUN_UNAVAILABLE_SHORT).toEqual({
      'not-repository': 'Git 管理外のフォルダです',
      'not-toplevel': 'リポジトリの最上位のフォルダではありません',
      'too-many-untracked': '未追跡のファイルが多すぎます',
      timeout: '時間がかかりすぎました',
      'git-failed': 'git を実行できませんでした'
    })
  })

  it('実行の範囲の見出しは、件数(1 件以上のとき)と実行の番号・期間を添える', () => {
    expect(
      buildAgentChangesRunHeading(makeAgentChangesRun({ number: 3, startedAt: at(11, 5) }), 2)
    ).toBe('エージェントの変更 (2)（実行 3・11:05 から）')
    expect(
      buildAgentChangesRunHeading(
        makeAgentChangesRun({ number: 1, startedAt: at(10, 42), endedAt: at(10, 50) }),
        0
      )
    ).toBe('エージェントの変更（実行 1・10:42〜10:50）')
    expect(
      buildAgentChangesRunHeading(makeAgentChangesRun({ number: 1, startedAt: at(10, 42) }), null)
    ).toBe('エージェントの変更（実行 1・10:42 から）')
  })

  it('実行の範囲の空の文言・HEAD の帯・選択のラベル', () => {
    expect(AGENT_CHANGES_RUN_EMPTY).toBe('この実行では、変わったファイルはありません')
    expect(AGENT_CHANGES_RUN_HEAD_CHANGED).toBe(
      'この実行の間に HEAD が変わりました（コミット・ブランチの切り替えなど）'
    )
    expect(AGENT_CHANGES_SCOPE_LABEL).toBe('表示')
  })

  it('範囲の一覧が取れない理由は、選択の項目と同じ理由', () => {
    const failedRun = makeAgentChangesRun({
      availability: { kind: 'start-not-recorded', reason: 'timeout' }
    })
    expect(describeAgentChangesScopeUnavailable('start-not-recorded', failedRun)).toBe(
      '開始の状態を記録できませんでした: 時間がかかりすぎました'
    )
    expect(describeAgentChangesScopeUnavailable('start-not-recorded', undefined)).toBe(
      '開始の状態を記録できませんでした'
    )
    expect(describeAgentChangesScopeUnavailable('end-not-recorded', undefined)).toBe(
      '次の実行の開始を記録できなかったため比べられません'
    )
  })
})
```

`src/renderer/src/components/source-control/__tests__/AgentChangesSection.test.tsx` の末尾に足す（import に `AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE`・`AGENT_CHANGES_RUN_EMPTY`・`AGENT_CHANGES_RUN_HEAD_CHANGED`、`makeAgentChangesRun`、`import type { AgentChangesRun, AgentChangesScope } from '@shared/types'`）:
```ts
describe('AgentChangesSection の範囲の選択と実行の範囲の表示', () => {
  const at = (hours: number, minutes: number): number => new Date(2026, 9, 7, hours, minutes).getTime()
  // 実行 1(選べる途中の実行)・実行 2(終わりを記録できなかった)・実行 3(開始を記録できなかった。最後)
  const runs: AgentChangesRun[] = [
    makeAgentChangesRun({ runId: 1, number: 1, startedAt: startedAt, endedAt: at(10, 50) }),
    makeAgentChangesRun({
      runId: 2,
      number: 2,
      startedAt: at(10, 50),
      endedAt: at(11, 5),
      availability: { kind: 'end-not-recorded' }
    }),
    makeAgentChangesRun({
      runId: 3,
      number: 3,
      startedAt: at(11, 5),
      availability: { kind: 'start-not-recorded', reason: 'too-many-untracked' }
    })
  ]
  const RUN_1: AgentChangesScope = { kind: 'run', runId: 1 }
  const runView = (
    entries: AgentChangeEntry[] | null,
    extra: { headChanged?: boolean; scope?: AgentChangesScope } = {}
  ): AgentChangesView =>
    makeAgentChangesRecordingView(entries, { startedAt, runs, scope: RUN_1, ...extra })

  it('実行が無い間は範囲の選択を出さない', () => {
    renderSection(recordingView([makeAgentChangeEntry('a.txt')]))
    expect(within(section()).queryByRole('combobox', { name: '表示' })).toBeNull()
  })

  it('実行があれば、ラベル「表示」の選択を出し、項目は すべて → 新しい順の実行。選べない実行は disabled で理由を含む(L-057)', () => {
    renderSection(makeAgentChangesRecordingView([], { startedAt, runs }))
    const select = within(section()).getByRole('combobox', { name: '表示' })
    const options = within(select).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'すべて（累積・10:42 から）',
      '実行 3（11:05・開始の状態を記録できませんでした: 未追跡のファイルが多すぎます）',
      '実行 2（10:50〜・次の実行の開始を記録できなかったため比べられません）',
      '実行 1（10:42〜10:50）'
    ])
    expect(options.map((option) => (option as HTMLOptionElement).disabled)).toEqual([
      false,
      true,
      true,
      false
    ])
    expect((select as HTMLSelectElement).value).toBe('all')
  })

  it('項目を選ぶと selectScope にその範囲を渡す', async () => {
    const props = renderSection(makeAgentChangesRecordingView([], { startedAt, runs }))
    await userEvent.selectOptions(
      within(section()).getByRole('combobox', { name: '表示' }),
      '実行 1（10:42〜10:50）'
    )
    expect(props.changes.selectScope).toHaveBeenCalledExactlyOnceWith(RUN_1)
  })

  it('戻す操作の実行中は選択を押せず、理由を aria-describedby で結び、選んでも selectScope を呼ばない(L-039・L-058)', () => {
    const props = renderSection(
      makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], { startedAt, runs }),
      {
        revert: makeAgentChangesRevertState({
          isReverting: true,
          revertDisabledReason: '戻す操作の実行中です',
          revertAllDisabledReason: '戻す操作の実行中です'
        })
      }
    )
    const select = within(section()).getByRole('combobox', { name: '表示' })
    expect(select).toBeDisabled()
    expect(select).toHaveAccessibleDescription('戻す操作の実行中です')
    fireEvent.change(select, { target: { value: 'run:1' } })
    expect(props.changes.selectScope).not.toHaveBeenCalled()
  })

  it('実行の範囲では、見出しに実行の番号と期間、空の文言・HEAD の帯は実行の文言', () => {
    renderSection(runView([], { headChanged: true }), {}, { scope: RUN_1 })
    expect(within(section()).getByRole('button', { name: /実行 1・10:42〜10:50/ })).toBeInTheDocument()
    expect(within(section()).getByText(AGENT_CHANGES_RUN_EMPTY)).toBeInTheDocument()
    expect(within(section()).getByText(AGENT_CHANGES_RUN_HEAD_CHANGED)).toBeInTheDocument()
    expect(within(section()).queryByText(AGENT_CHANGES_EMPTY)).toBeNull()
    expect(within(section()).queryByText(AGENT_CHANGES_HEAD_CHANGED)).toBeNull()
  })

  it('実行の範囲では、行の ↶ とすべて戻すを押せず、理由を一覧の上に出して結ぶ。確認を終える・更新は押せる', () => {
    renderSection(
      runView([makeAgentChangeEntry('a.txt'), makeAgentChangeEntry('b.txt')]),
      {
        revert: makeAgentChangesRevertState({
          revertDisabledReason: AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE,
          revertAllDisabledReason: AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE
        })
      },
      { scope: RUN_1 }
    )
    const revert = within(section()).getByRole('button', { name: 'a.txt を実行前の状態に戻す' })
    expect(revert).toBeDisabled()
    expect(revert).toHaveAccessibleDescription(AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE)
    const revertAll = within(section()).getByRole('button', { name: 'すべて戻す' })
    expect(revertAll).toBeDisabled()
    expect(revertAll).toHaveAccessibleDescription(AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE)
    expect(within(section()).getByRole('button', { name: '確認を終える' })).toBeEnabled()
    expect(within(section()).getByRole('button', { name: '更新' })).toBeEnabled()
  })

  it('「あなたの保存を含む」は累積の一覧でだけ出す(保存は記録ごとに持つため)', () => {
    const savedPaths = new Set(['/repo/a.txt'])
    renderSection(runView([makeAgentChangeEntry('a.txt')]), {}, { scope: RUN_1, savedPaths })
    expect(within(section()).queryByText('あなたの保存を含む')).toBeNull()
  })

  it.each<[string, 'start-not-recorded' | 'end-not-recorded', AgentChangesScope, string]>([
    [
      '開始を記録できなかった',
      'start-not-recorded',
      { kind: 'run', runId: 3 },
      '開始の状態を記録できませんでした: 未追跡のファイルが多すぎます'
    ],
    [
      '終わりを記録できなかった',
      'end-not-recorded',
      { kind: 'run', runId: 2 },
      '次の実行の開始を記録できなかったため比べられません'
    ]
  ])('範囲の一覧が取れない(%s)ときは、一覧の代わりに理由を出す', (_label, reason, scope, text) => {
    renderSection(
      { kind: 'recording', startedAt, runs, list: { kind: 'scope-unavailable', scope, reason } },
      {},
      { scope }
    )
    expect(within(section()).getByText(text)).toBeInTheDocument()
    expect(within(section()).queryByRole('list')).toBeNull()
  })
})
```
（`fireEvent` を `@testing-library/react` の import に足す。`toHaveAccessibleDescription` は既存のテストと同じ jest-dom の matcher。範囲の選択の `<option>` の値は `all`・`run:<runId>`）

`src/renderer/src/components/source-control/__tests__/AgentChangesScopeSelect.styles.test.tsx` を作る:
```tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import AgentChangesScopeSelect from '../AgentChangesScopeSelect'
import { makeAgentChangesRun } from '../../../__tests__/makeAgentChangesState'

// 実際の main.css を読み込み、jsdom のカスケード結果で宣言値を検証する(AgentChangesFileItem.styles.test.tsx と同じ流儀)。
// 狭い幅で文字が切れずに読めるか・押せる高さは、実機の手動テストで確かめる
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

describe('AgentChangesScopeSelect のスタイル(main.css)', () => {
  it('選択は残りの幅に縮み(min-width: 0)、32px 以上の押せる高さを持つ', () => {
    render(
      <AgentChangesScopeSelect
        startedAt={0}
        runs={[makeAgentChangesRun()]}
        scope={{ kind: 'all' }}
        disabled={false}
        disabledReasonId={null}
        onSelect={vi.fn()}
      />
    )
    const select = getComputedStyle(screen.getByRole('combobox', { name: '表示' }))
    expect(select.minWidth).toBe('0px')
    expect(select.minHeight).toBe('32px')
    expect(select.flexGrow).toBe('1')
  })
})
```

`src/renderer/src/hooks/__tests__/useCombinedEditorTabs.test.ts`: `makeParams` の既定に `agentDiffRunNumber: null,` を足し、`diffTabLabel(x)` の呼び出しをすべて `diffTabLabel(x, null)` にする（`grep -n "diffTabLabel(" src/renderer/src/hooks/__tests__/useCombinedEditorTabs.test.ts`）。末尾に足す:
```ts
describe('エージェントの変更の diff タブのラベルの実行の番号', () => {
  it('実行の番号はアクティブな agent の diff タブにだけ付け、ほかの agent のタブは累積と同じラベル', () => {
    const active = { path: 'a.txt', kind: 'agent' } as const
    const other = { path: 'b.txt', kind: 'agent' } as const
    const { result } = renderHook(() =>
      useCombinedEditorTabs(
        makeParams({ diffTabs: [active, other], activeDiffTab: active, agentDiffRunNumber: 2 })
      )
    )
    expect(result.current.combinedTabs.map((tab) => tab.name)).toEqual([
      'a.txt (エージェントの変更・実行 2)',
      'b.txt (エージェントの変更)'
    ])
  })

  it('diffTabLabel は実行の番号が null なら累積のラベル', () => {
    expect(diffTabLabel({ path: 'a.txt', kind: 'agent' }, null)).toBe('a.txt (エージェントの変更)')
    expect(diffTabLabel({ path: 'a.txt', kind: 'agent' }, 3)).toBe(
      'a.txt (エージェントの変更・実行 3)'
    )
  })
})
```

`contentRunNumber: null` を AgentDiffActions の値に足す（機械的な置き換え）:
```bash
perl -pi -e 's/^(\s*)canRevertHunk: true,\n/$1canRevertHunk: true,\n$1contentRunNumber: null,\n/' \
  src/renderer/src/components/__tests__/EditorPanel.test.tsx \
  src/renderer/src/components/source-control/__tests__/DiffView.test.tsx \
  src/renderer/src/components/source-control/__tests__/AgentHunkRevertAction.test.tsx
git diff --stat
```
Expected: 3 ファイルの AgentDiffActions の値（`canRevertHunk: true,` の行の次）に `contentRunNumber: null,` が足される。

`src/renderer/src/components/__tests__/EditorPanel.test.tsx` の `describe('EditorPanel — diff タブ')` に足す:
```tsx
  it('agent の diff の内容が実行の範囲なら、アクティブな diff タブのラベルに実行の番号を付ける', () => {
    render(
      <EditorPanel
        {...defaultProps}
        diffTabs={[{ path: 'a.txt', kind: 'agent' }]}
        activeDiffTab={{ path: 'a.txt', kind: 'agent' }}
        diffContent={'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n'}
        agentDiffActions={{
          canRevertHunk: false,
          contentRunNumber: 2,
          disabledReason: null,
          error: null,
          notice: null,
          onRevertHunk: vi.fn()
        }}
      />
    )
    expect(screen.getByRole('tab', { name: /a\.txt \(エージェントの変更・実行 2\)/ })).toBeInTheDocument()
  })
```
（`defaultProps` はこのファイルの既定の props）

`src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts` の `describe('diff タブのハンクの操作(agentDiffActions)')` に足す:
```ts
    it('diff の内容の範囲が実行なら、その実行の番号を contentRunNumber に渡す(累積・無いなら null)', () => {
      const runs = [makeAgentChangesRun({ runId: 5, number: 2 })]
      const base = makeOptions({
        recording: {
          changes: makeAgentChangesController({
            view: makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], { runs })
          }),
          beginForSendAndRefresh: vi.fn(async () => undefined),
          beginManuallyAndRefresh: vi.fn(async () => undefined)
        },
        agentDiffScope: { kind: 'run', runId: 5 }
      })
      const { result, update } = setup(base)
      expect(result.current.agentDiffActions.contentRunNumber).toBe(2)
      update({ agentDiffScope: { kind: 'all' } })
      expect(result.current.agentDiffActions.contentRunNumber).toBeNull()
      update({ agentDiffScope: null })
      expect(result.current.agentDiffActions.contentRunNumber).toBeNull()
    })
```
`describe('ソース管理パネルのセクション(agentChangesPanel)')` の最初のテストに `expect(panel.changes.scope).toBe(changes.scope)` と `expect(panel.changes.selectScope).toBe(changes.selectScope)` を足す。（import に `makeAgentChangesRun`）

`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts` の `describe('エージェントの変更の配線')` に足す（import に `AgentChangesScope` 型、`makeAgentChangesRun`、`AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE`〈`../../lib/agentChangesMessages`〉）:
```ts
      // 設計書「テスト方針」の配線の結合テスト(本物の useAgentChanges・useAgentChangesRecording・useAgentChangesWiring・useAgentChangesRevert)
      it('実行を 2 回送ると実行 1・2 が並び、実行 1 を選ぶとその範囲で一覧を取り、戻すボタンを押せない', async () => {
        const run1 = makeAgentChangesRun({ runId: 1, number: 1, startedAt: 100, endedAt: 200 })
        const run2 = makeAgentChangesRun({ runId: 2, number: 2, startedAt: 200 })
        window.api.beginAgentChanges = vi
          .fn()
          .mockResolvedValueOnce({
            kind: 'recording',
            startedAt: 100,
            runs: [{ ...run1, endedAt: null }]
          })
          .mockResolvedValueOnce({ kind: 'recording', startedAt: 100, runs: [run1, run2] })
        window.api.listAgentChanges = vi.fn((scope: AgentChangesScope) =>
          Promise.resolve(
            makeAgentChangesListResult([makeAgentChangeEntry('a.txt')], { scope, runs: [run1, run2] })
          )
        )
        const { result } = renderHook(() => useAppState())
        const beforeAgentSend = mockUseAgentWorkspace.mock.lastCall![0].beforeAgentSend!
        await act(async () => {
          await beforeAgentSend()
        })
        await act(async () => {
          await beforeAgentSend()
        })
        await waitFor(() =>
          expect(result.current.agentChangesPanel.changes.view).toMatchObject({
            kind: 'recording',
            runs: [{ runId: 1 }, { runId: 2 }]
          })
        )
        expect(window.api.beginAgentChanges).toHaveBeenNthCalledWith(1, 'send')
        expect(window.api.beginAgentChanges).toHaveBeenNthCalledWith(2, 'send')
        act(() => result.current.agentChangesPanel.changes.selectScope({ kind: 'run', runId: 1 }))
        await waitFor(() =>
          expect(result.current.agentChangesPanel.revert.revertDisabledReason).toBe(
            AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE
          )
        )
        expect(window.api.listAgentChanges).toHaveBeenLastCalledWith({ kind: 'run', runId: 1 })
        expect(result.current.agentChangesPanel.revert.revertAllDisabledReason).toBe(
          AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE
        )
      })
```

- [ ] **Step 2: テストを走らせて失敗を確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/components/source-control/__tests__ src/renderer/src/hooks/__tests__/useCombinedEditorTabs.test.ts src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/EditorPanel.test.tsx`
Expected: FAIL（文言の関数・範囲の選択・`contentRunNumber`・`agentDiffRunNumber` が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/agentChangesMessages.ts`: import に `AgentChangesRun` を足し、`buildAgentChangesHeading` の後に足す:
```ts
/** 範囲の選択の見える文字のラベル */
export const AGENT_CHANGES_SCOPE_LABEL = '表示'
/** 実行の範囲の空の文言 */
export const AGENT_CHANGES_RUN_EMPTY = 'この実行では、変わったファイルはありません'
/** 実行の範囲の HEAD の帯(実行ごとの表示は戻せないため「戻すのはファイルの内容だけです」は付けない) */
export const AGENT_CHANGES_RUN_HEAD_CHANGED =
  'この実行の間に HEAD が変わりました（コミット・ブランチの切り替えなど）'
export const AGENT_CHANGES_START_NOT_RECORDED = '開始の状態を記録できませんでした'
export const AGENT_CHANGES_END_NOT_RECORDED = '次の実行の開始を記録できなかったため比べられません'

/** 区切りを取れなかった理由の短い形(選択の項目の文字に含める。L-057) */
export const AGENT_CHANGES_RUN_UNAVAILABLE_SHORT: Record<AgentChangesUnavailableReason, string> = {
  'not-repository': 'Git 管理外のフォルダです',
  'not-toplevel': 'リポジトリの最上位のフォルダではありません',
  'too-many-untracked': '未追跡のファイルが多すぎます',
  timeout: '時間がかかりすぎました',
  'git-failed': 'git を実行できませんでした'
}

/** 選択の累積の項目 */
export function formatAgentChangesAllScopeOption(startedAt: number): string {
  return `すべて（累積・${formatAgentChangesStartedAt(startedAt)} から）`
}

// 実行の期間(HH:MM から・HH:MM〜HH:MM)
const runPeriod = (run: AgentChangesRun): string =>
  run.endedAt === null
    ? `${formatAgentChangesStartedAt(run.startedAt)} から`
    : `${formatAgentChangesStartedAt(run.startedAt)}〜${formatAgentChangesStartedAt(run.endedAt)}`

/** 選択の実行の項目。選べない実行は理由を含める */
export function formatAgentChangesRunOption(run: AgentChangesRun): string {
  const start = formatAgentChangesStartedAt(run.startedAt)
  switch (run.availability.kind) {
    case 'start-not-recorded':
      return `実行 ${run.number}（${start}・${AGENT_CHANGES_START_NOT_RECORDED}: ${AGENT_CHANGES_RUN_UNAVAILABLE_SHORT[run.availability.reason]}）`
    case 'end-not-recorded':
      return `実行 ${run.number}（${start}〜・${AGENT_CHANGES_END_NOT_RECORDED}）`
    default:
      return `実行 ${run.number}（${runPeriod(run)}）`
  }
}

/** 実行の範囲の見出し。変更があれば件数(打ち切る前の全件数)を添える */
export function buildAgentChangesRunHeading(run: AgentChangesRun, totalCount: number | null): string {
  const count = totalCount !== null && totalCount > 0 ? ` (${totalCount})` : ''
  return `${AGENT_CHANGES_HEADING}${count}（実行 ${run.number}・${runPeriod(run)}）`
}

/** 範囲の一覧が取れない理由(選択の項目と同じ理由。写しの実行に理由があれば添える) */
export function describeAgentChangesScopeUnavailable(
  reason: 'start-not-recorded' | 'end-not-recorded',
  run: AgentChangesRun | undefined
): string {
  if (reason === 'end-not-recorded') return AGENT_CHANGES_END_NOT_RECORDED
  return run?.availability.kind === 'start-not-recorded'
    ? `${AGENT_CHANGES_START_NOT_RECORDED}: ${AGENT_CHANGES_RUN_UNAVAILABLE_SHORT[run.availability.reason]}`
    : AGENT_CHANGES_START_NOT_RECORDED
}
```

`src/renderer/src/components/source-control/AgentChangesScopeSelect.tsx` を作る:
```tsx
'use client'
import { useId } from 'react'
import type { AgentChangesRun, AgentChangesScope } from '@shared/types'
import {
  AGENT_CHANGES_SCOPE_LABEL,
  formatAgentChangesAllScopeOption,
  formatAgentChangesRunOption
} from '../../lib/agentChangesMessages'

interface Props {
  /** 累積の始点の時刻 */
  startedAt: number
  /** 実行の一覧(古い順。新しい順に並べて出す) */
  runs: readonly AgentChangesRun[]
  scope: AgentChangesScope
  /** 選べない間(戻す操作の実行中)は true */
  disabled: boolean
  /** 押せない理由の要素の id(disabled のときだけ aria-describedby で結ぶ。無ければ null) */
  disabledReasonId: string | null
  onSelect: (scope: AgentChangesScope) => void
}

const ALL_VALUE = 'all'
const RUN_PREFIX = 'run:'
const valueOf = (scope: AgentChangesScope): string =>
  scope.kind === 'all' ? ALL_VALUE : `${RUN_PREFIX}${scope.runId}`

// 「エージェントの変更」の範囲の選択(設計書「範囲の選択の UI」)。見える文字のラベル「表示」とネイティブの <select>
// (選択の状態と disabled を支援技術へそのまま伝え、最大 11 項目を狭いサイドバーで縦に場所を取らずに並べる)。
// 新しい実行ほど見る機会が多いので上に置く。選べない実行は disabled の項目にし、理由を項目の文字に含める(L-057)
export default function AgentChangesScopeSelect({
  startedAt,
  runs,
  scope,
  disabled,
  disabledReasonId,
  onSelect
}: Props): React.JSX.Element {
  const selectId = useId()
  const newestFirst = [...runs].sort((a, b) => b.runId - a.runId)
  return (
    <div className="agent-changes__scope">
      <label htmlFor={selectId} className="agent-changes__scope-label">
        {AGENT_CHANGES_SCOPE_LABEL}
      </label>
      <select
        id={selectId}
        className="agent-changes__scope-select"
        value={valueOf(scope)}
        disabled={disabled}
        aria-describedby={disabled && disabledReasonId !== null ? disabledReasonId : undefined}
        onChange={(event) => {
          const value = event.target.value
          if (value === ALL_VALUE) {
            onSelect({ kind: 'all' })
            return
          }
          const runId = Number(value.slice(RUN_PREFIX.length))
          if (value.startsWith(RUN_PREFIX) && Number.isSafeInteger(runId)) {
            onSelect({ kind: 'run', runId })
          }
        }}
      >
        <option value={ALL_VALUE}>{formatAgentChangesAllScopeOption(startedAt)}</option>
        {newestFirst.map((run) => (
          <option
            key={run.runId}
            value={`${RUN_PREFIX}${run.runId}`}
            disabled={run.availability.kind !== 'available'}
          >
            {formatAgentChangesRunOption(run)}
          </option>
        ))}
      </select>
    </div>
  )
}
```

`src/renderer/src/assets/main.css` の `.agent-changes__live` の規則の前に足す:
```css
.agent-changes__scope {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
}

.agent-changes__scope-label {
  flex: none;
  color: #cccccc;
  font-size: 12px;
}

/* 長い項目は選択の中で末尾が切れ(環境によっては省略され)、開くと全文が見える(狭いサイドバー) */
.agent-changes__scope-select {
  flex-grow: 1;
  flex-shrink: 1;
  min-width: 0;
  min-height: 32px;
  padding: 0 6px;
  background: #3c3c3c;
  border: 1px solid #555555;
  border-radius: 3px;
  color: #cccccc;
  font-size: 12px;
  text-overflow: ellipsis;
}

.agent-changes__scope-select:disabled {
  opacity: 0.5;
  cursor: default;
}
```

`src/renderer/src/components/source-control/AgentChangesSection.tsx`:
1. import に足す: `import AgentChangesScopeSelect from './AgentChangesScopeSelect'`、`import { findAgentChangesRun, getListedAgentChanges } from '../../lib/agentChangesScope'`（Task 5 の `getListedAgentChanges` の import に足す）、文言の import に `AGENT_CHANGES_RUN_EMPTY`・`AGENT_CHANGES_RUN_HEAD_CHANGED`・`buildAgentChangesRunHeading`・`describeAgentChangesScopeUnavailable`。
2. `const recording = …` から `const shownReason = …` までを次にする:
```tsx
  const recording = view.kind === 'recording' ? view : null
  const list = getListedAgentChanges(view)
  // 選んでいる実行(範囲が実行で、写しの実行の一覧にあるとき)。見出しの番号と期間に使う
  const selectedRun =
    recording !== null && changes.scope.kind === 'run'
      ? (findAgentChangesRun(recording.runs, changes.scope.runId) ?? null)
      : null
  const heading =
    recording === null
      ? buildAgentChangesHeading(null)
      : selectedRun !== null
        ? buildAgentChangesRunHeading(selectedRun, list?.totalCount ?? null)
        : buildAgentChangesHeading({
            startedAt: recording.startedAt,
            totalCount: list?.totalCount ?? null
          })
  // 表示中の一覧が実行の範囲か(空の文言・HEAD の帯・あなたの保存を含むの印を出し分ける)
  const isRunList = list !== null && list.scope.kind === 'run'
  // 範囲の一覧が取れない(写しが古い)。run-missing は useAgentChanges が累積に戻して取り直すため出さない
  const unavailableList =
    recording?.list?.kind === 'scope-unavailable' && recording.list.reason !== 'run-missing'
      ? { reason: recording.list.reason, scope: recording.list.scope }
      : null
  const hasEntries = list !== null && list.entries.length > 0
  // 押せない理由は 1 か所に出す。「すべて戻す」の理由は「ファイル単位の理由(実行の範囲を含む)」「打ち切り」「記録していないファイルを含む」
  // (notRecorded)のいずれか。行の戻すボタンがこの要素を参照できるのは、agentRevertAllDisabledReason がファイル単位の
  // 理由を先に評価する(行が押せないときは必ず同じ文言になる)という評価の順序に依存している
  const shownReason = hasEntries ? revert.revertAllDisabledReason : null
```
   `unavailableList` の `reason` は `'start-not-recorded' | 'end-not-recorded'` に絞られる（TypeScript が絞れない場合は `as 'start-not-recorded' | 'end-not-recorded'` ではなく、`recording.list.reason === 'start-not-recorded' || recording.list.reason === 'end-not-recorded'` の条件で絞る）。
3. `{recording !== null && (` の中の先頭（`changes.listError` の表示の前）に足す:
```tsx
              {recording.runs.length > 0 && (
                <AgentChangesScopeSelect
                  startedAt={recording.startedAt}
                  runs={recording.runs}
                  scope={changes.scope}
                  disabled={revert.isReverting}
                  disabledReasonId={shownReason !== null ? reasonId : null}
                  onSelect={(next) => {
                    // 戻す操作の実行中は範囲を変えない(戻した結果の同期と取り直しが混ざる。L-039・L-058)
                    if (!revert.isReverting) changes.selectScope(next)
                  }}
                />
              )}
```
4. HEAD の帯・空の文言・保存の印を出し分け、範囲の一覧が取れない理由を足す:
```tsx
              {list?.headChanged === true && (
                <p className="agent-changes__note">
                  {isRunList ? AGENT_CHANGES_RUN_HEAD_CHANGED : AGENT_CHANGES_HEAD_CHANGED}
                </p>
              )}
              {unavailableList !== null && (
                <p className="agent-changes__note">
                  {describeAgentChangesScopeUnavailable(
                    unavailableList.reason,
                    unavailableList.scope.kind === 'run'
                      ? findAgentChangesRun(recording.runs, unavailableList.scope.runId)
                      : undefined
                  )}
                </p>
              )}
```
```tsx
              {list !== null && list.entries.length === 0 && (
                <p className="agent-changes__note">
                  {isRunList ? AGENT_CHANGES_RUN_EMPTY : AGENT_CHANGES_EMPTY}
                </p>
              )}
```
   行の `savedInApp` を `!isRunList && isEntrySavedInApp(folderPath, changes.savedPaths, entry.path)` にする（アプリで保存したパスは記録ごとに持つため、実行の範囲で出すと別の実行の保存を「この実行に含む」と見せる）。

`src/renderer/src/types.ts` の `AgentDiffActions` の `canRevertHunk` の次に足す:
```ts
  /** 表示中の diff の内容を取った範囲の実行の番号(タブのラベルの「実行 N」。累積・内容が無い間は null) */
  contentRunNumber: number | null
```

`src/renderer/src/hooks/useAgentChangesWiring.ts`:
1. import に `import { findAgentChangesRun } from '../lib/agentChangesScope'` を足す。
2. `AgentChangesPanelState.changes` の Pick に `| 'scope'` と `| 'selectScope'` を足す。
3. `agentDiffActions` に足す:
```ts
    contentRunNumber:
      agentDiffScope?.kind === 'run' && view.kind === 'recording'
        ? (findAgentChangesRun(view.runs, agentDiffScope.runId)?.number ?? null)
        : null,
```

`src/renderer/src/hooks/useCombinedEditorTabs.ts`:
1. import に `import { isSameKey } from './useDiffTabs'` を足す（`DiffTabKey` の型の import はそのまま）。
2. `Params` の `activeDiffTab` の次に足す:
```ts
  /** アクティブな agent の diff タブの内容を取った範囲の実行の番号(累積・内容が無い間は null) */
  agentDiffRunNumber: number | null
```
3. `diffTabLabel` を次にする:
```ts
// diff タブのラベル。フルパス + 種類で一意にする(下の combinedTabs の説明)。エージェントの変更は、内容を取った範囲が実行なら番号を添える
export function diffTabLabel(tab: DiffTabKey, runNumber: number | null): string {
  if (tab.kind === 'agent') {
    return runNumber === null
      ? `${tab.path} (エージェントの変更)`
      : `${tab.path} (エージェントの変更・実行 ${runNumber})`
  }
  return `${tab.path} (${tab.kind === 'staged' ? 'ステージ済み' : '未ステージ'}差分)`
}
```
4. 引数の分割に `agentDiffRunNumber` を足し、`diffTabItems` の `name: diffTabLabel(tab),` を次にし、`useMemo` の依存に `activeDiffTab, agentDiffRunNumber` を足す:
```ts
      // 実行の番号は内容を持つアクティブなタブにだけ付ける(ほかの agent のタブは内容を取っていない)
      name: diffTabLabel(
        tab,
        activeDiffTab !== null && isSameKey(tab, activeDiffTab) ? agentDiffRunNumber : null
      ),
```

`src/renderer/src/components/EditorPanel.tsx` の `useCombinedEditorTabs({ … })` の `activeDiffTab,` の次に足す:
```ts
    agentDiffRunNumber: agentDiffActions?.contentRunNumber ?? null,
```

- [ ] **Step 4: テストを走らせて通ることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentChangesMessages.test.ts src/renderer/src/components/source-control/__tests__ src/renderer/src/hooks/__tests__/useCombinedEditorTabs.test.ts src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/EditorPanel.test.tsx src/renderer/src/components/__tests__/App.agentChanges.test.tsx`
Expected: PASS

- [ ] **Step 5: 検証**

Run: `npx vitest run src/renderer`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: 変更・作成した TypeScript のファイル（Files の一覧）へ `npx eslint --fix` → `npx eslint --max-warnings 0`
Expected: エラー・警告なし

---

### Task 7: 一覧の自動の取り直し（`useAgentChangesAutoRefresh`・wiring・`useAppState` の配線）

**Files:**
- Create: `src/renderer/src/hooks/useAgentChangesAutoRefresh.ts`
- Modify: `src/renderer/src/hooks/useAgentChangesWiring.ts`（引数 `agentTabs`・`agentActivities` と呼び出し）
- Modify: `src/renderer/src/hooks/useAppState.ts`（L525-538 の wiring の引数）
- Test: `src/renderer/src/hooks/__tests__/useAgentChangesAutoRefresh.test.ts`（新規）、`src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts`、`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`

**Interfaces:**
- Consumes: `advanceAgentNotifications(previous, tabs, activities)`・`AgentNotificationTab`（`lib/agentNotificationEvents.ts`）、`AgentActivity`（`lib/agentActivity.ts`）、`useAgentChanges.refresh`（Task 5。選んでいる範囲で取る）、`agentWorkspace.agentTerminal.sessions.tabs`（`AgentSessionTabView[]`）・`agentWorkspace.agentTerminal.activities`
- Produces:
```ts
// src/renderer/src/hooks/useAgentChangesAutoRefresh.ts
export const AUTO_REFRESH_WAIT_MS = 300
export const AUTO_REFRESH_MAX_WAIT_MS = 1_000
export interface AgentChangesAutoRefreshOptions {
  isRecording: boolean
  folderPath: string | null
  refresh: (options?: { announce?: boolean }) => Promise<void>
  tabs: readonly AgentNotificationTab[]
  activities: ReadonlyMap<string, AgentActivity>
}
export function useAgentChangesAutoRefresh(options: AgentChangesAutoRefreshOptions): void
// src/renderer/src/hooks/useAgentChangesWiring.ts
export interface AgentChangesWiringOptions {
  /* 既存 */
  agentTabs: readonly AgentNotificationTab[]
  agentActivities: ReadonlyMap<string, AgentActivity>
}
```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAgentChangesAutoRefresh.test.ts` を作る:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AgentActivity } from '../../lib/agentActivity'
import type { AgentNotificationTab } from '../../lib/agentNotificationEvents'
import {
  AUTO_REFRESH_MAX_WAIT_MS,
  AUTO_REFRESH_WAIT_MS,
  useAgentChangesAutoRefresh
} from '../useAgentChangesAutoRefresh'
import type { AgentChangesAutoRefreshOptions } from '../useAgentChangesAutoRefresh'

const tab: AgentNotificationTab = { slotId: 's1', number: 1, status: 'running', isClosing: false }
const activitiesOf = (activity: AgentActivity): ReadonlyMap<string, AgentActivity> =>
  new Map([['s1', activity]])

function setup(overrides: Partial<AgentChangesAutoRefreshOptions> = {}): {
  refresh: ReturnType<typeof vi.fn<AgentChangesAutoRefreshOptions['refresh']>>
  update: (next: Partial<AgentChangesAutoRefreshOptions>) => void
  unmount: () => void
} {
  const refresh = vi.fn<AgentChangesAutoRefreshOptions['refresh']>(async () => undefined)
  let props: AgentChangesAutoRefreshOptions = {
    isRecording: true,
    folderPath: '/repo',
    refresh,
    tabs: [tab],
    activities: activitiesOf('working'),
    ...overrides
  }
  const { rerender, unmount } = renderHook(
    (p: AgentChangesAutoRefreshOptions) => useAgentChangesAutoRefresh(p),
    { initialProps: props }
  )
  return {
    refresh,
    update: (next) => {
      props = { ...props, ...next }
      rerender(props)
    },
    unmount
  }
}

const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}
const focusWindow = (): void => {
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
}
const changeVisibility = (state: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  // visibilityState の上書きを外し、jsdom の既定(prototype の getter)に戻す
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('useAgentChangesAutoRefresh', () => {
  it('活動が working → idle(完了)になると、待ちの時間の後に 1 回だけ、読み上げずに取り直す', async () => {
    const { refresh, update } = setup()
    update({ activities: activitiesOf('idle') })
    await advance(AUTO_REFRESH_WAIT_MS - 1)
    expect(refresh).not.toHaveBeenCalled()
    await advance(1)
    expect(refresh).toHaveBeenCalledExactlyOnceWith({ announce: false })
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it.each<AgentActivity>(['permission', 'confirm'])('活動が %s(利用者を待つ)になっても取り直す', async (activity) => {
    const { refresh, update } = setup()
    update({ activities: activitiesOf(activity) })
    await advance(AUTO_REFRESH_WAIT_MS)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('出来事にならない変化(working のまま・unknown)では取り直さない', async () => {
    const { refresh, update } = setup()
    update({ activities: activitiesOf('working') })
    update({ activities: activitiesOf('unknown') })
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('閉じる途中のタブの完了では取り直さない', async () => {
    const { refresh, update } = setup()
    update({ tabs: [{ ...tab, isClosing: true }], activities: activitiesOf('idle') })
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('ウィンドウの focus で予約し、待ちの時間の後に 1 回だけ取り直す', async () => {
    const { refresh } = setup()
    focusWindow()
    focusWindow()
    await advance(AUTO_REFRESH_WAIT_MS)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('visibilitychange は visible のときだけ取り直し、hidden では取り直さない', async () => {
    const { refresh } = setup()
    changeVisibility('hidden')
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).not.toHaveBeenCalled()
    changeVisibility('visible')
    await advance(AUTO_REFRESH_WAIT_MS)
    expect(refresh).toHaveBeenCalledOnce()
  })

  // L-399: 待ちだけのデバウンスは、契機が待ちより短い間隔で続く間に一度も走らない
  it('待ちより短い間隔で契機が続いても、最初の契機から上限の時間で必ず 1 回走る', async () => {
    const { refresh } = setup()
    const step = AUTO_REFRESH_WAIT_MS - 50
    let elapsed = 0
    while (elapsed + step < AUTO_REFRESH_MAX_WAIT_MS) {
      focusWindow()
      await advance(step)
      elapsed += step
    }
    focusWindow()
    await advance(AUTO_REFRESH_MAX_WAIT_MS - elapsed - 1)
    expect(refresh).not.toHaveBeenCalled()
    await advance(1)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('取り直しの実行中に契機が来たら、終わった後に 1 回だけ走り直す', async () => {
    const { refresh } = setup()
    let resolveFirst: () => void = () => undefined
    refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
    )
    focusWindow()
    await advance(AUTO_REFRESH_WAIT_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
    focusWindow()
    await advance(AUTO_REFRESH_WAIT_MS)
    focusWindow()
    await advance(AUTO_REFRESH_WAIT_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveFirst()
    })
    // 完了の後の走り直しは Promise の解決の連鎖の後に呼ばれる(microtask の段数に頼らずに待つ)
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  // タイマーの数は、描画の後の数との差で比べる(React の内部のタイマーを数えない)
  it('記録中でない間は契機を捨て、タイマーを張らない', async () => {
    const { refresh, update } = setup({ isRecording: false })
    const before = vi.getTimerCount()
    focusWindow()
    update({ activities: activitiesOf('idle') })
    expect(vi.getTimerCount()).toBe(before)
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each<[string, Partial<AgentChangesAutoRefreshOptions>]>([
    ['記録中でなくなった', { isRecording: false }],
    ['フォルダが変わった', { folderPath: '/other' }]
  ])('%s ら、予約を取り消す', async (_label, next) => {
    const { refresh, update } = setup()
    const before = vi.getTimerCount()
    focusWindow()
    expect(vi.getTimerCount()).toBe(before + 2)
    update(next)
    expect(vi.getTimerCount()).toBe(before)
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('アンマウントで予約を取り消し、focus の購読を外す', async () => {
    const { refresh, unmount } = setup()
    const before = vi.getTimerCount()
    focusWindow()
    unmount()
    expect(vi.getTimerCount()).toBeLessThanOrEqual(before)
    window.dispatchEvent(new Event('focus'))
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).not.toHaveBeenCalled()
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts`:
1. `makeOptions` の戻り値に `agentTabs: [],` と `agentActivities: new Map(),` を足す。import に `import type { AgentActivity } from '../../lib/agentActivity'`・`import type { AgentNotificationTab } from '../../lib/agentNotificationEvents'`・`import { AUTO_REFRESH_WAIT_MS } from '../useAgentChangesAutoRefresh'`・`afterEach` を足す。
2. `describe('一覧を取り直す契機')` に足す:
```ts
    describe('自動の取り直し(エージェントの活動の出来事)', () => {
      const tab: AgentNotificationTab = { slotId: 's1', number: 1, status: 'running', isClosing: false }
      const activitiesOf = (activity: AgentActivity): ReadonlyMap<string, AgentActivity> =>
        new Map([['s1', activity]])

      beforeEach(() => {
        vi.useFakeTimers()
      })
      afterEach(() => {
        vi.useRealTimers()
      })

      it('記録中に活動が完了になると、待ちの後に一覧だけを読み上げずに取り直す(git status は取り直さない)', async () => {
        const initial = makeOptions({ agentTabs: [tab], agentActivities: activitiesOf('working') })
        const { update, options } = setup({
          ...initial,
          ...withView(initial, makeAgentChangesRecordingView([]))
        })
        update({ agentActivities: activitiesOf('idle') })
        await act(async () => {
          vi.advanceTimersByTime(AUTO_REFRESH_WAIT_MS)
        })
        expect(options().recording.changes.refresh).toHaveBeenCalledExactlyOnceWith({
          announce: false
        })
        expect(options().refreshGitStatus).not.toHaveBeenCalled()
      })

      it('記録が無い間は、活動が完了になっても取り直さない', async () => {
        const { update, options } = setup(
          makeOptions({ agentTabs: [tab], agentActivities: activitiesOf('working') })
        )
        update({ agentActivities: activitiesOf('idle') })
        await act(async () => {
          vi.advanceTimersByTime(AUTO_REFRESH_WAIT_MS * 10)
        })
        expect(options().recording.changes.refresh).not.toHaveBeenCalled()
      })
    })
```

`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts` の `describe('エージェントの変更の配線')` に足す（import に `makeAgentSessionTabView`〈`../../__tests__/makeAgentSessionsState`〉、`import type { AgentActivity } from '../../lib/agentActivity'`、`AUTO_REFRESH_MAX_WAIT_MS`〈`../useAgentChangesAutoRefresh`〉）:
```ts
      // 設計書「テスト方針」の配線の結合テスト。agentTabs・agentActivities の渡し忘れ・取り違えで落ちる(L-060)
      it('いずれかのタブの活動が working → idle になると、記録の一覧を自動で取り直す(本物の hook どうし)', async () => {
        const tab = makeAgentSessionTabView({ slotId: 's1', status: 'running' })
        const workspaceWith = (activity: AgentActivity): ReturnType<typeof makeAgentWorkspaceState> => {
          const workspace = makeAgentWorkspaceState()
          return {
            ...workspace,
            agentTerminal: {
              ...workspace.agentTerminal,
              sessions: makeAgentSessionsState({ tabs: [tab] }),
              activities: new Map([['s1', activity]])
            }
          }
        }
        mockUseAgentWorkspace.mockReturnValue(workspaceWith('working'))
        const { result, rerender } = renderHook(() => useAppState())
        await act(async () => {
          await result.current.agentChangesPanel.changes.begin()
        })
        await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalledOnce())
        mockUseAgentWorkspace.mockReturnValue(workspaceWith('idle'))
        rerender()
        await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalledTimes(2), {
          timeout: AUTO_REFRESH_MAX_WAIT_MS + 1_000
        })
        expect(window.api.listAgentChanges).toHaveBeenLastCalledWith({ kind: 'all' })
      })
```

- [ ] **Step 2: テストを走らせて失敗を確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesAutoRefresh.test.ts src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`
Expected: FAIL（`useAgentChangesAutoRefresh` が無い・wiring が `agentTabs` を受けない）

- [ ] **Step 3: 実装する**

`src/renderer/src/hooks/useAgentChangesAutoRefresh.ts` を作る:
```ts
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentNotificationTab } from '../lib/agentNotificationEvents'
import { advanceAgentNotifications } from '../lib/agentNotificationEvents'
import { useLatestRef } from './useLatestRef'
import { useOnChange } from './useOnChange'

// エージェントの変更の一覧の自動の取り直し(設計書「自動の取り直し」)。契機は、活動の出来事(完了・許可待ち・確認待ち。通知と同じ
// advanceAgentNotifications の events で、通知の設定・方式に依らない。閉じる途中のタブは出来事にならない)と、ウィンドウの focus・
// visibilitychange(visible のときだけ)。表示用の派生値の並びは契機にしない(L-417)。最後の契機から AUTO_REFRESH_WAIT_MS 待って
// 1 回にまとめ、最初の未処理の契機から AUTO_REFRESH_MAX_WAIT_MS を上限に必ず走らせる(L-399)。記録が無い間は契機を捨てる。
// 取り直すのはエージェントの変更の一覧だけで(git status は取り直さない。ソース管理の既存の手動テストの前提を変えない)、件数は読み上げない
// (完了・許可待ちは通知が読み上げる)。既存の契機(変更を確認・更新・git status・セッションの終了)はこの hook を通さない

/** 最後の契機からの待ち */
export const AUTO_REFRESH_WAIT_MS = 300
/** 最初の未処理の契機からの上限 */
export const AUTO_REFRESH_MAX_WAIT_MS = 1_000

export interface AgentChangesAutoRefreshOptions {
  /** 記録中か(view.kind === 'recording')。記録中でない間は契機を捨て、タイマーを張らない */
  isRecording: boolean
  /** 開いているフォルダ(変わったら予約を取り消す) */
  folderPath: string | null
  /** 一覧の取り直し(useAgentChanges.refresh。選んでいる範囲で取る) */
  refresh: (options?: { announce?: boolean }) => Promise<void>
  /** エージェントのタブ(通知と同じ形) */
  tabs: readonly AgentNotificationTab[]
  /** タブごとの活動(useAgentActivity) */
  activities: ReadonlyMap<string, AgentActivity>
}

// 合流の控え(待ちと上限のタイマー・実行中・もう 1 回の印・世代)。寿命は hook と同じ(useAgentActivity の TabWatch と同じ作り)
interface AutoRefreshState {
  waitTimer: ReturnType<typeof setTimeout> | null
  maxTimer: ReturnType<typeof setTimeout> | null
  running: boolean
  rerun: boolean
  /** 記録の終わり・フォルダの切り替え・アンマウントで進め、古い取り直しの完了を区別する */
  generation: number
}

// タイマーの中から呼ぶため、呼んだ時点の最新を読む
interface AutoRefreshDeps {
  isRecording: boolean
  refresh: () => Promise<void>
}

const cancelTimers = (state: AutoRefreshState): void => {
  if (state.waitTimer !== null) clearTimeout(state.waitTimer)
  if (state.maxTimer !== null) clearTimeout(state.maxTimer)
  state.waitTimer = null
  state.maxTimer = null
}

// 取り直す(待ちと上限のどちらで呼ばれても両方を取り消す)。実行中なら「もう 1 回」の印だけ立て、終わった後に 1 回だけ走らせ直す
function runAutoRefresh(state: AutoRefreshState, deps: RefObject<AutoRefreshDeps>): void {
  cancelTimers(state)
  if (!deps.current.isRecording) return
  if (state.running) {
    state.rerun = true
    return
  }
  state.running = true
  const generation = state.generation
  void deps.current
    .refresh()
    .catch(() => undefined)
    .finally(() => {
      if (state.generation !== generation) return
      state.running = false
      if (!state.rerun) return
      state.rerun = false
      runAutoRefresh(state, deps)
    })
}

// 予約する。待ちは契機のたびに張り直し、上限は最初の未処理の契機で張る
function scheduleAutoRefresh(state: AutoRefreshState, deps: RefObject<AutoRefreshDeps>): void {
  if (!deps.current.isRecording) return
  if (state.waitTimer !== null) clearTimeout(state.waitTimer)
  state.waitTimer = setTimeout(() => runAutoRefresh(state, deps), AUTO_REFRESH_WAIT_MS)
  if (state.maxTimer === null) {
    state.maxTimer = setTimeout(() => runAutoRefresh(state, deps), AUTO_REFRESH_MAX_WAIT_MS)
  }
}

// 予約を取り消し、実行中の取り直しの完了を古いものとして扱う
function resetAutoRefresh(state: AutoRefreshState): void {
  state.generation += 1
  cancelTimers(state)
  state.running = false
  state.rerun = false
}

export function useAgentChangesAutoRefresh({
  isRecording,
  folderPath,
  refresh,
  tabs,
  activities
}: AgentChangesAutoRefreshOptions): void {
  const stateRef = useRef<AutoRefreshState>({
    waitTimer: null,
    maxTimer: null,
    running: false,
    rerun: false,
    generation: 0
  })
  const depsRef = useLatestRef<AutoRefreshDeps>({
    isRecording,
    refresh: () => refresh({ announce: false })
  })
  // タブごとの最後の確かな活動(通知の useAgentNotifications と同じ純粋な関数で出来事を決める。こちらは自分の控えを持つ)
  const settledRef = useRef<ReadonlyMap<string, AgentActivity>>(new Map())

  // 活動の出来事。活動の Map は内容が同じなら同じ参照のままなので、タブの一覧の変化でも見直す(useAgentNotifications と同じ)
  useEffect(() => {
    const { settled, events } = advanceAgentNotifications(settledRef.current, tabs, activities)
    settledRef.current = settled
    if (events.length > 0) scheduleAutoRefresh(stateRef.current, depsRef)
  }, [tabs, activities, depsRef])

  // ウィンドウのフォーカスの復帰(useExternalFileChanges と同じ購読の形)。アンマウントで予約も取り消す
  useEffect(() => {
    const state = stateRef.current
    const onFocus = (): void => scheduleAutoRefresh(state, depsRef)
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') scheduleAutoRefresh(state, depsRef)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      resetAutoRefresh(state)
    }
  }, [depsRef])

  // 記録中でなくなった・フォルダが変わったら、予約を取り消す(記録中に戻ったときに古い予約で走らない)
  useOnChange(isRecording, () => {
    if (!isRecording) resetAutoRefresh(stateRef.current)
  })
  useOnChange(folderPath, () => resetAutoRefresh(stateRef.current))
}
```

`src/renderer/src/hooks/useAgentChangesWiring.ts`:
1. import に足す: `import type { AgentActivity } from '../lib/agentActivity'`、`import type { AgentNotificationTab } from '../lib/agentNotificationEvents'`、`import { useAgentChangesAutoRefresh } from './useAgentChangesAutoRefresh'`。
2. `AgentChangesWiringOptions` の `agentRunning` の次に足す:
```ts
  /** エージェントのタブ(useAgentSessions の tabs。自動の取り直しの活動の出来事に使う) */
  agentTabs: readonly AgentNotificationTab[]
  /** タブごとの活動(useAgentWorkspace の agentTerminal.activities) */
  agentActivities: ReadonlyMap<string, AgentActivity>
```
3. 引数の分割に `agentTabs`・`agentActivities` を足す。
4. `useOnChange(view, () => { … })` の後に足す:
```ts
  // 一覧の自動の取り直し(設計書「自動の取り直し」)。活動の出来事(完了・許可待ち・確認待ち)とフォーカスの復帰を合流して、
  // 記録がある間だけ一覧を取り直す(読み上げない・git status は取り直さない)。上の既存の契機はこれを通さない
  useAgentChangesAutoRefresh({
    isRecording: view.kind === 'recording',
    folderPath,
    refresh: refreshAgentChanges,
    tabs: agentTabs,
    activities: agentActivities
  })
```
5. ファイルの冒頭のコメントの「一覧を取り直す契機」の説明に「（自動の取り直しは useAgentChangesAutoRefresh）」を足す。

`src/renderer/src/hooks/useAppState.ts` の `useAgentChangesWiring({ … })` の `agentRunning: …,` の次に足す:
```ts
    agentTabs: agentWorkspace.agentTerminal.sessions.tabs,
    agentActivities: agentWorkspace.agentTerminal.activities,
```

- [ ] **Step 4: テストを走らせて通ることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesAutoRefresh.test.ts src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`
Expected: PASS

- [ ] **Step 5: 上限・配線を外すとテストが落ちることを確かめる（変異）**

1. `scheduleAutoRefresh` の `if (state.maxTimer === null) { … }` を一時的に消して走らせる → `待ちより短い間隔で契機が続いても…` が FAIL。元に戻す。
2. `useAppState.ts` の `agentActivities: agentWorkspace.agentTerminal.activities` を一時的に `agentActivities: new Map()` にして走らせる → `いずれかのタブの活動が working → idle になると…` が FAIL（L-060）。元に戻す。
Run（それぞれ）: `npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesAutoRefresh.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`
元に戻した後にもう一度走らせて PASS を確かめる。

- [ ] **Step 6: 検証**

Run: `npx vitest run src/renderer`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: 変更・作成した TypeScript のファイル（Files の一覧）へ `npx eslint --fix` → `npx eslint --max-warnings 0`
Expected: エラー・警告なし（`react-hooks` の規則に当たったら、ref の読み書きを effect・コールバックの中に置く形を保ったまま直す）

---

### Task 8: ROADMAP・前の設計書・実機テスト仕様書の更新と全体の検証

**Files:** `ROADMAP.md`、`docs/superpowers/specs/2026-10-06-agent-changes-review-design.md`、`docs/superpowers/specs/2026-10-12-agent-changes-runs-and-auto-refresh-design.md`、`docs/manual-test-spec.md`、`.superpowers/manual-test-spec.html`（生成。git 管理外）

> コントローラーは、Task 1 の Step 6 で報告された区切りの取得の時間（ミリ秒）をこのタスクの実装者に渡す（下の既知の制約の `<実測の値>` を埋めるのに使う）。

- [ ] **Step 1: ROADMAP**

1. 「今後実装した方がよい機能（未実装）」→「エージェント実行の支援（MVP の次）」の `- [ ] エージェントの変更の確認の拡張: …（実装済みの「エージェントが変更したファイルの確認」の続き）` は**完了にしない**（`- [ ]` のまま。今回は項目の中の 3 つのうち 2 つの領域〈実行ごとの記録・自動の取り直し〉だけを実装した）。項目の最後の行（`記録の blob を gc から守る（実装済みの「エージェントが変更したファイルの確認」の続き）`）の次に、同じ字下げ（6 つの空白）で次の 2 行を足す:
```markdown
      - 実装済み（2026-10-12。設計書 `docs/superpowers/specs/2026-10-12-agent-changes-runs-and-auto-refresh-design.md`）: 実行ごとの記録（実行 1・実行 2 を選んで比べる）、完了・許可待ちの検知と連動した一覧の自動の取り直し、ウィンドウのフォーカスの復帰での取り直し。実装済み機能の「エージェントの変更の実行ごとの記録と一覧の自動の取り直し」を参照
      - 残り: 戻した操作の取り消し、`claude` の hooks で利用者の編集と区別する、Git 管理外のフォルダでの記録、記録の blob を gc から守る
```
2. 「実装済み機能」の `### エージェントが変更したファイルの確認（MVP の次）` の既知の制約のうち、次の 3 行を直す（過去の状態は過去形にし、変えた時期を明記する）:
   - `- 記録は最初の `実行`（または `いまから記録する`）から `確認を終える` までの累積で、実行ごとには分けない。` で始まる行の最初の文を `- 記録は最初の `実行`（または `いまから記録する`）から `確認を終える` までの累積（2026-10-12 から、実行ごとにも分けて見られる。「エージェントの変更の実行ごとの記録と一覧の自動の取り直し」を参照）。` にする（続く `` `実行` を押さずに…`` の文はそのまま）
   - `- エージェントの実行の完了は検知しない。一覧は `変更を確認`・`更新`・Git の操作・セッションの終了で取り直し、自動では最新にならない` を `- 一覧は `変更を確認`・`更新`・Git の操作・セッションの終了で取り直す。当初は完了を検知せず、自動では最新にならなかった（2026-10-12 から、完了・許可待ちの検知とウィンドウのフォーカスの復帰でも、記録がある間は自動で取り直す）` にする
   - `- ウィンドウのフォーカスの復帰では一覧を取り直さない` を `- ウィンドウのフォーカスの復帰では一覧を取り直さなかった（2026-10-12 から、記録がある間はエージェントの変更の一覧を取り直す。ソース管理の git status は今も取り直さない）` にする
3. 「実装済み機能」の `### エージェントのセッションの再開と履歴への記録` の節（既知の制約の箇条書きまで）の後、`---` の前に次の節を足す（`<実測の値>` は Task 1 の Step 6 の報告の値で埋める。例: `このリポジトリの写しで約 30〜60 ミリ秒`）:
```markdown
### エージェントの変更の実行ごとの記録と一覧の自動の取り直し

設計書: `docs/superpowers/specs/2026-10-12-agent-changes-runs-and-auto-refresh-design.md`（2026-10-12）。

- [x] プロンプトの `実行`（一覧・変数のフォーム）と、履歴のエージェントのエントリの `再実行` で送るたびに、送る直前に「実行の区切り」の記録を取り、実行 1・実行 2…と番号を振る（新しい方から 10 件を保つ。11 件目を取ったら一番古い実行を捨て、累積の始点は残す）
- [x] ソース管理パネルの「エージェントの変更」の一覧の上の `表示` で、`すべて（累積）` と `実行 N` を選ぶ。実行 N は「その実行の開始 → 次の実行の開始（最後の実行は今まで）」で変わったファイルと差分だけを出し、diff タブのラベルは `<path> (エージェントの変更・実行 N)`
- [x] 実行ごとの表示は見るだけで、行の `↶`・`すべて戻す`・diff タブのハンクの `このハンクを実行前に戻す` は `すべて（累積）` でだけ使える（理由を一覧の上に出し、main でも累積以外の戻す依頼を拒む）
- [x] 区切りを取れなかった実行（未追跡のファイルが多すぎる・打ち切り・git の失敗）は、送信を止めずに実行として足し、その実行と 1 つ前の実行を選べなくする（選択の項目に理由を出す）。選んでいた実行が消えたら `すべて（累積）` に戻して読み上げる
- [x] エージェントの完了・許可待ち・確認待ち（通知と同じ判定。通知の設定に依らない）と、ウィンドウのフォーカスの復帰で、記録がある間だけエージェントの変更の一覧を自動で取り直す（最後の契機から 300ms 待って 1 回にまとめ、最初の契機から 1 秒以内に必ず取り直す。件数は読み上げない）

既知の制約（設計書の「既知の制約」と同じ。実装で分かったものを足した）:
- 実行の区切りは、アプリからエージェントへ送ったとき（一覧・変数のフォームの `実行`、履歴のエージェントのエントリの `再実行`）だけ取る。ターミナルへ直接打ち込んだ指示は区切りにならず、前の実行に含まれる
- 区切りは送信の手順（貼り付け・Enter）の前に取るため、その後の送信が失敗しても実行は 1 つ増える（変更の無い実行になりうる）。送信前の確認をキャンセルしたときは増えない
- 区切りの取得を送信の前に待つのは 10 秒まで。超えると、区切りが終わる前にエージェントが書いた変更は、前の実行ではなくその実行の開始に含まれる
- 送るたびに区切りの取得の分だけ送信が遅れる（<実測の値>）
- 実行は新しい方から 10 件まで。それより古い実行は選べない（累積には残る）
- 記録はウィンドウごとに 1 つで、エージェントのタブごとには分けない。タブ 1 とタブ 2 に交互に送ると、実行はタブをまたいで送った順に並ぶ（選択の項目にタブ名は出さない）。複数のタブのエージェントが並行して動くと、実行 N の範囲に別のタブのエージェントの変更も混ざる
- 途中の実行で、両端で ignore されていた（記録の時点に ignore 済みだった）ファイル・中身を記録していない入れ子のリポジトリは、中身が変わっても一覧に出ない。実行の途中で現れた・消えた ignore 済みのファイルも、累積の一覧と同じく出ない
- 区切りを取れなかった実行と、その 1 つ前の実行は選べない。エージェントが ignore されていない未追跡のファイルを 5,000 件を超えて作る（`node_modules` など）と、それを消すか ignore するまで以後の区切りも取れない
- 実行ごとの表示は見るだけで、戻す操作は累積の表示でだけ使える。任意の 2 つの実行の比較はできない
- 途中の実行の一覧は、新しいフォルダを 1 行にまとめず、ファイルごとの行になる（500 行で打ち切る）
- 実行の中の利用者の編集（アプリの外を含む）は、その実行の変更として出る。`あなたの保存を含む` の印は累積の表示でだけ出る
- 区切りの記録のために、変わったファイルの blob と tree を利用者のリポジトリの object の DB に書く（到達できない object として既定の gc で 2 週間の後に消える）。`git gc --prune=now` などの後は、途中の実行が表示できない
- 前の記録で追跡していた 5MB を超えるファイルを、記録の後に利用者が `git rm --cached` すると、区切りはそのファイルを記録し続ける（累積の始点の記録の取り方〈利用者の index から〉とは扱いが違う）
- 自動の取り直しは、活動の判定（画面の読み取り）が完了・許可待ちと判定したときと、ウィンドウのフォーカスの復帰のときだけ。判定が外れたとき（判定できない画面・描画の間にまとまった変化）は取り直さない。git status（ソース管理の一覧）は自動では取り直さない
- フォーカスの復帰の自動の取り直しは、エージェントの作業中でも走る（書きかけの状態の一覧が出ることがある）
```
   実機の結果（Step 3 の L-059 の項目）で設計書の前提と違う挙動が分かったら、ここの既知の制約に追記する（ユーザーの実機確認の後でよい。このタスクでは上の内容だけを書く）。

- [ ] **Step 2: 設計書（前の 2026-10-06 と今回の 2026-10-12）に注記する**

`docs/superpowers/specs/2026-10-06-agent-changes-review-design.md`:
1. 「いつ「完了」とするか」の節の `ウィンドウのフォーカスの復帰では取り直さない（既存のソース管理も取り直さない。…この機能の後の候補）。` の段落の次に、次の段落を足す:
```markdown
> その後の変更（2026-10-12）: `2026-10-12-agent-changes-runs-and-auto-refresh-design.md` で、上の 4 つに「活動の出来事（完了・許可待ち・確認待ち）」と「ウィンドウのフォーカスの復帰」の 2 つを足して 6 つにした（記録がある間だけ、エージェントの変更の一覧を待ち 300ms・上限 1,000ms で合流して取り直す。ソース管理の git status は今も取り直さない）。上の「4 つに限る」と「フォーカスの復帰では取り直さない」は、この設計書の時点の決定として残す。
```
2. 「既知の制約（設計時点の項目に、実装で分かったものを追記した）」の `- ウィンドウのフォーカスの復帰では一覧を取り直さない` を `- ウィンドウのフォーカスの復帰では一覧を取り直さない（2026-10-12 の実行ごとの記録と一覧の自動の取り直しで、記録がある間は取り直すように変えた。git status は今も取り直さない）` にする。
3. 「この機能の後の候補」の 3 行に、実装した旨を足す:
   - `- 完了・許可待ちの検知（…）と連動した、一覧の自動の取り直し・通知` の末尾に `（一覧の自動の取り直しは 2026-10-12 に実装。通知は「エージェントの完了・許可待ちの通知」で実装済み）`
   - `- 実行ごとの記録（実行 1・実行 2 を選んで比べる）。…` の末尾に `（2026-10-12 に実装）`
   - `- ウィンドウのフォーカスの復帰での、ソース管理とエージェントの変更の取り直し` の末尾に `（エージェントの変更の取り直しは 2026-10-12 に実装。ソース管理は未実装）`

3. 今回の設計書 `docs/superpowers/specs/2026-10-12-agent-changes-runs-and-auto-refresh-design.md` の「範囲ごとの一覧と diff」→「一覧」の `between` の箇条書きの、`ignoredAtBaseline`・`skippedRepos` の扱いの文（`…有無だけで見て、終わりにだけある → A、始まりにだけある → D の notRecorded にし、…`）の後に、次の注記を足す:
```markdown
> 計画の時点で変えた細部（実装プラン `2026-10-12-agent-changes-runs-and-auto-refresh.md`）: `ignoredAtBaseline` は、片方の端にだけあっても行にしない（累積の一覧と同じく、ignore されたファイルの出現・削除は出さない）。`A`・`D` の行にするのは `skippedRepos`（コミットの無い入れ子のリポジトリ）だけ。tree の差分に出たパスのうち、どちらかの端で記録しなかったものは `M` の `notRecorded` の 1 行にする。
```

- [ ] **Step 3: 実機テスト仕様書**

- 最大の番号を確かめる: `grep -o 'AGC-[0-9]*' docs/manual-test-spec.md | sort -t- -k2 -n | tail -1`（計画の時点では `AGC-038`。違えばその次から振り、下の項目の中の相互参照〈`AGC-039` など〉も合わせて直す）。
- `grep -n '^## \|^### ' docs/manual-test-spec.md` で、`### ハンクを戻した後のフォーカスの予約と、失敗の読み上げの回数` が `## エージェントの変更の確認` の最後の `###` であることを確かめる（後ろに別の `###` が増えていれば、その領域の最後の `###` の後に足す）。
- その節の最後の項目（`AGC-038`）の後、`## ソース管理（基本）` の前に、次の 2 節を足す（書式は `- [ ] **<ID>** <手順> → <期待結果>`、1 行 1 項目。上から順に実行でき、各項目の後始末が次の項目の前提を壊さないように並べてある）。
- 設計書「エラー処理」の各行との対応（L-297）:
  - 区切りの取得の失敗（上限）→ AGC-047。区切りの取得の失敗（git）・写しの元が無い → AGC-048。打ち切り（10 秒）は画面から確実には通せないため、Task 1 の結合テスト（`write-tree` の打ち切り）で確かめる
  - 区切りの取得中の `確認を終える`・フォルダの切り替え → 取得は 0.1 秒程度で画面から確実には通せないため、Task 3 の単体テストで確かめる
  - 範囲の実行が消えた（`run-missing`）→ AGC-049
  - 選べない範囲の依頼（写しが古い）・範囲・`trigger` の形が不正・戻す系の IPC に実行の範囲 → 画面からは通らない（ボタンを押せない・選べない項目は `disabled`）。Task 4 の handler の単体テストと結合テスト（変異で落ちることも確かめる）、Task 5 の hook のテストで確かめる。押せないことの画面の確認は AGC-040
  - 途中の実行の blob・tree が消えた → AGC-046。自動の取り直しの失敗（同じ文言のまま読み上げ直さない）→ AGC-046 の後半
  - 実物の `claude` の活動の移り変わりと、区切りが送信に入る時間（L-059・設計書の未確認事項 4）→ AGC-054・AGC-055（時間を記録させる）
- 既知の制約のうち画面から確かめられるもの: ターミナルへ直接打ち込んだ指示 → AGC-044、送信前の確認のキャンセル → AGC-045、送信の失敗 → AGC-045、履歴の `再実行` → AGC-050、複数のタブ → AGC-051、`あなたの保存を含む` → AGC-042
```markdown
### 実行ごとの記録

> 前提: この領域の冒頭の前提（テスト用のリポジトリ・`claude` の起動・`実行` で送る）と同じ。テスト用のリポジトリを作り直して開き、ソース管理パネルの「エージェントの変更」が記録の無い状態（`いまから記録する` が出ている）から始める。指示は「プロンプト」パネルにプロンプトとして登録して `実行` で送る（毎回、作業の終わり〈`claude` が入力を待つ状態〉を待ってから次へ進む）。
> 前提: 期待結果の `HH:MM` は、その実行を送った時刻（時:分）で読み替える。
> 前提: 実装の自動テストでは、実物の `claude` も Electron の画面も使っていない。期待と違ったら、その画面（選択の項目・一覧・diff タブ）と `git status --porcelain` の出力を記録する。

- [ ] **AGC-039** `実行` で「a.txt の最後に run1 という行を足して」を送り、続けて「b.txt の最後に run2 という行を足し、a.txt の 1 行目の one を ONE に変えて」を送ってから、「エージェントの変更」の一覧の上の `表示` の選択を開く。続けて `実行 1` を選んで一覧の `a.txt` を押し、`実行 2` を選んで一覧の `a.txt` を押し、最後に `すべて（累積…）` を選ぶ → 選択の項目は上から `すべて（累積・HH:MM から）`・`実行 2（HH:MM から）`・`実行 1（HH:MM〜HH:MM）` の 3 つ。`実行 1` では一覧が `M a.txt` だけで、diff の変更の行は `+run1` だけ。`実行 2` では一覧が `M a.txt`・`M b.txt` で、`a.txt` の diff の変更の行は `-one`・`+ONE` だけ（`run1` の行は変更ではなく文脈として出る）。見出しは `実行 2` のとき `エージェントの変更 (2)（実行 2・HH:MM から）`。`すべて` に戻すと `a.txt`・`b.txt` の両方の変更が出る
- [ ] **AGC-040** AGC-039 の後、`表示` で `実行 1` を選び、VoiceOver を有効にして一覧の `a.txt` の `↶` と `すべて戻す` に `Tab` で移る。続けて一覧の `a.txt` を押して diff タブを見る → `↶`・`すべて戻す` は押せず、一覧の上に `実行ごとの表示では戻せません。「すべて（累積）」を選ぶと戻せます` が 1 か所だけ出て、VoiceOver ではボタンの説明として同じ理由が読まれる。diff タブのラベルは `a.txt (エージェントの変更・実行 1)` で、ハンクの見出しに `このハンクを実行前に戻す` が無い。`更新` と `確認を終える` は押せる（ここでは押さない）
- [ ] **AGC-041** AGC-040 の後、`表示` で `すべて（累積…）` を選んで一覧の `b.txt` を押し、`b.txt` の diff タブを開いたまま `表示` で `実行 1` を選ぶ。続けて一覧の `a.txt` を押して diff タブを開いたまま `実行 2` を選び、最後に `すべて（累積…）` を選ぶ → `実行 1` を選ぶと `b.txt (エージェントの変更)` の diff タブが閉じる（実行 1 の一覧に `b.txt` が無いため）。`a.txt` の diff タブは閉じずに、`実行 2` を選ぶと内容が実行 2 の差分（`-one`・`+ONE`）に変わり、ラベルが `a.txt (エージェントの変更・実行 2)` になる。`すべて` に戻すとラベルは `a.txt (エージェントの変更)` に戻る
- [ ] **AGC-042** `表示` が `すべて（累積…）` の状態で、`a.txt` をアプリのエディタで開いて 1 行足して保存し、一覧の `a.txt` の行を見てから、`表示` で `実行 2` を選んで同じ行を見る → `すべて` では `a.txt` の行に `あなたの保存を含む` が出る。`実行 2` では出ない（保存は記録ごとに持ち、実行ごとには分けないため）。確かめたら `すべて（累積…）` に戻す
- [ ] **AGC-043** `実行` で「これまでの変更をすべてコミットして（git add -A && git commit -m run3）」を送り、作業の終わりを待ってから、`表示` で `実行 3` を選び、続けて `実行 2` を選ぶ → `実行 3` では一覧の上に `この実行の間に HEAD が変わりました（コミット・ブランチの切り替えなど）` が出る（`戻すのはファイルの内容だけです` は付かない）。`実行 2` ではこの帯が出ない。確かめたら `すべて（累積…）` に戻す
- [ ] **AGC-044** セクションの `確認を終える` を押し、`いまから記録する` を押す。続けて端末で `echo x >> c.txt` を実行し、`実行` で「d.txt を作って」を送る。さらにターミナルの `claude` の入力欄に直接「e.txt を作って」と打ち込んで Enter を押し、作業の終わりを待ってから `更新` を押して、`表示` の項目と `すべて`・`実行 1` の一覧を見る → `表示` の項目は `すべて（累積…）` と `実行 1（HH:MM から）` の 2 つだけ（`確認を終える` の後は番号が 1 から振り直され、`いまから記録する` は実行に数えない）。`c.txt` は `すべて` にだけ出て `実行 1` には出ない。`実行 1` には `A d.txt` と `A e.txt` が出る（ターミナルに直接打ち込んだ指示は区切りにならず、前の実行に含まれる）
- [ ] **AGC-045** `表示` の項目の数を数えてから、プロンプトの `実行` を押して送信前の確認のダイアログで `キャンセル` を押す。続けて `claude` で `/model` の選択の画面を出したまま `実行` を押し、確認で `送信` を押す → キャンセルでは項目の数が変わらない。送信の失敗（`エージェントの入力欄が見つかりません…`）では `実行 2` が増える（区切りは送信の手順の前に取るため。既知の制約）。確かめたら `claude` の画面をクリックして `Esc` で選択の画面を閉じる
- [ ] **AGC-046** `実行` で「f.txt を作って」を送ってから、アプリの外の端末で `git gc --prune=now` を実行してアプリに戻り（`Cmd+Tab`）、`表示` で `実行 1`（途中の実行）を選ぶ。続けてもう一度アプリの外へ移ってから戻る → `実行 1` を選ぶと `実行前の内容が見つかりません（git gc などで消えた可能性があります）` がセクションに出る（`f.txt` などのファイルは消えない）。外へ移って戻っても（自動の取り直しが同じ失敗をする）、同じ文言のまま出続け、VoiceOver で読み上げ直されない。確かめたら `確認を終える` を押す
- [ ] **AGC-047** 記録が無い状態で、`実行` で「g.txt を作って」を送り、端末で `mkdir many && for i in $(seq 1 5001); do : > many/$i.txt; done` を実行してから `実行` で「h.txt を作って」を送り、`表示` の選択を開く。続けて端末で `rm -rf many` を実行してから `実行` で「i.txt を作って」を送り、もう一度開く → 2 回目の送信もされ、`h.txt` が作られる。項目の `実行 2（HH:MM・開始の状態を記録できませんでした: 未追跡のファイルが多すぎます）` と `実行 1（HH:MM〜・次の実行の開始を記録できなかったため比べられません）` は淡色で選べない。`rm -rf many` の後に送った `実行 3（HH:MM から）` は選べ、一覧に `A i.txt` が出る。確かめたら `確認を終える` を押す
- [ ] **AGC-048** 記録が無い状態で、`実行` で「j.txt を作って」を送り、端末で `rm -rf "$TMPDIR"/prompt-ide-agent-baseline-*`（記録の一時ディレクトリを消す）を実行してから `実行` で「k.txt を作って」を送り、`表示` の選択を開く → 送信はされ、`k.txt` が作られる。項目の `実行 2` に `開始の状態を記録できませんでした: git を実行できませんでした` が含まれて選べない（記録の写しの元が無いときに、空から記録して全ファイルを追加として見せない）。`すべて` の一覧は `記録が見つかりません` で取れない。確かめたら `確認を終える` を押す
- [ ] **AGC-049** 記録が無い状態で、`実行` で「r1.txt を作って」を送り、続けて「n.txt に 1 行足して」を 9 回送る（計 10 回）。`表示` で `実行 1` を選び、VoiceOver を有効にしてから、もう 1 回「n.txt に 1 行足して」を送る（計 11 回）→ 11 回目の後、`表示` の項目は `すべて` と `実行 11`〜`実行 2` の 10 件で、`実行 1` が無い。選んでいた範囲は `すべて（累積…）` に戻り、`実行 1 の記録は古くなったため消えました。すべて（累積）を表示します` が読み上げられる。`すべて` の一覧に実行 1 の `A r1.txt` も出る。確かめたら `確認を終える` を押す
- [ ] **AGC-050** 記録が無い状態で、`実行` で「l.txt を作って」を送り、「実行履歴」でいま足されたエージェントのエントリ（`送信済み`）を選んで `再実行` を押し、確認で `送信` を押してから、`表示` の選択を開く → 項目に `実行 2（HH:MM から）` が増える（履歴の `再実行` も区切りを取る）。確かめたら `確認を終える` を押す
- [ ] **AGC-051** ターミナルの `+` で `claude 2` を起動し、記録が無い状態で、`claude 1` のタブを選んで `実行` で「m.txt を作って」を送り、`claude 2` のタブを選んで `実行` で「o.txt を作って」を送ってから、`表示` の選択を開いて `実行 1`・`実行 2` を選ぶ → 項目は `実行 2`・`実行 1` の 2 件で、タブ名は出ない。`実行 1` に `A m.txt`、`実行 2` に `A o.txt` が出る（実行はタブをまたいで送った順に並ぶ）。確かめたら `claude 2` のタブを `×` で閉じ、`確認を終える` を押す
- [ ] **AGC-052** 記録がある状態（`実行` で「p.txt を作って」を送った後）で、ウィンドウの幅を 500px・640px・1280px にして `表示` の選択と項目を見て、VoiceOver で選択に移ってから開く（AGC-047 の状態をもう一度作ると、選べない項目も確かめられる）→ どの幅でも `表示` のラベルと選択が 1 行に収まり、選択の中の長い項目は末尾が切れて（または省略されて）見え、開くと全文が見える。選択の高さは押しやすい大きさ（32px 以上）。VoiceOver では `表示` と選んでいる項目が読まれ、選べない項目は淡色（dimmed）として読まれる。確かめたら `確認を終える` を押す

### 一覧の自動の取り直し

> 前提: 「実行ごとの記録」の節と同じ。ソース管理パネルを開き、「エージェントの変更」が見える状態で行う。完了・許可待ちの通知は、設定の「エージェントの通知」の設定に依らずに一覧を取り直す（通知がオフでも同じ）。

- [ ] **AGC-053** 記録が無い状態で、端末で `echo y >> c.txt` を実行してから、アプリの外（別のアプリ）へ移って戻る（`Cmd+Tab`）→ セクションに `更新中…` が出ず、一覧も出ない（記録が無い間は取り直さない）
- [ ] **AGC-054** `実行` で「q.txt を作って」を送り、何も押さずに作業の終わりを待つ → 完了の読み上げ（VoiceOver）・通知の後、1 秒ほどで一覧に `A q.txt` が出る。件数（`エージェントの変更: N 件`）は読み上げられない。完了の読み上げから一覧が出るまでのおおよその秒数と `claude --version` を記録する（活動の判定のデバウンス + 0.3〜1 秒の見込み。L-059）
- [ ] **AGC-055** `実行` で「r.txt を作ってから、ls を実行して」を送り、`claude` が `ls` の実行の許可を求めて止まったら、許可に答えずに一覧を見る → 許可を求めた時点で一覧が取り直され、`A r.txt` が出ている。`claude` が `ls` の許可を求めずに実行した場合は、許可を求める別のコマンド（例: 「s.txt を作ってから、curl https://example.com を実行して」）で試し、その旨と `claude --version` を記録する。確かめたら許可の画面で `Esc` を押して止める
- [ ] **AGC-056** アプリの外の端末（macOS のターミナル.app など）で `echo z >> b.txt` を実行してから、`Cmd+Tab` でアプリに戻る。続けて端末で `echo z >> a.txt` を実行し、アプリのウィンドウを最小化（`Cmd+M`）してから Dock で戻す → どちらも `更新` を押さずに、一覧に `M b.txt`・`M a.txt` が出る（フォーカスの復帰で取り直す）
- [ ] **AGC-057** `表示` で `実行 1` を選んでから、アプリの外へ移って戻る → 範囲は `実行 1` のままで、一覧は実行 1 の範囲で取り直される（`すべて` に戻らない）。確かめたら `すべて（累積…）` に戻す
- [ ] **AGC-058** ソース管理の「変更」の一覧を見てから、アプリの外の端末で `echo w >> c.txt` を実行してアプリに戻り、もう一度「変更」の一覧を見て、最後にソース管理の `更新` を押す → 戻った直後は「変更」の一覧が変わらない（git status はフォーカスの復帰で取り直さない）。`更新` を押すと `c.txt` の変更が反映される。「エージェントの変更」の一覧には、戻った時点で `c.txt` が出る
```
- 既存の項目のうち、この機能で期待結果が変わるものを直す（ID は変えない）:
  - `AGC-037` の期待結果の末尾（`→ フォーカスは diff タブのタブへ飛ばない（タブにフォーカスの枠が出ない）`）の後に `。続けて `Cmd+Tab` でアプリへ戻っても（一覧の自動の取り直しが走る）、フォーカスは diff タブのタブへ飛ばない` を足す。
- `grep -n '更新` を押す\|`更新` を押して' docs/manual-test-spec.md` で、AGC の項目のうち `更新` を押す手順を見て、自動の取り直しで結果が変わるものが無いことを確かめる（設計書のとおり、自動の取り直しの後に押しても結果が同じため変えない。変える必要があるものが見つかったら、期待結果だけを今の挙動に直し、ID は変えない）。ソース管理（GIT・DSC）の項目は、git status を自動で取り直さないため変えない。

- [ ] **Step 4: HTML の再生成と仕様書の検査**

Run: `node scripts/build-manual-test-spec.mjs && npx vitest run scripts`
Expected: `.superpowers/manual-test-spec.html` が更新され、scripts のテスト（ID の一意性・接頭辞ごとの連番の昇順・書式）が PASS

- [ ] **Step 5: Artifact の再公開（コントローラーが行う）**

実装のサブエージェントは行わない。コントローラー（このプランを実行している親のセッション）が、Artifact ツールで `.superpowers/manual-test-spec.html`（同じファイルパス）を既存の Artifact（<manual-test-spec-artifact-url>）へ再公開する（`url` にこの URL を渡す。この会話でまだ読んでいなければ、先に `action: "read"` で読んでから公開する）。公開の結果の URL が同じであることを確かめる。

- [ ] **Step 6: 全体の検証**

Run: `npx vitest run`
Expected: すべて PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: 下の eslint に渡すのと同じファイルへ `npx eslint --fix <files>`（prettier の 100 桁の折り返しなど、自動で直せるものを先に直す）
Run: `npx eslint --max-warnings 0` に、このプランで作成・変更した TypeScript のファイルをすべて渡す（`git status --porcelain` の `.ts`・`.tsx` の一覧から作る）
Expected: エラー・警告なし
Run: `git status --porcelain`
Expected: 計測の一時ファイル（`agentBaselineSnapshot.timing.local.test.ts`）が無い。コミットはしない
