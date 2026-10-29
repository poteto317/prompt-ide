# エージェント CLI の会話の ID の名前を CLI の種類を問わない名前にそろえる 設計書

- 日付: 2026-10-28
- 種類: 名前の変更（アプリの挙動は変えない。保存の形も変えない）
- きっかけ: 段階 3a・3b で copilot も再開と hooks による区別に対応したが、会話の ID を表す欄・関数・型・ファイル名・doc コメント・文言には `claudeSessionId`（「claude の会話の ID」「claude のセッション ID」）という呼び名が残っている。copilot の ID も同じ欄に入るので、名前が事実と合わない
- 前提: 段階 3a の設計書（`docs/superpowers/specs/2026-10-23-agent-cli-copilot-resume-design.md`）で、実行履歴の保存の欄名 `agent.claudeSessionId` は古い版のアプリとの互換のため保つと決めてあり、コード上の名前の改名は「やらないこと」に送ってあった。この設計書はその改名を扱う
- 知見: L-310・L-203・L-459・L-618・L-609・L-624・L-017・L-015・L-065（「気をつける知見」）
- 実装は 1 つの実装プラン・1 つの PR にする

## 目的

エージェント CLI（claude・copilot）の会話の ID を表すコード上の名前（変数・欄・関数・型・ファイル名）と、doc コメント・テストの題・ログ・例外の文言を、CLI の種類を問わない名前にそろえる。保存の欄名（ディスクに書く JSON のキー）は変えず、古い版のアプリとの読み書きでデータが消えないことを保つ。

## 調べた結果

### 出現の数（2026-10-28 の `refactor/agent-session-id-name`・`ac0f7f5`）

- `grep -rn claudeSessionId src`: **411 行**（`grep -o` で 419 か所）。48 ファイル（実装 16・テスト 32）
- 仲間の名前（`grep -rhoiE '[A-Za-z_]*claude_?session[A-Za-z_]*' src` の結果。テストを含む `grep -o` の数）:

| 名前                                  |  数 | 置き場                                                                               |
| ------------------------------------- | --: | ------------------------------------------------------------------------------------ |
| `claudeSessionId`                     | 419 | shared・main・renderer・テスト                                                       |
| `createClaudeSessionId`               |  19 | `agentSessionStarter.ts`（注入の option）・`ipcHandlers.ts`・テスト                  |
| `createClaudeSessionReservations`     |  17 | `claudeSessionReservations.ts`・`ipcHandlers.ts`・テスト                             |
| `isClaudeSessionId`                   |  16 | `shared/types/agentTerminal.ts`・`shared/types.ts`（再 export）・main の 4 ファイル  |
| `setTabClaudeSessionId`               |  11 | `useAgentSessions.ts`                                                                |
| `selectClaudeSessionId`               |  10 | `claudeSessionIdSelection.ts`・`agentSessionStarter.ts`・テスト                      |
| `findActiveAgentTabByClaudeSessionId` |  10 | `agentSessionTabState.ts`・`agentResumeAvailability.ts`・テスト                      |
| `claudeSessionReservations`（文字列） |  10 | ファイル名・import のパス・コメント                                                  |
| `ClaudeSessionReservations`           |   8 | `claudeSessionReservations.ts`・`agentSessionStarter.ts`・テスト                     |
| `CLAUDE_SESSION_ID`                   |   7 | `agentHookSessions.test.ts` のテストの定数（`CLAUDE_SESSION_ID_PATTERN` の分は除く） |
| `CLAUDE_SESSION_ID_PATTERN`           |   5 | `shared/types/agentTerminal.ts`・`shared/types.ts`・テスト                           |
| `isClaudeSessionIdActiveElsewhere`    |   5 | `useAgentSessions.ts`                                                                |
| `claudeSessionIdBySlotRef`            |   5 | `useAgentSessions.ts`                                                                |
| `claudeSessionIdSelection`（文字列）  |   3 | ファイル名・import のパス・コメント                                                  |
| `ClaudeSessionIdSelection`            |   2 | `claudeSessionIdSelection.ts`                                                        |

- 日本語の呼び名: 「claude の会話の ID」19 か所、「claude のセッション ID」5 か所（実装の例外 3・ログ 1・テストの題 1）。「claude のセッション」の残りは、CLI の種類が claude と決まっている文脈（`前回の続きから（… claude のセッションを再開）` の文言は `${commandName}` で組み立てた結果、`agentTerminalHandlers.test.ts:951` は claude の種類の題）で、改名の対象ではない

### `claudeSessionId` の 419 か所が指すもの

TypeScript の language service（`getDefinitionAtPosition`）で、各出現がどの宣言を指すかを分けた（コードは変えず、一時のスクリプトで調べた）。

| 指す宣言                                                                              |  数 | 層           |
| ------------------------------------------------------------------------------------- | --: | ------------ |
| `AgentStartResult.claudeSessionId`（`agentTerminal.ts:77`）                           |  64 | (b) IPC      |
| `AgentHistoryInfo.claudeSessionId`（`history.ts:9`）                                  |  31 | (a) 保存     |
| `AgentLaunchRequest` の resume の `claudeSessionId`（`agentTerminal.ts:57`）          |  21 | (b) IPC      |
| `AgentLastSession.claudeSessionId`（`agentTerminal.ts:144`）                          |  17 | (b) IPC      |
| `AgentSessionTabView.claudeSessionId`（`useAgentSessions.ts:64`）                     |  17 | (c) renderer |
| `AgentLastSessionLookup` の found（`agentResumeAvailability.ts:31`）                  |  16 | (c) renderer |
| `AgentSessionSnapshotEntry.claudeSessionId`（`agentTerminal.ts:137`）                 |  12 | (b) IPC      |
| 宣言の無いもの（コメント・文字列・`Record<string, unknown>` の欄の読み）              |  19 | (a)〜(d)     |
| main・renderer の中の型の欄・引数・変数・テストの中の変数（残り。1〜10 か所ずつ多数） | 222 | (a)〜(c)     |

`getDefinitionAtPosition` は、型の注釈が無く文脈の型も付かないオブジェクトリテラル（注釈の無い `const`、`toEqual`・`toMatchObject`・`toHaveBeenCalledWith`・`expect.objectContaining` の引数、`vi.fn().mockResolvedValue(…)` の値など）の欄を、元の型の宣言に結び付けない（リテラル自身が定義になる）。そのため、上の「残り 222 か所」には、履歴の形の値（(a)）と IPC の値（(b)）も混ざっている。次の節で、テストの中の型の付かない値を 1 行ずつ分け直した。

### テストの中の型の付かない値の分け方

上の解析で「定義が自分自身（同じテストのファイルの中）」になった出現を全部拾い（**134 行**）、1 行ずつ前後を読んで分けた。どれも `vi.fn()` の緩い型や注釈の無いリテラルの中にあり、**型検査では直し漏れが見つからない**。行番号は `ac0f7f5` の時点のもの（実装プランで grep し直す）。

