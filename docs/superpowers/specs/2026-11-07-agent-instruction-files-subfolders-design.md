# サブフォルダのエージェントの指示ファイルの探索 設計書

この設計書で「今」「今の」と書くのは、設計した時点(2026-11-07。main は `e05f37e`)のことを指す。

## 目的

エクスプローラーの「エージェントの指示ファイル」の節に、開いているフォルダのサブフォルダにある指示ファイル(`src/CLAUDE.md`・`packages/app/AGENTS.md` など)を一覧し、ファイルツリーを探さずに開けるようにする。

ROADMAP の「エージェント実行の支援(MVP の次)」の「エージェント向けの指示ファイル(`CLAUDE.md` など)の編集支援」の残りのうち、「サブフォルダの指示ファイルの探索」に当たる。もう 1 つの残りの「利用者の全体の指示ファイル(`~/.claude/CLAUDE.md` など)」は次の PR で扱い、この設計書には方針だけを残す(「7. 次の PR の方針」)。

## 1. 背景

### 今の作り(2026-11-05 の設計書 `docs/superpowers/specs/2026-11-05-agent-instruction-files-design.md`)

- エクスプローラーの上部に「エージェントの指示ファイル(<CLI の表示名>)」の節がある。設定で選んでいる CLI の分だけ、フォルダ直下の固定の行(claude: `CLAUDE.md`・`.claude/CLAUDE.md`・`CLAUDE.local.md`、copilot: `AGENTS.md`・`.github/copilot-instructions.md`)を出す
- 行の表は `src/shared/agentInstructionFiles.ts` の `AGENT_INSTRUCTION_FILES`。有無は renderer のファイルツリー(`fileTree`)を名前でたどって判定する(`lib/agentInstructionFileLookup.ts`。名前は完全一致)
- あれば `開く`(`useAppState` の `selectFile`。エクスプローラーでファイルを選んだときと同じ経路)、無ければ `作成`(IPC `agentInstructions:create`。main が表からパスと雛形を決める)
- ファイルツリーは main の `readDirRecursive`(`src/main/fileSystem.ts`)が作る。除外は `src/main/traversalPolicy.ts` の `SKIP_DIRS`(`node_modules`・`.git`・`out`・`dist`・`.next`)、深さは `MAX_DEPTH = 5`(開いたフォルダ〈根〉を 0 段目、その直下のフォルダを 1 段目として、5 段目のフォルダの中身までを読む。6 段目のフォルダは中身が空で出る)。`.gitignore` は見ていない。シンボリックリンクは、フォルダを指すものも `type: 'file'` で出る(中はたどらない)
- ツリーは、アプリの中の作成・削除・リネーム・`.gitignore` への追加・変更の破棄などの後と、フォルダを開き直したときに読み直す。外部での追加・削除を自動で反映する仕組み(file watcher)は無い
- ツリーを読み直す関数 `refreshTree()` は `useFileSystem` にすでにある(`useFileTreeOperations` の `reloadTree` を包んだもの。`.gitignore` への追加・変更の破棄・エージェントの変更を戻した後など、ファイルの構成が変わりうる操作の後に呼ばれている)。フォルダの走査中に呼ばれると書き込まずに「抑止した」ことを記録し、走査が終わってから読み直す(`retryRefreshSkippedDuringScan`)。古い結果は反映しない。読み込みの失敗は `reportTreeLoad` に渡してから投げ直す。`reportTreeLoad` が書き込むのは `folderLoadError` だけ(`useFileSystem.ts` の `reportTreeLoad: (loadError) => setFolderLoadError(loadError)`。クイックオープンが、ファイルが 0 件のときの理由の案内に使う)で、エクスプローラーの上部の赤字(`ExplorerPanel` の `error`)には出ない。赤字に出したいほかの呼び出し元は、例外を受け止めて自分で `setError` している。今、エクスプローラーには `refreshTree` を利用者が呼ぶボタンは無い(ソース管理のツールバーには git の状態を取り直す `更新`〈`↻`〉がある)
- `フォルダを変更` で同じフォルダを開き直すと、タブを全部閉じ、未保存の変更があれば確認を出す(ツリーを読み直すだけの手順としては重い)
- エージェント CLI は、開いているフォルダ(許可フォルダ)を `cwd` にして起動する(`src/main/agentSessionStarter.ts`)

### 調べた CLI の挙動

**GitHub Copilot CLI 1.0.106**(一時の git リポジトリで `copilot instruction list` を実行して確かめた)

- リポジトリの根(git root)の `AGENTS.md`・`CLAUDE.md`・`GEMINI.md`・`.github/copilot-instructions.md`・`.github/instructions/**/*.instructions.md` を読む
- `cwd` から git root までの間のフォルダの `AGENTS.md`・`CLAUDE.md` を読む(`cwd` のものと、`cwd` の祖先のもの)
- `cwd` が根のとき、子孫のフォルダの `AGENTS.md`(`src/AGENTS.md` など)は一覧に出なかった。このアプリは根で起動するので、**サブフォルダの `AGENTS.md` は今の起動のしかたでは読まれない**。`cwd` をサブフォルダにして別に起動した場合や、git root より下のフォルダを開いた場合は、そのフォルダの祖先の分が読まれる
- 入れ子の `.github/copilot-instructions.md`(`pkg/.github/…`)、`.claude/CLAUDE.md`、`CLAUDE.local.md`、`node_modules` の中は読まなかった
- 個人の指示は `$COPILOT_HOME`(既定は `~/.copilot`)の `copilot-instructions.md` と `instructions/*.instructions.md`。`~/.copilot/AGENTS.md` は読まなかった
- 環境変数 `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` で探す場所を足せる。`--no-custom-instructions` で全部を止められる

**Claude Code 2.1.291**(実行ファイルに埋め込まれた文字列から読んだ。`/memory` の画面では確かめていない)

