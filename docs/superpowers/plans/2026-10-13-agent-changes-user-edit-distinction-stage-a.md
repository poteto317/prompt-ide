# エージェントの変更の利用者の編集との区別（段階 A: hooks の受け取りとツールの区間の追跡） 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アプリが起動する `claude` に `--settings <一時ファイル>` で `http` の hooks を渡し、main のループバックの受け口で知らせを受け、ウィンドウ（所有者）ごとに「エージェントのファイルを書くツール・シェルが動いているか」の段階（`idle`・`agent`・`paused` と区別をやめる合図・割り当てられない合図）を追跡して、開発版のログに出す。記録・一覧・画面は変えない（段階 B でつなぐ）。

**Architecture:** main に、イベント名・パス・matcher の定数（新規 `agentHookProtocol.ts`）、設定の JSON と一時ファイル（新規 `agentHookSettings.ts`）、本文の解釈（新規 `agentHookEvents.ts`。純粋な関数）、`127.0.0.1` のランダムなポートの HTTP の受け口（新規 `agentHookReceiver.ts`。トークンの照合・検査・`PreToolUse` の順序と 5 秒の上限）、セッション・ウィンドウごとの区間の追跡（新規 `agentToolActivity.ts`。確かめた状態・猶予・期限切れ・作業中の知らせからの 15 秒）、`claude --version` の確認（新規 `agentClaudeVersion.ts`）、起動ごとの準備・結び付け・解放（新規 `agentHookSessions.ts`）、`will-quit` の後始末（新規 `agentHooksLifecycle.ts`）を置く。starter は `prepare` → spawn → `activate` → 終了で `release` を呼び、`buildAgentLaunchArgs` に `--settings` を足し、`buildAgentEnv` は `NO_PROXY`・`no_proxy` にループバックを足す。renderer は新しい hook `useAgentHooksWorkingReport` で、タブの活動が `working` に変わったときだけ pty の sessionId を `agentTerminal:reportWorking` で main へ送る。

**Tech Stack:** Electron（main・preload）, React 19, TypeScript, Node の `node:http`・`node:crypto`・`node:fs/promises`・`node:child_process`（`execFile`）, Vitest（偽のタイマー・実際の listen・一時ディレクトリの実ファイル）, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md`（承認済み。実装の前に必ず読む。このプランは「実装の分割」の **段階 A だけ**。段階 B〈写しによる判定・行の印・`すべて戻す`・IPC の型・renderer の表示〉は含めない）。前提の設計書 `docs/superpowers/specs/2026-10-04-agent-terminal-mvp-design.md`・`docs/superpowers/specs/2026-10-11-agent-session-resume-design.md`・`docs/superpowers/specs/2026-10-09-agent-session-activity-design.md`。

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
> - 定数（イベント名の列挙型・パス・matcher・ツールの名前・hook の `timeout`）は、設定・受け口・解釈の 3 つが使うため、新規 `src/main/agentHookProtocol.ts` にまとめる（Task 2）。設計書の「構成」に無いファイルだが、責務は定数と純粋な対応表だけ。
> - `AgentHookEvent` は、設計書ではツールのイベントの要素だけが `toolName` を持つが、**すべての要素に `toolName: string | null` を持たせる**（ツール以外のイベントは常に `null`）。判別共用体の扱いを簡単にし、開発版のログを 1 つの関数で書くため。区間の判定には使わない点は同じ。
> - 解釈の関数は `parseAgentHookRequest(pathEvent, body): { event; notes }` とし、ログに出す理由（`unreadable-body`・`event-name-mismatch`・`unknown-tool-name`・`bad-agent-id`）を `notes` で返す（純粋な関数のまま「ログに残す」を満たす。ログは受け口が件数で出す）。本文は `AgentHookBody = { kind: 'text'; text } | { kind: 'too-large' } | { kind: 'unreadable' }`。**本文の読み込みが途中で失敗した（接続の切断・要求の打ち切り）要求も、照合は通っているので `unreadable` として `deliver` する**（`PreToolUse` を捨てると、そのツールの書き込みが利用者の区間に入る。L-002）。
> - `agent_id` は、**欄が無い（`undefined`）ときだけ「無い」（`null`）**とし、`null` を含むそれ以外の値は 1〜256 文字の文字列でなければ「形が違う」とする。Task 1 の実測で、メインのエージェントの知らせが `agent_id: null` を送ると分かったら、Task 3 で「`null` も無いとみなす」に直し、テストの期待値も直す。
> - 受け口の依存に、テスト用の `preToolUseWaitMs?: number`（既定 `AGENT_PRE_TOOL_USE_WAIT_MS` = 5,000）を足す。実際の listen のテストで 5 秒を実時間で待たないため。既定値はテストで定数を固定する。`onToolStart` が reject したときは、ログを出して応答し、`onToolStartTimedOut` は呼ばない。
> - 追跡の依存は `{ onPhaseChange, devLog, warn }`（`devLog: ((line: string) => void) | null`。`null` で開発版のログを出さない。`warn` は常に出すログ）。タイマーは依存で注入せず、グローバルの `setTimeout`・`clearTimeout`・`Date.now` を使い（すべて `unref`）、テストは `vi.useFakeTimers()` で進める。ツールの開始の通し番号は、所有者のセッションが 0 になっても消さない（段階 B の比較で 0 に戻って同じ値にならないため）。
> - 作業中の知らせの「そのウィンドウに無いセッション」の扱い（捨ててログ）は、追跡の `reportWorking` の中で `warn` を出す（handler は送信元の確認と形の検証だけ）。
> - 設計書の段階 A のタスク 6（起動への組み込み）は大きいため、**Task 6（`agentClaudeVersion`・`agentHookSessions`）と Task 7（`buildAgentLaunchArgs`・`buildAgentEnv`・starter・`agentHooksLifecycle`・`ipcHandlers` の組み立て・結合テスト）に分ける**。最終タスクは Task 8。
> - 追跡は Task 5 で `ipcHandlers.ts` に組み立てる（handler の依存 `reportWorking` が必須のため。段階の通知 `onPhaseChange` は何もしない関数）。受け口・`agentHookSessions` などは Task 7 で足す。Task 5〜6 の間、追跡にセッションは登録されず、作業中の知らせは「セッションが見つかりません」の `warn` で捨てられる（main に入れる前の途中の状態。Task 7 で解消）。
> - `PreparedAgentHooks` は判別共用体（`hooks` があれば `unavailableReason: null`、無ければ理由が必須）にする。版の確認は `createClaudeVersionReader(deps).readClaudeVersion(plan)` と純粋な `parseClaudeVersion`・`supportsHttpHooks` に分ける。
> - 実機テスト仕様書の段階 A の項目は、設計書の「実機テスト仕様書の方針」の 14 項目を AGC-088〜AGC-101 として足す（Task 8）。

## Global Constraints

- コメント・文言・ログは日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`（このプランに新しいコンポーネントは無い）
- **コミットしない。** 各タスクの最後は検証だけ（`npx vitest run <変更したテスト>`、`npm run typecheck`、変更・作成した TypeScript のファイルへの `npx eslint --fix <ファイル>` → `npx eslint --max-warnings 0 <ファイル>`）
- **段階 A は記録・一覧・画面を変えない。** `src/main/agentBaselineRegistry.ts`・`agentChanges*.ts`・`src/shared/types/agentChanges.ts`・`src/renderer/src/components/source-control/*` は触らない
- **トークン（64 桁の 16 進）は、main のメモリと設定のファイル（0600）にだけ置く。** 起動の引数・環境変数・renderer・ログ・応答の本文に出さない（L-017・L-019）。ログに本文・`tool_input`・パス（設定のファイルの削除の失敗のパスを除く）を出さない
- 定数（値は設計書から写す。後のタスクはこの名前と値で使う）:
  - `agentHookProtocol.ts`: `AGENT_HOOK_PATH_PREFIX = '/prompt-ide/agent-hooks/v1/'`、イベント名とパスの対応 `UserPromptSubmit`→`user-prompt-submit`・`PreToolUse`→`pre-tool-use`・`PostToolUse`→`post-tool-use`・`PostToolUseFailure`→`post-tool-use-failure`・`SubagentStop`→`subagent-stop`・`Stop`→`stop`・`StopFailure`→`stop-failure`・`SessionEnd`→`session-end`、`AGENT_HOOK_TOOL_NAMES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell']`、`AGENT_HOOK_TOOL_MATCHER = 'Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell'`、`AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS = 10`、`AGENT_HOOK_TIMEOUT_SECONDS = 5`
  - `agentHookSettings.ts`: `AGENT_HOOK_SETTINGS_DIR_PREFIX = 'prompt-ide-agent-hooks-'`（`<os.tmpdir()>/prompt-ide-agent-hooks-XXXXXX`、0700）、ファイル名は `randomBytes(16).toString('hex') + '.json'`（`wx`・0600）
  - `agentHookReceiver.ts`: `AGENT_PRE_TOOL_USE_WAIT_MS = 5_000`、`AGENT_HOOK_MAX_BODY_BYTES = 16 * 1024 * 1024`、`AGENT_HOOK_HEADERS_TIMEOUT_MS = 5_000`、`AGENT_HOOK_REQUEST_TIMEOUT_MS = 15_000`
  - `agentToolActivity.ts`: `AGENT_TOOL_END_GRACE_MS = 2_000`、`AGENT_TOOL_INTERVAL_MAX_MS = 15 * 60 * 1000`、`AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS = 15_000`、`AGENT_TOOL_OPEN_MAX = 256`、`AGENT_DROPPED_TOOL_IDS_MAX = 1_024`
  - `agentClaudeVersion.ts`: `AGENT_HOOKS_MIN_CLAUDE_VERSION = [2, 1, 101]`、`CLAUDE_VERSION_TIMEOUT_MS = 5_000`、`CLAUDE_VERSION_KILL_GRACE_MS = 1_000`、`CLAUDE_VERSION_MAX_OUTPUT_BYTES = 4_096`
- 受け口の検査の順序と応答: メソッドが `POST`（405 `method`）→ パスが `/prompt-ide/agent-hooks/v1/<8 つのどれか>` の完全一致（404 `path`）→ `Host` が `127.0.0.1:<ポート>`（403 `host`）→ `Origin` が無い（403 `origin`）→ `Authorization` が `Bearer <64 桁の小文字の 16 進>` で、その SHA-256 の表に生きているセッションがある（401 `token`）→ `Content-Type` が `application/json` で始まる（大文字小文字を区別しない。415 `content-type`）。応答はどれも本文の無い `Content-Length: 0`。拒んだ理由ごとの件数を、最初の 1 件と 100 件ごとに `[agent-hooks] 拒んだ要求: <理由> <件数> 件` でログに出す（16 MiB を超えた本文は `too-large` として同じログに数える）
- IPC: renderer → main の `agentTerminal:reportWorking`（`ipcRenderer.send`。引数は pty の sessionId だけ）。preload は `reportAgentSessionWorking(sessionId: string): void`、renderer の窓口は `lib/agentTerminalApi.ts` の `reportAgentSessionWorking(sessionId)`
- 開発版のログ（`!app.isPackaged` のときだけ）: `[agent-hooks] owner=<id> session=<sessionId の先頭 8 桁か -> event=<イベント名か 起動・終了・作業中・確認の待ちの終わり・猶予の終わり・interval-expired> tool=<名前か -> id=<あり|なし|-> agent=<あり|なし|-> hooks=<pending|confirmed|unconfirmed(<理由>)|-> phase=<前>→<後>`
- テストの規約: タイマー（`vi.useFakeTimers()`）は `afterEach` で `vi.useRealTimers()` まで戻す（CLAUDE.md のタイマーリークの防止）。`act(...).then(...)` で書かない。`console.*` の spy は `afterEach` で戻す。テストの補助関数にも戻り値の型を書く（`@typescript-eslint/explicit-function-return-type`）。実際に listen するテストは `afterEach` で必ず `close()` する。一時ディレクトリは `mkdtempSync(join(tmpdir(), ...))` で作り `afterEach` で `rmSync(..., { recursive: true, force: true })` する
- 実装を戻すとテストが落ちることを、各タスクの TDD の手順（失敗するテストを先に書いて走らせる）で確かめる

### 気をつける知見（dev-flow-kit の `lessons/review-lessons.md`。設計書の「反映した知見」のうち段階 A に当たるもの）

- **L-001**（受け口の開始・設定のファイルの書き込みの失敗を、起動の結果〈`hooks: null`・`unconfirmed`〉に反映する）: Task 6・7
- **L-002**（届かない知らせを「ツールが動いていない」と読まない。`pending` は `agent` に倒す。読めない `PreToolUse` も区間を開く。本文の読み込みの失敗も捨てない）: Task 3・4
- **L-004**（起動しなかったときは自分が書いた設定のファイルだけを消す。`wx` の `EEXIST` で他者のファイルを消さない）: Task 2・7
- **L-006**（知らないツールの名前の `PostToolUse` を区間を閉じる根拠にしない）: Task 3
- **L-010**（`will-quit` の後始末は 1 つが失敗しても残りを試す）: Task 7
- **L-017**（トークン・本文をログ・応答に出さない。拒んだ要求は理由の件数だけ）: Task 3・6
- **L-019**（起動の引数・環境・設定・URL・トークンは main が決める。renderer からの新しい IPC は sessionId だけで、送信元のウィンドウのセッションに限る）: Task 5・7
- **L-023**（本文の `hook_event_name` とパスのイベントを照らし合わせる）: Task 3
- **L-034**（`--settings` の値は main が作った絶対パスだけ。`-`・`{` で始まらない）: Task 2・7
- **L-044**（形の違う `agent_id`・知らない `tool_name` の `PostToolUse` を区間を閉じる根拠にしない。読めない `tool-end`・外した ID の遅れた `tool-end` で別の区間を閉じない。不正な sessionId を捨てる）: Task 3・4・5
- **L-045・L-059**（hooks の設定の形はドキュメントで決め、Task 1 の実物の測定で確かめる。使えなければそこで止める。設定の JSON をテストで完全一致に固定する）: Task 1・2
- **L-052**（`PreToolUse` の待ち 5 秒・hook の `timeout`・開いたままの区間の 15 分・作業中の知らせからの 15 秒・要求の打ち切り・`claude --version` の打ち切りと強制終了に上限を持たせる）: Task 3・4・6
- **L-060**（`buildAgentLaunchArgs` の引数・starter の依存 `hooks`・受け口の `onToolStart`・`onToolStartTimedOut`・handler の `reportWorking`・`useAgentHooksWorkingReport` の引数を必須にする）: Task 3・5・7
- **L-061**（新しい状態「ウィンドウの段階」の入口〈起動・終了・知らせ・作業中の知らせ・`before-quit`/`will-quit`〉をすべて扱う）: Task 4・7
- **L-427**（`claude --version` の一時的な失敗〈打ち切り・起動の失敗・0 でない終了〉は控えず、次の起動で確かめ直す）: Task 6
- **L-428**（セッションの設定のファイルは終了で消し、残ったものは `will-quit` でディレクトリごと消す）: Task 2・7

### ファイルの構成（作る・変えるもの）

| ファイル | 責務 | タスク |
| --- | --- | --- |
| `docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md` | 確認の結果 15（実測）の追記 | 1 |
| `src/main/agentHookProtocol.ts`（新規） | イベント名の型・パスの対応・matcher・ツールの名前・hook の `timeout` | 2 |
| `src/main/agentHookSettings.ts`（新規） | 設定の JSON の組み立て、ファイルの書き込み・削除、`createAgentHookSettingsDir` | 2 |
| `src/main/agentHookEvents.ts`（新規） | 本文とパスの解釈（純粋な関数） | 3 |
| `src/main/agentHookReceiver.ts`（新規） | HTTP の受け口・検査・拒んだ理由の件数のログ・トークンの表・`PreToolUse` の順序と 5 秒の上限 | 3 |
| `src/main/__tests__/helpers/agentHookHttp.ts`（新規） | テスト用の HTTP の要求（`node:http`） | 3 |
| `src/main/agentToolActivity.ts`（新規） | 区間・確かめた状態・タイマー・ウィンドウの段階・通し番号・開発版のログ | 4 |
| `src/main/handlers/agentTerminalHandlers.ts` | `agentTerminal:reportWorking`・依存 `reportWorking` | 5 |
| `src/preload/api.ts`・`src/preload/index.d.ts` | `reportAgentSessionWorking` | 5 |
| `src/renderer/src/lib/agentTerminalApi.ts` | `reportAgentSessionWorking` | 5 |
| `src/renderer/src/hooks/useAgentHooksWorkingReport.ts`（新規）・`useAgentWorkspace.ts` | 作業中の知らせ | 5 |
| `src/renderer/src/__tests__/setup.ts` | `window.api` の偽物に `reportAgentSessionWorking` | 5 |
| `src/main/ipcHandlers.ts` | 追跡の組み立て（Task 5）、受け口・版の確認・`agentHookSessions`・後始末・starter の `hooks`（Task 7） | 5・7 |
| `src/main/agentClaudeVersion.ts`（新規） | `claude --version` の実行・解釈・判定・控え | 6 |
| `src/main/agentHookSessions.ts`（新規） | starter に注入する `prepare`・`activate`・`release` | 6 |
| `src/main/agentCommand.ts` | `buildAgentLaunchArgs` の 3 つ目の引数と説明、`buildAgentEnv` の `NO_PROXY` | 7 |
| `src/main/agentSessionStarter.ts` | 依存 `hooks` と `prepare`・`activate`・`release` の呼び出し | 7 |
| `src/main/agentHooksLifecycle.ts`（新規） | `setupAgentHooksLifecycle`（`will-quit` の後始末） | 7 |
| `src/main/__tests__/helpers/fakeAgentHookSessions.ts`（新規） | starter・handler のテスト用の偽の `hooks` | 7 |
| `ROADMAP.md`・`docs/superpowers/specs/2026-10-04-agent-terminal-mvp-design.md`・`docs/manual-test-spec.md` | 記録の更新と実機テスト仕様書 | 8 |

---

### Task 1: 実測（未確認事項 1・2・4・6）

> **気をつける知見:** L-045・L-059（実物の claude で確かめ、使えなければ止める）

> **止める条件: `--settings <ファイル>` で渡した `http` の hook の知らせが、手元の `claude`（2.1.291）から 1 件も届かない、または `claude` が設定のファイルを拒んだ（`--settings` の `http` の hook を受け付けない）と分かったら、ここで止めて報告する。Task 2 以降に進まない**（`command` の hook に切り替えるかは、設計の選択としてコントローラーが利用者に聞く）。`PreToolUse` の応答の待ちが効かない・`UserPromptSubmit` だけが届かないなど、`http` の hook は届くが設計の前提と違う点は、止めずに報告に書き、確認の結果に記録する。

**Files:**
- 作業場所（git 管理外。消さなくてよい）: scratchpad `S=$SCRATCHPAD/hooks-probe`
- 一時ファイル（計測の後に消す。コミットしない）: `src/main/__tests__/agentHookTiming.local.test.ts`
- Modify: `docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md`（「確認の結果」の 14 の後に 15 を足す。「未確認事項」の 1・2・4・6 の末尾に `（段階 A のタスク 1 で確かめた。確認の結果 15）` を足す）

**Interfaces:**
- Consumes: 手元の `claude`（`$HOME/.local/bin/claude`、`2.1.291 (Claude Code)`）、`recordBaseline`・`recordBaselineFrom`・`createAgentBaselineRepo`・`disposeAgentBaselineRepo`（`src/main/__tests__/helpers/agentBaselineFixtures.ts`）、`writeRepoFile`・`commitAll`（`src/main/__tests__/helpers/realGitRepo.ts`）
- Produces: 確認の結果 15（`Host`・`Content-Type`・`Authorization` の実際の値、届いたイベントと `tool_name`・`tool_use_id`・`agent_id` の形、`PreToolUse` の応答の待ちが効くか、`PostToolBatch` の有無と届く時点、`claude --version` の出力と時間、区切りの時間、プロキシの環境での届き方、ファイアウォールの状態）。Task 3 はこの値で受け口の検査を決める

**実物の `claude` を起動する点について:** Step 3・4 は、利用者の `claude` のアカウントで API を呼ぶ（プロンプトを合わせて 2 回送る）。実装者はこの手順を実行してよいが、送るプロンプトは **`ls を実行して` だけ**にする（ファイルを書かせない・ネットワークを使わせない）。`claude` は必ず scratchpad の中の使い捨てのリポジトリ（`$S/repo`）を作業ディレクトリにして起動し、このリポジトリ（`<repo-root>`）では起動しない。Step 5 のプロキシの確かめは、存在しないプロキシ（`127.0.0.1:9`）を指すため API の要求は失敗し、課金の対象にならない。

- [ ] **Step 1: 作業場所と測定用の受け口を用意する**

```bash
S=$SCRATCHPAD/hooks-probe
mkdir -p "$S/repo" && cd "$S/repo" && git init -q -b main && printf 'one\n' > a.txt && git add a.txt && git -c user.name=t -c user.email=t@example.com commit -qm init
```

`$S/hook-probe.mjs` を作る（測定用。本番のコードではない）:
```js
// 使い方: node hook-probe.mjs <出力先のディレクトリ> <base|batch>
// 環境変数 PRE_TOOL_USE_DELAY_MS(既定 0)だけ pre-tool-use の応答を遅らせる。標準出力の 1 行目に {port, settingsPath} を出す
import { createServer } from 'node:http'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const dir = process.argv[2]
const variant = process.argv[3] ?? 'base'
const delayMs = Number(process.env.PRE_TOOL_USE_DELAY_MS ?? '0')
const token = randomBytes(32).toString('hex')
const logPath = join(dir, `probe-${variant}.jsonl`)
const write = (entry) => appendFileSync(logPath, JSON.stringify(entry) + '\n')

const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    let body = null
    try {
      body = JSON.parse(raw)
    } catch {
      body = null
    }
    write({
      receivedAt: Date.now(),
      method: req.method,
      url: req.url,
      host: req.headers.host ?? null,
      contentType: req.headers['content-type'] ?? null,
      origin: req.headers.origin ?? null,
      authorizationMatches: req.headers.authorization === `Bearer ${token}`,
      userAgent: req.headers['user-agent'] ?? null,
      bytes: raw.length,
      hookEventName: body?.hook_event_name ?? null,
      toolName: body?.tool_name ?? null,
      toolUseId: typeof body?.tool_use_id === 'string' ? body.tool_use_id : `(${typeof body?.tool_use_id})`,
      agentId: body !== null && 'agent_id' in body ? body.agent_id : '(欄なし)',
      keys: body === null ? null : Object.keys(body)
    })
    const send = () => {
      res.writeHead(200, { 'Content-Length': '0' })
      res.end()
      write({ respondedAt: Date.now(), url: req.url })
    }
    if (req.url?.endsWith('/pre-tool-use') && delayMs > 0) setTimeout(send, delayMs)
    else send()
  })
})

server.listen({ host: '127.0.0.1', port: 0 }, () => {
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}/prompt-ide/agent-hooks/v1/`
  const httpHook = (segment, timeout = 5) => ({
    type: 'http',
    url: base + segment,
    headers: { Authorization: `Bearer ${token}` },
    timeout
  })
  const matcher = 'Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell'
  const hooks = {
    UserPromptSubmit: [{ hooks: [httpHook('user-prompt-submit')] }],
    PreToolUse: [{ matcher, hooks: [httpHook('pre-tool-use', 10)] }],
    PostToolUse: [{ matcher, hooks: [httpHook('post-tool-use')] }],
    PostToolUseFailure: [{ matcher, hooks: [httpHook('post-tool-use-failure')] }],
    SubagentStop: [{ hooks: [httpHook('subagent-stop')] }],
    Stop: [{ hooks: [httpHook('stop')] }],
    StopFailure: [{ hooks: [httpHook('stop-failure')] }],
    SessionEnd: [{ hooks: [httpHook('session-end')] }]
  }
  if (variant === 'batch') {
    // 未確認事項 6: PostToolBatch の有無と、利用者の PostToolUse の command の hook(3 秒かかる)の後に届くか
    hooks.PostToolBatch = [{ hooks: [httpHook('post-tool-batch')] }]
    hooks.PostToolUse[0].hooks.push({ type: 'command', command: `sleep 3 && touch "${join(dir, 'posthook-done')}"` })
  }
  const settingsPath = join(dir, `settings-${variant}.json`)
  writeFileSync(settingsPath, JSON.stringify({ hooks }), { mode: 0o600 })
  console.log(JSON.stringify({ port, settingsPath }))
})
```

- [ ] **Step 2: `claude --version` の出力と時間を測る（未確認事項 1）**

Run: `for i in 1 2 3; do /usr/bin/time -p $HOME/.local/bin/claude --version; done 2>&1`
Expected: `2.1.291 (Claude Code)` が 3 回出る。`real` の秒数を控える（5 秒の打ち切りに十分な余裕があるか）。出力の形が `<数>.<数>.<数>` で始まらなければ報告に書く（Task 6 の `parseClaudeVersion` の前提）。

Run: `/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate`
Expected: ファイアウォールの状態（有効・無効）を控える（読むだけ。設定は変えない。未確認事項 4 の Electron での確認ダイアログの有無は実機テスト仕様書で見る）。

- [ ] **Step 3: 本番と同じ 8 つの hooks で、プロンプトを 1 回送る（未確認事項 1・2。API を 1 回使う）**

測定用の受け口を、`PreToolUse` の応答を 3 秒遅らせて背景で起動する（Bash の `run_in_background`）:
```bash
cd "$S" && PRE_TOOL_USE_DELAY_MS=3000 node hook-probe.mjs "$S" base > "$S/probe-base.out"
```
`cat "$S/probe-base.out"` で `settingsPath` を確かめてから、`claude` を `-p`（応答を出して終わる）で起動する（Bash の `timeout` を 180000 にする）:
```bash
cd "$S/repo" && $HOME/.local/bin/claude -p "ls を実行して" \
  --settings "$S/settings-base.json" \
  --allowedTools "Bash(ls:*)" \
  --no-session-persistence \
  --debug-file "$S/claude-debug-base.log" > "$S/claude-base.out" 2>&1; echo "exit=$?"
```
終わったら測定用の受け口を止める（`pgrep -fl "hook-probe.mjs $S base"` で対象を確かめてから、その pid を `kill`）。

確かめること（`cat "$S/probe-base.jsonl"`・`grep -i hook "$S/claude-debug-base.log" | head -50`）:
1. 届いたイベントの並び（`UserPromptSubmit` → `PreToolUse` → `PostToolUse` → `Stop` → `SessionEnd` の想定）。**1 件も届かず、デバッグのログに設定・hooks の拒否や `http` の hook の不正のエラーがあれば、ここで止めて報告する**（届かない原因がデバッグのログから分からないときも止めて、ログの該当部分を報告する）
2. `host`（`127.0.0.1:<ポート>` か）・`contentType`（`application/json` で始まるか）・`origin`（`null` か）・`authorizationMatches`（`true` か）・`userAgent`
3. `toolName`（`Bash` か）・`toolUseId` の形（文字列か。長さ・先頭の文字）・`agentId`（メインのエージェントで `(欄なし)` か `null` か）・`keys`
4. `PreToolUse` の `respondedAt` と、その次の `PostToolUse` の `receivedAt` の差・`PreToolUse` の `receivedAt` との差（応答を 3 秒遅らせた間、ツールが始まらずに待ったか。`PostToolUse` の `receivedAt` が `PreToolUse` の `respondedAt` より後なら待った）
5. `claude-base.out` に hook のエラーの表示があるか（未確認事項 5 の参考）

- [ ] **Step 4: `PostToolBatch` と利用者の `PostToolUse` の hook を足して、プロンプトをもう 1 回送る（未確認事項 6。API を 1 回使う）**

```bash
cd "$S" && rm -f "$S/posthook-done" && node hook-probe.mjs "$S" batch > "$S/probe-batch.out"
```
（背景で起動する）。続けて（Bash の `timeout` を 180000 にする）:
```bash
cd "$S/repo" && $HOME/.local/bin/claude -p "ls を実行して" \
  --settings "$S/settings-batch.json" \
  --allowedTools "Bash(ls:*)" \
  --no-session-persistence \
  --debug-file "$S/claude-debug-batch.log" > "$S/claude-batch.out" 2>&1; echo "exit=$?"
node -e "console.log(require('fs').statSync(process.argv[1]).mtimeMs)" "$S/posthook-done"
```
終わったら測定用の受け口を止める（`pgrep -fl "hook-probe.mjs $S batch"` で確かめてから `kill`）。

確かめること: `post-tool-batch` の知らせが届いたか（届かなければ、デバッグのログに `PostToolBatch` を知らない旨・設定の拒否があるか）。届いたなら、その `receivedAt` が `posthook-done` の `mtimeMs`（利用者の hook が終わった時刻）より後か前か。`post-tool-use` の `http` の知らせが、`command` の hook の終わりを待たずに届いたか（`post-tool-use` の `receivedAt` と `mtimeMs` の差。設計書の「ツールの終わりの猶予」の前提）。**このステップで何も届かなくても止めない**（`PostToolBatch` は段階 A では使わない。Step 3 で届いていれば `http` の hook は使える）。

- [ ] **Step 5: プロキシの環境で知らせが届くか（未確認事項 4。API は失敗するため課金されない）**

測定用の受け口を `base` で背景に起動し直す（`PRE_TOOL_USE_DELAY_MS` は付けない。`probe-base.jsonl` は `mv "$S/probe-base.jsonl" "$S/probe-base-run1.jsonl"` で退避してから）。次の 2 つを、それぞれ背景で起動し（Bash の `run_in_background`）、`probe-base.jsonl` に `UserPromptSubmit` が出るか 60 秒まで見てから、`pgrep -fl "$S/settings-base.json"` で対象の `claude` を確かめて `kill` する（API の再試行で終わらないことがある）:
```bash
# (a) NO_PROXY あり(アプリが設定する形)
cd "$S/repo" && HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
  $HOME/.local/bin/claude -p "ls を実行して" --settings "$S/settings-base.json" --no-session-persistence > "$S/claude-proxy-a.out" 2>&1
# (b) NO_PROXY なし(対照)
cd "$S/repo" && env -u NO_PROXY -u no_proxy HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 \
  $HOME/.local/bin/claude -p "ls を実行して" --settings "$S/settings-base.json" --no-session-persistence > "$S/claude-proxy-b.out" 2>&1
```
（(a) を終えてから `probe-base.jsonl` を `probe-proxy-a.jsonl` に退避し、(b) を行う。）確かめること: (a) で `UserPromptSubmit` が届くか。(b) で届くか（届かなければ、`claude` は hook の要求をプロキシへ送る＝`NO_PROXY` が要る根拠になる）。最後に測定用の受け口を止める。

- [ ] **Step 6: 区切りの時間を測る（未確認事項 2 の後半）**

`src/main/__tests__/agentHookTiming.local.test.ts` を作る（計測の後に消す。コミットしない）:
```ts
import { describe, it, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { commitAll, writeRepoFile } from './helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  disposeAgentBaselineRepo,
  recordBaseline,
  recordBaselineFrom
} from './helpers/agentBaselineFixtures'
import type { AgentBaselineRepo } from './helpers/agentBaselineFixtures'

