# 利用者の全体のエージェントの指示ファイル 設計書

## 読み方

この設計書で「今」「今の」と書くのは、設計した時点（2026-11-07。main は `30ff85c`）のことを指す。
画面に出す文言はコードの書き方に合わせて半角の括弧で書き、そのまま実装の固定の文字列にする。

## 目的

エクスプローラーの「エージェントの指示ファイル」の節に、利用者の全体の指示ファイル（すべてのプロジェクトに効くもの）を並べ、開く・作成するをできるようにする。

- claude: `~/.claude/CLAUDE.md`
- copilot: `~/.copilot/copilot-instructions.md`

ROADMAP の「エージェント実行の支援（MVP の次）」の「エージェント向けの指示ファイル（`CLAUDE.md` など）の編集支援」の残りのうち、「利用者の全体の指示ファイル」に当たる。方針は前の PR の設計書（`docs/superpowers/specs/2026-11-07-agent-instruction-files-subfolders-design.md` の 7 章）で利用者が決めたもので、この設計書はそれを具体にする。

## 1. 背景

### 今の作り

- 節は `src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx`。見出しの右に `更新`、小見出し `このフォルダ` の下に表の行（`開く`・`作成`）、その直後に失敗の文言（`role="alert"`。1 か所だけ）、その下にサブフォルダの開閉のボタンと一覧がある
- 状態は `src/renderer/src/hooks/useAgentInstructionFiles.ts`。作成の途中は `creatingRef`（ref）と `isCreating`（state）で持ち、節のボタンを `aria-disabled` にする。`更新` は `refreshTree()` を 1 回呼ぶだけ
- 作成は IPC `agentInstructions:create`（`src/main/handlers/agentInstructionsHandlers.ts` → `src/main/agentInstructionFileCreator.ts`）。renderer は `expectedRoot`・`cliKind`・`fileId` だけを送り、パスと雛形は main が表（`src/shared/agentInstructionFiles.ts`）から決める
- 開くのは `useAppState` の `selectFile`（ツリーのノードを受け取る。diff タブを非アクティブにする処理が付く）。中で `fs:readFile` を呼ぶ
- ファイルの読み書きと監視の境界は、すべて「開いているフォルダ（許可フォルダ）の中」だけを許す
  - `fs:readFile`・`fs:writeFile`（`src/main/handlers/fileSystemHandlers.ts`）: `assertFileAccess`（`handlers/fileAccessGuard.ts`）→ `FolderAccessManager.assertWithinFolder`（realpath して許可フォルダの中か）
  - `fs:writeFileChecked`（`handlers/externalChangeHandlers.ts` → `src/main/checkedFileWrite.ts`）: realpath できれば `assertWithinFolder`、できなければ（削除された・ぶら下がったリンク）親で確かめて `wx` で作る
  - `fs:setWatchedFiles`（`handlers/externalChangeHandlers.ts`）: フォルダが無ければ監視を消す。各パスを `assertWithinFolder` で確かめ、通ったものだけを監視する（`src/main/openFileWatcher.ts` は親フォルダを非再帰で監視する）
  - 失敗の文言は `convertFsAccessError`（`src/main/fsErrorConverter.ts`）で、絶対パスを含む日本語の文言になる（例: `ファイルが見つかりません: /Users/…/x.md`）
- `fs:writeFile` は本番のコードからの呼び出しが無い（`renderer/src/lib/fileSystemApi.ts` のコメント。保存は `fs:writeFileChecked`）
- フォルダを切り替えると、renderer は未保存の確認をしてからタブを全部閉じる（`useFileSystem` の `closeAllTabsForFolderChange`）。main は許可を切り替えたときに監視を消す（`openFileWatcherLifecycle.ts`）
- エージェント CLI の環境変数は、main の `process.env` を写して作る（`src/main/agentCommand.ts` の `buildAgentEnv`）。ログインシェルから取り出すのは `PATH` だけ（`src/main/agentShellEnv.ts`）。`CLAUDE_CONFIG_DIR`・`COPILOT_HOME` は取り除く一覧（`REMOVED_AGENT_ENV_KEYS`）に無いので、main の値がそのまま CLI に渡る

### タブとパスの扱い（許可フォルダの外のファイルを開いたときに効く箇所）

`activeFilePath`・`openFile.path`・`openFiles`・`folderPath` を使う箇所を grep で洗い出した。

| 箇所                                                                                 | 今の挙動                                      | 全体の指示ファイルのタブでの挙動                                                                                             |
| ------------------------------------------------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| タブの名前（`components/editor/EditorTab.tsx`）                                      | ノードの `name` だけを出す。`title` は無い    | `name` を `~/…` の形にする（下の「開く」）。フォルダの `CLAUDE.md` のタブと区別できる                                        |
| 言語の判定（`lib/languageDetector.ts`）                                              | 名前の最後の `.` の後ろで決める               | `~/.claude/CLAUDE.md` でも `md` になる                                                                                       |
| 保存（`useFileEditing.saveFile` → `fs:writeFileChecked`）                            | 照合してから書く                              | main の境界で許す（下の「境界」）。照合・上書きの確認は今のまま                                                              |
| 外部の変更（`useExternalFileChanges` → `fs:setWatchedFiles`・`fs:readFile`）         | 開いているタブを監視し、未編集なら読み直す    | main の境界で許す。`~/.claude` を非再帰で監視する（名前で絞るので、CLI が書く `~/.claude` のほかのファイルでは読み直さない） |
| 未保存の確認・タブを閉じる（`closeTab`・`confirmDiscardAnyDirty`）                   | パスに依らない                                | 今のまま                                                                                                                     |
| フォルダの切り替え（`closeAllTabsForFolderChange`）                                  | 全タブを閉じる                                | 全体の指示ファイルのタブも閉じる（今のまま。下の「決めたこと」）                                                             |
| リネーム・削除の追随（`useFileTreeOperations`）                                      | ツリーの操作の対象の中のタブだけ              | ツリーに出ないので当たらない                                                                                                 |
| クイックオープンの最近のファイル（`useQuickOpen`）                                   | ツリーにあるものだけを出す                    | 出ない                                                                                                                       |
| ツリーの選択の強調（`App.tsx` の `openFilePath`）                                    | ツリーのノードと比べる                        | 何も強調しない                                                                                                               |
| エージェントへの参照（`lib/agentReferences.ts`・`agentReferenceCandidates.ts`）      | フォルダの外は `outsideFolder` で参照にしない | `フォルダの外のファイルは参照にできません` が出る（今のまま）                                                                |
| 従来の方式の実行（`usePromptRunner`）                                                | 選択中のタブの中身を文脈として送る            | 全体の指示ファイルのタブを選んでいれば、その中身も送る（ほかのタブと同じ）                                                   |
| 相対パスの計算（`lib/quickOpenSearch.ts`・`agentReferences.ts`・指示ファイルの探索） | フォルダの中のものだけを相対にする            | 当たらない（ツリーに無い・参照にしない）                                                                                     |

許可フォルダの中を前提にして壊れる箇所は、main の境界（読む・保存する・監視する）だけだった。

### 調べた CLI の挙動

**Claude Code 2.1.291**

- 既定の場所は実物で確かめた。信頼済みのフォルダ（このリポジトリ）で、pty から `claude` を起動して `/memory` を開き、画面を読み取った。`User instructions` の行に `Saved in ~/.claude/CLAUDE.md` と出た（ファイルが無い状態。`/memory` は開いただけで何も選んでいない）
- `CLAUDE_CONFIG_DIR` を付けたときの場所は、画面では確かめられなかった。空の一時フォルダを `CLAUDE_CONFIG_DIR` にして起動すると、その設定のフォルダにはログインの記録が無いので、テーマの選択とログインの方法の選択（初回の手順）が出て、`/memory` まで進めない。利用者の認証情報を写したりログインし直したりはしなかった。代わりに、実行ファイルに埋め込まれた文字列を根拠にする
  - 全体の指示ファイルは「設定のフォルダ」の下の `CLAUDE.md`（`case"User":return ze(we(),"CLAUDE.md")`）
  - 設定のフォルダは `CLAUDE_CONFIG_DIR`、無ければ `~/.claude`（`os.homedir()` の下）。値が空のときの扱いは場所によって `||`（空なら既定）と `??`（空のまま使う）が混ざっており、空の文字列のときにどこを読むかは決められない
  - 相対パスは CLI 自身も正しい値として扱わない。設定のフォルダが絶対パスでないときに `relative_config_home`（`the configuration home (CLAUDE_CONFIG_DIR) is not an absolute path`）という理由で処理を断る箇所がある。このため、相対パスを `unavailable` にする
  - VS Code の拡張の変更履歴に「`CLAUDE_CONFIG_DIR` は絶対パスのときだけ使う」とある
  - 設定ファイル（`settings.json`）の `env` に書いた `CLAUDE_CONFIG_DIR` も読む（`env` から `CLAUDE_CONFIG_DIR` を取り除いて書き直す処理と、`process.env.CLAUDE_CONFIG_DIR` を優先して子プロセスに渡す処理がある）。このアプリは `process.env` だけを見る（5 章）

**GitHub Copilot CLI 1.0.106**（一時の git リポジトリで `copilot instruction list` を実行して確かめた）

- `COPILOT_HOME` に絶対パスを入れると、`<COPILOT_HOME>/copilot-instructions.md` を「Personal instructions」として読んだ
- `COPILOT_HOME` が空のときは既定（`~/.copilot`）と同じ結果だった。読み込みの入口（`index.js`）も `process.env.COPILOT_HOME||join(HOME||USERPROFILE,".copilot")` と書いている
- `COPILOT_HOME=rel`（相対パス）では、CLI の `cwd` からの `rel/copilot-instructions.md` を読んだ。このアプリは開いているフォルダを `cwd` にして起動するので、相対パスはプロジェクトの中を指す
- `COPILOT_HOME` がシンボリックリンクのフォルダでも、その下のファイルを読んだ

