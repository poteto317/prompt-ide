# 許可待ち・確認待ちの `claude` へのプロンプトの送信を断る設計書

- 日付: 2026-11-07
- ROADMAP: 「危険な操作の承認フロー」の残りのうち「許可待ちの画面での `claude` へのプロンプトの送信を断る（今は `実行` を押せ、送信の `Enter` が既定の選択肢で答えうる。以前からの挙動）」
- 前提の設計書: `2026-11-06-agent-permission-answer-design.md`（許可の確認の読み取り・押した時点の読み直し）、`2026-10-22-agent-cli-copilot-send-design.md`（`copilot` は `requiresIdle` で入力待ちのときだけ送り、手順 3 で画面の活動を確かめる）、`2026-10-09-agent-session-activity-design.md`（活動の判定）

## 背景

### 今の作り

- 送信の手順の表 `lib/agentPromptSendSpecs.ts` で、`claude` は `requiresIdle: false`。作業中の `Enter` は `claude` が送信待ち（`Press up to edit queued messages`）に積むので、作業中でも送れるようにしている（AGT-010・AGT-015）。
- そのため押せる条件 `getPromptRunAvailability`（`lib/promptRunAvailability.ts`）は、`claude` では活動を見ない。許可待ち（`permission`）・確認待ち（`confirm`）の間も `実行`・履歴の `再実行`・送信前の確認の `送信` を押せる。3 つの入口はどれも `useAgentWorkspace` の `sendGateOf` で同じ活動を渡し、`agentSender.send`（`useAgentPromptSender`）→ 表の `send`（`sendClaudePrompt`）を通る。ほかに `claude` の pty へプロンプトを書く入口は無い（`writeToSession` の呼び出しは `useAgentPromptSender` だけ）。
- `sendClaudePrompt`（`lib/claudePromptSend.ts`）は、正規化 → bracketed paste の確認 → 入力欄の特定（`findInputBox(readViewport())`）→ 消去（`AGENT_CLEAR_INPUT_CHUNK`。Ctrl+K・Ctrl+U を 12 回ずつ）を最低 1 回 → 空を 2 回確かめる → 貼り付け → 本文が現れたかを 16ms ごとに最大 1,000ms 確かめる → `Enter`（`\r`）の順。各書き込みの直前に `readViewport()` を読み、入力欄が見つからなければ止める。ただし本文が現れたかの確認の間は、入力欄が見つからなくても（描き直しの途中とみなして）時間切れまで読み続ける。
- 送信の手順の間は、利用者のキー入力を controller が溜め（`beginSending`）、終わると流す（`endSending`）。`claude` の `discardHeldInputOn` は空で、失敗しても溜めた入力をそのまま pty へ流す。

### 確かめた結果（書き捨てのテスト。確かめた後に消した）

記録した実画面（`lib/__tests__/fixtures/agentScreens.json`。`claude` 2.1.288）で次を確かめた。

1. **入力欄の取り違えは無い**: `permission`・`permissionAfterClear`（許可の確認）、`trust`・`fullscreen`（確認待ち）のどれも、`findInputBox` は null。許可の確認の画面の `─` の罫線は 1 本だけで（下の区切りは `╌`）、上の罫線が見つからず、字下げの行だけの画面でもないため。カーソルの行 ` ❯ 1. Yes` は行頭が空白なので、入力欄の記号の行（`SYMBOL_LINE` は行頭の `❯`）にも当たらない。逆に、入力欄のある 28 画面は、活動の判定がどれも `permission`・`confirm` にならない（`classifyClaudeScreen` は入力欄が無いときだけ許可待ち・確認待ちにする）。
2. **最初から許可待ちの画面で `実行` を押した場合**: 変更前の `sendClaudePrompt` は最初の読み取りで `input-not-found` を返し、何も書かなかった（書き込み 0 件）。利用者には `エージェントの入力欄が見つかりません。…` が出ていた（変更前の AGT-019。この設計の後は `実行` を押せず、押した時点の手順でも `screen-permission` で止まる）。描いた画面が許可待ちのままなら、許可の確認へは何も届かない。
3. **消去を書いた後に許可の確認に変わった場合**: 消去の 24 バイトを 1 回書いた後の読み取りで `input-not-found`。貼り付け・`Enter` は書かない。
4. **貼り付けを書いた後に許可の確認に変わった場合**: 本文が現れたかの確認が、入力欄の無い画面を 1,000ms 読み続けてから `not-echoed`。`Enter` は書かない。

### どの経路で `Enter` などが許可の確認に届くか

描いた画面（xterm のバッファ）で許可の確認が見えていれば、上のとおり書き込みは止まる。届くのは、画面に映る前・映っていない所で許可の確認に変わったときで、次の 3 つがある。

- **(a) 描画の遅れ**: `claude` が許可の確認を出した出力が、main → IPC → xterm の解析を経てバッファに映るまでの間に、手順が「入力欄がある」と読んで書くと、そのバイトは許可の確認に届く。作業中の `claude` へ送るとき（`requiresIdle: false` で押せる）に、ちょうどツールの許可の確認が出る場面で起こる。届くものは段によって違う:
  - 消去の直前: Ctrl+K・Ctrl+U（選択の部品での効き方は確かめていない）
  - 貼り付けの直前: bracketed paste の本文。選択の部品が貼り付けを番号キーとして扱うかは確かめていない（`claude` は番号キー `1`〜`9` で即決する。前回の設計書「調べて分かったこと」）。本文に数字があると答えになりうる
  - `Enter` の直前: `\r`。カーソルのある選択肢（既定は `1. Yes`）で答える。**ROADMAP の「送信の `Enter` が既定の選択肢で答えうる」はこの経路**
  
  手順はどの書き込みも直前の読み取りと同じ同期の区間で書くので（読み取りと書き込みの間に `await` が無い）、renderer の中の読み直しではこの窓を 0 にできない（既知の制約）。
