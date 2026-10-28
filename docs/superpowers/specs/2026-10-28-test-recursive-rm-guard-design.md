# テストの再帰削除をすべてガード経由にそろえる 設計書

- 日付: 2026-10-28
- 種類: テストの基盤の変更（アプリの挙動は変えない）
- きっかけ: 2026-10-26 の事故。テストの `rmSync(dirname(first.hooks?.configPath ?? ''), { recursive: true })` が、欄の改名の途中で `rmSync('.')` になり、リポジトリのフォルダが `.git` ごと消えた
- 前提: 事故の後に `src/main/__tests__/helpers/tempDirGuard.ts`（`assertInsideTempDir`・`removeTempPathSync`）を足し、段階 3b で触ったテスト（11 ファイルと `helpers/agentBaselineFixtures.ts`）はガードに替えてある
- 知見: L-618（この事故）、L-002（「無い」を「空」として扱う）、L-004（後始末で自分が作ったもの以外を消す）、L-014（finally の中の例外が元の例外を置き換える）、L-609（タスクの境界で型検査・テストが落ちる）
- 実装は 1 つの実装プラン・1 つの PR にする

## 目的

テストのコード（テストのファイルとテストの補助）の再帰削除を、すべて 1 つのガードに通す。さらに、後から書くテストが素の再帰削除に戻らないよう、ESLint で機械的に止める。
L-618 の原因 (4)「守りを一部のファイルへのガードの導入に分けると、ほかのファイル・後から書くテストに素の再帰削除が残る」を、grep の全件の置き換えと lint の両方で閉じる。

## 調べた結果

### 素の再帰削除の数（2026-10-28 の main・`b6519aa`）

対象: `git ls-files` のうち `__tests__/` の下・`*.test.*` のファイル（624 ファイル）。`scripts/__tests__/build-manual-test-spec.test.mjs` も含む。
呼び出し: `rmSync`・`rm`・`fs.rm`・`fs.promises.rm`・`fsp.rm`・`rmdir`・`rmdirSync`・`rimraf`。

- `recursive` を持つ素の呼び出し: **34 ファイル・50 か所**（ガードの実装のファイル `tempDirGuard.ts` の 2 行を除く。実装の `rmSync` と、事故を説明するコメント）。前に見た 34 ファイル・46 か所から、同じファイルの中で 4 か所増えている（数え方の違いを含む）。プランを書く時点で grep をかけ直す
- 複数行に分かれた `rmSync(` の呼び出し: 無い（すべて 1 行）
- `rimraf`・`rmdir`・`rmdirSync`・`fsp.rm`・`fs.promises.rm`: テストでは使っていない（`rimraf` は直接の依存には無い。推移的な依存として入っていて import はできる）
- `scripts` のテスト: 再帰削除は無い
- `recursive` を持たない素の `rmSync`（1 つのファイルを消す・`{ force: true }` だけ）: 18 か所。ディレクトリに使うと `ERR_FS_EISDIR` で投げ、「.」を中身ごと消すことは無いので、対象にしない（「やらないこと」）
- 本番のコードの再帰削除（`agentChangesUndo.ts`・`agentCopilotHookPlugin.ts`・`agentHookSettings.ts`・`agentBaselineSnapshot.ts` など）は対象外。規則もテストのファイルだけにかける

### パスの出どころ

50 か所すべてを読んだ。`??`・`dirname` を経てから消す箇所は残っていない（段階 3b で直した）。出どころは次の 3 つ。