// 未確認事項 2: 区切り(baseIndexPath からの takeBaselineSnapshot)の時間。計測の後に消す(コミットしない)
let dirs: AgentBaselineRepo
beforeEach(() => {
  dirs = createAgentBaselineRepo('agent-hook-timing-')
})
afterEach(() => disposeAgentBaselineRepo(dirs))

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

async function measure(repo: string, tempRoot: string): Promise<{ median: number; max: number }> {
  let previous = await recordBaseline(repo, tempRoot)
  const times: number[] = []
  for (let i = 0; i < 10; i++) {
    const start = performance.now()
    previous = await recordBaselineFrom(repo, tempRoot, previous)
    times.push(performance.now() - start)
  }
  return { median: median(times), max: Math.max(...times) }
}

describe('計測', () => {
  it('このリポジトリの clone で区切りの時間を出す', async () => {
    const clone = join(dirs.tempRoot, 'clone')
    execFileSync('git', ['clone', '-q', '<repo-root>', clone])
    console.log('clone', JSON.stringify(await measure(realpathSync(clone), dirs.tempRoot)))
  }, 120_000)

  it('未追跡のファイルが 5,000 件のリポジトリで区切りの時間を出す', async () => {
    writeRepoFile(dirs.repo, 'a.txt', 'a\n')
    commitAll(dirs.repo, 'init')
    for (let i = 0; i < 5000; i++) {
      writeRepoFile(dirs.repo, `u/${Math.floor(i / 100)}/f${i}.txt`, `${i}\n`)
    }
    console.log('untracked-5000', JSON.stringify(await measure(dirs.repo, dirs.tempRoot)))
  }, 120_000)
})
```
Run: `npx vitest run src/main/__tests__/agentHookTiming.local.test.ts`
Expected: PASS。出力の中央値・最大値（ミリ秒）を控える。控えたら `rm src/main/__tests__/agentHookTiming.local.test.ts` で消す。

- [ ] **Step 7: 設計書の「確認の結果」に追記する**

`docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md` の「確認の結果」の 14 の段落の後に、次の形で 15 を足す（`<…>` は Step 2〜6 で控えた実際の値に置き換える。値が無い項目は「届かなかった」「測れなかった」と書く）:
```markdown
15. **実測（段階 A のタスク 1。<実施日>）**: 手元の `claude` は `<claude --version の出力>`（実行の時間 <秒>）。`claude -p "ls を実行して" --settings <ファイル>`（`http` の hooks 8 つ）で届いた知らせ: <イベントの並び>。要求の `Host` は `<値>`、`Content-Type` は `<値>`、`Origin` は <あり/なし>、`Authorization` は設定の値のまま（<一致した/しなかった>）、`User-Agent` は `<値>`。`tool_name` は `<値>`、`tool_use_id` は `<形>`、メインのエージェントの `agent_id` は <欄なし/null/その他>。`PreToolUse` の応答を 3 秒遅らせると、`PostToolUse` は応答の <ミリ秒> 後に届いた（ツールの開始は応答を <待った/待たなかった>）。`PostToolBatch` は <届いた/届かなかった>（届いた時点は利用者の `PostToolUse` の `command` の hook の終わりの <前/後>。`post-tool-use` の `http` の知らせは `command` の hook の終わりを <待たずに/待って> 届いた）。プロキシ（`HTTPS_PROXY=http://127.0.0.1:9`）の環境で、`NO_PROXY=127.0.0.1,localhost` ありは <届いた/届かなかった>、なしは <届いた/届かなかった>。ファイアウォールは <状態>。区切り（`baseIndexPath` からの `takeBaselineSnapshot`）の中央値・最大値は、このリポジトリの clone で <ms>・<ms>、未追跡 5,000 件で <ms>・<ms>
```
「未確認事項」の 1・2・4・6 の各段落の末尾に `（段階 A のタスク 1 で確かめた。確認の結果 15）` を足す。

- [ ] **Step 8: 後続のタスクへの影響を報告にまとめる**

報告に次を書く（Task 3 の実装者が参照する）:
- `Host` が `127.0.0.1:<ポート>` でなかった・`Content-Type` が `application/json` で始まらなかった場合は、その実際の値（Task 3 の検査とテストの期待値をその値に合わせる。設計書の「受け口」に追記する）
- メインのエージェントの `agent_id` が `null` だった場合は、その旨（Task 3 で `null` も「無い」とみなす）
- `tool_name` が `Bash` 以外の名前だった場合は、その名前（Task 2 の matcher・ツールの名前を直す）
- `PreToolUse` の待ちが効かなかった・`PostToolBatch` の結果（段階 B の設計で使う。段階 A は変えない）

Run: `git status --short`
Expected: 設計書の変更と、既存の未追跡のファイル（設計書・このプラン）だけ。`src/main/__tests__/agentHookTiming.local.test.ts` は無い

---

### Task 2: 設定の部品（`agentHookProtocol.ts`・`agentHookSettings.ts`）

> **気をつける知見:** L-004（`wx` の `EEXIST` で他者のファイルを消さない）・L-034（`--settings` の値は main が作った絶対パス）・L-045（設定の JSON を完全一致で固定）・L-428

**Files:**
- Create: `src/main/agentHookProtocol.ts`
- Create: `src/main/agentHookSettings.ts`
- Test: `src/main/__tests__/agentHookSettings.test.ts`（新規。対応表・設定の JSON の完全一致・ファイル・一時ディレクトリ）

**Interfaces:**
- Consumes: Task 1 の報告（`tool_name` が想定と違えば `AGENT_HOOK_TOOL_NAMES` を直す）
- Produces:
```ts
// src/main/agentHookProtocol.ts
export type AgentHookEventName =
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'SubagentStop'
  | 'Stop'
  | 'StopFailure'
  | 'SessionEnd'
export const AGENT_HOOK_EVENT_NAMES: readonly AgentHookEventName[]
export const AGENT_HOOK_EVENT_PATH_SEGMENTS: Readonly<Record<AgentHookEventName, string>>
export const AGENT_HOOK_PATH_PREFIX = '/prompt-ide/agent-hooks/v1/'
export function agentHookPathOf(event: AgentHookEventName): string
export function agentHookEventOfPath(path: string): AgentHookEventName | null
export const AGENT_HOOK_TOOL_NAMES: readonly string[]
export const AGENT_HOOK_TOOL_MATCHER: string
export const AGENT_HOOK_TOOL_EVENTS: readonly AgentHookEventName[]
export const AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS = 10
export const AGENT_HOOK_TIMEOUT_SECONDS = 5

// src/main/agentHookSettings.ts
export interface AgentHookHttpHook {
  type: 'http'
  url: string
  headers: { Authorization: string }
  timeout: number
}
export interface AgentHookMatcherGroup {
  matcher?: string
  hooks: AgentHookHttpHook[]
}
export interface AgentHookSettingsJson {
  hooks: Record<AgentHookEventName, AgentHookMatcherGroup[]>
}
export function buildAgentHookSettings(input: { baseUrl: string; token: string }): AgentHookSettingsJson
export const AGENT_HOOK_SETTINGS_DIR_PREFIX = 'prompt-ide-agent-hooks-'
export async function writeAgentHookSettingsFile(
  dir: string,
  settings: AgentHookSettingsJson,
  createName?: () => string
): Promise<string>
export async function removeAgentHookSettingsFile(path: string): Promise<void>
export interface AgentHookSettingsDir {
  ensure(): Promise<string>
  removeSync(): void
}
export interface AgentHookSettingsDirDeps {
  mkdtemp: (prefix: string) => Promise<string>
  rmSync: (path: string, options: { recursive: true; force: true }) => void
  tmpdir: () => string
}
export function createAgentHookSettingsDir(deps?: Partial<AgentHookSettingsDirDeps>): AgentHookSettingsDir
```

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentHookSettings.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  AGENT_HOOK_EVENT_NAMES,
  AGENT_HOOK_TOOL_MATCHER,
  agentHookEventOfPath,
  agentHookPathOf
} from '../agentHookProtocol'
import {
  AGENT_HOOK_SETTINGS_DIR_PREFIX,
  buildAgentHookSettings,
  createAgentHookSettingsDir,
  removeAgentHookSettingsFile,
  writeAgentHookSettingsFile
} from '../agentHookSettings'

const TOKEN = 'ab'.repeat(32)
const BASE = 'http://127.0.0.1:43210'
const MATCHER = 'Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell'
const hook = (
  segment: string,
  timeout = 5
): { type: string; url: string; headers: { Authorization: string }; timeout: number } => ({
  type: 'http',
  url: `${BASE}/prompt-ide/agent-hooks/v1/${segment}`,
  headers: { Authorization: `Bearer ${TOKEN}` },
  timeout
})

let dir: string
let warnSpy: MockInstance<typeof console.warn>
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-hook-settings-'))
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  warnSpy.mockRestore()
  rmSync(dir, { recursive: true, force: true })
})

describe('agentHookProtocol', () => {
  it('8 つのイベントとパスを相互に引ける', () => {
    expect(AGENT_HOOK_EVENT_NAMES).toEqual([
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'SubagentStop',
      'Stop',
      'StopFailure',
      'SessionEnd'
    ])
    for (const event of AGENT_HOOK_EVENT_NAMES) {
      expect(agentHookEventOfPath(agentHookPathOf(event))).toBe(event)
    }
    expect(agentHookPathOf('PostToolUseFailure')).toBe('/prompt-ide/agent-hooks/v1/post-tool-use-failure')
    expect(AGENT_HOOK_TOOL_MATCHER).toBe(MATCHER)
  })

  it.each([
    '/prompt-ide/agent-hooks/v1/stop?x=1',
    '/prompt-ide/agent-hooks/v1/stop/',
    '/prompt-ide/agent-hooks/v1/session-start',
    '/prompt-ide/agent-hooks/v1/post-tool-batch',
    '/prompt-ide/agent-hooks/v2/stop',
    '/PROMPT-IDE/agent-hooks/v1/stop',
    '/'
  ])('完全一致でないパス %s は null', (path) => {
    expect(agentHookEventOfPath(path)).toBeNull()
  })
})

describe('buildAgentHookSettings', () => {
  it('8 つのイベントの http の hook を完全一致の形で返す(SessionStart・PostToolBatch は渡さない)', () => {
    expect(buildAgentHookSettings({ baseUrl: BASE, token: TOKEN })).toStrictEqual({
      hooks: {
        UserPromptSubmit: [{ hooks: [hook('user-prompt-submit')] }],
        PreToolUse: [{ matcher: MATCHER, hooks: [hook('pre-tool-use', 10)] }],
        PostToolUse: [{ matcher: MATCHER, hooks: [hook('post-tool-use')] }],
        PostToolUseFailure: [{ matcher: MATCHER, hooks: [hook('post-tool-use-failure')] }],
        SubagentStop: [{ hooks: [hook('subagent-stop')] }],
        Stop: [{ hooks: [hook('stop')] }],
        StopFailure: [{ hooks: [hook('stop-failure')] }],
        SessionEnd: [{ hooks: [hook('session-end')] }]
      }
    })
  })

  it('JSON の並びはイベントの列挙の順で、onFailure・async・if を付けない', () => {
    const settings = buildAgentHookSettings({ baseUrl: BASE, token: TOKEN })
    expect(Object.keys(settings.hooks)).toEqual([...AGENT_HOOK_EVENT_NAMES])
    expect(JSON.stringify(settings)).not.toMatch(/onFailure|"async"|"if"/)
  })
})

describe('writeAgentHookSettingsFile', () => {
  it('トークンと無関係な 32 桁の 16 進の名前で、0600 の JSON を書いて絶対パスを返す', async () => {
    const settings = buildAgentHookSettings({ baseUrl: BASE, token: TOKEN })
    const path = await writeAgentHookSettingsFile(dir, settings)
    expect(path.startsWith(dir)).toBe(true)
    expect(basename(path)).toMatch(/^[0-9a-f]{32}\.json$/)
    expect(path).not.toContain(TOKEN)
    // --settings の値が JSON の文字列・オプションと取り違えられない(L-034)
    expect(path.startsWith('-')).toBe(false)
    expect(path.startsWith('{')).toBe(false)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toStrictEqual(settings)
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('同じ名前のファイルが既にあれば失敗し、そのファイルを上書きも削除もしない(wx。L-004)', async () => {
    const existing = join(dir, `${'c'.repeat(32)}.json`)
    writeFileSync(existing, 'other')
    await expect(
      writeAgentHookSettingsFile(
        dir,
        buildAgentHookSettings({ baseUrl: BASE, token: TOKEN }),
        () => 'c'.repeat(32)
      )
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(existing, 'utf8')).toBe('other')
  })
})

describe('removeAgentHookSettingsFile', () => {
  it('ファイルを消す。無いファイルでも投げない', async () => {
    const path = join(dir, 'a.json')
    writeFileSync(path, '{}')
    await removeAgentHookSettingsFile(path)
    expect(existsSync(path)).toBe(false)
    await expect(removeAgentHookSettingsFile(path)).resolves.toBeUndefined()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('消せなければ投げずに、パスだけをログに出す', async () => {
    const path = join(dir, 'not-empty')
    mkdirSync(path)
    writeFileSync(join(path, 'x'), 'x')
    await expect(removeAgentHookSettingsFile(path)).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith('[agent-hooks] 設定のファイルを消せませんでした:', path)
  })
})

describe('createAgentHookSettingsDir', () => {
  it('最初の ensure で 0700 のディレクトリを作り、2 回目(同時の呼び出しを含む)は同じパスを返す', async () => {
    const settingsDir = createAgentHookSettingsDir({ tmpdir: () => dir })
    const [first, concurrent] = await Promise.all([settingsDir.ensure(), settingsDir.ensure()])
    expect(concurrent).toBe(first)
    expect(await settingsDir.ensure()).toBe(first)
    expect(basename(first).startsWith(AGENT_HOOK_SETTINGS_DIR_PREFIX)).toBe(true)
    if (process.platform !== 'win32') expect(statSync(first).mode & 0o777).toBe(0o700)
    writeFileSync(join(first, 'a.json'), '{}')
    settingsDir.removeSync()
    expect(existsSync(first)).toBe(false)
  })

  it('mkdtemp は 1 回だけ。失敗したら次の ensure で作り直す', async () => {
    const mkdtemp = vi
      .fn<(prefix: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValueOnce('/tmp/prompt-ide-agent-hooks-abc')
    const settingsDir = createAgentHookSettingsDir({ mkdtemp, tmpdir: () => '/tmp' })
    await expect(settingsDir.ensure()).rejects.toThrow('EACCES')
    await expect(settingsDir.ensure()).resolves.toBe('/tmp/prompt-ide-agent-hooks-abc')
    await settingsDir.ensure()
    expect(mkdtemp).toHaveBeenCalledTimes(2)
    expect(mkdtemp).toHaveBeenCalledWith(join('/tmp', 'prompt-ide-agent-hooks-'))
  })

  it('作れていなければ removeSync は何もしない。消す失敗は投げずにパスをログに出す', async () => {
    const rmSyncFake = vi.fn(() => {
      throw new Error('EBUSY')
    })
    const settingsDir = createAgentHookSettingsDir({
      mkdtemp: async () => '/tmp/prompt-ide-agent-hooks-x',
      rmSync: rmSyncFake,
      tmpdir: () => '/tmp'
    })
    settingsDir.removeSync()
    expect(rmSyncFake).not.toHaveBeenCalled()
    await settingsDir.ensure()
    expect(() => settingsDir.removeSync()).not.toThrow()
    expect(rmSyncFake).toHaveBeenCalledWith('/tmp/prompt-ide-agent-hooks-x', {
      recursive: true,
      force: true
    })
    expect(warnSpy).toHaveBeenCalledWith(
      '[agent-hooks] 設定のディレクトリを消せませんでした:',
      '/tmp/prompt-ide-agent-hooks-x'
    )
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentHookSettings.test.ts`
Expected: FAIL（`Cannot find module '../agentHookProtocol'`）

- [ ] **Step 3: 実装する**

`src/main/agentHookProtocol.ts`:
```ts
// claude の hooks の受け取りの取り決め(設計書「受け口」「設定のファイル」「渡す hooks」)。設定・受け口・解釈が同じ定数を使う。
// どれも main が決め、renderer からは受け取らない(L-019)

/** アプリが渡す 8 つのイベント(SessionStart は http の hook を使えないため渡さない。PostToolBatch は段階 A では渡さない) */
export type AgentHookEventName =
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'SubagentStop'
  | 'Stop'
  | 'StopFailure'
  | 'SessionEnd'

/** 設定の JSON に書く順 */
export const AGENT_HOOK_EVENT_NAMES: readonly AgentHookEventName[] = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'SessionEnd'
]

/** イベントごとの URL のパスの最後の段 */
export const AGENT_HOOK_EVENT_PATH_SEGMENTS: Readonly<Record<AgentHookEventName, string>> = {
  UserPromptSubmit: 'user-prompt-submit',
  PreToolUse: 'pre-tool-use',
  PostToolUse: 'post-tool-use',
  PostToolUseFailure: 'post-tool-use-failure',
  SubagentStop: 'subagent-stop',
  Stop: 'stop',
  StopFailure: 'stop-failure',
  SessionEnd: 'session-end'
}

export const AGENT_HOOK_PATH_PREFIX = '/prompt-ide/agent-hooks/v1/'

export function agentHookPathOf(event: AgentHookEventName): string {
  return AGENT_HOOK_PATH_PREFIX + AGENT_HOOK_EVENT_PATH_SEGMENTS[event]
}

/** 要求のパス(クエリを含む req.url)が 8 つのどれかに完全一致すればそのイベント。違えば null */
export function agentHookEventOfPath(path: string): AgentHookEventName | null {
  return AGENT_HOOK_EVENT_NAMES.find((event) => agentHookPathOf(event) === path) ?? null
}

/** 区間を数えるツール(ファイルを書くツールとシェル)。読むだけのツールは渡さない */
export const AGENT_HOOK_TOOL_NAMES: readonly string[] = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'PowerShell'
]

/** 英字と | だけなので、claude は正規表現ではなく名前の完全一致の並びとして扱う(確認の結果 4) */
export const AGENT_HOOK_TOOL_MATCHER = AGENT_HOOK_TOOL_NAMES.join('|')

/** matcher を付けるイベント(ツールのイベント) */
export const AGENT_HOOK_TOOL_EVENTS: readonly AgentHookEventName[] = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure'
]

/** PreToolUse の hook の timeout(秒)。受け口の待ちの上限(5 秒)より長くし、claude 側で先に打ち切らない */
export const AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS = 10
/** ほかのイベントの hook の timeout(秒) */
export const AGENT_HOOK_TIMEOUT_SECONDS = 5
```

`src/main/agentHookSettings.ts`:
```ts
import { randomBytes } from 'node:crypto'
import { rmSync as fsRmSync } from 'node:fs'
import { mkdtemp as fsMkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir as osTmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_HOOK_EVENT_NAMES,
  AGENT_HOOK_TIMEOUT_SECONDS,
  AGENT_HOOK_TOOL_EVENTS,
  AGENT_HOOK_TOOL_MATCHER,
  AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS,
  agentHookPathOf
} from './agentHookProtocol'
import type { AgentHookEventName } from './agentHookProtocol'

// claude に --settings で渡す設定のファイル(設計書「設定のファイル」「トークンの渡し方」)。トークンは起動の引数に置かず
// (ps で見える)、0700 のディレクトリの 0600 のファイルにだけ書く。ファイルの名前はトークンと無関係な乱数

export interface AgentHookHttpHook {
  type: 'http'
  url: string
  headers: { Authorization: string }
  timeout: number
}

export interface AgentHookMatcherGroup {
  matcher?: string
  hooks: AgentHookHttpHook[]
}

export interface AgentHookSettingsJson {
  hooks: Record<AgentHookEventName, AgentHookMatcherGroup[]>
}

/** 設定の JSON(純粋な関数)。onFailure・async・if は付けない(既定の「失敗しても止めない」のまま。確認の結果 6) */
export function buildAgentHookSettings({
  baseUrl,
  token
}: {
  baseUrl: string
  token: string
}): AgentHookSettingsJson {
  const entries = AGENT_HOOK_EVENT_NAMES.map((event): [AgentHookEventName, AgentHookMatcherGroup[]] => {
    const hook: AgentHookHttpHook = {
      type: 'http',
      url: baseUrl + agentHookPathOf(event),
      headers: { Authorization: `Bearer ${token}` },
      timeout:
        event === 'PreToolUse' ? AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS : AGENT_HOOK_TIMEOUT_SECONDS
    }
    const group: AgentHookMatcherGroup = AGENT_HOOK_TOOL_EVENTS.includes(event)
      ? { matcher: AGENT_HOOK_TOOL_MATCHER, hooks: [hook] }
      : { hooks: [hook] }
    return [event, [group]]
  })
  return { hooks: Object.fromEntries(entries) as Record<AgentHookEventName, AgentHookMatcherGroup[]> }
}

export const AGENT_HOOK_SETTINGS_DIR_PREFIX = 'prompt-ide-agent-hooks-'

const createSettingsFileName = (): string => randomBytes(16).toString('hex')

/**
 * dir に <乱数 32 桁の 16 進>.json を wx・0600 で書き、絶対パスを返す。JSON は書き込みの前に作る(文字列の連結で作らない)。
 * 書き込みの途中で失敗したら自分が作ったファイルだけを消す(EEXIST は他者のファイルなので消さない。L-004)
 */
export async function writeAgentHookSettingsFile(
  dir: string,
  settings: AgentHookSettingsJson,
  createName: () => string = createSettingsFileName
): Promise<string> {
  const text = JSON.stringify(settings)
  const path = join(dir, `${createName()}.json`)
  try {
    await writeFile(path, text, { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      await rm(path, { force: true }).catch(() => undefined)
    }
    throw err
  }
  return path
}

/** 設定のファイルを消す。失敗は握ってパスだけをログに出す(ディレクトリごと will-quit で消す) */
export async function removeAgentHookSettingsFile(path: string): Promise<void> {
  try {
    await rm(path, { force: true })
  } catch {
    console.warn('[agent-hooks] 設定のファイルを消せませんでした:', path)
  }
}

export interface AgentHookSettingsDir {
  /** 最初の呼び出しで mkdtemp(0700)し、その Promise を共有する。失敗したら捨てて、次の呼び出しで作り直す */
  ensure(): Promise<string>
  /** 作れていればディレクトリごと同期で消す(失敗は握ってパスだけをログ)。作れていなければ何もしない */
  removeSync(): void
}

export interface AgentHookSettingsDirDeps {
  mkdtemp: (prefix: string) => Promise<string>
  rmSync: (path: string, options: { recursive: true; force: true }) => void
  tmpdir: () => string
}

export function createAgentHookSettingsDir({
  mkdtemp = (prefix) => fsMkdtemp(prefix),
  rmSync = fsRmSync,
  tmpdir = osTmpdir
}: Partial<AgentHookSettingsDirDeps> = {}): AgentHookSettingsDir {
  let pending: Promise<string> | null = null
  let created: string | null = null
  return {
    ensure() {
      if (pending === null) {
        const attempt = mkdtemp(join(tmpdir(), AGENT_HOOK_SETTINGS_DIR_PREFIX)).then((dir) => {
          created = dir
          return dir
        })
        pending = attempt
        attempt.catch(() => {
          if (pending === attempt) pending = null
        })
      }
      return pending
    },
    removeSync() {
      if (created === null) return
      try {
        rmSync(created, { recursive: true, force: true })
      } catch {
        console.warn('[agent-hooks] 設定のディレクトリを消せませんでした:', created)
      }
    }
  }
}
```

- [ ] **Step 4: 通す**

Run: `npx vitest run src/main/__tests__/agentHookSettings.test.ts`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/agentHookProtocol.ts src/main/agentHookSettings.ts src/main/__tests__/agentHookSettings.test.ts && npx eslint --max-warnings 0 src/main/agentHookProtocol.ts src/main/agentHookSettings.ts src/main/__tests__/agentHookSettings.test.ts`
Expected: エラー・警告なし

---

### Task 3: 受け口と入力の解釈（`agentHookEvents.ts`・`agentHookReceiver.ts`）

> **気をつける知見:** L-002（読めない `PreToolUse`・読み込みの失敗も区間を開く）・L-006・L-017（トークン・本文をログに出さない）・L-023・L-044・L-052（5 秒の上限・要求の打ち切り）・L-060（`onToolStart`・`onToolStartTimedOut` は必須）

**Files:**
- Create: `src/main/agentHookEvents.ts`
- Create: `src/main/agentHookReceiver.ts`
- Create: `src/main/__tests__/helpers/agentHookHttp.ts`（テスト用の HTTP の要求。Task 7 の結合テストでも使う）
- Test: `src/main/__tests__/agentHookEvents.test.ts`（新規。純粋な関数）
- Test: `src/main/__tests__/agentHookReceiver.test.ts`（新規。**実際に `127.0.0.1` で listen する**。追跡は `deliver` の呼び出しを記録する偽物）

**Interfaces:**
- Consumes: Task 2 の `AgentHookEventName`・`AGENT_HOOK_TOOL_NAMES`・`agentHookEventOfPath`（`src/main/agentHookProtocol.ts`）。Task 1 の報告（`Host`・`Content-Type` の実際の値、メインのエージェントの `agent_id` の形）
- Produces:
```ts
// src/main/agentHookEvents.ts
export type ToolIdRead = { kind: 'read'; id: string } | { kind: 'unreadable' }
export type AgentHookConfirmOnlyReason =
  | 'prompt-submit'
  | 'unknown-tool-end'
  | 'bad-agent-id'
  | 'subagent-stop-without-agent'
export type AgentHookEvent = { hookEventName: AgentHookEventName; toolName: string | null } & (
  | { kind: 'confirm-only'; reason: AgentHookConfirmOnlyReason }
  | { kind: 'tool-start'; toolId: ToolIdRead; agentId: string | null }
  | { kind: 'tool-end'; toolId: ToolIdRead; agentId: string | null }
  | { kind: 'subagent-stop'; agentId: string }
  | { kind: 'turn-end' }
  | { kind: 'session-end' }
)
export type AgentHookBody = { kind: 'text'; text: string } | { kind: 'too-large' } | { kind: 'unreadable' }
export type AgentHookParseNote = 'unreadable-body' | 'event-name-mismatch' | 'unknown-tool-name' | 'bad-agent-id'
export interface AgentHookParseResult {
  event: AgentHookEvent
  notes: AgentHookParseNote[]
}
export function parseAgentHookRequest(pathEvent: AgentHookEventName, body: AgentHookBody): AgentHookParseResult

// src/main/agentHookReceiver.ts
export const AGENT_PRE_TOOL_USE_WAIT_MS = 5_000
export const AGENT_HOOK_MAX_BODY_BYTES = 16 * 1024 * 1024
export const AGENT_HOOK_HEADERS_TIMEOUT_MS = 5_000
export const AGENT_HOOK_REQUEST_TIMEOUT_MS = 15_000
export type AgentHookRejectReason = 'method' | 'path' | 'host' | 'origin' | 'token' | 'content-type' | 'too-large'
export interface AgentHookOwner {
  ownerId: number
  sessionId: string
}
export interface AgentHookReceiverDeps {
  /** 照合の通った知らせ 1 件につき 1 回だけ呼ぶ(同期。追跡の deliver をそのまま渡す) */
  deliver(ownerId: number, sessionId: string, event: AgentHookEvent): void
  /** PreToolUse で deliver の後に呼んで待つ(段階 A はすぐ解決する。段階 B で waitForAgentPhase につなぐ) */
  onToolStart(ownerId: number, signal: AbortSignal): Promise<void>
  /** onToolStart の待ちを上限で打ち切ったときに 1 回呼ぶ(段階 A は何もしない。段階 B で markPeriodUnassignable につなぐ) */
  onToolStartTimedOut(ownerId: number): void
  /** 常に出すログ(拒んだ要求の件数など。トークン・本文は渡さない) */
  log(message: string): void
  /** テスト用。PreToolUse の待ちの上限(既定 AGENT_PRE_TOOL_USE_WAIT_MS) */
  preToolUseWaitMs?: number
}
export interface AgentHookReceiver {
  ensureListening(): Promise<{ baseUrl: string }>
  addToken(token: string, owner: AgentHookOwner): void
  removeToken(token: string): void
  close(): void
}
export function createAgentHookReceiver(deps: AgentHookReceiverDeps): AgentHookReceiver

// src/main/__tests__/helpers/agentHookHttp.ts
export interface HookResponse { status: number; headers: IncomingHttpHeaders; body: string }
export interface HookRequestOptions { method?: string; path: string; headers?: Record<string, string>; body?: string | Buffer }
export function sendHookRequest(port: number, options: HookRequestOptions): Promise<HookResponse>
```

> Task 1 の報告で `Host` が `127.0.0.1:<ポート>` でなかった・`Content-Type` が `application/json` で始まらなかったときは、Step 1 のテストの期待値と Step 3 の検査（`hostOk`・`contentTypeOk`）を、その実際の値に合わせてから進める。メインのエージェントの `agent_id` が `null` だったときは、`readAgentId` で `value === null` も `{ kind: 'absent' }` にし、`agentHookEvents.test.ts` の `null` の行の期待値を「無い」に直す。

- [ ] **Step 1: 解釈の失敗するテストを書く**

`src/main/__tests__/agentHookEvents.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseAgentHookRequest } from '../agentHookEvents'
import type { AgentHookBody, AgentHookParseResult } from '../agentHookEvents'
import type { AgentHookEventName } from '../agentHookProtocol'

const json = (value: unknown): AgentHookBody => ({ kind: 'text', text: JSON.stringify(value) })
const parse = (event: AgentHookEventName, value: unknown): AgentHookParseResult =>
  parseAgentHookRequest(event, json(value))

