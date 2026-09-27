# ソース管理機能拡張（diff表示・ハンク単位ステージ・履歴・amend・gitignore補助）設計

対応する ROADMAP 項目（「今後実装した方がよい機能」の「ソース管理（Git）」セクションのうち以下）:

- 変更のステージ / アンステージ（ハンク単位）
- ファイル差分（diff）の表示
- コミット履歴 / ログの表示
- ブランチの表示
- タグの表示
- コミット（amend）
- `.gitignore` の編集補助

## 背景・現状

現在実装済みなのは、ファイル単位のステージ / アンステージ / コミット（`src/main/gitService.ts` の
`stageFile`/`unstageFile`/`commit`、`useGitOperations` 経由で `SourceControlPanel` → `GitRepoView` →
`StagedSection`/`ChangesSection`/`CommitSection` に UI がある）。差分の中身を見る手段や、コミット履歴・
ブランチ・タグを確認する手段が無く、変更を部分的に選んでコミットに含めることもできない。

## スコープ

含む:

- ファイル単位の diff（変更前後の差分）をエディタ領域の専用タブで表示する
- diff 上でハンク（連続した変更のかたまり）単位でのステージ / アンステージ
- コミット履歴の一覧表示（直近 N 件 + もっと見る）
- ブランチ一覧・タグ一覧の表示（切り替え・作成・削除・マージは含まない）
- コミットの amend
- ファイルツリーの右クリックメニューから `.gitignore` へのパス追加

含まない（別スコープ）:

- ブランチの切り替え・作成・削除・マージ
- push / pull / fetch、リモートの管理・clone
- blame、stash、変更の取り消し（discard）、マージコンフリクト解決 UI
- コミット履歴の各コミットをクリックしたときの diff 表示（今回は一覧表示のみ）
- コミット履歴の無限スクロール（固定件数 + もっと見るボタンに留める）

## 仕様

### diff 表示

- `ChangesSection`（未ステージ）・`StagedSection`（ステージ済み）の各ファイル行をクリックすると、
  中央のエディタ領域に「diff タブ」が開く。既存の実ファイルタブとは別の仮想的なタブとして扱う
  （後述のアーキテクチャ参照）。
- 表示形式は Monaco の `diffEditor` ではなく、**自前の unified diff 表示**にする。行ごとに
  `+`/`-`/コンテキストで色分けし、ハンク（`@@ -a,b +c,d @@` 区切り）ごとにセクション分けして
  表示する。理由: ハンク単位ステージを確実に実装するには、ハンクの境界が明示された unified diff
  形式のテキストをそのまま扱う方が、Monaco `diffEditor` の内部差分情報から逆算するより実装が
  シンプルかつ安定する。
- 未追跡ファイル（`GitFileStatus.index === '?'`）は `git diff` が差分を返さないため、ファイル内容
  全体を「全行追加」の疑似 diff として構築して表示する。

### ハンク単位のステージ / アンステージ

- 各ハンクの右上に「ステージ」（未ステージ側の diff タブ）または「アンステージ」（ステージ済み側の
  diff タブ）ボタンを表示する。
- クリックされたハンク 1 件分のテキストから、ファイル全体の diff ヘッダー（`diff --git a/... b/...`
  等）を前後に補って完全なパッチを組み立て、`git apply --cached`（アンステージ時は `--reverse` を
  追加）に標準入力で渡す。Git 自体が提供する標準的なハンク単位操作の方式で、VSCode 等の実装もこの
  方式に近い。
- ハンク適用後は diff タブの内容と `ChangesSection`/`StagedSection` の表示を再取得して更新する。

### コミット履歴 / ブランチ / タグの表示

- `SourceControlPanel` に新セクション「履歴」（`HistorySection.tsx`）を追加する。
- セクション上部にブランチ名・タグ名を小さなバッジ列として表示し、その下にコミット一覧
  （ハッシュ短縮形・メッセージ 1 行・相対日時）を並べる。
