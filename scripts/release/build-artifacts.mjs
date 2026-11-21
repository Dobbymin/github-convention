#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { isCompatibleVersion } from "@github-convention/core";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const WORKSPACE_PACKAGES = [
  "packages/cli",
  "packages/skill",
  "packages/core",
  "packages/agent-adapters",
  "packages/github-adapter",
];

export const VERIFIED_TARGETS = [
  { id: "linux-x64", os: "linux", arch: "x64", launcherExt: ".sh" },
  { id: "darwin-arm64", os: "darwin", arch: "arm64", launcherExt: ".sh" },
  { id: "darwin-x64", os: "darwin", arch: "x64", launcherExt: ".sh" },
  { id: "win32-x64", os: "win32", arch: "x64", launcherExt: ".cmd" },
];

const FORBIDDEN_PATH_PATTERNS = [
  /(^|\/)\.harness(\/|$)/i,
  /(^|\/)_workspace(\/|$)/i,
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.npmrc$/i,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)(id_rsa|id_ed25519)(\.pub)?$/i,
  /(^|\/)(secrets?|credentials?)\.(json|ya?ml|toml|txt)$/i,
];

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

export const validatePackageMetadata = (repoRoot = REPO_ROOT) => {
  const packages = {};

  for (const relDir of WORKSPACE_PACKAGES) {
    const pkgPath = path.join(repoRoot, relDir, "package.json");
    if (!fs.existsSync(pkgPath)) {
      throw new Error(`Missing package.json at ${pkgPath}`);
    }
    const pkg = readJson(pkgPath);
    if (typeof pkg.name !== "string" || typeof pkg.version !== "string") {
      throw new Error(`Invalid name/version in ${pkgPath}`);
    }
    if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
      throw new Error(`Missing files whitelist in ${pkg.name}`);
    }
    if (pkg.engines?.node !== ">=22") {
      throw new Error(`Expected engines.node >=22 in ${pkg.name}`);
    }
    if (!pkg.exports || typeof pkg.exports !== "object") {
      throw new Error(`Missing exports in ${pkg.name}`);
    }
    if (pkg.repository !== "https://github.com/Dobbymin/github-convention") {
      throw new Error(`Unexpected repository in ${pkg.name}`);
    }
    if (typeof pkg.homepage !== "string" || pkg.homepage.length === 0) {
      throw new Error(`Missing homepage in ${pkg.name}`);
    }
    packages[pkg.name] = { dir: relDir, manifest: pkg };
  }

  return packages;
};

export const checkBidirectionalCompatibility = (cliPkg, skillPkg) => {
  const compatibleCli = skillPkg?.githubConvention?.compatibleCli;
  const supportedSkill = cliPkg?.githubConvention?.supportedSkill;

  if (typeof compatibleCli !== "string") {
    throw new Error("Skill package.json is missing githubConvention.compatibleCli");
  }
  if (typeof supportedSkill !== "string") {
    throw new Error("CLI package.json is missing githubConvention.supportedSkill");
  }

  const cliMatchesSkill = isCompatibleVersion(cliPkg.version, compatibleCli);
  const skillMatchesCli = isCompatibleVersion(skillPkg.version, supportedSkill);

  if (!cliMatchesSkill) {
    throw new Error(
      `CLI ${cliPkg.version} is incompatible with Skill ${skillPkg.version} (compatibleCli: ${compatibleCli})`,
    );
  }
  if (!skillMatchesCli) {
    throw new Error(
      `Skill ${skillPkg.version} is incompatible with CLI ${cliPkg.version} (supportedSkill: ${supportedSkill})`,
    );
  }

  return {
    cliVersion: cliPkg.version,
    skillVersion: skillPkg.version,
    compatibleCli,
    supportedSkill,
    compatible: true,
  };
};

export const findForbiddenPackFiles = (filePaths) => {
  const violations = [];
  for (const rawPath of filePaths) {
    const normalized = rawPath.replace(/\\/g, "/");
    if (FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
      violations.push(normalized);
    }
  }
  return violations;
};

