# claude 以外のエージェント CLI への対応 段階 2b（copilot へのプロンプトの送信）設計書

- 日付: 2026-10-22
- ROADMAP の項目: 「エージェント実行の支援（MVP の次）」の「`claude` 以外のエージェント CLI への対応（起動コマンドの設定。入力欄の挙動が CLI ごとに違う点の吸収）」（`ROADMAP.md:612`）
- 前提の設計書: `2026-10-20-agent-cli-kind-foundation-design.md`（段階 1。CLI の種類と能力の表・`copilot` で使えない入口の理由）、`2026-10-21-agent-cli-copilot-screen-design.md`（段階 2a。`copilot` の画面の判定・入力欄の特定・中断の 2 回目）、
  `2026-10-04-agent-terminal-mvp-design.md`（プロンプトの送信の手順・`agentTerminal:write`）、送信前の確認・参照の添付・履歴への記録の各設計書
- 調査の結果: 段階 0 の `.superpowers/agent-cli-kind/copilot-screens-recorder/report.md`・`screens.md` と、段階 2b の追加の記録 `.superpowers/agent-cli-kind/copilot-input-recorder/report.md`（生の記録は同じフォルダの `out/`）。
  どちらも GitHub Copilot CLI 1.0.87 を、一時の `HOME`・`COPILOT_HOME`・偽のローカルの提供元で、GitHub のサービスに接続せずに記録した。今の `claude` の送信の流れとの違いの調べもの: `.claude/dev-flow/send-research.md`
- 実装は 1 つの実装プラン・1 つの PR にする（「実装の分割」）

## 目的

段階 2a で、`copilot` のタブでも画面の判定（作業中・入力待ち・許可待ち・確認待ち）と帯の `中断` が使えるようになった。ただしプロンプトの送信は、能力の表の `promptSend` が `false` のままで、
プロンプトの一覧の `実行`・履歴の `再実行`・送信前の確認は `copilot へのプロンプトの送信には、まだ対応していません（ターミナルに直接入力してください）` で押せない。

この段階 2b では、`copilot` の `promptSend` を `true` にし、この 3 つの入口から `copilot` の入力欄へプロンプトを送れるようにする。
送信の手順は CLI の種類ごとの表に分け、`claude` の手順は中身を変えずに表へ入れる。`claude` を選んでいる間（既定）の挙動は今までと同じにする。
`copilot` の手順は、`claude` と違って入力欄を消さない（書きかけがあれば断る）、入力待ちのときだけ送る、`Enter` の後に送れたことを画面で確かめる、の 3 点が大きく違う。

## 決めたこと（利用者の確認済み）

2026-10-22 に利用者が決めた。

| 項目               | 決定                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 今回の範囲         | 能力の表の `copilot` の `promptSend` を `true` にし、実行（プロンプトの一覧の `実行`）・再実行（履歴の `再実行`）・送信前の確認を `copilot` のタブでも使えるようにする                                                                                                                                                        |
| 範囲の外           | hooks による変更の区別・セッションの再開・起動の記録は段階 3                                                                                                                                                                                                                                                                  |
| 書きかけ           | `copilot` の入力欄に書きかけがあれば送らない。理由を出し、書きかけは消さない（`copilot` は `Ctrl+U` が行を越えない。`Esc` 2 回で消せるが、空と誤判定すると巻き戻しの画面が開き、利用者の `Esc` と組になる危険もある）                                                                                                         |
| 先頭の文字         | 先頭が `!` か `/` なら送らない。理由を出す（追加の記録で、括弧付きの貼り付けでも先頭の `!` はシェルの実行に、先頭の `/` はスラッシュコマンドの実行になると分かった）。末尾が `@…` で `Enter` が補完の確定に取られる件は、追加の記録（report.md の 8）をもとに、断らずに末尾に空白を 1 つ足して送る（下の「末尾の `@` の語」） |
| 送れたことの確かめ | `Enter` の後、上限つきで、入力欄が空に戻るか帯が作業中に変わるのを待つ。確かめられなければ失敗として出し、`Enter` は送り直さない（L-001・L-414）。上限の値は記録から決める（下の「送れたことの確かめの上限」）                                                                                                                |

## 決めたこと（推奨案で決めた事項）

利用者の判断が要るほどの選択は無かったため、この設計書で推奨案に決めた。

| 項目                         | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 送信の手順の表の形           | renderer の `lib/agentPromptSendSpecs.ts`（新規）に `AGENT_PROMPT_SEND_SPECS: Record<AgentCliKind, AgentPromptSendSpec>` を置く。項目は「押せる条件に入力待ちと中断の流れの外を入れるか（`requiresIdle`）」と「送信の手順（`send`）」の 2 つ。`claude` は今の `sendAgentPrompt` を中身を変えずに `lib/claudePromptSend.ts` へ移して `sendClaudePrompt` に改名したもの、`copilot` は `lib/copilotPromptSend.ts`（新規）の `sendCopilotPrompt`。本文の検査（先頭の文字）は shared の `agentPasteText.ts` の種類ごとの表 `AGENT_PROMPT_TEXT_RULES` に置く（送信前の確認のプレビューも同じ表を引くため）。段階 2a の判定の表・中断の送り方の表と同じ流儀（L-593）                                                                                                                                                                                                                                                                                                                                                                                                              |
| 押せる条件                   | `copilot` は「画面の活動が入力待ち（`idle`）で、そのタブが中断の流れの外」のときだけ押せる（作業中の `Enter` は送信待ち〈pending〉になり、作業が終わると勝手に送られる。中断の 2 回目を待つ間に貼り付けると、2 回目の `Esc` が貼った本文を消しうる）。判定は 3 つの入口で同じ関数（`getPromptRunAvailability`）にし、押した時点にも同じ条件を確かめ直す（L-058）。`claude` は今までどおり活動を見ない（`requiresIdle: false`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 空と書きかけの見分け方       | 帯を主な手がかりにし、入力欄の中の文字で裏を取る。入力欄の中に文字があれば「書きかけ」。入力欄が 1 行で文字が無く、帯（下の罫線より下の行をつないだ文字列）が空の入力欄の形（`← open … / commands`。40 列の段組みの折り返しでも当たる形）なら「空」。帯が書きかけの形（`@ files · # issues`）なら、文字が見えなくても「書きかけ」（空白だけの書きかけ）。記号が `!` なら「シェルのモード」。それ以外（一時的な帯 `esc again to clear input`・`esc again to rewind`・`ctrl+c again to exit`・`any key close help` など）は「決められない」として保留する。`copilot` の画面に反転のカーソルは無い（端末のカーソルを出し入れしている）ので、`claude` の `isInputBoxEmpty` の規則は使わない                                                                                                                                                                                                                                                                                                                                                                                    |
| 保留の上限                   | 「決められない」の間は 50ms ごとに読み直し、2,500ms で `input-undetermined`（送らない）。一時的な帯で長さが分かっているものの最長は `ctrl+c again to exit` の約 2,000ms（記録の 6）で、それに 500ms の余裕を足した。`any key close help` は何か押すまで消えないので、上限で失敗になる（キーを送って閉じない）。「空」も描き直しの途中で判定しないよう、50ms の間隔で 2 回続けて確かめる（`claude` の消去の後の確かめと同じ）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 貼り付け                     | 必ず括弧付き（`ESC[200~` + 貼る本文 + `ESC[201~`。`buildAgentPasteBytes`）で 1 回の書き込み。貼る本文は正規化した本文で、末尾の語が `@` で始まるときだけ末尾に空白を 1 つ足したもの（下の「末尾の `@` の語」）。消去のキー（`Ctrl+U`・`Ctrl+K`・`Esc`・`Backspace`）は一切送らない（書きかけは断るので、送る時点の入力欄は空）。bracketed paste が無効なら今までどおり `not-accepting`（`copilot` は起動直後から有効なので、合図としては弱い。入力欄の特定と入力待ちの確かめが主な守り）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| echo の確かめ                | 入力欄の 1 行目が畳みの形（`[Paste #N - M lines]`・`[Saved pasted content to workspace (…)`）なら現れたとする。そうでなければ、入力欄の空でない最後の行が本文のどれかの行に含まれれば現れたとする。1 行目ではなく最後の行で見るのは、入力欄の高さに上限があり（30 行の画面で 13 行、12 行の画面で 4 行）、超えると先頭が見えなくなり `❯` が見えている最初の行に付くため（記録の 7）。最後の行は貼り付けの後のカーソルの行なので常に見える。`copilot` は文字の単位で折り返すので、見えている行は本文の行の部分の文字列になる。16ms ごと・上限 1,500ms（記録の echo は約 210〜300ms で大きさにほぼよらず、200,000 字でも 295ms。アプリの xterm と IPC の遅れを見て約 5 倍にした）。比べる前に入力欄の行と本文の行の前後の空白を除くので、末尾の `@` の語の後ろに足した空白で結果は変わらない                                                                                                                                                                                                                                                                                 |
| Enter                        | echo を確かめてから、括弧とは別の書き込みで `\r` を 1 回だけ送る。括弧と同じ書き込みでも送信になる（記録の 3。20KB を超えても全文が届く）が、それでは送る前に本文が入力欄に入ったかを確かめられない（間に確認の画面が出ていれば、`\r` が選択肢を確定させる）。echo を確かめた後の `Enter` でも全文が 1 回の要求で届いた（記録の 3。0〜300ms の間隔）ので、別の書き込みにしても本文は欠けない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 送れたことの確かめの上限     | `Enter` の後、16ms ごとに読み、帯が作業中（段階 2a の判定で `working`）になるか、入力欄が「空」（上の見分け方。帯が空の入力欄の形に戻ったことも含む）になれば送れたとする。上限は 2,000ms。記録では入力欄が空になるのと帯が作業中になるのはほぼ同時で、`Enter` から 11〜91ms（即答では作業中は約 36ms しか見えず 99ms で入力待ちに戻るが、そのときは入力欄が空なので拾える。記録の 4）。最も遅い 91ms の 20 倍の余裕を取った。上限で確かめられなければ `not-confirmed` を出し、`Enter` は送り直さない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 末尾の `@` の語              | 断らない。`copilot` の手順で、正規化した本文の末尾の空白（改行を含む）を除いた最後の語が `@` で始まるとき（`/(?:^\|\s)@\S*$/`）は、貼る本文を「末尾の空白を除いた本文 + 空白 1 つ」にして送る（`buildCopilotPasteText`）。根拠は追加の記録（report.md の 8）: 末尾に空白を 1 つ足すと補完の一覧が開かず、`Enter` 1 回で送られ、末尾の空白は落ち、`<tagged_files>` も付いた（場面 2・補足 8）。末尾に改行を足しても改行は入力欄に残らず一覧が開く（場面 3）。一覧が開いている間の `Esc` は一覧を閉じず、2 回目が来ると書きかけを消す危険だけがある（場面 6）。そのため改行・`Esc` は使わない。足しなければ `Enter` は候補の確定に取られ、本文が別のファイル名に書き換わりうる（`suffix-100x30` の `at-enter+3000`）。末尾の空白（改行を含む）は `copilot` が入力欄に残さない・送るときに落とすので、届く本文は利用者の本文と同じになる。アプリの参照の添付（`本文\n\n参照:\n- @パス`）もこれで送れる。送信前の確認の本文・履歴の本文は利用者の本文のまま（足すのは貼るバイト列だけ）。一覧が開くのは入力欄の最後の語だけで、行の途中の `@パス` は開かない（report.md の 8） |
| 先頭の文字の見方             | `copilot` は先頭の空白を除いた最初の文字が `!`・`/` なら断る（`claude` は今までどおり 1 文字目の `!` だけ）。先頭の空白の後の `!`・`/` を貼ったときの扱いは記録していないので、送る側に倒さない。行の途中の `!`・`/` は普通の文字として送られた（`x!echo hi`・`run /help`）ので、文言では「先頭に別の文字を足すと送れます」と案内する（空白を入れる案内は `copilot` ではしない）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 失敗の扱い                   | どの段でも確かめられなければ、その場で止めて先へ進まない。`Enter` の前の失敗では `Enter` を送らず、`Enter` の後の失敗でも送り直さない。送れたとき（`sent`）だけ通知・`onSent`（添えた参照を外す）・確認からの送信のタブへの移動を行う（今の流れのまま。L-001）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 文言                         | 失敗の種類を足し、CLI で文が違う失敗（先頭の `!`・本文が入力欄に入らなかった）は種類ごとの表 `AGENT_SEND_FAILURE_KIND_TEXTS: Record<AgentCliKind, …>` で引く。ほかは CLI に依らない文で、CLI の名前は `AGENT_CLI_PROFILES[kind].commandName` から作る。`claude` の文言は 1 文字も変えない。押せない理由と送った後の失敗は、同じ原因なら同じ文言にする（「文言」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| renderer から pty へ届く文字 | 新しい IPC は足さない。送信は利用者のプロンプトを送る機能で、今の `claude` と同じ `controller.writeToSession` → `agentTerminal:write` の経路（利用者のキー入力と同じ）を使う。書くのは「正規化（`ESC`・C0・C1 の除去）した本文の括弧付きの貼り付け」と「`\r`」の 2 回だけで、手順の外から文字列を足せない形にし、テストで書いた列の完全一致を確かめる（L-019・L-083）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Esc を送らない               | 送信の手順は `Esc` を一切送らない（消去にも使わない）。作業中でないときに `Esc` を送らない（L-041）を、手順の形で守る                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 中断との排他                 | 送信中は帯の `中断` を押せない（今の作り）。逆に、そのタブが中断の流れの間（1 回目を送ってから 2 回目の流れが終わり、1,000ms の待ちが明けるまで）は `copilot` へ送らない（`interrupting`）。描画は `useAgentInterrupt` の待ちの state（`isPending`）、押した時点はその ref 版 `isInterrupting(slotId) = isInFlight(slotId) \|\| isCoolingDown(slotId)` で見る（ref 版は SRP リファクタリングで、state 版と同じ `useAgentInterruptCooldown` の `isPendingNow` に置いた。同じ間を 1 つのファイルで決める）（`isCoolingDown` だけでは、1 回目の結果や 2 回目の流れが 1,000ms を超えたときに流れの途中で偽になる）（段階 2a の「新しい状態と既存の入口」で 2b に回した守り）                                                                                                                                                                                                                                                                                                                                                                                                   |
| 送信前の確認のプレビュー     | ダイアログの送れない理由（本文の理由）を、確認を開いた時点に控えた送り先の種類の規則で出す（`buildAgentSendPreview(raw, cliKind)`）。`copilot` の送り先では `/help` も開いた時点で `送信` が押せない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 画面の台帳                   | 段階 2a の `copilotScreens.json` は変えず、別の台帳 `copilotInputScreens.json`（新規）を足す。記録の道具と回が違い（`copilot-input-recorder`）、段階 2a の台帳のハッシュと「全画面が判定の期待に入る」テストをそのまま保てるため。新しい台帳は追加の記録の 45 画面（末尾の参照の `atref1`〜`atref8` の 15 画面を含む）と 6 つの列で、どの画面も活動の期待と入力欄の期待の両方を持つ。記録に無い形だけを手書きの画面で確かめる（「実装の最初に確かめること」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 履歴への記録                 | 記録の仕方は変えない（段階 3）。今の作りでは送り先の会話の ID（`claudeSessionId`）が無いタブの送信は履歴に記録しないので、`copilot` へ送ったプロンプトは実行履歴に残らない。既知の制約に書く。ただし `recordAgentSent` は送り先が `null` のとき毎回 `console.error` を出すので、送り先の種類が会話の ID を持たない（能力の表の `sessionResume` が `false`。`copilot`）ときは黙って記録を省き、`claude`（`sessionResume` が `true`）で `null` のときだけ今の `console.error` を出す。種類は送れたときの結果（`AgentPromptSendResult` の `sent`）に `cliKind` として載せ、`onSent(sentTo, cliKind)` で渡す                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 範囲

