#!/usr/bin/env bash
# Regenerate every app / document / codebook icon variant directly from the
# source PNGs in graphic_files/app_and_file_icons/ — the single source of
# truth. Run via `npm run icons` (or directly) after re-exporting any icon.
#
# Sources (used full-bleed; no Apple-template squircle inset is applied, so
# the icon is exactly the artwork supplied, edge-to-edge):
#   graphic_files/app_and_file_icons/app_icon.png   → app icon
#   graphic_files/app_and_file_icons/qdpx_icon.png  → .qdpx document icon
#   graphic_files/app_and_file_icons/qdc_icon.png   → .qdc codebook icon
#
# App icon outputs:
#   build/icon.icns          — bundled by electron-builder for the .dmg
#   build/icon.ico           — bundled by electron-builder for Windows .exe
#   build/icon.png           — Linux + electron-builder fallback
#   resources/icon.png       — runtime app/dock icon (imported by main/index.ts)
# Document icon outputs (.qdpx in Finder/Explorer/etc):
#   build/document-icon.{icns,ico,png}
# Codebook icon outputs (.qdc in Finder/Explorer/etc):
#   build/codebook-icon.{icns,ico,png}
#
# Requires: sips + iconutil (built-in macOS) + npx png-to-ico.

set -euo pipefail

ICONS_DIR="graphic_files/app_and_file_icons"

# Convert a single source PNG into a full set of platform icon variants. The
# source is normalised to 1024×1024 full-bleed first, so it can be any square
# size (the exports are 1024 / 1120).
#   $1: source PNG path
#   $2: output basename (e.g. "build/icon" or "build/document-icon")
build_variants() {
  local src="$1" base="$2"
  if [[ ! -f "$src" ]]; then
    echo "Source not found: $src" >&2
    exit 1
  fi
  local tmp iset
  tmp=$(mktemp -d)
  iset="$tmp/Icon.iconset"
  mkdir "$iset"

  sips -z 1024 1024 -s format png "$src" --out "$tmp/icon-1024.png" >/dev/null

  for size in 16 32 64 128 256 512 1024; do
    sips -z $size $size "$tmp/icon-1024.png" --out "$iset/icon_${size}x${size}.png" >/dev/null
    if [[ $size -le 512 ]]; then
      local dbl=$((size * 2))
      sips -z $dbl $dbl "$tmp/icon-1024.png" --out "$iset/icon_${size}x${size}@2x.png" >/dev/null
    fi
  done

  iconutil -c icns "$iset" -o "${base}.icns"
  cp "$tmp/icon-1024.png" "${base}.png"
  npx --yes png-to-ico "$tmp/icon-1024.png" > "${base}.ico"

  rm -rf "$tmp"
}

echo "→ App icon (build/icon.{icns,ico,png}, resources/icon.png)…"
build_variants "$ICONS_DIR/app_icon.png" "build/icon"
cp build/icon.png resources/icon.png

if [[ -f "$ICONS_DIR/qdpx_icon.png" ]]; then
  echo "→ Document icon (build/document-icon.{icns,ico,png})…"
  build_variants "$ICONS_DIR/qdpx_icon.png" "build/document-icon"
fi

if [[ -f "$ICONS_DIR/qdc_icon.png" ]]; then
  echo "→ Codebook icon (build/codebook-icon.{icns,ico,png})…"
  build_variants "$ICONS_DIR/qdc_icon.png" "build/codebook-icon"
fi

echo "Done."
