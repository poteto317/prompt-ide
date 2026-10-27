# claude 以外のエージェント CLI への対応 段階 3b（copilot の hooks によるエージェントの変更と利用者の変更の区別）設計書

- 日付: 2026-10-26
- ROADMAP の項目: 「エージェント実行の支援（MVP の次）」の「`claude` 以外のエージェント CLI への対応（起動コマンドの設定。入力欄の挙動が CLI ごとに違う点の吸収）」（`ROADMAP.md:644` 付近）の残り「copilot の hooks による変更の区別＝段階 3b」
- 前提の設計書: `2026-10-13-agent-changes-user-edit-distinction-design.md`（`claude` の hooks による区別。受け口・追跡・判定の区切り・文言）、`2026-10-20-agent-cli-kind-foundation-design.md`（段階 1。能力の表・起動の表）、
  `2026-10-21-agent-cli-copilot-screen-design.md`（段階 2a。`copilot` の画面の判定）、`2026-10-22-agent-cli-copilot-send-design.md`（段階 2b）、`2026-10-23-agent-cli-copilot-resume-design.md`（段階 3a。`copilot` の会話の ID と再開）
- 調査の結果: 段階 3 の調べもの `.claude/dev-flow/stage3-research.md` と、段階 3b-0 の記録 `.superpowers/agent-cli-kind/copilot-hooks-recorder/report.md`（生の記録は同じフォルダの `out/`）。
  記録は GitHub Copilot CLI 1.0.87 を、切り離した一時の `HOME`・`COPILOT_HOME`・偽のローカルの提供元で、GitHub のサービスに接続せずに 59 回起動して取った
- 実装は 1 つの実装プラン・1 つの PR にする（「実装の分割」）

## 目的

段階 3a までで、`copilot` のタブもプロンプトの送信・画面の判定・中断・再開に対応した。能力の表で `copilot` に残る `false` は `changeAttribution`（利用者の変更との区別）だけで、`copilot` を使っている間は次のようになる。

- 変更の一覧の区別の状態の 1 行が `利用者の変更を区別できません（使っているエージェント CLI が区別に対応していません（claude だけが対応しています））。すべてエージェントの変更として表示します` になり、`すべて戻す` は利用者の編集も戻す
- 設定の注記が `copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別`

この段階 3b では、アプリが起動する `copilot` に 1 回の起動だけに効く hooks を渡し、`claude` と同じ受け口・追跡・判定の区切りで、エージェントのツールが動いていない間の変更に `利用者の変更` の印を付ける。
`copilot` の hooks にはツールの呼び出しの ID が無いなど、`claude` と同じ精度にはならない点がある。違いは既知の制約と画面の表示で伝える。
`claude` を選んでいる間の挙動・受け口の応答・設定のファイル・文言は今までと同じにする。

## 決めたこと（利用者の確認済み）

2026-10-25〜26 に利用者が決めた。

| 項目                      | 決定                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 設計の根拠                | 実物の `copilot` の hooks を、切り離した環境で記録して設計した（記録の承認済み。`report.md`）                                                                                                                                                                                                              |
| 精度の違い                | `claude` と同じ精度で区別できない点があっても、できる範囲で入れる。違いは既知の制約と画面の表示で伝える                                                                                                                                                                                                    |
| トークンの置き場          | タブ（枠）ごとに、固定のプラグインのフォルダをアプリのデータのフォルダ（`userData`）に置く。起動のたびに、トークン入りの hooks の設定（権限 0600）を書き直す。トークンは環境変数に置かない。`~/.copilot/plugin-data/_direct/` に残る空のディレクトリは、タブの上限の数（4）までで止まる                    |
| localhost の http の hook | アプリから起動した `copilot` の環境に `COPILOT_HOOK_ALLOW_LOCALHOST=1` を足す。利用者自身の localhost の hook も動くようになる副作用は既知の制約に書く                                                                                                                                                     |
| 精度の違いを出す場所      | 3 か所で伝える。種類ごとの注記の表 `AGENT_CLI_ATTRIBUTION_PRECISION_NOTES: Record<AgentCliKind, string \| null>`（`claude` は `null`）を置き、`copilot` の注記を設定の画面・変更の一覧の区別の状態の 1 行・`すべて戻す` の確認に出す（2026-10-26。詳しくは「画面の表示と文言」の「精度の注記を出す場所」） |

## 決めたこと（推奨案で決めた事項）

| 項目                                  | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hooks の書き方                        | PascalCase のイベント名（`PreToolUse` など）を、`copilot` の平らな形（`{"version":1,"hooks":{"<イベント>":[{"type":"http",…}]}}`）で書く。camelCase は書かない（両方を書くと同じ出来事が 2 回届く）。理由は「渡す hooks」の「書き方の選択」                                                                                                                                                                                                                                                                                                                                                                |
| 渡すイベント                          | `UserPromptSubmit`・`PreToolUse`・`PostToolUse`・`PostToolUseFailure`・`Stop`・`SubagentStop`・`SessionEnd` の 7 つ（`claude` の 9 つから `PostToolBatch`・`StopFailure` を除いたもの。`copilot` に当たるものが無い）                                                                                                                                                                                                                                                                                                                                                                                      |
| 区間                                  | ツールの呼び出しの ID が無いので、すべて「ID を持たない CLI の区間」として、会話の ID（本文の `session_id`）ごとのグループで数える。バッチの終わり（猶予の始まり）は、ウィンドウのすべてのタブ・グループの開いた区間の合計が 0 に戻った時点とみなす（`PostToolBatch` の代わり。`afterMutation` のまま）。前のバッチの残りは、区間の数とは別に、同じグループの `tool-end` の後に届いた `tool-start` で閉じる。閉じる合図は「区間の規則」                                                                                                                                                                    |
| 閉じる合図に使わないもの              | 次の `UserPromptSubmit` と renderer の作業の終わりでは区間を閉じない。作業中に送ったプロンプトの `UserPromptSubmit` が届く時点を `copilot` では記録しておらず（`claude` では作業中にも届く）、画面の判定は揺れうるため、閉じると動いているツールの書き込みが利用者の変更になりうる（危険側）。中断（Esc）の後は、次のプロンプトで残った区間に「持ち越し」の印を付けるだけにし（区間は閉じない）、`claude` と同じく「次のターンの `Stop` まで開いたまま＋作業の終わりから 30 秒で保留」で受ける（「区間の規則」）                                                                                           |
| サブエージェント                      | 本文の `session_id` が、そのタブの「主の会話の ID」（起動に使った ID。`/clear` などの後は採り直す）と違う知らせを、その ID のサブエージェントのものとして扱う。サブエージェントの中の `Stop` はそのサブエージェントの区間を閉じるだけで、親のターンの終わりにしない。中の `UserPromptSubmit` は確かめにだけ使う                                                                                                                                                                                                                                                                                            |
| 受け口の応答                          | `copilot` 向けのパス（`/prompt-ide/agent-hooks/copilot/v1/…`）への要求には、照合の失敗・本文の不正・閉じた後・処理の例外でも常に 200 の空の本文を返す（`copilot` は preToolUse の 4xx・5xx・接続の失敗をツールの拒否にするため）。`{"permissionDecision":"allow"}` は返さない。`claude` 向けのパスの応答（401・404・415・503・500 など）は変えない                                                                                                                                                                                                                                                         |
| PreToolUse の待ちと timeoutSec        | 受け口の待ちの上限は今の 5 秒（`AGENT_PRE_TOOL_USE_WAIT_MS`）のまま。`copilot` の `PreToolUse` の `timeoutSec` は `claude` と同じ 10 秒（上限の 2 倍。`copilot` の打ち切りはツールの許可になるので、先に打ち切らせない）。ほかのイベントは 5 秒                                                                                                                                                                                                                                                                                                                                                            |
| ファイルのパスの扱い                  | 読まない。区別は今の `claude` と同じく「区間」と「判定の区切りの git の差分」で行い、`tool_input`（`apply_patch` のパッチの文字列・`create`・`edit` の `path`）は読まない                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| プラグインのフォルダの割り当て        | main 全体で 4 つの枠（`slot-1`〜`slot-4`）を持ち、起動の準備で空いている一番小さい番号を割り当て、その pty の終了で返す。動いている（止めている途中を含む）`copilot` が 4 つを使い切っていたら hooks なしで起動する（理由は今の `receiver-unavailable`）                                                                                                                                                                                                                                                                                                                                                   |
| `COPILOT_HOOK_ALLOW_LOCALHOST` の範囲 | 起動の表の `extraEnv` に足し、hooks を用意できなかった起動でも常に足す（起動の計画を hooks の準備の結果に依存させない。段階 3a の `COPILOT_DISABLE_RESUME_AUTO_CD` と同じ理由）                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 画面の文言の CLI の名前               | 区別の文言に出る CLI の名前（`claude の hooks から知らせが届きません` など）は、そのウィンドウの設定の種類（`appCliKind`）のコマンド名で作る。`claude` では今と 1 文字も変わらない。main の要約に種類を足さない。理由: 使う CLI の切り替えは動いているタブをすべて止めるので、区別している間のタブは設定の種類と同じで、食い違うのは記録の途中で切り替えたときの文言の名前だけ（既知の制約に書く）。main の要約に種類を持たせる案は、registry・記録・IPC の型と多くのテストの値を直す必要があり、この食い違いの小ささに見合わない（2026-10-26 にユーザーが推奨案を確かめた）。詳しくは「画面の表示と文言」 |
| 受け口が止まったときの扱い            | 待ち受けの後に受け口が止まった（`EMFILE` など）とき、動いている `copilot` のファイルを書くツールが拒否されることは既知の制約にとどめ、タブを起動し直すと直ることを書く。同じポートで待ち受け直す処理は足さない（「やらないこと」）。理由: 起こるのはまれ（ファイル記述子の枯渇など）で、待ち受け直しは `claude` の受け口の挙動も変える（今は次の起動で別のポートで始め直す）うえ、同じポートが取れる保証も無い（2026-10-26 にユーザーが推奨案を確かめた）                                                                                                                                                  |
| 版の確認                              | しない（L-052。段階 1〜3a と同じ）。記録した版は 1.0.87。最低限の版は既知の制約に書く                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| renderer から届く値                   | 新しい経路は作らない。プラグインのフォルダ・環境変数・引数・トークンはすべて main が決める（L-019）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 範囲

含めるもの:

- shared: 能力の表の `copilot` の `changeAttribution` を `true`
- main: `copilot` 向けの hooks の設定とプラグインのフォルダ（枠・原子的な書き直し・権限・終了時の扱い）、起動の引数 `--plugin-dir` と環境変数、受け口の `copilot` 向けのパスと応答の規則、`copilot` の入力の解釈と会話の ID の振り分け、ID を持たない CLI の区間の規則
- renderer: 区別の文言の CLI の名前、精度の注記（設定・区別の状態の 1 行・`すべて戻す` の確認）
- テスト（受け口・追跡・プラグインのフォルダを実物で組み立てる統合テストと、偽の `copilot` と実物の node-pty の統合テストを含む）、実機テスト仕様書・ROADMAP の更新

含めないもの: 「やらないこと」

## copilot の hooks（記録の要点）

`report.md` のうち、設計に使うもの（番号は記録の場面）。

| 問い                     | 1.0.87 の挙動                                                                                                                                                                                                                                        | 設計への影響                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1 回の起動だけに効かせる | `--plugin-dir <ディレクトリ>` で効く。マニフェスト（ルートの `plugin.json` など）が要る。確認の画面は増えない。プラグインのパスごとに `$COPILOT_HOME/plugin-data/_direct/<ハッシュ>/`（空）ができて残る。同じパスなら増えない                        | 枠ごとの固定のフォルダ（「プラグインのフォルダ」）        |
| 入力の欄                 | PascalCase は `hook_event_name`（`UserPromptSubmit`・`PreToolUse`・`PostToolUse`・`PostToolUseFailure`・`Stop`・`SubagentStop`・`SessionEnd` を生の記録で確かめた）・`session_id`・`tool_name`（`claude` の名前）・`agent_id`（`SubagentStop` だけ） | `claude` と同じ欄名で読める。ツールの呼び出しの ID は無い |
| ツールの名前             | ファイルを書くツールはモデルで変わる（`apply_patch`、または `create`・`edit`）。PascalCase では `Edit`・`Write`・`Bash` に寄せられる。`view`→`Read`、`task`→`Agent`                                                                                  | matcher と「知っている名前」の扱い（「渡す hooks」）      |
| http の hook             | 127.0.0.1 へは `COPILOT_HOOK_ALLOW_LOCALHOST=1` が必須（無いと preToolUse を含むファイルは丸ごと捨てられる）。`Authorization` の静的な値は付けられる。URL に環境変数は使えない                                                                       | 環境変数を足す。トークンはヘッダーの静的な値              |
| preToolUse の待ち        | ツールは応答を待つ。既定の打ち切りは 30 秒、`timeoutSec` で変えられる。打ち切りはツールの許可                                                                                                                                                        | 待ちの上限 5 秒・`timeoutSec` 10 秒                       |
| 失敗                     | preToolUse の 4xx・5xx・接続の拒否・切断はツールの拒否（`Denied by preToolUse hook from "<プラグイン名>" (hook errored)`）。空の 2xx・JSON でない 2xx は許可。ほかのイベントの失敗はツールに影響しない                                               | `copilot` 向けは常に 200 の空の本文                       |
| post 系が来ない場面      | 許可の確認で断った（60）・Esc（61）・実行中の中断（62）・preToolUse の hook の拒否（36・50）では postToolUse も postToolUseFailure も来ない。Esc・中断では `Stop` も来ない。モデルの失敗（63）は `errorOccurred` で `Stop` は来ない                  | 閉じる合図（「区間の規則」）                              |
| 並列の呼び出し           | 先に全部の preToolUse（呼び出しの順）→ 並列に実行 → 終わった順に postToolUse。全部の preToolUse が終わるまでどのツールも始まらない                                                                                                                   | 「次の preToolUse」をそのまま閉じる合図にできない         |
| サブエージェント（70）   | 中のツールの hook はサブエージェントの `session_id` で届く。中で `Stop` も届く。親の `SubagentStop.agent_id` がその ID                                                                                                                               | 会話の ID の振り分け                                      |
| 会話の区切り（90〜93）   | `--session-id <ID>`・`--resume=<ID>` の後は hook の ID がその ID。`--resume` の起動の約 0.5 秒後に別のランダムな ID の `SessionEnd` が来る。`/clear` で古い ID の `SessionEnd` → 次のプロンプトから新しい ID                                         | 主の会話の ID の採り直し                                  |
| 順序                     | どの hook も最初のプロンプトの後に初めて呼ばれる。コマンドの hook は 1 つずつ順に動く                                                                                                                                                                | 届きの確かめは今の規則のまま                              |

