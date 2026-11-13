# エージェントの実行の中断の UI 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エージェント CLI 方式のターミナルパネルの帯に `中断` のボタンを置き、選択中のタブの `claude` が作業中のときだけ、ターミナルで `Esc` を 1 回押したのと同じ 1 バイト（`\x1b`）を専用の IPC `agentTerminal:interrupt` で送る。押せない理由・読み上げ・失敗の表示・連打の対策・フォーカスの扱いを含める。

**Architecture:** main は `AgentSession.interrupt()` が固定の `AGENT_INTERRUPT_SEQUENCE`（`'\x1b'`）を pty に書き、`AgentSessionRegistry.interrupt(ownerId, sessionId)` が `write` と同じ `findBySessionId` で今のセッションだけに送り、受け口 `agentTerminal:interrupt`（`invoke`）が送信元のフレームと `sessionId` を確かめて結果（`AgentInterruptResult`）を返す。renderer は、押せるかを純関数 `getAgentInterruptAvailability`（`lib/agentInterrupt.ts`）で決め、`useAgentSessions.interrupt(slotId)` が sessionId の持ち主として IPC を呼んで世代（`stale`）と失敗の表示を扱い、新しい hook `useAgentInterrupt` が押した処理（再入の防止・最新の値での判定・画面の読み直し・タブごとの 1,000ms の待ち・読み上げ）を組み立て、`useAgentWorkspace` が `AgentTerminalPanelState.interrupt` に載せる。`AgentTerminalPanel` は `終了` の直前に `aria-disabled` のボタンを描き、押せない理由を隠した `span` と `title` に出し、ダブルクリック・キーリピートを捨て、セッションが終わってボタンが消えたときにフォーカスを `起動`（押せなければ `エージェント`）へ移す。実装の最初に、中断の後の `claude` の画面を実物で記録して判定のテストに入れる。

**Tech Stack:** Electron（main・preload）, React 19, TypeScript, node-pty 1.1.0（実物の pty の統合テスト）, `@xterm/headless` 6.0.0（画面の記録）, Vitest（偽のタイマー・偽の pty）, Testing Library, 素の CSS（`main.css`。Tailwind 不使用）

**設計書:** `docs/superpowers/specs/2026-10-19-agent-interrupt-ui-design.md`（承認済み。実装の前に必ず読む）。このプランは設計書の「実装の分割」の **タスク 1〜6 のすべて**（タスク 4 は境目を保ったまま 4a・4b に分けた）。各タスクで読む節はタスクの冒頭に書いた。書き方の参考は `docs/superpowers/plans/2026-10-15-agent-changes-non-git-folder.md`。

**反映する知見（設計書の「反映した知見」。dev-flow-kit の `lessons/review-lessons.md`）:** L-001・L-019・L-020・L-037・L-041・L-048・L-052・L-053・L-055・L-057・L-058・L-059・L-060・L-061・L-072・L-354・L-408（各タスクの冒頭の「気をつける知見」に、そのタスクで効くものを書いた）

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
>
> - 設計書のタスク 4 を **Task 4a（`useAgentSessions.interrupt`）と Task 4b（`useAgentInterrupt` と `useAgentWorkspace` の配線）** に分ける。4a だけを差し戻せる境目（4a の終わりで `AgentSessionsState.interrupt` が必須になり、呼ぶ側はまだ無い）。
> - `AgentInterruptResult` は設計書の表では `src/shared/types.ts` だが、エージェントのターミナルの型は **`src/shared/types/agentTerminal.ts`** にあり、`src/shared/types.ts` が `export type * from './types/agentTerminal'` で再 export している。型はそちらに足す（`@shared/types` から import できる）。
> - 読み上げの要素（`role="status"` の `p`）の class は、設計書の `.agent-announcer` ではなく **`agent-terminal-panel__live`** にし、`main.css` の視覚的に隠す規則（`.external-change-banner__live, .agent-diff__live, .agent-announcer, .agent-send-feedback__live`）の並びに足す。理由: `App.agentCli.test.tsx` が `container.querySelector('.agent-announcer')` で App の常設の読み上げ（パネルの外・`aria-live`）を探しており、パネルの中に同じ class の要素が先に現れるとそちらを拾って落ちる。見た目（隠し方）は同じ。
> - 帯に `中断` を出すかは、`useAgentInterrupt` が選択中のタブの状態から求めた **`interrupt.visible`** で決める（パネルは状態を見直さない）。`AgentTerminalPanel.test.tsx` の「`starting`・`running` で出て `none`・`exited` で出ない」は、本番と同じ組（`starting`・`running` は `visible: true`、`none`・`exited` は `visible: false`）を渡して確かめ、状態から `visible` を決める規則そのものは `agentInterrupt.test.ts`・`useAgentInterrupt.test.ts` で固定する。
> - `onInterrupt` の手順 2 の「押してから 1,000ms 以内か」は、描画用の state ではなく **タブごとのタイマーの `Map`（ref。常に最新）** で読む（設計書の「最新の値」と同じ意味で、描き直しの前に押されても漏れない）。手順 1 で結果を待つタブは既に除いているので、手順 2 の `isInterrupting` は「1,000ms の待ちのタイマーがあるか」だけになる。
> - 押せない理由の活動ごとの文言は `lib/agentSessionMessages.ts` の **`AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY`**（`Record<Exclude<AgentActivity, 'working'>, string>`）に置き、`lib/agentInterrupt.ts` の `describeAgentInterruptBlockedByActivity` はそれを引く（文言は文言のファイルに集める。活動を増やしたときの決め忘れは `Record` の型エラーになる）。
> - 読み上げを消すまでの時間は `useAgentInterrupt.ts` の **`AGENT_INTERRUPT_NOTICE_MS = 3_000`**（設計書の 3,000ms）。
> - フォーカスの控え（`lastFocusedWasInterruptRef`）は、`中断` が出す状態から出さない状態に変わった描画のたびに false に戻す（移した・移さないに関わらず。移さなかった場合に古い控えが次の回に残らないようにする）。
> - 配線のテスト（L-060）は `useAgentWorkspace.test.ts` に置く。このファイルは `useAgentSessions` を偽物に差し替えているため、新しい `describe` の中だけ **`vi.importActual` で本物の `useAgentSessions` を `mockImplementation` に入れ**、`window.api.startAgentSession`・`window.api.interruptAgentSession` を `vi.spyOn` で差し替えて、本物の組み立て役から `window.api` まで届くことを確かめる（`useAppState.agent.test.ts` は `useAgentWorkspace` ごと偽物なので使わない）。
> - テストの既定の `window.api`（`src/renderer/src/__tests__/setup.ts`）と `agentTerminalApi.test.ts` の `mockApi` に `interruptAgentSession` を足す（Task 2）。
> - 中断の後の画面の記録（Task 1）は、記録用のディレクトリを **実装者のスクラッチパッドの中の `fixrec`**（`/private/tmp/claude-<UID>/-Users-<…>/<…>/scratchpad/fixrec` の形。既存の 28 画面を記録した場所と同じ形で、`sanitize.py` の規則 1・2 がこの形のパスを置き換える）に作り、`node-pty`・`@xterm/headless` は **このリポジトリの `node_modules` へのシンボリックリンク**で使う（版が記録用の README と同じ 1.1.0・6.0.0 であることを確かめてから。ネットワークからの取得をしない）。`interruptqueued` は、貼り付けた文字そのものに `queued` が含まれて待ちがすぐ終わるため、キューの案内（`edit queued messages` か `ctrl+s to send now`）が出るのを待つ。`interruptdraft` は `toolrun` と同じく `sleep 6` が出てから 1,200ms 待ってから書きかけを打つ（ツールが動き出してから打つため）。

## Global Constraints

- コメント・文言・ログは日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`（`AgentTerminalPanel.tsx` は既に付いている）。`any` を使わない。テストの補助関数にも戻り値の型を書く（`@typescript-eslint/explicit-function-return-type`）
- **コミット・プッシュはしない**（CLAUDE.md。利用者の明示の指示があるまで行わず、後の工程でまとめて行う）。各タスクの最後の Step は「検証」
- **実物の `claude` は Task 1 の記録でだけ起動する**（隔離した `CLAUDE_CONFIG_DIR`・ダミーの API キー・偽のサーバー〈`exp3.js`〉。Anthropic の API には接続しない）。実機（Electron）の確認は利用者がまとめて行う（Task 6 で実機テスト仕様書に追記する）。プランに実機の手順は書かない
- 各タスクの終わりで次が通る状態を保つ: `npx vitest run`（全テスト）・`npm run typecheck`・変更・作成した TypeScript のファイルへの `npx eslint --max-warnings 0 <ファイル>` と `npx prettier --check <ファイル>`（`npx eslint --fix`・`npx prettier --write` で直してから確かめてよい）。型を変えるタスクは、型に追随する呼び出し元・テストの補助・既存のテストを同じタスクで直す
- **このマシンは負荷が高く、`npx vitest run` の全体でテストが時間切れ（`Test timed out`・`waitFor` の打ち切り）で落ちることがある。** 落ちたら、落ちたファイルを `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書いて先へ進む。単体でも落ちれば本当の失敗として直す
- **シェルで `path` を変数名に使わない**（zsh では `path` が `PATH` と結び付いた配列で、代入すると `PATH` が壊れる）
- **シェルの変数（Task 1 の `W`・`WORK_REAL`・`BAK` など）は Bash の呼び出しをまたいで残らない。** 呼び出しごとに先頭で設定し直す（Task 1 の各コードブロックの先頭の `W="<スクラッチパッド>/fixrec"` と `test -d "$W"` の 2 行。Step 4 だけは作る前なので `test ! -e`）
- `ROADMAP.md` は prettier にかけない（今も prettier の書式に揃っていないため、かけると無関係な差分が出る）。`src/renderer/src/lib/__tests__/fixtures/agentScreens.json` も prettier・エディタで整形しない（`.prettierignore` 済み）
- 「変異で確かめる」の Step は、書いた実装の一部を一時的に戻して該当のテストが落ちることを確かめ、必ず元に戻す（戻したことを `git diff` で確かめる）。`act(...).then(...)` の形でテストを書かない。`console.*` の spy と `vi.spyOn(window.api, …)` は `afterEach`（か `finally`）で戻す。偽のタイマーを使うテストは `afterEach` で `vi.clearAllTimers()`・`vi.useRealTimers()` を呼ぶ

### 設計書の決めたこと（一字一句。設計書「決めたこと（利用者の確認済み）」）

- **中断の手段**: 選択中のタブの `claude` に `Esc` を 1 回（`\x1b`）送る。ターミナルで `Esc` を押すのと同じ。`Ctrl+C` は 2 回で `claude` が終了するため使わない（MVP の確認の結果 16）。pty を止める（kill）のは既存の `終了` が担う
- **押せる条件**: 選択中のタブの活動の判定（renderer の `classifyAgentScreen`・`useAgentActivity` の `activities`）が `working` のときだけ押せる。`permission`・`confirm`・`idle`・`unknown` では押せず、押せない理由を出す（許可待ちでの `Esc` は許可の拒否、入力待ちでの `Esc` の 2 回目は書きかけの消去になるため）
- **置き場**: ターミナルパネルの帯（`AgentTerminalPanel.tsx`。状態の文言と `終了` の並び）

### 設計書の決めたこと（推奨案で決めた事項。一字一句）

- **対象の方式**: エージェント CLI 方式だけ。従来の方式（API・非対話 CLI）には出力パネルの `キャンセル`（`aria-label="実行をキャンセル"`。`usePromptExecution.cancelExecution`）が既にあり、変えない
- **対象のタブ**: 選択中のタブだけ。`すべて中断` は置かない
- **確認のダイアログ**: 出さない（会話を失わない軽い操作で、ターミナルの `Esc` 1 回と同じ）。代わりに連打の対策を入れる（「連打の対策」。L-408）。2 回目の `Esc` は、入力待ちの画面で 0.5 秒以内に届くと入力欄の書きかけを消しうる（MVP の確認の結果 17）ため、押した後 1,000ms は押せなくする
- **送信の途中**: `useAgentPromptSender` の送信中（`isSending`）・送信前の確認のダイアログの表示中は押せない。送信の手順（消去・貼り付け・Enter）と `Esc` が混ざると、貼り付けの確認が外れる・確認の画面への送り込みを防げない（MVP の「確認画面の最中に誤って送らないための条件」）ため
- **IPC**: 既存の `writeAgentSession`（任意の文字列）に `\x1b` を流さず、専用の IPC `agentTerminal:interrupt` にする。renderer からは `sessionId` だけを受け取り、main が固定の 1 バイトを書く（L-019）。メインフレームの確認・セッションの存在・世代（今のセッションの `sessionId` との一致）の確認は既存の `agentTerminal:write` と揃える（L-037）。結果は `invoke` で返す（L-001）
- **送った後の表示**: 読み上げ（既存の常設の `aria-live` と同じ作り。`useTransientNotice`・`toAnnouncementText`・`.agent-announcer`）で `claude 1 に中断（Esc）を送りました` を伝える。中断の成否（作業が止まったか）は `claude` の画面の判定（`working` が終わる）で分かるので、アプリは送れたかどうかだけを扱う（L-001）
  - **読み替え（計画の時点で設計書から調整した細部）**: 上の `.agent-announcer` は、class を **`agent-terminal-panel__live`** に読み替える（隠し方は `main.css` の同じ規則。冒頭の「調整した細部」の 3 つ目）。設計書の文言は Task 6 Step 1 で細部の節を直して補う
- **エージェントの変更の確認**: 帯の `中断` はターミナルの `Esc` とバイト列が同じなので、2026-10-13 の設計書の「中断（Esc）の後」の扱い（`Stop` が届かず、30 秒後に次の指示まで割り当てを保留）がそのまま当てはまる。アプリは中断を hooks・作業の区間の追跡に知らせない（「既存の機能との関係」）

### 設計で決めた細部（一字一句。設計書「設計で決めた事項」）

- **押せない状態の作り**: `disabled` ではなく `aria-disabled="true"` にし、押した処理の先頭で同じ純関数で判定して送らない（理由を読み上げる。L-058）。理由: 押して中断が効くと活動が `idle` に変わり、ボタンはすぐ押せなくなる。`disabled` にするとフォーカスが body に落ち、隣の `終了` などへ逃がすとキーリピートで会話を失う（L-408）。`aria-disabled` ならフォーカスは押したボタンに残り、押せない理由（`aria-describedby`）もキーボードで届く（L-057）
- **出す間**: セッションが `starting`・`running` の間（`終了` と同じ `isActive`）。未起動・終了の帯は変えない（`起動`・`前回の続きから` の並びと狭い幅の扱いをそのまま保つ）
- **押した時点の判定のやり直し**: 押した処理で、描画に使った活動に加えて、その場で `classifyAgentScreen(controller.readScreen())` を読み直し、`working` のときだけ送る。活動の判定は出力が 150ms 静まってから（最大 500ms 遅れて）行うため、作業中から許可の確認へ変わった直後に古い `working` のまま押されて、許可を拒否するのを防ぐ
- **押せない理由の伝え方**: 見える文字にはしない（`title` と `aria-describedby` だけ。「画面」）。押せない状態で押したときは、押した処理の手順 2（描画の値での判定）・手順 3（画面の読み直し）のどちらで止めても、`useAgentInterrupt` が同じ読み上げの要素（`notice`）に理由を入れる（読み上げるのは `useAgentInterrupt` だけ。部品は読み上げを持たない）。既存の `起動` の帯（`aria-hidden` の見える理由と、説明用の隠した `span` の組）と違い、見える理由の行を足さない。理由: 入力待ちの間ずっと理由の文を帯に出すと、狭い帯で状態の文言・タブ列を押し出すため。代わりに、晴眼のキーボード利用者には理由の文は見えない（`title` はマウスでだけ出る）。見えるのは隣の状態の文言（`入力待ち` など）と薄い色で、押して何も起きないことから押せないと分かる（「既知の制約」）
- **中断の待ちの単位**: タブごと。結果を待つ間（送っている途中）と 1,000ms の待ちを、どちらも `slotId` の集合で持つ（同期の再入の防止は ref の `Set<slotId>`、描画用は state）。タブ A の結果を待つ間でも、作業中のタブ B の `中断` は押せる。押せない理由の判定（`isInterrupting`）は選択中のタブがどちらかの集合に入っているか
- **フォーカスの控え方**: パネルの `section` の `onFocus`（`focusin` で泡立つ）だけで「パネルの中で最後にフォーカスを受けた要素が `中断` か」を ref に控える。`onBlur` では消さない（ウィンドウが非アクティブになったときや、Chromium が要素を DOM から外したときにも `blur` が出るため）。奪わない判定は、移す時点の `document.activeElement` が body か null かに任せる（「フォーカス」）
- **押し続け・連打**: 押してから 1,000ms は押せない（「連打の対策」）。`click` の `event.detail > 1` を無視し、`Enter`・`Space` のリピートの `keydown` を `preventDefault` する（L-408）
- **失敗の表示**: 送れなかったときは、`終了` の失敗と同じく、そのタブの `error`（帯の下の `role="alert"`）に出す（L-048）。次の `起動` で消える（既存の規則）。中断を送れたときは、そのタブの `error` が中断の失敗の文言なら消す
- **ショートカット**: 足さない（ターミナルの `Esc` がそのまま使える）

### 連打の対策（一字一句。設計書「連打の対策」）

- **1,000ms の待ち**: 押してから 1,000ms（`AGENT_INTERRUPT_COOLDOWN_MS`）は、そのタブの `中断` を押せない（理由 `中断を送りました。まだ作業中なら、少し待つと押せます`）。過ぎた後は通常の条件（作業中か）に戻る
- **同期の再入の防止**: `interruptingSlotsRef`（`Set<slotId>`）で、同じタブの IPC の結果を待つ間の 2 回目を止める。別のタブは止めない（待ちはタブごと）
- **ダブルクリック**: `click` の `event.detail > 1` を無視する（キーボードのクリックは `detail` が 0 なので影響しない。L-408）
- **キーリピート**: ボタンの `keydown` で `event.repeat` の `Enter`・`Space` を `preventDefault` する（単発の `Enter`・`Space`・マウス・タッチは影響しない。L-408）

- 1,000ms の待ち・フォーカスを押したボタンに残すこと・リピートとダブルクリックの抑止は組で働く。実装のコメントに組であることを書く（L-408）

### 文言（一字一句。実機テスト仕様書もこの文字列で書く。正は `src/renderer/src/lib/agentSessionMessages.ts`）

- 見える文字: `中断`（`AGENT_INTERRUPT_LABEL`）
- `aria-label`: `中断（作業中の claude に Esc を送る）`（`AGENT_INTERRUPT_ARIA_LABEL`）
- 押せない理由（設計書「押せない理由の文言」。判定の順もこの順）:

- **`starting`**: `起動中は中断できません`
- **閉じる途中（`isClosing`）**: `閉じる途中のタブは中断できません`
- **送信中（`isSending`）**: `プロンプトを送信している間は中断できません`
- **送信前の確認の表示中**: `送信前の確認を開いている間は中断できません`
- **送っている途中・押してから 1,000ms 以内**: `中断を送りました。まだ作業中なら、少し待つと押せます`
- **活動が `permission`**: `許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）`
- **活動が `confirm`**: `確認待ちのため中断できません（ターミナルで選んでください）`
- **活動が `idle`**: `入力待ちのため、中断する作業がありません`
- **活動が `unknown`**: `作業中か判定できないため押せません（ターミナルで Esc を押すと中断できます）`

- 動いていない（`none`・`exited`。帯には出さない）: `claude が動いていないため中断できません`（`AGENT_INTERRUPT_NOT_RUNNING`）
- 送れたときの読み上げ: `claude 1 に中断（Esc）を送りました`（`claude 1` は押した時点のタブのラベル。`agentInterruptSentNotice(label)` が `` `${label} に中断（Esc）を送りました` `` を返す）
- 失敗の接頭辞: `中断を送れませんでした: `（`AGENT_INTERRUPT_ERROR_PREFIX`。`AGENT_STOP_ERROR_PREFIX` と同じ形）
- `no-session`: `中断を送れませんでした: claude が終了したか、起動し直しました`（`AGENT_INTERRUPT_ERROR_NO_SESSION`）
- `write-failed`: `中断を送れませんでした: ターミナルへの書き込みに失敗しました`（`AGENT_INTERRUPT_ERROR_WRITE_FAILED`）
- `invoke` の拒否・同期の例外: `中断を送れませんでした: <例外の message>`（`agentInterruptError(message)`）

### 型・関数の名前（後のタスクはこの名前と型で使う）

- shared（`src/shared/types/agentTerminal.ts`。Task 2）: `export type AgentInterruptResult = { kind: 'sent' } | { kind: 'no-session' } | { kind: 'write-failed' }`
- main（Task 2）: `export const AGENT_INTERRUPT_SEQUENCE = '\x1b'`・`AgentSession.interrupt(): 'sent' | 'not-alive' | 'write-failed'`（`agentSession.ts`）、`AgentSessionRegistry.interrupt(ownerId: number, sessionId: string): AgentInterruptResult`（`agentSessionRegistry.ts`）、IPC のチャンネル `'agentTerminal:interrupt'`（`handlers/agentTerminalHandlers.ts`。`AgentTerminalHandlerDeps.registry` の `Pick` に `'interrupt'`）
- preload（Task 2）: `interruptAgentSession: (sessionId: string): Promise<AgentInterruptResult>`（`api.ts`・`index.d.ts`）
- renderer の窓口（Task 2）: `interruptAgentSession(sessionId: string): Promise<AgentInterruptResult>`（`lib/agentTerminalApi.ts`）
- renderer の純関数（`lib/agentInterrupt.ts`。Task 3）: `AGENT_INTERRUPT_COOLDOWN_MS = 1_000`・`AgentInterruptAvailabilityInput`・`AgentInterruptAvailability`・`getAgentInterruptAvailability(input): AgentInterruptAvailability`・`describeAgentInterruptBlockedByActivity(activity: Exclude<AgentActivity, 'working'>): string`
- renderer の文言（`lib/agentSessionMessages.ts`。Task 3）: `AGENT_INTERRUPT_LABEL`・`AGENT_INTERRUPT_ARIA_LABEL`・`AGENT_INTERRUPT_NOT_RUNNING`・`AGENT_INTERRUPT_DISABLED_STARTING`・`AGENT_INTERRUPT_DISABLED_CLOSING`・`AGENT_INTERRUPT_DISABLED_SENDING`・`AGENT_INTERRUPT_DISABLED_SEND_CONFIRM`・`AGENT_INTERRUPT_DISABLED_COOLDOWN`・`AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY`・`agentInterruptSentNotice(label)`・`AGENT_INTERRUPT_ERROR_PREFIX`・`AGENT_INTERRUPT_ERROR_NO_SESSION`・`AGENT_INTERRUPT_ERROR_WRITE_FAILED`・`agentInterruptError(message)`
- `hooks/useAgentSessions.ts`（Task 4a）: `export type AgentInterruptOutcome = { kind: 'sent' } | { kind: 'skipped' } | { kind: 'stale' } | { kind: 'no-session' } | { kind: 'write-failed' } | { kind: 'error'; message: string }`・`AgentSessionsState.interrupt: (slotId: string) => Promise<AgentInterruptOutcome>`（必須）
- `hooks/useAgentInterrupt.ts`（Task 4b）: `AGENT_INTERRUPT_NOTICE_MS = 3_000`・`AgentInterruptPanelState`（`visible: boolean`・`disabledReason: string | null`・`notice: Announcement | null`・`onInterrupt: () => void`）・`UseAgentInterruptOptions`（`selected: AgentSessionTabView`・`activities: ReadonlyMap<string, AgentActivity>`・`isSending: boolean`・`isSendConfirmOpen: boolean`・`interrupt: (slotId: string) => Promise<AgentInterruptOutcome>`）・`useAgentInterrupt(options): AgentInterruptPanelState`
- `hooks/useAgentWorkspace.ts`（Task 4b）: `AgentTerminalPanelState.interrupt: AgentInterruptPanelState`（必須）
- テストの補助: `makeAgentSessionsState` の `interrupt`（既定は `{ kind: 'sent' }` を返す `vi.fn`。Task 4a）、`makeAgentInterruptPanelState(overrides)`（`src/renderer/src/__tests__/makeAgentTerminalPanelState.ts`。既定は `visible: false`・`disabledReason: null`・`notice: null`・`onInterrupt: vi.fn()`。Task 4b）
- 画面: ボタンの class は共通の `agent-terminal-panel__button`、読み上げの要素は `p.agent-terminal-panel__live`（`role="status"`）、CSS は `.agent-terminal-panel__button[aria-disabled='true']`（`opacity: 0.5`・`cursor: default`）と `.agent-terminal-panel__button[aria-disabled='true']:hover`（`background: none`・`color: #cccccc`。既存の `.agent-terminal-panel__button:hover:not(:disabled)` より後ろに置く）

### ファイルの構成（作る・変えるもの）

