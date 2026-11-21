#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/skills/github-convention"
MARKER_FILE=".github-convention-script-managed"

SCOPE="project"
TARGET=""
MODE="symlink"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Install the github-convention Skill without Node CLI.

Options:
  --scope <project|global>  Target scope (default: project)
  --target <dir>            Explicit target directory
  --copy                    Copy files instead of creating a symlink
  --dry-run                 Preview actions without modifying files
  -h, --help                Show this help message
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --scope)
      [ "$#" -ge 2 ] || { echo "Missing value for --scope" >&2; exit 1; }
      SCOPE="$2"
      shift 2
      ;;
    --target)
      [ "$#" -ge 2 ] || { echo "Missing value for --target" >&2; exit 1; }
      TARGET="$2"
      shift 2
      ;;
    --copy)
      MODE="copy"
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Skill source not found: $SOURCE_DIR" >&2
  exit 1
fi

if [ -z "$TARGET" ]; then
  case "$SCOPE" in
    project)
      TARGET="$(pwd)/.agents/skills/github-convention"
      ;;
    global)
      TARGET="${HOME}/.agents/skills/github-convention"
      ;;
    *)
      echo "Invalid --scope: $SCOPE (expected project or global)" >&2
      exit 1
      ;;
  esac
fi

if [ -L "$TARGET" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] Would replace existing symlink: $TARGET -> $SOURCE_DIR ($MODE)"
    exit 0
  fi
  rm "$TARGET"
elif [ -e "$TARGET" ]; then
  if [ -d "$TARGET" ]; then
    if [ -n "$(ls -A "$TARGET")" ] && [ ! -f "$TARGET/$MARKER_FILE" ]; then
      echo "Refusing to overwrite non-empty unmanaged directory: $TARGET" >&2
      exit 1
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "[dry-run] Would replace managed/empty directory: $TARGET ($MODE)"
      exit 0
    fi
    rm -rf "$TARGET"
  else
    echo "Refusing to overwrite existing non-directory file: $TARGET" >&2
    exit 1
  fi
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] Would install ($MODE): $SOURCE_DIR -> $TARGET"
  exit 0
fi

mkdir -p "$(dirname "$TARGET")"

if [ "$MODE" = "symlink" ]; then
  ln -s "$SOURCE_DIR" "$TARGET"
  echo "Installed symlink: $TARGET -> $SOURCE_DIR"
else
  mkdir -p "$TARGET"
  cp -R "$SOURCE_DIR"/. "$TARGET"/
  printf "managed-by=install.sh\n" > "$TARGET/$MARKER_FILE"
  echo "Installed copy: $TARGET"
fi