- project root とその祖先・入れ子のフォルダの `CLAUDE.md`・`CLAUDE.local.md`・`AGENTS.md`、`.claude/CLAUDE.md`・`.claude/AGENTS.md`、`~/.claude/CLAUDE.md`、`.claude/rules/`・`~/.claude/rules/`、managed-policy の `CLAUDE.md` を読み込みの対象に挙げている
- 祖先は `cwd` からファイルシステムの根までたどる。入れ子のフォルダの `CLAUDE.md` は、起動の時ではなく、そのフォルダのファイルを読んだときに遅れて読む(`nestedDirs`・`nested_memory` の仕組み)
- 全体の場所は `CLAUDE_CONFIG_DIR`(既定は `~/.claude`)で変わる。設定の `claudeMdExcludes`(glob)で読まないファイルを指定できる

## 2. 決めたこと

利用者に選んでもらったこと(4 つとも推奨の案):

- **範囲**: この PR ではサブフォルダの探索だけを扱う。利用者の全体の指示ファイルは次の PR にする
- **探索のしかた**: renderer の今のファイルツリーをたどる。除外は `SKIP_DIRS`、深さはツリーと同じ 5 まで(main の `MAX_DEPTH`)。件数の上限は 50 で、超えたら「ほか N 件」と出す。対象のファイル名は CLI ごとの表で持ち、claude は `CLAUDE.md`・`CLAUDE.local.md`、copilot は `AGENTS.md`。サブフォルダのものは `開く` だけで、`作成` は出さない。copilot には「CLI が読まないことがある」という注を付ける
- **全体の指示ファイル(次の PR の方針として記録だけする)**: 開くことも作成することも許す。ただし main が持つ固定のパスに限る。読む・保存する・監視するの境界に許可リストを足し、リンクも検査する
- **見せ方と探すきっかけ**: 節の中を小見出しで「このフォルダ」と「サブフォルダ」の 2 つに分け、サブフォルダは既定で折りたたむ。ツリーを読み直したら、それに連動して探し直す。節に `更新` のボタンを置く。今回はツリーだけを見るので、`更新` の役目はツリーの読み直し(`refreshTree`)にする。「全体」の小見出しは次の PR で足す

この設計で決めたこと:

- `更新` は既存の `refreshTree` を呼ぶだけにする。ツリーが新しくなるので、「このフォルダ」の行の有無(`開く`・`作成`)とサブフォルダの一覧が同時に新しくなる。新しい読み直しの仕組みは作らない
- サブフォルダの一覧はツリーから計算するだけで、`更新` も既存の `refreshTree` を呼ぶだけなので、新しい IPC・main の処理・preload の変更は無い
- 名前の比較は完全一致(今の判定と同じ。L-009)
- フォルダ直下のファイルと、表の「このフォルダ」の行と同じ位置のファイル(`.claude/CLAUDE.md`)は、サブフォルダの一覧に出さない(同じファイルが 2 か所に出ないようにする)
- 実行方式(エージェント CLI 方式・従来の方式)に関係なく、フォルダを開いていれば出す(今の節と同じ)

## 3. 設計

### 画面

```text
┌ エージェントの指示ファイル(Claude Code)   [更新] ┐
│ このフォルダ                                        │
│ CLAUDE.md            共有の指示            [開く]  │
│ .claude/CLAUDE.md    共有の指示(.claude…)  [作成]  │
│ CLAUDE.local.md      個人の指示            [作成]  │
│ ▸ サブフォルダ(3 件)                               │
└──────────────────────────────┘
```

開いたとき:

```text
│ ▾ サブフォルダ(3 件)                               │
│ src/CLAUDE.md        共有の指示            [開く]  │
│ src/CLAUDE.local.md  個人の指示            [開く]  │
│ src/sub/CLAUDE.md    共有の指示            [開く]  │
```

copilot のとき(開いたとき)は、一覧の上に注を出す:

```text
│ ▾ サブフォルダ(1 件)                               │
│ GitHub Copilot CLI は、サブフォルダの AGENTS.md を  │
│ 読まないことがあります(このアプリはフォルダの根で  │
│ CLI を起動するため)                                │
│ src/AGENTS.md        共有の指示            [開く]  │
```

- 節の見出し(`h3`)は今のまま。見出しの行の右端に `更新` のボタンを置く(下の「`更新` のボタン」)。見出しの下に小見出し(`h4`)を 2 つ置く
  - `このフォルダ`: 今の行の一覧(`<ul>`)をこの下に置く。行・ボタンは変えない
  - `サブフォルダ(N 件)`: 開閉のボタンを中に持つ小見出し(`<h4><button aria-expanded aria-controls>…</button></h4>`。WAI-ARIA の disclosure の形)。N は見つかった全件の数(上限で隠した分を含む)
- 節の失敗の文言(`role="alert"`)は、「このフォルダ」の一覧の直後、サブフォルダの開閉のボタンの前に置く(節が縮んで中でスクロールするとき、サブフォルダの一覧の後ろに置くと隠れるため。1280×650 でサブフォルダを開くと 89px 分すべて隠れた)。それでも、ウィンドウの高さが約 477px より低いと文言が節の見える範囲の外に出るので、文言が出たとき(`message` が `null` 以外に変わったとき)に `scrollIntoView({ block: 'nearest' })` で節の中を見える位置まで動かす。フォーカスは動かさない
- 開閉のボタンは、0 件のときも出す(開くと「サブフォルダに指示ファイルはありません」が出る)。件数に応じてボタンを出し消しすると、ツリーの読み直しで 0 件になったときにフォーカスを持つボタンが消え、フォーカスが body に落ちるため
- 既定は折りたたむ。開閉の状態は節の部品の中の state に持ち、保存はしない(フォルダや CLI を切り替えても、ツリーを読み直しても、節が出ている間は保つ)
- 開閉のボタンは、clone の実行中・作成の途中・`更新` の途中も押せる(フォルダもファイルも変えない操作のため)
- サブフォルダの行は、相対パス(区切りは `/`)と説明と `開く` を並べる。見た目は「このフォルダ」の行と同じクラスを使う
- サブフォルダの `開く` の押せない条件は、「このフォルダ」の `開く` と同じにする。clone の実行中は `disabled`、作成の途中は `aria-disabled="true"` で押しても何もしない(L-157・L-653)
- 開いた一覧(注・行・`ほか N 件`を包む div)は高さの上限を `40vh` にし、超えた分はその中でスクロールする(行が多いと節が伸びてファイルツリーの高さが 0 になり、`.explorer-panel` が `overflow: hidden` のため画面の外の行が見られなくなるため)。中に `開く` があるので、キーボードでも中まで届く
- 画面の高さが低いとき(高さ 600 で、固定で使う約 230px のためツリーが 51px、480 で 8px になった)に備え、節(`.agent-instructions`)は縮められるようにして中で縦にスクロールさせ(`flex: 0 1 auto; min-height: 0; overflow-y: auto`)、ファイルツリーには `min-height: 88px`(3 行分)を付ける。極端に低いときは、節の中のスクロールで、閉じたとき・開閉のボタン・`更新` に届く
- 上限を超えたときは、一覧の最後に `ほか N 件(ファイルツリーから開いてください)` を文として出す(ボタンにしない)
- 狭いサイドバー(220px)では、今の行と同じく説明を次の行へ折り返し、`開く` は行の右端に残す。長い相対パスは折り返す(省略しない。どのファイルかが分からなくなるため)。見出しが長いときは見出しの文字を折り返し、`更新` は見出しの行の右端に残す