- **(b) 上へスクロールしている間**: `sendClaudePrompt` は表示中の行（`readViewport`。`buffer.viewportY` から）を読む。利用者が上へスクロールして、表示中の行に入力欄の形が映っている（スクロールバックに残った前の描画）と、画面の末尾（`readScreen`。`buffer.baseY` から。活動の判定はこちら）が許可の確認でも、手順は入力欄があると読んで書く。xterm は、上へスクロールしている間は pty の出力で表示を末尾へ戻さないので、書いた後の読み取りも同じ表示のままになりうる。スクロールバックに入力欄の形が残るかは記録していないが、起こりうる経路として塞ぐ。
- **(c) 溜めた利用者の入力**: 送信の手順の途中で許可の確認に変わり（a）手順が止まると、`claude` は溜めた入力を流す（`discardHeldInputOn` が空）。送信の間に利用者がターミナルで打った `Enter`・数字（入力欄へ打ったつもりのもの）が、そのまま許可の確認への答えになる。

確認待ち（`confirm`）にも同じ経路がある。`claude` の確認待ちは入力欄の無い選択の画面（フォルダの信頼・全画面の表示の案内・`/model`・ログインの方法・作業中に出る選択肢の問いなど）で、`Enter` でカーソルの選択肢を確定する。フォルダの信頼の既定の選択肢は `No, exit`（`claude` が終了する）、`/model` は確定するとモデルの設定が保存される。作業中にも出うる（選択肢の問い）ので、(a) の窓も同じにある。

## 決めたこと

1. **断る活動は「利用者の操作を待っている活動」（許可待ち・確認待ち）**。既存の述語 `isAgentActivityWaitingForUser`（`lib/agentActivity.ts`。ステータスバーの強調・通知と同じ集まり）を使い、新しい集まりを作らない。どちらも `claude` の判定では入力欄が無い画面なので、この 2 つで断っても、今なら送れていた送信は 1 つも失わない（確かめた結果 1・2）。作業中（`working`）と判定できない（`unknown`）は、今までどおり送る（作業中の送信待ちに積む挙動を変えない）。`classifyClaudeScreen` の `unknown` には、入力欄はあるが作業中か入力待ちかの根拠が無い画面（入力欄が画面の高さを超えた画面・todo の一覧の上が画面の外の画面）と、入力欄が無く許可待ち・確認待ちの根拠も無い画面（描き直しの途中など）の両方がある。前者は手順が今までどおり入力欄を確かめて送り、後者は手順が今までどおり `input-not-found`（または本文が現れたかの確認の時間切れ）で止まる。どちらも選択の画面だと判定できた画面ではないので、押せる条件では断らない。
   - 種類に依らない規則にする: 「どの種類でも、利用者の操作を待っている活動の間は送らない。`requiresIdle` の種類（`copilot`）は、加えて作業中・判定できない間も送らない」。`copilot` の挙動は変わらない（許可待ち・確認待ちは今も断っている）。表に種類ごとの新しい欄は足さない（今後の種類も、選択の画面に `Enter` を送らない側に倒れる）。
2. **描画（押せる条件）と送信の手順の各段の両方で断る**。
   - 押せる条件: `実行`・`再実行`・送信前の確認の `送信` は、今の作りのまま disabled になり、押せない理由の文言が出る（`getPromptRunAvailability` の結果を使うだけで、部品は変えない。`PromptItemView.tsx`・`HistoryDetail.tsx`・`AgentSendConfirmDialog.tsx` のボタンと、プロンプトパネルの上部の `runDisabledReason`〈`PromptsPanel.tsx`〉・確認の中の理由。3 つの入口は同じ `getPromptRunAvailability` を通るので、1 か所の変更で揃う。L-061）。描いた画面で許可の確認が見えている間に押して、`input-not-found` の分かりにくい文言を見せない。
   - 送信の手順の各段: 消去・貼り付け・`Enter` を書く直前の読み取りで、画面の末尾の活動を判定し、許可待ち・確認待ちなら `screen-permission`・`screen-confirm` で止める。押せる条件の活動は 150ms の待ち（`AGENT_ACTIVITY_SETTLE_MS`）を挟んだ判定で、押した時点の画面とずれうる。準備（`beforeSend`。最大 10 秒）を挟むので、押した時点の確かめは手順の最初の読み取りで行う。経路 (b) を塞ぐのもこの段で、描画だけでは塞げない。描画の守りは文言と操作の分かりやすさ、各段の守りが安全の本体で、どちらかだけにはしない。
