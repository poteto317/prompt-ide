# prompt-ide 開発者ガイド

新しく参加する開発者が、環境を作ってから最初の変更を検証し終えるまでに必要なことをまとめる。
機能の一覧は [README.md](../README.md)、実装済みの機能と今後の候補は [ROADMAP.md](../ROADMAP.md)、
作業の進め方(コミット・PR・レビュー対応)のルールはリポジトリ直下の `CLAUDE.md` を参照する。

## 1. セットアップ

### 必要なもの

- Node.js と npm(`package.json` の依存は npm で入れる。`package-lock.json` があるので `npm install` を使う)
- エージェント CLI 方式を実機で試す場合は `claude`(Claude Code)か `copilot`(GitHub Copilot CLI)。テストには不要
- 従来の API 方式を実機で試す場合は Anthropic の API キー(設定画面で登録する)。テストには不要

### 初回の手順

```bash
npm install   # postinstall で electron-builder install-app-deps が走り、node-pty などのネイティブモジュールを Electron 向けにビルドする
npm run dev   # electron-vite の開発モードで起動する
```

- `npm install` でネイティブモジュールのビルドが失敗したら、C/C++ のビルド環境(macOS なら Xcode Command Line Tools)を確かめる。
- テスト(Vitest)は Electron ではなく Node.js の上で動く。`electron` モジュールは各テストで `vi.mock('electron', ...)` で差し替える。

### 検証のコマンド

変更を加えたら、次をすべて通す。`verify` のような一括のスクリプトは無いので、順に実行する。

| コマンド                        | 内容                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `npm test`                      | Vitest でテストを 1 回実行する(600 ファイル余りあり、数分かかる)                    |
| `npm run typecheck`             | main・preload(`tsconfig.node.json`)と renderer(`tsconfig.web.json`)を型チェックする |
| `npx eslint . --max-warnings 0` | ESLint。警告も 0 件に保つ(Prettier の整形の崩れも警告として出る)                    |
| `npm run build`                 | 型チェックしてから electron-vite でビルドする(出力は `out/`)                        |
| `npx vitest run scripts`        | 実機テスト仕様書(`docs/manual-test-spec.md`)を変えたときの書式・ID の検査           |

1 ファイルだけ試すときは `npx vitest run <パス>`、整形の崩れを直すときは `npx prettier --write <パス>` を使う
(`npm run format` はリポジトリ全体を書き換えるので、変更していないファイルまで差分が出ないよう注意する)。

## 2. 全体の構成

```text
src/
├── main/        Electron の main プロセス(Node.js 側。ファイル・Git・pty・設定の保存)
├── preload/     renderer へ公開する API(contextBridge。window.api)
├── renderer/    React の画面(renderer プロセス)
└── shared/      main・preload・renderer が共有する型と純粋な関数
```

- パスの別名は `@shared/*`(全プロセス)と `@renderer/*`(renderer)。`tsconfig.*.json` と `vitest.config.ts` の両方に定義がある。
- renderer は Node.js の API を直接使わない。ファイル・Git・設定などはすべて IPC を通して main に頼む。
- 主要なモジュールの説明は README の「ディレクトリ構成と主要なモジュール」にある。

## 3. 主要な流れ

### 3.1 renderer → main の呼び出し(IPC)

プロンプトの保存を例にすると、呼び出しは次の順に進む。

1. **renderer の hook**(`hooks/usePromptsPersistence.ts` など)が `lib/promptsApi.ts` の `savePrompts(prompts)` を呼ぶ。
   hook やコンポーネントは `window.api` を直接触らず、`lib/*Api.ts` の薄い包みを通す(テストでモジュールごと差し替えやすくするため)。
2. **preload**(`src/preload/api.ts`)が `ipcRenderer.invoke('prompts:save', prompts)` を呼ぶ。汎用の IPC は公開せず、
   用途ごとの関数だけを `window.api` として渡す。型は `src/preload/index.d.ts` の `Window['api']` に書く。
3. **main の受け口**(`src/main/handlers/promptsHandlers.ts`)が `ipcMain.handle('prompts:save', ...)` で受ける。
   renderer からの値は信用せず `unknown` として受け、検証してから使う(下の「外部入力の扱い」)。
4. **ストア・サービス**(`src/main/promptStore.ts` など)がファイルや Git を操作し、結果を返す。
   例外は `ipcMain.handle` を通して renderer 側の Promise の拒否になる。

