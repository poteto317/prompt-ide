# エージェント CLI のアプリ内ターミナル実行（MVP） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エディタの領域の下部に xterm.js のターミナルパネルを置き、開いているフォルダで `claude` を node-pty で起動する。プロンプトの `実行` で、起動中の `claude` の入力欄を（書きかけを消してから）本文で上書きして送信する。エージェントがディスクを書き換えても開いているタブが古い内容で上書き保存しないよう、保存の直前の照合・未編集のタブの自動の再読込・編集中のタブへの通知を入れる。従来の API・非対話 CLI の方式は設定で切り替えて並存させる（既定はエージェント CLI 方式）。

**Architecture:** main は `agentShellEnv`（ログインシェルの PATH）→ `agentCommand`（`claude` の絶対パスと環境変数）→ `agentSession`（pty の 1 セッション。pty の生成は注入）→ `agentSessionRegistry`（webContents ごとに 1 つ・起動の重複をまとめる）→ `agentSessionLifecycle`（破棄・リロード・フォルダの切り替え・アプリの終了で止める）と、`agentProcessTree`（子孫を控えてグループへ SIGTERM → 猶予の後に SIGKILL → 生き残った子孫へ SIGKILL）を持つ。IPC は `agentTerminal:*`（`window.api` の許可リスト。`window.electron` は撤去）。外部変更は main の `fileChangeGuard`（保存の直前の照合。SRP の再レビューで `checkedFileWrite` に統合）と `openFileWatcher`（タブの親ディレクトリの非再帰の `fs.watch`）、renderer の `useExternalFileChanges`。renderer は React の外の `agentTerminalController`（xterm を文書ごとに 1 つ持つ）と、画面の行から `claude` の入力欄を判定する純粋関数 `agentInputBox`、送信の手順 `agentPromptSend`（消去 24 バイト × 30ms → 空を 2 回確認 → 貼り付け → 現れたら Enter）、hooks（`useAgentSession`・`useAgentPromptSender`・`useExecutionMode`）、部品（`AgentTerminalPanel`・`ExternalChangeBanner`・`ExecutionModeSection`）で組み立てる。

**Tech Stack:** Electron 39.8.10 / React 19 / TypeScript 5.9 / node-pty 1.1.0 / `@xterm/xterm` 6.0.0・`@xterm/addon-fit` 0.11.0（`@xterm/headless` 6.0.0 はテストだけ）/ electron-builder 26.8.1 / Vitest 4.1.7（jsdom）+ Testing Library

**Spec:** [docs/superpowers/specs/2026-10-04-agent-terminal-mvp-design.md](../specs/2026-10-04-agent-terminal-mvp-design.md)（承認済み）。衝突調査: `.superpowers/agent-terminal-mvp/collision-report.md`

**検証の記録:** プラン作成時に、リポジトリの追跡ファイルを scratchpad の写しへ写し（`node_modules` は APFS の複製。リポジトリの `package.json`・`node_modules` は変えていない）、依存を追加し、このプランのコードをすべて当てて、`npx vitest run` で **376 ファイル・6611 件が成功**（適用前の HEAD は 331 ファイル・6139 件）、`npm run typecheck`・変更した 140 ファイルへの `npx eslint`（指摘 0）・`npx prettier --check` を確認した。各タスクの変異の表は、同じ写しで 1 つずつ入れて「ファイル全体」と `-t` で落ちることを確かめたもの（結果は各表の「確認」の列。Self-Review の末尾に集計）。プランに載せたコードは、その写しのファイルから機械的に埋め込んだ（手で書き写していない）。

---

## 設計書との差異・プラン作成時の確認の結果（実装はこちらに従う）

プランの作成時（2026-10-04）に実測した。設計書の「確認の結果」1〜25 は前提として使い、ここは**その後に分かったこと**と**設計書の記述から変えた点**。各項目に「設計書のどの記述を優先したか」を書く。設計書の本文の書き換えは Task 24 で行う（「確認の結果」26 以降に追記し、本文の該当箇所を直す）。

1. **vitest 4 は `environmentMatchGlobs` を無視し、main のテストも jsdom で走る**（設計書「実装の最初に確かめること」2 は「main の `environment: node`」と書いた）。`vitest.config.ts` の `environmentMatchGlobs: [['src/main/**', 'node']]` は vitest 4.1.7 の dist に存在せず、`src/main/__tests__` のテストで `typeof window === 'object'` だった。`// @vitest-environment node` を付けると `setupFiles` の `Element.prototype.scrollIntoView` が `ReferenceError` になる。**jsdom のままで実物の node-pty の `spawn`・`onData`・`onExit` が動く**ことを確かめた（`/bin/echo` の出力と終了コード 0）。→ 実物の pty のテストは docblock を付けずに書く。vitest の設定は変えない（既存の 331 ファイルの前提を変えないため）
2. **`npm install --save-exact node-pty@1.1.0`（引数つき）はルートの postinstall を走らせない**。その後に引数なしの `npm install` を実行すると `electron-builder install-app-deps` が走り、`node_modules/node-pty/build/Release/{pty.node,spawn-helper}` が実行権限付きで作られた（`@electron/rebuild` が Electron 39.8.10・arm64 でビルド。約 3 秒）。クリーンな写しでの `npm ci` でも同じく作られた。設計書「パッケージング」1 は `npm install` の postinstall に任せると書いた。→ Task 1 で、追加の後に引数なしの `npm install` を実行して `build/Release` を確かめる手順にする
3. **（ユーザーの判断が要る）署名の ID が無いマシンでは、`npm run build:unpack` の成果物が起動しない**。electron-builder 26.8.1 は ID が無いと ad-hoc 署名 + hardened runtime にし、起動すると `dyld: Library not loaded: @rpath/Electron Framework.framework … different Team IDs` で終了した（node-pty とは無関係。node-pty を入れない現在の HEAD でも同じ設定）。`-c.mac.identity=null`（署名しない）で作ると起動し、`ELECTRON_RUN_AS_NODE=1` で `app.asar` の node-pty から pty を起動でき、`spawn-helper` は `app.asar.unpacked` のものが使われた（`asarUnpack` に `node_modules/node-pty/**` を足した設定）。設計書の完了条件 1 は「`npm run build:unpack` の成果物を Finder から起動」。→ このプランは `electron-builder.yml` の署名の設定を変えない（範囲外）。実機の確認（AGT-001）の前提に「署名の ID が無いマシンでは `npm run build && npx electron-builder --dir -c.mac.identity=null` で作る」と書き、既知の制約にも残す。署名の設定を変えるか（例: `mac.identity: null` を既定にする、`build:unpack` に `-c.mac.identity=null` を足す）はユーザーの判断に回す
4. **`claude` の入力欄の記号の後ろの空白は U+00A0（ノーブレークスペース）**（設計書「プロンプトの送信」5・6 は「`❯ `（空白）」と書いた）。`@xterm/headless` で読んだ画面は `❯` + U+00A0 + 本文、シェルのモードは `!` + U+00A0。会話の履歴の行（`❯ hello`）は普通の空白で、罫線の外にある。→ 入力欄の行の判定は「行頭の `❯`・`!` に U+00A0 か空白が続く（または行末）」にする。空の入力欄は `❯`・U+00A0・反転の空白（カーソル）の 3 セル
5. **「実装の最初に確かめること」3 を、偽の Messages API で確かめた**（設計書は「実装の最初に偽の API で確かめる」）。ローカルの HTTP サーバー（`tool_use` を返す・応答を 150ms ごとに流す）を `ANTHROPIC_BASE_URL` にし、`--permission-mode default` で起動した（Anthropic の API には接続していない）。**許可の確認の画面**（`Do you want to proceed?` と ` ❯ 1. Yes` が 2 桁目から。上に `─` の罫線が 1 本だけで、入力欄の「罫線・記号の行・罫線」の並びが無い）では `findInputBox` が null になり、何も送らない。この画面に `Ctrl+K`×12 + `Ctrl+U`×12 と文字を送っても画面は変わらなかった。**応答の表示中・ツールの実行中**（`Bash(sleep 6)` を許可リストで自動許可）に書きかけを入れて消去のキーを 2 回送ると、入力欄は空になり、作業は中断されずに続いた（応答の続きが表示され、ツールは `(No output)` で完了した）。→ 設計書の既知の制約「許可の確認の画面・ツールの実行中・応答の表示中の挙動は未確認」は「許可の確認の画面（選択肢の画面）では送らない・作業中の消去は中断しないことを確認した。文字列を入力できる確認画面（Tab で amend）での挙動は未確認」に直す
6. **「実装の最初に確かめること」6 を確かめた**: Electron 39.8.10 の `file://` のページ（このリポジトリと同じ CSP）で、フォーカスのあるウィンドウの `navigator.clipboard.writeText`・`readText` が既定の権限で成功した（`isSecureContext` は true。フォーカスが無いと `Document is not focused`）。確かめた後にクリップボードを元の内容に戻した。→ preload の `clipboard` は使わない（設計書どおり `navigator.clipboard`）
7. **`claude` の入力欄のカーソルは点滅しない**（50ms ごとに 80 回読んで、反転のセルは毎回あった）。空の判定（反転のセルが記号の直後にある）は点滅で揺れない
8. **貼り付けた本文の先頭の空白は保たれ、タブは空白 4 つ、日本語はそのまま表示された**（`echoIndented`・`echoJapanese` の画面）。→ `isPasteEchoed` は本文の最初の行のタブを空白 4 つにし、全角を 2 桁で数えて先頭（最大 24 桁）を比べる
9. **保存の直前の照合は、ハッシュではなく `savedContent` の文字列を main へ送り、main で文字列として比べる**（設計書「保存の直前の照合」は renderer が Web Crypto の SHA-256 を計算して送ると書いた）。`saveFile` の書き込みの直前に `await crypto.subtle.digest(...)` を挟むと、書き込みの開始が非同期に 1 段遅れ、既存の `useFileEditing.test.ts`・`useFileSystem*.test.ts` の 60 件以上が失敗した（書き込みの同期性を前提にした保存の直列化・ロック待ちのテスト）。文字列を送る形では 186 件がそのまま通る。設計書の意図（ディスクの内容と、タブが最後にディスクと一致した内容を比べる。BOM・CRLF も含めて同じ読み方で比べる）は変えない。IPC で同じ内容を 2 回送る分の大きさは、エディタで開くファイルでは問題にならない
10. **上書きの確認で OK のときは、`fs:writeFile` ではなく `fs:writeFileChecked(path, content, null)`（照合しない書き込み）を使う**（設計書は「OK: 従来の `fs:writeFile` で書き込み」）。既存の `fs:writeFile` は `assertFileAccess`（`realpath`）を通すため、ディスク上で削除されたファイルは `ファイルが見つかりません` で書けず、設計書の `deleted` の確認文（「保存すると、もう一度作成されます」）と矛盾する。`fs:writeFileChecked` は許可の確認に親フォルダへ倒す `assertFileWithinFolder` を使う
11. **停止の手順に「控えた子孫のうち、終了の後も生き残っているものへ SIGKILL」を足す**（設計書「停止の手順」3 は、猶予の間に終わらなかったときだけ子孫へ SIGKILL を送る）。子を片付けずに SIGTERM で終わる偽のエージェント（`/bin/sh`）が `setsid` で起動した孫は、設計書の手順では孤児として残った（結合テストで、この追加を外す変異が落ちることを確かめた）。実物の `claude` は SIGTERM で子を片付けて終わる（確認の結果 9）ので、通常は何も送らない。控えてから送るまでの間（最大で猶予の 3 秒）に pid が再利用されると無関係なプロセスに届きうる（既知の制約に足す）
12. **ツールの引数の `\u` で始まる 4 桁の 16 進のエスケープは、実物の文字に置き換わる**（パターン 135 の 2 の再発。U+00A0・U+200B・U+FEFF で確認。`\x0b`・`\n` は置き換わらない。U+0080 は置き換わらなかった）。→ このプランのコードは `\u` のエスケープを使わず、`'\xa0'`・コードポイントの数（`0x1100`）・`String.fromCharCode(0xfeff)` で書く。実装者もソースに `\u` の 4 桁のエスケープを書かない（`grep -rnP '[\x{00A0}\x{200B}\x{FEFF}\x{0080}-\x{009F}]' src` が 0 件であることを各タスクの確認に入れる）
13. **外部変更の IPC は新しいファイル `handlers/externalChangeHandlers.ts` に置く**（設計書「責務とファイル構成」は `handlers/fileSystemHandlers.ts` の変更と書いた）。`fileSystemHandlers.test.ts` は `fileSystem` を `vi.mock` で部分的に差し替えており、照合のための読み込みと監視の登録を同じファイルに入れると既存のテストのモックを広げる必要がある。振る舞いは設計書どおり
14. **http・https の判定は `src/shared/externalUrl.ts` の 1 か所に置く**（設計書は main の `openExternalLink` と renderer の `linkHandler` の両方でスキームを確かめると書いた。同じ規則を層ごとに書かない。パターン 88）。main の `setWindowOpenHandler`・`shell:openExternalLink` と renderer の xterm の `linkHandler` がこれを使う
15. **`src/main/index.ts` の `before-input-event` は変えない**（設計書「責務とファイル構成」の変更の一覧に「`before-input-event` の調整」があるが、「キーバインドとフォーカス」の節で `Ctrl+R` などは MVP では既知の制約とし、`watchWindowShortcuts` の置き換えは MVP 後と決めている。後者を優先）
16. **設計書に無い文言を 3 つ足す**: 送信中に実行ボタンを押せない理由 `エージェントへ送信しています`（パターン 126。無効のボタンは理由を参照する）、終了の失敗 `エージェントを終了できませんでした: <詳細>`、起動の失敗のうち IPC の例外 `エージェントを起動できませんでした: <詳細>`（`spawn-failed` と同じ文言の形）。帯の状態は `starting` も `起動中` と出す（設計書の 3 つの状態の文言のまま。`起動`・`終了` は starting の間は押せない）
17. **`AgentStartResult` の error に `shellPathUnavailable?: boolean` を足す**（設計書の IPC の表は `{ kind: 'error', error, detail? }`）。`command-not-found` の文言に「PATH の取得に失敗していたら…を添える」（設計書「エラー処理」）ための情報。`detail` に印の文字列を入れるより型で表す
18. **実行方式の切り替えは、エージェントの起動中（starting）は押せない**（設計書に記述なし）。起動の依頼が返る前に従来の方式へ切り替えると、`stop` はまだ sessionId を持たず止められず、従来の方式でセッションが動き続ける。`isExecutionModeLocked` で選択肢を無効にし、`selectExecutionMode` も何もしない
19. **ターミナルパネルの初期の状態は「開いている」**（設計書に記述なし）。開閉・最大化の状態は保存しない（設計書どおり）
20. **既存のテストの付け替え**（設計書の範囲外）: `useFileEditing.test.ts`・`useFileSystem.test.ts`・`useFileSystem.conflict.test.ts`・`useFileSystem.folderOpen.test.ts` は top-level の `beforeEach` の最後に `routeCheckedWritesToWriteFileContent()`（照合付きの保存を従来の `writeFileContent` のモックへ流す共通の補助）を呼ぶ。`usePromptRunner.test.ts` は新しい依存（`executionMode`・`sendToAgent`）を渡す。`useAppState.test.ts` は新しい hooks と `xtermFactory` を差し替え、clone の確認の 1 行の期待を直す。`ipcHandlers.test.ts` は新しい登録を差し替える。`preload/__tests__/api.test.ts` は `ipcRenderer.send` を足す。`__tests__/setup.ts` の `window.api` の stub に新しい API を足し、`getPromptExecutionMode` は `'legacy'` を返す（既存の画面のテストは従来の方式の画面を前提にしている）
21. **変更する既存のファイルの lint の指摘を直す**（変更したファイルに `npx eslint` をかける規約のため）: `cliService.ts`（`settle` の戻り値の型）、`HistoryDetail.tsx`・`HistoryPanel.tsx`・`PromptItem.tsx`・`PromptItemView.tsx`・`PromptVariablesForm.tsx`・`PromptsPanel.tsx`（関数コンポーネントと `handleDragEnd` の戻り値の型）・`SettingsPanel.tsx`、`settingsHandlers.test.ts`（`makeEvent` の戻り値の型）
22. **`claude` の画面の記録**: 設計書「テスト方針」の「今回の実験で記録した画面の行を台帳に残す」を、`claude` 2.1.288 の 28 の画面（空・書きかけ・複数行・`[Pasted text #N]`・シェルのモード・`/` の候補・入力欄が画面を超えた・作業中・送信待ち・信頼の確認・全画面の表示の案内・許可の確認・応答の表示中・ツールの実行中など）を `@xterm/headless` で読んで `.superpowers/agent-terminal-mvp/agent-screens.json`（SHA-256 `95518dc8e65f2deb885a50e323053a65bf5fc0d15e9436b66c897c7893af800d`）に保存した。記録の手順とスクリプトは同じ場所の `agent-screens-recorder/`。Task 13 でテストの台帳（`src/renderer/src/lib/__tests__/fixtures/agentScreens.json`）へ写す
23. **既存の画面の確認文の位置**: 「フォルダを変更」「リポジトリを clone」の終了の確認は、未保存の確認より**先**に出す（エージェントの終了をキャンセルしたら未保存の確認を出さない）。同じフォルダを選び直した場合、main はフォルダの変更を通知しない（`FolderAccessManager.set` が前と同じパスでは通知しない）のでセッションは止まらない（確認は出るが、止まらない。既知の制約に足す）

24. **（実装時の設計変更。Task 13・14）送信の手順は、入力欄が空と判定されても消去を最低 1 回は送ってから、空を確かめて貼り付ける**（このプランの初版と設計書の「プロンプトの送信」6 は「空なら消去を飛ばす」）。画面の属性だけでは、1 文字の書きかけの後ろに dim の候補が出てカーソルを `←` で戻した形と送信待ちの空の入力欄、空白 1 文字の書きかけでカーソルを戻した形と空の入力欄を区別できないことが Task 13 で分かった。消去は空の入力欄に送っても害が無い（確認の結果 15）。Task 14 の `clearInput` とテストの 1 件目は、実装に合わせて直した（設計書は Task 24 で確認の結果 34 と本文を更新した）。これに伴い `clearedDraft` に偽陰性・偽陽性があるため、Task 20 の通知の文言を `エージェントに送信しました（入力欄に書きかけがあったようなので、消してから送りました）` に変えた
25. **（実装時の追加）設計書に無い文言**: `エージェントへ送信できませんでした: <詳細>`（`AGENT_SEND_ERROR_PREFIX`。送信の途中の例外を reject にしない。Task 20）、`保存できませんでした。保存先にリンク先の無いシンボリックリンクがあるか、確認の間にファイルが作成されました。ディスク上の状態を確認してください。`（`SAVE_CONFLICT_OVERWRITE_FAILED_MESSAGE`。Task 17）。`render-process-gone` でもセッションと監視を止める（Task 12）。外部変更の通知は `role="status"` でなく `aria-live="polite"`・`aria-atomic` の常設のコンテナ（Task 23）。テストの台帳（`agentScreens.json`）は個人情報を同じ長さの中立の ASCII に置き換えて写した（SHA-256 `6e9c974e…`。差異 22 の値はリポジトリ外の元の記録のもの。Task 13）。いずれも設計書に Task 24 で反映した

26. **（最終レビューの修正）** ブランチ全体の最終レビュー（`.superpowers/sdd/2026-10-04-agent-terminal-mvp/final-review-A.md`・`final-review-B.md`）の指摘を直した。このプランの Task 7・11 のコード（`did-start-navigation` の条件）と Task 21 のテスト（`fireEvent.click`）・Task 22 の `isLocked` の説明は、次のとおり変わっている:
    - 停止と監視の解除の契機を、`did-start-navigation`（メインフレーム・別文書）から、文書が実際に入れ替わったとき（`did-navigate`、ERR_ABORTED 以外のメインフレームの `did-fail-load`。`mainFrameDocumentReplaced.ts`）に変えた。Electron 39 では `did-start-navigation` が `will-navigate` より先に届き、`will-navigate` で止めた遷移（ファイルのドロップなど）でもエージェントが止まり監視が消えていた。リロードではメニューのショートカットの無視（`setIgnoreMenuShortcuts`）も解除する。`cloneLifecycle.ts` は既存の機能なので変えていない
    - パッケージ版の遷移の許可でホストも比べる。`shell.openExternal` の reject を握り `false` を返す（`openExternalLink`。新しいウィンドウの依頼も同じ関数を使う）。Windows で `kill()` が例外を投げても `taskkill` を送る。使っていない `@electron-toolkit/preload` を依存から外した
    - 保存の照合で上書きをキャンセルしたときは、印を直接付けず外部変更の確認を通す（`ExternalChangeMarks.requestCheck`）。保存できたら印を消す（`onSaveSucceeded`）
    - 従来の方式で実行している間は実行方式を選べず、理由を出す（`executionModeLockedReason`）
    - 外部変更の通知の読み上げのコンテナ（`ExternalChangeAnnouncer`）を、ターミナルの最大化で隠れる `.editor-panel__main` の外に置いた
    - 手動テスト仕様の AGT-047・051・061 を直し、AGT-067〜070 を足した

※ このプランに埋め込んだコードのうち、上の 24・25 で変えたもの以外にも、各 Task のレビューで直した箇所がある（`.superpowers/sdd/2026-10-04-agent-terminal-mvp/` の各報告）。現行のコードはリポジトリのファイルを正とする

設計書の仮定のうち、プラン作成時に実物で確かめてそのまま採用したもの: node-pty 1.1.0 の `pty.kill()`・グループへの SIGTERM で `claude` が子を片付けて終わること（確認の結果 9）、xterm 6 の `Terminal` は jsdom で import・生成できるが `open()` は `matchMedia` が無く失敗すること（controller の境界で偽物を使う。確認の結果 10 と「テスト方針」）、`@xterm/headless` の `isDim()`・`isInverse()` は真偽値ではなく数（0 以外が真）を返すこと、`fs.watch` の親ディレクトリの監視でその場の書き込み・rename・削除が届くこと（結合テスト）。

## 実装の最初に確かめること（設計書の 1〜10 の扱い）

| #   | 設計書の項目                                                          | 扱い                                                                                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | このリポジトリでの postinstall・`npm ci`・`npm run dev`・パッケージ版 | Task 1 で確かめて記録する（差異 2・3 はプラン作成時の結果）。`npm ci` はクリーンな写しで行う。パッケージ版の Finder からの起動は AGT-001（利用者の実機）                                                                                                                                                                                                                       |
| 2   | vitest から実物の node-pty・xterm の import                           | プラン作成時に確認済み（差異 1）。Task 1 の結合テストで固定する                                                                                                                                                                                                                                                                                                                |
| 3   | 許可の確認の画面・ツールの実行中・応答の表示中                        | プラン作成時に確認済み（差異 5）。画面は台帳（`permission`・`streamingDraft`・`toolrunDraft` など）に入れ、Task 13 のテストで固定する                                                                                                                                                                                                                                          |
| 4   | StrictMode で xterm が 1 つ・開閉・最大化の後の fit と resize         | Task 16（controller が 1 回だけ open する・大きさが変わったときだけ resize を送る）と Task 21（StrictMode の二重マウント・表示のたびに fit）の単体テスト。実機は AGT-037                                                                                                                                                                                                       |
| 5   | 再読込の後の Monaco のカーソル・スクロール・undo                      | 実機で確かめる（AGT-027）。jsdom の Monaco のモックでは確かめられない                                                                                                                                                                                                                                                                                                          |
| 6   | `navigator.clipboard`                                                 | プラン作成時に確認済み（差異 6）                                                                                                                                                                                                                                                                                                                                               |
| 7   | Windows・Linux の既定のメニューのショートカット                       | この環境（macOS）では確かめられない。未確認のまま既知の制約に残す（Task 24）                                                                                                                                                                                                                                                                                                   |
| 8   | `/exit`・`Ctrl+D`、ログイン済みの `claude` の起動直後の画面           | 利用者の実機で確かめる（AGT-005・AGT-007）。プランの作成では利用者の設定を書き換えないため確かめていない                                                                                                                                                                                                                                                                       |
| 9   | ログイン済みの環境の空の入力欄の案内の文字（dim か）                  | 利用者の実機で確かめる（AGT-007）。確かめられない・dim でない場合は、`isInputBoxEmpty` が空と判定せず、**消去を繰り返して 3,000ms で `エージェントの入力欄を空にできませんでした…` を出し、貼り付けも Enter も送らない**（設計書どおり、送らない側に倒れる）。その場合は案内の文字を判定に加えるか、カーソルの位置だけで判定するかを設計し直す（設計書の既知の制約に記載済み） |
| 10  | vim の NORMAL・画像の添付（`[Image #N]`）の消去                       | Task 1 の任意の手順（記録のスクリプトで `editorMode: "vim"` の設定の写しを使う）。確かめられなければ既知の制約に残す（設計書の記載のまま）                                                                                                                                                                                                                                     |

## Global Constraints

- 返答・コメント・エラーメッセージ・テスト名・UI の文言は日本語。型だけの import は `import type`。関数には戻り値の型を書く（`@typescript-eslint/explicit-function-return-type` がエラー）。
- 新しい React のコンポーネント（`AgentTerminalPanel.tsx`・`AgentTerminalView.tsx`・`ExternalChangeBanner.tsx`・`ExecutionModeSection.tsx`）の先頭に `'use client'` を置く。既存のコンポーネントには足さない（差分を機能に限る）。
- 見た目はこのリポジトリの暗色固定のテーマ（`src/renderer/src/assets/main.css` の既存の色と、共通の枠付きボタンの規則。32px 以上のタップ領域）に合わせる。CLAUDE.md の Tailwind の `dark:` の規則は、Tailwind を使っていないこのリポジトリでは既存の CSS に従う。
- 選択の状態は `role="radiogroup"`・`role="radio"`・`aria-checked`。無効のボタンの理由は 1 か所に表示し `aria-describedby` で参照する（パターン 126）。`aria-label` は可視の文言で始める（パターン 76。既存の `プロンプトを実行` は従来の方式のまま変えない）。通知は先に在る `role="status"` の要素の文言を変える（`toAnnouncementText`。パターン 87）。消える要素にフォーカスを残さない（パターン 86）。
- `git commit`・`git push`・`git add`・`git stash` は行わない（コミットはユーザーの指示まで保留。各タスクの最後は「確認コマンド」）。ブランチは `feat/agent-terminal-mvp` のまま。`ROADMAP.md` と設計書は未コミットの変更を含むので、`git checkout`・`git restore` で戻さない。
- Copilot へのレビュー依頼・監視は行わない。
- 依存のバージョンは固定する（`--save-exact`）: `node-pty` **1.1.0**（dependencies）、`@xterm/xterm` **6.0.0**・`@xterm/addon-fit` **0.11.0**・`@xterm/headless` **6.0.0**（devDependencies。`@xterm/headless` はテストだけ）。`@xterm/addon-web-links`・`@xterm/addon-clipboard`・`@xterm/addon-webgl`・chokidar は入れない。`@electron-toolkit/preload` は依存から外さない（使わなくなるだけ。依存の整理は範囲外）。※ 最終レビューの修正で外した（差異 26）。
- CSP（`src/renderer/index.html`）・`sandbox: false`・`contextIsolation`（既定の true）は変えない。`claude` の引数は空で固定し、`--dangerously-skip-permissions`・`--permission-mode` を付けない。API キーを pty の環境変数に入れない。
- 自動テストで実物の `claude` を起動しない。`claude` を使う手で行う確認は、隔離した `CLAUDE_CONFIG_DIR`・ダミーの API キー・閉じたローカルのポート（または偽のローカルのサーバー）で行い、確認画面で Enter を送らず、ログインの画面が出たら止める（`.superpowers/agent-terminal-mvp/agent-screens-recorder/README.md`）。起動したプロセスは止めて `pgrep -fl` で確かめる。
- ソースに `\u` の 4 桁のエスケープを書かない（差異 12）。U+00A0 は `'\xa0'`、U+FEFF は `String.fromCharCode(0xfeff)`、範囲はコードポイントの数で書く。各タスクの確認で `grep -rnP '[\x{00A0}\x{200B}\x{FEFF}\x{0080}-\x{009F}]' src` が 0 件であることを見る。
- テストは TDD（失敗するテスト → 実装 → 成功）。変異の手順: `mktemp -d` へ実装のファイルを `cp` で退避 → 変異を入れる → 表のテストのファイル全体と、`-t` の単独の実行の両方で `Tests N failed` が出ることを確かめる → `cp` で復元 → `cmp` で一致を確かめる（`git stash` は使わない。パターン 57・78・130）。`-t` に渡す文字列は表の列をそのまま使う（正規表現として解釈されるため、表の文字列には `(` `)` `+` `.` `*` `?` `[` `]` `|` を入れていない。テストが 1 件も走らずに終わったものを「落ちた」と数えない）。表の `⏎` はソースの改行。置き換えは、失敗が見える Python で行う（BSD の `sed` と zsh の違いを避ける。パターン 116）。例（Task 6 の A1）:

```bash
BK="$(mktemp -d)"; F=src/main/agentSession.ts; cp "$F" "$BK/"
python3 -c "import sys;p,o,n=sys.argv[1:];s=open(p).read();assert s.count(o)==1;open(p,'w').write(s.replace(o,n))" "$F" "reason: this.stopReason ?? 'exited'" "reason: 'exited'"
npx vitest run src/main/__tests__/agentSession.test.ts
npx vitest run src/main/__tests__/agentSession.test.ts -t 'stop は stopTree を 1 回だけ呼び'
cp "$BK/agentSession.ts" "$F"; cmp "$F" "$BK/agentSession.ts" && echo restored
```

- `act(...).then(...)` の形でテストを書かない。モックの実装はテストの中か `beforeEach` で設定し、前のテストの持続する実装に頼らない（1 回だけなら `Once`。パターン 103）。偽のタイマーは `afterEach` の `vi.useRealTimers()` で戻す。テストのタイマー・購読は後始末する（CLAUDE.md）。effect の後に起きるもの（フォーカス・通知）は `waitFor` で待つか、`act` の中で進める（パターン 114）。
- 整形は変更したファイルだけに `npx prettier --write <ファイル…>` をかける（ディレクトリに一括でかけない。パターン 135）。zsh は変数を単語分割しないので、複数のファイルはコマンドに直接並べる（パターン 116）。macOS に `timeout` は無い。長い全体のテストは出力を `grep` で絞る。
- 実機（Electron）の確認の手順はプランに書かない。実機テスト仕様書 `docs/manual-test-spec.md` の新しい領域（接頭辞 `AGT`）を Task 24 で追記し、Artifact（<manual-test-spec-artifact-url>）を同じファイルパス（`.superpowers/manual-test-spec.html`）で再公開する。

### 型・定数・文言（完全一致。Task 間で共有する）

- `src/shared/types/agentTerminal.ts`: `AGENT_TERMINAL_MIN_COLS = 2`・`AGENT_TERMINAL_MAX_COLS = 500`・`AGENT_TERMINAL_MIN_ROWS = 1`・`AGENT_TERMINAL_MAX_ROWS = 300`・`AGENT_WRITE_MAX_LENGTH = 1_000_000`、`AgentTerminalErrorKind = 'no-folder' | 'folder-mismatch' | 'folder-missing' | 'command-not-found' | 'spawn-failed'`、`AgentStartRequest = { folderPath; cols; rows }`、`AgentStartResult = { kind: 'started' | 'already-running'; sessionId } | { kind: 'error'; error; detail?; shellPathUnavailable? }`、`AgentExitReason = 'exited' | 'stopped' | 'folder-changed'`、`AgentSessionData = { sessionId; data }`、`AgentSessionExit = { sessionId; exitCode: number | null; signal: number | null; reason }`、`AgentSessionSnapshot = { sessionId } | null`
- `src/shared/types/settings.ts`: `PROMPT_EXECUTION_MODES = ['agent-cli', 'legacy'] as const`、`PromptExecutionMode`、`DEFAULT_PROMPT_EXECUTION_MODE = 'agent-cli'`、`isPromptExecutionMode(value: unknown): value is PromptExecutionMode`
- `src/shared/types/fileSystem.ts`: `ExternalChangeKind = 'modified' | 'deleted'`、`WriteFileCheckedResult = { kind: 'written' } | { kind: 'conflict'; reason: ExternalChangeKind }`、`ExternalFileChangeEvent = { paths: string[] }`
- `src/shared/agentPasteText.ts`: `AGENT_PROMPT_MAX_LENGTH = 200_000`、`AGENT_CLEAR_INPUT_CHUNK`（`\x0b` × 12 + `\x15` × 12）、`AGENT_SUBMIT_KEY = '\r'`、`normalizeAgentPrompt(raw): NormalizedAgentPrompt`、`buildAgentPasteBytes(text): string`
- 待ち時間（`src/renderer/src/lib/agentPromptSend.ts`）: 消去の間隔 30ms・上限 3,000ms・空の確認の間隔 50ms・現れたかの確認 16ms ごと・上限 1,000ms。停止の猶予 `AGENT_KILL_GRACE_MS = 3_000`、終了を待つ上限 `AGENT_QUIT_TIMEOUT_MS = 4_000`、PATH の取得の打ち切り 5,000ms、監視の間引き 300ms、起動の直後とみなす 2,000ms
- IPC のチャンネル: `agentTerminal:start`・`agentTerminal:stop`・`agentTerminal:getState`（invoke）、`agentTerminal:write`・`agentTerminal:resize`・`agentTerminal:focus`（send）、`agentTerminal:data`・`agentTerminal:exit`（main → renderer）、`fs:writeFileChecked`・`fs:setWatchedFiles`（invoke）、`fs:externalChange`（main → renderer）、`settings:getPromptExecutionMode`・`settings:setPromptExecutionMode`・`shell:openExternalLink`（invoke）
- UI の文言は設計書の「エラー処理」「プロンプトの送信」「保存の直前の照合」「未編集のタブの自動の再読込と、編集中のタブへの通知」「実行方式の切り替え」の表のとおり（コードの定数: `lib/agentSessionMessages.ts`・`lib/agentSendMessages.ts`・`hooks/useFileEditing.ts` の `SAVE_CONFLICT_*`・`hooks/useExternalFileChanges.ts`・`components/editor/ExternalChangeBanner.tsx`・`components/settings/ExecutionModeSection.tsx`）。ボタン: `起動`（`aria-label="起動（開いているフォルダで claude を起動）"`）・`終了`（`aria-label="終了（エージェントを止める）"`）・`最大化`/`元に戻す`（`aria-pressed`）・開閉 `エージェント`（`aria-expanded`・`aria-controls`・`aria-describedby` → `F6 でターミナルから抜けます`）、実行ボタンの `aria-label="実行（エージェントに送信）"`（エージェント CLI 方式）

## File Structure

| ファイル                                                                                                                                                           | 責務                                                                                                                                       | 変更   | Task             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------- |
| `package.json`・`package-lock.json`・`electron-builder.yml`                                                                                                        | 依存の追加（固定）・`asarUnpack`                                                                                                           | Modify | 1                |
| `src/main/__tests__/nodePty.integration.test.ts`                                                                                                                   | 実物の node-pty が vitest（jsdom）から動くこと                                                                                             | Create | 1                |
| `src/shared/types/agentTerminal.ts`・`settings.ts`・`fileSystem.ts`・`types.ts`                                                                                    | IPC の型・上限・実行方式・外部変更の型                                                                                                     | 両方   | 2                |
| `src/shared/agentPasteText.ts`・`src/shared/externalUrl.ts`                                                                                                        | 本文の正規化と送るバイト列・http(s) の判定                                                                                                 | Create | 2                |
| `src/main/cliSearchPaths.ts`・`agentShellEnv.ts`・`cliService.ts`                                                                                                  | 既定の探索先・ログインシェルの PATH                                                                                                        | 両方   | 3                |
| `src/main/agentCommand.ts`                                                                                                                                         | `claude` の絶対パス・環境変数                                                                                                              | Create | 4                |
| `src/main/agentProcessTree.ts`                                                                                                                                     | 子孫の一覧と停止                                                                                                                           | Create | 5                |
| `src/main/agentSession.ts`・`agentSessionRegistry.ts`・`__tests__/helpers/fakePty.ts`                                                                              | 1 セッション・webContents ごとの登録                                                                                                       | Create | 6                |
| `src/main/folderAccessManager.ts`・`agentSessionLifecycle.ts`                                                                                                      | フォルダの変更の通知・停止の契機                                                                                                           | 両方   | 7                |
| `src/main/handlers/agentTerminalPayloadParser.ts`・`agentTerminalHandlers.ts`・`agentRuntime.ts`                                                                   | エージェントの IPC と入力の検証・実物の依存の組み立て                                                                                      | Create | 8                |
| `src/main/navigationPolicy.ts`・`handlers/shellHandlers.ts`・`index.ts`                                                                                            | 遷移・新しいウィンドウ・リンクの制限                                                                                                       | 両方   | 9                |
| `src/main/executionModeStore.ts`・`settingsFileStore.ts`・`handlers/settingsHandlers.ts`                                                                           | 実行方式の保存                                                                                                                             | 両方   | 10               |
| `src/main/fileChangeGuard.ts`・`openFileWatcher.ts`・`openFileWatcherLifecycle.ts`・`handlers/externalChangeHandlers.ts`                                           | 保存の照合・監視・監視の寿命・外部変更の IPC                                                                                               | Create | 11               |
| `src/main/ipcHandlers.ts`・`src/preload/*`・`__tests__/setup.ts`・`lib/agentTerminalApi.ts`・`lib/settingsApi.ts`・`lib/fileSystemApi.ts`                          | main の配線・preload の API・`window.electron` の撤去・renderer の窓口                                                                     | 両方   | 12               |
| `src/renderer/src/lib/agentViewport.ts`・`agentInputBox.ts`・`__tests__/fixtures/*`                                                                                | 画面の行の読み取りと入力欄の判定                                                                                                           | Create | 13               |
| `src/renderer/src/lib/agentPromptSend.ts`                                                                                                                          | 送信の手順                                                                                                                                 | Create | 14               |
| `src/renderer/src/lib/agentTerminalKeys.ts`・`platform.ts`・`hooks/useQuickOpen.ts`                                                                                | キーの振り分け・クイックオープンの除外                                                                                                     | 両方   | 15               |
| `src/renderer/src/lib/agentTerminalController.ts`・`xtermFactory.ts`・`__tests__/makeFakeAgentTerminal.ts`                                                         | xterm を持つ部品                                                                                                                           | Create | 16               |
| `src/renderer/src/hooks/useFileEditing.ts`・`useFileSystem.ts`・`__tests__/routeCheckedWrites.ts`                                                                  | 保存の照合の確認・外部変更の反映の口                                                                                                       | 両方   | 17               |
| `src/renderer/src/hooks/useExternalChangeMarks.ts`・`useExternalFileChanges.ts`・`components/editor/ExternalChangeBanner.tsx`                                      | 外部変更の反映と通知                                                                                                                       | Create | 18               |
| `src/renderer/src/hooks/useAgentSession.ts`・`useAgentTerminalPanel.ts`・`lib/agentSessionMessages.ts`・`__tests__/makeAgentSessionState.ts`                       | セッションの状態・パネルの開閉                                                                                                             | Create | 19               |
| `src/renderer/src/hooks/useAgentPromptSender.ts`・`useExecutionMode.ts`・`usePromptRunner.ts`・`lib/agentSendMessages.ts`                                          | 送信・実行方式・実行の分岐・押せる条件                                                                                                     | 両方   | 20               |
| `src/renderer/src/components/agent/*`・`components/EditorPanel.tsx`                                                                                                | ターミナルパネルと配置                                                                                                                     | 両方   | 21               |
| `components/prompts/*`・`components/history/*`・`components/settings/*`・`components/Sidebar.tsx`・`types.ts`                                                      | 出し分け・無効の理由・実行方式の選択                                                                                                       | 両方   | 22               |
| `src/renderer/src/hooks/useAppState.ts`・`App.tsx`                                                                                                                 | 組み立て・フォルダの切り替えと方式の切り替えの確認                                                                                         | Modify | 23               |
| `src/renderer/src/assets/main.css`                                                                                                                                 | 外部変更の通知・パネル・実行方式・理由の表示                                                                                               | Modify | 18・21・22       |
| `src/main/safeWebContentsSend.ts`・`ownerContextLifecycle.ts`・`checkedFileWrite.ts`・`agentSessionStarter.ts`・`hooks/__tests__/useAppState.agent.test.ts`        | SRP の整理（挙動は変えない）: 安全な送信・所有者の文脈が終わる契機・照合付きの保存・起動の規則と pty の配線・組み立てのテストの分割        | Create | SRP バッチ 1     |
| `src/renderer/src/hooks/useAgentWorkspace.ts`・`lib/promptRunState.ts`・`lib/externalChangeDecision.ts`・`lib/keyedCoalescer.ts`・`lib/agentPendingOutput.ts`      | SRP の整理: 実行方式とエージェントの組み立て・実行ボタンの状態・外部変更の判定・キーごとの合流・起動前の出力の溜め置き（上限の扱いを修正） | Create | SRP バッチ 2     |
| `src/main/fileWithinFolder.ts`・`src/renderer/src/lib/shellApi.ts`・`__tests__/makeAgentWorkspaceState.ts`（`fileChangeGuard.ts` は `checkedFileWrite.ts` へ統合） | SRP の再レビュー（挙動は変えない）: 境界の規則を main 直下へ・リンクの窓口・useAgentWorkspace の偽物。handler は starter を受け取る        | Create | SRP 再レビュー 1 |
| `ROADMAP.md`・`docs/manual-test-spec.md`・設計書                                                                                                                   | 実装済みへの移動・既知の制約・AGT・既存の前提の更新                                                                                        | Modify | 24               |

## 設計書の要件の網羅（要件 → Task）

| 設計書の要件                                                                                                                      | Task                   |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1 ウィンドウに 1 セッション。`claude` を node-pty で起動。作業ディレクトリ = 開いているフォルダ（main が決める）                  | 6・8                   |
| 起動のコマンド・作業ディレクトリ・環境変数は main（引数は空、環境変数の取り除き・`LANG` の補い）                                  | 4・8                   |
| ターミナルパネル（下部・32px の帯・開閉・最大化・起動・終了・状態・45%/160px・閉じても破棄しない・fit）                           | 16・19・21             |
| プロンプトの `実行` → 変数の差し込み後の本文を、入力欄を空にしてから貼り付けて Enter（決定した点 2・3）                           | 2・13・14・20・22・23  |
| セッションが無いときは `実行` を押せず理由を出す（決定した点 1）                                                                  | 20・22・23             |
| 後始末: 終了・リロード・ウィンドウの破棄・フォルダの切り替え・実行方式の切り替え・アプリの終了・子孫                              | 5・6・7・8・23         |
| GUI 起動でも `claude` が見つかる（ログインシェルの PATH・既定の探索先・見つからないときの理由）                                   | 3・4・8・19            |
| 外部変更: 保存の直前の照合と上書きの確認（`modified`・`deleted`）                                                                 | 11・12・17             |
| 外部変更: 未編集のタブの自動の再読込・編集中のタブの印と通知・フォーカスの復帰での再確認（決定した点 4）                          | 11・12・17・18・21・23 |
| ターミナルのフォーカス: `Ctrl+P` の除外・コピー・貼り付け・`F6`・メニューのショートカット・`aria-label`                           | 8・15・16・21          |
| 実行方式の設定（既定 agent-cli・保存の失敗で戻す・読み込み中は押せない）と方式ごとの出し分け                                      | 2・10・12・20・22・23  |
| 履歴の `再実行` はエージェント CLI 方式では押せず理由（決定した点 5）                                                             | 20・22・23             |
| セキュリティ: `window.electron` の撤去・入力の検証・送信元のフレーム・`will-navigate`・`setWindowOpenHandler`・`openExternalLink` | 8・9・12               |
| xterm の出力のエスケープ（DA1 の応答・OSC 8 のリンク・OSC 52/0/2・ベル）                                                          | 16                     |
| node-pty の導入とパッケージング（postinstall・`asarUnpack`・`npmRebuild: false`・各 OS でビルド）                                 | 1                      |
| 衝突調査 C1（実行ボタン）・C2（添付しない）・C3（ツールの選択を隠す）・C13（押せる条件）                                          | 20・22・23             |
| C4（`cliService` は残し探索先だけ共有）・C5〜C7・C9・C15・C16（残す）                                                             | 3（C4）・他は変更なし  |
| C8（出力パネルの代わりにターミナルパネル）・C10（外部変更）・C11（履歴に記録しない・再実行の理由）                                | 21・17・18・20・22     |
| C12（キャンセルはターミナルの Esc）・C14（ステータスバーは変えない）・C21（文書は変えない）                                       | 変更なし（24 で記録）  |
| C17（ライフサイクル）・C18（`useQuickOpen`）・C19（作業ディレクトリ）・C20（ROADMAP）                                             | 7・15・8・24           |
| テスト方針（単体・結合〈実物の pty・`fs.watch`・ログインシェル〉・実物の `claude` は使わない・台帳）                              | 1・3・6・11・13        |
| 手動テスト仕様の `AGT`・既存の PRM/RUN/OUT/APL の前提・ROADMAP・既知の制約（設計書と 1 対 1）                                     | 24                     |

---

### Task 1: スパイク: node-pty・xterm の導入とパッケージング

**Files:**

- Modify: `package.json`・`package-lock.json`（`npm install` が書き換える）、`electron-builder.yml`
- Create: `src/main/__tests__/nodePty.integration.test.ts`、`.superpowers/agent-terminal-mvp/spike-results.md`（git 管理外の記録。Task 24 で設計書の「確認の結果」へ移す）

**Interfaces:**

- Consumes: なし
- Produces: 依存 `node-pty@1.1.0`（dependencies）・`@xterm/xterm@6.0.0`・`@xterm/addon-fit@0.11.0`・`@xterm/headless@6.0.0`（devDependencies）。`node_modules/node-pty/build/Release/{pty.node,spawn-helper}`（実行権限付き）。以降のタスクは `import { spawn } from 'node-pty'`・`import { Terminal } from '@xterm/xterm'`・`import { FitAddon } from '@xterm/addon-fit'`・`import { Terminal } from '@xterm/headless'`（テストだけ）を使う
- 注: 差異 1〜3。署名の ID が無いマシンでは `npm run build:unpack` の成果物が起動しない（node-pty と無関係）ため、パッケージ版の確認は `-c.mac.identity=null` で作る

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/nodePty.integration.test.ts`（新規）:

```ts
import { describe, it, expect } from 'vitest'
import { spawn } from 'node-pty'

// 実物の node-pty が vitest(main のテストも jsdom の環境で走る)から読み込めて、pty で起動・出力・終了を受け取れること。
// postinstall(electron-builder install-app-deps)で build/Release の pty.node と spawn-helper(実行権限付き)が作られている前提。
// 失敗したら `ls -l node_modules/node-pty/build/Release` と `npm install`(引数なし)を確かめる(Task 1)
describe.skipIf(process.platform === 'win32')('node-pty(実物)', () => {
  it('pty で /bin/echo を起動し、出力と終了コード 0 を受け取る', async () => {
    const pty = spawn('/bin/echo', ['hello-pty'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: '/',
      env: { PATH: '/usr/bin:/bin' }
    })
    let output = ''
    pty.onData((data) => {
      output += data
    })
    const exitCode = await new Promise<number>((resolve) =>
      pty.onExit(({ exitCode }) => resolve(exitCode))
    )
    expect(output).toContain('hello-pty')
    expect(exitCode).toBe(0)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/main/__tests__/nodePty.integration.test.ts
```

Expected: FAIL（`Failed to load url node-pty` または `Cannot find package 'node-pty'`。依存が無い）

- [ ] **Step 3: 依存を追加し、postinstall でビルドする**

```bash
npm install --save-exact node-pty@1.1.0
npm install --save-exact --save-dev @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0 @xterm/headless@6.0.0
# 引数つきの npm install はルートの postinstall を走らせない(差異 2)。引数なしでもう一度実行して install-app-deps を走らせる
npm install
ls -l node_modules/node-pty/build/Release/pty.node node_modules/node-pty/build/Release/spawn-helper
git diff package.json
```

Expected: `npm install`（引数なし）の出力に `> electron-builder install-app-deps` と `finished moduleName=node-pty`。`ls` で 2 つのファイルが `-rwxr-xr-x`。`git diff package.json` は dependencies に `"node-pty": "1.1.0",`、devDependencies に `"@xterm/addon-fit": "0.11.0",`・`"@xterm/headless": "6.0.0",`・`"@xterm/xterm": "6.0.0",` の 4 行の追加だけ（`^` が付いていない）

`electron-builder.yml` の `asarUnpack` に 1 行足す（実測では明示しなくても展開されたが、electron-builder の自動の判定に依らず意図を残す。設計書「パッケージング」2）:

```diff
 asarUnpack:
   - resources/**
+  - node_modules/node-pty/**
```

`npmRebuild: false` は変えない（設計書「パッケージング」3）。

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/main/__tests__/nodePty.integration.test.ts
npm run typecheck
npx eslint src/main/__tests__/nodePty.integration.test.ts
npx prettier --check src/main/__tests__/nodePty.integration.test.ts electron-builder.yml
```

Expected: PASS（1 件）。typecheck・eslint・prettier が通る

- [ ] **Step 5: Electron の node から pty を起動できることを確かめる（設計書「実装の最初に確かめること」1）**

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "const p=require('node-pty').spawn('/bin/echo',['electron-pty-ok'],{cols:80,rows:24,cwd:'/',env:{PATH:'/usr/bin:/bin'}});let o='';p.onData(d=>o+=d);p.onExit(e=>{console.log(JSON.stringify(o.trim()),e.exitCode);process.exit(0)})"
```

Expected: `"electron-pty-ok" 0`

- [ ] **Step 6: クリーンな状態からの `npm ci` で build/Release が作られることを確かめる**

```bash
T="$(mktemp -d)"
git ls-files -z | rsync -a --from0 --files-from=- ./ "$T/"
cp package.json package-lock.json "$T/"
(cd "$T" && npm ci > npm-ci.log 2>&1; tail -5 npm-ci.log; ls -l node_modules/node-pty/build/Release/spawn-helper)
rm -rf "$T"
```

Expected: `npm ci` が成功し、`spawn-helper` が `-rwxr-xr-x`。Electron の本体のダウンロードはキャッシュ（`~/Library/Caches/electron`）から行われる

- [ ] **Step 7: パッケージ版で pty を起動できることを確かめる（設計書「実装の最初に確かめること」1。差異 3）**

```bash
npm run build
npx electron-builder --dir -c.mac.identity=null
A="dist/mac-$(uname -m)/prompt-ide.app/Contents"
ls -l "$A/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/"
ELECTRON_RUN_AS_NODE=1 "$A/MacOS/prompt-ide" -e "const p=require(process.argv[1]+'/node_modules/node-pty').spawn('/bin/echo',['packaged-pty-ok'],{cols:80,rows:24,cwd:'/',env:{PATH:'/usr/bin:/bin'}});let o='';p.onData(d=>o+=d);p.onExit(e=>{console.log(JSON.stringify(o.trim()),e.exitCode);process.exit(0)})" "$PWD/$A/Resources/app.asar"
pgrep -fl "dist/mac-.*/prompt-ide" || echo "no leftover"
```

Expected: `app.asar.unpacked` に `pty.node` と `spawn-helper`（`-rwxr-xr-x`）。`"packaged-pty-ok" 0`（`node-pty` は `app.asar` から読まれ、`spawn-helper` は `app.asar.unpacked` から使われる。`require` に渡すパスは絶対パスにする）。最後に `no leftover`。`-c.mac.identity=null` を付けずに作った（ad-hoc 署名の）成果物は `dyld … different Team IDs` で起動しない（差異 3。ユーザーの判断に回す事項）

- [ ] **Step 8:（任意）vim の NORMAL・画像の添付の消去を確かめる（設計書「実装の最初に確かめること」10）**

`.superpowers/agent-terminal-mvp/agent-screens-recorder/README.md` の安全のための条件と手順で、設定の写しに `"editorMode": "vim"` を足して `rec.js` の場面（書きかけ → `Esc` で NORMAL → `AGENT_CLEAR_INPUT_CHUNK` を 30ms ごとに送る）を作って確かめる。確かめられない・時間がかかる場合は行わない（設計書の既知の制約のまま）。起動したプロセスは `pgrep -fl "local/bin/claude"` で残っていないことを確かめる

- [ ] **Step 9: 結果を記録する**

`.superpowers/agent-terminal-mvp/spike-results.md`（git 管理外）に、Step 3・5・6・7・8 のコマンドと出力の要点（版・成否・ファイルの権限）を書く。Task 24 で設計書の「確認の結果」へ移す

- [ ] **Step 10: 確認コマンド（コミットしない）**

```bash
git status --short
```

Expected: `M electron-builder.yml`・`M package.json`・`M package-lock.json`・`?? src/main/__tests__/nodePty.integration.test.ts` が増えている（`ROADMAP.md`・設計書・`.superpowers/` は作業前から未コミット）。`dist/`・`out/` は git 管理外

---

### Task 2: shared: エージェントの型・実行方式の型・外部変更の型・本文の正規化・http(s) の判定

**Files:**

- Create: `src/shared/types/agentTerminal.ts`、`src/shared/agentPasteText.ts`、`src/shared/externalUrl.ts`、`src/shared/__tests__/agentPasteText.test.ts`、`src/shared/__tests__/externalUrl.test.ts`、`src/shared/__tests__/promptExecutionMode.test.ts`
- Modify: `src/shared/types/settings.ts`、`src/shared/types/fileSystem.ts`、`src/shared/types.ts`

**Interfaces:**

- Consumes: なし
- Produces: Global Constraints の「型・定数・文言」の shared の型と定数すべて。`normalizeAgentPrompt(raw: string): NormalizedAgentPrompt`（`{ kind: 'ok'; text } | { kind: 'rejected'; reason: 'empty' | 'too-long' | 'leading-bang' }`。型 `AgentPromptRejection`）、`buildAgentPasteBytes(text: string): string`、`AGENT_CLEAR_INPUT_CHUNK`・`AGENT_SUBMIT_KEY`・`AGENT_PROMPT_MAX_LENGTH`、`isExternalHttpUrl(value: string): boolean`、`isPromptExecutionMode(value: unknown): value is PromptExecutionMode`。`@shared/types` から型（`export type *`）と値（`PROMPT_EXECUTION_MODES`・`DEFAULT_PROMPT_EXECUTION_MODE`・`isPromptExecutionMode`・`AGENT_TERMINAL_*`・`AGENT_WRITE_MAX_LENGTH`）を読める

- [ ] **Step 1: 失敗するテストを書く**

`src/shared/__tests__/agentPasteText.test.ts`（新規）:

```ts
import { describe, it, expect } from 'vitest'
import {
  AGENT_CLEAR_INPUT_CHUNK,
  AGENT_PROMPT_MAX_LENGTH,
  AGENT_SUBMIT_KEY,
  buildAgentPasteBytes,
  normalizeAgentPrompt
} from '../agentPasteText'

describe('normalizeAgentPrompt', () => {
  it.each([
    ['\\r\\n を \\n にする', 'a\r\nb', 'a\nb'],
    ['単独の \\r を \\n にする', 'a\rb', 'a\nb'],
    ['\\n と \\t は残す', 'a\n\tb', 'a\n\tb'],
    ['ESC を取り除く(ESC[201~ の囲みの終わりを無効にする)', 'a\x1b[201~\rb', 'a[201~\nb'],
    ['C0 制御文字を取り除く', 'a\x00\x07\x08\x0b\x0c\x1fb', 'ab'],
    ['DEL を取り除く', 'a\x7fb', 'ab'],
    ['C1 制御文字(U+0080〜U+009F)を取り除く', 'a\x80\x9bb\x9f', 'ab'],
    ['U+00A0 は残す(C1 の範囲の外)', 'a\xa0b', 'a\xa0b'],
    ['日本語とサロゲートペアは残す', '日本語😀', '日本語😀'],
    ['先頭が空白の「!」は通す', ' !echo', ' !echo'],
    ['先頭が改行の「!」は通す', '\n!echo', '\n!echo'],
    ['先頭が「/」は通す', '/help', '/help']
  ])('%s', (_label, raw, expected) => {
    expect(normalizeAgentPrompt(raw)).toEqual({ kind: 'ok', text: expected })
  })

  it.each([
    ['空文字列', ''],
    ['空白と改行だけ', ' \n\t\r\n '],
    ['制御文字を除くと空白だけ', '\x1b\x07 ']
  ])('%s は empty で拒否する', (_label, raw) => {
    expect(normalizeAgentPrompt(raw)).toEqual({ kind: 'rejected', reason: 'empty' })
  })

  it('上限ちょうどは通し、1 文字超えると too-long で拒否する', () => {
    expect(normalizeAgentPrompt('a'.repeat(AGENT_PROMPT_MAX_LENGTH)).kind).toBe('ok')
    expect(normalizeAgentPrompt('a'.repeat(AGENT_PROMPT_MAX_LENGTH + 1))).toEqual({
      kind: 'rejected',
      reason: 'too-long'
    })
  })

  it('上限は正規化の後の長さで数える(\\r\\n は 1 文字になる)', () => {
    const raw = 'a'.repeat(AGENT_PROMPT_MAX_LENGTH - 1) + '\r\n'
    expect(normalizeAgentPrompt(raw).kind).toBe('ok')
  })

  it('1 文字目が「!」なら leading-bang で拒否する', () => {
    expect(normalizeAgentPrompt('!echo hi')).toEqual({ kind: 'rejected', reason: 'leading-bang' })
  })

  it('制御文字を除いた後の 1 文字目が「!」でも拒否する', () => {
    expect(normalizeAgentPrompt('\x1b!rm')).toEqual({ kind: 'rejected', reason: 'leading-bang' })
  })
})

describe('buildAgentPasteBytes', () => {
  it('本文を ESC[200~ と ESC[201~ で囲む', () => {
    expect(buildAgentPasteBytes('a\nb')).toBe('\x1b[200~a\nb\x1b[201~')
  })
})

describe('送るキーの定数', () => {
  it('消去は Ctrl+K × 12 + Ctrl+U × 12 の 24 バイト', () => {
    expect(AGENT_CLEAR_INPUT_CHUNK).toBe('\x0b'.repeat(12) + '\x15'.repeat(12))
    expect(AGENT_CLEAR_INPUT_CHUNK).toHaveLength(24)
  })

  it('送信は \\r', () => {
    expect(AGENT_SUBMIT_KEY).toBe('\r')
  })
})
```

`src/shared/__tests__/externalUrl.test.ts`（新規）:

```ts
import { describe, it, expect } from 'vitest'
import { isExternalHttpUrl } from '../externalUrl'

describe('isExternalHttpUrl', () => {
  it.each([
    ['https://example.com/a', true],
    ['http://localhost:3000', true],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['vscode://open', false],
    ['mailto:a@example.com', false],
    ['not a url', false]
  ])('%s → %s', (url, expected) => {
    expect(isExternalHttpUrl(url)).toBe(expected)
  })
})
```

`src/shared/__tests__/promptExecutionMode.test.ts`（新規）:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_PROMPT_EXECUTION_MODE, isPromptExecutionMode } from '../types/settings'

describe('isPromptExecutionMode', () => {
  it.each([
    ['agent-cli', true],
    ['legacy', true],
    ['', false],
    ['Legacy', false],
    [null, false],
    [1, false]
  ])('%s → %s', (value, expected) => {
    expect(isPromptExecutionMode(value)).toBe(expected)
  })

  it('既定はエージェント CLI 方式', () => {
    expect(DEFAULT_PROMPT_EXECUTION_MODE).toBe('agent-cli')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/shared/__tests__/agentPasteText.test.ts src/shared/__tests__/externalUrl.test.ts src/shared/__tests__/promptExecutionMode.test.ts
```

Expected: FAIL（3 ファイルとも、モジュール・export が無い）

- [ ] **Step 3: 実装する**

`src/shared/types/agentTerminal.ts`（新規）:

```ts
// エージェント CLI(claude)のセッションの IPC の型と上限。main・preload・renderer が共有する

/** 桁数・行数の範囲(main の入力検証と renderer の fit の結果の丸めで使う) */
export const AGENT_TERMINAL_MIN_COLS = 2
export const AGENT_TERMINAL_MAX_COLS = 500
export const AGENT_TERMINAL_MIN_ROWS = 1
export const AGENT_TERMINAL_MAX_ROWS = 300
/** 1 回の書き込みの上限(UTF-16 の単位)。貼り付けの本文の上限(20 万文字)と囲みを収める */
export const AGENT_WRITE_MAX_LENGTH = 1_000_000

export type AgentTerminalErrorKind =
  | 'no-folder'
  | 'folder-mismatch'
  | 'folder-missing'
  | 'command-not-found'
  | 'spawn-failed'

export interface AgentStartRequest {
  /** renderer が表示しているフォルダ。main は許可のフォルダと一致するかだけを確かめる(作業ディレクトリには使わない) */
  folderPath: string
  cols: number
  rows: number
}

export type AgentStartResult =
  | { kind: 'started' | 'already-running'; sessionId: string }
  | {
      kind: 'error'
      error: AgentTerminalErrorKind
      /** folder-missing はフォルダのパス、spawn-failed は例外の文言 */
      detail?: string
      /** command-not-found のとき、ログインシェルから PATH を取得できず既定の場所だけを探したか */
      shellPathUnavailable?: boolean
    }

/** exited: エージェント自身の終了。stopped: 終了ボタン・実行方式の切り替え・リロード・ウィンドウの破棄。folder-changed: フォルダの切り替え */
export type AgentExitReason = 'exited' | 'stopped' | 'folder-changed'

export interface AgentSessionData {
  sessionId: string
  data: string
}

export interface AgentSessionExit {
  sessionId: string
  /** node-pty の終了コード。不明なら null */
  exitCode: number | null
  /** 終了させたシグナルの番号。無ければ null */
  signal: number | null
  reason: AgentExitReason
}

/** 現在のセッション(getAgentSession の戻り値)。無ければ null */
export type AgentSessionSnapshot = { sessionId: string } | null
```

`src/shared/types/settings.ts`・`src/shared/types/fileSystem.ts`・`src/shared/types.ts`（差分）:

```diff
--- a/src/shared/types/settings.ts
+++ b/src/shared/types/settings.ts
@@ -22,3 +22,12 @@
   modelId: 'claude-haiku-4-5',
   maxTokens: 4096
 }
+
+/** プロンプトの実行方式。agent-cli: アプリ内のターミナルの claude へ送る。legacy: Claude API・非対話の CLI(従来の方式) */
+export const PROMPT_EXECUTION_MODES = ['agent-cli', 'legacy'] as const
+export type PromptExecutionMode = (typeof PROMPT_EXECUTION_MODES)[number]
+export const DEFAULT_PROMPT_EXECUTION_MODE: PromptExecutionMode = 'agent-cli'
+
+export function isPromptExecutionMode(value: unknown): value is PromptExecutionMode {
+  return typeof value === 'string' && (PROMPT_EXECUTION_MODES as readonly string[]).includes(value)
+}
```

```diff
--- a/src/shared/types/fileSystem.ts
+++ b/src/shared/types/fileSystem.ts
@@ -4,3 +4,16 @@
   type: 'file' | 'directory'
   children?: FileTreeNode[]
 }
+
+/** ディスク上の外部変更の種類(保存の直前の照合・監視の通知の結果) */
+export type ExternalChangeKind = 'modified' | 'deleted'
+
+/** fs:writeFileChecked の結果。照合が一致すれば書き込み、違えば書き込まずに理由を返す */
+export type WriteFileCheckedResult =
+  | { kind: 'written' }
+  | { kind: 'conflict'; reason: ExternalChangeKind }
+
+/** fs:externalChange の通知。変わった可能性のある、開いているタブのパス */
+export interface ExternalFileChangeEvent {
+  paths: string[]
+}
```

```diff
--- a/src/shared/types.ts
+++ b/src/shared/types.ts
@@ -5,7 +5,21 @@
 export type * from './types/cli'
 export type * from './types/history'
 export type * from './types/settings'
+export type * from './types/agentTerminal'
 export { PROMPT_EXPORT_KIND } from './types/prompt'
 export { EXECUTION_TOOLS, CLI_ONLY_TOOL_IDS } from './types/cli'
-export { AVAILABLE_MODELS, DEFAULT_MODEL_SETTINGS } from './types/settings'
+export {
+  AVAILABLE_MODELS,
+  DEFAULT_MODEL_SETTINGS,
+  PROMPT_EXECUTION_MODES,
+  DEFAULT_PROMPT_EXECUTION_MODE,
+  isPromptExecutionMode
+} from './types/settings'
+export {
+  AGENT_TERMINAL_MIN_COLS,
+  AGENT_TERMINAL_MAX_COLS,
+  AGENT_TERMINAL_MIN_ROWS,
+  AGENT_TERMINAL_MAX_ROWS,
+  AGENT_WRITE_MAX_LENGTH
+} from './types/agentTerminal'
 export { CONFLICT_CHOICES, TAG_KINDS } from './types/git'
```

`src/shared/agentPasteText.ts`（新規）:

```ts
// claude の入力欄へ送る本文の正規化と、送るバイト列(設計書「プロンプトの送信」3・7・9)。純粋関数と定数

/** 送る本文の上限(正規化の後の UTF-16 の単位) */
export const AGENT_PROMPT_MAX_LENGTH = 200_000

/** 入力欄を空にする 1 回の書き込み: Ctrl+K × 12 + Ctrl+U × 12(24 バイト)。64 バイト以上をまとめて送ると効かない(確認の結果 18) */
export const AGENT_CLEAR_INPUT_CHUNK = '\x0b'.repeat(12) + '\x15'.repeat(12)

/** 貼り付けた本文を送信する Enter */
export const AGENT_SUBMIT_KEY = '\r'

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

export type AgentPromptRejection = 'empty' | 'too-long' | 'leading-bang'

export type NormalizedAgentPrompt =
  | { kind: 'ok'; text: string }
  | { kind: 'rejected'; reason: AgentPromptRejection }

// 改行(\n)とタブ(\t)以外の C0 制御文字(ESC を含む)・DEL・C1 制御文字。本文の ESC[201~ で貼り付けが終わり、
// 残りがキー入力(\r で送信など)として解釈されるのを防ぐ
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/**
 * 本文を正規化する。\r\n・\r を \n に統一し、制御文字を取り除く。前後の空白だけ・上限を超える・1 文字目が「!」なら拒否する
 * (「!」で始まる本文は claude のシェルのモードに入り、Enter でシェルのコマンドとして実行される。確認の結果 23)
 */
export function normalizeAgentPrompt(raw: string): NormalizedAgentPrompt {
  const text = raw.replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '')
  if (text.trim() === '') return { kind: 'rejected', reason: 'empty' }
  if (text.length > AGENT_PROMPT_MAX_LENGTH) return { kind: 'rejected', reason: 'too-long' }
  if (text.startsWith('!')) return { kind: 'rejected', reason: 'leading-bang' }
  return { kind: 'ok', text }
}

/** bracketed paste で囲んだ貼り付けのバイト列(正規化した本文を渡す) */
export function buildAgentPasteBytes(text: string): string {
  return PASTE_START + text + PASTE_END
}
```

`src/shared/externalUrl.ts`（新規）:

```ts
// 既定のブラウザで開いてよい URL の規則(http・https だけ)。main の新しいウィンドウ・リンクの IPC と、renderer のターミナルの
// リンクが共有する(同じ規則を層ごとに書かない。パターン 88)
export function isExternalHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/shared/__tests__/agentPasteText.test.ts src/shared/__tests__/externalUrl.test.ts src/shared/__tests__/promptExecutionMode.test.ts
npm run typecheck
npx eslint src/shared/agentPasteText.ts src/shared/externalUrl.ts src/shared/types/agentTerminal.ts src/shared/types/settings.ts src/shared/types/fileSystem.ts src/shared/types.ts src/shared/__tests__/agentPasteText.test.ts src/shared/__tests__/externalUrl.test.ts src/shared/__tests__/promptExecutionMode.test.ts
npx prettier --check src/shared/agentPasteText.ts src/shared/externalUrl.ts src/shared/types/agentTerminal.ts src/shared/types/settings.ts src/shared/types/fileSystem.ts src/shared/types.ts src/shared/__tests__/agentPasteText.test.ts src/shared/__tests__/externalUrl.test.ts src/shared/__tests__/promptExecutionMode.test.ts
grep -rnP '[\x{00A0}\x{200B}\x{FEFF}\x{0080}-\x{009F}]' src || echo "no invisible chars"
```

Expected: PASS（3 ファイル・22 + 7 + 7 件）。`no invisible chars`

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                      | テストのファイル         | `-t`                            | 確認           |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------- | -------------- |
| S1  | `agentPasteText.ts` の `/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g` を `/[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f-\x9f]/g` にする           | `agentPasteText.test.ts` | `ESC を取り除く`                | 落ちた（1 件） |
| S2  | `agentPasteText.ts` の `if (text.startsWith('!'))` を `if (raw.startsWith('!'))` にする                                   | `agentPasteText.test.ts` | `制御文字を除いた後の 1 文字目` | 落ちた（1 件） |
| S3  | `agentPasteText.ts` の `if (text.length > AGENT_PROMPT_MAX_LENGTH)` を `if (raw.length > AGENT_PROMPT_MAX_LENGTH)` にする | `agentPasteText.test.ts` | `正規化の後の長さで数える`      | 落ちた（1 件） |
| S4  | `agentPasteText.ts` の `.replace(/\r\n?/g, '\n')` を `.replace(/\r\n/g, '\n')` にする                                     | `agentPasteText.test.ts` | `単独の`                        | 落ちた（1 件） |
| S5  | `externalUrl.ts` の `return protocol === 'http:' \|\| protocol === 'https:'` を `return protocol === 'https:'` にする     | `externalUrl.test.ts`    | `localhost`                     | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/shared
```

---

### Task 3: main: PATH の継承（既定の探索先の共有・ログインシェルの PATH）

**Files:**

- Create: `src/main/cliSearchPaths.ts`、`src/main/agentShellEnv.ts`、`src/main/__tests__/agentShellEnv.test.ts`、`src/main/__tests__/agentShellEnv.integration.test.ts`
- Modify: `src/main/cliService.ts:28-43`（`buildEnv` の探索先を `cliSearchPaths` から読む。挙動は変えない。C4）・`:64`（既存の lint の指摘: `settle` の戻り値の型。差異 21）

**Interfaces:**

- Consumes: なし
- Produces: `getCliSearchPaths(home: string | undefined): string[]`、`appendSearchPaths(basePath: string | undefined, extra: readonly string[]): string`、`LOGIN_SHELL_PATH_TIMEOUT_MS = 5_000`・`PATH_MARKER_START`・`PATH_MARKER_END`、`type ShellSpawn = (command, args, options: SpawnOptions) => ChildProcess`、`resolveLoginShell(env, userShell): string`、`extractMarkedPath(output: string): string | null`、`readLoginShellPath(options?: { spawn?; env?; userShell?; timeoutMs?; platform?; kill? }): Promise<string | null>`（Windows は常に null）
- 注: 既存の `src/main/__tests__/cliService.test.ts`（38 件）が `buildEnv` の挙動（探索先・`PATH` が無いときに先頭に `:` を付けない・win32 はそのまま）を固定している。変更せずに通ること

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentShellEnv.test.ts`（新規。偽の子プロセスで、起動の引数・印の取り出し・打ち切り・失敗を固定する）:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import {
  PATH_MARKER_END,
  PATH_MARKER_START,
  extractMarkedPath,
  readLoginShellPath,
  resolveLoginShell
} from '../agentShellEnv'
import type { ShellSpawn } from '../agentShellEnv'

// 偽の子プロセス(標準出力と close・error を手で起こす)
function makeFakeChild(pid = 4321): ChildProcess & { stdout: PassThrough } {
  const child = new EventEmitter() as ChildProcess & { stdout: PassThrough }
  Object.assign(child, { pid, stdout: new PassThrough() })
  return child
}

afterEach(() => {
  vi.useRealTimers()
})

describe('resolveLoginShell', () => {
  it('SHELL を優先する', () => {
    expect(resolveLoginShell({ SHELL: '/bin/zsh' }, '/bin/bash')).toBe('/bin/zsh')
  })
  it('SHELL が無ければ利用者の既定のシェル', () => {
    expect(resolveLoginShell({}, '/bin/bash')).toBe('/bin/bash')
  })
  it('どちらも無ければ /bin/sh', () => {
    expect(resolveLoginShell({}, null)).toBe('/bin/sh')
    expect(resolveLoginShell({ SHELL: '' }, '')).toBe('/bin/sh')
  })
})

describe('extractMarkedPath', () => {
  it('印の間を取り出す(前後のシェルの初期化の出力は捨てる)', () => {
    expect(extractMarkedPath(`motd\n${PATH_MARKER_START}/a:/b${PATH_MARKER_END}\nbye`)).toBe(
      '/a:/b'
    )
  })
  it.each([
    ['印が無い', '/a:/b'],
    ['終わりの印が無い', `${PATH_MARKER_START}/a`],
    ['中身が空白だけ', `${PATH_MARKER_START}  ${PATH_MARKER_END}`]
  ])('%s なら null', (_label, output) => {
    expect(extractMarkedPath(output)).toBeNull()
  })
})

describe('readLoginShellPath', () => {
  it('ログインシェルを -l -i -c で、標準入力なし・新しいプロセスグループで起動し、印の間を返す', async () => {
    const child = makeFakeChild()
    const spawn = vi.fn<ShellSpawn>().mockReturnValueOnce(child)
    const promise = readLoginShellPath({ spawn, env: { SHELL: '/bin/zsh' }, platform: 'darwin' })
    child.stdout.write(`noise${PATH_MARKER_START}/x/bin:/usr/bin${PATH_MARKER_END}`)
    child.emit('close', 0)
    await expect(promise).resolves.toBe('/x/bin:/usr/bin')
    const [command, args, options] = spawn.mock.calls[0]
    expect(command).toBe('/bin/zsh')
    expect(args.slice(0, 3)).toEqual(['-l', '-i', '-c'])
    expect(args[3]).toContain('"$PATH"')
    expect(options).toMatchObject({ stdio: ['ignore', 'pipe', 'ignore'], detached: true })
  })

  it('起動に失敗したら(error)null', async () => {
    const child = makeFakeChild()
    const spawn = vi.fn<ShellSpawn>().mockReturnValueOnce(child)
    const promise = readLoginShellPath({ spawn, env: {}, platform: 'darwin' })
    child.emit('error', new Error('ENOENT'))
    await expect(promise).resolves.toBeNull()
  })

  it('spawn が例外を投げたら null', async () => {
    const spawn = vi.fn<ShellSpawn>().mockImplementationOnce(() => {
      throw new Error('EAGAIN')
    })
    await expect(readLoginShellPath({ spawn, env: {}, platform: 'darwin' })).resolves.toBeNull()
  })

  it('打ち切りの時間を過ぎたらプロセスグループに SIGKILL を送って null', async () => {
    vi.useFakeTimers()
    const child = makeFakeChild(777)
    const spawn = vi.fn<ShellSpawn>().mockReturnValueOnce(child)
    const kill = vi.fn()
    const promise = readLoginShellPath({
      spawn,
      env: {},
      platform: 'darwin',
      timeoutMs: 5000,
      kill
    })
    await vi.advanceTimersByTimeAsync(4999)
    expect(kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(promise).resolves.toBeNull()
    expect(kill).toHaveBeenCalledWith(-777, 'SIGKILL')
  })

  it('打ち切りのシグナルが例外を投げても null で解決する(EPERM を握る)', async () => {
    vi.useFakeTimers()
    const child = makeFakeChild(778)
    const spawn = vi.fn<ShellSpawn>().mockReturnValueOnce(child)
    const kill = vi.fn(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    })
    const promise = readLoginShellPath({ spawn, env: {}, platform: 'darwin', timeoutMs: 10, kill })
    await vi.advanceTimersByTimeAsync(10)
    await expect(promise).resolves.toBeNull()
  })

  it('close の後に打ち切りのタイマーを残さない', async () => {
    vi.useFakeTimers()
    const child = makeFakeChild()
    const spawn = vi.fn<ShellSpawn>().mockReturnValueOnce(child)
    const promise = readLoginShellPath({ spawn, env: {}, platform: 'darwin' })
    child.emit('close', 0)
    await promise
    expect(vi.getTimerCount()).toBe(0)
  })

  it('Windows では起動せず null', async () => {
    const spawn = vi.fn<ShellSpawn>()
    await expect(readLoginShellPath({ spawn, platform: 'win32' })).resolves.toBeNull()
    expect(spawn).not.toHaveBeenCalled()
  })
})
```

`src/main/__tests__/agentShellEnv.integration.test.ts`（新規。実物の `/bin/sh` で取り出せること）:

```ts
import { describe, it, expect } from 'vitest'
import { readLoginShellPath } from '../agentShellEnv'

// 実物の /bin/sh で、印の間の取り出しと終了の検知を確かめる(macOS・Linux の開発者のローカルで走らせる。パターン 41)
describe('readLoginShellPath(実物のシェル)', () => {
  it.skipIf(process.platform === 'win32')(
    '/bin/sh -l -i -c で PATH を取り出す',
    async () => {
      const path = await readLoginShellPath({
        env: { SHELL: '/bin/sh', HOME: process.env.HOME, PATH: '/usr/bin:/bin:/custom/bin' }
      })
      expect(path).not.toBeNull()
      expect(path?.split(':')).toContain('/usr/bin')
    },
    10_000
  )
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/main/__tests__/agentShellEnv.test.ts src/main/__tests__/agentShellEnv.integration.test.ts
```

Expected: FAIL（`../agentShellEnv` が無い）

- [ ] **Step 3: 実装する**

`src/main/cliSearchPaths.ts`（新規）:

```ts
// GUI から起動したアプリの PATH(launchd の最小の PATH)に足す、CLI の既定の探索先。cliService(従来の方式)と
// エージェントの起動(agentCommand)が共有する。Windows では使わない

/** 既定の探索先。home が無ければ home 配下は含めない(cliService の buildEnv の従来の並び) */
export function getCliSearchPaths(home: string | undefined): string[] {
  const paths = ['/usr/local/bin', '/opt/homebrew/bin', '/snap/bin']
  if (home) paths.push(`${home}/.local/bin`, `${home}/.cargo/bin`)
  return paths
}

/** basePath の後ろに extra を ':' で足す。basePath が空・未定義なら extra だけ(先頭に ':' を付けない) */
export function appendSearchPaths(basePath: string | undefined, extra: readonly string[]): string {
  const extraStr = extra.join(':')
  return basePath ? `${basePath}:${extraStr}` : extraStr
}
```

`src/main/agentShellEnv.ts`（新規）:

```ts
import { spawn as nodeSpawn } from 'node:child_process'
import type { ChildProcess, SpawnOptions } from 'node:child_process'

// ログインシェルから PATH を取り出す(設計書「PATH の継承」C)。GUI から起動したアプリの PATH は launchd の最小のもので、
// ~/.local/bin や nvm の配下を含まない。zsh では -l だけでは ~/.zshrc が読まれないため -i も付ける(確認の結果 3)。
// 端末なし(標準入力は ignore)・新しいプロセスグループで起動し、打ち切りではグループごと止める(パターン 84・107)

export const LOGIN_SHELL_PATH_TIMEOUT_MS = 5_000
export const PATH_MARKER_START = '__PROMPT_IDE_PATH_START__'
export const PATH_MARKER_END = '__PROMPT_IDE_PATH_END__'
// 標準出力を溜める上限(シェルの初期化が大量に出力しても main のメモリを使い切らない)
const MAX_OUTPUT_LENGTH = 1_000_000

export type ShellSpawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess

/** 起動するシェル。SHELL、無ければ利用者の既定のシェル、それも無ければ /bin/sh */
export function resolveLoginShell(
  env: NodeJS.ProcessEnv,
  userShell: string | null | undefined
): string {
  if (env.SHELL) return env.SHELL
  if (userShell) return userShell
  return '/bin/sh'
}

/** 出力の中の印の間を取り出す。印が無い・中身が空(空白だけ)なら null */
export function extractMarkedPath(output: string): string | null {
  const start = output.indexOf(PATH_MARKER_START)
  if (start < 0) return null
  const from = start + PATH_MARKER_START.length
  const end = output.indexOf(PATH_MARKER_END, from)
  if (end < 0) return null
  const value = output.slice(from, end).trim()
  return value === '' ? null : value
}

export interface ReadLoginShellPathOptions {
  spawn?: ShellSpawn
  env?: NodeJS.ProcessEnv
  userShell?: string | null
  timeoutMs?: number
  platform?: NodeJS.Platform
  /** プロセスグループへのシグナル(テストで差し替える) */
  kill?: (pid: number, signal: NodeJS.Signals) => void
}

/** ログインシェルの PATH。取得できなければ null(Windows では常に null) */
export function readLoginShellPath({
  spawn = nodeSpawn,
  env = process.env,
  userShell = null,
  timeoutMs = LOGIN_SHELL_PATH_TIMEOUT_MS,
  platform = process.platform,
  kill = process.kill.bind(process)
}: ReadLoginShellPathOptions = {}): Promise<string | null> {
  if (platform === 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    let output = ''
    let child: ChildProcess
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      // 打ち切り: グループごと止める。既に終わっている・ゾンビだけのとき(ESRCH・EPERM)の例外は握る(パターン 107)
      if (child?.pid !== undefined) {
        try {
          kill(-child.pid, 'SIGKILL')
        } catch {
          // 止めるべきものは既に止まっている
        }
      }
      finish(null)
    }, timeoutMs)
    timer.unref()
    try {
      child = spawn(
        resolveLoginShell(env, userShell),
        ['-l', '-i', '-c', `printf "%s%s%s" "${PATH_MARKER_START}" "$PATH" "${PATH_MARKER_END}"`],
        { stdio: ['ignore', 'pipe', 'ignore'], detached: true, env }
      )
    } catch {
      finish(null)
      return
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (output.length < MAX_OUTPUT_LENGTH) output += chunk
    })
    child.on('error', () => finish(null))
    child.on('close', () => finish(extractMarkedPath(output)))
  })
}
```

`src/main/cliService.ts`（差分）:

```diff
--- a/src/main/cliService.ts
+++ b/src/main/cliService.ts
@@ -1,5 +1,6 @@
 import { spawn } from 'node:child_process'
 import type { CLIOnlyToolId } from '@shared/types'
+import { appendSearchPaths, getCliSearchPaths } from './cliSearchPaths'

 interface ToolConfig {
   command: string
@@ -30,16 +31,11 @@
   if (process.platform === 'win32') {
     return { ...process.env }
   }
-  const extra = [
-    '/usr/local/bin',
-    '/opt/homebrew/bin',
-    '/snap/bin',
-    process.env.HOME && `${process.env.HOME}/.local/bin`,
-    process.env.HOME && `${process.env.HOME}/.cargo/bin`
-  ].filter(Boolean) as string[]
-  const extraStr = extra.join(':')
-  const basePath = process.env.PATH ? `${process.env.PATH}:${extraStr}` : extraStr
-  return { ...process.env, PATH: basePath }
+  // 既定の探索先はエージェントの起動(agentCommand)と共有する(cliSearchPaths)
+  return {
+    ...process.env,
+    PATH: appendSearchPaths(process.env.PATH, getCliSearchPaths(process.env.HOME))
+  }
 }

 export interface RunCLIPromptOptions {
@@ -61,7 +57,7 @@
   return new Promise((resolve, reject) => {
     let timer: ReturnType<typeof setTimeout> | null = null
     let settled = false
-    const settle = (fn: () => void) => {
+    const settle = (fn: () => void): void => {
       if (settled) return
       settled = true
       if (timer !== null) clearTimeout(timer)
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/main/__tests__/agentShellEnv.test.ts src/main/__tests__/agentShellEnv.integration.test.ts src/main/__tests__/cliService.test.ts
npm run typecheck
npx eslint src/main/cliSearchPaths.ts src/main/agentShellEnv.ts src/main/cliService.ts src/main/__tests__/agentShellEnv.test.ts src/main/__tests__/agentShellEnv.integration.test.ts
npx prettier --check src/main/cliSearchPaths.ts src/main/agentShellEnv.ts src/main/cliService.ts src/main/__tests__/agentShellEnv.test.ts src/main/__tests__/agentShellEnv.integration.test.ts
pgrep -fl "PROMPT_IDE_PATH" || echo "no leftover"
```

Expected: PASS（14 + 1 + 38 件）。`no leftover`

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                           | テストのファイル        | `-t`                                       | 確認           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------ | -------------- |
| P1  | `agentShellEnv.ts` の `detached: true` を `detached: false` にする                                                                                             | `agentShellEnv.test.ts` | `ログインシェルを -l -i -c`                | 落ちた（1 件） |
| P2  | `agentShellEnv.ts` の `kill(-child.pid, 'SIGKILL')` を `kill(child.pid, 'SIGKILL')` にする                                                                     | `agentShellEnv.test.ts` | `打ち切りの時間を過ぎたら`                 | 落ちた（1 件） |
| P3  | `agentShellEnv.ts` の `settled = true ⏎ clearTimeout(timer)` を `settled = true` にする                                                                        | `agentShellEnv.test.ts` | `close の後に打ち切りのタイマーを残さない` | 落ちた（1 件） |
| P4  | `cliSearchPaths.ts` の ``return basePath ? `${basePath}:${extraStr}` : extraStr`` を `` return basePath ? `${basePath}:${extraStr}` : `:${extraStr}` `` にする | `cliService.test.ts`    | `先頭コロンなし`                           | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/main
```

---

### Task 4: main: 起動のコマンドと環境変数（`agentCommand`）

**Files:**

- Create: `src/main/agentCommand.ts`、`src/main/__tests__/agentCommand.test.ts`

**Interfaces:**

- Consumes: `appendSearchPaths`・`getCliSearchPaths`（Task 3）
- Produces: `AGENT_COMMAND_NAME = 'claude'`、`REMOVED_AGENT_ENV_KEYS`・`REMOVED_AGENT_ENV_PREFIXES`、`type ExecutableProbe = (path: string) => Promise<boolean>`、`isExecutableRegularFile: ExecutableProbe`、`findExecutableInPath(name, pathValue, { platform; pathExt?; isExecutable }): Promise<string | null>`、`buildAgentEnv(base: NodeJS.ProcessEnv, pathValue: string): Record<string, string>`、`interface AgentLaunchPlan { file: string; args: string[]; env: Record<string, string> }`、`type AgentLaunchResolution = { kind: 'ok'; plan } | { kind: 'not-found'; shellPathUnavailable: boolean }`、`resolveAgentLaunch({ env, platform, readLoginShellPath, isExecutable }): Promise<AgentLaunchResolution>`
- 注: 既存の `fileSystem.isExecutableFile` は所有者の実行ビットだけを見て、無いファイルで投げるため使わない（`access(X_OK)` と `stat().isFile()` で判定する）。PATH の空の要素（作業ディレクトリ）は探さない

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentCommand.test.ts`（新規。存在の確認は注入する）:

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  AGENT_COMMAND_NAME,
  buildAgentEnv,
  findExecutableInPath,
  resolveAgentLaunch
} from '../agentCommand'
import type { ExecutableProbe } from '../agentCommand'

const probeOf = (executables: string[]): ExecutableProbe =>
  vi.fn<ExecutableProbe>(async (path) => executables.includes(path))

describe('findExecutableInPath', () => {
  it('PATH の先頭から探し、最初に見つかったものを返す', async () => {
    const isExecutable = probeOf(['/b/claude', '/c/claude'])
    await expect(
      findExecutableInPath('claude', '/a:/b:/c', { platform: 'darwin', isExecutable })
    ).resolves.toBe('/b/claude')
  })

  it('実行可能でないものは飛ばす', async () => {
    const isExecutable = probeOf(['/c/claude'])
    await expect(
      findExecutableInPath('claude', '/a:/b:/c', { platform: 'darwin', isExecutable })
    ).resolves.toBe('/c/claude')
    expect(isExecutable).toHaveBeenCalledWith('/a/claude')
    expect(isExecutable).toHaveBeenCalledWith('/b/claude')
  })

  it('空の要素(作業ディレクトリを意味する)は探さない', async () => {
    const isExecutable = probeOf(['claude'])
    await expect(
      findExecutableInPath('claude', ':/a::', { platform: 'darwin', isExecutable })
    ).resolves.toBeNull()
    expect(isExecutable).toHaveBeenCalledTimes(1)
    expect(isExecutable).toHaveBeenCalledWith('/a/claude')
  })

  it('見つからなければ null', async () => {
    await expect(
      findExecutableInPath('claude', '/a', { platform: 'linux', isExecutable: probeOf([]) })
    ).resolves.toBeNull()
  })

  it('Windows は ; で区切り、PATHEXT の拡張子を順に試す', async () => {
    const isExecutable = probeOf(['C:\\tools\\claude.CMD'])
    await expect(
      findExecutableInPath('claude', 'C:\\bin;C:\\tools', {
        platform: 'win32',
        pathExt: '.EXE;.CMD',
        isExecutable
      })
    ).resolves.toBe('C:\\tools\\claude.CMD')
    expect(isExecutable).toHaveBeenNthCalledWith(1, 'C:\\bin\\claude.EXE')
  })
})

describe('buildAgentEnv', () => {
  const base = {
    HOME: '/home/u',
    PATH: '/usr/bin',
    SHELL: '/bin/zsh',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_RENDERER_URL: 'http://localhost:5173',
    VSCODE_GIT_IPC_HANDLE: '/tmp/x',
    TERM_PROGRAM: 'vscode',
    TERM_PROGRAM_VERSION: '1.0',
    CLAUDECODE: '1',
    CLAUDE_PID: '9',
    CLAUDE_CODE_SESSION_ID: 's',
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_SESSION_ATTENDED: '1',
    CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/sock',
    CLAUDE_CODE_MESSAGING_TOKEN: 'tok',
    CLAUDE_CODE_SSE_PORT: '1234',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_EXECPATH: '/x',
    CLAUDE_CODE_USE_BEDROCK: '1',
    GIT_ASKPASS: '/askpass',
    UNDEFINED_VALUE: undefined
  }

  it('親の Claude Code・Electron・VS Code の変数を取り除く', () => {
    const env = buildAgentEnv(base, '/p')
    for (const key of [
      'ELECTRON_RUN_AS_NODE',
      'ELECTRON_RENDERER_URL',
      'VSCODE_GIT_IPC_HANDLE',
      'TERM_PROGRAM',
      'TERM_PROGRAM_VERSION',
      'CLAUDECODE',
      'CLAUDE_PID',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_CODE_CHILD_SESSION',
      'CLAUDE_CODE_SESSION_ATTENDED',
      'CLAUDE_CODE_MESSAGING_SOCKET',
      'CLAUDE_CODE_MESSAGING_TOKEN',
      'CLAUDE_CODE_SSE_PORT',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_EXECPATH'
    ]) {
      expect(env).not.toHaveProperty(key)
    }
  })

  it('利用者の設定の変数(CLAUDE_CODE_USE_BEDROCK・GIT_ASKPASS)は残す', () => {
    const env = buildAgentEnv(base, '/p')
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(env.GIT_ASKPASS).toBe('/askpass')
    expect(env.HOME).toBe('/home/u')
  })

  it('PATH・TERM・COLORTERM を設定し、undefined の値は写さない', () => {
    const env = buildAgentEnv(base, '/p:/q')
    expect(env.PATH).toBe('/p:/q')
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env).not.toHaveProperty('UNDEFINED_VALUE')
  })

  it('LANG・LC_ALL・LC_CTYPE がどれも無ければ LANG=en_US.UTF-8 を足す', () => {
    expect(buildAgentEnv({}, '/p').LANG).toBe('en_US.UTF-8')
  })

  it.each([
    ['LANG', { LANG: 'ja_JP.UTF-8' }, 'ja_JP.UTF-8'],
    ['LC_ALL', { LC_ALL: 'C' }, undefined],
    ['LC_CTYPE', { LC_CTYPE: 'UTF-8' }, undefined]
  ])('%s があれば LANG を足さない', (_label, given, expectedLang) => {
    expect(buildAgentEnv(given, '/p').LANG).toBe(expectedLang)
  })

  it('元の env を変えない', () => {
    const given = { ELECTRON_RUN_AS_NODE: '1', PATH: '/x' }
    buildAgentEnv(given, '/p')
    expect(given).toEqual({ ELECTRON_RUN_AS_NODE: '1', PATH: '/x' })
  })
})

describe('resolveAgentLaunch', () => {
  it('ログインシェルの PATH の後ろに既定の探索先を足して探し、引数は空で固定する', async () => {
    const isExecutable = probeOf(['/home/u/.local/bin/claude'])
    const result = await resolveAgentLaunch({
      env: { HOME: '/home/u', PATH: '/usr/bin' },
      platform: 'darwin',
      readLoginShellPath: async () => '/nvm/bin:/usr/bin',
      isExecutable
    })
    expect(result).toEqual({
      kind: 'ok',
      plan: {
        file: '/home/u/.local/bin/claude',
        args: [],
        env: expect.objectContaining({
          PATH: '/nvm/bin:/usr/bin:/usr/local/bin:/opt/homebrew/bin:/snap/bin:/home/u/.local/bin:/home/u/.cargo/bin'
        })
      }
    })
    expect(isExecutable).toHaveBeenNthCalledWith(1, `/nvm/bin/${AGENT_COMMAND_NAME}`)
  })

  it('ログインシェルの PATH が取れなければ main の PATH に倒し、見つからなければその旨を返す', async () => {
    const isExecutable = probeOf([])
    const result = await resolveAgentLaunch({
      env: { HOME: '/home/u', PATH: '/usr/bin:/bin' },
      platform: 'darwin',
      readLoginShellPath: async () => null,
      isExecutable
    })
    expect(result).toEqual({ kind: 'not-found', shellPathUnavailable: true })
    expect(isExecutable).toHaveBeenNthCalledWith(1, '/usr/bin/claude')
  })

  it('ログインシェルの PATH が取れて見つからないときは shellPathUnavailable が false', async () => {
    const result = await resolveAgentLaunch({
      env: {},
      platform: 'linux',
      readLoginShellPath: async () => '/a',
      isExecutable: probeOf([])
    })
    expect(result).toEqual({ kind: 'not-found', shellPathUnavailable: false })
  })

  it('Windows はログインシェルを使わず PATH と PATHEXT で探す', async () => {
    const readLoginShellPath = vi.fn(async () => '/never')
    const result = await resolveAgentLaunch({
      env: { Path: 'C:\\tools', PATHEXT: '.EXE' },
      platform: 'win32',
      readLoginShellPath,
      isExecutable: probeOf(['C:\\tools\\claude.EXE'])
    })
    expect(result.kind).toBe('ok')
    expect(readLoginShellPath).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/main/__tests__/agentCommand.test.ts
```

Expected: FAIL（`../agentCommand` が無い）

- [ ] **Step 3: 実装する**

`src/main/agentCommand.ts`（新規）:

```ts
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter as posixDelimiter, join as posixJoin } from 'node:path/posix'
import { delimiter as win32Delimiter, join as win32Join } from 'node:path/win32'
import { appendSearchPaths, getCliSearchPaths } from './cliSearchPaths'

// エージェントの起動のコマンドと環境変数を main で決める(設計書「セキュリティ」「PATH の継承」)。renderer からは受け取らない

/** 起動するコマンドの名前。引数は空で固定する(--dangerously-skip-permissions などを付けない) */
export const AGENT_COMMAND_NAME = 'claude'

/** 取り除く環境変数(完全一致)。親の Claude Code のセッションの通信先と token、VS Code の端末から引き継ぐもの(確認の結果 12) */
export const REMOVED_AGENT_ENV_KEYS: readonly string[] = [
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH'
]
/** 取り除く環境変数(接頭辞)。ELECTRON_RUN_AS_NODE などが子の Electron 製のツールの挙動を変えるため */
export const REMOVED_AGENT_ENV_PREFIXES: readonly string[] = ['ELECTRON_', 'VSCODE_']

/** 実行できる通常のファイルか(テストで差し替える) */
export type ExecutableProbe = (path: string) => Promise<boolean>

export const isExecutableRegularFile: ExecutableProbe = async (path) => {
  try {
    const stats = await stat(path)
    if (!stats.isFile()) return false
    if (process.platform === 'win32') return true
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export interface FindExecutableOptions {
  platform: NodeJS.Platform
  /** Windows の PATHEXT(例: '.COM;.EXE;.BAT;.CMD')。無ければ '.COM;.EXE;.BAT;.CMD' */
  pathExt?: string
  isExecutable: ExecutableProbe
}

/** PATH の先頭から name の実行可能なファイルを探し、最初に見つかった絶対パスを返す。見つからなければ null */
export async function findExecutableInPath(
  name: string,
  pathValue: string,
  { platform, pathExt, isExecutable }: FindExecutableOptions
): Promise<string | null> {
  const isWindows = platform === 'win32'
  const delimiter = isWindows ? win32Delimiter : posixDelimiter
  const join = isWindows ? win32Join : posixJoin
  const extensions = isWindows
    ? (pathExt ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ext) => ext !== '')
    : ['']
  for (const dir of pathValue.split(delimiter)) {
    // 空の要素(先頭・末尾・連続の区切り)は作業ディレクトリを意味するため探さない(作業ディレクトリのファイルを起動しない)
    if (dir === '') continue
    for (const ext of extensions) {
      const candidate = join(dir, name + ext)
      if (await isExecutable(candidate)) return candidate
    }
  }
  return null
}

/** pty へ渡す環境変数(設計書「環境変数」)。base を写し、取り除く変数を除き、PATH・TERM・COLORTERM・LANG を設定する */
export function buildAgentEnv(base: NodeJS.ProcessEnv, pathValue: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (REMOVED_AGENT_ENV_KEYS.includes(key)) continue
    if (REMOVED_AGENT_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
    env[key] = value
  }
  env.PATH = pathValue
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  // GUI から起動すると LANG が無い(確認の結果 3)。利用者が LC_* を設定していれば上書きしない
  if (env.LANG === undefined && env.LC_ALL === undefined && env.LC_CTYPE === undefined) {
    env.LANG = 'en_US.UTF-8'
  }
  return env
}

export interface AgentLaunchPlan {
  /** 起動する claude の絶対パス */
  file: string
  /** 引数(空で固定) */
  args: string[]
  env: Record<string, string>
}

export type AgentLaunchResolution =
  | { kind: 'ok'; plan: AgentLaunchPlan }
  | { kind: 'not-found'; shellPathUnavailable: boolean }

export interface ResolveAgentLaunchDeps {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  readLoginShellPath: () => Promise<string | null>
  isExecutable: ExecutableProbe
}

/**
 * 起動のコマンドと環境変数を決める。macOS・Linux はログインシェルの PATH(取得できなければ main の PATH)の後ろに
 * 既定の探索先を足した PATH で claude を探す。Windows は main の PATH と PATHEXT で探す
 */
export async function resolveAgentLaunch({
  env,
  platform,
  readLoginShellPath,
  isExecutable
}: ResolveAgentLaunchDeps): Promise<AgentLaunchResolution> {
  let pathValue: string
  let shellPathUnavailable = false
  if (platform === 'win32') {
    pathValue = env.PATH ?? env.Path ?? ''
  } else {
    const loginPath = await readLoginShellPath()
    shellPathUnavailable = loginPath === null
    pathValue = appendSearchPaths(loginPath ?? env.PATH, getCliSearchPaths(env.HOME))
  }
  const file = await findExecutableInPath(AGENT_COMMAND_NAME, pathValue, {
    platform,
    pathExt: env.PATHEXT,
    isExecutable
  })
  if (file === null) return { kind: 'not-found', shellPathUnavailable }
  return { kind: 'ok', plan: { file, args: [], env: buildAgentEnv(env, pathValue) } }
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/main/__tests__/agentCommand.test.ts
npm run typecheck
npx eslint src/main/agentCommand.ts src/main/__tests__/agentCommand.test.ts
npx prettier --check src/main/agentCommand.ts src/main/__tests__/agentCommand.test.ts
```

Expected: PASS（17 件）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                                     | テストのファイル       | `-t`                             | 確認           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | -------------------------------- | -------------- |
| C1  | `agentCommand.ts` の `if (dir === '') continue` を消す                                                                                                                   | `agentCommand.test.ts` | `空の要素`                       | 落ちた（1 件） |
| C2  | `agentCommand.ts` の `'CLAUDE_CODE_MESSAGING_TOKEN',` を消す                                                                                                             | `agentCommand.test.ts` | `親の Claude Code`               | 落ちた（1 件） |
| C3  | `agentCommand.ts` の `env.LANG === undefined && env.LC_ALL === undefined && env.LC_CTYPE === undefined` を `env.LANG === undefined && env.LC_CTYPE === undefined` にする | `agentCommand.test.ts` | `があれば LANG を足さない`       | 落ちた（1 件） |
| C4  | `agentCommand.ts` の `appendSearchPaths(loginPath ?? env.PATH, getCliSearchPaths(env.HOME))` を `appendSearchPaths(env.PATH, getCliSearchPaths(env.HOME))` にする        | `agentCommand.test.ts` | `ログインシェルの PATH の後ろに` | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/main
```

---

### Task 5: main: 子孫のプロセスの停止（`agentProcessTree`）

**Files:**

- Create: `src/main/agentProcessTree.ts`、`src/main/__tests__/agentProcessTree.test.ts`

**Interfaces:**

- Consumes: なし
- Produces: `AGENT_KILL_GRACE_MS = 3_000`・`AGENT_KILL_SETTLE_MS = 1_000`、`interface ProcessEntry { pid; ppid }`、`parsePsPidPpid(output): ProcessEntry[]`、`collectDescendants(rootPid, table): number[]`、`listProcesses(): Promise<ProcessEntry[]>`（`ps -A -o pid=,ppid=`。失敗は空）、`type KillFn = (pid: number, signal: NodeJS.Signals | 0) => void`、`safeKill(kill, pid, signal): void`（例外をすべて握る。パターン 107）、`isProcessAlive(kill, pid): boolean`、`stopProcessTree({ pid, exited, graceMs?, settleMs?, platform?, listProcesses?, kill?, killPty?, spawnTaskkill? }): Promise<void>`
- 注: 差異 11（終了の後も生き残った、控えた子孫へ SIGKILL）。実物のプロセスでの確認は Task 6 の結合テストで行う。猶予・待ちのタイマーはどちらでもすぐ解除し、`unref` する（テストで `vi.getTimerCount()` が 0 になる）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentProcessTree.test.ts`（新規。偽の `kill`・`ps` で手順を固定する）:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { collectDescendants, parsePsPidPpid, safeKill, stopProcessTree } from '../agentProcessTree'
import type { KillFn, ProcessEntry } from '../agentProcessTree'

afterEach(() => {
  vi.useRealTimers()
})

describe('parsePsPidPpid', () => {
  it('前後の空白のある行を解析し、解析できない行は捨てる', () => {
    expect(parsePsPidPpid('    1     0\n  501     1\nPID PPID\n\n 9 8 7\n')).toEqual([
      { pid: 1, ppid: 0 },
      { pid: 501, ppid: 1 }
    ])
  })
})

describe('collectDescendants', () => {
  const table: ProcessEntry[] = [
    { pid: 10, ppid: 1 },
    { pid: 11, ppid: 10 },
    { pid: 12, ppid: 10 },
    { pid: 13, ppid: 11 },
    { pid: 20, ppid: 1 }
  ]
  it('子・孫を集め、根と無関係なプロセスは含めない', () => {
    expect(collectDescendants(10, table).sort()).toEqual([11, 12, 13])
  })
  it('子が無ければ空', () => {
    expect(collectDescendants(20, table)).toEqual([])
  })
  it('親子の循環があっても止まる', () => {
    expect(
      collectDescendants(1, [
        { pid: 2, ppid: 1 },
        { pid: 1, ppid: 2 }
      ])
    ).toEqual([2])
  })
})

describe('safeKill', () => {
  it.each(['ESRCH', 'EPERM', 'EINVAL'])('%s を握る', (code) => {
    const kill = vi.fn<KillFn>(() => {
      throw Object.assign(new Error(code), { code })
    })
    expect(() => safeKill(kill, -1, 'SIGTERM')).not.toThrow()
  })
})

// 生きているプロセスの集合を持つ偽の kill。シグナル 0 は生死の確認、それ以外は記録して止める
function makeKill(
  alive: Set<number>,
  options: { ignoreTerm?: number[] } = {}
): KillFn & {
  calls: Array<[number, NodeJS.Signals | 0]>
} {
  const calls: Array<[number, NodeJS.Signals | 0]> = []
  const kill = ((pid: number, signal: NodeJS.Signals | 0) => {
    calls.push([pid, signal])
    if (signal === 0) {
      if (!alive.has(pid)) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
      return
    }
    if (pid < 0) {
      if (signal === 'SIGTERM' && options.ignoreTerm?.includes(-pid)) return
      alive.delete(-pid)
      return
    }
    alive.delete(pid)
  }) as KillFn & { calls: Array<[number, NodeJS.Signals | 0]> }
  kill.calls = calls
  return kill
}

describe('stopProcessTree(POSIX)', () => {
  const table: ProcessEntry[] = [
    { pid: 100, ppid: 1 },
    { pid: 101, ppid: 100 },
    { pid: 102, ppid: 101 }
  ]

  it('グループへ SIGTERM を送り、終了したら猶予を待たずに、生き残った子孫へ SIGKILL を送る', async () => {
    vi.useFakeTimers()
    const alive = new Set([100, 101, 102])
    const kill = makeKill(alive)
    let markExited: () => void = () => undefined
    const exited = new Promise<void>((resolve) => (markExited = resolve))
    const done = stopProcessTree({
      pid: 100,
      exited,
      platform: 'darwin',
      listProcesses: async () => table,
      kill
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(kill.calls).toContainEqual([-100, 'SIGTERM'])
    // claude は終わったが、別のセッションの孫(102)は残っている
    alive.delete(100)
    alive.delete(101)
    markExited()
    await done
    expect(kill.calls).not.toContainEqual([-100, 'SIGKILL'])
    expect(kill.calls).toContainEqual([102, 'SIGKILL'])
    expect(kill.calls).not.toContainEqual([101, 'SIGKILL'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('猶予の間に終わらなければグループと子孫へ SIGKILL を送り、終了を待って解決する', async () => {
    vi.useFakeTimers()
    const alive = new Set([100, 101, 102])
    const kill = makeKill(alive, { ignoreTerm: [100] })
    let markExited: () => void = () => undefined
    const exited = new Promise<void>((resolve) => (markExited = resolve))
    let resolved = false
    const done = stopProcessTree({
      pid: 100,
      exited,
      graceMs: 3000,
      platform: 'darwin',
      listProcesses: async () => table,
      kill
    }).then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(2999)
    expect(kill.calls).not.toContainEqual([-100, 'SIGKILL'])
    await vi.advanceTimersByTimeAsync(1)
    expect(kill.calls).toContainEqual([-100, 'SIGKILL'])
    expect(resolved).toBe(false)
    markExited()
    await done
    expect(resolved).toBe(true)
  })

  it('SIGKILL の後に終了が来なくても settleMs で解決する', async () => {
    vi.useFakeTimers()
    const kill = makeKill(new Set([100]), { ignoreTerm: [100] })
    const done = stopProcessTree({
      pid: 100,
      exited: new Promise<void>(() => undefined),
      graceMs: 3000,
      settleMs: 1000,
      platform: 'darwin',
      listProcesses: async () => [],
      kill
    })
    await vi.advanceTimersByTimeAsync(4000)
    await expect(done).resolves.toBeUndefined()
  })

  it('シグナルが例外を投げても(EPERM)reject しない', async () => {
    const kill = vi.fn<KillFn>(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    })
    await expect(
      stopProcessTree({
        pid: 100,
        exited: Promise.resolve(),
        platform: 'darwin',
        listProcesses: async () => table,
        kill
      })
    ).resolves.toBeUndefined()
  })

  it('ps に失敗しても(空の一覧)グループの停止は行う', async () => {
    const kill = makeKill(new Set([100]))
    await stopProcessTree({
      pid: 100,
      exited: Promise.resolve(),
      platform: 'linux',
      listProcesses: async () => [],
      kill
    })
    expect(kill.calls).toContainEqual([-100, 'SIGTERM'])
  })
})

describe('stopProcessTree(Windows)', () => {
  it('pty の kill() と taskkill を呼び、グループへのシグナルは送らない', async () => {
    const killPty = vi.fn()
    const spawnTaskkill = vi.fn()
    const kill = vi.fn<KillFn>()
    await stopProcessTree({
      pid: 55,
      exited: Promise.resolve(),
      platform: 'win32',
      killPty,
      spawnTaskkill,
      kill
    })
    expect(killPty).toHaveBeenCalledOnce()
    expect(spawnTaskkill).toHaveBeenCalledWith(55)
    expect(kill).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/main/__tests__/agentProcessTree.test.ts
```

Expected: FAIL（`../agentProcessTree` が無い）

- [ ] **Step 3: 実装する**

`src/main/agentProcessTree.ts`（新規）:

```ts
import { execFile, spawn } from 'node:child_process'

// エージェントのセッションの子孫のプロセスの停止(設計書「終了・後始末」)。claude は Bash のツールの子を別のセッションで
// 動かすため(確認の結果 9)、プロセスグループへのシグナルだけでは届かない子がいる。停止の前に子孫を控え、グループへ SIGTERM →
// 猶予の後も終わらなければグループへ SIGKILL。最後に、控えた子孫のうち生き残っているものに SIGKILL を送る

/** SIGTERM から SIGKILL へ切り替えるまでの猶予 */
export const AGENT_KILL_GRACE_MS = 3_000
/** SIGKILL の後に終了を待つ上限(pty の onExit が来ない場合でも stop を解決させる) */
export const AGENT_KILL_SETTLE_MS = 1_000

export interface ProcessEntry {
  pid: number
  ppid: number
}

/** `ps -A -o pid=,ppid=` の出力を解析する。解析できない行は捨てる */
export function parsePsPidPpid(output: string): ProcessEntry[] {
  const entries: ProcessEntry[] = []
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (match === null) continue
    entries.push({ pid: Number(match[1]), ppid: Number(match[2]) })
  }
  return entries
}

/** rootPid の子孫(rootPid 自身は含めない)。幅優先で、親子の循環があっても止まる */
export function collectDescendants(rootPid: number, table: readonly ProcessEntry[]): number[] {
  const children = new Map<number, number[]>()
  for (const { pid, ppid } of table) {
    const list = children.get(ppid) ?? []
    list.push(pid)
    children.set(ppid, list)
  }
  const result: number[] = []
  const seen = new Set<number>([rootPid])
  const queue = [rootPid]
  while (queue.length > 0) {
    const current = queue.shift() as number
    for (const child of children.get(current) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      result.push(child)
      queue.push(child)
    }
  }
  return result
}

/** ps でプロセスの一覧を取る。失敗したら空(子孫を控えられなくても停止は続ける) */
export function listProcesses(): Promise<ProcessEntry[]> {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid='], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? [] : parsePsPidPpid(String(stdout)))
    })
  })
}

export type KillFn = (pid: number, signal: NodeJS.Signals | 0) => void

/** シグナルを送る。既に終わっている(ESRCH)・ゾンビだけのグループ(EPERM)などの例外はすべて握る(パターン 107) */
export function safeKill(kill: KillFn, pid: number, signal: NodeJS.Signals): void {
  try {
    kill(pid, signal)
  } catch {
    // 止めるべきものは既に止まっている
  }
}

/** プロセスが生きているか(シグナル 0)。回収前のゾンビも生きているとみなす */
export function isProcessAlive(kill: KillFn, pid: number): boolean {
  try {
    kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export interface StopProcessTreeOptions {
  /** pty の子(claude)の pid。新しいセッションのリーダーなので pgid = pid */
  pid: number
  /** 子の終了(pty の onExit)で解決する */
  exited: Promise<void>
  graceMs?: number
  settleMs?: number
  platform?: NodeJS.Platform
  listProcesses?: () => Promise<ProcessEntry[]>
  kill?: KillFn
  /** Windows で pty の kill() を呼ぶ */
  killPty?: () => void
  /** Windows で taskkill /pid <pid> /T /F を起動する */
  spawnTaskkill?: (pid: number) => void
}

/** promise が ms 以内に解決すれば true、過ぎれば false。どちらでもタイマーを残さない */
function settlesWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    timer.unref()
    void promise.then(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

const defaultSpawnTaskkill = (pid: number): void => {
  const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true
  })
  killer.on('error', () => undefined)
}

/** 子孫を含めて止める。子の終了(exited)を待って解決する(最大で猶予 + settleMs) */
export async function stopProcessTree({
  pid,
  exited,
  graceMs = AGENT_KILL_GRACE_MS,
  settleMs = AGENT_KILL_SETTLE_MS,
  platform = process.platform,
  listProcesses: list = listProcesses,
  kill = process.kill.bind(process) as KillFn,
  killPty = () => undefined,
  spawnTaskkill = defaultSpawnTaskkill
}: StopProcessTreeOptions): Promise<void> {
  if (platform === 'win32') {
    // Windows はプロセスグループが無い。pty の kill() に任せたうえで、子孫ごと taskkill(実機で未確認)
    killPty()
    spawnTaskkill(pid)
    await settlesWithin(exited, graceMs + settleMs)
    return
  }
  const descendants = collectDescendants(pid, await list())
  safeKill(kill, -pid, 'SIGTERM')
  const exitedInGrace = await settlesWithin(exited, graceMs)
  if (!exitedInGrace) safeKill(kill, -pid, 'SIGKILL')
  // 控えた子孫のうち、別のセッションで生き残っているもの(claude が片付けなかった子・SIGKILL で孤児になった子)を止める
  for (const child of descendants) {
    if (isProcessAlive(kill, child)) safeKill(kill, child, 'SIGKILL')
  }
  if (!exitedInGrace) await settlesWithin(exited, settleMs)
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/main/__tests__/agentProcessTree.test.ts
npm run typecheck
npx eslint src/main/agentProcessTree.ts src/main/__tests__/agentProcessTree.test.ts
npx prettier --check src/main/agentProcessTree.ts src/main/__tests__/agentProcessTree.test.ts
```

Expected: PASS（13 件）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                     | テストのファイル           | `-t`                        | 確認           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------- | -------------- |
| T1  | `agentProcessTree.ts` の `if (isProcessAlive(kill, child)) safeKill(kill, child, 'SIGKILL')` を `void child` にする                      | `agentProcessTree.test.ts` | `グループへ SIGTERM を送り` | 落ちた（1 件） |
| T2  | `agentProcessTree.ts` の `if (!exitedInGrace) safeKill(kill, -pid, 'SIGKILL')` を消す                                                    | `agentProcessTree.test.ts` | `猶予の間に終わらなければ`  | 落ちた（1 件） |
| T3  | `agentProcessTree.ts` の `void promise.then(() => { ⏎ clearTimeout(timer)` を `void promise.then(() => {` にする                         | `agentProcessTree.test.ts` | `グループへ SIGTERM を送り` | 落ちた（1 件） |
| T4  | `agentProcessTree.ts` の `try { ⏎ kill(pid, signal) ⏎ } catch { ⏎ // 止めるべきものは既に止まっている ⏎ }` を `kill(pid, signal)` にする | `agentProcessTree.test.ts` | `EPERM`                     | 落ちた（2 件） |

`T1b` は Task 6 の結合テストができてから行う（Task 6 の Step 5 にも同じ行がある）。`collectDescendants` の `if (seen.has(child)) continue` を外す変異は、循環のテストで無限ループになるため行わない。

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/main
```

---

### Task 6: main: セッションと登録（`agentSession`・`agentSessionRegistry`）と、実物の pty の結合テスト

**Files:**

- Create: `src/main/agentSession.ts`、`src/main/agentSessionRegistry.ts`、`src/main/__tests__/helpers/fakePty.ts`、`src/main/__tests__/agentSession.test.ts`、`src/main/__tests__/agentSessionRegistry.test.ts`、`src/main/__tests__/agentSession.integration.test.ts`

**Interfaces:**

- Consumes: `AgentExitReason`・`AgentStartResult`・`AgentSessionSnapshot`（Task 2）、`stopProcessTree`（Task 5。結合テストだけ）、`buildAgentPasteBytes`・`AGENT_CLEAR_INPUT_CHUNK`（Task 2。結合テストだけ）、`createTestTimers`・`isAlive`・`waitForFile`・`waitUntilDead`・`writeFakeExecutable`（既存の `src/main/__tests__/helpers/processProbe.ts`）
- Produces: `interface PtyLike { pid; onData; onExit; write; resize; kill }`、`interface PtySpawnOptions { name; cols; rows; cwd; env }`、`type PtySpawn = (file, args, options) => PtyLike`、`interface AgentSessionExitInfo { exitCode: number | null; signal: number | null; reason }`、`interface AgentSessionCallbacks { onData; onExit }`、`type StopTree = (pty: PtyLike, exited: Promise<void>) => Promise<void>`、`class AgentSession { id; exited; pid; isAlive(); write(data); resize(cols, rows); stop(reason): Promise<void> }`、`startAgentSession({ id, spawn, file, args, env, cwd, cols, rows, callbacks, stopTree }): AgentSession`（spawn の例外はそのまま投げる）、`type AgentSessionCreation = { kind: 'created'; session } | { kind: 'failed'; result }`、`AGENT_START_CANCELED_DETAIL = '起動の途中で停止されました'`、`class AgentSessionRegistry { start(ownerId, create): Promise<AgentStartResult>; write(ownerId, sessionId, data); resize(ownerId, sessionId, cols, rows); stop(ownerId, reason, sessionId?): Promise<void>; stopAll(reason): Promise<void>; snapshot(ownerId): AgentSessionSnapshot; hasAny(): boolean }`、テストの補助 `makeFakePty(pid?): FakePty`
- 注: 起動の依頼の重複（StrictMode の 2 回目。確認の結果 10）は registry が 1 つにまとめる。起動の途中で `stop`（リロード・破棄・フォルダの切り替え）が来たら、できたセッションを止めて登録しない（所有者のいないセッションを残さない）。結合テストの偽のエージェントの孫は `perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV'` で別のセッションへ抜ける（macOS に `setsid` のコマンドは無い）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/helpers/fakePty.ts`（新規。テストの補助）:

```ts
import { vi } from 'vitest'
import type { PtyLike } from '../../agentSession'

// 偽の pty。onData・onExit の購読者を持ち、テストから emitData・emitExit で起こす
export interface FakePty extends PtyLike {
  write: ReturnType<typeof vi.fn<PtyLike['write']>>
  resize: ReturnType<typeof vi.fn<PtyLike['resize']>>
  kill: ReturnType<typeof vi.fn<PtyLike['kill']>>
  emitData(data: string): void
  emitExit(exitCode: number, signal?: number): void
  /** 購読が解除されずに残っている数 */
  listenerCount(): number
}

export function makeFakePty(pid = 1000): FakePty {
  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()
  return {
    pid,
    onData(listener) {
      dataListeners.add(listener)
      return { dispose: () => dataListeners.delete(listener) }
    },
    onExit(listener) {
      exitListeners.add(listener)
      return { dispose: () => exitListeners.delete(listener) }
    },
    write: vi.fn<PtyLike['write']>(),
    resize: vi.fn<PtyLike['resize']>(),
    kill: vi.fn<PtyLike['kill']>(),
    emitData(data) {
      for (const listener of [...dataListeners]) listener(data)
    },
    emitExit(exitCode, signal) {
      for (const listener of [...exitListeners]) listener({ exitCode, signal })
    },
    listenerCount() {
      return dataListeners.size + exitListeners.size
    }
  }
}
```

`src/main/__tests__/agentSession.test.ts`（新規）:

```ts
import { describe, it, expect, vi } from 'vitest'
import { AgentSession, startAgentSession } from '../agentSession'
import type { AgentSessionCallbacks, PtySpawn, StopTree } from '../agentSession'
import { makeFakePty } from './helpers/fakePty'

function makeCallbacks(): AgentSessionCallbacks & {
  onData: ReturnType<typeof vi.fn<AgentSessionCallbacks['onData']>>
  onExit: ReturnType<typeof vi.fn<AgentSessionCallbacks['onExit']>>
} {
  return { onData: vi.fn(), onExit: vi.fn() }
}

describe('AgentSession', () => {
  it('pty の出力を onData へ渡す', () => {
    const pty = makeFakePty()
    const callbacks = makeCallbacks()
    new AgentSession({ id: 's1', pty, callbacks, stopTree: vi.fn<StopTree>() })
    pty.emitData('hello')
    expect(callbacks.onData).toHaveBeenCalledWith('hello')
  })

  it('書き込み・リサイズを pty へ渡す', () => {
    const pty = makeFakePty()
    const session = new AgentSession({
      id: 's1',
      pty,
      callbacks: makeCallbacks(),
      stopTree: vi.fn<StopTree>()
    })
    session.write('abc')
    session.resize(100, 30)
    expect(pty.write).toHaveBeenCalledWith('abc')
    expect(pty.resize).toHaveBeenCalledWith(100, 30)
  })

  it('エージェント自身の終了は reason exited で通知し、購読を解除して exited を解決する', async () => {
    const pty = makeFakePty()
    const callbacks = makeCallbacks()
    const session = new AgentSession({ id: 's1', pty, callbacks, stopTree: vi.fn<StopTree>() })
    pty.emitExit(1)
    await session.exited
    expect(callbacks.onExit).toHaveBeenCalledWith({ exitCode: 1, signal: null, reason: 'exited' })
    expect(session.isAlive()).toBe(false)
    expect(pty.listenerCount()).toBe(0)
  })

  it('シグナルでの終了はシグナルの番号を渡す', () => {
    const pty = makeFakePty()
    const callbacks = makeCallbacks()
    new AgentSession({ id: 's1', pty, callbacks, stopTree: vi.fn<StopTree>() })
    pty.emitExit(0, 15)
    expect(callbacks.onExit).toHaveBeenCalledWith({ exitCode: 0, signal: 15, reason: 'exited' })
  })

  it('終了の後の書き込み・リサイズ・出力は無視する', () => {
    const pty = makeFakePty()
    const callbacks = makeCallbacks()
    const session = new AgentSession({ id: 's1', pty, callbacks, stopTree: vi.fn<StopTree>() })
    pty.emitExit(0)
    session.write('late')
    session.resize(10, 10)
    expect(pty.write).not.toHaveBeenCalled()
    expect(pty.resize).not.toHaveBeenCalled()
  })

  it('書き込み・リサイズの例外(EIO)は投げない', () => {
    const pty = makeFakePty()
    pty.write.mockImplementationOnce(() => {
      throw new Error('EIO')
    })
    pty.resize.mockImplementationOnce(() => {
      throw new Error('EBADF')
    })
    const session = new AgentSession({
      id: 's1',
      pty,
      callbacks: makeCallbacks(),
      stopTree: vi.fn<StopTree>()
    })
    expect(() => session.write('x')).not.toThrow()
    expect(() => session.resize(1, 1)).not.toThrow()
  })

  it('stop は stopTree を 1 回だけ呼び、終了の理由に stop の理由を使う', async () => {
    const pty = makeFakePty()
    const callbacks = makeCallbacks()
    const stopTree = vi.fn<StopTree>(async (_pty, exited) => {
      pty.emitExit(0, 15)
      await exited
    })
    const session = new AgentSession({ id: 's1', pty, callbacks, stopTree })
    const first = session.stop('folder-changed')
    const second = session.stop('stopped')
    expect(second).toBe(first)
    await first
    expect(stopTree).toHaveBeenCalledOnce()
    expect(stopTree.mock.calls[0][0]).toBe(pty)
    expect(callbacks.onExit).toHaveBeenCalledWith({
      exitCode: 0,
      signal: 15,
      reason: 'folder-changed'
    })
  })

  it('終了した後の stop は何もせずに解決する', async () => {
    const pty = makeFakePty()
    const stopTree = vi.fn<StopTree>()
    const session = new AgentSession({ id: 's1', pty, callbacks: makeCallbacks(), stopTree })
    pty.emitExit(0)
    await session.stop('stopped')
    expect(stopTree).not.toHaveBeenCalled()
  })
})

describe('startAgentSession', () => {
  it('xterm-256color・桁数・行数・作業ディレクトリ・環境変数で spawn する', () => {
    const pty = makeFakePty()
    const spawn = vi.fn<PtySpawn>().mockReturnValueOnce(pty)
    const session = startAgentSession({
      id: 's9',
      spawn,
      file: '/bin/claude',
      args: [],
      env: { PATH: '/p' },
      cwd: '/work',
      cols: 120,
      rows: 40,
      callbacks: makeCallbacks(),
      stopTree: vi.fn<StopTree>()
    })
    expect(spawn).toHaveBeenCalledWith('/bin/claude', [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: '/work',
      env: { PATH: '/p' }
    })
    expect(session.id).toBe('s9')
  })

  it('spawn の例外はそのまま投げる', () => {
    const spawn = vi.fn<PtySpawn>().mockImplementationOnce(() => {
      throw new Error('posix_spawnp failed.')
    })
    expect(() =>
      startAgentSession({
        id: 's',
        spawn,
        file: '/x',
        args: [],
        env: {},
        cwd: '/',
        cols: 80,
        rows: 24,
        callbacks: makeCallbacks(),
        stopTree: vi.fn<StopTree>()
      })
    ).toThrow('posix_spawnp failed.')
  })
})
```

`src/main/__tests__/agentSessionRegistry.test.ts`（新規）:

```ts
import { describe, it, expect, vi } from 'vitest'
import { AgentSession } from '../agentSession'
import type { StopTree } from '../agentSession'
import { AGENT_START_CANCELED_DETAIL, AgentSessionRegistry } from '../agentSessionRegistry'
import type { AgentSessionCreation } from '../agentSessionRegistry'
import { makeFakePty } from './helpers/fakePty'
import type { FakePty } from './helpers/fakePty'

// stop で pty の終了を起こす偽の stopTree を持つセッション
function makeSession(id: string): {
  session: AgentSession
  pty: FakePty
  stopTree: ReturnType<typeof vi.fn<StopTree>>
} {
  const pty = makeFakePty()
  const stopTree = vi.fn<StopTree>(async (_pty, exited) => {
    pty.emitExit(0, 15)
    await exited
  })
  const session = new AgentSession({
    id,
    pty,
    callbacks: { onData: vi.fn(), onExit: vi.fn() },
    stopTree
  })
  return { session, pty, stopTree }
}

const created = (session: AgentSession): (() => Promise<AgentSessionCreation>) =>
  vi.fn(async () => ({ kind: 'created' as const, session }))

describe('AgentSessionRegistry', () => {
  it('起動して started と sessionId を返し、snapshot と hasAny に出る', async () => {
    const registry = new AgentSessionRegistry()
    const { session } = makeSession('s1')
    await expect(registry.start(1, created(session))).resolves.toEqual({
      kind: 'started',
      sessionId: 's1'
    })
    expect(registry.snapshot(1)).toEqual({ sessionId: 's1' })
    expect(registry.hasAny()).toBe(true)
  })

  it('生きているセッションがあれば新しく起動せず already-running を返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session } = makeSession('s1')
    await registry.start(1, created(session))
    const second = vi.fn(
      async (): Promise<AgentSessionCreation> => ({
        kind: 'created',
        session: makeSession('s2').session
      })
    )
    await expect(registry.start(1, second)).resolves.toEqual({
      kind: 'already-running',
      sessionId: 's1'
    })
    expect(second).not.toHaveBeenCalled()
  })

  it('起動中に 2 回目の依頼が来たら、1 回目の結果を already-running で返す(StrictMode の二重の依頼)', async () => {
    const registry = new AgentSessionRegistry()
    const { session } = makeSession('s1')
    let release: () => void = () => undefined
    const slow = vi.fn(
      () =>
        new Promise<AgentSessionCreation>((resolve) => {
          release = () => resolve({ kind: 'created', session })
        })
    )
    const other = vi.fn(
      async (): Promise<AgentSessionCreation> => ({
        kind: 'created',
        session: makeSession('s2').session
      })
    )
    const first = registry.start(1, slow)
    const second = registry.start(1, other)
    release()
    await expect(first).resolves.toEqual({ kind: 'started', sessionId: 's1' })
    await expect(second).resolves.toEqual({ kind: 'already-running', sessionId: 's1' })
    expect(other).not.toHaveBeenCalled()
  })

  it('起動の失敗はそのまま返し、登録しない', async () => {
    const registry = new AgentSessionRegistry()
    const result = {
      kind: 'error' as const,
      error: 'command-not-found' as const,
      shellPathUnavailable: false
    }
    await expect(registry.start(1, async () => ({ kind: 'failed', result }))).resolves.toEqual(
      result
    )
    expect(registry.snapshot(1)).toBeNull()
    expect(registry.hasAny()).toBe(false)
  })

  it('別の所有者のセッションとは独立している', async () => {
    const registry = new AgentSessionRegistry()
    await registry.start(1, created(makeSession('s1').session))
    await expect(registry.start(2, created(makeSession('s2').session))).resolves.toEqual({
      kind: 'started',
      sessionId: 's2'
    })
  })

  it('書き込み・リサイズは sessionId が一致するときだけ渡す(古い画面からの書き込みを捨てる)', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty } = makeSession('s1')
    await registry.start(1, created(session))
    registry.write(1, 'old', 'x')
    registry.write(2, 's1', 'x')
    registry.resize(1, 'old', 10, 10)
    expect(pty.write).not.toHaveBeenCalled()
    expect(pty.resize).not.toHaveBeenCalled()
    registry.write(1, 's1', 'ok')
    registry.resize(1, 's1', 90, 20)
    expect(pty.write).toHaveBeenCalledWith('ok')
    expect(pty.resize).toHaveBeenCalledWith(90, 20)
  })

  it('stop は止めて登録を消す。sessionId が違えば止めない', async () => {
    const registry = new AgentSessionRegistry()
    const { session, stopTree } = makeSession('s1')
    await registry.start(1, created(session))
    await registry.stop(1, 'stopped', 'other')
    expect(stopTree).not.toHaveBeenCalled()
    await registry.stop(1, 'stopped', 's1')
    expect(stopTree).toHaveBeenCalledOnce()
    expect(registry.snapshot(1)).toBeNull()
    expect(registry.hasAny()).toBe(false)
  })

  it('エージェント自身が終了したら登録を消し、次の start で新しく起動する', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty } = makeSession('s1')
    await registry.start(1, created(session))
    pty.emitExit(0)
    await session.exited
    expect(registry.snapshot(1)).toBeNull()
    await expect(registry.start(1, created(makeSession('s2').session))).resolves.toEqual({
      kind: 'started',
      sessionId: 's2'
    })
  })

  it('起動の途中で stop されたら、できたセッションを止めて登録しない(所有者のいないセッションを残さない)', async () => {
    const registry = new AgentSessionRegistry()
    const { session, stopTree } = makeSession('s1')
    let release: () => void = () => undefined
    const slow = (): Promise<AgentSessionCreation> =>
      new Promise((resolve) => {
        release = () => resolve({ kind: 'created', session })
      })
    const starting = registry.start(1, slow)
    const stopping = registry.stop(1, 'stopped')
    release()
    await expect(starting).resolves.toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: AGENT_START_CANCELED_DETAIL
    })
    await stopping
    expect(stopTree).toHaveBeenCalledOnce()
    expect(registry.snapshot(1)).toBeNull()
  })

  it('stopAll はすべての所有者のセッションを止める', async () => {
    const registry = new AgentSessionRegistry()
    const a = makeSession('a')
    const b = makeSession('b')
    await registry.start(1, created(a.session))
    await registry.start(2, created(b.session))
    await registry.stopAll('stopped')
    expect(a.stopTree).toHaveBeenCalledOnce()
    expect(b.stopTree).toHaveBeenCalledOnce()
    expect(registry.hasAny()).toBe(false)
  })
})
```

`src/main/__tests__/agentSession.integration.test.ts`（新規。実物の node-pty と偽のエージェント。macOS・Linux の開発者のローカルで走らせる。パターン 41・46・113）:

```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn as ptySpawn } from 'node-pty'
import { startAgentSession } from '../agentSession'
import type { AgentSession, PtySpawn } from '../agentSession'
import { stopProcessTree } from '../agentProcessTree'
import { buildAgentPasteBytes, AGENT_CLEAR_INPUT_CHUNK } from '@shared/agentPasteText'
import {
  createTestTimers,
  isAlive,
  waitForFile,
  waitUntilDead,
  writeFakeExecutable
} from './helpers/processProbe'

// 実物の node-pty と偽のエージェント(sh のスクリプト)で、起動・書き込み・子孫の停止を確かめる。
// macOS・Linux の開発者のローカルで走らせる(Windows は対象外。パターン 41・46)
const spawn: PtySpawn = (file, args, options) => ptySpawn(file, args, options)
const timers = createTestTimers()
let dir: string
const started: AgentSession[] = []
const recordedPids: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-session-'))
})

afterEach(async () => {
  for (const session of started.splice(0)) await session.stop('stopped')
  // 失敗したテストが残した偽のエージェントの子孫を止める
  for (const file of recordedPids.splice(0)) {
    if (!existsSync(file)) continue
    for (const pid of readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line !== '')) {
      try {
        process.kill(Number(pid), 'SIGKILL')
      } catch {
        // 既に止まっている
      }
    }
  }
  timers.clearAll()
  rmSync(dir, { recursive: true, force: true })
})

function start(script: string, stopTreeGraceMs = 3000): AgentSession {
  const file = join(dir, 'fake-agent')
  writeFakeExecutable(file, script)
  const session = startAgentSession({
    id: 'it',
    spawn,
    file,
    args: [],
    env: { PATH: '/usr/bin:/bin', HOME: dir, LANG: 'en_US.UTF-8' },
    cwd: dir,
    cols: 80,
    rows: 24,
    callbacks: { onData: () => undefined, onExit: () => undefined },
    stopTree: (pty, exited) => stopProcessTree({ pid: pty.pid, exited, graceMs: stopTreeGraceMs })
  })
  started.push(session)
  return session
}

describe.skipIf(process.platform === 'win32')('AgentSession(実物の pty)', () => {
  it('作業ディレクトリで起動し、貼り付けのバイト列と Enter がそのまま届く', async () => {
    const out = join(dir, 'received')
    const session = start(
      `pwd > '${dir}/pwd'\nstty raw -echo\nprintf '\\033[?2004h'\nexec cat > '${out}'`
    )
    await waitForFile(join(dir, 'pwd'), timers)
    await timers.delay(200)
    session.write(AGENT_CLEAR_INPUT_CHUNK)
    session.write(buildAgentPasteBytes('line1\nline2') + '\r')
    const expected = AGENT_CLEAR_INPUT_CHUNK + '\x1b[200~line1\nline2\x1b[201~\r'
    const deadline = Date.now() + 5000
    while (
      Date.now() < deadline &&
      (!existsSync(out) || readFileSync(out, 'latin1') !== expected)
    ) {
      await timers.delay(20)
    }
    expect(readFileSync(out, 'latin1')).toBe(expected)
    expect(readFileSync(join(dir, 'pwd'), 'utf8').trim()).toMatch(/agent-session-/)
  }, 15_000)

  it('別のセッションへ抜けた孫(setsid)も、停止の後に残らない', async () => {
    const pids = join(dir, 'pids')
    recordedPids.push(pids)
    const session = start(
      `echo $$ >> '${pids}'\nperl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' sleep 60 &\necho $! >> '${pids}'\necho ready > '${dir}/ready'\nwait`
    )
    await waitForFile(join(dir, 'ready'), timers)
    const [agentPid, grandchildPid] = readFileSync(pids, 'utf8').trim().split('\n').map(Number)
    expect(isAlive(grandchildPid)).toBe(true)
    await session.stop('stopped')
    expect(await waitUntilDead(agentPid, timers)).toBe(true)
    expect(await waitUntilDead(grandchildPid, timers)).toBe(true)
  }, 15_000)

  it('SIGTERM を無視するエージェントと子も、猶予の後に止まる', async () => {
    const pids = join(dir, 'pids')
    recordedPids.push(pids)
    const session = start(
      `trap '' TERM\necho $$ >> '${pids}'\nsleep 60 &\necho $! >> '${pids}'\necho ready > '${dir}/ready'\nwait`,
      300
    )
    await waitForFile(join(dir, 'ready'), timers)
    const [agentPid, childPid] = readFileSync(pids, 'utf8').trim().split('\n').map(Number)
    await session.stop('stopped')
    expect(await waitUntilDead(agentPid, timers)).toBe(true)
    expect(await waitUntilDead(childPid, timers)).toBe(true)
    expect(session.isAlive()).toBe(false)
  }, 15_000)
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/main/__tests__/agentSession.test.ts src/main/__tests__/agentSessionRegistry.test.ts src/main/__tests__/agentSession.integration.test.ts
```

Expected: FAIL（`../agentSession`・`../agentSessionRegistry` が無い）

- [ ] **Step 3: 実装する**

`src/main/agentSession.ts`（新規）:

```ts
import type { AgentExitReason } from '@shared/types'

// 1 つのエージェントのセッション(pty の子の claude)。pty の生成は注入する(単体テストは偽物、結合テストは実物の node-pty)

export interface PtyDisposable {
  dispose(): void
}

/** node-pty の IPty のうち、このモジュールが使う部分 */
export interface PtyLike {
  readonly pid: number
  onData(listener: (data: string) => void): PtyDisposable
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): PtyDisposable
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

export interface PtySpawnOptions {
  name: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
}

export type PtySpawn = (file: string, args: string[], options: PtySpawnOptions) => PtyLike

export interface AgentSessionExitInfo {
  exitCode: number | null
  signal: number | null
  reason: AgentExitReason
}

export interface AgentSessionCallbacks {
  onData(data: string): void
  onExit(exit: AgentSessionExitInfo): void
}

/** 子孫を含めて止める(agentProcessTree.stopProcessTree を pid と終了の Promise で呼ぶ形) */
export type StopTree = (pty: PtyLike, exited: Promise<void>) => Promise<void>

export interface AgentSessionParams {
  id: string
  pty: PtyLike
  callbacks: AgentSessionCallbacks
  stopTree: StopTree
}

export class AgentSession {
  readonly id: string
  /** 子の終了で解決する */
  readonly exited: Promise<void>
  private readonly pty: PtyLike
  private readonly stopTree: StopTree
  private alive = true
  private stopReason: AgentExitReason | null = null
  private stopping: Promise<void> | null = null
  private readonly subscriptions: PtyDisposable[]

  constructor({ id, pty, callbacks, stopTree }: AgentSessionParams) {
    this.id = id
    this.pty = pty
    this.stopTree = stopTree
    let markExited: () => void = () => undefined
    this.exited = new Promise((resolve) => {
      markExited = resolve
    })
    this.subscriptions = [
      pty.onData((data) => {
        if (this.alive) callbacks.onData(data)
      }),
      pty.onExit(({ exitCode, signal }) => {
        if (!this.alive) return
        this.alive = false
        for (const subscription of this.subscriptions) subscription.dispose()
        callbacks.onExit({
          exitCode: Number.isInteger(exitCode) ? exitCode : null,
          signal: signal === undefined || signal === 0 ? null : signal,
          reason: this.stopReason ?? 'exited'
        })
        markExited()
      })
    ]
  }

  get pid(): number {
    return this.pty.pid
  }

  isAlive(): boolean {
    return this.alive
  }

  /** キー入力・貼り付けを送る。終了した後は何もしない */
  write(data: string): void {
    if (!this.alive) return
    try {
      this.pty.write(data)
    } catch {
      // 終了の直前の書き込みの失敗(EIO など)は、終了の通知で扱う
    }
  }

  resize(cols: number, rows: number): void {
    if (!this.alive) return
    try {
      this.pty.resize(cols, rows)
    } catch {
      // 終了の直前のリサイズの失敗は無視する
    }
  }

  /** 子孫を含めて止め、終了を待って解決する。二重に呼ばれても 1 回だけ動き、最初の理由を使う */
  stop(reason: AgentExitReason): Promise<void> {
    if (this.stopping !== null) return this.stopping
    if (!this.alive) return Promise.resolve()
    this.stopReason = reason
    this.stopping = this.stopTree(this.pty, this.exited)
    return this.stopping
  }
}

export interface StartAgentSessionParams {
  id: string
  spawn: PtySpawn
  file: string
  args: string[]
  env: Record<string, string>
  cwd: string
  cols: number
  rows: number
  callbacks: AgentSessionCallbacks
  stopTree: StopTree
}

/** pty で起動する。spawn の例外はそのまま投げる(呼び出し側が spawn-failed にする) */
export function startAgentSession({
  id,
  spawn,
  file,
  args,
  env,
  cwd,
  cols,
  rows,
  callbacks,
  stopTree
}: StartAgentSessionParams): AgentSession {
  const pty = spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env })
  return new AgentSession({ id, pty, callbacks, stopTree })
}
```

`src/main/agentSessionRegistry.ts`（新規）:

```ts
import type { AgentExitReason, AgentSessionSnapshot, AgentStartResult } from '@shared/types'
import type { AgentSession } from './agentSession'

// webContents の id → エージェントのセッション(1 ウィンドウに 1 つ)。Electron に依存しない。
// 起動の依頼の重複(StrictMode の 2 回目など。確認の結果 10)は 1 つにまとめ、2 回目は既存の sessionId を返す

export type AgentSessionCreation =
  | { kind: 'created'; session: AgentSession }
  | { kind: 'failed'; result: Extract<AgentStartResult, { kind: 'error' }> }

export const AGENT_START_CANCELED_DETAIL = '起動の途中で停止されました'

export class AgentSessionRegistry {
  private readonly sessions = new Map<number, AgentSession>()
  private readonly pending = new Map<number, Promise<AgentStartResult>>()
  // 起動の途中で stop が来たかを見分ける世代。stop のたびに進める
  private readonly generations = new Map<number, number>()

  private generationOf(ownerId: number): number {
    return this.generations.get(ownerId) ?? 0
  }

  /** 起動する。生きているセッション・起動中の依頼があれば、新しく起動せず既存の sessionId を返す */
  async start(
    ownerId: number,
    create: () => Promise<AgentSessionCreation>
  ): Promise<AgentStartResult> {
    const existing = this.sessions.get(ownerId)
    if (existing?.isAlive()) return { kind: 'already-running', sessionId: existing.id }
    const inFlight = this.pending.get(ownerId)
    if (inFlight !== undefined) {
      const result = await inFlight
      return result.kind === 'started'
        ? { kind: 'already-running', sessionId: result.sessionId }
        : result
    }
    const generation = this.generationOf(ownerId)
    const run = (async (): Promise<AgentStartResult> => {
      const creation = await create()
      if (creation.kind === 'failed') return creation.result
      const { session } = creation
      // 起動の途中でリロード・破棄・フォルダの切り替えが来ていたら、所有者のいないセッションを残さない
      if (generation !== this.generationOf(ownerId)) {
        await session.stop('stopped')
        return { kind: 'error', error: 'spawn-failed', detail: AGENT_START_CANCELED_DETAIL }
      }
      this.sessions.set(ownerId, session)
      void session.exited.then(() => {
        if (this.sessions.get(ownerId) === session) this.sessions.delete(ownerId)
      })
      return { kind: 'started', sessionId: session.id }
    })()
    this.pending.set(ownerId, run)
    try {
      return await run
    } finally {
      if (this.pending.get(ownerId) === run) this.pending.delete(ownerId)
    }
  }

  /** sessionId が所有者の現在のセッションと一致するときだけ書き込む(古い画面からの書き込みを捨てる) */
  write(ownerId: number, sessionId: string, data: string): void {
    const session = this.sessions.get(ownerId)
    if (session?.id === sessionId) session.write(data)
  }

  resize(ownerId: number, sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(ownerId)
    if (session?.id === sessionId) session.resize(cols, rows)
  }

  /** 所有者のセッションを止める(sessionId を渡したら一致するときだけ)。起動中の依頼も無効にする */
  async stop(ownerId: number, reason: AgentExitReason, sessionId?: string): Promise<void> {
    const session = this.sessions.get(ownerId)
    if (sessionId !== undefined && session?.id !== sessionId) return
    this.generations.set(ownerId, this.generationOf(ownerId) + 1)
    const pending = this.pending.get(ownerId)
    if (session !== undefined) await session.stop(reason)
    // 起動中の依頼は、完了の時点で世代の違いを見て自分で止まる。その完了まで待つ
    if (pending !== undefined) await pending.catch(() => undefined)
  }

  /** すべてのセッションを止める(アプリの終了) */
  async stopAll(reason: AgentExitReason): Promise<void> {
    const owners = new Set([...this.sessions.keys(), ...this.pending.keys()])
    await Promise.all([...owners].map((ownerId) => this.stop(ownerId, reason)))
  }

  snapshot(ownerId: number): AgentSessionSnapshot {
    const session = this.sessions.get(ownerId)
    return session?.isAlive() ? { sessionId: session.id } : null
  }

  /** 生きているセッションか起動中の依頼があるか */
  hasAny(): boolean {
    return [...this.sessions.values()].some((session) => session.isAlive()) || this.pending.size > 0
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/main/__tests__/agentSession.test.ts src/main/__tests__/agentSessionRegistry.test.ts src/main/__tests__/agentSession.integration.test.ts
npm run typecheck
npx eslint src/main/agentSession.ts src/main/agentSessionRegistry.ts src/main/__tests__/helpers/fakePty.ts src/main/__tests__/agentSession.test.ts src/main/__tests__/agentSessionRegistry.test.ts src/main/__tests__/agentSession.integration.test.ts
npx prettier --check src/main/agentSession.ts src/main/agentSessionRegistry.ts src/main/__tests__/helpers/fakePty.ts src/main/__tests__/agentSession.test.ts src/main/__tests__/agentSessionRegistry.test.ts src/main/__tests__/agentSession.integration.test.ts
pgrep -fl "sleep 60" || echo "no leftover"
```

Expected: PASS（10 + 10 + 3 件。結合テストは約 2 秒）。`no leftover`。負荷をかけても通ることを、結合テストを 4 本同時に流して確かめる（パターン 113・114）:

```bash
for i in 1 2 3 4; do npx vitest run src/main/__tests__/agentSession.integration.test.ts > /tmp/agent-it-$i.log 2>&1 & done; wait
grep -h "Tests " /tmp/agent-it-*.log; rm -f /tmp/agent-it-*.log
pgrep -fl "sleep 60" || echo "no leftover"
```

Expected: 4 行とも `Tests  3 passed (3)`。`no leftover`

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                         | テストのファイル               | `-t`                               | 確認           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------- | -------------- |
| A1  | `agentSession.ts` の `reason: this.stopReason ?? 'exited'` を `reason: 'exited'` にする                                                      | `agentSession.test.ts`         | `stop は stopTree を 1 回だけ呼び` | 落ちた（1 件） |
| A2  | `agentSession.ts` の `if (this.stopping !== null) return this.stopping` を消す                                                               | `agentSession.test.ts`         | `stop は stopTree を 1 回だけ呼び` | 落ちた（1 件） |
| A3  | `agentSession.ts` の `write(data: string): void { ⏎ if (!this.alive) return` を `write(data: string): void {` にする                         | `agentSession.test.ts`         | `終了の後の書き込み`               | 落ちた（1 件） |
| A4  | `agentSessionRegistry.ts` の `if (inFlight !== undefined) {` を `if (inFlight !== undefined && false) {` にする                              | `agentSessionRegistry.test.ts` | `起動中に 2 回目の依頼`            | 落ちた（1 件） |
| A5  | `agentSessionRegistry.ts` の `if (generation !== this.generationOf(ownerId)) {` を `if (false) {` にする                                     | `agentSessionRegistry.test.ts` | `起動の途中で stop されたら`       | 落ちた（1 件） |
| A6  | `agentSessionRegistry.ts` の `if (session?.id === sessionId) session.write(data)` を `if (session !== undefined) session.write(data)` にする | `agentSessionRegistry.test.ts` | `書き込み・リサイズは sessionId`   | 落ちた（1 件） |

| #   | 変異（Task 5 の T1 と同じ）                                                                                         | テストのファイル                   | `-t`     | 確認           |
| --- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------- | -------------- |
| T1b | `agentProcessTree.ts` の `if (isProcessAlive(kill, child)) safeKill(kill, child, 'SIGKILL')` を `void child` にする | `agentSession.integration.test.ts` | `setsid` | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/main
```

---

### Task 7: main: 寿命（`FolderAccessManager.onDidChange`・`agentSessionLifecycle`）

**Files:**

- Create: `src/main/agentSessionLifecycle.ts`、`src/main/__tests__/agentSessionLifecycle.test.ts`
- Modify: `src/main/folderAccessManager.ts:4-13`（`set` で前と違うパスになったときに通知する・`onDidChange`）、`src/main/__tests__/folderAccessManager.test.ts`（末尾に追加）

**Interfaces:**

- Consumes: `AgentSessionRegistry`（Task 6）、`AGENT_KILL_GRACE_MS`（Task 5）
- Produces: `type FolderChangeListener = (webContentsId: number, path: string) => void`、`FolderAccessManager.onDidChange(listener): () => void`、`AGENT_QUIT_TIMEOUT_MS = 4_000`、`setupAgentSessionLifecycle(app: App, registry, folderAccess, { quitTimeoutMs? }?): void`
- 注: `FolderAccessManager` はセッションを知らない（依存の向き。設計書）。`delete`（ウィンドウの破棄）は通知しない（`destroyed` で扱う）。同じパスの `set`（同じフォルダを開き直す）は通知しない（差異 23）。`before-quit` は再入の印を持ち、2 回目は素通しする

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/agentSessionLifecycle.test.ts`（新規）:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { FolderAccessManager } from '../folderAccessManager'
import { AgentSessionRegistry } from '../agentSessionRegistry'
import { setupAgentSessionLifecycle } from '../agentSessionLifecycle'

afterEach(() => {
  vi.useRealTimers()
})

// 偽の app(EventEmitter に quit を足したもの)と、stop・stopAll・hasAny を記録する registry
function setup(options: { hasAny?: boolean; stopAll?: () => Promise<void> } = {}): {
  app: EventEmitter & { quit: ReturnType<typeof vi.fn> }
  registry: AgentSessionRegistry
  stop: ReturnType<typeof vi.spyOn>
  folderAccess: FolderAccessManager
} {
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() })
  const registry = new AgentSessionRegistry()
  const stop = vi.spyOn(registry, 'stop').mockResolvedValue(undefined)
  vi.spyOn(registry, 'hasAny').mockReturnValue(options.hasAny ?? false)
  vi.spyOn(registry, 'stopAll').mockImplementation(options.stopAll ?? (async () => undefined))
  const folderAccess = new FolderAccessManager()
  setupAgentSessionLifecycle(app as unknown as App, registry, folderAccess, { quitTimeoutMs: 4000 })
  return { app, registry, stop, folderAccess }
}

function createWebContents(app: EventEmitter, id: number): EventEmitter {
  const webContents = Object.assign(new EventEmitter(), { id })
  app.emit('web-contents-created', {}, webContents)
  return webContents
}

describe('setupAgentSessionLifecycle', () => {
  it('ウィンドウの破棄でそのウィンドウのセッションを止める', () => {
    const { app, stop } = setup()
    const closing = createWebContents(app, 1)
    createWebContents(app, 2)
    closing.emit('destroyed')
    expect(stop).toHaveBeenCalledExactlyOnceWith(1, 'stopped')
  })

  it.each([
    [
      'メインフレームの別文書への遷移(リロード)で止める',
      { isMainFrame: true, isSameDocument: false },
      true
    ],
    ['同じ文書内の遷移では止めない', { isMainFrame: true, isSameDocument: true }, false],
    ['サブフレームの遷移では止めない', { isMainFrame: false, isSameDocument: false }, false]
  ])('%s', (_label, details, stopped) => {
    const { app, stop } = setup()
    const navigating = createWebContents(app, 1)
    navigating.emit('did-start-navigation', { url: 'app://index.html', frame: null, ...details })
    expect(stop.mock.calls).toEqual(stopped ? [[1, 'stopped']] : [])
  })

  it('フォルダが別のパスに変わったら folder-changed で止める。同じパスなら止めない', () => {
    const { stop, folderAccess } = setup()
    folderAccess.set(1, '/a')
    stop.mockClear()
    folderAccess.set(1, '/a')
    expect(stop).not.toHaveBeenCalled()
    folderAccess.set(1, '/b')
    expect(stop).toHaveBeenCalledExactlyOnceWith(1, 'folder-changed')
  })

  it('セッションが無ければ終了を止めない', () => {
    const { app } = setup({ hasAny: false })
    const event = { preventDefault: vi.fn() }
    app.emit('before-quit', event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('セッションがあれば終了を止め、止め終わってから quit し直す。2 回目の before-quit は素通しする', async () => {
    let release: () => void = () => undefined
    const { app } = setup({
      hasAny: true,
      stopAll: () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    })
    const first = { preventDefault: vi.fn() }
    app.emit('before-quit', first)
    expect(first.preventDefault).toHaveBeenCalledOnce()
    expect(app.quit).not.toHaveBeenCalled()
    release()
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
    const second = { preventDefault: vi.fn() }
    app.emit('before-quit', second)
    expect(second.preventDefault).not.toHaveBeenCalled()
  })

  it('停止が終わらなくても上限の時間で quit し直す', async () => {
    vi.useFakeTimers()
    const { app } = setup({ hasAny: true, stopAll: () => new Promise<void>(() => undefined) })
    app.emit('before-quit', { preventDefault: vi.fn() })
    await vi.advanceTimersByTimeAsync(3999)
    expect(app.quit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(app.quit).toHaveBeenCalledOnce()
  })
})
```

`src/main/__tests__/folderAccessManager.test.ts`（末尾に追加）:

```diff
--- a/src/main/__tests__/folderAccessManager.test.ts
+++ b/src/main/__tests__/folderAccessManager.test.ts
@@ -181,3 +181,32 @@
     })
   })
 })
+
+describe('FolderAccessManager.onDidChange', () => {
+  it('別のパスに変わったときだけ通知し、解除の後は通知しない', () => {
+    const manager = new FolderAccessManager()
+    const listener = vi.fn()
+    const dispose = manager.onDidChange(listener)
+    manager.set(1, '/a')
+    manager.set(1, '/a')
+    manager.set(1, '/b')
+    manager.set(2, '/b')
+    expect(listener.mock.calls).toEqual([
+      [1, '/a'],
+      [1, '/b'],
+      [2, '/b']
+    ])
+    dispose()
+    manager.set(1, '/c')
+    expect(listener).toHaveBeenCalledTimes(3)
+  })
+
+  it('delete は通知しない(ウィンドウの破棄は destroyed で扱う)', () => {
+    const manager = new FolderAccessManager()
+    manager.set(1, '/a')
+    const listener = vi.fn()
+    manager.onDidChange(listener)
+    manager.delete(1)
+    expect(listener).not.toHaveBeenCalled()
+  })
+})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/main/__tests__/agentSessionLifecycle.test.ts src/main/__tests__/folderAccessManager.test.ts
```

Expected: FAIL（`../agentSessionLifecycle` が無い。`manager.onDidChange is not a function` の 2 件）

- [ ] **Step 3: 実装する**

`src/main/folderAccessManager.ts`（差分）:

```diff
--- a/src/main/folderAccessManager.ts
+++ b/src/main/folderAccessManager.ts
@@ -1,13 +1,29 @@
 import { realpath } from 'node:fs/promises'
 import { sep } from 'node:path'

+/** 開いているフォルダが変わったときの通知(webContents の id と新しいフォルダ) */
+export type FolderChangeListener = (webContentsId: number, path: string) => void
+
 export class FolderAccessManager {
   private readonly folders = new Map<number, string>()
+  private readonly changeListeners = new Set<FolderChangeListener>()

+  /** フォルダを設定する。前と違うパスになったときだけ購読者へ通知する(同じフォルダを開き直したときは通知しない) */
   set(webContentsId: number, path: string): void {
+    const previous = this.folders.get(webContentsId)
     this.folders.set(webContentsId, path)
+    if (previous === path) return
+    for (const listener of [...this.changeListeners]) listener(webContentsId, path)
   }

+  /** フォルダの変更を購読する。戻り値で解除する(セッションの停止・監視の解除が使う。FolderAccessManager はそれらを知らない) */
+  onDidChange(listener: FolderChangeListener): () => void {
+    this.changeListeners.add(listener)
+    return () => {
+      this.changeListeners.delete(listener)
+    }
+  }
+
   get(webContentsId: number): string | undefined {
     return this.folders.get(webContentsId)
   }
```

`src/main/agentSessionLifecycle.ts`（新規）:

```ts
import type { App } from 'electron'
import type { FolderAccessManager } from './folderAccessManager'
import type { AgentSessionRegistry } from './agentSessionRegistry'
import { AGENT_KILL_GRACE_MS } from './agentProcessTree'

// エージェントのセッションを止める契機(設計書「停止の契機」)。ウィンドウの破棄(destroyed)、renderer のリロード(メインフレームの
// 別文書への遷移。cloneLifecycle.ts と同じ条件)、フォルダの切り替え(作業ディレクトリ = 許可のフォルダ の不変条件を守る)、
// アプリの終了(before-quit で止め終わるのを待ってから終了し直す)

/** アプリの終了で、停止を待つ上限(猶予 + 1 秒) */
export const AGENT_QUIT_TIMEOUT_MS = AGENT_KILL_GRACE_MS + 1_000

export interface AgentSessionLifecycleOptions {
  quitTimeoutMs?: number
}

export function setupAgentSessionLifecycle(
  app: App,
  registry: AgentSessionRegistry,
  folderAccess: FolderAccessManager,
  { quitTimeoutMs = AGENT_QUIT_TIMEOUT_MS }: AgentSessionLifecycleOptions = {}
): void {
  app.on('web-contents-created', (_event, webContents) => {
    webContents.on('destroyed', () => void registry.stop(webContents.id, 'stopped'))
    webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument)
        void registry.stop(webContents.id, 'stopped')
    })
  })

  folderAccess.onDidChange((webContentsId) => void registry.stop(webContentsId, 'folder-changed'))

  // 終了を止めて全セッションを止め、終わったら(または上限で)もう一度 quit する。2 回目の before-quit は素通しする
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting || !registry.hasAny()) return
    event.preventDefault()
    quitting = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, quitTimeoutMs)
    })
    void Promise.race([registry.stopAll('stopped').catch(() => undefined), timeout]).then(() => {
      clearTimeout(timer)
      app.quit()
    })
  })
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/main/__tests__/agentSessionLifecycle.test.ts src/main/__tests__/folderAccessManager.test.ts src/main/__tests__/handlers/fileSystemHandlers.test.ts src/main/__tests__/handlers/cloneHandlers.test.ts
npm run typecheck
npx eslint src/main/folderAccessManager.ts src/main/agentSessionLifecycle.ts src/main/__tests__/agentSessionLifecycle.test.ts src/main/__tests__/folderAccessManager.test.ts
npx prettier --check src/main/folderAccessManager.ts src/main/agentSessionLifecycle.ts src/main/__tests__/agentSessionLifecycle.test.ts src/main/__tests__/folderAccessManager.test.ts
```

Expected: PASS（`agentSessionLifecycle` 8 件・`folderAccessManager` 23 件。`FolderAccessManager` を使う既存のハンドラのテストも通る）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                                       | テストのファイル                | `-t`                                | 確認           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------- | -------------- |
| L1  | `folderAccessManager.ts` の `if (previous === path) return` を消す                                                                                                         | `folderAccessManager.test.ts`   | `別のパスに変わったときだけ通知`    | 落ちた（1 件） |
| L2  | `agentSessionLifecycle.ts` の `if (details.isMainFrame && !details.isSameDocument)` を `if (details.isMainFrame)` にする                                                   | `agentSessionLifecycle.test.ts` | `同じ文書内の遷移では止めない`      | 落ちた（1 件） |
| L3  | `agentSessionLifecycle.ts` の `if (quitting \|\| !registry.hasAny()) return` を `if (!registry.hasAny()) return` にする                                                    | `agentSessionLifecycle.test.ts` | `2 回目の before-quit は素通しする` | 落ちた（1 件） |
| L4  | `agentSessionLifecycle.ts` の `Promise.race([registry.stopAll('stopped').catch(() => undefined), timeout])` を `registry.stopAll('stopped').catch(() => undefined)` にする | `agentSessionLifecycle.test.ts` | `上限の時間で quit し直す`          | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/main
```

---

### Task 8: main: エージェントの IPC（入力の検証・受け口・実物の依存の組み立て）

**Files:**

- Create: `src/main/handlers/agentTerminalPayloadParser.ts`、`src/main/handlers/agentTerminalHandlers.ts`、`src/main/agentRuntime.ts`、`src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts`、`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`

**Interfaces:**

- Consumes: `AgentStartRequest`・`AgentStartResult`・`AgentSessionData`・`AgentSessionExit`・`AgentSessionSnapshot`・`AGENT_TERMINAL_*`・`AGENT_WRITE_MAX_LENGTH`（Task 2）、`assertPlainObject`（既存 `handlers/payloadValidators.ts`）、`FolderAccessManager`（既存 + Task 7）、`AgentSessionRegistry`・`AgentSessionCreation`・`startAgentSession`・`PtySpawn`・`StopTree`（Task 6）、`AgentLaunchResolution`・`resolveAgentLaunch`・`isExecutableRegularFile`（Task 4）、`readLoginShellPath`（Task 3）、`stopProcessTree`（Task 5）
- Produces: `parseAgentStartRequest(payload): AgentStartRequest`（不正は投げる）、`parseAgentSessionId(value): string`（投げる）、`parseAgentWrite(sessionId, data): { sessionId; data } | null`、`parseAgentResize(sessionId, cols, rows): { sessionId; cols; rows } | null`、`isMainFrameSender(event: { senderFrame: { parent: unknown } | null }): boolean`、`interface AgentTerminalHandlerDeps { folderAccess; registry; resolveLaunch; spawnPty; stopTree; createSessionId?; platform? }`、`registerAgentTerminalHandlers(ipcMain, deps): void`、`spawnAgentPty: PtySpawn`・`resolveAgentLaunchFromSystem(): Promise<AgentLaunchResolution>`・`stopAgentPtyTree: StopTree`（`agentRuntime.ts`。実物の node-pty・ログインシェル・ps を使う。配線は Task 12）
- 注: 判定の順序は設計書「セッションの開始」2〜5（`no-folder` → `folder-mismatch`（realpath で比べる）→ 既存のセッション（`already-running`）→ `folder-missing` → `command-not-found` → `spawn-failed`）。作業ディレクトリは renderer の文字列ではなく許可のフォルダ。send（write・resize・focus）の不正な入力は投げずに捨てる（listener で投げても renderer に届かない）。送信元がメインフレームでなければ invoke は投げ、send は捨てる。`setIgnoreMenuShortcuts` は macOS では呼ばない

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts`（新規）:

```ts
import { describe, it, expect } from 'vitest'
import {
  isMainFrameSender,
  parseAgentResize,
  parseAgentSessionId,
  parseAgentStartRequest,
  parseAgentWrite
} from '../../handlers/agentTerminalPayloadParser'

describe('parseAgentStartRequest', () => {
  it('folderPath・cols・rows を返す', () => {
    expect(parseAgentStartRequest({ folderPath: '/p', cols: 80, rows: 24 })).toEqual({
      folderPath: '/p',
      cols: 80,
      rows: 24
    })
  })
  it.each([
    ['オブジェクトでない', null],
    ['folderPath が空', { folderPath: '', cols: 80, rows: 24 }],
    ['folderPath が文字列でない', { folderPath: 1, cols: 80, rows: 24 }],
    ['cols が下限未満', { folderPath: '/p', cols: 1, rows: 24 }],
    ['cols が上限超え', { folderPath: '/p', cols: 501, rows: 24 }],
    ['cols が整数でない', { folderPath: '/p', cols: 80.5, rows: 24 }],
    ['rows が下限未満', { folderPath: '/p', cols: 80, rows: 0 }],
    ['rows が上限超え', { folderPath: '/p', cols: 80, rows: 301 }],
    ['rows が文字列', { folderPath: '/p', cols: 80, rows: '24' }]
  ])('%s なら投げる', (_label, payload) => {
    expect(() => parseAgentStartRequest(payload)).toThrow()
  })
  it('境界の値(2・500・1・300)は通す', () => {
    expect(() => parseAgentStartRequest({ folderPath: '/p', cols: 2, rows: 1 })).not.toThrow()
    expect(() => parseAgentStartRequest({ folderPath: '/p', cols: 500, rows: 300 })).not.toThrow()
  })
})

describe('parseAgentWrite', () => {
  it('文字列の sessionId と 1,000,000 文字以下の data を通す', () => {
    expect(parseAgentWrite('s', 'a'.repeat(1_000_000))).toEqual({
      sessionId: 's',
      data: 'a'.repeat(1_000_000)
    })
  })
  it.each([
    ['sessionId が空', '', 'x'],
    ['sessionId が文字列でない', 1, 'x'],
    ['data が文字列でない', 's', 1],
    ['data が上限超え', 's', 'a'.repeat(1_000_001)]
  ])('%s なら null', (_label, sessionId, data) => {
    expect(parseAgentWrite(sessionId, data)).toBeNull()
  })
})

describe('parseAgentResize', () => {
  it('範囲内の整数を通す', () => {
    expect(parseAgentResize('s', 100, 30)).toEqual({ sessionId: 's', cols: 100, rows: 30 })
  })
  it.each([
    ['cols が範囲外', 's', 600, 30],
    ['rows が範囲外', 's', 100, 0],
    ['整数でない', 's', 100.1, 30],
    ['sessionId が無い', undefined, 100, 30]
  ])('%s なら null', (_label, sessionId, cols, rows) => {
    expect(parseAgentResize(sessionId, cols, rows)).toBeNull()
  })
})

describe('parseAgentSessionId', () => {
  it('空でない文字列を返し、それ以外は投げる', () => {
    expect(parseAgentSessionId('s')).toBe('s')
    expect(() => parseAgentSessionId('')).toThrow()
    expect(() => parseAgentSessionId(undefined)).toThrow()
  })
})

describe('isMainFrameSender', () => {
  it('親の無いフレームだけを通す', () => {
    expect(isMainFrameSender({ senderFrame: { parent: null } })).toBe(true)
    expect(isMainFrameSender({ senderFrame: { parent: {} } })).toBe(false)
    expect(isMainFrameSender({ senderFrame: null })).toBe(false)
  })
})
```

`src/main/__tests__/handlers/agentTerminalHandlers.test.ts`（新規。`node:fs/promises` の `realpath`・`stat` を差し替え、偽の pty で起動する）:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve as resolvePath } from 'node:path'

const mockRealpath = vi.hoisted(() => vi.fn())
const mockStat = vi.hoisted(() => vi.fn())
vi.mock('node:fs/promises', () => ({
  default: { realpath: mockRealpath, stat: mockStat },
  realpath: mockRealpath,
  stat: mockStat
}))

import { FolderAccessManager } from '../../folderAccessManager'
import { AgentSessionRegistry } from '../../agentSessionRegistry'
import { registerAgentTerminalHandlers } from '../../handlers/agentTerminalHandlers'
import type { AgentTerminalHandlerDeps } from '../../handlers/agentTerminalHandlers'
import type { PtySpawn, StopTree } from '../../agentSession'
import type { AgentLaunchResolution } from '../../agentCommand'
import { makeFakePty } from '../helpers/fakePty'
import type { FakePty } from '../helpers/fakePty'

type Listener = (...args: unknown[]) => unknown
const handles = new Map<string, Listener>()
const listeners = new Map<string, Listener>()
const ipcMain = {
  handle: vi.fn((channel: string, listener: Listener) => handles.set(channel, listener)),
  on: vi.fn((channel: string, listener: Listener) => listeners.set(channel, listener))
}

interface FakeSender {
  id: number
  send: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  setIgnoreMenuShortcuts: ReturnType<typeof vi.fn>
}

function makeEvent(id = 1, main = true): { sender: FakeSender; senderFrame: { parent: unknown } } {
  return {
    sender: { id, send: vi.fn(), isDestroyed: vi.fn(() => false), setIgnoreMenuShortcuts: vi.fn() },
    senderFrame: { parent: main ? null : {} }
  }
}

let folderAccess: FolderAccessManager
let registry: AgentSessionRegistry
let pty: FakePty
let spawnPty: ReturnType<typeof vi.fn<PtySpawn>>
let resolveLaunch: ReturnType<typeof vi.fn<() => Promise<AgentLaunchResolution>>>
const stopTree = vi.fn<StopTree>(async (target, exited) => {
  ;(target as FakePty).emitExit(0, 15)
  await exited
})

function register(overrides: Partial<AgentTerminalHandlerDeps> = {}): void {
  registerAgentTerminalHandlers(ipcMain as never, {
    folderAccess,
    registry,
    resolveLaunch,
    spawnPty,
    stopTree,
    createSessionId: () => 'sid-1',
    platform: 'linux',
    ...overrides
  })
}

const start = (event: ReturnType<typeof makeEvent>, payload: unknown): Promise<unknown> =>
  handles.get('agentTerminal:start')?.(event, payload) as Promise<unknown>

beforeEach(() => {
  handles.clear()
  listeners.clear()
  vi.clearAllMocks()
  mockRealpath.mockImplementation((p: string) => Promise.resolve(resolvePath(p)))
  mockStat.mockResolvedValue({ isDirectory: () => true })
  folderAccess = new FolderAccessManager()
  registry = new AgentSessionRegistry()
  pty = makeFakePty(4242)
  spawnPty = vi.fn<PtySpawn>().mockReturnValue(pty)
  resolveLaunch = vi.fn(async () => ({
    kind: 'ok' as const,
    plan: { file: '/bin/claude', args: [], env: { PATH: '/p' } }
  }))
})

describe('agentTerminal:start', () => {
  it('許可のフォルダを作業ディレクトリに、main が決めたコマンドで起動し、started を返す', async () => {
    register()
    folderAccess.set(1, '/work')
    // renderer の文字列(realpath が許可と一致する別の表記)ではなく、許可のフォルダを作業ディレクトリにする
    await expect(
      start(makeEvent(), { folderPath: '/work/.', cols: 90, rows: 20 })
    ).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1'
    })
    expect(spawnPty).toHaveBeenCalledWith('/bin/claude', [], {
      name: 'xterm-256color',
      cols: 90,
      rows: 20,
      cwd: '/work',
      env: { PATH: '/p' }
    })
  })

  it('許可のフォルダが無ければ no-folder', async () => {
    register()
    await expect(start(makeEvent(), { folderPath: '/work', cols: 90, rows: 20 })).resolves.toEqual({
      kind: 'error',
      error: 'no-folder'
    })
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('renderer のフォルダの realpath が許可と違えば folder-mismatch', async () => {
    register()
    folderAccess.set(1, '/work')
    await expect(start(makeEvent(), { folderPath: '/other', cols: 90, rows: 20 })).resolves.toEqual(
      {
        kind: 'error',
        error: 'folder-mismatch'
      }
    )
  })

  it('フォルダが無くなっていれば folder-missing(パスを添える)', async () => {
    register()
    folderAccess.set(1, '/work')
    mockStat.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await expect(start(makeEvent(), { folderPath: '/work', cols: 90, rows: 20 })).resolves.toEqual({
      kind: 'error',
      error: 'folder-missing',
      detail: '/work'
    })
  })

  it('claude が見つからなければ command-not-found(PATH の取得の失敗を添える)', async () => {
    register()
    folderAccess.set(1, '/work')
    resolveLaunch.mockResolvedValueOnce({ kind: 'not-found', shellPathUnavailable: true })
    await expect(start(makeEvent(), { folderPath: '/work', cols: 90, rows: 20 })).resolves.toEqual({
      kind: 'error',
      error: 'command-not-found',
      shellPathUnavailable: true
    })
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('spawn が投げたら spawn-failed(例外の文言を添える)', async () => {
    register()
    folderAccess.set(1, '/work')
    spawnPty.mockImplementationOnce(() => {
      throw new Error('posix_spawnp failed.')
    })
    await expect(start(makeEvent(), { folderPath: '/work', cols: 90, rows: 20 })).resolves.toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: 'posix_spawnp failed.'
    })
  })

  it('同じウィンドウの 2 回目の依頼は起動せず already-running', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { folderPath: '/work', cols: 90, rows: 20 })
    await expect(start(event, { folderPath: '/work', cols: 90, rows: 20 })).resolves.toEqual({
      kind: 'already-running',
      sessionId: 'sid-1'
    })
    expect(spawnPty).toHaveBeenCalledOnce()
  })

  it('不正な入力・サブフレームからの依頼は投げる', async () => {
    register()
    folderAccess.set(1, '/work')
    await expect(start(makeEvent(), { folderPath: '/work', cols: 0, rows: 20 })).rejects.toThrow()
    await expect(
      start(makeEvent(1, false), { folderPath: '/work', cols: 90, rows: 20 })
    ).rejects.toThrow()
  })

  it('出力と終了を送信元へ送り、破棄済みなら送らない', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { folderPath: '/work', cols: 90, rows: 20 })
    pty.emitData('hi')
    expect(event.sender.send).toHaveBeenCalledWith('agentTerminal:data', {
      sessionId: 'sid-1',
      data: 'hi'
    })
    event.sender.isDestroyed.mockReturnValue(true)
    pty.emitData('late')
    pty.emitExit(0)
    expect(event.sender.send).toHaveBeenCalledTimes(1)
  })

  it('終了は exitCode・signal・reason を送る', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { folderPath: '/work', cols: 90, rows: 20 })
    pty.emitExit(1)
    expect(event.sender.send).toHaveBeenCalledWith('agentTerminal:exit', {
      sessionId: 'sid-1',
      exitCode: 1,
      signal: null,
      reason: 'exited'
    })
  })
})

describe('agentTerminal:write・resize・stop・getState', () => {
  async function started(): Promise<ReturnType<typeof makeEvent>> {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { folderPath: '/work', cols: 90, rows: 20 })
    return event
  }

  it('write は検証を通った書き込みだけを渡す', async () => {
    const event = await started()
    listeners.get('agentTerminal:write')?.(event, 'sid-1', 'abc')
    listeners.get('agentTerminal:write')?.(event, 'sid-1', 123)
    listeners.get('agentTerminal:write')?.(event, 'stale', 'x')
    listeners.get('agentTerminal:write')?.(makeEvent(1, false), 'sid-1', 'sub')
    expect(pty.write.mock.calls).toEqual([['abc']])
  })

  it('resize は範囲内の整数だけを渡す', async () => {
    const event = await started()
    listeners.get('agentTerminal:resize')?.(event, 'sid-1', 100, 30)
    listeners.get('agentTerminal:resize')?.(event, 'sid-1', 9999, 30)
    expect(pty.resize.mock.calls).toEqual([[100, 30]])
  })

  it('stop は止め終わってから解決し、getState は null になる', async () => {
    const event = await started()
    expect(handles.get('agentTerminal:getState')?.(event)).toEqual({ sessionId: 'sid-1' })
    await handles.get('agentTerminal:stop')?.(event, 'sid-1')
    expect(stopTree).toHaveBeenCalledOnce()
    expect(handles.get('agentTerminal:getState')?.(event)).toBeNull()
    expect(event.sender.send).toHaveBeenCalledWith('agentTerminal:exit', {
      sessionId: 'sid-1',
      exitCode: 0,
      signal: 15,
      reason: 'stopped'
    })
  })
})

describe('agentTerminal:focus', () => {
  it('Windows・Linux ではメニューのショートカットを止める・戻す', () => {
    register({ platform: 'win32' })
    const event = makeEvent()
    listeners.get('agentTerminal:focus')?.(event, true)
    listeners.get('agentTerminal:focus')?.(event, false)
    listeners.get('agentTerminal:focus')?.(event, 'yes')
    expect(event.sender.setIgnoreMenuShortcuts.mock.calls).toEqual([[true], [false]])
  })

  it('macOS では変えない', () => {
    register({ platform: 'darwin' })
    const event = makeEvent()
    listeners.get('agentTerminal:focus')?.(event, true)
    expect(event.sender.setIgnoreMenuShortcuts).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts
```

Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

`src/main/handlers/agentTerminalPayloadParser.ts`（新規）:

```ts
import type { AgentStartRequest } from '@shared/types'
import {
  AGENT_TERMINAL_MAX_COLS,
  AGENT_TERMINAL_MAX_ROWS,
  AGENT_TERMINAL_MIN_COLS,
  AGENT_TERMINAL_MIN_ROWS,
  AGENT_WRITE_MAX_LENGTH
} from '@shared/types'
import { assertPlainObject } from './payloadValidators'

// agentTerminal:* の入力の検証(設計書「入力の検証」)。invoke は例外で拒否し、send(write・resize・focus)は null を返して捨てる
// (send の listener で投げると main の例外の出力になるだけで、renderer には届かない)

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

const isSessionId = (value: unknown): value is string => typeof value === 'string' && value !== ''

export function parseAgentStartRequest(payload: unknown): AgentStartRequest {
  assertPlainObject(payload)
  const { folderPath, cols, rows } = payload
  if (typeof folderPath !== 'string' || folderPath === '') {
    throw new Error('folderPath は空でない文字列である必要があります')
  }
  if (!isIntegerInRange(cols, AGENT_TERMINAL_MIN_COLS, AGENT_TERMINAL_MAX_COLS)) {
    throw new Error(
      `cols は ${AGENT_TERMINAL_MIN_COLS}〜${AGENT_TERMINAL_MAX_COLS} の整数である必要があります`
    )
  }
  if (!isIntegerInRange(rows, AGENT_TERMINAL_MIN_ROWS, AGENT_TERMINAL_MAX_ROWS)) {
    throw new Error(
      `rows は ${AGENT_TERMINAL_MIN_ROWS}〜${AGENT_TERMINAL_MAX_ROWS} の整数である必要があります`
    )
  }
  return { folderPath, cols, rows }
}

export function parseAgentSessionId(value: unknown): string {
  if (!isSessionId(value)) throw new Error('sessionId は空でない文字列である必要があります')
  return value
}

export function parseAgentWrite(
  sessionId: unknown,
  data: unknown
): { sessionId: string; data: string } | null {
  if (!isSessionId(sessionId)) return null
  if (typeof data !== 'string' || data.length > AGENT_WRITE_MAX_LENGTH) return null
  return { sessionId, data }
}

export function parseAgentResize(
  sessionId: unknown,
  cols: unknown,
  rows: unknown
): { sessionId: string; cols: number; rows: number } | null {
  if (!isSessionId(sessionId)) return null
  if (!isIntegerInRange(cols, AGENT_TERMINAL_MIN_COLS, AGENT_TERMINAL_MAX_COLS)) return null
  if (!isIntegerInRange(rows, AGENT_TERMINAL_MIN_ROWS, AGENT_TERMINAL_MAX_ROWS)) return null
  return { sessionId, cols, rows }
}

/** 送信元がトップのフレーム(そのウィンドウのメインフレーム)か。iframe などのサブフレームからの依頼は受け付けない */
export function isMainFrameSender(event: { senderFrame: { parent: unknown } | null }): boolean {
  return event.senderFrame !== null && event.senderFrame.parent === null
}
```

`src/main/handlers/agentTerminalHandlers.ts`（新規）:

```ts
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import type {
  AgentSessionData,
  AgentSessionExit,
  AgentSessionSnapshot,
  AgentStartResult
} from '@shared/types'
import type { FolderAccessManager } from '../folderAccessManager'
import type { AgentSessionRegistry, AgentSessionCreation } from '../agentSessionRegistry'
import { startAgentSession } from '../agentSession'
import type { PtySpawn, StopTree } from '../agentSession'
import type { AgentLaunchResolution } from '../agentCommand'
import {
  isMainFrameSender,
  parseAgentResize,
  parseAgentSessionId,
  parseAgentStartRequest,
  parseAgentWrite
} from './agentTerminalPayloadParser'

// エージェントのセッションの IPC の受け口(設計書「IPC」)。起動のコマンド・作業ディレクトリ・環境変数は main で決め、
// renderer からは folderPath(許可との一致の確認だけ)・桁数・行数・書き込む文字列・sessionId だけを受け取る

export interface AgentTerminalHandlerDeps {
  folderAccess: FolderAccessManager
  registry: AgentSessionRegistry
  /** 起動のコマンドと環境変数を決める(agentCommand.resolveAgentLaunch に実物の依存を渡したもの) */
  resolveLaunch: () => Promise<AgentLaunchResolution>
  spawnPty: PtySpawn
  stopTree: StopTree
  createSessionId?: () => string
  platform?: NodeJS.Platform
}

const NOT_MAIN_FRAME = 'メインフレーム以外からの依頼は受け付けません'

async function canonicalOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function sendTo(
  webContents: WebContents,
  channel: string,
  payload: AgentSessionData | AgentSessionExit
): void {
  if (!webContents.isDestroyed()) webContents.send(channel, payload)
}

export function registerAgentTerminalHandlers(
  ipcMain: IpcMain,
  {
    folderAccess,
    registry,
    resolveLaunch,
    spawnPty,
    stopTree,
    createSessionId = randomUUID,
    platform = process.platform
  }: AgentTerminalHandlerDeps
): void {
  ipcMain.handle(
    'agentTerminal:start',
    async (event: IpcMainInvokeEvent, payload: unknown): Promise<AgentStartResult> => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      const request = parseAgentStartRequest(payload)
      const ownerId = event.sender.id
      const allowedFolder = folderAccess.get(ownerId)
      if (allowedFolder === undefined) return { kind: 'error', error: 'no-folder' }
      if ((await canonicalOrSelf(request.folderPath)) !== allowedFolder) {
        return { kind: 'error', error: 'folder-mismatch' }
      }
      const webContents = event.sender
      return registry.start(ownerId, async (): Promise<AgentSessionCreation> => {
        // 作業ディレクトリは renderer の文字列ではなく許可のフォルダ(main の値)
        if (!(await isDirectory(allowedFolder))) {
          return {
            kind: 'failed',
            result: { kind: 'error', error: 'folder-missing', detail: allowedFolder }
          }
        }
        // node-pty は存在しないコマンドでも例外を投げず終了コード 1 になるため、起動の前に探す(確認の結果 4)
        const launch = await resolveLaunch()
        if (launch.kind === 'not-found') {
          return {
            kind: 'failed',
            result: {
              kind: 'error',
              error: 'command-not-found',
              shellPathUnavailable: launch.shellPathUnavailable
            }
          }
        }
        const sessionId = createSessionId()
        try {
          const session = startAgentSession({
            id: sessionId,
            spawn: spawnPty,
            file: launch.plan.file,
            args: launch.plan.args,
            env: launch.plan.env,
            cwd: allowedFolder,
            cols: request.cols,
            rows: request.rows,
            stopTree,
            callbacks: {
              onData: (data) => sendTo(webContents, 'agentTerminal:data', { sessionId, data }),
              onExit: (exit) => sendTo(webContents, 'agentTerminal:exit', { sessionId, ...exit })
            }
          })
          return { kind: 'created', session }
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err)
          return { kind: 'failed', result: { kind: 'error', error: 'spawn-failed', detail } }
        }
      })
    }
  )

  ipcMain.on('agentTerminal:write', (event: IpcMainEvent, sessionId: unknown, data: unknown) => {
    if (!isMainFrameSender(event)) return
    const parsed = parseAgentWrite(sessionId, data)
    if (parsed === null) return
    registry.write(event.sender.id, parsed.sessionId, parsed.data)
  })

  ipcMain.on(
    'agentTerminal:resize',
    (event: IpcMainEvent, sessionId: unknown, cols: unknown, rows: unknown) => {
      if (!isMainFrameSender(event)) return
      const parsed = parseAgentResize(sessionId, cols, rows)
      if (parsed === null) return
      registry.resize(event.sender.id, parsed.sessionId, parsed.cols, parsed.rows)
    }
  )

  ipcMain.handle(
    'agentTerminal:stop',
    async (event: IpcMainInvokeEvent, sessionId: unknown): Promise<void> => {
      if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
      await registry.stop(event.sender.id, 'stopped', parseAgentSessionId(sessionId))
    }
  )

  ipcMain.handle('agentTerminal:getState', (event: IpcMainInvokeEvent): AgentSessionSnapshot => {
    if (!isMainFrameSender(event)) throw new Error(NOT_MAIN_FRAME)
    return registry.snapshot(event.sender.id)
  })

  // Windows・Linux の既定のメニューのショートカット(Ctrl+W など)がターミナルの入力を奪わないよう、ターミナルにフォーカスが
  // ある間はメニューのショートカットを止める。macOS は Cmd の組み合わせで重ならず、Edit メニューのコピー・貼り付けを生かす
  ipcMain.on('agentTerminal:focus', (event: IpcMainEvent, focused: unknown) => {
    if (!isMainFrameSender(event) || typeof focused !== 'boolean') return
    if (platform === 'darwin') return
    event.sender.setIgnoreMenuShortcuts(focused)
  })
}
```

`src/main/agentRuntime.ts`（新規。単体テストは無い。Task 12 の `ipcHandlers.test.ts` はこのモジュールを差し替え、実物は Task 1・6 の結合テストと実機の AGT で確かめる）:

```ts
import { userInfo } from 'node:os'
import { spawn as ptySpawn } from 'node-pty'
import type { PtySpawn, StopTree } from './agentSession'
import { isExecutableRegularFile, resolveAgentLaunch } from './agentCommand'
import type { AgentLaunchResolution } from './agentCommand'
import { readLoginShellPath } from './agentShellEnv'
import { stopProcessTree } from './agentProcessTree'

// 実物の依存(node-pty・ログインシェル・ps・シグナル)の組み立て。ipcHandlers.ts から使い、テストではこのモジュールごと差し替える

function currentUserShell(): string | null {
  try {
    return userInfo().shell
  } catch {
    return null
  }
}

export const spawnAgentPty: PtySpawn = (file, args, options) => ptySpawn(file, args, options)

export const resolveAgentLaunchFromSystem = (): Promise<AgentLaunchResolution> =>
  resolveAgentLaunch({
    env: process.env,
    platform: process.platform,
    readLoginShellPath: () => readLoginShellPath({ userShell: currentUserShell() }),
    isExecutable: isExecutableRegularFile
  })

export const stopAgentPtyTree: StopTree = (pty, exited) =>
  stopProcessTree({ pid: pty.pid, exited, killPty: () => pty.kill() })
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts
npm run typecheck
npx eslint src/main/handlers/agentTerminalPayloadParser.ts src/main/handlers/agentTerminalHandlers.ts src/main/agentRuntime.ts src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts
npx prettier --check src/main/handlers/agentTerminalPayloadParser.ts src/main/handlers/agentTerminalHandlers.ts src/main/agentRuntime.ts src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts
```

Expected: PASS（23 + 15 件）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                                                                                                                                                | テストのファイル                     | `-t`                                 | 確認           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------ | -------------- |
| H1  | `agentTerminalHandlers.ts` の `if ((await canonicalOrSelf(request.folderPath)) !== allowedFolder) {` を `if (false) {` にする                                                                                                                                                       | `agentTerminalHandlers.test.ts`      | `folder-mismatch`                    | 落ちた（1 件） |
| H2  | `agentTerminalHandlers.ts` の `cwd: allowedFolder,` を `cwd: request.folderPath,` にする                                                                                                                                                                                            | `agentTerminalHandlers.test.ts`      | `許可のフォルダを作業ディレクトリに` | 落ちた（1 件） |
| H3  | `agentTerminalHandlers.ts` の `ipcMain.on('agentTerminal:write', (event: IpcMainEvent, sessionId: unknown, data: unknown) => { ⏎ if (!isMainFrameSender(event)) return` を `ipcMain.on('agentTerminal:write', (event: IpcMainEvent, sessionId: unknown, data: unknown) => {` にする | `agentTerminalHandlers.test.ts`      | `write は検証を通った書き込みだけ`   | 落ちた（1 件） |
| H4  | `agentTerminalHandlers.ts` の `if (platform === 'darwin') return` を消す                                                                                                                                                                                                            | `agentTerminalHandlers.test.ts`      | `macOS では変えない`                 | 落ちた（1 件） |
| H5  | `agentTerminalHandlers.ts` の `if (!webContents.isDestroyed()) webContents.send(channel, payload)` を `webContents.send(channel, payload)` にする                                                                                                                                   | `agentTerminalHandlers.test.ts`      | `破棄済みなら送らない`               | 落ちた（1 件） |
| H6  | `agentTerminalPayloadParser.ts` の `value >= min && value <= max` を `value >= min` にする                                                                                                                                                                                          | `agentTerminalPayloadParser.test.ts` | `上限超え`                           | 落ちた（2 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/main
```

---

### Task 9: main: 遷移とリンクの制限

**Files:**

- Create: `src/main/navigationPolicy.ts`、`src/main/handlers/shellHandlers.ts`、`src/main/__tests__/navigationPolicy.test.ts`、`src/main/__tests__/handlers/shellHandlers.test.ts`
- Modify: `src/main/index.ts:26-37`（`setWindowOpenHandler` の許可リスト・`will-navigate` の拒否）

**Interfaces:**

- Consumes: `isExternalHttpUrl`（Task 2）
- Produces: `isAllowedNavigation(targetUrl: string, appUrl: string): boolean`（開発時は同じ origin、パッケージ版は同じ `index.html` のパス）、`registerShellHandlers(ipcMain, openExternal: (url: string) => Promise<void>): void`（`shell:openExternalLink`。http・https だけを開いて true、ほかは false。配線は Task 12）
- 注: `index.ts` は単体テストの対象外（coverage でも除外。既存）。`will-navigate` の `event.url` は Electron 39 の `Event<WebContentsWillNavigateEventParams>`。`before-input-event` は変えない（差異 15）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/navigationPolicy.test.ts`（新規）:

```ts
import { describe, it, expect } from 'vitest'
import { isAllowedNavigation } from '../navigationPolicy'

describe('isAllowedNavigation', () => {
  const devUrl = 'http://localhost:5173/'
  const fileUrl =
    'file:///Applications/prompt-ide.app/Contents/Resources/app.asar/out/renderer/index.html'
  it.each([
    ['開発時: 同じ origin は許す', 'http://localhost:5173/#x', devUrl, true],
    ['開発時: 別のポートは拒否', 'http://localhost:5174/', devUrl, false],
    ['開発時: 外部のサイトは拒否', 'https://example.com/', devUrl, false],
    ['パッケージ版: 同じ index.html は許す', `${fileUrl}?a=1#b`, fileUrl, true],
    ['パッケージ版: 別のファイルは拒否', 'file:///etc/passwd', fileUrl, false],
    ['パッケージ版: http は拒否', 'https://example.com/', fileUrl, false],
    ['解析できない URL は拒否', '::', devUrl, false]
  ])('%s', (_label, target, app, expected) => {
    expect(isAllowedNavigation(target, app)).toBe(expected)
  })
})
```

`src/main/__tests__/handlers/shellHandlers.test.ts`（新規）:

```ts
import { describe, it, expect, vi } from 'vitest'
import { registerShellHandlers } from '../../handlers/shellHandlers'

function setup(): {
  invoke: (url: unknown) => Promise<unknown>
  openExternal: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) =>
      handlers.set(channel, listener)
  }
  const openExternal = vi.fn(async () => undefined)
  registerShellHandlers(ipcMain as never, openExternal)
  return {
    invoke: (url) => handlers.get('shell:openExternalLink')?.({}, url) as Promise<unknown>,
    openExternal
  }
}

describe('shell:openExternalLink', () => {
  it('https の URL を開いて true', async () => {
    const { invoke, openExternal } = setup()
    await expect(invoke('https://example.com')).resolves.toBe(true)
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
  })
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'x-custom://a', 1, null])(
    '%s は開かずに false',
    async (url) => {
      const { invoke, openExternal } = setup()
      await expect(invoke(url)).resolves.toBe(false)
      expect(openExternal).not.toHaveBeenCalled()
    }
  )
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/main/__tests__/navigationPolicy.test.ts src/main/__tests__/handlers/shellHandlers.test.ts
```

Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

`src/main/navigationPolicy.ts`（新規）:

```ts
// 遷移・新しいウィンドウ・外部リンクの許可(設計書「遷移と新しいウィンドウ」「リンク」)。純粋関数

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * アプリ自身の URL への遷移か。開発時(http の dev サーバー)は同じ origin、パッケージ版(file:)は同じ index.html の
 * パスだけを許す(遷移した先のページに preload の API が渡らないように)
 */
export function isAllowedNavigation(targetUrl: string, appUrl: string): boolean {
  const target = parseUrl(targetUrl)
  const app = parseUrl(appUrl)
  if (target === null || app === null) return false
  if (app.protocol === 'file:')
    return target.protocol === 'file:' && target.pathname === app.pathname
  return target.origin === app.origin
}
```

`src/main/handlers/shellHandlers.ts`（新規）:

```ts
import type { IpcMain } from 'electron'
import { isExternalHttpUrl } from '@shared/externalUrl'

// ターミナルのリンク(OSC 8)を既定のブラウザで開く。http・https だけを開き、ほかは開かずに false を返す
export function registerShellHandlers(
  ipcMain: IpcMain,
  openExternal: (url: string) => Promise<void>
): void {
  ipcMain.handle('shell:openExternalLink', async (_event, url: unknown): Promise<boolean> => {
    if (typeof url !== 'string' || !isExternalHttpUrl(url)) return false
    await openExternal(url)
    return true
  })
}
```

`src/main/index.ts`（差分）:

```diff
--- a/src/main/index.ts
+++ b/src/main/index.ts
@@ -1,8 +1,11 @@
 import { app, shell, BrowserWindow, ipcMain } from 'electron'
 import { join } from 'path'
+import { pathToFileURL } from 'url'
 import { electronApp, optimizer, is } from '@electron-toolkit/utils'
 import icon from '../../resources/icon.png?asset'
 import { registerIpcHandlers } from './ipcHandlers'
+import { isExternalHttpUrl } from '@shared/externalUrl'
+import { isAllowedNavigation } from './navigationPolicy'

 function createWindow(): void {
   // Create the browser window.
@@ -23,17 +26,29 @@
     mainWindow.show()
   })

+  // 新しいウィンドウは開かない。http・https だけを既定のブラウザへ渡し、ほかのスキーム(file:・独自のスキーム)は開かない
   mainWindow.webContents.setWindowOpenHandler((details) => {
-    shell.openExternal(details.url)
+    if (isExternalHttpUrl(details.url)) void shell.openExternal(details.url)
     return { action: 'deny' }
   })

   // HMR for renderer base on electron-vite cli.
   // Load the remote URL for development or the local html file for production.
+  const indexHtmlPath = join(__dirname, '../renderer/index.html')
+  const appUrl =
+    is.dev && process.env['ELECTRON_RENDERER_URL']
+      ? process.env['ELECTRON_RENDERER_URL']
+      : pathToFileURL(indexHtmlPath).href
+
+  // アプリ自身の URL 以外への遷移を止める(遷移した先のページに preload の API が渡らないように)
+  mainWindow.webContents.on('will-navigate', (event) => {
+    if (!isAllowedNavigation(event.url, appUrl)) event.preventDefault()
+  })
+
   if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
     mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
   } else {
-    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
+    mainWindow.loadFile(indexHtmlPath)
   }
 }

```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/main/__tests__/navigationPolicy.test.ts src/main/__tests__/handlers/shellHandlers.test.ts
npm run typecheck
npx eslint src/main/navigationPolicy.ts src/main/handlers/shellHandlers.ts src/main/index.ts src/main/__tests__/navigationPolicy.test.ts src/main/__tests__/handlers/shellHandlers.test.ts
npx prettier --check src/main/navigationPolicy.ts src/main/handlers/shellHandlers.ts src/main/index.ts src/main/__tests__/navigationPolicy.test.ts src/main/__tests__/handlers/shellHandlers.test.ts
```

Expected: PASS（7 + 6 件）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                 | テストのファイル           | `-t`                 | 確認           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------- | -------------- |
| N1  | `navigationPolicy.ts` の `target.protocol === 'file:' && target.pathname === app.pathname` を `target.protocol === 'file:'` にする                   | `navigationPolicy.test.ts` | `別のファイルは拒否` | 落ちた（1 件） |
| N2  | `navigationPolicy.ts` の `return target.origin === app.origin` を `return target.hostname === app.hostname` にする                                   | `navigationPolicy.test.ts` | `別のポートは拒否`   | 落ちた（1 件） |
| N3  | `shellHandlers.ts` の `if (typeof url !== 'string' \|\| !isExternalHttpUrl(url)) return false` を `if (typeof url !== 'string') return false` にする | `shellHandlers.test.ts`    | `は開かずに false`   | 落ちた（3 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/main
```

---

### Task 10: main: 実行方式の保存（`executionModeStore`・`settings:*PromptExecutionMode`）

**Files:**

- Create: `src/main/executionModeStore.ts`、`src/main/__tests__/executionModeStore.test.ts`
- Modify: `src/main/settingsFileStore.ts:7-12`（`SettingsFile` に `promptExecutionMode?: string`）、`src/main/handlers/settingsHandlers.ts:29`（2 つの handle を足す）、`src/main/__tests__/handlers/settingsHandlers.test.ts`（モックと末尾の追加。`makeEvent` の戻り値の型。差異 21）

**Interfaces:**

- Consumes: `isPromptExecutionMode`・`DEFAULT_PROMPT_EXECUTION_MODE`・`PromptExecutionMode`（Task 2）、`readSettingsFile`・`writeSettingsFile`（既存。マージの書き込み・直列化のキュー）
- Produces: `getPromptExecutionMode(): Promise<PromptExecutionMode>`（無い・不正なら `'agent-cli'`）、`setPromptExecutionMode(mode: unknown): Promise<void>`（不正なら `実行方式が不正です: <値>` を投げる）、IPC `settings:getPromptExecutionMode`・`settings:setPromptExecutionMode`

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/executionModeStore.test.ts`（新規）:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadSettingsFile = vi.hoisted(() => vi.fn())
const mockWriteSettingsFile = vi.hoisted(() => vi.fn())
vi.mock('../settingsFileStore', () => ({
  readSettingsFile: mockReadSettingsFile,
  writeSettingsFile: mockWriteSettingsFile
}))

import { getPromptExecutionMode, setPromptExecutionMode } from '../executionModeStore'

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteSettingsFile.mockResolvedValue(undefined)
})

describe('getPromptExecutionMode', () => {
  it.each([
    ['保存された agent-cli', { promptExecutionMode: 'agent-cli' }, 'agent-cli'],
    ['保存された legacy', { promptExecutionMode: 'legacy' }, 'legacy'],
    ['値が無い', {}, 'agent-cli'],
    ['不正な値', { promptExecutionMode: 'shell' }, 'agent-cli'],
    ['文字列でない値', { promptExecutionMode: 1 }, 'agent-cli']
  ])('%s → %s', async (_label, data, expected) => {
    mockReadSettingsFile.mockResolvedValueOnce(data)
    await expect(getPromptExecutionMode()).resolves.toBe(expected)
  })
})

describe('setPromptExecutionMode', () => {
  it('検証を通った値をマージで書き込む', async () => {
    await setPromptExecutionMode('legacy')
    expect(mockWriteSettingsFile).toHaveBeenCalledWith({ promptExecutionMode: 'legacy' })
  })
  it.each(['shell', '', null, 1])('不正な値(%s)は書き込まずに投げる', async (mode) => {
    await expect(setPromptExecutionMode(mode)).rejects.toThrow('実行方式が不正です')
    expect(mockWriteSettingsFile).not.toHaveBeenCalled()
  })
})
```

`src/main/__tests__/handlers/settingsHandlers.test.ts`（差分）:

```diff
--- a/src/main/__tests__/handlers/settingsHandlers.test.ts
+++ b/src/main/__tests__/handlers/settingsHandlers.test.ts
@@ -14,6 +14,12 @@
   getModelSettings: mockGetModelSettings,
   setModelSettings: mockSetModelSettings
 }))
+const mockGetPromptExecutionMode = vi.hoisted(() => vi.fn())
+const mockSetPromptExecutionMode = vi.hoisted(() => vi.fn())
+vi.mock('../../executionModeStore', () => ({
+  getPromptExecutionMode: mockGetPromptExecutionMode,
+  setPromptExecutionMode: mockSetPromptExecutionMode
+}))

 import { registerSettingsHandlers } from '../../handlers/settingsHandlers'

@@ -25,7 +31,7 @@
   return call[1] as (...args: unknown[]) => unknown
 }

-function makeEvent(senderId: number) {
+function makeEvent(senderId: number): { sender: { id: number } } {
   return { sender: { id: senderId } }
 }

@@ -122,3 +128,25 @@
     })
   })
 })
+
+describe('実行方式', () => {
+  it('settings:getPromptExecutionMode は保存された方式を返す', async () => {
+    mockGetPromptExecutionMode.mockResolvedValueOnce('legacy')
+    await expect(
+      getRegisteredHandler('settings:getPromptExecutionMode')(makeEvent(1))
+    ).resolves.toBe('legacy')
+  })
+
+  it('settings:setPromptExecutionMode は受け取った値をそのまま store へ渡す(検証は store が行う)', async () => {
+    mockSetPromptExecutionMode.mockResolvedValueOnce(undefined)
+    await getRegisteredHandler('settings:setPromptExecutionMode')(makeEvent(1), 'agent-cli')
+    expect(mockSetPromptExecutionMode).toHaveBeenCalledWith('agent-cli')
+  })
+
+  it('不正な値の拒否(store の例外)を renderer へ返す', async () => {
+    mockSetPromptExecutionMode.mockRejectedValueOnce(new Error('実行方式が不正です: shell'))
+    await expect(
+      getRegisteredHandler('settings:setPromptExecutionMode')(makeEvent(1), 'shell')
+    ).rejects.toThrow('実行方式が不正です: shell')
+  })
+})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/main/__tests__/executionModeStore.test.ts src/main/__tests__/handlers/settingsHandlers.test.ts
```

Expected: FAIL（`../executionModeStore` が無いため 2 ファイルとも読み込みで失敗する。store だけを先に作った場合は、`settingsHandlers` の新しい 3 件が `handler not found: settings:getPromptExecutionMode` で失敗する）

- [ ] **Step 3: 実装する**

`src/main/executionModeStore.ts`（新規）:

```ts
import type { PromptExecutionMode } from '@shared/types'
import { DEFAULT_PROMPT_EXECUTION_MODE, isPromptExecutionMode } from '@shared/types'
import { readSettingsFile, writeSettingsFile } from './settingsFileStore'

// プロンプトの実行方式の読み書き(userData/settings.json の promptExecutionMode。API キー・モデルと同じファイルにマージで書く)

/** 保存された実行方式。無い・不正なら既定(agent-cli) */
export async function getPromptExecutionMode(): Promise<PromptExecutionMode> {
  const data = await readSettingsFile()
  return isPromptExecutionMode(data.promptExecutionMode)
    ? data.promptExecutionMode
    : DEFAULT_PROMPT_EXECUTION_MODE
}

/** 検証してから保存する。不正な値は投げる */
export async function setPromptExecutionMode(mode: unknown): Promise<void> {
  if (!isPromptExecutionMode(mode)) {
    throw new Error(`実行方式が不正です: ${String(mode)}`)
  }
  await writeSettingsFile({ promptExecutionMode: mode })
}
```

`src/main/settingsFileStore.ts`・`src/main/handlers/settingsHandlers.ts`（差分）:

```diff
--- a/src/main/settingsFileStore.ts
+++ b/src/main/settingsFileStore.ts
@@ -9,6 +9,8 @@
   apiKey?: string
   modelId?: string
   maxTokens?: number
+  /** プロンプトの実行方式(executionModeStore が検証する) */
+  promptExecutionMode?: string
 }

 const getSettingsPath = (): string => join(app.getPath('userData'), 'settings.json')
```

```diff
--- a/src/main/handlers/settingsHandlers.ts
+++ b/src/main/handlers/settingsHandlers.ts
@@ -2,6 +2,7 @@
 import { getApiKey, setApiKey } from '../apiKeyStore'
 import { getModelSettings, setModelSettings } from '../modelSettingsStore'
 import { parseModelSettingsPayload } from './settingsPayloadParser'
+import { getPromptExecutionMode, setPromptExecutionMode } from '../executionModeStore'

 export function registerSettingsHandlers(ipcMain: IpcMain): void {
   ipcMain.handle('settings:hasApiKey', async () => {
@@ -27,4 +28,11 @@
       return setModelSettings(settings)
     }
   )
+
+  ipcMain.handle('settings:getPromptExecutionMode', async () => getPromptExecutionMode())
+
+  ipcMain.handle(
+    'settings:setPromptExecutionMode',
+    async (_event: IpcMainInvokeEvent, mode: unknown): Promise<void> => setPromptExecutionMode(mode)
+  )
 }
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/main/__tests__/executionModeStore.test.ts src/main/__tests__/handlers/settingsHandlers.test.ts src/main/__tests__/settingsFileStore.test.ts src/main/__tests__/modelSettingsStore.test.ts src/main/__tests__/apiKeyStore.test.ts
npm run typecheck
npx eslint src/main/executionModeStore.ts src/main/settingsFileStore.ts src/main/handlers/settingsHandlers.ts src/main/__tests__/executionModeStore.test.ts src/main/__tests__/handlers/settingsHandlers.test.ts
npx prettier --check src/main/executionModeStore.ts src/main/settingsFileStore.ts src/main/handlers/settingsHandlers.ts src/main/__tests__/executionModeStore.test.ts src/main/__tests__/handlers/settingsHandlers.test.ts
```

Expected: PASS（`executionModeStore` 10 件・`settingsHandlers` 14 件。同じファイルを使う既存の store のテストも通る）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                | テストのファイル             | `-t`       | 確認           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------- | -------------- |
| E1  | `executionModeStore.ts` の `if (!isPromptExecutionMode(mode)) {` を `if (mode === null) {` にする                                                   | `executionModeStore.test.ts` | `不正な値` | 落ちた（3 件） |
| E2  | `executionModeStore.ts` の `return isPromptExecutionMode(data.promptExecutionMode)` を `return typeof data.promptExecutionMode === 'string'` にする | `executionModeStore.test.ts` | `不正な値` | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/main
```

---

### Task 11: main: 保存の照合・開いているタブの監視・外部変更の IPC

**Files:**

- Create: `src/main/fileChangeGuard.ts`、`src/main/openFileWatcher.ts`、`src/main/openFileWatcherLifecycle.ts`、`src/main/handlers/externalChangeHandlers.ts`、`src/main/__tests__/fileChangeGuard.test.ts`、`src/main/__tests__/openFileWatcher.test.ts`、`src/main/__tests__/openFileWatcher.integration.test.ts`、`src/main/__tests__/openFileWatcherLifecycle.test.ts`、`src/main/__tests__/handlers/externalChangeHandlers.test.ts`

**Interfaces:**

- Consumes: `ExternalChangeKind`・`WriteFileCheckedResult`（Task 2）、`FolderAccessManager.onDidChange`（Task 7）、既存の `readFileContent`・`writeFileContent`（`fileSystem.ts`）・`isMissingPathError`（`fsErrors.ts`）・`convertFsAccessError`（`fsErrorConverter.ts`）・`assertFileWithinFolder`・`getAllowedFolder`（`handlers/fileAccessGuard.ts`）、`createTestTimers`（`helpers/processProbe.ts`）
- Produces: `type DiskCheckResult = { kind: 'unchanged' } | { kind: 'conflict'; reason }`、`checkDiskUnchanged(path, baseContent, readFile): Promise<DiskCheckResult>`、`EXTERNAL_CHANGE_DEBOUNCE_MS = 300`、`interface DirectoryWatch { close(); on('error', listener) }`、`type WatchDirectory = (dir, listener: (eventType, filename: string | Buffer | null) => void) => DirectoryWatch`、`class OpenFileWatcher { constructor({ watch, notify, debounceMs? }); setWatchedFiles(ownerId, paths); clear(ownerId); watchedDirectoryCount(ownerId) }`、`setupOpenFileWatcherLifecycle(app, watcher, folderAccess): void`、`MAX_WATCHED_FILES = 1_000`、`registerExternalChangeHandlers(ipcMain, folderAccess, watcher): void`（`fs:writeFileChecked(path, content, baseContent: string | null)`・`fs:setWatchedFiles(paths)`。配線は Task 12）
- 注: 差異 9・10・13。照合は UTF-8 で読んだ文字列どうしの比較（BOM・CRLF を含む）。`baseContent` が null なら照合せずに書く（上書きの確認で OK の後）。許可の確認は削除されたファイルでも通るよう、親フォルダへ倒す `assertFileWithinFolder`。監視はファイル名で開いているタブと照合し、通知のパスは renderer から受け取った表記のまま返す。`fs.watch` の例外（無いディレクトリ）と `error` イベントは監視を閉じ、フォーカスの復帰での再確認に任せる。検証の間にフォルダが切り替わったら古いフォルダのパスで監視を張らない

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/fileChangeGuard.test.ts`（新規）:

```ts
import { describe, it, expect, vi } from 'vitest'
import { checkDiskUnchanged } from '../fileChangeGuard'

// U+FEFF(BOM)。ソースに実物の文字を書かない(エディタで見えないため)
const BOM = String.fromCharCode(0xfeff)
const fsError = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

describe('checkDiskUnchanged', () => {
  it('ディスクの内容が基準と同じなら unchanged', async () => {
    await expect(checkDiskUnchanged('/a', 'x', async () => 'x')).resolves.toEqual({
      kind: 'unchanged'
    })
  })
  it('違えば modified', async () => {
    await expect(checkDiskUnchanged('/a', 'x', async () => 'y')).resolves.toEqual({
      kind: 'conflict',
      reason: 'modified'
    })
  })
  it.each(['ENOENT', 'ENOTDIR'])('%s なら deleted', async (code) => {
    await expect(
      checkDiskUnchanged('/a', 'x', async () => {
        throw fsError(code)
      })
    ).resolves.toEqual({ kind: 'conflict', reason: 'deleted' })
  })
  it('ほかの読み込みの失敗(EACCES)は投げる', async () => {
    await expect(
      checkDiskUnchanged('/a', 'x', async () => {
        throw fsError('EACCES')
      })
    ).rejects.toThrow('EACCES')
  })
  it('BOM と CRLF も含めて文字列で比べる(読み方は fs:readFile と同じ)', async () => {
    const read = vi.fn(async () => '' + BOM + 'a\r\nb')
    await expect(checkDiskUnchanged('/a', '' + BOM + 'a\r\nb', read)).resolves.toEqual({
      kind: 'unchanged'
    })
    await expect(checkDiskUnchanged('/a', 'a\r\nb', read)).resolves.toEqual({
      kind: 'conflict',
      reason: 'modified'
    })
  })
})
```

`src/main/__tests__/openFileWatcher.test.ts`（新規。偽の `fs.watch`・偽のタイマー）:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { OpenFileWatcher } from '../openFileWatcher'
import type { DirectoryWatch, WatchDirectory } from '../openFileWatcher'

afterEach(() => {
  vi.useRealTimers()
})

interface FakeWatch extends DirectoryWatch {
  dir: string
  closed: boolean
  fire(filename: string | null): void
  fail(): void
}

function makeWatchFn(): { watch: ReturnType<typeof vi.fn<WatchDirectory>>; watches: FakeWatch[] } {
  const watches: FakeWatch[] = []
  const watch = vi.fn<WatchDirectory>((dir, listener) => {
    let onError: (err: Error) => void = () => undefined
    const fake: FakeWatch = {
      dir,
      closed: false,
      close: vi.fn(() => {
        fake.closed = true
      }),
      on: (_event, handler) => {
        onError = handler
        return fake
      },
      fire: (filename) => listener('rename', filename),
      fail: () => onError(new Error('EPERM'))
    }
    watches.push(fake)
    return fake
  })
  return { watch, watches }
}

describe('OpenFileWatcher', () => {
  it('親ディレクトリごとに 1 つの監視を張る', () => {
    const { watch } = makeWatchFn()
    const watcher = new OpenFileWatcher({ watch, notify: vi.fn() })
    watcher.setWatchedFiles(1, ['/p/a.ts', '/p/b.ts', '/p/sub/c.ts'])
    expect(watch.mock.calls.map(([dir]) => dir).sort()).toEqual(['/p', '/p/sub'])
  })

  it('開いているファイルの名前のイベントを 300ms 間引いて、renderer のパスで通知する', async () => {
    vi.useFakeTimers()
    const { watch, watches } = makeWatchFn()
    const notify = vi.fn()
    const watcher = new OpenFileWatcher({ watch, notify })
    watcher.setWatchedFiles(1, ['/p/a.ts', '/p/b.ts'])
    watches[0].fire('a.ts')
    await vi.advanceTimersByTimeAsync(200)
    watches[0].fire('a.ts')
    watches[0].fire('b.ts')
    await vi.advanceTimersByTimeAsync(299)
    expect(notify).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(notify).toHaveBeenCalledExactlyOnceWith(1, ['/p/a.ts', '/p/b.ts'])
  })

  it('開いていないファイルの名前は通知しない', async () => {
    vi.useFakeTimers()
    const { watch, watches } = makeWatchFn()
    const notify = vi.fn()
    const watcher = new OpenFileWatcher({ watch, notify })
    watcher.setWatchedFiles(1, ['/p/a.ts'])
    watches[0].fire('other.ts')
    await vi.advanceTimersByTimeAsync(1000)
    expect(notify).not.toHaveBeenCalled()
  })

  it('名前の無いイベントはそのディレクトリの開いているファイルすべてを通知する', async () => {
    vi.useFakeTimers()
    const { watch, watches } = makeWatchFn()
    const notify = vi.fn()
    const watcher = new OpenFileWatcher({ watch, notify })
    watcher.setWatchedFiles(1, ['/p/a.ts', '/p/b.ts'])
    watches[0].fire(null)
    await vi.advanceTimersByTimeAsync(300)
    expect(notify).toHaveBeenCalledWith(1, ['/p/a.ts', '/p/b.ts'])
  })

  it('一覧から外れたディレクトリの監視を閉じ、残るものは張り直さない', () => {
    const { watch, watches } = makeWatchFn()
    const watcher = new OpenFileWatcher({ watch, notify: vi.fn() })
    watcher.setWatchedFiles(1, ['/p/a.ts', '/q/b.ts'])
    watcher.setWatchedFiles(1, ['/p/c.ts'])
    expect(watches.find((w) => w.dir === '/q')?.closed).toBe(true)
    expect(watches.find((w) => w.dir === '/p')?.closed).toBe(false)
    expect(watch).toHaveBeenCalledTimes(2)
  })

  it('clear はすべての監視と保留中の通知のタイマーを閉じる', async () => {
    vi.useFakeTimers()
    const { watch, watches } = makeWatchFn()
    const notify = vi.fn()
    const watcher = new OpenFileWatcher({ watch, notify })
    watcher.setWatchedFiles(1, ['/p/a.ts'])
    watches[0].fire('a.ts')
    watcher.clear(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(watches[0].closed).toBe(true)
    expect(notify).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('空の一覧は clear と同じ', () => {
    const { watch, watches } = makeWatchFn()
    const watcher = new OpenFileWatcher({ watch, notify: vi.fn() })
    watcher.setWatchedFiles(1, ['/p/a.ts'])
    watcher.setWatchedFiles(1, [])
    expect(watches[0].closed).toBe(true)
    expect(watcher.watchedDirectoryCount(1)).toBe(0)
  })

  it('監視を張れない(例外)ディレクトリは飛ばす', () => {
    const watch = vi.fn<WatchDirectory>(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    const watcher = new OpenFileWatcher({ watch, notify: vi.fn() })
    expect(() => watcher.setWatchedFiles(1, ['/gone/a.ts'])).not.toThrow()
    expect(watcher.watchedDirectoryCount(1)).toBe(0)
  })

  it('error の出た監視は閉じる', () => {
    const { watch, watches } = makeWatchFn()
    const watcher = new OpenFileWatcher({ watch, notify: vi.fn() })
    watcher.setWatchedFiles(1, ['/p/a.ts'])
    watches[0].fail()
    expect(watches[0].closed).toBe(true)
    expect(watcher.watchedDirectoryCount(1)).toBe(0)
  })

  it('所有者ごとに独立している', async () => {
    vi.useFakeTimers()
    const { watch, watches } = makeWatchFn()
    const notify = vi.fn()
    const watcher = new OpenFileWatcher({ watch, notify })
    watcher.setWatchedFiles(1, ['/p/a.ts'])
    watcher.setWatchedFiles(2, ['/p/a.ts'])
    watcher.clear(1)
    watches[1].fire('a.ts')
    await vi.advanceTimersByTimeAsync(300)
    expect(notify).toHaveBeenCalledExactlyOnceWith(2, ['/p/a.ts'])
  })
})
```

`src/main/__tests__/openFileWatcher.integration.test.ts`（新規。実物の `fs.watch`。間引きは 30ms に縮める）:

```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, renameSync, unlinkSync, realpathSync } from 'node:fs'
import { watch } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenFileWatcher } from '../openFileWatcher'
import { createTestTimers } from './helpers/processProbe'

// 実物の fs.watch で、その場の書き込み・rename での置き換え・削除が通知されることを確かめる(確認の結果 11)
const timers = createTestTimers()
let dir: string
let watcher: OpenFileWatcher
let notified: string[][]

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'open-file-watcher-')))
  writeFileSync(join(dir, 'a.txt'), 'one')
  notified = []
  watcher = new OpenFileWatcher({
    watch,
    notify: (_owner, paths) => notified.push(paths),
    debounceMs: 30
  })
})

afterEach(() => {
  watcher.clear(1)
  timers.clearAll()
  rmSync(dir, { recursive: true, force: true })
})

async function waitForNotification(path: string): Promise<boolean> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (notified.some((paths) => paths.includes(path))) return true
    await timers.delay(20)
  }
  return false
}

describe('OpenFileWatcher(実物の fs.watch)', () => {
  it.each([
    ['その場の書き込み', (file: string) => writeFileSync(file, 'two')],
    [
      'rename での置き換え',
      (file: string) => {
        writeFileSync(`${file}.tmp`, 'three')
        renameSync(`${file}.tmp`, file)
      }
    ],
    ['削除', (file: string) => unlinkSync(file)]
  ])('%s を通知する', async (_label, change) => {
    const file = join(dir, 'a.txt')
    watcher.setWatchedFiles(1, [file])
    // 監視を始めた直後に、始める前の書き込みのイベントが届くことがあるため、落ち着くのを待ってから数える
    await timers.delay(200)
    notified = []
    change(file)
    expect(await waitForNotification(file)).toBe(true)
  })
})
```

`src/main/__tests__/openFileWatcherLifecycle.test.ts`（新規）:

```ts
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { FolderAccessManager } from '../folderAccessManager'
import { OpenFileWatcher } from '../openFileWatcher'
import { setupOpenFileWatcherLifecycle } from '../openFileWatcherLifecycle'

function setup(): {
  app: EventEmitter
  clear: ReturnType<typeof vi.spyOn>
  folderAccess: FolderAccessManager
} {
  const app = new EventEmitter()
  const watcher = new OpenFileWatcher({ watch: vi.fn(), notify: vi.fn() })
  const clear = vi.spyOn(watcher, 'clear')
  const folderAccess = new FolderAccessManager()
  setupOpenFileWatcherLifecycle(app as unknown as App, watcher, folderAccess)
  return { app, clear, folderAccess }
}

describe('setupOpenFileWatcherLifecycle', () => {
  it('ウィンドウの破棄で監視を閉じる', () => {
    const { app, clear } = setup()
    const webContents = Object.assign(new EventEmitter(), { id: 3 })
    app.emit('web-contents-created', {}, webContents)
    webContents.emit('destroyed')
    expect(clear).toHaveBeenCalledWith(3)
  })

  it.each([
    [{ isMainFrame: true, isSameDocument: false }, true],
    [{ isMainFrame: true, isSameDocument: true }, false],
    [{ isMainFrame: false, isSameDocument: false }, false]
  ])('遷移 %o で閉じるか: %s', (details, cleared) => {
    const { app, clear } = setup()
    const webContents = Object.assign(new EventEmitter(), { id: 3 })
    app.emit('web-contents-created', {}, webContents)
    webContents.emit('did-start-navigation', { url: 'x', frame: null, ...details })
    expect(clear.mock.calls).toEqual(cleared ? [[3]] : [])
  })

  it('フォルダの切り替えで閉じる', () => {
    const { clear, folderAccess } = setup()
    folderAccess.set(3, '/a')
    expect(clear).toHaveBeenCalledWith(3)
  })
})
```

`src/main/__tests__/handlers/externalChangeHandlers.test.ts`（新規）:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve as resolvePath } from 'node:path'

const mockRealpath = vi.hoisted(() => vi.fn())
const mockReadFileContent = vi.hoisted(() => vi.fn())
const mockWriteFileContent = vi.hoisted(() => vi.fn())
vi.mock('node:fs/promises', () => ({ default: { realpath: mockRealpath }, realpath: mockRealpath }))
vi.mock('../../fileSystem', () => ({
  readFileContent: mockReadFileContent,
  writeFileContent: mockWriteFileContent
}))

import { FolderAccessManager } from '../../folderAccessManager'
import { OpenFileWatcher } from '../../openFileWatcher'
import { registerExternalChangeHandlers } from '../../handlers/externalChangeHandlers'

type Listener = (...args: unknown[]) => unknown
const handles = new Map<string, Listener>()
const ipcMain = { handle: (channel: string, listener: Listener) => handles.set(channel, listener) }
const event = { sender: { id: 1 } }
const enoent = (): NodeJS.ErrnoException => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

let folderAccess: FolderAccessManager
let watcher: OpenFileWatcher
let setWatchedFiles: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  handles.clear()
  vi.clearAllMocks()
  mockRealpath.mockImplementation((p: string) => Promise.resolve(resolvePath(p)))
  mockWriteFileContent.mockResolvedValue(undefined)
  folderAccess = new FolderAccessManager()
  folderAccess.set(1, '/work')
  watcher = new OpenFileWatcher({ watch: vi.fn(), notify: vi.fn() })
  setWatchedFiles = vi.spyOn(watcher, 'setWatchedFiles').mockImplementation(() => undefined)
  vi.spyOn(watcher, 'clear')
  registerExternalChangeHandlers(ipcMain as never, folderAccess, watcher)
})

const writeChecked = (path: unknown, content: unknown, base: unknown): Promise<unknown> =>
  handles.get('fs:writeFileChecked')?.(event, path, content, base) as Promise<unknown>

describe('fs:writeFileChecked', () => {
  it('ディスクが基準と同じなら書き込んで written', async () => {
    mockReadFileContent.mockResolvedValueOnce('old')
    await expect(writeChecked('/work/a.ts', 'new', 'old')).resolves.toEqual({ kind: 'written' })
    expect(mockWriteFileContent).toHaveBeenCalledWith('/work/a.ts', 'new')
  })

  it('ディスクが違えば書き込まずに modified', async () => {
    mockReadFileContent.mockResolvedValueOnce('agent')
    await expect(writeChecked('/work/a.ts', 'new', 'old')).resolves.toEqual({
      kind: 'conflict',
      reason: 'modified'
    })
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('ファイルが無ければ書き込まずに deleted(許可の確認は親フォルダへ倒す)', async () => {
    mockRealpath.mockImplementation((p: string) =>
      p === '/work/a.ts' ? Promise.reject(enoent()) : Promise.resolve(resolvePath(p))
    )
    mockReadFileContent.mockRejectedValueOnce(enoent())
    await expect(writeChecked('/work/a.ts', 'new', 'old')).resolves.toEqual({
      kind: 'conflict',
      reason: 'deleted'
    })
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('基準が null なら照合せずに書く(削除されたファイルを作り直す)', async () => {
    mockRealpath.mockImplementation((p: string) =>
      p === '/work/a.ts' ? Promise.reject(enoent()) : Promise.resolve(resolvePath(p))
    )
    await expect(writeChecked('/work/a.ts', 'new', null)).resolves.toEqual({ kind: 'written' })
    expect(mockReadFileContent).not.toHaveBeenCalled()
    expect(mockWriteFileContent).toHaveBeenCalledWith('/work/a.ts', 'new')
  })

  it('許可の範囲外は書き込まずに投げる', async () => {
    await expect(writeChecked('/etc/passwd', 'x', null)).rejects.toThrow('Access denied')
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it.each([
    ['path が文字列でない', 1, 'x', 'y'],
    ['content が文字列でない', '/work/a.ts', 1, 'y'],
    ['baseContent が文字列でも null でもない', '/work/a.ts', 'x', 1]
  ])('%s なら投げる', async (_label, path, content, base) => {
    await expect(writeChecked(path, content, base)).rejects.toThrow()
  })
})

describe('fs:setWatchedFiles', () => {
  const setWatched = (paths: unknown): Promise<unknown> =>
    handles.get('fs:setWatchedFiles')?.(event, paths) as Promise<unknown>

  it('許可の範囲内で存在するパスだけを監視する', async () => {
    mockRealpath.mockImplementation((p: string) =>
      p === '/work/gone.ts' ? Promise.reject(enoent()) : Promise.resolve(resolvePath(p))
    )
    await setWatched(['/work/a.ts', '/etc/passwd', '/work/gone.ts', 3])
    expect(setWatchedFiles).toHaveBeenCalledWith(1, ['/work/a.ts'])
  })

  it('フォルダを開いていなければ監視を閉じる', async () => {
    folderAccess.delete(1)
    await setWatched(['/work/a.ts'])
    expect(watcher.clear).toHaveBeenCalledWith(1)
    expect(setWatchedFiles).not.toHaveBeenCalled()
  })

  it('検証の間にフォルダが切り替わったら監視を張らない', async () => {
    mockRealpath.mockImplementationOnce(async (p: string) => {
      folderAccess.set(1, '/other')
      return resolvePath(p)
    })
    await setWatched(['/work/a.ts'])
    expect(setWatchedFiles).not.toHaveBeenCalled()
  })

  it('配列でない・上限を超える一覧は投げる', async () => {
    await expect(setWatched('x')).rejects.toThrow()
    await expect(setWatched(Array.from({ length: 1001 }, (_, i) => `/work/${i}`))).rejects.toThrow()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/main/__tests__/fileChangeGuard.test.ts src/main/__tests__/openFileWatcher.test.ts src/main/__tests__/openFileWatcher.integration.test.ts src/main/__tests__/openFileWatcherLifecycle.test.ts src/main/__tests__/handlers/externalChangeHandlers.test.ts
```

Expected: FAIL（5 ファイルとも、モジュールが無い）

- [ ] **Step 3: 実装する**

`src/main/fileChangeGuard.ts`（新規）:

```ts
import type { ExternalChangeKind } from '@shared/types'
import { isMissingPathError } from './fsErrors'

// 保存の直前の照合(設計書「保存の直前の照合」)。ディスクの内容が、renderer のタブが最後にディスクと一致した内容
// (savedContent)と同じかを比べる。読み方は fs:readFile と同じ UTF-8。照合と書き込みの間の隙は残る(既知の制約。パターン 1)

export type DiskCheckResult =
  | { kind: 'unchanged' }
  | { kind: 'conflict'; reason: ExternalChangeKind }

export async function checkDiskUnchanged(
  path: string,
  baseContent: string,
  readFile: (path: string) => Promise<string>
): Promise<DiskCheckResult> {
  let disk: string
  try {
    disk = await readFile(path)
  } catch (err) {
    if (isMissingPathError(err)) return { kind: 'conflict', reason: 'deleted' }
    throw err
  }
  return disk === baseContent ? { kind: 'unchanged' } : { kind: 'conflict', reason: 'modified' }
}
```

`src/main/openFileWatcher.ts`（新規）:

```ts
import { basename, dirname } from 'node:path'

// 開いているタブの親ディレクトリの非再帰の監視(設計書「未編集のタブの自動の再読込」)。ファイルそのものを監視すると、
// rename での置き換えの後にイベントが届かなくなるため(確認の結果 11)。イベントの種類は当てにせず、名前が開いているタブと
// 一致する(または名前が無い)ときに、間引いて通知する。判定(内容の比較)は renderer が行う

export const EXTERNAL_CHANGE_DEBOUNCE_MS = 300

export interface DirectoryWatch {
  close(): void
  on(event: 'error', listener: (err: Error) => void): unknown
}

export type WatchDirectory = (
  dir: string,
  listener: (eventType: string, filename: string | Buffer | null) => void
) => DirectoryWatch

export interface OpenFileWatcherDeps {
  watch: WatchDirectory
  /** 変わった可能性のあるタブのパス(renderer から受け取った表記のまま)を所有者へ送る */
  notify: (ownerId: number, paths: string[]) => void
  debounceMs?: number
}

interface OwnerState {
  // 親ディレクトリ → (ファイル名 → renderer のパス)
  files: Map<string, Map<string, string>>
  watches: Map<string, DirectoryWatch>
  pending: Set<string>
  timer: ReturnType<typeof setTimeout> | null
}

export class OpenFileWatcher {
  private readonly owners = new Map<number, OwnerState>()
  private readonly watch: WatchDirectory
  private readonly notify: OpenFileWatcherDeps['notify']
  private readonly debounceMs: number

  constructor({ watch, notify, debounceMs = EXTERNAL_CHANGE_DEBOUNCE_MS }: OpenFileWatcherDeps) {
    this.watch = watch
    this.notify = notify
    this.debounceMs = debounceMs
  }

  /** 所有者の監視するファイルを置き換える(許可の確認は呼び出し側で済ませる) */
  setWatchedFiles(ownerId: number, paths: readonly string[]): void {
    const state = this.owners.get(ownerId) ?? {
      files: new Map(),
      watches: new Map(),
      pending: new Set<string>(),
      timer: null
    }
    this.owners.set(ownerId, state)
    const files = new Map<string, Map<string, string>>()
    for (const path of paths) {
      const dir = dirname(path)
      const byName = files.get(dir) ?? new Map<string, string>()
      byName.set(basename(path), path)
      files.set(dir, byName)
    }
    state.files = files
    for (const [dir, watch] of state.watches) {
      if (!files.has(dir)) {
        watch.close()
        state.watches.delete(dir)
      }
    }
    for (const dir of files.keys()) {
      if (state.watches.has(dir)) continue
      try {
        const watch = this.watch(dir, (_eventType, filename) =>
          this.onEvent(ownerId, dir, filename)
        )
        // エラーが出た監視は閉じ、ウィンドウのフォーカスの復帰での再確認に任せる
        watch.on('error', () => {
          watch.close()
          if (state.watches.get(dir) === watch) state.watches.delete(dir)
        })
        state.watches.set(dir, watch)
      } catch {
        // ディレクトリが無い・監視できないものは飛ばす(フォーカスの復帰での再確認に任せる)
      }
    }
    if (paths.length === 0) this.clear(ownerId)
  }

  private onEvent(ownerId: number, dir: string, filename: string | Buffer | null): void {
    const state = this.owners.get(ownerId)
    const byName = state?.files.get(dir)
    if (state === undefined || byName === undefined) return
    const name = filename === null ? null : filename.toString()
    if (name === null) {
      for (const path of byName.values()) state.pending.add(path)
    } else {
      const path = byName.get(name)
      if (path === undefined) return
      state.pending.add(path)
    }
    if (state.timer !== null) clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      state.timer = null
      const paths = [...state.pending]
      state.pending.clear()
      if (paths.length > 0) this.notify(ownerId, paths)
    }, this.debounceMs)
  }

  /** 所有者の監視をすべて閉じる(フォルダの切り替え・ウィンドウの破棄・リロード) */
  clear(ownerId: number): void {
    const state = this.owners.get(ownerId)
    if (state === undefined) return
    for (const watch of state.watches.values()) watch.close()
    if (state.timer !== null) clearTimeout(state.timer)
    this.owners.delete(ownerId)
  }

  /** 監視しているディレクトリの数(テスト用) */
  watchedDirectoryCount(ownerId: number): number {
    return this.owners.get(ownerId)?.watches.size ?? 0
  }
}
```

`src/main/openFileWatcherLifecycle.ts`（新規）:

```ts
import type { App } from 'electron'
import type { FolderAccessManager } from './folderAccessManager'
import type { OpenFileWatcher } from './openFileWatcher'

// 開いているタブの監視を閉じる契機: ウィンドウの破棄・リロード(メインフレームの別文書への遷移)・フォルダの切り替え
export function setupOpenFileWatcherLifecycle(
  app: App,
  watcher: OpenFileWatcher,
  folderAccess: FolderAccessManager
): void {
  app.on('web-contents-created', (_event, webContents) => {
    webContents.on('destroyed', () => watcher.clear(webContents.id))
    webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) watcher.clear(webContents.id)
    })
  })
  folderAccess.onDidChange((webContentsId) => watcher.clear(webContentsId))
}
```

`src/main/handlers/externalChangeHandlers.ts`（新規）:

```ts
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { WriteFileCheckedResult } from '@shared/types'
import type { FolderAccessManager } from '../folderAccessManager'
import type { OpenFileWatcher } from '../openFileWatcher'
import { readFileContent, writeFileContent } from '../fileSystem'
import { checkDiskUnchanged } from '../fileChangeGuard'
import { convertFsAccessError } from '../fsErrorConverter'
import { assertFileWithinFolder, getAllowedFolder } from './fileAccessGuard'

// 外部変更の検知の IPC(設計書「外部変更の検知」)。照合付きの保存と、開いているタブの監視の登録

/** 監視の登録で受け付けるパスの数の上限(開いているタブの数) */
export const MAX_WATCHED_FILES = 1_000

export function registerExternalChangeHandlers(
  ipcMain: IpcMain,
  folderAccess: FolderAccessManager,
  watcher: OpenFileWatcher
): void {
  // baseContent はタブが最後にディスクと一致した内容(savedContent)。null は照合せずに書く(上書きの確認で OK の後。
  // ディスク上で削除されたファイルを作り直せるよう、許可の確認は親フォルダへ倒す assertFileWithinFolder を使う)
  ipcMain.handle(
    'fs:writeFileChecked',
    async (
      event: IpcMainInvokeEvent,
      filePath: unknown,
      content: unknown,
      baseContent: unknown
    ): Promise<WriteFileCheckedResult> => {
      if (typeof filePath !== 'string' || typeof content !== 'string') {
        throw new Error('filePath と content は文字列である必要があります')
      }
      if (baseContent !== null && typeof baseContent !== 'string') {
        throw new Error('baseContent は文字列か null である必要があります')
      }
      try {
        const allowedFolder = getAllowedFolder(folderAccess, event)
        await assertFileWithinFolder(folderAccess, allowedFolder, filePath)
        if (baseContent !== null) {
          const check = await checkDiskUnchanged(filePath, baseContent, readFileContent)
          if (check.kind === 'conflict') return check
        }
        await writeFileContent(filePath, content)
        return { kind: 'written' }
      } catch (err) {
        throw convertFsAccessError(err, `ファイルが見つかりません: ${filePath}`, filePath)
      }
    }
  )

  // 開いているタブのパスの一覧。許可の範囲外・存在しないものは黙って除く
  ipcMain.handle(
    'fs:setWatchedFiles',
    async (event: IpcMainInvokeEvent, paths: unknown): Promise<void> => {
      if (!Array.isArray(paths) || paths.length > MAX_WATCHED_FILES) {
        throw new Error(`paths は ${MAX_WATCHED_FILES} 件以下の配列である必要があります`)
      }
      const ownerId = event.sender.id
      const allowedFolder = folderAccess.get(ownerId)
      if (allowedFolder === undefined) {
        watcher.clear(ownerId)
        return
      }
      const valid: string[] = []
      for (const path of paths) {
        if (typeof path !== 'string') continue
        try {
          await folderAccess.assertWithinFolder(allowedFolder, path)
          valid.push(path)
        } catch {
          // 範囲外・存在しない
        }
      }
      // 検証の間にフォルダが切り替わっていたら、古いフォルダのパスで監視を張らない
      if (folderAccess.get(ownerId) !== allowedFolder) return
      watcher.setWatchedFiles(ownerId, valid)
    }
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/main/__tests__/fileChangeGuard.test.ts src/main/__tests__/openFileWatcher.test.ts src/main/__tests__/openFileWatcher.integration.test.ts src/main/__tests__/openFileWatcherLifecycle.test.ts src/main/__tests__/handlers/externalChangeHandlers.test.ts
npm run typecheck
npx eslint src/main/fileChangeGuard.ts src/main/openFileWatcher.ts src/main/openFileWatcherLifecycle.ts src/main/handlers/externalChangeHandlers.ts src/main/__tests__/fileChangeGuard.test.ts src/main/__tests__/openFileWatcher.test.ts src/main/__tests__/openFileWatcher.integration.test.ts src/main/__tests__/openFileWatcherLifecycle.test.ts src/main/__tests__/handlers/externalChangeHandlers.test.ts
npx prettier --check src/main/fileChangeGuard.ts src/main/openFileWatcher.ts src/main/openFileWatcherLifecycle.ts src/main/handlers/externalChangeHandlers.ts src/main/__tests__/fileChangeGuard.test.ts src/main/__tests__/openFileWatcher.test.ts src/main/__tests__/openFileWatcher.integration.test.ts src/main/__tests__/openFileWatcherLifecycle.test.ts src/main/__tests__/handlers/externalChangeHandlers.test.ts
grep -rnP '[\x{00A0}\x{200B}\x{FEFF}\x{0080}-\x{009F}]' src || echo "no invisible chars"
```

Expected: PASS（6 + 10 + 3 + 5 + 12 件）。`no invisible chars`（BOM は `String.fromCharCode(0xfeff)` で書く）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                                                                            | テストのファイル                   | `-t`                                     | 確認           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------- | -------------- |
| W1  | `fileChangeGuard.ts` の `if (isMissingPathError(err)) return` を `if (err) return` にする                                                                                                                       | `fileChangeGuard.test.ts`          | `ほかの読み込みの失敗`                   | 落ちた（1 件） |
| W2  | `openFileWatcher.ts` の `if (path === undefined) return` を消す                                                                                                                                                 | `openFileWatcher.test.ts`          | `開いていないファイルの名前は通知しない` | 落ちた（1 件） |
| W3  | `openFileWatcher.ts` の `if (state.timer !== null) clearTimeout(state.timer) ⏎ state.timer = setTimeout(` を `state.timer = setTimeout(` にする                                                                 | `openFileWatcher.test.ts`          | `300ms 間引いて`                         | 落ちた（1 件） |
| W4  | `openFileWatcher.ts` の `for (const watch of state.watches.values()) watch.close() ⏎ if (state.timer !== null) clearTimeout(state.timer)` を `for (const watch of state.watches.values()) watch.close()` にする | `openFileWatcher.test.ts`          | `clear はすべての監視`                   | 落ちた（1 件） |
| W5  | `externalChangeHandlers.ts` の `if (baseContent !== null) {` を `if (false) {` にする                                                                                                                           | `externalChangeHandlers.test.ts`   | `ディスクが違えば書き込まずに modified`  | 落ちた（1 件） |
| W6  | `externalChangeHandlers.ts` の `if (folderAccess.get(ownerId) !== allowedFolder) return` を消す                                                                                                                 | `externalChangeHandlers.test.ts`   | `検証の間にフォルダが切り替わったら`     | 落ちた（1 件） |
| W7  | `openFileWatcherLifecycle.ts` の `folderAccess.onDidChange((webContentsId) => watcher.clear(webContentsId))` を消す                                                                                             | `openFileWatcherLifecycle.test.ts` | `フォルダの切り替えで閉じる`             | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/main
```

---

### Task 12: main の配線・preload の API・`window.electron` の撤去・renderer の窓口

**Files:**

- Modify: `src/main/ipcHandlers.ts`（エージェント・監視・外部変更・リンクの登録と `sendExternalChange`）、`src/main/__tests__/ipcHandlers.test.ts`、`src/preload/api.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`、`src/preload/__tests__/api.test.ts`、`src/renderer/src/__tests__/setup.ts`、`src/renderer/src/lib/settingsApi.ts`、`src/renderer/src/lib/fileSystemApi.ts`、`src/renderer/src/lib/__tests__/settingsApi.test.ts`、`src/renderer/src/lib/__tests__/fileSystemApi.test.ts`
- Create: `src/preload/__tests__/index.test.ts`、`src/renderer/src/lib/agentTerminalApi.ts`、`src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`

**Interfaces:**

- Consumes: Task 2 の型、`AgentSessionRegistry`（Task 6）、`setupAgentSessionLifecycle`（Task 7）、`registerAgentTerminalHandlers`・`resolveAgentLaunchFromSystem`・`spawnAgentPty`・`stopAgentPtyTree`（Task 8）、`registerShellHandlers`（Task 9）、`OpenFileWatcher`・`setupOpenFileWatcherLifecycle`・`registerExternalChangeHandlers`（Task 11）
- Produces: `sendExternalChange(ownerId: number, paths: string[]): void`（`ipcHandlers.ts`）。`window.api` の新しい関数（設計書の IPC の表）: `getPromptExecutionMode()`・`setPromptExecutionMode(mode)`・`startAgentSession(request)`・`writeAgentSession(sessionId, data)`（send）・`resizeAgentSession(sessionId, cols, rows)`（send）・`stopAgentSession(sessionId)`・`getAgentSession()`・`onAgentData(listener): () => void`・`onAgentExit(listener): () => void`・`setAgentTerminalFocused(focused)`（send）・`writeFileChecked(path, content, baseContent: string | null)`・`setWatchedFiles(paths)`・`onExternalFileChange(listener): () => void`・`openExternalLink(url)`。renderer の窓口: `lib/agentTerminalApi.ts`（同名の関数）、`settingsApi.getPromptExecutionMode()`・`setPromptExecutionMode(mode)`、`fileSystemApi.writeFileContentChecked(path, content, baseContent)`・`setWatchedFiles(paths)`・`onExternalFileChange(listener)`。`window.electron` は無くなる
- 注: preload の購読は `onPromptStreamChunk` と同じく wrap して解除関数を返し、payload を検証する（`onAgentExit` は `reason` が 3 つの値のどれでもなければ捨て、`exitCode`・`signal` が数でなければ null にする）。`ipcHandlers.test.ts` の `electron` のモックに `shell`・`webContents.fromId` を足し、`agentRuntime`（実物の node-pty を読む）を差し替える。`setup.ts` の stub の `getPromptExecutionMode` は `'legacy'` を返す（既存の App・Sidebar の画面のテストは従来の方式の画面を前提にしている。差異 20）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/ipcHandlers.test.ts`（差分）:

```diff
--- a/src/main/__tests__/ipcHandlers.test.ts
+++ b/src/main/__tests__/ipcHandlers.test.ts
@@ -10,10 +10,39 @@
 const mockRegisterClaudeHandlers = vi.hoisted(() => vi.fn())
 const mockRegisterCloneHandlers = vi.hoisted(() => vi.fn())
 const mockSetupCloneLifecycle = vi.hoisted(() => vi.fn())
+const mockSetupAgentSessionLifecycle = vi.hoisted(() => vi.fn())
+const mockRegisterAgentTerminalHandlers = vi.hoisted(() => vi.fn())
+const mockSetupOpenFileWatcherLifecycle = vi.hoisted(() => vi.fn())
+const mockRegisterExternalChangeHandlers = vi.hoisted(() => vi.fn())
+const mockRegisterShellHandlers = vi.hoisted(() => vi.fn())
+const mockFromId = vi.hoisted(() => vi.fn())

 vi.mock('electron', () => ({
-  app: {}
+  app: {},
+  shell: { openExternal: vi.fn() },
+  webContents: { fromId: mockFromId }
 }))
+vi.mock('../agentSessionLifecycle', () => ({
+  setupAgentSessionLifecycle: mockSetupAgentSessionLifecycle
+}))
+vi.mock('../handlers/agentTerminalHandlers', () => ({
+  registerAgentTerminalHandlers: mockRegisterAgentTerminalHandlers
+}))
+// 実物の node-pty・ログインシェルを読まない
+vi.mock('../agentRuntime', () => ({
+  resolveAgentLaunchFromSystem: vi.fn(),
+  spawnAgentPty: vi.fn(),
+  stopAgentPtyTree: vi.fn()
+}))
+vi.mock('../openFileWatcherLifecycle', () => ({
+  setupOpenFileWatcherLifecycle: mockSetupOpenFileWatcherLifecycle
+}))
+vi.mock('../handlers/externalChangeHandlers', () => ({
+  registerExternalChangeHandlers: mockRegisterExternalChangeHandlers
+}))
+vi.mock('../handlers/shellHandlers', () => ({
+  registerShellHandlers: mockRegisterShellHandlers
+}))

 vi.mock('../folderAccessLifecycle', () => ({
   setupFolderAccessLifecycle: mockSetupFolderAccessLifecycle
@@ -45,8 +74,10 @@
   registerClaudeHandlers: mockRegisterClaudeHandlers
 }))

-import { registerIpcHandlers } from '../ipcHandlers'
+import { registerIpcHandlers, sendExternalChange } from '../ipcHandlers'
 import { CloneRegistry } from '../cloneRegistry'
+import { AgentSessionRegistry } from '../agentSessionRegistry'
+import { OpenFileWatcher } from '../openFileWatcher'

 const mockIpcMain = { handle: mockHandle } as never

@@ -113,4 +144,49 @@
     const gitArg = mockRegisterGitHandlers.mock.calls[0][1]
     expect(fsArg).toBe(gitArg)
   })
+
+  it('エージェントのセッションの寿命と IPC に、ファイル操作と同じ FolderAccessManager と同じ registry を渡す', () => {
+    registerIpcHandlers(mockIpcMain)
+    const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1]
+    const [, registry, lifecycleFolderAccess] = mockSetupAgentSessionLifecycle.mock.calls[0]
+    expect(registry).toBeInstanceOf(AgentSessionRegistry)
+    expect(lifecycleFolderAccess).toBe(folderAccess)
+    const [ipcMain, deps] = mockRegisterAgentTerminalHandlers.mock.calls[0]
+    expect(ipcMain).toBe(mockIpcMain)
+    expect(deps.folderAccess).toBe(folderAccess)
+    expect(deps.registry).toBe(registry)
+  })
+
+  it('外部変更の IPC と監視の寿命に、同じ FolderAccessManager と同じ OpenFileWatcher を渡す', () => {
+    registerIpcHandlers(mockIpcMain)
+    const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1]
+    const [, watcher, lifecycleFolderAccess] = mockSetupOpenFileWatcherLifecycle.mock.calls[0]
+    expect(watcher).toBeInstanceOf(OpenFileWatcher)
+    expect(lifecycleFolderAccess).toBe(folderAccess)
+    expect(mockRegisterExternalChangeHandlers).toHaveBeenCalledWith(
+      mockIpcMain,
+      folderAccess,
+      watcher
+    )
+    expect(mockRegisterShellHandlers).toHaveBeenCalledWith(mockIpcMain, expect.any(Function))
+  })
 })
+
+describe('sendExternalChange', () => {
+  it('所有者の webContents へ fs:externalChange を送る', () => {
+    const send = vi.fn()
+    mockFromId.mockReturnValueOnce({ isDestroyed: () => false, send })
+    sendExternalChange(3, ['/a'])
+    expect(mockFromId).toHaveBeenCalledWith(3)
+    expect(send).toHaveBeenCalledWith('fs:externalChange', { paths: ['/a'] })
+  })
+
+  it('破棄済み・見つからないときは送らない', () => {
+    const send = vi.fn()
+    mockFromId.mockReturnValueOnce({ isDestroyed: () => true, send })
+    sendExternalChange(3, ['/a'])
+    mockFromId.mockReturnValueOnce(undefined)
+    expect(() => sendExternalChange(4, ['/b'])).not.toThrow()
+    expect(send).not.toHaveBeenCalled()
+  })
+})
```

`src/preload/__tests__/api.test.ts`（差分）:

```diff
--- a/src/preload/__tests__/api.test.ts
+++ b/src/preload/__tests__/api.test.ts
@@ -3,9 +3,15 @@
 const mockInvoke = vi.hoisted(() => vi.fn())
 const mockOn = vi.hoisted(() => vi.fn())
 const mockRemoveListener = vi.hoisted(() => vi.fn())
+const mockSend = vi.hoisted(() => vi.fn())

 vi.mock('electron', () => ({
-  ipcRenderer: { invoke: mockInvoke, on: mockOn, removeListener: mockRemoveListener }
+  ipcRenderer: {
+    invoke: mockInvoke,
+    on: mockOn,
+    removeListener: mockRemoveListener,
+    send: mockSend
+  }
 }))

 import { api } from '../api'
@@ -373,3 +379,128 @@
     expect(mockRemoveListener).toHaveBeenCalledWith('prompt:streamChunk', wrapped)
   })
 })
+
+describe('エージェントのターミナル・外部変更・実行方式・リンクの API', () => {
+  it.each<[string, () => unknown, unknown[]]>([
+    [
+      'startAgentSession は agentTerminal:start に依頼を渡す',
+      () => api.startAgentSession({ folderPath: '/p', cols: 80, rows: 24 }),
+      ['agentTerminal:start', { folderPath: '/p', cols: 80, rows: 24 }]
+    ],
+    [
+      'stopAgentSession は agentTerminal:stop に sessionId を渡す',
+      () => api.stopAgentSession('s'),
+      ['agentTerminal:stop', 's']
+    ],
+    [
+      'getAgentSession は agentTerminal:getState を呼ぶ',
+      () => api.getAgentSession(),
+      ['agentTerminal:getState']
+    ],
+    [
+      'writeFileChecked は fs:writeFileChecked に path・content・baseContent を渡す',
+      () => api.writeFileChecked('/p/a', 'new', 'old'),
+      ['fs:writeFileChecked', '/p/a', 'new', 'old']
+    ],
+    [
+      'writeFileChecked は baseContent の null をそのまま渡す',
+      () => api.writeFileChecked('/p/a', 'new', null),
+      ['fs:writeFileChecked', '/p/a', 'new', null]
+    ],
+    [
+      'setWatchedFiles は fs:setWatchedFiles にパスを渡す',
+      () => api.setWatchedFiles(['/p/a']),
+      ['fs:setWatchedFiles', ['/p/a']]
+    ],
+    [
+      'getPromptExecutionMode は settings:getPromptExecutionMode を呼ぶ',
+      () => api.getPromptExecutionMode(),
+      ['settings:getPromptExecutionMode']
+    ],
+    [
+      'setPromptExecutionMode は settings:setPromptExecutionMode に方式を渡す',
+      () => api.setPromptExecutionMode('legacy'),
+      ['settings:setPromptExecutionMode', 'legacy']
+    ],
+    [
+      'openExternalLink は shell:openExternalLink に URL を渡す',
+      () => api.openExternalLink('https://x'),
+      ['shell:openExternalLink', 'https://x']
+    ]
+  ])('%s', (_name, call, expectedArgs) => {
+    call()
+    expect(mockInvoke).toHaveBeenCalledWith(...expectedArgs)
+  })
+
+  it.each<[string, () => unknown, unknown[]]>([
+    [
+      'writeAgentSession は send で順序を保って送る',
+      () => api.writeAgentSession('s', 'abc'),
+      ['agentTerminal:write', 's', 'abc']
+    ],
+    [
+      'resizeAgentSession は send で送る',
+      () => api.resizeAgentSession('s', 100, 30),
+      ['agentTerminal:resize', 's', 100, 30]
+    ],
+    [
+      'setAgentTerminalFocused は send で送る',
+      () => api.setAgentTerminalFocused(true),
+      ['agentTerminal:focus', true]
+    ]
+  ])('%s', (_name, call, expectedArgs) => {
+    call()
+    expect(mockSend).toHaveBeenCalledWith(...expectedArgs)
+    expect(mockInvoke).not.toHaveBeenCalled()
+  })
+})
+
+describe.each([
+  [
+    'onAgentData',
+    'agentTerminal:data',
+    (l: (p: unknown) => void) => api.onAgentData(l),
+    { sessionId: 's', data: 'x' },
+    [null, { sessionId: 1, data: 'x' }, { sessionId: 's', data: 1 }]
+  ],
+  [
+    'onAgentExit',
+    'agentTerminal:exit',
+    (l: (p: unknown) => void) => api.onAgentExit(l),
+    { sessionId: 's', exitCode: 1, signal: null, reason: 'exited' },
+    [null, { sessionId: 1, reason: 'exited' }, { sessionId: 's', reason: 'unknown' }]
+  ],
+  [
+    'onExternalFileChange',
+    'fs:externalChange',
+    (l: (p: unknown) => void) => api.onExternalFileChange(l),
+    { paths: ['/a'] },
+    [null, { paths: '/a' }, { paths: [1] }]
+  ]
+])('%s', (_name, channel, subscribe, valid, invalids) => {
+  it(`${channel} を購読し、検証を通った payload で呼び、解除関数で removeListener する`, () => {
+    const listener = vi.fn()
+    const unsubscribe = subscribe(listener)
+    const wrapped = mockOn.mock.calls.find(([ch]) => ch === channel)?.[1]
+    wrapped({}, valid)
+    for (const invalid of invalids) wrapped({}, invalid)
+    expect(listener.mock.calls).toEqual([[valid]])
+    unsubscribe()
+    expect(mockRemoveListener).toHaveBeenCalledWith(channel, wrapped)
+  })
+})
+
+describe('onAgentExit の正規化', () => {
+  it('exitCode・signal が数でなければ null にする', () => {
+    const listener = vi.fn()
+    api.onAgentExit(listener)
+    const wrapped = mockOn.mock.calls.find(([ch]) => ch === 'agentTerminal:exit')?.[1]
+    wrapped({}, { sessionId: 's', reason: 'stopped' })
+    expect(listener).toHaveBeenCalledWith({
+      sessionId: 's',
+      exitCode: null,
+      signal: null,
+      reason: 'stopped'
+    })
+  })
+})
```

`src/preload/__tests__/index.test.ts`（新規）:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'

const mockExposeInMainWorld = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockExposeInMainWorld },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }
}))

afterEach(() => {
  vi.resetModules()
  Reflect.deleteProperty(process, 'contextIsolated')
})

describe('preload の公開', () => {
  it('window.api だけを公開し、汎用の IPC(window.electron)は公開しない', async () => {
    Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true })
    await import('../index')
    expect(mockExposeInMainWorld.mock.calls.map(([name]) => name)).toEqual(['api'])
  })
})
```

`src/renderer/src/lib/__tests__/agentTerminalApi.test.ts`（新規）:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as agentTerminalApi from '../agentTerminalApi'

const mockApi = {
  startAgentSession: vi.fn(),
  writeAgentSession: vi.fn(),
  resizeAgentSession: vi.fn(),
  stopAgentSession: vi.fn(),
  getAgentSession: vi.fn(),
  onAgentData: vi.fn(),
  onAgentExit: vi.fn(),
  setAgentTerminalFocused: vi.fn(),
  openExternalLink: vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

describe('agentTerminalApi', () => {
  it('各関数は window.api の同名の関数へ引数をそのまま渡す', () => {
    agentTerminalApi.startAgentSession({ folderPath: '/p', cols: 80, rows: 24 })
    agentTerminalApi.writeAgentSession('s', 'x')
    agentTerminalApi.resizeAgentSession('s', 100, 30)
    agentTerminalApi.stopAgentSession('s')
    agentTerminalApi.getAgentSession()
    agentTerminalApi.setAgentTerminalFocused(true)
    agentTerminalApi.openExternalLink('https://example.com')
    expect(mockApi.startAgentSession).toHaveBeenCalledWith({ folderPath: '/p', cols: 80, rows: 24 })
    expect(mockApi.writeAgentSession).toHaveBeenCalledWith('s', 'x')
    expect(mockApi.resizeAgentSession).toHaveBeenCalledWith('s', 100, 30)
    expect(mockApi.stopAgentSession).toHaveBeenCalledWith('s')
    expect(mockApi.getAgentSession).toHaveBeenCalledOnce()
    expect(mockApi.setAgentTerminalFocused).toHaveBeenCalledWith(true)
    expect(mockApi.openExternalLink).toHaveBeenCalledWith('https://example.com')
  })

  it('購読は解除関数を返す', () => {
    const offData = vi.fn()
    const offExit = vi.fn()
    mockApi.onAgentData.mockReturnValue(offData)
    mockApi.onAgentExit.mockReturnValue(offExit)
    expect(agentTerminalApi.onAgentData(vi.fn())).toBe(offData)
    expect(agentTerminalApi.onAgentExit(vi.fn())).toBe(offExit)
  })
})
```

`src/renderer/src/lib/__tests__/settingsApi.test.ts`・`fileSystemApi.test.ts`（差分）:

```diff
--- a/src/renderer/src/lib/__tests__/settingsApi.test.ts
+++ b/src/renderer/src/lib/__tests__/settingsApi.test.ts
@@ -1,6 +1,11 @@
 import { describe, it, expect, vi, beforeEach } from 'vitest'
 import type { ModelSettings } from '@shared/types'
-import { getModelSettings, setModelSettings } from '../settingsApi'
+import {
+  getModelSettings,
+  getPromptExecutionMode,
+  setModelSettings,
+  setPromptExecutionMode
+} from '../settingsApi'

 const mockApi = {
   getModelSettings: vi.fn(),
@@ -33,3 +38,16 @@
     expect(mockApi.setModelSettings).toHaveBeenCalledWith(mockSettings)
   })
 })
+
+describe('実行方式', () => {
+  it('getPromptExecutionMode・setPromptExecutionMode は window.api に委譲する', async () => {
+    const api = {
+      getPromptExecutionMode: vi.fn().mockResolvedValue('legacy'),
+      setPromptExecutionMode: vi.fn().mockResolvedValue(undefined)
+    }
+    vi.stubGlobal('api', api)
+    await expect(getPromptExecutionMode()).resolves.toBe('legacy')
+    await setPromptExecutionMode('agent-cli')
+    expect(api.setPromptExecutionMode).toHaveBeenCalledWith('agent-cli')
+  })
+})
```

```diff
--- a/src/renderer/src/lib/__tests__/fileSystemApi.test.ts
+++ b/src/renderer/src/lib/__tests__/fileSystemApi.test.ts
@@ -9,7 +9,10 @@
   createDirectory,
   renameEntry,
   deleteEntry,
-  addToGitignore
+  addToGitignore,
+  writeFileContentChecked,
+  setWatchedFiles,
+  onExternalFileChange
 } from '../fileSystemApi'

 const mockApi = {
@@ -21,7 +24,10 @@
   createDirectory: vi.fn(),
   renameEntry: vi.fn(),
   deleteEntry: vi.fn(),
-  addToGitignore: vi.fn()
+  addToGitignore: vi.fn(),
+  writeFileChecked: vi.fn(),
+  setWatchedFiles: vi.fn(),
+  onExternalFileChange: vi.fn()
 }

 beforeEach(() => {
@@ -110,3 +116,24 @@
     expect(mockApi.addToGitignore).toHaveBeenCalledWith('/project/dist')
   })
 })
+
+describe('外部変更の検知', () => {
+  it('writeFileContentChecked は window.api.writeFileChecked に path・content・baseContent を渡し、結果を返す', async () => {
+    mockApi.writeFileChecked.mockResolvedValue({ kind: 'conflict', reason: 'modified' })
+    await expect(writeFileContentChecked('/p/a', 'new', 'old')).resolves.toEqual({
+      kind: 'conflict',
+      reason: 'modified'
+    })
+    expect(mockApi.writeFileChecked).toHaveBeenCalledWith('/p/a', 'new', 'old')
+  })
+
+  it('setWatchedFiles・onExternalFileChange は window.api に委譲する', async () => {
+    const unsubscribe = vi.fn()
+    mockApi.onExternalFileChange.mockReturnValue(unsubscribe)
+    await setWatchedFiles(['/p/a'])
+    const listener = vi.fn()
+    expect(onExternalFileChange(listener)).toBe(unsubscribe)
+    expect(mockApi.setWatchedFiles).toHaveBeenCalledWith(['/p/a'])
+    expect(mockApi.onExternalFileChange).toHaveBeenCalledWith(listener)
+  })
+})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/main/__tests__/ipcHandlers.test.ts src/preload src/renderer/src/lib/__tests__/agentTerminalApi.test.ts src/renderer/src/lib/__tests__/settingsApi.test.ts src/renderer/src/lib/__tests__/fileSystemApi.test.ts
```

Expected: FAIL（`sendExternalChange` が無い・`api.startAgentSession is not a function`・`exposeInMainWorld` が `electron` でも呼ばれる・`../agentTerminalApi` が無い・新しい export が無い）

- [ ] **Step 3: 実装する**

`src/main/ipcHandlers.ts`（差分）:

```diff
--- a/src/main/ipcHandlers.ts
+++ b/src/main/ipcHandlers.ts
@@ -1,5 +1,6 @@
+import { watch } from 'node:fs'
 import type { IpcMain } from 'electron'
-import { app } from 'electron'
+import { app, shell, webContents } from 'electron'
 import { FolderAccessManager } from './folderAccessManager'
 import { setupFolderAccessLifecycle } from './folderAccessLifecycle'
 import { registerFileSystemHandlers } from './handlers/fileSystemHandlers'
@@ -14,7 +15,21 @@
 import { registerCLIHandlers } from './handlers/cliHandlers'
 import { registerPromptCancelHandlers } from './handlers/promptCancelHandlers'
 import { registerHistoryHandlers } from './handlers/historyHandlers'
+import { AgentSessionRegistry } from './agentSessionRegistry'
+import { setupAgentSessionLifecycle } from './agentSessionLifecycle'
+import { registerAgentTerminalHandlers } from './handlers/agentTerminalHandlers'
+import { resolveAgentLaunchFromSystem, spawnAgentPty, stopAgentPtyTree } from './agentRuntime'
+import { OpenFileWatcher } from './openFileWatcher'
+import { setupOpenFileWatcherLifecycle } from './openFileWatcherLifecycle'
+import { registerExternalChangeHandlers } from './handlers/externalChangeHandlers'
+import { registerShellHandlers } from './handlers/shellHandlers'

+// 開いているタブの外部変更の通知を、その所有者(webContents)へ送る。破棄済みなら送らない
+export function sendExternalChange(ownerId: number, paths: string[]): void {
+  const target = webContents.fromId(ownerId)
+  if (target !== undefined && !target.isDestroyed()) target.send('fs:externalChange', { paths })
+}
+
 export function registerIpcHandlers(ipcMain: IpcMain): void {
   const folderAccess = new FolderAccessManager()

@@ -33,4 +48,23 @@
   registerCLIHandlers(ipcMain)
   registerPromptCancelHandlers(ipcMain)
   registerHistoryHandlers(ipcMain)
+  // エージェントのセッション。作業ディレクトリは開いているフォルダ(同じ FolderAccessManager)で、フォルダの切り替えで止める
+  const agentRegistry = new AgentSessionRegistry()
+  setupAgentSessionLifecycle(app, agentRegistry, folderAccess)
+  registerAgentTerminalHandlers(ipcMain, {
+    folderAccess,
+    registry: agentRegistry,
+    resolveLaunch: resolveAgentLaunchFromSystem,
+    spawnPty: spawnAgentPty,
+    stopTree: stopAgentPtyTree
+  })
+  // 開いているタブの外部変更の検知(保存の直前の照合と、親ディレクトリの監視)
+  const openFileWatcher = new OpenFileWatcher({
+    // persistent: false で、監視が main プロセスの終了を妨げない
+    watch: (dir, listener) => watch(dir, { persistent: false }, listener),
+    notify: sendExternalChange
+  })
+  setupOpenFileWatcherLifecycle(app, openFileWatcher, folderAccess)
+  registerExternalChangeHandlers(ipcMain, folderAccess, openFileWatcher)
+  registerShellHandlers(ipcMain, (url) => shell.openExternal(url))
 }
```

`src/preload/api.ts`・`src/preload/index.ts`・`src/preload/index.d.ts`（差分）:

```diff
--- a/src/preload/api.ts
+++ b/src/preload/api.ts
@@ -1,6 +1,14 @@
 import { ipcRenderer } from 'electron'
 import type {
+  AgentSessionData,
+  AgentSessionExit,
+  AgentSessionSnapshot,
+  AgentStartRequest,
+  AgentStartResult,
   CLIOnlyToolId,
+  ExternalFileChangeEvent,
+  PromptExecutionMode,
+  WriteFileCheckedResult,
   CloneRepositoryResult,
   ConflictChoice,
   ConflictFile,
@@ -147,5 +155,76 @@
   },
   loadHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:load'),
   saveHistory: (entries: HistoryEntry[]): Promise<void> =>
-    ipcRenderer.invoke('history:save', entries)
+    ipcRenderer.invoke('history:save', entries),
+  getPromptExecutionMode: (): Promise<PromptExecutionMode> =>
+    ipcRenderer.invoke('settings:getPromptExecutionMode'),
+  setPromptExecutionMode: (mode: PromptExecutionMode): Promise<void> =>
+    ipcRenderer.invoke('settings:setPromptExecutionMode', mode),
+  // エージェントのセッション。起動のコマンド・作業ディレクトリ・環境変数は main が決める
+  startAgentSession: (request: AgentStartRequest): Promise<AgentStartResult> =>
+    ipcRenderer.invoke('agentTerminal:start', request),
+  // キー入力・xterm の応答・貼り付けの順序を保つため send(fire-and-forget)にする
+  writeAgentSession: (sessionId: string, data: string): void =>
+    ipcRenderer.send('agentTerminal:write', sessionId, data),
+  resizeAgentSession: (sessionId: string, cols: number, rows: number): void =>
+    ipcRenderer.send('agentTerminal:resize', sessionId, cols, rows),
+  stopAgentSession: (sessionId: string): Promise<void> =>
+    ipcRenderer.invoke('agentTerminal:stop', sessionId),
+  getAgentSession: (): Promise<AgentSessionSnapshot> =>
+    ipcRenderer.invoke('agentTerminal:getState'),
+  onAgentData: (listener: (payload: AgentSessionData) => void): (() => void) => {
+    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
+      if (typeof payload !== 'object' || payload === null) return
+      const { sessionId, data } = payload as Record<string, unknown>
+      if (typeof sessionId !== 'string' || typeof data !== 'string') return
+      listener({ sessionId, data })
+    }
+    ipcRenderer.on('agentTerminal:data', wrapped)
+    return () => {
+      ipcRenderer.removeListener('agentTerminal:data', wrapped)
+    }
+  },
+  onAgentExit: (listener: (payload: AgentSessionExit) => void): (() => void) => {
+    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
+      if (typeof payload !== 'object' || payload === null) return
+      const { sessionId, exitCode, signal, reason } = payload as Record<string, unknown>
+      if (typeof sessionId !== 'string') return
+      if (reason !== 'exited' && reason !== 'stopped' && reason !== 'folder-changed') return
+      listener({
+        sessionId,
+        exitCode: typeof exitCode === 'number' ? exitCode : null,
+        signal: typeof signal === 'number' ? signal : null,
+        reason
+      })
+    }
+    ipcRenderer.on('agentTerminal:exit', wrapped)
+    return () => {
+      ipcRenderer.removeListener('agentTerminal:exit', wrapped)
+    }
+  },
+  setAgentTerminalFocused: (focused: boolean): void =>
+    ipcRenderer.send('agentTerminal:focus', focused),
+  // baseContent はタブが最後にディスクと一致した内容。null は照合せずに書く(上書きの確認の後)
+  writeFileChecked: (
+    path: string,
+    content: string,
+    baseContent: string | null
+  ): Promise<WriteFileCheckedResult> =>
+    ipcRenderer.invoke('fs:writeFileChecked', path, content, baseContent),
+  setWatchedFiles: (paths: string[]): Promise<void> =>
+    ipcRenderer.invoke('fs:setWatchedFiles', paths),
+  onExternalFileChange: (listener: (event: ExternalFileChangeEvent) => void): (() => void) => {
+    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
+      if (typeof payload !== 'object' || payload === null) return
+      const { paths } = payload as Record<string, unknown>
+      if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) return
+      listener({ paths })
+    }
+    ipcRenderer.on('fs:externalChange', wrapped)
+    return () => {
+      ipcRenderer.removeListener('fs:externalChange', wrapped)
+    }
+  },
+  openExternalLink: (url: string): Promise<boolean> =>
+    ipcRenderer.invoke('shell:openExternalLink', url)
 }
```

```diff
--- a/src/preload/index.ts
+++ b/src/preload/index.ts
@@ -1,17 +1,15 @@
 import { contextBridge } from 'electron'
-import { electronAPI } from '@electron-toolkit/preload'
 import { api } from './api'

+// renderer へは許可リスト(window.api)だけを公開する。@electron-toolkit/preload の electronAPI(window.electron)は
+// 任意のチャンネル名の invoke・send と process.env の写しを通すため公開しない(設計書「セキュリティ」)
 if (process.contextIsolated) {
   try {
-    contextBridge.exposeInMainWorld('electron', electronAPI)
     contextBridge.exposeInMainWorld('api', api)
   } catch (error) {
     console.error(error)
   }
 } else {
   // @ts-ignore (define in dts)
-  window.electron = electronAPI
-  // @ts-ignore (define in dts)
   window.api = api
 }
```

```diff
--- a/src/preload/index.d.ts
+++ b/src/preload/index.d.ts
@@ -1,6 +1,13 @@
-import { ElectronAPI } from '@electron-toolkit/preload'
 import type {
+  AgentSessionData,
+  AgentSessionExit,
+  AgentSessionSnapshot,
+  AgentStartRequest,
+  AgentStartResult,
   CLIOnlyToolId,
+  ExternalFileChangeEvent,
+  PromptExecutionMode,
+  WriteFileCheckedResult,
   CloneRepositoryResult,
   ConflictChoice,
   ConflictFile,
@@ -23,7 +30,6 @@

 declare global {
   interface Window {
-    electron: ElectronAPI
     api: {
       openFolder(): Promise<string | null>
       readDirectory(path: string): Promise<FileTreeNode[]>
@@ -106,6 +112,24 @@
       onPromptStreamChunk(listener: (requestId: string, chunk: string) => void): () => void
       loadHistory(): Promise<HistoryEntry[]>
       saveHistory(entries: HistoryEntry[]): Promise<void>
+      getPromptExecutionMode(): Promise<PromptExecutionMode>
+      setPromptExecutionMode(mode: PromptExecutionMode): Promise<void>
+      startAgentSession(request: AgentStartRequest): Promise<AgentStartResult>
+      writeAgentSession(sessionId: string, data: string): void
+      resizeAgentSession(sessionId: string, cols: number, rows: number): void
+      stopAgentSession(sessionId: string): Promise<void>
+      getAgentSession(): Promise<AgentSessionSnapshot>
+      onAgentData(listener: (payload: AgentSessionData) => void): () => void
+      onAgentExit(listener: (payload: AgentSessionExit) => void): () => void
+      setAgentTerminalFocused(focused: boolean): void
+      writeFileChecked(
+        path: string,
+        content: string,
+        baseContent: string | null
+      ): Promise<WriteFileCheckedResult>
+      setWatchedFiles(paths: string[]): Promise<void>
+      onExternalFileChange(listener: (event: ExternalFileChangeEvent) => void): () => void
+      openExternalLink(url: string): Promise<boolean>
     }
   }
 }
```

`src/renderer/src/lib/agentTerminalApi.ts`（新規）:

```ts
import type {
  AgentSessionData,
  AgentSessionExit,
  AgentSessionSnapshot,
  AgentStartRequest,
  AgentStartResult
} from '@shared/types'

// エージェントのセッションの IPC の窓口(window.api)。renderer の部品は window.api を直接触らずここを使う

export function startAgentSession(request: AgentStartRequest): Promise<AgentStartResult> {
  return window.api.startAgentSession(request)
}

export function writeAgentSession(sessionId: string, data: string): void {
  window.api.writeAgentSession(sessionId, data)
}

export function resizeAgentSession(sessionId: string, cols: number, rows: number): void {
  window.api.resizeAgentSession(sessionId, cols, rows)
}

export function stopAgentSession(sessionId: string): Promise<void> {
  return window.api.stopAgentSession(sessionId)
}

export function getAgentSession(): Promise<AgentSessionSnapshot> {
  return window.api.getAgentSession()
}

export function onAgentData(listener: (payload: AgentSessionData) => void): () => void {
  return window.api.onAgentData(listener)
}

export function onAgentExit(listener: (payload: AgentSessionExit) => void): () => void {
  return window.api.onAgentExit(listener)
}

export function setAgentTerminalFocused(focused: boolean): void {
  window.api.setAgentTerminalFocused(focused)
}

export function openExternalLink(url: string): Promise<boolean> {
  return window.api.openExternalLink(url)
}
```

`src/renderer/src/lib/settingsApi.ts`・`src/renderer/src/lib/fileSystemApi.ts`（差分）:

```diff
--- a/src/renderer/src/lib/settingsApi.ts
+++ b/src/renderer/src/lib/settingsApi.ts
@@ -1,4 +1,4 @@
-import type { ModelSettings } from '@shared/types'
+import type { ModelSettings, PromptExecutionMode } from '@shared/types'

 export function getModelSettings(): Promise<ModelSettings> {
   return window.api.getModelSettings()
@@ -7,3 +7,11 @@
 export function setModelSettings(settings: ModelSettings): Promise<void> {
   return window.api.setModelSettings(settings)
 }
+
+export function getPromptExecutionMode(): Promise<PromptExecutionMode> {
+  return window.api.getPromptExecutionMode()
+}
+
+export function setPromptExecutionMode(mode: PromptExecutionMode): Promise<void> {
+  return window.api.setPromptExecutionMode(mode)
+}
```

```diff
--- a/src/renderer/src/lib/fileSystemApi.ts
+++ b/src/renderer/src/lib/fileSystemApi.ts
@@ -1,3 +1,4 @@
+import type { ExternalFileChangeEvent, WriteFileCheckedResult } from '@shared/types'
 import type { FileTreeNode } from '../types'

 export function openFolder(): Promise<string | null> {
@@ -35,3 +36,22 @@
 export function addToGitignore(targetPath: string): Promise<void> {
   return window.api.addToGitignore(targetPath)
 }
+
+/** 保存の直前にディスクの内容を照合して書き込む。baseContent が null なら照合せずに書く(上書きの確認の後) */
+export function writeFileContentChecked(
+  path: string,
+  content: string,
+  baseContent: string | null
+): Promise<WriteFileCheckedResult> {
+  return window.api.writeFileChecked(path, content, baseContent)
+}
+
+export function setWatchedFiles(paths: string[]): Promise<void> {
+  return window.api.setWatchedFiles(paths)
+}
+
+export function onExternalFileChange(
+  listener: (event: ExternalFileChangeEvent) => void
+): () => void {
+  return window.api.onExternalFileChange(listener)
+}
```

`src/renderer/src/__tests__/setup.ts`（差分。stub に新しい API を足す）:

```diff
--- a/src/renderer/src/__tests__/setup.ts
+++ b/src/renderer/src/__tests__/setup.ts
@@ -43,6 +43,21 @@
     cancelPrompt: () => Promise.resolve(false),
     onPromptStreamChunk: () => () => {},
     loadHistory: () => Promise.resolve([]),
-    saveHistory: () => Promise.resolve()
+    saveHistory: () => Promise.resolve(),
+    // 既存のテストは従来の方式の画面を前提にしている。エージェント CLI 方式の画面のテストは個別に差し替える
+    getPromptExecutionMode: () => Promise.resolve('legacy'),
+    setPromptExecutionMode: () => Promise.resolve(),
+    startAgentSession: () => Promise.resolve({ kind: 'error', error: 'no-folder' }),
+    writeAgentSession: () => {},
+    resizeAgentSession: () => {},
+    stopAgentSession: () => Promise.resolve(),
+    getAgentSession: () => Promise.resolve(null),
+    onAgentData: () => () => {},
+    onAgentExit: () => () => {},
+    setAgentTerminalFocused: () => {},
+    writeFileChecked: () => Promise.resolve({ kind: 'written' }),
+    setWatchedFiles: () => Promise.resolve(),
+    onExternalFileChange: () => () => {},
+    openExternalLink: () => Promise.resolve(true)
   }
 })
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/main src/preload src/renderer/src/lib/__tests__/agentTerminalApi.test.ts src/renderer/src/lib/__tests__/settingsApi.test.ts src/renderer/src/lib/__tests__/fileSystemApi.test.ts 2>&1 | grep -E "Test Files|Tests |FAIL"
npm run typecheck
grep -rn "window.electron" src || echo "no window.electron"
npx eslint src/main/ipcHandlers.ts src/main/__tests__/ipcHandlers.test.ts src/preload/api.ts src/preload/index.ts src/preload/index.d.ts src/preload/__tests__/api.test.ts src/preload/__tests__/index.test.ts src/renderer/src/__tests__/setup.ts src/renderer/src/lib/agentTerminalApi.ts src/renderer/src/lib/settingsApi.ts src/renderer/src/lib/fileSystemApi.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts src/renderer/src/lib/__tests__/settingsApi.test.ts src/renderer/src/lib/__tests__/fileSystemApi.test.ts
npx prettier --check src/main/ipcHandlers.ts src/main/__tests__/ipcHandlers.test.ts src/preload/api.ts src/preload/index.ts src/preload/index.d.ts src/preload/__tests__/api.test.ts src/preload/__tests__/index.test.ts src/renderer/src/__tests__/setup.ts src/renderer/src/lib/agentTerminalApi.ts src/renderer/src/lib/settingsApi.ts src/renderer/src/lib/fileSystemApi.ts src/renderer/src/lib/__tests__/agentTerminalApi.test.ts src/renderer/src/lib/__tests__/settingsApi.test.ts src/renderer/src/lib/__tests__/fileSystemApi.test.ts
```

Expected: main・preload のすべてのテストと、窓口のテストが PASS（`ipcHandlers` 13 件・`api` 89 件・`index` 1 件）。`no window.electron`（renderer は元から使っていない。確認の結果 13）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                                           | テストのファイル      | `-t`                                      | 確認           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------- | -------------- |
| I1  | `index.ts` の `contextBridge.exposeInMainWorld('api', api)` を `contextBridge.exposeInMainWorld('electron', {}) ⏎ contextBridge.exposeInMainWorld('api', api)` にする          | `index.test.ts`       | `window.api だけを公開`                   | 落ちた（1 件） |
| I2  | `api.ts` の `ipcRenderer.send('agentTerminal:write', sessionId, data)` を `void ipcRenderer.invoke('agentTerminal:write', sessionId, data)` にする                             | `api.test.ts`         | `writeAgentSession は send`               | 落ちた（1 件） |
| I3  | `api.ts` の `if (reason !== 'exited' && reason !== 'stopped' && reason !== 'folder-changed') return` を消す                                                                    | `api.test.ts`         | `agentTerminal:exit`                      | 落ちた（1 件） |
| I4  | `ipcHandlers.ts` の `if (target !== undefined && !target.isDestroyed()) target.send` を `if (target !== undefined) target.send` にする                                         | `ipcHandlers.test.ts` | `破棄済み・見つからないときは送らない`    | 落ちた（1 件） |
| I5  | `ipcHandlers.ts` の `registerAgentTerminalHandlers(ipcMain, { ⏎ folderAccess,` を `registerAgentTerminalHandlers(ipcMain, { ⏎ folderAccess: new FolderAccessManager(),` にする | `ipcHandlers.test.ts` | `エージェントのセッションの寿命と IPC に` | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src
```

---

### Task 13: renderer: 画面の読み取りと `claude` の入力欄の判定

**Files:**

- Create: `src/renderer/src/lib/agentViewport.ts`、`src/renderer/src/lib/agentInputBox.ts`、`src/renderer/src/lib/__tests__/fixtures/agentScreens.json`（`.superpowers/agent-terminal-mvp/agent-screens.json` の写し）、`src/renderer/src/lib/__tests__/fixtures/agentScreens.ts`、`src/renderer/src/lib/__tests__/agentViewport.test.ts`、`src/renderer/src/lib/__tests__/agentInputBox.test.ts`

**Interfaces:**

- Consumes: なし（`@xterm/headless` はテストだけ）
- Produces: `interface ViewportCell { char: string; dim: boolean; inverse: boolean }`、`type ViewportLine = readonly ViewportCell[]`、`interface BufferCellLike`・`BufferLineLike`・`ViewportBufferLike`（xterm の型に依らない最小のインターフェース）、`readViewportLines(buffer, rows): ViewportLine[]`、`lineText(line): string`、`type InputBoxSymbol = 'prompt' | 'shell'`、`interface InputBox { symbol: InputBoxSymbol | null; lines: ViewportLine[] }`、`findInputBox(lines): InputBox | null`、`isInputBoxEmpty(box): boolean`、`ECHO_HEAD_MAX_COLUMNS = 24`、`headWithinColumns(text, maxColumns): string`、`isPasteEchoed(box, text, cols): boolean`。テストの補助 `agentScreen(name): { cols; rows; lines }`・`makeLine(text, dim?, inverse?): ViewportLine`・`type AgentScreenName`
- 注: 差異 4・7・8・22。セルの文字が空なら `' '`、幅 0 のセル（全角の右半分）は除く。`isDim()`・`isInverse()` は数を返す（0 以外が真）。台帳は `claude` 2.1.288 の画面。版を上げたら `agent-screens-recorder` で記録し直してテストを流す

- [ ] **Step 1: 台帳を写し、失敗するテストを書く**

```bash
mkdir -p src/renderer/src/lib/__tests__/fixtures
cp .superpowers/agent-terminal-mvp/agent-screens.json src/renderer/src/lib/__tests__/fixtures/agentScreens.json
shasum -a 256 src/renderer/src/lib/__tests__/fixtures/agentScreens.json
```

Expected: `95518dc8e65f2deb885a50e323053a65bf5fc0d15e9436b66c897c7893af800d`（差異 22。違えば写し間違い）。JSON の U+00A0 は `\u00a0` のエスケープで書かれている（JSON のエスケープで、ソースの実物の文字ではない。prettier・エディタで実物に変えない）

`src/renderer/src/lib/__tests__/fixtures/agentScreens.ts`（新規。台帳を行の配列にする補助）:

```ts
import type { ViewportCell, ViewportLine } from '../../agentViewport'
import data from './agentScreens.json'

// claude 2.1.288 の画面の記録(agentScreens.json)を、行の配列にする。lines は 行番号 → [文字列, dim の範囲, 反転の範囲]
// (範囲は [開始, 終わり) のセルの位置)。記録の手順は .superpowers/agent-terminal-mvp/agent-screens-recorder/README.md

type RawLine = [string, number[][]?, number[][]?]
interface RawScreen {
  cols: number
  rows: number
  lines: Record<string, RawLine>
}

export type AgentScreenName = keyof typeof data.screens

const inRanges = (ranges: number[][] | undefined, index: number): boolean =>
  (ranges ?? []).some(([start, end]) => index >= start && index < end)

/** 文字列と範囲から行を作る(テストの手書きの画面にも使う) */
export function makeLine(text: string, dim?: number[][], inverse?: number[][]): ViewportLine {
  return [...text].map(
    (char, index): ViewportCell => ({
      char,
      dim: inRanges(dim, index),
      inverse: inRanges(inverse, index)
    })
  )
}

export function agentScreen(name: AgentScreenName): {
  cols: number
  rows: number
  lines: ViewportLine[]
} {
  const screen = data.screens[name] as unknown as RawScreen
  const lines: ViewportLine[] = []
  for (let y = 0; y < screen.rows; y++) {
    const raw = screen.lines[String(y)]
    lines.push(raw === undefined ? [] : makeLine(raw[0], raw[1], raw[2]))
  }
  return { cols: screen.cols, rows: screen.rows, lines }
}
```

`src/renderer/src/lib/__tests__/agentViewport.test.ts`（新規。実物の `@xterm/headless` のバッファ）:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { Terminal } from '@xterm/headless'
import { lineText, readViewportLines } from '../agentViewport'

// 実物の xterm のバッファ(@xterm/headless)で、dim・反転・全角・スクロールの読み取りを確かめる
let terminal: Terminal | null = null

afterEach(() => {
  terminal?.dispose()
  terminal = null
})

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve))
}

describe('readViewportLines', () => {
  it('セルの文字・dim・反転を読み、空のセルは空白にする', async () => {
    terminal = new Terminal({ cols: 12, rows: 3, allowProposedApi: true })
    await write(terminal, 'a\x1b[2mb\x1b[22m\x1b[7mc\x1b[27m')
    const [first] = readViewportLines(terminal.buffer.active, 3)
    expect(lineText(first)).toBe('abc' + ' '.repeat(9))
    expect(first.slice(0, 3).map((cell) => [cell.dim, cell.inverse])).toEqual([
      [false, false],
      [true, false],
      [false, true]
    ])
  })

  it('全角の文字の右半分(幅 0 のセル)を除く', async () => {
    terminal = new Terminal({ cols: 10, rows: 2, allowProposedApi: true })
    await write(terminal, '日本x')
    const [first] = readViewportLines(terminal.buffer.active, 2)
    expect(lineText(first).startsWith('日本x')).toBe(true)
  })

  it('表示中の rows 行(スクロールした後は画面に見えている範囲)を読む', async () => {
    terminal = new Terminal({ cols: 10, rows: 2, allowProposedApi: true })
    await write(terminal, 'l1\r\nl2\r\nl3')
    const lines = readViewportLines(terminal.buffer.active, 2)
    expect(lines.map((line) => lineText(line).trimEnd())).toEqual(['l2', 'l3'])
  })
})
```

`src/renderer/src/lib/__tests__/agentInputBox.test.ts`（新規。記録した画面で判定を固定する）:

```ts
import { describe, it, expect } from 'vitest'
import { findInputBox, headWithinColumns, isInputBoxEmpty, isPasteEchoed } from '../agentInputBox'
import { lineText } from '../agentViewport'
import { agentScreen, makeLine } from './fixtures/agentScreens'
import type { AgentScreenName } from './fixtures/agentScreens'

const boxOf = (name: AgentScreenName): ReturnType<typeof findInputBox> =>
  findInputBox(agentScreen(name).lines)

describe('findInputBox(claude 2.1.288 の記録した画面)', () => {
  it.each<[AgentScreenName, 'prompt' | 'shell' | null, number]>([
    ['empty', 'prompt', 1],
    ['narrowEmpty', 'prompt', 1],
    ['single', 'prompt', 1],
    ['multiTyped', 'prompt', 3],
    ['long', 'prompt', 4],
    ['pasted40', 'prompt', 1],
    ['mixed', 'prompt', 1],
    ['shellEmpty', 'shell', 1],
    ['shellText', 'shell', 1],
    ['slash', 'prompt', 1],
    ['echoLeadingNewline', 'prompt', 3],
    ['working', 'prompt', 1],
    ['workingDraft', 'prompt', 1],
    ['queuedEmpty', 'prompt', 1],
    ['streamingDraft', 'prompt', 1],
    ['toolrunDraft', 'prompt', 1],
    ['tallTyped', null, 9]
  ])('%s: 記号 %s・%i 行', (name, symbol, lineCount) => {
    const box = boxOf(name)
    expect(box?.symbol).toBe(symbol)
    expect(box?.lines).toHaveLength(lineCount)
  })

  it.each<AgentScreenName>(['trust', 'fullscreen', 'permission', 'permissionAfterClear'])(
    '確認画面(%s)では見つからない',
    (name) => {
      expect(boxOf(name)).toBeNull()
    }
  )

  it('会話の履歴の「❯ hello」の行(罫線の外)は入力欄にしない', () => {
    const box = boxOf('working')
    expect(lineText(box?.lines[0] ?? []).startsWith('❯\xa0')).toBe(true)
  })

  it('下の罫線が見えない画面では見つからない', () => {
    expect(findInputBox([makeLine('❯\xa0abc'), makeLine('  more')])).toBeNull()
  })

  it('罫線の間の 2 行目が字下げでなければ入力欄にしない', () => {
    const border = makeLine('─'.repeat(40))
    expect(findInputBox([border, makeLine('❯\xa0a'), makeLine('x'), border])).toBeNull()
  })

  it('罫線が 20 文字未満なら罫線とみなさない', () => {
    const short = makeLine('─'.repeat(19))
    expect(findInputBox([short, makeLine('❯\xa0 ', [], [[2, 3]]), short])).toBeNull()
  })

  it('画面の上端まで字下げが続いても、空白だけなら入力欄にしない', () => {
    expect(findInputBox([makeLine('   '), makeLine('─'.repeat(30))])).toBeNull()
  })
})

describe('isInputBoxEmpty', () => {
  it.each<[AgentScreenName, boolean]>([
    ['empty', true],
    ['narrowEmpty', true],
    ['working', true],
    ['queuedEmpty', true],
    ['streamingAfterClear', true],
    ['toolrunAfterClear', true],
    ['single', false],
    ['singleCurMid', false],
    ['multiTyped', false],
    ['pasted40', false],
    ['mixed', false],
    ['shellEmpty', false],
    ['shellText', false],
    ['slash', false],
    ['workingDraft', false],
    ['echoLeadingNewline', false]
  ])('%s → %s', (name, expected) => {
    const box = boxOf(name)
    expect(box).not.toBeNull()
    expect(isInputBoxEmpty(box as NonNullable<typeof box>)).toBe(expected)
  })

  it('入力欄の行が画面を超えた(記号が見えない)ときは空ではない', () => {
    const box = boxOf('tallTyped')
    expect(isInputBoxEmpty(box as NonNullable<typeof box>)).toBe(false)
  })

  it('反転のカーソルが記号の直後に無ければ空ではない', () => {
    expect(isInputBoxEmpty({ symbol: 'prompt', lines: [makeLine('❯\xa0  ', [], [[3, 4]])] })).toBe(
      false
    )
  })

  it('dim でない案内の文字があれば空ではない(dim の判定を外す変異を落とす)', () => {
    expect(
      isInputBoxEmpty({ symbol: 'prompt', lines: [makeLine('❯\xa0Press up', [], [[2, 3]])] })
    ).toBe(false)
  })
})

describe('headWithinColumns', () => {
  it('半角は 1 桁、全角は 2 桁で数える', () => {
    expect(headWithinColumns('abcdef', 4)).toBe('abcd')
    expect(headWithinColumns('日本語テキスト', 5)).toBe('日本')
    expect(headWithinColumns('a😀b', 3)).toBe('a😀')
  })
})

describe('isPasteEchoed', () => {
  const cols = 100
  it('1 行目が本文の最初の行で始まれば true', () => {
    const box = boxOf('echoShort')
    expect(
      isPasteEchoed(box as NonNullable<typeof box>, 'first line of prompt\nsecond line', cols)
    ).toBe(true)
  })

  it('別の本文なら false', () => {
    const box = boxOf('echoShort')
    expect(isPasteEchoed(box as NonNullable<typeof box>, 'other text', cols)).toBe(false)
  })

  it('[Pasted text #N で始まれば true', () => {
    const box = boxOf('pasted40')
    expect(isPasteEchoed(box as NonNullable<typeof box>, 'pasted line 0\n…', cols)).toBe(true)
  })

  it('先頭が改行の本文は、1 行目が空白だけで 2 行目以降に最初の空でない行が現れれば true', () => {
    const box = boxOf('echoLeadingNewline')
    expect(isPasteEchoed(box as NonNullable<typeof box>, '\nafter blank line\nthird', cols)).toBe(
      true
    )
    expect(isPasteEchoed(box as NonNullable<typeof box>, '\nsomething else', cols)).toBe(false)
  })

  it('先頭の空白とタブ(空白 4 つで表示される)を保って比べる', () => {
    const box = boxOf('echoIndented')
    expect(isPasteEchoed(box as NonNullable<typeof box>, '  indented line\tTAB\n2nd', cols)).toBe(
      true
    )
  })

  it('日本語の本文を比べる', () => {
    const box = boxOf('echoJapanese')
    expect(isPasteEchoed(box as NonNullable<typeof box>, '日本語のプロンプト\n二行目', cols)).toBe(
      true
    )
  })

  it('長い 1 行は先頭の 24 桁だけで比べる(折り返しに依らない)', () => {
    const box = boxOf('echoLongLine')
    expect(isPasteEchoed(box as NonNullable<typeof box>, 'X'.repeat(150), cols)).toBe(true)
  })

  it('桁数が少ないときは桁数 − 4 までで比べる', () => {
    const box = { symbol: 'prompt' as const, lines: [makeLine('❯\xa0abcdef'), makeLine('  ghij')] }
    expect(isPasteEchoed(box, 'abcdefghij', 10)).toBe(true)
    expect(isPasteEchoed(box, 'abcdefXXXX', 10)).toBe(true)
    expect(isPasteEchoed(box, 'abcdeXXXXX', 10)).toBe(false)
  })

  it('シェルのモード(!)に入っていたら false', () => {
    const box = boxOf('shellText')
    expect(isPasteEchoed(box as NonNullable<typeof box>, 'ls -la', cols)).toBe(false)
  })

  it('記号が見えない(画面を超えた)入力欄では false', () => {
    const box = boxOf('tallTyped')
    expect(isPasteEchoed(box as NonNullable<typeof box>, 'typed line 5', cols)).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/agentViewport.test.ts src/renderer/src/lib/__tests__/agentInputBox.test.ts
```

Expected: FAIL（`../agentViewport`・`../agentInputBox` が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/agentViewport.ts`（新規）:

```ts
// xterm の表示中の画面を、入力欄の判定(agentInputBox)が読む行の配列にする。xterm の型に依らない最小の
// インターフェースで受ける(テストでは @xterm/headless の実物のバッファを渡せる。パターン 128)

export interface ViewportCell {
  /** セルの文字。空のセルは ' ' */
  char: string
  dim: boolean
  inverse: boolean
}

/** 画面の 1 行。幅 0 のセル(全角の文字の右半分)を除いたセルの並び */
export type ViewportLine = readonly ViewportCell[]

export interface BufferCellLike {
  getChars(): string
  getWidth(): number
  isDim(): number
  isInverse(): number
}

export interface BufferLineLike {
  readonly length: number
  getCell(x: number): BufferCellLike | undefined
}

export interface ViewportBufferLike {
  readonly viewportY: number
  getLine(y: number): BufferLineLike | undefined
}

/** 表示中の rows 行を読む(スクロールで戻していても、画面に見えている範囲) */
export function readViewportLines(buffer: ViewportBufferLike, rows: number): ViewportLine[] {
  const lines: ViewportLine[] = []
  for (let y = 0; y < rows; y++) {
    const line = buffer.getLine(buffer.viewportY + y)
    const cells: ViewportCell[] = []
    if (line !== undefined) {
      for (let x = 0; x < line.length; x++) {
        const cell = line.getCell(x)
        if (cell === undefined) break
        if (cell.getWidth() === 0) continue
        cells.push({
          char: cell.getChars() || ' ',
          dim: cell.isDim() !== 0,
          inverse: cell.isInverse() !== 0
        })
      }
    }
    lines.push(cells)
  }
  return lines
}

/** 行の文字列(セルの文字を連結したもの。末尾の空白も残す) */
export function lineText(line: ViewportLine): string {
  return line.map((cell) => cell.char).join('')
}
```

`src/renderer/src/lib/agentInputBox.ts`（新規）:

```ts
import type { ViewportLine } from './agentViewport'
import { lineText } from './agentViewport'

// claude の入力欄を画面から特定し、空か・貼り付けた本文が現れたかを判定する純粋関数(設計書「プロンプトの送信」5・6・10)。
// 入力欄は「罫線(行頭から ─ が 20 文字以上)・記号の行・罫線」で、記号の行は行頭の ❯(シェルのモードは !)に
// U+00A0(または空白)が続く。2 行目以降は 2 桁の字下げ。claude 2.1.288 の画面で記録した(agentScreens.json)。
// 確認画面(信頼・全画面の表示の案内・許可)は ❯ が行頭に無く、この並びも無い

export type InputBoxSymbol = 'prompt' | 'shell'

export interface InputBox {
  /** 記号。入力欄の行が画面の高さを超えて記号の行が見えないときは null */
  symbol: InputBoxSymbol | null
  /** 入力欄の行(記号の行から下の罫線の手前まで。記号の行が見えないときは見えている行だけ) */
  lines: ViewportLine[]
}

const BORDER = /^─{20,}/
const SYMBOL_LINE = /^([❯!])(?:[\xa0 ]|$)/
const CONTINUATION = /^ {2}/
/** 記号と、その後ろの区切り(U+00A0)の 2 文字の後ろから本文が始まる */
const TEXT_START = 2
/** 本文の先頭を比べる最大の桁数(設計書「プロンプトの送信」10) */
export const ECHO_HEAD_MAX_COLUMNS = 24

const isBorder = (line: ViewportLine): boolean => BORDER.test(lineText(line))
const isBlank = (line: ViewportLine): boolean => lineText(line).trim() === ''
const isContinuation = (line: ViewportLine): boolean =>
  CONTINUATION.test(lineText(line)) || isBlank(line)

/** 画面の下から入力欄を探す。見つからなければ null(確認画面・選択の画面など。何も送らない) */
export function findInputBox(lines: readonly ViewportLine[]): InputBox | null {
  let bottom = -1
  for (let y = lines.length - 1; y >= 0; y--) {
    if (isBorder(lines[y])) {
      bottom = y
      break
    }
  }
  if (bottom <= 0) return null
  let top = -1
  for (let y = bottom - 1; y >= 0; y--) {
    if (isBorder(lines[y])) {
      top = y
      break
    }
  }
  if (top < 0) {
    // 入力欄の行が画面の高さを超えた: 下の罫線の上が画面の上端まですべて字下げの行なら、入力欄はあるが空ではない
    const visible = lines.slice(0, bottom)
    return visible.every(isContinuation) && visible.some((line) => !isBlank(line))
      ? { symbol: null, lines: [...visible] }
      : null
  }
  const body = lines.slice(top + 1, bottom)
  if (body.length === 0) return null
  const match = SYMBOL_LINE.exec(lineText(body[0]))
  if (match === null) return null
  if (!body.slice(1).every(isContinuation)) return null
  return { symbol: match[1] === '❯' ? 'prompt' : 'shell', lines: [...body] }
}

/**
 * 入力欄が空か: 1 行で、記号が ❯(! はシェルのモードなので空ではない)、記号の後ろの文字がすべて空白か dim
 * (送信待ちの案内 `Press up to edit queued messages` など)で、反転表示のカーソルが記号の直後にある(確認の結果 21)
 */
export function isInputBoxEmpty(box: InputBox): boolean {
  if (box.symbol !== 'prompt' || box.lines.length !== 1) return false
  const cells = box.lines[0]
  if (cells[TEXT_START]?.inverse !== true) return false
  return cells.slice(TEXT_START).every((cell, index) => {
    if (index === 0) return true
    return cell.char === ' ' || cell.char === '\xa0' || cell.dim
  })
}

// 全角の文字の幅(2 桁)の範囲。厳密な East Asian Width ではなく、ハングル・CJK・全角の記号・絵文字を 2 桁とみなす
const WIDE_CODE_POINT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff]
]

const columnsOf = (char: string): number => {
  const codePoint = char.codePointAt(0) ?? 0
  return WIDE_CODE_POINT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end)
    ? 2
    : 1
}

/** 行の先頭から、桁数が maxColumns を超えない範囲の文字列 */
export function headWithinColumns(text: string, maxColumns: number): string {
  let columns = 0
  let head = ''
  for (const char of text) {
    const width = columnsOf(char)
    if (columns + width > maxColumns) break
    columns += width
    head += char
  }
  return head
}

const textAfterSymbol = (line: ViewportLine): string =>
  lineText(line).slice(TEXT_START).replace(/\xa0/g, ' ')

/**
 * 貼り付けた本文が入力欄に現れたか(設計書「プロンプトの送信」10)。記号が ❯ で、入力欄の 1 行目が本文の最初の行の先頭
 * (最大 24 桁。桁数が少ないときは折り返しを考えて桁数 − 4 まで。タブは空白 4 つで表示される)で始まるか、
 * `[Pasted text #<数字>` で始まるとき true。本文の最初の行が空白だけのときは、1 行目が空白だけで、2 行目以降に
 * 最初の空でない行の先頭が現れることで確かめる
 */
export function isPasteEchoed(box: InputBox, text: string, cols: number): boolean {
  if (box.symbol !== 'prompt' || box.lines.length === 0) return false
  const first = textAfterSymbol(box.lines[0])
  if (/^\[Pasted text #\d/.test(first)) return true
  const maxColumns = Math.max(1, Math.min(ECHO_HEAD_MAX_COLUMNS, cols - 4))
  const sourceLines = text.split('\n').map((line) => line.replace(/\t/g, '    '))
  const firstHead = headWithinColumns(sourceLines[0], maxColumns).trimEnd()
  if (firstHead !== '') return first.startsWith(firstHead)
  if (first.trim() !== '') return false
  const nextLine = sourceLines.slice(1).find((line) => line.trim() !== '')
  if (nextLine === undefined) return false
  const nextHead = headWithinColumns(nextLine, maxColumns).trimEnd()
  return box.lines.slice(1).some((line) => textAfterSymbol(line).startsWith(nextHead))
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/agentViewport.test.ts src/renderer/src/lib/__tests__/agentInputBox.test.ts
npm run typecheck
npx eslint src/renderer/src/lib/agentViewport.ts src/renderer/src/lib/agentInputBox.ts src/renderer/src/lib/__tests__/fixtures/agentScreens.ts src/renderer/src/lib/__tests__/agentViewport.test.ts src/renderer/src/lib/__tests__/agentInputBox.test.ts
npx prettier --check src/renderer/src/lib/agentViewport.ts src/renderer/src/lib/agentInputBox.ts src/renderer/src/lib/__tests__/fixtures/agentScreens.ts src/renderer/src/lib/__tests__/agentViewport.test.ts src/renderer/src/lib/__tests__/agentInputBox.test.ts
grep -rnP '[\x{00A0}\x{200B}\x{FEFF}\x{0080}-\x{009F}]' src || echo "no invisible chars"
```

Expected: PASS（3 + 56 件）。`no invisible chars`。台帳の JSON は prettier にかけない（変更したファイルの一覧から外す。整形で 1,200 行の差分が出るのを避ける）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                                        | テストのファイル        | `-t`                                   | 確認           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------- | -------------- |
| B1  | `agentInputBox.ts` の `const SYMBOL_LINE = /^([❯!])(?:[\xa0 ]\|$)/` を `const SYMBOL_LINE = /^([❯!])(?: \|$)/` にする                                                       | `agentInputBox.test.ts` | `empty`                                | 落ちた（2 件） |
| B2  | `agentInputBox.ts` の `return cell.char === ' ' \|\| cell.char === '\xa0' \|\| cell.dim` を `return cell.char === ' ' \|\| cell.char === '\xa0'` にする                     | `agentInputBox.test.ts` | `queuedEmpty`                          | 落ちた（1 件） |
| B3  | `agentInputBox.ts` の `if (cells[TEXT_START]?.inverse !== true) return false` を消す                                                                                        | `agentInputBox.test.ts` | `反転のカーソルが記号の直後に無ければ` | 落ちた（1 件） |
| B4  | `agentInputBox.ts` の `if (!body.slice(1).every(isContinuation)) return null` を消す                                                                                        | `agentInputBox.test.ts` | `2 行目が字下げでなければ`             | 落ちた（1 件） |
| B5  | `agentInputBox.ts` の `if (box.symbol !== 'prompt' \|\| box.lines.length === 0) return false` を `if (box.symbol === null \|\| box.lines.length === 0) return false` にする | `agentInputBox.test.ts` | `シェルのモード`                       | 落ちた（1 件） |
| B6  | `agentInputBox.ts` の `Math.min(ECHO_HEAD_MAX_COLUMNS, cols - 4)` を `ECHO_HEAD_MAX_COLUMNS` にする                                                                         | `agentInputBox.test.ts` | `桁数が少ないときは`                   | 落ちた（1 件） |
| B7  | `agentInputBox.ts` の `? 2 ⏎ : 1 ⏎ }` を `? 1 ⏎ : 1 ⏎ }` にする                                                                                                             | `agentInputBox.test.ts` | `全角は 2 桁`                          | 落ちた（1 件） |
| B8  | `agentViewport.ts` の `if (cell.getWidth() === 0) continue` を消す                                                                                                          | `agentViewport.test.ts` | `幅 0 のセル`                          | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/renderer
```

---

### Task 14: renderer: 送信の手順（`agentPromptSend`）

**Files:**

- Create: `src/renderer/src/lib/agentPromptSend.ts`、`src/renderer/src/lib/__tests__/agentPromptSend.test.ts`

**Interfaces:**

- Consumes: `normalizeAgentPrompt`・`buildAgentPasteBytes`・`AGENT_CLEAR_INPUT_CHUNK`・`AGENT_SUBMIT_KEY`・`AgentPromptRejection`（Task 2）、`ViewportLine`・`findInputBox`・`isInputBoxEmpty`・`isPasteEchoed`（Task 13）、テストの補助 `agentScreen`・`makeLine`（Task 13）
- Produces: `AGENT_CLEAR_INTERVAL_MS = 30`・`AGENT_CLEAR_TIMEOUT_MS = 3_000`・`AGENT_EMPTY_CONFIRM_INTERVAL_MS = 50`・`AGENT_ECHO_POLL_MS = 16`・`AGENT_ECHO_TIMEOUT_MS = 1_000`、`type AgentSendFailure = AgentPromptRejection | 'not-accepting' | 'input-not-found' | 'clear-failed' | 'not-echoed'`、`type AgentSendOutcome = { kind: 'sent'; clearedDraft: boolean } | { kind: 'failed'; reason: AgentSendFailure }`、`interface AgentSendTarget { isBracketedPasteEnabled(); readViewport(); getCols(); write(data) }`、`interface AgentSendClock { now(); sleep(ms) }`、`realClock`、`sendAgentPrompt(target, rawText, clock?): Promise<AgentSendOutcome>`
- 注: 設計書「プロンプトの送信」3〜12 と「送るバイト列のまとめ」。React に依らない関数にして、時計は注入する（テストは仮想の時計で、実際のタイマーを使わない。タイマーの後始末が要らない）。偽の送り先は `claude` の入力欄を真似る（消去のキー 24 バイトごとに N 文字消す・貼り付けで本文が入る・シェルのモード・確認画面）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentPromptSend.test.ts`（新規）:

```ts
import { describe, it, expect } from 'vitest'
import { AGENT_CLEAR_INPUT_CHUNK } from '@shared/agentPasteText'
import { sendAgentPrompt, AGENT_CLEAR_TIMEOUT_MS } from '../agentPromptSend'
import type { AgentSendClock, AgentSendTarget } from '../agentPromptSend'
import type { ViewportLine } from '../agentViewport'
import { agentScreen, makeLine } from './fixtures/agentScreens'

// 仮想の時計(sleep で時間を進めるだけ。実際のタイマーを使わない)
function makeClock(): AgentSendClock & { elapsed(): number } {
  let now = 0
  return { now: () => now, sleep: async (ms) => void (now += ms), elapsed: () => now }
}

// claude の入力欄を真似る偽の送り先。入力欄の文字列を持ち、消去のキー 24 バイトごとに clearPerChunk 文字を消し、
// 貼り付けで本文を入れる。書き込みはすべて記録する
interface FakeClaude extends AgentSendTarget {
  writes: string[]
  input: string
  mode: 'prompt' | 'shell' | 'dialog'
  bracketed: boolean
}

function makeFakeClaude(
  options: {
    input?: string
    clearPerChunk?: number
    mode?: FakeClaude['mode']
    echo?: boolean
    onWrite?: (fake: FakeClaude, data: string) => void
  } = {}
): FakeClaude {
  const border = makeLine('─'.repeat(60))
  const fake: FakeClaude = {
    writes: [],
    input: options.input ?? '',
    mode: options.mode ?? 'prompt',
    bracketed: true,
    isBracketedPasteEnabled: () => fake.bracketed,
    getCols: () => 60,
    readViewport: (): ViewportLine[] => {
      if (fake.mode === 'dialog') return agentScreen('trust').lines
      const symbol = fake.mode === 'shell' ? '!' : '❯'
      const [first, ...rest] = fake.input.split('\n')
      const cursorAt = 2 + (rest.length === 0 ? first.length : 0)
      const lines = [
        makeLine(`${symbol}\xa0${first} `, [], rest.length === 0 ? [[cursorAt, cursorAt + 1]] : [])
      ]
      for (const line of rest) lines.push(makeLine(`  ${line}`))
      return [makeLine('history'), border, ...lines, border, makeLine('  status')]
    },
    write: (data) => {
      fake.writes.push(data)
      if (data === AGENT_CLEAR_INPUT_CHUNK) {
        fake.input = fake.input.slice(
          0,
          Math.max(0, fake.input.length - (options.clearPerChunk ?? 1000))
        )
        if (fake.mode === 'shell' && fake.input === '') fake.mode = 'prompt'
      } else if (data.startsWith('\x1b[200~')) {
        if (options.echo !== false) fake.input = data.slice(6, -6)
      }
      options.onWrite?.(fake, data)
    }
  }
  return fake
}

describe('sendAgentPrompt', () => {
  it('空の入力欄でも消去を 1 回送ってから、空を 2 回確かめて貼り付け、現れたら Enter を送る', async () => {
    const fake = makeFakeClaude()
    const clock = makeClock()
    await expect(sendAgentPrompt(fake, 'hello\nworld', clock)).resolves.toEqual({
      kind: 'sent',
      clearedDraft: false
    })
    expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\nworld\x1b[201~', '\r'])
  })

  it('書きかけがあれば 24 バイトずつ 30ms 空けて消し、空になったら止め、消去と貼り付けは別の書き込みにする', async () => {
    const fake = makeFakeClaude({ input: 'abcdefghij', clearPerChunk: 4 })
    const result = await sendAgentPrompt(fake, 'prompt', makeClock())
    expect(result).toEqual({ kind: 'sent', clearedDraft: true })
    const clears = fake.writes.filter((data) => data === AGENT_CLEAR_INPUT_CHUNK)
    expect(clears).toHaveLength(3)
    expect(
      fake.writes.every((data) => data === AGENT_CLEAR_INPUT_CHUNK || !data.includes('\x0b'))
    ).toBe(true)
    expect(fake.writes.slice(-2)).toEqual(['\x1b[200~prompt\x1b[201~', '\r'])
  })

  it('1 回の書き込みが 24 バイトを超えない(消去)', async () => {
    const fake = makeFakeClaude({ input: 'x'.repeat(50), clearPerChunk: 5 })
    await sendAgentPrompt(fake, 'p', makeClock())
    for (const data of fake.writes.filter((d) => d.includes('\x0b')))
      expect(data.length).toBeLessThanOrEqual(24)
  })

  it('空にならなければ 3,000ms で止め、貼り付けも Enter も送らない', async () => {
    const fake = makeFakeClaude({ input: 'stuck', clearPerChunk: 0 })
    const clock = makeClock()
    await expect(sendAgentPrompt(fake, 'p', clock)).resolves.toEqual({
      kind: 'failed',
      reason: 'clear-failed'
    })
    expect(clock.elapsed()).toBeGreaterThanOrEqual(AGENT_CLEAR_TIMEOUT_MS)
    expect(clock.elapsed()).toBeLessThan(AGENT_CLEAR_TIMEOUT_MS + 100)
    expect(fake.writes.every((data) => data === AGENT_CLEAR_INPUT_CHUNK)).toBe(true)
  })

  it('入力欄が見つからなければ(確認画面)何も送らない', async () => {
    const fake = makeFakeClaude({ mode: 'dialog' })
    await expect(sendAgentPrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'input-not-found'
    })
    expect(fake.writes).toEqual([])
  })

  it('消している途中で入力欄が見つからなくなったら止める', async () => {
    const fake = makeFakeClaude({
      input: 'abcdefgh',
      clearPerChunk: 2,
      onWrite: (f) => {
        f.mode = 'dialog'
      }
    })
    await expect(sendAgentPrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'input-not-found'
    })
    expect(fake.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK])
  })

  it('空が 2 回続くまで貼り付けない(1 回目の空の後に書きかけが戻ったら消し直す)', async () => {
    let reads = 0
    const fake = makeFakeClaude()
    const original = fake.readViewport
    fake.readViewport = () => {
      reads += 1
      // 2 回目の読み取りの時点で利用者の打鍵が入っていた(描き直しの途中)
      if (reads === 2) fake.input = 'late'
      return original()
    }
    await expect(sendAgentPrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'sent',
      clearedDraft: true
    })
    expect(fake.writes[0]).toBe(AGENT_CLEAR_INPUT_CHUNK)
  })

  it('貼り付けた本文が 1,000ms 以内に現れなければ Enter を送らない', async () => {
    const fake = makeFakeClaude({ echo: false })
    await expect(sendAgentPrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'not-echoed'
    })
    expect(fake.writes).toEqual(['\x1b[200~p\x1b[201~'])
  })

  it('貼り付けでシェルのモード(!)に入ったら Enter を送らない', async () => {
    const fake = makeFakeClaude({
      onWrite: (f, data) => {
        if (data.startsWith('\x1b[200~')) f.mode = 'shell'
      }
    })
    await expect(sendAgentPrompt(fake, ' x', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'not-echoed'
    })
    expect(fake.writes).not.toContain('\r')
  })

  it('シェルのモード(!)の書きかけは消して通常の入力欄に戻してから送る', async () => {
    const fake = makeFakeClaude({ input: 'ls', mode: 'shell', clearPerChunk: 10 })
    await expect(sendAgentPrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'sent',
      clearedDraft: true
    })
  })

  it.each([
    ['空白だけ', '  \n ', 'empty'],
    ['先頭が「!」', '!rm -rf', 'leading-bang'],
    ['長すぎる', 'a'.repeat(200_001), 'too-long']
  ])('%s の本文は何も送らない', async (_label, text, reason) => {
    const fake = makeFakeClaude()
    await expect(sendAgentPrompt(fake, text, makeClock())).resolves.toEqual({
      kind: 'failed',
      reason
    })
    expect(fake.writes).toEqual([])
  })

  it('bracketed paste が無効なら何も送らない', async () => {
    const fake = makeFakeClaude()
    fake.bracketed = false
    await expect(sendAgentPrompt(fake, 'p', makeClock())).resolves.toEqual({
      kind: 'failed',
      reason: 'not-accepting'
    })
    expect(fake.writes).toEqual([])
  })

  it('本文の ESC を取り除いて貼り付ける', async () => {
    const fake = makeFakeClaude()
    await sendAgentPrompt(fake, 'a\x1b[201~\rb', makeClock())
    expect(fake.writes[0]).toBe('\x1b[200~a[201~\nb\x1b[201~')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/agentPromptSend.test.ts
```

Expected: FAIL（`../agentPromptSend` が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/agentPromptSend.ts`（新規）:

```ts
import {
  AGENT_CLEAR_INPUT_CHUNK,
  AGENT_SUBMIT_KEY,
  buildAgentPasteBytes,
  normalizeAgentPrompt
} from '@shared/agentPasteText'
import type { AgentPromptRejection } from '@shared/agentPasteText'
import type { ViewportLine } from './agentViewport'
import { findInputBox, isInputBoxEmpty, isPasteEchoed } from './agentInputBox'

// プロンプトを起動中の claude の入力欄へ送る手順(設計書「プロンプトの送信」3〜13)。正規化 → 入力欄の特定 → 空にする →
// 空の確認 → 貼り付け → 現れたかの確認 → Enter。各段で確かめられなければ、その時点で止めて何も送らない(Enter は送らない)。
// React に依らない関数にし、待ち時間は注入する(テストでは仮想の時計で進める)

/** 消去の書き込みの間隔(1 回 24 バイト。間を空けずに続けると一部しか効かない。確認の結果 18) */
export const AGENT_CLEAR_INTERVAL_MS = 30
/** 入力欄を空にするまでの上限(300 行の入力で 1.6〜2.1 秒。確認の結果 20) */
export const AGENT_CLEAR_TIMEOUT_MS = 3_000
/** 空の確認の間隔(描き直しの途中の画面で判定しないため、2 回続けて空を確かめる) */
export const AGENT_EMPTY_CONFIRM_INTERVAL_MS = 50
/** 貼り付けた本文が現れたかを確かめる間隔と上限(実測 13〜24ms。確認の結果 8) */
export const AGENT_ECHO_POLL_MS = 16
export const AGENT_ECHO_TIMEOUT_MS = 1_000

export type AgentSendFailure =
  | AgentPromptRejection
  | 'not-accepting'
  | 'input-not-found'
  | 'clear-failed'
  | 'not-echoed'

export type AgentSendOutcome =
  | { kind: 'sent'; clearedDraft: boolean }
  | { kind: 'failed'; reason: AgentSendFailure }

/** 送り先(agentTerminalController の一部)。write は利用者のキー入力の保留とは別に、直接 pty へ送る */
export interface AgentSendTarget {
  isBracketedPasteEnabled(): boolean
  readViewport(): ViewportLine[]
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

export async function sendAgentPrompt(
  target: AgentSendTarget,
  rawText: string,
  clock: AgentSendClock = realClock
): Promise<AgentSendOutcome> {
  const normalized = normalizeAgentPrompt(rawText)
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

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/agentPromptSend.test.ts
npm run typecheck
npx eslint src/renderer/src/lib/agentPromptSend.ts src/renderer/src/lib/__tests__/agentPromptSend.test.ts
npx prettier --check src/renderer/src/lib/agentPromptSend.ts src/renderer/src/lib/__tests__/agentPromptSend.test.ts
grep -rnP '[\x{00A0}\x{200B}\x{FEFF}\x{0080}-\x{009F}]' src || echo "no invisible chars"
```

Expected: PASS（15 件）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                                                                                                                                                     | テストのファイル          | `-t`                                           | 確認           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------- | -------------- |
| D1  | `agentPromptSend.ts` の `if (consecutiveEmpty >= 2)` を `if (consecutiveEmpty >= 1)` にする                                                                                                                                                                                              | `agentPromptSend.test.ts` | `空が 2 回続くまで貼り付けない`                | 落ちた（1 件） |
| D2  | `agentPromptSend.ts` の `if (box === null) return { kind: 'failed', reason: 'input-not-found' } ⏎ if (isInputBoxEmpty(box)) {` を `if (box === null && consecutiveEmpty > 99) return { kind: 'failed', reason: 'input-not-found' } ⏎ if (box !== null && isInputBoxEmpty(box)) {` にする | `agentPromptSend.test.ts` | `消している途中で入力欄が見つからなくなったら` | 落ちた（1 件） |
| D3  | `agentPromptSend.ts` の `if (!target.isBracketedPasteEnabled()) return { kind: 'failed', reason: 'not-accepting' }` を消す                                                                                                                                                               | `agentPromptSend.test.ts` | `bracketed paste が無効なら`                   | 落ちた（1 件） |
| D4  | `agentPromptSend.ts` の `if (box !== null && isPasteEchoed(box, normalized.text, target.getCols())) {` を `if (box !== null) {` にする                                                                                                                                                   | `agentPromptSend.test.ts` | `以内に現れなければ`                           | 落ちた（1 件） |
| D5  | `agentPromptSend.ts` の `target.write(AGENT_CLEAR_INPUT_CHUNK)` を `target.write(AGENT_CLEAR_INPUT_CHUNK + AGENT_CLEAR_INPUT_CHUNK)` にする                                                                                                                                              | `agentPromptSend.test.ts` | `24 バイトを超えない`                          | 落ちた（1 件） |

「空にならないときの上限の判定を外す」変異（`if (clock.now() >= deadline) return { kind: 'failed', reason: 'clear-failed' }` の 2 か所目を消す）は、偽の送り先が空にならない場合に無限ループになるため行わない（`空にならなければ 3,000ms で止め` のテストが、経過した仮想の時間の上限を固定している）。「貼り付けの後にシェルのモードに入ったら止める」の判定を外す変異は、時間切れでも同じ結果（Enter を送らない）になる等価な変異として記録する（パターン 130）。

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/renderer
```

---

### Task 15: renderer: キーの振り分けとクイックオープンの除外

**Files:**

- Create: `src/renderer/src/lib/agentTerminalKeys.ts`、`src/renderer/src/lib/platform.ts`、`src/renderer/src/lib/__tests__/agentTerminalKeys.test.ts`、`src/renderer/src/lib/__tests__/platform.test.ts`
- Modify: `src/renderer/src/hooks/useQuickOpen.ts:297-298`（ターミナルの中の `Ctrl+P` を通す）、`src/renderer/src/hooks/__tests__/useQuickOpen.test.ts`（末尾に追加）

**Interfaces:**

- Consumes: なし
- Produces: `AGENT_TERMINAL_ATTRIBUTE = 'data-agent-terminal'`、`isInsideAgentTerminal(target: EventTarget | null): boolean`、`type AgentTerminalKeyAction = 'terminal' | 'copy' | 'paste' | 'focus-out' | 'ignore'`、`type AgentTerminalKeyEvent = Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>`、`classifyAgentTerminalKey(event, isMac, hasSelection): AgentTerminalKeyAction`、`isMacPlatform(userAgent?: string): boolean`
- 注: 設計書「キーバインドとフォーカス」。`useQuickOpen` は capture で `document` の keydown を受けるため、xterm より先に動く。ターミナルの中の `Ctrl+P`（`metaKey` なし）は `preventDefault` もせずに通す（xterm が `\x10` を送る）。macOS の `Cmd+P` はターミナルの中でも開く。Escape は従来どおり（開いていないときは処理しない）。ほかの document のハンドラも、今後はこの判定を使う

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentTerminalKeys.test.ts`（新規）:

```ts
import { describe, it, expect } from 'vitest'
import { classifyAgentTerminalKey, isInsideAgentTerminal } from '../agentTerminalKeys'

const key = (
  init: Partial<KeyboardEvent> & { key: string }
): Parameters<typeof classifyAgentTerminalKey>[0] => ({
  type: 'keydown',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...init
})

describe('classifyAgentTerminalKey', () => {
  it.each<[string, Parameters<typeof classifyAgentTerminalKey>[0], boolean, boolean, string]>([
    ['F6 は抜ける', key({ key: 'F6' }), false, false, 'focus-out'],
    ['macOS でも F6 は抜ける', key({ key: 'F6' }), true, false, 'focus-out'],
    ['修飾キー付きの F6 は端末へ', key({ key: 'F6', shiftKey: true }), false, false, 'terminal'],
    [
      'Win・Linux の Ctrl+Shift+C(選択あり)はコピー',
      key({ key: 'C', ctrlKey: true, shiftKey: true }),
      false,
      true,
      'copy'
    ],
    [
      'Win・Linux の Ctrl+Shift+C(選択なし)は送らない',
      key({ key: 'C', ctrlKey: true, shiftKey: true }),
      false,
      false,
      'ignore'
    ],
    [
      'Win・Linux の Ctrl+Shift+V は貼り付け',
      key({ key: 'V', ctrlKey: true, shiftKey: true }),
      false,
      false,
      'paste'
    ],
    ['Ctrl+C は端末へ(claude の中断)', key({ key: 'c', ctrlKey: true }), false, true, 'terminal'],
    ['Ctrl+P は端末へ', key({ key: 'p', ctrlKey: true }), false, false, 'terminal'],
    [
      'macOS の Ctrl+Shift+C は端末へ(Cmd+C を使う)',
      key({ key: 'C', ctrlKey: true, shiftKey: true }),
      true,
      true,
      'terminal'
    ],
    ['keyup は端末へ', key({ key: 'F6', type: 'keyup' }), false, false, 'terminal']
  ])('%s', (_label, event, isMac, hasSelection, expected) => {
    expect(classifyAgentTerminalKey(event, isMac, hasSelection)).toBe(expected)
  })
})

describe('isInsideAgentTerminal', () => {
  it('data-agent-terminal の要素の中なら true', () => {
    const outer = document.createElement('div')
    outer.setAttribute('data-agent-terminal', '')
    const inner = document.createElement('textarea')
    outer.appendChild(inner)
    expect(isInsideAgentTerminal(inner)).toBe(true)
    expect(isInsideAgentTerminal(document.createElement('div'))).toBe(false)
    expect(isInsideAgentTerminal(null)).toBe(false)
    expect(isInsideAgentTerminal(window)).toBe(false)
  })
})
```

`src/renderer/src/lib/__tests__/platform.test.ts`（新規）:

```ts
import { describe, it, expect } from 'vitest'
import { isMacPlatform } from '../platform'

describe('isMacPlatform', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/39', true],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/39', false],
    ['Mozilla/5.0 (X11; Linux x86_64) Electron/39', false]
  ])('%s → %s', (userAgent, expected) => {
    expect(isMacPlatform(userAgent)).toBe(expected)
  })
})
```

`src/renderer/src/hooks/__tests__/useQuickOpen.test.ts`（末尾に追加）:

```diff
--- a/src/renderer/src/hooks/__tests__/useQuickOpen.test.ts
+++ b/src/renderer/src/hooks/__tests__/useQuickOpen.test.ts
@@ -998,3 +998,42 @@
     expect(selectFile).toHaveBeenCalledTimes(2)
   })
 })
+
+describe('useQuickOpen: ターミナルの中のキー', () => {
+  // ターミナルの領域(data-agent-terminal)の中の入力欄を作る。テストの後に外す
+  const makeTerminalInput = (): { input: HTMLTextAreaElement; cleanup: () => void } => {
+    const area = document.createElement('div')
+    area.setAttribute('data-agent-terminal', '')
+    const input = document.createElement('textarea')
+    area.appendChild(input)
+    document.body.appendChild(area)
+    return { input, cleanup: () => area.remove() }
+  }
+
+  it('ターミナルの中の Ctrl+P は開かず、preventDefault もしない(端末へ通す)', () => {
+    const { result } = setup()
+    const { input, cleanup } = makeTerminalInput()
+    const event = pressKeyOnElement(input, { key: 'p', ctrlKey: true })
+    expect(result.current.isOpen).toBe(false)
+    expect(event.defaultPrevented).toBe(false)
+    cleanup()
+  })
+
+  it('ターミナルの中でも Cmd+P は開く', () => {
+    const { result } = setup()
+    const { input, cleanup } = makeTerminalInput()
+    const event = pressKeyOnElement(input, { key: 'p', metaKey: true })
+    expect(result.current.isOpen).toBe(true)
+    expect(event.defaultPrevented).toBe(true)
+    cleanup()
+  })
+
+  it('ターミナルの外の Ctrl+P は従来どおり開く', () => {
+    const { result } = setup()
+    const outside = document.createElement('input')
+    document.body.appendChild(outside)
+    pressKeyOnElement(outside, { key: 'p', ctrlKey: true })
+    expect(result.current.isOpen).toBe(true)
+    outside.remove()
+  })
+})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/agentTerminalKeys.test.ts src/renderer/src/lib/__tests__/platform.test.ts src/renderer/src/hooks/__tests__/useQuickOpen.test.ts
```

Expected: FAIL（モジュールが無い。`useQuickOpen` の `ターミナルの中の Ctrl+P は開かず…` が 1 件失敗）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/agentTerminalKeys.ts`（新規）:

```ts
// ターミナル(xterm)のキー入力の振り分け(設計書「キーバインドとフォーカス」)。attachCustomKeyEventHandler に渡す判定の純粋関数と、
// document のハンドラがターミナルの中のイベントかを見分ける関数

/** ターミナルの領域の要素に付ける属性(AgentTerminalView) */
export const AGENT_TERMINAL_ATTRIBUTE = 'data-agent-terminal'

/** イベントの対象がターミナルの領域の中か。document のキーのハンドラは、これで除外するキーを決める */
export function isInsideAgentTerminal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${AGENT_TERMINAL_ATTRIBUTE}]`) !== null
}

/**
 * terminal: xterm に任せる(端末へ送る)。copy・paste: アプリが処理して端末へ送らない(Windows・Linux の Ctrl+Shift+C・V)。
 * focus-out: F6 でターミナルから抜ける。ignore: 端末へ送らず何もしない(選択範囲の無い Ctrl+Shift+C)
 */
export type AgentTerminalKeyAction = 'terminal' | 'copy' | 'paste' | 'focus-out' | 'ignore'

export type AgentTerminalKeyEvent = Pick<
  KeyboardEvent,
  'type' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'
>

export function classifyAgentTerminalKey(
  event: AgentTerminalKeyEvent,
  isMac: boolean,
  hasSelection: boolean
): AgentTerminalKeyAction {
  if (event.type !== 'keydown') return 'terminal'
  const noModifiers = !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
  if (event.key === 'F6' && noModifiers) return 'focus-out'
  // macOS は Cmd+C・Cmd+V(Edit メニュー)で、xterm の copy・paste のイベントが扱う。Ctrl+C は常に端末へ(claude の中断)
  if (isMac) return 'terminal'
  if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
    const key = event.key.toLowerCase()
    if (key === 'c') return hasSelection ? 'copy' : 'ignore'
    if (key === 'v') return 'paste'
  }
  return 'terminal'
}
```

`src/renderer/src/lib/platform.ts`（新規）:

```ts
/** macOS で動いているか(キー操作の振り分けに使う。Cmd と Ctrl の役割が違う) */
export function isMacPlatform(userAgent: string = navigator.userAgent): boolean {
  return /Mac/i.test(userAgent)
}
```

`src/renderer/src/hooks/useQuickOpen.ts`（差分）:

```diff
--- a/src/renderer/src/hooks/useQuickOpen.ts
+++ b/src/renderer/src/hooks/useQuickOpen.ts
@@ -5,6 +5,7 @@
 import { flattenFileTree, searchFiles } from '../lib/quickOpenSearch'
 import { toComparablePath } from '../lib/pathUtils'
 import { useLatestRef } from './useLatestRef'
+import { isInsideAgentTerminal } from '../lib/agentTerminalKeys'

 /** 空クエリのときに表示する「最近開いたファイル」の最大件数 */
 const MAX_RECENT_FILES = 10
@@ -295,6 +296,8 @@
         return
       }
       if (!(event.ctrlKey || event.metaKey)) return
+      // ターミナルの中の Ctrl+P は端末へ通す(claude・シェルの履歴の上)。macOS の Cmd+P はターミナルの中でも開く
+      if (event.ctrlKey && !event.metaKey && isInsideAgentTerminal(event.target)) return
       if (event.shiftKey || event.altKey) return
       if (event.key.toLowerCase() !== 'p') return
       // ブラウザの印刷は常に抑止する。ただし既に表示中なら open() を呼ばない
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/agentTerminalKeys.test.ts src/renderer/src/lib/__tests__/platform.test.ts src/renderer/src/hooks/__tests__/useQuickOpen.test.ts src/renderer/src/components/quick-open
npm run typecheck
npx eslint src/renderer/src/lib/agentTerminalKeys.ts src/renderer/src/lib/platform.ts src/renderer/src/hooks/useQuickOpen.ts src/renderer/src/lib/__tests__/agentTerminalKeys.test.ts src/renderer/src/lib/__tests__/platform.test.ts src/renderer/src/hooks/__tests__/useQuickOpen.test.ts
npx prettier --check src/renderer/src/lib/agentTerminalKeys.ts src/renderer/src/lib/platform.ts src/renderer/src/hooks/useQuickOpen.ts src/renderer/src/lib/__tests__/agentTerminalKeys.test.ts src/renderer/src/lib/__tests__/platform.test.ts src/renderer/src/hooks/__tests__/useQuickOpen.test.ts
```

Expected: PASS（11 + 3 + `useQuickOpen` 76 件。クイックオープンの部品のテストも通る）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                                                                        | テストのファイル            | `-t`                     | 確認           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------ | -------------- |
| K1  | `useQuickOpen.ts` の `if (event.ctrlKey && !event.metaKey && isInsideAgentTerminal(event.target)) return` を消す                                                                                            | `useQuickOpen.test.ts`      | `ターミナルの中の Ctrl`  | 落ちた（1 件） |
| K2  | `useQuickOpen.ts` の `if (event.ctrlKey && !event.metaKey && isInsideAgentTerminal(event.target)) return` を `if ((event.ctrlKey \|\| event.metaKey) && isInsideAgentTerminal(event.target)) return` にする | `useQuickOpen.test.ts`      | `ターミナルの中でも Cmd` | 落ちた（1 件） |
| K3  | `agentTerminalKeys.ts` の `if (isMac) return 'terminal'` を消す                                                                                                                                             | `agentTerminalKeys.test.ts` | `macOS の Ctrl`          | 落ちた（1 件） |
| K4  | `agentTerminalKeys.ts` の `return hasSelection ? 'copy' : 'ignore'` を `return 'copy'` にする                                                                                                               | `agentTerminalKeys.test.ts` | `選択なし`               | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/renderer
```

---

### Task 16: renderer: ターミナルの controller（xterm を持つ部品）

**Files:**

- Create: `src/renderer/src/lib/agentTerminalController.ts`、`src/renderer/src/lib/xtermFactory.ts`、`src/renderer/src/__tests__/makeFakeAgentTerminal.ts`、`src/renderer/src/lib/__tests__/agentTerminalController.test.ts`

**Interfaces:**

- Consumes: `AgentSessionData`・`AgentSessionExit`・`AGENT_TERMINAL_*`（Task 2）、`isExternalHttpUrl`（Task 2）、`ViewportBufferLike`・`ViewportLine`・`readViewportLines`（Task 13）、`classifyAgentTerminalKey`・`isMacPlatform`（Task 15）、`agentTerminalApi`（Task 12）
- Produces: `interface TerminalLike`・`FitAddonLike`・`AgentTerminalApiLike`・`ClipboardLike`・`AgentTerminalControllerDeps { terminal; fitAddon; api; clipboard; isMac; createHost }`・`AgentTerminalSize { cols; rows }`、`interface AgentTerminalController { attach(container); detach(container); fit(): AgentTerminalSize; getSize(); prepareForStart(); setSession(sessionId | null); getSessionId(); readViewport(): ViewportLine[]; isBracketedPasteEnabled(); writeToSession(data); beginSending(); endSending(); onExit(listener): () => void; setFocusOutHandler(handler | null); focus() }`、`createAgentTerminalController(deps): AgentTerminalController`、`getAgentTerminalController(): AgentTerminalController`（`xtermFactory.ts`。実物の xterm で文書ごとに 1 つ作る）。テストの補助 `makeFakeTerminal()`・`makeFakeAgentApi()`・`makeFakeClipboard(text?)`・`makeFakeFitAddon()`・`makeFakeController(): FakeController`（hook・部品のテストが使う controller の偽物。`viewport`・`bracketed`・`sessionId`・`writes`・`emitExit` を持つ）
- 注: 確認の結果 10（StrictMode で 1 回だけ open）・設計書「データフロー」6（起動の直前に `reset`）・13（送信中の打鍵を溜めて後で送る）・「セキュリティ」（DA1 などの xterm の応答は `onData` から pty へ返す。OSC 52 は扱わない〈clipboard のアドオンを入れない〉。タイトル〈`onTitleChange`〉とベルは購読しない。OSC 8 のリンクは `linkHandler` で http・https だけを開く）。sessionId が決まる前に届いた出力は、起動の準備の後だけ溜め（上限 1,000,000 文字）、決まったら書く。`fit` は取り付けて表示しているときだけ行い、大きさが変わったときだけ main へ送る。jsdom では xterm の `open()` が動かない（`matchMedia`・canvas が無い）ため、`xtermFactory.ts` は単体テストで読まない（Task 23 の `useAppState.test.ts` は差し替える）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/__tests__/makeFakeAgentTerminal.ts`（新規。テストの補助）:

```ts
import { vi } from 'vitest'
import type {
  AgentTerminalApiLike,
  AgentTerminalController,
  ClipboardLike,
  FitAddonLike,
  TerminalLike
} from '../lib/agentTerminalController'
import type { ViewportLine } from '../lib/agentViewport'
import type { AgentSessionData, AgentSessionExit } from '@shared/types'

// xterm の偽物。open・write・reset などを記録し、onData・キーのハンドラをテストから起こせる
export interface FakeTerminal extends TerminalLike {
  cols: number
  rows: number
  modes: { bracketedPasteMode: boolean }
  written: string[]
  open: ReturnType<typeof vi.fn<TerminalLike['open']>>
  reset: ReturnType<typeof vi.fn<TerminalLike['reset']>>
  paste: ReturnType<typeof vi.fn<TerminalLike['paste']>>
  focus: ReturnType<typeof vi.fn<TerminalLike['focus']>>
  selection: string
  typeKey(data: string): void
  pressKey(init: KeyboardEventInit & { type?: string }): boolean
}

export function makeFakeTerminal(): FakeTerminal {
  let dataListener: (data: string) => void = () => undefined
  let keyHandler: (event: KeyboardEvent) => boolean = () => true
  const fake: FakeTerminal = {
    cols: 80,
    rows: 24,
    modes: { bracketedPasteMode: true },
    buffer: { active: { viewportY: 0, getLine: () => undefined } },
    written: [],
    selection: '',
    open: vi.fn<TerminalLike['open']>(),
    write: (data) => {
      fake.written.push(data)
    },
    reset: vi.fn<TerminalLike['reset']>(),
    focus: vi.fn<TerminalLike['focus']>(),
    onData: (listener) => {
      dataListener = listener
      return { dispose: () => undefined }
    },
    attachCustomKeyEventHandler: (handler) => {
      keyHandler = handler
    },
    hasSelection: () => fake.selection !== '',
    getSelection: () => fake.selection,
    paste: vi.fn<TerminalLike['paste']>(),
    typeKey: (data) => dataListener(data),
    pressKey: ({ type = 'keydown', ...init }) => keyHandler(new KeyboardEvent(type, init))
  }
  return fake
}

// IPC の偽物。出力・終了をテストから起こせる
export interface FakeAgentApi extends AgentTerminalApiLike {
  writeAgentSession: ReturnType<typeof vi.fn<AgentTerminalApiLike['writeAgentSession']>>
  resizeAgentSession: ReturnType<typeof vi.fn<AgentTerminalApiLike['resizeAgentSession']>>
  emitData(payload: AgentSessionData): void
  emitExit(payload: AgentSessionExit): void
}

export function makeFakeAgentApi(): FakeAgentApi {
  const dataListeners = new Set<(payload: AgentSessionData) => void>()
  const exitListeners = new Set<(payload: AgentSessionExit) => void>()
  return {
    writeAgentSession: vi.fn<AgentTerminalApiLike['writeAgentSession']>(),
    resizeAgentSession: vi.fn<AgentTerminalApiLike['resizeAgentSession']>(),
    onAgentData: (listener) => {
      dataListeners.add(listener)
      return () => dataListeners.delete(listener)
    },
    onAgentExit: (listener) => {
      exitListeners.add(listener)
      return () => exitListeners.delete(listener)
    },
    emitData: (payload) => dataListeners.forEach((listener) => listener(payload)),
    emitExit: (payload) => exitListeners.forEach((listener) => listener(payload))
  }
}

export function makeFakeClipboard(text = ''): ClipboardLike & {
  writeText: ReturnType<typeof vi.fn<ClipboardLike['writeText']>>
} {
  return {
    readText: vi.fn<ClipboardLike['readText']>(async () => text),
    writeText: vi.fn<ClipboardLike['writeText']>(async () => undefined)
  }
}

export const makeFakeFitAddon = (): FitAddonLike & {
  fit: ReturnType<typeof vi.fn<FitAddonLike['fit']>>
} => ({
  fit: vi.fn<FitAddonLike['fit']>()
})

/** hook・部品のテスト用の、controller そのものの偽物(画面の行は viewport で差し替える) */
export interface FakeController extends AgentTerminalController {
  viewport: ViewportLine[]
  bracketed: boolean
  sessionId: string | null
  writes: string[]
  exitListeners: Set<(exit: AgentSessionExit) => void>
  attach: ReturnType<typeof vi.fn<AgentTerminalController['attach']>>
  detach: ReturnType<typeof vi.fn<AgentTerminalController['detach']>>
  fit: ReturnType<typeof vi.fn<AgentTerminalController['fit']>>
  prepareForStart: ReturnType<typeof vi.fn<AgentTerminalController['prepareForStart']>>
  beginSending: ReturnType<typeof vi.fn<AgentTerminalController['beginSending']>>
  endSending: ReturnType<typeof vi.fn<AgentTerminalController['endSending']>>
  setFocusOutHandler: ReturnType<typeof vi.fn<AgentTerminalController['setFocusOutHandler']>>
  focus: ReturnType<typeof vi.fn<AgentTerminalController['focus']>>
  emitExit(exit: AgentSessionExit): void
}

export function makeFakeController(): FakeController {
  const fake: FakeController = {
    viewport: [],
    bracketed: true,
    sessionId: null,
    writes: [],
    exitListeners: new Set(),
    attach: vi.fn<AgentTerminalController['attach']>(),
    detach: vi.fn<AgentTerminalController['detach']>(),
    fit: vi.fn<AgentTerminalController['fit']>(() => ({ cols: 80, rows: 24 })),
    getSize: () => ({ cols: 80, rows: 24 }),
    prepareForStart: vi.fn<AgentTerminalController['prepareForStart']>(),
    setSession: (sessionId) => {
      fake.sessionId = sessionId
    },
    getSessionId: () => fake.sessionId,
    readViewport: () => fake.viewport,
    isBracketedPasteEnabled: () => fake.bracketed,
    writeToSession: (data) => {
      fake.writes.push(data)
    },
    beginSending: vi.fn<AgentTerminalController['beginSending']>(),
    endSending: vi.fn<AgentTerminalController['endSending']>(),
    onExit: (listener) => {
      fake.exitListeners.add(listener)
      return () => fake.exitListeners.delete(listener)
    },
    setFocusOutHandler: vi.fn<AgentTerminalController['setFocusOutHandler']>(),
    focus: vi.fn<AgentTerminalController['focus']>(),
    emitExit: (exit) => fake.exitListeners.forEach((listener) => listener(exit))
  }
  return fake
}
```

`src/renderer/src/lib/__tests__/agentTerminalController.test.ts`（新規）:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createAgentTerminalController } from '../agentTerminalController'
import type { AgentTerminalController } from '../agentTerminalController'
import {
  makeFakeAgentApi,
  makeFakeClipboard,
  makeFakeFitAddon,
  makeFakeTerminal
} from '../../__tests__/makeFakeAgentTerminal'
import type { FakeAgentApi, FakeTerminal } from '../../__tests__/makeFakeAgentTerminal'

let terminal: FakeTerminal
let api: FakeAgentApi
let fitAddon: ReturnType<typeof makeFakeFitAddon>
let clipboard: ReturnType<typeof makeFakeClipboard>
let controller: AgentTerminalController

function create(isMac = false): AgentTerminalController {
  return createAgentTerminalController({
    terminal,
    fitAddon,
    api,
    clipboard,
    isMac,
    createHost: () => document.createElement('div')
  })
}

beforeEach(() => {
  terminal = makeFakeTerminal()
  api = makeFakeAgentApi()
  fitAddon = makeFakeFitAddon()
  clipboard = makeFakeClipboard('pasted')
  controller = create()
})

describe('attach・detach', () => {
  it('初回だけ open し、取り付け直しても xterm を作り直さない(StrictMode の二重マウント)', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    controller.attach(container)
    controller.detach(container)
    controller.attach(container)
    expect(terminal.open).toHaveBeenCalledOnce()
    expect(container.childElementCount).toBe(1)
    container.remove()
  })

  it('別の container へ移せる', () => {
    const a = document.createElement('div')
    const b = document.createElement('div')
    controller.attach(a)
    controller.attach(b)
    expect(a.childElementCount).toBe(0)
    expect(b.childElementCount).toBe(1)
  })
})

describe('出力', () => {
  it('現在のセッションの出力だけを書き、ほかのセッションの出力は捨てる', () => {
    controller.setSession('s1')
    api.emitData({ sessionId: 's1', data: 'a' })
    api.emitData({ sessionId: 'old', data: 'b' })
    expect(terminal.written).toEqual(['a'])
  })

  it('起動の準備の後、sessionId が決まるまでに届いた出力を溜め、決まったら書く', () => {
    controller.prepareForStart()
    api.emitData({ sessionId: 's2', data: 'early' })
    api.emitData({ sessionId: 'other', data: 'x' })
    controller.setSession('s2')
    api.emitData({ sessionId: 's2', data: 'late' })
    expect(terminal.reset).toHaveBeenCalledOnce()
    expect(terminal.written).toEqual(['early', 'late'])
  })

  it('起動の準備をしていないときは、知らないセッションの出力を溜めない', () => {
    api.emitData({ sessionId: 's3', data: 'x' })
    controller.setSession('s3')
    expect(terminal.written).toEqual([])
  })
})

describe('入力', () => {
  it('セッションがあれば利用者の入力を送り、無ければ送らない', () => {
    terminal.typeKey('x')
    controller.setSession('s1')
    terminal.typeKey('y')
    expect(api.writeAgentSession.mock.calls).toEqual([['s1', 'y']])
  })

  it('送信中の入力は溜め、終わったら順に送る。送信の手順の書き込みは溜めない', () => {
    controller.setSession('s1')
    controller.beginSending()
    terminal.typeKey('a')
    controller.writeToSession('PASTE')
    terminal.typeKey('b')
    expect(api.writeAgentSession.mock.calls).toEqual([['s1', 'PASTE']])
    controller.endSending()
    expect(api.writeAgentSession.mock.calls).toEqual([
      ['s1', 'PASTE'],
      ['s1', 'a'],
      ['s1', 'b']
    ])
  })
})

describe('fit', () => {
  it('取り付けている間は fit し、大きさが変わったときだけ main へ送る', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    controller.attach(container)
    controller.setSession('s1')
    terminal.cols = 120
    terminal.rows = 40
    expect(controller.fit()).toEqual({ cols: 120, rows: 40 })
    controller.fit()
    expect(fitAddon.fit).toHaveBeenCalledTimes(2)
    expect(api.resizeAgentSession.mock.calls).toEqual([['s1', 120, 40]])
    container.remove()
  })

  it('取り付けていないときは fit しない', () => {
    controller.fit()
    expect(fitAddon.fit).not.toHaveBeenCalled()
  })

  it('fit が投げても前の大きさを返す', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    controller.attach(container)
    fitAddon.fit.mockImplementationOnce(() => {
      throw new Error('no dimensions')
    })
    expect(controller.fit()).toEqual({ cols: 80, rows: 24 })
    container.remove()
  })
})

describe('キー', () => {
  it('F6 は端末へ送らず、抜け先へフォーカスを移す', () => {
    let moved = 0
    controller.setFocusOutHandler(() => {
      moved += 1
    })
    expect(terminal.pressKey({ key: 'F6' })).toBe(false)
    expect(moved).toBe(1)
  })

  it('Windows・Linux の Ctrl+Shift+C は選択範囲をクリップボードへ書き、端末へ送らない', () => {
    terminal.selection = 'sel'
    expect(terminal.pressKey({ key: 'C', ctrlKey: true, shiftKey: true })).toBe(false)
    expect(clipboard.writeText).toHaveBeenCalledWith('sel')
  })

  it('Windows・Linux の Ctrl+Shift+V はクリップボードを xterm の貼り付けで入れる', async () => {
    expect(terminal.pressKey({ key: 'V', ctrlKey: true, shiftKey: true })).toBe(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(terminal.paste).toHaveBeenCalledWith('pasted')
  })

  it('Ctrl+C は端末へ送る', () => {
    expect(terminal.pressKey({ key: 'c', ctrlKey: true })).toBe(true)
  })
})

describe('読み取り・終了', () => {
  it('bracketed paste の状態と表示中の画面を読む', () => {
    terminal.modes.bracketedPasteMode = false
    expect(controller.isBracketedPasteEnabled()).toBe(false)
    expect(controller.readViewport()).toHaveLength(24)
  })

  it('終了を購読者へ渡し、解除の後は渡さない', () => {
    const received: string[] = []
    const dispose = controller.onExit((exit) => received.push(exit.sessionId))
    api.emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' })
    dispose()
    api.emitExit({ sessionId: 's2', exitCode: 0, signal: null, reason: 'exited' })
    expect(received).toEqual(['s1'])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/agentTerminalController.test.ts
```

Expected: FAIL（`../agentTerminalController` が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/agentTerminalController.ts`（新規）:

```ts
import type { AgentSessionData, AgentSessionExit } from '@shared/types'
import {
  AGENT_TERMINAL_MAX_COLS,
  AGENT_TERMINAL_MAX_ROWS,
  AGENT_TERMINAL_MIN_COLS,
  AGENT_TERMINAL_MIN_ROWS
} from '@shared/types'
import type { ViewportBufferLike, ViewportLine } from './agentViewport'
import { readViewportLines } from './agentViewport'
import { classifyAgentTerminalKey } from './agentTerminalKeys'

// xterm の Terminal とアドオン・IPC の購読を持つ、React の外の部品(文書ごとに 1 つ)。StrictMode の二重マウントやパネルの開閉で
// xterm を作り直さない(確認の結果 10)。表示の要素への取り付け・取り外し、fit、出力の書き込み、終了の購読、表示中の画面の読み取り、
// 送信中の利用者のキー入力の保留と再送を受け持つ。xterm を直接触るのはこのモジュールと xtermFactory だけ

/** xterm の Terminal のうち、この部品が使うもの(テストでは偽物を渡す。パターン 128) */
export interface TerminalLike {
  readonly cols: number
  readonly rows: number
  readonly modes: { readonly bracketedPasteMode: boolean }
  readonly buffer: { readonly active: ViewportBufferLike }
  open(parent: HTMLElement): void
  write(data: string): void
  reset(): void
  focus(): void
  onData(listener: (data: string) => void): { dispose(): void }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void
  hasSelection(): boolean
  getSelection(): string
  paste(data: string): void
}

export interface FitAddonLike {
  fit(): void
}

export interface AgentTerminalApiLike {
  writeAgentSession(sessionId: string, data: string): void
  resizeAgentSession(sessionId: string, cols: number, rows: number): void
  onAgentData(listener: (payload: AgentSessionData) => void): () => void
  onAgentExit(listener: (payload: AgentSessionExit) => void): () => void
}

export interface ClipboardLike {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
}

export interface AgentTerminalControllerDeps {
  terminal: TerminalLike
  fitAddon: FitAddonLike
  api: AgentTerminalApiLike
  clipboard: ClipboardLike
  isMac: boolean
  createHost: () => HTMLElement
}

export interface AgentTerminalSize {
  cols: number
  rows: number
}

export interface AgentTerminalController {
  /** 表示の要素に xterm を取り付ける(初回だけ open する) */
  attach(container: HTMLElement): void
  /** container から取り外す(xterm は破棄しない) */
  detach(container: HTMLElement): void
  /** 表示の大きさに合わせ、セッションがあれば変わった桁数・行数を main へ送る */
  fit(): AgentTerminalSize
  getSize(): AgentTerminalSize
  /** 起動の直前に呼ぶ。前のセッションの出力を消し、sessionId が決まるまでに届いた出力を溜める */
  prepareForStart(): void
  /** 出力と入力の対象のセッション。null で切り離す(終了・起動の失敗) */
  setSession(sessionId: string | null): void
  getSessionId(): string | null
  readViewport(): ViewportLine[]
  isBracketedPasteEnabled(): boolean
  /** 送信の手順の書き込み(利用者のキー入力の保留とは別に、直接 pty へ送る) */
  writeToSession(data: string): void
  /** 送信の手順の間、利用者のキー入力を溜める。endSending で順に送る */
  beginSending(): void
  endSending(): void
  onExit(listener: (exit: AgentSessionExit) => void): () => void
  /** F6 でターミナルから抜けるときの移動先 */
  setFocusOutHandler(handler: (() => void) | null): void
  focus(): void
}

/** sessionId が決まるまでに届いた出力を溜める上限(UTF-16 の単位) */
const MAX_PENDING_OUTPUT = 1_000_000

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export function createAgentTerminalController({
  terminal,
  fitAddon,
  api,
  clipboard,
  isMac,
  createHost
}: AgentTerminalControllerDeps): AgentTerminalController {
  let host: HTMLElement | null = null
  let sessionId: string | null = null
  let expectingStart = false
  let pendingOutput = new Map<string, string[]>()
  let pendingLength = 0
  let sending = false
  let heldInput: string[] = []
  let lastSentSize: AgentTerminalSize | null = null
  let focusOutHandler: (() => void) | null = null
  const exitListeners = new Set<(exit: AgentSessionExit) => void>()

  const sizeOf = (): AgentTerminalSize => ({
    cols: clamp(terminal.cols, AGENT_TERMINAL_MIN_COLS, AGENT_TERMINAL_MAX_COLS),
    rows: clamp(terminal.rows, AGENT_TERMINAL_MIN_ROWS, AGENT_TERMINAL_MAX_ROWS)
  })

  api.onAgentData(({ sessionId: from, data }) => {
    if (from === sessionId) {
      terminal.write(data)
      return
    }
    if (!expectingStart || pendingLength + data.length > MAX_PENDING_OUTPUT) return
    const list = pendingOutput.get(from) ?? []
    list.push(data)
    pendingOutput.set(from, list)
    pendingLength += data.length
  })
  api.onAgentExit((exit) => {
    for (const listener of [...exitListeners]) listener(exit)
  })

  terminal.onData((data) => {
    if (sessionId === null) return
    if (sending) heldInput.push(data)
    else api.writeAgentSession(sessionId, data)
  })

  terminal.attachCustomKeyEventHandler((event) => {
    const action = classifyAgentTerminalKey(event, isMac, terminal.hasSelection())
    if (action === 'terminal') return true
    if (action === 'focus-out') {
      event.preventDefault()
      focusOutHandler?.()
    } else if (action === 'copy') {
      event.preventDefault()
      void clipboard.writeText(terminal.getSelection()).catch(() => undefined)
    } else if (action === 'paste') {
      event.preventDefault()
      void clipboard
        .readText()
        .then((text) => terminal.paste(text))
        .catch(() => undefined)
    }
    return false
  })

  const sendResizeIfChanged = (): void => {
    if (sessionId === null) return
    const size = sizeOf()
    if (lastSentSize !== null && lastSentSize.cols === size.cols && lastSentSize.rows === size.rows)
      return
    lastSentSize = size
    api.resizeAgentSession(sessionId, size.cols, size.rows)
  }

  return {
    attach(container) {
      if (host === null) {
        host = createHost()
        container.appendChild(host)
        terminal.open(host)
        return
      }
      if (host.parentElement !== container) container.appendChild(host)
    },
    detach(container) {
      if (host !== null && host.parentElement === container) container.removeChild(host)
    },
    fit() {
      // 表示されていない(display: none・取り外した)ときの fit は大きさを測れず、例外や 0 になりうる
      if (host !== null && host.isConnected) {
        try {
          fitAddon.fit()
        } catch {
          // 測れないときは前の大きさのまま
        }
      }
      sendResizeIfChanged()
      return sizeOf()
    },
    getSize: sizeOf,
    prepareForStart() {
      terminal.reset()
      sessionId = null
      expectingStart = true
      pendingOutput = new Map()
      pendingLength = 0
      lastSentSize = null
      heldInput = []
    },
    setSession(next) {
      sessionId = next
      if (next !== null) {
        for (const data of pendingOutput.get(next) ?? []) terminal.write(data)
        // 起動の依頼に含めた大きさを送った大きさとして控える
        lastSentSize = sizeOf()
      }
      expectingStart = false
      pendingOutput = new Map()
      pendingLength = 0
    },
    getSessionId: () => sessionId,
    readViewport: () => readViewportLines(terminal.buffer.active, terminal.rows),
    isBracketedPasteEnabled: () => terminal.modes.bracketedPasteMode,
    writeToSession(data) {
      if (sessionId !== null) api.writeAgentSession(sessionId, data)
    },
    beginSending() {
      sending = true
    },
    endSending() {
      sending = false
      const held = heldInput
      heldInput = []
      if (sessionId === null) return
      for (const data of held) api.writeAgentSession(sessionId, data)
    },
    onExit(listener) {
      exitListeners.add(listener)
      return () => {
        exitListeners.delete(listener)
      }
    },
    setFocusOutHandler(handler) {
      focusOutHandler = handler
    },
    focus() {
      terminal.focus()
    }
  }
}
```

`src/renderer/src/lib/xtermFactory.ts`（新規。実物の xterm・fit のアドオン・CSS を読む。単体テストは無く、実機の AGT で確かめる）:

```ts
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import * as agentTerminalApi from './agentTerminalApi'
import { isExternalHttpUrl } from '@shared/externalUrl'
import { createAgentTerminalController } from './agentTerminalController'
import type { AgentTerminalController } from './agentTerminalController'
import { isMacPlatform } from './platform'

// 実物の xterm で controller を作る(文書ごとに 1 つ)。jsdom では xterm を開けない(matchMedia・canvas が無い)ため、
// テストはこのモジュールを読まずに createAgentTerminalController へ偽物を渡す

let instance: AgentTerminalController | null = null

export function getAgentTerminalController(): AgentTerminalController {
  if (instance !== null) return instance
  const terminal = new Terminal({
    cursorBlink: false,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 13,
    scrollback: 5000,
    theme: { background: '#1e1e1e' },
    // OSC 8 のリンクは、http・https だけを既定のブラウザで開く(main でもスキームを確かめる)
    linkHandler: {
      activate: (_event, uri) => {
        if (isExternalHttpUrl(uri)) void agentTerminalApi.openExternalLink(uri)
      }
    }
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  instance = createAgentTerminalController({
    terminal,
    fitAddon,
    api: agentTerminalApi,
    clipboard: navigator.clipboard,
    isMac: isMacPlatform(),
    createHost: () => {
      const host = document.createElement('div')
      host.className = 'agent-terminal-view__host'
      return host
    }
  })
  return instance
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/agentTerminalController.test.ts
npm run typecheck
npx eslint src/renderer/src/lib/agentTerminalController.ts src/renderer/src/lib/xtermFactory.ts src/renderer/src/__tests__/makeFakeAgentTerminal.ts src/renderer/src/lib/__tests__/agentTerminalController.test.ts
npx prettier --check src/renderer/src/lib/agentTerminalController.ts src/renderer/src/lib/xtermFactory.ts src/renderer/src/__tests__/makeFakeAgentTerminal.ts src/renderer/src/lib/__tests__/agentTerminalController.test.ts
```

Expected: PASS（16 件）。typecheck で、実物の xterm の `Terminal`・`FitAddon` が `TerminalLike`・`FitAddonLike` に代入できること（`xtermFactory.ts`）が確かめられる

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                                                         | テストのファイル                  | `-t`                                | 確認           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------- | -------------- |
| R1  | `agentTerminalController.ts` の `if (host === null) { ⏎ host = createHost()` を `if (true) { ⏎ host = createHost()` にする                                                                   | `agentTerminalController.test.ts` | `初回だけ open し`                  | 落ちた（1 件） |
| R2  | `agentTerminalController.ts` の `if (sending) heldInput.push(data)` を `if (false) heldInput.push(data)` にする                                                                              | `agentTerminalController.test.ts` | `送信中の入力は溜め`                | 落ちた（1 件） |
| R3  | `agentTerminalController.ts` の `if (!expectingStart \|\| pendingLength + data.length > MAX_PENDING_OUTPUT) return` を `if (pendingLength + data.length > MAX_PENDING_OUTPUT) return` にする | `agentTerminalController.test.ts` | `起動の準備をしていないときは`      | 落ちた（1 件） |
| R4  | `agentTerminalController.ts` の `if (lastSentSize !== null && lastSentSize.cols === size.cols && lastSentSize.rows === size.rows) ⏎ return` を消す                                           | `agentTerminalController.test.ts` | `大きさが変わったときだけ`          | 落ちた（1 件） |
| R5  | `agentTerminalController.ts` の `if (host !== null && host.isConnected) {` を `if (true) {` にする                                                                                           | `agentTerminalController.test.ts` | `取り付けていないときは fit しない` | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/renderer
```

---

### Task 17: renderer: 保存の照合の確認と、外部変更の反映のための `useFileSystem` の口

**Files:**

- Create: `src/renderer/src/__tests__/routeCheckedWrites.ts`、`src/renderer/src/hooks/__tests__/useFileEditing.saveConflict.test.ts`、`src/renderer/src/hooks/__tests__/useFileSystem.externalChange.test.ts`
- Modify: `src/renderer/src/hooks/useFileEditing.ts`（`Options` に `onSaveConflict`・確認の文言・`saveFile` の書き込みを照合付きに。`:155-159`・`:513-518`）、`src/renderer/src/hooks/useFileSystem.ts`（`FileSystemState` に 3 つの口。`:126-127`・`:822-860`）、既存のテスト 4 ファイル（`useFileEditing.test.ts`・`useFileSystem.test.ts`・`useFileSystem.conflict.test.ts`・`useFileSystem.folderOpen.test.ts`。top-level の `beforeEach` の最後に 1 行。差異 20）

**Interfaces:**

- Consumes: `ExternalChangeKind`（Task 2）、`fileSystemApi.writeFileContentChecked(path, content, baseContent: string | null): Promise<WriteFileCheckedResult>`（Task 12）
- Produces: `SAVE_CONFLICT_MODIFIED_MESSAGE`・`SAVE_CONFLICT_DELETED_MESSAGE`、`Options.onSaveConflict?: (path: string, reason: ExternalChangeKind) => void`（`useFileSystem(options)` へもそのまま渡る）、`FileSystemState.getOpenFileSnapshot(path): OpenFile | null`・`waitForPendingSave(path): Promise<void>`・`replaceCleanTabWithDisk(path, expected: { content; savedContent }, disk: string | null): boolean`。テストの補助 `routeCheckedWritesToWriteFileContent(): void`
- 注: 差異 9・10。照合の基準は、待っている間に再読込されていればその後の `savedContent`（同じタブなら最新の同期ミラー、違えば保存を始めた時点）。`conflict` のとき `onConfirm`（既定は `window.confirm`。CLAUDE.md のデフォルト引数の規則どおり `onConfirm = confirm`）。キャンセルなら書かず `savedContent` を変えず `onSaveConflict` を呼ぶ（`saveError` は出さない）。確認の間にタブが閉じられた・開き直された（世代が変わった）ら書かない。`replaceCleanTabWithDisk` は、控えから `savedContent` が変わった・未編集でない・その保存が実行中なら置き換えない（パターン 110）。置き換えたら保存の世代を進める（既存の `invalidateSaveStateOfTab`。`reloadOpenFile` と同じ）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/__tests__/routeCheckedWrites.ts`（新規。既存のテストの付け替えの補助）:

```ts
import { vi } from 'vitest'
import * as fileSystemApi from '../lib/fileSystemApi'

// 照合付きの保存(writeFileContentChecked)を、従来の writeFileContent のモックへ流す(vi.mock('../../lib/fileSystemApi') の
// テストで、top-level の beforeEach の最後に呼ぶ)。既存のテストは writeFileContent の呼び出し・待ち・失敗で保存を観測しているため、
// 照合は常に一致する(written)ものとして同じモックを通す。照合の不一致の振る舞いは useFileEditing.conflict.test.ts で確かめる
export function routeCheckedWritesToWriteFileContent(): void {
  vi.mocked(fileSystemApi.writeFileContentChecked).mockImplementation(async (path, content) => {
    await fileSystemApi.writeFileContent(path, content)
    return { kind: 'written' }
  })
}
```

既存の 4 ファイル（差分。import と、top-level の `beforeEach` の最後の 1 行）:

```diff
--- a/src/renderer/src/hooks/__tests__/useFileEditing.test.ts
+++ b/src/renderer/src/hooks/__tests__/useFileEditing.test.ts
@@ -5,6 +5,7 @@
 vi.mock('../../lib/fileSystemApi')

 import * as fileSystemApi from '../../lib/fileSystemApi'
+import { routeCheckedWritesToWriteFileContent } from '../../__tests__/routeCheckedWrites'
 import { useFileEditing } from '../useFileEditing'

 const mockWriteFileContent = vi.mocked(fileSystemApi.writeFileContent)
@@ -33,6 +34,7 @@

 beforeEach(() => {
   vi.clearAllMocks()
+  routeCheckedWritesToWriteFileContent()
 })

 describe('isDirty', () => {
```

```diff
--- a/src/renderer/src/hooks/__tests__/useFileSystem.test.ts
+++ b/src/renderer/src/hooks/__tests__/useFileSystem.test.ts
@@ -5,6 +5,7 @@
 vi.mock('../../lib/fileSystemApi')

 import * as fileSystemApi from '../../lib/fileSystemApi'
+import { routeCheckedWritesToWriteFileContent } from '../../__tests__/routeCheckedWrites'
 import { useFileSystem } from '../useFileSystem'

 const mockOpenFolder = vi.mocked(fileSystemApi.openFolder)
@@ -27,6 +28,7 @@

 beforeEach(() => {
   vi.clearAllMocks()
+  routeCheckedWritesToWriteFileContent()
 })

 describe('useFileSystem', () => {
```

```diff
--- a/src/renderer/src/hooks/__tests__/useFileSystem.conflict.test.ts
+++ b/src/renderer/src/hooks/__tests__/useFileSystem.conflict.test.ts
@@ -21,6 +21,7 @@
 })

 import * as fileSystemApi from '../../lib/fileSystemApi'
+import { routeCheckedWritesToWriteFileContent } from '../../__tests__/routeCheckedWrites'
 import { MAX_READ_RETRIES, useFileSystem } from '../useFileSystem'

 const mockOpenFolder = vi.mocked(fileSystemApi.openFolder)
@@ -39,6 +40,7 @@
 beforeEach(() => {
   vi.clearAllMocks()
   completionsCount = 0
+  routeCheckedWritesToWriteFileContent()
 })

 describe('useFileSystem 読み込みと保存の競合の再試行上限', () => {
```

```diff
--- a/src/renderer/src/hooks/__tests__/useFileSystem.folderOpen.test.ts
+++ b/src/renderer/src/hooks/__tests__/useFileSystem.folderOpen.test.ts
@@ -5,6 +5,7 @@
 vi.mock('../../lib/fileSystemApi')

 import * as fileSystemApi from '../../lib/fileSystemApi'
+import { routeCheckedWritesToWriteFileContent } from '../../__tests__/routeCheckedWrites'
 import { useFileSystem } from '../useFileSystem'

 // フォルダを開く経路のテスト。openFolder(OS のダイアログでフォルダを選ぶ)と applyOpenedFolder(選ばれたパスを
@@ -55,6 +56,7 @@
   vi.resetAllMocks()
   mockReadDirectory.mockImplementation((path: string) => Promise.resolve(treeFor(path)))
   mockReadFileContent.mockResolvedValue('const x = 1')
+  routeCheckedWritesToWriteFileContent()
 })

 describe('openFolder', () => {
```

`src/renderer/src/hooks/__tests__/useFileEditing.saveConflict.test.ts`（新規）:

```ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Dispatch, SetStateAction } from 'react'
import type { OpenFile } from '../../types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import {
  SAVE_CONFLICT_DELETED_MESSAGE,
  SAVE_CONFLICT_MODIFIED_MESSAGE,
  useFileEditing
} from '../useFileEditing'

const mockWriteChecked = vi.mocked(fileSystemApi.writeFileContentChecked)

const dirty: OpenFile = {
  path: '/project/a.ts',
  name: 'a.ts',
  content: 'mine',
  savedContent: 'base',
  language: 'typescript'
}

// setOpenFile の更新関数を current に当てる最小の入れ物(saveFile は関数形の更新を使う)
function holder(initial: OpenFile): {
  current: OpenFile | null
  set: Dispatch<SetStateAction<OpenFile | null>>
} {
  const box = {
    current: initial as OpenFile | null,
    set: ((next: SetStateAction<OpenFile | null>) => {
      box.current = typeof next === 'function' ? next(box.current) : next
    }) as Dispatch<SetStateAction<OpenFile | null>>
  }
  return box
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('saveFile の保存の直前の照合', () => {
  it('タブが最後にディスクと一致した内容(savedContent)を基準に照合して書き込む', async () => {
    mockWriteChecked.mockResolvedValueOnce({ kind: 'written' })
    const file = holder(dirty)
    const { result } = renderHook(() =>
      useFileEditing(file.current, file.set, { getOpenFile: () => file.current })
    )
    await act(async () => {
      await result.current.saveFile()
    })
    expect(mockWriteChecked).toHaveBeenCalledExactlyOnceWith('/project/a.ts', 'mine', 'base')
    expect(file.current?.savedContent).toBe('mine')
  })

  it.each([
    ['modified', SAVE_CONFLICT_MODIFIED_MESSAGE],
    ['deleted', SAVE_CONFLICT_DELETED_MESSAGE]
  ] as const)(
    '%s のとき確認を出し、OK なら照合せずに書き込んで savedContent を更新する',
    async (reason, message) => {
      mockWriteChecked
        .mockResolvedValueOnce({ kind: 'conflict', reason })
        .mockResolvedValueOnce({ kind: 'written' })
      const onConfirm = vi.fn(() => true)
      const onSaveConflict = vi.fn()
      const file = holder(dirty)
      const { result } = renderHook(() =>
        useFileEditing(file.current, file.set, {
          getOpenFile: () => file.current,
          onConfirm,
          onSaveConflict
        })
      )
      await act(async () => {
        await result.current.saveFile()
      })
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(message)
      expect(mockWriteChecked).toHaveBeenNthCalledWith(2, '/project/a.ts', 'mine', null)
      expect(file.current?.savedContent).toBe('mine')
      expect(onSaveConflict).not.toHaveBeenCalled()
    }
  )

  it('キャンセルなら書き込まず、savedContent を変えず、外部変更の印を付ける', async () => {
    mockWriteChecked.mockResolvedValueOnce({ kind: 'conflict', reason: 'modified' })
    const onSaveConflict = vi.fn()
    const file = holder(dirty)
    const { result } = renderHook(() =>
      useFileEditing(file.current, file.set, {
        getOpenFile: () => file.current,
        onConfirm: () => false,
        onSaveConflict
      })
    )
    await act(async () => {
      await result.current.saveFile()
    })
    expect(mockWriteChecked).toHaveBeenCalledTimes(1)
    expect(file.current?.savedContent).toBe('base')
    expect(onSaveConflict).toHaveBeenCalledExactlyOnceWith('/project/a.ts', 'modified')
    expect(result.current.saveError).toBeNull()
  })

  it('確認の間にタブが開き直されたら(世代が変わったら)書き込まない', async () => {
    mockWriteChecked.mockResolvedValueOnce({ kind: 'conflict', reason: 'modified' })
    const file = holder(dirty)
    const ref: { reset: (path: string) => void } = { reset: () => undefined }
    const onConfirm = vi.fn(() => {
      ref.reset('/project/a.ts')
      return true
    })
    const { result } = renderHook(() =>
      useFileEditing(file.current, file.set, { getOpenFile: () => file.current, onConfirm })
    )
    ref.reset = result.current.resetForFileChange
    await act(async () => {
      await result.current.saveFile()
    })
    expect(mockWriteChecked).toHaveBeenCalledTimes(1)
    expect(file.current?.savedContent).toBe('base')
  })
})
```

`src/renderer/src/hooks/__tests__/useFileSystem.externalChange.test.ts`（新規）:

```ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileNode } from '../../types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import { routeCheckedWritesToWriteFileContent } from '../../__tests__/routeCheckedWrites'
import { useFileSystem } from '../useFileSystem'

const mockRead = vi.mocked(fileSystemApi.readFileContent)
const mockWrite = vi.mocked(fileSystemApi.writeFileContent)

const nodeA: FileNode = { name: 'a.ts', path: '/project/a.ts', type: 'file' }
const nodeB: FileNode = { name: 'b.ts', path: '/project/b.ts', type: 'file' }

beforeEach(() => {
  vi.resetAllMocks()
  routeCheckedWritesToWriteFileContent()
})

async function openFiles(
  ...nodes: FileNode[]
): Promise<ReturnType<typeof renderHook<ReturnType<typeof useFileSystem>, unknown>>> {
  const hook = renderHook(() => useFileSystem())
  for (const node of nodes) {
    mockRead.mockResolvedValueOnce(`content of ${node.name}`)
    await act(async () => {
      await hook.result.current.selectFile(node)
    })
  }
  return hook
}

describe('useFileSystem: 外部変更の反映', () => {
  it('getOpenFileSnapshot は開いているタブの最新の状態を返し、開いていなければ null', async () => {
    const { result } = await openFiles(nodeA)
    act(() => result.current.updateFileContent('typed'))
    expect(result.current.getOpenFileSnapshot('/project/a.ts')).toMatchObject({
      content: 'typed',
      savedContent: 'content of a.ts'
    })
    expect(result.current.getOpenFileSnapshot('/project/none.ts')).toBeNull()
  })

  it('replaceCleanTabWithDisk は未編集で控えと同じタブをディスクの内容にする', async () => {
    const { result } = await openFiles(nodeA)
    let replaced = false
    act(() => {
      replaced = result.current.replaceCleanTabWithDisk(
        '/project/a.ts',
        { content: 'content of a.ts', savedContent: 'content of a.ts' },
        'from agent'
      )
    })
    expect(replaced).toBe(true)
    expect(result.current.openFile).toMatchObject({
      content: 'from agent',
      savedContent: 'from agent'
    })
  })

  it('読む間に打鍵されていたら(控えと違えば)置き換えない', async () => {
    const { result } = await openFiles(nodeA)
    act(() => result.current.updateFileContent('typed'))
    let replaced = true
    act(() => {
      replaced = result.current.replaceCleanTabWithDisk(
        '/project/a.ts',
        { content: 'content of a.ts', savedContent: 'content of a.ts' },
        'from agent'
      )
    })
    expect(replaced).toBe(false)
    expect(result.current.openFile?.content).toBe('typed')
  })

  it('disk が null(削除)なら未編集のタブを閉じる', async () => {
    const { result } = await openFiles(nodeA, nodeB)
    act(() => {
      result.current.replaceCleanTabWithDisk(
        '/project/a.ts',
        { content: 'content of a.ts', savedContent: 'content of a.ts' },
        null
      )
    })
    expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/b.ts'])
  })

  it('保存の実行中は、未編集に戻っていても置き換えず、waitForPendingSave は保存の完了まで待つ', async () => {
    const { result } = await openFiles(nodeA)
    act(() => result.current.updateFileContent('edited'))
    let finishWrite: () => void = () => undefined
    mockWrite.mockImplementationOnce(() => new Promise<void>((resolve) => (finishWrite = resolve)))
    let saving: Promise<void> = Promise.resolve()
    act(() => {
      saving = result.current.saveFile()
    })
    // 書き込みの途中で編集を元に戻した(タブは未編集に見えるが、保存は 'edited' を書いている)
    act(() => result.current.updateFileContent('content of a.ts'))
    let waited = false
    const waiting = result.current.waitForPendingSave('/project/a.ts').then(() => {
      waited = true
    })
    let replaced = true
    act(() => {
      replaced = result.current.replaceCleanTabWithDisk(
        '/project/a.ts',
        { content: 'content of a.ts', savedContent: 'content of a.ts' },
        'from agent'
      )
    })
    expect(replaced).toBe(false)
    await Promise.resolve()
    expect(waited).toBe(false)
    await act(async () => {
      finishWrite()
      await saving
      await waiting
    })
    expect(waited).toBe(true)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/renderer/src/hooks/__tests__/useFileEditing.test.ts src/renderer/src/hooks/__tests__/useFileEditing.saveConflict.test.ts src/renderer/src/hooks/__tests__/useFileSystem.test.ts src/renderer/src/hooks/__tests__/useFileSystem.conflict.test.ts src/renderer/src/hooks/__tests__/useFileSystem.folderOpen.test.ts src/renderer/src/hooks/__tests__/useFileSystem.externalChange.test.ts 2>&1 | grep -E "Test Files|Tests "
```

Expected: FAIL（`saveConflict`・`externalChange` の新しい 10 件。既存の 4 ファイルは、まだ `saveFile` が `writeFileContent` を直接呼ぶので通る）

- [ ] **Step 3: 実装する**

`src/renderer/src/hooks/useFileEditing.ts`（差分）:

```diff
--- a/src/renderer/src/hooks/useFileEditing.ts
+++ b/src/renderer/src/hooks/useFileEditing.ts
@@ -1,5 +1,6 @@
 import { useRef, useState } from 'react'
 import type { Dispatch, SetStateAction } from 'react'
+import type { ExternalChangeKind } from '@shared/types'
 import type { OpenFile } from '../types'
 import * as fileSystemApi from '../lib/fileSystemApi'
 import { isPathAtOrInside, isSamePath, replacePathPrefix, toComparablePath } from '../lib/pathUtils'
@@ -29,6 +30,12 @@

 export const DISCARD_CONFIRM_MESSAGE = '保存されていない変更があります。破棄して続行しますか？'

+// 保存の直前の照合で、ディスクが最後に読み込んだ内容から変わっていたときの確認(設計書「保存の直前の照合」)
+export const SAVE_CONFLICT_MODIFIED_MESSAGE =
+  'このファイルは、最後に読み込んだ後にディスク上で変更されています（エージェントなどによる変更）。上書きして保存すると、その変更は失われます。上書きして保存しますか？'
+export const SAVE_CONFLICT_DELETED_MESSAGE =
+  'このファイルは、ディスク上で削除されています。保存すると、もう一度作成されます。保存しますか？'
+
 export type ResetForFileChangeOptions = {
   /**
    * リネームの追随でパスが付け替わる場合に渡す。中止の通知は「どのパスの保存を
@@ -41,6 +48,8 @@

 export interface Options {
   onConfirm?: (message: string) => boolean
+  /** 保存の直前の照合で外部変更が見つかり、上書きの確認がキャンセルされたとき(タブに外部変更の印を付ける) */
+  onSaveConflict?: (path: string, reason: ExternalChangeKind) => void
 }

 /**
@@ -155,7 +164,7 @@
 export function useFileEditing(
   openFile: OpenFile | null,
   setOpenFile: Dispatch<SetStateAction<OpenFile | null>>,
-  { getOpenFile }: InternalOptions = {}
+  { getOpenFile, onConfirm = confirm, onSaveConflict }: InternalOptions = {}
 ): FileEditingState {
   // 保存中のファイルの path 集合を保持する。isSaving は単一の boolean ではなく
   // path の集合で判定することで、「file A の保存中に file B を保存しようとしたら
@@ -513,9 +522,25 @@
       // 待っている間に編集されていれば、その内容を書く。待たずに書けた場合は
       // openFile は同じなので、通常経路の挙動は変わらない
       const latest = readOpenFile()
-      const contentToWrite =
-        latest !== null && isSamePath(latest.path, path) ? latest.content : content
-      await fileSystemApi.writeFileContent(path, contentToWrite)
+      const isSameTab = latest !== null && isSamePath(latest.path, path)
+      const contentToWrite = isSameTab ? latest.content : content
+      // 照合の基準は、タブが最後にディスクと一致した内容(待っている間に再読込されていればその内容)
+      const baseContent = isSameTab ? latest.savedContent : target.savedContent
+      const result = await fileSystemApi.writeFileContentChecked(path, contentToWrite, baseContent)
+      if (result.kind === 'conflict') {
+        const message =
+          result.reason === 'deleted'
+            ? SAVE_CONFLICT_DELETED_MESSAGE
+            : SAVE_CONFLICT_MODIFIED_MESSAGE
+        if (!onConfirm(message)) {
+          // 保存しない(savedContent は変えない)。タブに外部変更の印を付けて、通知を出す
+          if (generation === getGeneration(path)) onSaveConflict?.(path, result.reason)
+          return
+        }
+        // 確認の間にタブが閉じられた・開き直された場合は書かない
+        if (generation !== getGeneration(path)) return
+        await fileSystemApi.writeFileContentChecked(path, contentToWrite, null)
+      }
       // 書き込みに使った時点の path/content/generation を捕捉しているため、
       // await 中にユーザーがさらに編集したり、この path 自身が閉じられる・
       // 同じ path で開き直される・リネームされるなどして無効化されたりしても、
```

`src/renderer/src/hooks/useFileSystem.ts`（差分）:

```diff
--- a/src/renderer/src/hooks/useFileSystem.ts
+++ b/src/renderer/src/hooks/useFileSystem.ts
@@ -124,6 +124,20 @@
   closeTabsAtOrInside: (absolutePath: string) => void
   /** そのパス自身か配下に未保存の編集があるタブがあるか */
   hasDirtyTabAtOrInside: (absolutePath: string) => boolean
+  /** 開いているタブの最新の状態(同期ミラーから読む)。開いていなければ null */
+  getOpenFileSnapshot: (path: string) => OpenFile | null
+  /** そのパスの保存(書き込み待ちを含む)が終わるまで待つ。無ければすぐ解決する */
+  waitForPendingSave: (path: string) => Promise<void>
+  /**
+   * 外部変更の反映(設計書「未編集のタブの自動の再読込」4・6)。タブが未編集で、読む前の控え(expected)から content・savedContent が
+   * 変わっていないときだけ、ディスクの内容に置き換える(disk が null なら閉じる)。保存の世代も進める。置き換えた・閉じたら true。
+   * 読む間に打鍵された・保存が始まったときは false(呼び出し側は印を付ける。パターン 110)
+   */
+  replaceCleanTabWithDisk: (
+    path: string,
+    expected: { content: string; savedContent: string },
+    disk: string | null
+  ) => boolean
 }

 // getOpenFile はここで常に自前の同期ミラーへ差し替える。Options（公開型）には
@@ -822,7 +836,40 @@
   const hasDirtyTabAtOrInside = (absolutePath: string): boolean =>
     openFilesMirrorRef.current.some(
       (f) => isPathAtOrInside(f.path, absolutePath) && f.content !== f.savedContent
+    )
+
+  const getOpenFileSnapshot = (path: string): OpenFile | null =>
+    findFile(openFilesMirrorRef.current, path)
+
+  const waitForPendingSave = async (path: string): Promise<void> => {
+    await (pendingSaveFor(path) ?? Promise.resolve())
+  }
+
+  const replaceCleanTabWithDisk = (
+    path: string,
+    expected: { content: string; savedContent: string },
+    disk: string | null
+  ): boolean => {
+    const current = findFile(openFilesMirrorRef.current, path)
+    if (
+      current === null ||
+      current.content !== expected.content ||
+      current.savedContent !== expected.savedContent ||
+      current.content !== current.savedContent ||
+      pendingSaveFor(path) !== null
+    ) {
+      return false
+    }
+    const activePath = activeFilePathMirrorRef.current
+    setOpenFilesAndFixActive((prev) =>
+      prev.flatMap((f) => {
+        if (!isSamePath(f.path, path)) return [f]
+        return disk === null ? [] : [{ ...f, content: disk, savedContent: disk }]
+      })
     )
+    invalidateSaveStateOfTab(path, activePath)
+    return true
+  }

   return {
     folderPath,
@@ -855,6 +902,9 @@
     reloadOpenFiles,
     reloadOpenFile,
     closeTabsAtOrInside,
-    hasDirtyTabAtOrInside
+    hasDirtyTabAtOrInside,
+    getOpenFileSnapshot,
+    waitForPendingSave,
+    replaceCleanTabWithDisk
   }
 }
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/renderer/src/hooks src/renderer/src/components 2>&1 | grep -E "Test Files|Tests |FAIL"
npm run typecheck
npx eslint src/renderer/src/hooks/useFileEditing.ts src/renderer/src/hooks/useFileSystem.ts src/renderer/src/__tests__/routeCheckedWrites.ts src/renderer/src/hooks/__tests__/useFileEditing.test.ts src/renderer/src/hooks/__tests__/useFileEditing.saveConflict.test.ts src/renderer/src/hooks/__tests__/useFileSystem.test.ts src/renderer/src/hooks/__tests__/useFileSystem.conflict.test.ts src/renderer/src/hooks/__tests__/useFileSystem.folderOpen.test.ts src/renderer/src/hooks/__tests__/useFileSystem.externalChange.test.ts
npx prettier --check src/renderer/src/hooks/useFileEditing.ts src/renderer/src/hooks/useFileSystem.ts src/renderer/src/__tests__/routeCheckedWrites.ts src/renderer/src/hooks/__tests__/useFileEditing.test.ts src/renderer/src/hooks/__tests__/useFileEditing.saveConflict.test.ts src/renderer/src/hooks/__tests__/useFileSystem.test.ts src/renderer/src/hooks/__tests__/useFileSystem.conflict.test.ts src/renderer/src/hooks/__tests__/useFileSystem.folderOpen.test.ts src/renderer/src/hooks/__tests__/useFileSystem.externalChange.test.ts
```

Expected: hooks・components のテストがすべて PASS（`useFileEditing` 37 件・`useFileSystem` 134 件などの既存は件数が変わらない。新しい `saveConflict` 5 件・`externalChange` 5 件）。App の画面のテスト（`window.api.writeFileChecked` は setup の stub が `written` を返す）も通る

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                       | テストのファイル                       | `-t`                                 | 確認                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| F1  | `useFileEditing.ts` の `if (!onConfirm(message)) {` を `if (false) {` にする                                                                               | `useFileEditing.saveConflict.test.ts`  | `キャンセルなら書き込まず`           | 落ちた（1 件）                                                                                                        |
| F2  | `useFileEditing.ts` の `// 確認の間にタブが閉じられた・開き直された場合は書かない ⏎ if (generation !== getGeneration(path)) return` を消す                 | `useFileEditing.saveConflict.test.ts`  | `確認の間にタブが開き直されたら`     | 落ちた（1 件）                                                                                                        |
| F3  | `useFileEditing.ts` の `const baseContent = isSameTab ? latest.savedContent : target.savedContent` を `const baseContent = contentToWrite` にする          | `useFileEditing.saveConflict.test.ts`  | `タブが最後にディスクと一致した内容` | 落ちた（1 件）                                                                                                        |
| F4  | `useFileSystem.ts` の `current.content !== expected.content \|\|` を消す                                                                                   | `useFileSystem.externalChange.test.ts` | `読む間に打鍵されていたら`           | 等価な変異（呼び出し側が未編集の控えを渡すため、`savedContent` の照合と未編集の判定で同じ結果になる。記録として残す） |
| F5  | `useFileSystem.ts` の `current.content !== current.savedContent \|\| ⏎ pendingSaveFor(path) !== null` を `current.content !== current.savedContent` にする | `useFileSystem.externalChange.test.ts` | `保存の実行中は`                     | 落ちた（1 件）                                                                                                        |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/renderer
```

---

### Task 18: renderer: 外部変更の反映と通知

**Files:**

- Create: `src/renderer/src/hooks/useExternalChangeMarks.ts`、`src/renderer/src/hooks/useExternalFileChanges.ts`、`src/renderer/src/components/editor/ExternalChangeBanner.tsx`、`src/renderer/src/hooks/__tests__/useExternalChangeMarks.test.ts`、`src/renderer/src/hooks/__tests__/useExternalFileChanges.test.ts`、`src/renderer/src/components/editor/__tests__/ExternalChangeBanner.test.tsx`
- Modify: `src/renderer/src/assets/main.css`（共通の枠付きボタンの規則に `.external-change-banner__button` を足し、通知の規則を足す）

**Interfaces:**

- Consumes: `ExternalChangeKind`（Task 2）、`fileSystemApi.readFileContent`（既存）・`setWatchedFiles`・`onExternalFileChange`（Task 12）、`toComparablePath`（既存 `lib/pathUtils.ts`）、`useLatestRef`（既存）、Task 17 の `getOpenFileSnapshot`・`waitForPendingSave`・`replaceCleanTabWithDisk`、既存の `reloadOpenFile`
- Produces: `interface ExternalChangeMarks { get(path): ExternalChangeKind | null; mark(path, kind); clear(path); retain(paths) }`・`useExternalChangeMarks(): ExternalChangeMarks`、`EXTERNAL_RELOAD_CONFIRM_MESSAGE`、`interface ExternalChangeBannerState { path; kind; reload: (() => void) | null; dismiss: () => void }`、`interface UseExternalFileChangesOptions { openFiles; activeFilePath; isFileTabActive; getOpenFileSnapshot; waitForPendingSave; replaceCleanTabWithDisk; reloadOpenFile; marks; onConfirm? }`・`useExternalFileChanges(options): ExternalChangeBannerState | null`、`ExternalChangeBanner`（props `{ banner: ExternalChangeBannerState }`）
- 注: 設計書「未編集のタブの自動の再読込と、編集中のタブへの通知」1〜6。判定はディスクと `savedContent` の比較だけ（イベントの種類・有無では判定しない）。開いているタブの一覧が変わるたびに監視の対象を置き換え、閉じたタブの印を捨てる。購読は張り直さず、最新の描画の関数を ref 経由で呼ぶ（react-hooks の lint の `preserve-manual-memoization` のため `useCallback` を使わない）。印の付いたタブを表示している間だけ通知を返す（diff タブの表示中は返さない）。再読込は既存の `reloadOpenFile`（読めなければ閉じる・保存の世代を進める）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useExternalChangeMarks.test.ts`（新規）:

```ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useExternalChangeMarks } from '../useExternalChangeMarks'

describe('useExternalChangeMarks', () => {
  it('印を付け・読み・消す', () => {
    const { result } = renderHook(() => useExternalChangeMarks())
    act(() => result.current.mark('/p/a.ts', 'modified'))
    expect(result.current.get('/p/a.ts')).toBe('modified')
    act(() => result.current.mark('/p/a.ts', 'deleted'))
    expect(result.current.get('/p/a.ts')).toBe('deleted')
    act(() => result.current.clear('/p/a.ts'))
    expect(result.current.get('/p/a.ts')).toBeNull()
  })

  it('retain は一覧に無いパスの印を捨てる', () => {
    const { result } = renderHook(() => useExternalChangeMarks())
    act(() => {
      result.current.mark('/p/a.ts', 'modified')
      result.current.mark('/p/b.ts', 'modified')
    })
    act(() => result.current.retain(['/p/b.ts']))
    expect(result.current.get('/p/a.ts')).toBeNull()
    expect(result.current.get('/p/b.ts')).toBe('modified')
  })

  it('同じ印を付け直しても、変えないときは状態を作り直さない', () => {
    const { result } = renderHook(() => useExternalChangeMarks())
    act(() => result.current.mark('/p/a.ts', 'modified'))
    const before = result.current.get
    act(() => result.current.mark('/p/a.ts', 'modified'))
    act(() => result.current.retain(['/p/a.ts']))
    expect(result.current.get).toBe(before)
  })
})
```

`src/renderer/src/hooks/__tests__/useExternalFileChanges.test.ts`（新規）:

```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExternalFileChangeEvent } from '@shared/types'
import type { OpenFile } from '../../types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import { useExternalChangeMarks } from '../useExternalChangeMarks'
import { EXTERNAL_RELOAD_CONFIRM_MESSAGE, useExternalFileChanges } from '../useExternalFileChanges'
import type {
  ExternalChangeBannerState,
  UseExternalFileChangesOptions
} from '../useExternalFileChanges'

const mockRead = vi.mocked(fileSystemApi.readFileContent)
const mockSetWatched = vi.mocked(fileSystemApi.setWatchedFiles)
const mockOnChange = vi.mocked(fileSystemApi.onExternalFileChange)

const file = (path: string, content: string, savedContent = content): OpenFile => ({
  path,
  name: path.split('/').pop() ?? path,
  content,
  savedContent,
  language: 'plaintext'
})

let emitChange: (event: ExternalFileChangeEvent) => void
let tabs: Map<string, OpenFile>

type Overrides = Partial<Omit<UseExternalFileChangesOptions, 'marks'>>
type Rendered = RenderHookResult<ExternalChangeBannerState | null, { files: OpenFile[] }> & {
  replaceCleanTabWithDisk: ReturnType<
    typeof vi.fn<UseExternalFileChangesOptions['replaceCleanTabWithDisk']>
  >
  reloadOpenFile: ReturnType<typeof vi.fn<UseExternalFileChangesOptions['reloadOpenFile']>>
}

function renderExternal(initial: OpenFile[], overrides: Overrides = {}): Rendered {
  tabs = new Map(initial.map((f) => [f.path, f]))
  const replaceCleanTabWithDisk = vi.fn<UseExternalFileChangesOptions['replaceCleanTabWithDisk']>(
    (path, expected, disk) => {
      const current = tabs.get(path)
      if (
        current === undefined ||
        current.content !== expected.content ||
        current.content !== current.savedContent
      )
        return false
      if (disk === null) tabs.delete(path)
      else tabs.set(path, { ...current, content: disk, savedContent: disk })
      return true
    }
  )
  const reloadOpenFile = vi.fn<UseExternalFileChangesOptions['reloadOpenFile']>(
    async () => undefined
  )
  const hook = renderHook(
    ({ files }: { files: OpenFile[] }) => {
      const marks = useExternalChangeMarks()
      return useExternalFileChanges({
        openFiles: files,
        activeFilePath: files[0]?.path ?? null,
        isFileTabActive: true,
        getOpenFileSnapshot: (path) => tabs.get(path) ?? null,
        waitForPendingSave: async () => undefined,
        replaceCleanTabWithDisk,
        reloadOpenFile,
        marks,
        onConfirm: () => true,
        ...overrides
      })
    },
    { initialProps: { files: initial } }
  )
  return { ...hook, replaceCleanTabWithDisk, reloadOpenFile }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockSetWatched.mockResolvedValue(undefined)
  mockOnChange.mockImplementation((listener) => {
    emitChange = listener
    return () => undefined
  })
})

describe('useExternalFileChanges', () => {
  it('開いているタブのパスを監視の対象にし、一覧が変わったら置き換える', async () => {
    const { rerender } = renderExternal([file('/p/a.ts', 'x')])
    await waitFor(() => expect(mockSetWatched).toHaveBeenLastCalledWith(['/p/a.ts']))
    rerender({ files: [file('/p/a.ts', 'x'), file('/p/b.ts', 'y')] })
    await waitFor(() => expect(mockSetWatched).toHaveBeenLastCalledWith(['/p/a.ts', '/p/b.ts']))
  })

  it('未編集のタブはディスクの内容に置き換え、通知を出さない', async () => {
    mockRead.mockResolvedValueOnce('agent')
    const { result, replaceCleanTabWithDisk } = renderExternal([file('/p/a.ts', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() =>
      expect(replaceCleanTabWithDisk).toHaveBeenCalledWith(
        '/p/a.ts',
        { content: 'old', savedContent: 'old' },
        'agent'
      )
    )
    expect(result.current).toBeNull()
  })

  it('ディスクが savedContent と同じなら何もしない(自分の保存・同じ内容の書き込み)', async () => {
    mockRead.mockResolvedValueOnce('old')
    const { result, replaceCleanTabWithDisk } = renderExternal([file('/p/a.ts', 'edited', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    expect(replaceCleanTabWithDisk).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('編集中のタブは内容を変えずに modified の通知を出す', async () => {
    mockRead.mockResolvedValueOnce('agent')
    const { result, replaceCleanTabWithDisk } = renderExternal([file('/p/a.ts', 'mine', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    expect(replaceCleanTabWithDisk).not.toHaveBeenCalled()
    expect(tabs.get('/p/a.ts')?.content).toBe('mine')
  })

  it('読む間に打鍵された(置き換えが断られた)ら modified の通知を出す', async () => {
    mockRead.mockImplementationOnce(async () => {
      tabs.set('/p/a.ts', file('/p/a.ts', 'typed', 'old'))
      return 'agent'
    })
    const { result } = renderExternal([file('/p/a.ts', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    expect(tabs.get('/p/a.ts')?.content).toBe('typed')
  })

  it('削除された未編集のタブは閉じ、編集中のタブは deleted の通知を出す(再読込のボタンは無い)', async () => {
    mockRead.mockRejectedValue(new Error('ファイルが見つかりません'))
    const { result } = renderExternal([file('/p/a.ts', 'mine', 'old'), file('/p/b.ts', 'clean')])
    await act(async () => emitChange({ paths: ['/p/a.ts', '/p/b.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('deleted'))
    expect(result.current?.reload).toBeNull()
    expect(tabs.has('/p/b.ts')).toBe(false)
  })

  it('保存の実行中なら、終わってから確かめる', async () => {
    let finishSave: () => void = () => undefined
    const waitForPendingSave = vi.fn(() => new Promise<void>((resolve) => (finishSave = resolve)))
    mockRead.mockResolvedValueOnce('saved')
    renderExternal([file('/p/a.ts', 'saved', 'saved')], { waitForPendingSave })
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    expect(mockRead).not.toHaveBeenCalled()
    await act(async () => finishSave())
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith('/p/a.ts'))
  })

  it('ウィンドウのフォーカスの復帰で全タブを確かめる', async () => {
    mockRead.mockResolvedValue('same')
    renderExternal([file('/p/a.ts', 'same'), file('/p/b.ts', 'same')])
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
  })

  it('「ディスクの内容を読み込む」は確認の後に読み込み直し、印を消す。キャンセルなら何もしない', async () => {
    mockRead.mockResolvedValueOnce('agent')
    const onConfirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { result, reloadOpenFile } = renderExternal([file('/p/a.ts', 'mine', 'old')], {
      onConfirm
    })
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    act(() => result.current?.reload?.())
    expect(reloadOpenFile).not.toHaveBeenCalled()
    await act(async () => result.current?.reload?.())
    expect(onConfirm).toHaveBeenLastCalledWith(EXTERNAL_RELOAD_CONFIRM_MESSAGE)
    expect(reloadOpenFile).toHaveBeenCalledWith('/p/a.ts')
    await waitFor(() => expect(result.current).toBeNull())
  })

  it('「このまま編集する」で印を消す', async () => {
    mockRead.mockResolvedValueOnce('agent')
    const { result } = renderExternal([file('/p/a.ts', 'mine', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current).not.toBeNull())
    act(() => result.current?.dismiss())
    expect(result.current).toBeNull()
  })

  it('diff タブの表示中は通知を出さない', async () => {
    mockRead.mockResolvedValueOnce('agent')
    const { result } = renderExternal([file('/p/a.ts', 'mine', 'old')], { isFileTabActive: false })
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(mockRead).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })
})
```

`src/renderer/src/components/editor/__tests__/ExternalChangeBanner.test.tsx`（新規）:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ExternalChangeBanner from '../ExternalChangeBanner'

describe('ExternalChangeBanner', () => {
  it('変更の通知と、読み込む・このまま編集するのボタンを role="status" で出す', async () => {
    const reload = vi.fn()
    const dismiss = vi.fn()
    render(<ExternalChangeBanner banner={{ path: '/p/a.ts', kind: 'modified', reload, dismiss }} />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'ディスク上のファイルが変更されました（エージェントなどによる変更）。'
    )
    await userEvent.click(screen.getByRole('button', { name: 'ディスクの内容を読み込む' }))
    await userEvent.click(screen.getByRole('button', { name: 'このまま編集する' }))
    expect(reload).toHaveBeenCalledOnce()
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('削除の通知では読み込むのボタンを出さない', () => {
    render(
      <ExternalChangeBanner
        banner={{ path: '/p/a.ts', kind: 'deleted', reload: null, dismiss: vi.fn() }}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('ディスク上のファイルが削除されました。')
    expect(screen.queryByRole('button', { name: 'ディスクの内容を読み込む' })).toBeNull()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/renderer/src/hooks/__tests__/useExternalChangeMarks.test.ts src/renderer/src/hooks/__tests__/useExternalFileChanges.test.ts src/renderer/src/components/editor/__tests__/ExternalChangeBanner.test.tsx
```

Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/hooks/useExternalChangeMarks.ts`（新規）:

```ts
import { useCallback, useState } from 'react'
import type { ExternalChangeKind } from '@shared/types'
import { toComparablePath } from '../lib/pathUtils'

// 編集中のタブの外部変更の印(設計書「編集中のタブへの通知」)。パスの表記揺れ(Windows の大文字小文字)を吸収して持つ
export interface ExternalChangeMarks {
  get: (path: string) => ExternalChangeKind | null
  mark: (path: string, kind: ExternalChangeKind) => void
  clear: (path: string) => void
  /** 開いているタブ以外の印を捨てる */
  retain: (paths: readonly string[]) => void
}

export function useExternalChangeMarks(): ExternalChangeMarks {
  const [marks, setMarks] = useState<ReadonlyMap<string, ExternalChangeKind>>(() => new Map())

  const get = useCallback(
    (path: string): ExternalChangeKind | null => marks.get(toComparablePath(path)) ?? null,
    [marks]
  )
  const mark = useCallback((path: string, kind: ExternalChangeKind): void => {
    setMarks((prev) => {
      const key = toComparablePath(path)
      if (prev.get(key) === kind) return prev
      const next = new Map(prev)
      next.set(key, kind)
      return next
    })
  }, [])
  const clear = useCallback((path: string): void => {
    setMarks((prev) => {
      const key = toComparablePath(path)
      if (!prev.has(key)) return prev
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }, [])
  const retain = useCallback((paths: readonly string[]): void => {
    setMarks((prev) => {
      const keep = new Set(paths.map(toComparablePath))
      if ([...prev.keys()].every((key) => keep.has(key))) return prev
      return new Map([...prev].filter(([key]) => keep.has(key)))
    })
  }, [])
  return { get, mark, clear, retain }
}
```

`src/renderer/src/hooks/useExternalFileChanges.ts`（新規）:

```ts
import { useEffect, useRef } from 'react'
import type { ExternalChangeKind } from '@shared/types'
import type { OpenFile } from '../types'
import * as fileSystemApi from '../lib/fileSystemApi'
import { useLatestRef } from './useLatestRef'
import type { ExternalChangeMarks } from './useExternalChangeMarks'

// 開いているタブの外部変更の反映(設計書「未編集のタブの自動の再読込と、編集中のタブへの通知」)。main の監視の通知と、
// ウィンドウのフォーカスの復帰(監視の取りこぼしの補助)で、ディスクとタブの savedContent を比べる。イベントの種類では判定しない

export const EXTERNAL_RELOAD_CONFIRM_MESSAGE =
  '保存されていない変更は失われます。ディスクの内容を読み込みますか？'

export interface ExternalChangeBannerState {
  path: string
  kind: ExternalChangeKind
  /** ディスクの内容を読み込む(確認の後)。modified のときだけ */
  reload: (() => void) | null
  /** 印を消してこのまま編集する(保存の照合は引き続き働く) */
  dismiss: () => void
}

export interface UseExternalFileChangesOptions {
  openFiles: OpenFile[]
  activeFilePath: string | null
  /** ファイルのタブを表示しているか(diff タブの表示中は通知を出さない) */
  isFileTabActive: boolean
  getOpenFileSnapshot: (path: string) => OpenFile | null
  waitForPendingSave: (path: string) => Promise<void>
  replaceCleanTabWithDisk: (
    path: string,
    expected: { content: string; savedContent: string },
    disk: string | null
  ) => boolean
  reloadOpenFile: (path: string) => Promise<void>
  marks: ExternalChangeMarks
  onConfirm?: (message: string) => boolean
}

// 開いているタブのパスを 1 つの文字列にする(effect の依存を値で比べるため)。パスに改行は入らない
const PATH_SEPARATOR = '\n'

export function useExternalFileChanges({
  openFiles,
  activeFilePath,
  isFileTabActive,
  getOpenFileSnapshot,
  waitForPendingSave,
  replaceCleanTabWithDisk,
  reloadOpenFile,
  marks,
  onConfirm = confirm
}: UseExternalFileChangesOptions): ExternalChangeBannerState | null {
  const openPathsRef = useLatestRef(openFiles.map((file) => file.path))
  const pathsKey = openFiles.map((file) => file.path).join(PATH_SEPARATOR)

  // 1 つのパスを確かめる(設計書の 1〜6)。購読は張り直さず、最新の描画の関数を ref 経由で呼ぶ
  const check = async (path: string): Promise<void> => {
    // 自分の保存を外部変更と誤認しない(保存の後は savedContent がディスクと同じになる)
    await waitForPendingSave(path)
    const before = getOpenFileSnapshot(path)
    if (before === null) return
    let disk: string | null
    try {
      disk = await fileSystemApi.readFileContent(path)
    } catch {
      disk = null
    }
    if (disk !== null && disk === before.savedContent) {
      marks.clear(path)
      return
    }
    const isClean = before.content === before.savedContent
    const expected = { content: before.content, savedContent: before.savedContent }
    if (isClean && replaceCleanTabWithDisk(path, expected, disk)) {
      marks.clear(path)
      return
    }
    marks.mark(path, disk === null ? 'deleted' : 'modified')
  }
  const checkRef = useLatestRef(check)
  const { retain } = marks

  // 開いているタブの一覧が変わるたびに、main の監視の対象を置き換え、閉じたタブの印を捨てる
  useEffect(() => {
    const paths = pathsKey === '' ? [] : pathsKey.split(PATH_SEPARATOR)
    void fileSystemApi.setWatchedFiles(paths).catch(() => undefined)
    retain(paths)
  }, [pathsKey, retain])

  useEffect(
    () =>
      fileSystemApi.onExternalFileChange(({ paths }) => {
        for (const path of paths) void checkRef.current(path)
      }),
    [checkRef]
  )

  useEffect(() => {
    const handleFocus = (): void => {
      for (const path of openPathsRef.current) void checkRef.current(path)
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [checkRef, openPathsRef])

  // 再読込の確認を連打しても 1 回だけ読む
  const reloadingRef = useRef(false)

  if (!isFileTabActive || activeFilePath === null) return null
  const kind = marks.get(activeFilePath)
  if (kind === null) return null
  const path = activeFilePath
  return {
    path,
    kind,
    reload:
      kind === 'modified'
        ? () => {
            if (reloadingRef.current || !onConfirm(EXTERNAL_RELOAD_CONFIRM_MESSAGE)) return
            reloadingRef.current = true
            void reloadOpenFile(path).finally(() => {
              reloadingRef.current = false
              marks.clear(path)
            })
          }
        : null,
    dismiss: () => marks.clear(path)
  }
}
```

`src/renderer/src/components/editor/ExternalChangeBanner.tsx`（新規）:

```tsx
'use client'
import type { ExternalChangeBannerState } from '../../hooks/useExternalFileChanges'

interface Props {
  banner: ExternalChangeBannerState
}

// 編集中のタブのファイルがディスク上で変わった・削除されたときの通知(設計書「編集中のタブへの通知」)
export default function ExternalChangeBanner({ banner }: Props): React.JSX.Element {
  return (
    <div className="external-change-banner" role="status">
      <span className="external-change-banner__message">
        {banner.kind === 'modified'
          ? 'ディスク上のファイルが変更されました（エージェントなどによる変更）。'
          : 'ディスク上のファイルが削除されました。'}
      </span>
      <span className="external-change-banner__actions">
        {banner.reload !== null && (
          <button type="button" className="external-change-banner__button" onClick={banner.reload}>
            ディスクの内容を読み込む
          </button>
        )}
        <button type="button" className="external-change-banner__button" onClick={banner.dismiss}>
          このまま編集する
        </button>
      </span>
    </div>
  )
}
```

`src/renderer/src/assets/main.css`: 共通の枠付きボタンの規則（`/* 枠付きの小さなボタンの共通の見た目(…) */` の直後のセレクタの並び。`.create-tag-dialog__kind {` で終わる）の末尾と、同じ並びの `:hover:not(:disabled)` の規則の末尾に、それぞれ 1 つずつ足す:

```diff
 .code-block__button,
-.create-tag-dialog__kind {
+.create-tag-dialog__kind,
+.external-change-banner__button {
   flex: none;
```

```diff
 .code-block__button:hover:not(:disabled),
-.create-tag-dialog__kind:hover:not(:disabled) {
+.create-tag-dialog__kind:hover:not(:disabled),
+.external-change-banner__button:hover:not(:disabled) {
   background: #094771;
```

`/* ---- Output Panel ---- */` の直前に、次の規則を足す:

```css
/* ---- 外部変更の通知(編集中のタブのファイルがディスク上で変わった) ---- */

.external-change-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: #3a3d41;
  border-bottom: 1px solid #454545;
  color: #cccccc;
  font-size: 12px;
  flex-shrink: 0;
}

.external-change-banner__message {
  flex: 1 1 auto;
  min-width: 0;
}

.external-change-banner__actions {
  display: flex;
  gap: 6px;
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/renderer/src/hooks/__tests__/useExternalChangeMarks.test.ts src/renderer/src/hooks/__tests__/useExternalFileChanges.test.ts src/renderer/src/components/editor/__tests__/ExternalChangeBanner.test.tsx
npm run typecheck
npx eslint src/renderer/src/hooks/useExternalChangeMarks.ts src/renderer/src/hooks/useExternalFileChanges.ts src/renderer/src/components/editor/ExternalChangeBanner.tsx src/renderer/src/hooks/__tests__/useExternalChangeMarks.test.ts src/renderer/src/hooks/__tests__/useExternalFileChanges.test.ts src/renderer/src/components/editor/__tests__/ExternalChangeBanner.test.tsx
npx prettier --check src/renderer/src/hooks/useExternalChangeMarks.ts src/renderer/src/hooks/useExternalFileChanges.ts src/renderer/src/components/editor/ExternalChangeBanner.tsx src/renderer/src/hooks/__tests__/useExternalChangeMarks.test.ts src/renderer/src/hooks/__tests__/useExternalFileChanges.test.ts src/renderer/src/components/editor/__tests__/ExternalChangeBanner.test.tsx src/renderer/src/assets/main.css
```

Expected: PASS（3 + 11 + 2 件）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                            | テストのファイル                 | `-t`                                           | 確認           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------- | -------------- |
| X1  | `useExternalFileChanges.ts` の `if (disk !== null && disk === before.savedContent) {` を `if (disk !== null && disk === before.content) {` にする               | `useExternalFileChanges.test.ts` | `ディスクが savedContent と同じなら何もしない` | 落ちた（1 件） |
| X2  | `useExternalFileChanges.ts` の `await waitForPendingSave(path)` を消す                                                                                          | `useExternalFileChanges.test.ts` | `保存の実行中なら`                             | 落ちた（1 件） |
| X3  | `useExternalFileChanges.ts` の `window.addEventListener('focus', handleFocus)` を消す                                                                           | `useExternalFileChanges.test.ts` | `フォーカスの復帰`                             | 落ちた（1 件） |
| X4  | `useExternalFileChanges.ts` の `if (!isFileTabActive \|\| activeFilePath === null) return null` を `if (activeFilePath === null) return null` にする            | `useExternalFileChanges.test.ts` | `diff タブの表示中は`                          | 落ちた（1 件） |
| X5  | `useExternalFileChanges.ts` の `if (reloadingRef.current \|\| !onConfirm(EXTERNAL_RELOAD_CONFIRM_MESSAGE)) return` を `if (reloadingRef.current) return` にする | `useExternalFileChanges.test.ts` | `ディスクの内容を読み込む`                     | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/renderer
```

---

### Task 19: renderer: セッションの状態とパネルの開閉（`useAgentSession`・`useAgentTerminalPanel`）

**Files:**

- Create: `src/renderer/src/lib/agentSessionMessages.ts`、`src/renderer/src/hooks/useAgentSession.ts`、`src/renderer/src/hooks/useAgentTerminalPanel.ts`、`src/renderer/src/__tests__/makeAgentSessionState.ts`、`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`、`src/renderer/src/hooks/__tests__/useAgentSession.test.ts`、`src/renderer/src/hooks/__tests__/useAgentTerminalPanel.test.ts`

**Interfaces:**

- Consumes: `AgentExitReason`・`AgentStartResult`（Task 2）、`agentTerminalApi`（Task 12）、`AgentTerminalController`（Task 16）、`makeFakeController`（Task 16）、`toError`（既存）
- Produces: `AGENT_START_DISABLED_NO_FOLDER`・`AGENT_EXITED_SOON_NOTE`・`AGENT_EXITED_SOON_MS = 2_000`・`AGENT_STOP_ON_FOLDER_CHANGE_CONFIRM`・`AGENT_STOP_ON_MODE_CHANGE_CONFIRM`、`describeAgentStartError(result): string`、`describeAgentStatus(status, exit): string`、`type AgentSessionStatus = 'none' | 'starting' | 'running' | 'exited'`、`interface AgentSessionExitView { exitCode; reason }`、`interface AgentSessionState { status; sessionId; exit; error; startDisabledReason; start(); stop() }`、`useAgentSession({ folderPath, controller, enabled, now? }): AgentSessionState`、`interface AgentTerminalPanelLayout { isOpen; isMaximized; open(); toggleOpen(); toggleMaximized() }`・`useAgentTerminalPanel(): AgentTerminalPanelLayout`。テストの補助 `makeAgentSessionState(overrides?): AgentSessionState`
- 注: 設計書「セッションの開始」1・6、「エラー処理」、「停止の契機」（エージェント自身の終了で `exited`・出力は残す・起動の直後〈2 秒以内〉の終了コード ≠ 0 は案内を添える）。部品の作り直しの後は `getAgentSession` で合わせる（従来の方式では問い合わせない）。起動中・起動済みの 2 回目の `start` は依頼しない。閉じると最大化も戻り、最大化はパネルを開いてから行う（初期は開いている。差異 19）。`setState` の更新関数の中で別の `setState` を呼ばない（1 つの状態にまとめる）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/__tests__/makeAgentSessionState.ts`（新規。型付きの偽物を 1 か所から作る。パターン 102）:

```ts
import { vi } from 'vitest'
import type { AgentSessionState } from '../hooks/useAgentSession'

// useAgentSession の戻り値の型付きの偽物(1 か所から作る。パターン 102)
export function makeAgentSessionState(
  overrides: Partial<AgentSessionState> = {}
): AgentSessionState {
  return {
    status: 'none',
    sessionId: null,
    exit: null,
    error: null,
    startDisabledReason: null,
    start: vi.fn<AgentSessionState['start']>(async () => undefined),
    stop: vi.fn<AgentSessionState['stop']>(async () => undefined),
    ...overrides
  }
}
```

`src/renderer/src/lib/__tests__/agentSessionMessages.test.ts`（新規）:

```ts
import { describe, it, expect } from 'vitest'
import { describeAgentStatus } from '../agentSessionMessages'

describe('describeAgentStatus', () => {
  it.each([
    ['none', null, '未起動'],
    ['starting', null, '起動中'],
    ['running', null, '起動中'],
    ['exited', { exitCode: 0, reason: 'exited' }, '終了しました（終了コード 0）'],
    ['exited', { exitCode: null, reason: 'stopped' }, '終了しました'],
    ['exited', null, '終了しました']
  ] as const)('%s・%o → %s', (status, exit, expected) => {
    expect(describeAgentStatus(status, exit)).toBe(expected)
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentSession.test.ts`（新規）:

```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/agentTerminalApi')

import * as agentTerminalApi from '../../lib/agentTerminalApi'
import { useAgentSession } from '../useAgentSession'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'

const mockStart = vi.mocked(agentTerminalApi.startAgentSession)
const mockStop = vi.mocked(agentTerminalApi.stopAgentSession)
const mockGetState = vi.mocked(agentTerminalApi.getAgentSession)

let controller: FakeController
let now = 0

beforeEach(() => {
  vi.resetAllMocks()
  controller = makeFakeController()
  now = 0
  mockGetState.mockResolvedValue(null)
  mockStop.mockResolvedValue(undefined)
})

const render = (
  folderPath: string | null = '/work',
  enabled = true
): ReturnType<typeof renderHook<ReturnType<typeof useAgentSession>, unknown>> =>
  renderHook(() => useAgentSession({ folderPath, controller, enabled, now: () => now }))

describe('useAgentSession', () => {
  it('初期状態は none。フォルダが無ければ起動を押せない理由を出す', () => {
    expect(render('/work').result.current.status).toBe('none')
    expect(render(null).result.current.startDisabledReason).toBe('フォルダを開いてください')
  })

  it('起動の直前に画面を消し、測った桁数・行数で起動し、running にしてセッションを controller に渡す', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1' })
    const { result } = render()
    await act(async () => {
      await result.current.start()
    })
    expect(controller.prepareForStart).toHaveBeenCalledOnce()
    expect(mockStart).toHaveBeenCalledWith({ folderPath: '/work', cols: 80, rows: 24 })
    expect(result.current.status).toBe('running')
    expect(controller.sessionId).toBe('s1')
  })

  it.each([
    [{ kind: 'error' as const, error: 'no-folder' as const }, 'フォルダを開いてください'],
    [
      { kind: 'error' as const, error: 'folder-mismatch' as const },
      '開いているフォルダが切り替わりました。もう一度「起動」を押してください'
    ],
    [
      { kind: 'error' as const, error: 'folder-missing' as const, detail: '/work' },
      '開いているフォルダが見つかりません: /work'
    ],
    [
      { kind: 'error' as const, error: 'command-not-found' as const, shellPathUnavailable: false },
      'claude コマンドが見つかりません。Claude Code をインストールしてください（探した場所: ログインシェルの PATH）'
    ],
    [
      { kind: 'error' as const, error: 'command-not-found' as const, shellPathUnavailable: true },
      'claude コマンドが見つかりません。Claude Code をインストールしてください（探した場所: ログインシェルの PATH）（ログインシェルから PATH を取得できなかったため、既定の場所だけを探しました）'
    ],
    [
      { kind: 'error' as const, error: 'spawn-failed' as const, detail: 'boom' },
      'エージェントを起動できませんでした: boom'
    ]
  ])('起動の失敗 %o の文言を出し none に戻す', async (startResult, message) => {
    mockStart.mockResolvedValueOnce(startResult)
    const { result } = render()
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.error).toBe(message)
    expect(result.current.status).toBe('none')
    expect(controller.sessionId).toBeNull()
  })

  it('起動中・起動済みの 2 回目の start は依頼しない', async () => {
    let resolve: (value: { kind: 'started'; sessionId: string }) => void = () => undefined
    mockStart.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    const { result } = render()
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.start()
    })
    await act(async () => {
      await result.current.start()
    })
    await act(async () => {
      resolve({ kind: 'started', sessionId: 's1' })
      await first
    })
    await act(async () => {
      await result.current.start()
    })
    expect(mockStart).toHaveBeenCalledOnce()
  })

  it('自分のセッションの終了で exited にし、終了コードを持つ。ほかのセッションの終了は無視する', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1' })
    const { result } = render()
    await act(async () => {
      await result.current.start()
    })
    act(() =>
      controller.emitExit({ sessionId: 'other', exitCode: 1, signal: null, reason: 'exited' })
    )
    expect(result.current.status).toBe('running')
    now = 10_000
    act(() => controller.emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    expect(result.current.status).toBe('exited')
    expect(result.current.exit).toEqual({ exitCode: 0, reason: 'exited' })
    expect(result.current.error).toBeNull()
    expect(controller.sessionId).toBeNull()
  })

  it('起動の直後(2 秒以内)に終了コード ≠ 0 で終わったら案内を添える', async () => {
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1' })
    const { result } = render()
    await act(async () => {
      await result.current.start()
    })
    now = 1_999
    act(() => controller.emitExit({ sessionId: 's1', exitCode: 1, signal: null, reason: 'exited' }))
    expect(result.current.error).toBe(
      '起動の直後に終了しました。ターミナルの表示を確かめてください'
    )
  })

  it('stop は現在のセッションを止める。セッションが無ければ何もしない', async () => {
    const { result } = render()
    await act(async () => {
      await result.current.stop()
    })
    expect(mockStop).not.toHaveBeenCalled()
    mockStart.mockResolvedValueOnce({ kind: 'started', sessionId: 's1' })
    await act(async () => {
      await result.current.start()
    })
    await act(async () => {
      await result.current.stop()
    })
    expect(mockStop).toHaveBeenCalledWith('s1')
  })

  it('部品の作り直しの後、main のセッションに合わせる', async () => {
    mockGetState.mockResolvedValueOnce({ sessionId: 's9' })
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('running'))
    expect(controller.sessionId).toBe('s9')
  })

  it('従来の方式(enabled が false)では main に問い合わせない', () => {
    render('/work', false)
    expect(mockGetState).not.toHaveBeenCalled()
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentTerminalPanel.test.ts`（新規）:

```ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useAgentTerminalPanel } from '../useAgentTerminalPanel'

describe('useAgentTerminalPanel', () => {
  it('初期は開いていて、最大化していない', () => {
    const { result } = renderHook(() => useAgentTerminalPanel())
    expect(result.current.isOpen).toBe(true)
    expect(result.current.isMaximized).toBe(false)
  })

  it('閉じると最大化も戻る', () => {
    const { result } = renderHook(() => useAgentTerminalPanel())
    act(() => result.current.toggleMaximized())
    act(() => result.current.toggleOpen())
    expect(result.current.isOpen).toBe(false)
    expect(result.current.isMaximized).toBe(false)
  })

  it('最大化は閉じていても開いてから行う', () => {
    const { result } = renderHook(() => useAgentTerminalPanel())
    act(() => result.current.toggleOpen())
    act(() => result.current.toggleMaximized())
    expect(result.current.isOpen).toBe(true)
    expect(result.current.isMaximized).toBe(true)
  })

  it('open は閉じていれば開き、最大化は変えない', () => {
    const { result } = renderHook(() => useAgentTerminalPanel())
    act(() => result.current.toggleOpen())
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)
    expect(result.current.isMaximized).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/hooks/__tests__/useAgentSession.test.ts src/renderer/src/hooks/__tests__/useAgentTerminalPanel.test.ts
```

Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/agentSessionMessages.ts`（新規）:

```ts
import type { AgentExitReason, AgentStartResult } from '@shared/types'

// エージェントのセッションの表示の文言(設計書「エラー処理」「配置の案」)

export const AGENT_START_DISABLED_NO_FOLDER = 'フォルダを開いてください'
export const AGENT_EXITED_SOON_NOTE = '起動の直後に終了しました。ターミナルの表示を確かめてください'
/** 起動の直後とみなす時間(node-pty は起動の失敗を終了コード 1 で返すため。確認の結果 4) */
export const AGENT_EXITED_SOON_MS = 2_000

/** 起動の失敗の文言(パネルの帯の下に role="alert" で出す) */
export function describeAgentStartError(
  result: Extract<AgentStartResult, { kind: 'error' }>
): string {
  switch (result.error) {
    case 'no-folder':
      return AGENT_START_DISABLED_NO_FOLDER
    case 'folder-mismatch':
      return '開いているフォルダが切り替わりました。もう一度「起動」を押してください'
    case 'folder-missing':
      return `開いているフォルダが見つかりません: ${result.detail ?? ''}`
    case 'command-not-found':
      return (
        'claude コマンドが見つかりません。Claude Code をインストールしてください（探した場所: ログインシェルの PATH）' +
        (result.shellPathUnavailable === true
          ? '（ログインシェルから PATH を取得できなかったため、既定の場所だけを探しました）'
          : '')
      )
    case 'spawn-failed':
      return `エージェントを起動できませんでした: ${result.detail ?? ''}`
  }
}

/** パネルの帯の状態の文言 */
export function describeAgentStatus(
  status: 'none' | 'starting' | 'running' | 'exited',
  exit: { exitCode: number | null; reason: AgentExitReason } | null
): string {
  if (status === 'none') return '未起動'
  if (status === 'starting' || status === 'running') return '起動中'
  if (exit === null || exit.exitCode === null) return '終了しました'
  return `終了しました（終了コード ${exit.exitCode}）`
}

/** フォルダの切り替え(「フォルダを変更」「リポジトリを clone」)の前の確認 */
export const AGENT_STOP_ON_FOLDER_CHANGE_CONFIRM =
  'フォルダを切り替えると、実行中のエージェントを終了します。続けますか？'
/** 従来の方式への切り替えの前の確認 */
export const AGENT_STOP_ON_MODE_CHANGE_CONFIRM =
  '従来の方式に切り替えると、実行中のエージェントを終了します。続けますか？'
```

`src/renderer/src/hooks/useAgentSession.ts`（新規）:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentExitReason } from '@shared/types'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import * as agentTerminalApi from '../lib/agentTerminalApi'
import {
  AGENT_EXITED_SOON_MS,
  AGENT_EXITED_SOON_NOTE,
  AGENT_START_DISABLED_NO_FOLDER,
  describeAgentStartError
} from '../lib/agentSessionMessages'
import { toError } from '../lib/errorUtils'

export type AgentSessionStatus = 'none' | 'starting' | 'running' | 'exited'

export interface AgentSessionExitView {
  exitCode: number | null
  reason: AgentExitReason
}

export interface AgentSessionState {
  status: AgentSessionStatus
  sessionId: string | null
  exit: AgentSessionExitView | null
  /** 起動の失敗・起動の直後の終了の文言(role="alert")。次の起動で消える */
  error: string | null
  /** 起動を押せない理由(フォルダを開いていない)。押せるなら null */
  startDisabledReason: string | null
  start: () => Promise<void>
  /** 確認なしで止める。止め終わってから解決する */
  stop: () => Promise<void>
}

export interface UseAgentSessionOptions {
  folderPath: string | null
  controller: AgentTerminalController
  /** エージェント CLI 方式のときだけ true(従来の方式ではセッションを持たない) */
  enabled: boolean
  now?: () => number
}

export function useAgentSession({
  folderPath,
  controller,
  enabled,
  now = Date.now
}: UseAgentSessionOptions): AgentSessionState {
  const [status, setStatus] = useState<AgentSessionStatus>('none')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [exit, setExit] = useState<AgentSessionExitView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const startedAtRef = useRef(0)
  const startingRef = useRef(false)

  const adoptSession = useCallback(
    (id: string | null): void => {
      sessionIdRef.current = id
      setSessionId(id)
      controller.setSession(id)
    },
    [controller]
  )

  // 部品の作り直しの後に、main のセッションに合わせる(リロードではセッションは止まるため、通常は null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void agentTerminalApi
      .getAgentSession()
      .then((snapshot) => {
        if (cancelled || snapshot === null || sessionIdRef.current !== null) return
        adoptSession(snapshot.sessionId)
        setStatus('running')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled, adoptSession])

  useEffect(
    () =>
      controller.onExit((event) => {
        if (event.sessionId !== sessionIdRef.current) return
        const exitedSoon =
          event.reason === 'exited' &&
          event.exitCode !== 0 &&
          now() - startedAtRef.current < AGENT_EXITED_SOON_MS
        adoptSession(null)
        setExit({ exitCode: event.exitCode, reason: event.reason })
        setStatus('exited')
        if (exitedSoon) setError(AGENT_EXITED_SOON_NOTE)
      }),
    [controller, adoptSession, now]
  )

  const start = useCallback(async (): Promise<void> => {
    if (folderPath === null || startingRef.current || sessionIdRef.current !== null) return
    startingRef.current = true
    setStatus('starting')
    setError(null)
    setExit(null)
    controller.prepareForStart()
    const { cols, rows } = controller.fit()
    try {
      const result = await agentTerminalApi.startAgentSession({ folderPath, cols, rows })
      if (result.kind === 'error') {
        controller.setSession(null)
        setError(describeAgentStartError(result))
        setStatus('none')
        return
      }
      startedAtRef.current = now()
      adoptSession(result.sessionId)
      setStatus('running')
    } catch (err) {
      controller.setSession(null)
      setError(`エージェントを起動できませんでした: ${toError(err).message}`)
      setStatus('none')
    } finally {
      startingRef.current = false
    }
  }, [folderPath, controller, adoptSession, now])

  const stop = useCallback(async (): Promise<void> => {
    const id = sessionIdRef.current
    if (id === null) return
    try {
      await agentTerminalApi.stopAgentSession(id)
    } catch (err) {
      setError(`エージェントを終了できませんでした: ${toError(err).message}`)
    }
  }, [])

  return {
    status,
    sessionId,
    exit,
    error,
    startDisabledReason: folderPath === null ? AGENT_START_DISABLED_NO_FOLDER : null,
    start,
    stop
  }
}
```

`src/renderer/src/hooks/useAgentTerminalPanel.ts`（新規）:

```ts
import { useCallback, useState } from 'react'

// ターミナルのパネルの開閉・最大化(保存しない。設計書「配置の案」)
export interface AgentTerminalPanelLayout {
  isOpen: boolean
  isMaximized: boolean
  open: () => void
  toggleOpen: () => void
  toggleMaximized: () => void
}

export function useAgentTerminalPanel(): AgentTerminalPanelLayout {
  const [layout, setLayout] = useState({ isOpen: true, isMaximized: false })
  const open = useCallback(
    () => setLayout((prev) => (prev.isOpen ? prev : { ...prev, isOpen: true })),
    []
  )
  // 閉じるときは最大化も戻す(閉じたパネルが領域を占めない)
  const toggleOpen = useCallback(
    () =>
      setLayout((prev) =>
        prev.isOpen ? { isOpen: false, isMaximized: false } : { ...prev, isOpen: true }
      ),
    []
  )
  // 最大化はパネルを開いてから行う
  const toggleMaximized = useCallback(
    () => setLayout((prev) => ({ isOpen: true, isMaximized: !prev.isMaximized })),
    []
  )
  return { ...layout, open, toggleOpen, toggleMaximized }
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/hooks/__tests__/useAgentSession.test.ts src/renderer/src/hooks/__tests__/useAgentTerminalPanel.test.ts
npm run typecheck
npx eslint src/renderer/src/lib/agentSessionMessages.ts src/renderer/src/hooks/useAgentSession.ts src/renderer/src/hooks/useAgentTerminalPanel.ts src/renderer/src/__tests__/makeAgentSessionState.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/hooks/__tests__/useAgentSession.test.ts src/renderer/src/hooks/__tests__/useAgentTerminalPanel.test.ts
npx prettier --check src/renderer/src/lib/agentSessionMessages.ts src/renderer/src/hooks/useAgentSession.ts src/renderer/src/hooks/useAgentTerminalPanel.ts src/renderer/src/__tests__/makeAgentSessionState.ts src/renderer/src/lib/__tests__/agentSessionMessages.test.ts src/renderer/src/hooks/__tests__/useAgentSession.test.ts src/renderer/src/hooks/__tests__/useAgentTerminalPanel.test.ts
```

Expected: PASS（6 + 14 + 4 件）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                                                                 | テストのファイル                | `-t`                               | 確認           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------- | -------------- |
| Y1  | `useAgentSession.ts` の `if (event.sessionId !== sessionIdRef.current) return` を消す                                                                                                                | `useAgentSession.test.ts`       | `ほかのセッションの終了は無視する` | 落ちた（1 件） |
| Y2  | `useAgentSession.ts` の `now() - startedAtRef.current < AGENT_EXITED_SOON_MS` を `now() - startedAtRef.current < 0` にする                                                                           | `useAgentSession.test.ts`       | `起動の直後`                       | 落ちた（1 件） |
| Y3  | `useAgentSession.ts` の `if (folderPath === null \|\| startingRef.current \|\| sessionIdRef.current !== null) return` を `if (folderPath === null \|\| sessionIdRef.current !== null) return` にする | `useAgentSession.test.ts`       | `2 回目の start は依頼しない`      | 落ちた（1 件） |
| Y4  | `useAgentSession.ts` の `controller.prepareForStart()` を消す                                                                                                                                        | `useAgentSession.test.ts`       | `起動の直前に画面を消し`           | 落ちた（1 件） |
| Y5  | `useAgentTerminalPanel.ts` の `prev.isOpen ? { isOpen: false, isMaximized: false } : { ...prev, isOpen: true }` を `prev.isOpen ? { ...prev, isOpen: false } : { ...prev, isOpen: true }` にする     | `useAgentTerminalPanel.test.ts` | `閉じると最大化も戻る`             | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/renderer
```

---

### Task 20: renderer: 送信・実行方式・実行の分岐・押せる条件

**Files:**

- Create: `src/renderer/src/lib/agentSendMessages.ts`、`src/renderer/src/hooks/useAgentPromptSender.ts`、`src/renderer/src/hooks/useExecutionMode.ts`、`src/renderer/src/lib/__tests__/agentSendMessages.test.ts`、`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`、`src/renderer/src/hooks/__tests__/useExecutionMode.test.ts`
- Modify: `src/renderer/src/hooks/usePromptRunner.ts`（全体。方式で分岐）、`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`（新しい依存を渡す・末尾に追加）

**Interfaces:**

- Consumes: `PromptExecutionMode`・`DEFAULT_PROMPT_EXECUTION_MODE`（Task 2）、`settingsApi.getPromptExecutionMode`・`setPromptExecutionMode`（Task 12）、`sendAgentPrompt`・`realClock`・`AgentSendClock`・`AgentSendOutcome`・`AgentSendFailure`（Task 14）、`AgentTerminalController`・`makeFakeController`（Task 16）、`makeLine`（Task 13）、`useTransientNotice`・`toAnnouncementText`（既存）、`Announcement`（既存 `types.ts`）
- Produces: `AGENT_SEND_FAILURE_MESSAGES: Record<AgentSendFailure, string>`・`AGENT_SENT_NOTICE`・`AGENT_SENT_AFTER_CLEAR_NOTICE`・`RUN_DISABLED_LOADING_MODE`・`RUN_DISABLED_NO_SESSION`・`RUN_DISABLED_SENDING`・`RERUN_DISABLED_AGENT_MODE`、`interface PromptRunAvailability { disabled; reason }`、`getPromptRunAvailability({ mode, isExecuting, isSessionRunning, isSending })`・`getRerunAvailability({ mode, isExecuting })`、`AGENT_SEND_NOTICE_DURATION_MS = 3_000`、`interface AgentPromptSenderState { isSending; error; notice; send(text): Promise<AgentSendOutcome | undefined> }`・`useAgentPromptSender({ controller, onSettled, clock? })`、`interface ExecutionModeState { mode: PromptExecutionMode | null; saveError: string | null; changeMode(next): Promise<boolean> }`・`useExecutionMode()`、`usePromptRunner({ openFile, executePrompt, addHistoryEntry, executionMode, sendToAgent })`
- 注: 設計書「プロンプトの送信」1・2・11〜13、「セッションが無いときのボタン」、「実行方式の切り替え」（選ぶとすぐ保存・失敗で戻す・読み込み中は null）、C1・C2（添付しない）・C11（履歴に記録しない・再実行しない）・C13（エージェント CLI 方式は「running で送信中でない」で決める。従来の `isExecuting` は見ない）。送信の間は controller が利用者の打鍵を溜め、成否にかかわらず解く（`finally`）。送った後・失敗した後に `onSettled`（パネルを開く）。フォーカスは動かさない。従来の方式の実行中は理由を出さない（従来どおり）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentSendMessages.test.ts`（新規）:

```ts
import { describe, it, expect } from 'vitest'
import {
  RERUN_DISABLED_AGENT_MODE,
  RUN_DISABLED_LOADING_MODE,
  RUN_DISABLED_NO_SESSION,
  RUN_DISABLED_SENDING,
  getPromptRunAvailability,
  getRerunAvailability
} from '../agentSendMessages'

describe('getPromptRunAvailability', () => {
  const base = { isExecuting: false, isSessionRunning: false, isSending: false }
  it.each([
    ['読み込み中', { ...base, mode: null }, { disabled: true, reason: RUN_DISABLED_LOADING_MODE }],
    ['従来の方式・実行中でない', { ...base, mode: 'legacy' }, { disabled: false, reason: null }],
    [
      '従来の方式・実行中(理由は出さない)',
      { ...base, mode: 'legacy', isExecuting: true },
      { disabled: true, reason: null }
    ],
    [
      'エージェント・セッションなし',
      { ...base, mode: 'agent-cli' },
      { disabled: true, reason: RUN_DISABLED_NO_SESSION }
    ],
    [
      'エージェント・送信中',
      { ...base, mode: 'agent-cli', isSessionRunning: true, isSending: true },
      { disabled: true, reason: RUN_DISABLED_SENDING }
    ],
    [
      'エージェント・送れる',
      { ...base, mode: 'agent-cli', isSessionRunning: true },
      { disabled: false, reason: null }
    ],
    [
      'エージェント・従来の実行中フラグは見ない(C13)',
      { ...base, mode: 'agent-cli', isSessionRunning: true, isExecuting: true },
      { disabled: false, reason: null }
    ]
  ] as const)('%s', (_label, params, expected) => {
    expect(getPromptRunAvailability(params)).toEqual(expected)
  })
})

describe('getRerunAvailability', () => {
  it.each([
    [
      { mode: null, isExecuting: false },
      { disabled: true, reason: RUN_DISABLED_LOADING_MODE }
    ],
    [
      { mode: 'agent-cli', isExecuting: false },
      { disabled: true, reason: RERUN_DISABLED_AGENT_MODE }
    ],
    [
      { mode: 'legacy', isExecuting: true },
      { disabled: true, reason: null }
    ],
    [
      { mode: 'legacy', isExecuting: false },
      { disabled: false, reason: null }
    ]
  ] as const)('%o', (params, expected) => {
    expect(getRerunAvailability(params)).toEqual(expected)
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts`（新規）:

```ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useAgentPromptSender } from '../useAgentPromptSender'
import type { AgentSendClock } from '../../lib/agentPromptSend'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import { makeLine } from '../../lib/__tests__/fixtures/agentScreens'
import { toAnnouncementText } from '../../lib/announcementText'

afterEach(() => {
  vi.useRealTimers()
})

// 仮想の時計(sleep で時間を進めるだけ)
const clock: AgentSendClock = (() => {
  let now = 0
  return { now: () => now, sleep: async (ms: number) => void (now += ms) }
})()

// 空の入力欄の画面。貼り付けを書き込むと本文が入った画面に変える
function controllerWithEmptyInput(): ReturnType<typeof makeFakeController> {
  const controller = makeFakeController()
  const border = makeLine('─'.repeat(40))
  controller.viewport = [border, makeLine('❯\xa0 ', [], [[2, 3]]), border]
  const original = controller.writeToSession
  controller.writeToSession = (data) => {
    original(data)
    if (data.startsWith('\x1b[200~'))
      controller.viewport = [border, makeLine(`❯\xa0${data.slice(6, -6)}`), border]
  }
  return controller
}

describe('useAgentPromptSender', () => {
  it('送信の間は利用者の入力を溜め、成功を通知し、パネルを開く', async () => {
    const controller = controllerWithEmptyInput()
    const onSettled = vi.fn()
    const { result } = renderHook(() => useAgentPromptSender({ controller, onSettled, clock }))
    await act(async () => {
      await result.current.send('hello')
    })
    expect(controller.beginSending).toHaveBeenCalledOnce()
    expect(controller.endSending).toHaveBeenCalledOnce()
    expect(controller.writes).toEqual(['\x1b[200~hello\x1b[201~', '\r'])
    expect(toAnnouncementText(result.current.notice).startsWith('エージェントに送信しました')).toBe(
      true
    )
    expect(result.current.error).toBeNull()
    expect(onSettled).toHaveBeenCalledOnce()
    expect(result.current.isSending).toBe(false)
  })

  it('失敗の理由の文言を出し、パネルを開く。送らなかったときも入力の保留を解く', async () => {
    const controller = makeFakeController()
    const onSettled = vi.fn()
    const { result } = renderHook(() => useAgentPromptSender({ controller, onSettled, clock }))
    await act(async () => {
      await result.current.send('hello')
    })
    expect(result.current.error).toBe(
      'エージェントの入力欄が見つかりません。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください'
    )
    expect(controller.endSending).toHaveBeenCalledOnce()
    expect(onSettled).toHaveBeenCalledOnce()
  })

  it('書きかけを消して送ったときは、その旨を通知する', async () => {
    const controller = controllerWithEmptyInput()
    const border = makeLine('─'.repeat(40))
    controller.viewport = [border, makeLine('❯\xa0abc ', [], [[5, 6]]), border]
    const write = controller.writeToSession
    controller.writeToSession = (data) => {
      if (data.startsWith('\x0b'))
        controller.viewport = [border, makeLine('❯\xa0 ', [], [[2, 3]]), border]
      write(data)
    }
    const { result } = renderHook(() =>
      useAgentPromptSender({ controller, onSettled: vi.fn(), clock })
    )
    await act(async () => {
      await result.current.send('p')
    })
    expect(
      toAnnouncementText(result.current.notice).startsWith(
        'エージェントに送信しました（入力欄に書きかけがあったようなので、消してから送りました）'
      )
    ).toBe(true)
  })

  it('送信中の 2 回目の send は何もしない', async () => {
    const controller = controllerWithEmptyInput()
    let release: () => void = () => undefined
    const slowClock: AgentSendClock = {
      now: () => 0,
      sleep: () => new Promise<void>((resolve) => (release = resolve))
    }
    const { result } = renderHook(() =>
      useAgentPromptSender({ controller, onSettled: vi.fn(), clock: slowClock })
    )
    let first: Promise<unknown> = Promise.resolve()
    act(() => {
      first = result.current.send('a')
    })
    expect(result.current.isSending).toBe(true)
    await act(async () => {
      await expect(result.current.send('b')).resolves.toBeUndefined()
    })
    expect(controller.beginSending).toHaveBeenCalledOnce()
    // 1 回目を終わらせる(待ちを解き続ける)
    for (let i = 0; i < 10; i++) {
      await act(async () => release())
    }
    await act(async () => {
      await first
    })
  })
})
```

`src/renderer/src/hooks/__tests__/useExecutionMode.test.ts`（新規）:

```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/settingsApi')

import * as settingsApi from '../../lib/settingsApi'
import { useExecutionMode } from '../useExecutionMode'

const mockGet = vi.mocked(settingsApi.getPromptExecutionMode)
const mockSet = vi.mocked(settingsApi.setPromptExecutionMode)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useExecutionMode', () => {
  it('読み込みが終わるまでは null、終わったら保存された方式', async () => {
    mockGet.mockResolvedValueOnce('legacy')
    const { result } = renderHook(() => useExecutionMode())
    expect(result.current.mode).toBeNull()
    await waitFor(() => expect(result.current.mode).toBe('legacy'))
  })

  it('読み込みに失敗したら既定(agent-cli)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockRejectedValueOnce(new Error('broken'))
    const { result } = renderHook(() => useExecutionMode())
    await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
    consoleSpy.mockRestore()
  })

  it('選んだらすぐ保存し、表示を切り替える', async () => {
    mockGet.mockResolvedValueOnce('agent-cli')
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useExecutionMode())
    await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
    await act(async () => {
      await expect(result.current.changeMode('legacy')).resolves.toBe(true)
    })
    expect(mockSet).toHaveBeenCalledWith('legacy')
    expect(result.current.mode).toBe('legacy')
    expect(result.current.saveError).toBeNull()
  })

  it('保存に失敗したら保存前の値に戻し、理由を出す', async () => {
    mockGet.mockResolvedValueOnce('agent-cli')
    mockSet.mockRejectedValueOnce(new Error('EACCES'))
    const { result } = renderHook(() => useExecutionMode())
    await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
    await act(async () => {
      await expect(result.current.changeMode('legacy')).resolves.toBe(false)
    })
    expect(result.current.mode).toBe('agent-cli')
    expect(result.current.saveError).toBe('実行方式を保存できませんでした: EACCES')
  })
})
```

`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`（差分）:

```diff
--- a/src/renderer/src/hooks/__tests__/usePromptRunner.test.ts
+++ b/src/renderer/src/hooks/__tests__/usePromptRunner.test.ts
@@ -36,7 +36,13 @@
     const executePrompt = vi.fn()
     const addHistoryEntry = vi.fn()
     const { result } = renderHook(() =>
-      usePromptRunner({ openFile, executePrompt, addHistoryEntry })
+      usePromptRunner({
+        openFile,
+        executePrompt,
+        addHistoryEntry,
+        executionMode: 'legacy',
+        sendToAgent: vi.fn()
+      })
     )

     result.current.runPrompt('実行する内容', 'claude', prompt)
@@ -54,7 +60,13 @@
     const executePrompt = vi.fn()
     const addHistoryEntry = vi.fn()
     const { result } = renderHook(() =>
-      usePromptRunner({ openFile: null, executePrompt, addHistoryEntry })
+      usePromptRunner({
+        openFile: null,
+        executePrompt,
+        addHistoryEntry,
+        executionMode: 'legacy',
+        sendToAgent: vi.fn()
+      })
     )

     result.current.runPrompt('実行する内容', 'claude', prompt)
@@ -73,7 +85,13 @@
     const addHistoryEntry = vi.fn()
     // 現在開いているファイルは履歴保存時のものと異なる
     const { result } = renderHook(() =>
-      usePromptRunner({ openFile, executePrompt, addHistoryEntry })
+      usePromptRunner({
+        openFile,
+        executePrompt,
+        addHistoryEntry,
+        executionMode: 'legacy',
+        sendToAgent: vi.fn()
+      })
     )

     result.current.rerunHistoryEntry(historyEntry)
@@ -95,3 +113,57 @@
     )
   })
 })
+
+describe('usePromptRunner: 実行方式', () => {
+  it('エージェント CLI 方式では本文だけをエージェントへ送り、従来の実行と履歴の記録をしない', async () => {
+    const executePrompt = vi.fn()
+    const sendToAgent = vi.fn(async () => undefined)
+    const { result } = renderHook(() =>
+      usePromptRunner({
+        openFile,
+        executePrompt,
+        addHistoryEntry: vi.fn(),
+        executionMode: 'agent-cli',
+        sendToAgent
+      })
+    )
+    await result.current.runPrompt('送る本文', 'claude', prompt)
+    expect(sendToAgent).toHaveBeenCalledExactlyOnceWith('送る本文')
+    expect(executePrompt).not.toHaveBeenCalled()
+  })
+
+  it('実行方式の読み込み中(null)は何もしない', async () => {
+    const executePrompt = vi.fn()
+    const sendToAgent = vi.fn(async () => undefined)
+    const { result } = renderHook(() =>
+      usePromptRunner({
+        openFile,
+        executePrompt,
+        addHistoryEntry: vi.fn(),
+        executionMode: null,
+        sendToAgent
+      })
+    )
+    await result.current.runPrompt('本文', 'claude', prompt)
+    await result.current.rerunHistoryEntry(historyEntry)
+    expect(sendToAgent).not.toHaveBeenCalled()
+    expect(executePrompt).not.toHaveBeenCalled()
+  })
+
+  it('エージェント CLI 方式では履歴の再実行をしない', async () => {
+    const executePrompt = vi.fn()
+    const sendToAgent = vi.fn(async () => undefined)
+    const { result } = renderHook(() =>
+      usePromptRunner({
+        openFile,
+        executePrompt,
+        addHistoryEntry: vi.fn(),
+        executionMode: 'agent-cli',
+        sendToAgent
+      })
+    )
+    await result.current.rerunHistoryEntry(historyEntry)
+    expect(executePrompt).not.toHaveBeenCalled()
+    expect(sendToAgent).not.toHaveBeenCalled()
+  })
+})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useExecutionMode.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts
```

Expected: FAIL（モジュールが無い。`usePromptRunner` の新しい 3 件）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/agentSendMessages.ts`（新規）:

```ts
import type { PromptExecutionMode } from '@shared/types'
import type { AgentSendFailure } from './agentPromptSend'

// プロンプトの送信の文言(設計書「プロンプトの送信」「セッションが無いときのボタン」「エラー処理」)

export const AGENT_SEND_FAILURE_MESSAGES: Record<AgentSendFailure, string> = {
  empty: '送信する内容がありません',
  'too-long': 'プロンプトが長すぎます',
  'leading-bang':
    '先頭が「!」のプロンプトは、エージェントのシェルのコマンドとして実行されるため送信できません（先頭に空白を入れると送れます）',
  'not-accepting': 'エージェントが入力を受け付けていません',
  'input-not-found':
    'エージェントの入力欄が見つかりません。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください',
  'clear-failed':
    'エージェントの入力欄を空にできませんでした。ターミナルで入力欄を確かめてから、もう一度実行してください',
  'not-echoed':
    'エージェントの入力欄に入りませんでした。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください'
}

export const AGENT_SENT_NOTICE = 'エージェントに送信しました'
export const AGENT_SENT_AFTER_CLEAR_NOTICE =
  'エージェントに送信しました（入力欄に書きかけがあったようなので、消してから送りました）'

export const RUN_DISABLED_LOADING_MODE = '設定を読み込んでいます'
export const RUN_DISABLED_NO_SESSION =
  'エージェントが起動していません（ターミナルの「起動」を押してください）'
export const RUN_DISABLED_SENDING = 'エージェントへ送信しています'
export const RERUN_DISABLED_AGENT_MODE =
  'エージェント CLI 方式では再実行できません（設定で従来の方式に切り替えると使えます）'

export interface PromptRunAvailability {
  disabled: boolean
  /** 押せない理由(画面に 1 か所だけ表示し、aria-describedby で参照する)。従来の方式の実行中は理由を出さない(従来どおり) */
  reason: string | null
}

/** 実行ボタンを押せるか(設計書 C13: エージェント CLI 方式は「セッションが running で、送信中でない」) */
export function getPromptRunAvailability(params: {
  mode: PromptExecutionMode | null
  isExecuting: boolean
  isSessionRunning: boolean
  isSending: boolean
}): PromptRunAvailability {
  if (params.mode === null) return { disabled: true, reason: RUN_DISABLED_LOADING_MODE }
  if (params.mode === 'legacy') return { disabled: params.isExecuting, reason: null }
  if (!params.isSessionRunning) return { disabled: true, reason: RUN_DISABLED_NO_SESSION }
  if (params.isSending) return { disabled: true, reason: RUN_DISABLED_SENDING }
  return { disabled: false, reason: null }
}

/** 履歴の再実行を押せるか(設計書「決定した点」5) */
export function getRerunAvailability(params: {
  mode: PromptExecutionMode | null
  isExecuting: boolean
}): PromptRunAvailability {
  if (params.mode === null) return { disabled: true, reason: RUN_DISABLED_LOADING_MODE }
  if (params.mode === 'agent-cli') return { disabled: true, reason: RERUN_DISABLED_AGENT_MODE }
  return { disabled: params.isExecuting, reason: null }
}
```

`src/renderer/src/hooks/useAgentPromptSender.ts`（新規）:

```ts
import { useCallback, useRef, useState } from 'react'
import type { Announcement } from '../types'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import { sendAgentPrompt, realClock } from '../lib/agentPromptSend'
import type { AgentSendClock, AgentSendOutcome } from '../lib/agentPromptSend'
import {
  AGENT_SEND_FAILURE_MESSAGES,
  AGENT_SENT_AFTER_CLEAR_NOTICE,
  AGENT_SENT_NOTICE
} from '../lib/agentSendMessages'
import { useTransientNotice } from './useTransientNotice'

/** 送信の結果の通知を消すまでの時間 */
export const AGENT_SEND_NOTICE_DURATION_MS = 3_000

export interface AgentPromptSenderState {
  isSending: boolean
  /** 失敗の文言(プロンプトパネルの上部に role="alert")。次の送信で消える */
  error: string | null
  /** 成功の通知(role="status") */
  notice: Announcement | null
  /** 送る。送信中は何もしない(undefined を返す) */
  send: (text: string) => Promise<AgentSendOutcome | undefined>
}

export interface UseAgentPromptSenderOptions {
  controller: AgentTerminalController
  /** 送った後・失敗した後に呼ぶ(ターミナルのパネルを開く) */
  onSettled: () => void
  clock?: AgentSendClock
}

export function useAgentPromptSender({
  controller,
  onSettled,
  clock = realClock
}: UseAgentPromptSenderOptions): AgentPromptSenderState {
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { notice, announce, clear } = useTransientNotice(AGENT_SEND_NOTICE_DURATION_MS)
  // 2 つの貼り付けが混ざらないよう、同期的に二重の送信を止める
  const sendingRef = useRef(false)

  const send = useCallback(
    async (text: string): Promise<AgentSendOutcome | undefined> => {
      if (sendingRef.current) return undefined
      sendingRef.current = true
      setIsSending(true)
      setError(null)
      clear()
      controller.beginSending()
      try {
        const outcome = await sendAgentPrompt(
          {
            isBracketedPasteEnabled: () => controller.isBracketedPasteEnabled(),
            readViewport: () => controller.readViewport(),
            getCols: () => controller.getSize().cols,
            write: (data) => controller.writeToSession(data)
          },
          text,
          clock
        )
        if (outcome.kind === 'sent') {
          announce(outcome.clearedDraft ? AGENT_SENT_AFTER_CLEAR_NOTICE : AGENT_SENT_NOTICE)
        } else {
          setError(AGENT_SEND_FAILURE_MESSAGES[outcome.reason])
        }
        onSettled()
        return outcome
      } finally {
        controller.endSending()
        sendingRef.current = false
        setIsSending(false)
      }
    },
    [controller, onSettled, clock, announce, clear]
  )

  return { isSending, error, notice, send }
}
```

`src/renderer/src/hooks/useExecutionMode.ts`（新規）:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PromptExecutionMode } from '@shared/types'
import { DEFAULT_PROMPT_EXECUTION_MODE } from '@shared/types'
import * as settingsApi from '../lib/settingsApi'
import { toError } from '../lib/errorUtils'

export interface ExecutionModeState {
  /** 読み込みが終わるまでは null(実行ボタンを押せない) */
  mode: PromptExecutionMode | null
  /** 保存の失敗の文言。次の保存で消える */
  saveError: string | null
  /** 選んですぐ保存する。失敗したら保存前の値に戻し、false を返す */
  changeMode: (next: PromptExecutionMode) => Promise<boolean>
}

export function useExecutionMode(): ExecutionModeState {
  const [mode, setMode] = useState<PromptExecutionMode | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const modeRef = useRef<PromptExecutionMode | null>(null)

  useEffect(() => {
    let cancelled = false
    settingsApi
      .getPromptExecutionMode()
      .then((loaded) => {
        if (cancelled) return
        modeRef.current = loaded
        setMode(loaded)
      })
      .catch((err) => {
        console.error('[useExecutionMode] getPromptExecutionMode failed:', err)
        if (cancelled) return
        modeRef.current = DEFAULT_PROMPT_EXECUTION_MODE
        setMode(DEFAULT_PROMPT_EXECUTION_MODE)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const changeMode = useCallback(async (next: PromptExecutionMode): Promise<boolean> => {
    const previous = modeRef.current
    modeRef.current = next
    setMode(next)
    setSaveError(null)
    try {
      await settingsApi.setPromptExecutionMode(next)
      return true
    } catch (err) {
      modeRef.current = previous
      setMode(previous)
      setSaveError(`実行方式を保存できませんでした: ${toError(err).message}`)
      return false
    }
  }, [])

  return { mode, saveError, changeMode }
}
```

`src/renderer/src/hooks/usePromptRunner.ts`（全文）:

```ts
import { useCallback } from 'react'
import type { PromptExecutionMode } from '@shared/types'
import type { HistoryEntry, OpenFile, Prompt, PromptToolId } from '../types'
import type { ExecutionContext, PromptExecutionState } from './usePromptExecution'

interface Deps {
  openFile: OpenFile | null
  executePrompt: PromptExecutionState['executePrompt']
  addHistoryEntry: (entry: Omit<HistoryEntry, 'id'>) => void
  /** 実行方式。読み込み中は null(何もしない) */
  executionMode: PromptExecutionMode | null
  /** エージェント CLI 方式の送信(useAgentPromptSender.send)。ファイル内容は添付しない(C2) */
  sendToAgent: (text: string) => Promise<unknown>
}

interface PromptRunner {
  runPrompt: (content: string, toolId: PromptToolId, prompt: Prompt) => Promise<void>
  rerunHistoryEntry: (entry: HistoryEntry) => Promise<void>
}

export function usePromptRunner({
  openFile,
  executePrompt,
  addHistoryEntry,
  executionMode,
  sendToAgent
}: Deps): PromptRunner {
  const run = useCallback(
    (
      content: string,
      fileContent: string | null,
      toolId: PromptToolId,
      context: ExecutionContext
    ) => executePrompt(content, fileContent, toolId, context, addHistoryEntry),
    [executePrompt, addHistoryEntry]
  )

  // エージェント CLI 方式は起動中のセッションへ送る(履歴に記録しない。C11)。従来の方式は従来どおり
  const runPrompt = useCallback(
    async (content: string, toolId: PromptToolId, prompt: Prompt): Promise<void> => {
      if (executionMode === 'agent-cli') {
        await sendToAgent(content)
        return
      }
      if (executionMode !== 'legacy') return
      await run(content, openFile?.content ?? null, toolId, {
        promptId: prompt.id,
        promptTitle: prompt.title
      })
    },
    [run, openFile, executionMode, sendToAgent]
  )

  // 履歴からの再実行は「実行時のファイル内容スナップショット」をそのまま再現する
  // （現在開いているファイルではなく entry.fileContent を使う）。エージェント CLI 方式では再実行しない(ボタンも押せない)
  const rerunHistoryEntry = useCallback(
    async (entry: HistoryEntry): Promise<void> => {
      if (executionMode !== 'legacy') return
      await run(entry.promptContent, entry.fileContent, entry.toolId, {
        promptId: entry.promptId,
        promptTitle: entry.promptTitle
      })
    },
    [run, executionMode]
  )

  return { runPrompt, rerunHistoryEntry }
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useExecutionMode.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts
npx vitest run src/renderer 2>&1 | grep -E "Test Files|Tests |FAIL"
npx tsc --noEmit -p tsconfig.web.json --composite false 2>&1 | grep -v "useAppState.ts" | head
npx eslint src/renderer/src/lib/agentSendMessages.ts src/renderer/src/hooks/useAgentPromptSender.ts src/renderer/src/hooks/useExecutionMode.ts src/renderer/src/hooks/usePromptRunner.ts src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useExecutionMode.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts
npx prettier --check src/renderer/src/lib/agentSendMessages.ts src/renderer/src/hooks/useAgentPromptSender.ts src/renderer/src/hooks/useExecutionMode.ts src/renderer/src/hooks/usePromptRunner.ts src/renderer/src/lib/__tests__/agentSendMessages.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/hooks/__tests__/useExecutionMode.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts
```

Expected: PASS（11 + 4 + 4 + 6 件）。renderer の全体も通る（`useAppState` は `usePromptRunner` を差し替えている。App の画面のテストはプロンプトを実行しない。Task 23 までの間は、実機の実行ボタンは何もしない）。web の typecheck は `useAppState.ts` の `usePromptRunner` の呼び出し（新しい依存が足りない）だけがエラーになる（Task 23 で直す）。それ以外のエラーが無いこと

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                       | テストのファイル               | `-t`                                  | 確認           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------- | -------------- |
| Z1  | `useAgentPromptSender.ts` の `if (sendingRef.current) return undefined` を消す                                                             | `useAgentPromptSender.test.ts` | `送信中の 2 回目の send は何もしない` | 落ちた（1 件） |
| Z2  | `useAgentPromptSender.ts` の `controller.endSending()` を消す                                                                              | `useAgentPromptSender.test.ts` | `送らなかったときも入力の保留を解く`  | 落ちた（1 件） |
| Z3  | `useExecutionMode.ts` の `modeRef.current = previous ⏎ setMode(previous)` を `modeRef.current = previous` にする                           | `useExecutionMode.test.ts`     | `保存に失敗したら`                    | 落ちた（1 件） |
| Z4  | `agentSendMessages.ts` の `if (params.isSending) return { disabled: true, reason: RUN_DISABLED_SENDING }` を消す                           | `agentSendMessages.test.ts`    | `エージェント・送信中`                | 落ちた（1 件） |
| Z5  | `usePromptRunner.ts` の `if (executionMode === 'agent-cli') {` を `if (false) {` にする                                                    | `usePromptRunner.test.ts`      | `本文だけをエージェントへ送り`        | 落ちた（1 件） |
| Z6  | `usePromptRunner.ts` の `if (executionMode !== 'legacy') return ⏎ await run(entry.promptContent` を `await run(entry.promptContent` にする | `usePromptRunner.test.ts`      | `履歴の再実行をしない`                | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/renderer
```

---

### Task 21: renderer: ターミナルパネルと配置（`AgentTerminalPanel`・`AgentTerminalView`・`EditorPanel`）

**Files:**

- Create: `src/renderer/src/components/agent/AgentTerminalView.tsx`、`src/renderer/src/components/agent/AgentTerminalPanel.tsx`、`src/renderer/src/components/agent/__tests__/AgentTerminalView.test.tsx`、`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`、`src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx`
- Modify: `src/renderer/src/components/EditorPanel.tsx`（下部のパネルの出し分け・最大化の間はタブと本文を隠す・外部変更の通知。新しい props は省略できる）、`src/renderer/src/assets/main.css`

**Interfaces:**

- Consumes: `AgentTerminalController`・`makeFakeController`（Task 16）、`isInsideAgentTerminal`（Task 15）、`agentTerminalApi.setAgentTerminalFocused`（Task 12）、`describeAgentStatus`・`AgentSessionState`・`AgentTerminalPanelLayout`・`makeAgentSessionState`（Task 19）、`ExternalChangeBanner`・`ExternalChangeBannerState`（Task 18）
- Produces: `interface AgentTerminalPanelState { controller; session: AgentSessionState; layout: AgentTerminalPanelLayout }`、`AgentTerminalPanel`（props `{ state }`）、`AgentTerminalView`（props `{ controller; isVisible; onFocusOut }`）、`EditorPanel` の新しい props `bottomPanel?: 'output' | 'agent-terminal' | 'none'`（既定 `'output'`）・`agentTerminal?: AgentTerminalPanelState`・`externalChangeBanner?: ExternalChangeBannerState | null`
- 注: 設計書「配置の案」A・「キーバインドとフォーカス」。帯の高さ 32px、ボタンは共通の枠付きボタンの規則（32px 以上）。閉じても xterm を取り外さず `hidden` で隠す（`.agent-terminal-panel__body[hidden] { display: none }`）。表示し直したとき・大きさが変わったとき（`ResizeObserver`。jsdom には無いので無ければ飛ばす）に `fit`。ターミナルの領域に `data-agent-terminal`・`role="group"`・`aria-label="エージェントのターミナル"`。フォーカスの出入りを main へ知らせる（領域の中の移動では外れたとみなさない）。閉じる・最大化を戻すときに、フォーカスがターミナルの中なら開閉のボタンへ移す（パターン 86）。F6 の抜け先も開閉のボタン。`F6 でターミナルから抜けます` は視覚的には隠し、`aria-describedby` で読ませる。最大化の間は `.editor-panel__main`（タブと本文の新しい入れ物）を `hidden` にする（Monaco は `automaticLayout` で戻したときに合わせ直す）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/agent/__tests__/AgentTerminalView.test.tsx`（新規）:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AgentTerminalView from '../AgentTerminalView'
import { makeFakeController } from '../../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../../__tests__/makeFakeAgentTerminal'
import { isInsideAgentTerminal } from '../../../lib/agentTerminalKeys'

let controller: FakeController

beforeEach(() => {
  controller = makeFakeController()
  window.api.setAgentTerminalFocused = vi.fn()
})

describe('AgentTerminalView', () => {
  it('ターミナルの目印と名前を付け、controller に取り付ける', () => {
    render(<AgentTerminalView controller={controller} isVisible onFocusOut={vi.fn()} />)
    const area = screen.getByRole('group', { name: 'エージェントのターミナル' })
    expect(isInsideAgentTerminal(area)).toBe(true)
    expect(controller.attach).toHaveBeenCalledWith(area)
  })

  it('StrictMode の二重マウントでも、最後は取り付けた状態になる', () => {
    render(
      <StrictMode>
        <AgentTerminalView controller={controller} isVisible onFocusOut={vi.fn()} />
      </StrictMode>
    )
    expect(controller.attach.mock.calls.length - controller.detach.mock.calls.length).toBe(1)
  })

  it('表示されているときに fit し、隠れているときは fit しない', () => {
    const { rerender } = render(
      <AgentTerminalView controller={controller} isVisible={false} onFocusOut={vi.fn()} />
    )
    expect(controller.fit).not.toHaveBeenCalled()
    rerender(<AgentTerminalView controller={controller} isVisible onFocusOut={vi.fn()} />)
    expect(controller.fit).toHaveBeenCalled()
  })

  it('アンマウントで取り外し、F6 の抜け先を外す', () => {
    const { unmount } = render(
      <AgentTerminalView controller={controller} isVisible onFocusOut={vi.fn()} />
    )
    unmount()
    expect(controller.detach).toHaveBeenCalled()
    expect(controller.setFocusOutHandler).toHaveBeenLastCalledWith(null)
  })

  it('フォーカスの出入りを main へ知らせる(領域の中の移動では外れたとみなさない)', () => {
    render(<AgentTerminalView controller={controller} isVisible onFocusOut={vi.fn()} />)
    const area = screen.getByRole('group', { name: 'エージェントのターミナル' })
    const a = document.createElement('textarea')
    const b = document.createElement('textarea')
    area.append(a, b)
    fireEvent.focus(a)
    fireEvent.blur(a, { relatedTarget: b })
    fireEvent.blur(b, { relatedTarget: document.body })
    expect(vi.mocked(window.api.setAgentTerminalFocused).mock.calls).toEqual([[true], [false]])
  })
})
```

`src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx`（新規）:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AgentTerminalPanel from '../AgentTerminalPanel'
import type { AgentTerminalPanelState } from '../AgentTerminalPanel'
import { makeFakeController } from '../../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../../__tests__/makeFakeAgentTerminal'
import { makeAgentSessionState } from '../../../__tests__/makeAgentSessionState'
import type { AgentTerminalPanelLayout } from '../../../hooks/useAgentTerminalPanel'

let controller: FakeController

function makeLayout(overrides: Partial<AgentTerminalPanelLayout> = {}): AgentTerminalPanelLayout {
  return {
    isOpen: true,
    isMaximized: false,
    open: vi.fn(),
    toggleOpen: vi.fn(),
    toggleMaximized: vi.fn(),
    ...overrides
  }
}

function renderPanel(overrides: Partial<AgentTerminalPanelState> = {}): AgentTerminalPanelState {
  const state: AgentTerminalPanelState = {
    controller,
    session: makeAgentSessionState(),
    layout: makeLayout(),
    ...overrides
  }
  render(<AgentTerminalPanel state={state} />)
  return state
}

beforeEach(() => {
  controller = makeFakeController()
})

describe('AgentTerminalPanel', () => {
  it('見出し・状態(未起動)・起動・最大化を出し、開閉のボタンが本文を参照する', () => {
    renderPanel()
    const toggle = screen.getByRole('button', { name: /エージェント/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(body).not.toBeNull()
    expect(screen.getByText('未起動')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^起動/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: '最大化' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('開閉のボタンは F6 の案内を aria-describedby で参照する', () => {
    renderPanel()
    const toggle = screen.getByRole('button', { name: /エージェント/ })
    expect(
      document.getElementById(toggle.getAttribute('aria-describedby') ?? '')
    ).toHaveTextContent('F6 でターミナルから抜けます')
  })

  it('フォルダが無ければ起動を押せず、理由を出して参照する', () => {
    renderPanel({
      session: makeAgentSessionState({ startDisabledReason: 'フォルダを開いてください' })
    })
    const start = screen.getByRole('button', { name: /^起動/ })
    expect(start).toBeDisabled()
    expect(document.getElementById(start.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      'フォルダを開いてください'
    )
  })

  it('起動を押すと start を呼ぶ', async () => {
    const state = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /^起動/ }))
    expect(state.session.start).toHaveBeenCalledOnce()
  })

  it('起動中は終了を出し、押すと確認なしで stop を呼ぶ', async () => {
    const state = renderPanel({
      session: makeAgentSessionState({ status: 'running', sessionId: 's1' })
    })
    expect(screen.getByText('起動中')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^終了/ }))
    expect(state.session.stop).toHaveBeenCalledOnce()
  })

  it('終了した後は終了コードを出し、起動を出す', () => {
    renderPanel({
      session: makeAgentSessionState({ status: 'exited', exit: { exitCode: 1, reason: 'exited' } })
    })
    expect(screen.getByText('終了しました（終了コード 1）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^起動/ })).toBeEnabled()
  })

  it('起動の失敗を role="alert" で出す', () => {
    renderPanel({ session: makeAgentSessionState({ error: 'claude コマンドが見つかりません。' }) })
    expect(screen.getByRole('alert')).toHaveTextContent('claude コマンドが見つかりません。')
  })

  it('閉じているときは本文を隠す(xterm は取り外さない)', () => {
    renderPanel({ layout: makeLayout({ isOpen: false }) })
    const toggle = screen.getByRole('button', { name: /エージェント/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).not.toBeVisible()
    expect(controller.detach).not.toHaveBeenCalled()
  })

  it('ターミナルにフォーカスがあるときに閉じると、開閉のボタンへフォーカスを移す', async () => {
    const state = renderPanel()
    const terminalArea = screen.getByRole('group', { name: 'エージェントのターミナル' })
    const inner = document.createElement('textarea')
    terminalArea.appendChild(inner)
    inner.focus()
    fireEvent.click(screen.getByRole('button', { name: /エージェント/ }))
    expect(screen.getByRole('button', { name: /エージェント/ })).toHaveFocus()
    expect(state.layout.toggleOpen).toHaveBeenCalledOnce()
  })

  it('最大化を戻すときも、ターミナルの中のフォーカスを開閉のボタンへ移す', () => {
    const state = renderPanel({ layout: makeLayout({ isMaximized: true }) })
    const terminalArea = screen.getByRole('group', { name: 'エージェントのターミナル' })
    const inner = document.createElement('textarea')
    terminalArea.appendChild(inner)
    inner.focus()
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    expect(screen.getByRole('button', { name: /エージェント/ })).toHaveFocus()
    expect(state.layout.toggleMaximized).toHaveBeenCalledOnce()
  })

  it('F6 の抜け先として、開閉のボタンへフォーカスを移す関数を controller に渡す', () => {
    renderPanel()
    const handler = controller.setFocusOutHandler.mock.calls.at(-1)?.[0]
    handler?.()
    expect(screen.getByRole('button', { name: /エージェント/ })).toHaveFocus()
  })
})
```

`src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx`（新規）:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { OpenedFileEvent } from '../../hooks/useFileSystem'
import type { OpenFile } from '../../types'
import type { DiffTabKey } from '../../hooks/useDiffTabs'
import EditorPanel from '../EditorPanel'
import { makeConflictFileState } from '../../__tests__/makeConflictFileState'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import { makeAgentSessionState } from '../../__tests__/makeAgentSessionState'
import type { AgentTerminalPanelState } from '../agent/AgentTerminalPanel'

const file: OpenFile = {
  path: '/p/a.ts',
  name: 'a.ts',
  content: 'x',
  savedContent: 'x',
  language: 'typescript'
}

const baseProps = {
  openFiles: [file],
  activeFilePath: file.path,
  isDirty: false,
  isSaving: false,
  saveError: null as Error | null,
  onChangeContent: vi.fn(),
  onSave: vi.fn(),
  onActivateTab: vi.fn().mockReturnValue(true),
  onCloseTab: vi.fn(),
  onReorderTabs: vi.fn(),
  isExecuting: false,
  result: 'result text' as string | null,
  streamingText: '',
  executionError: null as Error | null,
  onClearResult: vi.fn(),
  onCancelExecution: vi.fn(),
  isOverlayOpen: false,
  openedFileSignal: { events: [] as OpenedFileEvent[] },
  diffTabs: [] as DiffTabKey[],
  activeDiffTab: null as DiffTabKey | null,
  onActivateDiffTab: vi.fn(),
  onCloseDiffTab: vi.fn(),
  onDeactivateDiffTab: vi.fn(),
  diffContent: null as string | null,
  diffStaged: false,
  diffError: null as Error | null,
  isHunkOperationInProgress: false,
  onStageHunk: vi.fn(),
  onUnstageHunk: vi.fn(),
  onDiscardHunk: vi.fn(),
  canDiscardHunk: false,
  isActiveFileUntracked: false,
  isActiveFileConflicted: false,
  conflictFile: makeConflictFileState(),
  isConflictBlocked: false
}

function makeAgentTerminal(isMaximized = false): AgentTerminalPanelState {
  return {
    controller: makeFakeController(),
    session: makeAgentSessionState(),
    layout: {
      isOpen: true,
      isMaximized,
      open: vi.fn(),
      toggleOpen: vi.fn(),
      toggleMaximized: vi.fn()
    }
  }
}

describe('EditorPanel: 下部のパネル', () => {
  it('既定(output)では出力パネルを出し、ターミナルパネルを出さない', () => {
    const { container } = render(<EditorPanel {...baseProps} />)
    expect(container.querySelector('.editor-panel__main')).toBeVisible()
    expect(screen.getByText('result text')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'エージェント' })).toBeNull()
  })

  it('agent-terminal ではターミナルパネルを出し、出力パネルを出さない', () => {
    render(
      <EditorPanel
        {...baseProps}
        bottomPanel="agent-terminal"
        agentTerminal={makeAgentTerminal()}
      />
    )
    expect(screen.getByRole('region', { name: 'エージェント' })).toBeInTheDocument()
    expect(screen.queryByText('result text')).toBeNull()
  })

  it('none では下部に何も出さない(実行方式の読み込み中)', () => {
    render(<EditorPanel {...baseProps} bottomPanel="none" agentTerminal={makeAgentTerminal()} />)
    expect(screen.queryByRole('region', { name: 'エージェント' })).toBeNull()
    expect(screen.queryByText('result text')).toBeNull()
  })

  it('ターミナルパネルの最大化の間は、タブと本文を隠す', () => {
    const { container } = render(
      <EditorPanel
        {...baseProps}
        bottomPanel="agent-terminal"
        agentTerminal={makeAgentTerminal(true)}
      />
    )
    expect(container.querySelector('.editor-panel__main')).not.toBeVisible()
    expect(screen.getByRole('region', { name: 'エージェント' })).toBeVisible()
  })

  it('外部変更の通知があれば、タブの下に出す', () => {
    render(
      <EditorPanel
        {...baseProps}
        externalChangeBanner={{
          path: file.path,
          kind: 'modified',
          reload: vi.fn(),
          dismiss: vi.fn()
        }}
      />
    )
    expect(
      screen.getByText('ディスク上のファイルが変更されました（エージェントなどによる変更）。')
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/renderer/src/components/agent src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx
```

Expected: FAIL（`../AgentTerminalView`・`../AgentTerminalPanel` が無い。`EditorPanel` はターミナルパネル・`.editor-panel__main` が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/components/agent/AgentTerminalView.tsx`（新規）:

```tsx
'use client'
import { useEffect, useRef } from 'react'
import type { AgentTerminalController } from '../../lib/agentTerminalController'
import * as agentTerminalApi from '../../lib/agentTerminalApi'

interface Props {
  controller: AgentTerminalController
  /** パネルが開いているか。表示し直したとき・大きさが変わったときに fit する */
  isVisible: boolean
  /** F6 でターミナルから抜けるときの移動先へフォーカスを移す */
  onFocusOut: () => void
}

// xterm の表示の領域。xterm は controller が持ち、ここは取り付け・取り外しと fit の契機だけを受け持つ
export default function AgentTerminalView({
  controller,
  isVisible,
  onFocusOut
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    controller.attach(container)
    return () => controller.detach(container)
  }, [controller])

  useEffect(() => {
    controller.setFocusOutHandler(onFocusOut)
    return () => controller.setFocusOutHandler(null)
  }, [controller, onFocusOut])

  useEffect(() => {
    const container = containerRef.current
    if (!isVisible || container === null) return
    controller.fit()
    // jsdom には ResizeObserver が無い(テストでは fit の呼び出しだけを確かめる)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => controller.fit())
    observer.observe(container)
    return () => observer.disconnect()
  }, [controller, isVisible])

  // Windows・Linux でメニューのショートカットを止める・戻す(main が判断する)
  const handleFocus = (): void => agentTerminalApi.setAgentTerminalFocused(true)
  const handleBlur = (event: React.FocusEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    agentTerminalApi.setAgentTerminalFocused(false)
  }

  return (
    <div
      ref={containerRef}
      className="agent-terminal-view"
      // ターミナルの中のキーを document のハンドラが除外する目印(lib/agentTerminalKeys の AGENT_TERMINAL_ATTRIBUTE)
      data-agent-terminal=""
      role="group"
      aria-label="エージェントのターミナル"
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  )
}
```

`src/renderer/src/components/agent/AgentTerminalPanel.tsx`（新規）:

```tsx
'use client'
import { useCallback, useId, useRef } from 'react'
import type { AgentTerminalController } from '../../lib/agentTerminalController'
import { isInsideAgentTerminal } from '../../lib/agentTerminalKeys'
import { describeAgentStatus } from '../../lib/agentSessionMessages'
import type { AgentSessionState } from '../../hooks/useAgentSession'
import type { AgentTerminalPanelLayout } from '../../hooks/useAgentTerminalPanel'
import AgentTerminalView from './AgentTerminalView'

export interface AgentTerminalPanelState {
  controller: AgentTerminalController
  session: AgentSessionState
  layout: AgentTerminalPanelLayout
}

interface Props {
  state: AgentTerminalPanelState
}

// エディタの領域の下部のターミナルパネル(設計書「配置の案」A)。見出しの帯(開閉・状態・起動/終了・最大化)と xterm の表示の領域。
// 閉じても xterm とセッションは破棄せず、表示だけを隠す(出力は裏で受け取り続ける)
export default function AgentTerminalPanel({ state }: Props): React.JSX.Element {
  const { controller, session, layout } = state
  const bodyId = useId()
  const hintId = useId()
  const reasonId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)

  // 消える要素にフォーカスを残さない(パターン 86)
  const moveFocusOutOfTerminal = (): void => {
    if (isInsideAgentTerminal(document.activeElement)) toggleRef.current?.focus()
  }
  const focusToggle = useCallback(() => toggleRef.current?.focus(), [])

  const isActive = session.status === 'starting' || session.status === 'running'
  const startDisabled = session.startDisabledReason !== null || session.status === 'starting'

  return (
    <section
      className={[
        'agent-terminal-panel',
        layout.isOpen ? 'agent-terminal-panel--open' : 'agent-terminal-panel--closed',
        layout.isMaximized ? 'agent-terminal-panel--maximized' : ''
      ]
        .filter((name) => name !== '')
        .join(' ')}
      aria-label="エージェント"
    >
      <div className="agent-terminal-panel__header">
        <button
          ref={toggleRef}
          type="button"
          className="agent-terminal-panel__toggle"
          aria-expanded={layout.isOpen}
          aria-controls={bodyId}
          aria-describedby={hintId}
          onClick={() => {
            if (layout.isOpen) moveFocusOutOfTerminal()
            layout.toggleOpen()
          }}
        >
          <span aria-hidden="true">{layout.isOpen ? '▾' : '▸'}</span> エージェント
        </button>
        <span id={hintId} className="agent-terminal-panel__hint">
          F6 でターミナルから抜けます
        </span>
        <span className="agent-terminal-panel__status">
          {describeAgentStatus(session.status, session.exit)}
        </span>
        <span className="agent-terminal-panel__actions">
          {session.startDisabledReason !== null && !isActive && (
            <span id={reasonId} className="agent-terminal-panel__reason">
              {session.startDisabledReason}
            </span>
          )}
          {isActive ? (
            <button
              type="button"
              className="agent-terminal-panel__button"
              aria-label="終了（エージェントを止める）"
              disabled={session.status === 'starting'}
              onClick={() => void session.stop()}
            >
              終了
            </button>
          ) : (
            <button
              type="button"
              className="agent-terminal-panel__button"
              aria-label="起動（開いているフォルダで claude を起動）"
              disabled={startDisabled}
              aria-describedby={session.startDisabledReason !== null ? reasonId : undefined}
              title={session.startDisabledReason ?? undefined}
              onClick={() => void session.start()}
            >
              起動
            </button>
          )}
          <button
            type="button"
            className="agent-terminal-panel__button"
            aria-pressed={layout.isMaximized}
            onClick={() => {
              if (layout.isMaximized) moveFocusOutOfTerminal()
              layout.toggleMaximized()
            }}
          >
            {layout.isMaximized ? '元に戻す' : '最大化'}
          </button>
        </span>
      </div>
      {session.error !== null && (
        <p className="agent-terminal-panel__error" role="alert">
          {session.error}
        </p>
      )}
      <div id={bodyId} className="agent-terminal-panel__body" hidden={!layout.isOpen}>
        <AgentTerminalView
          controller={controller}
          isVisible={layout.isOpen}
          onFocusOut={focusToggle}
        />
      </div>
    </section>
  )
}
```

`src/renderer/src/components/EditorPanel.tsx`（差分。prettier で既存の行の字下げが 1 段深くなる）:

```diff
--- a/src/renderer/src/components/EditorPanel.tsx
+++ b/src/renderer/src/components/EditorPanel.tsx
@@ -14,6 +14,10 @@
 import DiffView from './source-control/DiffView'
 import ConflictResolver from './source-control/ConflictResolver'
 import type { ConflictFileState } from '../hooks/useConflictFile'
+import AgentTerminalPanel from './agent/AgentTerminalPanel'
+import type { AgentTerminalPanelState } from './agent/AgentTerminalPanel'
+import ExternalChangeBanner from './editor/ExternalChangeBanner'
+import type { ExternalChangeBannerState } from '../hooks/useExternalFileChanges'

 interface Props {
   openFiles: OpenFile[]
@@ -66,6 +70,15 @@
   conflictFile: ConflictFileState
   /** 他の操作中(ロック中)か。解決ビューの全ボタンを無効化する(ハンク操作の isHunkOperationInProgress と同じ扱い) */
   isConflictBlocked: boolean
+  /**
+   * 下部に置くパネル。output: 出力パネル(従来の方式)、agent-terminal: ターミナルパネル(エージェント CLI 方式)、
+   * none: 何も置かない(実行方式の読み込み中)。省略時は output
+   */
+  bottomPanel?: 'output' | 'agent-terminal' | 'none'
+  /** bottomPanel が agent-terminal のときのターミナルパネルの状態 */
+  agentTerminal?: AgentTerminalPanelState
+  /** 編集中のタブのファイルがディスク上で変わったときの通知(useExternalFileChanges)。無ければ null */
+  externalChangeBanner?: ExternalChangeBannerState | null
 }

 export default function EditorPanel({
@@ -103,7 +116,10 @@
   isActiveFileUntracked,
   isActiveFileConflicted,
   conflictFile,
-  isConflictBlocked
+  isConflictBlocked,
+  bottomPanel = 'output',
+  agentTerminal,
+  externalChangeBanner = null
 }: Props): React.JSX.Element {
   const openFile = openFiles.find((f) => f.path === activeFilePath) ?? null
   // Monaco の onMount はファイル切替時の再マウント以外では再発火しないため、
@@ -132,91 +148,103 @@
     onDeactivateDiffTab
   })

+  const showAgentTerminal = bottomPanel === 'agent-terminal' && agentTerminal !== undefined
+  // ターミナルパネルの最大化の間は、タブと本文を隠してパネルが全体を使う(Monaco は automaticLayout で戻したときに合わせ直す)
+  const isAgentMaximized = showAgentTerminal && agentTerminal.layout.isMaximized
+
   return (
     <div className="editor-panel">
-      {/* diffTabs に非アクティブな diff タブが残っている場合、WelcomeView に
+      <div className="editor-panel__main" hidden={isAgentMaximized}>
+        {/* diffTabs に非アクティブな diff タブが残っている場合、WelcomeView に
           切り替えるとタブバーごと消えてそれらのタブへ二度とアクセスできなくなる */}
-      {openFile === null && activeDiffTab === null && diffTabs.length === 0 ? (
-        <WelcomeView />
-      ) : (
-        <>
-          <EditorTabs
-            tabs={combinedTabs}
-            activePath={activeTabPath}
-            saveTargetPath={activeFilePath}
-            isSaving={isSaving}
-            saveError={saveError}
-            onSave={onSave}
-            onActivateTab={handleActivateTab}
-            onCloseTab={handleCloseTab}
-            onReorderTabs={onReorderTabs}
-          />
-          {/* 既知の挙動: diff タブをアクティブにすると下の <Editor> がアンマウントされ、
+        {openFile === null && activeDiffTab === null && diffTabs.length === 0 ? (
+          <WelcomeView />
+        ) : (
+          <>
+            <EditorTabs
+              tabs={combinedTabs}
+              activePath={activeTabPath}
+              saveTargetPath={activeFilePath}
+              isSaving={isSaving}
+              saveError={saveError}
+              onSave={onSave}
+              onActivateTab={handleActivateTab}
+              onCloseTab={handleCloseTab}
+              onReorderTabs={onReorderTabs}
+            />
+            {externalChangeBanner !== null && (
+              <ExternalChangeBanner banner={externalChangeBanner} />
+            )}
+            {/* 既知の挙動: diff タブをアクティブにすると下の <Editor> がアンマウントされ、
               Monaco のモデルが破棄されるため、実ファイルタブへ戻したときに undo/redo
               スタック・カーソル位置・スクロール位置が失われる(バッファの内容自体は
               openFile.content に保持されるので失われない)。常時マウントして
               display:none で切り替える方法はあるが、Monaco は非表示状態だと
               レイアウト計算が狂うため復帰時の layout() 呼び出しが必要になり、
               jsdom ベースのテストでは検証できない副作用を抱え込むことになる */}
-          <div className="editor-body">
-            {activeDiffTab !== null && isActiveFileConflicted ? (
-              // 未解決の間は結合 diff ではなく解決ビュー(内容は main から読み直す。diff の取得は待たない)
-              <ConflictResolver conflict={conflictFile} isBlocked={isConflictBlocked} />
-            ) : activeDiffTab !== null ? (
-              <>
-                {diffError !== null && <p className="diff-view__error">{diffError.message}</p>}
-                {diffContent === null && diffError === null && (
-                  <p className="diff-view__loading">読み込み中...</p>
-                )}
-                {diffContent !== null && (
-                  <DiffView
-                    diffText={diffContent}
-                    staged={diffStaged}
-                    onStageHunk={onStageHunk}
-                    onUnstageHunk={onUnstageHunk}
-                    disabled={isHunkOperationInProgress}
-                    isUntracked={isActiveFileUntracked}
-                    onDiscardHunk={onDiscardHunk}
-                    canDiscardHunk={canDiscardHunk}
-                  />
-                )}
-              </>
-            ) : openFile !== null ? (
-              <Editor
-                key={openFile.path}
-                height="100%"
-                language={openFile.language}
-                theme="vs-dark"
-                value={openFile.content}
-                options={editorOptions}
-                onChange={(value) => onChangeContent(value ?? '')}
-                onMount={(editorInstance, monaco) => {
-                  const isCurrent = handleEditorMount(editorInstance, openFile.path)
-                  if (!isCurrent) return
-                  attachEditor(editorInstance)
-                  registerSaveCommand(editorInstance, monaco, () => onSaveRef.current())
-                  focusEditorIfPending()
-                }}
-              />
-            ) : (
-              // 非アクティブな diff タブが残っているだけ(実ファイルタブも
-              // アクティブな diff タブも無い)場合、ここに来る。タブバーは表示
-              // されているので、何も描画しないと本文だけが空白のまま残り、
-              // ユーザーがタブを選び直すまで理由が分からない状態になる
-              <p className="editor-panel__placeholder">タブを選択してください</p>
-            )}
-          </div>
-        </>
+            <div className="editor-body">
+              {activeDiffTab !== null && isActiveFileConflicted ? (
+                // 未解決の間は結合 diff ではなく解決ビュー(内容は main から読み直す。diff の取得は待たない)
+                <ConflictResolver conflict={conflictFile} isBlocked={isConflictBlocked} />
+              ) : activeDiffTab !== null ? (
+                <>
+                  {diffError !== null && <p className="diff-view__error">{diffError.message}</p>}
+                  {diffContent === null && diffError === null && (
+                    <p className="diff-view__loading">読み込み中...</p>
+                  )}
+                  {diffContent !== null && (
+                    <DiffView
+                      diffText={diffContent}
+                      staged={diffStaged}
+                      onStageHunk={onStageHunk}
+                      onUnstageHunk={onUnstageHunk}
+                      disabled={isHunkOperationInProgress}
+                      isUntracked={isActiveFileUntracked}
+                      onDiscardHunk={onDiscardHunk}
+                      canDiscardHunk={canDiscardHunk}
+                    />
+                  )}
+                </>
+              ) : openFile !== null ? (
+                <Editor
+                  key={openFile.path}
+                  height="100%"
+                  language={openFile.language}
+                  theme="vs-dark"
+                  value={openFile.content}
+                  options={editorOptions}
+                  onChange={(value) => onChangeContent(value ?? '')}
+                  onMount={(editorInstance, monaco) => {
+                    const isCurrent = handleEditorMount(editorInstance, openFile.path)
+                    if (!isCurrent) return
+                    attachEditor(editorInstance)
+                    registerSaveCommand(editorInstance, monaco, () => onSaveRef.current())
+                    focusEditorIfPending()
+                  }}
+                />
+              ) : (
+                // 非アクティブな diff タブが残っているだけ(実ファイルタブも
+                // アクティブな diff タブも無い)場合、ここに来る。タブバーは表示
+                // されているので、何も描画しないと本文だけが空白のまま残り、
+                // ユーザーがタブを選び直すまで理由が分からない状態になる
+                <p className="editor-panel__placeholder">タブを選択してください</p>
+              )}
+            </div>
+          </>
+        )}
+      </div>
+      {bottomPanel === 'output' && (
+        <OutputPanel
+          isExecuting={isExecuting}
+          result={result}
+          streamingText={streamingText}
+          executionError={executionError}
+          onClear={onClearResult}
+          onCancel={onCancelExecution}
+          applyOutput={applyOutput}
+        />
       )}
-      <OutputPanel
-        isExecuting={isExecuting}
-        result={result}
-        streamingText={streamingText}
-        executionError={executionError}
-        onClear={onClearResult}
-        onCancel={onCancelExecution}
-        applyOutput={applyOutput}
-      />
+      {showAgentTerminal && <AgentTerminalPanel state={agentTerminal} />}
     </div>
   )
 }
```

`src/renderer/src/assets/main.css`: 共通の枠付きボタンの規則のセレクタの並び（Task 18 で `.external-change-banner__button` を足した並び）に、`.agent-terminal-panel__toggle`・`.agent-terminal-panel__button` を `.external-change-banner__button` の**前**に足す（`:hover:not(:disabled)` の並びも同じ）。無効時の共通の見た目の並び（`.create-tag-dialog__kind:disabled,` の次）に `.agent-terminal-panel__button:disabled,` を足す:

```diff
 .code-block__button,
 .create-tag-dialog__kind,
+.agent-terminal-panel__toggle,
+.agent-terminal-panel__button,
 .external-change-banner__button {
```

```diff
 .create-tag-dialog__kind:hover:not(:disabled),
+.agent-terminal-panel__toggle:hover:not(:disabled),
+.agent-terminal-panel__button:hover:not(:disabled),
 .external-change-banner__button:hover:not(:disabled) {
```

```diff
 .create-tag-dialog__kind:disabled,
+.agent-terminal-panel__button:disabled,
 .name-input-dialog__ok:disabled,
```

Task 18 で足した `/* ---- 外部変更の通知 … */` の規則の**前**に、次の規則を足す:

```css
/* ---- Editor Panel の本文(タブと本文。ターミナルパネルの最大化の間は隠す) ---- */

.editor-panel__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.editor-panel__main[hidden] {
  display: none;
}
```

Task 18 で足した外部変更の通知の規則の**後**（`/* ---- Output Panel ---- */` の直前）に、次の規則を足す:

```css
/* ---- エージェントのターミナルパネル(エディタの領域の下部。設計書「配置の案」A) ---- */

.agent-terminal-panel {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border-top: 1px solid #3c3c3c;
  background: #1e1e1e;
  min-height: 0;
}

/* 開いたときはエディタの領域の 45%(最小 160px)。閉じたときは見出しの帯だけ。最大化は全体 */
.agent-terminal-panel--open {
  flex: 0 0 45%;
  min-height: 160px;
}

.agent-terminal-panel--maximized {
  flex: 1 1 auto;
}

.agent-terminal-panel__header {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  min-height: 32px;
  padding: 0 8px;
  background: #2d2d2d;
  border-bottom: 1px solid #3c3c3c;
  flex-shrink: 0;
  overflow: hidden;
}

.agent-terminal-panel__toggle {
  border-color: transparent;
  font-weight: 600;
  white-space: nowrap;
}

.agent-terminal-panel__status {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #969696;
  font-size: 12px;
}

.agent-terminal-panel__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.agent-terminal-panel__reason {
  color: #969696;
  font-size: 12px;
  white-space: nowrap;
}

/* 視覚的には隠し、支援技術には読ませる(開閉のボタンの aria-describedby) */
.agent-terminal-panel__hint {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.agent-terminal-panel__error {
  margin: 0;
  padding: 4px 12px;
  color: #f48771;
  font-size: 12px;
  flex-shrink: 0;
}

.agent-terminal-panel__body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.agent-terminal-panel__body[hidden] {
  display: none;
}

.agent-terminal-view {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  padding: 4px 0 0 8px;
}

.agent-terminal-view__host {
  width: 100%;
  height: 100%;
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/renderer/src/components 2>&1 | grep -E "Test Files|Tests |FAIL"
npx tsc --noEmit -p tsconfig.web.json --composite false 2>&1 | grep -v "useAppState.ts" | head
npx eslint src/renderer/src/components/agent/AgentTerminalView.tsx src/renderer/src/components/agent/AgentTerminalPanel.tsx src/renderer/src/components/EditorPanel.tsx src/renderer/src/components/agent/__tests__/AgentTerminalView.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx
npx prettier --check src/renderer/src/components/agent/AgentTerminalView.tsx src/renderer/src/components/agent/AgentTerminalPanel.tsx src/renderer/src/components/EditorPanel.tsx src/renderer/src/components/agent/__tests__/AgentTerminalView.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx src/renderer/src/assets/main.css
```

Expected: components のテストがすべて PASS（新しい `AgentTerminalView` 5 件・`AgentTerminalPanel` 11 件・`EditorPanel.agentTerminal` 5 件。既存の `EditorPanel.test.tsx`・`EditorPanel.applyOutput.test.tsx` は変更なしで通る）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                              | テストのファイル                     | `-t`                                         | 確認           |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------- | -------------- |
| V1  | `AgentTerminalPanel.tsx` の `if (layout.isOpen) moveFocusOutOfTerminal()` を消す                                  | `AgentTerminalPanel.test.tsx`        | `ターミナルにフォーカスがあるときに閉じると` | 落ちた（1 件） |
| V2  | `AgentTerminalView.tsx` の `return () => controller.detach(container)` を消す                                     | `AgentTerminalView.test.tsx`         | `アンマウントで取り外し`                     | 落ちた（1 件） |
| V3  | `AgentTerminalView.tsx` の `if (event.currentTarget.contains(event.relatedTarget as Node \| null)) return` を消す | `AgentTerminalView.test.tsx`         | `フォーカスの出入り`                         | 落ちた（1 件） |
| V4  | `EditorPanel.tsx` の `hidden={isAgentMaximized}` を `hidden={false}` にする                                       | `EditorPanel.agentTerminal.test.tsx` | `最大化の間は`                               | 落ちた（1 件） |
| V5  | `EditorPanel.tsx` の `{bottomPanel === 'output' && (` を `{(` にする                                              | `EditorPanel.agentTerminal.test.tsx` | `agent-terminal ではターミナルパネルを出し`  | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/renderer
```

---

### Task 22: renderer: プロンプト・履歴・設定の出し分けと無効の理由

**Files:**

- Create: `src/renderer/src/components/settings/ExecutionModeSection.tsx`、`src/renderer/src/components/settings/__tests__/ExecutionModeSection.test.tsx`
- Modify: `src/renderer/src/types.ts`（末尾に `PromptRunPanelState`）、`src/renderer/src/components/prompts/PromptsPanel.tsx`・`PromptItem.tsx`・`PromptItemView.tsx`・`PromptVariablesForm.tsx`、`src/renderer/src/components/history/HistoryPanel.tsx`・`HistoryDetail.tsx`、`src/renderer/src/components/settings/SettingsPanel.tsx`、`src/renderer/src/components/Sidebar.tsx`、テスト `components/prompts/__tests__/PromptsPanel.test.tsx`・`components/history/__tests__/HistoryDetail.test.tsx`・`components/settings/__tests__/SettingsPanel.test.tsx`・`components/__tests__/Sidebar.test.tsx`（末尾に追加）、`src/renderer/src/assets/main.css`

**Interfaces:**

- Consumes: `PromptExecutionMode`（Task 2）、`Announcement`・`toAnnouncementText`（既存）
- Produces: `interface PromptRunPanelState { isRunDisabled; runDisabledReason; agentSend: { error; notice } | null; showToolSelector; runAriaLabel; isRerunDisabled; rerunDisabledReason }`（`types.ts`）、`ExecutionModeSection`（props `{ mode; saveError; isLocked; onSelect }`）、`PromptsPanel` の新しい props `runDisabledReason?`・`agentSend?`・`showToolSelector?`（既定 true）・`runAriaLabel?`、`PromptItem`・`PromptItemView` の `runDisabledReasonId?`・`runAriaLabel?`、`PromptVariablesForm` の `runDisabledReasonId?`、`HistoryPanel`・`HistoryDetail` の `rerunDisabledReason?`、`SettingsPanel` の `executionMode?: { mode; saveError; isLocked; onSelect }`、`Sidebar` の `promptRun?: PromptRunPanelState`・`executionMode?`（どちらも省略時は従来どおり）
- 注: C1（`aria-label` は `実行（エージェントに送信）`。従来の方式は `プロンプトを実行` のまま）・C3（ツールの選択を隠す）・C11（再実行の理由）・「実行方式の切り替え」の画面（最上部・radiogroup・`従来の方式で使います` の添え書き）。理由はプロンプトパネルの上部に 1 か所だけ表示し、押せないボタンだけが `aria-describedby` で参照する（パターン 126）。成功の通知の `role="status"` の要素は、エージェント CLI 方式の間は空でも置く（パターン 87。CSS で空のときは余白だけ消す）。変更する既存のコンポーネントの戻り値の型を足す（差異 21）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/settings/__tests__/ExecutionModeSection.test.tsx`（新規）:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ExecutionModeSection from '../ExecutionModeSection'

describe('ExecutionModeSection', () => {
  it('見出しを名前にした radiogroup に 2 つの radio を出し、選択中を aria-checked で示す', () => {
    render(
      <ExecutionModeSection mode="agent-cli" saveError={null} isLocked={false} onSelect={vi.fn()} />
    )
    const group = screen.getByRole('radiogroup', { name: 'プロンプトの実行方式' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^エージェント CLI/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: /^従来の方式/ })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('選ぶと onSelect を呼ぶ。選択中のものを押しても呼ばない', async () => {
    const onSelect = vi.fn()
    render(
      <ExecutionModeSection
        mode="agent-cli"
        saveError={null}
        isLocked={false}
        onSelect={onSelect}
      />
    )
    await userEvent.click(screen.getByRole('radio', { name: /^エージェント CLI/ }))
    await userEvent.click(screen.getByRole('radio', { name: /^従来の方式/ }))
    expect(onSelect.mock.calls).toEqual([['legacy']])
  })

  it('読み込み中は選べず、読み込み中と出す', () => {
    render(<ExecutionModeSection mode={null} saveError={null} isLocked onSelect={vi.fn()} />)
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('保存の失敗を role="alert" で出す', () => {
    render(
      <ExecutionModeSection
        mode="agent-cli"
        saveError="実行方式を保存できませんでした: x"
        isLocked={false}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('実行方式を保存できませんでした: x')
  })
})
```

既存のテスト（差分。末尾に追加）:

```diff
--- a/src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx
+++ b/src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx
@@ -18,7 +18,11 @@
     onDragEnd: (e: unknown) => void
   }) => {
     dndState.onDragEnd = onDragEnd
-    return <div data-testid="dnd-context" data-on-drag-end={String(!!onDragEnd)}>{children}</div>
+    return (
+      <div data-testid="dnd-context" data-on-drag-end={String(!!onDragEnd)}>
+        {children}
+      </div>
+    )
   },
   PointerSensor: class {},
   KeyboardSensor: class {},
@@ -61,14 +65,14 @@
   id: 'p1',
   title: 'テストタイトル',
   content: 'テスト内容',
-  createdAt: 1000000,
+  createdAt: 1000000
 }

 const anotherPrompt: Prompt = {
   id: 'p2',
   title: 'バグ修正',
   content: 'エラーログを確認して修正する',
-  createdAt: 2000000,
+  createdAt: 2000000
 }

 describe('PromptsPanel', () => {
@@ -164,10 +168,7 @@
   it('ツールセレクタで api に変更してから実行すると toolId が api で onRun に渡る', async () => {
     const onRun = vi.fn()
     render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} onRun={onRun} />)
-    await userEvent.selectOptions(
-      screen.getByRole('combobox', { name: '実行ツールを選択' }),
-      'api'
-    )
+    await userEvent.selectOptions(screen.getByRole('combobox', { name: '実行ツールを選択' }), 'api')
     await userEvent.click(screen.getByRole('button', { name: 'プロンプトを実行' }))
     expect(onRun).toHaveBeenCalledWith('テスト内容', 'api', samplePrompt)
   })
@@ -249,7 +250,13 @@
   describe('handleDragEnd → onReorder', () => {
     it('over が存在し active と異なる ID のとき onReorder が両 ID で呼ばれる', () => {
       const onReorder = vi.fn()
-      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} onReorder={onReorder} />)
+      render(
+        <PromptsPanel
+          {...defaultProps}
+          prompts={[samplePrompt, anotherPrompt]}
+          onReorder={onReorder}
+        />
+      )
       act(() => dndState.onDragEnd?.({ active: { id: 'p1' }, over: { id: 'p2' } }))
       expect(onReorder).toHaveBeenCalledWith('p1', 'p2')
       expect(onReorder).toHaveBeenCalledOnce()
@@ -257,14 +264,26 @@

     it('over が null のとき onReorder は呼ばれない（ドロップ先なし）', () => {
       const onReorder = vi.fn()
-      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} onReorder={onReorder} />)
+      render(
+        <PromptsPanel
+          {...defaultProps}
+          prompts={[samplePrompt, anotherPrompt]}
+          onReorder={onReorder}
+        />
+      )
       act(() => dndState.onDragEnd?.({ active: { id: 'p1' }, over: null }))
       expect(onReorder).not.toHaveBeenCalled()
     })

     it('active と over が同一 ID のとき onReorder は呼ばれない（順序不変）', () => {
       const onReorder = vi.fn()
-      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt, anotherPrompt]} onReorder={onReorder} />)
+      render(
+        <PromptsPanel
+          {...defaultProps}
+          prompts={[samplePrompt, anotherPrompt]}
+          onReorder={onReorder}
+        />
+      )
       act(() => dndState.onDragEnd?.({ active: { id: 'p1' }, over: { id: 'p1' } }))
       expect(onReorder).not.toHaveBeenCalled()
     })
@@ -283,7 +302,13 @@
       const onReorder = vi.fn()
       const pinnedPrompt = { ...anotherPrompt, pinned: true }
       // 表示順は [pinnedPrompt(p2), samplePrompt(p1)]
-      render(<PromptsPanel {...defaultProps} prompts={[samplePrompt, pinnedPrompt]} onReorder={onReorder} />)
+      render(
+        <PromptsPanel
+          {...defaultProps}
+          prompts={[samplePrompt, pinnedPrompt]}
+          onReorder={onReorder}
+        />
+      )
       // 非ピン p1 → ピン済み p2 の位置へドラッグ（境界をまたぐ）
       act(() => dndState.onDragEnd?.({ active: { id: 'p1' }, over: { id: 'p2' } }))
       expect(onReorder).not.toHaveBeenCalled()
@@ -341,20 +366,20 @@
       title: 'タグ付きA',
       content: 'コンテンツA',
       createdAt: 1000000,
-      tags: ['React', 'TypeScript'],
+      tags: ['React', 'TypeScript']
     }
     const otherTaggedPrompt: Prompt = {
       id: 'p2',
       title: 'タグ付きB',
       content: 'コンテンツB',
       createdAt: 2000000,
-      tags: ['Vue'],
+      tags: ['Vue']
     }
     const noTagPrompt: Prompt = {
       id: 'p3',
       title: 'タグなし',
       content: 'コンテンツC',
-      createdAt: 3000000,
+      createdAt: 3000000
     }

     it('タグを持つプロンプトがあるときタグフィルターバーが表示される', () => {
@@ -369,10 +394,7 @@

     it('タグをクリックすると該当タグを持つプロンプトだけが表示される', async () => {
       render(
-        <PromptsPanel
-          {...defaultProps}
-          prompts={[taggedPrompt, otherTaggedPrompt, noTagPrompt]}
-        />
+        <PromptsPanel {...defaultProps} prompts={[taggedPrompt, otherTaggedPrompt, noTagPrompt]} />
       )
       await userEvent.click(screen.getByRole('button', { name: 'React' }))
       expect(screen.getByText('タグ付きA')).toBeInTheDocument()
@@ -381,9 +403,7 @@
     })

     it('同じタグをもう一度クリックすると絞り込みが解除される', async () => {
-      render(
-        <PromptsPanel {...defaultProps} prompts={[taggedPrompt, noTagPrompt]} />
-      )
+      render(<PromptsPanel {...defaultProps} prompts={[taggedPrompt, noTagPrompt]} />)
       await userEvent.click(screen.getByRole('button', { name: 'React' }))
       expect(screen.queryByText('タグなし')).not.toBeInTheDocument()
       await userEvent.click(screen.getByRole('button', { name: 'React' }))
@@ -405,9 +425,7 @@
     })

     it('タグフィルターで 0 件になったとき no-results メッセージが表示される', async () => {
-      render(
-        <PromptsPanel {...defaultProps} prompts={[taggedPrompt, otherTaggedPrompt]} />
-      )
+      render(<PromptsPanel {...defaultProps} prompts={[taggedPrompt, otherTaggedPrompt]} />)
       // React のみ持つ taggedPrompt と Vue のみ持つ otherTaggedPrompt を AND 選択 → 0 件
       await userEvent.click(screen.getByRole('button', { name: 'React' }))
       await userEvent.click(screen.getByRole('button', { name: 'Vue' }))
@@ -437,3 +455,68 @@
     })
   })
 })
+
+describe('PromptsPanel: エージェント CLI 方式', () => {
+  it('押せない理由を上部に 1 か所だけ出し、無効の実行ボタンの aria-describedby から参照する', () => {
+    render(
+      <PromptsPanel
+        {...defaultProps}
+        prompts={[samplePrompt, anotherPrompt]}
+        isRunDisabled
+        runDisabledReason="エージェントが起動していません（ターミナルの「起動」を押してください）"
+        agentSend={{ error: null, notice: null }}
+        showToolSelector={false}
+        runAriaLabel="実行（エージェントに送信）"
+      />
+    )
+    expect(
+      screen.getAllByText('エージェントが起動していません（ターミナルの「起動」を押してください）')
+    ).toHaveLength(1)
+    const buttons = screen.getAllByRole('button', { name: '実行（エージェントに送信）' })
+    expect(buttons).toHaveLength(2)
+    for (const button of buttons) {
+      expect(button).toBeDisabled()
+      expect(
+        document.getElementById(button.getAttribute('aria-describedby') ?? '')
+      ).toHaveTextContent('エージェントが起動していません')
+    }
+  })
+
+  it('押せるときは aria-describedby を付けない', () => {
+    render(
+      <PromptsPanel
+        {...defaultProps}
+        prompts={[samplePrompt]}
+        runDisabledReason={null}
+        agentSend={{ error: null, notice: null }}
+      />
+    )
+    expect(screen.getByRole('button', { name: 'プロンプトを実行' })).not.toHaveAttribute(
+      'aria-describedby'
+    )
+  })
+
+  it('実行ツールの選択を隠せる', () => {
+    render(<PromptsPanel {...defaultProps} showToolSelector={false} />)
+    expect(screen.queryByRole('combobox', { name: '実行ツールを選択' })).toBeNull()
+  })
+
+  it('送信の失敗を role="alert" で、成功を role="status" で出す', () => {
+    render(
+      <PromptsPanel
+        {...defaultProps}
+        agentSend={{
+          error: '送信する内容がありません',
+          notice: { text: 'エージェントに送信しました', id: 1 }
+        }}
+      />
+    )
+    expect(screen.getByRole('alert')).toHaveTextContent('送信する内容がありません')
+    expect(screen.getByRole('status')).toHaveTextContent('エージェントに送信しました')
+  })
+
+  it('従来の方式(agentSend が null)では通知の領域を置かない', () => {
+    render(<PromptsPanel {...defaultProps} />)
+    expect(screen.queryByRole('status')).toBeNull()
+  })
+})
```

```diff
--- a/src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx
+++ b/src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx
@@ -85,3 +85,25 @@
     expect(container.querySelector('.history-detail__content')).toBeEmptyDOMElement()
   })
 })
+
+describe('HistoryDetail: 再実行を押せない理由', () => {
+  it('理由があれば表示し、無効の再実行ボタンの aria-describedby から参照する', () => {
+    render(
+      <HistoryDetail
+        {...defaultProps}
+        isRerunDisabled
+        rerunDisabledReason="エージェント CLI 方式では再実行できません（設定で従来の方式に切り替えると使えます）"
+      />
+    )
+    const rerun = screen.getByRole('button', { name: '再実行' })
+    expect(rerun).toBeDisabled()
+    expect(document.getElementById(rerun.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
+      'エージェント CLI 方式では再実行できません'
+    )
+  })
+
+  it('理由が無ければ表示しない(従来の方式の実行中)', () => {
+    render(<HistoryDetail {...defaultProps} isRerunDisabled />)
+    expect(screen.getByRole('button', { name: '再実行' })).not.toHaveAttribute('aria-describedby')
+  })
+})
```

```diff
--- a/src/renderer/src/components/settings/__tests__/SettingsPanel.test.tsx
+++ b/src/renderer/src/components/settings/__tests__/SettingsPanel.test.tsx
@@ -200,3 +200,28 @@
     })
   })
 })
+
+describe('SettingsPanel: 実行方式', () => {
+  it('最上部に実行方式を出し、選ぶと onSelect を呼ぶ', async () => {
+    const onSelect = vi.fn()
+    render(
+      <SettingsPanel
+        {...defaultProps}
+        executionMode={{ mode: 'agent-cli', saveError: null, isLocked: false, onSelect }}
+      />
+    )
+    expect(screen.getByRole('radiogroup', { name: 'プロンプトの実行方式' })).toBeInTheDocument()
+    await userEvent.click(screen.getByRole('radio', { name: /^従来の方式/ }))
+    expect(onSelect).toHaveBeenCalledWith('legacy')
+  })
+
+  it('API キーとモデルに「従来の方式で使います」を添える', () => {
+    render(<SettingsPanel {...defaultProps} />)
+    expect(screen.getAllByText('従来の方式で使います')).toHaveLength(2)
+  })
+
+  it('executionMode を渡さなければ実行方式を出さない', () => {
+    render(<SettingsPanel {...defaultProps} />)
+    expect(screen.queryByRole('radiogroup', { name: 'プロンプトの実行方式' })).toBeNull()
+  })
+})
```

```diff
--- a/src/renderer/src/components/__tests__/Sidebar.test.tsx
+++ b/src/renderer/src/components/__tests__/Sidebar.test.tsx
@@ -286,5 +286,43 @@
       />
     )
     expect(screen.getByRole('button', { name: '並び替え' })).toBeInTheDocument()
+  })
+})
+
+describe('Sidebar: プロンプトの実行の状態の受け渡し', () => {
+  const promptRun = {
+    isRunDisabled: true,
+    runDisabledReason: 'エージェントが起動していません（ターミナルの「起動」を押してください）',
+    agentSend: { error: null, notice: null },
+    showToolSelector: false,
+    runAriaLabel: '実行（エージェントに送信）',
+    isRerunDisabled: true,
+    rerunDisabledReason:
+      'エージェント CLI 方式では再実行できません（設定で従来の方式に切り替えると使えます）'
+  }
+
+  it('プロンプトパネルへ押せない理由・ツールの選択の有無を渡す', () => {
+    render(<Sidebar {...defaultProps} activePanel="prompts" promptRun={promptRun} />)
+    expect(screen.getByText(promptRun.runDisabledReason)).toBeInTheDocument()
+    expect(screen.queryByRole('combobox', { name: '実行ツールを選択' })).toBeNull()
+  })
+
+  it('promptRun が無ければ従来どおり(ツールの選択を出す)', () => {
+    render(<Sidebar {...defaultProps} activePanel="prompts" />)
+    expect(screen.getByRole('combobox', { name: '実行ツールを選択' })).toBeInTheDocument()
   })
+
+  it('設定パネルへ実行方式を渡す', () => {
+    render(
+      <Sidebar
+        {...defaultProps}
+        activePanel="settings"
+        executionMode={{ mode: 'legacy', saveError: null, isLocked: false, onSelect: vi.fn() }}
+      />
+    )
+    expect(screen.getByRole('radio', { name: /^従来の方式/ })).toHaveAttribute(
+      'aria-checked',
+      'true'
+    )
+  })
 })
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/renderer/src/components/settings src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx 2>&1 | grep -E "Test Files|Tests |FAIL"
```

Expected: FAIL（`../ExecutionModeSection` が無い。追加したテストが失敗する）

- [ ] **Step 3: 実装する**

`src/renderer/src/types.ts`（差分）:

```diff
--- a/src/renderer/src/types.ts
+++ b/src/renderer/src/types.ts
@@ -166,3 +166,19 @@
   /** 直近の反映の結果の通知(数秒後に null へ戻る) */
   notice: Announcement | null
 }
+
+// プロンプトの実行ボタン・履歴の再実行の押せる条件と、エージェント CLI 方式の送信の結果(useAppState が組み立て、
+// Sidebar → PromptsPanel・HistoryPanel へ渡す)
+export interface PromptRunPanelState {
+  isRunDisabled: boolean
+  /** 押せない理由(プロンプトパネルの上部に 1 か所だけ表示し、無効のボタンの aria-describedby から参照する) */
+  runDisabledReason: string | null
+  /** エージェント CLI 方式の送信の失敗(role="alert")と成功の通知(role="status")。従来の方式では null */
+  agentSend: { error: string | null; notice: Announcement | null } | null
+  /** 実行ツールの選択を出すか(従来の方式だけ。C3) */
+  showToolSelector: boolean
+  /** 実行ボタンの aria-label(可視の文言「実行」で始める。パターン 76) */
+  runAriaLabel: string
+  isRerunDisabled: boolean
+  rerunDisabledReason: string | null
+}
```

`src/renderer/src/components/settings/ExecutionModeSection.tsx`（新規）:

```tsx
'use client'
import { useId } from 'react'
import type { PromptExecutionMode } from '@shared/types'

interface Props {
  /** 読み込み中は null(選べない) */
  mode: PromptExecutionMode | null
  saveError: string | null
  /** 読み込み中・エージェントの起動中は選べない */
  isLocked: boolean
  onSelect: (mode: PromptExecutionMode) => void
}

const OPTIONS: ReadonlyArray<{ value: PromptExecutionMode; label: string }> = [
  { value: 'agent-cli', label: 'エージェント CLI（アプリ内のターミナルで Claude Code を動かす）' },
  { value: 'legacy', label: '従来の方式（Claude API・非対話の CLI で実行し、出力パネルに表示）' }
]

// 設定パネルの最上部の「プロンプトの実行方式」(設計書「実行方式の切り替え」)。選ぶとすぐ保存する
export default function ExecutionModeSection({
  mode,
  saveError,
  isLocked,
  onSelect
}: Props): React.JSX.Element {
  const labelId = useId()
  return (
    <div className="settings-panel__section">
      <p className="settings-panel__label" id={labelId}>
        プロンプトの実行方式
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="execution-mode-section__options">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            disabled={isLocked}
            className={`execution-mode-section__option${mode === option.value ? ' execution-mode-section__option--selected' : ''}`}
            onClick={() => {
              if (mode !== option.value) onSelect(option.value)
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      {mode === null && <p className="settings-panel__status">読み込み中...</p>}
      {saveError !== null && (
        <p className="settings-panel__error" role="alert">
          {saveError}
        </p>
      )}
    </div>
  )
}
```

プロンプトの部品（差分）:

```diff
--- a/src/renderer/src/components/prompts/PromptsPanel.tsx
+++ b/src/renderer/src/components/prompts/PromptsPanel.tsx
@@ -1,5 +1,5 @@
 'use client'
-import { useMemo, useCallback } from 'react'
+import { useMemo, useCallback, useId } from 'react'
 import {
   DndContext,
   closestCenter,
@@ -14,7 +14,7 @@
   sortableKeyboardCoordinates,
   verticalListSortingStrategy
 } from '@dnd-kit/sortable'
-import type { PromptToolId, Prompt } from '../../types'
+import type { Announcement, PromptToolId, Prompt } from '../../types'
 import PromptItem from './PromptItem'
 import AddPromptForm from './AddPromptForm'
 import PromptsToolbar from './PromptsToolbar'
@@ -24,6 +24,7 @@
 import { useAllTags } from '../../hooks/useAllTags'
 import { useSelectedTool } from '../../hooks/useSelectedTool'
 import { sortByPinned, crossesPinBoundary } from '../../lib/promptUtils'
+import { toAnnouncementText } from '../../lib/announcementText'

 interface Props {
   prompts: Prompt[]
@@ -37,6 +38,14 @@
   onImport: () => void
   isRunDisabled?: boolean
   isActive?: boolean
+  /** 実行ボタンを押せない理由。上部に 1 か所だけ表示し、無効のボタンの aria-describedby から参照する(パターン 126) */
+  runDisabledReason?: string | null
+  /** エージェント CLI 方式の送信の失敗と成功の通知。従来の方式では null(通知の領域を置かない) */
+  agentSend?: { error: string | null; notice: Announcement | null } | null
+  /** 実行ツールの選択を出すか(エージェント CLI 方式では出さない。C3) */
+  showToolSelector?: boolean
+  /** 実行ボタンの aria-label。省略時は従来の「プロンプトを実行」 */
+  runAriaLabel?: string
 }

 export default function PromptsPanel({
@@ -50,8 +59,13 @@
   onExport,
   onImport,
   isRunDisabled = false,
-  isActive
-}: Props) {
+  isActive,
+  runDisabledReason = null,
+  agentSend = null,
+  showToolSelector = true,
+  runAriaLabel
+}: Props): React.JSX.Element {
+  const runReasonId = useId()
   const { selectedTool, selectTool } = useSelectedTool()
   const { filteredPrompts, query, setQuery, selectedTags, toggleTag, isFiltered } = usePromptFilter(
     prompts,
@@ -76,7 +90,7 @@
     [onRun, selectedTool]
   )

-  function handleDragEnd({ active, over }: DragEndEvent) {
+  function handleDragEnd({ active, over }: DragEndEvent): void {
     if (!over || active.id === over.id) return
     const activePrompt = displayed.find((p) => p.id === String(active.id))
     const overPrompt = displayed.find((p) => p.id === String(over.id))
@@ -95,7 +109,24 @@
         onExport={onExport}
         isExportDisabled={prompts.length === 0}
       />
-      <ExecutionToolSelector selectedTool={selectedTool} onSelectTool={selectTool} />
+      {showToolSelector && (
+        <ExecutionToolSelector selectedTool={selectedTool} onSelectTool={selectTool} />
+      )}
+      {runDisabledReason !== null && (
+        <p id={runReasonId} className="prompts-panel__run-reason">
+          {runDisabledReason}
+        </p>
+      )}
+      {agentSend !== null && agentSend.error !== null && (
+        <p className="prompts-panel__run-error" role="alert">
+          {agentSend.error}
+        </p>
+      )}
+      {agentSend !== null && (
+        <p className="prompts-panel__run-notice" role="status">
+          {toAnnouncementText(agentSend.notice)}
+        </p>
+      )}
       <div className="prompts-panel__search">
         <input
           className="prompts-panel__search-input"
@@ -111,11 +142,13 @@
         {prompts.length === 0 ? (
           <p className="prompts-panel__empty">プロンプトがありません</p>
         ) : filteredPrompts.length === 0 ? (
-          <p className="prompts-panel__no-results">
-            条件に一致するプロンプトはありません
-          </p>
+          <p className="prompts-panel__no-results">条件に一致するプロンプトはありません</p>
         ) : (
-          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
+          <DndContext
+            sensors={sensors}
+            collisionDetection={closestCenter}
+            onDragEnd={handleDragEnd}
+          >
             <SortableContext
               items={displayed.map((p) => p.id)}
               strategy={verticalListSortingStrategy}
@@ -130,6 +163,10 @@
                   onEdit={onEdit}
                   onTogglePin={onTogglePin}
                   isRunDisabled={isRunDisabled}
+                  runDisabledReasonId={
+                    isRunDisabled && runDisabledReason !== null ? runReasonId : undefined
+                  }
+                  runAriaLabel={runAriaLabel}
                 />
               ))}
             </SortableContext>
```

```diff
--- a/src/renderer/src/components/prompts/PromptItem.tsx
+++ b/src/renderer/src/components/prompts/PromptItem.tsx
@@ -16,6 +16,9 @@
   onTogglePin: (id: string) => void
   isRunDisabled?: boolean
   isSortable?: boolean
+  /** 実行ボタンを押せない理由の要素の id(押せないときだけ渡す) */
+  runDisabledReasonId?: string
+  runAriaLabel?: string
 }

 export default function PromptItem({
@@ -25,8 +28,10 @@
   onEdit,
   onTogglePin,
   isRunDisabled = false,
-  isSortable = false
-}: Props) {
+  isSortable = false,
+  runDisabledReasonId,
+  runAriaLabel
+}: Props): React.JSX.Element {
   const [isEditing, setIsEditing] = useState(false)
   const [isFillingVariables, setIsFillingVariables] = useState(false)

@@ -76,6 +81,7 @@
           onSubmit={handleVariablesSubmit}
           onCancel={() => setIsFillingVariables(false)}
           isRunDisabled={isRunDisabled}
+          runDisabledReasonId={runDisabledReasonId}
         />
       ) : isEditing ? (
         <PromptEditForm
@@ -89,6 +95,8 @@
           isSortable={isSortable}
           dragHandleProps={{ attributes, listeners }}
           isRunDisabled={isRunDisabled}
+          runDisabledReasonId={runDisabledReasonId}
+          runAriaLabel={runAriaLabel}
           onRun={handleRunClick}
           onEditStart={() => setIsEditing(true)}
           onDelete={() => onDelete(prompt.id)}
```

```diff
--- a/src/renderer/src/components/prompts/PromptItemView.tsx
+++ b/src/renderer/src/components/prompts/PromptItemView.tsx
@@ -11,6 +11,10 @@
     listeners: DraggableSyntheticListeners
   }
   isRunDisabled: boolean
+  /** 押せない理由の要素の id(押せないときだけ渡す) */
+  runDisabledReasonId?: string
+  /** 実行ボタンの aria-label。省略時は「プロンプトを実行」 */
+  runAriaLabel?: string
   onRun: () => void
   onEditStart: () => void
   onDelete: () => void
@@ -22,11 +26,13 @@
   isSortable,
   dragHandleProps,
   isRunDisabled,
+  runDisabledReasonId,
+  runAriaLabel = 'プロンプトを実行',
   onRun,
   onEditStart,
   onDelete,
   onTogglePin
-}: Props) {
+}: Props): React.JSX.Element {
   return (
     <>
       {isSortable && (
@@ -67,7 +73,8 @@
         <button
           type="button"
           className="prompt-item__run"
-          aria-label="プロンプトを実行"
+          aria-label={runAriaLabel}
+          aria-describedby={runDisabledReasonId}
           disabled={isRunDisabled}
           onClick={onRun}
         >
```

```diff
--- a/src/renderer/src/components/prompts/PromptVariablesForm.tsx
+++ b/src/renderer/src/components/prompts/PromptVariablesForm.tsx
@@ -7,14 +7,17 @@
   onSubmit: (values: Record<string, string>) => void
   onCancel: () => void
   isRunDisabled?: boolean
+  /** 押せない理由の要素の id(押せないときだけ渡す) */
+  runDisabledReasonId?: string
 }

 export default function PromptVariablesForm({
   variables,
   onSubmit,
   onCancel,
-  isRunDisabled = false
-}: Props) {
+  isRunDisabled = false,
+  runDisabledReasonId
+}: Props): React.JSX.Element {
   const { values, isDisabled, handleChange, handleSubmit } = usePromptVariablesForm(
     variables,
     onSubmit
@@ -58,6 +61,7 @@
           type="submit"
           className="prompt-item__save"
           aria-label="変数を差し込んで実行"
+          aria-describedby={isRunDisabled ? runDisabledReasonId : undefined}
           disabled={isDisabled || isRunDisabled}
         >
           実行
```

履歴の部品（差分）:

```diff
--- a/src/renderer/src/components/history/HistoryPanel.tsx
+++ b/src/renderer/src/components/history/HistoryPanel.tsx
@@ -11,6 +11,8 @@
   onClear: () => void
   onRerun: (entry: HistoryEntry) => void
   isRerunDisabled?: boolean
+  /** 再実行を押せない理由(エージェント CLI 方式)。詳細に表示し、aria-describedby で参照する */
+  rerunDisabledReason?: string | null
 }

 export default function HistoryPanel({
@@ -18,8 +20,9 @@
   onDelete,
   onClear,
   onRerun,
-  isRerunDisabled = false
-}: Props) {
+  isRerunDisabled = false,
+  rerunDisabledReason = null
+}: Props): React.JSX.Element {
   const { selectedEntry, selectEntry, deselectIfMatches } = useSelectedHistoryEntry(history)
   // id → ボタン要素の参照を保持する。DOM文字列セレクタでの検索を避けるため
   // （id は history.json 由来の永続データで任意の文字列になりうる）、
@@ -89,6 +92,7 @@
                 onRerun={onRerun}
                 onDelete={handleDelete}
                 isRerunDisabled={isRerunDisabled}
+                rerunDisabledReason={rerunDisabledReason}
               />
             )}
           </>
```

```diff
--- a/src/renderer/src/components/history/HistoryDetail.tsx
+++ b/src/renderer/src/components/history/HistoryDetail.tsx
@@ -1,4 +1,5 @@
 'use client'
+import { useId } from 'react'
 import type { HistoryEntry } from '../../types'
 import MarkdownRenderer from '../output/MarkdownRenderer'
 import { getToolLabel, formatExecutedAt } from '../../lib/historyFormatters'
@@ -8,10 +9,19 @@
   onRerun: (entry: HistoryEntry) => void
   onDelete: (id: string) => void
   isRerunDisabled: boolean
+  rerunDisabledReason?: string | null
 }

-export default function HistoryDetail({ entry, onRerun, onDelete, isRerunDisabled }: Props) {
+export default function HistoryDetail({
+  entry,
+  onRerun,
+  onDelete,
+  isRerunDisabled,
+  rerunDisabledReason = null
+}: Props): React.JSX.Element {
   const toolLabel = getToolLabel(entry.toolId)
+  const reasonId = useId()
+  const showReason = isRerunDisabled && rerunDisabledReason !== null

   return (
     <div className="history-detail">
@@ -28,6 +38,7 @@
           className="history-detail__rerun"
           onClick={() => onRerun(entry)}
           disabled={isRerunDisabled}
+          aria-describedby={showReason ? reasonId : undefined}
         >
           再実行
         </button>
@@ -40,6 +51,11 @@
           削除
         </button>
       </div>
+      {showReason && (
+        <p id={reasonId} className="history-detail__rerun-reason">
+          {rerunDisabledReason}
+        </p>
+      )}
       <div className="history-detail__content">
         {entry.status === 'success' && entry.resultText !== null && (
           <MarkdownRenderer content={entry.resultText} />
```

設定パネルと Sidebar（差分）:

```diff
--- a/src/renderer/src/components/settings/SettingsPanel.tsx
+++ b/src/renderer/src/components/settings/SettingsPanel.tsx
@@ -1,7 +1,8 @@
-import type { ModelSettings } from '@shared/types'
+import type { ModelSettings, PromptExecutionMode } from '@shared/types'
 import { useApiKeyForm } from '../../hooks/useApiKeyForm'
 import { useModelSettingsForm } from '../../hooks/useModelSettingsForm'
 import ModelSettingsSection from './ModelSettingsSection'
+import ExecutionModeSection from './ExecutionModeSection'

 interface Props {
   hasKey: boolean
@@ -11,6 +12,13 @@
   modelSettings: ModelSettings
   modelSettingsLoaded: boolean
   onSaveModelSettings: (settings: ModelSettings) => Promise<void>
+  /** プロンプトの実行方式(省略時は出さない) */
+  executionMode?: {
+    mode: PromptExecutionMode | null
+    saveError: string | null
+    isLocked: boolean
+    onSelect: (mode: PromptExecutionMode) => void
+  }
 }

 export default function SettingsPanel({
@@ -20,8 +28,9 @@
   onSave,
   modelSettings,
   modelSettingsLoaded,
-  onSaveModelSettings
-}: Props) {
+  onSaveModelSettings,
+  executionMode
+}: Props): React.JSX.Element {
   const { inputValue, setInputValue, isSaving, saved, saveError, isSaveDisabled, handleSave } =
     useApiKeyForm({ apiKeyLoaded, keyStoreError, onSave })

@@ -32,8 +41,17 @@

   return (
     <div className="settings-panel">
+      {executionMode !== undefined && (
+        <ExecutionModeSection
+          mode={executionMode.mode}
+          saveError={executionMode.saveError}
+          isLocked={executionMode.isLocked}
+          onSelect={executionMode.onSelect}
+        />
+      )}
       <div className="settings-panel__section">
         <p className="settings-panel__label">Anthropic API キー</p>
+        <p className="settings-panel__note">従来の方式で使います</p>
         {keyStoreError && <p className="settings-panel__keystore-error">{keyStoreError}</p>}
         {!keyStoreError && apiKeyLoaded && hasKey && (
           <p className="settings-panel__status">（設定済み）更新するには再入力してください</p>
@@ -62,6 +80,7 @@
       </div>
       <div className="settings-panel__section">
         <p className="settings-panel__label">モデル</p>
+        <p className="settings-panel__note">従来の方式で使います</p>
         {modelSettingsLoaded ? (
           <ModelSettingsSection
             key={`${modelSettings.modelId}:${modelSettings.maxTokens}`}
```

```diff
--- a/src/renderer/src/components/Sidebar.tsx
+++ b/src/renderer/src/components/Sidebar.tsx
@@ -20,9 +20,16 @@
   MergeStatePanelState,
   GitTagPanelState,
   RemoteSetupPanelState,
-  CloneRepositoryPanelState
+  CloneRepositoryPanelState,
+  PromptRunPanelState
 } from '../types'
-import type { GitBranch, GitLogEntry, GitStatusResult, ModelSettings } from '@shared/types'
+import type {
+  GitBranch,
+  GitLogEntry,
+  GitStatusResult,
+  ModelSettings,
+  PromptExecutionMode
+} from '@shared/types'
 import { alwaysUnlocked } from '../hooks/useFileOperationLock'

 interface Props {
@@ -116,6 +123,15 @@
   modelSettings: ModelSettings
   modelSettingsLoaded: boolean
   onSaveModelSettings: (settings: ModelSettings) => Promise<void>
+  /** 実行ボタン・再実行の押せる条件と送信の結果。省略時は isExecuting で押せなくする(従来どおり) */
+  promptRun?: PromptRunPanelState
+  /** プロンプトの実行方式の設定。省略時は設定パネルに実行方式を出さない */
+  executionMode?: {
+    mode: PromptExecutionMode | null
+    saveError: string | null
+    isLocked: boolean
+    onSelect: (mode: PromptExecutionMode) => void
+  }
 }

 export default function Sidebar({
@@ -206,7 +222,9 @@
   onSaveApiKey,
   modelSettings,
   modelSettingsLoaded,
-  onSaveModelSettings
+  onSaveModelSettings,
+  promptRun,
+  executionMode
 }: Props): React.JSX.Element {
   return (
     <div className="sidebar">
@@ -239,7 +257,11 @@
           onExport={onExportPrompts}
           onImport={onImportPrompts}
           onRun={onRunPrompt}
-          isRunDisabled={isExecuting}
+          isRunDisabled={promptRun?.isRunDisabled ?? isExecuting}
+          runDisabledReason={promptRun?.runDisabledReason ?? null}
+          agentSend={promptRun?.agentSend ?? null}
+          showToolSelector={promptRun?.showToolSelector ?? true}
+          runAriaLabel={promptRun?.runAriaLabel}
           isActive={activePanel === 'prompts'}
         />
       </PanelContainer>
@@ -261,7 +283,8 @@
           onDelete={onDeleteHistoryEntry}
           onClear={onClearHistory}
           onRerun={onRerunHistoryEntry}
-          isRerunDisabled={isExecuting}
+          isRerunDisabled={promptRun?.isRerunDisabled ?? isExecuting}
+          rerunDisabledReason={promptRun?.rerunDisabledReason ?? null}
         />
       </PanelContainer>
       <PanelContainer isActive={activePanel === 'source-control'}>
@@ -322,6 +345,7 @@
           modelSettings={modelSettings}
           modelSettingsLoaded={modelSettingsLoaded}
           onSaveModelSettings={onSaveModelSettings}
+          executionMode={executionMode}
         />
       </PanelContainer>
     </div>
```

`src/renderer/src/assets/main.css`: 共通の枠付きボタンの規則の 3 つの並び（Task 18・21 で足した並び）の末尾に `.execution-mode-section__option` を足す:

```diff
 .agent-terminal-panel__button,
-.external-change-banner__button {
+.external-change-banner__button,
+.execution-mode-section__option {
```

```diff
 .agent-terminal-panel__button:hover:not(:disabled),
-.external-change-banner__button:hover:not(:disabled) {
+.external-change-banner__button:hover:not(:disabled),
+.execution-mode-section__option:hover:not(:disabled) {
```

```diff
 .agent-terminal-panel__button:disabled,
+.execution-mode-section__option:disabled,
 .name-input-dialog__ok:disabled,
```

`/* ---- PromptItem 実行ボタン ---- */` の直前に、次の規則を足す:

```css
/* ---- 実行方式(設定パネルの最上部) ---- */

.execution-mode-section__options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.execution-mode-section__option {
  text-align: left;
  white-space: normal;
}

.execution-mode-section__option[aria-checked='true'] {
  border-color: #007acc;
  color: #ffffff;
}

.settings-panel__note {
  font-size: 11px;
  color: #969696;
}

/* ---- プロンプトの実行の理由・結果(プロンプトパネルの上部) ---- */

.prompts-panel__run-reason,
.prompts-panel__run-notice {
  margin: 0;
  padding: 2px 12px;
  color: #969696;
  font-size: 12px;
}

/* 空の通知も DOM に残す(ライブリージョンは先に在る必要がある。パターン 87)。余白だけを消す */
.prompts-panel__run-notice:empty {
  padding: 0;
}

.prompts-panel__run-error {
  margin: 0;
  padding: 2px 12px;
  color: #f48771;
  font-size: 12px;
}

.history-detail__rerun-reason {
  margin: 4px 0;
  color: #969696;
  font-size: 12px;
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/renderer/src/components 2>&1 | grep -E "Test Files|Tests |FAIL"
npx tsc --noEmit -p tsconfig.web.json --composite false 2>&1 | grep -v "useAppState.ts" | head
npx eslint src/renderer/src/types.ts src/renderer/src/components/settings/ExecutionModeSection.tsx src/renderer/src/components/prompts/PromptsPanel.tsx src/renderer/src/components/prompts/PromptItem.tsx src/renderer/src/components/prompts/PromptItemView.tsx src/renderer/src/components/prompts/PromptVariablesForm.tsx src/renderer/src/components/history/HistoryPanel.tsx src/renderer/src/components/history/HistoryDetail.tsx src/renderer/src/components/settings/SettingsPanel.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/settings/__tests__/ExecutionModeSection.test.tsx src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx src/renderer/src/components/settings/__tests__/SettingsPanel.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx
npx prettier --check src/renderer/src/types.ts src/renderer/src/components/settings/ExecutionModeSection.tsx src/renderer/src/components/prompts/PromptsPanel.tsx src/renderer/src/components/prompts/PromptItem.tsx src/renderer/src/components/prompts/PromptItemView.tsx src/renderer/src/components/prompts/PromptVariablesForm.tsx src/renderer/src/components/history/HistoryPanel.tsx src/renderer/src/components/history/HistoryDetail.tsx src/renderer/src/components/settings/SettingsPanel.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/settings/__tests__/ExecutionModeSection.test.tsx src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx src/renderer/src/components/settings/__tests__/SettingsPanel.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/assets/main.css
```

Expected: components のテストがすべて PASS（`ExecutionModeSection` 4 件・`PromptsPanel` 46 件・`HistoryDetail` 11 件・`SettingsPanel` 26 件・`Sidebar` 18 件）

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                  | テストのファイル                | `-t`                                       | 確認           |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------ | -------------- |
| U1  | `PromptsPanel.tsx` の `isRunDisabled && runDisabledReason !== null ? runReasonId : undefined` を `runReasonId` にする | `PromptsPanel.test.tsx`         | `押せるときは aria-describedby を付けない` | 落ちた（1 件） |
| U2  | `PromptsPanel.tsx` の `{showToolSelector && (` を `{(` にする                                                         | `PromptsPanel.test.tsx`         | `実行ツールの選択を隠せる`                 | 落ちた（1 件） |
| U3  | `HistoryDetail.tsx` の `aria-describedby={showReason ? reasonId : undefined}` を `aria-describedby={reasonId}` にする | `HistoryDetail.test.tsx`        | `理由が無ければ表示しない`                 | 落ちた（1 件） |
| U4  | `ExecutionModeSection.tsx` の `if (mode !== option.value) onSelect(option.value)` を `onSelect(option.value)` にする  | `ExecutionModeSection.test.tsx` | `選択中のものを押しても呼ばない`           | 落ちた（1 件） |
| U5  | `Sidebar.tsx` の `showToolSelector={promptRun?.showToolSelector ?? true}` を `showToolSelector={true}` にする         | `Sidebar.test.tsx`              | `プロンプトパネルへ押せない理由`           | 落ちた（1 件） |

- [ ] **Step 6: 確認コマンド（コミットしない）**

```bash
git status --short src/renderer
```

---

### Task 23: renderer: 組み立て（`useAppState`・`App`）と、フォルダ・実行方式の切り替えの確認

**Files:**

- Modify: `src/renderer/src/hooks/useAppState.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/hooks/__tests__/useAppState.test.ts`

**Interfaces:**

- Consumes: Task 17〜22 の hooks・型・部品、`getAgentTerminalController`（Task 16）、`AGENT_STOP_ON_FOLDER_CHANGE_CONFIRM`・`AGENT_STOP_ON_MODE_CHANGE_CONFIRM`（Task 19）、`getPromptRunAvailability`・`getRerunAvailability`（Task 20）
- Produces: `AppState` の新しいキー `executionMode: PromptExecutionMode | null`・`executionModeSaveError`・`isExecutionModeLocked`・`selectExecutionMode(mode): Promise<void>`・`promptRun: PromptRunPanelState`・`bottomPanel`・`agentTerminal: AgentTerminalPanelState`・`externalChangeBanner`、`openFolder` の差し替え（エージェントが動いていれば終了を確認してから）
- 注: `useFileSystem({ onSaveConflict: externalChangeMarks.mark })`（保存の照合で上書きがキャンセルされたタブにも監視と同じ印）。controller は `useState(getAgentTerminalController)` で 1 回だけ得る。終了の確認は「フォルダを変更」と clone で未保存の確認より先（差異 23）。従来の方式への切り替えは、動いているセッションがあれば確認して止めてから保存する。起動中は切り替えない（差異 18）。下部のパネルは、実行方式の読み込み中は `none`・エージェント CLI 方式は `agent-terminal`・従来の方式は `output`。外部変更の検知は実行方式に関係なく常に有効（diff タブの表示中は通知を出さない）。`useAppState.test.ts` は `useExecutionMode`・`useAgentSession`・`useExternalFileChanges`・`xtermFactory` を差し替え、既定の実装を `beforeEach` で戻す（パターン 103）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAppState.test.ts`（差分）:

```diff
--- a/src/renderer/src/hooks/__tests__/useAppState.test.ts
+++ b/src/renderer/src/hooks/__tests__/useAppState.test.ts
@@ -1,6 +1,7 @@
 import { describe, it, expect, vi, beforeEach } from 'vitest'
 import { renderHook, waitFor, act } from '@testing-library/react'
-import type { GitStatusResult } from '@shared/types'
+import type { GitStatusResult, PromptExecutionMode } from '@shared/types'
+import { makeAgentSessionState } from '../../__tests__/makeAgentSessionState'
 import type { DiffTabKey } from '../useDiffTabs'
 import type { ApplyOpenedFolderOptions } from '../useFileSystem'
 import { makeGitTagPanelState } from '../../__tests__/makeGitTagPanelState'
@@ -267,9 +268,33 @@
 vi.mock('../useGitTagOperations', () => ({ useGitTagOperations: mockUseGitTagOperations }))
 vi.mock('../useGitRemoteSetup', () => ({ useGitRemoteSetup: mockUseGitRemoteSetup }))
 vi.mock('../useCloneRepository', () => ({ useCloneRepository: mockUseCloneRepository }))
+// 外部変更の検知・エージェントの部品は、それぞれのテストで確かめる。ここでは組み立て(渡す値)だけを見る
+// mock.calls[0][0] で呼び出し引数を検証するため、引数を受け取る型として宣言する
+// eslint-disable-next-line @typescript-eslint/no-unused-vars
+const mockUseExternalFileChanges = vi.hoisted(() => vi.fn((_options?: unknown) => null))
+const mockUseExecutionMode = vi.hoisted(() =>
+  vi.fn(() => ({
+    mode: 'legacy' as PromptExecutionMode | null,
+    saveError: null as string | null,
+    changeMode: vi.fn<(mode: PromptExecutionMode) => Promise<boolean>>(async () => true)
+  }))
+)
+const mockUseAgentSession = vi.hoisted(() => vi.fn())
+vi.mock('../useExecutionMode', () => ({ useExecutionMode: mockUseExecutionMode }))
+vi.mock('../useAgentSession', () => ({ useAgentSession: mockUseAgentSession }))
+vi.mock('../useExternalFileChanges', () => ({ useExternalFileChanges: mockUseExternalFileChanges }))
+vi.mock('../../lib/xtermFactory', async () => {
+  const { makeFakeController } = await import('../../__tests__/makeFakeAgentTerminal')
+  const controller = makeFakeController()
+  return { getAgentTerminalController: () => controller }
+})

 import { useAppState } from '../useAppState'

+// useFileSystem・useExecutionMode の既定の実装(個別のテストが mockReturnValue で上書きしても、beforeEach で戻す。パターン 103)
+const defaultUseFileSystem = mockUseFileSystem.getMockImplementation()!
+const defaultUseExecutionMode = mockUseExecutionMode.getMockImplementation()!
+
 beforeEach(() => {
   vi.clearAllMocks()
   // clone の「Git 操作の実行中」の合成がタグ・初期化の実行中フラグを読むため、既定の戻り値を毎回設定し直す
@@ -279,6 +304,9 @@
   mockUseCloneRepository.mockReturnValue(makeCloneRepositoryPanelState())
   // 退避の実行中フラグ(stash.pendingOperation)も合成に入るため、退避の既定の戻り値も毎回設定し直す
   mockUseStashPanel.mockReturnValue(mockStashPanel)
+  mockUseAgentSession.mockReturnValue(makeAgentSessionState())
+  mockUseFileSystem.mockImplementation(defaultUseFileSystem)
+  mockUseExecutionMode.mockImplementation(defaultUseExecutionMode)
 })

 describe('useAppState', () => {
@@ -1921,7 +1949,9 @@
       const { result } = renderHook(() => useAppState())
       const options = mockUseCloneRepository.mock.calls[0][0]
       expect(options.captureDirtySnapshot).toBe(fileSystemDeps.captureDirtySnapshot)
-      expect(options.confirmDiscardAnyDirty).toBe(fileSystemDeps.confirmDiscardAnyDirty)
+      // エージェントが動いていなければ、未保存の確認(useFileSystem)をそのまま使う
+      expect(options.confirmDiscardAnyDirty()).toBe(true)
+      expect(fileSystemDeps.confirmDiscardAnyDirty).toHaveBeenCalledOnce()
       expect(options.applyOpenedFolder).toBe(fileSystemDeps.applyOpenedFolder)
       // 他の Git 操作と同じロック(別のロックだと、clone の間に commit などを始められる)
       expect(options.lock).toBe(mockUseStashPanel.mock.calls[0][0].fileOperationLock)
@@ -2056,4 +2086,193 @@
       expect(mockUseCloneRepository.mock.lastCall![0].isGitOperationRunning).toBe(false)
     })
   })
+
+  describe('実行方式とエージェント', () => {
+    const agentMode = (): void => {
+      mockUseExecutionMode.mockReturnValue({
+        mode: 'agent-cli',
+        saveError: null,
+        changeMode: vi.fn(async () => true)
+      })
+    }
+
+    it('従来の方式では、実行中だけ押せず(理由なし)、ツールの選択と出力パネルを出す', () => {
+      mockUsePromptExecution.mockReturnValueOnce({ ...mockUsePromptExecution(), isExecuting: true })
+      const { result } = renderHook(() => useAppState())
+      expect(result.current.promptRun).toMatchObject({
+        isRunDisabled: true,
+        runDisabledReason: null,
+        agentSend: null,
+        showToolSelector: true,
+        runAriaLabel: 'プロンプトを実行',
+        isRerunDisabled: true,
+        rerunDisabledReason: null
+      })
+      expect(result.current.bottomPanel).toBe('output')
+    })
+
+    it('実行方式の読み込み中は押せず理由を出し、下部のパネルを出さない', () => {
+      mockUseExecutionMode.mockReturnValue({
+        mode: null,
+        saveError: null,
+        changeMode: vi.fn(async () => true)
+      })
+      const { result } = renderHook(() => useAppState())
+      expect(result.current.promptRun.isRunDisabled).toBe(true)
+      expect(result.current.promptRun.runDisabledReason).toBe('設定を読み込んでいます')
+      expect(result.current.bottomPanel).toBe('none')
+    })
+
+    it('エージェント CLI 方式でセッションが無ければ押せず理由を出し、ツールの選択を隠し、再実行も押せない', () => {
+      agentMode()
+      const { result } = renderHook(() => useAppState())
+      expect(result.current.promptRun).toMatchObject({
+        isRunDisabled: true,
+        runDisabledReason: 'エージェントが起動していません（ターミナルの「起動」を押してください）',
+        showToolSelector: false,
+        runAriaLabel: '実行（エージェントに送信）',
+        isRerunDisabled: true,
+        rerunDisabledReason:
+          'エージェント CLI 方式では再実行できません（設定で従来の方式に切り替えると使えます）'
+      })
+      expect(result.current.promptRun.agentSend).toEqual({ error: null, notice: null })
+      expect(result.current.bottomPanel).toBe('agent-terminal')
+    })
+
+    it('エージェント CLI 方式でセッションが動いていれば押せる', () => {
+      agentMode()
+      mockUseAgentSession.mockReturnValue(
+        makeAgentSessionState({ status: 'running', sessionId: 's1' })
+      )
+      const { result } = renderHook(() => useAppState())
+      expect(result.current.promptRun.isRunDisabled).toBe(false)
+      expect(result.current.promptRun.runDisabledReason).toBeNull()
+    })
+
+    it('usePromptRunner に実行方式と送信の関数を渡す', () => {
+      agentMode()
+      renderHook(() => useAppState())
+      const args = mockUsePromptRunner.mock.calls[0][0] as {
+        executionMode: unknown
+        sendToAgent: unknown
+      }
+      expect(args.executionMode).toBe('agent-cli')
+      expect(args.sendToAgent).toEqual(expect.any(Function))
+    })
+
+    it('useFileSystem に保存の照合の取り消しの通知を渡し、useExternalFileChanges に開いているタブの操作を渡す', () => {
+      renderHook(() => useAppState())
+      expect(mockUseFileSystem.mock.calls[0]).toEqual([{ onSaveConflict: expect.any(Function) }])
+      const options = mockUseExternalFileChanges.mock.calls[0][0] as { isFileTabActive: boolean }
+      expect(options.isFileTabActive).toBe(true)
+    })
+
+    describe('フォルダの切り替えの前の確認', () => {
+      it.each([
+        ['動いていなければ確認せずに開く', 'none', undefined, 0, 1],
+        ['動いていて OK なら開く', 'running', true, 1, 1],
+        ['動いていてキャンセルなら開かない', 'running', false, 1, 0]
+      ] as const)('%s', async (_label, status, answer, confirmCalls, openCalls) => {
+        mockUseAgentSession.mockReturnValue(makeAgentSessionState({ status }))
+        const openFolder = vi.fn(async () => undefined)
+        mockUseFileSystem.mockReturnValue({
+          ...mockUseFileSystem.getMockImplementation()!(),
+          openFolder
+        })
+        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(answer ?? true)
+        const { result } = renderHook(() => useAppState())
+        await act(async () => {
+          await result.current.openFolder()
+        })
+        expect(confirmSpy).toHaveBeenCalledTimes(confirmCalls)
+        if (confirmCalls > 0) {
+          expect(confirmSpy).toHaveBeenCalledWith(
+            'フォルダを切り替えると、実行中のエージェントを終了します。続けますか？'
+          )
+        }
+        expect(openFolder).toHaveBeenCalledTimes(openCalls)
+        confirmSpy.mockRestore()
+      })
+
+      it('clone の確認でキャンセルしたら、未保存の確認に進まない', () => {
+        mockUseAgentSession.mockReturnValue(makeAgentSessionState({ status: 'running' }))
+        const confirmDiscardAnyDirty = vi.fn(() => true)
+        mockUseFileSystem.mockReturnValueOnce({
+          ...mockUseFileSystem.getMockImplementation()!(),
+          confirmDiscardAnyDirty
+        })
+        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
+        renderHook(() => useAppState())
+        const options = mockUseCloneRepository.mock.calls[0][0] as {
+          confirmDiscardAnyDirty: () => boolean
+        }
+        expect(options.confirmDiscardAnyDirty()).toBe(false)
+        expect(confirmDiscardAnyDirty).not.toHaveBeenCalled()
+        confirmSpy.mockRestore()
+      })
+    })
+
+    describe('実行方式の切り替え', () => {
+      it('動いているセッションがあれば、従来の方式への切り替えの前に確認し、OK なら止めてから保存する', async () => {
+        const changeMode = vi.fn(async () => true)
+        mockUseExecutionMode.mockReturnValue({ mode: 'agent-cli', saveError: null, changeMode })
+        const session = makeAgentSessionState({ status: 'running', sessionId: 's1' })
+        mockUseAgentSession.mockReturnValue(session)
+        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
+        const { result } = renderHook(() => useAppState())
+        await act(async () => {
+          await result.current.selectExecutionMode('legacy')
+        })
+        expect(confirmSpy).toHaveBeenCalledWith(
+          '従来の方式に切り替えると、実行中のエージェントを終了します。続けますか？'
+        )
+        expect(session.stop).toHaveBeenCalledOnce()
+        expect(changeMode).toHaveBeenCalledWith('legacy')
+        confirmSpy.mockRestore()
+      })
+
+      it('確認でキャンセルしたら止めず、保存もしない', async () => {
+        const changeMode = vi.fn(async () => true)
+        mockUseExecutionMode.mockReturnValue({ mode: 'agent-cli', saveError: null, changeMode })
+        const session = makeAgentSessionState({ status: 'running', sessionId: 's1' })
+        mockUseAgentSession.mockReturnValue(session)
+        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
+        const { result } = renderHook(() => useAppState())
+        await act(async () => {
+          await result.current.selectExecutionMode('legacy')
+        })
+        expect(session.stop).not.toHaveBeenCalled()
+        expect(changeMode).not.toHaveBeenCalled()
+        confirmSpy.mockRestore()
+      })
+
+      it('エージェント CLI 方式への切り替えは確認しない', async () => {
+        const changeMode = vi.fn(async () => true)
+        mockUseExecutionMode.mockReturnValue({ mode: 'legacy', saveError: null, changeMode })
+        const confirmSpy = vi.spyOn(window, 'confirm')
+        const { result } = renderHook(() => useAppState())
+        await act(async () => {
+          await result.current.selectExecutionMode('agent-cli')
+        })
+        expect(confirmSpy).not.toHaveBeenCalled()
+        expect(changeMode).toHaveBeenCalledWith('agent-cli')
+        confirmSpy.mockRestore()
+      })
+
+      it('起動中は切り替えない(選択肢も押せない)', async () => {
+        const changeMode = vi.fn(async () => true)
+        mockUseExecutionMode.mockReturnValue({ mode: 'agent-cli', saveError: null, changeMode })
+        mockUseAgentSession.mockReturnValue(makeAgentSessionState({ status: 'starting' }))
+        // 確認で OK を返しても切り替えない(起動中の判定で止まることを確かめる)
+        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
+        const { result } = renderHook(() => useAppState())
+        expect(result.current.isExecutionModeLocked).toBe(true)
+        await act(async () => {
+          await result.current.selectExecutionMode('legacy')
+        })
+        expect(changeMode).not.toHaveBeenCalled()
+        confirmSpy.mockRestore()
+      })
+    })
+  })
 })
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/renderer/src/hooks/__tests__/useAppState.test.ts 2>&1 | grep -E "Tests |FAIL" | head
```

Expected: FAIL（新しいキー・確認が無い。clone の確認の期待の変更）

- [ ] **Step 3: 実装する**

`src/renderer/src/hooks/useAppState.ts`（差分）:

```diff
--- a/src/renderer/src/hooks/useAppState.ts
+++ b/src/renderer/src/hooks/useAppState.ts
@@ -1,4 +1,5 @@
-import { useEffect } from 'react'
+import { useEffect, useState } from 'react'
+import type { PromptExecutionMode } from '@shared/types'
 import { usePanelState } from './usePanelState'
 import { useFileSystem } from './useFileSystem'
 import { usePrompts } from './usePrompts'
@@ -39,6 +40,21 @@
   StashPanelState
 } from '../types'
 import { isConflictedFile, isStagedFile, isUnstagedFile } from '../lib/gitUtils'
+import { useExecutionMode } from './useExecutionMode'
+import { useAgentSession } from './useAgentSession'
+import { useAgentPromptSender } from './useAgentPromptSender'
+import { useAgentTerminalPanel } from './useAgentTerminalPanel'
+import { useExternalChangeMarks } from './useExternalChangeMarks'
+import { useExternalFileChanges } from './useExternalFileChanges'
+import type { ExternalChangeBannerState } from './useExternalFileChanges'
+import { getAgentTerminalController } from '../lib/xtermFactory'
+import { getPromptRunAvailability, getRerunAvailability } from '../lib/agentSendMessages'
+import {
+  AGENT_STOP_ON_FOLDER_CHANGE_CONFIRM,
+  AGENT_STOP_ON_MODE_CHANGE_CONFIRM
+} from '../lib/agentSessionMessages'
+import type { AgentTerminalPanelState } from '../components/agent/AgentTerminalPanel'
+import type { PromptRunPanelState } from '../types'

 type AppState = {
   quickOpen: ReturnType<typeof useQuickOpen>
@@ -82,6 +98,20 @@
   /** アクティブな diff タブのファイルがコンフリクト中か(EditorPanel が解決ビューを出す条件。
    *  conflictFile の対象と同じ導出) */
   isActiveFileConflicted: boolean
+  /** プロンプトの実行方式(読み込み中は null)と保存の失敗 */
+  executionMode: PromptExecutionMode | null
+  executionModeSaveError: string | null
+  /** 実行方式の切り替えを押せないか(読み込み中・エージェントの起動中) */
+  isExecutionModeLocked: boolean
+  /** 実行方式を切り替える(従来の方式へ切り替えるとき、実行中のエージェントがあれば確認してから止める) */
+  selectExecutionMode: (mode: PromptExecutionMode) => Promise<void>
+  /** 実行ボタン・再実行の押せる条件と送信の結果 */
+  promptRun: PromptRunPanelState
+  /** エディタの領域の下部のパネル */
+  bottomPanel: 'output' | 'agent-terminal' | 'none'
+  agentTerminal: AgentTerminalPanelState
+  /** 編集中のタブの外部変更の通知 */
+  externalChangeBanner: ExternalChangeBannerState | null
 } & ReturnType<typeof usePanelState> &
   ReturnType<typeof useFileSystem> &
   ReturnType<typeof usePrompts> &
@@ -100,7 +130,9 @@

 export function useAppState(): AppState {
   const panel = usePanelState()
-  const fileSystem = useFileSystem()
+  // 保存の直前の照合で上書きがキャンセルされたタブにも、監視と同じ外部変更の印を付ける
+  const externalChangeMarks = useExternalChangeMarks()
+  const fileSystem = useFileSystem({ onSaveConflict: externalChangeMarks.mark })
   const prompts = usePrompts()
   const progress = useProgressTasks()
   const git = useGitStatus(fileSystem.folderPath)
@@ -157,11 +189,69 @@
   const settings = useSettings()
   const execution = usePromptExecution()
   const history = useHistory()
+  const executionMode = useExecutionMode()
+  // xterm と IPC の購読を持つ、文書ごとに 1 つの部品(StrictMode・パネルの開閉で作り直さない)
+  const [agentController] = useState(getAgentTerminalController)
+  const agentLayout = useAgentTerminalPanel()
+  const agentSession = useAgentSession({
+    folderPath: fileSystem.folderPath,
+    controller: agentController,
+    enabled: executionMode.mode === 'agent-cli'
+  })
+  const agentSender = useAgentPromptSender({
+    controller: agentController,
+    onSettled: agentLayout.open
+  })
   const promptRunner = usePromptRunner({
     openFile: fileSystem.openFile,
     executePrompt: execution.executePrompt,
-    addHistoryEntry: history.addHistoryEntry
+    addHistoryEntry: history.addHistoryEntry,
+    executionMode: executionMode.mode,
+    sendToAgent: agentSender.send
+  })
+  const isAgentMode = executionMode.mode === 'agent-cli'
+  const isAgentSessionActive =
+    agentSession.status === 'running' || agentSession.status === 'starting'
+  const runAvailability = getPromptRunAvailability({
+    mode: executionMode.mode,
+    isExecuting: execution.isExecuting,
+    isSessionRunning: agentSession.status === 'running',
+    isSending: agentSender.isSending
   })
+  const rerunAvailability = getRerunAvailability({
+    mode: executionMode.mode,
+    isExecuting: execution.isExecuting
+  })
+  const promptRun: PromptRunPanelState = {
+    isRunDisabled: runAvailability.disabled,
+    runDisabledReason: runAvailability.reason,
+    agentSend: isAgentMode ? { error: agentSender.error, notice: agentSender.notice } : null,
+    showToolSelector: !isAgentMode,
+    runAriaLabel: isAgentMode ? '実行（エージェントに送信）' : 'プロンプトを実行',
+    isRerunDisabled: rerunAvailability.disabled,
+    rerunDisabledReason: rerunAvailability.reason
+  }
+  // フォルダの切り替え・従来の方式への切り替えの前に、実行中のエージェントを終了してよいかを確かめる
+  const confirmStopAgent = (message: string): boolean => !isAgentSessionActive || confirm(message)
+  const openFolder: typeof fileSystem.openFolder = async () => {
+    if (!confirmStopAgent(AGENT_STOP_ON_FOLDER_CHANGE_CONFIRM)) return
+    await fileSystem.openFolder()
+  }
+  const selectExecutionMode = async (next: PromptExecutionMode): Promise<void> => {
+    if (next === executionMode.mode || agentSession.status === 'starting') return
+    if (next === 'legacy' && isAgentSessionActive) {
+      if (!confirm(AGENT_STOP_ON_MODE_CHANGE_CONFIRM)) return
+      await agentSession.stop()
+    }
+    await executionMode.changeMode(next)
+  }
+  const bottomPanel: AppState['bottomPanel'] =
+    executionMode.mode === null ? 'none' : isAgentMode ? 'agent-terminal' : 'output'
+  const agentTerminal: AgentTerminalPanelState = {
+    controller: agentController,
+    session: agentSession,
+    layout: agentLayout
+  }
   // isUntracked(useDiffOperations.ts)は renderer 側の gitStatus.files から渡す
   // 設計のため、開いている diff タブの対象ファイルが gitStatus.files から消える
   // (.gitignore 追加・コミット等で追跡対象外になる)と、そのまま診断すると誤った
@@ -348,7 +438,9 @@
   })
   const clone = useCloneRepository({
     captureDirtySnapshot: fileSystem.captureDirtySnapshot,
-    confirmDiscardAnyDirty: fileSystem.confirmDiscardAnyDirty,
+    // clone はフォルダを切り替えるため、「フォルダを変更」と同じくエージェントの終了も確かめる
+    confirmDiscardAnyDirty: () =>
+      confirmStopAgent(AGENT_STOP_ON_FOLDER_CHANGE_CONFIRM) && fileSystem.confirmDiscardAnyDirty(),
     applyOpenedFolder: fileSystem.applyOpenedFolder,
     lock: fileOperationLock,
     isGitOperationRunning
@@ -428,6 +520,17 @@
     folderLoadError: fileSystem.folderLoadError,
     selectFile
   })
+  // 開いているタブの外部変更の検知(実行方式に関係なく常に有効)。diff タブの表示中は通知を出さない
+  const externalChangeBanner = useExternalFileChanges({
+    openFiles: fileSystem.openFiles,
+    activeFilePath: fileSystem.activeFilePath,
+    isFileTabActive: diffTabs.activeDiffTab === null,
+    getOpenFileSnapshot: fileSystem.getOpenFileSnapshot,
+    waitForPendingSave: fileSystem.waitForPendingSave,
+    replaceCleanTabWithDisk: fileSystem.replaceCleanTabWithDisk,
+    reloadOpenFile: fileSystem.reloadOpenFile,
+    marks: externalChangeMarks
+  })
   return {
     quickOpen,
     isLocked: fileOperationLock.isLocked,
@@ -470,6 +573,15 @@
     clone,
     mergeState,
     conflictFile,
-    isActiveFileConflicted
+    isActiveFileConflicted,
+    openFolder,
+    executionMode: executionMode.mode,
+    executionModeSaveError: executionMode.saveError,
+    isExecutionModeLocked: executionMode.mode === null || agentSession.status === 'starting',
+    selectExecutionMode,
+    promptRun,
+    bottomPanel,
+    agentTerminal,
+    externalChangeBanner
   }
 }
```

`src/renderer/src/App.tsx`（差分）:

```diff
--- a/src/renderer/src/App.tsx
+++ b/src/renderer/src/App.tsx
@@ -134,7 +134,15 @@
     clearHistory,
     runPrompt,
     rerunHistoryEntry,
-    quickOpen
+    quickOpen,
+    executionMode,
+    executionModeSaveError,
+    isExecutionModeLocked,
+    selectExecutionMode,
+    promptRun,
+    bottomPanel,
+    agentTerminal,
+    externalChangeBanner
   } = useAppState()

   // タブを開く操作(openDiffTab の呼び出し)と、diff 内容の取得(activeDiffTab の変化に対する
@@ -315,6 +323,13 @@
               modelSettings={modelSettings}
               modelSettingsLoaded={modelSettingsLoaded}
               onSaveModelSettings={saveModelSettings}
+              promptRun={promptRun}
+              executionMode={{
+                mode: executionMode,
+                saveError: executionModeSaveError,
+                isLocked: isExecutionModeLocked,
+                onSelect: (mode) => void selectExecutionMode(mode)
+              }}
             />
           )}
           <EditorPanel
@@ -353,6 +368,9 @@
             onUnstageHunk={unstageHunk}
             onDiscardHunk={discardHunk}
             canDiscardHunk={canDiscardHunk}
+            bottomPanel={bottomPanel}
+            agentTerminal={agentTerminal}
+            externalChangeBanner={externalChangeBanner}
           />
         </div>
       </div>
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/renderer 2>&1 | grep -E "Test Files|Tests |FAIL"
npm run typecheck
npx eslint src/renderer/src/hooks/useAppState.ts src/renderer/src/App.tsx src/renderer/src/hooks/__tests__/useAppState.test.ts
npx prettier --check src/renderer/src/hooks/useAppState.ts src/renderer/src/App.tsx src/renderer/src/hooks/__tests__/useAppState.test.ts
```

Expected: renderer のテストがすべて PASS（`useAppState` 87 件。`App*.test.tsx` は setup の stub が `legacy` を返すため、従来の方式の画面で通る）。typecheck（node・web）が通る

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 変異                                                                                                                                                                                                         | テストのファイル      | `-t`                             | 確認           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------- | -------------- |
| Q1  | `useAppState.ts` の `const confirmStopAgent = (message: string): boolean => !isAgentSessionActive \|\| confirm(message)` を `const confirmStopAgent = (message: string): boolean => confirm(message)` にする | `useAppState.test.ts` | `動いていなければ確認せずに開く` | 落ちた（1 件） |
| Q2  | `useAppState.ts` の `confirmStopAgent(AGENT_STOP_ON_FOLDER_CHANGE_CONFIRM) && fileSystem.confirmDiscardAnyDirty(),` を `fileSystem.confirmDiscardAnyDirty(),` にする                                         | `useAppState.test.ts` | `clone の確認でキャンセルしたら` | 落ちた（1 件） |
| Q3  | `useAppState.ts` の `if (next === executionMode.mode \|\| agentSession.status === 'starting') return` を `if (next === executionMode.mode) return` にする                                                    | `useAppState.test.ts` | `起動中は切り替えない`           | 落ちた（1 件） |
| Q4  | `useAppState.ts` の `await agentSession.stop()` を消す                                                                                                                                                       | `useAppState.test.ts` | `OK なら止めてから保存する`      | 落ちた（1 件） |
| Q5  | `useAppState.ts` の `executionMode.mode === null ? 'none' : isAgentMode ? 'agent-terminal' : 'output'` を `isAgentMode ? 'agent-terminal' : 'output'` にする                                                 | `useAppState.test.ts` | `実行方式の読み込み中は`         | 落ちた（1 件） |

- [ ] **Step 6: 開発版で起動して落ちないことを確かめ、止める**

```bash
npm run dev > /tmp/prompt-ide-dev.log 2>&1 &
```

renderer の dev サーバーが立つまで待ち（`until grep -q "dev server running" /tmp/prompt-ide-dev.log; do sleep 2; done` を Monitor で待つ）、さらに Electron のウィンドウが開くまで待ってから（`until pgrep -f "Desktop/prompt-ide/node_modules/electron/dist/Electron.app" > /dev/null; do sleep 2; done`）、`/tmp/prompt-ide-dev.log` に `Error`・`Unhandled` が無いことを確かめる。確認の後に止める（CLAUDE.md・メモリ「検証後はアプリを閉じる」）:

```bash
pgrep -fl "Desktop/prompt-ide.*(electron|electron-vite)"
pkill -f "Desktop/prompt-ide/node_modules/.bin/electron-vite dev"
pkill -f "Desktop/prompt-ide/node_modules/electron/dist/Electron.app"
pgrep -fl "Desktop/prompt-ide.*(electron|electron-vite)" || echo "stopped"
pgrep -fl "local/bin/claude" || echo "no claude"
```

Expected: `stopped`。`no claude`（このステップでは `起動` を押さない。実機の確認は AGT で利用者が行う）

- [ ] **Step 7: 確認コマンド（コミットしない）**

```bash
git status --short src
```

---

### Task 24: ROADMAP の更新・テスト仕様書への追記と Artifact の再公開・設計書の更新・全体検証

**Files:**

- Modify: `ROADMAP.md`、`docs/manual-test-spec.md`、`docs/superpowers/specs/2026-10-04-agent-terminal-mvp-design.md`
- 生成: `.superpowers/manual-test-spec.html`（git 管理外）

**Interfaces:**

- Consumes: Task 1〜23 の実装（文言は実装のファイルと突き合わせる。パターン 65・89）、`.superpowers/agent-terminal-mvp/spike-results.md`（Task 1）
- Produces: 設計書の「確認の結果」26 以降と本文の更新、ROADMAP の実装済みの項目・既知の制約（設計書と 1 対 1）、実機テスト仕様書の領域 `AGT`（AGT-001〜AGT-040）と既存の項目の前提の更新

- [ ] **Step 1: 設計書を更新する**

`docs/superpowers/specs/2026-10-04-agent-terminal-mvp-design.md` を次のとおり直す（設計の決定は変えない。実装で分かった事実と、プランの差異を反映する。パターン 32・133）:

1. 「確認の結果」の 25 の後に、次の 26〜33 を足す（各項目は、このプランの「設計書との差異」の該当の番号の文を、過去形・事実の記述にして写す。Task 1 の記録〈`spike-results.md`〉の版・結果を 27・28 に足す）:
   - 26: 差異 1（vitest 4 は `environmentMatchGlobs` を無視し、main のテストも jsdom で走る。jsdom で実物の node-pty が動く）
   - 27: 差異 2 と Task 1 の Step 3・5・6（引数つきの `npm install` は postinstall を走らせない・`npm ci` で作られる・Electron の node から pty が動く）
   - 28: 差異 3 と Task 1 の Step 7（ad-hoc 署名の成果物が起動しない・`-c.mac.identity=null` で作るとパッケージ版で pty が動く）
   - 29: 差異 4・7・8（入力欄の記号の後ろの U+00A0・カーソルは点滅しない・貼り付けの先頭の空白・タブ・日本語の表示）
   - 30: 差異 5（偽の Messages API での許可の確認の画面・応答の表示中・ツールの実行中）
   - 31: 差異 6（`navigator.clipboard`）
   - 32: 差異 9（Web Crypto の SHA-256 を書き込みの前に挟むと既存のテストの 60 件以上が失敗した）
   - 33: 差異 11（子を片付けずに終わるエージェントの `setsid` の孫が、グループへのシグナルだけでは残った）
2. 本文の該当箇所を直す:
   - 「プロンプトの送信」5・6・10: 入力欄の行の記号の後ろを「U+00A0（または空白）」にする（確認の結果 29）
   - 「保存の直前の照合」: 「`savedContent` の SHA-256（Web Crypto…）を基準として」を「`savedContent` の文字列を基準として」に、main は「同じ読み方の文字列で比べる」に、「OK: 従来の `fs:writeFile` で書き込み」を「OK: `fs:writeFileChecked(path, content, null)`（照合しない書き込み。削除されたファイルも作り直せる）で書き込み」に直す（確認の結果 32・差異 10）。IPC の表の `writeFileChecked(path, content, baseHash)` を `writeFileChecked(path, content, baseContent: string \| null)` に直す
   - 「停止の手順」3 の後に「4. 子の終了の後（猶予の内でも外でも）、1 で控えた子孫のうち生き残っているものに SIGKILL を送る（子を片付けずに終わる場合の孤児を残さない。確認の結果 33）」を足し、続く番号を 5 にする
   - 「責務とファイル構成」: `fileChangeGuard.ts` の説明を「ディスクの内容と renderer の基準の文字列の比較」に、`handlers/fileSystemHandlers.ts`（照合付きの保存・監視の登録）を `handlers/externalChangeHandlers.ts` に、`index.ts` の「`before-input-event` の調整」を外す。shared に `externalUrl.ts` を足す
   - 「IPC」の表の `startAgentSession` の error に `shellPathUnavailable?` を足す
   - 「実装の最初に確かめること」の各項目の末尾に、このプランの「実装の最初に確かめること（設計書の 1〜10 の扱い）」の表の結果を 1 文で足す（例: 3 は「確認の結果 30 で確認した」）
   - 「テスト方針」の「単体（vitest）」の main の環境の記述を「main のテストも jsdom で走る（確認の結果 26）」にする
3. 「既知の制約」を次のとおり直す（ROADMAP と 1 対 1 にするため、この文を Step 2 でそのまま写す）:
   - 「許可の確認の画面・ツールの実行中・応答の表示中に `実行` を押したときの挙動は未確認（文字列を入力できる確認画面では、消去・貼り付け・Enter が送られうる）。vim のモードの NORMAL での消去、画像の添付（`[Image #N]`）の消去も未確認」を、「選択肢の許可の確認の画面では何も送らないこと、ツールの実行中・応答の表示中の消去が作業を中断しないことは `claude` 2.1.288 で確認した。文字列を入力できる確認画面（許可の確認で Tab の amend を開いた状態など）では、消去・貼り付け・Enter が送られうる（未確認）。vim のモードの NORMAL での消去、画像の添付（`[Image #N]`）の消去は未確認」に置き換える（Task 1 の Step 8 で確かめたら、その結果に合わせる）
   - 「`claude` を SIGKILL まで使って止めた場合、…残りうる」の後に、「停止の直前に控えた子孫のうち、終了の後も生き残ったものへ SIGKILL を送るため、控えてから送るまで（最大で猶予の 3 秒）に pid が再利用されると、無関係なプロセスに届きうる」を足す
   - 「セッションは 1 ウィンドウに 1 つ。…」の後に、「同じフォルダを開き直したときは、終了の確認が出てもセッションは止まらない（main は同じフォルダへの切り替えを変更として扱わない）」を足す
   - 「Windows（ConPTY・…）、Linux（…）、署名・公証した macOS のパッケージは実機で未確認」の後に、「署名の ID が無いマシンでは、`npm run build:unpack` の成果物（ad-hoc 署名と hardened runtime）が起動しない。`npm run build && npx electron-builder --dir -c.mac.identity=null` で作る（署名の設定は MVP では変えない）」を足す
4. 「ドキュメント」の節の後に、「実装: `docs/superpowers/plans/2026-10-04-agent-terminal-mvp.md`（2026-10-04）」を足す

```bash
npx prettier --check docs/superpowers/specs/2026-10-04-agent-terminal-mvp-design.md || npx prettier --write docs/superpowers/specs/2026-10-04-agent-terminal-mvp-design.md
grep -n "baseHash\|SHA-256" docs/superpowers/specs/2026-10-04-agent-terminal-mvp-design.md
```

Expected: `baseHash` は 0 件。`SHA-256` は確認の結果 32（採らなかった理由）にだけ残る

- [ ] **Step 2: ROADMAP を更新する**

1. 冒頭の「### プロンプト実行の前提（エージェント CLI）」の段落の「未実装の最優先に MVP（下記）を置いています。」を「MVP（下記）を実装しました（2026-10-04）。」に直す
2. 「### Claude API 連携（プロンプト実行。テキスト生成型の旧方式）」の注記の「（MVP が入るまでは動作を変えずに残します）」を「（設定の「プロンプトの実行方式」で「従来の方式」を選ぶと使えます）」に直す
3. 「## 実装済み機能」の「### 設定」の後（`---` の前）に、次の節を足す:

```markdown
### エージェント CLI のアプリ内ターミナル実行（MVP）

- [x] エディタの領域の下部のターミナルパネル（xterm.js。開閉・最大化・起動・終了・状態の表示）で、開いているフォルダを作業ディレクトリに
      Claude Code（`claude`）を node-pty で起動する。1 ウィンドウに 1 セッション。起動のコマンド・作業ディレクトリ・環境変数は main が決める
- [x] プロンプトの `実行` で、変数を差し込んだ本文を起動中の `claude` の入力欄へ送る（書きかけを消してから貼り付け、本文が入ったことを画面で
      確かめてから Enter。確認画面・シェルのモード・確かめられないときは送らない。ファイル内容は添付しない）。セッションが無いときは押せず理由を表示する
- [x] セッションの後始末（終了・リロード・ウィンドウの破棄・フォルダの切り替え・実行方式の切り替え・アプリの終了。子孫のプロセスまで止める）
- [x] GUI から起動しても `claude` を見つける（ログインシェルの PATH。nvm などの配下を含む）
- [x] 外部変更の検知（保存の直前の照合と上書きの確認、未編集のタブの自動の再読込、編集中のタブへの通知、ウィンドウのフォーカスの復帰での再確認）
- [x] ターミナルのキー操作（`Ctrl+P` を奪わない・コピー・貼り付け・`F6` で抜ける・Windows・Linux のメニューのショートカットの抑止）
- [x] 実行方式の設定（エージェント CLI 方式〈既定〉／従来の API・非対話 CLI 方式）と、方式ごとの UI の出し分け（従来の方式の出力パネル・
      ツールの選択・履歴の再実行）
- [x] セキュリティの手当て（preload の汎用 IPC〈`window.electron`〉の撤去、IPC の入力の検証と送信元のフレームの確認、遷移・新しいウィンドウ・
      ターミナルのリンクの制限）
```

4. 「## MVP: エージェント CLI のアプリ内ターミナル実行」の節の、`**最低限の要件**` と `**MVP を成立させるために必要な周辺（設計で範囲を確定する）**` の下の 8 つの `- [ ]` を `- [x]` にし、節の最初の段落の後に「**実装済み**（2026-10-04。設計書 `docs/superpowers/specs/2026-10-04-agent-terminal-mvp-design.md`。実装済み機能の「エージェント CLI のアプリ内ターミナル実行（MVP）」）」を足す。`**MVP の対象外（MVP 後）**` の段落は残す（「エージェント実行の支援（MVP の次）」に候補がある）
5. 「### ファイル / ワークスペース管理」の `- [ ] ファイル変更の自動検知・ツリー自動更新（file watcher）` を `- [ ] ファイル変更の自動検知・ツリー自動更新（file watcher。開いているタブの外部変更の検知は MVP で実装済み。エクスプローラーのツリーとソース管理の自動更新・diff タブの取り直しは未実装）` に直す
6. 「## 改善・技術的負債」の末尾（AI 出力のエディタへの反映の既知の制約の後）に、次の見出しの行を足し、その下に Step 1 で直した設計書の「既知の制約」の箇条を、同じ順で 1 項目 1 行（` -` で始める。設計書で折り返している項目は折り返さずに 1 行にする）で写す:

```markdown
- [ ] 既知の制約（エージェント CLI のアプリ内ターミナル実行。設計書 `docs/superpowers/specs/2026-10-04-agent-terminal-mvp-design.md` の「既知の制約」と 1 対 1）:
```

ROADMAP と設計書の既知の制約が一致することを確かめる（パターン 115。設計書の折り返しは連結して比べる）:

```bash
diff <(awk '/^- \[ \] 既知の制約（エージェント CLI のアプリ内ターミナル実行/{f=1;next} f&&/^  - /{sub(/^  - /,"");print;next} f{exit}' ROADMAP.md) <(awk '/^## 既知の制約/{f=1;next} /^## /{f=0} f&&/^- /{if(s!="")print s; s=substr($0,3); next} f&&/^  [^ -]/{sub(/^ +/,""); s=s $0; next} END{if(s!="")print s}' docs/superpowers/specs/2026-10-04-agent-terminal-mvp-design.md) && echo SAME
grep -n "未実装の最優先に MVP\|MVP が入るまでは" ROADMAP.md || echo "old wording removed"
npx prettier --check ROADMAP.md || npx prettier --write ROADMAP.md
```

Expected: `SAME`（設計書の既知の制約は Step 1 の変更の後で 25 項目）。`old wording removed`。prettier の後にもう一度 `diff` を流して `SAME` を確かめる

- [ ] **Step 3: 実機テスト仕様書を更新する**

`docs/manual-test-spec.md`:

1. `BASE-007` の期待結果を「サイドバーの見出しが `設定` に変わり `プロンプトの実行方式`・`Anthropic API キー`・`モデル` の 3 つのセクションが表示される」に直す（ID は変えない）
2. 次の領域・機能の先頭（見出しの直後）に、`> 前提:` の行を 1 行足す（期待結果は変えない。ID は変えない。設計書「既存の導線への影響」の最後の段落）:
   - `## プロンプトの実行と実行履歴`・`## 出力`・`## AI 出力のエディタへの反映`（領域の見出しの直後）: `> 前提: 設定パネルの「プロンプトの実行方式」で「従来の方式」を選んでから行う（既定のエージェント CLI 方式では、出力パネル・実行ツールの選択・履歴の再実行が出ない）。`
   - `## プロンプト管理` の `### 変数テンプレート`（既存の `> 前提:` の次の行）: `> 前提: 実行まで確かめる項目（PRM-069〜071）は、設定の実行方式を「従来の方式」にしてから行う。エージェント CLI 方式での変数の差し込みは AGT-008 で確かめる。`
3. `## AI 出力のエディタへの反映` の領域の最後（`APL-027` の後、`## ソース管理（基本）` の前）に、次の領域を足す。書式は仕様書の冒頭と `scripts/build-manual-test-spec.mjs` に従う（1 行 1 項目・ID は AGT-001 から昇順・最初の「→」で手順と期待結果を区切る・ID は以後変えない）。文言は実装と突き合わせる（`lib/agentSessionMessages.ts`・`lib/agentSendMessages.ts`・`hooks/useFileEditing.ts`・`hooks/useExternalFileChanges.ts`・`components/editor/ExternalChangeBanner.tsx`・`components/agent/AgentTerminalPanel.tsx`。パターン 65・89）

```markdown
## エージェント CLI のアプリ内ターミナル

> 前提: Claude Code（`claude`）がインストールされログイン済み。テスト用のフォルダ（Git リポジトリ。`memo.txt` などのテキストファイルを含む）を用意し、アプリの「フォルダを開く」で開く。設定の実行方式はエージェント CLI（既定）。エージェントにファイルを書き換えさせる項目は、テスト用のフォルダの中だけで行う。
> 前提: `pgrep -fl claude` で確かめる項目は、事前にほかの端末などで動いている `claude` の pid を控え、それ以外が残っていないかを見る。プロンプトは「プロンプト」パネルに登録したもの（例: タイトル `挨拶`・内容 `このフォルダのファイルを一覧して`）を使う。

### 起動と終了

- [ ] **AGT-001** パッケージ版を作り（署名の ID が無いマシンでは `npm run build && npx electron-builder --dir -c.mac.identity=null`）、Finder から起動してフォルダを開き、ターミナルパネルの `起動` を押す → そのフォルダを作業ディレクトリに `claude` の画面が表示される（`~/.local/bin`・nvm の配下にある `claude` でも見つかる）
- [ ] **AGT-002** フォルダを開かずにエディタの下部のパネルを見る → `起動` が押せず、帯に `フォルダを開いてください` が表示される
- [ ] **AGT-003** `claude` を一時的に見つからなくして（例: `~/.local/bin/claude` の名前を変える）`起動` を押す → `claude コマンドが見つかりません。Claude Code をインストールしてください（探した場所: ログインシェルの PATH）` が表示される（確認の後に名前を戻す）
- [ ] **AGT-004** `起動` を押して帯の状態を見てから `終了` を押す → 状態が `起動中` から `終了しました（終了コード N）` に変わり、`pgrep -fl claude` に起動した `claude` が残らない
- [ ] **AGT-005** `claude` の入力欄で `/exit` を送信する（別の回に `Ctrl+D` を 2 回でも）→ 帯が `終了しました（終了コード 0）` になり、画面の出力は残り、`起動` で起動し直せる
- [ ] **AGT-006** エージェントに Bash で `sleep 300` を実行させている間に `終了` を押す → `pgrep -fl "sleep 300"` に残らない

### プロンプトの送信

- [ ] **AGT-007** ログイン済みの `claude` を起動し、入力欄が空のときにプロンプトの `実行` を押す → 本文が入力欄に入って送信され、エージェントが作業を始める。`エージェントに送信しました` が表示される（`エージェントの入力欄を空にできませんでした…` が出たら、空の入力欄に出ている案内の文字を記録する）
- [ ] **AGT-008** 複数行のプロンプトと、`{{name}}` を含むプロンプト（変数のフォームで値を入れる）の `実行` を押す → それぞれ改行を保った 1 つの入力として送信され、変数は差し込んだ値で送られる
- [ ] **AGT-009** 40 行以上のプロンプトの `実行` を押す → 入力欄に `[Pasted text #1 +N lines]` と表示されて送信される
- [ ] **AGT-010** エージェントの作業中にプロンプトの `実行` を押す → 作業は中断されず、本文はキューに入る（`Press up to edit queued messages`）
- [ ] **AGT-011** 入力欄に `abc` を書きかけてからプロンプトの `実行` を押す → `abc` が消えてプロンプトの本文だけが送信され、`エージェントに送信しました（入力欄に書きかけがあったようなので、消してから送りました）` が表示される
- [ ] **AGT-012** 入力欄に複数行（`\` に続けて Enter で改行）を書きかけ、カーソルを 1 行目の途中に動かしてからプロンプトの `実行` を押す → 全部の行が消え、本文だけが送信される
- [ ] **AGT-013** 40 行以上の文字列を入力欄に貼り付けて（`[Pasted text #1 +N lines]`）からプロンプトの `実行` を押す → 貼り付けた分が消え、本文だけが送信される
- [ ] **AGT-014** 入力欄で `!` を押してシェルのモードにしてからプロンプトの `実行` を押す → 通常の入力欄（`❯`）に戻り、本文がエージェントへ送信される（シェルのコマンドとして実行されない）
- [ ] **AGT-015** エージェントの作業中に入力欄へ書きかけてからプロンプトの `実行` を押す → 作業は中断されず（`Interrupted` が出ない）、書きかけが消えて本文がキューに入る
- [ ] **AGT-016** 先頭が `!` のプロンプト（例: `!ls`）の `実行` を押す → 何も送られず、`先頭が「!」のプロンプトは、エージェントのシェルのコマンドとして実行されるため送信できません（先頭に空白を入れると送れます）` が表示される
- [ ] **AGT-017** 信頼していない新しいフォルダを開いて `起動` し、信頼の確認の画面が出ている間にプロンプトの `実行` を押す → 選択肢は確定されず（`claude` は終了しない）、`エージェントの入力欄が見つかりません。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください` が表示される
- [ ] **AGT-018** `claude` で `/model` の選択の画面を開いた状態でプロンプトの `実行` を押す → 画面の選択肢は変わらず、`エージェントの入力欄が見つかりません…` が表示される
- [ ] **AGT-019** エージェントがツールの許可の確認（`Do you want to proceed?`）を出している間にプロンプトの `実行` を押す → 選択肢は確定されず、`エージェントの入力欄が見つかりません…` が表示される
- [ ] **AGT-020** セッションが無いときにプロンプトパネルを見る → `実行` が押せず、パネルの上部に `エージェントが起動していません（ターミナルの「起動」を押してください）` が 1 か所だけ表示される。VoiceOver で `実行` に移ると理由が読まれる
- [ ] **AGT-021** 実行履歴の項目を選んで詳細を見る → `再実行` が押せず、`エージェント CLI 方式では再実行できません（設定で従来の方式に切り替えると使えます）` が表示される

### 後始末

- [ ] **AGT-022** エージェントの作業中（Bash で `sleep 300` の実行中）に View > Reload を押す → ターミナルが未起動の状態に戻り、`pgrep -fl claude` と `pgrep -fl "sleep 300"` に残らない
- [ ] **AGT-023** セッションの実行中にウィンドウを閉じる（macOS）、別の回にアプリを終了する（Cmd+Q）→ どちらも `claude` と子プロセスが残らない（アプリの終了は約 4 秒以内に終わる）
- [ ] **AGT-024** セッションの実行中にエクスプローラーの「フォルダを変更」を押す → `フォルダを切り替えると、実行中のエージェントを終了します。続けますか？` が出る。キャンセルすると何も変わらず、OK で別のフォルダを選ぶとセッションが止まり（帯が `終了しました…`）、新しいフォルダが開く
- [ ] **AGT-025** セッションの実行中に「リポジトリを clone」の `clone` を押す → AGT-024 と同じ確認が出て、キャンセルすると clone が始まらない
- [ ] **AGT-026** セッションの実行中に設定の「プロンプトの実行方式」で「従来の方式」を選ぶ → `従来の方式に切り替えると、実行中のエージェントを終了します。続けますか？` が出る。OK で、セッションが止まり、ターミナルパネルの代わりに出力パネル、プロンプトパネルに実行ツールの選択が戻り、従来どおり実行できる。もう一度「エージェント CLI」を選ぶとターミナルパネルに戻る

### 外部変更

- [ ] **AGT-027** 未編集のタブで開いている `memo.txt` をエージェントに書き換えさせる → 1 秒以内にタブの内容がディスクの内容になる。Cmd+Z で書き換えの前の内容に戻る（戻すとタブは未保存になる）。カーソルとスクロールの位置を記録する
- [ ] **AGT-028** `memo.txt` を編集したまま（未保存）エージェントに書き換えさせる → 内容は変わらず、エディタの上に `ディスク上のファイルが変更されました（エージェントなどによる変更）。` が出る。Cmd+S で `このファイルは、最後に読み込んだ後にディスク上で変更されています（エージェントなどによる変更）。上書きして保存すると、その変更は失われます。上書きして保存しますか？` が出て、キャンセルすると保存されない（OK なら上書きされる）
- [ ] **AGT-029** AGT-028 の通知の `ディスクの内容を読み込む` を押す → `保存されていない変更は失われます。ディスクの内容を読み込みますか？` の後に、タブがディスクの内容になり、通知が消える。`このまま編集する` では通知だけが消える
- [ ] **AGT-030** `memo.txt` を編集したままターミナルで `rm memo.txt` を実行させる → `ディスク上のファイルが削除されました。` が出る。Cmd+S で `このファイルは、ディスク上で削除されています。保存すると、もう一度作成されます。保存しますか？` が出て、OK でファイルが作り直される。未編集のタブで開いていたファイルを削除させると、タブが閉じる
- [ ] **AGT-031** 未編集のタブのファイルを外部のエディタで書き換えてからアプリに戻る（ウィンドウのフォーカスの復帰）→ タブの内容が更新される
- [ ] **AGT-032** `memo.txt` を編集して Cmd+S で保存した直後 → 外部変更の通知も上書きの確認も出ない

### キー・表示

- [ ] **AGT-033** ターミナルをクリックしてから `Ctrl+P` を押す → クイックオープンは開かず、`claude` の入力の履歴が動く。`Cmd+P` はクイックオープンを開く
- [ ] **AGT-034** ターミナルの中で `F6` を押す → パネルの帯の開閉のボタン（`エージェント`）へフォーカスが移る
- [ ] **AGT-035** ターミナルで範囲を選んで `Cmd+C`、エディタで `Cmd+V` → 選んだ文字列が貼られる。エディタでコピーした文字列をターミナルで `Cmd+V` → `claude` の入力欄に入る
- [ ] **AGT-036** ターミナルで日本語を IME で入力する → 変換・確定ができ、`claude` の入力欄に入る
- [ ] **AGT-037** パネルの開閉・`最大化`・`元に戻す`・ウィンドウの大きさの変更をする → `claude` の画面の枠が幅に合わせて描き直され、最大化の間はタブとエディタが隠れ、戻すとエディタが元の大きさで表示される
- [ ] **AGT-038** `claude` の出力の `https://` のリンク（OSC 8 で下線付きのもの）をクリックする → 既定のブラウザで開く。`file:` のリンクは開かない
- [ ] **AGT-039** タッチ操作でパネルの帯のボタン（開閉・`起動`・`終了`・`最大化`）を押す → 押せる（32px 以上）
- [ ] **AGT-040** ウィンドウの幅を 600px 程度に狭める → パネルの帯が 1 行に収まり（状態の文言は省略される）、ボタンが押せる
```

```bash
node scripts/build-manual-test-spec.mjs
npx vitest run scripts
npx prettier --check docs/manual-test-spec.md || npx prettier --write docs/manual-test-spec.md
grep -c "\*\*AGT-" docs/manual-test-spec.md
```

Expected: HTML を書き出した旨の出力。`scripts` のテストが通る（ID の一意性・接頭辞ごとの昇順・書式）。`40`

Artifact（<manual-test-spec-artifact-url>）の再公開は、親（コントローラー）が同じファイルパス `.superpowers/manual-test-spec.html` で行う（サブエージェントは Artifact のツールを持たない場合がある。持っていれば同じファイルパスで再公開する）。

- [ ] **Step 4: 全体を検証する**

```bash
npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL"
npm run typecheck
git status --short
npx eslint $(git status --short | awk '{print $2}' | grep -E '\.(ts|tsx)$')
npx prettier --check $(git status --short | awk '{print $2}' | grep -E '\.(ts|tsx|css|md|yml)$' | grep -v 'agentScreens.json')
grep -rnP '[\x{00A0}\x{200B}\x{FEFF}\x{0080}-\x{009F}]' src || echo "no invisible chars"
npx vitest run scripts
pgrep -fl "local/bin/claude|sleep 60|sleep 300|PROMPT_IDE_PATH" || echo "no leftover"
```

Expected: 全体のテストが PASS（プラン作成時の写しで 376 ファイル・6611 件。適用前は 331 ファイル・6139 件）。typecheck が通る。eslint のエラー 0。prettier が通る（`git status --short` の未追跡のディレクトリは、その中のファイルを個別に並べる）。`no invisible chars`。`no leftover`

- [ ] **Step 5: 確認コマンド（コミットしない）**

```bash
git status --short
git diff --stat
```

Expected: 変更は Task 1〜24 のファイルだけ（`ROADMAP.md`・設計書は作業前からの未コミットの変更を含む）。コミット・プッシュはユーザーの指示まで行わない

---

## Self-Review

**Spec coverage:** 「設計書の要件の網羅（要件 → Task）」の表のとおり、設計書の「含める」の 10 項目、「決定した点」1〜5、C1〜C21、IPC の表の 14 の API、「停止の契機」の 8 行、「エラー処理」の 12 行、「キーバインドとフォーカス」の 7 項目、「セキュリティ」の 10 項目、「パッケージング」の 5 項目、「テスト方針」、「実装の最初に確かめること」1〜10、「ドキュメント」をすべていずれかの Task に割り当てた。範囲外（「含めない」）のもの（複数セッション・`claude` 以外・履歴への記録・キャンセルの UI・旧方式の整理・ツリーの自動更新・diff タブの取り直し・状態の表示・`--continue`・許可のモード）はどの Task でも実装しない。

**Placeholder scan:** TBD・TODO・「適切に処理する」・「同様に」は無い。新しいファイルは全文、既存のファイルは `diff -u` の差分（プラン作成時の検証用の写しから機械的に埋め込んだもの。prettier でプランを整形すると差分の空の文脈行の行頭の空白が落ちるので、`git apply` せず読んで当てる）、CSS は追加する規則の全文と、セレクタの並びへの追加の差分で示した。変異は、置き換える前と後の式・落ちるテストのファイル・`-t`・プラン作成時の確認の結果を表にした。

**Type consistency:** shared の型（Task 2）→ main の `AgentLaunchPlan`・`AgentLaunchResolution`（Task 4）→ `PtyLike`・`PtySpawn`・`StopTree`・`AgentSession`・`AgentSessionRegistry`・`AgentSessionCreation`（Task 6）→ `registerAgentTerminalHandlers` の `AgentTerminalHandlerDeps`（Task 8）→ `ipcHandlers` の配線（Task 12）、`WriteFileCheckedResult`（Task 2）→ `registerExternalChangeHandlers`（Task 11）→ preload `writeFileChecked`・`fileSystemApi.writeFileContentChecked`（Task 12）→ `useFileEditing`（Task 17）、`ViewportLine`・`InputBox`（Task 13）→ `AgentSendTarget`（Task 14）→ `AgentTerminalController`（Task 16）→ `useAgentSession`・`useAgentPromptSender`（Task 19・20）→ `AgentTerminalPanelState`（Task 21）→ `PromptRunPanelState`（Task 22）→ `useAppState`（Task 23）の名前と型が、各タスクの Interfaces と埋め込んだコードで一致することを、検証用の写しの `npm run typecheck` で確かめた。

**既存の名前の確認:** プランが使う既存の名前は現行のコード（943aff2 + 未コミットの文書）で確かめた: `FolderAccessManager`（`set`・`get`・`delete`・`assertWithinFolder`・`assertParentWithinFolder`）・`getAllowedFolder`・`assertFileAccess`・`assertFileWithinFolder`（`handlers/fileAccessGuard.ts`）・`convertFsAccessError`・`isMissingPathError`・`readFileContent`・`writeFileContent`・`readSettingsFile`・`writeSettingsFile`・`assertPlainObject`・`setupCloneLifecycle` の `did-start-navigation` の条件、preload の `onPromptStreamChunk` の作り、renderer の `useFileEditing`（`readOpenFile`・`getGeneration`・`saveTracking`・`pendingSaveFor`）・`useFileSystem`（`openFilesMirrorRef`・`activeFilePathMirrorRef`・`setOpenFilesAndFixActive`・`invalidateSaveStateOfTab`・`findFile`・`confirmDiscardAnyDirty`・`reloadOpenFile`）・`useQuickOpen` の capture のハンドラ（`useQuickOpen.ts:279-314`）・`usePromptRunner`・`useAppState` の spread と差し替えの順序・`useCloneRepository` の `confirmDiscardAnyDirty`・`EditorPanel` の props と `Editor` の `key`・`PromptsPanel`/`PromptItem`/`PromptItemView`/`PromptVariablesForm`・`HistoryPanel`/`HistoryDetail`・`SettingsPanel`・`Sidebar` の props・`useTransientNotice`・`toAnnouncementText`・`Announcement`・`toComparablePath`・`useLatestRef`・`main.css` の共通の枠付きボタンの規則。

**検証の記録:** 検証用の写しで、Task 1〜23 のコードを当てた状態の `npx vitest run` が 376 ファイル・6611 件で成功、`npm run typecheck` が成功、変更したファイル（140）への `npx eslint` の指摘が 0、`npx prettier --check` が成功。変異は 109 件を入れ、108 件が落ち、1 件（F4）は等価な変異（呼び出し側が未編集の控えを渡すため、`savedContent` の照合と未編集の判定で同じ結果になる）として残した。手で入れた確認: 実物の node-pty（jsdom・Electron の node・パッケージ版の `app.asar`）、`npm ci`、`claude` 2.1.288 の 28 の画面、偽の Messages API での許可の確認・応答の表示中・ツールの実行中、Electron の `navigator.clipboard`、`npm run build:unpack` 相当の成果物の起動（ad-hoc 署名では起動しない・`-c.mac.identity=null` では起動する）。起動したプロセス（`claude`・Electron・パッケージ版のアプリ・ログインシェル・偽のエージェント）は止め、`pgrep -fl` で残っていないことを確かめた。