### `更新` のボタン

- 押すと `refreshTree()` を 1 回呼ぶ。中身はそれだけで、結果のツリーから一覧が計算し直される(「このフォルダ」の行も同時に新しくなる)
- 見える文字は `更新`(節のほかのボタン〈`開く`・`作成`〉と同じく文字のボタン)。`aria-label` は `指示ファイルの一覧を更新`(ソース管理のツールバーの `更新`〈`↻`〉と読み上げで区別するため)。`title` は `ファイルツリーを読み直して、指示ファイルを探し直します`
- 押せない条件:
  - clone の実行中: `disabled`(節のほかのボタンと同じ。押す前から押せない状態で、成功するとフォルダが切り替わるため)
  - 作成の途中: `aria-disabled="true"` で押しても何もしない(作成は終わりに自分でツリーを読み直すため、重ねて読む理由が無い)
  - `更新` の途中(`refreshTree` の結果を待つ間): `aria-disabled="true"` で押しても何もしない。多重の呼び出しは ref で止め、state の反映を待たない(L-653)。押したボタンを `disabled` にするとフォーカスが body に落ちるので `aria-disabled` にする(L-157)
  - フォルダの走査中(フォルダを開いた直後の読み込みの間): 押せるままにする。`refreshTree` が走査中は書き込まずに記録し、走査の後に読み直すので、押しても壊れず、取りこぼしもしない。走査中を表す state を節に新しく渡さない(2026-11-05 の設計書と同じ判断)
- `更新` の途中も、`開く`・`作成`・開閉のボタンは押せる。ツリーの書き込みは後から始めたものだけが反映される(`beginTreeWrite` の世代)ので、作成の後の読み直しと重なっても古いツリーで上書きしない
- 押したときは、節の失敗の文言を消す(今の「次の操作で消す」の規則)
- 読み直しの失敗(`refreshTree` が拒否したとき)は、節の失敗の文言の枠(今の `message`。`role="alert"`)に固定の文言 `ファイルツリーを読み直せませんでした` を出す。例外の文言(パスを含みうる)は画面に出さず、`console.error` に残す(L-017)。`refreshTree` は失敗を `folderLoadError` にしか書かず、エクスプローラーの赤字には出ないため、節で出さないと利用者には何も伝わらない(L-001)
- 結果を待つ間にフォルダか CLI の種類が切り替わっていたら、この文言を出さない(作成の `showMessage` と同じ扱い。切り替え先の節に前のフォルダの失敗を出さない)
- `refreshTree` が `false` を返したとき(走査中で抑止した・古い結果で反映しなかった・フォルダが無い)は、失敗ではないので文言を出さない。走査中に抑止した分は、走査の後に `useFileSystem` が読み直す
- 成功したときの読み上げはしない(ソース管理のツールバーの `更新`〈`↻`〉と同じ)。一覧が変わったことは、開閉のボタンの件数と行で分かる
- ボタンは常に描画するので、押した後もフォーカスは `更新` に残る

### 表(`src/shared/agentInstructionFiles.ts` に足す)

CLI ごとの違いは表にまとめる(開発者ガイド 3.4 の方針)。今の `AGENT_INSTRUCTION_FILES` と並べて置く。

```ts
export interface AgentInstructionSubfolderFileName {
  /** サブフォルダの中で探すファイル名(完全一致) */
  name: string
  /** 一覧に出す短い説明 */
  description: string
}

export interface AgentInstructionSubfolderSpec {
  /** 探すファイル名。この順で同じフォルダの中に並べる */
  names: readonly AgentInstructionSubfolderFileName[]
  /** 一覧の上に出す注(無ければ null) */
  note: string | null
}

export const AGENT_INSTRUCTION_SUBFOLDER_FILES: Record<AgentCliKind, AgentInstructionSubfolderSpec>
```

| CLI     | names(name / description)                                   | note                                                                                                       |
| ------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| claude  | `CLAUDE.md` / 共有の指示、`CLAUDE.local.md` / 個人の指示     | null                                                                                                       |
| copilot | `AGENTS.md` / 共有の指示                                     | `GitHub Copilot CLI は、サブフォルダの AGENTS.md を読まないことがあります(このアプリはフォルダの根で CLI を起動するため)` |

- 表は renderer だけが読む(サブフォルダの行は作成しないので、main は使わない)。それでも shared に置くのは、今の表と CLI の対応を 1 か所で見比べられるようにするため
- claude に注を付けないのは、Claude Code はサブフォルダの `CLAUDE.md` を(そのフォルダのファイルを読んだときに)読むため

### 探索(`src/renderer/src/lib/agentInstructionSubfolderLookup.ts`。純粋な関数)