| ファイル                                                                                                                                                          | 責務                                                                         | タスク |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| `.superpowers/agent-terminal-mvp/agent-screens-recorder/exp3.js`・`README.md`（git 管理外）                                                                       | 中断用の 3 つのモード・手順 3 の追記                                         | 1      |
| `.superpowers/agent-terminal-mvp/agent-screens.json`（git 管理外。元の台帳）                                                                                      | 中断の後の 4 画面・`_note` の版                                              | 1      |
| `src/renderer/src/lib/__tests__/fixtures/agentScreens.json`・`agentScreens.ts`・`README.md`                                                                       | 置き換えた台帳・冒頭のコメント・版・画面の数・SHA-256・変わった行の数        | 1      |
| `src/renderer/src/lib/__tests__/agentScreensFixture.test.ts`・`agentActivity.test.ts`                                                                             | `AGENT_SCREENS_SHA256`・`EXPECTED` と上のコメント                            | 1      |
| `docs/superpowers/specs/2026-10-19-agent-interrupt-ui-design.md`                                                                                                  | 「既知の制約」へ記録の結果（1）・実装との照合と調整した細部の反映（6）       | 1・6   |
| `src/shared/types/agentTerminal.ts`                                                                                                                               | `AgentInterruptResult`                                                       | 2      |
| `src/main/agentSession.ts`・`src/main/agentSessionRegistry.ts`・`src/main/handlers/agentTerminalHandlers.ts`                                                      | `AGENT_INTERRUPT_SEQUENCE`・`interrupt`・受け口                              | 2      |
| `src/preload/api.ts`・`src/preload/index.d.ts`・`src/renderer/src/lib/agentTerminalApi.ts`・`src/renderer/src/__tests__/setup.ts`                                 | `interruptAgentSession`（窓口・型・テストの既定）                            | 2      |
| `src/renderer/src/lib/agentInterrupt.ts`（新規）・`src/renderer/src/lib/agentSessionMessages.ts`                                                                  | 押せるかの純関数・文言                                                       | 3      |
| `src/renderer/src/hooks/useAgentSessions.ts`・`src/renderer/src/__tests__/makeAgentSessionsState.ts`                                                              | `interrupt`・`AgentInterruptOutcome`・テストの既定                           | 4a     |
| `src/renderer/src/hooks/useAgentInterrupt.ts`（新規）・`src/renderer/src/hooks/useAgentWorkspace.ts`・`src/renderer/src/__tests__/makeAgentTerminalPanelState.ts` | 押した処理・待ち・読み上げ・配線・テストの既定                               | 4b     |
| `src/renderer/src/components/agent/AgentTerminalPanel.tsx`・`src/renderer/src/assets/main.css`                                                                    | ボタン・隠した理由・読み上げの要素・フォーカスの移し先・`aria-disabled` の色 | 5      |
| `ROADMAP.md`・`docs/manual-test-spec.md`（と生成物 `.superpowers/manual-test-spec.html`）                                                                         | ROADMAP の更新・AGT-214〜227・AGC-146〜147                                   | 6      |

---

### Task 1: 中断の後の画面の記録（台帳・判定のテスト）

> **設計書の読む節:** 「実装の最初に確かめること」（1〜5 のすべて）、「テスト方針」の `agentScreensFixture.test.ts`・活動の判定、「既知の制約」、「構成」の fixtures の 5 行。記録用の手順 `.superpowers/agent-terminal-mvp/agent-screens-recorder/README.md`（安全のための条件）と `src/renderer/src/lib/__tests__/fixtures/README.md`（個人情報の置き換え）も読む。
>
> **気をつける知見:** L-059（中断の後の画面を実物で記録して判定のテストに入れる）・L-072（利用者の環境を壊さない。隔離した設定・ダミーのキー・偽のサーバー。残ったプロセスは自分のものと確かめられたものだけを止める）

この Task では製品のコード（`src/` の `.ts`・`.tsx` のうちテスト以外）を変えない。**`classifyAgentScreen` の判定の規則は変えない**（判定が外れた画面は、外れた活動のまま `EXPECTED` に入れて「既知の制約」に書く。範囲外）。

**Files:**

- Modify（git 管理外）: `.superpowers/agent-terminal-mvp/agent-screens-recorder/exp3.js`・`.superpowers/agent-terminal-mvp/agent-screens-recorder/README.md`・`.superpowers/agent-terminal-mvp/agent-screens.json`
- Modify: `src/renderer/src/lib/__tests__/fixtures/agentScreens.json`（`sanitize.py` で写す。手で編集しない）
- Modify: `src/renderer/src/lib/__tests__/fixtures/agentScreens.ts`（冒頭のコメント）・`src/renderer/src/lib/__tests__/fixtures/README.md`
- Modify: `src/renderer/src/lib/__tests__/agentScreensFixture.test.ts`（`AGENT_SCREENS_SHA256`）・`src/renderer/src/lib/__tests__/agentActivity.test.ts`（`EXPECTED` と上のコメント）
- Modify: `docs/superpowers/specs/2026-10-19-agent-interrupt-ui-design.md`（「既知の制約」）
- 作業用（スクラッチパッドの中。Step 13 で消す）: `<スクラッチパッド>/fixrec/`
- 控え（git 管理外。Step 14 の検証が通ったら消す）: `.superpowers/agent-terminal-mvp/agent-screens.json.bak-2026-10-19`（元の台帳の足す前の控え）

**Interfaces:**

- Consumes: 既存の `exp3.js`（`permission`・`streaming`・`toolrun`）・`rec.js` の `PB`・`fixtures/README.md` の `sanitize.py`・`agentScreen(name)`・`classifyAgentScreen`
- Produces: 台帳の画面 `interrupted`・`interruptedDraft`・`streamingQueued`・`interruptedQueued`（`AgentScreenName` に入る。Task 4b のテストは使わないが、Task 6 の既知の制約がこの結果を写す）

- [ ] **Step 1: 記録の前の確かめ（版・残っているプロセス・元の台帳）**

Run:

```bash
cd <repo-root>
# 版の確かめも、利用者の ~/.claude を使わない(隔離した一時の設定・自動更新と不要な通信を止める)
VERSION_CFG=$(mktemp -d "${TMPDIR:-/tmp}/claude-version-cfg.XXXXXX")
echo "VERSION_CFG=$VERSION_CFG"
CLAUDE_CONFIG_DIR="$VERSION_CFG" DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 ~/.local/bin/claude --version
case "$VERSION_CFG" in
  */claude-version-cfg.*) ls -A "$VERSION_CFG"; rm -r "$VERSION_CFG" && ! test -e "$VERSION_CFG" && echo "一時の設定を消しました" ;;
  *) echo "想定外のパス: $VERSION_CFG"; exit 1 ;;
esac
node -e "console.log(require('./node_modules/node-pty/package.json').version, require('./node_modules/@xterm/headless/package.json').version)"
shasum -a 256 .superpowers/agent-terminal-mvp/agent-screens.json
pgrep -fl "local/bin/claude" || true
```

Expected:

- `claude --version` の行は `<版> (Claude Code)`（計画の時点では `2.1.291`）。この `<版>` を以下 **`V`** と書く（以後の版の記述に使う）
- 一時の設定（`VERSION_CFG`）の中身（`ls -A` の出力。空でなければ何ができたか）を控え、`一時の設定を消しました` が出る（`想定外のパス` が出たら止めて報告する）
- `node -e` の行は `1.1.0 6.0.0`（記録用の README と同じ版。違えば止めて報告する）
- 元の台帳の SHA-256 が `95518dc8e65f2deb885a50e323053a65bf5fc0d15e9436b66c897c7893af800d`（`fixtures/README.md` の「元の台帳」の値。違えば止めて報告する）
- `pgrep` の出力（利用者が動かしている `claude` が出うる）を **記録の前の一覧** として控える。この一覧の pid には以後いっさい触れない

- [ ] **Step 2: `exp3.js` に中断用の 3 つのモードを足す（既存のモードは変えない）**

`.superpowers/agent-terminal-mvp/agent-screens-recorder/exp3.js` を次のとおり直す（git 管理外のため PR には入らない）。

1. 先頭の 2 行目のコメント `// node exp3.js <mode>   mode: permission | streaming | toolrun` を次にする:

```js
// node exp3.js <mode>   mode: permission | streaming | toolrun | interrupt | interruptdraft | interruptqueued
// interrupt・interruptqueued は streaming と同じ応答、interruptdraft は toolrun と同じ応答(sleep 6 のツール)で、作業中に \x1b を 1 回書く
```

2. `const mode = process.argv[2]` の行の直後に次の 3 行を足す:

```js
const PB = (t) => '\x1b[200~' + t + '\x1b[201~' // rec.js の PB と同じ(括弧付きの貼り付け)
const STREAMING_MODES = new Set(['streaming', 'interrupt', 'interruptqueued'])
const TOOLRUN_MODES = new Set(['toolrun', 'interruptdraft'])
```

3. 偽のサーバーの `if (mode === 'streaming' || mainCalls > 1) {` を `if (STREAMING_MODES.has(mode) || mainCalls > 1) {` にする
4. `const command = mode === 'toolrun' ? 'sleep 6' : 'echo hi > out.txt'` を `const command = TOOLRUN_MODES.has(mode) ? 'sleep 6' : 'echo hi > out.txt'` にする
5. `} else if (mode === 'toolrun') {` の分岐の閉じ括弧（`await sleep(6000); show('toolrun later (interrupted?)')` の次の行の `}`）の直前に、次の 3 つの分岐を足す（`else if` で続ける。見張り〈`DANGER`〉と確認画面で Enter を送らない条件はそのまま）:

```js
  } else if (mode === 'interrupt') {
    // 作業中(応答の表示中)に Esc を 1 回。描き直しが落ち着くまで 2,000ms 待つ
    const ok = await waitFor(/word5/, 15000); show('interrupt streaming ok=' + ok)
    p.write('\x1b'); await sleep(2000); show('interrupted'); dump('interrupted')
  } else if (mode === 'interruptdraft') {
    // ツールの実行中に書きかけを打ち、300ms 後に Esc を 1 回(書きかけが残るか。MVP の確認の結果 15 の再確認)
    const ok = await waitFor(/sleep 6/, 15000); await sleep(1200); show('interruptdraft running ok=' + ok)
    p.write('draft during tool'); await sleep(300); p.write('\x1b'); await sleep(2000)
    show('interruptedDraft'); dump('interruptedDraft')
  } else if (mode === 'interruptqueued') {
    // 応答の表示中に括弧付きの貼り付けと Enter でキューを作り、キューの案内が出たら記録してから Esc を 1 回
    const ok = await waitFor(/word5/, 15000); show('interruptqueued streaming ok=' + ok)
    p.write(PB('queued message')); await sleep(300); p.write('\r')
    // 貼り付けた文字そのものに queued が含まれるため、キューの案内で待つ
    const queued = await waitFor(/edit queued messages|ctrl\+s to send now/, 4000); await sleep(300)
    show('streamingQueued queued=' + queued); dump('streamingQueued')
    p.write('\x1b'); await sleep(2000)
    // 中断の後にキューが送られると、偽のサーバーは 2 回目の要求にも同じ応答を返す(mainCalls > 1)
    show('interruptedQueued mainCalls=' + mainCalls); dump('interruptedQueued')
```

6. `node --check .superpowers/agent-terminal-mvp/agent-screens-recorder/exp3.js` が何も出さずに終わることを確かめる

- [ ] **Step 3: 記録用の README の手順 3 に書き足す**

`.superpowers/agent-terminal-mvp/agent-screens-recorder/README.md` の手順 3 の項目（`3. \`node rec.js <場面>\`` で始まる段落）の最後の行（`` `{"permissions":{"allow":["Bash(sleep:*)"]}}` を置く）。`out/<場面>.json` ができる``）の直後に、次の行を足す（字下げは手順 3 の 2 行目と同じ 3 つの空白）:

```text
   中断の後の画面（2026-10-19 に追加。設計書 `docs/superpowers/specs/2026-10-19-agent-interrupt-ui-design.md` の「実装の最初に確かめること」）は `node exp3.js interrupt|interruptdraft|interruptqueued`（`interruptdraft` は `toolrun` と同じく `Bash(sleep:*)` の許可を置く）。`out/interrupted.json`・`out/interruptedDraft.json`・`out/streamingQueued.json`・`out/interruptedQueued.json` ができる。記録の場所は、既存の画面と同じ形のパス（`/private/tmp/claude-<UID>/-Users-<…>/…/scratchpad/fixrec`）にする（`fixtures/README.md` の置換の規則がこの形のパスを置き換える）。`node-pty`・`@xterm/headless` は、版が同じならリポジトリの `node_modules` へのシンボリックリンクで使ってよい
```

- [ ] **Step 4: 記録用のディレクトリを用意する（隔離した設定・ダミーのキー）**

`<スクラッチパッド>` は、実装者のスクラッチパッドのディレクトリ（`/private/tmp/claude-<UID>/-Users-<…>/<…>/scratchpad` の形）。違う形の場所しか使えないときは止めて報告する（置換の規則が効かない）。

Run:

```bash
W="<スクラッチパッド>/fixrec"
test ! -e "$W" || { echo "既にあります: $W"; exit 1; }
mkdir -p "$W/work" "$W/out" "$W/cfg"
cp <repo-root>/.superpowers/agent-terminal-mvp/agent-screens-recorder/exp3.js "$W/"
ln -s <repo-root>/node_modules "$W/node_modules"
git -C "$W/work" init -q
WORK_REAL=$(cd "$W/work" && pwd -P)
KEY_TAIL=$(node -e "console.log('sk-ant-dummy-not-a-real-key-000000000000'.slice(-20))")
WORK_REAL="$WORK_REAL" KEY_TAIL="$KEY_TAIL" node -e "
const fs = require('fs')
const config = {
  hasCompletedOnboarding: true,
  customApiKeyResponses: { approved: [process.env.KEY_TAIL], rejected: [] },
  projects: { [process.env.WORK_REAL]: { hasTrustDialogAccepted: true } }
}
fs.writeFileSync(process.argv[1], JSON.stringify(config, null, 2))
" "$W/cfg/.claude.json"
printf '{"permissions":{"allow":["Bash(sleep:*)"]}}\n' > "$W/cfg/settings.json"
ls -la "$W" "$W/cfg"
```

Expected: `exp3.js`・`node_modules`（リンク）・`work`・`out`・`cfg` があり、`cfg` に `.claude.json`・`settings.json` がある。キーはダミー（`exp3.js` の `sk-ant-dummy-not-a-real-key-000000000000`）で、`ANTHROPIC_BASE_URL` は `exp3.js` が立てるローカルの偽のサーバー。利用者の `~/.claude` は使わない・書き換えない

- [ ] **Step 5: 3 つのモードで記録する**

Run（1 つずつ。どれかが `DANGER` を出す・終了コードが 0 でないときは、残りを実行せずに Step 6 で後始末をしてから止めて報告する）:

```bash
W="<スクラッチパッド>/fixrec"
test -d "$W" || { echo "W がありません: $W"; exit 1; }
cd "$W" && node exp3.js interrupt; echo "exit=$?"
cd "$W" && node exp3.js interruptdraft; echo "exit=$?"
cd "$W" && node exp3.js interruptqueued; echo "exit=$?"
ls -la "$W/out"
```

Expected: 3 回とも `exit=0`、`DANGER` は出ない。`out/` に `interrupted.json`・`interruptedDraft.json`・`streamingQueued.json`・`interruptedQueued.json` の 4 つ。各回の `=====` の見出しの画面と、最後の `LOG` の行（`POST /v1/messages… tools=<数>` の行。`tools` が 5 を超える行がメインの要求）を控える。`interruptqueued` の `streamingQueued queued=` が `false` なら、キューの案内が出ないまま記録した旨を結果に書く

- [ ] **Step 6: 残ったプロセスを確かめる**

Run:

```bash
W="<スクラッチパッド>/fixrec"
test -d "$W" || { echo "W がありません: $W"; exit 1; }
WORK_REAL=$(cd "$W/work" && pwd -P)
echo "WORK_REAL=$WORK_REAL"
pgrep -fl "local/bin/claude" || true
```

Expected: Step 1 で控えた一覧と同じ。増えた pid があれば、`lsof -a -d cwd -p <その pid>` の `NAME` の列が `$W/work` の実体のパス（上で出した `WORK_REAL=` の値）のものだけを `kill <その pid>`（`-9` は付けない）で止め、もう一度 `pgrep` で確かめる（別の Bash の呼び出しで確かめるときは、上の 3 行で `W`・`WORK_REAL` を設定し直す）。作業ディレクトリが違う・決まらないものは止めずに出力を報告する

- [ ] **Step 7: 記録した画面を読み、結果を控える**

Run:

```bash
W="<スクラッチパッド>/fixrec"
test -d "$W" || { echo "W がありません: $W"; exit 1; }
python3 - "$W/out" <<'EOF'
import json
import sys

for name in ['interrupted', 'interruptedDraft', 'streamingQueued', 'interruptedQueued']:
    screen = json.load(open(f'{sys.argv[1]}/{name}.json', encoding='utf-8'))
    print('=====', name)
    for key in sorted(screen['lines'], key=int):
        print(key, screen['lines'][key][0])
EOF
```

次を控える（Step 11 で設計書へ書く）:

1. `interrupted`: `Interrupted` の行が出て、入力欄（罫線と `❯`）が空か
2. `interruptedDraft`: 作業が止まり、入力欄に `draft during tool` が残っているか
3. `streamingQueued`: キューの案内（`Press up to edit queued messages`・`ctrl+x ctrl+s to send now` など）が出ているか
4. `interruptedQueued`: キューの送信待ちが中断でどうなったか（残る・入力欄へ戻る・消える・送られる）。送られたかは Step 5 の `interruptqueued` の `LOG` のメインの要求の数（2 つなら送られた）と `mainCalls=` の値で判断し、作業中（スピナーの行と `esc to interrupt`）に戻ったかも控える

- [ ] **Step 8: 元の台帳の末尾に 4 画面を足し、`_note` の版を直す**

元の台帳は JSON を読み直して整形せず、ファイルの文字列のまま末尾に足す（記録用の README の手順 4 と同じ書式。U+00A0 は ` ` のエスケープ）。足し方が既存の 28 画面の書式と同じになることは、計画の時点で既存の 28 画面に同じ書き出し方をかけて、台帳の文字列と一致することを確かめてある。

`$W/append_screens.py` に次を書く:

```python
import json
import sys

ledger, out_dir, version = sys.argv[1], sys.argv[2], sys.argv[3]
NAMES = ['interrupted', 'interruptedDraft', 'streamingQueued', 'interruptedQueued']
OLD_NOTE_HEAD = '"_note": "claude 2.1.288 の画面(@xterm/headless の表示中のバッファ)。'
TAIL = '\n }\n}\n'

text = open(ledger, encoding='utf-8').read()
assert text.count(OLD_NOTE_HEAD) == 1, '_note の先頭が想定と違う'
assert text.endswith(TAIL), '台帳の末尾が想定と違う'
existing = json.loads(text)['screens']
assert len(existing) == 28 and not any(name in existing for name in NAMES), '台帳の画面が想定と違う'

# 版の記述(設計書「実装の最初に確かめること」4)。記録した版が 2.1.288 と同じなら混在の記述は要らない
if version != '2.1.288':
    new_note_head = (
        '"_note": "claude の画面(@xterm/headless の表示中のバッファ)。既存の 28 画面は claude 2.1.288、'
        f'中断の後の 4 画面(interrupted・interruptedDraft・streamingQueued・interruptedQueued)は claude {version} で記録した。'
    )
    text = text.replace(OLD_NOTE_HEAD, new_note_head)


def fragment(name):
    screen = json.load(open(f'{out_dir}/{name}.json', encoding='utf-8'))
    body = json.dumps(screen, indent=1, ensure_ascii=False).replace(' ', '\\u00a0')
    lines = body.splitlines()
    return '  ' + json.dumps(name) + ': ' + '\n'.join([lines[0]] + ['  ' + line for line in lines[1:]])


text = text[: -len(TAIL)] + ''.join(',\n' + fragment(name) for name in NAMES) + TAIL
assert len(json.loads(text)['screens']) == 32
open(ledger, 'w', encoding='utf-8', newline='').write(text)
print('screens: 32')
```

Run:

```bash
W="<スクラッチパッド>/fixrec"
test -d "$W" || { echo "W がありません: $W"; exit 1; }
cd <repo-root>
# 元の台帳(git 管理外)の控え。W の片付け(Step 13)では消えない場所に置き、Step 14 の検証が通るまで残す
BAK=.superpowers/agent-terminal-mvp/agent-screens.json.bak-2026-10-19
test ! -e "$BAK" || { echo "控えが既にあります: $BAK"; exit 1; }
cp .superpowers/agent-terminal-mvp/agent-screens.json "$BAK"
shasum -a 256 "$BAK"
python3 "$W/append_screens.py" .superpowers/agent-terminal-mvp/agent-screens.json "$W/out" "<V>"
shasum -a 256 .superpowers/agent-terminal-mvp/agent-screens.json
```

Expected: 控えの SHA-256 が Step 1 の元の台帳の値（`95518dc8…`）と同じ。`screens: 32`。最後の行の SHA-256 を **元の台帳の新しい値** として控える（Step 10 で `fixtures/README.md` に書く）。`<V>` は Step 1 の版（例: `2.1.291`）

- [ ] **Step 9: 個人情報を置き換えて写す**

Run:

````bash
W="<スクラッチパッド>/fixrec"
test -d "$W" || { echo "W がありません: $W"; exit 1; }
cd <repo-root>
awk '/^```python$/{f=1;next} /^```$/{f=0} f' src/renderer/src/lib/__tests__/fixtures/README.md > "$W/sanitize.py"
head -3 "$W/sanitize.py"
python3 "$W/sanitize.py" .superpowers/agent-terminal-mvp/agent-screens.json src/renderer/src/lib/__tests__/fixtures/agentScreens.json
wc -c .superpowers/agent-terminal-mvp/agent-screens.json src/renderer/src/lib/__tests__/fixtures/agentScreens.json
diff .superpowers/agent-terminal-mvp/agent-screens.json src/renderer/src/lib/__tests__/fixtures/agentScreens.json | grep -c '^>'
diff .superpowers/agent-terminal-mvp/agent-screens.json src/renderer/src/lib/__tests__/fixtures/agentScreens.json | grep '^>' | tail -n +31
grep -nE '/Users/|-Users-|/private/(tmp|var)|/var/folders|claude-[0-9]+' src/renderer/src/lib/__tests__/fixtures/agentScreens.json || echo "個人情報なし"
shasum -a 256 src/renderer/src/lib/__tests__/fixtures/agentScreens.json
````

Expected:

- `head` の 1 行目が `import re`（README の置換のスクリプトを取り出せた）
- 2 つのファイルの大きさが同じ（置き換えは同じ長さ）
- 変わった行の数を **N** として控える（既存の画面の 30 行 + 中断の後の 4 画面の行）。`tail -n +31` の出力（既存の 30 行の後の行）が、中断の後の 4 画面のヘッダーの作業ディレクトリ（`/…/<UUID>/scratchpad/fixrec/work` の形）の行であることを確かめ、何の行かを控える（ほかの種類の行なら、その種類を控える）
- `個人情報なし` が出る（何か出たら、`fixtures/README.md` の「新しい種類の個人情報が出たら、規則とテストの両方に足す」に従い、規則とテスト〈`agentScreensFixture.test.ts` の `it.each`〉に足してから写し直す）
- 最後の行の SHA-256 を **置き換えた後の新しい値** として控える

- [ ] **Step 10: ハッシュ・版・画面の数・判定の期待を更新する**

1. `src/renderer/src/lib/__tests__/agentScreensFixture.test.ts` の `const AGENT_SCREENS_SHA256 = '6e9c974e411fcff545460a5b739089ca3c6ce5d309823453889556d8eda36c8d'` を、Step 9 の置き換えた後の新しい値にする
2. `src/renderer/src/lib/__tests__/fixtures/agentScreens.ts` の冒頭のコメントの 1 行目 `// claude 2.1.288 の画面の記録(agentScreens.json)を、行の配列にする。lines は 行番号 → [文字列, dim の範囲, 反転の範囲]` を次にする（`<V>` は Step 1 の版。2.1.288 と同じなら変えない）:

```ts
// claude の画面の記録(agentScreens.json。既存の 28 画面は claude 2.1.288、中断の後の 4 画面は claude <V>)を、行の配列にする。lines は 行番号 → [文字列, dim の範囲, 反転の範囲]
```

3. `src/renderer/src/lib/__tests__/fixtures/README.md`:
   - 冒頭の段落の 2 行（`` `claude` 2.1.288・node-pty 1.1.0・`@xterm/headless` 6.0.0 で、28 の画面（空・書きかけ・ `` で始まる行と、`入力欄が画面を超えた・作業中・` で始まり `を記録した。` で終わる行）を次の 2 行にする（2.1.288 と同じ版なら、括弧の版の注記を省き、`28` を `32` にして `・中断の後` を足すだけにする）:

