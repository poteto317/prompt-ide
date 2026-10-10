# エージェントの完了・許可待ちの通知 設計書

- 日付: 2026-10-10
- ROADMAP の項目: 「エージェント実行の支援（MVP の次）」→「完了・許可待ちの通知（ウィンドウが背面でも気づける）」
- 前提の設計書: `2026-10-09-agent-session-activity-design.md`（活動の判定。「含めないもの」の通知と `aria-live` をこの項目へ回した）、`2026-10-09-agent-multi-session-tabs-design.md`（タブ）

## 目的

ウィンドウが背面にある（ほかのアプリで作業している）間に、`claude` がツールの許可・確認を待ち始めたとき、作業を終えたときに気づけるようにする。
通知から、そのタブへすぐ戻れるようにする。ウィンドウが前面にあるときも、状態の変化を支援技術で読み上げる。

## 決めたこと（利用者の確認済み）

| 項目 | 決定 |
| --- | --- |
| 通知の手段 | OS の通知（Electron の main の `Notification`）と、Dock のバッジ（macOS。利用者の操作を待っているタブの数）。Windows・Linux ではバッジの代わりに、通知と同時にタスクバーのボタンを点滅させる（`BrowserWindow.flashFrame`） |
| きっかけ | 許可待ちになった・確認待ちになった・作業が終わった（作業中から入力待ちになった）の 3 つ |
| 条件と設定 | ウィンドウにフォーカスが無いときだけ OS の通知を出す。設定画面にオン・オフ（既定はオン）を置き、オフなら OS の通知もバッジも出さない |
| 押したとき | ウィンドウを前面にし、パネルを開いてそのタブを選び、そのタブのターミナルへフォーカスを移す。あわせて、状態の変化をアプリ内で `aria-live` で読み上げる（前面のときも） |
| 実行方式 | エージェント CLI 方式のときだけ知らせる（ステータスバーのまとめと同じ）。従来の方式へ切り替えると、残っている通知を閉じ、バッジを 0 にし、押した知らせではタブへ移らない（従来の方式ではターミナルのパネルが出ないため） |

## 範囲

含めるもの:

- タブごとの活動の変化から「知らせる出来事」を決める純粋な関数と、それを使う hook
- main の通知・バッジ・点滅の IPC（入力の検証・送信元の確認つき）と、通知を押したときに renderer へ知らせる IPC
- 設定（オン・オフ）の保存・設定画面の項目
- 状態の変化の読み上げ（常設の `aria-live` の領域）

含めないもの:

- 音の再生・通知の音の選択（OS の通知の既定の音に任せる）
- 通知の履歴の一覧・まとめた通知（タブごとに 1 件ずつ出す）
- エージェントの変更の一覧の自動の取り直し（ROADMAP の別項目）

## 知らせる出来事

活動（`AgentActivity`）の判定は前回の機能のまま使う。知らせるかどうかは、タブごとの**最後の確かな活動**（`unknown` を除いた直近の活動）の変化で決める。
`unknown` は判定できなかっただけなので、`working` → `unknown` → `permission` のような並びも `working` → `permission` として扱う。

| 出来事 | 条件（最後の確かな活動 → 新しい活動） | 通知の題 | 通知の本文 | 読み上げ |
| --- | --- | --- | --- | --- |
| `permission`（許可待ち） | `permission` 以外 → `permission` | `claude 2: 許可待ち` | `ツールの実行の許可を待っています` | `claude 2 が許可待ちになりました` |
| `confirm`（確認待ち） | `confirm` 以外 → `confirm` | `claude 2: 確認待ち` | `選択を待っています` | `claude 2 が確認待ちになりました` |
| `done`（作業の完了） | `working` → `idle` | `claude 2: 作業が終わりました` | `次の指示を待っています` | `claude 2 の作業が終わりました` |

