// compiler/packager.js
// Native PLN Module Packaging System.
// Creates and manages pure PlainScript packages (.plz) with automated type emission and SHA-256 verification.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { tokenize } = require('./lexer');
const { parse } = require('./parser');
const { generateTypeDeclarations } = require('./passes/types');

const MANIFEST_NAME = 'pln.json';
const PACKAGE_MAGIC = 'PLNPKG1\n'; // PlainScript Package Header v1

/**
 * Calculates SHA-256 hex digest of a string or Buffer.
 */
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Initializes a new pure PlainScript library project.
 * @param {string} targetDir - Destination directory
 * @param {string} libName - Library name
 * @returns {Object} Created manifest
 */
function initLibrary(targetDir = '.', libName = null) {
  const dir = path.resolve(targetDir);
  const name = libName || path.basename(dir) || 'my-pln-lib';

  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });

  const manifest = {
    name,
    version: '1.0.0',
    description: `A reusable PlainScript library`,
    main: 'src/index.pln',
    author: '',
    license: 'MIT',
    dependencies: {},
  };

  fs.writeFileSync(
    path.join(dir, MANIFEST_NAME),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );

  const entryContent = [
    `// ${name} entry point`,
    ``,
    `make greet(name)`,
    `  let greeting is \`Hello \${name} from \${name}!\``,
    `  give greeting`,
    `done`,
    ``,
    `export greet`,
    ``,
  ].join('\n');

  fs.writeFileSync(path.join(dir, 'src', 'index.pln'), entryContent, 'utf8');

  const testContent = [
    `bring greet from "../src/index.pln"`,
    ``,
    `test "greet outputs friendly message"`,
    `  check greet("PlainScript") contains "Hello PlainScript"`,
    `done`,
    ``,
  ].join('\n');

  fs.writeFileSync(path.join(dir, 'tests', 'index.test.pln'), testContent, 'utf8');

  const readmeContent = [
    `# ${name}`,
    ``,
    `A pure PlainScript library.`,
    ``,
    `## Usage`,
    ``,
    `\`\`\`plainscript`,
    `bring greet from "${name}"`,
    `show greet("World")`,
    `\`\`\``,
    ``,
    `## Development`,
    ``,
    `\`\`\`bash`,
    `plainscript check`,
    `plainscript pack`,
    `\`\`\``,
    ``,
  ].join('\n');

  fs.writeFileSync(path.join(dir, 'README.md'), readmeContent, 'utf8');

  return manifest;
}

/**
 * Finds all .pln source files under the project directory.
 */
