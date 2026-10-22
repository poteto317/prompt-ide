# `agentScreens.json`（`claude` の画面の台帳）

`agentInputBox.test.ts` が、`claude` の入力欄の判定（`findInputBox`・`isInputBoxEmpty`・`isPasteEchoed`）を、`claudeScreenActivity.test.ts` が
活動の判定（`classifyClaudeScreen`）を、実物の画面で固定するための台帳。
`claude` 2.1.288（中断を記録した 4 画面（streamingQueued は中断の前）〈`interrupted`・`interruptedDraft`・`streamingQueued`・`interruptedQueued`〉は `claude` 2.1.291）・node-pty 1.1.0・`@xterm/headless` 6.0.0 で、32 の画面（空・書きかけ・複数行・`[Pasted text #N]`・シェルのモード・`/` の候補・
入力欄が画面を超えた・作業中・送信待ち・信頼の確認・全画面の表示の案内・許可の確認・応答の表示中・ツールの実行中・中断の後など）を記録した。

形式: `screens.<名前>.lines` は 行番号 → `[文字列, dim の範囲, 反転の範囲]`（範囲は `[開始, 終わり)` のセルの位置）。文字列は幅 0 のセル
（全角の文字の右半分）を除いたセルの文字を連結し、末尾の空白（dim・反転でないもの）を除いたもの。入力欄の記号の後ろの U+00A0 は
JSON のエスケープ（`\u00a0`）で書かれている。**prettier やエディタで整形しない**（実物の文字に変わる・差分が大きくなる）。`.prettierignore` で `npm run format` の対象から外している。

## `claude` の版を上げたら記録し直す

入力欄の見え方（罫線・記号・U+00A0・字下げ・カーソルの反転・案内の dim）は `claude` の版で変わりうる。版を上げたら、記録用のスクリプト
（プランの作成時の `.superpowers/agent-terminal-mvp/agent-screens-recorder/`。隔離した設定ディレクトリ・ダミーの API キー・閉じたポートで、
Anthropic の API に接続せずに記録する）で記録し直し、下の「個人情報の置き換え」をかけてから写し、`agentScreensFixture.test.ts` の
`AGENT_SCREENS_SHA256` を更新してテストを流す。活動の判定の規則（スピナーの記号・要約の行・圧縮の行〈`✻ Conversation compacted …`。スピナーの行とみなさない〉・中断の案内・許可の問い・確認の案内）も
版で変わりうる。入力欄のある画面では、スピナーの行は入力欄の上の罫線から上へ空行と字下げのある行（1 桁目が空白の行。todo の一覧 `  ⎿  ☐ …`・tip `  ⎿  Tip: …` など）を飛ばした最初の行だけ、中断の案内は入力欄の下の案内の行だけで見る（会話の履歴に残る `✻ Conversation compacted …` などで作業中としないため）。
入力欄の上が画面の上端まで字下げの行で、上の罫線の上（空行を除いて最も近い）の字下げの行から上へ折り返しの継続行（字下げが todo の項目の記号の桁〈5 桁〉以上で、todo の項目の行でない行）を飛ばした最初の行（項目の先頭の行）が todo の項目の行（`☐☒◻◼` の記号の行。`⎿` の有無を問わない）か tip の行（`  ⎿  Tip: …`）でスピナーの行が見えない画面と、入力欄が画面の高さを超えて上の罫線が見えない画面は根拠が無いので `実行中`（unknown）。それ以外の字下げの行（画面より長い応答の継続行・箇条書き・ツールの結果・`!` のシェルのモードやスラッシュコマンドの出力の `⎿` の行。テストランナーの `✔ …` の行を含む）が上端まで続く画面は `入力待ち`（idle）。
todo の項目の記号は 2.1.288 で記録した画面が無い手書きの推測で、版で外れうる。todo の一覧が出る作業中の画面（書きかけあり）を記録できたら記号を確かめる。
スピナーと入力欄の間の位置の関係が変わったら、この見方も直す。許可の確認は、字下げのある番号付きの選択肢の行（` ❯ 1. Yes`）から上へ、空行・ほかの番号付きの選択肢の行（`   1. Yes`。番号の桁がカーソルの行と同じ行に限る。折り返した問いの `2.md?` を飛ばさないため）・その折り返しの行（番号の桁より深く字下げされた行）を飛ばした先の段落（番号の桁と同じかそれより浅い字下げの空でない行が続く間。空行・罫線の行 `╌╌╌╌` などで区切る）の先頭の行が `Do you want to ` で始まり、最後の行が `?` で終わる並びで見る（問いが画面の幅を超えると claude は 1 行目と同じ字下げで折り返すため。また、履歴に残る `❯ 1. …` のプロンプトや応答の継続行の `  Do you want to …` で許可待ちとしないため）。記録済みの許可の画面は 100 桁で問いが 1 行なので、折り返しは手書きの画面でテストしている。問いと選択肢の位置の関係・字下げが変わったら、この見方も直す。版に依存する規則は `agentInputBox.ts`（入力欄）と `claudeScreenActivity.ts`（活動）の定数に閉じているので、テストが落ちたらこの 2 つを直す。
画面を足し・消したら `claudeScreenActivity.test.ts` の期待の表（`EXPECTED`）も直す（全画面がどれかの期待に入っていないと落ちる）。

