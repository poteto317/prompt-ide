# エージェントの実行の中断の UI 設計書

- 日付: 2026-10-19
- ROADMAP の項目: 「エージェント実行の支援（MVP の次）」の「実行のキャンセル / 中断の UI（現在はエージェント側の操作に任せる）」（`ROADMAP.md:533`）
- 前提の設計書: `2026-10-04-agent-terminal-mvp-design.md`（確認の結果 15〜17 の `Esc`・`Ctrl+C` の実測〈:187-191〉、送信の手順で `Esc` を使わない方針〈:406-408・:466-467・:478-482〉）、`2026-10-09-agent-session-activity-design.md`（活動の判定）、`2026-10-10-agent-send-confirm-design.md`（送信前の確認）、`2026-10-13-agent-changes-user-edit-distinction-design.md`（中断の後に `Stop` が届かないときの保留）
- 実装は 1 つの実装プラン・1 つの PR にする（「実装の分割」）

## 目的

エージェント CLI 方式では、`claude` の作業を止める手段がターミナルの操作（`Esc`）しか無い。ターミナルにフォーカスを移してから `Esc` を押す必要があり、
`Ctrl+C` を 2 回続けて押すと `claude` が終了して会話の文脈を失う（MVP の確認の結果 16）。帯の `終了` は pty を止める（会話を失う）操作で、作業だけを止める用途には重い。

この機能では、ターミナルパネルの帯に `中断` のボタンを置き、選択中のタブの `claude` が作業中のときだけ、ターミナルで `Esc` を 1 回押したのと同じ 1 バイト（`\x1b`）を送る。
作業が止まったかどうかは、今までどおり `claude` の画面（活動の判定）で分かる。アプリは「送れたか」だけを扱う。

## 決めたこと（利用者の確認済み）

2026-10-19 に利用者が決めた。

| 項目       | 決定                                                                                                                                                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 中断の手段 | 選択中のタブの `claude` に `Esc` を 1 回（`\x1b`）送る。ターミナルで `Esc` を押すのと同じ。`Ctrl+C` は 2 回で `claude` が終了するため使わない（MVP の確認の結果 16）。pty を止める（kill）のは既存の `終了` が担う                                                                                   |
| 押せる条件 | 選択中のタブの活動の判定（renderer の `classifyAgentScreen`・`useAgentActivity` の `activities`）が `working` のときだけ押せる。`permission`・`confirm`・`idle`・`unknown` では押せず、押せない理由を出す（許可待ちでの `Esc` は許可の拒否、入力待ちでの `Esc` の 2 回目は書きかけの消去になるため） |
| 置き場     | ターミナルパネルの帯（`AgentTerminalPanel.tsx`。状態の文言と `終了` の並び）                                                                                                                                                                                                                         |

## 決めたこと（推奨案で決めた事項）

利用者が 2026-10-19 に推奨案を採用した。

| 項目                     | 決定                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 対象の方式               | エージェント CLI 方式だけ。従来の方式（API・非対話 CLI）には出力パネルの `キャンセル`（`aria-label="実行をキャンセル"`。`usePromptExecution.cancelExecution`）が既にあり、変えない                                                                                                                                                                                         |
| 対象のタブ               | 選択中のタブだけ。`すべて中断` は置かない                                                                                                                                                                                                                                                                                                                                  |
| 確認のダイアログ         | 出さない（会話を失わない軽い操作で、ターミナルの `Esc` 1 回と同じ）。代わりに連打の対策を入れる（「連打の対策」。L-408）。2 回目の `Esc` は、入力待ちの画面で 0.5 秒以内に届くと入力欄の書きかけを消しうる（MVP の確認の結果 17）ため、押した後 1,000ms は押せなくする                                                                                                     |
| 送信の途中               | `useAgentPromptSender` の送信中（`isSending`）・送信前の確認のダイアログの表示中は押せない。送信の手順（消去・貼り付け・Enter）と `Esc` が混ざると、貼り付けの確認が外れる・確認の画面への送り込みを防げない（MVP の「確認画面の最中に誤って送らないための条件」）ため                                                                                                     |
| IPC                      | 既存の `writeAgentSession`（任意の文字列）に `\x1b` を流さず、専用の IPC `agentTerminal:interrupt` にする。renderer からは `sessionId` だけを受け取り、main が固定の 1 バイトを書く（L-019）。メインフレームの確認・セッションの存在・世代（今のセッションの `sessionId` との一致）の確認は既存の `agentTerminal:write` と揃える（L-037）。結果は `invoke` で返す（L-001） |
| 送った後の表示           | 読み上げ（既存の常設の `aria-live` と同じ作り。`useTransientNotice`・`toAnnouncementText`・`.agent-announcer`）で `claude 1 に中断（Esc）を送りました` を伝える。中断の成否（作業が止まったか）は `claude` の画面の判定（`working` が終わる）で分かるので、アプリは送れたかどうかだけを扱う（L-001）                                                                       |
| エージェントの変更の確認 | 帯の `中断` はターミナルの `Esc` とバイト列が同じなので、2026-10-13 の設計書の「中断（Esc）の後」の扱い（`Stop` が届かず、30 秒後に次の指示まで割り当てを保留）がそのまま当てはまる。アプリは中断を hooks・作業の区間の追跡に知らせない（「既存の機能との関係」）                                                                                                          |

## 設計で決めた事項（この設計書で決めた細部）

| 項目                       | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 押せない状態の作り         | `disabled` ではなく `aria-disabled="true"` にし、押した処理の先頭で同じ純関数で判定して送らない（理由を読み上げる。L-058）。理由: 押して中断が効くと活動が `idle` に変わり、ボタンはすぐ押せなくなる。`disabled` にするとフォーカスが body に落ち、隣の `終了` などへ逃がすとキーリピートで会話を失う（L-408）。`aria-disabled` ならフォーカスは押したボタンに残り、押せない理由（`aria-describedby`）もキーボードで届く（L-057）                                                                                                                                                                                                                                                                                                                |
| 出す間                     | セッションが `starting`・`running` の間（`終了` と同じ `isActive`）。未起動・終了の帯は変えない（`起動`・`前回の続きから` の並びと狭い幅の扱いをそのまま保つ）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 押した時点の判定のやり直し | 押した処理で、描画に使った活動に加えて、その場で `classifyAgentScreen(controller.readScreen())` を読み直し、`working` のときだけ送る。活動の判定は出力が 150ms 静まってから（最大 500ms 遅れて）行うため、作業中から許可の確認へ変わった直後に古い `working` のまま押されて、許可を拒否するのを防ぐ                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 押せない理由の伝え方       | 見える文字にはしない（`title` と `aria-describedby` だけ。「画面」）。押せない状態で押したときは、押した処理の手順 2（描画の値での判定）・手順 3（画面の読み直し）のどちらで止めても、`useAgentInterrupt` が同じ読み上げの要素（`notice`）に理由を入れる（読み上げるのは `useAgentInterrupt` だけ。部品は読み上げを持たない）。既存の `起動` の帯（`aria-hidden` の見える理由と、説明用の隠した `span` の組）と違い、見える理由の行を足さない。理由: 入力待ちの間ずっと理由の文を帯に出すと、狭い帯で状態の文言・タブ列を押し出すため。代わりに、晴眼のキーボード利用者には理由の文は見えない（`title` はマウスでだけ出る）。見えるのは隣の状態の文言（`入力待ち` など）と薄い色で、押して何も起きないことから押せないと分かる（「既知の制約」） |
| 中断の待ちの単位           | タブごと。結果を待つ間（送っている途中）と 1,000ms の待ちを、どちらも `slotId` の集合で持つ（同期の再入の防止は ref の `Set<slotId>`、描画用は state）。タブ A の結果を待つ間でも、作業中のタブ B の `中断` は押せる。押せない理由の判定（`isInterrupting`）は選択中のタブがどちらかの集合に入っているか                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| フォーカスの控え方         | パネルの `section` の `onFocus`（`focusin` で泡立つ）だけで「パネルの中で最後にフォーカスを受けた要素が `中断` か」を ref に控える。`onBlur` では消さない（ウィンドウが非アクティブになったときや、Chromium が要素を DOM から外したときにも `blur` が出るため）。奪わない判定は、移す時点の `document.activeElement` が body か null かに任せる（「フォーカス」）                                                                                                                                                                                                                                                                                                                                                                                |
| 押し続け・連打             | 押してから 1,000ms は押せない（「連打の対策」）。`click` の `event.detail > 1` を無視し、`Enter`・`Space` のリピートの `keydown` を `preventDefault` する（L-408）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 失敗の表示                 | 送れなかったときは、`終了` の失敗と同じく、そのタブの `error`（帯の下の `role="alert"`）に出す（L-048）。次の `起動` で消える（既存の規則）。中断を送れたときは、そのタブの `error` が中断の失敗の文言なら消す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ショートカット             | 足さない（ターミナルの `Esc` がそのまま使える）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 範囲

含めるもの:

- 帯の `中断` のボタン（押せる条件・押せない理由・読み上げ・失敗の表示・連打の対策・狭い幅・ダークの色）
- 押せるかを決める純関数（`lib/agentInterrupt.ts` の `getAgentInterruptAvailability`）と文言（`lib/agentInterruptMessages.ts`）
- IPC `agentTerminal:interrupt`（shared の型・preload・main の受け口・registry・`AgentSession`）
- 中断の後の `claude` の画面の記録と、その画面の活動の判定のテスト（「実装の最初に確かめること」）
- ROADMAP・実機テスト仕様書の更新

含めないもの:

- 従来の方式の `キャンセル`（変えない）
- すべてのタブをまとめて中断する操作
- 中断のキーボードショートカット・ステータスバー・タブの右クリックからの中断
- 中断の成否の判定・中断を「完了」と区別した通知（「既知の制約」）
- エージェントの変更の確認の割り当て（hooks の区間の追跡）への中断の知らせ
- 従来の `Esc` のキーの経路（ターミナルで押した `Esc` は今までどおり xterm → `writeAgentSession` で送る）の変更
- `claude` 以外のエージェント CLI

