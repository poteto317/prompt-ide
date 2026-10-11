# エージェントのセッションの再開と履歴への記録 設計書

- 日付: 2026-10-11
- ROADMAP の項目: 「エージェント実行の支援（MVP の次）」→「セッションの再開（`claude --continue` / `--resume`）・履歴へのセッション記録」
- 前提の設計書: `2026-10-04-agent-terminal-mvp-design.md`（起動の IPC・「renderer からはコマンドを受け取らない」・C11: エージェント CLI 方式では履歴に記録しない）、`2026-10-09-agent-multi-session-tabs-design.md`（タブ・`claude N`・最大 4 タブ）、`2026-10-10-agent-send-confirm-design.md`（送信前の確認）、`2026-10-10-agent-prompt-references-design.md`（参照を足した全文・`onSent`）

## 目的

エージェント CLI 方式では、`claude` を閉じる（終了・タブを閉じる・フォルダや方式の切り替え・アプリの終了）と、その会話の続きをアプリから始める手段が無い。また、どのプロンプトをいつどのセッションへ送ったかが履歴に残らない（C11）。
アプリが起動ごとにセッションの ID を振って覚えておき、ターミナルのタブから「前回の続きから」、実行の履歴から「このセッションで再開」で `claude --resume <ID>` を起動できるようにする。あわせて、送れたプロンプトを履歴に残し、同じ全文を今のエージェントへ送り直せるようにする。

## 決めたこと（利用者の確認済み）

| 項目          | 決定                                                                                                                                                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 再開の入口    | 履歴とタブの両方。実行の履歴の詳細に `このセッションで再開`、ターミナルのタブの起動に `前回の続きから` を置く                                                                                                                                                                    |
| セッション ID | 起動時にアプリが振る。新しく起動するたびに main が UUID を作り `claude --session-id <UUID>` で渡す。再開は `claude --resume <UUID>`。`claude` の内部のファイル（`~/.claude/projects`）は読まない                                                                                 |
| 履歴          | 送れたときに記録する。エージェント CLI 方式で送れた（結果が `sent`）ときに、プロンプト名・送った全文（参照を含む）・セッション ID・タブ名・時刻・フォルダを記録する。結果の文章は記録しない。`再実行` は今のアクティブなエージェントへ同じ全文を送る（送信前の確認の設定に従う） |

## 決めたこと（推奨案で決めた事項）

| 項目                              | 決定                                                                                                                                                                                                                                                                                                                                                                                | 理由                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 「前回の続きから」の意味          | `--continue` は使わない。main がフォルダごとに記録した最後のセッション ID を `--resume <ID>` で再開する                                                                                                                                                                                                                                                                             | `--continue` は `claude` が選んだセッションを再開するため、アプリから再開後の ID が分からず、履歴にセッション ID を記録できなくなる。また `claude` の外（別の端末）で使ったセッションを拾うことがあり、アプリで振った ID の範囲で動くという方針から外れる                                                                                                                               |
| 記録の置き場                      | main の新しいストア `agentSessionRecordStore`（`userData/agent-sessions.json`）。フォルダのキーは許可のフォルダ（main の正規化した実パス）で、Windows では小文字にそろえる                                                                                                                                                                                                          | アプリを再起動しても続きから始められるよう永続化する。設定（`settings.json`）ではなく起動の記録なので別のファイルにする。renderer の文字列をキーにすると、シンボリックリンク・大文字小文字の違いで同じフォルダが別のキーになる                                                                                                                                                          |
| 記録の中身                        | フォルダごとに、振った ID の一覧（新しい順・最大 200 件。`HISTORY_CAP` と同じ）。先頭が「前回」。フォルダの数は最大 50（古いフォルダから捨てる）                                                                                                                                                                                                                                    | 再開の ID を「main が振った ID か」で確かめるため（下の行）。履歴の上限と同じ件数を持てば、履歴に残っているセッションは通常は再開できる。履歴は renderer が丸ごと保存する（`history:save`）ため、履歴の中の ID は main にとって信頼できる記録にならない。照合の相手を main だけが書く記録にし、上限で記録のファイルが際限なく育たないようにする                                         |
| 記録のタイミング                  | 起動が確定したとき（pty の起動が例外なく返り、registry が取り消さずにセッションを枠に置いたとき）。新しい起動・再開の両方で、その ID を一覧の先頭へ移す。spawn した後に取り消した起動（リロード・破棄・フォルダの切り替えなど）は記録しない                                                                                                                                         | 「最後に起動したセッション」を「前回」とする。送信のときだけに絞ると、ターミナルへ直接打って使ったセッションを続けられない。取り消した起動は利用者が使えなかったセッションなので「前回」にしない                                                                                                                                                                                        |
| 再開の指定                        | renderer は列挙型 `AgentLaunchRequest`（`{ kind: 'new' }` / `{ kind: 'resume'; claudeSessionId }`）だけを渡す。コマンドと引数の並びは main が決める                                                                                                                                                                                                                                 | 起動内容を renderer の値に委ねない（L-019）                                                                                                                                                                                                                                                                                                                                             |
| ID の検証                         | main の入力の検証で、小文字の UUID v4 の厳密な形式（`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`）に当たらなければ例外にする。加えて、起動の直前に、許可のフォルダの記録にその ID があるかを確かめ、無ければ `unknown-session` で拒む                                                                                                                    | 形式の検証で `-` 始まりの値がオプションとして解釈される経路を断つ（L-034）。記録の照合は、renderer が乗っ取られても、ほかのプロジェクトの会話や任意の ID を再開させないため（L-019）。どちらも main が振る ID なので、正しい利用で外れることはない                                                                                                                                      |
| 同じ ID の二重の起動              | main に全ウィンドウで共有する ID の予約の集合（`Set`）を 1 つ持つ。starter は判定と同時に同期で ID を予約し（`create` の前。間に `await` を挟まない）、予約済みの ID の再開を `session-in-use` で拒む。予約は spawn の失敗・起動の取り消し（止まりきった後）・セッションの `exited` の解決で外す。renderer も同じ ID のタブが起動中・実行中なら入口を押せなくする                   | 同じ会話を 2 つの `claude` が同時に書くと会話のファイルが壊れうる。registry の `slot.session` は `await create()` の後に置かれ、取り消しの経路は止まりきるまで `slot.session` にも `stoppingSessions` にも入らないため、registry の状態からは起動中・取り消し中の ID を判定できない。renderer の判定は表示のため、拒否の正は main（別のウィンドウのセッションは renderer から見えない） |
| 再開後の ID                       | `--resume <ID>` で再開したセッションは同じ ID のまま続くとみなす。タブの状態と履歴にはその ID を記録する                                                                                                                                                                                                                                                                            | `--fork-session` を付けない限り同じ ID で続く前提（`claude` の版で変わるなら実機で確かめる。既知の制約）                                                                                                                                                                                                                                                                                |
| `このセッションで再開`            | 新しいタブを開き、そのタブで再開する                                                                                                                                                                                                                                                                                                                                                | 今のタブの会話を止めずに済む。タブの数の上限・起動を受け付けない間の扱いは既存の `+`（タブの追加）と同じにする（L-048）                                                                                                                                                                                                                                                                 |
| 履歴の型                          | `toolId` は変えず（エージェントのエントリは `'claude'`）、別のフィールド `agent: AgentHistoryInfo \| null` を足す。状態 `HistoryStatus` に `'sent'` を足す（`agent` があるとき、かつそのときだけ）                                                                                                                                                                                  | `toolId`（`PromptToolId`）は従来の方式のツールの選択・実行に使う型で、値を足すと従来の実行の経路へ流れうる。結果を知らないのに `成功` と出さない                                                                                                                                                                                                                                        |
| 古い形式の読み込み                | `agent` の無いエントリは `agent: null` として読む。`agent` があるのに形が不正なエントリは、従来のエントリとして読み替えずに不正として捨てる                                                                                                                                                                                                                                         | 黙って従来のエントリへ読み替えると、従来の方式で非対話の `claude` に再実行させる経路へ流れる（L-044）                                                                                                                                                                                                                                                                                   |
| エージェントのエントリの `再実行` | エージェント CLI 方式で、今の選択中のタブへ同じ全文を `sendToAgent` で送る（送信前の確認に従う）。押せる条件と理由は一覧の `実行` と同じ（`getPromptRunAvailability`）。送れたら新しいエントリとして記録する                                                                                                                                                                        | 一覧の `実行` と同じ送信の経路を使う（L-048）。送り直しも「送れたときに記録」に含める                                                                                                                                                                                                                                                                                                   |
| 実機テスト仕様書                  | `docs/manual-test-spec.md` の「参照を添える」の節の後に `### セッションの再開と履歴` を足し、`AGT-194` から振る。「エラーと境界の扱い」の画面から通れる行と 1 対 1 で対応させ、`claude` の実物の挙動（ID が変わらないこと・空のセッションの再開）を記録させる項目と、「前回」がほかのタブで後から起動したセッションを指す（それが動いている間は押せない）ことを確かめる項目を含める | 実物の `claude` の挙動はモックのテストでは確かめられない（L-059）                                                                                                                                                                                                                                                                                                                       |

