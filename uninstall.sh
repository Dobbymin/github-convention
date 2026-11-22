#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SKILLS_ROOT="$SCRIPT_DIR/skills"
MARKER_FILE=".github-convention-script-managed"

SCOPE="project"
TARGET=""
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: uninstall.sh [options]

Uninstall all github-convention skills installed via install.sh.

Options:
  --scope <project|global>  Target scope (default: project)
  --target <dir>            Explicit target parent directory for skills
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
      TARGET="$(pwd)/.agents/skills"
      ;;
    global)
      TARGET="${HOME}/.agents/skills"
      ;;
    *)
      echo "Invalid --scope: $SCOPE (expected project or global)" >&2
      exit 1
      ;;
  esac
fi

for SKILL_DIR in "$SKILLS_ROOT"/*; do
  [ -d "$SKILL_DIR" ] || continue
  [ -f "$SKILL_DIR/SKILL.md" ] || continue

  SKILL_NAME="$(basename "$SKILL_DIR")"
  DEST="$TARGET/$SKILL_NAME"

  if [ ! -e "$DEST" ] && [ ! -L "$DEST" ]; then
    continue
  fi

  if [ -L "$DEST" ]; then
    LINK_TARGET="$(readlink "$DEST")"
    case "$LINK_TARGET" in
      "$SKILL_DIR"|*"/skills/$SKILL_NAME")
        if [ "$DRY_RUN" -eq 1 ]; then
          echo "[dry-run] Would remove symlink: $DEST"
        else
          rm "$DEST"
          echo "Removed symlink: $DEST"
        fi
        ;;
      *)
        echo "Refusing to remove unmanaged symlink: $DEST -> $LINK_TARGET" >&2
        exit 1
        ;;
    esac
  elif [ -d "$DEST" ] && [ -f "$DEST/$MARKER_FILE" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "[dry-run] Would remove managed directory: $DEST"
    else
      rm -rf "$DEST"
      echo "Removed managed directory: $DEST"
    fi
  else
    echo "Refusing to remove unmanaged path: $DEST" >&2
    exit 1
  fi
done
