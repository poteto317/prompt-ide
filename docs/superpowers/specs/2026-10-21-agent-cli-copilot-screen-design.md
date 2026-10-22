# claude 以外のエージェント CLI への対応 段階 2a（copilot の画面の判定と中断）設計書

- 日付: 2026-10-21
- ROADMAP の項目: 「エージェント実行の支援（MVP の次）」の「`claude` 以外のエージェント CLI への対応（起動コマンドの設定。入力欄の挙動が CLI ごとに違う点の吸収）」（`ROADMAP.md:583`）
- 前提の設計書: `2026-10-20-agent-cli-kind-foundation-design.md`（段階 1。CLI の種類と能力の表・起動の表・`copilot` で使えない入口の理由）、`2026-10-19-agent-interrupt-ui-design.md`（帯の `中断`・専用の IPC・連打の対策）、
  `2026-10-09-agent-session-activity-design.md`（活動の判定と表示）、`2026-10-10-agent-activity-notification-design.md`（完了・許可待ちの通知）、`2026-10-12-agent-changes-runs-and-auto-refresh-design.md`（変更の一覧の自動の取り直し）
- 調査の結果: `.superpowers/agent-cli-kind/copilot-screens-recorder/report.md`（要点）・`screens.md`（55 場面の画面の文字）。GitHub Copilot CLI 1.0.87 を、偽のローカルの提供元と一時の `HOME`・`COPILOT_HOME` で、GitHub のサービスに接続せずに記録した（段階 0）
- 実装は 1 つの実装プラン・1 つの PR にする（「実装の分割」）

## 目的

段階 1 で、設定で GitHub Copilot CLI（`copilot`）を選ぶとターミナルのタブで `copilot` が起動するようになった。ただし `copilot` の画面は判定しておらず、帯・タブ・ステータスバーは動いている間ずっと `実行中` と出て、
完了・許可待ちの通知・帯の `中断`・変更の一覧の自動の取り直しは使えない（能力の表の `screenActivity`・`interrupt` が `false`）。

この段階 2a では、`copilot` の画面から活動（作業中・入力待ち・許可待ち・確認待ち・判定できない）を判定し、それに基づく表示・通知・中断・自動の取り直しを `copilot` でも使えるようにする。
`claude` の判定の規則と `copilot` の判定の規則は、CLI の種類ごとの関数の表に分け、互いの知識を混ぜない。`claude` を選んでいる間（既定）の挙動は今までと同じにする。
プロンプトの送信（実行・再実行・送信前の確認）は次の段階 2b で扱い、今回は `copilot` では押せないまま（`promptSend` は `false`）にする。

## 決めたこと（利用者の確認済み）

2026-10-21 に利用者が決めた。

| 項目         | 決定                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 今回の範囲   | `copilot` の画面の判定（作業中・入力待ち・許可待ち）と、それに基づく帯・タブ・ステータスバーの活動の表示、完了・許可待ちの通知（通知の依頼と OS の通知の題に CLI の種類を足し、`claude` と書いている文言を CLI ごとにする）、中断、変更の一覧の自動の取り直し。能力の表の `copilot` の `screenActivity` と `interrupt` を `true` にする（段階 1 の不変条件「`interrupt` なら `screenActivity`」を保つ） |
| 範囲の外     | プロンプトの送信（実行・再実行・送信前の確認）は段階 2b。`copilot` の `promptSend` は `false` のまま。hooks による変更の区別・セッションの再開は段階 3                                                                                                                                                                                                                                                  |
| 中断の条件   | `claude` と同じく「作業中のときだけ押せる」。許可待ち・入力待ち・確認待ち・判定できない画面では押せない                                                                                                                                                                                                                                                                                                 |
| 中断の送り方 | 押した時点で画面を確かめ直し、作業中なら Esc（`\x1b`）を約 100ms の間隔で 2 回送る（`copilot` は作業中の Esc 1 回では止まらず、500ms 以内の 2 回で中断する。段階 0 の記録）                                                                                                                                                                                                                             |
| 中断の IPC   | renderer から任意の文字列が pty に届かないこと（L-019）を保つ。今の `agentTerminal:interrupt`（main が固定の `\x1b` を書く）を土台にし、CLI ごとの送り方（回数・間隔）は main の種類ごとの表（段階 1 の `agentCliLaunchSpecs` と同じ流儀）で決める。renderer から回数や文字列を渡さない                                                                                                                 |

## 決めたこと（推奨案で決めた事項）

利用者の判断が要るほどの選択は無かったため、この設計書で推奨案に決めた。

| 項目                                    | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 判定の表の形                            | renderer の `lib/agentScreenClassifiers.ts`（新規）に `AGENT_SCREEN_CLASSIFIERS: Record<AgentCliKind, AgentScreenClassifier>` を置き、`claude` は `classifyClaudeScreen`（今の `classifyAgentScreen` を中身を変えずに `lib/claudeScreenActivity.ts` へ移して改名）、`copilot` は `classifyCopilotScreen`（新規の `lib/copilotScreenActivity.ts`）を引く。`lib/agentActivity.ts` には CLI に依らない活動の型と「利用者の操作を待っている活動」の表だけを残す。判定を呼ぶ側（`useAgentActivity`・中断の押した時点の読み直し）は種類を渡して表から引く（`classifyAgentScreenFor(kind, lines)`）                                                                                            |
| copilot の判定の手がかり                | 段階 0 の記録で確からしさが高い文言だけを使う。作業中は「入力欄の下の罫線より下の行（帯）に `esc interrupt` か `esc again to interrupt`」、入力待ちは「入力欄があり、帯にそれが無い」、許可待ちは「入力欄が無く、選択の案内（`↑/↓ to navigate · enter to select · esc to cancel`）の上に `Do you want to ` で始まる問い」。タイトル（OSC 0）・進み具合（OSC 9;4）は使わない（report.md の「判定の手がかりの候補」）。詳しくは「画面の判定の規則」                                                                                                                                                                                                                                       |
| 分からない画面の扱い                    | 誤って作業中・入力待ちとしない側に倒す（L-041）。作業中は入力欄の構造（上の罫線・記号の行・下の罫線）がそろい、帯に中断の案内があるときだけにする（会話の本文の同じ文字で作業中とせず、Esc を送らない）。入力待ちは、入力欄がそろい、帯があり、帯の先頭がスピナーの記号でなく、入力欄の外（上の罫線より上と帯）に選択の案内が無いときだけにする。入力欄の外に選択の案内があれば、入力欄の有無に関わらず作業中・入力待ちにしない（書きかけ〈入力欄の中〉の同じ文字は見ない。入力欄が無いときは `確認待ち`、問いが `Do you want to ` で始まれば `許可待ち`。入力欄があるときは問いがあっても `確認待ち`）。どれにも当たらなければ `unknown`（`実行中`）。詳しくは「分からない画面の扱い」 |
| 中断の 2 回目の前の扱い                 | main は 1 回目の Esc だけを書いて結果を返し、2 回目は renderer が画面を確かめ直してから頼むときだけ書く（明示の確かめ。opt-in）。main の表が 2 回目の有無・待つ時間（100ms）・受け付ける期限（1 回目から 400ms）を決め、renderer は「2 回目を頼むか・頼まないか」だけを選べる（回数を増やせない・文字列を渡せない）。2 回目の前に画面が作業中でなくなっていれば頼まない（入力待ちで Esc を 2 回送ると、書きかけの消去・巻き戻しの画面になるため）。詳しくは「中断の流れ」                                                                                                                                                                                                               |
| 中断の 2 回目の IPC                     | 新しい IPC `agentTerminal:interruptFollowUp`（引数は `sessionId` だけ。main が固定の `\x1b` を書く）。`agentTerminal:interrupt` の結果の `sent` に、2 回目を頼む案内（`followUp: { afterMs } \| null`）を足す。`claude` は `null`（今までどおり 1 回）                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 中断の待ち（クールダウン）              | 値は今の 1,000ms（タブごと）のまま。2 回目を頼む案内がある流れ（`copilot`）では、2 回目の流れが終わった時点（2 回目の結果が届いた・頼まなかった・読めなかった時点。`finish` の直前）で 1,000ms の待ちを数え直す。こうすると、次に押した 1 回目は前の 2 回目から常に 1,000ms 以上空き、IPC の遅れに関わらず `copilot` の 500ms の窓で前の Esc と組にならない（押した時点から数えたままだと、1 回目の IPC の遅れが次の回より 100ms 以上大きいと 500ms を切りうる。前提を書き添えるより、数え直す方が保証が単純で安全）。`claude` は今までどおり押した時点から数える。結果を待つ間（同期の再入の防止）は 2 回目が終わるまで続ける                                                          |
| 中断の文言                              | `claude` の文言は変えない。CLI で違う部分（押すキーの説明・許可待ちでの Esc の意味・判定できないときの案内・動いていない旨・終了した旨）を、renderer の `agentInterruptMessages.ts` の種類ごとの表（`Record<AgentCliKind, …>`）で引く。`copilot` は `中断（作業中の copilot に Esc を 2 回送る）`・`copilot 1 に中断（Esc を 2 回）を送りました` など（「文言」）                                                                                                                                                                                                                                                                                                                       |
| 中断の後の画面の記録                    | `claude` の台帳（`agentScreens.json`）は変えない。`copilot` は別の台帳 `copilotScreens.json`（新規）を作り、段階 0 の記録（中断の後の画面を含む）から写す。新しく記録はしない（段階 0 で中断の後・許可の取り消しの後・キューの後の画面を記録済み）。個人情報の置き換えとハッシュの固定は `claude` の台帳と同じ作り（「実装の最初に確かめること」）                                                                                                                                                                                                                                                                                                                                      |
| 通知の文言の変え方                      | 通知の依頼（`agentNotification:show`）に `cliKind`（必須）を足し、main は検証した種類と番号から `formatAgentTabLabel(tabNumber, cliKind)` で題を作る（`copilot 1: 作業が終わりました`）。本文（`次の指示を待っています` など）は CLI に依らない文言のまま。読み上げ（renderer）も同じ関数で `copilot 1 の作業が終わりました`。種類はタブの名前と同じ値（`AgentSessionTabView.cliKind`）を使い、名前と題が食い違わない。renderer の値は固定の表の選択にしか使わない（L-019）                                                                                                                                                                                                             |
| hooks への作業中の知らせ                | `useAgentHooksWorkingReport` は、`changeAttribution` が `true` の種類のタブだけを知らせる（`copilot` は区別をしないので送らない）。能力の表の `screenActivity` の説明から「hooks への作業中の知らせ」を外し、`changeAttribution` の説明に移す                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 段階 1 の「判定しない・押せない」の扱い | 消さずに残す。段階 1 の止め方は「能力が `false` なら購読しない・押せない」の能力で分ける形（`useAgentActivity` の `forget`・`getAgentInterruptAvailability` の `interrupt` の判定・`agentNotificationUnsupportedNote`）なので、`copilot` の能力を `true` にすれば外れる。今は能力が `false` の種類が無いが、ほかの CLI を足すときに使う。テストは能力の表を差し替える `vi.mock` で「能力が無い種類」を作って確かめる（`copilot` を例にしていたテストを書き換える）                                                                                                                                                                                                                      |
| 判定に使う種類                          | `useAgentActivity` は、判定の時点のタブ（`tabsRef` の最新）の `cliKind` で判定の関数を引く。控えに種類は持たない（動いているタブの種類は起動の結果で決まり動いている間は変わらず、同じタブで別の種類を起動し直すときは必ず `exited → starting → running` を通るので、今の「`running` へ入る・出る」の区切りで判定の予約も記録も消える）                                                                                                                                                                                                                                                                                                                                                 |

## 範囲

含めるもの:

- shared: 能力の表の `copilot` の `screenActivity`・`interrupt` を `true` に・説明の直し、中断の結果の型（`followUp`）と 2 回目の結果の型、通知の依頼の `cliKind`、通知の文言の種類の引数
- main: 中断の送り方の表（`agentCliInterruptSpecs.ts`。新規）、`AgentSession` の 2 回目の受け付け、registry と受け口（`agentTerminal:interruptFollowUp`）、通知の依頼の検証と題
- renderer: 判定の表（`agentScreenClassifiers.ts`）・`claude` の判定の移動・`copilot` の判定（`copilotScreenActivity.ts`）、`useAgentActivity` の種類ごとの判定、中断の 2 回目（`useAgentInterrupt`・`useAgentSessions`）・中断の文言の種類ごとの表、通知の出来事の種類、hooks への作業中の知らせの絞り込み
- テスト（`copilot` の画面の台帳・判定・中断の 2 回目・通知・配線、実物の node-pty で 2 回の Esc の間隔を確かめる統合テスト）、実機テスト仕様書・ROADMAP の更新

含めないもの（次の段階に回す事項）:

- `copilot` へのプロンプトの送信（入力欄の空の判定・消去・貼り付け・`!` の扱い・送信前の確認）と、履歴への CLI の種類の記録。段階 2b
- `copilot` の hooks による変更の区別、`copilot` のセッションの再開、起動の記録への CLI の種類の記録。段階 3
- `copilot` の版の確認（判定の規則は 1.0.87 の記録に合わせる。版で変わったら台帳を記録し直す。「既知の制約」）
- 中断と完了を区別した通知（`claude` と同じく、中断の後の `working → idle` は完了として知らせる）
- `claude`・`copilot` 以外の CLI

## copilot の画面（段階 0 の記録の要点）

`report.md`・`screens.md` から、判定に使う事実だけを抜き出す。記録は GitHub Copilot CLI 1.0.87・node-pty 1.1.0・`@xterm/headless` 6.0.0、100 列 × 30 行を中心に 40・60・80・120 列。

1. **入力欄**: 作業中も残る。全幅の `─` の行・`❯ ` の行（シェルのモードは `! `、`--screen-reader` では `Start of Prompt Indicator`）・全幅の `─` の行の 3 段で、2 行目以降は 2 桁の字下げ。その下の 1〜3 行が帯（40 列では 2〜3 行に折り返す）。
   上の罫線の上の行は作業ディレクトリ。代替画面（`?1049h`）で描くので、画面の末尾（`readScreen`）が常に今の画面