- タブの名前は `formatAgentTabLabel`（`claude N`）を使う。main からも使うので、この関数を `src/shared/agentTabLabel.ts`（新規）へ移し、renderer の `agentSessionMessages.ts` はそれを再 export する（文言を二重に持たない）。
- 起動の直後に `confirm`（フォルダの信頼の確認など）になった場合は、最後の確かな活動が無くても知らせる（利用者の操作が要るため。起動の直後の `idle` だけを知らせない）。
- 次のときは知らせない:
  - タブが `running` でない（起動中・終了・未起動）。セッションが変わったら（`running` を出たら）、最後の確かな活動を忘れる。起動の直後の `idle`（最後の確かな活動が無い）は知らせない。
  - 閉じる途中のタブ（`isClosing`）。
  - 最後の確かな活動と同じ活動（`permission` が続く間は 1 回だけ）。
- 判定の遅れ（最大 500ms）の後に知らせる。判定そのものは変えない。
- 待っている状態の終わり: 最後の確かな活動が待っている活動（`permission`・`confirm`）から `working`・`idle` へ変わったら（許可・選択に答えたら）、出来事にはしない（`permission` → `idle` は完了ではない）が、そのタブの残っている「許可待ち」「確認待ち」の通知を閉じる（答えた後も通知センターに残ると、まだ許可が要ると誤解されるため）。許可待ち・確認待ちのまま `終了` などでセッションが `running` でなくなったときも、待っている状態の終わりとして（バッジが消えるのと合わせて）通知を閉じる（`running` を出た回に 1 回だけ。記録が消えるので重ねて送らない。`working`・`idle` のまま終了した場合は閉じる対象が無いので送らない）。`unknown` は判定できなかっただけなので終わりとしない。`permission` ↔ `confirm` の移り変わりは新しい通知で入れ替わるので閉じない。作業の完了（`done`）の通知は閉じない。

## 構成

### 出来事の決定（新規 `src/renderer/src/lib/agentNotificationEvents.ts`）

- `type AgentNotificationKind = 'permission' | 'confirm' | 'done'`（main・preload も使うので、一覧 `AGENT_NOTIFICATION_KINDS`・ガード `isAgentNotificationKind`・IPC の型と一緒に `src/shared/types/agentNotification.ts` に置き、lib から再 export する）
- 「利用者の操作を待っている活動」（`permission`・`confirm`）の規則は、ステータスバーの強調と共有するため `src/renderer/src/lib/agentActivity.ts` の `isAgentActivityWaitingForUser`（`Record<AgentActivity, boolean>` の表）に置き、出来事の決定・バッジの集計・強調（`agentActivitySummary` の `needsAgentAttention`）はこれを参照する。ステータスバーを押したときに選ぶ活動（`idle` も含む）はこれとは別の集まり。
- `nextAgentNotification(lastSettled: AgentActivity | null, next: AgentActivity): { kind: AgentNotificationKind | null; settled: AgentActivity | null }`
  — 上の表の純粋な関数。`settled` は次に覚える最後の確かな活動（`next` が `unknown` なら `lastSettled` のまま）。
- `AgentNotificationTab`（`slotId`・`number`・`status`・`isClosing`）: hook が受け取るタブの形。
- `AgentNotificationEvent`（`slotId`・`tabNumber`・`kind`）: 決まった出来事 1 件。読み上げと OS の通知の依頼の両方の元になるため、IPC の入力（`AgentNotificationShowRequest`）とは別の型にする（形は同じで、そのまま送る）。
- `advanceAgentNotifications(previous, tabs, activities): { settled, events, finishedWaiting }`: タブの一覧全体に `nextAgentNotification` を当てる。渡された記録は書き換えず、新しい記録を返す。消えたタブ・`running` でないタブの記録は消し、閉じる途中のタブは記録だけ進めて知らせない。`finishedWaiting` は待っている状態が終わったタブ（最後の確かな活動が `permission`・`confirm` から `working`・`idle` へ変わったタブ）の `slotId`（タブの並び順。閉じる途中のタブも含む。同じ回に出来事があるタブは含まない）。最後の確かな活動が `permission`・`confirm` のまま `running` でなくなったタブも含む。
- `findRemovedAgentNotificationTabs(previous, tabs)`: 前のタブの一覧にあって今の一覧に無いタブ（閉じたタブ）の `slotId`。最後の確かな活動の記録（`running` でないタブは消える）ではなくタブの一覧で比べ、終了してから閉じたタブも拾う。
- `formatAgentNotificationAnnouncement(events)`: 同時に決まった出来事の読み上げの文言（タブの並び順のまま「。」でつなぐ）。
- `countAgentTabsWaitingForUser(tabs, settled)`: バッジの数（最後の確かな活動で数える）。
- 文言の表（題・本文・読み上げ）は main と renderer の両方から読むので `src/shared/agentNotificationText.ts`（新規）に置く。OS の通知の題と本文は main がこの表から組み立て、renderer は読み上げの文言だけを使う。

