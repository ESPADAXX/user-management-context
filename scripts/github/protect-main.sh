#!/usr/bin/env bash
# Branch protection: nothing merges to main unless every gate is green and the owner approved.
# Run once, as a repository admin:   bash scripts/github/protect-main.sh owner/repo
set -euo pipefail
REPO="${1:?usage: protect-main.sh owner/repo}"

gh api -X PUT "repos/$REPO/branches/main/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<JSON
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Context gates", "Contract tests", "Tests and build"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

for label in "stale:d93f0b:Built on an outdated requirement version" \
             "task:1d76db:Task from context/plan/tasks.yaml" \
             "change-request:fbca04:Client need waiting for the product owner" \
             "decision-needed:5319e7:Question for the tech lead" \
             "assumption:c5def5:Assumption to review"; do
  IFS=: read -r name color desc <<< "$label"
  gh label create "$name" --color "$color" --description "$desc" -R "$REPO" 2>/dev/null || true
done
echo "main is protected on $REPO"