| 分類                                            | 行数 | 行（`src/` から）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | タスク   |
| ----------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| (a) 履歴の欄（**残す**）                        |   19 | `main/__tests__/historyUtils.test.ts:162・166・171・180・189`（型を付けない `agent` の値）、`renderer/src/components/__tests__/App.agentSessionResume.test.tsx:122・172・236`（`loadHistory` の偽物が返す履歴の `agent`）、`renderer/src/lib/__tests__/agentSendCallbacks.test.ts:22・67`（`onSent` に渡す `sentTo`）、`renderer/src/lib/__tests__/agentTabSessionInfo.test.ts:21・33`（`describeAgentTabSession` の戻り値を `toEqual` で比べる）、`renderer/src/lib/__tests__/historyEntryFactory.test.ts:39`（`sent`）、`renderer/src/hooks/__tests__/usePromptRunner.test.ts:460`（`...SENT_TO` の上書き）、`renderer/src/hooks/__tests__/useAgentWorkspace.test.ts:2436・2488`（`describeSession()` の `toEqual`）・`:3194`（`onSent` の `objectContaining`）、`renderer/src/lib/__tests__/agentResumeAvailability.test.ts:107・194`（`recorded`） | 変えない |
| (b) IPC の欄（**改名する**。main のテスト）     |   72 | `main/__tests__/agentCliLaunch.integration.test.ts:251・268・402`、`agentCliLaunchSpecs.test.ts:13`（`as unknown as`）、`agentSessionSnapshot.test.ts:30・31・46`、`agentSessionStarter.capabilities.test.ts:139・148`、`agentSessionStarter.test.ts` の 32 行（148・340・357・376・421・431・449・495・512・587・597・646・673・688・711・726・743・747・763・777・798・814・1130・1150・1163・1173・1216・1231・1297・1367・1381・1407。起動の結果・`sessionInfoOf`・`lastSessionOf` の `toEqual`・`toMatchObject` と、1130 行の補助の引数）、`claudeSessionIdSelection.test.ts:15・31・52`、`handlers/agentTerminalHandlers.test.ts:146・243・476・618・642・661・671・769・797・854・862`、`handlers/agentTerminalPayloadParser.test.ts:159・162・166・167・177・178・180・186・192・196・198・199・200・201・215・217・230`                       | 3        |
| (b) IPC の欄（**改名する**。renderer のテスト） |   12 | `renderer/src/components/__tests__/App.agentReferences.test.tsx:85`（`startAgentSession` の `mockResolvedValue`）、`App.agentSessionResume.test.tsx:76・82・271`（起動の結果の偽物）・`:263`（`getLastAgentSession` の `mockResolvedValue`）・`:151・285`（`launch` の `objectContaining`）、`renderer/src/hooks/__tests__/useAgentResume.test.ts:174・227・247`（`sessions.start` に渡る `launch`）、`useAgentWorkspace.test.ts:2414・2846`（`launch`）                                                                                                                                                                                                                                                                                                                                                                                               | 3        |
| (c) renderer の中の欄・引数（**改名する**）     |   31 | `renderer/src/hooks/__tests__/useAgentLastSession.test.ts:72・113・125・136・148・156・161・166・178・184・197・207・219・230`（`AgentLastSessionLookup` の `toEqual`）、`useAgentSessions.test.ts:40`（補助の引数）・`:1292・1297・1303・1322・1411・1475・1901`（タブの `toMatchObject`）、`useAgentWorkspace.test.ts:2442`（タブのスプレッド）、`renderer/src/lib/__tests__/agentResumeAvailability.test.ts:204`（`AgentLastSessionLookup`）、`agentSessionTabState.test.ts:72・171・172・175`（タブの欄）、`useAgentResume.test.ts:58・75・76`（補助の引数名。69 行の短縮記法は `claudeSessionId: cliSessionId` になり (a) として残る）                                                                                                                                                                                                            | 5        |

- 1 つのファイルに (a) と (b)・(c) が混ざるもの: `App.agentSessionResume.test.tsx`（(a) 3・(b) 6）、`agentTabSessionInfo.test.ts`（(a) は 21・33 行。13・19・30・42 行はタブの欄で、型が付くので (c)）、`useAgentWorkspace.test.ts`（(a) 9・(b) 10・(c) 11）、`useAgentResume.test.ts`（(a) 1・(b) 3・(c) 13）、`agentResumeAvailability.test.ts`（(a) 3・(c) 13）。行の単位で分ける
- main のテストで (a) を持つのは `historyUtils.test.ts`・`historyHandlers.test.ts` だけ。ほかの main のテストの `claudeSessionId` は、型の付く分も含めてすべてタスク 3 の対象（IPC の型・`AgentSessionInfo`・選んだ ID の戻り値の欄）
- 実装のファイル（テストでないファイル）に、型の付かないリテラルの `claudeSessionId` は無い（文字列で書いた `hasOnlyKeys` の配列と例外の文言だけ。(b) の節）

### 層ごとの分類

#### (a) ディスクに保存される欄

| 保存先                                                                    | 中身                                                                                                      | 会話の ID の欄名            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------- |
| 実行履歴（`userData/history.json`。`historyStore.ts`）                    | `HistoryEntry[]`。`agent` は `AgentHistoryInfo`（`claudeSessionId`・`cliKind`・`tabLabel`・`folderPath`） | **`agent.claudeSessionId`** |
| 起動の記録（`agent-sessions.json`・`agent-sessions-copilot.json`）        | `{ version: 1, folders: [{ key, ids }] }`（`agentSessionRecordStore.ts`）。ID は `ids` の配列の要素       | 無い（欄名を持たない）      |
| 設定のファイル（`settingsFileStore.ts`）                                  | 使う CLI の種類など                                                                                       | 無い                        |
| claude の hooks の設定のファイル・copilot の hooks のプラグイン           | `agentHookSettings.ts`・`agentCopilotHookPlugin.ts` が書く。トークンと受け口の URL                        | 無い                        |
| その他（プロンプトの書き出し `promptTransferService.ts`・`localStorage`） | 履歴を含まない。renderer の `localStorage` はファイル編集の状態だけで、タブ・会話の ID を保存しない       | 無い                        |

保存の欄名に `claudeSessionId` が出るのは、**実行履歴の `agent.claudeSessionId` だけ**。読み込み（`isValidHistoryEntry` → `isAgentHistoryInfo` の `a.claudeSessionId`）と保存の正規化（`sanitizeHistoryEntry` の `claudeSessionId: agent.claudeSessionId`）の 2 か所が、この欄名を直接扱う。

`AgentHistoryInfo` は保存の形であると同時に、`history:load`・`history:save` の IPC の型であり、renderer の中でも送り先の控え（`describeSession`・`onSent`・`AgentSentHandler`・`describeAgentTabSession` の戻り値）として使われている。renderer が作った値が、そのまま IPC を通り、main の正規化を経てディスクに書かれる。

#### (b) IPC の型と欄

