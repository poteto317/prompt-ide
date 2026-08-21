#!/bin/bash
# Copilot にレビューを依頼し、依頼が登録されたことまで確認する。
#
# usage:
#   scripts/request-copilot-review.sh <owner> <repo> <pr-number>
#
# REST の `pulls/:number/requested_reviewers` は bot を返さないため、依頼も確認も
# GraphQL で行う。bot の node id は PR の履歴（過去のレビュー投稿者・依頼イベント）から
# 探し、見つからなければ Copilot の既定 id にフォールバックする。
#
# GITHUB_TOKEN（GitHub Actions）からは Copilot レビューをトリガーできないため、
# 必ずローカルターミナルから実行すること。
set -eu

usage() {
  echo "usage: $0 <owner> <repo> <pr-number>" >&2
  exit 2
}

if [ "$#" -lt 3 ]; then
  usage
fi

OWNER="$1"
REPO="$2"
PR="$3"

# 数値以外を渡されると GraphQL エラーになり、原因が分かりにくい
case "$PR" in
  '' | *[!0-9]*)
    echo "pr-number は数値で指定してください（受け取った値: ${PR}）" >&2
    usage
    ;;
esac

# copilot-pull-request-reviewer[bot] の node id（アカウント固有ではなくアプリ固有）
DEFAULT_BOT_ID="BOT_kgDOCnlnWA"
# login の末尾で見ると dependency-reviewer のような別の reviewer 系 Bot まで
# 拾ってしまうため、厳密一致で判定する
COPILOT_LOGIN="${COPILOT_REVIEWER_LOGIN:-copilot-pull-request-reviewer}"

info=$(gh api graphql -f query="
{repository(owner:\"$OWNER\",name:\"$REPO\"){pullRequest(number:$PR){
  id
  reviews(last:20){nodes{author{__typename login ... on Bot{id}}}}
  timelineItems(last:50, itemTypes:[REVIEW_REQUESTED_EVENT]){nodes{
    ... on ReviewRequestedEvent{requestedReviewer{__typename ... on Bot{id login}}}
  }}
}}}")

pr_id=$(printf '%s' "$info" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["repository"]["pullRequest"]["id"])')
bot_id=$(printf '%s' "$info" | COPILOT_LOGIN="$COPILOT_LOGIN" python3 -c '
import sys, json, os
copilot_login = os.environ["COPILOT_LOGIN"]
pr = json.load(sys.stdin)["data"]["repository"]["pullRequest"]
candidates = []
for node in pr["reviews"]["nodes"]:
    author = node.get("author") or {}
    if author.get("__typename") == "Bot" and author.get("login") == copilot_login:
        candidates.append(author["id"])
for node in pr["timelineItems"]["nodes"]:
    reviewer = node.get("requestedReviewer") or {}
    if reviewer.get("__typename") == "Bot" and reviewer.get("login") == copilot_login:
        candidates.append(reviewer["id"])
print(candidates[-1] if candidates else "")
')

if [ -z "$bot_id" ]; then
  bot_id="$DEFAULT_BOT_ID"
  echo "PR の履歴から bot id を特定できなかったため既定値を使う: $bot_id"
fi

# 変数は単一 ID で受け、クエリ側で配列に包む。[ID!]! として宣言すると
# gh の -f が渡す単一文字列と型が食い違う
gh api graphql -f query='mutation($p:ID!,$b:ID!){
  requestReviews(input:{pullRequestId:$p, botIds:[$b], union:true}){
    pullRequest{reviewRequests(first:10){nodes{requestedReviewer{__typename ... on Bot{login}}}}}
  }
}' -f p="$pr_id" -f b="$bot_id" |
  COPILOT_LOGIN="$COPILOT_LOGIN" python3 -c '
import sys, json, os
copilot_login = os.environ["COPILOT_LOGIN"]
nodes = json.load(sys.stdin)["data"]["requestReviews"]["pullRequest"]["reviewRequests"]["nodes"]
logins = [(n.get("requestedReviewer") or {}).get("login") for n in nodes]
print("依頼済み:", logins)
if copilot_login not in logins:
    # Copilot は依頼を受け取った直後に reviewRequests から外れることがあるため、
    # 空でも失敗とは限らない。監視側で新着レビューを待つこと
    print("注意: 依頼直後は pending に現れないことがある。監視で新着を待つこと")
'

date -u +'baseline: %Y-%m-%dT%H:%M:%SZ'