const parsePackJson = (stdout, pkgName) => {
  const parsed = JSON.parse(stdout);
  if (Array.isArray(parsed)) {
    return parsed.find((entry) => entry.name === pkgName) ?? parsed[0];
  }
  if (parsed && typeof parsed === "object") {
    if (parsed[pkgName]) return parsed[pkgName];
    const firstKey = Object.keys(parsed)[0];
    if (firstKey) return parsed[firstKey];
  }
  throw new Error(`Unable to parse npm pack JSON for ${pkgName}`);
};

export const runWorkspacePackDryRun = (pkgName, repoRoot = REPO_ROOT) => {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const stdout = execFileSync(npmCmd, ["pack", "--dry-run", "--json", "--workspace", pkgName], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const info = parsePackJson(stdout, pkgName);
  const files = (info.files ?? []).map((entry) => entry.path);
  const violations = findForbiddenPackFiles(files);
  if (violations.length > 0) {
    throw new Error(`Forbidden files in ${pkgName} pack output: ${violations.join(", ")}`);
  }
  return {
    name: pkgName,
    version: info.version,
    filename: info.filename,
    entryCount: files.length,
    files,
  };
};

const createTarHeader = (filePath, size, mode = 0o644) => {
  const header = Buffer.alloc(512, 0);
  const name = filePath.replace(/\\/g, "/").slice(0, 100);
  header.write(name, 0, 100, "utf8");
  header.write(mode.toString(8).padStart(7, "0") + "\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(" ", 148, 156, "ascii");
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  let checksum = 0;
  for (let i = 0; i < 512; i += 1) {
    checksum += header[i];
  }
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
};

const createTarGz = (entries) => {
  const chunks = [];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, "utf8");
    chunks.push(createTarHeader(entry.path, data.length, entry.mode ?? 0o644));
    chunks.push(data);
    const remainder = data.length % 512;
    if (remainder !== 0) {
      chunks.push(Buffer.alloc(512 - remainder, 0));
    }
  }
  chunks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(chunks), { level: 9 });
};

