# ソース管理の履歴のグラフ(第 2 段階)

## 背景

ソース管理を VS Code と同じ形にする作業の第 2 段階(第 1 段階は `2026-10-30-status-bar-branch-picker-design.md`)。今の履歴は今のブランチのコミットを並べただけで、線が無く、ブランチの位置も、リモートとの関係も分からない。利用者は「何が最新か分からない」と指摘している。これを VS Code の Source Control Graph と同じ形にする。

第 3 段階(パネルの配置)はこの設計書の範囲外。

## 要件

### 表示するコミット

1. VS Code の既定(`Auto`)と同じく、現在の HEAD と、その上流ブランチから辿れるコミットを表示する。上流が無いとき(未設定・消えている・detached)は HEAD だけを表示する。
2. 並びは `--topo-order`。親より子が必ず上に来る。
3. 1 ページ 20 件の `もっと見る` は今のまま使う。読み込んだ全件でグラフを組み立て直す。

### 1 行の表示

4. 左から順に、グラフ、件名(コミットメッセージの 1 行目)、作成者(薄い色)、右端に位置のラベルを出す。件名は省略記号で切り詰める。
5. ハッシュと相対日時は行に見える形では出さない。行の `title` に、件名、ハッシュの先頭 7 文字、作成者、相対日時を改行で区切って入れる。`title` はフォーカスできない `li` に付くため、ハッシュの先頭 7 文字と相対日時は視覚的に隠したテキストとしても行に入れる。
6. 位置のラベルは、そのコミットを指す ref ごとに出す。現在のブランチは青系、リモートは紫系、ほかのローカルブランチとタグは灰色系で、種類の分かるアイコンを付ける(ブランチ・リモート・タグ)。
7. リモートの `*/HEAD`(`origin/HEAD`)は出さない。
8. ラベルは 1 行に 2 つまで出す。優先は現在のブランチ、リモート、タグ、ほかのローカルブランチの順。残りは `+N` のラベルにまとめ、その `title` に残りの名前を入れる。ラベルの列全体の幅の上限は行の 45% とし、各ラベルは省略記号で切り詰めて全文を `title` に入れる。幅が足りないときは 2 つ目から縮め、アイコンだけ(20px)まで残す。先頭は 40px を下回らない。ラベルが 2 つ以上の列は縮めず(`+N` が切れないよう、足りない幅はグラフが譲る)、1 つの列は 40px まで縮む。

### グラフ

9. VS Code の swimlane と同じ方式で組み立てる(下の「組み立て」)。
10. 1 行の高さは 22px、レーンの幅は 11px。
11. 線の色は VS Code の既定の 5 色(`#FFB000`、`#DC267F`、`#994F00`、`#40B0A6`、`#B66DFF`)を順に使う。ただし HEAD のレーンは `#59A4F9`、上流のレーンは `#B180D7` にする。
12. 通常のコミットは塗りつぶしの円、HEAD は太い輪、マージコミット(親が 2 つ以上)は二重の輪で描く。HEAD がマージコミットのときは HEAD の太い輪を優先する。
13. グラフの SVG は `aria-hidden`。情報は件名・作成者・ラベルと `title` で伝える。`title` だけの情報と、色とアイコンだけの情報は、視覚的に隠したテキストでも伝える(スクリーンリーダーとキーボードの利用者のため)。行にハッシュの先頭 7 文字と相対日時、各ラベルの名前の前に種類(`現在のブランチ`、`リモート`、`タグ`、`ブランチ`)、`+N` に残りの ref の種類と名前を入れる。
14. レーンが増えても件名が読めるよう、グラフの幅の上限は行の幅の 50% とし、超えた分は切る。件名と作成者の欄は行の 40% を保つ。

### タグのバッジの扱い

15. 履歴の上部のタグのバッジ(`.history-section__badges`)を削除する。タグはコミットの行に出す。
16. `HistorySection` の `tags` と `branches` の prop は、タグの作成の検証に使うため残す。

### amend の直前のメッセージ

