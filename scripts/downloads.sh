#!/usr/bin/env bash
# Report GitHub release download counts for Magnolia.
#
# Prints the total number of real installer downloads (the .dmg / .exe / .deb /
# .AppImage assets people actually click), then a per-asset-type breakdown.
# Auto-updater housekeeping files (latest*.yml, *.blockmap) are excluded from
# the headline total because they are fetched by the updater, not by humans.
#
# Requires the GitHub CLI (`gh`) to be installed and authenticated:
#   brew install gh && gh auth login
#
# Usage: scripts/downloads.sh   (or: npm run downloads, if wired up)

set -euo pipefail

REPO="caledavis/Magnolia"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh (GitHub CLI) not found. Install with: brew install gh" >&2
  exit 1
fi

# Pull every release's assets once, reuse for both the total and the breakdown.
assets="$(gh api "repos/${REPO}/releases" --paginate \
  --jq '.[].assets[] | [.name, .download_count] | @tsv')"

installer_re='\.(dmg|exe|deb|AppImage)$'

total="$(printf '%s\n' "$assets" \
  | awk -F'\t' -v re="$installer_re" '$1 ~ re { sum += $2 } END { print sum + 0 }')"

echo "Installer downloads (.dmg/.exe/.deb/.AppImage): ${total}"
echo
echo "By platform:"
printf '%s\n' "$assets" | awk -F'\t' '
  $1 ~ /\.dmg$/             { mac += $2 }
  $1 ~ /\.exe$/             { win += $2 }
  $1 ~ /\.deb$|\.AppImage$/ { lin += $2 }
  END {
    printf "  macOS (.dmg):        %d\n", mac + 0
    printf "  Windows (.exe):      %d\n", win + 0
    printf "  Linux (.deb/.App):   %d\n", lin + 0
  }'