| 型・欄                                                             | チャンネル                                          | 向き               |
| ------------------------------------------------------------------ | --------------------------------------------------- | ------------------ |
| `AgentLaunchRequest`（resume）の `claudeSessionId`                 | `agentTerminal:start`（`AgentStartRequest.launch`） | renderer → main    |
| `AgentStartResult`（started・already-running）の `claudeSessionId` | `agentTerminal:start` の戻り値                      | main → renderer    |
| `AgentSessionSnapshotEntry.claudeSessionId`                        | `agentTerminal:getState` の戻り値                   | main → renderer    |
| `AgentLastSession.claudeSessionId`                                 | `agentTerminal:getLastSession` の戻り値             | main → renderer    |
| `AgentHistoryInfo.claudeSessionId`                                 | `history:load`・`history:save`                      | 両方（(a) と同じ） |

改名できるかを確かめた結果:

- 上の 4 つ（`AgentHistoryInfo` を除く）は、どれもディスクに書かれない。起動の記録は ID を `ids` の配列の要素として持ち、欄名を持たない。`AgentLastSession` は記録の先頭（`last()` の文字列）から main がその場で組み立てる
- preload（`src/preload/api.ts`）は `ipcRenderer.invoke` でそのまま渡すだけで、欄を読まない。`src/preload` に `claudeSessionId` は 0 件
- 外部のプロセスとのやり取り（claude・copilot の hooks の http の受け口 `agentHookReceiver.ts`）は、pty の `sessionId` と CLI が送る本文の `session_id` を使い、`claudeSessionId` を使わない。CLI へは `--session-id <ID>`・`--resume <ID>`・`--resume=<ID>` の値として渡すだけで、欄名は CLI に出ない
- main と renderer は同じビルドの同じ版から読み込まれ（electron-vite の 1 つの成果物）、異なる版の main と renderer が IPC でやり取りすることは無い
- 結論: 4 つは改名できる。ただし `agentTerminalPayloadParser.ts` の `hasOnlyKeys(launch, ['kind', 'claudeSessionId', 'cliKind'])` と例外の文言 `'claudeSessionId は小文字の UUID v4 である必要があります'` は**文字列**で欄名を書いているので、型検査では見つからない。grep で直す（「気をつける知見」L-310）

#### (c) main・renderer の中だけの変数・関数・型・ファイル名

- shared: `CLAUDE_SESSION_ID_PATTERN`・`isClaudeSessionId`（`shared/types/agentTerminal.ts` と `shared/types.ts` の再 export）。形式の検証で、main の 4 ファイル（`agentCliLaunchSpecs.ts`・`agentSessionRecordStore.ts`・`historyUtils.ts`・`agentTerminalPayloadParser.ts`）が使う
- main:
  - `claudeSessionIdSelection.ts`（`selectClaudeSessionId`・`ClaudeSessionIdSelection`）とそのテスト
  - `claudeSessionReservations.ts`（`createClaudeSessionReservations`・`ClaudeSessionReservations`・引数の `claudeSessionId`）とそのテスト
  - `agentSessionStarter.ts`: 注入の option `createClaudeSessionId`、`AgentSessionInfo.claudeSessionId`（86 行）、`CreatedAgentSession.claudeSessionId`（128 行）、ローカル変数（307 行）。`AgentSessionInfo` は `{ kind: 'already-running', sessionId, ...info }` で `AgentStartResult` にスプレッドされ、`sessionInfoOf` で `agentTerminalHandlers.ts`・`agentSessionSnapshot.ts` にも渡る
  - `agentCliLaunchSpecs.ts`: `buildArgs` の引数名（28・44・68 行）
  - `agentSessionRecordStore.ts`: `has`・`record`・`prependRecord` の引数名
  - `ipcHandlers.ts`: `createClaudeSessionReservations()`・`createClaudeSessionId: randomUUID`
  - `agentHookSessions.ts` は既に `cliSessionId` という名前で同じ ID を受け取っている（`activate(prepared, sessionId, cliSessionId)`）。テストの定数 `CLAUDE_SESSION_ID`（`agentHookSessions.test.ts`）だけが旧い呼び名
- renderer:
  - `agentSessionTabState.ts`: `AgentTabSessionFields.claudeSessionId`・`findActiveAgentTabByClaudeSessionId`
  - `useAgentSessions.ts`: `AgentSessionTabView.claudeSessionId`・`resumeInNewTab(claudeSessionId, cliKind)`・`claudeSessionIdBySlotRef`・`setTabClaudeSessionId`・`isClaudeSessionIdActiveElsewhere`
  - `agentResumeAvailability.ts`: `AgentLastSessionLookup` の found・`AgentResumeTab.claudeSessionId`
  - `agentTabSessionInfo.ts`: `AgentTabSessionSource.claudeSessionId`
  - `useAgentLastSession.ts`・`useAgentResume.ts`: 上の型の欄の読み書き
  - `AgentResumeTab`・`AgentTabSessionSource` は `AgentSessionTabView` の一部の欄を写した構造的な型で、`AgentSessionTabView` をそのまま渡している。片方だけ改名すると型検査で落ちるので、renderer の型の欄は 1 つのタスクでまとめて改名する
  - テストの補助 `src/renderer/src/__tests__/makeAgentSessionsState.ts`

#### (d) doc コメント・テストの題・ログ・画面に出る文言

- doc コメント・コメント: 「claude の会話の ID」19 か所（`agentSessionStarter.ts`・`agentSessionRegistry.ts`・`agentSessionSnapshot.ts`・`agentTerminalHandlers.ts`・`useAgentSessions.ts`・`useAgentPromptSender.ts`・`agentSessionTabState.ts` など）、識別子を書いたコメント（`agentCliLaunchSpecs.ts:22`・`agentTerminalPayloadParser.ts:18`・`agentSessionStarter.ts:36-37` のファイル名など）
- テストの題: `agentSessionStarter.test.ts:381`（`claude のセッション ID・記録・予約`）・`:434`、`agentSessionSnapshot.test.ts:16`、`useAgentWorkspace.test.ts:2423`・`:2450`、`useAgentSessions.test.ts:1267`・`:1284`・`:1330`・`:1469`
- ログ: `agentSessionStarter.ts:440` の `console.error('[agentSessionStarter] 動いているセッションの種類と claude のセッション ID が見つかりません:', …)`
- 例外の文言（画面に出うる）:
  - `agentSessionStarter.ts:421` `起動したセッションの claude のセッション ID がありません`
  - `agentSessionStarter.ts:430` `再開に対応しない CLI のセッションに claude のセッション ID があります`
  - `agentSessionStarter.ts:443` `動いているセッションの種類と claude のセッション ID が見つかりません`
  - `agentTerminalPayloadParser.ts:72` `claudeSessionId は小文字の UUID v4 である必要があります`
  - どれも `agentTerminal:start` の invoke の reject になり、renderer の `useAgentSessions` の catch で `エージェントを起動できませんでした: <例外の文言>`（`AGENT_START_ERROR_PREFIX`）としてタブのエラーに出る。ただし 3 つは starter の内部の不変条件が破れたとき（種類と ID の取り違え）、1 つは renderer が形の不正な ID を送ったときだけで、通常の操作では出ない
  - どのテストもこの 4 つの文言を確かめていない（`grep` で 0 件）。実機テスト仕様書にも「セッション ID」「会話の ID」を書いた項目は無い