3. **`claude` の `discardHeldInputOn` に `screen-permission`・`screen-confirm` を足す**（経路 (c)）。溜めた入力は入力欄へ打ったつもりのもので、選択の画面へ遅れて届くと、打った時点に見ていない確認への答えになる（L-594 と同じ形）。捨てたときは既存の添え書き `AGENT_SEND_HELD_INPUT_DISCARDED_SUFFIX` を付ける。最初の読み取りで断ったときは、`beginSending` から同じ同期の区間なので溜まった入力は無く、捨てるものも無い。
4. **文言・失敗の型は既存のものを使う**。`AgentSendFailure` の `screen-permission`・`screen-confirm` と、押せない理由と失敗の文言を同じ文にする `agentSendBlockedByActivityReason`（`AGENT_SEND_BLOCKED_BY_ACTIVITY`）をそのまま使う（L-058）。新しい失敗の種類・文言・UI の部品は足さない。
5. **`useAgentPromptSender` の先頭（準備の前）では確かめない**。hook は種類に依らない作りで、`copilot` は手順 3 で確かめる。準備の前に確かめても準備の後に確かめ直す必要があり、準備の後の失敗で残るものは今の `input-not-found` と同じ（エージェントの変更の記録の区切りが増える。AGC-045 の既知の制約）。
6. **本文が現れたかの確認では、止める判定が 2 回続いたときだけ止める**（ローカルレビューの指摘で足した）。`classifyClaudeScreen` は、入力欄が無い画面で字下げした `❯ ` の行か `Enter to confirm` を含む行（会話の履歴に残った行も含む）がどこかにあれば `confirm` を返す。貼り付けの後は `claude` が入力欄を描き直している途中のフレームがあり、それを 1 回読んだだけで止めると、送れたはずの送信を `screen-confirm` で失い、溜めた入力まで捨てる（変更前は、入力欄の無いフレームを描き直しの途中とみなして時間切れまで読み続けていた）。そこで、止める判定が出た回は `Enter` を書かずに次の読み取りへ進み、2 回続いたら止め、間に止めない判定が入ったら数え直す。どの回でも `Enter` を書く前に必ず判定する形は変えないので、許可の確認への守りは弱めない（止める判定の回に `Enter` を書くことは無い）。2 回続く前に時間切れになったときは、時間切れの回が止める判定ならその理由を返す（最後に見た画面が許可・確認を待っているなら、`not-echoed` の「本文が現れない」より「答えてから送り直す」の方が直し方に合う）。時間切れの回が止めない判定なら、今までどおり `not-echoed`。回数を時間（例: 活動の判定の待ち 150ms）にしなかったのは、本物の許可の確認でも失敗の通知が遅れないようにするため。読み取りは 16ms ごとなので受け流せるのは 1 フレーム分（およそ 16〜32ms）で、1 フレームの出力が 16ms を超えて分かれると誤って止まりうる（そのときも `Enter` は書かず、本文が入力欄に残るだけ。既知の制約）。

## 設計

### 判定（押せる条件）

`lib/promptRunAvailability.ts` の `getPromptRunAvailability` の、送信中の後の分岐を次に替える。順は今と同じ（中断の流れ → 活動）。

```ts
const { requiresIdle } = AGENT_PROMPT_SEND_SPECS[params.cliKind]
// 中断の 2 回目を待つ間に貼り付けると、2 回目の Esc が貼った本文を消しうる(L-594)
if (requiresIdle && params.isInterrupting) return { disabled: true, reason: RUN_DISABLED_INTERRUPTING }
// 作業中の Enter は送信待ちになり、作業が終わると勝手に送られる(requiresIdle の種類)。許可待ち・確認待ちの画面へ送ると、
// 手順の Enter・貼り付けが選択の画面に届いて既定の選択肢で答えうるので、どの種類でも送らない
if (requiresIdle ? params.activity !== 'idle' : isAgentActivityWaitingForUser(params.activity)) {
  return { disabled: true, reason: agentSendBlockedByActivityReason(params.activity, commandName) }
}
```

（型の絞り込みのため、実装では 2 つの `if` に分けてよい。`isAgentActivityWaitingForUser` は型の述語で `permission | confirm` に絞る。）`AgentRunConditions` の `activity`・`isInterrupting` の JSDoc と、ファイルの先頭・関数のコメントの「claude は活動を見ない」を直す。`useAgentWorkspace` の `sendGateOf` のコメント（「requiresIdle の種類(copilot)だけが見る」）も直す。配線は変えない（3 つの入口に活動はもう渡っている）。

### 各段の守り（送信の手順）

`lib/claudePromptSend.ts` に、画面の末尾の活動で止めるかを返す関数を足す。

```ts
/**
 * 画面の末尾(readScreen。活動の判定〈useAgentActivity〉と同じ読み方・同じ判定)が利用者の操作を待っている活動(許可待ち・確認待ち)なら
 * screen-*。表示中の行(readViewport)は利用者のスクロールで末尾とずれ、前の描画の入力欄を読みうるので、こちらは末尾を読む
 */
function blockedByScreen(target: AgentSendTarget): AgentSendScreenFailure | null {
  const activity = classifyClaudeScreen(target.readScreen())
  return isAgentActivityWaitingForUser(activity) ? `screen-${activity}` : null
}
```

呼ぶ所（どれも書き込みの直前の読み取りと同じ同期の区間で、`readViewport` と並べて読む）:

| 段 | 今 | 変更 |
| --- | --- | --- |
| 手順の最初（正規化の後、bracketed paste の確認の前） | なし | `blockedByScreen` が理由を返せば、それで止める（何も書かない） |
| 消去の繰り返し（空の確認・消去の書き直し・空が 2 回続いて貼り付けへ進む直前） | 入力欄が無ければ `input-not-found` | 毎回の読み取りで先に `blockedByScreen` を見る |
| 本文が現れたかの確認（`Enter` の直前） | 入力欄が無ければ時間切れまで読み続ける | 毎回の読み取りで先に `blockedByScreen` を見る。当たった回は `Enter` を書かずに次の読み取りへ進み、2 回続いたら止める（時間切れを待たない）。間に止めない判定が入ったら数え直す。2 回続く前に時間切れになったら、時間切れの回が止める判定ならその理由、そうでなければ今までどおり `not-echoed`（決めたこと 6） |

消去の最初の書き込みの前（`clearInput` の `first`）では確かめ直さない。手順の最初の確かめと同じ同期の区間（間に `await` が無い）で読むので結果がいつも同じになり、テストで区別できない。手順の最初の確かめがこの段を兼ねる（`clearInput` の `first` は今までどおり入力欄が無ければ `input-not-found`）。bracketed paste の確認より前に置くのは、許可待ちの方が利用者の直し方がはっきりしているため（`not-accepting` より先に「答えてから」を出す）。

