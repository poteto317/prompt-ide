# ファイルツリー・ソース管理の自動更新（file watcher） 設計書

## 読み方

この設計書で「今」「今の」と書くのは、設計した時点（2026-11-08。ブランチ `feat/file-tree-auto-refresh` は `c36825d`）のことを指す。
「静かに取り直す」は、取り直しの間も読み込み中の表示（`読み込み中...`・淡色のボタン・エラーの消去）を出さず、内容が同じなら画面の値を置き換えないことを指す。
「契機」は、取り直しを始めるきっかけ（main の監視の通知・ウィンドウのフォーカスの復帰）を指す。

## 目的

エージェント（`claude`・`copilot`）やターミナルが作った・消した・書き換えたファイルと、外で行った git の操作（`git add`・`git commit`・`git checkout` など）を、利用者が `更新` を押さなくても、次の 3 つへ静かに反映する。

- エクスプローラーのファイルツリー（と、ツリーから作るエージェントの指示ファイルの節）
- ソース管理の git status（変更の一覧・ブランチ・ステータスバー）
- アクティブな diff タブの内容

ROADMAP の「ファイル / ワークスペース管理」の「ファイル変更の自動検知・ツリー自動更新（file watcher）」に当たる。開いているタブの外部変更の検知（MVP で実装済み）はこの設計で変えない。

## 1. 背景

### 今の監視（開いているタブの外部変更）

- `src/main/openFileWatcher.ts` の `OpenFileWatcher` が、開いているタブの親ディレクトリを `fs.watch` の非再帰で監視する。所有者（webContents の id）ごとに状態を持ち、名前が開いているタブと一致するイベントを 300ms（`EXTERNAL_CHANGE_DEBOUNCE_MS`）の trailing debounce でまとめて通知する。最大の待ちは無い。`beginUpdate`/`isCurrentUpdate` の世代で、重なった `fs:setWatchedFiles` の古い一覧を反映しない
- 作るのは `src/main/ipcHandlers.ts:157-162`。`watch(dir, { persistent: false }, listener)` を渡し、通知は `sendExternalChange`（`handlers/externalChangeHandlers.ts`。`sendToOwner(ownerId, 'fs:externalChange', { paths })`）
- 片付けは `openFileWatcherLifecycle.ts` が `onOwnerContextEnded`（`ownerContextLifecycle.ts`。`destroyed`・`crashed`・`reloaded`・`folder-changed`）で `clear` する。`reloaded` は `did-navigate` で届き、新しい文書の preload より先に届く（`mainFrameDocumentReplaced.ts` のコメント）
- `FolderAccessManager.set` は前と違うパスのときだけ `onDidChange` を呼ぶ（`folderAccessManager.ts:16-22`）。リロードの後に同じフォルダを開き直しても `folder-changed` は届かない。`folderAccessLifecycle.ts` は `destroyed` でだけ許可を消すので、リロードの後も main には前のフォルダの許可が残る
- renderer は `useExternalFileChanges.ts` が `fs:setWatchedFiles` で一覧を送り、`fs:externalChange` とウィンドウの `focus`・`visibilitychange`（visible）で全タブを確かめる（`useExternalFileChanges.ts:181-195`）
- chokidar は依存に無い。Electron は ^39.2.6（実物は 39.8.10、Node 22.22.1）

### 今のツリー

- main の `readDirRecursive`（`src/main/fileSystem.ts:103-120`）が、`SKIP_DIRS`（`node_modules`・`.git`・`out`・`dist`・`.next`）の名前のディレクトリを飛ばし、`MAX_DEPTH = 5`（`traversalPolicy.ts`）まで読む。`readDirRecursive(パス, k)` は k ≤ 5 のときだけ中身を返すので、ツリーに出るのは根からの相対パスで 6 段（`MAX_DEPTH + 1`）までの項目になる。6 段目のフォルダは中身が空で出る。シンボリックリンクは `Dirent.isDirectory()` が偽なのでファイルとして出し、中へ降りない
- `fs:readDirectory` は許可フォルダそのもの（realpath が一致するもの）しか受けない（`handlers/fileSystemHandlers.ts:76-83`）
- renderer の `useFileTreeOperations.reloadTree`（`useFileTreeOperations.ts:104-131`）は毎回ルートから全部を読み、丸ごと `setFileTree` する。走査中は `beginTreeWrite` が null を返して書かせず、`refreshSkippedRef` を立てて走査の後に `retryRefreshSkippedDuringScan` でやり直す（`useFileSystem.ts:359-368, 412-427, 518-525`）。`treeWriteSeqRef` と「読む時点のフォルダ」で古い結果を捨てる。失敗は `reportTreeLoad(err)`（`folderLoadError`）の後に投げ直す
- `refreshTree` を呼ぶのは自分の操作の後だけ（作成・リネーム・削除・指示ファイルの作成と節の `更新`・`.gitignore` への追加・stash・取り消し・マージの中止・コンフリクトの解決・エージェントの変更を戻す）。保存の後・フォーカスの復帰・エージェントの完了・ブランチの切り替え・マージでは呼ばない
- フォルダの開閉は `DirectoryItem.tsx:24` の `useState(true)`。ツリーの各項目は `key={child.path}` なので、パスが同じなら開閉の状態は丸ごとの置き換えでも残る。新しく現れたフォルダは開いた状態で出る
- エージェントの指示ファイルの節（`useAgentInstructionFiles.ts`）の行とサブフォルダの一覧は、`fileTree` から毎回作る

### 今の git status

- `useGitStatus.refreshGitStatus`（`useGitStatus.ts:22-63`）は、取得の前に `gitLoading` を立てて `gitError` を消し、`latestRequestId` で古い結果を捨てる。`gitLoading` の間はソース管理の `更新` が `disabled` になる（`SourceControlToolbar.tsx:45`）。`読み込み中...` は `gitStatus === null` のときだけ出る（`SourceControlPanel.tsx:119`）
- 結果は内容が同じでも新しいオブジェクトとして `setGitStatus` する。`gitStatus` が変わると、エージェントの変更の一覧を取り直す（`useAgentChangesWiring.ts:151-153`。引数無しの `refreshAgentChanges()` で、`isLoading` を立てる取り方）
- main の `getGitStatus`（`src/main/gitService.ts:46-95`）は simple-git の `git.status()`・`rev-parse -q --verify MERGE_HEAD`・`git remote` を使う
- `useAgentChangesAutoRefresh.ts:14` のコメントに「git status は取り直さない。ソース管理の既存の手動テストの前提を変えない」とある。この設計はこの前提を変える（7 章で既存の手動テストを直す）

### 今の diff タブ

- `useDiffOperations` はアクティブな diff タブだけを取る。`diffRefreshSignal` と `refreshDiff({ quiet })`（`useDiffOperations.ts:148-154, 428-431`）で取り直す。静かな取り直しは、同じタブの内容を出したまま取る
- 対象のファイルの git status の文字（`index`+`workingDir`）や `from` が変わると、取得の effect が自動で走る（`useDiffOperations.ts:299`）。文字が変わらない内容の変化は、`refreshDiff` を呼ぶまで取り直さない（ROADMAP.md:1450 の既知の制約）
- agent の diff タブは、エージェントの変更の一覧の静かな取り直しの完了（`quietRefreshCount`）でも静かに取り直す（`useAgentChangesWiring.ts`）

### 今の合流の仕組み

`useAgentChangesAutoRefresh.ts:43-97` に、待ち（最後の契機から 300ms）・上限（最初の未処理の契機から 1000ms）・実行中は「もう 1 回」の印で 1 回だけやり直す・世代で古い完了を捨てる、という合流がある。React に依らない形に切り出せる。`src/renderer/src/lib/keyedCoalescer.ts` はキーごとの実行中の合流だけで、待ちと上限が無い。

ウィンドウの `focus` を購読しているのは、`useExternalFileChanges.ts:181-195` と `useAgentChangesAutoRefresh.ts:130-141` だけ。

### 実物で確かめたこと（macOS 26 系・Electron 39.8.10 の Node 22.22.1。`ELECTRON_RUN_AS_NODE=1` で一時フォルダに対して実行）

`fs.watch(root, { recursive: true })` を、realpath した一時フォルダに張って確かめた。

1. 通知の `filename` は根からの相対パス（例: `a/b/c/d/e/f/g/deep.txt`）。イベントの種類は作成・書き換え・削除・rename のどれでも `rename` だった（種類は当てにできない）
2. 7 段目の深いファイル、`node_modules/x/y.js` の書き込みも届く（除外は自分で行う必要がある）
3. `git add` は `.git/objects/…`・`.git/index.lock`・`.git/index` を、`git commit` はさらに `.git/logs/…`・`.git/refs/heads/…`・`.git/COMMIT_EDITMSG` を、`git checkout -b` は `.git/HEAD`・`.git/refs/heads/br` などを通知した
4. 根の中のシンボリックリンクのリンク先（根の外）への書き込みは届かない
5. `mkdir -p n1/n2` は `n1`・`n1/n2` の 2 件、`rm -r a` は中の全部の項目が届く
6. `persistent: false` でも recursive の通知は届く
7. 根を消しても `error` は出ず、消した項目の通知が届いた。同じパスに作り直すと、作り直した後の通知も届いた。通知の中に、根のフォルダ名そのもの（相対パスでない `wprobe-…`）が来ることがあった
8. **`git status` は `.git/index.lock` を必ず作って消し、作業ツリーの stat の情報が古いと `.git/index` も書き直す**。普通の時刻では、内容の同じ書き直しの直後の 1 回だけ `.git/index` を書いた（2 回目は `index.lock` だけ）。ファイルの更新時刻が未来のときは、`git status` のたびに `.git/index` を書き直した
9. simple-git 3.36.0 の `status()` に `GIT_OPTIONAL_LOCKS=0` の環境を渡すと（`unsafe` の許可を付けて `.env()`）、8 と同じ状況でも `.git` の中に何も書かなかった（通知が 0 件）
10. `git diff` は、内容が同じまま更新時刻だけ変わったファイルがあると `.git/index` を 1 回だけ書き直した（git 2.50.1。`GIT_OPTIONAL_LOCKS=0` でも同じ）。2 回目以降は書かず、更新時刻が未来のファイルでも書き続けなかった。アクティブな diff タブがあると余分な取り直しが 1 周走るが、そこで収束する（このブランチで確かめ直した）。ただし書き直す間は `.git/index.lock` を持つので、監視を契機にアプリの diff が自動で走ると、外の `git add`・`git commit` などが `index.lock` の取り合いで失敗しうる。書き直しは pathspec の中に stat だけ変わったファイルがあるときに起き、書くのは index 全体。**アプリの diff の取得（`getDiff`）は `-c diff.autoRefreshIndex=false` で書かせない**（外の git との `index.lock` の取り合いを避けるため。この PR で対応した）。書かせなくても、stat だけ変わったファイルの diff は空のまま（git 2.50.1 で実測）。また未ステージの diff の pathspec がサブモジュール（gitlink）だと、git diff は dirty かを調べる子の `git status` を起動し、子は `.git/modules/<sub>/index.lock` を取って stat が古ければ index も書き直す（`diff.autoRefreshIndex=false` は親の書き直ししか止めない）。**`getDiff` は `GIT_OPTIONAL_LOCKS=0` も足して子のロックを止める**（出力の `Subproject commit …-dirty` は変わらない。この PR で対応した）