- 画面の通常の文言: 実行履歴の詳細の `セッション: <ID>`（`HistoryDetail.tsx:43`）、`前回の続きから（… ${commandName} のセッションを再開）`、`${entryCommandName} のセッションのため、…` は、「claude の会話の ID」を含まない（種類の名前は変数）。改名で変わらない

### 今の `sessionId` が指すもの

`sessionId` は **pty のセッションの ID**（アプリの中のターミナルの 1 つの起動）。main の starter が `createSessionId()` で起動のたびに振り（`agentSessionStarter.ts:319`）、registry の枠・`agentTerminal:write`・`resize`・`stop`・`interrupt`・`data`・`exit` の宛先に使う。会話の ID（CLI が `--session-id`・`--resume` で受け取り、再開に使う UUID）とは別のもので、同じ会話を再開すると pty の `sessionId` は新しくなり、会話の ID は同じになる。

このコードベースでは **`AgentSession` は pty のセッションを指す**（`AgentSessionData.sessionId`・`AgentSessionExit.sessionId`・`agentSessionRegistry.ts`・`startAgentSession`）。さらに `parseAgentSessionId`（`agentTerminalPayloadParser.ts:102`）が既にあり、**pty の `sessionId` を検証する関数**として `agentTerminal:stop` などで使われている。

## 決めたこと（利用者の確認済み）

1. **新しい名前は `cliSessionId`**（下の比較）。例に挙げた `agentSessionId` は採らない。**利用者の確認済み（2026-10-28）**
2. **保存の欄名 `agent.claudeSessionId` は、型の上でも欄名でもそのまま保つ**（案 B。下の比較）。`AgentHistoryInfo.claudeSessionId` の 1 つの欄と、それを読み書きする箇所だけに旧い名前が残る。**利用者の確認済み（2026-10-28）**

## 決めたこと（推奨案）

3. **IPC の 4 つの型の欄は改名する**（`AgentLaunchRequest`・`AgentStartResult`・`AgentSessionSnapshotEntry`・`AgentLastSession`）
4. **ファイル名は `git mv` で変える**（L-624）。`claudeSessionIdSelection.ts` → `cliSessionIdSelection.ts`、`claudeSessionReservations.ts` → `cliSessionReservations.ts`、それぞれのテストも
5. **例外・ログの文言の「claude のセッション ID」は「会話の ID」に直す**。copilot でも出る文言なので、今の文言は事実と合わない。通常の操作では出ないので、claude の利用者に見える文言は実質変わらない（「画面に出る文言」）。**推奨案で確定（2026-10-28）**
6. **保存の欄名を文字列で固定するテストを 1 件足す**（「テストの方針」）。今のテストはすべて `HistoryEntry` の型で書いた値を使うので、型の欄を改名すると一緒に変わり、ディスクのキーが変わっても気づけない
7. **過去の設計書・実装プラン（`docs/superpowers/specs`・`plans`）は直さない**。書いた時点の記録として残す。段階 3a の設計書の「コード上の名前 `claudeSessionId` は変えない」は、この設計書で改名したことを ROADMAP ではなく、この設計書の「前提」に書いて区別する（L-203。過去の状態として読める）
8. **ROADMAP は更新しない**: ROADMAP の項目ではない（コード上の名前の変更）。ROADMAP には旧い名前は出てこない（`grep` で 0 件）

### 新しい名前の比較

