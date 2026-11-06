# エージェントの許可の確認に帯のボタンで答える設計書

- 日付: 2026-11-06
- ROADMAP の項目: 「今後実装した方がよい機能（未実装）」の「AI エージェント / 自律実行」の「危険な操作の承認フロー」（`ROADMAP.md:785`）を、アプリ側で補う形で実装する
- 前提の設計書: `2026-10-09-agent-session-activity-design.md`（活動の判定）、`2026-10-19-agent-interrupt-ui-design.md`（帯の `中断`。この設計書の作りの手本）、`2026-10-21-agent-cli-copilot-screen-design.md`（`copilot` の画面の判定と中断。:77 の Esc の効き方）、`2026-10-22-agent-cli-copilot-send-design.md`（送信と中断の排他）
- 実装は 1 つの実装プラン・1 つの PR にする（「実装の分割」）

## 目的

エージェント CLI（`claude`・`copilot`）がツールの実行の許可を求める（活動の判定が `permission`）と、今はターミナルにフォーカスを移して、選択肢を矢印キーか番号キーで選ぶしかない。
タッチの画面やマウスだけで使っているときは、ターミナルの小さな選択肢を狙うのが難しく、帯の `中断` は許可待ちでは押せない（Esc は許可の拒否・操作の取り消しになるため。2026-10-19 の設計書 :23）。

この機能では、選択中のタブが許可待ちのとき、ターミナルパネルの帯（`AgentTerminalPanel.tsx` の `agent-terminal-panel__actions`。`中断` の並び）に、問いの 1 行目と `許可`・`拒否` の 2 つのボタンを出す。
押すと、ターミナルでその選択肢の番号キーを 1 回押したのと同じ 1 バイト（`1`〜`9` のいずれか）を送る。答えた結果（許可待ちが終わったか）は、今までどおり CLI の画面（活動の判定）で分かる。アプリは「送れたか」だけを扱う。

## 決めたこと（利用者の確認済み）

2026-11-06 に利用者が決めた。

| 項目               | 決定                                                                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ボタン             | `許可`（1 回だけの Yes）と `拒否`（No の選択肢）の 2 つだけ。「今後は確かめない」系の選択肢（`claude` の `Yes, and always allow…`・`Yes, and switch to auto mode`、`copilot` の `Yes, and don't ask again…`）は CLI の設定に許可が残るので帯に出さず、ターミナルで選んでもらう |
| 押したときの確かめ | 確認のダイアログは挟まない。代わりに押した瞬間に画面を読み直し、許可待ちのままで、問いと選択肢が描画したときのものと同じときだけ送る                                                                                                                                           |
| 何に答えるかの表示 | 帯に問いの 1 行目（例: `Do you want to proceed?`）も出す。長ければ省略する                                                                                                                                                                                                     |

## 設計で決めた事項（この設計書で決めた細部）

| 項目                           | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 送るキー                       | 選択肢の番号の数字キー 1 バイト（`1`〜`9`）。矢印キーで動かして `Enter` は使わない。根拠は「調べて分かったこと」。番号はカーソルの位置に依らない（矢印はカーソルからの相対なので、利用者がターミナルでカーソルを動かしていると別の選択肢になる）。矢印は `\x1b[B` の 3 バイトで、`Enter` と分けて送ると間に画面が変わって別の操作になりうる（L-594）。`\x1b` で始まるので、読み取りが分かれると Esc（拒否・取り消し）として働きうる                                                                                                                                                                                                                                                                                               |
| 送るバイトの決め方             | 専用の IPC `agentTerminal:answerPermission`（`invoke`）。renderer は `sessionId` と選択肢の番号（数）だけを渡し、main が 1〜9 の整数であることを確かめて、固定の表から数字の 1 バイトを書く（L-019。中断の IPC と同じ作り）。既存の `writeAgentSession`（任意の文字列）には流さない                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 選択肢の読み取り               | 画面から問い・本文・選択肢（番号・文言・カーソル位置）を読み取る純粋関数を CLI ごとに置き、既存の判定（`isPermissionPrompt`・`hasPermissionQuestion`）の位置の特定を関数として切り出して共有する（「選択肢の読み取り」）。`許可` は文言がちょうど `Yes` の選択肢、`拒否` は文言が `No` そのものか `No,` で始まる選択肢。どちらもちょうど 1 つのときだけ使う                                                                                                                                                                                                                                                                                                                                                                       |
| 番号キーが効く状態の確かめ     | CLI ごとに「今この画面で番号キーが選択肢の選択として効くか」を読み取る（`numberKeysAccepted`）。`claude` はカーソルが `Yes` か `No` の選択肢にあり、案内の行に `Tab to amend` があるときだけ。`copilot` はカーソルが最後の選択肢（`No, and tell Copilot…` の入力欄になる選択肢）に無いときだけ。効かない状態で送ると、数字が答えの文の入力欄に文字として入る（「調べて分かったこと」）                                                                                                                                                                                                                                                                                                                                            |
| 同一性の照合                   | 描画に使った読み取りの結果と、押した時点の読み取りの結果で、本文の行・問いの行・選択肢の `{ 番号, 文言 }` の並びの完全一致を比べる（件数では比べない。L-036）。カーソル位置・`numberKeysAccepted`・`bodyStartVisible` は照合に入れず、押した時点の値で別に確かめる（review-loop 第 28 周で `bodyStartVisible` を足した。照合に入れると、罫線だけが画面から流れて本文が同じ画面で「内容が変わった」になり、「ターミナルを広げて」という具体的な理由が出せないため）。本文（問いの上の、許可の画面の中のコマンドなど）を入れるのは、`claude` の `Do you want to proceed?` と選択肢が続けて同じになる（別のコマンドの許可でも同じ文言）ため                                                                                          |
| 描画に使う読み取り             | 新しい hook `useAgentPermissionPrompt` が、選択中のタブの活動が `permission` の間だけ画面を読み取って控える（出力の通知から `AGENT_ACTIVITY_SETTLE_MS`〈150ms〉後に読み直す。通知が続いても最初の未読の通知から `AGENT_ACTIVITY_MAX_WAIT_MS`〈500ms〉で読む）。`useAgentActivity` は変えない                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 出す間                         | 選択中のタブが `running` で、CLI の能力の表の `permissionAnswer` が true で、描画の活動が `permission` のときだけ出す（`中断` と違い、許可待ちでないときは出さない。帯を狭めないため）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 押せない状態の作り             | `disabled` ではなく `aria-disabled="true"`。押した処理の先頭で描画と同じ純関数で判定して送らない（L-058）。理由は隠した `span`（`hidden`）と `aria-describedby`・`title` で出し、押したときは読み上げる（`中断` と同じ）。押した後にフォーカスが body に落ちない（L-157）                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 押せない理由                   | 判定の順に、閉じる途中・送信中・送信前の確認の表示中・中断の流れの間・答えを押した直後（送っている途中・1,000ms・送った後の画面の読み直し待ち）・画面を読み取れない・番号キーが効かない・その選択肢が無い・パネルを閉じている間（`許可` だけ。review-loop 第 27 周で足した）・ターミナルを上へスクロールしている間（`許可` だけ。review-loop 第 31 周で足した）・本文の上の端が画面に無い間（`許可` だけ。review-loop 第 28 周で足した）・許可の確認が出た直後（1,000ms。それさえ無ければ押せるときだけ出す。review-loop 第 11 周で最後へ移した）（「押せない理由の文言」・「押せるかの判定」）                                                                                                                                   |
| 本文が欠けた確認               | 読み取りの結果に `bodyStartVisible`（本文の上の端〈`claude` は全幅の罫線 `FULL_WIDTH_RULE`、`copilot` は行頭の `╭`〈`DIALOG_TOP`〉。`copilot` の読み上げのモードは外枠が無く内側のコマンドの枠の `╭` が当たる〉を画面の中で見つけたか）を持たせ、偽の間は `許可` だけを押せなくする（`拒否` は押せる・帯には出す）。描画の読み取りと、押した時点で読み直した読み取りの両方で見る。ターミナルを低くした（7 行前後）・複数行のコマンドや大きな差分の確認では、本文の上が画面の上へ流れ、欠けた本文どうしで照合が一致して、許可する内容を見ないまま `Yes` を送れたため（review-loop 第 28 周）                                                                                                                                       |
| 上へスクロールした確認         | ターミナルの表示が画面の末尾に無い間（利用者が上へスクロールして前の出力を読み返している間。`viewportY < baseY`）は `許可` だけを押せなくする（`拒否` は押せる・帯には出す）。読み取りは画面の末尾（`readScreen`。`baseY` から `rows` 行）を読むので利用者のスクロールに左右されず、`claude` は通常の画面（スクロールバックあり）に描くため、前の出力を読み返している間に確認が出ると、確認の本文が見えないまま帯の問いだけを見て `Yes` を送れたため（review-loop 第 31 周）。`copilot` は代替画面（スクロールバックが無い）なので常に末尾。controller の `isScrolledToBottom()`（`isViewportAtBottom`）を、描画は xterm のスクロール（`onScroll`）と出力の書き込みの通知をきっかけに読み直した値、押した時点は直接読んだ値で見る |
| 連打の対策                     | 押してから 1,000ms（`AGENT_PERMISSION_ANSWER_COOLDOWN_MS`）は、そのタブの `許可`・`拒否` を押せない。同期の再入の防止は ref の `Set<slotId>`（L-101・L-653）。`click` の `event.detail > 1` と、`Enter`・`Space` の `event.repeat` の `keydown` を捨てる（L-408）。答えを送ったら描画の読み取りを捨て、送った後の画面を読み直すまで押せない。許可の確認が帯に出た（別の確認に替わった）描画から 1,000ms（`AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS`）も押せない（出た直後の猶予。review-loop 第 10 周で足した）                                                                                                                                                                                                                    |
| 中断との排他                   | 中断の流れの間（`isInterruptPending`）は答えられない。逆に、答えを送っている途中・1,000ms・送った後の画面の読み直し待ちの間は `中断` を押せない（中断の押せない理由に 1 つ足す。`useAgentPermissionAnswerCooldown` の `isPending`・`isPendingNow`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ボタンが消えるときのフォーカス | 答えて許可待ちが終わると 2 つのボタンは消える。パネルの中で最後にフォーカスを受けたのが `許可`・`拒否` で、移す時点の `document.activeElement` が body なら、開閉のボタン（`エージェント`）へ移す。`中断`・`終了`・ターミナルへは移さない（続けて押した `Enter` が、許可した作業の中断・会話を失う終了・ターミナルの入力になるため。L-408）                                                                                                                                                                                                                                                                                                                                                                                       |
| 答えた後                       | 判定の更新に任せる。`claude` は許可なら作業中、拒否なら入力待ちに変わり、ボタンは消える。`copilot` の拒否は、選択肢が「代わりにしてほしいこと」の入力欄に変わり（許可待ちのまま）、ボタンは押せない理由つきで残る。読み上げでターミナルで入力するよう案内する                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 読み上げと通知                 | 帯の読み上げの要素（`p.agent-terminal-panel__live`）をもう 1 つ置き、送れたとき・押せない状態で押したときに読み上げる。App の常設の読み上げ（`AgentAnnouncer`）・完了と許可待ちの通知（`useAgentNotifications`）・ステータスバーは変えない（「既存の機能との関係」）                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 能力の表                       | `AgentCliCapabilities` に `permissionAnswer` を足す（`Record` の表なので決め忘れは型エラー）。`claude`・`copilot` とも true。押せる条件が `screenActivity` の `permission` なので、true なら `screenActivity` も true（テストで固定）。main では能力で拒否しない（中断と同じ）                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ショートカット                 | 足さない（ターミナルで番号キーがそのまま使える）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 範囲

含めるもの:

- 帯の問いの 1 行目と `許可`・`拒否` のボタン（出す条件・押せない理由・読み上げ・失敗の表示・連打の対策・フォーカス・狭い幅・ダークの色）
- 画面から許可の確認を読み取る純粋関数（CLI ごと）と、既存の判定との位置の特定の共有
- 押せるかの純関数・押した時点の判定のやり直し・文言
- IPC `agentTerminal:answerPermission`（shared の型・preload・main の受け口・registry・`AgentSession`）
- 能力の表の `permissionAnswer`
- 中断の押せない理由の追加（答えた直後）
- ROADMAP・実機テスト仕様書の更新

含めないもの:

- 「今後は確かめない」系の選択肢・すべての選択肢のボタン
- 確認のダイアログ・自動の承認（決まった操作を自動で許可する機能）
- 拒否の理由（代わりにしてほしいこと）を帯から入力する欄
- 許可待ち以外の選択の画面（フォルダの信頼の確認・`/model`・巻き戻し。活動が `confirm`）への答え
- 裏のタブ（選択中でないタブ）への答え・ショートカット・ステータスバーや通知からの答え
- 許可の内容（コマンドなど）の帯への表示（問いの 1 行目だけ。「既知の制約」）
- 従来の方式（API・非対話 CLI）

## 調べて分かったこと（番号キーの効き方）

設計の時点で、このマシンにある各 CLI の実装を読んで確かめた（記録した画面の版と同じ版）。

### `claude` 2.1.288（`~/.local/share/claude/versions/2.1.288`。台帳 `agentScreens.json` と同じ版）

- 選択の部品（Ink の Select）の打鍵の処理に `/^[0-9]$/` の分岐があり、`parseInt(key) - 1` の位置の選択肢を `onChange` で**即決**する（範囲外の `0` などは何もしない。無効の選択肢は何もしない）
- 許可の画面の選択肢は、既定では `Yes`・（コマンドに応じた `Yes, and …`）・（`Yes, and switch to auto mode`）・`No` の普通の選択肢。`Yes` と `No` は `Tab` で「答えの文を足す」入力の形（`type: "input"`）に切り替わり、
  その間は打鍵が入力欄へ入る（数字も文字として入る）。入力の形でも、文が空なら番号キーで即決する（`allowEmptySubmitToCancel`）が、カーソルがその入力欄にあるときは打鍵は入力欄が受け取る
- コマンドの接頭辞を編集できる選択肢（`Yes, and don't ask again for: <接頭辞>`）も入力の形で、カーソルがそこにあると数字は接頭辞の欄へ入る
- 案内の `Tab to amend` は、カーソルが `Yes` か `No` にあり、その選択肢がまだ入力の形になっていないときだけ出る（読み上げのモードでは出ない）。台帳の `permission` の画面は ` Esc to cancel · Tab to amend`
- 結論: カーソルが `Yes` か `No` にあって `Tab to amend` が出ている画面なら、番号キー 1 バイトで即決する。それ以外の画面では送らない（`numberKeysAccepted` が false）

### `copilot` 1.0.87（`~/Library/Caches/copilot/pkg/darwin-arm64/1.0.87/app.js`。台帳 `copilotScreens.json` と同じ版）

- 許可の画面の選択の部品は、選択肢の後ろに「入力欄になる最後の選択肢」（`escapeItemWithTextInput`。`No, and tell Copilot what to do differently`。画面では後ろに ` (Esc to stop)`）を付ける。最後の選択肢は常にこれ
- 数字の打鍵は番号の飛び先の処理（複数桁の番号のため 500ms 待つ作り）に渡る。打った番号 × 10 が選択肢の数を超えると待たずに確定するので、選択肢が 9 つ以下なら 1 桁の番号は**即決**する
- 確定した番号が最後の選択肢でなければ、その選択肢を選ぶ（`1` の `Yes` は `approve-once`。1 回だけの許可）。**最後の選択肢なら、選ばずにカーソルをそこへ動かすだけ**で、その行が「代わりにしてほしいこと」の入力欄に変わる（文言は入力欄の薄い案内として同じ文字で描かれる。台帳の `permissionDown` と同じ見た目）
- カーソルが最後の選択肢にある間は、選択の部品は矢印・数字・`Enter` を扱わず、打鍵はすべて入力欄へ入る（数字も文字として入る）。入力欄で文を入れて `Enter` を押すと、その文を添えて拒否する。空の `Enter` は何もしない。`Esc` は、文があればそれを添えて拒否し、無ければ拒否として操作ごと取り消す（台帳の `afterEscPermission` の `Operation aborted by user`）
- 結論: `許可` の `1` は即決する。`拒否` の番号は即決せず、入力欄を開く（利用者がターミナルで文を入れて `Enter`）。カーソルが最後の選択肢にある画面では送らない（`numberKeysAccepted` が false）。`拒否` を押した直後の画面はこの状態になるので、続けて `許可`・`拒否` を押しても送らない
- 参考: 手元の新しい版（1.0.105）では、入力欄になる最後の選択肢が `Something else, and tell Copilot what to do differently` になる許可の画面がある（サンドボックスのパスの許可）。この文言は `No` で始まらないので `拒否` は押せない（「既知の制約」）