8 から、git status の取り直しを `.git/index` の通知の契機にすると、アプリ自身の `git status` が次の通知を起こし、取り直しが止まらなくなりうる（更新時刻が未来のファイルがあると毎回）。この設計は 9 で直す（3 章「git status の取得」）。

確かめていないこと: Windows（`ReadDirectoryChangesW`）と Linux（inotify）での recursive の挙動。Node の Linux の recursive は全部の子孫を辿って個別に監視を張り、除外を指定できない作りと理解しているが、実物では確かめていない。

## 2. 決めたこと

利用者が決めたこと（すべて推奨の案。5 は設計書のレビューの後に利用者が選んだ）:

1. **範囲**: 同じ監視の通知で、ツリー・git status・アクティブな diff タブを静かに取り直す。1 つの PR にする
2. **`.git` の中**: `index`・`HEAD`・refs の変化を拾い、git status と diff タブだけを取り直す。`.git` の中の変化ではツリーを読み直さない
3. **フォーカスの復帰**: ウィンドウの `focus` と `visibilitychange`（visible）でも、ツリーと git status（と diff タブ）を静かに取り直す
4. **新しく現れたフォルダ**: 今のまま開いた状態で出す。開閉の状態は今どおり、パスが同じなら残る
5. **Linux では監視を張らない**（利用者が選んだ。フォーカスの復帰だけで取り直す）。Node の Linux の recursive は全部の子孫を辿って個別に監視を張り、除外を指定できない（実物では確かめていない）ため、`node_modules` を含むフォルダで監視の数が大きくなりうる

この設計で決めたこと（利用者の意思が要る選択は無かったので、推奨の方向で決めた）:

- **監視の方式**: main が、開いているフォルダのルートを `fs.watch` の recursive で 1 本監視する（所有者ごと）。イベントの相対パスを、ツリーと同じ規則（`shouldSkipDir`・`MAX_DEPTH`）で「ツリーが変わりうる」「git status だけが変わりうる」「無視する」に分ける。`.git` の中は 3 章の一覧のパスだけを git の変化として拾う
- **既存の `OpenFileWatcher` とは別の監視にする**。開いているタブはフォルダの外（全体の指示ファイル）にもあり、名前で絞る判定と、rename での置き換えへの備え（ファイルそのものを監視すると、rename で置き換えた後に通知が届かなくなるため、親ディレクトリを非再帰で監視している。`openFileWatcher.ts` の冒頭のコメント）の扱いが違うため。ライフサイクル（`onOwnerContextEnded`）・送信（`sendToOwner`）・所有者ごとの状態の持ち方は同じ作りを使う。macOS では同じディレクトリを 2 つの監視が見るが、FSEvents の stream が 1 本増えるだけで負荷は小さい
- **監視を張るかを決めるのは renderer、どのフォルダを張るかを決めるのは main**。renderer はマウント時に `fs:setFolderWatch(true)`、アンマウント時に `false` を送るだけで、パスは送らない（L-018・L-019 の考え方。許可フォルダは main が持つ）。main は有効な所有者について、許可フォルダが変わるたび（`folder-changed`）に張り直す。これで A → B → A の切り替えでも renderer の送り直しに頼らずに張り直される（L-571）。リロード・クラッシュ・破棄では無効に戻し、新しい文書の renderer がマウント時に有効にし直す（`reloaded` は新しい文書の preload より先に届くので、有効にし直す依頼の後に無効にされることは無い）。main が `folder-changed` だけで自動で張る案は、リロードの後に同じフォルダを開き直すと `folder-changed` が届かず張られないので採らない
- **間引き**: main で、待ち 300ms（最後の通知から）・上限 1000ms（最初の未処理の通知から）の早い方で 1 回にまとめて送る（L-399）。renderer は、同じ瞬間に重なる契機（`focus` と `visibilitychange`、通知とフォーカス）をまとめるだけの短い待ち（50ms・上限 300ms）と、実行中の「もう 1 回」の印で合流する
- **手動の読み直しを静かな読み直しで追い越さない**。手動の読み直しの途中に届いた静かな読み直しは、手動が終わった後に 1 回だけ走らせる（3 章「ツリーの静かな読み直し」）。手動の呼び出し元（指示ファイルの作成・走査の後のやり直し）は戻り値のツリーを使うため
- **自分の操作の直後の二重は許す**。保存・作成・git の操作の後には今の取り直しが走り、その後に監視の通知でもう 1 回静かに取り直す。静かな取り直しは内容が同じなら画面の値を置き換えないので、二重でも画面は揺れない。操作と通知を結び付けて間引く案は、同じ時間に外で起きた変更を取りこぼすので採らない
- **静かな取り直しの失敗は画面に出さず、前の内容を残す**（L-001・L-002。失敗を「空」にしない）。ツリーなら前のツリー、git status なら前の status とエラーの表示をそのまま残す。手動の操作（`更新`・作成など）の失敗の表示は今のまま
- **git status の取得は `GIT_OPTIONAL_LOCKS=0` で行う**（手動の取り直しも含む。1 章の 8・9）。アプリの `git status` が `.git/index` を書かなくなり、自分の取り直しが次の通知を起こさない
- **静かな git status の取り直しで内容が変わったときに連鎖するエージェントの変更の一覧の取り直しも、静かに取る**（`isLoading` を立てない）
- **フォルダの走査中は、git status と diff の静かな取り直しをしない**（始めるときに走査中なら始めず、完了したときに走査中なら結果を捨てる。ツリーは今の `beginTreeWrite` の抑止と走査後のやり直しに任せる）。走査中は main の許可が新しいフォルダ、renderer の `folderPath` が前のフォルダのままで、静かに取った status を前のフォルダの画面に出してしまうため（L-037）。走査が終わってフォルダが変わると、今の `useGitStatus` の effect が取り直す
- **範囲外**（5 章・8 章）: `.gitignore` に従う除外、開閉の状態の保存、全体の指示ファイル（`~/.claude/CLAUDE.md` など）の監視、部分的なツリーの読み直しの API、開いているタブの監視の改善（最大の待ちの追加など）、コミット履歴・ブランチ一覧の自動の取り直し

## 3. 設計

### 変化の分類（`src/main/folderChangeClassifier.ts`。新規・純粋な関数）

```ts
export type FolderChangeKind = 'tree' | 'git' | 'ignore'

/** relativePath は fs.watch の filename(根からの相対パス)。null・空文字は分からないので 'tree' */
export function classifyFolderChange(
  relativePath: string | null,
  platform: NodeJS.Platform
): FolderChangeKind
```

- 区切り: `win32` では `\` と `/` の両方、それ以外は `/` で分ける。空の要素（先頭・末尾の区切り）は捨てる
- `null`・空文字・分けた結果が空: `tree`（何が変わったか分からないので両方を取り直す）
- 先頭の要素が `.git`（大文字小文字は区別する。`shouldSkipDir` と同じ比べ方）:
  - `.git` そのもの（要素が 1 つ）: `tree`（`git init`・`.git` の削除・worktree や submodule の `.git` ファイルの作り直しで、リポジトリかどうかが変わる。`readDirRecursive` が飛ばすのはディレクトリの `.git` だけ〈`fileSystem.ts:108`〉で、`.git` ファイルはツリーに出るため、ツリーも読み直す。`tree` は git の取り直しを含む）
  - 2 つ目以降が次のどれかなら `git`。どれにも当たらなければ `ignore`
    - `index`・`HEAD`・`MERGE_HEAD`・`packed-refs`（要素が 2 つ）
    - `refs/…`（2 つ目が `refs`）。ただし 3 つ目が `prompt-ide`（`refs/prompt-ide/` の下）なら全部 `ignore`。今この下に書くのは、エージェントの変更の記録を守る ref（`AGENT_CHANGES_PROTECTION_REF_PREFIX` の `refs/prompt-ide/agent-changes/`）だけで、アプリ自身の ref は git status に出ない。名前空間の `prompt-ide` は `agentChangesProtectionRules.ts` の `APP_REFS_NAMESPACE` の 1 か所で決め、接頭辞も分類もそれを使う
  - 最後の要素が `.lock` で終わるものは `ignore`（`index.lock`・`HEAD.lock`・`refs/heads/br.lock`。1 章の 3・8。確定した書き込みは `.lock` の無い名前で届く）
  - `MERGE_HEAD` を足す理由: マージ中かどうか（`mergeInProgress`）は git status の結果の一部で、外で `git merge` を中止すると `MERGE_HEAD` だけが消える。`packed-refs` を足す理由: refs の書き方の 1 つ（`git pack-refs`・ブランチの削除で書き換わる）
- 最後の要素を除くどれかの要素が `shouldSkipDir` に当たる: `ignore`（`node_modules/…`・`dist/…`・入れ子の `sub/.git/…`。ツリーに出ず、git status の取り直しも走らせない。ビルドの出力やパッケージの導入で通知が大量に来ても取り直さない）
- 最後の要素が `shouldSkipDir` に当たる（`dist` などの名前の項目そのもの）: 下の段数の規則で決める（同じ名前のファイルはツリーに出るため）
- 要素の数が `MAX_DEPTH + 1`（6）以下: `tree`（境界は `traversalPolicy.ts` の `isWithinTreeDepth` の 1 か所で決め、`readDirRecursive` も同じ関数で読む深さを決める）
- それより深い: `git`（ツリーには出ないが、作業ツリーの変化で git status が変わりうる）

`tree` は「ツリーと git status の両方を取り直す」、`git` は「git status だけ」を表す（作業ツリーの変化は git status も変えうるため、`tree` は git の取り直しを含む）。

根のフォルダ名そのものが届く場合（1 章の 7）は、根の直下の項目と同じ扱い（`tree`）になる。余分な取り直しが 1 回増えるだけなので、区別しない。

### 監視（`src/main/folderChangeWatcher.ts`。新規）

```ts
export const FOLDER_CHANGE_WAIT_MS = 300
export const FOLDER_CHANGE_MAX_WAIT_MS = 1_000

export interface FolderWatch {
  close(): void
  on(event: 'error', listener: (err: Error) => void): unknown
}

/** フォルダを recursive で監視する */
export type WatchFolder = (
  folder: string,
  listener: (eventType: string, filename: string | Buffer | null) => void
) => FolderWatch

export interface FolderChangeWatcherDeps {
  /** null は「この環境では監視しない」(Linux) */
  watch: WatchFolder | null
  /** 所有者の今の許可フォルダ(FolderAccessManager.get) */
  getFolder: (ownerId: number) => string | undefined
  notify: (ownerId: number, event: FolderChangeEvent) => void
  platform: NodeJS.Platform
  waitMs?: number
  maxWaitMs?: number
}

export class FolderChangeWatcher {
  /** renderer の依頼。有効にして、今の許可フォルダを張る(張っていれば何もしない。「張っている」は current !== null && current.folder === getFolder(ownerId)) */
  enable(ownerId: number): void
  /** renderer の依頼・リロード・破棄。監視を閉じ、予約を取り消し、無効に戻す */
  disable(ownerId: number): void
  /** 許可フォルダが変わった。有効な所有者だけ、前の監視を閉じて新しいフォルダを張る */
  onFolderChanged(ownerId: number): void
  /** 監視しているフォルダ(テスト用) */
  watchedFolder(ownerId: number): string | null
}
```

所有者ごとの状態:

```ts
// 張っている監視と、そのフォルダ(片方だけがある状態を作らないよう、組で持つ)
interface ActiveWatch {
  folder: string
  watch: FolderWatch
}

