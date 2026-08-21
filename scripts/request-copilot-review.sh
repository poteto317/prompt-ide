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

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <owner> <repo> <pr-number>" >&2
  exit 2
fi

OWNER="$1"
REPO="$2"
PR="$3"
# copilot-pull-request-reviewer[bot] の node id（アカウント固有ではなくアプリ固有）
DEFAULT_BOT_ID="BOT_kgDOCnlnWA"

info=$(gh api graphql -f query="
{repository(owner:\"$OWNER\",name:\"$REPO\"){pullRequest(number:$PR){
  id
  reviews(last:20){nodes{author{__typename login ... on Bot{id}}}}
  timelineItems(last:50, itemTypes:[REVIEW_REQUESTED_EVENT]){nodes{
    ... on ReviewRequestedEvent{requestedReviewer{__typename ... on Bot{id login}}}
  }}
}}}")

pr_id=$(printf '%s' "$info" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["repository"]["pullRequest"]["id"])')
bot_id=$(printf '%s' "$info" | python3 -c '
import sys, json
pr = json.load(sys.stdin)["data"]["repository"]["pullRequest"]
candidates = []
for node in pr["reviews"]["nodes"]:
    author = node.get("author") or {}
    if author.get("__typename") == "Bot" and author.get("login", "").endswith("reviewer"):
        candidates.append(author["id"])
for node in pr["timelineItems"]["nodes"]:
    reviewer = node.get("requestedReviewer") or {}
    if reviewer.get("__typename") == "Bot" and reviewer.get("login", "").endswith("reviewer"):
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
  python3 -c '
import sys, json
nodes = json.load(sys.stdin)["data"]["requestReviews"]["pullRequest"]["reviewRequests"]["nodes"]
logins = [(n.get("requestedReviewer") or {}).get("login") for n in nodes]
print("依頼済み:", logins)
if not any((login or "").endswith("reviewer") for login in logins):
    # Copilot は依頼を受け取った直後に reviewRequests から外れることがあるため、
    # 空でも失敗とは限らない。監視側で新着レビューを待つこと
    print("注意: 依頼直後は pending に現れないことがある。監視で新着を待つこと")
'

date -u +'baseline: %Y-%m-%dT%H:%M:%SZ'
