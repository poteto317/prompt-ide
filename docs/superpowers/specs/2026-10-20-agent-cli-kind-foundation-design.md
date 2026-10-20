# claude 以外のエージェント CLI への対応 段階 1（土台と起動）設計書

- 日付: 2026-10-20
- ROADMAP の項目: 「エージェント実行の支援（MVP の次）」の「`claude` 以外のエージェント CLI への対応（起動コマンドの設定。入力欄の挙動が CLI ごとに違う点の吸収）」（`ROADMAP.md:559`）
- 前提の設計書: `2026-10-04-agent-terminal-mvp-design.md`（起動のコマンド・作業ディレクトリ・環境変数は main が決める〈「セキュリティ」〉、PATH の継承〈「PATH の継承と起動のエラー」〉、`claude` だけを対象にした〈「設計の前提」〉）、
  `2026-10-11` のセッションの再開と履歴への記録（起動の記録 `agent-sessions.json`・`claudeSessionId`）、`2026-10-13-agent-changes-user-edit-distinction-design.md`（hooks による区別と、使えないときの経路）、`2026-10-19-agent-interrupt-ui-design.md`（帯の `中断`）
- 実装は 1 つの実装プラン・1 つの PR にする（「実装の分割」）

## 目的

エージェント CLI 方式は、起動するコマンドを `claude` に固定している（`src/main/agentCommand.ts:19` の `AGENT_COMMAND_NAME`）。送信（入力欄の判定・貼り付け）・画面の活動の判定・中断・hooks・前回の続きからも、
すべて `claude` の画面と引数を前提に作られている。ほかのエージェント CLI を使えるようにするには、(1) どの CLI を使うかの設定と、CLI ごとに使える機能の表（土台）、
(2) 選んだ CLI の起動、(3) 入力欄・画面の違いの吸収（送信・判定）、(4) hooks・再開の対応、の順に進める必要がある。

この段階 1 では (1)・(2) だけを作る。設定で GitHub Copilot CLI（`copilot`）を選ぶと、ターミナルのタブで `copilot` が起動し、利用者はターミナルで直接操作できる。
`claude` 用に作った機能のうち `copilot` でまだ使えないもの（実行ボタンでの送信・画面の判定とそれに基づく表示・通知・中断・自動の取り直し・hooks による区別・前回の続きから）は、
能力の表で「使えない」とし、入口ごとに使えない理由を出す。`claude` を選んでいる間（既定）の挙動は今までと同じにする。

## 決めたこと（利用者の確認済み）

2026-10-20 に利用者が決めた。

| 項目               | 決定                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最初に対応する CLI | GitHub Copilot CLI（`copilot`）。このマシンでは `$HOME/.nvm/versions/node/<version>/bin/copilot`（nvm の下の node スクリプト。GUI の PATH では見つからない可能性がある。`.superpowers/agent-terminal-mvp/collision-report.md:125-126`）                                                                                                                                                       |
| 起動するコマンド   | 既知の CLI から選ぶだけ。コマンドの名前・引数・取り除く環境変数は main が持つ許可リスト（CLI の種類ごとの表）で決め、renderer から任意のコマンドを起動させない（MVP の方針。L-019・L-034）                                                                                                                                                                                                         |
| 今回の範囲         | 土台と起動まで: CLI の種類の型と能力の表（shared）、設定（`settings.json` に保存。既定は `claude`）と設定の画面、main の起動の差し替え。`claude` は今までどおり動く。`copilot` はタブで起動して手で操作できるが、実行ボタンでの送信・画面の判定（作業中などの表示・通知・中断・自動の取り直し）・hooks（エージェントの変更の区別）・前回の続きからは能力の表で「使えない」とし、使えない理由を出す |
| 選ぶ単位           | アプリ全体で 1 つ（タブごとには選ばない）                                                                                                                                                                                                                                                                                                                                                          |

## 決めたこと（推奨案で決めた事項）

利用者の判断が要るほどの選択は無かったため、この設計書で推奨案に決めた。

| 項目                                  | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 型の名前と置き場                      | `AgentCliKind = 'claude' \| 'copilot'` と能力の表 `AGENT_CLI_PROFILES: Record<AgentCliKind, AgentCliProfile>` を `src/shared/agentCliKinds.ts`（新規）に置く。main（起動・hooks・再開の拒否）と renderer（入口の判定・文言）が同じ表を読む。従来の方式の `PromptToolId`（`src/shared/types/cli.ts`。`copilot` は `gh copilot -p`）とは別の型にする（従来の方式は非対話の 1 回の実行で、能力の意味が違うため）                       |
| 能力の項目                            | `promptSend`（実行ボタン・履歴の再実行・送信前の確認からの送信）・`screenActivity`（画面からの活動の判定と、それに基づく帯・タブ・ステータスバーの表示・通知・自動の取り直し・hooks への作業中の知らせ）・`interrupt`（帯の `中断`）・`changeAttribution`（hooks によるエージェントの変更の区別）・`sessionResume`（前回の続きから・このセッションで再開・起動の記録）の 5 つ。`claude` はすべて `true`、`copilot` はすべて `false` |
| 未知の値の扱い                        | `settings.json` の `agentCliKind` が無いときは既定の `claude`。値が壊れている（知らない文字列・文字列以外）・ファイルを読めないときも `claude` に戻すが、黙って流さない（L-044）: main のログに記録し、設定の画面に「保存されていた値を読めなかったため claude を使っています」を出す。保存（renderer からの IPC）では知らない値を投げて拒否し、`claude` に倒さない                                                                 |
| 起動に使う種類の決め方                | main が起動のたびに `settings.json` を読んで決める（renderer は起動の依頼に種類を含めない。L-019）。読んだ値を起動の計画（`AgentLaunchPlan.cliKind`）に入れ、その後の手順（コマンドの探索・引数・環境変数・hooks・再開の可否・記録）はすべてその値を使い、別の場所で読み直さない（L-018）。起動の結果に `cliKind` を載せ、renderer のタブはその値で能力を引く                                                                       |
| 切り替えの時機                        | 実行方式の切り替え（`useAgentWorkspace.selectExecutionMode`）に倣う。起動中・実行中のタブがあれば確認のダイアログ（`使う CLI を切り替えると、動いているエージェントをすべて終了します。切り替えますか？`）を出し、OK ならすべてのタブを止めてから保存する。止められなかったタブがあれば保存しない。切り替えの途中は起動・`+`・前回の続きからを押せない。保存した値は次の起動から使われる（main が起動のたびに読むため。L-466）      |
| 画面の判定の止め方                    | `copilot` のタブは判定そのものを止める（`useAgentActivity` が購読しない・活動を記録しない）。常に `unknown` を返す判定に差し替えるのではなく、購読を張らない。記録の無いタブは各機能が `unknown` として扱う既存の規則（`useAgentInterrupt` の「未記録のタブは `unknown`」など）に乗り、作業中・許可待ちに基づく通知・自動の取り直し・hooks への作業中の知らせは起きない                                                             |
| 使えない理由の出し方                  | 入口ごとに、既存の押せない理由の経路（実行ボタンの理由・中断の `aria-describedby` と `title`・前回の続きからの理由・履歴の再開の理由・区別の状態の 1 行）に理由を足す。見た目だけ無効にせず、処理の側でも同じ判定で止める（L-058）。設定の画面には、選んだ CLI で使えない機能の一覧を出す（「設定」の「画面」）                                                                                                                     |
| 文言のうち今回直すもの                | タブの名前（`claude 1` → CLI のコマンド名から `copilot 1`）、`起動`・`中断` の `aria-label`、「コマンドが見つかりません」の文言（CLI ごと）、設定の画面の実行方式の選択肢（`Claude Code を動かす` → `エージェント CLI を動かす`）。中断の理由・前回の続きから・変更の区別などの `claude` と書く文言は、`copilot` では使えない機能のものなので次の段階に回す（「文言」）                                                             |
| 起動の記録・履歴に CLI の種類を足すか | 今回は足さない。`copilot` のセッションは起動の記録（`agent-sessions.json`）に書かず、前回の続きからにも出さない。`copilot` では送信が使えないため、履歴（`HistoryEntry.agent`）に `copilot` のエントリは作られない。種類を足すのは再開・送信に対応する次の段階で、そのとき古い記録・エントリ（種類の無いもの）は `claude` として読み、ほかの欄は書き換えない（L-456・L-459。「記録と履歴」）                                        |
| 取り除く環境変数                      | 今の一覧（`REMOVED_AGENT_ENV_KEYS`・`REMOVED_AGENT_ENV_PREFIXES`）はすべての CLI で取り除く。`copilot` だけ `COPILOT_ALLOW_ALL` を足して取り除く（アプリが起動した CLI の許可を自動で全部にしない。`claude` に `--dangerously-skip-permissions` を付けないのと同じ方針。「copilot の調べた事実」4）                                                                                                                                 |
| `copilot` の引数                      | 空（`copilot` を引数なしで起動すると対話のセッションになる）。作業ディレクトリは pty の `cwd`（許可のフォルダ）で決め、`-C` は使わない。`--session-id`・`--resume`・`--allow-*`・`--yolo` などは付けない                                                                                                                                                                                                                            |
| `copilot` の版の確認                  | しない。版で変わる能力がまだ無いため（hooks を使わない）。版の表示形式は調べた事実として残し、次の段階で使う                                                                                                                                                                                                                                                                                                                        |
| 中断の IPC の main での拒否           | しない。`agentTerminal:interrupt` が書く `\x1b` は、ターミナルのキー入力（`agentTerminal:write`）でも同じバイトを送れるため、権限の境界ではない。renderer の判定（押せない理由と、押した処理の先頭の判定）で止める                                                                                                                                                                                                                  |

## 範囲

含めるもの:

- shared: CLI の種類の型・能力の表・表示名とコマンド名（`src/shared/agentCliKinds.ts`）、起動の結果・状態の取得の型への `cliKind` の追加、起動の失敗の種類 `resume-unsupported`
- main: 設定の読み書き（`agentCliKindStore.ts`）と IPC（`settings:getAgentCliKind`・`settings:setAgentCliKind`）、起動の種類ごとの表（コマンド名・引数・取り除く環境変数）、
  起動の差し替え（探索・引数・環境変数・hooks の準備の省略・再開の拒否・起動の記録の省略）
- renderer: 設定の hook と設定の画面の項目、切り替えの確認と停止、タブの種類と名前、入口ごとの使えない理由、画面の判定を止める、文言
- テスト（単体・偽の実行ファイルを使う main の統合テスト・配線）、実機テスト仕様書・ROADMAP の更新

含めないもの（次の段階に回す事項）:

- `copilot` へのプロンプトの送信（入力欄の判定・消去・貼り付け・`!` の扱い）と、`copilot` の画面の活動の判定（作業中・入力待ち・許可待ち）。段階 2
- それに基づく `copilot` の帯・タブ・ステータスバーの活動の表示、完了・許可待ちの通知、中断、変更の一覧の自動の取り直し。段階 2
- `copilot` の hooks によるエージェントの変更の区別、`copilot` のセッションの再開（前回の続きから・このセッションで再開）、起動の記録・履歴への CLI の種類の記録。段階 3
- `copilot` の版の確認
- `claude`・`copilot` 以外の CLI（codex・gemini など）
- 任意のコマンドの登録（起動コマンドを利用者が書く設定）。既知の CLI から選ぶだけにする（「決めたこと」）
- タブごとの CLI の選択
- 従来の方式（API・非対話の CLI）の `copilot`（`gh copilot -p`）の変更

## copilot の調べた事実

2026-10-20 にこのマシンで確かめた。利用者の設定を書き換えないよう、`HOME`・`XDG_CONFIG_HOME`・`XDG_STATE_HOME`・`XDG_CACHE_HOME`・`COPILOT_HOME` を作業用の一時ディレクトリにし、
`PATH` を `$HOME/.nvm/versions/node/<version>/bin:/usr/bin:/bin` にして、`copilot --version`・`copilot --help`・`copilot help environment`・`copilot help config`・`copilot help commands` だけを実行した
（標準入力は `/dev/null`、30 秒で打ち切り）。対話のセッションは起動していない（GitHub のサービスにログイン・接続していない）。

1. **実体**: `bin/copilot` は `../lib/node_modules/@github/copilot/npm-loader.js` へのシンボリックリンク（パッケージ `@github/copilot` 1.0.43）。先頭は `#!/usr/bin/env node`（実行権あり）。
   `npm-loader.js` は、まず同じ場所の `@github/copilot-darwin-arm64`（ネイティブの実行ファイル）を `spawnSync`（`stdio: 'inherit'`）で起動し、その終了コードで終わる。
   ネイティブが無ければ Node.js の版が 24 未満なら `GitHub Copilot CLI requires Node.js v24 or higher` で終わり、24 以上なら `index.js` を読み込む。
   つまり起動には `node` が要り（shebang の `env node`）、起動の後は node のローダーとネイティブの子の 2 段のプロセスになる
