# エージェント向けの指示ファイルの編集支援 設計書

## 目的

エージェント CLI が読む指示ファイル(`CLAUDE.md`・`AGENTS.md` など)を、開いているフォルダの中から探さずに開けるようにする。
無いファイルは、短い雛形を書いて作り、そのままエディタで開く。

ROADMAP の「エージェント実行の支援(MVP の次)」の「エージェント向けの指示ファイル(`CLAUDE.md` など)の編集支援」に当たる。

## 決めたこと

- 入口はエクスプローラー。フォルダを開いているとき、ファイルツリーの上に「エージェントの指示ファイル」の節を置く
- 一覧に出すのは、設定で選んでいるエージェント CLI の分だけ。設定を切り替えると一覧も切り替わる
  - CLI の種類は、`useAgentWorkspace` が公開している `agentTerminal.appCliKind`(`useAgentCliKind` の 1 つだけのインスタンスの `kind` を、
    読み込み中は既定の claude で補った値)を `useAppState` から渡す。新しい hook の中で `useAgentCliKind()` を呼び直さない
    (設定の画面と値がずれる。L-466)。既定値で補う処理を新しく書かない
  - claude(Claude Code): `CLAUDE.md`・`.claude/CLAUDE.md`・`CLAUDE.local.md`
  - copilot(GitHub Copilot CLI): `AGENTS.md`・`.github/copilot-instructions.md`
- 行ごとに、ファイルがあれば `開く`、無ければ `作成` のボタンを出す
- `作成` は短い雛形(見出しだけ)を書いてからエディタで開く。既にあるファイルは決して上書きしない
- 機能の範囲は「一覧・開く・作成」だけ。プロンプトの内容を追記する操作、フォルダの外(`~/.claude/CLAUDE.md` などの利用者の全体の指示)、
  サブフォルダの指示ファイルの探索は作らない(ROADMAP に残りとして書く)
- 実行方式(エージェント CLI 方式・従来の方式)に関係なく、フォルダを開いていれば出す。指示ファイルは CLI の起動の前に整えるものなので、
  方式を切り替える前にも触れるようにする
- 作成の前に確認のダイアログは出さない。作成は既存のものを変えない操作で、失敗しても何も残らない(下の「作成の手順」)

## 画面

```text
エクスプローラー
[フォルダを変更]
[リポジトリを clone]
┌ エージェントの指示ファイル(Claude Code) ┐
│ CLAUDE.md            共有の指示      [開く] │
│ .claude/CLAUDE.md    共有の指示      [作成] │
│ CLAUDE.local.md      個人の指示      [作成] │
└──────────────────────────────┘
(ファイルツリー)
```

- 節は `<section aria-labelledby>` にし、見出しは「エージェントの指示ファイル(<CLI の表示名>)」。表示名は `AGENT_CLI_PROFILES[kind].displayName`
- 行は `<ul>` の `<li>`。ファイルのパス(フォルダからの相対パス。区切りは `/`)と短い説明、ボタンを並べる
- ボタンの `aria-label` は「<相対パス> を開く」「<相対パス> を作成」(同じ文字のボタンが並ぶため)
- 作成の途中は、その節のすべてのボタンを `aria-disabled="true"` にし、押しても何もしない(`disabled` にしない。押した `作成` が disabled になるとフォーカスが body に落ちるため。L-157。多重の作成の防止は ref で判定し、state の反映を待たない。L-653)
- clone の実行中(`clone.isCloning`)も、節のボタンを `disabled` にする(押す前から押せない状態で、成功するとフォルダが切り替わるため。`フォルダを変更` と同じ)。
  ファイルツリーの読み込み中を表す state は無いので新しく足さない。読み込み中に押しても、作成は `skipped` か `tree: null`
  (「作成しましたが、開けませんでした」)になり、壊れない
- 失敗したときは、節の中に固定の文言を `role="alert"` で出す。次の操作(どれかのボタンを押す)で消す
- サイドバーが狭い(220px)ときは、説明を次の行へ折り返す。ボタンは行の右端に残す

