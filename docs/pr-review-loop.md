# PR レビューループ運用手順

Copilot のレビュー指摘が 0 件になるまで、対応・検証・再依頼を自走で繰り返すための手順書。
別のセッションや別の端末でも同じ動作を再現できるよう、コマンドと落とし穴をここに集約する。

CLAUDE.md の「PR レビューフロー」がルールの本体で、この文書はその実行手順を補足するもの。

## 前提

- `bash` と `python3` が使えること（スクリプトは両方に依存する）
- `gh` が認証済みであること（`gh auth status`）
- Copilot のレビュー依頼はローカルターミナルから行うこと。`GITHUB_TOKEN`（GitHub Actions）からはトリガーできない
- コミット・プッシュはユーザーの明示的な指示がある場合のみ行う

## ループ 1 周の手順

1. 指摘を取得する（未解決スレッド **と** suppressed comments の両方）
2. 各指摘の妥当性を検証する。前提が誤っていれば根拠を添えて対応しない判断をする
3. 対応する指摘は TDD で直す（失敗するテストを先に書き、実装後に通す）
4. 検証する（テスト・型・lint・実機確認）
5. 起動したアプリを停止する
6. コミットする（日本語・Conventional Commit）※ユーザーの明示的な指示がある場合のみ
7. プッシュする ※同上
8. 対応済みスレッドに返信し、Resolve する
9. PR 本文を更新する
10. Copilot に再レビューを依頼し、**登録されたことを確認する**
11. 監視を張り直す
12. 新しい指摘が届いたら 1 に戻る。指摘が 0 件になったら終了

### 1. 指摘の取得

未解決スレッド:

```bash
gh api graphql -f query='
{repository(owner:"<OWNER>",name:"<REPO>"){pullRequest(number:<PR>){
  reviewThreads(last:60){nodes{id isResolved path line comments(first:2){nodes{author{login} body}}}}
}}}'
```

suppressed comments はスレッドにならず、レビュー本文の `<details>` 内にのみ現れる。
本文も必ず読むこと。

```bash
gh api graphql -f query='
{repository(owner:"<OWNER>",name:"<REPO>"){pullRequest(number:<PR>){
  reviews(last:1){nodes{author{login} submittedAt body}}
}}}'
```

> **`first` ではなく `last` を使う。** レビューやスレッドが増えると `first` は古い方から
> 埋まり、最新の到着がページの外に出て検知できなくなる。実際にレビュー総数が 50 件を
> 超えた時点で新着を取りこぼした。

### 2〜3. 妥当性の検証と修正

- 指摘の前提を自分で確かめる。テストが落ちると書かれていたら実際に走らせる。数値が
  書かれていたら自分で計算する。誤っていれば、根拠（実行結果・計算過程）を添えて
  対応しない判断を返信し、PR 本文にも残す
- 対応する場合は失敗するテストを先に書く。テストが「実装を戻すと落ちる」ことまで
  確認する（`git stash push <実装ファイル>` → テスト実行 → `git stash pop`）
- テストが偶然通っていないか疑う。`act(...).then(...)` 形式で書くと失敗が unhandled
  rejection として握り潰され、通ったように見える。`async` / `await` で書くこと

### 4. 検証

```bash
npm test          # 全スイート
npm run typecheck # 型
npx eslint <変更したファイル>
```

lint はリポジトリ全体では既存の警告が多いため、変更したファイルだけを見る。

実機確認は Electron を起動して CDP から操作する。手順とスクリプトの雛形は
「実機確認」の節を参照。

### 5. アプリの停止

`pkill -f` はパターンに一致したプロセスをまとめて落とす。停止する前に何が該当するかを
必ず確認し、想定外のプロセスが含まれていないことを見てから実行する。

```bash
# 1. 対象を確認する（このリポジトリ配下の Electron と dev サーバーだけのはず）
pgrep -fl "prompt-ide/node_modules/electron/dist"
pgrep -fl "electron-vite dev"

# 2. 確認できたら停止する
pkill -f "prompt-ide/node_modules/electron/dist"   # Electron 本体
pkill -f "electron-vite dev"                        # dev サーバー

# 3. 残っていないことを確認する
pgrep -fl "prompt-ide/node_modules/electron"
pgrep -fl "electron-vite"
lsof -nP -iTCP:9222 -iTCP:9229 -iTCP:5173 -sTCP:LISTEN
```

`electron-vite dev` だけを落としても Electron 本体は生き残る（親が init に付け替わる）。
手順 3 の 3 つがすべて空になって初めて停止できたと判断する。

パターンにはリポジトリ名を含んだパスを使う。`pkill -f electron` のような広いパターンは
無関係な Electron アプリまで巻き込むため使わない。

### 6〜7. コミットとプッシュ

**コミット・プッシュはユーザーの明示的な指示がある場合のみ行う。** 指示が無い場合は
変更をローカルに残したまま、内容を報告して指示を待つ。

- `git add -A` は使わない。無関係な未追跡ファイルを巻き込む。`git add -u` で
  追跡済みの変更だけを載せる
- コミットメッセージは日本語・Conventional Commit 形式。何を直したかに加えて
  「直さないと何が起きるか」を書く

### 8. 返信と Resolve

**対応済みの指摘だけ** Resolve する。未対応のものを機械的に Resolve しない。

```bash
# 返信
gh api graphql -f query='mutation($t:ID!,$b:String!){
  addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$t, body:$b}){clientMutationId}
}' -f t='<THREAD_ID>' -f b='<返信本文>'

# Resolve
gh api graphql -f query='mutation($t:ID!){
  resolveReviewThread(input:{threadId:$t}){thread{isResolved}}
}' -f t='<THREAD_ID>'
```

