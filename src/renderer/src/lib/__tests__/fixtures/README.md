# `agentScreens.json`（`claude` の画面の台帳）

`agentInputBox.test.ts` が、`claude` の入力欄の判定（`findInputBox`・`isInputBoxEmpty`・`isPasteEchoed`）を、`agentActivity.test.ts` が
活動の判定（`classifyAgentScreen`）を、実物の画面で固定するための台帳。
`claude` 2.1.288・node-pty 1.1.0・`@xterm/headless` 6.0.0 で、28 の画面（空・書きかけ・複数行・`[Pasted text #N]`・シェルのモード・`/` の候補・
入力欄が画面を超えた・作業中・送信待ち・信頼の確認・全画面の表示の案内・許可の確認・応答の表示中・ツールの実行中など）を記録した。

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
スピナーと入力欄の間の位置の関係が変わったら、この見方も直す。許可の確認は、字下げのある番号付きの選択肢の行（` ❯ 1. Yes`）から上へ、空行・ほかの番号付きの選択肢の行（`   1. Yes`。番号の桁がカーソルの行と同じ行に限る。折り返した問いの `2.md?` を飛ばさないため）・その折り返しの行（番号の桁より深く字下げされた行）を飛ばした先の段落（番号の桁と同じかそれより浅い字下げの空でない行が続く間。空行・罫線の行 `╌╌╌╌` などで区切る）の先頭の行が `Do you want to ` で始まり、最後の行が `?` で終わる並びで見る（問いが画面の幅を超えると claude は 1 行目と同じ字下げで折り返すため。また、履歴に残る `❯ 1. …` のプロンプトや応答の継続行の `  Do you want to …` で許可待ちとしないため）。記録済みの許可の画面は 100 桁で問いが 1 行なので、折り返しは手書きの画面でテストしている。問いと選択肢の位置の関係・字下げが変わったら、この見方も直す。版に依存する規則は `agentInputBox.ts`（入力欄）と `agentActivity.ts`（活動）の定数に閉じているので、テストが落ちたらこの 2 つを直す。
画面を足し・消したら `agentActivity.test.ts` の期待の表（`EXPECTED`）も直す（全画面がどれかの期待に入っていないと落ちる）。

## 個人情報の置き換え（この台帳の作り方）

記録した画面には、記録した端末のユーザー名・UID・ホームのパス（記録時の一時ディレクトリ）と、セッションの UUID が出ていた
（ヘッダーの作業ディレクトリ、信頼の確認・許可の確認の画面のパス）。リポジトリには、それらを**同じ長さの ASCII の中立な文字列**に
置き換えたものを置く。置き換えるのは文字列の中身だけで、行の位置・セルの位置・罫線・入力欄の記号・U+00A0・dim と反転の範囲は変えない
（置き換えたのは ASCII のパスの部分だけなので、表示幅も変わらない）。JSON は読み直さず、ファイルの文字列のまま置き換える（整形・エスケープを保つ）。

- 元の台帳: `.superpowers/agent-terminal-mvp/agent-screens.json`（リポジトリの外。SHA-256 `95518dc8e65f2deb885a50e323053a65bf5fc0d15e9436b66c897c7893af800d`。プランの差異 22 の値と一致することを、写す前に確かめた）
- 置き換えた後（このディレクトリの `agentScreens.json`）: SHA-256 `6e9c974e411fcff545460a5b739089ca3c6ce5d309823453889556d8eda36c8d`（`agentScreensFixture.test.ts` で固定）
- 変わった行: 30 行（ヘッダーの作業ディレクトリ 25 行・信頼の確認のパス 1 行・許可の確認の 2 画面で折り返されたパス 4 行）。ファイルの大きさは同じ

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
