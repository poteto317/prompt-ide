# prompt-ide

prompt-ide は、ファイルの閲覧・編集、プロンプトの管理、エージェント CLI の実行、Git の操作を 1 つにまとめた
Electron + React + TypeScript 製のデスクトップアプリです。別のアプリやブラウザを開かずに、
「ファイルを編集する → プロンプトを実行する → Git で確かめる」という開発の流れを完結させることを目指しています。

実装済みの機能と今後の候補は [ROADMAP.md](ROADMAP.md) にまとめています。

## 主な機能

- **エクスプローラー・エディタ**: フォルダを開いてファイルツリーを表示し、Monaco エディタで編集・保存します。複数タブ、クイックオープン（Ctrl/Cmd+P）、外部での変更の検知に対応しています。エクスプローラーの上部から、エージェントの指示ファイル（`CLAUDE.md`・`AGENTS.md` など）を開く・雛形で作ることもできます。
- **プロンプト管理**: プロンプトの追加・編集・タグ付け・並び替え・インポート/エクスポート、`{{variable}}` 形式の変数の差し込みを扱えます。一覧の最上部のトグルで「表示モード」にすると、`編集`・`削除` を表示しなくなり、誤タップを防げます（設定として保存。`実行`・追加などは両方のモードで使えます）。
- **実行履歴**: 実行したプロンプトを保存し、再表示・再実行や、エージェントのセッションの再開ができます（アクティビティバーの「実行履歴」）。
- **進捗管理**: タスクごとに開発のステージ（プラン作成・実装・リファクタ・ローカルレビュー・コミット・PR 作成・PR レビュー・PR マージ）の進み具合と履歴を記録します（アクティビティバーの「進捗管理」）。
- **エージェント CLI の実行（既定の実行方式）**: エディタの領域の下部のターミナル（xterm.js + node-pty）で、開いているフォルダを作業ディレクトリにして
  Claude Code（`claude`）または GitHub Copilot CLI（`copilot`）を起動し、登録したプロンプトを入力欄へ送ります。複数セッション、状態の表示、
  完了・許可待ちの通知、中断、許可の確認への帯の 許可・拒否 での答え、セッションの再開に対応しています。
- **エージェントの変更の確認**: エージェントが変更したファイルを実行ごとに記録して一覧にし、差分の確認・戻す操作・戻した操作の取り消しができます。
  `claude`・`copilot` の hooks を使って、利用者自身の編集と区別します。
- **ソース管理**: 変更の一覧と差分、ステージ・コミット・amend、ブランチ・マージ・stash・タグ、push / pull / fetch、clone、コンフリクトの解決などを行えます。
- **従来の実行方式**: 設定の「プロンプトの実行方式」で、Anthropic API を直接呼ぶ方式や非対話の CLI を呼ぶ方式（テキスト生成型の旧方式）に切り替えられます。API キーは Electron の safeStorage で暗号化して保存します。

## 必要な環境

- Node.js と npm
- エージェント CLI 方式を使う場合は、`claude` または `copilot` のどちらかをインストールしておきます。GUI から起動した場合も、ログインシェルの `PATH`（nvm などの配下を含む）から探します。
- 従来の API 方式を使う場合は、Anthropic の API キーを設定画面で登録します。

## セットアップと起動

```bash
npm install      # 依存パッケージのインストール（node-pty などのネイティブモジュールもビルドされます）
npm run dev      # 開発モードで起動
```

## 開発用のコマンド