2. **版の表示**: `copilot --version` は `GitHub Copilot CLI 1.0.87.`（末尾にピリオド）と、次の行に `Run 'copilot update' to check for updates.` を出して終了コード 0。
   パッケージの版（1.0.43）と表示の版（1.0.87）が違い、`--version` の実行で `$HOME/Library/Caches/copilot/pkg/darwin-arm64/1.0.87/`（約 136MB）が作られた（一時の `HOME` の下。利用者の `~/Library/Caches/copilot/pkg/darwin-arm64/` には 1.0.55〜1.0.87 がある）。
   `parseClaudeVersion`（行頭の `x.y.z`）では読めない形
3. **起動の引数**（`copilot --help`）: 引数なしで対話のセッション。`-i <prompt>`（対話を始めて最初の指示を実行）・`-p <text>`（非対話）・`-C <directory>`（作業ディレクトリ）・
   `-r, --resume [<value>]`（ID・名前・ID の前方一致で再開。値なしは選択の画面）・`--continue`（最後のセッション）・`--session-id <id>`（既存のセッションの再開、または新しいセッションの UUID の指定）・
   `--allow-all-tools`・`--allow-all`・`--yolo`（許可の自動化）・`--no-auto-update`・`--screen-reader`・`--log-dir` など。`claude` の `--settings <file>` に当たる「1 回の起動の設定ファイル」の引数は無い
   （近いのは `--additional-mcp-config` と `--plugin-dir`。hooks は設定 `hooks`〈`.github/hooks/*.json` と同じ形〉とリポジトリの `settings.json` に書く）
4. **環境変数**（`copilot help environment`）: `COPILOT_ALLOW_ALL`（真の値で全ツールを確認なしに実行。ちょうど `true` なら作業ディレクトリを確認なしに信頼し、そのディレクトリの hooks〈シェルのコマンドを含む〉まで読み込む）、
   `COPILOT_HOME`（設定と状態の置き場。既定 `$HOME/.copilot`）、`COPILOT_GITHUB_TOKEN`・`GH_TOKEN`・`GITHUB_TOKEN`（認証。保存済みの資格情報より優先）、`COPILOT_AUTO_UPDATE`、`COPILOT_OFFLINE`・`COPILOT_PROVIDER_BASE_URL`（ローカルのモデル提供元。GitHub の認証が要らない）、
   `HTTP_PROXY`・`HTTPS_PROXY`・`NO_PROXY`、`NO_COLOR`、OpenTelemetry の `OTEL_*`。`COPILOT_MULTIPLEXER` の説明で、herdr の中では受け継いだ `TERM_PROGRAM` などを信用しないとある（アプリは `TERM_PROGRAM` を既に取り除いている）
5. **入力の方式**（`copilot help config`・`help commands`）: 複数行の入力は `shift+enter`（`/terminal-setup` で端末を設定）、10 行を超える貼り付けは `[Paste #N - X lines]` に畳む（設定 `compactPaste`。既定 `true`）、
   入力欄の Vim のモード（`/vim`）、`Ctrl+R` の履歴の検索がある。作業中の進み具合を OSC 9;4 で出す（設定 `terminalProgress`。既定 `true`）、端末のタイトルを書き換える（`updateTerminalTitle`。既定 `true`）、
   代替画面（alt screen）でマウスを使う（`mouse`。既定 `true`）。起動時に IDE のワークスペースへ自動で接続しようとする（`ide.autoConnect`。既定 `true`）。フォルダの信頼の一覧（`trustedFolders`）がある
6. **見つかるか**: ログインシェルの PATH（`agentShellEnv.ts` の `readLoginShellPath`。`$SHELL -l -i -c`）で見つかる。最小の環境（`env -i HOME=… SHELL=/bin/zsh`）から `zsh -l -i -c` を実行すると、
   `~/.zshrc` が `nvm.sh` を読み込んで（既定の別名は `24`）PATH の先頭近くに `~/.nvm/versions/node/v24.14.1/bin` が入り、`copilot` と `node` の両方が見つかった。
   `resolveAgentLaunch` はこの PATH の後ろに既定の探索先（`cliSearchPaths.ts`。nvm の下を含まない）を足して `copilot` を探し、見つけた絶対パスを起動する。
   `isExecutableRegularFile` は `stat`（リンクの先を見る）と `X_OK` で確かめるので、シンボリックリンクの `bin/copilot` は実行できる通常のファイルとして見つかる。
   pty に渡す PATH も同じ値（`buildAgentEnv` の `pathValue`）なので、shebang の `env node` も同じ nvm の `node` を見つける。
   ログインシェルから PATH を取れない（5 秒の打ち切り・`.zshrc` の失敗）と、既定の探索先だけを探して見つからず、今の `command-not-found`（`shellPathUnavailable: true`）になる

確かめられなかったこと（段階 0 の調査で確かめる。「次の段階の見通し」）:

- 対話のセッションの画面（起動直後・入力待ち・作業中・許可の確認・選択の画面）、bracketed paste の有効化の有無、入力欄の罫線や記号、`Esc`・`Ctrl+C` の効き方、作業中の入力のキュー
- 初回の起動で出る画面（フォルダの信頼の確認・ログインの案内）の内容と、それが出る条件
- `--session-id` で振った UUID と `--resume` での再開が、アプリの起動の記録の照合と組み合わせられるか
- hooks の設定の形と、1 回の起動だけに hooks を効かせる方法（`claude` の `--settings` に当たるもの）
- `copilot` が子のプロセスを別のセッションで動かすか（今の `stopTree` は子孫を控えてから止めるので、2 段のプロセスは止まる見込み。実機の項目 AGT-238 で確かめる）
- 調べる方法の候補: `COPILOT_OFFLINE=true` と `COPILOT_PROVIDER_BASE_URL`（偽のローカルの提供元）と一時の `COPILOT_HOME` で、GitHub のサービスに接続せずに画面を記録する（`claude` の `exp3.js` と同じ考え）

## 型と能力の表

`src/shared/agentCliKinds.ts`（新規。`src/shared/types.ts` の再 export には、IPC の型〈設定の読み書き・起動の結果〉に出る `AgentCliKind` の型だけを足す。能力の表の型は表を読む側が `@shared/agentCliKinds` から直接 import する）:

```ts
/** エージェント CLI 方式で起動する CLI の種類。main の起動の表と renderer の入口の判定が同じ値を使う */
export const AGENT_CLI_KINDS = ['claude', 'copilot'] as const
export type AgentCliKind = (typeof AGENT_CLI_KINDS)[number]
export const DEFAULT_AGENT_CLI_KIND: AgentCliKind = 'claude'

export function isAgentCliKind(value: unknown): value is AgentCliKind {
  return typeof value === 'string' && (AGENT_CLI_KINDS as readonly string[]).includes(value)
}

/** CLI ごとに、アプリの機能が使えるか(claude の画面・引数・hooks に依存する機能) */
export interface AgentCliCapabilities {
  /** 実行ボタン・履歴の再実行・送信前の確認からの送信(入力欄の判定・消去・貼り付け) */
  promptSend: boolean
  /** 画面からの活動の判定と、それに基づく表示・完了と許可待ちの通知・変更の一覧の自動の取り直し・hooks への作業中の知らせ */
  screenActivity: boolean
  /** 帯の中断(Esc を 1 回)。押せる条件が screenActivity の working なので、true なら screenActivity も true */
  interrupt: boolean
  /** hooks によるエージェントの変更と利用者の変更の区別 */
  changeAttribution: boolean
  /** 前回の続きから・このセッションで再開・起動の記録(agent-sessions.json)・会話の ID の予約 */
  sessionResume: boolean
}

export interface AgentCliProfile {
  /** 設定の画面の名前(Claude Code / GitHub Copilot CLI) */
  displayName: string
  /** 起動するコマンドの名前(main の探索に使う)。タブの名前・文言にも使う */
  commandName: string
  capabilities: AgentCliCapabilities
}

export const AGENT_CLI_PROFILES: Record<AgentCliKind, AgentCliProfile> = {
  claude: {
    displayName: 'Claude Code',
    commandName: 'claude',
    capabilities: {
      promptSend: true,
      screenActivity: true,
      interrupt: true,
      changeAttribution: true,
      sessionResume: true
    }
  },
  copilot: {
    displayName: 'GitHub Copilot CLI',
    commandName: 'copilot',
    capabilities: {
      promptSend: false,
      screenActivity: false,
      interrupt: false,
      changeAttribution: false,
      sessionResume: false
    }
  }
}

/** 既定の CLI(claude)のコマンド名。renderer の文言の「claude を使っています」「claude に戻すと使えます」に使う */
export const DEFAULT_AGENT_CLI_COMMAND_NAME = AGENT_CLI_PROFILES[DEFAULT_AGENT_CLI_KIND].commandName

export function agentCliCapabilities(kind: AgentCliKind): AgentCliCapabilities {
  return AGENT_CLI_PROFILES[kind].capabilities
}
```

- `Record<AgentCliKind, …>` で持ち、種類を足したときに表の決め忘れを型エラーにする。能力の参照は `if (capabilities.x)` の肯定の形で書き、`kind !== 'claude'` のような否定の名指しにしない（種類を足したときに許可側へ倒れない）
- `commandName` は main の探索に使うが、renderer から main へは送らない（main は自分で読んだ種類で同じ表を引く）
- 種類ごとの文言の表（使えない機能の名前）は renderer の `lib/agentCliMessages.ts` に `Record<keyof AgentCliCapabilities, string>` で持つ（能力を足したときに名前の決め忘れを型エラーにする）

共有の型の変更（`src/shared/types/agentTerminal.ts`）:

```ts
export type AgentTerminalErrorKind =
  | … // 今の種類
  /** 再開の依頼だが、使う CLI が再開に対応していない(main の能力の表) */
  | 'resume-unsupported'

export type AgentStartResult =
  | {
      kind: 'started' | 'already-running'
      sessionId: string
      /** main がこの起動に使った CLI の種類(already-running は動いているセッションの種類) */
      cliKind: AgentCliKind
      /** claude の会話の ID。sessionResume が true の種類では必ず文字列、false の種類では null */
      claudeSessionId: string | null
    }
  | {
      kind: 'error'
      error: 'command-not-found'
      /** 探したコマンドの CLI の種類(文言に使う) */
      cliKind: AgentCliKind
      shellPathUnavailable: boolean
    }
  | {
      kind: 'error'
      error: Exclude<AgentTerminalErrorKind, 'command-not-found'>
      detail?: string
    }

export interface AgentSessionSnapshotEntry {
  slotId: string
  sessionId: string
  cliKind: AgentCliKind
  claudeSessionId: string | null
}
```

- `command-not-found` を別の組にし、`cliKind` と `shellPathUnavailable` を必須にする（省略で `claude` の文言に流れない。L-044・L-060）
- `AgentLaunchRequest`（`new`・`resume`）は変えない。renderer は種類を送らない

## 設定（保存・読み込み・画面・切り替え）

### 保存と読み込み（main）

設定の値と既定に戻した理由の型（`src/shared/types/settings.ts`。IPC の戻り値なので main と renderer が読む）:

```ts
export type AgentCliKindSetting = {
  kind: AgentCliKind
  /** 既定に戻した理由。値が無い(未設定)なら null。値が壊れていた・ファイルを読めなかったなら理由 */
  fallback: null | 'invalid-value' | 'read-failed'
}
```

`src/main/agentCliKindStore.ts`（新規。`executionModeStore.ts` と同じ形）:

```ts
export async function getAgentCliKindSetting(
  log?: (message: string) => void
): Promise<AgentCliKindSetting>
export async function setAgentCliKind(kind: unknown): Promise<void>
```

- `SettingsFile` に `agentCliKind?: string` を足す（`settingsFileStore.ts`。書き込みは今のマージの直列化〈`writeSettingsFile`〉をそのまま使い、ほかのキーを消さない）
- 読み込み: キーが無い（`undefined`）→ `{ kind: 'claude', fallback: null }`。`isAgentCliKind` に当たらない値 → `{ kind: 'claude', fallback: 'invalid-value' }` とし、ログに
  `[agentCliKind] 保存されていた値を読めないため claude を使います: <JSON.stringify(値) の先頭 80 文字>` を出す（値は秘密を含まない設定値。長さは切る。L-017）。
  `readSettingsFile` が投げた（JSON が壊れている・権限）→ `{ kind: 'claude', fallback: 'read-failed' }` とし、ログに固定の文言 `[agentCliKind] 設定ファイルを読めないため claude を使います` を出す。`readSettingsFile` は `JSON.parse` の結果を型の主張だけで返すため、ファイルが `null`・配列・数・文字列などの JSON だと `data.agentCliKind` の参照で `TypeError` になる。`getAgentCliKindSetting` は読んだ値が普通のオブジェクト（`typeof` が `object` で `null` でも配列でもない）でなければ `read-failed` として扱い、プロパティの参照も `try` の中に入れる（`resolveLaunch` に投げさせて起動できなくしない）。例外の文言は出さず固定の文言をログに出す（設定ファイルには API キーの暗号文があるため、JSON の解析の例外の文言に中身が混ざりうる。L-017）。
  `log` の既定は `console.warn`（関数を直接渡す。CLAUDE.md の「デフォルト引数の参照安定性」）