## 2. 決めたこと

利用者が前の PR で決めたこと（7 章「次の PR の方針」）:

- 開くことと作成することを許す。対象は main が持つ固定のパスだけ
- 読む・保存する・監視するのすべての入口の境界に、全体の指示ファイルの許可リストを足す（L-061）
- realpath とリンクを検査する（L-016）。realpath した先がホームの外を指すときは断る
- renderer は id だけを送る（L-018・L-019）
- 画面には「全部のプロジェクトに効きます」と出し、パスは `~/…` の形で出す（L-017）
- 「無い」と「失敗」を区別する（L-002）
- 節に小見出し `全体(すべてのプロジェクト)` を置く

この設計で決めたこと（利用者の意思が要る選択は無かったので、推奨の案で決めた）:

- **環境変数**: `CLAUDE_CONFIG_DIR`・`COPILOT_HOME` は、main の起動時の `process.env` から 1 回だけ決める。このアプリから起動する CLI は同じ `process.env` を受け取る（`buildAgentEnv`）ので、節に出す場所と CLI が読む場所が一致する。ログインシェルの値（`~/.zshrc` で設定したもの）は読まない。CLI もログインシェルからは `PATH` しか受け取らないため、読むと食い違う
  - 値が無い: 既定（`<ホーム>/.claude`・`<ホーム>/.copilot`）
  - 値が絶対パス: そのフォルダ。字面でホームの中（ホームそのものを含む）でなければ「扱えない」にする
  - copilot で値が空: 既定（実物で確かめた）
  - claude で値が空、または値が相対パス: 「場所を決められない」にする。既定に読み替えない（CLI がどこを読むか決められないため。L-044）
- **ホームの判定**: ホームは `os.homedir()`。リンクの検査では、対象を realpath した先が、ホームを realpath した先の中にあるかで判定する。`~/.claude` が `~/dotfiles/claude` へのリンク（ホームの中）なら許し、ホームの外（別のボリュームや `/tmp` など）なら断る
- **開く・保存・監視**: 既存の IPC（`fs:readFile`・`fs:writeFile`・`fs:writeFileChecked`・`fs:setWatchedFiles`）のまま扱う。renderer が送るパスは、main が問い合わせの結果で渡したパスと文字列として完全に一致するときだけ全体の指示ファイルとして扱う（前方一致や正規化はしない）。パスを決めるのは main で、renderer の値は表と照らすためだけに使う（L-018・L-019）。全体の指示ファイルに当たらないパスは、今までどおり許可フォルダの規則で確かめる
- **作成と有無の問い合わせ**: 新しい IPC を 2 つ足す。renderer は CLI の種類だけを送る
- **フォルダ（`~/.claude`・`~/.copilot`）が無いとき**: 作成で 1 段だけ作る（recursive にしない。権限は `0o700`。今の `~/.copilot` が `drwx------` で、CLI が秘密を置くフォルダのため）。作成の途中で失敗しても、作ったフォルダは消さない（L-004。今の `.claude`・`.github` と同じ）。設定のフォルダの親が無い（`CLAUDE_CONFIG_DIR=~/a/b` で `~/a` が無い）ときは作らずに失敗にする
- **フォルダの切り替え**: 全体の指示ファイルのタブも、今までどおり全部のタブと一緒に閉じる（未保存なら今の確認が出る）。新しいフォルダの節から開き直せる。残す例外を作ると、フォルダの切り替えの手順（走査の後の再確認・保存の無効化）に別の分岐が要るため
- **全体の指示ファイルの許可は、フォルダを開いているかに依らない**。固定のパスで、どのフォルダとも関係が無いため。画面の入口（節）はフォルダを開いているときだけ出る
- **作成のロック**: 今の作成（`lockPathForFileOperation`）は使わない。全体の指示ファイルのタブがあって外部で消されていた場合でも、作成は `wx` で書き、そのタブの保存は照合（`fs:writeFileChecked`）で `modified` になって上書きの確認が出るので、黙って上書きしない
- **失敗の文言**: main は、全体の指示ファイルの入口の失敗を、パスを含まない固定の文言にして返す（L-017）。エクスプローラーの赤字・保存の失敗の表示に絶対パスが出ない
- **行の場所**: `このフォルダ` の一覧の後、サブフォルダの開閉のボタンの前に置く（サブフォルダの一覧は開くと 40vh まで伸びるので、その後ろに置くと見えにくい）。失敗の文言（`role="alert"`）は 1 か所のまま、`全体(すべてのプロジェクト)` の一覧の直後に移す（L-249）

## 3. 設計

### 画面

```text
┌ エージェントの指示ファイル(Claude Code)          [更新] ┐
│ このフォルダ                                              │
│ CLAUDE.md            共有の指示                  [開く]  │
│ .claude/CLAUDE.md    共有の指示(.claude フォルダ) [作成]  │
│ CLAUDE.local.md      個人の指示                  [作成]  │
│ 全体(すべてのプロジェクト)                                │
│ ~/.claude/CLAUDE.md  個人の指示(全部のプロジェクトに      │
│                      効きます)                   [開く]  │
│ (失敗の文言。role="alert")                                │
│ ▸ サブフォルダ(3 件)                                      │
└─────────────────────────────────┘
```

- 小見出し（`h4`。`このフォルダ` と同じクラス）`全体(すべてのプロジェクト)` の下に、1 行だけの一覧（`<ul>`）を置く。行の見た目は `このフォルダ` の行と同じクラスを使う
- 行の状態ごとの表示:

| 状態                                              | パスの欄                           | 説明の欄                                                                  | ボタン |
| ------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------- | ------ |
| 問い合わせ中（最初の 1 回・CLI の切り替えの直後） | 無し                               | `確かめています…`                                                         | 無し   |
| ある                                              | `~/…`（例: `~/.claude/CLAUDE.md`） | 表の説明                                                                  | `開く` |
| 無い                                              | `~/…`                              | 表の説明                                                                  | `作成` |
| リンクがホームの外を指す                          | `~/…`                              | `ホームフォルダの外を指すリンクのため、開けません`                        | 無し   |
| 確かめられない                                    | `~/…`                              | `全体の指示ファイルの状態を確かめられませんでした(更新 で確かめ直せます)` | 無し   |
| 場所を決められない（環境変数）                    | 無し                               | 理由ごとの文言（下の「文言」）                                            | 無し   |
| 問い合わせの IPC が拒否された                     | 無し                               | `全体の指示ファイルの状態を確かめられませんでした(更新 で確かめ直せます)` | 無し   |

- 表の説明は claude・copilot とも `個人の指示(全部のプロジェクトに効きます)`
- `開く`・`作成` の押せない条件は `このフォルダ` の行と同じ（clone の実行中は `disabled`、作成の途中は `aria-disabled` で押しても何もしない。L-157・L-653）。`開く` は `AgentInstructionOpenButton`、`作成` は `AgentInstructionCreateButton`（SRP リファクタリングで、`このフォルダ` の行の `作成` と共通の部品にした）を使う
- 状態の文言（ボタンが無い行の説明）は `role="alert"` にしない。操作の失敗ではなく今の状態のため。押した操作の失敗は今の失敗の文言の枠に出す
- 狭いサイドバー（220px）では、今の行と同じく説明を折り返し、ボタンは行の右端に残す。`~/…` のパスは省略せずに折り返す

### 表（`src/shared/agentInstructionFiles.ts` に足す）

```ts
export type AgentGlobalInstructionFileId = 'claude-global' | 'copilot-global'

export interface AgentGlobalInstructionFile {
  id: AgentGlobalInstructionFileId
  /** 設定のフォルダを変える環境変数 */
  envName: 'CLAUDE_CONFIG_DIR' | 'COPILOT_HOME'
  /** 環境変数が無いときの、ホームの直下のフォルダの名前 */
  defaultDirName: '.claude' | '.copilot'
  /** 環境変数が空の文字列のとき、既定のフォルダとして扱うか(copilot は実物で確かめた。claude は決められない) */
  emptyEnvMeansDefault: boolean
  /** 設定のフォルダの中のファイル名 */
  fileName: string
  description: string
  template: string
}

export const AGENT_GLOBAL_INSTRUCTION_FILES: Record<AgentCliKind, AgentGlobalInstructionFile>
```

| CLI     | id               | envName             | defaultDirName | emptyEnvMeansDefault | fileName                  |
| ------- | ---------------- | ------------------- | -------------- | -------------------- | ------------------------- |
| claude  | `claude-global`  | `CLAUDE_CONFIG_DIR` | `.claude`      | false                | `CLAUDE.md`               |
| copilot | `copilot-global` | `COPILOT_HOME`      | `.copilot`     | true                 | `copilot-instructions.md` |

- 説明は両方とも `個人の指示(全部のプロジェクトに効きます)`
- 雛形は 1 行目を `# 全体の指示` にし、2 行目以降は今の雛形と同じ見出し（`TEMPLATE_SECTIONS`）にする。末尾は改行で終える
- renderer は description・envName（文言に環境変数の名前だけを入れる）・id（key）を読む。場所と雛形は main だけが使う（今の表と同じ置き方。CLI の対応を 1 か所で見比べられるようにする）

### 場所を決める（`src/main/globalAgentInstructionLocations.ts`。新規・純粋な関数）

```ts
export type GlobalAgentInstructionLocation =
  | {
      kind: 'resolved'
      file: AgentGlobalInstructionFile
      /** 設定のフォルダ(正規化した絶対パス。realpath はしない) */
      dirPath: string
      /** 全体の指示ファイルの絶対パス。renderer に渡し、境界で文字列として比べる */
      filePath: string
      /** 画面に出す `~/…` の形(区切りは /) */
      displayPath: string
    }
  | {
      kind: 'unavailable'
      file: AgentGlobalInstructionFile
      reason: 'envNotAbsolute' | 'envOutsideHome'
    }

export type GlobalAgentInstructionLocations = Record<AgentCliKind, GlobalAgentInstructionLocation>

export function resolveGlobalAgentInstructionLocations(args: {
  env: NodeJS.ProcessEnv
  homeDir: string
}): GlobalAgentInstructionLocations
```