会話の区切りの行（`--session-id`・`--resume=` の後の ID、再開の直後の別の ID の `SessionEnd`、`/clear`）は、記録 `91`〜`93` では camelCase の hook だけで取った。PascalCase でも同じ `session_id` になるのは、記録 `02`・`70` で camelCase と PascalCase の ID が同じだったことからの推測で、実機の AGT-285・286 で確かめる。

記録できなかったこと（既知の制約に書く）: 信頼の確認の前・信頼を覚えたフォルダでのプラグインの hook、`plugin-data/_direct/<ハッシュ>` のハッシュの元、バックグラウンドのサブエージェント・`/cd` の後・シェルの detach・MCP のツールの hook、`apply_patch` の Delete・Move、http の hook の同時の要求の上限、Windows（`powershell` のツールの名前を含む）。

## 渡す hooks（`copilot` 向けの設定）

### 書き方の選択（PascalCase・平らな形）

| 観点               | PascalCase（採用）                                                                                                      | camelCase                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 本文のイベント名   | `hook_event_name` がある。パスのイベントと照らし合わせられる（L-023。`claude` の `readAgentHookBodyObject` と同じ規則） | 無い（`notification` を除く）。パスだけが頼り    |
| ツールの名前       | `Edit`・`Write`・`Bash` に寄る（モデルが `apply_patch` でも `create`・`edit` でも同じ名前）                             | `apply_patch`・`create`・`edit` とモデルで変わる |
| 欄名               | `session_id`・`tool_name`・`agent_id`（`claude` と同じ）                                                                | `sessionId`・`toolName`・`agentId`               |
| 使えないイベント   | `errorOccurred`（PascalCase の名前が無い。使わない。「区間の規則」）                                                    | 無い                                             |
| 将来の変更への強さ | 互換の層（1.0.21 から snake_case の入力、1.0.62 から `claude` のツールの名前）に依存する                                | `copilot` の本来の形                             |

`claude` の解釈と同じ欄・同じ照らし合わせで読めること、ツールの名前がモデルで揺れないことを重く見て PascalCase にした。両方を書くと同じ出来事が 2 回届く（区間を 2 つ開く）ので、片方だけにする。
形は `copilot` の平らな形にする。生の記録で http の hook と PascalCase の組（`21`）、平らな形の項目に付けた matcher（`80`）を確かめたのがこの形のため（入れ子の形の http の hook は記録していない）。

### 中身

`buildCopilotHookConfig({ baseUrl, token })`（純粋な関数。新しい `src/main/agentCopilotHookConfig.ts`。書き込みは下の「プラグインのフォルダ」）が次の形を作る。

```json
{
  "version": 1,
  "hooks": {
    "UserPromptSubmit": [
      {
        "type": "http",
        "url": "http://127.0.0.1:<port>/prompt-ide/agent-hooks/copilot/v1/user-prompt-submit",
        "headers": { "Authorization": "Bearer <64 桁の 16 進>" },
        "timeoutSec": 5
      }
    ],
    "PreToolUse": [
      {
        "type": "http",
        "url": "…/copilot/v1/pre-tool-use",
        "headers": { "Authorization": "Bearer <…>" },
        "timeoutSec": 10,
        "matcher": "<COPILOT_HOOK_TOOL_MATCHER>"
      }
    ]
  }
}
```

（`PostToolUse`・`PostToolUseFailure` は `PreToolUse` と同じく matcher 付きで `timeoutSec: 5`、`Stop`・`SubagentStop`・`SessionEnd` は matcher なしで `timeoutSec: 5`。）

- パスの最後の段は `claude` と同じ表（`AGENT_HOOK_EVENT_PATH_SEGMENTS`）を使い、前の部分だけを `copilot` 用（`/prompt-ide/agent-hooks/copilot/v1/`）にする。`claude` のパス（`/prompt-ide/agent-hooks/v1/`）とは重ならない
- matcher `COPILOT_HOOK_TOOL_MATCHER` は `Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|bash|powershell|apply_patch|create|edit`。記録の `80` で確かめた組（`claude` の名前と `copilot` の名前を並べたもの）に、記録していない Windows の `powershell` を足した（並べた名前が増えるだけで害は無い）。読むだけのツール（`view`・`rg`・`glob`）とサブエージェントの呼び出し（`task`）は数えない（`claude` で `Read`・`Agent` を数えないのと同じ）
- 「知っているツールの名前」`COPILOT_HOOK_TOOL_NAMES` は matcher と同じ名前の並び（`claude` の `AGENT_HOOK_TOOL_NAMES` に `copilot` の名前を足したもの）
- `onFailure` に当たる欄・`allowedEnvVars`・`env` は書かない。URL・ヘッダーに環境変数を使わない（トークンを環境変数に置かない）
- 書く値は main の値だけ（受け口のポート・トークン）。JSON は `JSON.stringify` で作る（文字列の連結で作らない）

## プラグインのフォルダ（`src/main/agentCopilotHookPlugin.ts`）

### 置き場と形

```
<userData>/agent-hooks-copilot/           0700
  slot-1/                                 0700  ← --plugin-dir に渡すパス
    plugin.json                           0600  {"name":"prompt-ide-agent-hooks","version":"1.0.0","description":"…"}
    hooks/                                0700
      hooks.json                          0600  トークン入り（起動のたびに書き直す）
  slot-2/ … slot-4/
```

- マニフェストは記録の最小の形（`name`・`version`・`description`）をルートの `plugin.json` に置く（記録の `copilot-root` の形）。`name` は `copilot` の拒否の文言（`Denied by preToolUse hook from "<name>"`）と `/env` に出るので、アプリのものと分かる `prompt-ide-agent-hooks` にする。`description` は `prompt-ide がエージェントの変更の区別に使う hooks（アプリが起動した copilot だけに渡します）`
- 利用者のリポジトリ（`.github/hooks/`）・`~/.copilot/hooks/`・`~/.copilot/config.json` には書かない
- 枠の数は `AGENT_MAX_SESSIONS_PER_WINDOW`（4）。フォルダのパスが枠ごとに固定なので、`copilot` が作る `~/.copilot/plugin-data/_direct/<ハッシュ>/` は 4 つまでで止まる（同じパスなら増えないことは記録で確かめた）

### 枠の割り当て（`createCopilotHookPluginSlots` が返すオブジェクトの `acquire`・`release`）

- main 全体で 1 つ。`acquire()` は空いている一番小さい番号を返し、空きが無ければ `null`。`release(slot)` で返す
- 準備（`agentHookSessions.prepare`）で取り、その pty の `exited` の解決（`release(prepared, sessionId)`）で返す。起動しなかったとき（取り消し・ID の選択の拒否・spawn の失敗）は starter の `finally` の `release(prepared, null)` で返す（今の設定のファイルの後始末と同じ経路。L-004・L-010）
- 止めている途中の `copilot` も枠を持ったまま（registry もウィンドウの上限に数えている）。前の持ち主が生きている間にフォルダを書き直すと、まだ読みうる `copilot` に新しいトークンを読ませることになるため、終わるまで返さない（L-403: 枠・トークン・追跡のセッションを同じ寿命で外す）
- ウィンドウは同時に 1 つだが、閉じたウィンドウの `copilot` が止まりきる前に新しいウィンドウで 4 つ起動するなどで空きが無いときは、hooks なしで起動する（`receiver-unavailable`。区別の状態の文言は `hooks の知らせの受け口を用意できませんでした`）

### 書き直し（同じオブジェクトの `write(slot, config)`）

起動のたびに、`hooks.json` を書き直す。

1. 枠のフォルダとその親・`hooks/` を `lstat` で確かめる。シンボリックリンクでないディレクトリで、Windows 以外は自分の持ち物かつ `mode & 0o077 === 0` のものだけを使う（`isOwnPrivateDirStat` を使う。L-437）。違えば、そのパスを消して（シンボリックリンクならリンクだけを消す。`rm` はリンク先を辿らない）`0700` で作り直す。無ければ `0700` で作る。作るときに `EEXIST` なら（別の `prepare` が先に作った）、`lstat` し直して同じ確かめをする。親（`agent-hooks-copilot/`）の確かめに外れたときは親を作り直さず、その準備を `receiver-unavailable` にする（作り直すと、動いているほかの枠の `hooks.json` まで消すため。L-004）
2. `plugin.json` を、無いか中身が違うときだけ下の 3 と同じ手順で書く
3. `hooks/` に短い乱数の一時の名前（`.<16 進 16 桁>.tmp`）を `wx`・`0600` で作って書き、`sync` して閉じてから `hooks.json` へ `rename` する（原子的な置き換え。`settingsFileStore.ts` の書き込みと同じ手順。L-014・L-082）。途中で失敗したら自分が作った一時ファイルだけを消す（`EEXIST` のときは消さない。L-004）
4. どこかで失敗したら例外を投げ、`prepare` が `receiver-unavailable` に読み替える（ログにだけ出す。トークンは文言に入らない。パスは利用者名を含みうるので画面には出さない。L-017）

- 書き直しの間、その枠のフォルダを読む `copilot` はいない（枠を持つのは 1 つの起動だけ）
- フォルダは消さない。消して作り直すと、`_direct/<ハッシュ>` のハッシュの元（記録できなかった）が inode などだった場合に空のディレクトリが増えうるため、パスと実体を保つ（作り直すのは 1 の確かめに外れたときだけ）

### アプリの終了

- `will-quit` で、すべての枠の `hooks/hooks.json` を同期で消す（失敗はパスだけをログに出して続ける。L-010）。フォルダと `plugin.json` は残す（上の理由）
- `removeTokenFilesSync()` の後は `acquire` を `null`、書き直しを reject にする。書き直しの最中に来たときは、書き終えた `hooks.json` をその場で消す（今の `createAgentHookSettingsDir` の `closed` と同じ形。L-435）
- pty の終了では `hooks.json` を消さない（消すのと次の持ち主の書き直しが競るため）。残ったファイルのトークンは受け口の表から外れていて使えず、次の起動の前に必ず書き直す
- 異常終了で残った `hooks.json` も同じく、次の起動の前に書き直す

## 起動の引数と環境変数（`agentCliLaunchSpecs.ts`）

| 種類      | `new`                                          | `resume`                                   |
| --------- | ---------------------------------------------- | ------------------------------------------ |
| `claude`  | `--session-id <ID>`（＋`--settings <パス>`）   | `--resume <ID>`（＋`--settings <パス>`）   |
| `copilot` | `--session-id <ID>`（＋`--plugin-dir <パス>`） | `--resume=<ID>`（＋`--plugin-dir <パス>`） |

- `buildArgs` の 3 つ目の引数の名前を `hookSettingsPath` から `hookConfigPath` に変える（`claude` は設定のファイル、`copilot` はプラグインのフォルダ）。`claude` の引数は今のまま
- `buildCopilotArgs` は `hookConfigPath` を受け付け、`--plugin-dir` と値の 2 つの要素を後ろに足す。値が絶対パスでなければ固定の文言で投げる（`copilot の起動の hooks のフォルダのパスが正しくありません`。値を文言に入れない。L-017・L-034。main の値しか来ない想定の最後の守り）
- `extraEnv` を `{ COPILOT_DISABLE_RESUME_AUTO_CD: '1', COPILOT_HOOK_ALLOW_LOCALHOST: '1' }` にする（取り除く一覧の後に足し、Windows の大文字小文字の重複を取り除く今の `buildAgentEnv` の規則のまま。L-079）
- `NO_PROXY`・`no_proxy` への `127.0.0.1`・`localhost` の追加は今の `buildAgentEnv` がすべての種類に行っている（記録もこの形の環境で取った）。変えない

## 受け口（`agentHookReceiver.ts`・`agentHookReceiverRequest.ts`・`agentHookProtocol.ts`）

### 経路

- `agentHookRouteOfPath(path)` が `{ cliKind: 'claude'; event } | { cliKind: 'copilot'; event } | null` を返す（`claude` の 9 つ・`copilot` の 7 つのパスのどれかに完全一致）。`copilot` の前の部分で始まるが一致しないパスは「`copilot` の経路の不明なパス」として扱う
- トークンの表の持ち主 `AgentHookOwner` に CLI の種類と、`copilot` では主の会話の ID の状態（「入力の解釈と会話の ID の振り分け」）を持たせる: `{ ownerId; sessionId; cli: { kind: 'claude' } | { kind: 'copilot'; main: CopilotMainSession } }`
- 経路の種類と持ち主の種類が違えば、トークンの照合の失敗として扱う（`claude` の経路なら今どおり 401）
- `checkAgentHookRequest` の `accepted` は `event` の代わりに `route`（`agentHookRouteOfPath` の結果）を返す。`rejected` の形（`kind`・`status`・`reason`）は変えず、`copilot` の経路（`isCopilotHookPath` が真のパス）では拒むときの `status` を 200 にする。ログのラベルの `読めない知らせ` は `copilot` でも同じ（分けるのは `拒んだ要求（copilot）` だけ）

### 応答の規則