17. 上流が HEAD より進んでいると、`log[0]` は HEAD ではなくなる。そのため `lastCommitMessage` を `log[0]` から取るのをやめる。誤ると、amend の欄に別のコミットのメッセージが入る。
18. HEAD のメッセージを取る IPC `git:getHeadCommitMessage` を足す。`git log -1 --no-show-signature --pretty=format:%B HEAD --` を使い、`getLog` と同じく `%B` の全文を `trim()` して返す。null はリポジトリでない・コミットが無いときだけで、空のメッセージのコミットは `''` を返す(今と同じく amend できる。`|| null` にしない)。
19. `useGitHistory` が履歴の取得と同時にこれを取得し、`headCommitMessage` として持つ。失敗は `null` として扱い(amend が押せないだけで、履歴の表示は止めない)、履歴の取得の失敗時とフォルダなしのときも null に戻す。
20. `App` は `lastCommitMessage={headCommitMessage}` を渡す。`CommitSection` の「null はコミットが無い」の意味は変わらない。`log[0]` を前提に書いたコメント(`CommitSection.tsx`、`useGitHistory.ts`)も直す。

### 履歴の取り直し

21. fetch・pull・push の後(失敗の後も取り直す。既存の共有ランナーの動作)と、ソース管理の `更新` で、履歴も取り直す。今は Git の状態しか取り直さないため、上流のコミットが出ず、`origin/main` のラベルも古いコミットに残る。取り直すと `もっと見る` で読み込んだ分は先頭のページに戻る(コミットの後と同じ)。
22. 操作の途中でフォルダを切り替えた場合、古いフォルダの操作の完了が呼ぶ `refresh` は何もしない。新しいフォルダの読み込み、`isLoading`、`headCommitMessage` を壊さない。

## 取得

`getLog` は次を実行する。

```
git log --topo-order --no-show-signature --decorate=full \
  --decorate-refs=refs/heads/ --decorate-refs=refs/remotes/ --decorate-refs=refs/tags/ --decorate-refs=HEAD \
  --max-count=<limit> --skip=<skip> --pretty=format:<format> HEAD [<upstream>] --
```

- 上流は `git rev-parse --symbolic-full-name @{upstream}` で取る。`GitError`(上流が無い、detached、コミットが無い)のときは上流なしとする。`GitError` 以外は投げ直す(`getLog` の既存の判定と同じ)。`refs/` で始まらない出力も上流なしとする(上流の ref が無く、同名のファイルがあると、終了コード 0 で `@{upstream}` が返るため)。
- format は `%H%x1f%P%x1f%D%x1f%B%x1f%aI%x1f%an%x1e`。
- `--no-show-signature`: `log.showSignature=true` だと署名の検証結果がレコードの前に付き、`%H` と本文が汚れる。
- `--decorate-refs=...`: `log.excludeDecoration` の設定を打ち消す。無いと `HEAD` やリモートの装飾が消える。
- 末尾の `--`: 作業ツリーに `HEAD` というファイルがあると、引数が曖昧で失敗するのを防ぐ(macOS では小文字の `head` でも起きる)。`--` があっても、コミットが無いときは既存の判定で `[]` になる。
- `--decorate=full` を付けると `%D` は完全な ref 名になり、`log.decorate` の設定に影響されない(実機で確認)。例: `HEAD -> refs/heads/main`、`refs/remotes/origin/main`、`tag: refs/tags/v1`、detached は `HEAD, refs/heads/main`。
- 短い形式だと `origin/main` とローカルの `foo/bar` を区別できないため使わない。

型:

```ts
export type GitLogRefKind = 'current' | 'branch' | 'remote' | 'tag'
export interface GitLogRef {
  kind: GitLogRefKind
  /** refs/heads/ などを除いた短い名前(origin/main) */
  name: string
}
export type GitLogEntry = {
  hash: string
  /** 親のハッシュ。ルートコミットは空 */
  parents: string[]
  refs: GitLogRef[]
  /** HEAD が指すコミットか(detached を含む) */
  isHead: boolean
  message: string
  date: string
  authorName: string
}
```