## 指示ファイルの表

`src/shared/agentInstructionFiles.ts` に、CLI の種類ごとの表を置く(CLI ごとの違いは表にまとめる、開発者ガイド 3.4 の方針)。

```ts
export interface AgentInstructionFile {
  /** IPC で送る識別子(表の中で一意) */
  id: AgentInstructionFileId
  /** フォルダからの相対パスを区切りごとに分けたもの(例: ['.claude', 'CLAUDE.md']) */
  segments: readonly string[]
  /** 一覧に出す短い説明 */
  description: string
  /** 作成したときに書く雛形 */
  template: string
}
export const AGENT_INSTRUCTION_FILES: Record<AgentCliKind, readonly AgentInstructionFile[]>
export function findAgentInstructionFile(cliKind: AgentCliKind, id: unknown): AgentInstructionFile | null // その CLI の表に無ければ null
```

| id                | segments                                  | 説明                         |
| ----------------- | ----------------------------------------- | ---------------------------- |
| `claude-root`     | `['CLAUDE.md']`                           | 共有の指示                   |
| `claude-dot`      | `['.claude', 'CLAUDE.md']`                | 共有の指示(.claude フォルダ) |
| `claude-local`    | `['CLAUDE.local.md']`                     | 個人の指示                   |
| `copilot-agents`  | `['AGENTS.md']`                           | 共有の指示                   |
| `copilot-github`  | `['.github', 'copilot-instructions.md']` | 共有の指示(.github フォルダ) |

- `segments` は 1 つか 2 つ。2 つのときの 1 つ目は作成のときに作ってよいフォルダ(`.claude`・`.github`)
- 雛形は次の形(1 行目の見出しだけファイルごとに変える。`CLAUDE.local.md` は「個人の指示」、ほかは「プロジェクトの指示」)。末尾は改行で終える

```markdown
# プロジェクトの指示

## 概要

## よく使うコマンド

## コーディングのルール
```

## 有無の判定

- renderer のファイルツリー(`fileTree`)を、`segments` の名前で根からたどって判定する(`lib/agentInstructionFileLookup.ts` の純粋な関数)。
  たどった先が `type: 'file'` のノードなら「ある」、無ければ「無い」
- 名前の比較は完全一致。大文字小文字だけ違うファイル(`claude.md`)は「無い」と判定し、作成は `EEXIST` で失敗する(下の文言で伝える)。
  大文字小文字を区別しないファイルシステムかを renderer では判定できないため(L-009)
- 同じ名前のフォルダ(`CLAUDE.md` という名前のフォルダ)も「無い」と判定する。作成は `EEXIST` で失敗する
- パスの文字列ではなく名前でたどるのは、renderer の `folderPath` と main の許可フォルダ(`realpath` の後)の書き方が違いうるため
- ツリーはエクスプローラーの表示と同じもの。外部での追加・削除は、ツリーの再読み込み(作成・削除・リネームの後、フォルダを開き直したとき)まで
  反映しない(ツリーの自動の更新は未実装。ROADMAP の file watcher)。古い判定で `作成` を押し、実際にはあった場合は `EEXIST` で失敗し、
  上書きはしない。`開く` を押し、実際には無かった場合は読み込みの失敗として既存の経路で伝わる

## 作成の手順

renderer は識別子だけを送り、パスと中身は main が表から決める(renderer の値でパスや書く中身を決めさせない。L-018・L-019)。

### IPC `agentInstructions:create`

- 引数: `(expectedRoot: unknown, cliKind: unknown, fileId: unknown)`。`expectedRoot` は renderer が開いているフォルダ(作ろうとしたフォルダ)で、
  空でない文字列でなければ例外にする。`isAgentCliKind` と `findAgentInstructionFile(cliKind, fileId)` で検証し、`fileId` が `cliKind` の表に無ければ
  例外にする(L-044。既定値に読み替えない)
