#!/bin/bash
# PR のレビュー到着を一定間隔で確認する。
#
#   - 新しいレビューが届いたら内容（未解決スレッドと suppressed comments の件数）を
#     出力して終了する
#   - レビュー依頼が保留中（レビュー中）の間は静かに待ち続ける
#   - 依頼も保留も無く新着も無ければ NO PENDING REVIEW を出力して終了する
#     ただし最低待機時間を過ぎるまでは終了しない（理由は下記）
#   - 最大待機時間を過ぎたら WATCH TIMEOUT を出して終了コード 3 で終わる
#
# 出力の意味:
#   REVIEW ARRIVED   新着レビューを解釈できた（NO FINDINGS が続けば指摘 0 件）
#   NO FINDINGS      未解決スレッドも suppressed comments も 0 件。収束の判断はこれで行う
#   REVIEW NOT RUN   レビュージョブが実行されていない（課金・上限を確認する）
#   NO REVIEW BODY   新着はあるがレビュー本文として解釈できない（形式が変わった可能性）
#   NO PENDING REVIEW / NO NEW REVIEW  依頼も保留も新着も無い
#   WATCH TIMEOUT    最大待機時間まで何も起きなかった
#
# 終了コード（呼び出し元が分岐できるよう、原因ごとに分ける）:
#   0   レビューが届いた / 新着なしで終了した
#   1   API 呼び出しが連続で失敗した
#   2   レビュージョブが実行されていない（REVIEW NOT RUN）
#   3   最大待機時間に達した（WATCH TIMEOUT）
#   4   レビューは届いたが、その後にジョブ未実行の通知がある（指摘は出力済み）
#   64  引数の指定が誤っている（usage）
#
# usage:
#   bash scripts/watch-pr-review.sh <owner> <repo> <pr-number> <baseline-iso8601> [min-wait-sec] [interval-sec] [max-wait-sec]
#
# 例:
#   bash scripts/watch-pr-review.sh poteto317 prompt-ide 28 "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
#
# baseline より後に投稿されたレビューだけを「新着」とみなす。レビューを依頼した
# 直後の時刻を渡すこと。
#
# 注意（実際に踏んだ落とし穴）:
#   - GraphQL の reviews / reviewThreads は first ではなく last を使う。レビューを
#     重ねると first は古い方から埋まり、最新の到着がページの外に出て検知できない。
#     件数は GraphQL の上限(100)まで取る。スレッドへの返信も review として記録される
#     ため、人間側のレビューが積み上がると Copilot のレビューが窓から押し出される
#     （実測: 1 つの PR でレビュー 81 件、うち人間側 37 件）。
#   - Copilot は依頼を受け取ると reviewRequests から外れるため、依頼直後でも
#     pending が空に見える。その状態を「新着なし」と判断して終了すると、数分後に
#     届くレビューを取りこぼす。そのため最低待機時間（既定 1500 秒）を設けている。
#   - 実行中にこのファイルを上書きしないこと。bash は実行中もファイルを読み進めるため、
#     動作が壊れる。編集する場合は別名にコピーしたものを実行する。
#   - API の失敗は握り潰さない。レビュー待ちは静かでよいが、認証切れ・ネットワーク
#     不調・rate limit を黙って無視すると、待っているのか壊れているのか分からない。
#     失敗は stderr に出し、連続で続いたら終了する。
#   - 応答の判定を grep で行わない。GraphQL は HTTP 200 のまま errors を返すことが
#     あり、一方でレビュー本文に "errors" のような文字列が含まれることもある。
#     JSON として解釈したうえで、トップレベルの errors と pullRequest を見る。
set -u

usage() {
  echo "usage: bash $0 <owner> <repo> <pr-number> <baseline-iso8601> [min-wait-sec] [interval-sec] [max-wait-sec]" >&2
  # 引数の誤りを REVIEW NOT RUN（2）や WATCH TIMEOUT（3）と同じコードで返すと、
  # 呼び出し元が「課金が壊れている」と誤って判断する
  exit 64
}

if [ "$#" -lt 4 ]; then
  usage
fi