含めるもの:

- shared: 能力の表の `copilot` の `promptSend` を `true` に、本文の検査の種類ごとの表（`AGENT_PROMPT_TEXT_RULES`）と `normalizeAgentPrompt(raw, kind)`
- renderer: 送信の手順の表（`agentPromptSendSpecs.ts`）・`claude` の手順の移動（`claudePromptSend.ts`）・`copilot` の手順（`copilotPromptSend.ts`）・`copilot` の入力欄の特定と読み取り（`copilotInputBox.ts`。段階 2a の `copilotScreenActivity.ts` から切り出す）、
  押せる条件（活動・中断の流れ）・失敗の文言・送信前の確認のプレビュー・未保存の注意の CLI の名前、`useAgentPromptSender`・`useAgentInterrupt`・`useAgentWorkspace` の配線
- テスト（新しい台帳・入力欄の読み取り・手順・押せる条件・文言・配線、実物の node-pty と `@xterm/headless` で偽の CLI に送る統合テスト）、実機テスト仕様書・ROADMAP の更新

含めないもの:

- `copilot` の hooks による変更の区別、セッションの再開、起動の記録と履歴への CLI の種類の記録。段階 3
- `copilot` の書きかけの消去（断る。利用者の決定）
- 本文の書き換え（先頭に空白を足すなど）。届く本文は利用者の本文と同じにする（末尾の `@` の語の後ろに足す空白は、`copilot` が送るときに落とすので届く本文を変えない）
- 送信待ち（作業中の `Enter`）・`Ctrl+Q` のキューへの送信
- `copilot` の版の確認（規則は 1.0.87 の記録に合わせる。「既知の制約」）
- `claude`・`copilot` 以外の CLI

## copilot の入力欄（記録の要点）

`copilot-input-recorder/report.md` と生の記録から、送信の手順に使う事実だけを抜き出す（番号は report.md の節の番号。設計書の中の「記録の N」もこの番号を指す）。断りが無ければ 100 列 × 30 行。

1. **先頭の文字**（空の入力欄に括弧付きで貼り、800ms 後に `Enter`）: `!echo hi` は記号が `!` に替わり（`! echo hi`、帯 `shell`）、`Enter` でシェルで実行（提供元への要求 0）。`/help me` は一覧を開かずに入るが、`Enter` で `/help` を実行（要求 0）。`/` だけは一覧が開き最初の候補 `/add-dir` が入る。
   `?why`・`# heading` は普通に送られた。`@file`・`@` は補完の一覧が開き、1 回目の `Enter` は候補の確定（要求 0）。書きかけ `x` の後の `!echo hi` はシェルのモードにならない（`x!echo hi`）。
   末尾: `look at @file` は `Enter` が補完の確定に取られ（要求 0）、本文が `look at @file.txt` に変わった。補完の候補の一覧は入力欄の上の罫線より上に出る（`  ❯ @file.txt`）。`fix #12`・`run /help`・`say hi!` は送られた（オフラインで issue の一覧が出ない環境）。
2. **畳み**: 10 行まではそのまま、11 行から `❯ [Paste #N - M lines]`（CRLF・CR だけでも同じ）。UTF-8 で 20,480 バイトを超えると `❯ [Saved pasted content to workspace (20.0 KB) id=N]` に替わり、送ると提供元へは `<pasted_content file="…/session-state/<セッション>/files/paste-<数字>.txt" … />` が届く。長い 1 行は文字数では畳まない。畳まれたものを送ると、画面の発言の行は全文
3. **echo と `\r`**: echo まで約 210〜300ms（150ms では空。200,000 字でも 295ms）。括弧と同じ書き込みの `\r` は送信になり全文が届く。echo の前後どちらの `Enter`（0〜300ms）でも全文が 1 回で届いた。括弧の中の `\r` は改行
4. **Enter の後**: 入力欄が空になるのと帯が作業中になるのはほぼ同時で、11〜91ms。即答では作業中は約 36ms しか見えず、99ms で入力待ちの空の帯に戻った。空白だけの書きかけで `Enter` しても送られない
5. **書きかけの見え方**: 空は `❯` と帯 `← open sidebar · / commands · ? help · tab next tab`。空白だけは `❯`（空と同じ）と帯 `@ files · # issues`。複数行は `❯ first line` / `  second line`。シェルのモードは `! Execute shell command`（空）・`! echo hi`（帯 `shell`）。シェルのモードで空白だけを入力すると、記号の行は `!` と空白だけになる（`draft-100x30` の `shell-spaces`）。反転の属性は出ない（端末のカーソルの位置だけが違う）
6. **一時的な帯**: `esc again to clear input`（約 510ms）・`esc again to rewind`（約 500ms）・`ctrl+c again to exit`（約 2,000ms。この間に貼っても帯はこのまま）・`esc again to interrupt`（約 465ms）・`any key close help`（何か押すまで。この間の貼り付けは入力欄に入った）。この間は帯から空か書きかけかを決められない
7. **入力欄の高さ**: 上限がある（30 行の画面で 13 行、12 行の画面で 4 行）。超えた分は入力欄の中でスクロールし、`❯` は見えている最初の行に付く。上の罫線は画面から出ない。12 行の画面では帯の下に空の行が残る
8. **末尾の参照**（アプリの形 `本文\n\n参照:\n- @<パス>` を含む）: 一覧は入力欄の最後の語が `@` で始まり、作業ディレクトリに候補があるときだけ開く（行の途中の `@パス` は開かない。存在しないパスは開かない）。末尾に空白を 1 つ足すと開かず、`Enter` 1 回で送られ、末尾の空白は落ち、存在する `@パス` すべてに `<tagged_files>` が付く（場面 2・補足 8）。末尾の改行は入力欄に残らず一覧が開く（場面 3）。一覧の間の `Esc` は一覧を閉じず、約 490ms 以内の 2 回目で書きかけを消す（場面 6）

- **記録できなかった場面**: `#` の issue の補完の一覧（オフライン）、消去の手順、`Ctrl+S`、`--screen-reader` での送信、`/vim`、アプリの xterm.js での実機、先頭の空白の後の `!`・`/`（末尾の空白で `@` の補完が閉じるかは、8 で確かめた）

## 送信の手順の表

### 表（`lib/agentPromptSendSpecs.ts`。新規）

```ts
import type { AgentCliKind } from '@shared/agentCliKinds'
import type {
  AgentSendClock,
  AgentSendFailure,
  AgentSendOutcome,
  AgentSendTarget
} from './agentPromptSend'
import { sendClaudePrompt } from './claudePromptSend'
import { sendCopilotPrompt } from './copilotPromptSend'

// CLI の種類ごとの送信の手順(段階 2a の判定の表 agentScreenClassifiers.ts と同じ流儀)。本文の検査(先頭の文字)は
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
  /**
   * 失敗したときに、送信の手順の間に溜めた利用者のキー入力を流さずに捨てる理由。claude は空(今のまま流す)。
   * 捨てたときは useAgentPromptSender が失敗の文言に添える
   */
  discardHeldInputOn: ReadonlySet<AgentSendFailure>
}

export const AGENT_PROMPT_SEND_SPECS: Record<AgentCliKind, AgentPromptSendSpec> = {
  claude: { requiresIdle: false, send: sendClaudePrompt, discardHeldInputOn: new Set() },
  copilot: {
    requiresIdle: true,
    send: sendCopilotPrompt,
    discardHeldInputOn: new Set(['not-echoed', 'shell-mode-after-paste', 'not-confirmed'])
  }
}
```

（`discardHeldInputOn` は PR #65 のレビュー第 3 周で足した。それまでは、溜めた入力を結果を問わず流していた）

| 段                       | `claude`（今の手順のまま）                                                             | `copilot`                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 押せる条件               | セッションが動いていて、閉じる途中でなく、送信中でない                                 | 同じ条件に加えて、そのタブが中断の流れの外で、画面の活動が入力待ち                                                                                                                     |
| 本文の検査               | 空・200,000 字超・1 文字目が `!`                                                       | 空・200,000 字超・先頭（空白を除く）が `!`・`/`                                                                                                                                        |
| bracketed paste の確かめ | 無効なら `not-accepting`                                                               | 同じ                                                                                                                                                                                   |
| 押した時点の画面         | 見ない                                                                                 | 段階 2a の判定で `idle` でなければ送らない（`screen-*`）                                                                                                                               |
| 入力欄の特定             | `findInputBox`（`agentInputBox.ts`）。無ければ `input-not-found`                       | `locateCopilotInputBox`（`copilotInputBox.ts`）。入力欄が無ければ段階 2a の判定で `idle` にならないため `screen-unknown`（確認・許可の画面なら `screen-confirm`・`screen-permission`） |
| 書きかけ                 | 確かめずに消す（`Ctrl+K`×12 + `Ctrl+U`×12 を 30ms ごと、空が 2 回続くまで。上限 3 秒） | 消さない。書きかけ・シェルのモードなら送らない。決められなければ 50ms ごとに読み直し、上限 2,500ms。空を 2 回続けて確かめる                                                            |
| 貼り付け                 | 括弧付き・消去とは別の書き込み                                                         | 括弧付き・1 回の書き込み。末尾の語が `@` で始まれば、末尾の空白を除いて空白を 1 つ足した本文を貼る                                                                                     |
| echo の確かめ            | 16ms ごと・上限 1 秒。入力欄の 1 行目が本文の 1 行目の先頭か `[Pasted text #`          | 16ms ごと・上限 1,500ms。入力欄の 1 行目が畳みの形か、入力欄の空でない最後の行が本文のどれかの行に含まれる                                                                             |
| Enter                    | 別の書き込みで `\r`                                                                    | 別の書き込みで `\r`                                                                                                                                                                    |
| 送れたことの確かめ       | しない（書いたら `sent`）                                                              | 16ms ごと・上限 2,000ms。帯が作業中か、入力欄が空に戻れば `sent`。上限で `not-confirmed`（送り直さない）                                                                               |
| 書く列（成功のとき）     | 消去（1 回以上）・貼り付け・`\r`                                                       | 貼り付け・`\r` の 2 回だけ                                                                                                                                                             |

### 呼び出し（`useAgentPromptSender.send`）

今の流れ（同期の二重送信の防止 → 能力 → 準備 → 送り先の控え → `beginSending` → 手順 → 通知・失敗の文言 → `onSettled` → `endSending`）のまま、変えるのは次の 4 つ（4 は PR #65 のレビュー第 3 周で足した）。

