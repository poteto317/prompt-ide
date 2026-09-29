# Git 変更の取り消し（discard）設計

対応する ROADMAP 項目（「今後実装した方がよい機能」の「ソース管理（Git）」セクション）:

- 変更の取り消し（discard）

## 背景・現状

ソース管理パネルの「変更」セクション（`ChangesSection`）には、未ステージのファイルごとに
diff の表示とステージ（`+`）の操作がある。しかし、作業中の変更を捨てて元に戻す手段が無く、
試行錯誤の後片付けのたびに外部ターミナル（`git restore` / `git clean`）へ抜ける必要がある。
「別画面を開かずタッチ操作だけで開発フローを完結する」というコンセプトに対し、
日常的に頻度の高い操作が欠けている。

## スコープ

含む:

- 「変更」セクションの各ファイルに対する取り消し（ファイル単位）
  - 追跡済みファイルの未ステージの変更を、index の内容へ戻す（`git restore --worktree` 相当。
    ステージ済みの内容は残る）
  - 未追跡ファイル・未追跡ディレクトリを OS のゴミ箱へ移動する（Electron の `shell.trashItem`）
- 取り消し対象のファイルがエディタで開かれている場合のバッファ同期

含まない（別スコープ）:

- ハンク単位の取り消し（diff タブからの取り消し）
- 「変更をすべて取り消し」の一括操作
- ステージ済みの変更の取り消し（アンステージは既存の操作で行う）
- コンフリクト中のファイルの取り消し（解決 UI とセットで別対応）
- ゴミ箱に移したファイルのアプリ内からの復元（OS のゴミ箱から復元できる）

## 仕様

### 取り消しの操作

- 「変更」セクションの各行、ステージボタン（`+`）の隣に取り消しボタン（`↶`）を置く
  - `aria-label`: 「<path> の変更を取り消し」
  - タップ領域は既存のステージボタンと同じ大きさにする
- 押すと確認ダイアログを出す。文言は対象の種類で変える
  - 追跡済み: 「<path> の変更を取り消しますか？この操作は元に戻せません。」
  - 未追跡: 「<path> をゴミ箱へ移動しますか？」
- 承諾されたら取り消しを実行する。キャンセルなら何もしない

### エディタのバッファ同期

取り消しは working tree のファイルを直接書き換える（または移動する）ため、エディタで
開いているタブの内容が古くなる（`docs/review-findings-patterns.md` パターン19）。

- 対象ファイルのタブに未保存の編集がある場合は、確認ダイアログの文言に
  「エディタの未保存の編集も破棄されます。」を追加し、1 回の確認で両方の破棄を承諾させる
- 取り消しが**成功したときだけ**（パターン20）、対象ファイルのタブを次のように扱う
  - 追跡済み: ディスクの内容で再読込する（未保存の編集は破棄される）
  - 未追跡（ゴミ箱へ移動）: タブを閉じる
  - 対象が未追跡ディレクトリの場合: そのディレクトリ配下のタブをすべて閉じる
- 対象ファイル以外のタブには触れない（未保存の編集を保持する）
- 取り消しが失敗・no-op の場合はタブに触れない

### 実行中・他操作中の表示

- 取り消しボタンは、ステージボタンと同じ条件で disabled にする（stage/unstage・ハンク操作・
  commit・pull・checkout・他の取り消しの実行中）。取り消し中はステージボタンも disabled になる
- コンフリクト中のファイルの行では、取り消しボタンを表示しない

### エラーハンドリング

- main 側のエラーは日本語メッセージにして投げ、既存の Git 操作エラーの表示箇所に出す
  - コンフリクト中: 「コンフリクト中のファイルは取り消せません: <path>」
  - フォルダ外のパス: 既存の `assertFileWithinFolder` のエラー
  - ゴミ箱への移動の失敗: 「ゴミ箱へ移動できませんでした: <path>」（`shell.trashItem` の
    reject を変換する。OS やファイルシステムによってはゴミ箱が使えないため）
- `git restore` 自体の失敗は、git のエラーをそのまま伝播する

## アーキテクチャ

### main プロセス