## 範囲

含めるもの:

- main がセッション ID を振り、`--session-id` / `--resume` を付けて起動する（起動の IPC の拡張・検証）
- フォルダごとのセッションの記録（ストア・IPC での「前回」の取得）
- ターミナルのタブの `前回の続きから`
- エージェント CLI 方式で送れたときの履歴の記録（型・検証・保存の拡張）
- 履歴の詳細の `このセッションで再開`・エージェントのエントリの `再実行`・表示（`送信済み`・タブ名・送った全文）

含めないもの:

- セッションの一覧の画面（記録の一覧を選んで再開する UI）
- `claude` の内部のファイル（`~/.claude/projects`）の読み取り・会話の中身の表示
- `--continue`・`--fork-session`・`claude` 自身の `/resume` の画面との連携
- 結果の文章（`claude` の応答）の記録
- 従来の方式の履歴をエージェントへ送り直すこと（エージェント CLI 方式では従来どおり押せない）
- 記録を消す操作（履歴のエントリを消しても、main の起動の記録は残る）

## 起動の流れ

1. renderer は `start(slotId, launch)` を呼ぶ（`launch` は省略できない。既存の `起動`・`+` は `{ kind: 'new' }`）。`agentTerminalApi.startAgentSession({ slotId, folderPath, cols, rows, launch })`。
2. main の parser（`agentTerminalPayloadParser.ts`）が `launch` を検証する。`kind` が `new`・`resume` 以外、`resume` の `claudeSessionId` が文字列でない・UUID v4 の形式に当たらない、余分なキーがある、は例外（既存の不正な入力と同じ扱い）。`launch` が無い依頼も例外（既定の `new` に流さない。L-044）。
3. `agentSessionStarter.startHeld` は、既存の検査（許可のフォルダ・ディレクトリ・コマンドの探索・世代）の後、spawn の直前に同期で次を行う（間に `await` を挟まない。判定と予約の間に別の起動が割り込まないように）:
   - `new`: `createClaudeSessionId()`（既定 `crypto.randomUUID()`）で ID を作る。
   - `resume`: 許可のフォルダのキーの記録に ID が無ければ `{ kind: 'error', error: 'unknown-session' }`。予約の集合（`claudeSessionReservations`）に同じ ID があれば `{ kind: 'error', error: 'session-in-use' }`。
   - どちらも、通ったらその場で ID を予約の集合に入れる（新しい ID も入れる。UUID の衝突は起きない前提だが、外す経路を 1 つにそろえるため）。
   - 引数は `buildAgentLaunchArgs(launch, id)`（`agentCommand.ts`）が `['--session-id', id]` か `['--resume', id]` を返す。検証を通った値をそのまま使い、別の場所で読み直さない（L-018）。