```text
`claude` 2.1.288（中断の後の 4 画面〈`interrupted`・`interruptedDraft`・`streamingQueued`・`interruptedQueued`〉は `claude` <V>）・node-pty 1.1.0・`@xterm/headless` 6.0.0 で、32 の画面（空・書きかけ・複数行・`[Pasted text #N]`・シェルのモード・`/` の候補・
入力欄が画面を超えた・作業中・送信待ち・信頼の確認・全画面の表示の案内・許可の確認・応答の表示中・ツールの実行中・中断の後など）を記録した。
```

- 「元の台帳」の行の `SHA-256 \`95518dc8e65f2deb885a50e323053a65bf5fc0d15e9436b66c897c7893af800d\`。プランの差異 22 の値と一致することを、写す前に確かめた`を`SHA-256 \`<Step 8 の新しい値>\`。中断の後の 4 画面を足す前は \`95518dc8e65f2deb885a50e323053a65bf5fc0d15e9436b66c897c7893af800d\`（プランの差異 22 の値と一致することを、写す前に確かめた）` にする
- 「置き換えた後」の行の `SHA-256 \`6e9c974e411fcff545460a5b739089ca3c6ce5d309823453889556d8eda36c8d\``を`SHA-256 \`<Step 9 の新しい値>\`` にする
- 「変わった行」の行 `変わった行: 30 行（ヘッダーの作業ディレクトリ 25 行・信頼の確認のパス 1 行・許可の確認の 2 画面で折り返されたパス 4 行）。ファイルの大きさは同じ` を `変わった行: <N> 行（ヘッダーの作業ディレクトリ 25 行・信頼の確認のパス 1 行・許可の確認の 2 画面で折り返されたパス 4 行・中断の後の 4 画面の <Step 9 で控えた行の種類> <N − 30> 行）。ファイルの大きさは同じ` にする

4. `src/renderer/src/lib/__tests__/agentActivity.test.ts`:
   - `// 記録済みの画面(claude 2.1.288)ごとの期待。台帳に画面が増えたら、ここに足さないと最後のテストが落ちる` を `// 記録済みの画面(claude 2.1.288。中断の後の 4 画面は claude <V>)ごとの期待。台帳に画面が増えたら、ここに足さないと最後のテストが落ちる` にする（2.1.288 と同じ版なら変えない）
   - `EXPECTED` に 4 画面を足す。まず次の期待で足す: `idle` の配列の末尾に `'interrupted'`・`'interruptedDraft'`、`working` の配列の末尾に `'streamingQueued'`、`interruptedQueued` は Step 7 の 4 で控えた画面の状態に合う活動（作業中に戻っていれば `working`、入力欄が見えて作業していなければ `idle`）の配列の末尾
5. `grep -rn "2.1.288" .superpowers/agent-terminal-mvp/agent-screens.json | head -2` で `_note` が直っていること（2.1.288 と同じ版なら直っていないのが正しい）を確かめる

- [ ] **Step 11: 判定のテストを流し、外れた画面を扱う**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentScreensFixture.test.ts src/renderer/src/lib/__tests__/agentActivity.test.ts src/renderer/src/lib/__tests__/agentInputBox.test.ts src/renderer/src/lib/__tests__/agentPromptSend.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`
Expected: PASS。`classifyAgentScreen: <活動>: <画面>` のどれかが落ちたら、判定の規則は直さず（範囲外）、落ちたテストの `Received` の活動へ、その画面を `EXPECTED` の中で移す。移したら、その画面の名前と活動を Step 12 で「既知の制約」に書く（`interrupted` が `idle` 以外になった場合は必ず書く。押せる条件は `working` だけなので、判定が外れても送る側には倒れない）。移した後にもう一度流して PASS にする

- [ ] **Step 12: 記録の結果を設計書の「既知の制約」に書く**

`docs/superpowers/specs/2026-10-19-agent-interrupt-ui-design.md` の「## 既知の制約（ROADMAP・実機テスト仕様書に反映する）」で:

1. `- 作業中のキューの送信待ちが中断でどうなるかは、実装時の記録（「実装の最初に確かめること」3）の結果をここに書く` の行を、Step 7 の 4 の結果の文にする。形: `- 作業中にキューに入れた指示（送信待ち）は、中断の後に <残る／入力欄へ戻る／消える／送られて作業中に戻る>（claude <V> で記録した画面 \`interruptedQueued\` で確かめた）`。送られて作業中に戻る場合は、続けて `。キューがあると、中断しても作業が続くことがある` を足す
2. Step 11 で `EXPECTED` の中を移した画面があれば、`- 中断の後の画面の判定は、実装時に記録した画面…` の行の直後に `- 中断の後の画面 \`<画面>\` は \`<活動>\` と判定される（\`<本来の活動>\` ではない）。<その結果、帯の状態の文言が何になるか>` の行を足す
3. `interruptedDraft` で書きかけが残らなかった場合は、`- 連打の対策は帯の \`中断\` だけ…`の行の直後に`- ツールの実行中に中断すると、入力欄の書きかけが消える（claude <V> で記録した画面 \`interruptedDraft\`。MVP の確認の結果 15 と違う）` を足す（残った場合は書かない）

- [ ] **Step 13: 作業用のディレクトリを片付ける**

Run:

```bash
W="<スクラッチパッド>/fixrec"
test -d "$W" || { echo "W がありません: $W"; exit 1; }
# 消す対象がスクラッチパッドの fixrec であることを確かめる(L-072)
case "$W" in
  */scratchpad/fixrec) ;;
  *) echo "想定外のパス: $W"; exit 1 ;;
esac
ls -A "$W"
# 中身がこの Task で作ったものだけのときに限って消す(ほかの物があれば消さずに止める)
CONTENTS=$(ls -A "$W" | LC_ALL=C sort | tr '\n' ' ')
test "$CONTENTS" = "append_screens.py cfg exp3.js node_modules out sanitize.py work " || { echo "想定外の中身: $CONTENTS"; exit 1; }
# リンクを外せたときだけディレクトリを消す(リンクの先のリポジトリの node_modules に届かせない)
if rm "$W/node_modules" && ! test -L "$W/node_modules" && ! test -e "$W/node_modules"; then
  echo "リンクを外しました"
  rm -rf "$W"
else
  echo "リンクを外せませんでした。消さずに止めます"
  exit 1
fi
test -e "$W" && echo "残っています: $W" || echo "片付けました"
ls -la <repo-root>/node_modules/node-pty/package.json
ls -la <repo-root>/.superpowers/agent-terminal-mvp/agent-screens.json.bak-2026-10-19
```

Expected: `ls -A` の出力が、この Task で作ったもの（`exp3.js`・`node_modules`・`work`・`out`・`cfg`・`append_screens.py`・`sanitize.py`）だけ（ほかの物があれば消さずに止めて報告する）。`リンクを外しました`・`片付けました`。最後の 2 つの `ls` で、リポジトリの `node_modules` と元の台帳の控え（Step 8。Step 14 の検証が通るまで残す）が残っていることを確かめる

- [ ] **Step 14: 検証**

Run: `npx vitest run`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す。Global Constraints）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/lib/__tests__/agentScreensFixture.test.ts src/renderer/src/lib/__tests__/agentActivity.test.ts src/renderer/src/lib/__tests__/fixtures/agentScreens.ts`
Expected: エラー・警告なし
Run: `npx prettier --check src/renderer/src/lib/__tests__/agentScreensFixture.test.ts src/renderer/src/lib/__tests__/agentActivity.test.ts src/renderer/src/lib/__tests__/fixtures/agentScreens.ts src/renderer/src/lib/__tests__/fixtures/README.md docs/superpowers/specs/2026-10-19-agent-interrupt-ui-design.md`
Expected: すべて整形済み
Run: `git status --short`
Expected: 変わったのは Files の `src/`・`docs/` のファイルだけ（`.superpowers/` は git 管理外で出ない）

上の検証がすべて通ったら、元の台帳の控え（Step 8）を、中身が足す前の台帳であることを確かめてから消す（通らなければ消さず、元の台帳を戻す必要があれば `cp "$BAK" .superpowers/agent-terminal-mvp/agent-screens.json` で戻せることを報告に書く）:

```bash
cd <repo-root>
BAK=.superpowers/agent-terminal-mvp/agent-screens.json.bak-2026-10-19
shasum -a 256 "$BAK" | grep -q '^95518dc8e65f2deb885a50e323053a65bf5fc0d15e9436b66c897c7893af800d ' && rm "$BAK" && echo "控えを消しました" || echo "控えを消しませんでした: $BAK"
```

報告に V・N・2 つの新しい SHA-256・Step 7 の結果・Step 11 で移した画面（あれば）・元の台帳の控えを消したか（残したならそのパス）を書く

---

### Task 2: IPC（shared・main・preload・renderer の窓口）

> **設計書の読む節:** 「決めたこと（推奨案で決めた事項）」の IPC の行、「データの流れ」の「IPC」「main」、「エラー処理」の main の結果の列、「テスト方針」の main・preload。
>
> **気をつける知見:** L-019（renderer からは `sessionId` だけを受け取り、main が固定の `\x1b` を書く。送信元のフレームの確認・所有者は `event.sender.id`）・L-037（今のセッションの `sessionId` との一致で照合し、停止中・古いセッションには書かない）・L-001（`sent`・`no-session`・`write-failed` を返し、握って黙らない）・L-053（書き込みの例外は `write-failed` にして受け口から投げない）・L-052（`pty.write` は同期で返る。待ちの上限は要らない）・L-059（実物の node-pty で 1 バイトだけが届くことを確かめる）・L-020（kill・シグナルは使わない）

**Files:**

- Modify: `src/shared/types/agentTerminal.ts`（`AgentInterruptResult`）
- Modify: `src/main/agentSession.ts`（`AGENT_INTERRUPT_SEQUENCE`・`interrupt`）・`src/main/agentSessionRegistry.ts`（`interrupt`）・`src/main/handlers/agentTerminalHandlers.ts`（受け口・`Pick`）
- Modify: `src/preload/api.ts`・`src/preload/index.d.ts`・`src/renderer/src/lib/agentTerminalApi.ts`・`src/renderer/src/__tests__/setup.ts`
- Test: `src/main/__tests__/agentSession.test.ts`・`src/main/__tests__/agentSessionRegistry.test.ts`・`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`・`src/main/__tests__/agentSession.integration.test.ts`・`src/preload/__tests__/api.test.ts`・`src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`

**Interfaces:**

- Consumes: 既存の `AgentSession`（`alive`・`stopping`・`pty`）・`AgentSessionRegistry.findBySessionId`（private）・`isMainFrameSender`・`parseAgentSessionId`（空・文字列でないと投げる）・`makeFakePty`・`makeEvent`・`register`・`processProbe` の `createTestTimers`・`waitForFile`・`writeFakeExecutable`
- Produces:

```ts
// src/shared/types/agentTerminal.ts(@shared/types から import できる)
export type AgentInterruptResult = { kind: 'sent' } | { kind: 'no-session' } | { kind: 'write-failed' }
// src/main/agentSession.ts
export const AGENT_INTERRUPT_SEQUENCE = '\x1b'
// AgentSession の公開メソッド
interrupt(): 'sent' | 'not-alive' | 'write-failed'
// AgentSessionRegistry の公開メソッド
interrupt(ownerId: number, sessionId: string): AgentInterruptResult
// window.api(preload)と renderer の窓口
interruptAgentSession(sessionId: string): Promise<AgentInterruptResult>
```

- [ ] **Step 1: 失敗するテストを書く（`AgentSession`）**

`src/main/__tests__/agentSession.test.ts`:

1. import を `import { AGENT_INTERRUPT_SEQUENCE, AgentSession, startAgentSession } from '../agentSession'` にする
2. `describe('AgentSession', () => {` の閉じ括弧の後（`describe('startAgentSession', …)` の前）に次を足す:

```ts
describe('AgentSession.interrupt', () => {
  const makeSession = (
    pty = makeFakePty(),
    stopTree = vi.fn<StopTree>()
  ): { session: AgentSession; pty: ReturnType<typeof makeFakePty> } => ({
    session: new AgentSession({ id: 's1', pty, callbacks: makeCallbacks(), stopTree }),
    pty
  })

  it('固定の 1 バイト(\\x1b)だけを pty へ書き、sent を返す(renderer の値を混ぜない)', () => {
    const { session, pty } = makeSession()
    expect(AGENT_INTERRUPT_SEQUENCE).toBe('\x1b')
    expect(session.interrupt()).toBe('sent')
    expect(pty.write.mock.calls).toEqual([['\x1b']])
  })

  it('終了の後は書かずに not-alive を返す', () => {
    const { session, pty } = makeSession()
    pty.emitExit(0)
    expect(session.interrupt()).toBe('not-alive')
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('stop の後(終了の前)は書かずに not-alive を返す(止めている pty に送らない)', () => {
    // 止まりきらない stopTree(SIGTERM の猶予を待っている間)
    const { session, pty } = makeSession(
      makeFakePty(),
      vi.fn<StopTree>(() => new Promise<void>(() => undefined))
    )
    void session.stop('stopped')
    expect(session.isAlive()).toBe(true)
    expect(session.interrupt()).toBe('not-alive')
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('pty.write が投げたら write-failed を返し、例外を投げない', () => {
    const { session, pty } = makeSession()
    pty.write.mockImplementationOnce(() => {
      throw new Error('EIO')
    })
    expect(session.interrupt()).toBe('write-failed')
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（registry）**

`src/main/__tests__/agentSessionRegistry.test.ts`:

1. `makeSlowStoppingSession` の戻り値に `pty` を足す（戻り値の型に `pty: FakePty` を足し、`return { session, stopTree, release: () => release() }` を `return { session, pty, stopTree, release: () => release() }` にする。ほかの使い方は変わらない）
2. `describe('AgentSessionRegistry.generationOf', …)` の前に次を足す:

```ts
describe('AgentSessionRegistry.interrupt', () => {
  it('所有者の枠の現在のセッションだけに固定の 1 バイトを書き、sent を返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty } = makeSession('s1')
    await registry.start(1, 'a', created(session))
    expect(registry.interrupt(1, 's1')).toEqual({ kind: 'sent' })
    expect(pty.write.mock.calls).toEqual([['\x1b']])
  })

  it('別の所有者・知らない sessionId には書かず no-session を返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty } = makeSession('s1')
    await registry.start(1, 'a', created(session))
    expect(registry.interrupt(2, 's1')).toEqual({ kind: 'no-session' })
    expect(registry.interrupt(1, 'other')).toEqual({ kind: 'no-session' })
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('起動し直した後の古い sessionId には書かず no-session を返す(世代の確認)', async () => {
    const registry = new AgentSessionRegistry()
    const first = makeSession('s1')
    await registry.start(1, 'a', created(first.session))
    first.pty.emitExit(0)
    await first.session.exited
    const second = makeSession('s2')
    await registry.start(1, 'a', created(second.session))
    expect(registry.interrupt(1, 's1')).toEqual({ kind: 'no-session' })
    expect(first.pty.write).not.toHaveBeenCalled()
    expect(second.pty.write).not.toHaveBeenCalled()
  })

  it('停止中のセッション(stop の後、止まりきる前)には書かず no-session を返す', async () => {
    const registry = new AgentSessionRegistry()
    const slow = makeSlowStoppingSession('old')
    await registry.start(1, 'a', created(slow.session))
    const stopping = registry.stop(1, 'stopped', 'old')
    expect(registry.interrupt(1, 'old')).toEqual({ kind: 'no-session' })
    expect(slow.pty.write).not.toHaveBeenCalled()
    slow.release()
    await stopping
  })

  it('pty への書き込みが投げたら write-failed を返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty } = makeSession('s1')
    await registry.start(1, 'a', created(session))
    pty.write.mockImplementationOnce(() => {
      throw new Error('EIO')
    })
    expect(registry.interrupt(1, 's1')).toEqual({ kind: 'write-failed' })
  })
})
```

- [ ] **Step 3: 失敗するテストを書く（受け口）**

`src/main/__tests__/handlers/agentTerminalHandlers.test.ts` の `describe('agentTerminal:focus', …)` の前に次を足す:

```ts
describe('agentTerminal:interrupt', () => {
  async function started(): Promise<ReturnType<typeof makeEvent>> {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    return event
  }
  const interrupt = (event: ReturnType<typeof makeEvent>, ...args: unknown[]): unknown =>
    handles.get('agentTerminal:interrupt')?.(event, ...args)

  it('今のセッションへ固定の 1 バイトを書いて sent を返す。余分な引数を渡しても書くバイト列は変わらない(L-019)', async () => {
    const event = await started()
    expect(interrupt(event, 'sid-1', 'evil', '\x03')).toEqual({ kind: 'sent' })
    expect(pty.write.mock.calls).toEqual([['\x1b']])
  })

  it('別の sessionId・別のウィンドウからは書かず no-session を返す', async () => {
    const event = await started()
    expect(interrupt(event, 'stale')).toEqual({ kind: 'no-session' })
    expect(interrupt(makeEvent(2), 'sid-1')).toEqual({ kind: 'no-session' })
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('サブフレームからの依頼・空や文字列でない sessionId は投げて書かない', async () => {
    await started()
    expect(() => interrupt(makeEvent(1, false), 'sid-1')).toThrow()
    expect(() => interrupt(makeEvent(), '')).toThrow()
    expect(() => interrupt(makeEvent(), 1)).toThrow()
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('registry.interrupt に送信元の id と sessionId だけを渡し、結果をそのまま返す', () => {
    const registryInterrupt = vi.fn<AgentSessionRegistry['interrupt']>(() => ({
      kind: 'write-failed'
    }))
    const fakeRegistry: AgentTerminalHandlerDeps['registry'] = {
      write: vi.fn(),
      resize: vi.fn(),
      stop: vi.fn(async () => undefined),
      snapshot: vi.fn(() => []),
      interrupt: registryInterrupt
    }
    register({ registry: fakeRegistry })
    expect(interrupt(makeEvent(7), 'sid-x', 'extra')).toEqual({ kind: 'write-failed' })
    expect(registryInterrupt).toHaveBeenCalledExactlyOnceWith(7, 'sid-x')
  })
})
```

- [ ] **Step 4: 失敗するテストを書く（実物の node-pty）**

`src/main/__tests__/agentSession.integration.test.ts`:

1. `node:fs` の import に `writeFileSync` を足す（`import { mkdtempSync, readFileSync, rmSync, existsSync, symlinkSync, writeFileSync } from 'node:fs'`）
2. `describe.skipIf(process.platform === 'win32')('AgentSession(実物の pty)', () => {` の中の最初の `it` の後に次を足す:

```ts
it('interrupt は固定の 1 バイト(\\x1b)だけを子の標準入力へ届ける(raw モードの子が受け取ったバイトを 16 進で書き出す)', async () => {
  const out = join(dir, 'received-hex')
  const ready = join(dir, 'ready')
  const script = join(dir, 'raw-hex.js')
  writeFileSync(
    script,
    [
      "const fs = require('node:fs')",
      'process.stdin.setRawMode(true)',
      `process.stdin.on('data', (chunk) => fs.appendFileSync(${JSON.stringify(out)}, chunk.toString('hex')))`,
      // raw への切り替えの後に印を書く(raw になった後の入力は tty に溜まり、失われない)
      `fs.writeFileSync(${JSON.stringify(ready)}, 'ready')`
    ].join('\n')
  )
  const session = start(`exec '${process.execPath}' '${script}'`)
  await waitForFile(ready, timers)
  expect(session.interrupt()).toBe('sent')
  expect(await waitForFile(out, timers)).toBe('1b')
  // 続けて余分なバイト(改行・Ctrl+C など)が届かないことを、少し待ってから確かめる
  await timers.delay(300)
  expect(readFileSync(out, 'utf8')).toBe('1b')
}, 15_000)
```

- [ ] **Step 5: 失敗するテストを書く（preload・renderer の窓口）**

1. `src/preload/__tests__/api.test.ts` の `describe('エージェントのターミナル・外部変更・実行方式・リンクの API', …)` の `it.each` の配列の `'stopAgentSession は agentTerminal:stop に sessionId を渡す'` の要素の直後に足す:

```ts
    [
      'interruptAgentSession は agentTerminal:interrupt に sessionId だけを渡す',
      () => api.interruptAgentSession('id'),
      ['agentTerminal:interrupt', 'id']
    ],
```

さらに、同じファイルの末尾に次を足す:

```ts
describe('interruptAgentSession の戻り値', () => {
  it('invoke の結果をそのまま返し、引数は チャンネル と sessionId の 2 つだけ', async () => {
    mockInvoke.mockResolvedValue({ kind: 'no-session' })
    await expect(api.interruptAgentSession('id')).resolves.toEqual({ kind: 'no-session' })
    expect(mockInvoke.mock.calls).toEqual([['agentTerminal:interrupt', 'id']])
  })
})
```

2. `src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`: `mockApi` に `interruptAgentSession: vi.fn(),` を足し（`stopAgentSession: vi.fn(),` の次）、最初の `it` の `agentTerminalApi.stopAgentSession('s')` の次に `agentTerminalApi.interruptAgentSession('s')`、`expect(mockApi.stopAgentSession).toHaveBeenCalledWith('s')` の次に `expect(mockApi.interruptAgentSession).toHaveBeenCalledWith('s')` を足す

- [ ] **Step 6: テストが落ちることを確かめる**

Run: `npx vitest run src/main/__tests__/agentSession.test.ts src/main/__tests__/agentSessionRegistry.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/agentSession.integration.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`
Expected: FAIL（`interrupt is not a function`・`AGENT_INTERRUPT_SEQUENCE` が undefined・`agentTerminal:interrupt` の受け口が無い・`interruptAgentSession is not a function`）

- [ ] **Step 7: shared の型と main を実装する**

1. `src/shared/types/agentTerminal.ts` の末尾（`AgentLastSession` の後）に足す:

```ts
/** 中断(agentTerminal:interrupt)の結果。main は固定の 1 バイトを書けたかだけを返す(作業が止まったかは claude の画面の判定で分かる) */
export type AgentInterruptResult =
  | { kind: 'sent' }
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
```

2. `src/main/agentSession.ts` の `export interface PtyDisposable {` の前に足す:

```ts
/** claude の作業の中断(ターミナルで Esc を 1 回押すのと同じ)。renderer の値を混ぜない固定の 1 バイト */
export const AGENT_INTERRUPT_SEQUENCE = '\x1b'
```

`AgentSession` の `write(data: string): void { … }` の後に足す:

```ts
  /**
   * 作業の中断(Esc を 1 回)を書く。既存の write は打鍵の経路のため書き込みの例外を握って何も返さないが、中断は結果を返す
   * (L-001)。停止の途中(stop の後、終了の前)は止めている pty に送らない。pty.write は同期で返り、claude の反応は待たない
   */
  interrupt(): 'sent' | 'not-alive' | 'write-failed' {
    if (!this.alive || this.stopping !== null) return 'not-alive'
    try {
      this.pty.write(AGENT_INTERRUPT_SEQUENCE)
      return 'sent'
    } catch {
      return 'write-failed'
    }
  }
```

3. `src/main/agentSessionRegistry.ts`: import に `AgentInterruptResult` を足す（`import type { AgentExitReason, AgentInterruptResult, AgentStartResult } from '@shared/types'`）。`write(…)` の後に足す:

```ts
  /**
   * sessionId が所有者のいずれかの枠の現在のセッションと一致するときだけ中断を送る(write と同じ照合)。停止中のセッション
   * (stoppingSessions に移ったもの)・別のウィンドウのセッション・起動し直す前の古い sessionId は一致せず no-session(L-037)
   */
  interrupt(ownerId: number, sessionId: string): AgentInterruptResult {
    const session = this.findBySessionId(ownerId, sessionId)?.session
    if (session === undefined) return { kind: 'no-session' }
    const result = session.interrupt()
    if (result === 'sent') return { kind: 'sent' }
    return result === 'not-alive' ? { kind: 'no-session' } : { kind: 'write-failed' }
  }
```

4. `src/main/handlers/agentTerminalHandlers.ts`:
   - import の型に `AgentInterruptResult` を足す（`import type { AgentInterruptResult, AgentLastSession, AgentSessionSnapshotEntry, AgentStartResult } from '@shared/types'`）
   - 冒頭のコメントの `書き込む文字列・sessionId(作業中・作業の終わりの知らせを含む)だけを受け取る` を `書き込む文字列・sessionId(作業中・作業の終わりの知らせ・中断を含む)だけを受け取る` にする
   - `registry: Pick<AgentSessionRegistry, 'write' | 'resize' | 'stop' | 'snapshot'>` を `registry: Pick<AgentSessionRegistry, 'write' | 'resize' | 'stop' | 'snapshot' | 'interrupt'>` にし、上のコメントを `/** 書き込み・リサイズ・停止・中断・状態の取得の相手(所有者・枠ごとのセッション) */` にする
   - `ipcMain.handle('agentTerminal:stop', …)` の後に足す:

```ts
// 中断(claude に Esc を 1 回)。renderer からは sessionId だけを受け取り、書くバイト列は main が決める(L-019)。
// 書けたか・セッションが無かったかを返すため invoke にする(L-001)。照合は write と同じ(送信元のウィンドウの今のセッション)
ipcMain.handle(
  'agentTerminal:interrupt',
  (event: IpcMainInvokeEvent, sessionId: unknown): AgentInterruptResult => {
    if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
    return registry.interrupt(event.sender.id, parseAgentSessionId(sessionId))
  }
)
```

- [ ] **Step 8: preload と renderer の窓口を実装する**

1. `src/preload/api.ts`: import の型に `AgentInterruptResult` を足す（`AgentChangesUndoResult,` の並びの中、アルファベット順で `AgentLastSession` の前）。`stopAgentSession: …,` の次に足す:

```ts
  // 中断(claude に Esc を 1 回)。引数は sessionId だけで、書くバイト列は main が決める。書けたかを返すため invoke
  interruptAgentSession: (sessionId: string): Promise<AgentInterruptResult> =>
    ipcRenderer.invoke('agentTerminal:interrupt', sessionId),
```

2. `src/preload/index.d.ts`: import の型に `AgentInterruptResult` を足し、`stopAgentSession(sessionId: string): Promise<void>` の次の行に `interruptAgentSession(sessionId: string): Promise<AgentInterruptResult>` を足す
3. `src/renderer/src/lib/agentTerminalApi.ts`: import の型に `AgentInterruptResult` を足し、`stopAgentSession` の関数の後に足す:

```ts
/** 中断(claude の作業を止める。ターミナルで Esc を 1 回押すのと同じ)。書くバイト列は main が決める */
export function interruptAgentSession(sessionId: string): Promise<AgentInterruptResult> {
  return window.api.interruptAgentSession(sessionId)
}
```

4. `src/renderer/src/__tests__/setup.ts`: `stopAgentSession: () => Promise.resolve(),` の次に `interruptAgentSession: () => Promise.resolve({ kind: 'sent' }),` を足す

- [ ] **Step 9: テストが通ることを確かめる**

Run: Step 6 と同じコマンド
Expected: PASS（実物の node-pty の統合テストは macOS・Linux で走る）

- [ ] **Step 10: 変異で確かめる**

1. `AgentSession.interrupt` の `|| this.stopping !== null` を消す → `stop の後(終了の前)は書かずに not-alive を返す…` が落ちる。戻す
2. `AgentSessionRegistry.interrupt` の `this.findBySessionId(ownerId, sessionId)?.session` を、所有者のすべての枠を探して `session.id === sessionId` でないものも拾う形（例: `[...(this.owners.get(ownerId)?.slots.values() ?? [])][0]?.session`）にする → `別の所有者・知らない sessionId には書かず…`・`起動し直した後の古い sessionId…` が落ちる。戻す
3. 受け口の `if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)` を消す → `サブフレームからの依頼…` が落ちる。戻す
4. `AGENT_INTERRUPT_SEQUENCE` を `'\x1b\r'` にする → `固定の 1 バイト…`（単体・registry・受け口・実物の pty）が落ちる。戻す
5. `git diff` で戻したことを確かめる

- [ ] **Step 11: 検証**

Run: `npx vitest run`
Expected: PASS（時間切れで落ちたファイルは単体で流し直す）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/shared/types/agentTerminal.ts src/main/agentSession.ts src/main/agentSessionRegistry.ts src/main/handlers/agentTerminalHandlers.ts src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/agentTerminalApi.ts src/renderer/src/__tests__/setup.ts src/main/__tests__/agentSession.test.ts src/main/__tests__/agentSessionRegistry.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/agentSession.integration.test.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み
Run: `pgrep -fl amt-test- || true`
Expected: 何も出ない（統合テストの子が残っていない）

---

### Task 3: 押せるかの判定と文言（renderer の純関数）

> **設計書の読む節:** 「画面」の「帯のボタン」（属性の表・押せない理由の文言の表）・「読み上げ」、「データの流れ」の「押せるかの判定」、「エラー処理」の失敗の文言、「テスト方針」の純関数・文言。
>
> **気をつける知見:** L-041（対象外の活動〈`permission`・`confirm`・`idle`・`unknown`〉を拒否するコードとテストで対象外にする）・L-057（押せない理由を状態ごとに文言にする）・L-048（失敗の接頭辞は `AGENT_STOP_ERROR_PREFIX` と同じ形）

**Files:**

- Create: `src/renderer/src/lib/agentInterrupt.ts`
- Modify: `src/renderer/src/lib/agentSessionMessages.ts`
- Test: `src/renderer/src/lib/__tests__/agentInterrupt.test.ts`（新規）・`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`

**Interfaces:**

- Consumes: `AgentActivity`（`lib/agentActivity.ts`）・`AgentSessionStatus`（`lib/agentSessionTabState.ts`）
- Produces:

```ts
// src/renderer/src/lib/agentInterrupt.ts
export const AGENT_INTERRUPT_COOLDOWN_MS = 1_000
export interface AgentInterruptAvailabilityInput {
  status: AgentSessionStatus
  isClosing: boolean
  activity: AgentActivity
  isSending: boolean
  isSendConfirmOpen: boolean
  isInterrupting: boolean
}
export interface AgentInterruptAvailability {
  visible: boolean
  reason: string | null
}
export function getAgentInterruptAvailability(
  input: AgentInterruptAvailabilityInput
): AgentInterruptAvailability
export function describeAgentInterruptBlockedByActivity(
  activity: Exclude<AgentActivity, 'working'>
): string
// src/renderer/src/lib/agentSessionMessages.ts(Global Constraints の「文言」の名前と文字列)
```

- [ ] **Step 1: 失敗するテストを書く（文言）**

`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts` の import に `AGENT_INTERRUPT_ARIA_LABEL, AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY, AGENT_INTERRUPT_DISABLED_CLOSING, AGENT_INTERRUPT_DISABLED_COOLDOWN, AGENT_INTERRUPT_DISABLED_SEND_CONFIRM, AGENT_INTERRUPT_DISABLED_SENDING, AGENT_INTERRUPT_DISABLED_STARTING, AGENT_INTERRUPT_ERROR_NO_SESSION, AGENT_INTERRUPT_ERROR_PREFIX, AGENT_INTERRUPT_ERROR_WRITE_FAILED, AGENT_INTERRUPT_LABEL, AGENT_INTERRUPT_NOT_RUNNING, agentInterruptError, agentInterruptSentNotice` を足し、末尾に次を足す（文字列は設計書の文言の一字一句。実機テスト仕様書もこの文字列で書く）:

```ts
describe('中断の文言(設計書 2026-10-19「画面」「エラー処理」)', () => {
  it('ボタンの見える文字と名前(見える文字で始める。パターン 76)', () => {
    expect(AGENT_INTERRUPT_LABEL).toBe('中断')
    expect(AGENT_INTERRUPT_ARIA_LABEL).toBe('中断（作業中の claude に Esc を送る）')
    expect(AGENT_INTERRUPT_ARIA_LABEL.startsWith(AGENT_INTERRUPT_LABEL)).toBe(true)
  })

  it('押せない理由', () => {
    expect(AGENT_INTERRUPT_NOT_RUNNING).toBe('claude が動いていないため中断できません')
    expect(AGENT_INTERRUPT_DISABLED_STARTING).toBe('起動中は中断できません')
    expect(AGENT_INTERRUPT_DISABLED_CLOSING).toBe('閉じる途中のタブは中断できません')
    expect(AGENT_INTERRUPT_DISABLED_SENDING).toBe('プロンプトを送信している間は中断できません')
    expect(AGENT_INTERRUPT_DISABLED_SEND_CONFIRM).toBe('送信前の確認を開いている間は中断できません')
    expect(AGENT_INTERRUPT_DISABLED_COOLDOWN).toBe(
      '中断を送りました。まだ作業中なら、少し待つと押せます'
    )
    expect(AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY).toEqual({
      permission:
        '許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）',
      confirm: '確認待ちのため中断できません（ターミナルで選んでください）',
      idle: '入力待ちのため、中断する作業がありません',
      unknown: '作業中か判定できないため押せません（ターミナルで Esc を押すと中断できます）'
    })
  })

  it('送れたときの読み上げは、押した時点のタブのラベルで始める', () => {
    expect(agentInterruptSentNotice('claude 1')).toBe('claude 1 に中断（Esc）を送りました')
    expect(agentInterruptSentNotice(formatAgentTabLabel(3))).toBe(
      'claude 3 に中断（Esc）を送りました'
    )
  })

  it('失敗の文言は接頭辞で始める(成功のときに中断の失敗だけを消すため)', () => {
    expect(AGENT_INTERRUPT_ERROR_PREFIX).toBe('中断を送れませんでした: ')
    expect(AGENT_INTERRUPT_ERROR_NO_SESSION).toBe(
      '中断を送れませんでした: claude が終了したか、起動し直しました'
    )
    expect(AGENT_INTERRUPT_ERROR_WRITE_FAILED).toBe(
      '中断を送れませんでした: ターミナルへの書き込みに失敗しました'
    )
    expect(agentInterruptError('ipc down')).toBe('中断を送れませんでした: ipc down')
    // 終了の失敗の接頭辞とは別(中断が成功しても、終了の失敗の文言は消さない)
    expect(AGENT_STOP_ERROR_PREFIX.startsWith(AGENT_INTERRUPT_ERROR_PREFIX)).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（純関数）**

`src/renderer/src/lib/__tests__/agentInterrupt.test.ts` を作る:

```ts
import { describe, it, expect } from 'vitest'
import {
  AGENT_INTERRUPT_COOLDOWN_MS,
  describeAgentInterruptBlockedByActivity,
  getAgentInterruptAvailability
} from '../agentInterrupt'
import type { AgentInterruptAvailabilityInput } from '../agentInterrupt'
import type { AgentActivity } from '../agentActivity'
import type { AgentSessionStatus } from '../agentSessionTabState'
import {
  AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY,
  AGENT_INTERRUPT_DISABLED_CLOSING,
  AGENT_INTERRUPT_DISABLED_COOLDOWN,
  AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  AGENT_INTERRUPT_DISABLED_SENDING,
  AGENT_INTERRUPT_DISABLED_STARTING,
  AGENT_INTERRUPT_NOT_RUNNING
} from '../agentSessionMessages'

const STATUSES: readonly AgentSessionStatus[] = ['none', 'starting', 'running', 'exited']
const ACTIVITIES: readonly AgentActivity[] = ['working', 'idle', 'permission', 'confirm', 'unknown']
// 設計書「押せない理由の文言」の表の順(閉じる途中 → 送信中 → 確認の表示中 → 送っている途中・1,000ms 以内)
const FLAGS = ['isClosing', 'isSending', 'isSendConfirmOpen', 'isInterrupting'] as const
type Flag = (typeof FLAGS)[number]
const FLAG_REASONS: Record<Flag, string> = {
  isClosing: AGENT_INTERRUPT_DISABLED_CLOSING,
  isSending: AGENT_INTERRUPT_DISABLED_SENDING,
  isSendConfirmOpen: AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  isInterrupting: AGENT_INTERRUPT_DISABLED_COOLDOWN
}

const RUNNING_WORKING: AgentInterruptAvailabilityInput = {
  status: 'running',
  isClosing: false,
  activity: 'working',
  isSending: false,
  isSendConfirmOpen: false,
  isInterrupting: false
}

// 表の期待(状態 → 閉じる途中・送信中・確認の表示中・待ち → 活動の順で最初に当たった理由)
function expectedReason(input: AgentInterruptAvailabilityInput): string | null {
  if (input.status === 'none' || input.status === 'exited') return AGENT_INTERRUPT_NOT_RUNNING
  if (input.status === 'starting') return AGENT_INTERRUPT_DISABLED_STARTING
  for (const flag of FLAGS) if (input[flag]) return FLAG_REASONS[flag]
  return input.activity === 'working' ? null : AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY[input.activity]
}

// 状態(4)× 活動(5)× 閉じる途中・送信中・確認の表示中・待ち(16)の組
const COMBINATIONS: [string, AgentInterruptAvailabilityInput][] = STATUSES.flatMap((status) =>
  ACTIVITIES.flatMap((activity) =>
    Array.from(
      { length: 2 ** FLAGS.length },
      (_, bits): [string, AgentInterruptAvailabilityInput] => {
        const input: AgentInterruptAvailabilityInput = { ...RUNNING_WORKING, status, activity }
        FLAGS.forEach((flag, index) => {
          input[flag] = (bits & (1 << index)) !== 0
        })
        const on = FLAGS.filter((flag) => input[flag]).join('+') || 'なし'
        return [`${status}・${activity}・${on}`, input]
      }
    )
  )
)

describe('getAgentInterruptAvailability', () => {
  it('作業中で、どの理由にも当たらなければ押せる(reason が null)', () => {
    expect(getAgentInterruptAvailability(RUNNING_WORKING)).toEqual({ visible: true, reason: null })
  })

  it.each(COMBINATIONS)('%s', (_name, input) => {
    expect(getAgentInterruptAvailability(input)).toEqual({
      visible: input.status === 'starting' || input.status === 'running',
      reason: expectedReason(input)
    })
  })

  it.each(['none', 'exited'] as const)(
    '%s は出さず、押した処理の判定のために理由(動いていない)を持つ',
    (status) => {
      expect(getAgentInterruptAvailability({ ...RUNNING_WORKING, status })).toEqual({
        visible: false,
        reason: AGENT_INTERRUPT_NOT_RUNNING
      })
    }
  )

  it('理由の順: 起動中は、閉じる途中・送信中・確認の表示中・待ち・活動より先', () => {
    expect(
      getAgentInterruptAvailability({
        status: 'starting',
        isClosing: true,
        activity: 'permission',
        isSending: true,
        isSendConfirmOpen: true,
        isInterrupting: true
      }).reason
    ).toBe(AGENT_INTERRUPT_DISABLED_STARTING)
  })

  it.each<[string, Partial<AgentInterruptAvailabilityInput>, string]>([
    [
      '閉じる途中は送信中より先',
      { isClosing: true, isSending: true, isSendConfirmOpen: true, isInterrupting: true },
      AGENT_INTERRUPT_DISABLED_CLOSING
    ],
    [
      '送信中は確認の表示中より先',
      { isSending: true, isSendConfirmOpen: true, isInterrupting: true },
      AGENT_INTERRUPT_DISABLED_SENDING
    ],
    [
      '確認の表示中は待ちより先',
      { isSendConfirmOpen: true, isInterrupting: true },
      AGENT_INTERRUPT_DISABLED_SEND_CONFIRM
    ],
    [
      '待ちは活動より先',
      { isInterrupting: true, activity: 'idle' },
      AGENT_INTERRUPT_DISABLED_COOLDOWN
    ]
  ])('理由の順: %s', (_name, overrides, reason) => {
    expect(
      getAgentInterruptAvailability({ ...RUNNING_WORKING, activity: 'permission', ...overrides })
        .reason
    ).toBe(reason)
  })

  it.each(['idle', 'permission', 'confirm', 'unknown'] as const)(
    '活動が %s なら押せない(L-041。許可待ちの Esc は許可の拒否、入力待ちの 2 回目の Esc は書きかけの消去)',
    (activity) => {
      expect(getAgentInterruptAvailability({ ...RUNNING_WORKING, activity }).reason).toBe(
        AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY[activity]
      )
    }
  )
})

describe('describeAgentInterruptBlockedByActivity', () => {
  it.each(['idle', 'permission', 'confirm', 'unknown'] as const)('%s の理由', (activity) => {
    expect(describeAgentInterruptBlockedByActivity(activity)).toBe(
      AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY[activity]
    )
  })
})

describe('AGENT_INTERRUPT_COOLDOWN_MS', () => {
  it('1,000ms(入力待ちで 2 回目の Esc が書きかけを消さない 0.9 秒より長い。MVP の確認の結果 17)', () => {
    expect(AGENT_INTERRUPT_COOLDOWN_MS).toBe(1_000)
  })
})
```

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentInterrupt.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`
Expected: FAIL（`../agentInterrupt` が無い・文言の export が無い）

- [ ] **Step 4: 文言を実装する**

`src/renderer/src/lib/agentSessionMessages.ts` の `AGENT_STOP_ERROR_PREFIX` の定義の後に足す:

```ts
/** 帯の中断のボタン(選択中のタブの claude に Esc を 1 回送る。設計書 2026-10-19「画面」) */
export const AGENT_INTERRUPT_LABEL = '中断'
/** 可視の文言「中断」で始める(パターン 76) */
export const AGENT_INTERRUPT_ARIA_LABEL = '中断（作業中の claude に Esc を送る）'
/** セッションが無い・終了した(帯には出さないが、押した処理の判定でも同じ純関数を使うため理由を持つ) */
export const AGENT_INTERRUPT_NOT_RUNNING = 'claude が動いていないため中断できません'
export const AGENT_INTERRUPT_DISABLED_STARTING = '起動中は中断できません'
export const AGENT_INTERRUPT_DISABLED_CLOSING = '閉じる途中のタブは中断できません'
export const AGENT_INTERRUPT_DISABLED_SENDING = 'プロンプトを送信している間は中断できません'
export const AGENT_INTERRUPT_DISABLED_SEND_CONFIRM = '送信前の確認を開いている間は中断できません'
/** 送っている途中・押してから 1,000ms 以内(待ちはタブごと) */
export const AGENT_INTERRUPT_DISABLED_COOLDOWN =
  '中断を送りました。まだ作業中なら、少し待つと押せます'
/** 活動が working でないときの理由。活動を増やしたときの決め忘れを型エラーにする */
export const AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY: Record<
  Exclude<AgentActivity, 'working'>,
  string
> = {
  permission:
    '許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）',
  confirm: '確認待ちのため中断できません（ターミナルで選んでください）',
  idle: '入力待ちのため、中断する作業がありません',
  unknown: '作業中か判定できないため押せません（ターミナルで Esc を押すと中断できます）'
}
/** 中断を送れたときの読み上げ(label は押した時点のタブの名前。formatAgentTabLabel) */
export function agentInterruptSentNotice(label: string): string {
  return `${label} に中断（Esc）を送りました`
}
/** 中断を送れなかったときの文言の接頭辞(AGENT_STOP_ERROR_PREFIX と同じ形)。送れたときは、この接頭辞で始まる error だけを消す */
export const AGENT_INTERRUPT_ERROR_PREFIX = '中断を送れませんでした: '
/** main が no-session を返した(終了の知らせが renderer より先・起動し直した・停止中) */
export const AGENT_INTERRUPT_ERROR_NO_SESSION = `${AGENT_INTERRUPT_ERROR_PREFIX}claude が終了したか、起動し直しました`
/** main が write-failed を返した(pty への書き込みが例外) */
export const AGENT_INTERRUPT_ERROR_WRITE_FAILED = `${AGENT_INTERRUPT_ERROR_PREFIX}ターミナルへの書き込みに失敗しました`
/** invoke の拒否・window.api の同期の例外 */
export function agentInterruptError(message: string): string {
  return `${AGENT_INTERRUPT_ERROR_PREFIX}${message}`
}
```

- [ ] **Step 5: 純関数を実装する**

`src/renderer/src/lib/agentInterrupt.ts` を作る:

```ts
import type { AgentActivity } from './agentActivity'
import type { AgentSessionStatus } from './agentSessionTabState'
import {
  AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY,
  AGENT_INTERRUPT_DISABLED_CLOSING,
  AGENT_INTERRUPT_DISABLED_COOLDOWN,
  AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  AGENT_INTERRUPT_DISABLED_SENDING,
  AGENT_INTERRUPT_DISABLED_STARTING,
  AGENT_INTERRUPT_NOT_RUNNING
} from './agentSessionMessages'

// 帯の 中断 を押せるかの判定(設計書 2026-10-19「押せるかの判定」)。描画(useAgentInterrupt の disabledReason)と、押した処理の
// 先頭の判定(手順 2。L-058)で同じ関数を使う

/**
 * 押してから押せない間。入力待ちの画面で 2 回目の Esc は 0.5 秒後なら入力欄を消し、0.9 秒以上空けると消さなかった
 * (MVP の確認の結果 17)ため、0.9 秒より長くする
 */
export const AGENT_INTERRUPT_COOLDOWN_MS = 1_000

export interface AgentInterruptAvailabilityInput {
  status: AgentSessionStatus
  isClosing: boolean
  activity: AgentActivity
  isSending: boolean
  isSendConfirmOpen: boolean
  /** 対象のタブ(選択中のタブ)が、送っている途中か、押してから AGENT_INTERRUPT_COOLDOWN_MS 以内(待ちはタブごと) */
  isInterrupting: boolean
}

export interface AgentInterruptAvailability {
  /** ボタンを出すか(starting・running) */
  visible: boolean
  /** 押せない理由。押せるなら null */
  reason: string | null
}

/** 活動が working でないときの理由(押した時点の画面の読み直し〈手順 3〉でも使う) */
export function describeAgentInterruptBlockedByActivity(
  activity: Exclude<AgentActivity, 'working'>
): string {
  return AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY[activity]
}

/** 表の順(起動中 → 閉じる途中 → 送信中 → 確認の表示中 → 送っている途中・1,000ms 以内 → 活動)で最初に当たった理由 */
function blockedReasonOf(input: AgentInterruptAvailabilityInput): string | null {
  if (input.status === 'starting') return AGENT_INTERRUPT_DISABLED_STARTING
  if (input.isClosing) return AGENT_INTERRUPT_DISABLED_CLOSING
  if (input.isSending) return AGENT_INTERRUPT_DISABLED_SENDING
  if (input.isSendConfirmOpen) return AGENT_INTERRUPT_DISABLED_SEND_CONFIRM
  if (input.isInterrupting) return AGENT_INTERRUPT_DISABLED_COOLDOWN
  if (input.activity !== 'working') return describeAgentInterruptBlockedByActivity(input.activity)
  return null
}

export function getAgentInterruptAvailability(
  input: AgentInterruptAvailabilityInput
): AgentInterruptAvailability {
  // 未起動・終了の帯には出さない(起動・前回の続きから の並びと狭い幅の扱いを変えない)
  if (input.status === 'none' || input.status === 'exited') {
    return { visible: false, reason: AGENT_INTERRUPT_NOT_RUNNING }
  }
  return { visible: true, reason: blockedReasonOf(input) }
}
```

- [ ] **Step 6: テストが通ることを確かめる**

Run: Step 3 と同じコマンド
Expected: PASS

- [ ] **Step 7: 変異で確かめる**

1. `blockedReasonOf` の `if (input.isSending) …` と `if (input.isSendConfirmOpen) …` の 2 行を入れ替える → `理由の順: 送信中は確認の表示中より先` と組の表の該当の行が落ちる。戻す
2. `if (input.activity !== 'working') …` を `if (input.activity === 'idle') …` にする（`describeAgentInterruptBlockedByActivity('idle')` を返す形）→ `活動が permission なら押せない…` などが落ちる。戻す
3. `getAgentInterruptAvailability` の `input.status === 'exited'` の条件を消す → `exited は出さず…` が落ちる。戻す
4. `git diff` で戻したことを確かめる

- [ ] **Step 8: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/lib/agentInterrupt.ts src/renderer/src/lib/agentSessionMessages.ts src/renderer/src/lib/__tests__/agentInterrupt.test.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み

---

### Task 4a: `useAgentSessions.interrupt`（sessionId の持ち主・世代・失敗の表示）

> **設計書の読む節:** 「データの流れ」の「押したときの処理」の後半（`useAgentSessions.interrupt` と `AgentInterruptOutcome`）、「エラー処理」、「既存の機能との関係」の「新しい状態と既存の入口」（`終了`・タブの `×`・起動し直し）、「テスト方針」の `useAgentSessions.test.ts`。
>
> **気をつける知見:** L-037（結果が届いた時点でタブの `sessionId` が送った値と同じときだけ結果を出す。違えば `stale`）・L-055（`Promise.resolve().then` で包み、同期の例外も拒否と同じに扱う。同期で投げる偽物をテストに入れる）・L-048（失敗はタブの `error`。`終了` の失敗と同じ出し方）・L-060（`AgentSessionsState.interrupt` は必須）・L-061（終了・閉じる・起動し直しとの組をテストする）

**Files:**

- Modify: `src/renderer/src/hooks/useAgentSessions.ts`
- Modify: `src/renderer/src/__tests__/makeAgentSessionsState.ts`（`interrupt` の既定）
- Test: `src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`

**Interfaces:**

- Consumes: Task 2 の `agentTerminalApi.interruptAgentSession(sessionId): Promise<AgentInterruptResult>`、Task 3 の `AGENT_INTERRUPT_ERROR_PREFIX`・`AGENT_INTERRUPT_ERROR_NO_SESSION`・`AGENT_INTERRUPT_ERROR_WRITE_FAILED`・`agentInterruptError(message)`、既存の `sessionIdBySlotRef`・`patchTab`・`findTab`・`mountedRef`・`agentTabSessionFieldsOf`・`toError`
- Produces:

```ts
// src/renderer/src/hooks/useAgentSessions.ts
export type AgentInterruptOutcome =
  | { kind: 'sent' }
  | { kind: 'skipped' } // そのタブにセッションが無い(IPC を呼ばない)
  | { kind: 'stale' } // 結果が届いた時点で、そのタブの sessionId が送った値と違う(起動し直した・終了した・閉じた)
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
  | { kind: 'error'; message: string } // invoke の拒否・同期の例外
// AgentSessionsState に必須で足す
interrupt: (slotId: string) => Promise<AgentInterruptOutcome>
```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`:

1. `const mockOnExit = vi.mocked(agentTerminalApi.onAgentExit)` の次に `const mockInterrupt = vi.mocked(agentTerminalApi.interruptAgentSession)` を足す（このファイルは `vi.mock('../../lib/agentTerminalApi')` で自動のモックなので、Task 2 で足した関数もモックになる）
2. `@shared/types` の型の import に `AgentInterruptResult` を、`../useAgentSessions` の型の import に `AgentInterruptOutcome` を足す
3. ファイルの末尾に次を足す:

```ts
describe('useAgentSessions — 中断(interrupt)', () => {
  // 結果を後から渡す interruptAgentSession の偽物の値
  function deferredResult(): {
    promise: Promise<AgentInterruptResult>
    resolve: (value: AgentInterruptResult) => void
  } {
    let resolve: (value: AgentInterruptResult) => void = () => undefined
    const promise = new Promise<AgentInterruptResult>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  const interruptNow = async (
    result: Rendered['result'],
    slotId = 'slot-1'
  ): Promise<AgentInterruptOutcome | undefined> => {
    let outcome: AgentInterruptOutcome | undefined
    await act(async () => {
      outcome = await result.current.interrupt(slotId)
    })
    return outcome
  }

  const startS1 = async (result: Rendered['result']): Promise<void> => {
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1', claudeSessionId: CSID })
    await startSelected(result)
  }

  it('セッションが無ければ IPC を呼ばず skipped', async () => {
    const { result } = render()
    expect(await interruptNow(result)).toEqual({ kind: 'skipped' })
    expect(mockInterrupt).not.toHaveBeenCalled()
  })

  it('そのタブの sessionId だけを渡し、sent を返す', async () => {
    const { result } = render()
    await startS1(result)
    mockInterrupt.mockResolvedValueOnce({ kind: 'sent' })
    expect(await interruptNow(result)).toEqual({ kind: 'sent' })
    expect(mockInterrupt).toHaveBeenCalledExactlyOnceWith('s1')
    expect(result.current.selected.error).toBeNull()
  })

  it.each<[AgentInterruptResult, string]>([
    [{ kind: 'no-session' }, '中断を送れませんでした: claude が終了したか、起動し直しました'],
    [{ kind: 'write-failed' }, '中断を送れませんでした: ターミナルへの書き込みに失敗しました']
  ])('%o はそのタブの error に出して、そのまま返す', async (ipcResult, message) => {
    const { result } = render()
    await startS1(result)
    mockInterrupt.mockResolvedValueOnce(ipcResult)
    expect(await interruptNow(result)).toEqual(ipcResult)
    expect(result.current.selected.error).toBe(message)
  })

  it('invoke の拒否は、接頭辞に例外の message を付けて error に出し、error を返す', async () => {
    const { result } = render()
    await startS1(result)
    mockInterrupt.mockRejectedValueOnce(new Error('ipc down'))
    expect(await interruptNow(result)).toEqual({ kind: 'error', message: 'ipc down' })
    expect(result.current.selected.error).toBe('中断を送れませんでした: ipc down')
  })

  it('window.api の呼び出しが同期で投げても、拒否と同じに扱う(L-055)', async () => {
    const { result } = render()
    await startS1(result)
    mockInterrupt.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(await interruptNow(result)).toEqual({ kind: 'error', message: 'boom' })
    expect(result.current.selected.error).toBe('中断を送れませんでした: boom')
  })

  it('結果を待つ間に終了して起動し直したら stale で、新しいセッションのタブに何も出さない(L-037)', async () => {
    const { result } = render()
    await startS1(result)
    const pending = deferredResult()
    mockInterrupt.mockReturnValueOnce(pending.promise)
    let outcome: Promise<AgentInterruptOutcome> | undefined
    act(() => {
      outcome = result.current.interrupt('slot-1')
    })
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's2', claudeSessionId: CSID })
    await startSelected(result)
    let settled: AgentInterruptOutcome | undefined
    await act(async () => {
      pending.resolve({ kind: 'no-session' })
      settled = await outcome
    })
    expect(settled).toEqual({ kind: 'stale' })
    expect(result.current.selected.status).toBe('running')
    expect(result.current.selected.error).toBeNull()
  })

  it('結果を待つ間にタブを閉じたら stale で、どのタブにも何も出さない', async () => {
    const { result } = render({ onConfirm: () => true })
    await runTwoTabs(result)
    const pending = deferredResult()
    mockInterrupt.mockReturnValueOnce(pending.promise)
    let outcome: Promise<AgentInterruptOutcome> | undefined
    act(() => {
      outcome = result.current.interrupt('slot-2')
    })
    await act(async () => {
      await result.current.closeTab('slot-2')
    })
    let settled: AgentInterruptOutcome | undefined
    await act(async () => {
      pending.resolve({ kind: 'write-failed' })
      settled = await outcome
    })
    expect(settled).toEqual({ kind: 'stale' })
    expect(result.current.tabs.map((tab) => [tab.slotId, tab.error])).toEqual([['slot-1', null]])
  })

  it('結果は押したタブの error に出す(結果が届いた時点で別のタブを選んでいても)', async () => {
    const { result } = render()
    await runTwoTabs(result)
    expect(result.current.selected.slotId).toBe('slot-2')
    mockInterrupt.mockResolvedValueOnce({ kind: 'write-failed' })
    await interruptNow(result, 'slot-1')
    expect(mockInterrupt).toHaveBeenCalledExactlyOnceWith('s-1')
    expect(tabOf(result.current, 'slot-1').error).toBe(
      '中断を送れませんでした: ターミナルへの書き込みに失敗しました'
    )
    expect(result.current.selected.error).toBeNull()
  })

  it('送れたら、そのタブの中断の失敗の文言だけを消し、終了の失敗の文言は消さない', async () => {
    const { result } = render()
    await startS1(result)
    mockInterrupt.mockResolvedValueOnce({ kind: 'write-failed' })
    await interruptNow(result)
    mockInterrupt.mockResolvedValueOnce({ kind: 'sent' })
    await interruptNow(result)
    expect(result.current.selected.error).toBeNull()
    mockStop.mockRejectedValueOnce(new Error('x'))
    await act(async () => {
      await result.current.stop('slot-1')
    })
    expect(result.current.selected.error).toBe('エージェントを終了できませんでした: x')
    mockInterrupt.mockResolvedValueOnce({ kind: 'sent' })
    await interruptNow(result)
    expect(result.current.selected.error).toBe('エージェントを終了できませんでした: x')
  })
})
```

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`
Expected: FAIL（`result.current.interrupt is not a function`）

- [ ] **Step 3: `interrupt` を実装する**

`src/renderer/src/hooks/useAgentSessions.ts`:

1. import: `import type { AgentInterruptResult, AgentLaunchRequest, AgentSessionExit } from '@shared/types'` にし、`../lib/agentSessionMessages` の import に `AGENT_INTERRUPT_ERROR_NO_SESSION, AGENT_INTERRUPT_ERROR_PREFIX, AGENT_INTERRUPT_ERROR_WRITE_FAILED, agentInterruptError` を足す
2. `export interface AgentLastExit …` の前に足す:

```ts
/** 中断(帯の 中断)の結果。送れたかだけを扱い、作業が止まったかは claude の画面の判定で分かる(L-001) */
export type AgentInterruptOutcome =
  | { kind: 'sent' }
  /** そのタブにセッションが無い(IPC を呼ばない) */
  | { kind: 'skipped' }
  /** 結果が届いた時点で、そのタブの sessionId が送った値と違う(起動し直した・終了した・閉じた)。何も出さない */
  | { kind: 'stale' }
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
  /** invoke の拒否・同期の例外 */
  | { kind: 'error'; message: string }
```

3. `AgentSessionsState` の `stop: (slotId: string) => Promise<boolean>` の次に足す:

```ts
/** そのタブの claude に中断(Esc を 1 回)を送る。押した時点の sessionId を控え、結果が届いた時点で同じときだけ結果を出す
 *  (違えば stale)。送れなかったらそのタブの error に出し、送れたらそのタブの中断の失敗の文言だけを消す。拒否しない */
interrupt: (slotId: string) => Promise<AgentInterruptOutcome>
```

4. `const stop = useCallback(…)` の後に足す:

```ts
// 送れたときに、そのタブの error が中断の失敗の文言なら消す(終了の失敗などほかの文言は消さない)
const clearInterruptError = useCallback(
  (slotId: string): void => {
    if (!mountedRef.current) return
    if (findTab(slotId) === undefined) return
    setStates((prev) => {
      const fields = agentTabSessionFieldsOf(prev, slotId)
      if (fields.error?.startsWith(AGENT_INTERRUPT_ERROR_PREFIX) !== true) return prev
      return new Map(prev).set(slotId, { ...fields, error: null })
    })
  },
  [findTab]
)

const interrupt = useCallback(
  async (slotId: string): Promise<AgentInterruptOutcome> => {
    const id = sessionIdBySlotRef.current.get(slotId)
    if (id === undefined) return { kind: 'skipped' }
    // 結果が届いた時点で、そのタブのセッションが送った相手のままか(古いセッションの結果を今のタブに出さない。L-037)
    const isCurrent = (): boolean => sessionIdBySlotRef.current.get(slotId) === id
    let result: AgentInterruptResult
    try {
      // 同期の例外も拒否と同じ経路で扱う(L-055)
      result = await Promise.resolve().then(() => agentTerminalApi.interruptAgentSession(id))
    } catch (err) {
      if (!isCurrent()) return { kind: 'stale' }
      const message = toError(err).message
      patchTab(slotId, { error: agentInterruptError(message) })
      return { kind: 'error', message }
    }
    if (!isCurrent()) return { kind: 'stale' }
    if (result.kind === 'sent') {
      clearInterruptError(slotId)
      return { kind: 'sent' }
    }
    patchTab(slotId, {
      error:
        result.kind === 'no-session'
          ? AGENT_INTERRUPT_ERROR_NO_SESSION
          : AGENT_INTERRUPT_ERROR_WRITE_FAILED
    })
    // ここでは no-session か write-failed(sent は上で返した)
    return result
  },
  [patchTab, clearInterruptError]
)
```

5. 戻り値の `stop,` の次に `interrupt,` を足す
6. `src/renderer/src/__tests__/makeAgentSessionsState.ts` の `stop: vi.fn<AgentSessionsState['stop']>(async () => true),` の次に `interrupt: vi.fn<AgentSessionsState['interrupt']>(async () => ({ kind: 'sent' })),` を足す

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`
Expected: PASS

- [ ] **Step 5: 変異で確かめる**

1. 成功の後の `if (!isCurrent()) return { kind: 'stale' }` を消す → `結果を待つ間に終了して起動し直したら stale…`・`結果を待つ間にタブを閉じたら stale…` が落ちる。戻す
2. `clearInterruptError` の `if (fields.error?.startsWith(AGENT_INTERRUPT_ERROR_PREFIX) !== true) return prev` を消す → `送れたら、そのタブの中断の失敗の文言だけを消し…` が落ちる。戻す
3. `patchTab(slotId, { error: … })` の `slotId` を、そのとき選択中のタブ（`tabs.getSnapshot().selectedSlotId`）にする → `結果は押したタブの error に出す…` が落ちる。戻す
4. `git diff` で戻したことを確かめる

- [ ] **Step 6: 検証**

Run: `npx vitest run`
Expected: PASS（`AgentSessionsState` に必須の `interrupt` を足したので、偽物を手で組み立てているテストがあれば型検査で落ちる。そのときは `makeAgentSessionsState` を使う形か、`interrupt: vi.fn(…)` を足す形で直す）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/hooks/useAgentSessions.ts src/renderer/src/__tests__/makeAgentSessionsState.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み

---

### Task 4b: `useAgentInterrupt` と `useAgentWorkspace` の配線

> **設計書の読む節:** 「設計で決めた事項」（押した時点の判定のやり直し・押せない理由の伝え方・中断の待ちの単位）、「データの流れ」の「押したときの処理」（`AgentInterruptPanelState`・`onInterrupt` の手順 1〜7）、「画面」の「読み上げ」、「連打の対策」、「既存の機能との関係」の「新しい状態と既存の入口」、「テスト方針」の `useAgentInterrupt.test.ts`・配線、「既知の制約」の 2 つ目（長い書きかけで `unknown` になる場合）。
>
> **気をつける知見:** L-058（押した処理の先頭で同じ純関数で判定し、押せなければ IPC を呼ばない）・L-057（押せない状態で押したときは手順 2・3 とも理由を読み上げる）・L-041（描画の値と押した時点の画面の読み直しの両方で確かめる）・L-053（`finally` で再入の防止を解く）・L-052（1,000ms は固定のタイマーで、アンマウントで消す）・L-408（同期の再入の防止と 1,000ms の待ち）・L-060（`AgentTerminalPanelState.interrupt` は必須。実物の組み立て役から `window.api.interruptAgentSession` まで届くテストと、受け渡しを 1 つずつ外す変異）・L-001（`sent` のときだけ読み上げる）

**Files:**

- Create: `src/renderer/src/hooks/useAgentInterrupt.ts`
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`（`AgentTerminalPanelState.interrupt` と組み立て）
- Modify: `src/renderer/src/__tests__/makeAgentTerminalPanelState.ts`（`makeAgentInterruptPanelState` と既定の `interrupt`）
- Test: `src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts`（新規）・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`

**Interfaces:**

- Consumes: Task 3 の `getAgentInterruptAvailability`・`describeAgentInterruptBlockedByActivity`・`AGENT_INTERRUPT_COOLDOWN_MS`・`agentInterruptSentNotice`・理由の文言、Task 4a の `AgentInterruptOutcome`・`AgentSessionsState.interrupt`、既存の `AgentSessionTabView`（`slotId`・`label`・`status`・`isClosing`・`controller`）・`classifyAgentScreen`・`useTransientNotice`・`useLatestRef`・`useAgentSendConfirm` の `pending`・`useAgentPromptSender` の `isSending`・`useAgentActivity` の結果、テストの補助 `makeAgentSessionTabView`・`makeFakeController`（`screen`）・`agentScreen`（`working`・`permission`・`empty`・`tallTyped`）
- Produces:

```ts
// src/renderer/src/hooks/useAgentInterrupt.ts
export const AGENT_INTERRUPT_NOTICE_MS = 3_000
export interface AgentInterruptPanelState {
  visible: boolean
  disabledReason: string | null
  notice: Announcement | null
  onInterrupt: () => void
}
export interface UseAgentInterruptOptions {
  selected: AgentSessionTabView
  activities: ReadonlyMap<string, AgentActivity>
  isSending: boolean
  isSendConfirmOpen: boolean
  interrupt: (slotId: string) => Promise<AgentInterruptOutcome>
}
export function useAgentInterrupt(options: UseAgentInterruptOptions): AgentInterruptPanelState
// src/renderer/src/hooks/useAgentWorkspace.ts の AgentTerminalPanelState に必須で足す
interrupt: AgentInterruptPanelState
// src/renderer/src/__tests__/makeAgentTerminalPanelState.ts
export function makeAgentInterruptPanelState(
  overrides?: Partial<AgentInterruptPanelState>
): AgentInterruptPanelState
```

- [ ] **Step 1: 失敗するテストを書く（hook。偽のタイマー）**

`src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts` を作る:

```ts
import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { useAgentInterrupt } from '../useAgentInterrupt'
import type { AgentInterruptPanelState, UseAgentInterruptOptions } from '../useAgentInterrupt'
import type { AgentInterruptOutcome, AgentSessionTabView } from '../useAgentSessions'
import type { AgentActivity } from '../../lib/agentActivity'
import { makeAgentSessionTabView } from '../../__tests__/makeAgentSessionsState'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'
import { agentScreen } from '../../lib/__tests__/fixtures/agentScreens'
import type { AgentScreenName } from '../../lib/__tests__/fixtures/agentScreens'
import {
  AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY,
  AGENT_INTERRUPT_DISABLED_COOLDOWN,
  AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  AGENT_INTERRUPT_DISABLED_SENDING,
  AGENT_INTERRUPT_NOT_RUNNING
} from '../../lib/agentSessionMessages'

type Props = Omit<UseAgentInterruptOptions, 'interrupt'>

let interrupt: ReturnType<typeof vi.fn<UseAgentInterruptOptions['interrupt']>>
let tab1: AgentSessionTabView
let consoleErrorSpy: MockInstance<typeof console.error> | null = null

// 実行中のタブ。readScreen は記録した画面(既定は作業中の画面)を返す
function runningTab(
  slotId: string,
  number: number,
  screen: AgentScreenName = 'working'
): AgentSessionTabView {
  const controller = makeFakeController()
  controller.screen = agentScreen(screen).lines
  return makeAgentSessionTabView({
    slotId,
    number,
    label: `claude ${number}`,
    status: 'running',
    controller
  })
}

const workingOf = (...slotIds: string[]): ReadonlyMap<string, AgentActivity> =>
  new Map(slotIds.map((slotId): [string, AgentActivity] => [slotId, 'working']))

function render(props: Partial<Props> = {}): RenderHookResult<AgentInterruptPanelState, Props> {
  const initialProps: Props = {
    selected: tab1,
    activities: workingOf(tab1.slotId),
    isSending: false,
    isSendConfirmOpen: false,
    ...props
  }
  return renderHook((p: Props) => useAgentInterrupt({ ...p, interrupt }), { initialProps })
}

const press = async (
  result: RenderHookResult<AgentInterruptPanelState, Props>['result']
): Promise<void> => {
  await act(async () => {
    result.current.onInterrupt()
  })
}

const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

// 結果を後から渡す interrupt の値
function deferredOutcome(): {
  promise: Promise<AgentInterruptOutcome>
  resolve: (value: AgentInterruptOutcome) => void
} {
  let resolve: (value: AgentInterruptOutcome) => void = () => undefined
  const promise = new Promise<AgentInterruptOutcome>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
  interrupt = vi.fn<UseAgentInterruptOptions['interrupt']>(async () => ({ kind: 'sent' }))
  tab1 = runningTab('slot-1', 1)
  consoleErrorSpy = null
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  consoleErrorSpy?.mockRestore()
})

describe('useAgentInterrupt', () => {
  it('作業中なら押せ、押すと選択中のタブの slotId で interrupt を呼び、送れたら読み上げる', async () => {
    const { result } = render()
    expect(result.current.visible).toBe(true)
    expect(result.current.disabledReason).toBeNull()
    await press(result)
    expect(interrupt).toHaveBeenCalledExactlyOnceWith('slot-1')
    expect(result.current.notice).toEqual({ text: 'claude 1 に中断（Esc）を送りました', id: 1 })
  })

  it('押してから 999ms は押せず(押すと理由を読み上げる)、1,000ms で押せる', async () => {
    const { result } = render()
    await press(result)
    advance(999)
    expect(result.current.disabledReason).toBe(AGENT_INTERRUPT_DISABLED_COOLDOWN)
    await press(result)
    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(result.current.notice?.text).toBe(AGENT_INTERRUPT_DISABLED_COOLDOWN)
    advance(1)
    expect(result.current.disabledReason).toBeNull()
    await press(result)
    expect(interrupt).toHaveBeenCalledTimes(2)
  })

  it('送れたときの読み上げは、同じ文言でも id が進む(パターン 87)', async () => {
    const { result } = render()
    await press(result)
    advance(1_000)
    await press(result)
    expect(result.current.notice).toEqual({ text: 'claude 1 に中断（Esc）を送りました', id: 2 })
  })

  it('待ちはタブごと: タブ A の結果を待つ間もタブ B は押せ、A をもう一度押しても呼ばない', async () => {
    const tab2 = runningTab('slot-2', 2)
    const activities = workingOf('slot-1', 'slot-2')
    interrupt.mockImplementation((slotId) =>
      slotId === 'slot-1'
        ? new Promise<AgentInterruptOutcome>(() => undefined)
        : Promise.resolve({ kind: 'sent' })
    )
    const { result, rerender } = render({ activities })
    await press(result)
    rerender({ selected: tab2, activities, isSending: false, isSendConfirmOpen: false })
    expect(result.current.disabledReason).toBeNull()
    await press(result)
    expect(interrupt.mock.calls).toEqual([['slot-1'], ['slot-2']])
    expect(result.current.notice?.text).toBe('claude 2 に中断（Esc）を送りました')
    rerender({ selected: tab1, activities, isSending: false, isSendConfirmOpen: false })
    expect(result.current.disabledReason).toBe(AGENT_INTERRUPT_DISABLED_COOLDOWN)
    await press(result)
    expect(interrupt).toHaveBeenCalledTimes(2)
  })

  it('結果を待つ間の同じタブの 2 回目は、IPC を呼ばず、読み上げもしない(同期の再入の防止)', async () => {
    interrupt.mockReturnValue(new Promise<AgentInterruptOutcome>(() => undefined))
    const { result } = render()
    act(() => {
      result.current.onInterrupt()
      result.current.onInterrupt()
    })
    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(result.current.notice).toBeNull()
  })

  it('結果が 1,000ms より遅く届く間は押せず、届いた後に押せる', async () => {
    const pending = deferredOutcome()
    interrupt.mockReturnValueOnce(pending.promise)
    const { result } = render()
    await press(result)
    advance(1_500)
    expect(result.current.disabledReason).toBe(AGENT_INTERRUPT_DISABLED_COOLDOWN)
    await press(result)
    expect(interrupt).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve({ kind: 'sent' })
    })
    expect(result.current.disabledReason).toBeNull()
  })

  it.each<[string, Partial<Props>, string]>([
    [
      '入力待ち',
      { activities: new Map<string, AgentActivity>([['slot-1', 'idle']]) },
      AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY.idle
    ],
    ['送信中', { isSending: true }, AGENT_INTERRUPT_DISABLED_SENDING],
    ['送信前の確認の表示中', { isSendConfirmOpen: true }, AGENT_INTERRUPT_DISABLED_SEND_CONFIRM]
  ])(
    '押せない状態(%s。手順 2)で押すと、IPC を呼ばず理由を読み上げる(L-058・L-057)',
    async (_name, props, reason) => {
      const { result } = render(props)
      expect(result.current.disabledReason).toBe(reason)
      await press(result)
      expect(interrupt).not.toHaveBeenCalled()
      expect(result.current.notice?.text).toBe(reason)
    }
  )

  it('終了したタブ(手順 2)では出さず、押しても IPC を呼ばず理由を読み上げる', async () => {
    const { result } = render({ selected: { ...tab1, status: 'exited' } })
    expect(result.current.visible).toBe(false)
    await press(result)
    expect(interrupt).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe(AGENT_INTERRUPT_NOT_RUNNING)
  })

  it('描画の活動は作業中でも、押した時点の画面が許可の確認(手順 3)なら IPC を呼ばず理由を読み上げる', async () => {
    const { result } = render({ selected: runningTab('slot-1', 1, 'permission') })
    expect(result.current.disabledReason).toBeNull()
    await press(result)
    expect(interrupt).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe(AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY.permission)
  })

  it('描画の活動は作業中でも、押した時点の画面が判定できない(長い書きかけで罫線が見えない。手順 3)なら IPC を呼ばず理由を読み上げる', async () => {
    const { result } = render({ selected: runningTab('slot-1', 1, 'tallTyped') })
    await press(result)
    expect(interrupt).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe(AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY.unknown)
  })

  it('押した時点の画面を読めなければ、送らずに console に記録する', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const controller = tab1.controller as FakeController
    controller.readScreen = () => {
      throw new Error('disposed')
    }
    const { result } = render()
    await press(result)
    expect(interrupt).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(result.current.notice).toBeNull()
  })

  it.each<AgentInterruptOutcome>([
    { kind: 'stale' },
    { kind: 'skipped' },
    { kind: 'no-session' },
    { kind: 'write-failed' },
    { kind: 'error', message: 'x' }
  ])(
    '結果が %o なら読み上げない(失敗は useAgentSessions がタブの error に出す)',
    async (outcome) => {
      interrupt.mockResolvedValueOnce(outcome)
      const { result } = render()
      await press(result)
      expect(result.current.notice).toBeNull()
    }
  )

  it('interrupt が拒否しても、送っている途中を解く(L-053)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    interrupt.mockRejectedValueOnce(new Error('unexpected'))
    const { result } = render()
    await press(result)
    advance(1_000)
    expect(result.current.disabledReason).toBeNull()
  })

  it('アンマウントでタブごとのタイマーをすべて消す', async () => {
    const tab2 = runningTab('slot-2', 2)
    const activities = workingOf('slot-1', 'slot-2')
    const { result, rerender, unmount } = render({ activities })
    await press(result)
    rerender({ selected: tab2, activities, isSending: false, isSendConfirmOpen: false })
    await press(result)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（配線。本物の組み立て役）**

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:

1. import に足す: `import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'`・`import { agentScreen } from '../../lib/__tests__/fixtures/agentScreens'`・`import { AGENT_INTERRUPT_DISABLED_SEND_CONFIRM, AGENT_INTERRUPT_DISABLED_SENDING } from '../../lib/agentSessionMessages'`（既存の `AGENT_START_DISABLED_SWITCHING_MODE` の import にまとめる）
2. `describe('useAgentWorkspace', () => {` の中の最後の `describe`（`履歴のエントリごとの操作(getHistoryActions・onResume)`）の後に足す:

```ts
describe('中断の配線(agentTerminal.interrupt。本物の useAgentSessions・useAgentInterrupt。L-060)', () => {
  const CLAUDE_ID = '11111111-1111-4111-8111-111111111111'
  let startSpy: MockInstance<typeof window.api.startAgentSession> | null = null
  let interruptSpy: MockInstance<typeof window.api.interruptAgentSession> | null = null
  let slotId: string

  beforeEach(async () => {
    const actual =
      await vi.importActual<typeof import('../useAgentSessions')>('../useAgentSessions')
    mockUseAgentSessions.mockImplementation(actual.useAgentSessions)
    setMode('agent-cli')
    startSpy = vi
      .spyOn(window.api, 'startAgentSession')
      .mockResolvedValue({ kind: 'started', sessionId: 'sid-wire', claudeSessionId: CLAUDE_ID })
    interruptSpy = vi.spyOn(window.api, 'interruptAgentSession').mockResolvedValue({ kind: 'sent' })
    // 文書ごとのタブの置き場(テストでは偽の controller の置き場)の選択中のタブを作業中の画面にする
    const snapshot = getAgentSessionTabs().getSnapshot()
    slotId = snapshot.selectedSlotId
    const controller = snapshot.tabs.find((tab) => tab.slotId === slotId)
      ?.controller as FakeController
    controller.screen = agentScreen('working').lines
    mockUseAgentActivity.mockReturnValue(new Map([[slotId, 'working']]))
  })

  afterEach(() => {
    startSpy?.mockRestore()
    interruptSpy?.mockRestore()
  })

  const renderStarted = async (): Promise<Rendered> => {
    const rendered = renderWorkspace({ folderPath: '/p' })
    await act(async () => {
      await rendered.result.current.agentTerminal.sessions.start(slotId, { kind: 'new' })
    })
    return rendered
  }

  it('作業中の選択中のタブで onInterrupt を呼ぶと、window.api.interruptAgentSession をそのタブの sessionId で呼び、読み上げる', async () => {
    const { result } = await renderStarted()
    expect(result.current.agentTerminal.interrupt.visible).toBe(true)
    expect(result.current.agentTerminal.interrupt.disabledReason).toBeNull()
    await act(async () => {
      result.current.agentTerminal.interrupt.onInterrupt()
    })
    expect(interruptSpy).toHaveBeenCalledExactlyOnceWith('sid-wire')
    const label = result.current.agentTerminal.sessions.selected.label
    expect(result.current.agentTerminal.interrupt.notice?.text).toBe(
      `${label} に中断（Esc）を送りました`
    )
  })

  it('送信中は理由を出し、押しても呼ばない', async () => {
    const { result, rerender } = await renderStarted()
    mockUseAgentPromptSender.mockReturnValue(makeSender({ isSending: true, sendingSlotId: slotId }))
    // 送信中の値で描き直す
    rerender()
    expect(result.current.agentTerminal.interrupt.disabledReason).toBe(
      AGENT_INTERRUPT_DISABLED_SENDING
    )
    await act(async () => {
      result.current.agentTerminal.interrupt.onInterrupt()
    })
    expect(interruptSpy).not.toHaveBeenCalled()
  })

  it('送信前の確認の表示中は理由を出し、押しても呼ばない', async () => {
    const { result } = await renderStarted()
    await act(async () => {
      await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
    })
    expect(result.current.agentSendConfirmDialog.pending).not.toBeNull()
    expect(result.current.agentTerminal.interrupt.disabledReason).toBe(
      AGENT_INTERRUPT_DISABLED_SEND_CONFIRM
    )
    await act(async () => {
      result.current.agentTerminal.interrupt.onInterrupt()
    })
    expect(interruptSpy).not.toHaveBeenCalled()
  })
})
```

（`rerender()` で、差し替えた送信中の値で `useAgentWorkspace` を描き直す。描き直さずに `onInterrupt` を呼ぶと、`useLatestRef` の値は前の描画のまま）

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: FAIL（`../useAgentInterrupt` が無い・`agentTerminal.interrupt` が undefined）

- [ ] **Step 4: `useAgentInterrupt` を実装する**

`src/renderer/src/hooks/useAgentInterrupt.ts` を作る:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Announcement } from '../types'
import { classifyAgentScreen } from '../lib/agentActivity'
import type { AgentActivity } from '../lib/agentActivity'
import {
  AGENT_INTERRUPT_COOLDOWN_MS,
  describeAgentInterruptBlockedByActivity,
  getAgentInterruptAvailability
} from '../lib/agentInterrupt'
import { agentInterruptSentNotice } from '../lib/agentSessionMessages'
import type { AgentInterruptOutcome, AgentSessionTabView } from './useAgentSessions'
import { useLatestRef } from './useLatestRef'
import { useTransientNotice } from './useTransientNotice'

// 帯の 中断 の押した処理・待ち・読み上げ(設計書 2026-10-19「押したときの処理」)。useAgentWorkspace が選択中のタブ・活動・送信中・
// 送信前の確認の表示中を渡し、結果を AgentTerminalPanelState.interrupt に載せる。
// 連打の対策は組で働く(L-408): 押してから 1,000ms は押せない(このファイル)・同期の再入の防止(このファイル)・
// ダブルクリックの 2 回目とキーリピートの無視(AgentTerminalPanel)・押した後もフォーカスを 中断 に残す(aria-disabled。AgentTerminalPanel)。
// どれかを外すと、押し続けた Enter が 1,000ms ごとに Esc を送る、または body に落ちたフォーカスの先へ届く

/** 読み上げ(送れたとき・押せない状態で押したとき)を出しておく時間 */
export const AGENT_INTERRUPT_NOTICE_MS = 3_000

export interface AgentInterruptPanelState {
  /** 出すか(選択中のタブが starting・running) */
  visible: boolean
  /** 押せない理由。押せるなら null */
  disabledReason: string | null
  /** 送れたとき・押せない状態で押したとき(手順 2・3)の読み上げ(3,000ms で null) */
  notice: Announcement | null
  /** 押したとき。押せないときは何もしない(理由を読み上げる) */
  onInterrupt: () => void
}

export interface UseAgentInterruptOptions {
  /** 選択中のタブ(押した処理は押した時点の値を使う) */
  selected: AgentSessionTabView
  /** タブごとの活動(useAgentActivity の結果。描画に使った値) */
  activities: ReadonlyMap<string, AgentActivity>
  /** プロンプトを送信している間(useAgentPromptSender の isSending) */
  isSending: boolean
  /** 送信前の確認のダイアログを開いている間(useAgentSendConfirm の pending が null でない) */
  isSendConfirmOpen: boolean
  /** そのタブのセッションへ中断を送る(useAgentSessions の interrupt。拒否しない) */
  interrupt: (slotId: string) => Promise<AgentInterruptOutcome>
}

const withSlot = (
  set: ReadonlySet<string>,
  slotId: string,
  present: boolean
): ReadonlySet<string> => {
  if (set.has(slotId) === present) return set
  const next = new Set(set)
  if (present) next.add(slotId)
  else next.delete(slotId)
  return next
}

export function useAgentInterrupt({
  selected,
  activities,
  isSending,
  isSendConfirmOpen,
  interrupt
}: UseAgentInterruptOptions): AgentInterruptPanelState {
  const { notice, announce } = useTransientNotice(AGENT_INTERRUPT_NOTICE_MS)
  // 結果を待っているタブ(同期の再入の防止)。state は次の描画まで変わらないため ref(useAgentPromptSender の sendingRef と同じ考え)。
  // 集合はタブごとなので、タブ A の結果を待つ間でもタブ B は押せる
  const interruptingSlotsRef = useRef(new Set<string>())
  // 押してから AGENT_INTERRUPT_COOLDOWN_MS の待ちのタイマー(タブごと)。押した処理は、これで 1,000ms 以内かを読む(常に最新)
  const cooldownTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // 描画用(押せない理由)。結果を待っているタブ・1,000ms の待ちのタブ
  const [waitingSlots, setWaitingSlots] = useState<ReadonlySet<string>>(() => new Set())
  const [coolingSlots, setCoolingSlots] = useState<ReadonlySet<string>>(() => new Set())
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    const timers = cooldownTimersRef.current
    return () => {
      mountedRef.current = false
      // アンマウントでタブごとの待ちのタイマーをすべて消す(L-052)
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const availability = getAgentInterruptAvailability({
    status: selected.status,
    isClosing: selected.isClosing,
    activity: activities.get(selected.slotId) ?? 'unknown',
    isSending,
    isSendConfirmOpen,
    isInterrupting: waitingSlots.has(selected.slotId) || coolingSlots.has(selected.slotId)
  })
  const latestRef = useLatestRef({ selected, activities, isSending, isSendConfirmOpen, interrupt })

  const startCooldown = useCallback((slotId: string): void => {
    const timers = cooldownTimersRef.current
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

  const onInterrupt = useCallback((): void => {
    const current = latestRef.current
    const tab = current.selected
    const { slotId, label } = tab
    // 1. 同期の再入の防止(同じタブの結果を待つ間)。何も出さない
    if (interruptingSlotsRef.current.has(slotId)) return
    // 2. 最新の値で押せるかを求め直す。ボタンの見た目が古くても送らない(L-058)。理由を読み上げる(L-057)
    const { reason } = getAgentInterruptAvailability({
      status: tab.status,
      isClosing: tab.isClosing,
      activity: current.activities.get(slotId) ?? 'unknown',
      isSending: current.isSending,
      isSendConfirmOpen: current.isSendConfirmOpen,
      isInterrupting: cooldownTimersRef.current.has(slotId)
    })
    if (reason !== null) {
      announce(reason)
      return
    }
    // 3. 押した時点の画面を読み直す。活動の判定は出力が 150ms 静まってから(最大 500ms 遅れて)行うため、作業中から許可の確認へ
    //    変わった直後に古い working のまま押されて、許可を拒否するのを防ぐ
    let screenActivity: AgentActivity
    try {
      screenActivity = classifyAgentScreen(tab.controller.readScreen())
    } catch (err) {
      console.error('[useAgentInterrupt] 画面を読めないため、中断を送りません:', err)
      return
    }
    if (screenActivity !== 'working') {
      announce(describeAgentInterruptBlockedByActivity(screenActivity))
      return
    }
    // 4. 送っている途中と 1,000ms の待ちを始める(待ちはタブごと)
    interruptingSlotsRef.current.add(slotId)
    setWaitingSlots((prev) => withSlot(prev, slotId, true))
    startCooldown(slotId)
    void (async () => {
      try {
        // 5・6. 送れたときだけ読み上げる(L-001)。stale・skipped は何も出さず、失敗は useAgentSessions がタブの error に出す
        const outcome = await current.interrupt(slotId)
        if (outcome.kind === 'sent' && mountedRef.current) announce(agentInterruptSentNotice(label))
      } catch (err) {
        console.error('[useAgentInterrupt] 中断の送信に失敗しました:', err)
      } finally {
        // 7. 例外でも固まらない(L-053)。1,000ms の待ちはタイマーが外す(結果が 1,000ms より遅いと、届くまで押せない)
        interruptingSlotsRef.current.delete(slotId)
        if (mountedRef.current) setWaitingSlots((prev) => withSlot(prev, slotId, false))
      }
    })()
  }, [latestRef, announce, startCooldown])

  return {
    visible: availability.visible,
    disabledReason: availability.reason,
    notice,
    onInterrupt
  }
}
```

- [ ] **Step 5: `useAgentWorkspace` に配線し、テストの補助を足す**

1. `src/renderer/src/hooks/useAgentWorkspace.ts`:
   - import に足す: `import { useAgentInterrupt } from './useAgentInterrupt'`・`import type { AgentInterruptPanelState } from './useAgentInterrupt'`
   - `AgentTerminalPanelState` の `resumeLast: AgentResumeLastState` の次に足す:

```ts
/** 帯の 中断(選択中のタブの claude に Esc を 1 回)。押せない理由・読み上げ・押したとき */
interrupt: AgentInterruptPanelState
```

- `const sendConfirm = useAgentSendConfirm({ … })` の直後に足す:

```ts
// 帯の 中断(設計書 2026-10-19)。押せないのは送信中・送信前の確認の表示中(送信の手順〈消去・貼り付け・Enter〉と Esc を混ぜない)と、
// 選択中のタブが作業中でないとき。送り先は押した時点の選択中のタブ
const agentInterrupt = useAgentInterrupt({
  selected: agentSessions.selected,
  activities,
  isSending: agentSender.isSending,
  isSendConfirmOpen: sendConfirm.pending !== null,
  interrupt: agentSessions.interrupt
})
```

- 戻り値の `agentTerminal: { … resumeLast: agentResume.resumeLast }` に `interrupt: agentInterrupt` を足す（`resumeLast: agentResume.resumeLast,` の次）

2. `src/renderer/src/__tests__/makeAgentTerminalPanelState.ts`:
   - import に `import type { AgentInterruptPanelState } from '../hooks/useAgentInterrupt'` を足す
   - `makeAgentTerminalPanelLayout` の後に足す:

```ts
/** 帯の 中断 の状態の型付きの偽物。既定は「出さない」(どのタブも未起動のとき) */
export function makeAgentInterruptPanelState(
  overrides: Partial<AgentInterruptPanelState> = {}
): AgentInterruptPanelState {
  return { visible: false, disabledReason: null, notice: null, onInterrupt: vi.fn(), ...overrides }
}
```

- `makeAgentTerminalPanelState` の戻り値の `resumeLast: { disabledReason: null, onResume: vi.fn() },` の次に `interrupt: makeAgentInterruptPanelState(),` を足す

- [ ] **Step 6: テストが通ることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: PASS

- [ ] **Step 7: 変異で確かめる**

`useAgentInterrupt.ts`:

1. 手順 1 の `if (interruptingSlotsRef.current.has(slotId)) return` を消す → `結果を待つ間の同じタブの 2 回目は…読み上げもしない` が落ちる（手順 2 の待ちの理由が読み上げられる）。戻す
2. 手順 2 の `isInterrupting: cooldownTimersRef.current.has(slotId)` を `false` にする → `押してから 999ms は押せず…` が落ちる。戻す
3. 手順 3（`let screenActivity` から `if (screenActivity !== 'working') { … }` まで）を消す → `…許可の確認(手順 3)なら…`・`…判定できない…(手順 3)なら…` が落ちる。戻す
4. `useEffect` の後始末の `for (const timer of timers.values()) clearTimeout(timer)` を消す → `アンマウントでタブごとのタイマーをすべて消す` が落ちる。戻す

`useAgentWorkspace.ts` の受け渡しを 1 つずつ外す（L-060）:

5. `isSending: agentSender.isSending` を `isSending: false` にする → `送信中は理由を出し、押しても呼ばない` が落ちる。戻す
6. `isSendConfirmOpen: sendConfirm.pending !== null` を `isSendConfirmOpen: false` にする → `送信前の確認の表示中は…` が落ちる。戻す
7. `activities,` を `activities: new Map(),` にする → `作業中の選択中のタブで onInterrupt を呼ぶと…` が落ちる（活動が `unknown` になり押せない）。戻す
8. `interrupt: agentSessions.interrupt` を `interrupt: async () => ({ kind: 'skipped' })` にする → `作業中の選択中のタブで onInterrupt を呼ぶと…` が落ちる。戻す
9. `git diff` で戻したことを確かめる

- [ ] **Step 8: 検証**

Run: `npx vitest run`
Expected: PASS（`AgentTerminalPanelState` に必須の `interrupt` を足したので、偽物を手で組み立てているテストは型検査で落ちる。`makeAgentTerminalPanelState` を使う形に直す）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/hooks/useAgentInterrupt.ts src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/__tests__/makeAgentTerminalPanelState.ts src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check <同じファイル>`
Expected: すべて整形済み

---

### Task 5: 帯のボタンと CSS（renderer）

> **設計書の読む節:** 「設計で決めた事項」（押せない状態の作り・出す間・押せない理由の伝え方・フォーカスの控え方・押し続け・連打・失敗の表示）、「画面」（帯のボタンの属性の表・読み上げ・フォーカス・狭い幅・ダークの色）、「連打の対策」、「テスト方針」の `AgentTerminalPanel.test.tsx`・`AgentTerminalPanel.styles.test.tsx`、「既知の制約」の最後の 2 つ（理由が見える文字でない・フォーカスの移し先）。
>
> **気をつける知見:** L-408（`event.detail > 1` の無視・`Enter`・`Space` のリピートの抑止・フォーカスを押したボタンに残す。ターミナルへフォーカスを移さない）・L-057（理由は `起動` と同じ隠した `span` と `aria-describedby`。見える文字は出さない）・L-058（押せないときの `click` でも `onInterrupt` を呼び、送らないことは hook が判定する）・L-048（読み上げは既存の `toAnnouncementText` と常設の要素。失敗は既存の `role="alert"`）

**Files:**

- Modify: `src/renderer/src/components/agent/AgentTerminalPanel.tsx`
- Modify: `src/renderer/src/assets/main.css`
- Test: `src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`・`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx`

**Interfaces:**

- Consumes: Task 4b の `AgentTerminalPanelState.interrupt`（`AgentInterruptPanelState`）・`makeAgentInterruptPanelState`、Task 3 の `AGENT_INTERRUPT_LABEL`・`AGENT_INTERRUPT_ARIA_LABEL`、既存の `toAnnouncementText`・`primaryButtonRef`・`toggleRef`・`startDisabled`・`.agent-terminal-panel__button`
- Produces: 帯の `中断`（`aria-label` `中断（作業中の claude に Esc を送る）`）・`p.agent-terminal-panel__live`（`role="status"`）・CSS の 2 つの規則（Global Constraints の「画面」）

- [ ] **Step 1: 失敗するテストを書く（部品）**

`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`:

1. import の `makeAgentTerminalPanelLayout, makeAgentTerminalPanelState` に `makeAgentInterruptPanelState` を足し、`import type { AgentInterruptPanelState } from '../../../hooks/useAgentInterrupt'` を足す
2. ファイルの末尾に次を足す:

```tsx
describe('AgentTerminalPanel: 中断', () => {
  const NAME = /^中断/
  const COOLDOWN = '中断を送りました。まだ作業中なら、少し待つと押せます'
  const IDLE = '入力待ちのため、中断する作業がありません'

  const runningState = (
    interrupt: Partial<AgentInterruptPanelState> = {},
    session: Partial<AgentSessionTabView> = {}
  ): AgentTerminalPanelState =>
    makeAgentTerminalPanelState({
      sessions: makeSessions({ status: 'running', ...session }),
      interrupt: makeAgentInterruptPanelState({ visible: true, ...interrupt })
    })
  // セッションが終わった帯(中断 は出さない)。rest で起動の理由などを渡す
  const exitedState = (
    session: Partial<AgentSessionTabView> = {},
    rest: Parameters<typeof makeAgentSessionsState>[0] = {}
  ): AgentTerminalPanelState =>
    makeAgentTerminalPanelState({
      sessions: makeSessions(
        { status: 'exited', exit: { exitCode: 0, reason: 'exited' }, ...session },
        rest
      ),
      interrupt: makeAgentInterruptPanelState({
        visible: false,
        disabledReason: 'claude が動いていないため中断できません'
      })
    })
  const interruptButton = (): HTMLElement => screen.getByRole('button', { name: NAME })

  it.each([
    ['starting', true],
    ['running', true],
    ['none', false],
    ['exited', false]
  ] as const)('%s の帯に出すか: %s(出すときは 終了 の直前)', (status, visible) => {
    render(
      <AgentTerminalPanel
        state={makeAgentTerminalPanelState({
          sessions: makeSessions({ status }),
          interrupt: makeAgentInterruptPanelState({ visible })
        })}
      />
    )
    const button = screen.queryByRole('button', { name: NAME })
    if (!visible) {
      expect(button).toBeNull()
      return
    }
    expect(button).toHaveTextContent('中断')
    expect(button).toHaveAccessibleName('中断（作業中の claude に Esc を送る）')
    const buttons = screen.getAllByRole('button')
    expect(buttons[buttons.indexOf(button as HTMLElement) + 1]).toBe(
      screen.getByRole('button', { name: /^終了/ })
    )
  })

  it('押せるときは aria-disabled・説明・title を付けない', () => {
    render(<AgentTerminalPanel state={runningState()} />)
    const button = interruptButton()
    expect(button).not.toHaveAttribute('aria-disabled')
    expect(button).not.toHaveAttribute('aria-describedby')
    expect(button).not.toHaveAttribute('title')
    expect(button).toBeEnabled()
  })

  it('押せないときは aria-disabled(disabled ではない)で、理由を説明(隠した span)と title に出し、見える文字にはしない(L-057)', () => {
    render(<AgentTerminalPanel state={runningState({ disabledReason: IDLE })} />)
    const button = interruptButton()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toHaveAttribute('disabled')
    expect(button).toHaveAccessibleDescription(IDLE)
    expect(button).toHaveAttribute('title', IDLE)
    const description = document.getElementById(button.getAttribute('aria-describedby') ?? '')
    expect(description).not.toBeVisible()
  })

  it('押すと onInterrupt を呼ぶ。押せないときの click でも呼ぶ(送らないことと理由の読み上げは hook の手順 2。L-058)', async () => {
    const enabled = runningState()
    const { unmount } = render(<AgentTerminalPanel state={enabled} />)
    await userEvent.click(interruptButton())
    expect(enabled.interrupt.onInterrupt).toHaveBeenCalledOnce()
    unmount()
    const disabled = runningState({ disabledReason: IDLE })
    render(<AgentTerminalPanel state={disabled} />)
    await userEvent.click(interruptButton())
    expect(disabled.interrupt.onInterrupt).toHaveBeenCalledOnce()
  })

  it('ダブルクリックの 2 回目(detail: 2)では onInterrupt を呼ばない', () => {
    const state = runningState()
    render(<AgentTerminalPanel state={state} />)
    fireEvent.click(interruptButton(), { detail: 1 })
    fireEvent.click(interruptButton(), { detail: 2 })
    expect(state.interrupt.onInterrupt).toHaveBeenCalledOnce()
  })

  it('Enter・Space のキーリピートの keydown は既定の動作を止め、単発の Enter・Space は止めない(L-408)', () => {
    render(<AgentTerminalPanel state={runningState()} />)
    const button = interruptButton()
    expect(fireEvent.keyDown(button, { key: 'Enter', repeat: true })).toBe(false)
    expect(fireEvent.keyDown(button, { key: ' ', repeat: true })).toBe(false)
    expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(button, { key: ' ' })).toBe(true)
    expect(fireEvent.keyDown(button, { key: 'a', repeat: true })).toBe(true)
  })

  it('読み上げの要素(role="status")は未起動でも常にあり、notice の文言を入れる', () => {
    const { container, rerender } = render(
      <AgentTerminalPanel state={makeAgentTerminalPanelState()} />
    )
    const live = container.querySelector('.agent-terminal-panel__live')
    expect(live).not.toBeNull()
    expect(live).toHaveAttribute('role', 'status')
    expect(live).toHaveTextContent('')
    rerender(
      <AgentTerminalPanel
        state={runningState({ notice: { text: 'claude 1 に中断（Esc）を送りました', id: 1 } })}
      />
    )
    expect(container.querySelector('.agent-terminal-panel__live')).toBe(live)
    expect(live).toHaveTextContent('claude 1 に中断（Esc）を送りました')
  })

  it('押せない状態に変わっても、フォーカスは 中断 に残る(aria-disabled のため body に落ちない)', () => {
    const { rerender } = render(<AgentTerminalPanel state={runningState()} />)
    interruptButton().focus()
    rerender(<AgentTerminalPanel state={runningState({ disabledReason: COOLDOWN })} />)
    expect(interruptButton()).toHaveFocus()
    expect(interruptButton()).toHaveAttribute('aria-disabled', 'true')
  })

  describe('セッションが終わって 中断 が消えたときのフォーカス(設計書「フォーカス」)', () => {
    const start = (): HTMLElement => screen.getByRole('button', { name: /^起動/ })
    const toggle = (): HTMLElement => screen.getByRole('button', { name: /エージェント/ })

    it('中断 にフォーカスがある状態で終わると、同じ帯の 起動 へ移る', () => {
      const { rerender } = render(<AgentTerminalPanel state={runningState()} />)
      interruptButton().focus()
      rerender(<AgentTerminalPanel state={exitedState()} />)
      expect(start()).toHaveFocus()
    })

    it('ウィンドウが非アクティブになって 中断 に blur・focusout が出た後に終わっても、起動 へ移る(onBlur で控えを消さない)', () => {
      const { rerender } = render(<AgentTerminalPanel state={runningState()} />)
      const button = interruptButton()
      button.focus()
      // jsdom はウィンドウの非アクティブ化で blur を出さないため、Chromium の振る舞いを手で出す
      button.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }))
      button.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
      window.dispatchEvent(new FocusEvent('blur'))
      rerender(<AgentTerminalPanel state={exitedState()} />)
      expect(start()).toHaveFocus()
    })

    it('外れる直前に 中断 へ blur・focusout が出ても(Chromium が要素を外すときの blur)、起動 へ移る', () => {
      const { rerender } = render(<AgentTerminalPanel state={runningState()} />)
      const button = interruptButton()
      button.focus()
      button.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }))
      button.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
      rerender(<AgentTerminalPanel state={exitedState()} />)
      expect(start()).toHaveFocus()
    })

    it('パネルの中のほかの要素(タブ)へ移してから終わると、移さない(控えは最後にフォーカスを受けた要素)', () => {
      const { rerender } = render(<AgentTerminalPanel state={runningState()} />)
      interruptButton().focus()
      const tab = screen.getByRole('tab')
      tab.focus()
      // タブからも外して body に落とす(控えが 中断 のままなら、終わったときに 起動 へ移してしまう)
      tab.blur()
      expect(document.activeElement).toBe(document.body)
      rerender(<AgentTerminalPanel state={exitedState()} />)
      expect(document.activeElement).toBe(document.body)
    })

    it('パネルの外の要素へ移してから終わると、その要素のまま(奪わない)', () => {
      const outside = document.createElement('button')
      outside.textContent = 'outside'
      document.body.appendChild(outside)
      try {
        const { rerender } = render(<AgentTerminalPanel state={runningState()} />)
        interruptButton().focus()
        outside.focus()
        rerender(<AgentTerminalPanel state={exitedState()} />)
        expect(outside).toHaveFocus()
      } finally {
        outside.remove()
      }
    })

    it.each<[string, Partial<AgentSessionTabView>, Parameters<typeof makeAgentSessionsState>[0]]>([
      ['閉じる途中', { isClosing: true }, {}],
      ['起動できない理由がある', {}, { startDisabledReason: 'フォルダを開いてください' }]
    ])('起動 が押せない(%s)ときは、開閉のボタン(エージェント)へ移る', (_name, session, rest) => {
      const { rerender } = render(<AgentTerminalPanel state={runningState()} />)
      interruptButton().focus()
      rerender(<AgentTerminalPanel state={exitedState(session, rest)} />)
      expect(start()).toBeDisabled()
      expect(toggle()).toHaveFocus()
    })
  })
})
```

（`screen.getByRole('tab')` は、既定のタブ 1 つの帯のタブ。`AgentSessionTabList` のタブのボタンが `role="tab"` を持つ）

- [ ] **Step 2: 失敗するテストを書く（CSS）**

`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx`:

1. import に `import { makeAgentInterruptPanelState } from '../../../__tests__/makeAgentTerminalPanelState'` を足す（既存の `makeAgentTerminalPanelState` の import にまとめる）
2. `describe('ターミナルパネルの見出しの帯のスタイル(main.css)', () => {` の中の `it('ボタンのフォーカスリングは帯の内側に描く…')` の後に足す:

```tsx
describe('中断のボタン', () => {
  // 実行中の帯(中断・終了・最大化)。disabledReason を渡すと押せない(aria-disabled)状態
  function renderRunning(disabledReason: string | null): HTMLElement {
    const state: AgentTerminalPanelState = makeAgentTerminalPanelState({
      sessions: makeAgentSessionsState({ selected: { status: 'running' } }),
      interrupt: makeAgentInterruptPanelState({ visible: true, disabledReason })
    })
    render(<AgentTerminalPanel state={state} />)
    return screen.getByRole('button', { name: /^中断/ })
  }
  const cssRules = (): CSSStyleRule[] =>
    Array.from(styleElement.sheet?.cssRules ?? []).filter(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule
    )
  const indexOfRule = (selector: string): number =>
    cssRules().findIndex((rule) => rule.selectorText.split(/,\s*/).includes(selector))

  it('縮まず、折り返さない(共通のボタンの規則)', () => {
    const style = getComputedStyle(renderRunning(null))
    expect(style.flexShrink).toBe('0')
    expect(style.whiteSpace).toBe('nowrap')
    expect(style.minWidth).toBe('32px')
    expect(style.minHeight).toBe('32px')
  })

  it('押せない(aria-disabled)ときは :disabled と同じ見た目(不透明度 0.5・矢印のカーソル)', () => {
    const style = getComputedStyle(renderRunning('入力待ちのため、中断する作業がありません'))
    expect(style.opacity).toBe('0.5')
    expect(style.cursor).toBe('default')
  })

  it('押せるときは薄くしない', () => {
    expect(getComputedStyle(renderRunning(null)).opacity).not.toBe('0.5')
  })

  it('押せないときのホバーは色を変えない(既存のホバーの規則より後ろに置いて打ち消す)', () => {
    // jsdom は :hover を計算しないため、規則そのものを CSSOM から探す
    const disabledHover = indexOfRule(".agent-terminal-panel__button[aria-disabled='true']:hover")
    const hover = indexOfRule('.agent-terminal-panel__button:hover:not(:disabled)')
    expect(disabledHover).toBeGreaterThan(-1)
    expect(disabledHover).toBeGreaterThan(hover)
    const rule = cssRules()[disabledHover]
    expect(rule.style.cssText).toContain('background: none')
    expect(rule.style.getPropertyValue('color')).toBe('rgb(204, 204, 204)')
  })
})
```

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx`
Expected: FAIL（`中断` のボタン・読み上げの要素・`aria-disabled` の規則が無い）

- [ ] **Step 4: 帯のボタン・読み上げの要素・フォーカスの移し先を実装する**

`src/renderer/src/components/agent/AgentTerminalPanel.tsx`:

1. import:
   - `import { useCallback, useId, useLayoutEffect, useRef } from 'react'`
   - `../../lib/agentSessionMessages` の import に `AGENT_INTERRUPT_ARIA_LABEL, AGENT_INTERRUPT_LABEL` を足す
   - `import { toAnnouncementText } from '../../lib/announcementText'` を足す
2. 冒頭のコメントの `見出しの帯(開閉・セッションのタブ・状態・起動/終了・変更を確認・最大化)` を `見出しの帯(開閉・セッションのタブ・状態・中断・起動/終了・変更を確認・最大化)` にする
3. `const { sessions, layout, sendingSlotId, activities, resumeLast } = state` を `const { sessions, layout, sendingSlotId, activities, resumeLast, interrupt } = state` にする
4. `const primaryButtonRef = useRef<HTMLButtonElement>(null)` の後に足す:

```tsx
const interruptRef = useRef<HTMLButtonElement>(null)
const interruptReasonId = useId()
// パネルの中で最後にフォーカスを受けた要素が 中断 か(section の onFocus〈focusin で泡立つ〉だけで控える)。onBlur では消さない:
// ウィンドウが非アクティブになったときや、Chromium が要素を DOM から外すときにも blur が出るため(設計書「フォーカス」)
const lastFocusedWasInterruptRef = useRef(false)
const wasInterruptVisibleRef = useRef(interrupt.visible)
// セッションが終わって 中断 が消えたとき、フォーカスが body に落ちていれば同じ帯の主ボタン(終了 が替わった 起動)へ移す。
// 起動 が disabled なら focus() が効かないため、帯にいつもある開閉のボタンへ移す。ターミナルへは移さない(続けて押した Enter が
// claude の書きかけを送信しうる)。奪わない判定は activeElement だけに任せる(利用者がパネルの外へ移していれば body ではない)
useLayoutEffect(() => {
  const wasVisible = wasInterruptVisibleRef.current
  wasInterruptVisibleRef.current = interrupt.visible
  if (!wasVisible || interrupt.visible) return
  const shouldMove = lastFocusedWasInterruptRef.current
  // 移した・移さないに関わらず控えを戻す(古い控えを次の回に残さない)
  lastFocusedWasInterruptRef.current = false
  if (!shouldMove) return
  const active = document.activeElement
  if (active !== null && active !== document.body) return
  const primary = primaryButtonRef.current
  if (primary !== null && !primary.disabled) primary.focus()
  else toggleRef.current?.focus()
}, [interrupt.visible])
```

5. `<section` の属性の `aria-label="エージェント"` の次に足す（JSX の属性の断片）:

<!-- prettier-ignore -->
```tsx
      onFocus={(event) => {
        lastFocusedWasInterruptRef.current = event.target === interruptRef.current
      }}
```

6. `<span className="agent-terminal-panel__actions">` の中の、起動の理由の `{visibleReason !== null && !isActive && ( … )}` の後、`{/* 起動 と 終了 は同じ位置の 1 つの button として描く … */}` の前に足す（`起動`・`終了` の三項演算子とは別の子にする。三項演算子の中に入れると `終了` の要素が作り直され、押した後のフォーカスが `終了` に残らなくなる）:

<!-- prettier-ignore -->
```tsx
{interrupt.visible && (
  <>
    {/* 押せない理由は見える文字にしない(title と説明だけ。狭い帯で状態の文言・タブ列を押し出さないため。既知の制約) */}
    {interrupt.disabledReason !== null && (
      <span id={interruptReasonId} hidden>
        {interrupt.disabledReason}
      </span>
    )}
    {/* disabled ではなく aria-disabled: 押して作業が止まるとすぐ押せなくなるが、disabled だとフォーカスが body に落ち、
        キーリピートが隣の 終了 などへ届いて会話を失う。押せない状態で押したときは hook が理由を読み上げて送らない。
        1,000ms の待ち・同期の再入の防止(useAgentInterrupt)と、ダブルクリック・キーリピートの無視(ここ)は組で働く(L-408) */}
    <button
      ref={interruptRef}
      type="button"
      className="agent-terminal-panel__button"
      aria-label={AGENT_INTERRUPT_ARIA_LABEL}
      aria-disabled={interrupt.disabledReason !== null ? true : undefined}
      aria-describedby={interrupt.disabledReason !== null ? interruptReasonId : undefined}
      title={interrupt.disabledReason ?? undefined}
      onClick={(event) => {
        // ダブルクリックの 2 回目は捨てる(キーボードのクリックは detail が 0 で影響しない)
        if (event.detail > 1) return
        interrupt.onInterrupt()
      }}
      onKeyDown={(event) => {
        // 押し続けた Enter・Space のリピートで、1,000ms ごとに Esc を送らない(単発の打鍵は止めない)
        if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault()
      }}
    >
      {AGENT_INTERRUPT_LABEL}
    </button>
  </>
)}
```

（`.agent-terminal-panel__actions` の `span` の子としてそのまま貼る JSX の断片。字下げは貼る位置に合わせ、`npx prettier --write` で整える）

7. `section` の最後の子として、`</section>` の直前（本文の `<div id={bodyId} …>…</div>` の閉じタグの後。`section` の直接の子）に足す。6 の断片と同じく JSX の子の形で貼る（先頭に `;` を付けない。付けると `;` が文字として帯の下に描かれ、テスト・eslint・prettier のどれも検出しない）:

<!-- prettier-ignore -->
```tsx
{/* 中断の読み上げ(送れたとき・押せない状態で押したとき)。ライブリージョンは先に在る必要があるため常に描く(パターン 87) */}
<p className="agent-terminal-panel__live" role="status">
  {toAnnouncementText(interrupt.notice)}
</p>
```

- [ ] **Step 5: CSS を足す**

`src/renderer/src/assets/main.css`:

1. 視覚的に隠す規則の並び（`/* 通知の文言の読み上げ(視覚的に隠す。.agent-terminal-panel__hint と同じ規則) */` の下の `.external-change-banner__live,` から始まるセレクタ）の `.agent-send-feedback__live {` を `.agent-send-feedback__live,\n.agent-terminal-panel__live {` にする（`.agent-send-feedback__live,` の行の次に `.agent-terminal-panel__live {` の行）
2. `.agent-terminal-panel__toggle:focus-visible,\n.agent-terminal-panel__button:focus-visible { … }` の規則の後に足す（既存の `.agent-terminal-panel__button:hover:not(:disabled)` より後ろなので、同じ詳細度のホバーを打ち消せる）:

```css
/* 帯の 中断 の押せない状態(aria-disabled。フォーカスを残すため disabled にしない)。:disabled と同じ見た目にし、ホバーで色を変えない */
.agent-terminal-panel__button[aria-disabled='true'] {
  opacity: 0.5;
  cursor: default;
}

.agent-terminal-panel__button[aria-disabled='true']:hover {
  background: none;
  color: #cccccc;
}
```

- [ ] **Step 6: テストが通ることを確かめる**

Run: `npx vitest run src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx src/renderer/src/components/__tests__/App.agentCli.test.tsx`
Expected: PASS（`App.agentCli.test.tsx` の `.agent-announcer` のテストが、パネルの読み上げの要素を拾わずに通る）

- [ ] **Step 7: 変異で確かめる**

1. `onClick` の `if (event.detail > 1) return` を消す → `ダブルクリックの 2 回目(detail: 2)では…` が落ちる。戻す
2. `onKeyDown` の `event.preventDefault()` を消す → `Enter・Space のキーリピートの keydown は…` が落ちる。戻す
3. `aria-disabled={…}` を `disabled={interrupt.disabledReason !== null}` にする → `押せない状態に変わっても、フォーカスは 中断 に残る…`・`押せないときの click でも呼ぶ…` が落ちる。戻す
4. `section` の `onFocus` を消す → `中断 にフォーカスがある状態で終わると…` が落ちる。戻す
5. `onFocus` の代わりに `onBlur={() => { lastFocusedWasInterruptRef.current = false }}` を足す（`onFocus` は残す）→ `ウィンドウが非アクティブになって…`・`外れる直前に…` が落ちる。戻す
6. `if (primary !== null && !primary.disabled) primary.focus()` の `&& !primary.disabled` を消す → `起動 が押せない(…)ときは…` が落ちる。戻す
7. `if (active !== null && active !== document.body) return` を消す → `パネルの外の要素へ移してから終わると…` が落ちる。戻す
8. `main.css` の `.agent-terminal-panel__button[aria-disabled='true']:hover` の規則を `.agent-terminal-panel__button:hover:not(:disabled)` の規則より前へ移す → `押せないときのホバーは色を変えない…` が落ちる。戻す
9. `git diff` で戻したことを確かめる

- [ ] **Step 8: 検証**

Run: `npx vitest run`
Expected: PASS（パネルの中に `role="status"` の要素が増えたため、エージェント CLI 方式の画面で `getByRole('status')` を使う既存のテストが複数の一致で落ちたら、そのテストの対象の領域を `within(…)` で絞る。製品のコードは変えない）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/components/agent/AgentTerminalPanel.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx`
Expected: エラー・警告なし
Run: `npx prettier --check src/renderer/src/components/agent/AgentTerminalPanel.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx src/renderer/src/assets/main.css`
Expected: すべて整形済み

---

### Task 6: ROADMAP の更新・既知の制約・テスト仕様書と全体の検証（テスト仕様書への追記と Artifact の再公開）

> **設計書の読む節:** 「ROADMAP の更新の方針」、「既知の制約」、「実機テスト仕様書の新しい項目の下書き」、「実装の分割」の 6、「main に入れた時点で利用者から見える挙動」。CLAUDE.md の実機テスト仕様書の規則（書式・ID を変えない・接頭辞ごとの連番）と `scripts/build-manual-test-spec.mjs`。
>
> **気をつける知見:** L-354（新しい項目の文言は、実装後のコードの文言と照らし合わせて確定してから追記する）・L-072（ファイルを書き換える指示を含めない・保存される設定は戻す・書きかけは項目の終わりに消す・プロセスを止める手順は対象を 1 つに決め、決まらなければ止めない。`-9` を使わない）

**Files:**

- Modify: `docs/superpowers/specs/2026-10-19-agent-interrupt-ui-design.md`（「既知の制約」を実装と照らし合わせた食い違いと、プランの冒頭の「計画の時点で設計書から調整した細部」の反映）
- Modify: `docs/manual-test-spec.md`（`### 実行の中断` と AGT-214〜227、`### 帯の中断と利用者の変更との区別` と AGC-146〜147。**既存の項目の ID と文言は変えない**）
- Modify: `ROADMAP.md`（**prettier にかけない**）
- 生成（git 管理外）: `.superpowers/manual-test-spec.html`

**Interfaces:**

- Consumes: Task 1〜5 の実装（文言は Global Constraints の「文言」と一字一句同じ。正は `src/renderer/src/lib/agentSessionMessages.ts`）、Task 1 の記録の結果（設計書の「既知の制約」に書いたもの）
- Produces: 実機テスト仕様書の AGT-214〜AGT-227・AGC-146〜AGC-147（コントローラーが Artifact を再公開する）

- [ ] **Step 1: 設計書の「既知の制約」を実装と照らし合わせ、調整した細部を設計書に反映する**

`sed -n '/^## 既知の制約/,/^## 構成/p' docs/superpowers/specs/2026-10-19-agent-interrupt-ui-design.md` で読み、1〜6 を実装と照らし合わせる。食い違いがあれば設計書の行を実装に合わせて直す（無ければ変えない）。7 は設計書のほかの節も直す:

1. 押せる条件が `working` だけであること（`getAgentInterruptAvailability` の `blockedReasonOf`）
2. 長い書きかけの行の「押した時点の読み直し（手順 3）が `unknown` になり送らない（理由は読み上げだけ）」が `useAgentInterrupt` の手順 3 のとおりか
3. 「中断が効いて作業が終わると、既存の通知が…`claude N の作業が終わりました` を読み上げ」— `useAgentNotifications` を変えていないこと（`git diff --stat src/renderer/src/hooks/useAgentNotifications.ts` が空）
4. 「連打の対策は帯の `中断` だけ」— `agentTerminalKeys.ts` を変えていないこと（`git diff --stat src/renderer/src/lib/agentTerminalKeys.ts` が空）
5. キューの行が Task 1 の記録の結果に置き換わっていること（`実装時の記録（「実装の最初に確かめること」3）の結果をここに書く` の文が残っていない）
6. フォーカスの移し先の行が `AgentTerminalPanel` の `useLayoutEffect`（控えが `中断` で、activeElement が body のときだけ移す）のとおりか
7. 設計書の「読み上げ」「IPC」「構成」「フォーカス」の該当の語を、プランの冒頭の「計画の時点で設計書から調整した細部」に合わせて直す。「決めたこと（利用者の確認済み）」「決めたこと（推奨案で決めた事項）」の表の文言（「送った後の表示」の `.agent-announcer` を含む）は変えず、細部の節で補う:
   - 「画面」の「読み上げ」: `.agent-announcer` で見えなくした `p` を、`p.agent-terminal-panel__live`（`main.css` の `.agent-announcer` と同じ視覚的に隠す規則の並びに足した class）にし、`.agent-announcer` にしない理由（`App.agentCli.test.tsx` の `querySelector('.agent-announcer')` が App の常設の読み上げを探している）と、「送った後の表示」の `.agent-announcer` をこの class に読み替える旨を 1 文で足す
   - 「IPC」の表の shared の行の `types.ts` と「構成」の表の `src/shared/types.ts` を `src/shared/types/agentTerminal.ts`（`src/shared/types.ts` が `export type *` で再 export する）にする
   - 「フォーカス」の `移した後は控えを false にする` を、移した・移さないに関わらず、出す状態から出さない状態に変わった描画のたびに控えを false に戻す旨にする
   - 「反映した知見」の L-048 の行の `.agent-announcer` も、`agent-terminal-panel__live`（`.agent-announcer` と同じ隠し方）にする
   - 直した後、`grep -n 'agent-announcer' docs/superpowers/specs/2026-10-19-agent-interrupt-ui-design.md` の一致が「決めたこと（推奨案で決めた事項）」の表の行と、「読み上げ」の読み替えの文だけであることを確かめる

- [ ] **Step 2: 実機テスト仕様書の文言を実装と照らし合わせる（L-354）**

Run:

```bash
cd <repo-root>
for s in '中断（作業中の claude に Esc を送る）' '入力待ちのため、中断する作業がありません' '許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）' '確認待ちのため中断できません（ターミナルで選んでください）' '作業中か判定できないため押せません（ターミナルで Esc を押すと中断できます）' '起動中は中断できません' 'に中断（Esc）を送りました'; do
  grep -qF "$s" src/renderer/src/lib/agentSessionMessages.ts && echo "OK $s" || echo "NG $s"
done
grep -nF "の作業が終わりました" src/renderer/src/lib/*.ts src/shared/*.ts | head -3
```

Expected: すべて `OK`。最後の `grep` で、既存の完了の読み上げの文言（AGT-216 が引く `claude 1 の作業が終わりました`）が今もあることを確かめる。`NG` が出たら、Step 3 で足す項目の文言をコードの文字列に合わせて直す（コードは変えない）

- [ ] **Step 3: 実機テスト仕様書に新しい節と項目を足す**

`docs/manual-test-spec.md`:

1. 「## エージェント CLI のアプリ内ターミナル」の最後の節 `### セッションの再開と履歴` の最後の項目（今の最大の **AGT-213** の行）の直後、`## エージェントの変更の確認` の前に、空行を 1 つ置いて次をそのまま足す（1 行 1 項目。新しい項目は AGT-214 から振る。既存の AGT-040・AGT-046・AGT-048 は変えない）:

```text
### 実行の中断

> 前提: エージェント CLI 方式で、テスト用のフォルダを開いて `claude 1` を起動している。長い作業は `1 から 300 までの数を、1 行に 1 つずつ書き出して` のように、ツールを使わずに応答が続くプロンプトを `実行` で送って作る。

- [ ] **AGT-214** `claude 1` が入力待ち（入力欄が空）のときに帯を見て、`中断` の上にマウスを載せてから押す → 状態の文言と `終了` の間に `中断` が薄い色で出て、`入力待ちのため、中断する作業がありません` が出る（マウスの `title`）。押しても `claude` の画面は変わらない
- [ ] **AGT-215** 長い作業を送り、帯が `作業中` になったら `中断` を押す → `中断` は押せる色で、押すと 1 秒以内に `claude` の画面に `Interrupted` が出て作業が止まり、帯が `入力待ち` に、`中断` が薄い色に戻る。`claude` は終了せず（帯は `終了しました` にならない）、続けて `さっきの続きを 10 行だけ書いて` を送ると前の作業を踏まえて答える
- [ ] **AGT-216** VoiceOver を有効にして長い作業を送り、`F6` でターミナルから抜けて（フォーカスが開閉のボタン `エージェント` に移る）から `Tab` で `中断` へ移って `Enter` を押す → `中断（作業中の claude に Esc を送る）` と読まれ、押すと `claude 1 に中断（Esc）を送りました` が読み上げられる（続けて既存の `claude 1 の作業が終わりました` も読まれうる）。押した後もフォーカスリングは `中断` に残り、もう一度読ませると押せない理由が読まれる。続けて入力待ちのまま 1 秒以上待ってから `Enter` を押すと、`入力待ちのため、中断する作業がありません` が読み上げられる。確かめた後、VoiceOver を切る
- [ ] **AGT-217** 長い作業の間に、ターミナルの入力欄へ `書きかけ` と入力して（送信しない）から、帯の `中断` を押す → 作業が止まり、入力欄の `書きかけ` は消えずに残る。確かめた後、ターミナルで書きかけを消す（`Ctrl+U`）
- [ ] **AGT-218** 長い作業の間に `中断` をすばやくダブルクリックする。別の回に、`F6` でターミナルから抜けて（フォーカスが開閉のボタン `エージェント` に移る）から `Tab` で `中断` へ移って `Enter` を 2 秒押し続ける。どちらも先に入力欄へ `書きかけ` を入力しておく → どちらの回も作業が 1 回止まるだけで、入力欄の `書きかけ` は残り、`claude` は終了しない。確かめた後、ターミナルで書きかけを消す（`Ctrl+U`）
- [ ] **AGT-219** `このフォルダに interrupt-test.txt を作って` を送り、ツールの許可の確認（`Do you want to …?`）が出たら帯の `中断` にマウスを載せてから押す → `中断` は薄い色で、`許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）` が出る。押しても許可の確認は残る（拒否されない）。確かめた後、ターミナルで `No` の選択肢を選んで答える（ファイルは作られない）。許可の確認が出ずにファイルが作られた（`claude` の設定で許可済み）ときは、そのことを記録して次へ進む（作られたのはテスト用のフォルダの中だけ）
- [ ] **AGT-220** ターミナルで `/model` の選択の画面を開き（選択肢は選ばない。`Enter` を押すとモデルの設定が保存されるため押さない）、帯の `中断` にマウスを載せる → `確認待ちのため中断できません（ターミナルで選んでください）` が出て押せない。確かめた後、ターミナルで `Esc` を押して選ばずに閉じる
- [ ] **AGT-221** ターミナルを 12 行ほどに低くし、長い作業の間に入力欄へ画面の上端に達するまで書きかける（AGT-120 と同じ。送信しない）→ 帯は `作業中` のまま。VoiceOver を有効にして `中断` を押すと、作業は止まらず `作業中か判定できないため押せません（ターミナルで Esc を押すと中断できます）` が読み上げられる。作業が終わって帯が `実行中` になると `中断` は薄い色で、マウスを載せると同じ理由が出る。確かめた後、書きかけを消す（`Ctrl+U`）・ターミナルの高さを元に戻す・VoiceOver を切る
- [ ] **AGT-222** `+` で `claude 2` を起動し、`claude 1` に長い作業を送ってから `claude 2`（入力待ち）を選ぶ → `中断` は押せない。`claude 1` を選び直すと押せ、押すと `claude 1` だけが止まり、`claude 2` の画面は変わらない
- [ ] **AGT-223** `終了` で `claude 1` を止めて帯を見る。続けて `起動` を押し、起動中の帯を見る → 止めた後は `中断` が出ない（`起動`・`前回の続きから` の並びは今までどおり）。起動中は `中断` が薄い色で出て、マウスを載せると `起動中は中断できません` が出る（起動中は短いので、見られなかったらそのことを記録して次へ進む。起動中の理由は `agentInterrupt.test.ts`・`AgentTerminalPanel.test.tsx` で固定している）
- [ ] **AGT-224** `claude 1` を起動して入力待ちにする。別の端末（ターミナル.app など）で `pgrep -f 'prompt-ide/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'` を実行し、このリポジトリの Electron の親のプロセスの pid を確かめる（ちょうど 1 つでなければ、何も止めずに出力を記録して終える）。`pgrep -P <その pid>` で子の pid を出し、子ごとに `lsof -a -d cwd -p <子の pid>` を実行して、作業ディレクトリ（`NAME` の列）がテスト用のフォルダのものを選ぶ（macOS では `claude` のプロセス名がシンボリックリンクの先の版の番号になるため、`lsof -c claude` のようにコマンド名では絞らない）。当てはまる pid がちょうど 1 つでなければ、何も止めずに `pgrep` と `lsof` の出力を記録して終える。1 つなら、その端末で `sleep 10; kill <その pid>` を実行し（`-9` は付けない）、すぐにアプリのウィンドウへ戻って `F6` でターミナルから抜けて（フォーカスが開閉のボタン `エージェント` に移る）から `Tab` で帯の `中断` へフォーカスを移し、ウィンドウを前面にしたまま 10 秒待つ → 帯が `終了しました…` になり、`中断` が消え、フォーカスは同じ帯の `起動`（`終了` が替わったボタン）にあってフォーカスリングが見える（画面の外に落ちない）。`起動` が押せない状態なら `エージェント`（開閉のボタン）にある
- [ ] **AGT-225** サイドバーを開いたまま、ウィンドウの幅を AGT-040 と同じく 650px 程度まで狭め、長い作業の間の帯を見る → 帯は 1 行（高さ 32px）のまま、`エージェント`・`中断`・`終了`・`最大化` のボタンは文字も枠も切れずに見える。タブ列と `作業中` は狭まって途中で切れうる
- [ ] **AGT-226** 長い作業の間に、押せる `中断` と押せない（入力待ちの）`中断` のそれぞれにマウスを載せる。`Tab` で移ったときのフォーカスリングも見る → 押せるときはホバーで青の背景・白の文字になり、押せないときは薄い色のままホバーで色が変わらず、カーソルは矢印。フォーカスリングはボタンの内側に、上下も切れずに見える
- [ ] **AGT-227** 設定の実行方式を「従来の方式」に切り替えて（確認で OK）エディタの下部を見る → ターミナルパネルは出ず、`中断` もどこにも無い。出力パネルの `キャンセル` は今までどおり（RUN-022）。確かめた後、設定の実行方式をエージェント CLI に戻す（保存される設定のため）
```

2. 「## エージェントの変更の確認」の最後の節 `### 利用者の git の設定とハンクを戻す` の最後の項目（今の最大の **AGC-145** の行）の直後、`## ソース管理（基本）` の前に、空行を 1 つ置いて次をそのまま足す（新しい項目は AGC-146 から振る）:

```text
### 帯の中断と利用者の変更との区別

> 前提: 「利用者の変更との区別」の節の前提（B-2 の前提を含む）と同じ。この領域の冒頭の前提の手順でテスト用のリポジトリを作り直して開き（`R=$(mktemp -d); cd "$R" && git init …`）、そのリポジトリの直下で `echo .claude/ >> .git/info/exclude` を実行してから、アプリの中のタブで `claude` を起動する。項目ごとに、`claude` で「こんにちは」を送って確かめた状態にしてから `確認を終える` → `いまから記録する` で新しい記録を始める。端末のコマンドは、項目の先頭の `cd "$R"`（`$R` を作った端末で実行する。別の端末なら作ったときに表示されたパスへ `cd` する）の後、`pwd` がテスト用のリポジトリであることを確かめてから実行する。

- [ ] **AGC-146** 端末で `cd "$R"` を実行しておく。エージェントに `sleep 20 を実行して` を送り（許可を求められたら許可する）、実行中に帯の `中断` を押し、すぐ端末で `echo after >> b.txt` を実行して `更新` → `M b.txt` は印なし（AGC-117 と同じ。中断では `Stop` が届かない）。中断から 30 秒以内に次の指示（`こんにちは`）を送り、作業が終わった後に端末で `echo after2 >> f.txt` を実行して `更新` → `A f.txt` に `利用者の変更` が出る
- [ ] **AGC-147** 端末で `cd "$R"` を実行しておく。`sleep 20 を実行して` を送り（許可を求められたら許可する）、実行中に帯の `中断` を押して、次の指示を送らずに 40 秒待ってから端末で `echo held >> b.txt` を実行して `更新` → `M b.txt` は印なしで、区別の状態の 1 行 `アプリの中で claude が動いていなかった間などの変更には、印を付けていません` が出る（AGC-127 と同じ）。続けて `こんにちは` を送り、作業が終わった後に端末で `echo resumed >> f.txt` を実行して `更新` → `A f.txt` に `利用者の変更` が出る
```

3. Task 1 の記録で、`interrupted` の帯の状態（`入力待ち`）や書きかけが残ること（AGT-215・AGT-217）が設計書の「既知の制約」と食い違う結果になっていたら、その項目の期待結果を記録の結果に合わせて直す（ID は変えない）
4. `grep -cE '^- \[ \] \*\*AGT-(21[4-9]|22[0-7])\*\*' docs/manual-test-spec.md` が `14`、`grep -cE '^- \[ \] \*\*AGC-14[67]\*\*' docs/manual-test-spec.md` が `2` であること（項目の行だけを数える。既存の AGT-200〜213 は数えない）と、`grep -nE 'AGT-21[4-9]|AGT-22[0-7]|AGC-14[67]' docs/manual-test-spec.md | wc -l` で、AGT-214〜227 の 14 項目と AGC-146・147 の 2 項目が 1 回ずつあることを確かめる（2 つ目の数は、項目の行のほかに本文から ID を引いている行があれば増える。新しい項目の中で ID を引いているのは AGT-221 の `AGT-120`・AGT-224 の `AGT-160`・AGT-225 の `AGT-040`・AGC-146 の `AGC-117`・AGC-147 の `AGC-127` だけで、これらは数えない）

- [ ] **Step 4: HTML を再生成し、仕様書の検査を通す**

Run: `node scripts/build-manual-test-spec.mjs`
Expected: `.superpowers/manual-test-spec.html (N 領域 / M 項目)` が出る（項目の数が足す前より 16 増えている）
Run: `npx vitest run scripts`
Expected: PASS（ID の一意性・接頭辞ごとの連番の昇順〈欠番は許容〉・書式）
Run: `npx prettier --check docs/manual-test-spec.md`
Expected: 整形済み

Artifact（<manual-test-spec-artifact-url>）の再公開は、このタスクの実装者ではなく**コントローラーが** `.superpowers/manual-test-spec.html` を同じファイルパスで公開して行う（実装者は HTML の生成までで止め、報告に「再公開が必要」と書く）。

- [ ] **Step 5: ROADMAP を更新する（prettier にかけない）**

`<実装の日>` は `date +%Y-%m-%d` の出力に置き換える。行番号は計画の時点のもの（`grep -n` で該当の文を探してから直す）。

1. 「### Claude API 連携（プロンプト実行。テキスト生成型の旧方式）」の `- [x] 実行中のキャンセル操作（CLI 実行のキャンセル）`（:93）を次にする:

```text
- [x] 実行中のキャンセル操作（CLI 実行のキャンセル）（エージェント CLI 方式の中断は「エージェントの実行の中断」。従来の方式は子プロセス・API の要求を止め、エージェント CLI 方式は `claude` を止めずに作業だけを止める）
```

2. 「### エージェントが変更したファイルの確認（MVP の次）」の既知の制約の行（:198）の `起動から最初のプロンプトまで・中断の後を含む` を `起動から最初のプロンプトまで・中断（帯の \`中断\` を含む）の後を含む` にする（行のほかの部分は変えない）
3. 「### エージェントの変更の利用者の編集との区別（`claude` の hooks）」の行（:419）の `中断（Esc）の後に次のターンの \`Stop\` が届くまで`を`中断（Esc。帯の \`中断\` を含む）の後に次のターンの \`Stop\` が届くまで` にする（行のほかの部分は変えない）
4. 同じ節の行（:426）の行頭の `中断（Esc）では \`Stop\` が届かないため`を`中断（Esc。帯の \`中断\` を含む）では \`Stop\` が届かないため` にする（行のほかの部分は変えない）
5. 「### エージェントの変更の Git 管理外のフォルダでの記録」の最後の既知の制約の行（`- 利用者が \`safe.bareRepository=explicit\` を設定していると、…`）の後、`---`（`## MVP: エージェント CLI のアプリ内ターミナル実行` の前の区切り）の前に、空行を 1 つ置いて新しい節を足す:

```text
### エージェントの実行の中断

設計書: `docs/superpowers/specs/2026-10-19-agent-interrupt-ui-design.md`（<実装の日>）。

- [x] エージェント CLI 方式で `claude` が動いている間（起動中・実行中）、ターミナルパネルの帯の `終了` の左に `中断` を出す。選択中のタブの `claude` が作業中のときだけ押せ、押すとターミナルで `Esc` を 1 回押したのと同じ 1 バイト（`\x1b`）を送る（`claude` は終了せず、会話は失わない。pty を止めるのは今までどおり `終了`）。従来の方式は出力パネルの `キャンセル` のまま
- [x] 押せないとき（起動中・閉じる途中・プロンプトの送信中・送信前の確認の表示中・押してから 1 秒以内・許可待ち・確認待ち・入力待ち・作業中か判定できない画面）は薄い色（`aria-disabled`）で、理由をマウスの `title` と読み上げの説明（`aria-describedby`）に出し、押すと理由を読み上げる。押した時点で画面を読み直し、作業中でなければ送らない
- [x] 送れたら `claude N に中断（Esc）を送りました` を読み上げる。送れなかったら帯の下に `中断を送れませんでした: …` を出す（次の `起動` か、次に送れたときに消える）
- [x] 連打の対策: 押してから 1,000ms はそのタブの `中断` を押せない（待ちはタブごと）・ダブルクリックの 2 回目とキーリピートを無視する・押した後もフォーカスを `中断` に残す。セッションが終わって `中断` が消えたら、フォーカスを同じ帯の `起動`（押せなければ開閉のボタン）へ移す
- [x] 専用の IPC `agentTerminal:interrupt`（renderer からは `sessionId` だけを渡し、main が固定の 1 バイトを書く。そのウィンドウの今のセッションと一致するときだけ書く）

既知の制約（設計書の「既知の制約」と同じ）:

- 押せる条件は画面の見た目からの活動の判定に基づくため、`claude` の版で画面が変わって判定が外れると、作業中でも押せない（`実行中` と表示され、ターミナルの `Esc` を使う）。判定が外れても、作業中でないときに送る側には倒れない
- 作業中に長い書きかけで入力欄の上の罫線が見えない（スピナーの行が画面の外にある）間は、`classifyAgentScreen` は `unknown` を返すが、`useAgentActivity` は出力が続く間の上限の判定で `unknown` を採らずに前の `working` を保つため、帯は `作業中` のままで `中断` も押せる見た目になる。押した時点の読み直し（手順 3）が `unknown` になり送らない（理由は読み上げだけで、画面には出ない。晴眼の利用者には押しても何も起きないように見える）。作業が終わって出力が止まると `実行中` になり押せない
- 中断の後の画面の判定は、実装時に記録した画面（「実装の最初に確かめること」）で確かめる。記録した版から `claude` の画面が変わると外れうる
- 押した時点で画面を読み直して作業中を確かめるが、確かめてから `claude` が `Esc` を受け取るまでの数 ms の間に許可の確認が出ると、`Esc` は許可の拒否として働く（`claude` は代わりにどうするかを尋ねる）
- 中断が効いて作業が終わると、既存の通知が作業の完了として `claude N の作業が終わりました` を読み上げ、ウィンドウにフォーカスが無ければ OS の通知を出す（中断と完了を区別しない）
- エージェントの変更の確認では、中断の後に `Stop` が届かないため、30 秒以内に次の指示を送らないと次の指示まで割り当てを保留する（ターミナルの `Esc` と同じ。2026-10-13 の設計書）
- 連打の対策は帯の `中断` だけ。ターミナルで利用者が `Esc` を続けて押すと、今までどおり 2 回目で入力欄の書きかけを消しうる
- 作業中のキューの送信待ちが中断でどうなるかは、実装時の記録（「実装の最初に確かめること」3）の結果をここに書く
- 中断は選択中のタブだけ。裏のタブの作業を止めるには、そのタブを選んでから押す
- 押せない理由は見える文字として出さない（`title` と `aria-describedby`、押したときの読み上げだけ）。晴眼のキーボード利用者には理由の文が見えず、隣の状態の文言（`入力待ち` など）と薄い色で判断する
- セッションが終わって `中断` が消えたときのフォーカスの移し先は「パネルの中で最後にフォーカスを受けた要素が `中断` か」で決める。`中断` にフォーカスを置いたまま、パネルの外の何も無いところ（フォーカスを受けない場所）をクリックして body に落とした後に終わると、`起動` へ移る
```

- 既知の制約の箇条は、Step 1 と Task 1 の Step 12 で設計書を直した後の `sed -n '/^## 既知の制約（ROADMAP/,/^## 構成/p' docs/superpowers/specs/2026-10-19-agent-interrupt-ui-design.md` の出力のうち `- ` で始まる行と同じにする（上は計画の時点の設計書の行。直した行・足した行があれば、その出力のとおり順を変えずに置き換える）

6. 「## 今後実装した方がよい機能（未実装）」の「### エージェント実行の支援（MVP の次）」の `- [ ] 実行のキャンセル / 中断の UI（現在はエージェント側の操作に任せる）`（:533）を次の 2 行にする（2 行目の字下げは 6 つの空白。上の項目の `- 実装済み（…）` の行と同じ）:

```text
- [x] 実行のキャンセル / 中断の UI
      - 実装済み（<実装の日>。設計書 `docs/superpowers/specs/2026-10-19-agent-interrupt-ui-design.md`）: エージェント CLI 方式の帯の `中断`（選択中のタブの `claude` に `Esc` を 1 回送る）。従来の方式は「Claude API 連携」の「実行中のキャンセル操作」を参照
```

7. 「## MVP: エージェント CLI のアプリ内ターミナル実行」の対象外の行（:507。`実行のキャンセル UI（エージェント側の操作に任せる）` を含む行）は MVP の時点の範囲の記録なので変えない
8. `grep -n "実行のキャンセル / 中断の UI（現在は" ROADMAP.md` が何も出さないこと、`git diff --stat ROADMAP.md` で ROADMAP の変更が上の 6 か所だけであること（prettier で整形していないこと）を確かめる

- [ ] **Step 6: 全体の検証**

Run: `npx vitest run`
Expected: PASS（時間切れで落ちたファイルは `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書く）
Run: `npm run typecheck`
Expected: PASS
Run: `git diff --name-only -- '*.ts' '*.tsx' && git ls-files --others --exclude-standard -- '*.ts' '*.tsx'` で、このプランで変更・作成した TypeScript のファイルを列挙し、`npx eslint --max-warnings 0 <列挙したファイル>` と `npx prettier --check <列挙したファイル>`
Expected: エラー・警告なし・すべて整形済み
Run: `npx vitest run scripts`
Expected: PASS
Run: `pgrep -fl amt-test- || true`
Expected: 何も出ない（統合テストの子が残っていない）
Run: `git status --short`
Expected: このプランで変えたファイルと、設計書・プランの未追跡・変更のファイルだけが出る（`.superpowers/` は git 管理外。Task 1 の作業用のディレクトリはスクラッチパッドの中で、消してある）。報告に「Artifact の再公開が必要」と書く

---

## Self-Review（計画の作成者が設計書と照らし合わせた結果）

**1. 設計書の要件と対応するタスク:**

| 設計書の要件                                                                                                                                                                                                                                                     | タスク                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 実装の最初に確かめること 1（`exp3.js` の `interrupt`・`interruptdraft`・`interruptqueued`。見張り・Enter を送らない条件はそのまま）                                                                                                                              | 1（Step 2）                        |
| 同 2（記録・`interrupted` は `idle` を固定・`interruptedDraft` の書きかけ・キューの行方）                                                                                                                                                                        | 1（Step 5・7・11・12）             |
| 同 3（元の台帳の末尾に文字列のまま足す・`sanitize.py`・個人情報のテスト・`AGENT_SCREENS_SHA256`・`fixtures/README.md` の両方の SHA-256・行数・画面の数・`EXPECTED`）                                                                                             | 1（Step 8〜11）                    |
| 同 4（版の記述 4 か所: `_note`〈ハッシュの前〉・`agentScreens.ts`・`fixtures/README.md`・`agentActivity.test.ts`。同じ版なら画面の数だけ）                                                                                                                       | 1（Step 8・10）                    |
| 同 5（`pgrep -fl "local/bin/claude"`）                                                                                                                                                                                                                           | 1（Step 1・6）                     |
| 記録用の README の手順 3 への追記                                                                                                                                                                                                                                | 1（Step 3）                        |
| `AgentInterruptResult`・`AGENT_INTERRUPT_SEQUENCE`・`AgentSession.interrupt`（停止の途中は書かない・結果を返す）・registry（`findBySessionId`）・受け口（`invoke`・メインフレーム・`parseAgentSessionId`・`Pick`）・preload・`index.d.ts`・`agentTerminalApi.ts` | 2                                  |
| main のテスト（偽の pty の `toEqual`・`not-alive`・`write-failed`・別の所有者・古い sessionId・停止中・拒否・余分な引数）と実物の node-pty の統合テスト（raw モードの子・`1b` だけ・Windows は飛ばす）・preload のテスト                                         | 2                                  |
| `getAgentInterruptAvailability`（`visible`・表の順・`NOT_RUNNING`）・`describeAgentInterruptBlockedByActivity`（`Record<Exclude<…>>`）・`AGENT_INTERRUPT_COOLDOWN_MS`                                                                                            | 3                                  |
| 理由・読み上げ・失敗の文言（一字一句）                                                                                                                                                                                                                           | 3                                  |
| `useAgentSessions.interrupt`（`skipped`・`Promise.resolve().then`・`stale`・タブの `error`・中断の失敗の文言だけを消す）                                                                                                                                         | 4a                                 |
| `useAgentInterrupt`（手順 1〜7・タブごとの待ち・`Map<slotId, timer>`・アンマウントで消す・読み上げ）                                                                                                                                                             | 4b                                 |
| `useAgentWorkspace` の配線（`AgentTerminalPanelState.interrupt` 必須・送信中・確認の表示中・活動・`sessions.interrupt`）と受け渡しを 1 つずつ外す変異                                                                                                            | 4b                                 |
| 帯のボタン（位置・名前・`aria-disabled`・隠した理由・`title`・class）・ダブルクリック・キーリピート・読み上げの要素・フォーカスの控えと移し先（6 つの場合）・押せない状態に変わってもフォーカスが残る                                                            | 5                                  |
| ダークの色（`[aria-disabled='true']` の不透明度・ホバー）・狭い幅（縮まない）                                                                                                                                                                                    | 5                                  |
| ROADMAP の更新の方針（:93・:198・:419・:426・:533・新しい節・:507 は変えない）                                                                                                                                                                                   | 6                                  |
| 実機テスト仕様書（AGT-214〜227・AGC-146〜147・HTML の再生成・`npx vitest run scripts`・Artifact はコントローラー）                                                                                                                                               | 6                                  |
| 設計書の「既知の制約」の照合                                                                                                                                                                                                                                     | 1（記録の結果）・6（実装との照合） |

「新しい状態と既存の入口」の表（L-061）: 送信 → 4b の配線のテスト（送信中・確認の表示中は押せない）と 3 の表、ターミナルのキー入力 → 変えない（`agentTerminalKeys.ts` を変えないことを 6 の Step 1 で確かめる）、`終了` → 2 の registry の停止中のテスト・4a の起動し直しの `stale`、タブの選択・`+`・`×`・再開 → 4b の「待ちはタブごと」・4a の閉じたタブの `stale`、方式・フォルダの切り替え → 4a の `stale`（セッションが止まり sessionId が変わる）・従来の方式ではパネルが出ない（既存）、リサイズ・作業中の知らせ → 変えない。「エラー処理」の各行は、2（`no-session`・`write-failed`・拒否）・4a（`skipped`・`stale`・同期の例外・文言）・4b（手順 3 の作業中でない・読めない）で押さえる。

抜けは見つからなかった。

**2. 書きかけの検索:** `TBD`・`TODO`・「同じように」・説明だけのコードの Step を探した。Task 1 の記録の結果に依る値（版 `V`・行数 `N`・2 つの SHA-256・`interruptedQueued` の活動・キューの行方）は、求めるコマンドと、値を書く場所の前後の文字列を書いた（計画の時点では実物の記録が無いため値そのものは書けない）。ROADMAP・実機テスト仕様書の追記は、設計書の該当の行をそのまま写した。

**3. 名前と型の一貫性:** `AgentInterruptResult`・`AGENT_INTERRUPT_SEQUENCE`・`AgentSession.interrupt`・`AgentSessionRegistry.interrupt`・`'agentTerminal:interrupt'`・`interruptAgentSession`・`AGENT_INTERRUPT_COOLDOWN_MS`・`AgentInterruptAvailabilityInput`・`AgentInterruptAvailability`・`getAgentInterruptAvailability`・`describeAgentInterruptBlockedByActivity`・文言の 14 の名前・`AgentInterruptOutcome`・`AgentSessionsState.interrupt`・`AGENT_INTERRUPT_NOTICE_MS`・`AgentInterruptPanelState`・`UseAgentInterruptOptions`・`useAgentInterrupt`・`AgentTerminalPanelState.interrupt`・`makeAgentInterruptPanelState`・`agent-terminal-panel__live` を、Global Constraints・各タスクの Interfaces・実装・テストで同じ名前と型にした。既存の名前（`findBySessionId`・`parseAgentSessionId`・`isMainFrameSender`・`makeFakePty`・`makeSlowStoppingSession`・`makeEvent`・`register`・`waitForFile`・`createTestTimers`・`sessionIdBySlotRef`・`patchTab`・`findTab`・`agentTabSessionFieldsOf`・`toError`・`makeAgentSessionTabView`・`makeFakeController`・`agentScreen`・`AgentScreenName`・`useTransientNotice`・`useLatestRef`・`toAnnouncementText`・`primaryButtonRef`・`toggleRef`・`getAgentSessionTabs`・`makeSender`・`setMode`・`renderWorkspace`）は今のコードに合わせた。

**作成中に直した点:**

- 読み上げの要素の class を `.agent-announcer` にすると、`App.agentCli.test.tsx` の `querySelector('.agent-announcer')` がパネルの要素を先に拾って落ちることに気づき、`agent-terminal-panel__live` にして隠す規則の並びに足す形にした
- `中断` を `起動`／`終了` の三項演算子の中（`<>…</>` で包む形）に入れると、`終了` の要素が作り直されて AGT-213 のフォーカスのテストが落ちることに気づき、三項演算子の前の別の子にした
- `AgentInterruptResult` の置き場が設計書の `src/shared/types.ts` ではなく `src/shared/types/agentTerminal.ts` であることを確かめ、そちらに足す形にした
- 「パネルの中のほかの要素へ移すと移さない」のテストは、そのままでは activeElement がタブのままで控えに関係なく移らないため、タブからも外して body に落としてから終わらせる形にした（控えの効き目を確かめる）
- `interruptqueued` の待ちを `queued` にすると、貼り付けた文字にも `queued` が含まれて待ちがすぐ終わることに気づき、キューの案内（`edit queued messages`・`ctrl+s to send now`）で待つ形にした
- 元の台帳に足す書き出し方（`json.dumps(…, indent=1, ensure_ascii=False)` と U+00A0 のエスケープ・2 つの空白の字下げ）を、既存の 28 画面にかけて台帳の文字列と一致することを計画の時点で確かめた
- 記録用の `node-pty`・`@xterm/headless` を取得し直さず、版が同じリポジトリの `node_modules` へのリンクで使う形にし、片付けでリンクを先に外してから消す手順にした