2. **帯の文言**:
   - 入力待ち: `← open sidebar · / commands · ? help · tab next tab`（書きかけは `@ files · # issues`、シェルのモードは `shell`、Esc 1 回の直後は `esc again to clear input`・`esc again to rewind`、Ctrl+C 1 回の直後は `ctrl+c again to exit`、`?` のヘルプは `any key close help`、`/` の一覧は `/help show help`）。右端にモデル名
   - 作業中: `◎ Working · 30 B esc interrupt`（列 1 はスピナー `○ ◎ ◉ ●`。最初の応答の前は `○ Working esc interrupt`。語は `Working`・`Executing`・`Cancelling` など。書きかけがあると後ろに `· ctrl+q enqueue`）。作業中に Esc 1 回の直後は `● Working · 137 B esc again to interrupt`（約 500ms で戻る）
   - 応答の表示中・最初の応答の前・推論中・シェルのツールの実行中・キュー（pending・Queued）があるとき・リサイズの後のすべてで `esc interrupt` が出た
3. **許可の確認**: 入力欄と帯が消え、`╭`〜`╰` の枠の中に `Do you want to run this command?`・番号付きの選択肢・`↑/↓ to navigate · enter to select · esc to cancel`。`--screen-reader` では問いと案内が枠の外に出る
4. **ほかの選択の画面**: 起動直後のフォルダの信頼（`Do you trust the files in this folder?` と同じ案内）、巻き戻し（`↑↓ Navigate · Enter Select · Esc Cancel`。綴りが違う）。どちらも入力欄が無い
5. **Esc の効き方**: 作業中は 1 回では止まらず、500ms 以内（`let rt=500`。実測で 450ms は効き 600ms は効かない。80〜150ms で効いた）の 2 回で中断する（子プロセスも消え、書きかけは残る。pending と Queued は直後に自動で送られる）。
   許可の確認では 1 回で操作ごと取り消し、2 回目は入力待ちの 1 回目（`esc again to rewind`）。入力待ちで 2 回は、書きかけがあれば消し、空なら巻き戻しの画面を開く（履歴が無ければ `Nothing to rewind yet`）
6. **中断の後**: 会話に `● Operation cancelled by user`（ツールの行は `✗ Shell … Operation aborted by user`）が出て、帯が入力待ちの形に戻る
7. **記録できなかった場面**: シェル以外の許可の確認（apply_patch・URL の取得・MCP）、`ask_user` の選択、GitHub のモデルでの帯の語、背景のエージェント・履歴の圧縮中の帯、許可の確認での Ctrl+C、アプリの xterm.js との違い

## 画面の判定の規則

### 判定の表（`lib/agentScreenClassifiers.ts`。新規）

```ts
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentActivity } from './agentActivity'
import type { ViewportLine } from './agentViewport'
import { classifyClaudeScreen } from './claudeScreenActivity'
import { classifyCopilotScreen } from './copilotScreenActivity'

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

- 入力は画面の末尾（`controller.readScreen()`。今の `claude` の判定と同じ `ViewportLine[]`）、出力は今の 5 つの活動（`working`・`idle`・`permission`・`confirm`・`unknown`）。活動の種類は増やさない（表示・通知・まとめ・中断の理由の表がそのまま使える）
- `lib/claudeScreenActivity.ts`（新規）: 今の `agentActivity.ts` の `classifyAgentScreen` と、その規則の定数・補助の関数（スピナー・要約の行・許可の段落・todo の行など）を中身を変えずに移し、`classifyClaudeScreen` に改名する。`claude` の入力欄の判定（`agentInputBox.ts`）は送信でも使うので動かさない
- `lib/agentActivity.ts`: `AgentActivity` の型・`isAgentActivityWaitingForUser`・`AgentActivityWaitingForUser` だけを残す（CLI に依らない）
- 判定を直接呼んでいた箇所（`useAgentActivity` の既定の判定・`checkAgentInterruptAtPress`）は `classifyAgentScreenFor` に替える。`classifyAgentScreen` の名前は残さない（`claude` の判定をそのまま `copilot` のタブに使う取り違えを型の上で起こさない）

### copilot の判定（`lib/copilotScreenActivity.ts`。新規）

規則の定数（文言）はこのファイルに閉じる。`claude` の定数（`esc to interrupt`・スピナーの記号 `·✢✳✶✻✽*`・`Enter to confirm` など）とは共有しない。

```ts
/** 全幅の罫線の行(行全体が ─ で 20 文字以上)。枠の中の `│ ─── │` は行頭が │ なので当たらない */
const BORDER = /^─{20,}$/
/** 入力欄の記号の行(`❯ `・`! `・--screen-reader の `Start of Prompt Indicator`) */
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
```

各行は `lineText(line).trimEnd()`（末尾の空白を除いた文字列）にしてから規則をかける。アプリの画面の行は列の数まで空白で埋まり、台帳の行は右の空白を除いてあるので、どちらでも同じ判定にするため（`BORDER` などの `$` は末尾の空白があると当たらない）。

入力欄の特定（`locateCopilotInputBox(texts)`。このファイルの中の関数。送信の段階 2b で使うときに切り出す。結果は `CopilotInputBox`〈`top`・`bottom`・`band`・`bandHead`〉か `null`）:

1. 画面の下から、`BORDER` に当たる最初の行を下の罫線にする。無ければ入力欄なし
2. 下の罫線より上で `BORDER` に当たる最初の行を上の罫線にする。無い・間に行が無ければ入力欄なし（入力欄が画面の高さを超えて上の罫線が見えない画面も、入力欄なしとして扱う。判定は下の 4. で `unknown` になる）
3. 間の 1 行目が `SYMBOL_LINE` に当たり、2 行目以降がすべて `CONTINUATION` に当たれば入力欄あり。そうでなければ入力欄なし
4. 帯は下の罫線より下の行。各行の前後の空白を除き、空でない行を空白 1 つでつないだ文字列（連続する空白は 1 つにする）を帯の文字列にする（40 列などで折り返した案内 `esc` / `interrupt` も 1 つの文字列で見る）

判定（上から順に、最初に当てはまったもの。例外は投げない）:

| 順  | 条件                                                                                                                                                                      | 活動         | 根拠                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 入力欄なし・画面に `SELECTION_HINT` の行があり、その行から上へ `DIALOG_TOP` の行に当たるまでの間に、行頭の `│`・`┃` と空白を除くと `PERMISSION_QUESTION` で始まる行がある | `permission` | シェルのコマンドの許可の確認（記録済み）。シェル以外のツールの確認も同じ部品の画面だと見込んで同じ規則で拾う（「分からない画面の扱い」）          |
| 2   | 入力欄なし・画面に `SELECTION_HINT` の行がある                                                                                                                            | `confirm`    | フォルダの信頼の確認・巻き戻しの画面（記録済み）。問いの分からない選択の画面も、利用者の選択を待つものとして扱う                                  |
| 3   | 入力欄なし                                                                                                                                                                | `unknown`    | 描き直しの途中・終了の後の通常画面・未知の画面                                                                                                    |
| 4   | 入力欄あり・入力欄の中（上の罫線から下の罫線まで）以外の行（上の罫線より上と、下の罫線より下の帯）に `SELECTION_HINT` の行がある。問いがあっても `permission` にはしない  | `confirm`    | 記録には無い（入力欄と選択の案内が同時に出る画面）。`ask_user` などの未知の選択の画面（入力欄の下に選択が出る形を含む）を作業中・入力待ちとしない |
| 5   | 入力欄あり・帯の文字列が `INTERRUPT_HINTS` のどれかを含む                                                                                                                 | `working`    | 応答の表示中・最初の応答の前・推論中・シェルのツールの実行中・キューがあるとき・Esc 1 回の直後のすべてで出た（記録済み）                          |
| 6   | 入力欄あり・帯が空                                                                                                                                                        | `unknown`    | 描き直しの途中                                                                                                                                    |
| 7   | 入力欄あり・帯の空でない最初の行（前後の空白を除く）が `BAND_SPINNER` に当たる                                                                                            | `unknown`    | 作業中の帯はスピナーで始まる（記録済み）。案内の語が変わった・折り返しで案内が切れた作業中の画面を入力待ちとしない                                |
| 8   | 入力欄あり                                                                                                                                                                | `idle`       | 入力待ちの帯（空・書きかけ・シェルのモード・Esc や Ctrl+C の直後・`?`・`/`）はどれもスピナーで始まらず、中断の案内を含まない（記録済み）          |

- 中断の案内は帯（下の罫線より下）だけで見る。会話の本文・`❯ …` の履歴・上の罫線の上の行に同じ文字があっても作業中にしない（Esc を送る側に倒さない。L-041）
- `claude` の画面を `copilot` の判定に渡しても作業中にはならない（`claude` の帯の案内は `esc to interrupt` で、`esc interrupt` を含まない）。表の取り違えを配線のテストで確かめる（「テスト方針」）
- dim・反転の属性は使わない（文字だけで判定する。`--screen-reader` でも同じ文言が出るため）

### 分からない画面の扱い

段階 0 で記録できなかった場面と、その判定と、誤ったときの向き。どの場面も「作業中でないのに `working`」「利用者の操作を待っているのに `idle`」にならない側に倒す。

| 場面                                                                                                     | 見込みの画面と判定                                                                                                                               | 外れたときの向き                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| シェル以外の許可の確認（apply_patch・URL の取得・MCP）                                                   | 入力欄が消え、選択の案内と `Do you want to …?` の問いが出れば `permission`。問いが別の文言なら `confirm`                                         | どちらも「利用者の操作を待っている」活動で、中断は押せず、通知とステータスバーの強調が出る。外れても `許可待ち` が `確認待ち` と出るだけ。選択の案内の綴りまで変わると `unknown`（`実行中`）になり、通知が出ない（「既知の制約」）                                                                                                                |
| `ask_user` の選択                                                                                        | 入力欄の外（上の罫線より上と帯。入力欄が無ければ画面全体）に選択の案内が出れば、入力欄の有無に関わらず `confirm`                                 | 選択の案内が無く入力欄で答える形なら `idle` と判定しうる。中断は押せない（正しい）が、作業中からの変化を完了として知らせる（「既知の制約」）                                                                                                                                                                                                      |
| GitHub のモデルでの帯の語                                                                                | 語（`Working` など）が違っても、中断の案内 `esc interrupt` は語と別の要素なので `working`                                                        | 案内そのものが変わると、帯の先頭のスピナー（順 7）で `unknown` に倒れる（入力待ちにしない）。スピナーも無い形（`--screen-reader` など）では `idle` と判定しうる（「既知の制約」）                                                                                                                                                                 |
| 背景のエージェント・履歴の圧縮中                                                                         | 帯に中断の案内があれば `working`（Esc 2 回は圧縮の取り消し・中断として働く。report.md の優先順位）。無ければ `idle`                              | 背景のエージェントだけが動く間を `idle` と判定しうるが、中断は押せず、Esc は送らない                                                                                                                                                                                                                                                              |
| 作業中に `?` のヘルプを開いた                                                                            | 帯が `any key close help` になり `idle`                                                                                                          | 作業中を入力待ちと判定し、完了の通知・自動の取り直しが早く起きうる。中断は押せない（Esc は送らない）（「既知の制約」）                                                                                                                                                                                                                            |
| 会話に選択の案内と同じ文字が見えている（`copilot` が案内の文字を含むファイルを表示した・応答で引用した） | 入力欄の上の会話の行に `SELECTION_HINT` が当たり、順 4 で `confirm`（中断の案内より先に当たる。探す範囲は狭めない）                              | その文字が画面に残る間は、作業中でも `確認待ち` と出て中断を押せず、作業中から変わった時点で確認待ちの通知と自動の取り直しが出て、作業が終わっても `入力待ち` にならない。利用者の操作を待っているのに `入力待ち` にはしない側に倒した結果（`ask_user` の形が分からないため、枠の中や入力欄の直上に限る見込みの規則にはしない）（「既知の制約」） |
| 40 列より狭い幅                                                                                          | 帯の折り返しで案内が切れても、つないだ文字列で見る。項目ごとの段組みで語の間に別の項目が挟まると案内が見えないが、帯の先頭のスピナーで `unknown` | `working` が `実行中` と出るだけで、入力待ちにはしない                                                                                                                                                                                                                                                                                            |
| 入力欄が画面の高さを超えた書きかけ                                                                       | 上の罫線が見えず入力欄なし → 選択の案内が無ければ `unknown`                                                                                      | 作業中でも `実行中`。`useAgentActivity` の上限の判定は `unknown` を採らずに前の活動を保つ（今の作り）。押した時点の読み直しが `unknown` なので中断は送らない                                                                                                                                                                                      |
| 終了の後（通常画面に戻った）                                                                             | 入力欄なし → `unknown`                                                                                                                           | セッションの終了で記録は消える（今の作り）                                                                                                                                                                                                                                                                                                        |

## 中断の流れ

### main の送り方の表（`src/main/agentCliInterruptSpecs.ts`。新規）

```ts
import type { AgentCliKind } from '@shared/agentCliKinds'

// CLI の種類ごとの中断の送り方(段階 1 の起動の表 agentCliLaunchSpecs と同じ流儀)。書くバイトは固定の Esc(AGENT_INTERRUPT_SEQUENCE)で、
// 回数・間隔・期限は main だけが決める(L-019)。renderer は 2 回目を「頼む」か「頼まない」かだけを選べる。
// 文言の表(renderer の agentInterruptMessages.ts の AGENT_INTERRUPT_KEY_TEXTS)と回数を合わせる

export interface AgentCliInterruptFollowUpSpec {
  /** 1 回目を書いてから、renderer が 2 回目を頼むまでに待つ時間(1 回目の結果で renderer に案内する) */
  afterMs: number
  /**
   * main が 2 回目を受け付ける、1 回目からの経過の下限。これより早い依頼は書かない(2 回を 1 つの読み取りに詰めて送らないための守り)。
   * afterMs より小さくし、renderer のタイマーが少し早く発火しても断らない余裕を持たせる
   */
  minIntervalMs: number
  /** 1 回目からこの時間を過ぎた依頼は書かない(CLI の 2 回の窓の内に届けるため) */
  deadlineMs: number
}

export interface AgentCliInterruptSpec {
  /** 2 回目の Esc。null なら 1 回だけ */
  followUp: AgentCliInterruptFollowUpSpec | null
}