- 手順（CLI ごと）: `env[file.envName]` を読む
  1. `undefined`、または空の文字列で `emptyEnvMeansDefault` が true → `join(homeDir, file.defaultDirName)`
  2. 空の文字列で `emptyEnvMeansDefault` が false、または `isAbsolute` でない → `unavailable`・`envNotAbsolute`
  3. 絶対パス → `resolve(value)`（`..` を畳む）
  4. 字面でホームの中か: `rel = relative(homeDir, dirPath)` とし、`rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)` のときを外とする（`isAbsolute` は Windows の別のドライブ）。外なら `unavailable`・`envOutsideHome`。`rel === ''`（ホームそのもの）と、`..x` のように `..` で始まる名前のフォルダ（`~/..x`）は中として扱う
  5. `rel === ''`（ホームそのもの）なら、`dirPath` をホームの文字列に揃える（`alignDirWithHome`）。Windows の `relative` は大文字小文字を区別しないが `resolve` は変えないため、揃えないと、作成・問い合わせの「ホームそのものか」の文字列の比較と食い違う（レビューで見つけて、このブランチで対応した）
  6. `filePath = join(dirPath, file.fileName)`、`displayPath = '~/' + relative(homeDir, filePath) を / でつないだもの`
- `src/main/ipcHandlers.ts` で、起動時に 1 回だけ `resolveGlobalAgentInstructionContext({ env: process.env, homeDir: resolve(homedir()) })` を呼び、`{ locations, homeDir }` の形の文脈（`GlobalAgentInstructionContext`）を受け口の登録に渡す（必須の引数。L-060）。`process.env` はアプリの中で書き換えないので、CLI の起動のたびに作る環境と同じ値になる
- ホームは `resolve` で正規化してから渡す。`HOME` の末尾に区切りが付いていると（例: `/Users/me/`）、`join` や `resolve` で作った `dirPath`・`filePath` との文字列の比較（ホームそのものかの判定など）がずれるため

```ts
/** 受け口の登録に渡す文脈(場所と、ホームの検査に使うホーム) */
export interface GlobalAgentInstructionContext {
  locations: GlobalAgentInstructionLocations
  /** resolve で正規化したホーム(realpath はしない) */
  homeDir: string
}

export function resolveGlobalAgentInstructionContext(args: {
  env: NodeJS.ProcessEnv
  homeDir: string
}): GlobalAgentInstructionContext
```

### 境界（`src/main/globalAgentInstructionAccess.ts`。新規）

```ts
/** 全体の指示ファイルの入口での拒否(ホームの外を指すリンク)。文言にパスを入れない */
export class GlobalAgentInstructionAccessDeniedError extends Error {}

/** renderer のパスが、どれかの CLI の全体の指示ファイルと文字列として完全に一致すれば、その場所を返す */
export function matchGlobalAgentInstructionPath(
  locations: GlobalAgentInstructionLocations,
  filePath: unknown
): Extract<GlobalAgentInstructionLocation, { kind: 'resolved' }> | null

/** realpath した先がホームの realpath の中か。違えば GlobalAgentInstructionAccessDeniedError。realpath の失敗はそのまま投げる */
export async function assertResolvedWithinHome(homeDir: string, path: string): Promise<string>
```

- `matchGlobalAgentInstructionPath` は `typeof filePath === 'string'` を確かめてから、`resolved` の場所の `filePath` と `===` で比べる。renderer が受け取るのは main が作った文字列そのものなので、正規化はしない（正規化すると、検証に使う値と実行に使う値がずれる。L-018）
- `assertResolvedWithinHome` は `realpath(path)` と `realpath(homeDir)` を比べ、前者が後者と等しいか、後者 + 区切りで始まるときだけ通す（`FolderAccessManager.toPrefix` と同じ書き方）。ホームの realpath は呼ぶたびに求める

### 入口の振り分け（`src/main/fileAccessScope.ts`。新規）

読む・保存する・監視するの 4 つの入口が、同じ関数で「どの規則で確かめるか」を決める（拒否の判定を入口ごとに写さない。L-061）。

```ts
export interface FileAccessScope {
  /** realpath して、許す範囲の中にある既存のファイルか。違えば・解決できなければ投げる */
  assertExisting(path: string): Promise<void>
  /** realpath できなかったファイル(削除された・ぶら下がったリンク)を wx で作り直してよいか。親で確かめる */
  assertRecreatable(path: string): Promise<void>
  /** 入口の失敗を renderer へ返す例外に変える(全体の指示ファイルはパスを含まない固定の文言) */
  toRendererError(err: unknown, operation: 'read' | 'write'): unknown
}

export function resolveFileAccessScope(
  deps: { folderAccess: FolderAccessManager; globalInstructions: GlobalAgentInstructionContext },
  ownerId: number,
  filePath: string
): FileAccessScope
```

- 全体の指示ファイルに一致したら、全体の規則の scope を返す
  - 全体の規則（ホームの中か）で断られても、許可フォルダが開いていて許可フォルダの規則で通れば許す（どちらも通らなければ全体の拒否を投げる）。`~/.claude` がホームの外へのリンクで、利用者が `~/.claude` そのものをフォルダとして開いた場合、ツリーのパスが全体のパスと一致するが、この変更の前は許可フォルダの中として読み書きできたため（今の規則より広げない。レビューで見つけて、このブランチで対応した）
  - `assertExisting`: `assertResolvedWithinHome(homeDir, path)`
  - `assertRecreatable`: 親（`dirname(path)`）を `assertResolvedWithinHome` で確かめる。親が無ければ（`~/.claude` が消えた）realpath の失敗を投げる（保存は失敗になる。フォルダは作らない。作るのは節の `作成` だけ）
  - `toRendererError`: `console.error` に元の例外を残し、`GlobalAgentInstructionAccessDeniedError` は `read` なら `全体の指示ファイルはホームフォルダの外を指しているため、開けません`、`write` なら `全体の指示ファイルはホームフォルダの外を指しているため、保存できません`、`isMissingPathError` は `全体の指示ファイルが見つかりません`、それ以外は `全体の指示ファイルを読み込めませんでした`（`read`）・`全体の指示ファイルを保存できませんでした`（`write`）の `Error` にする
- 一致しなければ、今の許可フォルダの規則の scope を返す。scope を作った時点の `folderAccess.get(ownerId)` を控え、`assertExisting`・`assertRecreatable` の 2 つの検査で同じ値を使う（2 つの検査の間にフォルダが切り替わっても、別のフォルダで確かめない。今の `fs:writeFileChecked` が `allowedFolder` を 1 回だけ読んで両方に渡しているのと同じ）
  - `assertExisting`: 控えた値で `assertWithinFolder`（控えた値が無ければ `No folder open` を投げる。今と同じ）
  - `assertRecreatable`: 控えた値で `assertFileWithinFolder`（今と同じ）
  - `toRendererError`: `convertFsAccessError(err, 'ファイルが見つかりません: <path>', path)`（今と同じ文言）
- 一致の判定は CLI の種類の設定に依らない（claude を選んでいる間に copilot の全体の指示ファイルのタブを開いたままでも、保存・監視できる）
- 渡されたパスが照合したパスと違えば、ホームの中でも拒否する（多重の防御。L-018）

### 入口ごとの扱い（L-061 の表）

`src/main/handlers/*.ts` と `src/preload/api.ts` から、ファイルのパスを受け取る入口を列挙した。

| 入口                                                                                           | 全体の指示ファイル         | 変更                                                                                                     |
| ---------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `fs:readFile`                                                                                  | 許す                       | `resolveFileAccessScope` → `assertExisting` → 読む。失敗は `toRendererError(err, 'read')`                |
| `fs:writeFile`                                                                                 | 許す（本番では呼ばれない） | 同じく `assertExisting` → 書く。失敗は `toRendererError(err, 'write')`                                   |
| `fs:writeFileChecked`                                                                          | 許す                       | `writeFileChecked` が scope を受け取る（下の「照合付きの保存」）。失敗は `toRendererError(err, 'write')` |
| `fs:setWatchedFiles`                                                                           | 許す                       | 各パスで scope を決めて `assertExisting`。フォルダが無いときも全体の指示ファイルは監視する               |
| `fs:readDirectory`                                                                             | 断る                       | 変えない（許可フォルダの根だけ）                                                                         |
| `fs:createFile`・`fs:createDirectory`・`fs:renameEntry`・`fs:deleteEntry`・`fs:addToGitignore` | 断る                       | 変えない（ツリーの操作。全体の指示ファイルはツリーに出ないので、renderer から呼ぶ経路が無い）            |
| `git:*`（`gitPathResolver` を通るもの）                                                        | 断る                       | 変えない                                                                                                 |
| `agentChanges:*`・エージェントへの参照                                                         | 断る                       | 変えない（フォルダの中だけ）                                                                             |
| `agentInstructions:create`                                                                     | 当たらない                 | 変えない                                                                                                 |
| `agentInstructions:getGlobalStatus`・`agentInstructions:createGlobal`                          | 対象                       | 新規（下）                                                                                               |

### 照合付きの保存（`src/main/checkedFileWrite.ts`）

- `CheckedFileWriteRequest` の `folderAccess`・`allowedFolder` を `scope: Pick<FileAccessScope, 'assertExisting' | 'assertRecreatable'>` に置き換える。手順は変えない（`assertExisting` が `isMissingPathError` で失敗したら `assertRecreatable` へ倒し、書き込みを `wx` にする）
- 受け口（`fs:writeFileChecked`）は scope を作って渡す。許可フォルダの scope の中身は今の 2 つの呼び出しそのままなので、フォルダの中のファイルの挙動は変わらない
- 全体の指示ファイルがリンク（ホームの中）なら、`writeFileContent`（`fs.writeFile`）がリンクを辿ってリンク先を書き換える。リンク自体は通常のファイルに置き換わらない（L-016。今の保存と同じ）