`parseGitLogOutput` は先頭 3 欄と末尾 2 欄の位置が決まっている前提で、余った欄を本文に結合する(今の方式を保つ)。フィールド数の下限は 6。`hash` は `/^[0-9a-f]{40,64}$/` で検査し、本文に区切り文字が混ざった断片を読み飛ばす。`%D` の解釈は `parseGitLogRefs(decoration)` に分ける。`HEAD -> refs/heads/x` は `current`、単独の `HEAD` は `isHead` のみ(detached)、`refs/heads/` は `branch`、`refs/remotes/` は `remote`(`*/HEAD` は除く)、`tag: refs/tags/` は `tag`、それ以外は無視する。

## 組み立て

`src/renderer/src/lib/gitGraph.ts` の純粋関数 `buildGitGraphRows(log, upstream)` が行ごとの描画情報を返す。

```ts
export interface GitGraphSegment {
  /** through: 行を素通りする線。toCircle: 上から円へ入る線。fromCircle: 円から下へ出る線 */
  kind: 'through' | 'toCircle' | 'fromCircle'
  fromLane: number
  toLane: number
  color: string
}
export interface GitGraphRow {
  entry: GitLogEntry
  circleLane: number
  circleColor: string
  segments: GitGraphSegment[]
  /** 描画に要るレーン数。max(入力レーン数, 出力レーン数, circleLane + 1) */
  laneCount: number
}
```

VS Code の `toISCMHistoryItemViewModelArray` と同じ手順を使う。前の行の出力レーン(`{ id, color }` の配列)を入力レーンとする。

コミットの ref の色(`refColor`)を次で決める。HEAD のコミットは `#59A4F9`。それ以外で `refs` のどれかの `name` が `upstream` と一致するコミットは `#B180D7`(kind は問わない。`branch.x.remote=.` のローカルの上流も含む)。どちらでもなければ無し。HEAD と上流が同じコミットなら HEAD を優先する。`upstream` は `gitStatus.upstream`(短い名前)。

1. 円のレーンは、入力レーンで `id` がコミットのハッシュに一致する最初のレーン。無ければ入力レーンの末尾の位置。
2. 円の色は、`refColor`、無ければ入力レーンの色、新しいレーンなら 5 色の次の色。
3. 出力レーンを作る。各出力レーンは元の入力レーンの位置(`sourceLane`)を覚える。入力レーンを順に見て、ハッシュに一致するレーンの最初の 1 本は第 1 親のレーンに置き換え(色は `refColor`、無ければ入力レーンの色)、一致する 2 本目以降は捨てる(ここで合流する)。一致しないレーンはそのまま残す。親が無ければ、一致したレーンも消える。
4. 入力レーンに一致が無く親があるときは、`id` が第 1 親のレーンを、円の色で出力の末尾に足す。
5. 第 2 親以降は、出力レーンに同じ `id` があれば、その最後の 1 本へ線を引く。無ければ新しいレーンを出力の末尾に足す。色は、その親が読み込み済みで `refColor` を持てばそれ、無ければ 5 色の次の色。
6. 線を作る。線の対応は `id` ではなく位置で取る。
   - 残った入力レーンは、`sourceLane` が同じ出力レーンへ `through`。色は入力レーンの色。
   - 一致した入力レーンは、円へ `toCircle`。色は入力レーンの色。
   - 第 1 親の出力レーンへ `fromCircle`(行き先は常に円のレーンと同じか、手順 4 の末尾)。色は出力レーンの色。
   - 第 2 親以降は手順 5 で決めた出力レーンへ `fromCircle`。色は出力レーンの色。

同じ親を持つレーンが複数あるときも、位置で対応させるので線は切れない。例: `M(B,F) F(A) B(A) A(R)` の行 `B` は、入力 `[B, A]`、出力 `[A, A]` で、レーン 1 は 1 へ `through`、レーン 0 は `toCircle` と `fromCircle`。次の行 `A` で 2 本が合流する。

未読み込みの親へ向かうレーンは、そのまま一覧の下端まで伸びる。

## 構成

