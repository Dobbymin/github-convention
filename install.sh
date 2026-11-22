#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SKILLS_ROOT="$SCRIPT_DIR/skills"
MARKER_FILE=".github-convention-script-managed"

SCOPE="project"
TARGET=""
MODE="symlink"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Install all github-convention skills into an agent skills directory.

Options:
  --scope <project|global>  Target scope (default: project)
  --target <dir>            Explicit target parent directory for skills
  --copy                    Copy files instead of creating symlinks
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

if [ ! -d "$SKILLS_ROOT" ]; then
  echo "Skills directory not found: $SKILLS_ROOT" >&2
  exit 1
fi

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

INSTALLED_COUNT=0

for SKILL_DIR in "$SKILLS_ROOT"/*; do
  [ -d "$SKILL_DIR" ] || continue
  [ -f "$SKILL_DIR/SKILL.md" ] || continue

  SKILL_NAME="$(basename "$SKILL_DIR")"
  DEST="$TARGET/$SKILL_NAME"

  if [ -L "$DEST" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "[dry-run] Would replace existing symlink: $DEST -> $SKILL_DIR ($MODE)"
      INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
      continue
    fi
    rm "$DEST"
  elif [ -e "$DEST" ]; then
    if [ -d "$DEST" ]; then
      if [ -n "$(ls -A "$DEST")" ] && [ ! -f "$DEST/$MARKER_FILE" ]; then
        echo "Refusing to overwrite non-empty unmanaged directory: $DEST" >&2
        exit 1
      fi
      if [ "$DRY_RUN" -eq 1 ]; then
        echo "[dry-run] Would replace managed/empty directory: $DEST ($MODE)"
        INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
        continue
      fi
      rm -rf "$DEST"
    else
      echo "Refusing to overwrite existing non-directory file: $DEST" >&2
      exit 1
    fi
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] Would install ($MODE): $SKILL_DIR -> $DEST"
    INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
    continue
  fi

  mkdir -p "$TARGET"
  if [ "$MODE" = "symlink" ]; then
    ln -s "$SKILL_DIR" "$DEST"
    echo "Installed symlink: $DEST -> $SKILL_DIR"
  else
    mkdir -p "$DEST"
    cp -R "$SKILL_DIR"/. "$DEST"/
    printf "managed-by=install.sh\n" > "$DEST/$MARKER_FILE"
    echo "Installed copy: $DEST"
  fi
  INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
done

if [ "$INSTALLED_COUNT" -eq 0 ]; then
  echo "No skills found under $SKILLS_ROOT" >&2
  exit 1
fi