### 監視の登録（`fs:setWatchedFiles`）

- フォルダが無いときにすぐ `watcher.clear` して戻る今の分岐をやめ、各パスを scope で確かめる。許可フォルダの scope はフォルダが無ければ投げるので、フォルダの中のパスは今までどおり除かれる
- 「検証の間にフォルダが切り替わっていたら反映しない」は、開始時と終わりの `folderAccess.get(ownerId)` を比べる形のまま（`undefined` 同士も同じとみなす）。世代（`beginUpdate`・`isCurrentUpdate`）の扱いは変えない
- フォルダが無く、有効なパス（全体の指示ファイル）も無いときだけ、今までどおり `watcher.clear` する
- 監視は今の `OpenFileWatcher` のまま（`~/.claude` を非再帰で監視し、名前が開いているタブと一致したときだけ通知する）

### 有無の問い合わせ（IPC `agentInstructions:getGlobalStatus`）

- 引数: `(cliKind: unknown)`。`isAgentCliKind` で検証し、違えば例外（L-044）
- 戻り値（`src/shared/types/agentInstructions.ts` に足す）:

```ts
export type GlobalAgentInstructionStatus =
  | { kind: 'exists'; filePath: string; displayPath: string }
  | { kind: 'missing'; displayPath: string }
  | { kind: 'linkOutsideHome'; displayPath: string }
  | { kind: 'failed'; displayPath: string }
  | { kind: 'unavailable'; reason: 'envNotAbsolute' | 'envOutsideHome' }
```

- 絶対パス（`filePath`）を返すのは `exists` のときだけ（開くためにノードのパスとして使う。画面には出さない）
- 手順（`src/main/globalAgentInstructionStatus.ts`。新規）:
  1. 場所が `unavailable` → `unavailable`（理由はそのまま）
  2. `lstat(filePath)`: 成功したら 3 へ。`ENOENT` なら、作成で書く先を確かめる（下の 2a）。それ以外の失敗（`ENOTDIR`・`EACCES` など）→ `failed`
     - 2a. 設定のフォルダ（`dirPath`）を `assertResolvedWithinHome` で確かめる。通れば `missing`。`GlobalAgentInstructionAccessDeniedError` なら `linkOutsideHome`。`ENOENT` なら、先に `lstat(dirPath)` を見る。`lstat` が成功したら（ぶら下がったリンク。`mkdir` は `EEXIST` になり、realpath は通らないので作成は失敗し続ける）`failed`。`lstat` も `ENOENT`（フォルダが本当に無い）のときだけ、親（`dirname(dirPath)`）を同じく確かめる: 通れば `missing`（作成でフォルダを作れる）、`GlobalAgentInstructionAccessDeniedError` なら `linkOutsideHome`、それ以外（親も無い・読めない）なら `failed`。`dirPath` がホームそのものなら親は確かめない。それ以外の失敗は `failed`
  3. `assertResolvedWithinHome(homeDir, filePath)`: `GlobalAgentInstructionAccessDeniedError` → `linkOutsideHome`。realpath の失敗（ぶら下がったリンク・`ELOOP`）→ `failed`
  4. 解決した先を `stat` して通常のファイルでなければ（`CLAUDE.md` という名前のフォルダなど）→ `failed`
  5. → `exists`
- 例外は投げない（引数の検証の失敗だけを例外にする）。途中の例外は `console.error` に残し、`failed` にする
- 「無い」（`missing`）は、ファイルが `ENOENT` で、しかも作成で書く先（設定のフォルダ、無ければその親）がホームの中にあるときだけ。読めない・リンクが壊れている・ファイルでない・書く先がホームの外は「無い」にしない（L-002。「無い」にすると `作成` を出し、押しても毎回失敗して `作成` が出続ける）
- `~/.claude` がホームの外へのリンクで、その先に `CLAUDE.md` が無いとき: 手順 2 で `ENOENT`（`lstat` は途中のリンクを辿る）になり、2a で `linkOutsideHome` になる。`作成` は出ない
- 設定のフォルダの親も無いとき（`CLAUDE_CONFIG_DIR=~/a/b` で `~/a` が無い）は `failed`。作成は 1 段しかフォルダを作らないので、`作成` を出しても失敗するため（5 章）

### 作成（IPC `agentInstructions:createGlobal`）

- 引数: `(cliKind: unknown)`。`isAgentCliKind` で検証し、違えば例外
- 戻り値: `GlobalAgentInstructionCreateResult = { ok: true } | { ok: false; reason: 'exists' | 'outside' | 'failed' | 'unavailable' }`
- 手順（`src/main/globalAgentInstructionFileCreator.ts`。新規。途中の失敗は投げ、受け口が理由に変える）:
  1. 場所が `unavailable` → 受け口が `unavailable` を返す（作成を呼ばない）
  2. フォルダを作る前に、作る場所を確かめる。親（`dirname(dirPath)`）を `assertResolvedWithinHome(homeDir, …)` で確かめ、解決した親を得る。親がホームの外へのリンク（`CLAUDE_CONFIG_DIR=~/link/claude` で `~/link` がホームの外を指す）なら `GlobalAgentInstructionAccessDeniedError` で、何も作らない。親が無ければ realpath の失敗をそのまま投げる。`dirPath` がホームそのもののときは 2・3 を飛ばす（ホームはある）
  3. `mkdir(join(解決した親, basename(dirPath)), { mode: 0o700 })`（recursive なし）。作るのは確かめた親の直下だけで、字面の `dirPath` には作らない（確かめた値と作る場所をずらさない。L-018）。`EEXIST` は既にあるとして次へ（既にあるものがリンクでも、4 で確かめる）。それ以外は投げる
  4. `assertResolvedWithinHome(homeDir, join(解決した親, basename(dirPath)))` で解決済みのフォルダを得る（`dirPath` がホームそのもののときは、2・3 を飛ばしたので `dirPath` を確かめる）。フォルダ自体がホームの外へのリンクなら `GlobalAgentInstructionAccessDeniedError`。解決した先がフォルダでなければ `code = 'ENOTDIR'` の例外にする（今の `agentInstructionFileCreator` と同じ書き方）
  5. `createFileContent(join(解決済みのフォルダ, fileName), template)`（`wx`。既にあれば `EEXIST`。ぶら下がったリンクも辿らない）
- 理由への変換: `GlobalAgentInstructionAccessDeniedError` → `outside`、`EEXIST`・`ENOTDIR` → `exists`、それ以外 → `failed`。元の例外は `console.error`
- 3 で作ったフォルダは、5 が失敗しても消さない（L-004）
- 2 と 3 の間に親をリンクに差し替えられると、外に作りうる（今の作成と同じ隙。5 章）
- 今の `agentInstructions:create` と違い `expectedRoot` を受け取らない（書く場所がフォルダに依らないため。フォルダの切り替えの途中に押しても、書く場所は変わらない）

### preload と renderer の API

- `src/preload/api.ts`・`src/preload/index.d.ts`: `getGlobalAgentInstructionStatus(cliKind)`・`createGlobalAgentInstructionFile(cliKind)`
- `src/renderer/src/lib/agentInstructionsApi.ts`: `window.api` の薄い包みを 2 つ足す

### 状態（`src/renderer/src/hooks/useAgentInstructionFiles.ts`）

- hook の引数に、省略できない 2 つを足す（L-060）。`useAppState` が `agentInstructionsApi` の関数を渡す
  - `getGlobalStatus: (cliKind: AgentCliKind) => Promise<GlobalAgentInstructionStatus>`
  - `createGlobalFile: (cliKind: AgentCliKind) => Promise<GlobalAgentInstructionCreateResult>`
- 状態は `{ cliKind, status: GlobalAgentInstructionStatus | 'queryFailed' } | null` で持つ。描画では、持っている `cliKind` が今の `cliKind` と違えば「問い合わせ中」として扱う（CLI を切り替えた直後に、前の CLI の行を出さない）
- 問い合わせ（内部の関数 `queryGlobalStatus()`）:
  - 世代の番号（ref）を進めてから IPC を呼び、結果が最新の世代で、開始時の CLI の種類が今と同じときだけ反映する（L-037・L-040）
  - IPC が拒否されたら `console.error` に残し、`queryFailed` にする（「無い」にしない。L-002）
  - 呼ぶきっかけ: hook のマウント時（hook は `useAppState` の中にあり、アプリの起動時にマウントされる。節の表示とは関係しない）・CLI の種類が変わったとき・フォルダが変わったとき（`folderPath` が変わったとき。フォルダを開いた時点で節が出るので、その時点の有無を出すため。場所はフォルダに依らないが、問い合わせは軽いので、外部で足した・消したものを拾う機会として問い合わせ直す）・`更新`・作成の後（成功・失敗とも）。`useEffect` の依存を `cliKind` と `folderPath` にする。StrictMode の 2 回目も世代で古い方を捨てる