### 活動の変化の監視（新規 `src/renderer/src/hooks/useAgentNotifications.ts`）

- 入力: タブの一覧（`slotId`・`number`・`status`・`isClosing`）、活動の `ReadonlyMap<slotId, AgentActivity>`、通知の設定（`enabled: boolean | null`。読み込み中は `null`）、エージェント CLI 方式か（`isAgentMode: boolean`。従来の方式・方式の読み込み中は `false`）、通知を押したときにタブへ移る関数 `activateTab(slotId)`。
- タブごとに最後の確かな活動を `ref`（`Map<slotId, AgentActivity>`）に持ち、活動の Map **またはタブの一覧（`status`・`isClosing`）**が変わるたびに見直す。活動の Map は内容が同じなら同じ参照のまま（`running` でないタブは `unknown`）なので、`unknown` のまま終了・再起動したタブは活動の Map だけでは変化が見えない。消えたタブ・`running` でないタブの記録は、タブの一覧の変化で必ず消す（消し忘れると、再起動の直後の `idle` が `working` → `idle` の完了として誤って知らされる）。
- 出来事があれば:
  - 読み上げの文言を state に入れる（常設の `aria-live` の領域に渡す。設定に関わらず読み上げる）。
  - 設定がオンなら、`agentNotification:show`（`{ slotId, tabNumber, kind }`）を main へ送る。フォーカスの有無は main が判断する（前面なら main が前の通知を閉じるだけにする）。
  - 設定がオフ・読み込み中なら、出来事のタブごとに `agentNotification:dismiss`（`{ slotId }`）を送る。新しい出来事が起きた時点で、オンのときに出した前の通知は古く、今の状態と食い違う（例: 作業の完了の通知が残ったまま許可待ちになる）ため（閉じたタブ・待っている状態が終わったタブと同じ考え方）。同じ描画で `finishedWaiting` にも入るタブには 1 回だけ送る。
- バッジ: 最後の確かな活動が許可待ち・確認待ちで、`running` で閉じる途中でないタブの数を求め（今の活動で数えると、判定の一時的な `unknown` で数が揺れるため）、変わったら `agentNotification:setBadge`（`{ count }`）を送る。前回の送信の値の初期値は「未送信」（`null`）にし、マウントの直後は 0 でも必ず送る（リロードの前のバッジを上書きするため）。設定がオフ・読み込み中、またはエージェント CLI 方式でなければ 0 を送る。アンマウントで 0 を送る。
- 閉じたタブ: 前回見たタブの一覧（`ref`。マウントの直後は空）と比べ、一覧から消えたタブごとに `agentNotification:dismiss`（`{ slotId }`）を送る。タブの番号は空いている最小の番号で使い回され、`slotId` は新しく作られるので、閉じたタブの通知を残すと同じ題の通知が並ぶため。設定がオフ・読み込み中でも送る（オンのときに出した通知が残っているかもしれないため）。`running` でない・閉じる途中のタブは、一覧に残っている間は送らない。
- 待っている状態が終わったタブ: `advanceAgentNotifications` の `finishedWaiting` のタブごとに `agentNotification:dismiss`（`{ slotId }`）を送る（閉じたタブと同じ経路）。設定がオフ・読み込み中でも送る（オンのときに出した通知が残っているかもしれないため）。作業の完了の通知は閉じない。
- 出来事の決定・読み上げの文言・待っている数の集計は上の `agentNotificationEvents` に任せ、hook は記録（`ref`）の保持・読み上げの state・IPC の送信・購読だけを受け持つ。
- 通知を押したときの知らせ（`agentNotification:activated`、`{ slotId }`）を購読し、今のタブの一覧にあれば `activateTab(slotId)` を呼ぶ。無ければ何もしない（閉じたタブ）。エージェント CLI 方式でなければ何もしない（従来の方式ではパネルが出ず、パネルの開閉の状態だけが書き換わるため）。アンマウントで購読を外す。
- エージェント CLI 方式でないとき: 最後の確かな活動は更新し続けるが、出来事を読み上げず、通知も送らない（待っている状態が終わったタブ・閉じたタブ・出来事のタブの dismiss は送る）。エージェント CLI 方式でなくなった回に 1 度、一覧のタブすべてへ `agentNotification:dismiss` を送り、残っている通知（終了では閉じない作業の完了の通知を含む）を閉じる。マウントの時点の方式から見始め、マウント・StrictMode の取り付け直しでは送らない。エージェント CLI 方式へ戻ったら通常どおり知らせる。
- IPC の失敗（例外・拒否）は握りつぶして `console.warn` に出す。通知が出せなくても活動の表示・読み上げは止めない。