受け口の登録は `src/main/ipcHandlers.ts`(composition root)にまとまっている。フォルダへのアクセスを伴う受け口は
`FolderAccessManager` を共有し、開いているフォルダの外へのアクセスを `handlers/fileAccessGuard.ts` で拒む。

Git の受け口(`handlers/gitHandlers.ts`)は、領域ごとの `registerGit*Handlers`(作業ツリー・コンフリクト・履歴・ブランチ・stash・リモート)に
分かれており、`registerGitHandlers` がそれらをまとめて登録する。renderer から受ける引数の検証は `handlers/gitPayloadParser.ts` の
`assert*Arg` 関数にまとめてあり、検証が要る受け口はこれを通してから Git の操作へ渡す。一部の受け口(`git:commit`・`git:amendCommit`・
`git:getLog`・`git:checkoutBranch` など)は引数を型注釈だけで受けており、`assert*Arg` を通らない。

### 3.2 main → renderer の通知

ストリーミングの出力(`prompt:streamChunk`)・エージェントの端末の出力(`agentTerminal:data`)・外部でのファイルの変更
(`fs:externalChange`)などは、main から renderer へ送る。送り先のウィンドウが破棄済みのときに例外を出さないよう、
`safeWebContentsSend.ts` の `sendToOwner` などを通す(呼び出し元の応答の中で送るストリーミングは `handlers/streamDelivery.ts`)。
preload の `on*` 関数(`onAgentData` など)が
payload を検証してからリスナーを呼び、購読の解除関数を返す。形の合わない payload は黙って捨てる
(テストは `src/preload/__tests__/api.test.ts`)。

### 3.3 データの保存

| 保存先(`userData` 配下) | 担当                                                                       | 読み込みの検証                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `prompts.json`          | `promptStore.ts`(`jsonCollectionStore.ts` を使う)                          | `promptUtils.ts` の `isValidPrompt`・`sanitizePrompt`                                                                         |
| `progress.json`         | `progressStore.ts`(同上。古い形式は `migrate` でステージを補う)            | `progressValidation.ts`・`progressSanitize.ts`                                                                                |
| `history.json`          | `historyStore.ts`(同上)                                                    | `historyUtils.ts`。古い形式(`agent`・`agent.cliKind` が無い)は `StoredHistoryEntry` として受け、`sanitizeHistoryEntry` で補う |
| `settings.json`         | `settingsFileStore.ts`(API キー・モデル・実行方式などが同じファイルを共有) | ファイル全体は「普通のオブジェクト」かだけを見る。各フィールドは読む側のストア(`modelSettingsStore.ts` など)が検証する        |

- `jsonCollectionStore` は、ファイルが無ければ空配列、配列でなければ空配列、各要素は `isValid` で絞り込んで `sanitize` で作り直す。
  壊れた JSON(`SyntaxError`)や `ENOENT` 以外の読み込みの失敗は投げる。書き込みは `WriteQueue` で直列化し、先の書き込みが失敗しても次は止めない。
- `settings.json` は一時ファイルへ書いてから rename で置き換える(書きかけを読まない)。読み書きの失敗は、パスや中身
  (API キーの暗号文を含みうる)を画面に出さないよう、固定の文言の `SettingsFileError` にして投げ直す。元の例外は `console.error` にだけ残す。

### 3.4 エージェント CLI 方式

エディタの下部のターミナル(xterm.js + node-pty)で `claude`・`copilot` を起動し、登録したプロンプトを入力欄へ送る。
main 側は `agentSession*.ts`(起動・停止)・`agentHook*.ts`(CLI の hooks を受ける HTTP の受け口)・`agentBaseline*.ts`/
`agentChanges*.ts`(変更の記録と戻す操作)、renderer 側は `hooks/useAgent*.ts` と `lib/agent*.ts` が担う。
CLI の種類ごとの違いは表(`src/shared/agentCliKinds.ts`・`src/main/agentCliLaunchSpecs.ts`・`renderer/src/lib/agentPromptSendSpecs.ts`)に
まとめてあり、種類を足すときは表に行を足す。設計の経緯は `docs/superpowers/specs/` の設計書にある。

### 3.5 設定の読み書きのフック

設定画面の値は、読み込みと保存の形に応じて 2 つのフックを使い分ける。どちらも変更を楽観的に反映して保存し、
保存に失敗したときは固定の文言(`SETTINGS_FILE_ERROR_REASON`)を `saveError` に入れる。例外の文言は画面に出さず、`console.error` にだけ残す。