- 行の値は、状態から表示用の行（`AgentGlobalInstructionRow`。`src/renderer/src/types.ts`）を作る純粋な関数（`lib/agentGlobalInstructionRow.ts`）で決める。`exists` のときだけ、ツリーのノードの形 `{ type: 'file', name: displayPath, path: filePath }` を行に入れる
- `openGlobal()`: 行が `exists` のときだけ、今の `openNode` を呼ぶ（作成の途中は何もしない・失敗の文言を消す・`openFile`〈`useAppState` の `selectFile`〉）。読み込みの失敗は `selectFile` がエクスプローラーの赤字に出す（文言は main の固定のもの）
- `createGlobal()` の手順:
  1. 作成の途中（`creatingRef`。今の作成と共有する）なら何もしない。`creatingRef`・`isCreating` を立て、失敗の文言を消す
  2. 開始時のフォルダと CLI の種類（`cliKindAtStart`）を控え、`createGlobalFile(cliKindAtStart)` を呼ぶ
  3. 結果に関係なく、行の問い合わせ `queryGlobalStatus()`（今の CLI の種類で問い合わせて行に反映する）を始める（失敗したときも、外で作られたファイルが出て `開く` に変わる。今の作成の「失敗したら読み直す」と同じ）。`ok: true` なら、開くためのノードを得るために `getGlobalStatus(cliKindAtStart)` も待つ（作ったのは開始時の CLI のファイルなので、待つ間に CLI を切り替えても、そのファイルを開く）
  4. 待つ間にフォルダが変わっていたら、ここで終える（文言も出さず、開かない）。今の `create` と同じ扱い（今の `create` はフォルダが変わったら何もしない）。全体の指示ファイルはフォルダに依らないが、フォルダの走査の途中にタブを開くと、走査の後にタブを閉じる判定（`committedOpenRef`）が働かず前のフォルダのタブが残るため、今の作成と揃える。作れたファイルは、新しいフォルダの節の行（問い合わせ直して `開く` になる）から開ける
  5. 待つ間に CLI の種類だけが変わっていたときは、今の `create` と同じく文言だけを止め、作れたファイルは開く（利用者が押した操作のため）
  6. `ok: true` で、3 の結果が `exists` なら、そのノードを `openFile` で開く。`exists` でなければ（作成が成功したあとの `getGlobalStatus(cliKindAtStart)` が拒否されたときも同じ）`作成しましたが、開けませんでした。節の 更新 を押してから開いてください` を出す（CLI の種類が変わっていれば出さない）。`openFile` が拒否されたら `console.error` に残し、同じ `作成しましたが、開けませんでした…` を出す（ファイルは作れていて行も `開く` に変わっているので、`作成できませんでした` とは言わない。CLI の種類が変わっていれば出さない）
  7. `ok: false` は理由の文言を出す。IPC の拒否は `failed` の文言を出し、例外は `console.error`（どちらも CLI の種類が変わっていれば出さない）
  8. `finally` で `creatingRef`・`isCreating` を下ろす
- `refresh()`（`更新`）: 今の手順の `await refreshTree()` を、`refreshTree()` と `queryGlobalStatus()` を並べて待つ形（`Promise.allSettled`）に変える。`isRefreshing` は両方が終わるまで立てる。`refreshTree` の拒否の扱い（固定の文言を出す）は今のまま。問い合わせの失敗は行の状態（`queryFailed`）で伝え、失敗の文言の枠には出さない（行に出るので 2 か所に出さない。L-249）
- 戻り値の `AgentInstructionsPanelState` に足す:

```ts
/** 全体の指示ファイルの行(状態ごとの表示とノード) */
globalRow: AgentGlobalInstructionRow
openGlobal: () => void
createGlobal: () => Promise<void>
```

```ts
export type AgentGlobalInstructionRow =
  | { kind: 'loading' }
  | { kind: 'exists'; displayPath: string; description: string; node: FileTreeNode }
  | { kind: 'missing'; displayPath: string; description: string }
  | { kind: 'blocked'; displayPath: string | null; message: string }
```

- `blocked` の `message` は「状態ごとの表示」の表の文言（`linkOutsideHome`・`failed`・`unavailable` の理由・`queryFailed`）

### 部品

- `src/shared/agentInstructionFiles.ts`: `AGENT_GLOBAL_INSTRUCTION_FILES` と型
- `src/shared/types/agentInstructions.ts`: `GlobalAgentInstructionStatus`・`GlobalAgentInstructionCreateResult`
- `src/main/globalAgentInstructionLocations.ts`（新規）: 環境変数とホームから場所を決める
- `src/main/globalAgentInstructionAccess.ts`（新規）: 一致の判定・ホームの中かの検査・拒否の例外
- `src/main/globalAgentInstructionStatus.ts`（新規）: 有無の問い合わせ
- `src/main/globalAgentInstructionFileCreator.ts`（新規）: 作成
- `src/main/fileAccessScope.ts`（新規）: 入口の振り分けと、失敗の文言の変換
- `src/main/checkedFileWrite.ts`: scope を受け取る
- `src/main/handlers/fileSystemHandlers.ts`: `fs:readFile`・`fs:writeFile` を scope に通す。`registerFileSystemHandlers` に場所とホームを渡す
- `src/main/handlers/fileAccessGuard.ts`: `assertFileAccess` を削除（入口が `resolveFileAccessScope` に移ったため）
- `src/main/handlers/externalChangeHandlers.ts`: `fs:writeFileChecked`・`fs:setWatchedFiles` を scope に通す
- `src/main/__tests__/helpers/globalAgentInstructionContext.ts`（新規）: 全体の指示ファイルが存在しない文脈（`NO_GLOBAL_INSTRUCTIONS`）。既存の受け口のテストが使う
- `src/main/handlers/agentInstructionsHandlers.ts`: 2 つの受け口と引数の検証
- `src/main/ipcHandlers.ts`: 起動時に場所を決め、3 つの登録関数に渡す
- `src/preload/api.ts`・`src/preload/index.d.ts`: 2 つの API
- `src/renderer/src/lib/agentInstructionsApi.ts`: 2 つの包み
- `src/renderer/src/lib/agentInstructionMessages.ts`: 下の「文言」
- `src/renderer/src/lib/agentGlobalInstructionRow.ts`（新規）: 状態から表示用の行を作る
- `src/renderer/src/types.ts`: `AgentGlobalInstructionRow` と `AgentInstructionsPanelState` の追加
- `src/renderer/src/hooks/useAgentInstructionFiles.ts`: 問い合わせ・`openGlobal`・`createGlobal`・`refresh` の変更
- `src/renderer/src/hooks/useAppState.ts`: 2 つの API を hook に渡す
- `src/renderer/src/__tests__/renderAgentInstructionFiles.ts`（新規。SRP リファクタリングで追加）: `useAgentInstructionFiles.test.ts` と `useAgentInstructionFiles.global.test.ts` で共通のテスト用の描画の補助
- `src/renderer/src/components/explorer/AgentInstructionGlobalList.tsx`（新規）: 小見出しと 1 行の一覧。状態ごとの表示とボタン
- `src/renderer/src/components/explorer/AgentInstructionCreateButton.tsx`（新規。SRP リファクタリングで追加）: `このフォルダ` と全体で共通の `作成`。clone 中は `disabled`、作成の途中は `aria-disabled` にする判定をここに集める（L-157。`AgentInstructionOpenButton` と同じ形）
- `src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx`: `このフォルダ` の一覧の後に `AgentInstructionGlobalList` を置き、失敗の文言をその後ろへ移す
- `src/renderer/src/assets/main.css`: 足すものは無い見込み（今の `agentInstructions__*` のクラスを使う）。状態の文言は `__description` のクラスにする

### 文言（固定の文字列）

| 場所                                                                  | 文言                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 小見出し                                                              | `全体(すべてのプロジェクト)`                                                                                                                                                                                                                     |
| 行の説明（claude・copilot）                                           | `個人の指示(全部のプロジェクトに効きます)`                                                                                                                                                                                                       |
| 問い合わせ中                                                          | `確かめています…`                                                                                                                                                                                                                                |
| リンクがホームの外                                                    | `ホームフォルダの外を指すリンクのため、開けません`                                                                                                                                                                                               |
| 確かめられない（`failed`・`queryFailed`）                             | `全体の指示ファイルの状態を確かめられませんでした(更新 で確かめ直せます)`                                                                                                                                                                        |
| 環境変数が絶対パスでない                                              | `<環境変数の名前> が絶対パスでないため、全体の指示ファイルの場所を決められません`（例: `CLAUDE_CONFIG_DIR が絶対パスでないため、…`）                                                                                                             |
| 環境変数がホームの外                                                  | `<環境変数の名前> がホームフォルダの外を指すため、全体の指示ファイルを扱えません`                                                                                                                                                                |
| `開く`・`作成` の `aria-label`                                        | `<~/… のパス> を開く`・`<~/… のパス> を作成`                                                                                                                                                                                                     |
| 作成の失敗 `exists`                                                   | `同じ名前のファイルかフォルダが既にあります。節の 更新 を押して確かめてください`                                                                                                                                                                 |
| 作成の失敗 `outside`                                                  | `ホームフォルダの外には作成できません`                                                                                                                                                                                                           |
| 作成の失敗 `failed`・`unavailable`・IPC の拒否                        | `全体の指示ファイルを作成できませんでした`                                                                                                                                                                                                       |
| 作成の後に開けない(`getGlobalStatus` の拒否・`openFile` の拒否を含む) | `作成しましたが、開けませんでした。節の 更新 を押してから開いてください`                                                                                                                                                                         |
| `更新` の `title`（変更）                                             | `ファイルツリーを読み直し、全体の指示ファイルの有無も確かめ直します`                                                                                                                                                                             |
| main の読み込み・保存の失敗（`fileAccessScope`）                      | `全体の指示ファイルが見つかりません`・`全体の指示ファイルを読み込めませんでした`・`全体の指示ファイルを保存できませんでした`・`全体の指示ファイルはホームフォルダの外を指しているため、開けません`（保存で断ったときは `…ため、保存できません`） |

- 環境変数の名前は表の `envName` から入れる（利用者が設定した値は出さない）
- 画面に出すパスは `~/…` だけ。絶対パス・環境変数の値・例外の文言は出さない（L-017）

### アクセシビリティ

- 小見出しは `h4`（`このフォルダ` と同じ階層）。行は `<ul>` の `<li>` 1 つ
- 行の key は CLI の表の `id`（`claude-global`・`copilot-global`）。表示文言を key にしない
- 状態が変わっても読み上げ（live region）はしない（問い合わせのたびに割り込まないため）。押した操作の失敗だけを今の `role="alert"` で伝える
- `作成` を押した後、行が `開く` に変わるとボタンが入れ替わる。今の `このフォルダ` の作成と同じく、作成の後はファイルを開いてエディタへ移る経路なので、フォーカスの落ち先は今の作成と同じ扱いにする（新しい対処は足さない）

