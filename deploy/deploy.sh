#!/usr/bin/env bash
# Deploys Harvest Village to the k3s server, with the image of one commit.
#
# It copies the chart (deploy/helm/game) and the game's Platform API key to a fresh temporary folder
# on the server over SSH, runs `helm upgrade --install clan-game` there, waits until the new pod is
# ready, and always deletes the copy again. The release is separate from the "clan" release of
# clan-backend: deploying the game changes nothing else on the server.
#
# Usage, from anywhere in the repository (Git Bash on Windows, or the CI job "deploy"):
#   CLAN_GAME_API_KEY=... deploy/deploy.sh <image tag>     the commit SHA that the CI job "images" pushed
#
# Settings (environment variables):
#   CLAN_GAME_API_KEY  the game's Platform API key (Studio -> the game -> API keys). Required.
#                      It is sent over SSH into a file only the deploy user can read, handed to
#                      helm with --set-file, and never appears on a command line or in the output.
#   DEPLOY_HOST        user@host of the server            (default ubuntu@130.61.158.79)
#   DEPLOY_NAMESPACE   the namespace of the clan release  (default clan)
# ssh and scp use your normal SSH key and known_hosts; the CI job prepares its own.
set -euo pipefail

tag="${1:-}"
# The tag ends up in a command on the server, so only image-tag characters are accepted.
if [[ ! "$tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "usage: deploy/deploy.sh <image tag>   (the commit SHA of a build)" >&2
  exit 2
fi

key="${CLAN_GAME_API_KEY:-}"
if [[ -z "$key" || "$key" == *$'\n'* || "$key" == *$'\r'* ]]; then
  echo "deploy: set CLAN_GAME_API_KEY to the game's Platform API key (one line)" >&2
  exit 2
fi

cd "$(dirname "$0")/.."   # the repository root

host="${DEPLOY_HOST:-ubuntu@130.61.158.79}"
namespace="${DEPLOY_NAMESPACE:-clan}"
if [[ ! "$namespace" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]]; then
  echo "deploy: DEPLOY_NAMESPACE is not a valid namespace name" >&2
  exit 2
fi

echo "deploy: game image tag $tag to $host (namespace $namespace)"

# A folder only this user can read (mktemp -d creates it with mode 700).
remote_dir="$(ssh "$host" 'mktemp -d /tmp/clan-game-deploy.XXXXXX')"
cleanup() { ssh "$host" "rm -rf '$remote_dir'" || echo "deploy: could not remove $remote_dir on the server" >&2; }
trap cleanup EXIT

scp -q -r deploy/helm/game "$host:$remote_dir/chart"
# The key goes through the SSH connection's input, not through a command line.
printf '%s' "$key" | ssh "$host" "umask 077 && cat > '$remote_dir/api-key'"

# On the server. --wait: helm returns only when the new pod is ready (or fails after 5 minutes).
ssh "$host" bash -s -- "$remote_dir" "$tag" "$namespace" <<'REMOTE'
set -euo pipefail
dir="$1"
tag="$2"
namespace="$3"
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
command -v helm >/dev/null || { echo "deploy: helm is not installed on the server" >&2; exit 1; }
# The pull secret and the certificate issuer come from the clan release, so it must be there first.
kubectl get namespace "$namespace" >/dev/null || { echo "deploy: namespace $namespace is missing: deploy clan-backend first" >&2; exit 1; }

helm upgrade --install clan-game "$dir/chart" -n "$namespace" --wait --timeout 5m \
  -f "$dir/chart/values-prod.yaml" \
  --set image.tag="$tag" \
  --set-file secrets.clanGameApiKey="$dir/api-key"

echo
helm history clan-game -n "$namespace" --max 3
echo
kubectl -n "$namespace" get deploy clan-game -o custom-columns='NAME:.metadata.name,READY:.status.readyReplicas,IMAGE:.spec.template.spec.containers[0].image'
REMOTE

echo "deploy: done, game $tag is running"