## 画面

### 帯のボタン

帯の並びは、開閉・ヒント・タブ列・状態の文言・（押せない理由。未起動・終了の間だけ）・**`中断`**・`終了`（または `起動`）・`前回の続きから`（未起動・終了の間だけ）・`変更を確認`（記録中だけ）・`最大化`。
`中断` は `終了` の直前に置く（作業を止める操作を並べ、軽い方を先にする）。

| 属性               | 値                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 見える文字         | `中断`                                                                                                                                 |
| `aria-label`       | `中断（作業中の claude に Esc を送る）`（見える文字で始める。パターン 76）                                                             |
| `aria-disabled`    | 押せないとき `true`。押せるときは属性を付けない                                                                                        |
| `aria-describedby` | 押せないとき、隠した `span`（`hidden`）の id。中身は押せない理由（L-057。既存の `起動` の理由と同じ作り）。押せるときは付けない        |
| `title`            | 押せないとき、押せない理由（マウスで全文が出る）。アクセシブルな説明は `aria-describedby` が優先されるため、名前の後に重ねて読まれない |
| `className`        | `agent-terminal-panel__button`（共通のボタンの規則。min 32×32px・`flex: none`・`white-space: nowrap`）                                 |

押せない理由の文言（`lib/agentInterruptMessages.ts`。判定の順は「データの流れ」の純関数の順）:

| 状態                                    | 文言                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `starting`                              | `起動中は中断できません`                                                                 |
| 閉じる途中（`isClosing`）               | `閉じる途中のタブは中断できません`                                                       |
| 送信中（`isSending`）                   | `プロンプトを送信している間は中断できません`                                             |
| 送信前の確認の表示中                    | `送信前の確認を開いている間は中断できません`                                             |
| 送っている途中・押してから 1,000ms 以内 | `中断を送りました。まだ作業中なら、少し待つと押せます`                                   |
| 活動が `permission`                     | `許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）` |
| 活動が `confirm`                        | `確認待ちのため中断できません（ターミナルで選んでください）`                             |
| 活動が `idle`                           | `入力待ちのため、中断する作業がありません`                                               |
| 活動が `unknown`                        | `作業中か判定できないため押せません（ターミナルで Esc を押すと中断できます）`            |

押せない理由は見える文字としては出さない（`title` と `aria-describedby` だけ）。理由の元になる活動は、隣の状態の文言（`作業中`・`入力待ち`・`許可待ち`・`確認待ち`・`実行中`）として
常に見えており、入力待ちの間ずっと理由の文を帯に出すと、狭い帯で状態の文言・タブ列を押し出すため。
既存の `起動` の帯は、見える理由（`aria-hidden` の `span`）と説明用の隠した `span` を組で出すが、`中断` は隠した `span` だけにする。そのため晴眼のキーボード利用者には理由の文が見えない
（`title` はマウスを載せたときだけ出る）。押せない状態で押したときは理由を読み上げる（「読み上げ」）が、画面には出ない（「既知の制約」）。

### 読み上げ

- 送れたとき: `claude 1 に中断（Esc）を送りました`（`claude 1` は押した時点のタブのラベル。`formatAgentTabLabel`）。`role="status"` の常設の要素（`p.agent-terminal-panel__live`。`main.css` の `.agent-announcer` と同じ視覚的に隠す規則の並びに足した class）に
  `toAnnouncementText` で入れる。class を `.agent-announcer` にしないのは、`App.agentCli.test.tsx` の `querySelector('.agent-announcer')` が App の常設の読み上げ（パネルの外）を探しており、
  パネルの中に同じ class の要素が先に現れるとそちらを拾うため（計画の時点で調整した細部。「決めたこと（推奨案で決めた事項）」の「送った後の表示」の `.agent-announcer` は、この class に読み替える）。`useTransientNotice` で 3,000ms 後に消え、同じ文言が続いても id を進めて読み直させる（パターン 87）。要素はパネルの `section` の中に常に描く
  （パネルを閉じても帯は残るので、エージェント CLI 方式の間は常にある）
- 押せない状態で押したとき: 押した処理の手順 2（描画の値での判定）で止めたときはその理由（上の表のいずれかの行）を、手順 3（押した時点の画面の読み直し）で作業中でなかったときはその活動の理由（上の表の活動の行）を、
  どちらも同じ要素で読み上げる（押しても何も起きなかった理由を伝える。L-057）。読み上げを入れるのは `useAgentInterrupt`（`notice`）だけ。IPC は呼ばない。
  ダブルクリックの 2 回目（`event.detail > 1`）とキーリピートの `keydown` は部品で捨てて `onInterrupt` を呼ばないので、読み上げない（理由を繰り返し読ませない）
- 送れなかったとき: そのタブの `error`（帯の下の `p.agent-terminal-panel__error`・`role="alert"`。既存）に出す。文言は「エラー処理」
- 中断が効いて作業が終わると、既存の通知が `working → idle` を作業の完了として `claude 1 の作業が終わりました` を読み上げる（既存の動作。「既知の制約」）

### フォーカス

- 押した後もフォーカスは `中断` に残る（`aria-disabled` のため。押せない状態に変わっても body に落ちない）
- 担当は `hooks/useAgentInterruptFocus.ts`（`AgentTerminalPanel` が `interrupt.visible` と `interruptRef`・`primaryButtonRef`・`toggleRef` を渡し、戻り値を `section` の `onFocus` に渡す）。SRP リファクタリング第 1 周で部品から分けた
- 控え方: パネルの `section` の `onFocus`（React の `onFocus` は `focusin` で泡立つ）で、`event.target` が `中断`（`interruptRef`）かを ref（`lastFocusedWasInterruptRef`）に入れる。
  パネルの中のほかの要素（ターミナル・タブ・ほかのボタン）がフォーカスを受けると false になる。`onBlur`（`focusout`）では消さない。理由: ウィンドウが非アクティブになる（別のアプリへ移る）と
  フォーカスのある要素に `blur` が出て、`blur` で消す作りでは戻ってきたときに移し先が決まらない。また Chromium は要素を DOM から外すときにも `blur` を出しうる（jsdom はどちらも出さないため、
  単体テストでは `blur` を手で `dispatchEvent` して確かめる）
- セッションが終わって `中断` が消えたとき（出す状態から出さない状態に変わった描画）、控えが true で、移す時点の `document.activeElement` が body（または null）なら、`useLayoutEffect` で同じ帯の主ボタン
  （`終了` が替わった `起動`。`primaryButtonRef`）へ移す。`起動` が `disabled`（`startDisabled`・閉じる途中）のときは `focus()` が効かず body に落ちるため、代わりに開閉のボタン（`エージェント`。`toggleRef`。
  帯にいつもあり `disabled` にならない）へ移す。控えは、移した・移さないに関わらず、出す状態から出さない状態に変わった描画のたびに false に戻す（移さなかった回の古い控えを次の回に残さない）
- 奪わない判定は `document.activeElement` だけに任せる。利用者がパネルの外（エディタなど）へ移していれば activeElement は body でないので移さない。ウィンドウが非アクティブの間に終わったときも、
  Chromium では activeElement は外れた要素の代わりに body になるので移し、ウィンドウへ戻るとフォーカスは `起動` にある
- ターミナルへは移さない（続けて押した `Enter` が `claude` の入力欄の書きかけを送信しうるため）

### 狭い幅

`中断` は 2 文字で、共通のボタンの規則（`flex: none`）で縮まない。狭い幅では、今の規則どおり状態の文言・タブ列（と未起動・終了の間の理由）が先に縮む。
帯は 1 行（高さ 32px）のまま。セッションが動いている間は `前回の続きから` が出ないため、`中断` を足しても未起動の帯（AGT-040）より並ぶボタンは増えない（`エージェント`・`中断`・`終了`・（`変更を確認`）・`最大化`）。

### ダークの色

CSS は素の `main.css`（Tailwind 不使用。ダークの色固定）。`.agent-terminal-panel__button` の既存の色（文字 `#cccccc`・枠 `#555555`・ホバー `#094771`／`#ffffff`・内側のフォーカスリング）をそのまま使い、
`aria-disabled` 用に次を足す（`:disabled` と同じ見た目）。

```css
.agent-terminal-panel__button[aria-disabled='true'] {
  opacity: 0.5;
  cursor: default;
}

.agent-terminal-panel__button[aria-disabled='true']:hover {
  background: none;
  color: #cccccc;
}
```

## データの流れ

### 押せるかの判定（renderer の純関数。`lib/agentInterrupt.ts`）

```ts
export const AGENT_INTERRUPT_COOLDOWN_MS = 1_000

export interface AgentInterruptAvailabilityInput {
  status: AgentSessionStatus // 'none' | 'starting' | 'running' | 'exited'
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

export function getAgentInterruptAvailability(
  input: AgentInterruptAvailabilityInput
): AgentInterruptAvailability
```

- `status` が動いていない（`none`・`exited`。帯が `終了` を出すかと同じ `isActiveAgentSessionStatus` が偽。SRP リファクタリング第 9 周でまとめた）なら `{ visible: false, reason: AGENT_INTERRUPT_NOT_RUNNING }`（帯には出さないが、押した処理の判定でも同じ関数を使うため理由を持つ。文言 `claude が動いていないため中断できません`）
- それ以外は表の順（`starting` → 閉じる途中 → 送信中 → 確認の表示中 → 送っている途中・1,000ms 以内 → 活動）で最初に当たった理由。活動が `working` で、どれにも当たらなければ `reason: null`
- 活動の理由は `describeAgentInterruptBlockedByActivity(activity)`（`working` 以外の 4 つ。`Record<Exclude<AgentActivity, 'working'>, string>` で持ち、活動を増やしたときに決め忘れを型エラーにする）。
  押した時点の判定のやり直しでも同じ関数を使う