## 4. テスト方針

- 表（`src/shared/__tests__/agentInstructionFiles.test.ts` に足す）: CLI ごとに 1 つあり、id が今の表の id と重ならない、`fileName` に区切りを含まない、雛形が `# 全体の指示` で始まり改行で終わる
- 場所（`src/main/__tests__/globalAgentInstructionLocations.test.ts`。純粋）: 環境変数が無い・絶対パス・`..` を含む絶対パス（畳む）・相対パス・空（claude は `envNotAbsolute`、copilot は既定）・ホームの外（`~/../other`）・ホームそのもの・ホームそのものの大文字小文字の違い（`win32.relative` を渡して `alignDirWithHome` がホームの文字列に揃える）・`..` で始まる名前のフォルダ（`~/..x`。中として扱う）・`displayPath` の形（`~/` と `/` 区切り）
- 境界（`globalAgentInstructionAccess.test.ts`。実ファイルの一時フォルダを偽のホームにする。後始末は `removeTempPathSync` などのガードを通す。L-618）
  - 一致: 完全一致だけ。末尾の区切り・大文字小文字・`..` を含む書き方は一致しない。文字列でない値は null
  - 一致: 照合は `AGENT_CLI_KINDS` で回す。テストも `it.each(AGENT_CLI_KINDS)` で、CLI を足すと自動で対象になる
  - ホームの中のファイル・ホームの中を指すリンク・ホームの中を指すリンクのフォルダの下のファイルを通す
  - ホームの外を指すリンク（ファイル・フォルダ）を `GlobalAgentInstructionAccessDeniedError` で断る
  - ぶら下がったリンクは realpath の失敗を投げる
- 入口の振り分け（`fileAccessScope.test.ts`）: 全体の指示ファイルはフォルダが無くても通る、作ったときと違うパスは 2 つの検査とも断る、ほかのパスは許可フォルダの規則（フォルダの外は断る）、許可フォルダの値は作った時点で控え、2 つの検査とも同じフォルダで確かめる、ホームの外へのリンクは拒否する、全体のパスと一致しホームの外へのリンクでも許可フォルダの中なら通る（外なら全体の拒否のまま）、全体の指示ファイルの失敗の文言にパスが入らない（拒否〈読む・保存する〉・`ENOENT`・`EACCES`〈読む・保存する〉）、フォルダのファイルの文言は今と同じ
- 入口の実ファイル（`handlers/globalInstructionEntrances.fs.test.ts`）: `fs:readFile`・`fs:writeFile`・`fs:writeFileChecked`・`fs:setWatchedFiles`（フォルダが無いとき・あるとき）を実ファイルで通す。フォルダの外のほかのパスと、変えない入口（`fs:renameEntry`・`fs:deleteEntry`）は断る。消えたファイル・ホームの外へのリンクの拒否の文言にパスが入らない
- 照合付きの保存（`checkedFileWrite.global.test.ts`）: 全体の scope で、ホームの中のリンクを辿ってリンク先を書き換え、リンクは残る。消えたファイルは `wx` で作り直す。ホームの外を指すぶら下がったリンクは辿らない（`modified`）
- 受け口（全体の指示ファイルの受け口のテストは `handlers/globalInstructionEntrances.fs.test.ts` に置く。既存の `fileSystemHandlers`・`externalChangeHandlers` のテストは `NO_GLOBAL_INSTRUCTIONS` を渡して今の挙動を固定する）: `fs:readFile`・`fs:writeFile`・`fs:writeFileChecked` が全体の指示ファイルを許し、フォルダの外のほかのパスを今までどおり断る。`fs:setWatchedFiles` がフォルダが無いときも全体の指示ファイルだけを監視し、フォルダの外のほかのパスを除く
- 有無の問い合わせ（`globalAgentInstructionStatus.test.ts`。実ファイル）: `exists`・`missing`（フォルダがある・フォルダが無く親がある）・ホームの外を指すファイルのリンク（`linkOutsideHome`）・設定のフォルダがホームの外へのリンクで中にファイルが無い（`linkOutsideHome`。`missing` にならない）・設定のフォルダが無く親がホームの外へのリンク（`linkOutsideHome`）・設定のフォルダの親も無い（`failed`）・設定のフォルダがぶら下がったリンク（`failed`。`missing` にならない）・ぶら下がったリンク（`failed`）・同じ名前のフォルダ（`failed`）・読めない親フォルダ（`chmod 000`。`failed`。Windows では飛ばす）・`unavailable`。`missing` に `filePath` が入らない
- 作成（`globalAgentInstructionFileCreator.test.ts`・後始末は `globalAgentInstructionFileCreator.cleanup.test.ts`。実ファイル）: フォルダが無ければ `0o700` で作ってから書く、フォルダがあればそのまま書く、既にあれば `EEXIST` で中身が変わらない、フォルダがホームの外へのリンクなら拒否して外に何も書かない、親がホームの外へのリンク（`~/link/claude`）なら拒否して外にフォルダもファイルも作らない（リンク先の中身が空のままであることを確かめる。mkdir を検査の前に戻すと落ちることも確かめる）、フォルダが同じ名前のファイルなら `ENOTDIR`、設定のフォルダの親が無ければ失敗して何も作らない、設定のフォルダがホームそのものならフォルダを作らずに書く、5 が失敗しても 3 で作ったフォルダは残る
- 受け口（`agentInstructionsHandlers.test.ts` に足す）: 不正な `cliKind` を例外にする、`unavailable` の場所で作成を呼ばない、例外を理由に変える、戻り値に文言・パスが入らない
- preload: 2 つの API が正しいチャンネルと引数で呼ぶ
- 行（`agentGlobalInstructionRow.test.ts`。純粋）: 状態ごとの行、持っている CLI の種類が違えば `loading`、`exists` だけがノードを持ち、ノードの `name` が `displayPath`
- hook（全体の指示ファイルは `useAgentInstructionFiles.global.test.ts`。変更理由が違うので `useAgentInstructionFiles.test.ts` から分けた。SRP リファクタリング）
  - マウント時に問い合わせる。フォルダを変えると問い合わせ直す。CLI を切り替えると、結果が出るまで `loading` になり、新しい CLI で問い合わせる。古い問い合わせの結果を反映しない（遅れて解決させる）
  - 問い合わせの拒否で `queryFailed` になり、`missing` にならない
  - `openGlobal` が `exists` のノードを `openFile` に渡す。作成の途中は呼ばない
  - `createGlobal`: 成功で問い合わせ直してから開く。開けないときの文言。作れたあとに `openFile` が拒否されたとき（`console.error` と開けない文言）、作れたあとの `getGlobalStatus` が拒否されたとき（`console.error` と開けない文言）。文言を出す 3 つの経路（失敗 `exists`・作成後の `openFile` の拒否・作成後の問い合わせが `exists` でない）はいずれも、待つ間に CLI の種類が変わっていれば出さない（それぞれ保留してから CLI を変えて確かめる）。失敗の理由ごとの文言と、失敗の後も問い合わせ直す。作成の途中の 2 回目を無視する（同じ tick の 2 回でも 1 回）。待つ間にフォルダを変えると開かず文言も出さない。待つ間に CLI の種類だけを変えると、開始時の CLI の種類で問い合わせて作ったファイルを開き、失敗の文言は出さない。IPC の拒否で `failed` の文言
  - `refresh`: `refreshTree` と問い合わせの両方を呼び、両方が終わるまで `isRefreshing`。問い合わせの失敗では失敗の文言の枠に何も出さない
- 部品（`AgentInstructionGlobalList.test.tsx`・`AgentInstructionCreateButton.test.tsx`〔`作成` の押せない条件。`このフォルダ` と全体で共通〕と節のテストに足す）: 小見出し、状態ごとの説明とボタン、`aria-label`、clone 中の `disabled`、作成の途中の `aria-disabled`（押しても呼ばない・フォーカスが残る）。節では、失敗の文言が全体の一覧の後・サブフォルダの開閉のボタンの前にある
- 配線（`App` の統合のテスト）: 問い合わせが `exists` を返すと `~/.claude/CLAUDE.md を開く` が出て、押すとそのパスで `readFile` が呼ばれ、タブの名前が `~/.claude/CLAUDE.md` になる。`missing` で `作成` を押すと `createGlobalAgentInstructionFile` が呼ばれる。`更新` で問い合わせがもう一度呼ばれる
- 実物（L-059）: 場所の規則は、Copilot CLI 1.0.106 で `COPILOT_HOME`（絶対・空・相対・リンク）を確かめた結果と、Claude Code 2.1.291 の `/memory` の表示（既定の `~/.claude/CLAUDE.md`）と実行ファイルの文字列（`CLAUDE_CONFIG_DIR` の扱い）に合わせる。実機では EXP-100〜116 で確かめる
- 全体の検証: `npm test`（`NODE_ENV=test`）・`npm run typecheck`・変更したファイルへの `npx eslint`・`npx vitest run scripts`

## 5. 既知の制約