4. 予約を外す経路: spawn が例外を投げた・`create` が `failed` を返した → すぐ外す。spawn した後に registry が取り消した（`isSuperseded` で `session.stop` した）→ 止まりきった後に外す。起動が確定したセッション → その `exited` が解決したときに外す（止める操作〈`stoppingSessions`〉の間も予約は残る）。外し忘れを防ぐため、予約と解除は starter の 1 か所（予約を返す関数と、その解除をセッションの `exited` か失敗の `finally` に結ぶ処理）に置く。
5. `registry.start` が `started` を返したら（取り消さずにセッションを枠に置いた＝起動が確定した）、starter が記録のストアへ ID を先頭として書く。取り消した起動は書かない。書き込みは直列にし（前の書き込みの完了を待ってから次を書く。L-040）、失敗はログに残すだけで起動の結果は変えない（起動は成功しているため）。記録のストアはメモリを先に更新するため（下の「構成」の `agentSessionRecordStore.ts`）、書き込みが失敗しても、そのプロセスの間の `前回の続きから`・再開の照合は新しい記録を使う。古い記録を使うのは、書き込めなかった分がファイルに残らないまま、アプリを起動し直した後だけ。
6. 結果 `started`・`already-running` は、既存の `sessionId`（pty のセッションの id）に加えて `claudeSessionId` を返す（必須）。`already-running` のときは、動いているセッションの ID を返す（依頼の `launch` は使わない）。registry は pty の `sessionId` しか知らないため、registry の `start`・`startHeld`・`pending.run` の戻り値は registry 専用の結果の型 `AgentRegistryStartResult`（成功は pty の `sessionId` だけ。エラーは共有の型と同じ）に付け替える（registry の変更は型の付け替えだけで、処理は変えない）。starter が pty の `sessionId` → `claudeSessionId` の `Map` を持ち（`create` でセッションを作ったときに入れ、そのセッションの `exited` の解決で消す。消す購読は `create` の中で、セッションを registry へ返す前に付ける。registry の `slot.session` を外す購読は `await create()` の後に付くため、starter の購読が先に走り、Map から消えるのは registry が `slot.session` を外すより先になる。Map に無いのに registry には残っている瞬間はあっても、その逆〈registry から外れたのに Map に古い ID が残る〉は起きない）、registry の結果に `claudeSessionId` を足して共有の `AgentStartResult` に変える。`already-running` ではこの Map から引き、見つからない（理屈上は起きない）ときは例外にしてログを残す（推測の ID を返さない）。`agentSession.ts`（`AgentSession`）は変えない。renderer は、`resume` の依頼に `already-running` が返り、結果の ID が依頼した ID と違うときは、タブの `claudeSessionId` を結果の値で上書きする（そのタブで実際に動いているのは結果のセッションのため）。
7. renderer がタブの状態に `claudeSessionId` を持つのは、そのタブのセッションが起動中（`resume` のときは依頼した ID、`new` のときは結果が届いてから）・実行中の間だけ。使い道は 2 つ: 送信の時点の送り先の ID の控え（「履歴への記録」）と、同じ ID が動いているかの renderer の判定（`前回の続きから`・`このセッションで再開` の押せない理由）。終了・起動の失敗・取り消しで `null` に戻す（終了した後の ID はどこにも使わないため持たない）。起動の結果（`started`・`already-running`）を受けたら「前回」の記録を取り直す（起動の結果より先に終了が届き、実行中のタブに新しい ID が一度も描画されない起動でも取り直す。`useAgentSessions` が起動の結果を受けた回数 `startConfirmedCount` を持ち、それだけを取り直しの契機にする）。

- 名前の区別: 既存の `sessionId` は main の pty のセッションの id。`claude` の会話の ID は、型・IPC・状態のどこでも `claudeSessionId` と呼び、取り違えないようにする。
- `agentCommand.ts` の方針のコメント（「引数は空で固定」）は「引数は main が決めたセッションの指定（`--session-id` / `--resume` と UUID）だけ。`--dangerously-skip-permissions` などは付けない」に直す。`resolveAgentLaunch` は従来どおり `args: []` を返し、セッションの指定は starter が足す。
- 環境変数 `CLAUDE_CODE_SESSION_ID` を取り除く扱いは変えない（親の Claude Code のセッションを引き継がない。子のセッションの ID は引数で渡す）。

## 前回の続きから（ターミナルのタブ）

- 意味: 「このフォルダで最後に起動が確定したセッション」（どのタブ・どのウィンドウで起動したかは問わない）。そのタブで前に動いていたセッションではない。たとえば `claude 1` が終了した後に `claude 2` を起動していれば、`claude 1` の `前回の続きから` が指すのは `claude 2` のセッションで、それが動いている間は押せない（下の理由）。
- 置き場所: 帯の `起動` の隣に `前回の続きから` ボタン（タブが動いていない〈未起動・終了・起動の失敗〉ときだけ。`起動` と同じ条件で出す）。`aria-label="前回の続きから（このフォルダで最後に起動した claude のセッションを再開）"`。
- 押すと `start(slotId, { kind: 'resume', claudeSessionId: <前回の ID> })`。
- 「前回」の取得: IPC `agentTerminal:getLastSession(folderPath)` → `{ claudeSessionId: string } | null`。main は `folderPath` を正規化して許可のフォルダと一致するときだけ記録の先頭を返し、一致しなければ `null`。renderer（新規 `useAgentLastSession`）はフォルダが変わったとき・起動の結果を受けたとき（`startConfirmedCount` が増えたとき）に取り直す（main の記録が変わるのは起動の確定のときだけなので、終了・タブを閉じたときは取り直さない。「同じ ID が動いている」理由は描画ごとのタブの状態から求める）。依頼ごとに連番を振り、最新の依頼でない結果・依頼の後にフォルダが変わった結果は捨てる（L-037・L-040）。
- 押せない理由（`起動` の既存の理由〈フォルダ無し・方式の切り替えの途中〉を優先し、その後に）:
  - 取得中: `前回のセッションを確かめています`
  - 記録が無い（取得の失敗を含む）: `このフォルダで前回起動したセッションの記録がありません`
  - 同じ ID のタブが起動中・実行中: `前回のセッションは claude 2 で動いています`
- 理由は既存の `起動` の理由と同じ領域（`agent-terminal-panel__reason`）に 1 か所だけ見える文字で出す（L-057）。見え方と読み上げは、ローカルレビュー第 4〜6 周（2026-10-11）で次のように変えた（当初は見える理由をボタンの `aria-describedby` で直接参照していた）:
  - 見える理由（`agent-terminal-panel__reason`）は `aria-hidden="true"` にする。`起動`・`前回の続きから` の `aria-describedby` は、同じ文言を入れた別の `hidden` の span（`reasonId`）を指す（理由が 3 回読まれず、説明として 1 回だけ読まれるように）。
  - `前回の続きから` のボタンの `title` は押せない理由だけにする。押せるときの全文は、ボタンではなくラベルの span の `title` に出す（ボタンの `title` が説明として名前の後に重ねて読まれるのを防ぐ）。
  - 狭い幅では、理由 → `前回の続きから` の文字（`agent-terminal-panel__button--resume` で縮めて省略表示）→ タブ列・状態の順に縮む。操作群（`agent-terminal-panel__actions`）は `display: contents` にして、理由とボタンを帯の直接の子として並べる（箱だけが縮んで `最大化` が帯の外にはみ出すのを防ぐ）。
  - ボタンは `disabled` 属性で押せなくし、`start` の中でも同じ条件で何もしない（L-058）。

## 履歴への記録