- 保存: `isAgentCliKind` で検証し、知らない値は `throw new Error('使うエージェント CLI が不正です')`（値を文言に入れない）。`claude` に倒して保存しない（L-044）
- IPC（`handlers/settingsHandlers.ts`）: `settings:getAgentCliKind`（`AgentCliKindSetting` を返す）・`settings:setAgentCliKind`（引数は値 1 つ）。preload（`api.ts`・`index.d.ts`）と renderer（`lib/settingsApi.ts`）に窓口 `getAgentCliKind(): Promise<AgentCliKindSetting>`・`setAgentCliKind(kind: AgentCliKind): Promise<void>` を足す

### 起動での読み込み（main）

`resolveLaunch`（`agentRuntime.ts` の `resolveAgentLaunchFromSystem`。`ipcHandlers.ts` が starter に渡す）が、起動のたびに `getAgentCliKindSetting()` を読み、その `kind` を `resolveAgentLaunch` に渡す（「main の起動」）。
renderer の設定の値は使わない。保存した値は、保存の後に始まった起動から使われる（renderer の再読み込みや再起動は要らない。L-466）。

### 画面（renderer）

- hook: `hooks/useAgentCliKind.ts`（新規。`useExecutionMode` と同じ形）。`kind: AgentCliKind | null`（読み込み中は null）・`fallback`・`saveError`・`changeKind(next): Promise<boolean>`（保存の前の値に戻して false を返す。
  失敗の文言は `使うエージェント CLI を保存できませんでした: 設定ファイルを読み書きできませんでした` の固定の文言で、例外の文言は出さない。
  `settings.json` が壊れていると IPC の拒否の文言に `JSON.parse` の例外〈ファイルの中身の断片〉が入りうるため。L-017。失敗したら `kind` だけを戻し、`fallback` は変えない）。
  保存に成功したら `fallback` を `null` に戻す（「選び直すと保存します」の注記を消す）。読み込みの IPC が拒否されたら（main は投げないが、IPC の失敗）`claude` と `fallback: 'read-failed'` にする
- 置き場: `useAgentWorkspace` が持ち、設定のパネルの状態 `agentCliKindPanel`（必須。L-060）と、タブ・入口の判定に渡す。設定のパネルと入口が同じ state を読むので、選んだ値はすぐ画面に反映される（L-466）
- 部品: `components/settings/AgentCliKindSection.tsx`（新規。`ExecutionModeSection` と同じ作り）。設定のパネルの `プロンプトの実行方式` の直後に置く

| 要素                       | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 見出し                     | `使うエージェント CLI`（`p.settings-panel__label`。`radiogroup` の `aria-labelledby`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 説明                       | `エージェント CLI 方式で使います。切り替えると、次の起動から使われます`（`p.settings-panel__note`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 選択肢                     | `role="radio"`・`aria-checked`。`Claude Code（claude）`・`GitHub Copilot CLI（copilot）`（`AGENT_CLI_PROFILES` の `displayName` と `commandName` から作る。`key` は `kind`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 使えない機能（選んだ CLI） | 選んだ種類で `false` の能力があれば、選択肢の下に `copilot では次の機能を使えません（ターミナルで直接操作します）: プロンプトの送信（実行・再実行）、作業中・入力待ちの表示と通知、中断、利用者の変更との区別、前回の続きから・このセッションで再開`（`p.settings-panel__note`。能力の名前の表から作る）                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 既定に戻した旨             | `fallback` が `invalid-value` なら `保存されていた値を読めなかったため claude を使っています（選び直すと保存します）`、`read-failed` なら `設定ファイルを読めなかったため claude を使っています`（`p.settings-panel__status`。`role="alert"` にしない）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 選べない間                 | 押す前から決まっている読み込み中（`kind === null`。`読み込み中...`）・どれかのタブが起動中は `disabled`（`isLocked`）。起動中は理由 `エージェントの起動中は、使う CLI を切り替えられません` を出して選択肢から `aria-describedby` で参照する。押した結果として起きる実行方式か CLI の切り替えの途中は `aria-disabled="true"`（`isSwitching`）にし、押しても選ばない。途中も理由（起動の理由と同じ `startBlockedReason`。CLI の切り替えなら `使うエージェント CLI を切り替えています`、実行方式なら `実行方式を切り替えています`）を `lockedReason` として出し、選択肢から `aria-describedby` で参照する（実行方式の節も同じ。起動中・従来の方式の実行中の理由を優先する。PR #61 の第 1 周で足した）。見た目は `disabled` と同じ（薄い表示・矢印のカーソル。ホバーで色を変えない） |
| 保存の失敗                 | `p.settings-panel__error`・`role="alert"`（`ExecutionModeSection` と同じ）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

読み込み中・起動中は押す前から決まっている状態なので `disabled` にし、押した処理の側でも同じ条件で止める（`selectAgentCliKind` の先頭。L-058）。
切り替えの途中は、選択肢を押した結果として起きる（`runSwitching` が `await` の前に同期で印を付ける）。`disabled` にすると、フォーカスを持つ押した選択肢が押せなくなって Chromium ではフォーカスが body に落ち、切り替えが終わっても戻らない（キーボードの次の `Tab` が文書の先頭からやり直しになり、スクリーンリーダーは選んだ結果を読まない。L-157）。
そこで panel state を `isLocked`（押す前から決まっている。`disabled`）と `isSwitching`（切り替えの途中。`aria-disabled`）に分け、途中は `aria-disabled="true"` にして部品の `onClick` で `onSelect` を呼ばない。押した処理の側でも `runSwitching` の再入防止で止める。
同じ途中の印を共有する `ExecutionModeSection`（`executionModePanel`）も同じ作りにする（review-loop 第 6 周で、refactor-srp 第 23 周の「押した後に状態が変わってフォーカスを失う操作ではない」という判定を覆した）。実機の確認は AGT-241。

選択中の選択肢を押しても何もしない。ただし `fallback` が `invalid-value` の間は、注記の「選び直すと保存します」のとおり、選ばれている `Claude Code（claude）` を押しても保存する（不正な値をファイルから消し、保存の成功で注記が消える）。
種類は変わらない（動いているタブも同じ `claude`）ので、確認も停止もしない。`read-failed` の注記は保存を約束していないので、今と同じ種類を押しても何もしない。
この規則は `isAgentCliKindResaveAllowed(fallback)`（`lib/agentCliMessages.ts`）にまとめ、部品（`AgentCliKindSection` の選択肢のクリック）と `selectAgentCliKind` の先頭が同じ関数を使う。`useAgentCliKind.changeKind` は同じ値でも保存する（同じ値の守りを持たない）。

### 切り替え（renderer。`useAgentWorkspace`）

```ts
const selectAgentCliKind = async (next: AgentCliKind): Promise<void> => {
  if (agentCliKind.kind === null || isAnyAgentStarting) return
  // 今と同じ種類は何もしない。ただし保存されていた値が不正な間は、注記(「選び直すと保存します」)のとおり保存して不正な値を消す。
  // 種類は変わらない(動いているタブも同じ種類)ので、確認・停止はしない
  const isResave = next === agentCliKind.kind
  if (isResave && !isAgentCliKindResaveAllowed(agentCliKind.fallback)) return
  // 実行方式の切り替えと同じ途中の印を使う(どちらかの途中はもう一方も始めない)
  await runSwitching('cli-kind', async () => {
    if (!isResave && isAnyAgentSessionActive) {
      if (!onConfirm(AGENT_STOP_ON_CLI_KIND_CHANGE_CONFIRM)) return
      if (!(await agentSessions.stopAll())) return
    }
    await agentCliKind.changeKind(next)
  })
}
```

- 実行方式の切り替えの ref・state（`switchingModeRef`・`isSwitchingMode`）を、どちらの切り替えかを持つ 1 つの値（`'mode' | 'cli-kind' | null`）にまとめ、片方の途中はもう片方の選択肢も選べなくする（どちらの panel state も `isSwitching` で受け取り、`aria-disabled` にする。「画面」の節）。
  途中の値・再入防止の ref・起動を受け付けない理由は `useAgentWorkspaceSwitching`（`switching`・`startBlockedReason`・`runSwitching`）が持ち、確認・停止・保存の手順は `useAgentWorkspace` が持つ（SRP リファクタリングで分けた）
- 切り替えの途中の起動の理由（`useAgentSessions` の `startBlockedReason`）は、CLI の切り替えなら `使うエージェント CLI を切り替えています`、実行方式なら今の `実行方式を切り替えています`
- 動いているタブを止めるのは、アプリ全体で 1 つの種類という前提を保つため（止めずに保存すると、動いている `claude` のタブと次に起動する `copilot` のタブが混ざる）。
  実行方式が従来の方式の間（ターミナルのパネルが出ない間）も選べる。そのときは動いているタブが無いので確認は出ない
- 確認の文言 `AGENT_STOP_ON_CLI_KIND_CHANGE_CONFIRM = '使う CLI を切り替えると、動いているエージェントをすべて終了します。切り替えますか？'`（`lib/agentSessionMessages.ts`）
- 送信前の確認のダイアログが開いている間は、ダイアログの背景に覆われて設定の画面を操作できない（今の作り）

## main の起動

### 起動の表（`src/main/agentCliLaunchSpecs.ts`。新規）

```ts
export interface AgentCliLaunchSpec {
  /** 探すコマンドの名前(AGENT_CLI_PROFILES[kind].commandName) */
  commandName: string
  /** すべての CLI で取り除く一覧に足して取り除く環境変数(完全一致) */
  extraRemovedEnvKeys: readonly string[]
  /**
   * 起動の引数。claudeSessionId と hookSettingsPath は、能力の表で sessionResume・changeAttribution が true の種類だけが受け取り、
   * false の種類に値が渡ったら投げる(呼び出し側の取り違えを黙って捨てない。L-044)
   */
  buildArgs(
    launch: AgentLaunchRequest,
    claudeSessionId: string | null,
    hookSettingsPath: string | null
  ): string[]
}

export const AGENT_CLI_LAUNCH_SPECS: Record<AgentCliKind, AgentCliLaunchSpec>
```

| 種類      | `commandName` | 引数                                                                                                                                                                            | 取り除く環境変数（共通の一覧に足すもの） |
| --------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `claude`  | `claude`      | 今の `buildAgentLaunchArgs`（`new` は `--session-id <ID>`、`resume` は `--resume <ID>`、`hookSettingsPath` があれば `--settings <path>`）。`claudeSessionId` が null なら投げる | なし                                     |
| `copilot` | `copilot`     | `new` は `[]`。`resume` は投げる（starter が先に `resume-unsupported` で断るので届かない）。`claudeSessionId`・`hookSettingsPath` が null でなければ投げる                      | `COPILOT_ALLOW_ALL`                      |

- `AGENT_COMMAND_NAME` は消し、`agentCommand.ts` の `buildAgentLaunchArgs` は `claude` の表の `buildArgs` に移す（中身は変えない）
- 共通の一覧（`REMOVED_AGENT_ENV_KEYS`・`REMOVED_AGENT_ENV_PREFIXES`）はすべての種類で取り除く。親の Claude Code のセッションの通信先と token（`CLAUDE_CODE_MESSAGING_TOKEN` など）は、
  `copilot` の子（シェルのツール）にも渡さない方がよいため
- `COPILOT_GITHUB_TOKEN`・`GH_TOKEN`・`GITHUB_TOKEN` は取り除かない（利用者の認証の設定。`claude` で `CLAUDE_CODE_USE_BEDROCK` などを残すのと同じ。「既知の制約」）

### 解決（`agentCommand.ts` の `resolveAgentLaunch`）

```ts
export interface ResolveAgentLaunchDeps {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  /** main が設定から読んだ種類(renderer の値ではない) */
  cliKind: AgentCliKind
  readLoginShellPath: () => Promise<string | null>
  isExecutable: ExecutableProbe
}

export interface AgentLaunchPlan {
  cliKind: AgentCliKind
  file: string
  args: string[]
  env: Record<string, string>
}

export type AgentLaunchResolution =
  | { kind: 'ok'; plan: AgentLaunchPlan }
  | { kind: 'not-found'; cliKind: AgentCliKind; shellPathUnavailable: boolean }
```

- PATH の決め方（ログインシェルの PATH の後ろに既定の探索先。Windows は main の PATH と PATHEXT）は変えず、探す名前だけを `AGENT_CLI_LAUNCH_SPECS[cliKind].commandName` にする
- `buildAgentEnv(base, pathValue, platform, extraRemovedKeys)` に種類の `extraRemovedEnvKeys` を渡す（省略できない引数にする。L-060）
- `agentRuntime.ts` の `resolveAgentLaunchFromSystem` は `async () => resolveAgentLaunch({ …, cliKind: (await getAgentCliKindSetting()).kind })`（ログは `log` の既定の `console.warn`）
- `copilot` は node スクリプトなので、pty に渡す PATH に `node` が無いと、`copilot` は見つかっても起動の直後に `env: node: No such file or directory` で終わる（終了コード 127）。
  この PATH は `copilot` を見つけたのと同じ値なので、nvm・volta などで `copilot` と `node` が同じ場所にある普通の入れ方では起きない。起きたときは今の「起動の直後に終了しました」の経路で出る（「エラー処理」）。
  起動の前に `node` を探して断ることはしない（shebang の解釈は CLI の入れ方〈npm・Homebrew・単体の実行ファイル〉で変わり、アプリが正しく先回りできないため）