describe('parseAgentHookRequest(ツール以外のイベント)', () => {
  it.each<[AgentHookEventName, unknown]>([
    ['UserPromptSubmit', { kind: 'confirm-only', reason: 'prompt-submit', hookEventName: 'UserPromptSubmit', toolName: null }],
    ['Stop', { kind: 'turn-end', hookEventName: 'Stop', toolName: null }],
    ['StopFailure', { kind: 'turn-end', hookEventName: 'StopFailure', toolName: null }],
    ['SessionEnd', { kind: 'session-end', hookEventName: 'SessionEnd', toolName: null }]
  ])('%s', (event, expected) => {
    expect(parse(event, { hook_event_name: event, session_id: 's', prompt: 'x' })).toEqual({
      event: expected,
      notes: []
    })
  })

  it('SubagentStop は agent_id があれば subagent-stop、無い・形が違えば confirm-only', () => {
    expect(parse('SubagentStop', { hook_event_name: 'SubagentStop', agent_id: 'ag-1' }).event).toEqual({
      kind: 'subagent-stop',
      agentId: 'ag-1',
      hookEventName: 'SubagentStop',
      toolName: null
    })
    expect(parse('SubagentStop', { hook_event_name: 'SubagentStop' })).toEqual({
      event: { kind: 'confirm-only', reason: 'subagent-stop-without-agent', hookEventName: 'SubagentStop', toolName: null },
      notes: []
    })
    expect(parse('SubagentStop', { hook_event_name: 'SubagentStop', agent_id: 3 })).toEqual({
      event: { kind: 'confirm-only', reason: 'bad-agent-id', hookEventName: 'SubagentStop', toolName: null },
      notes: ['bad-agent-id']
    })
  })
})

describe('parseAgentHookRequest(ツールのイベント)', () => {
  const pre = (extra: Record<string, unknown>): AgentHookParseResult =>
    parse('PreToolUse', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'toolu_1', ...extra })
  const post = (extra: Record<string, unknown>, event: 'PostToolUse' | 'PostToolUseFailure' = 'PostToolUse'): AgentHookParseResult =>
    parse(event, { hook_event_name: event, tool_name: 'Edit', tool_use_id: 'toolu_1', ...extra })

  it('PreToolUse は tool-start、PostToolUse・PostToolUseFailure は tool-end(hookEventName で見分けられる)', () => {
    expect(pre({}).event).toEqual({
      kind: 'tool-start',
      hookEventName: 'PreToolUse',
      toolName: 'Edit',
      toolId: { kind: 'read', id: 'toolu_1' },
      agentId: null
    })
    expect(post({ agent_id: 'ag-1' }, 'PostToolUseFailure').event).toEqual({
      kind: 'tool-end',
      hookEventName: 'PostToolUseFailure',
      toolName: 'Edit',
      toolId: { kind: 'read', id: 'toolu_1' },
      agentId: 'ag-1'
    })
  })

  it.each<[string, unknown, string | null]>([
    ['matcher の名前', 'Bash', 'Bash'],
    ['matcher に無い形の合う名前', 'mcp__x_y-z', 'mcp__x_y-z'],
    ['64 文字', 'a'.repeat(64), 'a'.repeat(64)],
    ['65 文字', 'a'.repeat(65), null],
    ['記号を含む', 'Ed it', null],
    ['数値', 3, null],
    ['無い', undefined, null]
  ])('toolName: %s', (_label, toolName, expected) => {
    expect(pre({ tool_name: toolName }).event.toolName).toBe(expected)
  })

  it('知らない tool_name の PreToolUse は区間を開き(L-002)、PostToolUse・PostToolUseFailure は捨てる(L-044)', () => {
    expect(pre({ tool_name: 'Foo' })).toEqual({
      event: { kind: 'tool-start', hookEventName: 'PreToolUse', toolName: 'Foo', toolId: { kind: 'read', id: 'toolu_1' }, agentId: null },
      notes: ['unknown-tool-name']
    })
    expect(post({ tool_name: 'Foo' }, 'PostToolUseFailure')).toEqual({
      event: { kind: 'confirm-only', reason: 'unknown-tool-end', hookEventName: 'PostToolUseFailure', toolName: 'Foo' },
      notes: ['unknown-tool-name']
    })
  })

  it.each<[string, unknown]>([
    ['空', ''],
    ['257 文字', 'x'.repeat(257)],
    ['数値', 1],
    ['無い', undefined]
  ])('tool_use_id が %s なら ID なし', (_label, toolUseId) => {
    expect(pre({ tool_use_id: toolUseId }).event).toMatchObject({ toolId: { kind: 'unreadable' } })
    expect(post({ tool_use_id: toolUseId }).event).toMatchObject({ kind: 'tool-end', toolId: { kind: 'unreadable' } })
  })

  it('tool_use_id は 256 文字まで読む', () => {
    expect(pre({ tool_use_id: 'x'.repeat(256) }).event).toMatchObject({ toolId: { kind: 'read', id: 'x'.repeat(256) } })
  })

  it.each<[string, unknown]>([
    ['空', ''],
    ['257 文字', 'a'.repeat(257)],
    ['数値', 1],
    ['null', null]
  ])('agent_id が %s(形が違う)なら、PreToolUse は ID なしの区間、PostToolUse は捨てる', (_label, agentId) => {
    expect(pre({ agent_id: agentId })).toEqual({
      event: { kind: 'tool-start', hookEventName: 'PreToolUse', toolName: 'Edit', toolId: { kind: 'unreadable' }, agentId: null },
      notes: ['bad-agent-id']
    })
    expect(post({ agent_id: agentId })).toEqual({
      event: { kind: 'confirm-only', reason: 'bad-agent-id', hookEventName: 'PostToolUse', toolName: 'Edit' },
      notes: ['bad-agent-id']
    })
  })
})

describe('parseAgentHookRequest(読めない本文)', () => {
  it.each<[string, AgentHookBody, string[]]>([
    ['16 MiB を超えた', { kind: 'too-large' }, []],
    ['読み込みの失敗', { kind: 'unreadable' }, ['unreadable-body']],
    ['JSON でない', { kind: 'text', text: '{' }, ['unreadable-body']],
    ['オブジェクトでない', { kind: 'text', text: '[1]' }, ['unreadable-body']],
    ['イベント名がパスと違う(L-023)', json({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'toolu_1' }), ['event-name-mismatch']]
  ])('%s ときは、パスのイベントだけで扱う(ツールのイベントは ID なし)', (_label, body, notes) => {
    expect(parseAgentHookRequest('PreToolUse', body)).toEqual({
      event: { kind: 'tool-start', hookEventName: 'PreToolUse', toolName: null, toolId: { kind: 'unreadable' }, agentId: null },
      notes
    })
    expect(parseAgentHookRequest('UserPromptSubmit', body).event.kind).toBe('confirm-only')
    expect(parseAgentHookRequest('SubagentStop', body).event).toMatchObject({
      kind: 'confirm-only',
      reason: 'subagent-stop-without-agent'
    })
    expect(parseAgentHookRequest('Stop', body).event.kind).toBe('turn-end')
    expect(parseAgentHookRequest('SessionEnd', body).event.kind).toBe('session-end')
  })

  it('PostToolUse の本文を読めなければ、ID なしの tool-end(何も閉じない側)にする', () => {
    for (const body of [{ kind: 'too-large' }, { kind: 'unreadable' }, { kind: 'text', text: '{' }] as AgentHookBody[]) {
      expect(parseAgentHookRequest('PostToolUse', body).event).toEqual({
        kind: 'tool-end',
        hookEventName: 'PostToolUse',
        toolName: null,
        toolId: { kind: 'unreadable' },
        agentId: null
      })
    }
  })

  it('余分な欄(tool_input・cwd・transcript_path)は読まない', () => {
    const withExtras = parse('PreToolUse', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_use_id: 't',
      tool_input: { file_path: '/etc/passwd', content: 'x' },
      cwd: '/x',
      transcript_path: '/y'
    })
    expect(withExtras.event).toEqual({
      kind: 'tool-start',
      hookEventName: 'PreToolUse',
      toolName: 'Write',
      toolId: { kind: 'read', id: 't' },
      agentId: null
    })
  })
})
```
（「読めない本文」の表の `イベント名がパスと違う` の行の本文は `hook_event_name: 'PostToolUse'` なので、`PostToolUse` のパスでは一致して読めてしまう。そのため `PostToolUse` の読めない本文は、表とは別の it で確かめている。）

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentHookEvents.test.ts`
Expected: FAIL（`Cannot find module '../agentHookEvents'`）

- [ ] **Step 3: 解釈を実装する**

`src/main/agentHookEvents.ts`:
```ts
import { AGENT_HOOK_TOOL_NAMES } from './agentHookProtocol'
import type { AgentHookEventName } from './agentHookProtocol'

// hook の要求の本文とパスの解釈(設計書「入力の解釈」。純粋な関数)。使う欄は hook_event_name・tool_name・tool_use_id・agent_id だけで、
// tool_input・cwd・transcript_path などは読まない(区別は git の差分で行う。L-009・L-018)。どの結果も照合の通った知らせで、
// 追跡は受け取ったら確かめた状態を更新する

/** 読めた ID と、読めない(本文が大きすぎる・読めない・形が違う)を型で区別する */
export type ToolIdRead = { kind: 'read'; id: string } | { kind: 'unreadable' }

export type AgentHookConfirmOnlyReason =
  | 'prompt-submit'
  | 'unknown-tool-end'
  | 'bad-agent-id'
  | 'subagent-stop-without-agent'

/** hookEventName はパスから決めたイベント名。toolName は検証済みの名前(ツール以外のイベントは null。ログにだけ使う) */
export type AgentHookEvent = { hookEventName: AgentHookEventName; toolName: string | null } & (
  | { kind: 'confirm-only'; reason: AgentHookConfirmOnlyReason }
  | { kind: 'tool-start'; toolId: ToolIdRead; agentId: string | null }
  | { kind: 'tool-end'; toolId: ToolIdRead; agentId: string | null }
  | { kind: 'subagent-stop'; agentId: string }
  | { kind: 'turn-end' }
  | { kind: 'session-end' }
)

export type AgentHookBody = { kind: 'text'; text: string } | { kind: 'too-large' } | { kind: 'unreadable' }

/** ログに出す理由(値は出さない) */
export type AgentHookParseNote = 'unreadable-body' | 'event-name-mismatch' | 'unknown-tool-name' | 'bad-agent-id'

export interface AgentHookParseResult {
  event: AgentHookEvent
  notes: AgentHookParseNote[]
}

const ID_MAX_LENGTH = 256
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

type AgentIdRead = { kind: 'absent' } | { kind: 'read'; id: string } | { kind: 'bad' }

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= ID_MAX_LENGTH

function readAgentId(body: Record<string, unknown>): AgentIdRead {
  if (!('agent_id' in body) || body.agent_id === undefined) return { kind: 'absent' }
  return isId(body.agent_id) ? { kind: 'read', id: body.agent_id } : { kind: 'bad' }
}

function readBody(pathEvent: AgentHookEventName, body: AgentHookBody): { value: Record<string, unknown> | null; notes: AgentHookParseNote[] } {
  if (body.kind === 'too-large') return { value: null, notes: [] }
  if (body.kind === 'unreadable') return { value: null, notes: ['unreadable-body'] }
  let parsed: unknown
  try {
    parsed = JSON.parse(body.text)
  } catch {
    return { value: null, notes: ['unreadable-body'] }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { value: null, notes: ['unreadable-body'] }
  }
  const value = parsed as Record<string, unknown>
  // 本文のイベント名とパスのイベントを照らし合わせる(L-023)。違えばパスのイベントだけで扱う
  if (value.hook_event_name !== pathEvent) return { value: null, notes: ['event-name-mismatch'] }
  return { value, notes: [] }
}

/** 本文を読めないときの結果(パスのイベントだけ。ツールのイベントは ID なし) */
function eventWithoutBody(pathEvent: AgentHookEventName): AgentHookEvent {
  const base = { hookEventName: pathEvent, toolName: null }
  switch (pathEvent) {
    case 'UserPromptSubmit':
      return { ...base, kind: 'confirm-only', reason: 'prompt-submit' }
    case 'PreToolUse':
      return { ...base, kind: 'tool-start', toolId: { kind: 'unreadable' }, agentId: null }
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return { ...base, kind: 'tool-end', toolId: { kind: 'unreadable' }, agentId: null }
    case 'SubagentStop':
      return { ...base, kind: 'confirm-only', reason: 'subagent-stop-without-agent' }
    case 'Stop':
    case 'StopFailure':
      return { ...base, kind: 'turn-end' }
    case 'SessionEnd':
      return { ...base, kind: 'session-end' }
  }
}

export function parseAgentHookRequest(pathEvent: AgentHookEventName, body: AgentHookBody): AgentHookParseResult {
  const { value, notes } = readBody(pathEvent, body)
  if (value === null) return { event: eventWithoutBody(pathEvent), notes }
  const base = { hookEventName: pathEvent, toolName: null }
  switch (pathEvent) {
    case 'UserPromptSubmit':
    case 'Stop':
    case 'StopFailure':
    case 'SessionEnd':
      return { event: eventWithoutBody(pathEvent), notes: [] }
    case 'SubagentStop': {
      const agent = readAgentId(value)
      if (agent.kind === 'absent') {
        return { event: { ...base, kind: 'confirm-only', reason: 'subagent-stop-without-agent' }, notes: [] }
      }
      if (agent.kind === 'bad') {
        return { event: { ...base, kind: 'confirm-only', reason: 'bad-agent-id' }, notes: ['bad-agent-id'] }
      }
      return { event: { ...base, kind: 'subagent-stop', agentId: agent.id }, notes: [] }
    }
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return parseToolEvent(pathEvent, value)
  }
}

function parseToolEvent(
  pathEvent: 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure',
  value: Record<string, unknown>
): AgentHookParseResult {
  const rawToolName = value.tool_name
  const toolName = typeof rawToolName === 'string' && TOOL_NAME_PATTERN.test(rawToolName) ? rawToolName : null
  const known = typeof rawToolName === 'string' && AGENT_HOOK_TOOL_NAMES.includes(rawToolName)
  const toolId: ToolIdRead = isId(value.tool_use_id) ? { kind: 'read', id: value.tool_use_id } : { kind: 'unreadable' }
  const agent = readAgentId(value)
  const base = { hookEventName: pathEvent, toolName }
  if (pathEvent === 'PreToolUse') {
    const notes: AgentHookParseNote[] = []
    // 知らない名前・形の違う agent_id でも区間を開く(捨てると、そのツールの書き込みが利用者の区間に入る。L-002)
    if (!known) notes.push('unknown-tool-name')
    if (agent.kind === 'bad') {
      notes.push('bad-agent-id')
      return { event: { ...base, kind: 'tool-start', toolId: { kind: 'unreadable' }, agentId: null }, notes }
    }
    return { event: { ...base, kind: 'tool-start', toolId, agentId: agent.kind === 'read' ? agent.id : null }, notes }
  }
  // 区間を閉じる知らせは、知らない名前・形の違う agent_id を根拠にしない(L-044)
  if (!known) {
    return { event: { ...base, kind: 'confirm-only', reason: 'unknown-tool-end' }, notes: ['unknown-tool-name'] }
  }
  if (agent.kind === 'bad') {
    return { event: { ...base, kind: 'confirm-only', reason: 'bad-agent-id' }, notes: ['bad-agent-id'] }
  }
  return { event: { ...base, kind: 'tool-end', toolId, agentId: agent.kind === 'read' ? agent.id : null }, notes: [] }
}
```

Run: `npx vitest run src/main/__tests__/agentHookEvents.test.ts`
Expected: PASS

- [ ] **Step 4: 受け口の失敗するテストを書く**

`src/main/__tests__/helpers/agentHookHttp.ts`:
```ts
import { request } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'

// 受け口のテスト用の HTTP の要求。node:http は Host に 127.0.0.1:<port> を付け、Origin は付けない
// (fetch は実装によって既定のヘッダーが変わるため使わない)

export interface HookResponse {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

export interface HookRequestOptions {
  method?: string
  path: string
  headers?: Record<string, string>
  body?: string | Buffer
}

export function sendHookRequest(port: number, options: HookRequestOptions): Promise<HookResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method: options.method ?? 'POST', path: options.path, headers: options.headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
        )
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.end(options.body)
  })
}
```

`src/main/__tests__/agentHookReceiver.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_HOOK_HEADERS_TIMEOUT_MS,
  AGENT_HOOK_MAX_BODY_BYTES,
  AGENT_HOOK_REQUEST_TIMEOUT_MS,
  AGENT_PRE_TOOL_USE_WAIT_MS,
  createAgentHookReceiver
} from '../agentHookReceiver'
import type { AgentHookReceiver, AgentHookReceiverDeps } from '../agentHookReceiver'
import type { AgentHookEvent } from '../agentHookEvents'
import { sendHookRequest } from './helpers/agentHookHttp'
import type { HookResponse } from './helpers/agentHookHttp'

const TOKEN = 'ab'.repeat(32)
const OTHER_TOKEN = 'cd'.repeat(32)

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

let receiver: AgentHookReceiver | null = null
let port = 0
let calls: string[] = []
let delivered: Array<[number, string, AgentHookEvent]> = []
let deps: {
  deliver: ReturnType<typeof vi.fn<AgentHookReceiverDeps['deliver']>>
  onToolStart: ReturnType<typeof vi.fn<AgentHookReceiverDeps['onToolStart']>>
  onToolStartTimedOut: ReturnType<typeof vi.fn<AgentHookReceiverDeps['onToolStartTimedOut']>>
  log: ReturnType<typeof vi.fn<AgentHookReceiverDeps['log']>>
}

afterEach(() => {
  receiver?.close()
  receiver = null
})

async function start(overrides: Partial<AgentHookReceiverDeps> = {}): Promise<void> {
  calls = []
  delivered = []
  deps = {
    deliver: vi.fn<AgentHookReceiverDeps['deliver']>((ownerId, sessionId, event) => {
      calls.push(`deliver:${event.kind}`)
      delivered.push([ownerId, sessionId, event])
    }),
    onToolStart: vi.fn<AgentHookReceiverDeps['onToolStart']>(async () => {
      calls.push('onToolStart')
    }),
    onToolStartTimedOut: vi.fn<AgentHookReceiverDeps['onToolStartTimedOut']>(() => {
      calls.push('timedOut')
    }),
    log: vi.fn<AgentHookReceiverDeps['log']>()
  }
  receiver = createAgentHookReceiver({ ...deps, preToolUseWaitMs: 200, ...overrides })
  const { baseUrl } = await receiver.ensureListening()
  expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  port = Number(new URL(baseUrl).port)
  receiver.addToken(TOKEN, { ownerId: 7, sessionId: 'sid-1' })
}

const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const post = (
  segment: string,
  body: unknown,
  headers: Record<string, string> = HEADERS
): Promise<HookResponse> =>
  sendHookRequest(port, {
    path: `/prompt-ide/agent-hooks/v1/${segment}`,
    headers,
    body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  })

describe('createAgentHookReceiver(定数と待ち受け)', () => {
  it('上限の定数は設計書の値', () => {
    expect(AGENT_PRE_TOOL_USE_WAIT_MS).toBe(5_000)
    expect(AGENT_HOOK_MAX_BODY_BYTES).toBe(16 * 1024 * 1024)
    expect(AGENT_HOOK_HEADERS_TIMEOUT_MS).toBe(5_000)
    expect(AGENT_HOOK_REQUEST_TIMEOUT_MS).toBe(15_000)
  })

  it('127.0.0.1 のランダムなポートで待ち受け、2 回目の ensureListening は同じ URL を返す', async () => {
    await start()
    expect(port).toBeGreaterThan(0)
    await expect(receiver?.ensureListening()).resolves.toEqual({ baseUrl: `http://127.0.0.1:${port}` })
  })
})

describe('createAgentHookReceiver(受け付ける要求)', () => {
  it('正しい要求に本文の無い 200 を返し、deliver を 1 回だけ呼ぶ', async () => {
    await start()
    const response = await post('user-prompt-submit', { hook_event_name: 'UserPromptSubmit', prompt: 'hi' })
    expect(response.status).toBe(200)
    expect(response.body).toBe('')
    expect(response.headers['content-length']).toBe('0')
    expect(deps.deliver).toHaveBeenCalledOnce()
    expect(delivered).toEqual([
      [7, 'sid-1', { kind: 'confirm-only', reason: 'prompt-submit', hookEventName: 'UserPromptSubmit', toolName: null }]
    ])
    expect(deps.onToolStart).not.toHaveBeenCalled()
  })

  it('Content-Type は大文字小文字を区別せず、charset が付いても受け付ける', async () => {
    await start()
    const response = await post('stop', { hook_event_name: 'Stop' }, {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'Application/JSON; charset=utf-8'
    })
    expect(response.status).toBe(200)
    expect(deps.deliver).toHaveBeenCalledOnce()
  })
})

describe('createAgentHookReceiver(拒む要求)', () => {
  const body = JSON.stringify({ hook_event_name: 'Stop' })
  it.each<[string, () => Promise<HookResponse>, number, string]>([
    ['GET', () => sendHookRequest(port, { method: 'GET', path: '/prompt-ide/agent-hooks/v1/stop', headers: HEADERS }), 405, 'method'],
    ['知らないパス', () => sendHookRequest(port, { path: '/prompt-ide/agent-hooks/v1/session-start', headers: HEADERS, body }), 404, 'path'],
    ['Host が localhost', () => sendHookRequest(port, { path: '/prompt-ide/agent-hooks/v1/stop', headers: { ...HEADERS, Host: `localhost:${port}` }, body }), 403, 'host'],
    ['Origin がある', () => sendHookRequest(port, { path: '/prompt-ide/agent-hooks/v1/stop', headers: { ...HEADERS, Origin: 'http://evil.example' }, body }), 403, 'origin'],
    ['Authorization が無い', () => sendHookRequest(port, { path: '/prompt-ide/agent-hooks/v1/stop', headers: { 'Content-Type': 'application/json' }, body }), 401, 'token'],
    ['Bearer の形が違う', () => sendHookRequest(port, { path: '/prompt-ide/agent-hooks/v1/stop', headers: { ...HEADERS, Authorization: `Bearer ${TOKEN.toUpperCase()}` }, body }), 401, 'token'],
    ['表に無いトークン', () => sendHookRequest(port, { path: '/prompt-ide/agent-hooks/v1/stop', headers: { ...HEADERS, Authorization: `Bearer ${OTHER_TOKEN}` }, body }), 401, 'token'],
    ['Content-Type が text/plain', () => sendHookRequest(port, { path: '/prompt-ide/agent-hooks/v1/stop', headers: { ...HEADERS, 'Content-Type': 'text/plain' }, body }), 415, 'content-type']
  ])('%s は状態を変えずに 4xx(本文なし)を返し、理由の件数をログに出す', async (_label, send, status, reason) => {
    await start()
    const response = await send()
    expect(response.status).toBe(status)
    expect(response.body).toBe('')
    expect(deps.deliver).not.toHaveBeenCalled()
    expect(deps.log).toHaveBeenCalledWith(`[agent-hooks] 拒んだ要求: ${reason} 1 件`)
    for (const [message] of deps.log.mock.calls) {
      expect(message).not.toContain(TOKEN)
      expect(message).not.toContain('Stop')
    }
  })

  it('activate の前(addToken の前)と release の後(removeToken の後)のトークンは 401', async () => {
    await start()
    receiver?.addToken(OTHER_TOKEN, { ownerId: 8, sessionId: 'sid-2' })
    receiver?.removeToken(OTHER_TOKEN)
    const other = { Authorization: `Bearer ${OTHER_TOKEN}`, 'Content-Type': 'application/json' }
    expect((await post('stop', { hook_event_name: 'Stop' }, other)).status).toBe(401)
    expect(deps.deliver).not.toHaveBeenCalled()
  })

  it('拒んだ件数は最初の 1 件と 100 件ごとにだけログに出す', async () => {
    await start()
    for (let i = 0; i < 100; i++) {
      await sendHookRequest(port, { method: 'GET', path: '/prompt-ide/agent-hooks/v1/stop', headers: HEADERS })
    }
    expect(deps.log.mock.calls.map(([message]) => message)).toEqual([
      '[agent-hooks] 拒んだ要求: method 1 件',
      '[agent-hooks] 拒んだ要求: method 100 件'
    ])
  })
})

describe('createAgentHookReceiver(本文)', () => {
  it('16 MiB を超える本文は先を持たずに読み捨て、ID なしの知らせとして deliver して 200 を返す(too-large を数える)', async () => {
    await start()
    const huge = Buffer.alloc(AGENT_HOOK_MAX_BODY_BYTES + 1, 0x20)
    const response = await post('pre-tool-use', huge)
    expect(response.status).toBe(200)
    expect(delivered).toEqual([
      [7, 'sid-1', { kind: 'tool-start', hookEventName: 'PreToolUse', toolName: null, toolId: { kind: 'unreadable' }, agentId: null }]
    ])
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] 拒んだ要求: too-large 1 件')
  })

  it('JSON でない本文・イベント名がパスと違う本文は、パスのイベントだけで扱い、理由をログに出す', async () => {
    await start()
    await post('post-tool-use', '{')
    await post('post-tool-use', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'toolu_1' })
    expect(delivered.map(([, , event]) => event)).toEqual([
      { kind: 'tool-end', hookEventName: 'PostToolUse', toolName: null, toolId: { kind: 'unreadable' }, agentId: null },
      { kind: 'tool-end', hookEventName: 'PostToolUse', toolName: null, toolId: { kind: 'unreadable' }, agentId: null }
    ])
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] 読めない知らせ: unreadable-body 1 件')
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] 読めない知らせ: event-name-mismatch 1 件')
  })
})

describe('createAgentHookReceiver(PreToolUse の順序と上限)', () => {
  const PRE = { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'toolu_1' }

  it('deliver(tool-start)を呼び終えてから onToolStart を呼び、その解決まで応答しない', async () => {
    const gate = deferred<void>()
    await start({
      onToolStart: vi.fn(async () => {
        calls.push('onToolStart')
        await gate.promise
      })
    })
    let answered = false
    const response = post('pre-tool-use', PRE).then((r) => {
      answered = true
      return r
    })
    await vi.waitFor(() => expect(calls).toEqual(['deliver:tool-start', 'onToolStart']))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(answered).toBe(false)
    gate.resolve()
    expect((await response).status).toBe(200)
    expect(calls).toEqual(['deliver:tool-start', 'onToolStart'])
  })

  it('onToolStart が解決しなければ上限で 200 を返し、signal を中止して onToolStartTimedOut を 1 回呼ぶ', async () => {
    // コールバックの中の代入は絞り込みに反映されないため、as で型を広げて宣言する
    let captured = null as AbortSignal | null
    await start({
      onToolStart: vi.fn((_ownerId: number, signal: AbortSignal) => {
        calls.push('onToolStart')
        captured = signal
        return new Promise<void>(() => undefined)
      })
    })
    const response = await post('pre-tool-use', PRE)
    expect(response.status).toBe(200)
    expect(captured?.aborted).toBe(true)
    expect(deps.onToolStartTimedOut).toHaveBeenCalledExactlyOnceWith(7)
    expect(calls).toEqual(['deliver:tool-start', 'onToolStart', 'timedOut'])
  })

  it('onToolStart が reject したらログを出して応答し、onToolStartTimedOut は呼ばない', async () => {
    await start({ onToolStart: vi.fn(async () => Promise.reject(new Error('boom'))) })
    expect((await post('pre-tool-use', PRE)).status).toBe(200)
    expect(deps.onToolStartTimedOut).not.toHaveBeenCalled()
    expect(deps.log).toHaveBeenCalledWith('[agent-hooks] ツールの開始の待ちに失敗しました: boom')
  })

  it('PreToolUse 以外は onToolStart を待たない', async () => {
    await start()
    await post('post-tool-use', { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'toolu_1' })
    expect(deps.onToolStart).not.toHaveBeenCalled()
  })
})

describe('createAgentHookReceiver(close)', () => {
  it('close で待っている接続も切り、その後の要求は接続できない', async () => {
    await start({ onToolStart: vi.fn(() => new Promise<void>(() => undefined)), preToolUseWaitMs: 10_000 })
    const pending = post('pre-tool-use', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 't' })
    await vi.waitFor(() => expect(deps.deliver).toHaveBeenCalledOnce())
    receiver?.close()
    await expect(pending).rejects.toThrow()
    await expect(post('stop', { hook_event_name: 'Stop' })).rejects.toThrow()
    await expect(receiver?.ensureListening()).rejects.toThrow('受け口は閉じています')
  })
})
```
（`it.each` の各行は、`start()` の後に `port` が決まるため、`send` を関数で渡している。）

- [ ] **Step 5: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentHookReceiver.test.ts`
Expected: FAIL（`Cannot find module '../agentHookReceiver'`）

- [ ] **Step 6: 受け口を実装する**