| 出どころ                                                         | 件数 | 例                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mkdtemp(Sync)(join(tmpdir(), …))` の値（`realpathSync` を含む） |   43 | `gitCloneService.test.ts:78` の `work`                                                                                                                                                           |
| 上の値の下を `join` で指すパス                                   |    5 | `agentBaselineHiddenGit.integration.test.ts:84` の `probe`、`agentBaselineSnapshot.integration.test.ts:816`、`agentChangesUndo.test.ts:464`、`gitDiscardService.integration.test.ts:102`・`:150` |
| 本番のコードが返した値                                           |    2 | `agentBaselineSnapshot.integration.test.ts:501` の `first.tempDir`、`:1048` の `gitDir`（`const gitDir = gitDirOf(first)` の値）                                                                 |

本番のコードが返した値（`first.tempDir` など）は、L-618 と同じ「欄の改名の途中で undefined になる」危険の型にあたる。今は `rmSync(undefined)` が ERR_INVALID_ARG_TYPE で投げるので消さないが、`?? ''` や `dirname` を後から足すと事故の形になる。

### 呼び出しの場所

| 場所                                 | 件数 | 例                                                                                                                                                                                                                                                |
| ------------------------------------ | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `afterEach`・`afterAll` の後始末     |   34 | `if (dir !== null) rmSync(dir, …)`（5 か所）、`for … of` で複数を消す形（5 か所。うち `splice(0)` は 3 か所、配列リテラルは `agentBaselineTempSweep.integration.test.ts:37`・`agentChangesProtectionRef.integration.test.ts:67` の 2 か所）を含む |
| `try … finally` の後始末             |    9 | `agentBaselineHiddenGit.integration.test.ts:84`、`gitStashService.integration.test.ts:373`・`:449`、`helpers/realGitRepo.ts:126`・`:146` など                                                                                                     |
| テストの操作（場面を作るために消す） |    7 | `agentBaselineSnapshot.integration.test.ts:501`・`:816`・`:1048`、`agentChangesUndo.test.ts:464`、`gitDiscardService.integration.test.ts:102`・`:150`、`gitTagService.integration.test.ts:236`                                                    |

renderer 側のテストは `src/renderer/src/lib/__tests__/copilotPromptSend.integration.test.ts:106` の 1 か所。テストの補助（テストでないファイル）は `src/main/__tests__/helpers/realGitRepo.ts` の 2 か所。

### 非同期の `rm`

`src/main/__tests__/agentSessionRecordFileIo.test.ts:16` の `await rm(tempDir, { recursive: true, force: true })`（`node:fs/promises`）の 1 か所だけ使っている。

### renderer 側のテストから main 側のガードを import できるか

- 実行時: できる。Vitest は相対パスをそのまま解決し、jsdom の環境でも `node:fs` を使える（`copilotPromptSend.integration.test.ts` が既に `node:fs`・`node:os` を使っている）
- 型検査: `tsconfig.web.json` の `include` は `src/renderer/src/**/*`・`src/preload/*.d.ts`・`src/shared/**/*` で、`src/main` を含まない。`npm run typecheck:web` は `--composite false` で走るので、include の外のファイルを import しても型検査は通る見込みだが、`composite: true` のまま（`tsc -b` など）では TS6307（ファイルがプロジェクトの一覧に無い）になる。renderer から main を import する前例も無い（`grep` で 0 件）
- 結論: renderer から main を import させず、両方の tsconfig に入っている `src/shared` の下に置く。`src/shared/__tests__/` は既にあり（テストのファイルだけ）、Vitest の `include` の `src/shared/**/*.test.ts` に入る。`tsconfig.web.json` は `types` を絞っていないので `@types/node` が見え、`node:fs` を使うガードも型検査が通る（renderer のテストが `node:fs` を import して通っているのと同じ理由）
- テストからの `@shared/...` の import は既に main のテスト 50 ファイル・renderer のテスト 88 ファイルで使っており、`vitest.config.ts` の `resolve.alias` と両方の tsconfig の `paths` にある

### ESLint の設定

- `eslint.config.mjs` は flat config（ESLint 9.39.4・esquery 1.7.0）。`no-restricted-syntax`・`no-restricted-imports` はどの設定でも使っていない（`npx eslint --print-config` で確かめた）。規則を足しても既存の設定の上書きにならない
- 下の「ESLint の規則」のセレクターを、ESLint の API（`lintText`）で試し、`rmSync`・`fs.rmSync`・`fs.promises.rm`・`await rm` の `recursive` を検出し、`rmSync(x, { force: true })`・`mkdirSync(x, { recursive: true })`・`expect(m).toHaveBeenCalledWith(x, { recursive: true })` は検出しないことを確かめた（コードは変えず、一時のスクリプトで試した）

## 決めたこと（推奨案で決めた事項。1 と 7 は 2026-10-28 にユーザーが推奨案で確定）

1. **ガードの置き場**: `src/main/__tests__/helpers/tempDirGuard.ts` を `src/shared/__tests__/helpers/tempDirGuard.ts` へ移す（`git mv`）。単体テストも `src/shared/__tests__/helpers/tempDirGuard.test.ts` へ移す。import は `@shared/__tests__/helpers/tempDirGuard` にそろえる。main に再 export の薄いファイルは残さない（置き場が 2 つになり、規則の除外も 2 つになる）。**推奨案で確定（2026-10-28）**
2. **同期・非同期の API**:
   - `assertInsideTempDir(target: string | null | undefined): string`（今のまま）
   - `removeTempPathSync(target: string | null | undefined): void`（今のまま。`rmSync(…, { recursive: true, force: true })`）
   - **`removeTempPath(target: string | null | undefined): Promise<void>` を足す**。`async` 関数にして、`assertInsideTempDir` の例外も同期の throw ではなく reject で返す（`await expect(removeTempPath(x)).rejects.toThrow(…)` で確かめられる形）。中は `node:fs/promises` の `rm(…, { recursive: true, force: true })`
   - 非同期の利用は今 1 か所だけだが、規則が `await rm(…, { recursive: true })` も止めるので、非同期で書きたいテストの逃げ道を用意する
3. **ESLint の規則**: テストのファイルだけに `no-restricted-syntax` をかけ、`rm`・`rmSync`・`rmdir`・`rmdirSync` の呼び出しの引数のオブジェクトリテラルに `recursive` の欄があれば止める。ガードの実装のファイルだけを除外する。`no-restricted-imports` は使わない（下の比較）
4. **一律にガードを通す**: mkdtemp の値をそのまま消している 43 か所も、テストの操作として消している 7 か所も、すべてガードに替える。規則は「後始末か操作か」「mkdtemp の値か」を見分けられず、例外を作ると規則に穴が開くため
5. **try/finally の扱い**: 構造は変えず、finally の中の呼び出しだけを替える。ガードの例外を catch で握り潰さない
6. **ROADMAP は更新しない**: ROADMAP の項目ではない（テストの基盤の変更）
7. **`let dir: string`（初期値無し）は書き換えない**: `let dir: string | null = null` への書き換えは今回やらない。**推奨案で確定（2026-10-28）**。理由は「やらないこと」に書く

### `no-restricted-syntax` と `no-restricted-imports` の比較

| 観点                                  | `no-restricted-syntax`（採用）                                                                  | `no-restricted-imports`（`rmSync`・`rm` の名前の import を禁止） |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1 つのファイルを消す素の `rmSync`     | 通す（`recursive` が無ければ検出しない）                                                        | 止めてしまう。18 か所を `unlinkSync` などへ書き換える必要がある  |
| `import * as fs` の `fs.rmSync`       | 検出する（メンバーの呼び出しのセレクター）                                                      | 検出しない（名前の import ではない）                             |
| `vi.importActual` の `actual.rm(…)`   | 引数がリテラルなら検出する                                                                      | 検出しない                                                       |
| `import { rmSync as remove }`（別名） | 検出しない（既知の制約）                                                                        | 検出する                                                         |
| 本番のコードの `rm` の差し込みの写し  | `settingsFileStore.atomic.test.ts:83` の `actual.rm(file, options)` は options が変数なので通す | 名前の import ではないので通す                                   |

別名の import は今 0 件で、書く理由も薄い。止めたいのは「再帰削除」で、「`rmSync` の import」ではないので、`no-restricted-syntax` を採る。

## ESLint の規則

`eslint.config.mjs` の `eslintConfigPrettier` の前に、次のブロックを足す（形の案。実装で文言を整えてよい）。

```js
{
  // テストの再帰削除は一時ディレクトリの中だけを消すガードを通す(L-618。2026-10-26 にテストの rmSync('.') がリポジトリを消した)
  files: [
    'src/**/__tests__/**/*.{ts,tsx}',
    'src/**/*.test.{ts,tsx}',
    'scripts/**/__tests__/**/*.mjs',
    'scripts/**/*.test.mjs'
  ],
  ignores: ['src/shared/__tests__/helpers/tempDirGuard.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "CallExpression[callee.type='Identifier'][callee.name=/^(rm|rmSync|rmdir|rmdirSync)$/] > ObjectExpression > Property:matches([key.name='recursive'], [key.value='recursive'])",
        message: RECURSIVE_RM_MESSAGE
      },
      {
        selector:
          "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(rm|rmSync|rmdir|rmdirSync)$/] > ObjectExpression > Property:matches([key.name='recursive'], [key.value='recursive'])",
        message: RECURSIVE_RM_MESSAGE
      }
    ]
  }
}
```

- `RECURSIVE_RM_MESSAGE` は「テストの再帰削除は `@shared/__tests__/helpers/tempDirGuard` の `removeTempPathSync`・`removeTempPath` を通してください（L-618）」の趣旨
- `CallExpression > ObjectExpression` は呼び出しの引数のオブジェクトリテラルだけに当たる（callee がオブジェクトリテラルになることは無い）
- `recursive: false` も止める。再帰しないなら欄を書かなければよい
- 対象の globs は、テストの補助（`helpers/realGitRepo.ts` など、`__tests__` の下のテストでないファイル）も含む
- ブロックの `ignores` は、このブロックの規則だけをそのファイルから外す（flat config の仕様。ファイル全体を lint から外すのではない）
- `npm run lint` は `--cache` 付きだが、ESLint のキャッシュは設定の変化で無効になる

## 置き換えの方針

### パターンごとの置き換え方

| 今の形                                                                                        | 置き換え後                                                        | 備考                                                                                             |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `rmSync(dir, { recursive: true, force: true })`                                               | `removeTempPathSync(dir)`                                         | 大半                                                                                             |
| `if (dir !== null) rmSync(dir, { recursive: true, force: true })`                             | `if (dir !== null) removeTempPathSync(dir)`                       | null（準備が失敗した）の確かめは残す。ガードに null を渡すと投げて、元の失敗を見えにくくする     |
| `for (const dir of …) rmSync(dir, { … })`（`splice(0)`・配列リテラル）                        | `for (const dir of …) removeTempPathSync(dir)`                    | 途中で投げると残りが消えないが、残るのは一時ディレクトリだけ                                     |
| `rmSync(join(repo, '.git'), { recursive: true, force: true })`（操作）                        | `removeTempPathSync(join(repo, '.git'))`                          | テストの操作でも一律に替える                                                                     |
| `rmSync(join(folder, 'sub'), { recursive: true })`（`force` 無し）                            | `removeTempPathSync(join(folder, 'sub'))`                         | ガードは常に `force: true`。直前に同じテストで作ったフォルダなので、無いときに投げない差は出ない |
| `rmSync(first.tempDir, { … })`・`rmSync(gitDir, { … })`（`gitDir` は `gitDirOf(first)` の値） | `removeTempPathSync(first.tempDir)`・`removeTempPathSync(gitDir)` | 本番の値が undefined になってもガードが投げる                                                    |
| `await rm(tempDir, { recursive: true, force: true })`                                         | `await removeTempPath(tempDir)`                                   | `agentSessionRecordFileIo.test.ts:16` の 1 か所                                                  |

- 置き換えで使わなくなった `rmSync`・`rm` の import は消す（`noUnusedLocals` で型検査が落ちる）。1 つのファイルを消す素の `rmSync` が残るファイルでは import を残す
- `dirname`・`join` に空や undefined を渡す形は、今は残っていない。置き換えの途中で見つけたら、先に `if (!path) throw` で絞る（L-618 の修正内容）

### 後始末の try/finally

- 構造（try・finally の位置、`registry.close()` との順）は変えず、finally の中の呼び出しだけを替える
- ガードが finally の中で投げると、try の例外が置き換えられる（L-014）。ここで消すのは同じ関数の中で mkdtemp した値（またはその下）なので、ガードが投げるのは「消そうとしているパスがおかしい」ときだけで、そのときは元の例外より大事な知らせになる。catch で握り潰すと事故の兆しを隠すので、包まない

### mkdtemp の値をそのまま消している箇所

一律にガードを通す。理由:

- 規則が見分けられないので、例外を作ると「この形なら素で書いてよい」という穴になる
- mkdtemp の値でも、`let dir: string` のまま準備が失敗すると前のテストの値や undefined が残る。今の素の呼び出しは undefined で投げるだけだが、後から `?? ''` を足すと事故の形になる
- `realpathSync(mkdtempSync(…))` の値も、ガードは `os.tmpdir()` の realpath を根として扱う（macOS の `/var` → `/private/var`）ので投げない

## 気をつける知見

- **L-618**: 消す前に値を絞る。`?? ''`・`dirname('')` の「.」を作らない。初期値を `''` にしない。広い編集（今回の import の書き換え）の途中は、テストより先に `npm run typecheck` を流す。ガードのテストで外のパスを確かめるときは、存在しないパスを使う（ガードが壊れても何も消えない）。作業ディレクトリ（`process.cwd()`）を `removeTempPath(Sync)` に渡すテストを書かない（`assertInsideTempDir` にだけ渡す今のテストは消さないので安全）
- **L-002**: 「無い」を「空」にしない。null の確かめを残す理由
- **L-004**: ガードの範囲は「一時ディレクトリの中」で、「自分が作ったもの」までは確かめない（既知の制約）
- **L-014**: finally の中の例外が元の例外を置き換える。上の「後始末の try/finally」の判断
- **L-609**: ガードの移動と import の書き換えは同じタスクに入れる（分けると途中のタスクで型検査が落ちる）。規則は置き換えが全部終わった後のタスクで入れる（先に入れると lint が落ちる）

## テストの方針

### ガードの単体テスト（`src/shared/__tests__/helpers/tempDirGuard.test.ts`）

今の `tempDirGuard.test.ts` を移し、次を足す。`src/shared` の下のテストは jsdom の環境で走るが、`node:fs`・`node:os` はそのまま使える（`// @vitest-environment node` は付けない。付けると `setup.ts` の DOM の操作で落ちる）。