### タブへ移る（`useAgentStatusBar` の一般化）

- ステータスバーのまとめを押したときの「パネルを開き、タブを選び、描画の後にそのタブのターミナルへフォーカスを移す」処理を、タブを指定して呼べる `activateTab(slotId)` として切り出す（`useAgentTabActivation`。`useAgentStatusBar` はこれを使う）。
- 通知を押したとき（ウィンドウが前面に戻った直後）も同じ関数を使う。

### main（新規 `src/main/agentNotifications.ts`・`agentNotificationRuntime.ts`・`agentNotificationLifecycle.ts`・`src/main/handlers/agentNotificationHandlers.ts`・`agentNotificationPayloadParser.ts`）

- 分担: `agentNotifications.ts` の `createAgentNotificationCenter` が通知の記録・表示・前面化・点滅・バッジを受け持つ（Electron には自前のインターフェース `AgentNotificationWindow`・`AgentNotificationHandle` と注入される関数でだけ触れる）。Electron の `Notification` を包む部分は `agentNotificationRuntime.ts` の `createElectronAgentNotification`、ウィンドウのフォーカス・閉じた・リロードを center へつなぐのは `agentNotificationLifecycle.ts`、IPC の受け口は `agentNotificationHandlers.ts`、入力の検証は `agentNotificationPayloadParser.ts`。`ipcHandlers.ts` は Electron の実物を注入して配線するだけ。