上の確認は実装を読んだもので、アプリの xterm.js と実物の pty で番号キーを送った画面は記録していない。実機テスト（AGT-297〜）で確かめる（「既知の制約」）。

## 画面

### 帯の並び

帯の並びは、開閉・ヒント・タブ列・状態の文言・**問いの 1 行目**・**`許可`**・**`拒否`**・`中断`・`終了`・（`変更を確認`）・`最大化`。
問いと 2 つのボタンは `中断` の直前に置く（許可待ちの間は `中断` は押せないので、答える操作を先に置く）。許可待ちでないときは 3 つとも描かない。

| 要素   | 内容                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 問い   | `span.agent-terminal-panel__permission-question`。描画の読み取りの問いの 1 行目（前後の空白を除く）。`title` に問いの全文（問いの行を半角空白 1 つでつないだもの）。`aria-hidden="true"`（問いの全文をボタンの名前に入れるので、読み上げの順番に重ねて出さない。名前に入れるのは 1 行目ではなく全文: 問いが折り返すと 2 行目に対象のファイル名が来るため。review-loop 第 19 周で 1 行目から変えた）。読み取れないときは描かない |
| `許可` | `button.agent-terminal-panel__button`。見える文字 `許可`                                                                                                                                                                                                                                                                                                                                                                        |
| `拒否` | `button.agent-terminal-panel__button`。見える文字 `拒否`                                                                                                                                                                                                                                                                                                                                                                        |

ボタンの属性（`中断` と同じ作り。2026-10-19 の設計書「帯のボタン」）:

| 属性               | 値                                                                                                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aria-label`       | 見える文字で始める（パターン 76）。選択肢を読み取れたとき `許可（claude 1 の「Do you want to proceed?」に 1 番の Yes で答える）`・`拒否（claude 1 の「Do you want to proceed?」に 4 番の No で答える）`。読み取れないとき `許可（claude 1 の許可の確認に Yes で答える）`・`拒否（…に No で答える）` |
| `aria-disabled`    | 押せないとき `true`。押せるときは属性を付けない                                                                                                                                                                                                                                                     |
| `aria-describedby` | 押せないとき、隠した `span`（`hidden`）の id。中身は押せない理由。ボタンごとに別の `span`（理由がボタンで違いうるため）                                                                                                                                                                             |
| `title`            | 押せないとき、押せない理由                                                                                                                                                                                                                                                                          |

ボタン 1 つ分（隠した理由の `span`・`aria-*`・ダブルクリックとリピートの無視）は `components/agent/AgentPermissionAnswerButton.tsx` に分ける（`許可`・`拒否` で同じ作りを 2 回書かないため）。名前の番号は、描画の読み取りから `findAgentPermissionOption` で引く（押せない理由があるときも名前が変わらないように。送る番号は押した時点の判定の結果だけを使う）。
問いと名前には表示用の読み取り（`useAgentPermissionPrompt` の `displayPrompt`）を使い、押せない理由には判定用の読み取り（`prompt`）を使う。答えを送った後の読み直し待ちの間も `displayPrompt` は同じタブの直前の読み取りのままなので、押した直後に、フォーカスが残ったボタンの名前が「許可の確認に Yes で答える」に変わったり、問いが消えて `許可`・`拒否`・`中断` が横にずれたりしない（review-loop 第 3 周で直した。それまでは判定用の null を表示にも使っていた）。

`claude 1` はタブのラベル（`formatAgentTabLabel`）。`copilot` の `拒否` の名前は `拒否（copilot 1 の「Do you want to run this command?」に 2 番の No で答える）`（選択肢の文言の全文は長いので `No` とだけ書く）。

### 押せない理由の文言

`lib/agentPermissionAnswerMessages.ts`。判定の順は「押せるかの判定」の純関数の順。CLI で違う部分は種類ごとの表（`AGENT_PERMISSION_ANSWER_TEXTS: Record<AgentCliKind, …>`）で引き、CLI の名前は `AGENT_CLI_PROFILES` のコマンド名から作る。名前・理由・読み上げに出す選択肢の語（`Yes`・`No`）は、選択肢の規則と同じ `AGENT_PERMISSION_OPTION_WORDS`（`agentPermissionPrompt.ts`）から引く（直書きしない）。

| 状態                                                                      | 文言                                                                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 動いていない（帯には出さない）                                            | `claude が動いていないため答えられません`                                                                                                              |
| 能力が無い（帯には出さない）                                              | `claude では許可のボタンを使えません（ターミナルで答えてください）`                                                                                    |
| 許可待ちでない（帯には出さない）                                          | `claude は許可待ちではありません`                                                                                                                      |
| 閉じる途中                                                                | `閉じる途中のタブでは答えられません`                                                                                                                   |
| 送信中                                                                    | `プロンプトを送信している間は答えられません`                                                                                                           |
| 送信前の確認の表示中                                                      | `送信前の確認を開いている間は答えられません`                                                                                                           |
| 中断の流れの間                                                            | `中断を送った直後は答えられません（少し待つと押せます）`                                                                                               |
| 送っている途中・押してから 1,000ms 以内・送った後の画面を読み直す前       | `答えを押した直後です（少し待つと押せます）`                                                                                                           |
| 画面を読み取れない                                                        | `画面の選択肢を読み取れませんでした（ターミナルで答えてください）`                                                                                     |
| 番号キーが効かない（`claude`）                                            | `カーソルが Yes・No 以外にあるか、答えの文の入力欄が開いているため押せません（ターミナルで答えてください）`                                            |
| 番号キーが効かない（`copilot`）                                           | `copilot は、代わりにしてほしいことの入力を待っています（ターミナルで入力して Enter を押してください。何も入れずに Esc を押すと操作ごと取り消します）` |
| その選択肢が無い（`許可`）                                                | `画面に「Yes」の選択肢が見つかりません（ターミナルで答えてください）`                                                                                  |
| その選択肢が無い（`拒否`）                                                | `画面に「No」の選択肢が見つかりません（ターミナルで答えてください）`                                                                                   |
| パネルを閉じている（`許可` だけ。`拒否` は押せる）                        | `ターミナルを開いて、許可する内容を確かめてから押してください`                                                                                         |
| ターミナルを上へスクロールしている（`許可` だけ。`拒否` は押せる）        | `ターミナルを一番下までスクロールして、許可する内容を確かめてから押してください`                                                                       |
| 本文の上の端が画面に無い（`許可` だけ。`拒否` は押せる）                  | `ターミナルを広げて、許可する内容が全部見える状態で押してください（最大化しても収まらないときはターミナルで答えてください）`                           |
| 許可の確認が出た直後（帯に出た・別の確認に替わった描画から 1,000ms 以内） | `許可の確認が出た直後です（少し待つと押せます）`                                                                                                       |

押した時点の読み直し（「押したときの処理」の手順 2 の中の段階 (b)〜(f)）だけで出る理由:

| 状態                   | 文言                                                                           |
| ---------------------- | ------------------------------------------------------------------------------ |
| 許可待ちでなくなった   | `claude は許可待ちではなくなりました。画面を確かめてください`                  |
| 本文・問い・選択肢が変わった | `許可の確認の内容が変わりました。ターミナルで内容を確かめてからもう一度押してください` |

### 読み上げ

- 送れたとき（`label` は押した時点のタブのラベル、`N` は送った番号）:
  - `許可`: `claude 1 に許可（N 番の Yes）を送りました`
  - `拒否`（`claude`）: `claude 1 に拒否（N 番の No）を送りました`
  - `拒否`（`copilot`）: `copilot 1 で拒否（N 番）を選びました。ターミナルで、代わりにしてほしいことを入力して Enter を押してください`（種類の表の `denyFollowUp`。`claude` は null）
- 押せない状態で押したとき: 手順 2 の段階 (a)（可否）・段階 (b)〜(f)（画面の読み直し）のどちらで止めても、その理由を読み上げる（L-057）。ダブルクリックの 2 回目とキーリピートは部品で捨てるので読み上げない
- 要素: `p.agent-terminal-panel__live`（`role="status"`）をパネルの `section` の中に**もう 1 つ**常に描き、`toAnnouncementText(permissionAnswer.notice)` を入れる。中断の読み上げの要素とは分ける（2 つの hook の読み上げが同じ要素で上書きし合わないため）。
  `useTransientNotice` で 3,000ms 後に消え、同じ文言が続いても id を進めて読み直させる（パターン 87）
- 送れなかったとき: そのタブの `error`（帯の下の `role="alert"`）に出す（「エラー処理」）

### フォーカス

- 押した後もフォーカスは押したボタンに残る（`aria-disabled` のため。L-157）
- 許可待ちが終わって 2 つのボタンが消えたとき（出す状態から出さない状態に変わった描画）、パネルの中で最後にフォーカスを受けた要素が `許可` か `拒否` で、移す時点の `document.activeElement` が body（または null）なら、`useLayoutEffect` で開閉のボタン（`エージェント`。`toggleRef`。帯にいつもあり `disabled` にならない）へ移す
- 担当は新しい hook `hooks/useAgentPermissionAnswerFocus.ts`（`useAgentInterruptFocus` と同じ作り。控えは `section` の `onFocus` だけで更新し、`onBlur` では消さない。控えは出す状態から出さない状態に変わった描画のたびに false に戻す）。
  パネルの `section` の `onFocus` には、中断のフォーカスの控えとこの控えの両方を呼ぶ関数を渡す
- 移さない先とその理由（L-408）: `中断`（許可の後は作業中になり、続けて押した `Enter` で許可した作業を止める）、`終了`（会話を失う）、ターミナル（続けて押した `Enter`・数字が CLI の入力になる）
- 移し先の開閉のボタンも、`keydown` で `event.repeat` の `Enter`・`Space` を `preventDefault` する（長押しした `Enter` の残りのリピートが移った先に届き、Chromium がリピートごとに合成する `click` でパネルが開閉を繰り返さない。`copilot` は 1 で即決し、数百 ms でボタンが消える）

### 狭い幅

ボタンは 2 文字で、共通のボタンの規則（`flex: none`・`white-space: nowrap`）で縮まない。問いの `span` は `flex: 0 1 auto`・`min-width: 0`・`max-width: 24em`・`overflow: hidden`・`text-overflow: ellipsis`・`white-space: nowrap` で、狭い幅では状態の文言・タブ列と同じく先に縮む（省略された全文は `title` で見られる）。
帯は 1 行（高さ 32px）のまま。許可待ちの間は `エージェント`・`許可`・`拒否`・`中断`・`終了`・（`変更を確認`）・`最大化` の 6〜7 つのボタンが並ぶ（AGT-225 と同じ 670px で切れないことを実機で確かめる。AGT-305）。

### ダークの色

CSS は素の `main.css`（Tailwind 不使用。ダークの色固定）。ボタンは既存の `.agent-terminal-panel__button` と `[aria-disabled='true']` の規則をそのまま使う。問いの文字は状態の文言（`.agent-terminal-panel__status`）と同じ色にする。

## 選択肢の読み取り（renderer の純関数）

### 型と表（`lib/agentPermissionPrompt.ts`。新規。`AGENT_PERMISSION_PROMPT_READERS` だけは `lib/agentPermissionPromptReaders.ts`）

```ts
export interface AgentPermissionOption {
  /** 画面の番号(1〜AGENT_PERMISSION_OPTION_NUMBER_MAX) */
  number: number
  /** 番号の後の文言。折り返しの行は字下げを除いて半角空白 1 つでつなぐ(照合と Yes・No の判定にだけ使う) */
  text: string
}

export interface AgentPermissionPrompt {
  /** 問いの上の、許可の画面の中の行(コマンドなど。枠と前後の空白を除き、空の行は除く)。照合にだけ使う */
  body: readonly string[]
  /** 問いの行(前後の空白を除く)。帯に出すのは 1 行目 */
  question: readonly string[]
  /** 番号の順(1 から欠けずに並ぶ) */
  options: readonly AgentPermissionOption[]
  /** カーソルのある選択肢の番号 */
  cursorNumber: number
  /** 今の画面で、番号キーが選択肢の選択として効くか(CLI ごとの規則) */
  numberKeysAccepted: boolean
  /** 本文の上の端(claude は全幅の罫線、copilot は行頭の ╭)を画面の中で見つけたか。偽なら本文は画面の先頭からで、上が欠けているかもしれない */
  bodyStartVisible: boolean
}

/** 画面の行から許可の確認を読み取る。許可待ちの画面でない・形が崩れている(番号が欠ける・10 以上・カーソルが 1 つでない)なら null。例外は投げない */
export type AgentPermissionPromptReader = (
  lines: readonly ViewportLine[]
) => AgentPermissionPrompt | null

/** CLI の種類ごとの読み取り。種類を足したときの決め忘れを型エラーにする(実際は lib/agentPermissionPromptReaders.ts に置く) */
export const AGENT_PERMISSION_PROMPT_READERS: Record<AgentCliKind, AgentPermissionPromptReader>

export type AgentPermissionChoice = 'allow' | 'deny'

/** 帯のボタンに使う選択肢の語。選択肢の規則と、名前・押せない理由・読み上げに出す語(agentPermissionAnswerMessages.ts)が同じ語を引く */
export const AGENT_PERMISSION_OPTION_WORDS: Record<AgentPermissionChoice, string> // { allow: 'Yes', deny: 'No' }

/** allow は文言がちょうど `Yes`、deny は `No` そのものか `No,` で始まる選択肢。ちょうど 1 つのときだけ返し、無い・複数なら null */
export function findAgentPermissionOption(
  prompt: Pick<AgentPermissionPrompt, 'options'>,
  choice: AgentPermissionChoice
): AgentPermissionOption | null