- **選択式**(実行方式・エージェント CLI): `hooks/useSavedSetting.ts`。保存に失敗したら、その変更の直前の値へ戻す。
  `useExecutionMode`・`useAgentCliKind` が使う。
- **真偽値**(エージェントの通知・送信前の確認): `hooks/useBooleanSetting.ts`。最後に保存できた値へ戻す。
  続けて変更したときに、後の変更がすでに始まっていれば、前の変更の失敗では戻さず後の変更の結果に任せる(変更の通し番号で判定する)。

両者を分けているのは、続けて変更したときの戻し方が異なるため。`useSavedSetting` は直前の値へ戻すだけで通し番号を持たない。

どちらも、オプションに渡す関数(`load`・`save`・`readValue`・`onLoaded` など)は描画をまたいで同じ参照にする。
読み込みの effect と `change` の依存にそれらが入っているため、描画ごとに新しい関数を渡すと、読み込みが繰り返し走る。
モジュールの直下の関数か `useCallback` で用意する。

## 4. 外部入力の扱い

ファイル・IPC の payload・hooks の HTTP の本文など、プロセスやアプリの外から来る値は `unknown` として受け、検証してから使う。

- **キャストで検証を済ませたことにしない。** `value as Record<string, unknown>` や `(LIST as readonly string[]).includes(value)` の代わりに、
  `src/shared/typeGuards.ts` の型ガードを使う。
  - `isObjectLike(value)`: null でないオブジェクト(配列を含む)
  - `isPlainObject(value)`: null でも配列でもないオブジェクト
  - `isOneOf(CANDIDATES, value)`: `as const` の候補のどれかか。一致すれば候補の型に絞り込む
- **`Array.isArray` は `unknown` を `any[]` に絞り込む。** 要素を使う前に `const items: readonly unknown[] = value` のように受け直す
  (例: `progressValidation.ts`)。
- **不正な値を既定値に読み替えない(コード中の L-044)。** IPC で届いた不正な値は例外にする。保存ファイルの不正な要素は捨てる。
  例外は、保存された設定値の読み込み(`getModelSettings` など)で、不正なら既定値に戻す。
- **例外の文言に、パス・ファイルの中身・秘密を入れない(コード中の L-017)。** 画面に出る文言は固定にし、元の例外は `console.error` に残す。
- 保存ファイルの形が型より緩い(古い形式で欠けたフィールドがある)ときは、型ガードで型を偽らずに「保存の形」の型を別に定義する
  (`historyUtils.ts` の `StoredHistoryEntry` と、`createJsonCollectionStore<T, Stored>` の 2 つ目の型引数)。

## 5. テストの書き方

### 置き場所と名前

- 対象と同じ階層の `__tests__/` に `<対象>.test.ts(x)` で置く。観点ごとに分けるときは `<対象>.<観点>.test.ts`(例: `settingsFileStore.atomic.test.ts`)。
- 実ファイル・実 git など実物の依存を使って複数のモジュールをまたぐテストは `*.integration.test.ts(x)` と名付ける。
- テストの名前(`it` の文字列)は日本語で、「条件 → 期待する結果」が分かるように書く。

### main のテスト

- モックは `vi.hoisted` で作り、`vi.mock` に渡す。`node:fs/promises` は `default` と名前つきの両方に同じモックを入れる
  (例: `src/main/__tests__/settingsFileStore.test.ts`)。
- `electron` は `vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/mock/userData') } }))` のように必要な分だけ差し替える。
- IPC の受け口は、`ipcMain.handle` のモックに登録された関数を取り出して直接呼ぶ(`promptsHandlers.test.ts` の `getRegisteredHandler`)。
- 一時ディレクトリを再帰的に消すときは `src/shared/__tests__/helpers/tempDirGuard.ts` の `removeTempPathSync`・`removeTempPath` を使う
  (素の再帰削除は ESLint で検出する)。

### renderer のテスト

- `src/renderer/src/__tests__/setup.ts` が `window.api` の既定のスタブを入れる。個別に振る舞いを変えるときは、
  `vi.mock('../../lib/settingsApi')` のように `lib/*Api.ts` をモジュールごと差し替えるのが基本。
- hook は `renderHook`・`act`・`waitFor`(`@testing-library/react`)で試す。コンポーネントは `render` と `@testing-library/user-event`。
- `@monaco-editor/react` は `vitest.config.ts` の alias で `__tests__/__mocks__` の軽い実装に置き換わる。