- `agentNotification:show`:
  - 送信元がメインフレームか（`isMainFrameSender`）を確かめ、入力を検証する（`slotId` は既存の形式、`tabNumber` は 1〜`AGENT_MAX_SESSIONS_PER_WINDOW` の整数、`kind` は 3 つのどれか。それ以外は例外）。
  - 送信元の `BrowserWindow`（`BrowserWindow.fromWebContents`）が無い・破棄済みなら何もしない。
  - ウィンドウにフォーカスがある（`isFocused()`）、または `Notification.isSupported()` が false なら、新しい通知は出さず、同じウィンドウ・同じ `slotId` の前の通知だけを閉じて記録から外す（新しい出来事が起きた時点で前の通知は古いため。例: 作業の完了の通知が残ったまま、前面で同じタブが許可待ちになる）。閉じてそのウィンドウの通知が無くなれば点滅を止める（下の「点滅を止める」）。題・本文は `src/shared/agentNotificationText.ts` の表から main で組み立てる（renderer の文字列を通知に出さない）。
  - 同じウィンドウ・同じ `slotId` の前の通知が残っていれば閉じてから出す（タブごとに最新の 1 件だけ）。
  - 通知を押したら、ウィンドウを前面にし（最小化なら `restore`、`show`、`focus`）、`agentNotification:activated`（`{ slotId }`）をそのウィンドウの webContents へ送る。
  - Windows・Linux（`process.platform !== 'darwin'`）では、通知と同時に `flashFrame(true)` を呼ぶ。ウィンドウがフォーカスを得たら `flashFrame(false)` に戻す。
  - 点滅を止める: 点滅は Windows・Linux でのバッジの代わりなので、dismiss・前面のときの show で前の通知を閉じた後、そのウィンドウに残っている通知（作業の完了の通知も含む）が無ければ `flashFrame(false)` を呼ぶ（背面のまま許可待ちのタブが終了した、などで通知が無くなっても点滅を残さない）。`clearWindow` でも通知を閉じた後に止める。破棄済みのウィンドウには触れず、`flashFrame` が投げても後続を止めない（L-053）。
  - ウィンドウが閉じたら、そのウィンドウの通知の記録を消し、残っている通知を閉じ、Dock のバッジを 0 に戻す（renderer のアンマウントの送信が届かず、古いバッジが残るため）。
  - リロード（メインフレームの文書が置き換わったとき。既存の `onMainFrameDocumentReplaced` を使う。`did-start-navigation` は止められた遷移でも届くため使わない）でも、残っている通知を閉じる。リロードの後はタブが 1 つに戻る（前の機能の既知の制約）ため、押されても届ける先のタブが無い。
  - `Notification` のインスタンスは、次のどれかが起きるまで main で保持する（GC で click が失われないように）。記録から外すのはこれらだけで、通知の `close` の知らせでは外さない（すべての OS で）。(a) 押される。(b) 同じタブの次の通知に入れ替わる。(c) 同じタブの新しい出来事で新しい通知を出さない（前面・通知に対応していない〈show が閉じる〉、設定がオフ・読み込み中・従来の方式〈renderer が dismiss を頼む〉）。(d) タブを閉じる・待っている状態が終わる（`agentNotification:dismiss`）。(e) エージェント CLI 方式から従来の方式へ切り替えた（renderer が一覧のタブすべてへ dismiss を頼む。従来の方式ではパネルが出ず、押しても何も起きないため）。(f) ウィンドウを閉じる／リロード（`clearWindow`）。Windows は `close` をトーストのタイムアウトでも知らせるが、通知はアクションセンターに残り、その後の `close()` で消せるため。知らせで外すと、同じタブの前の通知・ウィンドウの後始末で閉じられず、アクションセンターに積み上がる。記録はウィンドウごと・開いているタブごとに 1 件で、`clearWindow` で消えるので、件数の上限は設けない。
- `agentNotification:dismiss`:
  - 送信元の確認と検証（`slotId` は既存の形式）。送信元のウィンドウが無ければ何もしない。
  - そのウィンドウ・その `slotId` の通知が残っていれば閉じて記録から外す（無ければ何もしない）。閉じてそのウィンドウの通知が無くなれば点滅を止める（Windows・Linux）。
- `agentNotification:setBadge`:
  - 送信元の確認と検証（`count` は 0〜`AGENT_MAX_SESSIONS_PER_WINDOW` の整数）。
  - macOS では `app.dock.setBadge(count > 0 ? String(count) : '')`。ほかの OS では何もしない。
  - ウィンドウが 1 つの前提で、最後に送られた値を出す（複数ウィンドウの合算はしない。既知の制約）。
- 通知の要求は main で外部プロセスを起動しない。通知の文字列は固定の表から作る（L-019）。

### 設定

- 型と既定値: `src/shared/types/settings.ts` に `DEFAULT_AGENT_NOTIFICATIONS_ENABLED = true`。
- 保存: `settingsFileStore.ts` の `SettingsFile` に `agentNotificationsEnabled?: boolean` を足し、`agentNotificationSettingStore.ts`（新規。`executionModeStore.ts` と同じ形。読めない・型が違えば既定値）。
- IPC: `settings:getAgentNotificationsEnabled`・`settings:setAgentNotificationsEnabled`（`boolean` 以外は例外）。preload と `settingsApi.ts` に足す。
- hook: `useAgentNotificationSetting`（`useExecutionMode` と同じ形。読み込み中は `null`、変更は楽観的に反映して保存し、失敗したら元に戻す）。
- 設定画面: `SettingsPanel` に「エージェントの通知」の節（チェックボックス「ウィンドウが背面のとき、許可待ち・確認待ち・作業の完了を通知する」）。説明に「Dock のバッジ（macOS）・タスクバーの点滅（Windows・Linux）も、この設定でまとめてオン・オフします」と書く（点滅は通知と同時に main が起こすので、オフで通知を頼まなければ点滅もしない）。