1. 能力の確かめの直後に、`AGENT_PROMPT_SEND_SPECS[target.cliKind].requiresIdle` が真で `isInterrupting(target.slotId)` が真なら、準備・控え・入力の保留・書き込みをどれもせずに `interrupting` で断る（`unsupported-cli` と同じ扱い。文言を出してパネルを開く）
2. `sendAgentPrompt(...)` の呼び出しを `AGENT_PROMPT_SEND_SPECS[target.cliKind].send(...)` にする
3. 送り先（`AgentSendTarget`。lib の型）に `readScreen: () => controller.readScreen()` を足す（`copilot` の手順は画面の末尾を読む。代替画面なので見え方は `readViewport` と同じだが、段階 2a の判定と同じ読み方にそろえる。`claude` の手順は今までどおり `readViewport`）
4. 手順が失敗し、理由が `AGENT_PROMPT_SEND_SPECS[target.cliKind].discardHeldInputOn` に含まれるときは、`finally` の `endSending({ discard: true })` で溜めた利用者のキー入力を送らずに捨てる（`endSending` は捨てた数を返す）。xterm が自動で返すフォーカスの通知（`copilot` が有効にする DECSET 1004 の `ESC [I`・`ESC [O`。完全一致のチャンクだけ）は利用者の入力ではないので、捨てるときも順に送り、捨てた数に入れない（PR #65 のレビュー第 4 周で足した。それまでは通知も捨てて数えていたので、送信中にターミナルをクリックしただけでも添え書きが出て、`copilot` に通知が届かなかった）。SGR のマウスの報告（`copilot` が有効にする DECSET 1003・1006 の `ESC [<b;x;yM`・`m`。1 回の操作ごとに 1 チャンクで、形と完全一致のチャンクだけ）も利用者のキー入力ではないので捨てた数に入れないが、クリックが選択肢を確定させうるので送らずに黙って捨てる（PR #65 のレビュー第 5 周で足した。それまではキー入力として数えていたので、送信の間にマウスを動かしただけでも添え書きが出た）。捨てた入力があったときだけ、失敗の文言の後ろに `AGENT_SEND_HELD_INPUT_DISCARDED_SUFFIX`（`。送信の間にターミナルで打ったキー入力は、送らずに捨てました`）を添える。見える文字と読み上げは同じ `error` から作るので、両方に出る。送れたとき・ほかの失敗・例外のときは今のまま流す。捨てる経路は書き込みを減らすだけで、pty へ届くバイトは増やさない（L-019）

`UseAgentPromptSenderOptions` に `isInterrupting: (slotId: string) => boolean` を足す（省略できない。L-060）。`useAgentWorkspace` は sender を作る前に `useRef` を用意して `(slotId) => ref.current(slotId)` を渡し、`useAgentInterrupt` が返す `isInterrupting`（参照が安定）を effect で ref に入れる（描画の中で ref を書かない。最初の effect の前は `false`。送信はマウントの後にしか起きない）。`useAgentInterrupt` の戻り値の型は、`AgentInterruptPanelState` を広げた `AgentInterruptState`（`isInterrupting`・`isInterruptPending` を足したもの）にし、`useAgentWorkspace` はパネルへ `AgentInterruptPanelState` の 4 つの値だけを渡す。

### 押せる条件（`getPromptRunAvailability`・`getHistoryRerunAvailability`）

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

## copilot の手順（`lib/copilotPromptSend.ts`。新規）

### 入力欄の特定と読み取り（`lib/copilotInputBox.ts`。新規）

段階 2a の `copilotScreenActivity.ts` の中の `locateCopilotInputBox` と、その規則の定数（`BORDER`・`SYMBOL_LINE`・`CONTINUATION`）を中身を変えずに移して公開し、結果に記号と入力欄の行を足す。判定（`classifyCopilotScreen`）は移した関数を import して使い、判定の結果は変えない（段階 2a のテストで固定）。

```ts
export type CopilotInputSymbol = 'prompt' | 'shell' | 'screen-reader'

export interface CopilotInputBox {
  /** 上の罫線の行 */
  top: number
  /** 下の罫線の行 */
  bottom: number
  /** 記号の行の形(`❯ `・`! `・`Start of Prompt Indicator`) */
  symbol: CopilotInputSymbol
  /** 入力欄の各行の本文(記号の行は記号と区切りの後ろ、2 行目以降は 2 桁の字下げの後ろ。末尾の空白は除いてある) */
  rows: string[]
  /** 帯(下の罫線より下の行)の、前後の空白を除いた空でない行を空白 1 つでつないだ文字列(段階 2a のまま) */
  band: string
  /** 帯の空でない最初の行。帯が空なら null(段階 2a のまま) */
  bandHead: string | null
}

/** 画面の行を、規則をかける文字列にする(lineText の末尾の空白を除く。段階 2a の classifyCopilotScreen と同じ) */
export function copilotScreenTexts(lines: readonly ViewportLine[]): string[]
export function locateCopilotInputBox(texts: readonly string[]): CopilotInputBox | null

export type CopilotInputState = 'empty' | 'draft' | 'shell' | 'undetermined' | 'not-found'
export function readCopilotInputState(lines: readonly ViewportLine[]): CopilotInputState
export function isCopilotPasteEchoed(lines: readonly ViewportLine[], text: string): boolean
```

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

入力欄の行（`rows`）の切り出しは、次の定数で行う（`copilotInputBox.ts` に閉じる）。

```ts
/** 記号の行から記号と区切りを除く */
const SYMBOL_PREFIXES: Record<CopilotInputSymbol, RegExp> = {
  prompt: /^❯[ \xa0]?/,
  shell: /^! /,
  'screen-reader': /^Start of Prompt Indicator/
}
/** 2 行目以降の字下げ */
const CONTINUATION_INDENT = /^ {2}/
```

記号の行は `prompt` なら行頭の `❯` と続く空白 1 つ（U+00A0 を含む）、`shell` なら `! `、`screen-reader` なら `Start of Prompt Indicator` を除く。2 行目以降は行頭の 2 桁の空白を除く。

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

- 送る直前に入力欄が空であることを確かめ、送る間は利用者のキー入力を溜めている（`beginSending`）ので、入力欄に現れた文字は貼り付けたものだけ。そのため「最後の行が本文の一部」で足りる
- 全角の文字は `lineText` が 1 文字にするので、そのまま比べられる（`ja6800` の画面で確かめる）

### 手順

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
3. **入力待ちと空の確かめ**（上限 `COPILOT_INPUT_STATE_TIMEOUT_MS`）: 次を繰り返す（3.1・3.2 の 1 回の読み取りの判定は純粋関数 `checkCopilotInputBeforePaste(lines)` にし、待ちの関数は読み直しの回数・間隔・上限だけを持つ。SRP 第 2 周で分けた）
   1. `lines = target.readScreen()`。`classifyCopilotScreen(lines)` が `idle` でなければ、活動に応じて `screen-working`・`screen-permission`・`screen-confirm`・`screen-unknown` で止める（1 回目の読み取りが押した時点の確かめ。保留の間に作業中・確認の画面へ変わっても止める）
   2. `readCopilotInputState(lines)` が `shell` なら `shell-mode`、`draft` なら `draft-present` で止める（どちらも何も書かない）。`not-found` なら `input-not-found` で止めるが、これは到達しない守り（3.1 で `idle` と判定された画面には入力欄があるので、3.1 の後に `not-found` は起きない。型の網羅のために残す）
   3. `empty` なら続けて空だった回数を足し、2 回になったら手順 4（貼り付け）へ進む。空が 1 回だけのときは 3.4 へ。`undetermined` なら回数を 0 に戻して 3.4 へ
   4. 上限に達していれば（`clock.now()` が上限の時刻以上。`claude` の手順と同じ比べ方。5・7 の上限も同じ）`input-undetermined` で止める（何も書かない）。達していなければ `COPILOT_INPUT_STATE_POLL_MS` 待って 3.1 へ
4. **貼り付け**: `pasteText = buildCopilotPasteText(text)`（末尾の空白〈改行を含む〉を除いた最後の語が `@` で始まれば `text.trimEnd() + ' '`、それ以外は `text` のまま）を `target.write(buildAgentPasteBytes(pasteText))`（1 回の書き込み）。5 の echo の確かめは `pasteText` で行う
5. **echo の確かめ**（上限 `COPILOT_ECHO_TIMEOUT_MS`。1 回の読み取りの判定は純粋関数 `checkCopilotPasteEcho(lines, pasteText)` が `echoed`・`shell`・`pending` を返す）: `COPILOT_ECHO_POLL_MS` 待ってから読み、`isCopilotPasteEchoed(lines, pasteText)` が真なら 6 へ。入力欄がシェルのモード（`readCopilotInputState(lines) === 'shell'`）に変わったら `shell-mode-after-paste`（本文が入ったシェルのモードで `Enter` を押すとシェルで実行されるので、送るよう案内しない。review-loop 第 2 周で `not-echoed` から分けた）、上限を過ぎた・画面の読み取りが例外を投げたら `not-echoed`（どれも `Enter` を送らない。本文は入力欄に残りうるので、文言で案内する。読み取りの例外は `console.error` に残す）
6. **Enter**: `target.write(AGENT_SUBMIT_KEY)`（`\r`。貼り付けとは別の書き込み）
7. **送れたことの確かめ**（上限 `COPILOT_SUBMIT_CONFIRM_TIMEOUT_MS`）: `COPILOT_SUBMIT_CONFIRM_POLL_MS` 待ってから読み、`classifyCopilotScreen(lines) === 'working'` か `readCopilotInputState(lines) === 'empty'` なら `{ kind: 'sent', clearedDraft: false }`（この判定は `isCopilotSubmitConfirmed(lines)` として `copilotScreenActivity.ts` に置く。活動の判定と入力欄の読み取りの両方を使うため、依存の向きは `copilotInputBox` ← `copilotScreenActivity` ← `copilotPromptSend` の一方向になる）。上限を過ぎたら `not-confirmed`（`Enter` を送り直さない）。`Enter` の後の画面の読み取りが例外を投げたときも、`Enter` を送り直さず `not-confirmed` に倒す（実際には送れていることがあり、「送信できませんでした」と出すと利用者が送り直して二重に送りうる。L-001。例外は `console.error` に残す）

- 書くのは 4 の貼り付けと 6 の `\r` だけ。`Esc`・`Ctrl+U`・`Ctrl+K`・`Ctrl+C`・`Backspace` は書かない（L-041）
- 時計は注入する（`AgentSendClock`。テストは偽の時計で進める）。外部の待ちは無い
- `clearedDraft` は常に `false`（書きかけを消さないので、`AGENT_SENT_AFTER_CLEAR_NOTICE` は出ない）

### 失敗の一覧

`AgentSendFailure`（`agentPromptSend.ts`）に足す種類:

| 種類                     | 起きる段 | 書いたもの     | 意味                                                                      |
| ------------------------ | -------- | -------------- | ------------------------------------------------------------------------- |
| `leading-slash`          | 1        | なし           | 先頭（空白を除く）が `/`（`AgentPromptRejection` に足す）                 |
| `interrupting`           | 呼び出し | なし           | そのタブが中断の流れの間（`useAgentPromptSender.send` の先頭で断る）      |
| `screen-working`         | 3        | なし           | 作業中                                                                    |
| `screen-permission`      | 3        | なし           | 許可待ち                                                                  |
| `screen-confirm`         | 3        | なし           | 確認待ち                                                                  |
| `screen-unknown`         | 3        | なし           | 判定できない                                                              |
| `shell-mode`             | 3        | なし           | シェルのモード                                                            |
| `draft-present`          | 3        | なし           | 書きかけがある（消していない）                                            |
| `input-undetermined`     | 3        | なし           | 上限まで空か書きかけかを決められなかった                                  |
| `shell-mode-after-paste` | 5        | 貼り付け       | echo を待つ間に入力欄がシェルのモードに変わった（`Enter` は送っていない） |
| `not-confirmed`          | 7        | 貼り付け・`\r` | `Enter` の後に送れたことを確かめられなかった（送り直していない）          |

今ある種類のうち `copilot` の手順が返すのは `empty`・`too-long`・`leading-bang`・`not-accepting`・`not-echoed`（`clear-failed` は返さない。`input-not-found` は手順 3.2 の到達しない守りとしてだけ残し、入力欄が無い画面は 3.1 の `screen-*` になる）。
`screen-*` の 4 つは型の上で `` `screen-${Exclude<AgentActivity, 'idle'>}` `` から作り、活動を足したときの決め忘れを型エラーにする。

## 本文の検査（`src/shared/agentPasteText.ts`）

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

## 文言

`lib/agentSendMessages.ts`。`claude` の文言は 1 文字も変えない。`{cmd}` は `AGENT_CLI_PROFILES[kind].commandName`（`copilot`）。

### CLI で文が違う失敗（`AGENT_SEND_FAILURE_KIND_TEXTS`）

```ts
interface AgentSendFailureKindTexts {
  /** 先頭が「!」(leading-bang) */
  leadingBang: (commandName: string) => string
  /** 本文が入力欄に入ったかを確かめられなかった(not-echoed) */
  notEchoed: (commandName: string) => string
}

const AGENT_SEND_FAILURE_KIND_TEXTS: Record<AgentCliKind, AgentSendFailureKindTexts>
```

（SRP リファクタリングで、この表と活動の理由の表 `AGENT_SEND_BLOCKED_BY_ACTIVITY` は export しないことにした。外からは `agentSendFailureMessage`・`agentSendBlockedByActivityReason` で引く）