### 押したときの処理（renderer）

組み立ては `hooks/useAgentInterrupt.ts`（新しい hook）。`useAgentWorkspace` が選択中のタブ・活動・送信中・確認の表示中を渡し、結果を `AgentTerminalPanelState.interrupt`（必須。L-060）に載せる。
選択中のタブの型は、使う値だけの `AgentInterruptTab`（`AgentSessionTabView` の `slotId`・`label`・`status`・`isClosing` と、`controller` の `readScreen`）にする（SRP リファクタリング第 6 周で絞った）。
手順 2・3 の判定は純関数 `checkAgentInterruptAtPress`（`lib/agentInterrupt.ts`）、タブごとの送っている途中と 1,000ms の待ちの控え（手順 1・4・7 の ref・state・タイマー）は `hooks/useAgentInterruptCooldown.ts` が持つ（SRP リファクタリング第 1 周で分けた）。
判定の入力（選択中のタブの `status`・`isClosing`、活動〈未記録のタブは `unknown`〉、送信中・確認の表示中・待ち）は、描画と押した処理で同じ純関数 `toAgentInterruptAvailabilityInput`（`useAgentInterrupt.ts`。
`lib` に置くと `lib` が hook の型 `AgentSessionTabView` に依存するため hook のモジュールに置く）で組み立てる（L-058。SRP リファクタリング第 2 周で分けた）。待ちの値は、描画が state の `isPending`、押した処理が ref の `isCoolingDown` を渡す。

```ts
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
```

`onInterrupt` の手順:

1. 同期の再入の防止: 押した時点の選択中のタブの `slotId` が送っている途中の ref（`useAgentInterruptCooldown` の `isInFlight`。`Set<slotId>`）にあれば何もしない（state は次の描画まで変わらないため ref。`useAgentPromptSender` の `sendingRef` と同じ考え）。
   集合はタブごとなので、タブ A の結果を待つ間でもタブ B は押せる
2. 最新の値（`useLatestRef` で控えた選択中のタブ・活動・送信中・確認の表示中・そのタブが送っている途中か 1,000ms 以内か）で `getAgentInterruptAvailability` を求め、理由があればその理由を読み上げて終える
   （L-058。ボタンの見た目が古くても送らない。IPC は呼ばない。L-057）
3. 判定のやり直し（手順 2 と合わせて `checkAgentInterruptAtPress`）: `classifyAgentScreen(tab.controller.readScreen())` が `working` でなければ、その活動の理由を読み上げて終える（IPC は呼ばない）。`readScreen` が例外を投げたら送らずに終える（console に記録）
4. `useAgentInterruptCooldown` の `begin(slotId)`: 送っている途中の ref と、描画用の state（送っている途中のタブの集合・1,000ms の待ちのタブの集合）に `slotId` を足し、そのタブの 1,000ms の待ちを始める
   （`setTimeout` をタブごとの `Map<slotId, timer>` に持ち、過ぎたら待ちの集合から外す。同じタブの次の待ちとアンマウントで `clearTimeout`）
5. `sessions.interrupt(slotId)`（`useAgentSessions` に足す。下）を待つ
6. 結果が `sent` なら `claude N に中断（Esc）を送りました` を読み上げる。`stale`・`skipped` は何も出さない。失敗は `useAgentSessions` がタブの `error` に出している
7. `finally` で `useAgentInterruptCooldown` の `finish(slotId)`: 送っている途中の ref と state の集合から外す（例外でも固まらない。L-053）。1,000ms の待ちはタイマーが外す
   （結果が 1,000ms より遅く届いた場合は、届くまで送っている途中の集合で押せない）

`useAgentSessions.interrupt(slotId): Promise<AgentInterruptOutcome>`（`stop` と同じ層に置く。sessionId の持ち主のため）:

```ts
export type AgentInterruptOutcome =
  | { kind: 'sent' }
  | { kind: 'skipped' } // そのタブにセッションが無い(IPC を呼ばない)
  | { kind: 'stale' } // 結果が届いた時点で、そのタブの sessionId が送った値と違う(起動し直した・終了した・閉じた)
  | { kind: 'no-session' }
  | { kind: 'write-failed' }
  | { kind: 'error'; message: string } // invoke の拒否・同期の例外
```

- `sessionIdBySlotRef` から押した時点の `sessionId` を控える。無ければ `skipped`
- `Promise.resolve().then(() => agentTerminalApi.interruptAgentSession(id))` で呼ぶ（同期の例外も拒否と同じ経路で扱う。L-055）
- 結果が届いたら、そのタブの今の `sessionId` が控えた値と同じかを確かめる。違えば `stale`（古いセッションの結果を今のタブに出さない。L-037）
- `no-session`・`write-failed`・`error` は、そのタブの `error` に「エラー処理」の文言を出して返す
- `sent` は、そのタブの `error` が中断の失敗の文言（`AGENT_INTERRUPT_ERROR_PREFIX` で始まる）なら消して返す

### IPC

| 層                                                                                                       | 追加                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| shared（`src/shared/types/agentTerminal.ts`。`src/shared/types.ts` が `export type *` で再 export する） | `export type AgentInterruptResult = { kind: 'sent' } \| { kind: 'no-session' } \| { kind: 'write-failed' }`                                                        |
| preload（`api.ts`・`index.d.ts`）                                                                        | `interruptAgentSession: (sessionId: string): Promise<AgentInterruptResult> => ipcRenderer.invoke('agentTerminal:interrupt', sessionId)`（引数は `sessionId` だけ） |
| renderer（`lib/agentTerminalApi.ts`）                                                                    | `interruptAgentSession(sessionId)`（`window.api` の窓口）                                                                                                          |

`send` ではなく `invoke` にする理由: 書けたか・セッションが無かったかを呼び出し元へ返すため（L-001）。`write` は打鍵ごとに呼ばれるため `send` のままにする。

### main

受け口（`handlers/agentTerminalHandlers.ts`）:

```ts
ipcMain.handle(
  'agentTerminal:interrupt',
  (event: IpcMainInvokeEvent, sessionId: unknown): AgentInterruptResult => {
    if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
    return registry.interrupt(event.sender.id, parseAgentSessionId(sessionId))
  }
)
```

- `AgentTerminalHandlerDeps.registry` の `Pick` に `'interrupt'` を足す
- 送信元のフレームの確認・`sessionId` の検証は `agentTerminal:stop` と同じ（`invoke` なので例外で拒否する）。renderer から書くバイト列を受け取らない（L-019）

registry（`agentSessionRegistry.ts`）:

```ts
/** sessionId が所有者のいずれかの枠の現在のセッションと一致するときだけ中断を送る(write と同じ照合) */
interrupt(ownerId: number, sessionId: string): AgentInterruptResult {
  const session = this.findBySessionId(ownerId, sessionId)?.session
  if (session === undefined) return { kind: 'no-session' }
  const result = session.interrupt()
  if (result === 'sent') return { kind: 'sent' }
  return result === 'not-alive' ? { kind: 'no-session' } : { kind: 'write-failed' }
}
```

- 照合は `write` と同じ `findBySessionId`（所有者 = `event.sender.id`、そのウィンドウの枠の **現在の** セッションの id と一致）。停止中のセッション（`stoppingSessions` に移ったもの）・別のウィンドウのセッション・
  起動し直す前の古い `sessionId` は一致せず `no-session` になる（世代の確認。`sessionId` は pty ごとに `createSessionId` で作る値）
- 一致しても、終了した直後（`exited` の解決の後に枠から外すため、その前）で `AgentSession.interrupt` が `not-alive` を返したときは `no-session` に写す。
  停止は `stopSlot` が枠から外してから始めるため、停止の途中のセッションは照合で一致しない（`AgentSession.interrupt` の停止の途中の `not-alive` は、セッションを単体で使うときの守り。SRP リファクタリング第 9 周で記述を直した）

`AgentSession`（`agentSession.ts`）:

```ts
/** claude の作業の中断(ターミナルで Esc を 1 回押すのと同じ)。renderer の値を混ぜない固定の 1 バイト */
export const AGENT_INTERRUPT_SEQUENCE = '\x1b'

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

- 既存の `write` は書き込みの例外を握って何も返さない（打鍵の経路のため）。`interrupt` は結果を返す（L-001）
- 停止の途中（`stop` の後、終了の前）は書かない（止めている pty に送らない）
- 外部プロセスを待たない（`pty.write` は同期で返る）。`claude` の反応（画面の変化）は待たないので、待ちの上限・打ち切りは要らない（L-052）。renderer の 1,000ms の待ちは固定のタイマー

## エラー処理

| 場面                                                       | main の結果     | renderer の扱い                                                                                                                                              |
| ---------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 押した時点でタブにセッションが無い                         | （呼ばない）    | `skipped`。何も出さない（ボタンは出ていないはず）                                                                                                            |
| セッションが終わっていた（終了の知らせが renderer より先） | `no-session`    | タブの `sessionId` が同じなら `中断を送れませんでした: claude が終了したか、起動し直しました`。違えば `stale` で何も出さない（終了は帯の状態の文言で分かる） |
| 世代が変わった（起動し直した・停止中）                     | `no-session`    | 同上                                                                                                                                                         |
| pty への書き込みが例外                                     | `write-failed`  | `中断を送れませんでした: ターミナルへの書き込みに失敗しました`                                                                                               |
| メインフレーム以外・不正な `sessionId`・IPC の失敗         | `invoke` の拒否 | `中断を送れませんでした: <例外の message>`                                                                                                                   |
| `window.api` の呼び出しが同期で例外                        | —               | 同上（`Promise.resolve().then` で拒否として扱う。L-055）                                                                                                     |
| 押した時点の判定のやり直しで作業中でない・読めない         | （呼ばない）    | 作業中でなければその活動の理由を読み上げる。読めなければ何も送らず console に記録                                                                            |

失敗の文言の接頭辞は `AGENT_INTERRUPT_ERROR_PREFIX = '中断を送れませんでした: '`（`AGENT_STOP_ERROR_PREFIX` と同じ形）。結果が届いた時点で別のタブを選んでいても、文言は送ったタブの `error` に出す（帯にはそのタブを選んだときに出る）。

## 連打の対策

| 対策             | 内容                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1,000ms の待ち   | 押してから 1,000ms（`AGENT_INTERRUPT_COOLDOWN_MS`）は、そのタブの `中断` を押せない（理由 `中断を送りました。まだ作業中なら、少し待つと押せます`）。過ぎた後は通常の条件（作業中か）に戻る |
| 同期の再入の防止 | 送っている途中の ref（`useAgentInterruptCooldown`。`Set<slotId>`）で、同じタブの IPC の結果を待つ間の 2 回目を止める。別のタブは止めない（待ちはタブごと）                                 |
| ダブルクリック   | `click` の `event.detail > 1` を無視する（キーボードのクリックは `detail` が 0 なので影響しない。L-408）                                                                                   |
| キーリピート     | ボタンの `keydown` で `event.repeat` の `Enter`・`Space` を `preventDefault` する（単発の `Enter`・`Space`・マウス・タッチは影響しない。L-408）                                            |

1,000ms の根拠（MVP の確認の結果 15〜17）:

- 入力待ちの画面で、2 回目の `Esc` は 0.5 秒後なら入力欄を消し、0.9 秒以上空けると消さずに再び `Esc again to clear` を出した（確認の結果 17）。0.9 秒より長い 1,000ms にする
- 作業中の `Esc` → 120ms → `Esc` は、1 回目で中断し、入力欄は消えなかった（確認の結果 15）。ただし 3 回以上の連打・中断の後の描き直しの途中で届く 2 回目は確かめていないため、待ちで防ぐ
- 待ちの間に中断が効けば活動は `idle` になり、待ちが過ぎても押せない。中断が効かず作業中のままなら、1,000ms の後にもう一度押せる（2 回目の `Esc` も 0.9 秒以上空くので書きかけを消さない）

待ちとフォーカスの扱い（押したボタンに残す）と、リピート・ダブルクリックの抑止は組で働く（どれかを外すと、押し続けた `Enter` が 1,000ms ごとに `Esc` を送る、または body に落ちたフォーカスの先へ届く）。
実装のコメントに組であることを書く（L-408）。

## 既存の機能との関係

### 新しい状態と既存の入口（L-061）

新しい状態は「中断を送っている途中・押してから 1,000ms 以内」（タブごと）。`preload/api.ts` の `agentTerminal:*` と帯・送信の入口を列挙して扱いを決めた。

| 入口                                                           | 中断の待ちの間   | 理由                                                                                                                                                    |
| -------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| プロンプトの `実行`・履歴の `再実行`（送信）                   | 許す             | 消去（`Ctrl+K`・`Ctrl+U`）・貼り付け・Enter は `Esc` を含まず、入力欄が空になったことを画面で確かめてから送る（既存）。中断の直後の次の指示は自然な操作 |
| ターミナルのキー入力（`writeAgentSession`）                    | 許す（変えない） | 利用者の `Esc` は利用者の操作。2 回目の `Esc` の消去は今までどおり（「既知の制約」）                                                                    |
| `終了`（`agentTerminal:stop`）                                 | 許す             | 止めた後の中断の結果は `no-session`／`stale`                                                                                                            |
| タブの選択・`+`・`×`・`前回の続きから`・`このセッションで再開` | 許す             | 待ちはタブごと。閉じたタブ・起動し直したタブの結果は `stale` で捨てる                                                                                   |
| 実行方式の切り替え・フォルダの切り替え                         | 許す（変えない） | セッションを止めるので、結果は `stale`。従来の方式ではパネルごと出ない                                                                                  |
| リサイズ・作業中の知らせ（`reportWorking*`）                   | 影響しない       | 中断は知らせない                                                                                                                                        |

逆に、中断を押せないのは「押せない理由」の表の状態（送信中・確認の表示中を含む）。送信中に押せないのは、送信の手順の間は controller が利用者の打鍵を溜めている（`beginSending`）のに対し、
中断は別の IPC で溜めずに届くため、消去・貼り付けの途中に `Esc` が割り込む経路を作らないため。

### 送信の手順

`useAgentPromptSender`・`sendAgentPrompt` は変えない。送信の手順が `Esc` を使わない方針（MVP :406-408・:466-467・:478-482。作業中は中断し、入力欄も消さない）はそのまま。
中断のボタンは、その方針で避けた「作業中に `Esc` を送る」ことを、利用者が明示的に選んだときだけ行う。送信中・確認の表示中は押せないので、送信の手順と同時には送らない。

### キーの経路

ターミナルで押した `Esc`・`Ctrl+C` は今までどおり xterm の `onData` → `writeAgentSession` で送る（`agentTerminalKeys.ts` は変えない。AGT-048 はそのまま）。
帯の `中断` はターミナルにフォーカスが無くても使え、`agentTerminal:interrupt` で main が固定の 1 バイトを書く。`writeAgentSession` に `\x1b` を流す経路は作らない。

### ステータスバー・活動の判定・通知

- ステータスバーのまとめ（`useAgentStatusBar`）・タブの印は変えない。中断が効くと、既存の判定で `作業中` から `入力待ち` に変わる
- 活動の判定（`classifyAgentScreen`）は変えない（中断の後の画面の判定を記録した画面で確かめる。「実装の最初に確かめること」）
- 完了・許可待ちの通知（`useAgentNotifications`）は変えない。中断の後の `working → idle` は作業の完了として知らせる（「既知の制約」）

### エージェントの変更の確認（2026-10-13 の設計書）

帯の `中断` はターミナルの `Esc` と同じバイト列なので、`claude` の hooks から見て区別できない。2026-10-13 の設計書の扱い（中断では `Stop` が届かず、作業の終わりの後 30 秒以内に次の指示が無ければ、
次の `UserPromptSubmit` まで割り当てを保留する。ROADMAP :198・:419・:426）がそのまま当てはまり、矛盾しない。アプリは中断を main の区間の追跡に知らせず、`useAgentHooksWorkingReport` の
作業の終わりの知らせ（`working → idle`）もターミナルの `Esc` のときと同じに働く。ROADMAP の該当の 3 行は、行ごとの文言に合わせて書き足す（「ROADMAP の更新の方針」）。

### 従来の方式

出力パネルの `キャンセル`（RUN-022〜025）は変えない。従来の方式ではターミナルパネルが出ないので `中断` も出ない。

## 実装の最初に確かめること

設計の時点で、中断の後の `claude` の画面は `agentScreens.json` に無い。実装の最初のタスクで、MVP の記録の手順（`.superpowers/agent-terminal-mvp/agent-screens-recorder/README.md`。隔離した `CLAUDE_CONFIG_DIR`・
ダミーの API キー・偽のサーバー〈`exp3.js`〉。Anthropic の API には接続しない）で次を記録し、結果を設計書の「既知の制約」と判定のテストに反映する。

今の `exp3.js`（`permission`・`streaming`・`toolrun` の 3 つのモード）には、作業中に中断として `\x1b` を書く段も、作業中にキューを作る段も無い（`\x1b` を書くのは起動直後の全画面の表示の案内を閉じるときだけ）。
キューの画面（`queuedEmpty`）は `rec.js` の閉じたポートの場面で記録したもので、応答が返らないため中断の後の画面の記録には使えない。そこで `exp3.js` を次のように足してから記録する
（`.superpowers/` は git 管理外なので、記録用のスクリプトの変更は PR に入らない。足したモードは `agent-screens-recorder/README.md` の手順 3 に書き足す）。

1. **`exp3.js` に中断用のモードを足す**（既存のモードは変えない）
   - `interrupt`: `streaming` と同じ応答（60 語を 150ms ごと）で、`word5` が出てから `\x1b` を 1 回書き、2,000ms 待って描き直しが落ち着いた画面を `interrupted` として `dump` する
   - `interruptdraft`: `toolrun` と同じ応答（`sleep 6` のツール。`cfg/settings.json` の `Bash(sleep:*)` の許可も同じ）で、`sleep 6` が出てから `draft during tool` を書き、300ms 後に `\x1b` を 1 回書き、2,000ms 後の画面を `interruptedDraft` として `dump` する
   - `interruptqueued`: `streaming` と同じ応答で、`word5` が出てから `rec.js` の `PB`（括弧付きの貼り付け `\x1b[200~ … \x1b[201~`）と同じ形で `queued message` を書いて `\r` を送り、
     画面に `queued` が出るのを待ってその画面を `streamingQueued` として `dump` する。続けて `\x1b` を 1 回書き、2,000ms 後の画面を `interruptedQueued` として `dump` する
     （中断の後にキューが送られると、偽のサーバーは 2 回目の要求にも同じ応答を返す〈`mainCalls > 1`〉。その場合も 2,000ms 後の画面をそのまま記録し、作業中に戻ったかを結果に書く）
   - どのモードも、既存の見張り（ログイン・API キーの確認の文言で止める）と、確認画面で Enter を送らない条件はそのまま
2. **記録する**: `node exp3.js interrupt`・`node exp3.js interruptdraft`・`node exp3.js interruptqueued`。結果の扱い:
   - `interrupted`: `classifyAgentScreen` が `idle` を返すことをテストで固定する。`idle` 以外（`unknown` など）になったら、判定を直さず（範囲外）、その画面の活動を既知の制約に書く
     （押せる条件は `working` だけなので、判定が外れても中断が送られる側には倒れない）
   - `interruptedDraft`: 作業が止まって `draft during tool` が入力欄に残ることを確かめる（MVP の確認の結果 15 の再確認）。判定の期待も `EXPECTED` に入れる
   - `streamingQueued`・`interruptedQueued`: キューの送信待ちが中断でどうなったか（残る・入力欄へ戻る・消える・送られる）を「既知の制約」に書く。判定の期待も `EXPECTED` に入れる
3. **個人情報の置き換えとハッシュの更新**: `out/` の 4 つの JSON（`interrupted.json`・`interruptedDraft.json`・`streamingQueued.json`・`interruptedQueued.json`） を記録用の README の手順 4 と同じ書式（U+00A0 は `\u00a0` のエスケープ）で元の台帳 `.superpowers/agent-terminal-mvp/agent-screens.json` の
   `screens` の末尾に足し（JSON を読み直して整形しない。ファイルの文字列のまま足す）、`fixtures/README.md` の置換のスクリプト（`sanitize.py`）で `src/renderer/src/lib/__tests__/fixtures/agentScreens.json` へ写す。
   写した後、`agentScreensFixture.test.ts` の個人情報のテストが通ることを確かめてから、`AGENT_SCREENS_SHA256`（今は `6e9c974e411fcff545460a5b739089ca3c6ce5d309823453889556d8eda36c8d`）を新しい値に更新する。`fixtures/README.md` の
   「元の台帳」と「置き換えた後」の SHA-256、変わった行の数、画面の数（今は 28）を書き直す。`agentActivity.test.ts` の `EXPECTED` に足した画面を入れる（全画面がどれかの期待に入っていないと最後のテストが落ちる）
4. **版の記述の更新**: 足した画面は記録したときの `claude --version`（設計時のこのマシンは 2.1.291）で、既存の 28 画面は 2.1.288 のままなので、台帳は 2 つの版の混在になる。次の 4 か所を、
   既存の画面は 2.1.288、中断の後の 4 画面（`interrupted`・`interruptedDraft`・`streamingQueued`・`interruptedQueued`）は記録したときの `claude --version` の値で記録した、と分かる文に直す
   （記録したときの版が 2.1.288 と同じなら混在の記述は要らず、画面の数だけを直す）
   - `agentScreens.json` の `_note`（ハッシュの更新の前に直す）
   - `fixtures/agentScreens.ts` の冒頭のコメント（今は `claude 2.1.288 の画面の記録`）
   - `fixtures/README.md` の冒頭の段落（今は `claude 2.1.288・node-pty 1.1.0・@xterm/headless 6.0.0 で、28 の画面`）
   - `agentActivity.test.ts` の `EXPECTED` の上のコメント（今は `記録済みの画面(claude 2.1.288)ごとの期待`）
5. 記録の後に `pgrep -fl "local/bin/claude"` で残っていないことを確かめる

## テスト方針

vitest + `@testing-library/react`。renderer の hook・部品は偽の controller（`__tests__/makeFakeAgentTerminal.ts` の `makeFakeController`。`screen` に記録した画面を入れる）と、`window.api` の偽物で確かめる。

- main
  - `agentSession.test.ts`: `interrupt` が偽の pty の `write` に `['\x1b']` だけを書く（書いた列の完全一致 `toEqual`）・終了の後と `stop` の後は書かずに `not-alive`・`write` が投げると `write-failed`
  - `agentSessionRegistry.test.ts`: 現在のセッションだけに送る・別の所有者・古い `sessionId`（起動し直した後）・停止中のセッション・終了した直後（枠から外れる前。セッションの `not-alive` を写す。SRP リファクタリング第 8 周で追加）は `no-session` で書かない・書き込みが投げたら `write-failed`
  - `handlers/agentTerminalHandlers.test.ts`: メインフレーム以外は拒否・空の `sessionId` は拒否・`registry.interrupt` に `event.sender.id` と `sessionId` だけを渡し、結果をそのまま返す・余分な引数を渡しても書くバイト列は変わらない
  - `agentSession.integration.test.ts`（実物の node-pty）: 子に、標準入力を raw モード（`process.stdin.setRawMode(true)`）にして受け取ったバイトを 16 進で書き出す小さな node のスクリプトを起動して `interrupt` を呼び、子が受け取ったのが `1b` の 1 バイトだけであることを確かめる（Windows では飛ばす。L-059）
- preload: `api.test.ts` で `interruptAgentSession('id')` が `ipcRenderer.invoke('agentTerminal:interrupt', 'id')` を呼ぶ（引数は 2 つだけ）
- renderer の純関数: `agentInterrupt.test.ts` で、状態（4 つ）× 活動（5 つ）× 閉じる途中・送信中・確認の表示中・待ちの組の表を通し、理由の順と文言を固定する。`visible` は `starting`・`running` だけ（帯が `終了` を出すかと同じ `isActiveAgentSessionStatus` に従うことも確かめる。SRP リファクタリング第 9 周）
- 文言: `agentInterruptMessages.test.ts`（新規）に理由・読み上げ・失敗の文言を置く
- `useAgentSessions.test.ts`: `interrupt` の各結果（`skipped` で IPC を呼ばない・`sent`・`no-session`・`write-failed`・拒否・同期の例外〈L-055〉・結果を待つ間に起動し直して `stale`・閉じて `stale`）と、タブの `error` の出し方・消し方（中断の失敗の文言だけを消し、`終了` の失敗の文言は消さない）
- `useAgentInterrupt.test.ts`（偽のタイマー）: 999ms は押せず 1,000ms で押せる（値の 1,000ms は `agentInterrupt.test.ts` で固定し、hook と `useAgentInterruptCooldown.test.ts` は `AGENT_INTERRUPT_COOLDOWN_MS` を基準に境界を確かめる。SRP リファクタリング第 9 周）・待ちはタブごと（タブ A の結果を待つ間〈解決しない Promise の偽物〉にタブ B を選んで押すと、B の `sessionId` で IPC が呼ばれる。A をもう一度押しても呼ばれない）・
  結果を待つ間の同じタブの 2 回目は IPC を呼ばない・結果が 1,000ms より遅く届く間は押せない・押せない状態（手順 2。例: 入力待ち・1,000ms 以内）で `onInterrupt` を呼ぶと IPC を呼ばず、その理由が `notice` に入る・
  判定のやり直し（手順 3）で `permission` の画面なら IPC を呼ばず理由が `notice` に入る・`sent` の読み上げの文言と id が進む・アンマウントで待ちと読み上げのタイマーを残さない（`afterEach` で偽のタイマーを戻す）。
  手順 3 の読み直しが `unknown`（入力欄の上の罫線が見えない長い書きかけの記録の画面）になる場合は `checkAgentInterruptAtPress` のテストで、タブごとのタイマーの後始末は `useAgentInterruptCooldown.test.ts` で確かめる（SRP リファクタリング第 4 周で重複を整理）。
  同じファイルで、SRP リファクタリング第 2 周で分けた `toAgentInterruptAvailabilityInput`（値をそのまま写す・活動が未記録なら `unknown` でほかのタブの活動を使わない）も確かめる。第 6 周で絞った `AgentInterruptTab` の値だけ（`AgentSessionTabView` のほかの欄が無い）のタブで押せることも確かめる
- SRP リファクタリング第 1 周で分けた部分: `agentInterrupt.test.ts` の `checkAgentInterruptAtPress`（手順 2 で止まれば画面を読まない・手順 3 の理由・読めなければ `unreadable`）、`useAgentInterruptCooldown.test.ts`（ref の同期の更新・1,000ms・数え直し・タブごと・アンマウント）、`useAgentInterruptFocus.test.tsx`（移し先・ウィンドウの非アクティブ化や要素が外れたときの `blur`・`focusout` の後でも移す〈onBlur で控えを消さない〉・パネルの中のほかの要素へ移していたら移さない・外のフォーカスを奪わない・控えを残さない）
- `AgentTerminalPanel.test.tsx`: `starting`・`running` で出て `none`・`exited` で出ない・名前と `aria-disabled`・`aria-describedby` の先の文言・`title`・押せないときの `click` でも `onInterrupt` を呼ぶ（送らないことと理由の読み上げは hook の手順 2 の役目。L-058 は `useAgentInterrupt.test.ts` で確かめる）・
  `detail: 2` の `click` で `onInterrupt` を呼ばない・`repeat` の `Enter` の `keydown` が `preventDefault` され（`fireEvent.keyDown` の戻り値が false）、`repeat` の無い `Enter` は止まらない・
  押せない状態に変わってもフォーカスが残る・読み上げの要素が常にある。フォーカスの移し先（「フォーカス」）は、移すかの判定を `useAgentInterruptFocus.test.tsx` に任せ、帯の配線だけを確かめる:
  - `中断` にフォーカスがある状態でセッションが終わる（`running` → `exited` に描き直す）と `起動` へ移る
  - `起動` が `disabled` になる状態（閉じる途中・起動できない理由がある）で終わらせると `エージェント`（開閉のボタン）へ移る
- `agentScreensFixture.test.ts`: 足した画面を写した後の `AGENT_SCREENS_SHA256` と、個人情報のテストが通る（「実装の最初に確かめること」3）
- `AgentTerminalPanel.styles.test.tsx`: `[aria-disabled='true']` の不透明度・ホバーの規則
- 配線（L-060）: `useAgentWorkspace.test.ts`（または `useAppState.agent.test.ts`）で、偽の controller の `screen` を記録した作業中の画面にし、実物の組み立て役から `agentTerminal.interrupt.onInterrupt()` を呼ぶと `window.api.interruptAgentSession` が選択中のタブの `sessionId` で呼ばれる。送信中・確認の表示中は理由が出て呼ばれない。
  `useAgentWorkspace` の `isSending`・確認の表示中・活動・`sessions.interrupt` の受け渡しを 1 つずつ外す変異でどれかのテストが落ちることを確かめる
- 活動の判定: `agentActivity.test.ts` に記録した中断の後の画面（「実装の最初に確かめること」）を足す
- 実機: 「実機テスト仕様書の新しい項目の下書き」

## 実機テスト仕様書の新しい項目の下書き

`docs/manual-test-spec.md` の「## エージェント CLI のアプリ内ターミナル」の末尾（`### セッションの再開と履歴` の後、`## エージェントの変更の確認` の前）に `### 実行の中断` を足し、AGT-214 から振る。
既存の項目の ID と文言は変えない（AGT-040・AGT-046 は未起動の帯の項目で、`中断` は出ないため。AGT-048 のターミナルの `Esc` も変わらない）。
下書きの文言（ボタンの名前・理由・読み上げ）は、実装の後にコードの文言と照らし合わせて確定してから追記する（L-354）。手順は、各領域の前提のテスト用のフォルダで行い、ファイルを書き換える指示を含めない。
保存される設定（実行方式・VoiceOver）を変える項目は、確かめた後に元へ戻す手順を書く。前の項目の状態（入力欄の書きかけ・端末の作業ディレクトリ）に依存しないよう、書きかけは項目の終わりに消し、端末のコマンドは
作業ディレクトリを手順の中で決める（`cd` を書く）か、作業ディレクトリに依存しないもの（`pgrep`・`lsof`・`ps`・`kill`）だけにする。プロセスを止める手順（AGT-224）は、親のプロセス（このリポジトリの Electron）と作業ディレクトリで対象を
1 つに決め、決まらなければ止めない（L-072。AGT-160・AGC-142 の流儀に揃え、`-9` は使わない）。
エージェントの変更の確認と組み合わせる項目は、その領域の前提（テスト用のリポジトリ `$R`・B-2 の前提）で行うため、「## エージェントの変更の確認」の末尾に別の節として置く（AGC-146・AGC-147）。

> 前提: エージェント CLI 方式で、テスト用のフォルダを開いて `claude 1` を起動している。長い作業は `1 から 3000 までの数を、1 行に 1 つずつ書き出して` のように、ツールを使わずに 1 分以上応答が続くプロンプトを `実行` で送って作る。手順の途中で作業が終わってしまったら、同じプロンプトを送り直して手順の頭からやり直す。
> 前提: 長い作業の間に、ターミナルの入力欄で次の指示をキューに入れない（送信待ちの指示があると、中断の後にその指示が送られて作業中に戻る。既知の制約）。

- [ ] **AGT-214** `claude 1` が入力待ち（入力欄が空）のときに帯を見て、`中断` の上にマウスを載せてから押す → 状態の文言と `終了` の間に `中断` が薄い色で出て、`入力待ちのため、中断する作業がありません` が出る（マウスの `title`）。押しても `claude` の画面は変わらない
- [ ] **AGT-215** 長い作業を送り、帯が `作業中` になったら `中断` を押す → `中断` は押せる色で、押すと 1 秒以内に `claude` の画面に `Interrupted` が出て作業が止まり、帯が `入力待ち` に、`中断` が薄い色に戻る。`claude` は終了せず（帯は `終了しました` にならない）、続けて `さっきの続きを 10 行だけ書いて` を送ると前の作業を踏まえて答える
- [ ] **AGT-216** VoiceOver を有効にして長い作業を送り、ターミナルの中をクリックしてから `F6` で抜けて（フォーカスが開閉のボタン `エージェント` に移る）、`Tab` を押してフォーカスリングを見ながら（タブ列・`+` の後の）`中断` へ移し、リングが `中断` にあることを確かめてから `Enter` を押す → `中断（作業中の claude に Esc を送る）` と読まれ、押すと `claude 1 に中断（Esc）を送りました` が読み上げられる（続けて既存の `claude 1 の作業が終わりました` も読まれうる）。押した後もフォーカスリングは `中断` に残り、もう一度読ませると押せない理由が読まれる。続けて入力待ちのまま 1 秒以上待ってから `Enter` を押すと、`入力待ちのため、中断する作業がありません` が読み上げられる。確かめた後、VoiceOver を切る
- [ ] **AGT-217** 長い作業の間に、ターミナルの入力欄へ `書きかけ` と入力して（送信しない）から、帯の `中断` を押す → 作業が止まり、入力欄の `書きかけ` は消えずに残る。確かめた後、ターミナルで書きかけを消す（`Ctrl+U`）
- [ ] **AGT-218** 長い作業の間に `中断` をすばやくダブルクリックする。別の回に、先に入力欄へ `書きかけ` を入力しておいてから、ターミナルの中をクリックしてから `F6` で抜けて（フォーカスが開閉のボタン `エージェント` に移る）、`Tab` を押してフォーカスリングを見ながら（タブ列・`+` の後の）`中断` へ移し、リングが `中断` にあることを確かめてから `Enter` を 2 秒押し続ける。どちらの回も長い作業の間に行う → どちらの回も作業が 1 回止まるだけで、入力欄の `書きかけ` は残り、`claude` は終了しない。確かめた後、ターミナルで書きかけを消す（`Ctrl+U`）
- [ ] **AGT-219** `このフォルダに interrupt-test.txt を作って` を送り、ツールの許可の確認（`Do you want to …?`）が出たら帯の `中断` にマウスを載せてから押す → `中断` は薄い色で、`許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）` が出る。押しても許可の確認は残る（拒否されない）。確かめた後、ターミナルで `No` の選択肢を選んで答える（ファイルは作られない）。許可の確認が出ずにファイルが作られた（`claude` の設定で許可済み）ときは、そのことを記録して次へ進む（作られたのはテスト用のフォルダの中だけ）
- [ ] **AGT-220** ターミナルで `/model` の選択の画面を開き（選択肢は選ばない。`Enter` を押すとモデルの設定が保存されるため押さない）、帯の `中断` にマウスを載せる → `確認待ちのため中断できません（ターミナルで選んでください）` が出て押せない。確かめた後、ターミナルで `Esc` を押して選ばずに閉じる
- [ ] **AGT-221** 先にターミナルを 12 行ほどに低くしておいてから長い作業を送り、その間に入力欄へ画面の上端に達するまで書きかける（AGT-120 と同じ。送信しない。書きかけの途中で作業が終わったら、長い作業を送り直して書きかけからやり直す）→ 帯は `作業中` のまま。VoiceOver を有効にして `中断` を押すと、作業は止まらず `作業中か判定できないため押せません（ターミナルで Esc を押すと中断できます）` が読み上げられる。作業が終わって帯が `実行中` になると `中断` は薄い色で、マウスを載せると同じ理由が出る。確かめた後、書きかけを消す（`Ctrl+U`）・ターミナルの高さを元に戻す・VoiceOver を切る
- [ ] **AGT-222** `+` で `claude 2` を起動し、`claude 1` に長い作業を送ってから `claude 2`（入力待ち）を選ぶ → `中断` は押せない。`claude 1` を選び直すと押せ、押すと `claude 1` だけが止まり、`claude 2` の画面は変わらない
- [ ] **AGT-223** `終了` で `claude 1` を止めて帯を見る。続けて `起動` を押し、起動中の帯を見る → 止めた後は `中断` が出ない（`起動`・`前回の続きから` の並びは今までどおり）。起動中は `中断` が薄い色で出て、マウスを載せると `起動中は中断できません` が出る（起動中は短いので、見られなかったらそのことを記録して次へ進む。起動中の理由は `agentInterrupt.test.ts`・`useAgentInterrupt.test.ts` で、起動中に出ることは `AgentTerminalPanel.test.tsx` で固定している）
- [ ] **AGT-224** `claude 2` のタブがあれば `×` で閉じて（AGT-222 で起動したもの）、`claude 1` だけを起動して入力待ちにする。別の端末（ターミナル.app など）で `pgrep -f 'prompt-ide/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'` を実行し、このリポジトリの Electron の親のプロセスの pid を確かめる（ちょうど 1 つでなければ、何も止めずに出力を記録して終える）。`pgrep -P <その pid>` で子の pid を出し、子ごとに `lsof -a -d cwd -p <子の pid>` を実行して、作業ディレクトリ（`NAME` の列。macOS では先頭に `/private` が付いて出ることがあるので、その有無は無視して照合する）がテスト用のフォルダのものを選ぶ（macOS では `claude` のプロセス名がシンボリックリンクの先の版の番号になるため、`lsof -c claude` のようにコマンド名では絞らない）。当てはまる pid がちょうど 1 つでなければ、何も止めずに `pgrep` と `lsof` の出力を記録して終える。1 つなら、その端末で `sleep 10; kill <その pid>` を実行し（`-9` は付けない）、すぐにアプリのウィンドウへ戻ってターミナルの中をクリックし、`F6` で抜けて（フォーカスが開閉のボタン `エージェント` に移る）、`Tab` を押してフォーカスリングを見ながら（タブ列・`+` の後の）帯の `中断` へ移し、リングが `中断` にあることを確かめてから、ウィンドウを前面にしたまま 10 秒待つ（待つ前に 10 秒が過ぎそうなら、何も止めずに `sleep` からやり直す） → 帯が `終了しました…` になり、`中断` が消え、フォーカスは同じ帯の `起動`（`終了` が替わったボタン）にあってフォーカスリングが見える（画面の外に落ちない）。`起動` が押せない状態なら `エージェント`（開閉のボタン）にある
- [ ] **AGT-225** サイドバーを開いたまま、ウィンドウの幅を AGT-040 と同じく 650px 程度まで狭め、長い作業の間の帯を見る → 帯は 1 行（高さ 32px）のまま、`エージェント`・`中断`・`終了`・`最大化`（記録があれば `変更を確認` も）のボタンは文字も枠も切れずに見える。記録がある状態でも切れないことを確かめ、切れたらどのボタンが切れたかを記録する。タブ列と `作業中` は狭まって途中で切れうる
- [ ] **AGT-226** 長い作業の間に、押せる `中断` と押せない（入力待ちの）`中断` のそれぞれにマウスを載せる。`Tab` で移ったときのフォーカスリングも見る → 押せるときはホバーで青の背景・白の文字になり、押せないときは薄い色のままホバーで色が変わらず、カーソルは矢印。フォーカスリングはボタンの内側に、上下も切れずに見える
- [ ] **AGT-227** 設定の実行方式を「従来の方式」に切り替えて（確認で OK）エディタの下部を見る → ターミナルパネルは出ず、`中断` もどこにも無い。出力パネルの `キャンセル` は今までどおり（RUN-022）。確かめた後、設定の実行方式をエージェント CLI に戻す（保存される設定のため）

「## エージェントの変更の確認」の末尾（`### 利用者の git の設定とハンクを戻す` の後）に `### 帯の中断と利用者の変更との区別` を足し、AGC-146 から振る。

> 前提: 「利用者の変更との区別」の節の前提（B-2 の前提を含む）と同じ。この領域の冒頭の前提の手順でテスト用のリポジトリを作り直して開き（`R=$(mktemp -d); cd "$R" && git init …`）、そのリポジトリの直下で `echo .claude/ >> "${R:?}/.git/info/exclude"` を実行してから、アプリの中のタブで `claude` を起動する。項目ごとに、`claude` で「こんにちは」を送って確かめた状態にしてから `確認を終える` → `いまから記録する` で新しい記録を始める。端末のコマンドは、項目の先頭の `cd "${R:?}"`（`$R` を作った端末で実行する。別の端末なら作ったときに表示されたパスへ `cd` する）の後、`pwd` がテスト用のリポジトリであることを確かめてから実行する。

- [ ] **AGC-146** 端末で `cd "${R:?}"` を実行しておく。エージェントに `sleep 20 を実行して` を送り（許可を求められたら許可する）、実行中に帯の `中断` を押し、すぐ端末で `echo after >> "${R:?}/b.txt"` を実行して `更新` → `M b.txt` は印なし（AGC-117 と同じ。中断では `Stop` が届かない）。中断から 30 秒以内に次の指示（`こんにちは`）を送り、作業が終わった後に端末で `echo after2 >> "${R:?}/f.txt"` を実行して `更新` → `A f.txt` に `利用者の変更` が出る
- [ ] **AGC-147** 端末で `cd "${R:?}"` を実行しておく。`sleep 20 を実行して` を送り（許可を求められたら許可する）、実行中に帯の `中断` を押して、次の指示を送らずに 40 秒待ってから端末で `echo held >> "${R:?}/b.txt"` を実行して `更新` → `M b.txt` は印なしで、区別の状態の 1 行 `アプリの中で claude が動いていなかった間などの変更には、印を付けていません` が出る（AGC-127 と同じ）。続けて `こんにちは` を送り、作業が終わった後に端末で `echo resumed >> "${R:?}/f.txt"` を実行して `更新` → `A f.txt` に `利用者の変更` が出る

追記したら `node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact（<manual-test-spec-artifact-url>）を同じファイルパス（`.superpowers/manual-test-spec.html`）で再公開する。`npx vitest run scripts` が通ること。

## ROADMAP の更新の方針

- 「エージェント実行の支援（MVP の次）」の `- [ ] 実行のキャンセル / 中断の UI（現在はエージェント側の操作に任せる）`（:533）を `- [x] 実行のキャンセル / 中断の UI` にし、
  下に `実装済み（設計書 docs/superpowers/specs/2026-10-19-agent-interrupt-ui-design.md）: エージェント CLI 方式の帯の 中断（選択中のタブの claude に Esc を 1 回送る）。従来の方式は「Claude API 連携」の「実行中のキャンセル操作」を参照` を足す。
  括弧の先頭には、ROADMAP のほかの `実装済み（…）` の行と同じく、main に入れた日付（`2026-10-19` の形）を書き足す
- 実装済み機能の末尾（`### エージェントの変更の Git 管理外のフォルダでの記録` の後）に `### エージェントの実行の中断` を足す。設計書へのリンク、押せる条件（作業中だけ）・押せない理由・読み上げ・連打の対策・専用の IPC と、
  既知の制約（この設計書の「既知の制約」と同じ）を書く
- 「Claude API 連携（テキスト生成型の旧方式）」の `実行中のキャンセル操作（CLI 実行のキャンセル）`（:93）は従来の方式の機能として残し、`（エージェント CLI 方式の中断は「エージェントの実行の中断」）` を書き足す。
  2 つは別の方式の別の操作（従来の方式は子プロセス・API の要求を止める、エージェント CLI 方式は `claude` を止めずに作業だけを止める）であることが分かるようにする
- 「MVP の対象外」の行（:507）は MVP の時点の範囲の記録なので変えない
- エージェントの変更の確認と、利用者の編集との区別の節の 3 行を、行ごとの今の文言に合わせて次のように書き換える（ほかの部分は変えない）
  - :198（「エージェントの変更の確認」の既知の制約。今の文言は「中断の後を含む」で「Esc」を含まない）: 「起動から最初のプロンプトまで・中断の後を含む」を「起動から最初のプロンプトまで・中断（帯の `中断` を含む）の後を含む」にする
  - :419（利用者の変更とする条件）: 「中断（Esc）の後に次のターンの `Stop` が届くまで」を「中断（Esc。帯の `中断` を含む）の後に次のターンの `Stop` が届くまで」にする
  - :426（中断の後の保留）: 行頭の「中断（Esc）では `Stop` が届かないため」を「中断（Esc。帯の `中断` を含む）では `Stop` が届かないため」にする

## 既知の制約（ROADMAP・実機テスト仕様書に反映する）

- 押せる条件は画面の見た目からの活動の判定に基づくため、`claude` の版で画面が変わって判定が外れると、作業中でも押せない（`実行中` と表示され、ターミナルの `Esc` を使う）。判定が外れても、作業中でないときに送る側には倒れない
- 作業中に長い書きかけで入力欄の上の罫線が見えない（スピナーの行が画面の外にある）間は、`classifyAgentScreen` は `unknown` を返すが、`useAgentActivity` は出力が続く間の上限の判定で `unknown` を採らずに前の `working` を保つため、帯は `作業中` のままで `中断` も押せる見た目になる。押した時点の読み直し（手順 3）が `unknown` になり送らない（理由は読み上げだけで、画面には出ない。晴眼の利用者には押しても何も起きないように見える）。作業が終わって出力が止まると `実行中` になり押せない
- 中断の後の画面の判定は、実装時に記録した画面（「実装の最初に確かめること」）で確かめる。記録した版から `claude` の画面が変わると外れうる
- 押した時点で画面を読み直して作業中を確かめるが、画面の判定は claude の出力が画面に反映された時点のものなので、反映を待つ間と、確かめてから `claude` が `Esc` を受け取るまでの間（通常は数十 ms 以内。負荷が高いと延びる。ターミナルで Esc を押すときも同じ）に許可の確認が出ると、`Esc` は許可の拒否として働く（`claude` は代わりにどうするかを尋ねる）
- 中断が効いて作業が終わると、既存の通知が作業の完了として `claude N の作業が終わりました` を読み上げ、ウィンドウにフォーカスが無ければ OS の通知を出す（中断と完了を区別しない）
- エージェントの変更の確認では、中断の後に `Stop` が届かないため、30 秒以内に次の指示を送らないと次の指示まで割り当てを保留する（ターミナルの `Esc` と同じ。2026-10-13 の設計書）
- 連打の対策は帯の `中断` だけ。ターミナルで利用者が `Esc` を続けて押すと、今までどおり 2 回目で入力欄の書きかけを消しうる
- 作業中にキューに入れた指示（送信待ち）は、中断の後に送られて作業中に戻る（claude 2.1.291 で記録した画面 `interruptedQueued` で確かめた）。キューがあると、中断しても作業が続くことがある
- 中断は選択中のタブだけ。裏のタブの作業を止めるには、そのタブを選んでから押す
- 押せない理由は見える文字として出さない（`title` と `aria-describedby`、押したときの読み上げだけ）。晴眼のキーボード利用者には理由の文が見えず、隣の状態の文言（`入力待ち` など）と薄い色で判断する
- セッションが終わって `中断` が消えたときのフォーカスの移し先は「パネルの中で最後にフォーカスを受けた要素が `中断` か」で決める。`中断` にフォーカスを置いたまま、パネルの外の何も無いところ（フォーカスを受けない場所）をクリックして body に落とした後に終わると、`起動` へ移る

## 構成

| ファイル                                                                                         | 変更                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types/agentTerminal.ts`（`src/shared/types.ts` が `export type *` で再 export する） | `AgentInterruptResult`                                                                                                                         |
| `src/main/agentSession.ts`                                                                       | `AGENT_INTERRUPT_SEQUENCE`・`AgentSession.interrupt`                                                                                           |
| `src/main/agentSessionRegistry.ts`                                                               | `interrupt`                                                                                                                                    |
| `src/main/handlers/agentTerminalHandlers.ts`                                                     | `agentTerminal:interrupt`・deps の `Pick`                                                                                                      |
| `src/preload/api.ts`・`src/preload/index.d.ts`                                                   | `interruptAgentSession`                                                                                                                        |
| `src/renderer/src/lib/agentTerminalApi.ts`                                                       | `interruptAgentSession`                                                                                                                        |
| `src/renderer/src/lib/agentInterrupt.ts`（新規）                                                 | `AGENT_INTERRUPT_COOLDOWN_MS`・`getAgentInterruptAvailability`・`describeAgentInterruptBlockedByActivity`・`checkAgentInterruptAtPress`        |
| `src/renderer/src/lib/agentInterruptMessages.ts`（新規）                                         | 中断の名前・理由・読み上げ・失敗の文言                                                                                                         |
| `src/renderer/src/hooks/useAgentSessions.ts`                                                     | `interrupt`（`AgentSessionsState` に必須で足す）                                                                                               |
| `src/renderer/src/hooks/useAgentInterrupt.ts`（新規）                                            | 押した処理・読み上げ（`AgentInterruptPanelState`）・選択中のタブの型 `AgentInterruptTab`・判定の入力の写像 `toAgentInterruptAvailabilityInput` |
| `src/renderer/src/hooks/useAgentInterruptCooldown.ts`（新規）                                    | タブごとの送っている途中と 1,000ms の待ちの控え                                                                                                |
| `src/renderer/src/hooks/useAgentWorkspace.ts`                                                    | `AgentTerminalPanelState.interrupt`（必須）の組み立て                                                                                          |
| `src/renderer/src/components/agent/AgentTerminalPanel.tsx`                                       | `中断` のボタン・隠した理由・読み上げの要素                                                                                                    |
| `src/renderer/src/hooks/useAgentInterruptFocus.ts`（新規）                                       | `中断` が消えたときのフォーカスの移し先                                                                                                        |
| `src/renderer/src/assets/main.css`                                                               | `[aria-disabled='true']` の規則・`.agent-terminal-panel__live` を視覚的に隠す規則の並びに足す                                                  |
| `src/renderer/src/lib/__tests__/fixtures/agentScreens.json`                                      | 中断の後の画面（4 つ）と `_note` の版の記述                                                                                                    |
| `src/renderer/src/lib/__tests__/fixtures/agentScreens.ts`                                        | 冒頭のコメントの版の記述                                                                                                                       |
| `src/renderer/src/lib/__tests__/fixtures/README.md`                                              | 版・画面の数・両方の SHA-256・変わった行の数                                                                                                   |
| `src/renderer/src/lib/__tests__/agentScreensFixture.test.ts`                                     | `AGENT_SCREENS_SHA256`                                                                                                                         |
| `src/renderer/src/lib/__tests__/agentActivity.test.ts`                                           | `EXPECTED` に中断の後の画面・上のコメントの版の記述                                                                                            |
| `docs/manual-test-spec.md`・`ROADMAP.md`                                                         | 「実機テスト仕様書の新しい項目の下書き」・「ROADMAP の更新の方針」                                                                             |
| テスト                                                                                           | 「テスト方針」の各ファイル                                                                                                                     |

## 実装の分割

1 つの実装プランで、次の順のタスクにする。

1. **中断の後の画面の記録**: 「実装の最初に確かめること」の 1〜5。(1) `exp3.js` に中断用のモード（`interrupt`・`interruptdraft`・`interruptqueued`）を足す、(2) キューは `interruptqueued` の中で、応答の表示中に括弧付きの貼り付けと `\r` で作る、(3) 元の台帳に足してから `sanitize.py` で個人情報を置き換えて `agentScreens.json` へ写し、`AGENT_SCREENS_SHA256` と `fixtures/README.md` の SHA-256・行数・画面の数を更新する、(4) `_note`・`agentScreens.ts` の冒頭のコメント・`fixtures/README.md`・`agentActivity.test.ts` の版の記述を直す。`agentActivity.test.ts` の `EXPECTED` に足した画面を入れ、判定のテストを足す。結果を設計書の「既知の制約」に反映する
2. **IPC（shared・main・preload）**: `AgentInterruptResult`・`AgentSession.interrupt`・registry・受け口・preload・`index.d.ts`・`agentTerminalApi.ts`。main と preload のテスト、node-pty の統合テスト
3. **押せるかの判定と文言（renderer の純関数）**: `agentInterrupt.ts`・`agentInterruptMessages.ts` とそのテスト
4. **hook と組み立て（renderer）**: `useAgentSessions.interrupt`・`useAgentInterrupt`・`useAgentWorkspace` の配線とテスト（配線の変異の確認を含む）
5. **帯のボタンと CSS（renderer）**: `AgentTerminalPanel.tsx`・`main.css` とテスト
6. **ROADMAP の更新・既知の制約・テスト仕様書と全体の検証**:
   - ROADMAP: 「ROADMAP の更新の方針」のとおり
   - 実機テスト仕様書: AGT-214〜227（「## エージェント CLI のアプリ内ターミナル」の `### 実行の中断`）と AGC-146・AGC-147（「## エージェントの変更の確認」の末尾の `### 帯の中断と利用者の変更との区別`）を実装の文言と照らし合わせて確定し、追記する。`node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact を同じファイルパスで再公開する（コントローラーが行う）。`npx vitest run scripts` が通ること
   - 設計書の「既知の制約」を実装と照らし合わせ、食い違いがあれば直す
   - 全体の検証: `npm test`・`npm run typecheck`・変更したファイルへの `npx eslint`

main に入れた時点で利用者から見える挙動:

- エージェント CLI 方式で `claude` が動いている間、帯の `終了` の左に `中断` が出る。作業中だけ押せ、押すとターミナルで `Esc` を押したのと同じく作業が止まり、`claude 1 に中断（Esc）を送りました` が読み上げられる
- 入力待ち・許可待ち・確認待ち・判定できない画面・送信中では押せず、マウスを載せる（または読み上げの説明で）理由が分かる
- 続けて押しても 1 秒の間は 2 回目を送らない。従来の方式の `キャンセル` は今までどおり

## 反映した知見（dev-flow-kit の review-lessons.md）

選び方: 優先度 A のチェックリストを読み、今回の変更（renderer から pty へ書く IPC・押せる条件と理由・連打とフォーカス・非同期の結果とセッションの世代・テスト）に当たる項目の本文を読んだ。
優先度 B のうち、実機テスト仕様書の書き方に当たるもの（L-072・L-354）も反映した。

- L-001: main の `interrupt` は `sent`・`no-session`・`write-failed` を返し（既存の `write` のように握って黙らない）、renderer は `sent` のときだけ読み上げる。中断の成否（作業が止まったか）はアプリで扱わず、`claude` の画面の判定に任せる（「IPC」・「main」・「押したときの処理」）
- L-019: 専用の IPC は `sessionId` だけを受け取り、main が固定の `\x1b` を書く。`writeAgentSession` に `\x1b` を流さない。送信元のフレームの確認・所有者は `event.sender.id`（「IPC」・「main」）
- L-020: pty の kill・シグナルは使わない（止めるのは既存の `終了`）ので該当しない
- L-037: main は所有者の枠の現在のセッションの `sessionId` との一致で照合し（`write` と同じ）、停止中・古いセッションには書かない。renderer は結果が届いた時点でタブの `sessionId` が送った値と同じときだけ結果を出す（`stale`）（「main」・「押したときの処理」・「エラー処理」）
- L-041: 押せる条件（作業中）は renderer の判定で、描画の値と押した時点の画面の読み直しの両方で確かめる。対象外の活動（`permission`・`confirm`・`idle`・`unknown`）と従来の方式を、拒否するコードとテストで対象外にする（「押せるかの判定」・「テスト方針」）
- L-048: 失敗の出し方はタブの `error`（`終了` の失敗と同じ。接頭辞の形も同じ）、押せない理由は `起動` と同じ隠した `span` と `aria-describedby`、読み上げは既存の `useTransientNotice`・`toAnnouncementText`・`agent-terminal-panel__live`（`.agent-announcer` と同じ隠し方）。送信の手順の `Esc` を使わない方針を読み、矛盾しないことを確かめた（「設計で決めた事項」・「既存の機能との関係」）
- L-052: `claude` の反応を待たない（`pty.write` は同期で返る）ため、待ちの上限は要らない。renderer の 1,000ms は固定のタイマーで、アンマウントで消す（「main」・「連打の対策」）
- L-053: 押した処理は `finally` で再入の防止を解く。main の書き込みの例外は `write-failed` にして受け口から投げない（「押したときの処理」・「main」）
- L-055: `window.api` の呼び出しは `Promise.resolve().then` で包み、同期の例外も拒否と同じに扱う。テストに同期で投げる偽物を入れる（「押したときの処理」・「テスト方針」）
- L-057: 押せない理由を状態ごとに文言にし、`title` と `aria-describedby` で出す。押せない状態で押したときは（手順 2・3 とも）理由を読み上げる（「画面」）
- L-058: 押せない状態は `aria-disabled` の見た目だけでなく、押した処理の先頭で同じ純関数で判定して IPC を呼ばない。テストで押せないときの `click` が何もしないことを確かめる（「設計で決めた事項」・「押したときの処理」・「テスト方針」）
- L-059: 中断の後の `claude` の画面を実物で記録して判定のテストに入れ、pty への 1 バイトを実物の node-pty の統合テストで確かめる。実機の項目で `Interrupted` と書きかけが残ることを確かめる（「実装の最初に確かめること」・「テスト方針」・AGT-215・217）
- L-060: `AgentTerminalPanelState.interrupt`・`AgentSessionsState.interrupt` を必須にし、実物の組み立て役で `window.api.interruptAgentSession` まで届くテストと、受け渡しを 1 つずつ外す変異の確認を入れる（「テスト方針」）
- L-061: 新しい状態（中断を送っている途中・1,000ms の待ち）に対して、送信・キー入力・終了・タブの操作・方式とフォルダの切り替えを列挙して扱いを表にした（「新しい状態と既存の入口」）
- L-072: 実機の項目は、ファイルを書き換える指示を含めず（許可の確認では `No` で答える）、保存される設定（実行方式・VoiceOver・`/model`）を変えたら戻し、書きかけは項目の終わりに消す。プロセスを止める手順（AGT-224）は、親のプロセス（このリポジトリの Electron）の子のうち `lsof` の作業ディレクトリがテスト用のフォルダのもので `claude 1` の pid を 1 つに決め、決まらなければ止めず、`-9` を使わない（AGT-160・AGC-142 の流儀）。端末で `echo` を打つ項目は、前提が揃う「## エージェントの変更の確認」の末尾に置き、手順の中で `cd "$R"` する（AGC-146・AGC-147）（「実機テスト仕様書の新しい項目の下書き」）
- L-354: 実機の項目の文言は、実装の後にコードの文言と照らし合わせて確定してから追記する（「実機テスト仕様書の新しい項目の下書き」）
- L-408: 確認のダイアログを出さない代わりに、1,000ms の待ち・同期の再入の防止・`event.detail > 1` の無視・`Enter`・`Space` のリピートの抑止を入れ、フォーカスを押したボタンに残す（`aria-disabled`）。逆の操作（`終了`）・ターミナルへフォーカスを移さない。待ち・フォーカス・抑止が組で働くことを書いた（「連打の対策」・「フォーカス」）
