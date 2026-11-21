#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/skills/github-convention"
MARKER_FILE=".github-convention-script-managed"

SCOPE="project"
TARGET=""
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: uninstall.sh [options]

Uninstall the github-convention Skill installed via install.sh.

Options:
  --scope <project|global>  Target scope (default: project)
  --target <dir>            Explicit target directory
  --dry-run                 Preview actions without removing files
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

if [ ! -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
  echo "Nothing to uninstall at $TARGET"
  exit 0
fi

if [ -L "$TARGET" ]; then
  LINK_TARGET="$(readlink "$TARGET")"
  case "$LINK_TARGET" in
    "$SOURCE_DIR"|*"/skills/github-convention")
      if [ "$DRY_RUN" -eq 1 ]; then
        echo "[dry-run] Would remove symlink: $TARGET"
        exit 0
      fi
      rm "$TARGET"
      echo "Removed symlink: $TARGET"
      exit 0
      ;;
    *)
      echo "Refusing to remove unmanaged symlink: $TARGET -> $LINK_TARGET" >&2
      exit 1
      ;;
  esac
fi

if [ -d "$TARGET" ] && [ -f "$TARGET/$MARKER_FILE" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] Would remove managed directory: $TARGET"
    exit 0
  fi
  rm -rf "$TARGET"
  echo "Removed managed directory: $TARGET"
  exit 0
fi

echo "Refusing to remove unmanaged path: $TARGET" >&2
exit 1