interface OwnerState {
  current: ActiveWatch | null // 張っている監視(null は監視無し)
  coalescer: FolderChangeCoalescer // この所有者の通知の合流(張り直し・閉じるで未送信を捨てる)
}
```

通知の合流（未送信の分類・待ちと上限のタイマー・送る）は `src/main/folderChangeCoalescer.ts` の `FolderChangeCoalescer`（`add(kind)`・`cancel()`。送り先の `send` を注入する）が受け持つ。`FolderChangeWatcher` は監視の寿命と分類の呼び出しだけを持つ。この環境での張り方（Linux は張らない・`recursive: true`・`persistent: false`）は `src/main/recursiveFolderWatch.ts` の `createRecursiveFolderWatch(platform, fsWatch)` が `WatchFolder | null` を返す。

- 有効な所有者だけ `owners` の Map に入る。`disable` で消す
- 張る（`open(state, folder)`）: 前の監視を閉じ、合流の予約と未送信を捨てて（`coalescer.cancel()`）から、`watch(folder, listener)` を呼ぶ。`watch` が null（Linux）・同期で投げる（`ENOENT`・`EMFILE` など）ときは `current = null` のまま（フォーカスの復帰に任せる）。`error` を受けたら、その監視がまだ今の監視なら閉じて `current = null` にする（その場では張り直さない。フォーカスの復帰に任せる。「張っている」の定義〈`current !== null && current.folder === getFolder(ownerId)`〉を満たさなくなるので、次の `folder-changed` か `enable` で張り直す）
- listener は、自分を作った監視が今の `state.current?.watch` と同じときだけ扱う（閉じた監視の遅れた通知を新しいフォルダの通知にしない。L-037）。分類（`classifyFolderChange`）を `coalescer.add(kind)` に渡す。合流は `ignore` なら何もしない。そうでなければ未送信の分類に足し（tree があれば tree）、待ちのタイマーを張り直し、上限のタイマーが無ければ張る（L-399）
- 送る（合流の待ちと上限のどちらでも）: 両方のタイマーを取り消し、`{ treeChanged: <未送信に tree があったか> }` を `notify` に渡して未送信を消す。`notify` が投げても握りつぶす（タイマーのコールバックから main の未捕捉例外にしない。今の `OpenFileWatcher` と同じ）
- `enable` は同期の処理にする（`await` を挟まない）。StrictMode の二重実行（`true`→`false`→`true`）で、IPC の到着の順に処理されるため（L-469）
- `persistent: false` で張る（監視が main プロセスの終了を妨げない。今の監視と同じ。1 章の 6 で recursive でも届くことを確かめた）
- 監視するフォルダは `getFolder(ownerId)` の値（`dialog:openFolder` は realpath した値を入れる。clone は clone 先の値）。通知のパスは相対なので、realpath かどうかで分類は変わらない

### 寿命（`src/main/folderChangeWatcherLifecycle.ts`。新規）

```ts
export function setupFolderChangeWatcherLifecycle(
  app: App,
  watcher: Pick<FolderChangeWatcher, 'onFolderChanged' | 'disable'>,
  folderAccess: FolderAccessManager
): void {
  onOwnerContextEnded(app, folderAccess, (end) => {
    if (end.cause === 'folder-changed') watcher.onFolderChanged(end.ownerId)
    else watcher.disable(end.ownerId)
  })
}
```

アプリの終了では `persistent: false` なので閉じなくてよい（今の監視と同じ）。

### IPC

| 方向            | チャンネル          | 引数・payload              | 受け口                                                                                                 |
| --------------- | ------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| renderer → main | `fs:setFolderWatch` | `enabled: boolean`         | `src/main/handlers/folderChangeHandlers.ts`（新規）。boolean でなければ例外。`enable`/`disable` を呼ぶ |
| main → renderer | `fs:folderChange`   | `{ treeChanged: boolean }` | `sendFolderChange(ownerId, event)`（同じファイル）が `sendToOwner` で送る                              |

- `fs:setFolderWatch` の受け口は `ipcMain.handle` に同期の関数を渡す（戻り値は `undefined`）。所有者は `event.sender.id`
- payload にフォルダのパスは入れない。通知は「今の所有者のフォルダで何かが変わった」の合図で、renderer は今のフォルダを読み直す。フォルダの切り替えの前後で古い通知が届いても、余分な静かな取り直しが 1 回増えるだけ（古い結果は今の世代の仕組みが捨てる）
- 型 `FolderChangeEvent` は `src/shared/types/fileSystem.ts` に足す（`ExternalFileChangeEvent` の隣）

組み立て（`src/main/ipcHandlers.ts`。`OpenFileWatcher` の隣）:

```ts
const folderChangeWatcher = new FolderChangeWatcher({
  // Linux は null(監視しない)。それ以外は recursive・persistent: false で張る(recursiveFolderWatch.ts)
  watch: createRecursiveFolderWatch(process.platform, watch),
  getFolder: (ownerId) => folderAccess.get(ownerId),
  notify: sendFolderChange,
  platform: process.platform
})
setupFolderChangeWatcherLifecycle(app, folderChangeWatcher, folderAccess)
registerFolderChangeHandlers(ipcMain, folderChangeWatcher)
```

### git status の取得（`src/main/gitService.ts`）

`getGitStatus` の `git.status()` だけを、`GIT_OPTIONAL_LOCKS=0` を足した環境の simple-git で実行する（1 章の 9）。

- simple-git の `env()` は環境変数の中身を検査して、`GIT_ASKPASS`・`EDITOR` などがあると投げる（`agentBaselineGit.ts` の冒頭のコメント・`gitService.ts:301-307`）。`createModeGit` と同じく、`unsafe` に `INHERITED_ENV_ALLOWANCES` を渡して検査を外し、`process.env` の写しに `GIT_OPTIONAL_LOCKS: '0'` を足して渡す。`INHERITED_ENV_ALLOWANCES` は `agentBaselineGit.ts` から新しいモジュール `src/main/gitInheritedEnv.ts` へ移して export し、両方から使う（命令は `status` に固定で、`-c` も付けない。後に足した `getDiff` の git は命令を `diff` に固定し、`-c` は固定の値だけにする）
- `checkIsRepo`・`MERGE_HEAD` の確かめ・`git remote` は今のまま（`.git` の中に書かない）
- 手動の `更新`・操作の後の取り直しも同じ関数を通るので、同じく `.git/index` を書かなくなる（5 章）
- 1 ファイルの diff の `getDiff` は、simple-git の `config` に `diff.autoRefreshIndex=false` を足して `.git/index` を書かせない（1 章の 10。この PR で対応した）
- `getDiff` の git も `GIT_OPTIONAL_LOCKS=0` を足した環境で作り（`createStatusGit` と同じ環境の組み立てを共有し、命令は `diff` に固定する）、サブモジュールの dirty を調べる子の `git status` に `.git/modules/<sub>/index.lock` を取らせない（1 章の 10。この PR で対応した）

### preload（`src/preload/api.ts`・`index.d.ts`）

```ts
setFolderWatch: (enabled: boolean): Promise<void> =>
  ipcRenderer.invoke('fs:setFolderWatch', enabled),
onFolderChange: (listener: (event: FolderChangeEvent) => void): (() => void) => {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
    if (!isObjectLike(payload) || typeof payload.treeChanged !== 'boolean') return
    listener({ treeChanged: payload.treeChanged })
  }
  ipcRenderer.on('fs:folderChange', wrapped)
  return () => {
    ipcRenderer.removeListener('fs:folderChange', wrapped)
  }
}
```

renderer の `lib/fileSystemApi.ts` に同名の薄い関数を足し、`src/renderer/src/__tests__/setup.ts` の stub に `setFolderWatch: () => Promise.resolve()`・`onFolderChange: () => () => {}` を足す。

### 合流（`src/renderer/src/lib/refreshScheduler.ts`。新規・React に依らない）

`useAgentChangesAutoRefresh.ts` の合流を、依頼の中身（`T`）を合わせられる形で切り出す。

```ts
export interface RefreshSchedulerOptions<T> {
  waitMs: number
  maxWaitMs: number
  /** 未処理の依頼どうしを 1 つにまとめる */
  merge: (a: T, b: T) => T
  run: (request: T) => Promise<void>
  /** 受け付けるか。予約の時と走らせる時の両方で呼ぶ(false なら捨てる) */
  accepts: () => boolean
}