### 失敗の経路を書く

正常系だけでなく、例外・拒否された Promise・不正なデータの経路を必ず書く。よく使う形:

```ts
// 拒否の種類と文言を確かめる
await expect(getApiKey()).rejects.toBeInstanceOf(SettingsFileError)

// 失敗したときに副作用が起きていないことも確かめる
await expect(setModelSettings({ modelId: 'claude-haiku-4-5', maxTokens: 0 })).rejects.toThrow(
  'max_tokens は'
)
expect(mockWriteFile).not.toHaveBeenCalled()

// console.error を出す経路は spy で黙らせ、必ず元に戻す
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
try {
  // ...
} finally {
  consoleErrorSpy.mockRestore()
}

// hook の非同期関数の拒否は act の中で受け止めてから確かめる
let caught: unknown = null
await act(async () => {
  try {
    await result.current.saveModelSettings(settings)
  } catch (err) {
    caught = err
  }
})
expect(caught).toBe(failure)
```

- `act(...).then(...)` の形では書かない。失敗が unhandled rejection として握り潰され、通ったように見える。
- 不正なデータは `it.each` で並べる(`null`・`undefined`・数・文字列・配列・欠けたフィールド・境界値の外)。境界値はちょうどの値と 1 つ外の両方を書く。
- `setInterval`・`setTimeout` を使うモックは ID を控え、`afterEach` で必ず止める(CLAUDE.md の「タイマーリークの防止」)。

## 6. よくある落とし穴

- **main のテストも jsdom で動く。** `vitest.config.ts` の `environmentMatchGlobs` は Vitest 4 では効かないため、`src/main/**` のテストでも
  `window` が定義されている。`typeof window` で Node と画面を見分けるコードは、テストでは画面側の分岐に入る。
- **重い処理と並べてテストを走らせると、時間切れで落ちることがある。** `npm test` を型チェック・lint と同時に走らせたとき、
  10 件ほどのテストが時間切れで落ちた(単独で流し直すとすべて通った)。落ちたらまず単独で流し直して再現するかを確かめる。
- **`FileTreeNode` は判別可能なユニオンではない。** `node.type === 'file'` で分岐しても `node` 自体は `FileNode` に絞り込まれない。
  `lib/fileUtils.ts` の `isFileNode` を使う。
- **effect の中で同期的に setState を呼ぶと lint エラーになる**(`react-hooks/set-state-in-effect`)。読み込みの処理はフックの外の関数に置き、
  setter を引数で渡して effect から呼ぶ(例: `hooks/useGitStatus.ts` の `fetchGitStatus`)。
- **関数には戻り値の型を書く**(`explicit-function-return-type`。テストを含むすべての `.ts`・`.tsx`)。型だけの import は `import type` にする。
- **Prettier の崩れも lint の失敗になる。** 警告 0 件の運用なので、`npx eslint <パス> --max-warnings 0` で確かめ、崩れは `npx prettier --write <パス>` で直す。
- **実機テスト仕様書の ID は振り直さない。** 機能を足したら `docs/manual-test-spec.md` に項目を足し、`node scripts/build-manual-test-spec.mjs` で
  HTML を再生成して `npx vitest run scripts` を通す(書式は CLAUDE.md)。
- **`settings.json` の API キーのフィールドは型の検証を通らない。** `readSettingsFile` は各フィールドの型を確かめずに `SettingsFile` として返す。
  ほかの設定のストアは読むときに型を確かめるが、`apiKeyStore.ts` の `getApiKey` は `apiKey` を文字列とみなして `trim()` を呼ぶ
  (手で `"apiKey": 123` と書き換えると `TypeError` になる。2026-10-30 時点の既知の点)。

## 7. 関連する文書

- [README.md](../README.md): 機能の一覧・コマンド・主要なモジュール
- [ROADMAP.md](../ROADMAP.md): 実装済みの機能と今後の候補
- [docs/manual-test-spec.md](manual-test-spec.md): 実機テスト仕様書
- [docs/review-findings-patterns.md](review-findings-patterns.md): レビューの指摘から得た実装のパターンと教訓
- [docs/pr-review-loop.md](pr-review-loop.md): PR のレビュー対応の手順
- `docs/superpowers/specs/`・`docs/superpowers/plans/`: 機能ごとの設計書と実装プラン