| 場面                                                           | `claude` の経路（今のまま） | `copilot` の経路 |
| -------------------------------------------------------------- | --------------------------- | ---------------- |
| メソッド・Host・Origin・トークン・Content-Type の照合の失敗    | 405・403・401・415          | 200（空の本文）  |
| 不明なパス                                                     | 404                         | 200              |
| 本文が大きすぎる・読めない                                     | 200（ID なしの知らせ）      | 200（下の解釈）  |
| 閉じた後に残った接続の要求                                     | 503                         | 200              |
| 処理の例外                                                     | 500                         | 200              |
| PreToolUse の待ち（上限 5 秒。打ち切りは割り当てない区間の印） | 200                         | 200              |

- `copilot` の経路で拒んだ要求も、理由ごとの件数をログに出す（ラベル `拒んだ要求（copilot）`。`claude` のラベルと件数は今のまま）。本文・トークンは出さない
- 200 の空の本文は、記録の `47`（204 の空）・`49`（JSON でない 200）と同じく `copilot` が許可として扱う。`{"permissionDecision":"allow"}` を返すと利用者の許可の確認を飛ばしうるので返さない
- 終了の順序は変えない: `before-quit` でセッションを止め終わる（上限 6 秒）→ `will-quit` で受け口を閉じる。止まりきる前の `copilot` の要求は受け口に届く。上限を過ぎても残った `copilot` が新しい接続を張ると拒否されるが、そのプロセスはアプリの終了で止まる（既知の制約）
- 待ち受けの後に受け口が止まった（`EMFILE` など）とき、今は次の `ensureListening` で別のポートで始め直す。動いている `copilot` は古いポートを指したままなので、ファイルを書くツールが接続の拒否で拒否される（既知の制約。同じポートでの待ち受け直しは「やらないこと」）

## 入力の解釈と会話の ID の振り分け（新しい `src/main/agentCopilotHookEvents.ts`。純粋な関数）

### 解釈（`parseCopilotHookRequest(event, body)`）

- 本文の読み方は `claude` と同じ（16 MiB の上限・JSON のオブジェクト・`hook_event_name` とパスのイベントの照らし合わせ）
- 使う欄は `hook_event_name`・`session_id`・`tool_name`・`agent_id`（`SubagentStop` だけ）。`tool_input`・`cwd`・`transcript_path`・`prompt`・`tool_result` は読まない
- `session_id`・`agent_id` は 1〜256 文字の文字列だけを読み、それ以外は「読めない」（L-044）
- 結果 `CopilotHookNotice`: `prompt`・`tool-start`・`tool-end`・`stop`・`subagent-stop`（`agentId`）・`session-end`・`confirm-only`（理由）。どれも読めた `session_id`（無ければ `null`）を持つ
- 本文を読めないとき: `PreToolUse` は `session_id` なしの `tool-start`（区間を開く側に倒す。L-002）、ほかは `confirm-only`（区間を閉じる根拠にしない。L-044）
- 知らない `tool_name`: `PreToolUse` は開く（L-002）、`PostToolUse*` は `confirm-only`（`unknown-tool-end`）

### 振り分け（`resolveCopilotHookNotice(main, notice)`）

主の会話の ID の状態 `CopilotMainSession = { kind: 'known'; id } | { kind: 'awaiting' }`。初めは起動に使った会話の ID（`--session-id`・`--resume=` に渡した小文字の UUID。記録 `93`・`92`）で `known`。主の ID の `SessionEnd` で `awaiting` になり、次の主のプロンプトの ID で `known` に戻る。`agent_id` が主の ID と同じ `SubagentStop`（主のプロンプトの知らせが届かずにサブエージェントの ID を採っていた）では、その `session_id`（親の会話の ID）で `known` に採り直し、読めない・`agent_id` と同じなら `awaiting` になる（下の注記）。
結果は追跡に渡す `AgentHookEvent`（今の型）と次の状態。受け口は本文を読み終えた後、await を挟まずに `interpretAgentHookRequest`（`agentHookInterpretation.ts`）で「状態を読む → 振り分け → 状態を書く」を行い、`deliver` する。

**列を選ぶ順（1 通りに決める）**: (1) `session_id` を読めなければ、状態にかかわらず「読めない」の列に従い、状態は変えない（`awaiting` のまま）。(2) 読めて、状態が `awaiting` なら「`awaiting`」の列に従う。(3) 読めて、状態が `known` なら、主の ID と同じかどうかで 1 列目か 2 列目に従う。`subagent-stop` だけは本文の `agent_id` で決まり、`session_id` と状態を見ない（下の注記）。読めない ID を区間を閉じる根拠・主の ID の採り直しの根拠にしない向き（L-044）に合わせた順。

| 知らせ        | (3) 主の ID と同じ                      | (3) 主の ID と違う（サブエージェント）                                                   | (1) `session_id` を読めない               | (2) 読めて、状態が `awaiting`                                          |
| ------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| `prompt`      | `confirm-only`（`prompt-submit`）       | `confirm-only`（`subagent-prompt`）                                                      | `confirm-only`（`session-id-unreadable`） | その ID を主の ID にして `known` へ。`confirm-only`（`prompt-submit`） |
| `tool-start`  | ID を持たない区間を開く（グループは主） | ID を持たない区間を開く（グループはその ID）                                             | 主のグループで開く（L-002）               | 主のグループで開く                                                     |
| `tool-end`    | 主のグループの一番古い区間を閉じる      | そのグループの一番古い区間を閉じる                                                       | `confirm-only`（`session-id-unreadable`） | 主のグループで閉じる                                                   |
| `stop`        | `turn-end`（親のターンの終わり）        | `subagent-stop`（そのグループを閉じる。親のターンにしない）                              | `confirm-only`（`session-id-unreadable`） | `confirm-only`（`stop-while-awaiting`）                                |
| `session-end` | `session-end`、状態を `awaiting` へ     | `confirm-only`（`other-session-end`。`--resume` の直後の別の ID の `SessionEnd` はここ） | `confirm-only`（`session-id-unreadable`） | `confirm-only`（`other-session-end`）                                  |

- `subagent-stop`（親の `SubagentStop`）: 本文の `agent_id` を読めて、状態が `known` でその ID が主の ID と違えば、`agent_id` のグループを閉じる（`subagent-stop`）。主の ID と同じなら、`awaiting` の間に主のプロンプトの知らせが届かず、サブエージェントのプロンプトの ID を主として採っていた（記録 `70` ではサブエージェントの中でも `UserPromptSubmit` が届く）と分かるので、本文の `session_id`（記録 `70` では親の会話の ID）を読めればその ID を主にして `known` のまま、読めない・`agent_id` と同じなら `awaiting` に戻して次の主のプロンプトで採り直す（`confirm-only`〈`main-was-subagent`〉。区間は閉じない。`awaiting` に戻さずに親を採るのは、並列で動いているほかのサブエージェントのグループを、その `Stop`・`SubagentStop` で閉じ続け、そのターンの主の `Stop` をターンの終わりにするため。入れ子で孫の ID を採っていたときは、孫・子の `SubagentStop` で子・主とたどる。起動に使った ID のままの主の ID が `agent_id` になることは記録に無い）。状態が `awaiting` のときは `confirm-only`（`subagent-stop-unmatched`。L-044）。`agent_id` が無い・形が違うときは、解釈の `confirm-only`（`subagent-stop-without-agent`・`bad-agent-id`）
- `/clear`・`copilot` の中の `/new`・`/resume`: 主の ID の `SessionEnd` で `awaiting` になり、次の主のプロンプトの ID を採る（記録 `91`）。採り直しは追跡の中だけで、起動の記録・履歴の ID は変えない（段階 3a の既知の制約のまま）
- どの結果も照合の通った知らせなので、追跡は受け取ったら hooks が効いていると確かめる（今の `confirm`）

## 区間の規則（`agentToolIntervals.ts`。ID を持たない CLI の区間）

`AgentHookEvent` の `ToolIdRead` に `{ kind: 'none' }`（その CLI はツールの呼び出しの ID を持たない）を足す。`claude` の `unreadable`（読めなかった）とは分ける。`claude` の解釈は `none` を作らない。

区間の状態に次を足す。

- `idlessOpen: IdlessInterval[]`（`openedAt`・`expired`・`group: string | null`〈`null` は主〉・`carried: boolean`〈前のターンからの持ち越し。主のグループだけに付く〉）
- `idlessEndedGroups: Set<string | null>`（バッチの区切りを待つグループ（`tool-end` で入り、次の `tool-start` で前のバッチの残りを閉じて外れる。入れる・外す時点は下の表と、表の後の段落の 5 つの時点））