### 起動の手順（`agentSessionStarter.ts`）

`createSession` の手順は変えず、`launch.plan.cliKind` の能力で分ける。

1. `resolveLaunch()` が `not-found` なら `{ kind: 'error', error: 'command-not-found', cliKind, shellPathUnavailable }` を返す
2. **再開の拒否**: `request.launch.kind === 'resume'` で、`plan.cliKind` の `sessionResume` が `false` なら、hooks の準備より前に `{ kind: 'failed', result: { kind: 'error', error: 'resume-unsupported' } }` を返す（起動しない。L-041）
3. `hooks.prepare(ownerId, plan)`（「hooks」）
4. `spawnSession`（同期の区間）:
   - `sessionResume` が `true`（`claude`）: 今の手順（`selectClaudeSessionId`・予約・`--session-id`/`--resume`）。`claudeSessionId` は文字列
   - `false`（`copilot`）: 会話の ID を選ばず、予約しない。`claudeSessionId` は `null`。`spec.buildArgs(request.launch, null, null)` で引数を作る
5. 起動の確定（`finishStart`・`recordStarted`）: 起動の依頼ごとの受け渡し `CreatedClaudeSession`（今は `{ claudeSessionId: string | null }`）を `CreatedAgentSession`（`{ cliKind: AgentCliKind | null; claudeSessionId: string | null }`。claude 以外の種類も通るので改名する）にする（`cliKind` の `null` は「まだ入っていない」）。`spawnSession` が `{ kind: 'created' }` を返す直前に `plan.cliKind` と `claudeSessionId`（`copilot` は `null`）を入れる。`finishStart` は会話の ID だけでなくこの受け渡しの全体を `recordStarted` に渡す。
   `recordStarted` は、`cliKind === null`（入っていない）なら今と同じく投げる。`cliKind` の `sessionResume` が `true` なら、`claudeSessionId === null` を投げ、`records.record` に書く。`false` なら `claudeSessionId` が `null` でなければ投げ、記録は書かない。結果に `cliKind` と `claudeSessionId`（`null` を含む）を載せる
6. pty の `sessionId` → 種類と会話の ID の控え（今の `claudeSessionIdBySessionId`）を `sessionInfoBySessionId: Map<string, { cliKind; claudeSessionId: string | null }>` にし、
   `already-running` と状態の取得（`agentTerminal:getState` の `attachClaudeSessionIds` → `attachSessionInfo`）で `cliKind` と `claudeSessionId` を返す。
   `claudeSessionIdOf` は `sessionInfoOf` に名前を変える（呼び出し元は `agentTerminalHandlers.ts` と、starter の関数を受け口へ渡す `ipcHandlers.ts`。`agentSessionSnapshot.ts` の `attachClaudeSessionIds` は `attachSessionInfo` にし、
   見つからないセッションを外すときの警告は `[agentTerminal:getState] セッションの種類と会話の ID が見つからないセッションを一覧から外します:` にする）。starter が返す種類と会話の ID の組の型は `AgentSessionInfo`（`agentSessionStarter.ts` が export）

`recordStarted` の「会話の ID が `null` なら投げる」は、`cliKind` が入っていることを先に確かめた上で、`sessionResume` が `true` の種類のときだけの検査にする（`copilot` の `null` は正常。種類が入っていない取り違えは能力で見分けず投げる。L-044）。

### 版

`hooks.prepare` の中の `claude` の版の確認（`agentClaudeVersion.ts`）は `changeAttribution` が `true` の種類だけで行う（下の「hooks」）。`copilot` の版は確かめない（「決めたこと」）。

### hooks（`agentHookSessions.ts`）

- `prepare(ownerId, plan)` の先頭で `agentCliCapabilities(plan.cliKind).changeAttribution` が `false` なら、版の確認も受け口の用意もせず `without(ownerId, 'cli-unsupported')` を返す
  （`copilot` の実行ファイルに `--version` を渡して `claude` の版として読まない）
- `AgentHooksUnavailableReason`（`agentToolActivity.ts:24`）に `'cli-unsupported'` を足す。`AgentChangesAttributionLostReason`（`src/shared/types/agentChanges.ts:124`）にも足す
- `activate` は今の `hooks === null` の経路（追跡に `unconfirmed` の理由で足す）をそのまま使う。エージェントの変更の確認の記録（作業ツリーの記録・一覧・戻す）は CLI に依存しないので `copilot` でも動き、区別だけが「できない」になる

### 前回の続きから（main）

- `agentTerminal:getLastSession`（`lastSessionOf`）は変えない（記録は `claude` のものだけ）。`copilot` を選んでいる間に押せないのは renderer の理由で、main は起動の依頼の再開を 2. で断る（二重の守り。L-041）

## renderer の「使えない」の出し方

### タブの種類と名前

- タブの状態（`AgentTabSessionFields`）に `cliKind: AgentCliKind | null` を足す。起動の結果・状態の取得の `cliKind` で入れ、起動を始めたときに `null` に戻す。終了しても消さない（終了したタブの名前と画面の中身が合うように）
- `useAgentSessions` に、設定の種類 `appCliKind: AgentCliKind`（必須。読み込み中は既定の `claude`）を渡す。タブの表示（`AgentSessionTabView`）に、その時点の種類 `cliKind = fields.cliKind ?? appCliKind` を載せ、名前はこの値で引く。
  能力は、動いている（`starting`・`running`）タブならこの値、未起動・終了したタブの送信の入口（実行・履歴の再実行）は次に起動する設定の種類で引く（下の「入口ごとの表」の後の段落。`agentCapabilityCliKindOf`）
- 名前: `formatAgentTabLabel(number, kind)`（`src/shared/agentTabLabel.ts`。種類は必須）→ `${AGENT_CLI_PROFILES[kind].commandName} ${number}`（`claude 1`・`copilot 1`）。
  通知の文言（`src/shared/agentNotificationText.ts`。main の OS の通知の題・本文と renderer の読み上げが使う）の名前は `formatAgentTabLabel(tabNumber, 'claude')` にする（通知は `screenActivity` が `true` の種類でだけ出るため。種類を通知の依頼に足すのは段階 2）

### 入口ごとの表（L-061）

新しい状態は「選択中のタブ（または設定）の CLI に、その能力が無い」。`preload/api.ts` の `agentTerminal:*`・`settings:*` と、帯・プロンプト・履歴・ステータスバー・通知・変更の確認の入口を列挙した。

| 入口                                                                 | `copilot` での扱い                     | 使えない理由の出し方                                                                                                                                                                                                                                                  | 処理の側の守り（L-058）                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| プロンプトの `実行`                                                  | 押せない                               | 実行ボタンの理由（今の 1 か所の表示と `aria-describedby`）に `copilot へのプロンプトの送信には、まだ対応していません（ターミナルに直接入力してください）`                                                                                                             | `getPromptRunAvailability` に能力の判定に使う種類（`agentCapabilityCliKindOf`。下の段落）を足し、従来の方式の判定の直後（閉じる途中・未起動より前）に `promptSend` を見る。`useAgentPromptSender.send` も、`beforeSend`（変更の記録の開始）より前の先頭で送り先の `cliKind`（送り先の型の必須の欄。下の段落）を見て、書き込まずに `failed`（`unsupported-cli`）を返す |
| 履歴の `再実行`（エージェントのエントリ）                            | 押せない                               | 同じ文言（`getHistoryRerunAvailability` は `getPromptRunAvailability` を通る）                                                                                                                                                                                        | 同上                                                                                                                                                                                                                                                                                                                                                                  |
| 送信前の確認の `送信`                                                | 押せない                               | 確認のダイアログの送れない理由（`targetBlockedReason`。同じ関数）                                                                                                                                                                                                     | 同上（確認からの送信も `send` を通る）                                                                                                                                                                                                                                                                                                                                |
| ターミナルのキー入力（`agentTerminal:write`）                        | 今までどおり                           | —                                                                                                                                                                                                                                                                     | —（利用者の打鍵）                                                                                                                                                                                                                                                                                                                                                     |
| 帯の `中断`（`agentTerminal:interrupt`）                             | 押せない（出す間は今までどおり）       | `aria-disabled`・`title`・`aria-describedby` の理由に `copilot では中断のボタンを使えません（ターミナルで操作してください）`。判定の順は `starting` の直後（閉じる途中より前）                                                                                        | `getAgentInterruptAvailability` に `cliKind` を足す（押した処理の先頭も同じ関数。2026-10-19 の設計書の手順 2）。main では拒否しない（「決めたこと」）                                                                                                                                                                                                                 |
| 帯・タブの状態の文言、ステータスバーのまとめ                         | 判定しない                             | 活動の記録が無いので、動いている間は `実行中`（`unknown` の今の文言）。作業中・入力待ちに変わらないことは設定の画面の「使えない機能」で伝える                                                                                                                         | `useAgentActivity` が `screenActivity` の無いタブを購読しない                                                                                                                                                                                                                                                                                                         |
| 完了・許可待ちの通知（読み上げ・OS の通知・バッジ）                  | 出ない                                 | 設定の `エージェントの通知` の項目に、選んだ CLI に `screenActivity` が無ければ `copilot では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）` を添える（`p.settings-panel__note`。チェックボックスの `aria-describedby` に説明と並べて含める） | 活動の変化が無いので知らせが起きない（`useAgentNotifications` は変えない）。テストで `copilot` のタブの出力では知らせないことを確かめる                                                                                                                                                                                                                               |
| 変更の一覧の自動の取り直し・hooks への作業中の知らせ                 | 起きない                               | 変更の確認の区別の状態の 1 行（下）                                                                                                                                                                                                                                   | 活動の変化が無いので起きない（`useAgentChangesAutoRefresh`・`useAgentHooksWorkingReport` は変えない）。ウィンドウのフォーカスの復帰での取り直しと `更新` は今までどおり                                                                                                                                                                                               |
| 変更の確認の区別                                                     | 区別しない                             | 区別をやめた理由の文言（`AGENT_CHANGES_ATTRIBUTION_LOST_REASONS`）に `'cli-unsupported': '使っているエージェント CLI が区別に対応していません（claude だけが対応しています）'`                                                                                        | main の `hooks.prepare` が `cli-unsupported` を返す                                                                                                                                                                                                                                                                                                                   |
| `前回の続きから`                                                     | 押せない                               | 今の理由の表示（帯の見える理由と隠した `span`）に `copilot では「前回の続きから」を使えません（設定で claude に戻すと使えます）`。判定の順は起動の理由（フォルダ無し・切り替えの途中）の直後                                                                          | `getResumeLastDisabledReason` に設定の種類を足す。押した処理（`useAgentResume.resumeLast`）は今どおり同じ関数で止める。main も `resume-unsupported` で断る                                                                                                                                                                                                            |
| 履歴の `このセッションで再開`                                        | 押せない                               | 履歴の詳細の理由に `copilot では「このセッションで再開」を使えません（設定で claude に戻すと使えます）`。判定の順は実行方式の判定の直後                                                                                                                               | `getResumeEntryDisabledReason` に設定の種類を足す。押した処理（`onResumeEntry`）も同じ関数。main も断る                                                                                                                                                                                                                                                               |
| `起動`・`+`                                                          | 起動する                               | —（`aria-label` は `起動（開いているフォルダで copilot を起動）`）                                                                                                                                                                                                    | —                                                                                                                                                                                                                                                                                                                                                                     |
| `終了`・タブの `×`・フォルダの切り替え・実行方式の切り替え・リロード | 今までどおり                           | —                                                                                                                                                                                                                                                                     | —（pty の停止は CLI に依存しない）                                                                                                                                                                                                                                                                                                                                    |
| 参照を添える（エクスプローラ・タブから）                             | 今までどおり（送れないので使われない） | 実行ボタンの理由で分かる                                                                                                                                                                                                                                              | 送信が止まる                                                                                                                                                                                                                                                                                                                                                          |
| 設定の CLI の切り替え                                                | —                                      | 「設定」の「画面」                                                                                                                                                                                                                                                    | `selectAgentCliKind` の先頭                                                                                                                                                                                                                                                                                                                                           |