OWNER="$1"
REPO="$2"
PR="$3"
# request-copilot-review.sh の出力は "baseline: 2026-..." の形。行ごと貼られても
# 動くよう前置きと空白を落とす。落とさないと比較が常に偽になり、新着を検知できない
BASELINE="${4#baseline:}"
BASELINE="$(printf '%s' "$BASELINE" | tr -d '[:space:]')"
MIN_WAIT="${5:-1500}"
INTERVAL="${6:-120}"
# レビュー依頼が保留のまま返ってこないことがある。上限を設けないと無言で回り続け、
# 呼び出し元（自走ループ）がそこで止まる
MAX_WAIT="${7:-5400}"

# 数値以外を渡されると GraphQL エラーや Python の例外になり、原因が分かりにくい。
# 起動時に弾いて usage を出す
for value in "$PR" "$MIN_WAIT" "$INTERVAL" "$MAX_WAIT"; do
  case "$value" in
    '' | *[!0-9]*)
      echo "数値で指定してください: pr-number / min-wait-sec / interval-sec / max-wait-sec（受け取った値: ${value}）" >&2
      usage
      ;;
  esac
done
# 形式が違うと比較が黙って狂うため、ここで弾く
case "$BASELINE" in
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z) ;;
  *)
    echo "baseline は 2026-08-21T18:00:00Z の形式で指定してください（受け取った値: ${BASELINE}）" >&2
    usage
    ;;
esac

if [ "$INTERVAL" -lt 1 ]; then
  echo "interval-sec は 1 以上で指定してください" >&2
  usage
fi
if [ "$MAX_WAIT" -lt "$MIN_WAIT" ]; then
  echo "max-wait-sec は min-wait-sec 以上で指定してください" >&2
  usage
fi

# Copilot のレビュアー。login の末尾で見ると dependency-reviewer のような
# 別の reviewer 系 Bot まで拾ってしまうため、厳密一致で判定する
COPILOT_LOGIN="${COPILOT_REVIEWER_LOGIN:-copilot-pull-request-reviewer}"
STARTED=$(date +%s)
# API 呼び出しが連続で失敗したら終了する回数。認証切れやネットワーク不調を
# 握り潰したまま無言で回り続けると、待っているのか壊れているのか分からなくなる
MAX_FAILURES=5
failures=0
# テンプレートを明示する。macOS の mktemp は引数なしでも動くが、usage 上は
# template が必須で、環境によっては失敗する
err_file=$(mktemp "${TMPDIR:-/tmp}/watch-pr-review.XXXXXX")
trap 'rm -f "$err_file"' EXIT

# 失敗を数え、上限に達したら終了する。第 2 引数以降は原因の詳細
record_failure() {
  headline="$1"
  shift
  failures=$((failures + 1))
  {
    echo "${headline}（${failures}/${MAX_FAILURES}）"
    if [ "$#" -gt 0 ] && [ -n "$1" ]; then
      printf '%s\n' "$@"
    fi
  } >&2
  if [ "$failures" -ge "$MAX_FAILURES" ]; then
    echo "${MAX_FAILURES} 回連続で失敗したため監視を終了する" >&2
    exit 1
  fi
}