export const AGENT_CLI_INTERRUPT_SPECS: Record<AgentCliKind, AgentCliInterruptSpec> = {
  claude: { followUp: null },
  copilot: { followUp: { afterMs: 100, minIntervalMs: 50, deadlineMs: 400 } }
}
```

| 種類      | 1 回目 | 2 回目                                                                                                                              | 根拠                                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude`  | `\x1b` | なし                                                                                                                                | 作業中の Esc 1 回で中断する（2026-10-19 の設計書。今までどおり）                                                                                                                                                                                                                                                                                                                                    |
| `copilot` | `\x1b` | renderer に 100ms 待たせ（`afterMs`）、1 回目から 50ms 以上（`minIntervalMs`）・400ms 以内（`deadlineMs`）に頼まれたときだけ `\x1b` | 2 回の窓は 500ms（`let rt=500`）。80〜150ms で効き、450ms は効いた。100ms は利用者の決定。期限の 400ms は、pty への書き込みから `copilot` が読むまでの遅れの余裕（100ms）を窓から引いた値。受け付けの下限の 50ms は、renderer のタイマーが 100ms より少し早く発火しても断らないよう待ちより小さくした値で、2 回を 1 つの読み取りに詰めない間隔としては十分（最終レビューの Minor-1 で待ちと分けた） |

### main（`AgentSession`・registry・受け口）

`AgentSession`（`agentSession.ts`）:

```ts
export interface AgentSessionParams {
  id: string
  pty: PtyLike
  callbacks: AgentSessionCallbacks
  stopTree: StopTree
  /** この起動の CLI の中断の送り方(starter が起動の計画の種類で AGENT_CLI_INTERRUPT_SPECS から引く。L-018) */
  interruptSpec: AgentCliInterruptSpec
  /** 単調増加の時刻(ms)。本番は monotonicNow、テストは偽の時計 */
  now: () => number
}

/** 単調増加の時刻(performance.now)。AgentSessionParams.now の本番の値(参照が安定した関数) */
export const monotonicNow = (): number => performance.now()

/** 作業の中断の 1 回目。2 回目が要る種類なら、待つ時間を返して 2 回目の依頼を受け付ける */
interrupt():
  | { kind: 'sent'; followUp: { afterMs: number } | null }
  | { kind: 'not-alive' }
  | { kind: 'write-failed' }

/** 作業の中断の 2 回目(renderer が画面を確かめ直してから頼む) */
interruptFollowUp(): 'sent' | 'not-pending' | 'expired' | 'not-alive' | 'write-failed'
```

- `interrupt()`: 今と同じく、終了の後・停止の途中は `not-alive`、`pty.write(AGENT_INTERRUPT_SEQUENCE)` が投げれば `write-failed`。書く前に前の控えを消す（書けなかった 1 回目の後に、前の 1 回目の控えで 2 回目を書かない）。書けたら、種類の `followUp` があれば書いた時刻を `followUpSince` に控え（前の控えは上書き）、`{ kind: 'sent', followUp: { afterMs } }` を返す。無ければ `{ kind: 'sent', followUp: null }`
- `interruptFollowUp()`: 控えは 1 回で使い切る（先に読み出して `null` に戻す）。終了の後・停止の途中は `not-alive`。控えが無ければ（2 回目の無い種類・頼まれる前に使い切った・同じセッションへの 2 回目の依頼）`not-pending`。
  1 回目からの経過が `minIntervalMs` 未満なら `not-pending`（renderer は結果を受け取ってから `afterMs` 待つので、正しい呼び出しでは起きない。2 回を 1 つの読み取りに詰めて送らないための守り。下限を `afterMs` と同じにすると、renderer のタイマーが少し早く発火したときに断ってしまうため、`afterMs` より小さい別の値にする）、`deadlineMs` を超えたら `expired`（書かない）。間なら `\x1b` を書いて `sent`（投げれば `write-failed`）。経過の判定は表の側の純粋関数 `judgeAgentCliInterruptFollowUpTiming(followUp, elapsedMs)`（`agentCliInterruptSpecs.ts`。`too-early`・`in-window`・`expired`）で、1 回目・2 回目の書き込みは同じ私的なメソッドで行う
- 停止・終了（`finish`）で控えを消す
- `startAgentSession` の引数に `interruptSpec`・`now` を足して `AgentSession` に渡す（省略できない。L-060）。starter（`agentSessionStarter.ts` の `spawnSession`）は `AGENT_CLI_INTERRUPT_SPECS[launch.plan.cliKind]` と `monotonicNow` を渡す（起動の計画の種類を使い、設定を読み直さない。L-018）
- 外部プロセスを待たない（どちらも `pty.write` は同期で返る。待ちは renderer の固定のタイマー。L-052）

registry（`agentSessionRegistry.ts`）:

- `interrupt(ownerId, sessionId): AgentInterruptResult` は、セッションの `sent` の `followUp` をそのまま結果に載せる（`not-alive` → `no-session`、`write-failed` → `write-failed` は今のまま）
- `interruptFollowUp(ownerId, sessionId): AgentInterruptFollowUpResult` を足す。照合は `write`・`interrupt` と同じ `findBySessionId`（所有者の枠の現在のセッションの id との一致。停止中・別のウィンドウ・起動し直す前の古い `sessionId` は `no-session`。L-037）。セッションの `not-alive` は `no-session` に写す

受け口（`handlers/agentTerminalHandlers.ts`）:

```ts
ipcMain.handle(
  'agentTerminal:interruptFollowUp',
  (event: IpcMainInvokeEvent, sessionId: unknown): AgentInterruptFollowUpResult => {
    if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
    return registry.interruptFollowUp(event.sender.id, parseAgentSessionId(sessionId))
  }
)
```

- `AgentTerminalHandlerDeps.registry` の `Pick` に `'interruptFollowUp'` を足す。送信元のフレームの確認・`sessionId` の検証は `agentTerminal:interrupt` と同じ。renderer から書くバイト列・回数・時間を受け取らない（L-019）
- 中断の IPC は今までどおり main で CLI の能力を見て拒否しない（段階 1 の決定。同じバイトはターミナルのキー入力でも送れるため）。ただし 2 回目は main の控えが無ければ書かないので、renderer が 2 回目だけを繰り返し呼んでも余分な Esc は届かない

### 共有の型（`src/shared/types/agentTerminal.ts`）

```ts
/** 中断の 2 回目の案内(main の種類ごとの表で決める。renderer は回数・間隔を決めない) */
export interface AgentInterruptFollowUp {
  /** 1 回目を書いてから、2 回目を頼むまでに待つ時間(ms) */
  afterMs: number
}

/** 中断(agentTerminal:interrupt)の結果。main は固定の 1 バイトを書けたかと、2 回目を頼むかの案内を返す */
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

preload（`api.ts`・`index.d.ts`）に `interruptAgentSessionFollowUp: (sessionId: string): Promise<AgentInterruptFollowUpResult> => ipcRenderer.invoke('agentTerminal:interruptFollowUp', sessionId)`（引数は `sessionId` だけ）、renderer の `lib/agentTerminalApi.ts` に同じ名前の窓口を足す。

### renderer（押せるかの判定と押した処理）

押せるかの判定（`lib/agentInterrupt.ts`）は今の順（起動中 → CLI が中断に対応していない → 閉じる途中 → 送信中 → 確認の表示中 → 送っている途中・1,000ms 以内 → 活動）のまま。変えるのは次の 3 つ。

- 活動の理由 `describeAgentInterruptBlockedByActivity(activity, cliKind)`（種類を必須の引数に足す。許可待ち・判定できないの文言が CLI で違うため。「文言」。文言は `agentInterruptMessages.ts` の `agentInterruptBlockedByActivityReason(activity, kind)` が作り、この関数はそれを呼ぶだけにする）
- 押した時点の読み直し（`checkAgentInterruptAtPress`）は `classifyAgentScreenFor(input.cliKind, readScreen())` で判定する（タブの種類の規則で読む。`copilot` の画面を `claude` の規則で読んで作業中と取り違えない）
- 2 回目の前の確かめ `checkAgentInterruptFollowUp(cliKind, readScreen)`（新規。下の手順 7）: `classifyAgentScreenFor(cliKind, readScreen())` が `working` なら `{ kind: 'send' }`、それ以外は `{ kind: 'skip'; activity }`、読めなければ `{ kind: 'unreadable'; error }`

`useAgentSessions`（sessionId の持ち主）:

```ts
export type AgentInterruptOutcome =
  /** followUp は 2 回目を頼む案内。sessionId は 1 回目を送ったセッション(2 回目を同じセッションにだけ頼むため) */
  | { kind: 'sent'; followUp: { afterMs: number; sessionId: string } | null }
  | { kind: 'skipped' }
  | { kind: 'stale' }
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
  | { kind: 'error'; message: string }

export type AgentInterruptFollowUpOutcome =
  | { kind: 'sent' }
  /** 頼む時点か結果が届いた時点で、そのタブのセッションが 1 回目と違う・閉じる途中(IPC を呼ばない・結果を出さない) */
  | { kind: 'stale' }
  | { kind: 'not-pending' }
  | { kind: 'expired' }
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
  | { kind: 'error'; message: string }