| 知らせ                                   | 規則                                                                                                                                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool-start`（`none`、グループ g）       | g が `idlessEndedGroups` にあれば、g の持ち越しでない区間をすべて閉じ（前のバッチの残り。持ち越しの区間は閉じない）、g を集合から外す。そのあと持ち越しでない区間を 1 つ開く。上限（256）を超えたら今の `overflowed`   |
| `tool-end`（`none`、グループ g）         | g の持ち越しでない一番古い区間を 1 つ閉じ、g を集合に入れる。持ち越しでない区間が無ければ何も閉じない（持ち越しの区間・ほかのグループを閉じない。L-044。集合には入れる）                                               |
| `confirm-only`（理由が `prompt-submit`） | 区間は閉じない。主のグループで開いている区間すべてに持ち越しの印を付け、主（`null`）を集合から外す（前のターンの残り〈中断したツールなど〉を、新しいターンのバッチの区切り・数の消費で閉じないため。下の「中断の後」） |
| `confirm-only`（ほかの理由）             | 何もしない（今のまま）                                                                                                                                                                                                 |
| `turn-end`                               | 主のグループの区間をすべて閉じ、主を集合から外す（区間は今の「ID があって `agent_id` の無い区間」の規則に足す）                                                                                                        |
| `subagent-stop`（X）                     | グループ X の区間をすべて閉じ、X を集合から外す（区間は今の `agent_id` の規則に足す）                                                                                                                                  |
| `session-end`                            | すべて閉じ、集合を空にする（今の規則に足す）                                                                                                                                                                           |

集合から外すのは、上の表の `tool-start`（g）・`prompt-submit`（主）・`turn-end`（主）・`subagent-stop`（X）・`session-end`（すべて）の 5 つの時点だけ。`claude` の解釈も `UserPromptSubmit` を `confirm-only`（`prompt-submit`）にするが、`claude` では集合が常に空なので変わらない。 持ち越しの印は付けたら外さず、持ち越しの区間は `turn-end`（主）・`session-end`・pty の終了だけで閉じる。開いた区間の数・期限切れ・割り当てられない区間の判定には、今どおり含める。

- 開いた区間の数（`openCountOf`）・期限切れ（`openIntervalsOf`）・割り当てられない区間の判定に `idlessOpen` を含める。数が 0 に戻った時点から今の 2 秒の猶予を数える（`afterMutation` のまま。これがバッチの終わり）
- **次の `tool-start` を、そのまま閉じる合図にしない理由**: 並列の呼び出しでは、全部の `PreToolUse` が先に続けて届く（記録 `02`・`38`）。そのため「同じグループで、前の `tool-start` の後に `tool-end` を受けてから届いた `tool-start`」だけを新しいバッチの始まりとみなし、前のバッチの残り（許可の確認で断った・hook が拒否したツールの区間）を閉じる。`copilot` は 1 つのバッチの結果がそろうまで次のモデルの要求を出さないので、新しいバッチの `tool-start` の時点で、同じターンの前のバッチのツールは動いていない（前のターンの残りは持ち越しの印で対象から外す）
- 続けて呼んだツールの間で断った場合（断ったツールの次のツールの `PreToolUse` が、間に `tool-end` を挟まずに届く）は閉じず、そのターンの `Stop` まで残る（エージェントの区間のまま。安全側）。数で数えるので、残った区間がどれかは問わない
- 中断（Esc）・許可の確認での Esc・実行中の中断: `Stop` も post 系も来ないので、主の区間は開いたまま残る。次のターンの `UserPromptSubmit`（`prompt-submit`）で持ち越しの印が付き、そのターンのバッチの区切り（`tool-start`）でも、ツールの終わりの数の消費（`tool-end`）でも閉じず、次のターンの `Stop`（`turn-end`）か `SessionEnd`・pty の終了で閉じる。作業の終わりから 30 秒で今の保留（`unassignable`）になり、次の知らせで解ける。`claude` の中断（ID のある区間を `Stop` まで閉じない）と同じ結果になる。次のターンの `UserPromptSubmit` の知らせが届かない（読めない・hook が失敗した）と持ち越しの印が付かず、次のターンのツールの終わりの数の消費・次のバッチの区切りで閉じうる（既知の制約）
- モデルの呼び出しの失敗（`errorOccurred`）は渡さない（PascalCase の名前が無く、`recoverable` の扱いも記録していない）。`Stop` が来ないので、上と同じく 30 秒で保留になる
- サブエージェントのグループは、その中の `Stop`・親の `SubagentStop`・`SessionEnd`・pty の終了・グループの中の新しいバッチでだけ閉じる。主の `Stop` では閉じない（`claude` の「背景のサブエージェントは `Stop` の後も動くので `agent_id` のある区間を閉じない」と同じ。`copilot` にも `write_agent`・`read_agent` など背景のエージェントのツールがある）。閉じないまま 15 分を超えたら今の期限切れ（割り当てられない区間）になる。集合のサブエージェントの ID は、そのグループの `subagent-stop`・`session-end` で外れるので、使い捨ての ID が溜まり続けない（`SubagentStop` も中の `Stop` も届かなかったサブエージェントの ID だけが、`session-end`・pty の終了まで残る）
- `claude` の規則は変えない（`claude` は `none` を作らないので `idlessOpen` は常に空）

### 記録の場面を規則に当てはめた結果

主のグループの開いた区間を `{…}`（`*` は持ち越し）、集合を `E` で書く。どの場面も、そのターンの終わり（`Stop`）より前に、動いているツールの区間を閉じない（知らせが届かなかった場合の行を除く）。

| 場面（記録）                                                                                 | 知らせの並びと規則での流れ                                                                                                                                                                                                                                                                                                                                                                                                             | 結果                                                                                                                                         |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 並列（`02`）                                                                                 | pre A `{A}` → pre B `{A,B}` → post B `{1}`・E={主} → post A `{}`（猶予の後 `idle`）→ 次のバッチの pre C で E から主を外す（閉じる区間は無い）→ … → `Stop`                                                                                                                                                                                                                                                                              | バッチの終わりで `idle` に戻る                                                                                                               |
| 断った・同じバッチ（`60` を並列にした形）                                                    | pre A → pre B（断る）→ post A `{1}`・E={主} → 次のバッチの pre C で残り（B）を閉じて `{C}`                                                                                                                                                                                                                                                                                                                                             | B は動いていないので閉じてよい                                                                                                               |
| 断った・続けて呼ぶ（`60`）                                                                   | pre A（断る）`{A}` → pre B `{A,B}`（E に主が無いので閉じない）→ post B `{1}` → `Stop` で `{}`                                                                                                                                                                                                                                                                                                                                          | そのターンの終わりまで `agent`（既知の制約）                                                                                                 |
| preToolUse の hook の拒否（`36`・`50`）                                                      | 断った場合と同じ                                                                                                                                                                                                                                                                                                                                                                                                                       | 同じ                                                                                                                                         |
| Esc・中断（`61`・`62`）                                                                      | pre B `{B}` → Esc（post・`Stop` なし。30 秒で保留）→ 次のターン: `prompt-submit` `{B*}`・E から主を外す → pre C `{B*,C}` → post C `{B*}`・E={主} → pre D（持ち越しは閉じない）`{B*,D}` → post D `{B*}` → `Stop` で `{}`                                                                                                                                                                                                                | B は次のターンの `Stop` まで開いたまま（`claude` と同じ）                                                                                    |
| 並列の途中の中断                                                                             | pre A → pre B → post A `{1}`・E={主} → Esc → `prompt-submit` `{1*}`・E={} → pre C（閉じない）→ post C（持ち越しを消費しない）→ pre D（持ち越しは閉じない）→ … → `Stop` で `{}`                                                                                                                                                                                                                                                         | 同じ                                                                                                                                         |
| サブエージェント（`70`）                                                                     | 主の `task` は matcher の外なので数えない → 中の `prompt` は `subagent-prompt`（主に触れない）→ 中の pre・post はグループ X → 中の `Stop` は `subagent-stop`（X）で X を閉じて E から外す → 親の `SubagentStop` は X に区間が無い → 主の `Stop` は `turn-end`                                                                                                                                                                          | 中の `Stop` を親のターンの終わりにしない。X は E に残らない                                                                                  |
| `/clear`（`91`）                                                                             | 主の `SessionEnd` は `session-end`（すべて閉じ、E を空にし、`awaiting`）→ 新しい ID の `prompt` で採り直して `known`・`prompt-submit`（持ち越す区間は無い）→ 以後その ID が主                                                                                                                                                                                                                                                          | 新しい ID の `Stop` が `turn-end` になる                                                                                                     |
| `--resume`（`92`）                                                                           | 主は再開した ID で `known`。約 0.5 秒後の別の ID の `SessionEnd` は `other-session-end`（区間・E・状態に触れず、確かめにだけ使う）                                                                                                                                                                                                                                                                                                     | 区間を閉じない                                                                                                                               |
| 主のプロンプトの知らせが届かない・サブエージェントあり（記録なし。知らせが届かなかった場合） | `awaiting` で主の pre A `{A}` → 中の `prompt` をその ID の主のプロンプトとして採る（`prompt-submit` `{A*}`）→ 中の pre・post は主のグループ（持ち越しの A は閉じない）→ 中の `Stop` は `turn-end` で `{}`（A が動いていても閉じる）→ 親の `SubagentStop` の `agent_id` が採った ID と同じなので `main-was-subagent`（その `session_id` の親の ID で `known`）→ 主の post は主のグループ（閉じる区間は無い）→ 主の `Stop` は `turn-end` | A が早く閉じうる（既知の制約）。そのターンのうちに主に戻る（並列のほかのサブエージェントのグループは、その `Stop`・`SubagentStop` で閉じる） |
| 作業中に送ったプロンプト（記録なし）                                                         | 動いているツールの区間に持ち越しの印が付く → そのツールの post は持ち越しでない区間だけを数で閉じる → 持ち越しの区間はそのターンの `Stop` で閉じる                                                                                                                                                                                                                                                                                     | 早く閉じない（そのターンの終わりまで `agent` になりうる。安全側）                                                                            |
| `claude`                                                                                     | `none` を作らないので `idlessOpen`・E は常に空。`claude` の `UserPromptSubmit` の `prompt-submit` も、空の区間に印を付け、空の集合から外すだけ                                                                                                                                                                                                                                                                                         | 変わらない                                                                                                                                   |

## hooks が届かないとき（届きの確かめ）

`claude` と同じ規則をそのまま使う。

- 起動の後は `pending`（段階は `agent`）。照合の通った知らせが 1 つでも届けば `confirmed`
- ふつうは最初のプロンプトの `UserPromptSubmit` で確かめる（`copilot` もプロンプトの送信の直後に届き、`sessionStart` より先。記録 `02`・`90`）。`--resume` の直後の別の ID の `SessionEnd` も照合の通った知らせなので確かめになる（その起動のプラグインの hook が届いた証拠のため）
- renderer の作業中の知らせ（`useAgentHooksWorkingReport`。`copilot` も能力の表で `changeAttribution` が真になるので送る）から 15 秒届かなければ `unconfirmed`（`hooks-not-confirmed`）にして、その記録の区別をやめる
- 届かない原因の例: `COPILOT_HOOK_ALLOW_LOCALHOST` が効かない版、利用者・管理者の設定（`disableAllHooks`・`allowManagedHooksOnly` など）、`--plugin-dir` を読まない版。どれも区別をやめる側（安全側）になる
- 版の確認はしない（L-052）

## 既存の絞り込みの扱い

| 箇所                                                                              | 今の扱い                                                                             | 段階 3b                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useAgentHooksWorkingReport`（段階 2a で `changeAttribution` のある種類に絞った） | `changeAttribution` が偽のタブは作業中・作業の終わりを送らない                       | コードは変えない（能力の表で決まる）。`copilot` のタブも送るようになる。絞り込みのテストは能力の表を差し替える補助で保つ                                         |
| `agentHookSessions.prepare` の `cli-unsupported`                                  | `changeAttribution` が偽なら hooks なし                                              | 残す（今の表では当たらない。将来の種類の守り）。テストは `vi.mock` で能力の表を差し替えて保つ                                                                    |
| starter の `capabilities.changeAttribution ? … : null`                            | 偽の種類には設定のパスを渡さない                                                     | 残す。名前を `configPath` にする                                                                                                                                 |
| `buildCopilotArgs` の「hooks の設定のファイルが渡ったら投げる」                   | 投げる                                                                               | `--plugin-dir` を足す（上の「起動の引数」）                                                                                                                      |
| 設定の使えない機能の注記（`agentCliUnsupportedFeaturesNote`）                     | `copilot` は `利用者の変更との区別`                                                  | `copilot` はすべて使えるので `null`（注記を出さない）。代わりに精度の注記を出す                                                                                  |
| `'cli-unsupported'` の文言                                                        | `使っているエージェント CLI が区別に対応していません（claude だけが対応しています）` | 型と文言の表は残す（今の表では届かない）。括弧の中が事実と違うので `使っているエージェント CLI が区別に対応していません` にする（`claude` のときには出ない文言） |
| `claude-version-unsupported`                                                      | `claude` の版の確認の結果                                                            | `copilot` では使わない                                                                                                                                           |

## 画面の表示と文言

### CLI の名前の出し方

`claude` の名前を含む区別の文言を、コマンド名を受け取る関数にする。名前はそのウィンドウの設定の種類（`useAgentWorkspace` が持つ `agentCliKind.kind`。読み込み中は既定の `claude`）から作り、`AgentChangesSection` と `useAgentChangesRevert` に省略できない引数 `cliKind` で渡す（L-060）。

- 使う CLI の切り替えは動いているタブをすべて止めるので、区別している間のウィンドウのタブは設定の種類と同じ
- 記録の途中で設定を切り替えると、それより前の出来事（例: `claude` の頃の `hooks-not-confirmed`）の文言も切り替えた後の名前で出る（既知の制約）。main の要約（`AgentChangesAttributionSummary`）に種類を足す案は、registry・記録・IPC の型と多くのテストの値を直す必要があり、この食い違いの小ささに見合わないので採らない

### 文言の表

`claude` の文言は 1 文字も変えない（`<cmd>` に `claude` を入れると今の文と同じ）。