`clearInput` の失敗の型（`{ kind: 'failed'; reason: AgentSendFailure }`）はそのまま使える。`sendClaudePrompt` の JSDoc とファイルの先頭のコメントに、各段で画面の末尾の活動を確かめることを足す。

### 表（`lib/agentPromptSendSpecs.ts`）

```ts
claude: {
  requiresIdle: false,
  send: sendClaudePrompt,
  discardHeldInputOn: new Set(['screen-permission', 'screen-confirm'])
},
```

`requiresIdle` の JSDoc を「入力待ちを求めるか。true の種類は作業中・判定できない間も押せず、中断の流れの間も押せない。利用者の操作を待っている活動（許可待ち・確認待ち）は、この値に依らずどの種類でも押せない」に直す。`discardHeldInputOn` の JSDoc の「claude は空(今のまま流す…)」を、「claude は許可待ち・確認待ちで止めたときだけ捨てる（ほかの失敗は今のまま流す。同じ経路が残ることは ROADMAP の既知の制約）」に直す。

### 文言

足さない・変えない。使うのは既存の次の文（`commandName` は `claude`）。押せない理由と、送信の手順が `screen-*` で止めたときの失敗の文言は同じ文（L-058）。

| 活動 | 文言 |
| --- | --- |
| 許可待ち | `claude が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）` |
| 確認待ち | `claude が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）` |

溜めた入力を捨てたときは、後ろに `。送信の間にターミナルで打ったキー入力は、送らずに捨てました` が付く（既存）。「答えてから、もう一度実行」は、貼り付けた本文が入力欄に残っていても正しい（もう一度送ると消去から始めるため）。許可の確認は帯の `許可`・`拒否` でも答えられるが、確認待ちは帯から答えられず、`copilot` と同じ文を使うため、文に帯のことは入れない。

### 型

足さない。`AgentSendFailure` の `screen-permission`・`screen-confirm`（`AgentSendScreenFailure`）は `copilot` の手順 3 のために既にあり、`AGENT_SEND_FAILURE_COMMON_TEXTS` に文言もある。`claudePromptSend.ts` が `AgentSendScreenFailure`（`agentPromptSend.ts`）と `isAgentActivityWaitingForUser`（`agentActivity.ts`）・`classifyClaudeScreen`（`claudeScreenActivity.ts`）を import する（循環は無い。`claudeScreenActivity.ts` が import するのは `agentActivity.ts`〈型〉・`agentViewport.ts`・`agentInputBox.ts` で、どれも `claudePromptSend.ts` を import しない）。

### 直すファイル

| ファイル | 変更 |
| --- | --- |
| `src/renderer/src/lib/promptRunAvailability.ts` | 押せる条件の分岐（「判定」）とコメント・`AgentRunConditions` の JSDoc |
| `src/renderer/src/lib/claudePromptSend.ts` | `blockedByScreen` と各段の呼び出し（「各段の守り」）、ファイルの先頭と `sendClaudePrompt` のコメント |
| `src/renderer/src/lib/agentPromptSendSpecs.ts` | `claude` の `discardHeldInputOn`、`requiresIdle`・`discardHeldInputOn` の JSDoc（「表」） |
| `src/renderer/src/lib/agentPromptSend.ts` | `AgentSendTarget` の JSDoc。`readViewport` の「claude の手順が読む」を「claude の手順が入力欄を探すのに読む」に、`readScreen` の「copilot の手順が読む…」を「copilot の手順と、claude の手順の画面の活動の確かめが読む（活動の判定と同じ読み方）」に直す。`AgentSendScreenFailure` の JSDoc に、`claude` の手順も `permission`・`confirm` を返すことを足す |
| `src/renderer/src/hooks/useAgentWorkspace.ts` | `sendGateOf` のコメントだけ（配線は変えない） |
| `src/renderer/src/hooks/useAgentPromptSender.ts` | 手順を表から引く所のコメントだけ（どちらの手順も画面の末尾を読む） |
| `src/renderer/src/lib/agentSendMessages.ts` | `AGENT_SEND_HELD_INPUT_DISCARDED_SUFFIX` の JSDoc だけ（捨てる失敗は表の `discardHeldInputOn` に載るもの） |
| 各テスト | 「テスト方針」の各節 |
| `ROADMAP.md`・`README.md`・`docs/manual-test-spec.md` | 「ROADMAP・ドキュメントの更新の方針」「実機テスト仕様書」 |

### 既存の機能との関係（L-061）

| 入口・機能 | 扱い |
| --- | --- |
| プロンプトの `実行`・履歴の `再実行`・送信前の確認の `送信` | 許可待ち・確認待ちの間は押せない（同じ `getPromptRunAvailability`）。送信前の確認を開いた後に許可待ちになったときは、確認の中の理由（`targetBlockedReason`）に同じ文が出て `送信` が押せない |
| `claude` の作業中の送信（送信待ちに積む） | 変えない |
| `copilot` の送信 | 変えない（押せる条件の結果・手順・溜めた入力の扱いのどれも同じ） |
| 帯の `許可`・`拒否`（前回の機能） | 変えない。前回の設計書「新しい状態と既存の入口」の表の「プロンプトの `実行`…: 許す（変えない）」は、この機能で「許可待ちの間は押せない」に変わる（前回の設計書は書き換えず、ROADMAP・README を直す） |
| 帯の `中断` | 変えない（許可待ち・確認待ちは今も押せない） |
| 従来の方式 | 変えない（`mode === 'legacy'` は活動を見ない） |

## テスト方針

### 送信の手順（`lib/__tests__/claudePromptSend.test.ts`）