- `removeTempPath`: 一時ディレクトリの中のフォルダを中身ごと消し、親は残る
- `removeTempPath`: null・undefined・空・相対のパス（存在しないパス）で reject する（同期の throw ではないことも確かめる。呼んだ時点で投げず、返った Promise が reject する）
- `removeTempPath`: 外のパス・`..` で外に出るパスで reject する。どちらも存在しないパス（`resolve('/', 'prompt-ide-temp-dir-guard-test-missing')` など）で確かめる。「.」・一時ディレクトリそのもの・作業ディレクトリ（存在するパス）は `removeTempPath` に渡さず、同じ確かめを通る `assertInsideTempDir` のテストで確かめる（ガードが壊れていても何も消えないようにする。L-618）
- `removeTempPath`: 無いパス（中の、存在しないパス）では reject しない（`force: true`）
- 後始末の `afterEach` は `removeTempPathSync` を使う（今のまま）

### ESLint の規則のテスト（`src/shared/__tests__/helpers/tempDirGuard.lint.test.ts`）

`RuleTester` ではなく、`eslint` の `ESLint` クラスで実際の `eslint.config.mjs` を読み、`lintText(code, { filePath })` で確かめる。`RuleTester` は規則（`no-restricted-syntax` 自体）しか確かめられず、`files`・`ignores` の globs が効いているかを確かめられないため。