export interface RefreshScheduler<T> {
  /** 待ちを張り直し、上限は最初の未処理の依頼で張る */
  schedule: (request: T) => void
  /** 予約と未処理を捨て、実行中の完了を古いものにする(フォルダの切り替え・アンマウント) */
  reset: () => void
}
```

- 走らせる（待ちと上限のどちらでも）: 両方のタイマーを取り消す。`accepts()` が偽なら未処理を捨てる。実行中なら「もう 1 回」の印を立てて未処理を残す。そうでなければ未処理を取り出して `run` する。`run` の reject は握りつぶす。完了したとき、世代が変わっていなければ実行中を下ろし、印があれば下ろして、たまった未処理でもう 1 回走らせる
- `reset` は世代を進め、タイマーを取り消し、実行中・印・未処理を下ろす（L-108）
- `useAgentChangesAutoRefresh` はこれを使う形に書き換える（`T` は `true`、`merge` は `() => true`、`accepts` は記録中か、待ち 300ms・上限 1000ms）。挙動は変えず、今のテストがそのまま通ること。14 行目のコメントは「git status は取り直さない（git status の自動の取り直しは useFolderAutoRefresh が行う）」に直す

### ツリーの静かな読み直し（`useFileTreeOperations.ts`・`useFileSystem.ts`）

手動の `reloadTree` と別に、静かな読み直しの `refreshTreeQuietly` を足す（引数の切り替えで 1 つの関数に 2 つの振る舞いを持たせない）。1 回の読み込みと反映は両方から呼ぶ `readAndApplyTree(quiet)` が受け持ち、下の比べ方と失敗の扱いを `quiet` で分ける。

- 書き込みの開始（`beginTreeWrite`）・読む時点のフォルダ・古さの判定は今のまま（走査中は抑止し、走査の後にやり直す。古い結果は捨てる。L-040）
- **手動の読み直しを静かな読み直しで追い越さない**（git status の `inheritsLoud` と同じ考え方。下の 2 つの案のうち (a) に決めた）。静かな読み直しも `beginTreeWrite` で世代を進めるので、手動の読み直しの途中で静かな読み直しが始まると、手動の結果が古いものとして捨てられ、手動は null を返す。手動の呼び出し元は戻り値を見ている（指示ファイルの作成の `agentInstructionFileCreation.ts:82` → `useAgentInstructionFiles.ts:223-227` は null を「作成しましたが開けませんでした」にし、走査の後のやり直しの `useFileSystem.ts:417` は `applied` が偽だとエラーを消さない）ため、これを壊さない
  - (a)（採る）: 手動の読み直しの実行中の数を ref（`manualReloadsInFlightRef`）で持つ。数は `reloadTree` の先頭（`beginTreeWrite` より前）で増やし、本体全体を `try`/`finally` で包んで必ず減らす（走査中の抑止・フォルダが無いなどの早期の return でも減る）。静かな読み直し（`refreshTreeQuietly`）は、手動の実行中なら `beginTreeWrite` を呼ばずに「手動の後に 1 回」の印（`quietAfterManualRef`）だけ立てて、すぐ終わる。手動の読み直しは、終わったとき（成功・失敗・古い結果のどれでも、`finally`）に実行中の数を減らし、0 になって印が立っていれば、印を下ろして静かな読み直しを 1 回走らせる（待たない。手動の戻り値を遅らせない）。フォルダの切り替え・アンマウントの後に「手動の後に 1 回」が走っても、走査中の抑止（`beginTreeWrite`）と世代・読む時点のフォルダの判定で捨てられるか、今のフォルダを読むだけなので、特別には扱わない
  - (b)（採らない）: 追い越した静かな読み直しのツリーを手動の呼び出し元に返す。手動と静かで失敗の扱いが違い（静かは失敗を出さない）、追い越した側の失敗を手動の失敗としてどう出すかの分岐が増えるため
  - 静かな読み直しの途中で手動の読み直しが始まったときは、今どおり手動が世代を進めて勝つ（静かな結果は捨てられ、静かな読み直しは何も出さない）
- 成功: 新しいツリーと**最新の**ツリーを比べる。`await` の前のクロージャの `fileTree` とは比べない（読んでいる間に手動の読み直しやファイル操作が置き換えていることがある。L-040）。`setFileTree((prev) => (isSameFileTree(prev, tree) ? prev : tree))` の形にし、同じなら参照を保つ（ツリーと指示ファイルの節を描き直さない）。違えば置き換える。どちらでも `reportTreeLoad(null)` は今どおり呼ぶ（読めたので、ツリーの読み込みの失敗の表示は古い）
- 失敗: `quiet` なら `reportTreeLoad` を呼ばず、投げずに null を返す（前のツリーとエラーの表示を残す）。`quiet` でなければ今どおり
- `useFileSystem` は `refreshTreeQuietly: () => Promise<void>` と、走査中かを返す `isFolderScanPending: () => boolean`（`pendingFolderOpenRef.current > 0`）を返り値に足す
- 走査中に抑止したやり直し（`retryRefreshSkippedDuringScan`）は今のまま手動の取り直しで行う（静かな依頼が抑止された場合も、走査の直後の読み直しの失敗は表示する）

`isSameFileTree(a, b)`（`src/renderer/src/lib/fileTreeEquality.ts`。新規・純粋）: 長さ・各ノードの `name`・`path`・`type`・`children` を、並びの順のまま再帰で比べる（main が `sortFileTree` で並べるので順は安定している）。比べ方は、エージェントの変更の写しの比べ（`isSameAgentChangesView`）と同じ構造の比べ（`src/renderer/src/lib/plainDataEquality.ts` の `isSamePlainData`。IPC の素のデータを全部の欄で比べ、値が undefined の欄は無いのと同じ）に委ねる（SRP 第 5 周で、写しの比べから共通の部品へ出した）。

画面が揺れないこと:

- 開閉: `key={child.path}` なので、残ったフォルダの `DirectoryItem` の state は残る。新しいフォルダは `useState(true)` で開いて出る（決めたこと 4）
- 選択の強調: `openFilePath` とノードのパスで決まるので、置き換えでも変わらない
- スクロール: ツリーの入れ物はアンマウントされないので、位置は残る。見えている位置より上に項目が増減すると、見えている内容がずれる（5 章）
- フォーカス: 残った項目の DOM は同じ要素のままなのでフォーカスは残る。フォーカスのある項目が消えると、フォーカスは body に落ちる（5 章）
- 指示ファイルの節は `fileTree` から作るので、外で足した・消した指示ファイルが自動で反映される。行が増えて節が伸びても、今の `flex: 0 1 auto; min-height: 0; overflow-y: auto` で縮んで中でスクロールし、ツリーの下限（`min-height`）は残る（L-693。CSS は変えない。7 章の EXP-123 で確かめる）

### git status の静かな取り直し（`useGitStatus.ts`）

返り値に `refreshGitStatusQuietly: () => Promise<boolean>` と `wasGitStatusSetQuietly: () => boolean` を足す。`refreshGitStatusQuietly` の戻り値は、取得の結果を受け入れた（完了の時点で最新で、走査中でなく、成功した。内容が同じで置き換えなかった場合も含む）なら true、捨てた（追い越された・完了の時点で走査中・失敗・フォルダが null）なら false。投げない

- 取得の番号は今の `latestRequestId` を共有する（後から始まった取得が勝つ）
- 静かな取得は `gitLoading` を立てず、`gitError` を消さない
- 描画をまたいで保つ控え（`GitStatusTracking`。`latestRequestId`・`latestStatus`・`statusSetQuietly`・`loudPending` を 1 つの ref にまとめる）を持つ。最新の status の控え（`latestStatus`）は、`setGitStatus` を呼ぶたび（通常・静か・フォルダの切り替えでの null のすべて）に同じ値で更新する。静かな取得の結果は、`await` の前のクロージャの `gitStatus` ではなく、完了の時点のこの控えと比べる（L-040）
- `useGitStatus(folderPath, { isFolderScanPending })` の形にして、`useFileSystem` の `isFolderScanPending` を受け取る（`useAppState.ts` は `fileSystem` を `git` より先に作るので渡せる）
- 通常の取得の途中かを控えの `loudPending` で持つ。通常の取得の開始で立て、通常の取得が最新のまま終わったら下ろす
- 静かな取得の開始で `loudPending` が立っていたら、静かな取得がその役目を引き継ぐ（`inheritsLoud`。今の `useAgentChanges.refresh` の静かな取り直しが手動を追い越したときと同じ考え方）
- 完了（最新のときだけ）:
  - 完了の時点で `isFolderScanPending()` が真なら、結果も失敗も反映しない（始めのときに走査中でなくても、取得の間にフォルダの走査が始まっていれば、main の許可は新しいフォルダで、画面は前のフォルダのままのため。L-037）。`inheritsLoud` なら `setGitLoading(false)` と `loudPending` を下ろすことだけを行う（下の成功・失敗の後の扱いと同じ）。走査の後にフォルダが変われば、今の effect が取り直す
  - 成功: 結果が `latestStatus` の値と同じ（`isSameGitStatus`。下）なら `setGitStatus` を呼ばない（参照を保つ。エージェントの変更の一覧・diff の連鎖を起こさない）。違えば `statusSetQuietly = true` にしてから `setGitStatus(result)`。どちらでも `setGitError(null)`（取れたので、前の失敗の表示は古い）。ただし `inheritsLoud` なら、同じでも `statusSetQuietly = false` にして `setGitStatus(result)` を呼ぶ（通常の取得として置く）。通常の取得には、終わると新しい参照の `gitStatus` を置いてエージェントの変更の一覧を取り直させる（引数無し）役目があり、追い越された通常の結果は番号が古いので捨てられる。同じだからと置かないと、一覧の取り直しの合図が失われる（例: 記録中に既に `M` のファイルを保存し、保存の後の通常の取得が遅い間に、監視の通知の静かな取得が追い越すと、一覧に保存の変更が出ない）
  - 失敗: `inheritsLoud` なら今の通常の取得と同じく `setGitError`。そうでなければ何もしない（前の status と表示を残す）
  - `inheritsLoud` なら `setGitLoading(false)` にして `loudPending` を下ろす
  - 走査中か・置き換えるか（同じ status か・通常の取得を引き継いだか）・静かに置くか・出す失敗の判定は、純関数 `decideQuietGitStatus`（`src/renderer/src/lib/quietGitStatusDecision.ts`。React・IPC に依らない）が決め、hook は取得・判定の呼び出し・反映・`gitLoading` の引き継ぎだけを行う
- 通常の取得の `setGitStatus` の直前は `statusSetQuietly = false` にする。`wasGitStatusSetQuietly()` はこの値を返す
- フォルダが null なら何もしない（フォルダの切り替えは今の effect が扱う）
- 静かな取得が通常の取得に追い越された（番号が古い）ときは、結果も失敗も反映しない（今と同じ）

`isSameGitStatus(a, b)`（`src/renderer/src/lib/gitStatusEquality.ts`。新規・純粋）: `GitStatusResult` の全部のフィールドを比べる。`files` は並びの順のまま、各要素の `path`・`index`・`workingDir`・`from`（無いときは無いこと）を比べる。どちらかが null なら、両方 null のときだけ同じ。比べ方は `isSameFileTree` と同じく `isSamePlainData` に委ねる。

### エージェントの変更の一覧の連鎖（`useAgentChangesWiring.ts`）

`gitStatus` の変化で一覧を取り直す effect（151-153 行）で、`wasGitStatusSetQuietly()`（`useLatestRef` で最新を読む）が真なら `refreshAgentChanges({ quiet: true })`、偽なら今どおり `refreshAgentChanges()`（引数無し）を呼ぶ。静かな取り直しの完了は `quietRefreshCount` を進めるので、アクティブな agent の diff タブも今の仕組みで静かに取り直す。

### diff タブ

静かな git status の取り直しが結果を受け入れた後（同じかどうかに依らず）、`refreshDiff({ quiet: true })` を 1 回呼ぶ。アクティブな diff タブが無ければ今の effect が何もしない。

git status の文字が変わったときも、diff は**静かに取る（前の内容を出したまま取り直す）ことを認める**（案 (a) に決めた）。今の `requestRefresh`（`useDiffOperations.ts:151-154`）は `refreshModeRef` が `none` のときだけ `quiet` を入れ、取得の effect（212-217 行）は文字の変化で走ったときも `refreshModeRef` を読む。静かな取り直しの `setGitStatus` と `refreshDiffQuietly()` は同じ描画にまとまる見込みが高いので、文字が変わっても 1 回の静かな取得になる。新しい diff が届くまでは前のハンクが残り、その間にハンクの操作を押すと git の適用が失敗して今の失敗の文言が出る（古いパッチは適用されない。5 章）。文字が変わったときだけ内容を消す分岐は足さない

ハンクの key は旧の側の開始行にして、静かな取り直しで行番号がずれてもハンクのボタンのフォーカスを保つ（この PR で対応）。

### 自動の取り直し（`src/renderer/src/hooks/useFolderAutoRefresh.ts`。新規）

```ts
export const FOLDER_AUTO_REFRESH_WAIT_MS = 50
export const FOLDER_AUTO_REFRESH_MAX_WAIT_MS = 300

export interface FolderAutoRefreshOptions {
  folderPath: string | null
  refreshTreeQuietly: () => Promise<void>
  refreshGitStatusQuietly: () => Promise<boolean>
  refreshDiffQuietly: () => void
  isFolderScanPending: () => boolean
}