- 記録する契機: エージェント CLI 方式の送信が `sent` になったときだけ（`AgentSendOptions.onSent`）。確認のキャンセル・確認が閉じた（フォルダの切り替えなど）・送信の失敗・例外では記録しない（L-001）。
- 送り先のセッションの控え: `onSent` を `onSent(sent: AgentHistoryInfo | null)` に変える（`AgentHistoryInfo` = `{ claudeSessionId, tabLabel, folderPath }`。履歴の `agent` と同じ形なので 1 つの型にし、送信の側の別の型は作らない）。層の分担: `hooks/useAgentPromptSender.ts` の `AgentSendTarget` に `describeSession(): AgentHistoryInfo | null` を足す。中身（`slotId` でタブの今の状態とフォルダを ref から引く関数）は `useAgentWorkspace` が作り、選択中のタブを送り先にするところ（すぐ送るときの target と、`useAgentSendConfirm` へ渡す `selected`）を `useAgentWorkspace` で包んで付ける（`useAgentSessions` の `selected` には持たせない。タブの状態は送信の手段を知らないままにする）。確認を経由するとき（`useAgentSendConfirm.confirm` → `send(text, target)`）も控えた `target` の関数をそのまま使う。`useAgentSendConfirm.request` は `selected` から送り先を作り直しているため、`slotId`・`controller`・`describeSession` の 3 つを写す（`describeSession` を写し忘れると確認を経由した送信だけ記録が抜けるため、確認を経由した送信の記録をテストで固定する）。`useAgentPromptSender.send` は送信の手順を始める時点（`controller.beginSending` の直前）に `describeSession()` を呼んで控え、`sent` の結果に載せて返す（`{ kind: 'sent'; clearedDraft; sentTo: AgentHistoryInfo | null }`。純粋な `sendAgentPrompt` の `AgentSendOutcome` は変えず、sender の戻り値の型で足す）。`notifyAgentSent` は `sent` のとき `outcome.sentTo`（`null` を含む）を `onSent` に渡す。`sentTo` が `null`（ありえない想定）でも `onSent` は呼ぶ（参照の後始末は送れたことだけで決まるため）。送信の後で読むと、その間にタブが起動し直した・閉じた・フォルダが変わったときに、届いた先と違う ID を記録するため（L-037）。動いていないタブへは既存の押せる条件で送信が始まらないため、通常は控えた時点で ID がある。
- 記録の中身（`usePromptRunner` が `addHistoryEntry` で足す）:
  - `promptId`・`promptTitle`: 実行したプロンプト（再実行ではエントリの値を引き継ぐ）
  - `promptContent`: `sendToAgent` へ渡した全文（変数を差し込み、参照を足した後。正規化の前）
  - `fileContent: null`・`toolId: 'claude'`・`status: 'sent'`・`resultText: null`・`errorMessage: null`
  - `executedAt`: 送れた時刻
  - `agent: { claudeSessionId, tabLabel, folderPath }`
- `usePromptRunner` の C11 のコメントは「エージェント CLI 方式は送れたときに記録する（結果の文章は記録しない）」に直す。`usePromptRunner` が渡す `onSent(sent)` の中は、参照の後始末（`markSent`）と履歴の記録を段ごとに別の `try` で包み、片方が投げてももう片方を止めない（L-053。`notifyAgentSent` の `try` は `onSent` 全体を包むだけなので、段の間の独立はここで持つ）。`sent` が `null` なら、`markSent` は行い、記録だけを省いてログに残す。

## 履歴の画面

- 一覧（`HistoryItem`）: エージェントのエントリは、ツールの欄に `エージェント（claude 2）`、状態に `送信済み`（`getStatusLabel('sent')`。色は成功・エラーと区別する中立の色）を出す。
- 詳細（`HistoryDetail`）:
  - 見出しの下のメタ情報に、タブ名・時刻に加えて `セッション: <UUID>` を出す（選んでコピーできる文字として）。
  - 本文の領域には結果の代わりに、送った全文を読むだけの等幅の領域で出す（`aria-label="送った内容"`。長いときは枠の中でスクロールし、`tabIndex=0`）。
  - 操作: `再実行`・`このセッションで再開`・`削除`。`このセッションで再開` は `agent` のあるエントリにだけ出す。
- 押せない理由は、ボタンごとに見える文字で 1 か所に出し、`aria-describedby` で結ぶ。2 つのボタンの理由は別の段落・別の id にする（L-057）。

### `このセッションで再開` の押せない理由（上から順に、最初に当たったものを 1 つ出す）

1. 実行方式の読み込み中: 既存の `RUN_DISABLED_LOADING_MODE`
2. 従来の方式: `エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）`
3. フォルダを開いていない・記録したフォルダと違う（`isSamePath` で比べる。Windows は大文字小文字を区別しない）: `記録したフォルダ（<folderPath>）を開いているときだけ再開できます`
4. 起動を受け付けない間（方式の切り替えの途中など）: 既存の `startDisabledReason`
5. 同じ ID のタブが起動中・実行中: `このセッションは claude 2 で動いています`
6. タブが上限（4）: 既存の `addDisabledReason`（`+` と同じ文言）

- 押すと、新しいタブを足して（`tabs.add()`）、そのタブを選択し、`start(slotId, { kind: 'resume', claudeSessionId })` を呼ぶ。ターミナルのパネルを開き、フォーカスは新しいタブのターミナルへ移す（既存の `+` と同じ）。
- 押してから起動までの間に条件が変わった（タブが足せなかった）ら何もしない。起動の失敗（`unknown-session`・`session-in-use`・コマンドが無い など）は、足したタブのエラーとして既存のとおり出す。

### エージェントのエントリの `再実行` の押せない理由

- エージェント CLI 方式: 一覧の `実行` と同じ（`getPromptRunAvailability` に選択中のタブの状態を渡す。読み込み中・閉じる途中・セッションが無い・送信中）。
- 従来の方式: `エージェント CLI 方式で記録した履歴は、エージェント CLI 方式でだけ再実行できます`
- 従来のエントリは今のまま（エージェント CLI 方式では `RERUN_DISABLED_AGENT_MODE`）。
- 送信前の確認（`useAgentSendConfirm`）を挟むときの、閉じた後のフォーカスの戻り先（ローカルレビュー第 9 周で変更。履歴の詳細の `再実行` から開くと、プロンプトの一覧のパネルは `display: none` で隠れており、一覧の `実行` へ `focus()` を呼んでも移らず body に落ちるため）。キャンセル（`キャンセル`・`Esc`・背景）と、確認からの送信の失敗（`failed`・結果なし）で同じ戻り先にする。確認を開いた時点の `document.activeElement` を `PendingAgentSend.opener` に控え、`AgentSendSettled.opener` で渡す。戻り先は `lib/promptRunButton.ts` の `findSendConfirmReturnTarget(opener, promptId)` が決める。
  1. opener が DOM に残っていて（`isConnected`）、disabled でなく、見えていれば（`checkVisibility()`。無い環境〈jsdom〉では見えているとみなす）opener へ戻す（履歴の詳細の `再実行` など）。
  2. 無ければ（変数のフォームの `実行` から開いた場合、フォームは閉じている）、見えている同じプロンプトの一覧の `実行`（`data-prompt-run`）へ戻す。
  3. それも無ければフォーカスを移さない。
  送れたとき（`sent`）は従来どおり `activateAgentTab` で送り先のターミナルへ移し、opener は使わない。実機テスト仕様書は AGT-212。
