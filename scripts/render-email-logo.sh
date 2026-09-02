#!/usr/bin/env bash
# Renders the frontend's logo-email.svg to the PNG the email header points at.
#
# Why a PNG at all: Gmail, Outlook and Yahoo do not render SVG in email, so the
# header <img> has to be raster. Rendered at 3x the 190px display width so it stays
# crisp on retina displays, and through Chrome so the Nunito wordmark resolves from
# Google Fonts rather than falling back to a local substitute.
#
# Usage: scripts/render-email-logo.sh [path-to-frontend-repo]
set -euo pipefail

FRONTEND="${1:-$HOME/Documents/Personal/Lucen-Care-App}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SRC="$FRONTEND/src/assets/logo-email.svg"
OUT="$FRONTEND/public/logo-email.png"

# 3x the 190px display width, at the SVG's 372:112 aspect ratio.
WIDTH=570
HEIGHT=172

[ -f "$SRC" ] || { echo "missing $SRC" >&2; exit 1; }
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp "$SRC" "$WORK/logo.svg"
cat > "$WORK/render.html" <<HTML
<!doctype html>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@800&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  img { display: block; width: ${WIDTH}px; height: ${HEIGHT}px; }
</style>
<img src="logo.svg" alt="">
HTML

"$CHROME" \
  --headless=new \
  --disable-gpu \
  --hide-scrollbars \
  --force-device-scale-factor=1 \
  --default-background-color=00000000 \
  --virtual-time-budget=4000 \
  --window-size="${WIDTH},${HEIGHT}" \
  --screenshot="$OUT" \
  "file://$WORK/render.html" >/dev/null 2>&1

echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