| 種類           | `claude`（今と同じ）                                                                                                          | `copilot`                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leading-bang` | `先頭が「!」のプロンプトは、エージェントのシェルのコマンドとして実行されるため送信できません（先頭に空白を入れると送れます）` | `先頭（空白を除く）が「!」のプロンプトは、copilot のシェルのコマンドとして実行されるため送信できません（先頭に空白・「!」・「/」以外の文字を足すと送れます）`              |
| `not-echoed`   | `エージェントの入力欄に入りませんでした。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください`                | `copilot の入力欄に本文が入ったか確かめられなかったため、Enter を送りませんでした。ターミナルの画面を確かめてください（入力欄に本文が入っていれば、送るか消してください）` |

### CLI に依らない失敗の文言（足すもの）

| 種類                     | 文言                                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leading-slash`          | `先頭（空白を除く）が「/」のプロンプトは、{cmd} のスラッシュコマンドとして実行されるため送信できません（先頭に空白・「!」・「/」以外の文字を足すと送れます）`                                              |
| `interrupting`           | `中断を送ったばかりのため送信できません（2 秒ほど待ってから、もう一度実行してください）`（押せない理由の `RUN_DISABLED_INTERRUPTING` と同じ）                                                              |
| `screen-working`         | `{cmd} が作業中のため送信できません（作業が終わって入力待ちになってから、もう一度実行してください）`                                                                                                       |
| `screen-permission`      | `{cmd} が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）`                                                                                                                 |
| `screen-confirm`         | `{cmd} が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）`                                                                                                                 |
| `screen-unknown`         | `{cmd} が入力待ちか判定できないため送信できません（ターミナルの画面を確かめてから、もう一度実行してください）`                                                                                             |
| `shell-mode`             | `{cmd} がシェルのモードのため送信できません（ターミナルでシェルのモードを抜けてから、もう一度実行してください）`                                                                                           |
| `draft-present`          | `{cmd} の入力欄に書きかけがあるため送信できません（書きかけは消していません。ターミナルで送るか消してから、もう一度実行してください）`                                                                     |
| `input-undetermined`     | `{cmd} の入力欄が空か確かめられなかったため送信できません（ターミナルの画面を確かめてから、もう一度実行してください）`                                                                                     |
| `shell-mode-after-paste` | `{cmd} の入力欄がシェルのモードに変わったため、Enter を送りませんでした。入力欄の本文は送らずに、ターミナルで消してからシェルのモードを抜けてください（Enter を押すとシェルのコマンドとして実行されます）` |
| `not-confirmed`          | `{cmd} に送れたか確かめられませんでした。ターミナルの画面を確かめてください（入力欄に本文が残っていれば、送るか消してください）`                                                                           |

- 実装での名前: 共通の表は `AGENT_SEND_FAILURE_COMMON_TEXTS`、活動の理由の表は `AGENT_SEND_BLOCKED_BY_ACTIVITY` とする。今の `AGENT_SEND_FAILURE_MESSAGES` は消し、テストは `agentSendFailureMessage(reason, 'claude')` で引く
- 押せない理由の活動の文言は `agentSendBlockedByActivityReason(activity: Exclude<AgentActivity, 'idle'>, commandName)` が作り、`screen-*` の失敗の文言も同じ関数で作る（押せない理由と送った後の失敗が同じ原因なら同じ文。L-058）
- 関数の形: `agentSendFailureMessage(reason, kind)`（今の `(reason, commandName)` を種類を受け取る形にする。`unsupported-cli` は今の `agentPromptSendUnsupportedReason`、`leading-bang`・`not-echoed` は種類の表、ほかは共通の表）。共通の表は `Record<Exclude<AgentSendFailure, 'unsupported-cli' | 'leading-bang' | 'not-echoed'>, (commandName: string) => string>` にし、種類を足したときの決め忘れを型エラーにする
- 文言には次の行動（ターミナルで答える・抜ける・消す・待つ）を入れる（L-597）。書きかけを消していないこと・`Enter` を送っていないこと・送り直していないことを、利用者が誤解しないように書く
- 送信前の確認のダイアログの未保存の注意 `formatAgentUnsavedNotice(paths, commandName)`（`agentReferenceMessages.ts`）: `未保存の変更があるファイルは、保存するまで {cmd} に見えません: …`。`claude` は今と同じ文になる
- 設定の画面の使えない機能の注記は能力の表から作るので、`copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別、前回の続きから・このセッションで再開` になる（コードは変えない）
- `agentPromptSendUnsupportedReason` は、能力が `false` の種類のために残す（今は該当する種類が無い。テストは能力の表の `vi.mock` で確かめる。段階 2a と同じ）

## 新しい状態と既存の入口（L-061）

`copilot` の送信の間（送信中。準備の最大 10 秒 + 保留の最大 2.5 秒 + echo の最大 1.5 秒 + 確かめの最大 2 秒）は、今の「送信中」の状態がそのまま覆う。新しく足す守りは「中断の流れの間は送らない」だけ。

| 入口                                                    | `copilot` の送信中                                                                                                      | `copilot` のタブの中断の流れの間（1,000ms の待ちが明けるまで） |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| プロンプトの `実行`・履歴の `再実行`                    | 押せない（送信中。今のまま）                                                                                            | 押せない（`RUN_DISABLED_INTERRUPTING`）                        |
| 送信前の確認の `送信`                                   | 押せない（送信中。今のまま）                                                                                            | 押せない（同じ理由を確認に出す）                               |
| 帯の `中断`                                             | 押せない（送信中。今のまま）                                                                                            | 何もしない（段階 2a の同期の再入の防止と待ち）                 |
| ターミナルのキー入力                                    | 溜めて、手順の後に送る。貼り付けの後の失敗（`not-echoed`・`shell-mode-after-paste`・`not-confirmed`）では送らずに捨てる | 許す（段階 2a のまま）                                         |
| `終了`・タブの `×`・フォルダや実行方式や CLI の切り替え | 今のまま（止めたセッションには届かない）                                                                                | 今のまま                                                       |
| タブの選択                                              | 送り先は押した時点のタブのまま                                                                                          | 送信の判定は選択中のタブで見る                                 |

- 段階 2a の `checkAgentInterruptFollowUp` は送信中を見直さない。送信中は 1 回目を押せず、中断の流れの間は送信を始めないので、2 回目を待つ間に送信が始まることはない。`agentInterrupt.ts` の「送信は copilot では使えず」のコメントを、この排他の説明に直す

## エラー処理

| 場面                                                       | 扱い                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 本文が断られる（空・長すぎる・先頭）                       | 何も書かない。送信前の確認では開いた時点に `送信` が押せず理由が出る。確認がオフならプロンプトパネルの上部に出る（今の置き場）                                                                                                                         |
| 作業中・許可待ち・確認待ち・判定できない                   | 押せない（理由を出す）。押した時点で変わっていれば、何も書かずに同じ文言で失敗を出す                                                                                                                                                                   |
| 中断の流れの間                                             | 押せない。押した時点に始まっていれば、準備も書き込みもせずに断る                                                                                                                                                                                       |
| 書きかけ・シェルのモード                                   | 何も書かずに断る。書きかけは消さない                                                                                                                                                                                                                   |
| 一時的な帯が 2,500ms 続いた（`?` のヘルプなど）            | 何も書かずに `input-undetermined`                                                                                                                                                                                                                      |
| echo を確かめられない（確認の画面が出た・表示が違う）      | `Enter` を送らずに `not-echoed`。本文が入力欄に残りうることを文言で伝える。送信中に溜めたキー入力は送らずに捨てる（下の注）                                                                                                                            |
| echo を待つ間に入力欄がシェルのモードに変わった            | 上限を待たず、`Enter` を送らずに `shell-mode-after-paste`。本文を送るとシェルで実行されるので、送らずに消してからシェルのモードを抜けるよう文言で伝える（`not-echoed` の「送るか消して」は出さない）。送信中に溜めたキー入力は送らずに捨てる（下の注） |
| `Enter` の後に確かめられない（補完に取られた・表示が違う） | `Enter` を送り直さずに `not-confirmed`。通知・`onSent`（参照を外す）・タブへの移動はしない。送信中に溜めたキー入力は送らずに捨てる（下の注）                                                                                                           |
| pty への書き込み・貼り付けより前の画面の読み取りが例外     | 今のまま（`useAgentPromptSender` が `エージェントへ送信できませんでした: <message>` を出す。何も書いていない）                                                                                                                                         |
| 貼り付けの後、echo を待つ間の画面の読み取りが例外          | `Enter` を送らず `not-echoed`（手順 5。本文が入力欄に残りうるので、例外の文言ではなくこの文言で案内する。例外は `console.error` に残す）                                                                                                               |
| Enter の後の画面の読み取りが例外                           | Enter を送り直さず `not-confirmed`（手順 7。例外は `console.error` に残す）                                                                                                                                                                            |

- 注（PR #65 のレビュー第 3 周で足した）: 送信の手順の間に利用者がターミナルで打ったキー入力は溜めて、手順の後に送る。それまでは結果を問わず送っていたので、貼り付けの後の失敗の後に溜めた `Enter` が届くと、入力欄に残った本文が送られる・シェルのモードで実行される・補完の候補が確定することがあった。`copilot` の `not-echoed`・`shell-mode-after-paste`・`not-confirmed`（貼り付けの後の読み取りの例外を倒したものを含む）では、溜めた入力を送らずに捨て（フォーカスの通知 `ESC [I`・`ESC [O` は送る。SGR のマウスの報告は送らず、数えない）、捨てた入力があったときだけ失敗の文言に `。送信の間にターミナルで打ったキー入力は、送らずに捨てました` を添える。貼り付けの前の失敗は何も書いていないので今のまま送る（打ったキーが遅れて届くだけ）。`claude` は今のまま送る（ROADMAP の既知の制約）

## 実装の最初に確かめること（copilot の入力欄の台帳）

段階 2b の追加の記録（`.superpowers/agent-cli-kind/copilot-input-recorder/out/*/snaps.json`・`watch.jsonl`。git 管理外）から、テストの入力にする台帳を作る。新しく `copilot` を起動して記録はしない。

1. **変換のスクリプト**（`.superpowers/agent-cli-kind/copilot-input-recorder/to-fixture.js`。git 管理外）: 段階 2a の `to-fixture.js` と同じ形（`screens.<名前>.lines` は 行番号 → `[文字列, dim の範囲, 反転の範囲]`。文字列は `attrs[].text` を明示的に `trimEnd` したもの）で、下の表の画面を書き出す。
   列・行の数はフォルダの名前（`tall-60x12` は 60×12、`big-run*`・`prefix-*` のように大きさの無いフォルダは 100×30 と `text` の行の数で確かめる）から決める。全角の文字を含む画面（`ja6800`）は、全角の文字の右半分のセルを除いて連結する（`agentScreens.json` と同じ。`ja6800` の入力欄の行は 49 文字）。段階 2a の変換は全角の文字があると止めたが、段階 2b では止めず、全角の文字の行に dim・反転の範囲があるときだけ止める（範囲はセルの位置で文字の位置とずれる。記録には無い）。大きさの決め方は上のとおり（`big-run3` のように大きさの無いフォルダは 100 列で、記録の行の数が 30 であることを確かめる）。
   あわせて `watch.jsonl` の下の表の列を `sequences.<名前>.frames`（`[{ dt, lines }]`。`lines` は `tail` を行に分けて `trimEnd` した文字列の配列。属性は持たない。`copilot` の規則は属性を使わないため）として書き出す。`_note` に `GitHub Copilot CLI 1.0.87・node-pty 1.1.0・@xterm/headless 6.0.0 で記録した（段階 2b の追加の記録）` と形式の説明を書く
2. **個人情報の置き換え**: 段階 2a の `sanitize-copilot.py`（規則 1・1'・2・3）を同じ順でかける（作業ディレクトリの行 `/private/tmp/claude-<UID>/-Users-…/work`・`/private/tmp/claude-<UID>/.../work`）。置き換えた後に `copilotInputScreensFixture.test.ts`（新規）の個人情報のテスト（ユーザー名・`/Users/`・`/private/tmp/claude-`・0 以外の 16 進を含む UUID が無い）が通ることを確かめてから、SHA-256 を固定する（置き換えた後の `copilotInputScreens.json` は `b2015f3d08d739570b384bccd5291e79f2aad6a1a47fde81b890300bc71cac6e`。置き換えで変わった行は 145 行。置き換えの前は `f6f1fdd8f865c8365eb5a4129f4746f937ee73bb50ee90321230bdab88bb0099`）
3. **置き場**: `src/renderer/src/lib/__tests__/fixtures/copilotInputScreens.json`（`.prettierignore` に足す）・`copilotInputScreens.ts`（`agentScreens.ts` の `toRecordedScreen` で行の配列にする。`sequences` は文字列の行から `ViewportLine[]` を作る補助を置く）。`fixtures/README.md` に `copilotInputScreens.json` の節（版・元の記録・画面と列の数・SHA-256・変わった行の数・版を上げたら記録し直すこと）を足す
4. **画面と期待**（`copilotInputBox.test.ts` の `EXPECTED`。全画面が活動と入力欄の両方の期待を持っていないと落ちるテストを置く。活動の期待は `classifyCopilotScreen` で確かめる）