- 送信の結果（失敗の `role="alert"`・成功の `role="status"`。`PromptRunPanelState.agentSend`）は、プロンプトのパネルの上部に加えて、実行履歴のパネルの上部（`すべて削除` の下）にも同じ文言で出す（ローカルレビュー第 16 周で変更。以前はプロンプトのパネルにだけ出しており、履歴の詳細の `再実行` を押すときはプロンプトのパネルが `display: none` で隠れているため、失敗の文言が見えず読み上げもされなかった）。状態は 1 つ（`Sidebar` が受け取る `promptRun.agentSend`）で、見える文字は `Sidebar` が見えているパネル（`activePanel` が `prompts` か `history`）にだけ渡し、もう一方には `null` を渡す。見える文字（共有の `components/agent/AgentSendFeedbackMessages.tsx`）は role を持たず `aria-hidden` にする。読み上げは、`Sidebar` がパネルの外に常に置く 1 か所（`components/agent/AgentSendFeedbackAnnouncer.tsx`。視覚的に隠す。失敗は `role="alert"`、成功は `role="status"`）だけが担う（ローカルレビュー第 17 周で変更。第 16 周では見えている側のパネルの文字が role を持っており、パネルを切り替えるたびに文言を持った `role="alert"` が新しく DOM に入って、古い失敗が読み上げ直されていた）。パネルを切り替えても読み上げの領域は同じ要素のままで、読み上げ直さない。`HistoryPanel` の `agentSend` は省略できない（L-060）。
- 押せる条件がエントリごとに変わるため、`PromptRunPanelState` から `isRerunDisabled`・`rerunDisabledReason`（全体で 1 つ）を消す。代わりに、エントリを受け取る `getHistoryActions(entry)`（`{ rerun, resume }` の `{ disabled, reason }`）と `onResume(entry)` を `useAgentWorkspace` で組み立て、`AgentWorkspaceState` の別のフィールドとして返す。`App` はそれを `Sidebar` の必須の props に渡す。

## 構成

### 共有の型

- `src/shared/types/agentTerminal.ts`: `AgentLaunchRequest`、`AgentStartRequest.launch`（必須）、`AgentStartResult` の成功に `claudeSessionId`（必須）、`AgentTerminalErrorKind` に `unknown-session`・`session-in-use`、UUID の形式 `CLAUDE_SESSION_ID_PATTERN` と判定 `isClaudeSessionId`。
- `src/shared/types/history.ts`: `HistoryStatus` に `'sent'`、`AgentHistoryInfo` = `{ claudeSessionId: string; tabLabel: string; folderPath: string }`（送信の `onSent`・`describeSession` も同じ型を使う）、`HistoryEntry.agent: AgentHistoryInfo | null`（必須。従来のエントリを作る `usePromptExecution` も `agent: null` を明示する。L-060）。

### main

- `agentTerminalPayloadParser.ts`: `launch` の検証（上の「起動の流れ」2）。
- `agentCommand.ts`: `buildAgentLaunchArgs(launch, id)`。
- `claudeSessionIdSelection.ts`（新規）: 起動に使う ID の選択 `selectClaudeSessionId`（`new` は振る・`resume` は記録と照合する）。
- `agentSessionStarter.ts`: `selectClaudeSessionId` を呼ぶ。二重の起動の判定・記録の書き込みを持つ（依存として `records`・`createClaudeSessionId` を受け取る）。
- `claudeSessionReservations.ts`（新規）: 全ウィンドウで共有する ID の予約の集合（`tryReserve(id): (() => void) | null`。返した解除の関数は 2 回呼んでも害が無い）。main に 1 つ作って starter に注入する。registry の処理は変えない（取り消しの完了・`exited` は starter が受け取るセッションから結ぶ）。
- `agentSessionRegistry.ts`（既存）: 型の付け替えだけ。`start`・`startHeld`・`pending.run` の戻り値を `AgentRegistryStartResult` にする（共有の `AgentStartResult` に `claudeSessionId` を必須で足すと、registry がこの型を使っているため typecheck が通らなくなるため）。
- `agentSessionRecordStore.ts`（新規）: 記録はメモリに持つ。`has(folderKey, id)`・`last(folderKey)` は同期でメモリを引く（`resume` の照合は starter の `await` を挟まない区間にあるため）。読み込みは main の起動時に一度だけ始め、starter・`getLastSession` は読み込みの完了の Promise を最初の利用の前に `await` してから同期の区間に入る（読み込みが間に合わない経路を作らない）。ファイルが無い（ENOENT）・中身が壊れている（JSON・形の不正）ときは空として扱い（記録は再開の補助のため）、次の `record` で新しい中身に書き直す。不正な要素だけを捨てる。ENOENT 以外の I/O の理由で読めなかった（ファイルはあるのに読めない）ときも空として扱うが、読み直せるまではファイルへ書かず、メモリだけで記録する（空のメモリ + 新しい記録でファイルを上書きし、ほかのフォルダの記録を消さないため。L-002）。読み直しは次の `record` の書き込みの前に、書き込みと同じ直列の中で行い、読めたら（または ENOENT なら）読んだ記録とメモリを合わせて（メモリを前に）書き込みを再開する（一時的な EBUSY・EPERM・EMFILE から回復する）。読めないままなら書かず、「書き込まない」ログは読めなくなった時点の 1 回だけ出す。`record(folderKey, id)` はメモリを同期で更新してから、ファイルへの書き込みを直列に非同期で行う（書き込みの完了は待たない）。starter は `started` を返す前に `record` を呼び、メモリへの反映を済ませる（直後の `getLastSession`・再開の照合が新しい記録を見るように）。フォルダのキーを作る `toAgentFolderKey(canonicalPath, platform)` は Windows で小文字にする。
- `agentSessionRecordFileIo.ts`（新規）: `userData/agent-sessions.json` の読み書き（ディレクトリが無ければ作る）。`agentSessionRecordStore` に注入する実物。
- `agentSessionSnapshot.ts`（新規）: `attachClaudeSessionIds`。snapshot に `claudeSessionId` を足し、引けない要素を外してログを残す。handler がこれを呼ぶ。
- `agentTerminalHandlers.ts`・`preload/api.ts`・`preload/index.d.ts`: `agentTerminal:getLastSession`。作り直しの後の合わせ込み（renderer の `useAgentSessions` → `getAgentSessions` → `registry.snapshot`。今は `{ slotId, sessionId }` だけ）でも ID が取れるよう、handler が `attachClaudeSessionIds` で starter の Map（pty の `sessionId` → `claudeSessionId`）を引いて、共有の `AgentSessionSnapshotEntry` に `claudeSessionId`（必須）を足して返す。registry の `snapshot` は変えない（registry 専用の要素の型を返し、handler が変える）。Map に見つからない要素は、例外にせず返す一覧から外してログを残す（合わせ込みの全体を止めないため。`exited` の途中の瞬間に当たりうる）。renderer は合わせ込みでタブの `claudeSessionId` も合わせる。
- `historyUtils.ts`: `isValidHistoryEntry` に `status` の `'sent'` と `agent`（`undefined`〈古い形式〉・`null`・正しい形のオブジェクト）を足し、`agent` があるときかつそのときだけ `status === 'sent'` を求める。`agent.claudeSessionId` は UUID の形式、`tabLabel`・`folderPath` は空でない文字列。`sanitizeHistoryEntry` は `agent` を取り出して返し（`undefined` は `null` にする）、`agent` の中も 3 つのフィールドだけに作り直す。どちらかを直し忘れると、保存（`history:save` も同じ関数を通る）のたびに `agent` が黙って消える（L-015）。

