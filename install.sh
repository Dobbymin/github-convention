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

is_safe_skill_name() {
  case "$1" in
    ""|.|..|*/*) return 1 ;;
    *) return 0 ;;
  esac
}

verify_dest_within_target() {
  DEST_PATH="$1"
  CANON_TARGET_DIR="$2"
  EXPECTED_NAME="${3:-$(basename -- "$DEST_PATH")}"
  [ -n "$DEST_PATH" ] && [ -n "$CANON_TARGET_DIR" ] && [ -n "$EXPECTED_NAME" ] || return 1
  is_safe_skill_name "$EXPECTED_NAME" || return 1
  DEST_PARENT="$(canonicalize_path "$(dirname -- "$DEST_PATH")")" || return 1
  [ "$DEST_PARENT" = "$CANON_TARGET_DIR" ] || return 1
  CANON_DEST="$(canonicalize_path "$DEST_PATH")" || return 1
  EXPECTED_DEST="$CANON_TARGET_DIR/$EXPECTED_NAME"
  [ "$DEST_PATH" = "$EXPECTED_DEST" ] || return 1
  [ "$CANON_DEST" = "$EXPECTED_DEST" ] || return 1
  [ "$CANON_DEST" != "/" ] || return 1
  [ "$CANON_DEST" != "$CANON_TARGET_DIR" ] || return 1
  [ "$CANON_DEST" != "$SCRIPT_DIR" ] || return 1
  [ "$CANON_DEST" != "$SKILLS_ROOT" ] || return 1
  return 0
}

is_owned_symlink() {
  _OS_DEST="$1"
  _OS_EXPECTED="$2"
  [ -L "$_OS_DEST" ] || return 1
  _OS_LINK="$(readlink "$_OS_DEST")" || return 1
  [ -n "$_OS_LINK" ] || return 1
  case "$_OS_LINK" in
    /*) _OS_RESOLVED="$_OS_LINK" ;;
    *) _OS_RESOLVED="$(dirname -- "$_OS_DEST")/$_OS_LINK" ;;
  esac
  _OS_CANON_ACTUAL="$(canonicalize_path "$_OS_RESOLVED")" || return 1
  _OS_CANON_EXPECTED="$(canonicalize_path "$_OS_EXPECTED")" || return 1
  _OS_CANON_SKILLS_ROOT="$(canonicalize_path "$SKILLS_ROOT")" || return 1
  case "$_OS_CANON_ACTUAL" in
    "$_OS_CANON_SKILLS_ROOT"/*) ;;
    *) return 1 ;;
  esac
  [ "$_OS_CANON_ACTUAL" = "$_OS_CANON_EXPECTED" ]
}

verify_copy_dir_contents() {
  _VC_DEST="$1"
  _VC_SOURCE="$2"
  for _VC_ENTRY in "$_VC_DEST"/* "$_VC_DEST"/.*; do
    [ -e "$_VC_ENTRY" ] || [ -L "$_VC_ENTRY" ] || continue
    _VC_NAME="$(basename -- "$_VC_ENTRY")"
    case "$_VC_NAME" in
      .|..|"$MARKER_FILE") continue ;;
    esac
    if [ -L "$_VC_ENTRY" ]; then
      return 1
    fi
    _VC_SRC_ENTRY="$_VC_SOURCE/$_VC_NAME"
    if [ ! -e "$_VC_SRC_ENTRY" ] || [ -L "$_VC_SRC_ENTRY" ]; then
      return 1
    fi
    if [ -d "$_VC_ENTRY" ]; then
      [ -d "$_VC_SRC_ENTRY" ] || return 1
      verify_copy_dir_contents "$_VC_ENTRY" "$_VC_SRC_ENTRY" || return 1
    elif [ -f "$_VC_ENTRY" ]; then
      [ -f "$_VC_SRC_ENTRY" ] || return 1
    else
      return 1
    fi
  done
  return 0
}

verify_orphan_copy_dir_contents() {
  _VO_DEST="$1"
  for _VO_ENTRY in "$_VO_DEST"/* "$_VO_DEST"/.*; do
    [ -e "$_VO_ENTRY" ] || [ -L "$_VO_ENTRY" ] || continue
    _VO_NAME="$(basename -- "$_VO_ENTRY")"
    case "$_VO_NAME" in
      .|..|"$MARKER_FILE"|SKILL.md)
        if [ "$_VO_NAME" = "SKILL.md" ]; then
          [ -f "$_VO_ENTRY" ] && [ ! -L "$_VO_ENTRY" ] || return 1
        fi
        continue
        ;;
      references)
        [ -d "$_VO_ENTRY" ] && [ ! -L "$_VO_ENTRY" ] || return 1
        for _VO_REF in "$_VO_ENTRY"/* "$_VO_ENTRY"/.*; do
          [ -e "$_VO_REF" ] || [ -L "$_VO_REF" ] || continue
          _VO_REF_NAME="$(basename -- "$_VO_REF")"
          case "$_VO_REF_NAME" in
            .|..) continue ;;
            *.md)
              [ -f "$_VO_REF" ] && [ ! -L "$_VO_REF" ] || return 1
              ;;
            *) return 1 ;;
          esac
        done
        ;;
      *)
        return 1
        ;;
    esac
  done
  return 0
}

is_owned_copy_dir() {
  DEST_PATH="$1"
  SKILL_NAME="$2"
  CANON_DEST_PATH="$3"
  EXPECTED_SOURCE_DIR="${4:-$SKILLS_ROOT/$SKILL_NAME}"
  [ -d "$DEST_PATH" ] && [ ! -L "$DEST_PATH" ] || return 1
  CANON_ACTUAL_DEST="$(canonicalize_path "$DEST_PATH")" || return 1
  [ "$CANON_ACTUAL_DEST" = "$CANON_DEST_PATH" ] || return 1
  MARKER_PATH="$DEST_PATH/$MARKER_FILE"
  [ -f "$MARKER_PATH" ] && [ ! -L "$MARKER_PATH" ] || return 1
  SKILL_MD_PATH="$DEST_PATH/SKILL.md"
  [ -f "$SKILL_MD_PATH" ] && [ ! -L "$SKILL_MD_PATH" ] || return 1
  grep -Eq "^name:[[:space:]]*$SKILL_NAME[[:space:]]*$" "$SKILL_MD_PATH" 2>/dev/null || return 1

  CANON_EXPECTED_SOURCE="$(canonicalize_path "$EXPECTED_SOURCE_DIR")" || return 1
  CANON_SKILLS_ROOT="$(canonicalize_path "$SKILLS_ROOT")" || return 1
  case "$CANON_EXPECTED_SOURCE" in
    "$CANON_SKILLS_ROOT"/*) ;;
    *) return 1 ;;
  esac

  if grep -qx "plugin=$PLUGIN_ID" "$MARKER_PATH" 2>/dev/null; then
    if [ "$(grep -c "^plugin=" "$MARKER_PATH" 2>/dev/null || printf '0')" -ne 1 ]; then
      return 1
    fi
    if grep -q "^skill=" "$MARKER_PATH" 2>/dev/null; then
      grep -qx "skill=$SKILL_NAME" "$MARKER_PATH" 2>/dev/null || return 1
    fi
    if grep -q "^install-path=" "$MARKER_PATH" 2>/dev/null; then
      MARKER_INSTALL_PATH="$(sed -n 's/^install-path=//p' "$MARKER_PATH" | head -n 1)"
      [ -n "$MARKER_INSTALL_PATH" ] || return 1
      CANON_MARKER_INSTALL="$(canonicalize_path "$MARKER_INSTALL_PATH")" || return 1
      [ "$CANON_MARKER_INSTALL" = "$CANON_DEST_PATH" ] || return 1
    fi
    if grep -q "^source=" "$MARKER_PATH" 2>/dev/null; then
      MARKER_SOURCE_PATH="$(sed -n 's/^source=//p' "$MARKER_PATH" | head -n 1)"
      [ -n "$MARKER_SOURCE_PATH" ] || return 1
      CANON_MARKER_SOURCE="$(canonicalize_path "$MARKER_SOURCE_PATH")" || return 1
      [ "$CANON_MARKER_SOURCE" = "$CANON_EXPECTED_SOURCE" ] || return 1
    fi
    if [ -d "$CANON_EXPECTED_SOURCE" ]; then
      verify_copy_dir_contents "$DEST_PATH" "$CANON_EXPECTED_SOURCE" || return 1
    else
      verify_orphan_copy_dir_contents "$DEST_PATH" || return 1
    fi
    return 0
  fi

  if grep -qx "managed-by=install.sh" "$MARKER_PATH" 2>/dev/null && ! grep -q "^plugin=" "$MARKER_PATH" 2>/dev/null; then
    if [ -d "$CANON_EXPECTED_SOURCE" ]; then
      verify_copy_dir_contents "$DEST_PATH" "$CANON_EXPECTED_SOURCE" || return 1
    else
      verify_orphan_copy_dir_contents "$DEST_PATH" || return 1
    fi
    return 0
  fi
  return 1
}

is_owned_manifest() {
  MANIFEST_PATH="$1"
  [ -f "$MANIFEST_PATH" ] && [ ! -L "$MANIFEST_PATH" ] || return 1
  if [ "$(grep -c "^plugin=" "$MANIFEST_PATH" 2>/dev/null || printf '0')" -ne 1 ]; then
    return 1
  fi
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
ORPHAN_PLAN_ENTRIES=""

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
  CANON_SKILL_DIR="$(canonicalize_path "$SKILL_DIR")"
  DEST="$CANON_TARGET/$SKILL_NAME"

  if ! verify_dest_within_target "$DEST" "$CANON_TARGET" "$SKILL_NAME"; then
    echo "Conflict: destination path escapes target directory ($DEST)." >&2
    CONFLICT_COUNT=$((CONFLICT_COUNT + 1))
    continue
  fi

  if [ -L "$DEST" ]; then
    if ! is_owned_symlink "$DEST" "$CANON_SKILL_DIR"; then
      LINK_TARGET="$(readlink "$DEST" 2>/dev/null || printf '<unreadable>')"
      echo "Conflict: refusing to replace unmanaged symlink at $DEST (points to: $LINK_TARGET). Remove or relocate it manually." >&2
      CONFLICT_COUNT=$((CONFLICT_COUNT + 1))
    fi
  elif [ -e "$DEST" ]; then
    if [ -d "$DEST" ]; then
      if ! is_owned_copy_dir "$DEST" "$SKILL_NAME" "$DEST" "$CANON_SKILL_DIR"; then
        echo "Conflict: refusing to overwrite unmanaged directory at $DEST (missing valid $MARKER_FILE or contains unexpected files). Remove or relocate it manually." >&2
        CONFLICT_COUNT=$((CONFLICT_COUNT + 1))
      fi
    else
      echo "Conflict: refusing to overwrite existing non-directory file at $DEST. Remove or relocate it manually." >&2
      CONFLICT_COUNT=$((CONFLICT_COUNT + 1))
    fi
  fi
done

# Pass 1b: Inspect existing owned manifest for retired/orphan skill entries no longer in skills/
if [ -f "$MANIFEST_PATH" ] && is_owned_manifest "$MANIFEST_PATH"; then
  while IFS='|' read -r REC_KIND REC_SKILL _REC_MODE _REC_DEST _REC_SOURCE; do
    [ "$REC_KIND" = "entry" ] || continue
    [ -n "$REC_SKILL" ] || continue
    if ! is_safe_skill_name "$REC_SKILL"; then
      echo "Conflict: unsafe skill name '$REC_SKILL' in manifest $MANIFEST_PATH." >&2
      CONFLICT_COUNT=$((CONFLICT_COUNT + 1))
      continue
    fi
    # Skip if still an active skill in SKILLS_ROOT
    if [ -f "$SKILLS_ROOT/$REC_SKILL/SKILL.md" ]; then
      continue
    fi
    ORPHAN_DEST="$CANON_TARGET/$REC_SKILL"
    ORPHAN_EXPECTED_SRC="$(canonicalize_path "$SKILLS_ROOT/$REC_SKILL")"
    if [ ! -e "$ORPHAN_DEST" ] && [ ! -L "$ORPHAN_DEST" ]; then
      continue
    fi
    if ! verify_dest_within_target "$ORPHAN_DEST" "$CANON_TARGET" "$REC_SKILL"; then
      echo "Conflict: retired manifest entry escapes target directory ($ORPHAN_DEST)." >&2
      CONFLICT_COUNT=$((CONFLICT_COUNT + 1))
      continue
    fi
    if [ -L "$ORPHAN_DEST" ]; then
      if ! is_owned_symlink "$ORPHAN_DEST" "$ORPHAN_EXPECTED_SRC"; then
        LINK_TARGET="$(readlink "$ORPHAN_DEST" 2>/dev/null || printf '<unreadable>')"
        echo "Conflict: refusing to prune unmanaged retired symlink at $ORPHAN_DEST (points to: $LINK_TARGET)." >&2
        CONFLICT_COUNT=$((CONFLICT_COUNT + 1))
        continue
      fi
      ORPHAN_PLAN_ENTRIES="${ORPHAN_PLAN_ENTRIES}symlink|${REC_SKILL}|${ORPHAN_DEST}|${ORPHAN_EXPECTED_SRC}
"
    elif [ -d "$ORPHAN_DEST" ]; then
      if ! is_owned_copy_dir "$ORPHAN_DEST" "$REC_SKILL" "$ORPHAN_DEST" "$ORPHAN_EXPECTED_SRC"; then
        echo "Conflict: refusing to prune unmanaged retired directory at $ORPHAN_DEST." >&2
        CONFLICT_COUNT=$((CONFLICT_COUNT + 1))
        continue
      fi
      ORPHAN_PLAN_ENTRIES="${ORPHAN_PLAN_ENTRIES}copy|${REC_SKILL}|${ORPHAN_DEST}|${ORPHAN_EXPECTED_SRC}
"
    else
      echo "Conflict: refusing to prune unmanaged non-directory file at $ORPHAN_DEST." >&2
      CONFLICT_COUNT=$((CONFLICT_COUNT + 1))
    fi
  done < "$MANIFEST_PATH"
fi

if [ "$SKILL_COUNT" -eq 0 ]; then
  echo "No skills found under $SKILLS_ROOT" >&2
  exit 1
fi

if [ "$CONFLICT_COUNT" -gt 0 ]; then
  echo "Aborted installation: $CONFLICT_COUNT conflict(s) detected. No files were modified." >&2
  exit 1
fi

# Pass 2: Preview or apply changes (re-verify right before any removal)
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

if [ -n "$ORPHAN_PLAN_ENTRIES" ]; then
  while IFS='|' read -r ORPHAN_TYPE ORPHAN_SKILL ORPHAN_DEST ORPHAN_SRC; do
    [ -n "$ORPHAN_TYPE" ] || continue
    if [ ! -e "$ORPHAN_DEST" ] && [ ! -L "$ORPHAN_DEST" ]; then
      continue
    fi
    if [ "$ORPHAN_TYPE" = "symlink" ]; then
      if [ "$DRY_RUN" -eq 1 ]; then
        echo "[dry-run] Would prune retired owned symlink: $ORPHAN_DEST"
      else
        if ! verify_dest_within_target "$ORPHAN_DEST" "$CANON_TARGET" "$ORPHAN_SKILL"; then
          rm -f "$MANIFEST_TMP"
          echo "Destination path verification failed for $ORPHAN_DEST. Aborting." >&2
          exit 1
        fi
        if ! is_owned_symlink "$ORPHAN_DEST" "$ORPHAN_SRC"; then
          rm -f "$MANIFEST_TMP"
          echo "Symlink ownership verification failed for $ORPHAN_DEST. Aborting." >&2
          exit 1
        fi
        rm "$ORPHAN_DEST"
        echo "Pruned retired symlink: $ORPHAN_DEST"
      fi
    elif [ "$ORPHAN_TYPE" = "copy" ]; then
      if [ "$DRY_RUN" -eq 1 ]; then
        echo "[dry-run] Would prune retired owned directory: $ORPHAN_DEST"
      else
        if ! verify_dest_within_target "$ORPHAN_DEST" "$CANON_TARGET" "$ORPHAN_SKILL"; then
          rm -f "$MANIFEST_TMP"
          echo "Destination path verification failed for $ORPHAN_DEST. Aborting." >&2
          exit 1
        fi
        if ! is_owned_copy_dir "$ORPHAN_DEST" "$ORPHAN_SKILL" "$ORPHAN_DEST" "$ORPHAN_SRC"; then
          rm -f "$MANIFEST_TMP"
          echo "Directory ownership verification failed for $ORPHAN_DEST. Aborting." >&2
          exit 1
        fi
        rm -rf "$ORPHAN_DEST"
        echo "Pruned retired directory: $ORPHAN_DEST"
      fi
    fi
  done <<EOF
$ORPHAN_PLAN_ENTRIES
EOF
fi

for SKILL_DIR in "$SKILLS_ROOT"/*; do
  [ -d "$SKILL_DIR" ] || continue
  [ -f "$SKILL_DIR/SKILL.md" ] || continue

  SKILL_NAME="$(basename "$SKILL_DIR")"
  CANON_SKILL_DIR="$(canonicalize_path "$SKILL_DIR")"
  DEST="$CANON_TARGET/$SKILL_NAME"

  if [ -L "$DEST" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "[dry-run] Would replace owned symlink: $DEST -> $CANON_SKILL_DIR ($MODE)"
      continue
    fi
    if ! verify_dest_within_target "$DEST" "$CANON_TARGET" "$SKILL_NAME"; then
      rm -f "$MANIFEST_TMP"
      echo "Destination path verification failed for $DEST. Aborting." >&2
      exit 1
    fi
    if ! is_owned_symlink "$DEST" "$CANON_SKILL_DIR"; then
      rm -f "$MANIFEST_TMP"
      echo "Symlink ownership verification failed for $DEST. Aborting." >&2
      exit 1
    fi
    rm "$DEST"
  elif [ -e "$DEST" ]; then
    if [ ! -d "$DEST" ]; then
      rm -f "$MANIFEST_TMP"
      echo "Unexpected non-directory file at $DEST. Aborting." >&2
      exit 1
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "[dry-run] Would replace owned directory: $DEST ($MODE)"
      continue
    fi
    if ! verify_dest_within_target "$DEST" "$CANON_TARGET" "$SKILL_NAME"; then
      rm -f "$MANIFEST_TMP"
      echo "Destination path verification failed for $DEST. Aborting." >&2
      exit 1
    fi
    if ! is_owned_copy_dir "$DEST" "$SKILL_NAME" "$DEST" "$CANON_SKILL_DIR"; then
      rm -f "$MANIFEST_TMP"
      echo "Directory ownership verification failed for $DEST. Aborting." >&2
      exit 1
    fi
    rm -rf "$DEST"
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] Would install ($MODE): $CANON_SKILL_DIR -> $DEST"
    continue
  fi

  if [ "$MODE" = "symlink" ]; then
    ln -s "$CANON_SKILL_DIR" "$DEST"
    echo "Installed symlink: $DEST -> $CANON_SKILL_DIR"
  else
    mkdir -p "$DEST"
    cp -R "$CANON_SKILL_DIR"/. "$DEST"/
    {
      printf "schema_version=1\n"
      printf "plugin=%s\n" "$PLUGIN_ID"
      printf "managed-by=install.sh\n"
      printf "install-mode=copy\n"
      printf "skill=%s\n" "$SKILL_NAME"
      printf "install-path=%s\n" "$DEST"
      printf "source=%s\n" "$CANON_SKILL_DIR"
    } > "$DEST/$MARKER_FILE"
    echo "Installed copy: $DEST"
  fi
  printf "entry|%s|%s|%s|%s\n" "$SKILL_NAME" "$MODE" "$DEST" "$CANON_SKILL_DIR" >> "$MANIFEST_TMP"
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] Would write ownership manifest: $MANIFEST_PATH"
else
  if [ -e "$MANIFEST_PATH" ] || [ -L "$MANIFEST_PATH" ]; then
    if ! is_owned_manifest "$MANIFEST_PATH"; then
      rm -f "$MANIFEST_TMP"
      echo "Manifest ownership verification failed for $MANIFEST_PATH. Aborting." >&2
      exit 1
    fi
  fi
  mv "$MANIFEST_TMP" "$MANIFEST_PATH"
fi