- 偽の送り先 `makeFakeClaude` の `readScreen` は今は投げる（「claude の手順は readScreen を読まない」）。`readViewport` と同じ画面を返し、テストで末尾だけを別の画面にできる形（`screen` の上書き）にする。`readScreen` は `reads` に記録しない（読み取りの時刻と回数の数え方を変えない）。テストが差し替えうる `fake.readViewport` も経由せず、画面を組み立てる内部の関数（今の `readViewport` の中身を切り出したもの）を `readViewport` と共有する。`screen` を上書きしたときだけ、末尾が表示中の行と別の画面になる。このほかの既存テストの期待と数え方は変わらない（下の 2 件を除く）。
- これにより既存の 2 件の期待が変わる。「入力欄が見つからなければ(確認画面)何も送らない」と「消している途中で入力欄が見つからなくなったら止める」は、どちらも `mode: 'dialog'`（`agentScreen('trust')`。判定は `confirm`）で `input-not-found` を期待しているが、末尾も同じ画面になるので `screen-confirm` になる。この 2 件は期待を `screen-confirm` に直し（書き込みの列の期待はそのまま。前者は 0 件、後者は消去の 1 件）、名前も「確認待ちの画面なら…」に直す。
- そのうえで、`input-not-found` を確かめるテストを 2 か所（最初の読み取り・消去の途中）に残す。使う画面は、(1) 画面の末尾は入力待ち（空の入力欄）で、表示中の行には入力欄が無い形（上へスクロールして前の出力を読んでいる形。表示中の行は `makeLine('history')` などの行だけ）、または (2) 末尾も表示中の行も、入力欄が無く判定が `unknown` になる画面（入力欄も選択肢の行も `Enter to confirm` も無い行だけ。描き直しの途中の形）。最初の読み取りでは (1)・(2) とも `input-not-found`・書き込み 0 件、消去の途中（消去を 1 回書いた後にその画面へ替える）では `input-not-found`・書き込みは消去の 1 件だけ、を固定する。
- 記録した画面で次を固定する（書き込みの列と結果を両方見る）:
  - 最初から `permission`・`permissionAfterClear` → `screen-permission`、書き込み 0 件。`trust`・`fullscreen` → `screen-confirm`、書き込み 0 件。bracketed paste が無効でも `screen-permission`（確かめる順）。
  - 消去を 1 回書いた後に `permission` に変わる → `screen-permission`、書き込みは消去の 1 件だけ。
  - 空の確認の 2 回目（貼り付けの直前）で `permission` に変わる → `screen-permission`、書き込みは消去の 1 件だけ（貼り付けを書かない）。
  - 貼り付けを書いた後に `permission` に変わる（そのまま続く）→ `screen-permission`、`Enter` を書かない。時間切れ（`AGENT_ECHO_TIMEOUT_MS`）を待たずに、2 回続いた時点で止まる（仮想の時計の経過が間隔 `AGENT_ECHO_POLL_MS` の 2 回分であること。決めたこと 6）。
  - 貼り付けの後、1 回だけ確認待ちの画面（`trust`）になり次の読み取りで戻る → 送れて（`sent`）`Enter` を書く。止める判定の回の時点の書き込みに `Enter` が無い。
  - 貼り付けの後、止める判定と止めない判定が交互に続く → 時間切れまで止めず、`Enter` を書かない。時間切れの回が止める判定なら、その理由を返す。
  - 表示中の行は空の入力欄・画面の末尾は `permission`（上へスクロールしている形。経路 b）→ `screen-permission`、書き込み 0 件。
  - 作業中（`working`・`queuedEmpty`）・判定できない（`tallTyped`）の画面では今までどおり進む（`working` の画面で送れる・既存の書き込みの列が変わらない）。
- 変異の確かめ: `blockedByScreen` の呼び出しを 1 か所ずつ外すと、対応するテストが落ちること。

### 押せる条件（`lib/__tests__/promptRunAvailability.test.ts`）

- 既存の「claude は活動(%s)と中断の流れに関わらず、今と同じく押せる」を、`claude` は `idle`・`working`・`unknown` では中断の流れに関わらず押せ、`permission`・`confirm` では中断の流れに関わらず `agentSendBlockedByActivityReason(activity, 'claude')` の理由で押せない、に替える。
- すべての種類 × すべての活動の表で、`isAgentActivityWaitingForUser` の活動はどの種類でも押せないこと、`requiresIdle` の種類だけが `working`・`unknown` で押せないことを固定する（既存の「requiresIdle で決まる」のテストを広げる）。
- 理由の順: 送信中・閉じる途中・未起動のときは、それらの理由が許可待ちより先に出る（今の順を変えない）。
- `getHistoryRerunAvailability`: フォルダ違いの理由は許可待ちより先、フォルダが同じなら許可待ちの理由（エージェントのエントリは `getPromptRunAvailability` に委ねるので、1 件ずつ固定する）。

### 表（`lib/__tests__/agentPromptSendSpecs.test.ts`）

- `claude` の `discardHeldInputOn` が `screen-permission`・`screen-confirm` の 2 つだけであることを固定する（今の「どの失敗でも流す」の期待を直す）。`copilot` は変えない。

### hook の配線（L-060）