```ts
export const AGENT_INSTRUCTION_SUBFOLDER_LIMIT = 50

// AgentInstructionSubfolderRow は types.ts に置き(下の「状態」)、ここでは import type で使う

export interface AgentInstructionSubfolderLookupResult {
  /** 並べ替えて上限までに切った分 */
  rows: readonly AgentInstructionSubfolderRow[]
  /** 見つかった全件の数(上限で隠した分を含む) */
  total: number
}

export function findAgentInstructionSubfolderFiles(
  tree: readonly FileTreeNode[],
  spec: AgentInstructionSubfolderSpec,
  excludedSegments: readonly (readonly string[])[],
  limit?: number
): AgentInstructionSubfolderLookupResult
```

- ツリーを根からたどり、1 段目以降のフォルダの中にある `type: 'file'` のノード(`isFileNode`)のうち、名前が `spec.names` のどれかと完全一致するものを集める。根(0 段目)の直下のファイルは「このフォルダ」の分なので集めない
- 相対パスは、ノードの `path` からではなく、たどったフォルダの名前をつないで作る(renderer の `folderPath` と main の realpath 済みのパスの書き方が違いうるため。今の判定と同じ理由)
- たどるのはツリーに出ているものだけ。除外(`SKIP_DIRS`)と深さ(`MAX_DEPTH`)は main がツリーを作るときに済んでいるので、renderer で同じ規則を書き直さない(規則が 2 か所にあると、片方だけ変わってずれる)
- `excludedSegments` に一致する位置のものは除く。呼び出し元は今の表(`AGENT_INSTRUCTION_FILES[cliKind]` の `segments`)を渡す。claude では `.claude/CLAUDE.md` がここで除かれる
- 並べ方: 親フォルダの相対パスを区切りごとに比べる(`localeCompare`。ツリーの並べ方の `sortFileTree` と同じ比べ方)。片方がもう片方の祖先なら祖先を先にする(`src/CLAUDE.md` を `src/sub/CLAUDE.md` より先に)。同じフォルダの中は `spec.names` の順にする(`CLAUDE.md` → `CLAUDE.local.md`)
- 全件を集めて並べてから、先頭の `limit`(既定は 50)件を返す。`total` は全件の数。上限より先は数えるだけにはせず、並べ方を安定させるために全件を集める(ツリーはもともと全件を renderer に持っているので、集める量は増えない)

### 状態(`src/renderer/src/hooks/useAgentInstructionFiles.ts`)

- `useMemo` で `fileTree` と `cliKind` から探索の結果を計算する。ツリーは読み直すたびに新しい配列になるので、読み直し(`更新` を含む)に連動して探し直す。フォルダを切り替えると、ツリーと一緒に一覧も切り替わる
- hook の引数(`UseAgentInstructionFilesOptions`)に `refreshTree: () => Promise<boolean>`(`useFileSystem` の `refreshTree`。省略できない)を足す
- 戻り値の `AgentInstructionsPanelState`(`src/renderer/src/types.ts`)に足す:

```ts
export interface AgentInstructionSubfolderRow {
  /** 根からの相対パス(区切りは /)。表示と aria-label に使う */
  relativePath: string
  description: string
  node: FileTreeNode
}

export interface AgentInstructionsPanelState {
  // …今のもの…
  /** サブフォルダの指示ファイル(上限までに切った分) */
  subfolderRows: readonly AgentInstructionSubfolderRow[]
  /** 見つかった全件の数 */
  subfolderTotal: number
  /** 一覧の上に出す注(無ければ null) */
  subfolderNote: string | null
  /** サブフォルダの行を開く(エクスプローラーでファイルを選んだときと同じ経路) */
  openSubfolderFile: (row: AgentInstructionSubfolderRow) => void
  /** `更新` の途中(押した結果)。`更新` を aria-disabled にする */
  isRefreshing: boolean
  /** ファイルツリーを読み直す(refreshTree を呼ぶだけ) */
  refresh: () => Promise<void>
}
```

- `openSubfolderFile` は今の `open` と同じ規則にする: 作成の途中(`creatingRef`)なら何もしない、失敗の文言を消す、`openFile(row.node)`(`useAppState` の `selectFile`)を呼ぶ。読み込みの失敗は今までどおり `selectFile` がエクスプローラーのエラーに出す
- 今の `open` と中身が同じになるので、ノードを開く内部の関数を 1 つにし、`open` と `openSubfolderFile` はそれを呼ぶだけにする
- `refresh` の手順: 作成の途中(`creatingRef`)か `更新` の途中(`refreshingRef`)なら何もしない → `refreshingRef` と `isRefreshing` を立てる → 失敗の文言を消す → `await refreshTree()` → 拒否されたら `console.error` に残し、開始時と同じフォルダ・CLI の種類のときだけ `ファイルツリーを読み直せませんでした` を出す(フォルダと CLI の種類は、作成と同じく `useLatestRef` で控えた最新の値と比べる)→ `finally` で下ろす

### 部品

- `src/shared/agentInstructionFiles.ts`: `AGENT_INSTRUCTION_SUBFOLDER_FILES` と型を足す
- `src/renderer/src/lib/agentInstructionSubfolderLookup.ts`: 探索(新規)
- `src/renderer/src/lib/agentInstructionMessages.ts`: サブフォルダの固定の文言を足す(下の「文言」)
- `src/renderer/src/types.ts`: `AgentInstructionSubfolderRow` と `AgentInstructionsPanelState` の追加
- `src/renderer/src/hooks/useAgentInstructionFiles.ts`: 探索の結果・`openSubfolderFile`・`refresh`・`isRefreshing`
- `src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx`: 見出しの行に `更新` を足し、小見出し `このフォルダ` を足し、サブフォルダの部分を下の部品に任せる
- `src/renderer/src/components/explorer/AgentInstructionSubfolderList.tsx`(新規): 開閉のボタン・注・一覧・`ほか N 件`・0 件の文言。開閉の state を持つ
- `src/renderer/src/components/explorer/AgentInstructionOpenButton.tsx`(新規): `このフォルダ` とサブフォルダで共通の `開く`。clone 中は `disabled`、作成の途中は `aria-disabled` にする判定をここに集める(L-157)
- `src/renderer/src/assets/main.css`: 見出しの行・`更新`・小見出し・開閉のボタン・注・`ほか N 件` の見た目(今の `agent-instructions__*` に揃える)
- 配線: `useAppState` で `useAgentInstructionFiles` に `refreshTree`(`fileSystem.refreshTree`)を 1 つ渡す。`ExplorerPanel`・`Sidebar`・`App` は変えない(状態は今の `agentInstructions` の props に入る)。新しい引数と `AgentInstructionSubfolderList` の props は省略できないものにする(L-060)
- main・preload・IPC は変えない

