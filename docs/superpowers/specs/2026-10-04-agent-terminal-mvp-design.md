# エージェント CLI のアプリ内ターミナル実行（MVP）設計書

作成日: 2026-10-04 / 対象: ROADMAP の「MVP: エージェント CLI のアプリ内ターミナル実行」（「プロンプト実行の前提（エージェント CLI）」を満たす最小の機能）

## 目的

ROADMAP の前提を「プロンプト実行 = 自律的にファイルを編集するエージェント CLI を、アプリ内のターミナルで動かす」に改めた。現在の実装は、
Claude API または `claude --print` を非対話で 1 回呼び、応答の Markdown を出力パネルに出す（テキスト生成型の旧方式）。この方式ではエージェントが
ファイルを編集できず、許可の確認にも応答できない。

この MVP では、エディタの領域に xterm.js のターミナルを置き、開いているフォルダで `claude` を擬似端末（node-pty）で起動する。プロンプトのボタンを
押すと、起動中の `claude` の入力欄にプロンプトを貼り付けて送信し、エージェントが実行を始める。エージェントがディスクを書き換えても、開いている
タブが古い内容のまま保存してエージェントの変更を消さないよう、外部変更の検知も同時に入れる。旧方式は設定で切り替えて並存させる。

## 範囲

### 含める

- 1 ウィンドウに 1 つのエージェントのセッション（`claude` を node-pty で起動）。作業ディレクトリは開いているフォルダ。起動のコマンド・作業ディレクトリ・
  環境変数は main が決める
  - 注記（2026-10-09）: 複数セッション / タブの設計書 `2026-10-09-agent-multi-session-tabs-design.md` で、1 ウィンドウに最大 4 セッションへ広げた
- エディタの領域の下部のターミナルパネル（xterm.js。開閉・最大化・起動・終了）
- プロンプトの実行ボタン（変数の差し込みを含む）から、起動中のセッションの入力欄への貼り付けと送信。入力欄に書きかけの文字があれば、
  消してから貼り付ける（上書き）
- セッションの後始末: 終了ボタン、renderer のリロード、ウィンドウの破棄、フォルダの切り替え、実行方式の切り替え、アプリの終了。子孫のプロセスを残さない
- GUI から起動したアプリでも `claude` が見つかること（ログインシェルの `PATH` の取得。nvm などの配下を含む）
- 外部変更の検知: 保存の直前の照合と上書きの確認、未編集のタブの自動の再読込、編集中のタブへの通知（実行方式に関係なく常に有効）
- ターミナルにフォーカスがあるときの、アプリのショートカットとの衝突の回避、コピー・貼り付け、フォーカスの出入り
- 実行方式の設定（エージェント CLI 方式〈既定〉／従来の方式）と、方式ごとの UI の出し分け
- セキュリティの手当て（preload の汎用 IPC の撤去、IPC の入力検証、外部リンク・遷移の制限）
- node-pty の導入とパッケージング（macOS で確認。Windows・Linux は未確認として記録）

### 含めない（ROADMAP の「MVP の対象外」と、この設計で範囲外にしたもの）

- 複数セッション・タブ・分割表示、`claude` 以外のエージェント CLI（起動コマンドの設定）
- 実行履歴へのセッション・送信の記録、実行のキャンセル UI（エージェント側の操作 = ターミナルで `Esc` に任せる）、旧方式の整理・削除
- エクスプローラーのツリーとソース管理の自動更新（ROADMAP の「ファイル変更の自動検知・ツリー自動更新（file watcher）」。監視は開いているタブに
  限る。後述の「決定した点」4）
- diff タブの内容の自動更新（既存の挙動のまま）
- エージェントの状態（作業中・許可待ち・完了）の表示、セッションの中断と再開（`claude --continue`）、エージェントの許可モードの設定

## 設計の前提（利用者の決定）

- プロンプト実行は、自律的にファイルを編集するエージェント AI の CLI を使う。API を直接呼ばず、CLI をターミナルで呼び出す。ターミナルはアプリ内（エディタの領域）に表示する
- プロンプトのボタンを押すと、起動中のセッションのエージェント CLI の入力欄にプロンプトが貼り付けられ、エージェントが実行を開始する
- 対象は Claude Code（`claude`）のみ
- 従来の API・非対話 CLI 方式は、設定で実行方式を切り替えて並存させる。既定はエージェント CLI 方式
- 外部変更の検知（保存前に上書き確認・未編集タブの自動再読込）を MVP に含める
- 対象外: 複数セッション/タブ、claude 以外の CLI、実行履歴へのセッション記録、実行のキャンセル UI、旧方式の整理
- セッションが無いとき、プロンプトの `実行` は押せなくして理由を表示する（「決定した点」1）
- 入力欄に書きかけの文字があるとき、プロンプトの `実行` は**入力欄を完全に上書きする**（書きかけの文字を消してから貼り付ける。「決定した点」2）
- エージェント CLI 方式のとき、履歴の `再実行` は押せなくして理由を表示する（「決定した点」5）

## 完了条件（観察できる形）

Electron の実機（macOS）で、次がすべて観察できたら MVP の完了とする。手順は手動テスト仕様の `AGT` の項目にする（後述の案）。

1. Finder から起動したパッケージ版（`npm run build:unpack` の成果物。署名の ID が無いマシンでは確認の結果 28 の手順で作る）で、フォルダを開いてターミナルパネルの `起動` を押すと、そのフォルダを作業ディレクトリに
   `claude` の画面が表示される（`~/.local/bin` や nvm の配下にある `claude` も見つかる）
2. プロンプトの `実行` を押すと、`claude` の入力欄に本文が入り、そのまま送信されてエージェントが作業を始める（複数行・`{{変数}}` の差し込み後の本文を含む）
3. セッションが無いときは `実行` が押せず、理由が画面に表示される
4. 確認画面（フォルダの信頼の確認など）が出ている間に `実行` を押しても、確認画面の選択肢が選ばれない（キーも Enter も送られない）
5. 入力欄に書きかけの文字（複数行・`[Pasted text #N …]` を含む）があるときに `実行` を押すと、書きかけの文字が消えてプロンプトの本文だけが送信される。
   エージェントの作業中に押しても作業は中断されず、本文はキューに入る
6. ターミナルの `終了`・View > Reload・ウィンドウを閉じる・アプリの終了・フォルダの切り替えの後、`claude` とエージェントが起動した子プロセスが残らない（`pgrep` で確かめる）
7. エージェントが書き換えたファイルを未編集のタブで開いていると、タブの内容が自動でディスクの内容になる。編集中のタブでは通知が出て、そのまま保存しようとすると上書きの確認が出る
8. ターミナルにフォーカスがあるとき、`Ctrl+P` がクイックオープンを開かずにターミナルへ届く
9. 設定で従来の方式に切り替えると、従来どおり API・CLI で実行して出力パネルに表示できる。エージェント CLI 方式では履歴の `再実行` が押せず、理由が表示される

## 確認の結果（設計時に実測。2026-10-04）

macOS 26.6（arm64）・Electron 39.8.10・node v24.14.1・Claude Code 2.1.288（`$HOME/.local/bin/claude`。Mach-O の arm64 バイナリ）・node-pty 1.1.0・
`@xterm/xterm` 6.0.0・`@xterm/addon-fit` 0.11.0・`@xterm/headless` 6.0.0・electron-builder 26.8.1・`@electron/rebuild` 4.0.4 で、scratchpad の一時ディレクトリで確かめた
（リポジトリの package.json・node_modules は変えていない）。`claude` は隔離した設定ディレクトリ（`CLAUDE_CONFIG_DIR`）・ダミーの API キー・
閉じたローカルのポート（`ANTHROPIC_BASE_URL=http://127.0.0.1:9`）で起動し、Anthropic の API には接続していない（送信は `Connection refused` で失敗する）。
起動したプロセスはすべて止め、`pgrep -fl` で残っていないことを確かめた。衝突調査（`.superpowers/agent-terminal-mvp/collision-report.md`）の記述のうち、
設計に使う事実はここで再確認した。

1. **node-pty と Electron 39**: npm の node-pty 1.1.0 は N-API で、`prebuilds/` に darwin-arm64・darwin-x64・win32-arm64・win32-x64 があり、linux は無い。
   `prebuilds/darwin-arm64/spawn-helper` は実行権限が無く（`-rw-r--r--`）、Electron（`ELECTRON_RUN_AS_NODE=1`）から `pty.spawn` すると
   `Error: posix_spawnp failed.` になった（衝突調査の結果を再現）。`chmod +x` で `/bin/echo` の出力と終了コード 0 を得た。
   `electron-rebuild -v 39.8.10 -o node-pty` と、このリポジトリの postinstall と同じ `electron-builder install-app-deps`（`electron` を devDependencies に
   置いた一時ディレクトリ）のどちらでも、ソースから `build/Release/{pty.node,spawn-helper}` が実行権限付きで作られ、prebuild より先に読まれて動いた。
   Electron 向けに作った `pty.node` は、素の node v24 からも読み込めた（N-API のため。vitest の main のテストから実物の pty を使える）
2. **パッケージ版**: `node-pty` を dependencies に置いた最小のアプリを electron-builder 26.8.1 の `--dir`（`npmRebuild: false`、`asarUnpack` は空、
   署名なし）で作ると、`app.asar.unpacked/node_modules/node-pty/` に `build/Release/{pty.node,spawn-helper}`（実行権限付き）と全 OS の prebuilds が
   自動で展開された（`asarUnpack` の明示が無くても展開された）。そのアプリを launchd 経由（`launchctl submit`。後述の GUI 相当の環境）で起動し、
   pty で `/bin/echo` を実行できた（`node-pty` は `app.asar` から読まれ、`spawn-helper` は `app.asar.unpacked` から使われた）。mac の成果物に
   win32 の prebuilds も入っていた
3. **GUI から起動したときの環境**: launchd 経由で起動した Electron の `process.env` は `PATH=/usr/bin:/bin:/usr/sbin:/sbin`・`SHELL=/bin/zsh`・`HOME`・`cwd=/` で、
   `LANG`・`TERM` は無かった（ターミナルから `open -a` で起動すると、呼び出し元の環境がそのまま渡り、GUI の起動の再現にならなかった）。この環境では
   `claude`（`~/.local/bin`）も nvm の配下も `PATH` に無い。ログインシェルの PATH は、`zsh -l -c` では `~/.local/bin` と nvm を含まず
   （この環境では両方とも `~/.zshrc` で足している。`~/.zprofile`・`~/.zshenv` は無い）、`zsh -l -i -c` では両方を含んだ。端末なし（標準入力は `/dev/null`）の
   `env -i HOME=… /bin/zsh -l -i -c 'printf …"$PATH"…'` は 3 回とも約 0.33 秒で PATH を返した
4. **node-pty の起動失敗**: macOS の node-pty 1.1.0 は、存在しないコマンド（`claude` が PATH に無い・存在しない絶対パス）でも、存在しない `cwd` でも
   例外を投げず、出力なしで終了コード 1 になった。`claude` 自身の終了コード 1（後述 6 の「No, exit」）と区別できない
5. **`claude` の起動直後の出力**: 起動から約 0.1〜0.4 秒で `ESC[?25l`（カーソル非表示）・`ESC[?2004h`（bracketed paste の有効化）・`ESC[?1004h`（フォーカスの通知）・
   `ESC[?u`（kitty のキーボードプロトコルの問い合わせ）・`ESC[c`（DA1 の問い合わせ）を出した。画面が切り替わるたびに `ESC[?2004l` → `ESC[?2004h` を出し直し、
   メインの画面に入るとき `ESC[?1049h`（代替画面）と `OSC 0`（タイトル `✳ Claude Code`）を出した。`?2004h` はオンボーディング・信頼の確認の画面でも有効で、
   「入力欄が使える」ことの合図にはならない。タイトルは作業中も変わらなかった（作業中の判定にも使えない）
6. **起動時の確認画面と Enter**: 未設定の状態では、テーマの選択 → API キーの使用の確認（既定は `No (recommended)`）→ セキュリティの注意 → フォルダの信頼の確認の順に出た。
   **フォルダの信頼の確認は既定の選択が `No, exit` で、Enter を送ると `claude` は終了コード 1 で終了した**。テーマの選択の画面で貼り付けた文字列は無視された。
   API キーの確認で `No` のまま進むと、ログインの方法の選択からブラウザでのサインインの開始（`Opening browser to sign in…`）まで進んだ（サインインはしていない）。
   どの確認画面でも、Enter は表示中の選択肢を確定する
7. **入力欄への貼り付け**: メインの入力欄で、`ESC[200~` + 本文 + `ESC[201~` を送ると、複数行の本文が 1 つの入力として入り、送信されなかった。本文の中の
   `\n`・`\r`・`\r\n` はどれも改行として入り、タブは空白 4 つになった。40 行と 60 行の貼り付けは入力欄に `[Pasted text #1 +39 lines]` のように畳まれた。
   **入力欄に書きかけの文字列（`abc`）があると、貼り付けはその後ろに連結された（`abcline1`）**。`Ctrl+U` は最後の行だけを消した（1 回のとき。繰り返しは後述 15）。`Ctrl+C` は複数行の入力を
   すべて消して `Press Ctrl-C again to exit` を出し、**約 0.6 秒後の 2 回目の `Ctrl+C` は、入力欄に文字列があっても `claude` を終了させた**（3 秒空けると終了しなかった）
8. **貼り付けと Enter**: 貼り付けと `\r` を 1 回の書き込みで送っても、貼り付けた本文がそのまま送信された（短い本文と、約 150KB・2000 行の本文の両方）。
   エージェントの作業中（API の再試行中）に貼り付け + `\r` を送ると、入力はキューに入り `Press up to edit queued messages` が出た（取りこぼしは無かった）。
   貼り付けた本文（先頭の行、または `[Pasted text #N`）は、送ってから 13〜24ms で画面（`@xterm/headless` のバッファ）に現れた。
   フォルダの信頼の確認の画面では、貼り付けた本文は 1.5 秒待っても画面に現れなかった
9. **プロセスの終了**: node-pty の子は新しいセッションのリーダー（`pgid = pid`）になる。`claude` の `!`（Bash モード）で実行した `sleep` は、`claude` とは
   **別のセッション**（`zsh -c` が `Ss`）で動いていた。`pty.kill()`（SIGHUP）でも、`claude` のプロセスグループへの SIGTERM でも、`claude` は終了し（終了コード
   129 / 143）、3 秒以内に `sleep` も消えた。**`claude` のプロセスグループへの SIGKILL では、`claude` だけが止まり、別のセッションの `zsh -c` と `sleep` が孤児
   （PPID 1）として残った**。pty を持つ親（node）を SIGKILL すると、`claude` と `sleep` はどちらも消えた（pty の終了で SIGHUP が届く）。参考: シェルの
   バックグラウンドの子（同じプロセスグループ）はグループへの SIGTERM で止まるが、`setpgrp`・`setsid` で抜けた子はグループへのシグナルでも SIGHUP でも残った
10. **xterm.js と React 19・CSP**: このリポジトリと同じ CSP（`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`）の
    ページで、`StrictMode` の React 19 のコンポーネントが `useEffect` で `new Terminal()` → `loadAddon(new FitAddon())` → `open()` → `fit()` し、後始末で
    `dispose()` する最小の形を Electron 39 で表示した。CSP の違反のコンソール出力は無く、日本語を含む出力が描画された（スクリーンショットで確認）。
    `StrictMode` の二重マウントで、マウント 2 回・破棄 1 回・`.xterm` の要素 1 つになり、**pty の起動の依頼も 2 回届いた**（main 側で 2 回目を無視する作りが要る）。
    `term.modes.bracketedPasteMode` は `ESC[?2004h` の後に true になった。OSC 8 のハイパーリンクは解釈されて下線で描画され、OSC 0 のタイトルは
    `document.title` を変えなかった。`@xterm/xterm` 6.0.0 の `paste` は改行を `\r` に変え、bracketed paste が有効なときだけ `ESC[200~`/`ESC[201~` で囲み、
    本文の中の `ESC` は取り除かない（`lib/xterm.mjs` の `Al`/`kl`/`Cn`）
11. **ファイルの監視（`fs.watch`）**: macOS で、ディレクトリを非再帰で監視すると、その中のファイルのその場の書き込み・同じ内容の書き込み・一時ファイルからの
    rename（アトミックな置き換え）・削除・作り直しのすべてでイベントが届いた（イベントの種類はその場の書き込みでも `rename` になるなど当てにならない）。
    ファイルそのものの監視は、rename での置き換えの後はイベントが届かなくなった。監視を始めた直後に、始める前の書き込みのイベントが届いた。
    サブディレクトリの中の変更は、サブディレクトリ名の 1 件だけが届いた。素の node v24 と Electron の node で同じ結果だった
12. **入れ子の起動**: Claude Code のセッションの中から `npm run dev` すると、main プロセスは `CLAUDECODE`・`CLAUDE_CODE_SESSION_ID`・`CLAUDE_CODE_MESSAGING_SOCKET`・
    `CLAUDE_CODE_MESSAGING_TOKEN`・`CLAUDE_CODE_SSE_PORT` などと、VS Code の `TERM_PROGRAM`・`VSCODE_*`・`GIT_ASKPASS` を引き継ぐ（この環境の `env` で確認）。
    `CLAUDECODE=1` を付けて `claude` を起動しても、起動は拒否されなかった