- `// @vitest-environment node` は付けず、jsdom の環境のまま走らせる（付けると `setup.ts` の DOM の操作で落ちる。jsdom の環境でも ESLint の API は動く）。ESLint の起動に数秒かかるので、`lintText` の件の時間の上限を 30 秒にする（下の「リポジトリ全体」の件は 120 秒）
- `ruleId === 'no-restricted-syntax'` のメッセージだけを数える（ほかの規則の結果に左右されない）
- 検出する（テストのファイルのパス `src/main/__tests__/x.test.ts`・`src/renderer/src/lib/__tests__/x.test.tsx`・`src/main/__tests__/helpers/x.ts`・`scripts/__tests__/x.test.mjs` で）:
  - `rmSync(dir, { recursive: true, force: true })`
  - `fs.rmSync(dir, { recursive: true })`・`fs.promises.rm(dir, { recursive: true })`・`await rm(dir, { recursive: true })`
  - `rmdirSync(dir, { recursive: true })`・`rmSync(dir, { 'recursive': true })`
- 検出しない:
  - `removeTempPathSync(dir)`・`await removeTempPath(dir)`
  - `rmSync(join(dir, 'f.txt'))`・`rmSync(file, { force: true })`
  - `mkdirSync(dir, { recursive: true })`・`cpSync(a, b, { recursive: true })`
  - `expect(mockRm).toHaveBeenCalledWith('/x', { recursive: true })`
  - ガードの実装のパス `src/shared/__tests__/helpers/tempDirGuard.ts` での `rmSync(x, { recursive: true, force: true })`（除外が効いている）
  - 本番のコードのパス `src/main/foo.ts` での同じ呼び出し（テストのファイルだけにかかっている）