- コミットは直近 20 件を固定取得し、「もっと見る」ボタンで追加 20 件を取得する。
- コミット行のクリックは今回何もしない（将来 diff 表示を追加する余地として残す）。

### コミットの amend

- `CommitSection.tsx` に「amend」チェックボックスを追加する。
- チェック時、直前のコミットメッセージ（`getLog` の先頭 1 件）をメッセージ欄に自動入力する
  （ユーザーはそのまま編集できる）。
- 通常コミットはステージ済み件数が 0 のとき無効化されるが、amend チェック時はステージ済み件数
  0 でもボタンを有効化する（メッセージのみの修正を許可するため）。
- amend 実行は `git commit --amend -m <message>` 相当。

### `.gitignore` の編集補助

- ファイルツリーの右クリックコンテキストメニューに「.gitignore に追加」を追加する。
- 選択したファイル / フォルダの、開いているフォルダルートからの相対パスを `.gitignore` に追記する。
- `.gitignore` が存在しない場合はフォルダルートに新規作成する。
- 既に同じ行が存在する場合は重複追記しない。

### エラーハンドリング

既存方針を踏襲し、`simple-git` / `fs` が投げる例外のメッセージをそのまま表示する（個別のエラー種別
ハンドリング・専用コンバータは作らない）方針で開始したが、実装中に未追跡ファイルの疑似diff構築
（`readFileBuffer`/`isExecutableFile`/`isSymbolicLink` の ENOENT 等）で OS 絶対パスを含む生の
Node エラーがそのまま伝播する問題が見つかり、`src/main/fsErrorConverter.ts`（`convertFsAccessError`/
`convertFsError`）を新設した。これは元々 `src/main/handlers/fileSystemHandlers.ts` 専用だった
変換ロジックを、`gitService.ts`（サービス層）からも使えるよう handlers 配下から main 直下へ
移したもの（`fsErrors.ts` と同じ理由）。

## アーキテクチャ

### main プロセス

`src/main/gitService.ts` に追加:

```ts
// isUntracked は renderer 側が既に持つ git status 由来の情報をそのまま受け取り、
// main 側で git.status() を再スキャンする無駄を避けるため後から追加した引数。
// renamedFrom はステージ済みリネームの diff を取る際、旧パスも pathspec に
// 併記してリネーム検出させるために後から追加した引数
export async function getDiff(
  folderPath: string,
  filePath: string,
  staged: boolean,
  isUntracked: boolean,
  renamedFrom?: string
): Promise<string>
export async function stageHunk(folderPath: string, filePath: string, hunkPatch: string): Promise<void>
export async function unstageHunk(folderPath: string, filePath: string, hunkPatch: string): Promise<void>
// skip はページング（「もっと見る」)のために後から追加した引数
export async function getLog(folderPath: string, limit: number, skip: number): Promise<GitLogEntry[]>
export async function getBranches(folderPath: string): Promise<GitBranch[]>
export async function getTags(folderPath: string): Promise<string[]>
export async function amendCommit(folderPath: string, message: string): Promise<void>
```

`src/main/handlers/gitHandlers.ts` に対応する IPC チャンネル（`git:getDiff`、`git:stageHunk`、
`git:unstageHunk`、`git:getLog`、`git:getBranches`、`git:getTags`、`git:amendCommit`）を追加登録する。
ファイルパスを扱うものは既存の `resolve(allowedFolder, filePath)` → `assertFileWithinFolder` の
パターン（削除済みファイル対応の ENOENT フォールバック込み）をそのまま踏襲する。

`.gitignore` 追加は当初 `src/main/fileSystem.ts` に置く想定だったが、read-then-write の間の
排他制御（フォルダごとに直列化するキュー）や gitignore パターンのエスケープなど、テキスト
ファイルとしての読み書きに特化したロジックが増えたため、`src/main/gitignoreService.ts`（新規）に
`addToGitignore(folderPath, relativePath)` として独立させた。simple-git 経由の git コマンドを
一切使わない点で、git 呼び出しをラップする `gitService.ts` とも責務が異なる。IPC チャンネルは
既存の `fs:*` ハンドラ群と同様のパターンで `fileSystemHandlers.ts` に追加する。