### renderer

- `useAgentSessions.ts`: `start(slotId, launch)`、タブの状態の `claudeSessionId`、`resumeInNewTab(claudeSessionId)`（`addTab` と同じ検査の後に足して再開）、同期の重複判定 `isClaudeSessionIdActiveElsewhere`（内部の関数。ref で同期に判定する）。
- `lib/agentSessionTabState.ts`: 同じ ID の動いているタブを探す `findActiveAgentTabByClaudeSessionId`（表示の判定に使う）。
- `useAgentLastSession.ts`（新規）: 「前回」の取得と取り直し。
- `useAgentResume.ts`（新規）: 前回の取得と、2 つの入口（`前回の続きから`・履歴の `このセッションで再開`）の理由と操作の組み立て。
- `lib/agentTabSessionInfo.ts`（新規）: 送り先のタブから履歴に記録する `AgentHistoryInfo` を作る `describeAgentTabSession`（`useAgentWorkspace` が呼ぶ）。
- `lib/agentResumeAvailability.ts`（新規）: `前回の続きから`・`このセッションで再開` の押せない理由を求める純粋な関数（タブの一覧・フォルダ・方式・起動の理由を受け取る）。
- `AgentTerminalPanel.tsx`: `前回の続きから` のボタンと理由。
- `useAgentPromptSender.ts`・`useAgentWorkspace.ts`・`useAgentSendConfirm.ts`・`lib/agentSendCallbacks.ts`・`lib/agentPromptRequest.ts`: `onSent(sent)` の配線と送り先の控え。
- `lib/promptRunButton.ts`: `findSendConfirmReturnTarget(opener, promptId)`（確認を閉じた後のフォーカスの戻り先。opener → 見えている一覧の `実行` → `null`。一覧の `実行` を探す `findPromptRunButton` は非公開）。`useAgentSendConfirm` が `PendingAgentSend.opener`・`AgentSendSettled.opener` を持ち、`AgentSendConfirmDialog`（キャンセル）と `usePromptRunFocus`（送信の失敗）がこの関数を使う（ローカルレビュー第 9 周で追加）。
- `usePromptRunner.ts`: 送れたときの記録、エージェントのエントリの `rerunHistoryEntry`（エージェント CLI 方式なら `sendToAgent(entry.promptContent, { promptId: entry.promptId, unsavedPaths: [], onSent })`。参照は全文に含まれているので足し直さない）。エージェント CLI 方式では、`entry.agent === null`（従来のエントリ）には何もしない（ボタンは押せないが、処理の側でも同じ条件で守る。L-058）。従来の方式では、`entry.agent !== null` のエントリには何もしない（ボタンは押せないが、処理の側でも同じ条件で守る。L-058）。
- `lib/promptRunState.ts`・`lib/agentSendMessages.ts`・`types.ts`（`PromptRunPanelState` から `isRerunDisabled`・`rerunDisabledReason` を消す）: 押せない理由を求める関数と文言。`getHistoryActions`・`onResume` は `useAgentWorkspace` で組み立てる（タブ・フォルダ・方式・送信中の状態がそこに集まっているため）。
- `components/history/HistoryPanel.tsx`・`HistoryItem.tsx`・`HistoryDetail.tsx`・`lib/historyFormatters.ts`: 表示と操作。新しい props（`getHistoryActions`・`onResume`・`agentSend`）は省略できない形にする（L-060）。
- `components/agent/AgentSendFeedbackMessages.tsx`（新規。ローカルレビュー第 16 周で追加）: 送信の結果の見える文字（`PromptsPanel`・`HistoryPanel` で共有。`aria-hidden`）。
- `components/agent/AgentSendFeedbackAnnouncer.tsx`（新規。ローカルレビュー第 17 周で追加）: 送信の結果の読み上げ（`Sidebar` がパネルの外に常に置く 1 か所。`role="alert"`・`role="status"`）。
- `useAppState.ts`・`App.tsx`・`components/Sidebar.tsx`（`HistoryPanel` への `getHistoryActions`・`onResume` の受け渡し）: 配線。`getHistoryActions`・`onResume` は `promptRun`（省略できる props）の中に入れず、`Sidebar` の必須の props として別に受ける（`App` は `AgentWorkspaceState` の値を常に渡し、テストは明示的に渡す。L-060）。今の `promptRun?.isRerunDisabled ?? isExecuting`・`promptRun?.rerunDisabledReason ?? null` の補いは消す。`Sidebar` は送信の結果（`promptRun?.agentSend`）の見える文字を見えているパネル（`PromptsPanel` か `HistoryPanel`）にだけ渡し（ローカルレビュー第 16 周で追加）、読み上げの領域（`AgentSendFeedbackAnnouncer`）をパネルの外に常に置く（ローカルレビュー第 17 周で追加）。

## エラーと境界の扱い

- 新しい状態「動いている `claude` が持つセッション ID」に対し、`claude` を起動する入口を列挙して扱いを決める（L-061）:

| 入口                                                 | 扱い                                                                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `起動`（新規）・`+`（タブの追加）                    | 常に新しい ID。記録を先頭に足す                                                                                                                                               |
| `前回の続きから`                                     | 記録の先頭の ID で再開。同じ ID が動いていれば renderer で押せず、main でも `session-in-use`                                                                                  |
| `このセッションで再開`                               | エントリの ID で再開。記録に無ければ main が `unknown-session`、動いていれば `session-in-use`                                                                                 |
| `already-running`（StrictMode の二重の依頼など）     | 動いているセッションの ID を返す（新しい ID を振らない）                                                                                                                      |
| 作り直しの後の合わせ込み（`getAgentSessions`）       | 新しい起動ではない。handler が starter の Map から ID を足した一覧を返し、renderer はタブの `claudeSessionId` を合わせる                                                      |
| リロード・ウィンドウの破棄・フォルダや方式の切り替え | 既存のとおり止める。止まりきるまで（`exited` の解決・取り消しの停止の完了まで）予約が残り、同じ ID の再開は `session-in-use` で拒む。spawn した後に取り消した起動は記録しない |