/** 本文・問い・選択肢の {番号, 文言} の並びの完全一致(L-036)。cursorNumber・numberKeysAccepted・bodyStartVisible は比べない */
export function isSameAgentPermissionPrompt(
  a: AgentPermissionPrompt,
  b: AgentPermissionPrompt
): boolean
```

- `AGENT_PERMISSION_OPTION_NUMBER_MAX = 9` は shared（`src/shared/agentPermissionAnswer.ts`。新規）に置き、main の検証と renderer の読み取りが同じ値を使う。選択肢が 10 以上の画面は読み取れないとする（`copilot` は 10 以上だと 1 桁目の後に 500ms 待つため。「調べて分かったこと」）
- `deny` の規則（`No` そのものか `No,` で始まる。語は `AGENT_PERMISSION_OPTION_WORDS` から引く）は `Not now` などの語に当たらないようにする。`allow` を完全一致にするのは、「今後は確かめない」系（`Yes, and …`）を `許可` にしないため（決めたこと）
- 読み取りは、その画面の活動の判定が `permission` のときだけ値を返す（判定と読み取りの位置の特定を同じ関数で行うため。下）。呼ぶ側は活動の判定と読み取りを同じ行から行う

### `claude`（`lib/claudePermissionPrompt.ts`。新規）

既存の `isPermissionPrompt`（`claudeScreenActivity.ts:110`）の中身を、位置を返す関数 `locateClaudePermissionPrompt(texts): { cursorRow, numberColumn, questionFirst, questionLast } | null` として同じファイルに切り出して export し、
`isPermissionPrompt` は `locateClaudePermissionPrompt(texts) !== null` にする（規則・定数〈`PERMISSION_QUESTION`・`PERMISSION_CURSOR_OPTION`・`NUMBERED_LINE`・`RULE_LINE`〉を 1 か所に保つ。判定のテストはそのまま通ること）。
読み取りは `classifyClaudeScreen(lines) === 'permission'` のときだけ、位置から次を読む（入力欄のある画面を許可待ちとしない規則も判定に任せる）。

1. **問い**: `questionFirst`〜`questionLast` の行（前後の空白を除く）
2. **本文**: `questionFirst` から上へ、最初の全幅の罫線の行（字下げの無い、`─` だけの行。末尾の空白だけを除いて当てる。字下げした `─` だけの行〈heredoc で書く Markdown の区切りなど〉と `╌` の区切りは本文に含める）の直後から `questionFirst - 1` まで。罫線が無ければ画面の先頭から（そのとき `bodyStartVisible` は偽。罫線があれば真）。空の行と `RULE_LINE` の行は除く
3. **選択肢**: `questionLast + 1` から下へ。最初の選択肢の行までの空行は飛ばす。選択肢の行は、カーソルの行（`PERMISSION_CURSOR_OPTION` に当たり、組の長さが `numberColumn`）か、字下げがちょうど `numberColumn` で `NUMBERED_LINE` に当たる行。
   字下げが `numberColumn` より深い空でない行は、直前の選択肢の折り返し（台帳の `permission` の 2 番がパスで 2 行に折り返す）。選択肢が始まった後の空行・それ以外の行で終える。番号は `N.` の数、文言はその後の文字列（前後の空白を除く）
4. **形の確かめ**: 番号が 1 から欠けずに並び、`AGENT_PERMISSION_OPTION_NUMBER_MAX` 以下で、カーソルの行がちょうど 1 つ。満たさなければ null
5. **番号キーが効くか**: 選択肢の後の最初の空でない行（案内の行。台帳では ` Esc to cancel · Tab to amend`）に `Tab to amend` を含み、かつカーソルの選択肢が `AMENDABLE_OPTION_RULES`（`Yes` と、`No` そのものか `No,` で始まる選択肢。それぞれ画面にちょうど 1 つのときだけ当てる）に当たるとき true（「調べて分かったこと」）。
   これは `claude` が `Tab to amend` を出す選択肢という画面の規則で、帯の `許可`・`拒否` に使う選択肢の規則（`findAgentPermissionOption`。アプリの方針）とは分けて持つ（方針を変えても番号キーの読み取りが変わらないようにする）

### `copilot`（`lib/copilotPermissionPrompt.ts`。新規）

既存の `hasPermissionQuestion`（`copilotScreenActivity.ts:26`）の中身を、位置を返す関数 `locateCopilotPermissionQuestion(texts): { hintRow, questionRow } | null` として切り出して export し、`hasPermissionQuestion` はその `!== null` にする（`SELECTION_HINT`・`PERMISSION_QUESTION`・`FRAME_PREFIX`・`DIALOG_TOP` を共有する）。
行は `copilotScreenTexts`（末尾の空白を除く）で作る。読み取りは `classifyCopilotScreen(lines) === 'permission'` のときだけ行う。各行は、行頭の枠と空白（`FRAME_PREFIX`）と行末の枠と空白（新しい `FRAME_SUFFIX = /[\s│┃]+$/`）を除いてから見る。

1. **選択肢の行**: `questionRow + 1`〜`hintRow - 1` の行のうち、`/^(?:(❯|Current selection:) )?(\d+)\. (.*)$/` に当たる行。印（`❯ ` か、読み上げのモードの `Current selection: `）のある行がカーソルの行。
   並びの終わりは案内の行（`hintRow`）で決まり、選択肢でない行では終えない。最初の選択肢の行より後の、当たらない空でない行（最後の選択肢と案内の行の間も）は直前の選択肢の折り返し（字下げは見ない。記録の画面には無い。手書きの画面でテストする）。最初の選択肢の行より前の、当たらない空でない行は問いの折り返し
2. **問い**: `questionRow` の行と、その折り返しの行
3. **本文**: `questionRow` から上へ、行頭が `╭`（`DIALOG_TOP`）の行の直後から `questionRow - 1` まで（無ければ画面の先頭から。そのとき `bodyStartVisible` は偽。あれば真）。枠を除いて空になる行と、罫線・枠の文字（`─━│┃╭╮╰╯` と空白）だけの行は除く。
   後者には、外枠の中の区切りの `───`（台帳の `permission` の 18 行）と、内側のコマンドの枠の角の行（`╭──╮`・`╰──╯`。台帳の `permissionDown` の 19・21 行）が当たる。内側の枠の縦線は `FRAME_PREFIX`・`FRAME_SUFFIX` が除くので、コマンドの行は `echo hi > out.txt` になる。
   読み上げのモード（`srPermission`・`srPermissionDown`）は外枠が無く、上へたどって行頭の `╭` に当たるのは内側のコマンドの枠（20 行）なので、本文はコマンドの行（21 行）だけになる（枠の上の `Write a file` は本文に入らない）
4. **形の確かめ**: `claude` と同じ
5. **番号キーが効くか**: カーソルの番号が最後の選択肢の番号でないとき true（最後の選択肢は入力欄になる選択肢。「調べて分かったこと」）

台帳での読み取りの期待（テストで固定する）:

| 画面                                          | 本文                                                                                      | 問い                               | 選択肢                                                                     | カーソル | 番号キー    | `許可` | `拒否` |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- | -------- | ----------- | ------ | ------ |
| `claude` `permission`・`permissionAfterClear` | `Bash command`・`Tip: auto mode handles …`・`fake`・`echo hi > out.txt`（`╌` の行は除く） | `Do you want to proceed?`          | 4 つ（2 番は 2 行の折り返しをつないだ文言）                                | 1        | true        | 1      | 4      |
| `copilot` `permission`・`permissionDown`      | `Write a file`・`echo hi > out.txt`                                                       | `Do you want to run this command?` | 2 つ（`Yes`・`No, and tell Copilot what to do differently (Esc to stop)`） | 1・2     | true・false | 1      | 2      |
| `copilot` `permission3`                       | `Wait a bit`・`sleep 8`                                                                   | 同上                               | 3 つ（2 番 `Yes, and don't ask again …`）                                  | 1        | true        | 1      | 3      |
| `copilot` `srPermission`・`srPermissionDown`  | `echo hi > out.txt`（外枠が無く、内側のコマンドの枠の中だけ）                             | 同上                               | 2 つ                                                                       | 1・2     | true・false | 1      | 2      |

加えて、両方の台帳の**すべての画面**で、`AGENT_PERMISSION_PROMPT_READERS[kind]` が null でないことと、活動の判定が `permission` であることが一致する（判定と読み取りがずれないこと。L-041）。

## データの流れ

### 描画に使う読み取り（`hooks/useAgentPermissionPrompt.ts`。新規）

```ts
/** 読み取りに使う選択中のタブの値(AgentSessionTabView の一部。useAgentInterrupt の AgentInterruptTab と同じ作り) */
export type AgentPermissionPromptTab = Pick<
  AgentSessionTabView,
  'slotId' | 'status' | 'cliKind'
> & {
  controller: Pick<AgentTerminalController, 'onOutputWritten' | 'onResized' | 'readScreen'>
}

export interface UseAgentPermissionPromptOptions {
  /** 選択中のタブ(下の AgentPermissionPromptTab の値だけを使う) */
  selected: AgentPermissionPromptTab
  /** 選択中のタブの活動(描画に使った値。未記録は unknown) */
  activity: AgentActivity
  /** 描画用: そのタブが「送った後の画面の読み直し待ち」か(useAgentPermissionAnswerCooldown の isAwaitingReread。state) */
  isAwaitingReread: (slotId: string) => boolean
  /** 読み直し待ちのタブを読み直した(または読む必要が無くなった)ことを知らせる(useAgentPermissionAnswerCooldown の markReread) */
  onReread: (slotId: string) => void
}

export interface AgentPermissionPromptState {
  /** 判定用: 選択中のタブの、最後に読み取った許可の確認。許可待ちでない・読み取れない・読み直し待ちなら null */
  prompt: AgentPermissionPrompt | null
  /** 表示用(問い・ボタンの名前): prompt と同じだが、読み直し待ちの間も同じタブの直前の読み取りを返す。判定と送る番号には使わない */
  displayPrompt: AgentPermissionPrompt | null
}
```

- 選択中のタブが `running` で、能力の `permissionAnswer` が true で、`activity === 'permission'` の間だけ働く（帯に出す条件と同じ `isAgentPermissionAnswerVisible`〈`agentPermissionAnswer.ts`〉で決める）。それ以外は `prompt: null` で、購読もタイマーも持たない
- 働き始めたとき（選択中のタブ・controller・種類・活動が変わった描画）は `useLayoutEffect` で画面を読む（描画の前に反映し、読み取る前の一瞬に理由が出ないように）。以後は `controller.onOutputWritten` とターミナルの大きさの変化の通知 `controller.onResized`（xterm の `onResize`）を同じタイマーで購読し、最後の通知から `AGENT_ACTIVITY_SETTLE_MS`（150ms）後と、最初の未読の通知から `AGENT_ACTIVITY_MAX_WAIT_MS`（500ms）後の早い方で読み直す（`useAgentActivity` と同じ。CLI が 150ms より短い間隔で描き続けても控えが古いままにならないように）。読んだら両方のタイマーを消し、次の通知から数え直す。上限からの読み直しは出力が続いている最中に走り、CLI の描き直しの途中を読みうるため、その画面の活動の判定（`classifyAgentScreenFor`）が `unknown` なら採らない: 控え（`prompt`・`displayPrompt`）を変えず、読み直し待ちも外さず（`onReread` を呼ばない）、上限の起点だけを消して待ちのタイマーを残し、出力が途絶えた後の 150ms の読み直しに任せる（`useAgentActivity` の上限の判定と同じ規則。上限で `null` を控えると、活動は `permission` のまま帯が出ているのに問いが消えてボタンの名前が変わり、読み直し待ちも外れ、次に読めたときに別の確認とみなされて出た直後の猶予が始め直される）（review-loop 第 17 周で足した）。
  大きさの変化をきっかけに足したのは、ターミナルの行を増やすと xterm は出力が無くてもスクロールバックの行（本文の上の端の罫線）を画面へ下ろす（`@xterm/xterm` 6.0.0 の `Buffer.resize` で `ybase--`）が、`claude` は行を増やしただけでは何も描かず（30 → 40 行で 0 バイト。`copilot` は描き直す）、出力の通知だけでは `bodyStartVisible` が偽のまま残り、広げても `許可` を押せなかったため（review-loop 第 34 周で直した）
- 読むたびに `readAgentPermissionPromptFor(kind, lines)`（`agentPermissionPromptReaders.ts`。`classifyAgentScreenFor(kind, lines) === 'permission'` なら `AGENT_PERMISSION_PROMPT_READERS[kind](lines)`、でなければ null）の結果を控える（同じ行で判定と読み取りを行う）。前の値と、照合の項目・`cursorNumber`・`numberKeysAccepted`・`bodyStartVisible` がすべて同じなら state を変えない
- **読み直し待ち**（答えを送ったタブ。「連打の対策」）: 選択中のタブが `isAwaitingReread` の間は、控えがあっても `prompt: null` を返す。前の読み取りで押させないのは、読み直し待ちを含む `isAnswering` が判定の順で先に止めるので、`prompt: null` は判定の順が変わったときの予備（二重の守り）。`displayPrompt` は同じタブの控えをそのまま返す（表示だけに使う。「帯の並び」）。読み直しは、読み直し待ちになった描画から数えて、次の出力の通知の 150ms 後（通知が続けば最初の通知の 500ms 後）か `AGENT_PERMISSION_ANSWER_COOLDOWN_MS` 後の早い方で行い、
  読んだ結果の控えの更新と `onReread(slotId)` を同じコールバックの中で呼ぶ（React が 1 回の描画にまとめるので、読み直し待ちが外れた描画には必ず新しい読み取りが入っている。`画面の選択肢を読み取れませんでした` が一瞬出ることはない）
- 読み直し待ちのタブを**選び直した**描画では、待たずにすぐ読む（下の `useLayoutEffect`）。同じタブのまま読み直し待ちになった描画だけ、次の出力の通知の 150ms 後（通知が続けば最初の通知の 500ms 後）か `AGENT_PERMISSION_ANSWER_COOLDOWN_MS` 後の早い方まで待つ
- 選択中のタブが読み直し待ちで、この hook が働かない状態（許可待ちでない・`running` でない）なら、`useLayoutEffect` ですぐ `onReread(slotId)` を呼ぶ（許可して作業中になったタブで、`中断` の理由が読み直し待ちのまま残らないように）。
  選択中でないタブの読み直し待ちは、そのタブを選んだ描画の `useLayoutEffect` で読む（または働かなければ `onReread` を呼ぶ）ので外れる（読み直し待ちを見るのは、選択中のタブの帯と `中断` だけ）
- `readScreen` が例外を投げたら null を控えて console に記録する（読み直し待ちの間なら `onReread` も呼ぶ。読み取れない理由で押せない）
- 控えは選択中のタブの 1 つだけ（帯は選択中のタブのもの）。タブを切り替えると読み直す。アンマウントで購読とタイマーを消す（L-052）
- state の更新の書き方: `useLayoutEffect`・タイマー・購読のコールバックのどこから読んでも、effect の中で定義したローカル関数（`commit(prompt)`。控えの ref と `isSameAgentPermissionPromptState` で比べて変わったときだけ `setEntry` し、読み直し待ちなら `onReread` も呼ぶ）を通して state を変える。
  effect の本体に `setState` を直に書かない（`eslint-plugin-react-hooks` v7 の `react-hooks/set-state-in-effect` に当たりうるため。既存の `useAgentActivity.ts:112-117` の `commit` と同じ書き方）。読み直し待ちの間に `prompt: null` を返すのは、state を変えずに描画の中で `isAwaitingReread(slotId) ? null : 控え` を返す（effect で null を入れない。`displayPrompt` は常に `控え`。別のタブの控えは使わない）

### 押せるかの判定（renderer の純関数。`lib/agentPermissionAnswer.ts`。新規）

```ts
export const AGENT_PERMISSION_ANSWER_COOLDOWN_MS = 1_000
/** 許可の確認が帯に出てから押せない間(「連打の対策」の出た直後の猶予) */
export const AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS = 1_000

export interface AgentPermissionAnswerAvailabilityInput {
  status: AgentSessionStatus
  cliKind: AgentCliKind
  isClosing: boolean
  activity: AgentActivity
  isSending: boolean
  isSendConfirmOpen: boolean
  /** 対象のタブが中断の流れの間(useAgentInterrupt の isInterruptPending / isInterrupting) */
  isInterrupting: boolean
  /**
   * 対象のタブが、答えを送っている途中か、押してから 1,000ms 以内か、送った後の画面の読み直し待ち(タブごと。3 つの和。
   * useAgentPermissionAnswerCooldown の isPending / isPendingNow)。読み直し待ちを含めるので、読み直す前に prompt が null でも
   * 「読み取れない」ではなく「答えを押した直後です」の理由になる
   */
  isAnswering: boolean
  /** 許可の確認が帯に出た(または別の確認に替わった)描画から 1,000ms 以内(useAgentPermissionAnswerAppearGrace の isJustAppeared / isJustAppearedNow) */
  isJustAppeared: boolean
  /** エージェントのパネルを開いているか(useAgentTerminalPanel の isOpen)。閉じている間は 許可 だけを押せない */
  isPanelOpen: boolean
  /** ターミナルの表示が画面の末尾にあるか(描画は useAgentTerminalScrolledToBottom、押した時点は controller.isScrolledToBottom())。偽の間は 許可 だけを押せない */
  isScrolledToBottom: boolean
  /** 描画に使った読み取り(useAgentPermissionPrompt の prompt) */
  prompt: AgentPermissionPrompt | null
}

export interface AgentPermissionAnswerAvailability {
  /** 帯に出すか(running・能力あり・permission) */
  visible: boolean
  /** 押せない理由。押せるなら null(送る選択肢は返さない。送る番号は押した時点の判定の結果だけ) */
  reason: string | null
}

export function getAgentPermissionAnswerAvailability(
  input: AgentPermissionAnswerAvailabilityInput,
  choice: AgentPermissionChoice
): AgentPermissionAnswerAvailability
```