## 個人情報の置き換え（この台帳の作り方）

記録した画面には、記録した端末のユーザー名・UID・ホームのパス（記録時の一時ディレクトリ）と、セッションの UUID が出ていた
（ヘッダーの作業ディレクトリ、信頼の確認・許可の確認の画面のパス）。リポジトリには、それらを**同じ長さの ASCII の中立な文字列**に
置き換えたものを置く。置き換えるのは文字列の中身だけで、行の位置・セルの位置・罫線・入力欄の記号・U+00A0・dim と反転の範囲は変えない
（置き換えたのは ASCII のパスの部分だけなので、表示幅も変わらない）。JSON は読み直さず、ファイルの文字列のまま置き換える（整形・エスケープを保つ）。

- 元の台帳: `.superpowers/agent-terminal-mvp/agent-screens.json`（リポジトリの外。SHA-256 `fc6004d3789e2cd62e36284590604a894c687386dd5ab9cdc449ef84e3d62e43`。中断を記録した 4 画面（streamingQueued は中断の前）を足す前は `95518dc8e65f2deb885a50e323053a65bf5fc0d15e9436b66c897c7893af800d`（プランの差異 22 の値と一致することを、写す前に確かめた））
- 置き換えた後（このディレクトリの `agentScreens.json`）: SHA-256 `115ede7dcb490819282a541cc26f01291e2e495993c6f9c4e0fac9e0511b353a`（`agentScreensFixture.test.ts` で固定）
- 変わった行: 34 行（ヘッダーの作業ディレクトリ 25 行・信頼の確認のパス 1 行・許可の確認の 2 画面で折り返されたパス 4 行・中断を記録した 4 画面（streamingQueued は中断の前）のヘッダーの作業ディレクトリ〈`/…/<UUID>/scratchpad/fixrec/work` の UUID〉 4 行）。ファイルの大きさは同じ

置換の規則（決定的。この順にかける）:

1. 記録時の一時ディレクトリ `/private/tmp/claude-<UID>/-Users-<ユーザー名>-<…>`（正規表現 `/private/tmp/claude-\d+/-Users-[^/"]+`）を、
   `/home/user/project/` の後ろを `x` で埋めた同じ長さの文字列にする
2. UUID（`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`）の 16 進の文字をすべて `0` にする（`-` は残す）
3. 画面の右端で 2 行に折り返された UUID（ある行の文字列の末尾と、次の行の文字列の字下げの後をつなげると UUID になるもの）も、
   両方の 16 進の文字を `0` にする

置換のスクリプト（`python3 sanitize.py <元の agent-screens.json> <写し先の agentScreens.json>`）:

```python
import re
import sys

src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding='utf-8').read()
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
NEUTRAL_PREFIX = '/home/user/project/'


def zero_hex(s):
    return re.sub(r'[0-9a-f]', '0', s)


def neutral_path(m):
    n = len(m.group(0))
    assert n >= len(NEUTRAL_PREFIX)
    return NEUTRAL_PREFIX + 'x' * (n - len(NEUTRAL_PREFIX))


# 1. 記録時の一時ディレクトリ
text = re.sub(r'/private/tmp/claude-\d+/-Users-[^/"]+', neutral_path, text)
# 2. UUID
text = UUID.sub(lambda m: zero_hex(m.group(0)), text)


# 3. 折り返された UUID。JSON では画面の行ごとに別の配列なので、間の `"` `],` `"<行番号>": [` `"` と字下げを挟んでつなげて判定する
def wrapped(m):
    head, gap, tail = m.group(1), m.group(2), m.group(3)
    if UUID.fullmatch(head + tail) is None:
        return m.group(0)
    return zero_hex(head) + gap + zero_hex(tail)


text = re.sub(r'([0-9a-f-]+)("\n\s*\],\n\s*"\d+": \[\n\s*" *)([0-9a-f-]+)', wrapped, text)

open(dst, 'w', encoding='utf-8', newline='').write(text)
```

置き換えの後、元の台帳と置き換えた台帳の両方に同じ判定（全画面の `findInputBox` の記号・行数、`isInputBoxEmpty`）をかけ、結果が
一致することを確かめた。個人情報（`/Users/`・`-Users-`・`/home/user/` 以外のホーム・`claude-<UID>`・`/private/tmp`・ゼロ以外の UUID・メールアドレス・`sk-`・`ghp_` など。ユーザー名や UID の実値はテストにも書かない）が
含まれないことは `agentScreensFixture.test.ts` で固定している。記録し直したときに新しい種類の個人情報（別のパスの形など）が出たら、
規則とテストの両方に足す。

# `copilotScreens.json`（`copilot` の画面の台帳）

