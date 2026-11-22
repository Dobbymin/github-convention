#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
SKILLS_ROOT="$SCRIPT_DIR/skills"
PLUGIN_ID="github-convention"
MARKER_FILE=".github-convention-script-managed"
MANIFEST_FILE=".github-convention-install-manifest"

SCOPE="project"
SCOPE_EXPLICIT=0
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

canonicalize_path() {
  INPUT_PATH="$1"
  [ -n "$INPUT_PATH" ] || return 1
  case "$INPUT_PATH" in
    /*) CUR="$INPUT_PATH" ;;
    *) CUR="$(pwd -P)/$INPUT_PATH" ;;
  esac
  if [ -d "$CUR" ] && [ ! -L "$CUR" ]; then
    (CDPATH= cd -- "$CUR" 2>/dev/null && pwd -P) && return 0
  fi
  TAIL=""
  while [ ! -d "$CUR" ] || [ -L "$CUR" ]; do
    BASE="$(basename -- "$CUR")"
    PARENT="$(dirname -- "$CUR")"
    if [ "$PARENT" = "$CUR" ]; then
      break
    fi
    if [ -z "$TAIL" ]; then
      TAIL="$BASE"
    else
      TAIL="$BASE/$TAIL"
    fi
    CUR="$PARENT"
  done
  if [ -d "$CUR" ]; then
    CANON_BASE="$(CDPATH= cd -- "$CUR" 2>/dev/null && pwd -P || printf '%s' "$CUR")"
  else
    CANON_BASE="$CUR"
  fi
  if [ -z "$TAIL" ]; then
    printf '%s\n' "$CANON_BASE"
  elif [ "$CANON_BASE" = "/" ]; then
    printf '/%s\n' "$TAIL"
  else
    printf '%s/%s\n' "$CANON_BASE" "$TAIL"
  fi
}

validate_skill_name() {
  case "$1" in
    ""|.|..|*/*)
      echo "Unsafe skill name: $1" >&2
      exit 1
      ;;
  esac
}

verify_dest_within_target() {
  DEST_PATH="$1"
  CANON_TARGET_DIR="$2"
  DEST_PARENT="$(canonicalize_path "$(dirname -- "$DEST_PATH")")"
  [ "$DEST_PARENT" = "$CANON_TARGET_DIR" ] || return 1
  [ "$DEST_PATH" != "/" ] || return 1
  [ "$DEST_PATH" != "$CANON_TARGET_DIR" ] || return 1
  [ "$DEST_PATH" != "$SCRIPT_DIR" ] || return 1
  return 0
}