### preload / renderer lib

`src/preload/api.ts`・`index.d.ts` に上記関数を追加し、`src/renderer/src/lib/gitApi.ts` に薄い
ラッパーを追加する。

### renderer フック・コンポーネント

- `src/renderer/src/lib/diffParser.ts`（新規）: unified diff 文字列をハンク単位の配列
  （`{ header: string; lines: string[] }[]`）にパースする純粋関数。ハンクからパッチ文字列を
  再構築する関数もここに置く。
- `src/renderer/src/hooks/useDiffTabs.ts`（新規）: `{ path: string; staged: boolean }` をキーに
  開いている diff タブの一覧・アクティブタブを管理する。`useFileSystem.ts` の実ファイルタブ管理
  とは独立させる（既存の `useFileSystem.ts` は保存・並び替え・キーボードセンサー等で既に複雑な
  ため、diff タブ用の分岐を増やさない）。
- `src/renderer/src/components/source-control/DiffView.tsx`（新規）: diff タブの中身。
  `diffParser` でパースしたハンクを表示し、ステージ / アンステージボタンを配置する。
- `src/renderer/src/hooks/useGitHistory.ts`（新規）: コミット履歴・ブランチ・タグの取得と
  「もっと見る」のページング状態を管理する。
- `src/renderer/src/components/source-control/HistorySection.tsx`（新規）: 上記を表示する。
- タブバー（`EditorTabs` 等）は `useFileSystem` 由来の実ファイルタブと `useDiffTabs` 由来の
  diff タブを合成して描画する。両者の切り替え・アクティブ判定はタブバー層でのみ意識する。
- `CommitSection.tsx` に amend チェックボックスとその状態を追加。
- ファイルツリーの右クリックメニューコンポーネントに「.gitignore に追加」項目を追加。

### 型定義

`src/shared/types/git.ts` に追加:

```ts
export type GitLogEntry = {
  hash: string
  message: string
  date: string
  authorName: string
}

export type GitBranch = {
  name: string
  current: boolean
}
```

## テスト方針

既存パターン（Vitest + Testing Library、`__tests__/` 同階層配置、`describe`/`it` は日本語）を踏襲し
TDD で実装する。

- `diffParser.ts`: 実際の unified diff 文字列サンプルを使い、パース → ハンク抽出 → パッチ再構築の
  往復が元の diff と一致することを検証する（モックに頼らず実データで確認する）。
- `gitService.ts` の新規関数: 既存の `stageFile`/`unstageFile` と同じ `simple-git` モックパターンで、
  正しい引数（`--cached`、`-U3` 等のオプション）を渡していることを検証する。
- `stageHunk`/`unstageHunk`: `git apply --cached` に渡すパッチ文字列の組み立てが正しいことを、
  実際の diff サンプルから生成したパッチで検証する。
- `useDiffTabs`/`useGitHistory`: 状態遷移（タブの開閉、ページングの追加取得）をテストする。
- `CommitSection.tsx`: amend チェック時のメッセージ自動入力・ステージ 0 件でもボタン有効化を検証する。

## 実装順序

1. `gitService.ts` に diff/log/branches/tags/amend を追加（main プロセス、TDD）
2. IPC ハンドラ追加（`gitHandlers.ts`）
3. `.gitignore` 追加機能（`fileSystem.ts`/`fileSystemHandlers.ts`、TDD）
4. preload / `renderer/lib/gitApi.ts` の更新
5. `diffParser.ts`（パース・パッチ再構築、TDD）
6. `useDiffTabs.ts` フック
7. `DiffView.tsx`（ハンク表示・ステージ / アンステージボタン）
8. タブバーへの diff タブ統合
9. `useGitHistory.ts` フック
10. `HistorySection.tsx`
11. `CommitSection.tsx` の amend 対応
12. ファイルツリー右クリックメニューへの `.gitignore` 追加項目
13. 全体配線・CSS
14. 型チェック・全テスト実行・Electron 実機確認