- 起動の失敗の文言（`describeAgentStartError`）:
  - `unknown-session`: `このセッションは再開できません（アプリの起動の記録にありません）`
  - `session-in-use`: `このセッションはほかのタブかウィンドウで動いています`
- `claude` が再開に失敗した（会話のファイルが無い・壊れている など）ときは、`claude` がターミナルにエラーを出して終了する。アプリはタブの終了として既存のとおり出し、`claude` の出力を解釈しない。
- 新しく起動して何も送らずに終えたセッションを `前回の続きから` で再開すると、`claude` の版によっては会話が見つからず終了する（記録は起動の成功の時点で付けるため）。既知の制約。
- 記録のファイルの読み書きの失敗: 読み込みは空として扱う（`前回の続きから` は記録が無いの理由で押せない・履歴からの再開は `unknown-session`）。ENOENT 以外の I/O の理由で読めなかったときは、次の記録の書き込みの前に読み直し、読めるまではファイルへ書かない（起動の記録はメモリだけに持ち、ログは 1 回だけ残す）。読み直せたら読んだ記録とメモリを合わせて書き込みを再開する。中身が壊れているときは次の記録で書き直す。書き込みの失敗はログだけ。
- 履歴の詳細の `再実行` から開いた送信前の確認をキャンセルした・確認からの送信が失敗した場合は、フォーカスを詳細の `再実行`（opener）へ戻す。一覧は隠れているため一覧の `実行` へは戻せない（AGT-212。ローカルレビュー第 9 周で対応）。送信の失敗の文言は、見えている実行履歴のパネルの上部に出す（AGT-212。ローカルレビュー第 16 周で対応）。読み上げは `Sidebar` の常設の `role="alert"` の 1 か所で、パネルを切り替えても読み上げ直さない（AGT-167・AGT-212。ローカルレビュー第 17 周で対応）。
- 履歴の保存の失敗は既存のとおり（記録の失敗で送信の結果は変えない）。
- 履歴の上限（200）は既存のとおり。エージェントのエントリも数える。
- 履歴のエントリを消しても、main の起動の記録は消えない（`前回の続きから` は動く）。
- フォルダを開き直した・ほかのフォルダから戻ったときは「前回」を取り直す。取り直しの前の結果は捨てる。
- 上の各行のうち画面から通れるものは実機テスト仕様書の項目と 1 対 1 で対応させる（L-297）。main の拒否（`unknown-session`・`session-in-use` のうち renderer が押せなくするもの）は画面から通れないため単体テストで確かめる。`session-in-use` のうち別のウィンドウのセッションによるものも、実機の項目にはしない。このアプリは新しいウィンドウを開かず（`src/main/index.ts` の `setWindowOpenHandler` が常に `deny`。ウィンドウを作り直すのは、すべて閉じた後の macOS の `activate` だけ）、2 つのウィンドウが同時に動く状態を画面から作れないため。別の所有者（ウィンドウ）からの再開を拒むことは starter の単体テスト（`agentSessionStarter.test.ts` の「別の枠・別の所有者(ウィンドウ)からの再開を session-in-use で拒む」）で確かめる。リロードの直後に止まりきる前の前の文書のセッションと重なったときだけ画面にも出うるが、タイミングに依存するため、出たときに AGT-206 で記録する扱いにとどめる。

## 既知の制約（ROADMAP・実機テスト仕様書に反映する）

- `--resume <ID>` で再開しても同じ ID のまま続く前提にしている。`claude` の版によって再開で新しい ID になる場合、履歴と記録には再開の前の ID が残る（実機で確かめ、仕様書の項目で記録する）。
- 何も送らずに終えたセッションは、`claude` が会話を保存せず、再開できないことがある。
- 起動しただけで閉じると、そのセッションが「前回」になり、続けたかったセッションが「前回」から押し出される（履歴からは再開できる）。実機の結果によっては記録のタイミング（最初の送信のとき など）を見直す。
- アプリの外（別の端末）で同じセッションを `claude --resume` で開いているのは検知できない。
- 履歴のエントリの再開はアプリが振った ID だけ。フォルダごとに 200 件を超えて古くなった ID は、履歴に残っていても再開できない（`unknown-session`）。
- 記録したフォルダと今のフォルダの比較は renderer のパスの文字列で行う（シンボリックリンク越しに同じフォルダを開くと、押せない理由が出ることがある。main の照合は実パス）。
- 新しい形式の履歴（`status: 'sent'`）を古い版のアプリで読むと、そのエントリは捨てられる。
- 履歴の `再実行` は記録した全文をそのまま送るため、全文の参照に入っているファイルを未保存のまま編集していても、送信前の確認に未保存の注意は出ない（一覧の `実行` は押した時点の参照から求めて出す）。全文から参照を解析し直すのは文字列の解釈が脆いため行わない。
- 記録のファイルが一時的に読めなかったときは、次に新しく起動するまで `前回の続きから` と `このセッションで再開` が使えない（起動の記録の書き込みのときに読み直す。再開・前回の取得では読み直さない）。

## テスト