is_owned_symlink() {
  _OS_DEST="$1"
  _OS_EXPECTED="$2"
  _OS_LINK="$(readlink "$_OS_DEST")" || return 1
  if [ "$_OS_LINK" = "$_OS_EXPECTED" ]; then
    return 0
  fi
  case "$_OS_LINK" in
    /*) _OS_RESOLVED="$_OS_LINK" ;;
    *) _OS_RESOLVED="$(dirname -- "$_OS_DEST")/$_OS_LINK" ;;
  esac
  _OS_CANON_ACTUAL="$(canonicalize_path "$_OS_RESOLVED")"
  _OS_CANON_EXPECTED="$(canonicalize_path "$_OS_EXPECTED")"
  [ "$_OS_CANON_ACTUAL" = "$_OS_CANON_EXPECTED" ]
}

is_owned_copy_dir() {
  DEST_PATH="$1"
  SKILL_NAME="$2"
  CANON_DEST_PATH="$3"
  [ -d "$DEST_PATH" ] && [ ! -L "$DEST_PATH" ] || return 1
  MARKER_PATH="$DEST_PATH/$MARKER_FILE"
  [ -f "$MARKER_PATH" ] && [ ! -L "$MARKER_PATH" ] || return 1
  if grep -qx "plugin=$PLUGIN_ID" "$MARKER_PATH" 2>/dev/null; then
    if grep -q "^skill=" "$MARKER_PATH" 2>/dev/null; then
      grep -qx "skill=$SKILL_NAME" "$MARKER_PATH" 2>/dev/null || return 1
    fi
    if grep -q "^install-path=" "$MARKER_PATH" 2>/dev/null; then
      grep -qx "install-path=$CANON_DEST_PATH" "$MARKER_PATH" 2>/dev/null || return 1
    fi
    return 0
  fi
  if grep -qx "managed-by=install.sh" "$MARKER_PATH" 2>/dev/null && ! grep -q "^plugin=" "$MARKER_PATH" 2>/dev/null; then
    if [ -f "$DEST_PATH/SKILL.md" ] && ! grep -qx "name: $SKILL_NAME" "$DEST_PATH/SKILL.md" 2>/dev/null; then
      return 1
    fi
    return 0
  fi
  return 1
}

is_owned_manifest() {
  MANIFEST_PATH="$1"
  [ -f "$MANIFEST_PATH" ] && [ ! -L "$MANIFEST_PATH" ] || return 1
  grep -qx "plugin=$PLUGIN_ID" "$MANIFEST_PATH" 2>/dev/null
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --scope)
      [ "$#" -ge 2 ] || { echo "Missing value for --scope" >&2; exit 1; }
      SCOPE="$2"
      SCOPE_EXPLICIT=1
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
  INSTALL_SCOPE_LABEL="$SCOPE"
else
  if [ "$SCOPE_EXPLICIT" -eq 1 ]; then
    INSTALL_SCOPE_LABEL="$SCOPE"
  else
    INSTALL_SCOPE_LABEL="custom"
  fi
fi

CANON_TARGET="$(canonicalize_path "$TARGET")"
if [ -z "$CANON_TARGET" ] || [ "$CANON_TARGET" = "/" ] || [ "$CANON_TARGET" = "$SCRIPT_DIR" ] || [ "$CANON_TARGET" = "$SKILLS_ROOT" ]; then
  echo "Refusing unsafe target directory: $TARGET" >&2
  exit 1
fi

MANIFEST_PATH="$CANON_TARGET/$MANIFEST_FILE"
SKILL_COUNT=0
CONFLICT_COUNT=0

if [ -e "$MANIFEST_PATH" ] || [ -L "$MANIFEST_PATH" ]; then
  if ! is_owned_manifest "$MANIFEST_PATH"; then
    echo "Conflict: refusing to overwrite unmanaged manifest file at $MANIFEST_PATH." >&2
    CONFLICT_COUNT=$((CONFLICT_COUNT + 1))
  fi
fi

# Pass 1: Pre-flight ownership and path safety check (zero mutations)
for SKILL_DIR in "$SKILLS_ROOT"/*; do
  [ -d "$SKILL_DIR" ] || continue
  [ -f "$SKILL_DIR/SKILL.md" ] || continue

  SKILL_COUNT=$((SKILL_COUNT + 1))
  SKILL_NAME="$(basename "$SKILL_DIR")"
  validate_skill_name "$SKILL_NAME"
  DEST="$CANON_TARGET/$SKILL_NAME"

  if ! verify_dest_within_target "$DEST" "$CANON_TARGET"; then
    echo "Conflict: destination path escapes target directory ($DEST)." >&2
    CONFLICT_COUNT=$((CONFLICT_COUNT + 1))
    continue
  fi

  if [ -L "$DEST" ]; then
    if ! is_owned_symlink "$DEST" "$SKILL_DIR"; then
      LINK_TARGET="$(readlink "$DEST" 2>/dev/null || printf '<unreadable>')"
      echo "Conflict: refusing to replace unmanaged symlink at $DEST (points to: $LINK_TARGET). Remove or relocate it manually." >&2
      CONFLICT_COUNT=$((CONFLICT_COUNT + 1))
    fi
  elif [ -e "$DEST" ]; then
    if [ -d "$DEST" ]; then
      if ! is_owned_copy_dir "$DEST" "$SKILL_NAME" "$DEST"; then
        echo "Conflict: refusing to overwrite unmanaged directory at $DEST (missing valid $MARKER_FILE for $PLUGIN_ID). Remove or relocate it manually." >&2
        CONFLICT_COUNT=$((CONFLICT_COUNT + 1))
      fi
    else
      echo "Conflict: refusing to overwrite existing non-directory file at $DEST. Remove or relocate it manually." >&2
      CONFLICT_COUNT=$((CONFLICT_COUNT + 1))
    fi
  fi
done

if [ "$SKILL_COUNT" -eq 0 ]; then
  echo "No skills found under $SKILLS_ROOT" >&2
  exit 1
fi

if [ "$CONFLICT_COUNT" -gt 0 ]; then
  echo "Aborted installation: $CONFLICT_COUNT conflict(s) detected. No files were modified." >&2
  exit 1
fi

# Pass 2: Preview or apply changes
MANIFEST_TMP=""
if [ "$DRY_RUN" -eq 0 ]; then
  mkdir -p "$CANON_TARGET"
  MANIFEST_TMP="$MANIFEST_PATH.tmp.$$"
  {
    printf "schema_version=1\n"
    printf "plugin=%s\n" "$PLUGIN_ID"
    printf "managed_by=install.sh\n"
    printf "install_scope=%s\n" "$INSTALL_SCOPE_LABEL"
    printf "install_target=%s\n" "$CANON_TARGET"
    printf "install_mode=%s\n" "$MODE"
    printf "source_root=%s\n" "$SCRIPT_DIR"
  } > "$MANIFEST_TMP"
fi

for SKILL_DIR in "$SKILLS_ROOT"/*; do
  [ -d "$SKILL_DIR" ] || continue
  [ -f "$SKILL_DIR/SKILL.md" ] || continue

  SKILL_NAME="$(basename "$SKILL_DIR")"
  DEST="$CANON_TARGET/$SKILL_NAME"

  if [ -L "$DEST" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "[dry-run] Would replace owned symlink: $DEST -> $SKILL_DIR ($MODE)"
      continue
    fi
    verify_dest_within_target "$DEST" "$CANON_TARGET" && is_owned_symlink "$DEST" "$SKILL_DIR"
    rm "$DEST"
  elif [ -d "$DEST" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "[dry-run] Would replace owned directory: $DEST ($MODE)"
      continue
    fi
    verify_dest_within_target "$DEST" "$CANON_TARGET" && is_owned_copy_dir "$DEST" "$SKILL_NAME" "$DEST"
    rm -rf "$DEST"
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] Would install ($MODE): $SKILL_DIR -> $DEST"
    continue
  fi

  if [ "$MODE" = "symlink" ]; then
    ln -s "$SKILL_DIR" "$DEST"
    echo "Installed symlink: $DEST -> $SKILL_DIR"
  else
    mkdir -p "$DEST"
    cp -R "$SKILL_DIR"/. "$DEST"/
    {
      printf "schema_version=1\n"
      printf "plugin=%s\n" "$PLUGIN_ID"
      printf "managed-by=install.sh\n"
      printf "install-mode=copy\n"
      printf "skill=%s\n" "$SKILL_NAME"
      printf "install-path=%s\n" "$DEST"
      printf "source=%s\n" "$SKILL_DIR"
    } > "$DEST/$MARKER_FILE"
    echo "Installed copy: $DEST"
  fi
  printf "entry|%s|%s|%s|%s\n" "$SKILL_NAME" "$MODE" "$DEST" "$SKILL_DIR" >> "$MANIFEST_TMP"
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] Would write ownership manifest: $MANIFEST_PATH"
else
  mv "$MANIFEST_TMP" "$MANIFEST_PATH"
fi