| 定数・関数                                                                                           | 文言                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentChangesAttributionLostReason(reason, commandName)`（表を置き換え）                             | `hooks-not-confirmed`: `<cmd> の hooks から知らせが届きません`。`cli-unsupported`: `使っているエージェント CLI が区別に対応していません`。ほかは今のまま（`receiver-unavailable`・`claude-version-unsupported`・`checkpoint-failed`） |
| `agentChangesUnassignedNote(commandName)`（`AGENT_CHANGES_UNASSIGNED_NOTE` を置き換え）              | `アプリの中で <cmd> が動いていなかった間などの変更には、印を付けていません`                                                                                                                                                           |
| `agentRevertAllDistinguishingNote(commandName)`（`AGENT_REVERT_ALL_DISTINGUISHING_NOTE` を置き換え） | `エージェントのツールが動いている間（終わってから 2 秒・許可の確認を待つ間を含む）と、<cmd> を起動してから最初のプロンプトを送るまで・中断（Esc）の後にあなたが編集した内容は、エージェントの変更として戻ります。`                    |
| `すべて戻す` の確認の順 3                                                                            | `アプリの中で <cmd> が動いていなかった間などのあなたの編集も戻ります。`                                                                                                                                                               |
| `AGENT_CLI_ATTRIBUTION_PRECISION_NOTES.copilot`（新規。`claude` は `null`）                          | `copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）`                                                              |

### 精度の注記を出す場所

1. 設定の `使うエージェント CLI` の選択肢の下（使えない機能の注記と同じ場所。`copilot` では使えない機能の注記が無くなるので、この注記だけが出る）
2. 変更の一覧の区別の状態の 1 行: 区別している記録（`isAgentChangesAttributionDistinguishing`）で、注記が `null` でないとき、今の文の後に `。` でつないで足す（今の文が `null` なら注記だけを出す）。区別を始める前（`since === null`）・区別していない記録では出さない
3. `すべて戻す` の確認: 区別している記録の順 1（`agentRevertAllDistinguishingNote`）の直後に足す

いずれも `claude` では何も足さない。

## claude への影響と互換性

| 変えるもの                                                                                         | `claude` での結果                                                    |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 受け口の経路の表（`agentHookRouteOfPath`）・持ち主の型                                             | `claude` のパス・照合の順・応答の状態コード・ログの文言は同じ        |
| `AgentHookEvent` の `ToolIdRead` の `none`・`confirm-only` の理由の追加                            | `claude` の解釈は作らない。既存の規則の分岐は変わらない              |
| 区間の状態の `idlessOpen`・`idlessEndedGroups`                                                     | `claude` では常に空。開いた数・期限切れ・割り当ての結果は同じ        |
| `PreparedAgentHooks`（`settingsPath` → `configPath`、`cliKind` と後始末を持つ）・`activate` の引数 | 内部の名前と形だけ。設定のファイルの中身・置き場・権限・消し方は同じ |
| `buildArgs` の引数名                                                                               | 引数の配列は同じ                                                     |
| 区別の文言を関数にする                                                                             | 出る文は同じ（テストで今の文字列と同じことを固定する）               |
| `cli-unsupported` の文言                                                                           | `claude` では出ない（`claude` は区別に対応している）                 |
| 精度の注記                                                                                         | `claude` は `null`（何も出ない）                                     |

保存するファイル（履歴・起動の記録・設定）の形は変えない。

## 新しい状態と既存の入口（L-061）

新しく持つ状態は「プラグインのフォルダの枠」「トークンの持ち主の CLI の種類と主の会話の ID」「ID を持たない CLI の区間」。

| 入口                                                                    | 段階 3b の扱い                                                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `起動`・`+`・`前回の続きから`・`このセッションで再開`                   | どれも starter の `createSession` を通り、`prepare` で枠を取り、`--plugin-dir` を付ける。再開でも主の ID は再開した ID |
| 取り消し・ID の選択の拒否・予約の失敗・spawn の失敗                     | starter の `finally` の `release(prepared, null)` で枠を返す（今の設定のファイルの後始末と同じ経路）                   |
| タブの `×`・帯の `終了`・リロード・フォルダの切り替え・ウィンドウの破棄 | pty の `exited` の解決で `release`。トークンを外し、追跡から外し、枠を返す                                             |
| 使う CLI の切り替え                                                     | 今のまま（タブをすべて止める）。止めた `copilot` の枠は終了で返る                                                      |
| アプリの終了                                                            | `before-quit` で止め終わってから、`will-quit` で受け口を閉じ、`hooks.json` を消す                                      |
| `copilot` の中の `/clear`・`/new`・`/resume`                            | 主の ID を採り直す（追跡の中だけ）                                                                                     |
| 記録の操作（戻す・取り消し・吸収）                                      | 今のまま（区間の合図だけを使う）                                                                                       |

## エラー処理

| 場面                                                   | main の結果                                               | 利用者から見えること                                                                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 受け口を待ち受けられない                               | hooks なしで起動（`receiver-unavailable`。ログだけ）      | 区別の状態に `hooks の知らせの受け口を用意できませんでした`。`copilot` は普通に動く（`--plugin-dir` なし）                                                                |
| 枠が空いていない                                       | 同じ                                                      | 同じ                                                                                                                                                                      |
| プラグインのフォルダの確かめ・書き直しに失敗           | 同じ。自分の一時ファイルだけを消す                        | 同じ                                                                                                                                                                      |
| `copilot` の経路への照合の失敗・不明なパス・本文の不正 | 200 の空の本文。件数をログ                                | 何も出ない（ツールは止まらない）                                                                                                                                          |
| 処理の例外・閉じた後の要求                             | 200 の空の本文                                            | 何も出ない                                                                                                                                                                |
| PreToolUse の待ちが 5 秒で打ち切られた                 | 200。今の打ち切りの印（その区間を割り当てない）           | 印の付かない間ができる（今の `claude` と同じ）                                                                                                                            |
| hooks が届かない                                       | 作業中から 15 秒で `unconfirmed`（`hooks-not-confirmed`） | `copilot の hooks から知らせが届きません`                                                                                                                                 |
| 待ち受けの後に受け口が止まった                         | 次の起動から別のポート                                    | 動いている `copilot` のファイルを書くツールが `Denied by preToolUse hook from "prompt-ide-agent-hooks" (hook errored)` で拒否される（既知の制約。タブを起動し直すと直る） |
| `buildCopilotArgs` に絶対パスでない値                  | 固定の文言で投げる → `spawn-failed`                       | 起きない想定（main の値だけが来る。値を文言に入れない。L-017）                                                                                                            |
| 終了での `hooks.json` の削除の失敗                     | パスだけをログに出して続ける                              | 何も出ない（次の起動で書き直す）                                                                                                                                          |
| `activate` の失敗                                      | 今のまま（ログに出して起動を続ける）                      | 追跡は `pending` のまま → 15 秒の確かめで区別をやめる                                                                                                                     |

例外の文言（fs の例外のパスなど）は画面に出さない（L-017）。新しい文言はどれも固定の文で、`copilot` の出力を写さない。

## セキュリティ

- トークンは起動の引数・環境変数に置かず、`0700` のフォルダの `0600` のファイルにだけ書く（作成時に `0600`。L-082）。`ps` に見えるのは `--plugin-dir <パス>` だけ
- トークンは起動ごとの乱数（32 バイトの 16 進）。受け口は SHA-256 で照合する（今のまま）。pty の終了で表から外す
- フォルダは使うたびに `lstat` で持ち主・権限・シンボリックリンクを確かめる（L-437・L-016）。置き場は利用者のホームの `userData` で、共有の一時ディレクトリではない
- 受け口は 127.0.0.1 だけで待ち受け、Host・Origin の照合も今のまま。`copilot` の経路で照合に失敗しても 200 を返すが、処理はしない（知らせとして渡さない）。200 は何の情報も返さない
- 同じ利用者のプロセス（エージェント自身を含む）は `hooks.json` を読んで偽の知らせを送れる（印が変わるだけで、作業ツリー・記録は変わらない。`claude` と同じ既知の制約）
- `COPILOT_HOOK_ALLOW_LOCALHOST=1` は、利用者自身の localhost の http の hook（preToolUse・permissionRequest を含む）も、アプリが起動した `copilot` で読まれるようにする（既知の制約）

## 構成

| ファイル                                                                                                           | 変更                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/agentCliKinds.ts`                                                                                      | `copilot` の `changeAttribution` を `true`。説明のコメント                                                                                                                                                                                                                                                                                                                                            |
| `src/main/agentHookProtocol.ts`                                                                                    | `COPILOT_HOOK_EVENT_NAMES`（7 つ）・`CopilotHookEventName`・`copilot` のパスの前の部分・`copilotHookPathOf`・`isCopilotHookPath`・`AgentHookRoute`・`agentHookRouteOfPath`・`COPILOT_HOOK_TOOL_NAMES`・`COPILOT_HOOK_TOOL_MATCHER`。イベントごとの timeout の規則（`agentHookTimeoutSecondsOf`）と、ツールのイベント（`AGENT_HOOK_TOOL_EVENTS`）を `claude`・`copilot` の設定で共有する               |
| `src/main/agentHookEvents.ts`                                                                                      | `ToolIdRead` の `none`、`confirm-only` の理由（`subagent-prompt`・`other-session-end`・`session-id-unreadable`・`stop-while-awaiting`・`copilot-body-unreadable`・`subagent-stop-unmatched`・`main-was-subagent` など）。本文の読み方を `copilot` の解釈と共有するための読み取りの関数の export（`readAgentHookBodyObject`・`readAgentHookAgentId`・`isAgentHookId`・`AGENT_HOOK_TOOL_NAME_PATTERN`） |
| `src/main/agentCopilotHookEvents.ts`（新規）                                                                       | `parseCopilotHookRequest`・`CopilotHookNotice`・`CopilotMainSession`・`resolveCopilotHookNotice`                                                                                                                                                                                                                                                                                                      |
| `src/main/agentToolIntervals.ts`                                                                                   | `idlessOpen`・`idlessEndedGroups` と規則                                                                                                                                                                                                                                                                                                                                                              |
| `src/main/agentToolActivity.ts`                                                                                    | ログの `id=` の注記のコメントだけ（`none` は今の求め方のまま `なし`）。規則の呼び出しは今のまま                                                                                                                                                                                                                                                                                                       |
| `src/main/agentHookReceiverRequest.ts`・`agentHookReceiver.ts`                                                     | 経路・持ち主の種類・`copilot` の経路の応答の規則（`agentHookResponseStatus`。拒む・閉じた後・処理の例外の状態コードを 1 か所で決める）                                                                                                                                                                                                                                                                |
| `src/main/agentHookInterpretation.ts`（新規）                                                                      | `interpretAgentHookRequest`（経路ごとに本文を知らせにする。`copilot` は解釈・振り分けをして主の会話の ID の状態を持ち主に書き戻す）                                                                                                                                                                                                                                                                   |
| `src/main/agentCopilotHookConfig.ts`（新規）                                                                       | `buildCopilotHookConfig`（設定の JSON の中身。純粋な関数）                                                                                                                                                                                                                                                                                                                                            |
| `src/main/agentCopilotHookPlugin.ts`（新規）                                                                       | マニフェスト・`createCopilotHookPluginSlots`（`acquire`・`release`・`write`・`removeTokenFilesSync`。終了の後の `closed` を共有するため 1 つのオブジェクトにまとめた）。フォルダの確かめ・原子的な書き直しは `write` の中                                                                                                                                                                             |
| `src/main/agentHookSettings.ts`                                                                                    | 今のプロセスの持ち主（`currentAgentHookDirOwner`）の export（プラグインのフォルダの確かめに使う）。timeout は `agentHookTimeoutSecondsOf` から引く（出力は変えない）                                                                                                                                                                                                                                  |
| `src/main/agentHookSessions.ts`                                                                                    | 種類ごとの準備の表（`Record<AgentCliKind, …>`。L-060）、`PreparedAgentHooks` の `cliKind`・`configPath`・後始末、`activate(prepared, sessionId, cliSessionId)`                                                                                                                                                                                                                                        |
| `src/main/__tests__/agentHookSessions.capabilities.test.ts`（新規）                                                | 能力の表を差し替えて、区別に対応しない種類の準備が `cli-unsupported` になることを保つ                                                                                                                                                                                                                                                                                                                 |
| `src/main/agentHooksRuntime.ts`・`agentHooksLifecycle.ts`・`ipcHandlers.ts`                                        | プラグインのフォルダの組み立て（`userData` は `ipcHandlers.ts` が渡す。Electron に依存しないまま）・`will-quit` の後始末に足す                                                                                                                                                                                                                                                                        |
| `src/main/agentSessionStarter.ts`                                                                                  | `configPath` の名前・`activate` に会話の ID を渡す                                                                                                                                                                                                                                                                                                                                                    |
| `src/main/agentCliLaunchSpecs.ts`                                                                                  | `hookConfigPath`・`--plugin-dir`・`extraEnv`                                                                                                                                                                                                                                                                                                                                                          |
| `src/renderer/src/lib/agentChangesMessages.ts`・`agentChangesSectionText.ts`                                       | 文言の関数化・精度の注記                                                                                                                                                                                                                                                                                                                                                                              |
| `src/renderer/src/lib/agentCliMessages.ts`                                                                         | `AGENT_CLI_ATTRIBUTION_PRECISION_NOTES`                                                                                                                                                                                                                                                                                                                                                               |
| `src/renderer/src/components/settings/AgentCliKindSection.tsx`                                                     | 精度の注記の表示                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/renderer/src/components/source-control/AgentChangesSection.tsx`・`hooks/useAgentChangesRevert.ts`・組み立て役 | `cliKind` の受け渡し（省略できない）                                                                                                                                                                                                                                                                                                                                                                  |
| `src/renderer/src/hooks/useAgentHooksWorkingReport.ts`                                                             | コメントだけ                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/manual-test-spec.md`・`ROADMAP.md`                                                                           | 「実機テスト仕様書の方針と項目の下書き」・「ROADMAP の更新の方針」                                                                                                                                                                                                                                                                                                                                    |

`AgentChangesSection` までの `cliKind` の受け渡しの経路は、`useAgentWorkspace` の `agentTerminal.appCliKind` → `useAppState` → `useAgentChangesWiring({ cliKind })` → `useAgentChangesRevert` と `agentChangesPanel.cliKind` → `GitRepoView`・`NotRepositoryView` → `AgentChangesSection` に確定した（実装プランで組み立て役を確かめた）。

## テスト方針

vitest。実物の `claude`・`copilot` は起動しない（偽の実行ファイル・偽の pty・偽のタイマー・一時ディレクトリの実ファイル・実際の listen）。

- main（純粋な関数）
  - `agentCopilotHookEvents.test.ts`: 7 つのイベントの解釈（読めた・読めない・イベント名の食い違い・大きすぎる・知らない `tool_name`・形の違う `session_id`・`agent_id`）。振り分けの表の全部のマス（主・サブエージェント・読めない・`awaiting`）と、列を選ぶ順の重なり（`awaiting` で `session_id` を読めない `prompt`・`tool-end` が「読めない」の列になり状態が `awaiting` のまま）。`--resume` の直後の別の ID の `SessionEnd` が `confirm-only` で状態を変えない。`/clear` の流れ（主の `SessionEnd` → 新しい ID の `prompt` で採り直し → その ID の `tool-start` が主のグループ）。主のプロンプトの知らせが届かずにサブエージェントの ID を採った流れ（その ID の親の `SubagentStop` の `session_id` で主を採り直し、そのターンの主の `Stop` が `turn-end`。並列のサブエージェントのグループが残らない・入れ子で親をたどる・`session_id` を読めなければ `awaiting`）
  - `agentToolIntervals.test.ts`: 並列のバッチ（pre A・pre B・post B・post A で 0 に戻る）、断ったツールが続けて呼ぶ場合に残り `turn-end` で閉じる、`tool-end` の後の `tool-start` で前のバッチの残りを閉じる、サブエージェントのグループが主の `turn-end` で閉じず自分の `subagent-stop` で閉じる（集合からも外れる）、中断の後の持ち越し（pre B → `prompt-submit` → pre C → post C → pre D → post D で B が残り、`turn-end` で閉じる。並列の途中の中断〈pre A・pre B・post A → `prompt-submit` → pre C → post C → pre D〉でも同じ。`prompt-submit` を受けない場合は post C の数の消費と pre D で閉じる）、持ち越しの区間を `tool-end` が閉じず持ち越しでない一番古い区間を閉じる、「記録の場面を規則に当てはめた結果」の表の各行、`turn-end` の後の最初のバッチが前のターンの区間を閉じない、`tool-end` がほかのグループを閉じない、期限切れ・あふれ・`session-end`。`claude` の既存のテストは変えずに通る
  - `agentCopilotHookConfig.test.ts`: 設定の JSON の形（イベント・URL・ヘッダー・`timeoutSec`・matcher）
  - `agentHookInterpretation.test.ts`: 経路ごとの解釈の選び方、`copilot` の主の会話の ID の状態の書き戻し、経路と持ち主の種類の食い違いの例外
  - `agentCopilotHookPlugin.test.ts`: 枠の取り方（一番小さい空き・返した番号の再利用・4 つで `null`・終了の後は `null`）。実 fs で、フォルダが `0700`・ファイルが `0600`、書き直しが原子的（一時ファイルが残らない）、`0777` のフォルダ・シンボリックリンクを使わずに作り直す（判定を存在だけに戻すと落ちることを確かめる。L-437）、失敗で自分の一時ファイルだけを消す、`removeTokenFilesSync` で `hooks.json` だけが消え `plugin.json` とフォルダが残る、書き直しの最中の `removeTokenFilesSync`（L-435）
  - `agentCliLaunchSpecs.test.ts`: `copilot` の `new`・`resume` に `--plugin-dir <パス>` が付く・付かない（`null`）、絶対パスでない値で固定の文言で投げる（値を含まない）、`extraEnv` が 2 つ。`claude` の結果は今のまま
- main（組み立て）
  - `agentHookReceiver.test.ts`: `copilot` の経路で、照合の各失敗・不明なパス・閉じた後・処理の例外が 200 の空の本文、PreToolUse の待ちの後に 200、経路と持ち主の種類の食い違いを渡さない。`claude` の経路の既存のテストは状態コードを含めて変えずに通る
  - `agentHookSessions.test.ts`: `copilot` の `prepare` が版を確かめず、受け口 → 枠 → 書き直しの順、失敗の各段で `receiver-unavailable` と枠の返却、`release` で枠を返す
  - `agentHookSessions.capabilities.test.ts`: `cli-unsupported` は `vi.mock` で能力の表を差し替えて保つ（差し替えが `agentHookSessions.test.ts` の `copilot` の準備のテストにかからないよう、ファイルを分ける）
  - `agentSessionStarter.test.ts`: `copilot` で hooks があると `--plugin-dir` が付き、`activate` に会話の ID が渡る
  - 統合テスト（既存の `agentHooks.integration.test.ts` に足す）: 受け口・追跡・`agentHookSessions` を実物で組み立て、一時ディレクトリを `userData` にして `prepare` が書いた `hooks.json` から URL とトークンを読み、`copilot` の PascalCase の形の要求（記録の本文の形）を送る。区間の開閉・サブエージェント・`/clear` の採り直し、不正なトークンで 200 になり追跡が変わらないこと
  - 統合テスト（既存の `agentCliLaunch.integration.test.ts` に足す。実物の node-pty。Windows では飛ばす。L-059）: 偽の `copilot`（`#!/usr/bin/env node`）が受け取った `--plugin-dir` の `hooks.json` を読み、`COPILOT_HOOK_ALLOW_LOCALHOST` の値と一緒に記録し、`UserPromptSubmit` の URL へヘッダー付きで POST する。実物の starter・`resolveAgentLaunch`・hooks の組み立てで起動し、引数・環境変数・プラグインのフォルダの形が届くこと、追跡が `confirmed` になることを確かめる（実物の `copilot` の挙動の確かめではない）
