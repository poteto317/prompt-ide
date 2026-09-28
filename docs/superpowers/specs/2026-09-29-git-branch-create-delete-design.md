# Git ブランチの作成・削除 設計

対応する ROADMAP 項目（「今後実装した方がよい機能」の「ソース管理（Git）」セクション）:

- ブランチの作成・削除・マージ（表示・切り替えは実装済み）のうち、**作成・削除**

## 背景・現状

ブランチの表示と切り替えは実装済みで、ソース管理パネルの現在ブランチ名がポップオーバー形式の
ブランチスイッチャー（`BranchSwitcher` / `BranchSwitcherMenu`）になっている。切り替えは
`gitService.checkoutBranch` → IPC `git:checkoutBranch` → `useGitBranchOperations.checkoutBranch`
→ `useAppState` のラッパー（未保存編集の破棄確認・成功時のみ `reloadOpenFiles`）という経路で動く。

一方、新しい作業を始めるためのブランチ作成や、不要になったブランチの削除はできず、そのたびに
外部ターミナルへ抜ける必要がある。「別画面を開かずタッチ操作だけで開発フローを完結する」という
コンセプトに対し、ブランチ操作の中で最も頻度の高い2つが欠けている状態である。

## スコープ

含む:

- 現在の HEAD を起点にしたブランチの作成と、作成したブランチへの即時切り替え（`git checkout -b` 相当）
- ローカルブランチの削除（安全削除 → 未マージで失敗した場合のみ強制削除の確認）
- ブランチスイッチャーのメニューからの操作（作成ボタン、各行の削除ボタン、`Delete` キー）

含まない（別スコープ）:

- ブランチのマージ（マージコンフリクト解決 UI とセットで別サイクルで扱う）
- 起点ブランチ / コミットの選択（常に現在の HEAD から作成する）
- 作成のみで切り替えない操作（`git branch <name>` 相当）
- リモートブランチの作成・削除・追跡設定（upstream の設定）
- ブランチのリネーム
- ステータスバーのブランチ名の動的表示（ROADMAP の別項目）

## 仕様

### ブランチの作成

- ブランチスイッチャーのメニュー先頭にある「＋ 新しいブランチを作成…」を押すと、メニューを閉じて
  名前入力ダイアログ（タイトル「新しいブランチ名」）を開く
- OK で現在の HEAD から新しいブランチを作成し、そのブランチへ切り替える
- 現在の HEAD から作成するため working tree・index は変化しない。未コミットの変更は新しいブランチへ
  そのまま持ち越される。したがって、ブランチ切り替えと異なり、未保存編集の破棄確認とエディタの
  再読込は行わない
- コミットが1つも無いリポジトリ（unborn HEAD）でも作成できる（`git checkout -b` は unborn HEAD で
  ブランチ名を付け替える動作になる）
- 入力ダイアログ内の検証（UX 用）:
  - 空文字（前後の空白は trim する）: 「名前を入力してください」
  - `-` で始まる: 「`-` で始まる名前は使用できません」
  - 既存のローカルブランチ名と一致する: 「同じ名前のブランチが既に存在します」
  - 既存のローカルブランチと階層が衝突する（`main` に対する `main/sub`、`feature/x` に対する `feature`）: 「既存のブランチ <衝突するブランチ名> と名前が衝突します」（refs/heads 配下はディレクトリ構造のため共存できず、git は英語の `cannot lock ref` エラーで失敗するため。レビュー指摘で追加）
  - `@` のみの名前: 「この名前は使用できません」（`git checkout @` が HEAD と解釈され、作成後に
    切り替えられないため）