- 場所はアプリの起動時の環境変数で決める。Dock などから起動したアプリには `~/.zshrc` で設定した `CLAUDE_CONFIG_DIR`・`COPILOT_HOME` が届かないので、既定の場所が出る。このアプリから起動した CLI も同じ値を受け取るので食い違わないが、利用者が自分のターミナルで起動した CLI は別の場所を読むことがある。アプリを起動した後に環境変数を変えても、アプリを起動し直すまで反映しない
- `CLAUDE_CONFIG_DIR` が空・相対パスのとき、`COPILOT_HOME` が相対パスのときは、場所を決められないとして行を出すだけにする（開く・作成しない）
- 設定のフォルダがホームの外（環境変数・リンクのどちらでも）なら扱わない。dotfiles をホームの外のボリュームに置いてリンクしている場合も開けない
- Claude Code の既定の場所（`~/.claude/CLAUDE.md`）は `/memory` の表示で確かめたが、`CLAUDE_CONFIG_DIR` を付けたときの場所は実行ファイルの文字列から読んだもので、画面では確かめていない（新しい設定のフォルダでは初回の手順〈テーマ・ログインの方法の選択〉が出て、`/memory` まで進めないため。利用者の認証情報は写さなかった）。`CLAUDE_CONFIG_DIR` の値を Unicode の NFC に揃える処理（文字列に見える）は真似していない
- Claude Code は設定ファイル（`settings.json`）の `env` に書いた `CLAUDE_CONFIG_DIR` も使う。このアプリは `process.env` だけを見るので、設定ファイルにだけ書いた場合は、節に出す場所と CLI が読む場所が食い違いうる
- realpath した先がホームの中なら、`~/.ssh` などホームの中の別のファイルへのリンクでも開ける・保存できる（方針どおり。そのリンクを作るには、もともとホームに書ける必要がある）
- 設定のフォルダの親も無いとき（`CLAUDE_CONFIG_DIR=~/a/b` で `~/a` が無い）は、行が「確かめられない」になる。フォルダは 1 段しか作らないので、親は利用者が作る
- 作成で親を確かめてからフォルダを作るまでの間に、親をホームの外へのリンクに差し替えられると、外にフォルダを作りうる（今の作成と同じ隙）
- Windows では確かめていない。copilot は `HOME` を `USERPROFILE` より先に見るが、このアプリは `os.homedir()`（Windows では `USERPROFILE`）を使うので、Git Bash などで `HOME` が違う値のときは食い違う
- 外部（ターミナルや CLI）で作った・消した全体の指示ファイルは、次のきっかけ（節の `更新`・CLI の種類の切り替え・フォルダの切り替え・全体の作成の後）まで行に反映しない
- 開いているタブのパスと境界の照合は文字列の完全一致なので、全体の指示ファイルを別の書き方のパス（ホームを開いたときのツリーのパスが realpath の違いで別の文字列になる場合など）で開くと、許可フォルダの規則で確かめる
- 確かめてから読み書きするまでの間にリンクを差し替えられると、ホームの外を書きうる（今の許可フォルダの境界と同じ隙。L-016）
- 全体の指示ファイルのタブは、フォルダを切り替えると閉じる。クイックオープンの最近のファイルには出ず、エージェントへの参照にもできない（`フォルダの外のファイルは参照にできません`）
- 従来の方式でプロンプトを実行すると、選択中のタブが全体の指示ファイルなら、その中身も文脈として送る（ほかのタブと同じ）
- 大文字小文字を区別しないファイルシステム（macOS の既定・Windows）では、`~/.claude/claude.md` のように綴りの違うファイルも有無の確かめ（`lstat`）で「ある」になり、開ける（CLI も同じファイルを読む）。ただし監視はファイル名の文字列の完全一致で絞るので、外部の変更で自動では読み直さない（フォーカスの復帰での確かめには任せられる）。「このフォルダ」の行はフォルダの一覧の名前で判定するので、綴りの違うファイルは「無い」になり、扱いが違う
- 監視は `~/.claude` を非再帰で見る。CLI が `~/.claude` の別のファイルを頻繁に書いても、名前で絞るので読み直しはしないが、監視の通知そのものは届く
- 全体の指示ファイルのうち、`~/.claude/rules/`・`~/.copilot/instructions/*.instructions.md`・managed-policy の `CLAUDE.md` は対象にしない

## 6. 気をつける知見の ID

- L-002 「無い」と「失敗」（`ENOENT` だけを `missing` にする。問い合わせの拒否は `queryFailed`）
- L-004 後始末で他の物を消す（作ったフォルダは消さない。作成は `wx` と再帰しない `mkdir`）
- L-016 シンボリックリンク（realpath でホームの中か確かめる。保存はリンクを辿り、リンクを通常のファイルに置き換えない。作り直しは `wx`）
- L-017 パスを画面に出さない（`~/…` だけ。main の失敗の文言を固定にする）
- L-018・L-019 renderer の値でパスを決めさせない（id と CLI の種類だけを送る。パスは main が作った文字列と完全一致のときだけ。正規化しない）
- L-044 受け付けない入力を既定に流さない（不正な `cliKind` は例外。空・相対の環境変数を既定に読み替えない〈copilot の空は実物の挙動〉）
- L-049 許可リストが正常な入力を拒む（dotfiles のリンク〈ホームの中〉を通すテストを書く）
- L-059 CLI の実物の挙動（copilot は実行で確かめた。claude は既定の場所を `/memory` の表示で確かめ、`CLAUDE_CONFIG_DIR` の扱いは文字列だけ）
- L-061 新しい入口が既存の守りを通るか（4 つの入口を 1 つの振り分けの関数に通す。入口の表を設計書に置く）
- L-072 手動テストが利用者の設定を壊さない（実機の手順は `$HOME` の下に作った専用のフォルダを環境変数で指し、利用者の `~/.claude/CLAUDE.md`・`~/.copilot/copilot-instructions.md` を作らない・書かない）
- L-037・L-040 古い結果（問い合わせは世代と CLI の種類で古い結果を捨てる）
- L-060 省略可能な props（hook の新しい引数・部品の props・登録関数の新しい引数は必須）
- L-157 押したボタンのフォーカス（作成の途中は `aria-disabled`）
- L-249 結果の表示先（失敗の文言は 1 か所のまま、全体の一覧の直後に移す。問い合わせの失敗は行に出し、失敗の枠には出さない）
- L-466 CLI の種類は `appCliKind` を受け取る
- L-469 StrictMode の二重実行（問い合わせの effect に「初回だけ」の ref を使わず、世代で古い方を捨てる）
- L-618 テストの後始末の再帰削除（偽のホームの一時フォルダはガードを通して消す）
- L-653 作成の連打（今の `creatingRef` を共有する）
- L-693 縦の flex の節（行が 1 つ増えるだけ。今の `flex: 0 1 auto` のまま縮んで中でスクロールする。低いウィンドウでの確認を EXP-099 に残す。全体の行の失敗の文言が低いウィンドウで見えることは EXP-106 で確かめる）
- L-694 利用者の選択を覆さない（前の PR の方針のうち、「設計の前に `/memory` の画面などで実物を確かめる」だけは、`CLAUDE_CONFIG_DIR` を付けたときの場所を実行ファイルの文字列で代えた。理由は 1 章と 5 章。ほかの方針は変えていない）
- L-199・L-203 文言と文書の同期（`更新` の `title`・失敗の文言の位置を変えるので、既存のテスト名・コメント・実機テスト仕様書の EXP-084・EXP-086・EXP-097・EXP-099 を同じ変更で直す。古い文言が 0 件になることを grep で確かめる）

## 7. 実機テスト仕様書の項目の案

`docs/manual-test-spec.md` の「サブフォルダのエージェントの指示ファイル」（`###`）の後に、新しい機能の見出し（`###`）を足し、EXP-100 から振る（今の `EXP` の最大は EXP-099）。