- 戻り値: `AgentInstructionCreateResult`(`src/shared/types` に置く)。`{ ok: true } | { ok: false, reason: 'exists' | 'outside' | 'failed' | 'folderChanged' }`。
  `{ ok: true }` は「新しく作った」ことだけを意味する。作成の失敗は例外にせず理由で返す(`settingsHandlers.ts` の結果の形に揃える。
  画面の文言は renderer が理由から選ぶので、IPC の例外の文言がそのまま画面に出ることは無い。L-017)。
  引数の検証の失敗(不正な `expectedRoot`・`cliKind`・`fileId`)だけは例外にする(IPC の不正な値は例外、の方針。開発者ガイド 4)
- 例外と理由の分担: 受け口(`handlers/agentInstructionsHandlers.ts`)は引数を検証し(失敗は IPC の例外)、許可フォルダを
  `folderAccess.get(event.sender.id)` で得る。フォルダが無ければ `failed` を返す。`realpath(expectedRoot)` が許可フォルダ(realpath 済み)と
  違えば(realpath の失敗も含む)、作らずに `folderChanged` を返す。`dialog:openFolder` は main の許可を先に新しいフォルダへ切り替え、
  renderer のフォルダが変わるのは新しいフォルダの読み込みの後なので、その間に前のフォルダの節から作成を押すと、許可フォルダ(切り替え先)に
  作ってしまうため(L-018・L-061)。`expectedRoot` は比べるためだけに使い、書くパスは今までどおり許可フォルダと表から決める(L-019)。creator(`src/main/agentInstructionFileCreator.ts`)は
  許可フォルダ・`FolderAccessManager`・表の行を受け取り、下の手順の途中の失敗を投げる。受け口が creator の例外を受け止めて
  `console.error` に残し、理由に変えて返す。IPC として例外になるのは引数の検証の失敗だけ
- 手順(creator):
  1. `segments` が 2 つなら、1 つ目のフォルダを `mkdir`(recursive なし)で作る。`EEXIST` は「既にある」として次へ進む。それ以外の失敗は投げる
  2. 親(許可フォルダか、1 で作ったフォルダ)を `folderAccess.assertParentWithinFolder` で検証し、解決済みの親を得る。`.claude` が
     フォルダの外を指すシンボリックリンクなら、ここで拒否する(L-016)。同名のファイルがあるときも `realpath` は通るため、作成側が親を `stat` し、
     ディレクトリでなければ `code = 'ENOTDIR'` で失敗させる(3 の書き込みの OS のコードに頼らない。Windows は `ENOENT` になり `exists` にできないため)
  3. `createFileContent(join(解決済みの親, ファイル名), template)`(`flag: 'wx'`)で書く。既にあれば `EEXIST`。ぶら下がったリンクも辿らない
- 範囲外の拒否を `realpath` の `ENOENT` などと見分けるため、`FolderAccessManager` の拒否(`assertWithinFolder`・`assertParentWithinFolder`)を、
  `Error` のサブクラス `FolderAccessDeniedError`(`src/main/folderAccessManager.ts` から出す。文言は今と同じ `Access denied: ...`)で投げるように変える。
  受け口は `instanceof FolderAccessDeniedError` で `outside` に分ける。`name` は設定しない(`Error` のまま。IPC 越しに renderer へ届く
  `Error invoking remote method '...': Error: Access denied: ...` の文字列を変えないため)。既存の呼び出し元は文言も見え方も変わらない
- 1 で新しくフォルダを作り、3 が失敗したときも、作ったフォルダは消さない。空のフォルダが残るだけで、利用者のデータは失わない。
  消す後始末は、作った後に別のものが入った場合に他人の物を消しうる(L-004)ため、あえて持たない
- 失敗は理由に分けて返す。元の例外は main の `console.error` に残す(パスを含みうるので画面へは送らない。L-017)
  - `exists`: 3 の `EEXIST`・`ENOTDIR`
  - `outside`: 2 の許可フォルダの外(`FolderAccessDeniedError`)
  - `failed`: それ以外(フォルダを開いていない、`.claude` がぶら下がったリンクで `realpath` が `ENOENT`、権限など)
  - `folderChanged`: 受け口で、`expectedRoot` が許可フォルダと違う(作成を呼ばない)。renderer は `skipped` として扱い、文言を出さない
