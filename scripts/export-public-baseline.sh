#!/bin/zsh
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: scripts/export-public-baseline.sh /absolute/empty/destination" >&2
  exit 2
fi

source_root="${0:A:h:h}"
destination="$1"

if [[ "$destination" != /* ]]; then
  echo "destination must be an absolute path" >&2
  exit 2
fi
if [[ -e "$destination" ]]; then
  echo "destination already exists: $destination" >&2
  exit 2
fi
if [[ -n "$(git -C "$source_root" status --porcelain)" ]]; then
  echo "source repository must be clean and committed before export" >&2
  exit 2
fi

mkdir -p "$destination"
git -C "$source_root" ls-files -z | while IFS= read -r -d '' relative; do
  case "$relative" in
    .planning/*|*/.planning/*|findings.md|progress.md|task_plan.md|WINDOWS_*|docs/windows-*|docs/Dialogue_Atlas_黑客松*|scripts/*windows*|dist/*|test-results/*|playwright-report/*)
      continue
      ;;
  esac
  mkdir -p "$destination/${relative:h}"
  cp "$source_root/$relative" "$destination/$relative"
done

if find "$destination" -name '.env' -o -name '*.sqlite3' -o -name '*.log' | grep -q .; then
  echo "public export contains an excluded runtime file" >&2
  exit 1
fi
node "$source_root/scripts/audit-public-export.mjs" "$destination"

git -C "$destination" init -b main
git -C "$destination" add .
git -C "$destination" -c user.name='Dialogue Atlas' -c user.email='relay@localhost' commit -m 'Initial public Relay MVP baseline'
git -C "$destination" fsck --no-reflogs --unreachable
echo "clean public baseline created at $destination"