- `hooks/__tests__/useAgentPromptSender.test.ts`: 偽の controller の `screen` を記録した `permission` の画面にすると、`claude` の送り先へ何も書かず `claude が許可待ちのため送信できません（…）` が `error` に出て、`onSettled` が呼ばれる。貼り付けの後に `screen` を `permission` に替えるテストは、`viewport` を空の入力欄から始め（既存の `controllerWithEmptyInput` と同じ形）、貼り付けの書き込みで本文が現れる前（本文の入った `viewport` に替える前）に `screen` を替える前提で書く。このとき `endSending({ discard: true })` が呼ばれ、添え書きが付く。偽の `endSending` は、`discard: true` のときに 1 以上を返すようにモックする（捨てた入力の数が 0 だと添え書きが付かず、配線を確かめられない）。ほかの失敗（`not-echoed` など）では今までどおり流す（`discard: false`）。
- `hooks/__tests__/useAgentWorkspace.test.ts`: このテストは `useAgentActivity` と `useAgentPromptSender` をモックしているので、画面からの判定は動かない。既存の `copilot` の配線テスト（`runningTabOf('copilot')`・`activityOf(...)` の describe）と同じ形で、`mockUseAgentSessions.mockReturnValue(runningTabOf('claude'))`・`mockUseAgentActivity.mockReturnValue(activityOf('permission'))`（と `'confirm'`）にし、`promptRun`（`isRunDisabled` が true、`runDisabledReason` が許可待ち〈確認待ち〉の文）、`getHistoryActions(entry).rerun`（同じ理由）、`sendToAgent` の後の `agentSendConfirmDialog.targetBlockedReason`（同じ文）を見る。送信前の確認を開いた後に許可待ちにする場合は、`activityOf('idle')` で開いてから `mockReturnValue` を `activityOf('permission')` に替えて `rerender` する。`activityOf('working')`・`activityOf('idle')` では押せること（作業中の送信を変えない）。`sendGateOf` の `activity` を `'idle'` に固定する変異でどれかが落ちること。画面から活動を判定する経路（`readScreen` → `classifyClaudeScreen` → `activities`）は、`useAgentActivity` の既存のテストの範囲にある。
- `copilot` の既存のテストは変えずに通ること。

### 実機

- 自動テストは記録した画面と偽の controller だけで、実物の `claude` の描画の遅れ（経路 a）は再現しない。実機テスト仕様書の項目は、画面に見えている許可の確認・確認待ちで押せないこと、答えた後に押せること、送信前の確認・`再実行` の理由を確かめる。

## 既知の制約

- **描画の遅れの窓は残る**（経路 a）。手順は書き込みの直前に読み直すが、`claude` が許可の確認を出してから xterm のバッファに映るまでの間（IPC と解析の数 ms〜数十 ms）に書いたバイトは、許可の確認に届きうる。renderer の中では 0 にできない。作業中の `claude` へ送るときだけに起こる（入力待ちの `claude` は許可の確認を自分からは出さない）。`requiresIdle` にすると作業中の送信（送信待ちに積む）ができなくなるので、しない。
- 貼り付けを書いた後に許可待ち・確認待ちで止めたとき、本文が入力欄に残りうる（`claude` が貼り付けを受け取ってから確認を出した場合）。答えた後にもう一度 `実行` すれば消去から始めるので、残った本文は消える。`Enter` は送っていない。
- 貼り付けが選択の部品に届いたときの効き方（数字が番号キーとして働くか）は確かめていない。
- 許可待ち・確認待ち以外で止めたとき（`input-not-found`・`not-echoed` など）は、今までどおり溜めた入力を流す。
- 判定は `claude` 2.1.288 の画面の規則（`classifyClaudeScreen`）による。版が上がって許可の確認の形が変わり許可待ちと判定できなくなると、押せる条件では断れない（入力欄の無い画面なら、手順は今までどおり `input-not-found` で止まる）。
- ターミナルで答えて入力欄が戻った後も、確定した活動（`useAgentActivity`）には前の `permission` が最大 150ms（`AGENT_ACTIVITY_SETTLE_MS`。出力が続けば上限の `AGENT_ACTIVITY_MAX_WAIT_MS` 500ms まで）残り、その間は `実行` などを押せない（少し待てば押せる）。
- 確認待ちの判定は、入力欄が無く選択肢の行・`Enter to confirm` がある画面に広く当たる。当たった画面には入力欄が無いので、送れていた送信を失うことはない。本文が現れたかの確認では、描き直しの途中のフレームで当たっても止めないよう、2 回続いたときだけ止める（決めたこと 6）。 ただし受け流せるのは 1 フレーム分で、`claude` の 1 フレームの出力が 16ms を超えて分かれたときは、送れたはずの送信を `screen-confirm` で失い、溜めた入力を捨て、本文が入力欄に残りうる（起こりやすさは記録していない）。
- **消去の繰り返しでは、止める判定 1 回で止める**（本文が現れたかの確認のように 2 回続くのを待たない）。描き直しの途中のフレームで `confirm` と判定されると、`screen-confirm` で止まり、`claude が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）` が出て、溜めた入力を捨てる（添え書き `AGENT_SEND_HELD_INPUT_DISCARDED_SUFFIX` が付く）。変更前もこのフレームでは入力欄が無いので `input-not-found` で止まっていた（`エージェントの入力欄が見つかりません。…` を出し、溜めた入力は流していた）ので、止まることは変わらず、変わるのは文言と溜めた入力を捨てるかどうかだけ。
- 送信の手順が許可待ち・確認待ちで止まった直後、確定した活動も許可待ち・確認待ちになると、プロンプトのパネルの上部に押せない理由と送信の失敗の文言が同じ文で 2 行並ぶ（溜めた入力を捨てたときは 2 行目にだけ添え書きが付く）。答えると押せない理由は消えるが、失敗の文言は次に `実行` を押すまで残る。`copilot` は以前から同じ形（review-loop 第 4 周で確認。安全には影響しないので受け入れる）

## 気をつける知見（dev-flow-kit の review-lessons.md）