- renderer の文言(`lib/agentInstructionMessages.ts`。固定の文字列。画面に出す理由 `AgentInstructionCreateShownFailureReason`
  〈`folderChanged` を除いた理由〉だけに文言を持たせる)
  - `exists`: 「同じ名前のファイルかフォルダが既にあります(大文字と小文字だけ違う名前を含みます)。ファイルツリーを確かめてください」
  - `outside`: 「フォルダの外には作成できません」
  - `failed`: 「指示ファイルを作成できませんでした」
  - IPC 自体が拒否された(例外)ときも `failed` の文言を出し、例外は renderer の `console.error` に残す

### ファイルツリーの操作(`hooks/useFileTreeOperations.ts`)

`useFileTreeOperations` の内部の `runFileOperation`・`runLocked` は外へ出しておらず、`runFileOperation` は失敗を共有の `error`
(エクスプローラーの上部に出る)へ入れて `void` を返す。そのままでは成否を受け取れず、失敗が 2 か所に出るため、
`useFileTreeOperations` に専用の操作を足す。手順の本体は `hooks/agentInstructionFileCreation.ts` の
`runAgentInstructionFileCreation(deps, cliKind, file)`(`deps` は `getFolderPath`・`lockPathForFileOperation`・`reloadTree`)に置き、
`useFileTreeOperations` は自分の内部の関数を渡して呼ぶだけにする(hook なしで単体テストできるようにするため)。

```ts
export type AgentInstructionCreateOutcome =
  | { status: 'created'; tree: FileTreeNode[] | null } // tree は読み直して反映したツリー。読み直せなかった・反映しなかったら null
  | { status: 'failed'; reason: 'exists' | 'outside' | 'failed' } // AgentInstructionCreateShownFailureReason
  | { status: 'skipped' } // フォルダが無い・操作の途中でフォルダが切り替わった(main の folderChanged を含む)
createAgentInstructionFile: (cliKind: AgentCliKind, file: AgentInstructionFile) => Promise<AgentInstructionCreateOutcome>
```

- `runLocked` と同じロック(`lockPathForFileOperation`)を通して IPC を呼ぶ。ロックの対象は開いているフォルダの根、無効にするパスは
  作るファイルのパス(`folderPath` と `segments` を `joinPath` でつなぐ)。中止の文言は既存の `createFile` と同じ `SAVE_ABORTED_BY_CREATE`
  (`createEntryLockOptions` と同じ形)。削除してバッファだけ残した同じパスのファイルを、古いバッファで
  上書きしないため(既存の `createFile` と同じ理由。L-061)。`.claude/CLAUDE.md` でも親の `.claude` をロックの対象にしないのは、
  まだ無いことがあるため(根なら必ずある)
- ロックを取った直後(IPC の前)に、開始時と同じフォルダかを確かめる。違えば(ロックを待つ間に切り替わった)ロックを失敗として解放し、
  IPC を呼ばずに `skipped` を返す。IPC には開始時のフォルダを `expectedRoot` として渡す
- IPC が `{ ok: false }` を返したらロックを失敗として解放し(`release({ succeeded: false })`)、理由が `folderChanged` なら `skipped` を返す。それ以外(`exists`・`outside`・`failed`)は、アプリの外で作られてツリーが古いことが多いので、解放の後に `reloadTree` で読み直し(失敗は握りつぶす)、フォルダが切り替わっていれば `skipped`、そうでなければ `failed` を返す(外で作られたファイルが出て、行が `開く` に変わる)。IPC が例外のときは読み直さず `failed`(理由は `failed`)
- 成功したら `refreshTree` と同じ手順でツリーを読み直す。読み直しは、反映したツリーを返す内部の関数 `reloadTree(): Promise<FileTreeNode[] | null>`
  に分ける。規則: 反映したらそのツリー、反映しなかった(読み込みの途中・古い結果・フォルダが無い)ら `null`、読み込みの失敗は
  `reportTreeLoad` の後に投げ直す(今の `refreshTree` と同じ)。`refreshTree` は `reloadTree` の結果が null でないかを `boolean` で返す
  (挙動は変えない。失敗は投げ直し、`runFileOperation` の `setError` に届く)。新しい操作は `reloadTree` の失敗を受け止めて `tree: null` にする
  (作成の成功を失敗と取り違えない。L-001)。読み直しの失敗の表示は `reportTreeLoad` に任せる