| 名前                 | 元の記録（`out/<フォルダ>` の `label`）     | 活動      | 入力欄         |
| -------------------- | ------------------------------------------- | --------- | -------------- |
| `empty`              | `draft-100x30` の `empty`                   | `idle`    | `empty`        |
| `spacesTyped`        | `draft-100x30` の `spaces-typed`            | `idle`    | `draft`        |
| `spacesPasted`       | `draft-100x30` の `spaces-pasted`           | `idle`    | `draft`        |
| `spacesEsc1`         | `draft-100x30` の `spaces-esc1`             | `idle`    | `undetermined` |
| `newlinesPasted`     | `draft-100x30` の `newlines-pasted`         | `idle`    | `draft`        |
| `multiPasted`        | `draft-100x30` の `multi-pasted`            | `idle`    | `draft`        |
| `shellEmpty`         | `draft-100x30` の `shell-empty`             | `idle`    | `shell`        |
| `shellDraft`         | `draft-100x30` の `shell-draft`             | `idle`    | `shell`        |
| `shellSpaces`        | `draft-100x30` の `shell-spaces`            | `unknown` | `not-found`    |
| `afterTurnEmpty`     | `draft-100x30` の `after-turn-empty`        | `idle`    | `empty`        |
| `afterTurn1char`     | `draft-100x30` の `after-turn-1char`        | `idle`    | `draft`        |
| `fold10`             | `fold-100x30` の `fold10`                   | `idle`    | `draft`        |
| `fold11`             | `fold-100x30` の `fold11`                   | `idle`    | `draft`        |
| `long5000`           | `fold-100x30` の `long5000`                 | `idle`    | `draft`        |
| `send11`             | `fold-100x30` の `send11`                   | `idle`    | `empty`        |
| `inline20480`        | `big-run3` の `size20480`                   | `idle`    | `draft`        |
| `saved20481`         | `big-run3` の `size20481`                   | `idle`    | `draft`        |
| `ja6800`             | `misc-100x30` の `ja6800`                   | `idle`    | `draft`        |
| `huge`               | `misc-100x30` の `huge`                     | `idle`    | `draft`        |
| `tallIdle`           | `tall-60x12` の `idle-small`                | `idle`    | `empty`        |
| `tallPaste9`         | `tall-60x12` の `paste-9-lines`             | `idle`    | `draft`        |
| `tallPaste30`        | `tall-60x12` の `paste-30-lines`            | `idle`    | `draft`        |
| `tallPaste5000`      | `tall-60x12` の `paste-5000`                | `idle`    | `draft`        |
| `tallSent`           | `tall-60x12` の `typed-700-sent`            | `idle`    | `empty`        |
| `atPaste`            | `suffix-100x30` の `at-paste+600`           | `idle`    | `draft`        |
| `atEnter`            | `suffix-100x30` の `at-enter+3000`          | `idle`    | `draft`        |
| `ctrlcBandPaste`     | `transient-100x30` の `ctrlc-band-paste`    | `idle`    | `draft`        |
| `helpOpen`           | `transient-100x30` の `help-open`           | `idle`    | `undetermined` |
| `workingInterrupted` | `transient-100x30` の `working-interrupted` | `idle`    | `empty`        |
| `aeInstantEnd`       | `afterenter-100x30` の `ae-instant-end`     | `idle`    | `empty`        |
| `atref1Paste`        | `atref1-100x30` の `paste+800`              | `idle`    | `draft`        |
| `atref1Enter1`       | `atref1-100x30` の `enter1+2500`            | `idle`    | `draft`        |
| `atref1hPaste`       | `atref1h-100x30` の `paste+800`             | `idle`    | `draft`        |
| `atref1hEnter1`      | `atref1h-100x30` の `enter1+2500`           | `idle`    | `draft`        |
| `atref2Paste`        | `atref2-100x30` の `paste+800`              | `idle`    | `draft`        |
| `atref2Enter1`       | `atref2-100x30` の `enter1+2500`            | `idle`    | `empty`        |
| `atref3Paste`        | `atref3-100x30` の `paste+800`              | `idle`    | `draft`        |
| `atref4Paste`        | `atref4-100x30` の `paste+800`              | `idle`    | `draft`        |
| `atref4Enter1`       | `atref4-100x30` の `enter1+2500`            | `idle`    | `empty`        |
| `atref5Paste`        | `atref5-100x30` の `paste+800`              | `idle`    | `draft`        |
| `atref5Enter1`       | `atref5-100x30` の `enter1+2500`            | `idle`    | `draft`        |
| `atref6Esc`          | `atref6-100x30` の `esc+1200`               | `idle`    | `draft`        |
| `atref7SameWriteCr`  | `atref7-100x30` の `pbcr+2500`              | `idle`    | `empty`        |
| `atref8Paste`        | `atref8-100x30` の `paste+800`              | `idle`    | `draft`        |
| `atref8Enter1`       | `atref8-100x30` の `enter1+2500`            | `idle`    | `empty`        |

画面は 45（追加の記録の 1〜7 から 30、8 の末尾の参照〈`atref1`〜`atref8`。`atref1h` を含む〉から 15）。`shellSpaces`（シェルのモードで空白だけを入力した画面）は、末尾の空白を除くと記号の行が `!` だけになり `SYMBOL_LINE`（`! ` を要する）に当たらないので、段階 2a の判定のまま活動は `unknown`、入力欄は `not-found` になる。送らない側なのでこのまま固定する（「既知の制約」）。`atref*` の画面は、補完の候補の一覧が上の罫線より上に開いた形（`atref1Paste`・`atref1hPaste`・`atref3Paste`・`atref5Paste`・`atref6Esc`）も入力欄の外の選択の案内が無いので活動は `idle` になることと、`Enter` が補完の確定に取られた後の入力欄（`atref1Enter1`・`atref1hEnter1`・`atref5Enter1`）が空に戻らないこと（送れたことの確かめが偽）を固定する

| 列の名前        | 元の記録（`watch.jsonl` の `label`）    | 期待                                                                                                                                                                                        |
| --------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aeInstant`     | `afterenter-100x30` の `ae-instant`     | 最初の列（`Enter` から 52ms。本文が残る）は送れたことの確かめが偽、100ms までのどれかの列で真                                                                                               |
| `aeFirst300`    | `afterenter-100x30` の `ae-first300`    | 同じく、最初の列は偽、100ms までのどれかの列で真（帯が作業中）                                                                                                                              |
| `aeFirst2000`   | `afterenter-100x30` の `ae-first2000`   | 同じ                                                                                                                                                                                        |
| `aeStream`      | `afterenter-100x30` の `ae-stream`      | 最初の列（11ms）から真（入力欄は空、帯は作業中。記録の 4 の「すぐ流す」）。この列だけでは「最初の列は偽」を確かめられないので、偽の側は `aeInstant`・`aeFirst300`・`aeFirst2000` で確かめる |
| `escRewindBand` | `transient-100x30` の `esc-rewind-band` | 帯が `esc again to rewind` の列は `undetermined`、帯が戻った列（約 570ms）は `empty`。保留の上限 2,500ms より前に `empty` になる                                                            |
| `ctrlcBand`     | `transient-100x30` の `ctrlc-band`      | 帯が `ctrl+c again to exit` の列は `undetermined`、戻った列（約 2,020ms）は `empty`。保留の上限 2,500ms より前に `empty` になる                                                             |

echo の正の例（`isCopilotPasteEchoed` が真）は、記録のスクリプト（`scenarios2.js`）で貼った本文と組にする: `multiPasted`（`first line` / `second line` / `third line`）・`fold10`（`L10-1`〜`L10-10`）・`fold11`（11 行）・`long5000`（`'x'.repeat(4990) + 'ENDMARK'`）・`inline20480`・`saved20481`・`ja6800`（`'漢'.repeat(6796) + 'JEND'`）・`huge`・`tallPaste9`（`N1`〜`N9`。先頭の行が見えない）・`tallPaste30`・`tallPaste5000`（`'w'.repeat(4995) + 'WEND'`）。末尾の参照（`scenarios2.js` の `atref*`）: `atref1Paste`（`本文\n\n- @file.txt`）・`atref1hPaste`（`本文\n\n参照:\n- @file.txt`。アプリの形）・`atref2Paste`（`本文\n\n- @file.txt `。足した空白を含む本文でも、含まない本文でも真）・`atref3Paste`（`本文\n\n- @file.txt\n`）・`atref4Paste`（`本文\n\n- @nofile.txt`）・`atref5Paste`（`本文\n\n- @file.txt\n- @file2.txt`）・`atref8Paste`（`本文\n\n- @file.txt\n- @file2.txt ` と、その空白を除いた本文）。
負の例: `empty`・`afterTurnEmpty` に同じ本文（入力欄が空）、`shellDraft`（記号が `!`）、`multiPasted` に別の本文。実際に貼った本文は実装の最初に `scenarios2.js` と `log.txt` で確かめ、テストに写す。

記録の画面で期待と違う判定になったら、規則を直す（記録が正）。直しても記録と矛盾する場合は、その場面の扱いを設計書の「既知の制約」に書き、実装のプランの差異として残す。

## 構成

| ファイル                                                                                                                                     | 変更                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/agentCliKinds.ts`                                                                                                                | `copilot` の `promptSend` を `true`。`promptSend` の説明に「押せる条件と手順は renderer の `agentPromptSendSpecs.ts`」を足す                                                                                                                                                                                                                                                          |
| `src/shared/agentPasteText.ts`                                                                                                               | `AgentPromptRejection` の種類・`AGENT_PROMPT_TEXT_RULES`・`normalizeAgentPrompt(raw, kind)`。冒頭のコメントの「claude の入力欄」を「エージェント CLI の入力欄」に直す                                                                                                                                                                                                                 |
| `src/renderer/src/lib/agentPromptSend.ts`                                                                                                    | 共有の型だけにする（`AgentSendFailure` の種類を足す・`AgentSendTarget.readScreen`・`AgentSendClock`・`realClock`・`AgentSendOutcome`・`AgentPromptSendResult`。`AgentPromptSendResult` の `sent` に `cliKind: AgentCliKind` を足す）                                                                                                                                                  |
| `src/renderer/src/lib/claudePromptSend.ts`（新規。移動）                                                                                     | `sendClaudePrompt`（今の `sendAgentPrompt` と `clearInput`・定数を中身を変えずに移して改名。正規化に `'claude'` を渡す）                                                                                                                                                                                                                                                              |
| `src/renderer/src/lib/copilotInputBox.ts`（新規）                                                                                            | `locateCopilotInputBox`（`copilotScreenActivity.ts` から移動し、記号と行を足す）・`copilotScreenTexts`・`readCopilotInputState`・`isCopilotPasteEchoed`                                                                                                                                                                                                                               |
| `src/renderer/src/lib/copilotScreenActivity.ts`                                                                                              | 入力欄の特定を `copilotInputBox.ts` から import する（判定の結果は変えない）。送れたことの確かめ `isCopilotSubmitConfirmed` を足す                                                                                                                                                                                                                                                    |
| `src/renderer/src/lib/copilotPromptSend.ts`（新規）                                                                                          | `sendCopilotPrompt`・`buildCopilotPasteText`・1 回の読み取りの判定（`checkCopilotInputBeforePaste`・`checkCopilotPasteEcho`）と待ちの定数                                                                                                                                                                                                                                             |
| `src/renderer/src/lib/agentPromptSendSpecs.ts`（新規）                                                                                       | `AGENT_PROMPT_SEND_SPECS`                                                                                                                                                                                                                                                                                                                                                             |
| `src/renderer/src/lib/agentSendMessages.ts`                                                                                                  | 失敗の文言の共通の表と種類の表・`agentSendFailureMessage(reason, kind)`・`agentSendBlockedByActivityReason`・`RUN_DISABLED_INTERRUPTING`                                                                                                                                                                                                                                              |
| `src/renderer/src/lib/promptRunAvailability.ts`（新規。SRP リファクタリングで `agentSendMessages.ts` から移動）                              | `getPromptRunAvailability` と `getHistoryRerunAvailability` の `activity`・`isInterrupting`（押せる条件の判定を文言のファイルから分け、文言のファイルが送信の手順の表に依存しないようにした）                                                                                                                                                                                         |
| `src/renderer/src/lib/agentSendPreview.ts`                                                                                                   | `buildAgentSendPreview(raw, cliKind)`                                                                                                                                                                                                                                                                                                                                                 |
| `src/renderer/src/lib/agentReferenceMessages.ts`                                                                                             | `formatAgentUnsavedNotice(paths, commandName)`                                                                                                                                                                                                                                                                                                                                        |
| `src/renderer/src/lib/promptRunState.ts`                                                                                                     | 入力に `activity`・`isInterrupting` を足して `getPromptRunAvailability` に渡す                                                                                                                                                                                                                                                                                                        |
| `src/renderer/src/lib/agentInterrupt.ts`                                                                                                     | `checkAgentInterruptFollowUp` のコメント（送信との排他）                                                                                                                                                                                                                                                                                                                              |
| `src/renderer/src/hooks/useAgentPromptSender.ts`                                                                                             | 表の手順を呼ぶ・`interrupting` の守り・`isInterrupting` の引数・`readScreen`・失敗の文言を種類で引く・送れたときの結果に `target.cliKind` を載せる（`{ ...outcome, sentTo, cliKind: target.cliKind }`）                                                                                                                                                                               |
| `src/renderer/src/hooks/useAgentInterrupt.ts`                                                                                                | 戻り値に `isInterrupting(slotId)`（ref。押した時点用。`isInFlight(slotId) \|\| isCoolingDown(slotId)`。SRP リファクタリングで `useAgentInterruptCooldown` の `isPendingNow` へ移し、それを返す）と `isInterruptPending(slotId)`（state。描画用）を足す（`AgentInterruptPanelState` には入れず、hook の戻り値の型を `AgentInterruptPanelState` を広げた `AgentInterruptState` にする） |
| `src/renderer/src/hooks/useAgentWorkspace.ts`                                                                                                | 実行・再実行・送信前の確認の押せる条件に活動と中断の流れを渡す・sender に `isInterrupting` を渡す・パネルには中断の UI の値だけを渡す                                                                                                                                                                                                                                                 |
| `src/renderer/src/components/agent/AgentSendConfirmDialog.tsx`                                                                               | プレビューと未保存の注意を送り先の種類で作る                                                                                                                                                                                                                                                                                                                                          |
| `src/renderer/src/hooks/usePromptRunner.ts`・`src/renderer/src/lib/agentSendCallbacks.ts`・`src/renderer/src/lib/agentPromptRequest.ts`      | 送れたときの結果に `cliKind` を載せ、`onSent(sentTo, cliKind)`（型は `agentPromptRequest.ts` の `AgentSentHandler`）で渡す。`recordAgentSent` は送り先が `null` のとき、種類の `sessionResume` が `false` なら黙って記録を省き、`true` なら今の `console.error` を出す                                                                                                                |
| `src/renderer/src/lib/__tests__/fixtures/copilotInputScreens.json`（新規）・`copilotInputScreens.ts`（新規）・`README.md`・`.prettierignore` | `copilot` の入力欄の台帳                                                                                                                                                                                                                                                                                                                                                              |
| `docs/manual-test-spec.md`・`ROADMAP.md`                                                                                                     | 「実機テスト仕様書の新しい項目の下書き」・「ROADMAP の更新の方針」                                                                                                                                                                                                                                                                                                                    |
| テスト                                                                                                                                       | 「テスト方針」の各ファイル。`agentPromptSend.test.ts` は `claudePromptSend.test.ts` に名前を変える（中身は関数の名前だけを直す）                                                                                                                                                                                                                                                      |

