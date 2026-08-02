#!/usr/bin/env bash
# Build a clean folder to copy onto the Windows laptop.
#
# Why this exists: node_modules/ contains better-sqlite3, which is compiled
# for the machine it was installed on (here: macOS arm64). Copying it to
# Windows produces a native-module crash that a non-technical user cannot
# diagnose. .next/ is likewise a build output. Both are rebuilt on the
# Windows laptop by the launcher, so neither should travel.
#
# Usage:  ./prepare-for-windows.sh  [destination]
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-$HOME/Desktop/KSB-for-dad}"

if [ -e "$DEST" ]; then
  echo "Refusing to overwrite an existing path: $DEST"
  echo "Delete it first, or pass a different destination."
  exit 1
fi

echo "Copying from : $SRC"
echo "Copying to   : $DEST"
echo

mkdir -p "$DEST"
rsync -a \
  --exclude 'node_modules/' \
  --exclude '.next/' \
  --exclude '.venv/' \
  --exclude '.git/' \
  --exclude '.pytest_cache/' \
  --exclude '*.tsbuildinfo' \
  --exclude '.DS_Store' \
  --exclude '*.log' \
  "$SRC"/ "$DEST"/

# The database and the source PDFs are git-ignored but ARE required.
missing=0
for required in "data/ksb.sqlite" "source_pdfs"; do
  if [ ! -e "$DEST/$required" ]; then
    echo "WARNING: $required did not get copied - the app will not work without it."
    missing=1
  fi
done

echo
echo "Done. Size to copy:"
du -sh "$DEST"
echo
if [ "$missing" = "0" ]; then
  echo "Contains the confidential price list - move it by USB, not cloud."
  echo "Then follow WINDOWS_SETUP.txt on the laptop."
fi