```markdown
### 全体のエージェントの指示ファイル

> 前提: アプリを終了しておく。端末を 2 つ使う。端末 A はコマンドを打つ端末、端末 B はアプリを起動する端末(`npm run dev` が前面を占めるので、ほかのコマンドは端末 A で打つ)。端末 A で `G="$HOME/prompt-ide-global-check" && mkdir "$G" && D3="$(mktemp -d)" && D4="$(mktemp -d)" && echo "$G" "$D3" "$D4"` を実行する(`$G` が既にあると `mkdir` が止まるので、そのときは中身を確かめてから別の名前にする)。端末 B で `G="$HOME/prompt-ide-global-check"` を設定し直し、リポジトリのフォルダに移って `CLAUDE_CONFIG_DIR="$G/claude" COPILOT_HOME="$G/copilot" npm run dev` でアプリを起動し、`フォルダを開く` で端末 A に表示した `$D3` を開く。今の設定の `使うエージェント CLI` の値を控えてから `Claude Code` にする(EXP-116 の最後で控えた値に戻す)。この節の間はエージェント CLI を起動しない(設定のフォルダが空なので、ログインを求められる)。利用者の `~/.claude`・`~/.copilot` の中のファイルは、EXP-116 で見るほかは作らない・書かない。`${G:?}` は、端末を開き直して `$G` が空のときは止まる。

- [ ] **EXP-100** エクスプローラーの節を見る → `このフォルダ` の 3 行の下に小見出し `全体(すべてのプロジェクト)` があり、`~/prompt-ide-global-check/claude/CLAUDE.md`(説明 `個人の指示(全部のプロジェクトに効きます)`)の行に `作成` がある。その下に `サブフォルダ(0 件)` のボタンがある。絶対パス(`/Users/…`)はどこにも出ない
- [ ] **EXP-101** 全体の行の `作成` を押し、端末 A で `ls -ld "${G:?}/claude"` を実行する → `~/prompt-ide-global-check/claude/CLAUDE.md` という名前のタブで開き、`# 全体の指示` と `## 概要`・`## よく使うコマンド`・`## コーディングのルール` の見出しだけが書かれている。行が `開く` に変わる。`ls` の結果は `drwx------` で始まる
- [ ] **EXP-102** 開いたタブの末尾に `- テスト` の 1 行を足して Cmd+S で保存し、端末 A で `cat "${G:?}/claude/CLAUDE.md"` を実行する → タブの未保存の印が消え、`cat` の結果の末尾に `- テスト` がある
- [ ] **EXP-103** タブを編集しないまま、端末 A で `echo changed > "${G:?}/claude/CLAUDE.md"` を実行する → 1 秒以内にタブの内容が `changed` になる
- [ ] **EXP-104** `このフォルダ` の `CLAUDE.md` の `作成` を押す → タブが `CLAUDE.md` と `~/prompt-ide-global-check/claude/CLAUDE.md` の 2 つになり、名前で区別できる。全体のタブを選ぶと、内容は `changed` のまま
- [ ] **EXP-105** 全体のタブを閉じてから、端末 A で `rm "${G:?}/claude/CLAUDE.md"` を実行して節を見る → 全体の行は `開く` のまま。Tab で `更新` に移って Enter で押すと、全体の行が `作成` に変わり、フォーカスの枠が `更新` に残る
- [ ] **EXP-106** ウィンドウの高さを低くし(EXP-098 と同じくらい)、端末 A で `echo mine > "${G:?}/claude/CLAUDE.md"` を実行してから(`更新` は押さない)全体の行の `作成` を押す → `同じ名前のファイルかフォルダが既にあります。節の 更新 を押して確かめてください` が、`全体(すべてのプロジェクト)` の行のすぐ下(サブフォルダの開閉のボタンの上)に見える。節が中でスクロールするほど低いときは、文言が見える位置まで節の中が動く。行は `開く` に変わる。端末 A で `cat "${G:?}/claude/CLAUDE.md"` を実行すると `mine` のまま。確かめたらウィンドウの高さを戻す
- [ ] **EXP-107** 端末 A で `O="$(mktemp -d)" && echo secret > "${O:?}/CLAUDE.md" && rm "${G:?}/claude/CLAUDE.md" && ln -s "${O:?}/CLAUDE.md" "${G:?}/claude/CLAUDE.md"` を実行し、節の `更新` を押す → 全体の行の説明が `ホームフォルダの外を指すリンクのため、開けません` になり、`開く`・`作成` のボタンが無い
- [ ] **EXP-108** 端末 A で `rm "${G:?}/claude/CLAUDE.md" && echo inhome > "${G:?}/real.md" && ln -s "${G:?}/real.md" "${G:?}/claude/CLAUDE.md"` を実行し、節の `更新` を押してから全体の行の `開く` を押し、末尾に `- リンク` の 1 行を足して Cmd+S で保存する。端末 A で `cat "${G:?}/real.md" && ls -l "${G:?}/claude/CLAUDE.md"` を実行する → タブの内容は保存の前は `inhome`。`cat` の結果の末尾に `- リンク` があり、`ls -l` の結果は `->` を含む(リンクのまま)
- [ ] **EXP-109** 全体のタブを閉じてから、端末 A で `chmod 000 "${G:?}/claude"` を実行し、節の `更新` を押す → 全体の行の説明が `全体の指示ファイルの状態を確かめられませんでした(更新 で確かめ直せます)` になり、ボタンが無い(`作成` は出ない)。端末 A で `chmod 700 "${G:?}/claude"` を実行してから `更新` を押すと、`開く` に戻る
- [ ] **EXP-110** 全体の行の `開く` を押してタブを開き(編集はしない)、`フォルダを変更` で `$D4` を開く → 全体のタブも含めてタブが全部閉じる。新しいフォルダの節にも全体の行があり、`開く` が出ている
- [ ] **EXP-111** 設定の `使うエージェント CLI` を `GitHub Copilot CLI` に変えてエクスプローラーに戻り、全体の行の `作成` を押してから、端末 A で `ls -ld "${G:?}/copilot"` を実行する → 押す前の行は `~/prompt-ide-global-check/copilot/copilot-instructions.md`(説明 `個人の指示(全部のプロジェクトに効きます)`)で、押すとその名前のタブで開き、1 行目が `# 全体の指示`。`ls` の結果は `drwx------` で始まる
- [ ] **EXP-112** サイドバーを最も狭い幅(220px)までドラッグで狭める → 全体の行の `~/prompt-ide-global-check/copilot/copilot-instructions.md` と説明が折り返し、`開く` のボタンは行の右端に収まる
- [ ] **EXP-113** VoiceOver を有効にし、Tab で全体の行の `開く` に移る → `~/prompt-ide-global-check/copilot/copilot-instructions.md を開く` と読み上げられる。VO の見出しの一覧に `全体(すべてのプロジェクト)` がある
- [ ] **EXP-114** 設定を `Claude Code` に戻してアプリを終了し(Cmd+Q)、端末 B で `CLAUDE_CONFIG_DIR=relative npm run dev` で起動して `$D3` を開く → 全体の行の説明が `CLAUDE_CONFIG_DIR が絶対パスでないため、全体の指示ファイルの場所を決められません` で、パスとボタンが無い
- [ ] **EXP-115** アプリを終了し、端末 B で `CLAUDE_CONFIG_DIR="$(mktemp -d)" npm run dev` で起動して `$D3` を開く → 全体の行の説明が `CLAUDE_CONFIG_DIR がホームフォルダの外を指すため、全体の指示ファイルを扱えません` で、パスとボタンが無い
- [ ] **EXP-116** アプリを終了し、端末 B で `env -u CLAUDE_CONFIG_DIR -u COPILOT_HOME npm run dev` で起動して `$D3` を開き、全体の行を見る(押さない)。設定を `GitHub Copilot CLI` に変えて見直し、前提で控えた値に戻す。最後に端末 A で `rm -r "${G:?}"` を実行する → Claude Code では `~/.claude/CLAUDE.md`、GitHub Copilot CLI では `~/.copilot/copilot-instructions.md` の行が出る(ファイルがあれば `開く`、無ければ `作成`)。`~/prompt-ide-global-check` の行はどちらでも出ない。`~/.claude` がホームの外を指すリンクのとき(dotfiles を外のボリュームに置いている場合)は、`ホームフォルダの外を指すリンクのため、開けません` になる
```

あわせて、既存の項目の手順・期待結果を次のように直す（ID は変えない）:

- **EXP-084**: 期待結果を `開く`・`作成` のボタンが「全体の行を含めて」すべて押せない、にする
- **EXP-086**: 期待結果の「その下に `サブフォルダ(3 件)` のボタンがあり」を、「その下に小見出し `全体(すべてのプロジェクト)` と全体の行が 1 つ(ボタンは押さない)、その下に `サブフォルダ(3 件)` のボタンがあり」にする
- **EXP-097**: 期待結果を「開閉のボタンは押せ、`更新` とサブフォルダの行の `開く`・全体の行の `開く`(または `作成`)は押せない」にする(前の PR で足した項目。ID は変えずに文言だけ直す)
- **EXP-099**: 期待結果の「`このフォルダ` の一覧のすぐ下(サブフォルダの開閉のボタンの上)」を、「`全体(すべてのプロジェクト)` の行のすぐ下(サブフォルダの開閉のボタンの上)」にする

追記したら `node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact を同じファイルパス（`.superpowers/manual-test-spec.html`）で再公開する。`npx vitest run scripts` が通ることを確かめる。

## 8. ROADMAP・README・developer-guide の更新の方針

- `ROADMAP.md` の実装済み機能の「エージェント向けの指示ファイルの編集支援」（`###`）に、次の項目を `[x]` で足す
  - 節に小見出し `全体(すべてのプロジェクト)` を足し、利用者の全体の指示ファイル（claude: `~/.claude/CLAUDE.md`〈`CLAUDE_CONFIG_DIR` があればその下〉、copilot: `~/.copilot/copilot-instructions.md`〈`COPILOT_HOME` があればその下〉）を `~/…` の形で出し、あれば `開く`、無ければ `作成`（フォルダが無ければ `0o700` で 1 段だけ作る）。場所はアプリの起動時の環境変数で決める。ホームの外を指すリンク・環境変数は扱わない。読む・保存する・監視するの境界は、main が決めた固定のパスと完全に一致するときだけ許す（2026-11-07。設計書 `docs/superpowers/specs/2026-11-07-agent-instruction-files-global-design.md`）
- 同じ節の「既知の制約」に、この設計書の「5. 既知の制約」のうち、環境変数を起動時に決めること（自分のターミナルの CLI と食い違いうる）・ホームの外を扱わないこと・外部での追加・削除は次のきっかけ（`更新`・CLI の種類の切り替え・フォルダの切り替え・全体の作成の後）まで反映しないこと、の 3 つを書く
- 「エージェント実行の支援（MVP の次）」の `[x] エージェント向けの指示ファイル(…)の編集支援` の説明に、2026-11-07 の全体の指示ファイルの実装済みの 1 文（この設計書を参照）を足し、「残り」から「利用者の全体の指示ファイル（`~/.claude/CLAUDE.md` など）」を消す。残りは「プロンプトの内容の追記、外部での追加・削除の自動の反映（file watcher）」になる
- `README.md`
  - 「エクスプローラー・エディタ」の説明の文に「すべてのプロジェクトに効く全体の指示ファイル（`~/.claude/CLAUDE.md` など）も開く・作ることができます」を足す
  - 「ディレクトリ構成と主要なモジュール」の `folderAccessManager.ts`・`traversalPolicy.ts`・`handlers/fileAccessGuard.ts` の行の後に、`fileAccessScope.ts`・`globalAgentInstructionAccess.ts` の説明（読む・保存する・監視するの入口で、全体の指示ファイルの固定のパスだけを許可フォルダの外として許す）を足す
- `docs/developer-guide.md`
  - 3.1 の「フォルダへのアクセスを伴う受け口は `FolderAccessManager` を共有し、…拒む。」の後に、「読む・保存する・監視するの入口（`fs:readFile`・`fs:writeFile`・`fs:writeFileChecked`・`fs:setWatchedFiles`）は `fileAccessScope.ts` の `resolveFileAccessScope` で規則を選び、全体の指示ファイル（main が起動時に決めた固定のパスと完全に一致するもの）だけはホームの中かで確かめる。新しくファイルのパスを受け取る入口を足すときは、この関数を通すか、許可フォルダだけを許すかを決めて、設計書の入口の表に足す」を足す
  - 3.4 の CLI ごとの違いの表の並びの `src/shared/agentInstructionFiles.ts`〈指示ファイルの一覧と雛形・サブフォルダで探す名前〉を、〈指示ファイルの一覧と雛形・サブフォルダで探す名前・全体の指示ファイルの場所〉に直す