- `src/main/gitService.ts` に `discardFileChanges(folderPath, filePath, trash)` を追加する
  - `trash` は `(absolutePath: string) => Promise<void>`（本番では `shell.trashItem`）。
    Electron への依存を gitService から切り離し、単体テストで差し替えられるようにする
  1. `git ls-files -u -- :(literal)<path>` の出力が空でなければコンフリクト中として拒否する
  2. `git ls-files -- :(literal)<path>` の出力が空なら未追跡として `trash(<絶対パス>)` を呼ぶ
     （未追跡ディレクトリは status に `newdir/` の形で現れ、`ls-files` も空になる）
  3. それ以外は `git restore --worktree -- :(literal)<path>` を実行する
  - pathspec は既存の `toLiteralPathspec` でリテラル化する（`a[1].txt` が `a1.txt` に一致する
    グロブ展開を防ぐ）
- 前提（2026-09-29 に git 2.50.1 の実機で確認）
  - `git restore --worktree` は index の内容へ戻すため、ステージ済みの内容は残る
  - working tree で削除したファイル（`D`）も復元できる
  - 未追跡ファイルに `git restore` を使うと `pathspec ... did not match` で失敗する
  - コンフリクト中のファイルは `git restore` が `path '...' is unmerged` で失敗し、
    `git ls-files` では同じパスが複数回出力される（`ls-files -u` で判定できる）

### IPC（`src/main/handlers/gitHandlers.ts`）

- `git:discardChanges`（引数 `filePath: string`）
  - 既存の `git:stage` と同じく、フォルダの許可確認 → 絶対パスへの解決 → 境界チェック →
    リポジトリ相対パスへの変換を行ってから service を呼ぶ
  - `trash` には `shell.trashItem` を渡す

### preload / renderer lib

- `src/preload/api.ts` / `src/preload/index.d.ts` / `src/renderer/src/lib/gitApi.ts` に
  `discardChanges(filePath: string): Promise<void>` を追加する

### renderer フック

- `useGitOperations` に `discardFile(path: string): Promise<boolean>` を追加する
  - 既存の `runStageOperation` の直列化（stagingPaths・`lock.isAnyLocked()`・`lock.isLocked(path)`・
    commit 実行中の判定）に乗せる。`git restore` は index の stat 情報を更新しうるため、
    `.git/index` を書き換える他の操作と同時に走らせない
  - 戻り値は「実際に実行され成功したか」（no-op・失敗は false）
- `useFileSystem` に `reloadOpenFile(path: string): Promise<void>`、
  `closeTabsAtOrInside(path: string): void`、`hasDirtyTabAtOrInside(path: string): boolean` を
  追加する（引数は絶対パス。全タブを対象にする既存の `reloadOpenFiles` と異なり、対象のパスだけを扱う）
  - `reloadOpenFile` / `closeTabsAtOrInside` は、影響を受けた各タブについて、アクティブなタブなら
    `resetForFileChange`（保存世代を進めて待機中の保存を無効化し、古い `saveError` / 保存中止通知も
    クリアする）、そうでなければ `invalidatePath`（保存世代のみ進める）を呼ぶ。いずれの関数も
    保留中の読み込みを `invalidatePendingReads` で無効化するが、呼ぶ位置が異なる。`reloadOpenFile`
    は「対象タブが開いていない」場合の早期リターンより後、`readFileContent` の完了後（状態更新の
    直前）に呼ぶ（自身の待機中に `selectFile` 経由でそのパスへ新たな読み込みが始まっていた場合、
    それが後から解決して取り消し後の内容や読み込み失敗によるクローズを上書きしないようにするため）。
    `closeTabsAtOrInside` は「影響タブが 0 件」の早期リターンより前に呼ぶ（まだタブとして確定して
    いない選択中の読み込みも取りこぼさないようにするため）。これはエクスプローラーの `deleteEntry`
    と同じ保護をタブ単位の取り消しにも適用するもので、（1）取り消し対象のタブに残っていた古い
    `saveError` が隣接する別のクリーンなタブへ誤って表示され続けること、（2）ロック待ちだった保存が
    取り消し後に解決し、復元・削除した内容を書き込みで上書きしてしまうこと、（3）保留中だった読み込み
    （`reloadOpenFile` では自身の待機中に新たに始まった読み込み、`closeTabsAtOrInside` ではゴミ箱へ
    移したディレクトリ配下を選択中だった読み込み）が後から解決し、取り消し後の内容やゴミ箱の中身を
    上書き・再表示してしまうこと、をそれぞれ防ぐ。既知の制約として、ブランチ切り替え
    （`reloadOpenFiles`）時と同じく、これらの無効化は取り消し実行前に既に発行済み（await 中）の
    書き込みまでは止められず、取り消し後もディスクへ到達しうる