const collectBundleFiles = (repoRoot) => {
  const entries = [];
  for (const relDir of WORKSPACE_PACKAGES) {
    const pkgDir = path.join(repoRoot, relDir);
    const pkg = readJson(path.join(pkgDir, "package.json"));
    const pkgJsonPath = `${relDir}/package.json`.replace(/\\/g, "/");
    entries.push({
      path: pkgJsonPath,
      content: fs.readFileSync(path.join(pkgDir, "package.json")),
    });

    for (const pattern of pkg.files ?? []) {
      if (pattern === "package.json") continue;
      const targetPath = path.join(pkgDir, pattern);
      if (!fs.existsSync(targetPath)) {
        throw new Error(`Missing build output "${targetPath}". Run "npm run build" first.`);
      }
      const stack = [targetPath];
      while (stack.length > 0) {
        const current = stack.pop();
        const stat = fs.statSync(current);
        if (stat.isDirectory()) {
          for (const child of fs.readdirSync(current).sort()) {
            stack.push(path.join(current, child));
          }
        } else {
          const relFromRoot = path.relative(repoRoot, current).replace(/\\/g, "/");
          entries.push({ path: relFromRoot, content: fs.readFileSync(current) });
        }
      }
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
};

const buildLauncherContent = (target) => {
  if (target.os === "win32") {
    return [
      "@echo off",
      "setlocal",
      'set "SCRIPT_DIR=%~dp0"',
      'node "%SCRIPT_DIR%packages\\cli\\dist\\index.js" %*',
      "",
    ].join("\r\n");
  }
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
    'exec node "$SCRIPT_DIR/packages/cli/dist/index.js" "$@"',
    "",
  ].join("\n");
};

export const sha256Hex = (bufferOrPath) => {
  const data = Buffer.isBuffer(bufferOrPath) ? bufferOrPath : fs.readFileSync(bufferOrPath);
  return createHash("sha256").update(data).digest("hex");
};

export const buildReleaseManifest = (repoRoot = REPO_ROOT) => {
  const packages = validatePackageMetadata(repoRoot);
  const cliPkg = packages["@github-convention/cli"].manifest;
  const skillPkg = packages["@github-convention/skill"].manifest;
  const compatibility = checkBidirectionalCompatibility(cliPkg, skillPkg);

  const packResults = Object.keys(packages).map((pkgName) =>
    runWorkspacePackDryRun(pkgName, repoRoot),
  );

  const targets = VERIFIED_TARGETS.map((target) => ({
    target: target.id,
    os: target.os,
    arch: target.arch,
    archive: `github-convention-v${cliPkg.version}-${target.id}.tar.gz`,
    launcher: `github-convention-${target.id}${target.launcherExt}`,
  }));

  return {
    schemaVersion: 1,
    cliVersion: cliPkg.version,
    skillVersion: skillPkg.version,
    compatibility,
    targets,
    packages: packResults.map(({ name, version, filename, entryCount }) => ({
      name,
      version,
      filename,
      entryCount,
    })),
  };
};

export const stageArtifacts = (outDir, repoRoot = REPO_ROOT) => {
  const manifest = buildReleaseManifest(repoRoot);
  const bundleEntries = collectBundleFiles(repoRoot);
  const resolvedOut = path.resolve(outDir);
  fs.mkdirSync(resolvedOut, { recursive: true });

  const checksumLines = [];
  const enrichedTargets = [];

  for (const targetMeta of manifest.targets) {
    const targetConfig = VERIFIED_TARGETS.find((t) => t.id === targetMeta.target);
    const launcherContent = buildLauncherContent(targetConfig);
    const launcherPath = path.join(resolvedOut, targetMeta.launcher);
    fs.writeFileSync(launcherPath, launcherContent, {
      mode: targetConfig.os === "win32" ? 0o644 : 0o755,
    });

    const launcherInArchive =
      targetConfig.os === "win32" ? "github-convention.cmd" : "github-convention";
    const archiveBuffer = createTarGz([
      ...bundleEntries,
      {
        path: launcherInArchive,
        content: launcherContent,
        mode: targetConfig.os === "win32" ? 0o644 : 0o755,
      },
    ]);
    const archivePath = path.join(resolvedOut, targetMeta.archive);
    fs.writeFileSync(archivePath, archiveBuffer);

    const archiveSha256 = sha256Hex(archiveBuffer);
    const launcherSha256 = sha256Hex(launcherPath);

    checksumLines.push(`${archiveSha256}  ${targetMeta.archive}`);
    checksumLines.push(`${launcherSha256}  ${targetMeta.launcher}`);

    enrichedTargets.push({
      ...targetMeta,
      archiveSha256,
      launcherSha256,
    });
  }

  const finalManifest = { ...manifest, targets: enrichedTargets };
  const targetsJsonPath = path.join(resolvedOut, "targets.json");
  const targetsJsonContent = `${JSON.stringify(finalManifest, null, 2)}\n`;
  fs.writeFileSync(targetsJsonPath, targetsJsonContent, "utf8");
  checksumLines.push(`${sha256Hex(targetsJsonPath)}  targets.json`);

  checksumLines.sort((a, b) => a.split("  ")[1].localeCompare(b.split("  ")[1]));
  const sumsPath = path.join(resolvedOut, "SHA256SUMS.txt");
  fs.writeFileSync(sumsPath, `${checksumLines.join("\n")}\n`, "utf8");

  return {
    outDir: resolvedOut,
    manifest: finalManifest,
    checksumFile: sumsPath,
  };
};

const parseArgs = (argv) => {
  let dryRun = false;
  let outDir = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--out") {
      outDir = argv[i + 1] ?? null;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!dryRun && !outDir) {
    throw new Error("Usage: build-artifacts.mjs --dry-run | --out <dir>");
  }
  return { dryRun, outDir };
};

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    const { dryRun, outDir } = parseArgs(process.argv.slice(2));
    if (dryRun) {
      const manifest = buildReleaseManifest(REPO_ROOT);
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    } else {
      const result = stageArtifacts(outDir, REPO_ROOT);
      process.stdout.write(`${JSON.stringify(result.manifest, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