判定に使う種類は、動いている（`starting`・`running`）タブではタブの `cliKind`（起動の結果の値）、それ以外は設定の値（次に起動する CLI）。
規則は純関数 `agentCapabilityCliKindOf(tab, appCliKind)`（`lib/agentSessionTabState.ts`）1 つにまとめ、`useAgentWorkspace` が実行ボタン（`buildPromptRunPanelState`）と履歴の再実行（`getHistoryRerunAvailability`）に渡す。
終了したタブの `cliKind` は前の起動の結果のまま残る（名前を画面に合わせる）が、そのタブで `起動` を押すと設定の種類で起動するため、押せない理由を次の起動に合わせる。
たとえば `copilot 1` が終了した後に設定を `claude` に戻すと、`実行` の理由は `copilot` のものではなく未起動の理由（`起動` を押せば `claude` で送れる）になり、逆に `claude 1` が終了した後に `copilot` を選ぶと、未起動の理由ではなく `copilot` の理由になる（`起動` を押しても送れない）。
そのため `promptSend` を閉じる途中・未起動より前に見ても、「起動しても送れない」が次の起動の種類について成り立つ。タブの名前は結果の種類のまま（`copilot 1`）。
ほかの入口は、もともと同じ考え方に当たる: 中断は動いているタブにしか出さない（未起動・終了の帯には出さない）のでタブの `cliKind`、送信前の確認の送り先の写しと `send` の守りは動いているタブ（`running`）にしか届かないのでタブの `cliKind`、
画面の判定（`useAgentActivity`）は `running` のタブだけを見るのでタブの `cliKind`、再開の入口（前回の続きから・このセッションで再開）は新しく起動するので設定の値、利用者の変更との区別は main が起動の時点の種類で決める。
送信の送り先（`useAgentPromptSender` の `AgentSendTarget`。`slotId`・`controller`・`describeSession`）には `cliKind: AgentCliKind`（必須）を足す。`useAgentWorkspace` の `selectedTarget` は `agentSessions.selected` のタブの種類（`cliKind ?? appCliKind`。上の「タブの種類と名前」）から作り、送信前の確認（`useAgentSendConfirm`）が控える target にも同じ値が入る（確認を開いた時点の値を控え、送るときにその値で `send` の判定を通す）。
`AgentSendFailure` に `unsupported-cli` を足すと `AGENT_SEND_FAILURE_MESSAGES`（`Record<AgentSendFailure, string>`。`agentSendMessages.ts`）に文言が要る。文言は実行ボタンの理由と同じ関数（`commandName` を引数に取る。`lib/agentSendMessages.ts`）の戻り値にするため、`AGENT_SEND_FAILURE_MESSAGES` の値は `commandName` を取れない定数の文字列ではなく、`unsupported-cli` だけを関数で引く形にする（`Record<Exclude<AgentSendFailure, 'unsupported-cli'>, string>` と `agentPromptSendUnsupportedReason(commandName)`〈`lib/agentSendMessages.ts`〉に分け、表示側は `agentSendFailureMessage(reason, commandName)`〈`lib/agentSendMessages.ts`〉で引く）。

能力の参照は、上の表の「処理の側の守り」の純関数（`getPromptRunAvailability`・`getAgentInterruptAvailability`・`getResumeLastDisabledReason`・`getResumeEntryDisabledReason`）の入力に必須の引数として足し、組み立て役（`useAgentWorkspace`）から渡す（省略で `claude` に倒れない。L-060）。

### 画面の判定を止める（`useAgentActivity`）

- `AgentActivityTab` に `cliKind: AgentCliKind`（必須）を足す。`agentCliCapabilities(tab.cliKind).screenActivity` が `false` のタブは `acquireWatch` しない（購読・タイマーを持たない）。
  既に購読していたタブ（種類が変わった）は `releaseWatch` し、そのタブの活動を記録から消す
- 種類は起動の間に変わらない（起動の結果で決まり、切り替えは止めてから行う）が、タブの再利用（`claude` で終了 → 設定を `copilot` に → 同じタブで起動）では変わるので、区切りとして扱う

## 文言

| 場所                                                   | 今の文言                                                                                                       | 段階 1 の文言                                                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| タブの名前（`agentTabLabel.ts`）                       | `claude ${number}`                                                                                             | `${commandName} ${number}`（`claude 1`・`copilot 1`）                                                                                                                                    |
| `起動` の `aria-label`（`AgentTerminalPanel.tsx:181`） | `起動（開いているフォルダで claude を起動）`                                                                   | `起動（開いているフォルダで ${commandName} を起動）`（設定の種類。パネルは `AgentTerminalPanelState.appCliKind` で受け取る）                                                             |
| `中断` の `aria-label`（`agentInterruptAriaLabel`）    | `中断（作業中の claude に Esc を送る）`                                                                        | `中断（作業中の ${commandName} に Esc を送る）`（選択中のタブの種類。`copilot` のタブでは押せないが、名前はタブの CLI に合わせる）                                                       |
| 見つからない（`agentSessionMessages.ts:66`）           | `claude コマンドが見つかりません。Claude Code をインストールしてください（探した場所: ログインシェルの PATH）` | `${commandName} コマンドが見つかりません。${displayName} をインストールしてください（探した場所: ログインシェルの PATH）`（結果の `cliKind`。PATH を取れなかった旨の添え書きは今のまま） |
| 再開の拒否（新規）                                     | —                                                                                                              | `resume-unsupported`: `使っているエージェント CLI は、セッションの再開に対応していません`                                                                                                |
| 実行方式の選択肢（`ExecutionModeSection.tsx:17`）      | `エージェント CLI（アプリ内のターミナルで Claude Code を動かす）`                                              | `エージェント CLI（アプリ内のターミナルでエージェント CLI を動かす）`                                                                                                                    |
| 入口ごとの使えない理由・設定の画面                     | —                                                                                                              | 「renderer の『使えない』の出し方」と「設定」の表                                                                                                                                        |

次の段階に回す文言（`copilot` では使えない機能の文言のため、段階 1 では `claude` のまま）: 中断の理由・読み上げ（`agentInterruptMessages.ts`）、前回の続きからの `aria-label`（`agentSessionMessages.ts:27`）、
同じ ID が動いている旨（`:20`）、変更の区別の理由と注意（`agentChangesMessages.ts:54-56・72・413・436`）、送信前の確認の未保存の注意（`agentReferenceMessages.ts:47`）、完了・許可待ちの通知の本文。

文言は `lib/agentCliMessages.ts`（新規。能力の名前の表・設定の画面の項目と注記・既定に戻した旨・保存の失敗）と、既存の文言のファイル（`agentSessionMessages.ts`・`agentSendMessages.ts`・`agentInterruptMessages.ts`・`agentChangesMessages.ts`）に置く。入口ごとの使えない理由は、その入口の文言のファイルに置く（送信は `agentSendMessages.ts`、中断は `agentInterruptMessages.ts`、前回の続きから・このセッションで再開は `agentSessionMessages.ts`）。
使えない理由は `commandName` を引数に取る関数にし、文字列に CLI の名前を直書きしない。

## 記録と履歴

- **起動の記録（`agent-sessions.json`）**: 形を変えない。`copilot` のセッションは書かない（`sessionResume` が `false`）。今の記録はすべて `claude` の起動のもの
- **会話の ID の予約（`claudeSessionReservations.ts`）**: `copilot` では予約しない
- **履歴（`HistoryEntry.agent`・`toolId`）**: 形を変えない。履歴のエントリは送信（`sent`）のときだけ作られ、`copilot` では送信が使えないので、`copilot` のエントリは作られない。
  `describeAgentTabSession` は会話の ID が `null` のタブで `null` を返す今の作りのまま
- **次の段階で種類を足すときの規則**（段階 3 で設計する。ここでは方針だけ決める）: 起動の記録・履歴のエントリに `cliKind` を足し、無い記録・エントリは `claude` として読む。読み込みの正規化で
  ID・日時・ほかの欄を作り直さず（L-456）、知らない欄は保ったまま書き戻す（L-459）

## エラー処理

| 場面                                                   | main の結果                                        | renderer の扱い                                                                                                                                                                                                |
| ------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `copilot` が見つからない                               | `command-not-found`（`cliKind: 'copilot'`）        | `copilot コマンドが見つかりません。GitHub Copilot CLI をインストールしてください（探した場所: ログインシェルの PATH）`（PATH を取れなければ今の添え書き）。帯の下の `role="alert"`                             |
| `copilot` は見つかったが `node` が無い・Node.js が古い | 起動は `started`。直後に終了コード 127・1 で終わる | 今の `起動の直後に終了しました。ターミナルの表示を確かめてください`。ターミナルに `env: node: …` か `GitHub Copilot CLI requires Node.js v24 or higher` が残る                                                 |
| 起動に失敗（spawn が投げた）                           | `spawn-failed`                                     | 今の `エージェントを起動できませんでした: <詳細>`                                                                                                                                                              |
| `copilot` で再開の依頼（renderer の判定をすり抜けた）  | `resume-unsupported`（起動しない）                 | `使っているエージェント CLI は、セッションの再開に対応していません`                                                                                                                                            |
| 設定の値が壊れている・設定ファイルを読めない           | `claude` で起動（ログに記録）                      | 設定の画面に既定に戻した旨（「設定」）                                                                                                                                                                         |
| 設定の保存の失敗                                       | `setAgentCliKind` が投げる                         | `使うエージェント CLI を保存できませんでした: 設定ファイルを読み書きできませんでした`（理由は固定の文言。例外の文言は出さない。L-017）。選択は保存の前の値に戻す。動いていたタブは止めた後なので、止まったまま |
| 切り替えでタブを止められなかった                       | —                                                  | 保存しない（そのタブの `error` に今の終了の失敗の文言）                                                                                                                                                        |
| ログインが要る・フォルダの信頼の確認                   | アプリは判定しない                                 | `copilot` が自分の画面で案内する。利用者がターミナルで答える（自分のアカウントで行う）                                                                                                                         |

## テスト方針

vitest。main は今のテストの作り（偽の依存・偽の pty）、renderer は `@testing-library/react` と `window.api` の偽物。

- shared: `agentCliKinds.test.ts`（新規）: `isAgentCliKind`（`'claude'`・`'copilot'` だけ真。`'Claude'`・`''`・数・null は偽）・既定が `claude`・既定のコマンド名（`DEFAULT_AGENT_CLI_COMMAND_NAME`）が `claude`・`claude` の能力はすべて真で `copilot` はすべて偽・
  どの種類も `interrupt` が真なら `screenActivity` も真・`commandName` が `-` で始まらず英小文字だけ（引数として解釈されない名前。L-034）
- main
  - `agentCliKindStore.test.ts`（新規）: 無い → `claude`・`fallback: null`、`'codex'`・`1`・`{}` → `claude`・`invalid-value` とログ（値の先頭 80 文字だけ）、`readSettingsFile` が投げる → `claude`・`read-failed`（例外の文言をログに出さない）、読んだ値が `null`・配列・数・文字列の JSON → 投げずに `claude`・`read-failed`、
    保存は検証してマージで書く（ほかのキーが残る）、知らない値は投げて書かない
  - `handlers/settingsHandlers.test.ts`: 2 つの IPC の受け渡し
  - `agentCommand.test.ts`: `resolveAgentLaunch` が `cliKind` の `commandName` を探す（偽の `isExecutable` に `…/copilot` だけを置くと `copilot` で見つかり `claude` では `not-found`）・`not-found` に `cliKind` が載る・
    計画に `cliKind` が載る・`buildAgentEnv` が `copilot` のときだけ `COPILOT_ALLOW_ALL` を取り除き、`claude` では残す・共通の一覧はどちらでも取り除く
  - `agentCliLaunchSpecs.test.ts`（新規）: `claude` の引数は今の `buildAgentLaunchArgs` のテストを移す（`toEqual` の完全一致）、`copilot` の `new` は `[]`、`copilot` の `resume`・`claudeSessionId` か `hookSettingsPath` が null でない呼び出しは投げる、
    `claude` に `claudeSessionId` が null なら投げる、未知の `launch.kind` は投げる
  - `agentSessionStarter.test.ts`: `copilot` の計画で起動すると、引数が空・`records.record` も `reservations.tryReserve` も呼ばれない・結果は `cliKind: 'copilot'`・`claudeSessionId: null`、
    `copilot` で `resume` の依頼は `resume-unsupported` で `hooks.prepare` も `spawnPty` も呼ばない、`already-running` と `sessionInfoOf` が種類を返す、`copilot` のセッションも hooks を `prepare`・`activate` し、終了で `sessionInfoOf` から消えて `release(prepared, sessionId)` を 1 回呼ぶ、`claude` の今のテストは結果に `cliKind: 'claude'` が載るよう直す
  - `agentHookSessions.test.ts`: `copilot` の計画では版の読み取り（`readClaudeVersion`）も受け口の用意も呼ばず `cli-unsupported`、`activate` で追跡に `unconfirmed`（`cli-unsupported`）が入る
  - `handlers/agentTerminalHandlers.test.ts`: 状態の取得の要素に `cliKind`・`claudeSessionId`（`null` を含む）が載る
  - **偽の実行ファイルの統合テスト** `agentCliLaunch.integration.test.ts`（新規。実物の node-pty。Windows では飛ばす。L-059）: 一時ディレクトリに `copilot` という名の `#!/usr/bin/env node` のスクリプト
    （受け取った引数・作業ディレクトリ・`COPILOT_ALLOW_ALL` の有無を JSON で 1 行書いて終わる）を `writeFileSync(…, { mode: 0o755 })` で置き（warm-up の起動をする `writeFakeExecutable` は使わない。引数を空で 1 回起動する確かめと混ざるため）、
    `readLoginShellPath` がそのディレクトリと、`node`（`process.execPath` へのシンボリックリンク）だけを置いた一時ディレクトリを返す偽物で
    （`process.execPath` のディレクトリは使わない。nvm ではそこに実物の `copilot` があるため）`resolveAgentLaunch`（`cliKind: 'copilot'`）→ `startAgentSession` を実際に行う。
    起動の前に、解決された `file` が偽の `copilot` のパスと一致しなければ起動せずに投げる（実物の `copilot` を起動しない）。出力から、引数が空・作業ディレクトリが許可のフォルダ・`COPILOT_ALLOW_ALL` が無い（親の環境に入れておく）・
    shebang の `env node` が渡した PATH で解決された（スクリプトが動いた）ことを確かめる。「pty に渡した PATH で `node` を解決できないと起動の直後に 0 以外で終わる」（「エラー処理」の 2 行目）は、`node` を置いたディレクトリを外す方法では確かめない（`resolveAgentLaunch` が既定の探索先〈`cliSearchPaths.ts` の `/usr/local/bin`・`/opt/homebrew/bin`〉を必ず PATH の後ろに足すため、そこに `node` がある環境〈Homebrew の node の開発機・CI〉では偽の `copilot` が動いて 0 で終わり、テストが落ちる）。この場合だけ別の偽の `copilot` の shebang を存在しない名前（`#!/usr/bin/env prompt-ide-missing-node`）にして、どの環境でも解決できずに 0 以外で終わることを確かめる