### 文言(固定の文字列)

| 場所                         | 文言                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `更新` の文字・`aria-label`・`title` | `更新`・`指示ファイルの一覧を更新`・`ファイルツリーを読み直して、指示ファイルを探し直します` |
| 小見出し                     | `このフォルダ`                                                                                             |
| 開閉のボタン                 | `サブフォルダ(N 件)`                                                                                      |
| 0 件(開いたとき)           | `サブフォルダに指示ファイルはありません`                                                                   |
| `更新` の失敗(`role="alert"`) | `ファイルツリーを読み直せませんでした`                                                                     |
| 上限を超えたとき             | `ほか N 件(ファイルツリーから開いてください)`                                                           |
| copilot の注                 | 表の `note`(上の表)                                                                                     |
| `開く` の `aria-label`       | `<相対パス> を開く`(今の行と同じ形。例: `src/CLAUDE.md を開く`)                                         |

- 画面に出すのはフォルダからの相対パスだけで、絶対パスは出さない(今の節と同じ)

### アクセシビリティ

- 開閉のボタンは `aria-expanded`(`true`/`false`)を持つ。開いている間は、注・一覧(`<ul>`)・`ほか N 件`・0 件の文言をまとめて包む `div` を 1 つ描画し、その id(`useId` で作る)を開閉のボタンの `aria-controls` に渡す。0 件のときも、この `div` は描画する(中は 0 件の文言だけ)ので、`aria-controls` の先は必ずある
- 折りたたんでいる間は、この `div` を描画しない(`hidden` ではなく描画しない。中のボタンにタブで止まらない)。`aria-controls` は、描画していない間は付けない
- 開閉のボタンの文字に件数を入れるので、読み上げでも件数が伝わる。件数が変わっても読み上げ(live region)はしない(ツリーの読み直しのたびに読み上げると、関係の無い操作の最中に割り込むため)
- 注は一覧の前の段落にし、一覧(`<ul>`)の `aria-describedby` で結び付ける
- `ほか N 件` と 0 件の文言は段落(`<p>`)で、`role="alert"` にしない(失敗ではないため)
- サブフォルダの行の key はノードの `path`(安定した識別子。表示文言を key にしない)
- 押せない条件(`disabled`・`aria-disabled`)と、押してもフォーカスを残すこと(L-157)は、今の `開く` と同じ。`更新` の押せない条件は上の「`更新` のボタン」

## 4. テスト方針