- **L-058** 押せない理由と送った後の失敗（`screen-*`）を同じ文にし、描画の判定と手順の判定に同じ判定（`classifyClaudeScreen` を `readScreen` に、述語 `isAgentActivityWaitingForUser`）を使う。見た目だけで止めない（押した後も各段で止める）。
- **L-061** 送る入口（`実行`・`再実行`・送信前の確認）を列挙し、同じ判定の関数 1 か所で塞ぐ。
- **L-594** 書く直前の画面と、書いたバイトが届く画面がずれると別の操作になる。溜めた入力を選択の画面へ遅れて流さない。
- **L-018** 確かめに使う読み取り（表示中の行）と、書いたバイトが作用する画面（末尾）が食い違う（経路 b）。活動は末尾で確かめる。
- **L-001** 止めた理由を結果（`AgentSendOutcome`）で返し、呼び出し元が失敗の文言と溜めた入力の扱いを結果から決める。
- **L-597** 文言に次の行動（答えてから、もう一度実行）を入れる（既存の文を使う）。
- **L-060** 押せる条件への活動の受け渡しと、hook から手順への `readScreen` の受け渡しを、組み立て役のテストで固定する。
- **L-593** 種類ごとの違いは送信の手順の表（`requiresIdle`・`discardHeldInputOn`）に置き、各所で種類名で分岐しない。
- **L-048** 既存の挙動（作業中は送信待ちに積む・`copilot` の押せる条件）を確かめ、変えない範囲をテストで固定する。
- **L-059** 記録した画面と偽物のテストでは描画の遅れを再現できないことを、既知の制約と実機の項目に書く。

## 実機テスト仕様書（`docs/manual-test-spec.md`）

### 新しい項目

`## エージェント CLI のアプリ内ターミナル` の末尾（`### ターミナルを上へスクロールしているときの許可` の後、`## エージェントの変更の確認` の前）に `### 許可待ち・確認待ちの間の送信` を足し、AGT-314 から振る（今の AGT の最大は AGT-313）。

```markdown
### 許可待ち・確認待ちの間の送信

> 前提: エージェント CLI 方式で、テスト用のフォルダを開いて `claude 1` を起動し、`入力待ち` にしてある。設定の `送信前の確認` はオン（既定）。`claude` の許可の確認は、ターミナルの入力欄に `Bash で sleep 3 を実行して` を入力して `Enter` で送って出す。許可の確認が出ずに実行された（設定で許可済み）ときは、そのことを記録して、その項目を飛ばす。

- [ ] **AGT-314** `claude` の許可の確認を出し、帯が `許可待ち` になったら、プロンプトの `挨拶` の `実行` にマウスを載せてから押す → `実行` は薄い色で、`claude が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）` が出る。押しても送信前の確認は開かず、許可の確認の選択肢は変わらない（`sleep 3` は実行されない）。続けて帯の `拒否` を押して入力待ちに戻すと、`実行` が押せる色に戻る
- [ ] **AGT-315** 「実行履歴」にエージェントの項目がある状態で、`claude` の許可の確認を出し、履歴の詳細の `再実行` にマウスを載せてから押す → `再実行` は薄い色で、AGT-314 と同じ文言が出る。押しても何も送られず、許可の確認は残る。確かめた後、帯の `拒否` で答える
- [ ] **AGT-316** ターミナルの入力欄に `まず 5 秒考えてから、Bash で sleep 10 を実行して` を入力して `Enter` で送り、帯が `作業中` の間（`実行` を押す前に許可の確認が出たときは、帯の `拒否` で答えてやり直す）にプロンプトの `挨拶` の `実行` を押して送信前の確認を開き、そのまま許可の確認が出るまで待つ → 確認を開いた時点では `送信` が押せ、許可の確認が出ると `送信` が薄い色になり、確認の中に AGT-314 と同じ文言が出る。`送信` を押しても何も送られない。`キャンセル` で閉じてから帯の `拒否` で答える。許可の確認が出る前に作業が終わったときは、そのことを記録する
- [ ] **AGT-317** `claude` の許可の確認を出し、帯の `許可` で答えて帯が `作業中` になったら、すぐにプロンプトの `挨拶` の `実行` を押し、確認で `送信` を押す → 作業中の間は送れ、作業は中断されず、本文は送信待ちに入る（`Press up to edit queued messages`。AGT-010 と同じ）。押す前に作業が終わってしまったら、そのことを記録する
```

### 挙動が変わる既存の項目（ID は変えない）

