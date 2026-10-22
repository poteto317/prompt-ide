# claude 以外のエージェント CLI への対応 段階 2a（copilot の画面の判定と中断）実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定で GitHub Copilot CLI（`copilot`）を選んだときも、`copilot` の画面から活動（作業中・入力待ち・許可待ち・確認待ち・判定できない）を判定し、それに基づく帯・タブ・ステータスバーの表示、完了・許可待ちの通知、帯の `中断`（Esc を約 100ms の間隔で 2 回。2 回目の前に画面を確かめ直す）、変更の一覧の自動の取り直しを使えるようにする。`claude` を選んでいる間の挙動は変えない。

**Architecture:** renderer の判定は CLI の種類ごとの関数の表（`lib/agentScreenClassifiers.ts` の `AGENT_SCREEN_CLASSIFIERS`）に分け、`claude` は今の判定を中身を変えずに移した `classifyClaudeScreen`（`lib/claudeScreenActivity.ts`）、`copilot` は新しい `classifyCopilotScreen`（`lib/copilotScreenActivity.ts`）を引く。判定を呼ぶ側（`useAgentActivity`・押した時点の読み直し・2 回目の前の確かめ）はタブの種類を渡して表から引く。中断は main の種類ごとの送り方の表（`src/main/agentCliInterruptSpecs.ts`）が 2 回目の有無・待つ時間・期限を決め、`AgentSession` が 1 回目の時刻を控えて 2 回目の依頼（新しい IPC `agentTerminal:interruptFollowUp`。引数は `sessionId` だけ）を期限の内だけ受け付ける。renderer は 1 回目の結果の案内の時間だけ待ち、送った先のタブの画面が作業中のときだけ 2 回目を頼む。通知の依頼にはタブの種類（`cliKind`）を足し、main が検証して固定の表から題を作る。

**Tech Stack:** Electron（main・preload）, React 19, TypeScript, node-pty 1.1.0（偽の実行ファイルの統合テスト）, `@xterm/headless` 6.0.0（段階 0 の記録）, Vitest（偽の pty・偽の時計・偽のタイマー）, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-21-agent-cli-copilot-screen-design.md`（承認済み。実装の前に必ず読む）。このプランは設計書の「実装の分割」の **タスク 1〜6 のすべて**（番号も同じ）。各タスクで読む節はタスクの冒頭に書いた。書き方の参考は `docs/superpowers/plans/2026-10-20-agent-cli-kind-foundation.md`。

**実装の前に読むもの:** `$DEV_FLOW_KIT/lessons/review-lessons.md` の「優先度 A のチェックリスト」（CLAUDE.md の「実装前の確認」）。今回の変更に関係する項目は本文も読む。

**反映する知見（dev-flow-kit の `lessons/review-lessons.md`）:** 依頼で指定された L-001・L-017・L-019・L-037・L-041・L-059・L-072・L-157・L-408 と、設計書が型と配線に使った L-044・L-052・L-055・L-060・L-061（各タスクの冒頭の「気をつける知見」に、そのタスクで効くものを書いた）

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
>
> - **台帳の期待のハッシュ（計画の時点で確かめた値）:** 計画の作成者が、このプランの Task 1 の変換のスクリプト（`to-fixture.js`）と置き換えのスクリプト（`sanitize-copilot.py`）を段階 0 の記録にかけ、48 画面がすべて設計書の期待どおりに判定されること（設計書の判定の規則を JavaScript に写したもので確かめた）と、次の値を確かめた。変換の後・置き換えの前の SHA-256 は `6a1673c5ba581c71a2f26fa79a1484f4574a3bff6fb4678df86493e1d0438e95`、置き換えた後（`copilotScreens.json`）は `8fe11e4ae5507f1859cbe61dc754062e904e15fd106adff978d1479a41154aaf`、変わった行は 41 行、ファイルの大きさは 105,722 バイトで同じ。実装で値が違えば、スクリプトの写し間違いを疑う（`diff` で確かめる）。手書きの画面のテスト（Task 2）の期待も同じ写しで確かめた。
> - **置き換えのスクリプト:** 設計書は「`claude` と同じスクリプトでかける」とした。`fixtures/README.md` の `sanitize.py` に規則 1' の 1 行を足したものを `sanitize-copilot.py` として、変換のスクリプトと同じフォルダ（git 管理外）に置く。
> - **台帳の行の形:** `claude` の台帳と同じく、範囲が無い行は `[文字列]`（dim だけなら `[文字列, dim]`）にし、空の行は省く。記録の `segs` には反転（`inv`）が 1 つも無い（`copilot` は自前のカーソルを描く）ため、反転の範囲はどの行も空。
> - **判定の補助の定数:** 設計書の定数の一覧に、問いの前に除く枠の縦線と空白 `FRAME_PREFIX = /^[│┃\s]+/` を足す（設計書の判定の表の順 1 の「行頭の `│`・`┃` と空白を除く」をそのまま書いたもの）。入力欄の特定の結果は `CopilotInputBox`（`top`・`bottom`・`band`・`bandHead`）にする。
> - **中断の文言の関数の置き場:** 設計書は `describeAgentInterruptBlockedByActivity(activity, kind)` を「押せるかの判定（`lib/agentInterrupt.ts`）」に置き、文言は種類ごとの表から作るとした。今の作り（`agentInterrupt.ts` の関数が `agentInterruptMessages.ts` の表を引く）に合わせ、`agentInterrupt.ts` の `describeAgentInterruptBlockedByActivity(activity, cliKind)` は `agentInterruptMessages.ts` の新しい関数 `agentInterruptBlockedByActivityReason(activity, kind)`（`permission`・`unknown` は種類の表から作り、`confirm`・`idle` は今の文言）を呼ぶだけにする。今の表 `AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY` と定数 `AGENT_INTERRUPT_NOT_RUNNING`・`AGENT_INTERRUPT_ERROR_NO_SESSION` は消す（設計書のとおり関数に置き換える）。
> - **能力が無い種類のテストの差し替え:** 設計書の「能力の表を差し替える `vi.mock`」を、3 つのテストのファイル（`useAgentActivity.test.ts`・`agentInterrupt.test.ts`・`agentCliMessages.test.ts`）で同じ形にするため、テストの補助 `src/renderer/src/__tests__/agentCliCapabilityOverrides.ts`（`overrideAgentCliCapabilities`）を作る。差し替えた種類は `screenActivity` と `interrupt` を両方偽にする（能力の表の不変条件「`interrupt` なら `screenActivity`」を保つ）。
> - **`useAgentActivity` の判定の関数の移り変わり:** Task 2 で `classifyAgentScreen` の名前を消すため、Task 2 の間は `useAgentActivity` の既定を `classifyClaudeScreen`（引数は行だけ）にし、Task 3 で引数を `(kind, lines)` に変えて既定を `classifyAgentScreenFor` にする。押した時点の読み直し（`checkAgentInterruptAtPress`）は Task 2 で `classifyAgentScreenFor(input.cliKind, …)` にする（Task 2 の時点では `copilot` は中断の能力が無く、その前で止まる）。
> - **Task 3 と Task 5 の間の一時の挙動:** Task 3 で `copilot` の `interrupt` を `true` にすると、Task 5 で 2 回目を足すまでの間、`copilot` の中断は 1 回目の Esc だけになる（同じ PR の中の途中の状態。実機では確かめない）。Task 3 で、能力に依っていた既存のテストの期待（`useAgentWorkspace.test.ts` の中断の理由など）を Task 3 の時点の値にし、Task 5 で最終の文言の関数に直す。
> - **共有の型の変更（Task 4）に追随する renderer のテストの値:** `AgentInterruptResult` の `sent` に `followUp` が必須になると、renderer のテストで `window.api.interruptAgentSession` の偽物が返す `{ kind: 'sent' }` が型エラーになるため、Task 4 で `{ kind: 'sent', followUp: null }` にする（renderer の `AgentInterruptOutcome` の形は Task 5 で変える）。
> - **2 回目の後の待ちの数え直し:** `useAgentInterruptCooldown` の `restartCooldown` はアンマウントの後は何もしない（タイマーを残さない。L-052）。`useAgentInterrupt` もアンマウントの後は呼ばない。
> - **ROADMAP の行番号:** 設計書の `:512`・`:515`・`:583`〜`:585` は計画の時点でも同じ行（`grep -n` で文を探してから直す）。

## Global Constraints

- コメント・文言・ログは日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`。`any` を使わない。テストの補助関数にも戻り値の型を書く（`@typescript-eslint/explicit-function-return-type`）
- **コミット・プッシュはしない**（CLAUDE.md。利用者の明示の指示があるまで行わない）。各タスクの最後の Step は「検証」。`git add`・`git mv` もしない（ファイルの移動は `mv`）
- **実物の `claude`・`copilot` はテストで起動しない。** 画面の判定は段階 0 で記録した画面の文字（台帳）と手書きの画面で、pty を通す確かめは一時ディレクトリに置いた小さな node のスクリプト（偽の実行ファイル）を実物の node-pty で起動して行う。テストは利用者の `~/.copilot`・`~/.claude` に書かない。実機（Electron）の確認は利用者がまとめて行う（Task 6 で実機テスト仕様書に追記する）。プランに実機の手順は書かない
- 各タスクの終わりで次が通る状態を保つ: `npx vitest run`（全テスト）・`npm run typecheck`・変更・作成した TypeScript のファイルへの `npx eslint --max-warnings 0 <ファイル>` と `npx prettier --check <ファイル>`。型を変えるタスクは、型に追随する呼び出し元・テストの補助・既存のテストを同じタスクで直す
- **`npx prettier --write` は、変更したファイルを明示して実行する**（引数が空だとリポジトリ全体を整形してしまう）。`ROADMAP.md`・`src/renderer/src/lib/__tests__/fixtures/agentScreens.json`・`src/renderer/src/lib/__tests__/fixtures/copilotScreens.json` は prettier にかけない
- **このマシンは負荷が高く、`npx vitest run` の全体でテストが時間切れ（`Test timed out`・`waitFor` の打ち切り）で落ちることがある。** 落ちたら、落ちたファイルを `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書いて先へ進む。単体でも落ちれば本当の失敗として直す
- **シェルで `path` を変数名に使わない**（zsh では `path` が `PATH` と結び付いた配列で、代入すると `PATH` が壊れる）。**シェルの変数は Bash の呼び出しをまたいで残らない。** コードブロックごとに先頭で設定し直し、`test -f`・`test -d` で存在を確かめる
- **日本語を含むファイルを Python で書き換えるときは、`# -*- coding: utf-8 -*-` 付きのスクリプトのファイルにして実行する**（`python3 -c` に日本語を書かない）。スクリプトのファイルはセッションの作業用の一時ディレクトリ（scratchpad）に置く。`perl -pi` の置き換えは ASCII のパターンだけで行う
- 「変異で確かめる」の Step は、書いた実装の一部を一時的に戻して該当のテストが落ちることを確かめ、必ず元に戻す（戻したことを `git diff` か `grep` で確かめる）。`act(...).then(...)` の形でテストを書かない。`console.*` の spy と `vi.spyOn(window.api, …)` は `afterEach`（か `finally`）で戻す。偽のタイマーを使うテストは `afterEach` で `vi.clearAllTimers()`・`vi.useRealTimers()` を呼ぶ
- 能力の参照は `if (agentCliCapabilities(kind).x)` の肯定の形で書き、`kind !== 'claude'` のような否定の名指しにしない。種類の引数は省略できない形にする（省略で `claude` に倒れない。L-060）

### 設計書の決めたこと（利用者の確認済み。一字一句）

- **今回の範囲**: `copilot` の画面の判定（作業中・入力待ち・許可待ち）と、それに基づく帯・タブ・ステータスバーの活動の表示、完了・許可待ちの通知（通知の依頼と OS の通知の題に CLI の種類を足し、`claude` と書いている文言を CLI ごとにする）、中断、変更の一覧の自動の取り直し。能力の表の `copilot` の `screenActivity` と `interrupt` を `true` にする（段階 1 の不変条件「`interrupt` なら `screenActivity`」を保つ）
- **範囲の外**: プロンプトの送信（実行・再実行・送信前の確認）は段階 2b。`copilot` の `promptSend` は `false` のまま。hooks による変更の区別・セッションの再開は段階 3
- **中断の条件**: `claude` と同じく「作業中のときだけ押せる」。許可待ち・入力待ち・確認待ち・判定できない画面では押せない
- **中断の送り方**: 押した時点で画面を確かめ直し、作業中なら Esc（`\x1b`）を約 100ms の間隔で 2 回送る（`copilot` は作業中の Esc 1 回では止まらず、500ms 以内の 2 回で中断する。段階 0 の記録）
- **中断の IPC**: renderer から任意の文字列が pty に届かないこと（L-019）を保つ。今の `agentTerminal:interrupt`（main が固定の `\x1b` を書く）を土台にし、CLI ごとの送り方（回数・間隔）は main の種類ごとの表（段階 1 の `agentCliLaunchSpecs` と同じ流儀）で決める。renderer から回数や文字列を渡さない

### 設計書の決めたこと（推奨案で決めた事項。一字一句）

- **判定の表の形**: renderer の `lib/agentScreenClassifiers.ts`（新規）に `AGENT_SCREEN_CLASSIFIERS: Record<AgentCliKind, AgentScreenClassifier>` を置き、`claude` は `classifyClaudeScreen`（今の `classifyAgentScreen` を中身を変えずに `lib/claudeScreenActivity.ts` へ移して改名）、`copilot` は `classifyCopilotScreen`（新規の `lib/copilotScreenActivity.ts`）を引く。`lib/agentActivity.ts` には CLI に依らない活動の型と「利用者の操作を待っている活動」の表だけを残す。判定を呼ぶ側（`useAgentActivity`・中断の押した時点の読み直し）は種類を渡して表から引く（`classifyAgentScreenFor(kind, lines)`）
- **copilot の判定の手がかり**: 段階 0 の記録で確からしさが高い文言だけを使う。作業中は「入力欄の下の罫線より下の行（帯）に `esc interrupt` か `esc again to interrupt`」、入力待ちは「入力欄があり、帯にそれが無い」、許可待ちは「入力欄が無く、選択の案内（`↑/↓ to navigate · enter to select · esc to cancel`）の上に `Do you want to ` で始まる問い」。タイトル（OSC 0）・進み具合（OSC 9;4）は使わない
- **分からない画面の扱い**: 誤って作業中・入力待ちとしない側に倒す（L-041）。作業中は入力欄の構造（上の罫線・記号の行・下の罫線）がそろい、帯に中断の案内があるときだけにする（会話の本文の同じ文字で作業中とせず、Esc を送らない）。入力待ちは、入力欄がそろい、帯があり、帯の先頭がスピナーの記号でなく、入力欄の外（上の罫線より上と帯）に選択の案内が無いときだけにする。入力欄の外に選択の案内があれば、入力欄の有無に関わらず作業中・入力待ちにしない（書きかけ〈入力欄の中〉の同じ文字は見ない。入力欄が無いときは `確認待ち`、問いが `Do you want to ` で始まれば `許可待ち`。入力欄があるときは問いがあっても `確認待ち`）。どれにも当たらなければ `unknown`（`実行中`）
- **中断の 2 回目の前の扱い**: main は 1 回目の Esc だけを書いて結果を返し、2 回目は renderer が画面を確かめ直してから頼むときだけ書く（明示の確かめ。opt-in）。main の表が 2 回目の有無・待つ時間（100ms）・受け付ける期限（1 回目から 400ms）を決め、renderer は「2 回目を頼むか・頼まないか」だけを選べる（回数を増やせない・文字列を渡せない）。2 回目の前に画面が作業中でなくなっていれば頼まない（入力待ちで Esc を 2 回送ると、書きかけの消去・巻き戻しの画面になるため）
- **中断の 2 回目の IPC**: 新しい IPC `agentTerminal:interruptFollowUp`（引数は `sessionId` だけ。main が固定の `\x1b` を書く）。`agentTerminal:interrupt` の結果の `sent` に、2 回目を頼む案内（`followUp: { afterMs } | null`）を足す。`claude` は `null`（今までどおり 1 回）
- **中断の待ち（クールダウン）**: 値は今の 1,000ms（タブごと）のまま。2 回目を頼む案内がある流れ（`copilot`）では、2 回目の流れが終わった時点（2 回目の結果が届いた・頼まなかった・読めなかった時点。`finish` の直前）で 1,000ms の待ちを数え直す。`claude` は今までどおり押した時点から数える。結果を待つ間（同期の再入の防止）は 2 回目が終わるまで続ける
- **中断の文言**: `claude` の文言は変えない。CLI で違う部分（押すキーの説明・許可待ちでの Esc の意味・判定できないときの案内・動いていない旨・終了した旨）を、renderer の `agentInterruptMessages.ts` の種類ごとの表（`Record<AgentCliKind, …>`）で引く
- **中断の後の画面の記録**: `claude` の台帳（`agentScreens.json`）は変えない。`copilot` は別の台帳 `copilotScreens.json`（新規）を作り、段階 0 の記録（中断の後の画面を含む）から写す。新しく記録はしない
- **通知の文言の変え方**: 通知の依頼（`agentNotification:show`）に `cliKind`（必須）を足し、main は検証した種類と番号から `formatAgentTabLabel(tabNumber, cliKind)` で題を作る（`copilot 1: 作業が終わりました`）。本文（`次の指示を待っています` など）は CLI に依らない文言のまま。読み上げ（renderer）も同じ関数で `copilot 1 の作業が終わりました`。種類はタブの名前と同じ値（`AgentSessionTabView.cliKind`）を使い、名前と題が食い違わない。renderer の値は固定の表の選択にしか使わない（L-019）
- **hooks への作業中の知らせ**: `useAgentHooksWorkingReport` は、`changeAttribution` が `true` の種類のタブだけを知らせる（`copilot` は区別をしないので送らない）。能力の表の `screenActivity` の説明から「hooks への作業中の知らせ」を外し、`changeAttribution` の説明に移す
- **段階 1 の「判定しない・押せない」の扱い**: 消さずに残す（能力が `false` なら購読しない・押せない）。テストは能力の表を差し替える `vi.mock` で「能力が無い種類」を作って確かめる（`copilot` を例にしていたテストを書き換える）
- **判定に使う種類**: `useAgentActivity` は、判定の時点のタブ（`tabsRef` の最新）の `cliKind` で判定の関数を引く。控えに種類は持たない

### copilot の判定の規則（一字一句。設計書「copilot の判定」）

定数（`lib/copilotScreenActivity.ts` に閉じる。`claude` の定数とは共有しない）:

```ts
const BORDER = /^─{20,}$/
const SYMBOL_LINE = /^(?:❯(?:[ \xa0]|$)|! |Start of Prompt Indicator)/
const CONTINUATION = /^ {2}|^\s*$/
const INTERRUPT_HINTS = ['esc interrupt', 'esc again to interrupt'] as const
const BAND_SPINNER = /^[○◎◉●] \S/
const SELECTION_HINT = /navigate\s*·\s*enter (?:to )?select/i
const PERMISSION_QUESTION = /^Do you want to /
const DIALOG_TOP = /^╭/
```

- 各行は `lineText(line).trimEnd()` にしてから規則をかける
- 入力欄の特定: 下から最初の `BORDER` が下の罫線（無ければ入力欄なし）→ その上で最初の `BORDER` が上の罫線（無い・間に行が無ければ入力欄なし）→ 間の 1 行目が `SYMBOL_LINE`、2 行目以降がすべて `CONTINUATION` なら入力欄あり → 帯は下の罫線より下の行の、前後の空白を除いた空でない行を空白 1 つでつないだ文字列（連続する空白は 1 つ）

| 順  | 条件                                                                                                                                                               | 活動         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 1   | 入力欄なし・`SELECTION_HINT` の行があり、その行から上へ `DIALOG_TOP` の行に当たるまでの間に、行頭の `│`・`┃` と空白を除くと `PERMISSION_QUESTION` で始まる行がある | `permission` |
| 2   | 入力欄なし・`SELECTION_HINT` の行がある                                                                                                                            | `confirm`    |
| 3   | 入力欄なし                                                                                                                                                         | `unknown`    |
| 4   | 入力欄あり・入力欄の中以外の行（上の罫線より上と帯）に `SELECTION_HINT` の行がある（問いがあっても `permission` にしない）                                         | `confirm`    |
| 5   | 入力欄あり・帯の文字列が `INTERRUPT_HINTS` のどれかを含む                                                                                                          | `working`    |
| 6   | 入力欄あり・帯が空                                                                                                                                                 | `unknown`    |
| 7   | 入力欄あり・帯の空でない最初の行（前後の空白を除く）が `BAND_SPINNER` に当たる                                                                                     | `unknown`    |
| 8   | 入力欄あり                                                                                                                                                         | `idle`       |

### 中断の送り方と結果の型（一字一句）

- main の表: `AGENT_CLI_INTERRUPT_SPECS = { claude: { followUp: null }, copilot: { followUp: { afterMs: 100, deadlineMs: 400 } } }`（`AgentCliInterruptSpec`・`AgentCliInterruptFollowUpSpec`）
- `AgentSession.interrupt()`: `{ kind: 'sent'; followUp: { afterMs: number } | null } | { kind: 'not-alive' } | { kind: 'write-failed' }`
- `AgentSession.interruptFollowUp()`: `'sent' | 'not-pending' | 'expired' | 'not-alive' | 'write-failed'`（控えは 1 回で使い切る。`afterMs` 未満は `not-pending`、`deadlineMs` を超えたら `expired`）
- shared: `AgentInterruptFollowUp = { afterMs: number }`・`AgentInterruptResult = { kind: 'sent'; followUp: AgentInterruptFollowUp | null } | { kind: 'no-session' } | { kind: 'write-failed' }`・`AgentInterruptFollowUpResult = { kind: 'sent' } | { kind: 'not-pending' } | { kind: 'expired' } | { kind: 'no-session' } | { kind: 'write-failed' }`
- renderer: `AgentInterruptOutcome` の `sent` は `{ kind: 'sent'; followUp: { afterMs: number; sessionId: string } | null }`、`AgentInterruptFollowUpOutcome = { kind: 'sent' } | { kind: 'stale' } | { kind: 'not-pending' } | { kind: 'expired' } | { kind: 'no-session' } | { kind: 'write-failed' } | { kind: 'error'; message: string }`

### 文言（一字一句。実機テスト仕様書もこの文字列で書く）

| 場所                                       | `claude`（今と同じ）                                                                                     | `copilot`                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `中断` の `aria-label`                     | `中断（作業中の claude に Esc を送る）`                                                                  | `中断（作業中の copilot に Esc を 2 回送る）`                                                                                       |
| 送れたときの読み上げ                       | `claude 1 に中断（Esc）を送りました`                                                                     | `copilot 1 に中断（Esc を 2 回）を送りました`（2 回目を送れたとき）                                                                 |
| 2 回目を頼まなかったときの読み上げ         | —                                                                                                        | `copilot 1 が作業中でなくなったため、2 回目の Esc は送りませんでした`（入力待ち・許可待ち・確認待ちのとき）                         |
| 2 回目の前に判定できなかったときの読み上げ | —                                                                                                        | `copilot 1 が作業中か判定できなかったため、2 回目の Esc は送りませんでした（まだ作業中なら、少し待ってからもう一度押してください）` |
| 許可待ちの理由                             | `許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）`                 | `許可待ちのため中断できません（Esc は操作の取り消しになります。ターミナルで答えてください）`                                        |
| 判定できないときの理由                     | `作業中か判定できないため押せません（ターミナルで Esc を押すと中断できます）`                            | `作業中か判定できないため押せません（ターミナルで Esc を続けて 2 回押すと中断できます）`                                            |
| 確認待ち・入力待ちの理由                   | `確認待ちのため中断できません（ターミナルで選んでください）`・`入力待ちのため、中断する作業がありません` | 同じ（CLI に依らない）                                                                                                              |
| 動いていない（帯には出さない）             | `claude が動いていないため中断できません`                                                                | `copilot が動いていないため中断できません`                                                                                          |
| 終了した（`no-session`）                   | `中断を送れませんでした: claude が終了したか、起動し直しました`                                          | `中断を送れませんでした: copilot が終了したか、起動し直しました`                                                                    |
| 2 回目の期限切れ（`expired`）              | —                                                                                                        | `中断を送れませんでした: 2 回目の Esc が間に合いませんでした（まだ作業中なら、もう一度押してください）`                             |
| 2 回目を受け付けていない（`not-pending`）  | —                                                                                                        | `中断を送れませんでした: 2 回目の Esc を送れる状態ではありませんでした（まだ作業中なら、もう一度押してください）`                   |

- 通知: 題 `copilot 1: 許可待ち`・`copilot 1: 確認待ち`・`copilot 1: 作業が終わりました`、読み上げ `copilot 1 が許可待ちになりました`・`copilot 1 が確認待ちになりました`・`copilot 1 の作業が終わりました`。本文は種類に依らない（`ツールの実行の許可を待っています`・`選択を待っています`・`次の指示を待っています`）
- 通知の依頼の検証の失敗: `cliKind は claude・copilot のどれかである必要があります`（`AGENT_CLI_KINDS` から作る）
- 設定の使えない機能の注記（`copilot`）: `copilot では次の機能を使えません（ターミナルで直接操作します）: プロンプトの送信（実行・再実行）、利用者の変更との区別、前回の続きから・このセッションで再開`。`エージェントの通知` の注記は `copilot` でも出ない（`null`）

### 型・関数の名前（後のタスクはこの名前と型で使う）

- テストの台帳（Task 1）: `copilotScreen(name: CopilotScreenName): { cols: number; rows: number; lines: ViewportLine[] }`・`CopilotScreenName`（`src/renderer/src/lib/__tests__/fixtures/copilotScreens.ts`）
- renderer の判定（Task 2）: `classifyClaudeScreen(lines: readonly ViewportLine[]): AgentActivity`（`lib/claudeScreenActivity.ts`）・`classifyCopilotScreen(lines: readonly ViewportLine[]): AgentActivity`（`lib/copilotScreenActivity.ts`）・`AgentScreenClassifier`・`AGENT_SCREEN_CLASSIFIERS`・`classifyAgentScreenFor(kind: AgentCliKind, lines: readonly ViewportLine[]): AgentActivity`（`lib/agentScreenClassifiers.ts`）。`classifyAgentScreen` は消す
- 能力・判定の hook・通知（Task 3）: `UseAgentActivityOptions.classify?: (kind: AgentCliKind, lines: readonly ViewportLine[]) => AgentActivity`・`AgentNotificationShowRequest.cliKind: AgentCliKind`・`agentNotificationText(kind, tabNumber, cliKind)`・`AgentNotificationTab.cliKind`・`AgentNotificationEvent.cliKind`・`AgentHooksWorkingReportTab.cliKind`、テストの補助 `overrideAgentCliCapabilities(actual, overrides)`・`AgentCliCapabilityOverrides = { unsupportedKinds: Set<AgentCliKind> }`（`src/renderer/src/__tests__/agentCliCapabilityOverrides.ts`）
- main の中断（Task 4）: `AgentCliInterruptFollowUpSpec`・`AgentCliInterruptSpec`・`AGENT_CLI_INTERRUPT_SPECS`（`src/main/agentCliInterruptSpecs.ts`）、`AgentSessionInterruptResult`・`AgentSessionInterruptFollowUpResult`・`AgentSessionParams.interrupt`・`AgentSessionParams.now`・`monotonicNow`・`StartAgentSessionParams.interrupt`・`StartAgentSessionParams.now`・`AgentSession.interruptFollowUp()`（`src/main/agentSession.ts`）、`AgentSessionRegistry.interruptFollowUp(ownerId: number, sessionId: string): AgentInterruptFollowUpResult`、IPC `'agentTerminal:interruptFollowUp'`、`AgentInterruptFollowUp`・`AgentInterruptFollowUpResult`（shared）、`interruptAgentSessionFollowUp(sessionId: string): Promise<AgentInterruptFollowUpResult>`（preload・`lib/agentTerminalApi.ts`）
- renderer の中断（Task 5）: `AGENT_INTERRUPT_KEY_TEXTS`・`agentInterruptAriaLabel(kind)`・`agentInterruptNotRunningReason(commandName)`・`agentInterruptBlockedByActivityReason(activity, kind)`・`agentInterruptSentNotice(label, kind)`・`agentInterruptFollowUpSkippedNotice(label, activity)`・`agentInterruptNoSessionError(commandName)`・`AGENT_INTERRUPT_ERROR_FOLLOW_UP_EXPIRED`・`AGENT_INTERRUPT_ERROR_FOLLOW_UP_NOT_PENDING`（`lib/agentInterruptMessages.ts`）、`describeAgentInterruptBlockedByActivity(activity, cliKind)`・`checkAgentInterruptFollowUp(cliKind, readScreen): AgentInterruptFollowUpCheck`（`lib/agentInterrupt.ts`）、`AgentInterruptFollowUpOutcome`・`AgentSessionsState.interruptFollowUp(slotId, sessionId)`（`hooks/useAgentSessions.ts`）、`UseAgentInterruptOptions.interruptFollowUp`、`AgentInterruptCooldown.restartCooldown(slotId)`

### ファイルの構成（作る・変えるもの）

| ファイル                                                                                                                                                                                                                        | 責務                                                       | タスク |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------ |
| `.superpowers/agent-cli-kind/copilot-screens-recorder/to-fixture.js`・`sanitize-copilot.py`（git 管理外）                                                                                                                       | 段階 0 の記録から台帳を作る・個人情報の置き換え            | 1      |
| `src/renderer/src/lib/__tests__/fixtures/copilotScreens.json`（新規）・`copilotScreens.ts`（新規）・`README.md`・`.prettierignore`                                                                                              | `copilot` の画面の台帳と読み出し                           | 1      |
| `src/renderer/src/lib/__tests__/copilotScreensFixture.test.ts`（新規）                                                                                                                                                          | 台帳の SHA-256・個人情報・読み出し                         | 1      |
| `src/renderer/src/lib/claudeScreenActivity.ts`（新規。移動）・`copilotScreenActivity.ts`（新規）・`agentScreenClassifiers.ts`（新規）・`agentActivity.ts`                                                                       | CLI ごとの判定と表、CLI に依らない活動の型                 | 2      |
| `src/renderer/src/lib/__tests__/claudeScreenActivity.test.ts`（`agentActivity.test.ts` から改名）・`copilotScreenActivity.test.ts`・`agentScreenClassifiers.test.ts`                                                            | 判定のテスト                                               | 2      |
| `src/shared/agentCliKinds.ts`                                                                                                                                                                                                   | `copilot` の `screenActivity`・`interrupt` と説明          | 3      |
| `src/renderer/src/hooks/useAgentActivity.ts`                                                                                                                                                                                    | 判定の時点のタブの種類で判定の関数を引く                   | 3      |
| `src/shared/types/agentNotification.ts`・`src/shared/agentNotificationText.ts`・`src/main/handlers/agentNotificationPayloadParser.ts`・`src/main/agentNotifications.ts`                                                         | 通知の依頼の `cliKind`・題                                 | 3      |
| `src/renderer/src/lib/agentNotificationEvents.ts`・`hooks/useAgentHooksWorkingReport.ts`                                                                                                                                        | 出来事の種類・hooks への知らせの絞り込み                   | 3      |
| `src/renderer/src/__tests__/agentCliCapabilityOverrides.ts`（新規）                                                                                                                                                             | 能力の表を差し替えるテストの補助                           | 3      |
| `src/main/agentCliInterruptSpecs.ts`（新規）・`agentSession.ts`・`agentSessionStarter.ts`・`agentSessionRegistry.ts`・`handlers/agentTerminalHandlers.ts`                                                                       | 中断の送り方・2 回目の受け付け・IPC                        | 4      |
| `src/shared/types/agentTerminal.ts`・`src/preload/api.ts`・`src/preload/index.d.ts`・`src/renderer/src/lib/agentTerminalApi.ts`・`src/renderer/src/__tests__/setup.ts`                                                          | 中断の結果の型・窓口                                       | 4      |
| `src/renderer/src/lib/agentInterruptMessages.ts`・`agentInterrupt.ts`                                                                                                                                                           | 種類ごとの文言・種類の規則での読み直し・2 回目の前の確かめ | 5      |
| `src/renderer/src/hooks/useAgentSessions.ts`・`useAgentInterrupt.ts`・`useAgentInterruptCooldown.ts`・`useAgentWorkspace.ts`・`components/agent/AgentTerminalPanel.tsx`・`src/renderer/src/__tests__/makeAgentSessionsState.ts` | 2 回目の流れ・待ちの数え直し・配線・ボタンの名前           | 5      |
| `ROADMAP.md`・`docs/manual-test-spec.md`・（食い違いがあれば）設計書                                                                                                                                                            | 段階 2a の記録・実機テスト仕様書                           | 6      |

---

### Task 1: copilot の画面の台帳

> **設計書の読む節:** 「copilot の画面（段階 0 の記録の要点）」、「実装の最初に確かめること（copilot の画面の台帳）」の 1〜4（場面と期待の表は Task 2 で使う）、「構成」の台帳の行。あわせて `src/renderer/src/lib/__tests__/fixtures/README.md`（`claude` の台帳の形式と個人情報の置き換えの手順）と `.superpowers/agent-cli-kind/copilot-screens-recorder/report.md`。
>
> **気をつける知見:** L-017（記録のユーザー名・一時ディレクトリ・UUID を同じ長さの中立な文字列に置き換え、個人情報のテストを通してから SHA-256 を固定する）・L-059（判定の規則を実物の `copilot` で記録した画面で固定する。新しく `copilot` を起動して記録はしない）

**Files:**

- Create（git 管理外）: `.superpowers/agent-cli-kind/copilot-screens-recorder/to-fixture.js`・`.superpowers/agent-cli-kind/copilot-screens-recorder/sanitize-copilot.py`・`.superpowers/agent-cli-kind/copilot-screens-recorder/copilotScreens.raw.json`（変換の後・置き換えの前）
- Create: `src/renderer/src/lib/__tests__/fixtures/copilotScreens.json`（スクリプトが書く。手で書かない・整形しない）・`src/renderer/src/lib/__tests__/fixtures/copilotScreens.ts`
- Modify: `src/renderer/src/lib/__tests__/fixtures/README.md`（`copilotScreens.json` の節を足す）・`.prettierignore`
- Test: `src/renderer/src/lib/__tests__/copilotScreensFixture.test.ts`（新規）

**Interfaces:**

- Consumes: `makeLine(text: string, dim?: number[][], inverse?: number[][]): ViewportLine`（`fixtures/agentScreens.ts`。既存）・`lineText(line: ViewportLine): string`（`lib/agentViewport.ts`。既存）
- Produces（Task 2・3・5 が使う）:

```ts
// src/renderer/src/lib/__tests__/fixtures/copilotScreens.ts
export type CopilotScreenName = keyof typeof data.screens
export function copilotScreen(name: CopilotScreenName): {
  cols: number
  rows: number
  lines: ViewportLine[]
}
```