### 読み上げの領域

- 同じ描画で複数のタブに出来事が起きたら、読み上げの文言を「。」でつないで 1 つにする。
- 常設の `<p aria-live="polite" aria-atomic="true">`（見た目は隠す。このリポジトリに `sr-only` は無いので `agent-announcer` の class で隠す）を、エージェントのパネルの開閉に関わらず描画される場所（`App` のステータスバーの隣）に置く。同じ要素の文言を入れ替える（既存の慣例）。
- 同じタブの同じ出来事が続けて起きると、領域の文言が変わらず読み上げが省かれうる（既知の制約）。

### Windows の通知の前提

- `src/main/index.ts` の `electronApp.setAppUserModelId('com.electron')` を、`electron-builder.yml` の `appId`（`com.electron.app`）と同じ値にする。値は `src/main/appIdentity.ts` の `APP_USER_MODEL_ID` に置き、一致を `appIdentity.test.ts` で確かめる。Windows のトースト通知は、ショートカットの AppUserModelID と一致しないと表示されない・押しても届かないことがあるため。

## エラーと境界の扱い

- 通知が許可されていない（OS の設定で通知を切っている）場合、`Notification.show()` は例外を出さずに表示されない。アプリは検知しない（既知の制約。設定の説明に「OS の通知の設定も確かめる」と書く）。
- `Notification.isSupported()` が false の環境では何もしない。
- IPC の失敗で活動の表示・読み上げは止めない。
- ウィンドウを閉じる・リロードで、残っている通知は閉じる（押しても届く先が無いため）。リロードの後、バッジは renderer の最初の送信で上書きされる。

## 既知の制約（ROADMAP・実機テスト仕様書に反映する。実機テスト仕様書は「エージェント CLI のアプリ内ターミナル」の領域に `### 完了・許可待ちの通知` を足し、AGT の続きの番号を使う）

- 判定は画面の見た目に基づくため、判定が外れると通知も外れる（前回の機能の既知の制約と同じ）。
- 1 ウィンドウを前提にバッジの数を出す（複数ウィンドウの合算はしない）。
- 通知の音・表示の可否は OS の通知の設定に従う（アプリから許可を求めない）。
- 同じタブの同じ出来事が続けて起きると、読み上げが省かれうる。
- 判定の性質上、次の並びは知らせない: 続けて出た許可の確認の間で `working` が判定されなかった（出力が 150ms 静まらず、上限の判定が `unknown` で採られない）場合の 2 回目の許可待ち、作業中に入力欄が画面の高さを超えたまま作業が終わった（`unknown` が続く）場合の完了。
- 開発中（`npm run dev`）の起動では、OS によって通知の送り元の名前・アイコンが Electron になる。
- 通知の記録は `close` の知らせでは外さないため、利用者が消した通知の記録も、設計書「main」の記録から外す契機（押す・入れ替わり・新しい通知を出さない・タブを閉じる／待っている状態が終わる・従来の方式への切り替え・ウィンドウを閉じる／リロード）まで残る（ウィンドウごとに、通知が出たことのある開いているタブの数まで）。消えた通知への `close()` は何もしない。
- バッジは最後の確かな活動で数えるため、許可や選択に答えた後に判定できない画面（`unknown`）が続くと、次に `working`・`idle` と判定できるまでバッジが残る。同じ理由で、その間は「許可待ち」「確認待ち」の通知も通知センターに残る（例: todo の一覧が入力欄の直上に出てスピナーが画面の外にある、入力欄が画面の高さを超えた）。ステータスバーは今の活動で強調するので、強調は消えてもバッジ（と通知）だけ残る。