- 共有の `error`(`setError`)には書かない。失敗の文言は節だけに出す
- 操作の開始時と終わりでフォルダが違えば `skipped` を返し、ツリーも文言も変えない(`runFileOperation` と同じ判定)。終わりの確認は、
  IPC の後と読み直しの後の両方で行う(読み直しの途中に切り替わったとき、切り替え先の節に「開けませんでした」を出さない)
- `useFileSystem` の戻り値に足し、`useAppState` から hook へ渡す

### renderer の流れ(`hooks/useAgentInstructionFiles.ts`)

1. 作成の途中なら何もしない(ref で判定。L-653)。作成の途中の状態は state にも持ち、ボタンの `aria-disabled` に使う
2. `createAgentInstructionFile` を呼ぶ
3. `created` で `tree` があれば、その `tree` から同じ `segments` でノードを探し、`selectFile` で開く
4. `tree` が null、またはノードが見つからないときは、「作成しましたが、開けませんでした。ファイルツリーから開いてください」を出す
5. `failed` は理由の文言を 1 回だけ出す。`skipped` は何も出さない
6. 結果を待つ間(作成の後の git の状態の取り直しを含む)に `folderPath` が変わっていたら、3〜5 を行わない(前のフォルダのノードを開くと、
   読み込みの拒否でパスが画面に出るため)。判定は開始時の値と、`useLatestRef` で控えた最新の値を比べる
7. 文言は、フォルダか CLI の種類が変わったときにも消す(文言にはどの行の失敗かが入っていないため)。結果を待つ間に CLI の種類が
   変わったときは文言だけを出さず、作れたファイルは開く(利用者が押した操作のため)

`開く` は、たどったノードをそのまま `useAppState` の `selectFile` に渡す(エクスプローラーでファイルを選んだときと同じ。diff タブを
非アクティブにする処理も同じ経路。未保存の変更の確認は無い(`selectFile` は既存のタブに切り替えるか新しいタブを足すだけ)。生の `fileSystem.selectFile` は使わない)。

## 部品

- `src/shared/agentInstructionFiles.ts`: 表と `findAgentInstructionFile`
- `src/main/agentInstructionFileCreator.ts`: 作成の手順(許可フォルダ・`FolderAccessManager`・表の行を受け取る)
- `src/main/folderAccessManager.ts`: `FolderAccessDeniedError` を足し、範囲外の拒否で投げる
- `src/main/handlers/agentInstructionsHandlers.ts`: IPC の受け口と引数の検証。`src/main/ipcHandlers.ts` で登録する
- `src/preload/api.ts`・`src/preload/index.d.ts`: `createAgentInstructionFile(expectedRoot, cliKind, fileId)`
- `src/renderer/src/lib/agentInstructionsApi.ts`: `window.api` の薄い包み
- `src/renderer/src/lib/agentInstructionFileLookup.ts`: ツリーをたどる純粋な関数
- `src/renderer/src/lib/agentInstructionMessages.ts`: 失敗の理由ごとの固定の文言
- `src/renderer/src/hooks/agentInstructionFileCreation.ts`: 作成の手順(ロック → 確認 → IPC → 読み直し)と `AgentInstructionCreateOutcome`
- `src/renderer/src/hooks/useFileTreeOperations.ts`・`useFileSystem.ts`: `createAgentInstructionFile` を足す
- `src/renderer/src/hooks/useAgentInstructionFiles.ts`: 一覧の状態(ある・無い)・作成中・文言・`open`・`create`
- `src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx`: 節の表示
- 配線: `ExplorerPanel` に必須の props(`agentInstructions`。省略できない。L-060)を足し、`Sidebar`・`App`(`useAppState`)からつなぐ