13. **既存のコード**（main の 943aff2 と同じ内容）:
    - `src/preload/index.ts` は `contextBridge.exposeInMainWorld('electron', electronAPI)` で、`@electron-toolkit/preload` の `electronAPI` を公開している。
      その `ipcRenderer` は**任意のチャンネル名**の `send`・`invoke`・`on` を通し、`process.env` の写しも返す（`node_modules/@electron-toolkit/preload/dist/index.mjs`）。
      renderer のコードとテストは `window.electron` を使っていない（`grep` で 0 件）
    - `src/main/index.ts` は `webPreferences` に `sandbox: false` だけを指定し（`contextIsolation`・`nodeIntegration` は既定）、`setWindowOpenHandler` は
      **どの URL でも** `shell.openExternal` に渡して `deny` する。`will-navigate` の制限は無い。アプリのメニューを設定していない（Electron の既定のメニュー）
    - `optimizer.watchWindowShortcuts`（`@electron-toolkit/utils`）は、パッケージ版で `before-input-event` の `KeyR` + (`control` または `meta`) と、
      `Minus`/`Shift+Equal` + (`control` または `meta`) を `preventDefault` する。Electron の型定義の説明では、`before-input-event` の `preventDefault` は
      ページの `keydown` とメニューのショートカットの両方を止める（メニューだけを止めるのは `setIgnoreMenuShortcuts`）
    - `useQuickOpen` は `document` の `keydown` を capture で受け、`Ctrl/Cmd+P`（Shift・Alt なし）を `preventDefault` してクイックオープンを開く。
      保存（`Ctrl/Cmd+S`）は Monaco の `addCommand` で、エディタの中だけで効く
    - `cliService.ts` の `spawn` は `cwd` を指定していない。`buildEnv()` は `PATH` の末尾に `/usr/local/bin`・`/opt/homebrew/bin`・`/snap/bin`・`~/.local/bin`・
      `~/.cargo/bin` を足す（win32 はそのまま）
    - `FolderAccessManager` は webContents の id ごとに開いているフォルダ（realpath）を持ち、`dialog:openFolder` と clone の成功で `set` される。
      webContents の `destroyed` で消え、リロードでは消えない
    - `useDiffOperations` は、diff タブの対象の git status の文字（index と作業ツリー）が変わったときに diff を取り直す。変更済みのファイルがさらに
      変わっても、文字が同じなら取り直さない
    - `@monaco-editor/react` は、`value` が `getValue()` と違うとき、全体を `executeEdits` で置き換えて `pushUndoStop` する（AI 出力の反映の設計書の
      確認の結果 1）。undo の履歴は残る
    - `src/renderer/src/main.tsx` は `StrictMode` で描画する。CI（`.github/workflows`）は無い

**入力欄を空にする方法の追加の実験（2026-10-04。「決定した点」2 の上書きのため）**

上と同じ版（Claude Code 2.1.288・node-pty 1.1.0・`@xterm/headless` 6.0.0・node v24.14.1）で、scratchpad の一時ディレクトリから `claude` を 100 桁 × 30 行の pty で
起動し、`@xterm/headless` の画面を読んで確かめた。隔離した `CLAUDE_CONFIG_DIR` に `.claude.json` を先に置き（オンボーディングの完了・テーマ・ダミーの
API キーの承認・作業ディレクトリの信頼）、起動時の確認画面（テーマ・API キー・信頼）を通らずに入力欄へ進めた。API キーの確認・ログインの画面には一度も
進んでいない（画面にログイン・API キーの確認の文言が出たら即座にプロセスを止める見張りを付け、`BROWSER=/usr/bin/false` にした。見張りは一度も働かなかった）。
送信した場合の接続先は閉じたローカルのポート（`ANTHROPIC_BASE_URL=http://127.0.0.1:9`）で、Anthropic の API には接続していない。各回の後に
`pgrep -fl` で `claude` が残っていないことを確かめた。「作業中」は、送信した後の API の再試行中（`Connection refused … Retrying` と `esc to interrupt` が出ている間）で
作った（ツールの実行中・応答の表示中は作れず未確認）。

14. **新しい確認画面**: 設定が揃っていても、起動の直後に `Try the new fullscreen renderer?`（`❯ 1. Yes, try it` / `2. Not now`。`Enter to confirm · Esc to cancel`）が出た。
    **既定が `Yes, try it` で、Enter で確定する**（確認の結果 6 の画面と同じく、Enter を送ってはいけない画面が版ごとに増えうる）。`Esc` で閉じた
15. **方法ごとの結果**（入力欄の行を画面から読んで判定。「全部」は入力欄が `❯` だけになったこと）

    | 方法                                         | 単一行                           | 複数行（打鍵・貼り付け） | 長い 1 行（折り返し）                                 | `[Pasted text #N …]`・前後に文字         | カーソルが途中・先頭                           | 作業中                                                                                              |
    | -------------------------------------------- | -------------------------------- | ------------------------ | ----------------------------------------------------- | ---------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
    | `Ctrl+C`（`\x03`）1 回                       | 全部                             | 全部（確認の結果 7）     | —                                                     | 全部                                     | —                                              | **作業を中断し、入力欄は消えない**                                                                  |
    | `Esc` 1 回                                   | 消えない（`Esc again to clear`） | 同じ                     | 同じ                                                  | 同じ                                     | 同じ                                           | **作業を中断し、入力欄は消えない**                                                                  |
    | `Esc` → 120ms → `Esc`                        | 全部                             | 全部                     | 全部                                                  | 全部                                     | 全部                                           | 1 回目の `Esc` で中断し、入力欄は消えない                                                           |
    | `Ctrl+A` → `Ctrl+K`                          | 全部                             | 最後の行だけ             | 先頭の表示行（折り返しの 1 行分）だけ消え、残りは残る | 全部                                     | —                                              | —                                                                                                   |
    | `Ctrl+E` → `Ctrl+U` を 1 回                  | 全部                             | 最後の行だけ             | 最後の表示行だけ                                      | 全部                                     | —                                              | —                                                                                                   |
    | `Ctrl+E` → `Ctrl+U` を 5 回                  | 全部                             | 全部                     | 全部                                                  | 全部                                     | —                                              | 全部（中断しない。単一行で確認）                                                                    |
    | `Ctrl+W` を 8〜12 回                         | 全部                             | 全部（改行も越える）     | 全部                                                  | 全部                                     | **カーソルより前だけ**（先頭なら何も消えない） | 全部（中断しない。単一行で確認）                                                                    |
    | `Backspace`                                  | 1 文字                           | —                        | —                                                     | `[Pasted text #N …]` を 1 回で丸ごと消す | —                                              | —                                                                                                   |
    | `Ctrl+L`                                     | 消えない（再描画だけ）           | —                        | —                                                     | —                                        | —                                              | —                                                                                                   |
    | **`Ctrl+K` × 12 → `Ctrl+U` × 12 を繰り返す** | 全部                             | 全部                     | 全部                                                  | 全部（2 つの貼り付けと文字の混在も）     | **全部**                                       | **全部（中断しない。複数行・カーソルが途中・`[Pasted text #N …]` で確認。キューの送信待ちも残る）** |

    `Ctrl+K` は行の途中では行末まで、行末では次の行との改行を消し、`Ctrl+U` は行の途中では行頭まで、行頭では前の行との改行を消した。
    このため、カーソルの位置に関係なく、`Ctrl+K` の繰り返しでカーソルより後ろが、`Ctrl+U` の繰り返しで前が消える。左右の矢印キーは行をまたいで動き、
    `End`・`Ctrl+End`（`ESC[1;5F`）・`Meta+>` は行末までしか動かなかった（入力の末尾へ一度に移る手段は見つからなかった）。
    `Ctrl+K`/`Ctrl+U` の後は `Ctrl+Y to paste deleted text` が出て、`Ctrl+Y` で**最後に消した分だけ**が戻った（書きかけの全体は戻らない）。
    `!` で入ったシェルのモード（入力欄の記号が `!`）は、文字があっても空でも、`Ctrl+K`/`Ctrl+U` で消すと通常の入力欄（`❯`）に戻った。
    `/` のコマンドの候補・`@` の候補が開いている状態でも同じく空になった。vim のモード（`editorMode: "vim"`）の INSERT でも空になった（NORMAL は確かめられていない）

16. **`Ctrl+C` の詳細**: 1 回目の `Ctrl+C` で入力欄が消え、下に `Press Ctrl-C again to exit` が約 1 秒出た（0.3 秒後に表示、1.3 秒後に消えていた）。
    2 回目を 0.5 秒後に送ると `claude` は終了した（終了コード 0）。0.9・1.2・2.0 秒後では終了せず、また `Press Ctrl-C again to exit` を出した。
    `Ctrl+C` の直後（同じ書き込み、または 50ms 後）に貼り付けると、本文だけが入った
17. **`Esc` の詳細**: 2 回目の `Esc` は 0.5 秒後なら入力欄を消し、0.9 秒以上空けると消さずに再び `Esc again to clear` を出した。空の入力欄（会話の履歴が無い状態）の
    `Esc Esc` は画面を変えなかった（会話の履歴があるときに別の画面〈巻き戻し〉が開くかは未確認）
18. **まとめて届いたキーは効かない**: 1 回の書き込みで `Ctrl+K` × 24 + `Ctrl+U` × 24（48 バイト）までは効き、× 32（64 バイト）以上では**何も消えなかった**
    （文字も入らない。まとめて届いた入力を貼り付けとして扱う判定と推測）。16 バイトの書き込みを間を空けずに 10 回続けると一部しか消えず、10ms・30ms 空けると全部が効いた
19. **同じ本文の貼り付けの展開**: `[Pasted text #N …]` が入力欄にある間に同じ本文を貼り付けると、畳まれずに全行が入力欄に展開された（下に `paste again to expand`）。
    消去と貼り付けを 1 回の書き込みで送るとこれが起きた。消去の後に入力欄が空になったことを画面で確かめてから、別の書き込みで貼り付けると
    `[Pasted text #2 +39 lines]` に畳まれた（300ms・4 秒の間隔のどちらでも）
20. **大きな入力の消去にかかる時間**: 24 バイト（`Ctrl+K` × 12 + `Ctrl+U` × 12）を 30ms ごとに送り、送るたびに入力欄が空か確かめる繰り返しで、
    展開された 40 行は 7 回・0.2 秒、300 行は 50〜70 回・1.6〜2.1 秒（カーソルが末尾近く・先頭近く）で空になった。入力欄の行が画面の高さを超えると、
    入力欄の上の罫線が画面から外れ、入力欄を画面から特定できない（空ではないものとして扱えば、繰り返しが続いて空になった）
21. **空の入力欄の見え方**: 空の入力欄は、罫線（`─` が行頭から続く行）・`❯ ` の行・罫線の 3 行で、カーソルは `❯ ` の直後の反転表示の 1 文字だった。
    送信待ち（キュー）があるときの空の入力欄は `❯ Press up to edit queued messages` で、先頭の `P` が反転（カーソル）、残りが dim（SGR 2）だった。
    この環境では、ほかの案内の文字（`Try "…"` などの例文）は出なかった（ログイン済みの通常の環境・ほかのテーマでの見え方は未確認）
22. **確認画面の見え方**: フォルダの信頼の確認は、`❯ No, exit` が 2 桁目から始まり（行頭が空白）、入力欄の「罫線・`❯` の行・罫線」の並びが無い。
    この画面で `Ctrl+K`/`Ctrl+U` を送っても、画面は変わらず `claude` も終了しなかった
23. **先頭が `!` の貼り付け**: 空の入力欄に、先頭が `!` の本文（`!echo hi`、40 行の本文も）を貼り付けると、シェルのモード（入力欄の記号が `!`）に入った。
    このまま Enter を送ると、本文はシェルのコマンドとして実行される（Enter は送っていない）。先頭が空白・改行のとき（` !echo`・`\n!echo`）は入らなかった。
    先頭が `/`・`#` の本文は通常の入力欄のまま入った（`/` で始まる本文は Enter でスラッシュコマンドとして解釈されうる。送信は確かめていない）
24. **`Ctrl+S`（stash）**: 書きかけを退避して入力欄を空にし、貼り付けた本文を送信した後に、**退避した書きかけを入力欄に戻した**。上書き（書きかけを消す）とは
    挙動が違うため採らない（「決定した点」2）
25. **未確認**: 作業中のうちツールの実行中・応答の表示中・許可の確認の表示中の挙動、画像の添付（`[Image #N]`）の消去、vim のモードの NORMAL、
    ログイン済みの通常の環境（案内の文字・テーマ）での空の入力欄の見え方、Windows の ConPTY での同じキーの挙動

**プランの作成時・実装時に確かめたこと（2026-10-04。プラン `docs/superpowers/plans/2026-10-04-agent-terminal-mvp.md` の「設計書との差異」と Task 1 の記録
`.superpowers/agent-terminal-mvp/spike-results.md`）**

26. **vitest 4 の環境**: vitest 4.1.7 は `vitest.config.ts` の `environmentMatchGlobs` を無視し（dist に存在しなかった）、`src/main/__tests__` のテストも jsdom で走った
    （`typeof window === 'object'`）。`// @vitest-environment node` を付けると `setupFiles` の `Element.prototype.scrollIntoView` が `ReferenceError` になった。
    jsdom のままで、実物の node-pty の `spawn`・`onData`・`onExit` が動いた（`/bin/echo` の出力と終了コード 0）。vitest の設定は変えず、実物の pty のテストは
    docblock を付けずに書いた（プランの差異 1）
27. **依存の追加と postinstall**: `npm install --save-exact node-pty@1.1.0`（引数つき）は、ルートの postinstall を走らせなかった。その後に引数なしの `npm install` を
    実行すると `electron-builder install-app-deps` が走り（`preparing moduleName=node-pty arch=arm64` → `finished`）、`node_modules/node-pty/build/Release/` に
    `pty.node`（90,680 バイト）・`spawn-helper`（50,544 バイト）が実行権限付き（`-rwxr-xr-x`）で作られた。`git ls-files` を写したクリーンな一時ディレクトリでの
    `npm ci` でも同じく作られた。Electron の node（`ELECTRON_RUN_AS_NODE=1`）から pty を起動でき、出力と終了コード 0 を得た（プランの差異 2・Task 1 の Step 3・5・6）
28. **パッケージ版と署名**: 署名の ID が無いマシンでは、electron-builder 26.8.1 が ad-hoc 署名と hardened runtime で作った成果物（`npm run build:unpack` 相当）は、
    起動すると `dyld: Library not loaded: @rpath/Electron Framework.framework … different Team IDs` で終了した（プランの作成時に確認。node-pty とは無関係で、943aff2 も同じ署名の設定）。
    `npm run build && npx electron-builder --dir -c.mac.identity=null`（署名しない）で作ると、`app.asar.unpacked/node_modules/node-pty/build/Release/` に `pty.node`・
    `spawn-helper` が実行権限付きで入り、`ELECTRON_RUN_AS_NODE=1` で `app.asar` の node-pty から pty を起動できた（出力と終了コード 0）。そのアプリを GUI で起動し、
    `osascript` の quit で正常に終了した（プランの差異 3・Task 1 の Step 7）。署名の設定（`electron-builder.yml`）は MVP では変えていない
29. **入力欄の見え方の細部**: `@xterm/headless` で読んだ画面では、入力欄の記号の後ろは U+00A0（ノーブレークスペース）だった（`❯` + U+00A0 + 本文。シェルのモードは
    `!` + U+00A0）。会話の履歴の行（`❯ hello`）は普通の空白で、罫線の外にあった。空の入力欄は `❯`・U+00A0・反転の空白（カーソル）の 3 セルだった。
    カーソルは点滅しなかった（50ms ごとに 80 回読んで、反転のセルは毎回あった）。貼り付けた本文の先頭の空白は保たれ、タブは空白 4 つになり、日本語はそのまま
    表示された（プランの差異 4・7・8）
30. **偽の Messages API での許可の確認・作業中**: ローカルの HTTP サーバー（`tool_use` を返す・応答を 150ms ごとに流す）を `ANTHROPIC_BASE_URL` にし、
    `--permission-mode default` で起動した（Anthropic の API には接続していない）。許可の確認の画面（`Do you want to proceed?` と ` ❯ 1. Yes` が 2 桁目から。
    上に `─` の罫線が 1 本だけ）には入力欄の「罫線・記号の行・罫線」の並びが無く、`findInputBox` は入力欄を見つけなかった。この画面に `Ctrl+K` × 12 + `Ctrl+U` × 12 と
    文字を送っても画面は変わらなかった。応答の表示中・ツールの実行中（`Bash(sleep 6)` を許可リストで自動で許可）に書きかけを入れて消去のキーを 2 回送ると、
    入力欄は空になり、作業は中断されずに続いた（プランの差異 5）
31. **クリップボード**: Electron 39.8.10 の `file://` のページ（このリポジトリと同じ CSP）で、フォーカスのあるウィンドウの `navigator.clipboard.writeText`・`readText` が
    既定の権限で成功した（`isSecureContext` は true。フォーカスが無いと `Document is not focused`）。preload の `clipboard` は使っていない（プランの差異 6）
32. **保存の照合のハッシュ**: 保存の直前に Web Crypto の SHA-256（`crypto.subtle.digest`）を計算してから書き込む形にすると、書き込みの開始が非同期に 1 段遅れ、
    既存の `useFileEditing.test.ts`・`useFileSystem*.test.ts` の 60 件以上が失敗した（書き込みの同期性を前提にした保存の直列化・ロック待ちのテスト）。
    `savedContent` の文字列を main へ送り、main で同じ読み方の文字列と比べる形にした（プランの差異 9。比べる対象〈ディスクの内容と、タブが最後にディスクと
    一致した内容〉は変えていない）