台帳の画面の名前（48）: `trust`・`idle`・`idleDraft`・`working250`・`working3000`・`beforeFirstToken`・`reasoning`・`workingDraft`・`afterEscWorking`・`afterEscWorking1500`・`interrupted`・`interruptedDraft`・`done`・`reasoningDone`・`toolDone`・`permission`・`permissionDown`・`permission3`・`afterEscPermission`・`afterEscEscPermission`・`toolRunning`・`afterEscToolRunning`・`interruptedToolRunning`・`draftEsc`・`rewindHint`・`rewindPicker`・`help`・`ctrlcWorking`・`ctrlcDraft`・`exited`・`pending`・`ctrlqQueued`・`interruptedPendingSent`・`paste12`・`multiline`・`shellMode`・`slashList`・`idle80`・`working80`・`resized60`・`idle40`・`working40`・`srTrust`・`srIdleDraft`・`srWorking`・`srAfterEsc`・`srPermission`・`srPermissionDown`

- [ ] **Step 1: 失敗するテストを書く（台帳の SHA-256・個人情報・読み出し）**

`src/renderer/src/lib/__tests__/copilotScreensFixture.test.ts` を作る:

```ts
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { lineText } from '../agentViewport'
import { copilotScreen } from './fixtures/copilotScreens'
import data from './fixtures/copilotScreens.json'

// copilot の画面の台帳(fixtures/copilotScreens.json)の改変と、個人情報の混入を検知する。
// 台帳は段階 0 の記録から個人情報を同じ長さの中立な文字列へ置き換えたもの(手順は fixtures/README.md の copilotScreens.json の節)。
// copilot の版を上げて記録し直したら、README.md の手順で置き換えてから COPILOT_SCREENS_SHA256 を更新する
const COPILOT_SCREENS_SHA256 = '8fe11e4ae5507f1859cbe61dc754062e904e15fd106adff978d1479a41154aaf'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

const raw = readFileSync(resolve(__dirname, 'fixtures/copilotScreens.json'))
const text = raw.toString('utf-8')

describe('copilotScreens.json(copilot の画面の台帳)', () => {
  it('置き換えた後の内容から変わっていない(SHA-256)', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(COPILOT_SCREENS_SHA256)
  })

  it('段階 0 の記録から選んだ 48 の画面を持つ', () => {
    expect(Object.keys(data.screens)).toHaveLength(48)
  })

  it.each<[string, RegExp]>([
    ['ホームのパス', /\/Users\//],
    ['ホームのパスを符号化したもの', /-Users-/],
    ['/home/user/ 以外のホームのパス', /\/home\/(?!user\/)/],
    ['一時ディレクトリ', /claude-\d+/],
    ['/private/tmp', /\/private\/tmp/],
    ['メールアドレス', /[\w.+-]+@[\w-]+\.[\w.-]+/],
    ['API キー', /sk-[A-Za-z0-9]/],
    ['GitHub のトークン', /gh[pousr]_[A-Za-z0-9]/]
  ])('%s を含まない', (_label, pattern) => {
    expect(text).not.toMatch(pattern)
  })

  it('ゼロ以外の UUID を含まない(信頼の確認のパス・終了の画面の --resume の UUID も 0 にしてある)', () => {
    const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []
    expect(uuids.length).toBeGreaterThan(0)
    expect(uuids.filter((uuid) => uuid !== ZERO_UUID)).toEqual([])
    const tails = text.match(/[0-9a-f]*-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []
    expect(tails.filter((tail) => /[1-9a-f]/.test(tail))).toEqual([])
  })

  it('読み出しは行の数だけ行を返し、記録の無い行は空の行にする(入力待ちの入力欄の記号の行と帯)', () => {
    const screen = copilotScreen('idle')
    expect(screen).toMatchObject({ cols: 100, rows: 30 })
    expect(screen.lines).toHaveLength(30)
    expect(screen.lines[1]).toEqual([])
    expect(lineText(screen.lines[27])).toBe('❯')
    expect(lineText(screen.lines[29])).toMatch(/^ ← open sidebar · \/ commands/)
  })

  it('記録の label に大きさのある場面は、その大きさで読む(resized60 は 60 × 20)', () => {
    const screen = copilotScreen('resized60')
    expect(screen).toMatchObject({ cols: 60, rows: 20 })
    expect(screen.lines).toHaveLength(20)
  })
})
```

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/copilotScreensFixture.test.ts`
Expected: FAIL（`./fixtures/copilotScreens.json` が見つからない）

- [ ] **Step 3: 変換のスクリプトと置き換えのスクリプトを書く（git 管理外）**

```bash
R=<repo-root>/.superpowers/agent-cli-kind/copilot-screens-recorder
test -d "$R/out" && ls "$R/out/stream-100x30/snaps.json" || echo "missing $R/out"
```

Expected: `missing` が出ない（段階 0 の記録がある。無ければ止めて報告する。`copilot` を起動して記録し直さない）

`.superpowers/agent-cli-kind/copilot-screens-recorder/to-fixture.js` を作る:

```js
// copilot の画面の台帳(copilotScreens.json)の元を、段階 0 の記録(out/<フォルダ>/snaps.json)から作る。
// 使い方: node to-fixture.js <書き出し先の JSON>(個人情報の置き換えは sanitize-copilot.py で後からかける)
const fs = require('node:fs')
const { join } = require('node:path')

const OUT = join(__dirname, 'out')
// [台帳の名前, 記録のフォルダ, 記録の label](設計書「実装の最初に確かめること」4 の表の順)
const SCENES = [
  ['trust', 'stream-100x30', 'trust'],
  ['idle', 'stream-100x30', 'idle'],
  ['idleDraft', 'stream-100x30', 'idle-draft'],
  ['working250', 'stream-100x30', 'working+250'],
  ['working3000', 'stream-100x30', 'working+3000'],
  ['beforeFirstToken', 'thinking-100x30', 'before-first-token+300'],
  ['reasoning', 'thinking-100x30', 'reasoning+800'],
  ['workingDraft', 'queue-100x30', 'working-draft'],
  ['afterEscWorking', 'stream-100x30', 'after-esc-working+300'],
  ['afterEscWorking1500', 'stream-100x30', 'after-esc-working+1500'],
  ['interrupted', 'esc2-100x30-gap150', 'esc2-gap150+300'],
  ['interruptedDraft', 'interruptdraft-100x30', 'after-escesc-draft+400'],
  ['done', 'stream-100x30', 'done'],
  ['reasoningDone', 'thinking-100x30', 'reasoning-done'],
  ['toolDone', 'toolok-100x30', 'done'],
  ['permission', 'permission-100x30', 'permission ok=true'],
  ['permissionDown', 'permission-100x30', 'permission-down'],
  ['permission3', 'toolrun-100x30', 'permission ok=true'],
  ['afterEscPermission', 'permission-100x30', 'after-esc-permission+300'],
  ['afterEscEscPermission', 'escesc-100x30', 'after-escesc-permission+150'],
  ['toolRunning', 'toolrun-100x30', 'toolrun+1500'],
  ['afterEscToolRunning', 'toolrun-100x30', 'after-esc-toolrun+300'],
  ['interruptedToolRunning', 'escesc-100x30', 'after-escesc-toolrun+300'],
  ['draftEsc', 'input2-100x30', 'draft-esc+150'],
  ['rewindHint', 'input2-100x30', 'after-question-clear'],
  ['rewindPicker', 'idleesc-100x30', 'hist-escesc-empty'],
  ['help', 'input2-100x30', 'question-empty'],
  ['ctrlcWorking', 'ctrlc-100x30', 'after-ctrlc-working+300'],
  ['ctrlcDraft', 'ctrlc-100x30', 'after-ctrlc-draft+300'],
  ['exited', 'ctrlc-100x30', 'after-ctrlc-empty+300'],
  ['pending', 'queue-100x30', 'working-queued+400'],
  ['ctrlqQueued', 'queue2-100x30', 'ctrlq-queued'],
  ['interruptedPendingSent', 'queue2-100x30', 'after-escesc-queued+400'],
  ['paste12', 'input-100x30', 'paste-12lines'],
  ['multiline', 'input2-100x30', 'ctrl-j'],
  ['shellMode', 'input2-100x30', 'bang-empty'],
  ['slashList', 'input2-100x30', 'slash-empty'],
  ['idle80', 'widths-80x24', 'idle'],
  ['working80', 'widths-80x24', 'working+1000'],
  ['resized60', 'widths-80x24', 'working-resized-60x20'],
  ['idle40', 'widths-40x20', 'idle'],
  ['working40', 'widths-40x20', 'working+1000'],
  ['srTrust', 'stream-100x30-sr', 'trust'],
  ['srIdleDraft', 'stream-100x30-sr', 'idle-draft'],
  ['srWorking', 'stream-100x30-sr', 'working+800'],
  ['srAfterEsc', 'stream-100x30-sr', 'after-esc-working+300'],
  ['srPermission', 'permission-100x30-sr', 'permission ok=true'],
  ['srPermissionDown', 'permission-100x30-sr', 'permission-down']
]
// 全角(幅 2)になりうる文字。選んだ場面に無いことを確かめる(あればセルの位置がずれるので止める)
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

/** 場面の列・行の数。label に大きさ(60x20)があればそれ、無ければフォルダの名前の列の数と text の行の数 */
function sizeOf(folder, snap) {
  const fromLabel = /(\d+)x(\d+)/.exec(snap.label)
  if (fromLabel !== null) return { cols: Number(fromLabel[1]), rows: Number(fromLabel[2]) }
  const fromFolder = /-(\d+)x\d+/.exec(folder)
  if (fromFolder === null) throw new Error(`列の数が分かりません: ${folder}`)
  return { cols: Number(fromFolder[1]), rows: snap.text.split('\n').length }
}

/** segs のうち、flag の付いた区間を [開始, 終わり) のセルの位置にする */
function rangesOf(segs, flag) {
  return segs.filter((seg) => seg[flag] === true).map((seg) => [seg.x, seg.x + [...seg.s].length])
}

const screens = {}
for (const [name, folder, label] of SCENES) {
  const snaps = JSON.parse(fs.readFileSync(join(OUT, folder, 'snaps.json'), 'utf8'))
  const snap = snaps.find((s) => s.label === label)
  if (snap === undefined) throw new Error(`場面がありません: ${folder} の ${label}`)
  const { cols, rows } = sizeOf(folder, snap)
  if (snap.attrs.length !== rows) throw new Error(`行の数が合いません: ${name}`)
  const lines = {}
  for (const attr of snap.attrs) {
    const text = attr.text.trimEnd()
    if (WIDE.test(text)) throw new Error(`全角の文字があります: ${name} の ${attr.y} 行目`)
    if ([...text].length > cols) throw new Error(`列の数を超えています: ${name} の ${attr.y} 行目`)
    const dim = rangesOf(attr.segs, 'd')
    const inverse = rangesOf(attr.segs, 'inv')
    if (text === '' && dim.length === 0 && inverse.length === 0) continue
    // claude の台帳と同じく、範囲が無ければ省く([文字列]・[文字列, dim]・[文字列, dim, 反転])
    const raw = [text]
    if (dim.length > 0 || inverse.length > 0) raw.push(dim)
    if (inverse.length > 0) raw.push(inverse)
    lines[String(attr.y)] = raw
  }
  screens[name] = { cols, rows, lines }
}

const data = {
  _note:
    'copilot の画面(@xterm/headless の表示中のバッファ)。GitHub Copilot CLI 1.0.87・node-pty 1.1.0・@xterm/headless 6.0.0 で記録した。lines は 行番号 -> [文字列, dim の範囲, 反転の範囲](範囲は [開始, 終わり) のセルの位置)。文字列は記録の文字列の末尾の空白を除いたもの。空の行は省く。記録の手順は .superpowers/agent-cli-kind/copilot-screens-recorder/report.md',
  screens
}
fs.writeFileSync(process.argv[2], JSON.stringify(data, null, 1) + '\n')
console.log(`${Object.keys(screens).length} 画面を書き出しました: ${process.argv[2]}`)
```

`.superpowers/agent-cli-kind/copilot-screens-recorder/sanitize-copilot.py` を作る（`fixtures/README.md` の `sanitize.py` に規則 1' の 2 行を足したもの）:

```python
# -*- coding: utf-8 -*-
# copilot の画面の台帳の個人情報を、同じ長さの中立な文字列へ置き換える(fixtures/README.md の sanitize.py に規則 1' を足したもの)。
# 使い方: python3 sanitize-copilot.py <to-fixture.js が書いた JSON> <写し先の copilotScreens.json>
import re
import sys

src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding='utf-8').read()
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
NEUTRAL_PREFIX = '/home/user/project/'


def zero_hex(s):
    return re.sub(r'[0-9a-f]', '0', s)


def neutral_path(m):
    n = len(m.group(0))
    assert n >= len(NEUTRAL_PREFIX)
    return NEUTRAL_PREFIX + 'x' * (n - len(NEUTRAL_PREFIX))


# 1. 記録時の一時ディレクトリ
text = re.sub(r'/private/tmp/claude-\d+/-Users-[^/"]+', neutral_path, text)
# 1'. `.../` で省略された一時ディレクトリのパス(-Users- を含まない)
text = re.sub(r'/private/tmp/claude-\d+/[^\s")]*', neutral_path, text)
# 2. UUID
text = UUID.sub(lambda m: zero_hex(m.group(0)), text)


# 3. 折り返された UUID。JSON では画面の行ごとに別の配列なので、間の `"` `],` `"<行番号>": [` `"` と字下げを挟んでつなげて判定する
def wrapped(m):
    head, gap, tail = m.group(1), m.group(2), m.group(3)
    if UUID.fullmatch(head + tail) is None:
        return m.group(0)
    return zero_hex(head) + gap + zero_hex(tail)


text = re.sub(r'([0-9a-f-]+)("\n\s*\],\n\s*"\d+": \[\n\s*" *)([0-9a-f-]+)', wrapped, text)

open(dst, 'w', encoding='utf-8', newline='').write(text)
```

- [ ] **Step 4: 台帳を作り、ハッシュと変わった行を確かめる**

```bash
R=<repo-root>/.superpowers/agent-cli-kind/copilot-screens-recorder
F=<repo-root>/src/renderer/src/lib/__tests__/fixtures
test -f "$R/to-fixture.js" && test -f "$R/sanitize-copilot.py" && test -d "$F" || echo "missing"
node "$R/to-fixture.js" "$R/copilotScreens.raw.json"
python3 "$R/sanitize-copilot.py" "$R/copilotScreens.raw.json" "$F/copilotScreens.json"
shasum -a 256 "$R/copilotScreens.raw.json" "$F/copilotScreens.json"
wc -c "$R/copilotScreens.raw.json" "$F/copilotScreens.json"
diff "$R/copilotScreens.raw.json" "$F/copilotScreens.json" | grep -c '^<'
grep -cE '/Users/|-Users-|claude-[0-9]|/private/tmp' "$F/copilotScreens.json"
```

Expected:

- `missing` が出ず、`48 画面を書き出しました: …` が出る（全角の文字・列の超過・行の数の食い違いがあれば例外で止まる。止まったら報告する）
- SHA-256 が変換の後 `6a1673c5ba581c71a2f26fa79a1484f4574a3bff6fb4678df86493e1d0438e95`、置き換えた後 `8fe11e4ae5507f1859cbe61dc754062e904e15fd106adff978d1479a41154aaf`（計画の時点で確かめた値。違えばスクリプトの写し間違いを疑い、上のコードと `diff` で比べる）
- 2 つのファイルの大きさが同じ（105722 バイト）
- 変わった行が `41`（作業ディレクトリ 34 行・`.../` で省略された作業ディレクトリ 3 行・信頼の確認のパス 2 行・`permission3` の選択肢のパス 1 行・`exited` の `--resume` の UUID 1 行）
- 最後の `grep -c` が `0`

- [ ] **Step 5: 台帳の読み出し・`.prettierignore`・README を書く**

`src/renderer/src/lib/__tests__/fixtures/copilotScreens.ts` を作る:

```ts
import type { ViewportLine } from '../../agentViewport'
import { makeLine } from './agentScreens'
import data from './copilotScreens.json'

// copilot の画面の記録(copilotScreens.json。GitHub Copilot CLI 1.0.87 で記録した 48 画面)を、行の配列にする。形式は
// agentScreens.ts と同じ(lines は 行番号 → [文字列, dim の範囲, 反転の範囲]。範囲は [開始, 終わり) のセルの位置)。
// 記録の手順・個人情報の置き換え・copilot の版を上げたときの記録し直しは、同じディレクトリの README.md

type RawLine = [string, number[][]?, number[][]?]
interface RawScreen {
  cols: number
  rows: number
  lines: Record<string, RawLine>
}

export type CopilotScreenName = keyof typeof data.screens

export function copilotScreen(name: CopilotScreenName): {
  cols: number
  rows: number
  lines: ViewportLine[]
} {
  const screen = data.screens[name] as unknown as RawScreen
  const lines: ViewportLine[] = []
  for (let y = 0; y < screen.rows; y++) {
    const raw = screen.lines[String(y)]
    lines.push(raw === undefined ? [] : makeLine(raw[0], raw[1], raw[2]))
  }
  return { cols: screen.cols, rows: screen.rows, lines }
}
```

`.prettierignore` の最後の行（`src/renderer/src/lib/__tests__/fixtures/agentScreens.json`）の次に、次の 1 行を足す:

```text
src/renderer/src/lib/__tests__/fixtures/copilotScreens.json
```

`src/renderer/src/lib/__tests__/fixtures/README.md` の末尾（`規則とテストの両方に足す。` の行の後）に、空行を 1 つ置いて次をそのまま足す:

````markdown
# `copilotScreens.json`（`copilot` の画面の台帳）

`copilotScreenActivity.test.ts` が `copilot` の活動の判定（`classifyCopilotScreen`）を、`agentScreenClassifiers.test.ts`・`agentInterrupt.test.ts`・`useAgentActivity.test.ts`・`useAgentInterrupt.test.ts`・`useAgentWorkspace.test.ts` が種類ごとの判定の配線を、実物の画面で固定するための台帳。
GitHub Copilot CLI 1.0.87・node-pty 1.1.0・`@xterm/headless` 6.0.0 で記録した 48 の画面（フォルダの信頼の確認・入力待ち・書きかけ・作業中〈最初の応答の前・推論中・ツールの実行中・キュー〉・Esc 1 回の直後・中断の後・許可の確認・巻き戻しの画面・ヘルプ・`/` の一覧・シェルのモード・終了の後・80 列・60 列・40 列・`--screen-reader`）を、
段階 0 の記録（`.superpowers/agent-cli-kind/copilot-screens-recorder/out/*/snaps.json`。リポジトリの外）から写した（新しく記録はしていない。場面と期待は設計書 `docs/superpowers/specs/2026-10-21-agent-cli-copilot-screen-design.md` の「実装の最初に確かめること」）。

形式は `agentScreens.json` と同じ（`screens.<名前>.lines` は 行番号 → `[文字列, dim の範囲, 反転の範囲]`）。文字列は記録の文字列の末尾の空白を除いたもの。空の行は省く。選んだ場面に全角の文字は無い（列の位置がそのままセルの位置）。
列・行の数は、場面の `label` に大きさがあればそれ（`resized60` は 60 × 20）、無ければフォルダの名前の列の数と記録の行の数。記録に反転の属性は無い（`copilot` は自前のカーソルを描く）。**prettier やエディタで整形しない**（`.prettierignore` で外している）。

## `copilot` の版を上げたら記録し直す

判定の規則（帯の中断の案内 `esc interrupt`・`esc again to interrupt`、帯の先頭のスピナー `○◎◉●`、入力欄の罫線と記号、選択の案内、許可の問い `Do you want to `）は `copilot` の版で変わりうる。版に依存する規則は `copilotScreenActivity.ts` の定数に閉じている。
版を上げたら、段階 0 の記録用のスクリプト（`.superpowers/agent-cli-kind/copilot-screens-recorder/rec.js`。偽のローカルの提供元と一時の `HOME`・`COPILOT_HOME` で、GitHub のサービスに接続せずに記録する）で記録し直し、同じフォルダの `to-fixture.js`（変換）と `sanitize-copilot.py`（下の置き換え）をかけてから写し、`copilotScreensFixture.test.ts` の `COPILOT_SCREENS_SHA256` を更新してテストを流す。
画面を足し・消したら `copilotScreenActivity.test.ts` の期待の表（`EXPECTED`）も直す（全画面がどれかの期待に入っていないと落ちる）。

## 個人情報の置き換え（`copilotScreens.json` の作り方）

記録した画面には、記録した端末のユーザー名・UID（記録時の一時ディレクトリ）と UUID が出ていた（入力欄の上の作業ディレクトリの行、フォルダの信頼の確認の枠の中のパス、許可の確認の選択肢のパス、終了の画面の `copilot --resume=<UUID>`）。`agentScreens.json` と同じく、同じ長さの ASCII の中立な文字列に置き換えたものを置く。

- 変換の後・置き換えの前（`to-fixture.js` の出力。リポジトリの外）: SHA-256 `6a1673c5ba581c71a2f26fa79a1484f4574a3bff6fb4678df86493e1d0438e95`
- 置き換えた後（このディレクトリの `copilotScreens.json`）: SHA-256 `8fe11e4ae5507f1859cbe61dc754062e904e15fd106adff978d1479a41154aaf`（`copilotScreensFixture.test.ts` で固定）
- 変わった行: 41 行（入力欄の上の作業ディレクトリ 34 行・`.../` で省略された作業ディレクトリ 3 行〈`resized60`・`idle40`・`working40`〉・信頼の確認の枠の中のパス 2 行〈`trust`・`srTrust`〉・`permission3` の選択肢のパス 1 行・`exited` の `--resume` の UUID 1 行）。ファイルの大きさは同じ

置換の規則: 上の `agentScreens.json` の節の規則 1・2・3 に、規則 1 の後に次の規則 1' を足して、この順にかける。

1'. `/private/tmp/claude-<UID>/` で始まり `-Users-` を含まない（`.../` で省略された）パス（正規表現 `/private/tmp/claude-\d+/[^\s")]*`）も、規則 1 と同じく `/home/user/project/` の後ろを `x` で埋めた同じ長さの文字列にする

置換のスクリプト（`python3 sanitize-copilot.py <to-fixture.js の出力> <写し先の copilotScreens.json>`）は、上の `sanitize.py` の `# 1. 記録時の一時ディレクトリ` の置き換えの行の後ろに次の 2 行を足したもの:

```python
# 1'. `.../` で省略された一時ディレクトリのパス(-Users- を含まない)
text = re.sub(r'/private/tmp/claude-\d+/[^\s")]*', neutral_path, text)
```

個人情報（`/Users/`・`-Users-`・`/home/user/` 以外のホーム・`claude-<UID>`・`/private/tmp`・ゼロ以外の UUID・メールアドレス・`sk-`・`ghp_` など）が含まれないことは `copilotScreensFixture.test.ts` で固定している。
````

- [ ] **Step 6: テストが通ることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/copilotScreensFixture.test.ts src/renderer/src/lib/__tests__/agentScreensFixture.test.ts`
Expected: PASS

- [ ] **Step 7: 変異で確かめる**

1. `.superpowers/agent-cli-kind/copilot-screens-recorder/sanitize-copilot.py` の規則 1' の 2 行を一時的にコメントにして、台帳を別の場所（`$R/copilotScreens.check.json`）へ書き出し、`grep -c '/private/tmp' "$R/copilotScreens.check.json"` が `4` になる（規則 1' が要ることの確かめ。台帳そのものは上書きしない）。コメントを戻し、`rm "$R/copilotScreens.check.json"` で消す（`R` は Step 4 と同じく設定し直す）
2. `shasum -a 256 src/renderer/src/lib/__tests__/fixtures/copilotScreens.json` が Step 4 と同じ値のままであることを確かめる

- [ ] **Step 8: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/lib/__tests__/fixtures/copilotScreens.ts src/renderer/src/lib/__tests__/copilotScreensFixture.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check src/renderer/src/lib/__tests__/fixtures/copilotScreens.ts src/renderer/src/lib/__tests__/copilotScreensFixture.test.ts src/renderer/src/lib/__tests__/fixtures/README.md`
Expected: すべて整形済み（`.prettierignore` は prettier の対象の形式でないのでかけない。README が外れたら `npx prettier --write src/renderer/src/lib/__tests__/fixtures/README.md` で直す。`copilotScreens.json` は整形しない）
Run: `git status --short`
Expected: `.prettierignore`・`README.md` の変更と、`copilotScreens.json`・`copilotScreens.ts`・`copilotScreensFixture.test.ts` の未追跡と、作業の前からある設計書・プランの未追跡のファイル（`docs/superpowers/specs/2026-10-21-agent-cli-copilot-screen-design.md`・`docs/superpowers/plans/2026-10-21-agent-cli-copilot-screen.md`）だけ（`.superpowers/` は出ない）

---

### Task 2: 判定の表と copilot の判定

> **設計書の読む節:** 「画面の判定の規則」（判定の表・copilot の判定・分からない画面の扱い）、「実装の最初に確かめること」の 4（場面と期待の表）、「テスト方針」の renderer の判定、「構成」の判定の行。
>
> **気をつける知見:** L-041（分からない画面・会話の本文の同じ文字で作業中・入力待ちとしない。中断の案内は帯だけで見る・入力欄の構造を求める・入力欄の外の選択の案内は確認待ち・帯の先頭のスピナーで入力待ちにしない。`claude` の規則で `copilot` の画面を読まない）・L-059（記録の 48 画面を全部期待の表に入れ、入っていない画面があれば落ちるテストを置く）

**Files:**

- Create: `src/renderer/src/lib/claudeScreenActivity.ts`（`agentActivity.ts` から移す）・`src/renderer/src/lib/copilotScreenActivity.ts`・`src/renderer/src/lib/agentScreenClassifiers.ts`
- Modify: `src/renderer/src/lib/agentActivity.ts`（判定を外す）・`src/renderer/src/hooks/useAgentActivity.ts`（既定の判定の import だけ）・`src/renderer/src/lib/agentInterrupt.ts`（押した時点の読み直しを種類の規則に）・`src/renderer/src/lib/__tests__/fixtures/README.md`（`agentActivity` への言及）
- Test: `src/renderer/src/lib/__tests__/claudeScreenActivity.test.ts`（`agentActivity.test.ts` を改名）・`src/renderer/src/lib/__tests__/copilotScreenActivity.test.ts`（新規）・`src/renderer/src/lib/__tests__/agentScreenClassifiers.test.ts`（新規）

**Interfaces:**

- Consumes: `copilotScreen(name: CopilotScreenName)`・`CopilotScreenName`（Task 1）、`agentScreen(name: AgentScreenName)`・`makeLine`（既存）、`AgentCliKind`・`AGENT_CLI_KINDS`（`@shared/agentCliKinds`）
- Produces（Task 3・5 が使う）:

```ts
// src/renderer/src/lib/claudeScreenActivity.ts
export function classifyClaudeScreen(lines: readonly ViewportLine[]): AgentActivity
// src/renderer/src/lib/copilotScreenActivity.ts
export function classifyCopilotScreen(lines: readonly ViewportLine[]): AgentActivity
// src/renderer/src/lib/agentScreenClassifiers.ts
export type AgentScreenClassifier = (lines: readonly ViewportLine[]) => AgentActivity
export const AGENT_SCREEN_CLASSIFIERS: Record<AgentCliKind, AgentScreenClassifier>
export function classifyAgentScreenFor(kind: AgentCliKind, lines: readonly ViewportLine[]): AgentActivity
// src/renderer/src/lib/agentActivity.ts(残すもの。名前と型は今のまま)
export type AgentActivity = 'working' | 'idle' | 'permission' | 'confirm' | 'unknown'
export type AgentActivityWaitingForUser
export function isAgentActivityWaitingForUser(activity: AgentActivity): activity is AgentActivityWaitingForUser
```

`classifyAgentScreen` の名前は残さない（`claude` の判定をそのまま `copilot` のタブに使う取り違えを型の上で起こさない）。

- [ ] **Step 1: 失敗するテストを書く（copilot の判定）**

`src/renderer/src/lib/__tests__/copilotScreenActivity.test.ts` を作る（手書きの画面の期待は、計画の作成者が設計書の規則を JavaScript に写したもので確かめた）:

```ts
import { describe, it, expect } from 'vitest'
import { classifyCopilotScreen } from '../copilotScreenActivity'
import type { AgentActivity } from '../agentActivity'
import { lineText } from '../agentViewport'
import type { ViewportLine } from '../agentViewport'
import { makeLine } from './fixtures/agentScreens'
import { copilotScreen } from './fixtures/copilotScreens'
import type { CopilotScreenName } from './fixtures/copilotScreens'
import data from './fixtures/copilotScreens.json'

// 記録済みの画面(GitHub Copilot CLI 1.0.87。設計書 2026-10-21「実装の最初に確かめること」4)ごとの期待。台帳に画面が増えたら、
// ここに足さないと最後のテストが落ちる
const EXPECTED: Record<AgentActivity, readonly CopilotScreenName[]> = {
  working: [
    'working250',
    'working3000',
    'beforeFirstToken',
    'reasoning',
    'workingDraft',
    'afterEscWorking',
    'afterEscWorking1500',
    'toolRunning',
    'afterEscToolRunning',
    // キューの指示がある作業中と、中断の後にキューの指示が送られて作業中に戻った画面(既知の制約)
    'pending',
    'ctrlqQueued',
    'interruptedPendingSent',
    'working80',
    'resized60',
    'working40',
    'srWorking',
    'srAfterEsc'
  ],
  idle: [
    'idle',
    'idleDraft',
    'interrupted',
    'interruptedDraft',
    'done',
    'reasoningDone',
    'toolDone',
    'afterEscPermission',
    'afterEscEscPermission',
    'interruptedToolRunning',
    'draftEsc',
    'rewindHint',
    'help',
    'ctrlcWorking',
    'ctrlcDraft',
    'paste12',
    'multiline',
    'shellMode',
    'slashList',
    'idle80',
    'idle40',
    'srIdleDraft'
  ],
  permission: ['permission', 'permissionDown', 'permission3', 'srPermission', 'srPermissionDown'],
  confirm: ['trust', 'rewindPicker', 'srTrust'],
  unknown: ['exited']
}

const RULE = '─'.repeat(100)
const HINT = '↑/↓ to navigate · enter to select · esc to cancel'
const IDLE_BAND =
  ' ← open sidebar · / commands · ? help · tab next tab                                gpt-4o · Medium'
const WORKING_BAND = ' ◎ Working · 18 B esc interrupt'
const FRAME_TOP = `╭${'─'.repeat(98)}╮`
const FRAME_BOTTOM = `╰${'─'.repeat(98)}╯`

/** 会話(above)・入力欄の中(input)・帯(band)から、入力欄のある手書きの画面を作る */
const boxScreen = (
  above: readonly string[],
  input: readonly string[],
  band: readonly string[]
): ViewportLine[] => [...above, RULE, ...input, RULE, ...band].map((text) => makeLine(text))

/** 入力欄の無い手書きの画面 */
const plainScreen = (texts: readonly string[]): ViewportLine[] =>
  texts.map((text) => makeLine(text))

/** 台帳の画面の各行を列の数まで空白で埋める(アプリの画面の lineText と同じ形) */
const padded = (name: CopilotScreenName): ViewportLine[] => {
  const { cols, lines } = copilotScreen(name)
  return lines.map((line) => makeLine(lineText(line).padEnd(cols, ' ')))
}