`copilotScreenActivity.test.ts` が `copilot` の活動の判定（`classifyCopilotScreen`）を、`agentScreenClassifiers.test.ts`・`agentInterrupt.test.ts`・`useAgentActivity.test.ts`・`useAgentInterrupt.test.ts`・`useAgentWorkspace.test.ts` が種類ごとの判定の配線を、実物の画面で固定するための台帳。
GitHub Copilot CLI 1.0.87・node-pty 1.1.0・`@xterm/headless` 6.0.0 で記録した 48 の画面（フォルダの信頼の確認・入力待ち・書きかけ・作業中〈最初の応答の前・推論中・ツールの実行中・キュー〉・Esc 1 回の直後・中断の後・許可の確認・巻き戻しの画面・ヘルプ・`/` の一覧・シェルのモード・終了の後・80 列・60 列・40 列・`--screen-reader`）を、
段階 0 の記録（`.superpowers/agent-cli-kind/copilot-screens-recorder/out/*/snaps.json`。リポジトリの外）から写した（新しく記録はしていない。場面と期待は設計書 `docs/superpowers/specs/2026-10-21-agent-cli-copilot-screen-design.md` の「実装の最初に確かめること」）。

形式は `agentScreens.json` と同じ（`screens.<名前>.lines` は 行番号 → `[文字列, dim の範囲, 反転の範囲]`）。文字列は記録の文字列の末尾の空白を除いたもの。空の行は省く。選んだ場面に全角の文字は無い（列の位置がそのままセルの位置）。
列・行の数は、場面の `label` に大きさがあればそれ（`resized60` は 60 × 20）、無ければフォルダの名前の列の数と記録の行の数。記録に反転の属性は無い（`copilot` は自前のカーソルを描く）。**prettier やエディタで整形しない**（`.prettierignore` で外している）。

## `copilot` の版を上げたら記録し直す

判定の規則（帯の中断の案内 `esc interrupt`・`esc again to interrupt`、帯の先頭のスピナー `○◎◉●`、入力欄の罫線と記号、選択の案内、許可の問い `Do you want to `）は `copilot` の版で変わりうる。版に依存する規則は `copilotScreenActivity.ts` の定数に閉じている。
版を上げたら、段階 0 の記録用のスクリプト（`.superpowers/agent-cli-kind/copilot-screens-recorder/rec.js`。偽のローカルの提供元と一時の `HOME`・`COPILOT_HOME` で、GitHub のサービスに接続せずに記録する）で記録し直し、同じフォルダの `to-fixture.js`（変換）と `sanitize-copilot.py`（下の置き換え）をかけてから写し、`copilotScreensFixture.test.ts` の `COPILOT_SCREENS_SHA256` を更新してテストを流す。
画面を足し・消したら `copilotScreenActivity.test.ts` の期待の表（`EXPECTED`）も直す（全画面がどれかの期待に入っていないと落ちる）。

## 個人情報の置き換え（`copilotScreens.json` の作り方）

記録した画面には、記録した端末のユーザー名・UID（記録時の一時ディレクトリ）と UUID が出ていた（入力欄の上の作業ディレクトリの行、フォルダの信頼の確認の枠の中のパス、許可の確認の選択肢のパス、終了の画面の `copilot --resume=<UUID>`）。`agentScreens.json` と同じく、同じ長さの ASCII の中立な文字列に置き換えたものを置く。

- 変換の後・置き換えの前（`to-fixture.js` の出力。リポジトリの外）: SHA-256 `6a1673c5ba581c71a2f26fa79a1484f4574a3bff6fb4678df86493e1d0438e95`
- 置き換えた後（このディレクトリの `copilotScreens.json`）: SHA-256 `8fe11e4ae5507f1859cbe61dc754062e904e15fd106adff978d1479a41154aaf`（`copilotScreensFixture.test.ts` で固定）
- 変わった行: 41 行（入力欄の上の作業ディレクトリ 34 行・`.../` で省略された作業ディレクトリ 3 行〈`resized60`・`idle40`・`working40`〉・信頼の確認の枠の中のパス 2 行〈`trust`・`srTrust`〉・`permission3` の選択肢のパス 1 行・`exited` の `--resume` の UUID 1 行）。ファイルの大きさは同じ

置換の規則: 上の `agentScreens.json` の節の規則 1・2・3 に、規則 1 の後に次の規則 1' を足して、この順にかける。

1'. `/private/tmp/claude-<UID>/` で始まり `-Users-` を含まない（`.../` で省略された）パス（正規表現 `/private/tmp/claude-\d+/[^\s")]*`）も、規則 1 と同じく `/home/user/project/` の後ろを `x` で埋めた同じ長さの文字列にする

置換のスクリプト（`python3 sanitize-copilot.py <to-fixture.js の出力> <写し先の copilotScreens.json>`）は、上の `sanitize.py` の `# 1. 記録時の一時ディレクトリ` の置き換えの行の後ろに次の 2 行を足したもの:

```python
# 1'. `.../` で省略された一時ディレクトリのパス(-Users- を含まない)
text = re.sub(r'/private/tmp/claude-\d+/[^\s")]*', neutral_path, text)
```

個人情報（`/Users/`・`-Users-`・`/home/user/` 以外のホーム・`claude-<UID>`・`/private/tmp`・ゼロ以外の UUID・メールアドレス・`sk-`・`ghp_` など）が含まれないことは `copilotScreensFixture.test.ts` で固定している。