- リポジトリ全体: `lintFiles(['src', 'scripts'])` で、実際のファイルに規則をかけ、`no-restricted-syntax` の違反が 0 件であることを確かめる。どのファイルに規則がかかるかは設定の `files`・`ignores` に任せる（globs をテストに写すと、`files` を変えたときにずれても気づけない）。`ruleFilter` で `no-restricted-syntax` だけを流し（ほかの規則の main からあるエラーに左右されない）、キャッシュは使わない。対象の集め方が壊れて素通りしないよう、lint したテストのファイル（`__tests__/` の下と `*.test.*`）が 100 を超えることも確かめる。時間の上限は 120 秒（手元で約 3 秒）。`npm run lint` は main からある別の規則のエラーで普段は通らないので、このテストで、後から書くテストの素の再帰削除を `npm test` で止める
- TDD: 規則のブロックを足す前にこのテストを書いて落ち、足して通ることを確かめる。規則のブロックを `git stash push eslint.config.mjs` で戻すと落ちることも確かめる

### 置き換えのテスト

置き換えは振る舞いを変えないので、新しいテストは書かない。各タスクで、置き換えたファイルのテストが通ることを確かめる。

### 全体の確かめ（最後のタスク）

- `npm run typecheck`・`npm test`（規則のテストの「リポジトリ全体」の件で、この規則の違反が 0 件であることも確かめる）
- `npm run lint` は main からある 60 件のエラーで通らないので、規則の違反の確かめには使わない（流す場合は、`no-restricted-syntax` が 0 件であることだけを見る）
- grep で、ガードの実装のファイル `src/shared/__tests__/helpers/tempDirGuard.ts` 以外の素の再帰削除が 0 行であること（ガードの実装のファイルは、`rmSync`・`rm` の実装 2 行と事故を説明するコメント 1 行の計 3 行が当たるので除く。規則のテスト `tempDirGuard.lint.test.ts` も、lint にかける文字列のコードが当たるので除く）
  ```sh
  git ls-files | grep -E '(__tests__/|\.test\.(ts|tsx|mjs)$)' \
    | xargs grep -nE '\b(rm|rmSync|rmdir|rmdirSync)\(.*recursive' \
    | grep -v 'src/shared/__tests__/helpers/tempDirGuard.ts' \
    | grep -v 'src/shared/__tests__/helpers/tempDirGuard.lint.test.ts'
  ```