| 案                     | よい点                                                                                                                                                                                          | 悪い点                                                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cliSessionId`（採用） | `agentHookSessions.ts` が既に同じ ID を `cliSessionId` と呼んでいて、名前が 1 つにそろう。隣の欄 `cliKind` と対になり「その CLI のセッションの ID」と読める。CLI の引数 `--session-id` とも合う | 「CLI」は従来の方式（非対話の `claude -p`）を指すこともある。ただし従来の方式は会話の ID を持たないので取り違えは起きない                                                                                                                                                 |
| `agentSessionId`       | ユーザーの例。`agentTerminal` などの接頭辞とそろう                                                                                                                                              | **`AgentSession` はこのコードベースでは pty のセッション**（`AgentSessionData.sessionId`・`agentSessionRegistry`・`startAgentSession`）。`parseAgentSessionId` が既に **pty の `sessionId` の検証**として存在し、`isAgentSessionId`（会話の ID の検証）と並ぶと取り違える |
| `conversationId`       | 日本語のコメント（「会話の ID」）と合う                                                                                                                                                         | CLI 側（`--session-id`・hooks の本文の `session_id`）の呼び名と合わない。コードに前例が無い                                                                                                                                                                               |

### 保存の欄の扱いの比較

| 観点                        | 案 A: 型は新しい名前、読み込みと保存の境界で旧い欄名に変換                                                                                                                                                                                                                                                          | 案 B: 型も欄名もそのまま（採用）                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 旧い名前の残り              | 0 件（変換の 2 か所の文字列だけ）                                                                                                                                                                                                                                                                                   | `AgentHistoryInfo.claudeSessionId` を指すものと、ディスクの形を直接扱うものの計 53 か所（「grep の確かめ」）                                                     |
| 変える処理                  | 今は `isValidHistoryEntry`・`sanitizeHistoryEntry` を読み込み（ディスク → メモリ）と保存（IPC → ディスク）の両方で共有している。案 A ではディスクの形（旧い欄名）と IPC の形（新しい欄名）が分かれ、検証と正規化を 2 組に分ける必要がある（`jsonCollectionStore` の `isValid`・`sanitize` は 1 組しか受け取らない） | 変えない                                                                                                                                                         |
| データが消える危険          | 変換の片方（読み込みか保存か）を漏らすと、保存のたびに `agent` が不正になりエントリごと捨てられる・欄が欠ける（L-015 の型）。「挙動を変えない改名」の中に保存の処理の変更が入る                                                                                                                                     | 保存の処理を変えないので無い                                                                                                                                     |
| 古い版のアプリとの読み書き  | 変換が正しければ保てる                                                                                                                                                                                                                                                                                              | 形が変わらないので、そのまま保てる                                                                                                                               |
| renderer の中の送り先の控え | `AgentHistoryInfo` を IPC の形として新しい名前にできる                                                                                                                                                                                                                                                              | 送り先の控え（`describeSession`・`onSent`）でも `claudeSessionId` を読み書きする（`agentTabSessionInfo.ts` で `claudeSessionId: tab.cliSessionId` と詰め替える） |

案 B を推奨する。`AgentHistoryInfo` は保存の形そのもので、renderer が作った値がそのまま IPC を通ってディスクに書かれる。旧い名前を 1 つの型の 1 つの欄に閉じ込め、doc コメントで「保存の欄名。古い版との互換のため変えない」と明示すれば、取り違えの危険は小さい。案 A の利点（旧い名前の 0 件）は、保存の処理を 2 組に分ける変更と L-015 の危険に見合わない。

### 古い版のアプリとの読み書き

案 B では、ディスクに書く形は今と同じ（`agent` は `claudeSessionId`・`cliKind`・`tabLabel`・`folderPath`）。

| 場面                                     | 結果                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 新しい版が古い版の `history.json` を読む | 欄名が同じなので、今と同じく読める                                                                      |
| 古い版が新しい版の `history.json` を読む | 欄名が同じなので、古い `isValidHistoryEntry` もエントリを捨てない                                       |
| 古い版が書き戻す（保存）                 | 古い `sanitizeHistoryEntry` が今と同じ 4 つの欄を作り直す。新しい版が足した欄は無いので消えるものが無い |
| 起動の記録（`agent-sessions*.json`）     | 欄名を持たないので影響しない                                                                            |

テスト（「テストの方針」の 1）で、ディスクの JSON の文字列に `"claudeSessionId"` のキーがあることを、型を通さずに固定する。

### 新しい名前の表（旧 → 新）

| 旧                                                          | 新                                                                      | 種類                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------ |
| `claudeSessionId`（`AgentHistoryInfo` 以外）                | `cliSessionId`                                                          | 欄・引数・変数           |
| `AgentHistoryInfo.claudeSessionId`                          | **変えない**                                                            | 保存の欄（(a)）          |
| `CLAUDE_SESSION_ID_PATTERN`                                 | `CLI_SESSION_ID_PATTERN`                                                | 定数（shared）           |
| `isClaudeSessionId`                                         | `isCliSessionId`                                                        | 関数（shared）           |
| `createClaudeSessionId`                                     | `createCliSessionId`                                                    | 注入の option（main）    |
| `selectClaudeSessionId`                                     | `selectCliSessionId`                                                    | 関数（main）             |
| `ClaudeSessionIdSelection`                                  | `CliSessionIdSelection`                                                 | 型（main）               |
| `createClaudeSessionReservations`                           | `createCliSessionReservations`                                          | 関数（main）             |
| `ClaudeSessionReservations`                                 | `CliSessionReservations`                                                | 型（main）               |
| `setTabClaudeSessionId`                                     | `setTabCliSessionId`                                                    | 関数（renderer）         |
| `findActiveAgentTabByClaudeSessionId`                       | `findActiveAgentTabByCliSessionId`                                      | 関数（renderer）         |
| `isClaudeSessionIdActiveElsewhere`                          | `isCliSessionIdActiveElsewhere`                                         | 関数（renderer）         |
| `claudeSessionIdBySlotRef`                                  | `cliSessionIdBySlotRef`                                                 | ref（renderer）          |
| `CLAUDE_SESSION_ID`（`agentHookSessions.test.ts`）          | `CLI_SESSION_ID`                                                        | テストの定数             |
| `src/main/claudeSessionIdSelection.ts`                      | `src/main/cliSessionIdSelection.ts`                                     | ファイル（`git mv`）     |
| `src/main/claudeSessionReservations.ts`                     | `src/main/cliSessionReservations.ts`                                    | ファイル（`git mv`）     |
| `src/main/__tests__/claudeSessionIdSelection.test.ts`       | `src/main/__tests__/cliSessionIdSelection.test.ts`                      | ファイル（`git mv`）     |
| `src/main/__tests__/claudeSessionReservations.test.ts`      | `src/main/__tests__/cliSessionReservations.test.ts`                     | ファイル（`git mv`）     |
| 「claude の会話の ID」（コメント・題）                      | 「会話の ID」（種類を言う必要があれば「エージェント CLI の会話の ID」） | 文言                     |
| 「claude のセッション ID」（例外・ログ・題）                | 「会話の ID」                                                           | 文言                     |
| `'claudeSessionId は小文字の UUID v4 である必要があります'` | `'cliSessionId は小文字の UUID v4 である必要があります'`                | 例外の文言（IPC の欄名） |

`sessionId`（pty のセッションの ID）・`parseAgentSessionId`・`sessionIdBySlotRef`（pty の `sessionId` の ref）は変えない。

### 画面に出る文言

- 通常の操作で画面に出る文言は変わらない（claude でも copilot でも）
- 変わるのは、上の 4 つの例外の文言だけ。starter の 3 つは内部の不変条件が破れたときだけ出る（例: `エージェントを起動できませんでした: Error invoking remote method 'agentTerminal:start': Error: 起動したセッションの claude のセッション ID がありません` → `… 起動したセッションの会話の ID がありません`）。今は copilot のときも「claude のセッション ID」と出ていて事実と合わないので、直すのが正しい。claude で見える文言としても、通常は出ない経路の文言が変わるだけ
- L-017: どの文言にも入力の値（ID・パス）を入れない。今も入れていないので、改名でも入れない（値は `console.error` の第 2 引数の pty の `sessionId` だけで、画面には出ない）

## 層ごとの方針

- **(a) 保存**: `AgentHistoryInfo.claudeSessionId` は変えない。doc コメントを「保存の欄名。古い版のアプリとの互換のため `claudeSessionId` のまま変えない（中身は CLI の種類を問わない会話の ID。コード上の名前は `cliSessionId`）」に直す。`historyUtils.ts` の `isAgentHistoryInfo` の `a.claudeSessionId`（`Record<string, unknown>` の読み）と `sanitizeHistoryEntry` の `claudeSessionId: agent.claudeSessionId` はそのまま。検証の関数だけ `isCliSessionId(a.claudeSessionId)` になる
- **(b) IPC**: 4 つの型の欄を `cliSessionId` にする。文字列で欄名を書いた `agentTerminalPayloadParser.ts` の `hasOnlyKeys` の配列と例外の文言も同じタスクで直す（型検査で見つからない）。`as unknown as AgentLaunchRequest` で型を外したテストの値（`agentCliLaunchSpecs.test.ts:13`・`claudeSessionIdSelection.test.ts:52`）も grep で直す
- **(c) main・renderer の中**: 表のとおり改名する。`AgentSessionInfo`・`CreatedAgentSession` の欄は `AgentStartResult` にスプレッドされるので、(b) と同じタスクで改名する。renderer の構造的な型（`AgentSessionTabView`・`AgentTabSessionFields`・`AgentResumeTab`・`AgentTabSessionSource`・`AgentLastSessionLookup`）は 1 つのタスクでまとめて改名する。テストの中のローカル変数・補助の引数も改名する（旧い名前の grep の数を減らし、残りを (a) だけにするため）
- **(d) 文言**: コメント・テストの題・ログ・例外の文言の「claude の会話の ID」「claude のセッション ID」を直す。識別子・ファイル名を書いたコメントも新しい名前にする（L-310・L-203）。CLI の種類が claude と決まっている文脈の「claude のセッション」は直さない

## 気をつける知見

- **L-310**（切り出し・改名の後の残り）: 改名の後に、旧い名前を指すコメント・テストの題・describe・ファイル冒頭の責務の説明・import のパス・文字列で書いた欄名が残りやすい。各タスクの終わりと最後のタスクで、旧い名前の全ファミリーを grep し、残りが「grep の確かめ」の期待どおりであることを確かめる。`agentSessionStarter.ts:36-37` のファイル名を書いたコメントも直す
- **L-203**（コメント・文書の古さ）: 型の doc コメント（`AgentStartResult`・`AgentSessionSnapshotEntry`・`AgentLastSession`・`AgentTabSessionFields` など）は中身が既に「エージェント CLI の会話の ID」になっているものと、まだ「claude の会話の ID」のものが混ざっている。改名と同じタスクで直す。`AgentHistoryInfo` には「保存の欄名だから変えない」理由を書く。過去の設計書は直さない（書いた時点の記録）
- **L-459**（保存の互換）: 保存の欄名を変えると、古い版のアプリが新しい版の履歴を読んだとき・書き戻したときに `agent` が不正になり、エントリごと捨てられる。案 B で形を変えず、文字列で欄名を固定するテストを足す
- **L-618**（改名の途中でテストを流す危険）: Vitest（esbuild）は型を外すだけで型検査をしない。改名の途中でテストを流すと、テストが新しい欄を読み実装がまだ旧い欄を返す（またはその逆）ことで、普段は起こらない undefined が後始末の経路に出る。テストの再帰削除は `removeTempPath(Sync)` のガードを通すようにしてあるが（2026-10-28 の設計書）、ガードの外の副作用（ファイルへの書き込み・プロセスの起動）もあるので、**改名の途中ではテストを流さない**（「安全の手順」）
- **L-609**（タスクの境界）: 型の欄の改名と、それを使う実装・テストの直しを別のタスクに分けると、途中のタスクの終わりで型検査が落ちる。IPC の型の欄は main・renderer・テストを 1 つのタスクで直す。スプレッドで型をまたぐ `AgentSessionInfo` も同じタスクに入れる
- **L-624**（`git mv` と `git add -u`）: ファイルを `mv` で移して `git add -u` だけでステージすると、移動元の削除だけが入り、移動先が漏れる。`git mv` を使い、各タスクの終わりに `git status --short` で `R`（renamed）になっていて、`??`（未追跡）に移動先が無いことを確かめる。コミットするとき（ユーザーの指示があってから）は、未追跡のこの設計書と実装プランを `git add <パス>` で明示的に足す（`git add -u` では入らない）
- **L-017**（文言に入力を入れない）: 直す例外の文言に ID・パスを入れない
- **L-015**（保存のたびに消える）: 案 A を採らない理由。`sanitizeHistoryEntry` の欄の作り直しを変えない
- **L-065**（報告を信じない）: サブエージェントの「改名した」「残りは 0」という報告を信じず、レビューで grep を自分で流し直す

## 安全の手順

各タスクで、次の順に進める。

1. **改名の途中ではテストを流さない**。エディタの一括置換・`sed` の途中、ファイルの一部だけを直した状態で `npx vitest` を流さない（L-618）
2. 改名を終えたら、**テストより先に** `npm run typecheck` を流し、通るまで直す（`tsconfig.node.json`・`tsconfig.web.json` はテストのファイルも含むので、型の付いた値の取り違えはここで見つかる）。**型の付かないテストの値**（`vi.fn().mockResolvedValue(…)`・`toEqual`・`toMatchObject`・`toHaveBeenCalledWith`・`expect.objectContaining` の中、注釈の無い `const`、`as unknown as` の値）は型検査を通ってしまうので、ここでは見つからない。手順 3 の grep で見つける
3. 型検査が通ったら、そのタスクの対象の旧い名前を grep し、期待どおり（そのタスクの範囲で 0 件。(a) の残りは除く）であることを確かめる。文字列の欄名（`hasOnlyKeys` の配列）と、型の付かないテストの値（「テストの中の型の付かない値の分け方」の表）は型検査で見つからないので、この grep で見つける。残った行は 1 行ずつ読み、表の (a) の行（履歴の欄）だけが残っていることを確かめる。直し漏れのまま進むと、テストで偽物の `cliSessionId` が undefined になり、ID を確かめていないテストはそのまま通ってしまう（L-618 の形）
4. **テストを流す前に、作業をリポジトリの外へ退避する**。リポジトリのフォルダが消えても作業を戻せるようにする（L-618 の事故では `.git` ごと消えた）

   ```sh
   BACKUP="$HOME/prompt-ide-rename-backup/$(date +%Y%m%d-%H%M%S)"
   mkdir -p "$BACKUP"
   git -C <repo-root> diff HEAD --binary > "$BACKUP/work.patch"   # git mv の移動（ステージ済み）を含む
   git -C <repo-root> status --short > "$BACKUP/status.txt"
   git -C <repo-root> rev-parse HEAD > "$BACKUP/head.txt"
   # 未追跡のファイル（この設計書・実装プランなど。git diff HEAD に入らない）を、存在するものだけ tar にする
   (cd <repo-root> && git ls-files --others --exclude-standard -z \
     | xargs -0 -I{} sh -c 'test -e "{}" && printf "%s\0" "{}"' \
     | tar --null -T - -cf "$BACKUP/untracked.tar")
   git -C <repo-root> ls-files --others --exclude-standard | wc -l   # 未追跡の件数
   tar -tf "$BACKUP/untracked.tar" | wc -l                                              # tar の件数（上と一致すること）
   ```

   - 毎回、未追跡のファイルを tar にし、未追跡の件数と tar の件数が一致することを確かめる（L-618）。この作業では少なくとも、この設計書と実装プランが未追跡のまま残っている。`git mv` の移動先はステージ済みなので patch に入る
   - 戻すときは、`head.txt` のコミット（push 済みの `ac0f7f5` の子孫。リポジトリごと消えても clone から戻せる）を checkout して `work.patch` を当て、`untracked.tar` を展開する
   - 退避先はリポジトリの外（`$HOME` の下）にする。リポジトリの中や `/tmp` の下に置かない（`/tmp` は `os.tmpdir()` の下で、テストのガードが消せる範囲にある）

5. 退避の後に、そのタスクで直したファイルのテストを流す（`npx vitest run <ファイル…>`）。最後のタスクだけ `npm test` を流す
6. テストが落ちたら、まず型検査と grep に戻る（テストの期待を直して通さない。改名は挙動を変えないので、落ちるのは直し漏れ）

## テストの方針

### 既存のテストで確かめる

改名は挙動を変えないので、新しい振る舞いのテストは書かない。各タスクで、型検査と直したファイルのテストが通ることを確かめ、最後に `npm test` を流す。テストの期待の値（文言・欄の値）を変えるのは、(d) で直した例外の文言とテストの題だけ（文言を確かめているテストは今 0 件なので、期待の値は実質変わらない）。

### 保存の欄名を固定するテスト（足す。タスク 1）

`src/main/__tests__/historyStore.test.ts` に 1 件足す。`HistoryEntry` の型を通さず、**文字列**でディスクの形を書く（型の欄の改名に引きずられないため）。

- 古い版が書いた形の JSON の文字列（`"agent":{"claudeSessionId":"11111111-1111-4111-8111-111111111111","cliKind":"claude","tabLabel":"claude 1","folderPath":"/w"}` を含む）を `readFile` の偽物から返し、`loadHistory()` の結果のエントリに `agent` が残る（捨てられない）
- 読んだエントリを `saveHistory()` に渡すと、`writeFile` に渡った文字列が `"claudeSessionId":"11111111-1111-4111-8111-111111111111"` を含み、`"cliSessionId"` を含まない
- このテストは今のコードで通る（改名の前に足し、改名の後も通ることで互換を確かめる）。効いていることは、`historyUtils.ts` の `sanitizeHistoryEntry` の出力のキーを一時的に別の名前に変えると落ちることで確かめる（確かめたら戻す。変えた状態は型検査が落ちるので、型検査を通さずにこの 1 ファイルだけを流す。流す前に「安全の手順」4 の退避をする）

古い版の検証（`isValidHistoryEntry`）が新しい版の履歴を捨てないことは、欄名を変えないので上のテストで足りる（古い版の関数はリポジトリに無いので、ディスクの形を固定することで代える）。

### grep の確かめ（最後のタスク）

```sh
cd <repo-root>
grep -rnE 'ClaudeSession|CLAUDE_SESSION_ID|claudeSessionIdSelection|claudeSessionReservations|claude の会話の ID|claude のセッション ID' src   # 0 行
grep -rn 'claudeSessionId' src | wc -l   # 期待の行数（下）
grep -rln 'claudeSessionId' src          # 期待のファイル（下）
```

- `claudeSessionId` の残りは、次の合計で **計 53 か所・51 行・24 ファイル**（`ac0f7f5` の時点の数。grep と TypeScript の解析で数え直した）。これに、タスク 1 で足すテストの行と、`AgentHistoryInfo` の doc コメントで欄名を書く行を足したものが最後の期待になる。実装プランで、タスク 1 の後に数え直して期待の行数を固定する（分け方はこの設計書の表で決まっているので、数え直しは行数を合わせるためだけに行う）
  - `AgentHistoryInfo.claudeSessionId` を型で指すもの: 31 か所（`historyUtils.ts:90`・`historyUtils.test.ts:234` は 1 行に 2 か所）
  - ディスクの形を直接扱うもの: `historyUtils.ts:25` の `a.claudeSessionId`、`historyUtils.test.ts` の題 2 か所（161・165 行）
  - 型の付かない履歴の値（「テストの中の型の付かない値の分け方」の (a)）: 19 か所
- 残りのファイルの期待（24 ファイル + タスク 1 の `historyStore.test.ts`）:
  - shared・main: `src/shared/types/history.ts`、`src/main/historyUtils.ts`、`src/main/__tests__/historyUtils.test.ts`、`src/main/__tests__/handlers/historyHandlers.test.ts`
  - renderer の実装: `src/renderer/src/components/history/HistoryDetail.tsx`、`src/renderer/src/hooks/useAgentResume.ts`、`src/renderer/src/lib/agentResumeAvailability.ts`、`src/renderer/src/lib/agentTabSessionInfo.ts`
  - renderer のテスト（`components`）: `src/renderer/src/components/__tests__/Sidebar.test.tsx`・`App.agentSessionResume.test.tsx`、`src/renderer/src/components/history/__tests__/HistoryDetail.styles.test.tsx`・`HistoryDetail.test.tsx`・`HistoryItem.test.tsx`・`HistoryPanel.test.tsx`
  - renderer のテスト（`hooks`）: `src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`・`useAgentResume.test.ts`・`useAgentSendConfirm.test.ts`・`useAgentWorkspace.test.ts`・`usePromptRunner.test.ts`
  - renderer のテスト（`lib`）: `src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts`・`agentSendCallbacks.test.ts`・`agentTabSessionInfo.test.ts`・`historyEntryFactory.test.ts`・`historyFormatters.test.ts`
- (a) と (b)・(c) が混ざるファイル（`App.agentSessionResume.test.tsx`・`agentTabSessionInfo.test.ts`・`useAgentWorkspace.test.ts`・`useAgentResume.test.ts`・`agentResumeAvailability.test.ts`）は、ファイルの単位ではなく行の単位で確かめる（ファイルごとの最後の数: 3・2・9・1・3 か所）
- 残った各行が `AgentHistoryInfo`（`HistoryEntry.agent`・`sentTo`・`describeSession()`・`recorded`）の欄か、ディスクの形の値であることを、レビューで 1 行ずつ確かめる（L-065）
- 「claude のセッション」の残りは、CLI の種類が claude と決まっている文脈だけ（`AgentTerminalPanel.test.tsx:405`・`:522`、`agentSessionMessages.test.ts:191`・`:200`、`agentTerminalHandlers.test.ts:951`）

## 実装の分割

各タスクの終わりで `npm run typecheck`・直したファイルの `npx vitest run <ファイル…>`・`npx eslint <ファイル…>`・`npx prettier --check <ファイル…>` が通る順にする（L-609）。各タスクで「安全の手順」に従う（改名の途中でテストを流さない・型検査 → grep → 退避 → テストの順）。コミットはユーザーの指示があるまでしない。

1. **保存の欄名を固定するテストと doc コメント**
   - `historyStore.test.ts` に「保存の欄名を固定するテスト」を足す（今のコードで通る。効いていることを一時の変更で確かめて戻す）
   - `AgentHistoryInfo.claudeSessionId` の doc コメントを、保存の欄名で変えない理由と、コード上の名前が `cliSessionId` であることに直す
   - 終わり: 型検査・`historyStore.test.ts`・`historyUtils.test.ts` が通る。`claudeSessionId` の行数を数え直し、最後の期待の行数を決める
2. **shared の形式の検証の改名**
   - `CLAUDE_SESSION_ID_PATTERN` → `CLI_SESSION_ID_PATTERN`、`isClaudeSessionId` → `isCliSessionId`（`shared/types/agentTerminal.ts`・`shared/types.ts` の再 export・main の 4 ファイル・`shared/__tests__/agentTerminal.test.ts`・`main/__tests__/ipcHandlers.test.ts`（187 行の import と 482 行の利用）
   - 再 export の旧い名前は残さない（使う側を全部直す）
   - 終わり: 型検査・直したファイルのテスト。`grep -rnw 'isClaudeSessionId\|CLAUDE_SESSION_ID_PATTERN' src` が 0 行
3. **IPC の型の欄の改名（main・renderer・テストをまとめて）**
   - `AgentLaunchRequest`・`AgentStartResult`・`AgentSessionSnapshotEntry`・`AgentLastSession` の `claudeSessionId` → `cliSessionId` と doc コメント
   - main: `agentTerminalPayloadParser.ts`（`hasOnlyKeys` の配列・例外の文言・コメントを含む）、`agentSessionStarter.ts` の `AgentSessionInfo`・`CreatedAgentSession` の欄（スプレッドで結果に入るため）、`agentSessionSnapshot.ts`、`agentTerminalHandlers.ts`、`claudeSessionIdSelection.ts` の戻り値の欄（`{ kind: 'selected', claudeSessionId }`）
   - renderer: 結果・前回・状態の取得の欄を読む箇所（`useAgentSessions.ts`・`useAgentLastSession.ts`・`useAgentResume.ts`）。renderer の中の型の欄（`AgentSessionTabView` など）はタスク 5 で直すので、ここでは IPC の欄の読みだけを直す（`setTabClaudeSessionId(slotId, result.cliSessionId)` など）
   - `agentSessionStarter.ts` の「claude の会話の ID」のコメント 6 か所（83・92・124・162・210・385 行。`AgentSessionInfo`・`CreatedAgentSession`・`sessionInfoOf`・`finishStart` の説明）は、このタスクで直す（タスク 4 では直さない）
   - テスト: IPC の値を書いたすべてのテスト。型の付く値に加え、「テストの中の型の付かない値の分け方」の (b) の 84 行（main 72・renderer 12。`mockResolvedValue`・`toEqual`・`toMatchObject`・`objectContaining`・`as unknown as` の中）を grep で直す
   - 終わり（型検査は型の付かない値の直し漏れを見つけないので、次の grep も条件に入れる）:
     - 型検査・直したファイルのテストが通る
     - 次の grep は `-w`（語の単位）で流す（タスク 4 の前は `claudeSessionIdSelection` の import のパスなどが残り、`-w` が無いと引っかかるため）
     - `grep -rlw claudeSessionId src/main/__tests__` が `historyUtils.test.ts`・`historyHandlers.test.ts` の 2 ファイルだけ（main のテストの (a) はこの 2 つだけ。ほかの main のテストはすべてこのタスクの対象）
     - `grep -cw claudeSessionId src/shared/__tests__/agentTerminal.test.ts src/renderer/src/components/__tests__/App.agentReferences.test.tsx` がどちらも 0
     - `grep -nw claudeSessionId src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx` が (a) の 3 行（`loadHistory` の偽物の履歴）だけ
     - IPC の値の形の grep で、残りが 0 行。`grep -rnw -B4 -A1 claudeSessionId src | grep -E "kind: '(resume|started|already-running|selected)'|startAgentSession|getLastAgentSession|getAgentSessions|launch:"` の結果を 1 行ずつ読み、IPC の値（起動の結果・前回・状態の取得・launch）を書いたものが無いことを確かめる（前後の行を含めるのは、複数行に分けた偽物の値を拾うため。(a)・(c) の行が引っかかったら、表と照らして残してよい）
     - `grep -rnw claudeSessionId src` の残りを 1 行ずつ確かめ、表の (a)・(c) の行と、タスク 4・5 の対象（main・renderer の中の名前）だけが残っていること
4. **main の中の改名とファイル名の変更**
   - `git mv` で `claudeSessionIdSelection.ts`・`claudeSessionReservations.ts` とそれぞれのテストを `cli…` へ移し、中の名前（`selectCliSessionId`・`CliSessionIdSelection`・`createCliSessionReservations`・`CliSessionReservations`）と import のパスを直す
   - `agentSessionStarter.ts`（`createCliSessionId` の option・ローカル変数・コメントのファイル名）、`agentCliLaunchSpecs.ts`・`agentSessionRecordStore.ts` の引数名、`ipcHandlers.ts`、`agentHookSessions.test.ts` の `CLAUDE_SESSION_ID`、main のテストのローカル変数・題
   - main の例外・ログの文言（「claude のセッション ID」→「会話の ID」）と、main のコメントの「claude の会話の ID」
   - 終わり: 型検査・直したファイルのテスト。`git status --short` で 4 つのファイルが `R` で、移動先が `??` に無い（L-624）。`src/main` の旧い名前（(a) の残りを除く）が 0 行（`grep -c 'claude の会話の ID' src/main/agentSessionStarter.ts` はタスク 3 で 0 になっている）
5. **renderer の中の改名**
   - `AgentTabSessionFields`・`AgentSessionTabView`・`AgentResumeTab`・`AgentTabSessionSource`・`AgentLastSessionLookup` の欄、`resumeInNewTab` の引数、`setTabCliSessionId`・`findActiveAgentTabByCliSessionId`・`isCliSessionIdActiveElsewhere`・`cliSessionIdBySlotRef`、`agentTabSessionInfo.ts` の詰め替え（`claudeSessionId: tab.cliSessionId`）
   - renderer のコメント・テストの題・テストのローカル変数・`makeAgentSessionsState.ts`
   - テスト: 型の付く値に加え、「テストの中の型の付かない値の分け方」の (c) の 31 行（`useAgentLastSession.test.ts` の `toEqual`、`useAgentSessions.test.ts` の `toMatchObject` など）を grep で直す。(a) の行（`agentTabSessionInfo.test.ts:21・33` など）は直さない
   - 終わり: 型検査・直したファイルのテスト。`grep -cw claudeSessionId src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/lib/__tests__/agentSessionTabState.test.ts` がすべて 0。`src/renderer` の残りが「grep の確かめ」の (a) の行だけ
6. **全体の確かめ**
   - 「grep の確かめ」をすべて流し、期待どおりであることを確かめる
   - 「安全の手順」4 の退避の後に、`npm run typecheck`・`npm test`・変更したファイルへの `npx eslint`・`npx prettier --check`
   - 実機テスト仕様書は追記しない（下の「実機テスト仕様書について」）。ROADMAP も更新しない

タスク 3 は差分が大きい（IPC の 4 つの型を指す 114 か所と、`AgentSessionInfo`・`CreatedAgentSession` の分）。分けると型検査が落ちるので分けない（L-609）。タスク 4 と 5 は互いに依存しないので、順を入れ替えてもよい。

## やらないこと

- 保存の欄名 `agent.claudeSessionId` の変更と、そのための読み込み・保存の変換（案 A）
- 保存の形の版の番号（`version`）の追加・マイグレーション
- pty の `sessionId`・`parseAgentSessionId`・`AgentSession*` の名前の変更
- 過去の設計書・実装プランの中の旧い名前の書き換え
- CLI の種類が claude と決まっている文脈の「claude のセッション」（`前回の続きから` の文言の組み立ての結果・テストの題）の書き換え
- 「claude」を名前に含むほかの識別子（`classifyClaudeScreen`・`buildClaudeArgs` など、claude だけの処理）の変更
- 挙動・文言の変更（例外の文言の「claude のセッション ID」→「会話の ID」を除く）

## 既知の制約

- **旧い名前が 1 つの欄に残る**: `AgentHistoryInfo.claudeSessionId` とそれを読み書きする 53 か所（型の付かないテストの値 19 か所を含む）は、保存の互換のため旧い名前のまま。renderer の送り先の控え（`describeSession`・`onSent`）も保存の形を使うので、ここでも `claudeSessionId` を読む。doc コメントで理由を示す
- **文字列の欄名と型の付かない値は型検査で見つからない**: `hasOnlyKeys` の配列・`as unknown as` の値・`Record<string, unknown>` の欄の読み・テストの `vi.fn()` の偽物や `toEqual` などの中の値は grep に頼る。今後、IPC の欄を足す・変えるときも同じ
- **古い版のアプリの関数での確かめは無い**: 古い版の `isValidHistoryEntry` はリポジトリに無いので、ディスクの形を文字列で固定するテストで代える
- **例外の文言の変更**: starter の 3 つと受け口の 1 つの例外の文言が変わる。通常の操作では出ないので、実機で確かめる手順は無い

## 実機テスト仕様書について

挙動を変えないので、`docs/manual-test-spec.md` に項目を足さない。画面に出る文言で変わるのは、通常の操作では出ない 4 つの例外の文言だけで、仕様書にそれらを期待結果に書いた項目は無い（「セッション ID」「会話の ID」「claudeSessionId」で `grep` して 0 件）。そのため既存の項目の期待結果も直さず、HTML の再生成と Artifact の再公開もしない。