export function useFolderAutoRefresh(options: FolderAutoRefreshOptions): void
```

- 依頼の形は `{ tree: boolean }`。`merge` は `tree` の論理和
- `run({ tree })`:
  - `tree` なら `refreshTreeQuietly()`
  - `isFolderScanPending()` が偽なら `refreshGitStatusQuietly()` を呼び、それが true を返したときだけ `refreshDiffQuietly()` を呼ぶ（status の取得の間に走査が始まって結果を捨てたときは、diff も取らない。2 章の「走査中は git status と diff の静かな取り直しをしない」と同じ）
  - 2 つは並べて走らせ、`Promise.allSettled` で待つ（どちらも静かで、失敗は中で捨てる）
- `accepts`: `folderPath !== null`（`useLatestRef` で最新を読む）
- 監視の有効化: `useEffect(() => { void setFolderWatch(true).catch(() => undefined); return () => { void setFolderWatch(false).catch(() => undefined) } }, [])`。「初回だけ」の ref は使わない（L-469）
- 購読: `onFolderChange(({ treeChanged }) => scheduler.schedule({ tree: treeChanged }))`、`window` の `focus` と `document` の `visibilitychange`（visible のときだけ）で `schedule({ tree: true })`。cleanup で 3 つとも外し、`reset()` する（L-108）
- `useOnChange(folderPath, () => scheduler.reset())`（前のフォルダの予約を新しいフォルダで走らせない。フォルダを開いた直後はツリーの走査と git status の取得が今の経路で走る）
- スケジューラは `useRef` で 1 つだけ作る。`run`・`accepts` は ref から最新の依存を読む
- 読み上げはしない（`aria-live` を足さない。L-249）

組み立て（`useAppState.ts`）: `fileSystem`・`git`・`diffOperations` を作った後に呼ぶ。`refreshDiffQuietly` は `() => diffOperations.refreshDiff({ quiet: true })`。

既存のフォーカスの購読との重なり: `useExternalFileChanges`（開いているタブの中身）と `useAgentChangesAutoRefresh`（記録中のエージェントの変更の一覧）は今のまま残す。フォーカスの復帰では 3 つの取り直しが並ぶ。git status が変わったときは連鎖でエージェントの変更の一覧がもう 1 回静かに取られるが、どれも静かで、同じ内容なら置き換えないので画面は揺れない。購読を 1 つにまとめる変更はしない（それぞれ対象と条件が違う）。

### エラーの扱い（まとめ）

| 場所                         | 静かな取り直しの失敗                                         | 手動の操作の失敗 |
| ---------------------------- | ------------------------------------------------------------ | ---------------- |
| main の監視が張れない・error | 黙って監視無しにする（フォーカスの復帰に任せる）             | なし             |
| main の送信の失敗            | 握りつぶす                                                   | なし             |
| ツリーの読み直し             | 前のツリーと表示を残す                                       | 今のまま         |
| git status                   | 前の status と表示を残す（通常の取得を引き継いだときは出す） | 今のまま         |
| diff                         | 今の `refreshDiff({ quiet })` の扱いのまま                   | 今のまま         |

## 4. テスト方針

- 分類（`src/main/__tests__/folderChangeClassifier.test.ts`。純粋。`it.each` の表）: null・空・根の直下・6 段・7 段・`node_modules/x`・`a/dist/x`・`dist`（最後の要素）・`sub/.git/index`・`.git`（`tree`）・`.git/index`・`.git/HEAD`・`.git/MERGE_HEAD`・`.git/packed-refs`・`.git/refs/heads/main`・`.git/refs/prompt-ide/agent-changes/x`・`.git/index.lock`・`.git/refs/heads/br.lock`・`.git/objects/ab/cd`・`.git/logs/HEAD`・`.git/COMMIT_EDITMSG`・`.GIT/index`（区別する）。`win32` で `a\b` を 2 段に、`darwin` で `a\b` を 1 段に数える
- 監視（`folderChangeWatcher.test.ts`。モックの `watch` と fake timer。今の `openFileWatcher.test.ts` と同じ型）:
  - `enable` で今のフォルダを張る。フォルダが無ければ張らず、`onFolderChanged` で張る。同じフォルダで `enable` を 2 回呼んでも張り直さない
  - `onFolderChanged` で前を閉じて新しいフォルダを張る。無効な所有者では張らない。A → B → A で 3 回張られ、最後の監視が A
  - `disable` で閉じ、予約を取り消す（送らない）
  - 待ち 300ms で送る、通知が続いても上限 1000ms で送る（L-399）、`git` だけなら `false`、`ignore` だけなら送らない（`tree` と `git` の混ざりは合流の規則なので、下の `folderChangeCoalescer.test.ts` で確かめる）
  - 閉じた監視の listener が呼ばれても送らない。`error` で閉じ、その後の通知を送らない。`error` の後に同じフォルダのまま `enable` を呼ぶと張り直す（`watch` が 2 回目も呼ばれる）。`watch` が投げても `enable` が投げない。`watch` が null なら何も張らない
  - `notify` が投げてもタイマーのコールバックが投げない
- 通知の合流（`folderChangeCoalescer.test.ts`。fake timer）: 待ちで 1 回にまとめる・上限で送る（L-399）・`tree` が混ざると `treeChanged: true`・`ignore` だけなら送らない・送った後と `cancel` の後は未送信が残らない・`send` が投げてもタイマーのコールバックが投げない。監視のテストは、張り方・閉じた監視の通知・張り直しで未送信を捨てることなど、監視の寿命から見た送り方を確かめる
- 監視の実物（`folderChangeWatcher.integration.test.ts`。実物の `fs.watch`、`mkdtemp` を realpath、短い待ち、`waitForNotification` で 3 秒までポーリング、後始末は `removeTempPathSync`。`process.platform === 'linux'` では `describe.skip`）。途中のフォルダの作成も通知されて判定が乱れるので、フォルダ（7 段目までの入れ物・`node_modules/x`・`.git`）は監視を張る前に作っておく（または作った後に上限の 1000ms より長く待って通知を流しきる）。そのうえで対象のファイルだけを書いて確かめる: 根の直下のファイルの作成で `treeChanged: true`、7 段目のファイルで `false`、`node_modules/x/y.js` だけでは送らない、`.git/index` を書くと `false`、`.git/index.lock` だけでは送らない
- 寿命（`folderChangeWatcherLifecycle.test.ts`。今の `openFileWatcherLifecycle.test.ts` と同じ型）: `folder-changed` で `onFolderChanged`、`destroyed`・`crashed`・`reloaded` で `disable`
- 受け口（`handlers/folderChangeHandlers.test.ts`）: `true`/`false` で `enable`/`disable` を送信元の id で呼ぶ、boolean でなければ例外、`sendFolderChange` が破棄済みの送り先で投げない
- 組み立て（`ipcHandlers.test.ts` に足す）: `watch` を `{ recursive: true, persistent: false }` で呼ぶ。Linux（`process.platform` を差し替える）では `watch` を呼ばない
- git status（`gitService.status.integration.test.ts` に足す。実物の git）: 更新時刻を未来にしたファイルがあっても、`getGitStatus` の後に `.git/index` の mtime と中身が変わらない。`GIT_ASKPASS` が環境にあっても投げない（`process.env` を一時的に足して戻す）
- git diff（`gitService.diff.integration.test.ts` に足す。実物の git）: 同じ内容のまま更新時刻だけ変えたファイルの未ステージの `getDiff` が空で、`.git/index` の mtime と中身が変わらない。内容が変わったファイルの diff は今どおり出る。`gitService.test.ts` で `diff.autoRefreshIndex=false` を含む `config` で作ることも確かめる。サブモジュールの中のファイルを dirty にして stat も古くしても、`getDiff(repo, 'sub', false, false)` が `-dirty` を出し、`.git/modules/sub/index` の mtime と中身が変わらない（子の status のロックを `GIT_OPTIONAL_LOCKS=0` で止める。`gitService.test.ts` で env に `GIT_OPTIONAL_LOCKS: '0'` が入ることも確かめる）
- preload（`api.test.ts` に足す）: `setFolderWatch` のチャンネルと引数、`onFolderChange` が形の合わない payload（`treeChanged` が無い・文字列）を捨てる、解除で外れる
- 合流（`lib/__tests__/refreshScheduler.test.ts`。fake timer）: 待ち・上限・実行中の印で 1 回だけやり直す・たまった依頼を `merge` する・`accepts` が偽なら捨てる・`reset` の後に古い完了がやり直しを起こさない・`run` の reject で止まらない。`useAgentChangesAutoRefresh` の今のテストがそのまま通ること
- diff（`useDiffOperations.test.ts` に足す）: 静かな status の取り直しで対象のファイルの文字が変わり、同じ描画で `refreshDiff({ quiet: true })` が呼ばれると、取得は 1 回で、届くまで前の内容（`diffContent`）が残り、`読み込み中...` の状態にならない
- 同じかの比べ（`fileTreeEquality.test.ts`・`gitStatusEquality.test.ts`。純粋）: 同じ・名前違い・子の違い・順の違い・`from` の有無
- ツリー（`useFileTreeOperations.test.ts` に足す）: 静かな読み直しで同じツリーなら `setFileTree` を呼ばない（参照が同じ）、違えば置き換える、失敗で `reportTreeLoad` を呼ばず投げない（前のツリーが残る）、走査中は抑止されて走査の後にやり直す。比べる相手は完了の時点の最新のツリー（読んでいる間に手動の読み直しで置き換わったツリーと同じなら、参照を保つ）。**手動の読み直しの途中で静かな読み直しが走っても、手動の戻り値がツリーになり（null にならない）、静かな読み直しは手動の後に 1 回だけ走る**。同じことを指示ファイルの作成で確かめる（`useAgentInstructionFiles.quietReload.test.ts`。新規: 作成の後の読み直しの途中に静かな読み直しを呼んでも、作成したファイルが開き、`作成しましたが開けませんでした` が出ない）。走査の後のやり直しの途中に静かな読み直しを呼んでも、`applied` が真でエラーが消える（`useFileSystem.test.ts` に足す）
- git status（`useGitStatus.test.ts` に足す）: 静かな取得の間 `gitLoading` が偽のまま、`gitError` を消さない、同じ結果なら参照が同じ、違えば置き換えて `wasGitStatusSetQuietly()` が真、失敗で前の status とエラーが残る、通常の取得の途中で静かな取得が追い越すと完了で `gitLoading` が下りて失敗が出る、追い越した静かな取得の結果が控えと同じでも新しい参照で置き、`wasGitStatusSetQuietly()` が偽（判定は `quietGitStatusDecision.test.ts` でも、`inheritsLoud` なら同じでも置き換えて通常の取得として置くことを確かめる）、静かな取得が通常の取得に追い越されたら反映しない、比べる相手は完了の時点の控え（取得の間に通常の取得で置き換わった status と同じなら参照を保つ）、取得の間にフォルダの走査が始まったら（完了の時点で `isFolderScanPending()` が真）結果も失敗も反映しない
- 連鎖（`useAgentChangesWiring.test.ts` に足す）: 静かに変わった status で `refreshAgentChanges({ quiet: true })`、通常の status で引数無し
- hook（`useFolderAutoRefresh.test.ts`。`vi.mocked(fileSystemApi.onFolderChange)` の listener を取り出して呼ぶ、`window.dispatchEvent(new Event('focus'))`、fake timer）: マウントで `setFolderWatch(true)`、アンマウントで `false`。`treeChanged: true` でツリー・git・diff、`false` で git・diff だけ。フォーカスと visible でツリー・git・diff、hidden では走らない。50ms の間の契機を 1 回にまとめる。実行中の契機はもう 1 回にまとめる。走査中は git と diff を呼ばない。status の取得の間に走査が始まった（`refreshGitStatusQuietly` が false を返した）ときは diff を呼ばない。フォルダが null なら何もしない。フォルダの切り替えで予約を捨てる。アンマウントの後にタイマーが走らない。StrictMode で購読が残る（L-469）
- 配線（`App` の統合のテスト）: 通知を流すと、ツリーに新しいファイルが出て、開いていたフォルダの開閉が残り、新しいフォルダは開いて出る。ソース管理の `更新` が取り直しの間も `disabled` にならない
- `DiffView`（`DiffView.test.tsx` に足す）: 1 行目の前に 1 行足した diff（2 つ目のハンクは新しい側の行番号だけずれる）や、未追跡の `@@ -0,0 +1,N @@` の N が変わる diff に rerender しても、ハンクのボタンのフォーカスが外れない
- 全体の検証: `NODE_ENV=test npm test`・`npm run typecheck`・変更したファイルへの `npx eslint`・`npx vitest run scripts`

## 5. 既知の制約

- Linux では監視を張らない。ツリーと git status は、ウィンドウのフォーカスの復帰（再表示）で取り直すまで反映しない
- 監視が `error` を受けた・`watch` が同期で投げたときは監視が無くなる。張り直すのは `folder-changed` と `enable` だけで、renderer はマウント時にしか `enable` を送らず、同じフォルダを開き直しても `FolderAccessManager.set` は通知しない。このため、別のフォルダに切り替えるか画面を読み込み直すまで監視は戻らず、その間はフォーカスの復帰でだけ反映する
- Windows の recursive の挙動は確かめていない（区切りの扱いだけを分類で持つ）。大量の変更で OS の通知の buffer があふれると取りこぼしうる（フォーカスの復帰で取り直す）
- `SKIP_DIRS`（`node_modules`・`out`・`dist`・`.next`）の中の変化は、git status の取り直しも走らせない。これらを git で追跡しているリポジトリでは、その中の変更がソース管理に出るのはフォーカスの復帰・`更新` まで。`.git` の中は index・HEAD・MERGE_HEAD・packed-refs・refs の確定した書き込みでだけ git status を取り直す（`.lock`・`objects`・`logs`・`refs/prompt-ide` は無視する）
- `.gitignore` に従った除外はしない。ツリーに出る範囲（6 段まで）の無視されたファイル（ログ・キャッシュなど）を頻繁に書くツールがあると、書くたびに（最短 300ms、続けば 1 秒ごとに）ツリーの全部の読み直しと git status が走る
- 監視するフォルダが大きいと、通知のたびにツリーの全部（6 段まで）を読み直す。部分的な読み直しはしない
- git の作業ディレクトリが開いているフォルダの外（worktree・`GIT_DIR` の外出し・サブフォルダを開いた場合のリポジトリの根）にあると、外での `git add`・`git commit` などは監視で拾わない（作業ツリーのファイルの変化では取り直す）。`.git/config` の変化（外での `git remote add`）も拾わない
- 外のシンボリックリンクのリンク先の変化は拾わない（ツリーもリンクの中へ降りないので、ツリーの表示とは食い違わない）
- 開いているフォルダそのものを外で消しても、監視は error を出さない。ツリーの静かな読み直しは失敗して前のツリーを残す（操作したときに今の失敗の表示が出る）
- git status の取得は `GIT_OPTIONAL_LOCKS=0` で行うため、アプリの `git status` は index の stat の情報を書き直さない。stat の古いファイルが多い大きなリポジトリでは、利用者やエージェントが git を実行するまで、毎回の status が内容の読み直しの分だけ遅くなりうる
- 自分の操作（保存・作成・git の操作）の後は、今の取り直しの後に静かな取り直しがもう 1 回走る（画面は変わらない）
- 見えている位置より上で項目が増減すると、ツリーの見えている内容がずれる。フォーカスのある項目が外で消されると、フォーカスは body に落ちる
- 外の変更で diff タブを取り直すときは、git status の文字が変わった場合も含めて、前の内容を出したまま取り直す（`読み込み中...` は出ない）。新しい diff が届くまでは古いハンクが残り、その間にハンクの操作を押すと git の適用が失敗して失敗の文言が出る
- フォルダの走査中に起きた git の変化は、走査の後にフォルダが変わったときの取得か、次の契機まで反映しない（同じフォルダを開き直した場合）
- 走査中の結果を捨てるのは静かな取得だけ。今の通常の取得（`更新`・操作の後）は、走査中に完了すると前のフォルダの画面に新しいフォルダの status を出しうる隙間が今もある（今の挙動のまま残す。走査が終わってフォルダが変わると、今の effect が取り直して直る）
- 全体の指示ファイル（`~/.claude/CLAUDE.md` など）は監視しない。外で足した・消した全体の指示ファイルは、今どおり節の `更新` などのきっかけまで反映しない
- 開いているタブの監視（`OpenFileWatcher`）の既知の制約（最大の待ちが無い・A → B → A で送り直されない・symlink のリンク先）は変えない
- コミット履歴・ブランチの一覧・タグは自動で取り直さない（今どおり、それぞれの操作・`更新` で取り直す）
- 外で `git stash` を実行すると、`refs/stash` の変化で git status は取り直すが、ソース管理の stash の一覧は取り直さない（stash の一覧を取り直す操作か `更新` まで）
- `.git/info/exclude` の変化は拾わない（除外の設定を変えても、git status は次の契機まで変わらない）。`.gitignore` の変化は作業ツリーのファイルの変化として拾う
- 開いていたダイアログ(例: リポジトリの初期化)が、外部の変化による静かな git status の取り直しで消えることがある(`git init` を外で実行すると `isRepo: true` が置かれ、パネルがリポジトリの表示に変わってダイアログも消える)

## 6. 気をつける知見の ID

- L-001 成否を伝える（手動の `reloadTree` は反映したかどうかを null で返し、呼び出し元は null を成功扱いにしない。静かな git status の取り直し `refreshGitStatusQuietly` は受け入れたかを真偽で返し、静かな失敗では diff の取り直しを走らせない。静かなツリーの読み直し `refreshTreeQuietly` は後続の処理を持たないので値を返さない）
- L-002 「失敗」を「空」にしない（読み直し・status の失敗で空のツリー・空の一覧を出さず、前の内容を残す）
- L-008 外部の操作の後のメモリ上の写し（ツリー・status・diff の写しを、外の変更の後に取り直す。この機能の目的）
- L-009 大文字小文字（分類の名前の比べ方は、ツリーの `shouldSkipDir` と同じく区別する。`.git` は git が小文字で作る）
- L-016 シンボリックリンク（監視もツリーもリンクの中へ降りない。リンク先の変化は拾わないことを制約に書く）
- L-037 古い結果を識別子だけで結び付けない（閉じた監視の通知を今の監視の参照で捨てる。走査中に静かな status を前のフォルダの画面に出さない）
- L-040 複数の発生源の古い結果（ツリーは `treeWriteSeqRef` を手動と静かで共有するが、手動の途中の静かな読み直しは世代を進めずに手動の後へ回す〈手動を追い越さない。3 章の (a)〉。手動が静かな読み直しの途中に始まったときは手動が勝つ。status は `latestRequestId` を共有し、後から始まった方が勝つ。静かな取得が手動を追い越したら役目を引き継ぐ）
- L-108 タイマーの後片付け（main は `disable`・`open` でタイマーを取り消す。renderer は `reset` をアンマウントとフォルダの切り替えで呼ぶ。テストのタイマーは `createTestTimers` で後片付けする）
- L-249 表示・読み上げの場所（自動の取り直しは読み上げない。`aria-live` を足さない）
- L-399 上限の無いデバウンス（main は待ち 300ms・上限 1000ms、renderer は 50ms・300ms）
- L-466 全部の更新の購読で過剰に読み直さない（`.git` の中は一覧のパスだけ、`.lock`・`objects`・`logs`・保護の ref を捨てる。`SKIP_DIRS` の中を捨てる）
- L-469 StrictMode の二重実行（有効化・購読は毎回登録して毎回外す。main の `enable` は同期で、到着の順に処理する）
- L-571 A → B → A（監視を張るフォルダは main が `folder-changed` のたびに決め直し、renderer の送り直しに頼らない）
- L-693 縦の flex の節（自動の反映で指示ファイルの節が伸びても、ツリーが潰れないことを EXP-123 で確かめる。CSS は変えない）
- L-618 テストの再帰削除（実物の監視のテストの一時フォルダは `removeTempPathSync` で消す）
- L-203 文言と文書の同期（`useAgentChangesAutoRefresh.ts:14` のコメント、ROADMAP の既知の制約、前提の変わる手動テストを同じ PR で直す）
- L-199 自動の置換の空振り・整形ツールの範囲（仕様書・ROADMAP の書き換えは、一致しなければ失敗する置換で行う。整形は変えたファイルだけに行う）

## 7. 実機テスト仕様書の項目の案

### 新しい項目

`docs/manual-test-spec.md` の「エクスプローラー」の最後（EXP-116 の後）に `### ファイルツリーの自動の反映` を足して EXP-117 から振る。「ソース管理（基本）」の最後（GIT-182 の後）に `### 外部の変更の自動の反映` を足して GIT-183 から振る。

