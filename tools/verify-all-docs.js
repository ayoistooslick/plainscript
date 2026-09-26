// Compile every fenced PlainScript block in every Markdown/README file.
// Documentation must use syntax accepted by the checked-in compiler.
const fs = require('fs');
const path = require('path');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate } = require('../compiler/generator');

const root = path.join(__dirname, '..');
const ignored = new Set(['.git', 'node_modules']);
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && (/^README(?:\.[^.]+)?$/i.test(entry.name) || /\.md$/i.test(entry.name))) files.push(full);
  }
}
walk(root);
files.sort();
let checked = 0;
const failures = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const fences = /```([^\n`]*)\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = fences.exec(source))) {
    if (!['plainscript', 'pln'].includes(match[1].trim().toLowerCase())) continue;
    checked++;
    try {
      generate(parse(tokenize(match[2])));
    } catch (error) {
      const line = source.slice(0, match.index).split('\n').length;
      failures.push(`${path.relative(root, file)}:${line}: ${error.message.split('\n')[0]}`);
    }
  }
}
console.log(`Checked ${checked} fenced PlainScript blocks in ${files.length} Markdown/README files.`);
if (failures.length) {
  console.error(`\n${failures.length} documentation block(s) failed to compile:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('All fenced PlainScript blocks compile.');
