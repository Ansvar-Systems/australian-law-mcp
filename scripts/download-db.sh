#!/bin/bash
# Download database from GitHub Releases for Vercel deployment.
set -e

VERSION=$(node -p "require('./package.json').version")
REPO="Ansvar-Systems/australian-law-mcp"
TAG="v${VERSION}"
ASSET="database.db.gz"
OUTPUT="data/database.db"

if [ -f "$OUTPUT" ] && [ "$(wc -c < "$OUTPUT")" -gt 1000000 ]; then
  echo "[download-db] Database already exists at $OUTPUT, skipping download"
  exit 0
fi

URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"
echo "[download-db] Downloading database..."
echo "  URL: ${URL}"

mkdir -p data
curl -fSL --retry 3 --retry-delay 5 "$URL" | gunzip > "${OUTPUT}.tmp"
mv "${OUTPUT}.tmp" "$OUTPUT"

echo "[download-db] Database ready at $OUTPUT"