while true; do
  # owner / repo は変数で渡す。クエリ文字列に直接埋めると、引用符やバックスラッシュを
  # 含む名前でクエリ自体が壊れ、原因が GraphQL の構文エラーに化ける
  if ! out=$(gh api graphql -f query='
  query($owner:String!,$repo:String!,$pr:Int!){
    repository(owner:$owner,name:$repo){pullRequest(number:$pr){
      reviews(last:100){nodes{author{__typename login} submittedAt body}}
      reviewRequests(first:100){nodes{requestedReviewer{__typename ... on Bot {login} ... on User {login}}}}
    }}
  }' -f owner="$OWNER" -f repo="$REPO" -F pr="$PR" 2>"$err_file"); then
    record_failure "gh api graphql に失敗" "$(head -3 "$err_file")"
    sleep "$INTERVAL"
    continue
  fi

  # スレッドは 1 ページに収まらないことがある。last:100 で窓を切ると古い未解決
  # スレッドが見えなくなり、「指摘なし」の判断を誤るため、ページングして全件取る
  if ! threads_out=$(gh api graphql --paginate -f query='
  query($owner:String!,$repo:String!,$pr:Int!,$endCursor:String){
    repository(owner:$owner,name:$repo){pullRequest(number:$pr){
      reviewThreads(first:100, after:$endCursor){
        pageInfo{hasNextPage endCursor}
        nodes{isResolved path line}
      }
    }}
  }' -f owner="$OWNER" -f repo="$REPO" -F pr="$PR" 2>"$err_file"); then
    record_failure "レビュースレッドの取得に失敗" "$(head -3 "$err_file")"
    sleep "$INTERVAL"
    continue
  fi

  # 応答の解釈もここで行う。失敗（errors を含む・pullRequest が無い・壊れた JSON）は
  # 終了コードで伝わるため、シェル側は同じ経路で失敗として数えられる
  if ! verdict=$(printf "%s\n%s" "$out" "$threads_out" | BASELINE="$BASELINE" COPILOT_LOGIN="$COPILOT_LOGIN" python3 -c '
import sys, json, os, re

baseline = os.environ["BASELINE"]
copilot_login = os.environ["COPILOT_LOGIN"]


# --paginate はページごとの JSON をそのまま連結して出すため、まとめて読む
def load_payloads(raw):
    decoder = json.JSONDecoder()
    payloads = []
    index = 0
    while True:
        while index < len(raw) and raw[index].isspace():
            index += 1
        if index >= len(raw):
            return payloads
        payload, index = decoder.raw_decode(raw, index)
        payloads.append(payload)


try:
    payloads = load_payloads(sys.stdin.read())
except Exception as error:
    print("応答が JSON として読めない: %s" % error, file=sys.stderr)
    sys.exit(3)

pull_requests = []
for payload in payloads:
    # GraphQL は HTTP 200 のまま errors を返すことがある
    if payload.get("errors"):
        print("GraphQL がエラーを返した: %s" % json.dumps(payload["errors"], ensure_ascii=False)[:300],
              file=sys.stderr)
        sys.exit(3)
    pr = ((payload.get("data") or {}).get("repository") or {}).get("pullRequest")
    if pr is None:
        print("応答に pullRequest が含まれていない（PR 番号や権限を確認）", file=sys.stderr)
        sys.exit(3)
    pull_requests.append(pr)

review_source = None
threads = []
has_threads = False
for pr in pull_requests:
    if "reviews" in pr:
        review_source = pr
    if "reviewThreads" in pr:
        has_threads = True
        threads.extend(pr["reviewThreads"]["nodes"])

if review_source is None or not has_threads:
    print("応答にレビューまたはレビュースレッドが含まれていない", file=sys.stderr)
    sys.exit(3)


# Copilot は Bot アカウント。login の末尾だけで見ると、人間の "foo-reviewer" や
# dependency-reviewer のような別の Bot まで拾ってしまうため、厳密一致で判定する
def is_review_bot(actor):
    actor = actor or {}
    return actor.get("__typename") == "Bot" and actor.get("login") == copilot_login


# submittedAt は PENDING のレビューで null になる。そのまま比較すると TypeError で
# 落ち、シェル側は「解釈に失敗」として数え、5 回で監視自体が終わってしまう
def submitted_at(review):
    return review.get("submittedAt") or ""


reviews = [r for r in review_source["reviews"]["nodes"] if is_review_bot(r.get("author"))]
new = [r for r in reviews if submitted_at(r) > baseline]
pending = [n for n in review_source["reviewRequests"]["nodes"]
           if is_review_bot(n.get("requestedReviewer"))]
unresolved = [t for t in threads if not t["isResolved"]]

# 本文が Copilot のレビューとして解釈できる形か。解釈できない形なら
# 「Suppressed comments 節が無い＝0 件」と決めつけられない
# Copilot のレビュー本文に現れる見出し・定型句（実データで確認したもの）。
# 未実行の通知との切り分けは、本文の先頭のかたまりを見る is_job_not_run が行う
KNOWN_BODY_MARKERS = (
    "Suppressed comments",
    "Review details",
    "Comments generated",
    "Pull request overview",
    "Reviewed changes",
    "Copilot reviewed",
    "Files reviewed",
)

# 「Suppressed comments 節が無い＝指摘 0 件」と読んでよい根拠になる見出し。
# "Reviewed changes" のような汎用的な語だけでは、Copilot の別種の投稿を
# 指摘 0 件のレビューと取り違えて収束と誤判断する
# "Copilot reviewed" は含めない。実データ 7 PR・100 件超のレビューを確認したが、
# これだけを含み Review details / Comments generated / Suppressed comments の
# いずれも持たない本文は無かった。だが「Copilot reviewed 0 files. The job was
# not started because ...」という、未実行の通知自身がこの文言を名乗る実例が
# 別にあり、これを根拠に suppressed=0 と決め打つと収束の誤判定につながる
COUNTABLE_BODY_MARKERS = (
    "Review details",
    "Comments generated",
)

# is_job_not_run の「2 種類以上含めば本物のレビュー」判定に使う。KNOWN_BODY_MARKERS
# から "Copilot reviewed" を除いたもの（除く理由は COUNTABLE_BODY_MARKERS と同じ）。
# 呼び出しのたびに計算し直さないよう、ここで一度だけ定義する
MULTI_MARKER_CANDIDATES = tuple(m for m in KNOWN_BODY_MARKERS if m != "Copilot reviewed")

# "Suppressed comments" 節が数値つきかどうかの判定と、件数の抽出（グループ 1）を
# 同じパターンで行う。2 箇所に手打ちで複製すると、空白の許容などがずれる。
# 見出し自体の文字列（節の有無だけを見る判定でも使う）も、ここから作る
SUPPRESSED_HEADING = "suppressed comments"
SUPPRESSED_COUNT_PATTERN = SUPPRESSED_HEADING + r"\s*\(\s*(\d+)\s*\)"

# Copilot がレビューを実行できなかった場合も review として記録される。
# 指摘 0 件と区別しないと、実行されていないのに「指摘なし」と誤って判断する。
# 文面は callout に包まれたり大文字小文字が変わったりするため、小文字化して探す
# "wasn t able to review" だけだと、一部のファイルだけ見られなかった通常のレビュー
# （wasn t able to review N of M changed files）まで拾ってしまう。
# この Python はシェルのシングルクォート内にあるため、コメントにも アポストロフィ を書けない
JOB_NOT_RUN_MARKERS = (
    "job was not started",
    "wasn t able to review any",
    "payments have failed",
    "spending limit",
)


def is_review_body(review):
    # 見出しの大文字小文字は揺れる（実データに Suppressed comments と
    # suppressed comments の両方がある）。揃えてから照合する
    body = (review["body"] or "").lower()
    return any(marker.lower() in body for marker in KNOWN_BODY_MARKERS)


def normalize(text):
    return re.sub(r"[^a-z0-9]+", " ", text.lower())


def is_job_not_run(review):
    body = review["body"] or ""
    lowered = body.lower()
    # 数値つきの Suppressed comments 節や、COUNTABLE_BODY_MARKERS の見出しがあれば
    # 本物のレビュー。本文のどこに通知の文言があっても、これらがあれば押し切らない。
    # 実際に踏んだ問題: 通知の文面を説明した本物のレビュー（この手順書自身がそう）を
    # 未実行と誤判定していた
    if re.search(SUPPRESSED_COUNT_PATTERN, body, re.IGNORECASE):
        return False
    if any(marker.lower() in lowered for marker in COUNTABLE_BODY_MARKERS):
        return False
    # 上の見出しが無いレビュー（"generated no comments" だけの短い形式など）もある。
    # KNOWN_BODY_MARKERS を 2 種類以上含む場合も本物のレビューとして扱う。
    # 1 種類だけでは弱すぎる（"Reviewed changes" 単体が未実行の通知に含まれた実例が
    # あるため）が、実データでは "Pull request overview" 等の見出しが複数そろう
    # レビューには必ず Review details か digit 付き Suppressed comments が伴っており、
    # 2 種類以上が単独の通知に紛れ込む実例は無い。
    # "Copilot reviewed" はここでも数えない。"Copilot reviewed 0 files. Files ..."
    # のように、未実行の通知自身が別のマーカーと一緒にこの語を名乗る余地が
    # 他のマーカーより大きいため（実例は無いが、他より作文されやすい）
    matched_known_markers = sum(
        1 for marker in MULTI_MARKER_CANDIDATES if marker.lower() in lowered
    )
    if matched_known_markers >= 2:
        return False
    # 先頭段落だけを見ると、"Copilot reviewed 0 files.\n\nThe job was not started
    # because ..." のように段落が分かれた通知（実例）を取りこぼす。上の強い根拠が
    # 無いことは確認済みなので、本文全体を対象に探してよい
    return any(marker in normalize(body) for marker in JOB_NOT_RUN_MARKERS)


def first_line(review):
    # callout に包まれることがあるため、引用記号と [!NOTE] のような行は飛ばす
    for line in (review["body"] or "").splitlines():
        line = re.sub(r"^\s*>\s?", "", line).strip()
        if line and not line.startswith("[!"):
            return line[:120]
    return "(本文なし)"


# スレッドへの返信も review として記録されるため、新着すべてがレビュー本文とは限らない。
# 末尾だけを見ると取りこぼし、逆に古い通知を優先すると新しいレビューを捨てる。
# 解釈できるものだけを残し、その中で最新のものを採用する（reviews は昇順）
# reviews の並びは作成順で、投稿順とは限らない。実行中の依頼にもう一度依頼すると、
# 先に作られたレビューが後から投稿され、直後の未実行通知が後ろに来る
# 未実行の通知を先に判定する。通知が見出しを引用していると、本文として扱われて
# 「suppressed 0 件」＝収束と誤って判断してしまう
not_runs = [r for r in new if is_job_not_run(r)]
review_bodies = [r for r in new if r not in not_runs and is_review_body(r)]

# レビュー本文と未実行通知を同じ集合で扱い、最新 1 件だけを採るのは危険。
# 課金が止まっている間は未実行通知が連続で投稿されるため、その直前に届いた
# 本物のレビューが丸ごと捨てられ、指摘を見落とす
if review_bodies:
    r = max(review_bodies, key=submitted_at)
    body = r["body"] or ""
    # submittedAt は秒精度。厳密比較だと、同じ秒に載った通知を取りこぼして
    # 「後続の未実行通知なし」＝収束と読めてしまう
    later_not_runs = [n for n in not_runs if submitted_at(n) >= submitted_at(r)]
    # 見出しの大文字小文字は揺れるため、件数の抽出でも区別しない
    m = re.search(SUPPRESSED_COUNT_PATTERN, body, re.IGNORECASE)
    if m:
        suppressed = int(m.group(1))
    elif SUPPRESSED_HEADING in body.lower():
        # 節はあるのに件数を読めない。0 件と決めつけない
        suppressed = None
    elif any(marker.lower() in body.lower() for marker in COUNTABLE_BODY_MARKERS):
        # レビューの体裁があり、節が無いなら 0 件
        suppressed = 0
    else:
        # レビュー本文らしくはあるが、件数の根拠になる見出しが無い。
        # 0 件と決めつけると、Copilot の別種の投稿で収束と誤判断する
        suppressed = None
    print("REVIEW ARRIVED: %s %s" % (r["author"]["login"], submitted_at(r)))
    if later_not_runs:
        # レビューは届いている。指摘への対応が先で、課金の確認はその後でよい
        print("注意: このレビューより後に、ジョブ未実行の通知が %d 件届いている（最新 %s）"
              % (len(later_not_runs), submitted_at(max(later_not_runs, key=submitted_at))))
    print("unresolved threads: %d / suppressed: %s"
          % (len(unresolved), "不明（件数を読めない）" if suppressed is None else suppressed))
    for t in unresolved:
        # line は file 単位のコメントや古くなったスレッドで null になる
        print("  - %s:%s" % (t["path"], "(file)" if t["line"] is None else t["line"]))
    # 件数を確認できたときだけ「指摘なし」と言い切る。ただしこのレビューより後に
    # ジョブ未実行の通知があるなら、最新の依頼は一度も実行されていない。
    # ここで NO FINDINGS を出すと、呼び出し元が収束と誤判定する
    if len(unresolved) == 0 and suppressed == 0 and not later_not_runs:
        print("NO FINDINGS")
    if later_not_runs:
        # レビュー自体は届いている。指摘は出力済みなので REVIEW NOT RUN とは分ける
        print("__STALE_REVIEW__")
    print("__EXIT__")
elif not_runs:
    r = max(not_runs, key=submitted_at)
    print("REVIEW NOT RUN: %s %s" % (r["author"]["login"], submitted_at(r)))
    print("レビュージョブが実行されていない。GitHub Actions の支払い・上限を確認すること")
    print("  %s" % first_line(r))
    print("__NOT_RUN__")
    print("__EXIT__")
elif pending:
    pass  # レビュー中。静かに待つ
elif new:
    # スレッドへの返信は本文が空の review として記録される。本文があるのに解釈
    # できない場合はレビューの形式が変わった可能性があるため、返信のみの状態とは
    # 区別して知らせる（依頼直後の取りこぼしを避けるため、シェル側は最低待機時間の
    # 内側ではこの判定を保留する）
    uninterpreted = [r for r in new if (r["body"] or "").strip()]
    if uninterpreted:
        print("NO REVIEW BODY: 本文を解釈できない新着がある（レビューの形式が変わった可能性）")
        for r in sorted(uninterpreted, key=submitted_at)[-3:]:
            print("  - %s %s" % (submitted_at(r), first_line(r)))
        print("__EXIT__")
    else:
        # 返信だけが届いた状態。レビュー本文が来るまで待つが、最低待機時間を
        # 過ぎても来ないなら「新着なし」と同じ扱いで終了する（無限に待たない）
        print("NO PENDING REVIEW / NO NEW REVIEW（返信のみ）")
        print("__EXIT__")
else:
    print("NO PENDING REVIEW / NO NEW REVIEW")
    print("__EXIT__")
'); then
    record_failure "API 応答の解釈に失敗"
    sleep "$INTERVAL"
    continue
  fi

  failures=0

  # 依頼が pending に載る前の静かな状態で終了しないよう、最低待機時間の内側では
  # 「レビュー本文が得られていない」判定を無効化する。依頼直後に別の Bot 投稿が
  # 1 件あるだけで監視を終えると、数分後に届く本物のレビューを取りこぼす。
  # レビュー本文やジョブ未実行の通知は、最低待機時間の内側でも即座に扱う
  # 行頭でアンカーする。未解決スレッドのパスなど、verdict の中身に
  # "NO REVIEW BODY" 等の文字列がたまたま含まれるだけで誤って抑止しないため
  if printf '%s\n' "$verdict" | grep -qE '^(NO PENDING REVIEW|NO REVIEW BODY)' &&
    [ $(($(date +%s) - STARTED)) -lt "$MIN_WAIT" ]; then
    verdict=""
  fi
  if [ -n "$verdict" ]; then
    printf '%s\n' "$verdict" | grep -vE '^__EXIT__|^__NOT_RUN__|^__STALE_REVIEW__'
    # ジョブ未実行は「レビューが届いた」とは別物。同じ 0 で終わると、
    # 呼び出し元が成功と見なして課金が直るまで再依頼を繰り返す
    if printf '%s' "$verdict" | grep -q '^__NOT_RUN__'; then
      exit 2
    fi
    # レビューは届いたが、その後の依頼が実行されていない。指摘は出力済みなので
    # REVIEW NOT RUN と混ぜず、呼び出し元が読み飛ばさないよう別のコードで返す
    if printf '%s' "$verdict" | grep -q '^__STALE_REVIEW__'; then
      exit 4
    fi
    printf '%s' "$verdict" | grep -q '^__EXIT__' && exit 0
  fi

  # 依頼が保留のまま返ってこない場合、ここで打ち切らないと無言で回り続ける
  if [ $(($(date +%s) - STARTED)) -ge "$MAX_WAIT" ]; then
    echo "WATCH TIMEOUT: ${MAX_WAIT} 秒待ってもレビューが届かなかった"
    echo "依頼が登録されているか、ジョブが実行できる状態かを確認すること"
    exit 3
  fi

  sleep "$INTERVAL"
done
