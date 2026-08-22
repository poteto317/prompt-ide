#!/bin/bash
# PR のレビュー到着を一定間隔で確認する。
#
#   - 新しいレビューが届いたら内容（未解決スレッドと suppressed comments の件数）を
#     出力して終了する
#   - レビュー依頼が保留中（レビュー中）の間は静かに待ち続ける
#   - 依頼も保留も無く新着も無ければ「指摘なし」を出力して終了する
#     ただし最低待機時間を過ぎるまでは終了しない（理由は下記）
#
# usage:
#   bash scripts/watch-pr-review.sh <owner> <repo> <pr-number> <baseline-iso8601> [min-wait-sec] [interval-sec]
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
  echo "usage: bash $0 <owner> <repo> <pr-number> <baseline-iso8601> [min-wait-sec] [interval-sec]" >&2
  exit 2
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

# 数値以外を渡されると GraphQL エラーや Python の例外になり、原因が分かりにくい。
# 起動時に弾いて usage を出す
for value in "$PR" "$MIN_WAIT" "$INTERVAL"; do
  case "$value" in
    '' | *[!0-9]*)
      echo "数値で指定してください: pr-number / min-wait-sec / interval-sec（受け取った値: ${value}）" >&2
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
  if ! out=$(gh api graphql -f query="
  {repository(owner:\"$OWNER\",name:\"$REPO\"){pullRequest(number:$PR){
    reviews(last:100){nodes{author{__typename login} submittedAt body}}
    reviewRequests(first:100){nodes{requestedReviewer{__typename ... on Bot {login} ... on User {login}}}}
    reviewThreads(last:100){totalCount nodes{isResolved path line}}
  }}}" 2>"$err_file"); then
    record_failure "gh api graphql に失敗" "$(head -3 "$err_file")"
    sleep "$INTERVAL"
    continue
  fi

  # 応答の解釈もここで行う。失敗（errors を含む・pullRequest が無い・壊れた JSON）は
  # 終了コードで伝わるため、シェル側は同じ経路で失敗として数えられる
  if ! verdict=$(printf '%s' "$out" | BASELINE="$BASELINE" COPILOT_LOGIN="$COPILOT_LOGIN" python3 -c '
import sys, json, os, re

baseline = os.environ["BASELINE"]
copilot_login = os.environ["COPILOT_LOGIN"]

try:
    payload = json.load(sys.stdin)
except Exception as error:
    print("応答が JSON として読めない: %s" % error, file=sys.stderr)
    sys.exit(3)

# GraphQL は HTTP 200 のまま errors を返すことがある
if payload.get("errors"):
    print("GraphQL がエラーを返した: %s" % json.dumps(payload["errors"], ensure_ascii=False)[:300],
          file=sys.stderr)
    sys.exit(3)

pr = ((payload.get("data") or {}).get("repository") or {}).get("pullRequest")
if pr is None:
    print("応答に pullRequest が含まれていない（PR 番号や権限を確認）", file=sys.stderr)
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


reviews = [r for r in pr["reviews"]["nodes"] if is_review_bot(r.get("author"))]
new = [r for r in reviews if submitted_at(r) > baseline]
pending = [n for n in pr["reviewRequests"]["nodes"] if is_review_bot(n.get("requestedReviewer"))]
thread_data = pr["reviewThreads"]
threads = thread_data["nodes"]
thread_total = thread_data.get("totalCount")
# last:100 は「新しい方から 100 件」。総数がそれを超えるなら、古い未解決スレッドが
# 窓の外にある可能性があり、0 件でも「指摘なし」と言い切れない
threads_truncated = thread_total is not None and thread_total > len(threads)
unresolved = [t for t in threads if not t["isResolved"]]

# 本文が Copilot のレビューとして解釈できる形か。解釈できない形なら
# 「Suppressed comments 節が無い＝0 件」と決めつけられない
KNOWN_BODY_MARKERS = (
    "Suppressed comments",
    "<details>",
    "Review details",
    "Copilot reviewed",
    "Comments generated",
    "Pull request overview",
)

# Copilot がレビューを実行できなかった場合も review として記録される。
# 指摘 0 件と区別しないと、実行されていないのに「指摘なし」と誤って判断する
JOB_NOT_RUN_MARKERS = (
    "The job was not started",
    "payments have failed",
    "spending limit",
)


def is_job_not_run(review):
    # 本文全体を部分一致で見ると、"spending limit" のような普通の語を含むレビューまで
    # 未実行と誤判定する。この通知は 1 文だけなので先頭行に限って判定する
    body = (review["body"] or "").strip()
    if not body:
        return False
    first_line = body.splitlines()[0]
    return any(marker in first_line for marker in JOB_NOT_RUN_MARKERS)


def is_review_body(review):
    body = review["body"] or ""
    return any(marker in body for marker in KNOWN_BODY_MARKERS)


# スレッドへの返信も review として記録されるため、新着すべてがレビュー本文とは限らない。
# 末尾だけを見ると取りこぼし、逆に古い通知を優先すると新しいレビューを捨てる。
# 解釈できるものだけを残し、その中で最新のものを採用する（reviews は昇順）
interpretable = [r for r in new if is_job_not_run(r) or is_review_body(r)]

if interpretable:
    r = interpretable[-1]
    body = r["body"] or ""
    if is_job_not_run(r):
        print("REVIEW NOT RUN: %s %s" % (r["author"]["login"], submitted_at(r)))
        print("レビュージョブが実行されていない。GitHub Actions の支払い・上限を確認すること")
        print("  %s" % body.strip().splitlines()[0][:200])
        print("__EXIT__")
        sys.exit(0)
    m = re.search(r"Suppressed comments \((\d+)\)", body)
    if m:
        suppressed = int(m.group(1))
    else:
        # 見慣れた形式で節が無いなら 0 件
        suppressed = 0
    print("REVIEW ARRIVED: %s %s" % (r["author"]["login"], submitted_at(r)))
    print("unresolved threads: %d%s / suppressed: %s"
          % (len(unresolved),
             "（取得上限で切れている可能性あり: 総数 %s）" % thread_total if threads_truncated else "",
             suppressed))
    for t in unresolved:
        print("  - %s:%s" % (t["path"], t["line"]))
    # 件数を確認できたときだけ「指摘なし」と言い切る
    if len(unresolved) == 0 and suppressed == 0 and not threads_truncated:
        print("NO FINDINGS")
    print("__EXIT__")
elif pending:
    pass  # レビュー中。静かに待つ
elif new:
    # 返信だけが届いた状態。レビュー本文が来るまで待つが、最低待機時間を過ぎても
    # 来ないなら「新着なし」と同じ扱いで終了する（無限に待たない）
    print("NO PENDING REVIEW / NO NEW REVIEW（レビュー本文以外の新着のみ）")
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

  # 依頼が pending に載る前の静かな状態で終了しないよう、最低待機時間の
  # 内側では「新着なし」の判定だけ無効化する（新着そのものは即座に扱う）
  if printf '%s' "$verdict" | grep -q 'NO PENDING REVIEW' &&
    [ $(($(date +%s) - STARTED)) -lt "$MIN_WAIT" ]; then
    verdict=""
  fi
  if [ -n "$verdict" ]; then
    printf '%s\n' "$verdict" | grep -v '^__EXIT__'
    printf '%s' "$verdict" | grep -q '^__EXIT__' && exit 0
  fi

  sleep "$INTERVAL"
done