## 既知の制約

- 外部での追加・削除は、ツリーの再読み込みまで一覧に出ない(上の「有無の判定」)
- 大文字と小文字だけ違う既存のファイルは「無い」と出る。作成は失敗し、文言で伝える
- ツリーはシンボリックリンクを `type: 'file'` として出す(`readdir` の `withFileTypes`)。ぶら下がったリンクの `CLAUDE.md` は「ある」と出て、
  `開く` は読み込みの失敗になる。`.claude` がリンクなら「無い」と出て、作成は `outside` か `failed` になる。どちらも何も書かない
- 作成の途中で失敗したとき、新しく作った `.claude`・`.github` の空のフォルダは残る
- CLI の設定の読み込みが終わるまでは、既定の CLI(claude)の一覧を出す(`appCliKind` の扱い)
- サブフォルダの指示ファイル(`src/CLAUDE.md` など)、利用者の全体の指示ファイル、プロンプトの追記は対象外

## テスト

- 表: id が一意、`segments` が 1〜2 個、2 個のときの 1 つ目が `.claude`・`.github`、`findAgentInstructionFile` が不正な値(`null`・数・未知の文字列)と別の CLI の id で null
- main の作成(実ファイルの一時フォルダ。後始末は `removeTempPath`)。creator のテストは投げた例外(`code`・`FolderAccessDeniedError`)を、
  受け口のテストは返した理由(`exists`・`outside`・`failed`)を確かめる。下の「文言」は理由のこと:
  - 無いときに雛形で作る。`.claude` が無いときはフォルダも作る。`.claude` があるときもそのまま作る
  - 既にあるときは `EEXIST` の文言で失敗し、中身が変わらない
  - `.claude` がフォルダの外へのシンボリックリンクなら拒否し、外に何も作らない
  - `.claude` が同名のファイルなら固定の文言で失敗する
  - ぶら下がったリンクの `CLAUDE.md` を辿らない(`exists`)
  - `.claude` がぶら下がったリンクなら `failed` で、外に何も作らない
  - 許可フォルダが無いときは `failed`
  - 許可フォルダと `expectedRoot`(の realpath)が違う・realpath が失敗するときは `folderChanged` で、作成を呼ばない
  - 戻り値に文言・パスが入らない(理由だけ)
- `useFileTreeOperations` の `createAgentInstructionFile`: ロックの対象と無効にするパス、`created` で反映したツリーを返す、
  読み直しの失敗で `tree: null`、`{ ok: false }`(読み直す)と例外(読み直さない)で `failed` を返し共有の `error` に書かない、途中のフォルダの切り替え(ロックを待つ間なら IPC を呼ばない)と `folderChanged` で `skipped`
- 受け口: 不正な `expectedRoot`(`null`・数・空文字)・`cliKind`・`fileId`、CLI に合わない `fileId`(`claude` に `copilot-agents`)を拒否し、作成を呼ばない
- preload: `createAgentInstructionFile` が `agentInstructions:create` を `expectedRoot`・`cliKind`・`fileId` で呼ぶ
- 有無の判定: 根のファイル、入れ子のファイル、同名のフォルダ、大文字小文字の違い、空のツリー
- hook: 作成の成功で開く、作成の失敗で文言を出し開かない、読み直しの後に見つからないときの文言、作成中の 2 回目を無視する、CLI の切り替えで一覧が変わる
- 節: 見出しの CLI の表示名、`開く`・`作成` の出し分けと `aria-label`、作成中の `aria-disabled`(押しても呼ばない・フォーカスが残る)、clone 中の `disabled`、`role="alert"` の文言
- `FolderAccessManager`: 範囲外の拒否が `FolderAccessDeniedError` で、文言が今と同じ
- 配線: `ExplorerPanel` に節が出て、`作成` から IPC が呼ばれる(`App` の統合のテスト)
