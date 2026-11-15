// Standard library: std/fs
// Synchronous first, because scripting is a first-class use of PlainScript.
// For large files use node:fs/promises directly; it is fully interoperable.
import fs from 'node:fs';
import path from 'node:path';

export function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

export function appendText(file, text) {
  fs.appendFileSync(file, text, 'utf8');
}

export function exists(file) {
  return fs.existsSync(file);
}

export function remove(file) {
  fs.rmSync(file, { recursive: true, force: true });
}

export function makeDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

export function listDir(directory) {
  return fs.readdirSync(directory).sort();
}

export function stat(file) {
  const info = fs.statSync(file);
  return {
    size: info.size,
    modified: info.mtimeMs,
    isDirectory: info.isDirectory(),
  };
}

export function joinPath(...parts) {
  return path.join(...parts);
}

export function baseName(file) {
  return path.basename(file);
}

export function folderOf(file) {
  return path.dirname(file);
}

export function extensionOf(file) {
  return path.extname(file);
}