function discoverSourceFiles(dir) {
  const sources = [];
  const root = path.resolve(dir);

  function walk(curr) {
    for (const item of fs.readdirSync(curr).sort()) {
      if (item.startsWith('.') || item === 'node_modules' || item === 'dist' || item === 'tests' || item === 'test') continue;
      const full = path.join(curr, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (item.endsWith('.pln')) {
        sources.push(path.relative(root, full).replace(/\\/g, '/'));
      }
    }
  }

  walk(root);
  return sources;
}

/**
 * Packages a PlainScript project into a .plz distribution bundle.
 * 
 * @param {string} projectDir - Root folder containing pln.json or package.json
 * @param {Object} options - { outDir, verbose }
 * @returns {Object} { packageFile, manifest, fileCount, size, sha256 }
 */
function packPackage(projectDir = '.', options = {}) {
  const root = path.resolve(projectDir);
  const manifestPath = path.join(root, MANIFEST_NAME);
  const pkgJsonPath = path.join(root, 'package.json');

  let manifest;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      throw new Error(`Invalid ${MANIFEST_NAME}: ${e.message}`);
    }
  } else if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    manifest = {
      name: pkg.name || 'unnamed-lib',
      version: pkg.version || '1.0.0',
      description: pkg.description || '',
      main: pkg.main || 'src/index.pln',
      author: pkg.author || '',
      license: pkg.license || 'MIT',
      dependencies: pkg.dependencies || {},
    };
  } else {
    manifest = {
      name: path.basename(root),
      version: '1.0.0',
      description: '',
      main: 'src/index.pln',
    };
  }

  // Discover all .pln sources
  const plnFiles = discoverSourceFiles(root);
  if (plnFiles.length === 0) {
    throw new Error(`No .pln source files found under "${root}".`);
  }

  const files = {};
  const checksums = {};

  // Store manifest
  files[MANIFEST_NAME] = JSON.stringify(manifest, null, 2);
  checksums[MANIFEST_NAME] = sha256(files[MANIFEST_NAME]);

  // Store README if present
  const readmePath = path.join(root, 'README.md');
  if (fs.existsSync(readmePath)) {
    files['README.md'] = fs.readFileSync(readmePath, 'utf8');
    checksums['README.md'] = sha256(files['README.md']);
  }

  // Validate sources and generate .d.ts files
  for (const relPath of plnFiles) {
    const fullPath = path.join(root, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    files[relPath] = content;
    checksums[relPath] = sha256(content);

    // Generate matching .d.ts type declaration
    try {
      const ast = parse(tokenize(content));
      const dts = generateTypeDeclarations(ast);
      const dtsRel = relPath.replace(/\.pln$/, '.d.ts');
      files[dtsRel] = dts;
      checksums[dtsRel] = sha256(dts);
    } catch (_) {
      // If parsing fails for a partial file, skip .d.ts
    }
  }

  // Store checksums manifest
  files['checksums.json'] = JSON.stringify(checksums, null, 2);

  // Serialize and compress
  const payload = JSON.stringify({
    header: {
      format: 'plainscript-package',
      version: '1.0.0',
      created: new Date().toISOString(),
      name: manifest.name,
      pkgVersion: manifest.version,
    },
    manifest,
    files,
  });

  const compressed = zlib.gzipSync(Buffer.from(PACKAGE_MAGIC + payload, 'utf8'), { level: 9 });
  const packageSha = sha256(compressed);

  const outDir = path.resolve(options.outDir || root);
  fs.mkdirSync(outDir, { recursive: true });
  const outFileName = `${manifest.name}-${manifest.version}.plz`;
  const outFilePath = path.join(outDir, outFileName);

  fs.writeFileSync(outFilePath, compressed);

  return {
    packageFile: outFilePath,
    packageName: outFileName,
    manifest,
    fileCount: Object.keys(files).length,
    size: compressed.length,
    sha256: packageSha,
  };
}

/**
 * Inspects a .plz package without extracting it.
 * @param {string} archivePath - Path to .plz file
 * @returns {Object} Package inspection report
 */
function inspectPackage(archivePath) {
  const fullPath = path.resolve(archivePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Package file not found: ${archivePath}`);
  }

  const raw = fs.readFileSync(fullPath);
  const decompressed = zlib.gunzipSync(raw).toString('utf8');

  if (!decompressed.startsWith(PACKAGE_MAGIC)) {
    throw new Error(`Invalid PlainScript package header in ${archivePath}`);
  }

  const jsonStr = decompressed.slice(PACKAGE_MAGIC.length);
  const data = JSON.parse(jsonStr);

  return {
    header: data.header,
    manifest: data.manifest,
    files: Object.keys(data.files),
    size: raw.length,
    sha256: sha256(raw),
  };
}

/**
 * Unpacks a .plz package into the target directory with integrity verification.
 * @param {string} archivePath - Path to .plz package
 * @param {string} destDir - Destination directory
 * @returns {Object} Unpacked summary
 */
function unpackPackage(archivePath, destDir = '.') {
  const fullPath = path.resolve(archivePath);
  const outDir = path.resolve(destDir);

  const raw = fs.readFileSync(fullPath);
  const decompressed = zlib.gunzipSync(raw).toString('utf8');

  if (!decompressed.startsWith(PACKAGE_MAGIC)) {
    throw new Error(`Invalid PlainScript package header in ${archivePath}`);
  }

  const data = JSON.parse(decompressed.slice(PACKAGE_MAGIC.length));
  const checksums = JSON.parse(data.files['checksums.json'] || '{}');

  fs.mkdirSync(outDir, { recursive: true });

  const written = [];
  for (const [relPath, content] of Object.entries(data.files)) {
    if (relPath === 'checksums.json') continue;

    // Verify SHA-256
    const expected = checksums[relPath];
    const actual = sha256(content);
    if (expected && expected !== actual) {
      throw new Error(`Checksum mismatch for file "${relPath}". Archive may be corrupted.`);
    }

    const filePath = path.join(outDir, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    written.push(relPath);
  }

  return {
    manifest: data.manifest,
    extractedFiles: written,
    targetDir: outDir,
  };
}

module.exports = {
  MANIFEST_NAME,
  initLibrary,
  packPackage,
  inspectPackage,
  unpackPackage,
  sha256,
};