- 表(`src/shared/__tests__/agentInstructionFiles.test.ts` に足す): CLI ごとに `names` が 1 つ以上で名前が重複しない、名前に区切り(`/`・`\`)を含まない、claude の注が null、copilot の注が空でない
- 探索(`lib/__tests__/agentInstructionSubfolderLookup.test.ts`。ツリーを手で組む)
  - 根の直下のファイルを含めない(`CLAUDE.md` は「このフォルダ」の分)
  - 入れ子のファイルを見つけ、相対パスを `/` でつなぐ
  - `excludedSegments` の位置(`.claude/CLAUDE.md`)を除く。除くのは根の位置だけで、サブフォルダの中の `.claude/CLAUDE.md`(`src/.claude/CLAUDE.md`)は `CLAUDE.md` という名前のファイルなので出る
  - 名前の完全一致(`claude.md` を出さない)、同じ名前のフォルダ(`CLAUDE.md` という名前のフォルダ)を出さない
  - 並べ方: 祖先のフォルダが先、同じフォルダの中は表の順、兄弟のフォルダは `localeCompare` の順
  - 上限: 51 件のツリーで、`rows` が 50 件、`total` が 51。上限ちょうどの 50 件では `total` が 50
  - 空のツリーで 0 件
  - 相対パスをノードの `path` から作らない(ノードの `path` を根と違う書き方にしても、相対パスがフォルダの名前からできる)
- hook(`hooks/__tests__/useAgentInstructionFiles.test.ts` に足す)
  - ツリーを差し替える(読み直しに当たる)と、サブフォルダの一覧が変わる
  - CLI を切り替えると、対象の名前と注が変わる
  - `openSubfolderFile` が `openFile` にノードを渡す。作成の途中は呼ばない。失敗の文言を消す
  - `refresh` が `refreshTree` を 1 回呼ぶ。結果を待つ間は `isRefreshing` が立ち、2 回目は呼ばない(ref で止める。同じ tick の 2 回でも 1 回)。作成の途中は呼ばない。失敗の文言を消す。`refreshTree` が拒否しても `refresh` は拒否せず、`isRefreshing` が下りる。拒否されたら `message` が `ファイルツリーを読み直せませんでした` になり、例外の文言は入らない。待つ間にフォルダか CLI の種類を変えると文言を出さない。`false` を返したときは文言を出さない
- 部品(`components/explorer/__tests__/AgentInstructionSubfolderList.test.tsx` と、節のテストに足す)
  - 小見出し `このフォルダ` と開閉のボタン `サブフォルダ(N 件)` が出る。既定は折りたたみ(`aria-expanded="false"`、一覧が無い)
  - 押すと開き(`aria-expanded="true"`・`aria-controls` が注・一覧などを包む `div` の id)、もう一度押すと閉じる
  - 0 件で開くと `サブフォルダに指示ファイルはありません`。0 件で開いても、`aria-controls` の id の要素が文書の中にある
  - 上限を超えると `ほか N 件(ファイルツリーから開いてください)`
  - copilot の注が出て、一覧の `aria-describedby` が注を指す。claude では注が無い
  - `開く` の `aria-label`、clone 中の `disabled`、作成の途中の `aria-disabled`(押しても呼ばない・フォーカスが残る)
  - 開いた状態で件数が 0 になっても、開閉のボタンが残り、フォーカスを持ったまま
  - `更新`: `aria-label` が `指示ファイルの一覧を更新`、押すと `refresh` を呼ぶ。clone 中は `disabled`。作成の途中と `更新` の途中は `aria-disabled` で、押しても呼ばず、フォーカスが残る。`message` が `ファイルツリーを読み直せませんでした` のとき、節の `role="alert"` に出る
- 配線(`App` の統合のテスト): サブフォルダに `CLAUDE.md` があるツリーで、開閉のボタンを押して `src/CLAUDE.md を開く` を押すと、そのファイルの読み込み(`readFileContent`)が呼ばれる。`更新` を押すと `readDirectory` がもう一度呼ばれ、返したツリーに足したサブフォルダのファイルが一覧に出る
- 全体の検証: `npm test`(`NODE_ENV=test`)・`npm run typecheck`・変更したファイルへの `npx eslint`・`npx vitest run scripts`(テスト仕様書の書式)

## 5. 既知の制約

- 一覧はファイルツリーから作るので、ツリーに出ないものは出ない。`SKIP_DIRS`(`node_modules`・`.git`・`out`・`dist`・`.next`)の中と、6 段目以降のフォルダの中は探さない。`.gitignore` された場所は探す(ツリーと同じ)
- `.gitignore` を見ないので、git の worktree の中のもの(`.worktrees/<名前>/CLAUDE.md`、`.claude/worktrees/<名前>/CLAUDE.md` など)も一覧に並ぶ。同じ内容のファイルが複数並ぶことがある
- フォルダの読み込みに失敗してツリーが空のときも、`サブフォルダ(0 件)` と `サブフォルダに指示ファイルはありません` が出る(「このフォルダ」の行が `作成` になるのと同じ扱い。失敗はエクスプローラーのエラーに出る。L-002)
- 外部(ターミナルやエージェント CLI)で足した・消した指示ファイルは、ツリーを読み直すまで一覧に反映しない。節の `更新` を押す(ツリーの自動の更新は ROADMAP の file watcher)
- 古い一覧で、実際には消えたファイルの `開く` を押すと、読み込みの失敗として今の経路(エクスプローラーのエラー)で伝わる
- フォルダの切り替えの途中(新しいフォルダの読み込みの間)は、前のフォルダのツリーと一覧が残る。その間に前のフォルダの行の `開く` を押すと、ファイルツリーで前のフォルダのファイルを押したときと同じく、読み込みの拒否として伝わる(今の「このフォルダ」の `開く` とツリーと同じ)
- 名前は完全一致で比べる。大文字と小文字だけ違うファイル(`lower/claude.md`)は出ない
- シンボリックリンクはツリーで `type: 'file'` として出るので、リンクの `CLAUDE.md` は一覧に出る。リンク先がフォルダの外なら、`開く` は読み込みの拒否になる。フォルダを指すリンクの中はたどらない(ツリーと同じ)
- 上限(50 件)を超えた分は一覧に出ない。ファイルツリーから開く
- copilot は、このアプリから起動したときはサブフォルダの `AGENTS.md` を読まないことがある(1.0.106 で確かめた)。一覧に出ていても、CLI に効いているとは限らない。注で伝える
- claude のサブフォルダの `CLAUDE.md` は、CLI がそのフォルダのファイルを読んだときに読む(起動の時ではない)。この挙動は Claude Code 2.1.291 の実行ファイルの文字列から読んだもので、画面では確かめていない
- 各 CLI が読むファイルのうち、`.claude/rules/`・`.github/instructions/**/*.instructions.md`・claude の `AGENTS.md`・copilot の `CLAUDE.md`・`GEMINI.md` は一覧の対象にしない(表の名前は利用者が選んだもの)
- サブフォルダの中の `.claude/CLAUDE.md`(`src/.claude/CLAUDE.md` など)も、`CLAUDE.md` という名前のファイルなので一覧に出る。claude がこの位置を読むかは確かめていない
- 極端に低いウィンドウ・拡大表示では、ファイルツリーに 88px を残す代わりに、節が縮んで中でスクロールする(節の上の方が見えないことがあり、スクロールで届く)
- 開閉の状態は保存しない。アプリを開き直すと折りたたんだ状態に戻る

## 6. 気をつける知見の ID

- L-009 大文字小文字を区別しないファイルシステム(名前の完全一致。今の判定と同じ扱い)
- L-016 シンボリックリンク(リンクの `CLAUDE.md` を開くときは今の読み込みの境界に任せる)
- L-035 位置ベースの識別子のずれ(行はノードそのものを持ち、番号で指さない。key はノードの `path`)
- L-037・L-040 古い結果(一覧はツリーから毎回計算し、別に控えない)
- L-048 既存の機能と同じ操作(`開く` は今の行・ファイルツリーと同じ経路にする)
- L-060 省略可能な props による配線漏れ(新しい部品の props は必須)
- L-157 押したボタンのフォーカス(作成の途中は `aria-disabled`。開閉のボタンは件数に関係なく出す)
- L-466 CLI の種類は `appCliKind` を受け取り、`useAgentCliKind` を呼び直さない
- L-653 作成の連打(作成の途中の判定は今の ref を使う)
- L-059 CLI の実物の挙動(copilot は実行で確かめた。claude は文字列だけで、画面では未確認)
- L-001 成否の伝達(`refreshTree` は失敗を `folderLoadError` にしか書かず、エクスプローラーの赤字に出ない。`更新` は拒否を受け止めて、節に固定の文言を出す。`false`〈反映しなかった〉は失敗として扱わない)
- L-002 「無い」と「失敗」の取り違え(読み込みの失敗で空のツリーになったときも「ありません」と出る。既知の制約に書き、「このフォルダ」の行と同じ扱いにする)
- L-004 後始末で他の物を消す: 当てはまらない(この PR は何も作らず、消さない)
- L-017 パスを画面に出さない(節に出すのは相対パスだけ。新しい文言に絶対パスや例外の文言を入れない)
- L-018・L-019 renderer の値でパスを決めさせない: 当てはまらない(新しい IPC が無い。次の PR で効く)
- L-044 受け付けない入力を既定に流す: 当てはまらない(新しい入力の検証が無い。表は `AgentCliKind` の型で引く)
- L-061 新しい入口が既存の守りを通るか(`更新` はツリーの書き込みの新しい入口だが、走査中の抑止と古い結果の破棄を持つ既存の `refreshTree` だけを通す。別の読み直しを書かない)

## 7. 次の PR の方針(利用者の全体の指示ファイル)

利用者が選んだ方針(この PR では作らない):

- 節に小見出し「全体(すべてのプロジェクト)」を足し、利用者の全体の指示ファイルを出す。開くことも作成することも許す
- 対象は main が持つ固定のパスに限る。renderer は識別子だけを送り、パスは main が決める(L-018・L-019)。候補は調べた範囲で、claude は `~/.claude/CLAUDE.md`(`CLAUDE_CONFIG_DIR` があればその下)、copilot は `~/.copilot/copilot-instructions.md`(`COPILOT_HOME` があればその下)
- 全体の指示ファイルは許可フォルダの外にあるので、読む(`fs:readFile`)・保存する(`fs:writeFile`・`fs:writeFileChecked`)・監視する(`fs:setWatchedFiles`)の境界のすべてに、固定のパスの許可リストを足す(1 か所だけ広げると、ほかの入口で断られる・すり抜ける。L-061)
- リンクを検査する。realpath した先が許可リストの想定と違う(ホームの外を指すなど)ときは断る。作成は今と同じく上書きしない(`wx`)。親のフォルダ(`~/.claude`)を作るときも、リンクを辿って外に作らない(L-016)
- 画面には「すべてのプロジェクトに効く」ことを示し、パスは `~/…` の形で出す。例外の文言(絶対パスを含む)は画面に出さない(L-017)
- 有無は main に問い合わせる。「無い」と「調べられなかった」を分けて返す(L-002)
- 設計の前に、claude の `/memory` の画面などで全体のファイルの場所と、`CLAUDE_CONFIG_DIR` の扱いを実物で確かめる(L-059)

## 8. 実機テスト仕様書の項目の案

`docs/manual-test-spec.md` の「エージェントの指示ファイル」(`###`)の後に、新しい機能の見出し(`###`)を足し、EXP-086 から振る(今の `EXP` の最大は EXP-085)。

```markdown
### サブフォルダのエージェントの指示ファイル

> 前提: 端末で `DIR="$(mktemp -d)" && mkdir -p "$DIR"/src/sub "$DIR"/lower "$DIR"/.claude "$DIR"/node_modules/pkg && for f in CLAUDE.md .claude/CLAUDE.md src/CLAUDE.md src/CLAUDE.local.md src/sub/CLAUDE.md lower/claude.md node_modules/pkg/CLAUDE.md src/AGENTS.md; do echo x > "$DIR/$f"; done && echo "$DIR"` を実行し、アプリの `フォルダを開く` で `$DIR` を開く(フォルダの選択画面では Cmd+Shift+G でパスを入力できる)。設定の `使うエージェント CLI` は `Claude Code` から始める。`${DIR:?}` は、端末を開き直して `$DIR` が空のときは止まる。元の設定が `GitHub Copilot CLI` だった場合は、最後の項目の後で設定を戻す。

- [ ] **EXP-086** フォルダを開いてエクスプローラーの節を見る → 節の見出しの右に `更新` がある。節の中に小見出し `このフォルダ` があり、その下に今までの 3 行が並ぶ。その下に `サブフォルダ(3 件)` のボタンがあり、折りたたまれていて、サブフォルダの行は見えない
- [ ] **EXP-087** `サブフォルダ(3 件)` を押す → `src/CLAUDE.md`(共有の指示)・`src/CLAUDE.local.md`(個人の指示)・`src/sub/CLAUDE.md`(共有の指示)の 3 行がこの順に `開く` 付きで出る。`.claude/CLAUDE.md`・`lower/claude.md`・`node_modules/pkg/CLAUDE.md`・`src/AGENTS.md` は出ない。もう一度押すと折りたたまれる
- [ ] **EXP-088** サブフォルダが閉じていれば開き、`src/sub/CLAUDE.md` の `開く` を押す → `src/sub/CLAUDE.md` がタブで開き、中身は `x`。もう一度押すと、同じタブに切り替わる(タブは増えない)
- [ ] **EXP-089** ファイルツリーで `src/sub` フォルダを右クリックして `新規ファイル` を選び、`CLAUDE.local.md` を作る → 節のボタンが `サブフォルダ(4 件)` に変わり、開いていれば `src/sub/CLAUDE.md` の後に `src/sub/CLAUDE.local.md` が出る(開き直さなくても出る)
- [ ] **EXP-090** 端末で `mkdir -p "${DIR:?}/src/new" && echo x > "${DIR:?}/src/new/CLAUDE.md" && echo x > "${DIR:?}/CLAUDE.local.md"` を実行して節を見る → 一覧は変わらない。Tab で `更新` に移って Enter で押すと、タブは閉じずに、サブフォルダの件数が 1 増えて(閉じていれば開くと)`src/new/CLAUDE.md` が出て、「このフォルダ」の `CLAUDE.local.md` の行が `開く` に変わる。押した後もフォーカスの枠が `更新` に残る
- [ ] **EXP-091** 端末で `mkdir -p "${DIR:?}/a/b/c/d/e/f" && echo x > "${DIR:?}/a/b/c/d/e/CLAUDE.md" && echo x > "${DIR:?}/a/b/c/d/e/f/CLAUDE.md"` を実行し、節の `更新` を押してサブフォルダが閉じていれば開く → `a/b/c/d/e/CLAUDE.md` は出て、`a/b/c/d/e/f/CLAUDE.md` は出ない(ファイルツリーで `f` を開いても中が空なのと同じ)
- [ ] **EXP-092** 端末で `for i in $(seq 1 55); do mkdir -p "${DIR:?}/many/m$i" && echo x > "${DIR:?}/many/m$i/CLAUDE.md"; done` を実行し、節の `更新` を押してサブフォルダが閉じていれば開く → ボタンが `サブフォルダ(61 件)` になり、行は 50 行まで出て、一覧をスクロールすると最後に `ほか 11 件(ファイルツリーから開いてください)` が見える
- [ ] **EXP-093** 設定の `使うエージェント CLI` を `GitHub Copilot CLI` に変えてエクスプローラーに戻り、サブフォルダが閉じていれば開く → `src/AGENTS.md`(共有の指示)だけが出て、一覧の上に `GitHub Copilot CLI は、サブフォルダの AGENTS.md を読まないことがあります(このアプリはフォルダの根で CLI を起動するため)` が出る。`CLAUDE.md` の行は出ない
- [ ] **EXP-094** 設定を `Claude Code` に戻し、端末で `D2="$(mktemp -d)" && echo "$D2"` を実行して空のフォルダを作り、`フォルダを変更` で開き、サブフォルダが閉じていれば開く → `サブフォルダ(0 件)` で、開いた中に `サブフォルダに指示ファイルはありません` が出る
- [ ] **EXP-095** 端末で `mkdir -p "${DIR:?}/a-very-long-folder-name-for-wrapping-check" && echo x > "${DIR:?}/a-very-long-folder-name-for-wrapping-check/CLAUDE.md"` を実行し、`フォルダを変更` で `$DIR` を開き直し、節の `更新` を押してサブフォルダが閉じていれば開いて、サイドバーを最も狭い幅(220px)までドラッグで狭める → 長い相対パス(`a-very-long-folder-name-for-wrapping-check/CLAUDE.md`)と説明が折り返し、`開く` のボタンは行の右端に収まる。見出しの `更新` も見出しの行の右端に収まる
- [ ] **EXP-096** VoiceOver を有効にし、Tab で `サブフォルダ(N 件)` のボタンに移って Space で開閉する → 開閉に合わせて「展開」「折りたたみ」の状態が読み上げられ、件数もボタンの名前として読み上げられる。`a/b/c/d/e/CLAUDE.md を開く` のように、どのファイルを開くボタンかが読み上げられる。`更新` は `指示ファイルの一覧を更新` と読み上げられる
- [ ] **EXP-097** `リポジトリを clone` で clone を実行している間に節を見る(clone が終わると開いているフォルダが clone 先に切り替わるので、この項目は EXP-098・EXP-099 の後に行う) → 開閉のボタンは押せ、`更新` とサブフォルダの行の `開く` は押せない
- [ ] **EXP-098** `フォルダを変更` で `$DIR` を開き直し(EXP-092・EXP-095 の後で 62 件ある)、サブフォルダが閉じていれば開く → ファイルツリーが画面に残る。一覧はその中でスクロールでき、最後の行まで見える。ウィンドウの高さを縮めても、ファイルツリーが少なくとも 3 行分残り、節は中でスクロールできる(閉じたとき・開閉のボタン・`更新` も、節の中のスクロールで届く)
- [ ] **EXP-099** EXP-098 の状態(サブフォルダを開き、ウィンドウを低くした状態)で、EXP-081 と同じ操作(端末で `rm "${DIR:?}/CLAUDE.local.md" && echo x > "${DIR:?}/claude.local.md"` を実行してから `フォルダを変更` で `$DIR` を開き直し、`CLAUDE.local.md` の `作成` を押す)をする → 低いウィンドウでも、失敗の文言(EXP-080 と同じ)が見える位置まで節の中が動き、`このフォルダ` の一覧のすぐ下(サブフォルダの開閉のボタンの上)に文言が見える
```

追記したら `node scripts/build-manual-test-spec.mjs` で HTML を再生成し、Artifact を同じファイルパス(`.superpowers/manual-test-spec.html`)で再公開する。`npx vitest run scripts` が通ることを確かめる。

## 9. ROADMAP・README の更新の方針

- `ROADMAP.md` の実装済み機能の「エージェント向けの指示ファイルの編集支援」(`###`)に、次の項目を `[x]` で足す
  - 節を小見出し `このフォルダ`・`サブフォルダ(N 件)` に分け、サブフォルダの指示ファイル(claude: `CLAUDE.md`・`CLAUDE.local.md`、copilot: `AGENTS.md`)を一覧して開く。ファイルツリーから探し、ツリーの読み直しに連動する。節の `更新` でファイルツリーを読み直す。既定は折りたたみ、上限は 50 件(超えた分は `ほか N 件`)。作成は出さない。copilot には読まないことがある旨の注を出す(2026-11-07。設計書 `docs/superpowers/specs/2026-11-07-agent-instruction-files-subfolders-design.md`)
- 同じ節に「既知の制約」として、この設計書の「5. 既知の制約」のうち、外部での追加の反映(`更新` を押す)・ツリーの範囲(`SKIP_DIRS`・深さ・worktree の中も並ぶ)・copilot が読まないことがある、の 3 つを書く
- 「エージェント実行の支援(MVP の次)」の `[x] エージェント向けの指示ファイル(…)の編集支援` の説明に、2026-11-07 の実装済みの 1 文(この設計書を参照)を足し、「残り」から「サブフォルダの指示ファイルの探索」を消す。残りは「利用者の全体の指示ファイル(`~/.claude/CLAUDE.md` など)、プロンプトの内容の追記、外部での追加・削除の自動の反映(file watcher)」になる
- `docs/developer-guide.md` の 3.4 の、CLI ごとの違いの表の並びにある `src/shared/agentInstructionFiles.ts`〈指示ファイルの一覧と雛形〉の説明を、〈指示ファイルの一覧と雛形・サブフォルダで探す名前〉に直す
- `README.md` の「エクスプローラー・エディタ」の説明の文(エージェントの指示ファイルを開く・雛形で作る)に、「サブフォルダにある指示ファイルも一覧から開けます」を足す