- `src/shared/types/git.ts`: `GitLogRef` などの型
- `src/main/gitLogFormatter.ts`: format の解析、`parseGitLogRefs`
- `src/main/gitService.ts`: `getLog` の引数、`getHeadCommitMessage`
- `src/main/handlers/gitHandlers.ts`、`src/preload/api.ts`、`src/preload/index.d.ts`、`src/renderer/src/lib/gitApi.ts`: IPC
- `src/renderer/src/hooks/useGitHistory.ts`: `headCommitMessage`
- `src/renderer/src/lib/gitGraph.ts`(新規): 組み立て
- `src/renderer/src/components/source-control/GitGraphCell.tsx`(新規): 1 行の SVG
- `src/renderer/src/components/source-control/GitLogRefLabels.tsx`(新規): 位置のラベル
- `src/renderer/src/components/icons/`: リモートとタグのアイコン
- `HistorySection.tsx`、`GitRepoView.tsx`、`SourceControlPanel.tsx`: 表示と `upstream` の受け渡し
- `src/renderer/src/hooks/useGitRemoteOperations.ts`、`App.tsx` などの配線: fetch・pull・push と `更新` の後の履歴の取り直し
- `src/renderer/src/assets/main.css`: `.history-section__badge*` の削除、グラフの行のスタイル
- `App.tsx`: `lastCommitMessage`
- `docs/developer-guide.md`: 関連する記述があれば同期する

## 決めたこと

- 表示の対象は VS Code の既定と同じ HEAD と上流にする。全ブランチの表示と、対象を選ぶ操作は入れない。
- 見出しは `履歴` のままにする。
- 行を押してコミットの差分を開く操作、Incoming / Outgoing の区切り、右クリックのメニュー、ツールバーのボタンは入れない(グラフの描画と位置の表示に絞り、1 つの PR に収めるため)。

## 既知の制約

- 上流のコミットは最後に fetch した時点まで。
- 端末で行ったコミットや fetch は、`更新` を押すかアプリで操作するまで反映されない。
- ラベルが 2 つ以上の行は、`+N` を切らないことを優先するため、レーンが多いとグラフが約 2 レーン分まで細くなり、右のレーンが見えないことがある。
- オフセットのページングのため、`もっと見る` の間にアプリ外で履歴が変わると、グラフの線がずれることがある(既存の重複除去は保つ)。次の取り直しで直る。

## テスト

- `gitLogFormatter`: 新しい format、親、ref の種類、`origin/HEAD`、detached、本文に区切り文字が混ざる場合、`hash` の検査。
- `gitService`: 実 git で、上流あり・上流が先行・上流なし・detached・コミットなしの `getLog`、`getHeadCommitMessage`。上流が先行するとき `getHeadCommitMessage` が HEAD のメッセージを返すこと。`log.showSignature=true` の署名付きコミット、`log.excludeDecoration` の設定、作業ツリーの `HEAD` ファイル、空のメッセージのコミット(`''`)。
- `gitGraph`: 1 コミットだけ、直線、分岐、マージ、タコマージ、同じ親への 3 本の合流、ルート、未読み込みの親、HEAD と上流の色、優先、ローカルの上流、5 色の循環。すべての行で「出力レーンのそれぞれに線が入る」ことを固定する。
- `GitGraphCell`: 円の種類、線の本数、`aria-hidden`。
- `HistorySection`: 行の表示、`title`、ラベル、タグのバッジが無いこと、タグの作成の検証が動くこと。
- `useGitHistory`: `headCommitMessage` の取得、失敗、フォルダなし。
- `App`: 上流が先行していても amend の欄に HEAD のメッセージが入ること。`gitApi` を個別にモックしている App 系のテストに `getHeadCommitMessage` を足す。
- `useGitRemoteOperations` など: fetch・pull・push の後と `更新` で履歴を取り直すこと。失敗でもエラーの表示と実行中フラグが保たれること。
- `useGitHistory`: フォルダの切り替えの後に古い `refresh` を呼んでも、新しいフォルダの読み込みと `isLoading` と `headCommitMessage` を壊さないこと(完了が読み込みの前と後の 2 通り)。
- `docs/manual-test-spec.md`: GIT-069、GIT-070、RMT-025、RMT-028、TAG-006、TAG-008、タグの節の前提などバッジに依存する項目を直し、新しい項目を足す。