- renderer
  - `useAgentCliKind.test.ts`（新規）: 読み込み・`fallback` の受け渡し・IPC の拒否で `claude` と `read-failed`・保存の失敗で前の値に戻り `saveError`（続けて失敗しても読み込んだ値に戻す）
  - `AgentCliKindSection.test.tsx`（新規）: `radiogroup`・`aria-checked`・選ぶと `onSelect`（同じ値では呼ばない。ただし `invalid-value` の間は同じ値でも呼び、`read-failed` では呼ばない）・読み込み中と選べない間は `disabled`・起動中と切り替えの途中（`isSwitching` で `aria-disabled` のまま）の理由の `aria-describedby`・
    `copilot` のとき使えない機能の注記が能力の表の全部の名前を含む・既定に戻した旨の 2 つの文言
  - `SettingsPanel.test.tsx`: `プロンプトの実行方式` の直後に `使うエージェント CLI` が出る・通知の項目の注記
  - 純関数: `agentSendMessages.test.ts`（`getPromptRunAvailability` の `copilot` の理由と順〈閉じる途中・未起動より前〉）、`agentInterrupt.test.ts`（`copilot` の理由と順）、`agentResumeAvailability.test.ts`（2 つの理由と順）、
    `agentSessionMessages.test.ts`（`command-not-found` の CLI ごとの文言・`resume-unsupported`・前回の続きから と このセッションで再開 に対応しない理由）、`agentInterruptMessages.test.ts`（中断に対応しない理由）、`agentChangesMessages.test.ts`（`cli-unsupported`）、`agentTabLabel.test.ts`（種類ごとの名前）、`agentCliMessages.test.ts`（新規。`isAgentCliKindResaveAllowed` を含む）、`agentSessionTabState.test.ts`（`agentCapabilityCliKindOf`: 動いているタブはタブの種類、未起動・終了したタブは設定の種類）
  - `useAgentPromptSender.test.ts`: `copilot` の送り先では `beforeSend` も `describeSession` も `controller.beginSending`・`write` も呼ばずに `unsupported-cli` で失敗し、`setError` の文言が実行ボタンの理由と同じ関数の値になる。`agentSendMessages.test.ts` に `AGENT_SEND_FAILURE_MESSAGES` の残りの種類が `unsupported-cli` を含まないこと（型で守る）と `unsupported-cli` の文言を足す。`useAgentSendConfirm` のテストで、確認を開いた時点の送り先の `cliKind` を送るときに使う
  - `useAgentActivity.test.ts`: `copilot` のタブは出力を書いても活動が記録されない（タイマーも張らない）・`claude` → `copilot` に種類が変わったタブの記録が消える（`claude` に戻したタブは、戻った後の判定まで前の活動を返さない）
  - `useAgentSessions.test.ts`: 起動の結果の `cliKind` をタブに入れる・未起動は設定の種類・終了しても種類が残る・起動を始めると `null` に戻る・状態の取得で種類が入る・タブの名前
  - `useAgentNotifications.test.ts`: `copilot` のタブ（活動の記録が無い）では知らせない
  - `useAgentWorkspaceSwitching.test.ts`（新規）: 切り替えの種類ごとの起動を受け付けない理由・途中の間は同じ描画の中の 2 回目ももう一方の切り替えも手順を呼ばない・手順が投げても印を外す
  - **配線**（L-060）: `useAgentWorkspace.test.ts` で、(1) 設定が `copilot` のとき、実物の組み立て役から `promptRun.isRunDisabled` が真で理由が `copilot` のもの、`agentTerminal.interrupt.disabledReason`・前回の続きからの理由・
    履歴の再開の理由が `copilot` のもの、(2) 動いているタブがある状態で `copilot` を選ぶと確認 → `stopAll` → `setAgentCliKind` の順に呼ばれ、確認をキャンセル・`stopAll` が false なら保存しない、
    切り替えの途中は起動の理由が `使うエージェント CLI を切り替えています` で、実行方式の選択肢も選べない、(3) 起動の結果が `copilot` なら設定が `claude` のままでも（別のウィンドウで変えた場合）そのタブの実行ボタンが押せない、
    (4) `copilot` で終了したタブで設定が `claude` なら実行・再実行の理由が未起動のもの（名前は `copilot 1` のまま）、`claude` で終了したタブで設定が `copilot` なら `copilot` のもの、
    (5) `invalid-value` の間に今と同じ種類を選ぶと、動いているタブがあっても確認・停止なしで保存し、`read-failed` では何もしない。
    `useAgentWorkspace` の `appCliKind`・タブの `cliKind`・各純関数への種類の受け渡しを 1 つずつ外す変異で、どれかのテストが落ちることを確かめる
- 実機: 「実機テスト仕様書の新しい項目の下書き」

## 実機テスト仕様書の新しい項目の下書き

`docs/manual-test-spec.md` の「## エージェント CLI のアプリ内ターミナル」の末尾（`### 実行の中断` の後、`## エージェントの変更の確認` の前）に `### 使うエージェント CLI の切り替え（copilot）` を足し、AGT-228 から振る。
既存の項目は、設定のセクションの数を数える **BASE-007** の期待結果を `プロンプトの実行方式`・`使うエージェント CLI`・`エージェントの通知`・`送信前の確認`・`Anthropic API キー`・`モデル` の 6 つに直す（ID は変えない）。
ほかの既存の項目は `claude` を選んだ状態（既定）の挙動なので変えない。下書きの文言は、実装の後にコードの文言と照らし合わせて確定してから追記する。

手順はテスト用のフォルダで行い、ファイルを書き換える指示を含めない（`copilot` に頼む内容は返答だけで済むものにする）。保存される設定（使う CLI）を変える項目は、AGT-240 で `claude` に戻す（その後に足した AGT-241 も、キーボードでの切り替えを `claude` に戻して終える。PR #61 の第 1 周で足した AGT-242 も `claude` に戻して終える）。
`copilot` の実行ファイルの名前を変えて「見つからない」を作る・`settings.json` に壊れた値を書く手順は、利用者の環境を書き換えるので入れない（単体テストと統合テストで確かめる。L-072）。

> 前提: エージェント CLI 方式で、テスト用のフォルダを開いている。GitHub Copilot CLI（`copilot`）がインストール済みで、端末で `copilot --version` が動く。
> 前提: フォルダの信頼の確認が出たら、その回だけ信頼する選択肢を選び、今後も覚える選択肢は選ばない（選択肢の呼び名は実物の `copilot` で確かめていないので、画面の文言から意味で選ぶ。覚えさせると、テスト用のフォルダが利用者の `~/.copilot` の設定の `trustedFolders` に残る。覚えさせてしまったら、`copilot` の中で `/` のコマンドから信頼のフォルダの一覧を開いて外すか、`~/.copilot` の設定の `trustedFolders` からそのフォルダを手で消す）。
> 前提: 設定の「使うエージェント CLI」が `Claude Code（claude）` の状態から始める（前回の途中で止めて `copilot` が残っていれば、設定の画面で `Claude Code（claude）` に戻してから始める）。AGT-229〜242 の間は保存される設定が `copilot` に変わるので、途中で止めるときも設定を `Claude Code（claude）` に戻す。
> 前提: `copilot` のログイン・プランの選択など GitHub のアカウントに関わる操作は、利用者が自分のアカウントで、`copilot` の画面の案内に従って行う（アプリは判定も代行もしない）。この節の項目では、`copilot` に送る内容を返答だけで済むもの（例: `こんにちは`）にする。