`src/main/agentHookReceiver.ts`:
```ts
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { agentHookEventOfPath } from './agentHookProtocol'
import { parseAgentHookRequest } from './agentHookEvents'
import type { AgentHookBody, AgentHookEvent } from './agentHookEvents'

// claude の http の hook の受け口(設計書「受け口」)。127.0.0.1 のランダムなポートだけで待ち受け、セッションごとのトークンの
// SHA-256 で照合する(文字列の比較の時間で推測させない)。トークン・本文はログ・応答に出さない(L-017)。拒んだ要求は理由ごとの
// 件数だけを出す。PreToolUse は deliver(追跡の更新と段階の通知)を終えてから onToolStart を待ち、上限で打ち切る(L-052)

export const AGENT_PRE_TOOL_USE_WAIT_MS = 5_000
export const AGENT_HOOK_MAX_BODY_BYTES = 16 * 1024 * 1024
export const AGENT_HOOK_HEADERS_TIMEOUT_MS = 5_000
export const AGENT_HOOK_REQUEST_TIMEOUT_MS = 15_000

export type AgentHookRejectReason = 'method' | 'path' | 'host' | 'origin' | 'token' | 'content-type' | 'too-large'

export interface AgentHookOwner {
  ownerId: number
  sessionId: string
}

export interface AgentHookReceiverDeps {
  deliver(ownerId: number, sessionId: string, event: AgentHookEvent): void
  onToolStart(ownerId: number, signal: AbortSignal): Promise<void>
  onToolStartTimedOut(ownerId: number): void
  log(message: string): void
  preToolUseWaitMs?: number
}

export interface AgentHookReceiver {
  /** 初回に listen する。Promise を共有し、失敗したら捨てて次の呼び出しで始め直す */
  ensureListening(): Promise<{ baseUrl: string }>
  addToken(token: string, owner: AgentHookOwner): void
  removeToken(token: string): void
  /** 待ち受けをやめ、つながっている接続も切る(will-quit) */
  close(): void
}

const BEARER_PATTERN = /^Bearer ([0-9a-f]{64})$/
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

export function createAgentHookReceiver({
  deliver,
  onToolStart,
  onToolStartTimedOut,
  log,
  preToolUseWaitMs = AGENT_PRE_TOOL_USE_WAIT_MS
}: AgentHookReceiverDeps): AgentHookReceiver {
  const owners = new Map<string, AgentHookOwner>()
  const counts = new Map<string, number>()
  let server: Server | null = null
  let listening: Promise<{ baseUrl: string }> | null = null
  let port = 0
  let closed = false

  /** 最初の 1 件と 100 件ごとにだけログに出す */
  const count = (label: string, reason: string): void => {
    const key = `${label}\u0000${reason}`
    const next = (counts.get(key) ?? 0) + 1
    counts.set(key, next)
    if (next === 1 || next % 100 === 0) log(`[agent-hooks] ${label}: ${reason} ${next} 件`)
  }

  const respond = (res: ServerResponse, status: number): void => {
    if (res.destroyed || res.writableEnded) return
    res.writeHead(status, { 'Content-Length': '0' })
    res.end()
  }

  const reject = (req: IncomingMessage, res: ServerResponse, status: number, reason: AgentHookRejectReason): void => {
    count('拒んだ要求', reason)
    req.resume()
    respond(res, status)
  }

  const ownerOf = (authorization: string | undefined): AgentHookOwner | null => {
    const match = BEARER_PATTERN.exec(authorization ?? '')
    if (match === null) return null
    return owners.get(sha256(match[1])) ?? null
  }

  /** 16 MiB までを持ち、超えたら先を持たずに最後まで読み捨てる。読み込みの失敗も unreadable として返す(L-002) */
  const readBody = (req: IncomingMessage): Promise<AgentHookBody> =>
    new Promise((resolve) => {
      const chunks: Buffer[] = []
      let size = 0
      let tooLarge = false
      req.on('data', (chunk: Buffer) => {
        if (tooLarge) return
        size += chunk.length
        if (size > AGENT_HOOK_MAX_BODY_BYTES) {
          tooLarge = true
          chunks.length = 0
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () =>
        resolve(tooLarge ? { kind: 'too-large' } : { kind: 'text', text: Buffer.concat(chunks).toString('utf8') })
      )
      req.on('error', () => resolve({ kind: 'unreadable' }))
      req.on('close', () => {
        if (!req.complete) resolve({ kind: 'unreadable' })
      })
    })

  const waitForToolStart = async (ownerId: number): Promise<void> => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), preToolUseWaitMs)
    })
    const started = onToolStart(ownerId, controller.signal).then(
      () => 'started' as const,
      (err: unknown) => {
        log(`[agent-hooks] ツールの開始の待ちに失敗しました: ${err instanceof Error ? err.message : String(err)}`)
        return 'failed' as const
      }
    )
    const result = await Promise.race([started, timedOut])
    clearTimeout(timer)
    if (result === 'timeout') {
      controller.abort()
      onToolStartTimedOut(ownerId)
    }
  }

  const hostOk = (host: string | undefined): boolean => host === `127.0.0.1:${port}`
  const contentTypeOk = (value: string | undefined): boolean =>
    value !== undefined && value.toLowerCase().startsWith('application/json')

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') return reject(req, res, 405, 'method')
    const event = agentHookEventOfPath(req.url ?? '')
    if (event === null) return reject(req, res, 404, 'path')
    if (!hostOk(req.headers.host)) return reject(req, res, 403, 'host')
    if (req.headers.origin !== undefined) return reject(req, res, 403, 'origin')
    const owner = ownerOf(req.headers.authorization)
    if (owner === null) return reject(req, res, 401, 'token')
    if (!contentTypeOk(req.headers['content-type'])) return reject(req, res, 415, 'content-type')
    const body = await readBody(req)
    if (body.kind === 'too-large') count('拒んだ要求', 'too-large')
    const { event: parsed, notes } = parseAgentHookRequest(event, body)
    for (const note of notes) count('読めない知らせ', note)
    // 知らせ 1 件につき 1 回。追跡はこの中で段階の通知まで同期的に済ませる
    deliver(owner.ownerId, owner.sessionId, parsed)
    if (event === 'PreToolUse') await waitForToolStart(owner.ownerId)
    respond(res, 200)
  }

  return {
    ensureListening() {
      if (closed) return Promise.reject(new Error('受け口は閉じています'))
      if (listening === null) {
        const attempt = new Promise<{ baseUrl: string }>((resolve, rejectListen) => {
          const created = createServer((req, res) => {
            void handle(req, res).catch((err: unknown) => {
              log(`[agent-hooks] 要求の処理に失敗しました: ${err instanceof Error ? err.message : String(err)}`)
              respond(res, 500)
            })
          })
          created.headersTimeout = AGENT_HOOK_HEADERS_TIMEOUT_MS
          created.requestTimeout = AGENT_HOOK_REQUEST_TIMEOUT_MS
          created.once('error', (err) => {
            created.close()
            rejectListen(err)
          })
          created.listen({ host: '127.0.0.1', port: 0 }, () => {
            const address = created.address()
            if (closed || address === null || typeof address === 'string') {
              created.close()
              rejectListen(new Error('受け口は閉じています'))
              return
            }
            port = address.port
            server = created
            resolve({ baseUrl: `http://127.0.0.1:${port}` })
          })
        })
        listening = attempt
        attempt.catch(() => {
          if (listening === attempt) listening = null
        })
      }
      return listening
    },
    addToken(token, owner) {
      owners.set(sha256(token), owner)
    },
    removeToken(token) {
      owners.delete(sha256(token))
    },
    close() {
      closed = true
      owners.clear()
      if (server !== null) {
        server.close()
        server.closeAllConnections()
        server = null
      }
    }
  }
}
```

- [ ] **Step 7: 通す**

Run: `npx vitest run src/main/__tests__/agentHookEvents.test.ts src/main/__tests__/agentHookReceiver.test.ts`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/agentHookEvents.ts src/main/agentHookReceiver.ts src/main/__tests__/helpers/agentHookHttp.ts src/main/__tests__/agentHookEvents.test.ts src/main/__tests__/agentHookReceiver.test.ts && npx eslint --max-warnings 0 src/main/agentHookEvents.ts src/main/agentHookReceiver.ts src/main/__tests__/helpers/agentHookHttp.ts src/main/__tests__/agentHookEvents.test.ts src/main/__tests__/agentHookReceiver.test.ts`
Expected: エラー・警告なし

- [ ] **Step 8: 変異で確かめる**

`agentHookReceiver.ts` の `handle` の `deliver(...)` の行と `if (event === 'PreToolUse') await waitForToolStart(...)` の行の順序を入れ替えて `npx vitest run src/main/__tests__/agentHookReceiver.test.ts` を走らせ、「deliver(tool-start)を呼び終えてから onToolStart を呼び」のテストが落ちることを確かめてから戻す。`hostOk` を常に `true` にして「Host が localhost」の行が落ちることも確かめて戻す。

---

### Task 4: 区間の追跡（`agentToolActivity.ts`）

> **気をつける知見:** L-002（`pending` は `agent`）・L-044（知らない・読めない知らせで区間を閉じない）・L-052（15 分・15 秒）・L-061

**Files:**
- Create: `src/main/agentToolActivity.ts`
- Test: `src/main/__tests__/agentToolActivity.test.ts`（新規。偽のタイマー。受け口なしで `deliver` を直接呼ぶ）

**Interfaces:**
- Consumes: Task 3 の `AgentHookEvent`・`ToolIdRead`（`src/main/agentHookEvents.ts`）
- Produces:
```ts
// src/main/agentToolActivity.ts
export const AGENT_TOOL_END_GRACE_MS = 2_000
export const AGENT_TOOL_INTERVAL_MAX_MS = 15 * 60 * 1000
export const AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS = 15_000
export const AGENT_TOOL_OPEN_MAX = 256
export const AGENT_DROPPED_TOOL_IDS_MAX = 1_024
export type AgentHooksUnavailableReason = 'receiver-unavailable' | 'claude-version-unsupported'
export type AgentHooksLostReason = 'hooks-not-confirmed' | AgentHooksUnavailableReason
export type AgentToolPhase = 'idle' | 'agent' | 'paused'
export interface AgentToolActivitySignal {
  phase: AgentToolPhase
  lost: AgentHooksLostReason | null
  unassignable: boolean
}
export type AgentHookSessionInitialState =
  | { kind: 'pending' }
  | { kind: 'unconfirmed'; reason: AgentHooksUnavailableReason }
export interface AgentToolActivityDeps {
  /** ウィンドウの合図(activityOf の値)が変わったときに同期的に呼ぶ(段階 A は何もしない。段階 B で syncAttribution につなぐ) */
  onPhaseChange(ownerId: number): void
  /** 開発版のログ(1 行ずつ)。null なら出さない */
  devLog: ((line: string) => void) | null
  /** 常に出すログ */
  warn(message: string): void
}
export interface AgentToolActivity {
  addSession(ownerId: number, sessionId: string, state: AgentHookSessionInitialState): void
  removeSession(ownerId: number, sessionId: string): void
  deliver(ownerId: number, sessionId: string, event: AgentHookEvent): void
  reportWorking(ownerId: number, sessionId: string): void
  activityOf(ownerId: number): AgentToolActivitySignal
  toolStartSeqOf(ownerId: number): number
  close(): void
}
export function createAgentToolActivity(deps: AgentToolActivityDeps): AgentToolActivity
```

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentToolActivity.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_DROPPED_TOOL_IDS_MAX,
  AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS,
  AGENT_TOOL_END_GRACE_MS,
  AGENT_TOOL_INTERVAL_MAX_MS,
  AGENT_TOOL_OPEN_MAX,
  createAgentToolActivity
} from '../agentToolActivity'
import type { AgentToolActivity, AgentToolActivityDeps } from '../agentToolActivity'
import type { AgentHookEvent } from '../agentHookEvents'

const prompt = (): AgentHookEvent => ({
  kind: 'confirm-only',
  reason: 'prompt-submit',
  hookEventName: 'UserPromptSubmit',
  toolName: null
})
const start = (id: string | null, agentId: string | null = null): AgentHookEvent => ({
  kind: 'tool-start',
  hookEventName: 'PreToolUse',
  toolName: 'Edit',
  toolId: id === null ? { kind: 'unreadable' } : { kind: 'read', id },
  agentId
})
const end = (id: string | null, agentId: string | null = null): AgentHookEvent => ({
  kind: 'tool-end',
  hookEventName: 'PostToolUse',
  toolName: 'Edit',
  toolId: id === null ? { kind: 'unreadable' } : { kind: 'read', id },
  agentId
})
const subagentStop = (agentId: string): AgentHookEvent => ({
  kind: 'subagent-stop',
  hookEventName: 'SubagentStop',
  toolName: null,
  agentId
})
const turnEnd = (): AgentHookEvent => ({ kind: 'turn-end', hookEventName: 'Stop', toolName: null })
const sessionEnd = (): AgentHookEvent => ({ kind: 'session-end', hookEventName: 'SessionEnd', toolName: null })

let onPhaseChange: ReturnType<typeof vi.fn<AgentToolActivityDeps['onPhaseChange']>>
let devLog: ReturnType<typeof vi.fn<(line: string) => void>>
let warn: ReturnType<typeof vi.fn<AgentToolActivityDeps['warn']>>
let tracker: AgentToolActivity

beforeEach(() => {
  vi.useFakeTimers()
  onPhaseChange = vi.fn()
  devLog = vi.fn()
  warn = vi.fn()
  tracker = createAgentToolActivity({ onPhaseChange, devLog, warn })
})

afterEach(() => {
  tracker.close()
  vi.useRealTimers()
})

const phase = (ownerId = 1): string => tracker.activityOf(ownerId).phase
/** pending で足し、プロンプトの知らせで confirmed にする */
const confirmed = (ownerId = 1, sessionId = 's1'): void => {
  tracker.addSession(ownerId, sessionId, { kind: 'pending' })
  tracker.deliver(ownerId, sessionId, prompt())
}
/** 区間がすべて閉じた後の猶予を過ぎる */
const passGrace = (): void => {
  vi.advanceTimersByTime(AGENT_TOOL_END_GRACE_MS)
}

describe('createAgentToolActivity(定数)', () => {
  it('設計書の値', () => {
    expect(AGENT_TOOL_END_GRACE_MS).toBe(2_000)
    expect(AGENT_TOOL_INTERVAL_MAX_MS).toBe(15 * 60 * 1000)
    expect(AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS).toBe(15_000)
    expect(AGENT_TOOL_OPEN_MAX).toBe(256)
    expect(AGENT_DROPPED_TOOL_IDS_MAX).toBe(1_024)
  })
})

describe('createAgentToolActivity(あるべき段階)', () => {
  it('セッションの無い所有者は paused(合図なし)', () => {
    expect(tracker.activityOf(1)).toEqual({ phase: 'paused', lost: null, unassignable: false })
  })

  it('pending のセッションがあれば agent。プロンプトの知らせで confirmed・idle になる', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    expect(tracker.activityOf(1)).toEqual({ phase: 'agent', lost: null, unassignable: false })
    expect(onPhaseChange).toHaveBeenCalledExactlyOnceWith(1)
    tracker.deliver(1, 's1', prompt())
    expect(tracker.activityOf(1)).toEqual({ phase: 'idle', lost: null, unassignable: false })
    expect(onPhaseChange).toHaveBeenCalledTimes(2)
  })

  it('最初の知らせが PreToolUse なら、pending の agent から confirmed の agent で変わらず、onPhaseChange を呼ばない', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    onPhaseChange.mockClear()
    tracker.deliver(1, 's1', start('a'))
    expect(phase()).toBe('agent')
    expect(onPhaseChange).not.toHaveBeenCalled()
  })

  it('hooks なしで起動した(unconfirmed)セッションがあれば、区別をやめる合図と agent', () => {
    confirmed()
    tracker.addSession(1, 's2', { kind: 'unconfirmed', reason: 'claude-version-unsupported' })
    expect(tracker.activityOf(1)).toEqual({ phase: 'agent', lost: 'claude-version-unsupported', unassignable: false })
    tracker.removeSession(1, 's2')
    expect(tracker.activityOf(1)).toEqual({ phase: 'idle', lost: null, unassignable: false })
  })

  it('pending と confirmed が混ざれば agent。confirmed が 1 つも無くなれば paused(猶予の間でも)', () => {
    confirmed(1, 's1')
    tracker.addSession(1, 's2', { kind: 'pending' })
    expect(phase()).toBe('agent')
    tracker.removeSession(1, 's2')
    expect(phase()).toBe('idle')
    tracker.deliver(1, 's1', start('a'))
    tracker.deliver(1, 's1', end('a'))
    expect(phase()).toBe('agent')
    tracker.removeSession(1, 's1')
    expect(phase()).toBe('paused')
  })

  it('所有者ごとに独立している', () => {
    confirmed(1, 's1')
    confirmed(2, 's2')
    tracker.deliver(1, 's1', start('a'))
    expect(phase(1)).toBe('agent')
    expect(phase(2)).toBe('idle')
  })

  it('変わったときだけ onPhaseChange を呼ぶ', () => {
    confirmed()
    onPhaseChange.mockClear()
    tracker.deliver(1, 's1', prompt())
    tracker.deliver(1, 's1', turnEnd())
    expect(onPhaseChange).not.toHaveBeenCalled()
  })
})