- 出さない（`visible: false`）: `status` が `running` でない（`starting` の間は活動が `unknown` なので許可待ちにならない）・能力が無い・活動が `permission` でない。理由はそれぞれ「押せない理由の文言」の帯に出さない行（押した処理の判定でも同じ関数を使うため）
- 出すときは表の順（閉じる途中 → 送信中 → 確認の表示中 → 中断の流れの間 → 答えた直後〈`isAnswering`。読み直し待ちを含む〉 → 読み取れない〈`prompt` が null〉 → 番号キーが効かない → その選択肢が無い → パネルを閉じている〈`isPanelOpen` が偽。`許可` だけ〉 → ターミナルを上へスクロールしている〈`isScrolledToBottom` が偽。`許可` だけ〉 → 本文の上の端が画面に無い〈`prompt.bodyStartVisible` が偽。`許可` だけ〉 → 許可の確認が出た直後〈`isJustAppeared`〉）で最初に当たった理由。どれにも当たらなければ `reason: null`。送る選択肢は返さない（refactor-srp 第 11 周で `option` を外した。描画からは使われず、押した時点の判定の番号と取り違えうるため）
- 答えた直後を、確認が出た直後より先に見る（答えた後に続けて出た確認では「答えを押した直後です」のほうが利用者に役立つため）。確認が出た直後は「それさえ無ければ押せる」ときだけ出す理由なので、読み取りに依る理由（読み取れない・番号キーが効かない・その選択肢が無い）の後に見る。先に見ると、`copilot` で `拒否` の後（`claude` で `Tab` を押した後も）入力欄に文字を打つたびに最後の選択肢の文言が替わって別の確認として猶予が始め直され、待っても押せない本来の理由（「代わりにしてほしいことの入力を待っています…」など）が「少し待つと押せます」で隠れるため（review-loop 第 11 周で直した）。押した時点の段階 (a) も同じ関数なので同じ順で止まる
- パネルを閉じている間（`isPanelOpen` が偽）は `許可` だけを押せない（review-loop 第 27 周で足した）。閉じている間はターミナル本体が隠れ（`hidden`）、許可する内容（コマンドなど）は本文にしかなく帯には問いの 1 行目だけなので、通知で気づいて帯の `許可` を押すと、コマンドを見ないまま `Yes` が送られるため。`拒否` は実行されない側なので押せる。帯には出したままにする（許可待ちであることは知らせる）。読み取りに依る理由の後に見るのは、パネルを開いても押せない理由を隠さないため。確認が出た直後より先に見るのは、待っても解けない理由を「少し待つと押せます」で隠さないため。押した時点は `useLatestRef` の最新の値（`isPanelOpen`）を同じ写像に入れる
- ターミナルを上へスクロールしている間（`isScrolledToBottom` が偽）は `許可` だけを押せない（review-loop 第 31 周で足した）。許可の確認は画面の末尾に描かれ、読み取り（`readScreen`）は利用者のスクロールに左右されないので、`claude`（通常の画面に描く）の前の出力を読み返している間に確認が出ると、本文が見えないまま `Yes` を送れたため。`拒否` は実行されない側なので押せる。帯には出したままにする。パネルを閉じている理由の次に見るのは、閉じている間はまず開いてもらうため。本文の上の端が画面に無い理由より先に見るのは、末尾へ戻した後の高さで決まるため。確認が出た直後より先に見るのは、待っても解けない理由を「少し待つと押せます」で隠さないため。描画の値は `useAgentTerminalScrolledToBottom`（`useSyncExternalStore` で controller の `onScroll`・`onOutputWritten`・`onResized` を購読し〈行を増やすと xterm はスクロールの通知を出さずに表示の位置と末尾を動かしうる。review-loop 第 34 周で `onResized` を足した〉、`isScrolledToBottom()` を読み直す。タイマーは持たない）、押した時点の値は段階 (a) の入力に controller の `isScrolledToBottom()` を直接読んで入れる（描画の値は通知の後の再描画までずれうるため）
- 本文の上の端が画面に無い間（描画の読み取りの `bodyStartVisible` が偽）は `許可` だけを押せない（review-loop 第 28 周で足した）。本文の上の端が無いと読み取りは画面の先頭からを本文として読むので、本文が欠けても読み取りは null にならず、描画と押した時点の照合も欠けた本文どうしで一致するため。`拒否` は実行されない側なので押せる。帯には出したままにする。パネルを閉じている理由の次に見るのは、閉じている間はまず開いてもらうため（開いた後の高さで決まる）。確認が出た直後より先に見るのは、待っても解けない理由を「少し待つと押せます」で隠さないため。押した時点は、段階 (f) の後で、押した時点で読み直した読み取りの値を見る（下の (f')）
- 判定の入力は、描画と押した処理で同じ写像 `toAgentPermissionAnswerAvailabilityInput`（`useAgentPermissionAnswer.ts`）で組み立てる（L-058。中断と同じ）。待ちの値（中断の流れ・答えた直後・確認が出た直後）は、描画が state、押した処理が ref を渡す。パネルの開閉（`isPanelOpen`。`useAgentWorkspace` が `useAgentTerminalPanel` の `isOpen` を渡す）は答えの hook の引数に入れ、押した処理は最新の値の ref から読む。ターミナルのスクロール（`isScrolledToBottom`）は答えの hook が選択中のタブの controller から読み、写像の第 2 引数で渡す（描画は `useAgentTerminalScrolledToBottom`、押した処理は `controller.isScrolledToBottom()`）

押した時点の判定のやり直し:

```ts
export type AgentPermissionAnswerPressCheck =
  | { kind: 'send'; optionNumber: number }
  | { kind: 'blocked'; reason: string }
  /** 画面を読めない(送らず、読み上げもしない。呼び出し側が console に記録する) */
  | { kind: 'unreadable'; error: unknown }

export function checkAgentPermissionAnswerAtPress(
  input: AgentPermissionAnswerAvailabilityInput,
  choice: AgentPermissionChoice,
  readScreen: () => readonly ViewportLine[]
): AgentPermissionAnswerPressCheck
```

段階は「押したときの処理」の手順の番号と紛れないよう、(a)〜(g) で書く（(f') は review-loop 第 28 周で足した）。

- (a) 可否: `getAgentPermissionAnswerAvailability(input, choice)` に理由があれば `blocked`（画面は読まない）。`input.isScrolledToBottom` は押した時点で controller から直接読んだ値
- (b) 画面の読み直し: `readScreen()` を 1 回だけ呼び、その行で `classifyAgentScreenFor(cliKind, lines)` が `permission` でなければ `blocked`（許可待ちでなくなった）。例外なら `unreadable`
- (c) 同じ行を `AGENT_PERMISSION_PROMPT_READERS[cliKind]` で読み、null なら `blocked`（読み取れない）
- (d) 押した時点の `numberKeysAccepted` が偽なら `blocked`（番号キーが効かない）。照合より先に見る: `claude` で `Tab` を押して `Yes`・`No` を入力の形にした画面や、`copilot` でカーソルを最後の選択肢へ動かした画面は、選択肢の文言も変わりうるが、
  利用者に役立つのは「入力欄が開いている」ほうの理由のため（描画の読み取りも 150ms 後に同じ理由になる）
- (e) `isSameAgentPermissionPrompt(input.prompt, pressed)` が偽なら `blocked`（内容が変わった）
- (f) 押した時点の `findAgentPermissionOption(pressed, choice)` が null なら `blocked`（その選択肢が無い）
- (f') `許可` で、押した時点の `pressed.bodyStartVisible` が偽なら `blocked`（本文の上の端が画面に無い）。照合（段階 (e)）は `bodyStartVisible` を比べないので、描画では端が見えていて押す前に罫線だけが画面から流れた（本文は同じ）画面もここで止める。理由は描画の判定と同じ関数（`bodyReasonOf`）で決める
- (g) `send`。送る番号は**この結果の `optionNumber` だけ**を使う（押した時点の選択肢の番号。照合を通ったので描画のものと同じ）。名前（`aria-label`）の番号は表示の値（`toAgentPermissionAnswerButtonState`）が描画の読み取りから `findAgentPermissionOption` で引き、送る値には使わない

### 押したときの処理（renderer。`hooks/useAgentPermissionAnswer.ts`。新規）

`useAgentWorkspace` が選択中のタブ・活動・描画の読み取り・送信中・確認の表示中・中断の流れの間・待ちの控え（`useAgentPermissionAnswerCooldown` の戻り値。「useAgentWorkspace での組み立ての順」）・出た直後の猶予（`useAgentPermissionAnswerAppearGrace` の戻り値）を渡し、結果を `AgentTerminalPanelState.permissionAnswer`（必須。L-060）に載せる。

```ts
// 表示の値(lib/agentPermissionAnswerView.ts。toAgentPermissionAnswerQuestion・toAgentPermissionAnswerButtonState が作り、この hook は呼ぶだけ)
export interface AgentPermissionAnswerButtonState {
  /** 押せない理由。押せるなら null */
  disabledReason: string | null
  ariaLabel: string
}

export interface AgentPermissionAnswerPanelState {
  /** 出すか */
  visible: boolean
  /** 問いの 1 行目と全文(読み取れないなら null) */
  question: { firstLine: string; full: string } | null
  allow: AgentPermissionAnswerButtonState
  deny: AgentPermissionAnswerButtonState
  /** 送れたとき・押せない状態で押したときの読み上げ(3,000ms で null) */
  notice: Announcement | null
  /** 押したとき。押せないときは何もしない(理由を読み上げる) */
  onAnswer: (choice: AgentPermissionChoice) => void
}
```

答えの流れの間（中断の押せない理由に使う値）は、この hook の戻り値には載せない。`useAgentWorkspace` が先に作る `useAgentPermissionAnswerCooldown` の `isPending`（描画用）と `isPendingNow`（押した時点用）を、中断の hook と答えの hook の両方へ渡す（「useAgentWorkspace での組み立ての順」）。

`onAnswer(choice)` の手順（1〜6 の通し番号。ほかの節の「手順 N」はこの番号を指す）:

1. 同期の再入の防止: 押した時点の選択中のタブの `slotId` が送っている途中の ref（`cooldown.isInFlight`。`Set<slotId>`）にあれば何もしない（state は次の描画まで変わらないため ref。L-101・L-653）
2. 押した時点の判定: `checkAgentPermissionAnswerAtPress` を**丸ごと 1 回**呼ぶ。入力は最新の値（`useLatestRef` で控えた選択中のタブ・活動・描画の読み取り・送信中・確認の表示中、ref の `isInterrupting(slotId)`・`cooldown.isPendingNow(slotId)`・`appearGrace.isJustAppearedNow()`）から `toAgentPermissionAnswerAvailabilityInput` で作る。
   関数の中で段階 (a)（描画と同じ `getAgentPermissionAnswerAvailability`。L-058）と段階 (b)〜(f)（画面の読み直し）を順に行う（描画で求めた可否を中でもう一度求めるのは許容する。hook の側で可否を別に求めない）。`blocked` は理由を読み上げて終え、`unreadable` は console に記録して終える（どちらも IPC は呼ばない）
3. `cooldown.begin(slotId)`: 送っている途中・1,000ms の待ち・読み直し待ちの 3 つを同時に始める（読み直し待ちになった描画で `useAgentPermissionPrompt` が前の読み取りを捨てる）
4. `sessions.answerPermission(slotId, check.optionNumber)` を待つ
5. 結果が `sent` なら「読み上げ」の文言を読み上げる。`stale`・`skipped` は何も出さない。失敗は `useAgentSessions` がタブの `error` に出している
6. `finally` で `cooldown.finish(slotId)`（送っている途中だけを解く。例外でも固まらない。L-053）。1,000ms の待ちはタイマーが、読み直し待ちは `useAgentPermissionPrompt` の `onReread`（`markReread`）が外す

`useAgentPermissionAnswerCooldown`（新規）は、タブごとに次の 3 つを ref（押した時点用）と state（描画用）の両方で持つ。アンマウントでタイマーをすべて消す（L-052）。作りは `useAgentInterruptCooldown` と同じで、`restartCooldown` は持たない。

```ts
export interface AgentPermissionAnswerCooldown {
  /** 描画用(state): 送っている途中・1,000ms・読み直し待ちのどれか。答えと中断の押せない理由に使う */
  isPending: (slotId: string) => boolean
  /** 押した時点用(ref。参照は安定): isPending と同じ間 */
  isPendingNow: (slotId: string) => boolean
  /** 押した時点用(ref): 送っている途中(同期の再入の防止) */
  isInFlight: (slotId: string) => boolean
  /** 描画用(state): 送った後の画面の読み直し待ち(useAgentPermissionPrompt が見る) */
  isAwaitingReread: (slotId: string) => boolean
  /** 送り始める: 3 つを同時に始める(1,000ms のタイマーは数え直す) */
  begin: (slotId: string) => void
  /** 結果が届いた(例外を含む): 送っている途中だけを解く */
  finish: (slotId: string) => void
  /** 送った後の画面を読み直した(または読む必要が無くなった): 読み直し待ちを解く。待ちでなければ何もしない */
  markReread: (slotId: string) => void
}
```

待ちが明けるのは、1,000ms が過ぎ、かつ読み直しが済んだ後（`isPending` は 3 つの和）。CLI が何も描き直さなくても、`useAgentPermissionPrompt` が 1,000ms 後に読み直すので待ちは外れる。読み直しの控えの更新と `markReread` は同じコールバックで行うので、待ちが外れた描画で読み取りが null のまま理由が「読み取れない」に一瞬変わることはない（`useAgentPermissionPrompt` の「読み直し待ち」）。

`useAgentSessions.answerPermission(slotId, optionNumber): Promise<AgentPermissionAnswerOutcome>`（`interrupt` と同じ層。sessionId の持ち主のため）:

```ts
export type AgentPermissionAnswerOutcome =
  | { kind: 'sent' }
  | { kind: 'skipped' } // そのタブにセッションが無い(IPC を呼ばない)
  | { kind: 'stale' } // 結果が届いた時点で、そのタブの sessionId が送った値と違う
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
  | { kind: 'error'; message: string } // invoke の拒否・同期の例外
```

- `sessionIdBySlotRef` から押した時点の `sessionId` を、最初の `await` より前に控える（L-093）。無ければ `skipped`
- 中断と同じ `invokeForCurrentSession`（`lib/agentInterruptInvocation.ts`。既存）で `agentTerminalApi.answerAgentPermission(id, optionNumber)` を呼ぶ（中で `Promise.resolve().then(call)` にするので、同期の例外も拒否と同じ経路。L-055）
- 結果が届いたら（拒否でも）、そのタブの今の `sessionId` が控えた値と同じかを確かめ、違えば `stale`（古いセッションの結果を今のタブに出さない。L-037・L-040。照合の関数を `invokeForCurrentSession` に渡す）
- `no-session`・`write-failed`・`error` は、そのタブの `error` に「エラー処理」の文言を出して返す。`sent` は、そのタブの `error` が答えの失敗の文言（`AGENT_PERMISSION_ANSWER_ERROR_PREFIX` で始まる）なら消して返す

### 中断の押せる条件の追加（`lib/agentInterrupt.ts`）

`AgentInterruptAvailabilityInput` に `isAnsweringPermission: boolean` を足し、`blockedReasonOf` の `isInterrupting` の直後・活動の前に `許可の答えを押した直後は中断できません（少し待つと押せます）` を足す（`agentInterruptMessages.ts`）。
描画は `answerCooldown.isPending(slotId)`、押した処理は `answerCooldown.isPendingNow(slotId)` を渡す（`useAgentInterrupt` の `UseAgentInterruptOptions` に `isAnsweringPermission`〈state の関数〉と `isAnsweringPermissionNow`〈ref の関数〉を必須で足す。L-060）。理由: 答えを押した直後は、CLI が数字を受け取って描き直すまでの間の画面と、許可して作業中になった画面のどちらも読みうる。
許可の直後に次の許可の確認が出ると、`Esc` は許可の拒否・操作の取り消しになる（押した時点の読み直しは `permission` なら止めるが、読み直してから CLI が `Esc` を受け取るまでの隙間をこの待ちで狭める）。

### useAgentWorkspace での組み立ての順

中断の hook と答えの hook は互いの「流れの間」を使う。中断の hook は描画の中で `getAgentInterruptAvailability` を求める（`useAgentInterrupt.ts:136`）ので、後で作る hook の値を effect で ref に写す方法（1 描画遅れる）や、描画の中で ref を読む方法（`eslint-plugin-react-hooks` の `react-hooks/refs` に当たりうる）は使わない。次の順に作る。

1. `const answerCooldown = useAgentPermissionAnswerCooldown()`（中断の hook と答えの hook の両方より先）
2. `useAgentInterrupt({ …, isAnsweringPermission: answerCooldown.isPending, isAnsweringPermissionNow: answerCooldown.isPendingNow })`。描画は state の関数、押した処理は ref の関数を読む（同じ描画の値が届く）
3. `useAgentPermissionPrompt({ selected, activity, isAwaitingReread: answerCooldown.isAwaitingReread, onReread: answerCooldown.markReread })`
4. `const appearGrace = useAgentPermissionAnswerAppearGrace({ slotId, visible: isAgentPermissionAnswerVisible(…), prompt: displayPrompt })`（出た直後の猶予。「連打の対策」）
5. `useAgentPermissionAnswer({ …, prompt, displayPrompt, isInterruptPending: agentInterrupt.isInterruptPending, isInterrupting: agentInterrupt.isInterrupting, cooldown: answerCooldown, appearGrace })`。中断の値は先に作った中断の hook の戻り値をそのまま使う（描画は state、押した処理は ref）

この順なら、どちらの hook も同じ描画の値で判定し、ref の写しを足さない。

### IPC

| 層                                                    | 追加                                                                                                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shared（`src/shared/types/agentTerminal.ts`）         | `export type AgentPermissionAnswerResult = { kind: 'sent' } \| { kind: 'no-session' } \| { kind: 'write-failed' }`                                                                                                  |
| shared（`src/shared/agentPermissionAnswer.ts`。新規） | `AGENT_PERMISSION_OPTION_NUMBER_MAX = 9`・`type AgentPermissionOptionNumber = 1 \| 2 \| … \| 9`・`isAgentPermissionOptionNumber(value: unknown): value is AgentPermissionOptionNumber`（`Number.isInteger` と範囲） |
| preload（`api.ts`・`index.d.ts`）                     | `answerAgentPermission: (sessionId: string, optionNumber: number): Promise<AgentPermissionAnswerResult> => ipcRenderer.invoke('agentTerminal:answerPermission', sessionId, optionNumber)`                           |
| renderer（`lib/agentTerminalApi.ts`）                 | `answerAgentPermission(sessionId, optionNumber)`                                                                                                                                                                    |

`invoke` にする理由: 書けたか・セッションが無かったかを呼び出し元へ返すため（L-001。中断と同じ）。

### main

受け口（`handlers/agentTerminalHandlers.ts`）:

```ts
ipcMain.handle(
  'agentTerminal:answerPermission',
  (
    event: IpcMainInvokeEvent,
    sessionId: unknown,
    optionNumber: unknown
  ): AgentPermissionAnswerResult => {
    if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
    return registry.answerPermission(
      event.sender.id,
      parseAgentSessionId(sessionId),
      parseAgentPermissionOptionNumber(optionNumber)
    )
  }
)
```

- `parseAgentPermissionOptionNumber`（`agentTerminalPayloadParser.ts`）は `isAgentPermissionOptionNumber` が偽なら例外を投げる（`invoke` の拒否。`0`・`10`・`1.5`・`-1`・`NaN`・`Infinity`・`'1'`・`null`・`undefined` を拒否する。L-019）
- `AgentTerminalHandlerDeps.registry` の `Pick` に `'answerPermission'` を足す

registry（`agentSessionRegistry.ts`）:

```ts
/** sessionId が所有者のいずれかの枠の現在のセッションと一致するときだけ書く(write・interrupt と同じ照合) */
answerPermission(ownerId: number, sessionId: string, optionNumber: AgentPermissionOptionNumber): AgentPermissionAnswerResult
```

- 照合は `findBySessionId`（所有者 = `event.sender.id`、現在のセッションの id と一致。停止中・別のウィンドウ・起動し直す前の id は `no-session`。L-037）。セッションの `not-alive` は `no-session` に写す

`AgentSession`（`agentSession.ts`）:

```ts
/** 選択肢の番号キー(ターミナルで数字を 1 回押すのと同じ)。renderer の値は表を引く鍵にだけ使い、書くのは表の固定の 1 バイト */
export const AGENT_PERMISSION_ANSWER_KEYS: Record<AgentPermissionOptionNumber, string> = {
  1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9'
}

export type AgentSessionPermissionAnswerResult = 'sent' | 'not-alive' | 'write-failed'

answerPermission(optionNumber: AgentPermissionOptionNumber): AgentSessionPermissionAnswerResult
```

- 終了の後・停止の途中（`stop` の後）は書かずに `not-alive`。`pty.write` の例外は握って `write-failed`（受け口から投げない。L-053）
- CLI の反応（画面の変化）は待たない（`pty.write` は同期で返る。L-052）
- main は画面を読まないので、送る番号が `Yes`・`No` の選択肢かは確かめられない（renderer の読み取りで確かめる）。乗っ取られた renderer は既存の `agentTerminal:write` で任意の打鍵を送れるので、この IPC は守りを広げるものではない。renderer の値を書くバイトに直接使わない作り（L-019）を、中断と同じ形で保つためのもの

## エラー処理

| 場面                                                           | main の結果     | renderer の扱い                                                                                                                    |
| -------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 押した時点でタブにセッションが無い                             | （呼ばない）    | `skipped`。何も出さない                                                                                                            |
| セッションが終わっていた・世代が変わった                       | `no-session`    | タブの `sessionId` が同じなら `許可の答えを送れませんでした: claude が終了したか、起動し直しました`。違えば `stale` で何も出さない |
| pty への書き込みが例外                                         | `write-failed`  | `許可の答えを送れませんでした: ターミナルへの書き込みに失敗しました`                                                               |
| メインフレーム以外・不正な `sessionId`・不正な番号・IPC の失敗 | `invoke` の拒否 | `許可の答えを送れませんでした: <例外の message>`                                                                                   |
| `window.api` の呼び出しが同期で例外                            | —               | 同上（L-055）                                                                                                                      |
| 押した時点の読み直しで許可待ちでない・変わった・読めない       | （呼ばない）    | 理由を読み上げる。`readScreen` の例外は何も送らず console に記録                                                                   |

失敗の文言の接頭辞は `AGENT_PERMISSION_ANSWER_ERROR_PREFIX = '許可の答えを送れませんでした: '`（`AGENT_INTERRUPT_ERROR_PREFIX` と同じ形）。結果が届いた時点で別のタブを選んでいても、文言は送ったタブの `error` に出す。

## 連打の対策

| 対策                         | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1,000ms の待ち               | 押してから 1,000ms（`AGENT_PERMISSION_ANSWER_COOLDOWN_MS`）は、そのタブの `許可`・`拒否` の両方を押せない。`claude` は許可した直後に次のツールの許可の確認を出すことがあり、その問い・選択肢・本文が前と同じ（同じコマンドの 2 回目）なら照合を通るため、2 回目のタップが読んでいない許可の確認に答えるのを防ぐ。値は中断と同じ 1,000ms（2 回のタップの間隔としては十分に長く、許可の確認を読んでから押すまでの時間より短い）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 読み取りの捨て直し           | 送ったら読み直し待ちにし（`cooldown.begin`）、送った後の画面を読み直すまで押せない（理由は答えた直後と同じ文言。読み直し待ちは `isAnswering` に含む）。CLI が描き直さなくても 1,000ms 後に読み直し、その結果で判定する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 同期の再入の防止             | 送っている途中の ref（`Set<slotId>`）で、同じタブの IPC の結果を待つ間の 2 回目を止める（L-101・L-653）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ダブルクリック・ダブルタップ | `click` の `event.detail > 1` を無視する（キーボードのクリックは `detail` が 0。L-408）。帯の `終了`・`起動`・`前回の続きから` とタブ列の `+`・`×` も同じ（狭い幅で帯がはみ出すと、ボタンが消えて詰まった帯の `終了` に 2 回目が届いて確認なしに会話を失う、またはタブ列が伸びて `+` に届いて新しい CLI が起動し選択が移るため。帯のボタンは右寄せで、止まると `終了` が `起動` に替わってその右に `前回の続きから` が足されるので、`終了` のあった位置に `前回の続きから` が出る。止まるのが速いと `終了` のダブルクリックの 2 回目が届いて、止めたばかりのセッションを再開するため。タブ 1 つで `+` を押すと、描き直しの後に `+` のあった位置へ `claude 1` の `×` が出る。タブ 3 つ以上で `×` を押すと、詰まった隣のタブの `×` が来る。どちらも 2 回目が届くと止まっているタブを確認なしに閉じるため。`×` はマウス専用（`tabIndex` が -1）で、キーボードは `Delete` で閉じるので影響しない。`起動` は `終了`・`+` とそろえる）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 出た直後の猶予               | 許可の確認が帯に出た描画（選択中のタブで `visible` が偽から真になった描画・許可待ちの別のタブを選んだ描画）と、表示用の読み取り（`displayPrompt`）が別の確認に替わった描画（読み取れない → 読み取れた を含む。カーソルや番号キーの効き方だけの変化は替わりにしない）から 1,000ms（`AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS`）は、`許可`・`拒否` の両方を押せない（`useAgentPermissionAnswerAppearGrace`。`useAgentWorkspace` が作って答えの hook へ渡す）。`許可`・`拒否` は利用者の操作ではなく CLI の出力をきっかけに `中断` の直前へ挿し込まれ、幅が足りず帯の要素が縮んでいるとき（帯があふれる幅、または記録があって `変更を確認` が縮む〈文字が省略される〉幅）（帯の header は `overflow: hidden` で左詰め。`変更を確認` は状態の文言より先に縮む（flex-shrink 10））では `中断`・`終了` が右へずれて、`中断` のあった位置に `許可`、`終了` のあった位置に `拒否` が来る。ほかの対策はどれも「自分が押した後」の守りで、`中断` を押そうとした 1 回目のクリック（`detail` が 1）がちょうど出た `許可` に届くと、押した時点の照合も通って `Yes` が送られる（止めたかったコマンドが実行され、戻せない）ため。猶予は `useLayoutEffect` で始め、出た描画が画面に出る前に state（描画用）と ref（押した処理用。`isJustAppearedNow`）の両方を立てる。押した処理は ref で止める（中断の `isAnsweringPermissionNow` と同じ形）。描画と押した処理で同じ写像 `toAgentPermissionAnswerAvailabilityInput` に入れる（L-058）。タイマーはアンマウントで消す。キーボードでは、許可の確認が出てもフォーカスは `許可` へ自動で移らないので、位置ずれの影響は受けない。前の確認に答えてフォーカスが `許可` に残ったまま別の確認が出たときは、1 秒以内の `Enter` も止まる（読んでいない確認に即答しない守り。既知の制約に書く）（review-loop 第 10 周で足し、第 11 周でキーボードの記述を直した） |
| キーリピート                 | ボタンの `keydown` で `event.repeat` の `Enter`・`Space` を `preventDefault` する（L-408）。ボタンが消えた後の移し先の開閉のボタンも同じ                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

待ち・フォーカスを押したボタンに残すこと（`aria-disabled`）・ボタンが消えたときの移し先を開閉のボタンにすること・リピートとダブルクリックの抑止は組で働く（どれかを外すと、押し続けた `Enter` が次の許可の確認に答える、または移った先の `中断`・`終了` を押す）。実装のコメントに組であることを書く（L-408）。

2 回目を止めないボタンと、2 回目を捨てるボタンで続けて押したいときのことは「既知の制約」に書く。

## 既存の機能との関係

### 新しい状態と既存の入口（L-061）

新しい状態は「許可の答えを送っている途中・押してから 1,000ms 以内・送った後の画面を読み直す前」（タブごと）。`preload/api.ts` の `agentTerminal:*` と帯・送信の入口を列挙して扱いを決めた。

| 入口                                                           | 答えの待ちの間   | 理由                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 帯の `中断`（`agentTerminal:interrupt`）                       | 拒否する         | 「中断の押せる条件の追加」                                                                                                                                                                                                                          |
| 帯の `許可`・`拒否`（同じタブ）                                | 拒否する         | 連打の対策                                                                                                                                                                                                                                          |
| プロンプトの `実行`・履歴の `再実行`・送信前の確認からの送信   | 許す（変えない） | `copilot` は送信が入力待ちを求める（`requiresIdle`）ので許可待ちの間は送れない。`claude` は答えた後の作業中・入力待ちへ送るのは普通の操作で、送信の手順は数字を含まない。答えを送る IPC は 1 回の同期の書き込みで、送信の手順の書き込みと混ざらない |
| ターミナルのキー入力（`writeAgentSession`）                    | 許す（変えない） | 利用者の打鍵は利用者の操作（「既知の制約」）                                                                                                                                                                                                        |
| `終了`（`agentTerminal:stop`）                                 | 許す             | 止めた後の答えの結果は `no-session`／`stale`                                                                                                                                                                                                        |
| タブの選択・`+`・`×`・`前回の続きから`・`このセッションで再開` | 許す             | 待ちはタブごと。閉じたタブ・起動し直したタブの結果は `stale` で捨てる                                                                                                                                                                               |
| 実行方式・フォルダ・使う CLI の切り替え                        | 許す（変えない） | セッションを止めるので結果は `stale`                                                                                                                                                                                                                |
| リサイズ・作業中の知らせ（`reportWorking*`）・hooks            | 影響しない       | 答えは知らせない                                                                                                                                                                                                                                    |

逆に、答えられないのは「押せない理由」の表の状態。送信中に答えられないのは、送信の手順の間は controller が利用者の打鍵を溜めている（`beginSending`）のに対し、答えは別の IPC で溜めずに届くため、消去・貼り付けの途中に数字が割り込む経路を作らないため。
中断の流れの間に答えられないのは、`copilot` の中断の 1 回目の `Esc` の後に許可の確認が出たとき、2 回目の確かめの最中に数字を送ると、`Esc` との組み合わせの結果が読めなくなるため。

### 活動の判定・通知・読み上げ・ステータスバー

- 活動の判定（`classifyClaudeScreen`・`classifyCopilotScreen`）の結果は変えない。位置の特定を関数に切り出すだけ（判定の既存のテストがそのまま通ること）
- 完了・許可待ちの通知（`useAgentNotifications`）は変えない。許可して作業中になると、既存の規則で「待っている状態が終わった」としてバッジが減る。拒否して入力待ちになったときも同じ（`permission → idle` は完了として知らせない。既存）
- App の常設の読み上げ（`AgentAnnouncer`）は変えない。帯の答えの読み上げは帯の中の要素で行う
- ステータスバーのまとめ・タブの印は変えない

### エージェントの変更の確認

答えはターミナルで番号キーを押すのと同じバイトなので、hooks から見て区別できない。区間の追跡（`UserPromptSubmit`・`Stop`）は今までどおり CLI の hooks で働く。アプリは答えを main の区間の追跡に知らせない。

### 従来の方式

ターミナルパネルが出ないので、帯の答えも出ない。

## テスト方針

vitest + `@testing-library/react`。renderer の hook・部品は偽の controller（`__tests__/makeFakeAgentTerminal.ts` の `makeFakeController`。`screen` に記録した画面を入れる）と `window.api` の偽物で確かめる。

- 読み取りの純関数（`claudePermissionPrompt.test.ts`・`copilotPermissionPrompt.test.ts`・`agentPermissionPrompt.test.ts`・`agentPermissionPromptReaders.test.ts`〈種類ごとの表と `readAgentPermissionPromptFor`〉）
  - 「台帳での読み取りの期待」の表を実画面で固定する（問い・本文・選択肢の番号と文言・カーソル・番号キー・`許可`・`拒否` の番号）。両方の台帳の、読み取れたすべての画面（`claude` の `permission`・`permissionAfterClear`、`copilot` の `permission` 系・`sr` 系）で `bodyStartVisible` が真（`copilot` の読み上げのモードは内側のコマンドの枠の `╭` が端になる）
  - 両方の台帳のすべての画面で、読み取りが null でないことと活動の判定が `permission` であることが一致する
  - 手書きの画面: `claude` の問いの 2 行の折り返し・カーソルが 2 番（`Tab to amend` なし。番号キーが効かない）・カーソルが 1 番で `Tab to amend` なし（入力の形。効かない）・選択肢が 10（null）・番号が欠ける（null）・カーソルが 2 つ（null）・`Yes` が 2 つ（`許可` は null）・`No` が無い（`拒否` は null）・`Nothing` で始まる選択肢（`拒否` にしない）。
    `copilot` の選択肢の折り返し・問いの折り返し・入力欄に文を入れた最後の選択肢（文言が `No` で始まらない）。
    本文の上の端（`claude` の全幅の罫線・`copilot` の行頭の `╭`）が画面に無い画面は、画面の先頭からを本文として読み `bodyStartVisible` が偽（端がある手書きの画面は真）
  - `isSameAgentPermissionPrompt`: `permission` と `permissionAfterClear` は同じ。本文の 1 行（コマンド）・問い・選択肢の文言・番号のどれかを変えると違う。件数が同じで文言が入れ替わると違う（L-036）。カーソルだけが違う `permission` と `permissionDown`（`copilot`）は同じ。`cursorNumber`・`numberKeysAccepted`・`bodyStartVisible` だけが違えば同じ。`isSameAgentPermissionPromptState` はこの 3 つのどれかが違えば違う
  - 切り出した `locateClaudePermissionPrompt`・`locateCopilotPermissionQuestion` で、既存の `claudeScreenActivity.test.ts`・`copilotScreenActivity.test.ts` がそのまま通る
- 押せるかの純関数（`agentPermissionAnswer.test.ts`）: 状態（4 つ）× 活動（5 つ）× 能力 × 閉じる途中・送信中・確認の表示中・中断の流れ・答えた直後・読み取りの有無・番号キー・選択肢の有無の表で、`visible` と理由の順と文言を固定する（送る選択肢は押した時点の判定のテストで固定する）。確認が出た直後は、ほかの理由のどれにも当たらないときだけの理由であること（`copilot` の入力欄が開いた読み取り〈`numberKeysAccepted: false`〉で `isJustAppeared: true` なら番号キーが効かない理由。押した時点の段階 (a) も同じ）を固定する。
  パネルの開閉: `許可` だけ止まり `拒否` は止まらない・帯には出す・読み取りに依る理由の後・確認が出た直後の前・押した時点の段階 (a) で画面を読まない（review-loop 第 27 周）。
  本文の上の端が画面に無い（描画の読み取りの `bodyStartVisible` が偽）: `許可` だけ止まり `拒否` は止まらない・帯には出す・フラグの理由・番号キーが効かない・その選択肢が無い・パネルを閉じている の後・確認が出た直後の前・押した時点の段階 (a) で画面を読まない（review-loop 第 28 周）。
  ターミナルを上へスクロールしている（`isScrolledToBottom` が偽）: `許可` だけ止まり `拒否` は止まらない・帯には出す・フラグの理由・読み取りに依る理由・パネルを閉じている の後・本文の上の端が画面に無い・確認が出た直後の前・押した時点の段階 (a) で画面を読まない。`@xterm/headless` の実物のバッファに台帳の画面を前の出力の後に描き、`scrollLines(-3)` した状態で `許可` は `blocked`・`拒否` は `send`、`scrollToBottom()` で `許可` も `send`。`copilot`（代替画面）は `scrollLines(-3)` しても末尾のままで `send`（review-loop 第 31 周）。`agentViewport.test.ts` で `isViewportAtBottom`（スクロールした間は偽・出力が増えても偽のまま・末尾へ戻すと真・代替画面は真）、`agentTerminalController.test.ts` で `isScrolledToBottom`・`onScroll`（解除・`dispose` で xterm の購読を外す）、`useAgentTerminalScrolledToBottom.test.ts` で最初の値・スクロールと出力と大きさの変化の通知での読み直し・controller の替わりと外したときの購読の後始末。`agentTerminalController.test.ts` で `onResized`（xterm の `onResize` で呼ぶ・解除・`dispose` で xterm の購読を外す。review-loop 第 34 周）。
  `checkAgentPermissionAnswerAtPress`: 段階 (a) で止まれば画面を読まない（`readScreen` が呼ばれない）・`readScreen` は 1 回だけ・読み直しで `permission` でない・内容が変わった（本文だけ変えた画面）・押した時点だけ番号キーが効かない（描画は `permission`、押した時点は `permissionDown`）・`claude` で `Tab` を押して `Yes` を入力の形にした手書きの画面（文言が変わり、`Tab to amend` が消える）は「内容が変わった」ではなく「番号キーが効かない」になる（段階 (d) が段階 (e) の照合より先）・例外で `unreadable`・`send` の番号（押した時点の選択肢のもの）・段階 (f')（描画は罫線が 1 行目の手書きの画面、押した時点は 1 行流れて罫線だけが消えた画面〈本文は同じ〉で、`許可` は本文が欠けている理由で `blocked`・`拒否` は `send`・押した時点も罫線が見えていれば `許可` を `send`）
- 表示の値（`agentPermissionAnswerView.test.ts`）: 問いの 1 行目と全文・押せない理由があってもボタンの名前を変えない・読み取れない／その選択肢が無いときの名前・名前の問いが全文と同じ（折り返した 2 行目も入る）
- 番号の検証（`shared/__tests__/agentPermissionAnswer.test.ts`）: `AGENT_PERMISSION_OPTION_NUMBER_MAX` が 9・`isAgentPermissionOptionNumber` が 1〜9 の整数だけを通す（`0`・`10`・`1.5`・`-1`・`NaN`・`Infinity`・`'1'`・`null`・`undefined` などは偽）
- 能力の表（`shared/__tests__/agentCliKinds.test.ts`）: `permissionAnswer` が true の種類は `screenActivity` も true
- 文言（`agentPermissionAnswerMessages.test.ts`）: 理由・名前・読み上げ・失敗の文言。`copilot` の `拒否` だけ案内が付く
- 中断（`agentInterrupt.test.ts`・`useAgentInterrupt.test.ts`）: `isAnsweringPermission` の理由と順。押した時点の値（ref）で止まる
- `useAgentPermissionPrompt.test.ts`（偽のタイマー）: 許可待ちになると描画の前に読む・出力の通知の 150ms 後に読み直す（149ms では読まない）・出力の通知が無くても大きさの変化の通知だけで 150ms 後に読み直し、上の罫線が流れた画面（`bodyStartVisible` が偽）から罫線が見える画面へ替わる（review-loop 第 34 周）・許可待ちでないときと外したときに大きさの変化の購読も外す・値が同じなら state を変えない・許可待ちでなくなると null で購読を外す・タブの切り替えで読み直す・`isAwaitingReread` が真になった描画で null を返し、次の通知の 150ms 後か 1,000ms 後の早い方で読み直し、読み取りの更新と `onReread` が同じ描画に入る（読み直し待ちが外れた描画で `prompt` が null のまま見えない）・読み直し待ちで許可待ちでなくなったら（活動が `working`）すぐ `onReread` を呼ぶ・選択中でないタブの読み直し待ちは、そのタブを選んだ描画で外れる・読み直し待ちの間も `displayPrompt` は直前の読み取りのまま（タブを切り替えた描画では前のタブの読み取りを使わない）・通知が続いても最初の未読の通知から 500ms で読み、読んだ後も上限を張り直す・上限の時点の画面が描き直しの途中（活動の判定が `unknown`）なら採らず、`prompt`・`displayPrompt`・読み直し待ちを変えずに、その後の 150ms の待ちで読み直す（読み直し待ちでない・読み直し待ちの両方）・`readScreen` の例外で null・読み直し待ちのまま作業中にする・アンマウントすると 1,000ms の読み直しのタイマーを残さない・アンマウントでタイマーを残さない（`afterEach` で偽のタイマーを戻す）
- `useAgentPermissionAnswerCooldown.test.ts`: ref と state の同期の更新・`begin` で 3 つが同時に始まる・`finish` は送っている途中だけを解く・`markReread` の前は 1,000ms を過ぎても `isPending` が真で、1,000ms の前に `markReread` しても 1,000ms までは真（999ms は待ち・1,000ms で明ける）・待ちでないタブの `markReread` は何もしない・タブごと・アンマウントでタイマーを残さない
- `useAgentPermissionAnswerAppearGrace.test.ts`（偽のタイマー）: `visible` が偽から真になった描画から 1,000ms は猶予（999ms では残り、1,000ms で外れる。state と ref の両方）・別の確認に替わった描画と読み取れない → 読み取れた描画で数え直す・カーソルだけの変化では始めない・別のタブを選んだ描画で数え直し、出なくなったら外れる・タイマーがアンマウントで残らない・StrictMode の付け直しでも付け直した描画で数え直し、1,000ms 後に state と ref の両方が外れる
- `useAgentPermissionAnswer.test.ts`: 確認が出た直後（描画の state）の理由・描画の値が偽でも押した時点の ref（`isJustAppearedNow`）で止める。パネルの開閉（review-loop 第 27 周）: 描画の理由・押した時点で IPC を呼ばず画面も読まずに読み上げる・`拒否` は送る・閉じた後は開いていた描画の `onAnswer` でも送らない。押せるときに IPC が選択中のタブの `sessionId` と番号で呼ばれる（`許可` は 1、`claude` の `拒否` は 4、`copilot` の `拒否` は 2）・結果を待つ間の同じタブの 2 回目は IPC を呼ばない（解決しない Promise の偽物）・待ちはタブごと・
  手順 2 の段階 (a) で止めたとき（送信中・確認・中断の流れ・答えた直後）と段階 (b)〜(f) で止めたとき（描画は `permission`、押した時点は入力待ちの画面・本文を変えた画面・`permissionDown`）は IPC を呼ばず理由が `notice` に入る・`sent` の読み上げ（`copilot` の拒否は案内付き）と id が進む・送ると `cooldown.begin` が呼ばれる・IPC に渡す番号は `checkAgentPermissionAnswerAtPress` の結果のもの・
  ターミナルのスクロール（review-loop 第 31 周）: 描画の理由・スクロールの通知で理由が出て消える・描画の後に通知なしでスクロールした値で押した時点に止める（IPC も画面も読まない）・描画はスクロール中でも押した時点で末尾なら送る・`拒否` は送る。
  `toAgentPermissionAnswerAvailabilityInput` が描画と押した処理で同じ写像（活動が未記録なら `unknown`）
- `useAgentSessions.test.ts`: `answerPermission` の各結果（`skipped` で IPC を呼ばない・`sent`・`no-session`・`write-failed`・拒否・同期の例外〈L-055〉・結果を待つ間に起動し直して `stale`・閉じて `stale`）と、タブの `error` の出し方・消し方（答えの失敗の文言だけを消し、中断・終了の失敗の文言は消さない）
- `AgentTerminalPanel.test.tsx`: 許可待ちでだけ問いと 2 つのボタンが出る（`中断` の直前）・名前・`aria-disabled`・`aria-describedby` の先の文言（ボタンごと）・`title`・問いの `title` の全文と `aria-hidden`・押せないときの `click` でも `onAnswer` を呼ぶ（送らないことは hook の役目）・`detail: 2` の `click` で呼ばない・`repeat` の `Enter` の `keydown` が `preventDefault` される・読み上げの要素が 2 つ常にある。
  フォーカス: `許可` にフォーカスがある状態で許可待ちが終わる（活動を `working` に描き直す）と `エージェント` へ移り、`中断`・`終了` へは移らない
- `useAgentPermissionAnswerFocus.test.tsx`: 移す・外のフォーカスを奪わない・パネルの中のほかの要素へ移していたら移さない・`blur` の後でも移す・控えを残さない
- `AgentTerminalPanel.styles.test.tsx`: 問いの省略の規則
- main
  - `agentSession.test.ts`: `answerPermission(1)` が偽の pty の `write` に `['1']` だけを、`answerPermission(4)` が `['4']` だけを書く（`toEqual`）・終了の後と `stop` の後は書かずに `not-alive`・`write` が投げると `write-failed`
  - `agentSessionRegistry.test.ts`: 現在のセッションだけに書く・別の所有者・古い `sessionId`・停止中・終了した直後は `no-session`・書き込みの例外は `write-failed`
  - `handlers/agentTerminalHandlers.test.ts`: メインフレーム以外は拒否・空の `sessionId` は拒否・番号 `0`・`10`・`1.5`・`-1`・`NaN`・`Infinity`・`'1'`・`null`・`undefined` は拒否して registry を呼ばない・`1` と `9` は通る・`registry.answerPermission` に `event.sender.id`・`sessionId`・番号だけを渡し結果をそのまま返す
  - `agentSession.integration.test.ts`（実物の node-pty）: 受け取ったバイトを 16 進で書き出す子に `answerPermission(1)` を呼び、受け取ったのが `31` の 1 バイトだけであることを確かめる（Windows では飛ばす。L-059）
- preload: `api.test.ts` で `answerAgentPermission('id', 1)` が `ipcRenderer.invoke('agentTerminal:answerPermission', 'id', 1)` を呼ぶ
- 配線（L-060）: `useAgentWorkspace.test.ts` で、偽の controller の `screen` を台帳の `claude` の `permission` の画面にし、活動の判定を待ってから実物の組み立て役の `agentTerminal.permissionAnswer.onAnswer('allow')` を呼ぶと `window.api.answerAgentPermission` が選択中のタブの `sessionId` と `1` で呼ばれる。送信中・確認の表示中・中断の流れの間は理由が出て呼ばれない。パネルを閉じると `許可` に理由が出て送らず読み上げ、`拒否` は送れ、開くと送れる（`isPanelOpen`〈`useAgentTerminalPanel` の `isOpen`〉の配線。review-loop 第 27 周）。
  答えた直後は `中断` の理由が出る。`useAgentWorkspace` の描画の読み取り・送信中・確認の表示中・中断の流れ・`sessions.answerPermission`・`answerCooldown` の `isAwaitingReread`・`markReread`・中断への `isPending`・`isPendingNow`・猶予の hook へ渡す `displayPrompt`（`prompt` にすると、答えた後に同じ確認を読み直すたびに猶予が始め直される）・答えの hook への `appearGrace`・`isPanelOpen`（`useAgentTerminalPanel` の `isOpen`。review-loop 第 27 周）・選択中のタブの controller のスクロール（偽の controller の `scrollTo` で `許可` に理由が出て送らず、`拒否` は送れ、末尾へ戻すと送れる。review-loop 第 31 周）の受け渡しを 1 つずつ外す変異で、どれかのテストが落ちることを確かめる
- 実機: 「実機テスト仕様書の新しい項目の下書き」

## 実機テスト仕様書の新しい項目の下書き

確定した文言は `docs/manual-test-spec.md` の AGT-297〜313（AGT-311 は review-loop 第 27 周、AGT-312 は第 28 周、AGT-313 は第 31 周で足した）。以下は設計の時点の下書きで、確定版と違う。

`docs/manual-test-spec.md` の「## エージェント CLI のアプリ内ターミナル」の末尾（`### 送信前の確認の引数` の後、`## エージェントの変更の確認` の前）に `### 許可の確認への帯からの答え` を足し、AGT-297 から振る。
既存の項目の ID と文言は変えない（AGT-219・AGT-246 の `中断` が許可待ちで押せないことは変わらない）。下書きの文言は、実装の後にコードの文言と照らし合わせて確定してから追記する（L-354）。
手順はテスト用のフォルダで行い、ファイルを書き換える操作には `許可` を使わない（許可で答える項目は、ファイルを変えない `sleep` のコマンドにする。ファイルを作る許可の確認は `拒否` で答える。AGT-219 の流儀）。「今後は確かめない」系の選択肢は選ばない。保存される設定（使う CLI・VoiceOver）を変えたら戻す。

> 前提: エージェント CLI 方式で、テスト用のフォルダを開いて `claude 1` を起動している。`claude` の許可の確認は、ターミナルの入力欄に `Bash で sleep 3 を実行して` を入力して `Enter` で送って出す（`sleep` はファイルを変えない）。許可の確認が出ずに実行された（設定で許可済み）ときは、そのことを記録して、許可で答える項目を飛ばす。
> 前提: `copilot` の項目（AGT-302〜304）は、`### copilot の画面の判定と中断` の前提（使う CLI の切り替え・ほかの prompt-ide を動かさない・フォルダの信頼の確認の答え方）と同じで、最後の項目の後に設定の `使うエージェント CLI` を `Claude Code（claude）` に戻す。`copilot` の許可の確認は、入力欄に `Run the shell command sleep 3.` を入力して `Enter` で送って出す。

- [ ] **AGT-297** `claude` の許可の確認を出し、帯を見る → 帯が `許可待ち` で、その右に `Do you want to proceed?` と `許可`・`拒否` が並び、`中断` は薄い色のまま。問いの文字にマウスを載せると全文が出る。入力待ちに戻ると問いと 2 つのボタンは消える
- [ ] **AGT-298** `claude` の許可の確認を出し、帯の `許可` をタップ（またはクリック）する → 確認のダイアログは出ず、`sleep 3` が実行されて帯が `作業中` になり、問いと 2 つのボタンが消える。ターミナルの選択肢は 1 番の `Yes` が選ばれている（`Yes, and …` は選ばれない）。作業が終わると `入力待ち` に戻る
- [ ] **AGT-299** `このフォルダに permission-test.txt を作って` を送り、許可の確認が出たら帯の `拒否` を押す → `No` が選ばれ、ファイルは作られず、帯が `入力待ち` に戻って問いと 2 つのボタンが消える。許可の確認が出ずにファイルが作られた（設定で許可済み）ときは、そのことを記録し、テスト用のフォルダの中の `permission-test.txt` を消してから次へ進む
- [ ] **AGT-300** VoiceOver を有効にして `claude` の許可の確認を出し、ターミナルの中をクリックしてから `F6` で抜けて（フォーカスが開閉のボタン `エージェント` に移る）、`Tab` を押してフォーカスリングを見ながら `許可` へ移し、`Enter` を押す → `許可（claude 1 の「Do you want to proceed?」に 1 番の Yes で答える）` と読まれ、押すと `claude 1 に許可（1 番の Yes）を送りました` が読み上げられる。ボタンが消えた後、フォーカスリングは `エージェント` にある（`中断`・`終了`・ターミナルには無い）。確かめた後、VoiceOver を切る
- [ ] **AGT-301** `claude` の許可の確認を出し、ターミナルの中をクリックして `↓` を 1 回押し、カーソルを 2 番に動かしてから（`Enter` は押さない）帯の `許可` にマウスを載せて押す → `許可` は薄い色で、`カーソルが Yes・No 以外にあるか、答えの文の入力欄が開いているため押せません（ターミナルで答えてください）` が出て、押しても選択肢は変わらない。続けてターミナルで `↑` を押してカーソルを 1 番に戻すと、`許可` が押せる色に戻る。続けてターミナルで `Tab` を押して `Yes` を入力の形にすると、また押せなくなる。確かめた後、ターミナルで `Esc` を押して答えずに閉じる（拒否として扱われ、`sleep` は実行されない）
- [ ] **AGT-302** `copilot 1` を起動して許可の確認を出し、帯を見てから `許可` を押す → 帯に `Do you want to run this command?` と `許可`・`拒否` が出る。押すと `1. Yes` が選ばれて `sleep 3` が実行され、帯が `作業中` になってボタンが消える（`Yes, and don't ask again …` は選ばれない）
- [ ] **AGT-303** VoiceOver を有効にして `copilot` の許可の確認を出し、帯の `拒否` を押す → 選択肢の `2. No, and tell Copilot what to do differently` の行が入力欄に変わり、`copilot 1 で拒否（2 番）を選びました。ターミナルで、代わりにしてほしいことを入力して Enter を押してください` が読み上げられる。帯は `許可待ち` のままで、`許可`・`拒否` は薄い色になり、マウスを載せると `copilot は、代わりにしてほしいことの入力を待っています（…）` が出る。もう一度 `許可`・`拒否` を押しても、入力欄に数字は入らない。続けてターミナルの中をクリックして `Do nothing and stop.` と入力して `Enter` を押す → `copilot` が答えを受け取り、許可の確認が閉じて帯のボタンが消える。確かめた後、VoiceOver を切る
- [ ] **AGT-304** `copilot` の許可の確認を出し、帯の `許可` をすばやくダブルクリックする（別の回に、`Tab` で `許可` へ移して `Enter` を 2 秒押し続ける） → どちらの回も `sleep 3` が 1 回だけ実行され、続けて別の許可の確認が出ても答えられていない（出たら `拒否` を押してから、ターミナルで `Esc` を押して取り消す）。確かめた後、設定の `使うエージェント CLI` を `Claude Code（claude）` に戻す
- [ ] **AGT-305** サイドバーを開いたまま、ウィンドウの幅を AGT-225 と同じく 670px 程度まで狭めて、`claude` の許可の確認の帯を見る → 帯は 1 行（高さ 32px）のまま、`エージェント`・`許可`・`拒否`・`中断`・`終了`・`最大化` のボタンは文字も枠も切れずに見える。記録があれば `変更を確認` のボタンは枠が切れずに見え、文字は末尾が `…` で省略されうる（AGT-225 と同じ）。記録がある状態でも `最大化` が切れないことを確かめ、切れたらどのボタンが切れたかを記録する。問いの文字・タブ列・`許可待ち` は狭まって途中で省略されうる。確かめた後、ターミナルで `Esc` を押して答えずに閉じる
- [ ] **AGT-306** `+` で `claude 2` を起動し、`claude 1` で許可の確認を出してから `claude 2`（入力待ち）を選ぶ → `claude 2` の帯には問いもボタンも出ない。`claude 1` を選び直すと出て、`拒否` を押すと `claude 1` だけが答え、`claude 2` の画面は変わらない。確かめた後、`claude 2` を `×` で閉じる

### ダブルクリックの 2 回目を捨てるボタン（`+`・`×`・`終了`・`起動`・`前回の続きから`）

> 前提: `claude 1` のタブだけがあり、`claude 1` は止まっている状態から始める。ダブルクリックはマウスですばやく 2 回押す。

- [ ] **AGT-307** タブ列の `+` をすばやくダブルクリックする → タブが `claude 2` の 1 つだけ増えて選択される（`claude 3` はできない）。2 回目が新しく出た `claude 1` の `×` に届いても、`claude 1` は閉じず、確認も出ない。続けて `Tab` で `+` へ移して `Enter` を押し、もう一度 `Tab` で `+` へ移して `Enter` を押す → 押すたびにタブが 1 つずつ増える（`claude 3`・`claude 4`）。確かめた後、`claude 2`〜`claude 4` を `×` で閉じる（確認で `OK`）
- [ ] **AGT-308** `起動` で `claude 1` を起動して `入力待ち` になってから、帯の `終了` をすばやくダブルクリックする → `claude 1` が止まって帯のボタンが `起動` と `前回の続きから` に変わり、その後も再開も起動もしない（`起動中` にならず、`pgrep -fl claude` に `claude` が残らない）
- [ ] **AGT-309** 止まった `claude 1` で、ターミナルの中をクリックしてから `F6` で抜け（フォーカスが `エージェント` に移る）、`Tab` で（タブ列・`+` の後の）`起動` へ移し、リングが `起動` にあることを確かめてから `Enter` を押す → `claude 1` が起動し、フォーカスは（右へ移った）`終了` に残る。`入力待ち` になってから `Enter` を押す → `claude 1` が止まる（キーボードでは押すたびに効く）

### 許可の確認が出た直後の猶予

> 前提: `起動` で `claude 1` を起動して `入力待ち` にしてある。ウィンドウの幅は狭めなくてよい（広い幅で帯の要素が縮まない間は、`許可`・`拒否` が挿し込まれても `中断`・`終了` の位置は変わらない。幅が足りず帯の要素が縮んでいるとき（帯があふれる幅、または記録があって `変更を確認` が縮む〈文字が省略される〉幅）では、挿し込みや消えるたびに `中断`・`終了` が右へ（消えるときは左へ）ずれうる）。VoiceOver を使う場合は有効にしておく（使わない場合は読み上げの確認を飛ばして、そのことを記録する。確かめた後に切る）。

- [ ] **AGT-310** ターミナルの入力欄に `Bash で sleep 3 を実行して` を入力して `Enter` で送り、許可の確認が出て帯に `許可` が出たら、すぐ（1 秒以内に）`許可` をクリックする → 確認が出た直後（1 秒以内）に `許可` を押しても送られず（`sleep 3` は実行されず、許可の確認が残る）、`許可の確認が出た直後です（少し待つと押せます）` が読み上げられる（マウスを載せたままにすると、1 秒の間は同じ文言が出る。ツールチップが間に合わず出なければ、出なかったことを記録するだけでよい）。2 秒ほど待ってからもう一度 `許可` を押すと、`sleep 3` が実行されて帯が `作業中` になる（少し待つと押せる）

### パネルを閉じている間の許可

> 前提: `起動` で `claude 1` を起動して `入力待ち` にしてある。VoiceOver を使う場合は有効にしておく（使わない場合は読み上げの確認を飛ばして、そのことを記録する。確かめた後に切る）。

- [ ] **AGT-311** ターミナルの入力欄に `Bash で sleep 3 を実行して` を入力して `Enter` で送り、許可の確認が出る前に開閉のボタン（`エージェント`）でパネルを閉じて、帯に `許可`・`拒否` が出たら 2 秒ほど待つ → パネルを閉じたままでも帯に問いの 1 行目と `許可`・`拒否` が出て、`許可` は薄い色で、マウスを載せると `ターミナルを開いて、許可する内容を確かめてから押してください` が出る。`許可` を押しても送られず（`sleep 3` は実行されず、許可の確認が残る）、同じ文言が読み上げられる。`拒否` は薄い色でない。続けて `エージェント` でパネルを開くと `許可` が薄い色でなくなり、押すと `sleep 3` が実行されて帯が `作業中` になる。もう一度許可の確認を出してパネルを閉じ、`拒否` を押す → 閉じたままでも拒否が送られ、帯が `入力待ち` になる

### ターミナルを低くしたときの許可

> 前提: `起動` で `claude 1` を起動して `入力待ち` にしてある。VoiceOver を使う場合は有効にしておく（使わない場合は読み上げの確認を飛ばして、そのことを記録する。確かめた後に切る）。

- [ ] **AGT-312** パネルの上の境界（`ターミナルの高さ`）を、許可の確認の問いと選択肢は見えるが、上の罫線（とコマンドの先頭の行）は見えない高さ（12 行ほど。AGT-221 と同じ書き方）まで下へドラッグしてから、ターミナルの入力欄に `Bash で echo 1 から echo 10 までを 1 行に 1 つずつ並べた複数行のコマンドを 1 回で実行して` を入力して `Enter` で送り、許可の確認が出たら 2 秒ほど待つ（帯に `許可`・`拒否` が出ないときは、問いが画面から外れているので少し広げる）→ ターミナルに許可の確認の上の罫線（とコマンドの先頭の行）が見えず、帯の `許可` は薄い色で、マウスを載せると `ターミナルを広げて、許可する内容が全部見える状態で押してください（最大化しても収まらないときはターミナルで答えてください）` が出る。`許可` を押しても送られず（許可の確認が残る）、同じ文言が読み上げられる。`拒否` は薄い色でない。続けて境界を上へドラッグしてターミナルを広げ、許可の確認の上の罫線が見えるようにすると `許可` が薄い色でなくなり、押すとコマンドが実行されて帯が `作業中` になる。もう一度ターミナルを同じ高さまで低くして許可の確認を出し、`拒否` を押す → 低いままでも拒否が送られ、帯が `入力待ち` になる

### ターミナルを上へスクロールしているときの許可

> 前提: `起動` で `claude 1` を起動して `入力待ち` にしてある。ターミナルに画面の高さより多くの出力が溜まっている。VoiceOver を使う場合は有効にしておく（使わない場合は読み上げの確認を飛ばして、そのことを記録する。確かめた後に切る）。

- [ ] **AGT-313** `Bash で sleep 3 を実行して` を送り、すぐにホイールを上へ回して前の出力を表示したまま許可の確認を出す → `許可` は薄い色で `ターミナルを一番下までスクロールして、許可する内容を確かめてから押してください` が出て、押しても送られない。`拒否` は押せる。一番下まで戻すと `許可` を押せる

追記したら `node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact（<manual-test-spec-artifact-url>）を同じファイルパス（`.superpowers/manual-test-spec.html`）で再公開する。`npx vitest run scripts` が通ること。

## ROADMAP の更新の方針

- 「AI エージェント / 自律実行」の `- [ ] 危険な操作の承認フロー`（:785）を `- [x] 危険な操作の承認フロー` にし、下に `実装済み（<main に入れた日付>。設計書 docs/superpowers/specs/2026-11-06-agent-permission-answer-design.md）: エージェント CLI の許可の確認に、帯の 許可・拒否 で答える（承認そのものは CLI が担う）` を足す
- 実装済み機能の末尾（`### エージェント向けの指示ファイルの編集支援` の後）に `### エージェントの許可の確認への帯からの答え` を足す。設計書へのリンク、出す条件（許可待ちだけ）・送るキー（番号キー 1 バイト）・押した時点の読み直しと照合・押せない理由・連打の対策・専用の IPC と、既知の制約（この設計書の「既知の制約」と同じ）を書く
- `### エージェントの実行の中断` の節に、答えた直後の 1,000ms は押せないことを書き足す

## 既知の制約（ROADMAP・実機テスト仕様書に反映する）

- 番号キーの効き方は `claude` 2.1.288・`copilot` 1.0.87 の実装を読んで確かめたもので、アプリの xterm.js と pty で番号キーを送った画面は記録していない（実機の AGT-298・299・302・303 で確かめる）。CLI の版で選択の部品が変わると、番号キーが即決しない・別の選択肢になる・入力欄に文字として入ることがありうる
- 読み取りの規則は記録した画面（`claude` 2.1.288・`copilot` 1.0.87）に合わせている。版で問い・選択肢・案内（`Tab to amend`）の形が変わると、読み取れない・番号キーが効かないと見なして押せなくなる（送る側には倒れない）。`copilot` 1.0.105 の `Something else, and tell Copilot …` の許可の画面では `拒否` を押せない
- `claude` は、カーソルが `Yes`・`No` 以外にあるとき（ターミナルで矢印を押した後）と、`Tab` で答えの文の入力の形にしたときは押せない。読み上げのモードの `claude`（`Tab to amend` を出さない）でも押せない
- `copilot` の `拒否` は即決せず、「代わりにしてほしいこと」の入力欄を開く。答えを終えるにはターミナルで文を入れて `Enter`（または何も入れずに `Esc` で操作ごと取り消し）を押す。帯から拒否の理由は入力できない
- 押した時点で画面を読み直して照合するが、画面は CLI の出力が反映された時点のもので、読み直してから CLI が数字を受け取るまでの間（通常は数十 ms 以内）に許可の確認が別のものに変わると、数字はその新しい画面に届く。新しい画面が許可の確認なら、同じ番号の選択肢が選ばれうる（1 番は `Yes`）
- 問い・選択肢・本文が前と同じ許可の確認が続く（同じコマンドの 2 回目など）と、照合では区別できない。答えた直後の 1,000ms と、送った後の画面を読み直すまで押せないことで、2 回目のタップが届くのを防ぐ
- 帯に出すのは問いの 1 行目だけで、`claude` の `Do you want to proceed?` のように、何を許可するか（コマンド）は帯からは分からない。中身はパネルを開いてターミナルで見る。パネルを閉じている間はターミナルで確かめられないので `許可` は押せない（`拒否` は押せる。review-loop 第 27 周で直した。それまでは閉じている間も `許可` を押せ、コマンドを見ないまま `Yes` を送れた）
- 本文の上の端（`claude` の全幅の罫線・`copilot` の行頭の `╭`）が画面に無い間は `許可` を押せない（`拒否` は押せる。review-loop 第 28 周で直した。それまでは画面の先頭からを本文として読み、本文が欠けたまま `Yes` を送れた）。ターミナルを低くした・複数行のコマンドや大きな差分の確認では、広げてから押す（広げると、`claude` が描き直さなくても大きさの変化の通知の 150ms 後に読み直して押せるようになる。review-loop 第 34 周で直した。それまでは出力が来るまで押せないままだった）。端の行だけが画面から流れ、本文は全部見えている画面でも押せない（安全の側に倒す）。本文がターミナルを最大化しても収まらない確認は、帯からは `許可` できない（ターミナルで答える）。低くしすぎると問いが見えず、ボタン自体が出ない
- ターミナルを上へスクロールして前の出力を読み返している間は `許可` を押せない（`拒否` は押せる。review-loop 第 31 周で直した。それまでは確認の本文が見えないまま `Yes` を送れた）。一番下までスクロールしてから押す。`copilot` は代替画面でスクロールしないので当たらない
- 答えるのは選択中のタブだけ。裏のタブの許可の確認には、そのタブを選んでから答える
- 押せない理由は見える文字として出さない（`title` と `aria-describedby`、押したときの読み上げだけ。`中断` と同じ）
- ターミナルで利用者が直接押した番号キーには、連打の対策も読み直しも効かない（今までどおり）
- 狭い幅で、ダブルクリックの 2 回目がタブ・`最大化`・`変更を確認` に届くことは止めない。選択するタブ・パネルの大きさ・開く画面が変わるだけで、もう一度押せば戻せるため
- 許可の確認が帯に出た直後（別の確認に替わった直後を含む）の 1,000ms は `許可`・`拒否` を押せない（出た直後の猶予）。確認を読んですぐ押しても、少し待ってから押し直す必要がある
- 前の確認に `許可` で答えてフォーカスが `許可` に残ったまま（`aria-disabled` なのでフォーカスは移らない）別の確認が続けて出たときは、キーボードの 1 秒以内の `Enter` も止まる（読んでいない確認に即答しない守り。少し待ってから押し直す）
- 逆向きの入れ替わり（CLI の側で許可の確認が消えたとき）には猶予が無い: 許可待ちでなくなると `許可`・`拒否` が帯から消え、幅が足りず帯の要素が縮んでいるとき（帯があふれる幅、または記録があって `変更を確認` が縮む〈文字が省略される〉幅）では `中断`・`終了` が左へ詰まり、`許可`・`拒否` を押そうとした 1 回目のクリック（`detail` が 1）が `中断`・`終了` に届きうる。`中断` に届くと、作業中なら Esc が送られて作業が止まり、`終了` に届くと確認なしにセッションが止まる（`前回の続きから` で会話は再開できる）。許可の確認は利用者の答えを待つので、消えるのはターミナルで答えたときや CLI が取り下げたときに限られ、帯で答えようとしている最中に起きることはまれなため、`中断`・`終了` には消えた直後の猶予を足していない（ダブルクリックの 2 回目は捨てる）
- `+`・`×`・`終了`・`起動`・`前回の続きから` はダブルクリックの 2 回目を捨てる（`click` の `event.detail > 1`）。すばやく 2 回押しても 1 回分しか効かないので、続けてタブを 2 つ足したいときなどは間を空けて押すか、キーボード（`Enter`・`Space`。`detail` が 0）で押す

## 構成

| ファイル                                                                    | 変更                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/agentCliKinds.ts`                                               | `AgentCliCapabilities.permissionAnswer`（両方 true）                                                                                                                                                                                      |
| `src/shared/agentPermissionAnswer.ts`（新規）                               | `AGENT_PERMISSION_OPTION_NUMBER_MAX`・`AgentPermissionOptionNumber`・`isAgentPermissionOptionNumber`                                                                                                                                      |
| `src/shared/types/agentTerminal.ts`                                         | `AgentPermissionAnswerResult`                                                                                                                                                                                                             |
| `src/main/agentSession.ts`                                                  | `AGENT_PERMISSION_ANSWER_KEYS`・`AgentSessionPermissionAnswerResult`・`AgentSession.answerPermission`                                                                                                                                     |
| `src/main/agentSessionRegistry.ts`                                          | `answerPermission`                                                                                                                                                                                                                        |
| `src/main/handlers/agentTerminalPayloadParser.ts`                           | `parseAgentPermissionOptionNumber`                                                                                                                                                                                                        |
| `src/main/handlers/agentTerminalHandlers.ts`                                | `agentTerminal:answerPermission`・deps の `Pick`                                                                                                                                                                                          |
| `src/preload/api.ts`・`src/preload/index.d.ts`                              | `answerAgentPermission`                                                                                                                                                                                                                   |
| `src/renderer/src/lib/agentTerminalApi.ts`                                  | `answerAgentPermission`                                                                                                                                                                                                                   |
| `src/renderer/src/lib/claudeScreenActivity.ts`                              | `locateClaudePermissionPrompt` の切り出しと export（判定は変えない）                                                                                                                                                                      |
| `src/renderer/src/lib/copilotScreenActivity.ts`                             | `locateCopilotPermissionQuestion` の切り出しと export（判定は変えない）                                                                                                                                                                   |
| `src/renderer/src/lib/agentViewport.ts`                                     | `isViewportAtBottom`（表示が画面の末尾か。review-loop 第 31 周）                                                                                                                                                                          |
| `src/renderer/src/lib/agentTerminalController.ts`                           | `TerminalLike.onScroll`・`isScrolledToBottom`・`onScroll`（xterm のスクロールの購読。`dispose` で外す。review-loop 第 31 周）、`TerminalLike.onResize`・`onResized`（xterm の大きさの変化の購読。`dispose` で外す。review-loop 第 34 周） |
| `src/renderer/src/lib/claudePermissionPrompt.ts`（新規）                    | `claude` の読み取り                                                                                                                                                                                                                       |
| `src/renderer/src/lib/copilotPermissionPrompt.ts`（新規）                   | `copilot` の読み取り                                                                                                                                                                                                                      |
| `src/renderer/src/lib/agentPermissionPrompt.ts`（新規）                     | 型・`AGENT_PERMISSION_OPTION_WORDS`（選択肢の語）・`findAgentPermissionOption`・`isSameAgentPermissionPrompt`・`isSameAgentPermissionPromptState`（描画の読み取りの控えの比較）・`isWellFormedAgentPermissionOptions`（形の確かめ）       |
| `src/renderer/src/lib/agentPermissionPromptReaders.ts`（新規）              | `AGENT_PERMISSION_PROMPT_READERS`・`readAgentPermissionPromptFor`（描画に使う読み取り。`claudePermissionPrompt.ts` が `agentPermissionPrompt.ts` を使うため、表を同じファイルに置くと import が循環する）                                 |
| `src/renderer/src/lib/agentPermissionAnswer.ts`（新規）                     | `AGENT_PERMISSION_ANSWER_COOLDOWN_MS`・`AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS`・`isAgentPermissionAnswerVisible`・`getAgentPermissionAnswerAvailability`・`checkAgentPermissionAnswerAtPress`                                           |
| `src/renderer/src/lib/agentPermissionAnswerView.ts`（新規）                 | 表示の値: `AgentPermissionAnswerButtonState`・`toAgentPermissionAnswerQuestion`・`toAgentPermissionAnswerButtonState`                                                                                                                     |
| `src/renderer/src/lib/agentPermissionAnswerMessages.ts`（新規）             | 名前・理由・読み上げ・失敗の文言と種類ごとの表                                                                                                                                                                                            |
| `src/renderer/src/lib/agentInterrupt.ts`・`agentInterruptMessages.ts`       | `isAnsweringPermission` と理由                                                                                                                                                                                                            |
| `src/renderer/src/hooks/useAgentPermissionPrompt.ts`（新規）                | 描画に使う読み取り                                                                                                                                                                                                                        |
| `src/renderer/src/hooks/useAgentPermissionAnswer.ts`（新規）                | 押した処理・読み上げ・判定の入力の写像                                                                                                                                                                                                    |
| `src/renderer/src/hooks/useAgentTerminalScrolledToBottom.ts`（新規）        | 描画に使う、選択中のタブのターミナルの表示が画面の末尾か（`useSyncExternalStore` で `onScroll`・`onOutputWritten`・`onResized` を購読。review-loop 第 31 周、`onResized` は第 34 周）                                                     |
| `src/renderer/src/hooks/useAgentPermissionAnswerCooldown.ts`（新規）        | タブごとの送っている途中・1,000ms の待ち・読み直し待ち（`useAgentWorkspace` が中断と答えの hook より先に作る）                                                                                                                            |
| `src/renderer/src/hooks/useAgentPermissionAnswerAppearGrace.ts`（新規）     | 出た直後の猶予（帯に出た・別の確認に替わった描画から 1,000ms。描画用の state と押した時点用の ref）                                                                                                                                       |
| `src/renderer/src/hooks/useAgentPermissionAnswerFocus.ts`（新規）           | ボタンが消えたときのフォーカスの移し先                                                                                                                                                                                                    |
| `src/renderer/src/hooks/useAgentSessions.ts`                                | `answerPermission`（`AgentSessionsState` に必須で足す）                                                                                                                                                                                   |
| `src/renderer/src/hooks/useAgentInterrupt.ts`                               | `isAnsweringPermission`・`isAnsweringPermissionNow`（必須）を判定の入力に渡す                                                                                                                                                             |
| `src/renderer/src/hooks/useAgentWorkspace.ts`                               | `AgentTerminalPanelState.permissionAnswer`（必須）の組み立てと、中断との受け渡し                                                                                                                                                          |
| `src/renderer/src/components/agent/AgentPermissionAnswerButton.tsx`（新規） | 帯の `許可`・`拒否` のボタン 1 つ分                                                                                                                                                                                                       |
| `src/renderer/src/components/agent/AgentSessionTabList.tsx`                 | `+`・`×` のダブルクリックの 2 回目の除外                                                                                                                                                                                                  |
| `src/renderer/src/components/agent/AgentTerminalPanel.tsx`                  | 問い・`許可`・`拒否`・隠した理由・読み上げの要素・`onFocus` の合成・開閉のボタンのキーリピートの抑止・`終了`・`起動`・`前回の続きから` のダブルクリックの 2 回目の除外                                                                    |
| `src/renderer/src/assets/main.css`                                          | 問いの省略の規則                                                                                                                                                                                                                          |
| `docs/manual-test-spec.md`・`ROADMAP.md`                                    | 「実機テスト仕様書の新しい項目の下書き」・「ROADMAP の更新の方針」                                                                                                                                                                        |
| テスト                                                                      | 「テスト方針」の各ファイル                                                                                                                                                                                                                |

## 実装の分割

1 つの実装プランで、次の順のタスクにする。

1. **読み取りの純関数（renderer）**: 位置の特定の切り出し（既存の判定のテストが通ること）・`claude`・`copilot` の読み取り・`agentPermissionPrompt.ts` とそのテスト（台帳の期待の表・全画面の一致・手書きの画面・照合）
2. **IPC（shared・main・preload）**: `AgentPermissionAnswerResult`・番号の型と検証・`AgentSession.answerPermission`・registry・受け口・preload・`index.d.ts`・`agentTerminalApi.ts`。main と preload のテスト、node-pty の統合テスト
3. **能力・押せるかの判定と文言（renderer の純関数）**: `permissionAnswer`・`agentPermissionAnswer.ts`・`agentPermissionAnswerMessages.ts`・中断の理由の追加とそのテスト
4. **hook と組み立て（renderer）**: `useAgentPermissionPrompt`・`useAgentPermissionAnswerCooldown`・`useAgentSessions.answerPermission`・`useAgentPermissionAnswer`・`useAgentInterrupt` への受け渡し・`useAgentWorkspace` の配線とテスト（配線の変異の確認を含む）
5. **帯の表示と CSS（renderer）**: `AgentTerminalPanel.tsx`・`useAgentPermissionAnswerFocus`・`main.css` とテスト
6. **ROADMAP の更新・既知の制約・テスト仕様書への追記と Artifact の再公開・全体の検証**:
   - ROADMAP: 「ROADMAP の更新の方針」のとおり
   - 実機テスト仕様書: AGT-297〜310 を実装の文言と照らし合わせて確定し、追記する。`node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact を同じファイルパスで再公開する。`npx vitest run scripts` が通ること
   - 設計書の「既知の制約」を実装と照らし合わせ、食い違いがあれば直す
   - 全体の検証: `NODE_ENV=test npm test`・`npm run typecheck`・変更したファイルへの `npx eslint`

main に入れた時点で利用者から見える挙動:

- エージェント CLI 方式で、選択中のタブの `claude`・`copilot` が許可を求めている間、帯に問いの 1 行目と `許可`・`拒否` が出る。押すとターミナルでその番号を押したのと同じく答え、読み上げで伝わる
- 送信中・中断の直後・答えた直後・カーソルや入力欄の状態で番号キーが効かない画面では押せず、マウスを載せる（または読み上げの説明で）理由が分かる
- `copilot` の `拒否` は「代わりにしてほしいこと」の入力欄を開き、その後はターミナルで入力する

## 反映した知見（dev-flow-kit の review-lessons.md）

- L-019: 専用の IPC は `sessionId` と番号（数）だけを受け取り、main が 1〜9 の整数であることを確かめて、固定の表から 1 バイトを書く。`writeAgentSession` に流さない。送信元のフレームの確認・所有者は `event.sender.id`（「IPC」・「main」）
- L-036: 描画と押した時点の同一性を、件数ではなく本文の行・問いの行・選択肢の `{ 番号, 文言 }` の並びの完全一致で照合し、一致しなければ送らない。照合に使う値は描画と同じ読み取りの関数から作る（「設計で決めた事項」・「選択肢の読み取り」・「押せるかの判定」）
- L-040: 結果が届いた時点でタブの `sessionId` が控えた値と違えば `stale` にし、古いセッションの結果を今のタブに出さない（「押したときの処理」）
- L-041: 番号の意味は画面の状態（カーソルが入力欄の選択肢にあるか）で変わる（数字が選択にも文字の入力にもなる）。番号キーが効く状態を CLI ごとの規則で確かめ（`numberKeysAccepted`）、効かない状態を拒否するコードとテストを書く。CLI の規則は種類ごとの表で引き、`claude` の規則で `copilot` の画面を読まない。読み取りと活動の判定が全画面で一致することをテストする（「選択肢の読み取り」・「テスト方針」）
- L-058: 押せない状態は `aria-disabled` の見た目だけでなく、押した処理の先頭で描画と同じ純関数で判定して IPC を呼ばない（「押せるかの判定」・「押したときの処理」）
- L-061: 新しい状態（答えを送っている途中・1,000ms・読み直す前）に対して、`agentTerminal:*` の入口と帯・送信の入口を列挙して扱いを表にした。中断の押せる条件にも理由を足した（「新しい状態と既存の入口」）
- L-093: `useAgentSessions.answerPermission` は最初の `await` より前に `sessionId` を控え、結果が届いた後に比べる（「押したときの処理」）
- L-101・L-653: 同期の再入の防止を state ではなく ref の `Set<slotId>` で行い、`finally` で解く（「押したときの処理」・「連打の対策」）
- L-157: `disabled` にせず `aria-disabled` にして、押した後のフォーカスを body に落とさない。ボタンが消えるときは、その時点で押せる開閉のボタンへ移す（「設計で決めた事項」・「フォーカス」）
- L-408: 確認のダイアログを出さない代わりに、1,000ms の待ち・読み取りの捨て直し・同期の再入の防止・`event.detail > 1` の無視・リピートの抑止を入れる。ボタンが消えたときに逆の操作（`中断`・`終了`）やターミナルへフォーカスを移さない。組で働くことを書いた（「連打の対策」・「フォーカス」）
- L-594: 矢印キーで動かして `Enter` を分けて送る方式は、間に画面が変わると別の操作になり、`\x1b` で始まる矢印は Esc として働きうるため採らない。番号キー 1 バイトで即決させる（「設計で決めた事項」・「調べて分かったこと」）