- [ ] **AGT-228** 設定を開いて `プロンプトの実行方式` の下を見る → `使うエージェント CLI` の見出しと `エージェント CLI 方式で使います。切り替えると、次の起動から使われます` の説明、`Claude Code（claude）`・`GitHub Copilot CLI（copilot）` の 2 つの選択肢があり、`Claude Code（claude）` が選ばれている（初めて使う環境の既定）
- [ ] **AGT-229** `claude 1` を起動して入力待ちにしてから、設定で `GitHub Copilot CLI（copilot）` を選び、出た確認で `キャンセル` を押す → 確認に `使う CLI を切り替えると、動いているエージェントをすべて終了します。切り替えますか？` が出る。キャンセルすると選択は `Claude Code（claude）` のままで、`claude 1` は動き続ける
- [ ] **AGT-230** もう一度 `GitHub Copilot CLI（copilot）` を選び、確認で `OK` を押す → `claude 1` が終了し（帯が `終了しました…`。タブの名前は `claude 1` のまま）、選択が `GitHub Copilot CLI（copilot）` に変わる。選択肢の下に `copilot では次の機能を使えません（ターミナルで直接操作します）:` に続けて使えない機能の一覧が出る。`エージェントの通知` の項目に `copilot では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）` が出る（VoiceOver を使う場合は、Tab で `エージェントの通知` のチェックボックスへ移ると、説明に続けてこの注記も読み上げられる）
- [ ] **AGT-231** VoiceOver を使う場合は、帯の `起動` へ移って名前を聞く（使わない場合は名前の確認を飛ばして、そのことを記録する。押せる `起動` にマウスを載せても何も出ない）。そのあと `起動` を押す → 名前（VoiceOver で聞く場合）は `起動（開いているフォルダで copilot を起動）`。押すとタブの名前が `copilot 1` になり、ターミナルに `copilot` の画面が出る（初回はフォルダの信頼の確認・ログインの案内などが出うる。前提のとおり利用者が答え、フォルダの信頼はその回だけ信頼する選択肢を選ぶ）。帯は `実行中` になる。VoiceOver を使った場合は、確かめた後に切る
- [ ] **AGT-232** `copilot` が入力を受け付ける状態で、ターミナルの中をクリックして `こんにちは` と入力して `Enter` を押し、応答が終わるまで帯とステータスバーを見る → `copilot` が応答する。帯とステータスバーは応答の間も後も `実行中` のままで、`作業中`・`入力待ち` に変わらない。応答が終わっても完了の通知（読み上げ・OS の通知）は出ない
- [ ] **AGT-233** 「プロンプト」パネルで登録したプロンプトの `実行` を見る → `実行` は押せず、`copilot へのプロンプトの送信には、まだ対応していません（ターミナルに直接入力してください）` が出る。`copilot` の入力欄には何も入らない
- [ ] **AGT-234** `copilot 1` が動いている間に、帯の `中断` にマウスを載せてから押す → `中断` は薄い色で、`copilot では中断のボタンを使えません（ターミナルで操作してください）` が出る。押しても `copilot` の画面は変わらない
- [ ] **AGT-235** `終了` で `copilot 1` を止めて帯を見る。`前回の続きから` にマウスを載せる → `前回の続きから` は押せず、`copilot では「前回の続きから」を使えません（設定で claude に戻すと使えます）` が出る
- [ ] **AGT-236** 実行の履歴に、今開いているテスト用のフォルダで `claude` に送って作ったエントリがあれば（この節の前の既存の項目で、今と同じテスト用のフォルダを開いて `claude` に送った履歴が残っていればそれでよい。別のフォルダで作ったエントリ・どのフォルダで作ったか分からないエントリは使わない〈`再実行` の理由が記録したフォルダの理由になるため〉。この節の項目では `claude` に送らない）開いて `このセッションで再開` と `再実行` を見る（無ければそのことを記録して次へ進む） → `このセッションで再開` は押せず `copilot では「このセッションで再開」を使えません（設定で claude に戻すと使えます）` が出る。`再実行` は押せず、AGT-233 と同じ理由が出る
- [ ] **AGT-237** テスト用のフォルダが Git リポジトリで `変更を確認` の記録を始められるなら、`起動` で `copilot 1` を起動し、`変更を確認` → `いまから記録する` で記録を始めて区別の状態の 1 行を見る（Git リポジトリでなければ、そのことを記録して次へ進む） → 区別できない旨と `使っているエージェント CLI が区別に対応していません（claude だけが対応しています）` が出る。記録の一覧は今までどおり開ける。確かめた後、`確認を終える` で記録を終える
- [ ] **AGT-238** `copilot 1` が動いていなければ `起動` で起動し（AGT-237 を行ったなら動いたままなので、そのまま使う）、`copilot` の入力欄が出るまで待つ。別の端末で `pgrep -f 'prompt-ide/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'` を実行し、このリポジトリの Electron の親のプロセスの pid を確かめる（ちょうど 1 つでなければ、何も止めずに出力を記録して終える）。`pgrep -P <その pid>` で子の pid を出し、子ごとに `lsof -a -d cwd -p <子の pid>` を実行して、作業ディレクトリ（`NAME` の列。macOS では先頭に `/private` が付いて出ることがあるので、その有無は無視して照合する）がテスト用のフォルダのものを選ぶ（AGT-224 と同じ）。当てはまる子がなければ、何も止めずに出力を記録して終える。あれば、その子の pid と、その子孫の pid（`pgrep -P <子の pid>` を、出なくなるまで繰り返す）をすべて控える。控えたら `終了` を押し、帯が変わってから、控えた pid ごとに `ps -p <pid>` を実行する（見るだけ。この手順では何も止めない） → 帯が `終了しました…` になる。控えた pid はどれも `ps -p` に出ない（アプリの `copilot` の子・子孫が残らない）。出た pid があれば、`ps -p <pid> -o pid,ppid,command` の出力を記録して次へ進む
- [ ] **AGT-239** `copilot 1` が止まっていれば `起動` で起動し直し、動いたままならそのまま使う。`+` で 2 つ目のタブを足して起動する → 2 つ目のタブの名前は `copilot 2` で、`copilot` が起動し、帯は `実行中`。`copilot 1` のタブを選ぶと帯は `実行中` のまま（帯は選んでいるタブの状態を出す）。確かめた後、`copilot 2` のタブを `×` で閉じ、確認 `copilot 2 のエージェントを終了してタブを閉じますか？` で `OK` を押す
- [ ] **AGT-240** `copilot 1` が動いている状態で、設定で `Claude Code（claude）` を選び、確認で `OK` を押し、注記が消えたことを見てから、サイドバーで「プロンプト」パネルに切り替えて `実行` の押せない理由を見て、`起動` を押す（設定とプロンプトは同時に開けない）→ `copilot 1` が終了し、選択が `Claude Code（claude）` に戻り、使えない機能の注記と通知の項目の注記が消える。`起動` を押す前は、タブの名前が `copilot 1` のままで、プロンプトの `実行` の押せない理由が `エージェントが起動していません（ターミナルの「起動」を押してください）` になる（copilot への送信の理由ではない）。起動するとタブの名前が `claude 1` になり、入力待ちになると帯が `入力待ち` に変わり、プロンプトの `実行` が押せる（今までどおり）。この項目で設定は元に戻る
- [ ] **AGT-241** 動いているタブがあれば `終了` で止めてから（確認を出さずに切り替えるため）設定を開き、`使うエージェント CLI` の節の選択肢をマウスで押さずに、`Tab` を押して `GitHub Copilot CLI（copilot）` にフォーカスリングが移るまで進め、`Space` を押す。選択が変わったら `Shift+Tab` を 1 回押して `Claude Code（claude）` へ戻り、`Space` を押す。最後に `Tab` を 1 回押す → `Space` を押した後も、フォーカスリングはそれぞれ押した選択肢に残り、選択（`aria-checked`）だけが `GitHub Copilot CLI（copilot）`→`Claude Code（claude）` と変わる。`Shift+Tab` は隣の `Claude Code（claude）` へ、最後の `Tab` は隣の `GitHub Copilot CLI（copilot）` へ移る（選択肢はどれも Tab で止まる通常のボタンなので、選択が変わってもフォーカスは選択肢の間を順に移る。どちらも文書の先頭〈サイドバーの最初のボタンなど〉からやり直しにならない）。この項目で設定は `Claude Code（claude）` に戻る
- [ ] **AGT-242** 動いているタブが無ければ帯の `起動` で `claude 1` を起動し、帯が `入力待ち` になるまで待つ（AGT-241 の後は止まっているので起動する。`claude` には何も送らない）。設定を開き、`使うエージェント CLI` の節で `GitHub Copilot CLI（copilot）` を選び、確認で `OK` を押した直後から、`使うエージェント CLI` の節とその上の `プロンプトの実行方式` の節の、選択肢の下を見る。VoiceOver を使う場合は、`GitHub Copilot CLI（copilot）` を選ぶ前に有効にしておき（停止までは短いため）、停止を待つ間に `Shift+Tab` と `Tab` で押した選択肢へ戻って読み上げを聞く（使わない場合は読み上げの確認を飛ばして、そのことを記録する）。停止が終わって選択が変わったら、`Claude Code（claude）` を選ぶ（動いているタブが無いので確認は出ない） → `claude 1` の停止を待つ間、両方の節の選択肢の下に `使うエージェント CLI を切り替えています` が出て、VoiceOver では押した選択肢の説明として読まれる（止まるのが速くて見えない場合は、そのことを記録して次へ進む）。`claude 1` が終了して選択が `GitHub Copilot CLI（copilot）` に変わると、両方の節からこの文言が消える。最後に選択が `Claude Code（claude）` に戻り、この項目で設定は `Claude Code（claude）` に戻る。VoiceOver を使った場合は、確かめた後に切る

追記したら `node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact（<manual-test-spec-artifact-url>）を同じファイルパス（`.superpowers/manual-test-spec.html`）で再公開する。`npx vitest run scripts` が通ること。

## ROADMAP の更新の方針

- 「エージェント実行の支援（MVP の次）」の `- [ ] \`claude\` 以外のエージェント CLI への対応（…）`（:559）は**未完了のまま**にし、下に次の 2 行を足す
  - `実装済み（<main に入れた日付>。段階 1。設計書 docs/superpowers/specs/2026-10-20-agent-cli-kind-foundation-design.md）: 使う CLI の設定（Claude Code / GitHub Copilot CLI。アプリ全体で 1 つ。既定は claude）と、選んだ CLI の起動。copilot はターミナルで直接操作する。実装済み機能の「使うエージェント CLI の切り替え（段階 1）」を参照`
  - `残り: copilot へのプロンプトの送信と画面の判定（作業中などの表示・通知・中断・自動の取り直し）＝段階 2、copilot の hooks による変更の区別・セッションの再開・起動の記録と履歴への CLI の種類の記録＝段階 3`
- 実装済み機能の末尾（`### エージェントの実行の中断` の後）に `### 使うエージェント CLI の切り替え（段階 1）` を足す。設計書へのリンク、設定（保存先・既定・切り替えで動いているタブを止める）、起動（main の表・`copilot` の引数と取り除く環境変数）、
  `copilot` で使えない機能と理由の出し方、既知の制約（この設計書の「既知の制約」と同じ）を書く
- 「MVP の対象外」の行（:530）は MVP の時点の範囲の記録なので変えない

## 既知の制約（ROADMAP・実機テスト仕様書に反映する）

- `copilot` では、プロンプトの送信（実行・再実行・送信前の確認）・作業中や入力待ちの表示・完了と許可待ちの通知・中断のボタン・変更の一覧の自動の取り直し・利用者の変更との区別・前回の続きから・このセッションで再開を使えない（段階 2・3）。ターミナルで直接操作する
- `copilot` の帯・タブ・ステータスバーは、動いている間ずっと `実行中` と出る（作業中か入力待ちかを判定しない）
- 使う CLI はアプリ全体で 1 つ。切り替えると動いているタブをすべて終了する（会話を失う。`claude` の会話は前回の続きからで再開できる）
- 設定の画面と入口の判定は、ウィンドウごとに起動したときに読んだ値を使う。別のウィンドウで切り替えると、このウィンドウの設定の画面・`起動` の名前・前回の続きからの理由は古い値のまま（次に起動したタブは main が読んだ新しい値で起動し、そのタブの名前と能力は起動の結果の種類に従う）。通常の使い方ではウィンドウは 1 つ
- 設定を読み込む前の一瞬、未起動のタブの名前は既定の `claude 1` と出て、読み込むと `copilot 1` に変わることがある
- `copilot` が見つかっても、pty に渡す PATH に Node.js 24 以上の `node` が無いと、起動の直後に終わる（ターミナルの表示と「起動の直後に終了しました」で分かる）。起動の前には確かめない
- `copilot` は GUI から起動したアプリでも、ログインシェル（`$SHELL -l -i`）の PATH に入っていれば見つかる。ログインシェルの設定で nvm を遅延読み込みにしている（`nvm` を呼ぶまで PATH に入れない）と見つからない
- 親の環境の `COPILOT_ALLOW_ALL` は取り除くので、アプリの中の `copilot` では全ツールの自動の許可が効かない（`copilot` の中の `/allow-all`・`/permissions` や設定 `defaultPermissionMode` は効く）。`COPILOT_GITHUB_TOKEN`・`GH_TOKEN`・`GITHUB_TOKEN` は取り除かないので、アプリを起動した環境にあれば `copilot` の認証に使われる
- `copilot` は既定で IDE のワークスペースへ自動で接続しようとし（`ide.autoConnect`）、端末のタイトルの書き換え（OSC 0/2）と進み具合（OSC 9;4）を出す。アプリはタイトルを使わず（MVP の方針）、OSC 9;4 は xterm が表示しない
- 起動の記録（`agent-sessions.json`）と履歴は `claude` のものだけ。`copilot` のセッションは残らない
- 中断の IPC は main で CLI の種類を見ない（renderer の判定で止める。同じバイトはターミナルのキー入力でも送れるため）
- 起動のたびの設定の読み込み（`getAgentCliKindSetting` の `readSettingsFile`）は、設定の書き込み（`writeSettingsFile`）の直列化のキューを通らない。書き込みはファイルを切り詰めてから書く（上書き）ので、ほかの設定（通知・送信前の確認・API キー・モデルなど）の保存と `起動` が重なると、空や途中までの内容を読んで `read-failed` になり、まれに設定と違う `claude` で起動する（タブの名前は `claude 1`。main のログに `設定ファイルを読めないため claude を使います`）。書き込みを一時ファイルと rename にする修正は別のタスクにした

## 次の段階の見通し

- **段階 0（調査。段階 2 の設計の前）**: 一時の `COPILOT_HOME`・`HOME` と `COPILOT_OFFLINE=true`・`COPILOT_PROVIDER_BASE_URL`（偽のローカルの提供元。`claude` の `exp3.js` と同じ考え）で、
  GitHub のサービスに接続せずに `copilot` の画面（起動直後・入力待ち・作業中・許可の確認・選択の画面・中断の後・キュー）を node-pty と `@xterm/headless` で記録する。bracketed paste の有効化、入力欄の形、
  `Esc`・`Ctrl+C`・`Ctrl+U` の効き方、`!` の扱い、10 行を超える貼り付けの畳み方（`compactPaste`）、`--screen-reader` の画面の違いを確かめる。記録できなければ、利用者が自分のアカウントで最小限の操作をして確かめる（L-059）
- **段階 2（送信と画面の判定）**: CLI ごとの送信の手順（`agentPasteText.ts`・`agentPromptSend.ts`・`agentInputBox.ts` を種類ごとの表に分ける）と、CLI ごとの画面の判定（`classifyAgentScreen` を種類ごとに）。
  `copilot` の `promptSend`・`screenActivity`・`interrupt` を `true` にし、通知の依頼と OS の通知の題に種類を足す。`claude` と書く文言（中断・通知）を CLI ごとにする
- **段階 3（hooks と再開）**: `copilot` の hooks（設定 `hooks`・`.github/hooks/*.json`）を 1 回の起動だけに効かせる方法を確かめ、`changeAttribution` を対応させる。`--session-id`（新しいセッションの UUID の指定）と `--resume` で
  `sessionResume` を対応させ、起動の記録・履歴に `cliKind` を足す（古い記録は `claude` として読む。L-456・L-459）。版で変わる能力が出たら、`copilot --version` の形（`GitHub Copilot CLI x.y.z.`）を読む関数を足す

## 構成