describe('createAgentToolActivity(区間と猶予)', () => {
  it('区間が閉じてから 2 秒は agent、その後 idle', () => {
    confirmed()
    tracker.deliver(1, 's1', start('a'))
    tracker.deliver(1, 's1', end('a'))
    vi.advanceTimersByTime(AGENT_TOOL_END_GRACE_MS - 1)
    expect(phase()).toBe('agent')
    vi.advanceTimersByTime(1)
    expect(phase()).toBe('idle')
  })

  it('猶予の間の tool-start で猶予を取り消し、段階は agent のまま変わらない', () => {
    confirmed()
    tracker.deliver(1, 's1', start('a'))
    tracker.deliver(1, 's1', end('a'))
    vi.advanceTimersByTime(1_000)
    onPhaseChange.mockClear()
    tracker.deliver(1, 's1', start('b'))
    vi.advanceTimersByTime(10_000)
    expect(phase()).toBe('agent')
    expect(onPhaseChange).not.toHaveBeenCalled()
    tracker.deliver(1, 's1', end('b'))
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('同じ ID の tool-start が 2 回でも区間は 1 つ', () => {
    confirmed()
    tracker.deliver(1, 's1', start('a'))
    tracker.deliver(1, 's1', start('a'))
    tracker.deliver(1, 's1', end('a'))
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('別のセッションの区間が開いていれば agent(同じウィンドウのタブは記録を共有する)', () => {
    confirmed(1, 's1')
    confirmed(1, 's2')
    tracker.deliver(1, 's2', start('a'))
    passGrace()
    expect(phase()).toBe('agent')
  })

  it('turn-end は ID があって agent_id の無い区間だけを閉じ、agent_id のある区間と ID なしの区間は残す', () => {
    confirmed()
    tracker.deliver(1, 's1', start('main'))
    tracker.deliver(1, 's1', start('sub', 'ag-1'))
    tracker.deliver(1, 's1', start(null))
    tracker.deliver(1, 's1', turnEnd())
    passGrace()
    expect(phase()).toBe('agent')
    tracker.deliver(1, 's1', end('sub', 'ag-1'))
    passGrace()
    // ID なしの区間が残る
    expect(phase()).toBe('agent')
  })

  it('subagent-stop はその agent_id の区間だけを閉じる', () => {
    confirmed()
    tracker.deliver(1, 's1', start('x', 'ag-1'))
    tracker.deliver(1, 's1', start('y', 'ag-2'))
    tracker.deliver(1, 's1', subagentStop('ag-1'))
    passGrace()
    expect(phase()).toBe('agent')
    tracker.deliver(1, 's1', subagentStop('ag-2'))
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('tool-end の規則: 外した ID の遅れた知らせは何も閉じず、どこにも無い読めた ID は ID なしの一番古い区間を閉じ、読めない ID は何も閉じない', () => {
    confirmed()
    tracker.deliver(1, 's1', start(null))
    tracker.deliver(1, 's1', start('a'))
    tracker.deliver(1, 's1', turnEnd())
    // a は外した ID。遅れた PostToolUse で ID なしの区間を閉じない
    tracker.deliver(1, 's1', end('a'))
    passGrace()
    expect(phase()).toBe('agent')
    // 読めない ID の tool-end は何も閉じない
    tracker.deliver(1, 's1', end(null))
    passGrace()
    expect(phase()).toBe('agent')
    // どこにも無い読めた ID は、PreToolUse を読めなかった区間の終わりとみなす
    tracker.deliver(1, 's1', end('zzz'))
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('外した ID の控えは 1 回で消え、2 回目の同じ ID は ID なしの区間を閉じる', () => {
    confirmed()
    tracker.deliver(1, 's1', start('a'))
    tracker.deliver(1, 's1', turnEnd())
    tracker.deliver(1, 's1', start(null))
    tracker.deliver(1, 's1', end('a'))
    passGrace()
    expect(phase()).toBe('agent')
    tracker.deliver(1, 's1', end('a'))
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('session-end はすべての区間(ID なしを含む)を閉じ、セッションと確かめた状態は残す(/clear の後の知らせを受け付ける)', () => {
    confirmed()
    tracker.deliver(1, 's1', start('a'))
    tracker.deliver(1, 's1', start(null))
    tracker.deliver(1, 's1', sessionEnd())
    passGrace()
    expect(phase()).toBe('idle')
    tracker.deliver(1, 's1', start('b'))
    expect(phase()).toBe('agent')
    // session-end で外した a の遅れた知らせは、別の ID なしの区間を閉じない
    tracker.deliver(1, 's1', start(null))
    tracker.deliver(1, 's1', end('b'))
    tracker.deliver(1, 's1', end('a'))
    passGrace()
    expect(phase()).toBe('agent')
  })

  it('pty の終了(removeSession)で区間ごとセッションを外す', () => {
    confirmed(1, 's1')
    confirmed(1, 's2')
    tracker.deliver(1, 's1', start(null))
    tracker.removeSession(1, 's1')
    expect(phase()).toBe('agent')
    passGrace()
    expect(phase()).toBe('idle')
  })

  it(`開いた区間は ${AGENT_TOOL_OPEN_MAX} 件まで。超えたら一番古い ID を外し、外した ID として控える`, () => {
    confirmed()
    tracker.deliver(1, 's1', start(null))
    for (let i = 0; i <= AGENT_TOOL_OPEN_MAX; i++) tracker.deliver(1, 's1', start(`id-${i}`))
    // id-0 は上限で外れた。遅れた知らせで ID なしの区間を閉じない
    tracker.deliver(1, 's1', end('id-0'))
    for (let i = 1; i <= AGENT_TOOL_OPEN_MAX; i++) tracker.deliver(1, 's1', end(`id-${i}`))
    passGrace()
    expect(phase()).toBe('agent')
  })

  it(`外した ID の控えは ${AGENT_DROPPED_TOOL_IDS_MAX} 件まで。超えたら古い方から捨てる`, () => {
    confirmed()
    for (let i = 0; i <= AGENT_DROPPED_TOOL_IDS_MAX; i++) {
      tracker.deliver(1, 's1', start(`id-${i}`))
      tracker.deliver(1, 's1', turnEnd())
    }
    tracker.deliver(1, 's1', start(null))
    // id-1 はまだ控えにある(何も閉じない)
    tracker.deliver(1, 's1', end('id-1'))
    passGrace()
    expect(phase()).toBe('agent')
    // id-0 は控えから捨てられたため、どこにも無い ID として ID なしの区間を閉じる
    tracker.deliver(1, 's1', end('id-0'))
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('ツールの開始の通し番号は tool-start のたびに増え、セッションが 0 になっても戻らない', () => {
    confirmed()
    expect(tracker.toolStartSeqOf(1)).toBe(0)
    tracker.deliver(1, 's1', start('a'))
    tracker.deliver(1, 's1', start('a'))
    tracker.deliver(1, 's1', start(null))
    expect(tracker.toolStartSeqOf(1)).toBe(3)
    expect(tracker.toolStartSeqOf(2)).toBe(0)
    tracker.removeSession(1, 's1')
    expect(tracker.toolStartSeqOf(1)).toBe(3)
  })

  it('登録されていないセッションの知らせは捨てる', () => {
    tracker.deliver(1, 'unknown', start('a'))
    expect(tracker.activityOf(1)).toEqual({ phase: 'paused', lost: null, unassignable: false })
    expect(tracker.toolStartSeqOf(1)).toBe(0)
  })
})

describe('createAgentToolActivity(期限切れ)', () => {
  it('15 分を超えた区間は外さずに期限切れにし、合図 unassignable を立てる。自分の閉じ方(turn-end)で閉じて下ろす', () => {
    confirmed()
    tracker.deliver(1, 's1', start('a'))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS - 1)
    expect(tracker.activityOf(1).unassignable).toBe(false)
    onPhaseChange.mockClear()
    vi.advanceTimersByTime(1)
    expect(tracker.activityOf(1)).toEqual({ phase: 'agent', lost: null, unassignable: true })
    expect(onPhaseChange).toHaveBeenCalledExactlyOnceWith(1)
    expect(devLog.mock.calls.some(([line]) => line.includes('event=interval-expired'))).toBe(true)
    tracker.deliver(1, 's1', turnEnd())
    expect(tracker.activityOf(1).unassignable).toBe(false)
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('agent_id のある期限切れの区間はメインの turn-end では閉じず、同じ agent_id の subagent-stop で閉じる', () => {
    confirmed()
    tracker.deliver(1, 's1', start('a', 'ag-1'))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS)
    tracker.deliver(1, 's1', turnEnd())
    expect(tracker.activityOf(1).unassignable).toBe(true)
    tracker.deliver(1, 's1', subagentStop('ag-1'))
    expect(tracker.activityOf(1).unassignable).toBe(false)
  })

  it('ID なしの期限切れの区間は turn-end では閉じず、session-end で閉じる', () => {
    confirmed()
    tracker.deliver(1, 's1', start(null))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS)
    tracker.deliver(1, 's1', turnEnd())
    expect(tracker.activityOf(1).unassignable).toBe(true)
    tracker.deliver(1, 's1', sessionEnd())
    expect(tracker.activityOf(1).unassignable).toBe(false)
  })

  it('期限切れの区間は自分の tool-end でも閉じる。pty の終了でも閉じる', () => {
    confirmed(1, 's1')
    confirmed(1, 's2')
    tracker.deliver(1, 's1', start('a'))
    tracker.deliver(1, 's2', start(null))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS)
    tracker.deliver(1, 's1', end('a'))
    expect(tracker.activityOf(1).unassignable).toBe(true)
    tracker.removeSession(1, 's2')
    expect(tracker.activityOf(1).unassignable).toBe(false)
  })

  it('unassignable は段階の分岐と別に求める(区別をやめる合図と同時に立つ)', () => {
    confirmed(1, 's1')
    tracker.deliver(1, 's1', start('a'))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS)
    tracker.addSession(1, 's2', { kind: 'unconfirmed', reason: 'receiver-unavailable' })
    expect(tracker.activityOf(1)).toEqual({ phase: 'agent', lost: 'receiver-unavailable', unassignable: true })
  })
})

describe('createAgentToolActivity(作業中の知らせと確かめた状態)', () => {
  it('pending の間の作業中の知らせから 15 秒、知らせが届かなければ unconfirmed(hooks-not-confirmed)にしてログに出す', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    tracker.reportWorking(1, 's1')
    vi.advanceTimersByTime(AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS - 1)
    expect(tracker.activityOf(1).lost).toBeNull()
    vi.advanceTimersByTime(1)
    expect(tracker.activityOf(1)).toEqual({ phase: 'agent', lost: 'hooks-not-confirmed', unassignable: false })
    expect(warn).toHaveBeenCalledWith('[agent-hooks] hooks の知らせが届かないため、区別をやめます')
  })

  it('15 秒の間にどれかの知らせが届けばタイマーを外し、confirmed のまま', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    tracker.reportWorking(1, 's1')
    vi.advanceTimersByTime(10_000)
    tracker.deliver(1, 's1', turnEnd())
    vi.advanceTimersByTime(AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS)
    expect(tracker.activityOf(1)).toEqual({ phase: 'idle', lost: null, unassignable: false })
  })

  it('2 回目の作業中の知らせではタイマーを張り直さない', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    tracker.reportWorking(1, 's1')
    vi.advanceTimersByTime(10_000)
    tracker.reportWorking(1, 's1')
    vi.advanceTimersByTime(5_000)
    expect(tracker.activityOf(1).lost).toBe('hooks-not-confirmed')
  })

  it('confirmed のセッションへの作業中の知らせは何もしない', () => {
    confirmed()
    tracker.reportWorking(1, 's1')
    vi.advanceTimersByTime(AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS)
    expect(tracker.activityOf(1).lost).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('別のウィンドウのセッション・知らないセッションの作業中の知らせは捨ててログに出す', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    tracker.reportWorking(2, 's1')
    tracker.reportWorking(1, 'unknown')
    vi.advanceTimersByTime(AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS)
    expect(tracker.activityOf(1).lost).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith('[agent-hooks] 作業中の知らせのセッションが見つかりません')
  })

  it('unconfirmed(hooks-not-confirmed)の後に知らせが届けば confirmed に戻す', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    tracker.reportWorking(1, 's1')
    vi.advanceTimersByTime(AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS)
    tracker.deliver(1, 's1', prompt())
    expect(tracker.activityOf(1)).toEqual({ phase: 'idle', lost: null, unassignable: false })
  })
})

describe('createAgentToolActivity(ログと後始末)', () => {
  it('開発版のログに 1 行ずつ出す(トークン・本文は無い)', () => {
    tracker.addSession(1, 'abcdefgh-1234', { kind: 'pending' })
    tracker.deliver(1, 'abcdefgh-1234', start('toolu_1'))
    expect(devLog.mock.calls.map(([line]) => line)).toEqual([
      '[agent-hooks] owner=1 session=abcdefgh event=起動 tool=- id=- agent=- hooks=pending phase=paused→agent',
      '[agent-hooks] owner=1 session=abcdefgh event=PreToolUse tool=Edit id=あり agent=なし hooks=confirmed phase=agent→agent'
    ])
  })

  it('devLog が null なら出さない', () => {
    const quiet = createAgentToolActivity({ onPhaseChange, devLog: null, warn })
    quiet.addSession(1, 's1', { kind: 'pending' })
    expect(devLog).not.toHaveBeenCalled()
    quiet.close()
  })

  it('close でタイマーが残らず、onPhaseChange を呼ばない', () => {
    confirmed()
    tracker.deliver(1, 's1', start('a'))
    tracker.deliver(1, 's1', start('b'))
    tracker.deliver(1, 's1', end('a'))
    tracker.addSession(1, 's2', { kind: 'pending' })
    tracker.reportWorking(1, 's2')
    onPhaseChange.mockClear()
    tracker.close()
    expect(vi.getTimerCount()).toBe(0)
    expect(onPhaseChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentToolActivity.test.ts`
Expected: FAIL（`Cannot find module '../agentToolActivity'`）

- [ ] **Step 3: 実装する**

`src/main/agentToolActivity.ts`:
```ts
import type { AgentHookEvent } from './agentHookEvents'

// エージェントのツールの区間の追跡(設計書「ツールの区間の追跡」)。セッションごとに hooks が効いているか(pending・confirmed・
// unconfirmed)と開いた区間を持ち、ウィンドウ(所有者)ごとのあるべき段階(idle・agent・paused)と、区別をやめる合図(lost)・
// 割り当てられない合図(unassignable)を求める。合図が変わったら onPhaseChange を同期的に呼ぶ(段階 A は何もしない)。
// 区間が開いたままになる側(利用者の編集をエージェントに数える)に倒し、知らない・読めない知らせで区間を閉じない(L-002・L-044)

export const AGENT_TOOL_END_GRACE_MS = 2_000
export const AGENT_TOOL_INTERVAL_MAX_MS = 15 * 60 * 1000
export const AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS = 15_000
export const AGENT_TOOL_OPEN_MAX = 256
export const AGENT_DROPPED_TOOL_IDS_MAX = 1_024

export type AgentHooksUnavailableReason = 'receiver-unavailable' | 'claude-version-unsupported'
export type AgentHooksLostReason = 'hooks-not-confirmed' | AgentHooksUnavailableReason
export type AgentToolPhase = 'idle' | 'agent' | 'paused'

export interface AgentToolActivitySignal {
  phase: AgentToolPhase
  lost: AgentHooksLostReason | null
  unassignable: boolean
}

export type AgentHookSessionInitialState =
  | { kind: 'pending' }
  | { kind: 'unconfirmed'; reason: AgentHooksUnavailableReason }

export interface AgentToolActivityDeps {
  onPhaseChange(ownerId: number): void
  devLog: ((line: string) => void) | null
  warn(message: string): void
}

export interface AgentToolActivity {
  addSession(ownerId: number, sessionId: string, state: AgentHookSessionInitialState): void
  removeSession(ownerId: number, sessionId: string): void
  deliver(ownerId: number, sessionId: string, event: AgentHookEvent): void
  reportWorking(ownerId: number, sessionId: string): void
  activityOf(ownerId: number): AgentToolActivitySignal
  toolStartSeqOf(ownerId: number): number
  close(): void
}

type Timer = ReturnType<typeof setTimeout>
type HooksState = { kind: 'pending' } | { kind: 'confirmed' } | { kind: 'unconfirmed'; reason: AgentHooksLostReason }

interface OpenInterval {
  openedAt: number
  expired: boolean
}

interface IdInterval extends OpenInterval {
  agentId: string | null
}

interface SessionState {
  hooks: HooksState
  /** pending の間に作業中の知らせを受けて張った 15 秒のタイマー */
  workingTimer: Timer | null
  openTools: Map<string, IdInterval>
  anonymousOpen: OpenInterval[]
  /** 区間を閉じる知らせを待たずに外した ID(遅れた tool-end で別の区間を閉じないため) */
  droppedToolIds: Set<string>
}

interface OwnerState {
  sessions: Map<string, SessionState>
  graceTimer: Timer | null
  expiryTimer: Timer | null
  lastSignal: AgentToolActivitySignal
}

/** ログの 1 行の中身(イベントの名前・ツールの名前・ID の有無・agent_id の有無) */
interface LogDetail {
  sessionId: string | null
  event: string
  tool?: string | null
  hasId?: boolean
  hasAgent?: boolean
}

const PAUSED: AgentToolActivitySignal = { phase: 'paused', lost: null, unassignable: false }

const startTimer = (fn: () => void, ms: number): Timer => {
  const handle = setTimeout(fn, ms)
  handle.unref()
  return handle
}

const sameSignal = (a: AgentToolActivitySignal, b: AgentToolActivitySignal): boolean =>
  a.phase === b.phase && a.lost === b.lost && a.unassignable === b.unassignable

const intervalsOf = (session: SessionState): OpenInterval[] => [...session.openTools.values(), ...session.anonymousOpen]
const openCountOf = (owner: OwnerState): number =>
  [...owner.sessions.values()].reduce((sum, s) => sum + s.openTools.size + s.anonymousOpen.length, 0)

function signalOf(owner: OwnerState | undefined): AgentToolActivitySignal {
  if (owner === undefined || owner.sessions.size === 0) return PAUSED
  const sessions = [...owner.sessions.values()]
  // 段階の分岐と別に、生きているセッションのどれかに期限切れの区間が残っているかで求める
  const unassignable = sessions.some((s) => intervalsOf(s).some((interval) => interval.expired))
  for (const session of sessions) {
    if (session.hooks.kind === 'unconfirmed') return { phase: 'agent', lost: session.hooks.reason, unassignable }
  }
  if (sessions.some((s) => s.hooks.kind === 'pending')) return { phase: 'agent', lost: null, unassignable }
  const confirmed = sessions.filter((s) => s.hooks.kind === 'confirmed')
  if (confirmed.length === 0) return { phase: 'paused', lost: null, unassignable }
  const open = confirmed.some((s) => s.openTools.size > 0 || s.anonymousOpen.length > 0)
  if (open || owner.graceTimer !== null) return { phase: 'agent', lost: null, unassignable }
  return { phase: 'idle', lost: null, unassignable }
}

const hooksLabel = (session: SessionState | undefined): string => {
  if (session === undefined) return '-'
  return session.hooks.kind === 'unconfirmed' ? `unconfirmed(${session.hooks.reason})` : session.hooks.kind
}

const flag = (value: boolean | undefined): string => (value === undefined ? '-' : value ? 'あり' : 'なし')

function remember(dropped: Set<string>, id: string): void {
  dropped.delete(id)
  dropped.add(id)
  while (dropped.size > AGENT_DROPPED_TOOL_IDS_MAX) {
    const oldest = dropped.values().next().value
    if (oldest === undefined) break
    dropped.delete(oldest)
  }
}

export function createAgentToolActivity({ onPhaseChange, devLog, warn }: AgentToolActivityDeps): AgentToolActivity {
  const owners = new Map<number, OwnerState>()
  const toolStartSeq = new Map<number, number>()

  const writeLog = (ownerId: number, detail: LogDetail, session: SessionState | undefined, before: AgentToolPhase, after: AgentToolPhase): void => {
    if (devLog === null) return
    const sessionLabel = detail.sessionId === null ? '-' : detail.sessionId.slice(0, 8)
    devLog(
      `[agent-hooks] owner=${ownerId} session=${sessionLabel} event=${detail.event} tool=${detail.tool ?? '-'} ` +
        `id=${flag(detail.hasId)} agent=${flag(detail.hasAgent)} hooks=${hooksLabel(session)} phase=${before}→${after}`
    )
  }

  /** 合図を求め直し、ログを出し、変わっていれば onPhaseChange を呼ぶ */
  const publish = (ownerId: number, owner: OwnerState, detail: LogDetail): void => {
    const before = owner.lastSignal
    const after = signalOf(owner)
    const session = detail.sessionId === null ? undefined : owner.sessions.get(detail.sessionId)
    writeLog(ownerId, detail, session, before.phase, after.phase)
    if (sameSignal(before, after)) return
    owner.lastSignal = after
    onPhaseChange(ownerId)
  }

  const clearGrace = (owner: OwnerState): void => {
    if (owner.graceTimer !== null) clearTimeout(owner.graceTimer)
    owner.graceTimer = null
  }

  const startGrace = (ownerId: number, owner: OwnerState): void => {
    clearGrace(owner)
    owner.graceTimer = startTimer(() => {
      owner.graceTimer = null
      publish(ownerId, owner, { sessionId: null, event: '猶予の終わり' })
    }, AGENT_TOOL_END_GRACE_MS)
  }

  /** 期限切れのタイマーを、期限切れでない区間の一番早い期限に張り直す(所有者ごとに 1 つ) */
  const scheduleExpiry = (ownerId: number, owner: OwnerState): void => {
    if (owner.expiryTimer !== null) clearTimeout(owner.expiryTimer)
    owner.expiryTimer = null
    let earliest = Infinity
    for (const session of owner.sessions.values()) {
      for (const interval of intervalsOf(session)) {
        if (!interval.expired) earliest = Math.min(earliest, interval.openedAt)
      }
    }
    if (earliest === Infinity) return
    owner.expiryTimer = startTimer(() => {
      owner.expiryTimer = null
      const now = Date.now()
      for (const session of owner.sessions.values()) {
        for (const interval of intervalsOf(session)) {
          if (!interval.expired && interval.openedAt + AGENT_TOOL_INTERVAL_MAX_MS <= now) interval.expired = true
        }
      }
      scheduleExpiry(ownerId, owner)
      publish(ownerId, owner, { sessionId: null, event: 'interval-expired' })
    }, Math.max(0, earliest + AGENT_TOOL_INTERVAL_MAX_MS - Date.now()))
  }

  /** 区間の数が 0 になった時点(どの閉じ方でも)から猶予を数え、期限切れを張り直し、合図を出す */
  const afterMutation = (ownerId: number, owner: OwnerState, openBefore: number, detail: LogDetail): void => {
    if (openBefore > 0 && openCountOf(owner) === 0) startGrace(ownerId, owner)
    scheduleExpiry(ownerId, owner)
    publish(ownerId, owner, detail)
  }

  const disposeSession = (session: SessionState): void => {
    if (session.workingTimer !== null) clearTimeout(session.workingTimer)
    session.workingTimer = null
  }

  /** どの知らせでも、pending・unconfirmed(hooks-not-confirmed)なら confirmed にする */
  const confirm = (session: SessionState): void => {
    if (
      session.hooks.kind === 'pending' ||
      (session.hooks.kind === 'unconfirmed' && session.hooks.reason === 'hooks-not-confirmed')
    ) {
      session.hooks = { kind: 'confirmed' }
      disposeSession(session)
    }
  }

  const apply = (ownerId: number, owner: OwnerState, session: SessionState, event: AgentHookEvent): void => {
    switch (event.kind) {
      case 'confirm-only':
        return
      case 'tool-start': {
        toolStartSeq.set(ownerId, (toolStartSeq.get(ownerId) ?? 0) + 1)
        clearGrace(owner)
        const openedAt = Date.now()
        if (event.toolId.kind === 'read') {
          if (session.openTools.has(event.toolId.id)) return
          session.openTools.set(event.toolId.id, { agentId: event.agentId, openedAt, expired: false })
          if (session.openTools.size > AGENT_TOOL_OPEN_MAX) {
            const oldest = session.openTools.keys().next().value
            if (oldest !== undefined) {
              session.openTools.delete(oldest)
              remember(session.droppedToolIds, oldest)
            }
          }
          return
        }
        session.anonymousOpen.push({ openedAt, expired: false })
        if (session.anonymousOpen.length > AGENT_TOOL_OPEN_MAX) session.anonymousOpen.shift()
        return
      }
      case 'tool-end': {
        // (4) ID を読めない tool-end は何も閉じない
        if (event.toolId.kind !== 'read') return
        const id = event.toolId.id
        // (1) 開いた区間の終わり(期限切れでも同じ)
        if (session.openTools.delete(id)) return
        // (2) 外した区間の遅れた知らせは、控えから消すだけ
        if (session.droppedToolIds.delete(id)) return
        // (3) PreToolUse を読めなかった区間の終わりとみなし、ID なしの一番古い区間を閉じる
        session.anonymousOpen.shift()
        return
      }
      case 'subagent-stop':
        for (const [id, interval] of session.openTools) {
          if (interval.agentId === event.agentId) session.openTools.delete(id)
        }
        return
      case 'turn-end':
        // 背景のサブエージェントは Stop の後も動くため、agent_id のある区間と ID なしの区間は閉じない
        for (const [id, interval] of session.openTools) {
          if (interval.agentId === null) {
            session.openTools.delete(id)
            remember(session.droppedToolIds, id)
          }
        }
        return
      case 'session-end':
        // /clear・/resume でも届くため、セッションは外さず区間だけを閉じる
        for (const id of session.openTools.keys()) remember(session.droppedToolIds, id)
        session.openTools.clear()
        session.anonymousOpen = []
        return
    }
  }

  const detailOf = (sessionId: string, event: AgentHookEvent): LogDetail => {
    const hasId = event.kind === 'tool-start' || event.kind === 'tool-end' ? event.toolId.kind === 'read' : undefined
    const hasAgent =
      event.kind === 'tool-start' || event.kind === 'tool-end'
        ? event.agentId !== null
        : event.kind === 'subagent-stop'
          ? true
          : undefined
    return { sessionId, event: event.hookEventName, tool: event.toolName, hasId, hasAgent }
  }

  return {
    addSession(ownerId, sessionId, state) {
      let owner = owners.get(ownerId)
      if (owner === undefined) {
        owner = { sessions: new Map(), graceTimer: null, expiryTimer: null, lastSignal: PAUSED }
        owners.set(ownerId, owner)
      }
      owner.sessions.set(sessionId, {
        hooks: state.kind === 'pending' ? { kind: 'pending' } : { kind: 'unconfirmed', reason: state.reason },
        workingTimer: null,
        openTools: new Map(),
        anonymousOpen: [],
        droppedToolIds: new Set()
      })
      publish(ownerId, owner, { sessionId, event: '起動' })
    },
    removeSession(ownerId, sessionId) {
      const owner = owners.get(ownerId)
      const session = owner?.sessions.get(sessionId)
      if (owner === undefined || session === undefined) return
      const openBefore = openCountOf(owner)
      disposeSession(session)
      owner.sessions.delete(sessionId)
      if (owner.sessions.size === 0) {
        clearGrace(owner)
        if (owner.expiryTimer !== null) clearTimeout(owner.expiryTimer)
        owner.expiryTimer = null
        owners.delete(ownerId)
      }
      afterMutation(ownerId, owner, owner.sessions.size === 0 ? 0 : openBefore, { sessionId, event: '終了' })
    },
    deliver(ownerId, sessionId, event) {
      const owner = owners.get(ownerId)
      const session = owner?.sessions.get(sessionId)
      if (owner === undefined || session === undefined) return
      const openBefore = openCountOf(owner)
      confirm(session)
      apply(ownerId, owner, session, event)
      afterMutation(ownerId, owner, openBefore, detailOf(sessionId, event))
    },
    reportWorking(ownerId, sessionId) {
      const owner = owners.get(ownerId)
      const session = owner?.sessions.get(sessionId)
      if (owner === undefined || session === undefined) {
        warn('[agent-hooks] 作業中の知らせのセッションが見つかりません')
        return
      }
      if (session.hooks.kind !== 'pending' || session.workingTimer !== null) return
      session.workingTimer = startTimer(() => {
        session.workingTimer = null
        if (session.hooks.kind !== 'pending' || owner.sessions.get(sessionId) !== session) return
        session.hooks = { kind: 'unconfirmed', reason: 'hooks-not-confirmed' }
        warn('[agent-hooks] hooks の知らせが届かないため、区別をやめます')
        publish(ownerId, owner, { sessionId, event: '確認の待ちの終わり' })
      }, AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS)
      publish(ownerId, owner, { sessionId, event: '作業中' })
    },
    activityOf(ownerId) {
      return signalOf(owners.get(ownerId))
    },
    toolStartSeqOf(ownerId) {
      return toolStartSeq.get(ownerId) ?? 0
    },
    close() {
      for (const owner of owners.values()) {
        clearGrace(owner)
        if (owner.expiryTimer !== null) clearTimeout(owner.expiryTimer)
        owner.expiryTimer = null
        for (const session of owner.sessions.values()) disposeSession(session)
      }
      owners.clear()
    }
  }
}
```
（`removeSession` で所有者のセッションが 0 になったときは、所有者を外した後に `afterMutation` を呼ぶ。`openBefore` を 0 として渡し、猶予・期限切れのタイマーを張り直さない〈`scheduleExpiry` は区間が無いので何も張らない〉。合図は `signalOf(owner)` が `PAUSED` を返し、`lastSignal` と違えば `onPhaseChange` を呼ぶ。）

- [ ] **Step 4: 通す**

Run: `npx vitest run src/main/__tests__/agentToolActivity.test.ts`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/agentToolActivity.ts src/main/__tests__/agentToolActivity.test.ts && npx eslint --max-warnings 0 src/main/agentToolActivity.ts src/main/__tests__/agentToolActivity.test.ts`
Expected: エラー・警告なし

- [ ] **Step 5: 変異で確かめる**

`apply` の `turn-end` の `if (interval.agentId === null)` を外して（すべての ID の区間を閉じる）テストを走らせ、「turn-end は ID があって agent_id の無い区間だけを閉じ」「agent_id のある期限切れの区間は…」が落ちることを確かめて戻す。`tool-end` の (2)（`droppedToolIds.delete`）を外して「tool-end の規則」が落ちることも確かめて戻す。

---

### Task 5: 作業中の知らせ（`useAgentHooksWorkingReport`・`agentTerminal:reportWorking`）

> **気をつける知見:** L-019（sessionId だけ・送信元のウィンドウ・メインフレーム）・L-044（不正な sessionId を捨てる）・L-060（hook の引数・handler の依存は必須）

**Files:**
- Create: `src/renderer/src/hooks/useAgentHooksWorkingReport.ts`
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`（import に `useAgentHooksWorkingReport`。L136 の `const activities = useAgentActivity({ tabs: agentSessions.tabs })` の直後に呼び出しを足す）
- Modify: `src/renderer/src/lib/agentTerminalApi.ts`（末尾〈L44-46 の `setAgentTerminalFocused` の後〉に `reportAgentSessionWorking`）
- Modify: `src/preload/api.ts`（L230-231 の `setAgentTerminalFocused` の後に `reportAgentSessionWorking`）
- Modify: `src/preload/index.d.ts`（L142 の `setAgentTerminalFocused(focused: boolean): void` の後に `reportAgentSessionWorking(sessionId: string): void`）
- Modify: `src/renderer/src/__tests__/setup.ts`（L62 の `setAgentTerminalFocused: () => {},` の後に `reportAgentSessionWorking: () => {},`）
- Modify: `src/main/handlers/agentTerminalHandlers.ts`（`AgentTerminalHandlerDeps`〈L19-30〉に必須の `reportWorking`、L100 の `agentTerminal:focus` の前に `agentTerminal:reportWorking` の `ipcMain.on`。先頭の説明〈L16-17〉に「作業中の知らせの sessionId」を足す）
- Modify: `src/main/ipcHandlers.ts`（追跡 `createAgentToolActivity` を組み立て、`registerAgentTerminalHandlers` に `reportWorking` を渡す）
- Test: `src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx`（新規。JSX の `StrictMode` を使うため `.tsx`）
- Test: `src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`（hook の呼び出しの確認を足す）
- Test: `src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`・`src/preload/__tests__/api.test.ts`（窓口と preload の 1 行ずつ）
- Test: `src/main/__tests__/handlers/agentTerminalHandlers.test.ts`（`register` の既定の依存に `reportWorking`、新しい describe）
- Test: `src/main/__tests__/ipcHandlers.test.ts`（追跡の組み立てと `reportWorking` の受け渡し）

**Interfaces:**
- Consumes: Task 4 の `createAgentToolActivity`・`AgentToolActivity['reportWorking']`（`src/main/agentToolActivity.ts`）、既存の `parseAgentSessionId(value: unknown): string`（`src/main/handlers/agentTerminalPayloadParser.ts`。不正なら投げる）、`isMainFrameSender`（`src/main/handlers/ipcSenderGuard.ts`）、`AgentTerminalController['getSessionId'](): string | null`、`AgentActivity`（`src/renderer/src/lib/agentActivity.ts`。`'working' | 'idle' | 'permission' | 'confirm' | 'unknown'`）
- Produces:
```ts
// src/renderer/src/hooks/useAgentHooksWorkingReport.ts
export interface AgentHooksWorkingReportTab {
  slotId: string
  controller: Pick<AgentTerminalController, 'getSessionId'>
}
export interface UseAgentHooksWorkingReportOptions {
  tabs: readonly AgentHooksWorkingReportTab[]
  activities: ReadonlyMap<string, AgentActivity>
}
export function useAgentHooksWorkingReport(options: UseAgentHooksWorkingReportOptions): void

// src/renderer/src/lib/agentTerminalApi.ts
export function reportAgentSessionWorking(sessionId: string): void

// src/preload/api.ts(window.api)
reportAgentSessionWorking: (sessionId: string): void => ipcRenderer.send('agentTerminal:reportWorking', sessionId)

// src/main/handlers/agentTerminalHandlers.ts
export interface AgentTerminalHandlerDeps {
  // …既存の項目…
  /** 作業中の知らせ(送信元のウィンドウの id と pty の sessionId)。組み立ては ipcHandlers.ts(追跡の reportWorking) */
  reportWorking: (ownerId: number, sessionId: string) => void
}
```

- [ ] **Step 1: renderer の hook の失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx`:
```ts
import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentActivity } from '../../lib/agentActivity'

const mockReport = vi.hoisted(() => vi.fn<(sessionId: string) => void>())
vi.mock('../../lib/agentTerminalApi', () => ({ reportAgentSessionWorking: mockReport }))

import { useAgentHooksWorkingReport } from '../useAgentHooksWorkingReport'
import type {
  AgentHooksWorkingReportTab,
  UseAgentHooksWorkingReportOptions
} from '../useAgentHooksWorkingReport'

const tab = (slotId: string, sessionId: string | null): AgentHooksWorkingReportTab => ({
  slotId,
  controller: { getSessionId: () => sessionId }
})
const activitiesOf = (entries: Array<[string, AgentActivity]>): ReadonlyMap<string, AgentActivity> =>
  new Map(entries)

const render = (
  initialProps: UseAgentHooksWorkingReportOptions,
  wrapper?: (props: { children: ReactNode }) => ReactNode
): RenderHookResult<void, UseAgentHooksWorkingReportOptions> =>
  renderHook<void, UseAgentHooksWorkingReportOptions>((props) => useAgentHooksWorkingReport(props), {
    initialProps,
    wrapper
  })

beforeEach(() => {
  mockReport.mockClear()
})

describe('useAgentHooksWorkingReport', () => {
  it('working 以外から working に変わったときだけ、そのタブの sessionId を送る', () => {
    const tabs = [tab('a', 'sid-a')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'unknown']]) })
    expect(mockReport).not.toHaveBeenCalled()
    rerender({ tabs, activities: activitiesOf([['a', 'working']]) })
    expect(mockReport).toHaveBeenCalledExactlyOnceWith('sid-a')
    // 同じ working が続く間(Map が作り直されても)は送らない
    rerender({ tabs, activities: activitiesOf([['a', 'working']]) })
    expect(mockReport).toHaveBeenCalledOnce()
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'working']]) })
    expect(mockReport).toHaveBeenCalledTimes(2)
  })

  it('初めて見たタブが working なら送る(StrictMode の二重の effect でも 1 回)', () => {
    render({ tabs: [tab('a', 'sid-a')], activities: activitiesOf([['a', 'working']]) }, ({ children }) => (
      <StrictMode>{children}</StrictMode>
    ))
    expect(mockReport).toHaveBeenCalledExactlyOnceWith('sid-a')
  })

  it('controller.getSessionId() が null のタブは送らない', () => {
    render({ tabs: [tab('a', null)], activities: activitiesOf([['a', 'working']]) })
    expect(mockReport).not.toHaveBeenCalled()
  })

  it('タブごとに独立して見る', () => {
    const tabs = [tab('a', 'sid-a'), tab('b', 'sid-b')]
    const { rerender } = render({
      tabs,
      activities: activitiesOf([
        ['a', 'working'],
        ['b', 'idle']
      ])
    })
    expect(mockReport.mock.calls).toEqual([['sid-a']])
    rerender({
      tabs,
      activities: activitiesOf([
        ['a', 'working'],
        ['b', 'working']
      ])
    })
    expect(mockReport.mock.calls).toEqual([['sid-a'], ['sid-b']])
  })

  it('消えたタブの控えは捨て、同じ slotId で戻ってきて working なら送る', () => {
    const { rerender } = render({ tabs: [tab('a', 'sid-a')], activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs: [], activities: activitiesOf([]) })
    rerender({ tabs: [tab('a', 'sid-a2')], activities: activitiesOf([['a', 'working']]) })
    expect(mockReport.mock.calls).toEqual([['sid-a'], ['sid-a2']])
  })
})
```
- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx`
Expected: FAIL（`Cannot find module '../useAgentHooksWorkingReport'`）

- [ ] **Step 3: renderer の hook・窓口・preload を実装する**

`src/renderer/src/hooks/useAgentHooksWorkingReport.ts`:
```ts
import { useEffect, useRef } from 'react'
import { reportAgentSessionWorking } from '../lib/agentTerminalApi'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentTerminalController } from '../lib/agentTerminalController'

// 作業中の知らせ(設計書「作業中の知らせ」)。タブの活動(画面の読み取りの判定)が working 以外から working に変わったときだけ、
// そのタブの pty の sessionId を main へ送る。main は、hooks の知らせがまだ届いていないセッションでこれを受けたら 15 秒の
// タイマーを張り、知らせが届かなければ hooks が効いていないと判断する。表示用の値の並びで送り続けない(出来事だけを送る)

export interface AgentHooksWorkingReportTab {
  slotId: string
  /** タブの表示(AgentSessionTabView)は sessionId を持たないため、controller から取る */
  controller: Pick<AgentTerminalController, 'getSessionId'>
}

export interface UseAgentHooksWorkingReportOptions {
  tabs: readonly AgentHooksWorkingReportTab[]
  /** slotId → 活動(useAgentActivity の結果) */
  activities: ReadonlyMap<string, AgentActivity>
}

export function useAgentHooksWorkingReport({ tabs, activities }: UseAgentHooksWorkingReportOptions): void {
  // タブごとの前回の活動。消えたタブの控えは次の描画で捨てる
  const previousRef = useRef(new Map<string, AgentActivity>())

  useEffect(() => {
    const previous = previousRef.current
    const next = new Map<string, AgentActivity>()
    for (const tab of tabs) {
      const activity = activities.get(tab.slotId) ?? 'unknown'
      if (activity === 'working' && previous.get(tab.slotId) !== 'working') {
        const sessionId = tab.controller.getSessionId()
        if (sessionId !== null) reportAgentSessionWorking(sessionId)
      }
      next.set(tab.slotId, activity)
    }
    previousRef.current = next
  }, [tabs, activities])
}
```

`src/renderer/src/lib/agentTerminalApi.ts` の末尾に足す:
```ts
/** 作業中の知らせ(タブの活動が working に変わったとき)。main は hooks が効いているかの確かめに使う */
export function reportAgentSessionWorking(sessionId: string): void {
  window.api.reportAgentSessionWorking(sessionId)
}
```

`src/preload/api.ts` の `setAgentTerminalFocused` の後に足す:
```ts
  // 作業中の知らせ(一方向。引数は pty の sessionId だけ)
  reportAgentSessionWorking: (sessionId: string): void =>
    ipcRenderer.send('agentTerminal:reportWorking', sessionId),
```

`src/preload/index.d.ts` の `setAgentTerminalFocused(focused: boolean): void` の次の行に:
```ts
      reportAgentSessionWorking(sessionId: string): void
```

`src/renderer/src/__tests__/setup.ts` の `setAgentTerminalFocused: () => {},` の次の行に:
```ts
    reportAgentSessionWorking: () => {},
```

`src/renderer/src/hooks/useAgentWorkspace.ts`:
- import の `import { useAgentActivity } from './useAgentActivity'` の次の行に `import { useAgentHooksWorkingReport } from './useAgentHooksWorkingReport'`
- `const activities = useAgentActivity({ tabs: agentSessions.tabs })` の次の行に:
```ts
  // タブの活動が作業中に変わったら、main へ知らせる(hooks が効いているかの確かめ。画面・一覧は変えない)
  useAgentHooksWorkingReport({ tabs: agentSessions.tabs, activities })
```

- [ ] **Step 4: renderer のテストを足す**

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:
- 既存の `const mockUseAgentActivity = vi.hoisted(() => vi.fn())` の次の行に:
```ts
const mockUseAgentHooksWorkingReport = vi.hoisted(() => vi.fn())
vi.mock('../useAgentHooksWorkingReport', () => ({
  useAgentHooksWorkingReport: mockUseAgentHooksWorkingReport
}))
```
- 既存の `it('タブごとの活動(useAgentActivity の結果)を agentTerminal.activities に渡す', …)` の後に:
```ts
    it('作業中の知らせの hook に、タブの一覧と useAgentActivity の結果をそのまま渡す', () => {
      const tab1 = makeAgentSessionTabView({ status: 'running' })
      const sessions = makeAgentSessionsState({ tabs: [tab1], selected: tab1 })
      mockUseAgentSessions.mockReturnValue(sessions)
      const activities = new Map([['slot-1', 'working' as const]])
      mockUseAgentActivity.mockReturnValue(activities)
      renderHook(() => useAgentWorkspace({ folderPath: null, isExecuting: false }))
      expect(mockUseAgentHooksWorkingReport.mock.lastCall?.[0].tabs).toBe(sessions.tabs)
      expect(mockUseAgentHooksWorkingReport.mock.lastCall?.[0].activities).toBe(activities)
    })
```

`src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`:
- `mockApi` に `reportAgentSessionWorking: vi.fn()` を足す
- 「各関数は window.api の同名の関数へ引数をそのまま渡す」の呼び出しに `agentTerminalApi.reportAgentSessionWorking('s')`、期待に `expect(mockApi.reportAgentSessionWorking).toHaveBeenCalledWith('s')` を足す

`src/preload/__tests__/api.test.ts` の send の表（`'setAgentTerminalFocused は send で送る'` の行の後）に:
```ts
    [
      'reportAgentSessionWorking は send で sessionId だけを送る',
      () => api.reportAgentSessionWorking('s'),
      ['agentTerminal:reportWorking', 's']
    ]
```

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts src/preload/__tests__/api.test.ts`
Expected: PASS

- [ ] **Step 5: main の handler の失敗するテストを書く**

`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`:
- `register` の `registerAgentTerminalHandlers(ipcMain as never, { … })` の既定の依存に `reportWorking: vi.fn(),` を足す（`platform: 'linux',` の次の行。`...overrides` より前）
- ファイルの末尾に足す:
```ts
describe('agentTerminal:reportWorking', () => {
  let warnSpy: MockInstance<typeof console.warn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('メインフレームからの sessionId を、送信元のウィンドウの id と一緒に追跡へ渡す', () => {
    const reportWorking = vi.fn<(ownerId: number, sessionId: string) => void>()
    register({ reportWorking })
    listeners.get('agentTerminal:reportWorking')?.(makeEvent(3), 'sid-9')
    expect(reportWorking).toHaveBeenCalledExactlyOnceWith(3, 'sid-9')
  })

  it.each<[string, unknown]>([
    ['空文字', ''],
    ['数値', 123],
    ['null', null]
  ])('不正な sessionId(%s)は追跡を呼ばず、例外を投げずにログに出す', (_label, sessionId) => {
    const reportWorking = vi.fn<(ownerId: number, sessionId: string) => void>()
    register({ reportWorking })
    expect(() => listeners.get('agentTerminal:reportWorking')?.(makeEvent(3), sessionId)).not.toThrow()
    expect(reportWorking).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('[agent-hooks] 作業中の知らせの sessionId が不正です')
  })

  it('サブフレームからの送信は捨てる(L-019)', () => {
    const reportWorking = vi.fn<(ownerId: number, sessionId: string) => void>()
    register({ reportWorking })
    listeners.get('agentTerminal:reportWorking')?.(makeEvent(3, false), 'sid-9')
    expect(reportWorking).not.toHaveBeenCalled()
  })
})
```
（ファイルの先頭の import に `MockInstance`・`beforeEach`・`afterEach` が既にあることを確かめる。無ければ足す。）

Run: `npx vitest run src/main/__tests__/handlers/agentTerminalHandlers.test.ts`
Expected: FAIL（`agentTerminal:reportWorking` の listener が無い。型の検査では `reportWorking` が `AgentTerminalHandlerDeps` に無い）

- [ ] **Step 6: handler を実装する**

`src/main/handlers/agentTerminalHandlers.ts`:
- `AgentTerminalHandlerDeps` の `getLastSession` の後に:
```ts
  /** 作業中の知らせ(送信元のウィンドウの id と pty の sessionId)。組み立ては ipcHandlers.ts(区間の追跡の reportWorking)。
   *  そのウィンドウに無いセッションは追跡が捨てる */
  reportWorking: (ownerId: number, sessionId: string) => void
```
- 分割代入に `reportWorking,` を足す（`getLastSession,` の次）
- `agentTerminal:focus` の `ipcMain.on` の前に:
```ts
  // 作業中の知らせ(設計書「作業中の知らせ」)。効果は「知らせの届かないセッションを unconfirmed にする(印を増やさない側)」だけで、
  // renderer の値は送信元のウィンドウのセッションを指すだけ(L-019)。send なので失敗を renderer に返さない
  ipcMain.on('agentTerminal:reportWorking', (event: IpcMainEvent, sessionId: unknown) => {
    if (!isMainFrameSender(event)) return
    let parsed: string
    try {
      parsed = parseAgentSessionId(sessionId)
    } catch {
      console.warn('[agent-hooks] 作業中の知らせの sessionId が不正です')
      return
    }
    reportWorking(event.sender.id, parsed)
  })
```
- 先頭の説明（L16-17）の `書き込む文字列・sessionId だけを受け取る` を `書き込む文字列・sessionId（作業中の知らせを含む）だけを受け取る` に直す

`src/main/ipcHandlers.ts`:
- import に `import { createAgentToolActivity } from './agentToolActivity'`
- `const agentStarter = createAgentSessionStarter({ … })` の前に:
```ts
  // エージェントのツールの区間の追跡(ウィンドウごとの段階。段階 A は内部で持ち、開発版のログに出すだけ)。
  // 段階の通知は段階 B で記録の registry の syncAttribution につなぐ
  const agentToolActivity = createAgentToolActivity({
    onPhaseChange: () => undefined,
    devLog: app.isPackaged ? null : (line) => console.log(line),
    warn: (message) => console.warn(message)
  })
```
- `registerAgentTerminalHandlers(ipcMain, { … })` の `getLastSession: agentStarter.lastSessionOf` の後に `reportWorking: agentToolActivity.reportWorking`

`src/main/__tests__/ipcHandlers.test.ts`:
- hoisted の宣言に足す:
```ts
const mockToolActivity = vi.hoisted(() => ({
  addSession: vi.fn(),
  removeSession: vi.fn(),
  deliver: vi.fn(),
  reportWorking: vi.fn(),
  activityOf: vi.fn(),
  toolStartSeqOf: vi.fn(),
  close: vi.fn()
}))
const mockCreateAgentToolActivity = vi.hoisted(() => vi.fn(() => mockToolActivity))
vi.mock('../agentToolActivity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentToolActivity')>()),
  createAgentToolActivity: mockCreateAgentToolActivity
}))
```
- 「エージェントのセッションの寿命と IPC に、…」の `expect(deps).toEqual({ … })` に `reportWorking: mockToolActivity.reportWorking` を足し、`expect(deps.reportWorking).toBe(mockToolActivity.reportWorking)` を足す
- 新しい it を足す:
```ts
  it('ツールの区間の追跡を 1 つ組み立て、開発版のログ(app.isPackaged でないとき)と常に出すログを渡す', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockCreateAgentToolActivity).toHaveBeenCalledOnce()
    const deps = (mockCreateAgentToolActivity.mock.calls[0] as unknown[])[0] as {
      onPhaseChange: (ownerId: number) => void
      devLog: ((line: string) => void) | null
      warn: (message: string) => void
    }
    expect(typeof deps.onPhaseChange).toBe('function')
    expect(() => deps.onPhaseChange(1)).not.toThrow()
    expect(typeof deps.devLog).toBe('function')
    expect(typeof deps.warn).toBe('function')
  })
```

- [ ] **Step 7: 通す**

Run: `npx vitest run src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts src/preload/__tests__/api.test.ts`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix <このタスクで変更・作成した .ts/.tsx のファイル> && npx eslint --max-warnings 0 <同じファイル>`（対象: `src/renderer/src/hooks/useAgentHooksWorkingReport.ts`・`src/renderer/src/hooks/useAgentWorkspace.ts`・`src/renderer/src/lib/agentTerminalApi.ts`・`src/preload/api.ts`・`src/preload/index.d.ts`・`src/renderer/src/__tests__/setup.ts`・`src/main/handlers/agentTerminalHandlers.ts`・`src/main/ipcHandlers.ts` と、変更したテストのファイル）
Expected: エラー・警告なし

---

### Task 6: `claude` の版の確認と起動ごとの準備（`agentClaudeVersion.ts`・`agentHookSessions.ts`）

> **気をつける知見:** L-001（失敗を `hooks: null` と理由で返す）・L-017・L-052（打ち切りと SIGKILL）・L-427（一時的な失敗は控えない）

**Files:**
- Create: `src/main/agentClaudeVersion.ts`
- Create: `src/main/agentHookSessions.ts`
- Test: `src/main/__tests__/agentClaudeVersion.test.ts`（新規。実行は偽物）
- Test: `src/main/__tests__/agentHookSessions.test.ts`（新規。受け口・`settingsDir`・追跡・版の確認・ファイルの書き込みは偽物）

**Interfaces:**
- Consumes: Task 2 の `buildAgentHookSettings`・`AgentHookSettingsJson`・`AgentHookSettingsDir`（`src/main/agentHookSettings.ts`）、Task 3 の `AgentHookReceiver`（`ensureListening`・`addToken`・`removeToken`）、Task 4 の `AgentToolActivity`（`addSession`・`removeSession`）・`AgentHooksUnavailableReason`、既存の `AgentLaunchPlan`（`src/main/agentCommand.ts`。`{ file: string; args: string[]; env: Record<string, string> }`）
- Produces:
```ts
// src/main/agentClaudeVersion.ts
export const AGENT_HOOKS_MIN_CLAUDE_VERSION: ClaudeVersion  // [2, 1, 101]
export const CLAUDE_VERSION_TIMEOUT_MS = 5_000
export const CLAUDE_VERSION_KILL_GRACE_MS = 1_000
export const CLAUDE_VERSION_MAX_OUTPUT_BYTES = 4_096
export type ClaudeVersion = readonly [number, number, number]
export function parseClaudeVersion(output: string): ClaudeVersion | null
export function supportsHttpHooks(version: ClaudeVersion): boolean
export type ClaudeVersionUnknownReason = 'malformed-output' | 'timeout' | 'spawn-failed' | 'exit-nonzero'
export type ClaudeVersionCheck =
  | { kind: 'supported'; version: string }
  | { kind: 'unsupported'; version: string }
  | { kind: 'unknown'; reason: ClaudeVersionUnknownReason; detail: string }
export interface ExecFileChild {
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  kill(signal: NodeJS.Signals): boolean
}
export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void
) => ExecFileChild
export const nodeExecFile: ExecFileLike
export interface ClaudeVersionReaderDeps {
  execFile: ExecFileLike
  stat: (path: string) => Promise<{ mtimeMs: number; size: number }>
  platform: NodeJS.Platform
  log: (message: string) => void
}
export interface ClaudeVersionReader {
  readClaudeVersion(plan: Pick<AgentLaunchPlan, 'file' | 'env'>): Promise<ClaudeVersionCheck>
}
export function createClaudeVersionReader(deps: ClaudeVersionReaderDeps): ClaudeVersionReader

// src/main/agentHookSessions.ts
export type PreparedAgentHooks =
  | { ownerId: number; hooks: { settingsPath: string; token: string }; unavailableReason: null }
  | { ownerId: number; hooks: null; unavailableReason: AgentHooksUnavailableReason }
export interface AgentHookSessions {
  prepare(ownerId: number, plan: AgentLaunchPlan): Promise<PreparedAgentHooks>
  activate(prepared: PreparedAgentHooks, sessionId: string): void
  release(prepared: PreparedAgentHooks, sessionId: string | null): void
}
export interface AgentHookSessionsDeps {
  receiver: Pick<AgentHookReceiver, 'ensureListening' | 'addToken' | 'removeToken'>
  settingsDir: Pick<AgentHookSettingsDir, 'ensure'>
  tracker: Pick<AgentToolActivity, 'addSession' | 'removeSession'>
  versions: Pick<ClaudeVersionReader, 'readClaudeVersion'>
  writeSettingsFile: (dir: string, settings: AgentHookSettingsJson) => Promise<string>
  removeSettingsFile: (path: string) => Promise<void>
  log: (message: string) => void
  /** テスト用。既定は randomBytes(32).toString('hex') */
  createToken?: () => string
}
export function createAgentHookSessions(deps: AgentHookSessionsDeps): AgentHookSessions
```

- [ ] **Step 1: 版の確認の失敗するテストを書く**

`src/main/__tests__/agentClaudeVersion.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecFileException, ExecFileOptions } from 'node:child_process'
import {
  AGENT_HOOKS_MIN_CLAUDE_VERSION,
  CLAUDE_VERSION_KILL_GRACE_MS,
  CLAUDE_VERSION_MAX_OUTPUT_BYTES,
  CLAUDE_VERSION_TIMEOUT_MS,
  createClaudeVersionReader,
  parseClaudeVersion,
  supportsHttpHooks
} from '../agentClaudeVersion'
import type { ClaudeVersionCheck, ClaudeVersionReaderDeps, ExecFileChild, ExecFileLike } from '../agentClaudeVersion'

interface FakeRun {
  file: string
  args: readonly string[]
  options: ExecFileOptions
  child: ExecFileChild & { kill: ReturnType<typeof vi.fn<(signal: NodeJS.Signals) => boolean>> }
  finish(error: Partial<ExecFileException> | null, stdout?: string): void
}

const ENV = { PATH: '/p' }

let runs: FakeRun[]
let execFile: ExecFileLike
let stat: ReturnType<typeof vi.fn<ClaudeVersionReaderDeps['stat']>>
let log: ReturnType<typeof vi.fn<(message: string) => void>>

beforeEach(() => {
  runs = []
  execFile = (file, args, options, callback) => {
    const child: FakeRun['child'] = {
      exitCode: null,
      signalCode: null,
      kill: vi.fn<(signal: NodeJS.Signals) => boolean>(() => true)
    }
    runs.push({
      file,
      args,
      options,
      child,
      finish: (error, stdout = '') => {
        child.exitCode = error === null ? 0 : 1
        callback(error === null ? null : (Object.assign(new Error('x'), error) as ExecFileException), stdout, '')
      }
    })
    return child
  }
  stat = vi.fn<ClaudeVersionReaderDeps['stat']>(async () => ({ mtimeMs: 1, size: 100 }))
  log = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
})

const reader = (platform: NodeJS.Platform = 'darwin'): ReturnType<typeof createClaudeVersionReader> =>
  createClaudeVersionReader({ execFile, stat, platform, log })

/** 1 回読む。実行が呼ばれたら error・stdout で終える */
async function readOnce(
  versionReader: ReturnType<typeof createClaudeVersionReader>,
  error: Partial<ExecFileException> | null,
  stdout = '',
  file = '/bin/claude'
): Promise<ClaudeVersionCheck> {
  const before = runs.length
  const pending = versionReader.readClaudeVersion({ file, env: ENV })
  await vi.waitFor(() => expect(runs.length).toBeGreaterThan(before))
  runs[runs.length - 1].finish(error, stdout)
  return pending
}

describe('parseClaudeVersion・supportsHttpHooks', () => {
  it('定数は設計書の値', () => {
    expect(AGENT_HOOKS_MIN_CLAUDE_VERSION).toEqual([2, 1, 101])
    expect(CLAUDE_VERSION_TIMEOUT_MS).toBe(5_000)
    expect(CLAUDE_VERSION_KILL_GRACE_MS).toBe(1_000)
    expect(CLAUDE_VERSION_MAX_OUTPUT_BYTES).toBe(4_096)
  })

  it.each<[string, readonly [number, number, number] | null]>([
    ['2.1.291 (Claude Code)\n', [2, 1, 291]],
    ['  2.1.101\n', [2, 1, 101]],
    ['Claude Code 2.1.291', null],
    ['v2.1.0', null],
    ['2.1', null],
    ['', null]
  ])('%j → %j', (output, expected) => {
    expect(parseClaudeVersion(output)).toEqual(expected)
  })

  it.each<[readonly [number, number, number], boolean]>([
    [[2, 1, 101], true],
    [[2, 1, 100], false],
    [[2, 10, 0], true],
    [[3, 0, 0], true],
    [[1, 99, 999], false]
  ])('%j の対応は %s(文字列でなく数で比べる)', (version, expected) => {
    expect(supportsHttpHooks(version)).toBe(expected)
  })
})

describe('createClaudeVersionReader(判定)', () => {
  it.each<[string, Partial<ExecFileException> | null, string, ClaudeVersionCheck['kind'], string]>([
    ['対応する版', null, '2.1.291 (Claude Code)\n', 'supported', ''],
    ['古い版', null, '2.1.100 (Claude Code)\n', 'unsupported', ''],
    ['形の違う出力', null, 'hello\n', 'unknown', 'malformed-output'],
    ['空の出力', null, '', 'unknown', 'malformed-output'],
    ['4 KiB を超えた出力', { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, '', 'unknown', 'malformed-output'],
    ['0 でない終了', { code: 1 }, '', 'unknown', 'exit-nonzero'],
    ['起動の失敗', { code: 'ENOENT' }, '', 'unknown', 'spawn-failed'],
    ['打ち切り', { killed: true, signal: 'SIGTERM', code: null }, '', 'unknown', 'timeout']
  ])('%s', async (_label, error, stdout, kind, reason) => {
    const result = await readOnce(reader(), error, stdout)
    expect(result.kind).toBe(kind)
    if (result.kind === 'unknown') expect(result.reason).toBe(reason)
    expect(log).toHaveBeenCalledOnce()
  })

  it('形の違う出力のログは先頭 80 文字まで', async () => {
    await readOnce(reader(), null, 'x'.repeat(200))
    const [message] = log.mock.calls[0]
    expect(message).toContain('x'.repeat(80))
    expect(message).not.toContain('x'.repeat(81))
  })
})

describe('createClaudeVersionReader(実行のしかた)', () => {
  it('.cmd 以外はシェルを通さず、引数は --version だけ、環境は起動と同じで、打ち切り・出力の上限を付ける', async () => {
    await readOnce(reader('darwin'), null, '2.1.291')
    expect(runs[0].file).toBe('/bin/claude')
    expect(runs[0].args).toEqual(['--version'])
    expect(runs[0].options).toStrictEqual({
      env: ENV,
      timeout: 5000,
      killSignal: 'SIGTERM',
      maxBuffer: 4096,
      windowsHide: true
    })
  })

  it.each(['claude.cmd', 'CLAUDE.BAT'])('Windows の %s は cmd.exe の /d /s /c で、パスを引用して実行する', async (name) => {
    const file = `C:\\Program Files\\nodejs\\${name}`
    await readOnce(reader('win32'), null, '2.1.291', file)
    expect(runs[0].file).toBe('cmd.exe')
    expect(runs[0].args).toEqual(['/d', '/s', '/c', `""${file}" --version"`])
    expect(runs[0].options).toStrictEqual({
      windowsVerbatimArguments: true,
      windowsHide: true,
      env: ENV,
      timeout: 5000,
      killSignal: 'SIGTERM',
      maxBuffer: 4096
    })
  })

  it('空白を含むパスの例: 4 つ目の引数は ""C:\\Program Files\\nodejs\\claude.cmd" --version"', async () => {
    await readOnce(reader('win32'), null, '2.1.291', 'C:\\Program Files\\nodejs\\claude.cmd')
    expect(runs[0].args[3]).toBe('""C:\\Program Files\\nodejs\\claude.cmd" --version"')
  })

  it('Windows でも .exe は直接実行する', async () => {
    await readOnce(reader('win32'), null, '2.1.291', 'C:\\tools\\claude.exe')
    expect(runs[0].file).toBe('C:\\tools\\claude.exe')
  })

  it('打ち切りの後 1 秒で終わっていなければ SIGKILL を送る。先に終われば送らない', async () => {
    vi.useFakeTimers()
    const versionReader = reader()
    const first = versionReader.readClaudeVersion({ file: '/bin/claude', env: ENV })
    await vi.waitFor(() => expect(runs.length).toBe(1))
    vi.advanceTimersByTime(CLAUDE_VERSION_TIMEOUT_MS + CLAUDE_VERSION_KILL_GRACE_MS)
    expect(runs[0].child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
    runs[0].finish({ killed: true, signal: 'SIGKILL', code: null })
    await expect(first).resolves.toMatchObject({ kind: 'unknown', reason: 'timeout' })

    const second = versionReader.readClaudeVersion({ file: '/bin/claude', env: ENV })
    await vi.waitFor(() => expect(runs.length).toBe(2))
    runs[1].finish(null, '2.1.291')
    await second
    vi.advanceTimersByTime(CLAUDE_VERSION_TIMEOUT_MS + CLAUDE_VERSION_KILL_GRACE_MS)
    expect(runs[1].child.kill).not.toHaveBeenCalled()
  })
})

describe('createClaudeVersionReader(控え)', () => {
  it.each<[string, string]>([
    ['対応', '2.1.291'],
    ['非対応', '2.1.100'],
    ['形の違う出力', 'hello']
  ])('版を読めた結果(%s)は同じパス・mtime・大きさでは実行し直さず、mtime が変われば実行し直す', async (_label, stdout) => {
    const versionReader = reader()
    const first = await readOnce(versionReader, null, stdout)
    await expect(versionReader.readClaudeVersion({ file: '/bin/claude', env: ENV })).resolves.toEqual(first)
    expect(runs).toHaveLength(1)
    stat.mockResolvedValue({ mtimeMs: 2, size: 100 })
    await readOnce(versionReader, null, stdout)
    expect(runs).toHaveLength(2)
  })

  it.each<[string, Partial<ExecFileException>]>([
    ['打ち切り', { killed: true, signal: 'SIGTERM', code: null }],
    ['起動の失敗', { code: 'ENOENT' }],
    ['0 でない終了', { code: 1 }]
  ])('一時的な失敗(%s)は控えず、次の確認で実行し直す(L-427)', async (_label, error) => {
    const versionReader = reader()
    await readOnce(versionReader, error)
    await readOnce(versionReader, null, '2.1.291')
    expect(runs).toHaveLength(2)
  })

  it('stat に失敗したら控えずに毎回実行する', async () => {
    stat.mockRejectedValue(new Error('ENOENT'))
    const versionReader = reader()
    await readOnce(versionReader, null, '2.1.291')
    await readOnce(versionReader, null, '2.1.291')
    expect(runs).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentClaudeVersion.test.ts`
Expected: FAIL（`Cannot find module '../agentClaudeVersion'`）

- [ ] **Step 3: 版の確認を実装する**

`src/main/agentClaudeVersion.ts`:
```ts
import { execFile } from 'node:child_process'
import type { ExecFileException, ExecFileOptions } from 'node:child_process'
import type { AgentLaunchPlan } from './agentCommand'

// 起動する claude の版の確認(設計書「claude の版の確認」)。http の hook を受け付け、知らないイベント名で設定のファイル全体を
// 無視しない最初の版(2.1.101。確認の結果 10)以上と分かったときだけ hooks を渡す。claude --version はシェルを通さず
// (Windows の .cmd・.bat は cmd.exe の形を固定して)、起動と同じ環境で、打ち切り 5 秒・出力 4 KiB まで実行し、打ち切りの
// 1 秒後にまだ終わっていなければ SIGKILL を送る(L-052)。版を読めた結果と形の違う出力だけを、パス・mtime・大きさを鍵に控える。
// 一時的な失敗は控えず、次の起動で確かめ直す(L-427)

export type ClaudeVersion = readonly [number, number, number]

export const AGENT_HOOKS_MIN_CLAUDE_VERSION: ClaudeVersion = [2, 1, 101]
export const CLAUDE_VERSION_TIMEOUT_MS = 5_000
export const CLAUDE_VERSION_KILL_GRACE_MS = 1_000
export const CLAUDE_VERSION_MAX_OUTPUT_BYTES = 4_096

const LOG_OUTPUT_HEAD_LENGTH = 80

export function parseClaudeVersion(output: string): ClaudeVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(output.trimStart())
  if (match === null) return null
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const
  return parts.every((part) => Number.isSafeInteger(part)) ? parts : null
}

export function supportsHttpHooks(version: ClaudeVersion): boolean {
  for (let i = 0; i < 3; i++) {
    if (version[i] !== AGENT_HOOKS_MIN_CLAUDE_VERSION[i]) return version[i] > AGENT_HOOKS_MIN_CLAUDE_VERSION[i]
  }
  return true
}

export type ClaudeVersionUnknownReason = 'malformed-output' | 'timeout' | 'spawn-failed' | 'exit-nonzero'

export type ClaudeVersionCheck =
  | { kind: 'supported'; version: string }
  | { kind: 'unsupported'; version: string }
  | { kind: 'unknown'; reason: ClaudeVersionUnknownReason; detail: string }

export interface ExecFileChild {
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  kill(signal: NodeJS.Signals): boolean
}

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void
) => ExecFileChild

/** 実物の execFile(出力は utf8 の文字列) */
export const nodeExecFile: ExecFileLike = (file, args, options, callback) =>
  execFile(file, [...args], { ...options, encoding: 'utf8' }, callback)

export interface ClaudeVersionReaderDeps {
  execFile: ExecFileLike
  stat: (path: string) => Promise<{ mtimeMs: number; size: number }>
  platform: NodeJS.Platform
  log: (message: string) => void
}

export interface ClaudeVersionReader {
  readClaudeVersion(plan: Pick<AgentLaunchPlan, 'file' | 'env'>): Promise<ClaudeVersionCheck>
}

/** 実行の結果を判定にする(版を読めた・形の違う出力 → 控えてよい、それ以外 → 控えない) */
function classify(error: ExecFileException | null, stdout: string): ClaudeVersionCheck {
  if (error !== null) {
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      return { kind: 'unknown', reason: 'malformed-output', detail: `出力が ${CLAUDE_VERSION_MAX_OUTPUT_BYTES} バイトを超えました` }
    }
    if (error.killed === true) return { kind: 'unknown', reason: 'timeout', detail: `シグナル ${error.signal ?? '不明'}` }
    if (typeof error.code === 'number') return { kind: 'unknown', reason: 'exit-nonzero', detail: `終了コード ${error.code}` }
    return { kind: 'unknown', reason: 'spawn-failed', detail: String(error.code ?? error.message) }
  }
  const version = parseClaudeVersion(stdout)
  if (version === null) {
    return { kind: 'unknown', reason: 'malformed-output', detail: stdout.slice(0, LOG_OUTPUT_HEAD_LENGTH) }
  }
  const text = version.join('.')
  return supportsHttpHooks(version) ? { kind: 'supported', version: text } : { kind: 'unsupported', version: text }
}

const isCacheable = (check: ClaudeVersionCheck): boolean =>
  check.kind !== 'unknown' || check.reason === 'malformed-output'

export function createClaudeVersionReader({ execFile: run, stat, platform, log }: ClaudeVersionReaderDeps): ClaudeVersionReader {
  const cache = new Map<string, ClaudeVersionCheck>()

  const keyOf = async (file: string): Promise<string | null> => {
    try {
      const stats = await stat(file)
      return `${file}\u0000${stats.mtimeMs}\u0000${stats.size}`
    } catch {
      return null
    }
  }

  const execute = (file: string, env: Record<string, string>): Promise<ClaudeVersionCheck> =>
    new Promise((resolve) => {
      const common = {
        env,
        timeout: CLAUDE_VERSION_TIMEOUT_MS,
        killSignal: 'SIGTERM' as const,
        maxBuffer: CLAUDE_VERSION_MAX_OUTPUT_BYTES
      }
      const isWindowsScript = platform === 'win32' && /\.(cmd|bat)$/i.test(file)
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const callback = (error: ExecFileException | null, stdout: string): void => {
        clearTimeout(killTimer)
        resolve(classify(error, stdout))
      }
      // Node の shell: true と同じ形。/s は最初と最後の " だけを外すため、パスの引用が残る
      const child = isWindowsScript
        ? run('cmd.exe', ['/d', '/s', '/c', `""${file}" --version"`], { windowsVerbatimArguments: true, windowsHide: true, ...common }, callback)
        : run(file, ['--version'], { ...common, windowsHide: true }, callback)
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, CLAUDE_VERSION_TIMEOUT_MS + CLAUDE_VERSION_KILL_GRACE_MS)
      killTimer.unref()
    })

  return {
    async readClaudeVersion({ file, env }) {
      const key = await keyOf(file)
      const cached = key === null ? undefined : cache.get(key)
      if (cached !== undefined) return cached
      const check = await execute(file, env)
      log(
        check.kind === 'unknown'
          ? `[agent-hooks] claude の版を確かめられませんでした(${check.reason}): ${check.detail}`
          : `[agent-hooks] claude の版: ${check.version}(${check.kind === 'supported' ? 'hooks を渡す' : 'hooks を渡さない'})`
      )
      if (key !== null && isCacheable(check)) cache.set(key, check)
      return check
    }
  }
}
```
（オプションの順序は `toStrictEqual` に影響しない。`.cmd` 以外の形は `{ env, timeout, killSignal, maxBuffer, windowsHide }`、`.cmd` は `{ windowsVerbatimArguments, windowsHide, env, timeout, killSignal, maxBuffer }` で、テストの完全一致と同じ鍵の集合にする。）

Run: `npx vitest run src/main/__tests__/agentClaudeVersion.test.ts`
Expected: PASS

- [ ] **Step 4: 起動ごとの準備の失敗するテストを書く**

`src/main/__tests__/agentHookSessions.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentHookSessions } from '../agentHookSessions'
import type { AgentHookSessionsDeps, PreparedAgentHooks } from '../agentHookSessions'
import { buildAgentHookSettings } from '../agentHookSettings'
import type { ClaudeVersionCheck } from '../agentClaudeVersion'
import type { AgentLaunchPlan } from '../agentCommand'

const TOKEN = 'ab'.repeat(32)
const PLAN: AgentLaunchPlan = { file: '/bin/claude', args: [], env: { PATH: '/p' } }
const BASE = 'http://127.0.0.1:43210'

let calls: string[]
let deps: {
  receiver: { ensureListening: ReturnType<typeof vi.fn>; addToken: ReturnType<typeof vi.fn>; removeToken: ReturnType<typeof vi.fn> }
  settingsDir: { ensure: ReturnType<typeof vi.fn> }
  tracker: { addSession: ReturnType<typeof vi.fn>; removeSession: ReturnType<typeof vi.fn> }
  versions: { readClaudeVersion: ReturnType<typeof vi.fn> }
  writeSettingsFile: ReturnType<typeof vi.fn>
  removeSettingsFile: ReturnType<typeof vi.fn>
  log: ReturnType<typeof vi.fn>
}

const recorder = <T>(label: string, impl: () => T): ReturnType<typeof vi.fn> =>
  vi.fn((...args: unknown[]) => {
    calls.push(`${label}(${args.map((arg) => JSON.stringify(arg)).join(',')})`)
    return impl()
  })

beforeEach(() => {
  calls = []
  deps = {
    receiver: {
      ensureListening: recorder('ensureListening', async () => ({ baseUrl: BASE })),
      addToken: recorder('addToken', () => undefined),
      removeToken: recorder('removeToken', () => undefined)
    },
    settingsDir: { ensure: recorder('ensure', async () => '/tmp/hooks-dir') },
    tracker: {
      addSession: recorder('addSession', () => undefined),
      removeSession: recorder('removeSession', () => undefined)
    },
    versions: {
      readClaudeVersion: recorder('readClaudeVersion', async (): Promise<ClaudeVersionCheck> => ({ kind: 'supported', version: '2.1.291' }))
    },
    writeSettingsFile: recorder('writeSettingsFile', async () => '/tmp/hooks-dir/f.json'),
    removeSettingsFile: recorder('removeSettingsFile', async () => undefined),
    log: vi.fn()
  }
})

const sessions = (): ReturnType<typeof createAgentHookSessions> =>
  createAgentHookSessions({ ...(deps as unknown as AgentHookSessionsDeps), createToken: () => TOKEN })

const WITH_HOOKS: PreparedAgentHooks = {
  ownerId: 7,
  hooks: { settingsPath: '/tmp/hooks-dir/f.json', token: TOKEN },
  unavailableReason: null
}

describe('createAgentHookSessions: prepare', () => {
  it('版が対応していれば、受け口の開始 → ディレクトリ → 設定のファイルの書き込みの順に行い、トークンはまだ表に足さない', async () => {
    await expect(sessions().prepare(7, PLAN)).resolves.toEqual(WITH_HOOKS)
    expect(deps.versions.readClaudeVersion).toHaveBeenCalledWith(PLAN)
    expect(calls.map((call) => call.split('(')[0])).toEqual([
      'readClaudeVersion',
      'ensureListening',
      'ensure',
      'writeSettingsFile'
    ])
    expect(deps.writeSettingsFile).toHaveBeenCalledWith('/tmp/hooks-dir', buildAgentHookSettings({ baseUrl: BASE, token: TOKEN }))
    expect(deps.receiver.addToken).not.toHaveBeenCalled()
    expect(deps.tracker.addSession).not.toHaveBeenCalled()
  })

  it.each<[string, ClaudeVersionCheck | Error]>([
    ['古い版', { kind: 'unsupported', version: '2.1.100' }],
    ['分からない版', { kind: 'unknown', reason: 'timeout', detail: 'x' }],
    ['確認の例外', new Error('boom')]
  ])('%s なら受け口・ディレクトリ・書き込みのどれも呼ばずに hooks: null(claude-version-unsupported)', async (_label, check) => {
    deps.versions.readClaudeVersion.mockImplementation(async () => {
      if (check instanceof Error) throw check
      return check
    })
    await expect(sessions().prepare(7, PLAN)).resolves.toEqual({
      ownerId: 7,
      hooks: null,
      unavailableReason: 'claude-version-unsupported'
    })
    expect(deps.receiver.ensureListening).not.toHaveBeenCalled()
    expect(deps.settingsDir.ensure).not.toHaveBeenCalled()
    expect(deps.writeSettingsFile).not.toHaveBeenCalled()
  })

  it.each<[string, () => void]>([
    ['受け口の開始', () => deps.receiver.ensureListening.mockRejectedValueOnce(new Error('EADDRINUSE'))],
    ['ディレクトリ', () => deps.settingsDir.ensure.mockRejectedValueOnce(new Error('EACCES'))],
    ['設定のファイルの書き込み', () => deps.writeSettingsFile.mockRejectedValueOnce(new Error('ENOSPC'))]
  ])('%s の失敗は hooks: null(receiver-unavailable)。例外にしない', async (_label, fail) => {
    fail()
    await expect(sessions().prepare(7, PLAN)).resolves.toEqual({
      ownerId: 7,
      hooks: null,
      unavailableReason: 'receiver-unavailable'
    })
    for (const [message] of deps.log.mock.calls as [string][]) expect(message).not.toContain(TOKEN)
  })
})

describe('createAgentHookSessions: activate・release', () => {
  it('hooks があれば、トークンを { ownerId, sessionId } として表に足し、追跡に pending で足す', () => {
    sessions().activate(WITH_HOOKS, 'sid-1')
    expect(deps.receiver.addToken).toHaveBeenCalledExactlyOnceWith(TOKEN, { ownerId: 7, sessionId: 'sid-1' })
    expect(deps.tracker.addSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1', { kind: 'pending' })
  })

  it('hooks が無ければ、追跡に unconfirmed(理由)で足すだけ', () => {
    sessions().activate({ ownerId: 7, hooks: null, unavailableReason: 'receiver-unavailable' }, 'sid-1')
    expect(deps.receiver.addToken).not.toHaveBeenCalled()
    expect(deps.tracker.addSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1', {
      kind: 'unconfirmed',
      reason: 'receiver-unavailable'
    })
  })

  it('release は hooks があれば表から外してファイルを消し、sessionId があれば追跡から外す', () => {
    sessions().release(WITH_HOOKS, 'sid-1')
    expect(deps.receiver.removeToken).toHaveBeenCalledExactlyOnceWith(TOKEN)
    expect(deps.removeSettingsFile).toHaveBeenCalledExactlyOnceWith('/tmp/hooks-dir/f.json')
    expect(deps.tracker.removeSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1')
  })

  it('release(prepared, null) は追跡に触らない(起動しなかった)', () => {
    sessions().release(WITH_HOOKS, null)
    expect(deps.removeSettingsFile).toHaveBeenCalledOnce()
    expect(deps.tracker.removeSession).not.toHaveBeenCalled()
  })

  it('hooks: null でも sessionId があれば追跡から外す', () => {
    sessions().release({ ownerId: 7, hooks: null, unavailableReason: 'claude-version-unsupported' }, 'sid-1')
    expect(deps.receiver.removeToken).not.toHaveBeenCalled()
    expect(deps.removeSettingsFile).not.toHaveBeenCalled()
    expect(deps.tracker.removeSession).toHaveBeenCalledExactlyOnceWith(7, 'sid-1')
  })
})
```

Run: `npx vitest run src/main/__tests__/agentHookSessions.test.ts`
Expected: FAIL（`Cannot find module '../agentHookSessions'`）

- [ ] **Step 5: 起動ごとの準備を実装する**

`src/main/agentHookSessions.ts`:
```ts
import { randomBytes } from 'node:crypto'
import { buildAgentHookSettings } from './agentHookSettings'
import type { AgentHookSettingsDir, AgentHookSettingsJson } from './agentHookSettings'
import type { AgentHookReceiver } from './agentHookReceiver'
import type { AgentHooksUnavailableReason, AgentToolActivity } from './agentToolActivity'
import type { ClaudeVersionReader } from './agentClaudeVersion'
import type { AgentLaunchPlan } from './agentCommand'

// starter に注入する hooks の準備・結び付け・解放(設計書「起動への組み込み」)。prepare は pty の sessionId を使わない
// (sessionId は spawn の直前の await を挟まない区間で振るため)。トークンは spawn の後の activate で初めて表に足す。
// prepare は失敗しても null を返さず、hooks なしで起動する理由を返す(L-001)

export type PreparedAgentHooks =
  | { ownerId: number; hooks: { settingsPath: string; token: string }; unavailableReason: null }
  | { ownerId: number; hooks: null; unavailableReason: AgentHooksUnavailableReason }

export interface AgentHookSessions {
  prepare(ownerId: number, plan: AgentLaunchPlan): Promise<PreparedAgentHooks>
  activate(prepared: PreparedAgentHooks, sessionId: string): void
  release(prepared: PreparedAgentHooks, sessionId: string | null): void
}

export interface AgentHookSessionsDeps {
  receiver: Pick<AgentHookReceiver, 'ensureListening' | 'addToken' | 'removeToken'>
  settingsDir: Pick<AgentHookSettingsDir, 'ensure'>
  tracker: Pick<AgentToolActivity, 'addSession' | 'removeSession'>
  versions: Pick<ClaudeVersionReader, 'readClaudeVersion'>
  writeSettingsFile: (dir: string, settings: AgentHookSettingsJson) => Promise<string>
  removeSettingsFile: (path: string) => Promise<void>
  log: (message: string) => void
  createToken?: () => string
}

const createRandomToken = (): string => randomBytes(32).toString('hex')
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function createAgentHookSessions({
  receiver,
  settingsDir,
  tracker,
  versions,
  writeSettingsFile,
  removeSettingsFile,
  log,
  createToken = createRandomToken
}: AgentHookSessionsDeps): AgentHookSessions {
  const without = (ownerId: number, unavailableReason: AgentHooksUnavailableReason): PreparedAgentHooks => ({
    ownerId,
    hooks: null,
    unavailableReason
  })

  return {
    async prepare(ownerId, plan) {
      try {
        const check = await versions.readClaudeVersion(plan)
        if (check.kind !== 'supported') return without(ownerId, 'claude-version-unsupported')
      } catch (err) {
        log(`[agent-hooks] claude の版を確かめられませんでした: ${messageOf(err)}`)
        return without(ownerId, 'claude-version-unsupported')
      }
      try {
        const { baseUrl } = await receiver.ensureListening()
        const dir = await settingsDir.ensure()
        const token = createToken()
        const settingsPath = await writeSettingsFile(dir, buildAgentHookSettings({ baseUrl, token }))
        return { ownerId, hooks: { settingsPath, token }, unavailableReason: null }
      } catch (err) {
        // 例外の文言にトークンは含まれない(トークンは JSON の中身だけで、パス・URL に入れない)
        log(`[agent-hooks] hooks の受け口・設定のファイルを用意できませんでした: ${messageOf(err)}`)
        return without(ownerId, 'receiver-unavailable')
      }
    },
    activate(prepared, sessionId) {
      if (prepared.hooks === null) {
        tracker.addSession(prepared.ownerId, sessionId, { kind: 'unconfirmed', reason: prepared.unavailableReason })
        return
      }
      receiver.addToken(prepared.hooks.token, { ownerId: prepared.ownerId, sessionId })
      tracker.addSession(prepared.ownerId, sessionId, { kind: 'pending' })
    },
    release(prepared, sessionId) {
      if (prepared.hooks !== null) {
        receiver.removeToken(prepared.hooks.token)
        void removeSettingsFile(prepared.hooks.settingsPath)
      }
      if (sessionId !== null) tracker.removeSession(prepared.ownerId, sessionId)
    }
  }
}
```

- [ ] **Step 6: 通す**

Run: `npx vitest run src/main/__tests__/agentClaudeVersion.test.ts src/main/__tests__/agentHookSessions.test.ts`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix src/main/agentClaudeVersion.ts src/main/agentHookSessions.ts src/main/__tests__/agentClaudeVersion.test.ts src/main/__tests__/agentHookSessions.test.ts && npx eslint --max-warnings 0 src/main/agentClaudeVersion.ts src/main/agentHookSessions.ts src/main/__tests__/agentClaudeVersion.test.ts src/main/__tests__/agentHookSessions.test.ts`
Expected: エラー・警告なし

---

### Task 7: 起動への組み込み（`buildAgentLaunchArgs`・`buildAgentEnv`・starter・`agentHooksLifecycle`・`ipcHandlers`・結合テスト）

> **気をつける知見:** L-001・L-004（起動しなかったら自分のファイルだけを消す）・L-010（後始末は 1 つの失敗で止めない）・L-019・L-034・L-060（`buildAgentLaunchArgs` の引数と starter の `hooks` は必須）・L-061（`before-quit` と `will-quit`）・L-428

**Files:**
- Modify: `src/main/agentCommand.ts`（L18 の `AGENT_COMMAND_NAME` の説明、L88-113 の `buildAgentEnv` の末尾に `NO_PROXY`、L139-158 の `buildAgentLaunchArgs` に 3 つ目の引数 `hookSettingsPath: string | null` と説明、L123 の `AgentLaunchPlan.args` の説明）
- Modify: `src/main/agentSessionStarter.ts`（L42-63 の `AgentSessionStarterDeps` に必須の `hooks`、L107-120 の分割代入、L175-247 の create の中の `prepare`・`activate`・`release` の呼び出しと `buildAgentLaunchArgs` の 3 つ目の引数、L26-32 の先頭の説明）
- Create: `src/main/agentHooksLifecycle.ts`
- Modify: `src/main/ipcHandlers.ts`（受け口・設定のディレクトリ・版の確認・`agentHookSessions` の組み立て、`setupAgentHooksLifecycle` の呼び出し、starter の `hooks`）
- Create: `src/main/__tests__/helpers/fakeAgentHookSessions.ts`
- Test: `src/main/__tests__/agentCommand.test.ts`（`buildAgentEnv(NO_PROXY)` の describe、`buildAgentLaunchArgs` の 3 つ目の引数）
- Test: `src/main/__tests__/agentSessionStarter.test.ts`（`makeStarterService` の既定の依存に偽の `hooks`、新しい describe）
- Test: `src/main/__tests__/handlers/agentTerminalHandlers.test.ts`（`register` の `createAgentSessionStarter` に偽の `hooks`）
- Test: `src/main/__tests__/agentHooksLifecycle.test.ts`（新規）
- Test: `src/main/__tests__/ipcHandlers.test.ts`（新しいモジュールのモックと組み立ての確認）
- Test: `src/main/__tests__/agentHooks.integration.test.ts`（新規。受け口・追跡・`agentHookSessions` を実物で組み立て、偽の `claude` の要求を送る。`claude` は起動しない）

**Interfaces:**
- Consumes: Task 2 の `createAgentHookSettingsDir`・`writeAgentHookSettingsFile`・`removeAgentHookSettingsFile`・`AgentHookSettingsDir`、Task 3 の `createAgentHookReceiver`・`AgentHookReceiver`・`sendHookRequest`（テスト）、Task 4 の `createAgentToolActivity`・`AgentToolActivity`、Task 5 の `ipcHandlers.ts` の `agentToolActivity`、Task 6 の `createClaudeVersionReader`・`nodeExecFile`・`createAgentHookSessions`・`AgentHookSessions`・`PreparedAgentHooks`
- Produces:
```ts
// src/main/agentCommand.ts
export function buildAgentLaunchArgs(
  launch: AgentLaunchRequest,
  claudeSessionId: string,
  hookSettingsPath: string | null
): string[]
export const AGENT_NO_PROXY_HOSTS: readonly string[]  // ['127.0.0.1', 'localhost']

// src/main/agentSessionStarter.ts
export interface AgentSessionStarterDeps {
  // …既存の項目…
  /** claude の hooks の準備(prepare)・結び付け(activate)・解放(release)。組み立ては ipcHandlers.ts(agentHookSessions) */
  hooks: Pick<AgentHookSessions, 'prepare' | 'activate' | 'release'>
}

// src/main/agentHooksLifecycle.ts
export interface AgentHooksLifecycleParts {
  receiver: Pick<AgentHookReceiver, 'close'>
  settingsDir: Pick<AgentHookSettingsDir, 'removeSync'>
  tracker: Pick<AgentToolActivity, 'close'>
}
export function setupAgentHooksLifecycle(app: Pick<App, 'on'>, parts: AgentHooksLifecycleParts): void

// src/main/__tests__/helpers/fakeAgentHookSessions.ts
export interface FakeAgentHookSessions {
  prepare: Mock<AgentHookSessions['prepare']>
  activate: Mock<AgentHookSessions['activate']>
  release: Mock<AgentHookSessions['release']>
  calls: string[]
}
export function preparedWithoutHooks(ownerId: number): PreparedAgentHooks
export function makeFakeAgentHookSessions(
  prepared?: (ownerId: number) => PreparedAgentHooks
): FakeAgentHookSessions
```

- [ ] **Step 1: `agentCommand` の失敗するテストを書く**

`src/main/__tests__/agentCommand.test.ts`:
- `describe('buildAgentLaunchArgs', …)` を次に置き換える:
```ts
describe('buildAgentLaunchArgs', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  it('new は --session-id、resume は --resume に、渡した ID をそのまま続ける(hooks なしは 2 つだけ)', () => {
    expect(buildAgentLaunchArgs({ kind: 'new' }, ID, null)).toEqual(['--session-id', ID])
    expect(buildAgentLaunchArgs({ kind: 'resume', claudeSessionId: ID }, ID, null)).toEqual([
      '--resume',
      ID
    ])
  })

  it('設定のファイルのパスがあれば、後ろに --settings <パス> を足す(ほかの引数は足さない)', () => {
    expect(buildAgentLaunchArgs({ kind: 'new' }, ID, '/tmp/prompt-ide-agent-hooks-x/a.json')).toEqual([
      '--session-id',
      ID,
      '--settings',
      '/tmp/prompt-ide-agent-hooks-x/a.json'
    ])
    expect(
      buildAgentLaunchArgs({ kind: 'resume', claudeSessionId: ID }, ID, '/tmp/prompt-ide-agent-hooks-x/a.json')
    ).toEqual(['--resume', ID, '--settings', '/tmp/prompt-ide-agent-hooks-x/a.json'])
  })

  it('未知の kind は既定の --session-id へ流さず投げる', () => {
    const unknownLaunch = { kind: 'fork', claudeSessionId: ID } as unknown as AgentLaunchRequest
    expect(() => buildAgentLaunchArgs(unknownLaunch, ID, null)).toThrow('未知の起動の指定です')
  })
})
```
- `describe('buildAgentEnv', …)` の後に足す:
```ts
describe('buildAgentEnv(NO_PROXY)', () => {
  it('どちらも無ければ、NO_PROXY・no_proxy の両方に 127.0.0.1,localhost を入れる', () => {
    const env = buildAgentEnv({}, '/p', 'darwin')
    expect(env.NO_PROXY).toBe('127.0.0.1,localhost')
    expect(env.no_proxy).toBe('127.0.0.1,localhost')
  })

  it('NO_PROXY だけがあれば、既存の値を残して両方に同じ値を入れる', () => {
    const env = buildAgentEnv({ NO_PROXY: 'corp.example, .internal' }, '/p', 'linux')
    expect(env.NO_PROXY).toBe('corp.example,.internal,127.0.0.1,localhost')
    expect(env.no_proxy).toBe('corp.example,.internal,127.0.0.1,localhost')
  })

  it('no_proxy だけがあれば、NO_PROXY にも同じ値を入れる', () => {
    const env = buildAgentEnv({ no_proxy: 'corp.example' }, '/p', 'darwin')
    expect(env.NO_PROXY).toBe('corp.example,127.0.0.1,localhost')
    expect(env.no_proxy).toBe('corp.example,127.0.0.1,localhost')
  })

  it('両方が違う値なら、和集合(NO_PROXY の順 → no_proxy の順)を両方に入れ、重複を足さない', () => {
    const env = buildAgentEnv({ NO_PROXY: 'a,localhost', no_proxy: 'b,a' }, '/p', 'darwin')
    expect(env.NO_PROXY).toBe('a,localhost,b,127.0.0.1')
    expect(env.no_proxy).toBe('a,localhost,b,127.0.0.1')
  })

  it('既にあれば足さない', () => {
    expect(buildAgentEnv({ NO_PROXY: '127.0.0.1,localhost' }, '/p', 'linux').NO_PROXY).toBe('127.0.0.1,localhost')
  })

  it('Windows は名前の大文字小文字を区別しないため、NO_PROXY 1 つにまとめる', () => {
    const env = buildAgentEnv({ no_proxy: 'corp.example' }, 'C:\\p', 'win32')
    expect(Object.keys(env).filter((key) => key.toUpperCase() === 'NO_PROXY')).toEqual(['NO_PROXY'])
    expect(env.NO_PROXY).toBe('corp.example,127.0.0.1,localhost')
  })

  it('元の env を変えない', () => {
    const given = { NO_PROXY: 'a' }
    buildAgentEnv(given, '/p', 'darwin')
    expect(given).toEqual({ NO_PROXY: 'a' })
  })
})
```

Run: `npx vitest run src/main/__tests__/agentCommand.test.ts`
Expected: FAIL（`--settings` が付かない・`NO_PROXY` が無い）

- [ ] **Step 2: `agentCommand` を実装する**

`src/main/agentCommand.ts`:
- L18 の説明を `/** 起動するコマンドの名前。引数は main が決めたセッションの指定(--session-id / --resume と UUID)と、hooks の設定のファイル(--settings と main が作った絶対パス)だけ。--dangerously-skip-permissions などは付けない */` に直す
- L123 の `AgentLaunchPlan.args` の説明を `/** 引数(空。セッションの指定と --settings は starter が buildAgentLaunchArgs で後ろに足す) */` に直す
- `buildAgentEnv` の前に足す:
```ts
/** hooks の受け口(127.0.0.1)への要求をプロキシへ送らないための除外(トークンをプロキシへ渡さない) */
export const AGENT_NO_PROXY_HOSTS: readonly string[] = ['127.0.0.1', 'localhost']

/**
 * NO_PROXY・no_proxy の既存の値(カンマ区切り)の和集合に 127.0.0.1・localhost を足す。macOS・Linux は同じ値を両方に設定する
 * (片方だけのツールでも既存の除外が効くように)。Windows は名前の大文字小文字を区別しないため NO_PROXY 1 つにまとめる
 */
function addLoopbackNoProxy(env: Record<string, string>, platform: NodeJS.Platform): void {
  const isWindows = platform === 'win32'
  const keys = isWindows
    ? Object.keys(env).filter((key) => key.toUpperCase() === 'NO_PROXY')
    : ['NO_PROXY', 'no_proxy'].filter((key) => key in env)
  const hosts: string[] = []
  for (const key of keys) {
    for (const item of env[key].split(',')) {
      const host = item.trim()
      if (host !== '' && !hosts.includes(host)) hosts.push(host)
    }
  }
  for (const host of AGENT_NO_PROXY_HOSTS) if (!hosts.includes(host)) hosts.push(host)
  const value = hosts.join(',')
  if (isWindows) {
    for (const key of keys) delete env[key]
    env.NO_PROXY = value
    return
  }
  env.NO_PROXY = value
  env.no_proxy = value
}
```
- `buildAgentEnv` の `return env` の直前に `addLoopbackNoProxy(env, platform)` を足す（関数の説明に「NO_PROXY・no_proxy にループバックを足す」を足す）
- `buildAgentLaunchArgs` を次に置き換える:
```ts
/**
 * claude の起動の引数(設計書「起動の流れ」3、hooks の設計書「起動の引数」)。新しく起動するときは main が振った ID を --session-id で、
 * 再開は記録と照合した ID を --resume で渡す。hookSettingsPath(main が作った設定のファイルの絶対パス。L-034)があれば後ろに
 * --settings を足す。null(受け口を用意できない・claude の版が対応していると分からない)なら 2 つだけ。省略できる引数にしない(L-060)。
 * claudeSessionId は検証を通った値をそのまま使い、別の場所で読み直さない(L-018)。起動の種類を足したときに既定の --session-id へ
 * 流さないよう、kind ごとに分けて未知の kind は投げる(L-044)
 */
export function buildAgentLaunchArgs(
  launch: AgentLaunchRequest,
  claudeSessionId: string,
  hookSettingsPath: string | null
): string[] {
  const settings = hookSettingsPath === null ? [] : ['--settings', hookSettingsPath]
  switch (launch.kind) {
    case 'new':
      return ['--session-id', claudeSessionId, ...settings]
    case 'resume':
      return ['--resume', claudeSessionId, ...settings]
    default: {
      const unknownLaunch: never = launch
      throw new Error(`未知の起動の指定です: ${JSON.stringify(unknownLaunch)}`)
    }
  }
}
```

Run: `npx vitest run src/main/__tests__/agentCommand.test.ts`
Expected: PASS（`npm run typecheck` は starter の呼び出しが 2 引数のままのため、Step 4 まで通らない）

- [ ] **Step 3: starter の失敗するテストを書く**

`src/main/__tests__/helpers/fakeAgentHookSessions.ts`:
```ts
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { AgentHookSessions, PreparedAgentHooks } from '../../agentHookSessions'

// starter・handler のテスト用の偽の hooks。呼ばれた順を calls に記録する。既定は hooks なし(今までどおりの引数)で起動する

export interface FakeAgentHookSessions {
  prepare: Mock<AgentHookSessions['prepare']>
  activate: Mock<AgentHookSessions['activate']>
  release: Mock<AgentHookSessions['release']>
  calls: string[]
}

export function preparedWithoutHooks(ownerId: number): PreparedAgentHooks {
  return { ownerId, hooks: null, unavailableReason: 'claude-version-unsupported' }
}

export function makeFakeAgentHookSessions(
  prepared: (ownerId: number) => PreparedAgentHooks = preparedWithoutHooks
): FakeAgentHookSessions {
  const calls: string[] = []
  return {
    calls,
    prepare: vi.fn<AgentHookSessions['prepare']>(async (ownerId) => {
      calls.push('prepare')
      return prepared(ownerId)
    }),
    activate: vi.fn<AgentHookSessions['activate']>((_prepared, sessionId) => {
      calls.push(`activate:${sessionId}`)
    }),
    release: vi.fn<AgentHookSessions['release']>((_prepared, sessionId) => {
      calls.push(`release:${sessionId ?? 'null'}`)
    })
  }
}
```

`src/main/__tests__/agentSessionStarter.test.ts`:
- import に `import { makeFakeAgentHookSessions } from './helpers/fakeAgentHookSessions'`・`import type { FakeAgentHookSessions } from './helpers/fakeAgentHookSessions'`・`import type { PreparedAgentHooks } from '../agentHookSessions'`
- `let reservations: ClaudeSessionReservations` の次に `let hooks: FakeAgentHookSessions`、`beforeEach` に `hooks = makeFakeAgentHookSessions()`、`makeStarterService` の既定の依存に `hooks,`（`isDirectory,` の次。`...overrides` より前）
- ファイルの末尾に足す:
```ts
describe('createAgentSessionStarter(hooks)', () => {
  const PREPARED: PreparedAgentHooks = {
    ownerId: 1,
    hooks: { settingsPath: '/tmp/prompt-ide-agent-hooks-x/abc.json', token: 'ab'.repeat(32) },
    unavailableReason: null
  }

  it('prepare は resolveLaunch の後・records.whenLoaded の前に、所有者と起動の計画で呼ぶ', async () => {
    const order: string[] = []
    resolveLaunch.mockImplementation(async () => {
      order.push('resolveLaunch')
      return OK_LAUNCH
    })
    hooks.prepare.mockImplementation(async (ownerId) => {
      order.push('prepare')
      return { ownerId, hooks: null, unavailableReason: 'claude-version-unsupported' }
    })
    const start = makeStarter({
      records: {
        whenLoaded: async () => {
          order.push('whenLoaded')
          await records.whenLoaded()
        },
        has: (key, id) => records.has(key, id),
        last: (key) => records.last(key),
        record: (key, id) => records.record(key, id)
      }
    })
    await start(1, REQUEST, makeSink())
    expect(order).toEqual(['resolveLaunch', 'prepare', 'whenLoaded'])
    expect(hooks.prepare).toHaveBeenCalledExactlyOnceWith(1, OK_LAUNCH.plan)
  })

  it('hooks があれば --settings <パス> を付けて起動し、spawn の成功の後に activate、終了で release(prepared, sessionId)', async () => {
    hooks = makeFakeAgentHookSessions(() => PREPARED)
    const start = makeStarter({ hooks })
    await expect(start(1, REQUEST, makeSink())).resolves.toMatchObject({ kind: 'started' })
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/claude',
      ['--x', '--session-id', NEW_IDS[0], '--settings', '/tmp/prompt-ide-agent-hooks-x/abc.json'],
      expect.any(Object)
    )
    expect(hooks.activate).toHaveBeenCalledExactlyOnceWith(PREPARED, 'sid-1')
    expect(hooks.release).not.toHaveBeenCalled()
    pty.emitExit(0, 0)
    await vi.waitFor(() => expect(hooks.release).toHaveBeenCalledExactlyOnceWith(PREPARED, 'sid-1'))
    expect(hooks.calls).toEqual(['prepare', 'activate:sid-1', 'release:sid-1'])
  })

  it('hooks: null なら今までどおり 2 つの引数で起動し、activate に prepared を渡す', async () => {
    const start = makeStarter()
    await start(1, REQUEST, makeSink())
    expect(spawnPty).toHaveBeenCalledWith('/bin/claude', ['--x', '--session-id', NEW_IDS[0]], expect.any(Object))
    expect(hooks.activate).toHaveBeenCalledExactlyOnceWith(
      { ownerId: 1, hooks: null, unavailableReason: 'claude-version-unsupported' },
      'sid-1'
    )
  })

  it('起動の直前の確かめで取り消したら release(prepared, null) を 1 回呼び、activate しない', async () => {
    const loaded = deferred<void>()
    const start = makeStarter({
      records: {
        whenLoaded: () => loaded.promise,
        has: (key, id) => records.has(key, id),
        last: (key) => records.last(key),
        record: (key, id) => records.record(key, id)
      }
    })
    const sink = makeSink()
    const pending = start(1, REQUEST, sink)
    await vi.waitFor(() => expect(hooks.prepare).toHaveBeenCalledOnce())
    sink.gone = true
    loaded.resolve()
    await expect(pending).resolves.toEqual(CANCELED)
    expect(hooks.release).toHaveBeenCalledExactlyOnceWith(
      { ownerId: 1, hooks: null, unavailableReason: 'claude-version-unsupported' },
      null
    )
    expect(hooks.activate).not.toHaveBeenCalled()
  })

  it('ID の選択の拒否(記録に無い ID の再開)で release(prepared, null) を 1 回呼ぶ', async () => {
    const start = makeStarter()
    await start(1, { ...REQUEST, launch: { kind: 'resume', claudeSessionId: NEW_IDS[4] } }, makeSink())
    expect(hooks.release).toHaveBeenCalledExactlyOnceWith(expect.any(Object), null)
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('予約の失敗(同じ会話の二重の起動)で release(prepared, null) を 1 回呼ぶ', async () => {
    const start = makeStarter({ reservations: { tryReserve: () => null } })
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({ kind: 'error', error: 'session-in-use' })
    expect(hooks.release).toHaveBeenCalledExactlyOnceWith(expect.any(Object), null)
  })

  it('spawn の失敗で release(prepared, null) を 1 回呼ぶ', async () => {
    spawnPty.mockImplementation(() => {
      throw new Error('spawn boom')
    })
    const start = makeStarter()
    await expect(start(1, REQUEST, makeSink())).resolves.toMatchObject({ kind: 'error', error: 'spawn-failed' })
    expect(hooks.release).toHaveBeenCalledExactlyOnceWith(expect.any(Object), null)
    expect(hooks.activate).not.toHaveBeenCalled()
  })

  it.each<[string, Partial<AgentSessionStarterDeps>]>([
    [
      'records.whenLoaded() の reject',
      {
        records: {
          whenLoaded: async () => Promise.reject(new Error('load failed')),
          has: () => false,
          last: () => null,
          record: () => undefined
        }
      }
    ],
    [
      'createSessionId の例外',
      {
        createSessionId: () => {
          throw new Error('id failed')
        }
      }
    ],
    [
      'selectClaudeSessionId の例外(新しい ID の採番の失敗)',
      {
        createClaudeSessionId: () => {
          throw new Error('uuid failed')
        }
      }
    ]
  ])('%s で起動が例外で終わったら release(prepared, null) を 1 回呼ぶ', async (_label, overrides) => {
    const start = makeStarter(overrides)
    await expect(start(1, REQUEST, makeSink())).rejects.toThrow()
    expect(hooks.release).toHaveBeenCalledExactlyOnceWith(expect.any(Object), null)
    expect(hooks.activate).not.toHaveBeenCalled()
  })

  it('claude が見つからない・作業ディレクトリが無いときは prepare しない', async () => {
    resolveLaunch.mockResolvedValueOnce({ kind: 'not-found', shellPathUnavailable: false })
    await makeStarter()(1, REQUEST, makeSink())
    isDirectory.mockResolvedValueOnce(false)
    await makeStarter()(1, REQUEST, makeSink())
    expect(hooks.prepare).not.toHaveBeenCalled()
  })
})
```

`src/main/__tests__/handlers/agentTerminalHandlers.test.ts` の `register` の `createAgentSessionStarter({ … })` の `platform: 'linux'` の次に `hooks: makeFakeAgentHookSessions()` を足し、import に `import { makeFakeAgentHookSessions } from '../helpers/fakeAgentHookSessions'` を足す。

Run: `npx vitest run src/main/__tests__/agentSessionStarter.test.ts`
Expected: FAIL（`hooks.prepare` が呼ばれない・`--settings` が付かない）

- [ ] **Step 4: starter を実装する**

`src/main/agentSessionStarter.ts`:
- import に `import type { AgentHookSessions } from './agentHookSessions'`
- `AgentSessionStarterDeps` の `reservations` の後に:
```ts
  /** claude の hooks の準備(prepare)・spawn の後の結び付け(activate)・終了での解放(release)。組み立ては ipcHandlers.ts
   *  (agentHookSessions)。省略できない(渡し忘れで hooks なしの起動に黙って倒れないように。L-060) */
  hooks: Pick<AgentHookSessions, 'prepare' | 'activate' | 'release'>
```
- `createAgentSessionStarter` の分割代入に `hooks,`（`reservations,` の次）
- create の中の `const launch = await resolveLaunch()` の not-found の分岐の後から `return { kind: 'created', session }` までを次に置き換える:
```ts
        // hooks の準備(版の確認・受け口・設定のファイル)。spawn の直前の await を挟まない区間に入れないため、ここで待つ。
        // pty の sessionId はまだ振らない(その区間で振る)。activate しなかったら finally で自分が書いたファイルだけを消す(L-004)
        const prepared = await hooks.prepare(ownerId, launch.plan)
        let activated = false
        try {
          // 再開の照合は下の同期の区間で行うため、記録の読み込みの完了をここで待つ(読み込みが間に合わない経路を作らない)
          await records.whenLoaded()
          // registry.start の前の await(realpath)の間に届いた停止(リロード・破棄・フォルダの切り替え)は、registry.start が
          // 控える世代に含まれてしまい registry では取り消せない。入口で控えた世代・破棄・許可のフォルダを起動の直前に
          // 確かめ直し、所有者のいない・リロード前の・切り替え前のフォルダのセッションを作らない
          if (
            registry.generationOf(ownerId, request.slotId) !== requestedGeneration ||
            sink.isGone() ||
            folderAccess.get(ownerId) !== allowedFolder
          ) {
            return { kind: 'failed', result: agentStartCanceled() }
          }
          // ここから spawn までは await を挟まない(記録の照合・予約の判定と予約の間に、別の起動が割り込まないように)
          const selection = selectClaudeSessionId(
            request.launch,
            folderKey,
            records,
            createClaudeSessionId
          )
          if (selection.kind === 'rejected') return { kind: 'failed', result: selection.result }
          const { claudeSessionId } = selection
          // 予約の後で投げて予約が残らないよう、ID は予約の前に振る
          const sessionId = createSessionId()
          // 新しい ID も予約する(UUID の衝突は起きない前提だが、外す経路を 1 つにそろえるため)
          const releaseReservation = reservations.tryReserve(claudeSessionId)
          if (releaseReservation === null) {
            return { kind: 'failed', result: { kind: 'error', error: 'session-in-use' } }
          }
          let session: AgentSession
          try {
            session = startAgentSession({
              id: sessionId,
              spawn: spawnPty,
              file: launch.plan.file,
              // 検証を通った ID と、main が作った設定のファイルの絶対パスをそのまま引数にする(L-018・L-034)
              args: [
                ...launch.plan.args,
                ...buildAgentLaunchArgs(
                  request.launch,
                  claudeSessionId,
                  prepared.hooks?.settingsPath ?? null
                )
              ],
              env: launch.plan.env,
              cwd: allowedFolder,
              cols: request.cols,
              rows: request.rows,
              stopTree,
              callbacks: {
                onData: (data) => sink.onData({ sessionId, data }),
                onExit: (exit) => sink.onExit({ sessionId, ...exit })
              }
            })
          } catch (err) {
            releaseReservation()
            const detail = err instanceof Error ? err.message : String(err)
            return { kind: 'failed', result: { kind: 'error', error: 'spawn-failed', detail } }
          }
          // spawn の直後(await を挟まず)にトークンを表へ足し、追跡にセッションを足す。claude の最初の知らせより先に済む
          hooks.activate(prepared, sessionId)
          activated = true
          // 予約・Map・hooks は exited の解決で外す。registry が取り消した起動の停止の完了・終了・止める操作の完了は、どれも exited の
          // 解決になる(AgentSession.stop は止まりきると exited を解決する)。止める操作の間(stoppingSessions)は予約が残る。
          // registry へ返す前に購読するので、registry が枠からセッションを外すより先に Map から消える
          claudeSessionIdBySessionId.set(sessionId, claudeSessionId)
          void session.exited.then(() => {
            claudeSessionIdBySessionId.delete(sessionId)
            releaseReservation()
            hooks.release(prepared, sessionId)
          })
          created.claudeSessionId = claudeSessionId
          return { kind: 'created', session }
        } finally {
          // 取り消し・ID の選択の拒否・予約の失敗・spawn の失敗・例外(records.whenLoaded の reject など)で起動しなかったら、
          // 自分が書いた設定のファイルだけを消す(トークンはまだ表に無い。L-004・L-428)
          if (!activated) hooks.release(prepared, null)
        }
```
- 先頭の説明（L26-32）の最後の文に `、claude の hooks の準備・結び付け・解放は agentHookSessions.ts` を足し、`引数(--session-id / --resume)` を `引数(--session-id / --resume と --settings)` に直す

Run: `npx vitest run src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/agentCommand.test.ts`
Expected: PASS

- [ ] **Step 5: 後始末の失敗するテストを書いて実装する**

`src/main/__tests__/agentHooksLifecycle.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { setupAgentHooksLifecycle } from '../agentHooksLifecycle'

let errorSpy: MockInstance<typeof console.error>
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  errorSpy.mockRestore()
})

function setup(): {
  app: EventEmitter
  receiver: { close: ReturnType<typeof vi.fn> }
  settingsDir: { removeSync: ReturnType<typeof vi.fn> }
  tracker: { close: ReturnType<typeof vi.fn> }
} {
  const app = new EventEmitter()
  const receiver = { close: vi.fn() }
  const settingsDir = { removeSync: vi.fn() }
  const tracker = { close: vi.fn() }
  setupAgentHooksLifecycle(app as unknown as App, { receiver, settingsDir, tracker })
  return { app, receiver, settingsDir, tracker }
}

describe('setupAgentHooksLifecycle', () => {
  it('will-quit で受け口・設定のディレクトリ・追跡を 1 回ずつ片付け、before-quit には登録しない(止める途中の SessionEnd を受けるため)', () => {
    const { app, receiver, settingsDir, tracker } = setup()
    expect(app.listenerCount('before-quit')).toBe(0)
    app.emit('before-quit', { preventDefault: vi.fn() })
    expect(receiver.close).not.toHaveBeenCalled()
    const event = { preventDefault: vi.fn() }
    app.emit('will-quit', event)
    expect(receiver.close).toHaveBeenCalledOnce()
    expect(settingsDir.removeSync).toHaveBeenCalledOnce()
    expect(tracker.close).toHaveBeenCalledOnce()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('1 つが投げても残りを呼ぶ(L-010)', () => {
    const { app, receiver, settingsDir, tracker } = setup()
    receiver.close.mockImplementation(() => {
      throw new Error('close failed')
    })
    expect(() => app.emit('will-quit', { preventDefault: vi.fn() })).not.toThrow()
    expect(settingsDir.removeSync).toHaveBeenCalledOnce()
    expect(tracker.close).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledWith('[agent-hooks] 終了の後始末に失敗しました:', expect.any(Error))
  })
})
```

Run: `npx vitest run src/main/__tests__/agentHooksLifecycle.test.ts`
Expected: FAIL（`Cannot find module '../agentHooksLifecycle'`）

`src/main/agentHooksLifecycle.ts`:
```ts
import type { App } from 'electron'
import type { AgentHookReceiver } from './agentHookReceiver'
import type { AgentHookSettingsDir } from './agentHookSettings'
import type { AgentToolActivity } from './agentToolActivity'

// claude の hooks の後始末の契機(設計書「アプリの終了の後始末」)。agentSessionLifecycle.ts は 1 回目の before-quit を止めて
// セッションの停止を待つため、before-quit で受け口を閉じると止める途中の claude の SessionEnd が届かず、動いている claude の
// 設定のファイルが先に消える。will-quit(停止を待った後の終了)で、受け口・設定のディレクトリ・追跡のタイマーを片付ける。
// 1 つが失敗しても残りを試す(L-010)

export interface AgentHooksLifecycleParts {
  receiver: Pick<AgentHookReceiver, 'close'>
  settingsDir: Pick<AgentHookSettingsDir, 'removeSync'>
  tracker: Pick<AgentToolActivity, 'close'>
}

export function setupAgentHooksLifecycle(
  app: Pick<App, 'on'>,
  { receiver, settingsDir, tracker }: AgentHooksLifecycleParts
): void {
  app.on('will-quit', () => {
    for (const step of [() => receiver.close(), () => settingsDir.removeSync(), () => tracker.close()]) {
      try {
        step()
      } catch (err) {
        console.error('[agent-hooks] 終了の後始末に失敗しました:', err)
      }
    }
  })
}
```

Run: `npx vitest run src/main/__tests__/agentHooksLifecycle.test.ts`
Expected: PASS

- [ ] **Step 6: `ipcHandlers` の組み立ての失敗するテストを書く**

`src/main/__tests__/ipcHandlers.test.ts`:
- hoisted の宣言とモックに足す（Task 5 の `mockToolActivity` の後）:
```ts
const mockHookReceiver = vi.hoisted(() => ({
  ensureListening: vi.fn(),
  addToken: vi.fn(),
  removeToken: vi.fn(),
  close: vi.fn()
}))
const mockCreateAgentHookReceiver = vi.hoisted(() => vi.fn(() => mockHookReceiver))
vi.mock('../agentHookReceiver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentHookReceiver')>()),
  createAgentHookReceiver: mockCreateAgentHookReceiver
}))
const mockHookSettingsDir = vi.hoisted(() => ({ ensure: vi.fn(), removeSync: vi.fn() }))
const mockCreateAgentHookSettingsDir = vi.hoisted(() => vi.fn(() => mockHookSettingsDir))
vi.mock('../agentHookSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentHookSettings')>()),
  createAgentHookSettingsDir: mockCreateAgentHookSettingsDir
}))
const mockVersionReader = vi.hoisted(() => ({ readClaudeVersion: vi.fn() }))
const mockCreateClaudeVersionReader = vi.hoisted(() => vi.fn(() => mockVersionReader))
vi.mock('../agentClaudeVersion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentClaudeVersion')>()),
  createClaudeVersionReader: mockCreateClaudeVersionReader
}))
const mockHookSessions = vi.hoisted(() => ({ prepare: vi.fn(), activate: vi.fn(), release: vi.fn() }))
const mockCreateAgentHookSessions = vi.hoisted(() => vi.fn(() => mockHookSessions))
vi.mock('../agentHookSessions', () => ({ createAgentHookSessions: mockCreateAgentHookSessions }))
const mockSetupAgentHooksLifecycle = vi.hoisted(() => vi.fn())
vi.mock('../agentHooksLifecycle', () => ({ setupAgentHooksLifecycle: mockSetupAgentHooksLifecycle }))
```
- import に `import { nodeExecFile } from '../agentClaudeVersion'`・`import { removeAgentHookSettingsFile, writeAgentHookSettingsFile } from '../agentHookSettings'`
- 新しい it を足す:
```ts
  it('hooks の受け口・設定のディレクトリ・版の確認・agentHookSessions を組み立て、starter の hooks と will-quit の後始末に渡す', async () => {
    registerIpcHandlers(mockIpcMain)
    // 受け口は追跡の deliver に知らせを渡し、段階 A の onToolStart はすぐ解決し、onToolStartTimedOut は何もしない
    const receiverDeps = (mockCreateAgentHookReceiver.mock.calls[0] as unknown[])[0] as {
      deliver: (ownerId: number, sessionId: string, event: unknown) => void
      onToolStart: (ownerId: number, signal: AbortSignal) => Promise<void>
      onToolStartTimedOut: (ownerId: number) => void
      log: (message: string) => void
    }
    const event = { kind: 'turn-end', hookEventName: 'Stop', toolName: null }
    receiverDeps.deliver(3, 'sid-1', event)
    expect(mockToolActivity.deliver).toHaveBeenCalledWith(3, 'sid-1', event)
    await expect(receiverDeps.onToolStart(3, new AbortController().signal)).resolves.toBeUndefined()
    expect(() => receiverDeps.onToolStartTimedOut(3)).not.toThrow()
    // 版の確認は実物の execFile・stat と process.platform で行う
    const versionDeps = (mockCreateClaudeVersionReader.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(versionDeps.execFile).toBe(nodeExecFile)
    expect(versionDeps.platform).toBe(process.platform)
    // agentHookSessions は同じ受け口・設定のディレクトリ・追跡・版の確認と、実物のファイルの書き込み・削除を使う
    expect(mockCreateAgentHookSessions).toHaveBeenCalledOnce()
    const sessionsDeps = (mockCreateAgentHookSessions.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(sessionsDeps.receiver).toBe(mockHookReceiver)
    expect(sessionsDeps.settingsDir).toBe(mockHookSettingsDir)
    expect(sessionsDeps.tracker).toBe(mockToolActivity)
    expect(sessionsDeps.versions).toBe(mockVersionReader)
    expect(sessionsDeps.writeSettingsFile).toBe(writeAgentHookSettingsFile)
    expect(sessionsDeps.removeSettingsFile).toBe(removeAgentHookSettingsFile)
    // starter の hooks は組み立てた agentHookSessions
    const starterDeps = (mockCreateAgentSessionStarter.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(starterDeps.hooks).toBe(mockHookSessions)
    // will-quit の後始末に同じ受け口・設定のディレクトリ・追跡を渡す
    expect(mockSetupAgentHooksLifecycle).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
      receiver: mockHookReceiver,
      settingsDir: mockHookSettingsDir,
      tracker: mockToolActivity
    })
  })
```

Run: `npx vitest run src/main/__tests__/ipcHandlers.test.ts`
Expected: FAIL（`mockCreateAgentHookReceiver` が呼ばれない）

- [ ] **Step 7: `ipcHandlers` を組み立てる**

`src/main/ipcHandlers.ts`:
- import に足す:
```ts
import { stat } from 'node:fs/promises'
import { createAgentHookReceiver } from './agentHookReceiver'
import {
  createAgentHookSettingsDir,
  removeAgentHookSettingsFile,
  writeAgentHookSettingsFile
} from './agentHookSettings'
import { createClaudeVersionReader, nodeExecFile } from './agentClaudeVersion'
import { createAgentHookSessions } from './agentHookSessions'
import { setupAgentHooksLifecycle } from './agentHooksLifecycle'
```
- Task 5 で足した `const agentToolActivity = createAgentToolActivity({ … })` の後（`createAgentSessionStarter` の前）に足す:
```ts
  // claude の hooks の受け口(127.0.0.1)。段階 A の onToolStart はすぐ解決し、onToolStartTimedOut は何もしない
  // (段階 B で記録の registry の waitForAgentPhase・markPeriodUnassignable につなぐ)
  const agentHookReceiver = createAgentHookReceiver({
    deliver: (ownerId, sessionId, event) => agentToolActivity.deliver(ownerId, sessionId, event),
    onToolStart: async () => undefined,
    onToolStartTimedOut: () => undefined,
    log: (message) => console.warn(message)
  })
  const agentHookSettingsDir = createAgentHookSettingsDir()
  // 起動ごとの hooks の準備(claude の版の確認 → 受け口 → 設定のファイル)・結び付け・解放
  const agentHookSessions = createAgentHookSessions({
    receiver: agentHookReceiver,
    settingsDir: agentHookSettingsDir,
    tracker: agentToolActivity,
    versions: createClaudeVersionReader({
      execFile: nodeExecFile,
      stat: (path) => stat(path),
      platform: process.platform,
      log: (message) => console.warn(message)
    }),
    writeSettingsFile: writeAgentHookSettingsFile,
    removeSettingsFile: removeAgentHookSettingsFile,
    log: (message) => console.warn(message)
  })
  // 受け口・設定のディレクトリ・追跡のタイマーは will-quit で片付ける(before-quit の停止の待ちの間も知らせを受ける)
  setupAgentHooksLifecycle(app, {
    receiver: agentHookReceiver,
    settingsDir: agentHookSettingsDir,
    tracker: agentToolActivity
  })
```
- `createAgentSessionStarter({ … })` の `createClaudeSessionId: randomUUID` の後に `hooks: agentHookSessions` を足す

Run: `npx vitest run src/main/__tests__/ipcHandlers.test.ts`
Expected: PASS

- [ ] **Step 8: 結合テストを書いて通す**

`src/main/__tests__/agentHooks.integration.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createAgentToolActivity } from '../agentToolActivity'
import type { AgentToolActivity } from '../agentToolActivity'
import { createAgentHookReceiver } from '../agentHookReceiver'
import type { AgentHookReceiver } from '../agentHookReceiver'
import {
  createAgentHookSettingsDir,
  removeAgentHookSettingsFile,
  writeAgentHookSettingsFile
} from '../agentHookSettings'
import type { AgentHookSettingsDir, AgentHookSettingsJson } from '../agentHookSettings'
import { createAgentHookSessions } from '../agentHookSessions'
import type { AgentHookSessions } from '../agentHookSessions'
import { sendHookRequest } from './helpers/agentHookHttp'
import type { HookResponse } from './helpers/agentHookHttp'

// 受け口・追跡・agentHookSessions を実物で組み立て、claude が送る形の要求を送る(claude は起動しない)。
// URL とトークンは prepare が書いた設定のファイルから読む(設定の URL と受け口のパスが食い違わないことも確かめる)

let tracker: AgentToolActivity
let receiver: AgentHookReceiver
let settingsDir: AgentHookSettingsDir
let sessions: AgentHookSessions

beforeEach(() => {
  tracker = createAgentToolActivity({ onPhaseChange: vi.fn(), devLog: null, warn: vi.fn() })
  receiver = createAgentHookReceiver({
    deliver: (ownerId, sessionId, event) => tracker.deliver(ownerId, sessionId, event),
    onToolStart: async () => undefined,
    onToolStartTimedOut: () => undefined,
    log: vi.fn()
  })
  settingsDir = createAgentHookSettingsDir()
  sessions = createAgentHookSessions({
    receiver,
    settingsDir,
    tracker,
    versions: { readClaudeVersion: async () => ({ kind: 'supported', version: '2.1.291' }) },
    writeSettingsFile: writeAgentHookSettingsFile,
    removeSettingsFile: removeAgentHookSettingsFile,
    log: vi.fn()
  })
})

afterEach(() => {
  receiver.close()
  tracker.close()
  settingsDir.removeSync()
})

/** 設定のファイルのイベントの URL へ、claude と同じ形(Bearer・application/json)で POST する */
function poster(settings: AgentHookSettingsJson): (event: keyof AgentHookSettingsJson['hooks'], body: unknown) => Promise<HookResponse> {
  return (event, body) => {
    const hook = settings.hooks[event][0].hooks[0]
    const url = new URL(hook.url)
    return sendHookRequest(Number(url.port), {
      path: url.pathname,
      headers: { Authorization: hook.headers.Authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }
}

describe('hooks の受け取りと区間の追跡(結合)', () => {
  it('pending(agent) → UserPromptSubmit で idle → PreToolUse で agent → PostToolUse の 2 秒後に idle。release の後は 401', async () => {
    const prepared = await sessions.prepare(1, { file: '/bin/claude', args: [], env: {} })
    if (prepared.hooks === null) throw new Error('hooks を用意できなかった')
    const settings = JSON.parse(readFileSync(prepared.hooks.settingsPath, 'utf8')) as AgentHookSettingsJson
    const post = poster(settings)
    sessions.activate(prepared, 'sid-1')
    expect(tracker.activityOf(1).phase).toBe('agent')

    expect((await post('UserPromptSubmit', { hook_event_name: 'UserPromptSubmit', session_id: 'c1', prompt: 'hi' })).status).toBe(200)
    expect(tracker.activityOf(1).phase).toBe('idle')

    await post('PreToolUse', {
      hook_event_name: 'PreToolUse',
      session_id: 'c1',
      tool_name: 'Edit',
      tool_use_id: 'toolu_1',
      tool_input: { file_path: '/x/a.txt' }
    })
    expect(tracker.activityOf(1).phase).toBe('agent')

    await post('PostToolUse', { hook_event_name: 'PostToolUse', session_id: 'c1', tool_name: 'Edit', tool_use_id: 'toolu_1' })
    expect(tracker.activityOf(1).phase).toBe('agent')
    await vi.waitFor(() => expect(tracker.activityOf(1).phase).toBe('idle'), { timeout: 4_000, interval: 100 })

    sessions.release(prepared, 'sid-1')
    await vi.waitFor(() => expect(existsSync(prepared.hooks?.settingsPath ?? '')).toBe(false))
    expect((await post('Stop', { hook_event_name: 'Stop' })).status).toBe(401)
    expect(tracker.activityOf(1).phase).toBe('paused')
  }, 10_000)
})
```

Run: `npx vitest run src/main/__tests__/agentHooks.integration.test.ts`
Expected: PASS（実時間で約 2 秒かかる）

- [ ] **Step 9: 通す（このタスクの全体）**

Run: `npx vitest run src/main`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --fix <このタスクで変更・作成した .ts のファイル> && npx eslint --max-warnings 0 <同じファイル>`（対象: `src/main/agentCommand.ts`・`src/main/agentSessionStarter.ts`・`src/main/agentHooksLifecycle.ts`・`src/main/ipcHandlers.ts`・`src/main/__tests__/helpers/fakeAgentHookSessions.ts`・`src/main/__tests__/agentCommand.test.ts`・`src/main/__tests__/agentSessionStarter.test.ts`・`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`・`src/main/__tests__/agentHooksLifecycle.test.ts`・`src/main/__tests__/ipcHandlers.test.ts`・`src/main/__tests__/agentHooks.integration.test.ts`）
Expected: エラー・警告なし

- [ ] **Step 10: 変異で確かめる**

`agentSessionStarter.ts` の `finally` の `if (!activated) hooks.release(prepared, null)` をコメントにして `npx vitest run src/main/__tests__/agentSessionStarter.test.ts` を走らせ、取り消し・拒否・予約・spawn・例外の 7 つのテストが落ちることを確かめて戻す。`buildAgentLaunchArgs` の 3 つ目の引数に `null` を渡すように変えて「hooks があれば --settings <パス> を付けて起動し…」が落ちることを確かめて戻す。

---

### Task 8: ROADMAP 更新と全体検証（テスト仕様書への追記と Artifact の再公開）

> **気をつける知見:** L-059（モックで確かめられない届き方を実機テスト仕様書で確かめる）

**Files:**
- Modify: `docs/manual-test-spec.md`（「## エージェントの変更の確認」の末尾〈AGC-087 の行の後、`## ソース管理（基本）` の前〉に `### 利用者の変更との区別` と AGC-088〜AGC-101 を足す。既存の項目は変えない）
- Modify: `ROADMAP.md`（L256 の「`claude` の起動の引数はセッションの指定だけ…hooks は使わない」、L447-452 の「エージェントの変更の確認の拡張」の項目。**prettier にかけない**）
- Modify: `docs/superpowers/specs/2026-10-04-agent-terminal-mvp-design.md`（末尾に「その後の変更（2026-10-13…）」の節）
- 生成（git 管理外）: `.superpowers/manual-test-spec.html`

**Interfaces:**
- Consumes: Task 1〜7 の実装（ログの形は `src/main/agentToolActivity.ts` の `writeLog`、拒んだ要求のログは `src/main/agentHookReceiver.ts` の `count` と一字一句同じにする）、Task 1 の確認の結果 15
- Produces: 実機テスト仕様書の AGC-088〜AGC-101（コントローラーが Artifact を再公開する）

- [ ] **Step 1: 実機テスト仕様書に追記する**

`docs/manual-test-spec.md` の AGC-087 の行の後（空行を 1 つ挟む）に、次をそのまま足す（1 行 1 項目。書式は仕様書の冒頭と `scripts/build-manual-test-spec.mjs` のとおり。今の AGC の最大は AGC-087 なので AGC-088 から振る）:
```markdown
### 利用者の変更との区別

> 前提: この領域の冒頭の前提と同じ。アプリの中のタブで起動した claude を使う（hooks はアプリが --settings で渡す）。段階 A の項目は npm run dev の端末の出力（[agent-hooks] の行）を見る。
> 前提: 段階 A では、一覧・印・確認の文言は変わらない（ウィンドウの段階を内部で追跡して開発版のログに出すだけ）。期待と違ったら、その [agent-hooks] の行と claude の画面を記録する。

- [ ] **AGC-088** `claude` を起動して、端末で `pgrep -fl claude` で起動した `claude` の pid を確かめ、`ps -o args= -p <その pid>` を実行する → `--settings <一時ディレクトリ>/<32 桁の 16 進>.json` が付いている。そのファイルは `ls -l` で `-rw-------`、親のディレクトリ（`prompt-ide-agent-hooks-` で始まる）は `ls -ld` で `drwx------`。ファイルの名前にも `ps` の出力にもトークン（64 桁の 16 進）が出ない
- [ ] **AGC-089** `claude` を起動した直後 → `npm run dev` の端末に `event=起動 … hooks=pending phase=paused→agent` の行が出る（`pending` の間は `agent`）。何も送らずに 1 分待っても `unconfirmed` にならない。`こんにちは` を送る → `event=UserPromptSubmit … hooks=confirmed phase=agent→idle` の行が出る。`[agent-hooks] 拒んだ要求` の行が出ない（出たら、その理由〈`host`・`content-type` など〉を記録する）
- [ ] **AGC-090** `claude` の画面で `/hooks` を開く → アプリが渡した `http` の hooks 8 つ（`UserPromptSubmit`・`PreToolUse`・`PostToolUse`・`PostToolUseFailure`・`SubagentStop`・`Stop`・`StopFailure`・`SessionEnd`）が出る（出方を記録する）
- [ ] **AGC-091** `a.txt の最後に agent という行を足して` を送る → 端末に `event=PreToolUse tool=Edit id=あり … phase=idle→agent`、`event=PostToolUse tool=Edit id=あり` の行が出て、その約 2 秒後に `event=猶予の終わり … phase=agent→idle` が出る（`Edit` 以外の名前なら記録する）。作業中に `claude` の画面に hook のエラーの表示（`hook error` など）が出ない（出たら記録する）
- [ ] **AGC-092** `sleep 20 を実行して` を送り、実行中に Esc で中断する → 端末に `event=PostToolUseFailure`・`event=Stop` の行は出ない（出たら記録する）。`phase` は `agent` のまま、次の指示（`こんにちは`）を送って作業が終わった後（次のターンの `Stop`）に `phase=agent→idle` になる
- [ ] **AGC-093** 許可を求めるツール（`rm a.txt を実行して` など）の確認で `No` を選ぶ → 端末に出る行（`event=PostToolUseFailure` の有無）を記録する。出なければ `phase` は次のターンの `Stop` まで `agent` のまま
- [ ] **AGC-094** `sleep 20 を実行して` を送り、実行中に `claude` の入力欄に `ls` と打って Enter を押す → `event=UserPromptSubmit` の行が出るか・出る時点（すぐか、`sleep` の後か）を記録する。段階は `agent` のまま（`UserPromptSubmit` では区間を閉じない）で、`sleep` が終わってから約 2 秒後に `idle` になる
- [ ] **AGC-095** `Task ツールでサブエージェントに b.txt を読ませて c.txt に 1 行足させて` を送る → `agent=あり` の `event=PreToolUse`・`event=PostToolUse` の行と `event=SubagentStop` の行が出る（出方を記録する）
- [ ] **AGC-096** `claude` の画面で `/clear` を実行する → `event=SessionEnd` の行が出る。続けて `こんにちは` を送ると `event=UserPromptSubmit … hooks=confirmed` のまま（`pending` に戻らない）
- [ ] **AGC-097** 利用者の設定（`~/.claude/settings.json`）に `"disableAllHooks": true` を書いてから `claude` を起動し、`a.txt を読んで要約して` を送る → 画面の活動が作業中になってから約 15 秒後に、端末に `event=確認の待ちの終わり … hooks=unconfirmed(hooks-not-confirmed)` の行と `[agent-hooks] hooks の知らせが届かないため、区別をやめます` が出る。画面（一覧・印）は変わらない。確かめたら設定を戻す
- [ ] **AGC-098** `export HTTPS_PROXY=http://127.0.0.1:9` を設定した端末から `npm run dev` で起動し、`claude` を起動して `こんにちは` を送る → `event=UserPromptSubmit` の行が出る（hook の要求がプロキシを通らない。`claude` の応答は API に届かず失敗してよい）。出なければ記録する。macOS で、アプリの起動・`claude` の起動のときにファイアウォールの確認のダイアログが出ないことも確かめる（出たら記録する）
- [ ] **AGC-099** `claude` のタブを閉じる → `ls "$TMPDIR"/prompt-ide-agent-hooks-*/` からそのセッションの `.json` が消え、端末に `event=終了` の行が出る
- [ ] **AGC-100** `claude` を動かしたままアプリを終了する（`Cmd+Q`）→ 端末に止める途中の `event=SessionEnd` の行が出てから終わる（出なければ記録する）。終了の後、`ls -d "$TMPDIR"/prompt-ide-agent-hooks-*` が何も出さない
- [ ] **AGC-101** このアプリで、エージェントの変更のセクションを使う（AGC-001・AGC-002 を行う）→ 一覧・行の印・確認の文言は、この機能の前と変わらない
```

- [ ] **Step 2: HTML を再生成し、仕様書の検査を通す**

Run: `node scripts/build-manual-test-spec.mjs`
Expected: `.superpowers/manual-test-spec.html (N 領域 / M 項目)` が出る（項目の数が 14 増えている）
Run: `npx vitest run scripts`
Expected: PASS（ID の一意性・接頭辞ごとの連番の昇順・書式）

Artifact（<manual-test-spec-artifact-url>）の再公開は、このタスクの実装者ではなく**コントローラーが** `.superpowers/manual-test-spec.html` を同じファイルパスで公開して行う（実装者は HTML の生成までで止め、報告に「再公開が必要」と書く）。

- [ ] **Step 3: ROADMAP を更新する（prettier にかけない）**

`ROADMAP.md`:
1. L256 の行の末尾の `` `claude` の起動の引数はセッションの指定だけ（起動のたびに `--session-id <UUID>`、再開は `--resume <UUID>`。それ以外の引数は付けない。hooks は使わない） `` を次に置き換える（過去の状態は過去形で書き、どの時点で変えたかを書く）:
```markdown
`claude` の起動の引数はセッションの指定だけだった（起動のたびに `--session-id <UUID>`、再開は `--resume <UUID>`。hooks は使わなかった）。2026-10-13 から（エージェントの変更の利用者の編集との区別〈段階 A〉）、`claude` の版が 2.1.101 以上と確かめられたときは `--settings <一時ディレクトリの設定のファイル>` も付けて、アプリの `http` の hooks（ツールの区間の追跡に使う）を渡し、環境変数の `NO_PROXY`・`no_proxy` に `127.0.0.1`・`localhost` を足す。活動の判定は今も画面の読み取りで、hooks の知らせは使わない。それ以外の引数は付けない
```
2. L451 の `- 実装済み（2026-10-13。設計書 `docs/superpowers/specs/2026-10-13-agent-changes-revert-undo-and-gc-protection-design.md`）: …` の行の後に、次の行を足す:
```markdown
      - 実装済み（2026-10-13。段階 A。設計書 `docs/superpowers/specs/2026-10-13-agent-changes-user-edit-distinction-design.md`）: hooks の受け取りとツールの区間の追跡（画面は変わらない。アプリが起動する `claude` に `--settings` で `http` の hooks を渡し、main の `127.0.0.1` の受け口で受け、ウィンドウごとにエージェントのファイルを書くツール・シェルが動いているかを追跡して開発版のログに出す。`claude` の版が 2.1.101 より古い・確かめられないときは hooks を渡さない）
```
3. L452 の `- 残り: `claude` の hooks で利用者の編集と区別する、Git 管理外のフォルダでの記録` を次に置き換える:
```markdown
      - 残り: `claude` の hooks で利用者の編集と区別する（段階 B: 写しによる判定・印・すべて戻すの対象から外す）、Git 管理外のフォルダでの記録
```
4. 項目の本体（L447 の `- [ ]`）は完了にしない（`[ ]` のまま）

- [ ] **Step 4: 前の設計書に注記する（過去形で、どの設計書で変えたかを書く）**

`docs/superpowers/specs/2026-10-04-agent-terminal-mvp-design.md` の末尾（「## その後の変更（2026-10-11、…）」の節の最後の行の後。空行を 1 つ挟む）に足す:
```markdown

## その後の変更（2026-10-13、エージェントの変更の利用者の編集との区別〈段階 A〉で変更）

本文は当時の決定の記録として残す。次の点が変わった。現行の挙動は `2026-10-13-agent-changes-user-edit-distinction-design.md` を参照。

- 「`claude` の引数は空で固定」（2026-10-11 の変更の後は「セッションの指定だけ」）: `claude` の版が 2.1.101 以上と確かめられたときは、`--settings <一時ディレクトリの設定のファイルの絶対パス>` も付けて、アプリの `http` の hooks を渡すようになった。それ以外の引数（`--dangerously-skip-permissions` など）は付けない方針は変わらない
- 環境変数: `NO_PROXY`・`no_proxy` に `127.0.0.1`・`localhost` を足すようになった（hooks の要求とトークンをプロキシへ送らないため）
```

- [ ] **Step 5: 全体の検証**

Run: `npx vitest run`
Expected: PASS（すべてのテスト）
Run: `npm run typecheck`
Expected: PASS
Run: `git diff --name-only -- '*.ts' '*.tsx' && git ls-files --others --exclude-standard -- '*.ts' '*.tsx'` で、このプランで変更・作成した TypeScript のファイルを列挙し、`npx eslint --max-warnings 0 <列挙したファイル>`
Expected: エラー・警告なし
Run: `ls src/main/__tests__/ | grep local`
Expected: 何も出ない（Task 1 の計測のファイルを消してある）
Run: `git status --short`
Expected: このプランで変えたファイルと、設計書・プランの未追跡のファイルだけが出る（`.superpowers/` は git 管理外）。コミットはしない