main・preload・IPC は変えない。

## テスト方針

vitest。renderer は `@testing-library/react` と `window.api` の偽物と偽の controller（`makeFakeController`。`screen` に台帳の画面を入れ、書き込みを記録する）。実物の `copilot` はテストで起動しない。

- shared
  - `agentPasteText.test.ts`: `claude` の今のテストを `normalizeAgentPrompt(raw, 'claude')` で通す（結果は今と同じ）。`copilot` は `!ls`・`/help`・`  !ls`・`  /help`・`\x1b!ls`（除去の後に先頭へ来る）を断り、`x!ls`・`run /help`・`?why`・`# heading`・`fix #12`・`say hi!`・`look at @file`・`@`・`本文\n\n参照:\n- @src/app.ts` は通す（末尾の `@` の語を断らない）。判定の順（空 → 長すぎる → 種類の規則）
  - `agentCliKinds.test.ts`: `copilot` の能力が `promptSend`・`screenActivity`・`interrupt` だけ真
- renderer の入力欄
  - `copilotInputScreensFixture.test.ts`（新規）: 台帳の SHA-256 と個人情報のテスト
  - `copilotInputBox.test.ts`（新規）: 台帳の全画面の活動と入力欄の `EXPECTED`、列の期待（`aeInstant` など・`escRewindBand`・`ctrlcBand`）、echo の正の例と負の例（「実装の最初に確かめること」）。記録に無い形だけを手書きの画面（`makeLine`）で確かめる（記録にある形〈末尾の参照・補完の一覧・畳み・空白だけの書きかけなど〉は台帳の画面を使い、手書きで作り直さない）
    - 各行を列の数まで空白で埋めた `empty`・`fold10` → 同じ結果（アプリの `lineText` の行と同じ形）
    - `--screen-reader` の形（`Start of Prompt Indicator` と帯が空の形）→ `empty`、`Start of Prompt Indicatorhello` → `draft`、その画面で本文 `hello` の echo → 真
    - 帯が空の形なのに入力欄が 2 行で文字が無い → `undetermined`
    - 帯が空（描き直しの途中）→ `undetermined`
    - 入力欄の上の会話に本文と同じ文字がある・入力欄が空 → echo は偽（入力欄の中だけで見る）
    - 段階 2a の台帳にも新しい台帳にも無い形として: 記号の行の末尾に空白が残る入力欄（`❯    `。段階 0 の記録で `Esc` 2 回の後に見えた残骸）→ `empty`
    - 段階 2a の台帳の `idle`・`idle80`・`idle40`（40 列の段組みで折り返した帯）→ `empty`。`idle40` の帯をつないだ文字列が `EMPTY_BAND` に当たり、1 行目だけ（`bandHead`）では `sidebar` が無いことも確かめる
    - 段階 2a の台帳の `draftEsc`（`esc again to clear input`）・`rewindHint`（`esc again to rewind`）・`help`・`slashList`（`/add-dir`）・`shellMode` も入力欄の読み取りにかけ、期待（書きかけが見えれば `draft`、見えなければ `undetermined`、`/` の一覧は `draft`、シェルのモードは `shell`）を固定する
  - `copilotScreenActivity.test.ts`: 今のテストのまま通る（入力欄の特定の移動で判定が変わらない）
- renderer の手順
  - `copilotPromptSend.test.ts`（新規。偽の時計・画面を時刻で切り替える偽の送り先。書いた列を記録）:
    - 空の画面 → 貼り付け → echo の画面 → `\r` → 空の画面で `sent`。書いた列が `[buildAgentPasteBytes(text), '\r']` と完全に一致する（`Esc`・`Ctrl+U`・`Ctrl+K` を書かない）
    - `Enter` の後に帯が作業中の画面（段階 2a の台帳の `beforeFirstToken`）で `sent`
    - 書きかけ（`afterTurn1char`・`spacesPasted`）・シェルのモード（`shellEmpty`）・作業中（`working3000`）・許可待ち（`permission`）・確認待ち（`trust`）・判定できない（帯が空の手書き）→ それぞれの失敗で、書いた列が空。入力欄が無い画面（描き直しの途中の手書き）は `screen-unknown`（`input-not-found` ではない）で、書いた列が空
    - 一時的な帯（`spacesEsc1` の形で入力欄が空のもの・`escRewindBand` の列）が続いた後に空になる → 送る。上限の直前の読み取り（2,450ms）で空になれば、続く 2,500ms の読み取りで 2 回目の空を確かめて送る。上限の時点（2,500ms）の読み取りでも決められなければ `input-undetermined` で、書いた列が空。空が 1 回だけで次が `undetermined` なら数え直す
    - 保留の間に作業中の画面に変わる → `screen-working` で書いた列が空
    - echo が上限 1,500ms まで現れない → `not-echoed`、書いた列は貼り付けだけ（`\r` が無い）。1,500ms ちょうどに現れれば送る（echo の読み取りは貼り付けから 16ms ごと〈…・1,488・1,504ms〉で 1,500ms ちょうどの読み取りは無いので、1,500ms の時点で現れていれば、上限を過ぎた最初の読み取り〈1,504ms〉で確かめて送る。読み取りごとに echo を先に見て、上限は後に見る）
    - echo の画面で記号が `!` → 上限を待たずに `shell-mode-after-paste`（`not-echoed` ではない）。書いた列は貼り付けだけ（`\r` が無い）
    - `Enter` の後に入力欄が書き換わったまま（`atEnter`・`atref1hEnter1`）→ 2,000ms で `not-confirmed`、書いた列は `[貼り付け, '\r']` のまま（`\r` を送り直さない）。2,000ms ちょうどに空になれば `sent`
    - 断る本文（`/help`・`!ls`）→ 画面を読まず、何も書かない
    - 末尾の `@` の語（`look at @file`・`本文\n\n参照:\n- @src/app.ts`・`look at @file\n`・`look at @file  `）→ 貼り付けの書き込みが `buildAgentPasteBytes(text.trimEnd() + ' ')` になる。台帳の列で、`atref2Paste`（echo）→ `atref2Enter1`（空）なら `\r` を 1 回送って `sent`、`atref8Paste` → `atref8Enter1` も `sent`。空白を足さずに貼った形の列 `atref1Paste` → `atref1Enter1`（`Enter` が補完に取られた）は 2,000ms で `not-confirmed` で、`\r` を送り直さない。末尾の語が `@` で始まらない本文（`mail a@b.com`・`@file then explain`・`fix #12`）は空白を足さない
    - `buildCopilotPasteText` の単体: 上の各例と、本文の途中だけに `@` の語がある・末尾が `@` だけ・参照が 2 つ（`- @a.ts\n- @b.ts`）
    - bracketed paste が無効 → `not-accepting`、何も書かない
  - `claudePromptSend.test.ts`（`agentPromptSend.test.ts` から改名）: 今のテストのまま
  - `agentPromptSendSpecs.test.ts`（新規）: `claude` は `requiresIdle: false`・`sendClaudePrompt`、`copilot` は `requiresIdle: true`・`sendCopilotPrompt`
- renderer の押せる条件・文言
  - `promptRunAvailability.test.ts`（SRP リファクタリングで `agentSendMessages.test.ts` から分けた）: `claude` は活動（`working`・`permission`・`unknown`）と中断の流れに関わらず今と同じ結果、`copilot` は活動ごとの理由・中断の流れの理由・表の順（閉じる途中・動いていない・送信中が先）・`idle` で押せる。`getHistoryRerunAvailability` も同じ（記録したフォルダの理由が先）。
  - `agentSendMessages.test.ts`: 失敗の文言の表の全部（`claude` の文言が今と同じこと、`copilot` の `leading-bang`・`not-echoed`）、`screen-*` の失敗と押せない理由が同じ文
  - `agentSendPreview.test.ts`: `copilot` の `/help`・`  /help`・`!ls` で理由が出る。`look at @file`・`本文\n\n参照:\n- @src/app.ts` は理由が出ない（送れる）。`claude` は今のまま
  - `agentReferenceMessages.test.ts`: 未保存の注意の CLI の名前
  - `promptRunState.test.ts`: 活動と中断の流れが `getPromptRunAvailability` に渡る
  - `usePromptRunner.test.ts`・`agentSendCallbacks.test.ts`: `copilot` の送り先で送れたとき（`sentTo` が `null`）は履歴に記録せず `console.error` も出さない、`claude` で `sentTo` が `null` のときは今までどおり `console.error` を出す、`onSent` に `cliKind` が渡る
- renderer の hook・配線
  - `useAgentPromptSender.test.ts`: `copilot` の送り先は表の `copilot` の手順を通る（偽の画面で `sent`）・中断の流れの間は `interrupting` で、`beforeSend`・`describeSession`・`beginSending`・書き込みのどれも呼ばない・`copilot` の失敗の文言・送れたときの結果の `cliKind` が送り先の種類になる（`claude`・`copilot` とも）・`claude` は今のまま
  - `useAgentInterrupt.test.ts`: `isInterruptPending` が送っている途中と 1,000ms の待ちの間だけ真（2 回目の流れの数え直しを含む）、`isInterrupting` が同じ間だけ真で参照が安定。1 回目の結果が 1,000ms を超えて届かない間・2 回目の流れが 1,000ms を超えて続く間も `isInterrupting` が真（`isInFlight` を合わせていることの確かめ）
  - `AgentSendConfirmDialog.test.tsx`: 送り先が `copilot` のとき `/help` で `送信` が押せず `copilot` の理由が出る、未保存の注意が `copilot` の名前
  - **配線**（L-060）: `useAgentWorkspace.test.ts` で、起動の結果が `copilot` のタブに、偽の controller の画面を台帳の `empty` にして入力待ちにし、
    実物の組み立て役から `実行`（送信前の確認がオフ）→ 書いた列が貼り付けと `\r` になり、画面を `aeInstantEnd` にすると `エージェントに送信しました` が出る。画面を作業中にすると `実行` の理由が `copilot が作業中のため送信できません（…）`、確認を開いた後に作業中にすると確認の理由も同じになる。
    `中断` を押した直後は `実行` の理由が `RUN_DISABLED_INTERRUPTING` になる。`claude` のタブは作業中でも `実行` を押せる（今のまま）。
    `useAgentWorkspace` の活動・中断の流れ・`isInterrupting` の受け渡しを 1 つずつ外す変異で、どれかのテストが落ちることを確かめる
- 統合テスト（`src/renderer/src/lib/__tests__/copilotPromptSend.integration.test.ts`。実物の node-pty と `@xterm/headless`。Windows では飛ばす。L-059）: 一時ディレクトリに置いた小さな node のスクリプト（偽の CLI。代替画面で `copilot` と同じ形の入力欄と帯を描き、bracketed paste を受けると約 250ms 後に本文を入力欄に描き、`\r` を受けると入力欄を空に戻して受け取った本文を一時ファイルに書く）を実物の node-pty で起動し、
  `@xterm/headless` の画面から作った送り先で `sendCopilotPrompt` を本物の時計で呼ぶ。`sent` になり、偽の CLI が受け取った本文が送った本文と一致し、`\r` が貼り付けの終わりの印より後の別の読み取りで届いたことを確かめる。偽の CLI が `\r` を無視する形では `not-confirmed` になり、`\r` が 1 回だけ届いたことを確かめる。実物の `copilot` の挙動の確かめではない（画面の読み取り・書き込みの経路と待ちの確かめ）
- 能力の表を差し替えるテストの補助: `src/renderer/src/__tests__/agentCliCapabilityOverrides.ts` に、プロンプトの送信を偽にする種類 `promptSendUnsupportedKinds` を足す（今の表には送信に対応しない種類が無くなるため。`agentPromptSendUnsupportedReason` はこの補助で確かめる）
- 実機: 「実機テスト仕様書の新しい項目の下書き」

## 既知の制約（ROADMAP・実機テスト仕様書に反映する）