```markdown
### ファイルツリーの自動の反映

> 前提: macOS で確かめる(Linux では監視しないので、ウィンドウのフォーカスの復帰でだけ反映する)。設定の `使うエージェント CLI` を `Claude Code` にしておく(EXP-122・EXP-123 のサブフォルダの `CLAUDE.md` は Claude Code のときだけ一覧に出る。GitHub Copilot CLI のときは `AGENTS.md`)。端末で `DIR="$(mktemp -d)" && mkdir -p "${DIR:?}/src/sub" && echo x > "${DIR:?}/src/sub/a.txt" && echo "$DIR"` を実行し、アプリの `フォルダを変更` で `$DIR` を開く。端末はアプリの横に並べ、アプリのウィンドウにフォーカスを戻さずに見る。「2 秒以内」は、端末で Enter を押してからの時間。

- [ ] **EXP-117** 端末で `echo x > "${DIR:?}/auto.txt"` を実行する → アプリに触らずに、2 秒以内にファイルツリーに `auto.txt` が出る。`src` などのフォルダの開閉と、ツリーのスクロールの位置は変わらない
- [ ] **EXP-118** 端末で `mkdir -p "${DIR:?}/auto-dir/inner" && echo x > "${DIR:?}/auto-dir/inner/b.txt"` を実行する → 2 秒以内に `auto-dir` が開いた状態で出て、その下に `inner` と `b.txt` が見える
- [ ] **EXP-119** ツリーの `src` を押して閉じてから、端末で `echo x > "${DIR:?}/src/new.txt"` を実行する → 2 秒待っても `src` は閉じたまま。`src` を押して開くと `new.txt` がある
- [ ] **EXP-120** 端末で `rm "${DIR:?}/auto.txt"` を実行する(タブでは開いていない状態) → 2 秒以内にツリーから `auto.txt` が消える。ほかのフォルダの開閉は変わらない
- [ ] **EXP-121** 端末で `mkdir -p "${DIR:?}/a/b/c/d/e/f" && echo x > "${DIR:?}/a/b/c/d/e/f/deep.txt" && mkdir -p "${DIR:?}/node_modules/pkg" && echo x > "${DIR:?}/node_modules/pkg/i.js"` を実行し、2 秒待ってからツリーを見る → `a` から `f` までが開いた状態で出て、`f` の中は空(`deep.txt` は出ない)。`node_modules` はツリーに出ない
- [ ] **EXP-122** サブフォルダの指示ファイルの一覧を開いてから、端末で `echo x > "${DIR:?}/src/sub/CLAUDE.md"` を実行する → 節の `更新` を押さずに、2 秒以内にボタンが `サブフォルダ(N 件)` の 1 件多い数に変わり、一覧に `src/sub/CLAUDE.md` が出る
- [ ] **EXP-123** ウィンドウを低くし(EXP-098 と同じくらい)、サブフォルダの一覧を開いたまま、端末で `for i in $(seq 1 10); do mkdir -p "${DIR:?}/grow/g$i" && echo x > "${DIR:?}/grow/g$i/CLAUDE.md"; done` を実行する → 2 秒以内に一覧の件数が 10 増え、節は中でスクロールでき、ファイルツリーは数行分の高さが残って見える。確かめたらウィンドウの高さを戻す
- [ ] **EXP-124** `新規ファイル` の名前の入力欄を開いて `draft` と入力したまま(確定しない)、端末で `echo x > "${DIR:?}/while-dialog.txt"` を実行する → ツリーに `while-dialog.txt` が出ても、入力欄は開いたままで `draft` が残り、フォーカスも入力欄に残る。Esc で閉じる
- [ ] **EXP-125** 端末で `D5="$(mktemp -d)" && echo "$D5"` を実行し、`フォルダを変更` で `$D5` を開いてから、もう一度 `フォルダを変更` で `$DIR` を開き直す。続けて端末で `echo x > "${DIR:?}/after-switch.txt"` を実行する → 2 秒以内にツリーに `after-switch.txt` が出る
- [ ] **EXP-126** メニューの `View` > `Reload` で画面を読み込み直し、`フォルダを開く` で同じ `$DIR` を開いてから、端末で `echo x > "${DIR:?}/after-reload.txt"` を実行する → 2 秒以内にツリーに `after-reload.txt` が出る
- [ ] **EXP-127** 端末で `mkdir -p "${DIR:?}/burst" && for i in $(seq 1 300); do echo $i > "${DIR:?}/burst/f$i.txt"; done` を実行し、続けてツリーをスクロールする → 書き込みの間もスクロールやクリックが引っかからず、書き込みが終わってから 2 秒以内に `burst` の中に `f300.txt` までが出る
- [ ] **EXP-128** アプリを別のアプリの裏に隠し(`Cmd+Tab` で端末を前に出す)、端末で `echo x > "${DIR:?}/while-hidden.txt"` を実行してからアプリに戻る → 戻った時点でツリーに `while-hidden.txt` が出ている(監視とフォーカスの復帰のどちらかで反映する)。画面がちらつかない
```