interruptFollowUp: (slotId: string, sessionId: string) => Promise<AgentInterruptFollowUpOutcome>
```

- `interrupt` は、main の `sent` の `followUp` に送った `sessionId` を添えて返す
- `interruptFollowUp(slotId, sessionId)`: そのタブの今の `sessionId` が渡された値と違う、またはタブが閉じる途中なら IPC を呼ばずに `stale`。`Promise.resolve().then(() => agentTerminalApi.interruptAgentSessionFollowUp(sessionId))` で呼び（L-055）、結果（拒否を含む）が届いた時点でも `sessionId` と閉じる途中かを確かめる（違う・閉じる途中なら `stale`。L-037）。
  `not-pending`・`expired`・`no-session`・`write-failed`・`error` は、そのタブの `error` に「エラー処理」の文言を出す。`sent` は、そのタブの `error` が中断の失敗の文言なら消す（今の `clearInterruptError`）
- 失敗の文言の CLI の名前は、そのタブの種類（`cliKind ?? appCliKind`。段階 1 のタブの名前と同じ値）のコマンド名

`useAgentInterrupt` の `onInterrupt`（2026-10-19 の設計書の手順に、5〜8 を足す）:

1. 同期の再入の防止（今のまま）
2. 最新の値で押せるかを求め直す（今のまま）
3. 押した時点の画面の読み直し（タブの種類の規則。上）。作業中でなければ理由を読み上げて終える
4. `begin(slotId)`（送っている途中と 1,000ms の待ち。今のまま）
5. `interrupt(slotId)` を待つ。`sent` で `followUp` が `null`（`claude`）なら、今と同じく `agentInterruptSentNotice(label, cliKind)` を読み上げて終える
6. `sent` で `followUp` があれば（`copilot`）、`followUp.afterMs` だけ待つ。待ちのタイマーは `useAgentInterruptFollowUpWait` が控え、アンマウントで消す（消したら 2 回目を頼まない。main の控えは期限で無効になる。L-052）
7. 2 回目の前の確かめ: 押した時点のタブ（手順 2 で控えたタブ。待つ間に別のタブを選んでも、送った先のタブ）の controller の画面を `checkAgentInterruptFollowUp(tab.cliKind, …)` で読む
   - 待つ間に送った先のタブが閉じられていたら（`isTabOpen(slotId)` が偽。`useAgentWorkspace` が `agentSessions.tabs` から渡す。省略できない引数）、画面を読まずに終える。アンマウントの後は 2 回目の待ちを始めない
   - `send` → `interruptFollowUp(slotId, followUp.sessionId)` を待ち、`sent` なら `agentInterruptSentNotice(label, cliKind)`（`copilot 1 に中断（Esc を 2 回）を送りました`）を読み上げる。失敗は `useAgentSessions` がタブの `error` に出している。`stale` は何も出さない
   - `skip`（作業が終わった・許可の確認に変わった・判定できない）→ 2 回目を頼まず、`agentInterruptFollowUpSkippedNotice(label, activity)` を読み上げる。`unknown` は作業が続いていることがあるので文言を分ける（`idle`・`permission`・`confirm` は `copilot 1 が作業中でなくなったため、2 回目の Esc は送りませんでした`、`unknown` は `copilot 1 が作業中か判定できなかったため、2 回目の Esc は送りませんでした（まだ作業中なら、少し待ってからもう一度押してください）`）
   - `unreadable` → 2 回目を頼まず、console に記録する
8. 2 回目を頼む案内があった流れでは、手順 7 が終わった時点（2 回目の結果が届いた・頼まなかった・読めなかった・アンマウント以外の例外）で `restartCooldown(slotId)`（`useAgentInterruptCooldown` に足す。そのタブの 1,000ms の待ちを今から数え直す）を呼ぶ。次の 1 回目を前の 2 回目から常に 1,000ms 以上空けるため（「決めたこと」の「中断の待ち」）
9. `finally` で `finish(slotId)`（2 回目まで終わってから。結果を待つ間の再入の防止を 2 回目の間も続ける）

- 2 回目の前の確かめでは、送信中・送信前の確認の表示中・閉じる途中を描画の値で見直さない。送信は `copilot` では使えず（`promptSend` が `false`）、閉じる途中は `interruptFollowUp` が `stale` で止める。段階 2b で送信を足すときは、2 回目を待つ間に送信を始めない守りを足す（「次の段階の見通し」）
- 2 回目を頼まなかったとき、1 回目の Esc は届いている。作業中に届いた 1 回目は `esc again to interrupt` を出すだけで作業は続き（約 500ms で戻る）、作業が終わった後に届いた 1 回目は入力待ちの 1 回目（`esc again to clear input`・`esc again to rewind`）になるだけで、どちらも書きかけを消さない

### 2 回目の前の危険と、残る危険

2 回目の Esc が入力待ちの `copilot` に届き、1 回目と 500ms の窓で組になると、書きかけがあれば消え、空なら巻き戻しの画面が開く（履歴が無ければ `Nothing to rewind yet` を出す）。

- main が時刻だけで 2 回目を書く作りでは、押した時点の確かめから 2 回目までの約 100ms の間に作業が終わると、この危険が起きる
- この設計では、2 回目の直前に renderer が画面を確かめ直し、作業中のときだけ頼む。残る間は「確かめた時点の画面が `copilot` の今の状態より遅れている分（pty → main → renderer → xterm の反映。通常は数十 ms 以内）」と「頼んでから `copilot` が 2 回目を読むまで（IPC と pty の書き込み。数 ms）」だけになる
- 作業中から許可の確認に変わった直後に 2 回目が届いた場合は、2 回目が許可の確認の取り消し（操作ごと）として働く。押した時点の確かめから 2 回目までの間に許可の確認が出たときに限られ、利用者は作業を止める操作をしているので、結果（操作の取り消し）は中断に近い
- 残る危険は「既知の制約」に書く

### 中断の後の記録・連打・待ち

| 項目                     | 扱い                                                                                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 中断の後の画面の記録     | `copilot` の台帳 `copilotScreens.json`（新規）に、段階 0 で記録した中断の後の画面（応答の表示中・書きかけあり・ツールの実行中・キューがあるとき・許可の確認の取り消しの後）を入れ、判定のテストで固定する。`claude` の台帳は変えない（「実装の最初に確かめること」） |
| 連打の対策               | 今の組（1,000ms の待ち・同期の再入の防止・`event.detail > 1` の無視・キーリピートの抑止・`aria-disabled` でフォーカスを残す。L-408・L-157）をそのまま使う。同期の再入の防止は 2 回目まで続くので、2 回目を待つ間の押し直しは何もしない                               |
| 1,000ms の待ち           | 値は変えない。`copilot` の 2 回目の流れでは、流れが終わった時点で待ちを数え直す（手順 8）ので、待ちが明けた後の 1 回目は前の 2 回目から常に 1,000ms 以上空き、500ms の窓で組にならない（`AGENT_INTERRUPT_COOLDOWN_MS` のコメントに `copilot` の根拠を足す）          |
| フォーカス               | 今のまま（押した後もフォーカスは `中断` に残る。セッションが終わって `中断` が消えたら `起動` へ移す）                                                                                                                                                               |
| エージェントの変更の確認 | `copilot` は hooks による区別をしない（段階 1 の `cli-unsupported`）ので、中断の後の保留の規則（2026-10-13 の設計書）は当たらない。記録・一覧は今までどおり                                                                                                          |

### 新しい状態と既存の入口（L-061）

新しい状態は「中断の 1 回目を送り、2 回目を待っている間」（`copilot` のタブごと。最長で約 400ms と IPC の往復）。

| 入口                                                    | 2 回目を待つ間   | 理由                                                                                                                                               |
| ------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 帯の `中断`（同じタブ）                                 | 何もしない       | 同期の再入の防止（2 回目まで続く）と 1,000ms の待ち                                                                                                |
| 帯の `中断`（別のタブ）                                 | 許す             | 待ちはタブごと（今の作り）                                                                                                                         |
| プロンプトの `実行`・履歴の `再実行`・送信前の確認      | —（押せない）    | `copilot` では `promptSend` が `false`。段階 2b で送信を足すときに扱いを決める                                                                     |
| ターミナルのキー入力（`writeAgentSession`）             | 許す（変えない） | 利用者の打鍵。この間に利用者が Esc を押すと、`copilot` は帯の Esc と組にしうる（「既知の制約」）                                                   |
| `終了`・タブの `×`・フォルダや実行方式や CLI の切り替え | 許す             | セッションを止めると `sessionId` の控えが変わり、2 回目は `stale`（IPC を呼ばない）。main でも停止中のセッションは照合で一致しない（`no-session`） |
| タブの選択                                              | 許す             | 2 回目は送った先のタブの画面で確かめ、そのタブに頼む                                                                                               |
| リサイズ・作業中の知らせ                                | 影響しない       | —                                                                                                                                                  |

## 通知・表示・自動の取り直し

### 帯・タブ・ステータスバーの表示

`useAgentActivity` が `copilot` のタブも購読し、種類の判定の関数で活動を記録する。表示の文言（`作業中`・`入力待ち`・`許可待ち`・`確認待ち`・`実行中`）・ステータスバーのまとめ（`エージェント: 許可待ち 1 · 作業中 2`）・押したときに選ぶタブの規則は CLI に依らないので変えない。

`useAgentActivity` の変更:

- `classify` の型を `(kind: AgentCliKind, lines: readonly ViewportLine[]) => AgentActivity` にし、既定を `classifyAgentScreenFor` にする（テストは偽の判定を渡せる）。判定の時点のタブ（`tabsRef` の最新）の `cliKind` で引く
- 控え（`TabWatch`）に種類は持たない。同じタブで別の種類を起動し直すときは必ず `exited → starting → running` を通り、今の区切りで判定の予約も記録も消える（「決めたこと」の「判定に使う種類」）
- 能力が `false` の種類は購読しない作り（`forget`）は残す（「決めたこと」）

### 完了・許可待ちの通知

| 層                                                   | 変更                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shared（`types/agentNotification.ts`）               | `AgentNotificationShowRequest` に `cliKind: AgentCliKind`（必須。題の CLI の名前にだけ使う）                                                                                                                                                               |
| shared（`agentNotificationText.ts`）                 | `agentNotificationText(kind, tabNumber, cliKind)`（種類を必須の引数にする。省略で `claude` に倒れない。L-060）。名前は `formatAgentTabLabel(tabNumber, cliKind)`。段階 1 の「通知は claude の名前にする」のコメントを消す                                  |
| main（`handlers/agentNotificationPayloadParser.ts`） | `isAgentCliKind(payload.cliKind)` で検証し、知らない値は `cliKind は claude・copilot のどれかである必要があります` で投げる（`AGENT_CLI_KINDS` から作る）。`claude` に倒さない（L-044）                                                                    |
| main（`agentNotifications.ts`）                      | `show` が検証した `cliKind` を `agentNotificationText` に渡す。題・本文は今までどおり固定の表から作る（renderer の文字列を通知に出さない。L-019）                                                                                                          |
| renderer（`lib/agentNotificationEvents.ts`）         | `AgentNotificationTab`・`AgentNotificationEvent` に `cliKind: AgentCliKind`（必須）。出来事の決定（`nextAgentNotification`・`advanceAgentNotifications`）は変えず、出来事にタブの種類を写す。読み上げ（`formatAgentNotificationAnnouncement`）も種類を渡す |
| renderer（`hooks/useAgentNotifications.ts`）         | 出来事をそのまま依頼に送る（今の作り。出来事の型に `cliKind` が入る）                                                                                                                                                                                      |

- 種類はタブの表示（`AgentSessionTabView.cliKind`。段階 1 でタブの名前に使う値）をそのまま使うので、タブの名前と通知の題・読み上げは食い違わない。`useAgentWorkspace` は `agentSessions.tabs` をそのまま渡している（構造上の型で `cliKind` が入る）
- main はタブの番号と同じく、`cliKind` を題の名前にだけ使い、押したときに届く先（`slotId`）を変えない（L-023）。renderer が違う種類を送っても、固定の表のどちらかの名前が出るだけ
- 通知の本文（`ツールの実行の許可を待っています`・`選択を待っています`・`次の指示を待っています`）は CLI に依らない文言なので変えない
- 設定の `エージェントの通知` に添えていた `copilot では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）` は、`agentNotificationUnsupportedNote` が `screenActivity` を見ているので出なくなる（コードは変えない）。設定の画面の使えない機能の一覧も、能力の表から作るので `プロンプトの送信（実行・再実行）、利用者の変更との区別、前回の続きから・このセッションで再開` になる

### 変更の一覧の自動の取り直し

`useAgentChangesAutoRefresh` は活動の出来事（`advanceAgentNotifications` の `events`）を契機にしているので、`copilot` のタブの活動が記録されると、完了・許可待ち・確認待ちで取り直す。コードは型（`AgentNotificationTab` の `cliKind`）の追随だけ。

### hooks への作業中の知らせ

`useAgentHooksWorkingReport` のタブに `cliKind` を足し、`agentCliCapabilities(cliKind).changeAttribution` が `false` のタブは知らせず、控えも持たない（`copilot` のセッションは main の hooks が `cli-unsupported` で、知らせは使われない）。
能力の表の説明を直す（`screenActivity` から「hooks への作業中の知らせ」を外し、`changeAttribution` に「画面の作業中・作業の終わりを main の区間の追跡へ知らせること」を足す）。

### 能力の表（`src/shared/agentCliKinds.ts`）

```ts
copilot: {
  displayName: 'GitHub Copilot CLI',
  commandName: 'copilot',
  capabilities: {
    promptSend: false,
    screenActivity: true,
    interrupt: true,
    changeAttribution: false,
    sessionResume: false
  }
}
```

- `interrupt` の説明（`帯の中断(Esc を 1 回)`）を `帯の中断(送り方は main の agentCliInterruptSpecs.ts。claude は Esc を 1 回、copilot は 2 回)` に直す。不変条件「`interrupt` が真なら `screenActivity` も真」はそのまま（テストで固定）

## 文言

`lib/agentInterruptMessages.ts` に種類ごとの表を足す。`claude` の文言は今と同じになる。

```ts
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