- renderer
  - `agentChangesMessages.test.ts`: `claude` を渡した各関数が今の文字列と同じ。`copilot` の文言。精度の注記の付け方（区別していない・始める前は付けない）
  - `agentCliMessages.test.ts`・`AgentCliKindSection.test.tsx`: `copilot` の使えない機能の注記が `null`、精度の注記が出る、`claude` は出ない
  - `useAgentHooksWorkingReport.test.tsx`: `copilot` のタブも作業中・作業の終わりを送る。能力の表を差し替えた種類は送らない
  - 能力の表を差し替える補助（`agentCliCapabilityOverrides.ts`）に `changeAttributionUnsupportedKinds` を足す
  - **配線**（L-060）: `AgentChangesSection`・`useAgentChangesRevert` に設定の種類が届き、`copilot` の設定で区別の状態の 1 行と `すべて戻す` の確認に精度の注記が出る。受け渡しを外す変異でテストが落ちることを確かめる

## 既知の制約（ROADMAP・実機テスト仕様書に反映する）

- `copilot` の区別の規則は GitHub Copilot CLI 1.0.87 の挙動（段階 3b-0 の記録）に合わせている。http の hook は 1.0.35、preToolUse の失敗がツールの拒否になるのは 1.0.57、PascalCase の入力の `claude` のツールの名前は 1.0.62、postToolUse の matcher は 1.0.63、打ち切りでツールを続けるのは 1.0.67 から。古い版や挙動が変わった版では、hooks が届かず区別をやめる・ツールが拒否されることがある。アプリは `copilot` の版を確かめない
- `copilot` の hooks にはツールの呼び出しの ID が無い。許可の確認で断った（または利用者の preToolUse の hook が拒否した）ツールの区間は、その後に同じ会話のほかのツールが終わってから、次のツールを始めるまで閉じない（そのような次のツールが無ければ、そのターンが終わるまで）。その間はエージェントの区間のままで、あなたの編集には印が付かない（`すべて戻す` で戻る）。画面の精度の注記は、長い方の「そのターンが終わるまで」で書いている
- 中断（Esc。帯の `中断` を含む）・許可の確認での Esc・モデルの呼び出しの失敗では `Stop` が届かないため、`claude` と同じく、作業の終わりから 30 秒後に次の知らせまで割り当てを保留し、中断したツールの区間は次のターンの終わりまで開いたままにする（次のプロンプトで持ち越しの印を付ける）。ただし、次のターンの `UserPromptSubmit` の知らせが届かなかったとき（hook の失敗など）は持ち越しの印が付かず、次のターンのツールの終わり・次のバッチのツールの開始で、中断したツールの区間が閉じうる（止まりきっていないツールの書き込みが `利用者の変更` になりうる）。`/clear` などの後の最初のプロンプトの知らせが届かなかったときは、主の会話の ID が決まるまで、主の `Stop` がターンの終わりにならない。サブエージェントを使わないターンでは、主の区間はそのターンの `Stop` で閉じず（次のターンのプロンプトの ID を主として採り、次のターンの `Stop` で閉じる）、作業の終わりから 30 秒後に、次の知らせまで割り当てを保留する（中断と同じく、同じウィンドウのほかのタブを含めて区別が止まる）。同じターンでサブエージェント（`task`）を使うと、サブエージェントのプロンプトの ID をいったん主として採るため、その中の `Stop` で、主の動いているツール（並列で呼んだ `bash` など）の区間が早く閉じうる（その書き込みが `利用者の変更` になりうる。サブエージェントのプロンプトの知らせまで届かなかったときは、その中のツールの開始・終わりでも閉じうる）。その後、親の `SubagentStop`（`agent_id` が採った ID と同じ）が届くと、その `session_id`（親の会話の ID）を主として採り直し、そのターンの主の `Stop` からターンの終わりになる（入れ子で孫の ID を採ったときは、子・主と親をたどって採り直す）。ただし、背景で動くサブエージェント（`write_agent` など。記録していない）の ID を採っていて、その間に主が始めたツールが採り直しの後に終わったときは、その区間は採り直しの後に閉じず、主を採り直した後の `/clear`・終了まで残り、15 分後に割り当てられない区間になりうる（同じウィンドウの区別が止まる）。`SubagentStop` の `session_id` を読めなかったときは主の会話の ID を待ち直し、上のサブエージェントを使わないターンと同じになる（そのとき並列で動いていたほかのサブエージェントの区間は閉じず、主を採り直した後の `/clear`・終了まで残り、15 分後に割り当てられない区間になりうる）。`SubagentStop` も届かなかったとき（サブエージェントの中断など）は採り直せず、本当の主の `Stop` がターンの終わりにならないため、`copilot` が終了するまで、ターンごとに同じ保留が続く
- サブエージェントの区間は、その中の `Stop`・親の `SubagentStop` で閉じる。中断などで届かないと 15 分後に割り当てられない区間になり、そのセッションの `/clear`・終了まで印を付けない（`claude` と同じ）。背景で動くエージェント（`write_agent` など）・非同期のシェル（`bash` の非同期・`write_bash`）がツールの終わりの後に書いた変更は、`利用者の変更` になりうる（`claude` の背景の `Bash` と同じ）
- `task` などの matcher の外のツール（MCP のツール・`sql` など）が書いたファイル、利用者の postToolUse の hook がツールの終わりから 2 秒より後に書いたファイルは、ほかの区間に入らなければ `利用者の変更` になりうる
- ファイルを書くツールを呼ぶたびに（動いていない状態からのとき）、判定の区切りを取り終えるまでツールの開始が待たされる（上限 5 秒）。並列の呼び出しでは `PreToolUse` が 1 つずつ届くことがあり、そのときは呼び出しの数だけ待ちが重なりうる
- アプリから起動した `copilot` の環境には `COPILOT_HOOK_ALLOW_LOCALHOST=1` が入るため、利用者自身の localhost に向けた http の hook（preToolUse・permissionRequest を含む）も、アプリの中の `copilot` では読み込まれて動く（アプリの外の端末の `copilot` では動かない設定でも）
- `copilot` が利用者の `~/.copilot/plugin-data/_direct/` に空のディレクトリを、プラグインのフォルダのパスごとに 1 つ作る。アプリのフォルダは 4 つの枠に固定なので 4 つまで（開発版の `npm run dev` と配布版のアプリは同じ `userData` を使うので、合わせて 4 つまで）。`~/.copilot/installed-plugins/`（空）もできる。アプリはこれらを消さない（`copilot` の持ち物）
- `copilot` の `/env` にアプリのプラグイン（`prompt-ide-agent-hooks`）と hooks が出る。`ps` には `--plugin-dir <アプリのデータのフォルダ>/agent-hooks-copilot/slot-<番号>` が見える（トークンはフォルダの中の `0600` のファイルにあり、引数・環境変数には無い）。同じ利用者のプロセス（エージェント自身を含む）はトークンを読んで偽の知らせを送れる（印が変わるだけ）
- 待ち受けの後に受け口が止まると（`EMFILE` など）、動いている `copilot` のファイルを書くツールが `Denied by preToolUse hook from "prompt-ide-agent-hooks" (hook errored)` で拒否される。タブを起動し直すと直る。アプリの終了で、止める上限（6 秒）を過ぎても残った `copilot` も同じ
- 受け口が要求を時間内に読み終えられないとき（受け口の処理が詰まったときなど）は、Node の打ち切り（要求の全体 15 秒で 408）より先に `copilot` の打ち切り（`timeoutSec`。PreToolUse は 10 秒、ほかは 5 秒）が来て接続を切るので、`copilot` の経路では Node の 408 は当たらない。打ち切りはツールの許可になるので、ツールは拒否されない。本文の途中で切られた PreToolUse は読めない知らせとして区間を開く（エージェントの区間の側）。要求の頭も読み終えないうちに切られたとき・打ち切りの後に遅れて読んだときは、そのツールの区間が開かないか遅れて開くので、そのツールの変更は `利用者の変更` になりうる
- 閉じたウィンドウの `copilot` が止まりきる前に、新しいウィンドウで 4 つ起動するなど、動いている `copilot` が 4 つを超えると、超えた分は hooks なしで起動する（区別の状態は `hooks の知らせの受け口を用意できませんでした`）
- 区別の文言の CLI の名前は、そのときの設定の種類で出す。記録の途中で使う CLI を切り替えると、切り替える前の出来事の理由も切り替えた後の名前で出る。精度の注記（`copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）`）も、そのときの設定の種類で出す。記録の途中で `copilot` から `claude` に切り替えると、`copilot` の間に付けた印（断ったツールの後のあなたの編集をエージェントの変更に数えたもの）が残っていても、区別の状態の 1 行と `すべて戻す` の確認に注記が出ない（その編集も、注記なしにエージェントの変更として戻りうる。逆向きは注記が余計に出るだけ）
- `copilot` の hooks が使えない設定（利用者・管理者の `disableAllHooks`・`allowManagedHooksOnly` など）では、作業中から 15 秒で区別をやめる
- 同じ `userData` を使うアプリを 2 つ同時に動かすと（開発版の `npm run dev` と配布版のアプリは、どちらもアプリの名前が `prompt-ide`〈`package.json` の `name`・`electron-builder.yml` の `productName`〉で、`userData` の場所を変えていないので、必ず同じ `userData` を使う）、両方が同じ枠のプラグインのフォルダ（`slot-<番号>`）を使い、一方の起動・終了が他方の `copilot` の `hooks.json` を書き換えたり消したりしうる。そのときは区別がずれたり、ファイルを書くツールが拒否されたりする。アプリは複数の起動を排他しない（同時に動かすのは 1 つにする）
- 記録していないこと: 信頼の確認の前・信頼を覚えたフォルダでのプラグインの hook、`/cd` の後、背景のサブエージェント・MCP のツールの hook、`apply_patch` の削除・移動、Windows（`powershell` のツールの名前・パスの扱い）。hook の要求がプロキシを通らないことは、`NO_PROXY` に `127.0.0.1` を入れた環境（アプリが常に足す）で確かめた

## 実機テスト仕様書の方針と項目の下書き

`docs/manual-test-spec.md` の「## エージェント CLI のアプリ内ターミナル」の `### copilot のセッションの再開と履歴` の後（`## エージェントの変更の確認` の前）に `### copilot の利用者の変更との区別` を足し、AGT-278 から振る（今の最大は AGT-277）。下書きの文言は、実装の後にコードの文言・ログの形と照らし合わせて確定してから追記する（L-354）。

方針:

- 手順は実機でそのまま実行できるものだけにする（L-072）。`copilot` への指示はターミナルの `copilot` の入力欄に直接打つ（プロンプトを足さない）
- 利用者のファイル・設定を壊さない。`~/.copilot` の中・アプリのデータのフォルダは `ls`・`ps` で見るだけで、消す・書き換える手順を書かない。ファイルを変える手順は、テスト用のリポジトリの直下で `pwd` を確かめてから行う
- 設定の前提は「オフ（または別の値）なら節の間だけ変え、最後の項目で戻す」形にする。使う CLI は、`Claude Code（claude）` なら節の間だけ `copilot` にし、最後の項目で `Claude Code（claude）` に戻す（途中で止めるときも戻す。もともと `copilot` ならそのまま）
- フォルダの信頼の確認・許可の確認は、その回だけの選択肢を選ぶ（覚えさせない）。`copilot` のログインは利用者が自分のアカウントで行う
- 足したタブは、その項目の中で閉じる
- 時間の値は実装の値から書く（猶予 2 秒、作業の終わりからの保留 30 秒〈待つのは 40 秒〉、届きの確かめ 15 秒。L-606）

### 既存の項目の直し（ID は変えない）

- **AGT-230**: 期待結果の注記を「選択肢の下に `copilot では次の機能を使えません…` は出ず、`copilot では、利用者の変更との区別が claude より粗くなります（…）` が出る」にする
- **AGT-237**: 手順を「記録を始め、何も送らずにセクションの `更新` を押して区別の状態の 1 行を見る」にし、期待結果を「区別の状態の 1 行に `利用者の変更の区別は HH:MM からです（それより前の変更には印を付けません）` と `copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）` が出る（起動の直後の `pending` の間はエージェントの区間として数え、始点を取っている間の区間は割り当てないため、区別はプロンプトを送らなくても記録の開始の直後の時刻から始まる。AGC-119 と同じ）。`使っているエージェント CLI が区別に対応していません` は出ない」にする
- **AGT-240**: 期待結果の「使えない機能の注記が消える」を「精度の注記（`copilot では、利用者の変更との区別が claude より粗くなります…`）が消える」にする（段階 3b から `copilot` で使えない機能の注記が出なくなったため）

### 新しい節

確定版（`docs/manual-test-spec.md` の AGT-278〜289 と同じ。実装の後に照らし合わせて直した）:

> 前提: エージェント CLI 方式で、「## エージェントの変更の確認」の冒頭の前提の手順（`R=$(mktemp -d); cd "$R" && git init …`）でテスト用の Git リポジトリを作り、その最上位のフォルダを開いている（追跡しているのは a.txt・b.txt・c.txt だけ）。アプリは `npm run dev` で起動し、その端末の `[agent-hooks]` の行を見る（開発版のログの 1 行の形は「利用者の変更との区別」の節の前提と同じ）。GitHub Copilot CLI（`copilot`）がインストール済みで、端末で `copilot --version` が動く。
> 前提: 設定の `使うエージェント CLI` が `Claude Code（claude）` なら、この節の間だけ `GitHub Copilot CLI（copilot）` を選び（動いているタブがあれば確認で `OK`）、この節の最後の項目で `Claude Code（claude）` に戻す。途中で止めるときも戻す（始める前から `GitHub Copilot CLI（copilot）` だったなら、選び直さず、最後もそのままにする）。
> 前提: フォルダの信頼の確認が出たら、その回だけ信頼する選択肢（`1. Yes`）を選び、`2. Yes, and remember this folder for future sessions` は選ばない（覚えさせてしまったら、AGT-228 の節の前提の手順で外す）。`copilot` のログインなど GitHub のアカウントに関わる操作は、利用者が自分のアカウントで行う。ツールの許可の確認では、項目に書いたもの以外は、その回だけ許可する選択肢（`Yes`）を選び、以後も許可する選択肢は選ばない。`copilot` への指示は、ターミナルの `copilot` の入力欄に入力して `Enter` で送る。
> 前提: 始める前に、別の端末で `ls ~/.copilot/plugin-data/_direct/ 2>/dev/null | wc -l` を実行して数を控える（見るだけで、中身は変えない）。この節では `~/.copilot` の中とアプリのデータのフォルダ（`~/Library/Application Support/prompt-ide/`）を `ls`・`ps` で見るだけにし、消したり書き換えたりしない。

- [ ] **AGT-278** `起動` で `copilot 1` を起動し、別の端末で `ps -axo pid=,args= | grep -- '[-]-plugin-dir'` を実行する（`[-]` は grep 自身の行を拾わないため）。続けて、出たパスを `D` として（パスに空白を含むので `D="…"` と引用符で囲む）`ls -ld "$D" "$D/hooks"` と `ls -l "$D" "$D/hooks"` を実行する → `copilot` の行に `--plugin-dir <ホーム>/Library/Application Support/prompt-ide/agent-hooks-copilot/slot-1` が付いている。フォルダは 2 つとも `drwx------`、`$D` に `plugin.json` と `hooks`、`$D/hooks` に `hooks.json`（`-rw-------`）がある。`ps` の出力にトークン（64 桁の 16 進）が出ない。`npm run dev` の端末に `event=起動 tool=- id=- agent=- hooks=pending phase=paused→agent` の行が出る
- [ ] **AGT-279** `こんにちは` を送る（信頼の確認が出たら `1. Yes`）。応答の後に `/env` を送る → `npm run dev` の端末に `event=UserPromptSubmit tool=- id=- agent=- hooks=confirmed` の行が出る。`[agent-hooks] 拒んだ要求`・`[agent-hooks] 読めない知らせ` の行が出ない（出たら理由と件数を記録する）。`/env` の表示にプラグイン `prompt-ide-agent-hooks` と hooks が出る（出方を記録する）
- [ ] **AGT-280** 帯の `変更を確認` → `いまから記録する` で記録を始める。`a.txt の最後に agent という行を足して` を送り、許可の確認が出たら `Yes` を選ぶ → 端末に `event=PreToolUse tool=Edit id=なし agent=なし hooks=confirmed phase=idle→agent` と `event=PostToolUse tool=Edit id=なし agent=なし` の行が出て、その約 2 秒後に `session=- event=猶予の終わり … phase=agent→idle` の行が出る（`Edit` 以外の名前〈`Write` など〉なら記録する）。`copilot` の画面に `Denied by preToolUse hook` の行が出ない
- [ ] **AGT-281** `copilot` の作業が終わって入力待ちになったら、別の端末でテスト用のリポジトリの直下に移り（`pwd` で確かめる）、`echo user >> b.txt` を実行してから、セクションの `更新` を押す → 一覧の `M a.txt` には印が無く、`M b.txt` に `利用者の変更` の印が付く。区別の状態の 1 行に `copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）` が出る
- [ ] **AGT-282** `c.txt を消すコマンドを実行して` を送り、許可の確認で断る選択肢（`No`）を選び、指示の欄があれば `何もせずに終えて` と送る → 端末に `event=PreToolUse tool=Bash … phase=idle→agent` の行が出て、そのツールの `event=PostToolUse`・`event=PostToolUseFailure` の行は出ない。`copilot` が答え終わると `event=Stop tool=- id=- agent=-` の行が出て、その約 2 秒後に `event=猶予の終わり … phase=agent→idle` の行が出る。テスト用のリポジトリで `git status --porcelain` を実行すると `D c.txt` は出ない
- [ ] **AGT-283** `sleep 20 を実行して` を送り（許可は `Yes`）、`event=PreToolUse tool=Bash` の行が出たら、実行中に帯の `中断` を押す。そのまま次の指示を送らずに 40 秒待つ → `event=PostToolUse`・`event=Stop` の行は出ない。画面の活動が作業の終わりになってから約 30 秒後に `[agent-hooks] ターンの終わりの知らせが届かないため、次の知らせまで割り当てを保留します` と `event=終わりの待ちの終わり … unassignable=あり` の行が出る。続けて `こんにちは` を送ると `[agent-hooks] 知らせが届いたため、保留を解きます` の行が出て、答え終わると `event=Stop … agent=-` の行と、その約 2 秒後の `event=猶予の終わり … phase=agent→idle` の行が出る
- [ ] **AGT-284** `task ツールのサブエージェントに、c.txt の最後に sub という行を足させて` を送る → `agent=あり` の `event=PreToolUse`・`event=PostToolUse` の行と、`event=Stop tool=- id=- agent=あり` の行（サブエージェントのターンの終わり。主のターンの終わりとして扱わない。主の `task` は区間に数えないので、段階はサブエージェントのツールの `PostToolUse` の約 2 秒後の `猶予の終わり` の行で先に `idle` になっていることが多く、そのときこの行は `phase=idle→idle`）、`event=SubagentStop tool=- id=- agent=あり` の行が出て、最後に `event=Stop … agent=-` の行が出る（サブエージェントを使わずに答えたら、そのことを記録する）
- [ ] **AGT-285** `/clear` を送り、続けて `b.txt の最後に after-clear という行を足して` を送る（許可は `Yes`）→ `/clear` で `event=SessionEnd tool=- id=- agent=- hooks=confirmed` の行が出る。その後のツールの行は `agent=なし`（主の会話として数える）で、`event=PostToolUse` の行の約 2 秒後に `event=猶予の終わり … phase=agent→idle` の行が出て、答え終わると `event=Stop … agent=-` の行が出る（ツールが終わった時点で区間が 0 に戻って猶予が始まるので、`Stop` の行は `phase=idle→idle` になり、`Stop` の後に `猶予の終わり` の行は出ない）
- [ ] **AGT-286** 帯の `終了` で `copilot 1` を止め、`前回の続きから` を押す（信頼の確認が出たら `1. Yes`）。入力待ちになったら `a.txt の最後に resumed という行を足して` を送る（許可は `Yes`）→ 再開の直後（約 1 秒以内）に `event=SessionEnd tool=- id=- agent=- hooks=confirmed` の行が出る（別の ID の終わりとして扱い、区間を閉じない。起動の直後の確かめになるので `phase=agent→idle`）。その後のツールの行は `agent=なし` で、`event=PostToolUse` の行の約 2 秒後に `event=猶予の終わり … phase=agent→idle` の行が出る（答え終わった後の `Stop` の行は `phase=idle→idle`）
- [ ] **AGT-287** `+` で 2 つ目のタブ（`copilot 2`）を起動し、AGT-278 と同じ `ps` を実行する。次に `copilot 2` を `×` で閉じ（確認で `OK`）、タブが消えてから、もう一度 `+` で起動して `ps` を実行し、そのタブを `×` で閉じる（確認で `OK`）。最後に `ls ~/.copilot/plugin-data/_direct/ 2>/dev/null | wc -l` を実行する → 2 つ目のタブの `--plugin-dir` は 2 回とも `…/agent-hooks-copilot/slot-2`。`_direct` の数は前提で控えた数から 2 つより多く増えていない（初めて使う環境で 1〜2 増える。2 回目の起動では増えない）。足したタブは残っていない
- [ ] **AGT-288** セクションの `すべて戻す` を押し、確認の文言を見てから `キャンセル` を押す → 確認に `copilot を起動してから最初のプロンプトを送るまで` を含む文と、`copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）。` が出る。`キャンセル` でファイルは変わらない
- [ ] **AGT-289** `確認を終える` で記録を終え、帯の `終了` で `copilot 1` を止めてから、設定の `使うエージェント CLI` を前提のとおり元に戻す（この節の間だけ `GitHub Copilot CLI（copilot）` にしたなら `Claude Code（claude）` を選ぶ）。アプリを `Cmd+Q` で終了し、AGT-278 の `D` について `ls "$D" "$D/hooks"` を実行する（見るだけ） → `$D` に `plugin.json` と `hooks` は残り、`$D/hooks` に `hooks.json` は無い。この項目で設定は元に戻る（続けて確かめるときは `npm run dev` で起動し直す）

追記したら `node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact（<manual-test-spec-artifact-url>）を同じファイルパス（`.superpowers/manual-test-spec.html`）で再公開する。`npx vitest run scripts` が通ること。

## ROADMAP の更新の方針

- 「エージェント実行の支援（MVP の次）」の `- [ ] \`claude\` 以外のエージェント CLI への対応（…）`を`[x]` にし、段階 3a の行の後に次の行を足し、「残り」の行を消す
  - `実装済み（日付。段階 3b。設計書 docs/superpowers/specs/2026-10-26-agent-cli-copilot-hooks-design.md）: copilot の hooks による利用者の変更との区別（アプリが起動する copilot に --plugin-dir で http の hooks を渡す）。実装済み機能の「copilot の hooks による利用者の変更との区別（段階 3b）」を参照`（日付は main に入れた日）
- 段階 1・2a・2b・3a の節の既知の制約のうち「`copilot` では利用者の変更との区別を使えない」旨の行を、その段階の時点の記録として過去形に直し、`（段階 3b で対応した）` を書き足す（行の末尾の括弧の中に `段階 3b で利用者の変更との区別に対応した` を足す）
- 「エージェントの変更の利用者の編集との区別（`claude` の hooks）」の節の既知の制約の「区別するのは、アプリの中のタブで起動した `claude` のツールの区間だけ。…ほかのエージェント CLI の変更は区別しない」を、段階 3b の時点の内容（アプリの中のタブで起動した `claude`・`copilot`）に直し、`copilot` の違いは段階 3b の節を参照させる（L-591）
- 実装済み機能の末尾（`### copilot のセッションの再開と履歴への CLI の種類（段階 3a）` の後）に `### copilot の hooks による利用者の変更との区別（段階 3b）` を足す。設計書へのリンク、渡す hooks の表、プラグインのフォルダの形、受け口の応答の規則、区間の規則、既知の制約（この設計書の「既知の制約」と同じ）を書く

## やらないこと

- `claude` の受け口の応答・設定のファイル・hooks・文言の変更（上の「claude への影響と互換性」の内部の名前の変更を除く）
- camelCase の hooks・`errorOccurred`・`permissionRequest`・`notification`・`sessionStart`・`subagentStart` を使うこと
- `tool_input` からファイルのパスを読んで区別に使うこと
- 次の `UserPromptSubmit`・renderer の作業の終わりで区間を閉じること
- `copilot` の `session-state/<ID>/events.jsonl` の `toolCallId` を読むこと（内部の置き場と版に依存する。L-059）
- 受け口が止まった後に同じポートで待ち受け直すこと
- 区別の文言の CLI の名前を main の要約に持たせること
- `~/.copilot/plugin-data/_direct/` の空のディレクトリを消すこと
- 区別の文言以外の画面・ログの文言の変更（開発版のログの形は今のまま）
- `copilot` の版の確認
- `claude`・`copilot` 以外の CLI

## 実装の分割

1 つの実装プランで、次の順のタスクにする。**各タスクの終わりで `npm test`・`npm run typecheck` が通る**順に並べる（L-609）。型に値や欄を足すタスクでは、その型を網羅する `switch`・`Record` と、その型の値を作るすべての箇所（テストの値を含む）を同じタスクで直す。利用者は計画を書く時点で grep し直して一覧にする。

1. **ID を持たない CLI の区間の規則**: `agentHookEvents.ts` の `ToolIdRead` の `none`・`confirm-only` の理由、`agentToolIntervals.ts` の `idlessOpen`・`idlessEndedGroups` と規則、`agentToolActivity.ts` のログの `id=`（集合から外す時点の 5 つと持ち越しの印を含む）。`applyToolIntervalEvent` は今 `confirm-only` を理由にかかわらず何もしないので、`prompt-submit` だけを分け、`agentToolIntervals.ts` の冒頭のコメント（「confirm-only は何もしない」の旨）も直す。`event.kind`・`toolId.kind` で分ける箇所（`applyToolIntervalEvent` の `switch`、追跡の `apply`・`detailOf`、テストの補助 `helpers/agentHookEventFixtures.ts`）を同じタスクで直す。この時点で `none` を作る解釈は無い（規則のテストは知らせを直接作る）
2. **copilot の入力の解釈と振り分け（純粋な関数）**: `agentHookProtocol.ts` の `copilot` の定数（イベント・パス・ツールの名前・matcher）と `agentCopilotHookEvents.ts`、テスト。受け口はまだ使わない
3. **受け口の経路・持ち主の種類・応答の規則**: `agentHookRouteOfPath`・`checkAgentHookRequest` の結果の型・`AgentHookOwner` の `cli`・`addToken`、`copilot` の経路の 200、振り分けの呼び出し。`AgentHookOwner` を作る箇所（`agentHookSessions.activate`）と `activate` の引数（会話の ID）・`PreparedAgentHooks.cliKind`（`prepare` の戻り値・`helpers/fakeAgentHookSessions.ts`・starter の呼び出しとテストの値）を同じタスクで直す。この時点の `copilot` は `cli-unsupported` のまま（トークンを足さない）なので挙動は変わらない。`claude` の経路の既存のテストは状態コードを変えずに通す。`agentHookEventOfPath`（`claude` のパス）は残す（`agentHookProtocol.test.ts` は変えない）
   - 直す既存のテスト（2026-10-26 時点に `addToken`・`AgentHookOwner`・`checkAgentHookRequest`・`.activate(`・`unavailableReason:`・`hooks: {` で grep したもの。計画を書く時点でかけ直す）
     - `AgentHookOwner` の `cli`: `agentHookReceiver.test.ts` 77・270 行（`addToken`）、`agentHookReceiverRequest.test.ts` 13 行（`OWNER`）と 34 行（`accepted` の結果の `toEqual` に経路が入る）
     - `activate` の 3 つ目の引数（会話の ID）: `agentHookSessions.test.ts` 154・159・168・203 行、`agentHooks.integration.test.ts` 83・162・163 行、`agentSessionStarter.test.ts` 879・894 行（`toHaveBeenCalledExactlyOnceWith` に会話の ID を足す）。`helpers/fakeAgentHookSessions.ts` 28 行の偽物は引数を足しても型は合う（記録の文字列 `activate:<sid>` は変えないので、starter の 883・1207・1211 行は変えない）。`agentHooksRuntime.test.ts` 44 行の `vi.fn()` は変えない
     - `PreparedAgentHooks.cliKind`（値を作るすべての箇所）: `agentHookSessions.test.ts` 70〜72 行（`WITH_HOOKS`）・107・130・145・169・194・203 行、`agentHooks.integration.test.ts` 164 行、`agentSessionStarter.test.ts` 845〜846 行（`PREPARED`）・857・895・910・1218〜1219 行、`helpers/fakeAgentHookSessions.ts` 15 行（`preparedWithoutHooks`）
