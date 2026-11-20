'use strict';

// Minimal Debug Adapter Protocol implementation for PlainScript.
//
// The adapter speaks DAP on stdio and uses the Chrome DevTools Protocol exposed
// by `node --inspect-brk`. Source maps are decoded in both directions, so a
// breakpoint requested on a .pln line is set on the generated JavaScript line,
// and paused JavaScript frames are reported back as .pln locations.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { attachDecoded, generatedPositionFor, originalPositionFor } = require('./sourcemap');

function readFrames(stream, onMessage) {
  let buffer = Buffer.alloc(0);
  stream.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = buffer.slice(0, headerEnd).toString('ascii');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + length) return;
      const payload = buffer.slice(start, start + length).toString('utf8');
      buffer = buffer.slice(start + length);
      try { onMessage(JSON.parse(payload)); } catch (failure) {
        onMessage({ type: 'invalid', error: failure.message });
      }
    }
  });
}

function writeFrame(stream, message) {
  const body = JSON.stringify(message);
  stream.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

class PlainScriptDebugSession {
  constructor(input, output, options = {}) {
    this.input = input;
    this.output = output;
    this.options = options;
    this.sequence = 0;
    this.pending = new Map();
    this.breakpoints = new Map();
    this.breakpointsBySource = new Map();
    this.callFrames = [];
    this.framesById = new Map();
    this.variableReferences = new Map();
    this.nextVariableReference = 1;
    this.scripts = new Map();
    this.maps = [];
    this.child = null;
    this.socket = null;
    this.cdpId = 0;
    this.cdpPending = new Map();
    this.initialized = false;
    this.configurationDone = false;
    this.stopOnEntry = Boolean(options.stopOnEntry);
    this.autoResumedEntry = false;
    this.launchPromise = null;
    this.terminated = false;
    this.sourceMaps = options.sourceMaps || null;
  }

  send(message) {
    this.sequence += 1;
    writeFrame(this.output, { seq: this.sequence, ...message });
  }

  event(event, body = {}) {
    this.send({ type: 'event', event, body });
  }

  response(request, body = {}, success = true, message = null) {
    this.send({ type: 'response', request_seq: request.seq, command: request.command, success, ...(message ? { message } : {}), body });
  }

  outputEvent(text, category = 'console') {
    this.event('output', { category, output: text });
  }

  start() {
    readFrames(this.input, (message) => this.dispatch(message));
  }

  async dispatch(message) {
    if (message.type !== 'request') return;
    try {
      const handler = this[`request_${message.command}`];
      if (!handler) {
        this.response(message, {}, false, `Unsupported request ${message.command}`);
        return;
      }
      await handler.call(this, message);
    } catch (failure) {
      this.outputEvent(`${failure && failure.stack ? failure.stack : failure}\n`, 'stderr');
      this.response(message, {}, false, String(failure && failure.message ? failure.message : failure));
    }
  }

  request_initialize(request) {
    this.response(request, {
      supportsConfigurationDoneRequest: true,
      supportsFunctionBreakpoints: false,
      supportsConditionalBreakpoints: false,
      supportsEvaluateForHovers: true,
      supportsTerminateRequest: true,
      supportsRestartRequest: false,
      exceptionBreakpointFilters: [{ filter: 'all', label: 'All Exceptions' }],
    });
  }

  request_launch(request) {
    const args = request.arguments || {};
    if (!args.program) {
      this.response(request, {}, false, 'launch.program is required');
      return;
    }
    this.stopOnEntry = Boolean(args.stopOnEntry);
    this.response(request);
    this.launch(args);
  }

  request_attach(request) {
    const args = request.arguments || {};
    this.response(request);
    if (args.program || args.sourceMaps) this.loadMaps(args.program || '', args.sourceMaps);
    this.connectInspector(args.inspectorUrl || args.url);
  }

  async launch(args) {
    try {
      const cwd = args.cwd || process.cwd();
      const program = path.resolve(cwd, args.program);
      const runtimeArgs = args.runtimeArgs || [];
      const childArgs = [...runtimeArgs, '--inspect-brk=127.0.0.1:0', program, ...(args.args || [])];
      this.outputEvent(`Launching ${process.execPath} ${childArgs.join(' ')}\n`, 'console');
      this.child = spawn(process.execPath, childArgs, {
        cwd,
        env: { ...process.env, ...(args.env || {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child.stdout.on('data', (chunk) => this.outputEvent(chunk.toString(), 'stdout'));
      this.child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        this.outputEvent(text, 'stderr');
        const match = /ws:\/\/[^\s]+/.exec(text);
        if (match && !this.socket) this.connectInspector(match[0].replace(/[),]+$/, ''));
      });
      this.child.on('exit', (code) => {
        if (!this.terminated) {
          this.terminated = true;
          this.event('terminated', {});
          this.event('exited', { exitCode: code === null ? 0 : code });
        }
      });
      this.loadMaps(program, args.sourceMaps);
    } catch (failure) {
      this.outputEvent(`Launch failed: ${failure.message}\n`, 'stderr');
      this.event('terminated', {});
    }
  }

  loadMaps(program, extra) {
    const mapPaths = [];
    if (program.endsWith('.js')) mapPaths.push(`${program}.map`);
    for (const entry of extra || []) mapPaths.push(path.resolve(entry));
    const seen = new Set();
    this.maps = [];
    for (const mapPath of mapPaths) {
      if (seen.has(mapPath) || !fs.existsSync(mapPath)) continue;
      seen.add(mapPath);
      try {
        const map = attachDecoded(JSON.parse(fs.readFileSync(mapPath, 'utf8')));
        this.maps.push({ map, mapPath, generatedPath: mapPath.replace(/\.map$/, ''), aliases: new Map() });
      } catch (failure) {
        this.outputEvent(`Cannot read source map ${mapPath}: ${failure.message}\n`, 'stderr');
      }
    }
    if (!this.maps.length) this.outputEvent('No source map found; breakpoints will use generated JavaScript lines.\n', 'console');
  }

  connectInspector(url) {
    if (!url) {
      this.outputEvent('No inspector WebSocket URL was provided.\n', 'stderr');
      this.event('terminated', {});
      return;
    }
    if (typeof WebSocket !== 'function') {
      this.outputEvent('This Node.js does not provide a global WebSocket client.\n', 'stderr');
      this.event('terminated', {});
      return;
    }
    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => {
      this.outputEvent('Connected to Node inspector.\n', 'console');
      this.initializeCdp().catch((failure) => {
        this.outputEvent(`Debugger initialization failed: ${failure.message}\n`, 'stderr');
        this.event('terminated', {});
      });
    });
    this.socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()); } catch { return; }
      this.onCdpMessage(message);
    });
    this.socket.addEventListener('error', (event) => {
      this.outputEvent(`Inspector socket error: ${event.message || 'connection failed'}\n`, 'stderr');
    });
    this.socket.addEventListener('close', () => {
      if (!this.child && !this.terminated) {
        this.terminated = true;
        this.event('terminated', {});
      }
    });
  }

  cdp(method, params = {}) {
    if (!this.socket || this.socket.readyState !== 1) return Promise.reject(new Error('inspector is not connected'));
    const id = ++this.cdpId;
    return new Promise((resolve, reject) => {
      this.cdpPending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async initializeCdp() {
    await this.cdp('Runtime.enable');
    await this.cdp('Debugger.enable');
    try {
      await this.cdp('NodeRuntime.enable');
      await this.cdp('NodeRuntime.notifyWhenWaitingForDisconnect', { enabled: true });
    } catch {
      // Older/other inspector hosts do not implement the Node domain. The
      // standard execution-context event below is the fallback.
    }
    this.initialized = true;
    this.event('initialized', {});
    await this.applyAllBreakpoints();
  }

  onCdpMessage(message) {
    if (message.id) {
      const pending = this.cdpPending.get(message.id);
      if (!pending) return;
      this.cdpPending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === 'Debugger.scriptParsed') {
      this.scripts.set(message.params.scriptId, message.params.url);
      return;
    }
    if (message.method === 'Debugger.paused') {
      this.callFrames = message.params.callFrames || [];
      this.framesById.clear();
      this.variableReferences.clear();
      for (const frame of this.callFrames) this.framesById.set(frame.callFrameId, frame);
      const hitBreakpoint = Array.isArray(message.params.hitBreakpoints) && message.params.hitBreakpoints.length > 0;
      const reason = hitBreakpoint ? 'breakpoint' : (message.params.reason === 'other' ? 'pause' : message.params.reason);
      // `--inspect-brk` always stops at the first statement. Unless the client
      // asked for stopOnEntry, resume that artificial entry stop so execution
      // reaches the user's breakpoint instead of looking like a spurious pause.
      if (reason === 'Break on start' && this.configurationDone && !this.stopOnEntry && !this.autoResumedEntry) {
        this.autoResumedEntry = true;
        this.cdp('Debugger.resume').catch((failure) => this.outputEvent(`Could not leave the entry stop: ${failure.message}\n`, 'stderr'));
        return;
      }
      this.event('stopped', { reason: reason === 'exception' || reason === 'promiseRejection' ? 'exception' : reason, threadId: 1, allThreadsStopped: true });
      return;
    }
    if (message.method === 'Debugger.resumed') {
      this.callFrames = [];
      this.event('continued', { threadId: 1, allThreadsContinued: true });
      return;
    }
    if (message.method === 'NodeRuntime.waitingForDisconnect' || message.method === 'Runtime.executionContextDestroyed') {
      // A debugged Node process waits for its inspector client to disconnect
      // after the main script finishes. Detach so the process can exit and DAP
      // clients receive terminated/exited instead of hanging.
      if (this.socket) {
        try { this.socket.close(); } catch { /* already closed */ }
      }
    }
  }

  sourceLocationFor(frame) {
    const generatedPath = this.scripts.get(frame.location.scriptId);
    const generatedLine = frame.location.lineNumber + 1;
    const generatedColumn = (frame.location.columnNumber || 0) + 1;
    for (const entry of this.maps) {
      if (!generatedPath || !sameFile(generatedPath, entry.generatedPath)) continue;
      const mapped = originalPositionFor(entry.map, generatedLine, generatedColumn);
      if (!mapped || !mapped.source) continue;
      const sourcePath = entry.aliases.get(mapped.source)
        || (path.isAbsolute(mapped.source) ? mapped.source : path.resolve(path.dirname(entry.mapPath), mapped.source));
      return { source: { name: path.basename(sourcePath), path: sourcePath }, line: mapped.originalLine, column: mapped.originalColumn };
    }
    return {
      source: generatedPath ? { name: path.basename(generatedPath), path: generatedPath.replace(/^file:\/\//, '') } : undefined,
      line: generatedLine,
      column: generatedColumn,
    };
  }

  async request_setBreakpoints(request) {
    const source = request.arguments.source || {};
    const sourcePath = source.path || source.name;
    const requested = request.arguments.breakpoints || [];
    this.breakpointsBySource.set(sourcePath, requested.map((breakpoint) => ({ ...breakpoint, sourcePath })));
    const results = await this.applyBreakpoints(sourcePath);
    this.response(request, { breakpoints: results });
  }

  async applyAllBreakpoints() {
    for (const sourcePath of this.breakpointsBySource.keys()) {
      const results = await this.applyBreakpoints(sourcePath);
      if (results.length) this.event('breakpoint', { reason: 'changed', breakpoint: results.find((entry) => entry.verified) || results[0] });
    }
  }

  async applyBreakpoints(sourcePath) {
    // setBreakpoints replaces the source's list. Remove previously registered
    // CDP breakpoints first, otherwise an edited or deleted line would continue
    // to stop the program.
    for (const [id, breakpoint] of this.breakpoints) {
      if (breakpoint.sourcePath !== sourcePath) continue;
      try { await this.cdp('Debugger.removeBreakpoint', { breakpointId: id }); } catch { /* inspector may be gone */ }
      this.breakpoints.delete(id);
    }
    const requests = this.breakpointsBySource.get(sourcePath) || [];
    const results = [];
    for (const breakpoint of requests) {
      const line = Number(breakpoint.line) || 1;
      let generated = null;
      let entry = null;
      for (const candidate of this.maps) {
        const mapped = generatedPositionFor(candidate.map, sourcePath, line);
        if (mapped) { generated = mapped; entry = candidate; break; }
      }
      if (!generated || !entry) {
        results.push({ id: breakpoint.id, verified: false, line, message: 'No source-map location for this PlainScript line.' });
        continue;
      }
      entry.aliases.set(generated.source, sourcePath);
      const url = pathToFileURL(entry.generatedPath).href;
      try {
        const cdpResult = await this.cdp('Debugger.setBreakpointByUrl', {
          lineNumber: generated.generatedLine - 1,
          url,
          columnNumber: Math.max(0, generated.generatedColumn - 1),
        });
        const id = cdpResult.breakpointId;
        this.breakpoints.set(id, { sourcePath, line, generated, map: entry });
        results.push({ id: breakpoint.id, verified: true, line, source: { name: path.basename(sourcePath), path: sourcePath } });
      } catch (failure) {
        results.push({ id: breakpoint.id, verified: false, line, message: failure.message });
      }
    }
    return results;
  }

  async request_configurationDone(request) {
    this.configurationDone = true;
    try {
      if (this.child) await this.cdp('Runtime.runIfWaitingForDebugger');
      await this.cdp('Debugger.resume');
    } catch (failure) {
      // A program that has already finished can reject resume; the exit event
      // still reports the real outcome.
      this.outputEvent(`Configuration failed: ${failure.message}\n`, 'stderr');
    }
    this.response(request);
  }

  request_threads(request) {
    this.response(request, { threads: [{ id: 1, name: 'PlainScript main thread' }] });
  }

  request_stackTrace(request) {
    const frames = this.callFrames.map((frame, index) => {
      const location = this.sourceLocationFor(frame);
      return {
        id: frame.callFrameId,
        name: frame.functionName || '<anonymous>',
        line: location.line,
        column: location.column,
        source: location.source,
        ...(index === 0 ? { presentationHint: 'normal' } : {}),
      };
    });
    this.response(request, { stackFrames: frames, totalFrames: frames.length });
  }

  request_scopes(request) {
    const frame = this.framesById.get(request.arguments.frameId);
    if (!frame) {
      this.response(request, { scopes: [] });
      return;
    }
    const scopes = [];
    for (const scope of frame.scopeChain || []) {
      if (!scope.object || !scope.object.objectId) continue;
      const reference = this.nextVariableReference++;
      this.variableReferences.set(reference, { objectId: scope.object.objectId, frameId: frame.callFrameId });
      scopes.push({
        name: scope.type === 'local' ? 'Locals' : `${scope.type[0].toUpperCase()}${scope.type.slice(1)}`,
        variablesReference: reference,
        expensive: false,
      });
    }
    this.response(request, { scopes });
  }

  async request_variables(request) {
    const reference = this.variableReferences.get(request.arguments.variablesReference);
    if (!reference) {
      this.response(request, { variables: [] });
      return;
    }
    const result = await this.cdp('Runtime.getProperties', { objectId: reference.objectId, ownProperties: true });
    const variables = [];
    for (const property of result.result || []) {
      if (property.name === '__proto__' || property.symbol) continue;
      const value = property.value || {};
      const isObject = value.type === 'object' && value.objectId;
      let variablesReference = 0;
      if (isObject) {
        variablesReference = this.nextVariableReference++;
        this.variableReferences.set(variablesReference, { objectId: value.objectId, frameId: reference.frameId });
      }
      variables.push({
        name: property.name,
        value: value.description !== undefined ? String(value.description) : (value.value !== undefined ? String(value.value) : 'undefined'),
        type: value.type || 'undefined',
        variablesReference,
      });
    }
    this.response(request, { variables });
  }

  async request_evaluate(request) {
    const frame = request.arguments.frameId ? this.framesById.get(request.arguments.frameId) : null;
    const result = frame
      ? await this.cdp('Debugger.evaluateOnCallFrame', {
        callFrameId: frame.callFrameId,
        expression: request.arguments.expression,
        returnByValue: true,
      })
      : await this.cdp('Runtime.evaluate', {
        expression: request.arguments.expression,
        returnByValue: true,
      });
    this.response(request, { result: result.result && result.result.description ? result.result.description : String(result.result && result.result.value), variablesReference: 0 });
  }

  async request_continue(request) {
    await this.cdp('Debugger.resume');
    this.response(request, { allThreadsContinued: true });
  }

  async request_next(request) {
    await this.cdp('Debugger.stepOver');
    this.response(request);
  }

  async request_stepIn(request) {
    await this.cdp('Debugger.stepInto');
    this.response(request);
  }

  async request_stepOut(request) {
    await this.cdp('Debugger.stepOut');
    this.response(request);
  }

  async request_pause(request) {
    await this.cdp('Debugger.pause');
    this.response(request);
  }

  request_setExceptionBreakpoints(request) {
    this.response(request);
  }

  async request_disconnect(request) {
    this.terminated = true;
    try { if (this.socket) this.socket.close(); } catch { /* already closed */ }
    if (this.child) {
      try { this.child.kill(); } catch { /* already exited */ }
    }
    this.response(request);
  }

  async request_terminate(request) {
    this.terminated = true;
    if (this.child) {
      try { this.child.kill(); } catch { /* already exited */ }
    }
    if (this.socket) {
      try { this.socket.close(); } catch { /* already closed */ }
    }
    this.response(request);
  }
}

function sameFile(left, right) {
  const normalize = (value) => String(value || '').replace(/^file:\/\//, '').replace(/\\/g, '/');
  return normalize(left) === normalize(right) || normalize(left).endsWith(`/${normalize(right)}`) || normalize(right).endsWith(`/${normalize(left)}`);
}

function startDebugAdapter(options = {}) {
  const session = new PlainScriptDebugSession(process.stdin, process.stdout, options);
  session.start();
  return session;
}

module.exports = { PlainScriptDebugSession, startDebugAdapter, readFrames, writeFrame };