describe('classifyCopilotScreen(記録した画面)', () => {
  for (const [activity, names] of Object.entries(EXPECTED) as [
    AgentActivity,
    readonly CopilotScreenName[]
  ][]) {
    it.each(names)(`${activity}: %s`, (name) => {
      expect(classifyCopilotScreen(copilotScreen(name).lines)).toBe(activity)
    })
  }

  it('台帳のすべての画面が、どれかの期待に入っている', () => {
    const listed = Object.values(EXPECTED).flat()
    expect([...listed].sort()).toEqual(Object.keys(data.screens).sort())
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('各行を列の数まで空白で埋めても判定が変わらない(作業中・入力待ち)', () => {
    expect(classifyCopilotScreen(padded('working3000'))).toBe('working')
    expect(classifyCopilotScreen(padded('idle'))).toBe('idle')
  })

  it('空の画面・すべて空白の画面は unknown(例外を投げない)', () => {
    expect(classifyCopilotScreen([])).toBe('unknown')
    expect(
      classifyCopilotScreen(plainScreen(Array.from({ length: 5 }, () => ' '.repeat(40))))
    ).toBe('unknown')
  })
})

describe('classifyCopilotScreen(手書きの画面。分からない画面の扱い)', () => {
  it('帯の中断の案内が 2 行に折り返されても(◎ Working · 18 B esc / interrupt)、つないで working', () => {
    expect(
      classifyCopilotScreen(
        boxScreen([' ● word0'], ['❯'], [' ◎ Working · 18 B esc', ' interrupt', ' gpt-4o · Medium'])
      )
    ).toBe('working')
  })

  it('帯がスピナーで始まり中断の案内が無ければ unknown(入力待ちにしない)', () => {
    expect(
      classifyCopilotScreen(boxScreen([' ● word0'], ['❯'], [' ◎ Thinking · 18 B         gpt-4o']))
    ).toBe('unknown')
  })

  it('--screen-reader の形(スピナーが空白)で中断の案内が無ければ idle(既知の制約の固定)', () => {
    expect(
      classifyCopilotScreen(
        boxScreen(['  word0'], ['Start of Prompt Indicator'], ['  Thinking · 18 B         gpt-4o'])
      )
    ).toBe('idle')
  })

  it.each([
    ' ● The band shows esc interrupt while working',
    ' ● Then esc again to interrupt appears'
  ])('入力欄の上の会話に中断の案内と同じ文字(%s)があっても、帯が入力待ちなら idle', (line) => {
    expect(classifyCopilotScreen(boxScreen([line], ['❯'], [IDLE_BAND]))).toBe('idle')
  })

  it('入力欄が無く、会話に全幅の罫線と esc interrupt があっても working にしない(unknown)', () => {
    expect(
      classifyCopilotScreen(plainScreen([' ● output', RULE, ' ● esc interrupt', ' ● more']))
    ).toBe('unknown')
  })

  it('シェル以外の許可の見込みの画面(枠の中の Do you want to edit this file? と選択の案内)は permission', () => {
    expect(
      classifyCopilotScreen(
        plainScreen([
          FRAME_TOP,
          '│ Edit file',
          '│ Do you want to edit this file?',
          '│ ❯ 1. Yes',
          '│   2. No',
          `│ ${HINT}`,
          FRAME_BOTTOM
        ])
      )
    ).toBe('permission')
  })

  it('問いの無い選択の画面は confirm', () => {
    expect(
      classifyCopilotScreen(
        plainScreen([FRAME_TOP, '│ Pick one', '│ ❯ 1. A', `│ ${HINT}`, FRAME_BOTTOM])
      )
    ).toBe('confirm')
  })

  it('選択の案内の上に Do you want to があっても、間に行頭の ╭ の行があれば(別の枠・会話の中の問い)confirm', () => {
    expect(
      classifyCopilotScreen(
        plainScreen([
          '│ Do you want to edit this file?',
          FRAME_BOTTOM,
          FRAME_TOP,
          '│ Pick one',
          '│ ❯ 1. A',
          `│ ${HINT}`,
          FRAME_BOTTOM
        ])
      )
    ).toBe('confirm')
  })

  it('入力欄があり、その上に選択の案内がある画面は confirm', () => {
    expect(
      classifyCopilotScreen(boxScreen(['│ Pick one', '│ ❯ 1. A', `│ ${HINT}`], ['❯'], [IDLE_BAND]))
    ).toBe('confirm')
  })

  it('選択の案内が下の罫線より下(帯の領域)にある画面は confirm', () => {
    expect(
      classifyCopilotScreen(boxScreen([' ● word0'], ['❯'], [' Pick one: ❯ 1. A', ` ${HINT}`]))
    ).toBe('confirm')
  })

  it('入力欄があり、その上に Do you want to …? の問いと選択の案内があっても permission にしない(confirm)', () => {
    expect(
      classifyCopilotScreen(
        boxScreen(
          ['│ Do you want to edit this file?', '│ ❯ 1. Yes', `│ ${HINT}`],
          ['❯'],
          [IDLE_BAND]
        )
      )
    ).toBe('confirm')
  })

  it('帯が空の画面(描き直しの途中)は unknown', () => {
    expect(classifyCopilotScreen(boxScreen([' ● word0'], ['❯'], []))).toBe('unknown')
  })

  it('上の罫線が見えない画面(入力欄が画面の高さを超えた書きかけ)は unknown', () => {
    expect(
      classifyCopilotScreen(plainScreen(['  more draft', '  more draft', RULE, IDLE_BAND]))
    ).toBe('unknown')
  })

  it('入力欄の上の会話に選択の案内の文字があれば、帯に esc interrupt があっても confirm(既知の制約の固定)', () => {
    expect(
      classifyCopilotScreen(boxScreen([` ● The dialog says ${HINT}`], ['❯'], [WORKING_BAND]))
    ).toBe('confirm')
  })

  it('書きかけ(入力欄の中)の選択の案内の文字は見ない: 帯が入力待ちなら idle、帯に esc interrupt があれば working', () => {
    const draft = [`❯ copy this: ${HINT}`, `  ${HINT}`]
    expect(classifyCopilotScreen(boxScreen([' ● word0'], draft, [' @ files · # issues']))).toBe(
      'idle'
    )
    expect(
      classifyCopilotScreen(
        boxScreen([' ● word0'], draft, [' ◎ Working · 18 B esc interrupt · ctrl+q enqueue'])
      )
    ).toBe('working')
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（判定の表）**

`src/renderer/src/lib/__tests__/agentScreenClassifiers.test.ts` を作る:

```ts
import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import { AGENT_SCREEN_CLASSIFIERS, classifyAgentScreenFor } from '../agentScreenClassifiers'
import { classifyClaudeScreen } from '../claudeScreenActivity'
import { classifyCopilotScreen } from '../copilotScreenActivity'
import { agentScreen } from './fixtures/agentScreens'
import { copilotScreen } from './fixtures/copilotScreens'

describe('AGENT_SCREEN_CLASSIFIERS', () => {
  it('種類の一覧のすべてに判定がある', () => {
    expect(Object.keys(AGENT_SCREEN_CLASSIFIERS).sort()).toEqual([...AGENT_CLI_KINDS].sort())
  })

  it('claude は classifyClaudeScreen、copilot は classifyCopilotScreen を引く(CLI どうしの規則を混ぜない)', () => {
    expect(AGENT_SCREEN_CLASSIFIERS.claude).toBe(classifyClaudeScreen)
    expect(AGENT_SCREEN_CLASSIFIERS.copilot).toBe(classifyCopilotScreen)
  })
})

describe('classifyAgentScreenFor', () => {
  it('copilot の作業中の台帳の画面は、copilot の規則で working、claude の規則では working 以外', () => {
    const { lines } = copilotScreen('working3000')
    expect(classifyAgentScreenFor('copilot', lines)).toBe('working')
    expect(classifyAgentScreenFor('claude', lines)).not.toBe('working')
  })

  it('claude の作業中の台帳の画面は、claude の規則で working、copilot の規則では working 以外', () => {
    const { lines } = agentScreen('working')
    expect(classifyAgentScreenFor('claude', lines)).toBe('working')
    expect(classifyAgentScreenFor('copilot', lines)).not.toBe('working')
  })
})
```

- [ ] **Step 3: claude の判定のテストを改名する**

```bash
cd <repo-root>
T=src/renderer/src/lib/__tests__
test -f "$T/agentActivity.test.ts" || echo "missing $T/agentActivity.test.ts"
mv "$T/agentActivity.test.ts" "$T/claudeScreenActivity.test.ts"
perl -0pi -e "s/import \{ classifyAgentScreen, isAgentActivityWaitingForUser \} from '..\/agentActivity'\n/import { isAgentActivityWaitingForUser } from '..\/agentActivity'\nimport { classifyClaudeScreen } from '..\/claudeScreenActivity'\n/; s/classifyAgentScreen/classifyClaudeScreen/g" "$T/claudeScreenActivity.test.ts"
grep -n "classifyAgentScreen\|claudeScreenActivity'" "$T/claudeScreenActivity.test.ts"
```

Expected: `missing` が出ない。最後の `grep` は import の 1 行（`import { classifyClaudeScreen } from '../claudeScreenActivity'`）だけを出す（`classifyAgentScreen` が残っていない）

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/copilotScreenActivity.test.ts src/renderer/src/lib/__tests__/agentScreenClassifiers.test.ts src/renderer/src/lib/__tests__/claudeScreenActivity.test.ts`
Expected: FAIL（`../copilotScreenActivity`・`../agentScreenClassifiers`・`../claudeScreenActivity` が見つからない）

- [ ] **Step 5: claude の判定を移して改名する**

次のスクリプトを作業用の一時ディレクトリ（scratchpad）に `move-claude-classifier.py` として保存し、リポジトリの直下で `python3 <保存したパス>` を実行する（`agentActivity.ts` の `const PERMISSION_QUESTION` から末尾までを中身を変えずに移し、関数の名前だけを変える）:

```python
# -*- coding: utf-8 -*-
# agentActivity.ts の claude の判定(PERMISSION_QUESTION から末尾まで)を claudeScreenActivity.ts へ中身を変えずに移し、
# classifyAgentScreen を classifyClaudeScreen に改名する。agentActivity.ts は次の Step で書き直す
import pathlib

lib = pathlib.Path('src/renderer/src/lib')
source = (lib / 'agentActivity.ts').read_text(encoding='utf-8')
marker = '\nconst PERMISSION_QUESTION = '
head, sep, body = source.partition(marker)
assert sep, 'PERMISSION_QUESTION が見つかりません'
assert body.count('export function classifyAgentScreen(') == 1
body = body.replace('export function classifyAgentScreen(', 'export function classifyClaudeScreen(')
header = """import type { AgentActivity } from './agentActivity'
import type { ViewportLine } from './agentViewport'
import { lineText } from './agentViewport'
import { locateInputBox } from './agentInputBox'

// 画面の末尾から、claude の活動の状態を判定する純粋関数(設計書「状態」)。claude 2.1.288 の画面で記録した
// (agentScreens.json)。判定は上から順に、最初に当てはまったもの。例外は投げない。CLI の種類ごとの判定の表は
// agentScreenClassifiers.ts(2026-10-21 に agentActivity.ts の classifyAgentScreen を中身を変えずに移して改名した。
// 規則の定数は copilot の判定〈copilotScreenActivity.ts〉と共有しない)
"""
(lib / 'claudeScreenActivity.ts').write_text(header + marker + body, encoding='utf-8')
print('claudeScreenActivity.ts を書きました')
```

Expected: `claudeScreenActivity.ts を書きました` が出る

`src/renderer/src/lib/agentActivity.ts` を次の内容に書き直す（型と表は今のまま。判定とその定数・import を外す）:

```ts
// エージェント CLI の活動の型と、利用者の操作を待っている活動の表(CLI に依らない)。画面からの判定は CLI ごとの関数
// (claudeScreenActivity.ts・copilotScreenActivity.ts)で、種類ごとの表は agentScreenClassifiers.ts(設計書 2026-10-21「判定の表」)

export type AgentActivity = 'working' | 'idle' | 'permission' | 'confirm' | 'unknown'

/**
 * 利用者の操作を待っている活動か。ステータスバーの強調(agentActivitySummary)・通知の出来事とバッジの数
 * (agentNotificationEvents)が同じ集まりを使う(片方だけ足すと、強調されるのに通知されない食い違いが出る)。
 * 活動を増やしたときに決め忘れを型エラーにするため Record で持つ
 */
const WAITING_FOR_USER = {
  working: false,
  idle: false,
  permission: true,
  confirm: true,
  unknown: false
} as const satisfies Record<AgentActivity, boolean>

/** 利用者の操作を待っている活動(通知の出来事の種類にもなる) */
export type AgentActivityWaitingForUser = {
  [K in AgentActivity]: (typeof WAITING_FOR_USER)[K] extends true ? K : never
}[AgentActivity]

export function isAgentActivityWaitingForUser(
  activity: AgentActivity
): activity is AgentActivityWaitingForUser {
  return WAITING_FOR_USER[activity]
}
```

Run: `git diff --stat src/renderer/src/lib/agentActivity.ts && grep -c "" src/renderer/src/lib/claudeScreenActivity.ts`
Expected: `agentActivity.ts` は削除が大半の差分。`claudeScreenActivity.ts` は 150 行前後（移した判定）

- [ ] **Step 6: copilot の判定と判定の表を書く**

`src/renderer/src/lib/copilotScreenActivity.ts` を作る:

```ts
import type { AgentActivity } from './agentActivity'
import type { ViewportLine } from './agentViewport'
import { lineText } from './agentViewport'

// 画面の末尾から、copilot の活動の状態を判定する純粋関数(設計書 2026-10-21「copilot の判定」)。GitHub Copilot CLI 1.0.87 の
// 画面で記録した(copilotScreens.json)。規則の定数(文言)はこのファイルに閉じ、claude の規則(claudeScreenActivity.ts の
// `esc to interrupt`・スピナーの記号・`Enter to confirm` など)とは共有しない。分からない画面は、作業中でないのに working・
// 利用者の操作を待っているのに idle にならない側(unknown・confirm)に倒す(L-041)。判定は上から順に、最初に当てはまったもの。
// dim・反転の属性は使わない(--screen-reader でも同じ文言が出るため)。例外は投げない

/** 全幅の罫線の行(行全体が ─ で 20 文字以上)。枠の中の `│ ─── │` は行頭が │ なので当たらない */
const BORDER = /^─{20,}$/
/** 入力欄の記号の行(`❯ `・`! `・--screen-reader の `Start of Prompt Indicator`)。末尾の空白を除くと、空の入力欄は `❯` だけになる */
const SYMBOL_LINE = /^(?:❯(?:[ \xa0]|$)|! |Start of Prompt Indicator)/
/** 入力欄の 2 行目以降(2 桁の字下げ)か空行 */
const CONTINUATION = /^ {2}|^\s*$/
/** 作業中の案内(帯だけで見る) */
const INTERRUPT_HINTS = ['esc interrupt', 'esc again to interrupt'] as const
/** 帯の先頭のスピナー(作業中の補助の手がかり。案内が見えなくても入力待ちとしない) */
const BAND_SPINNER = /^[○◎◉●] \S/
/** 選択の画面の案内(`↑/↓ to navigate · enter to select · esc to cancel`・`↑↓ Navigate · Enter Select · Esc Cancel`) */
const SELECTION_HINT = /navigate\s*·\s*enter (?:to )?select/i
/** 許可の問い(枠の │・┃ と空白を除いた行頭) */
const PERMISSION_QUESTION = /^Do you want to /
/** 問いの前に除く、枠の縦線と空白 */
const FRAME_PREFIX = /^[│┃\s]+/
/** 選択の画面の外枠の上端(行頭の ╭)。問いを探すのはこの行より下だけ */
const DIALOG_TOP = /^╭/

/** 入力欄の位置と帯(段階 2b で送信に使うときに copilotInputBox.ts へ切り出す) */
interface CopilotInputBox {
  /** 上の罫線の行 */
  top: number
  /** 下の罫線の行 */
  bottom: number
  /** 帯(下の罫線より下の行)の、前後の空白を除いた空でない行を空白 1 つでつないだ文字列(連続する空白は 1 つ)。40 列などで
   *  折り返した案内(`esc` / `interrupt`)も 1 つの文字列で見る */
  band: string
  /** 帯の空でない最初の行(前後の空白を除く)。帯が空なら null */
  bandHead: string | null
}

/** from から上へ、最初の全幅の罫線の行。無ければ null */
function findBorderAbove(texts: readonly string[], from: number): number | null {
  for (let y = from; y >= 0; y--) {
    if (BORDER.test(texts[y])) return y
  }
  return null
}

/**
 * 画面の下から入力欄(上の罫線・記号の行・続きの行・下の罫線)を探す。上の罫線が見えない(入力欄が画面の高さを超えた)・
 * 罫線の間に行が無い・記号の行や続きの行の形が違う画面は、入力欄なし(null)
 */
function locateCopilotInputBox(texts: readonly string[]): CopilotInputBox | null {
  const bottom = findBorderAbove(texts, texts.length - 1)
  if (bottom === null) return null
  const top = findBorderAbove(texts, bottom - 1)
  if (top === null || bottom - top < 2) return null
  if (!SYMBOL_LINE.test(texts[top + 1])) return null
  for (let y = top + 2; y < bottom; y++) {
    if (!CONTINUATION.test(texts[y])) return null
  }
  const bandLines = texts
    .slice(bottom + 1)
    .map((text) => text.trim())
    .filter((text) => text !== '')
  return {
    top,
    bottom,
    band: bandLines.join(' ').replace(/\s+/g, ' '),
    bandHead: bandLines[0] ?? null
  }
}

/** 選択の案内の行から上へ、外枠の上端(行頭の ╭)に当たるまでの間に、枠の縦線と空白を除くと許可の問いで始まる行があるか */
function hasPermissionQuestion(texts: readonly string[]): boolean {
  return texts.some((text, y) => {
    if (!SELECTION_HINT.test(text)) return false
    for (let above = y - 1; above >= 0; above--) {
      if (DIALOG_TOP.test(texts[above])) return false
      if (PERMISSION_QUESTION.test(texts[above].replace(FRAME_PREFIX, ''))) return true
    }
    return false
  })
}

export function classifyCopilotScreen(lines: readonly ViewportLine[]): AgentActivity {
  // アプリの画面の行は列の数まで空白で埋まり、台帳の行は右の空白を除いてある。どちらでも同じ判定にするため末尾の空白を除く
  // (BORDER などの `$` は末尾の空白があると当たらない)
  const texts = lines.map((line) => lineText(line).trimEnd())
  const box = locateCopilotInputBox(texts)
  if (box === null) {
    // シェルのコマンドの許可の確認(記録済み)。シェル以外のツールの確認も同じ部品の画面だと見込んで同じ規則で拾う
    if (hasPermissionQuestion(texts)) return 'permission'
    // フォルダの信頼の確認・巻き戻しの画面(記録済み)と、問いの分からない選択の画面
    if (texts.some((text) => SELECTION_HINT.test(text))) return 'confirm'
    // 描き直しの途中・終了の後の通常画面・未知の画面・入力欄が画面の高さを超えた書きかけ
    return 'unknown'
  }
  // 入力欄の外(上の罫線より上と帯)の選択の案内は、問いがあっても確認待ち(ask_user などの未知の選択の画面を作業中・入力待ちと
  // しない)。書きかけ(入力欄の中)の同じ文字は見ない
  const outside = [...texts.slice(0, box.top), ...texts.slice(box.bottom + 1)]
  if (outside.some((text) => SELECTION_HINT.test(text))) return 'confirm'
  // 中断の案内は帯だけで見る(会話の本文・`❯ …` の履歴・上の罫線の上の行の同じ文字で作業中とせず、Esc を送る側に倒さない)
  if (INTERRUPT_HINTS.some((hint) => box.band.includes(hint))) return 'working'
  // 帯が空(描き直しの途中)
  if (box.bandHead === null) return 'unknown'
  // 作業中の帯はスピナーで始まる。案内の語が変わった・折り返しで案内が切れた作業中の画面を入力待ちとしない
  if (BAND_SPINNER.test(box.bandHead)) return 'unknown'
  // 入力待ちの帯(空・書きかけ・シェルのモード・Esc や Ctrl+C の直後・`?`・`/`)はどれもスピナーで始まらず、中断の案内を含まない
  return 'idle'
}
```

`src/renderer/src/lib/agentScreenClassifiers.ts` を作る:

```ts
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentActivity } from './agentActivity'
import type { ViewportLine } from './agentViewport'
import { classifyClaudeScreen } from './claudeScreenActivity'
import { classifyCopilotScreen } from './copilotScreenActivity'

// CLI の種類ごとの画面の判定の表(設計書 2026-10-21「判定の表」)。判定を呼ぶ側(useAgentActivity・中断の押した時点の読み直し・
// 2 回目の前の確かめ)はタブの種類を渡して表から引く。claude の規則で copilot の画面を読まない(L-041)

/** 画面の末尾の行から活動を判定する純粋関数。行は読むだけで、例外は投げない */
export type AgentScreenClassifier = (lines: readonly ViewportLine[]) => AgentActivity

/** CLI の種類ごとの判定。種類を足したときの決め忘れを型エラーにする。CLI どうしの規則を混ぜない */
export const AGENT_SCREEN_CLASSIFIERS: Record<AgentCliKind, AgentScreenClassifier> = {
  claude: classifyClaudeScreen,
  copilot: classifyCopilotScreen
}

export function classifyAgentScreenFor(
  kind: AgentCliKind,
  lines: readonly ViewportLine[]
): AgentActivity {
  return AGENT_SCREEN_CLASSIFIERS[kind](lines)
}
```

- [ ] **Step 7: 判定を呼んでいた箇所を直す**

`src/renderer/src/hooks/useAgentActivity.ts`（引数の形の変更は Task 3。ここでは名前だけ）:

- `import { classifyAgentScreen } from '../lib/agentActivity'` を `import { classifyClaudeScreen } from '../lib/claudeScreenActivity'` にする
- `UseAgentActivityOptions.classify` のコメントの `(既定は classifyAgentScreen)` を `(既定は classifyClaudeScreen。Task 3 で種類の表に替える)` にする
- 引数の既定の `classify = classifyAgentScreen` を `classify = classifyClaudeScreen` にする

`src/renderer/src/lib/agentInterrupt.ts`:

- `import { classifyAgentScreen } from './agentActivity'` を `import { classifyAgentScreenFor } from './agentScreenClassifiers'` にする
- `checkAgentInterruptAtPress` の `screenActivity = classifyAgentScreen(readScreen())` を `screenActivity = classifyAgentScreenFor(input.cliKind, readScreen())` にし、その上に次のコメントを足す:

```ts
// タブの種類の規則で読む(copilot の画面を claude の規則で読んで作業中と取り違えない)
```

`src/renderer/src/lib/__tests__/fixtures/README.md` の `agentActivity` への言及を直す:

```bash
cd <repo-root>
F=src/renderer/src/lib/__tests__/fixtures/README.md
test -f "$F" || echo "missing $F"
perl -pi -e 's/agentActivity\.test\.ts/claudeScreenActivity.test.ts/g; s/classifyAgentScreen/classifyClaudeScreen/g; s/`agentActivity\.ts`/`claudeScreenActivity.ts`/g' "$F"
perl -pi -e 's/classify を省くと classifyAgentScreen で判定する/classify を省くと classifyClaudeScreen で判定する/' src/renderer/src/hooks/__tests__/useAgentActivity.test.ts
grep -n "agentActivity" "$F" || echo "none"
grep -rn "classifyAgentScreen\b" src || echo "none"
```

Expected: どちらの `grep` も `none`（`useAgentActivity.test.ts` のテストの題の `classifyAgentScreen` も、上の perl で `classifyClaudeScreen` にする。Task 3 で `classifyAgentScreenFor` に変える）

- [ ] **Step 8: テストが通ることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/copilotScreenActivity.test.ts src/renderer/src/lib/__tests__/agentScreenClassifiers.test.ts src/renderer/src/lib/__tests__/claudeScreenActivity.test.ts src/renderer/src/lib/__tests__/agentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentActivity.test.ts`
Expected: PASS（`copilotScreenActivity.test.ts` の記録の画面が期待と違えば、規則を直す〈記録が正〉。直しても記録と矛盾する場合は止めて報告する。設計書の「既知の制約」に書く判断はコントローラーが行う）

- [ ] **Step 9: 変異で確かめる**

1. `copilotScreenActivity.ts` の `const outside = [...texts.slice(0, box.top), ...texts.slice(box.bottom + 1)]` を `const outside = texts` にする → `書きかけ(入力欄の中)の選択の案内の文字は見ない…` が落ちる。戻す
2. 同じファイルの `if (BAND_SPINNER.test(box.bandHead)) return 'unknown'` の行を消す → `帯がスピナーで始まり中断の案内が無ければ unknown…` が落ちる。戻す
3. 同じファイルの `if (DIALOG_TOP.test(texts[above])) return false` の行を消す → `…間に行頭の ╭ の行があれば…confirm` が落ちる。戻す
4. `INTERRUPT_HINTS.some((hint) => box.band.includes(hint))` を `INTERRUPT_HINTS.some((hint) => texts.some((text) => text.includes(hint)))` にする → `入力欄の上の会話に中断の案内と同じ文字…` が落ちる。戻す
5. `agentScreenClassifiers.ts` の `copilot: classifyCopilotScreen` を `copilot: classifyClaudeScreen` にする → `agentScreenClassifiers.test.ts` の 2 つが落ちる。戻す
6. `git diff src/renderer/src/lib/agentScreenClassifiers.ts src/renderer/src/lib/copilotScreenActivity.ts` が空（新規のファイルは `git diff` に出ないので、`grep -n "const outside = \[\.\.\.texts.slice(0, box.top)" src/renderer/src/lib/copilotScreenActivity.ts`・`grep -n "copilot: classifyCopilotScreen" src/renderer/src/lib/agentScreenClassifiers.ts` がそれぞれ 1 行出ることで確かめる）

- [ ] **Step 10: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/lib/agentActivity.ts src/renderer/src/lib/claudeScreenActivity.ts src/renderer/src/lib/copilotScreenActivity.ts src/renderer/src/lib/agentScreenClassifiers.ts src/renderer/src/hooks/useAgentActivity.ts src/renderer/src/lib/agentInterrupt.ts src/renderer/src/lib/__tests__/claudeScreenActivity.test.ts src/renderer/src/lib/__tests__/copilotScreenActivity.test.ts src/renderer/src/lib/__tests__/agentScreenClassifiers.test.ts src/renderer/src/hooks/__tests__/useAgentActivity.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check src/renderer/src/lib/agentActivity.ts src/renderer/src/lib/claudeScreenActivity.ts src/renderer/src/lib/copilotScreenActivity.ts src/renderer/src/lib/agentScreenClassifiers.ts src/renderer/src/hooks/useAgentActivity.ts src/renderer/src/lib/agentInterrupt.ts src/renderer/src/lib/__tests__/claudeScreenActivity.test.ts src/renderer/src/lib/__tests__/copilotScreenActivity.test.ts src/renderer/src/lib/__tests__/agentScreenClassifiers.test.ts src/renderer/src/hooks/__tests__/useAgentActivity.test.ts src/renderer/src/lib/__tests__/fixtures/README.md`
Expected: すべて整形済み（外れたら同じファイルを明示して `npx prettier --write` で直し、もう一度 `--check`）

---

### Task 3: 能力の表と判定の hook・通知

> **設計書の読む節:** 「決めたこと（推奨案）」の通知の文言の変え方・hooks への作業中の知らせ・段階 1 の「判定しない・押せない」の扱い・判定に使う種類、「通知・表示・自動の取り直し」のすべて（帯・タブ・ステータスバーの表示・完了と許可待ちの通知・変更の一覧の自動の取り直し・hooks への作業中の知らせ・能力の表）、「エラー処理」の通知の依頼の `cliKind` が不正、「テスト方針」の shared・main の通知・renderer の判定の hook・通知。
>
> **気をつける知見:** L-019（通知の `cliKind` は main が検証して固定の表の名前を選ぶだけ。押したときに届く先〈`slotId`〉を変えない）・L-044（知らない `cliKind` は `claude` に倒さず拒否する）・L-060（`agentNotificationText` の種類・通知の依頼の `cliKind` を必須にする）・L-041（能力が無い種類は購読しない作りを残し、`vi.mock` で確かめる）

**Files:**

- Modify: `src/shared/agentCliKinds.ts`・`src/shared/types/agentNotification.ts`・`src/shared/agentNotificationText.ts`・`src/main/handlers/agentNotificationPayloadParser.ts`・`src/main/agentNotifications.ts`・`src/renderer/src/hooks/useAgentActivity.ts`・`src/renderer/src/lib/agentNotificationEvents.ts`・`src/renderer/src/hooks/useAgentHooksWorkingReport.ts`
- Create: `src/renderer/src/__tests__/agentCliCapabilityOverrides.ts`（テストの補助）
- Test（新しい期待）: `src/shared/__tests__/agentCliKinds.test.ts`・`src/shared/__tests__/agentNotificationText.test.ts`・`src/main/__tests__/handlers/agentNotificationPayloadParser.test.ts`・`src/main/__tests__/agentNotifications.test.ts`・`src/renderer/src/hooks/__tests__/useAgentActivity.test.ts`・`src/renderer/src/lib/__tests__/agentNotificationEvents.test.ts`・`src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts`・`src/renderer/src/hooks/__tests__/useAgentChangesAutoRefresh.test.ts`・`src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx`・`src/renderer/src/lib/__tests__/agentCliMessages.test.ts`
- Test（能力の変化への追随）: `src/renderer/src/lib/__tests__/agentInterrupt.test.ts`・`src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`・`src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx`・`src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts`・`src/renderer/src/lib/__tests__/agentNotificationApi.test.ts`・`src/preload/__tests__/api.test.ts`・`src/main/__tests__/handlers/agentNotificationHandlers.test.ts`

**Interfaces:**

- Consumes: `classifyAgentScreenFor(kind, lines)`（Task 2）、`copilotScreen(name)`（Task 1）、`formatAgentTabLabel(number, kind)`・`AGENT_CLI_KINDS`・`isAgentCliKind`・`agentCliCapabilities`（既存）
- Produces（Task 5 が使う）:

```ts
// src/renderer/src/hooks/useAgentActivity.ts
export interface UseAgentActivityOptions {
  tabs: readonly AgentActivityTab[]
  classify?: (kind: AgentCliKind, lines: readonly ViewportLine[]) => AgentActivity // 既定は classifyAgentScreenFor
}
// src/shared/types/agentNotification.ts
export interface AgentNotificationShowRequest {
  slotId: string
  tabNumber: number
  kind: AgentNotificationKind
  cliKind: AgentCliKind
}
// src/shared/agentNotificationText.ts
export function agentNotificationText(
  kind: AgentNotificationKind,
  tabNumber: number,
  cliKind: AgentCliKind
): AgentNotificationText
// src/renderer/src/lib/agentNotificationEvents.ts
export interface AgentNotificationTab {
  slotId: string
  number: number
  status: AgentSessionStatus
  isClosing: boolean
  cliKind: AgentCliKind
}
export interface AgentNotificationEvent {
  slotId: string
  tabNumber: number
  kind: AgentNotificationKind
  cliKind: AgentCliKind
}
// src/renderer/src/hooks/useAgentHooksWorkingReport.ts
export interface AgentHooksWorkingReportTab {
  slotId: string
  cliKind: AgentCliKind
  controller: Pick<AgentTerminalController, 'getSessionId'>
}
// src/renderer/src/__tests__/agentCliCapabilityOverrides.ts(テストの補助)
export interface AgentCliCapabilityOverrides {
  unsupportedKinds: Set<AgentCliKind>
}
export function overrideAgentCliCapabilities(
  actual: (kind: AgentCliKind) => AgentCliCapabilities,
  overrides: AgentCliCapabilityOverrides
): (kind: AgentCliKind) => AgentCliCapabilities
```

- [ ] **Step 1: 失敗するテストを書く（shared・main）**

`src/shared/__tests__/agentCliKinds.test.ts` の `it('claude の能力はすべて真、copilot はすべて偽', () => { … })` の全体を次に置き換える（`interrupt が真なら screenActivity も真` のテストは今のまま残す）:

```ts
it('claude の能力はすべて真、copilot は screenActivity・interrupt だけ真(段階 2a)', () => {
  expect(agentCliCapabilities('claude')).toEqual({
    promptSend: true,
    screenActivity: true,
    interrupt: true,
    changeAttribution: true,
    sessionResume: true
  })
  expect(agentCliCapabilities('copilot')).toEqual({
    promptSend: false,
    screenActivity: true,
    interrupt: true,
    changeAttribution: false,
    sessionResume: false
  })
})
```

`src/shared/__tests__/agentNotificationText.test.ts`: 今のテストの `expect(agentNotificationText(kind, 2)).toEqual(expected)` を `expect(agentNotificationText(kind, 2, 'claude')).toEqual(expected)` にし、`describe` の最後に次を足す:

```ts
it.each([
  ['permission', 'copilot 1: 許可待ち', 'copilot 1 が許可待ちになりました'],
  ['confirm', 'copilot 1: 確認待ち', 'copilot 1 が確認待ちになりました'],
  ['done', 'copilot 1: 作業が終わりました', 'copilot 1 の作業が終わりました']
] as const)(
  'copilot の %s は、題と読み上げに copilot の名前を使う',
  (kind, title, announcement) => {
    expect(agentNotificationText(kind, 1, 'copilot')).toMatchObject({ title, announcement })
  }
)

it.each(['permission', 'confirm', 'done'] as const)('%s の本文は種類で変わらない', (kind) => {
  expect(agentNotificationText(kind, 1, 'copilot').body).toBe(
    agentNotificationText(kind, 1, 'claude').body
  )
})
```

通知の依頼の形のテストの値に `cliKind: 'claude'` を足す（1 行の `{ … tabNumber: N, kind: '…' }` と、複数行の `tabNumber: N,` / `kind: '…'` の両方）:

```bash
cd <repo-root>
FILES="src/main/__tests__/handlers/agentNotificationPayloadParser.test.ts src/main/__tests__/agentNotifications.test.ts src/main/__tests__/handlers/agentNotificationHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/agentNotificationApi.test.ts src/renderer/src/lib/__tests__/agentNotificationEvents.test.ts src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts"
for f in $FILES; do test -f "$f" || echo "missing $f"; done
perl -0pi -e 's/(tabNumber: \d+, kind: \x27\w+\x27) \}/$1, cliKind: \x27claude\x27 }/g; s/(tabNumber: \d+,\n(\s+)kind: \x27\w+\x27)\n/$1,\n$2cliKind: \x27claude\x27\n/g' $FILES
grep -c "cliKind: 'claude'" $FILES
```

Expected: `missing` が出ない。数は順に `1`・`1`・`1`・`2`・`2`・`8`・`5`（計画の時点で写しにかけて確かめた数）

`src/main/__tests__/handlers/agentNotificationPayloadParser.test.ts`:

- `it.each([1, AGENT_MAX_SESSIONS_PER_WINDOW])('tabNumber %s を受ける', …)` の後に次を足す:

```ts
it.each(['claude', 'copilot'])('cliKind %s を受ける', (cliKind) => {
  expect(parseAgentNotificationShowRequest({ ...valid, cliKind }).cliKind).toBe(cliKind)
})
```

- 投げる場合の表の最後の行 `    ['kind が無い', { slotId: 'slot-1', tabNumber: 1 }, 'kind は']` を次の 4 行にする（`claude` に倒さない。L-044）:

```text
    ['kind が無い', { slotId: 'slot-1', tabNumber: 1 }, 'kind は'],
    ['cliKind が無い', { slotId: 'slot-1', tabNumber: 1, kind: 'done' }, 'cliKind は claude・copilot のどれかである必要があります'],
    ['cliKind が知らない文字列', { ...valid, cliKind: 'codex' }, 'cliKind は claude・copilot のどれかである必要があります'],
    ['cliKind が数', { ...valid, cliKind: 1 }, 'cliKind は claude・copilot のどれかである必要があります']
```

（配列の要素の 4 行。今の表と同じ字下げで貼り、貼った後に `npx prettier --write src/main/__tests__/handlers/agentNotificationPayloadParser.test.ts` で整形する）

`src/main/__tests__/agentNotifications.test.ts`:

- `const { title, body } = agentNotificationText('permission', 2)` を `const { title, body } = agentNotificationText('permission', 2, 'claude')` にする
- `it('フォーカスが無ければ、固定の表から作った題・本文で通知を出す', …)` の後に次を足す:

```ts
it('題は依頼の種類の名前で作る(copilot の依頼は copilot 2: 許可待ち。本文は同じ)', () => {
  const { center, created } = setup()
  center.show(makeWindow(), { ...request, cliKind: 'copilot' })
  expect(created[0].options).toEqual({
    title: 'copilot 2: 許可待ち',
    body: 'ツールの実行の許可を待っています'
  })
})
```

- [ ] **Step 2: テストの補助を作る（能力の表の差し替え）**

`src/renderer/src/__tests__/agentCliCapabilityOverrides.ts` を作る:

```ts
import type { AgentCliCapabilities, AgentCliKind } from '@shared/agentCliKinds'

// 能力の表を差し替えて「能力が無い種類」を作るテストの補助(設計書 2026-10-21「段階 1 の『判定しない・押せない』の扱い」)。
// 今の表には画面の判定・中断の能力が無い種類が無いため、vi.mock('@shared/agentCliKinds') の factory から使う

/** 差し替える種類(テストが足し、afterEach で消す) */
export interface AgentCliCapabilityOverrides {
  /** 画面の判定(screenActivity)と中断(interrupt)を偽にする種類 */
  unsupportedKinds: Set<AgentCliKind>
}

/**
 * 本物の agentCliCapabilities を包み、unsupportedKinds の種類だけ screenActivity と interrupt を偽にして返す
 * (能力の表の不変条件「interrupt が真なら screenActivity も真」を保つため、両方を偽にする)
 */
export function overrideAgentCliCapabilities(
  actual: (kind: AgentCliKind) => AgentCliCapabilities,
  overrides: AgentCliCapabilityOverrides
): (kind: AgentCliKind) => AgentCliCapabilities {
  return (kind) => {
    const capabilities = actual(kind)
    if (!overrides.unsupportedKinds.has(kind)) return capabilities
    return { ...capabilities, screenActivity: false, interrupt: false }
  }
}
```

- [ ] **Step 3: 失敗するテストを書く（判定の hook）**

`src/renderer/src/hooks/__tests__/useAgentActivity.test.ts`:

1. import の並びの最後に次を足す:

```ts
import { copilotScreen } from '../../lib/__tests__/fixtures/copilotScreens'
import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

// 能力が無い種類のテストのために、能力の表の screenActivity・interrupt を種類ごとに偽にできるようにする(今の表には能力が無い種類が無い)
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({ unsupportedKinds: new Set() })
)
vi.mock('@shared/agentCliKinds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/agentCliKinds')>()
  const { overrideAgentCliCapabilities } =
    await import('../../__tests__/agentCliCapabilityOverrides')
  return {
    ...actual,
    agentCliCapabilities: overrideAgentCliCapabilities(
      actual.agentCliCapabilities,
      capabilityOverrides
    )
  }
})
```

2. `classify` の型と作り方を、種類を受け取る形にする:

```ts
let classify: ReturnType<
  typeof vi.fn<(kind: AgentCliKind, lines: readonly ViewportLine[]) => AgentActivity>
>
```

```ts
classify = vi.fn<(kind: AgentCliKind, lines: readonly ViewportLine[]) => AgentActivity>(
  () => activity
)
```

3. `afterEach` の中の先頭に `capabilityOverrides.unsupportedKinds.clear()` を足す
4. 最初のテストの `expect(classify).toHaveBeenCalledWith(screen)` を `expect(classify).toHaveBeenCalledWith('claude', screen)` にする
5. `it('classify を省くと classifyClaudeScreen で判定する(空の画面は unknown)', …)`（Task 2 で直した題）の題を `'classify を省くと classifyAgentScreenFor で判定する(空の画面は unknown)'` にし、その後に次の 2 つを足す:

```ts
it('classify を省くと、タブの種類の判定で読む: copilot の作業中の台帳の画面は copilot のタブで working、claude のタブでは working 以外', () => {
  const copilotController = makeFakeController()
  copilotController.screen = copilotScreen('working3000').lines
  const claudeController = makeFakeController()
  claudeController.screen = copilotScreen('working3000').lines
  const { result } = renderHook(() =>
    useAgentActivity({
      tabs: [tabOf('a', copilotController, 'running', 'copilot'), tabOf('b', claudeController)]
    })
  )
  act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
  expect(result.current.get('a')).toBe('working')
  expect(result.current.get('b')).not.toBe('working')
})

it('copilot のタブも購読し、classify にタブの種類(copilot)と画面を渡して活動を記録する', () => {
  const controller = makeFakeController()
  const screen = copilotScreen('working3000').lines
  controller.screen = screen
  const { result } = render([tabOf('a', controller, 'running', 'copilot')])
  expect(controller.outputWrittenListeners.size).toBe(1)
  act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
  expect(classify).toHaveBeenCalledWith('copilot', screen)
  expect(result.current.get('a')).toBe('working')
})
```

6. 段階 1 の `copilot` のテスト 5 つ（`画面の判定が無い種類(copilot)のタブは購読せず…`・`claude から copilot に種類が変わったタブ(同じタブで起動し直した)は…`・`claude から copilot に種類が変わった直後の最初の描画…`・`copilot から claude に戻ったタブは…`・`claude → copilot → claude と戻ったタブは…`）は、本文の先頭に `capabilityOverrides.unsupportedKinds.add('copilot')` を足し（能力の表を差し替えて能力が無い種類を作る）、題を順に次へ変える（本文はほかに変えない）:
   - `'画面の判定が無い種類(能力の表を差し替えた copilot)のタブは購読せず、出力が来ても判定しない(タイマーも張らない)'`
   - `'claude から画面の判定が無い種類(差し替えた copilot)に変わったタブ(同じタブで起動し直した)は、購読を外して活動の記録を消す'`
   - `'claude から画面の判定が無い種類に変わった直後の最初の描画(記録を消す effect の前)でも、古い活動を返さず unknown にする'`
   - `'画面の判定が無い種類から claude に戻ったタブは、購読を張り直して判定する'`
   - `'claude → 画面の判定が無い種類 → claude と戻ったタブは、戻った後の判定までは前の活動を返さず unknown にする'`

- [ ] **Step 4: 失敗するテストを書く（通知の出来事・hook・自動の取り直し・hooks への知らせ）**

`src/renderer/src/lib/__tests__/agentNotificationEvents.test.ts`:

- `const tab = (n: number, overrides …)` の `isClosing: false,` の次に `cliKind: 'claude',` を足す
- `formatAgentNotificationAnnouncement` の `describe` の `said` を `agentNotificationText(kind, tabNumber, 'claude').announcement` にする
- `describe('advanceAgentNotifications', …)` の最後に次を足す:

```ts
it('出来事にタブの種類を写す(copilot のタブの出来事は cliKind が copilot)', () => {
  const { events } = advanceAgentNotifications(
    new Map<string, AgentActivity>([['slot-1', 'working']]),
    [tab(1, { cliKind: 'copilot' })],
    new Map<string, AgentActivity>([['slot-1', 'idle']])
  )
  expect(events).toEqual([{ slotId: 'slot-1', tabNumber: 1, kind: 'done', cliKind: 'copilot' }])
})
```

- `describe('formatAgentNotificationAnnouncement', …)` の最後に次を足す:

```ts
it('読み上げは出来事の種類の名前で作る', () => {
  expect(
    formatAgentNotificationAnnouncement([
      { slotId: 'slot-1', tabNumber: 1, kind: 'done', cliKind: 'copilot' }
    ])
  ).toBe('copilot 1 の作業が終わりました')
})
```

`src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts`:

- `said` の ``({ slotId: `slot-${tabNumber}`, tabNumber, kind })`` を ``({ slotId: `slot-${tabNumber}`, tabNumber, kind, cliKind: 'claude' as const })`` にする
- `const tab = (n: number, …)` の `isClosing: false,` の次に `cliKind: 'claude',` を足す
- `it('copilot のタブは画面を判定しないので、同じ出力でも知らせない', …)` の全体を次に置き換える（段階 1 の「copilot のタブでは知らせない」テストの置き換え）:

```ts
it('copilot のタブも、作業中 → 入力待ちで copilot の名前の完了を知らせ、依頼に cliKind: copilot を載せる', () => {
  const { result } = runWorkThenIdle('copilot')
  expect(result.current).toBe('copilot 1 の作業が終わりました')
  expect(mockShow).toHaveBeenCalledExactlyOnceWith({
    slotId: 'slot-1',
    tabNumber: 1,
    kind: 'done',
    cliKind: 'copilot'
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentChangesAutoRefresh.test.ts`:

- `const tab: AgentNotificationTab = { slotId: 's1', number: 1, status: 'running', isClosing: false }` を `const tab: AgentNotificationTab = { slotId: 's1', number: 1, status: 'running', isClosing: false, cliKind: 'claude' }` にする
- `it('活動が working → idle(完了)になると、…', …)` の後に次を足す:

```ts
it('copilot のタブの完了(working → idle)でも取り直す', async () => {
  const { refresh, update } = setup({ tabs: [{ ...tab, cliKind: 'copilot' }] })
  update({ activities: activitiesOf('idle') })
  await advance(AUTO_REFRESH_WAIT_MS)
  expect(refresh).toHaveBeenCalledExactlyOnceWith({ announce: false, quiet: true })
})
```

`src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts` の `const tab: AgentNotificationTab = {` の中の `isClosing: false` を `isClosing: false,` と `cliKind: 'claude'` の 2 行にする（型への追随）。

`src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx`:

- import に `import type { AgentCliKind } from '@shared/agentCliKinds'` を足す
- `tab` を種類を受け取る形にする:

```ts
const tab = (
  slotId: string,
  sessionId: string | null,
  cliKind: AgentCliKind = 'claude'
): AgentHooksWorkingReportTab => ({
  slotId,
  cliKind,
  controller: { getSessionId: () => sessionId }
})
```

- ファイルの最後に次を足す:

```ts
describe('useAgentHooksWorkingReport(変更の区別をしない種類)', () => {
  it('copilot のタブは、作業中・作業の終わりを知らせない(main の hooks は cli-unsupported で使わない)', () => {
    const tabs = [tab('a', 'sid-a', 'copilot')]
    const { rerender } = render({ tabs, activities: activitiesOf([['a', 'working']]) })
    rerender({ tabs, activities: activitiesOf([['a', 'idle']]) })
    expect(mockReport).not.toHaveBeenCalled()
    expect(mockReportEnded).not.toHaveBeenCalled()
  })

  it('claude と copilot のタブが並んでいても、claude のタブだけを今までどおり知らせる', () => {
    const tabs = [tab('a', 'sid-a'), tab('b', 'sid-b', 'copilot')]
    const { rerender } = render({
      tabs,
      activities: activitiesOf([
        ['a', 'working'],
        ['b', 'working']
      ])
    })
    rerender({
      tabs,
      activities: activitiesOf([
        ['a', 'idle'],
        ['b', 'idle']
      ])
    })
    expect(mockReport.mock.calls).toEqual([['sid-a']])
    expect(mockReportEnded.mock.calls).toEqual([['sid-a']])
  })
})
```

- [ ] **Step 5: 能力に依っていた既存のテストを直す（使えない機能の注記・中断）**

`src/renderer/src/lib/__tests__/agentCliMessages.test.ts`:

1. vitest の import を `import { describe, it, expect, vi, afterEach } from 'vitest'` にし、import の並びの最後に次を足す:

```ts
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

// 注記が出る経路(能力が無い種類)を確かめるため、能力の表の screenActivity・interrupt を種類ごとに偽にできるようにする
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({ unsupportedKinds: new Set<AgentCliKind>() })
)
vi.mock('@shared/agentCliKinds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/agentCliKinds')>()
  const { overrideAgentCliCapabilities } =
    await import('../../__tests__/agentCliCapabilityOverrides')
  return {
    ...actual,
    agentCliCapabilities: overrideAgentCliCapabilities(
      actual.agentCliCapabilities,
      capabilityOverrides
    )
  }
})

afterEach(() => {
  capabilityOverrides.unsupportedKinds.clear()
})
```

2. `it('使えない機能の注記: copilot は能力の表のすべての名前を並べ、claude は出さない', …)` の全体を次に置き換える:

```ts
it('使えない機能の注記: copilot は送信・区別・再開の 3 つを並べ(段階 2a で画面の判定と中断に対応した)、claude は出さない', () => {
  expect(agentCliUnsupportedFeaturesNote('copilot')).toBe(
    'copilot では次の機能を使えません（ターミナルで直接操作します）: プロンプトの送信（実行・再実行）、利用者の変更との区別、前回の続きから・このセッションで再開'
  )
  expect(agentCliUnsupportedFeaturesNote('claude')).toBeNull()
})

it('使えない機能の注記: 画面の判定と中断が無い種類(能力の表を差し替えた copilot)は、その 2 つの名前も並べる', () => {
  capabilityOverrides.unsupportedKinds.add('copilot')
  expect(agentCliUnsupportedFeaturesNote('copilot')).toBe(
    'copilot では次の機能を使えません（ターミナルで直接操作します）: プロンプトの送信（実行・再実行）、作業中・入力待ちの表示と通知、中断、利用者の変更との区別、前回の続きから・このセッションで再開'
  )
})
```

3. `it('通知の注記: 画面の判定が無い種類だけに出す', …)` の全体を次に置き換える:

```ts
it('通知の注記: 今の表ではどの種類にも出さない(copilot も画面を判定する)', () => {
  expect(agentNotificationUnsupportedNote('copilot')).toBeNull()
  expect(agentNotificationUnsupportedNote('claude')).toBeNull()
})

it('通知の注記: 画面の判定が無い種類(能力の表を差し替えた copilot)にだけ出す', () => {
  capabilityOverrides.unsupportedKinds.add('copilot')
  expect(agentNotificationUnsupportedNote('copilot')).toBe(
    'copilot では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）'
  )
  expect(agentNotificationUnsupportedNote('claude')).toBeNull()
})
```

`src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx` の `it('copilot を選んでいると、使えない機能の注記に能力の表のすべての名前を含む', …)` の全体を次に置き換え、使わなくなった `AGENT_CLI_CAPABILITY_NAMES` の import を消す:

```tsx
it('copilot を選んでいると、使えない機能の注記に能力の表で使えない機能(送信・区別・再開)を出す', () => {
  render(<AgentCliKindSection {...props({ kind: 'copilot' })} />)
  expect(
    screen.getByText(
      'copilot では次の機能を使えません（ターミナルで直接操作します）: プロンプトの送信（実行・再実行）、利用者の変更との区別、前回の続きから・このセッションで再開'
    )
  ).toBeInTheDocument()
})
```

`src/renderer/src/lib/__tests__/agentInterrupt.test.ts`（能力が無い種類の理由は、能力の表を差し替えて確かめる）:

1. vitest の import を `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'` にし、import の並びの最後に次を足す:

```ts
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

// 中断の能力が無い種類の理由(段階 1 の agentInterruptUnsupportedReason)を確かめるため、能力の表を種類ごとに差し替える
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({ unsupportedKinds: new Set<AgentCliKind>() })
)
vi.mock('@shared/agentCliKinds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/agentCliKinds')>()
  const { overrideAgentCliCapabilities } =
    await import('../../__tests__/agentCliCapabilityOverrides')
  return {
    ...actual,
    agentCliCapabilities: overrideAgentCliCapabilities(
      actual.agentCliCapabilities,
      capabilityOverrides
    )
  }
})
```

2. `describe('getAgentInterruptAvailability(CLI の種類)', () => {` を `describe('getAgentInterruptAvailability(中断の能力が無い種類。能力の表で copilot を差し替えて作る)', () => {` にし、その中の `const COPILOT_RUNNING …` の定義の後に次を足す（中の 4 つのテストは変えない）:

```ts
beforeEach(() => {
  capabilityOverrides.unsupportedKinds.add('copilot')
})
afterEach(() => {
  capabilityOverrides.unsupportedKinds.clear()
})
```

`src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts`: `it('選択中のタブが copilot なら押せず理由を出し、押しても interrupt を呼ばずに理由を読み上げる', …)` を消し（能力が無い種類の理由は `agentInterrupt.test.ts` で能力の表を差し替えて確かめる。`copilot` の中断は Task 5 で足す）、使わなくなった `agentInterruptUnsupportedReason` の import を消す。

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:

- `it('設定の種類を useAgentSessions(appCliKind)・ターミナルのパネル・通知の注記に渡す', …)` の中の

```ts
expect(result.current.agentNotificationPanel.unsupportedNote).toBe(
  agentNotificationUnsupportedNote('copilot')
)
```

を次にする:

```ts
// copilot も画面を判定するので、通知の注記は出ない(段階 2a)
expect(result.current.agentNotificationPanel.unsupportedNote).toBeNull()
```

- `it('設定が copilot なら、未起動のタブの名前は copilot で、起動すると実行・中断・前回の続きから・このセッションで再開がどれも copilot の理由で押せない', …)` の題を `'設定が copilot なら、未起動のタブの名前は copilot で、起動すると実行・前回の続きから・このセッションで再開は copilot の理由で押せず、中断は活動の理由で押せない'` にし、その中の

```ts
expect(result.current.agentTerminal.interrupt.disabledReason).toBe(
  agentInterruptUnsupportedReason('copilot')
)
```

を次にする（この `describe` は `useAgentActivity` を偽物〈空の Map〉にしているので、活動は `unknown`。文言は Task 5 で種類ごとにする）:

```ts
// 段階 2a で copilot も中断の能力を持つ。活動が未判定(unknown)なので活動の理由で押せない
expect(result.current.agentTerminal.interrupt.disabledReason).toBe(
  AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY.unknown
)
```

- import から `agentNotificationUnsupportedNote`（`../../lib/agentCliMessages`）と `agentInterruptUnsupportedReason`（`../../lib/agentInterruptMessages`）を消し、`../../lib/agentInterruptMessages` の import に `AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY` を足す

- [ ] **Step 6: テストが落ちることを確かめる**

Run: `npx vitest run src/shared/__tests__/agentCliKinds.test.ts src/shared/__tests__/agentNotificationText.test.ts src/main/__tests__/handlers/agentNotificationPayloadParser.test.ts src/main/__tests__/agentNotifications.test.ts src/renderer/src/hooks/__tests__/useAgentActivity.test.ts src/renderer/src/lib/__tests__/agentNotificationEvents.test.ts src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts src/renderer/src/hooks/__tests__/useAgentChangesAutoRefresh.test.ts src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: FAIL（能力の値・`cliKind` の検証・題の名前・`classify` に渡る種類・`copilot` の購読・通知の種類・hooks への知らせの絞り込み・注記の文言）

- [ ] **Step 7: shared と main を実装する**

`src/shared/agentCliKinds.ts`:

- `AgentCliCapabilities` の 3 つのコメントを次にする:

```ts
/** 画面からの活動の判定と、それに基づく表示・完了と許可待ちの通知・変更の一覧の自動の取り直し */
screenActivity: boolean
/** 帯の中断(送り方は main の agentCliInterruptSpecs.ts。claude は Esc を 1 回、copilot は 2 回)。押せる条件が screenActivity の
 *  working なので、true なら screenActivity も true */
interrupt: boolean
/** hooks によるエージェントの変更と利用者の変更の区別と、画面の作業中・作業の終わりを main の区間の追跡へ知らせること */
changeAttribution: boolean
```

- `copilot` の `capabilities` の `screenActivity: false` と `interrupt: false` を、それぞれ `screenActivity: true`・`interrupt: true` にする（`promptSend`・`changeAttribution`・`sessionResume` は `false` のまま）

`src/shared/types/agentNotification.ts`:

- 先頭に `import type { AgentCliKind } from '../agentCliKinds'` を足す
- `AgentNotificationShowRequest` を次にする:

```ts
/** agentNotification:show の入力。題・本文は main が固定の表から作る(renderer の文字列を通知に出さない) */
export interface AgentNotificationShowRequest {
  slotId: string
  /** タブの番号(題の `claude N`・`copilot N` の番号にだけ使う) */
  tabNumber: number
  kind: AgentNotificationKind
  /** タブの CLI の種類(題の名前にだけ使う。main が isAgentCliKind で検証する。押したときに届く先は slotId で決まる) */
  cliKind: AgentCliKind
}
```

`src/shared/agentNotificationText.ts`:

- import に `import type { AgentCliKind } from './agentCliKinds'` を足す
- `agentNotificationText` を次にする（段階 1 の「通知は claude の名前にする」のコメントを消す）:

```ts
/** 出来事・タブの番号・タブの CLI の種類から文言を作る。種類は省略させない(省略で claude の名前に流さない。L-060) */
export function agentNotificationText(
  kind: AgentNotificationKind,
  tabNumber: number,
  cliKind: AgentCliKind
): AgentNotificationText {
  return TEXTS[kind](formatAgentTabLabel(tabNumber, cliKind))
}
```

`src/main/handlers/agentNotificationPayloadParser.ts`:

- import に `import { AGENT_CLI_KINDS, isAgentCliKind } from '@shared/agentCliKinds'` を足す
- 冒頭のコメントの `tabNumber は通知の題(claude N)にしか使わず` を `tabNumber・cliKind は通知の題(claude N・copilot N)にしか使わず` にする
- `parseAgentNotificationShowRequest` を次にする:

```ts
export function parseAgentNotificationShowRequest(payload: unknown): AgentNotificationShowRequest {
  assertPlainObject(payload)
  const { tabNumber, kind, cliKind } = payload
  const slotId = parseAgentSlotId(payload.slotId)
  if (!isIntegerInRange(tabNumber, 1, AGENT_MAX_SESSIONS_PER_WINDOW)) {
    throw new Error(`tabNumber は 1〜${AGENT_MAX_SESSIONS_PER_WINDOW} の整数である必要があります`)
  }
  if (!isAgentNotificationKind(kind)) {
    throw new Error(`kind は ${AGENT_NOTIFICATION_KINDS.join('・')} のどれかである必要があります`)
  }
  // 知らない種類は claude に倒さず拒否する(L-044)。値は固定の表の名前を選ぶのにだけ使う(L-019)
  if (!isAgentCliKind(cliKind)) {
    throw new Error(`cliKind は ${AGENT_CLI_KINDS.join('・')} のどれかである必要があります`)
  }
  return { slotId, tabNumber, kind, cliKind }
}
```

`src/main/agentNotifications.ts` の `show(window, { slotId, tabNumber, kind }) {` を `show(window, { slotId, tabNumber, kind, cliKind }) {` に、`const { title, body } = agentNotificationText(kind, tabNumber)` を `const { title, body } = agentNotificationText(kind, tabNumber, cliKind)` にする（コメント `題・本文は固定の表から作る(renderer の文字列を通知に出さない。L-019)` は残す）。

- [ ] **Step 8: renderer を実装する**

`src/renderer/src/hooks/useAgentActivity.ts`:

- import の `import { classifyClaudeScreen } from '../lib/claudeScreenActivity'` を `import { classifyAgentScreenFor } from '../lib/agentScreenClassifiers'` にする
- 冒頭のコメントの最後の行 `// 画面の判定が無い種類(copilot)のタブは購読しない` を次にする:

```ts
// 判定の関数は、判定の時点のタブの種類で種類ごとの表(agentScreenClassifiers)から引く。画面の判定が無い種類
// (能力の表の screenActivity が false の種類。段階 2a の時点では無い)のタブは購読しない
```

- `AgentActivityTab.cliKind` のコメントを `/** タブの CLI の種類。判定の関数を引く(agentScreenClassifiers)。画面の判定(screenActivity)が無い種類は購読しない */` にする
- `UseAgentActivityOptions.classify` を次にする:

```ts
  /** タブの種類と画面の行から活動を判定する(既定は classifyAgentScreenFor。種類ごとの判定の表を引く)。行は読むだけ */
  classify?: (kind: AgentCliKind, lines: readonly ViewportLine[]) => AgentActivity
```

- 引数の既定 `classify = classifyClaudeScreen` を `classify = classifyAgentScreenFor` にする
- `judge` の `const activity = classifyRef.current(tab.controller.readScreen())` を次にする:

```ts
// 判定の時点のタブ(tabsRef の最新)の種類で判定の関数を引く。控えに種類は持たない(同じタブで別の種類を起動し直すときは
// 必ず running から出て入り直すので、その区切りで判定の予約も記録も消える)
const activity = classifyRef.current(tab.cliKind, tab.controller.readScreen())
```

- `forget` を呼ぶ箇所のコメント `// 画面の判定が無い種類(copilot): 購読・タイマーを持たず、…` の `(copilot)` を `(能力の表の screenActivity が false の種類)` にする

`src/renderer/src/lib/agentNotificationEvents.ts`:

- import に `import type { AgentCliKind } from '@shared/agentCliKinds'` を足す
- `AgentNotificationTab` の `isClosing` の後に次を足す:

```ts
/** タブの CLI の種類(題・読み上げの名前。タブの名前と同じ値〈AgentSessionTabView.cliKind〉で、名前と題が食い違わない) */
cliKind: AgentCliKind
```

- `AgentNotificationEvent` の `kind` の後に次を足す:

```ts
/** タブの CLI の種類(題・読み上げの名前) */
cliKind: AgentCliKind
```

- 2 つのインターフェースの `tabNumber`・`number` のコメントの `(題・読み上げの claude N)` を `(題・読み上げの claude N・copilot N の番号)` にする
- `advanceAgentNotifications` の `events.push({ slotId: tab.slotId, tabNumber: tab.number, kind: decision.kind })` を `events.push({ slotId: tab.slotId, tabNumber: tab.number, kind: decision.kind, cliKind: tab.cliKind })` にする
- `formatAgentNotificationAnnouncement` の `.map(({ kind, tabNumber }) => agentNotificationText(kind, tabNumber).announcement)` を `.map(({ kind, tabNumber, cliKind }) => agentNotificationText(kind, tabNumber, cliKind).announcement)` にする

`src/renderer/src/hooks/useAgentHooksWorkingReport.ts`:

- import に `import { agentCliCapabilities } from '@shared/agentCliKinds'` と `import type { AgentCliKind } from '@shared/agentCliKinds'` を足す
- `AgentHooksWorkingReportTab` の `slotId` の後に次を足す:

```ts
/** タブの CLI の種類。変更の区別(changeAttribution)をしない種類のタブは知らせない */
cliKind: AgentCliKind
```

- `for (const tab of tabs) {` の直後に次を足す:

```ts
// 変更の区別をしない種類(copilot)は知らせず、控えも持たない(main の hooks は cli-unsupported で、知らせを使わない)
if (!agentCliCapabilities(tab.cliKind).changeAttribution) continue
```

- 冒頭のコメントの最後に `変更の区別(能力の表の changeAttribution)をしない種類のタブは知らせない。` を足す

- [ ] **Step 9: テストが通ることを確かめる**

Run: Step 6 と同じコマンドに `src/main/__tests__/handlers/agentNotificationHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/agentNotificationApi.test.ts src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts src/renderer/src/lib/__tests__/agentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts` を足して流す
Expected: PASS
Run: `npm run typecheck`
Expected: PASS（`AgentNotificationTab`・`AgentHooksWorkingReportTab` を作っている箇所で `cliKind` の無いものがあれば型エラーになる。テストの値なら `cliKind: 'claude'` を足す。本番のコードは `useAgentSessions` の `tabs`〈`AgentSessionTabView`。`cliKind` を持つ〉をそのまま渡しているので直さない）

- [ ] **Step 10: 変異で確かめる**

1. `useAgentActivity.ts` の `classifyRef.current(tab.cliKind, …)` を `classifyRef.current('claude', …)` にする → `classify を省くと、タブの種類の判定で読む…` と `copilot のタブも購読し、classify にタブの種類(copilot)と画面を渡して…` が落ちる。戻す
2. `useAgentActivity.ts` の `if (!agentCliCapabilities(tab.cliKind).screenActivity) {` の判定を `if (false) {` にする → `画面の判定が無い種類(能力の表を差し替えた copilot)のタブは購読せず…` が落ちる（段階 1 の止め方が残っていることの確かめ）。戻す
3. `agentNotificationPayloadParser.ts` の `if (!isAgentCliKind(cliKind)) { … }` を消し、戻り値を `{ slotId, tabNumber, kind, cliKind: 'claude' }` にする → `cliKind が無い`・`cliKind が知らない文字列`・`cliKind が数`・`cliKind copilot を受ける` が落ちる。戻す
4. `agentNotificationEvents.ts` の `cliKind: tab.cliKind` を `cliKind: 'claude'` にする → `出来事にタブの種類を写す…` と `copilot のタブも、作業中 → 入力待ちで copilot の名前の完了を知らせ…` が落ちる。戻す
5. `useAgentHooksWorkingReport.ts` の `if (!agentCliCapabilities(tab.cliKind).changeAttribution) continue` を消す → `copilot のタブは、作業中・作業の終わりを知らせない…` が落ちる。戻す
6. `git diff --stat` で、上の 4 つのファイルの差分がこのタスクで入れたものだけであることを確かめる（`grep -n "classifyRef.current(tab.cliKind" src/renderer/src/hooks/useAgentActivity.ts` が 1 行出る）

- [ ] **Step 11: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/shared/agentCliKinds.ts src/shared/types/agentNotification.ts src/shared/agentNotificationText.ts src/main/handlers/agentNotificationPayloadParser.ts src/main/agentNotifications.ts src/renderer/src/hooks/useAgentActivity.ts src/renderer/src/lib/agentNotificationEvents.ts src/renderer/src/hooks/useAgentHooksWorkingReport.ts src/renderer/src/__tests__/agentCliCapabilityOverrides.ts src/shared/__tests__/agentCliKinds.test.ts src/shared/__tests__/agentNotificationText.test.ts src/main/__tests__/handlers/agentNotificationPayloadParser.test.ts src/main/__tests__/agentNotifications.test.ts src/main/__tests__/handlers/agentNotificationHandlers.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/agentNotificationApi.test.ts src/renderer/src/lib/__tests__/agentNotificationEvents.test.ts src/renderer/src/hooks/__tests__/useAgentNotifications.test.ts src/renderer/src/hooks/__tests__/useAgentActivity.test.ts src/renderer/src/hooks/__tests__/useAgentChangesAutoRefresh.test.ts src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx src/renderer/src/lib/__tests__/agentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み（外れたら同じファイルを明示して `npx prettier --write` で直す）

---

### Task 4: 中断の main（送り方の表・2 回目の受け付け・IPC・窓口）

> **設計書の読む節:** 「中断の流れ」の main の送り方の表・main（`AgentSession`・registry・受け口）・共有の型、「2 回目の前の危険と、残る危険」、「エラー処理」の main の結果の列、「テスト方針」の main・preload（node-pty の統合テストを含む）。
>
> **気をつける知見:** L-019（2 回目の IPC も `sessionId` だけを受け取り、main が固定の `\x1b` を書く。回数・間隔・期限は main の表だけが決め、控えが無ければ書かない）・L-001（2 回目の結果を 5 つに分けて返す）・L-037（照合は所有者の枠の現在のセッション。控えはセッションごとで、停止・終了で消す）・L-052（外部プロセスを待たない。`pty.write` は同期）・L-059（実物の node-pty で 2 回の Esc とその間隔を確かめる。Windows では飛ばす）・L-060（`AgentSessionParams.interrupt`・`now` を省略できない）

**Files:**

- Create: `src/main/agentCliInterruptSpecs.ts`・`src/main/__tests__/agentCliInterruptSpecs.test.ts`
- Modify: `src/main/agentSession.ts`・`src/main/agentSessionStarter.ts`・`src/main/agentSessionRegistry.ts`・`src/main/handlers/agentTerminalHandlers.ts`・`src/shared/types/agentTerminal.ts`・`src/preload/api.ts`・`src/preload/index.d.ts`・`src/renderer/src/lib/agentTerminalApi.ts`・`src/renderer/src/__tests__/setup.ts`
- Test: `src/main/__tests__/agentSession.test.ts`・`src/main/__tests__/agentSessionRegistry.test.ts`・`src/main/__tests__/agentSessionStarter.test.ts`・`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`・`src/main/__tests__/agentSession.integration.test.ts`・`src/main/__tests__/agentCliLaunch.integration.test.ts`（引数の追随）・`src/preload/__tests__/api.test.ts`・`src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`・`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`（型の追随）

**Interfaces:**

- Consumes: `AgentCliKind`（shared）、`AGENT_INTERRUPT_SEQUENCE`（既存）、`findBySessionId`（registry の内部。既存）
- Produces（Task 5 が使う）:

```ts
// src/main/agentCliInterruptSpecs.ts
export interface AgentCliInterruptFollowUpSpec { afterMs: number; deadlineMs: number }
export interface AgentCliInterruptSpec { followUp: AgentCliInterruptFollowUpSpec | null }
export const AGENT_CLI_INTERRUPT_SPECS: Record<AgentCliKind, AgentCliInterruptSpec>
// src/main/agentSession.ts
export type AgentSessionInterruptResult =
  | { kind: 'sent'; followUp: { afterMs: number } | null }
  | { kind: 'not-alive' }
  | { kind: 'write-failed' }
export type AgentSessionInterruptFollowUpResult = 'sent' | 'not-pending' | 'expired' | 'not-alive' | 'write-failed'
export const monotonicNow: () => number
// AgentSessionParams・StartAgentSessionParams に interrupt: AgentCliInterruptSpec と now: () => number(必須)
// src/shared/types/agentTerminal.ts
export interface AgentInterruptFollowUp { afterMs: number }
export type AgentInterruptResult = { kind: 'sent'; followUp: AgentInterruptFollowUp | null } | { kind: 'no-session' } | { kind: 'write-failed' }
export type AgentInterruptFollowUpResult = { kind: 'sent' } | { kind: 'not-pending' } | { kind: 'expired' } | { kind: 'no-session' } | { kind: 'write-failed' }
// src/main/agentSessionRegistry.ts
interruptFollowUp(ownerId: number, sessionId: string): AgentInterruptFollowUpResult
// preload(window.api)・src/renderer/src/lib/agentTerminalApi.ts
interruptAgentSessionFollowUp(sessionId: string): Promise<AgentInterruptFollowUpResult>
```

- [ ] **Step 1: 失敗するテストを書く（送り方の表）**

`src/main/__tests__/agentCliInterruptSpecs.test.ts` を作る:

```ts
import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import { AGENT_CLI_INTERRUPT_SPECS } from '../agentCliInterruptSpecs'

// 中断の送り方の表(設計書 2026-10-21「main の送り方の表」)。押すキーの回数の文言(renderer の agentInterruptMessages.ts)と回数を合わせる
describe('AGENT_CLI_INTERRUPT_SPECS', () => {
  it('種類の一覧のすべてに送り方がある', () => {
    expect(Object.keys(AGENT_CLI_INTERRUPT_SPECS).sort()).toEqual([...AGENT_CLI_KINDS].sort())
  })

  it('claude は作業中の Esc 1 回で中断する(2 回目なし)', () => {
    expect(AGENT_CLI_INTERRUPT_SPECS.claude).toEqual({ followUp: null })
  })

  it('copilot は 1 回目から 100ms 以上・400ms 以内に頼まれたときだけ 2 回目を書く', () => {
    expect(AGENT_CLI_INTERRUPT_SPECS.copilot).toEqual({
      followUp: { afterMs: 100, deadlineMs: 400 }
    })
  })

  it.each(AGENT_CLI_KINDS)(
    '%s: 2 回目の待ちは 80ms 以上、期限は待ちより大きく 500ms 未満(段階 0 の実測: 80〜150ms と 450ms で効き 600ms は効かない。copilot の 2 回の窓は 500ms)',
    (kind) => {
      const { followUp } = AGENT_CLI_INTERRUPT_SPECS[kind]
      if (followUp === null) return
      expect(followUp.afterMs).toBeGreaterThanOrEqual(80)
      expect(followUp.deadlineMs).toBeGreaterThan(followUp.afterMs)
      expect(followUp.deadlineMs).toBeLessThan(500)
    }
  )
})
```

- [ ] **Step 2: 失敗するテストを書く（AgentSession）**

`src/main/__tests__/agentSession.test.ts`:

1. 既存の `new AgentSession({` と `startAgentSession({` の呼び出しに、claude の送り方と止まった時計を渡す（新しいテストを足す前に流す）:

```bash
cd <repo-root>
T=src/main/__tests__/agentSession.test.ts
test -f "$T" || echo "missing $T"
perl -0pi -e 's/new AgentSession\(\{/new AgentSession({ ...CLAUDE_INTERRUPT,/g; s/startAgentSession\(\{/startAgentSession({ ...CLAUDE_INTERRUPT,/g' "$T"
grep -c "\.\.\.CLAUDE_INTERRUPT" "$T"
```

Expected: `missing` が出ず、数が 1 以上（`new AgentSession` と `startAgentSession` の呼び出しの数）

2. import に `import { AGENT_CLI_INTERRUPT_SPECS } from '../agentCliInterruptSpecs'` と vitest の `beforeEach` を足し、`makeCallbacks` の定義の前に次を足す:

```ts
// 中断の送り方と時計(2 回目のテスト以外は claude の送り方と止まった時計)
const CLAUDE_INTERRUPT = { interrupt: AGENT_CLI_INTERRUPT_SPECS.claude, now: (): number => 0 }
```

3. `describe('AgentSession.interrupt', …)` の中の期待を、結果のオブジェクトにする:
   - `expect(session.interrupt()).toBe('sent')` → `expect(session.interrupt()).toEqual({ kind: 'sent', followUp: null })`
   - `expect(session.interrupt()).toBe('not-alive')`（2 か所）→ `expect(session.interrupt()).toEqual({ kind: 'not-alive' })`
   - `expect(session.interrupt()).toBe('write-failed')` → `expect(session.interrupt()).toEqual({ kind: 'write-failed' })`

4. `describe('AgentSession.interrupt', …)` の後に次を足す:

```ts
describe('AgentSession.interruptFollowUp(2 回目の要る種類: copilot)', () => {
  let clock: number
  const makeCopilotSession = (
    pty = makeFakePty(),
    stopTree = vi.fn<StopTree>()
  ): { session: AgentSession; pty: ReturnType<typeof makeFakePty> } => ({
    session: new AgentSession({
      id: 's1',
      pty,
      callbacks: makeCallbacks(),
      stopTree,
      interrupt: AGENT_CLI_INTERRUPT_SPECS.copilot,
      now: () => clock
    }),
    pty
  })

  beforeEach(() => {
    clock = 1_000
  })

  it('1 回目は固定の 1 バイトだけを書き、2 回目を頼むまでの待ち(afterMs: 100)を返す', () => {
    const { session, pty } = makeCopilotSession()
    expect(session.interrupt()).toEqual({ kind: 'sent', followUp: { afterMs: 100 } })
    expect(pty.write.mock.calls).toEqual([['\x1b']])
  })

  it('1 回目から 100ms 後の 2 回目で、もう 1 バイトの Esc を書く(書いた列の完全一致)', () => {
    const { session, pty } = makeCopilotSession()
    session.interrupt()
    clock += 100
    expect(session.interruptFollowUp()).toBe('sent')
    expect(pty.write.mock.calls).toEqual([['\x1b'], ['\x1b']])
  })

  it('1 回目から 99ms では not-pending で書かない(2 回を 1 つの読み取りに詰めない)', () => {
    const { session, pty } = makeCopilotSession()
    session.interrupt()
    clock += 99
    expect(session.interruptFollowUp()).toBe('not-pending')
    expect(pty.write.mock.calls).toEqual([['\x1b']])
  })

  it('1 回目から 400ms ちょうどは書き、401ms では expired で書かない', () => {
    const onTime = makeCopilotSession()
    onTime.session.interrupt()
    clock += 400
    expect(onTime.session.interruptFollowUp()).toBe('sent')
    const late = makeCopilotSession()
    late.session.interrupt()
    clock += 401
    expect(late.session.interruptFollowUp()).toBe('expired')
    expect(late.pty.write.mock.calls).toEqual([['\x1b']])
  })

  it('控えは 1 回で使い切る(2 回目の後の 2 回目・早すぎた依頼の後の依頼は not-pending)', () => {
    const { session, pty } = makeCopilotSession()
    session.interrupt()
    clock += 100
    session.interruptFollowUp()
    expect(session.interruptFollowUp()).toBe('not-pending')
    const early = makeCopilotSession()
    early.session.interrupt()
    clock += 50
    early.session.interruptFollowUp()
    clock += 100
    expect(early.session.interruptFollowUp()).toBe('not-pending')
    expect(pty.write).toHaveBeenCalledTimes(2)
    expect(early.pty.write).toHaveBeenCalledTimes(1)
  })

  it('1 回目の後に stop したら(止まりきる前でも)not-alive で書かない', () => {
    const { session, pty } = makeCopilotSession(
      makeFakePty(),
      vi.fn<StopTree>(() => new Promise<void>(() => undefined))
    )
    session.interrupt()
    void session.stop('stopped')
    clock += 100
    expect(session.interruptFollowUp()).toBe('not-alive')
    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('1 回目の後に終了したら not-alive で書かない', () => {
    const { session, pty } = makeCopilotSession()
    session.interrupt()
    pty.emitExit(0)
    clock += 100
    expect(session.interruptFollowUp()).toBe('not-alive')
    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('2 回目の書き込みが投げたら write-failed(例外を投げない)', () => {
    const { session, pty } = makeCopilotSession()
    session.interrupt()
    pty.write.mockImplementationOnce(() => {
      throw new Error('EIO')
    })
    clock += 100
    expect(session.interruptFollowUp()).toBe('write-failed')
  })

  it('1 回目の書き込みが投げたら控えを作らない(その後の 2 回目は not-pending)', () => {
    const { session, pty } = makeCopilotSession()
    pty.write.mockImplementationOnce(() => {
      throw new Error('EIO')
    })
    expect(session.interrupt()).toEqual({ kind: 'write-failed' })
    clock += 100
    expect(session.interruptFollowUp()).toBe('not-pending')
    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('claude の送り方では followUp: null を返し、interruptFollowUp は not-pending で書かない', () => {
    const pty = makeFakePty()
    const session = new AgentSession({
      id: 's1',
      pty,
      callbacks: makeCallbacks(),
      stopTree: vi.fn<StopTree>(),
      interrupt: AGENT_CLI_INTERRUPT_SPECS.claude,
      now: () => clock
    })
    expect(session.interrupt()).toEqual({ kind: 'sent', followUp: null })
    clock += 100
    expect(session.interruptFollowUp()).toBe('not-pending')
    expect(pty.write.mock.calls).toEqual([['\x1b']])
  })

  it('startAgentSession は送り方と時計をセッションに渡す', () => {
    const pty = makeFakePty()
    const session = startAgentSession({
      id: 's9',
      spawn: vi.fn<PtySpawn>().mockReturnValueOnce(pty),
      file: '/bin/copilot',
      args: [],
      env: {},
      cwd: '/work',
      cols: 80,
      rows: 24,
      callbacks: makeCallbacks(),
      stopTree: vi.fn<StopTree>(),
      interrupt: AGENT_CLI_INTERRUPT_SPECS.copilot,
      now: () => clock
    })
    expect(session.interrupt()).toEqual({ kind: 'sent', followUp: { afterMs: 100 } })
    clock += 100
    expect(session.interruptFollowUp()).toBe('sent')
  })
})
```

- [ ] **Step 3: 失敗するテストを書く（registry・starter・受け口・preload・renderer の窓口）**

`src/main/__tests__/agentSessionRegistry.test.ts`:

1. 既存の `new AgentSession({` に claude の送り方を渡す:

```bash
cd <repo-root>
T=src/main/__tests__/agentSessionRegistry.test.ts
test -f "$T" || echo "missing $T"
perl -0pi -e 's/new AgentSession\(\{/new AgentSession({ ...CLAUDE_INTERRUPT,/g' "$T"
grep -c "\.\.\.CLAUDE_INTERRUPT" "$T"
```

Expected: `3`

2. import に `import { AGENT_CLI_INTERRUPT_SPECS } from '../agentCliInterruptSpecs'` を足し、`makeSession` の定義の前に次を足す:

```ts
// 中断の送り方と時計(2 回目のテスト以外は claude の送り方と止まった時計)
const CLAUDE_INTERRUPT = { interrupt: AGENT_CLI_INTERRUPT_SPECS.claude, now: (): number => 0 }

// copilot の送り方(2 回目あり)のセッション。advance で偽の時計を進める
function makeCopilotSession(id: string): {
  session: AgentSession
  pty: FakePty
  advance: (ms: number) => void
} {
  const pty = makeFakePty()
  let clock = 0
  const session = new AgentSession({
    id,
    pty,
    callbacks: { onData: vi.fn(), onExit: vi.fn() },
    stopTree: vi.fn<StopTree>(async (_pty, exited) => {
      pty.emitExit(0, 15)
      await exited
    }),
    interrupt: AGENT_CLI_INTERRUPT_SPECS.copilot,
    now: () => clock
  })
  return { session, pty, advance: (ms) => (clock += ms) }
}
```

（`advance` の戻り値は使わない。eslint が `no-return-assign` を出す場合は `advance: (ms) => { clock += ms }` にする）

3. `describe('AgentSessionRegistry.interrupt', …)` の `expect(registry.interrupt(1, 's1')).toEqual({ kind: 'sent' })` を `expect(registry.interrupt(1, 's1')).toEqual({ kind: 'sent', followUp: null })` にし、その `describe` の後に次を足す:

```ts
describe('AgentSessionRegistry.interruptFollowUp', () => {
  it('interrupt はセッションの 2 回目の案内をそのまま返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session } = makeCopilotSession('s1')
    await registry.start(1, 'a', created(session))
    expect(registry.interrupt(1, 's1')).toEqual({ kind: 'sent', followUp: { afterMs: 100 } })
  })

  it('所有者の枠の現在のセッションだけに 2 回目を書き、sent を返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty, advance } = makeCopilotSession('s1')
    await registry.start(1, 'a', created(session))
    registry.interrupt(1, 's1')
    advance(100)
    expect(registry.interruptFollowUp(1, 's1')).toEqual({ kind: 'sent' })
    expect(pty.write.mock.calls).toEqual([[AGENT_INTERRUPT_SEQUENCE], [AGENT_INTERRUPT_SEQUENCE]])
  })

  it('別の所有者・知らない sessionId には書かず no-session を返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty, advance } = makeCopilotSession('s1')
    await registry.start(1, 'a', created(session))
    registry.interrupt(1, 's1')
    advance(100)
    expect(registry.interruptFollowUp(2, 's1')).toEqual({ kind: 'no-session' })
    expect(registry.interruptFollowUp(1, 'other')).toEqual({ kind: 'no-session' })
    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('起動し直した後の古い sessionId には書かず no-session を返す(世代の確認。L-037)', async () => {
    const registry = new AgentSessionRegistry()
    const first = makeCopilotSession('s1')
    await registry.start(1, 'a', created(first.session))
    registry.interrupt(1, 's1')
    first.pty.emitExit(0)
    await first.session.exited
    const second = makeCopilotSession('s2')
    await registry.start(1, 'a', created(second.session))
    first.advance(100)
    expect(registry.interruptFollowUp(1, 's1')).toEqual({ kind: 'no-session' })
    expect(second.pty.write).not.toHaveBeenCalled()
  })

  it('停止中のセッション(stop の後、止まりきる前)には書かず no-session を返す', async () => {
    const registry = new AgentSessionRegistry()
    const slow = makeSlowStoppingSession('old')
    await registry.start(1, 'a', created(slow.session))
    const stopping = registry.stop(1, 'stopped', 'old')
    expect(registry.interruptFollowUp(1, 'old')).toEqual({ kind: 'no-session' })
    expect(slow.pty.write).not.toHaveBeenCalled()
    slow.release()
    await stopping
  })

  it('終了した直後(枠から外れる前)のセッションは no-session(セッションの not-alive を写す)', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty, advance } = makeCopilotSession('s1')
    await registry.start(1, 'a', created(session))
    registry.interrupt(1, 's1')
    pty.emitExit(0)
    advance(100)
    expect(registry.interruptFollowUp(1, 's1')).toEqual({ kind: 'no-session' })
    await session.exited
  })

  it('セッションの not-pending・expired・write-failed をそのまま写す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty, advance } = makeCopilotSession('s1')
    await registry.start(1, 'a', created(session))
    expect(registry.interruptFollowUp(1, 's1')).toEqual({ kind: 'not-pending' })
    registry.interrupt(1, 's1')
    advance(401)
    expect(registry.interruptFollowUp(1, 's1')).toEqual({ kind: 'expired' })
    registry.interrupt(1, 's1')
    advance(100)
    pty.write.mockImplementationOnce(() => {
      throw new Error('EIO')
    })
    expect(registry.interruptFollowUp(1, 's1')).toEqual({ kind: 'write-failed' })
  })
})
```

`src/main/__tests__/agentSessionStarter.test.ts` の `describe('createAgentSessionStarter(CLI の種類)', …)` の最後に次を足す:

```ts
it('copilot の計画で起動したセッションの中断は、2 回目の案内(afterMs: 100)を返す(starter が計画の種類の送り方を渡す。L-018)', async () => {
  await makeStarter()(1, REQUEST, makeSink())
  expect(registry.interrupt(1, 'sid-1')).toEqual({ kind: 'sent', followUp: { afterMs: 100 } })
})

it('claude の計画で起動したセッションの中断は、2 回目の案内が null(今までどおり 1 回)', async () => {
  resolveLaunch.mockResolvedValue(OK_LAUNCH)
  await makeStarter()(1, REQUEST, makeSink())
  expect(registry.interrupt(1, 'sid-1')).toEqual({ kind: 'sent', followUp: null })
})
```

`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`:

- `describe('agentTerminal:interrupt', …)` の `expect(interrupt(event, 'sid-1', 'evil', '\x03')).toEqual({ kind: 'sent' })` を `toEqual({ kind: 'sent', followUp: null })` にする
- 同じ `describe` の `fakeRegistry` に `interruptFollowUp: vi.fn(),` を足す（`Pick` に足すため）
- ファイルの最後に次を足す:

```ts
describe('agentTerminal:interruptFollowUp', () => {
  const followUp = (event: ReturnType<typeof makeEvent>, ...args: unknown[]): unknown =>
    handles.get('agentTerminal:interruptFollowUp')?.(event, ...args)

  it('サブフレームからの依頼・空や文字列でない sessionId は投げて registry を呼ばない', () => {
    const registryFollowUp = vi.fn<AgentSessionRegistry['interruptFollowUp']>()
    register({
      registry: {
        write: vi.fn(),
        resize: vi.fn(),
        stop: vi.fn(async () => undefined),
        snapshot: vi.fn(() => []),
        interrupt: vi.fn(),
        interruptFollowUp: registryFollowUp
      }
    })
    expect(() => followUp(makeEvent(1, false), 'sid-1')).toThrow()
    expect(() => followUp(makeEvent(), '')).toThrow()
    expect(() => followUp(makeEvent(), 1)).toThrow()
    expect(registryFollowUp).not.toHaveBeenCalled()
  })

  it('registry.interruptFollowUp に送信元の id と sessionId だけを渡し、結果をそのまま返す。余分な引数を渡しても変わらない(L-019)', () => {
    const registryFollowUp = vi.fn<AgentSessionRegistry['interruptFollowUp']>(() => ({
      kind: 'expired'
    }))
    register({
      registry: {
        write: vi.fn(),
        resize: vi.fn(),
        stop: vi.fn(async () => undefined),
        snapshot: vi.fn(() => []),
        interrupt: vi.fn(),
        interruptFollowUp: registryFollowUp
      }
    })
    expect(followUp(makeEvent(7), 'sid-x', '\x1b\x1b', 3)).toEqual({ kind: 'expired' })
    expect(registryFollowUp).toHaveBeenCalledExactlyOnceWith(7, 'sid-x')
  })

  it('claude のセッション(2 回目の無い種類)では書かずに not-pending を返す(本物の registry と starter を通す)', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    expect(followUp(event, 'sid-1')).toEqual({ kind: 'not-pending' })
    expect(pty.write).not.toHaveBeenCalled()
  })
})
```

`src/preload/__tests__/api.test.ts`:

- `'interruptAgentSession は agentTerminal:interrupt に sessionId だけを渡す'` の行の後に次の行を足す:

```ts
    [
      'interruptAgentSessionFollowUp は agentTerminal:interruptFollowUp に sessionId だけを渡す',
      () => api.interruptAgentSessionFollowUp('id'),
      ['agentTerminal:interruptFollowUp', 'id']
    ],
```

- `describe('interruptAgentSession の戻り値', …)` の後に次を足す:

```ts
describe('interruptAgentSessionFollowUp の戻り値', () => {
  it('agentTerminal:interruptFollowUp の結果をそのまま返す', async () => {
    const result = { kind: 'expired' }
    mockInvoke.mockResolvedValue(result)
    await expect(api.interruptAgentSessionFollowUp('id')).resolves.toBe(result)
  })
})
```

`src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`: `mockApi` に `interruptAgentSessionFollowUp: vi.fn(),` を足し、最初のテストの呼び出しの並びに `agentTerminalApi.interruptAgentSessionFollowUp('s')`、期待の並びに `expect(mockApi.interruptAgentSessionFollowUp).toHaveBeenCalledWith('s')` を足す。

`src/main/__tests__/agentSession.integration.test.ts`:

1. import を `import { monotonicNow, startAgentSession } from '../agentSession'`・`import { AGENT_CLI_INTERRUPT_SPECS } from '../agentCliInterruptSpecs'`・`import type { AgentCliInterruptSpec } from '../agentCliInterruptSpecs'` にする
2. `function start(script: string, stopTreeGraceMs = 3000): AgentSession {` を `function start(script: string, stopTreeGraceMs = 3000, interrupt: AgentCliInterruptSpec = AGENT_CLI_INTERRUPT_SPECS.claude): AgentSession {` にし、`startAgentSession({` の引数に `interrupt,` と `now: monotonicNow,` を足す
3. 既存の `expect(session.interrupt()).toBe('sent')` を `expect(session.interrupt()).toEqual({ kind: 'sent', followUp: null })` にする
4. 既存の interrupt の統合テストの後に次を足す:

```ts
it('copilot の送り方では、interrupt と 150ms 後の interruptFollowUp で、子に 1b を 2 回、別々の読み取りで(80ms 以上空けて)届ける', async () => {
  const out = join(dir, 'received-times')
  const ready = join(dir, 'ready')
  const script = join(dir, 'raw-times.js')
  writeFileSync(
    script,
    [
      "const fs = require('node:fs')",
      'process.stdin.setRawMode(true)',
      // 読み取りごとに、受け取ったバイト(16 進)と受け取った時刻(ms)を 1 行に書く。2 つの Esc が 1 回の読み取りに詰められると 1 行になる
      `process.stdin.on('data', (chunk) => fs.appendFileSync(${JSON.stringify(out)}, chunk.toString('hex') + ' ' + performance.now() + '\\n'))`,
      `fs.writeFileSync(${JSON.stringify(ready)}, 'ready')`
    ].join('\n')
  )
  const session = start(
    `exec '${process.execPath}' '${script}'`,
    3000,
    AGENT_CLI_INTERRUPT_SPECS.copilot
  )
  await waitForFile(ready, timers)
  expect(session.interrupt()).toEqual({ kind: 'sent', followUp: { afterMs: 100 } })
  // afterMs の 100ms に余裕を足し、期限の 400ms より十分前に頼む(Node の setTimeout はループのキャッシュした時刻で数えるため、
  // 100ms ちょうどでは performance.now() で測った経過が 100ms を切り、not-pending になることがある)
  await timers.delay(150)
  expect(session.interruptFollowUp()).toBe('sent')
  const readLines = (): string[] =>
    existsSync(out)
      ? readFileSync(out, 'utf8')
          .split('\n')
          .filter((line) => line !== '')
      : []
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && readLines().length < 2) await timers.delay(20)
  // 続けて余分なバイトが届かないことを、少し待ってから確かめる
  await timers.delay(300)
  const received = readLines().map((line) => line.split(' '))
  expect(received.map(([hex]) => hex)).toEqual(['1b', '1b'])
  expect(Number(received[1][1]) - Number(received[0][1])).toBeGreaterThanOrEqual(80)
}, 15_000)
```

`src/main/__tests__/agentCliLaunch.integration.test.ts` の `runPlan` の `startAgentSession({` の引数に `interrupt: AGENT_CLI_INTERRUPT_SPECS[plan.cliKind],` と `now: monotonicNow,` を足し、import に `monotonicNow`（`../agentSession`）と `AGENT_CLI_INTERRUPT_SPECS`（`../agentCliInterruptSpecs`）を足す（引数の追随）。

renderer のテストの `window.api.interruptAgentSession` の偽物の値を新しい型にする（renderer の `AgentInterruptOutcome` は Task 5 で変える）:

```bash
cd <repo-root>
A=src/renderer/src/hooks/__tests__/useAgentSessions.test.ts
B=src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts
test -f "$A" && test -f "$B" || echo "missing"
perl -pi -e 's/mockInterrupt\.mockResolvedValueOnce\(\{ kind: \x27sent\x27 \}\)/mockInterrupt.mockResolvedValueOnce({ kind: \x27sent\x27, followUp: null })/g' "$A"
perl -0pi -e 's/(\.spyOn\(window\.api, \x27interruptAgentSession\x27\)\s*\.mockResolvedValue\(\{ kind: \x27sent\x27)( \}\))/$1, followUp: null$2/g' "$B"
grep -c "kind: 'sent', followUp: null" "$A" "$B"
```

Expected: `missing` が出ない。`useAgentSessions.test.ts` が 1 以上（`mockInterrupt` の `sent` の数）、`useAgentWorkspace.test.ts` が `1`

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentCliInterruptSpecs.test.ts src/main/__tests__/agentSession.test.ts src/main/__tests__/agentSessionRegistry.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/agentSession.integration.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`
Expected: FAIL（`../agentCliInterruptSpecs` が無い・`interruptFollowUp` が無い・結果の形が違う）

- [ ] **Step 5: 送り方の表・共有の型・AgentSession を実装する**

`src/main/agentCliInterruptSpecs.ts` を作る:

```ts
import type { AgentCliKind } from '@shared/agentCliKinds'

// CLI の種類ごとの中断の送り方(設計書 2026-10-21「main の送り方の表」。段階 1 の起動の表 agentCliLaunchSpecs と同じ流儀)。
// 書くバイトは固定の Esc(AGENT_INTERRUPT_SEQUENCE)で、回数・間隔・期限は main だけが決める(L-019)。renderer は 2 回目を
// 「頼む」か「頼まない」かだけを選べる。文言の表(renderer の agentInterruptMessages.ts の AGENT_INTERRUPT_KEY_TEXTS)と回数を合わせる

export interface AgentCliInterruptFollowUpSpec {
  /** 1 回目を書いてから、renderer が 2 回目を頼むまでに待つ時間。main はこれより早い依頼を受け付けない */
  afterMs: number
  /** 1 回目からこの時間を過ぎた依頼は書かない(CLI の 2 回の窓の内に届けるため) */
  deadlineMs: number
}

export interface AgentCliInterruptSpec {
  /** 2 回目の Esc。null なら 1 回だけ */
  followUp: AgentCliInterruptFollowUpSpec | null
}

export const AGENT_CLI_INTERRUPT_SPECS: Record<AgentCliKind, AgentCliInterruptSpec> = {
  // 作業中の Esc 1 回で中断する(2026-10-19 の設計書)
  claude: { followUp: null },
  // 2 回の窓は 500ms(`let rt=500`。80〜150ms と 450ms で効き、600ms は効かない)。100ms は利用者の決定。期限の 400ms は、
  // pty への書き込みから copilot が読むまでの遅れの余裕(100ms)を窓から引いた値
  copilot: { followUp: { afterMs: 100, deadlineMs: 400 } }
}
```

`src/shared/types/agentTerminal.ts` の `AgentInterruptResult` を次に置き換える:

```ts
/** 中断の 2 回目の案内(main の種類ごとの表で決める。renderer は回数・間隔を決めない) */
export interface AgentInterruptFollowUp {
  /** 1 回目を書いてから、2 回目を頼むまでに待つ時間(ms) */
  afterMs: number
}

/** 中断(agentTerminal:interrupt)の結果。main は固定の 1 バイトを書けたかと、2 回目を頼むかの案内を返す(作業が止まったかは画面の判定で分かる) */
export type AgentInterruptResult =
  | { kind: 'sent'; followUp: AgentInterruptFollowUp | null }
  | { kind: 'no-session' }
  | { kind: 'write-failed' }

/** 中断の 2 回目(agentTerminal:interruptFollowUp)の結果 */
export type AgentInterruptFollowUpResult =
  | { kind: 'sent' }
  /** 2 回目を受け付けていない(2 回目の無い種類・使い切った・早すぎる) */
  | { kind: 'not-pending' }
  /** 1 回目から期限を過ぎた(書かない) */
  | { kind: 'expired' }
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
```

`src/main/agentSession.ts`:

1. import に `import { performance } from 'node:perf_hooks'` と `import type { AgentCliInterruptSpec } from './agentCliInterruptSpecs'` を足す
2. `AGENT_INTERRUPT_SEQUENCE` のコメントを `/** CLI の作業の中断(ターミナルで Esc を押すのと同じ)。回数は種類ごとの表(agentCliInterruptSpecs.ts)。renderer の値を混ぜない固定の 1 バイト */` にする
3. `StopTree` の型の後に次を足す:

```ts
/** 中断の 1 回目の結果。sent の followUp は 2 回目を頼むまでに待つ時間(2 回目の無い種類は null) */
export type AgentSessionInterruptResult =
  | { kind: 'sent'; followUp: { afterMs: number } | null }
  | { kind: 'not-alive' }
  | { kind: 'write-failed' }

/** 中断の 2 回目の結果 */
export type AgentSessionInterruptFollowUpResult =
  | 'sent'
  | 'not-pending'
  | 'expired'
  | 'not-alive'
  | 'write-failed'

/** 単調増加の時刻(performance.now)。AgentSessionParams.now の本番の値(参照が安定した関数) */
export const monotonicNow = (): number => performance.now()
```

4. `AgentSessionParams` に次を足す:

```ts
/** この起動の CLI の中断の送り方(starter が起動の計画の種類で AGENT_CLI_INTERRUPT_SPECS から引く。L-018)。省略できない(L-060) */
interrupt: AgentCliInterruptSpec
/** 単調増加の時刻(ms)。本番は monotonicNow、テストは偽の時計 */
now: () => number
```

5. クラスのフィールドに次を足し、コンストラクタの引数を `{ id, pty, callbacks, stopTree, interrupt, now }` にして `this.interruptSpec = interrupt`・`this.now = now` を入れる:

```ts
  private readonly interruptSpec: AgentCliInterruptSpec
  private readonly now: () => number
  /** 1 回目の中断を書いた時刻。2 回目を受け付けている間だけ値を持つ(1 回で使い切る。停止・終了で消す) */
  private followUpSince: number | null = null
```

6. `finish` の `this.alive = false` の次に `this.followUpSince = null` を、`stop` の先頭（`if (this.stopping !== null)` の前）に `this.followUpSince = null` を足す
7. `interrupt()` を次の 2 つのメソッドに置き換える:

```ts
  /**
   * 作業の中断の 1 回目(Esc を 1 回)を書く。既存の write は打鍵の経路のため書き込みの例外を握って何も返さないが、中断は結果を返す
   * (L-001)。停止の途中(stop の後、終了の前)は止めている pty に送らない。2 回目の要る種類(copilot)なら、書いた時刻を控えて
   * 2 回目の依頼を受け付け、待つ時間を返す(前の控えは上書き)。pty.write は同期で返り、CLI の反応は待たない(L-052)
   */
  interrupt(): AgentSessionInterruptResult {
    if (!this.alive || this.stopping !== null) return { kind: 'not-alive' }
    // 書けなかった 1 回目の後に、前の控えで 2 回目を書かない
    this.followUpSince = null
    try {
      this.pty.write(AGENT_INTERRUPT_SEQUENCE)
    } catch {
      return { kind: 'write-failed' }
    }
    const followUp = this.interruptSpec.followUp
    if (followUp === null) return { kind: 'sent', followUp: null }
    this.followUpSince = this.now()
    return { kind: 'sent', followUp: { afterMs: followUp.afterMs } }
  }

  /**
   * 作業の中断の 2 回目(renderer が画面を確かめ直してから頼む)。控えは 1 回で使い切る(先に読み出して null に戻す)。控えが無い
   * (2 回目の無い種類・使い切った・同じセッションへの 2 回目の依頼)か、1 回目から afterMs 未満(2 回を 1 つの読み取りに詰めて
   * 送らないための守り)なら not-pending、deadlineMs を過ぎたら expired(CLI の 2 回の窓を外れるので書かない)。
   * 回数・間隔・期限は main の表だけが決める(L-019)
   */
  interruptFollowUp(): AgentSessionInterruptFollowUpResult {
    const since = this.followUpSince
    this.followUpSince = null
    if (!this.alive || this.stopping !== null) return 'not-alive'
    const followUp = this.interruptSpec.followUp
    if (since === null || followUp === null) return 'not-pending'
    const elapsed = this.now() - since
    if (elapsed < followUp.afterMs) return 'not-pending'
    if (elapsed > followUp.deadlineMs) return 'expired'
    try {
      this.pty.write(AGENT_INTERRUPT_SEQUENCE)
      return 'sent'
    } catch {
      return 'write-failed'
    }
  }
```

8. `StartAgentSessionParams` に `interrupt: AgentCliInterruptSpec` と `now: () => number` を足し（コメントは `AgentSessionParams` と同じ）、`startAgentSession` の引数の分割に `interrupt, now` を足して `return new AgentSession({ id, pty, callbacks, stopTree, interrupt, now })` にする

- [ ] **Step 6: starter・registry・受け口・preload・renderer の窓口を実装する**

`src/main/agentSessionStarter.ts`:

- import の `import { startAgentSession } from './agentSession'` を `import { monotonicNow, startAgentSession } from './agentSession'` にし、`import { AGENT_CLI_INTERRUPT_SPECS } from './agentCliInterruptSpecs'` を足す
- `spawnSession` の `startAgentSession({` の引数の `stopTree,` の後に次を足す:

```ts
        // 中断の送り方は起動の計画の種類で引き、設定を読み直さない(L-018)
        interrupt: AGENT_CLI_INTERRUPT_SPECS[plan.cliKind],
        now: monotonicNow,
```

`src/main/agentSessionRegistry.ts`:

- import を `import type { AgentExitReason, AgentInterruptFollowUpResult, AgentInterruptResult, AgentStartResult } from '@shared/types'` にする
- `interrupt` の `if (result === 'sent') return { kind: 'sent' }` と次の行を次にする:

```ts
if (result.kind === 'sent') return { kind: 'sent', followUp: result.followUp }
return result.kind === 'not-alive' ? { kind: 'no-session' } : { kind: 'write-failed' }
```

- `interrupt` の後に次を足す:

```ts
  /**
   * 中断の 2 回目。照合は write・interrupt と同じ(所有者の枠の現在のセッションとの一致。停止中・別のウィンドウ・起動し直す前の
   * 古い sessionId は no-session。L-037)。セッションの not-alive は no-session に写し、ほかの結果はそのまま返す
   */
  interruptFollowUp(ownerId: number, sessionId: string): AgentInterruptFollowUpResult {
    const session = this.findBySessionId(ownerId, sessionId)?.session
    if (session === undefined) return { kind: 'no-session' }
    const result = session.interruptFollowUp()
    return { kind: result === 'not-alive' ? 'no-session' : result }
  }
```

`src/main/handlers/agentTerminalHandlers.ts`:

- import の型に `AgentInterruptFollowUpResult` を足す
- `AgentTerminalHandlerDeps.registry` を `Pick<AgentSessionRegistry, 'write' | 'resize' | 'stop' | 'snapshot' | 'interrupt' | 'interruptFollowUp'>` にし、コメントを `/** 書き込み・リサイズ・停止・中断(1 回目と 2 回目)・状態の取得の相手(所有者・枠ごとのセッション) */` にする
- `agentTerminal:interrupt` の受け口のコメントの `(claude に Esc を 1 回)` を `(CLI に Esc を 1 回。2 回目の要る種類は結果の followUp で案内する)` にし、その受け口の後に次を足す:

```ts
// 中断の 2 回目(copilot)。renderer からは sessionId だけを受け取り、書くバイト列・回数・時間は main の表とセッションの控えで
// 決める(L-019)。控えが無ければ書かないので、renderer が 2 回目だけを繰り返し呼んでも余分な Esc は届かない
ipcMain.handle(
  'agentTerminal:interruptFollowUp',
  (event: IpcMainInvokeEvent, sessionId: unknown): AgentInterruptFollowUpResult => {
    if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
    return registry.interruptFollowUp(event.sender.id, parseAgentSessionId(sessionId))
  }
)
```

`src/preload/api.ts`: import の型に `AgentInterruptFollowUpResult` を足し、`interruptAgentSession` の後に次を足す（`interruptAgentSession` のコメントの `(claude に Esc を 1 回)` は `(1 回目)` にする）:

```ts
  // 中断の 2 回目(copilot)。引数は sessionId だけで、書くバイト列・回数・時間は main が決める
  interruptAgentSessionFollowUp: (sessionId: string): Promise<AgentInterruptFollowUpResult> =>
    ipcRenderer.invoke('agentTerminal:interruptFollowUp', sessionId),
```

`src/preload/index.d.ts`: import の型に `AgentInterruptFollowUpResult` を足し、`interruptAgentSession(sessionId: string): Promise<AgentInterruptResult>` の次に `interruptAgentSessionFollowUp(sessionId: string): Promise<AgentInterruptFollowUpResult>` を足す。

`src/renderer/src/lib/agentTerminalApi.ts`: import の型に `AgentInterruptFollowUpResult` を足し、`interruptAgentSession` のコメントを `/** 中断の 1 回目(作業を止める。ターミナルで Esc を押すのと同じ)。2 回目の要る種類は結果の followUp で案内される。書くバイト列は main が決める */` にして、その後に次を足す:

```ts
/** 中断の 2 回目(copilot。renderer が画面を確かめ直してから頼む)。書くバイト列・回数・時間は main が決める */
export function interruptAgentSessionFollowUp(
  sessionId: string
): Promise<AgentInterruptFollowUpResult> {
  return window.api.interruptAgentSessionFollowUp(sessionId)
}
```

`src/renderer/src/__tests__/setup.ts`: `interruptAgentSession: () => Promise.resolve({ kind: 'sent' }),` を `interruptAgentSession: () => Promise.resolve({ kind: 'sent', followUp: null }),` にし、その次に `interruptAgentSessionFollowUp: () => Promise.resolve({ kind: 'not-pending' }),` を足す（`vi.spyOn(window.api, 'interruptAgentSessionFollowUp')` で差し替えられるように）。

- [ ] **Step 7: テストが通ることを確かめる**

Run: Step 4 と同じコマンドに `src/main/__tests__/agentCliLaunch.integration.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` を足して流す
Expected: PASS（統合テストは macOS で走る。時間切れなら単体で流し直す）
Run: `npm run typecheck`
Expected: PASS（`new AgentSession`・`startAgentSession` の呼び出しで `interrupt`・`now` が無いものが残れば型エラーになる。テストは `...CLAUDE_INTERRUPT` を足す）
Run: `pgrep -fl amt-test- || true`
Expected: 何も出ない（統合テストの子が残っていない）

- [ ] **Step 8: 変異で確かめる**

1. `agentSession.ts` の `if (elapsed < followUp.afterMs) return 'not-pending'` を消す → `1 回目から 99ms では not-pending…` と `控えは 1 回で使い切る…` が落ちる。戻す
2. `if (elapsed > followUp.deadlineMs) return 'expired'` を消す → `…401ms では expired で書かない` が落ちる。戻す
3. `interruptFollowUp` の先頭の `this.followUpSince = null` を消す → `控えは 1 回で使い切る…` が落ちる。戻す
4. `agentSessionStarter.ts` の `interrupt: AGENT_CLI_INTERRUPT_SPECS[plan.cliKind]` を `interrupt: AGENT_CLI_INTERRUPT_SPECS.claude` にする → `copilot の計画で起動したセッションの中断は、2 回目の案内…` が落ちる。戻す
5. `AGENT_CLI_INTERRUPT_SPECS.copilot` の `afterMs: 100` を `afterMs: 0` にする → `agentCliInterruptSpecs.test.ts` の 2 つが落ちる。戻す
6. `git diff src/main/agentSession.ts src/main/agentSessionStarter.ts` がこのタスクで入れた差分だけで、`grep -n "afterMs: 100, deadlineMs: 400" src/main/agentCliInterruptSpecs.ts` が 1 行出ることを確かめる

- [ ] **Step 9: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/main/agentCliInterruptSpecs.ts src/main/agentSession.ts src/main/agentSessionStarter.ts src/main/agentSessionRegistry.ts src/main/handlers/agentTerminalHandlers.ts src/shared/types/agentTerminal.ts src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/agentTerminalApi.ts src/renderer/src/__tests__/setup.ts src/main/__tests__/agentCliInterruptSpecs.test.ts src/main/__tests__/agentSession.test.ts src/main/__tests__/agentSessionRegistry.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/agentSession.integration.test.ts src/main/__tests__/agentCliLaunch.integration.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み（外れたら同じファイルを明示して `npx prettier --write` で直す）

---

### Task 5: 中断の renderer（種類ごとの文言・2 回目の流れ・配線）

> **設計書の読む節:** 「中断の流れ」の renderer（押せるかの判定と押した処理。手順 1〜9）・「2 回目の前の危険と、残る危険」・「中断の後の記録・連打・待ち」・「新しい状態と既存の入口（L-061）」、「文言」のすべて、「エラー処理」の renderer の列、「テスト方針」の renderer の中断と配線。
>
> **気をつける知見:** L-001（2 回目まで送れたときだけ「中断を送りました」と読み上げ、頼まなかったときはその旨を読み上げる）・L-037（2 回目は 1 回目の `sessionId` に結び付け、頼む前と結果が届いた時点でタブの `sessionId` と閉じる途中を確かめる）・L-041（押した時点と 2 回目の直前に、タブの種類の規則で画面を確かめる）・L-052（2 回目を待つタイマーはアンマウントで消し、頼まない）・L-055（`Promise.resolve().then` で同期の例外を拒否として扱う）・L-157（`aria-disabled` でフォーカスを残す作りは変えない）・L-408（1,000ms の待ち・同期の再入の防止〈2 回目まで続ける〉・ダブルクリックとキーリピートの無視を組のまま使い、2 回目の流れが終わった時点で待ちを数え直す）・L-060・L-061（`interruptFollowUp` を必須にし、配線のテストと受け渡しを外す変異で確かめる）

**Files:**

- Modify: `src/renderer/src/lib/agentInterruptMessages.ts`・`src/renderer/src/lib/agentInterrupt.ts`・`src/renderer/src/hooks/useAgentSessions.ts`・`src/renderer/src/hooks/useAgentInterruptCooldown.ts`・`src/renderer/src/hooks/useAgentInterrupt.ts`・`src/renderer/src/hooks/useAgentWorkspace.ts`・`src/renderer/src/components/agent/AgentTerminalPanel.tsx`・`src/renderer/src/__tests__/makeAgentSessionsState.ts`
- Test: `src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts`・`src/renderer/src/lib/__tests__/agentInterrupt.test.ts`・`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`・`src/renderer/src/hooks/__tests__/useAgentInterruptCooldown.test.ts`・`src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts`・`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`

**Interfaces:**

- Consumes: `classifyAgentScreenFor`（Task 2）、`copilotScreen`（Task 1）、`UseAgentActivityOptions.classify` の `(kind, lines)`（Task 3）、`AgentInterruptResult`・`AgentInterruptFollowUpResult`・`agentTerminalApi.interruptAgentSessionFollowUp`（Task 4）
- Produces:

```ts
// src/renderer/src/lib/agentInterruptMessages.ts
export const AGENT_INTERRUPT_KEY_TEXTS: Record<AgentCliKind, AgentInterruptKeyTexts>
export function agentInterruptAriaLabel(kind: AgentCliKind): string
export function agentInterruptNotRunningReason(commandName: string): string
export function agentInterruptBlockedByActivityReason(
  activity: Exclude<AgentActivity, 'working'>,
  kind: AgentCliKind
): string
export function agentInterruptSentNotice(label: string, kind: AgentCliKind): string
export function agentInterruptFollowUpSkippedNotice(
  label: string,
  activity: Exclude<AgentActivity, 'working'>
): string
export function agentInterruptNoSessionError(commandName: string): string
export const AGENT_INTERRUPT_ERROR_FOLLOW_UP_EXPIRED: string
export const AGENT_INTERRUPT_ERROR_FOLLOW_UP_NOT_PENDING: string
// 消すもの: AGENT_INTERRUPT_NOT_RUNNING・AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY・AGENT_INTERRUPT_ERROR_NO_SESSION
// src/renderer/src/lib/agentInterrupt.ts
export function describeAgentInterruptBlockedByActivity(
  activity: Exclude<AgentActivity, 'working'>,
  cliKind: AgentCliKind
): string
export type AgentInterruptFollowUpCheck =
  | { kind: 'send' }
  | { kind: 'skip'; activity: Exclude<AgentActivity, 'working'> }
  | { kind: 'unreadable'; error: unknown }
export function checkAgentInterruptFollowUp(
  cliKind: AgentCliKind,
  readScreen: () => readonly ViewportLine[]
): AgentInterruptFollowUpCheck
// src/renderer/src/hooks/useAgentSessions.ts
export type AgentInterruptOutcome =
  | { kind: 'sent'; followUp: { afterMs: number; sessionId: string } | null }
  | { kind: 'skipped' }
  | { kind: 'stale' }
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
  | { kind: 'error'; message: string }
export type AgentInterruptFollowUpOutcome =
  | { kind: 'sent' }
  | { kind: 'stale' }
  | { kind: 'not-pending' }
  | { kind: 'expired' }
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
  | { kind: 'error'; message: string }
// AgentSessionsState に interruptFollowUp: (slotId: string, sessionId: string) => Promise<AgentInterruptFollowUpOutcome>(必須)
// src/renderer/src/hooks/useAgentInterrupt.ts
// UseAgentInterruptOptions に interruptFollowUp: (slotId: string, sessionId: string) => Promise<AgentInterruptFollowUpOutcome>(必須)
// src/renderer/src/hooks/useAgentInterruptCooldown.ts
// AgentInterruptCooldown に restartCooldown: (slotId: string) => void
```

- [ ] **Step 1: 失敗するテストを書く（文言）**

`src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts` を次の内容に書き直す（`claude` の文言が今と同じことを含む）:

```ts
import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import { AGENT_STOP_ERROR_PREFIX, formatAgentTabLabel } from '../agentSessionMessages'
import {
  AGENT_INTERRUPT_DISABLED_CLOSING,
  AGENT_INTERRUPT_DISABLED_COOLDOWN,
  AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  AGENT_INTERRUPT_DISABLED_SENDING,
  AGENT_INTERRUPT_DISABLED_STARTING,
  AGENT_INTERRUPT_ERROR_FOLLOW_UP_EXPIRED,
  AGENT_INTERRUPT_ERROR_FOLLOW_UP_NOT_PENDING,
  AGENT_INTERRUPT_ERROR_PREFIX,
  AGENT_INTERRUPT_ERROR_WRITE_FAILED,
  AGENT_INTERRUPT_KEY_TEXTS,
  AGENT_INTERRUPT_LABEL,
  agentInterruptAriaLabel,
  agentInterruptBlockedByActivityReason,
  agentInterruptError,
  agentInterruptFollowUpSkippedNotice,
  agentInterruptNoSessionError,
  agentInterruptNotRunningReason,
  agentInterruptSentNotice,
  agentInterruptUnsupportedReason
} from '../agentInterruptMessages'

describe('中断の文言(設計書 2026-10-19「画面」「エラー処理」・2026-10-21「文言」)', () => {
  it('種類の一覧のすべてに押すキーの文言がある', () => {
    expect(Object.keys(AGENT_INTERRUPT_KEY_TEXTS).sort()).toEqual([...AGENT_CLI_KINDS].sort())
  })

  it('ボタンの名前は見える文字「中断」で始め、押すキーは種類で変わる(パターン 76。copilot の回数は main の agentCliInterruptSpecs.ts と合わせる)', () => {
    expect(AGENT_INTERRUPT_LABEL).toBe('中断')
    expect(agentInterruptAriaLabel('claude')).toBe('中断（作業中の claude に Esc を送る）')
    expect(agentInterruptAriaLabel('copilot')).toBe('中断（作業中の copilot に Esc を 2 回送る）')
    for (const kind of AGENT_CLI_KINDS) {
      expect(agentInterruptAriaLabel(kind).startsWith(AGENT_INTERRUPT_LABEL)).toBe(true)
    }
  })

  it('CLI に依らない押せない理由(今のまま)', () => {
    expect(AGENT_INTERRUPT_DISABLED_STARTING).toBe('起動中は中断できません')
    expect(AGENT_INTERRUPT_DISABLED_CLOSING).toBe('閉じる途中のタブは中断できません')
    expect(AGENT_INTERRUPT_DISABLED_SENDING).toBe('プロンプトを送信している間は中断できません')
    expect(AGENT_INTERRUPT_DISABLED_SEND_CONFIRM).toBe('送信前の確認を開いている間は中断できません')
    expect(AGENT_INTERRUPT_DISABLED_COOLDOWN).toBe(
      '中断を送りました。まだ作業中なら、少し待つと押せます'
    )
  })

  it('動いていない理由は CLI の名前で作る', () => {
    expect(agentInterruptNotRunningReason('claude')).toBe('claude が動いていないため中断できません')
    expect(agentInterruptNotRunningReason('copilot')).toBe(
      'copilot が動いていないため中断できません'
    )
  })

  it('活動の理由: claude は今と同じ', () => {
    expect(agentInterruptBlockedByActivityReason('permission', 'claude')).toBe(
      '許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）'
    )
    expect(agentInterruptBlockedByActivityReason('confirm', 'claude')).toBe(
      '確認待ちのため中断できません（ターミナルで選んでください）'
    )
    expect(agentInterruptBlockedByActivityReason('idle', 'claude')).toBe(
      '入力待ちのため、中断する作業がありません'
    )
    expect(agentInterruptBlockedByActivityReason('unknown', 'claude')).toBe(
      '作業中か判定できないため押せません（ターミナルで Esc を押すと中断できます）'
    )
  })

  it('活動の理由: copilot は許可待ち・判定できないの文言だけが違い、確認待ち・入力待ちは同じ', () => {
    expect(agentInterruptBlockedByActivityReason('permission', 'copilot')).toBe(
      '許可待ちのため中断できません（Esc は操作の取り消しになります。ターミナルで答えてください）'
    )
    expect(agentInterruptBlockedByActivityReason('unknown', 'copilot')).toBe(
      '作業中か判定できないため押せません（ターミナルで Esc を続けて 2 回押すと中断できます）'
    )
    expect(agentInterruptBlockedByActivityReason('confirm', 'copilot')).toBe(
      agentInterruptBlockedByActivityReason('confirm', 'claude')
    )
    expect(agentInterruptBlockedByActivityReason('idle', 'copilot')).toBe(
      agentInterruptBlockedByActivityReason('idle', 'claude')
    )
  })

  it('送れたときの読み上げは、押した時点のタブのラベルと種類の押すキーで作る', () => {
    expect(agentInterruptSentNotice('claude 1', 'claude')).toBe(
      'claude 1 に中断（Esc）を送りました'
    )
    expect(agentInterruptSentNotice(formatAgentTabLabel(3, 'claude'), 'claude')).toBe(
      'claude 3 に中断（Esc）を送りました'
    )
    expect(agentInterruptSentNotice('copilot 1', 'copilot')).toBe(
      'copilot 1 に中断（Esc を 2 回）を送りました'
    )
  })

  it.each(['idle', 'permission', 'confirm'] as const)(
    '2 回目を頼まなかった読み上げ(%s): 作業中でなくなった旨',
    (activity) => {
      expect(agentInterruptFollowUpSkippedNotice('copilot 1', activity)).toBe(
        'copilot 1 が作業中でなくなったため、2 回目の Esc は送りませんでした'
      )
    }
  )

  it('2 回目を頼まなかった読み上げ(unknown): 判定できなかった旨と、待ってから押し直す案内', () => {
    expect(agentInterruptFollowUpSkippedNotice('copilot 1', 'unknown')).toBe(
      'copilot 1 が作業中か判定できなかったため、2 回目の Esc は送りませんでした（まだ作業中なら、少し待ってからもう一度押してください）'
    )
  })

  it('失敗の文言は接頭辞で始める(成功のときに中断の失敗だけを消すため)', () => {
    expect(AGENT_INTERRUPT_ERROR_PREFIX).toBe('中断を送れませんでした: ')
    expect(agentInterruptNoSessionError('claude')).toBe(
      '中断を送れませんでした: claude が終了したか、起動し直しました'
    )
    expect(agentInterruptNoSessionError('copilot')).toBe(
      '中断を送れませんでした: copilot が終了したか、起動し直しました'
    )
    expect(AGENT_INTERRUPT_ERROR_WRITE_FAILED).toBe(
      '中断を送れませんでした: ターミナルへの書き込みに失敗しました'
    )
    expect(AGENT_INTERRUPT_ERROR_FOLLOW_UP_EXPIRED).toBe(
      '中断を送れませんでした: 2 回目の Esc が間に合いませんでした（まだ作業中なら、もう一度押してください）'
    )
    expect(AGENT_INTERRUPT_ERROR_FOLLOW_UP_NOT_PENDING).toBe(
      '中断を送れませんでした: 2 回目の Esc を送れる状態ではありませんでした（まだ作業中なら、もう一度押してください）'
    )
    expect(agentInterruptError('ipc down')).toBe('中断を送れませんでした: ipc down')
    // 終了の失敗の接頭辞とは別(中断が成功しても、終了の失敗の文言は消さない)
    expect(AGENT_STOP_ERROR_PREFIX.startsWith(AGENT_INTERRUPT_ERROR_PREFIX)).toBe(false)
  })
})

describe('中断に対応しない CLI の理由(agentInterruptUnsupportedReason)', () => {
  it('選択中のタブの CLI の名前で作る(能力の表で中断が無い種類に使う)', () => {
    expect(agentInterruptUnsupportedReason('copilot')).toBe(
      'copilot では中断のボタンを使えません（ターミナルで操作してください）'
    )
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（押せるかの判定・2 回目の前の確かめ）**

`src/renderer/src/lib/__tests__/agentInterrupt.test.ts`:

1. 消す定数の使い方を関数にする（import の行には当たらないパターンだけを使う）:

```bash
cd <repo-root>
T=src/renderer/src/lib/__tests__/agentInterrupt.test.ts
test -f "$T" || echo "missing $T"
perl -pi -e 's/AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY\[([\w.]+)\]/agentInterruptBlockedByActivityReason($1, \x27claude\x27)/g; s/AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY\.(\w+)/agentInterruptBlockedByActivityReason(\x27$1\x27, \x27claude\x27)/g; s/AGENT_INTERRUPT_NOT_RUNNING(?!,)/agentInterruptNotRunningReason(\x27claude\x27)/g' "$T"
grep -n "AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY\|AGENT_INTERRUPT_NOT_RUNNING" "$T"
```

Expected: `missing` が出ず、`grep` は import の 2 行（`  AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY,`・`  AGENT_INTERRUPT_NOT_RUNNING,`）だけを出す

2. `../agentInterruptMessages` の import の `AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY,` と `AGENT_INTERRUPT_NOT_RUNNING,` を消し、`agentInterruptBlockedByActivityReason,` と `agentInterruptNotRunningReason,` を足す。`../agentInterrupt` の import に `checkAgentInterruptFollowUp` を足し、`import { copilotScreen } from './fixtures/copilotScreens'` と `import { makeLine } from './fixtures/agentScreens'`（`agentScreen` の import に並べる）を足す
3. `describe('describeAgentInterruptBlockedByActivity', …)` の全体を次に置き換える（置き換えの後は同じ式を比べるだけになるため）:

```ts
describe('describeAgentInterruptBlockedByActivity', () => {
  it.each(['idle', 'permission', 'confirm', 'unknown'] as const)(
    '%s の理由は、タブの種類の文言の表から作る',
    (activity) => {
      for (const kind of ['claude', 'copilot'] as const) {
        expect(describeAgentInterruptBlockedByActivity(activity, kind)).toBe(
          agentInterruptBlockedByActivityReason(activity, kind)
        )
      }
    }
  )
})
```

4. 能力の表を差し替えた `describe`（Task 3 で題を変えたもの）の `it.each(['none', 'exited'] as const)('copilot の %s は出さない', …)` の中の `reason: agentInterruptNotRunningReason('claude')` を `reason: agentInterruptNotRunningReason('copilot')` にする（動いていない理由はタブの種類の名前）
5. ファイルの最後に次を足す:

```ts
describe('checkAgentInterruptAtPress(タブの種類の規則で読む)', () => {
  const COPILOT_RUNNING: AgentInterruptAvailabilityInput = {
    ...RUNNING_WORKING,
    cliKind: 'copilot'
  }

  it('copilot の作業中の台帳の画面は、copilot のタブとして渡すと send', () => {
    expect(
      checkAgentInterruptAtPress(COPILOT_RUNNING, () => copilotScreen('working3000').lines)
    ).toEqual({ kind: 'send' })
  })

  it('同じ画面を claude のタブとして渡すと blocked(claude の規則では入力待ち)', () => {
    expect(
      checkAgentInterruptAtPress(RUNNING_WORKING, () => copilotScreen('working3000').lines)
    ).toEqual({ kind: 'blocked', reason: agentInterruptBlockedByActivityReason('idle', 'claude') })
  })

  it('copilot の許可の確認の画面は、copilot の許可待ちの理由で blocked', () => {
    expect(
      checkAgentInterruptAtPress(COPILOT_RUNNING, () => copilotScreen('permission').lines)
    ).toEqual({
      kind: 'blocked',
      reason: agentInterruptBlockedByActivityReason('permission', 'copilot')
    })
  })

  it('copilot の動いていないタブの理由は copilot の名前', () => {
    expect(getAgentInterruptAvailability({ ...COPILOT_RUNNING, status: 'exited' })).toEqual({
      visible: false,
      reason: agentInterruptNotRunningReason('copilot')
    })
  })
})

describe('checkAgentInterruptFollowUp(2 回目の前の確かめ)', () => {
  it('画面が作業中なら send', () => {
    expect(
      checkAgentInterruptFollowUp('copilot', () => copilotScreen('working3000').lines)
    ).toEqual({
      kind: 'send'
    })
  })

  it.each<[string, () => readonly ViewportLine[], AgentActivity]>([
    ['入力待ち(台帳の done)', () => copilotScreen('done').lines, 'idle'],
    ['許可待ち(台帳の permission)', () => copilotScreen('permission').lines, 'permission'],
    [
      '判定できない(帯が空の手書きの画面)',
      () => ['─'.repeat(100), '❯', '─'.repeat(100)].map((text) => makeLine(text)),
      'unknown'
    ]
  ])('画面が %s なら skip と活動', (_name, readScreen, activity) => {
    expect(checkAgentInterruptFollowUp('copilot', readScreen)).toEqual({ kind: 'skip', activity })
  })

  it('タブの種類の規則で読む(copilot の作業中の画面も claude の規則では skip)', () => {
    expect(
      checkAgentInterruptFollowUp('claude', () => copilotScreen('working3000').lines).kind
    ).toBe('skip')
  })

  it('画面を読めなければ unreadable と例外を返す(投げない)', () => {
    const error = new Error('disposed')
    expect(
      checkAgentInterruptFollowUp('copilot', () => {
        throw error
      })
    ).toEqual({ kind: 'unreadable', error })
  })
})
```

- [ ] **Step 3: 失敗するテストを書く（useAgentSessions）**

`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`:

1. `describe('useAgentSessions — 中断(interrupt)', …)` の `expect(await interruptNow(result)).toEqual({ kind: 'sent' })` を `expect(await interruptNow(result)).toEqual({ kind: 'sent', followUp: null })` にする
2. 同じ `describe` の最後に次を足す:

```ts
it('main の sent の followUp に、送ったセッションの sessionId を添えて返す', async () => {
  const { result } = render()
  await startS1(result)
  mockInterrupt.mockResolvedValueOnce({ kind: 'sent', followUp: { afterMs: 100 } })
  expect(await interruptNow(result)).toEqual({
    kind: 'sent',
    followUp: { afterMs: 100, sessionId: 's1' }
  })
})

it('copilot のタブの no-session の文言は copilot の名前', async () => {
  const { result } = render()
  mockStart.mockResolvedValueOnce({
    kind: 'started',
    sessionId: 's1',
    cliKind: 'copilot',
    claudeSessionId: null
  })
  await startSelected(result)
  mockInterrupt.mockResolvedValueOnce({ kind: 'no-session' })
  await interruptNow(result)
  expect(result.current.selected.error).toBe(
    '中断を送れませんでした: copilot が終了したか、起動し直しました'
  )
})
```

3. その `describe` の後に次を足す:

```ts
describe('useAgentSessions — 中断の 2 回目(interruptFollowUp)', () => {
  const mockFollowUp = vi.mocked(agentTerminalApi.interruptAgentSessionFollowUp)

  const startCopilotS1 = async (result: Rendered['result']): Promise<void> => {
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's1',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    await startSelected(result)
  }

  const followUpNow = async (
    result: Rendered['result'],
    slotId = 'slot-1',
    sessionId = 's1'
  ): Promise<AgentInterruptFollowUpOutcome | undefined> => {
    let outcome: AgentInterruptFollowUpOutcome | undefined
    await act(async () => {
      outcome = await result.current.interruptFollowUp(slotId, sessionId)
    })
    return outcome
  }

  it('そのタブの今のセッションの sessionId だけを渡して sent を返し、中断の失敗の文言を消す', async () => {
    const { result } = render()
    await startCopilotS1(result)
    mockFollowUp.mockResolvedValueOnce({ kind: 'expired' })
    await followUpNow(result)
    mockFollowUp.mockResolvedValueOnce({ kind: 'sent' })
    expect(await followUpNow(result)).toEqual({ kind: 'sent' })
    expect(mockFollowUp).toHaveBeenLastCalledWith('s1')
    expect(result.current.selected.error).toBeNull()
  })

  it('渡した sessionId がそのタブの今のセッションと違えば、IPC を呼ばず stale(L-037)', async () => {
    const { result } = render()
    await startCopilotS1(result)
    expect(await followUpNow(result, 'slot-1', 's-old')).toEqual({ kind: 'stale' })
    expect(mockFollowUp).not.toHaveBeenCalled()
  })

  it('閉じる途中のタブは、IPC を呼ばず stale', async () => {
    const { result } = render({ onConfirm: () => true })
    await runTwoTabs(result)
    let releaseStop: () => void = () => undefined
    mockStop.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseStop = resolve
      })
    )
    let closing: Promise<boolean> | undefined
    act(() => {
      closing = result.current.closeTab('slot-2')
    })
    expect(await followUpNow(result, 'slot-2', 's-2')).toEqual({ kind: 'stale' })
    expect(mockFollowUp).not.toHaveBeenCalled()
    await act(async () => {
      releaseStop()
      await closing
    })
  })

  it('結果を待つ間に終了して起動し直したら stale で、新しいセッションのタブに何も出さない', async () => {
    const { result } = render()
    await startCopilotS1(result)
    let resolvePending: (value: AgentInterruptFollowUpResult) => void = () => undefined
    mockFollowUp.mockReturnValueOnce(
      new Promise<AgentInterruptFollowUpResult>((resolve) => {
        resolvePending = resolve
      })
    )
    let outcome: Promise<AgentInterruptFollowUpOutcome> | undefined
    act(() => {
      outcome = result.current.interruptFollowUp('slot-1', 's1')
    })
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    mockStart.mockResolvedValueOnce({
      kind: 'started',
      sessionId: 's2',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    await startSelected(result)
    let settled: AgentInterruptFollowUpOutcome | undefined
    await act(async () => {
      resolvePending({ kind: 'no-session' })
      settled = await outcome
    })
    expect(settled).toEqual({ kind: 'stale' })
    expect(result.current.selected.error).toBeNull()
  })

  it.each<[AgentInterruptFollowUpResult, string]>([
    [
      { kind: 'not-pending' },
      '中断を送れませんでした: 2 回目の Esc を送れる状態ではありませんでした（まだ作業中なら、もう一度押してください）'
    ],
    [
      { kind: 'expired' },
      '中断を送れませんでした: 2 回目の Esc が間に合いませんでした（まだ作業中なら、もう一度押してください）'
    ],
    [{ kind: 'no-session' }, '中断を送れませんでした: copilot が終了したか、起動し直しました'],
    [{ kind: 'write-failed' }, '中断を送れませんでした: ターミナルへの書き込みに失敗しました']
  ])('%o はそのタブの error に出して、そのまま返す', async (ipcResult, message) => {
    const { result } = render()
    await startCopilotS1(result)
    mockFollowUp.mockResolvedValueOnce(ipcResult)
    expect(await followUpNow(result)).toEqual(ipcResult)
    expect(result.current.selected.error).toBe(message)
  })

  it('invoke の拒否は、接頭辞に例外の message を付けて error に出し、error を返す', async () => {
    const { result } = render()
    await startCopilotS1(result)
    mockFollowUp.mockRejectedValueOnce(new Error('ipc down'))
    expect(await followUpNow(result)).toEqual({ kind: 'error', message: 'ipc down' })
    expect(result.current.selected.error).toBe('中断を送れませんでした: ipc down')
  })

  it('window.api の呼び出しが同期で投げても、拒否と同じに扱う(L-055)', async () => {
    const { result } = render()
    await startCopilotS1(result)
    mockFollowUp.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(await followUpNow(result)).toEqual({ kind: 'error', message: 'boom' })
    expect(result.current.selected.error).toBe('中断を送れませんでした: boom')
  })
})
```

4. import の `useAgentSessions` の型に `AgentInterruptFollowUpOutcome`、`@shared/types` の型に `AgentInterruptFollowUpResult` を足す

- [ ] **Step 4: 失敗するテストを書く（待ちの数え直し・押した処理・ボタンの名前・配線）**

`src/renderer/src/hooks/__tests__/useAgentInterruptCooldown.test.ts`:

- `it('操作の関数は描画をまたいで同じ参照', …)` の期待に `expect(result.current.restartCooldown).toBe(first.restartCooldown)` を足す
- ファイルの最後の `describe` の中に次を足す:

```ts
it('restartCooldown はそのタブの待ちを今から数え直す(前のタイマーを消す。ref と描画の値の両方)', () => {
  const { result } = renderHook(() => useAgentInterruptCooldown())
  act(() => result.current.begin('slot-1'))
  act(() => result.current.finish('slot-1'))
  act(() => {
    vi.advanceTimersByTime(600)
  })
  act(() => result.current.restartCooldown('slot-1'))
  expect(vi.getTimerCount()).toBe(1)
  act(() => {
    vi.advanceTimersByTime(AGENT_INTERRUPT_COOLDOWN_MS - 1)
  })
  expect(result.current.isCoolingDown('slot-1')).toBe(true)
  expect(result.current.isPending('slot-1')).toBe(true)
  act(() => {
    vi.advanceTimersByTime(1)
  })
  expect(result.current.isCoolingDown('slot-1')).toBe(false)
  expect(result.current.isPending('slot-1')).toBe(false)
})

it('restartCooldown はほかのタブの待ちを変えない', () => {
  const { result } = renderHook(() => useAgentInterruptCooldown())
  act(() => result.current.restartCooldown('slot-1'))
  expect(result.current.isCoolingDown('slot-1')).toBe(true)
  expect(result.current.isCoolingDown('slot-2')).toBe(false)
  expect(result.current.isPending('slot-2')).toBe(false)
})

it('アンマウントの後の restartCooldown はタイマーを残さない', () => {
  const { result, unmount } = renderHook(() => useAgentInterruptCooldown())
  unmount()
  result.current.restartCooldown('slot-1')
  expect(vi.getTimerCount()).toBe(0)
})
```

`src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts`:

1. 消す定数・変わる関数を置き換える:

```bash
cd <repo-root>
T=src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts
test -f "$T" || echo "missing $T"
perl -pi -e 's/agentInterruptSentNotice\(\x27claude (\d+)\x27\)/agentInterruptSentNotice(\x27claude $1\x27, \x27claude\x27)/g; s/AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY\.(\w+)/agentInterruptBlockedByActivityReason(\x27$1\x27, \x27claude\x27)/g; s/AGENT_INTERRUPT_NOT_RUNNING(?!,)/agentInterruptNotRunningReason(\x27claude\x27)/g; s/async \(\) => \(\{ kind: \x27sent\x27 \}\)\)/async () => ({ kind: \x27sent\x27, followUp: null }))/g; s/Promise\.resolve\(\{ kind: \x27sent\x27 \}\)/Promise.resolve({ kind: \x27sent\x27, followUp: null })/g; s/pending\.resolve\(\{ kind: \x27sent\x27 \}\)/pending.resolve({ kind: \x27sent\x27, followUp: null })/g' "$T"
grep -n "AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY\|AGENT_INTERRUPT_NOT_RUNNING\|agentInterruptSentNotice('claude [0-9]*')" "$T"
grep -n "kind: 'sent' }" "$T" || echo "none"
```

Expected: 1 つ目の `grep` は import の 2 行だけを出す。2 つ目は `none`（`interrupt` の偽物の値の `{ kind: 'sent' }`〈既定・「待ちはタブごと」の `Promise.resolve`・「結果が … より遅く届く間」の `pending.resolve`〉がすべて `followUp: null` 付きになっている）。import から `AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY,`・`AGENT_INTERRUPT_NOT_RUNNING,` を消し、`agentInterruptBlockedByActivityReason,`・`agentInterruptNotRunningReason,` を足す

2. 型と偽物を足す: `type Props = Omit<UseAgentInterruptOptions, 'interrupt'>` を `type Props = Omit<UseAgentInterruptOptions, 'interrupt' | 'interruptFollowUp'>` にし、`let interrupt …` の次に `let interruptFollowUp: ReturnType<typeof vi.fn<UseAgentInterruptOptions['interruptFollowUp']>>` を足す。`render` の `useAgentInterrupt({ ...p, interrupt })` を `useAgentInterrupt({ ...p, interrupt, interruptFollowUp })` にし、`beforeEach` の `interrupt = …` の次に次を足す:

```ts
interruptFollowUp = vi.fn<UseAgentInterruptOptions['interruptFollowUp']>(async () => ({
  kind: 'sent'
}))
```

3. import に `import { copilotScreen } from '../../lib/__tests__/fixtures/copilotScreens'`・`import type { CopilotScreenName } from '../../lib/__tests__/fixtures/copilotScreens'`・`import { makeLine } from '../../lib/__tests__/fixtures/agentScreens'`・`import type { AgentInterruptFollowUpOutcome } from '../useAgentSessions'`（既存の `AgentInterruptOutcome` の import に並べる）を足す
4. ファイルの最後に次を足す:

```ts
// copilot の実行中のタブ。readScreen は copilot の台帳の画面(既定は作業中)を返す
function copilotTab(
  slotId: string,
  number: number,
  screen: CopilotScreenName = 'working3000'
): AgentSessionTabView {
  const controller = makeFakeController()
  controller.screen = copilotScreen(screen).lines
  return makeAgentSessionTabView({
    slotId,
    number,
    status: 'running',
    cliKind: 'copilot',
    controller
  })
}

const FOLLOW_UP = { afterMs: 100, sessionId: 'sid-1' }

// 偽のタイマーを進め、その間に解決した Promise の続きも流す
const advanceAsync = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useAgentInterrupt(2 回目の要る種類: copilot)', () => {
  let copilot1: AgentSessionTabView

  beforeEach(() => {
    copilot1 = copilotTab('slot-1', 1)
    interrupt.mockResolvedValue({ kind: 'sent', followUp: FOLLOW_UP })
  })

  const renderCopilot = (
    props: Partial<Props> = {}
  ): RenderHookResult<AgentInterruptPanelState, Props> =>
    render({ selected: copilot1, activities: workingOf('slot-1'), ...props })

  it('押すと 1 回目を送り、afterMs の後に画面が作業中なら同じ sessionId で 2 回目を頼み、2 回送ったと読み上げる', async () => {
    const { result } = renderCopilot()
    await press(result)
    expect(interrupt).toHaveBeenCalledExactlyOnceWith('slot-1')
    await advanceAsync(FOLLOW_UP.afterMs - 1)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(result.current.notice).toBeNull()
    await advanceAsync(1)
    expect(interruptFollowUp).toHaveBeenCalledExactlyOnceWith('slot-1', 'sid-1')
    expect(result.current.notice?.text).toBe('copilot 1 に中断（Esc を 2 回）を送りました')
  })

  it('afterMs の間に画面が入力待ち(台帳の done)に変わると 2 回目を頼まず、作業中でなくなった旨を読み上げる', async () => {
    const { result } = renderCopilot()
    await press(result)
    ;(copilot1.controller as FakeController).screen = copilotScreen('done').lines
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe(
      'copilot 1 が作業中でなくなったため、2 回目の Esc は送りませんでした'
    )
  })

  it('afterMs の間に許可の確認(台帳の permission)に変わっても 2 回目を頼まない', async () => {
    const { result } = renderCopilot()
    await press(result)
    ;(copilot1.controller as FakeController).screen = copilotScreen('permission').lines
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe(
      'copilot 1 が作業中でなくなったため、2 回目の Esc は送りませんでした'
    )
  })

  it('判定できない画面(帯が空の手書きの画面)に変わると 2 回目を頼まず、判定できなかった旨を読み上げる', async () => {
    const { result } = renderCopilot()
    await press(result)
    ;(copilot1.controller as FakeController).screen = ['─'.repeat(100), '❯', '─'.repeat(100)].map(
      (text) => makeLine(text)
    )
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe(
      'copilot 1 が作業中か判定できなかったため、2 回目の Esc は送りませんでした（まだ作業中なら、少し待ってからもう一度押してください）'
    )
  })

  it('2 回目の前に画面を読めなければ 2 回目を頼まず、console に記録する', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result } = renderCopilot()
    await press(result)
    ;(copilot1.controller as FakeController).readScreen = () => {
      throw new Error('disposed')
    }
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(result.current.notice).toBeNull()
  })

  it('2 回目を待つ間の同じタブの押し直しは何もしない(同期の再入の防止を 2 回目まで続ける)', async () => {
    const { result } = renderCopilot()
    await press(result)
    await press(result)
    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(result.current.notice).toBeNull()
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).toHaveBeenCalledTimes(1)
  })

  it('待つ間に別のタブを選んでも、2 回目は送った先のタブの画面で確かめて送った先に頼む', async () => {
    const copilot2 = copilotTab('slot-2', 2, 'done')
    const activities = workingOf('slot-1', 'slot-2')
    const { result, rerender } = renderCopilot({ activities })
    await press(result)
    rerender({ selected: copilot2, activities, isSending: false, isSendConfirmOpen: false })
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).toHaveBeenCalledExactlyOnceWith('slot-1', 'sid-1')
    expect(result.current.notice?.text).toBe('copilot 1 に中断（Esc を 2 回）を送りました')
  })

  it('2 回目の流れが終わった時点から 1,000ms の待ちを数え直す(押した時点から数えると、終わった時点から 999ms の間に押せてしまう)', async () => {
    let resolveFollowUp: (value: AgentInterruptFollowUpOutcome) => void = () => undefined
    interruptFollowUp.mockReturnValueOnce(
      new Promise<AgentInterruptFollowUpOutcome>((resolve) => {
        resolveFollowUp = resolve
      })
    )
    const { result } = renderCopilot()
    await press(result)
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).toHaveBeenCalledTimes(1)
    // 押してから 600ms の時点で 2 回目の結果が届く(流れが終わる)
    await advanceAsync(500)
    await act(async () => {
      resolveFollowUp({ kind: 'sent' })
    })
    await advanceAsync(AGENT_INTERRUPT_COOLDOWN_MS - 1)
    expect(result.current.disabledReason).toBe(AGENT_INTERRUPT_DISABLED_COOLDOWN)
    await advanceAsync(1)
    expect(result.current.disabledReason).toBeNull()
  })

  it.each<AgentInterruptFollowUpOutcome>([
    { kind: 'stale' },
    { kind: 'not-pending' },
    { kind: 'expired' },
    { kind: 'no-session' },
    { kind: 'write-failed' },
    { kind: 'error', message: 'x' }
  ])(
    '2 回目の結果が %o なら読み上げない(失敗は useAgentSessions がタブの error に出す)',
    async (outcome) => {
      interruptFollowUp.mockResolvedValueOnce(outcome)
      const { result } = renderCopilot()
      await press(result)
      await advanceAsync(FOLLOW_UP.afterMs)
      expect(result.current.notice).toBeNull()
    }
  )

  it('afterMs の前にアンマウントすると 2 回目を頼まず、タイマーを残さない(L-052)', async () => {
    const { result, unmount } = renderCopilot()
    await press(result)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('claude のタブ(followUp が null)は今までどおり 1 回だけで、2 回目の窓口を呼ばない', async () => {
    interrupt.mockResolvedValue({ kind: 'sent', followUp: null })
    const { result } = render()
    await press(result)
    await advanceAsync(AGENT_INTERRUPT_COOLDOWN_MS)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe('claude 1 に中断（Esc）を送りました')
  })
})
```

`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx` の `it('名前は選択中のタブの種類のコマンド名(設定の種類ではない)', …)` の `toHaveAccessibleName('中断（作業中の copilot に Esc を送る）')` を `toHaveAccessibleName('中断（作業中の copilot に Esc を 2 回送る）')` にし、題を `'名前は選択中のタブの種類で変わる(copilot は Esc を 2 回。設定の種類ではない)'` にする。

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:

1. `agentInterruptSentNotice(label)` を `agentInterruptSentNotice(label, 'claude')` にする
2. Task 3 で入れた `AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY.unknown` を `agentInterruptBlockedByActivityReason('unknown', 'copilot')` にし、import の `AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY` を `agentInterruptBlockedByActivityReason` にする
3. import に `import { copilotScreen } from '../../lib/__tests__/fixtures/copilotScreens'` と `import type { UseAgentNotificationsOptions } from '../useAgentNotifications'` を足す
4. `describe('使う CLI の配線(本物の useAgentSessions。L-060)', …)` の後に次を足す:

```ts
describe('copilot の配線(本物の useAgentSessions・useAgentActivity・useAgentInterrupt・useAgentNotifications。L-060)', () => {
  let startSpy: MockInstance<typeof window.api.startAgentSession> | null = null
  let interruptSpy: MockInstance<typeof window.api.interruptAgentSession> | null = null
  let followUpSpy: MockInstance<typeof window.api.interruptAgentSessionFollowUp> | null = null
  let showSpy: MockInstance<typeof window.api.showAgentNotification> | null = null
  let slotId: string
  // 共有の偽のタブの画面を書き換えるので、終わったら戻す
  let controller: FakeController | null = null
  let originalScreen: FakeController['screen'] | null = null

  beforeEach(async () => {
    const sessions =
      await vi.importActual<typeof import('../useAgentSessions')>('../useAgentSessions')
    const activity =
      await vi.importActual<typeof import('../useAgentActivity')>('../useAgentActivity')
    const notifications = await vi.importActual<typeof import('../useAgentNotifications')>(
      '../useAgentNotifications'
    )
    mockUseAgentSessions.mockImplementation(sessions.useAgentSessions)
    mockUseAgentActivity.mockImplementation(activity.useAgentActivity)
    mockUseAgentNotifications.mockImplementation((options) =>
      notifications.useAgentNotifications(options as UseAgentNotificationsOptions)
    )
    setMode('agent-cli')
    setCliKind('copilot')
    startSpy = vi.spyOn(window.api, 'startAgentSession').mockResolvedValue({
      kind: 'started',
      sessionId: 'sid-copilot',
      cliKind: 'copilot',
      claudeSessionId: null
    })
    interruptSpy = vi
      .spyOn(window.api, 'interruptAgentSession')
      .mockResolvedValue({ kind: 'sent', followUp: { afterMs: 100 } })
    followUpSpy = vi
      .spyOn(window.api, 'interruptAgentSessionFollowUp')
      .mockResolvedValue({ kind: 'sent' })
    showSpy = vi.spyOn(window.api, 'showAgentNotification').mockResolvedValue(undefined)
    const snapshot = getAgentSessionTabs().getSnapshot()
    slotId = snapshot.selectedSlotId
    controller = snapshot.tabs.find((tab) => tab.slotId === slotId)?.controller as FakeController
    originalScreen = controller.screen
    controller.screen = copilotScreen('working3000').lines
  })

  afterEach(() => {
    if (controller !== null && originalScreen !== null) controller.screen = originalScreen
    controller = null
    originalScreen = null
    startSpy?.mockRestore()
    interruptSpy?.mockRestore()
    followUpSpy?.mockRestore()
    showSpy?.mockRestore()
  })

  it('作業中の画面で帯が作業中になり、中断で 1 回目と 2 回目を同じ sessionId で頼み、入力待ちに変わると copilot の名前で通知を頼む', async () => {
    const rendered = renderWorkspace({ folderPath: '/p' })
    const { result } = rendered
    await act(async () => {
      await result.current.agentTerminal.sessions.start(slotId, { kind: 'new' })
    })
    act(() => controller?.emitOutputWritten())
    await waitFor(() => expect(result.current.agentTerminal.activities.get(slotId)).toBe('working'))
    const { label, number } = result.current.agentTerminal.sessions.selected
    expect(label).toBe(`copilot ${number}`)
    await act(async () => {
      result.current.agentTerminal.interrupt.onInterrupt()
    })
    expect(interruptSpy).toHaveBeenCalledExactlyOnceWith('sid-copilot')
    await waitFor(() => expect(followUpSpy).toHaveBeenCalledExactlyOnceWith('sid-copilot'))
    await waitFor(() =>
      expect(result.current.agentTerminal.interrupt.notice?.text).toBe(
        agentInterruptSentNotice(label, 'copilot')
      )
    )
    if (controller !== null) controller.screen = copilotScreen('interrupted').lines
    act(() => controller?.emitOutputWritten())
    await waitFor(() => expect(result.current.agentTerminal.activities.get(slotId)).toBe('idle'))
    await waitFor(() =>
      expect(showSpy).toHaveBeenCalledWith({
        slotId,
        tabNumber: number,
        kind: 'done',
        cliKind: 'copilot'
      })
    )
  })
})
```

- [ ] **Step 5: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts src/renderer/src/lib/__tests__/agentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentInterruptCooldown.test.ts src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: FAIL（新しい文言の関数・`checkAgentInterruptFollowUp`・`interruptFollowUp`・`restartCooldown` が無い・ボタンの名前・2 回目の流れ）

- [ ] **Step 6: 文言と押せるかの判定を実装する**

`src/renderer/src/lib/agentInterruptMessages.ts` を次の内容に書き直す（`claude` の文言は今と同じ）:

```ts
import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentActivity } from './agentActivity'

// 帯の 中断 の文言(ボタンの名前・押せない理由・読み上げ・送れなかったときの文言。設計書 2026-10-19「画面」「エラー処理」、
// 2026-10-21「文言」)。CLI で違う部分(押すキーの説明・許可待ちでの Esc の意味・判定できないときの案内)は種類ごとの表で引き、
// CLI の名前は AGENT_CLI_PROFILES のコマンド名から作る(直書きしない)。押すキーの回数(copilot の `Esc を 2 回`)は main の送り方の表
// (src/main/agentCliInterruptSpecs.ts の AGENT_CLI_INTERRUPT_SPECS)と合わせる(別のプロセスの持ち物なので、それぞれのテストで固定する)。
// 押せるかの判定(どの理由を選ぶかの順)は agentInterrupt.ts に置く

interface AgentInterruptKeyTexts {
  /** aria-label の動作(`Esc を送る`) */
  ariaAction: string
  /** 送れたときの読み上げの括弧の中(`Esc`) */
  sentKeys: string
  /** 判定できないときの、ターミナルでの中断の案内 */
  terminalHint: string
  /** 許可待ちで Esc を押したときの意味 */
  permissionEscEffect: string
}

/** CLI ごとの押すキーの文言。種類を足したときの決め忘れを型エラーにする */
export const AGENT_INTERRUPT_KEY_TEXTS: Record<AgentCliKind, AgentInterruptKeyTexts> = {
  claude: {
    ariaAction: 'Esc を送る',
    sentKeys: 'Esc',
    terminalHint: 'ターミナルで Esc を押すと中断できます',
    permissionEscEffect: '許可の拒否'
  },
  copilot: {
    ariaAction: 'Esc を 2 回送る',
    sentKeys: 'Esc を 2 回',
    terminalHint: 'ターミナルで Esc を続けて 2 回押すと中断できます',
    permissionEscEffect: '操作の取り消し'
  }
}

const commandNameOf = (kind: AgentCliKind): string => AGENT_CLI_PROFILES[kind].commandName

/** 帯の中断のボタン(選択中のタブの CLI に Esc を送る。設計書 2026-10-19「画面」) */
export const AGENT_INTERRUPT_LABEL = '中断'
/** 帯の 中断 の aria-label。可視の文言「中断」で始める(パターン 76)。kind は選択中のタブの種類 */
export function agentInterruptAriaLabel(kind: AgentCliKind): string {
  return `${AGENT_INTERRUPT_LABEL}（作業中の ${commandNameOf(kind)} に ${AGENT_INTERRUPT_KEY_TEXTS[kind].ariaAction}）`
}
/** セッションが無い・終了した(帯には出さないが、押した処理の判定でも同じ純関数を使うため理由を持つ) */
export function agentInterruptNotRunningReason(commandName: string): string {
  return `${commandName} が動いていないため中断できません`
}
export const AGENT_INTERRUPT_DISABLED_STARTING = '起動中は中断できません'
export const AGENT_INTERRUPT_DISABLED_CLOSING = '閉じる途中のタブは中断できません'
export const AGENT_INTERRUPT_DISABLED_SENDING = 'プロンプトを送信している間は中断できません'
export const AGENT_INTERRUPT_DISABLED_SEND_CONFIRM = '送信前の確認を開いている間は中断できません'
/** 送っている途中・押してから 1,000ms 以内(待ちはタブごと) */
export const AGENT_INTERRUPT_DISABLED_COOLDOWN =
  '中断を送りました。まだ作業中なら、少し待つと押せます'
/** 選択中のタブの CLI が中断に対応していない(能力の表の interrupt が false の種類) */
export function agentInterruptUnsupportedReason(commandName: string): string {
  return `${commandName} では中断のボタンを使えません（ターミナルで操作してください）`
}
/** 活動が working でないときの理由。permission・unknown は種類の表から作り、confirm・idle は CLI に依らない */
export function agentInterruptBlockedByActivityReason(
  activity: Exclude<AgentActivity, 'working'>,
  kind: AgentCliKind
): string {
  switch (activity) {
    case 'permission':
      return `許可待ちのため中断できません（Esc は${AGENT_INTERRUPT_KEY_TEXTS[kind].permissionEscEffect}になります。ターミナルで答えてください）`
    case 'unknown':
      return `作業中か判定できないため押せません（${AGENT_INTERRUPT_KEY_TEXTS[kind].terminalHint}）`
    case 'confirm':
      return '確認待ちのため中断できません（ターミナルで選んでください）'
    case 'idle':
      return '入力待ちのため、中断する作業がありません'
  }
}
/** 中断を送れたときの読み上げ(label は押した時点のタブの名前。formatAgentTabLabel。2 回目の要る種類は 2 回目まで送れたとき) */
export function agentInterruptSentNotice(label: string, kind: AgentCliKind): string {
  return `${label} に中断（${AGENT_INTERRUPT_KEY_TEXTS[kind].sentKeys}）を送りました`
}
/** 2 回目の前に作業中でなくなった・判定できなかったため、2 回目を頼まなかったときの読み上げ(1 回目は届いている。L-001) */
export function agentInterruptFollowUpSkippedNotice(
  label: string,
  activity: Exclude<AgentActivity, 'working'>
): string {
  // 判定できないときは作業が続いていることがあるので、待ってから押し直す案内を添える
  if (activity === 'unknown') {
    return `${label} が作業中か判定できなかったため、2 回目の Esc は送りませんでした（まだ作業中なら、少し待ってからもう一度押してください）`
  }
  return `${label} が作業中でなくなったため、2 回目の Esc は送りませんでした`
}
/** 中断を送れなかったときの文言の接頭辞(AGENT_STOP_ERROR_PREFIX と同じ形)。送れたときは、この接頭辞で始まる error だけを消す */
export const AGENT_INTERRUPT_ERROR_PREFIX = '中断を送れませんでした: '
/** main が no-session を返した(終了の知らせが renderer より先・起動し直した・停止中)。commandName はタブの種類のコマンド名 */
export function agentInterruptNoSessionError(commandName: string): string {
  return `${AGENT_INTERRUPT_ERROR_PREFIX}${commandName} が終了したか、起動し直しました`
}
/** main が write-failed を返した(pty への書き込みが例外) */
export const AGENT_INTERRUPT_ERROR_WRITE_FAILED = `${AGENT_INTERRUPT_ERROR_PREFIX}ターミナルへの書き込みに失敗しました`
/** 2 回目が 1 回目から期限を過ぎた(main の expired。負荷で遅れた) */
export const AGENT_INTERRUPT_ERROR_FOLLOW_UP_EXPIRED = `${AGENT_INTERRUPT_ERROR_PREFIX}2 回目の Esc が間に合いませんでした（まだ作業中なら、もう一度押してください）`
/** 2 回目を受け付けていない(main の not-pending) */
export const AGENT_INTERRUPT_ERROR_FOLLOW_UP_NOT_PENDING = `${AGENT_INTERRUPT_ERROR_PREFIX}2 回目の Esc を送れる状態ではありませんでした（まだ作業中なら、もう一度押してください）`
/** invoke の拒否・window.api の同期の例外 */
export function agentInterruptError(message: string): string {
  return `${AGENT_INTERRUPT_ERROR_PREFIX}${message}`
}
```

`src/renderer/src/lib/agentInterrupt.ts`:

1. `./agentInterruptMessages` の import から `AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY` と `AGENT_INTERRUPT_NOT_RUNNING` を消し、`agentInterruptBlockedByActivityReason` と `agentInterruptNotRunningReason` を足す
2. `AGENT_INTERRUPT_COOLDOWN_MS` のコメントを次にする:

```ts
/**
 * 押してから押せない間。入力待ちの画面で 2 回目の Esc は 0.5 秒後なら入力欄を消し、0.9 秒以上空けると消さなかった
 * (MVP の確認の結果 17)ため、0.9 秒より長くする。copilot は 500ms 以内の Esc 2 回を中断・書きかけの消去・巻き戻しとして扱うため、
 * 2 回目の流れが終わった時点からこの待ちを数え直し(useAgentInterruptCooldown の restartCooldown)、次の 1 回目を前の 2 回目から
 * 常に 1,000ms 以上空ける(設計書 2026-10-21「中断の待ち」)
 */
```

3. `describeAgentInterruptBlockedByActivity` を次にする:

```ts
/** 活動が working でないときの理由(押した時点の画面の読み直し〈手順 3〉でも使う)。許可待ち・判定できないの文言はタブの種類で変わる */
export function describeAgentInterruptBlockedByActivity(
  activity: Exclude<AgentActivity, 'working'>,
  cliKind: AgentCliKind
): string {
  return agentInterruptBlockedByActivityReason(activity, cliKind)
}
```

4. `blockedReasonOf` の `return describeAgentInterruptBlockedByActivity(input.activity)` を `return describeAgentInterruptBlockedByActivity(input.activity, input.cliKind)` にする
5. `getAgentInterruptAvailability` の `return { visible: false, reason: AGENT_INTERRUPT_NOT_RUNNING }` を `return { visible: false, reason: agentInterruptNotRunningReason(AGENT_CLI_PROFILES[input.cliKind].commandName) }` にする
6. `checkAgentInterruptAtPress` の `reason: describeAgentInterruptBlockedByActivity(screenActivity)` を `reason: describeAgentInterruptBlockedByActivity(screenActivity, input.cliKind)` にする
7. ファイルの最後に次を足す:

```ts
/** 2 回目の前の確かめの結果(useAgentInterrupt の手順 7) */
export type AgentInterruptFollowUpCheck =
  | { kind: 'send' }
  /** 作業中でなくなった・判定できない(2 回目を頼まず、活動に応じて読み上げる) */
  | { kind: 'skip'; activity: Exclude<AgentActivity, 'working'> }
  /** 画面を読めない(2 回目を頼まず、読み上げもしない。呼び出し側が console に記録する) */
  | { kind: 'unreadable'; error: unknown }

/**
 * 2 回目の Esc を頼む直前に、送った先のタブの画面をタブの種類の規則で読み直す。作業中のときだけ send(入力待ちの copilot に 2 回目が
 * 届くと、1 回目と組になって書きかけの消去・巻き戻しの画面になるため。L-041)。送信中・確認の表示中・閉じる途中は見直さない
 * (送信は copilot では使えず〈promptSend が false〉、閉じる途中は useAgentSessions の interruptFollowUp が stale で止める)
 */
export function checkAgentInterruptFollowUp(
  cliKind: AgentCliKind,
  readScreen: () => readonly ViewportLine[]
): AgentInterruptFollowUpCheck {
  let activity: AgentActivity
  try {
    activity = classifyAgentScreenFor(cliKind, readScreen())
  } catch (error) {
    return { kind: 'unreadable', error }
  }
  return activity === 'working' ? { kind: 'send' } : { kind: 'skip', activity }
}
```

- [ ] **Step 7: useAgentSessions を実装する**

`src/renderer/src/hooks/useAgentSessions.ts`:

1. import に `import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'` を足し、`@shared/types` の型に `AgentInterruptFollowUpResult` を足す。`../lib/agentInterruptMessages` の import を次にする:

```ts
import {
  AGENT_INTERRUPT_ERROR_FOLLOW_UP_EXPIRED,
  AGENT_INTERRUPT_ERROR_FOLLOW_UP_NOT_PENDING,
  AGENT_INTERRUPT_ERROR_PREFIX,
  AGENT_INTERRUPT_ERROR_WRITE_FAILED,
  agentInterruptError,
  agentInterruptNoSessionError
} from '../lib/agentInterruptMessages'
```

2. `AgentInterruptOutcome` を次にし、その後に `AgentInterruptFollowUpOutcome` を足す:

```ts
/** 中断(帯の 中断)の 1 回目の結果。送れたかだけを扱い、作業が止まったかは画面の判定で分かる(L-001) */
export type AgentInterruptOutcome =
  /** followUp は 2 回目を頼む案内。sessionId は 1 回目を送ったセッション(2 回目を同じセッションにだけ頼むため) */
  | { kind: 'sent'; followUp: { afterMs: number; sessionId: string } | null }
  /** そのタブにセッションが無い(IPC を呼ばない) */
  | { kind: 'skipped' }
  /** 結果が届いた時点で、そのタブの sessionId が送った値と違う(起動し直した・終了した・閉じた)。何も出さない */
  | { kind: 'stale' }
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
  /** invoke の拒否・同期の例外 */
  | { kind: 'error'; message: string }

/** 中断の 2 回目の結果 */
export type AgentInterruptFollowUpOutcome =
  | { kind: 'sent' }
  /** 頼む時点か結果が届いた時点で、そのタブのセッションが 1 回目と違う・閉じる途中(IPC を呼ばない・結果を出さない) */
  | { kind: 'stale' }
  | { kind: 'not-pending' }
  | { kind: 'expired' }
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
  | { kind: 'error'; message: string }
```

3. `AgentSessionsState` の `interrupt` のコメントの `そのタブの claude に中断(Esc を 1 回)を送る。` を `そのタブの CLI に中断の 1 回目を送る(2 回目の要る種類は sent の followUp で案内する)。` にし、その後に次を足す:

```ts
/** 1 回目を送ったセッション(sessionId)へ中断の 2 回目を頼む。そのタブの今の sessionId が違う・閉じる途中なら IPC を呼ばず stale。
 *  結果が届いた時点でも確かめ、違えば stale(L-037)。送れなかったらそのタブの error に出し、送れたら中断の失敗の文言だけを消す。拒否しない */
interruptFollowUp: (slotId: string, sessionId: string) => Promise<AgentInterruptFollowUpOutcome>
```

4. `clearInterruptError` の後に次を足す:

```ts
// 失敗の文言の CLI の名前(そのタブの種類。起動の結果が無ければ設定の種類。タブの名前と同じ値)
const commandNameOf = useCallback(
  (slotId: string): string =>
    AGENT_CLI_PROFILES[cliKindBySlotRef.current.get(slotId) ?? appCliKindRef.current].commandName,
  [appCliKindRef]
)
```

5. `interrupt` の `if (result.kind === 'sent') { … }` からの終わりを次にし、依存の配列に `commandNameOf` を足す:

```ts
if (result.kind === 'sent') {
  clearInterruptError(slotId)
  return {
    kind: 'sent',
    followUp: result.followUp === null ? null : { afterMs: result.followUp.afterMs, sessionId: id }
  }
}
patchTab(slotId, {
  error:
    result.kind === 'no-session'
      ? agentInterruptNoSessionError(commandNameOf(slotId))
      : AGENT_INTERRUPT_ERROR_WRITE_FAILED
})
// ここでは no-session か write-failed(sent は上で返した)
return result
```

6. `interrupt` の後に次を足す:

```ts
const interruptFollowUp = useCallback(
  async (slotId: string, sessionId: string): Promise<AgentInterruptFollowUpOutcome> => {
    // 頼む時点と結果が届いた時点で、そのタブのセッションが 1 回目のままで、閉じる途中でないか(L-037)
    const isCurrent = (): boolean =>
      sessionIdBySlotRef.current.get(slotId) === sessionId && !closingRef.current.has(slotId)
    if (!isCurrent()) return { kind: 'stale' }
    let result: AgentInterruptFollowUpResult
    try {
      // 同期の例外も拒否と同じ経路で扱う(L-055)
      result = await Promise.resolve().then(() =>
        agentTerminalApi.interruptAgentSessionFollowUp(sessionId)
      )
    } catch (err) {
      if (!isCurrent()) return { kind: 'stale' }
      const message = toError(err).message
      patchTab(slotId, { error: agentInterruptError(message) })
      return { kind: 'error', message }
    }
    if (!isCurrent()) return { kind: 'stale' }
    switch (result.kind) {
      case 'sent':
        clearInterruptError(slotId)
        return result
      case 'not-pending':
        patchTab(slotId, { error: AGENT_INTERRUPT_ERROR_FOLLOW_UP_NOT_PENDING })
        return result
      case 'expired':
        patchTab(slotId, { error: AGENT_INTERRUPT_ERROR_FOLLOW_UP_EXPIRED })
        return result
      case 'no-session':
        patchTab(slotId, { error: agentInterruptNoSessionError(commandNameOf(slotId)) })
        return result
      case 'write-failed':
        patchTab(slotId, { error: AGENT_INTERRUPT_ERROR_WRITE_FAILED })
        return result
    }
  },
  [patchTab, clearInterruptError, commandNameOf]
)
```

7. 戻り値の `interrupt,` の次に `interruptFollowUp,` を足す

`src/renderer/src/__tests__/makeAgentSessionsState.ts`: `interrupt: vi.fn<AgentSessionsState['interrupt']>(async () => ({ kind: 'sent' })),` を次の 2 行にする:

```ts
    interrupt: vi.fn<AgentSessionsState['interrupt']>(async () => ({ kind: 'sent', followUp: null })),
    interruptFollowUp: vi.fn<AgentSessionsState['interruptFollowUp']>(async () => ({ kind: 'sent' })),
```

- [ ] **Step 8: 待ちの数え直し・押した処理・配線・ボタンの名前を実装する**

`src/renderer/src/hooks/useAgentInterruptCooldown.ts`:

1. `AgentInterruptCooldown` の `finish` の後に次を足す:

```ts
  /** 2 回目の流れが終わった(copilot): そのタブの 1,000ms の待ちを今から数え直す(前のタイマーを消す)。アンマウントの後は何もしない */
  restartCooldown: (slotId: string) => void
```

2. `begin` の定義を次の 3 つに置き換え、戻り値を `{ isPending, isInFlight, isCoolingDown, begin, finish, restartCooldown }` にする:

```ts
// そのタブの 1,000ms の待ちを今から始める(前のタイマーがあれば消して数え直す)
const startCooldown = useCallback((slotId: string): void => {
  const timers = timersRef.current
  const previous = timers.get(slotId)
  if (previous !== undefined) clearTimeout(previous)
  timers.set(
    slotId,
    setTimeout(() => {
      timers.delete(slotId)
      if (mountedRef.current) setCoolingSlots((prev) => withSlot(prev, slotId, false))
    }, AGENT_INTERRUPT_COOLDOWN_MS)
  )
  setCoolingSlots((prev) => withSlot(prev, slotId, true))
}, [])

const begin = useCallback(
  (slotId: string): void => {
    inFlightRef.current.add(slotId)
    setWaitingSlots((prev) => withSlot(prev, slotId, true))
    startCooldown(slotId)
  },
  [startCooldown]
)

const restartCooldown = useCallback(
  (slotId: string): void => {
    // アンマウントの後はタイマーを残さない(L-052)
    if (!mountedRef.current) return
    startCooldown(slotId)
  },
  [startCooldown]
)
```

`src/renderer/src/hooks/useAgentInterrupt.ts`:

1. import を次にする:

```ts
import { useCallback, useEffect, useRef } from 'react'
import type { Announcement } from '../types'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import {
  checkAgentInterruptAtPress,
  checkAgentInterruptFollowUp,
  getAgentInterruptAvailability
} from '../lib/agentInterrupt'
import type { AgentInterruptAvailabilityInput } from '../lib/agentInterrupt'
import {
  agentInterruptFollowUpSkippedNotice,
  agentInterruptSentNotice
} from '../lib/agentInterruptMessages'
import type {
  AgentInterruptFollowUpOutcome,
  AgentInterruptOutcome,
  AgentSessionTabView
} from './useAgentSessions'
import { useAgentInterruptCooldown } from './useAgentInterruptCooldown'
import { useLatestRef } from './useLatestRef'
import { useTransientNotice } from './useTransientNotice'
```

2. 冒頭のコメントの `(設計書 2026-10-19「押したときの処理」)` を `(設計書 2026-10-19「押したときの処理」、2026-10-21「中断の流れ」の手順 5〜9)` にし、その段落の最後に次の 2 行を足す:

```ts
// 2 回目の要る種類(copilot)は、1 回目の結果の案内の時間だけ待ち、送った先のタブの画面が作業中のときだけ 2 回目を頼み、
// 2 回目の流れが終わった時点で 1,000ms の待ちを数え直す(次の 1 回目を前の 2 回目から常に 1,000ms 以上空ける)
```

3. `UseAgentInterruptOptions` の `interrupt` の後に次を足す:

```ts
/** 1 回目を送ったセッションへ中断の 2 回目を頼む(useAgentSessions の interruptFollowUp。拒否しない。省略できない。L-060) */
interruptFollowUp: (slotId: string, sessionId: string) => Promise<AgentInterruptFollowUpOutcome>
```

4. `toAgentInterruptAvailabilityInput` の後に次を足す:

```ts
/** 2 回目を待つタイマー(アンマウントで消し、待っている流れには false を返す) */
interface FollowUpWait {
  timer: ReturnType<typeof setTimeout>
  resolve: (waited: boolean) => void
}
```

5. `useAgentInterrupt` の本体を次にする（`return` は今のまま）:

```ts
export function useAgentInterrupt({
  selected,
  activities,
  isSending,
  isSendConfirmOpen,
  interrupt,
  interruptFollowUp
}: UseAgentInterruptOptions): AgentInterruptPanelState {
  const { notice, announce } = useTransientNotice(AGENT_INTERRUPT_NOTICE_MS)
  const cooldown = useAgentInterruptCooldown()
  const { isInFlight, isCoolingDown, begin, finish, restartCooldown } = cooldown
  const mountedRef = useRef(false)
  // 2 回目を待つタイマー。アンマウントで消し、待っている流れには 2 回目を頼ませない(main の控えは期限で無効になる。L-052)
  const followUpWaitsRef = useRef(new Set<FollowUpWait>())

  useEffect(() => {
    mountedRef.current = true
    const waits = followUpWaitsRef.current
    return () => {
      mountedRef.current = false
      for (const wait of waits) {
        clearTimeout(wait.timer)
        wait.resolve(false)
      }
      waits.clear()
    }
  }, [])

  const availability = getAgentInterruptAvailability(
    toAgentInterruptAvailabilityInput(
      { selected, activities, isSending, isSendConfirmOpen },
      cooldown.isPending(selected.slotId)
    )
  )
  const latestRef = useLatestRef({
    selected,
    activities,
    isSending,
    isSendConfirmOpen,
    interrupt,
    interruptFollowUp
  })

  /** afterMs だけ待つ。待ち終えたら true、アンマウントで消したら false */
  const waitForFollowUp = useCallback(
    (afterMs: number): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        const waits = followUpWaitsRef.current
        const wait: FollowUpWait = {
          timer: setTimeout(() => {
            waits.delete(wait)
            resolve(true)
          }, afterMs),
          resolve
        }
        waits.add(wait)
      }),
    []
  )

  const onInterrupt = useCallback((): void => {
    const current = latestRef.current
    // 押した時点のタブ。2 回目の前の確かめも、待つ間に別のタブを選んでもこのタブ(送った先)で行う
    const tab = current.selected
    const { slotId, label, cliKind } = tab
    // 1. 同期の再入の防止(同じタブの結果を待つ間。2 回目まで続く)。何も出さない
    if (isInFlight(slotId)) return
    // 2・3. 最新の値で押せるかを求め直し、押した時点の画面をタブの種類の規則で読み直す。押せなければ理由を読み上げる(L-057)
    const check = checkAgentInterruptAtPress(
      toAgentInterruptAvailabilityInput(current, isCoolingDown(slotId)),
      () => tab.controller.readScreen()
    )
    if (check.kind === 'unreadable') {
      console.error('[useAgentInterrupt] 画面を読めないため、中断を送りません:', check.error)
      return
    }
    if (check.kind === 'blocked') {
      announce(check.reason)
      return
    }
    // 4. 送っている途中と 1,000ms の待ちを始める(待ちはタブごと)
    begin(slotId)
    void (async () => {
      // 2 回目を頼む案内があり、案内の時間を待ち終えた流れか(手順 8 で 1,000ms の待ちを数え直す)
      let followUpFlow = false
      try {
        // 5. 1 回目。stale・skipped は何も出さず、失敗は useAgentSessions がタブの error に出す
        const outcome = await current.interrupt(slotId)
        if (outcome.kind !== 'sent') return
        const { followUp } = outcome
        if (followUp === null) {
          // 2 回目の無い種類(claude)は、送れたときだけ読み上げる(L-001)
          if (mountedRef.current) announce(agentInterruptSentNotice(label, cliKind))
          return
        }
        // 6. 2 回目の要る種類(copilot)。main の案内の時間だけ待つ(アンマウントで消したら頼まない)
        if (!(await waitForFollowUp(followUp.afterMs))) return
        followUpFlow = true
        // 7. 送った先のタブの画面を、そのタブの種類の規則で読み直す。作業中のときだけ 2 回目を頼む(L-041)
        const followUpCheck = checkAgentInterruptFollowUp(cliKind, () =>
          tab.controller.readScreen()
        )
        if (followUpCheck.kind === 'unreadable') {
          console.error(
            '[useAgentInterrupt] 画面を読めないため、中断の 2 回目を送りません:',
            followUpCheck.error
          )
          return
        }
        if (followUpCheck.kind === 'skip') {
          if (mountedRef.current) {
            announce(agentInterruptFollowUpSkippedNotice(label, followUpCheck.activity))
          }
          return
        }
        const followUpOutcome = await current.interruptFollowUp(slotId, followUp.sessionId)
        // 2 回目まで送れたときだけ「中断を送りました」と読み上げる(L-001)。stale は何も出さず、失敗は useAgentSessions が出す
        if (followUpOutcome.kind === 'sent' && mountedRef.current) {
          announce(agentInterruptSentNotice(label, cliKind))
        }
      } catch (err) {
        console.error('[useAgentInterrupt] 中断の送信に失敗しました:', err)
      } finally {
        // 8. 2 回目の流れが終わった時点から 1,000ms の待ちを数え直す(copilot の 500ms の窓で前の Esc と組にしない)。
        // アンマウントの後は数え直さない
        if (followUpFlow && mountedRef.current) restartCooldown(slotId)
        // 9. 2 回目まで終わってから解く(例外でも固まらない。L-053)
        finish(slotId)
      }
    })()
  }, [latestRef, announce, isInFlight, isCoolingDown, begin, finish, restartCooldown, waitForFollowUp])
```

`src/renderer/src/hooks/useAgentWorkspace.ts` の `useAgentInterrupt({` の引数の `interrupt: agentSessions.interrupt` の次に `interruptFollowUp: agentSessions.interruptFollowUp` を足し、その上のコメントの最後に `copilot は 2 回目を同じタブのセッションへ頼む(interruptFollowUp)。` を足す。

`src/renderer/src/components/agent/AgentTerminalPanel.tsx` の `aria-label={agentInterruptAriaLabel(AGENT_CLI_PROFILES[session.cliKind].commandName)}`（複数行）を `aria-label={agentInterruptAriaLabel(session.cliKind)}` にする（`AGENT_CLI_PROFILES` は `起動` の名前で使っているので import は残す）。

- [ ] **Step 9: テストが通ることを確かめる**

Run: Step 5 と同じコマンド
Expected: PASS
Run: `npm run typecheck`
Expected: PASS（`AgentSessionsState` を作っている箇所で `interruptFollowUp` の無いものがあれば型エラーになる。テストの補助は `makeAgentSessionsState` で足した）
Run: `grep -rn "AGENT_INTERRUPT_NOT_RUNNING\|AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY\|AGENT_INTERRUPT_ERROR_NO_SESSION" src || echo none`
Expected: `none`

- [ ] **Step 10: 変異で確かめる（配線の受け渡しを 1 つずつ外す。L-060）**

1. `useAgentWorkspace.ts` の `interruptFollowUp: agentSessions.interruptFollowUp` を `interruptFollowUp: async () => ({ kind: 'stale' as const })` にする → `copilot の配線…` が落ちる（2 回目の IPC が呼ばれない）。戻す
2. `useAgentActivity.ts` の `classifyRef.current(tab.cliKind, …)` を `classifyRef.current('claude', …)` にする → `copilot の配線…` が落ちる（帯が作業中にならず、中断を押せない）。戻す
3. `agentScreenClassifiers.ts` の `copilot: classifyCopilotScreen` を `copilot: classifyClaudeScreen` にする → `copilot の配線…` と `agentScreenClassifiers.test.ts` が落ちる。戻す
4. `useAgentInterrupt.ts` の `checkAgentInterruptFollowUp(cliKind, …)` を `checkAgentInterruptFollowUp('claude', …)` にする → `押すと 1 回目を送り、afterMs の後に画面が作業中なら…` が落ちる。戻す
5. `useAgentInterrupt.ts` の `if (followUpFlow && mountedRef.current) restartCooldown(slotId)` を消す → `2 回目の流れが終わった時点から 1,000ms の待ちを数え直す…` が落ちる。戻す
6. `useAgentSessions.ts` の `interruptFollowUp` の最初の `if (!isCurrent()) return { kind: 'stale' }` を消す → `渡した sessionId がそのタブの今のセッションと違えば…`・`閉じる途中のタブは…` が落ちる。戻す
7. `git diff src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/hooks/useAgentActivity.ts src/renderer/src/lib/agentScreenClassifiers.ts` で戻したことを確かめる（`useAgentActivity.ts`・`agentScreenClassifiers.ts` は前のタスクの差分だけが残る）

- [ ] **Step 11: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/lib/agentInterruptMessages.ts src/renderer/src/lib/agentInterrupt.ts src/renderer/src/hooks/useAgentSessions.ts src/renderer/src/hooks/useAgentInterruptCooldown.ts src/renderer/src/hooks/useAgentInterrupt.ts src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/components/agent/AgentTerminalPanel.tsx src/renderer/src/__tests__/makeAgentSessionsState.ts src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts src/renderer/src/lib/__tests__/agentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentInterruptCooldown.test.ts src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み（外れたら同じファイルを明示して `npx prettier --write` で直す）

---

### Task 6: ROADMAP の更新・既知の制約・テスト仕様書と全体の検証（テスト仕様書への追記と Artifact の再公開）

> **設計書の読む節:** 「ROADMAP の更新の方針」、「既知の制約」、「実機テスト仕様書の新しい項目の下書き」（既存の項目の直しと新しい節）、「実装の分割」の 6、「main に入れた時点で利用者から見える挙動」。CLAUDE.md の実機テスト仕様書の規則（書式・ID を変えない・接頭辞ごとの連番）と `scripts/build-manual-test-spec.mjs`。
>
> **気をつける知見:** L-072（実機の項目では `copilot` に頼む内容を返答だけか `sleep` に限り、許可の確認とフォルダの信頼で「今後も覚える」選択肢を選ばない。端末で作るファイルはテスト用のフォルダで `pwd` を確かめてから作り、同じく `pwd` を確かめてから消す。使う CLI・通知・VoiceOver の設定は最後に戻す）・L-354（下書きの文言を実装の文言と照らし合わせてから追記する）・L-059（記録できなかった画面は既知の制約に書き、実機の項目で確かめる）

**Files:**

- Modify: `docs/manual-test-spec.md`（AGT-230・231・232・234・239・240 の直しと、新しい節 AGT-243〜256。**ほかの既存の項目の ID と文言は変えない**）
- Modify: `ROADMAP.md`（**prettier にかけない**）
- Modify（食い違いがあれば）: `docs/superpowers/specs/2026-10-21-agent-cli-copilot-screen-design.md`（「既知の制約」の照合と、プランの冒頭の「計画の時点で設計書から調整した細部」の反映）
- 生成（git 管理外）: `.superpowers/manual-test-spec.html`

**Interfaces:**

- Consumes: Task 1〜5 の実装（文言の正は `src/renderer/src/lib/agentInterruptMessages.ts`・`src/shared/agentNotificationText.ts`・`src/renderer/src/lib/agentCliMessages.ts`・`src/renderer/src/lib/agentSessionMessages.ts`）
- Produces: 実機テスト仕様書の AGT-243〜AGT-256 と既存の 6 項目の直し、ROADMAP の段階 2a の記録（コントローラーが Artifact を再公開する）

- [ ] **Step 1: 設計書の「既知の制約」を実装と照らし合わせ、調整した細部を設計書に反映する**

`sed -n '/^## 既知の制約/,/^## 実機テスト仕様書の新しい項目の下書き/p' docs/superpowers/specs/2026-10-21-agent-cli-copilot-screen-design.md` で読み、次を確かめる。食い違いがあれば設計書の行を実装に合わせて直す（無ければ変えない）:

1. 判定の手がかりの文言（`esc interrupt`・`esc again to interrupt`・選択の案内・`Do you want to `・スピナー `○◎◉●`）が `src/renderer/src/lib/copilotScreenActivity.ts` の定数と一致する
2. 2 回目の待ち・期限（100ms・400ms）が `src/main/agentCliInterruptSpecs.ts` と一致し、2 回目の前に画面を確かめ直す・頼まなかったときの読み上げ・期限切れの文言が実装と一致する
3. 1,000ms の待ちを 2 回目の流れが終わった時点から数え直す（`useAgentInterrupt.ts` の `restartCooldown`）
4. 通知の題がタブの種類の名前になる（`agentNotificationText(kind, tabNumber, cliKind)`）
5. 設計書のほかの節の語を、プランの冒頭の「計画の時点で設計書から調整した細部」に合わせて直す（「決めたこと（利用者の確認済み）」「決めたこと（推奨案で決めた事項）」の表の文言は変えない）:
   - 「copilot の判定」の定数の一覧に `FRAME_PREFIX`、入力欄の特定の結果の `CopilotInputBox` を足す
   - 「renderer（押せるかの判定と押した処理）」と「文言」の関数の形に、`describeAgentInterruptBlockedByActivity(activity, cliKind)` が `agentInterruptMessages.ts` の `agentInterruptBlockedByActivityReason(activity, kind)` を呼ぶ旨を足す
   - 「実装の最初に確かめること」の 1・2 に、置き換えのスクリプトを `sanitize-copilot.py`（`sanitize.py` に規則 1' を足したもの）として変換のスクリプトと同じフォルダに置いた旨と、台帳の SHA-256（`8fe11e4ae5507f1859cbe61dc754062e904e15fd106adff978d1479a41154aaf`）・変わった行の数（41）を足す
   - 「テスト方針」に、能力が無い種類のテストの補助 `src/renderer/src/__tests__/agentCliCapabilityOverrides.ts` を使う旨を足す

- [ ] **Step 2: 実機テスト仕様書の文言を実装と照らし合わせる（L-354）**

```bash
cd <repo-root>
R=src/renderer/src
S=src/shared
test -d "$R/lib" && test -d "$S" || echo "missing"
node -e '
const { execSync } = require("node:child_process")
const texts = [
  ["src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts", "中断（作業中の copilot に Esc を 2 回送る）"],
  ["src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts", "copilot 1 に中断（Esc を 2 回）を送りました"],
  ["src/renderer/src/lib/__tests__/agentInterruptMessages.test.ts", "許可待ちのため中断できません（Esc は操作の取り消しになります。ターミナルで答えてください）"],
  ["src/renderer/src/lib/agentInterruptMessages.ts", "入力待ちのため、中断する作業がありません"],
  ["src/shared/__tests__/agentNotificationText.test.ts", "copilot 1 の作業が終わりました"],
  ["src/shared/__tests__/agentNotificationText.test.ts", "copilot 1 が許可待ちになりました"],
  ["src/shared/__tests__/agentNotificationText.test.ts", "copilot 1: 作業が終わりました"],
  ["src/shared/agentNotificationText.ts", "次の指示を待っています"],
  ["src/renderer/src/lib/__tests__/agentCliMessages.test.ts", "copilot では次の機能を使えません（ターミナルで直接操作します）: プロンプトの送信（実行・再実行）、利用者の変更との区別、前回の続きから・このセッションで再開"]
]
for (const [file, text] of texts) {
  const ok = require("node:fs").readFileSync(file, "utf8").includes(text)
  console.log(ok ? "OK" : "NG", text)
}
'
grep -n "'作業中'\|'入力待ち'\|'確認待ち'\|'許可待ち'\|'実行中'" "$R/lib/agentSessionMessages.ts"
grep -n "エージェント: " "$R/lib/agentActivitySummary.ts"
```

Expected: `missing` が出ず、すべて `OK`。最後の 2 つの `grep` が帯の状態の文言とステータスバーのまとめの形（`エージェント: ${…join(' · ')}`）を出す。`NG` が出たら、Step 3 で足す項目の文言をコードの文字列に合わせて直す（コードは変えない）

- [ ] **Step 3: 実機テスト仕様書の既存の項目を直す（ID は変えない）**

`docs/manual-test-spec.md` の `### 使うエージェント CLI の切り替え（copilot）` の次の項目を直す（**行の ID と、書いていない部分は変えない**）:

1. **AGT-230** の `選択肢の下に` から行の終わりまでを次にする:

```text
選択肢の下に `copilot では次の機能を使えません（ターミナルで直接操作します）: プロンプトの送信（実行・再実行）、利用者の変更との区別、前回の続きから・このセッションで再開` が出る。`エージェントの通知` の項目には `copilot` の注記が出ない
```

2. **AGT-231** の ``帯は `実行中` になる。`` を次にする:

```text
フォルダの信頼の確認が出ている間は帯が `確認待ち`、`copilot` の入力欄が出ると `入力待ち` になる。
```

3. **AGT-232** の `→` より後ろを次にする:

```text
`copilot` が応答する。応答の間は帯とステータスバーが `作業中`、終わると `入力待ち` になる（詳しい確かめは AGT-244・245）
```

4. **AGT-234** の行の ID より後ろの全体を次にする:

```text
`copilot 1` が入力待ちの間に、帯の `中断` にマウスを載せてから押す → `中断` は薄い色で、`入力待ちのため、中断する作業がありません` が出る。押しても `copilot` の画面は変わらない
```

5. **AGT-239** の ``、`copilot` が起動し、帯は `実行中`。`copilot 1` のタブを選ぶと帯は `実行中` のまま（帯は選んでいるタブの状態を出す）。`` を次にする（前提でその回だけ信頼するので、`copilot 2` の起動でも信頼の確認が出る）:

```text
、`copilot` が起動し、フォルダの信頼の確認が出ている間は帯が `確認待ち`、`1. Yes` で答えると `入力待ち`。`copilot 1` のタブを選ぶと帯は `入力待ち` のまま（帯は選んでいるタブの状態を出す）。
```

6. **AGT-240** の `使えない機能の注記と通知の項目の注記が消える` を `使えない機能の注記が消える` にする

`git diff docs/manual-test-spec.md | grep '^[-+]- \[ \]' | grep -o 'AGT-[0-9]*' | sort | uniq -c` が AGT-230・231・232・234・239・240 だけを（それぞれ 2 回）出すことを確かめる。

- [ ] **Step 4: 実機テスト仕様書に新しい節を足す**

`docs/manual-test-spec.md` の **AGT-242** の行の直後（`## エージェントの変更の確認` の前）に、空行を 1 つ置いて次をそのまま足す（Step 2 で `NG` が出た文言はコードに合わせる。1 行 1 項目）:

```text
### copilot の画面の判定と中断

> 前提: エージェント CLI 方式で、テスト用のフォルダを開いている。GitHub Copilot CLI（`copilot`）がインストール済みで、端末で `copilot --version` が動く。設定の `使うエージェント CLI` で `GitHub Copilot CLI（copilot）` を選んでから始め（動いているタブがあれば確認で `OK`）、この節の最後の項目で `Claude Code（claude）` に戻す。途中で止めるときも `Claude Code（claude）` に戻す。
> 前提: フォルダの信頼の確認が出たら、その回だけ信頼する選択肢（`1. Yes`）を選び、`2. Yes, and remember this folder for future sessions` は選ばない（覚えさせてしまったら、AGT-228 の節の前提の手順で外す）。`copilot` のログインなど GitHub のアカウントに関わる操作は、利用者が自分のアカウントで行う。
> 前提: 長い作業は、`copilot` の入力欄（ターミナルの中をクリックして）に `Without using any tools or files, write the numbers from 1 to 2000 in your reply, one per line.` を入力して `Enter` で送って作る（ツールを使わないので許可の確認は出ず、ファイルも変えない。1 分ほど応答が続く。プロンプトの `実行` は copilot では押せないため、ターミナルに直接入力する）。ツールを使おうとして許可の確認が出たら、ターミナルで `Esc` を押して取り消してから送り直す。手順の途中で作業が終わってしまったら、同じ文を送り直して手順の頭からやり直す。
> 前提: 長い作業の間に、ターミナルの入力欄で `Enter` を押して次の指示を送信待ちにしない（送信待ちの指示があると、中断の後にその指示が送られて作業中に戻る。既知の制約）。
> 前提: 設定の `エージェントの通知` がオンの状態で行う（オフなら、この節の間だけオンにし、最後の項目で元に戻す）。

- [ ] **AGT-243** `起動` で `copilot 1` を起動し、`copilot` の入力欄が出るまで待って、帯とステータスバーを見る（フォルダの信頼の確認が出たら、答える前に帯を見る） → 信頼の確認が出ている間は帯が `確認待ち` で、ステータスバーが `エージェント: 確認待ち 1` の強調の色になる（確認が出なければ、そのことを記録する）。`1. Yes` で答えて入力欄が出ると、帯が `入力待ち`、ステータスバーが `エージェント: 入力待ち 1` になる
- [ ] **AGT-244** VoiceOver を使う場合は有効にしておく（使わない場合は読み上げの確認を飛ばして、そのことを記録する）。長い作業を送り、応答の間と終わった後の帯・タブ・ステータスバーを見る → 応答の間は帯が `作業中`、ステータスバーが `エージェント: 作業中 1` になる。終わると帯が `入力待ち` に戻り、`copilot 1 の作業が終わりました` が読み上げられる。VoiceOver を使った場合は、確かめた後に切る
- [ ] **AGT-245** 長い作業を送り、すぐに別のアプリ（Finder など）をクリックしてアプリのウィンドウからフォーカスを外し、作業が終わるまで待つ。出た OS の通知を押す → 作業が終わると macOS の通知が題 `copilot 1: 作業が終わりました`・本文 `次の指示を待っています` で出る。押すとアプリが前面に出て、`copilot 1` のタブが選ばれる
- [ ] **AGT-246** `copilot` の入力欄に `Run the shell command sleep 15.` を入力して `Enter` で送り、許可の確認（`Do you want to run this command?`）が出たら、帯・ステータスバーを見て、帯の `中断` にマウスを載せてから押す → 帯が `許可待ち`、ステータスバーが `エージェント: 許可待ち 1` の強調の色になる（VoiceOver では `copilot 1 が許可待ちになりました`）。`中断` は薄い色で、`許可待ちのため中断できません（Esc は操作の取り消しになります。ターミナルで答えてください）` が出る。押しても許可の確認は残る。許可の確認が出ずにコマンドが実行された（設定で許可済み）ときは、そのことを記録して AGT-248 へ進む
- [ ] **AGT-247** AGT-246 の許可の確認で、ターミナルの中をクリックして `1. Yes` を選び（`Yes, and don't ask again …` は選ばない）、`sleep 15` の実行中に帯が `作業中` になったら `中断` を押す → `中断` は押せる色で、押すと 1 秒以内に `copilot` の画面に `Operation aborted by user`（または `Operation cancelled by user`）が出て作業が止まり、帯が `入力待ち` に、`中断` が薄い色に戻る。`copilot` は終了しない（帯は `終了しました` にならない）。VoiceOver を使う場合は `copilot 1 に中断（Esc を 2 回）を送りました` が読み上げられる
- [ ] **AGT-248** 長い作業を送り、帯が `作業中` になったら `中断` を押す。続けて `copilot` の入力欄に `Continue from where you stopped, but only 10 more numbers.` を送る → 押すと 1 秒以内に `Operation cancelled by user` が出て作業が止まり、帯が `入力待ち` になる。続けて送った指示には前の作業を踏まえて答える
- [ ] **AGT-249** 長い作業を送り、その間にターミナルの入力欄へ `draft` と入力して（`Enter` は押さない）から、帯の `中断` を押す → 作業が止まり、入力欄の `draft` は消えずに残る。巻き戻しの画面（`Rewind to a previous point`）は開かない。確かめた後、ターミナルで `Ctrl+U` を押して書きかけを消す
- [ ] **AGT-250** `copilot 1` が入力待ちのときに、ターミナルの入力欄へ `draft` と入力し（`Enter` は押さない）、帯の `中断` にマウスを載せてから押す → `中断` は薄い色で、`入力待ちのため、中断する作業がありません` が出る。押しても入力欄の `draft` は残り、`copilot` の帯に `esc again to clear input` も出ない。確かめた後、`Ctrl+U` で書きかけを消す
- [ ] **AGT-251** 長い作業を送り、その間に入力欄へ `draft` と入力して（`Enter` は押さない）から、`中断` をすばやくダブルクリックする。別の回に、同じく長い作業の間に `draft` を入力してから、ターミナルの中をクリックしてから `F6` で抜けて（フォーカスが開閉のボタン `エージェント` に移る）、`Tab` を押してフォーカスリングを見ながら `中断` へ移し、`Enter` を 2 秒押し続ける → どちらの回も作業が 1 回止まるだけで、入力欄の `draft` は残り、巻き戻しの画面は開かず、`copilot` は終了しない。確かめた後、それぞれ `Ctrl+U` で書きかけを消す
- [ ] **AGT-252** `+` で `copilot 2` を起動し（信頼の確認が出たら `1. Yes`）、`copilot 1` に長い作業を送ってから `copilot 2`（入力待ち）を選ぶ → `中断` は押せない。`copilot 1` を選び直すと押せ、押すと `copilot 1` だけが止まり、`copilot 2` の画面は変わらない。ステータスバーは作業中に `エージェント: 作業中 1 · 入力待ち 1` になる。確かめた後、`copilot 2` のタブを `×` で閉じ、確認で `OK` を押す
- [ ] **AGT-253** サイドバーを開いたまま、ウィンドウの幅を、ターミナルの `copilot` の帯が 2 行以上に折り返すまで狭めて（`copilot` の帯の右端のモデル名が次の行へ移る幅）、長い作業を送る → 帯（アプリの）は応答の間 `作業中`、終わると `入力待ち` になる。`実行中` と出たら、そのときの `copilot` の帯の行をそのまま記録する。確かめた後、ウィンドウの幅を元に戻す
- [ ] **AGT-254** テスト用のフォルダが Git リポジトリで `変更を確認` の記録を始められるなら行う（そうでなければ、そのことを記録して次へ進む）。`変更を確認` → `いまから記録する` で記録を始める。別の端末で `cd <テスト用のフォルダ>` を実行し、`pwd` がテスト用のフォルダであることを確かめてから、`sleep 15; echo auto >> copilot-auto-refresh.txt` を実行し、すぐにアプリへ戻って `copilot` に長い作業を送る（端末で実行してから 15 秒以内に送る）。アプリのウィンドウを前面にしたまま、`更新` を押さずに作業が終わるまで待つ → 作業が終わると、変更の一覧に `copilot-auto-refresh.txt` が出る（`更新` を押していない）。確かめた後、同じ端末で `pwd` を確かめてから `rm copilot-auto-refresh.txt` を実行し、アプリで `確認を終える` を押して記録を終える
- [ ] **AGT-255** VoiceOver を有効にして、`copilot 1` が入力待ちの状態で、ターミナルの中をクリックしてから `F6` で抜けて、`Tab` を押して帯の `中断` へ移り、名前を聞く。続けて長い作業を送ってから同じように `中断` へ移って名前を聞く → 入力待ちのときは `中断（作業中の copilot に Esc を 2 回送る）` に続けて押せない理由 `入力待ちのため、中断する作業がありません` が読まれる。作業中は同じ名前で、押せない理由は読まれない。確かめた後、作業が続いていれば `中断` を押して止め、VoiceOver を切る（VoiceOver を使わない場合は、この項目を飛ばしてそのことを記録する）
- [ ] **AGT-256** `copilot 1` が動いていれば `終了` で止め、設定の `使うエージェント CLI` で `Claude Code（claude）` を選ぶ（この節の前提で `エージェントの通知` をオンにした場合は、オフに戻す）。帯の `起動` で `claude 1` を起動し、入力待ちになったら帯の `中断` にマウスを載せる → 選択が `Claude Code（claude）` に戻る。`claude 1` の帯は `入力待ち` になり、`中断` の理由は `入力待ちのため、中断する作業がありません`（今までどおり）。この項目で設定は元に戻る
```

`grep -cE '^- \[ \] \*\*AGT-(24[3-9]|25[0-6])\*\*' docs/manual-test-spec.md` が `14` であることを確かめる。

- [ ] **Step 5: HTML を再生成し、仕様書の検査を通す**

Run: `node scripts/build-manual-test-spec.mjs`
Expected: `.superpowers/manual-test-spec.html (N 領域 / M 項目)` が出る（項目の数が足す前より 14 増えている）
Run: `npx vitest run scripts`
Expected: PASS（ID の一意性・接頭辞ごとの連番の昇順〈欠番は許容〉・書式）
Run: `npx prettier --check docs/manual-test-spec.md`
Expected: 整形済み（外れたら `npx prettier --write docs/manual-test-spec.md` で直し、もう一度 `node scripts/build-manual-test-spec.mjs` を流す）

Artifact（<manual-test-spec-artifact-url>）の再公開は、このタスクの実装者ではなく**コントローラーが** `.superpowers/manual-test-spec.html` を同じファイルパスで公開して行う（実装者は HTML の生成までで止め、報告に「再公開が必要」と書く）。

- [ ] **Step 6: ROADMAP を更新する（prettier にかけない）**

`<実装の日>` は `date +%Y-%m-%d` の出力に置き換える（設計書の `<main に入れた日付>` は、main に入れるのが後の工程のため、実装の日で書き、PR の工程で直す）。行番号は計画の時点のもの（`grep -n` で該当の文を探してから直す）。

1. 「エージェント実行の支援（MVP の次）」の ``- [ ] `claude` 以外のエージェント CLI への対応（…）``（:583）は**未完了のまま**にし、その下の段階 1 の行（:584。`実装済み（2026-10-20。段階 1。`で始まる）の直後に次の行を足し（字下げは段階 1 の行と同じ 6 つの空白）、その次の`残り:` の行（:585）を下の 2 行目にする:

```text
      - 実装済み（<実装の日>。段階 2a。設計書 `docs/superpowers/specs/2026-10-21-agent-cli-copilot-screen-design.md`）: copilot の画面の判定（作業中・入力待ち・許可待ち・確認待ち）と、それに基づく帯・タブ・ステータスバーの表示、完了・許可待ちの通知、帯の中断（Esc を 2 回）、変更の一覧の自動の取り直し。実装済み機能の「copilot の画面の判定と中断（段階 2a）」を参照
      - 残り: copilot へのプロンプトの送信（実行・再実行・送信前の確認）＝段階 2b、copilot の hooks による変更の区別・セッションの再開・起動の記録と履歴への CLI の種類の記録＝段階 3
```

2. 実装済み機能の `### 使うエージェント CLI の切り替え（段階 1）` の ``- [x] `copilot` では、プロンプトの送信（実行・再実行・送信前の確認）・中断・前回の続きから・このセッションで再開は押せず、…設定の画面に使えない機能の一覧を出す``（:512）の行の末尾に `（段階 2a で中断に対応した）` を書き足す
3. 同じ節の既知の制約の 1 行目（:515）と 2 行目（:516）を次の 2 行にする（段階 1 の時点の記録として過去形にする）:

```text
- 段階 1 の時点では、`copilot` では、プロンプトの送信（実行・再実行・送信前の確認）・作業中や入力待ちの表示・完了と許可待ちの通知・中断のボタン・変更の一覧の自動の取り直し・利用者の変更との区別・前回の続きから・このセッションで再開を使えなかった（段階 2・3）。ターミナルで直接操作していた（段階 2a で、表示・通知・中断・自動の取り直しに対応した）
- 段階 1 の時点では、`copilot` の帯・タブ・ステータスバーは、動いている間ずっと `実行中` と出ていた（作業中か入力待ちかを判定しなかった）（段階 2a で、表示・通知・中断・自動の取り直しに対応した）
```

4. 同じ節の既知の制約の最後の行（`- （修正済み）起動のたびの設定の読み込み…` の行）の後、`---` の前に、空行を置いて次を足す:

```text
### copilot の画面の判定と中断（段階 2a）

設計書: `docs/superpowers/specs/2026-10-21-agent-cli-copilot-screen-design.md`（2026-10-21）。

- [x] `copilot` の画面から活動（作業中・入力待ち・許可待ち・確認待ち・判定できない）を判定し、帯・タブ・ステータスバーに出す。判定は CLI の種類ごとの関数の表（renderer の `agentScreenClassifiers.ts`）で分け、`claude` と `copilot` の規則を混ぜない。手がかりは GitHub Copilot CLI 1.0.87 の画面（段階 0 の記録。`copilotScreens.json` の 48 画面）の文言だけ: 作業中は入力欄の下の帯の中断の案内（`esc interrupt`・`esc again to interrupt`）、入力待ちは入力欄があり帯に案内が無い、許可待ちは入力欄が無く選択の案内（`↑/↓ to navigate · enter to select · esc to cancel`）の上に `Do you want to ` で始まる問い
- [x] 分からない画面は、作業中でないのに作業中・利用者の操作を待っているのに入力待ちにならない側に倒す（中断の案内は帯だけで見る・入力欄の構造を求める・入力欄の外に選択の案内があれば確認待ち・帯の先頭のスピナーで入力待ちにしない・どれにも当たらなければ `実行中`）
- [x] 完了・許可待ちの通知を `copilot` でも出す（題は `copilot 1: 作業が終わりました` のようにタブの種類の名前。通知の依頼に種類を足し、main が検証して固定の表から題を作る）。変更の一覧の自動の取り直しも `copilot` の活動で動く。hooks への作業中の知らせは、変更の区別をする種類（`claude`）のタブだけ
- [x] 帯の `中断` を `copilot` でも作業中のときだけ押せる。押すと Esc を 1 回送り、約 100ms 後に画面を確かめ直して作業中のときだけ 2 回目の Esc を送る（回数・間隔・期限〈1 回目から 400ms〉は main の種類ごとの表 `agentCliInterruptSpecs.ts` で決め、renderer は 2 回目を頼むかだけを選ぶ。2 回目の IPC は `agentTerminal:interruptFollowUp`）。2 回目の流れが終わった時点から 1,000ms の待ちを数え直す

既知の制約（設計書の「既知の制約」と同じ）:
```

その後に、設計書の `## 既知の制約（ROADMAP・実機テスト仕様書に反映する）` の箇条書き（Step 1 で照らし合わせた後のもの）を、そのまま写す（`sed -n '/^## 既知の制約/,/^## 実機テスト仕様書の新しい項目の下書き/p' docs/superpowers/specs/2026-10-21-agent-cli-copilot-screen-design.md | grep '^- '` の出力を使う）。

5. 「MVP の対象外」の行（`` `claude` 以外のエージェント CLI（起動コマンドの設定） `` を含む行）は MVP の時点の範囲の記録なので変えない
6. `git diff --stat ROADMAP.md` で ROADMAP の変更が上の箇所だけであること（prettier で整形していないこと）、`grep -n "copilot の画面の判定と中断（段階 2a）" ROADMAP.md` が 2 行（参照と見出し）を出すことを確かめる

- [ ] **Step 7: 全体の検証**

Run: `npx vitest run`
Expected: PASS（時間切れで落ちたファイルは `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書く）
Run: `npm run typecheck`
Expected: PASS
Run: `git diff --name-only --diff-filter=d -- '*.ts' '*.tsx' && git ls-files --others --exclude-standard -- '*.ts' '*.tsx'` で、このプランで変更・作成した TypeScript のファイルを列挙し、`npx eslint --max-warnings 0 <列挙したファイル>` と `npx prettier --check <列挙したファイル>`
Expected: エラー・警告なし・すべて整形済み
Run: `npx vitest run scripts`
Expected: PASS
Run: `grep -rn "classifyAgentScreen\b\|AGENT_INTERRUPT_NOT_RUNNING\|AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY\|AGENT_INTERRUPT_ERROR_NO_SESSION" src || echo none`
Expected: `none`
Run: `pgrep -fl amt-test- || true`
Expected: 何も出ない（統合テストの子が残っていない）
Run: `git status --short`
Expected: このプランで変えたファイルと、設計書・プランの未追跡・変更のファイルだけが出る（`.superpowers/` は git 管理外）。報告に「Artifact の再公開が必要」と書く

---

## Self-Review（計画の作成者が設計書と照らし合わせた結果）

**1. 設計書の要件と対応するタスク:**

| 設計書の要件                                                                                                                                                        | タスク           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 実装の最初に確かめること 1〜3（変換のスクリプト・個人情報の置き換えと規則 1'・`copilotScreens.json`・`copilotScreens.ts`・README・`.prettierignore`・台帳のテスト） | 1                |
| 実装の最初に確かめること 4（場面と期待の表・全画面が期待に入るテスト）                                                                                              | 2                |
| 判定の表（`agentScreenClassifiers.ts`）・`claude` の判定の移動と改名・`agentActivity.ts` の整理・`classifyAgentScreen` を残さない                                   | 2                |
| copilot の判定（定数・入力欄の特定・判定の表の順 1〜8・末尾の空白を除く）と手書きの画面のテスト（分からない画面の扱いの全行）                                       | 2                |
| 能力の表（`screenActivity`・`interrupt` を真・説明の直し・不変条件）                                                                                                | 3                |
| `useAgentActivity` の種類ごとの判定（判定の時点のタブの種類・控えに種類を持たない・能力が無い種類は購読しない）                                                     | 3                |
| 通知（依頼の `cliKind`・`agentNotificationText` の種類・main の検証と題・出来事と読み上げの種類）・自動の取り直し・hooks への知らせの絞り込み                       | 3                |
| 能力が無い種類のテストを `vi.mock` に書き換える・使えない機能の注記・通知の注記                                                                                     | 3                |
| 中断の送り方の表（`agentCliInterruptSpecs.ts`）・`AgentSession` の 2 回目・starter・registry・受け口・共有の型・preload・窓口                                       | 4                |
| node-pty の統合テスト（2 回の Esc とその間隔。L-059）                                                                                                               | 4                |
| 種類ごとの文言（「文言」の表の全部）・押せるかの判定の種類の引数・押した時点の読み直し・2 回目の前の確かめ                                                          | 2（読み直し）・5 |
| `useAgentSessions` の `followUp` と `interruptFollowUp`（stale・各失敗の文言・L-055）・`useAgentInterrupt` の手順 5〜9・`restartCooldown`                           | 5                |
| `useAgentWorkspace` の配線・`AgentTerminalPanel` の名前・配線のテストと受け渡しを 1 つずつ外す変異（L-060）                                                         | 5                |
| 新しい状態と既存の入口（L-061）: 同じタブの押し直し（同期の再入の防止）・別のタブ（送った先で確かめる）・終了や閉じる（stale）・キー入力（変えない）                | 5                |
| ROADMAP の更新の方針・既知の制約の照合・実機テスト仕様書（既存の 6 項目の直しと AGT-243〜256・HTML の再生成・`npx vitest run scripts`・Artifact はコントローラー）  | 6                |

抜けは見つからなかった。「範囲の外」（送信・hooks による区別・再開・版の確認）はどのタスクにも入れていない（`promptSend` は `false` のまま）。

**2. 書きかけの検索:** `TBD`・`TODO`・「同じように」・説明だけのコードの Step を探した。テストの値の機械的な書き換え（`cliKind: 'claude'` の追加・`followUp: null` の追加・`...CLAUDE_INTERRUPT` の追加・消す定数の関数への置き換え）は、`perl` のコマンド（写しにかけて数を確かめたもの）か、置き換える前と後の文を書いた。台帳の SHA-256 は計画の時点で同じスクリプトから求めた値を書いた。`<実装の日>` は Step の中で求め方を書いた。ROADMAP の既知の制約は、Step 1 で照らし合わせた設計書の箇条書きを写すコマンドを書いた。

**3. 名前と型の一貫性:** `copilotScreen`・`CopilotScreenName`（Task 1）、`classifyClaudeScreen`・`classifyCopilotScreen`・`AGENT_SCREEN_CLASSIFIERS`・`classifyAgentScreenFor`（Task 2）、`classify(kind, lines)`・`agentNotificationText(kind, tabNumber, cliKind)`・`AgentNotificationTab.cliKind`・`overrideAgentCliCapabilities`・`unsupportedKinds`（Task 3）、`AGENT_CLI_INTERRUPT_SPECS`・`AgentSessionInterruptResult`・`interruptFollowUp()`・`monotonicNow`・`AgentInterruptFollowUpResult`・`interruptAgentSessionFollowUp`（Task 4）、`agentInterruptBlockedByActivityReason`・`describeAgentInterruptBlockedByActivity(activity, cliKind)`・`checkAgentInterruptFollowUp`・`AgentInterruptFollowUpOutcome`・`interruptFollowUp(slotId, sessionId)`・`restartCooldown`（Task 5）を、定義したタスクと使うタスクで照らし合わせた。

**作成中に直した点:**

- 台帳を作る前に、設計書の判定の規則を JavaScript に写し、段階 0 の記録の 48 画面すべてが期待どおりになること、手書きの画面の期待（18 通り）、`claude` の台帳の画面が `copilot` の規則で作業中にならないこと・`copilot` の作業中の画面が `claude` の規則で作業中にならない（入力待ち）ことを確かめ、テストの期待にした（`checkAgentInterruptAtPress` の `claude` として渡す場合の理由を `idle` の文言にした）
- 置き換えの前後の SHA-256・変わった行の数（41）・規則 1' を外すと残る行の数（4）を求め、Step の期待にした
- 記録の `segs` に反転が無いこと・全角の文字が無いこと・行の数が `attrs` の数と一致することを確かめ、変換のスクリプトの検査と README に書いた
- `prettier --check` に `.prettierignore` を渡すと「parser を推測できない」で落ちるため、確かめの対象から外した
- Task 3 で能力を変えると、能力に依っていた既存のテスト（中断の理由・通知の注記・使えない機能の注記・`copilot` で知らせないテスト）が落ちることに気づき、Task 3 で直す形にした（文言の関数への置き換えは Task 5）
- 共有の型の変更（Task 4）で renderer のテストの偽物の値が型エラーになることに気づき、Task 4 で `followUp: null` を足す形にした
- `useAgentWorkspace.test.ts` の偽物の `useAgentNotifications`（引数が `unknown` の型）に本物を差し込むと型が合わないため、包む形にした