| ファイル                                                                                                                                                | 変更                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/agentCliKinds.ts`（新規）                                                                                                                   | `AgentCliKind`・`AGENT_CLI_KINDS`・`DEFAULT_AGENT_CLI_KIND`・`isAgentCliKind`・`AgentCliCapabilities`・`AgentCliProfile`・`AGENT_CLI_PROFILES`・`DEFAULT_AGENT_CLI_COMMAND_NAME`・`agentCliCapabilities` |
| `src/shared/types/agentTerminal.ts`                                                                                                                     | `resume-unsupported`・`AgentStartResult` の `cliKind` と `command-not-found` の組・`AgentSessionSnapshotEntry`                                                                                           |
| `src/shared/types/agentChanges.ts`                                                                                                                      | `AgentChangesAttributionLostReason` に `cli-unsupported`                                                                                                                                                 |
| `src/shared/types/settings.ts`                                                                                                                          | `AgentCliKindSetting`                                                                                                                                                                                    |
| `src/shared/types.ts`                                                                                                                                   | `AgentCliKind` の再 export（IPC の型に出る型だけ）                                                                                                                                                       |
| `src/shared/agentTabLabel.ts`・`src/shared/agentNotificationText.ts`                                                                                    | 種類から名前を作る・通知の題は `claude`                                                                                                                                                                  |
| `src/main/agentCliKindStore.ts`（新規）・`src/main/settingsFileStore.ts`                                                                                | 設定の読み書き・`SettingsFile.agentCliKind`                                                                                                                                                              |
| `src/main/handlers/settingsHandlers.ts`                                                                                                                 | `settings:getAgentCliKind`・`settings:setAgentCliKind`                                                                                                                                                   |
| `src/main/agentCliLaunchSpecs.ts`（新規）                                                                                                               | 種類ごとのコマンド名・引数・取り除く環境変数                                                                                                                                                             |
| `src/main/agentCommand.ts`                                                                                                                              | `resolveAgentLaunch` の `cliKind`・計画の `cliKind`・`buildAgentEnv` の追加の除外・`AGENT_COMMAND_NAME` と `buildAgentLaunchArgs` の移動                                                                 |
| `src/main/agentRuntime.ts`                                                                                                                              | `resolveAgentLaunchFromSystem` で設定を読む（テスト `__tests__/agentRuntime.test.ts` を新規に足す）                                                                                                      |
| `src/main/agentSessionStarter.ts`                                                                                                                       | 再開の拒否・会話の ID と予約と記録を能力で分ける・`sessionInfoOf`                                                                                                                                        |
| `src/main/agentSessionSnapshot.ts`                                                                                                                      | `attachClaudeSessionIds` を `attachSessionInfo` にし、状態の取得の要素に種類を載せる                                                                                                                     |
| `src/main/handlers/agentTerminalHandlers.ts`                                                                                                            | 状態の取得に種類を載せる                                                                                                                                                                                 |
| `src/main/ipcHandlers.ts`                                                                                                                               | starter の `sessionInfoOf` を受け口へ渡す（`claudeSessionIdOf` からの名前の変更）                                                                                                                        |
| `src/main/agentHookSessions.ts`・`src/main/agentToolActivity.ts`                                                                                        | `cli-unsupported`                                                                                                                                                                                        |
| `src/preload/api.ts`・`src/preload/index.d.ts`・`src/renderer/src/lib/settingsApi.ts`                                                                   | 設定の IPC の窓口                                                                                                                                                                                        |
| `src/renderer/src/hooks/useAgentCliKind.ts`（新規）                                                                                                     | 設定の hook                                                                                                                                                                                              |
| `src/renderer/src/components/settings/AgentCliKindSection.tsx`（新規）・`SettingsPanel.tsx`・`AgentNotificationSection.tsx`・`ExecutionModeSection.tsx` | 設定の画面・通知の注記・実行方式の選択肢の文言                                                                                                                                                           |
| `src/renderer/src/components/settings/BooleanSettingSection.tsx`                                                                                        | 省略できる `extraNote`（通知の注記を `p.settings-panel__note` で出し、チェックボックスの `aria-describedby` に説明と並べて含める。`AgentSendConfirmSection` は渡さない）                                 |
| `src/renderer/src/components/Sidebar.tsx`・`src/renderer/src/App.tsx`・`src/renderer/src/hooks/useAppState.ts`                                          | `agentCliKindPanel` を設定のパネルへ受け渡す                                                                                                                                                             |
| `src/renderer/src/types.ts`                                                                                                                             | `AgentCliKindPanelState`・`AgentNotificationPanelState` の `unsupportedNote`                                                                                                                             |
| `src/renderer/src/hooks/useAgentWorkspace.ts`                                                                                                           | 設定の保持・切り替え（確認・停止・保存）・入口への種類の受け渡し・`agentCliKindPanel`・通知の項目の注記（`agentNotificationPanel` の `unsupportedNote`）                                                 |
| `src/renderer/src/hooks/useAgentWorkspaceSwitching.ts`（新規）                                                                                          | 実行方式と使う CLI の切り替えの途中の値・再入防止・切り替えの途中に起動を受け付けない理由                                                                                                                |
| `src/renderer/src/hooks/useAgentSessions.ts`・`src/renderer/src/lib/agentSessionTabState.ts`                                                            | タブの `cliKind`・名前・`appCliKind`                                                                                                                                                                     |
| `src/renderer/src/hooks/useAgentActivity.ts`                                                                                                            | 判定を止める                                                                                                                                                                                             |
| `src/renderer/src/hooks/useAgentPromptSender.ts`・`src/renderer/src/lib/agentPromptSend.ts`                                                             | 送り先の型に `cliKind`・`beforeSend` の前の守り・`unsupported-cli`                                                                                                                                       |
| `src/renderer/src/hooks/useAgentSendConfirm.ts`                                                                                                         | 確認の送り先に、開いた時点のタブの `cliKind` を写す（`send` が送信に対応しない種類を断る判定に使う）                                                                                                     |
| `src/renderer/src/lib/agentSendMessages.ts`・`promptRunState.ts`                                                                                        | 実行・再実行の理由・`unsupported-cli` の文言（`AGENT_SEND_FAILURE_MESSAGES` から外して関数で引く）                                                                                                       |
| `src/renderer/src/lib/agentInterrupt.ts`・`agentInterruptMessages.ts`・`hooks/useAgentInterrupt.ts`                                                     | 中断の理由・`中断` に対応しない理由の文言                                                                                                                                                                |
| `src/renderer/src/lib/agentResumeAvailability.ts`・`hooks/useAgentResume.ts`                                                                            | 再開の理由                                                                                                                                                                                               |
| `src/renderer/src/lib/agentCliMessages.ts`（新規）・`agentSessionMessages.ts`・`agentChangesMessages.ts`                                                | 文言                                                                                                                                                                                                     |
| `src/renderer/src/components/agent/AgentTerminalPanel.tsx`                                                                                              | `起動`・`中断` の `aria-label`                                                                                                                                                                           |
| `docs/manual-test-spec.md`・`ROADMAP.md`                                                                                                                | 「実機テスト仕様書の新しい項目の下書き」・「ROADMAP の更新の方針」                                                                                                                                       |
| テスト                                                                                                                                                  | 「テスト方針」の各ファイル                                                                                                                                                                               |

## 実装の分割

1 つの実装プランで、次の順のタスクにする。

1. **shared の型と能力の表**: `agentCliKinds.ts`・`agentTerminal.ts`・`agentChanges.ts`・`settings.ts` の型と、そのテスト。型の変更で落ちる既存のテスト・呼び出し（`claudeSessionId` の `null`・`command-not-found` の組）を直す
2. **main の設定**: `agentCliKindStore.ts`・`settingsFileStore.ts`・`settingsHandlers.ts`・preload・`settingsApi.ts` とテスト
3. **main の起動**: `agentCliLaunchSpecs.ts`・`agentCommand.ts`・`agentRuntime.ts`・`agentSessionStarter.ts`・`agentTerminalHandlers.ts`・`agentHookSessions.ts`・`agentToolActivity.ts` とテスト、偽の実行ファイルの統合テスト
4. **renderer のタブと判定**: `useAgentSessions`（タブの種類・名前）・`agentTabLabel.ts`・`agentNotificationText.ts`・`useAgentActivity`（判定を止める）とテスト
5. **renderer の入口の理由**: 送信（`getPromptRunAvailability`・`useAgentPromptSender`）・中断・再開・区別の理由・文言（各入口の文言のファイル）とテスト
6. **renderer の設定と切り替え**: `useAgentCliKind`・`AgentCliKindSection`・`SettingsPanel`・通知の注記・実行方式の選択肢の文言・`useAgentWorkspace`（切り替え・受け渡し）とテスト、配線の変異の確認
7. **ROADMAP の更新・既知の制約・テスト仕様書と全体の検証**:
   - ROADMAP: 「ROADMAP の更新の方針」のとおり
   - 実機テスト仕様書: AGT-228〜240 を実装の文言と照らし合わせて確定して追記し、BASE-007 の期待結果を直す。`node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact を同じファイルパスで再公開する（コントローラーが行う）。`npx vitest run scripts` が通ること
   - 設計書の「既知の制約」を実装と照らし合わせ、食い違いがあれば直す
   - 全体の検証: `npm test`・`npm run typecheck`・変更したファイルへの `npx eslint`

main に入れた時点で利用者から見える挙動:

- 設定に `使うエージェント CLI` が増え、`Claude Code（claude）`（既定）と `GitHub Copilot CLI（copilot）` を選べる。`claude` のままなら今までと同じ
- `copilot` を選ぶとターミナルのタブで `copilot` が起動し（タブの名前は `copilot 1`）、ターミナルで直接操作できる。実行ボタン・中断・前回の続きから・このセッションで再開は押せず、理由が出る。帯は `実行中` のまま変わらず、通知は出ない

## 反映した知見（dev-flow-kit の review-lessons.md）

選び方: 優先度 A のチェックリストのうち、今回の変更（renderer から起動させる外部コマンドの選択・設定の保存と未知の値・能力による入口の制限・外部 CLI の実物の確認・テスト）に当たる項目の本文を読んだ。
優先度 A のデータ消失の項目のうち、記録・履歴の形を変える場合に当たるもの（L-456・L-459）は、次の段階の方針として反映した。実機の項目の書き方は優先度 B の L-072 に従った。

- L-001: 起動の再開の拒否は `resume-unsupported` を返して起動せず、設定の保存の失敗は `changeKind` が false を返して前の値に戻す。切り替えは `stopAll` が false なら保存しない（「main の起動」・「設定」）
- L-017: 設定の値が壊れていたときのログは値の先頭 80 文字だけ、設定ファイルを読めないときは例外の文言を出さず固定の文言にする（API キーの暗号文を含むファイルのため）。保存の拒否の文言に値を入れない（「設定」）
- L-018: main が設定から読んだ種類を起動の計画に入れ、探索・引数・環境変数・hooks・再開の可否・記録はその 1 つの値を使い、読み直さない。renderer のタブの能力は起動の結果の種類を使う（「決めたこと」・「main の起動」）
- L-019: 起動するコマンド・引数・取り除く環境変数は main の種類ごとの表で決め、renderer は起動の依頼に種類も名前も含めない。設定の保存は既知の種類の検証だけを通す（「決めたこと」・「main の起動」）
- L-029: 秘密（`GITHUB_TOKEN` など）を保存・ログに出さない。設定に保存するのは種類の名前だけで、環境変数の値はログに出さない（「設定」・「main の起動」）
- L-034: コマンド名は表の定数だけで、`-` で始まらない英小文字であることをテストで固定する。`copilot` の引数は空で、renderer の値を引数にしない（「型と能力の表」・「テスト方針」）
- L-041: `copilot` で使えない入口は、renderer の理由と処理の先頭の判定に加えて、再開は main でも `resume-unsupported` で断り、hooks は main の `prepare` で `cli-unsupported` にする（「main の起動」・「入口ごとの表」）
- L-043: `copilot --version` の出力（`GitHub Copilot CLI 1.0.87.` と 2 行目）は `claude` の版の読み方では読めないため、`copilot` の実行ファイルに `claude` の版の確認を通さない（「hooks」・「copilot の調べた事実」2）
- L-044: 設定の未知の値は `claude` に戻すが、ログと設定の画面で知らせる。保存では未知の値を拒否する。起動の引数の表は種類と能力に合わない値（`copilot` への会話の ID・`claude` への null）・未知の `launch.kind` を投げ、`command-not-found` の結果は種類を必須にする（「決めたこと」・「設定」・「main の起動」）
- L-052: 新しく待つ外部プロセスを足さない（`copilot` の版の確認をしない。ログインシェルの PATH の取得は今の 5 秒の打ち切りのまま）（「決めたこと」・「main の起動」）
- L-058: 使えない入口は見た目だけでなく処理の側で同じ純関数で止める（送信の `send`・中断の押した処理・再開の押した処理・切り替えの先頭）（「入口ごとの表」・「設定」）
- L-059: `copilot` の引数・環境変数・入力の方式を実物の `--help` で確かめ、確かめられない画面の挙動は段階 0 の記録に回した。node スクリプトの起動を、実物の node-pty と偽の `copilot`（`#!/usr/bin/env node`）の統合テストで確かめる（「copilot の調べた事実」・「テスト方針」）
- L-060: `appCliKind`・タブの `cliKind`・純関数の種類の引数・`agentCliKindPanel`・`buildAgentEnv` の除外の引数を必須にし、実物の組み立て役のテストと受け渡しを 1 つずつ外す変異の確認を入れる（「テスト方針」）
- L-061: 新しい状態（CLI に能力が無い）に対して、送信・中断・表示・通知・自動の取り直し・区別・再開・起動・停止・切り替えの入口を列挙して扱いを表にした（「入口ごとの表」）
- L-466: 設定は `useAgentWorkspace` の 1 つの state を設定の画面と入口が読み、選んだ値はすぐ反映する。main は起動のたびに設定を読むので、保存した値は次の起動から使われる。別のウィンドウの古い値は既知の制約にした（「設定」・「既知の制約」）
- L-456・L-459: 起動の記録・履歴に種類を足す段階 3 では、種類の無い古い記録を `claude` として読み、ID・日時を作り直さず、知らない欄を保つ（「記録と履歴」）
- L-072: 実機の項目は、ファイルを書き換える指示を含めず、`copilot` の実行ファイルの名前の変更や `settings.json` の手書きをさせない。プロセスは `pgrep` で見るだけで止めない。設定を変えた領域は最後の項目で `claude` に戻す。アカウントの操作は利用者が自分で行う前提を書いた（「実機テスト仕様書の新しい項目の下書き」）