33. **子を片付けずに終わるエージェント**: SIGTERM で子を片付けずに終わる偽のエージェント（`/bin/sh`）が `setsid` で起動した孫は、プロセスグループへのシグナルだけでは
    孤児として残った。停止の手順に「終了の後、控えた子孫のうち生き残っているものへ SIGKILL を送る」を足すと残らなかった（結合テストで、この追加を外す変異が
    落ちることを確かめた。プランの差異 11）。実物の `claude` は SIGTERM で子を片付けて終わる（確認の結果 9）ため、通常は何も送らない
34. **空と判定される書きかけ**: 実装時（Task 13）に、記録した画面の属性（文字・dim・反転の位置）だけでは区別できない形があることが分かった。1 文字の書きかけの
    後ろに dim の候補が出てカーソルを `←` で戻した形は送信待ちの空の入力欄（`❯ Press up to edit queued messages`）と、空白 1 文字の書きかけでカーソルを戻した形は
    空の入力欄と、同じ属性になる。消去のキーは空の入力欄に送っても害が無い（確認の結果 15・22）ため、送信の手順を「空と判定されても消去を最低 1 回は送ってから、
    空を確かめて貼り付ける」に変えた（「プロンプトの送信」6・7）

## 全体構成

### 配置の案（エディタの領域のどこに、どう開閉するか）

| 案                                            | 内容                                                                                                                         | 良い点                                                                                                                                                                | 問題                                                                                                                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. エディタの領域の下部パネル（推奨）         | `EditorPanel` の縦の並び（タブ → 本文 → 出力パネル）の出力パネルの位置に置く。見出しの帯（32px）を常に出し、開閉・最大化する | エージェントの画面と、エージェントが編集するファイルを同時に見られる。出力パネルと同じ位置なので既存のレイアウトの規則（下部・固定の帯）に沿う。Monaco は作り直さない | 縦の幅を分け合うため、小さい画面ではどちらも狭い（最大化で補う）                                                                                                                                                                       |
| B. エディタのタブの 1 つ（ターミナルのタブ）  | `EditorTabs` にターミナルのタブを足し、本文の位置に全面で出す                                                                | 画面を広く使える                                                                                                                                                      | ファイルのタブと同時に見られない。タブを切り替えるとファイルの Monaco がアンマウントされ、undo の履歴・カーソルが失われる（diff タブと同じ既存の挙動。`EditorPanel.tsx` のコメント）。エージェントの作業中にファイルを見るたびに起きる |
| C. エディタの領域の左右分割（右にターミナル） | 本文を左右に分け、右にターミナルを置く                                                                                       | 横長の画面で両方を広く見られる                                                                                                                                        | 狭い幅・タッチの縦持ちで、Claude Code の画面（実測では 100 桁で枠を描く）とエディタの両方が窮屈になる。分割の UI が新しく要る                                                                                                          |

**推奨は A**。理由: エージェントの作業とファイルの変化を同時に見られることが、この MVP の流れ（プロンプト → エージェントの編集 → 確認 → Git 操作）の中心で、
B はそれができず undo を失う。C は狭い幅とタッチ操作のコンセプトに合わない。

A の詳細:

- エージェント CLI 方式のときだけ、`EditorPanel` の最下部に `AgentTerminalPanel` を置く（従来の方式では出さず、出力パネルを従来どおり出す）
- 見出しの帯（高さ 32px。ボタンはタップ領域 32px 以上）: 見出し `エージェント`、状態（`未起動`・`起動中`・`終了しました（終了コード N）`）、`起動`/`終了`、
  `最大化`/`元に戻す`、開閉（`aria-expanded`・`aria-controls`）
- 開いたときの高さは、エディタの領域の 45%（`flex-basis`。最小 160px）。最大化するとタブと本文を隠して全体を使う（Monaco は `automaticLayout: true` なので、
  戻したときに大きさを合わせ直す）。閉じても xterm とセッションは破棄せず、`display: none` で隠す（出力は裏で受け取り続ける）。表示し直したとき・大きさが
  変わったときに `fit()` して、桁数・行数を main へ送る（大きさの変化は `ResizeObserver` で受け、50ms の末尾のデバウンス〈`AGENT_TERMINAL_RESIZE_DEBOUNCE_MS`〉の後に
  送る。実装時に追加）。開閉・最大化の初期の状態は「開いている・最大化していない」
- 高さの変更をドラッグで行う UI は MVP に入れない（最大化で補う）。開閉・最大化の状態は保存しない

### 責務とファイル構成

新しいファイルは `agent` の語で揃える（`terminal` の語は、ROADMAP の「統合ターミナルの拡張」〈シェルの起動〉と区別するため避ける）。

**shared**

- `types/agentTerminal.ts`: IPC の型（`AgentStartRequest`・`AgentStartResult`・`AgentSessionExit`・`AgentTerminalErrorKind`）、桁数・行数・書き込みの上限の定数
- `types/settings.ts`: `PromptExecutionMode = 'agent-cli' | 'legacy'`・`DEFAULT_PROMPT_EXECUTION_MODE = 'agent-cli'` を足す
- `agentPasteText.ts`: 送る本文の正規化（制御文字の除去・改行の統一・先頭の `!` の拒否）と、貼り付けのバイト列の組み立て、入力欄を空にするバイト列の定数
  （`AGENT_CLEAR_INPUT_CHUNK`）（純粋関数・定数。renderer が使う。テストを shared に置く）
- `externalUrl.ts`: `http:`・`https:` の判定（main の `setWindowOpenHandler`・`shell:openExternalLink` と renderer の xterm の `linkHandler` が使う 1 か所。
  パターン 88。プランの差異 14）

**main**

- `agentShellEnv.ts`: ログインシェルから `PATH` を取得する（`$SHELL -l -i -c`、端末なし、新しいプロセスグループ、5 秒で打ち切り、区切りの印で抜き出す）。
  失敗したら `process.env.PATH` に既定の探索先を足したものに倒す
- `cliSearchPaths.ts`: 既定の探索先（`cliService.ts` の `buildEnv` の 5 つ）を切り出して共有する（`cliService.ts` はここから読む。挙動は変えない）
- `agentCommand.ts`: 起動するコマンドの決定（`PATH` から `claude` の実行可能なファイルを探して絶対パスにする。引数は空で固定）と、環境変数の組み立て
  （後述の「環境変数」）。純粋な部分と、ファイルの存在確認（注入できる形）を分ける
- `agentProcessTree.ts`: 子孫のプロセスの一覧（`ps -A -o pid=,ppid=` の解析は純粋関数）と、停止（プロセスグループへの SIGTERM → 猶予の後に SIGKILL）。
  シグナルの例外（ESRCH・EPERM など）はすべて握る（パターン 107）
- `agentSession.ts`: 1 つのセッション（pty の起動・書き込み・リサイズ・終了の検知・停止）。pty の生成関数を注入できる形にする（テストでは偽物、
  結合テストでは実物の node-pty と偽のエージェントのスクリプト）
- `agentSessionRegistry.ts`: webContents の id → セッション。起動の重複を 1 つにまとめ（2 回目は既存を返す）、所有者の確認、全停止
- `agentSessionLifecycle.ts`: ウィンドウの破棄（`destroyed`）・メインフレームの文書の入れ替わり（リロード。後述の「停止の契機」）・
  フォルダの切り替え・アプリの終了（`before-quit` で停止を待つ）で、セッションを止める
- `handlers/agentTerminalHandlers.ts`・`handlers/agentTerminalPayloadParser.ts`: IPC の受け口と入力検証（`payloadValidators.ts` を使う）
- `openFileWatcher.ts`: 開いているタブの親ディレクトリの非再帰の監視と、変化の通知（間引き）
- `fileChangeGuard.ts`: 保存の直前の照合（ディスクの内容と renderer の基準の文字列の比較）。SRP の再レビューで `checkedFileWrite.ts` に統合した
- `executionModeStore.ts`: 実行方式の読み書き（`settingsFileStore.ts` のマージの書き込みを使う）
- `handlers/externalChangeHandlers.ts`: 照合付きの保存（`fs:writeFileChecked`）と監視の登録（`fs:setWatchedFiles`）の IPC（既存の `fileSystemHandlers.ts` の
  テストのモックを広げないため、新しいファイルにした。プランの差異 13）
- 変更: `folderAccessManager.ts`（変更の通知 `onDidChange` を足す）、`ipcHandlers.ts`（組み立て）、`handlers/settingsHandlers.ts`（実行方式）、
  `index.ts`（`setWindowOpenHandler` の許可リスト・`will-navigate` の拒否。`before-input-event` は変えない〈プランの差異 15〉）
- 実装で足したもの: `agentRuntime.ts`（実物の node-pty・`ps`・ログインシェルを束ねる）、`navigationPolicy.ts`（遷移と新しいウィンドウの判定）、
  `handlers/shellHandlers.ts`（`shell:openExternalLink`）、`openFileWatcherLifecycle.ts`（破棄・リロード・クラッシュ・フォルダの切り替えで監視を閉じる）、
  `mainFrameDocumentReplaced.ts`（メインフレームの文書が実際に入れ替わったときの契機。`ownerContextLifecycle.ts` が使う。最終レビューの修正で追加）
- SRP の整理で分けたもの（挙動は変えない）: `ownerContextLifecycle.ts`（所有者の文脈が終わる契機〈破棄・renderer のプロセスの終了・リロード・
  フォルダの切り替え〉を 1 か所にまとめ、`agentSessionLifecycle.ts`・`openFileWatcherLifecycle.ts` が購読する）、`safeWebContentsSend.ts`（破棄済みかも
  しれない webContents への送信）、`agentSessionStarter.ts`（起動の可否・起動の途中の取り消し・pty の配線。`agentTerminalHandlers.ts` は受け口だけ）、
  `checkedFileWrite.ts`（照合付きの保存の許可の確認・照合〈`checkDiskUnchanged`〉・書き込み方式の選択。`externalChangeHandlers.ts` は型の検証と
  エラーの変換と、外部変更の通知の送信〈`sendExternalChange`〉）
- SRP の再レビューで整理したもの（挙動は変えない）: `agentTerminalHandlers.ts` は registry（書き込み・リサイズ・停止・状態の取得）と組み立て済みの
  starter だけを受け取り、`agentSessionStarter.ts` の組み立ては `ipcHandlers.ts` が行う。`fileWithinFolder.ts`（ファイルが許可のフォルダの中にあるかの
  境界の規則〈`assertFileWithinFolder`〉。IPC のイベントに依らないので main 直下に置き、`handlers/fileAccessGuard.ts` は再エクスポートする）

**preload**

- `api.ts`・`index.d.ts`: 後述の IPC を足す。`index.ts` から `electronAPI`（`window.electron`）の公開を外す

**renderer**

- `lib/agentTerminalController.ts`: xterm の `Terminal` とアドオン・IPC の購読を持つ、React の外の部品（文書ごとに 1 つ）。`StrictMode` の二重マウントや
  パネルの開閉で xterm を作り直さない。表示の要素への取り付け・取り外し、`fit`、書き込み、セッションの状態の購読、表示中の画面の読み取り（`readViewport`）、
  送信中の利用者のキー入力の保留と再送を提供する
- `lib/agentInputBox.ts`: `claude` の入力欄の特定（`findInputBox`）・空かの判定（`isInputBoxEmpty`）・貼り付けた本文が現れたかの判定（`isPasteEchoed`）。
  画面の行の配列（各行の文字列と、dim・反転の文字の位置）を受け取る純粋関数。行の配列は controller が xterm の表示中のバッファから作る（`readViewport`）
- `lib/agentTerminalKeys.ts`: キー入力の振り分け（アプリのショートカット・コピー・貼り付け・フォーカスの移動。`attachCustomKeyEventHandler` に渡す純粋関数）
- `hooks/useAgentSession.ts`: セッションの状態（`none`・`starting`・`running`・`exited`）・起動・終了・送信中の状態と、送信できない理由
- `hooks/useAgentPromptSender.ts`: 送信の手順（正規化 → 入力欄の特定 → 空にする → 空の確認 → 貼り付け → 現れたかの確認 → Enter）。待ち時間・上限は注入できる形にする
  （実装では、手順そのものを React に依らない `lib/agentPromptSend.ts` の `sendAgentPrompt` に置き、hook は送信中の状態・通知・エラーを持つ）
- `hooks/useExecutionMode.ts`: 実行方式の読み込み・保存
- `hooks/useExternalFileChanges.ts`: 監視の通知とフォーカスの復帰での再確認、未編集のタブの再読込、編集中のタブへの印
- `components/agent/AgentTerminalPanel.tsx`・`AgentTerminalView.tsx`: 見出しの帯と xterm の表示の領域
- `components/editor/ExternalChangeBanner.tsx`: 編集中のタブがディスク上で変わったときの通知
- `components/settings/ExecutionModeSection.tsx`: 実行方式の選択（`role="radiogroup"`）
- 実装で足したもの: `lib/agentViewport.ts`（xterm の表示中のバッファから画面の行を作る）、`lib/agentSessionMessages.ts`・`lib/agentSendMessages.ts`（文言と
  押せる条件）、`lib/platform.ts`（OS の判定）、`lib/xtermFactory.ts`（xterm の生成。jsdom で `open()` が動かないため境界に置く）、`hooks/useAgentTerminalPanel.ts`
  （開閉・最大化。初期の状態は開いている。プランの差異 19）、`hooks/useExternalChangeMarks.ts`（タブの外部変更の印）
- SRP の整理で分けたもの（挙動は変えない。`agentPendingOutput.ts` の上限の扱いだけを直した）: `hooks/useAgentWorkspace.ts`（実行方式とエージェントの組み立て・
  実行方式の切り替えの手順〈再入防止・確認・停止を待ってから保存〉・フォルダの切り替えの前の停止の確認。`useAppState.ts` はこれを呼ぶ）、
  `lib/promptRunState.ts`（実行ボタン・再実行の押せる条件・理由・aria-label の組み立て）、`lib/externalChangeDecision.ts`（外部変更の 1 パスの判定。
  `useExternalFileChanges.ts` は購読と帯の操作）、`lib/keyedCoalescer.ts`（キーごとの非同期の実行の合流）、`lib/agentPendingOutput.ts`（sessionId が
  決まるまでの出力の溜め置き。上限を超えたセッションはその後のチャンクも溜めない）
- SRP の再レビューで整理したもの（挙動は変えない）: `useAgentWorkspace.ts` は設定パネルの実行方式の項目（`ExecutionModePanelState`。選択の Promise を
  捨てる処理を含む）とターミナルのパネルの状態（`AgentTerminalPanelState`）を組み立てて返し、確認は `onConfirm`（既定は `window.confirm`）で差し替えられる。
  `useAppState.ts` は実行方式とエージェントについて `executionModePanel`・`promptRun`・`bottomPanel`・`agentTerminal` をそのまま公開する。
  `lib/shellApi.ts`（`openExternalLink` の窓口。エージェントのセッションの窓口 `agentTerminalApi.ts` から移した）
- 変更: `usePromptRunner.ts`（方式で分岐）、`useAppState.ts`（組み立て）、`useFileSystem.ts`・`useFileEditing.ts`（照合付きの保存・外部変更の反映）、
  `useQuickOpen.ts`（ターミナルの中の `Ctrl+P` を除外）、`EditorPanel.tsx`・`PromptsPanel.tsx`・`HistoryPanel`/`HistoryDetail`・`SettingsPanel.tsx`・`Sidebar.tsx`・`App.tsx`

**依存の向き**: `shared` ← `main`・`preload`・`renderer`。main は `agentTerminalHandlers` → `agentSessionRegistry` → `agentSession` → (`agentCommand`・`agentShellEnv`・
`agentProcessTree`)、`agentSessionLifecycle` → `agentSessionRegistry`・`FolderAccessManager`（通知の購読）。`FolderAccessManager` はセッションを知らない。
renderer は コンポーネント → hooks → `lib/*`（純粋な部品と controller）→ `lib/agentTerminalApi.ts`（`window.api` の窓口）。xterm を直接触るのは
`agentTerminalController` と `AgentTerminalView` だけにする。

### 依存の追加

- `node-pty`（dependencies。main が読む。electron-vite 5 は dependencies を外部化し `require` のまま残す〈`out/main/index.js` の `simple-git`・`@anthropic-ai/sdk` で確認〉）
- `@xterm/xterm`・`@xterm/addon-fit`（devDependencies。renderer は vite がバンドルする。このリポジトリは `react` も devDependencies）
- `@xterm/addon-web-links`・`@xterm/addon-clipboard`・`@xterm/addon-webgl`・chokidar は入れない（理由は各節）

## IPC（preload の API と許可）

すべて `window.api` に列挙する（許可リスト）。チャンネル名は `agentTerminal:*`。

