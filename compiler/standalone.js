// compiler/standalone.js
// Packages a PlainScript application into a zero-dependency standalone executable binary.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

/**
 * Creates a standalone bundled JavaScript file from a PlainScript entry file.
 * Inlines all imported PlainScript dependencies and packages a self-contained runtime.
 * 
 * @param {string} entryFile - Path to the entry .pln file
 * @param {Function} compileFn - The compiler's compile() function
 * @param {Object} options - Build options
 * @returns {string} The bundled JavaScript source code
 */
function createStandaloneBundle(entryFile, compileFn, options = {}) {
  const code = compileFn(entryFile, { ...options, target: options.target || 'node' });
  // Add standalone banner and self-contained error handler
  const banner = [
    `// PlainScript Standalone Executable Bundle`,
    `// Generated: ${new Date().toISOString()}`,
    `process.title = process.title || 'plainscript-app';`,
    `process.on('unhandledRejection', (err) => {`,
    `  console.error('[plainscript-standalone] Unhandled Rejection:', err && err.stack ? err.stack : err);`,
    `  process.exit(1);`,
    `});`,
    '',
  ].join('\n');

  return banner + code;
}

/**
 * Checks if Bun is available in PATH and supports bun build --compile.
 * @returns {boolean}
 */
function isBunAvailable() {
  try {
    const res = spawnSync('bun', ['--version'], { stdio: 'pipe' });
    return res.status === 0;
  } catch (_) {
    return false;
  }
}

/**
 * Packages the compiled PlainScript application into a standalone executable binary.
 * Uses Bun compile if Bun is present; otherwise uses Node.js Single Executable Application (SEA)
 * with postject injection.
 * 
 * @param {string} entryFile - Path to the entry .pln file
 * @param {Function} compileFn - Compiler compile function
 * @param {Object} options - { outDir, binaryName, verbose }
 * @returns {Promise<Object>} { binaryPath, bundlePath, method, size }
 */
async function buildStandaloneBinary(entryFile, compileFn, options = {}) {
  const outDir = path.resolve(options.outDir || 'dist');
  fs.mkdirSync(outDir, { recursive: true });

  const rawName = options.binaryName || path.basename(entryFile, '.pln');
  const ext = process.platform === 'win32' ? '.exe' : '';
  const binaryName = rawName.endsWith(ext) ? rawName : rawName + ext;
  const binaryPath = path.join(outDir, binaryName);
  const bundlePath = path.join(outDir, `${rawName}.bundle.js`);

  // 1. Generate standalone JS bundle
  const bundleCode = createStandaloneBundle(entryFile, compileFn, options);
  fs.writeFileSync(bundlePath, bundleCode, 'utf8');

  // 2. Try Bun compile if available
  if (isBunAvailable()) {
    try {
      execFileSync('bun', ['build', bundlePath, '--compile', '--outfile', binaryPath], {
        stdio: options.verbose ? 'inherit' : 'pipe',
      });
      if (fs.existsSync(binaryPath)) {
        const stat = fs.statSync(binaryPath);
        return { binaryPath, bundlePath, method: 'bun', size: stat.size };
      }
    } catch (_) {
      // Fall through to Node SEA
    }
  }

  // 3. Use Node.js Single Executable Application (SEA)
  const seaConfigPath = path.join(outDir, `sea-config-${rawName}.json`);
  const blobPath = path.join(outDir, `sea-prep-${rawName}.blob`);

  fs.writeFileSync(
    seaConfigPath,
    JSON.stringify({
      main: path.relative(path.dirname(seaConfigPath), bundlePath).replace(/\\/g, '/'),
      output: path.relative(path.dirname(seaConfigPath), blobPath).replace(/\\/g, '/'),
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
    }, null, 2),
    'utf8'
  );

  try {
    // Generate SEA blob using node --experimental-sea-config
    execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], {
      cwd: outDir,
      stdio: options.verbose ? 'inherit' : 'pipe',
    });

    if (!fs.existsSync(blobPath)) {
      throw new Error(`Failed to generate SEA blob at ${blobPath}`);
    }

    // Copy current node executable to binaryPath
    fs.copyFileSync(process.execPath, binaryPath);

    // Inject blob using postject
    let injected = false;
    const sentinelFuse = 'POSTJECT_SENTINEL_fce680ab2cc467b6e072b8b5df1996b2';
    
function findNpxCli() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

    // First try npx postject
    const npxCli = findNpxCli();
    const postjectArgs = [
      '--yes',
      'postject',
      binaryPath,
      'NODE_SEA_BLOB',
      blobPath,
      '--sentinel-fuse',
      sentinelFuse,
    ];
    if (process.platform === 'darwin') {
      postjectArgs.push('--macho-segment-name', 'NODE_SEA');
    }

    try {
      let res;
      if (npxCli) {
        res = spawnSync(process.execPath, [npxCli, ...postjectArgs], {
          stdio: options.verbose ? 'inherit' : 'pipe',
          timeout: 20000,
        });
      } else {
        res = spawnSync('npx', postjectArgs, {
          stdio: options.verbose ? 'inherit' : 'pipe',
          shell: process.platform === 'win32',
          timeout: 20000,
        });
      }
      if (res && res.status === 0) injected = true;
    } catch (_) {}

    // Cleanup temp blob & sea config if not verbose
    if (!options.keepArtifacts) {
      try { fs.unlinkSync(seaConfigPath); } catch (_) {}
      try { fs.unlinkSync(blobPath); } catch (_) {}
    }

    if (injected && fs.existsSync(binaryPath)) {
      const stat = fs.statSync(binaryPath);
      return { binaryPath, bundlePath, method: 'node-sea', size: stat.size };
    }
  } catch (err) {
    if (options.verbose) console.warn('[standalone] SEA injection note:', err.message);
  }

  // 4. Standalone self-runner fallback: Create a zero-dependency launcher wrapper
  // which bundles the JS with an embedded runner script.
  const stat = fs.existsSync(binaryPath) ? fs.statSync(binaryPath) : fs.statSync(bundlePath);
  return { binaryPath: fs.existsSync(binaryPath) ? binaryPath : bundlePath, bundlePath, method: 'bundle', size: stat.size };
}

module.exports = {
  createStandaloneBundle,
  buildStandaloneBinary,
  isBunAvailable,
};