```markdown
### 外部の変更の自動の反映

> 前提: macOS で、「ソース管理（基本）」の前提のテスト用リポジトリ(`$R`)を、変更の無いきれいな状態で開き、ソース管理パネルを表示する。コマンドはアプリの外の端末で `cd "$R"` してから実行し、アプリのウィンドウにフォーカスを戻さずに見る。「2 秒以内」は、端末で Enter を押してからの時間。

- [ ] **GIT-183** 【要 Git リポジトリ】コミットのメッセージの入力欄に `draft` と入力してから、端末で `echo more >> a.txt` を実行する → 2 秒以内に「変更」の一覧に `a.txt`(`M`)が出る。その間に `読み込み中...` は出ず、ソース管理の `更新` は淡色にならず、入力欄の `draft` は残る
- [ ] **GIT-184** 【要 Git リポジトリ】GIT-183 の後、端末で `git add a.txt` を実行する → 2 秒以内に `a.txt` が「ステージ済み」の一覧へ移る
- [ ] **GIT-185** 【要 Git リポジトリ】GIT-184 の後、端末で `git commit -qm auto` を実行する → 2 秒以内に「ステージ済み」の一覧から `a.txt` が消え、変更の一覧が空になる
- [ ] **GIT-186** 【要 Git リポジトリ】端末で `git checkout -q -b auto-branch` を実行する → 2 秒以内にステータスバーのブランチが `auto-branch` に変わる。確かめたら端末で `git checkout -q main` を実行し、2 秒以内に `main` に戻ることも見る
- [ ] **GIT-187** 【要 Git リポジトリ】端末で `echo one >> b.txt` を実行し、「変更」の `b.txt` を押して diff タブを開いてから、端末で `echo two >> b.txt` を実行する → タブは閉じずに残り、`読み込み中...` に変わらずに、2 秒以内に diff に `two` の行が足される
- [ ] **GIT-188** 【要 Git リポジトリ】端末で `mv .git .git-off` を実行する → 2 秒以内にソース管理パネルが Git リポジトリでないときの表示に変わり、ツリーに `.git-off` が出る。続けて端末で `mv .git-off .git` を実行すると、2 秒以内に元のリポジトリの表示(変更の一覧)に戻る
- [ ] **GIT-189** 【要 Git リポジトリ】端末で `touch -t 209901010000 a.txt && git status --porcelain` を実行してから 10 秒ほど待ち、続けて 1 回のコマンドで `for i in 1 2 3; do stat -f %m .git/index; sleep 2; done` を実行する(手で 3 回打つと、git の表示を入れたシェルのプロンプトが git status を実行して index を書き直しうるため) → 3 行とも同じ値(アプリの自動の取り直しが index を書き換え続けない)。確かめたら `touch a.txt` で時刻を戻す
- [ ] **GIT-190** 【要 Git リポジトリ】端末で `echo z > untracked.txt` を実行する → 2 秒以内に、ファイルツリーに `untracked.txt` が出て、ソース管理の「変更」の一覧にも `untracked.txt`(`U`)が出る。確かめたら `rm untracked.txt` を実行し、2 秒以内に両方から消えることも見る
```

### 前提が変わる既存の項目（ID は変えない。手順と期待結果だけを直す）

```markdown
- [ ] **EXP-072** フォルダを開いた後、端末でそのフォルダの中に `echo x > locked.txt && chmod 000 locked.txt` を実行し、ツリーに出た `locked.txt` をクリックする → `ファイル操作に失敗しました(EACCES): <パス>` がエクスプローラー上部に赤字で表示される(確かめたら `chmod 644 locked.txt` を実行する)
- [ ] **EXP-080** 端末で `echo mine > "${DIR:?}/AGENTS.md"` を実行して節を見る(ボタンは押さない) → 2 秒以内にツリーに `AGENTS.md` が現れ、その行のボタンが `作成` から `開く` に変わる。端末で `cat "${DIR:?}/AGENTS.md"` を実行すると `mine` のまま
- [ ] **EXP-081** 設定を `Claude Code` に戻し、端末で `rm "${DIR:?}/CLAUDE.local.md" && echo x > "${DIR:?}/claude.local.md"` を実行してから `フォルダを変更` で同じフォルダを開き直し、`CLAUDE.local.md` の `作成` を押す → macOS の既定(大文字と小文字を区別しない)では、節に `同じ名前のファイルかフォルダが既にあります(大文字と小文字だけ違う名前を含みます)。ファイルツリーを確かめてください` が赤字で出て、`claude.local.md` の中身は `x` のまま
- [ ] **EXP-090** 端末で `mkdir -p "${DIR:?}/src/new" && echo x > "${DIR:?}/src/new/CLAUDE.md" && echo x > "${DIR:?}/CLAUDE.local.md"` を実行して節を見る(`更新` は押さない) → 2 秒以内に、タブは閉じずに、サブフォルダの件数が 1 増えて(閉じていれば開くと)`src/new/CLAUDE.md` が出て、「このフォルダ」の `CLAUDE.local.md` の行が `開く` に変わる。続けて Tab で `更新` に移って Enter で押すと、一覧は変わらず、押した後もフォーカスの枠が `更新` に残る
- [ ] **EXP-099** EXP-098 の状態(サブフォルダを開き、ウィンドウを低くした状態)で、EXP-081 と同じ操作(端末で `rm "${DIR:?}/CLAUDE.local.md" && echo x > "${DIR:?}/claude.local.md"` を実行してから `フォルダを変更` で `$DIR` を開き直し、`CLAUDE.local.md` の `作成` を押す)をする → 低いウィンドウでも、失敗の文言(EXP-081 と同じ)が見える位置まで節の中が動き、`全体(すべてのプロジェクト)` の行のすぐ下(サブフォルダの開閉のボタンの上)に文言が見える
- [ ] **AGC-058** ソース管理の「変更」の一覧を見てから、アプリの外の端末で `echo w > w.txt`（新しい未追跡のファイル）を実行してアプリに戻り、もう一度「変更」の一覧を見る → `更新` を押さずに「変更」の一覧に `w.txt` が出る（監視の通知とフォーカスの復帰で git status を静かに取り直す）。取り直しの間に `読み込み中...` は出ず、ソース管理の `更新` は淡色にならない。「エージェントの変更」の一覧にも、戻った時点で `A w.txt` が出る
- [ ] **BRN-005** BRN-004 の直後にターミナルの `ls` で `ff.txt` を確認し、ファイルツリーを見る → `ff.txt` がディスク上に存在し、2 秒以内にファイルツリーにも `ff.txt` が出る
- [ ] **BRN-047** マージ成功のあと、エクスプローラーを見る → マージで追加されたファイルが、2 秒以内にファイルツリーに出る
- [ ] **BRN-067** エクスプローラーを開いたまま(ソース管理パネルを開かずに)ステータスバーの左下を見る。続けて端末で `git checkout ff-branch` を実行する(`更新` は押さない) → 最初はブランチアイコンと `main` が出ており、2 秒以内に `ff-branch` に変わる。その後ソース管理パネルの `更新` を押しても `ff-branch` のまま
- [ ] **DSC-018** diff タブを開き、ハンクの `このハンクを取り消す` を押して確認のダイアログを出したまま、端末で `f.txt` の同じハンクの行を書き換えてから、確認で「OK」を押す → `ハンクを取り消せませんでした。ファイルが変更された可能性があります。diff を開き直してください` が diff タブに赤字で表示される
- [ ] **DSC-019** DSC-018 のあとのファイルの内容を見る → ファイルは取り消しを試みる前(端末で書き換えた後)から変わっておらず、2 秒以内に diff が最新の内容になる(diff タブを開き直さなくてよい)
- [ ] **RMT-010** 別の管理外のフォルダを開いて `リポジトリを初期化` のダイアログを開いたまま、端末でそのフォルダに `git init -q -b trunk` を実行する(ダイアログの `初期化` は押さない) → 2 秒以内にダイアログが消え、パネルがリポジトリの表示(左下のブランチの項目は `trunk`)に変わる。端末で `git symbolic-ref HEAD` は `refs/heads/trunk` のまま
- [ ] **AGT-254** テスト用のフォルダが Git リポジトリで `変更を確認` の記録を始められるなら行う（そうでなければ、そのことを記録して次へ進む）。先に端末で `cd <テスト用のフォルダ>` を実行し、`git check-ignore -q dist/x && echo ignored` が何も出さず、`dist` が無いことを確かめる（出る・ある場合は、そのことを記録して次へ進む。`dist/` が無視されると一覧に出ず、前から `dist` があると後片付けの `rm -r dist` で利用者のファイルまで消えるため）。続けて `mkdir -p dist && echo keep > dist/keep.txt` を実行する（記録のインデックスに `dist/keep.txt` を入れておくため。空のフォルダは `A dist/` の 1 行にまとまり、`A dist/copilot-auto-refresh.txt` と出ない）。`変更を確認` → `いまから記録する` で記録を始める。別の端末で `cd <テスト用のフォルダ>` を実行し、`pwd` がテスト用のフォルダであることを確かめてから、`sleep 15; echo auto >> dist/copilot-auto-refresh.txt` を実行し、すぐにアプリへ戻って `copilot` に長い作業を送る（端末で実行してから 15 秒以内に送る）。アプリのウィンドウを前面にしたまま、`更新` を押さずに作業が終わるまで待つ → 作業の途中には一覧に出ず、作業が終わると、変更の一覧に `A dist/copilot-auto-refresh.txt` が出る（`更新` を押していない。`dist` の中は監視で取り直さないため、作業の完了で初めて出る）（`dist` の中のファイルが、完了・許可待ち・フォーカスの復帰の前に一覧に出たら、そのことを記録する。macOS の FSEvents が親のフォルダの通知を出すかは実物で確かめていないため）。確かめた後、同じ端末で `pwd` を確かめてから `rm -r dist` を実行し、アプリで `確認を終える` を押して記録を終える
- [ ] **AGC-054** 端末で `mkdir -p dist && echo keep > dist/keep.txt` を実行してから、VoiceOver を有効にし、`実行` で「dist/q.txt を作って」を送り、何も押さずに作業の終わりを待つ → 完了の読み上げ（VoiceOver）・通知の後、1 秒ほどで一覧に `A dist/q.txt` が出る（それまでは出ない。`dist` の中は監視で取り直さないため。`dist/keep.txt` は記録の前からあるので一覧に出ない）（`dist` の中のファイルが、完了・許可待ち・フォーカスの復帰の前に一覧に出たら、そのことを記録する。macOS の FSEvents が親のフォルダの通知を出すかは実物で確かめていないため）。件数（`エージェントの変更: N 件`）は読み上げられない。完了の読み上げから一覧が出るまでのおおよその秒数と `claude --version` を記録する（活動の判定のデバウンス + 0.3〜1 秒の見込み。L-059）
- [ ] **AGC-055** 端末で `mkdir -p dist && echo keep > dist/keep.txt` を実行してから、`実行` で「dist/r.txt を作ってから、ls を実行して」を送り、`claude` が `ls` の実行の許可を求めて止まったら、許可に答えずに一覧を見る → 許可を求めた時点で一覧が取り直され、`A dist/r.txt` が出ている（それまでは出ない。`dist` の中は監視で取り直さないため）（`dist` の中のファイルが、完了・許可待ち・フォーカスの復帰の前に一覧に出たら、そのことを記録する。macOS の FSEvents が親のフォルダの通知を出すかは実物で確かめていないため）。`claude` が `ls` の許可を求めずに実行した場合は、許可を求める別のコマンド（例: 「dist/s.txt を作ってから、curl https://example.com を実行して」）で試し、その旨と `claude --version` を記録する。確かめたら許可の画面で `Esc` を押して止める
- [ ] **AGC-056** アプリの外の端末（macOS のターミナル.app など）で `mkdir -p dist && echo keep > dist/keep.txt && echo z >> dist/z1.txt` を実行してから、`Cmd+Tab` でアプリに戻る。続けて端末で `echo z >> dist/z2.txt` を実行し、アプリのウィンドウを最小化（`Cmd+M`）してから Dock で戻す → どちらも `更新` を押さずに、戻った時点で一覧に `A dist/z1.txt`・`A dist/z2.txt` が出て、アプリが裏にある間は出ない（フォーカスの復帰で取り直す。`dist` の中は監視で取り直さないため）（`dist` の中のファイルが、完了・許可待ち・フォーカスの復帰の前に一覧に出たら、そのことを記録する。macOS の FSEvents が親のフォルダの通知を出すかは実物で確かめていないため）。取り直しの間も、セクションに `更新中…` は出ず、`↶`・`すべて戻す` は淡色にならない（自動の取り直しは静かに取る）
- [ ] **AGC-062** 記録が無い状態で、端末で `mkdir -p dist && echo keep > dist/keep.txt` を実行してから、`実行` で「dist/v.txt を作って、1 行目に one と書いて」を送り、完了を待ってから一覧の `dist/v.txt` を押して diff タブを開く。diff タブを開いたまま、`実行` で「dist/v.txt の末尾に two という行を足して」を送り、何も押さずに完了（または許可待ち）を待つ。続けて何もせずに `Cmd+Tab` で別のアプリへ移って戻る → 完了（許可待ち）の後、1 秒ほどで開いている diff に `+two` の行が出る（一覧の行は `A dist/v.txt` のまま変わらないが、同じファイルの続きの変更が反映される。それまでは出ない。`dist` の中は監視で取り直さないため）（`dist` の中のファイルが、完了・許可待ち・フォーカスの復帰の前に一覧に出たら、そのことを記録する。macOS の FSEvents が親のフォルダの通知を出すかは実物で確かめていないため）。完了（許可待ち）の後の取り直しでは `読み込み中...` を挟まない（2 回目を送った直後の取り直しで一瞬出るのは対象外）。中身が変わったときはスクロールが先頭に戻ってよいが、その後に戻ったとき（中身が同じ）はスクロールの位置もフォーカスも変わらない。確かめたら `確認を終える` を押す
```