- それ以外の形式上の検証（`..`、空白、`~^:?*[\`、末尾の `.lock` 等）は main 側の
  `git check-ref-format --branch` に任せ、失敗した場合は `branchOperationError` のバナーに表示する

### ブランチの削除

- 現在ブランチ以外の各行の右端に削除ボタン（🗑、`aria-label="ブランチ <name> を削除"`）を置く
- 押すと確認ダイアログ「ブランチ <name> を削除しますか？」を出す。キャンセルなら何もしない
- 承諾されたら安全削除（`git branch -d`）を実行する
  - 成功: 完了。ブランチ一覧を再取得する
  - 未マージで失敗: 2回目の確認「ブランチ <name> にはマージされていないコミットがあります。
    強制削除するとこれらのコミットは失われます。削除しますか？」を出す。承諾されたら強制削除
    （`git branch -D`）を実行する。キャンセルならブランチを残し、エラーは表示せずに終わる
  - その他の失敗: `branchOperationError` のバナーに表示する
- 現在ブランチは削除できない（ボタンを表示しない。main 側でも拒否する）

### 実行中・他操作中の表示

- トリガーボタンの表示テキストと `aria-label` は、実行中の操作に応じて切り替える

| 状態                    | 表示テキスト   | `aria-label`                                                     |
| ----------------------- | -------------- | ---------------------------------------------------------------- |
| checkout 実行中         | 切り替え中...  | ブランチ切り替え中                                               |
| 作成実行中              | 作成中...      | ブランチ作成中                                                   |
| 削除実行中              | 削除中...      | ブランチ削除中                                                   |
| 他操作中（`isBlocked`） | 現在ブランチ名 | 他の操作が完了するまでブランチを切り替えられません（既存のまま） |
| 通常                    | 現在ブランチ名 | ブランチを切り替え（既存のまま）                                 |

- ブランチ操作の実行中・他操作中はトリガーボタンが disabled になるため、メニューは開けない
  （既存の挙動を踏襲）

### キーボード操作・アクセシビリティ

- 作成ボタンは radiogroup の外（メニューの先頭）に置き、通常の Tab 停止点にする
- 削除ボタンは `tabIndex={-1}` とし、roving tabindex（radiogroup 内の Tab 停止点は1つ）を崩さない
- キーボードでは、ブランチ（radio）にフォーカスした状態で `Delete` キーを押すと、そのブランチの
  削除ボタンと同じ処理を行う。radio には `aria-keyshortcuts="Delete"` を付ける。現在ブランチの
  radio は disabled でフォーカスできないため、`Delete` キーが現在ブランチに対して発火することはない
- 削除ボタンのタップ領域は 32px × 32px 以上を確保する
- メニューを開いたときの初期フォーカスは、既存の「先頭の選択可能なブランチ」を維持する。選択可能な
  ブランチが1つも無い場合（ブランチが現在ブランチだけ）は、作成ボタンへフォーカスする
- 名前入力ダイアログを閉じたとき（OK・キャンセル・Escape・オーバーレイクリックのいずれも）は、
  トリガーボタンへフォーカスを戻す
- 削除の確認ダイアログを閉じたあとは、メニューが閉じてトリガーボタンへフォーカスを戻す

### エラーハンドリング

- main 側のエラーはすべて日本語メッセージにして投げ、既存の `branchOperationError` バナーに表示する
  - 名前が `-` で始まる: 「`-` で始まるブランチ名は使用できません: <name>」
  - `git check-ref-format --branch` で不正: 「ブランチ名として使用できない名前です: <name>」
  - 同名ブランチが既に存在する: 「同じ名前のブランチが既に存在します: <name>」
  - 既存ブランチと階層が衝突する: 「既存のブランチ <衝突するブランチ名> と名前が衝突します: <name>」（判定は `@shared/branchName` の `findConflictingBranchName` を main/renderer で共有）
  - 削除対象が存在しない: 「存在しないブランチです: <name>」（既存の checkout と同じ文言）
  - 削除対象が現在ブランチ: 「現在のブランチは削除できません: <name>」
  - 削除対象が別の worktree で使用中: 「他のワークツリーで使用中のブランチは削除できません: <name>」
- 未マージは例外ではなく戻り値で返す（下記の型定義）。git のエラーメッセージ文字列で判定しない
- 作成・削除の成功時は `branchOperationError` をクリアする（既存の `useRunExclusiveGitOperation` の挙動）

## アーキテクチャ

### main プロセス（`src/main/gitService.ts`）

- `createBranch(folderPath: string, branchName: string): Promise<void>`
  1. `branchName` が `-` で始まれば拒否する（`check-ref-format` に渡す前に弾く。引数インジェクション対策）。
     続けて `branchName` が `@` のみなら「ブランチ名として使用できない名前です: @」で拒否する
     （`check-ref-format --branch @` は `@` のまま成功するが、`checkoutBranch` が実行する
     `git checkout @` は `@` をブランチ名ではなく HEAD の別名として解釈し、exit 0 のまま
     何もせず現在のブランチに留まってしまうため、check-ref-format の検証だけでは弾けない）
  2. `git check-ref-format --branch <branchName>` で検証する。失敗したら日本語エラーに変換する。
     成功時の出力（正規化後の名前）が入力と一致しない場合も拒否する（`--branch` は `@{-1}` の
     ような「直前のブランチ」記法を実在のブランチ名へ展開して成功扱いにするため）
  3. `branchLocal()` の一覧に同名、または階層が衝突する既存ブランチ（`main` に対する `main/sub` 等。`@shared/branchName` の `findConflictingBranchName` で判定）があれば拒否する
  4. `checkout -b <branchName>`（`checkoutLocalBranch`）を実行する
- `deleteBranch(folderPath: string, branchName: string, force: boolean): Promise<DeleteBranchResult>`
  1. `branchLocal()` の一覧に無ければ拒否する（許可リスト。checkout と同じ方式）
  2. 現在ブランチなら拒否する
  3. 別の worktree でチェックアウトされているブランチなら拒否する（`git worktree list --porcelain`
     の `branch refs/heads/<name>` 行で判定）。エラー文言は「他のワークツリーで使用中のブランチは
     削除できません: <name>」
  4. `force` が false なら、削除の前にマージ済みかを自分で判定する。未マージなら削除せずに
     `{ deleted: false, reason: 'not-fully-merged' }` を返す
  5. `branch -d`（`force` が false）または `branch -D`（`force` が true）を実行する
- マージ済み判定は git 本体の `branch -d` と同じ基準にする: 対象ブランチに upstream が設定され、
  その ref が実在すればそれを、そうでなければ HEAD を基準にし、対象ブランチがその基準に含まれて
  いればマージ済みとする。コマンドは次の3つで、いずれも出力の有無だけで判定できロケールに
  依存しない
  - upstream の取得: `git for-each-ref --format=%(upstream) refs/heads/<name>`（無ければ空）
  - upstream の実在確認: `git rev-parse --verify --quiet <upstream>`（無ければ空、エラーにならない）
  - 判定: `git for-each-ref --merged=<基準> --format=%(refname) refs/heads/<name>`
    （マージ済みなら `refs/heads/<name>` が出力され、未マージなら空）
- 削除失敗のエラーから未マージを判定しない理由（2026-09-29 に simple-git 3.36.0 の実ソースと
  git 2.50.1 の実機で確認）
  - simple-git の `deleteLocalBranch` は、git の出力が `^error[^']+'<name>'` という英語の形式の
    ときだけ `GitResponseError` に変換する。日本語化された git ではこの変換が起きない
  - ロケールを固定するには `env()` が必要だが、`getLog` のコメントにあるとおり
    `blockUnsafeOperationsPlugin` の地雷を踏むため使えない
  - 別の worktree で使用中のブランチの削除失敗（`error: cannot delete branch '<name>' used by
worktree at ...`）も同じ形式になり、未マージと区別できない。手順3の事前チェックが必要な理由
- 事前チェックと削除の間に状態が変わる競合（別プロセスが同時にマージ・worktree 追加を行う）は
  対象外とする。その場合は git 自身が削除を拒否し、そのエラーがバナーに表示されるだけで、データは
  失われない
- いずれもネットワーク I/O を伴わないため、push/pull/fetch のタイムアウト処理は不要

### IPC（`src/main/handlers/gitHandlers.ts`）

- `git:createBranch`（引数 `branchName: string`）
- `git:deleteBranch`（引数 `branchName: string, force: boolean`）
- 既存の `git:checkoutBranch` と同じく、許可済みフォルダを解決して service を呼ぶ。引数の型検証
  （`string` / `boolean` であること）はハンドラーで行う

### preload / renderer lib

- `src/preload/api.ts` / `src/preload/index.d.ts`: `createBranch`、`deleteBranch` を追加する
- `src/renderer/src/lib/gitApi.ts`: 同名のラッパーを追加する

### renderer フック（`src/renderer/src/hooks/useGitBranchOperations.ts`）

- 実行中状態を `isCheckingOut: boolean` から
  `pendingBranchOperation: 'checkout' | 'create' | 'delete' | null` に一般化する。
  ブランチ操作どうし（checkout / 作成 / 削除）は1つの busy ref で相互に排他にする
  - 既存の `isCheckingOut` の利用箇所は `pendingBranchOperation` に置き換える
- `createBranch(branchName: string): Promise<boolean>`
  - HEAD の参照先を変えるため、checkout と同じく `isBusy` に `lock.isAnyLocked()` を含め、
    `onStart: lock.lockGlobal` / `onEnd: lock.unlockGlobal` でロックを取る。これにより、
    作成中の push（新しい HEAD がどのブランチを指すか確定する前に読むレース）が既存の
    push 側の判定で自動的に防がれる
- `deleteBranch(branchName: string): Promise<boolean>`
  - 確認関数はフックのオプションで差し込む（`{ onConfirm = confirm }`。CLAUDE.md の
    「デフォルト引数の参照安定性」ルールに従い、ラッパーではなく `confirm` を直接渡す）
  - 流れ: 1回目の確認 → 安全削除 → `not-fully-merged` なら2回目の確認 → 強制削除
  - 2回の削除実行（安全 → 強制）の間で busy を解除せず、1つの排他実行の中で完結させる
    （間に他の操作が割り込まないようにするため）
  - `isBusy` には checkout と同じく `lock.isAnyLocked()` を含める（他操作中は待つ）が、
    `lockGlobal` は取らない。削除するのは現在ではないブランチの ref だけで、working tree・
    index・HEAD には触れないため、実行中に push/pull が始まっても読み取り対象に影響しない。
    この判断理由はコードコメントに残す（`docs/review-findings-patterns.md` パターン23）
  - 戻り値は「ブランチが実際に削除されたか」。1回目・2回目のキャンセル、no-op、失敗はいずれも false
- 作成・削除とも、成功後は既存と同じく `refreshGitStatus` と `refreshHistory`（ブランチ一覧）を並行実行する

### renderer コンポーネント

- `NameInputDialog`（`src/renderer/src/components/explorer/`）
  - 任意の `validate?: (name: string) => string | null` を追加する。省略時は従来のファイル名検証
    （`isSafeEntryName`）を使うため、既存の呼び出し元は変更不要
- `BranchSwitcherMenu`
  - Props に `onCreateRequest: () => void` と `onDelete: (branchName: string) => void` を追加する
  - メニュー先頭に作成ボタン、各行（現在ブランチ以外）に削除ボタンを描画する
  - radio の `onKeyDown` で `Delete` キーを処理する
  - 作成ボタン・削除ボタンのクリックは、`document` の外側クリック判定で `onClose(false)` が
    重ねて呼ばれても害が無いこと（既に閉じる処理と競合しないこと）をテストで確認する
- `BranchSwitcher`
  - 名前入力ダイアログの開閉状態を持つ。作成ボタンでメニューを閉じてダイアログを開き、
    ダイアログを閉じたらトリガーへフォーカスを戻す
  - 削除はメニューを閉じてトリガーへフォーカスを戻してから `onDeleteBranch` を呼ぶ
    （確認ダイアログはフック側で出す）
  - Props: `isCheckingOut` を `pendingBranchOperation` に置き換え、`onCreateBranch` /
    `onDeleteBranch` を追加する
- `GitRepoView` / `SourceControlPanel` / `Sidebar` / `App`: 新しい Props を配線する

### 型定義（`src/shared/types.ts`）

```ts
export type DeleteBranchResult = { deleted: true } | { deleted: false; reason: 'not-fully-merged' }
```

## テスト方針

- `gitService.test.ts`
  - `createBranch`: `-` 始まりの拒否、`check-ref-format` 失敗時の日本語エラー、同名の拒否、階層が衝突する名前の拒否（両方向）、
    正常時に `checkout -b` 相当が呼ばれること、検証失敗時は `checkout` が呼ばれないこと
  - `deleteBranch`: 実在しない名前・現在ブランチ・別 worktree で使用中の拒否、`force` による
    `-d` / `-D` の切り替え、マージ判定の基準（upstream が実在すれば upstream、無い・消えていれば
    HEAD）、未マージ時に削除を呼ばず `{ deleted: false, reason: 'not-fully-merged' }` を返すこと、
    `force` が true のときはマージ判定をしないこと、削除コマンドの失敗は例外になること
  - 上記のコマンド出力の前提（空出力の意味、`check-ref-format` の `@{-1}` 展開）は、一時ディレクトリの
    実リポジトリで一度確認してからモックの戻り値に落とし込む
- `gitHandlers.test.ts` / `api.test.ts`: 引数の型検証と配線
- `useGitBranchOperations.test.ts`
  - 作成: 排他、`lockGlobal` を取ること、成功時の再取得
  - 削除: 1回目キャンセル（削除 API を呼ばない）、安全削除成功、未マージ → 2回目キャンセル
    （強制削除を呼ばない・エラーなし）、未マージ → 強制削除、`lockGlobal` を取らないこと、
    安全削除と強制削除の間で busy が解除されないこと
  - checkout / 作成 / 削除の相互排他
  - ガード条件ごとの検証は、他の条件が偶然真にならないモックロックで行う（パターン16）
- `NameInputDialog.test.tsx`: `validate` 指定時にそれが使われること、省略時は従来の検証のままであること
- `BranchSwitcherMenu.test.tsx` / `BranchSwitcher.test.tsx`
  - 作成ボタン → ダイアログ表示 → OK / キャンセルでトリガーへフォーカスが戻ること
  - 現在ブランチの行に削除ボタンが無いこと、削除ボタンの `aria-label`
  - `Delete` キーで削除が呼ばれること
  - ブランチが現在ブランチだけのとき、初期フォーカスが作成ボタンになること
  - 実行中の表示テキストと `aria-label` の同期（`getByRole('button', { name })` で検証）
- 各修正は TDD で行い、実装を戻すと該当テストが落ちることを確認する
- Electron 実機で、作成・安全削除・未マージの強制削除・2回目キャンセルを確認する

## 実装順序

1. 型定義と `gitService` の `createBranch` / `deleteBranch`（`simple-git` の挙動確認を含む）
2. IPC ハンドラー・preload・`gitApi`
3. `useGitBranchOperations` の一般化（`pendingBranchOperation`）と作成・削除
4. `NameInputDialog` の `validate` 追加
5. `BranchSwitcherMenu` / `BranchSwitcher` の UI と配線
6. ROADMAP の更新（「ブランチの作成・削除」を実装済みへ移し、未実装側は「ブランチのマージ」に絞る）

## 実装後のリファクタリング（単一責任への分割）

実装完了後、origin/main からの変更箇所を単一責任の観点で見直し、次のように分割した。
振る舞いは変えていない（worktree 一覧の CRLF 対応と、空文字の事前拒否を除く）。

| 分割先                                                                   | 責務                                                                                                                                                                            | 分割元                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/shared/branchName.ts`                                               | アプリ独自のブランチ名規則（空文字・`-` 始まり・`@` のみ）を違反の種類として返す。既存ブランチとの階層衝突の検出（`findConflictingBranchName`）も持つ。文言への変換は呼び出し側 | main の `createBranch` と renderer の `validateBranchName` に重複していた判定 |
| `src/main/gitWorktreeParser.ts`                                          | `git worktree list --porcelain` の出力からチェックアウト中のブランチ名を集める（純粋関数。CRLF にも対応）                                                                       | `gitService.deleteBranch` 内の git 呼び出しと一体だった解析                   |
| `gitService.ts` の `assertCreatableBranchName` / `assertDeletableBranch` | 作成・削除できるかの検証だけを担う。`createBranch` / `deleteBranch` は検証と実行を順に呼ぶだけにした                                                                            | `createBranch` / `deleteBranch`                                               |
| `gitHandlers.ts` の `assertBranchNameArg` / `assertForceFlagArg`         | IPC 引数の型検証                                                                                                                                                                | 2つのハンドラーに重複していた `typeof` 判定                                   |
| `src/renderer/src/lib/branchDeletion.ts`                                 | 安全削除 → 未マージなら強制削除の確認 → 強制削除、の手順と確認文言                                                                                                              | `useGitBranchOperations.deleteBranch`                                         |
| `useGitBranchOperations.ts` の `isBranchOperationBusy`                   | checkout/作成/削除に共通の開始条件                                                                                                                                              | 3か所に重複していた `isBusy` の式                                             |
| `src/renderer/src/lib/branchTriggerLabel.ts`                             | 状態からトリガーの表示テキストと `aria-label` を決める                                                                                                                          | `BranchSwitcher`                                                              |
| `CreateBranchDialog.tsx`                                                 | `NameInputDialog` にブランチ名用の検証を差し込む                                                                                                                                | `BranchSwitcher`                                                              |
| `BranchMenuItem.tsx`                                                     | ブランチ一覧の1行（radio・削除ボタン・`Delete` キー）                                                                                                                           | `BranchSwitcherMenu`                                                          |
| `src/renderer/src/types.ts` の `BranchOperationKind`                     | フックと表示側（lib）の双方が使う型                                                                                                                                             | `useGitBranchOperations.ts`                                                   |