4. **プラグインのフォルダ**: `agentCopilotHookPlugin.ts`（マニフェスト・枠・確かめ・原子的な書き直し・`removeTokenFilesSync`）・`agentCopilotHookConfig.ts`（設定の JSON）とテスト。まだ組み立てない
5. **copilot の区別の有効化（準備・引数・環境変数・能力の表）**: 1 つのタスクに入れる（引数の関数が受け付ける値を広げる変更・準備の表・能力の表の値は、どれかだけでは起動が壊れるか既存のテストが落ちる。L-609 の (2)）
   - `agentHookSessions.ts` の種類ごとの準備の表と `PreparedAgentHooks` の `configPath`・後始末、`agentSessionStarter.ts` の名前、`agentCliLaunchSpecs.ts` の `hookConfigPath`・`--plugin-dir`・`extraEnv`、`agentHooksRuntime.ts`・`agentHooksLifecycle.ts`・`ipcHandlers.ts` の組み立てと `will-quit`、能力の表の `copilot` の `changeAttribution` を `true`
   - 前提を失う既存のテストを同じタスクで直す。2026-10-26 時点のテストを `changeAttribution`・`cli-unsupported`・`hookSettingsPath`・`settingsPath`・`利用者の変更との区別`・`copilot の起動に hooks`・`extraEnv`・`COPILOT_DISABLE_RESUME_AUTO_CD`・`unsupportedKinds` で grep して洗い出した一覧（行番号はその時点のもの）。計画を書く時点でも同じ grep をかけ直し、増えていれば足す
     - **落ちるもの（直す）**
       - `src/shared/__tests__/agentCliKinds.test.ts`: 58〜70 行「claude の能力はすべて真、copilot は changeAttribution だけ偽」（すべて真へ）
       - `src/main/__tests__/agentCliLaunchSpecs.test.ts`: 34〜36 行「足す環境変数は copilot の COPILOT_DISABLE_RESUME_AUTO_CD=1 だけ」（2 つへ）、60〜66 行の `it.each(AGENT_CLI_KINDS.filter((kind) => !agentCliCapabilities(kind).changeAttribution))`（「区別に対応しない種類に hooks の値が渡ったら投げる」）は消す。起動の表は能力の表を読まず、`claude`・`copilot` のどちらの `buildArgs` も hooks の値を受け付けるようになるので、能力の表を差し替えても投げる種類が無い。124〜126 行「hooks の設定のファイルが渡ったら投げる(changeAttribution は偽のまま)」は `--plugin-dir` を足す期待へ書き換え、60 行のテストの役目（種類ごとの hooks の値の扱い）もここと `claude` の 79〜80 行で受け持つ
       - `src/main/__tests__/agentHookSessions.test.ts`: 135〜145 行「種類の能力に区別(changeAttribution)が無ければ…cli-unsupported」（`copilot` の計画を使っているので、`vi.mock` の差し替えへ。同じファイルに足す `copilot` の準備のテストにモックがかからないよう、差し替えのテストは専用のファイル `agentHookSessions.capabilities.test.ts` に移す〈段階 3a の `agentSessionStarter.capabilities.test.ts` と同じ形〉）
       - `settingsPath` → `configPath` の改名（型検査が落ちる。2026-10-26 時点に `settingsPath` で grep したもののうち hooks のもの。`settingsFileStore.atomic.test.ts`・`settingsHandlers.apiKeyStatus.test.ts` の同名の関数は無関係）: `agentHookSessions.test.ts` 71 行（`WITH_HOOKS`）、`agentHooks.integration.test.ts` 80・126・139・148・149・150 行、`agentSessionStarter.test.ts` 845・1218 行。あわせて `hooks` に足す後始末（`discard`）を同じ箇所の値に足す
       - `src/main/__tests__/agentSessionStarter.test.ts`: 870〜876 行（`--settings` の期待は今のまま。値の名前だけ）、1215 行「hooks が設定のファイルを返しても(copilot では本来返さない)、copilot の引数には --settings を足さない」（`--plugin-dir` が付く期待へ）
       - `src/renderer/src/hooks/__tests__/useAgentHooksWorkingReport.test.tsx`: 182 行「copilot のタブは、作業中・作業の終わりを知らせない」（送る期待へ。絞り込みは `changeAttributionUnsupportedKinds` で保つ）
       - `src/renderer/src/lib/__tests__/agentCliMessages.test.ts`: 74 行（`copilot` の注記が `null` へ）、82・89・96 行（差し替えた能力の注記から `利用者の変更との区別` を外す）
       - `src/renderer/src/components/settings/__tests__/AgentCliKindSection.test.tsx`: 146 行（注記が出ない期待へ）
       - 組み立ての引数（`userData` のフォルダ・プラグインのフォルダの後始末）: `agentHooksRuntime.test.ts` 57〜63 行の `createOptions()`（省略できない引数を足す）と 151〜155 行の `lifecycleParts` の `toEqual`、`agentHooksLifecycle.test.ts` 18〜25 行（後始末の部品を足し、`will-quit` で呼ばれることを確かめる）、`ipcHandlers.test.ts` 298〜330 行付近（`createAgentHooksRuntime` に渡す値を見るテスト。`userData` の値の期待を足すかを計画で確かめる）
     - **テストの補助**: `src/renderer/src/__tests__/agentCliCapabilityOverrides.ts` に `changeAttributionUnsupportedKinds` を足し、オブジェクトを作るすべてのテスト（2026-10-26 時点: `usePromptRunner`・`useAgentResume`・`useAgentWorkspace`・`useAgentActivity`・`useAgentPromptSender`・`agentInterrupt`・`agentResumeAvailability`・`promptRunAvailability`・`agentCliMessages`、ほかに `useAgentHooksWorkingReport` で使う）を同じタスクで直す（必須の欄にする。L-060）
     - **変えないもの（確かめた）**: `agentToolActivity.test.ts` 95 行（`cli-unsupported` を直接足す）、`agentHookSessions.test.ts` 202〜206 行（`cli-unsupported` の prepared を直接作る。タスク 3 で `cliKind` と `activate` の会話の ID を足し済み。このタスクでは変えない）、`agentCommand.test.ts` 421〜516 行（`COPILOT_DISABLE_RESUME_AUTO_CD` の個別の値を見る。`COPILOT_HOOK_ALLOW_LOCALHOST` の期待は足す）、`agentCliLaunch.integration.test.ts` の段階 3a の describe（偽の hooks で hooks なし）
   - 受け口・追跡・`agentHookSessions` の統合テスト（`copilot`）をこのタスクで足す
6. **画面の文言と精度の注記**: `agentChangesMessages.ts` の関数化（`claude` の文の同一性のテスト）、`AGENT_CLI_ATTRIBUTION_PRECISION_NOTES`、設定・区別の状態の 1 行・`すべて戻す` の確認、`AgentChangesSection`・`useAgentChangesRevert` への `cliKind`（省略できない引数。組み立て役と既存のテストの値を同じタスクで直す。`agentChangesMessages.test.ts` 555〜560 行の `AGENT_CHANGES_ATTRIBUTION_LOST_REASONS` の `toEqual`・576〜624 行、`agentChangesSectionText.test.ts` 99 行、`AgentChangesSection.test.tsx` を含む）、配線のテスト（変異の確認を含む）
7. **偽の copilot の統合テスト**: `agentCliLaunch.integration.test.ts` に足す（テストだけ）
8. **ROADMAP・既知の制約・テスト仕様書と全体の検証**:
   - ROADMAP: 「ROADMAP の更新の方針」のとおり
   - 実機テスト仕様書: AGT-278〜289 と AGT-230・237 の直しを、実装の文言・ログの形と照らし合わせて確定して追記する。`node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact を同じファイルパスで再公開する（コントローラーが行う）。`npx vitest run scripts` が通ること
   - 設計書の「既知の制約」を実装と照らし合わせ、食い違いがあれば直す（L-203）
   - 全体の検証: `npm test`・`npm run typecheck`・変更したファイルへの `npx eslint`

main に入れた時点で利用者から見える挙動:

- `copilot` を選んでいる間も、変更の一覧で `利用者の変更` の印が付き、`すべて戻す` から外れる
- 設定・区別の状態の 1 行・`すべて戻す` の確認に、`copilot` の区別が粗い旨が出る
- アプリが起動する `copilot` の引数に `--plugin-dir`、環境に `COPILOT_HOOK_ALLOW_LOCALHOST=1` が付く
- `claude` を選んでいる間は今までと同じ

## 気をつける知見（dev-flow-kit の review-lessons.md）

選び方: 優先度 A のチェックリストを読み、hooks の受け口・秘密の置き場・外部プロセスの引数と環境・失敗の伝え方・区間の判定・実機の手順に関係する項目の本文を読んだ（L-001・L-002・L-004・L-014・L-016・L-017・L-018・L-019・L-023・L-034・L-044・L-052・L-053・L-059・L-060・L-061・L-072・L-437）。
優先度 B は「非同期・競合」「エラー処理」「データ消失・破壊（互換性）」「ドキュメント・仕様」「セキュリティ」の見出しを読み、関係するもの（L-079・L-082・L-403・L-435・L-591・L-606・L-609・L-203・L-354）を当てはめた。

- L-609: タスクの分割は「実装の分割」のとおり。能力の表を `true` にする変更・引数の関数が `--plugin-dir` を受け付ける変更・準備の表を同じタスクに入れ、前提を失う既存のテストを grep で洗い出して一覧にした。`ToolIdRead` の `none` と網羅の `switch`、`AgentHookOwner`・`PreparedAgentHooks` の形と作る箇所を同じタスクにした
- L-203: 文言を関数にしたら、旧定数名・`claude` だけを指す説明（`claude の hooks`・`claude だけが対応`）を型の説明・コメント・テスト名・ROADMAP・仕様書で grep し直す。`useAgentHooksWorkingReport` の「copilot は知らせない」のコメントを直す
- L-019: プラグインのフォルダ・トークン・引数・環境変数はすべて main が決め、renderer の値を使わない
- L-017: 新しい文言は固定の文。fs の例外（パスに利用者名）・`copilot` の出力を画面に出さない。`buildCopilotArgs` の例外に値を入れない
- L-072: 実機の項目は `~/.copilot`・アプリのデータのフォルダを `ls`・`ps` で見るだけにし、ファイルを変える手順は `pwd` を確かめてから行い、設定とタブを節の中で戻す
- L-001・L-053: 準備の失敗は hooks なしの起動として結果で返し、後始末は 1 つずつ試す。活動の結び付けの失敗は起動を止めない（今のまま）
- L-002・L-044: 読めない本文・読めない `session_id`・知らない `tool_name` を区間を閉じる根拠にしない。開く側（`PreToolUse`）だけは開く。次の `UserPromptSubmit`・画面の作業の終わりで閉じない
- L-004・L-010・L-014・L-082: 一時ファイルは `wx`・`0600` で作って `sync` してから `rename`、失敗では自分の一時ファイルだけを消す。終了の後始末は 1 つずつ試す
- L-016・L-437: 固定のパスのフォルダを使うたびに `lstat` で持ち主・権限・リンクを確かめ、外れたら作り直す
- L-018: 区別の対象の種類は起動の計画の種類（main が読んだ設定）で決める。主の会話の ID は main が振った・照合した ID から始める
- L-023: 本文の `hook_event_name` とパスのイベントを照らし合わせる（PascalCase を選んだ理由の 1 つ）
- L-034: `--plugin-dir` の値は main が作った絶対パスだけ。起動の表でも絶対パスかを確かめる
- L-052: `copilot` の版を確かめる外部プロセスを足さない。PreToolUse の待ちは今の 5 秒の上限のまま
- L-059: 規則は実物の記録で決め、引数・環境・プラグインのフォルダの経路は偽の `copilot` と実物の node-pty の統合テストで確かめる。記録できなかった場面は既知の制約と実機の項目に回す
- L-060: 種類ごとの準備・精度の注記は `Record<AgentCliKind, …>`。`cliKind` の受け渡しと能力の差し替えの補助の欄は省略できない形にし、配線のテストと変異の確認を入れる
- L-061: 新しい状態（枠・持ち主の種類・ID を持たない区間）に対して入口を表にした
- L-079: 足す環境変数は今の `buildAgentEnv` の規則（取り除く一覧の後・Windows の大文字小文字の重複の除去）で足す
- L-403・L-435: 枠・トークン・追跡のセッションを pty の終了という同じ寿命で外す。終了の後始末の後に終わる書き直しを残さない（`closed`）
- L-591・L-354・L-606: 既存の `claude` の節の「ほかの CLI は区別しない」を直す。実機の項目の文言とログの形は実装の後に照らし合わせて確定する。時間の値は実装の値から書く
