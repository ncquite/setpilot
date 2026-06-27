#!/usr/bin/env bash
# Regenerate the app icons from icon.svg.
# Requires: rsvg-convert, iconutil (macOS), ImageMagick (`magick`).
set -euo pipefail
cd "$(dirname "$0")"

SVG=icon.svg

# 1024px master PNG (also used by electron-builder for Linux / as a fallback).
rsvg-convert -w 1024 -h 1024 "$SVG" -o icon.png

# macOS .icns — build an .iconset of the required sizes, then pack it.
rm -rf icon.iconset && mkdir icon.iconset
for size in 16 32 128 256 512; do
  rsvg-convert -w "$size"        -h "$size"        "$SVG" -o "icon.iconset/icon_${size}x${size}.png"
  rsvg-convert -w "$((size*2))"  -h "$((size*2))"  "$SVG" -o "icon.iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns icon.iconset -o icon.icns
rm -rf icon.iconset

# Windows .ico — multi-resolution from the master PNG.
magick icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico

echo "✓ Generated icon.png, icon.icns, icon.ico"