| API                                                            | チャンネル・種類                                                               | 引数・戻り値                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startAgentSession(request)`                                   | `agentTerminal:start`（invoke）                                                | `{ folderPath, cols, rows }` → `{ kind: 'started' \| 'already-running', sessionId }` または `{ kind: 'error', error: AgentTerminalErrorKind, detail?, shellPathUnavailable? }`（`shellPathUnavailable` は `command-not-found` の文言に PATH の取得の失敗を添えるため。プランの差異 17）。`folderPath` は renderer が表示しているフォルダで、main は許可と一致するかだけを確かめる |
| `writeAgentSession(sessionId, data)`                           | `agentTerminal:write`（send）                                                  | 文字列。キー入力・xterm の応答（DA1 など）・貼り付けのすべてがここを通る。順序を保つため send（fire-and-forget）にする                                                                                                                                                                                                                                                            |
| `resizeAgentSession(sessionId, c, r)`                          | `agentTerminal:resize`（send）                                                 | 桁数・行数                                                                                                                                                                                                                                                                                                                                                                        |
| `stopAgentSession(sessionId)`                                  | `agentTerminal:stop`（invoke）                                                 | 止まるまで待って解決する                                                                                                                                                                                                                                                                                                                                                          |
| `getAgentSession()`                                            | `agentTerminal:getState`（invoke）                                             | 現在のセッション（`sessionId`・状態）。renderer の部品の作り直しの後に状態を合わせるため                                                                                                                                                                                                                                                                                          |
| `onAgentData(listener)`                                        | `agentTerminal:data`（main → renderer）                                        | `{ sessionId, data }`。preload で包み、解除関数を返す（`onPromptStreamChunk` と同じ作り）                                                                                                                                                                                                                                                                                         |
| `onAgentExit(listener)`                                        | `agentTerminal:exit`（main → renderer）                                        | `{ sessionId, exitCode, signal, reason }`。`reason` は `exited`（エージェント自身の終了）・`stopped`（`終了`・実行方式の切り替え）・`folder-changed`                                                                                                                                                                                                                              |
| `setAgentTerminalFocused(focused)`                             | `agentTerminal:focus`（send）                                                  | 真偽値。Windows・Linux でメニューのショートカットを止める・戻す（後述）                                                                                                                                                                                                                                                                                                           |
| `writeFileChecked(path, content, baseContent: string \| null)` | `fs:writeFileChecked`（invoke）                                                | `{ kind: 'written' }` または `{ kind: 'conflict', reason: 'modified' \| 'deleted' }`                                                                                                                                                                                                                                                                                              |
| `setWatchedFiles(paths)`                                       | `fs:setWatchedFiles`（invoke）                                                 | 開いているタブの絶対パスの配列                                                                                                                                                                                                                                                                                                                                                    |
| `onExternalFileChange(listener)`                               | `fs:externalChange`（main → renderer）                                         | `{ paths }`（変わった可能性のある、開いているタブのパス）                                                                                                                                                                                                                                                                                                                         |
| `getPromptExecutionMode()`・`setPromptExecutionMode(mode)`     | `settings:getPromptExecutionMode`・`settings:setPromptExecutionMode`（invoke） | `'agent-cli' \| 'legacy'`                                                                                                                                                                                                                                                                                                                                                         |
| `openExternalLink(url)`                                        | `shell:openExternalLink`（invoke）                                             | `http:`・`https:` だけを開く（ターミナルのリンク用）                                                                                                                                                                                                                                                                                                                              |

## データフロー

### セッションの開始

1. renderer: フォルダを開いていないときは `起動` を押せない（理由 `フォルダを開いてください`）。押すと `agentTerminalController` が表示中の桁数・行数を測り、
   `startAgentSession({ folderPath, cols, rows })` を呼ぶ。状態は `starting`
2. main（handler）: 入力を検証し、送信元の webContents の許可（`FolderAccessManager.get`）が無ければ `no-folder`、`folderPath` の realpath と一致しなければ
   `folder-mismatch`。同じ webContents のセッションが生きていれば、新しく起動せず `already-running` と既存の `sessionId` を返す（`StrictMode` の 2 回目の依頼。確認の結果 10）
3. main: 作業ディレクトリ = 許可のフォルダ（renderer の文字列ではなく main の値）。存在しなければ `folder-missing`
4. main: `PATH` を決める（「PATH の継承」）。`claude` を `PATH` から探し、実行可能なファイルの絶対パスにする。見つからなければ `command-not-found`
   （node-pty は起動の失敗を例外にしないため、起動の前に main で確かめる。確認の結果 4）
5. main: `pty.spawn(<claude の絶対パス>, [], { name: 'xterm-256color', cols, rows, cwd, env })`。引数は空で固定（プロンプトを引数で渡さない。後述）。
   `onData` → `agentTerminal:data`（`isDestroyed()` を確かめてから送る）、`onExit` → `agentTerminal:exit` と登録の削除
6. renderer: `started` で状態を `running` にし、xterm の `onData`（キー入力と、DA1 などの問い合わせへの xterm の応答）を `writeAgentSession` へ流す。
   開始の前に表示していた前のセッションの出力は、起動の直前に `term.reset()` で消す

### プロンプトの送信（実行ボタン → 変数の差し込み → 入力欄を空にする → 貼り付け → Enter）

入力欄に書きかけの文字があるときは、それを消してからプロンプトを入れる（**上書き**。「決定した点」2）。`claude` の入力欄を一度で空にするキーは無く、
`Ctrl+C`・`Esc` は作業中に押すと作業を中断し、しかも入力欄を消さない（確認の結果 15〜17）。このため、作業を中断しない編集のキー（`Ctrl+K`・`Ctrl+U`）を
少しずつ送り、**画面で入力欄が空になったことを確かめてから**貼り付ける。手順の各段で確かめられなければ、その時点で止めて何も送らない（Enter は送らない）。

1. 実行ボタン（変数があればフォームで値を差し込んだ後。`PromptItem` → `PromptsPanel` → `onRun`）→ `usePromptRunner.runPrompt`。実行方式が `agent-cli` なら
   `useAgentPromptSender.send(text)` へ、`legacy` なら従来の `executePrompt` へ分岐する。ファイル内容は添付しない
2. 押せる条件: セッションが `running` で、送信中でない。押せないときは理由を出す（後述の「セッションが無いときのボタン」。「決定した点」1）
3. 正規化（`shared/agentPasteText.ts` の `normalizeAgentPrompt`）: `\r\n`・`\r` を `\n` に統一し、`\n` と `\t` 以外の C0 制御文字（`ESC` を含む）・`DEL`・
   C1 制御文字（U+0080〜U+009F）を取り除く。本文に `ESC[201~` が入っていると貼り付けがそこで終わり、残りがキー入力（`\r` で送信など）として
   解釈されるため、`ESC` の除去は省けない（インポートしたプロンプトも対象）。次のときは送らない（どれも入力欄には何も送らない）
   - 前後の空白だけ: `送信する内容がありません`
   - 200,000 文字（UTF-16 の単位）を超える: `プロンプトが長すぎます`
   - 正規化した本文の 1 文字目が `!`: `先頭が「!」のプロンプトは、エージェントのシェルのコマンドとして実行されるため送信できません（先頭に空白を入れると送れます）`。
     空の入力欄に `!` で始まる本文を貼り付けると `claude` のシェルのモードに入り、Enter でシェルのコマンドとして実行される（確認の結果 23）。
     本文を勝手に書き換えず、理由を出して止める。先頭が `/` の本文はスラッシュコマンドとして解釈されうるが、利用者が登録した意図どおりの動作と見なして送る
4. 確認: xterm の `term.modes.bracketedPasteMode` が false なら送らない（`エージェントが入力を受け付けていません`）。bracketed paste が無効のまま送ると、
   本文の改行がそれぞれ Enter になり、途中で送信される
5. 入力欄の特定（`lib/agentInputBox.ts` の `findInputBox`。画面の行を受け取る純粋関数）: 表示中の画面（xterm の表示中のバッファ）の下から、
   「罫線（行頭から `─` が 20 文字以上続く行）・入力欄の行（1 行目が行頭の `❯` または `!` で始まり、U+00A0〈または空白〉が続くか行末。確認の結果 29）・罫線」の並びを探す。見つからなければ、確認画面・選択の画面・
   履歴の検索などが出ているものとして**何も送らずに止める**（`エージェントの入力欄が見つかりません。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください`）。
   フォルダの信頼の確認・全画面の表示の案内などの確認画面は、`❯` が行頭に無く（2 桁目から）、この並びも無い（確認の結果 14・22）。
   入力欄の行が画面の高さを超えて上の罫線と `❯ ` の行が見えないときは、下の罫線があり、その上の行が画面の上端まですべて 2 桁の字下げ（入力欄の 2 行目以降の形）で
   続く場合に限り、入力欄はあるが空ではないものとして 7 へ進む（確認の結果 20）。それ以外で下の罫線が見えないときは、入力欄が見つからないものとして止める
6. 空かの判定（`isInputBoxEmpty`）: 入力欄が 1 行で、記号が `❯`（`!` はシェルのモードなので空ではない）、記号の後ろの文字がすべて空白・U+00A0 か dim（SGR 2。
   `Press up to edit queued messages` などの案内）で、反転表示のカーソルが記号と U+00A0 の直後にあるとき、空とする（確認の結果 21・29）。**空と判定されても 7 の
   消去を最低 1 回は送る**（画面の属性だけでは空と区別できない書きかけがある。消去のキーは空の入力欄に送っても害が無い。確認の結果 34）。この判定は、7 の消去の後に
   空になったかを確かめる 7・8 と、通知の文言（消去の前に空でないと判定できたか。`clearedDraft`）に使う
7. 入力欄を空にする（`agentPromptSend.ts` の `clearInput`）: `Ctrl+K` × 12 + `Ctrl+U` × 12（24 バイト。`shared/agentPasteText.ts` の `AGENT_CLEAR_INPUT_CHUNK`）を
   1 回の書き込みで送り、30ms 待ってから画面を読み、6 の判定で空になったかを確かめる。空でなければ消去を送り直し、空になるまで繰り返す
   - 1 回の書き込みは 24 バイトに固定し、次の書き込みまで 30ms 空ける。1 回で 64 バイト以上を送ると、まとめて届いた入力として扱われて何も消えず、間を空けずに続けて送ると一部しか消えない（確認の結果 18。48 バイトまでは効いたため、半分の 24 バイトにする）
   - `Ctrl+K` はカーソルより後ろを、`Ctrl+U` は前を、改行をまたいで消すため、カーソルの位置・行数・`[Pasted text #N …]` に関係なく空になる。
     作業中に送っても作業は中断せず、キューの送信待ちも消えない（確認の結果 15・20。作業中のうちツールの実行中・応答の表示中も、確認の結果 30 で確かめた）。シェルのモード（`!`）も抜ける
   - 繰り返しのたびに 5 の入力欄の特定をやり直し、見つからなくなったら止める（途中で確認の画面が出た場合に、その画面へキーを送り続けない）
   - 3,000ms 以内に空にならなければ止める（実測で 300 行の入力が 1.6〜2.1 秒。確認の結果 20）。理由: `エージェントの入力欄を空にできませんでした。ターミナルで入力欄を確かめてから、もう一度実行してください`。
     それまでに消えた書きかけは戻さない（`claude` の `Ctrl+Y` で最後に消した分だけは戻せる。確認の結果 15）
8. 空の確認: 6 の判定で空が 2 回続けて（50ms 空けて）成り立つことを確かめる（描き直しの途中の画面で判定しないため）。成り立たなければ 7 へ戻る（3,000ms の上限は 7 と共通）
9. 貼り付け: `ESC[200~` + 本文 + `ESC[201~` を、7 とは**別の書き込みで** `writeAgentSession` で送る（`buildAgentPasteBytes`。xterm の `paste()` は `ESC` を除かず、
   bracketed paste が無効だと囲まずに送るため使わない。確認の結果 10）。消去と貼り付けを 1 回で送ると、入力欄に同じ本文の `[Pasted text #N …]` があったときに
   全行が展開される（確認の結果 19）
10. 現れたかの確認（`lib/agentInputBox.ts` の `isPasteEchoed`）: 入力欄を特定し直し、記号が `❯`（`!` ならシェルのモードに入ったので失敗）で、入力欄の 1 行目が
    `❯` と U+00A0（または空白。確認の結果 29）の直後から本文の最初の行の先頭（タブは空白 4 つにし、全角を 2 桁で数えて最大 24 桁。桁数が少ないときは折り返しを
    考えて桁数 − 4 桁まで）で始まるか、`❯` + U+00A0 + `[Pasted text #<数字>` で始まることを、16ms ごとに最大 1,000ms 確かめる（実測は 13〜24ms。確認の結果 8）。本文の最初の行が空（先頭が改行）のときは、入力欄の 1 行目が `❯` だけで
    2 行目以降に最初の空でない行の先頭が現れることで確かめる。入力欄を空にしてから入れるため、「直前の画面からの増加」ではなく「入力欄の先頭が本文で始まること」で判定できる
11. 現れたら `\r` を送る。送ったら `role="status"` で `エージェントに送信しました` を知らせ、ターミナルパネルを開く（閉じていたら）。フォーカスは動かさない
12. 1,000ms 以内に現れなければ `\r` を送らない。理由 `エージェントの入力欄に入りませんでした。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください`
    を出し、パネルを開く。確認画面（信頼の確認の既定は `No, exit`、全画面の表示の案内の既定は `Yes, try it`）で Enter を送ると選択肢が確定してしまうため
    （確認の結果 6・14）、送らない側に倒す。本文が入力欄に入っていた場合は残る（利用者がターミナルで確かめて Enter を押せる）
13. 送信中（5〜12 の間）は、すべての実行ボタンを押せない（2 つの貼り付けが混ざらないように）。また、利用者のターミナルへのキー入力（xterm の `onData`）は
    pty へ送らずに controller が溜め、送信の手順が終わった（成功・失敗のどちらでも）後に順に送る（消去の途中に打鍵が混ざって、消した後に文字が残らないように）。
    DA1 などの問い合わせへの xterm の応答も同じ経路で遅れるが、`claude` は起動の直後にしか問い合わせない（確認の結果 5）ため影響は無い

**送るバイト列のまとめ**

| 段       | バイト列                               | 書き込みの単位・間隔                                                   | 成功の確かめ方                                 | 失敗のときの表示                              |
| -------- | -------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| 消去     | `\x0b` × 12 + `\x15` × 12（24 バイト） | 最低 1 回（空と判定されても送る）。1 回ずつ、30ms 空ける。最大 3,000ms | 入力欄が空（6）が 50ms 空けて 2 回続く         | `エージェントの入力欄を空にできませんでした…` |
| 貼り付け | `\x1b[200~` + 本文 + `\x1b[201~`       | 消去とは別の 1 回の書き込み                                            | 入力欄の先頭が本文で始まる（10）。最大 1,000ms | `エージェントの入力欄に入りませんでした…`     |
| 送信     | `\r`                                   | 確かめた後の 1 回                                                      | —（送った後は `claude` に任せる）              | —                                             |

**エージェントの作業中**: 入力欄はキューとして受け付けるため（確認の結果 8）、作業中でも送れる。消去に使う `Ctrl+K`・`Ctrl+U` は作業を中断しない
（確認の結果 15。`Ctrl+C`・`Esc` は中断するため使わない）。実行中の全ボタンの無効化（従来の `isExecuting`）は使わない。作業中に利用者が入力欄に書きかけた
文字も、ボタンを押すと消える（上書きの決定どおり）。

**書きかけの入力の上書き**: 入力欄に利用者が書きかけた文字（複数行・貼り付けた `[Pasted text #N …]` を含む）は、7 で消えてから本文が入る。消した書きかけは
アプリでは保存しない。確認のダイアログも出さない（ボタンの操作が上書きを表す決定のため）。送信の結果の `role="status"` は、消去の前・途中に入力欄が空でないと
判定できたとき（`clearedDraft`）に `エージェントに送信しました（入力欄に書きかけがあったようなので、消してから送りました）` にする（消したことを利用者に伝える）。
この判定には偽陰性（空と判定される形の書きかけ。確認の結果 34）と偽陽性（空のシェルのモード〈`!` だけ〉）があるため、送信したこと（確かな事実）を先に出し、
書きかけについては断定しない言い方にした（実装時に `入力欄の書きかけを消して、エージェントに送信しました` から変えた。`lib/agentSendMessages.ts` の
`AGENT_SENT_AFTER_CLEAR_NOTICE`）。

**採らなかった消し方**

| 方法                                             | 採らない理由                                                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Ctrl+C` 1 回                                    | 作業中は作業を中断し、入力欄も消えない。直前の `Ctrl+C`（利用者の操作）から約 0.9 秒以内だと `claude` を終了させる（確認の結果 16）                                    |
| `Esc` `Esc`                                      | 作業中は 1 回目で作業を中断し、入力欄も消えない（確認の結果 15・17）。作業中かどうかを画面から確実に判定できない（書きかけがあると `esc to interrupt` の案内が消える） |
| `Ctrl+W` の繰り返し                              | カーソルより前しか消えない（確認の結果 15）                                                                                                                            |
| `Ctrl+E` → `Ctrl+U` の繰り返し                   | 入力の末尾へ一度に移るキーが無く、カーソルより後ろの行が残る（確認の結果 15）                                                                                          |
| `Ctrl+S`（stash）                                | 書きかけは消えずに退避され、送信の後に入力欄へ戻る（確認の結果 24）。上書きの決定と違う                                                                                |
| `Ctrl+G`（外部のエディタ）                       | `EDITOR` をアプリの用意したスクリプトに差し替える必要があり、利用者自身の `Ctrl+G` の動作を変える                                                                      |
| 空にできないときに `claude` を再起動する         | 会話の文脈が失われ、作業中なら作業も止まる。上書きのために失う物が大きすぎる                                                                                           |
| 空かどうかを確かめずに消去と貼り付けを続けて送る | 同じ本文の貼り付けの展開（確認の結果 19）や、確認画面へのキーの送り込みを防げない                                                                                      |

**確認画面の最中に誤って送らないための条件**（すべてを満たすときだけ、それぞれの段のキーを送る）

- 消去のキー: 入力欄を特定できた（5。空と判定されても最低 1 回は送る）。確認画面・選択の画面では特定できないため、消去のキーも送らない（`Ctrl+K`・`Ctrl+U` は信頼の確認の画面で何も起こさなかったが
  〈確認の結果 22〉、ほかの画面での意味は分からないため送らない）
- 貼り付け: 入力欄が空（6）が 2 回続いた（8）
- Enter: 入力欄の記号が `❯` で、先頭が本文で始まる（10）。シェルのモード（`!`）・確認画面では送らない

**許可の確認の最中**: エージェントがツールの許可を求めている画面で、この手順がどう振る舞うか（許可の確認の画面が 5 の並びに当てはまるか）は、API に接続しない
条件では作れず未確認。当てはまらなければ 5 で止まり、何も送らない。当てはまる画面（指示の入力欄がある選択肢など）では、消去・貼り付け・Enter が送られうる。
実装の最初に偽の API で確かめる（「実装の最初に確かめること」3）。→ 偽の Messages API で、選択肢の許可の確認の画面は 5 の並びに当てはまらず何も送らないことを
確かめた（確認の結果 30）。文字列を入力できる確認画面（Tab の amend を開いた状態など）は未確認。

**セッションが無いときのボタン**（「決定した点」1: 無効にして理由を表示）

| 選択肢                                     | 内容                                                                                                 | 評価                                                                                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 無効にして理由を表示（採用）               | `実行` を押せなくし、`エージェントが起動していません（ターミナルの「起動」を押してください）` を出す | 起動の直後は確認画面が出うるため、利用者が画面を見て応答してから送る流れになる。確認画面に Enter を送らない                                                                           |
| 起動して、入力欄が使えるようになったら渡す | 押したら起動し、入力欄が見つかるまで待ってから送る                                                   | 起動直後の確認画面（テーマ・信頼・ログイン・全画面の表示の案内）が出ている間、待ち続ける時間の上限が決められない                                                                      |
| 起動の引数で渡す（`claude "<本文>"`）      | `claude --help` の `[prompt]` 引数で最初のプロンプトを渡す                                           | 入力欄の操作が要らないが、本文を argv に置くため長さの上限（Windows は約 32K 文字）を受け、`[command]` の位置とも重なる。「起動中のセッションの入力欄に貼り付ける」という決定とも違う |

理由はプロンプトパネルの上部に 1 か所だけ表示し、無効のボタンの `aria-describedby` から参照する（パターン 126。タッチでは `title` が出ないため画面に出す）。

### 終了・後始末（孤児のプロセスを残さない）

**停止の手順**（`agentProcessTree.stopTree`。macOS・Linux）

1. 停止の前に、セッションの子孫（`ps -A -o pid=,ppid=` から `claude` の pid を根にたどった一覧）を控える。`claude` は Bash のツールの子を別のセッションで
   動かすため（確認の結果 9）、プロセスグループへのシグナルだけでは届かない子がいる
2. `claude` のプロセスグループに SIGTERM を送る（`process.kill(-pid, 'SIGTERM')`）。実測では `claude` は SIGTERM で自分の子を片付けて終わった
3. 3 秒の猶予（`AGENT_KILL_GRACE_MS`。テストでは注入する）の間に終了しなければ、グループと、1 で控えた子孫のうち残っているものに SIGKILL を送る
   （`claude` を SIGKILL すると子が孤児になるため、子孫にも送る）。猶予のタイマーは `unref` し、終了したら解除する
4. 子の終了の後（猶予の内でも外でも）、1 で控えた子孫のうち生き残っているものに SIGKILL を送る（子を片付けずに終わる場合の孤児を残さない。確認の結果 33）
5. シグナルの例外はすべて握る（ESRCH・EPERM。パターン 107）。`stop` は終了（`onExit`）を待って解決し、二重に呼ばれても 1 回だけ動く

Windows は node-pty の `kill()` に任せたうえで `taskkill /pid <pid> /T /F` を送る（`gitCloneProcess.ts` と同じ。`kill()` が例外を投げても `taskkill` は送る。実機で未確認）。

**停止の契機**

| 契機                                   | 処理                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `終了` ボタン                          | 確認なしで止める（ボタンの文言が操作を表す）。状態は `exited`（理由 `stopped`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| エージェント自身の終了（`/exit` など） | `onExit` で `exited`。帯に `終了しました（終了コード N）` と `起動` を出し、画面の出力は残す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| renderer のリロード                    | main で、メインフレームの文書が実際に入れ替わったときに止める: `did-navigate`（リロード・許可した遷移の確定。新しい文書の preload より先に届く）と、ERR_ABORTED（-3）以外のメインフレームの `did-fail-load`（読み込みに失敗してエラーの画面に入れ替わった）。`did-start-navigation` は使わない（Electron 39 では `will-navigate` より先に届き、`will-navigate` で止めた遷移〈ファイルのドロップなど〉でも届くため、ページが残ったまま止めてしまう。最終レビューの修正で変えた。`cloneLifecycle.ts` は既存のまま `did-start-navigation`）。リロード後の画面はセッションを持たないため。あわせて、Windows・Linux でターミナルにフォーカスがあるままリロードしても止まったままにならないよう、メニューのショートカットの無視（`setIgnoreMenuShortcuts`）を解除する |
| renderer のクラッシュ                  | `render-process-gone` で止める（理由 `stopped`。開いているタブの監視も閉じる）。クラッシュの後にリロードもウィンドウを閉じる操作も無いと、セッションが残り続けるため（実装時に追加）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ウィンドウの破棄                       | `destroyed` で止める                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| フォルダの切り替え                     | main の不変条件「セッションの作業ディレクトリ = 許可のフォルダ」を守るため、`FolderAccessManager.set` が別のパスに変えたら、そのウィンドウのセッションを止める（理由 `folder-changed`）。renderer は「フォルダを変更」と「リポジトリを clone」を押したとき、未保存の確認（`confirmDiscardAnyDirty`）の前にセッションの終了の確認を出す（`フォルダを切り替えると、実行中のエージェントを終了します。続けますか？`。キャンセルしたら未保存の確認は出さない）。同じフォルダを選び直したときは、main が変更として扱わないため止まらない（既知の制約）                                                                                                                                                                                                               |
| 実行方式を従来の方式へ切り替え         | 確認（`従来の方式に切り替えると、実行中のエージェントを終了します。続けますか？`）の後に止める。従来の方式のときはセッションを持たない。エージェントの起動中（`starting`）は選択肢を押せない（起動の依頼が返る前は止められないため。実装時に追加）。従来の方式で実行している間は、どちらの方式も選べない（理由 `従来の方式で実行している間は、実行方式を切り替えられません`。切り替えると出力パネルが消え、キャンセルできないまま実行が続くため。最終レビューの修正で追加）                                                                                                                                                                                                                                                                                     |
| アプリの終了                           | `before-quit` でセッションがあれば `preventDefault` し、全セッションを止めてから（最大で `ps` の打ち切り 2 秒 + 猶予 3 秒 + SIGKILL の後の待ち 1 秒 = 約 6 秒。SIGKILL を送り終えてから終了する。PR #46 のレビュー対応で、`ps` の打ち切りを含めていなかった「猶予 + 1 秒」から変えた）もう一度 `app.quit()` する（再入を防ぐ印を持つ）。止め始めたら registry を閉じ（`close`）、停止を待つ間に届いた `起動` は pty を起動せずに取り消す（`spawn-failed` + 取り消しの detail。2 回目の `before-quit` は素通しのため、その間に起動したセッションは止める手順を通らない）。Windows・Linux で最後のウィンドウを閉じた場合も、`destroyed` で停止を始め、`before-quit` で待つ                                                                                        |
| main プロセスの異常終了                | pty の終了で `claude` に SIGHUP が届き、子も片付けられた（確認の結果 9）。アプリ側の処理は無い                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 外部変更の検知

### 検知の方法の比較

| 方法                                                              | 依存の追加 | macOS                                                         | Windows                                                 | 評価                                                                                                                |
| ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 保存の直前の照合（内容の比較）                                    | なし       | 確実（監視の取りこぼしに依らない）                            | 同じ                                                    | **必須**。上書きの事故はこれで防ぐ                                                                                  |
| `fs.watch` でファイルそのものを監視                               | なし       | rename での置き換えの後に届かなくなる（確認の結果 11）        | 未確認                                                  | 採らない                                                                                                            |
| `fs.watch` で開いているタブの親ディレクトリを非再帰で監視（推奨） | なし       | その場の書き込み・rename・削除のすべてが届く（確認の結果 11） | Node のドキュメントでは非再帰の監視に対応。実機で未確認 | **採る**。イベントの種類は当てにせず、届いたら内容で比べる                                                          |
| `fs.watch` でフォルダ全体を再帰で監視                             | なし       | 対応                                                          | 対応                                                    | `node_modules` などの大量の変化を受ける。ツリーの自動更新と一緒に MVP 後                                            |
| chokidar 5                                                        | 追加       | `fs.watch` の上の補正（rename・重複の吸収）                   | 同じ                                                    | 監視をタブの親ディレクトリに絞る MVP では、補正の利点より依存の追加の方が大きい                                     |
| ウィンドウのフォーカスの復帰で再確認                              | なし       | 確実だが遅い                                                  | 同じ                                                    | 監視の取りこぼし（エラー・未対応の FS）への補助として採る。エージェントはアプリの中で動くため、これだけでは足りない |

**推奨**: 保存の直前の照合（必須）+ 開いているタブの親ディレクトリの非再帰の `fs.watch`（自動の再読込の契機）+ ウィンドウの `focus` での再確認（補助）。
判定はすべて「ディスクの内容」と「タブが最後にディスクと一致した内容（`savedContent`）」の比較で行い、イベントの有無・種類では判定しない。

### 保存の直前の照合

- renderer の `saveFile` は、書き込みの直前（既存の保存の直列化・世代の確認の中、`writeFileContent` を呼んでいる位置）で、`savedContent` の文字列を基準として
  `fs:writeFileChecked(path, content, baseContent)` を呼ぶ（ハッシュにしない理由は確認の結果 32）
- main は、許可の確認の後にディスクの内容を UTF-8 で読み（`fs:readFile` と同じ読み方）、同じ読み方の文字列で比べる。一致すれば書き込んで `written`、
  違えば書き込まずに `conflict`（`modified`）、ファイルが無ければ `conflict`（`deleted`）。照合と書き込みの間の隙は残る（既知の制約。パターン 1）
- `conflict` のとき、renderer は確認を出す（既存の `onConfirm`〈`window.confirm`〉と同じ作り）
  - `modified`: `このファイルは、最後に読み込んだ後にディスク上で変更されています（エージェントなどによる変更）。上書きして保存すると、その変更は失われます。上書きして保存しますか？`
  - `deleted`: `このファイルは、ディスク上で削除されています。保存すると、もう一度作成されます。保存しますか？`
  - OK: `fs:writeFileChecked(path, content, null)`（照合しない書き込み。削除されたファイルも作り直せる。従来の `fs:writeFile` は `realpath` を通すため、削除された
    ファイルを書けない。プランの差異 10）で書き込み、`savedContent` を更新する。キャンセル: 保存しない。タブに外部変更の印を付け、通知（後述）を出す
  - OK の後の書き込みも `conflict` を返したとき（保存先がリンク先の無いシンボリックリンク・確認の間にファイルが作られた）は、`savedContent` を更新せず（未保存の
    印を残す）、保存のエラーとして `保存できませんでした。保存先にリンク先の無いシンボリックリンクがあるか、確認の間にファイルが作成されました。ディスク上の状態を確認してください。`
    を出す（`useFileEditing.ts` の `SAVE_CONFLICT_OVERWRITE_FAILED_MESSAGE`。実装時に追加。書けていないのに未保存の印を消さないため）。確認は繰り返さない
- この照合は実行方式に関係なく常に有効にする（外部のエディタ・git の操作でも同じ事故が起きる）。clone・checkout などアプリ自身の操作の後の再読込（`reloadOpenFiles`）は変えない

### 未編集のタブの自動の再読込と、編集中のタブへの通知

- renderer は開いているタブのパスの一覧が変わるたびに `fs:setWatchedFiles(paths)` を呼ぶ。main は各パスの許可を確かめ（範囲外・存在しないものは無視）、
  親ディレクトリごとに 1 つの非再帰の `fs.watch` を持つ。イベントのファイル名が開いているタブの名前と一致する（または名前が無い）とき、300ms 間引いて
  `fs:externalChange { paths }` を送る。フォルダの切り替え・ウィンドウの破棄・リロードで監視をすべて閉じる。`error` が出た監視は閉じ、フォーカスの再確認に任せる
- renderer（`useExternalFileChanges`）は、通知されたパス（フォーカスの復帰では全タブ）ごとに:
  1. そのパスの保存が実行中なら、保存の完了を待ってから確かめる（自分自身の保存を外部変更と誤認しない。保存の後は `savedContent` がディスクと同じになる）
  2. 読む前の `content`・`savedContent` を控えて、ディスクを読む
  3. ディスク = `savedContent` なら何もしない（自分の保存・同じ内容の書き込み・監視の開始直後の古いイベント）
  4. 違い、タブが未編集（`content === savedContent`）で、読む前の控えから `content`・`savedContent` が変わっていなければ、`content` と `savedContent` をディスクの
     内容にする（パターン 110。読む間に打鍵されたら、未編集ではなくなったものとして 5 に回す）
  5. 違い、タブが編集中なら、内容は変えずにタブに印（`modified`）を付ける
  6. 読めない（削除された）とき: 未編集のタブは既存の `reloadOpenFile` と同じく閉じる。編集中のタブは閉じずに印（`deleted`）を付ける
- 印の付いたタブを表示している間、エディタの上に通知を出す（`ExternalChangeBanner`。文言は常設の空のコンテナ〈`ExternalChangeAnnouncer`。`aria-live="polite"`・`aria-atomic`〉に
  入れて読み上げる。エディタの領域には出力パネルの常設の `role="status"` があり、同じ role を常設すると重なるため、実装時に `role="status"` から変えた。
  読み上げのコンテナは、ターミナルの最大化で隠れるタブと本文〈`.editor-panel__main`〉の外に置き、最大化の間も読み上げる。帯の文言は二重に読まれないよう支援技術から隠す。最終レビューの修正で変えた）:
  `ディスク上のファイルが変更されました（エージェントなどによる変更）。` と `ディスクの内容を読み込む`（`保存されていない変更は失われます。ディスクの内容を読み込みますか？` の確認の後）・
  `このまま編集する`（印を消す。保存の照合は引き続き働く。ディスクの内容が同じままなら、フォーカスの復帰などで通知を出し直さない）。削除のときは `ディスク上のファイルが削除されました。` と `このまま編集する` だけ
- 保存の直前の照合で上書きの確認をキャンセルしたときも、印を直接付けず、上の 1〜6 の確認を通す（確認が知らせたディスクの内容を控えるので、`このまま編集する` で消した後に
  フォーカスの復帰で出し直さない）。保存できたら（照合が通った・上書きした）、そのタブの印を消す（監視に届かないシンボリックリンクのタブでも、保存の後に通知が残らない。最終レビューの修正で追加）
- Monaco との整合: 再読込は `content` の変更として `@monaco-editor/react` に渡り、全体の `executeEdits` + `pushUndoStop` になるため、undo で再読込の前の内容に
  戻せる（戻すとタブは編集中になる）。再読込の後のカーソルとスクロールの位置は未確認（「実装の最初に確かめること」5）。diff タブは変えない（既存の挙動。既知の制約）

## 実行方式の切り替え

### 設定

- 項目: `promptExecutionMode`（`'agent-cli' | 'legacy'`）。保存先: `userData/settings.json`（`settingsFileStore.ts` のマージの書き込み。API キー・モデルと同じファイル）。
  既定値: 値が無い・不正なら `'agent-cli'`。main で検証してから保存する
- 画面: 設定パネルの最上部に `プロンプトの実行方式` の見出しと、2 つの選択肢（`role="radiogroup"`・`role="radio"`・`aria-checked`）:
  `エージェント CLI（アプリ内のターミナルで Claude Code を動かす）`・`従来の方式（Claude API・非対話の CLI で実行し、出力パネルに表示）`。選ぶとすぐ保存する。従来の方式で実行している間は選べず、理由 `従来の方式で実行している間は、実行方式を切り替えられません` を出す（最終レビューの修正で追加）。
  既存の `Anthropic API キー` と `モデル` には `従来の方式で使います` の説明を添える（入力は両方式で可能なまま）
- 読み込みが終わるまでは、実行ボタンを押せない（理由 `設定を読み込んでいます`）

### 既存の導線への影響（衝突調査の C1〜C21）

扱い: 置き換え／残す／導線を分岐（方式で出し分け）／対象外。

| #   | 箇所                                              | 扱い             | エージェント CLI 方式                                                                                                                                                                   | 従来の方式                                           |
| --- | ------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| C1  | 実行ボタン（`PromptItemView`・`usePromptRunner`） | 導線を分岐       | 押すとセッションへ送信。表示の文言は `実行` のまま、`aria-label` を `実行（エージェントに送信）` にする（パターン 76）                                                                  | 従来どおり                                           |
| C2  | ファイル内容の添付（`buildPromptContent`）        | 導線を分岐       | 添付しない（エージェントが自分で読む）                                                                                                                                                  | 従来どおり添付する                                   |
| C3  | 実行ツールの選択（`ExecutionToolSelector`）       | 導線を分岐       | 表示しない（送信先は起動中のセッション）                                                                                                                                                | 従来どおり                                           |
| C4  | `cliService`・`cli:runPromptStream`               | 残す             | 使わない。PATH の既定の探索先だけ `cliSearchPaths.ts` へ切り出して共有する                                                                                                              | 従来どおり                                           |
| C5  | Claude API の実行（`claudeService` ほか）         | 残す             | 使わない                                                                                                                                                                                | 従来どおり                                           |
| C6  | API キーの設定                                    | 残す             | 表示は残し、従来の方式で使う旨を添える。API キーを pty の環境変数に入れない（`claude` の認証は `claude` に任せる）                                                                      | 従来どおり                                           |
| C7  | モデル・max_tokens                                | 残す             | 表示は残す（同上）。`claude` のモデルは `claude` の中（`/model`）で選ぶ                                                                                                                 | 従来どおり                                           |
| C8  | 出力パネル                                        | 導線を分岐       | 表示しない。同じ位置にターミナルパネルを置く                                                                                                                                            | 従来どおり（ターミナルパネルは出さない）             |
| C9  | エディタへの挿入・置換                            | 残す             | 出力パネルを出さないため使わない                                                                                                                                                        | 従来どおり                                           |
| C10 | エディタと外部変更の整合                          | 置き換え（新規） | 保存の照合・監視・再読込（前節）                                                                                                                                                        | 同じく有効                                           |
| C11 | 実行履歴                                          | 導線を分岐       | 送信を記録しない。履歴の一覧・詳細は表示し、`再実行` は押せなくして理由 `エージェント CLI 方式では再実行できません（設定で従来の方式に切り替えると使えます）` を出す（「決定した点」5） | 従来どおり                                           |
| C12 | キャンセル（`prompt:cancel`）                     | 対象外           | 中断はターミナルで `Esc`（`claude` の画面の案内 `esc to interrupt`）。アプリは `終了` だけを持つ                                                                                        | 従来どおり                                           |
| C13 | 実行中の全ボタンの無効化（`isExecuting`）         | 導線を分岐       | 「セッションが `running` で、送信中でない」で決める                                                                                                                                     | 従来どおり                                           |
| C14 | ステータスの表示（`StatusBar`）                   | 対象外           | 変えない（セッションの状態はパネルの帯に出す。ステータスバーは MVP 後）                                                                                                                 | 変えない                                             |
| C15 | 変数テンプレート                                  | 残す             | 差し込んだ後の本文を送る。フォームの見出し `変数を入力して実行` も変えない                                                                                                              | 従来どおり                                           |
| C16 | ストリーミングの IPC（`prompt:streamChunk`）      | 残す             | 新しいチャンネルに作りだけ流用する（`isDestroyed` の確認、解除関数を返す購読）                                                                                                          | 従来どおり                                           |
| C17 | ウィンドウ・renderer のライフサイクル             | 置き換え（新規） | `agentSessionLifecycle.ts`（リロード・破棄・終了で停止）                                                                                                                                | セッションが無いので影響なし                         |
| C18 | キーボードショートカット（`useQuickOpen`）        | 置き換え（新規） | ターミナルの中の `Ctrl+P` を除外（後述）                                                                                                                                                | 同じ（ターミナルが無いので影響なし）                 |
| C19 | 作業ディレクトリ                                  | 置き換え（新規） | main が許可のフォルダから決める。フォルダが無いと起動できない                                                                                                                           | `cliService` の `cwd` は変えない（既知の制約に残る） |
| C20 | ROADMAP の文言                                    | 対象外（済）     | ROADMAP は改訂済み。実装の最終タスクで MVP の項目を実装済みへ移し、既知の制約を足す                                                                                                     | —                                                    |
| C21 | その他の文書（README など）                       | 対象外           | 製品のコンセプトの記述が無いため変えない                                                                                                                                                | —                                                    |

旧方式で残す機能: Claude API・非対話 CLI の実行、ツールの選択、ファイル内容の添付、出力パネル（ストリーミング・Markdown・挿入と置換・キャンセル）、
実行履歴の記録と再実行、API キー・モデルの設定。エージェント方式のときに隠すもの: ツールの選択、出力パネル。無効にするもの: 履歴の `再実行`（理由つき）。
手動テスト仕様の PRM・RUN・OUT・APL の既存の項目は、前提に「設定の実行方式を従来の方式にする」を足す（期待結果は変えない。ID は変えない）。

## セキュリティ

- **公開面の変化**: `agentTerminal:write` は `claude` の入力欄にキー入力を送れる。`claude` の `!`（Bash モード）は任意のシェルのコマンドを実行するため、
  renderer がこのチャンネルを使えることは、利用者の権限での任意のコマンドの実行と同じになる（現状の renderer は許可フォルダ内のファイル操作・git・
  `claude --print` まで）。renderer の脆弱性（XSS）が即座にコマンドの実行になるため、次を MVP に入れる
- **preload の汎用 IPC を外す**: `window.electron`（`electronAPI`）は任意のチャンネル名の `invoke`/`send` を通すため、`window.api` の許可リストを素通りして
  `agentTerminal:write` を呼べ、`process.env` の写し（環境変数の秘密）も読める。renderer は使っていないので、`contextBridge.exposeInMainWorld('electron', …)` と
  型定義から外す（確認の結果 13）
- **起動のコマンド・作業ディレクトリ・環境変数は main で決める**: renderer から受け取るのは `folderPath`（許可との一致の確認だけに使う）・桁数・行数・
  書き込む文字列・`sessionId` だけ。引数は空で固定し、`--dangerously-skip-permissions`・`--permission-mode` などを付けない（エージェントの権限は `claude` の
  設定と確認の画面に任せる）
- **入力の検証**（`agentTerminalPayloadParser.ts`。`assertPlainObject` を使う）: `sessionId` は送信元の webContents のセッションの id と一致すること（違えば
  何もしない。古い画面からの書き込みを捨てる）。`data` は文字列で 1,000,000 文字（UTF-16 の単位）以下。桁数・行数は整数で 2〜500・1〜300。
  送信元は `event.senderFrame` がその webContents のメインフレームであること
- **環境変数**: main の `process.env` を写し、`PATH` を「PATH の継承」の結果にし、`TERM=xterm-256color`・`COLORTERM=truecolor` を設定する。
  `LANG`・`LC_ALL`・`LC_CTYPE` がどれも無ければ `LANG=en_US.UTF-8` を足す（GUI の起動では `LANG` が無い。確認の結果 3）。次を取り除く:
  `ELECTRON_*`（`ELECTRON_RUN_AS_NODE` などが子の Electron 製のツールの挙動を変えるため）、`TERM_PROGRAM`・`TERM_PROGRAM_VERSION`・`VSCODE_*`
  （開発時に VS Code の端末から引き継ぐ）、親の Claude Code のセッションを表す `CLAUDECODE`・`CLAUDE_PID`・`CLAUDE_CODE_SESSION_ID`・
  `CLAUDE_CODE_CHILD_SESSION`・`CLAUDE_CODE_SESSION_ATTENDED`・`CLAUDE_CODE_MESSAGING_SOCKET`・`CLAUDE_CODE_MESSAGING_TOKEN`・`CLAUDE_CODE_SSE_PORT`・
  `CLAUDE_CODE_ENTRYPOINT`・`CLAUDE_CODE_EXECPATH`（確認の結果 12。親のセッションの通信先と token を渡さないため）。`CLAUDE_CODE_USE_BEDROCK` などの
  利用者の設定の変数は残す（`CLAUDE_CODE_` で一括に消さない）。`GIT_ASKPASS` は残す（パターン 81。利用者の設定を上書きしない）
- **CSP**: 変更しない。xterm 6 は `style-src 'unsafe-inline'` の範囲で動き、Worker・`eval` を使わない（確認の結果 10）。WebGL のアドオンは入れない
- **sandbox・contextIsolation**: `contextIsolation` は既定の true のまま。`sandbox: false` はこの MVP では変えない（preload を node-pty なしで作るので
  `sandbox: true` にできる可能性はあるが、別に確かめる。MVP 後の候補。使わなくなった `@electron-toolkit/preload` は最終レビューの修正で依存から外した）
- **遷移と新しいウィンドウ**: `will-navigate` で、アプリ自身の URL（パッケージ版は `file://` の同じホスト〈通常は空〉の `index.html`、開発時は `ELECTRON_RENDERER_URL`）以外への遷移を
  `preventDefault` する（遷移した先のページに preload の API が渡らないように）。`setWindowOpenHandler` は `http:`・`https:` だけを `shell.openExternal` に渡し、
  ほかのスキーム（`file:`・独自のスキーム）は開かずに `deny` する。既定のブラウザで開けない（`shell.openExternal` が reject した）ときは何もしない
  （`shell:openExternalLink` は `false` を返す。renderer に処理されない reject を出さない）。止めた遷移では、エージェントのセッションも外部変更の監視も止めない（「停止の契機」）
- **ターミナルの出力のエスケープシーケンス**: xterm が描画し、HTML としては解釈されない。DA1・DSR などの問い合わせへの xterm の応答は `onData` から pty へ
  返す（`claude` が問い合わせている。確認の結果 5）。OSC 52（クリップボードへの書き込み）は xterm の本体が扱わず、`@xterm/addon-clipboard` を入れないので
  出力からクリップボードは変わらない。OSC 0/2（タイトル）は使わない（`document.title` を変えない）。ベルは無視する
- **リンク**: OSC 8 のハイパーリンクは xterm が下線で描画し、利用者がクリックしたときに `linkHandler` が呼ばれる。`linkHandler` で `http:`・`https:` だけを
  `openExternalLink`（main でもスキームを確かめる）に渡し、ほかは何もしない。URL の文字列の自動のリンク化（`@xterm/addon-web-links`）は入れない
  （ログインの URL などはコピーして使う。MVP 後の候補）
- **クリップボード**: 読み取りは利用者の貼り付けの操作のときだけ行い、出力やプログラムからは読まない

## パッケージング

**手順（推奨）**

1. `node-pty`（1.1.0）を dependencies に足す。`npm install` の postinstall（`electron-builder install-app-deps`）が Electron 39 向けにソースからビルドし、
   実行権限付きの `build/Release/spawn-helper` を作る（確認の結果 1。prebuild の `spawn-helper` の権限の問題を避けられる）
2. `electron-builder.yml` の `asarUnpack` に `node_modules/node-pty/**` を明示する。実測では明示しなくても展開されたが（確認の結果 2）、electron-builder の
   自動の判定に依らず、意図を設定に残すため
3. `npmRebuild: false` は変えない（パッケージの時に再ビルドしない。postinstall の成果物を使う）
4. 各 OS の成果物は、その OS の上でビルドする。`node-pty` は `build/Release` を prebuilds より先に読むため、mac で postinstall した `build/Release`（mac 用）が
   win 向けのパッケージに入ると、Windows で読み込みに失敗しうる（衝突調査の指摘。未確認）。クロスビルドは既知の制約にする
5. CI は無い。導入するときは、`npm ci` の後に `install-app-deps` が走ること、Linux ではビルドツール（python・make・g++）が要ることを前提にする

**実験で確かめた事実**（macOS arm64）: prebuild の `spawn-helper` の権限で `posix_spawnp failed.` になること、`install-app-deps` と `electron-rebuild` の
どちらでも直ること、`--dir` のパッケージで自動で `app.asar.unpacked` に展開され、launchd 経由の起動で pty が動いたこと、Electron 向けの `pty.node` を素の
node から読めること（確認の結果 1・2）。

**未確認の事実**: このリポジトリそのものでの `npm ci`（クリーンな状態からの postinstall）と `npm run build:unpack` での動作、署名・公証した
（hardened runtime の）パッケージでの `spawn-helper` の実行、Windows（ConPTY。`claude` の Windows での起動条件を含む）、Linux（prebuild が無くソースのビルドが
必須。AppImage・snap の中での pty）、クロスビルド。mac の成果物に他の OS の prebuilds が入る（不要なファイルの除外は MVP 後）。

## キーバインドとフォーカス

- **アプリのショートカットとの衝突**: ターミナルの領域（`AgentTerminalView` の要素に `data-agent-terminal`）の中にフォーカスがあるとき:
  - `useQuickOpen` の capture のハンドラは、`event.target` がターミナルの中なら `Ctrl+P`（`ctrlKey` で `metaKey` なし）を処理せずに通す（xterm が `\x10` を送る。
    `claude` とシェルで履歴の上）。macOS の `Cmd+P` はターミナルの中でもクイックオープンを開く（`Cmd` の組み合わせは端末へ送らない）。Windows・Linux では
    ターミナルの中からクイックオープンを開けない（フォーカスを外してから使う）
  - Escape: クイックオープンが開いていないときは、これまでどおり処理しない（`claude` の中断に使う）
  - 判定は `lib/agentTerminalKeys.ts` の `isInsideAgentTerminal(target)` 1 か所に置き、他の document のハンドラ（今後のものを含む）もこれを使う
- **メニューのショートカット**: Windows・Linux の Electron の既定のメニューには `Ctrl+W`（ウィンドウを閉じる）などがあり、ターミナルの `Ctrl+W`（単語の削除）と
  重なる。ターミナルにフォーカスがある間は `setAgentTerminalFocused(true)` で main が `webContents.setIgnoreMenuShortcuts(true)` にし、外れたら戻す
  （Windows・Linux だけ。macOS は `Cmd` の組み合わせで重ならず、Edit メニューのコピー・貼り付けを生かすため変えない）。既定のメニューのショートカットが
  ページより先に効くかは未確認（実装の最初に確かめること 7）
- **パッケージ版の `Ctrl+R`**: `optimizer.watchWindowShortcuts` が `before-input-event` で `Ctrl/Cmd+R` を `preventDefault` するため、ターミナルに届かない
  （`claude` の履歴の検索に使えない）。MVP では既知の制約とし、`watchWindowShortcuts` の置き換えは MVP 後にする（`Ctrl/Cmd+-`・`Ctrl/Cmd+Shift+=` も同じ）
- **コピー**: macOS は `Cmd+C`（Edit メニューのコピーで、xterm が選択範囲をクリップボードへ渡す）。Windows・Linux は `Ctrl+Shift+C`（選択範囲があるとき。
  `attachCustomKeyEventHandler` で処理して pty へ送らない）。`Ctrl+C` は常に端末へ送る（`claude` の中断・終了）
- **貼り付け**: macOS は `Cmd+V`、Windows・Linux は `Ctrl+Shift+V`。どちらも xterm の貼り付け（bracketed paste が有効なら囲む）を通す。利用者自身の貼り付けは
  端末の通常の挙動とし、正規化しない
- **フォーカスの出入り**: ターミナルはクリック・タップで入る。xterm は `Tab`・`Shift+Tab` を端末へ送る（`claude` は `Shift+Tab` で許可のモードを切り替える）ため、
  キーボードで抜ける手段として `F6` を割り当てる（`attachCustomKeyEventHandler` で処理し、端末へ送らない。パネルの帯の開閉ボタンへフォーカスを移す）。
  帯に `F6 でターミナルから抜けます` を `aria-describedby` で添える。パネルを閉じるとき・最大化を戻すときに、フォーカスがターミナルの中なら帯の開閉ボタンへ移す
  （パターン 86。消える要素にフォーカスを残さない）
- **支援技術**: xterm の `screenReaderMode` は MVP では有効にしない（既定）。ターミナルの要素に `aria-label="エージェントのターミナル"` を付ける。送信の結果は
  ターミナルの外の `role="status"` で知らせる（パターン 87。同じ文言の連続でも読み上げられるよう `toAnnouncementText` を使う）
- **IME**: xterm の入力欄（textarea）が変換を扱う。日本語の入力は実機で確かめる（手動テスト）

## PATH の継承と起動のエラー

### PATH の継承

| 選択肢                                                                         | 内容                                                                                                             | 評価                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. 既定の探索先を足して直接起動（`cliService` の `buildEnv` と同じ）           | `/usr/local/bin`・`/opt/homebrew/bin`・`~/.local/bin` などを足す                                                 | nvm・volta・asdf の配下（npm でグローバルに入れた `claude`）が見つからない（確認の結果 3）                                                                                                    |
| B. ログインシェルの中で起動（pty で `$SHELL -l -i -c 'exec claude'`）          | シェルの初期化を通してから `claude` に置き換える                                                                 | PATH は解決するが、見つからないときはシェルの `command not found` と終了コード 127 になり、アプリが理由を出し分けにくい。シェルの初期化の出力（oh-my-zsh の更新の確認など）がターミナルに出る |
| C. ログインシェルから PATH だけを取得し、`claude` を絶対パスで直接起動（推奨） | 起動ごとに `$SHELL -l -i -c` を端末なしで実行して PATH を取り出し、その PATH で `claude` を探して直接 spawn する | 実測で約 0.33 秒（確認の結果 3）。見つからないことを起動の前に判定でき、理由を出せる。シェルの初期化の出力はターミナルに出ない                                                                |

**推奨は C**。取得の詳細: `SHELL`（無ければ `os.userInfo().shell`、それも無ければ `/bin/sh`）を `['-l', '-i', '-c', 'printf "%s%s%s" "<開始の印>" "$PATH" "<終わりの印>"']` で
`child_process.spawn`（標準入力は `ignore`、`detached: true`、環境は main の `process.env`）。5 秒で打ち切り、プロセスグループごと止める（パターン 84・107）。
印の間を取り出し、空・取得の失敗では A の PATH に倒す（倒したことは `claude` が見つからなかったときの理由に添える）。取得した PATH の後ろに A の探索先を足す。
`claude` 自身の Bash のツールは、`claude` が利用者のシェルの環境を自分で取り込む（実測の `ps` で `snapshot-zsh-*.sh` を `source` していた）ため、アプリが渡す
PATH の役目は `claude` を見つけることと、その起動に要るもの（npm で入れた `claude` なら `node`）を通すことになる。Windows はログインシェルを使わず、
`process.env.PATH` と `PATHEXT` で `claude` を探す（`claude.exe`・`claude.cmd` の起動の可否は未確認）。

### エラー処理

| 状況                                                             | 判定                                               | 表示（パネルの帯の下、`role="alert"`）                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| フォルダを開いていない                                           | renderer（`起動` が押せない）・main（`no-folder`） | `フォルダを開いてください`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 表示中のフォルダと許可が違う                                     | main（`folder-mismatch`）                          | `開いているフォルダが切り替わりました。もう一度「起動」を押してください`                                                                                                                                                                                                                                                                                                                                                                                                   |
| フォルダが消えた                                                 | main（`folder-missing`）                           | `開いているフォルダが見つかりません: <path>`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `claude` が見つからない                                          | main（`command-not-found`）                        | `claude コマンドが見つかりません。Claude Code をインストールしてください（探した場所: ログインシェルの PATH）`。PATH の取得に失敗していたら `（ログインシェルから PATH を取得できなかったため、既定の場所だけを探しました）` を添える                                                                                                                                                                                                                                      |
| 起動の失敗（spawn が例外を投げた）                               | main（`spawn-failed`）                             | `エージェントを起動できませんでした: <詳細>`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 起動の依頼の失敗（IPC の例外）                                   | renderer                                           | `エージェントを起動できませんでした: <詳細>`（`spawn-failed` と同じ文言の形。実装時に追加。プランの差異 16）                                                                                                                                                                                                                                                                                                                                                               |
| 終了の失敗（IPC の例外）                                         | renderer                                           | `エージェントを終了できませんでした: <詳細>`（実装時に追加。プランの差異 16）                                                                                                                                                                                                                                                                                                                                                                                              |
| 途中で終了                                                       | `onExit`                                           | 帯に `終了しました（終了コード N）`。画面の出力（`claude` 自身のエラー）は残す。起動の直後（2 秒以内）に終了コード ≠ 0 で終わったら `起動の直後に終了しました。ターミナルの表示を確かめてください` を添える（node-pty が起動の失敗を終了コード 1 で返すため。確認の結果 4）                                                                                                                                                                                                |
| ログインが必要                                                   | アプリは判定しない                                 | `claude` が自分の画面でログインの方法を案内する（確認の結果 6）。利用者はターミナルで操作する                                                                                                                                                                                                                                                                                                                                                                              |
| 既に起動している                                                 | main（`already-running`）                          | 何も出さず、既存のセッションに合わせる                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 送信できない（理由ごと）                                         | renderer                                           | 前節の文言（`エージェントが起動していません…`・`送信する内容がありません`・`プロンプトが長すぎます`・`先頭が「!」のプロンプトは…`・`エージェントが入力を受け付けていません`・`エージェントの入力欄が見つかりません…`・`エージェントの入力欄を空にできませんでした…`・`エージェントの入力欄に入りませんでした…`）。プロンプトパネルの上部に `role="alert"` で出し、パネルを開く                                                                                             |
| 送信中（理由）                                                   | renderer                                           | 送信の手順の間は実行ボタンを押せず、理由 `エージェントへ送信しています` を出す（パターン 126。実装時に追加。プランの差異 16）                                                                                                                                                                                                                                                                                                                                              |
| 送信の途中の例外（書き込み・画面の読み取り）                     | renderer                                           | `エージェントへ送信できませんでした: <詳細>`（`lib/agentSendMessages.ts` の `AGENT_SEND_ERROR_PREFIX`。送信の失敗と同じ位置に出す。例外で reject せず、送信中の状態と打鍵の保留を解く。実装時に追加）                                                                                                                                                                                                                                                                      |
| 実行方式の保存の失敗                                             | main の例外                                        | 設定パネルに `実行方式を保存できませんでした: 設定ファイルを読み書きできませんでした。ほかのアプリで settings.json を開いていれば閉じてから、もう一度試してください。続くときはアプリのデータフォルダの settings.json が壊れていないか確かめてください`（選択は保存前の値に戻す。理由は固定の文言で、例外の文言は画面に出さず console.error に記録する。settings.json のパスや中身の断片を含みうるため。L-017。2026-10-21 に例外の文言〈`<詳細>`〉を出していたのを直した） |
| 実行方式を選べない（従来の方式の実行中）                         | renderer                                           | 設定パネルの選択肢の下に `従来の方式で実行している間は、実行方式を切り替えられません`（選択肢から `aria-describedby` で参照する。`role="alert"` ではない。最終レビューの修正で追加）                                                                                                                                                                                                                                                                                       |
| 既定のブラウザで開けない（`shell.openExternal` の reject）       | main                                               | 表示しない（`shell:openExternalLink` は `false` を返し、新しいウィンドウの依頼は何もしない。最終レビューの修正で追加）                                                                                                                                                                                                                                                                                                                                                     |
| 実行方式の読み込みの失敗（設定ファイルの JSON が壊れているなど） | renderer                                           | 表示しない（console に記録し、既定のエージェント CLI 方式で続ける。画面が起動できなくならないため。実装時に追加）                                                                                                                                                                                                                                                                                                                                                          |
| 照合付きの保存の失敗（権限など）                                 | main の例外                                        | 既存の保存のエラーの表示と同じ                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 上書きの確認の OK の後も書けない                                 | main（2 回目の `conflict`）                        | 保存のエラーとして `保存できませんでした。保存先にリンク先の無いシンボリックリンクがあるか、確認の間にファイルが作成されました。ディスク上の状態を確認してください。`（`SAVE_CONFLICT_OVERWRITE_FAILED_MESSAGE`。未保存の印は残す。実装時に追加）                                                                                                                                                                                                                          |

## テスト方針

**単体（vitest）**

- shared: `normalizeAgentPrompt`（改行の統一、`ESC`・`ESC[201~` の除去、C0・DEL・C1 の除去、`\t` の保持、空白だけ、上限の境界、サロゲートペア・日本語、
  先頭の `!` の拒否と、先頭が空白・改行の `!` は通すこと）と `buildAgentPasteBytes`（囲みの位置）、`AGENT_CLEAR_INPUT_CHUNK`（`Ctrl+K` × 12 + `Ctrl+U` × 12・24 バイト）
- 環境: main のテストも jsdom で走る（確認の結果 26。実物の node-pty もそのまま動く）
- main: `agentCommand`（PATH の解析・探索の順序・実行権限の無いファイルを飛ばす・Windows の `PATHEXT`。存在確認は注入）、環境変数の組み立て（取り除く変数・
  残す変数・`LANG` の補い）、`agentShellEnv`（印の抜き出し・打ち切り・失敗で倒す。spawn を注入）、`ps` の出力の解析と子孫の木、`agentSession`（偽の pty で、
  書き込み・リサイズ・終了・二重の stop・終了後の書き込みを無視）、`agentSessionRegistry`（重複の起動・所有者の確認・古い `sessionId`）、
  `agentSessionLifecycle`（リロード・破棄・フォルダの変更・終了の待ち。偽の app・webContents）、payload の検証（型・上限・整数・送信元）、
  `checkedFileWrite`（保存の直前の照合。旧 `fileChangeGuard` を統合した。一致・不一致・削除・UTF-8 の BOM と CRLF・renderer の基準の文字列と同じ読み方で比べること）、`openFileWatcher`（`fs.watch` を注入して、間引き・
  名前の一致・監視の閉じ方）、`executionModeStore`（既定値・不正な値）
- renderer: `agentInputBox`（今回の実験で記録した画面の行〈文字列と dim・反転の位置〉を台帳に残してテストの入力にする: 空の入力欄・送信待ちの案内
  〈dim〉・単一行・複数行・折り返し・`[Pasted text #N +M lines]`・シェルのモード〈`!`〉・`/` の候補が開いた画面・入力欄が画面の高さを超えた画面・
  信頼の確認・全画面の表示の案内の画面〈入力欄が見つからない〉・本文が `❯ ` の直後から始まる/始まらない・先頭が改行の本文）、
  `agentTerminalKeys`（OS ごとのコピー・貼り付け・`F6`・`Ctrl+P`）、`useAgentPromptSender`（偽の controller〈書き込みを記録し、書き込みに応じて画面の行を返す〉で:
  空と判定された入力欄にも消去のキーを最低 1 回送る（確認の結果 34）・書きかけがあれば 24 バイトずつ 30ms 空けて送り空になったら止める・1 回の書き込みが 24 バイトを超えない・
  消去と貼り付けが別の書き込み・空が 2 回続くまで貼り付けない・3,000ms で空にならなければ貼り付けも Enter も送らない・入力欄が見つからなければ何も送らない・
  途中で入力欄が見つからなくなったら止める・現れないとき Enter を送らない・`!` のモードに入ったら Enter を送らない・送信中の無効化・送信中の打鍵を溜めて後で送る・
  偽のタイマーは `afterEach` で戻す）、`useAgentSession`、`useExternalFileChanges`（未編集の再読込・編集中の印・読む間の打鍵・保存中の待ち・
  同じ内容）、`useFileEditing` の照合付きの保存（`conflict` の確認と上書き・キャンセル）、`useQuickOpen`（ターミナルの中の `Ctrl+P`）、各コンポーネントの
  表示・無効の理由・`aria-*`
- xterm は jsdom で描画しないため、renderer のテストは `agentTerminalController` を最小のインターフェースで受けて偽物を使う（パターン 128・129）

**結合（実物の pty。macOS の開発者のローカルで走らせる）**

- 実物の node-pty と偽のエージェント（`/bin/sh` のスクリプト: `ESC[?2004h` を出し、受け取った入力を記録する／孫を `setsid` で起動する／SIGTERM を無視する）で、
  起動・書き込み・貼り付けのバイト列が届くこと、`stopTree` の後に孫まで残らないこと（`__tests__/helpers/processProbe.ts` を使う）、SIGTERM を無視するものが
  猶予の後に止まること
- 実物の `fs.watch` で、その場の書き込み・rename・削除の通知（時間を待つため、間引きの値は注入して短くする）
- 実物の `claude` は自動テストで使わない（インストールの有無・版・ログインの状態に依存し、API に接続しうるため）。`claude` の画面の変化は、確認の結果の手順を
  台帳に残し、版を上げたときに手で確かめる
- 実物を使うテストは `*.integration.test.ts` にし、CI を導入するときは macOS と Linux（`setsid`・`ps` の違い）で分ける（パターン 46）

**実機（Electron）でしか確かめられない項目** → 手動テスト仕様の新しい接頭辞 `AGT` の項目案（`docs/manual-test-spec.md` の「エージェント CLI のアプリ内ターミナル」に
AGT-001〜AGT-070 として追記した。実装で分かった確認の項目〈狭い幅の帯・フォーカスリング・日本語入力の変換中の `F6`・シンボリックリンクの保存など〉もそちらに足した）

- `npm run build:unpack` の成果物を Finder から起動し、フォルダを開いて `起動` → そのフォルダで `claude` の画面が出る（nvm の配下の `claude` でも）
- フォルダを開かずにパネルを開く → `起動` が押せず `フォルダを開いてください` が出る
- `claude` を PATH から外した環境で `起動` → `claude コマンドが見つかりません…` が出る
- 起動の直後、信頼の確認の画面が出ている間にプロンプトの `実行` → 選択肢が確定されず、`エージェントの入力欄が見つかりません…` が出る
- 入力欄が空のときにプロンプトの `実行` → 本文が入り、送信され、エージェントが作業を始める。`エージェントに送信しました` が読み上げられる
- 複数行のプロンプト・`{{変数}}` を含むプロンプトの `実行` → 改行を保った 1 つの入力として送られる
- 40 行以上のプロンプトの `実行` → `[Pasted text #1 +N lines]` と表示されて送信される
- エージェントの作業中にプロンプトの `実行` → キューに入る（`Press up to edit queued messages`）
- 入力欄に `abc` を書きかけてからプロンプトの `実行` → `abc` が消え、プロンプトの本文だけが送信される。`エージェントに送信しました（入力欄に書きかけがあったようなので、消してから送りました）` が読み上げられる
- 入力欄に複数行（`\` に続けて Enter で改行）を書きかけ、カーソルを 1 行目の途中に動かしてからプロンプトの `実行` → 全部の行が消え、本文だけが送信される
- 40 行以上の文字列を入力欄に貼り付けて（`[Pasted text #1 +N lines]`）からプロンプトの `実行` → 貼り付けた分が消え、本文だけが送信される
- 入力欄で `!` を押してシェルのモードにしてからプロンプトの `実行` → 通常の入力欄に戻り、本文がエージェントへ送信される（シェルのコマンドとして実行されない）
- エージェントの作業中に入力欄へ書きかけてからプロンプトの `実行` → 作業は中断されず（`Interrupted` が出ない）、書きかけが消えて本文がキューに入る
- 先頭が `!` のプロンプトの `実行` → 何も送られず、`先頭が「!」のプロンプトは…` が出る
- `/model` などの選択の画面を開いた状態でプロンプトの `実行` → 画面の選択肢が変わらず、`エージェントの入力欄が見つかりません…` が出る
- セッションが無いときのプロンプトパネル → `実行` が押せず、理由が上部に出る。VoiceOver で理由が読まれる
- ターミナルの `終了` → `pgrep -fl claude` に残らない。エージェントが Bash で起動した `sleep` も残らない
- エージェントの作業中に View > Reload → セッションが止まり、`claude` と子プロセスが残らない
- ウィンドウを閉じる（macOS）・アプリを終了する → 同じく残らない
- セッションの実行中に「フォルダを変更」→ 終了の確認が出て、続けるとセッションが止まり新しいフォルダが開く。キャンセルすると何も変わらない
- 実行方式を従来の方式へ切り替える（セッションの実行中）→ 終了の確認が出る。切り替えると出力パネルとツールの選択が戻り、従来どおり実行できる
- 未編集のタブで開いているファイルをエージェントに書き換えさせる → 1 秒以内にタブの内容が変わる。`Cmd+Z` で書き換えの前に戻る
- 編集中のタブのファイルをエージェントに書き換えさせる → 内容は変わらず通知が出る。保存すると上書きの確認が出る。キャンセルで保存されない
- 通知の `ディスクの内容を読み込む` → 確認の後にディスクの内容になる
- 外部のエディタで書き換えてからアプリに戻る（フォーカスの復帰）→ 未編集のタブが更新される
- 保存した直後に、自分の保存が外部変更として通知されない
- ターミナルの中で `Ctrl+P` → クイックオープンが開かず、`claude` の履歴が動く。macOS の `Cmd+P` はクイックオープンを開く
- ターミナルの中で `F6` → パネルの帯の開閉ボタンへフォーカスが移る
- ターミナルで範囲を選んで `Cmd+C`、エディタで `Cmd+V` → 選んだ文字列が貼られる。`Cmd+V` でターミナルへ貼り付けられる
- ターミナルで日本語を IME で入力する → 変換・確定ができ、`claude` の入力欄に入る
- パネルの開閉・最大化・ウィンドウの大きさの変更 → `claude` の画面の枠が幅に合わせて描き直される
- `claude` の出力の `https://` のリンク（OSC 8）をクリック → 既定のブラウザで開く。`file:` のリンクは開かない
- タッチ操作で帯のボタン（開閉・起動・終了・最大化）を押せる（32px 以上）

## 既知の制約（設計時点。実装で追記した）

- プロンプトの `実行` は、入力欄の書きかけ（複数行・貼り付けを含む）を確かめずに消す（上書きの決定どおり。アプリは書きかけを保存しない。`claude` の `Ctrl+Y` で最後に消した分だけは戻せる）。作業中に書きかけた文字も消える
- 消去のキーは入力欄が空と判定されても最低 1 回送るため、画面の属性では空と区別できない書きかけ（1 文字の書きかけの後ろに dim の候補が出てカーソルを戻した形・空白 1 文字の書きかけ。確認の結果 34）も消えるが、送信の通知は `エージェントに送信しました` だけになり、書きかけを消したことは伝わらない。
  逆に、空のシェルのモード（`!` だけ）では、書きかけが無くても `エージェントに送信しました（入力欄に書きかけがあったようなので、消してから送りました）` が出る
- 入力欄を空にする手順は、`claude` 2.1.288 の画面の作り（罫線・`❯` と U+00A0・dim の案内）と、`Ctrl+K`・`Ctrl+U` の挙動、まとめて届いたキーを貼り付けとして扱う判定（48 バイトまでは効いた）に依る。版が変わってこれらが変わると、空にできない（`エージェントの入力欄を空にできませんでした`）
  ・入力欄が見つからない・送れるのに送らない（`エージェントの入力欄に入りませんでした`）ことがある。どの場合も Enter は送らない側に倒れる
- 空の入力欄に、dim でない案内の文字（例文など）が出る環境では、空と判定できずに送れない（この環境では観察していない。ログイン済みの環境での見え方は未確認。「実装の最初に確かめること」9・AGT-041）
- 入力欄の行が画面の高さを大きく超える書きかけ（実測で 300 行が約 2 秒）は、3,000ms 以内に空にできず送れないことがある
- 先頭が `!` のプロンプトは送れない（先頭に空白を入れれば送れる。先頭が空白の本文がシェルのモードに入らないことは `claude` 2.1.288 で確かめた〈確認の結果 23〉）。先頭が `/` のプロンプトはスラッシュコマンドとして解釈されうる
- 送信の手順（最大で約 4 秒）の間、利用者のターミナルへのキー入力は遅れて届く
- 選択肢の許可の確認の画面では何も送らないこと、ツールの実行中・応答の表示中の消去が作業を中断しないことは `claude` 2.1.288 で確認した。文字列を入力できる確認画面（許可の確認で Tab の amend を開いた状態など）では、消去・貼り付け・Enter が送られうる（未確認）。vim のモードの NORMAL での消去、
  画像の添付（`[Image #N]`）の消去は未確認
- セッションが無いときは `実行` を押せない（先に `起動` して、確認画面に応答してから押す）
- セッションは 1 ウィンドウに 1 つ。renderer のリロードでセッションは止まる（つなぎ直さない）
- 同じフォルダを開き直したときは、終了の確認が出てもセッションは止まらない（main は同じフォルダへの切り替えを変更として扱わない）
- リロードの直後に `起動` を押すと、まれに起動が取り消されて何も表示されないことがある（もう一度押せば起動できる）
- `claude` を SIGKILL まで使って止めた場合、停止の直前に控えた子孫は止めるが、その後に生まれた子と、`claude` の子孫の木から外れた（二重 fork で launchd の子になった）プロセスは残りうる
- 停止の直前に控えた子孫のうち、終了の後も生き残ったものへ SIGKILL を送るため、控えてから送るまで（最大で猶予の 3 秒）に pid が再利用されると、無関係なプロセスに届きうる
- アプリの終了でエージェントの停止を待つ間（最大で約 6 秒）にもう一度終了の操作をすると、停止を待たずに終了する（`claude` と子は pty の終了で届く SIGHUP で止まる想定。実機で未確認）
- `起動の直後に終了しました。ターミナルの表示を確かめてください` の案内は、シグナルでの終了（終了コードが無い）や、既に起動していたセッションに合わせた直後の終了でも出ることがある
- 開いているフォルダが削除され、表示中のパスの表記が許可のパスと違う（シンボリックリンク経由など）と、`起動` で `開いているフォルダが見つかりません` ではなく `開いているフォルダが切り替わりました。もう一度「起動」を押してください` が出る
- 従来の方式の非対話 CLI（`cliService`）は、開いているフォルダを作業ディレクトリにしない（既存の挙動。この MVP では変えない）
- 従来の方式への切り替えで、エージェントの停止に失敗しても切り替えは進み、ターミナルパネルが隠れるためエラーも見えない（停止の失敗は通常の操作では起きない）
- エージェントの起動中は実行方式を切り替えられないが、設定パネルにその理由は表示されない。実行方式の選択肢は矢印キーで移れない（Tab で移る）
- ボタンを押すと押せなくなる・帯ごと消える操作（プロンプトの `実行`〈送信中〉、`起動`〈起動中〉、実行方式の選択肢〈切り替え中〉、外部変更の通知の帯の `このまま編集する`・`ディスクの内容を読み込む`）では、押したボタンのフォーカスが失われて body に落ち、ボタンが押せるように戻っても復帰しない（disabled になったボタンはフォーカスを失う。従来の方式の `実行` と同じ既存の挙動で、MVP では対応しない）
- 設定ファイル（`settings.json`）が壊れていて実行方式を読めないときは、何も表示せずに既定のエージェント CLI 方式になる
- 監視は開いているタブの親ディレクトリだけで、エクスプローラーのツリーとソース管理は自動で更新しない。エージェントが作ったファイルはツリーに出ない（フォルダを開き直す）
- シンボリックリンクで開いたタブは、リンク先の変更を監視で拾わず、ウィンドウのフォーカスの復帰（再表示）の再確認まで反映しない（保存の直前の照合は働く）
- 同じディレクトリへの書き込みが 300ms より短い間隔で続く間は、未編集のタブの再読込と編集中のタブへの通知が遅れる（間引きに最大の待ち時間が無い）
- フォルダを素早く切り替えて元のフォルダに戻す（A → B → A）と、開いているタブの監視が送り直されず、外部変更の反映がフォーカスの復帰まで遅れることがある（保存の直前の照合は働く）
- diff タブは、ファイルの git status の文字が変わらない限り、エージェントの変更で取り直さない（既存の挙動）
- 保存の照合と書き込みの間に、外部の書き込みが割り込むと検知できない
- リンク先の無いシンボリックリンクのタブを保存すると、保存のたびに `このファイルは、ディスク上で削除されています。保存すると、もう一度作成されます。保存しますか？` の確認が出て、OK でも `保存できませんでした。…` のエラーになる（書き込まない安全側。確認は 1 回の保存で 1 度だけ）
- ターミナルを最大化している間は、外部変更の通知（エディタの上の帯）が隠れる（通知の文言は最大化の間も読み上げられる。帯のボタンは `元に戻す` の後に押せる）
- 最大化の間にファイルを開いても、エディタは隠れたまま（`元に戻す` で表示される）
- ウィンドウが低いと、ターミナルパネル（エディタの領域の 45%・最小 160px）がタブとエディタの側を押し縮める（高さのドラッグでの変更は MVP 後）
- パッケージ版では `Ctrl+R`・`Ctrl/Cmd+-`・`Ctrl/Cmd+Shift+=` がターミナルに届かない（`optimizer.watchWindowShortcuts`）
- Windows・Linux ではターミナルの中からクイックオープン（`Ctrl+P`）を開けない
- Windows・Linux では、ラテン文字でないキー配列（キリル文字など）のとき、ターミナルの `Ctrl+Shift+C`・`Ctrl+Shift+V` が効かないことがある（`event.key` で判定するため。実機で未確認）
- Windows（ConPTY・`claude` の起動〈`claude.cmd` などを node-pty で直接起動できるか〉・子孫の停止・メニューのショートカットの抑止）、Linux（node-pty のソースのビルド・AppImage・snap）、署名・公証した macOS のパッケージは実機で未確認
- 署名の ID が無いマシンでは、`npm run build:unpack` の成果物（ad-hoc 署名と hardened runtime）が起動しない。`npm run build && npx electron-builder --dir -c.mac.identity=null` で作る（署名の設定は MVP では変えない）
- クロスビルドで作った成果物は、`build/Release` の取り違えで pty を読み込めないことがある（各 OS の上でビルドする）
- ログインシェルが fish・csh 系のときの PATH の取得は未確認（取得できなければ既定の探索先だけを探し、`claude` が見つからないときの理由にその旨を添える）
- 環境変数から取り除く親の Claude Code のセッションの変数は、この環境で観察した名前に限る。版が変わって増えた変数は引き継がれうる
- URL の文字列の自動のリンク化をしない（OSC 8 のリンクだけをクリックで開ける）。OSC 8 のリンク（`http:`・`https:` だけ）は、行き先の表示・確認なしに既定のブラウザで開く
- エージェントの状態（作業中・許可待ち）はアプリから分からない。ターミナルの画面で確かめる
- ターミナルのタッチ操作（範囲の選択・スクロール・ソフトウェアキーボード）は xterm の既定の挙動のまま

## 実装の最初に確かめること

設計時点では未確認で、最初のタスク（スパイク）で実機で確かめる。食い違えば設計を直し、「確認の結果」に追記する。

1. このリポジトリで node-pty を足し、`npm install`（postinstall）・`npm ci` の後に `build/Release/spawn-helper` が実行権限付きで作られ、`npm run dev` と
   `npm run build:unpack` の成果物（Finder から起動）の両方で pty を起動できること。→ postinstall・`npm ci`・Electron の node・署名しないパッケージ版の pty は
   確認の結果 27・28 で確認した（ad-hoc 署名の成果物は起動しない）。`npm run dev` とパッケージ版の Finder からの起動は利用者の実機で確かめる（AGT-001）
2. vitest（main の `environment: node`）から実物の node-pty を読み込めること、`@xterm/xterm` を読み込む renderer のモジュールが jsdom のテストの import で
   壊れないこと（壊れるなら controller の境界でモックする）。→ main のテストも jsdom で走り、そのまま実物の node-pty が動くことを確認の結果 26 で確認した。
   xterm は jsdom で import・生成できるが `open()` は失敗するため、`xtermFactory` と controller の境界で偽物を使った
3. 偽の Messages API（ローカルの HTTP サーバーで `tool_use` を返す・応答を流し続ける。Anthropic の API には接続しない）で、許可の確認の画面が
   「プロンプトの送信」の 5 の並び（罫線・`❯` の行・罫線）に当てはまらず、何も送られないこと。ツールの実行中・応答の表示中に `Ctrl+K`・`Ctrl+U` を送っても
   作業が中断されず、入力欄が空になること（確認の結果 25 の未確認の分）。→ 確認の結果 30 で確認した
4. React の `StrictMode` の下で、controller が xterm を 1 つだけ作り、パネルの開閉・最大化の後に `fit` と `resize` が正しい桁数を送ること。→ controller と
   表示の部品の単体テスト（偽の xterm）で固定した。実物の描き直しは利用者の実機で確かめる（AGT-037）
5. 未編集のタブの再読込（`content` の差し替え）の後の Monaco のカーソル・スクロールの位置と、undo で再読込の前に戻ること。→ jsdom の Monaco のモックでは
   確かめられず、利用者の実機で確かめる（AGT-027。未確認）
6. Electron の renderer で `navigator.clipboard` の読み書きが（既定の権限で）使えること。使えなければ preload の `clipboard` に切り替える。→ 確認の結果 31 で確認した
7. Windows・Linux の既定のメニューのショートカット（`Ctrl+W` など）が、ターミナルの `keydown` より先に効くか、`setIgnoreMenuShortcuts` で止まること
   （この環境は macOS のため、確かめられなければ未確認のまま既知の制約に残す）。→ macOS では確かめられず、未確認のまま既知の制約に残した
8. `claude` の `/exit` と `Ctrl+D` での終了、ログイン済みの `claude` の起動直後の画面（利用者の設定を書き換えない範囲で、利用者が実機で確かめる）。→ 利用者の
   実機で確かめる（AGT-005・AGT-007。未確認）
9. ログイン済みの通常の環境で、空の入力欄に出る案内の文字（例文など）が dim で描かれ、`isInputBoxEmpty` が空と判定すること。テーマ（ライト・ANSI の色など）を
   変えても同じこと。dim でなければ、案内の文字を判定に加えるか、カーソルの位置だけで判定するかを決め直す（利用者が実機で確かめる）。→ 利用者の実機で
   確かめる（AGT-007・AGT-041。未確認）。dim でなければ空と判定されず、消去を繰り返して 3,000ms で `エージェントの入力欄を空にできませんでした…` を出し、
   貼り付けも Enter も送らない（送らない側に倒れる）
10. vim のモードの NORMAL と、画像を添付した入力欄（`[Image #N]`）で、「プロンプトの送信」の 7 の消去が効くこと。効かなければ既知の制約に残す。→ Task 1 の
    任意の手順で、時間の都合で行わなかった（未確認。既知の制約に残した）

## 実装の分割案

タスクごとに新しいサブエージェントで実装し、タスクごとにレビューする（CLAUDE.md）。順序は依存の向きに合わせる。

1. **スパイク: node-pty の導入**（依存の追加・`asarUnpack`・postinstall の確認・`build:unpack` での起動、「実装の最初に確かめること」1〜3・6・10 の実験と記録）
2. **main: 起動の準備**（`cliSearchPaths`・`agentShellEnv`・`agentCommand`・環境変数）とテスト
3. **main: セッションと停止**（`agentProcessTree`・`agentSession`・`agentSessionRegistry`）と、実物の pty の結合テスト
4. **main: 寿命と IPC**（`agentSessionLifecycle`・`FolderAccessManager.onDidChange`・handlers・payload の検証・preload の API・`window.electron` の撤去）
5. **renderer: ターミナルパネル**（`agentTerminalController`・`AgentTerminalPanel`・`useAgentSession`・配置・開閉・最大化・fit・リンク）
6. **renderer: キーとフォーカス**（`agentTerminalKeys`・`useQuickOpen` の除外・コピー/貼り付け・`F6`・`setIgnoreMenuShortcuts`）
7. **送信**（`shared/agentPasteText`〈先頭の `!` の拒否・消去のバイト列〉・`agentInputBox`〈入力欄の特定・空の判定・現れたかの判定。確認の結果 14〜23 の画面を
   テストの入力に使う〉・controller の `readViewport` と送信中のキー入力の保留・`useAgentPromptSender`〈消去 → 空の確認 → 貼り付け → 確認 → Enter〉・
   `usePromptRunner` の分岐・無効の理由。分量が多ければ `agentInputBox` と手順の 2 つに分ける）
8. **実行方式の設定**（`executionModeStore`・IPC・`ExecutionModeSection`・ツールの選択と出力パネルと履歴の再実行の出し分け・切り替え時の終了の確認）
9. **外部変更: 保存の照合**（`checkedFileWrite`〈実装時は `fileChangeGuard` として作り、SRP の再レビューで統合した〉・`fs:writeFileChecked`・`useFileEditing` の確認）
10. **外部変更: 監視と再読込**（`openFileWatcher`・`useExternalFileChanges`・`ExternalChangeBanner`・フォーカスの再確認）
11. **遷移とリンクの制限**（`will-navigate`・`setWindowOpenHandler` の許可リスト・`openExternalLink`）
12. **ROADMAP の更新と全体の検証**（ROADMAP の MVP の項目を実装済みへ移し既知の制約を足す、`docs/manual-test-spec.md` への `AGT` の追記と既存の PRM・RUN・OUT・APL の前提の更新、
    `node scripts/build-manual-test-spec.mjs` と Artifact の再公開、`npm test`・`npm run typecheck`・`npx eslint`）

## MVP 後の候補

- 複数セッション・タブ、シェルの起動（ROADMAP の「統合ターミナルの拡張」）、`claude` 以外の CLI（起動コマンドの設定）
- エージェントの状態の把握（Claude Code の hooks を `--settings` で足し、送信・停止・通知を受け取る）と、ステータスバーへの表示、送信のキュー
- 送信の Enter を自動で押さない設定、開いているファイルのパスを参照として添える（`@相対パス`）、送信の履歴
- フォルダ全体の監視と、ツリー・ソース管理の自動更新（diff タブの取り直しを含む）
- `watchWindowShortcuts` の置き換え（ターミナルへの `Ctrl+R` など）、`sandbox: true` 化、URL の自動のリンク化、高さのドラッグでの変更と保存
- 流量の制御（大量の出力での pty の `pause`/`resume`）、他の OS の prebuilds の除外、CI

## 決定した点（2026-10-04。設計書の初版で「ユーザーに確認したい点」として挙げた 5 点）

1. **セッションが無いときの `実行`**: 押せなくして理由（`エージェントが起動していません（ターミナルの「起動」を押してください）`）を表示する（推奨どおり）。
   「プロンプトの送信」の「セッションが無いときのボタン」
2. **書きかけの入力**: 連結を既知の制約として受け入れる案は採らず、**入力欄を完全に上書きする**（書きかけを消してから本文を入れる）。
   追加の実験（確認の結果 14〜25）で、作業を中断せずに入力欄を空にできる方法（`Ctrl+K` × 12 + `Ctrl+U` × 12 を 24 バイトずつ 30ms 空けて送り、画面で空を確かめる）を
   確定した。一度で確実に空にするキーは無いため、画面で確かめながら繰り返し、確かめられなければ貼り付けも Enter も送らずに理由を出す。
   `Ctrl+C`・`Esc` は作業中の中断になるため使わない。「プロンプトの送信」の 5〜13
3. **送信の Enter のガード**: 貼り付けた本文が入力欄に現れたことを画面で確かめてから Enter を送り、確かめられないときは送らない（推奨どおり）。
   上書きに合わせて、確かめ方を「入力欄の先頭が本文で始まり、記号が `❯` であること」に強めた
4. **ツリーとソース管理の自動更新**: MVP では開いているタブだけを監視し、ツリーへの反映は MVP 後にする（推奨どおり）
5. **履歴の `再実行`**: エージェント CLI 方式では押せなくして理由を表示する（推奨どおり）。C11

## ドキュメント

- ROADMAP: MVP の項目を実装済みへ移し、見送り（MVP 後の候補）と既知の制約（この設計書と 1 対 1）を書く
- `docs/manual-test-spec.md`: 新しい接頭辞 `AGT` の追記、既存の PRM・RUN・OUT・APL の前提に「従来の方式」を足す。Artifact の再公開（CLAUDE.md の共通ルール）

実装: `docs/superpowers/plans/2026-10-04-agent-terminal-mvp.md`（2026-10-04）

## その後の変更（2026-10-11、セッションの再開と履歴への記録の機能で変更）

本文は当時の決定の記録として残す。次の 2 点は変わった。現行の挙動は `2026-10-11-agent-session-resume-design.md` を参照。

- C11・決定した点 5（エージェント CLI 方式では送信を履歴に記録せず、履歴の `再実行` は押せない）: 送れたら `送信済み` として履歴に記録するようになり、エージェントのエントリの `再実行` は送れるようになった。従来のエントリ（エージェントの情報が無いもの）は、エージェント CLI 方式では従来どおり押せない。
- 「`claude` の引数は空で固定」: 起動のたびに `--session-id <UUID>`、再開は `--resume <UUID>` を付けるようになった。それ以外の引数（`--dangerously-skip-permissions` など）は付けない方針は変わらない。

## その後の変更（2026-10-13、エージェントの変更の利用者の編集との区別〈段階 A〉で変更）

本文は当時の決定の記録として残す。次の点が変わった。現行の挙動は `2026-10-13-agent-changes-user-edit-distinction-design.md` を参照。

- 「`claude` の引数は空で固定」（2026-10-11 の変更の後は「セッションの指定だけ」）: `claude` の版が 2.1.101 以上と確かめられたときは、`--settings <一時ディレクトリの設定のファイルの絶対パス>` も付けて、アプリの `http` の hooks を渡すようになった。それ以外の引数（`--dangerously-skip-permissions` など）は付けない方針は変わらない
- 環境変数: `NO_PROXY`・`no_proxy` に `127.0.0.1`・`localhost` を足すようになった（hooks の要求とトークンをプロキシへ送らないため）