- parser: `launch` の `new`・`resume`（正しい UUID）、無い・未知の `kind`・余分なキー・大文字の UUID・v4 以外・`-` 始まり・文字列以外で例外。
- `buildAgentLaunchArgs`: `new` は `['--session-id', id]`、`resume` は `['--resume', id]`。
- starter: `new` で ID を振って記録し結果に返す（`started` を返した時点で `last`・`has` が新しい ID を返す）、`already-running` は pty の id から引いた `claudeSessionId` を返し、`exited` の後は Map から消え、`already-running` も返らない（Map から消えるのは registry が `slot.session` を外すより先）、`resume` で記録に無ければ `unknown-session`・予約済みなら `session-in-use`（起動中・止まりきる前・取り消しの停止の途中・別の所有者を含む）、予約が spawn の失敗・取り消しの停止の完了・`exited` の解決で外れる、spawn の失敗と spawn した後の取り消しでは記録しない、記録の書き込みの失敗でも `started`、検証を通った ID がそのまま引数になる、`already-running` は動いている ID を返す、同じ ID の 2 つの起動が並んでも 1 つだけ通る。
- `agentSessionRecordStore`: `has`・`last` が同期でメモリを引く、読み込みの完了の前に呼んだ利用は完了を待つ、`record` がメモリを先に更新し書き込みを待たない、先頭へ移す・重複しない・フォルダごと 200 件・フォルダ 50 件・Windows のキーの小文字化・壊れたファイル（次の記録で書き直す）・ENOENT 以外の読み込みの失敗の後は読み直せるまで書き込まない（読み直せたら合わせて書き込みを再開する・書き込まないログは 1 回だけ）・不正な要素を捨てる・書き込みの直列化。
- `getLastSession` の IPC: 許可のフォルダと一致するときだけ返す。
- `getAgentSessions` の IPC: snapshot の各要素に Map の `claudeSessionId` を足す、Map に無い要素は外してログを残す。renderer の合わせ込みがタブの `claudeSessionId` を合わせる。
- `historyUtils`: 古い形式（`agent` 無し）を `agent: null` で読む、エージェントのエントリ（正しい形）、`agent` があって `status` が `sent` でない・`sent` なのに `agent` が無い・`agent` の各フィールドが不正なら不正、`sanitize` が `agent` を残し余分なキーを落とす。保存（`history:save`）を通しても `agent` が残る。
- `usePromptRunner`: 送れたときだけ記録する（キャンセル・失敗・例外では記録しない）、記録の中身（全文に参照を含む・`status: 'sent'`・控えた ID とタブ名）、参照の後始末と記録の片方が投げても他方が動く、エージェントのエントリの再実行は今の送り先へ全文を送り、送れたら新しいエントリを足す、従来の方式ではエージェントのエントリを再実行しない、エージェント CLI 方式では従来のエントリ（`agent === null`）を再実行しない（どちらも処理の側の防御。L-058）。
- `useAgentPromptSender`・`useAgentWorkspace`: 送り先の ID は `beginSending` の直前に `describeSession` で控えて `sent` の結果に載る（確認を開いている間にタブを起動し直した場合は、届いた先の ID）。失敗では載らない。`sentTo` が `null` でも `onSent(null)` が呼ばれ、`usePromptRunner` は `markSent` だけ行い記録を省く。`markSent` が投げても記録し、記録が投げても `markSent` は済んでいる。
- `useAgentSessions`: `start(slotId, launch)` が `launch` を渡す、`resume` に `already-running` が返り ID が違えば結果の ID で上書きする、結果の `claudeSessionId` をタブに持ち（`resume` は起動中から）、終了・失敗で `null` に戻す、`resumeInNewTab` が上限・起動を受け付けない間は何もしない。
- `useAgentLastSession`: フォルダの切り替えで取り直す、古い依頼の結果を捨てる、起動の成功で取り直す、取得の失敗は記録なし。`useAgentResume`: 起動の確定の回数が増えたら取り直す（起動の結果より先に終了が届いたときも）、実行中のタブの ID の並びが変わっただけ（終了・タブを閉じた）では取り直さない。
- `agentResumeAvailability`: 各理由の優先順位と文言。
- 画面: `前回の続きから` の表示条件・押せない理由と `aria-describedby`・押すと再開の指定で起動。履歴の一覧の `エージェント（claude 2）`・`送信済み`、詳細のセッション ID・送った全文・2 つのボタンの理由の別々の結び付け、`このセッションで再開` を押すと新しいタブで再開。
- 配線: 本物の hook どうしで「実行 → 送れたら履歴にエージェントのエントリ → 詳細の `このセッションで再開` で `resume` の起動の依頼」を通す結合テスト。`getHistoryActions`・`onResume` の取り違え・渡し忘れで落ちること（L-060）。履歴の詳細の `再実行` の送信が失敗したとき、失敗の文言が見えている実行履歴のパネルに出て（隠れたプロンプトのパネルには出ない）、`role="alert"`・送信の結果の `role="status"` は全体で 1 つずつ・パネルの外にあり、パネルを切り替えても同じ要素のまま（作り直されない）で、見える文字が切り替えた先のパネルに移ること（`App.agentSessionResume.test.tsx`。ローカルレビュー第 16 周で追加、第 17 周で変更）。
- 実物の `claude` での確認（`--session-id` で起動・`--resume` で同じ会話が続く・ID が変わらない）は実機テスト仕様書の項目で行う（L-059）。

## 反映した知見（dev-flow-kit の review-lessons.md）

- L-001: 記録は `sent` のときだけ。記録の書き込みの失敗で起動の成功を偽らない（「履歴への記録」「起動の流れ」4）。
- L-015: `HistoryEntry.agent` を `isValidHistoryEntry`・`sanitizeHistoryEntry` の両方に足し、保存で黙って消えないことをテストする（「構成」main）。
- L-018: main で検証した ID をそのまま引数に使う（「起動の流れ」3）。
- L-019: renderer は列挙型の指定だけを渡し、コマンドと引数は main が決める。再開の ID は main の記録と照合する（「決めたこと」）。
- L-034: UUID v4 の厳密な形式で `-` 始まりの値を断つ（「決めたこと」・parser のテスト）。
- L-037: 送り先の ID は送信の手順を始める時点で控える。「前回」の取得の結果を依頼とフォルダに結び付ける（「履歴への記録」「前回の続きから」）。
- L-040: 「前回」の古い取得結果を捨てる。記録の書き込みを直列にする（「前回の続きから」「起動の流れ」5）。
- L-044: `launch` が無い・未知の `kind` を既定の `new` に流さない。形の不正な `agent` を従来のエントリへ読み替えない（「決めたこと」「起動の流れ」2）。
- L-048: `このセッションで再開` はタブの追加（`+`）の、エージェントのエントリの `再実行` は一覧の `実行` の既存の動作に合わせる（「決めたこと」）。
- L-057: 押せない理由を見える文字で出し `aria-describedby` で結ぶ。main の拒否もタブのエラーとして出す（「前回の続きから」「履歴の画面」「エラーと境界の扱い」）。
- L-058: ボタンは `disabled` 属性で押せなくし、処理の側でも同じ条件で何もしない（「前回の続きから」）。
- L-059: `claude` の `--session-id`・`--resume` の実物の挙動は実機テスト仕様書で確かめる（「既知の制約」「テスト」）。
- L-060: `launch`・`claudeSessionId`・`agent`・新しい props を必須にし、本物の hook どうしの結合テストを書く（「構成」「テスト」）。
- L-061: セッション ID を持つ `claude` を起動する入口を列挙し、二重の起動の拒否を main の 1 か所（判定と同時の同期の予約）に置く（「エラーと境界の扱い」の表〈起動の入口に加え、ID を renderer へ渡す入口として `already-running` と作り直しの後の合わせ込みを含める〉・「起動の流れ」3・4）。
