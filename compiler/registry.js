// compiler/registry.js
// Decentralized Package Registry & Ecosystem for PlainScript (RFC-0010 / Phase 9).
// Supports Git dependencies (github:user/repo), remote .plz archives, and
// vendoring into .plainscript/vendor/ with SHA-256 cryptographic verification.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { unpackPackage, packPackage, sha256, MANIFEST_NAME } = require('./packager');

const VENDOR_DIR = path.join('.plainscript', 'vendor');
const LOCK_FILE = 'pln.lock';

/**
 * Parses package specifier into structured metadata.
 * 
 * Supported formats:
 * - github:owner/repo[@ref]
 * - git+https://github.com/owner/repo.git[#ref]
 * - https://example.com/packages/pkg-1.0.0.plz
 * - file:./path/to/pkg-1.0.0.plz or ./path/to/pkg-1.0.0.plz
 * - standard npm package (e.g. "lodash", "@plainscript/core")
 */
function parsePackageSpec(spec) {
  if (!spec || typeof spec !== 'string') {
    throw new Error('Package specifier must be a non-empty string.');
  }

  // 1. GitHub shortcut: github:owner/repo[@ref]
  const ghMatch = spec.match(/^github:([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)(?:@([a-zA-Z0-9_.-]+))?$/);
  if (ghMatch) {
    const [, owner, repo, ref] = ghMatch;
    const cleanRepo = repo.replace(/\.git$/, '');
    return {
      type: 'git',
      name: cleanRepo,
      owner,
      repo: cleanRepo,
      ref: ref || 'main',
      url: `https://github.com/${owner}/${cleanRepo}.git`,
      raw: spec,
    };
  }

  // 2. Full Git URL: git+https://... or git@... or https://github.com/... (if ends in .git)
  if (spec.startsWith('git+') || spec.startsWith('git@') || (spec.startsWith('https://') && spec.includes('.git'))) {
    const [rawUrl, ref] = spec.replace(/^git\+/, '').split('#');
    const repoMatch = rawUrl.match(/\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/);
    const name = repoMatch ? repoMatch[1] : 'git-pkg';
    return {
      type: 'git',
      name,
      url: rawUrl,
      ref: ref || 'main',
      raw: spec,
    };
  }

  // 3. Remote .plz archive URL
  if (spec.startsWith('https://') || spec.startsWith('http://')) {
    const urlObj = new URL(spec);
    const filename = path.basename(urlObj.pathname);
    const nameMatch = filename.match(/^([a-zA-Z0-9_.-]+?)(?:-[0-9.]+)?\.plz$/);
    const name = nameMatch ? nameMatch[1] : filename.replace(/\.plz$/, '');
    return {
      type: 'remote-archive',
      name,
      url: spec,
      raw: spec,
    };
  }

  // 4. Local .plz archive: file:./pkg.plz or ./pkg.plz
  if (spec.endsWith('.plz')) {
    const cleanPath = spec.replace(/^file:/, '');
    const filename = path.basename(cleanPath);
    const nameMatch = filename.match(/^([a-zA-Z0-9_.-]+?)(?:-[0-9.]+)?\.plz$/);
    const name = nameMatch ? nameMatch[1] : filename.replace(/\.plz$/, '');
    return {
      type: 'local-archive',
      name,
      path: path.resolve(cleanPath),
      raw: spec,
    };
  }

  // 5. Standard npm package
  return {
    type: 'npm',
    name: spec.replace(/@[^/]+$/, ''),
    raw: spec,
  };
}

/**
 * Resolves a vendored package's entry point file path.
 * Searches .plainscript/vendor/<pkgName> up from currentDir.
 */
function resolveVendorEntry(currentDir, pkgName) {
  let dir = path.resolve(currentDir);
  while (true) {
    const candidate = path.join(dir, VENDOR_DIR, pkgName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      const manifestPath = path.join(candidate, MANIFEST_NAME);
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          if (manifest.main) {
            const mainFile = path.resolve(candidate, manifest.main);
            if (fs.existsSync(mainFile)) return mainFile;
          }
        } catch (_) {}
      }

      // Check default entry candidates
      const defaults = [
        path.join(candidate, 'src', 'index.pln'),
        path.join(candidate, 'index.pln'),
        path.join(candidate, `${pkgName}.pln`),
        path.join(candidate, 'src', `${pkgName}.pln`),
      ];
      for (const d of defaults) {
        if (fs.existsSync(d) && fs.statSync(d).isFile()) return d;
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Vendors a pure PlainScript package into .plainscript/vendor/
 * and updates pln.json & pln.lock with SHA-256 integrity.
 */
function vendorPackage(spec, projectDir = process.cwd(), options = {}) {
  const root = path.resolve(projectDir);
  const parsed = parsePackageSpec(spec);

  if (parsed.type === 'npm') {
    throw new Error(`Package "${spec}" is an npm package, not a pure PlainScript module.`);
  }

  const vendorTargetDir = path.join(root, VENDOR_DIR, parsed.name);
  fs.mkdirSync(path.dirname(vendorTargetDir), { recursive: true });

  let integrity = '';
  let version = '1.0.0';
  let resolvedSource = parsed.raw;

  if (parsed.type === 'local-archive') {
    if (!fs.existsSync(parsed.path)) {
      throw new Error(`Package archive not found: ${parsed.path}`);
    }
    const rawArchive = fs.readFileSync(parsed.path);
    integrity = `sha256-${sha256(rawArchive)}`;

    // Remove old target dir if exists
    if (fs.existsSync(vendorTargetDir)) {
      fs.rmSync(vendorTargetDir, { recursive: true, force: true });
    }

    const unpacked = unpackPackage(parsed.path, vendorTargetDir);
    version = (unpacked.manifest && unpacked.manifest.version) || '1.0.0';
  } else if (parsed.type === 'remote-archive') {
    // Synchronous download via curl or fetch helper
    const tmpFile = path.join(root, '.plainscript', `${parsed.name}-tmp.plz`);
    fs.mkdirSync(path.dirname(tmpFile), { recursive: true });

    try {
      execFileSync('curl', ['-sSL', parsed.url, '-o', tmpFile]);
    } catch (_) {
      throw new Error(`Failed to download package from "${parsed.url}". Ensure curl is available.`);
    }

    const rawArchive = fs.readFileSync(tmpFile);
    integrity = `sha256-${sha256(rawArchive)}`;

    if (fs.existsSync(vendorTargetDir)) {
      fs.rmSync(vendorTargetDir, { recursive: true, force: true });
    }
    const unpacked = unpackPackage(tmpFile, vendorTargetDir);
    fs.rmSync(tmpFile, { force: true });
    version = (unpacked.manifest && unpacked.manifest.version) || '1.0.0';
  } else if (parsed.type === 'git') {
    // Clone Git repo
    if (fs.existsSync(vendorTargetDir)) {
      fs.rmSync(vendorTargetDir, { recursive: true, force: true });
    }

    try {
      execFileSync('git', ['clone', '--depth', '1', '--branch', parsed.ref, parsed.url, vendorTargetDir], {
        stdio: options.verbose ? 'inherit' : 'pipe',
      });
    } catch (e) {
      // Retry without branch if default branch differs
      try {
        execFileSync('git', ['clone', '--depth', '1', parsed.url, vendorTargetDir], {
          stdio: options.verbose ? 'inherit' : 'pipe',
        });
      } catch (err) {
        throw new Error(`Failed to clone git repository "${parsed.url}": ${err.message}`);
      }
    }

    // Clean up .git directory to keep vendor lightweight
    const gitDir = path.join(vendorTargetDir, '.git');
    if (fs.existsSync(gitDir)) {
      fs.rmSync(gitDir, { recursive: true, force: true });
    }

    // Read manifest
    const manifestPath = path.join(vendorTargetDir, MANIFEST_NAME);
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        version = manifest.version || '1.0.0';
      } catch (_) {}
    }

    // Compute composite tree SHA-256 for integrity
    const hash = crypto.createHash('sha256');
    (function walk(d) {
      for (const item of fs.readdirSync(d).sort()) {
        const full = path.join(d, item);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full);
        else hash.update(fs.readFileSync(full));
      }
    })(vendorTargetDir);
    integrity = `sha256-${hash.digest('hex')}`;
  }

  // Update pln.json manifest in root
  const manifestPath = path.join(root, MANIFEST_NAME);
  let manifest = { name: path.basename(root), version: '1.0.0', dependencies: {} };
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_) {}
  }
  if (!manifest.dependencies) manifest.dependencies = {};
  manifest.dependencies[parsed.name] = parsed.raw;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // Update pln.lock
  const lockPath = path.join(root, LOCK_FILE);
  let lock = { lockfileVersion: 1, packages: {} };
  if (fs.existsSync(lockPath)) {
    try {
      lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch (_) {}
  }
  lock.packages[parsed.name] = {
    version,
    source: resolvedSource,
    integrity,
    resolvedAt: new Date().toISOString(),
  };
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');

  return {
    name: parsed.name,
    version,
    integrity,
    path: vendorTargetDir,
  };
}

/**
 * Restores all dependencies listed in pln.json into .plainscript/vendor/
 */
function restoreVendoredPackages(projectDir = process.cwd(), options = {}) {
  const root = path.resolve(projectDir);
  const manifestPath = path.join(root, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return [];

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    throw new Error(`Invalid ${MANIFEST_NAME}: ${e.message}`);
  }

  const deps = manifest.dependencies || {};
  const restored = [];

  for (const [name, spec] of Object.entries(deps)) {
    const parsed = parsePackageSpec(spec);
    if (parsed.type !== 'npm') {
      const res = vendorPackage(spec, root, options);
      restored.push(res);
    }
  }

  return restored;
}

module.exports = {
  VENDOR_DIR,
  LOCK_FILE,
  parsePackageSpec,
  resolveVendorEntry,
  vendorPackage,
  restoreVendoredPackages,
};