- `src/main/__tests__/helpers/tempDirGuard` を参照する import が 0 件であること

## 実装の分割

各タスクの終わりで `npm run typecheck`・置き換えたファイルの `npx vitest run <ファイル>`・`npx eslint <ファイル>` が通る順にする（L-609）。テストを流す前に、そのファイルの再帰削除がガードを通っているか、素のままでも今の main と同じ（mkdtemp の値）であることを確かめる。広い import の書き換えの後は、テストより先に型検査を流す（L-618）。コミットはユーザーの指示があるまでしない。

1. **ガードの移動と非同期版**
   - `git mv` で `tempDirGuard.ts`・`tempDirGuard.test.ts` を `src/shared/__tests__/helpers/` へ移す
   - 既にガードを使っている 12 ファイル（テスト 11・`helpers/agentBaselineFixtures.ts`）の import を `@shared/__tests__/helpers/tempDirGuard` に書き換える（ガードのテストは一緒に移すので、相対の `./tempDirGuard` のまま）（同じタスクに入れる。分けると型検査が落ちる）
   - `removeTempPath` を TDD で足す（テストを先に書いて落ちることを確かめる）
   - 終わり: 型検査・ガードのテスト・書き換えた 12 ファイルのテスト・lint が通る
2. **main のテストの後始末の置き換え（afterEach・afterAll・try/finally）**
   - 41 か所（afterEach・afterAll の 34 から renderer の 1 と非同期の 1 を除いた 32 と、try/finally の 9。try/finally には `helpers/realGitRepo.ts` の 2 を含む）
   - 使わなくなった `rmSync` の import を消す
   - 終わり: 型検査・置き換えた各ファイルのテスト・lint が通る