| コマンド                                          | 内容                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm test`                                        | Vitest でテストを 1 回実行する                                                          |
| `npm run test:watch`                              | Vitest を監視モードで実行する                                                           |
| `npm run test:coverage`                           | カバレッジを計測する（結果は `coverage/`）                                              |
| `npm run typecheck`                               | main・preload（`tsconfig.node.json`）と renderer（`tsconfig.web.json`）を型チェックする |
| `npm run lint`                                    | ESLint を実行する                                                                       |
| `npm run format`                                  | Prettier で整形する                                                                     |
| `npm run build`                                   | 型チェックしてから electron-vite でビルドする                                           |
| `npm run build:mac` / `build:win` / `build:linux` | 各 OS 向けのパッケージを electron-builder で作る                                        |

変更を加えたら、`npm test`・`npm run typecheck`・`npm run lint` がすべて通ることを確認してください(初めての方は [docs/developer-guide.md](docs/developer-guide.md) も参照してください)。lint はエラーだけでなく警告も 0 件の状態を保っています（`npx eslint . --max-warnings 0` で確かめられます）。Prettier の整形の崩れも ESLint の警告として出ます。
実機（Electron）で確認する項目は [docs/manual-test-spec.md](docs/manual-test-spec.md) にまとめています（`node scripts/build-manual-test-spec.mjs` でチェック付きの HTML を生成できます）。

## ディレクトリ構成と主要なモジュール

```text
src/
├── main/        Electron の main プロセス（Node.js 側）
├── preload/     renderer へ公開する API（contextBridge）
├── renderer/    React の画面（renderer プロセス）
└── shared/      main と renderer の両方から使う型と純粋な関数
scripts/         実機テスト仕様書の HTML の生成などの補助スクリプト
docs/            実機テスト仕様書・レビューの運用手順・設計書と実装プラン
```

### main（`src/main/`）

- `index.ts`: ウィンドウの作成と、遷移・新しいウィンドウを開く操作の制限。
- `ipcHandlers.ts`: 依存の組み立ての起点（composition root）。各機能の IPC ハンドラ・寿命の管理（フォルダの切り替え・ウィンドウの破棄・アプリの終了での後始末）を、同じ `FolderAccessManager` などを共有させてつなぎます。
- `handlers/`: IPC の受け口。`*PayloadParser.ts` と `payloadValidators.ts` で renderer からの入力を検証し、`ipcSenderGuard.ts` で送信元のフレームを確かめてから処理に渡します。
  - `gitHandlers.ts`・`gitPayloadParser.ts`: Git の受け口は領域ごとの `registerGit*Handlers` に分かれます。引数の検証は `gitPayloadParser.ts` の `assert*Arg` 関数に置きます。
- `folderAccessManager.ts`・`traversalPolicy.ts`・`handlers/fileAccessGuard.ts`: ウィンドウごとに開いているフォルダを持ち、その外へのアクセス（パストラバーサル）を防ぎます。
- `agentSession*.ts`・`agentCommand.ts`・`agentCliLaunchSpecs.ts`: エージェント CLI のセッションの起動・停止と、CLI の種類ごとの起動の規則。
- `agentRuntime.ts`・`agentHooksRuntime.ts`: 実物の依存（node-pty・ログインシェル・プロセスの停止・hooks の受け口）を組み立てるモジュール。テストではモジュールごと差し替えます。
- `agentBaseline*.ts`・`agentChanges*.ts`: エージェントの変更の記録・一覧・戻す操作・戻した操作の取り消し。
  - `agentBaselineRegistry.ts`: ウィンドウごとの記録の持ち主。記録の開始・実行の追加・破棄・取り消しの控えと、利用者の変更との区別の同期を、所有者ごとの列に並べて直列に行います。
  - `agentBaselineProtectionSync.ts`: 記録の tree を git の gc から守る ref の 1 回の同期(あるべき値の算出・作成/更新/削除・失敗後の読み直しの分類・残った ref の掃除)と、アプリの終了時の同期の削除。いつ同期を並べるかは `agentBaselineRegistry.ts` が決めます。
- `git*.ts`: simple-git などを使った Git の操作。
- `fsErrors.ts`・`errorMessage.ts`: fs のエラーの判定と、投げられた値から説明の文言を取り出す共通の関数。
- `jsonCollectionStore.ts`: `userData` 配下の JSON 配列のファイル(プロンプト・進捗・実行履歴)を読み書きする汎用のストア。読み込みでは各要素を検証(`isValid`)して作り直し(`sanitize`)、書き込みは直列化します。保存の形が結果の型より緩い(古い形式の欠けたフィールドを許す)ときは、2 つ目の型引数 `Stored` で表します(例: `historyStore.ts`)。

### shared（`src/shared/`）

- `types/`: main・preload・renderer が共有する型と、`as const` の候補の一覧・その判定の関数。
- `typeGuards.ts`: 外部入力(保存ファイル・IPC の payload・hooks の本文)を `unknown` から絞り込む共通の型ガード(`isObjectLike`・`isPlainObject`・`isOneOf`)。`as` のキャストで検証を済ませたことにしないために使います。

### preload（`src/preload/`）

- `api.ts`: renderer に公開する API の一覧。汎用の IPC は公開せず、用途ごとの関数だけを `window.api` として渡します。

### renderer（`src/renderer/src/`）

- `App.tsx`: アクティビティバー・サイドバー・エディタパネル・ステータスバーの全体のレイアウト。
- `components/`: 画面の部品。`explorer/`・`editor/`・`prompts/`・`source-control/`・`agent/`（エージェントのターミナルとタブ）・`settings/` など、パネルごとに分けています。
- `hooks/`: 状態と副作用を持つカスタム hook。
  - `useFileSystem.ts`: 開いているフォルダ・ファイルツリー・エディタのタブの状態の持ち主。フォルダの走査、タブの開閉・切り替え、外部の変更の反映を、読み込みの世代と同期のミラー(ref)で競合させずに行います。保存は `useFileEditing.ts`、ファイルの作成・リネーム・削除は `useFileTreeOperations.ts` に任せます。
  - `useSavedSetting.ts`: 選択式の設定(実行方式・エージェント CLI・プロンプト一覧のモード)の読み込みと保存。変更は楽観的に反映し、保存に失敗したら変更の前の値へ戻します。保存の途中の変更は止めないので、連打が起こる使い手(`usePromptListMode`)は自分で止めてから使います。真偽値の設定は `useBooleanSetting.ts` が受け持ちます。
- `lib/`: 画面に依存しないロジック（IPC の呼び出しの薄い包み、状態遷移、文言の組み立てなど）。
  - `openTabs.ts`: タブの配列を扱う純粋な関数(パスでタブを探す・アクティブなタブが消えたときの移り先を選ぶ・タブをディスクの内容に置き換える)。
  - `openedFileSignal.ts`: 「ファイルを開いた」信号(`OpenedFileSignal`)の型と、同じパスを畳んで件数の上限で切りながらイベントを足す関数。クイックオープンの履歴とエディタへのフォーカスの移動が使います。
  - `readFileAfterPendingSaves.ts`: ファイルを開くときに、同じファイルの保存の完了を待ち、読む間に保存が完了したら読み直す(上限 `MAX_READ_RETRIES` 回)処理。
- `config/`: アクティビティバーのパネル・進捗管理のステージなどの定義。

コードの書き方:

- 関数には戻り値の型を書きます（ESLint の `explicit-function-return-type`。renderer に限らず、main・preload・テストを含むすべての `.ts`・`.tsx` に効きます）。renderer のコンポーネントは `React.JSX.Element`（何も描画しないことがあれば `React.JSX.Element | null`）とします。`React` の名前空間はインポートせずに使えます。
- effect の中で同期的に setState を呼ぶと、`react-hooks/set-state-in-effect` のエラーになります。読み込みやリセットの処理はフック本体の外の関数に置き、setter を引数で渡して effect から呼びます（例: `hooks/useGitHistory.ts` の `fetchGitHistoryData`、`hooks/useGitStatus.ts` の `fetchGitStatus`）。

### テスト

- テストは対象と同じ階層の `__tests__/` に置きます（`*.test.ts` / `*.test.tsx`）。テストの環境は `vitest.config.ts` で設定しています。既定は jsdom です。`environmentMatchGlobs` で `src/main/**` に Node を指定していますが、Vitest 4 ではこの設定が効かないため、現状は `src/main/**` のテストも jsdom で動きます（main のテストでも `window` が定義されています）。
- 複数のモジュールをまたぐ流れを、実物の依存(実ファイル・実 git など)を使って確かめるテストは `*.integration.test.ts(x)` と名付けます。例えば `src/main/__tests__/persistenceRoundTrip.integration.test.ts` は IPC ハンドラ → ストア → 実ファイルの保存と読み込みの往復を、`src/renderer/src/components/progress/__tests__/ProgressPanel.persistence.integration.test.tsx` は進捗管理の画面の操作 → 状態の更新 → 表示 → 保存 → 読み込みを確かめます。
- テストで一時ディレクトリを再帰的に消すときは、`src/shared/__tests__/helpers/tempDirGuard.ts` の `removeTempPathSync`・`removeTempPath` を使います（素の再帰削除は ESLint で検出します）。

## ドキュメント

- [docs/developer-guide.md](docs/developer-guide.md): 新しく参加する開発者向けのガイド(セットアップ・主要な流れ・テストの書き方・よくある落とし穴)
- [ROADMAP.md](ROADMAP.md): 実装済みの機能と今後の候補
- [docs/manual-test-spec.md](docs/manual-test-spec.md): 実機テスト仕様書
- [docs/review-findings-patterns.md](docs/review-findings-patterns.md): レビューの指摘から得た実装のパターンと教訓
- [docs/pr-review-loop.md](docs/pr-review-loop.md): PR のレビュー対応の手順
- `docs/superpowers/specs/`・`docs/superpowers/plans/`: 機能ごとの設計書と実装プラン
