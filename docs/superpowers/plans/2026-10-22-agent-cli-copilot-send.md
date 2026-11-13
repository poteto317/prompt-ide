# claude 以外のエージェント CLI への対応 段階 2b（copilot へのプロンプトの送信）実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定で GitHub Copilot CLI（`copilot`）を選んだときも、プロンプトの一覧の `実行`・履歴の `再実行`・送信前の確認から `copilot` の入力欄へプロンプトを送れるようにする（入力待ちのときだけ送り、書きかけ・先頭の `!` と `/` は断り、末尾の `@` の語は末尾に空白を 1 つ足して貼り、`Enter` の後に送れたことを画面で確かめる）。`claude` を選んでいる間の挙動は変えない。

**Architecture:** 送信の手順を CLI の種類ごとの表（renderer の `lib/agentPromptSendSpecs.ts` の `AGENT_PROMPT_SEND_SPECS`。項目は押せる条件に入力待ちと中断の流れを入れるか〈`requiresIdle`〉と手順〈`send`〉）に分け、`claude` は今の `sendAgentPrompt` を中身を変えずに `lib/claudePromptSend.ts` へ移して `sendClaudePrompt` に改名したもの、`copilot` は新しい `sendCopilotPrompt`（`lib/copilotPromptSend.ts`）を引く。`copilot` の入力欄の特定と読み取りは段階 2a の `copilotScreenActivity.ts` から `lib/copilotInputBox.ts` へ切り出し、記号・入力欄の行・空と書きかけの見分け・echo の確かめを足す。本文の検査は shared の `agentPasteText.ts` の種類ごとの表 `AGENT_PROMPT_TEXT_RULES`、失敗の文言は `agentSendMessages.ts` の共通の表と種類の表で引く。押せる条件（`getPromptRunAvailability`）に送り先のタブの活動と中断の流れを足し、`useAgentPromptSender` は押した時点にも中断の流れを確かめ直す。新しい IPC は足さない（利用者のキー入力と同じ `agentTerminal:write`）。

**Tech Stack:** Electron（renderer だけを変える。main・preload・IPC は変えない）, React 19, TypeScript, node-pty 1.1.0 と `@xterm/headless` 6.0.0（偽の CLI の統合テスト）, Vitest（仮想の時計・偽の controller・偽のタイマー）, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-22-agent-cli-copilot-send-design.md`（承認済み。実装の前に必ず読む）。このプランは設計書の「実装の分割」の 1〜6 を、下の 7 つのタスクに割り当てた（「計画の時点で設計書から調整した細部」の 1 つ目）。各タスクで読む節はタスクの冒頭に書いた。書き方の参考は `docs/superpowers/plans/2026-10-21-agent-cli-copilot-screen.md`。

**実装の前に読むもの:** `$DEV_FLOW_KIT/lessons/review-lessons.md` の「優先度 A のチェックリスト」（CLAUDE.md の「実装前の確認」）。今回の変更に関係する項目は本文も読む。

**反映する知見（dev-flow-kit の `lessons/review-lessons.md`）:** 依頼で指定された L-001・L-017・L-019・L-037・L-041・L-059・L-072・L-157・L-408・L-414・L-593・L-594・L-596・L-597 と、設計書が使った L-058・L-060・L-061・L-083・L-354・L-398（各タスクの冒頭の「気をつける知見」に、そのタスクで効くものを書いた）

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
>
> - **タスクの分け方:** 設計書の「実装の分割」は 6 つ。押せる条件（`getPromptRunAvailability`）は送信の手順の表の `requiresIdle` を引くため、手順の表を作るタスクの後に置く必要がある。そこで設計書の 3（本文の検査と文言）から押せる条件を外して、手順の表の後の **Task 5（押せる条件と能力）** にし、設計書の 5（配線）を **Task 5** と **Task 6（送信の配線）** に分けた。対応: 設計書 1 → Task 1、2 → Task 2、3 → Task 3（押せる条件を除く）、4 → Task 4、5 → Task 5・6、6 → Task 7。
> - **型を変えるタスクで呼び出し元も直す:** 失敗の種類（`AgentSendFailure` の足し分・`AgentPromptRejection` の `leading-slash`）は文言の表の型に要るため、設計書の 4 ではなく Task 3 で足す。`agentSendFailureMessage(reason, kind)`・`buildAgentSendPreview(raw, cliKind)`・`formatAgentUnsavedNotice(paths, commandName)` の形を変える Task 3 で、呼び出し元の `useAgentPromptSender`・`AgentSendConfirmDialog`（送り先の種類が要るので `AgentSendConfirmPending` に `cliKind` を足し、`useAgentWorkspace` が写す）も直す。`sendAgentPrompt` を移す Task 4 で、`useAgentPromptSender` は手順の表から引く形にする（`claude` の挙動は変わらない）。
> - **`promptSend` を `true` にする時点:** Task 5（押せる条件を足すのと同じタスク）。Task 5 から Task 6 までの間、`copilot` へ送るときに押した時点の中断の流れの守り（`interrupting`）がまだ無い（同じ PR の中の途中の状態。実機では確かめない）。
> - **台帳（計画の時点で確かめた値）:** 計画の作成者が、Task 1 の変換のスクリプト（`to-fixture.js`）と置き換えのスクリプト（`sanitize-copilot.py`）を段階 2b の追加の記録にかけた。45 画面・6 列。変換の後・置き換えの前の SHA-256 は `f6f1fdd8f865c8365eb5a4129f4746f937ee73bb50ee90321230bdab88bb0099`、置き換えた後（`copilotInputScreens.json`）は `b2015f3d08d739570b384bccd5291e79f2aad6a1a47fde81b890300bc71cac6e`、ファイルの大きさはどちらも 203,079 バイト、変わった行は 145 行（どれも入力欄の上の作業ディレクトリの行。画面 38 行・列 107 行）。置き換えた後に UUID・メールアドレス・`/Users/`・`/private/tmp` は無い（UUID は 1 つも無い）。あわせて、設計書の判定の規則を JavaScript に写したもので、45 画面すべての活動と入力欄の期待、6 列の期待、echo の正の例と負の例、段階 2a の台帳の画面の期待（Task 2）が設計書のとおりになることを確かめた。実装で値が違えば、スクリプトの写し間違いを疑う（`diff` で確かめる）。**ハッシュは Task 1 の個人情報のテストを通してから固定する。**
> - **台帳の全角の文字:** 記録の `text` は、全角の文字の右半分のセルを除いて連結してある（`ja6800` の入力欄の行は 49 文字）。段階 2a の `to-fixture.js` は全角の文字があると止めたが、段階 2b では止めず、全角の文字のある行に dim・反転の範囲があるときだけ止める（範囲はセルの位置で、文字の位置とずれるため。記録には無い）。列・行の数はフォルダの名前から決める（`tall-60x12` は 60 × 12。`big-run3` のように大きさの無いフォルダは 100 列で、記録の行の数が 30 であることを確かめる）。
> - **台帳の個人情報のテスト:** 段階 2a のテストの「UUID が 1 つ以上ある」は、新しい台帳に UUID が無いので写さない（ゼロ以外の UUID が無いことだけを確かめる）。
> - **入力欄の読み取りの補助:** 設計書の定数に、記号の行から記号と区切りを除く `SYMBOL_PREFIXES`（`prompt` は `/^❯[ \xa0]?/`、`shell` は `/^! /`、`screen-reader` は `/^Start of Prompt Indicator/`）と、2 行目以降の字下げ `CONTINUATION_INDENT = /^ {2}/` を足す（設計書の「入力欄の行（`rows`）の切り出し」をそのまま書いたもの）。`BORDER`・`SYMBOL_LINE`・`CONTINUATION` は `copilotInputBox.ts` に移して、ファイルの外へは出さない（使うのは `locateCopilotInputBox` だけ）。
> - **echo の確かめの上限の境目:** echo の読み取りは貼り付けから 16ms ごと（16・32・…・1,488・1,504ms）で、1,500ms ちょうどの読み取りは無い。設計書の「1,500ms ちょうどに現れれば送る」は、「貼り付けから 1,500ms の時点で現れれば、上限を過ぎた最初の読み取り（1,504ms）で確かめて送る」としてテストする（読み取りごとに echo を先に見て、上限は後に見る。`claude` の手順と同じ）。送れたことの確かめは 2,000ms ちょうど（16ms × 125）に読み取りがある。
> - **失敗の文言の共通の表の名前:** 設計書の「共通の表」を `AGENT_SEND_FAILURE_COMMON_TEXTS`、活動の理由の表を `AGENT_SEND_BLOCKED_BY_ACTIVITY` とする。今の `AGENT_SEND_FAILURE_MESSAGES` は消し、テストは `agentSendFailureMessage(reason, 'claude')` で引く（`claude` の文言は 1 文字も変えない）。
> - **`useAgentInterrupt` の戻り値:** 設計書の「hook の戻り値の型を分ける」を、`AgentInterruptPanelState` を広げた `AgentInterruptState`（`isInterrupting`・`isInterruptPending` を足したもの）にする。`useAgentWorkspace` はパネルへ `AgentInterruptPanelState` の 4 つの値だけを渡す。
> - **送れたときの知らせの型:** `onSent(sentTo, cliKind)` の型を `AgentSentHandler`（`lib/agentPromptRequest.ts`）として 1 か所に置く。
> - **能力を差し替えるテストの補助:** 段階 2a の `src/renderer/src/__tests__/agentCliCapabilityOverrides.ts` に、プロンプトの送信を偽にする種類 `promptSendUnsupportedKinds` を足す（今の表には送信に対応しない種類が無くなるため。設計書の「`agentPromptSendUnsupportedReason` は…テストは能力の表の `vi.mock` で確かめる」）。
> - **`claude` の手順のテストの偽の送り先:** 送り先の型（`AgentSendTarget`）に `readScreen` が必須で増えるので、`claudePromptSend.test.ts` の偽の送り先に「読んだら投げる」`readScreen` を 1 つ足す（`claude` の手順が `readScreen` を使わないことの確かめにもなる）。設計書の「中身は関数の名前だけを直す」から、この 1 か所と import の行だけが増える。
> - **ROADMAP の行番号:** 設計書の `:515`・`:555`・`:612`〜`:615` は計画の時点でも同じ行。実装の時点でずれていることがあるので、どれも `grep -n` で文を探してから直す。

## Global Constraints

- コメント・文言・ログは日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`。`any` を使わない。テストの補助関数にも戻り値の型を書く（`@typescript-eslint/explicit-function-return-type`）
- **コミット・プッシュはしない**（CLAUDE.md。利用者の明示の指示があるまで行わない）。各タスクの最後の Step は「検証」。`git add`・`git mv` もしない（ファイルの移動は `mv`）
- **実物の `claude`・`copilot` はテストで起動しない。** 入力欄の読み取りは段階 2a・2b で記録した画面の文字（台帳）と手書きの画面で、pty を通す確かめは一時ディレクトリに置いた小さな node のスクリプト（偽の CLI）を実物の node-pty で起動して行う。テストは利用者の `~/.copilot`・`~/.claude` に書かない。新しく `copilot` を起動して記録もしない（L-596）。実機（Electron）の確認は利用者がまとめて行う（Task 7 で実機テスト仕様書に追記する）。プランに実機の手順は書かない
- 各タスクの終わりで次が通る状態を保つ: `npx vitest run`（全テスト）・`npm run typecheck`・変更・作成した TypeScript のファイルへの `npx eslint --max-warnings 0 <ファイル>` と `npx prettier --check <ファイル>`。型を変えるタスクは、型に追随する呼び出し元・テストの補助・既存のテストを同じタスクで直す
- **`npx prettier --write` は、変更したファイルを明示して実行する**（引数が空だとリポジトリ全体を整形してしまう）。`ROADMAP.md`・`src/renderer/src/lib/__tests__/fixtures/agentScreens.json`・`src/renderer/src/lib/__tests__/fixtures/copilotScreens.json`・`src/renderer/src/lib/__tests__/fixtures/copilotInputScreens.json` は prettier にかけない
- **このマシンは負荷が高く、`npx vitest run` の全体でテストが時間切れ（`Test timed out`・`waitFor` の打ち切り）で落ちることがある。** 落ちたら、落ちたファイルを `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書いて先へ進む。単体でも落ちれば本当の失敗として直す
- **シェルで `path` を変数名に使わない**（zsh では `path` が `PATH` と結び付いた配列で、代入すると `PATH` が壊れる）。**zsh では、変数に入れたファイル名の並びが単語に分かれない**（`F="a.ts b.ts"; npx eslint $F` は 1 つのファイル名として渡る）。複数のファイルは直接書くか、`set -- a.ts b.ts` と `"$@"` を使う。**シェルの変数は Bash の呼び出しをまたいで残らない。** コードブロックごとに先頭で設定し直し、`test -f`・`test -d` で存在を確かめる
- **日本語を含むファイルを Python で書き換えるときは、`# -*- coding: utf-8 -*-` 付きのスクリプトのファイルにして実行する**（`python3 -c` に日本語を書かない）。スクリプトのファイルはセッションの作業用の一時ディレクトリ（scratchpad）に置く。`perl -pi` の置き換えは ASCII のパターンだけで行う
- 「変異で確かめる」の Step は、書いた実装の一部を一時的に戻して該当のテストが落ちることを確かめ、必ず元に戻す（戻したことを `git diff` か `grep` で確かめる）。`act(...).then(...)` の形でテストを書かない。`console.*` の spy と `vi.spyOn(window.api, …)` は `afterEach`（か `finally`）で戻す。偽のタイマーを使うテストは `afterEach` で `vi.clearAllTimers()`・`vi.useRealTimers()` を呼ぶ
- 能力・種類の違いは種類をキーにした表（`AGENT_PROMPT_SEND_SPECS`・`AGENT_PROMPT_TEXT_RULES`・`AGENT_SEND_FAILURE_KIND_TEXTS`・`AGENT_CLI_PROFILES`）から引き、入口に `kind === 'copilot'` のような種類の名前との比較を書かない。種類の引数・`isInterrupting`・押せる条件の `activity` と `isInterrupting` は省略できない形にする（省略で `claude` に倒れない。L-060・L-593）
- pty へ書くのは、正規化した本文の括弧付きの貼り付けと `\r` だけ（`copilot` の手順）。`Esc`・`Ctrl+U`・`Ctrl+K`・`Ctrl+C`・`Backspace` は書かない（L-019・L-041）

### 設計書の決めたこと（利用者の確認済み。一字一句）

- **今回の範囲**: 能力の表の `copilot` の `promptSend` を `true` にし、実行（プロンプトの一覧の `実行`）・再実行（履歴の `再実行`）・送信前の確認を `copilot` のタブでも使えるようにする
- **範囲の外**: hooks による変更の区別・セッションの再開・起動の記録は段階 3
- **書きかけ**: `copilot` の入力欄に書きかけがあれば送らない。理由を出し、書きかけは消さない（`copilot` は `Ctrl+U` が行を越えない。`Esc` 2 回で消せるが、空と誤判定すると巻き戻しの画面が開き、利用者の `Esc` と組になる危険もある）
- **先頭の文字**: 先頭が `!` か `/` なら送らない。理由を出す（追加の記録で、括弧付きの貼り付けでも先頭の `!` はシェルの実行に、先頭の `/` はスラッシュコマンドの実行になると分かった）。末尾が `@…` で `Enter` が補完の確定に取られる件は、追加の記録（report.md の 8）をもとに、断らずに末尾に空白を 1 つ足して送る（下の「末尾の `@` の語」）
- **送れたことの確かめ**: `Enter` の後、上限つきで、入力欄が空に戻るか帯が作業中に変わるのを待つ。確かめられなければ失敗として出し、`Enter` は送り直さない（L-001・L-414）。上限の値は記録から決める（下の「送れたことの確かめの上限」）

### 設計書の決めたこと（推奨案で決めた事項。一字一句）

- **送信の手順の表の形**: renderer の `lib/agentPromptSendSpecs.ts`（新規）に `AGENT_PROMPT_SEND_SPECS: Record<AgentCliKind, AgentPromptSendSpec>` を置く。項目は「押せる条件に入力待ちと中断の流れの外を入れるか（`requiresIdle`）」と「送信の手順（`send`）」の 2 つ。`claude` は今の `sendAgentPrompt` を中身を変えずに `lib/claudePromptSend.ts` へ移して `sendClaudePrompt` に改名したもの、`copilot` は `lib/copilotPromptSend.ts`（新規）の `sendCopilotPrompt`。本文の検査（先頭の文字）は shared の `agentPasteText.ts` の種類ごとの表 `AGENT_PROMPT_TEXT_RULES` に置く（送信前の確認のプレビューも同じ表を引くため）。段階 2a の判定の表・中断の送り方の表と同じ流儀（L-593）
- **押せる条件**: `copilot` は「画面の活動が入力待ち（`idle`）で、そのタブが中断の流れの外」のときだけ押せる（作業中の `Enter` は送信待ち〈pending〉になり、作業が終わると勝手に送られる。中断の 2 回目を待つ間に貼り付けると、2 回目の `Esc` が貼った本文を消しうる）。判定は 3 つの入口で同じ関数（`getPromptRunAvailability`）にし、押した時点にも同じ条件を確かめ直す（L-058）。`claude` は今までどおり活動を見ない（`requiresIdle: false`）
- **空と書きかけの見分け方**: 帯を主な手がかりにし、入力欄の中の文字で裏を取る。入力欄の中に文字があれば「書きかけ」。入力欄が 1 行で文字が無く、帯（下の罫線より下の行をつないだ文字列）が空の入力欄の形（`← open … / commands`。40 列の段組みの折り返しでも当たる形）なら「空」。帯が書きかけの形（`@ files · # issues`）なら、文字が見えなくても「書きかけ」（空白だけの書きかけ）。記号が `!` なら「シェルのモード」。それ以外（一時的な帯 `esc again to clear input`・`esc again to rewind`・`ctrl+c again to exit`・`any key close help` など）は「決められない」として保留する。`copilot` の画面に反転のカーソルは無い（端末のカーソルを出し入れしている）ので、`claude` の `isInputBoxEmpty` の規則は使わない
- **保留の上限**: 「決められない」の間は 50ms ごとに読み直し、2,500ms で `input-undetermined`（送らない）。一時的な帯で長さが分かっているものの最長は `ctrl+c again to exit` の約 2,000ms（記録の 6）で、それに 500ms の余裕を足した。`any key close help` は何か押すまで消えないので、上限で失敗になる（キーを送って閉じない）。「空」も描き直しの途中で判定しないよう、50ms の間隔で 2 回続けて確かめる（`claude` の消去の後の確かめと同じ）
- **貼り付け**: 必ず括弧付き（`ESC[200~` + 貼る本文 + `ESC[201~`。`buildAgentPasteBytes`）で 1 回の書き込み。貼る本文は正規化した本文で、末尾の語が `@` で始まるときだけ末尾に空白を 1 つ足したもの（下の「末尾の `@` の語」）。消去のキー（`Ctrl+U`・`Ctrl+K`・`Esc`・`Backspace`）は一切送らない（書きかけは断るので、送る時点の入力欄は空）。bracketed paste が無効なら今までどおり `not-accepting`（`copilot` は起動直後から有効なので、合図としては弱い。入力欄の特定と入力待ちの確かめが主な守り）
- **echo の確かめ**: 入力欄の 1 行目が畳みの形（`[Paste #N - M lines]`・`[Saved pasted content to workspace (…)`）なら現れたとする。そうでなければ、入力欄の空でない最後の行が本文のどれかの行に含まれれば現れたとする。1 行目ではなく最後の行で見るのは、入力欄の高さに上限があり（30 行の画面で 13 行、12 行の画面で 4 行）、超えると先頭が見えなくなり `❯` が見えている最初の行に付くため（記録の 7）。最後の行は貼り付けの後のカーソルの行なので常に見える。`copilot` は文字の単位で折り返すので、見えている行は本文の行の部分の文字列になる。16ms ごと・上限 1,500ms（記録の echo は約 210〜300ms で大きさにほぼよらず、200,000 字でも 295ms。アプリの xterm と IPC の遅れを見て約 5 倍にした）。比べる前に入力欄の行と本文の行の前後の空白を除くので、末尾の `@` の語の後ろに足した空白で結果は変わらない
- **Enter**: echo を確かめてから、括弧とは別の書き込みで `\r` を 1 回だけ送る。括弧と同じ書き込みでも送信になる（記録の 3。20KB を超えても全文が届く）が、それでは送る前に本文が入力欄に入ったかを確かめられない（間に確認の画面が出ていれば、`\r` が選択肢を確定させる）。echo を確かめた後の `Enter` でも全文が 1 回の要求で届いた（記録の 3。0〜300ms の間隔）ので、別の書き込みにしても本文は欠けない
- **送れたことの確かめの上限**: `Enter` の後、16ms ごとに読み、帯が作業中（段階 2a の判定で `working`）になるか、入力欄が「空」（上の見分け方。帯が空の入力欄の形に戻ったことも含む）になれば送れたとする。上限は 2,000ms。記録では入力欄が空になるのと帯が作業中になるのはほぼ同時で、`Enter` から 11〜91ms（即答では作業中は約 36ms しか見えず 99ms で入力待ちに戻るが、そのときは入力欄が空なので拾える。記録の 4）。最も遅い 91ms の 20 倍の余裕を取った。上限で確かめられなければ `not-confirmed` を出し、`Enter` は送り直さない
- **末尾の `@` の語**: 断らない。`copilot` の手順で、正規化した本文の末尾の空白（改行を含む）を除いた最後の語が `@` で始まるとき（`/(?:^|\s)@\S*$/`）は、貼る本文を「末尾の空白を除いた本文 + 空白 1 つ」にして送る（`buildCopilotPasteText`）。根拠は追加の記録（report.md の 8）: 末尾に空白を 1 つ足すと補完の一覧が開かず、`Enter` 1 回で送られ、末尾の空白は落ち、`<tagged_files>` も付いた（場面 2・補足 8）。末尾に改行を足しても改行は入力欄に残らず一覧が開く（場面 3）。一覧が開いている間の `Esc` は一覧を閉じず、2 回目が来ると書きかけを消す危険だけがある（場面 6）。そのため改行・`Esc` は使わない。足しなければ `Enter` は候補の確定に取られ、本文が別のファイル名に書き換わりうる（`suffix-100x30` の `at-enter+3000`）。末尾の空白（改行を含む）は `copilot` が入力欄に残さない・送るときに落とすので、届く本文は利用者の本文と同じになる。アプリの参照の添付（`本文\n\n参照:\n- @パス`）もこれで送れる。送信前の確認の本文・履歴の本文は利用者の本文のまま（足すのは貼るバイト列だけ）。一覧が開くのは入力欄の最後の語だけで、行の途中の `@パス` は開かない（report.md の 8）
- **先頭の文字の見方**: `copilot` は先頭の空白を除いた最初の文字が `!`・`/` なら断る（`claude` は今までどおり 1 文字目の `!` だけ）。先頭の空白の後の `!`・`/` を貼ったときの扱いは記録していないので、送る側に倒さない。行の途中の `!`・`/` は普通の文字として送られた（`x!echo hi`・`run /help`）ので、文言では「先頭に別の文字を足すと送れます」と案内する（空白を入れる案内は `copilot` ではしない）
- **失敗の扱い**: どの段でも確かめられなければ、その場で止めて先へ進まない。`Enter` の前の失敗では `Enter` を送らず、`Enter` の後の失敗でも送り直さない。送れたとき（`sent`）だけ通知・`onSent`（添えた参照を外す）・確認からの送信のタブへの移動を行う（今の流れのまま。L-001）
- **文言**: 失敗の種類を足し、CLI で文が違う失敗（先頭の `!`・本文が入力欄に入らなかった）は種類ごとの表 `AGENT_SEND_FAILURE_KIND_TEXTS: Record<AgentCliKind, …>` で引く。ほかは CLI に依らない文で、CLI の名前は `AGENT_CLI_PROFILES[kind].commandName` から作る。`claude` の文言は 1 文字も変えない。押せない理由と送った後の失敗は、同じ原因なら同じ文言にする（「文言」）
- **renderer から pty へ届く文字**: 新しい IPC は足さない。送信は利用者のプロンプトを送る機能で、今の `claude` と同じ `controller.writeToSession` → `agentTerminal:write` の経路（利用者のキー入力と同じ）を使う。書くのは「正規化（`ESC`・C0・C1 の除去）した本文の括弧付きの貼り付け」と「`\r`」の 2 回だけで、手順の外から文字列を足せない形にし、テストで書いた列の完全一致を確かめる（L-019・L-083）
- **Esc を送らない**: 送信の手順は `Esc` を一切送らない（消去にも使わない）。作業中でないときに `Esc` を送らない（L-041）を、手順の形で守る
- **中断との排他**: 送信中は帯の `中断` を押せない（今の作り）。逆に、そのタブが中断の流れの間（1 回目を送ってから 2 回目の流れが終わり、1,000ms の待ちが明けるまで）は `copilot` へ送らない（`interrupting`）。描画は `useAgentInterrupt` の待ちの state（`isPending`）、押した時点はその ref 版 `isInterrupting(slotId) = isInFlight(slotId) || isCoolingDown(slotId)` で見る（`isCoolingDown` だけでは、1 回目の結果や 2 回目の流れが 1,000ms を超えたときに流れの途中で偽になる）（段階 2a の「新しい状態と既存の入口」で 2b に回した守り）
- **送信前の確認のプレビュー**: ダイアログの送れない理由（本文の理由）を、確認を開いた時点に控えた送り先の種類の規則で出す（`buildAgentSendPreview(raw, cliKind)`）。`copilot` の送り先では `/help` も開いた時点で `送信` が押せない
- **画面の台帳**: 段階 2a の `copilotScreens.json` は変えず、別の台帳 `copilotInputScreens.json`（新規）を足す。記録の道具と回が違い（`copilot-input-recorder`）、段階 2a の台帳のハッシュと「全画面が判定の期待に入る」テストをそのまま保てるため。新しい台帳は追加の記録の 45 画面（末尾の参照の `atref1`〜`atref8` の 15 画面を含む）と 6 つの列で、どの画面も活動の期待と入力欄の期待の両方を持つ。記録に無い形だけを手書きの画面で確かめる（「実装の最初に確かめること」）
- **履歴への記録**: 記録の仕方は変えない（段階 3）。今の作りでは送り先の会話の ID（`claudeSessionId`）が無いタブの送信は履歴に記録しないので、`copilot` へ送ったプロンプトは実行履歴に残らない。既知の制約に書く。ただし `recordAgentSent` は送り先が `null` のとき毎回 `console.error` を出すので、送り先の種類が会話の ID を持たない（能力の表の `sessionResume` が `false`。`copilot`）ときは黙って記録を省き、`claude`（`sessionResume` が `true`）で `null` のときだけ今の `console.error` を出す。種類は送れたときの結果（`AgentPromptSendResult` の `sent`）に `cliKind` として載せ、`onSent(sentTo, cliKind)` で渡す

### copilot の入力欄の読み取りの規則（一字一句。設計書「入力欄の特定と読み取り」）

規則の定数（このファイルに閉じる。`claude` の `agentInputBox.ts` の定数とは共有しない）:

```ts
/**
 * 帯: 空の入力欄(`← open sidebar · / commands · ? help · tab next tab`。右にモデル名)。帯をつないだ文字列(band)にかける。60 列では
 * 2 行に折り返し、40 列では段組みで `← open     · / commands · ? help · tab` / `sidebar       next tab` に折り返す(段階 2a の台帳の idle40)ので、
 * `sidebar` の位置に依らない形にする
 */
const EMPTY_BAND = /^← open\b.*\/ commands\b/
/** 帯: 書きかけ(`@ files · # issues`)。帯をつないだ文字列(band)にかける */
const DRAFT_BAND = /^@ files · # issues/
/** 入力欄の 1 行目の畳みの形(11 行以上・20,480 バイト超) */
const FOLDED_PASTE = /^\[Paste #\d+ - \d+ lines\]/
const SAVED_PASTE = /^\[Saved pasted content to workspace \(/
```

入力欄の行（`rows`）の切り出し: 記号の行は `prompt` なら行頭の `❯` と続く空白 1 つ（U+00A0 を含む）、`shell` なら `! `、`screen-reader` なら `Start of Prompt Indicator` を除く。2 行目以降は行頭の 2 桁の空白を除く。

`readCopilotInputState(lines)`（上から順に、最初に当てはまったもの。例外は投げない）:

| 順  | 条件                                                  | 結果           | 根拠                                                                                          |
| --- | ----------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| 1   | 入力欄が無い                                          | `not-found`    | 確認・選択の画面・描き直しの途中                                                              |
| 2   | 記号が `shell`                                        | `shell`        | シェルのモード（空は `! Execute shell command`、書きかけは `! echo hi`。記録の 5）            |
| 3   | 入力欄のどれかの行に空白でない文字がある              | `draft`        | 書きかけ（複数行・畳み・`/` の一覧の候補 `/add-dir` を含む）。一時的な帯の間でも文字は見える  |
| 4   | 帯（`band`。つないだ文字列）が `DRAFT_BAND` に当たる  | `draft`        | 空白だけの書きかけ・改行だけの書きかけ（`❯` と帯 `@ files · # issues`。記録の 5）             |
| 5   | 入力欄が 1 行で、帯（`band`）が `EMPTY_BAND` に当たる | `empty`        | 空の入力欄（記録の 5。送った後・中断の後の入力欄も同じ）                                      |
| 6   | それ以外                                              | `undetermined` | 一時的な帯（記録の 6）・帯が空・入力欄が 2 行以上で文字が無いのに帯が書きかけの形でない、など |

`isCopilotPasteEchoed(lines, text)`: 入力欄が無い・記号が `shell` なら偽。入力欄の 1 行目が `FOLDED_PASTE`・`SAVED_PASTE` に当たれば真。そうでなければ、入力欄の空でない最後の行（前後の空白を除き、連続する空白を 1 つにしたもの）が空でなく、本文（`text` は実際に貼った本文。末尾の `@` の語の後ろに足した空白を含む）を `\n` で分けたどれかの行（タブを空白にし、連続する空白を 1 つにし、前後の空白を除いたもの）に含まれれば真。
入力欄の行も本文の行も前後の空白を除いてから比べるので、足した空白（画面の行の末尾の空白は `copilotScreenTexts` が除く）で結果は変わらない。足した空白で本文が 20,480 バイトを 1 バイト超えると保存の形になるが、その形も現れたとみなす

### copilot の手順の値（一字一句。設計書「手順」）

```ts
export const COPILOT_INPUT_STATE_POLL_MS = 50
export const COPILOT_INPUT_STATE_TIMEOUT_MS = 2_500
export const COPILOT_ECHO_POLL_MS = 16
export const COPILOT_ECHO_TIMEOUT_MS = 1_500
export const COPILOT_SUBMIT_CONFIRM_POLL_MS = 16
export const COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS = 2_000

/** 貼る本文。末尾の空白(改行を含む)を除いた最後の語が @ で始まれば、末尾の空白を除いて空白を 1 つ足す(補完の一覧を開かせない。report.md の 8) */
export function buildCopilotPasteText(text: string): string

export async function sendCopilotPrompt(
  target: AgentSendTarget,
  rawText: string,
  clock: AgentSendClock = realClock
): Promise<AgentSendOutcome>
```

1. **正規化**: `normalizeAgentPrompt(rawText, 'copilot')`。拒否なら `failed`（何も書かない）
2. **bracketed paste**: 無効なら `not-accepting`（何も書かない）
3. **入力待ちと空の確かめ**（上限 `COPILOT_INPUT_STATE_TIMEOUT_MS`）: 次を繰り返す
   1. `lines = target.readScreen()`。`classifyCopilotScreen(lines)` が `idle` でなければ、活動に応じて `screen-working`・`screen-permission`・`screen-confirm`・`screen-unknown` で止める（1 回目の読み取りが押した時点の確かめ。保留の間に作業中・確認の画面へ変わっても止める）
   2. `readCopilotInputState(lines)` が `shell` なら `shell-mode`、`draft` なら `draft-present` で止める（どちらも何も書かない）。`not-found` なら `input-not-found` で止めるが、これは到達しない守り（3.1 で `idle` と判定された画面には入力欄があるので、3.1 の後に `not-found` は起きない。型の網羅のために残す）
   3. `empty` なら続けて空だった回数を足し、2 回になったら手順 4（貼り付け）へ進む。空が 1 回だけのときは 3.4 へ。`undetermined` なら回数を 0 に戻して 3.4 へ
   4. 上限に達していれば（`clock.now()` が上限の時刻以上。`claude` の手順と同じ比べ方。5・7 の上限も同じ）`input-undetermined` で止める（何も書かない）。達していなければ `COPILOT_INPUT_STATE_POLL_MS` 待って 3.1 へ
4. **貼り付け**: `pasteText = buildCopilotPasteText(text)`（末尾の空白〈改行を含む〉を除いた最後の語が `@` で始まれば `text.trimEnd() + ' '`、それ以外は `text` のまま）を `target.write(buildAgentPasteBytes(pasteText))`（1 回の書き込み）。5 の echo の確かめは `pasteText` で行う
5. **echo の確かめ**（上限 `COPILOT_ECHO_TIMEOUT_MS`）: `COPILOT_ECHO_POLL_MS` 待ってから読み、`isCopilotPasteEchoed(lines, pasteText)` が真なら 6 へ。記号が `shell` に変わった・上限を過ぎたら `not-echoed`（`Enter` を送らない。本文は入力欄に残りうるので、文言で案内する）
6. **Enter**: `target.write(AGENT_SUBMIT_KEY)`（`\r`。貼り付けとは別の書き込み）
7. **送れたことの確かめ**（上限 `COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS`）: `COPILOT_SUBMIT_CONFIRM_POLL_MS` 待ってから読み、`classifyCopilotScreen(lines) === 'working'` か `readCopilotInputState(lines) === 'empty'` なら `{ kind: 'sent', clearedDraft: false }`。上限を過ぎたら `not-confirmed`（`Enter` を送り直さない）

- 書くのは 4 の貼り付けと 6 の `\r` だけ。`Esc`・`Ctrl+U`・`Ctrl+K`・`Ctrl+C`・`Backspace` は書かない（L-041）
- 時計は注入する（`AgentSendClock`。テストは偽の時計で進める）。外部の待ちは無い
- `clearedDraft` は常に `false`（書きかけを消さないので、`AGENT_SENT_AFTER_CLEAR_NOTICE` は出ない）

### 失敗の種類（一字一句。設計書「失敗の一覧」）

`AgentSendFailure`（`agentPromptSend.ts`）に足す種類:

| 種類                 | 起きる段 | 書いたもの     | 意味                                                                 |
| -------------------- | -------- | -------------- | -------------------------------------------------------------------- |
| `leading-slash`      | 1        | なし           | 先頭（空白を除く）が `/`（`AgentPromptRejection` に足す）            |
| `interrupting`       | 呼び出し | なし           | そのタブが中断の流れの間（`useAgentPromptSender.send` の先頭で断る） |
| `screen-working`     | 3        | なし           | 作業中                                                               |
| `screen-permission`  | 3        | なし           | 許可待ち                                                             |
| `screen-confirm`     | 3        | なし           | 確認待ち                                                             |
| `screen-unknown`     | 3        | なし           | 判定できない                                                         |
| `shell-mode`         | 3        | なし           | シェルのモード                                                       |
| `draft-present`      | 3        | なし           | 書きかけがある（消していない）                                       |
| `input-undetermined` | 3        | なし           | 上限まで空か書きかけかを決められなかった                             |
| `not-confirmed`      | 7        | 貼り付け・`\r` | `Enter` の後に送れたことを確かめられなかった（送り直していない）     |

今ある種類のうち `copilot` の手順が返すのは `empty`・`too-long`・`leading-bang`・`not-accepting`・`not-echoed`（`clear-failed` は返さない。`input-not-found` は手順 3.2 の到達しない守りとしてだけ残し、入力欄が無い画面は 3.1 の `screen-*` になる）。
`screen-*` の 4 つは型の上で `` `screen-${Exclude<AgentActivity, 'idle'>}` `` から作り、活動を足したときの決め忘れを型エラーにする。

### 本文の検査（一字一句。設計書「本文の検査」）

```ts
export type AgentPromptRejection = 'empty' | 'too-long' | 'leading-bang' | 'leading-slash'

/** 正規化の後の本文を CLI ごとに断る規則(空・長すぎるの後にかける)。送信の手順の表は renderer の agentPromptSendSpecs.ts */
type AgentPromptTextRule = (text: string) => AgentPromptRejection | null

export const AGENT_PROMPT_TEXT_RULES: Record<AgentCliKind, AgentPromptTextRule> = {
  // 「!」で始まる本文は claude のシェルのモードに入る(確認の結果 23。今までどおり 1 文字目だけを見る)
  claude: (text) => (text.startsWith('!') ? 'leading-bang' : null),
  // copilot 1.0.87: 先頭の ! はシェルの実行、先頭の / はスラッシュコマンドの実行、(段階 2b の追加の記録)。先頭の空白の後は記録していないので、
  // 空白を除いた最初の文字で見る。末尾の @ の語は断らず、copilotPromptSend.ts の buildCopilotPasteText が空白を足す
  copilot: (text) => {
    const head = text.trimStart()
    if (head.startsWith('!')) return 'leading-bang'
    if (head.startsWith('/')) return 'leading-slash'
    return null
  }
}

export function normalizeAgentPrompt(raw: string, kind: AgentCliKind): NormalizedAgentPrompt
```

- 判定の順は「正規化（改行の統一・制御文字の除去）→ 空 → 200,000 字超 → 種類の規則」（L-083。除去の後に先頭へ来る `!` を見逃さない）。`claude` の結果は今と同じ
- 種類は省略できない（L-060）。`claude` の手順（`sendClaudePrompt`）は `'claude'` を渡す
- `fix #12`・`?why`・`say hi!`・`look at @file`・`本文\n\n参照:\n- @src/app.ts` は断らない（末尾の `@` の語は手順で空白を足して送る）

### 文言（一字一句。実機テスト仕様書もこの文字列で書く。設計書「文言」）

`lib/agentSendMessages.ts`。`claude` の文言は 1 文字も変えない。`{cmd}` は `AGENT_CLI_PROFILES[kind].commandName`（`copilot`）。

### CLI で文が違う失敗（`AGENT_SEND_FAILURE_KIND_TEXTS`）

```ts
interface AgentSendFailureKindTexts {
  /** 先頭が「!」(leading-bang) */
  leadingBang: (commandName: string) => string
  /** 本文が入力欄に入ったかを確かめられなかった(not-echoed) */
  notEchoed: (commandName: string) => string
}

export const AGENT_SEND_FAILURE_KIND_TEXTS: Record<AgentCliKind, AgentSendFailureKindTexts>
```

| 種類           | `claude`（今と同じ）                                                                                                          | `copilot`                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leading-bang` | `先頭が「!」のプロンプトは、エージェントのシェルのコマンドとして実行されるため送信できません（先頭に空白を入れると送れます）` | `先頭（空白を除く）が「!」のプロンプトは、copilot のシェルのコマンドとして実行されるため送信できません（先頭に「!」以外の文字を足すと送れます）`                           |
| `not-echoed`   | `エージェントの入力欄に入りませんでした。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください`                | `copilot の入力欄に本文が入ったか確かめられなかったため、Enter を送りませんでした。ターミナルの画面を確かめてください（入力欄に本文が入っていれば、送るか消してください）` |

### CLI に依らない失敗の文言（足すもの）

| 種類                 | 文言                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `leading-slash`      | `先頭（空白を除く）が「/」のプロンプトは、{cmd} のスラッシュコマンドとして実行されるため送信できません（先頭に「/」以外の文字を足すと送れます）` |
| `interrupting`       | `中断を送ったばかりのため送信できません（1 秒ほど待ってから、もう一度実行してください）`（押せない理由の `RUN_DISABLED_INTERRUPTING` と同じ）    |
| `screen-working`     | `{cmd} が作業中のため送信できません（作業が終わって入力待ちになってから、もう一度実行してください）`                                             |
| `screen-permission`  | `{cmd} が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）`                                                       |
| `screen-confirm`     | `{cmd} が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）`                                                       |
| `screen-unknown`     | `{cmd} が入力待ちか判定できないため送信できません（ターミナルの画面を確かめてから、もう一度実行してください）`                                   |
| `shell-mode`         | `{cmd} がシェルのモードのため送信できません（ターミナルでシェルのモードを抜けてから、もう一度実行してください）`                                 |
| `draft-present`      | `{cmd} の入力欄に書きかけがあるため送信できません（書きかけは消していません。ターミナルで送るか消してから、もう一度実行してください）`           |
| `input-undetermined` | `{cmd} の入力欄が空か確かめられなかったため送信できません（ターミナルの画面を確かめてから、もう一度実行してください）`                           |
| `not-confirmed`      | `{cmd} に送れたか確かめられませんでした。ターミナルの画面を確かめてください（入力欄に本文が残っていれば、送るか消してください）`                 |

- 押せない理由の活動の文言は `agentSendBlockedByActivityReason(activity: Exclude<AgentActivity, 'idle'>, commandName)` が作り、`screen-*` の失敗の文言も同じ関数で作る（押せない理由と送った後の失敗が同じ原因なら同じ文。L-058）
- 関数の形: `agentSendFailureMessage(reason, kind)`（今の `(reason, commandName)` を種類を受け取る形にする。`unsupported-cli` は今の `agentPromptSendUnsupportedReason`、`leading-bang`・`not-echoed` は種類の表、ほかは共通の表）。共通の表は `Record<Exclude<AgentSendFailure, 'unsupported-cli' | 'leading-bang' | 'not-echoed'>, (commandName: string) => string>` にし、種類を足したときの決め忘れを型エラーにする
- 文言には次の行動（ターミナルで答える・抜ける・消す・待つ）を入れる（L-597）。書きかけを消していないこと・`Enter` を送っていないこと・送り直していないことを、利用者が誤解しないように書く
- 送信前の確認のダイアログの未保存の注意 `formatAgentUnsavedNotice(paths, commandName)`（`agentReferenceMessages.ts`）: `未保存の変更があるファイルは、保存するまで {cmd} に見えません: …`。`claude` は今と同じ文になる
- 設定の画面の使えない機能の注記は能力の表から作るので、`copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別、前回の続きから・このセッションで再開` になる（コードは変えない）
- `agentPromptSendUnsupportedReason` は、能力が `false` の種類のために残す（今は該当する種類が無い。テストは能力の表の `vi.mock` で確かめる。段階 2a と同じ）

### 押せる条件（一字一句。設計書「押せる条件」）

入力に `activity: AgentActivity`（送り先のタブの活動。`activities.get(slotId) ?? 'unknown'`。中断の判定と同じ写像）と `isInterrupting: boolean`（送り先のタブが中断の流れの間。`useAgentInterrupt` の `isInterruptPending(slotId)`）を足す。表の順:

1. 方式の読み込み中 → 従来の方式 → CLI が送信に対応していない → 閉じる途中 → セッションが動いていない → 送信中（今のまま）
2. 送り先の種類の `requiresIdle` が真なら、中断の流れの間 → `RUN_DISABLED_INTERRUPTING`
3. 送り先の種類の `requiresIdle` が真なら、活動が `idle` でない → `agentSendBlockedByActivityReason(activity, commandName)`

`claude` は 2・3 を通らないので、今までと同じ結果になる（テストで固定）。3 つの入口の入力:

| 入口                      | 種類                                             | 活動・中断の流れ                   |
| ------------------------- | ------------------------------------------------ | ---------------------------------- |
| プロンプトの一覧の `実行` | `agentCapabilityCliKindOf`（今のまま）           | 選択中のタブ                       |
| 履歴の `再実行`           | 同じ                                             | 選択中のタブ                       |
| 送信前の確認の `送信`     | 確認を開いた時点に控えた送り先の種類（今のまま） | 控えた送り先のタブ（`pendingTab`） |

押した時点の確かめ（L-058）: 中断の流れは `send` の先頭（上の 1）、活動は `copilot` の手順の最初の読み取り（下の手順 3）で、描画と同じ条件を確かめ直す。

### 型・関数の名前（後のタスクはこの名前と型で使う）

- テストの台帳（Task 1）: `CopilotInputScreenName`・`CopilotInputSequenceName`・`CopilotInputFrame = { dt: number; lines: ViewportLine[] }`・`copilotInputScreen(name: CopilotInputScreenName): RecordedScreen`・`copilotInputSequence(name: CopilotInputSequenceName): CopilotInputFrame[]`・`screenFromTexts(texts: readonly string[]): ViewportLine[]`（`src/renderer/src/lib/__tests__/fixtures/copilotInputScreens.ts`）
- 入力欄の読み取り（Task 2。`src/renderer/src/lib/copilotInputBox.ts`）: `CopilotInputSymbol = 'prompt' | 'shell' | 'screen-reader'`・`CopilotInputBox = { top: number; bottom: number; symbol: CopilotInputSymbol; rows: string[]; band: string; bandHead: string | null }`・`copilotScreenTexts(lines: readonly ViewportLine[]): string[]`・`locateCopilotInputBox(texts: readonly string[]): CopilotInputBox | null`・`CopilotInputState = 'empty' | 'draft' | 'shell' | 'undetermined' | 'not-found'`・`readCopilotInputState(lines: readonly ViewportLine[]): CopilotInputState`・`isCopilotPasteEchoed(lines: readonly ViewportLine[], text: string): boolean`
- 本文の検査と文言（Task 3）: `AgentPromptRejection = 'empty' | 'too-long' | 'leading-bang' | 'leading-slash'`・`AGENT_PROMPT_TEXT_RULES: Record<AgentCliKind, AgentPromptTextRule>`・`normalizeAgentPrompt(raw: string, kind: AgentCliKind): NormalizedAgentPrompt`（`src/shared/agentPasteText.ts`）、``AgentSendScreenFailure = `screen-${Exclude<AgentActivity, 'idle'>}` ``・`AgentSendFailure`（足す種類は「失敗の種類」の表）（`src/renderer/src/lib/agentPromptSend.ts`）、`AGENT_SEND_BLOCKED_BY_ACTIVITY`・`agentSendBlockedByActivityReason(activity: Exclude<AgentActivity, 'idle'>, commandName: string): string`・`RUN_DISABLED_INTERRUPTING`・`AGENT_SEND_FAILURE_COMMON_TEXTS`・`AgentSendFailureKindTexts`・`AGENT_SEND_FAILURE_KIND_TEXTS`・`agentSendFailureMessage(reason: AgentSendFailure, kind: AgentCliKind): string`（`src/renderer/src/lib/agentSendMessages.ts`）、`buildAgentSendPreview(raw: string, cliKind: AgentCliKind): AgentSendPreview`（`agentSendPreview.ts`）、`formatAgentUnsavedNotice(paths: readonly string[], commandName: string): string`（`agentReferenceMessages.ts`）、`AgentSendConfirmPending.cliKind: AgentCliKind`（`src/renderer/src/types.ts`）
- 送信の手順（Task 4）: `AgentSendTarget.readScreen(): ViewportLine[]`（`agentPromptSend.ts`）、`sendClaudePrompt(target: AgentSendTarget, rawText: string, clock?: AgentSendClock): Promise<AgentSendOutcome>` と `AGENT_CLEAR_INTERVAL_MS`・`AGENT_CLEAR_TIMEOUT_MS`・`AGENT_EMPTY_CONFIRM_INTERVAL_MS`・`AGENT_ECHO_POLL_MS`・`AGENT_ECHO_TIMEOUT_MS`（`claudePromptSend.ts`。`agentPromptSend.ts` から移す）、`COPILOT_INPUT_STATE_POLL_MS`・`COPILOT_INPUT_STATE_TIMEOUT_MS`・`COPILOT_ECHO_POLL_MS`・`COPILOT_ECHO_TIMEOUT_MS`・`COPILOT_SUBMIT_CONFIRM_POLL_MS`・`COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS`・`buildCopilotPasteText(text: string): string`・`sendCopilotPrompt(target: AgentSendTarget, rawText: string, clock?: AgentSendClock): Promise<AgentSendOutcome>`（`copilotPromptSend.ts`）、`AgentPromptSendSpec = { requiresIdle: boolean; send: (target, rawText, clock) => Promise<AgentSendOutcome> }`・`AGENT_PROMPT_SEND_SPECS: Record<AgentCliKind, AgentPromptSendSpec>`（`agentPromptSendSpecs.ts`）
- 押せる条件と能力（Task 5）: `getPromptRunAvailability` と `getHistoryRerunAvailability` の引数に `activity: AgentActivity`・`isInterrupting: boolean`、`PromptRunStateInput.activity`・`PromptRunStateInput.isInterrupting`、`AgentInterruptState extends AgentInterruptPanelState { isInterrupting(slotId: string): boolean; isInterruptPending(slotId: string): boolean }`（`useAgentInterrupt` の戻り値）、テストの補助 `AgentCliCapabilityOverrides.promptSendUnsupportedKinds: Set<AgentCliKind>`
- 送信の配線（Task 6）: `UseAgentPromptSenderOptions.isInterrupting: (slotId: string) => boolean`（省略できない）、`AgentPromptSendResult` の `sent` に `cliKind: AgentCliKind`、`AgentSentHandler = (sentTo: AgentHistoryInfo | null, cliKind: AgentCliKind) => void`・`AgentSendOptions.onSent?: AgentSentHandler`（`agentPromptRequest.ts`）、`notifyAgentSent(outcome, onSent?: AgentSentHandler)`

### ファイルの構成（作る・変えるもの）

| ファイル                                                                                                                                                                                                                                                                | 責務                                                                    | タスク |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| `.superpowers/agent-cli-kind/copilot-input-recorder/to-fixture.js`・`sanitize-copilot.py`（git 管理外）                                                                                                                                                                 | 段階 2b の追加の記録から台帳を作る・個人情報の置き換え                  | 1      |
| `src/renderer/src/lib/__tests__/fixtures/copilotInputScreens.json`（新規）・`copilotInputScreens.ts`（新規）・`README.md`・`.prettierignore`                                                                                                                            | `copilot` の入力欄の台帳と読み出し                                      | 1      |
| `src/renderer/src/lib/__tests__/copilotInputScreensFixture.test.ts`（新規）                                                                                                                                                                                             | 台帳の SHA-256・個人情報・読み出し                                      | 1      |
| `src/renderer/src/lib/copilotInputBox.ts`（新規）・`copilotScreenActivity.ts`                                                                                                                                                                                           | 入力欄の特定（移動）・記号・行・入力欄の状態・echo                      | 2      |
| `src/renderer/src/lib/__tests__/copilotInputBox.test.ts`（新規）                                                                                                                                                                                                        | 台帳の期待・列・echo・手書きの画面                                      | 2      |
| `src/shared/agentPasteText.ts`・`src/renderer/src/lib/agentPromptSend.ts`（失敗の種類）・`agentSendMessages.ts`・`agentSendPreview.ts`・`agentReferenceMessages.ts`・`src/renderer/src/types.ts`・`components/agent/AgentSendConfirmDialog.tsx`                         | 本文の検査・失敗の文言・プレビュー・未保存の注意                        | 3      |
| `src/renderer/src/lib/claudePromptSend.ts`（新規。移動）・`copilotPromptSend.ts`（新規）・`agentPromptSendSpecs.ts`（新規）・`agentPromptSend.ts`（共有の型だけ）・`hooks/useAgentPromptSender.ts`（表から引く）                                                        | 送信の手順の表と CLI ごとの手順                                         | 4      |
| `src/renderer/src/lib/__tests__/claudePromptSend.test.ts`（`agentPromptSend.test.ts` から改名）・`copilotPromptSend.test.ts`・`agentPromptSendSpecs.test.ts`・`copilotPromptSend.integration.test.ts`（新規）                                                           | 手順のテスト・統合テスト                                                | 4      |
| `src/shared/agentCliKinds.ts`・`src/renderer/src/lib/agentSendMessages.ts`（押せる条件）・`promptRunState.ts`・`agentInterrupt.ts`（コメント）・`hooks/useAgentInterrupt.ts`・`hooks/useAgentWorkspace.ts`・`src/renderer/src/__tests__/agentCliCapabilityOverrides.ts` | `promptSend`・押せる条件の活動と中断の流れ・中断の流れの値              | 5      |
| `src/renderer/src/hooks/useAgentPromptSender.ts`・`useAgentWorkspace.ts`・`usePromptRunner.ts`・`lib/agentPromptSend.ts`（結果の種類）・`lib/agentSendCallbacks.ts`・`lib/agentPromptRequest.ts`                                                                        | 中断の流れの守り・`isInterrupting` の配線・送れたときの種類と履歴の記録 | 6      |
| `ROADMAP.md`・`docs/manual-test-spec.md`・（食い違いがあれば）設計書                                                                                                                                                                                                    | 段階 2b の記録・実機テスト仕様書                                        | 7      |

---

### Task 1: copilot の入力欄の台帳

> **設計書の読む節:** 「copilot の入力欄（記録の要点）」、「実装の最初に確かめること（copilot の入力欄の台帳）」の 1〜3（4 の画面と期待の表は Task 2 で使う）、「構成」の台帳の行。あわせて `src/renderer/src/lib/__tests__/fixtures/README.md`（`copilotScreens.json` の節）と `.superpowers/agent-cli-kind/copilot-input-recorder/report.md`。
>
> **気をつける知見:** L-017（記録のユーザー名・一時ディレクトリ・UUID を同じ長さの中立な文字列に置き換え、個人情報のテストを通してから SHA-256 を固定する）・L-059（規則を実物の `copilot` で記録した画面と列で固定する）・L-596（台帳は利用者の環境から切り離した追加の記録から写し、新しく `copilot` を起動して記録しない）

**Files:**

- Create（git 管理外）: `.superpowers/agent-cli-kind/copilot-input-recorder/to-fixture.js`・`.superpowers/agent-cli-kind/copilot-input-recorder/sanitize-copilot.py`・`.superpowers/agent-cli-kind/copilot-input-recorder/copilotInputScreens.raw.json`（変換の後・置き換えの前）
- Create: `src/renderer/src/lib/__tests__/fixtures/copilotInputScreens.json`（スクリプトが書く。手で書かない・整形しない）・`src/renderer/src/lib/__tests__/fixtures/copilotInputScreens.ts`
- Modify: `src/renderer/src/lib/__tests__/fixtures/README.md`（`copilotInputScreens.json` の節を足す）・`.prettierignore`
- Test: `src/renderer/src/lib/__tests__/copilotInputScreensFixture.test.ts`（新規）

**Interfaces:**

- Consumes: `makeLine(text: string, dim?: number[][], inverse?: number[][]): ViewportLine`・`toRecordedScreen(screen: RawScreen): RecordedScreen`・`RawScreen`・`RecordedScreen`（`fixtures/agentScreens.ts`。既存）、`lineText(line: ViewportLine): string`（`lib/agentViewport.ts`。既存）
- Produces（Task 2・4・6 が使う）:

```ts
// src/renderer/src/lib/__tests__/fixtures/copilotInputScreens.ts
export type CopilotInputScreenName = keyof typeof data.screens
export type CopilotInputSequenceName = keyof typeof data.sequences
export interface CopilotInputFrame {
  /** 書き込み(Enter・Esc・Ctrl+C)からの ms */
  dt: number
  lines: ViewportLine[]
}
export function copilotInputScreen(name: CopilotInputScreenName): RecordedScreen
export function copilotInputSequence(name: CopilotInputSequenceName): CopilotInputFrame[]
export function screenFromTexts(texts: readonly string[]): ViewportLine[]
```

台帳の画面の名前（45）: `empty`・`spacesTyped`・`spacesPasted`・`spacesEsc1`・`newlinesPasted`・`multiPasted`・`shellEmpty`・`shellDraft`・`shellSpaces`・`afterTurnEmpty`・`afterTurn1char`・`fold10`・`fold11`・`long5000`・`send11`・`inline20480`・`saved20481`・`ja6800`・`huge`・`tallIdle`・`tallPaste9`・`tallPaste30`・`tallPaste5000`・`tallSent`・`atPaste`・`atEnter`・`ctrlcBandPaste`・`helpOpen`・`workingInterrupted`・`aeInstantEnd`・`atref1Paste`・`atref1Enter1`・`atref1hPaste`・`atref1hEnter1`・`atref2Paste`・`atref2Enter1`・`atref3Paste`・`atref4Paste`・`atref4Enter1`・`atref5Paste`・`atref5Enter1`・`atref6Esc`・`atref7SameWriteCr`・`atref8Paste`・`atref8Enter1`

台帳の列の名前（6）: `aeInstant`・`aeFirst300`・`aeFirst2000`・`aeStream`・`escRewindBand`・`ctrlcBand`

- [ ] **Step 1: 失敗するテストを書く（台帳の SHA-256・個人情報・読み出し）**

`src/renderer/src/lib/__tests__/copilotInputScreensFixture.test.ts` を作る:

```ts
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { lineText } from '../agentViewport'
import {
  copilotInputScreen,
  copilotInputSequence,
  screenFromTexts
} from './fixtures/copilotInputScreens'
import data from './fixtures/copilotInputScreens.json'

// copilot の入力欄の台帳(fixtures/copilotInputScreens.json)の改変と、個人情報の混入を検知する。
// 台帳は段階 2b の追加の記録から個人情報を同じ長さの中立な文字列へ置き換えたもの(手順は fixtures/README.md の
// copilotInputScreens.json の節)。copilot の版を上げて記録し直したら、README.md の手順で置き換え、このファイルの個人情報の
// テストが通ることを確かめてから COPILOT_INPUT_SCREENS_SHA256 を更新する
const COPILOT_INPUT_SCREENS_SHA256 =
  'b2015f3d08d739570b384bccd5291e79f2aad6a1a47fde81b890300bc71cac6e'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

const raw = readFileSync(resolve(__dirname, 'fixtures/copilotInputScreens.json'))
const text = raw.toString('utf-8')

describe('copilotInputScreens.json(copilot の入力欄の台帳)', () => {
  it('置き換えた後の内容から変わっていない(SHA-256)', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(COPILOT_INPUT_SCREENS_SHA256)
  })

  it('段階 2b の追加の記録から選んだ 45 の画面と 6 つの列を持つ', () => {
    expect(Object.keys(data.screens)).toHaveLength(45)
    expect(Object.keys(data.sequences)).toHaveLength(6)
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

  it('ゼロ以外の UUID を含まない(折り返された UUID の後半も)', () => {
    const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []
    expect(uuids.filter((uuid) => uuid !== ZERO_UUID)).toEqual([])
    const tails = text.match(/[0-9a-f]*-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []
    expect(tails.filter((tail) => /[1-9a-f]/.test(tail))).toEqual([])
  })

  it('画面の読み出しは行の数だけ行を返し、記録の無い行は空の行にする(空の入力欄の記号の行と帯)', () => {
    const screen = copilotInputScreen('empty')
    expect(screen).toMatchObject({ cols: 100, rows: 30 })
    expect(screen.lines).toHaveLength(30)
    expect(screen.lines[1]).toEqual([])
    expect(lineText(screen.lines[27])).toBe('❯')
    expect(lineText(screen.lines[29])).toMatch(/^ ← open sidebar · \/ commands/)
  })

  it('フォルダの名前に大きさのある記録は、その大きさで読む(tallIdle は 60 × 12)', () => {
    const screen = copilotInputScreen('tallIdle')
    expect(screen).toMatchObject({ cols: 60, rows: 12 })
    expect(screen.lines).toHaveLength(12)
    expect(lineText(screen.lines[8])).toBe('❯')
  })

  it('列の読み出しは、書き込みからの時刻と、画面の末尾の行を属性の無い行で返す(aeInstant は Enter から 52・63・99・2405ms)', () => {
    const frames = copilotInputSequence('aeInstant')
    expect(frames.map((frame) => frame.dt)).toEqual([52, 63, 99, 2405])
    expect(frames[0].lines.map(lineText)).toContain('❯ prompt instant')
    expect(frames[0].lines.flat().some((cell) => cell.dim || cell.inverse)).toBe(false)
  })

  it('screenFromTexts は文字列の行を属性の無い行にする(空の文字列は空の行)', () => {
    expect(screenFromTexts(['ab', ''])).toEqual([
      [
        { char: 'a', dim: false, inverse: false },
        { char: 'b', dim: false, inverse: false }
      ],
      []
    ])
  })
})
```

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/copilotInputScreensFixture.test.ts`
Expected: FAIL（`./fixtures/copilotInputScreens.json` と `./fixtures/copilotInputScreens` が見つからない）

- [ ] **Step 3: 変換のスクリプトと置き換えのスクリプトを書く（git 管理外）**

```bash
R=<repo-root>/.superpowers/agent-cli-kind/copilot-input-recorder
test -f "$R/out/draft-100x30/snaps.json" && test -f "$R/out/afterenter-100x30/watch.jsonl" && test -f "$R/out/atref8-100x30/snaps.json" || echo "missing $R/out"
test -f <repo-root>/.superpowers/agent-cli-kind/copilot-screens-recorder/sanitize-copilot.py || echo "missing 2a sanitize"
```

Expected: `missing` が出ない（段階 2b の追加の記録と段階 2a の置き換えのスクリプトがある。無ければ止めて報告する。`copilot` を起動して記録し直さない）

`.superpowers/agent-cli-kind/copilot-input-recorder/to-fixture.js` を作る（段階 2a の `copilot-screens-recorder/to-fixture.js` と同じ形。違いは、画面の表・列の書き出し・全角の文字の扱い・大きさの決め方）:

```js
// copilot の入力欄の台帳(copilotInputScreens.json)の元を、段階 2b の追加の記録(out/<フォルダ>/snaps.json・watch.jsonl)から作る。
// 段階 2a の copilot-screens-recorder/to-fixture.js と同じ形。使い方: node to-fixture.js <書き出し先の JSON>(個人情報の置き換えは
// sanitize-copilot.py で後からかける)
const fs = require('node:fs')
const { join } = require('node:path')

const OUT = join(__dirname, 'out')
// [台帳の名前, 記録のフォルダ, 記録の label](設計書「実装の最初に確かめること」4 の画面の表の順)
const SCENES = [
  ['empty', 'draft-100x30', 'empty'],
  ['spacesTyped', 'draft-100x30', 'spaces-typed'],
  ['spacesPasted', 'draft-100x30', 'spaces-pasted'],
  ['spacesEsc1', 'draft-100x30', 'spaces-esc1'],
  ['newlinesPasted', 'draft-100x30', 'newlines-pasted'],
  ['multiPasted', 'draft-100x30', 'multi-pasted'],
  ['shellEmpty', 'draft-100x30', 'shell-empty'],
  ['shellDraft', 'draft-100x30', 'shell-draft'],
  ['shellSpaces', 'draft-100x30', 'shell-spaces'],
  ['afterTurnEmpty', 'draft-100x30', 'after-turn-empty'],
  ['afterTurn1char', 'draft-100x30', 'after-turn-1char'],
  ['fold10', 'fold-100x30', 'fold10'],
  ['fold11', 'fold-100x30', 'fold11'],
  ['long5000', 'fold-100x30', 'long5000'],
  ['send11', 'fold-100x30', 'send11'],
  ['inline20480', 'big-run3', 'size20480'],
  ['saved20481', 'big-run3', 'size20481'],
  ['ja6800', 'misc-100x30', 'ja6800'],
  ['huge', 'misc-100x30', 'huge'],
  ['tallIdle', 'tall-60x12', 'idle-small'],
  ['tallPaste9', 'tall-60x12', 'paste-9-lines'],
  ['tallPaste30', 'tall-60x12', 'paste-30-lines'],
  ['tallPaste5000', 'tall-60x12', 'paste-5000'],
  ['tallSent', 'tall-60x12', 'typed-700-sent'],
  ['atPaste', 'suffix-100x30', 'at-paste+600'],
  ['atEnter', 'suffix-100x30', 'at-enter+3000'],
  ['ctrlcBandPaste', 'transient-100x30', 'ctrlc-band-paste'],
  ['helpOpen', 'transient-100x30', 'help-open'],
  ['workingInterrupted', 'transient-100x30', 'working-interrupted'],
  ['aeInstantEnd', 'afterenter-100x30', 'ae-instant-end'],
  ['atref1Paste', 'atref1-100x30', 'paste+800'],
  ['atref1Enter1', 'atref1-100x30', 'enter1+2500'],
  ['atref1hPaste', 'atref1h-100x30', 'paste+800'],
  ['atref1hEnter1', 'atref1h-100x30', 'enter1+2500'],
  ['atref2Paste', 'atref2-100x30', 'paste+800'],
  ['atref2Enter1', 'atref2-100x30', 'enter1+2500'],
  ['atref3Paste', 'atref3-100x30', 'paste+800'],
  ['atref4Paste', 'atref4-100x30', 'paste+800'],
  ['atref4Enter1', 'atref4-100x30', 'enter1+2500'],
  ['atref5Paste', 'atref5-100x30', 'paste+800'],
  ['atref5Enter1', 'atref5-100x30', 'enter1+2500'],
  ['atref6Esc', 'atref6-100x30', 'esc+1200'],
  ['atref7SameWriteCr', 'atref7-100x30', 'pbcr+2500'],
  ['atref8Paste', 'atref8-100x30', 'paste+800'],
  ['atref8Enter1', 'atref8-100x30', 'enter1+2500']
]
// [台帳の列の名前, 記録のフォルダ, watch.jsonl の label](設計書「実装の最初に確かめること」4 の列の表の順)
const SEQUENCES = [
  ['aeInstant', 'afterenter-100x30', 'ae-instant'],
  ['aeFirst300', 'afterenter-100x30', 'ae-first300'],
  ['aeFirst2000', 'afterenter-100x30', 'ae-first2000'],
  ['aeStream', 'afterenter-100x30', 'ae-stream'],
  ['escRewindBand', 'transient-100x30', 'esc-rewind-band'],
  ['ctrlcBand', 'transient-100x30', 'ctrlc-band']
]
// 全角(幅 2)になりうる文字。記録の text は全角の文字の右半分のセルを除いて連結してある(agentScreens.json と同じ)。
// 全角の文字がある行に dim・反転の範囲があると、セルの位置と文字の位置がずれるので止める
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

/** 画面の列・行の数。フォルダの名前に大きさ(60x12)があればそれ、無ければ 100 列と text の行の数(30 行であることを確かめる) */
function sizeOf(folder, snap) {
  const rowsOfText = snap.text.split('\n').length
  const fromFolder = /-(\d+)x(\d+)$/.exec(folder)
  if (fromFolder !== null) {
    const size = { cols: Number(fromFolder[1]), rows: Number(fromFolder[2]) }
    if (size.rows !== rowsOfText) throw new Error(`行の数が合いません: ${folder} の ${snap.label}`)
    return size
  }
  if (rowsOfText !== 30) throw new Error(`100 × 30 ではありません: ${folder} の ${snap.label}`)
  return { cols: 100, rows: 30 }
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
    if ([...text].length > cols) throw new Error(`列の数を超えています: ${name} の ${attr.y} 行目`)
    const dim = rangesOf(attr.segs, 'd')
    const inverse = rangesOf(attr.segs, 'inv')
    if (WIDE.test(text) && (dim.length > 0 || inverse.length > 0))
      throw new Error(`全角の文字の行に属性があります: ${name} の ${attr.y} 行目`)
    if (text === '' && dim.length === 0 && inverse.length === 0) continue
    // 段階 2a の台帳と同じく、範囲が無ければ省く([文字列]・[文字列, dim]・[文字列, dim, 反転])
    const raw = [text]
    if (dim.length > 0 || inverse.length > 0) raw.push(dim)
    if (inverse.length > 0) raw.push(inverse)
    lines[String(attr.y)] = raw
  }
  screens[name] = { cols, rows, lines }
}

const sequences = {}
for (const [name, folder, label] of SEQUENCES) {
  const watches = fs
    .readFileSync(join(OUT, folder, 'watch.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const watch = watches.find((w) => w.label === label)
  if (watch === undefined) throw new Error(`列がありません: ${folder} の ${label}`)
  sequences[name] = {
    frames: watch.ch.map((change) => ({
      dt: change.dt,
      lines: change.tail.split('\n').map((line) => line.trimEnd())
    }))
  }
}

const data = {
  _note:
    'copilot の入力欄の画面(@xterm/headless の表示中のバッファ)。GitHub Copilot CLI 1.0.87・node-pty 1.1.0・@xterm/headless 6.0.0 で記録した(段階 2b の追加の記録)。screens.<名前>.lines は 行番号 -> [文字列, dim の範囲, 反転の範囲](範囲は [開始, 終わり) のセルの位置)。文字列は記録の文字列の末尾の空白を除いたもの(全角の文字の右半分のセルは除いてある)。空の行は省く。sequences.<名前>.frames は [{ dt: 書き込みからの ms, lines: 画面の末尾の行の文字列(末尾の空白を除く。属性は持たない) }]。記録の手順は .superpowers/agent-cli-kind/copilot-input-recorder/report.md',
  screens,
  sequences
}
fs.writeFileSync(process.argv[2], JSON.stringify(data, null, 1) + '\n')
console.log(
  `${Object.keys(screens).length} 画面・${Object.keys(sequences).length} 列を書き出しました: ${process.argv[2]}`
)
```

`.superpowers/agent-cli-kind/copilot-input-recorder/sanitize-copilot.py` を作る（段階 2a の `copilot-screens-recorder/sanitize-copilot.py` を写し、冒頭の 2 行のコメントだけを直したもの。規則 1・1'・2・3 は同じ順・同じ正規表現）:

```python
# -*- coding: utf-8 -*-
# copilot の入力欄の台帳の個人情報を、同じ長さの中立な文字列へ置き換える(段階 2a の copilot-screens-recorder/sanitize-copilot.py と同じ規則 1・1'・2・3)。
# 使い方: python3 sanitize-copilot.py <to-fixture.js が書いた JSON> <写し先の copilotInputScreens.json>
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

段階 2a のスクリプトとの違いがコメントの 2 行だけであることを確かめる:

```bash
diff <repo-root>/.superpowers/agent-cli-kind/copilot-screens-recorder/sanitize-copilot.py <repo-root>/.superpowers/agent-cli-kind/copilot-input-recorder/sanitize-copilot.py
```

Expected: `2,3c2,3` の 1 か所だけ（冒頭のコメント）

- [ ] **Step 4: 台帳を作り、個人情報が無いことを確かめる（ハッシュはまだ固定しない）**

```bash
R=<repo-root>/.superpowers/agent-cli-kind/copilot-input-recorder
F=<repo-root>/src/renderer/src/lib/__tests__/fixtures
test -f "$R/to-fixture.js" && test -f "$R/sanitize-copilot.py" && test -d "$F" || echo "missing"
node "$R/to-fixture.js" "$R/copilotInputScreens.raw.json"
python3 "$R/sanitize-copilot.py" "$R/copilotInputScreens.raw.json" "$F/copilotInputScreens.json"
wc -c "$R/copilotInputScreens.raw.json" "$F/copilotInputScreens.json"
diff "$R/copilotInputScreens.raw.json" "$F/copilotInputScreens.json" | grep -c '^<'
diff "$R/copilotInputScreens.raw.json" "$F/copilotInputScreens.json" | grep '^<' | grep -vc '/\.\.\./work'
grep -cE '/Users/|-Users-|claude-[0-9]|/private/tmp' "$F/copilotInputScreens.json"
```

Expected:

- `missing` が出ず、`45 画面・6 列を書き出しました: …` が出る（場面・列が無い・行の数の食い違い・列の超過・全角の文字の行の属性があれば例外で止まる。止まったら報告する）
- 2 つのファイルの大きさが同じ（203079 バイト）
- 変わった行が `145`、そのうち `/.../work` を含まない行が `0`（どれも入力欄の上の作業ディレクトリの行。画面 38 行・列 107 行）
- 最後の `grep -c` が `0`

- [ ] **Step 5: 台帳の読み出し・`.prettierignore`・README を書く**

`src/renderer/src/lib/__tests__/fixtures/copilotInputScreens.ts` を作る:

```ts
import type { ViewportLine } from '../../agentViewport'
import { makeLine, toRecordedScreen } from './agentScreens'
import type { RawScreen, RecordedScreen } from './agentScreens'
import data from './copilotInputScreens.json'

// copilot の入力欄の記録(copilotInputScreens.json。GitHub Copilot CLI 1.0.87 の段階 2b の追加の記録から選んだ 45 画面と 6 つの列)を、
// 行の配列にする。画面の形式は copilotScreens.json と同じ(lines は 行番号 → [文字列, dim の範囲, 反転の範囲])で、行の配列にするのも
// agentScreens.ts の toRecordedScreen。列(sequences)は書き込みからの時刻と画面の末尾の行の文字列(属性なし)。
// 記録の手順・個人情報の置き換え・copilot の版を上げたときの記録し直しは、同じディレクトリの README.md

export type CopilotInputScreenName = keyof typeof data.screens
export type CopilotInputSequenceName = keyof typeof data.sequences

/** 列の 1 つの画面(書き込みからの時刻と、その時点の画面の末尾の行) */
export interface CopilotInputFrame {
  /** 書き込み(Enter・Esc・Ctrl+C)からの ms */
  dt: number
  lines: ViewportLine[]
}

export function copilotInputScreen(name: CopilotInputScreenName): RecordedScreen {
  return toRecordedScreen(data.screens[name] as unknown as RawScreen)
}

/** 文字列の行から、属性の無い画面の行を作る(列の画面と、テストの手書きの画面に使う) */
export function screenFromTexts(texts: readonly string[]): ViewportLine[] {
  return texts.map((text) => makeLine(text))
}

export function copilotInputSequence(name: CopilotInputSequenceName): CopilotInputFrame[] {
  return data.sequences[name].frames.map((frame) => ({
    dt: frame.dt,
    lines: screenFromTexts(frame.lines)
  }))
}
```

`.prettierignore` の最後の行（`src/renderer/src/lib/__tests__/fixtures/copilotScreens.json`）の次に、次の 1 行を足す:

```text
src/renderer/src/lib/__tests__/fixtures/copilotInputScreens.json
```

`src/renderer/src/lib/__tests__/fixtures/README.md` の末尾（`copilotScreens.json` の節の最後の行 `個人情報（…）が含まれないことは \`copilotScreensFixture.test.ts\` で固定している。` の後）に、空行を 1 つ置いて次をそのまま足す:

```markdown
# `copilotInputScreens.json`（`copilot` の入力欄の台帳）

`copilotInputBox.test.ts` が `copilot` の入力欄の読み取り（`readCopilotInputState`・`isCopilotPasteEchoed`）と活動の判定を、`copilotPromptSend.test.ts`・`useAgentPromptSender.test.ts`・`useAgentWorkspace.test.ts` が送信の手順と配線を、実物の画面で固定するための台帳。
GitHub Copilot CLI 1.0.87・node-pty 1.1.0・`@xterm/headless` 6.0.0 で記録した 45 の画面（空の入力欄・空白だけや改行だけの書きかけ・複数行・シェルのモード・畳み〈`[Paste #N - M lines]`・`[Saved pasted content to workspace (…)`〉・長い 1 行・全角の文字・12 行の画面・末尾の `@` の語と末尾の参照〈補完の候補の一覧〉・一時的な帯・`Enter` の後）と 6 つの列（`Enter` の後の移り変わり・一時的な帯の移り変わり）を、
段階 2b の追加の記録（`.superpowers/agent-cli-kind/copilot-input-recorder/out/*/snaps.json`・`watch.jsonl`。リポジトリの外）から写した（新しく記録はしていない。場面と期待は設計書 `docs/superpowers/specs/2026-10-22-agent-cli-copilot-send-design.md` の「実装の最初に確かめること」）。
段階 2a の `copilotScreens.json` とは記録の道具と回が違うため、別の台帳にした（段階 2a の台帳とそのハッシュは変えない）。

画面（`screens`）の形式は `copilotScreens.json` と同じ（`screens.<名前>.lines` は 行番号 → `[文字列, dim の範囲, 反転の範囲]`）。文字列は記録の文字列の末尾の空白を除いたもの。空の行は省く。
全角の文字は記録の時点で右半分のセルを除いて連結してある（`ja6800` の入力欄の行は 49 文字。`agentScreens.json` と同じ）。全角の文字のある行に dim・反転の範囲は無い（あれば変換のスクリプトが止まる）。
列・行の数はフォルダの名前の大きさ（`tall-60x12` は 60 × 12）、大きさの無いフォルダ（`big-run3`）は 100 × 30。列（`sequences`）は `sequences.<名前>.frames` が `[{ dt, lines }]`（`dt` は書き込みからの ms、`lines` は画面の末尾の 8 行の文字列。末尾の空白を除く。属性は持たない。`copilot` の入力欄の規則は属性を使わないため）。
**prettier やエディタで整形しない**（`.prettierignore` で外している）。

## `copilot` の版を上げたら記録し直す

入力欄の規則（空の入力欄の帯 `← open … / commands`・書きかけの帯 `@ files · # issues`・畳みの形・記号 `❯`・`!`・`Start of Prompt Indicator`）と送信の規則（先頭の `!`・`/`、末尾の `@` の語の補完、`Enter` の後の移り変わり）は `copilot` の版で変わりうる。版に依存する規則は `copilotInputBox.ts`・`copilotPromptSend.ts` の定数と、`agentPasteText.ts` の `AGENT_PROMPT_TEXT_RULES.copilot` に閉じている。
版を上げたら、段階 2b の記録用のスクリプト（`.superpowers/agent-cli-kind/copilot-input-recorder/rec.js` と `scenarios2.js`。偽のローカルの提供元と一時の `HOME`・`COPILOT_HOME` で、GitHub のサービスに接続せずに記録する）で記録し直し、同じフォルダの `to-fixture.js`（変換）と `sanitize-copilot.py`（下の置き換え）をかけてから写し、`copilotInputScreensFixture.test.ts` の個人情報のテストが通ることを確かめてから `COPILOT_INPUT_SCREENS_SHA256` を更新してテストを流す。
画面を足し・消したら `copilotInputBox.test.ts` の期待の表（`EXPECTED`）も直す（全画面が活動と入力欄の両方の期待を持っていないと型エラーとテストで落ちる）。

## 個人情報の置き換え（`copilotInputScreens.json` の作り方）

記録した画面と列には、記録した端末のユーザー名・UID（記録時の一時ディレクトリ）が入力欄の上の作業ディレクトリの行に出ていた。`copilotScreens.json` と同じく、同じ長さの ASCII の中立な文字列に置き換えたものを置く。

- 変換の後・置き換えの前（`to-fixture.js` の出力。リポジトリの外）: SHA-256 `f6f1fdd8f865c8365eb5a4129f4746f937ee73bb50ee90321230bdab88bb0099`
- 置き換えた後（このディレクトリの `copilotInputScreens.json`）: SHA-256 `b2015f3d08d739570b384bccd5291e79f2aad6a1a47fde81b890300bc71cac6e`（`copilotInputScreensFixture.test.ts` で固定）
- 変わった行: 145 行（どれも入力欄の上の作業ディレクトリの行。画面 38 行・列 107 行）。ファイルの大きさは同じ（203,079 バイト）。UUID は記録に無い

置換の規則とスクリプトは、上の `copilotScreens.json` の節と同じ（規則 1・1'・2・3 をこの順にかける。`python3 sanitize-copilot.py <to-fixture.js の出力> <写し先の copilotInputScreens.json>`。スクリプトは段階 2a の `sanitize-copilot.py` の冒頭のコメントだけを直したもの）。
個人情報（`/Users/`・`-Users-`・`/home/user/` 以外のホーム・`claude-<UID>`・`/private/tmp`・ゼロ以外の UUID・メールアドレス・`sk-`・`ghp_` など）が含まれないことは `copilotInputScreensFixture.test.ts` で固定している。
```

- [ ] **Step 6: 個人情報のテストを通してから、ハッシュを確かめて固定する（L-017）**

まず、ハッシュ以外のテスト（個人情報・読み出し）が通ることを確かめる:

Run: `npx vitest run src/renderer/src/lib/__tests__/copilotInputScreensFixture.test.ts -t "含まない|読み出し|screenFromTexts|45 の画面"`
Expected: PASS（`置き換えた後の内容から変わっていない(SHA-256)` は `-t` で外れて skipped）。落ちたら置き換えが足りないので、台帳を直してから（スクリプトの規則を直してかけ直す）やり直す。ハッシュは固定しない

個人情報のテストが通ったら、ハッシュを確かめる:

```bash
R=<repo-root>/.superpowers/agent-cli-kind/copilot-input-recorder
F=<repo-root>/src/renderer/src/lib/__tests__/fixtures
test -f "$R/copilotInputScreens.raw.json" && test -f "$F/copilotInputScreens.json" || echo "missing"
shasum -a 256 "$R/copilotInputScreens.raw.json" "$F/copilotInputScreens.json"
```

Expected: 変換の後 `f6f1fdd8f865c8365eb5a4129f4746f937ee73bb50ee90321230bdab88bb0099`、置き換えた後 `b2015f3d08d739570b384bccd5291e79f2aad6a1a47fde81b890300bc71cac6e`（計画の時点で確かめた値。テストの `COPILOT_INPUT_SCREENS_SHA256` と README に書いた値）。違えばスクリプトの写し間違いを疑い、上のコードと `diff` で比べる。それでも違えば（記録が計画の後に変わったなど）、個人情報のテストが通った台帳の値でテストと README の 2 か所の値を直し、報告に書く

Run: `npx vitest run src/renderer/src/lib/__tests__/copilotInputScreensFixture.test.ts src/renderer/src/lib/__tests__/copilotScreensFixture.test.ts src/renderer/src/lib/__tests__/agentScreensFixture.test.ts`
Expected: PASS

- [ ] **Step 7: 変異で確かめる（個人情報のテストが置き換えの前の台帳で落ちること）**

```bash
R=<repo-root>/.superpowers/agent-cli-kind/copilot-input-recorder
F=<repo-root>/src/renderer/src/lib/__tests__/fixtures
test -f "$R/copilotInputScreens.raw.json" && test -f "$R/sanitize-copilot.py" || echo "missing"
cp "$R/copilotInputScreens.raw.json" "$F/copilotInputScreens.json"
cd <repo-root> && npx vitest run src/renderer/src/lib/__tests__/copilotInputScreensFixture.test.ts -t "含まない"
python3 "$R/sanitize-copilot.py" "$R/copilotInputScreens.raw.json" "$F/copilotInputScreens.json"
shasum -a 256 "$F/copilotInputScreens.json"
```

Expected: `missing` が出ない。vitest は FAIL（`ホームのパス`・`ホームのパスを符号化したもの`・`一時ディレクトリ`・`/private/tmp` を含まない、が落ちる）。最後の `shasum` が Step 6 と同じ値（置き換えた台帳に戻っている）

- [ ] **Step 8: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/lib/__tests__/fixtures/copilotInputScreens.ts src/renderer/src/lib/__tests__/copilotInputScreensFixture.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check src/renderer/src/lib/__tests__/fixtures/copilotInputScreens.ts src/renderer/src/lib/__tests__/copilotInputScreensFixture.test.ts src/renderer/src/lib/__tests__/fixtures/README.md`
Expected: すべて整形済み（外れたら、そのファイルだけを `npx prettier --write <ファイル>` で直す。`copilotInputScreens.json` は整形しない）
Run: `git status --short`
Expected: `.prettierignore`・`README.md` の変更と、`copilotInputScreens.json`・`copilotInputScreens.ts`・`copilotInputScreensFixture.test.ts` の未追跡と、作業の前からある設計書・プランの未追跡のファイルだけ（`.superpowers/` は出ない）

---

### Task 2: copilot の入力欄の読み取り

> **設計書の読む節:** 「copilot の入力欄（記録の要点）」の 2・5・6・7、「入力欄の特定と読み取り」、「実装の最初に確かめること」の 4（画面と期待・列・echo の正の例と負の例）、「テスト方針」の renderer の入力欄、「構成」の `copilotInputBox.ts`・`copilotScreenActivity.ts` の行。
>
> **気をつける知見:** L-041（空・書きかけ・決められないを見分け、決められない形は送らない側〈`undetermined`〉に倒す。`claude` の規則〈`isInputBoxEmpty`〉で `copilot` の画面を読まない）・L-059（記録の 45 画面と 6 列を全部期待に入れ、入っていない画面があれば落ちる形にする。記録に無い形だけを手書きにする）・L-398（入力欄の罫線からの相対位置だけで見る。会話や補完の候補の一覧〈上の罫線より上〉の同じ文字で echo を真にしない）・L-593（規則の定数を `copilotInputBox.ts` に閉じ、`claude` の `agentInputBox.ts` と共有しない）

**Files:**

- Create: `src/renderer/src/lib/copilotInputBox.ts`
- Modify: `src/renderer/src/lib/copilotScreenActivity.ts`（入力欄の特定を `copilotInputBox.ts` から import する。判定の結果は変えない）
- Test: `src/renderer/src/lib/__tests__/copilotInputBox.test.ts`（新規）、`src/renderer/src/lib/__tests__/copilotScreenActivity.test.ts`（変えずに通ることを確かめる）

**Interfaces:**

- Consumes: `copilotInputScreen`・`copilotInputSequence`・`screenFromTexts`・`CopilotInputScreenName`（Task 1）、`copilotScreen`・`CopilotScreenName`（段階 2a の台帳。既存）、`classifyCopilotScreen(lines: readonly ViewportLine[]): AgentActivity`（既存）、`lineText`・`ViewportLine`（既存）
- Produces（Task 4 が使う）:

```ts
// src/renderer/src/lib/copilotInputBox.ts
export type CopilotInputSymbol = 'prompt' | 'shell' | 'screen-reader'
export interface CopilotInputBox {
  top: number
  bottom: number
  symbol: CopilotInputSymbol
  rows: string[]
  band: string
  bandHead: string | null
}
export function copilotScreenTexts(lines: readonly ViewportLine[]): string[]
export function locateCopilotInputBox(texts: readonly string[]): CopilotInputBox | null
export type CopilotInputState = 'empty' | 'draft' | 'shell' | 'undetermined' | 'not-found'
export function readCopilotInputState(lines: readonly ViewportLine[]): CopilotInputState
export function isCopilotPasteEchoed(lines: readonly ViewportLine[], text: string): boolean
```

- [ ] **Step 1: 失敗するテストを書く（台帳の期待・列・echo・手書きの画面・段階 2a の台帳）**

`src/renderer/src/lib/__tests__/copilotInputBox.test.ts` を作る:

```ts
import { describe, it, expect } from 'vitest'
import {
  copilotScreenTexts,
  isCopilotPasteEchoed,
  locateCopilotInputBox,
  readCopilotInputState
} from '../copilotInputBox'
import type { CopilotInputState } from '../copilotInputBox'
import { classifyCopilotScreen } from '../copilotScreenActivity'
import type { AgentActivity } from '../agentActivity'
import { lineText } from '../agentViewport'
import type { ViewportLine } from '../agentViewport'
import { makeLine } from './fixtures/agentScreens'
import { copilotScreen } from './fixtures/copilotScreens'
import type { CopilotScreenName } from './fixtures/copilotScreens'
import {
  copilotInputScreen,
  copilotInputSequence,
  screenFromTexts
} from './fixtures/copilotInputScreens'
import type {
  CopilotInputScreenName,
  CopilotInputSequenceName
} from './fixtures/copilotInputScreens'
import data from './fixtures/copilotInputScreens.json'

// 記録済みの画面(GitHub Copilot CLI 1.0.87 の段階 2b の追加の記録。設計書 2026-10-22「実装の最初に確かめること」4)ごとの
// 活動(classifyCopilotScreen)と入力欄(readCopilotInputState)の期待。Record にしているので、台帳に画面が増えたら型エラーになる
const EXPECTED: Record<CopilotInputScreenName, readonly [AgentActivity, CopilotInputState]> = {
  empty: ['idle', 'empty'],
  spacesTyped: ['idle', 'draft'],
  spacesPasted: ['idle', 'draft'],
  spacesEsc1: ['idle', 'undetermined'],
  newlinesPasted: ['idle', 'draft'],
  multiPasted: ['idle', 'draft'],
  shellEmpty: ['idle', 'shell'],
  shellDraft: ['idle', 'shell'],
  // シェルのモードで空白だけを入力した画面は、記号の行が `!` だけになり入力欄として認められない(既知の制約。送らない側)
  shellSpaces: ['unknown', 'not-found'],
  afterTurnEmpty: ['idle', 'empty'],
  afterTurn1char: ['idle', 'draft'],
  fold10: ['idle', 'draft'],
  fold11: ['idle', 'draft'],
  long5000: ['idle', 'draft'],
  send11: ['idle', 'empty'],
  inline20480: ['idle', 'draft'],
  saved20481: ['idle', 'draft'],
  ja6800: ['idle', 'draft'],
  huge: ['idle', 'draft'],
  tallIdle: ['idle', 'empty'],
  tallPaste9: ['idle', 'draft'],
  tallPaste30: ['idle', 'draft'],
  tallPaste5000: ['idle', 'draft'],
  tallSent: ['idle', 'empty'],
  atPaste: ['idle', 'draft'],
  // Enter が補完の確定に取られ、本文が `look at @file.txt` に書き換わった入力欄(空に戻らない)
  atEnter: ['idle', 'draft'],
  ctrlcBandPaste: ['idle', 'draft'],
  helpOpen: ['idle', 'undetermined'],
  workingInterrupted: ['idle', 'empty'],
  aeInstantEnd: ['idle', 'empty'],
  // 補完の候補の一覧が上の罫線より上に開いても、入力欄の外の選択の案内が無いので入力待ち
  atref1Paste: ['idle', 'draft'],
  atref1Enter1: ['idle', 'draft'],
  atref1hPaste: ['idle', 'draft'],
  atref1hEnter1: ['idle', 'draft'],
  atref2Paste: ['idle', 'draft'],
  atref2Enter1: ['idle', 'empty'],
  atref3Paste: ['idle', 'draft'],
  atref4Paste: ['idle', 'draft'],
  atref4Enter1: ['idle', 'empty'],
  atref5Paste: ['idle', 'draft'],
  atref5Enter1: ['idle', 'draft'],
  atref6Esc: ['idle', 'draft'],
  atref7SameWriteCr: ['idle', 'empty'],
  atref8Paste: ['idle', 'draft'],
  atref8Enter1: ['idle', 'empty']
}

const RULE = '─'.repeat(100)
const IDLE_BAND =
  ' ← open sidebar · / commands · ? help · tab next tab                                gpt-4o · Medium'
const DRAFT_BAND =
  ' @ files · # issues                                                                 gpt-4o'

/** 会話(above)・入力欄の中(input)・帯(band)から、入力欄のある手書きの画面を作る */
const boxScreen = (
  above: readonly string[],
  input: readonly string[],
  band: readonly string[]
): ViewportLine[] => screenFromTexts([...above, RULE, ...input, RULE, ...band])

/** 台帳の画面の各行を列の数まで空白で埋める(アプリの画面の lineText と同じ形) */
const padded = (name: CopilotInputScreenName): ViewportLine[] => {
  const { cols, lines } = copilotInputScreen(name)
  return lines.map((line) => makeLine(lineText(line).padEnd(cols, ' ')))
}

const boxOf = (lines: readonly ViewportLine[]): ReturnType<typeof locateCopilotInputBox> =>
  locateCopilotInputBox(copilotScreenTexts(lines))

/** 送れたことの確かめ(copilotPromptSend.ts の手順 7 と同じ条件) */
const isSubmitConfirmed = (lines: readonly ViewportLine[]): boolean =>
  classifyCopilotScreen(lines) === 'working' || readCopilotInputState(lines) === 'empty'

// 記録のスクリプト(scenarios2.js)で貼った本文
const numbered = (n: number, prefix: string): string =>
  Array.from({ length: n }, (_, k) => `${prefix}${k + 1}`).join('\n')
const tokens = (n: number): string => {
  let s = ''
  let k = 0
  while (s.length < n) s += 'T' + String(k++).padStart(5, '0') + '.'
  return s.slice(0, n - 4) + 'BEND'
}

describe('copilot の入力欄の台帳(記録した画面の活動と入力欄)', () => {
  it.each(Object.entries(EXPECTED))('%s', (name, [activity, state]) => {
    const { lines } = copilotInputScreen(name as CopilotInputScreenName)
    expect(classifyCopilotScreen(lines)).toBe(activity)
    expect(readCopilotInputState(lines)).toBe(state)
  })

  it('台帳のすべての画面が、活動と入力欄の両方の期待を持つ', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(data.screens).sort())
  })

  it('各行を列の数まで空白で埋めても結果が変わらない(empty・fold10)', () => {
    expect(readCopilotInputState(padded('empty'))).toBe('empty')
    expect(readCopilotInputState(padded('fold10'))).toBe('draft')
    expect(isCopilotPasteEchoed(padded('fold10'), numbered(10, 'L10-'))).toBe(true)
  })
})

describe('locateCopilotInputBox(記号と入力欄の行)', () => {
  it.each<[CopilotInputScreenName, string, string[]]>([
    ['empty', 'prompt', ['']],
    ['multiPasted', 'prompt', ['first line', 'second line', 'third line']],
    ['shellDraft', 'shell', ['echo hi']],
    ['shellEmpty', 'shell', ['Execute shell command']],
    // 入力欄の高さの上限を超えた分は入力欄の中でスクロールし、❯ は見えている最初の行に付く(記録の 7)
    ['tallPaste9', 'prompt', ['N6', 'N7', 'N8', 'N9']],
    ['fold11', 'prompt', ['[Paste #1 - 11 lines]']],
    ['newlinesPasted', 'prompt', ['', '']]
  ])('%s: 記号は %s、行は %j', (name, symbol, rows) => {
    expect(boxOf(copilotInputScreen(name).lines)).toMatchObject({ symbol, rows })
  })

  it('--screen-reader の記号の行(段階 2a の台帳の srIdleDraft)は screen-reader で、記号の後ろが行になる', () => {
    expect(boxOf(copilotScreen('srIdleDraft').lines)).toMatchObject({
      symbol: 'screen-reader',
      rows: ['hello there']
    })
  })

  it('入力欄が無い画面は null', () => {
    expect(boxOf(copilotInputScreen('shellSpaces').lines)).toBeNull()
    expect(boxOf([])).toBeNull()
  })
})

describe('送れたことの確かめに使う判定(Enter の後の列)', () => {
  it.each<CopilotInputSequenceName>(['aeInstant', 'aeFirst300', 'aeFirst2000'])(
    '%s: 最初の列(本文が残る)は偽、100ms までのどれかの列で真',
    (name) => {
      const frames = copilotInputSequence(name)
      expect(isSubmitConfirmed(frames[0].lines)).toBe(false)
      expect(frames.some((frame) => frame.dt <= 100 && isSubmitConfirmed(frame.lines))).toBe(true)
    }
  )

  it('aeStream: 最初の列(11ms)から真(入力欄は空、帯は作業中)', () => {
    const [first] = copilotInputSequence('aeStream')
    expect(first.dt).toBe(11)
    expect(classifyCopilotScreen(first.lines)).toBe('working')
    expect(isSubmitConfirmed(first.lines)).toBe(true)
  })

  it('Enter が補完の確定に取られた後の入力欄(atEnter・atref1Enter1・atref1hEnter1・atref5Enter1)は偽', () => {
    for (const name of ['atEnter', 'atref1Enter1', 'atref1hEnter1', 'atref5Enter1'] as const) {
      expect(isSubmitConfirmed(copilotInputScreen(name).lines)).toBe(false)
    }
  })
})

describe('一時的な帯の列(保留の上限 2,500ms より前に空に戻る)', () => {
  it.each<[CopilotInputSequenceName, string]>([
    ['escRewindBand', 'esc again to rewind'],
    ['ctrlcBand', 'ctrl+c again to exit']
  ])('%s: 帯が「%s」の列は undetermined、帯が戻った最後の列は empty', (name, band) => {
    const frames = copilotInputSequence(name)
    const transient = frames.filter((frame) =>
      frame.lines.some((line) => lineText(line).includes(band))
    )
    expect(transient.length).toBeGreaterThan(0)
    for (const frame of transient) expect(readCopilotInputState(frame.lines)).toBe('undetermined')
    const last = frames[frames.length - 1]
    expect(transient).not.toContain(last)
    expect(readCopilotInputState(last.lines)).toBe('empty')
    // copilotPromptSend.ts の COPILOT_INPUT_STATE_TIMEOUT_MS(2,500ms)
    expect(last.dt).toBeLessThan(2_500)
  })
})

describe('isCopilotPasteEchoed(記録した画面と、記録のスクリプトで貼った本文)', () => {
  it.each<[CopilotInputScreenName, string]>([
    ['multiPasted', 'first line\nsecond line\nthird line'],
    ['fold10', numbered(10, 'L10-')],
    ['fold11', numbered(11, 'L11-')],
    ['long5000', 'x'.repeat(4990) + 'ENDMARK'],
    ['inline20480', tokens(20480)],
    ['saved20481', tokens(20481)],
    ['ja6800', '漢'.repeat(6796) + 'JEND'],
    ['huge', 'h'.repeat(199995) + 'HEND'],
    // 入力欄の先頭の行が見えない(最後の行で見る)
    ['tallPaste9', numbered(9, 'N')],
    ['tallPaste30', numbered(30, 'P')],
    ['tallPaste5000', 'w'.repeat(4995) + 'WEND'],
    ['atref1Paste', '本文\n\n- @file.txt'],
    // アプリの参照の添付の形
    ['atref1hPaste', '本文\n\n参照:\n- @file.txt'],
    // 末尾に足した空白を含む本文でも、含まない本文でも真
    ['atref2Paste', '本文\n\n- @file.txt '],
    ['atref2Paste', '本文\n\n- @file.txt'],
    ['atref3Paste', '本文\n\n- @file.txt\n'],
    ['atref4Paste', '本文\n\n- @nofile.txt'],
    ['atref5Paste', '本文\n\n- @file.txt\n- @file2.txt'],
    ['atref8Paste', '本文\n\n- @file.txt\n- @file2.txt '],
    ['atref8Paste', '本文\n\n- @file.txt\n- @file2.txt']
  ])('%s に貼った本文は現れた(真)', (name, text) => {
    expect(isCopilotPasteEchoed(copilotInputScreen(name).lines, text)).toBe(true)
  })

  it.each<[CopilotInputScreenName, string]>([
    // 入力欄が空
    ['empty', 'first line\nsecond line\nthird line'],
    ['afterTurnEmpty', 'first line\nsecond line\nthird line'],
    // 記号が !(シェルのモード)
    ['shellDraft', 'echo hi'],
    // 入力欄の本文と違う本文
    ['multiPasted', 'another prompt']
  ])('%s に対して %j は現れていない(偽)', (name, text) => {
    expect(isCopilotPasteEchoed(copilotInputScreen(name).lines, text)).toBe(false)
  })
})

describe('手書きの画面(段階 2a・2b の台帳に無い形)', () => {
  it('--screen-reader の空の入力欄(Start of Prompt Indicator と空の入力欄の帯)は empty', () => {
    expect(readCopilotInputState(boxScreen([], ['Start of Prompt Indicator'], [IDLE_BAND]))).toBe(
      'empty'
    )
  })

  it('--screen-reader の書きかけ(Start of Prompt Indicatorhello)は draft で、本文 hello の echo は真', () => {
    const screen = boxScreen([], ['Start of Prompt Indicatorhello'], [DRAFT_BAND])
    expect(readCopilotInputState(screen)).toBe('draft')
    expect(isCopilotPasteEchoed(screen, 'hello')).toBe(true)
  })

  it('帯が空の入力欄の形なのに、入力欄が 2 行で文字が無い → undetermined', () => {
    expect(readCopilotInputState(boxScreen([], ['❯', ''], [IDLE_BAND]))).toBe('undetermined')
  })

  it('帯が空(描き直しの途中)→ undetermined', () => {
    expect(readCopilotInputState(boxScreen([], ['❯'], []))).toBe('undetermined')
  })

  it('入力欄の上の会話に本文と同じ文字があっても、入力欄が空なら echo は偽(入力欄の中だけで見る)', () => {
    const screen = boxScreen([' ❯ hello world'], ['❯'], [IDLE_BAND])
    expect(readCopilotInputState(screen)).toBe('empty')
    expect(isCopilotPasteEchoed(screen, 'hello world')).toBe(false)
  })

  it('記号の行の末尾に空白が残る入力欄(❯ と空白。段階 0 の記録で Esc 2 回の後に見えた残骸)は empty', () => {
    const screen = [RULE, '❯    ', RULE, IDLE_BAND].map((text) => makeLine(text))
    expect(readCopilotInputState(screen)).toBe('empty')
  })

  it('空の画面・入力欄の無い画面は not-found で、echo は偽(例外を投げない)', () => {
    expect(readCopilotInputState([])).toBe('not-found')
    expect(isCopilotPasteEchoed([], 'hello')).toBe(false)
  })
})

describe('段階 2a の台帳の画面の入力欄', () => {
  it.each<[CopilotScreenName, CopilotInputState]>([
    ['idle', 'empty'],
    ['idle80', 'empty'],
    // 40 列の段組みで折り返した帯(`← open     · / commands · ? help · tab` / `sidebar       next tab`)
    ['idle40', 'empty'],
    // `esc again to clear input` の間でも、書きかけが見えていれば draft
    ['draftEsc', 'draft'],
    ['rewindHint', 'undetermined'],
    ['help', 'undetermined'],
    // `/` の一覧の候補(`/add-dir`)が入力欄に入っている
    ['slashList', 'draft'],
    ['shellMode', 'shell']
  ])('%s → %s', (name, state) => {
    expect(readCopilotInputState(copilotScreen(name).lines)).toBe(state)
  })

  it('idle40 は帯をつないだ文字列で空の入力欄の形に当たり、帯の 1 行目だけには sidebar が無い', () => {
    const box = boxOf(copilotScreen('idle40').lines)
    expect(box?.band).toMatch(/^← open\b.*\/ commands\b/)
    expect(box?.bandHead).not.toContain('sidebar')
  })
})
```

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/copilotInputBox.test.ts`
Expected: FAIL（`../copilotInputBox` が見つからない）

- [ ] **Step 3: 入力欄の特定を移し、読み取りを足す**

`src/renderer/src/lib/copilotInputBox.ts` を作る（`locateCopilotInputBox`・`findBorderAbove` と `BORDER`・`SYMBOL_LINE`・`CONTINUATION` は `copilotScreenActivity.ts` から中身を変えずに移し、結果に `symbol` と `rows` を足す）:

```ts
import type { ViewportLine } from './agentViewport'
import { lineText } from './agentViewport'

// copilot の入力欄の特定と読み取り(設計書 2026-10-22「入力欄の特定と読み取り」)。入力欄の特定(locateCopilotInputBox と規則の
// 定数)は段階 2a の copilotScreenActivity.ts から中身を変えずに移し、記号と入力欄の行を足した。活動の判定(classifyCopilotScreen)と
// 送信の手順(copilotPromptSend.ts)が使う。GitHub Copilot CLI 1.0.87 の画面で記録した(copilotScreens.json・copilotInputScreens.json)。
// 規則の定数はこのファイルに閉じ、claude の agentInputBox.ts の定数とは共有しない(copilot の画面に反転のカーソルは無いので、
// claude の isInputBoxEmpty の規則は使わない)。入力欄の罫線からの相対位置(入力欄の中の行と、下の罫線より下の帯)だけで見て、
// 会話や補完の候補の一覧(上の罫線より上)の同じ文字を見ない。根拠が足りなければ undetermined を返し、送らない側に倒す(L-398)。
// dim・反転の属性は使わない。例外は投げない

/** 全幅の罫線の行(行全体が ─ で 20 文字以上)。枠の中の `│ ─── │` は行頭が │ なので当たらない */
const BORDER = /^─{20,}$/
/** 入力欄の記号の行(`❯ `・`! `・--screen-reader の `Start of Prompt Indicator`)。末尾の空白を除くと、空の入力欄は `❯` だけになる */
const SYMBOL_LINE = /^(?:❯(?:[ \xa0]|$)|! |Start of Prompt Indicator)/
/** 入力欄の 2 行目以降(2 桁の字下げ)か空行 */
const CONTINUATION = /^ {2}|^\s*$/

/** 入力欄の記号の種類(❯ は通常、! はシェルのモード、Start of Prompt Indicator は画面読み上げのモード) */
export type CopilotInputSymbol = 'prompt' | 'shell' | 'screen-reader'

/** 記号の行から除く、記号と区切り(記号の種類ごと。U+00A0 の区切りも除く) */
const SYMBOL_PREFIXES: Record<CopilotInputSymbol, RegExp> = {
  prompt: /^❯[ \xa0]?/,
  shell: /^! /,
  'screen-reader': /^Start of Prompt Indicator/
}
/** 入力欄の 2 行目以降の字下げ */
const CONTINUATION_INDENT = /^ {2}/
/**
 * 帯: 空の入力欄(`← open sidebar · / commands · ? help · tab next tab`。右にモデル名)。帯をつないだ文字列(band)にかける。60 列では
 * 2 行に折り返し、40 列では段組みで `← open     · / commands · ? help · tab` / `sidebar       next tab` に折り返す(段階 2a の台帳の idle40)ので、
 * `sidebar` の位置に依らない形にする
 */
const EMPTY_BAND = /^← open\b.*\/ commands\b/
/** 帯: 書きかけ(`@ files · # issues`)。帯をつないだ文字列(band)にかける */
const DRAFT_BAND = /^@ files · # issues/
/** 入力欄の 1 行目の畳みの形(11 行以上・20,480 バイト超) */
const FOLDED_PASTE = /^\[Paste #\d+ - \d+ lines\]/
const SAVED_PASTE = /^\[Saved pasted content to workspace \(/

/** 入力欄の位置・記号・行と帯 */
export interface CopilotInputBox {
  /** 上の罫線の行 */
  top: number
  /** 下の罫線の行 */
  bottom: number
  /** 記号の行の形(`❯ `・`! `・`Start of Prompt Indicator`) */
  symbol: CopilotInputSymbol
  /** 入力欄の各行の本文(記号の行は記号と区切りの後ろ、2 行目以降は 2 桁の字下げの後ろ。末尾の空白は除いてある) */
  rows: string[]
  /** 帯(下の罫線より下の行)の、前後の空白を除いた空でない行を空白 1 つでつないだ文字列(連続する空白は 1 つ)。40 列などで
   *  折り返した案内(`esc` / `interrupt`)も 1 つの文字列で見る */
  band: string
  /** 帯の空でない最初の行(前後の空白を除く)。帯が空なら null */
  bandHead: string | null
}

/**
 * 画面の行を、規則をかける文字列にする。アプリの画面の行は列の数まで空白で埋まり、台帳の行は右の空白を除いてある。どちらでも
 * 同じ結果にするため末尾の空白を除く(BORDER などの `$` は末尾の空白があると当たらない)
 */
export function copilotScreenTexts(lines: readonly ViewportLine[]): string[] {
  return lines.map((line) => lineText(line).trimEnd())
}

/** from から上へ、最初の全幅の罫線の行。無ければ null */
function findBorderAbove(texts: readonly string[], from: number): number | null {
  for (let y = from; y >= 0; y--) {
    if (BORDER.test(texts[y])) return y
  }
  return null
}

/** 記号の行(SYMBOL_LINE に当たる行)の記号の種類 */
function symbolOf(symbolLine: string): CopilotInputSymbol {
  if (symbolLine.startsWith('! ')) return 'shell'
  if (symbolLine.startsWith('Start of Prompt Indicator')) return 'screen-reader'
  return 'prompt'
}

/**
 * 画面の下から入力欄(上の罫線・記号の行・続きの行・下の罫線)を探す。上の罫線が見えない(入力欄が画面の高さを超えた)・
 * 罫線の間に行が無い・記号の行や続きの行の形が違う画面は、入力欄なし(null)
 */
export function locateCopilotInputBox(texts: readonly string[]): CopilotInputBox | null {
  const bottom = findBorderAbove(texts, texts.length - 1)
  if (bottom === null) return null
  const top = findBorderAbove(texts, bottom - 1)
  if (top === null || bottom - top < 2) return null
  if (!SYMBOL_LINE.test(texts[top + 1])) return null
  for (let y = top + 2; y < bottom; y++) {
    if (!CONTINUATION.test(texts[y])) return null
  }
  const symbol = symbolOf(texts[top + 1])
  const rows = [
    texts[top + 1].replace(SYMBOL_PREFIXES[symbol], ''),
    ...texts.slice(top + 2, bottom).map((text) => text.replace(CONTINUATION_INDENT, ''))
  ]
  const bandLines = texts
    .slice(bottom + 1)
    .map((text) => text.trim())
    .filter((text) => text !== '')
  return {
    top,
    bottom,
    symbol,
    rows,
    band: bandLines.join(' ').replace(/\s+/g, ' '),
    bandHead: bandLines[0] ?? null
  }
}

/**
 * 入力欄の状態。empty は送ってよい空、draft は書きかけ(空白だけ・改行だけを含む)、shell はシェルのモード、undetermined は
 * 空か書きかけかを決められない(一時的な帯など)、not-found は入力欄が無い
 */
export type CopilotInputState = 'empty' | 'draft' | 'shell' | 'undetermined' | 'not-found'

/** 入力欄の状態を読む(上から順に、最初に当てはまったもの。設計書「入力欄の特定と読み取り」の表) */
export function readCopilotInputState(lines: readonly ViewportLine[]): CopilotInputState {
  const box = locateCopilotInputBox(copilotScreenTexts(lines))
  // 確認・選択の画面・描き直しの途中
  if (box === null) return 'not-found'
  // シェルのモード(空は `! Execute shell command`、書きかけは `! echo hi`。記録の 5)
  if (box.symbol === 'shell') return 'shell'
  // 書きかけ(複数行・畳み・`/` の一覧の候補 `/add-dir` を含む)。一時的な帯の間でも文字は見える
  if (box.rows.some((row) => /\S/.test(row))) return 'draft'
  // 空白だけの書きかけ・改行だけの書きかけ(`❯` と帯 `@ files · # issues`。記録の 5)
  if (DRAFT_BAND.test(box.band)) return 'draft'
  // 空の入力欄(記録の 5。送った後・中断の後の入力欄も同じ)
  if (box.rows.length === 1 && EMPTY_BAND.test(box.band)) return 'empty'
  // 一時的な帯(記録の 6)・帯が空・入力欄が 2 行以上で文字が無いのに帯が書きかけの形でない、など
  return 'undetermined'
}

/** 前後の空白を除き、連続する空白(タブを含む)を 1 つにする */
const squeezeSpaces = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * 貼り付けた本文(text は実際に貼った本文。末尾の @ の語の後ろに足した空白を含む)が入力欄に現れたか。入力欄の 1 行目が畳みの形なら
 * 現れたとし、そうでなければ入力欄の空でない最後の行が本文のどれかの行に含まれれば現れたとする。最後の行で見るのは、入力欄の高さに
 * 上限があり、超えると先頭が見えなくなるため(記録の 7。最後の行は貼り付けの後のカーソルの行なので常に見える)。copilot は文字の
 * 単位で折り返すので、見えている行は本文の行の部分の文字列になる。送る直前に入力欄が空であることを確かめ、送る間は利用者の
 * キー入力を溜めているので、入力欄に現れた文字は貼り付けたものだけ(「最後の行が本文の一部」で足りる)
 */
export function isCopilotPasteEchoed(lines: readonly ViewportLine[], text: string): boolean {
  const box = locateCopilotInputBox(copilotScreenTexts(lines))
  if (box === null || box.symbol === 'shell') return false
  if (FOLDED_PASTE.test(box.rows[0]) || SAVED_PASTE.test(box.rows[0])) return true
  const lastRow = [...box.rows]
    .reverse()
    .map(squeezeSpaces)
    .find((row) => row !== '')
  if (lastRow === undefined) return false
  return text.split('\n').some((line) => squeezeSpaces(line).includes(lastRow))
}
```

`src/renderer/src/lib/copilotScreenActivity.ts` を直す（判定の結果は変えない）:

1. import を次にする（`lineText` の import は使わなくなるので消す）:

```ts
import type { AgentActivity } from './agentActivity'
import type { ViewportLine } from './agentViewport'
import { copilotScreenTexts, locateCopilotInputBox } from './copilotInputBox'
```

2. 冒頭のコメントの最後の行（`// dim・反転の属性は使わない(--screen-reader でも同じ文言が出るため)。例外は投げない`）の後に、次の 1 行を足す:

```ts
// 入力欄の特定(罫線・記号の行・続きの行と帯)は copilotInputBox.ts(段階 2b で送信の手順と共有するために切り出した)
```

3. 定数 `BORDER`・`SYMBOL_LINE`・`CONTINUATION`（とその JSDoc）、`interface CopilotInputBox`（`/** 入力欄の位置と帯(段階 2b で送信に使うときに copilotInputBox.ts へ切り出す) */` から閉じ括弧まで）、`function findBorderAbove`、`function locateCopilotInputBox`（とその JSDoc）を消す。`INTERRUPT_HINTS`・`BAND_SPINNER`・`SELECTION_HINT`・`PERMISSION_QUESTION`・`FRAME_PREFIX`・`DIALOG_TOP` と `hasPermissionQuestion` は残す
4. `classifyCopilotScreen` の最初の 3 行（コメント 2 行と `const texts = lines.map((line) => lineText(line).trimEnd())`）を次にする:

```ts
// アプリの画面の行は列の数まで空白で埋まり、台帳の行は右の空白を除いてある。どちらでも同じ判定にするため末尾の空白を除く
const texts = copilotScreenTexts(lines)
```

```bash
cd <repo-root>
grep -n "BORDER\|SYMBOL_LINE\|CONTINUATION\|findBorderAbove\|lineText\|interface CopilotInputBox" src/renderer/src/lib/copilotScreenActivity.ts
```

Expected: 何も出ない（移した定数・関数・型が残っていない）

- [ ] **Step 4: テストが通ることを確かめる（段階 2a の判定のテストも変えずに通る）**

Run: `npx vitest run src/renderer/src/lib/__tests__/copilotInputBox.test.ts src/renderer/src/lib/__tests__/copilotScreenActivity.test.ts src/renderer/src/lib/__tests__/agentScreenClassifiers.test.ts`
Expected: PASS

- [ ] **Step 5: 変異で確かめる**

1. `copilotInputBox.ts` の `readCopilotInputState` の `if (DRAFT_BAND.test(box.band)) return 'draft'` を一時的に消す → `spacesTyped`・`spacesPasted`・`newlinesPasted` の期待が落ちる（空白だけ・改行だけの書きかけを空と取り違える）。戻す
2. `if (box.rows.length === 1 && EMPTY_BAND.test(box.band)) return 'empty'` の `box.rows.length === 1 && ` を一時的に消す → 手書きの `入力欄が 2 行で文字が無い → undetermined` が落ちる。戻す
3. `isCopilotPasteEchoed` の `if (box === null || box.symbol === 'shell') return false` を `if (box === null) return false` にする → `shellDraft` の負の例（記号が `!`）が落ちる。戻す
4. `squeezeSpaces(line).includes(lastRow)` を `squeezeSpaces(line) === lastRow` にする → `long5000`・`inline20480`・`ja6800`・`tallPaste5000` の正の例が落ちる（折り返した行は本文の行の部分の文字列）。戻す
5. `grep -n "DRAFT_BAND.test(box.band)\|box.rows.length === 1 &&\|box.symbol === 'shell') return false\|includes(lastRow)" src/renderer/src/lib/copilotInputBox.ts` で 4 か所が元に戻っていることを確かめる（新規のファイルなので `git diff` には出ない）

- [ ] **Step 6: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/lib/copilotInputBox.ts src/renderer/src/lib/copilotScreenActivity.ts src/renderer/src/lib/__tests__/copilotInputBox.test.ts`
Expected: エラー・警告なし
Run: `npx prettier --check src/renderer/src/lib/copilotInputBox.ts src/renderer/src/lib/copilotScreenActivity.ts src/renderer/src/lib/__tests__/copilotInputBox.test.ts`
Expected: すべて整形済み（外れたら、そのファイルだけを `npx prettier --write <ファイル>` で直す）

---

### Task 3: 本文の検査と失敗の文言

> **設計書の読む節:** 「決めたこと（推奨案で決めた事項）」の「先頭の文字の見方」「文言」「送信前の確認のプレビュー」、「失敗の一覧」、「本文の検査」、「文言」、「テスト方針」の shared と renderer の文言・プレビュー・未保存の注意、`AgentSendConfirmDialog.test.tsx` の行。
>
> **気をつける知見:** L-597（文言に次の行動〈ターミナルで答える・抜ける・送るか消す・待つ〉と、消していない・`Enter` を送っていない・送り直していないことを入れる）・L-058（押せない理由と送った後の失敗が同じ原因なら同じ文。`screen-*` と活動の理由は同じ関数で作る）・L-593（CLI で文が違う失敗は種類の表で引き、種類の名前との比較を書かない）・L-083（先頭の文字は正規化〈制御文字の除去〉の後の本文で見る）・L-157・L-408（送信前の確認の連打の対策・押せないときのフォーカスは今のまま使う）

**Files:**

- Modify: `src/shared/agentPasteText.ts`・`src/renderer/src/lib/agentPromptSend.ts`（失敗の種類と、`normalizeAgentPrompt` に `'claude'` を渡す）・`src/renderer/src/lib/agentSendMessages.ts`・`src/renderer/src/lib/agentSendPreview.ts`・`src/renderer/src/lib/agentReferenceMessages.ts`・`src/renderer/src/types.ts`・`src/renderer/src/components/agent/AgentSendConfirmDialog.tsx`・`src/renderer/src/hooks/useAgentWorkspace.ts`（確認の状態に `cliKind` を写す）・`src/renderer/src/hooks/useAgentPromptSender.ts`（文言を種類で引く）
- Test: `src/shared/__tests__/agentPasteText.test.ts`・`src/renderer/src/lib/__tests__/agentSendMessages.test.ts`・`src/renderer/src/lib/__tests__/agentSendPreview.test.ts`・`src/renderer/src/lib/__tests__/agentReferenceMessages.test.ts`・`src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx`、型と表の名前の変更に追随: `src/renderer/src/components/agent/__tests__/AgentSendFeedbackAnnouncer.test.tsx`・`src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx`・`src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx`・`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`

**Interfaces:**

- Consumes: `AgentActivity`（`lib/agentActivity.ts`。既存）、`AGENT_CLI_PROFILES`・`AgentCliKind`（既存）
- Produces（Task 4〜6 が使う）:

```ts
// src/shared/agentPasteText.ts
export type AgentPromptRejection = 'empty' | 'too-long' | 'leading-bang' | 'leading-slash'
export const AGENT_PROMPT_TEXT_RULES: Record<AgentCliKind, AgentPromptTextRule>
export function normalizeAgentPrompt(raw: string, kind: AgentCliKind): NormalizedAgentPrompt

// src/renderer/src/lib/agentPromptSend.ts
export type AgentSendScreenFailure = `screen-${Exclude<AgentActivity, 'idle'>}`
export type AgentSendFailure =
  | AgentPromptRejection
  | 'not-accepting'
  | 'input-not-found'
  | 'clear-failed'
  | 'not-echoed'
  | 'unsupported-cli'
  | 'interrupting'
  | AgentSendScreenFailure
  | 'shell-mode'
  | 'draft-present'
  | 'input-undetermined'
  | 'not-confirmed'

// src/renderer/src/lib/agentSendMessages.ts
export const AGENT_SEND_BLOCKED_BY_ACTIVITY: Record<
  Exclude<AgentActivity, 'idle'>,
  (commandName: string) => string
>
export function agentSendBlockedByActivityReason(
  activity: Exclude<AgentActivity, 'idle'>,
  commandName: string
): string
export const RUN_DISABLED_INTERRUPTING: string
export interface AgentSendFailureKindTexts {
  leadingBang: (commandName: string) => string
  notEchoed: (commandName: string) => string
}
export const AGENT_SEND_FAILURE_KIND_TEXTS: Record<AgentCliKind, AgentSendFailureKindTexts>
export const AGENT_SEND_FAILURE_COMMON_TEXTS: Record<
  Exclude<AgentSendFailure, 'unsupported-cli' | 'leading-bang' | 'not-echoed'>,
  (commandName: string) => string
>
export function agentSendFailureMessage(reason: AgentSendFailure, kind: AgentCliKind): string

// src/renderer/src/lib/agentSendPreview.ts
export function buildAgentSendPreview(raw: string, cliKind: AgentCliKind): AgentSendPreview
// src/renderer/src/lib/agentReferenceMessages.ts
export const formatAgentUnsavedNotice: (paths: readonly string[], commandName: string) => string
// src/renderer/src/types.ts
interface AgentSendConfirmPending {
  /* 今の項目に */ cliKind: AgentCliKind
}
```

`AGENT_SEND_FAILURE_MESSAGES` は消す（共通の表と種類の表に分ける）。

- [ ] **Step 1: 失敗するテストを書く（本文の検査）**

`src/shared/__tests__/agentPasteText.test.ts` の今の `normalizeAgentPrompt(…)` の呼び出しに、種類 `'claude'` を足す（結果は今と同じ。ASCII のパターンの置き換え）:

```bash
cd <repo-root>
perl -pi -e "s/normalizeAgentPrompt\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/normalizeAgentPrompt(\$1, 'claude')/g" src/shared/__tests__/agentPasteText.test.ts
grep -c "normalizeAgentPrompt(.*'claude')" src/shared/__tests__/agentPasteText.test.ts
```

Expected: `8`（`normalizeAgentPrompt('a'.repeat(AGENT_PROMPT_MAX_LENGTH), 'claude')` のように入れ子の括弧の外に足される。`git diff` で確かめる）

同じファイルの `describe('normalizeAgentPrompt', () => {` の閉じ括弧（`describe('buildAgentPasteBytes'` の前の `})`）の後に、空行を 1 つ置いて次を足す:

```ts
describe('normalizeAgentPrompt(種類ごとの規則。AGENT_PROMPT_TEXT_RULES)', () => {
  it.each([
    ['先頭が「!」', '!ls', 'leading-bang'],
    ['先頭が「/」', '/help', 'leading-slash'],
    ['先頭の空白の後の「!」', '  !ls', 'leading-bang'],
    ['先頭の空白の後の「/」', '  /help', 'leading-slash'],
    ['制御文字を除いた後に先頭へ来る「!」(L-083)', '\x1b!ls', 'leading-bang']
  ] as const)('copilot: %s は断る', (_label, raw, reason) => {
    expect(normalizeAgentPrompt(raw, 'copilot')).toEqual({ kind: 'rejected', reason })
  })

  it.each([
    'x!ls',
    'run /help',
    '?why',
    '# heading',
    'fix #12',
    'say hi!',
    'look at @file',
    '@',
    '本文\n\n参照:\n- @src/app.ts'
  ])('copilot: %j は通す(行の途中の !・/、末尾の @ の語は断らない)', (raw) => {
    expect(normalizeAgentPrompt(raw, 'copilot')).toEqual({ kind: 'ok', text: raw })
  })

  it('claude は今までどおり 1 文字目の「!」だけを断り、「/」・先頭の空白の後の「!」は通す', () => {
    expect(normalizeAgentPrompt('/help', 'claude')).toEqual({ kind: 'ok', text: '/help' })
    expect(normalizeAgentPrompt('  !ls', 'claude')).toEqual({ kind: 'ok', text: '  !ls' })
    expect(normalizeAgentPrompt('!ls', 'claude')).toEqual({
      kind: 'rejected',
      reason: 'leading-bang'
    })
  })

  it('判定の順は 空 → 長すぎる → 種類の規則(先頭が「/」でも空白だけ・長すぎるならそちら)', () => {
    expect(normalizeAgentPrompt('  \n', 'copilot')).toEqual({ kind: 'rejected', reason: 'empty' })
    expect(normalizeAgentPrompt('/' + 'a'.repeat(AGENT_PROMPT_MAX_LENGTH), 'copilot')).toEqual({
      kind: 'rejected',
      reason: 'too-long'
    })
  })
})
```

- [ ] **Step 2: 失敗するテストを書く（失敗の文言・プレビュー・未保存の注意・確認のダイアログ）**

1. `src/renderer/src/lib/__tests__/agentSendMessages.test.ts`:
   - import の `AGENT_SEND_FAILURE_MESSAGES,` を消し、同じ import に `AGENT_SEND_FAILURE_COMMON_TEXTS,`・`RUN_DISABLED_INTERRUPTING,`・`agentSendBlockedByActivityReason,` を足す（並びは今の並びに合わせてアルファベット順）。`import type { AgentSendFailure } from '../agentPromptSend'` を足す
   - `describe('送信の失敗の文言(agentSendFailureMessage)', () => {` から、そのブロックの閉じ括弧までを次に置き換える:

```ts
describe('送信の失敗の文言(agentSendFailureMessage)', () => {
  it('unsupported-cli は実行ボタンの理由と同じ関数の文言', () => {
    expect(agentSendFailureMessage('unsupported-cli', 'copilot')).toBe(
      agentPromptSendUnsupportedReason('copilot')
    )
  })

  it.each<[AgentSendFailure, string]>([
    ['empty', '送信する内容がありません'],
    ['too-long', 'プロンプトが長すぎます'],
    [
      'leading-bang',
      '先頭が「!」のプロンプトは、エージェントのシェルのコマンドとして実行されるため送信できません（先頭に空白を入れると送れます）'
    ],
    ['not-accepting', 'エージェントが入力を受け付けていません'],
    [
      'input-not-found',
      'エージェントの入力欄が見つかりません。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください'
    ],
    [
      'clear-failed',
      'エージェントの入力欄を空にできませんでした。ターミナルで入力欄を確かめてから、もう一度実行してください'
    ],
    [
      'not-echoed',
      'エージェントの入力欄に入りませんでした。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください'
    ]
  ])('claude の %s は段階 2b の前と 1 文字も変わらない', (reason, text) => {
    expect(agentSendFailureMessage(reason, 'claude')).toBe(text)
  })

  it.each<[AgentSendFailure, string]>([
    [
      'leading-bang',
      '先頭（空白を除く）が「!」のプロンプトは、copilot のシェルのコマンドとして実行されるため送信できません（先頭に「!」以外の文字を足すと送れます）'
    ],
    [
      'not-echoed',
      'copilot の入力欄に本文が入ったか確かめられなかったため、Enter を送りませんでした。ターミナルの画面を確かめてください（入力欄に本文が入っていれば、送るか消してください）'
    ],
    [
      'leading-slash',
      '先頭（空白を除く）が「/」のプロンプトは、copilot のスラッシュコマンドとして実行されるため送信できません（先頭に「/」以外の文字を足すと送れます）'
    ],
    [
      'interrupting',
      '中断を送ったばかりのため送信できません（1 秒ほど待ってから、もう一度実行してください）'
    ],
    [
      'screen-working',
      'copilot が作業中のため送信できません（作業が終わって入力待ちになってから、もう一度実行してください）'
    ],
    [
      'screen-permission',
      'copilot が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）'
    ],
    [
      'screen-confirm',
      'copilot が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）'
    ],
    [
      'screen-unknown',
      'copilot が入力待ちか判定できないため送信できません（ターミナルの画面を確かめてから、もう一度実行してください）'
    ],
    [
      'shell-mode',
      'copilot がシェルのモードのため送信できません（ターミナルでシェルのモードを抜けてから、もう一度実行してください）'
    ],
    [
      'draft-present',
      'copilot の入力欄に書きかけがあるため送信できません（書きかけは消していません。ターミナルで送るか消してから、もう一度実行してください）'
    ],
    [
      'input-undetermined',
      'copilot の入力欄が空か確かめられなかったため送信できません（ターミナルの画面を確かめてから、もう一度実行してください）'
    ],
    [
      'not-confirmed',
      'copilot に送れたか確かめられませんでした。ターミナルの画面を確かめてください（入力欄に本文が残っていれば、送るか消してください）'
    ]
  ])('copilot の %s', (reason, text) => {
    expect(agentSendFailureMessage(reason, 'copilot')).toBe(text)
  })

  it('screen-* の失敗は、押せない理由(agentSendBlockedByActivityReason)と同じ文(L-058)', () => {
    for (const activity of ['working', 'permission', 'confirm', 'unknown'] as const) {
      expect(agentSendFailureMessage(`screen-${activity}`, 'copilot')).toBe(
        agentSendBlockedByActivityReason(activity, 'copilot')
      )
    }
  })

  it('interrupting の失敗は、押せない理由 RUN_DISABLED_INTERRUPTING と同じ文', () => {
    expect(agentSendFailureMessage('interrupting', 'copilot')).toBe(RUN_DISABLED_INTERRUPTING)
  })

  it('共通の表は、CLI で文が違う失敗(unsupported-cli・leading-bang・not-echoed)を持たない', () => {
    const keys = Object.keys(AGENT_SEND_FAILURE_COMMON_TEXTS)
    for (const reason of ['unsupported-cli', 'leading-bang', 'not-echoed']) {
      expect(keys).not.toContain(reason)
    }
  })
})

describe('送り先のタブの活動の理由(agentSendBlockedByActivityReason)', () => {
  it.each([
    [
      'working',
      'copilot が作業中のため送信できません（作業が終わって入力待ちになってから、もう一度実行してください）'
    ],
    [
      'permission',
      'copilot が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）'
    ],
    [
      'confirm',
      'copilot が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）'
    ],
    [
      'unknown',
      'copilot が入力待ちか判定できないため送信できません（ターミナルの画面を確かめてから、もう一度実行してください）'
    ]
  ] as const)('%s', (activity, text) => {
    expect(agentSendBlockedByActivityReason(activity, 'copilot')).toBe(text)
  })

  it('中断の流れの間の理由', () => {
    expect(RUN_DISABLED_INTERRUPTING).toBe(
      '中断を送ったばかりのため送信できません（1 秒ほど待ってから、もう一度実行してください）'
    )
  })
})
```

2. `src/renderer/src/lib/__tests__/agentSendPreview.test.ts` を次にする（今のテストは種類 `'claude'` を渡して同じ結果、`copilot` のテストを足す）:

```ts
import { describe, it, expect } from 'vitest'
import { AGENT_PROMPT_MAX_LENGTH } from '@shared/agentPasteText'
import { agentSendFailureMessage } from '../agentSendMessages'
import { buildAgentSendPreview } from '../agentSendPreview'

describe('buildAgentSendPreview', () => {
  it('正規化した後の本文と長さを返し、送れる(理由は null)', () => {
    expect(buildAgentSendPreview('a\r\nb\x1b', 'claude')).toEqual({
      text: 'a\nb',
      length: 3,
      rejection: null
    })
  })

  it.each([
    ['空', '', 'empty'],
    ['空白と改行だけ', '  \n\t', 'empty'],
    ['先頭が「!」', '!ls', 'leading-bang'],
    ['制御文字を除くと先頭が「!」', '\x1b!rm', 'leading-bang']
  ] as const)('%s なら、既存の文言を理由にする', (_label, raw, reason) => {
    expect(buildAgentSendPreview(raw, 'claude').rejection).toBe(
      agentSendFailureMessage(reason, 'claude')
    )
  })

  it('先頭が「!」でも、正規化した後の本文と長さを返す', () => {
    const preview = buildAgentSendPreview('!ls\r\n', 'claude')
    expect(preview.text).toBe('!ls\n')
    expect(preview.length).toBe(4)
  })

  it('正規化した後の長さが上限ちょうどなら送れる(\\r\\n は 1 文字に数える)', () => {
    const preview = buildAgentSendPreview(
      'a'.repeat(AGENT_PROMPT_MAX_LENGTH - 1) + '\r\n',
      'claude'
    )
    expect(preview.length).toBe(AGENT_PROMPT_MAX_LENGTH)
    expect(preview.rejection).toBeNull()
  })

  it('正規化した後の長さが上限を超えたら長すぎる(長さも返す)', () => {
    const preview = buildAgentSendPreview('a'.repeat(AGENT_PROMPT_MAX_LENGTH) + '\r\n', 'claude')
    expect(preview.length).toBe(AGENT_PROMPT_MAX_LENGTH + 1)
    expect(preview.rejection).toBe(agentSendFailureMessage('too-long', 'claude'))
  })
})

describe('buildAgentSendPreview(送り先が copilot)', () => {
  it.each([
    ['/help', 'leading-slash'],
    ['  /help', 'leading-slash'],
    ['!ls', 'leading-bang']
  ] as const)('%j は copilot の理由を出す', (raw, reason) => {
    expect(buildAgentSendPreview(raw, 'copilot').rejection).toBe(
      agentSendFailureMessage(reason, 'copilot')
    )
  })

  it.each(['look at @file', '本文\n\n参照:\n- @src/app.ts'])(
    '%j は理由を出さない(末尾の @ の語は送れる)',
    (raw) => {
      expect(buildAgentSendPreview(raw, 'copilot').rejection).toBeNull()
    }
  )

  it('claude の送り先なら /help は今までどおり送れる', () => {
    expect(buildAgentSendPreview('/help', 'claude').rejection).toBeNull()
  })
})
```

3. `src/renderer/src/lib/__tests__/agentReferenceMessages.test.ts` の `describe('formatAgentUnsavedNotice', () => {` のブロックを次に置き換える:

```ts
describe('formatAgentUnsavedNotice', () => {
  it('複数のパスを「、」で区切って並べる', () => {
    expect(formatAgentUnsavedNotice(['src/app.ts', 'docs/a.md'], 'claude')).toBe(
      '未保存の変更があるファイルは、保存するまで claude に見えません: src/app.ts、docs/a.md'
    )
  })

  it('1 つだけのときは区切りを入れない', () => {
    expect(formatAgentUnsavedNotice(['src/app.ts'], 'claude')).toBe(
      '未保存の変更があるファイルは、保存するまで claude に見えません: src/app.ts'
    )
  })

  it('CLI の名前は送り先の種類のコマンド名で作る', () => {
    expect(formatAgentUnsavedNotice(['src/app.ts'], 'copilot')).toBe(
      '未保存の変更があるファイルは、保存するまで copilot に見えません: src/app.ts'
    )
  })
})
```

4. `src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx`:
   - `AGENT_SEND_FAILURE_MESSAGES` を `agentSendFailureMessage(…, 'claude')` に置き換える（ASCII のパターン）:

```bash
cd <repo-root>
set -- src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx src/renderer/src/components/agent/__tests__/AgentSendFeedbackAnnouncer.test.tsx src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx
perl -pi -e "s/AGENT_SEND_FAILURE_MESSAGES\[([^\]]+)\]/agentSendFailureMessage(\$1, 'claude')/g; s/AGENT_SEND_FAILURE_MESSAGES\.(\w+)/agentSendFailureMessage('\$1', 'claude')/g; s/\bAGENT_SEND_FAILURE_MESSAGES\b/agentSendFailureMessage/g" "$@"
grep -n "AGENT_SEND_FAILURE_MESSAGES" "$@"
grep -c "agentSendFailureMessage" "$@"
```

Expected: 1 つ目の `grep` は何も出ない。2 つ目は各ファイルで 1 以上（import の行が `agentSendFailureMessage` に変わり、参照が関数の呼び出しになる）

- `makePending` の既定に `cliKind: 'claude',` を足す（`label: 'claude 2',` の次の行）
- `describe('送れない理由', () => {` のブロックの閉じ括弧の後（`describe('操作', () => {` の前）に、次を足す:

```tsx
describe('送り先の種類(確認を開いた時点に控えた送り先の CLI)', () => {
  it('送り先が copilot なら、/help で送信を押せず copilot の理由を出す', () => {
    render(
      <AgentSendConfirmDialog
        state={makeState({
          pending: makePending({ text: '/help', label: 'copilot 1', cliKind: 'copilot' })
        })}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      agentSendFailureMessage('leading-slash', 'copilot')
    )
    expect(submitButton()).toBeDisabled()
  })

  it('送り先が claude なら、/help は今までどおり送れる', () => {
    render(
      <AgentSendConfirmDialog state={makeState({ pending: makePending({ text: '/help' }) })} />
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(submitButton()).not.toBeDisabled()
  })

  it('未保存の注意は送り先の CLI の名前で出す', () => {
    render(
      <AgentSendConfirmDialog
        state={makeState({
          pending: makePending({
            label: 'copilot 1',
            cliKind: 'copilot',
            unsavedPaths: ['src/app.ts']
          })
        })}
      />
    )
    expect(
      screen.getByText(
        '未保存の変更があるファイルは、保存するまで copilot に見えません: src/app.ts'
      )
    ).toBeInTheDocument()
  })
})
```

5. 確認の状態を組み立てるテストの値に `cliKind: 'claude'` を足す（型が必須になるため）:
   - `src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx` の 2 か所と `src/renderer/src/hooks/__tests__/useAppState.agent.test.ts` の 1 か所の `pending: {` の中の `label: 'claude 1',` の次の行に `cliKind: 'claude',` を足す
   - `src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` の `expect(result.current.agentSendConfirmDialog.pending).toEqual({`（`text: 'hello', slotId: 'slot-2', label: 'claude 2', promptId: 'p1', unsavedPaths: []`）の `label: 'claude 2',` の次の行に `cliKind: 'claude',` を足す

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/shared/__tests__/agentPasteText.test.ts src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/lib/__tests__/agentSendPreview.test.ts src/renderer/src/lib/__tests__/agentReferenceMessages.test.ts src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx`
Expected: FAIL（`copilot` の規則が無い・`agentSendBlockedByActivityReason`・`RUN_DISABLED_INTERRUPTING`・`AGENT_SEND_FAILURE_COMMON_TEXTS` が無い・未保存の注意が `claude` のまま・確認のダイアログが `/help` を断らない）

- [ ] **Step 4: 本文の検査を種類ごとの表にする**

`src/shared/agentPasteText.ts`:

1. 冒頭のコメント `// claude の入力欄へ送る本文の正規化と、送るバイト列(設計書「プロンプトの送信」3・7・9)。純粋関数と定数` を次にし、その下に import を足す:

```ts
// エージェント CLI の入力欄へ送る本文の正規化と、送るバイト列(設計書「プロンプトの送信」3・7・9、2026-10-22「本文の検査」)。純粋関数と定数
import type { AgentCliKind } from './agentCliKinds'
```

2. `export type AgentPromptRejection = 'empty' | 'too-long' | 'leading-bang'` を次にする:

```ts
export type AgentPromptRejection = 'empty' | 'too-long' | 'leading-bang' | 'leading-slash'
```

3. `normalizeAgentPrompt` の JSDoc と関数を次に置き換える:

```ts
/** 正規化の後の本文を CLI ごとに断る規則(空・長すぎるの後にかける)。送信の手順の表は renderer の agentPromptSendSpecs.ts */
type AgentPromptTextRule = (text: string) => AgentPromptRejection | null

export const AGENT_PROMPT_TEXT_RULES: Record<AgentCliKind, AgentPromptTextRule> = {
  // 「!」で始まる本文は claude のシェルのモードに入る(確認の結果 23。今までどおり 1 文字目だけを見る)
  claude: (text) => (text.startsWith('!') ? 'leading-bang' : null),
  // copilot 1.0.87: 先頭の ! はシェルの実行、先頭の / はスラッシュコマンドの実行(段階 2b の追加の記録)。先頭の空白の後は記録していないので、
  // 空白を除いた最初の文字で見る。末尾の @ の語は断らず、copilotPromptSend.ts の buildCopilotPasteText が空白を足す
  copilot: (text) => {
    const head = text.trimStart()
    if (head.startsWith('!')) return 'leading-bang'
    if (head.startsWith('/')) return 'leading-slash'
    return null
  }
}

/**
 * 本文を正規化する。\r\n・\r を \n に統一し、制御文字を取り除く。前後の空白だけ・上限を超える・送り先の CLI の規則
 * (AGENT_PROMPT_TEXT_RULES)に当たるなら拒否する。判定は正規化の後に行う(除去の後に先頭へ来る「!」を見逃さない。L-083)。
 * 種類は省略できない(L-060)
 */
export function normalizeAgentPrompt(raw: string, kind: AgentCliKind): NormalizedAgentPrompt {
  const text = cleanAgentPromptText(raw)
  if (text.trim() === '') return { kind: 'rejected', reason: 'empty' }
  if (text.length > AGENT_PROMPT_MAX_LENGTH) return { kind: 'rejected', reason: 'too-long' }
  const rejection = AGENT_PROMPT_TEXT_RULES[kind](text)
  if (rejection !== null) return { kind: 'rejected', reason: rejection }
  return { kind: 'ok', text }
}
```

- [ ] **Step 5: 失敗の種類を足し、`claude` の手順に種類を渡す**

`src/renderer/src/lib/agentPromptSend.ts`:

1. import に `import type { AgentActivity } from './agentActivity'` を足す（`import type { ViewportLine } from './agentViewport'` の前）
2. `normalizeAgentPrompt(rawText)` を `normalizeAgentPrompt(rawText, 'claude')` にする
3. `export type AgentSendFailure =` から `| 'unsupported-cli'` の行までを次に置き換える:

```ts
/** 送り先の画面の活動が入力待ちでない(copilot の手順 3)。活動を足したときの決め忘れを型エラーにする */
export type AgentSendScreenFailure = `screen-${Exclude<AgentActivity, 'idle'>}`

export type AgentSendFailure =
  | AgentPromptRejection
  | 'not-accepting'
  | 'input-not-found'
  | 'clear-failed'
  | 'not-echoed'
  /** 送り先の CLI が送信に対応していない(useAgentPromptSender.send の先頭の守り。手順は返さない) */
  | 'unsupported-cli'
  /** 送り先のタブが中断の流れの間(useAgentPromptSender.send の先頭の守り。手順は返さない) */
  | 'interrupting'
  | AgentSendScreenFailure
  /** シェルのモード(copilot の手順 3) */
  | 'shell-mode'
  /** 入力欄に書きかけがある(copilot の手順 3。書きかけは消していない) */
  | 'draft-present'
  /** 上限まで入力欄が空か書きかけかを決められなかった(copilot の手順 3) */
  | 'input-undetermined'
  /** Enter の後に送れたことを確かめられなかった(copilot の手順 7。Enter は送り直していない) */
  | 'not-confirmed'
```

- [ ] **Step 6: 失敗の文言の表と活動の理由を書く**

`src/renderer/src/lib/agentSendMessages.ts`:

1. import に `import type { AgentActivity } from './agentActivity'` を足す（`import type { AgentSendFailure } from './agentPromptSend'` の前）
2. 冒頭のコメント `// プロンプトの送信の文言(設計書「プロンプトの送信」「セッションが無いときのボタン」「エラー処理」)` から `agentSendFailureMessage` の関数の閉じ括弧まで（`AGENT_SEND_FAILURE_MESSAGES` の表を含む）を次に置き換える:

```ts
// プロンプトの送信の文言(設計書「プロンプトの送信」「セッションが無いときのボタン」「エラー処理」、2026-10-22「文言」)。
// claude の文言は段階 2b で 1 文字も変えていない。CLI で文が違う失敗は種類の表(AGENT_SEND_FAILURE_KIND_TEXTS)、ほかは CLI に
// 依らない共通の表(AGENT_SEND_FAILURE_COMMON_TEXTS)で、CLI の名前は AGENT_CLI_PROFILES[kind].commandName から作る。
// 文言には次の行動(待つ・答える・抜ける・送るか消す)と、消していない・Enter を送っていない・送り直していないことを入れる(L-597)

/** 送り先のタブの活動が入力待ちでないときの理由。押せない理由と送った後の失敗(screen-*)で同じ文にする(L-058)。活動を足したときの決め忘れを型エラーにする */
export const AGENT_SEND_BLOCKED_BY_ACTIVITY: Record<
  Exclude<AgentActivity, 'idle'>,
  (commandName: string) => string
> = {
  working: (commandName) =>
    `${commandName} が作業中のため送信できません（作業が終わって入力待ちになってから、もう一度実行してください）`,
  permission: (commandName) =>
    `${commandName} が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）`,
  confirm: (commandName) =>
    `${commandName} が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）`,
  unknown: (commandName) =>
    `${commandName} が入力待ちか判定できないため送信できません（ターミナルの画面を確かめてから、もう一度実行してください）`
}

/** 実行・再実行・送信前の確認の押せない理由と、send の screen-* の文言(送り先のタブの活動が入力待ちでない) */
export function agentSendBlockedByActivityReason(
  activity: Exclude<AgentActivity, 'idle'>,
  commandName: string
): string {
  return AGENT_SEND_BLOCKED_BY_ACTIVITY[activity](commandName)
}

/**
 * 送り先のタブが中断の流れの間(1 回目を送ってから 2 回目の流れが終わり、1,000ms の待ちが明けるまで)の、実行・再実行・送信前の
 * 確認の押せない理由と、send の interrupting の文言
 */
export const RUN_DISABLED_INTERRUPTING =
  '中断を送ったばかりのため送信できません（1 秒ほど待ってから、もう一度実行してください）'

/** CLI で文が違う失敗の文言 */
export interface AgentSendFailureKindTexts {
  /** 先頭が「!」(leading-bang) */
  leadingBang: (commandName: string) => string
  /** 本文が入力欄に入ったかを確かめられなかった(not-echoed) */
  notEchoed: (commandName: string) => string
}

export const AGENT_SEND_FAILURE_KIND_TEXTS: Record<AgentCliKind, AgentSendFailureKindTexts> = {
  claude: {
    leadingBang: () =>
      '先頭が「!」のプロンプトは、エージェントのシェルのコマンドとして実行されるため送信できません（先頭に空白を入れると送れます）',
    notEchoed: () =>
      'エージェントの入力欄に入りませんでした。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください'
  },
  // copilot は先頭の空白の後の ! も断る(先頭に空白を入れる案内はしない)。not-echoed のときは Enter を送っておらず、本文が入力欄に
  // 残りうる
  copilot: {
    leadingBang: (commandName) =>
      `先頭（空白を除く）が「!」のプロンプトは、${commandName} のシェルのコマンドとして実行されるため送信できません（先頭に「!」以外の文字を足すと送れます）`,
    notEchoed: (commandName) =>
      `${commandName} の入力欄に本文が入ったか確かめられなかったため、Enter を送りませんでした。ターミナルの画面を確かめてください（入力欄に本文が入っていれば、送るか消してください）`
  }
}

/** CLI に依らない失敗の文言。CLI で文が違う失敗(種類の表)と unsupported-cli(関数)は持たない。種類を足したときの決め忘れを型エラーにする */
export const AGENT_SEND_FAILURE_COMMON_TEXTS: Record<
  Exclude<AgentSendFailure, 'unsupported-cli' | 'leading-bang' | 'not-echoed'>,
  (commandName: string) => string
> = {
  empty: () => '送信する内容がありません',
  'too-long': () => 'プロンプトが長すぎます',
  'leading-slash': (commandName) =>
    `先頭（空白を除く）が「/」のプロンプトは、${commandName} のスラッシュコマンドとして実行されるため送信できません（先頭に「/」以外の文字を足すと送れます）`,
  'not-accepting': () => 'エージェントが入力を受け付けていません',
  'input-not-found': () =>
    'エージェントの入力欄が見つかりません。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください',
  'clear-failed': () =>
    'エージェントの入力欄を空にできませんでした。ターミナルで入力欄を確かめてから、もう一度実行してください',
  interrupting: () => RUN_DISABLED_INTERRUPTING,
  'screen-working': (commandName) => agentSendBlockedByActivityReason('working', commandName),
  'screen-permission': (commandName) => agentSendBlockedByActivityReason('permission', commandName),
  'screen-confirm': (commandName) => agentSendBlockedByActivityReason('confirm', commandName),
  'screen-unknown': (commandName) => agentSendBlockedByActivityReason('unknown', commandName),
  'shell-mode': (commandName) =>
    `${commandName} がシェルのモードのため送信できません（ターミナルでシェルのモードを抜けてから、もう一度実行してください）`,
  'draft-present': (commandName) =>
    `${commandName} の入力欄に書きかけがあるため送信できません（書きかけは消していません。ターミナルで送るか消してから、もう一度実行してください）`,
  'input-undetermined': (commandName) =>
    `${commandName} の入力欄が空か確かめられなかったため送信できません（ターミナルの画面を確かめてから、もう一度実行してください）`,
  'not-confirmed': (commandName) =>
    `${commandName} に送れたか確かめられませんでした。ターミナルの画面を確かめてください（入力欄に本文が残っていれば、送るか消してください）`
}

/**
 * 送信の失敗の文言。送り先の CLI の種類で引く(kind は省略できない。L-060)。unsupported-cli は実行ボタンの理由と同じ関数、
 * leading-bang・not-echoed は種類の表、ほかは共通の表
 */
export function agentSendFailureMessage(reason: AgentSendFailure, kind: AgentCliKind): string {
  const { commandName } = AGENT_CLI_PROFILES[kind]
  switch (reason) {
    case 'unsupported-cli':
      return agentPromptSendUnsupportedReason(commandName)
    case 'leading-bang':
      return AGENT_SEND_FAILURE_KIND_TEXTS[kind].leadingBang(commandName)
    case 'not-echoed':
      return AGENT_SEND_FAILURE_KIND_TEXTS[kind].notEchoed(commandName)
    default:
      return AGENT_SEND_FAILURE_COMMON_TEXTS[reason](commandName)
  }
}
```

- [ ] **Step 7: プレビュー・未保存の注意・確認のダイアログ・送信の文言の呼び出しを種類で引く**

1. `src/renderer/src/lib/agentSendPreview.ts` を次にする:

```ts
import { cleanAgentPromptText, normalizeAgentPrompt } from '@shared/agentPasteText'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { agentSendFailureMessage } from './agentSendMessages'

// 送信前の確認のダイアログに出す値(設計書「ダイアログ」)。本文と文字数は送るときと同じ正規化の後の値。送れない理由は送る前の
// 検査(normalizeAgentPrompt)の結果から、送った後の失敗と同じ文言を引く。規則と文言は確認を開いた時点に控えた送り先の種類で引く
// (設計書 2026-10-22「送信前の確認のプレビュー」。copilot の送り先では /help も開いた時点で送信が押せない)

export interface AgentSendPreview {
  /** 正規化した後の本文(改行の統一・制御文字の除去。送れないときも) */
  text: string
  /** 正規化した後の長さ(上限の判定と同じ基準) */
  length: number
  /** 送れない理由の文言(空・長すぎる・先頭の文字)。送れるなら null */
  rejection: string | null
}

export function buildAgentSendPreview(raw: string, cliKind: AgentCliKind): AgentSendPreview {
  const text = cleanAgentPromptText(raw)
  const normalized = normalizeAgentPrompt(raw, cliKind)
  return {
    text,
    length: text.length,
    rejection:
      normalized.kind === 'rejected' ? agentSendFailureMessage(normalized.reason, cliKind) : null
  }
}
```

2. `src/renderer/src/lib/agentReferenceMessages.ts` の最後の 3 行（未保存の注意）を次にする:

```ts
/** 送信前の確認のダイアログの未保存の注意(パスは表示用の相対パス。CLI の名前は送り先の種類のコマンド名) */
export const formatAgentUnsavedNotice = (paths: readonly string[], commandName: string): string =>
  `未保存の変更があるファイルは、保存するまで ${commandName} に見えません: ${paths.join('、')}`
```

3. `src/renderer/src/types.ts` の `AgentSendConfirmPending` の `label: string` の次に足す（ファイルの先頭の import に `import type { AgentCliKind } from '@shared/agentCliKinds'` が無ければ足す）:

```ts
/** 送り先のタブの CLI の種類(開いた時点で固定。本文の規則・送れない理由・未保存の注意の CLI の名前に使う) */
cliKind: AgentCliKind
```

4. `src/renderer/src/components/agent/AgentSendConfirmDialog.tsx`:
   - import に `import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'` を足す（`import type { AgentSendConfirmDialogState, …` の前）
   - `const preview = useMemo(() => buildAgentSendPreview(pending.text), [pending.text])` を次にする:

```tsx
// 本文は最大 20 万字になりうるため、描画のたびに正規化し直さない。規則は開いた時点に控えた送り先の種類で引く
const preview = useMemo(
  () => buildAgentSendPreview(pending.text, pending.cliKind),
  [pending.text, pending.cliKind]
)
```

（直前の 1 行のコメント `// 本文は最大 20 万字になりうるため、描画のたびに正規化し直さない` は上のコメントに置き換わるので消す）

- `{formatAgentUnsavedNotice(pending.unsavedPaths)}` を `{formatAgentUnsavedNotice(pending.unsavedPaths, AGENT_CLI_PROFILES[pending.cliKind].commandName)}` にする

5. `src/renderer/src/hooks/useAgentWorkspace.ts` の `agentSendConfirmDialog` の `pending` の組み立て（`label: pendingSend.label,` の次の行）に `cliKind: pendingSend.target.cliKind,` を足す

6. `src/renderer/src/hooks/useAgentPromptSender.ts` の `agentSendFailureMessage` の 2 つの呼び出しを種類で引く:
   - `agentSendFailureMessage('unsupported-cli', AGENT_CLI_PROFILES[target.cliKind].commandName)` を `agentSendFailureMessage('unsupported-cli', target.cliKind)` にする
   - `agentSendFailureMessage(outcome.reason, AGENT_CLI_PROFILES[target.cliKind].commandName)` を `agentSendFailureMessage(outcome.reason, target.cliKind)` にする
   - `AGENT_CLI_PROFILES` を使わなくなったら import から外す（`import { agentCliCapabilities } from '@shared/agentCliKinds'`）

- [ ] **Step 8: テストが通ることを確かめる**

```bash
cd <repo-root>
npx prettier --write src/shared/agentPasteText.ts src/renderer/src/lib/agentPromptSend.ts src/renderer/src/lib/agentSendMessages.ts src/renderer/src/lib/agentSendPreview.ts src/renderer/src/lib/agentReferenceMessages.ts src/renderer/src/types.ts src/renderer/src/components/agent/AgentSendConfirmDialog.tsx src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/hooks/useAgentPromptSender.ts src/shared/__tests__/agentPasteText.test.ts src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/lib/__tests__/agentSendPreview.test.ts src/renderer/src/lib/__tests__/agentReferenceMessages.test.ts src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx src/renderer/src/components/agent/__tests__/AgentSendFeedbackAnnouncer.test.tsx src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts
npx vitest run src/shared/__tests__/agentPasteText.test.ts src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/lib/__tests__/agentSendPreview.test.ts src/renderer/src/lib/__tests__/agentReferenceMessages.test.ts src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx src/renderer/src/components/agent/__tests__/AgentSendFeedbackAnnouncer.test.tsx src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/lib/__tests__/agentPromptSend.test.ts
```

Expected: PASS

- [ ] **Step 9: 変異で確かめる**

1. `AGENT_PROMPT_TEXT_RULES.copilot` の `const head = text.trimStart()` を `const head = text` にする → `先頭の空白の後の「!」`・`先頭の空白の後の「/」` が落ちる。戻す
2. `AgentSendConfirmDialog.tsx` の `buildAgentSendPreview(pending.text, pending.cliKind)` を `buildAgentSendPreview(pending.text, 'claude')` にする → `送り先が copilot なら、/help で送信を押せず…` が落ちる。戻す
3. `git diff src/shared/agentPasteText.ts src/renderer/src/components/agent/AgentSendConfirmDialog.tsx | grep -c "trimStart\|pending.cliKind"` で戻したことを確かめる（2 以上）

- [ ] **Step 10: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/shared/agentPasteText.ts src/renderer/src/lib/agentPromptSend.ts src/renderer/src/lib/agentSendMessages.ts src/renderer/src/lib/agentSendPreview.ts src/renderer/src/lib/agentReferenceMessages.ts src/renderer/src/types.ts src/renderer/src/components/agent/AgentSendConfirmDialog.tsx src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/hooks/useAgentPromptSender.ts src/shared/__tests__/agentPasteText.test.ts src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/lib/__tests__/agentSendPreview.test.ts src/renderer/src/lib/__tests__/agentReferenceMessages.test.ts src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx src/renderer/src/components/agent/__tests__/AgentSendFeedbackAnnouncer.test.tsx src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`
Expected: エラー・警告なし
Run: 上と同じファイルへ `npx prettier --check`（外れたら、そのファイルだけを `npx prettier --write <ファイル>` で直す）
Expected: すべて整形済み

---

### Task 4: 送信の手順の表と copilot の手順

> **設計書の読む節:** 「送信の手順の表」（表・段ごとの違い・呼び出しの 2 と 3）、「copilot の手順」（手順・失敗の一覧）、「決めたこと」の「貼り付け」「echo の確かめ」「Enter」「送れたことの確かめの上限」「末尾の `@` の語」「失敗の扱い」「renderer から pty へ届く文字」「Esc を送らない」、「テスト方針」の renderer の手順と統合テスト、「構成」の手順の行。
>
> **気をつける知見:** L-001（どの段でも確かめられなければ止め、`Enter` の前の失敗では `Enter` を送らず、`Enter` の後の失敗でも送り直さない。`sent` は送れたことを画面で確かめたときだけ）・L-019（書くのは正規化した本文の括弧付きの貼り付けと `\r` の 2 回だけ。書いた列をテストで完全に一致させる）・L-041（`Esc`・消去のキーを書かない。入力待ちでないとき・書きかけ・シェルのモード・決められない入力欄には何も書かない）・L-414（末尾の `@` の語は末尾に空白を 1 つ足して貼り、補完に取られたら `not-confirmed`）・L-059（pty と画面の経路を実物の node-pty と `@xterm/headless` の統合テストで確かめる）・L-593（手順は種類をキーにした表から引く）・L-596（統合テストは偽の CLI だけを使う）

**Files:**

- Create: `src/renderer/src/lib/claudePromptSend.ts`（`agentPromptSend.ts` の手順を中身を変えずに移して改名）・`src/renderer/src/lib/copilotPromptSend.ts`・`src/renderer/src/lib/agentPromptSendSpecs.ts`
- Modify: `src/renderer/src/lib/agentPromptSend.ts`（共有の型だけにし、`AgentSendTarget.readScreen` を足す）・`src/renderer/src/hooks/useAgentPromptSender.ts`（手順を表から引き、送り先に `readScreen` を足す）
- Rename（`mv`）: `src/renderer/src/lib/__tests__/agentPromptSend.test.ts` → `src/renderer/src/lib/__tests__/claudePromptSend.test.ts`
- Test: `src/renderer/src/lib/__tests__/claudePromptSend.test.ts`・`src/renderer/src/lib/__tests__/copilotPromptSend.test.ts`（新規）・`src/renderer/src/lib/__tests__/agentPromptSendSpecs.test.ts`（新規）・`src/renderer/src/lib/__tests__/copilotPromptSend.integration.test.ts`（新規）

**Interfaces:**

- Consumes: `normalizeAgentPrompt(raw, kind)`・`AgentSendFailure`（Task 3）、`classifyCopilotScreen`（既存）、`copilotScreenTexts`・`locateCopilotInputBox`・`readCopilotInputState`・`isCopilotPasteEchoed`（Task 2）、`copilotInputScreen`・`copilotInputSequence`・`screenFromTexts`（Task 1）、`buildAgentPasteBytes`・`AGENT_SUBMIT_KEY`（既存）
- Produces（Task 5・6 が使う）:

```ts
// src/renderer/src/lib/agentPromptSend.ts(共有の型だけ)
export interface AgentSendTarget {
  isBracketedPasteEnabled(): boolean
  readViewport(): ViewportLine[]
  readScreen(): ViewportLine[]
  getCols(): number
  write(data: string): void
}
// src/renderer/src/lib/claudePromptSend.ts
export async function sendClaudePrompt(
  target: AgentSendTarget,
  rawText: string,
  clock?: AgentSendClock
): Promise<AgentSendOutcome>
// src/renderer/src/lib/copilotPromptSend.ts
export const COPILOT_INPUT_STATE_POLL_MS = 50
export const COPILOT_INPUT_STATE_TIMEOUT_MS = 2_500
export const COPILOT_ECHO_POLL_MS = 16
export const COPILOT_ECHO_TIMEOUT_MS = 1_500
export const COPILOT_SUBMIT_CONFIRM_POLL_MS = 16
export const COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS = 2_000
export function buildCopilotPasteText(text: string): string
export async function sendCopilotPrompt(
  target: AgentSendTarget,
  rawText: string,
  clock?: AgentSendClock
): Promise<AgentSendOutcome>
// src/renderer/src/lib/agentPromptSendSpecs.ts
export interface AgentPromptSendSpec {
  requiresIdle: boolean
  send: (
    target: AgentSendTarget,
    rawText: string,
    clock: AgentSendClock
  ) => Promise<AgentSendOutcome>
}
export const AGENT_PROMPT_SEND_SPECS: Record<AgentCliKind, AgentPromptSendSpec>
```

- [ ] **Step 1: `claude` の手順のテストを改名し、関数の名前と import を直す**

```bash
cd <repo-root>
test -f src/renderer/src/lib/__tests__/agentPromptSend.test.ts || echo "missing"
mv src/renderer/src/lib/__tests__/agentPromptSend.test.ts src/renderer/src/lib/__tests__/claudePromptSend.test.ts
perl -pi -e 's/\bsendAgentPrompt\b/sendClaudePrompt/g' src/renderer/src/lib/__tests__/claudePromptSend.test.ts
grep -n "sendAgentPrompt\|from '../agentPromptSend'" src/renderer/src/lib/__tests__/claudePromptSend.test.ts
```

Expected: `sendAgentPrompt` は出ず、`from '../agentPromptSend'` が 2 行（値の import と型の import）出る

`src/renderer/src/lib/__tests__/claudePromptSend.test.ts` の値の import（`sendClaudePrompt,` と `AGENT_CLEAR_INTERVAL_MS` などの定数）の `from '../agentPromptSend'` を `from '../claudePromptSend'` にする（`import type { AgentSendClock, AgentSendTarget } from '../agentPromptSend'` はそのまま）。`makeFakeClaude` の偽の送り先の `getCols: () => 60,` の次の行に、次を足す（送り先の型に `readScreen` が増えるため。`claude` の手順が読まないことも確かめる）:

```ts
    readScreen: (): ViewportLine[] => {
      throw new Error('claude の手順は readScreen を読まない(readViewport を読む)')
    },
```

- [ ] **Step 2: 失敗するテストを書く（copilot の手順・手順の表）**

`src/renderer/src/lib/__tests__/copilotPromptSend.test.ts` を作る:

```ts
import { describe, it, expect } from 'vitest'
import { buildAgentPasteBytes } from '@shared/agentPasteText'
import {
  COPILOT_ECHO_TIMEOUT_MS,
  COPILOT_INPUT_STATE_TIMEOUT_MS,
  COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS,
  buildCopilotPasteText,
  sendCopilotPrompt
} from '../copilotPromptSend'
import type { AgentSendClock, AgentSendFailure, AgentSendTarget } from '../agentPromptSend'
import type { ViewportLine } from '../agentViewport'
import { copilotScreen } from './fixtures/copilotScreens'
import {
  copilotInputScreen,
  copilotInputSequence,
  screenFromTexts
} from './fixtures/copilotInputScreens'
import type { CopilotInputScreenName } from './fixtures/copilotInputScreens'

/** 仮想の時計の安全弁: 経過がこれを超えたら sleep が throw する(上限の判定が外れた実装を無限ループではなく失敗にする) */
const CLOCK_SAFETY_LIMIT_MS = 60_000

function makeClock(): AgentSendClock {
  let now = 0
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms
      if (now > CLOCK_SAFETY_LIMIT_MS) throw new Error(`仮想の時計が ${now}ms を超えた`)
    }
  }
}

/** 画面を選ぶ関数。読み取りの時刻・それまでの書き込み・最後の書き込みの時刻を受け取る */
type ScreenAt = (state: {
  now: number
  writes: readonly string[]
  lastWriteAt: number | null
}) => ViewportLine[]

// copilot を真似る偽の送り先。画面は screenAt が時刻と書き込みから選ぶ。書き込みと読み取りの時刻をすべて記録する
interface FakeCopilot extends AgentSendTarget {
  writes: string[]
  writeTimes: number[]
  readTimes: number[]
  bracketed: boolean
}

function makeFakeCopilot(clock: AgentSendClock, screenAt: ScreenAt): FakeCopilot {
  let lastWriteAt: number | null = null
  const fake: FakeCopilot = {
    writes: [],
    writeTimes: [],
    readTimes: [],
    bracketed: true,
    isBracketedPasteEnabled: () => fake.bracketed,
    readViewport: (): ViewportLine[] => {
      throw new Error('copilot の手順は readViewport を読まない(readScreen を読む)')
    },
    readScreen: (): ViewportLine[] => {
      fake.readTimes.push(clock.now())
      return screenAt({ now: clock.now(), writes: fake.writes, lastWriteAt })
    },
    getCols: () => 100,
    write: (data) => {
      fake.writes.push(data)
      fake.writeTimes.push(clock.now())
      lastWriteAt = clock.now()
    }
  }
  return fake
}

const input = (name: CopilotInputScreenName): ViewportLine[] => copilotInputScreen(name).lines

/** 書き込みの数で画面を選ぶ(貼り付けの前・貼り付けの後・Enter の後) */
const byWrites =
  (beforePaste: ViewportLine[], afterPaste: ViewportLine[], afterEnter: ViewportLine[]): ScreenAt =>
  ({ writes }) =>
    [beforePaste, afterPaste, afterEnter][Math.min(writes.length, 2)]

const RULE = '─'.repeat(100)
const DRAFT_BAND =
  ' @ files · # issues                                                                 gpt-4o'

/** 貼った本文が入力欄に入った画面(copilot と同じく、末尾の空白を除いて 1 行目に ❯、2 行目以降に 2 桁の字下げ) */
const echoScreenOf = (pasted: string): ViewportLine[] => {
  const [first, ...rest] = pasted.trimEnd().split('\n')
  return screenFromTexts([
    ' ● 前の応答',
    RULE,
    `❯ ${first}`,
    ...rest.map((row) => `  ${row}`),
    RULE,
    DRAFT_BAND
  ])
}

/** 送れる流れ(空 → 貼った本文の echo → 空)。echo の画面は実際に貼った本文から作る */
const sendableFlow: ScreenAt = ({ writes }) => {
  if (writes.length === 0) return input('empty')
  if (writes.length === 1) return echoScreenOf(writes[0].slice(6, -6))
  return input('aeInstantEnd')
}

const MULTI = 'first line\nsecond line\nthird line'

describe('sendCopilotPrompt: 送れる流れ', () => {
  it('空の入力欄を 2 回確かめ、貼り付け → echo → 別の書き込みの \\r → 空に戻って sent。書いた列は貼り付けと \\r の 2 回だけ', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(
      clock,
      byWrites(input('empty'), input('multiPasted'), input('aeInstantEnd'))
    )
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'sent',
      clearedDraft: false
    })
    expect(fake.writes).toEqual([buildAgentPasteBytes(MULTI), '\r'])
    // 0ms と 50ms の 2 回の空を確かめてから貼る
    expect(fake.writeTimes[0]).toBe(50)
  })

  it('Enter の後に帯が作業中(段階 2a の台帳の beforeFirstToken)になれば sent', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(
      clock,
      byWrites(input('empty'), input('multiPasted'), copilotScreen('beforeFirstToken').lines)
    )
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'sent',
      clearedDraft: false
    })
    expect(fake.writes).toEqual([buildAgentPasteBytes(MULTI), '\r'])
  })
})

describe('sendCopilotPrompt: 押した時点の画面で送らない(何も書かない)', () => {
  const noBand = screenFromTexts([' ● 前の応答', RULE, '❯', RULE])
  const noInputBox = screenFromTexts([' ● 前の応答', '', ''])
  it.each<[string, ViewportLine[], AgentSendFailure]>([
    ['書きかけ(afterTurn1char)', input('afterTurn1char'), 'draft-present'],
    ['空白だけの書きかけ(spacesPasted)', input('spacesPasted'), 'draft-present'],
    ['シェルのモード(shellEmpty)', input('shellEmpty'), 'shell-mode'],
    ['作業中(working3000)', copilotScreen('working3000').lines, 'screen-working'],
    ['許可待ち(permission)', copilotScreen('permission').lines, 'screen-permission'],
    ['確認待ち(trust)', copilotScreen('trust').lines, 'screen-confirm'],
    ['判定できない(帯が空の手書き)', noBand, 'screen-unknown'],
    // 入力欄が無い画面は idle にならないので、input-not-found ではなく screen-unknown
    ['入力欄が無い(描き直しの途中の手書き)', noInputBox, 'screen-unknown']
  ])('%s → %s', async (_label, screen, reason) => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, () => screen)
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason
    })
    expect(fake.writes).toEqual([])
  })
})

describe('sendCopilotPrompt: 空か書きかけかを決められない間の保留(50ms ごと・上限 2,500ms)', () => {
  it('一時的な帯(spacesEsc1 の形。入力欄は空)が続いた後に空になれば、空を 2 回確かめて送る', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now, writes }) => {
      if (writes.length === 0) return now < 600 ? input('spacesEsc1') : input('empty')
      return sendableFlow({ now, writes, lastWriteAt: null })
    })
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toMatchObject({ kind: 'sent' })
    expect(fake.writeTimes[0]).toBe(650)
  })

  it('記録の列 escRewindBand(帯 esc again to rewind から約 500ms で戻る)でも、戻った後に送る', async () => {
    const frames = copilotInputSequence('escRewindBand')
    // 帯が出た列(71ms)を時刻 0 にする
    const offset = frames[1].dt
    const frameAt = (now: number): ViewportLine[] => {
      let current = frames[0].lines
      for (const frame of frames) if (frame.dt - offset <= now) current = frame.lines
      return current
    }
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now, writes }) =>
      writes.length === 0 ? frameAt(now) : sendableFlow({ now, writes, lastWriteAt: null })
    )
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toMatchObject({ kind: 'sent' })
    // 戻るのは 570 - 71 = 499ms。500ms と 550ms の 2 回の空を確かめて貼る
    expect(fake.writeTimes[0]).toBe(550)
  })

  it('上限の直前の読み取り(2,450ms)で空になれば、続く 2,500ms の読み取りで 2 回目の空を確かめて送る', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now, writes }) => {
      if (writes.length === 0) return now < 2_450 ? input('spacesEsc1') : input('empty')
      return sendableFlow({ now, writes, lastWriteAt: null })
    })
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toMatchObject({ kind: 'sent' })
    expect(fake.writeTimes[0]).toBe(COPILOT_INPUT_STATE_TIMEOUT_MS)
  })

  it('上限の時点(2,500ms)の読み取りでも決められなければ input-undetermined で、何も書かない', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, () => input('spacesEsc1'))
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'input-undetermined'
    })
    expect(fake.writes).toEqual([])
    expect(fake.readTimes[fake.readTimes.length - 1]).toBe(COPILOT_INPUT_STATE_TIMEOUT_MS)
  })

  it('上限の時点(2,500ms)の読み取りで初めて空になっても、2 回目を確かめられないので input-undetermined', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now }) =>
      now < COPILOT_INPUT_STATE_TIMEOUT_MS ? input('spacesEsc1') : input('empty')
    )
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'input-undetermined'
    })
    expect(fake.writes).toEqual([])
  })

  it('空が 1 回だけで次が決められなければ、空の回数を数え直す(0・100・150ms の空で、150ms に貼る)', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now, writes }) => {
      if (writes.length === 0) return now === 50 ? input('spacesEsc1') : input('empty')
      return sendableFlow({ now, writes, lastWriteAt: null })
    })
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toMatchObject({ kind: 'sent' })
    expect(fake.writeTimes[0]).toBe(150)
  })

  it('保留の間に作業中の画面に変わったら screen-working で、何も書かない', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now }) =>
      now < 100 ? input('spacesEsc1') : copilotScreen('working3000').lines
    )
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'screen-working'
    })
    expect(fake.writes).toEqual([])
  })
})

describe('sendCopilotPrompt: echo の確かめ(16ms ごと・上限 1,500ms)', () => {
  it('上限まで echo が現れなければ not-echoed で、書いた列は貼り付けだけ(Enter を送らない)', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, () => input('empty'))
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'not-echoed'
    })
    expect(fake.writes).toEqual([buildAgentPasteBytes(MULTI)])
  })

  it('貼り付けから 1,500ms の時点で現れれば、上限を過ぎた最初の読み取り(1,504ms)で確かめて送る', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now, writes, lastWriteAt }) => {
      if (writes.length === 0) return input('empty')
      if (writes.length === 1) {
        const pastedAt = lastWriteAt ?? 0
        return now - pastedAt >= COPILOT_ECHO_TIMEOUT_MS ? input('multiPasted') : input('empty')
      }
      return input('aeInstantEnd')
    })
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toMatchObject({ kind: 'sent' })
    expect(fake.writeTimes[1] - fake.writeTimes[0]).toBe(1_504)
  })

  it('上限を過ぎた最初の読み取り(1,504ms)でも現れなければ not-echoed', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now, writes, lastWriteAt }) => {
      if (writes.length === 0) return input('empty')
      const pastedAt = lastWriteAt ?? 0
      return now - pastedAt >= 1_505 ? input('multiPasted') : input('empty')
    })
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'not-echoed'
    })
    expect(fake.writes).toEqual([buildAgentPasteBytes(MULTI)])
  })

  it('echo の画面で記号が「!」(シェルのモード)なら、上限を待たずに not-echoed', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(
      clock,
      byWrites(input('empty'), input('shellDraft'), input('empty'))
    )
    await expect(sendCopilotPrompt(fake, 'echo hi', clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'not-echoed'
    })
    expect(fake.writes).toEqual([buildAgentPasteBytes('echo hi')])
    // 貼り付け(50ms)の後の最初の読み取り(66ms)で止める
    expect(fake.readTimes[fake.readTimes.length - 1]).toBe(66)
  })
})

describe('sendCopilotPrompt: 送れたことの確かめ(16ms ごと・上限 2,000ms)', () => {
  it.each<[string, string, CopilotInputScreenName, CopilotInputScreenName]>([
    ['look at @file(Enter が補完の確定に取られた atEnter)', 'look at @file', 'atPaste', 'atEnter'],
    [
      'アプリの参照の添付の形(atref1hEnter1)',
      '本文\n\n参照:\n- @file.txt',
      'atref1hPaste',
      'atref1hEnter1'
    ]
  ])(
    '%s: Enter の後に入力欄が書き換わったままなら 2,000ms で not-confirmed で、\\r を送り直さない',
    async (_label, text, echo, afterEnter) => {
      const clock = makeClock()
      const fake = makeFakeCopilot(clock, byWrites(input('empty'), input(echo), input(afterEnter)))
      await expect(sendCopilotPrompt(fake, text, clock)).resolves.toEqual({
        kind: 'failed',
        reason: 'not-confirmed'
      })
      expect(fake.writes).toEqual([buildAgentPasteBytes(buildCopilotPasteText(text)), '\r'])
      expect(fake.readTimes[fake.readTimes.length - 1] - fake.writeTimes[1]).toBe(
        COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS
      )
    }
  )

  it('Enter から 2,000ms ちょうどに空になれば sent', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, ({ now, writes, lastWriteAt }) => {
      if (writes.length === 0) return input('empty')
      if (writes.length === 1) return input('atPaste')
      const enteredAt = lastWriteAt ?? 0
      return now - enteredAt >= COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS
        ? input('aeInstantEnd')
        : input('atEnter')
    })
    await expect(sendCopilotPrompt(fake, 'look at @file', clock)).resolves.toMatchObject({
      kind: 'sent'
    })
    expect(fake.writes).toHaveLength(2)
  })
})

describe('sendCopilotPrompt: 本文と bracketed paste', () => {
  it.each<[string, AgentSendFailure]>([
    ['/help', 'leading-slash'],
    ['!ls', 'leading-bang']
  ])('断る本文 %j は画面を読まず、何も書かない(%s)', async (text, reason) => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, () => input('empty'))
    await expect(sendCopilotPrompt(fake, text, clock)).resolves.toEqual({ kind: 'failed', reason })
    expect(fake.readTimes).toEqual([])
    expect(fake.writes).toEqual([])
  })

  it('bracketed paste が無効なら not-accepting で、画面を読まず何も書かない', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(clock, () => input('empty'))
    fake.bracketed = false
    await expect(sendCopilotPrompt(fake, MULTI, clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'not-accepting'
    })
    expect(fake.readTimes).toEqual([])
    expect(fake.writes).toEqual([])
  })
})

describe('sendCopilotPrompt: 末尾の @ の語(末尾に空白を 1 つ足して貼る。L-414)', () => {
  it.each(['look at @file', '本文\n\n参照:\n- @src/app.ts', 'look at @file\n', 'look at @file  '])(
    '%j は、末尾の空白を除いて空白を 1 つ足した本文を貼る',
    async (text) => {
      const clock = makeClock()
      const fake = makeFakeCopilot(clock, sendableFlow)
      await expect(sendCopilotPrompt(fake, text, clock)).resolves.toMatchObject({ kind: 'sent' })
      expect(fake.writes).toEqual([buildAgentPasteBytes(`${text.trimEnd()} `), '\r'])
    }
  )

  it.each(['mail a@b.com', '@file then explain', 'fix #12'])(
    '末尾の語が @ で始まらない %j は空白を足さない',
    async (text) => {
      const clock = makeClock()
      const fake = makeFakeCopilot(clock, sendableFlow)
      await expect(sendCopilotPrompt(fake, text, clock)).resolves.toMatchObject({ kind: 'sent' })
      expect(fake.writes).toEqual([buildAgentPasteBytes(text), '\r'])
    }
  )

  it.each<[string, string, CopilotInputScreenName, CopilotInputScreenName]>([
    ['参照 1 つ(atref2)', '本文\n\n- @file.txt', 'atref2Paste', 'atref2Enter1'],
    ['参照 2 つ(atref8)', '本文\n\n- @file.txt\n- @file2.txt', 'atref8Paste', 'atref8Enter1']
  ])(
    '記録の列(空白を足して貼った形): %s は \\r を 1 回送って sent',
    async (_label, text, echo, afterEnter) => {
      const clock = makeClock()
      const fake = makeFakeCopilot(clock, byWrites(input('empty'), input(echo), input(afterEnter)))
      await expect(sendCopilotPrompt(fake, text, clock)).resolves.toEqual({
        kind: 'sent',
        clearedDraft: false
      })
      expect(fake.writes).toEqual([buildAgentPasteBytes(`${text} `), '\r'])
    }
  )

  it('記録の列(空白を足さずに貼った形 atref1Paste → atref1Enter1。Enter が補完に取られた)は 2,000ms で not-confirmed で、\\r を送り直さない', async () => {
    const clock = makeClock()
    const fake = makeFakeCopilot(
      clock,
      byWrites(input('empty'), input('atref1Paste'), input('atref1Enter1'))
    )
    await expect(sendCopilotPrompt(fake, '本文\n\n- @file.txt', clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'not-confirmed'
    })
    expect(fake.writes.filter((data) => data === '\r')).toHaveLength(1)
  })
})

describe('buildCopilotPasteText', () => {
  it.each([
    ['look at @file', 'look at @file '],
    ['本文\n\n参照:\n- @src/app.ts', '本文\n\n参照:\n- @src/app.ts '],
    ['look at @file\n', 'look at @file '],
    ['look at @file  ', 'look at @file '],
    // 末尾が @ だけ
    ['@', '@ '],
    // 参照が 2 つ
    ['- @a.ts\n- @b.ts', '- @a.ts\n- @b.ts '],
    // 本文の途中だけに @ の語がある
    ['see @a.ts and explain', 'see @a.ts and explain'],
    ['mail a@b.com', 'mail a@b.com'],
    ['@file then explain', '@file then explain'],
    ['fix #12', 'fix #12']
  ])('%j → %j', (text, expected) => {
    expect(buildCopilotPasteText(text)).toBe(expected)
  })
})
```

`src/renderer/src/lib/__tests__/agentPromptSendSpecs.test.ts` を作る:

```ts
import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import { AGENT_PROMPT_SEND_SPECS } from '../agentPromptSendSpecs'
import { sendClaudePrompt } from '../claudePromptSend'
import { sendCopilotPrompt } from '../copilotPromptSend'

describe('AGENT_PROMPT_SEND_SPECS(CLI の種類ごとの送信の手順)', () => {
  it('種類の一覧のすべてに手順がある', () => {
    expect(Object.keys(AGENT_PROMPT_SEND_SPECS).sort()).toEqual([...AGENT_CLI_KINDS].sort())
  })

  it('claude は活動を見ず(requiresIdle: false)、今の手順(sendClaudePrompt)', () => {
    expect(AGENT_PROMPT_SEND_SPECS.claude).toEqual({ requiresIdle: false, send: sendClaudePrompt })
  })

  it('copilot は入力待ちと中断の流れの外だけ(requiresIdle: true)、sendCopilotPrompt', () => {
    expect(AGENT_PROMPT_SEND_SPECS.copilot).toEqual({ requiresIdle: true, send: sendCopilotPrompt })
  })
})
```

- [ ] **Step 3: 失敗するテストを書く（統合テスト。実物の node-pty と `@xterm/headless`・偽の CLI）**

`src/renderer/src/lib/__tests__/copilotPromptSend.integration.test.ts` を作る:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { Terminal } from '@xterm/headless'
import { sendCopilotPrompt } from '../copilotPromptSend'
import type { AgentSendTarget } from '../agentPromptSend'
import { readScreenLines, readViewportLines } from '../agentViewport'
import { readCopilotInputState } from '../copilotInputBox'

// 実物の node-pty と @xterm/headless で、偽の copilot(一時ディレクトリに書いた小さな node のスクリプト)へ sendCopilotPrompt を本物の
// 時計で送る(設計書 2026-10-22「テスト方針」の統合テスト。L-059)。画面の読み取り・書き込みの経路と待ちの確かめで、実物の
// copilot の挙動の確かめではない。実物の copilot は起動しない(L-596)

// String.raw の中ではテンプレートの ${} を使わない(偽の CLI のスクリプトはこの文字列のまま書き出す)
const FAKE_COPILOT = String.raw`
// 偽の copilot(copilotPromptSend.integration.test.ts が一時ディレクトリに書いて node-pty で起動する)。代替画面に copilot 1.0.87 と
// 同じ形の入力欄(罫線・❯・罫線)と帯を描く。括弧付きの貼り付けを受けると約 250ms 後に本文を入力欄に描き、\r を受けると
// (mode が ignore-enter でなければ)入力欄を空に戻して本文を記録する。受け取った読み取りの塊と \r の数もすべて記録する
const fs = require('node:fs')
const reportPath = process.argv[2]
const mode = process.argv[3]
const RULE = '─'.repeat(60)
const EMPTY_BAND = ' ← open sidebar · / commands · ? help · tab next tab'
const DRAFT_BAND = ' @ files · # issues'
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const report = { chunks: [], submitted: [], enterCount: 0 }
let input = ''
let buffer = ''
function save() {
  fs.writeFileSync(reportPath, JSON.stringify(report))
}
function draw() {
  const rows = input === '' ? [''] : input.split('\n')
  const lines = [' fake copilot', RULE, ('❯ ' + rows[0]).trimEnd()]
  for (const row of rows.slice(1)) lines.push('  ' + row)
  lines.push(RULE, input === '' ? EMPTY_BAND : DRAFT_BAND)
  process.stdout.write('\x1b[2J\x1b[H' + lines.join('\r\n'))
}
process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')
process.stdout.write('\x1b[?1049h\x1b[?2004h')
draw()
save()
process.stdin.on('data', (chunk) => {
  report.chunks.push(chunk)
  buffer += chunk
  while (buffer !== '') {
    if (buffer.startsWith(PASTE_START)) {
      const end = buffer.indexOf(PASTE_END)
      if (end < 0) break
      const text = buffer.slice(PASTE_START.length, end)
      buffer = buffer.slice(end + PASTE_END.length)
      setTimeout(() => {
        input = text
        draw()
      }, 250)
    } else if (buffer.startsWith('\r')) {
      buffer = buffer.slice(1)
      report.enterCount += 1
      if (mode !== 'ignore-enter') {
        report.submitted.push(input)
        input = ''
        draw()
      }
    } else {
      buffer = buffer.slice(1)
    }
  }
  save()
})
`

interface FakeCopilotReport {
  /** 偽の CLI が受け取った読み取りの塊(pty の 1 回の data) */
  chunks: string[]
  /** \r で送られた本文 */
  submitted: string[]
  /** 受け取った \r の数 */
  enterCount: number
}

let dir: string | null = null
let pty: IPty | null = null
let terminal: Terminal | null = null

afterEach(() => {
  pty?.kill()
  pty = null
  terminal?.dispose()
  terminal = null
  if (dir !== null) rmSync(dir, { recursive: true, force: true })
  dir = null
})

/** 偽の copilot を起動し、入力待ち(空の入力欄と bracketed paste)になるまで待って、送り先と記録の読み出しを返す */
async function startFakeCopilot(
  mode: 'normal' | 'ignore-enter'
): Promise<{ target: AgentSendTarget; report: () => FakeCopilotReport }> {
  const workDir = mkdtempSync(join(tmpdir(), 'prompt-ide-fake-copilot-'))
  dir = workDir
  const script = join(workDir, 'fake-copilot.js')
  const reportPath = join(workDir, 'report.json')
  writeFileSync(script, FAKE_COPILOT)
  const term = new Terminal({ cols: 60, rows: 12, allowProposedApi: true })
  terminal = term
  const child = spawn(process.execPath, [script, reportPath, mode], {
    name: 'xterm-256color',
    cols: 60,
    rows: 12,
    cwd: workDir,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }
  })
  pty = child
  child.onData((data) => term.write(data))
  const target: AgentSendTarget = {
    isBracketedPasteEnabled: () => term.modes.bracketedPasteMode,
    readViewport: () => readViewportLines(term.buffer.active, term.rows),
    readScreen: () => readScreenLines(term.buffer.active, term.rows),
    getCols: () => term.cols,
    write: (data) => child.write(data)
  }
  const startedAt = Date.now()
  while (
    !(term.modes.bracketedPasteMode && readCopilotInputState(target.readScreen()) === 'empty')
  ) {
    if (Date.now() - startedAt > 5_000) throw new Error('偽の copilot が入力待ちになりません')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const report = (): FakeCopilotReport => {
    const parsed: unknown = JSON.parse(readFileSync(reportPath, 'utf8'))
    return parsed as FakeCopilotReport
  }
  return { target, report }
}

describe.skipIf(process.platform === 'win32')(
  'sendCopilotPrompt(実物の node-pty と @xterm/headless・偽の copilot)',
  () => {
    it('貼り付け → echo → 別の読み取りの \\r で sent になり、偽の CLI が受け取った本文が送った本文と一致する', async () => {
      const { target, report } = await startFakeCopilot('normal')
      const text = 'hello from the app\nsecond line'
      await expect(sendCopilotPrompt(target, text)).resolves.toEqual({
        kind: 'sent',
        clearedDraft: false
      })
      const received = report()
      expect(received.submitted).toEqual([text])
      expect(received.enterCount).toBe(1)
      // \r は貼り付けの終わりの印(ESC[201~)を含む塊より後の、別の読み取りで届いた
      const pasteEnd = received.chunks.findIndex((chunk) => chunk.includes('\x1b[201~'))
      const enter = received.chunks.indexOf('\r')
      expect(pasteEnd).toBeGreaterThanOrEqual(0)
      expect(enter).toBeGreaterThan(pasteEnd)
    }, 15_000)

    it('偽の CLI が \\r を無視すると not-confirmed になり、\\r は 1 回だけ届く(送り直さない)', async () => {
      const { target, report } = await startFakeCopilot('ignore-enter')
      await expect(sendCopilotPrompt(target, 'hello from the app')).resolves.toEqual({
        kind: 'failed',
        reason: 'not-confirmed'
      })
      const received = report()
      expect(received.enterCount).toBe(1)
      expect(received.submitted).toEqual([])
    }, 15_000)
  }
)
```

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/copilotPromptSend.test.ts src/renderer/src/lib/__tests__/agentPromptSendSpecs.test.ts src/renderer/src/lib/__tests__/copilotPromptSend.integration.test.ts src/renderer/src/lib/__tests__/claudePromptSend.test.ts`
Expected: FAIL（`../copilotPromptSend`・`../agentPromptSendSpecs`・`../claudePromptSend` が見つからない）

- [ ] **Step 5: `claude` の手順を移し、共有の型だけを残す**

`src/renderer/src/lib/claudePromptSend.ts` を作る（`agentPromptSend.ts` の定数・`clearInput`・`sendAgentPrompt` を中身を変えずに移し、`sendClaudePrompt` に改名したもの。正規化の `'claude'` は Task 3 で足したもの）:

```ts
import {
  AGENT_CLEAR_INPUT_CHUNK,
  AGENT_SUBMIT_KEY,
  buildAgentPasteBytes,
  normalizeAgentPrompt
} from '@shared/agentPasteText'
import { realClock } from './agentPromptSend'
import type {
  AgentSendClock,
  AgentSendFailure,
  AgentSendOutcome,
  AgentSendTarget
} from './agentPromptSend'
import { findInputBox, isInputBoxEmpty, isPasteEchoed } from './agentInputBox'

// プロンプトを起動中の claude の入力欄へ送る手順(設計書「プロンプトの送信」3〜13)。正規化 → 入力欄の特定 →
// 消去を最低 1 回 → 空の確認 → 貼り付け → 現れたかの確認 → Enter。入力欄が空と判定されても消去を省かない
// (isInputBoxEmpty は画面の属性だけでは書きかけを区別できない場合がある。空の入力欄に送っても害は無い)。
// 各段で確かめられなければ、その時点で止めてそれ以上送らない(Enter は送らない)。
// React に依らない関数にし、待ち時間は注入する(テストでは仮想の時計で進める)。段階 2b で agentPromptSend.ts から中身を変えずに移し、
// sendAgentPrompt を sendClaudePrompt に改名した(送信の手順の表 agentPromptSendSpecs.ts の claude。copilot は copilotPromptSend.ts)

/** 消去の書き込みの間隔(1 回 24 バイト。間を空けずに続けると一部しか効かない。確認の結果 18) */
export const AGENT_CLEAR_INTERVAL_MS = 30
/** 入力欄を空にするまでの上限(300 行の入力で 1.6〜2.1 秒。確認の結果 20) */
export const AGENT_CLEAR_TIMEOUT_MS = 3_000
/** 空の確認の間隔(描き直しの途中の画面で判定しないため、2 回続けて空を確かめる) */
export const AGENT_EMPTY_CONFIRM_INTERVAL_MS = 50
/** 貼り付けた本文が現れたかを確かめる間隔と上限(実測 13〜24ms。確認の結果 8) */
export const AGENT_ECHO_POLL_MS = 16
export const AGENT_ECHO_TIMEOUT_MS = 1_000

/**
 * 入力欄を空にする(5〜8)。入力欄を特定してから、空と判定されても消去を 1 回送り、その後は空が 2 回続くまで
 * (空でなければ消去を送り直す)確かめる。見つからなくなれば input-not-found、上限で clear-failed
 */
async function clearInput(
  target: AgentSendTarget,
  clock: AgentSendClock
): Promise<
  { kind: 'empty'; clearedDraft: boolean } | { kind: 'failed'; reason: AgentSendFailure }
> {
  const deadline = clock.now() + AGENT_CLEAR_TIMEOUT_MS
  const first = findInputBox(target.readViewport())
  // 確認画面(フォルダの信頼など)へキーを送らない
  if (first === null) return { kind: 'failed', reason: 'input-not-found' }
  let clearedDraft = !isInputBoxEmpty(first)
  target.write(AGENT_CLEAR_INPUT_CHUNK)
  await clock.sleep(AGENT_CLEAR_INTERVAL_MS)
  let consecutiveEmpty = 0
  for (;;) {
    const box = findInputBox(target.readViewport())
    // 途中で確認の画面が出た場合に、その画面へキーを送り続けない
    if (box === null) return { kind: 'failed', reason: 'input-not-found' }
    if (isInputBoxEmpty(box)) {
      consecutiveEmpty += 1
      if (consecutiveEmpty >= 2) return { kind: 'empty', clearedDraft }
      if (clock.now() >= deadline) return { kind: 'failed', reason: 'clear-failed' }
      await clock.sleep(AGENT_EMPTY_CONFIRM_INTERVAL_MS)
      continue
    }
    consecutiveEmpty = 0
    if (clock.now() >= deadline) return { kind: 'failed', reason: 'clear-failed' }
    target.write(AGENT_CLEAR_INPUT_CHUNK)
    clearedDraft = true
    await clock.sleep(AGENT_CLEAR_INTERVAL_MS)
  }
}

/**
 * プロンプトを claude の入力欄へ送る。正規化 → bracketed paste の確認 → 入力欄の特定 → 消去を最低 1 回(空と判定されても
 * 省かない) → 空を 2 回続けて確認 → 貼り付け(消去とは別の書き込み) → 本文が現れたかの確認 → Enter。
 * どこかで確かめられなければ failed を返し、Enter は送らない
 */
export async function sendClaudePrompt(
  target: AgentSendTarget,
  rawText: string,
  clock: AgentSendClock = realClock
): Promise<AgentSendOutcome> {
  const normalized = normalizeAgentPrompt(rawText, 'claude')
  if (normalized.kind === 'rejected') return { kind: 'failed', reason: normalized.reason }
  // bracketed paste が無効のまま送ると、本文の改行がそれぞれ Enter になり途中で送信される
  if (!target.isBracketedPasteEnabled()) return { kind: 'failed', reason: 'not-accepting' }
  const cleared = await clearInput(target, clock)
  if (cleared.kind === 'failed') return cleared
  // 消去とは別の書き込みで送る(同じ本文の [Pasted text #N …] が展開されないように。確認の結果 19)
  target.write(buildAgentPasteBytes(normalized.text))
  const deadline = clock.now() + AGENT_ECHO_TIMEOUT_MS
  for (;;) {
    await clock.sleep(AGENT_ECHO_POLL_MS)
    const box = findInputBox(target.readViewport())
    if (box !== null && isPasteEchoed(box, normalized.text, target.getCols())) {
      target.write(AGENT_SUBMIT_KEY)
      return { kind: 'sent', clearedDraft: cleared.clearedDraft }
    }
    // シェルのモード(!)に入った・時間切れ: Enter を送らない(確認画面の選択肢を確定させない)
    if (box?.symbol === 'shell' || clock.now() >= deadline)
      return { kind: 'failed', reason: 'not-echoed' }
  }
}
```

`src/renderer/src/lib/agentPromptSend.ts` を次にする（定数・`clearInput`・`sendAgentPrompt` と、値の import を消し、共有の型と時計だけを残す。`AgentSendScreenFailure`・`AgentSendFailure` は Task 3 のまま）:

```ts
import type { AgentPromptRejection } from '@shared/agentPasteText'
import type { AgentHistoryInfo } from '@shared/types'
import type { AgentActivity } from './agentActivity'
import type { ViewportLine } from './agentViewport'

// プロンプトの送信の手順(claudePromptSend.ts・copilotPromptSend.ts)と呼び出し側(useAgentPromptSender)が共有する型と時計
// (設計書 2026-10-22「送信の手順の表」)。手順は CLI の種類ごとの表(agentPromptSendSpecs.ts)から引く

/** 送り先の画面の活動が入力待ちでない(copilot の手順 3)。活動を足したときの決め忘れを型エラーにする */
export type AgentSendScreenFailure = `screen-${Exclude<AgentActivity, 'idle'>}`

export type AgentSendFailure =
  | AgentPromptRejection
  | 'not-accepting'
  | 'input-not-found'
  | 'clear-failed'
  | 'not-echoed'
  /** 送り先の CLI が送信に対応していない(useAgentPromptSender.send の先頭の守り。手順は返さない) */
  | 'unsupported-cli'
  /** 送り先のタブが中断の流れの間(useAgentPromptSender.send の先頭の守り。手順は返さない) */
  | 'interrupting'
  | AgentSendScreenFailure
  /** シェルのモード(copilot の手順 3) */
  | 'shell-mode'
  /** 入力欄に書きかけがある(copilot の手順 3。書きかけは消していない) */
  | 'draft-present'
  /** 上限まで入力欄が空か書きかけかを決められなかった(copilot の手順 3) */
  | 'input-undetermined'
  /** Enter の後に送れたことを確かめられなかった(copilot の手順 7。Enter は送り直していない) */
  | 'not-confirmed'

/** clearedDraft: 消去の前・途中に、入力欄が空でない(書きかけがある)と判定できたか(copilot は書きかけを消さないので常に false) */
export type AgentSendOutcome =
  | { kind: 'sent'; clearedDraft: boolean }
  | { kind: 'failed'; reason: AgentSendFailure }

/**
 * 送信の手順を含めた送信(useAgentPromptSender.send)の結果。送れたときは、送信の手順を始める時点に控えた送り先(履歴の
 * HistoryEntry.agent と同じ形。控えられなかったら null)を足す。送信の手順(表の send)の AgentSendOutcome は変えない
 */
export type AgentPromptSendResult =
  | (Extract<AgentSendOutcome, { kind: 'sent' }> & { sentTo: AgentHistoryInfo | null })
  | Extract<AgentSendOutcome, { kind: 'failed' }>

/** 送り先(agentTerminalController の一部)。write は利用者のキー入力の保留とは別に、直接 pty へ送る */
export interface AgentSendTarget {
  isBracketedPasteEnabled(): boolean
  /** 表示中の行(claude の手順が読む) */
  readViewport(): ViewportLine[]
  /** 画面の末尾の行(copilot の手順が読む。段階 2a の判定と同じ読み方。代替画面なので見え方は readViewport と同じ) */
  readScreen(): ViewportLine[]
  getCols(): number
  write(data: string): void
}

export interface AgentSendClock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const realClock: AgentSendClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}
```

```bash
cd <repo-root>
grep -rn "sendAgentPrompt\b" src --include="*.ts" --include="*.tsx" | grep -v "const sendAgentPrompt = agentSender.send\|await sendAgentPrompt(text\|sendAgentPrompt, selectedTarget\]"
```

Expected: `src/renderer/src/hooks/useAgentPromptSender.ts` の import・呼び出し・コメント（Step 7 で直す）と、`src/renderer/src/lib/claudePromptSend.ts` の改名の注記・`src/renderer/src/hooks/useAgentSendConfirm.ts`・`src/renderer/src/__tests__/prepareClaudeScreen.ts`・`src/renderer/src/components/__tests__/App.agentReferences.test.tsx` のコメントだけが出る（`useAgentWorkspace.ts` の `const sendAgentPrompt = agentSender.send` は sender の送信の別名で、手順の関数ではないので変えない）。コメントの `sendAgentPrompt` は `送信の手順` か `sendClaudePrompt`（`claude` の画面の話のとき）に直す（`claudePromptSend.ts` の改名の注記はそのまま）

- [ ] **Step 6: copilot の手順と手順の表を書く**

`src/renderer/src/lib/copilotPromptSend.ts` を作る:

```ts
import {
  AGENT_SUBMIT_KEY,
  buildAgentPasteBytes,
  normalizeAgentPrompt
} from '@shared/agentPasteText'
import { realClock } from './agentPromptSend'
import type {
  AgentSendClock,
  AgentSendFailure,
  AgentSendOutcome,
  AgentSendTarget
} from './agentPromptSend'
import {
  copilotScreenTexts,
  isCopilotPasteEchoed,
  locateCopilotInputBox,
  readCopilotInputState
} from './copilotInputBox'
import { classifyCopilotScreen } from './copilotScreenActivity'

// プロンプトを copilot の入力欄へ送る手順(設計書 2026-10-22「copilot の手順」)。claude の手順(claudePromptSend.ts)と違い、
// 入力欄を消さない(書きかけがあれば断る)・入力待ちのときだけ送る・Enter の後に送れたことを画面で確かめる。書くのは括弧付きの
// 貼り付けと \r の 2 回だけで、Esc・Ctrl+U・Ctrl+K・Ctrl+C・Backspace は書かない(L-019・L-041)。どの段でも確かめられなければ
// その場で止め、Enter の前の失敗では Enter を送らず、Enter の後の失敗でも送り直さない(L-001・L-414)。React に依らない関数にし、
// 待ち時間は注入する(テストでは仮想の時計で進める)。規則は GitHub Copilot CLI 1.0.87 の記録(copilotInputScreens.json)に合わせた

/** 入力欄が空か書きかけかを決められない間(一時的な帯)に読み直す間隔と上限(一時的な帯の最長 約 2,000ms + 500ms。記録の 6) */
export const COPILOT_INPUT_STATE_POLL_MS = 50
export const COPILOT_INPUT_STATE_TIMEOUT_MS = 2_500
/** 貼り付けた本文が入力欄に現れたかを確かめる間隔と上限(記録の echo は 約 210〜300ms。アプリの xterm と IPC の遅れを見て約 5 倍) */
export const COPILOT_ECHO_POLL_MS = 16
export const COPILOT_ECHO_TIMEOUT_MS = 1_500
/** Enter の後に送れたことを確かめる間隔と上限(記録では 11〜91ms。最も遅い 91ms の 20 倍の余裕) */
export const COPILOT_SUBMIT_CONFIRM_POLL_MS = 16
export const COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS = 2_000

/** 末尾の空白(改行を含む)を除いた本文の最後の語が @ で始まる(copilot が補完の候補の一覧を開く形。report.md の 8) */
const TRAILING_AT_WORD = /(?:^|\s)@\S*$/

const failed = (reason: AgentSendFailure): AgentSendOutcome => ({ kind: 'failed', reason })

/**
 * 貼る本文。末尾の空白(改行を含む)を除いた最後の語が @ で始まれば、末尾の空白を除いて空白を 1 つ足す(補完の一覧を開かせず、
 * Enter を補完の確定に取られない。末尾の空白は copilot が送るときに落とすので、届く本文は変わらない。report.md の 8)
 */
export function buildCopilotPasteText(text: string): string {
  const trimmed = text.trimEnd()
  return TRAILING_AT_WORD.test(trimmed) ? `${trimmed} ` : text
}

/**
 * 手順 3: 画面が入力待ちで入力欄が空であることを、空が 2 回続くまで確かめる(決められない間は読み直し、上限で止める)。
 * 送ってよければ null、送らないなら失敗の理由(どちらも何も書いていない)
 */
async function waitForEmptyInput(
  target: AgentSendTarget,
  clock: AgentSendClock
): Promise<AgentSendFailure | null> {
  const deadline = clock.now() + COPILOT_INPUT_STATE_TIMEOUT_MS
  let consecutiveEmpty = 0
  for (;;) {
    const lines = target.readScreen()
    // 1 回目の読み取りが押した時点の確かめ(L-058)。保留の間に作業中・確認の画面へ変わっても止める
    const activity = classifyCopilotScreen(lines)
    if (activity !== 'idle') return `screen-${activity}`
    const state = readCopilotInputState(lines)
    // 書きかけ・シェルのモードには書かない(書きかけは消さない。利用者の決定)
    if (state === 'shell') return 'shell-mode'
    if (state === 'draft') return 'draft-present'
    // idle と判定された画面には入力欄があるので起きない(型の網羅のための守り)
    if (state === 'not-found') return 'input-not-found'
    if (state === 'empty') {
      consecutiveEmpty += 1
      // 描き直しの途中の画面で判定しないよう、空を 2 回続けて確かめる(claude の消去の後の確かめと同じ)
      if (consecutiveEmpty >= 2) return null
    } else {
      consecutiveEmpty = 0
    }
    if (clock.now() >= deadline) return 'input-undetermined'
    await clock.sleep(COPILOT_INPUT_STATE_POLL_MS)
  }
}

/** 手順 5: 貼った本文が入力欄に現れるのを待つ。現れたら true。シェルのモードに変わった・上限を過ぎたら false */
async function waitForEcho(
  target: AgentSendTarget,
  pasteText: string,
  clock: AgentSendClock
): Promise<boolean> {
  const deadline = clock.now() + COPILOT_ECHO_TIMEOUT_MS
  for (;;) {
    await clock.sleep(COPILOT_ECHO_POLL_MS)
    const lines = target.readScreen()
    if (isCopilotPasteEchoed(lines, pasteText)) return true
    // シェルのモード(!)に入った・時間切れ: Enter を送らない(確認の画面の選択肢を確定させない)
    if (locateCopilotInputBox(copilotScreenTexts(lines))?.symbol === 'shell') return false
    if (clock.now() >= deadline) return false
  }
}

/** 手順 7: Enter の後に、帯が作業中になるか入力欄が空に戻るのを待つ。確かめられたら true、上限を過ぎたら false */
async function waitForSubmit(target: AgentSendTarget, clock: AgentSendClock): Promise<boolean> {
  const deadline = clock.now() + COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS
  for (;;) {
    await clock.sleep(COPILOT_SUBMIT_CONFIRM_POLL_MS)
    const lines = target.readScreen()
    // 即答では作業中が約 36ms しか見えず入力待ちに戻るが、そのときは入力欄が空なので拾える(記録の 4)
    if (classifyCopilotScreen(lines) === 'working' || readCopilotInputState(lines) === 'empty') {
      return true
    }
    if (clock.now() >= deadline) return false
  }
}

/**
 * プロンプトを copilot の入力欄へ送る。正規化 → bracketed paste の確認 → 入力待ちと空の確かめ → 括弧付きの貼り付け(1 回の書き込み)
 * → echo の確かめ → 別の書き込みの Enter → 送れたことの確かめ。どこかで確かめられなければ failed を返す
 */
export async function sendCopilotPrompt(
  target: AgentSendTarget,
  rawText: string,
  clock: AgentSendClock = realClock
): Promise<AgentSendOutcome> {
  const normalized = normalizeAgentPrompt(rawText, 'copilot')
  if (normalized.kind === 'rejected') return failed(normalized.reason)
  // bracketed paste が無効のまま送ると、本文の改行がそれぞれ Enter になり途中で送信される
  if (!target.isBracketedPasteEnabled()) return failed('not-accepting')
  const blocked = await waitForEmptyInput(target, clock)
  if (blocked !== null) return failed(blocked)
  // 送る時点の入力欄は空なので、消去のキーは送らない。echo の確かめは実際に貼った本文で行う
  const pasteText = buildCopilotPasteText(normalized.text)
  target.write(buildAgentPasteBytes(pasteText))
  if (!(await waitForEcho(target, pasteText, clock))) return failed('not-echoed')
  // 貼り付けとは別の書き込み(本文が入力欄に入ったことを確かめてから送る。記録の 3)
  target.write(AGENT_SUBMIT_KEY)
  // 確かめられなくても Enter は送り直さない(送れていることがある。L-001)
  if (!(await waitForSubmit(target, clock))) return failed('not-confirmed')
  // 書きかけを消さないので clearedDraft は常に false
  return { kind: 'sent', clearedDraft: false }
}
```

`src/renderer/src/lib/agentPromptSendSpecs.ts` を作る:

```ts
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentSendClock, AgentSendOutcome, AgentSendTarget } from './agentPromptSend'
import { sendClaudePrompt } from './claudePromptSend'
import { sendCopilotPrompt } from './copilotPromptSend'

// CLI の種類ごとの送信の手順(段階 2a の判定の表 agentScreenClassifiers.ts と同じ流儀。L-593)。本文の検査(先頭の文字)は
// shared/agentPasteText.ts の AGENT_PROMPT_TEXT_RULES、失敗の文言は agentSendMessages.ts の AGENT_SEND_FAILURE_KIND_TEXTS にある

export interface AgentPromptSendSpec {
  /**
   * 押せる条件に「画面の活動が入力待ち(idle)」と「そのタブが中断の流れの外」を入れるか。作業中の Enter を送信待ちに積む CLI
   * (claude)は false、作業中の Enter が勝手に送られる送信待ちになり、中断が Esc 2 回の CLI(copilot)は true
   */
  requiresIdle: boolean
  /** 送信の手順。正規化(normalizeAgentPrompt(raw, kind))から Enter(と送れたことの確かめ)まで。例外は投げうる(呼び出し側が文言にする) */
  send: (
    target: AgentSendTarget,
    rawText: string,
    clock: AgentSendClock
  ) => Promise<AgentSendOutcome>
}

export const AGENT_PROMPT_SEND_SPECS: Record<AgentCliKind, AgentPromptSendSpec> = {
  claude: { requiresIdle: false, send: sendClaudePrompt },
  copilot: { requiresIdle: true, send: sendCopilotPrompt }
}
```

- [ ] **Step 7: `useAgentPromptSender` は手順を表から引く（`claude` の挙動は変わらない）**

`src/renderer/src/hooks/useAgentPromptSender.ts`:

1. `import { sendAgentPrompt, realClock } from '../lib/agentPromptSend'` を次の 2 行にする:

```ts
import { realClock } from '../lib/agentPromptSend'
import { AGENT_PROMPT_SEND_SPECS } from '../lib/agentPromptSendSpecs'
```

2. `const outcome = await sendAgentPrompt(` から `)` までを次にする（送り先に `readScreen` を足す）:

```ts
// 手順は送り先の CLI の種類の表から引く(claude は今の手順のまま。copilot は画面の末尾を読む)
const outcome = await AGENT_PROMPT_SEND_SPECS[target.cliKind].send(
  {
    isBracketedPasteEnabled: () => controller.isBracketedPasteEnabled(),
    readViewport: () => controller.readViewport(),
    readScreen: () => controller.readScreen(),
    getCols: () => controller.getSize().cols,
    write: (data) => controller.writeToSession(data)
  },
  text,
  clock
)
```

3. `catch` の中のコメント `// write・readViewport が例外を投げると sendAgentPrompt は reject する。実行ボタンの処理へ` を `// write・画面の読み取りが例外を投げると送信の手順は reject する。実行ボタンの処理へ` にし、`console.error('[useAgentPromptSender] sendAgentPrompt failed:', err)` を `console.error('[useAgentPromptSender] 送信の手順が失敗しました:', err)` にする（テストがこの文字列を見ていないことを `grep -rn "sendAgentPrompt failed" src` で確かめる。出たらテストの期待も同じ文字列に直す）

- [ ] **Step 8: テストが通ることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/copilotPromptSend.test.ts src/renderer/src/lib/__tests__/agentPromptSendSpecs.test.ts src/renderer/src/lib/__tests__/copilotPromptSend.integration.test.ts src/renderer/src/lib/__tests__/claudePromptSend.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`
Expected: PASS（統合テストは Windows 以外で走る。負荷で時間切れになったら単体で流し直す）

- [ ] **Step 9: 変異で確かめる**

1. `copilotPromptSend.ts` の `waitForEmptyInput` の `if (consecutiveEmpty >= 2) return null` を `if (consecutiveEmpty >= 1) return null` にする → `空の入力欄を 2 回確かめ…`（貼る時刻が 50 でなく 0）・`空が 1 回だけで次が決められなければ…` が落ちる。戻す
2. `waitForSubmit` の `return false` の前に `target.write(AGENT_SUBMIT_KEY)` を足す（送り直し）→ `not-confirmed` のテスト（書いた列が `[貼り付け, '\r']`）と統合テストの `\r は 1 回だけ届く` が落ちる。戻す
3. `sendCopilotPrompt` の `buildCopilotPasteText(normalized.text)` を `normalized.text` にする → 末尾の `@` の語のテストが落ちる。戻す
4. `agentPromptSendSpecs.ts` の `copilot: { requiresIdle: true, send: sendCopilotPrompt }` を `copilot: { requiresIdle: true, send: sendClaudePrompt }` にする → `agentPromptSendSpecs.test.ts` が落ちる。戻す
5. `grep -n "consecutiveEmpty >= 2\|buildCopilotPasteText(normalized.text)\|send: sendCopilotPrompt" src/renderer/src/lib/copilotPromptSend.ts src/renderer/src/lib/agentPromptSendSpecs.ts` で 3 か所が戻っていることを、`grep -c "AGENT_SUBMIT_KEY" src/renderer/src/lib/copilotPromptSend.ts` が `2`（import と 1 回の書き込み）であることを確かめる

- [ ] **Step 10: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/lib/claudePromptSend.ts src/renderer/src/lib/copilotPromptSend.ts src/renderer/src/lib/agentPromptSendSpecs.ts src/renderer/src/lib/agentPromptSend.ts src/renderer/src/hooks/useAgentPromptSender.ts src/renderer/src/lib/__tests__/claudePromptSend.test.ts src/renderer/src/lib/__tests__/copilotPromptSend.test.ts src/renderer/src/lib/__tests__/agentPromptSendSpecs.test.ts src/renderer/src/lib/__tests__/copilotPromptSend.integration.test.ts`
Expected: エラー・警告なし（コメントを直したファイル〈`useAgentSendConfirm.ts`・`prepareClaudeScreen.ts`・`App.agentReferences.test.tsx`〉もあれば足す）
Run: 上と同じファイルへ `npx prettier --check`（外れたら、そのファイルだけを `npx prettier --write <ファイル>` で直す）
Expected: すべて整形済み
Run: `git status --short`
Expected: `src/renderer/src/lib/__tests__/agentPromptSend.test.ts` が削除（` D`）、`claudePromptSend.test.ts` が未追跡（`??`）として出る（`git mv` はしない）

---

### Task 5: 押せる条件の活動と中断の流れ・`copilot` の `promptSend`

> **設計書の読む節:** 「決めたこと（推奨案で決めた事項）」の「押せる条件」「中断との排他」、「押せる条件（`getPromptRunAvailability`・`getHistoryRerunAvailability`）」、「新しい状態と既存の入口」、「文言」の最後の 2 つ（設定の注記・`agentPromptSendUnsupportedReason`）、「テスト方針」の `agentCliKinds.test.ts`・`agentSendMessages.test.ts`・`promptRunState.test.ts`・`useAgentInterrupt.test.ts`、「構成」の `agentCliKinds.ts`・`promptRunState.ts`・`agentInterrupt.ts`・`useAgentInterrupt.ts`・`useAgentWorkspace.ts` の行。
>
> **気をつける知見:** L-058（押せる条件は 3 つの入口で同じ関数にし、活動は中断の判定と同じ写像〈`activities.get(slotId) ?? 'unknown'`〉で渡す）・L-037（送り先は押した時点のタブ。送信前の確認は開いた時点の送り先の種類とタブで求める）・L-594（中断の流れの間は `copilot` へ送らない。描画は state、押した時点は ref で見る）・L-060・L-593（`activity`・`isInterrupting` は省略できない形にし、`claude` は表の `requiresIdle: false` で活動を見ない。受け渡しを外す変異でテストが落ちることを確かめる）・L-061（新しい守りと既存の入口の表は設計書のとおり）

**Files:**

- Modify: `src/shared/agentCliKinds.ts`・`src/renderer/src/lib/agentSendMessages.ts`（押せる条件）・`src/renderer/src/lib/promptRunState.ts`・`src/renderer/src/lib/agentInterrupt.ts`（コメント）・`src/renderer/src/hooks/useAgentInterrupt.ts`・`src/renderer/src/hooks/useAgentWorkspace.ts`・`src/renderer/src/__tests__/agentCliCapabilityOverrides.ts`
- Test: `src/shared/__tests__/agentCliKinds.test.ts`・`src/renderer/src/lib/__tests__/agentSendMessages.test.ts`・`src/renderer/src/lib/__tests__/promptRunState.test.ts`・`src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`・`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`（送信に対応しない種類を能力の差し替えで作る）・`src/renderer/src/lib/__tests__/agentCliMessages.test.ts`・`src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx`、補助の型の変更に追随: `src/renderer/src/hooks/__tests__/useAgentActivity.test.ts`・`src/renderer/src/lib/__tests__/agentInterrupt.test.ts`

**Interfaces:**

- Consumes: `AGENT_PROMPT_SEND_SPECS`（Task 4）、`agentSendBlockedByActivityReason`・`RUN_DISABLED_INTERRUPTING`（Task 3）、`AgentActivity`（既存）、`useAgentInterruptCooldown` の `isPending`・`isInFlight`・`isCoolingDown`（既存）
- Produces（Task 6 が使う）:

```ts
// src/renderer/src/lib/agentSendMessages.ts(引数に足す。省略できない)
getPromptRunAvailability(params: { …今の項目; activity: AgentActivity; isInterrupting: boolean }): PromptRunAvailability
getHistoryRerunAvailability(params: { …今の項目; activity: AgentActivity; isInterrupting: boolean }): PromptRunAvailability
// src/renderer/src/lib/promptRunState.ts
interface PromptRunStateInput { …今の項目; activity: AgentActivity; isInterrupting: boolean }
// src/renderer/src/hooks/useAgentInterrupt.ts
export interface AgentInterruptState extends AgentInterruptPanelState {
  isInterrupting: (slotId: string) => boolean
  isInterruptPending: (slotId: string) => boolean
}
export function useAgentInterrupt(options: UseAgentInterruptOptions): AgentInterruptState
// src/renderer/src/__tests__/agentCliCapabilityOverrides.ts
interface AgentCliCapabilityOverrides { unsupportedKinds: Set<AgentCliKind>; promptSendUnsupportedKinds: Set<AgentCliKind> }
```

- [ ] **Step 1: 能力を差し替えるテストの補助に、送信を偽にする種類を足す**

`src/renderer/src/__tests__/agentCliCapabilityOverrides.ts` を次にする:

```ts
import type { AgentCliCapabilities, AgentCliKind } from '@shared/agentCliKinds'

// 能力の表を差し替えて「能力が無い種類」を作るテストの補助(設計書 2026-10-21「段階 1 の『判定しない・押せない』の扱い」、
// 2026-10-22「文言」の agentPromptSendUnsupportedReason)。今の表には画面の判定・中断・送信の能力が無い種類が無いため、
// vi.mock('@shared/agentCliKinds') の factory から使う

/** 差し替える種類(テストが足し、afterEach で消す) */
export interface AgentCliCapabilityOverrides {
  /** 画面の判定(screenActivity)と中断(interrupt)を偽にする種類 */
  unsupportedKinds: Set<AgentCliKind>
  /** プロンプトの送信(promptSend)を偽にする種類(段階 2b で copilot も送信に対応したため、送信に対応しない種類を作るときに使う) */
  promptSendUnsupportedKinds: Set<AgentCliKind>
}

/**
 * 本物の agentCliCapabilities を包み、unsupportedKinds の種類は screenActivity と interrupt を、promptSendUnsupportedKinds の種類は
 * promptSend を偽にして返す(能力の表の不変条件「interrupt が真なら screenActivity も真」を保つため、前者は両方を偽にする)
 */
export function overrideAgentCliCapabilities(
  actual: (kind: AgentCliKind) => AgentCliCapabilities,
  overrides: AgentCliCapabilityOverrides
): (kind: AgentCliKind) => AgentCliCapabilities {
  return (kind) => {
    const capabilities = { ...actual(kind) }
    if (overrides.unsupportedKinds.has(kind)) {
      capabilities.screenActivity = false
      capabilities.interrupt = false
    }
    if (overrides.promptSendUnsupportedKinds.has(kind)) capabilities.promptSend = false
    return capabilities
  }
}
```

今の 4 つの利用元の `vi.hoisted` の値に、新しい項目を足す（ASCII のパターン）:

```bash
cd <repo-root>
set -- src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/lib/__tests__/agentInterrupt.test.ts src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/hooks/__tests__/useAgentActivity.test.ts
perl -pi -e 's/unsupportedKinds: new Set(<AgentCliKind>)?\(\) \}\)/unsupportedKinds: new Set$1(), promptSendUnsupportedKinds: new Set$1() })/' "$@"
grep -c "promptSendUnsupportedKinds: new Set" "$@"
npx prettier --write "$@"
```

Expected: 各ファイル `1`

- [ ] **Step 2: 失敗するテストを書く（能力・押せる条件・パネルの状態）**

1. `src/shared/__tests__/agentCliKinds.test.ts` の `it('claude の能力はすべて真、copilot は screenActivity・interrupt だけ真(段階 2a)', () => {` を `it('claude の能力はすべて真、copilot は promptSend・screenActivity・interrupt だけ真(段階 2b)', () => {` にし、その中の `copilot` の期待の `promptSend: false,` を `promptSend: true,` にする

2. `src/renderer/src/lib/__tests__/agentCliMessages.test.ts`:
   - `afterEach` の中に `capabilityOverrides.promptSendUnsupportedKinds.clear()` を足す
   - `it('使えない機能の注記: copilot は送信・区別・再開の 3 つを並べ(段階 2a で画面の判定と中断に対応した)、claude は出さない', () => {` を `it('使えない機能の注記: copilot は区別・再開の 2 つを並べ(段階 2a で画面の判定と中断、段階 2b で送信に対応した)、claude は出さない', () => {` にし、期待を `'copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別、前回の続きから・このセッションで再開'` にする
   - `it('使えない機能の注記: 画面の判定と中断が無い種類(能力の表を差し替えた copilot)は、その 2 つの名前も並べる', () => {` の期待を `'copilot では次の機能を使えません（ターミナルで直接操作します）: 作業中・入力待ちの表示と通知、中断、利用者の変更との区別、前回の続きから・このセッションで再開'` にする
   - その後に次を足す:

```ts
it('使えない機能の注記: 送信が無い種類(能力の表を差し替えた copilot)は、送信の名前も並べる', () => {
  capabilityOverrides.promptSendUnsupportedKinds.add('copilot')
  expect(agentCliUnsupportedFeaturesNote('copilot')).toBe(
    'copilot では次の機能を使えません（ターミナルで直接操作します）: プロンプトの送信（実行・再実行）、利用者の変更との区別、前回の続きから・このセッションで再開'
  )
})
```

3. `src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx` の `it('copilot を選んでいると、使えない機能の注記に能力の表で使えない機能(送信・区別・再開)を出す', () => {` を `it('copilot を選んでいると、使えない機能の注記に能力の表で使えない機能(区別・再開)を出す', () => {` にし、`getByText` の文字列を `'copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別、前回の続きから・このセッションで再開'` にする

4. `src/renderer/src/lib/__tests__/agentSendMessages.test.ts`:
   - 先頭の `import { describe, it, expect } from 'vitest'` を `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'` にし、その下に次を足す（送信に対応しない種類を、能力の表の差し替えで作る）:

```ts
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

// 段階 2b で copilot も送信に対応したため、送信に対応しない種類の理由は能力の表を差し替えて確かめる
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({
    unsupportedKinds: new Set<AgentCliKind>(),
    promptSendUnsupportedKinds: new Set<AgentCliKind>()
  })
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
  capabilityOverrides.promptSendUnsupportedKinds.clear()
})
```

- `describe('getPromptRunAvailability', () => {` の `const base = {` と、`describe('getHistoryRerunAvailability(履歴のエントリごとの 再実行)', () => {` の `const base = {` のそれぞれで、`cliKind: 'claude' as const,` の次の行に `activity: 'idle' as const,` と `isInterrupting: false,` を足す
- `describe('送信の入口の CLI の種類(送り先のタブの cliKind)', () => {` の `const COPILOT = …` の前に次を足し、`const running = {` の `cliKind: 'copilot' as const,` の次の行に `activity: 'idle' as const,` と `isInterrupting: false,` を足す:

```ts
// 送信に対応しない種類の扱い(段階 1 の守り)を、能力の表で copilot の送信を偽にして確かめる
beforeEach(() => {
  capabilityOverrides.promptSendUnsupportedKinds.add('copilot')
})
```

- `import` の `agentSendMessages` から `RUN_DISABLED_INTERRUPTING`・`agentSendBlockedByActivityReason` を import していることを確かめ（Task 3 で足した）、ファイルの末尾に次を足す:

```ts
describe('押せる条件の活動と中断の流れ(requiresIdle の種類だけが見る)', () => {
  const copilotIdle = {
    mode: 'agent-cli' as const,
    isExecuting: false,
    cliKind: 'copilot' as const,
    isSessionRunning: true,
    isSessionClosing: false,
    isSending: false,
    activity: 'idle' as const,
    isInterrupting: false
  }

  it('copilot が入力待ちで中断の流れの外なら押せる', () => {
    expect(getPromptRunAvailability(copilotIdle)).toEqual({ disabled: false, reason: null })
  })

  it.each(['working', 'permission', 'confirm', 'unknown'] as const)(
    'copilot の活動が %s なら押せず、活動の理由を出す',
    (activity) => {
      expect(getPromptRunAvailability({ ...copilotIdle, activity })).toEqual({
        disabled: true,
        reason: agentSendBlockedByActivityReason(activity, 'copilot')
      })
    }
  )

  it('copilot が中断の流れの間なら RUN_DISABLED_INTERRUPTING(活動の理由より先)', () => {
    expect(getPromptRunAvailability({ ...copilotIdle, isInterrupting: true })).toEqual({
      disabled: true,
      reason: RUN_DISABLED_INTERRUPTING
    })
    expect(
      getPromptRunAvailability({ ...copilotIdle, activity: 'working', isInterrupting: true })
    ).toEqual({ disabled: true, reason: RUN_DISABLED_INTERRUPTING })
  })

  it('閉じる途中・動いていない・送信中の理由は、中断の流れと活動の理由より先', () => {
    const busy = { ...copilotIdle, activity: 'working' as const, isInterrupting: true }
    expect(getPromptRunAvailability({ ...busy, isSessionClosing: true }).reason).toBe(
      RUN_DISABLED_CLOSING
    )
    expect(getPromptRunAvailability({ ...busy, isSessionRunning: false }).reason).toBe(
      RUN_DISABLED_NO_SESSION
    )
    expect(getPromptRunAvailability({ ...busy, isSending: true }).reason).toBe(RUN_DISABLED_SENDING)
  })

  it.each(['working', 'permission', 'confirm', 'unknown', 'idle'] as const)(
    'claude は活動(%s)と中断の流れに関わらず、今と同じく押せる',
    (activity) => {
      for (const isInterrupting of [false, true]) {
        expect(
          getPromptRunAvailability({ ...copilotIdle, cliKind: 'claude', activity, isInterrupting })
        ).toEqual({ disabled: false, reason: null })
      }
    }
  )

  it('履歴の再実行も同じ(記録したフォルダの理由が先)', () => {
    const entry = { ...copilotIdle, recordedFolderPath: '/repo', folderPath: '/repo' }
    expect(getHistoryRerunAvailability({ ...entry, activity: 'working' })).toEqual({
      disabled: true,
      reason: agentSendBlockedByActivityReason('working', 'copilot')
    })
    expect(getHistoryRerunAvailability({ ...entry, isInterrupting: true }).reason).toBe(
      RUN_DISABLED_INTERRUPTING
    )
    expect(
      getHistoryRerunAvailability({ ...entry, folderPath: '/other', activity: 'working' })
    ).toEqual({ disabled: true, reason: rerunDisabledAgentEntryFolderMismatch('/repo') })
    expect(getHistoryRerunAvailability(entry)).toEqual({ disabled: false, reason: null })
  })
})
```

5. `src/renderer/src/lib/__tests__/promptRunState.test.ts`:
   - `const base: PromptRunStateInput = {` の `cliKind: 'claude',` の次の行に `activity: 'idle',` と `isInterrupting: false,` を足す
   - `it('エージェント CLI 方式で送り先が copilot なら、running でも押せず理由を出す', () => {` のテストを次に置き換える:

```ts
it('エージェント CLI 方式で送り先が copilot なら、活動と中断の流れが押せる条件に渡る', () => {
  const copilot = {
    ...base,
    mode: 'agent-cli' as const,
    cliKind: 'copilot' as const,
    sessionStatus: 'running' as const
  }
  expect(buildPromptRunPanelState(copilot)).toMatchObject({
    isRunDisabled: false,
    runDisabledReason: null
  })
  expect(buildPromptRunPanelState({ ...copilot, activity: 'working' })).toMatchObject({
    isRunDisabled: true,
    runDisabledReason:
      'copilot が作業中のため送信できません（作業が終わって入力待ちになってから、もう一度実行してください）'
  })
  expect(buildPromptRunPanelState({ ...copilot, isInterrupting: true })).toMatchObject({
    isRunDisabled: true,
    runDisabledReason:
      '中断を送ったばかりのため送信できません（1 秒ほど待ってから、もう一度実行してください）'
  })
})
```

6. `src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts`:
   - 型の名前を広げる（テストの補助の戻り値の型）: `perl -pi -e 's/\bAgentInterruptPanelState\b/AgentInterruptState/g' src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts`
   - ファイルの末尾に次を足す:

```ts
describe('useAgentInterrupt: 送信の判定に使う中断の流れ(isInterrupting・isInterruptPending)', () => {
  it('claude: 押す前は偽、押してから 1,000ms の待ちの間だけ真で、isInterrupting の参照は描画をまたいで同じ', async () => {
    const { result, rerender } = render()
    const first = result.current.isInterrupting
    expect(result.current.isInterrupting('slot-1')).toBe(false)
    expect(result.current.isInterruptPending('slot-1')).toBe(false)
    await press(result)
    expect(result.current.isInterrupting('slot-1')).toBe(true)
    expect(result.current.isInterruptPending('slot-1')).toBe(true)
    // 待ちはタブごと
    expect(result.current.isInterrupting('slot-2')).toBe(false)
    advance(AGENT_INTERRUPT_COOLDOWN_MS - 1)
    expect(result.current.isInterrupting('slot-1')).toBe(true)
    expect(result.current.isInterruptPending('slot-1')).toBe(true)
    advance(1)
    expect(result.current.isInterrupting('slot-1')).toBe(false)
    expect(result.current.isInterruptPending('slot-1')).toBe(false)
    rerender({
      selected: tab1,
      activities: workingOf('slot-1'),
      isSending: false,
      isSendConfirmOpen: false
    })
    expect(result.current.isInterrupting).toBe(first)
  })

  it('1 回目の結果が 1,000ms を超えて届かない間も真(isInFlight を合わせている)', async () => {
    const deferred = deferredOutcome()
    interrupt.mockReturnValueOnce(deferred.promise)
    const { result } = render()
    await press(result)
    await advanceAsync(AGENT_INTERRUPT_COOLDOWN_MS + 500)
    expect(result.current.isInterrupting('slot-1')).toBe(true)
    expect(result.current.isInterruptPending('slot-1')).toBe(true)
    await act(async () => {
      deferred.resolve({ kind: 'sent', followUp: null })
    })
    expect(result.current.isInterrupting('slot-1')).toBe(false)
    expect(result.current.isInterruptPending('slot-1')).toBe(false)
  })

  it('copilot: 2 回目の流れが 1,000ms を超えて続く間も真で、流れが終わってから 1,000ms の待ちを数え直す', async () => {
    const copilot1 = copilotTab('slot-1', 1)
    interrupt.mockResolvedValue({ kind: 'sent', followUp: { afterMs: 1_200, sessionId: 'sid-1' } })
    const { result } = render({ selected: copilot1, activities: workingOf('slot-1') })
    await press(result)
    // 2 回目を頼む前(押してから 1,100ms。押した時点からの 1,000ms の待ちは明けている)
    await advanceAsync(1_100)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(result.current.isInterrupting('slot-1')).toBe(true)
    expect(result.current.isInterruptPending('slot-1')).toBe(true)
    // 2 回目を頼み、流れが終わる(ここから 1,000ms の待ちを数え直す)
    await advanceAsync(100)
    expect(interruptFollowUp).toHaveBeenCalledTimes(1)
    await advanceAsync(AGENT_INTERRUPT_COOLDOWN_MS - 1)
    expect(result.current.isInterrupting('slot-1')).toBe(true)
    expect(result.current.isInterruptPending('slot-1')).toBe(true)
    await advanceAsync(1)
    expect(result.current.isInterrupting('slot-1')).toBe(false)
    expect(result.current.isInterruptPending('slot-1')).toBe(false)
  })
})
```

（`copilotTab`・`advanceAsync`・`deferredOutcome`・`workingOf`・`render`・`press`・`advance` はこのファイルの既存の補助。`copilotTab` と `advanceAsync` は `describe('useAgentInterrupt(2 回目の要る種類: copilot)'` の前で定義されているので、足す `describe` はファイルの末尾に置けば使える）

7. `src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`（`copilot` が送信に対応したので、送信に対応しない種類を能力の差し替えで作る）:
   - 先頭の `import { describe, it, expect, vi, afterEach } from 'vitest'` の下に、上の 4 の `agentSendMessages.test.ts` と同じ `import type { AgentCliKind } …`・`import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'`・`const capabilityOverrides = vi.hoisted(…)`・`vi.mock('@shared/agentCliKinds', …)` を足す（`vi.mock` の factory の import のパスは `'../../__tests__/agentCliCapabilityOverrides'` のまま。4 のブロックの最後の `afterEach` は足さない）。今の `afterEach(() => { vi.useRealTimers() })` に `capabilityOverrides.promptSendUnsupportedKinds.clear()` を足す
   - `describe('useAgentPromptSender: 送信に対応しない CLI(copilot)の送り先', () => {` を `describe('useAgentPromptSender: 送信に対応しない CLI(能力の表で送信を偽にした copilot)の送り先', () => {` にし、その中の `it(` の直前に次を足す:

```ts
beforeEach(() => {
  capabilityOverrides.promptSendUnsupportedKinds.add('copilot')
})
```

（`beforeEach` を vitest の import に足す）

8. `src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:
   - ファイルの先頭の `afterEach` の `capabilityOverrides.unsupportedKinds.clear()` の次の行に `capabilityOverrides.promptSendUnsupportedKinds.clear()` を足す
   - `describe('送信の入口の CLI の種類(選択中のタブの cliKind)', () => {` の `const COPILOT = agentPromptSendUnsupportedReason('copilot')` の前に次を足す:

```ts
// 送信に対応しない種類の入口の守り(段階 1)と、能力の判定に使う種類の選び方(agentCapabilityCliKindOf)を、能力の表で
// copilot の送信を偽にして確かめる(段階 2b で copilot も送信に対応した)
beforeEach(() => {
  capabilityOverrides.promptSendUnsupportedKinds.add('copilot')
})
```

- `describe('使う CLI の配線(本物の useAgentSessions。L-060)', () => {` の中の 2 つのテストを直す（活動は偽の `useAgentActivity` が空の Map を返すので `unknown`）:
  - `it('設定が copilot なら、未起動のタブの名前は copilot で、起動すると実行・前回の続きから・このセッションで再開は copilot の理由で押せず、中断は活動の理由で押せない', async () => {` を `it('設定が copilot なら、未起動のタブの名前は copilot で、起動すると実行と中断は活動の理由で押せず、前回の続きから・このセッションで再開は copilot の理由で押せない', async () => {` にし、`runDisabledReason: agentPromptSendUnsupportedReason('copilot')` を `runDisabledReason: agentSendBlockedByActivityReason('unknown', 'copilot')` にする
  - `it('起動の結果が copilot なら、設定が claude のままでも(別のウィンドウで変えた場合)そのタブの実行は押せない', async () => {` を `it('起動の結果が copilot なら、設定が claude のままでも(別のウィンドウで変えた場合)そのタブの実行は copilot の活動で決まる', async () => {` にし、`expect(result.current.promptRun.runDisabledReason).toBe(agentPromptSendUnsupportedReason('copilot'))` を `expect(result.current.promptRun.runDisabledReason).toBe(agentSendBlockedByActivityReason('unknown', 'copilot'))` にする
- import の `'../../lib/agentSendMessages'` に `RUN_DISABLED_INTERRUPTING`・`agentSendBlockedByActivityReason` を足す
- `describe('送信の入口の CLI の種類(選択中のタブの cliKind)', () => {` のブロックの閉じ括弧の後（`describe('送信前の確認', () => {` の前）に次を足す:

```ts
describe('送信の押せる条件の活動と中断の流れ(copilot は入力待ちで中断の流れの外だけ。L-058)', () => {
  const agentEntry: HistoryEntry = {
    id: 'h-activity',
    promptId: 'p1',
    promptTitle: '要約',
    promptContent: '本文',
    fileContent: null,
    toolId: 'claude',
    status: 'sent',
    resultText: null,
    errorMessage: null,
    executedAt: 1000,
    agent: {
      claudeSessionId: '11111111-1111-4111-8111-111111111111',
      tabLabel: 'claude 1',
      folderPath: '/p'
    }
  }
  const WORKING = agentSendBlockedByActivityReason('working', 'copilot')
  const runningTabOf = (cliKind: AgentCliKind): ReturnType<typeof makeAgentSessionsState> =>
    makeAgentSessionsState({ selected: { status: 'running', cliKind } })
  const activityOf = (activity: AgentActivity): ReadonlyMap<string, AgentActivity> =>
    new Map([['slot-1', activity]])

  it('選択中の copilot のタブが作業中なら、実行・再実行・送信前の確認の理由が活動の理由になる', async () => {
    setMode('agent-cli')
    mockUseAgentSessions.mockReturnValue(runningTabOf('copilot'))
    mockUseAgentActivity.mockReturnValue(activityOf('working'))
    const { result } = renderWorkspace({ folderPath: '/p' })
    expect(result.current.promptRun).toMatchObject({
      isRunDisabled: true,
      runDisabledReason: WORKING
    })
    expect(result.current.getHistoryActions(agentEntry).rerun).toEqual({
      disabled: true,
      reason: WORKING
    })
    await act(async () => {
      await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
    })
    expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(WORKING)
    expect(result.current.agentSendConfirmDialog.pending?.cliKind).toBe('copilot')
  })

  it('選択中の copilot のタブが入力待ちなら、実行・再実行を押せる', () => {
    setMode('agent-cli')
    mockUseAgentSessions.mockReturnValue(runningTabOf('copilot'))
    mockUseAgentActivity.mockReturnValue(activityOf('idle'))
    const { result } = renderWorkspace({ folderPath: '/p' })
    expect(result.current.promptRun).toMatchObject({
      isRunDisabled: false,
      runDisabledReason: null
    })
    expect(result.current.getHistoryActions(agentEntry).rerun).toEqual({
      disabled: false,
      reason: null
    })
  })

  it('活動が未記録のタブは unknown として扱う(中断の判定と同じ写像)', () => {
    setMode('agent-cli')
    mockUseAgentSessions.mockReturnValue(runningTabOf('copilot'))
    mockUseAgentActivity.mockReturnValue(new Map())
    const { result } = renderWorkspace({ folderPath: '/p' })
    expect(result.current.promptRun.runDisabledReason).toBe(
      agentSendBlockedByActivityReason('unknown', 'copilot')
    )
  })

  it('claude のタブは作業中でも実行・再実行を押せる(今のまま)', () => {
    setMode('agent-cli')
    mockUseAgentSessions.mockReturnValue(runningTabOf('claude'))
    mockUseAgentActivity.mockReturnValue(activityOf('working'))
    const { result } = renderWorkspace({ folderPath: '/p' })
    expect(result.current.promptRun).toMatchObject({
      isRunDisabled: false,
      runDisabledReason: null
    })
    expect(result.current.getHistoryActions(agentEntry).rerun).toEqual({
      disabled: false,
      reason: null
    })
  })

  it('中断を押した直後は、実行・再実行・送信前の確認の理由が RUN_DISABLED_INTERRUPTING で、1,000ms の待ちが明けると活動の理由に戻る', async () => {
    setMode('agent-cli')
    const sessions = runningTabOf('copilot')
    const controller = sessions.selected.controller as FakeController
    controller.screen = copilotScreen('working3000').lines
    mockUseAgentSessions.mockReturnValue(sessions)
    mockUseAgentActivity.mockReturnValue(activityOf('working'))
    const { result } = renderWorkspace({ folderPath: '/p' })
    await act(async () => {
      result.current.agentTerminal.interrupt.onInterrupt()
    })
    expect(sessions.interrupt).toHaveBeenCalledExactlyOnceWith('slot-1')
    expect(result.current.promptRun.runDisabledReason).toBe(RUN_DISABLED_INTERRUPTING)
    expect(result.current.getHistoryActions(agentEntry).rerun.reason).toBe(
      RUN_DISABLED_INTERRUPTING
    )
    await act(async () => {
      await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [] })
    })
    expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(
      RUN_DISABLED_INTERRUPTING
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, AGENT_INTERRUPT_COOLDOWN_MS + 100))
    })
    expect(result.current.promptRun.runDisabledReason).toBe(WORKING)
    expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(WORKING)
  })

  it('パネル(agentTerminal.interrupt)には中断の UI の値だけを渡す(送信の判定の値は渡さない)', () => {
    setMode('agent-cli')
    const { result } = renderWorkspace()
    expect(Object.keys(result.current.agentTerminal.interrupt).sort()).toEqual([
      'disabledReason',
      'notice',
      'onInterrupt',
      'visible'
    ])
  })
})
```

- `import type { AgentActivity } from '../../lib/agentActivity'` が無ければ足す

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `npx vitest run src/shared/__tests__/agentCliKinds.test.ts src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/lib/__tests__/promptRunState.test.ts src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`
Expected: FAIL（`copilot` の `promptSend` が偽・押せる条件が活動と中断の流れを見ない・`isInterrupting` が無い・パネルに余分な値が無い〈今はパネルにちょうど 4 つの値なのでこのテストだけは通る〉）

- [ ] **Step 4: 能力の表と押せる条件**

1. `src/shared/agentCliKinds.ts`:
   - `promptSend` の JSDoc `/** 実行ボタン・履歴の再実行・送信前の確認からの送信(入力欄の判定・消去・貼り付け) */` を次にする:

```ts
/** 実行ボタン・履歴の再実行・送信前の確認からの送信(入力欄の判定・貼り付け)。押せる条件と手順は renderer の agentPromptSendSpecs.ts */
```

- `copilot` の `promptSend: false,` を `promptSend: true,` にする

2. `src/renderer/src/lib/agentSendMessages.ts`:
   - import に `import { AGENT_PROMPT_SEND_SPECS } from './agentPromptSendSpecs'` を足す（`import { isSamePath } from './pathUtils'` の前）
   - `getPromptRunAvailability` の JSDoc と関数を次に置き換える:

```ts
/** 実行ボタンを押せるか(設計書 C13: エージェント CLI 方式は「セッションが running で、送信中でない」。複数タブでは加えて
 *  「送り先のタブが閉じる途中でない」。閉じる途中のタブへ送ると、止めたセッションに届かず捨てられるため)。
 *  送り先の CLI が送信に対応していなければ押せない。送り先の種類の手順が requiresIdle(copilot)なら、加えて「送り先のタブが
 *  中断の流れの外」で「画面の活動が入力待ち」のときだけ押せる(設計書 2026-10-22「押せる条件」。claude は活動を見ない) */
export function getPromptRunAvailability(params: {
  mode: PromptExecutionMode | null
  isExecuting: boolean
  /** 能力の判定に使う CLI の種類。実行ボタンでは agentCapabilityCliKindOf で選ぶ(動いているタブはタブの種類〈起動の結果の種類〉、
   *  未起動・終了したタブは次に起動する設定の種類)。送信前の確認では、確認を開いた時点に控えた送り先の種類を渡す */
  cliKind: AgentCliKind
  isSessionRunning: boolean
  isSessionClosing: boolean
  isSending: boolean
  /** 送り先のタブの活動(activities.get(slotId) ?? 'unknown'。中断の判定と同じ写像)。requiresIdle の種類だけが見る */
  activity: AgentActivity
  /** 送り先のタブが中断の流れの間か(useAgentInterrupt の isInterruptPending)。requiresIdle の種類だけが見る */
  isInterrupting: boolean
}): PromptRunAvailability {
  if (params.mode === null) return { disabled: true, reason: RUN_DISABLED_LOADING_MODE }
  if (params.mode === 'legacy') return { disabled: params.isExecuting, reason: null }
  const { commandName } = AGENT_CLI_PROFILES[params.cliKind]
  // 送り先の CLI が送信に対応していない。実行ボタンでは未起動・終了したタブの種類は次に起動する設定の種類なので
  // (呼び出し側が agentCapabilityCliKindOf で選ぶ)、起動しても送れない。閉じる途中・未起動より前に見る
  if (!agentCliCapabilities(params.cliKind).promptSend) {
    return { disabled: true, reason: agentPromptSendUnsupportedReason(commandName) }
  }
  if (params.isSessionClosing) return { disabled: true, reason: RUN_DISABLED_CLOSING }
  if (!params.isSessionRunning) return { disabled: true, reason: RUN_DISABLED_NO_SESSION }
  if (params.isSending) return { disabled: true, reason: RUN_DISABLED_SENDING }
  if (AGENT_PROMPT_SEND_SPECS[params.cliKind].requiresIdle) {
    // 中断の 2 回目を待つ間に貼り付けると、2 回目の Esc が貼った本文を消しうる(L-594)
    if (params.isInterrupting) return { disabled: true, reason: RUN_DISABLED_INTERRUPTING }
    // 作業中の Enter は送信待ちになり、作業が終わると勝手に送られる。許可待ち・確認待ちの画面へ貼らない
    if (params.activity !== 'idle') {
      return {
        disabled: true,
        reason: agentSendBlockedByActivityReason(params.activity, commandName)
      }
    }
  }
  return { disabled: false, reason: null }
}
```

- `getHistoryRerunAvailability` の引数の型の `isSending: boolean` の次に足す（関数の中身は変えない。最後の `return getPromptRunAvailability(params)` が新しい項目も渡す）:

```ts
/** 送り先(選択中のタブ)の活動と中断の流れ(getPromptRunAvailability と同じ) */
activity: AgentActivity
isInterrupting: boolean
```

3. `src/renderer/src/lib/promptRunState.ts`:
   - import に `import type { AgentActivity } from './agentActivity'` を足す
   - `PromptRunStateInput` の `isSending: boolean` の次に足す:

```ts
/** 送り先のタブ(選択中のタブ)の活動(activities.get(slotId) ?? 'unknown') */
activity: AgentActivity
/** 送り先のタブが中断の流れの間か(useAgentInterrupt の isInterruptPending) */
isInterrupting: boolean
```

- `buildPromptRunPanelState` の分割代入に `activity,`・`isInterrupting,` を足し、`getPromptRunAvailability({ … })` の `isSending` の次の行に `activity,` と `isInterrupting` を足す

4. `src/renderer/src/lib/agentInterrupt.ts` の `checkAgentInterruptFollowUp` の JSDoc の `(送信は copilot では使えず〈promptSend が false〉、閉じる途中は useAgentSessions の interruptFollowUp が stale で止める)` を次にする:

```ts
 * (送信中は 1 回目を押せず、中断の流れの間は送信を始めない〈useAgentPromptSender と押せる条件の requiresIdle〉ので、2 回目を待つ間に
 * 送信が始まることはない。閉じる途中は useAgentSessions の interruptFollowUp が stale で止める)
```

- [ ] **Step 5: `useAgentInterrupt` の戻り値に中断の流れを足し、`useAgentWorkspace` の 3 つの入口へ渡す**

1. `src/renderer/src/hooks/useAgentInterrupt.ts`:
   - `export interface AgentInterruptPanelState { … }` の後に次を足す:

```ts
/**
 * useAgentInterrupt の戻り値。パネル(AgentTerminalPanel)へは AgentInterruptPanelState の値だけを渡し、送信の判定に使う 2 つは
 * useAgentWorkspace が使う(設計書 2026-10-22「中断との排他」)
 */
export interface AgentInterruptState extends AgentInterruptPanelState {
  /** 押した時点用: そのタブが中断の流れの間(1 回目を送ってから 2 回目の流れが終わり、1,000ms の待ちが明けるまで)。ref で常に最新。参照は安定 */
  isInterrupting: (slotId: string) => boolean
  /** 描画用: isInterrupting と同じ間(state)。実行・再実行・送信前の確認の押せない理由に使う */
  isInterruptPending: (slotId: string) => boolean
}
```

- `}: UseAgentInterruptOptions): AgentInterruptPanelState {` を `}: UseAgentInterruptOptions): AgentInterruptState {` にする
- `const onInterrupt = useCallback(` の前に次を足す:

```ts
// 送信の押した時点の判定用(useAgentPromptSender)。isCoolingDown だけでは、1 回目の結果や 2 回目の流れが 1,000ms を超えたときに
// 流れの途中で偽になるため、結果を待っている間(isInFlight)も合わせる
const isInterrupting = useCallback(
  (slotId: string): boolean => isInFlight(slotId) || isCoolingDown(slotId),
  [isInFlight, isCoolingDown]
)
```

- 最後の `return { visible: …, disabledReason: …, notice, onInterrupt }` に `isInterrupting,` と `isInterruptPending: cooldown.isPending` を足す

2. `src/renderer/src/hooks/useAgentWorkspace.ts`:
   - `const agentInterrupt = useAgentInterrupt({ … })` の直後に次を足す:

```ts
// 実行・再実行・送信前の確認の押せる条件に渡す、送り先のタブの活動(中断の判定と同じ写像。L-058)。requiresIdle の種類(copilot)だけが見る
const activityOf = (slotId: string): AgentActivity => activities.get(slotId) ?? 'unknown'
```

- `targetBlockedReason` の `getPromptRunAvailability({ … })` の `isSending: agentSender.isSending` の次の行に次の 2 行を足す（`isSending: agentSender.isSending` の後ろに `,` を足す）:

```ts
          activity: activityOf(pendingSend.target.slotId),
          isInterrupting: agentInterrupt.isInterruptPending(pendingSend.target.slotId)
```

- `buildPromptRunPanelState({ … })` の `isSending: agentSender.isSending,` の次の行に次の 2 行を足す:

```ts
    activity: activityOf(agentSessions.selected.slotId),
    isInterrupting: agentInterrupt.isInterruptPending(agentSessions.selected.slotId),
```

- `getHistoryActions` の `getHistoryRerunAvailability({ … })` の `isSending: agentSender.isSending` の次の行に次の 2 行を足す（`isSending: agentSender.isSending` の後ろに `,` を足す）:

```ts
      activity: activityOf(agentSessions.selected.slotId),
      isInterrupting: agentInterrupt.isInterruptPending(agentSessions.selected.slotId)
```

- `agentTerminal: { … interrupt: agentInterrupt, … }` の `interrupt: agentInterrupt,` を次にする（パネルには中断の UI の値だけを渡す）:

```ts
      interrupt: {
        visible: agentInterrupt.visible,
        disabledReason: agentInterrupt.disabledReason,
        notice: agentInterrupt.notice,
        onInterrupt: agentInterrupt.onInterrupt
      },
```

- [ ] **Step 6: テストが通ることを確かめる**

```bash
cd <repo-root>
npx prettier --write src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/lib/__tests__/promptRunState.test.ts src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx src/shared/__tests__/agentCliKinds.test.ts
npx vitest run src/shared/__tests__/agentCliKinds.test.ts src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/lib/__tests__/promptRunState.test.ts src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useAgentActivity.test.ts src/renderer/src/lib/__tests__/agentInterrupt.test.ts
```

Expected: PASS

- [ ] **Step 7: 変異で確かめる（受け渡しを 1 つずつ外す。L-060）**

`src/renderer/src/hooks/useAgentWorkspace.ts` を 1 つずつ一時的に変え、`npx vitest run src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts -t "送信の押せる条件の活動と中断の流れ"` を流して落ちることを確かめ、戻す:

1. `buildPromptRunPanelState` の `activity: activityOf(agentSessions.selected.slotId),` を `activity: 'idle',` にする → `作業中なら、実行・再実行・送信前の確認の理由が活動の理由になる` が落ちる
2. `buildPromptRunPanelState` の `isInterrupting: agentInterrupt.isInterruptPending(agentSessions.selected.slotId),` を `isInterrupting: false,` にする → `中断を押した直後は…` が落ちる
3. `targetBlockedReason` の `activity: activityOf(pendingSend.target.slotId),` を `activity: 'idle',` にする → `作業中なら、実行・再実行・送信前の確認の理由が活動の理由になる` が落ちる
4. `getHistoryActions` の `activity: activityOf(agentSessions.selected.slotId),` を `activity: 'idle',` にする → 同じテストが落ちる
5. `targetBlockedReason` の `isInterrupting: agentInterrupt.isInterruptPending(pendingSend.target.slotId)` を `isInterrupting: false` にする → `中断を押した直後は…` が落ちる
6. `getHistoryActions` の `isInterrupting: agentInterrupt.isInterruptPending(agentSessions.selected.slotId)` を `isInterrupting: false` にする → `中断を押した直後は…` が落ちる
7. `agentSendConfirmDialog` の `pending` の `cliKind: pendingSend.target.cliKind,`（Task 3 で足した）を `cliKind: 'claude',` にする → `作業中なら、実行・再実行・送信前の確認の理由が活動の理由になる`（`pending?.cliKind` が `copilot`）が落ちる

`git diff src/renderer/src/hooks/useAgentWorkspace.ts | grep -c "activityOf(\|isInterruptPending("` が `6`（足した 6 か所）であることを確かめる。あわせて `agentSendMessages.ts` の `if (params.isInterrupting) return …` と `if (params.activity !== 'idle') {` の順を入れ替えて `中断の流れの間なら RUN_DISABLED_INTERRUPTING(活動の理由より先)` が落ちることを確かめ、戻す

- [ ] **Step 8: 検証**

Run: `npx vitest run`
Expected: PASS
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/shared/agentCliKinds.ts src/renderer/src/lib/agentSendMessages.ts src/renderer/src/lib/promptRunState.ts src/renderer/src/lib/agentInterrupt.ts src/renderer/src/hooks/useAgentInterrupt.ts src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/__tests__/agentCliCapabilityOverrides.ts src/shared/__tests__/agentCliKinds.test.ts src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/lib/__tests__/promptRunState.test.ts src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/lib/__tests__/agentCliMessages.test.ts src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx src/renderer/src/hooks/__tests__/useAgentActivity.test.ts src/renderer/src/lib/__tests__/agentInterrupt.test.ts`
Expected: エラー・警告なし
Run: 上と同じファイルへ `npx prettier --check`（外れたら、そのファイルだけを `npx prettier --write <ファイル>` で直す）
Expected: すべて整形済み

---

### Task 6: 送信の配線（中断の流れの守り・送れたときの種類と履歴の記録）

> **設計書の読む節:** 「呼び出し（`useAgentPromptSender.send`）」の 1 と、`isInterrupting` の配線の段落、「決めたこと」の「中断との排他」「失敗の扱い」「履歴への記録」、「新しい状態と既存の入口」、「エラー処理」、「テスト方針」の `usePromptRunner.test.ts`・`agentSendCallbacks.test.ts`・`useAgentPromptSender.test.ts`・配線、「構成」の `useAgentPromptSender.ts`・`useAgentWorkspace.ts`・`usePromptRunner.ts`・`agentSendCallbacks.ts`・`agentPromptRequest.ts` の行。
>
> **気をつける知見:** L-001（通知・`onSent`〈添えた参照を外す〉・確認からの送信のタブへの移動は `sent` のときだけ。今の流れのまま）・L-058（中断の流れは描画の理由と同じ条件を押した時点〈`send` の先頭〉にも確かめる）・L-594（中断の流れの間は準備も書き込みもせずに断る）・L-060（`isInterrupting` は省略できない。配線のテストと、受け渡しを外す変異でテストが落ちることを確かめる）・L-037（送り先は押した時点のタブ。送れたときの種類は送り先の種類）・L-017（失敗の文言は固定の文。例外の文を足す経路は今の `エージェントへ送信できませんでした: <message>` だけ）

**Files:**

- Modify: `src/renderer/src/hooks/useAgentPromptSender.ts`・`src/renderer/src/hooks/useAgentWorkspace.ts`・`src/renderer/src/hooks/usePromptRunner.ts`・`src/renderer/src/lib/agentPromptSend.ts`（結果の種類）・`src/renderer/src/lib/agentSendCallbacks.ts`・`src/renderer/src/lib/agentPromptRequest.ts`
- Test: `src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`・`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`・`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`・`src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts`・`src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`

**Interfaces:**

- Consumes: `AGENT_PROMPT_SEND_SPECS`（Task 4）、`agentSendFailureMessage(reason, kind)`・`RUN_DISABLED_INTERRUPTING`・`agentSendBlockedByActivityReason`・`AGENT_SENT_NOTICE`（Task 3・既存）、`AgentInterruptState.isInterrupting`（Task 5）、`copilotInputScreen`（Task 1）、`buildAgentPasteBytes`・`buildCopilotPasteText`（既存・Task 4）
- Produces:

```ts
// src/renderer/src/hooks/useAgentPromptSender.ts
export interface UseAgentPromptSenderOptions {
  onSettled: () => void
  beforeSend?: () => Promise<void>
  isInterrupting: (slotId: string) => boolean
  clock?: AgentSendClock
}
// src/renderer/src/lib/agentPromptSend.ts
export type AgentPromptSendResult =
  | (Extract<AgentSendOutcome, { kind: 'sent' }> & {
      sentTo: AgentHistoryInfo | null
      cliKind: AgentCliKind
    })
  | Extract<AgentSendOutcome, { kind: 'failed' }>
// src/renderer/src/lib/agentPromptRequest.ts
export type AgentSentHandler = (sentTo: AgentHistoryInfo | null, cliKind: AgentCliKind) => void
// AgentSendOptions.onSent?: AgentSentHandler、buildAgentPromptRequest(content, promptId, prepared, onSent: AgentSentHandler)
// src/renderer/src/lib/agentSendCallbacks.ts
export function notifyAgentSent(
  outcome: AgentPromptSendResult | undefined,
  onSent: AgentSentHandler | undefined
): void
```

- [ ] **Step 1: 既存のテストの値を新しい型に合わせる（ASCII のパターン）**

```bash
cd <repo-root>
set -- src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts
# 送れたときの結果に送り先の種類(既存のテストはどれも claude)を足す
perl -0pi -e "s/(clearedDraft: false,\s*sentTo: [A-Za-z_0-9]+)(\s*\})/\$1, cliKind: 'claude'\$2/g; s/clearedDraft: false, sentTo \}/clearedDraft: false, sentTo, cliKind: 'claude' }/g" "$@"
# onSent に渡る種類を足す
perl -pi -e "s/(onSent\)\.toHaveBeenCalledExactlyOnceWith\()([A-Za-z_0-9]+)\)/\$1\$2, 'claude')/g" "$@"
grep -c "cliKind: 'claude'" "$@"
perl -pi -e "s/onSent(\?\.)?\(SENT_TO\)/onSent\$1(SENT_TO, 'claude')/g; s/onSent\?\.\(resent\)/onSent?.(resent, 'claude')/g" src/renderer/src/hooks/__tests__/usePromptRunner.test.ts
grep -c "'claude')" src/renderer/src/hooks/__tests__/usePromptRunner.test.ts
```

Expected: 1 つ目の `grep -c` は順に `2`・`4`・`2`・`4` 以上（`useAgentSendConfirm.test.ts` は送り先の控えの `cliKind: 'claude'` が元からあれば、その分多い。`agentSendCallbacks.test.ts` は省略記法の `sentTo` の 1 か所を含む）。2 つ目は `5` 以上（`onSent(SENT_TO, 'claude')` 3 か所・`onSent?.(SENT_TO, 'claude')`・`onSent?.(resent, 'claude')`）

`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts` のすべての `useAgentPromptSender({` に、省略できない `isInterrupting` を足す:

```bash
cd <repo-root>
perl -pi -e 's/useAgentPromptSender\(\{ /useAgentPromptSender({ isInterrupting: notInterrupting, /g' src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts
grep -c "isInterrupting: notInterrupting" src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts
grep -n "useAgentPromptSender({$" src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts
```

Expected: 1 つ目が `16`。2 つ目は何も出ない（複数行の呼び出しがあれば、その `{` の次の行に `isInterrupting: notInterrupting,` を手で足す）。

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` の `it('送信の後にパネルを開く onSettled を渡す', () => {` の期待を次にする（sender に中断の流れの関数を渡す）:

```ts
expect(mockUseAgentPromptSender).toHaveBeenLastCalledWith({
  onSettled: result.current.agentTerminal.layout.open,
  beforeSend: undefined,
  isInterrupting: expect.any(Function)
})
```

`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts` の `const noSession = …` の次の行に次を足す:

```ts
// 中断の流れの外(送信の守りを通す。中断の流れの間のテストだけが真を返す関数を渡す)
const notInterrupting = (): boolean => false
```

- [ ] **Step 2: 失敗するテストを書く（sender の copilot の手順・中断の流れ・送れたときの種類）**

`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`:

1. import に `import { buildAgentPasteBytes } from '@shared/agentPasteText'`（`AGENT_CLEAR_INPUT_CHUNK` と同じ import にまとめる）・`RUN_DISABLED_INTERRUPTING`・`agentSendBlockedByActivityReason`（`'../../lib/agentSendMessages'` の import に足す）・`import { copilotInputScreen } from '../../lib/__tests__/fixtures/copilotInputScreens'`・`import { copilotScreen } from '../../lib/__tests__/fixtures/copilotScreens'` を足す
2. ファイルの末尾に次を足す:

```ts
// copilot の入力欄の偽の controller。空の入力欄から始め、貼り付けを書き込むと記録の echo の画面(atref2Paste)、\r で空の入力欄
// (atref2Enter1)にする。本文は記録で貼った '本文\n\n- @file.txt'(末尾の @ の語なので、空白を 1 つ足して貼る)
const COPILOT_TEXT = '本文\n\n- @file.txt'
function copilotController(): ReturnType<typeof makeFakeController> {
  const controller = makeFakeController()
  controller.screen = copilotInputScreen('empty').lines
  const original = controller.writeToSession
  controller.writeToSession = (data) => {
    original(data)
    if (data.startsWith('\x1b[200~')) controller.screen = copilotInputScreen('atref2Paste').lines
    if (data === '\r') controller.screen = copilotInputScreen('atref2Enter1').lines
  }
  return controller
}

describe('useAgentPromptSender: copilot の送り先(表の copilot の手順)', () => {
  it('表の copilot の手順を通り、貼り付けと \\r だけを書いて sent になり、結果に送り先の種類を載せる', async () => {
    const controller = copilotController()
    const onSettled = vi.fn()
    const { result } = renderHook(() =>
      useAgentPromptSender({ isInterrupting: notInterrupting, onSettled, clock })
    )
    let outcome: AgentPromptSendResult | undefined
    await act(async () => {
      outcome = await result.current.send(COPILOT_TEXT, {
        slotId: 'a',
        controller,
        describeSession: noSession,
        cliKind: 'copilot'
      })
    })
    expect(outcome).toEqual({ kind: 'sent', clearedDraft: false, sentTo: null, cliKind: 'copilot' })
    expect(controller.writes).toEqual([buildAgentPasteBytes(`${COPILOT_TEXT} `), '\r'])
    expect(toAnnouncementText(result.current.notice)).toBe(AGENT_SENT_NOTICE)
    expect(controller.beginSending).toHaveBeenCalledOnce()
    expect(controller.endSending).toHaveBeenCalledOnce()
    expect(onSettled).toHaveBeenCalledOnce()
  })

  it('そのタブが中断の流れの間なら、準備・送り先の控え・入力の保留・書き込みをどれもせず interrupting で断り、押せない理由と同じ文言を出す', async () => {
    const controller = copilotController()
    const beforeSend = vi.fn(async () => undefined)
    const describeSession = vi.fn(noSession)
    const isInterrupting = vi.fn((slotId: string) => slotId === 'a')
    const onSettled = vi.fn()
    const { result } = renderHook(() =>
      useAgentPromptSender({ isInterrupting, onSettled, beforeSend, clock })
    )
    let outcome: AgentPromptSendResult | undefined
    await act(async () => {
      outcome = await result.current.send(COPILOT_TEXT, {
        slotId: 'a',
        controller,
        describeSession,
        cliKind: 'copilot'
      })
    })
    expect(outcome).toEqual({ kind: 'failed', reason: 'interrupting' })
    expect(isInterrupting).toHaveBeenCalledWith('a')
    expect(beforeSend).not.toHaveBeenCalled()
    expect(describeSession).not.toHaveBeenCalled()
    expect(controller.beginSending).not.toHaveBeenCalled()
    expect(controller.writes).toEqual([])
    expect(result.current.error).toBe(RUN_DISABLED_INTERRUPTING)
    expect(result.current.isSending).toBe(false)
    expect(onSettled).toHaveBeenCalledOnce()
  })

  it('claude の送り先は、中断の流れの間でも今までどおり送る(requiresIdle: false)', async () => {
    const controller = controllerWithEmptyInput()
    const { result } = renderHook(() =>
      useAgentPromptSender({ isInterrupting: () => true, onSettled: vi.fn(), clock })
    )
    let outcome: AgentPromptSendResult | undefined
    await act(async () => {
      outcome = await result.current.send('hello', {
        slotId: 'a',
        controller,
        describeSession: noSession,
        cliKind: 'claude'
      })
    })
    expect(outcome).toEqual({ kind: 'sent', clearedDraft: false, sentTo: null, cliKind: 'claude' })
    expect(controller.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\x1b[201~', '\r'])
  })

  it('copilot の失敗は copilot の文言で出す(押した時点の画面が作業中なら、押せない理由と同じ文で何も書かない)', async () => {
    const controller = makeFakeController()
    controller.screen = copilotScreen('working3000').lines
    const { result } = renderHook(() =>
      useAgentPromptSender({ isInterrupting: notInterrupting, onSettled: vi.fn(), clock })
    )
    await act(async () => {
      await result.current.send(COPILOT_TEXT, {
        slotId: 'a',
        controller,
        describeSession: noSession,
        cliKind: 'copilot'
      })
    })
    expect(result.current.error).toBe(agentSendBlockedByActivityReason('working', 'copilot'))
    expect(controller.writes).toEqual([])
  })
})
```

3. `src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts` の末尾の `})`（`describe('notifyAgentSent'` の閉じ括弧）の前に次を足す:

```ts
it('送り先の種類を onSent に渡す(copilot の送り先は sentTo が null で、種類で記録を省くかを決める)', () => {
  const onSent = vi.fn()
  notifyAgentSent({ kind: 'sent', clearedDraft: false, sentTo: null, cliKind: 'copilot' }, onSent)
  expect(onSent).toHaveBeenCalledExactlyOnceWith(null, 'copilot')
})
```

4. `src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`:
   - `it('送り先を控えられなかった(null)ときは、参照の後始末だけ行い、記録を省いてログに残す', async () => {` のテストを次の 2 つに置き換える:

```ts
it('claude の送り先で送り先を控えられなかった(null)ときは、参照の後始末だけ行い、記録を省いてログに残す', async () => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const { onSent, addHistoryEntry, agentReferences } = await runAndTakeOnSent()
  onSent(null, 'claude')
  expect(agentReferences.markSent).toHaveBeenCalledOnce()
  expect(addHistoryEntry).not.toHaveBeenCalled()
  expect(consoleErrorSpy).toHaveBeenCalled()
})

it('会話の ID を持たない種類(copilot。sessionResume が偽)の送り先で送れたときは、参照の後始末だけ行い、記録もログもしない(段階 3 で記録する)', async () => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const { onSent, addHistoryEntry, agentReferences } = await runAndTakeOnSent()
  onSent(null, 'copilot')
  expect(agentReferences.markSent).toHaveBeenCalledOnce()
  expect(addHistoryEntry).not.toHaveBeenCalled()
  expect(consoleErrorSpy).not.toHaveBeenCalled()
})
```

- `describe('usePromptRunner: エージェントのエントリの再実行', () => {` の `it('エージェント CLI 方式では今の送り先へ同じ全文を送り…` の後に次を足す:

```ts
it('copilot のタブへ再実行して送れたとき(sentTo が null)は、記録もログもしない', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const addHistoryEntry = vi.fn()
    const sendToAgent = vi.fn<(text: string, options: AgentSendOptions) => Promise<unknown>>(
      async () => undefined
    )
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        folderPath: '/repo',
        executePrompt: vi.fn(),
        addHistoryEntry,
        executionMode: 'agent-cli',
        sendToAgent,
        agentReferences: makeAgentReferencesState()
      })
    )
    await result.current.rerunHistoryEntry(agentEntry)
    sendToAgent.mock.calls[0][1].onSent?.(null, 'copilot')
    expect(addHistoryEntry).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  } finally {
    consoleError.mockRestore()
  }
})
```

- [ ] **Step 3: 失敗するテストを書く（配線。本物の useAgentSessions・useAgentActivity・useAgentInterrupt・useAgentPromptSender。L-060）**

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:

1. import に `import { buildAgentPasteBytes } from '@shared/agentPasteText'`・`import { copilotInputScreen } from '../../lib/__tests__/fixtures/copilotInputScreens'`・`'../../lib/agentSendMessages'` の import に `AGENT_SENT_NOTICE` を足す（`RUN_DISABLED_INTERRUPTING`・`agentSendBlockedByActivityReason` は Task 5 で足した）
2. `describe('copilot の配線(本物の useAgentSessions・useAgentActivity・useAgentInterrupt・useAgentNotifications。L-060)', () => {` の中:
   - `let originalScreen: FakeController['screen'] | null = null` の次の行に `let originalWrite: FakeController['writeToSession'] | null = null` を足す
   - `beforeEach` の `originalScreen = controller.screen` の次の行に `originalWrite = controller.writeToSession` を足す
   - `afterEach` の `if (controller !== null && originalScreen !== null) controller.screen = originalScreen` の次の行に `if (controller !== null && originalWrite !== null) controller.writeToSession = originalWrite` を足し、`originalScreen = null` の次の行に `originalWrite = null` を足す
   - `describe` の最後のテスト（`it('2 回目を待つ間に別のタブを選んでも、…`）の後に次を足す:

```ts
// 送信の配線: 本物の sender(useAgentPromptSender)を使う。偽の controller の画面は、貼り付けで記録の echo の画面(atref2Paste)、
// \r で送った後の画面(aeInstantEnd)に変える
const COPILOT_TEXT = '本文\n\n- @file.txt'
const installRealSender = async (): Promise<void> => {
  const sender =
    await vi.importActual<typeof import('../useAgentPromptSender')>('../useAgentPromptSender')
  mockUseAgentPromptSender.mockImplementation(sender.useAgentPromptSender)
}
const echoOnWrite = (target: FakeController): void => {
  const write = target.writeToSession
  target.writeToSession = (data) => {
    write(data)
    if (data.startsWith('\x1b[200~')) target.screen = copilotInputScreen('atref2Paste').lines
    if (data === '\r') target.screen = copilotInputScreen('aeInstantEnd').lines
  }
}
const startIdle = async (result: Rendered['result']): Promise<void> => {
  if (controller !== null) controller.screen = copilotInputScreen('empty').lines
  await act(async () => {
    await result.current.agentTerminal.sessions.start(slotId, { kind: 'new' })
  })
  act(() => controller?.emitOutputWritten())
  await waitFor(() => expect(result.current.agentTerminal.activities.get(slotId)).toBe('idle'))
}

it('入力待ちの copilot のタブへ、実行(送信前の確認はオフ)で貼り付けと \\r を書き、送れたことを確かめて通知し、onSent に copilot を渡す', async () => {
  await installRealSender()
  setSendConfirmEnabled(false)
  const { result } = renderWorkspace({ folderPath: '/p' })
  await startIdle(result)
  expect(result.current.promptRun).toMatchObject({
    isRunDisabled: false,
    runDisabledReason: null
  })
  if (controller === null) throw new Error('controller がありません')
  echoOnWrite(controller)
  const writesBefore = controller.writes.length
  const onSent = vi.fn()
  await act(async () => {
    await result.current.sendToAgent(COPILOT_TEXT, { promptId: 'p1', unsavedPaths: [], onSent })
  })
  expect(controller.writes.slice(writesBefore)).toEqual([
    buildAgentPasteBytes(`${COPILOT_TEXT} `),
    '\r'
  ])
  expect(result.current.promptRun.agentSend?.notice?.text).toBe(AGENT_SENT_NOTICE)
  expect(onSent).toHaveBeenCalledExactlyOnceWith(null, 'copilot')
})

it('画面が作業中になると実行の理由が copilot の作業中の理由になり、確認を開いた後に作業中になると確認の理由も同じになる', async () => {
  const { result } = renderWorkspace({ folderPath: '/p' })
  await startIdle(result)
  await act(async () => {
    await result.current.sendToAgent(COPILOT_TEXT, { promptId: 'p1', unsavedPaths: [] })
  })
  expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBeNull()
  if (controller !== null) controller.screen = copilotScreen('working3000').lines
  act(() => controller?.emitOutputWritten())
  const working = agentSendBlockedByActivityReason('working', 'copilot')
  await waitFor(() =>
    expect(result.current.agentSendConfirmDialog.targetBlockedReason).toBe(working)
  )
  expect(result.current.promptRun.runDisabledReason).toBe(working)
})

it('中断を押した直後に実行すると、sender が押した時点の中断の流れで interrupting として断り、何も書かない(isInterrupting の配線)', async () => {
  await installRealSender()
  setSendConfirmEnabled(false)
  const { result } = renderWorkspace({ folderPath: '/p' })
  await act(async () => {
    await result.current.agentTerminal.sessions.start(slotId, { kind: 'new' })
  })
  act(() => controller?.emitOutputWritten())
  await waitFor(() => expect(result.current.agentTerminal.activities.get(slotId)).toBe('working'))
  await act(async () => {
    result.current.agentTerminal.interrupt.onInterrupt()
  })
  expect(interruptSpy).toHaveBeenCalledExactlyOnceWith('sid-copilot')
  expect(result.current.promptRun.runDisabledReason).toBe(RUN_DISABLED_INTERRUPTING)
  if (controller === null) throw new Error('controller がありません')
  const writesBefore = controller.writes.length
  let outcome: AgentPromptSendResult | undefined
  await act(async () => {
    outcome = await result.current.sendToAgent(COPILOT_TEXT, {
      promptId: 'p1',
      unsavedPaths: []
    })
  })
  expect(outcome).toEqual({ kind: 'failed', reason: 'interrupting' })
  expect(result.current.promptRun.agentSend?.error).toBe(RUN_DISABLED_INTERRUPTING)
  expect(controller.writes.slice(writesBefore)).toEqual([])
  // 2 回目の流れを終わらせてから抜ける(タイマーを残さない)
  await waitFor(() => expect(followUpSpy).toHaveBeenCalledExactlyOnceWith('sid-copilot'))
})
```

（この `describe` の `beforeEach` は画面を `working3000` にして始める。`startIdle` は空の入力欄に変えてから起動する。`setSendConfirmEnabled` と `Rendered`・`interruptSpy`・`followUpSpy` は既存）

- [ ] **Step 4: テストが落ちることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`
Expected: FAIL（結果に `cliKind` が無い・`isInterrupting` を見ない・`onSent` に種類が渡らない・`copilot` の `sentTo` が `null` で `console.error` が出る）

- [ ] **Step 5: 結果の種類・知らせの型・履歴の記録**

1. `src/renderer/src/lib/agentPromptSend.ts`:
   - import に `import type { AgentCliKind } from '@shared/agentCliKinds'` を足す
   - `AgentPromptSendResult` を次にする:

```ts
/**
 * 送信の手順を含めた送信(useAgentPromptSender.send)の結果。送れたときは、送信の手順を始める時点に控えた送り先(履歴の
 * HistoryEntry.agent と同じ形。控えられなかったら null)と、送り先の CLI の種類(会話の ID を持たない種類は記録を黙って省く)を足す。
 * 送信の手順(表の send)の AgentSendOutcome は変えない
 */
export type AgentPromptSendResult =
  | (Extract<AgentSendOutcome, { kind: 'sent' }> & {
      sentTo: AgentHistoryInfo | null
      cliKind: AgentCliKind
    })
  | Extract<AgentSendOutcome, { kind: 'failed' }>
```

2. `src/renderer/src/lib/agentPromptRequest.ts`:
   - import に `import type { AgentCliKind } from '@shared/agentCliKinds'` を足す
   - `export interface AgentSendOptions {` の前に次を足す:

```ts
/** 送れた(sent)ときの知らせ。送信の手順を始める時点に控えた送り先(控えられなかったら null)と、送り先の CLI の種類を渡す */
export type AgentSentHandler = (sentTo: AgentHistoryInfo | null, cliKind: AgentCliKind) => void
```

- `onSent?: (sentTo: AgentHistoryInfo | null) => void` を `onSent?: AgentSentHandler` に、その JSDoc の `控えた送り先(控えられなかったら null)を渡して呼ぶ` を `控えた送り先(控えられなかったら null)と送り先の CLI の種類を渡して呼ぶ` にする
- `buildAgentPromptRequest` の引数 `onSent: (sentTo: AgentHistoryInfo | null) => void` を `onSent: AgentSentHandler` にする

3. `src/renderer/src/lib/agentSendCallbacks.ts` を次にする:

```ts
import type { AgentPromptSendResult } from './agentPromptSend'
import type { AgentSentHandler } from './agentPromptRequest'

// 送れた(sent)ときの知らせ(AgentSendOptions.onSent)を呼ぶ。確認から送ったとき(useAgentSendConfirm)とすぐ送ったとき
// (useAgentWorkspace)で共有する。知らせには送信の手順を始める時点に控えた送り先(sentTo。null を含む)と、送り先の CLI の種類を渡す。
// 知らせが投げても、呼び出し元の後続(フォーカスの移動・結果の返却)は止めない(L-053)
export function notifyAgentSent(
  outcome: AgentPromptSendResult | undefined,
  onSent: AgentSentHandler | undefined
): void {
  if (outcome?.kind !== 'sent' || onSent === undefined) return
  try {
    onSent(outcome.sentTo, outcome.cliKind)
  } catch (err) {
    console.error('[notifyAgentSent] onSent failed:', err)
  }
}
```

4. `src/renderer/src/hooks/usePromptRunner.ts`:
   - import に `import { agentCliCapabilities } from '@shared/agentCliKinds'` と `import type { AgentCliKind } from '@shared/agentCliKinds'` を足す
   - `recordAgentSent` のコメントと関数を次にする:

```ts
// エージェント CLI 方式で送れたときの記録(結果の文章は記録しない)。送り先(sentTo)は送信の手順を始める時点に控えた値。
// 会話の ID を持たない種類(copilot。能力の表の sessionResume が偽)は送り先を控えられないのが常なので、黙って記録を省く(copilot へ
// 送ったプロンプトの履歴への記録は段階 3)。会話の ID を持つ種類(claude)で控えられなかった(ありえない想定)ときだけログに残す。
// 記録が投げても呼び出し元(参照の後始末)を止めない
const recordAgentSent = useCallback(
  (
    context: ExecutionContext,
    text: string,
    sentTo: AgentHistoryInfo | null,
    cliKind: AgentCliKind
  ): void => {
    if (sentTo === null) {
      if (agentCliCapabilities(cliKind).sessionResume) {
        console.error('[usePromptRunner] 送り先のセッションが分からないため、履歴に記録しません')
      }
      return
    }
    try {
      addHistoryEntry(buildAgentSentHistoryEntry(context, text, sentTo, Date.now()))
    } catch (err) {
      console.error('[usePromptRunner] addHistoryEntry failed:', err)
    }
  },
  [addHistoryEntry]
)
```

- `runPrompt` の `buildAgentPromptRequest(content, prompt.id, prepared, (sentTo) => {` を `buildAgentPromptRequest(content, prompt.id, prepared, (sentTo, cliKind) => {` にし、その中の `recordAgentSent(context, request.text, sentTo)` を `recordAgentSent(context, request.text, sentTo, cliKind)` にする
- `rerunHistoryEntry` の `onSent: (sentTo) => recordAgentSent(context, entry.promptContent, sentTo)` を `onSent: (sentTo, cliKind) => recordAgentSent(context, entry.promptContent, sentTo, cliKind)` にする

- [ ] **Step 6: sender の中断の流れの守りと、`useAgentWorkspace` の配線**

1. `src/renderer/src/hooks/useAgentPromptSender.ts`:
   - `UseAgentPromptSenderOptions` の `beforeSend?: …` の次に足す:

```ts
/**
 * そのタブが中断の流れの間か(useAgentInterrupt の isInterrupting。押した時点の判定。省略できない。L-060)。送り先の種類の手順が
 * requiresIdle(copilot)なら、間のときは準備・控え・入力の保留・書き込みをどれもせずに interrupting で断る
 */
isInterrupting: (slotId: string) => boolean
```

- 分割代入の `beforeSend,` の次に `isInterrupting,` を足す
- `send` の中の `// 送り先の CLI が送信に対応していなければ、…` から `return { kind: 'failed', reason: 'unsupported-cli' }` の `}` までを次に置き換える:

```ts
// 準備(変更の記録)・送り先の控え・入力の保留・書き込みをどれもせずに断る(実行ボタンの理由と同じ判定・同じ文言。見た目だけで
// 止めない。L-058)。ほかの失敗と同じくパネルを開く
const rejectBeforeSending = (reason: 'unsupported-cli' | 'interrupting'): AgentPromptSendResult => {
  clear()
  setError(agentSendFailureMessage(reason, target.cliKind))
  onSettled()
  return { kind: 'failed', reason }
}
// 送り先の CLI が送信に対応していない
if (!agentCliCapabilities(target.cliKind).promptSend) {
  return rejectBeforeSending('unsupported-cli')
}
// 入力待ちのときだけ送る種類(copilot)は、そのタブが中断の流れの間なら断る(2 回目の Esc が貼った本文を消しうる。L-594)
if (AGENT_PROMPT_SEND_SPECS[target.cliKind].requiresIdle && isInterrupting(target.slotId)) {
  return rejectBeforeSending('interrupting')
}
```

- `return outcome.kind === 'sent' ? { ...outcome, sentTo } : outcome` を `return outcome.kind === 'sent' ? { ...outcome, sentTo, cliKind: target.cliKind } : outcome` にする
- `useCallback` の依存の `[onSettled, beforeSend, clock, announce, clear]` を `[onSettled, beforeSend, isInterrupting, clock, announce, clear]` にする
- `send` の JSDoc（`AgentPromptSenderState.send`）の `送れたときは、送信の手順を始める時点に控えた送り先(sentTo)を結果に載せる` を `送れたときは、送信の手順を始める時点に控えた送り先(sentTo)と送り先の種類(cliKind)を結果に載せる` にする

2. `src/renderer/src/hooks/useAgentWorkspace.ts`:
   - `import { useCallback, useMemo, useState } from 'react'` を `import { useCallback, useEffect, useMemo, useRef, useState } from 'react'` にする
   - `const agentSender = useAgentPromptSender({ onSettled: agentLayout.open, beforeSend: beforeAgentSend })` を次にする:

```ts
// sender は中断の hook より先に作る(中断の押せる条件が送信中を使う)ため、押した時点の「そのタブが中断の流れの間か」は ref から引く。
// ref は下の effect で useAgentInterrupt の isInterrupting(参照が安定)を入れる(描画の中で ref を書かない。最初の effect の前は
// 中断の流れの外〈false〉。送信はマウントの後にしか起きない)
const isInterruptingRef = useRef<(slotId: string) => boolean>(() => false)
const isSlotInterrupting = useCallback(
  (slotId: string): boolean => isInterruptingRef.current(slotId),
  []
)
const agentSender = useAgentPromptSender({
  onSettled: agentLayout.open,
  beforeSend: beforeAgentSend,
  isInterrupting: isSlotInterrupting
})
```

- Task 5 で足した `const activityOf = …` の次に次を足す:

```ts
const { isInterrupting } = agentInterrupt
useEffect(() => {
  isInterruptingRef.current = isInterrupting
}, [isInterrupting])
```

- [ ] **Step 7: テストが通ることを確かめる**

```bash
cd <repo-root>
npx prettier --write src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts
npx vitest run src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts
```

Expected: PASS

- [ ] **Step 8: 変異で確かめる（受け渡しを 1 つずつ外す。L-060）**

1. `useAgentWorkspace.ts` の `isInterrupting: isSlotInterrupting` を `isInterrupting: () => false` にする → `中断を押した直後に実行すると、sender が…interrupting として断り…` が落ちる（sender が手順に進み、作業中の画面で `screen-working` の文言になる）。戻す
2. `useAgentWorkspace.ts` の `useEffect` の本体（`isInterruptingRef.current = isInterrupting`）を消す → 同じテストが落ちる。戻す
3. `useAgentPromptSender.ts` の `{ ...outcome, sentTo, cliKind: target.cliKind }` の `cliKind: target.cliKind` を `cliKind: 'claude' as const` にする → `表の copilot の手順を通り…結果に送り先の種類を載せる` と配線の `onSent に copilot を渡す` が落ちる。戻す
4. `usePromptRunner.ts` の `if (agentCliCapabilities(cliKind).sessionResume) {` を外して常に `console.error` を出す → `会話の ID を持たない種類(copilot…)…記録もログもしない` が落ちる。戻す
5. `git diff src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/hooks/useAgentPromptSender.ts src/renderer/src/hooks/usePromptRunner.ts | grep -c "isSlotInterrupting\|isInterruptingRef.current = isInterrupting\|cliKind: target.cliKind\|sessionResume"` が 4 以上であることを確かめる

- [ ] **Step 9: 検証**

Run: `npx vitest run`
Expected: PASS（App の配線のテスト〈`App.agentReferences.test.tsx`・`App.agentSessionResume.test.tsx` など。本物の sender を通る〉も通る）
Run: `npm run typecheck`
Expected: PASS
Run: `npx eslint --max-warnings 0 src/renderer/src/hooks/useAgentPromptSender.ts src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/hooks/usePromptRunner.ts src/renderer/src/lib/agentPromptSend.ts src/renderer/src/lib/agentSendCallbacks.ts src/renderer/src/lib/agentPromptRequest.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`
Expected: エラー・警告なし
Run: 上と同じファイルへ `npx prettier --check`（外れたら、そのファイルだけを `npx prettier --write <ファイル>` で直す）
Expected: すべて整形済み

---

### Task 7: ROADMAP の更新・既知の制約・テスト仕様書と全体の検証（テスト仕様書への追記と Artifact の再公開）

> **設計書の読む節:** 「ROADMAP の更新の方針」、「既知の制約」、「実機テスト仕様書の新しい項目の下書き」（既存の項目の直しと新しい節）、「実装の分割」の 6、「main に入れた時点で利用者から見える挙動」。CLAUDE.md の実機テスト仕様書の規則（書式・ID を変えない・接頭辞ごとの連番）と `scripts/build-manual-test-spec.mjs`。
>
> **気をつける知見:** L-072（実機の項目では `copilot` に頼む内容を返答だけにし、許可の確認は `Esc` で取り消し、フォルダの信頼で覚えさせない。足したプロンプト・変えた内容・設定〈使う CLI・送信前の確認・VoiceOver〉・書きかけは項目の終わりに元へ戻す）・L-354（下書きの文言を実装の文言と照らし合わせてから追記する）・L-059（記録できなかった場面は既知の制約に書き、実機の項目で確かめる）

**Files:**

- Modify: `docs/manual-test-spec.md`（AGT-230・233・236・240 と `### copilot の画面の判定と中断` の 3 つ目の前提の直しと、新しい節 AGT-257〜269。**ほかの既存の項目の ID と文言は変えない**）
- Modify: `ROADMAP.md`（**prettier にかけない**）
- Modify（食い違いがあれば）: `docs/superpowers/specs/2026-10-22-agent-cli-copilot-send-design.md`（「既知の制約」の照合と、プランの冒頭の「計画の時点で設計書から調整した細部」の反映）
- 生成（git 管理外）: `.superpowers/manual-test-spec.html`

**Interfaces:**

- Consumes: Task 1〜6 の実装（文言の正は `src/renderer/src/lib/agentSendMessages.ts`・`src/renderer/src/lib/agentReferenceMessages.ts`・`src/renderer/src/lib/agentCliMessages.ts`）
- Produces: 実機テスト仕様書の AGT-257〜AGT-269 と既存の項目の直し、ROADMAP の段階 2b の記録（Artifact の再公開はコントローラーが行う）

- [ ] **Step 1: 設計書の「既知の制約」を実装と照らし合わせ、調整した細部を設計書に反映する**

`sed -n '/^## 既知の制約/,/^## 実機テスト仕様書の新しい項目の下書き/p' docs/superpowers/specs/2026-10-22-agent-cli-copilot-send-design.md` で読み、次を確かめる。食い違いがあれば設計書の行を実装に合わせて直す（無ければ変えない）:

1. 待ちの値（保留 50ms・2,500ms、echo 16ms・1,500ms、確かめ 16ms・2,000ms）が `src/renderer/src/lib/copilotPromptSend.ts` の定数と一致する
2. 入力欄の規則（空の帯・書きかけの帯・畳みの形・記号）が `src/renderer/src/lib/copilotInputBox.ts` の定数と一致する
3. 先頭の `!`・`/` の規則が `src/shared/agentPasteText.ts` の `AGENT_PROMPT_TEXT_RULES.copilot`、末尾の `@` の語が `buildCopilotPasteText` と一致する
4. 中断の流れの間は送らない（`useAgentPromptSender` の `interrupting`・押せる条件の `RUN_DISABLED_INTERRUPTING`）、`copilot` へ送ったプロンプトを履歴に記録しない（`usePromptRunner` の `recordAgentSent`）
5. 設計書のほかの節の語を、プランの冒頭の「計画の時点で設計書から調整した細部」に合わせて直す（「決めたこと（利用者の確認済み）」「決めたこと（推奨案で決めた事項）」の表の文言は変えない）:
   - 「実装の分割」に、押せる条件を手順の表の後のタスクにした旨（プランの Task 5・6）を足す
   - 「入力欄の特定と読み取り」の定数に `SYMBOL_PREFIXES`・`CONTINUATION_INDENT` を足す
   - 「文言」の共通の表の名前を `AGENT_SEND_FAILURE_COMMON_TEXTS`、活動の理由の表を `AGENT_SEND_BLOCKED_BY_ACTIVITY` と書き、`AGENT_SEND_FAILURE_MESSAGES` を消した旨を足す
   - 「呼び出し（`useAgentPromptSender.send`）」と「構成」の `useAgentInterrupt.ts` の行に、戻り値の型を `AgentInterruptPanelState` を広げた `AgentInterruptState` にした旨を、`agentPromptRequest.ts` の行に `AgentSentHandler` を足す
   - 「実装の最初に確かめること」の 1・2 に、全角の文字の扱い（右半分のセルは記録の時点で除いてある。全角の文字の行に属性があれば止める）・大きさの決め方・台帳の SHA-256（`b2015f3d08d739570b384bccd5291e79f2aad6a1a47fde81b890300bc71cac6e`）・変わった行の数（145）を足す
   - 「テスト方針」に、能力の表を差し替えるテストの補助に `promptSendUnsupportedKinds` を足した旨と、echo の上限の境目（1,500ms の時点で現れれば 1,504ms の読み取りで送る）を足す

- [ ] **Step 2: 実機テスト仕様書の文言を実装と照らし合わせる（L-354）**

```bash
cd <repo-root>
test -f src/renderer/src/lib/agentSendMessages.ts || echo "missing"
node -e '
const fs = require("node:fs")
const texts = [
  ["src/renderer/src/lib/__tests__/agentSendMessages.test.ts", "copilot が作業中のため送信できません（作業が終わって入力待ちになってから、もう一度実行してください）"],
  ["src/renderer/src/lib/__tests__/agentSendMessages.test.ts", "copilot が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）"],
  ["src/renderer/src/lib/__tests__/agentSendMessages.test.ts", "copilot の入力欄に書きかけがあるため送信できません（書きかけは消していません。ターミナルで送るか消してから、もう一度実行してください）"],
  ["src/renderer/src/lib/__tests__/agentSendMessages.test.ts", "先頭（空白を除く）が「/」のプロンプトは、copilot のスラッシュコマンドとして実行されるため送信できません（先頭に「/」以外の文字を足すと送れます）"],
  ["src/renderer/src/lib/__tests__/agentSendMessages.test.ts", "先頭（空白を除く）が「!」のプロンプトは、copilot のシェルのコマンドとして実行されるため送信できません（先頭に「!」以外の文字を足すと送れます）"],
  ["src/renderer/src/lib/__tests__/agentSendMessages.test.ts", "中断を送ったばかりのため送信できません（1 秒ほど待ってから、もう一度実行してください）"],
  ["src/renderer/src/lib/__tests__/agentSendMessages.test.ts", "copilot に送れたか確かめられませんでした。ターミナルの画面を確かめてください（入力欄に本文が残っていれば、送るか消してください）"],
  ["src/renderer/src/lib/agentSendMessages.ts", "エージェントに送信しました"],
  ["src/renderer/src/lib/agentSendMessages.ts", "エージェントに送信しました（入力欄に書きかけがあったようなので、消してから送りました）"],
  ["src/renderer/src/lib/agentSendMessages.ts", "エージェントが起動していません（ターミナルの「起動」を押してください）"],
  ["src/renderer/src/lib/__tests__/agentCliMessages.test.ts", "copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別、前回の続きから・このセッションで再開"],
  ["src/renderer/src/lib/__tests__/agentReferenceMessages.test.ts", "未保存の変更があるファイルは、保存するまで copilot に見えません"]
]
for (const [file, text] of texts) console.log(fs.readFileSync(file, "utf8").includes(text) ? "OK" : "NG", text)
'
```

Expected: `missing` が出ず、すべて `OK`。`NG` が出たら、Step 3・4 で書く文言をコードの文字列に合わせて直す（コードは変えない）

- [ ] **Step 3: 実機テスト仕様書の既存の項目を直し、新しい節を足す（ID は変えない）**

新しい節の本文を一時ファイルに書く（設計書の「新しい節」の下書きのまま。Step 2 で `NG` が出た文言はコードに合わせる）:

```bash
S=$SCRATCHPAD
mkdir -p "$S"
cat > "$S/agt-257-section.md" <<'SECTION_EOF'
### copilot へのプロンプトの送信

> 前提: エージェント CLI 方式で、テスト用のフォルダを開いている。GitHub Copilot CLI（`copilot`）がインストール済みで、端末で `copilot --version` が動く。設定の `使うエージェント CLI` で `GitHub Copilot CLI（copilot）` を選んでから始め（動いているタブがあれば確認で `OK`）、この節の最後の項目で `Claude Code（claude）` に戻す。途中で止めるときも `Claude Code（claude）` に戻す。
> 前提: フォルダの信頼の確認が出たら、その回だけ信頼する選択肢（`1. Yes`）を選び、`2. Yes, and remember this folder for future sessions` は選ばない（覚えさせてしまったら、AGT-228 の節の前提の手順で外す）。`copilot` のログインなど GitHub のアカウントに関わる操作は、利用者が自分のアカウントで行う。
> 前提: 「プロンプト」パネルに、タイトル `copilot 送信`・内容 `Without using any tools or files, reply with only the word OK.` のプロンプトを足しておく（この節の最後の項目で消す）。項目の途中で内容を変えたら、その項目の終わりに元の内容へ戻す。設定の `送信前の確認` はオン（既定）から始める。
> 前提: 長い作業は、ターミナルの `copilot` の入力欄に `Without using any tools or files, write the numbers from 1 to 2000 in your reply, one per line.` を入力して `Enter` で送って作る（AGT-243 の節と同じ）。

- [ ] **AGT-257** `起動` で `copilot 1` を起動し、帯が `入力待ち` になったら `copilot 送信` の `実行` を押す。開いた確認のダイアログを見てから `送信` を押す → ダイアログに `送り先: copilot 1` と本文が出る。`送信` を押すと、ターミナルの `copilot` の入力欄に本文が入ってすぐ送られ、プロンプトパネルに `エージェントに送信しました` が出る。`copilot` が `OK` と答え、帯が `作業中` から `入力待ち` に戻る（作業中が短くて見えなければ、そのことを記録する）。入力欄に本文は残らない
- [ ] **AGT-258** 設定の `送信前の確認` をオフにしてから、`copilot 送信` の `実行` を押す → ダイアログは開かずに送られ、`エージェントに送信しました` が出て、`copilot` が `OK` と答える。確かめた後、`送信前の確認` をオンに戻す
- [ ] **AGT-259** 実行履歴を開いて一覧を見る → AGT-257・258 で `copilot` に送ったプロンプトのエントリは増えていない（既知の制約。`copilot` へ送ったプロンプトは履歴に残らない）
- [ ] **AGT-260** 長い作業を送り、帯が `作業中` の間に `copilot 送信` の `実行` にマウスを載せる。作業が終わって帯が `入力待ち` になったら、もう一度マウスを載せる → 作業中は `実行` が押せず、`copilot が作業中のため送信できません（作業が終わって入力待ちになってから、もう一度実行してください）` が出る。入力待ちになると押せる（理由は出ない）
- [ ] **AGT-261** ターミナルの `copilot` の入力欄に `draft` と入力し（`Enter` は押さない）、`copilot 送信` の `実行` → `送信` を押す → 何も送られず、プロンプトパネルに `copilot の入力欄に書きかけがあるため送信できません（書きかけは消していません。ターミナルで送るか消してから、もう一度実行してください）` が出る。ターミナルの入力欄の `draft` は残り、`copilot` の帯に `esc again to clear input` も出ない。確かめた後、ターミナルで `Ctrl+U` を押して書きかけを消す
- [ ] **AGT-262** `copilot 送信` の内容を `/help` に変えて保存し、`実行` を押す。続けて内容を `!pwd` に変えて保存し、`実行` を押す → どちらも確認のダイアログの `送信` が押せず、それぞれ `先頭（空白を除く）が「/」のプロンプトは、copilot のスラッシュコマンドとして実行されるため送信できません（先頭に「/」以外の文字を足すと送れます）`・`先頭（空白を除く）が「!」のプロンプトは、copilot のシェルのコマンドとして実行されるため送信できません（先頭に「!」以外の文字を足すと送れます）` が出る。`キャンセル` で閉じ、ターミナルには何も入らない（`copilot` のヘルプもシェルの実行も出ない）。確かめた後、内容を元に戻して保存する
- [ ] **AGT-263** エディタでテスト用のフォルダのファイルを 1 つ開き、プロンプトパネルの参照の行でそのファイル（`@<パス>`）を押してオンにしてから、`copilot 送信` の `実行` を押し、確認のダイアログを見てから `送信` を押す → ダイアログの本文の末尾が空行・`参照:`・`- @<パス>` になり、`送信` は押せる。押すとターミナルの入力欄に本文が入り（補完の候補の一覧は開かない）、`Enter` 1 回で送られて `エージェントに送信しました` が出る。`copilot` の画面の発言の行の末尾が `- @<パス>` で、`copilot` が `OK` と答える。`copilot に送れたか確かめられませんでした…` が出たら、ターミナルの入力欄（補完の候補の一覧が開いていないか・本文が書き換わっていないか）と、端末で `copilot --version` を実行した結果を記録する。確かめた後、参照がオンのままならオフに戻す
- [ ] **AGT-264** `copilot` の入力欄に `Run the shell command sleep 15.` を入力して `Enter` で送り、許可の確認（`Do you want to run this command?`）が出たら、`copilot 送信` の `実行` にマウスを載せる。確かめた後、ターミナルの中をクリックして `Esc` を押し、許可の確認を取り消す → 許可の確認の間は `実行` が押せず、`copilot が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）` が出る。`Esc` の後は `sleep` が実行されずに入力待ちに戻り、`実行` が押せる。許可の確認が出ずにコマンドが実行された（設定で許可済み）ときは、そのことを記録して次へ進む
- [ ] **AGT-265** 長い作業を送り、帯が `作業中` になったら帯の `中断` を押し、すぐに `copilot 送信` の `実行` にマウスを載せる。1 秒ほど待ってから、もう一度マウスを載せる → 押した直後（1 秒以内）は `実行` が押せず、`中断を送ったばかりのため送信できません（1 秒ほど待ってから、もう一度実行してください）` が出る。1 秒より後で、まだ作業中なら `copilot が作業中のため送信できません（…）` が出て、入力待ちなら押せる
- [ ] **AGT-266** `copilot 送信` の内容を、1 行目が `Without using any tools or files, reply with only the word OK. Ignore the numbered lines below.`、2〜12 行目が `1`〜`11` の 12 行に変えて保存し、`実行` → `送信` を押す → ターミナルの入力欄に `[Paste #1 - 12 lines]` の形が一瞬出てから送られ（見えなければ、そのことを記録する）、`エージェントに送信しました` が出る。`copilot` の画面の発言の行には 12 行の全文が出て、`OK` と答える。確かめた後、内容を元に戻して保存する
- [ ] **AGT-267** 帯の `+` で `copilot 2` を起動し（信頼の確認が出たら `1. Yes`）、入力待ちになったら `copilot 1` のタブを選んで長い作業を送り、帯が `作業中` になってから `copilot 2` のタブを選んで `copilot 送信` の `実行` → `送信` を押す → `実行` は押せ、`copilot 2` だけに送られて `OK` と答える。`copilot 1` の作業は続き、`copilot 1` の入力欄には何も入らない。確かめた後、`copilot 1` を選んで `中断` で作業を止め、`copilot 2` のタブを `×` で閉じ、確認で `OK` を押す
- [ ] **AGT-268** VoiceOver を有効にして、`copilot 1` が入力待ちのときに `copilot 送信` の `実行` → `送信` を押す。続けてターミナルの入力欄に `draft` と入力してから、同じように `実行` → `送信` を押す → 1 回目は `エージェントに送信しました` が読まれる。2 回目は `copilot の入力欄に書きかけがあるため送信できません（…）` が読まれる。確かめた後、`Ctrl+U` で書きかけを消し、VoiceOver を切る（VoiceOver を使わない場合は、この項目を飛ばしてそのことを記録する）
- [ ] **AGT-269** `copilot 1` が動いていれば `終了` で止め、設定の `使うエージェント CLI` で `Claude Code（claude）` を選ぶ。帯の `起動` で `claude 1` を起動し、入力待ちになったら、`claude` の入力欄に `hello` と入力して（`Enter` は押さない）から `copilot 送信` の `実行` → `送信` を押す。`claude` が答え終わったら、「プロンプト」パネルで `copilot 送信` を消す → `claude` では今までどおり、書きかけの `hello` を消してから本文が送られ、`エージェントに送信しました（入力欄に書きかけがあったようなので、消してから送りました）` が出る。この項目で設定は元に戻る
SECTION_EOF
```

置き換えのスクリプトを書いて実行する（`$S/update-manual-test-spec.py`。日本語を含むので `# -*- coding: utf-8 -*-` 付きのファイルにする。各置き換えが 1 か所だけに当たることを確かめる）:

```python
# -*- coding: utf-8 -*-
# 実機テスト仕様書の段階 2b の直し(既存の項目の直しと、新しい節の追記)。各置き換えはちょうど 1 か所に当たることを確かめる
import sys

spec_path, section_path = sys.argv[1], sys.argv[2]
text = open(spec_path, encoding='utf-8').read()
section = open(section_path, encoding='utf-8').read().rstrip('\n')


def replace_once(old, new):
    global text
    count = text.count(old)
    assert count == 1, f'{count} か所: {old[:60]}'
    text = text.replace(old, new)


# AGT-230: 使えない機能の注記から送信を外す
replace_once(
    '`copilot では次の機能を使えません（ターミナルで直接操作します）: プロンプトの送信（実行・再実行）、利用者の変更との区別、前回の続きから・このセッションで再開` が出る。`エージェントの通知` の項目には',
    '`copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別、前回の続きから・このセッションで再開` が出る。`エージェントの通知` の項目には',
)
# AGT-233: 入力待ちのときは押せる
replace_once(
    '- [ ] **AGT-233** 「プロンプト」パネルで登録したプロンプトの `実行` を見る → `実行` は押せず、`copilot へのプロンプトの送信には、まだ対応していません（ターミナルに直接入力してください）` が出る。`copilot` の入力欄には何も入らない',
    '- [ ] **AGT-233** `copilot 1` が入力待ちのときに、「プロンプト」パネルで登録したプロンプトの `実行` にマウスを載せる（押さない） → `実行` は押せる色で、押せない理由は出ない（送信の確かめは AGT-257 以降）。`copilot` の入力欄には何も入らない',
)
# AGT-236: 再実行の理由は未起動の理由(AGT-235 で止めているため)
replace_once(
    '`再実行` は押せず、AGT-233 と同じ理由が出る',
    '`再実行` は押せず、`エージェントが起動していません（ターミナルの「起動」を押してください）` が出る（AGT-235 で `copilot 1` を止めているため）',
)
# AGT-240: 括弧書きを消す
replace_once(
    '`エージェントが起動していません（ターミナルの「起動」を押してください）` になる（copilot への送信の理由ではない）。',
    '`エージェントが起動していません（ターミナルの「起動」を押してください）` になる。',
)
# copilot の画面の判定と中断の 3 つ目の前提(ID の無い行)
replace_once(
    '1 分ほど応答が続く。プロンプトの `実行` は copilot では押せないため、ターミナルに直接入力する）',
    '1 分ほど応答が続く。作業の長さを決めて送るため、ターミナルに直接入力する）',
)
# 新しい節: copilot の画面の判定と中断の節の後(エージェントの変更の確認の前)
replace_once('\n\n## エージェントの変更の確認', '\n\n' + section + '\n\n## エージェントの変更の確認')
open(spec_path, 'w', encoding='utf-8').write(text)
print('ok')
```

```bash
cd <repo-root>
S=$SCRATCHPAD
test -f "$S/update-manual-test-spec.py" && test -f "$S/agt-257-section.md" || echo "missing"
python3 "$S/update-manual-test-spec.py" docs/manual-test-spec.md "$S/agt-257-section.md"
git diff docs/manual-test-spec.md | grep '^[-+]- \[ \]' | grep -o '\*\*AGT-[0-9]*\*\*' | sort | uniq -c
grep -c '^- \[ \] \*\*AGT-2[56][0-9]\*\*' docs/manual-test-spec.md
```

Expected: `ok`。`uniq -c` が AGT-230・233・236・240 を 2 回ずつ（消した行と足した行）、AGT-257〜269 を 1 回ずつ出す（ほかの ID は出ない）。最後の `grep -c` が `20`（既存の AGT-250〜256 の 7 項目と、足した AGT-257〜269 の 13 項目）

- [ ] **Step 4: HTML を再生成し、仕様書の検査を流す**

Run: `node scripts/build-manual-test-spec.mjs`
Expected: `.superpowers/manual-test-spec.html` が書き出される（エラーなし）
Run: `npx vitest run scripts`
Expected: PASS（ID の一意性・接頭辞ごとの連番が昇順・書式の検査が通る）

Artifact（<manual-test-spec-artifact-url>）の再公開は、このタスクの後にコントローラーが同じファイルパス（`.superpowers/manual-test-spec.html`）で行う（実装のサブエージェントはしない）。

- [ ] **Step 5: ROADMAP を更新する（prettier にかけない）**

`$S/update-roadmap.py` を書いて実行する（日本語を含むので `# -*- coding: utf-8 -*-` 付きのファイルにする。`DATE` は実装した日〈`date +%F` の出力〉を引数で渡す）:

```python
# -*- coding: utf-8 -*-
# ROADMAP の段階 2b の記録(設計書「ROADMAP の更新の方針」)。各置き換えはちょうど 1 か所に当たることを確かめる
import sys

roadmap_path, date, constraints_path = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(roadmap_path, encoding='utf-8').read()
constraints = open(constraints_path, encoding='utf-8').read().rstrip('\n')


def replace_once(old, new):
    global text
    count = text.count(old)
    assert count == 1, f'{count} か所: {old[:60]}'
    text = text.replace(old, new)


# 「エージェント実行の支援（MVP の次）」の項目(未完了のまま): 段階 2a の行の後に段階 2b の行を足し、残りを直す
replace_once(
    '      - 残り: copilot へのプロンプトの送信（実行・再実行・送信前の確認）＝段階 2b、copilot の hooks による変更の区別・セッションの再開・起動の記録と履歴への CLI の種類の記録＝段階 3',
    f'      - 実装済み（{date}。段階 2b。設計書 `docs/superpowers/specs/2026-10-22-agent-cli-copilot-send-design.md`）: copilot へのプロンプトの送信（実行・再実行・送信前の確認）。入力待ちのときだけ送り、書きかけ・先頭の ! と / は断り、末尾の @ の語（参照の添付）は末尾に空白を足して送り、Enter の後に送れたことを画面で確かめる。実装済み機能の「copilot へのプロンプトの送信（段階 2b）」を参照\n'
    '      - 残り: copilot の hooks による変更の区別・セッションの再開・起動の記録と履歴への CLI の種類の記録＝段階 3',
)
# 段階 1 の節の既知の制約の 1 行目の末尾の書き足し
replace_once(
    'ターミナルで直接操作していた（段階 2a で、表示・通知・中断・自動の取り直しに対応した）',
    'ターミナルで直接操作していた（段階 2a で、表示・通知・中断・自動の取り直しに対応した。段階 2b でプロンプトの送信に対応した）',
)
# 段階 2a の節の既知の制約の最後の行を、段階 2a の時点の記録として過去形にする
old_2a = '- `copilot` ではプロンプトの送信（実行・再実行・送信前の確認）・利用者の変更との区別・前回の続きから・このセッションで再開を使えない（段階 2b・3）'
new_2a = '- 段階 2a の時点では、`copilot` ではプロンプトの送信（実行・再実行・送信前の確認）・利用者の変更との区別・前回の続きから・このセッションで再開を使えなかった（段階 2b・3）（段階 2b でプロンプトの送信に対応した）'
replace_once(old_2a, new_2a)
# 実装済み機能の末尾(段階 2a の節の後、--- の前)に段階 2b の節を足す
section = '''### copilot へのプロンプトの送信（段階 2b）

設計書: `docs/superpowers/specs/2026-10-22-agent-cli-copilot-send-design.md`（2026-10-22）。

- [x] プロンプトの一覧の `実行`・履歴の `再実行`・送信前の確認から `copilot` の入力欄へプロンプトを送る（能力の表の `copilot` の `promptSend` を真にした）。送信の手順は CLI の種類ごとの表（renderer の `agentPromptSendSpecs.ts`）に分け、`claude` は今の手順のまま（`claudePromptSend.ts`。書きかけを消してから貼る）、`copilot` は `copilotPromptSend.ts`。本文の検査は shared の `agentPasteText.ts` の種類ごとの表、失敗の文言は種類の表と共通の表（`agentSendMessages.ts`）で引く。新しい IPC は足していない（利用者のキー入力と同じ `agentTerminal:write`）
- [x] `copilot` は、画面の活動が入力待ちで、そのタブが中断の流れの外（中断を押してから約 1 秒より後）のときだけ押せる。作業中・許可待ち・確認待ち・判定できない画面と中断の直後は、理由を出して押せない。押した時点にも同じ条件を確かめ直す
- [x] 入力欄の空と書きかけは、入力欄の下の帯（空の入力欄の `← open … / commands`・書きかけの `@ files · # issues`）と入力欄の中の文字で見分ける（`copilotInputBox.ts`。GitHub Copilot CLI 1.0.87 の追加の記録 `copilotInputScreens.json` の 45 画面と 6 列で固定）。書きかけ（空白だけ・改行だけを含む）・シェルのモードなら送らず、書きかけは消さない。決められない一時的な帯の間は 50ms ごとに読み直し、最大 2.5 秒待つ。空は 2 回続けて確かめる
- [x] 先頭（空白を除く）が `!`・`/` の本文は送らない（送信前の確認では開いた時点に `送信` が押せない）。末尾の空白を除いた最後の語が `@` で始まる本文（参照の添付を含む）は、補完の一覧を開かせないよう末尾に空白を 1 つ足して貼る（届く本文は変わらない）
- [x] 括弧付きの貼り付けを 1 回書き、本文が入力欄に入ったこと（echo。入力欄の 1 行目の畳みの形か、空でない最後の行が本文の行に含まれる。16ms ごと・上限 1.5 秒）を確かめてから、別の書き込みで `Enter` を 1 回送る。`Enter` の後、帯が作業中になるか入力欄が空に戻ることを 16ms ごと・最大 2 秒確かめ、確かめられなければ `Enter` を送り直さずに理由を出す。`Esc`・消去のキーは送らない
- [x] 送れたとき（確かめられたとき）だけ通知・添えた参照を外す・確認からの送信のタブへの移動を行う。`copilot` へ送ったプロンプトは実行履歴に記録しない（送り先の会話の ID を持たないため。黙って省く）

既知の制約（設計書の「既知の制約」と同じ）:

''' + constraints
# 段階 2a の節の最後(過去形にした行)の直後の区切り(---)の前に足す
replace_once(new_2a + '\n\n---\n', new_2a + '\n\n' + section + '\n\n---\n')
open(roadmap_path, 'w', encoding='utf-8').write(text)
print('ok')
```

既知の制約の一覧（設計書の「既知の制約」の箇条書きそのまま。Step 1 で設計書を直したら、直した後の行を使う）を一時ファイルに書き出してから実行する:

```bash
cd <repo-root>
S=$SCRATCHPAD
test -f "$S/update-roadmap.py" || echo "missing"
sed -n '/^## 既知の制約/,/^## 実機テスト仕様書の新しい項目の下書き/p' docs/superpowers/specs/2026-10-22-agent-cli-copilot-send-design.md | grep '^- ' > "$S/roadmap-constraints.md"
wc -l "$S/roadmap-constraints.md"
python3 "$S/update-roadmap.py" ROADMAP.md "$(date +%F)" "$S/roadmap-constraints.md"
git diff --stat ROADMAP.md
grep -n "段階 2b" ROADMAP.md
```

Expected: `wc -l` が `16`（Step 1 で行を足し引きしたらその数）。`ok`。`grep` が、項目の段階 2b の行・段階 1 の既知の制約の書き足し・段階 2a の既知の制約の過去形の行・新しい節の見出しと既知の制約を出す。`- [ ] \`claude\` 以外のエージェント CLI への対応`は`- [ ]`（未完了）のまま

- [ ] **Step 6: 全体の検証**

```bash
cd <repo-root>
npm run typecheck
set -- $(git status --porcelain | grep -v '^ D' | awk '{print $NF}' | grep -E '\.(ts|tsx)$')
echo "$#" "$@"
npx eslint --max-warnings 0 "$@"
set -- $(git status --porcelain | grep -v '^ D' | awk '{print $NF}' | grep -E '\.(ts|tsx|md)$' | grep -v '^ROADMAP.md$')
npx prettier --check "$@"
npx vitest run
```

Expected:

- `npm run typecheck` が PASS
- `echo` が、Task 1〜6 で作った・変えた TypeScript のファイルを並べる（`set --` は zsh でも単語に分ける。`path` は使わない）。`npx eslint` がエラー・警告なし
- `npx prettier --check` がすべて整形済み（`ROADMAP.md` は外している。`.json` の台帳は拡張子で外れる。外れたファイルは、そのファイルだけを `npx prettier --write <ファイル>` で直す。`docs/manual-test-spec.md`・設計書・このプランが外れたら同じく直す）
- `npx vitest run` が PASS（負荷による時間切れは、落ちたファイルを単体で流し直して確かめ、報告に書く）

`git status --short` で、変更・作成したファイルが「ファイルの構成」の表と一致することと、`.superpowers/` が出ないことを確かめる。

---

## Self-Review（計画の作成者が設計書と照らし合わせた結果）

**1. 設計書の要件の取りこぼし（構成・テスト方針の割り当て）**

| 設計書の項目                                                                                                                                                                                         | タスク |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 台帳（変換・個人情報の置き換え・`copilotInputScreens.json`・`.ts`・README・`.prettierignore`・SHA-256）                                                                                              | 1      |
| 入力欄の特定の移動・記号・行・`readCopilotInputState`・`isCopilotPasteEchoed`（台帳の期待・列・echo・手書きの画面・段階 2a の台帳）                                                                  | 2      |
| 本文の検査（`AGENT_PROMPT_TEXT_RULES`・`normalizeAgentPrompt(raw, kind)`）・失敗の種類・失敗の文言の表・活動の理由・`RUN_DISABLED_INTERRUPTING`・プレビュー・未保存の注意・確認のダイアログ          | 3      |
| `claudePromptSend.ts`（移動）・`copilotPromptSend.ts`・`agentPromptSendSpecs.ts`・`AgentSendTarget.readScreen`・統合テスト                                                                           | 4      |
| 能力の表の `promptSend`・押せる条件の活動と中断の流れ（3 つの入口）・`useAgentInterrupt` の `isInterrupting`・`isInterruptPending`・パネルへ UI の値だけ・`agentInterrupt.ts` のコメント・設定の注記 | 5      |
| `useAgentPromptSender` の `interrupting` の守り・`isInterrupting` の配線（ref と effect）・送れたときの `cliKind`・`onSent(sentTo, cliKind)`・`recordAgentSent` の黙った省略・配線のテストと変異     | 6      |
| ROADMAP・既知の制約の照合・実機テスト仕様書（AGT-257〜269 と既存の項目の直し）・全体の検証                                                                                                           | 7      |

設計書の「テスト方針」の各ファイル（`agentPasteText.test.ts`・`agentCliKinds.test.ts`・`copilotInputScreensFixture.test.ts`・`copilotInputBox.test.ts`・`copilotScreenActivity.test.ts`・`copilotPromptSend.test.ts`・`claudePromptSend.test.ts`・`agentPromptSendSpecs.test.ts`・`agentSendMessages.test.ts`・`agentSendPreview.test.ts`・`agentReferenceMessages.test.ts`・`promptRunState.test.ts`・`usePromptRunner.test.ts`・`agentSendCallbacks.test.ts`・`useAgentPromptSender.test.ts`・`useAgentInterrupt.test.ts`・`AgentSendConfirmDialog.test.tsx`・`useAgentWorkspace.test.ts` の配線・統合テスト）は、どれもいずれかのタスクの Step にテストのコードとして書いた。依頼で指定された知見（L-001・L-017・L-019・L-037・L-041・L-059・L-072・L-157・L-408・L-414・L-593・L-594・L-596・L-597）は、各タスクの「気をつける知見」に割り当てた。

**2. 計画の時点で行ったドライラン**

プランの作成者が、リポジトリの写し（scratchpad の作業用の一時ディレクトリ。リポジトリは変えていない）に Task 1〜6 をこのプランのコードと手順のとおりにかけ、次を確かめた。

- Task 1 のスクリプトが 45 画面・6 列を書き出し、SHA-256（変換の後 `f6f1fdd8…`、置き換えた後 `b2015f3d…`）がプランの値と一致する
- 各タスクの後に、そのタスクのテストが通る。Task 4・5・6 の後に `npx vitest run`（全体。578 ファイル）・`npm run typecheck`・変更したファイルへの `npx eslint --max-warnings 0` が通る
- Task 5・6 の変異（押せる条件の活動・中断の流れ・sender への `isInterrupting` の受け渡しを外す）で、配線のテストが落ちる
- Task 7 の 2 つの置き換えのスクリプトが、仕様書と ROADMAP の写しに 1 か所ずつ当たり、`node scripts/build-manual-test-spec.mjs <写し>` が通る（1,332 項目）

**3. Self-Review とドライランで直したこと**

- 統合テストの先頭の `// @vitest-environment node` を外した（renderer のテストの準備 `src/renderer/src/__tests__/setup.ts` が jsdom の `Element` を使うため、node の環境では読み込めない。node-pty は jsdom の環境でも動く）
- Task 6 の既存のテストの書き換えのパターンに、`onSent?.(SENT_TO)`（省略可能な呼び出し）と `{ …, sentTo }`（省略記法）を足し、`useAgentWorkspace.test.ts` の「送信の後にパネルを開く onSettled を渡す」の期待に `isInterrupting` を足した（型の検査とテストで落ちていた）
- 配線のテストの補助の名前を `useRealSender` から `installRealSender` にした（`use` で始まる名前は ESLint の Hooks の規則で、テストの中の呼び出しが誤りとされる）
- Task 1 の変異の確かめを、置き換えの前の台帳で個人情報のテストが落ちることの確かめにした（規則 1 を外しても規則 1' が同じ行を置き換えるため、元の案では落ちなかった）。Task 2 の変異の確かめを、確実に落ちる 4 つにした
- Task 7 の仕様書の差分の数え方を、項目の ID（`**AGT-…**`）だけを数える形にした（新しい項目の本文に `AGT-233`・`AGT-235`・`AGT-257` が出るため、元の数え方では数が合わなかった）。最後の `grep -c` の期待を `20` に直した
- ROADMAP の行番号の注記を、計画の時点の実際の行（515・555・612〜615。設計書と同じ）に直した
- テストのコードのブロックを prettier をかけた形に合わせ、Task 3 の `prettier --write` に実装のファイルを足した。Task 4 の `sendAgentPrompt` の残りの確かめの期待に、`claudePromptSend.ts` の改名の注記を足した
- 型・関数の名前（`AgentInterruptState`・`AgentSentHandler`・`AGENT_SEND_FAILURE_COMMON_TEXTS`・`AGENT_SEND_BLOCKED_BY_ACTIVITY`・`screenFromTexts`・`buildCopilotPasteText`・`COPILOT_*` の定数）を、冒頭の「型・関数の名前」と各タスクの Interfaces・コードで突き合わせ、食い違いが無いことを確かめた