export const AGENT_INTERRUPT_KEY_TEXTS: Record<AgentCliKind, AgentInterruptKeyTexts>
```

| 場所                                       | `claude`（今と同じ）                                                                     | `copilot`                                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `中断` の `aria-label`                     | `中断（作業中の claude に Esc を送る）`                                                  | `中断（作業中の copilot に Esc を 2 回送る）`                                                                                       |
| 送れたときの読み上げ                       | `claude 1 に中断（Esc）を送りました`                                                     | `copilot 1 に中断（Esc を 2 回）を送りました`（2 回目を送れたとき）                                                                 |
| 2 回目を頼まなかったときの読み上げ         | —                                                                                        | `copilot 1 が作業中でなくなったため、2 回目の Esc は送りませんでした`（入力待ち・許可待ち・確認待ちのとき）                         |
| 2 回目の前に判定できなかったときの読み上げ | —                                                                                        | `copilot 1 が作業中か判定できなかったため、2 回目の Esc は送りませんでした（まだ作業中なら、少し待ってからもう一度押してください）` |
| 許可待ちの理由                             | `許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）` | `許可待ちのため中断できません（Esc は操作の取り消しになります。ターミナルで答えてください）`                                        |
| 判定できないときの理由                     | `作業中か判定できないため押せません（ターミナルで Esc を押すと中断できます）`            | `作業中か判定できないため押せません（ターミナルで Esc を続けて 2 回押すと中断できます）`                                            |
| 確認待ち・入力待ちの理由                   | 今の文言                                                                                 | 同じ（CLI に依らない）                                                                                                              |
| 動いていない（帯には出さない）             | `claude が動いていないため中断できません`                                                | `copilot が動いていないため中断できません`                                                                                          |
| 終了した（`no-session`）                   | `中断を送れませんでした: claude が終了したか、起動し直しました`                          | `中断を送れませんでした: copilot が終了したか、起動し直しました`                                                                    |
| 2 回目の期限切れ（`expired`）              | —                                                                                        | `中断を送れませんでした: 2 回目の Esc が間に合いませんでした（まだ作業中なら、もう一度押してください）`                             |
| 2 回目を受け付けていない（`not-pending`）  | —                                                                                        | `中断を送れませんでした: 2 回目の Esc を送れる状態ではありませんでした（まだ作業中なら、もう一度押してください）`                   |

- 関数の形: `agentInterruptAriaLabel(kind)`・`agentInterruptSentNotice(label, kind)`・`agentInterruptFollowUpSkippedNotice(label, activity)`（`unknown` とそれ以外で文言を分ける）・`agentInterruptBlockedByActivityReason(activity, kind)`（`permission`・`unknown` は種類の表から作り、`confirm`・`idle` は今の定数。`agentInterrupt.ts` の `describeAgentInterruptBlockedByActivity(activity, cliKind)` がこれを呼ぶ）・
  `agentInterruptNotRunningReason(commandName)`・`agentInterruptNoSessionError(commandName)`（今の定数 `AGENT_INTERRUPT_NOT_RUNNING`・`AGENT_INTERRUPT_ERROR_NO_SESSION` を置き換える）・`AGENT_INTERRUPT_ERROR_FOLLOW_UP_EXPIRED`・`AGENT_INTERRUPT_ERROR_FOLLOW_UP_NOT_PENDING`（接頭辞は今の `AGENT_INTERRUPT_ERROR_PREFIX`）
- 文字列に CLI の名前を直書きせず、コマンド名は `AGENT_CLI_PROFILES[kind].commandName` から作る
- 押すキーの回数の文言（`Esc を 2 回`）と main の表の回数は別のプロセスの持ち物なので、それぞれのテストで固定し、両方のファイルの先頭のコメントに相手のファイルの名前を書く
- 段階 1 で「次の段階に回す」とした文言のうち、中断の理由・読み上げ（`agentInterruptMessages.ts`）と通知の題・読み上げをこの段階で CLI ごとにする。前回の続きから・変更の区別・送信前の確認の `claude` の文言は、`copilot` で使えない機能のものなので段階 2b・3 に回す

## エラー処理

| 場面                                                             | main の結果                       | renderer の扱い                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 回目を送れた・2 回目の要る種類                                 | `sent`（`followUp: { afterMs }`） | `afterMs` 待ってから画面を確かめ直す（「中断の流れ」の手順 6・7）                                                                                                |
| 2 回目の前に作業中でなくなった                                   | （呼ばない）                      | 2 回目を頼まず、`copilot 1 が作業中でなくなったため、2 回目の Esc は送りませんでした` を読み上げる                                                               |
| 2 回目の前に判定できなかった（描き直しの途中など）               | （呼ばない）                      | 2 回目を頼まず、`copilot 1 が作業中か判定できなかったため、2 回目の Esc は送りませんでした（まだ作業中なら、少し待ってからもう一度押してください）` を読み上げる |
| 2 回目の前に画面を読めない                                       | （呼ばない）                      | 2 回目を頼まず、console に記録する                                                                                                                               |
| 2 回目を待つ間に終了・起動し直し・閉じる途中                     | （呼ばない）                      | `stale`。何も出さない（終了は帯の状態の文言で分かる）                                                                                                            |
| 2 回目が期限を過ぎた（負荷で遅れた）                             | `expired`（書かない）             | タブの `error` に `中断を送れませんでした: 2 回目の Esc が間に合いませんでした（まだ作業中なら、もう一度押してください）`                                        |
| 2 回目を受け付けていない                                         | `not-pending`                     | タブの `error` に `中断を送れませんでした: 2 回目の Esc を送れる状態ではありませんでした（まだ作業中なら、もう一度押してください）`                              |
| 2 回目の時点でセッションが無い（終了の知らせが renderer より先） | `no-session`                      | タブの `sessionId` が同じなら `中断を送れませんでした: copilot が終了したか、起動し直しました`。違えば `stale`                                                   |
| 2 回目の pty への書き込みが例外                                  | `write-failed`                    | `中断を送れませんでした: ターミナルへの書き込みに失敗しました`                                                                                                   |
| 2 回目の IPC の拒否・同期の例外                                  | `invoke` の拒否                   | `中断を送れませんでした: <例外の message>`（`Promise.resolve().then` で拒否として扱う。L-055）                                                                   |
| 通知の依頼の `cliKind` が不正                                    | `invoke` の拒否                   | `useAgentNotifications` の今の扱い（console に記録して続ける）。renderer は型でタブの種類だけを送る                                                              |

1 回目の失敗（`no-session`・`write-failed`・拒否）は今の扱いのまま（文言の CLI の名前だけをタブの種類にする）。

## 実装の最初に確かめること（copilot の画面の台帳）

段階 0 の記録（`.superpowers/agent-cli-kind/copilot-screens-recorder/out/*/snaps.json`。git 管理外）から、判定のテストの入力にする台帳を作る。新しく `copilot` を起動して記録はしない。

1. **変換のスクリプト**（`.superpowers/agent-cli-kind/copilot-screens-recorder/to-fixture.js`。git 管理外なので PR に入らない）: 下の表の場面を `snaps.json` から読み、`claude` の台帳と同じ形（`screens.<名前>.lines` は 行番号 → `[文字列, dim の範囲, 反転の範囲]`）で書き出す。
   文字列は記録の `attrs[].text` を明示的に `trimEnd` したもの（記録の `text` は帯の行などで末尾に空白が残るため）、範囲は `attrs[].segs` の `d`（dim）・`inv`（反転）の区間。選んだ場面に全角の文字が無いことを確かめ（あれば止める）、列の位置をそのままセルの位置にする。列・行の数は `snaps.json` に無いので、フォルダの名前からではなく、場面の `label` に大きさがあればそれ（`working-resized-60x20` は 60×20）、無ければフォルダの名前の列の数と `text` の行の数から決める（`resized60` を 80×24 と書かない）。`_note` に `GitHub Copilot CLI 1.0.87・node-pty 1.1.0・@xterm/headless 6.0.0 で記録した` と形式の説明を書く
2. **個人情報の置き換え**: `fixtures/README.md` の `sanitize.py` と同じ規則（記録時の一時ディレクトリ `/private/tmp/claude-\d+/-Users-[^/"]+` を同じ長さの `/home/user/project/xxx…` に、UUID の 16 進を `0` に、折り返された UUID も）を、`claude` と同じスクリプトでかける（実際は `sanitize.py` に規則 1' を足したものを `sanitize-copilot.py` として、変換のスクリプトと同じフォルダ〈git 管理外〉に置いた。記録の作業ディレクトリ `…/<UUID>/scratchpad/copilot-research/work`、信頼の確認の枠の中のパス、終了の画面の `copilot --resume=<UUID>`）。
   copilot の台帳では、規則 1 の後に規則 1'「`/private/tmp/claude-\d+/` で始まり `-Users-` を含まない（`.../` で省略された）パス（正規表現 `/private/tmp/claude-\d+/[^\s")]*`）も、同じ長さの `/home/user/project/x…` にする」を足す（`permission3` の選択肢の `(/private/tmp/claude-<UID>/.../work)`、`resized60`・`idle40`・`working40` の作業ディレクトリの行 `/private/tmp/claude-<UID>/.../work` が規則 1 に当たらないため）。変わる行は、規則 1 の行（作業ディレクトリ・信頼の確認のパス）に加えて、少なくともこの 4 画面の 4 行。規則 1' は `fixtures/README.md` の `copilotScreens.json` の節にも書く。
   置き換えた後の台帳（`copilotScreens.json`）の SHA-256 は `8fe11e4ae5507f1859cbe61dc754062e904e15fd106adff978d1479a41154aaf`、変わった行の数は 41（変換の後・置き換えの前の SHA-256 は `6a1673c5ba581c71a2f26fa79a1484f4574a3bff6fb4678df86493e1d0438e95`）。
   置き換えた後に `copilotScreensFixture.test.ts`（新規）の個人情報のテスト（ユーザー名・`/Users/`・`/private/tmp/claude-`・0 以外の 16 進を含む UUID が無い）が通ることを確かめてから、SHA-256 を固定する
3. **置き場**: `src/renderer/src/lib/__tests__/fixtures/copilotScreens.json`（`.prettierignore` に足す。整形しない）・`copilotScreens.ts`（`agentScreens.ts` と同じ読み出し。行の配列にするのは `agentScreens.ts` の `toRecordedScreen` を使う）。`fixtures/README.md` に `copilotScreens.json` の節（版・画面の数・元の記録・SHA-256・変わった行の数・版を上げたら記録し直すこと）を足す
4. **場面と期待**（`copilotScreenActivity.test.ts` の `EXPECTED`。全画面がどれかの期待に入っていないと落ちるテストも `claude` と同じく置く）

| 名前                     | 元の記録（`out/<フォルダ>` の `label`）             | 期待         |
| ------------------------ | --------------------------------------------------- | ------------ |
| `trust`                  | `stream-100x30` の `trust`                          | `confirm`    |
| `idle`                   | `stream-100x30` の `idle`                           | `idle`       |
| `idleDraft`              | `stream-100x30` の `idle-draft`                     | `idle`       |
| `working250`             | `stream-100x30` の `working+250`                    | `working`    |
| `working3000`            | `stream-100x30` の `working+3000`                   | `working`    |
| `beforeFirstToken`       | `thinking-100x30` の `before-first-token+300`       | `working`    |
| `reasoning`              | `thinking-100x30` の `reasoning+800`                | `working`    |
| `workingDraft`           | `queue-100x30` の `working-draft`                   | `working`    |
| `afterEscWorking`        | `stream-100x30` の `after-esc-working+300`          | `working`    |
| `afterEscWorking1500`    | `stream-100x30` の `after-esc-working+1500`         | `working`    |
| `interrupted`            | `esc2-100x30-gap150` の `esc2-gap150+300`           | `idle`       |
| `interruptedDraft`       | `interruptdraft-100x30` の `after-escesc-draft+400` | `idle`       |
| `done`                   | `stream-100x30` の `done`                           | `idle`       |
| `reasoningDone`          | `thinking-100x30` の `reasoning-done`               | `idle`       |
| `toolDone`               | `toolok-100x30` の `done`                           | `idle`       |
| `permission`             | `permission-100x30` の `permission ok=true`         | `permission` |
| `permissionDown`         | `permission-100x30` の `permission-down`            | `permission` |
| `permission3`            | `toolrun-100x30` の `permission ok=true`            | `permission` |
| `afterEscPermission`     | `permission-100x30` の `after-esc-permission+300`   | `idle`       |
| `afterEscEscPermission`  | `escesc-100x30` の `after-escesc-permission+150`    | `idle`       |
| `toolRunning`            | `toolrun-100x30` の `toolrun+1500`                  | `working`    |
| `afterEscToolRunning`    | `toolrun-100x30` の `after-esc-toolrun+300`         | `working`    |
| `interruptedToolRunning` | `escesc-100x30` の `after-escesc-toolrun+300`       | `idle`       |
| `draftEsc`               | `input2-100x30` の `draft-esc+150`                  | `idle`       |
| `rewindHint`             | `input2-100x30` の `after-question-clear`           | `idle`       |
| `rewindPicker`           | `idleesc-100x30` の `hist-escesc-empty`             | `confirm`    |
| `help`                   | `input2-100x30` の `question-empty`                 | `idle`       |
| `ctrlcWorking`           | `ctrlc-100x30` の `after-ctrlc-working+300`         | `idle`       |
| `ctrlcDraft`             | `ctrlc-100x30` の `after-ctrlc-draft+300`           | `idle`       |
| `exited`                 | `ctrlc-100x30` の `after-ctrlc-empty+300`           | `unknown`    |
| `pending`                | `queue-100x30` の `working-queued+400`              | `working`    |
| `ctrlqQueued`            | `queue2-100x30` の `ctrlq-queued`                   | `working`    |
| `interruptedPendingSent` | `queue2-100x30` の `after-escesc-queued+400`        | `working`    |
| `paste12`                | `input-100x30` の `paste-12lines`                   | `idle`       |
| `multiline`              | `input2-100x30` の `ctrl-j`                         | `idle`       |
| `shellMode`              | `input2-100x30` の `bang-empty`                     | `idle`       |
| `slashList`              | `input2-100x30` の `slash-empty`                    | `idle`       |
| `idle80`                 | `widths-80x24` の `idle`                            | `idle`       |
| `working80`              | `widths-80x24` の `working+1000`                    | `working`    |
| `resized60`              | `widths-80x24` の `working-resized-60x20`           | `working`    |
| `idle40`                 | `widths-40x20` の `idle`                            | `idle`       |
| `working40`              | `widths-40x20` の `working+1000`                    | `working`    |
| `srTrust`                | `stream-100x30-sr` の `trust`                       | `confirm`    |
| `srIdleDraft`            | `stream-100x30-sr` の `idle-draft`                  | `idle`       |
| `srWorking`              | `stream-100x30-sr` の `working+800`                 | `working`    |
| `srAfterEsc`             | `stream-100x30-sr` の `after-esc-working+300`       | `working`    |
| `srPermission`           | `permission-100x30-sr` の `permission ok=true`      | `permission` |
| `srPermissionDown`       | `permission-100x30-sr` の `permission-down`         | `permission` |

記録の画面で期待と違う判定になったら、規則を直す（記録が正）。直しても記録と矛盾する場合は、その場面の扱いを設計書の「既知の制約」に書き、実装のプランの差異として残す。

## 構成

| ファイル                                                                                                                           | 変更                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/agentCliKinds.ts`                                                                                                      | `copilot` の `screenActivity`・`interrupt` を `true`。`screenActivity`・`interrupt`・`changeAttribution` の説明                                                                                                                                                                                                      |
| `src/shared/types/agentTerminal.ts`                                                                                                | `AgentInterruptFollowUp`・`AgentInterruptResult` の `followUp`・`AgentInterruptFollowUpResult`                                                                                                                                                                                                                       |
| `src/shared/types/agentNotification.ts`・`src/shared/agentNotificationText.ts`                                                     | 通知の依頼の `cliKind`・文言の種類の引数                                                                                                                                                                                                                                                                             |
| `src/main/agentCliInterruptSpecs.ts`（新規）                                                                                       | 種類ごとの中断の送り方・2 回目の経過の判定（`judgeAgentCliInterruptFollowUpTiming`）                                                                                                                                                                                                                                 |
| `src/main/agentSession.ts`                                                                                                         | `interrupt` の結果の `followUp`・`interruptFollowUp`・`AgentSessionParams.interruptSpec`・`now`・`monotonicNow`・`startAgentSession` の引数                                                                                                                                                                          |
| `src/main/agentSessionStarter.ts`                                                                                                  | 起動の計画の種類の送り方と `monotonicNow` を渡す                                                                                                                                                                                                                                                                     |
| `src/main/agentSessionRegistry.ts`                                                                                                 | `interrupt` の `followUp`・`interruptFollowUp`                                                                                                                                                                                                                                                                       |
| `src/main/handlers/agentTerminalHandlers.ts`                                                                                       | `agentTerminal:interruptFollowUp`・deps の `Pick`                                                                                                                                                                                                                                                                    |
| `src/main/handlers/agentNotificationPayloadParser.ts`・`src/main/agentNotifications.ts`                                            | `cliKind` の検証・題                                                                                                                                                                                                                                                                                                 |
| `src/preload/api.ts`・`src/preload/index.d.ts`・`src/renderer/src/lib/agentTerminalApi.ts`                                         | `interruptAgentSessionFollowUp`                                                                                                                                                                                                                                                                                      |
| `src/renderer/src/lib/agentActivity.ts`                                                                                            | 判定を外し、CLI に依らない活動の型と表だけにする                                                                                                                                                                                                                                                                     |
| `src/renderer/src/lib/claudeScreenActivity.ts`（新規。移動）                                                                       | `classifyClaudeScreen`（今の `classifyAgentScreen` を中身を変えずに移して改名）                                                                                                                                                                                                                                      |
| `src/renderer/src/lib/copilotScreenActivity.ts`（新規）                                                                            | `classifyCopilotScreen`・入力欄の特定                                                                                                                                                                                                                                                                                |
| `src/renderer/src/lib/agentScreenClassifiers.ts`（新規）                                                                           | `AGENT_SCREEN_CLASSIFIERS`・`classifyAgentScreenFor`                                                                                                                                                                                                                                                                 |
| `src/renderer/src/hooks/useAgentActivity.ts`                                                                                       | 判定の時点のタブの種類で判定の関数を引く                                                                                                                                                                                                                                                                             |
| `src/renderer/src/lib/agentInterrupt.ts`・`agentInterruptMessages.ts`                                                              | 種類の規則での読み直し・`checkAgentInterruptFollowUp`・種類ごとの文言・待ちのコメント                                                                                                                                                                                                                                |
| `src/renderer/src/hooks/useAgentInterrupt.ts`                                                                                      | 2 回目の流れ（待ち・確かめ・読み上げ・1,000ms の待ちの数え直し）。2 回目を頼むまでの待ちのタイマーと後始末は `useAgentInterruptFollowUpWait.ts`〈新規〉に分ける                                                                                                                                                      |
| `src/renderer/src/hooks/useAgentInterruptCooldown.ts`                                                                              | `restartCooldown`（2 回目の流れが終わった時点で 1,000ms の待ちを数え直す）                                                                                                                                                                                                                                           |
| `src/renderer/src/hooks/useAgentSessions.ts`                                                                                       | `interrupt` の `followUp`・`interruptFollowUp`（`AgentSessionsState` に必須で足す）・失敗の文言の CLI の名前（IPC の呼び出しと古いセッションの結果の仕分けは `lib/agentInterruptInvocation.ts`〈新規〉の `invokeForCurrentSession`、失敗の文言の選択は `agentInterruptMessages.ts` の `agentInterruptFailureError`） |
| `src/renderer/src/hooks/useAgentWorkspace.ts`                                                                                      | `useAgentInterrupt` に `interruptFollowUp` を渡す                                                                                                                                                                                                                                                                    |
| `src/renderer/src/components/agent/AgentTerminalPanel.tsx`                                                                         | `中断` の `aria-label` を種類で引く                                                                                                                                                                                                                                                                                  |
| `src/renderer/src/lib/agentNotificationEvents.ts`・`hooks/useAgentNotifications.ts`・`hooks/useAgentChangesAutoRefresh.ts`         | 通知のタブと出来事の `cliKind`                                                                                                                                                                                                                                                                                       |
| `src/renderer/src/hooks/useAgentHooksWorkingReport.ts`                                                                             | `changeAttribution` の無い種類を知らせない                                                                                                                                                                                                                                                                           |
| `src/renderer/src/lib/__tests__/fixtures/copilotScreens.json`（新規）・`copilotScreens.ts`（新規）・`README.md`・`.prettierignore` | `copilot` の画面の台帳                                                                                                                                                                                                                                                                                               |
| `docs/manual-test-spec.md`・`ROADMAP.md`                                                                                           | 「実機テスト仕様書の新しい項目の下書き」・「ROADMAP の更新の方針」                                                                                                                                                                                                                                                   |
| テスト                                                                                                                             | 「テスト方針」の各ファイル。`agentActivity.test.ts` は `claudeScreenActivity.test.ts` に名前を変える（中身は判定の関数の名前だけを直す。`agentActivity.ts` に残る `isAgentActivityWaitingForUser` のテストだけは `agentActivity.test.ts` に残す）。`fixtures/README.md` の `agentActivity.ts` への言及も直す         |

## テスト方針

vitest。main は今のテストの作り（偽の pty・偽の時計）、renderer は `@testing-library/react` と `window.api` の偽物と偽の controller（`makeFakeController`。`screen` に台帳の画面を入れる）。
能力が無い種類（段階 1 の「使えない機能」の確かめ）のテストは、能力の表を差し替えるテストの補助 `src/renderer/src/__tests__/agentCliCapabilityOverrides.ts`（`overrideAgentCliCapabilities`。差し替えた種類は `screenActivity` と `interrupt` を両方偽にする）を `vi.mock` から使う。
実物の `copilot` はテストで起動しない。pty を通す確かめは、一時ディレクトリに置いた小さな node のスクリプト（偽の実行ファイル）を実物の node-pty で起動して行う。

- shared
  - `agentCliKinds.test.ts`: `copilot` の能力が `screenActivity`・`interrupt` だけ真（ほかは偽）・どの種類も `interrupt` が真なら `screenActivity` も真
  - `agentNotificationText.test.ts`: 種類ごとの題・読み上げ（`copilot 1: 許可待ち`・`copilot 1 の作業が終わりました`）、本文は種類で変わらない
- main
  - `agentCliInterruptSpecs.test.ts`（新規）: `claude` は `followUp: null`、`copilot` は `afterMs: 100`・`minIntervalMs: 50`・`deadlineMs: 400`、`copilot` の `afterMs` が 80 以上で `deadlineMs` が 500 未満（段階 0 の実測の範囲。値の根拠をテスト名に書く）、2 回目のある種類はどれも `0 < minIntervalMs < afterMs < deadlineMs`（2 回目の無い種類は回さない）。`judgeAgentCliInterruptFollowUpTiming` の境界（`minIntervalMs`・`deadlineMs` のちょうど・前後）と負の経過（`too-early`）
  - `agentSession.test.ts`（偽の時計）: `copilot` の送り方で `interrupt` が `['\x1b']` だけを書き `followUp: { afterMs: 100 }` を返す・100ms 後の `interruptFollowUp` で 2 回目を書く（書いた列の完全一致 `['\x1b', '\x1b']`）・50ms ちょうどと 99ms（renderer のタイマーの早い発火）では書く・49ms では `not-pending` で書かない・401ms では `expired` で書かない・2 回目の後の 2 回目は `not-pending`・
    `claude` の送り方では `followUp: null` で `interruptFollowUp` は `not-pending`・1 回目の後に `stop`・終了したら `not-alive`・2 回目の書き込みが投げたら `write-failed`（控えは使い切り、続けて頼んでも書き直さない）・1 回目の書き込みが投げたら控えを作らない（その後の 2 回目は `not-pending`）・前の 1 回目の控えが残る間に次の 1 回目の書き込みが投げたら、前の控えで 2 回目を書かない・控えが残る間の次の 1 回目は控えを新しい時刻で上書きする
  - `agentSessionRegistry.test.ts`: `interrupt` が `followUp` をそのまま返す・`interruptFollowUp` は現在のセッションだけに送り、別の所有者・古い `sessionId`・停止中は `no-session`
  - `agentSessionStarter.test.ts`: `copilot` の計画で起動したセッションの `interrupt` が `followUp` を返し、`claude` の計画では `null`（starter が計画の種類の送り方を渡す）
  - `handlers/agentTerminalHandlers.test.ts`: `agentTerminal:interruptFollowUp` はメインフレーム以外・空の `sessionId` を拒否し、`registry.interruptFollowUp` に `event.sender.id` と `sessionId` だけを渡して結果をそのまま返す・余分な引数を渡しても変わらない
  - `handlers/agentNotificationPayloadParser.test.ts`: `cliKind` が `claude`・`copilot` は通り、無い・知らない文字列・数は投げる
  - `agentNotifications.test.ts`: `show` の題が依頼の種類の名前になる
  - `agentSession.integration.test.ts`（実物の node-pty。Windows では飛ばす。L-059）: 子に、標準入力を raw モードにして読み取りごとに受け取ったバイトを 1 行ずつ書き出す node のスクリプト（一時ディレクトリに置く）を起動し、`copilot` の送り方で `interrupt` → 子が 1 回目を読み取ったのを待ち、renderer と同じく `interrupt` から `afterMs` の 100ms まで待つ（Node の `setTimeout` はループのキャッシュした時刻で数えるので、`performance.now()` で測ると 100ms より少し早く呼ばれることがあるが、受け付けの下限の 50ms との間に余裕がある）→ `interruptFollowUp` を呼ぶ。2 回の間隔は、子がいつ動くかに左右されないよう親の側（`interrupt` と `interruptFollowUp` を呼ぶ直前の時刻の差が 80ms 以上）で確かめ、子の側では `1b` が 2 回、別々の読み取りで届いたこと（`['1b', '1b']`）だけを確かめる。1 回目の読み取りを待ってから 2 回目を頼むので、2 回が 1 回の読み取りに入る（`['1b1b']`）ことは無い。ただし、子の 1 回目の読み取りが期限の 400ms より遅れると 2 回目は `expired` で落ちる（失敗の文言の経過時間で見分けられる。1 回目を読み取っていないことも、待った直後に別の失敗の文言で確かめる）（「`1b` が合わせて 2 つ」に緩めると、main が 1 回目で 2 バイトをまとめて書く誤りを見逃すため、緩めない。ローカルレビュー第 2 周で、子の受信の時刻の差を確かめていたのを改めた）
- preload: `api.test.ts` で `interruptAgentSessionFollowUp('id')` が `ipcRenderer.invoke('agentTerminal:interruptFollowUp', 'id')` を呼ぶ（引数は 2 つだけ）
- renderer の判定
  - `copilotScreensFixture.test.ts`（新規）: 台帳の SHA-256 と個人情報のテスト
  - `copilotScreenActivity.test.ts`（新規）: 台帳の全画面の `EXPECTED`（「実装の最初に確かめること」4）と、手書きの画面（`makeLine`）で
    - 帯の案内が 2 行に折り返された（`◎ Working · 18 B esc` / `interrupt`）→ `working`
    - 帯がスピナーで始まり案内が無い（`◎ Thinking · 18 B`）→ `unknown`、`--screen-reader` の形（スピナーが空白）で案内が無い → `idle`（既知の制約の固定）
    - 入力欄の上の会話に `esc interrupt`・`esc again to interrupt` の文字があり帯が入力待ち → `idle`
    - 入力欄が無く、会話に全幅の `─` の行と `esc interrupt` がある → `unknown`（`working` にしない）
    - シェル以外の許可の見込みの画面（`│ Do you want to edit this file? │` と選択の案内）→ `permission`、問いの無い選択の画面 → `confirm`、選択の案内が入力欄の上にある → `confirm`、選択の案内が下の罫線より下（帯の領域）にある → `confirm`、入力欄があり、その上に `Do you want to …?` の問いと選択の案内がある → `confirm`（`permission` にしない）
    - 帯が空・上の罫線が見えない（入力欄が画面の高さを超えた）→ `unknown`
    - 入力欄の上の会話に選択の案内の文字（`↑/↓ to navigate · enter to select`）があり、帯に `esc interrupt` → `confirm`（既知の制約の固定）
    - 書きかけ（入力欄の中の 1 行目と、2 桁の字下げの 2 行目）に選択の案内の文字があり、帯が入力待ちの形 → `idle`、帯に `esc interrupt` → `working`（入力欄の中の案内は見ない）
    - 各行を列の数まで空白で埋めた作業中（台帳の `working3000` を 100 列まで埋めたもの）→ `working`、同じく埋めた入力待ち（`idle`）→ `idle`（アプリの `lineText` の行と同じ形でも判定が変わらない）
    - 選択の案内の上に `Do you want to` があっても、その間に行頭の `╭` の行がある（問いが別の枠・会話の中）→ `confirm`
    - 行頭の `╭` の無い選択の画面（screen-reader の形）で、選択の案内から離れた上の会話の続きの行に `Do you want to` がある → `permission`（既知の制約の固定）
  - `claudeScreenActivity.test.ts`（`agentActivity.test.ts` から改名）: 今のテストのまま（関数の名前だけを直す）。`isAgentActivityWaitingForUser` のテストは `agentActivity.test.ts` に残す
  - `agentScreenClassifiers.test.ts`（新規）: 表が種類ごとに正しい関数を引く（`copilot` の作業中の台帳の画面は `copilot` で `working`・`claude` で `working` 以外、`claude` の作業中の台帳の画面は `claude` で `working`・`copilot` で `working` 以外）
- renderer の中断
  - `agentInterrupt.test.ts`: `checkAgentInterruptAtPress` がタブの種類の規則で読む（`copilot` の作業中の画面は `copilot` で `send`、`claude` の種類として渡すと `blocked`）、`checkAgentInterruptFollowUp` の `send`・`skip`（入力待ち・許可待ち・判定できない）・`unreadable`（`skip` に活動が載る）、
    `describeAgentInterruptBlockedByActivity` の種類ごとの文言。能力が無い種類の理由（段階 1 の `agentInterruptUnsupportedReason`）は、能力の表を `vi.mock` で差し替えたテストで確かめる
  - `agentInterruptMessages.test.ts`: 「文言」の表の全部（`claude` の文言が今と同じであることを含む）
  - `useAgentSessions.test.ts`: `interrupt` の `sent` に `followUp` と `sessionId` が載る、`interruptFollowUp` の各結果（`sessionId` が違う・閉じる途中は IPC を呼ばず `stale`・結果を待つ間に起動し直して `stale`・結果を待つ間に閉じる途中になって `stale`・`expired`・`not-pending`・`no-session`・`write-failed`・拒否・同期の例外〈L-055〉）とタブの `error` の出し方・消し方（文言の CLI の名前がタブの種類）
  - `useAgentInterrupt.test.ts`（偽のタイマー）: `copilot` のタブで、押すと 1 回目の IPC、`afterMs` の後に画面が作業中なら 2 回目の IPC が同じ `sessionId` で呼ばれ、`copilot 1 に中断（Esc を 2 回）を送りました` が読み上げられる・
    `afterMs` の間に画面を入力待ち（台帳の `done`）に替えると 2 回目を呼ばず、`copilot 1 が作業中でなくなったため、2 回目の Esc は送りませんでした` が読み上げられる・判定できない画面（帯が空の手書きの画面）に替えると 2 回目を呼ばず、判定できなかった旨の文言が読み上げられる・2 回目の流れが終わった時点から 1,000ms の待ちを数え直す（終わった時点から 999ms は押せず 1,000ms で押せる。押した時点から数えると落ちる）・許可待ち（`permission`）でも呼ばない・`afterMs` の前は 2 回目を呼ばない・2 回目を待つ間の同じタブの押し直しは何もしない・待つ間に別のタブを選んでも 2 回目は送った先のタブの画面で確かめて送った先に頼む・待つ間に別のタブを押しても 2 回目はそれぞれのタブの `sessionId` でそれぞれに頼み、待ちの数え直しは送った先のタブに付く・待つ間に送った先のタブを閉じたら（選択はほかのタブへ移る）画面を読まず頼まない・
    アンマウントで 2 回目を呼ばずタイマーを残さない（`afterEach` で偽のタイマーを戻す）・`claude` のタブは今までどおり 1 回だけ（2 回目の窓口を呼ばない）
  - `useAgentInterruptCooldown.test.ts`: `restartCooldown` がそのタブの待ちを今から数え直す（前のタイマーを消す・ref と描画の値の両方・ほかのタブは変えない・アンマウントでタイマーを残さない）
  - `useAgentInterruptFollowUpWait.test.ts`（新規）: `afterMs` を待ち終えたら `true`、待つ間のアンマウントでタイマーを消して `false`、アンマウントの後に呼ばれたらタイマーを足さずに `false`、同時に待つ流れはそれぞれ解決する、参照が安定
  - `agentInterruptInvocation.test.ts`（新規）: `invokeForCurrentSession` が、結果・拒否が届いた時点で今のセッションでなければ `stale`、拒否と同期の例外は `error`（L-055）、`isCurrent` を結果が届いた後に確かめる
  - `AgentTerminalPanel.test.tsx`: `中断` の名前が選択中のタブの種類で変わる
- renderer の判定の hook・通知
  - `useAgentActivity.test.ts`: `copilot` のタブの出力で `copilot` の判定が使われ活動が記録される（偽の判定に渡る種類を確かめる）・能力が無い種類は購読しない（能力の表の `vi.mock`。段階 1 の `copilot` のテストを書き換える）
  - `agentNotificationEvents.test.ts`: 出来事にタブの種類が写る・読み上げが種類の名前になる
  - `useAgentNotifications.test.ts`: `copilot` のタブで作業中から入力待ちに変わると、`showAgentNotification` に `cliKind: 'copilot'` が渡り、読み上げが `copilot 1 の作業が終わりました`（段階 1 の「copilot のタブでは知らせない」テストを置き換える）
  - `useAgentChangesAutoRefresh.test.ts`: `copilot` のタブの完了でも取り直す
  - `useAgentHooksWorkingReport.test.ts`: `copilot` のタブは作業中・作業の終わりを知らせない・`claude` のタブは今までどおり
  - `agentCliMessages.test.ts`: `copilot` の使えない機能の注記が 3 つ（送信・区別・再開）になり、通知の項目の注記は `null`。注記が出る経路（能力が無い種類）は `vi.mock` で確かめる
- **配線**（L-060）: `useAgentWorkspace.test.ts` で、起動の結果が `copilot` のタブに、偽の controller の `screen` を台帳の作業中の画面にして出力を書くと帯の状態が `作業中` になり、
  実物の組み立て役から `agentTerminal.interrupt.onInterrupt()` → `afterMs` 進める → `window.api.interruptAgentSession` と `window.api.interruptAgentSessionFollowUp` が同じ `sessionId` で呼ばれる。画面を入力待ちにすると `作業中` から `入力待ち` に変わり、`showAgentNotification` が `cliKind: 'copilot'` で呼ばれる。
  `useAgentWorkspace` の `interruptFollowUp`・タブの種類・判定の表の受け渡しを 1 つずつ外す変異で、どれかのテストが落ちることを確かめる
- 実機: 「実機テスト仕様書の新しい項目の下書き」

## 既知の制約（ROADMAP・実機テスト仕様書に反映する）

- `copilot` の判定は GitHub Copilot CLI 1.0.87 の画面（段階 0 の記録）に合わせた文言で行う。版で帯の案内・罫線・選択の案内が変わると外れうる。外れたときは `実行中`（判定できない）になる側に倒し、作業中でないのに中断を送る側には倒れない。アプリは `copilot` の版を確かめない
- 記録できなかった画面（シェル以外の許可の確認・`ask_user`・GitHub のモデルでの帯）は、記録した画面からの見込みで判定する。シェル以外の許可の確認は、問いが `Do you want to` で始まらなければ `許可待ち` ではなく `確認待ち` と出る。選択の案内の文言まで違うと `実行中` になり、許可待ちの通知が出ない
- `ask_user` が入力欄で答える形の問いだと、`入力待ち` と判定し、作業中からの変化を完了として知らせうる
- 入力欄の上の会話に選択の案内と同じ文字（`↑/↓ to navigate · enter to select` など）が見えている間は、作業中でも `確認待ち` と出る（中断は押せず、作業中から変わった時点で確認待ちの通知と変更の一覧の自動の取り直しが出て、作業が終わっても `入力待ち` にならない）。利用者の操作を待っているのに `入力待ち` にはしない側に倒した結果で、その文字が画面の外へ流れると戻る
- 作業中に `?` のヘルプを開くと `入力待ち` と判定し、完了の通知・変更の一覧の自動の取り直しが早く起きうる（中断は押せず、Esc は送らない）
- `copilot` の設定で画面読み上げのモード（`--screen-reader` に当たるもの）を有効にしている場合、帯のスピナーが空白になるため、作業中の案内の文言が変わると `入力待ち` と判定しうる（アプリは `--screen-reader` を付けない）。また、行頭の `╭` が無い画面（screen-reader の形）では、会話の `Do you want to` を拾って確認待ちを許可待ちと判定しうる（どちらも待ちの活動で中断は押せない。違いは通知の題と理由の文言だけ）
- 40 列より狭いターミナルでは帯が段組みで折り返し、作業中が `実行中` と出ることがある（入力待ちにはしない）
- 帯の `中断` は、`copilot` では Esc を約 100ms の間隔で 2 回送る。2 回目の直前に画面を確かめ直し、作業中でなくなっていれば 2 回目を送らない。ただし確かめた画面は `copilot` の今の状態より通常は数十 ms 遅れて反映されるため、確かめた直後に作業が終わると 2 回目が入力待ちの `copilot` に届き、1 回目と組になって、入力欄の書きかけが消える（書きかけが無ければ巻き戻しの画面が開く。`Esc` で閉じれば何も巻き戻さない。履歴が無ければ `Nothing to rewind yet` が出るだけ）
- 2 回目の直前に許可の確認に変わると、2 回目は許可の確認の取り消し（操作ごと）として働く
- 2 回目の直前の確かめで作業中と読めなかった（描き直しの途中で判定できなかったなど）ときも 2 回目を送らず、`copilot 1 が作業中か判定できなかったため、2 回目の Esc は送りませんでした（まだ作業中なら、少し待ってからもう一度押してください）` と読み上げる。このとき `copilot` は約 0.5 秒 `esc again to interrupt` を出して作業を続けるので、1 秒待ってからもう一度押す
- 負荷で 2 回目の依頼が 1 回目から 400ms を過ぎると 2 回目を送らず、タブの下に `中断を送れませんでした: 2 回目の Esc が間に合いませんでした（まだ作業中なら、もう一度押してください）` が出る
- 帯の `中断` を押した直後（約 0.5 秒以内）にターミナルで利用者が `Esc` を押すと、`copilot` は帯の Esc と組にして扱いうる（入力待ちなら書きかけの消去・巻き戻し）
- 作業中に送信待ちにした指示（pending・Queued）は、中断の後すぐに送られて作業中に戻る（段階 0 の記録 `after-escesc-queued+400`）
- 中断が効いて作業が終わると、`claude` と同じく完了の通知（`copilot 1 の作業が終わりました`）が出る（中断と完了を区別しない）
- `copilot` の許可の確認で `Esc` を押すと、拒否ではなく操作ごとの取り消しになる（そのため許可待ちでは `中断` を押せない）
- 通知の題の CLI の名前は renderer が送るタブの種類で決まる（main は固定の表から選ぶだけで、押したときに届くタブは変わらない）
- `copilot` ではプロンプトの送信（実行・再実行・送信前の確認）・利用者の変更との区別・前回の続きから・このセッションで再開を使えない（段階 2b・3）

## 実機テスト仕様書の新しい項目の下書き

`docs/manual-test-spec.md` の「## エージェント CLI のアプリ内ターミナル」の `### 使うエージェント CLI の切り替え（copilot）` の後（`## エージェントの変更の確認` の前）に `### copilot の画面の判定と中断` を足し、AGT-243 から振る。
下書きの文言は、実装の後にコードの文言と照らし合わせて確定してから追記する（L-354）。

手順はテスト用のフォルダで行い、`copilot` に頼む内容は返答だけで済むものか、ファイルを変えないシェルのコマンド（`sleep`）にする。許可の確認では「今後は確かめない」選択肢（`Yes, and don't ask again …`）を選ばない（利用者の `copilot` の設定に許可が残るため）。
フォルダの信頼の確認は、その回だけ信頼する選択肢（`1. Yes`）を選ぶ。保存される設定（使う CLI・通知・VoiceOver）を変える項目は、確かめた後に元へ戻す手順を書く。書きかけは項目の終わりに消す。端末で行うのは見るだけのコマンドと、テスト用のフォルダの中で `pwd` を確かめてからの 1 つのファイルの作成と削除だけにする（L-072）。

### 既存の項目の直し（ID は変えない）

`copilot` の画面を判定するようになるので、`### 使うエージェント CLI の切り替え（copilot）` の次の項目の期待結果を直す。

- **AGT-230**: 期待結果の後半を「選択肢の下に `copilot では次の機能を使えません（ターミナルで直接操作します）: プロンプトの送信（実行・再実行）、利用者の変更との区別、前回の続きから・このセッションで再開` が出る。`エージェントの通知` の項目には `copilot` の注記が出ない」にする（通知の注記の VoiceOver の確かめを消す）
- **AGT-231**: 「帯は `実行中` になる」を「フォルダの信頼の確認が出ている間は帯が `確認待ち`、`copilot` の入力欄が出ると `入力待ち` になる」にする
- **AGT-232**: 期待結果を「`copilot` が応答する。応答の間は帯とステータスバーが `作業中`、終わると `入力待ち` になる（短くて見えなければ、そのことを記録する。詳しい確かめは AGT-244・245）」にする
- **AGT-234**: 手順を「`copilot 1` が入力待ちの間に、帯の `中断` にマウスを載せてから押す」、期待結果を「`中断` は薄い色で、`入力待ちのため、中断する作業がありません` が出る。押しても `copilot` の画面は変わらない」にする
- **AGT-239**: 「帯は `実行中`」を「フォルダの信頼の確認が出ている間は帯が `確認待ち`、`1. Yes` で答えると `入力待ち`」に、「帯は `実行中` のまま」を「帯は `入力待ち` のまま」にする（前提でその回だけ信頼するので、`copilot 2` の起動でも信頼の確認が出る）
- **AGT-240**: 「使えない機能の注記と通知の項目の注記が消える」を「使えない機能の注記が消える」にする

### 新しい節

> 前提: エージェント CLI 方式で、テスト用のフォルダを開いている。GitHub Copilot CLI（`copilot`）がインストール済みで、端末で `copilot --version` が動く。設定の `使うエージェント CLI` で `GitHub Copilot CLI（copilot）` を選んでから始め（動いているタブがあれば確認で `OK`）、この節の最後の項目で `Claude Code（claude）` に戻す。途中で止めるときも `Claude Code（claude）` に戻す。
> 前提: フォルダの信頼の確認が出たら、その回だけ信頼する選択肢（`1. Yes`）を選び、`2. Yes, and remember this folder for future sessions` は選ばない（覚えさせてしまったら、AGT-228 の節の前提の手順で外す）。`copilot` のログインなど GitHub のアカウントに関わる操作は、利用者が自分のアカウントで行う。
> 前提: 長い作業は、`copilot` の入力欄（ターミナルの中をクリックして）に `Without using any tools or files, write the numbers from 1 to 2000 in your reply, one per line.` を入力して `Enter` で送って作る（ツールを使わないので許可の確認は出ず、ファイルも変えない。1 分ほど応答が続く。プロンプトの `実行` は copilot では押せないため、ターミナルに直接入力する）。ツールを使おうとして許可の確認が出たら、ターミナルで `Esc` を押して取り消してから送り直す。手順の途中で作業が終わってしまったら、同じ文を送り直して手順の頭からやり直す。
> 前提: 長い作業の間に、ターミナルの入力欄で `Enter` を押して次の指示を送信待ちにしない（送信待ちの指示があると、中断の後にその指示が送られて作業中に戻る。既知の制約）。
> 前提: 設定の `エージェントの通知` がオンの状態で行う（オフなら、この節の間だけオンにし、最後の項目で元に戻す）。

- [ ] **AGT-243** `起動` で `copilot 1` を起動し、`copilot` の入力欄が出るまで待って、帯とステータスバーを見る（フォルダの信頼の確認が出たら、答える前に帯を見る） → 信頼の確認が出ている間は帯が `確認待ち` で、ステータスバーが `エージェント: 確認待ち 1` の強調の色になる（確認が出なければ、そのことを記録する）。`1. Yes` で答えて入力欄が出ると、帯が `入力待ち`、ステータスバーが `エージェント: 入力待ち 1` になる
- [ ] **AGT-244** VoiceOver を使う場合は有効にしておく（使わない場合は読み上げの確認を飛ばして、そのことを記録する）。長い作業を送り、応答の間と終わった後の帯・ステータスバーを見る → 応答の間は帯が `作業中`、ステータスバーが `エージェント: 作業中 1` になる。終わると帯が `入力待ち` に戻り、`copilot 1 の作業が終わりました` が読み上げられる。VoiceOver を使った場合は、確かめた後に切る
- [ ] **AGT-245** 長い作業を送り、すぐに別のアプリ（Finder など）をクリックしてアプリのウィンドウからフォーカスを外し、作業が終わるまで待つ。出た OS の通知を押す → 作業が終わると macOS の通知が題 `copilot 1: 作業が終わりました`・本文 `次の指示を待っています` で出る。押すとアプリが前面に出て、`copilot 1` のタブが選ばれる
- [ ] **AGT-246** VoiceOver を使う場合は有効にしておく（使わない場合は読み上げの確認を飛ばして、そのことを記録する）。`copilot` の入力欄に `Run the shell command sleep 15.` を入力して `Enter` で送り、許可の確認（`Do you want to run this command?`）が出たら、帯・ステータスバーを見て、帯の `中断` にマウスを載せてから押す → 帯が `許可待ち`、ステータスバーが `エージェント: 許可待ち 1` の強調の色になる（VoiceOver では `copilot 1 が許可待ちになりました`）。`中断` は薄い色で、`許可待ちのため中断できません（Esc は操作の取り消しになります。ターミナルで答えてください）` が出る。押しても許可の確認は残る。許可の確認が出ずにコマンドが実行された（設定で許可済み）ときは、そのことを記録し、VoiceOver を使った場合は切ってから AGT-248 へ進む
- [ ] **AGT-247** AGT-246 の許可の確認で、ターミナルの中をクリックして `1. Yes` を選び（`Yes, and don't ask again …` は選ばない）、`sleep 15` の実行中に帯が `作業中` になったら `中断` を押す → `中断` は押せる色で、押すと 1 秒以内に `copilot` の画面に `Operation aborted by user`（または `Operation cancelled by user`）が出て作業が止まり、帯が `入力待ち` に、`中断` が薄い色に戻る。`copilot` は終了しない（帯は `終了しました` にならない）。VoiceOver を使う場合は `copilot 1 に中断（Esc を 2 回）を送りました` が読み上げられる。VoiceOver を使った場合は、確かめた後に切る
- [ ] **AGT-248** 長い作業を送り、帯が `作業中` になったら `中断` を押す。続けて `copilot` の入力欄に `Continue from where you stopped, but only 10 more numbers.` を送る → 押すと 1 秒以内に `Operation cancelled by user` が出て作業が止まり、帯が `入力待ち` になる。続けて送った指示には前の作業を踏まえて答える
- [ ] **AGT-249** 長い作業を送り、その間にターミナルの入力欄へ `draft` と入力して（`Enter` は押さない）から、帯の `中断` を押す → 作業が止まり、入力欄の `draft` は消えずに残る。巻き戻しの画面（`Rewind to a previous point`）は開かない。確かめた後、ターミナルで `Ctrl+U` を押して書きかけを消す
- [ ] **AGT-250** `copilot 1` が入力待ちのときに、ターミナルの入力欄へ `draft` と入力し（`Enter` は押さない）、帯の `中断` にマウスを載せてから押す → `中断` は薄い色で、`入力待ちのため、中断する作業がありません` が出る。押しても入力欄の `draft` は残り、`copilot` の帯に `esc again to clear input` も出ない。確かめた後、`Ctrl+U` で書きかけを消す
- [ ] **AGT-251** 長い作業を送り、その間に入力欄へ `draft` と入力して（`Enter` は押さない）から、`中断` をすばやくダブルクリックする。別の回に、同じく長い作業の間に `draft` を入力してから、ターミナルの中をクリックしてから `F6` で抜けて（フォーカスが開閉のボタン `エージェント` に移る）、`Tab` を押してフォーカスリングを見ながら（タブ列・`+` の後の）`中断` へ移し、リングが `中断` にあることを確かめてから `Enter` を 2 秒押し続ける → どちらの回も作業が 1 回止まるだけで、入力欄の `draft` は残り、巻き戻しの画面は開かず、`copilot` は終了しない。確かめた後、それぞれ `Ctrl+U` で書きかけを消す
- [ ] **AGT-252** `+` で `copilot 2` を起動し（信頼の確認が出たら `1. Yes`）、`copilot 2` が入力待ちになったら `copilot 1` のタブを選んで、ターミナルの中をクリックして長い作業を送り、帯が `作業中` になってから `copilot 2` のタブ（入力待ち）を選ぶ → `中断` は押せない。`copilot 1` を選び直すと押せ、押すと `copilot 1` だけが止まり、`copilot 2` の画面は変わらない。ステータスバーは作業中に `エージェント: 作業中 1 · 入力待ち 1` になる。確かめた後、`copilot 2` のタブを `×` で閉じ、確認で `OK` を押す
- [ ] **AGT-253** サイドバーを開いたまま、ウィンドウの幅を、ターミナルの `copilot` の帯が 2 行以上に折り返すまで狭めて（`copilot` の帯の右端のモデル名が次の行へ移る幅）、長い作業を送る → 帯（アプリの）は応答の間 `作業中`、終わると `入力待ち` になる。`実行中` と出たら、そのときの `copilot` の帯の行をそのまま記録する。確かめた後、ウィンドウの幅を元に戻す
- [ ] **AGT-254** テスト用のフォルダが Git リポジトリで `変更を確認` の記録を始められるなら行う（そうでなければ、そのことを記録して次へ進む）。`変更を確認` → `いまから記録する` で記録を始める。別の端末で `cd <テスト用のフォルダ>` を実行し、`pwd` がテスト用のフォルダであることを確かめてから、`sleep 15; echo auto >> copilot-auto-refresh.txt` を実行し、すぐにアプリへ戻って `copilot` に長い作業を送る（端末で実行してから 15 秒以内に送る）。アプリのウィンドウを前面にしたまま、`更新` を押さずに作業が終わるまで待つ → 作業が終わると、変更の一覧に `copilot-auto-refresh.txt` が出る（`更新` を押していない）。確かめた後、同じ端末で `pwd` を確かめてから `rm copilot-auto-refresh.txt` を実行し、アプリで `確認を終える` を押して記録を終える
- [ ] **AGT-255** VoiceOver を有効にして、`copilot 1` が入力待ちの状態で、ターミナルの中をクリックしてから `F6` で抜けて、`Tab` を押してフォーカスリングを見ながら（タブ列・`+` の後の）`中断` へ移り、リングが `中断` にあることを確かめてから名前を聞く。続けて長い作業を送ってから同じように `中断` へ移って名前を聞く → 入力待ちのときは `中断（作業中の copilot に Esc を 2 回送る）` に続けて押せない理由 `入力待ちのため、中断する作業がありません` が読まれる。作業中は同じ名前で、押せない理由は読まれない。確かめた後、作業が続いていれば `中断` を押して止め、VoiceOver を切る（VoiceOver を使わない場合は、この項目を飛ばしてそのことを記録する）
- [ ] **AGT-256** `copilot 1` が動いていれば `終了` で止め、設定の `使うエージェント CLI` で `Claude Code（claude）` を選ぶ（この節の前提で `エージェントの通知` をオンにした場合は、オフに戻す）。帯の `起動` で `claude 1` を起動し、入力待ちになったら帯の `中断` にマウスを載せる → 選択が `Claude Code（claude）` に戻る。`claude 1` の帯は `入力待ち` になり、`中断` の理由は `入力待ちのため、中断する作業がありません`（今までどおり）。この項目で設定は元に戻る

追記したら `node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact（<manual-test-spec-artifact-url>）を同じファイルパス（`.superpowers/manual-test-spec.html`）で再公開する。`npx vitest run scripts` が通ること。

## ROADMAP の更新の方針

- 「エージェント実行の支援（MVP の次）」の `- [ ] \`claude\` 以外のエージェント CLI への対応（…）`（:583）は**未完了のまま**にし、段階 1 の行（:584）の後に次の行を足し、「残り」の行（:585）を直す
  - `実装済み（<main に入れた日付>。段階 2a。設計書 docs/superpowers/specs/2026-10-21-agent-cli-copilot-screen-design.md）: copilot の画面の判定（作業中・入力待ち・許可待ち・確認待ち）と、それに基づく帯・タブ・ステータスバーの表示、完了・許可待ちの通知、帯の中断（Esc を 2 回）、変更の一覧の自動の取り直し。実装済み機能の「copilot の画面の判定と中断（段階 2a）」を参照`
  - 残り: `copilot へのプロンプトの送信（実行・再実行・送信前の確認）＝段階 2b、copilot の hooks による変更の区別・セッションの再開・起動の記録と履歴への CLI の種類の記録＝段階 3`
- 実装済み機能の `### 使うエージェント CLI の切り替え（段階 1）` の `[x] copilot では、プロンプトの送信…・中断・前回の続きから…は押せず` の行（:512）を「段階 1 の時点では、…押せず、入口ごとに理由を出していた。画面の判定…はしなかった。…」の過去形にし、末尾に `（段階 2a で中断と画面の判定に対応した）` を書き足す
- 同じ節の既知の制約の 1 行目（:515。`copilot` で使えない機能の一覧）と 2 行目（帯が `実行中` のまま）は、段階 1 の時点の記録として過去形に直し、1 行目には `（段階 2a で、表示・通知・中断・自動の取り直しに対応した）`、2 行目には `（段階 2a で作業中・入力待ちなどを判定するようにした）` を書き足す
- 実装済み機能の末尾（`### 使うエージェント CLI の切り替え（段階 1）` の後）に `### copilot の画面の判定と中断（段階 2a）` を足す。設計書へのリンク、判定の手がかり（帯の中断の案内・選択の案内）と分からない画面の扱い、中断の送り方（main の表・2 回目の前の確かめ）、通知の題、既知の制約（この設計書の「既知の制約」と同じ）を書く

## 次の段階の見通し

- **段階 2b（copilot への送信）**: `copilot` の入力欄の特定（この段階の `copilotScreenActivity.ts` の中の関数を `copilotInputBox.ts` に切り出す）と、空の判定（カーソルの位置・反転）、消去（`Ctrl+U` は行頭まで・`Ctrl+K` は行末までで行の境界を越えない。書きかけがあるときの Esc 2 回は消えるが、空の入力欄では巻き戻しの画面を開くので、空でないことを確かめてからしか使えない）、
  括弧付きの貼り付け（起動直後から有効。10 行を超えると `[Paste #N - X lines]` に畳まれるので、貼り付けの確かめの規則を CLI ごとにする）、行頭の `!`（シェルのモードに入る）の扱い、`Enter` での送信を、`claude` の送信の手順（`agentPromptSend.ts`・`agentPasteText.ts`・`agentInputBox.ts`）と同じく CLI ごとの表に分ける。
  作業中の `Enter` は送信待ち（pending）になるので、送るのは入力待ちのときだけにする。中断の 2 回目を待つ間は送信を始めない守りを足す（この段階の「新しい状態と既存の入口」）。送信前の確認・履歴のエントリへの CLI の種類の記録（古いエントリは `claude` として読む。L-456・L-459）も段階 2b で行う
- **段階 3（hooks と再開）**: 段階 1 の設計書の見通しのとおり（`copilot` の hooks を 1 回の起動だけに効かせる方法・`--session-id` と `--resume`・起動の記録への種類の記録）

## 実装の分割

1 つの実装プランで、次の順のタスクにする。

1. **copilot の画面の台帳**: 「実装の最初に確かめること」の 1〜3（変換のスクリプト・個人情報の置き換え・`copilotScreens.json`・`copilotScreens.ts`・`README.md`・`.prettierignore`・`copilotScreensFixture.test.ts`）
2. **判定の表と copilot の判定**: `claudeScreenActivity.ts`（移動）・`copilotScreenActivity.ts`・`agentScreenClassifiers.ts`・`agentActivity.ts` とテスト（台帳の `EXPECTED`・手書きの画面・表の配線）
3. **能力の表と判定の hook・通知**: `agentCliKinds.ts`・`useAgentActivity`・通知の型と文言（shared・main の検証と題・renderer の出来事）・`useAgentHooksWorkingReport`・`useAgentChangesAutoRefresh` の型とテスト。能力が無い種類のテストを `vi.mock` に書き換える
4. **中断の main**: `agentCliInterruptSpecs.ts`・`AgentSession`・starter・registry・受け口・preload・`agentTerminalApi.ts` とテスト、node-pty の統合テスト
5. **中断の renderer**: `agentInterrupt.ts`・`agentInterruptMessages.ts`・`useAgentSessions`・`useAgentInterrupt`・`useAgentWorkspace`・`AgentTerminalPanel` とテスト（配線の変異の確認を含む）
6. **ROADMAP の更新・既知の制約・テスト仕様書と全体の検証**:
   - ROADMAP: 「ROADMAP の更新の方針」のとおり
   - 実機テスト仕様書: AGT-243〜256 と既存の項目の直しを実装の文言と照らし合わせて確定して追記する。`node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact を同じファイルパスで再公開する（コントローラーが行う）。`npx vitest run scripts` が通ること
   - 設計書の「既知の制約」を実装と照らし合わせ、食い違いがあれば直す
   - 全体の検証: `npm test`・`npm run typecheck`・変更したファイルへの `npx eslint`

main に入れた時点で利用者から見える挙動:

- `copilot` を選んでいても、帯・タブ・ステータスバーが `作業中`・`入力待ち`・`許可待ち`・`確認待ち` に変わり、完了・許可待ちの通知（題は `copilot 1: …`）が出て、変更の一覧が自動で取り直される
- `copilot` が作業中のときだけ帯の `中断` を押せ、押すと Esc を 2 回送って作業を止める（2 回目の前に作業が終わっていれば送らない）
- `copilot` のプロンプトの `実行` は今までどおり押せない。`claude` を選んでいる間は今までと同じ

## 気をつける知見（dev-flow-kit の review-lessons.md）

選び方: 依頼で指定された項目（L-001・L-017・L-019・L-037・L-041・L-059・L-072・L-157・L-408）の本文を読み、今回の変更（画面の判定の規則・pty へ書く IPC の 2 段の送り方・非同期の結果とセッションの世代・連打・実機の手順）に当てはめた。
段階 1 の設計書で反映した L-044・L-060・L-061 も、型と配線の作りに使った。

- L-001: main の 2 回目は `sent`・`not-pending`・`expired`・`no-session`・`write-failed` を返し、renderer は 2 回目まで送れたときだけ「中断を送りました」と読み上げる。2 回目を頼まなかったときは、その旨を読み上げる（送ったことにしない）。中断の成否（作業が止まったか）は画面の判定に任せる（「中断の流れ」・「エラー処理」）
- L-017: 新しい失敗の文言は固定の文言だけで、例外の文言を足す経路は今の `invoke` の拒否（中断の失敗の接頭辞）だけ。台帳はユーザー名・一時ディレクトリ・UUID を置き換え、個人情報のテストを通してからハッシュを固定する（「エラー処理」・「実装の最初に確かめること」）
- L-019: 2 回目の IPC も `sessionId` だけを受け取り、main が固定の `\x1b` を書く。回数・間隔・期限は main の種類ごとの表で決め、renderer は 2 回目を頼むか頼まないかだけを選べる（main の控えが無ければ書かないので、回数を増やせない）。通知の `cliKind` は main が検証して固定の表の名前を選ぶだけ（「中断の流れ」・「通知」）
- L-037: 2 回目は 1 回目の `sessionId` に結び付け、頼む前と結果が届いた時点でタブの `sessionId` と照らし、違えば `stale` で何もしない。main も所有者の枠の現在のセッションとの一致で照合し、2 回目の控えはセッションごとで、停止・終了で消える（「中断の流れ」）
- L-041: 中断は作業中のときだけ押せ、押した時点と 2 回目の直前の 2 回、タブの種類の規則で画面を確かめる。判定の規則は、会話の本文の文字・分からない画面で作業中・入力待ちとしない側に倒す（中断の案内は帯だけで見る・入力欄の構造を求める・入力欄の外（上の罫線より上と帯）に選択の案内があれば作業中・入力待ちにしない・帯の先頭のスピナーで入力待ちにしない）。`claude` の規則で `copilot` の画面を読まない（「画面の判定の規則」・「分からない画面の扱い」・「中断の流れ」）
- L-059: 判定の規則を、実物の `copilot` で記録した 48 の画面（段階 0）で固定し、2 回の Esc とその間隔を実物の node-pty の統合テストで確かめる。記録できなかった画面は見込みとして既知の制約に書き、実機の項目（許可の確認・中断・書きかけ・狭い幅・自動の取り直し）で確かめる（「実装の最初に確かめること」・「テスト方針」・「実機テスト仕様書の新しい項目の下書き」）
- L-072: 実機の項目は、`copilot` に頼む内容を返答だけか `sleep` に限り、許可の確認とフォルダの信頼で「今後も覚える」選択肢を選ばない。端末で作るファイルはテスト用のフォルダで `pwd` を確かめてから作り、確かめた後に同じく `pwd` を確かめてから消す。使う CLI・通知・VoiceOver の設定は最後に戻す（「実機テスト仕様書の新しい項目の下書き」）
- L-157: 押した後に押せない状態へ変わる `中断` は今までどおり `aria-disabled` でフォーカスを残す。2 回目を待つ間も押したボタンにフォーカスが残る（「中断の後の記録・連打・待ち」）
- L-408: 1,000ms の待ち・同期の再入の防止（2 回目まで続ける）・ダブルクリックの続きの無視・キーリピートの抑止を組のまま使い、`copilot` の 500ms の窓と待ちの関係を確かめ、2 回目の流れが終わった時点で待ちを数え直して、次の 1 回目が前の 2 回目から常に 1,000ms 以上空くようにした。実機でダブルクリックと `Enter` の押し続けを確かめる（AGT-251）
- L-044・L-060: 通知の依頼の `cliKind`・`agentNotificationText` の種類・`AgentSessionParams.interruptSpec`・`AgentSessionsState.interruptFollowUp` を必須にし、知らない種類は main で拒否する。配線のテストと受け渡しを 1 つずつ外す変異の確認を入れる（「通知」・「テスト方針」）
- L-061: 新しい状態（中断の 2 回目を待つ間）に対して、中断・送信・キー入力・終了・タブの操作・切り替えの入口を列挙して扱いを表にした（「新しい状態と既存の入口」）