3. **テストの操作・非同期・renderer の置き換え**
   - テストの操作の 7 か所、`agentSessionRecordFileIo.test.ts` の `await rm` を `removeTempPath` に、`copilotPromptSend.integration.test.ts` を `removeTempPathSync` に
   - 終わり: 「全体の確かめ」の grep（ガードの実装のファイルを除く）が 0 行。型検査・置き換えた各ファイルのテスト・lint が通る
4. **ESLint の規則**
   - 規則のテスト（`tempDirGuard.lint.test.ts`）を先に書いて落ちることを確かめ、`eslint.config.mjs` にブロックを足して通す
   - 終わり: 規則のテストの「リポジトリ全体」の件で、この規則の違反が 0 件（main からある 60 件のエラーは範囲外）。置き換えが終わっているので、規則を入れても既存のファイルで落ちない
5. **全体の確かめ**
   - `npm run typecheck`・`npm test`（規則のテストの「リポジトリ全体」の件を含む）・変更したファイルへの eslint・grep の確かめ（`npm run lint` は main からある 60 件のエラーで通らないので使わない）
   - 実機テスト仕様書は追記しない（下の「実機テスト仕様書について」）。ROADMAP も更新しない

タスク 2 と 3 の境界は件数で分けただけで、依存の向きは無い（どちらも規則の前）。2 と 3 をまとめてもよい。

## やらないこと