- 確認・取り消し・タブ同期の組み立ては新設の `useDiscardFileChanges`（`hooks/useDiscardFileChanges.ts`）
  が担い、`useAppState` は依存を渡して `discardFile` として公開するだけにする:
  1. 対象が未追跡か（`gitStatus.files` の状態）と、対象（未追跡ディレクトリなら配下）のタブに
     未保存の編集があるかから確認文言を組み立てて確認する。キャンセルなら何もしない
  2. `gitOperations.discardFile(path)` を呼ぶ
  3. 成功時のみ、追跡済みなら `reloadOpenFile`、未追跡なら `closeTabsAtOrInside` を呼ぶ
  - リポジトリ相対パスから絶対パスへの変換は `joinPath(folderPath, path)` で行う
  - 確認関数は `onConfirm = confirm` で差し込めるようにする
  - 確認文言の組み立ては純粋関数（`lib/discardConfirmMessage.ts`）に切り出す
- ゴミ箱への移動は `src/main/trash.ts` の `moveToTrash`（`shell.trashItem` の薄いラッパー）に
  閉じ、ハンドラーから `discardFileChanges` へ注入する

### renderer コンポーネント

- `ChangesSection` に `onDiscard: (path: string) => void` を追加し、各行に取り消しボタンを描画する
  - コンフリクト中の行の判定には、`lib/gitUtils.ts` の既存の非公開関数 `isConflictedFile` を export して使う
    （`isStagedFile` と同じ判定を共有し、main 側の `ls-files -u` による拒否と表示を揃える）
- `GitRepoView` / `SourceControlPanel` / `Sidebar` / `App` へ配線する

## テスト方針

- `gitService.test.ts`（`discardFileChanges`）
  - 追跡済みなら `restore --worktree` をリテラル pathspec で呼び、`trash` を呼ばないこと
  - 未追跡（`ls-files` が空）なら絶対パスで `trash` を呼び、`restore` を呼ばないこと
  - コンフリクト中（`ls-files -u` が空でない）なら日本語エラーで拒否し、何も実行しないこと
  - `trash` の失敗を日本語エラーに変換すること
  - `a[1].txt` のようなグロブ文字を含むパスがリテラル化されていること
- `gitHandlers.test.ts`: フォルダ外のパスの拒否、相対パスへの変換、`shell.trashItem` の受け渡し
- `useGitOperations.test.ts`: 排他（他操作中は呼ばない）、戻り値、エラー state への反映
- `useFileSystem.test.ts`: `reloadOpenFile` が対象タブだけを再読込すること、
  `closeTabsAtOrInside` が配下のタブだけを閉じること
- `useAppState.test.ts`: 確認のキャンセル、未保存の編集がある場合の文言、成功時だけ
  再読込・クローズすること、失敗時はタブに触れないこと
- `discardConfirmMessage.test.ts`: 追跡済み/未追跡 × 未保存の編集あり/なしの文言
- `ChangesSection.test.tsx`: ボタンの表示・`aria-label`・disabled 条件・コンフリクト行で非表示
- 実機（Electron）: 追跡済みの変更の取り消し、ステージ済み + 未ステージの混在、削除した
  ファイルの復元、未追跡ファイル・ディレクトリのゴミ箱への移動、開いているタブの同期

## 実装順序

1. main: `discardFileChanges`（`trash` の注入を含む）
2. IPC・preload・`gitApi`
3. `useGitOperations.discardFile`
4. `useFileSystem` の `reloadOpenFile` / `closeTabsAtOrInside`
5. 確認文言の純粋関数と `useAppState` のラッパー
6. `ChangesSection` の UI と配線
7. ROADMAP の更新