- `copilot` への送信の規則は GitHub Copilot CLI 1.0.87 の画面と挙動（段階 0・段階 2b の追加の記録）に合わせている。版で帯の文言・畳みの形・先頭や末尾の文字の扱いが変わると外れうる。外れたときは、送らない（`input-undetermined`・`not-echoed`・`shell-mode-after-paste`）か送れたことを確かめられない（`not-confirmed`）側に倒し、`Enter` を重ねて送る側には倒れない。アプリは `copilot` の版を確かめない
- `copilot` は入力待ちのときだけ送れる（作業中・許可待ち・確認待ちの間は `実行` を押せない）。`claude` のように作業中に送って送信待ちにすることはできない（ターミナルで直接入力すれば送信待ちにできる）
- `copilot` の入力欄に書きかけ（空白だけ・改行だけを含む）があると送らない。ターミナルで送るか消してから実行し直す。`claude` は書きかけを消してから送るので、挙動が違う
- 先頭（空白を除く）が `!`・`/` のプロンプトは送らない。`claude` と違い、先頭に空白を入れても送れない（先頭に別の文字を足すと送れる）
- 末尾の空白を除いた最後の語が `@` で始まる本文（アプリの参照の添付〈`本文\n\n参照:\n- @パス`〉を含む）は、補完の一覧を開かせないよう末尾に空白を 1 つ足して貼る（report.md の 8 の場面 2・補足 8。`copilot` が末尾の空白を落とすので届く本文は変わらず、存在する `@パス` には `<tagged_files>` が付く）。版で末尾の空白の扱いが変わり一覧が開くと、`Enter` が候補の確定に取られて `not-confirmed` になり、入力欄の `@` の語が別の名前に書き換わっていることがある。存在しないパスの `@` は `<tagged_files>` が付かない（`copilot` の挙動）
- 末尾が `#` の語（`fix #12`）は、オフラインの記録では送れた。GitHub に接続した `copilot` で issue の補完が開くと `Enter` が取られ、`not-confirmed` になりうる（記録できていない）
- 送れたことを確かめられなかった（`not-confirmed`）とき、実際には送れていることがある（`Enter` の直後に入力欄が消える確認の画面が出た、など）。アプリは `Enter` を送り直さないので、ターミナルの画面で確かめる。このとき添えた参照は外れない。`Enter` の後の画面の読み取りが失敗したときも同じ扱い（`not-confirmed`）
- 本文が入力欄に入ったかを確かめられなかった（`not-echoed`）とき、本文は入力欄に残りうる（文字の幅が違う絵文字・結合文字・タブの表示などで、入力欄の文字と本文を照らせないとき）。ターミナルで送るか消す
- 送信の手順の間（最大で約 4 秒）にターミナルで打ったキー入力は、`copilot` の貼り付けの後の失敗（`not-echoed`・`shell-mode-after-paste`・`not-confirmed`）では送らずに捨てる（失敗の文言に添えて伝える）。捨てた入力は戻せないので、必要ならターミナルで打ち直す。送れたとき・貼り付けの前の失敗では、遅れて届く
- 選択範囲の参照（行の範囲付き。`@src/app.ts#L10-20`）を添えた本文で、末尾に空白を足すと補完の一覧が開かないかは記録していない（記録はファイル全体の参照だけ）。一覧が開いて `Enter` が取られると `not-confirmed` になる
- `copilot` のシェルのモードで空白だけを入力している間は、記号の行が `!` だけになり入力欄として認められないので、`入力待ちか判定できない` の理由で送れない（段階 2a の判定のまま。`shell-mode` の文言にはならない）
- 入力欄が空か決められない一時的な帯（`esc again to rewind` など）の間は最大 2.5 秒待つ。`?` のヘルプを開いている間は送れない（キーを送って閉じることはしない）
- 11 行以上の本文は `copilot` が `[Paste #N - M lines]` に畳んで送り（届くのは全文）、UTF-8 で 20,480 バイトを超える本文は `copilot` が `copilot` のセッションのフォルダ（`~/.copilot` の下の `session-state`）にファイルとして保存し、モデルにはそのファイルの指定（`<pasted_content … />`）が届く。どちらも利用者がターミナルに貼り付けたときと同じ `copilot` の挙動
- `copilot` へ送ったプロンプトは実行履歴に残らない（送り先の会話の ID を持たないため。段階 3 で履歴への CLI の種類の記録とあわせて扱う）。履歴の `再実行` は、`claude` に送って記録したエントリを `copilot` のタブへ送れる
- 中断を押してから約 1 秒（2 回目の流れが終わってから 1,000ms の待ちが明けるまで）は、`copilot` のタブへ送れない
- `copilot` の `/vim` のモード・画面読み上げのモード（`--screen-reader` に当たる設定）での送信は記録していない。読み上げのモードの入力欄の形（`Start of Prompt Indicator`）は段階 0 の記録から読み取るが、送信の実物では確かめていない
- `copilot` ではプロンプトの送信は使えるが、利用者の変更との区別・前回の続きから・このセッションで再開は使えない（段階 3）

## 実機テスト仕様書の新しい項目の下書き

`docs/manual-test-spec.md` の「## エージェント CLI のアプリ内ターミナル」の `### copilot の画面の判定と中断` の後（`## エージェントの変更の確認` の前）に `### copilot へのプロンプトの送信` を足し、AGT-257 から振る（今の最大は AGT-256）。
下書きの文言は、実装の後にコードの文言と照らし合わせて確定してから追記する（L-354）。

手順はテスト用のフォルダで行い、`copilot` に頼む内容は返答だけで済むもの（ツールもファイルも使わない返答）にする。例外は許可待ちの確かめ（AGT-264）だけで、無害なシェルのコマンド（`sleep 15`）を頼み、出た許可の確認を `Esc` で取り消す（コマンドは実行させない）。許可の確認が出たら、ターミナルで `Esc` を押して取り消す（「今後は確かめない」選択肢は選ばない）。
フォルダの信頼の確認は、その回だけ信頼する選択肢（`1. Yes`）を選ぶ。保存される設定（使う CLI・送信前の確認・VoiceOver）と、この節で足したプロンプト・変えた本文は、確かめた後に元へ戻す手順を書く。書きかけは項目の終わりに消す（L-072）。

### 既存の項目の直し（ID は変えない）

`copilot` へ送れるようになるので、次の項目の期待結果と前提を直す。

- **AGT-230**: 選択肢の下の注記を `copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別、前回の続きから・このセッションで再開` にする
- **AGT-233**: 手順を「`copilot 1` が入力待ちのときに、「プロンプト」パネルで登録したプロンプトの `実行` にマウスを載せる（押さない）」、期待結果を「`実行` は押せる色で、押せない理由は出ない（送信の確かめは AGT-257 以降）。`copilot` の入力欄には何も入らない」にする
- **AGT-236**: 期待結果の後半「`再実行` は押せず、AGT-233 と同じ理由が出る」を「`再実行` は押せず、`エージェントが起動していません（ターミナルの「起動」を押してください）` が出る（AGT-235 で `copilot 1` を止めているため）」にする
- **AGT-240**: 「プロンプトの `実行` の押せない理由が `エージェントが起動していません（ターミナルの「起動」を押してください）` になる（copilot への送信の理由ではない）」の括弧書きを消す
- `### copilot の画面の判定と中断` の 3 つ目の前提の「（…プロンプトの `実行` は copilot では押せないため、ターミナルに直接入力する）」を「（…作業の長さを決めて送るため、ターミナルに直接入力する）」にする（ID の無い行）

### 新しい節

> 前提: エージェント CLI 方式で、テスト用のフォルダを開いている。GitHub Copilot CLI（`copilot`）がインストール済みで、端末で `copilot --version` が動く。設定の `使うエージェント CLI` で `GitHub Copilot CLI（copilot）` を選んでから始め（動いているタブがあれば確認で `OK`）、この節の最後の項目で `Claude Code（claude）` に戻す。途中で止めるときも `Claude Code（claude）` に戻す。
> 前提: フォルダの信頼の確認が出たら、その回だけ信頼する選択肢（`1. Yes`）を選び、`2. Yes, and remember this folder for future sessions` は選ばない（覚えさせてしまったら、AGT-228 の節の前提の手順で外す）。`copilot` のログインなど GitHub のアカウントに関わる操作は、利用者が自分のアカウントで行う。
> 前提: 「プロンプト」パネルに、タイトル `copilot 送信`・内容 `Without using any tools or files, reply with only the word OK.` のプロンプトを足しておく（この節の最後の項目で消す）。項目の途中で内容を変えたら、その項目の終わりに元の内容へ戻す。設定の `送信前の確認` はオン（既定）から始める。
> 前提: 長い作業は、ターミナルの `copilot` の入力欄に `Without using any tools or files, write the numbers from 1 to 2000 in your reply, one per line.` を入力して `Enter` で送って作る（AGT-243 の節と同じ）。

- [ ] **AGT-257** 先に実行履歴を開いてエントリの数を控えておく（AGT-259 で使う）。`起動` で `copilot 1` を起動し、帯が `入力待ち` になったら `copilot 送信` の `実行` を押す。開いた確認のダイアログを見てから `送信` を押す → ダイアログに `送り先: copilot 1` と本文が出る。`送信` を押すと、ターミナルの `copilot` の入力欄に本文が入ってすぐ送られ、プロンプトパネルに `エージェントに送信しました` が出る。`copilot` が `OK` と答え、帯が `作業中` から `入力待ち` に戻る（作業中が短くて見えなければ、そのことを記録する）。入力欄に本文は残らない
- [ ] **AGT-258** 設定の `送信前の確認` をオフにしてから、`copilot 送信` の `実行` を押す → ダイアログは開かずに送られ、`エージェントに送信しました` が出て、`copilot` が `OK` と答える。確かめた後、`送信前の確認` をオンに戻す
- [ ] **AGT-259** 実行履歴を開いて一覧を見る → AGT-257 の前に控えた数から、AGT-257・258 で `copilot` に送ったプロンプトのエントリは増えていない（既知の制約。`copilot` へ送ったプロンプトは履歴に残らない）
- [ ] **AGT-260** 長い作業を送り、帯が `作業中` の間に `copilot 送信` の `実行` にマウスを載せる。作業が終わって帯が `入力待ち` になったら、もう一度マウスを載せる → 作業中は `実行` が押せず、`copilot が作業中のため送信できません（作業が終わって入力待ちになってから、もう一度実行してください）` が出る。入力待ちになると押せる（理由は出ない）
- [ ] **AGT-261** ターミナルの `copilot` の入力欄に `draft` と入力し（`Enter` は押さない）、`copilot 送信` の `実行` → `送信` を押す → 何も送られず、プロンプトパネルに `copilot の入力欄に書きかけがあるため送信できません（書きかけは消していません。ターミナルで送るか消してから、もう一度実行してください）` が出る。ターミナルの入力欄の `draft` は残り、`copilot` の帯に `esc again to clear input` も出ない。確かめた後、ターミナルで `Ctrl+U` を押して書きかけを消す
- [ ] **AGT-262** `copilot 送信` の内容を `/help` に変えて保存し、`実行` を押し、ダイアログを見てから `キャンセル` で閉じる。続けて内容を `!pwd` に変えて保存し、同じように `実行` を押す → どちらも確認のダイアログの `送信` が押せず、それぞれ `先頭（空白を除く）が「/」のプロンプトは、copilot のスラッシュコマンドとして実行されるため送信できません（先頭に空白・「!」・「/」以外の文字を足すと送れます）`・`先頭（空白を除く）が「!」のプロンプトは、copilot のシェルのコマンドとして実行されるため送信できません（先頭に空白・「!」・「/」以外の文字を足すと送れます）` が出る。`キャンセル` で閉じると、ターミナルには何も入らない（`copilot` のヘルプもシェルの実行も出ない）。確かめた後、内容を元に戻して保存する
- [ ] **AGT-263** エディタでテスト用のフォルダのファイルを 1 つ開き、プロンプトパネルの参照の行でそのファイル（`@<パス>`）を押してオンにしてから、`copilot 送信` の `実行` を押し、確認のダイアログを見てから `送信` を押す → ダイアログの本文の末尾が空行・`参照:`・`- @<パス>` になり、`送信` は押せる。押すとターミナルの入力欄に本文が入り（補完の候補の一覧は開かない）、`Enter` 1 回で送られて `エージェントに送信しました` が出る。`copilot` の画面の発言の行の末尾が `- @<パス>` で、`copilot` が `OK` と答える。`copilot に送れたか確かめられませんでした…` が出たら、ターミナルの入力欄（補完の候補の一覧が開いていないか・本文が書き換わっていないか）と、端末で `copilot --version` を実行した結果を記録する。確かめた後、参照がオンのままならオフに戻す
- [ ] **AGT-264** `copilot` の入力欄に `Run the shell command sleep 15.` を入力して `Enter` で送り、許可の確認（`Do you want to run this command?`）が出たら、`copilot 送信` の `実行` にマウスを載せる。確かめた後、ターミナルの中をクリックして `Esc` を押し、許可の確認を取り消す → 許可の確認の間は `実行` が押せず、`copilot が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）` が出る。`Esc` の後は `sleep` が実行されずに入力待ちに戻り、`実行` が押せる。許可の確認が出ずにコマンドが実行された（設定で許可済み）ときは、そのことを記録して次へ進む
- [ ] **AGT-265** 長い作業を送り、帯が `作業中` になったら帯の `中断` を押し、すぐに `copilot 送信` の `実行` にマウスを載せる。2 秒ほど待ってから、もう一度マウスを載せる → 押した直後は `実行` が押せず、`中断を送ったばかりのため送信できません（2 秒ほど待ってから、もう一度実行してください）` が出る（copilot は 2 回目の Esc の後にもう一度 1 秒を数え直すため、押せない間は 1 秒より少し長い）。2 秒ほど待った後は、まだ作業中なら `copilot が作業中のため送信できません（…）` が出て、入力待ちなら押せる
- [ ] **AGT-266** `copilot 送信` の内容を、1 行目が `Without using any tools or files, reply with only the word OK. Ignore the numbered lines below.`、2〜12 行目が `1`〜`11` の 12 行に変えて保存し、`実行` → `送信` を押す → ターミナルの入力欄に `[Paste #N - 12 lines]` の形（N は貼り付けの通し番号で、1 とは限らない）が一瞬出てから送られ（見えなければ、そのことを記録する）、`エージェントに送信しました` が出る。`copilot` の画面の発言の行には 12 行の全文が出て、`OK` と答える。確かめた後、内容を元に戻して保存する
- [ ] **AGT-267** 帯の `+` で `copilot 2` を起動し（信頼の確認が出たら `1. Yes`）、入力待ちになったら `copilot 1` のタブを選んで長い作業を送り、帯が `作業中` になってから `copilot 2` のタブを選んで `copilot 送信` の `実行` → `送信` を押す → `実行` は押せ、`copilot 2` だけに送られて `OK` と答える。`copilot 1` の作業は続き、`copilot 1` の入力欄には何も入らない。確かめた後、`copilot 1` を選んで `中断` で作業を止め、`copilot 2` のタブを `×` で閉じ、確認で `OK` を押す
- [ ] **AGT-268** VoiceOver を有効にして、`copilot 1` が入力待ちのときに `copilot 送信` の `実行` → `送信` を押す。続けてターミナルの入力欄に `draft` と入力してから、同じように `実行` → `送信` を押す → 1 回目は `エージェントに送信しました` が読まれる。2 回目は `copilot の入力欄に書きかけがあるため送信できません（…）` が読まれる。確かめた後、`Ctrl+U` で書きかけを消し、VoiceOver を切る（VoiceOver を使わない場合は、この項目を飛ばしてそのことを記録する）
- [ ] **AGT-269** `copilot 1` が動いていれば `終了` で止め、設定の `使うエージェント CLI` で `Claude Code（claude）` を選ぶ。帯の `起動` で `claude 1` を起動し、入力待ちになったら、`claude` の入力欄に `hello` と入力して（`Enter` は押さない）から `copilot 送信` の `実行` → `送信` を押す。`claude` が答え終わったら、「プロンプト」パネルで `copilot 送信` を消す → `claude` では今までどおり、書きかけの `hello` を消してから本文が送られ、`エージェントに送信しました（入力欄に書きかけがあったようなので、消してから送りました）` が出る。この項目で設定は元に戻る