- `recursive` を持たない素の `rmSync`（1 つのファイルを消す 18 か所）の置き換え。ディレクトリに使うと `ERR_FS_EISDIR` で投げ、「.」を中身ごと消さない
- `let dir: string`（初期値無し）を `let dir: string | null = null` へ書き換えること（推奨案で確定。「決めたこと」7）。L-618 の推奨の形だが、今の形は準備が失敗すると undefined または前のテストの値で、ガードは undefined で投げ、前のテストの値は既に消えた一時ディレクトリを `force: true` で消すだけなので、消し過ぎは起こらない。書き換えは件数が多く、振る舞いの変更を伴うので別の作業にする
- 本番のコードの再帰削除へのガード（本番は一時ディレクトリの外も正しく消す必要がある）
- シェル経由の削除（`execSync('rm -rf …')`・`runGit(repo, 'rm', …)`）の検出。テストには `rm -rf` のシェルの呼び出しは無い（`git rm` だけ）
- `rimraf`・`fs-extra` の削除の関数（`remove`・`removeSync` など）の禁止（直接の依存には無い。推移的な依存として入っていて import はできる）
- ガードの範囲を「自分が mkdtemp で作ったもの」に狭めること（作ったパスの登録簿を持つ形）。範囲は狭まるが、全テストの作り方を変える必要がある

## 既知の制約

- **規則がすり抜ける形**: オプションを変数で渡す（`rmSync(dir, opts)`）、スプレッド（`{ ...opts }`）、別名の import（`import { rmSync as remove }`）、別名の分割代入（`const { rmSync: remove } = fs`）、計算されたキー（`{ [key]: true }`）、計算されたメンバー（`fs['rmSync'](…)`）、型の表明（`as`・`satisfies`）、オプションなしで再帰削除する `rimraf`・`fs-extra` の関数は検出しない。今は 0 件。レビューと「全体の確かめ」の grep で補う（`eslint.config.mjs` のコメントと、`tempDirGuard.lint.test.ts` の `KNOWN_ESCAPES` で固定している）
- **`TMPDIR` がリポジトリの中を指す環境**: ガードの根は `os.tmpdir()` なので、`TMPDIR` をリポジトリの中にすると、その下は消せる（リポジトリの直下が `TMPDIR` なら `.git` も「中」になる）。`TMPDIR` そのものは消さない。CI・手元の既定の `TMPDIR` では起こらない
- **ガードは「一時ディレクトリの中」しか確かめない**: 別のテストや別のプロセスが作った一時ディレクトリの中も消せる（L-004）。テストが消すのは自分で mkdtemp した値とその下だけ、という書き方に頼る
- **シンボリックリンクを経由したパス**: ガードはパスの文字列で「中」かを見る（実体を解決しない）。一時ディレクトリの中に外を指すシンボリックリンクを置き、その先を渡すと、文字列の上では「中」なので消しうる。テストが mkdtemp した値とその下だけを渡す書き方に頼る（`..foo` のような名前は外とみなして投げる。安全側の誤検出）
- **finally の中のガードの例外**: try の例外を置き換える（L-014）。上の判断のとおり受け入れる
- **ESLint の規則のテストの時間**: 実際の設定を読むので、数秒かかる。「リポジトリ全体」の件は `src`・`scripts` の下を全部 lint するので、手元で約 3 秒かかる（上限 120 秒）

## 実機テスト仕様書について

`docs/manual-test-spec.md` に項目は足さない。この変更はテストのコードとテストの基盤（ガード・ESLint の設定）だけを変え、Electron のアプリの画面・挙動・ビルドの成果物に入るコードを変えないため、実機で確かめることが無い。確かめは自動のテスト（ガードの単体テスト・規則のテスト。規則のテストはリポジトリのテストのファイル全部に規則をかけて違反 0 件を確かめる）と grep の全件の確かめで行う（`npm run lint` は main からある 60 件のエラーで通らないので使わない）。したがって `node scripts/build-manual-test-spec.mjs` の再生成と Artifact の再公開も行わない。