## テスト

- `nextAgentNotification`: 表の各行、`unknown` を挟んだ並び、同じ活動が続く、起動の直後の `idle`（知らせない）・`confirm`（知らせる）、`working` → `unknown` → `idle`（完了）、`permission` → `working` → `permission`（2 回目も知らせる）。
- `advanceAgentNotifications`: タブごとの記録の進め方、`finishedWaiting`（許可待ち・確認待ち → `working`・`idle` のタブだけ。`unknown`・同じ活動・`permission` → `confirm`・作業の完了・起動の直後は含まない。閉じる途中のタブは含む。`permission`・`confirm` のまま `running` でなくなったタブは含み、`idle`・`working` のまま `running` でなくなったタブは含まない）。
- 文言の表（`src/shared/agentNotificationText.ts`）: 3 つの出来事の題・本文・読み上げ。
- `useAgentNotifications`: 出来事のときに show を送る・設定がオフ・読み込み中なら送らない（読み上げはする）・閉じる途中・`running` でないタブは知らせない・セッションが変わると記録を忘れる・`unknown` のまま終了して再起動しても `done` を出さない・バッジの数（最後の確かな活動が許可待ち・確認待ちのタブだけ、一時的な `unknown` で揺れない、閉じる途中を除く、オフで 0、アンマウントで 0）・押されたときに今あるタブなら `activateTab`、無ければ何もしない・タブの一覧から消えたタブで dismiss を送る（マウントの直後・取り付け直し・`running` でない・閉じる途中では送らない、オフでも送る）・許可・選択に答えたタブ（許可待ち・確認待ち → `working`・`idle`）で dismiss を送る（`unknown`・`permission` → `confirm`・作業の完了では送らない、オフでも送る）・許可待ちのまま終了したタブで 1 回だけ dismiss を送る・設定がオフ・読み込み中なら出来事のタブで dismiss を送る（show は送らない）・エージェント CLI 方式でなければ読み上げ・show を送らず、バッジは 0、方式が変わった回に 1 度だけ一覧のタブすべてへ dismiss を送り（マウントでは送らない）、押しても `activateTab` を呼ばない（戻ると呼ぶ）・購読の後始末・IPC の失敗で止まらない。
- `useAgentTabActivation`: 既存の `useAgentStatusBar` のフォーカスのテストを移し、タブ指定で呼べること。
- main: 入力の検証（PayloadParser）、送信元の確認、フォーカスがあれば出さない（前の通知は閉じる。通知に対応していないときも）、同じタブの前の通知を閉じる、押したときに前面化して activated を送る、タブを閉じたときにそのタブの通知だけを閉じる、Windows・Linux で点滅し、フォーカスで止める、dismiss・前面のときの show・後始末でそのウィンドウの通知が無くなれば止める（ほかのタブの通知が残っていれば止めない）、バッジ（macOS だけ）、ウィンドウを閉じたとき・リロードのときの後始末。`Notification`・`app.dock` はモックするので、実物の表示は実機テスト仕様書で確かめる（L-059）。
- 設定: ストアの既定値・不正値・保存、IPC の検証、hook の楽観的な反映と失敗時の戻し、設定画面のチェックボックス。
- 読み上げの領域: 出来事の文言が入る、常設である（パネルを閉じても残る）。

## 気をつける知見（dev-flow-kit の review-lessons.md）

- L-019（renderer の値で外部の動作を決めない → 通知の文字列は main の固定の表から作る）、L-023（同じ事実を複数の入力で受けない → `tabNumber` と `slotId` の食い違いは通知の題にしか影響しない範囲に限る）、
  L-053（通知の途中の例外で後続が止まらない）、L-059（モックしたテストだけでは実物の通知・バッジを検証できない → 実機テスト仕様書）、L-399（判定のデバウンスは既存のまま使う）、L-393（閉じる途中の要素を数えない）、L-156（見える文字と読み上げの一致）。
