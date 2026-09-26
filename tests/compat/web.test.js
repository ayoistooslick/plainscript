const { test, assert, tmpDir, write, checkDir } = require('./_util');

test('web: a web app with routes passes validation', () => {
  const dir = tmpDir();
  const app = `
web app
route get "/"
    reply "hello"
done
route "/api/status"
    reply json
        status is "ok"
    done
done
start 0
`;
  write(dir, 'app.pln', app);
  const r = checkDir(dir);
  assert(r.ok, `web app should validate:\n${JSON.stringify(r)}`);
});

test('web: express is reported as a dependency', () => {
  const dir = tmpDir();
  const app = `
web app
route get "/"
    reply "pong"
done
start 0
`;
  write(dir, 'app.pln', app);
  const r = checkDir(dir);
  assert(r.ok, `web app should validate:\n${JSON.stringify(r)}`);
  const names = (r.deps || []).map((d) => d.package);
  assert(names.includes('express'), `expected express in deps: ${names}`);
});

const { summary } = require('./_util');
summary();
