// compiler/wasm.js
// Native WebAssembly (Wasm) Code Generator for PlainScript (RFC-0011 / Phase 10).
// Emits both WebAssembly Text Format (.wat) and valid WebAssembly binary bytecode (.wasm).
// Enables sub-millisecond edge cold starts on Cloudflare Workers, Fastly Compute, and Node.js.

const { tokenize } = require('./lexer');
const { parse } = require('./parser');

// ── LEB128 & Binary Encoding Primitives ───────────────────────────────────────

function encodeUnsignedLeb128(value) {
  const bytes = [];
  let val = Math.floor(value);
  do {
    let byte = val & 0x7f;
    val >>>= 7;
    if (val !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (val !== 0);
  return bytes;
}

function encodeSignedLeb128(value) {
  const bytes = [];
  let val = Math.floor(value);
  let more = true;
  while (more) {
    let byte = val & 0x7f;
    val >>= 7; // arithmetic shift
    const signBit = (byte & 0x40) !== 0;
    if ((val === 0 && !signBit) || (val === -1 && signBit)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return bytes;
}

function encodeVector(items) {
  return [...encodeUnsignedLeb128(items.length), ...items.flat()];
}

function encodeSection(sectionId, payloadBytes) {
  return [sectionId, ...encodeUnsignedLeb128(payloadBytes.length), ...payloadBytes];
}

function encodeString(str) {
  const utf8 = Buffer.from(str, 'utf8');
  return [...encodeUnsignedLeb128(utf8.length), ...utf8];
}

// ── Wasm Binary Opcodes ───────────────────────────────────────────────────────

const OP = {
  unreachable: 0x00,
  nop:         0x01,
  block:       0x02,
  loop:        0x03,
  if:          0x04,
  else:        0x05,
  end:         0x0b,
  br:          0x0c,
  br_if:       0x0d,
  return:      0x0f,
  call:        0x10,
  drop:        0x1a,
  local_get:   0x20,
  local_set:   0x21,
  local_tee:   0x22,
  i32_const:   0x41,
  i32_eqz:     0x45,
  i32_eq:      0x46,
  i32_ne:      0x47,
  i32_lt_s:    0x48,
  i32_gt_s:    0x4a,
  i32_le_s:    0x4c,
  i32_ge_s:    0x4e,
  i32_add:     0x6a,
  i32_sub:     0x6b,
  i32_mul:     0x6c,
  i32_div_s:   0x6d,
  i32_rem_s:   0x6f,
  i32_and:     0x71,
  i32_or:      0x72,
  i32_xor:     0x73,
};

const VALTYPE = {
  i32: 0x7f,
  i64: 0x7e,
  f32: 0x7d,
  f64: 0x7c,
  void: 0x40,
};

// ── AST to WAT Emitter ────────────────────────────────────────────────────────

class WatEmitter {
  constructor() {
    this.indent = 0;
  }

  emit(ast) {
    let out = '(module\n';
    this.indent += 2;

    const funcs = [];
    for (const node of ast.body) {
      if (node.type === 'FunctionDeclaration') {
        funcs.push(this.emitFunction(node));
      }
    }

    out += funcs.join('\n\n');
    out += '\n)\n';
    return out;
  }

  emitFunction(node) {
    const sp = ' '.repeat(this.indent);
    const name = node.name;
    const params = node.params.map(p => `(param $${p.name || p} i32)`).join(' ');
    const header = `${sp}(func $${name} (export "${name}") ${params} (result i32)`;
    
    // Collect locals
    const locals = new Set();
    this.collectLocals(node.body, locals);
    for (const p of node.params) locals.delete(p.name || p);

    const localDecls = Array.from(locals).map(l => `${sp}  (local $${l} i32)`).join('\n');
    const body = this.emitBlock(node.body, this.indent + 2);

    return [header, localDecls, body, `${sp})`].filter(Boolean).join('\n');
  }

  collectLocals(stmts, set) {
    for (const s of stmts) {
      if (s.type === 'VariableDeclaration' || s.type === 'RememberStatement') {
        set.add(s.name);
      } else if (s.type === 'IfStatement') {
        if (s.consequent) this.collectLocals(s.consequent, set);
        if (s.alternate) this.collectLocals(s.alternate, set);
      } else if (s.type === 'WhileStatement' || s.type === 'RepeatStatement' || s.type === 'RepeatTimesStatement') {
        set.add('__iter');
        if (s.body) this.collectLocals(s.body, set);
      }
    }
  }

  emitBlock(stmts, indent) {
    const sp = ' '.repeat(indent);
    const lines = [];
    for (const s of stmts) {
      lines.push(this.emitStatement(s, indent));
    }
    return lines.filter(Boolean).join('\n');
  }

  emitStatement(node, indent) {
    const sp = ' '.repeat(indent);
    if (!node) return '';

    switch (node.type) {
      case 'ReturnStatement':
      case 'GiveStatement': {
        if (node.argument || node.value) {
          return `${sp}${this.emitExpr(node.argument || node.value)}`;
        }
        return `${sp}(i32.const 0)`;
      }

      case 'VariableDeclaration':
      case 'RememberStatement': {
        const val = node.value || node.init;
        const valExpr = val ? this.emitExpr(val) : '(i32.const 0)';
        return `${sp}(local.set $${node.name} ${valExpr})`;
      }

      case 'BecomeStatement':
      case 'AssignmentStatement': {
        const name = node.target ? (node.target.name || node.target) : node.name;
        const valExpr = this.emitExpr(node.value);
        return `${sp}(local.set $${name} ${valExpr})`;
      }

      case 'IfStatement': {
        const cond = this.emitExpr(node.test || node.condition);
        const thenBranch = this.emitBlock(node.consequent || node.body || [], indent + 2);
        let out = `${sp}(if (result i32) ${cond}\n${sp}  (then\n${thenBranch}\n${sp}  )`;
        if (node.alternate && node.alternate.length > 0) {
          const elseBranch = this.emitBlock(node.alternate, indent + 2);
          out += `\n${sp}  (else\n${elseBranch}\n${sp}  )`;
        } else {
          out += `\n${sp}  (else (i32.const 0))`;
        }
        out += `\n${sp})`;
        return out;
      }

      case 'RepeatTimesStatement':
      case 'RepeatStatement': {
        // repeat N times
        const countExpr = this.emitExpr(node.count);
        return [
          `${sp}(local.set $__iter (i32.const 0))`,
          `${sp}(block $break`,
          `${sp}  (loop $loop`,
          `${sp}    (br_if $break (i32.ge_s (local.get $__iter) ${countExpr}))`,
          this.emitBlock(node.body, indent + 4),
          `${sp}    (local.set $__iter (i32.add (local.get $__iter) (i32.const 1)))`,
          `${sp}    (br $loop)`,
          `${sp}  )`,
          `${sp})`,
        ].join('\n');
      }

      case 'WhileStatement': {
        const cond = this.emitExpr(node.condition);
        return [
          `${sp}(block $break`,
          `${sp}  (loop $loop`,
          `${sp}    (br_if $break (i32.eqz ${cond}))`,
          this.emitBlock(node.body, indent + 4),
          `${sp}    (br $loop)`,
          `${sp}  )`,
          `${sp})`,
        ].join('\n');
      }

      default:
        return '';
    }
  }

  emitExpr(node) {
    if (!node) return '(i32.const 0)';
    if (typeof node === 'number') return `(i32.const ${Math.floor(node)})`;

    switch (node.type) {
      case 'Literal':
      case 'NumberLiteral':
      case 'NumericLiteral':
        return `(i32.const ${Math.floor(Number(node.value) || 0)})`;

      case 'BooleanLiteral':
        return `(i32.const ${node.value ? 1 : 0})`;

      case 'Identifier':
        return `(local.get $${node.name})`;

      case 'BinaryCondition':
      case 'BinaryExpression': {
        const left = this.emitExpr(node.left);
        const right = this.emitExpr(node.right);
        const op = node.op || node.operator;
        switch (op) {
          case '+': return `(i32.add ${left} ${right})`;
          case '-': return `(i32.sub ${left} ${right})`;
          case '*': return `(i32.mul ${left} ${right})`;
          case '/': return `(i32.div_s ${left} ${right})`;
          case '%': return `(i32.rem_s ${left} ${right})`;
          case '===':
          case '==':
          case 'is':
          case 'is equal to': return `(i32.eq ${left} ${right})`;
          case '!==':
          case '!=':
          case 'is not':
          case 'is not equal to': return `(i32.ne ${left} ${right})`;
          case '<':
          case 'is less than': return `(i32.lt_s ${left} ${right})`;
          case '<=':
          case 'is at most':
          case 'is less than or equal to': return `(i32.le_s ${left} ${right})`;
          case '>':
          case 'is greater than':
          case 'is more than':
          case 'is above': return `(i32.gt_s ${left} ${right})`;
          case '>=':
          case 'is at least':
          case 'is greater than or equal to': return `(i32.ge_s ${left} ${right})`;
          case 'and': return `(i32.and ${left} ${right})`;
          case 'or': return `(i32.or ${left} ${right})`;
          default: return `(i32.add ${left} ${right})`;
        }
      }

      case 'CallExpression': {
        const callee = node.name || (node.callee && node.callee.name) || node.callee;
        const args = (node.args || node.arguments || []).map(a => this.emitExpr(a)).join(' ');
        return `(call $${callee} ${args})`;
      }

      default:
        return '(i32.const 0)';
    }
  }
}

// ── Binary WebAssembly Module Compiler ────────────────────────────────────────

class WasmCompiler {
  constructor() {
    this.types = [];        // list of { params: [], results: [] }
    this.funcs = [];        // list of typeIndex
    this.exports = [];      // list of { name, kind: 0, index }
    this.codes = [];        // list of { locals: [], bytes: [] }
    this.funcIndexMap = new Map();
  }

  compile(ast) {
    const funcs = ast.body.filter(n => n.type === 'FunctionDeclaration');

    // 1. Register function types and assign indices
    for (let i = 0; i < funcs.length; i++) {
      const fn = funcs[i];
      const paramTypes = fn.params.map(() => VALTYPE.i32);
      const resultTypes = [VALTYPE.i32];

      const typeIndex = this.registerType(paramTypes, resultTypes);
      this.funcs.push(typeIndex);
      this.funcIndexMap.set(fn.name, i);
      this.exports.push({ name: fn.name, kind: 0, index: i });
    }

    // 2. Compile bodies
    for (const fn of funcs) {
      this.compileFunction(fn);
    }

    return this.emitBinary();
  }

  registerType(params, results) {
    this.types.push({ params, results });
    return this.types.length - 1;
  }

  compileFunction(fn) {
    const localIndexMap = new Map();
    let nextLocal = 0;

    for (const p of fn.params) {
      localIndexMap.set(p.name || p, nextLocal++);
    }

    // Discover variables
    const extraLocals = [];
    const walk = (stmts) => {
      for (const s of stmts) {
        if (s.type === 'VariableDeclaration' || s.type === 'RememberStatement') {
          if (!localIndexMap.has(s.name)) {
            localIndexMap.set(s.name, nextLocal++);
            extraLocals.push(VALTYPE.i32);
          }
        } else if (s.type === 'IfStatement') {
          if (s.consequent) walk(s.consequent);
          if (s.alternate) walk(s.alternate);
        } else if (s.type === 'WhileStatement' || s.type === 'RepeatStatement' || s.type === 'RepeatTimesStatement') {
          if (!localIndexMap.has('__iter')) {
            localIndexMap.set('__iter', nextLocal++);
            extraLocals.push(VALTYPE.i32);
          }
          if (s.body) walk(s.body);
        }
      }
    };
    walk(fn.body);

    const bytes = [];
    for (const stmt of fn.body) {
      this.compileStatement(stmt, bytes, localIndexMap);
    }

    // Ensure function ends with return value of type i32
    bytes.push(OP.i32_const, ...encodeSignedLeb128(0));
    bytes.push(OP.end);

    // Group extra locals
    const localsEntries = extraLocals.length > 0 ? [[extraLocals.length, VALTYPE.i32]] : [];
    this.codes.push({ locals: localsEntries, bytes });
  }

  compileStatement(node, bytes, localMap) {
    if (!node) return;

    switch (node.type) {
      case 'ReturnStatement':
      case 'GiveStatement': {
        const val = node.argument || node.value;
        if (val) {
          this.compileExpr(val, bytes, localMap);
        } else {
          bytes.push(OP.i32_const, ...encodeSignedLeb128(0));
        }
        bytes.push(OP.return);
        break;
      }

      case 'VariableDeclaration':
      case 'RememberStatement': {
        const idx = localMap.get(node.name);
        const val = node.value || node.init;
        if (val) {
          this.compileExpr(val, bytes, localMap);
        } else {
          bytes.push(OP.i32_const, ...encodeSignedLeb128(0));
        }
        bytes.push(OP.local_set, ...encodeUnsignedLeb128(idx));
        break;
      }

      case 'BecomeStatement':
      case 'AssignmentStatement': {
        const name = node.target ? (node.target.name || node.target) : node.name;
        const idx = localMap.get(name);
        this.compileExpr(node.value, bytes, localMap);
        if (idx !== undefined) {
          bytes.push(OP.local_set, ...encodeUnsignedLeb128(idx));
        }
        break;
      }

      case 'IfStatement': {
        this.compileExpr(node.test || node.condition, bytes, localMap);
        bytes.push(OP.if, VALTYPE.void);
        for (const s of (node.consequent || node.body || [])) {
          this.compileStatement(s, bytes, localMap);
        }
        if (node.alternate && node.alternate.length > 0) {
          bytes.push(OP.else);
          for (const s of node.alternate) {
            this.compileStatement(s, bytes, localMap);
          }
        }
        bytes.push(OP.end);
        break;
      }

      case 'RepeatTimesStatement':
      case 'RepeatStatement': {
        const iterIdx = localMap.get('__iter');
        // __iter = 0
        bytes.push(OP.i32_const, ...encodeSignedLeb128(0));
        bytes.push(OP.local_set, ...encodeUnsignedLeb128(iterIdx));

        // block $break (0x02), loop $loop (0x03)
        bytes.push(OP.block, VALTYPE.void);
        bytes.push(OP.loop, VALTYPE.void);

        // condition: __iter >= count -> break
        bytes.push(OP.local_get, ...encodeUnsignedLeb128(iterIdx));
        this.compileExpr(node.count, bytes, localMap);
        bytes.push(OP.i32_ge_s);
        bytes.push(OP.br_if, ...encodeUnsignedLeb128(1)); // break out of block

        // body
        for (const s of node.body) {
          this.compileStatement(s, bytes, localMap);
        }

        // __iter++
        bytes.push(OP.local_get, ...encodeUnsignedLeb128(iterIdx));
        bytes.push(OP.i32_const, ...encodeSignedLeb128(1));
        bytes.push(OP.i32_add);
        bytes.push(OP.local_set, ...encodeUnsignedLeb128(iterIdx));

        // repeat loop
        bytes.push(OP.br, ...encodeUnsignedLeb128(0));

        bytes.push(OP.end); // end loop
        bytes.push(OP.end); // end block
        break;
      }

      case 'WhileStatement': {
        bytes.push(OP.block, VALTYPE.void);
        bytes.push(OP.loop, VALTYPE.void);

        this.compileExpr(node.condition, bytes, localMap);
        bytes.push(OP.i32_eqz);
        bytes.push(OP.br_if, ...encodeUnsignedLeb128(1)); // break

        for (const s of node.body) {
          this.compileStatement(s, bytes, localMap);
        }

        bytes.push(OP.br, ...encodeUnsignedLeb128(0));
        bytes.push(OP.end);
        bytes.push(OP.end);
        break;
      }

      case 'BreakStatement': {
        bytes.push(OP.br, ...encodeUnsignedLeb128(1));
        break;
      }

      default:
        break;
    }
  }

  compileExpr(node, bytes, localMap) {
    if (!node) {
      bytes.push(OP.i32_const, ...encodeSignedLeb128(0));
      return;
    }

    if (typeof node === 'number') {
      bytes.push(OP.i32_const, ...encodeSignedLeb128(node));
      return;
    }

    switch (node.type) {
      case 'Literal':
      case 'NumberLiteral':
      case 'NumericLiteral': {
        const val = Math.floor(Number(node.value) || 0);
        bytes.push(OP.i32_const, ...encodeSignedLeb128(val));
        break;
      }

      case 'BooleanLiteral': {
        bytes.push(OP.i32_const, ...encodeSignedLeb128(node.value ? 1 : 0));
        break;
      }

      case 'Identifier': {
        const idx = localMap.get(node.name);
        if (idx !== undefined) {
          bytes.push(OP.local_get, ...encodeUnsignedLeb128(idx));
        } else {
          bytes.push(OP.i32_const, ...encodeSignedLeb128(0));
        }
        break;
      }

      case 'BinaryCondition':
      case 'BinaryExpression': {
        this.compileExpr(node.left, bytes, localMap);
        this.compileExpr(node.right, bytes, localMap);
        const op = node.op || node.operator;
        switch (op) {
          case '+': bytes.push(OP.i32_add); break;
          case '-': bytes.push(OP.i32_sub); break;
          case '*': bytes.push(OP.i32_mul); break;
          case '/': bytes.push(OP.i32_div_s); break;
          case '%': bytes.push(OP.i32_rem_s); break;
          case '===':
          case '==':
          case 'is':
          case 'is equal to': bytes.push(OP.i32_eq); break;
          case '!==':
          case '!=':
          case 'is not':
          case 'is not equal to': bytes.push(OP.i32_ne); break;
          case '<':
          case 'is less than': bytes.push(OP.i32_lt_s); break;
          case '<=':
          case 'is at most':
          case 'is less than or equal to': bytes.push(OP.i32_le_s); break;
          case '>':
          case 'is greater than':
          case 'is more than':
          case 'is above': bytes.push(OP.i32_gt_s); break;
          case '>=':
          case 'is at least':
          case 'is greater than or equal to': bytes.push(OP.i32_ge_s); break;
          case 'and': bytes.push(OP.i32_and); break;
          case 'or': bytes.push(OP.i32_or); break;
          default: bytes.push(OP.i32_add); break;
        }
        break;
      }

      case 'CallExpression': {
        const callee = node.name || (node.callee && node.callee.name) || node.callee;
        const args = node.args || node.arguments || [];
        for (const arg of args) {
          this.compileExpr(arg, bytes, localMap);
        }
        const funcIdx = this.funcIndexMap.get(callee);
        if (funcIdx !== undefined) {
          bytes.push(OP.call, ...encodeUnsignedLeb128(funcIdx));
        } else {
          bytes.push(OP.i32_const, ...encodeSignedLeb128(0));
        }
        break;
      }

      default:
        bytes.push(OP.i32_const, ...encodeSignedLeb128(0));
        break;
    }
  }

  emitBinary() {
    // WebAssembly Header (\0asm v1)
    const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

    // Section 1: Type Section (0x01)
    const typeEntries = this.types.map(t => [
      0x60, // func type
      ...encodeVector(t.params),
      ...encodeVector(t.results),
    ]);
    const secType = encodeSection(1, encodeVector(typeEntries));

    // Section 3: Function Section (0x03)
    const secFunc = encodeSection(3, encodeVector(this.funcs.map(idx => encodeUnsignedLeb128(idx))));

    // Section 7: Export Section (0x07)
    const exportEntries = this.exports.map(e => [
      ...encodeString(e.name),
      e.kind, // 0 = func
      ...encodeUnsignedLeb128(e.index),
    ]);
    const secExport = encodeSection(7, encodeVector(exportEntries));

    // Section 10: Code Section (0x0a)
    const codeEntries = this.codes.map(c => {
      const localsEncoded = encodeVector(c.locals.map(([count, type]) => [
        ...encodeUnsignedLeb128(count),
        type,
      ]));
      const body = [...localsEncoded, ...c.bytes];
      return [...encodeUnsignedLeb128(body.length), ...body];
    });
    const secCode = encodeSection(10, encodeVector(codeEntries));

    const binary = Buffer.from([
      ...header,
      ...secType,
      ...secFunc,
      ...secExport,
      ...secCode,
    ]);

    return binary;
  }
}

/**
 * Compiles PlainScript source or AST into WebAssembly text (.wat) and binary (.wasm).
 * @param {string|Object} sourceOrAst - PlainScript source string or AST object
 * @returns {Object} { wat: string, wasm: Buffer, exports: string[], instantiate: Function }
 */
function compileToWasm(sourceOrAst) {
  let ast;
  if (typeof sourceOrAst === 'string') {
    const tokens = tokenize(sourceOrAst);
    ast = parse(tokens);
  } else {
    ast = sourceOrAst;
  }

  const emitter = new WatEmitter();
  const wat = emitter.emit(ast);

  const compiler = new WasmCompiler();
  const wasm = compiler.compile(ast);
  const exportNames = compiler.exports.map(e => e.name);

  return {
    wat,
    wasm,
    exports: exportNames,
    async instantiate(importObject = {}) {
      const module = await WebAssembly.compile(wasm);
      const instance = await WebAssembly.instantiate(module, importObject);
      return instance.exports;
    },
    instantiateSync(importObject = {}) {
      const module = new WebAssembly.Module(wasm);
      const instance = new WebAssembly.Instance(module, importObject);
      return instance.exports;
    },
  };
}

module.exports = {
  compileToWasm,
  WatEmitter,
  WasmCompiler,
};