- **AGT-017**（フォルダの信頼の確認）・**AGT-018**（`/model`）・**AGT-042**（ログインの方法の選択）・**AGT-043**（全画面の表示の案内）: 期待結果を「`実行` は薄い色で、`claude が確認待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）` が出る」に直し、項目ごとの元の確かめ（AGT-017 は `claude` が終了しない、AGT-018 は画面の選択肢が変わらない、AGT-042 はブラウザが開かない、AGT-043 は `Yes, try it` が選ばれない）を残す。手順は、理由の文言を見るため「`実行` を押す」を「`実行` にマウスを載せてから押す」に替える（AGT-264 と同じ。実装の後の最終レビューで決めた。AGT-018・AGT-042 は、確認待ちと判定されず `エージェントの入力欄が見つかりません…` が出たら、そのことを記録する）。
- **AGT-019**（許可の確認）: 期待結果を「`実行` は薄い色で、`claude が許可待ちのため送信できません（ターミナルで答えてから、もう一度実行してください）` が出る。押しても選択肢は確定されない」に直す（AGT-314 より前に出てくるので文言を全文で書く）。手順は AGT-017 と同じく「`実行` にマウスを載せてから押す」に替える。
- **AGT-167**・**AGT-186**・**AGT-202**・**AGT-212**・**AGC-045**: 送信を失敗させるために `/model` の選択の画面を出していたが、確認待ちの間は `実行`・`再実行`・`送信` を押せなくなる。失敗のさせ方を、どの項目も次の手順（以下「スクロールの手順」）に替える（送信の手順は表示中の行から入力欄を探すので、末尾が入力待ちでも `エージェントの入力欄が見つかりません…` で失敗する。以前からの挙動）。
  - スクロールの手順: 「`claude 1` に `1 から 100 までの数を 1 行に 1 つずつ書き出して` を送り、答えが終わって `入力待ち` になるのを待つ。ターミナルの上でマウスのホイールを上へ回し、表示中の行に数の行だけが見える所（入力欄と罫線が画面に無い所）まで上げ、そのままにする」。AGT-186・AGT-202・AGC-045 では、数の行をターミナルの入力欄に入力して `Enter` で送る（アプリから送ると、添えた参照・実行履歴の数・実行の区切りが変わって期待が外れるため。PR のレビューで直した）。AGT-167・AGT-212 は送り方を問わない（AGT-212 はアプリから送った実行履歴の項目を後の手順で使う）。
  - どの項目にも、期待結果の後に「送れてしまった（`エージェントに送信しました` が出た）ときは、そのことと、そのときのターミナルの表示を記録する」を足す。
  - 項目ごとの直し方:
    - **AGT-167**: 手順の「`claude 1` で `/model` の選択の画面を出してから」をスクロールの手順に替える。期待結果の失敗の文言・読み上げ・文言の消え方・フォーカスの位置はそのまま。末尾の「続けて `Enter`・数字キーを押しても画面の選択肢は変わらない（もう一度ダイアログが開き、…）」を「続けて `Enter` を押すと、`claude 1` には何も入らず、もう一度ダイアログが開き、プロンプトパネルの失敗の文言は消える（`キャンセル` で閉じる）」に直す（選択の画面が無いので「選択肢」を言わない。フォーカスがターミナルに無いことを、入力欄に何も入らないことで確かめる）。後始末に「確かめたらターミナルを末尾までスクロールして戻す」を足す。
    - **AGT-186**: 手順の「`claude 1` で `/model` の選択の画面を出してから」をスクロールの手順に替え、数の行の答えを待ってから `docs/notes.md` を足す順にする（アプリから送ると、送れた時点で添えた参照が外れる）。期待結果の文言とチップが残ることはそのまま。後始末の「ターミナルの `claude 1` をクリックしてから `Esc` で `claude` の選択の画面を閉じ、」を「ターミナルを末尾までスクロールして戻し、」に直す（`@docs/notes.md` の `×` で外すのはそのまま）。
    - **AGT-202**: 手順の「`claude 1` で `/model` の選択の画面を出したまま」を「スクロールの手順で上へ回したまま」に替え、数の行を送って答えを待つところまでを実行履歴の項目の数を数える前に済ませる。期待結果はそのまま。後始末の「ターミナルの `claude 1` をクリックしてから `Esc` で選択の画面を閉じる」を「ターミナルを末尾までスクロールして戻す」に直す。
    - **AGT-212**: 手順の「`/model` の選択の画面を出しておき、」を「スクロールの手順で上へ回しておき、」に替える（`Tab` でフォーカスを移すのでホイールの位置は動かない）。期待結果の「（画面の選択肢は変わらない。`キャンセル` で閉じると、…）」を「（`claude 1` の入力欄には何も入らない。`キャンセル` で閉じると、…）」に直す。後始末の「`Esc` で `/model` の画面を閉じる」を「ターミナルを末尾までスクロールして戻す」に直す。
    - **AGC-045**: 手順の「`claude` で `/model` の選択の画面を出したまま」を「スクロールの手順で上へ回したまま」に替える（`1 から 100 まで…` を送ると項目の数が変わりうるので、スクロールの手順のうち送って答えを待つところまでを `表示` の項目の数を数える前に済ませ、上へ回すのは `キャンセル` の確かめの後にする、と手順の順を直す）。期待結果はそのまま。後始末の「`claude` の画面をクリックして `Esc` で選択の画面を閉じる」を「ターミナルを末尾までスクロールして戻す」に直す。

追記・修正の後に `node scripts/build-manual-test-spec.mjs` で HTML を作り直し、Artifact を同じファイルパス（`.superpowers/manual-test-spec.html`）で再公開する。`npx vitest run scripts` が通ること。

## ROADMAP・ドキュメントの更新の方針

- ROADMAP「危険な操作の承認フロー」の「残り」から「許可待ちの画面での `claude` へのプロンプトの送信を断る（…）」を外し、実装済みの記述（この設計書へのリンク）を足す。「エージェントの許可の確認への帯からの答え」の節に、許可待ち・確認待ちの間は `claude` へも送れないことと、既知の制約（描画の遅れの窓）を足す。
- ROADMAP の溜めた入力の記述: 「copilot へのプロンプトの送信（段階 2b）」の 614 行目付近の「`claude` は変えていない（下の MVP の既知の制約）」と、MVP の既知の制約の 1413 行目付近の「`claude` の挙動は変えていない」は、この機能の後は正しくない。どちらも「`claude` は、当時は変えていなかった。2026-11-07（この設計書）から、許可待ち・確認待ちで止めたときだけ溜めた入力を捨てる。ほかの失敗では今のまま流す」の形に直す（変える前の状態は過去形で書く）。
- README: 17 行目（「エージェント CLI の実行（既定の実行方式）」の説明の 3 行目。「完了・許可待ちの通知、中断、許可の確認への帯の 許可・拒否 での答え、セッションの再開に対応しています。」）の後ろに「許可待ち・確認待ちの間は、プロンプトを送信しません（ターミナルで答えてから、もう一度実行します）。」を足す（アプリが答えた後に自動で送るとも読めないよう、ローカルレビューで括弧書きを直した）。README には今、押せる条件の記述は無い。
- 開発者ガイド（`docs/developer-guide.md`）: 変えない。エージェント CLI 方式の節は「3.4 エージェント CLI 方式」だけで、構成（main・renderer の担当ファイル）と、種類ごとの違いを置く表の一覧（`agentPromptSendSpecs.ts` を含む）だけを書いており、押せる条件や送信の手順の段は書いていない。この機能は表に欄を足さず（決めたこと 1）、担当ファイルも増えないので、書き足す所が無い。