追記したら `node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact（<manual-test-spec-artifact-url>）を同じファイルパス（`.superpowers/manual-test-spec.html`）で再公開する。`npx vitest run scripts` が通ること。

## ROADMAP の更新の方針

- 「エージェント実行の支援（MVP の次）」の `- [ ] \`claude\` 以外のエージェント CLI への対応（…）`（:612）は**未完了のまま**にし（段階 3 が残る）、段階 2a の行（:614）の後に次の行を足し、「残り」の行（:615）を直す
  - 行の形は段階 2a の行と同じ（`実装済み（日付。段階 2b。設計書 …）: …`）にし、日付は main に入れた日、設計書は `docs/superpowers/specs/2026-10-22-agent-cli-copilot-send-design.md` を書く。本文は `copilot へのプロンプトの送信（実行・再実行・送信前の確認）。入力待ちのときだけ送り、書きかけ・先頭の ! と / は断り、末尾の @ の語（参照の添付）は末尾に空白を足して送り、Enter の後に送れたことを画面で確かめる。実装済み機能の「copilot へのプロンプトの送信（段階 2b）」を参照`
  - 残り: `copilot の hooks による変更の区別・セッションの再開・起動の記録と履歴への CLI の種類の記録＝段階 3`
- 実装済み機能の `### copilot の画面の判定と中断（段階 2a）` の既知の制約の最後の行（:555。`copilot` ではプロンプトの送信…を使えない）を、段階 2a の時点の記録として過去形に直し、`（段階 2b でプロンプトの送信に対応した）` を書き足す
- 段階 1 の節の既知の制約の 1 行目（:515）の末尾の書き足しに、`段階 2b でプロンプトの送信に対応した` を加える
- 実装済み機能の末尾（`### copilot の画面の判定と中断（段階 2a）` の後）に `### copilot へのプロンプトの送信（段階 2b）` を足す。設計書へのリンク、送信の手順の表（CLI ごと）と `copilot` の手順の要点（押せる条件・空と書きかけの見分け方・括弧付きの貼り付け・echo の確かめ・別の書き込みの `Enter`・送れたことの確かめ）、既知の制約（この設計書の「既知の制約」と同じ）を書く

## 次の段階の見通し

- **段階 3（hooks と再開）**: 段階 1 の設計書の見通しのとおり（`copilot` の hooks を 1 回の起動だけに効かせる方法・`--session-id` と `--resume`・起動の記録への種類の記録）。履歴のエントリへの CLI の種類の記録（古いエントリは `claude` として読む。L-456・L-459）と、`copilot` へ送ったプロンプトの履歴への記録もここで扱う
- 先頭の空白の後の `!`・`/`・`#` の補完は、追加の記録で確かめられたら断る範囲を見直す（今は送らない側・確かめで失敗にする側に倒している）

## 実装の分割

1 つの実装プランで、次の順のタスクにする。押せる条件（`getPromptRunAvailability`）は送信の手順の表の `requiresIdle` を引くため、手順の表を作るタスクの後に置く必要がある。そこで実装プランでは、3 から押せる条件を外し、5（配線）を **Task 5（押せる条件と能力）** と **Task 6（送信の配線）** に分けた（下の番号 1〜6 は設計書の分け方。対応は 1 → Task 1、2 → Task 2、3 → Task 3、4 → Task 4、5 → Task 5・6、6 → Task 7）。

1. **copilot の入力欄の台帳**: 「実装の最初に確かめること」の 1〜3（変換のスクリプト・個人情報の置き換え・`copilotInputScreens.json`・`copilotInputScreens.ts`・`README.md`・`.prettierignore`・`copilotInputScreensFixture.test.ts`）
2. **入力欄の読み取り**: `copilotInputBox.ts`（`copilotScreenActivity.ts` からの移動と、記号・行・入力欄の状態・echo）とテスト（台帳の期待・列・手書きの画面。段階 2a の判定のテストが通ること）
3. **本文の検査と文言**: `agentPasteText.ts` の種類ごとの規則、`agentSendMessages.ts` の失敗の文言の表・活動の理由・押せる条件、`agentSendPreview.ts`・`agentReferenceMessages.ts`・`promptRunState.ts` とテスト
4. **送信の手順の表**: `claudePromptSend.ts`（移動）・`copilotPromptSend.ts`・`agentPromptSendSpecs.ts`・`agentPromptSend.ts` の型とテスト、統合テスト
5. **配線**: `useAgentPromptSender`・`useAgentInterrupt`・`useAgentWorkspace`・`AgentSendConfirmDialog`・`usePromptRunner`・`agentSendCallbacks`（送れたときの種類と、会話の ID を持たない種類で記録を黙って省く）、能力の表の `promptSend` と設定の注記のテスト、配線のテスト（変異の確認を含む）
6. **ROADMAP の更新・既知の制約・テスト仕様書と全体の検証**:
   - ROADMAP: 「ROADMAP の更新の方針」のとおり
   - 実機テスト仕様書: AGT-257〜269 と既存の項目の直しを実装の文言と照らし合わせて確定して追記する。`node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact を同じファイルパスで再公開する（コントローラーが行う）。`npx vitest run scripts` が通ること
   - 設計書の「既知の制約」を実装と照らし合わせ、食い違いがあれば直す
   - 全体の検証: `npm test`・`npm run typecheck`・変更したファイルへの `npx eslint`

main に入れた時点で利用者から見える挙動:

- `copilot` のタブが入力待ちのとき、プロンプトの `実行`・履歴の `再実行`・送信前の確認から `copilot` へ送れる。作業中・許可待ち・確認待ちの間と、中断の直後は押せない
- 書きかけがある・先頭が `!`・`/` のときは送らずに理由を出す。参照を添えたプロンプト（末尾が `@` の語）も送れる。送った後に送れたことを確かめられなければ、`Enter` を送り直さずに理由を出す
- `claude` を選んでいる間は今までと同じ

## 気をつける知見（dev-flow-kit の review-lessons.md）

選び方: 依頼で指定された項目（L-001・L-017・L-019・L-037・L-041・L-059・L-072・L-157・L-408・L-414・L-593・L-594・L-596・L-597）と、送信・貼り付け・入力欄に関係する項目（L-083・L-398・L-443・L-058・L-060・L-061・L-354）の本文を読み、今回の変更（入力欄の読み取りの規則・pty へ書く手順・押せる条件の入口・失敗の文言・台帳・実機の手順）に当てはめた。

- L-001: `copilot` の送信は `Enter` の後に画面で送れたことを確かめてから `sent` にし、確かめられなければ `not-confirmed` で失敗として出す。通知・`onSent`（参照を外す）・タブへの移動は `sent` のときだけ（今の流れ）。どの失敗も、書いたものと書いていないものを文言で誤解させない（「失敗の一覧」・「文言」）
- L-017: 新しい失敗の文言は固定の文だけで、例外の文を足す経路は今の `エージェントへ送信できませんでした: <message>` だけ。台帳はユーザー名・一時ディレクトリ・UUID を置き換え、個人情報のテストを通してからハッシュを固定する（「実装の最初に確かめること」）
- L-019: 新しい IPC を足さず、利用者のキー入力と同じ `agentTerminal:write` の経路で、正規化した本文の括弧付きの貼り付けと `\r` だけを書く。書いた列をテストで完全に一致させる（「決めたこと」・「テスト方針」）
- L-037: 送り先は押した時点のタブを控え（今の作り）、中断の流れ・活動の判定は送り先のタブで見る。送信前の確認は開いた時点の送り先の種類とタブで押せる条件を求める（「押せる条件」）
- L-041: 送信の手順は `Esc` も消去のキーも送らない。入力待ちでないときは何も書かず、書きかけ・シェルのモード・決められない入力欄にも書かない（「copilot の手順」）
- L-058: 押せる条件（活動・中断の流れ）は 3 つの入口で同じ関数にし、押した時点にも同じ条件を確かめ直す。押せない理由と送った後の失敗が同じ原因なら同じ文言にする（「押せる条件」・「文言」）
- L-059: 規則を実物の `copilot` で記録した画面と列（段階 2b の追加の記録）で固定し、pty と画面の経路を実物の node-pty と `@xterm/headless` の統合テストで確かめる。記録できなかった場面は既知の制約に書き、実機の項目で確かめる（「実装の最初に確かめること」・「テスト方針」・「既知の制約」）
- L-060・L-593: 送信の手順と本文の規則は種類をキーにした表（`AGENT_PROMPT_SEND_SPECS`・`AGENT_PROMPT_TEXT_RULES`・`AGENT_SEND_FAILURE_KIND_TEXTS`）に閉じ、種類の名前との比較を入口に書かない。`normalizeAgentPrompt` の種類・`isInterrupting` の引数・押せる条件の `activity`・`isInterrupting` は省略できない形にし、配線のテストと受け渡しを外す変異の確認を入れる（「送信の手順の表」・「テスト方針」）
- L-061: 新しい守り（中断の流れの間は送らない）と送信中の状態に対して、送信・中断・キー入力・終了・タブの操作の入口を表にした（「新しい状態と既存の入口」）
- L-072: 実機の項目は、`copilot` に頼む内容を返答だけにし、許可の確認は `Esc` で取り消し、信頼の確認で覚えさせない。足したプロンプト・変えた内容・設定・書きかけは、項目の終わりに元へ戻す（「実機テスト仕様書の新しい項目の下書き」）
- L-083: 先頭の文字の判定は正規化（制御文字の除去）の後の本文で行い、`\x1b!ls` を断るテストで順を固定する（「本文の検査」）
- L-157・L-408: 送信前の確認のダイアログの連打の対策（ダブルクリックの 2 回目・キーリピートの無視・押せないときのフォーカス）は今のまま使う。`copilot` の失敗は押した後に起きるので、フォーカスは今の失敗と同じく確認を開いた元（無ければ一覧の `実行`）へ戻る。ただし戻り先が押せないとき（失敗の時点で送り先が作業中・許可待ちに変わり、`実行`・`再実行` が活動の理由で押せない、中断の流れの間 など）は、今のセッションが終わったときと同じく移さない（`usePromptRunFocus`・`findSendConfirmReturnTarget`。SRP リファクタリングで実装に合わせて書き足した）
- L-354: 実機テスト仕様書の下書きは、実装の後にコードの文言と照らし合わせて確定してから追記する
- L-398: 入力欄の読み取りは、入力欄の罫線からの相対位置（入力欄の中の行・下の罫線より下の帯）だけで見て、会話の本文や補完の候補の一覧（上の罫線より上）の同じ文字を見ない。根拠が足りない（一時的な帯・帯が空・形が合わない）ときは「決められない」を返し、送らない側に倒す（「入力欄の特定と読み取り」）
- L-414: 末尾の `@` の語は、記録で `Enter` が補完の確定に取られ、末尾に空白を 1 つ足すと一覧が開かず `Enter` 1 回で送られた（改行・`Esc` では閉じない）ので、貼る本文の末尾に空白を足す。記録していない補完（`#`）や版の違いは `Enter` の後の画面の確かめで失敗にする（「決めたこと」・「既知の制約」）
- L-443: 長すぎる本文の判定は今までどおり正規化の後（`claude` と同じ。正規化は 1 回の置換で、200,000 字を大きく超える入力の費用は今と変わらない）
- L-594: 中断の流れの間は送信を始めず、送信中は中断を押せない排他にして、2 回目の `Esc` が貼った本文を消す組み合わせを作らない（「新しい状態と既存の入口」）
- L-596: 台帳は段階 2b の追加の記録（利用者の環境から切り離した記録）から写し、新しく実物を起動しない。統合テストも偽の CLI だけを使う（「実装の最初に確かめること」・「テスト方針」）
- L-597: 失敗の文言に次の行動（ターミナルで答える・抜ける・送るか消す・待つ）と、消していない・送り直していないことを入れる（「文言」）