「ブランチ操作」の `### ステータスバーのブランチの切り替え` の 2 つ目の前提（今の `docs/manual-test-spec.md` の 1805 行付近）も、BRN-067 と食い違うので書き直す:

```markdown
> 前提: 端末で切り替えたブランチは、ステータスバーに自動で反映される(2 秒以内)。ブランチの一覧は自動では取り直さないので、端末で作ったブランチを一覧に出すには `更新` を押す(`更新` は一覧の元になるブランチの情報も取り直す。アプリ内でブランチを操作した後は自動で取り直す)。
```

「ソース管理（基本）」の冒頭の前提（今の `docs/manual-test-spec.md` の 1455 行）は、反映の時機を「外部での変更はターミナルで行い、パネルの先頭の行の `↻`(ツールチップ `更新`。以降は `更新` と書く)で反映する。」と書いているので、この 1 文だけを次のように書き直す(前後の文〈リポジトリの作り方・リモートの用意・`…` のメニューの説明・`↑N` `↓N` の場所〉と、`更新` の呼び名の定義は残す):

```markdown
外部での変更はターミナルで行う。開いているリポジトリの中の変更は自動で反映される(2 秒以内)。項目の手順にある `更新` は、パネルの先頭の行の `↻`(ツールチップ `更新`。以降は `更新` と書く)を押す。
```

前提が変わらないことを確かめた項目: EXP-091・EXP-092・EXP-095（端末で作った後に節の `更新` を押す。押す前に自動で反映されていても期待結果は同じ）、EXP-085（走査の途中の作成。監視は切り替え先を張るが、走査中のツリーの書き込みは今どおり抑止される）、EXP-105・EXP-106（全体の指示ファイルはツリーの外で、監視しない）、AGC-053・AGC-060（記録が無い間は連鎖しても一覧を出さない。自動の取り直しは静か）、端末で git を実行してから `更新` を押す GIT・BRN の項目（`更新` を押す前に自動で反映されていても、期待結果は同じ）。

## 8. ROADMAP・README・developer-guide の更新の方針

- ROADMAP
  - 「ファイル / ワークスペース管理」の項目（870 行付近）を `[x]` にし、「ファイルツリー・ソース管理（git status）・アクティブな diff タブを、開いているフォルダの recursive の監視とウィンドウのフォーカスの復帰で静かに取り直す（2026-11-08。設計書 `docs/superpowers/specs/2026-11-08-file-tree-auto-refresh-design.md`）」と書く。続けて 5 章から抜粋した既知の制約を並べる（Linux は監視しない・`SKIP_DIRS` の中・`.gitignore` を見ない・大きなフォルダの全部の読み直し・作業ディレクトリが外の git・`GIT_OPTIONAL_LOCKS=0`・全体の指示ファイル）
  - 既知の制約の 1446 行（「監視は開いているタブの親ディレクトリだけで、ツリーとソース管理は自動で更新しない」）は、過去形にして「2026-11-08 から、ツリーとソース管理は開いているフォルダの監視で自動で更新する」と書き足す。1450 行（diff タブ）は「2026-11-08 から、外の変更の後にアクティブな diff タブを静かに取り直す」と書き足す
  - 259 行（「ソース管理の git status は今も取り直さない」）を「2026-11-08 から、ファイルツリー・ソース管理の自動更新で取り直す」に直す
  - 指示ファイルの残りのうち、719 行付近（サブフォルダの指示ファイルの既知の制約「外部で足した・消した指示ファイルは、ツリーを読み直すまで一覧に反映しない」）と 827 行付近（「残り: … 外部での追加・削除の自動の反映（file watcher）」）を、フォルダの中の指示ファイルについては済みに直す。726 行付近（全体の指示ファイルの既知の制約）は変えない（全体の指示ファイルは監視しない）
  - 「隠しファイル / 除外パターン（.gitignore 準拠）の表示制御」は残りのまま（範囲外）
- README
  - 「主な機能」のエクスプローラー・エディタの行に「外で作った・消したファイルや git の操作を、ファイルツリーとソース管理に自動で反映します（macOS。Windows は確かめていない。Linux はウィンドウのフォーカスの復帰でだけ反映）」を足す（Windows の recursive の挙動は確かめていない〈1 章・5 章〉ので、対応する環境として挙げない）
  - 「main（`src/main/`）」に `folderChangeWatcher.ts`・`folderChangeClassifier.ts`（開いているフォルダの recursive の監視と、変化の分類）を足す。renderer に `useFolderAutoRefresh.ts`・`lib/refreshScheduler.ts` を足す
- developer-guide
  - 「3.2 main → renderer の通知」に `fs:folderChange` を足す（`fs:externalChange` の隣。監視を張るかは renderer の `fs:setFolderWatch`、どのフォルダかは main が決める）
  - 「6. よくある落とし穴」に「アプリが実行する `git status` は `.git/index` を書き換えうるので、`.git` の監視を契機にする git status の取得は `GIT_OPTIONAL_LOCKS=0` で行う」を足す（`git diff` も stat だけ変わったファイルで `.git/index.lock` を取って index を書き直す〈`GIT_OPTIONAL_LOCKS=0` では止まらない〉ので、`getDiff` は `-c diff.autoRefreshIndex=false` で書かせない。サブモジュールの dirty を調べる子の status のロックは `GIT_OPTIONAL_LOCKS=0` で止める。1 章の 10）
- 実機テスト仕様書: 7 章の項目を追記・修正し、`node scripts/build-manual-test-spec.mjs` で HTML を再生成して Artifact を同じファイルパス（`.superpowers/manual-test-spec.html`）で再公開する。`npx vitest run scripts` が通ること
- 範囲外として書き残すもの（ROADMAP の残り・5 章）: `.gitignore` に従う除外、フォルダの開閉の状態の保存、全体の指示ファイルの監視、ツリーの部分的な読み直しの API、Linux での監視、開いているタブの監視の改善、コミット履歴・ブランチ一覧の自動の取り直し