返信には「何が起きていたか」「どう直したか」「どのテストで固定したか」を書く。
対応しない判断の場合は根拠を書く。

### 9. PR 本文の更新

コミットごとに「指摘 → 対応」の表を追記する。対応しない判断とその理由もここに残す。

```bash
gh pr view <PR> --json body -q .body > /tmp/pr-body.md
# 追記して
gh pr edit <PR> --body-file /tmp/pr-body.md
```

Windows (PowerShell) では、日本語を含む本文を扱う前に毎回 UTF-8 に固定する。
固定せずに実行すると本文が文字化けする。文字化けした本文は再利用せず、
正常なテキストで上書きすること。

```powershell
chcp 65001
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [Console]::OutputEncoding
```

### 10. 再レビュー依頼

```bash
bash scripts/request-copilot-review.sh <OWNER> <REPO> <PR>
```

依頼が登録されたことを出力で確認する。依頼直後は `reviewRequests` から外れて
見えないことがあるため、空でも失敗とは限らない（監視側で新着を待つ）。

### 11. 監視

```bash
bash scripts/watch-pr-review.sh <OWNER> <REPO> <PR> "<baseline-iso8601>"
```

`baseline` には再レビューを依頼した時刻（UTC, ISO8601）を渡す。
`request-copilot-review.sh` は最後に `baseline:` として出力する。

新着が届いたら内容を出力して終了する。レビュー中は待ち続ける。

`suppressed: 不明（本文の形式を判定できない）` と出た場合は、件数を機械的に
読めなかったということ。`NO FINDINGS` は出ないので、レビュー本文を自分で開いて
`<details>` の中を確認する。

`REVIEW NOT RUN` と出た場合は、Copilot がレビュー自体を実行できていない。
GitHub Actions の支払いが失敗しているか、使用量の上限に達している可能性がある。
実行できない状態で再依頼を繰り返しても同じ通知が増えるだけなので、まず課金設定を
確認する。この通知も review として記録されるため、指摘 0 件と区別しないと
「指摘なし」と誤って判断してしまう。

## 実機確認

Electron を CDP 付きで起動し、レンダラーとメインプロセスの両方に接続して操作する。

```bash
npm run dev -- --remote-debugging-port=9222 --inspect=9229
```

- レンダラー: `http://localhost:9222/json` の `type === 'page'` のターゲット
- メインプロセス: `http://localhost:9229/json/list`

### 必ず入れる 3 つの対策

1. **フォーカスのエミュレーション**
   ウィンドウが OS フォーカスを失うと、CDP の合成キーイベントがページに届かず
   ドロップされる。アプリが壊れているように見えるので必ず有効化する。

   ```js
   await send('Emulation.setFocusEmulationEnabled', { enabled: true })
   ```

2. **描画の待ち合わせ**
   大きなツリーの描画中に打鍵すると取りこぼす。要素数が安定するまで待ってから
   操作を始め、ダイアログが開くまで打鍵を再試行する。

3. **ネイティブダイアログとモーダルの回避**
   `dialog.showOpenDialog` はメインプロセス側で差し替える。`window.confirm` は
   CDP を止めてしまうため、レンダラー側で必ず差し替える。

   ```js
   // メインプロセス側（フォルダ選択の自動化）
   const req = process.getBuiltinModule('module').createRequire('<project>/out/main/index.js')
   req('electron').dialog.showOpenDialog = () =>
     Promise.resolve({ canceled: false, filePaths: ['<project>'] })

   // レンダラー側（確認ダイアログでブロックさせない）
   window.__confirms = []
   window.confirm = (message) => {
     window.__confirms.push(message)
     return true
   }
   ```

### 結果が怪しいときの切り分け

操作が効いていないように見えたら、まずキーイベントが届いているかを確認する。
アプリの不具合と検証環境の問題を混同しない。

```js
window.__keys = []
document.addEventListener('keydown', (e) => window.__keys.push(e.key), false)
// 打鍵後に window.__keys が空なら、届いていないのは入力経路の問題
```

HMR で古いモジュールが残っている場合もある。判断に迷ったら
`Page.reload({ ignoreCache: true })` を挟んだ清浄な状態で測り直す。

## 落とし穴のまとめ

| 症状                                 | 原因                                                     | 対処                                                     |
| ------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------- |
| 新着レビューを検知できない           | `reviews(first:N)` が古い方から埋まる                    | `last:` を使い、件数にも余裕を持たせる                   |
| 依頼直後に「指摘なし」で監視が終わる | Copilot が受け取ると pending から外れる                  | 最低待機時間を設ける                                     |
| 監視が無言のまま動き続ける           | 実行中のスクリプトを in-place で上書きした               | 実行用にコピーしてから起動する                           |
| 打鍵が効かない                       | ウィンドウが OS フォーカスを失っている                   | `Emulation.setFocusEmulationEnabled`                     |
| アプリが増え続ける                   | `electron-vite dev` だけ落としている                     | Electron 本体も `pkill` する                             |
| 無関係なファイルが PR に入る         | `git add -A`                                             | `git add -u`                                             |
| 直したのにテストが最初から通る       | 失敗が握り潰されている                                   | `async`/`await` で書き、実装を戻して落ちることを確認する |
| シェルで `unbound variable` が出る   | 変数の直後に全角括弧などが続き、変数名の一部と解釈される | `${value}` のように波括弧で囲む                          |
