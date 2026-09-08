// PlainScript — error-handling capability suite.
//
// Verifies throw / try / recover (typed + untyped) / retry by RUNNING snippets
// and checking runtime behaviour.

const { test, assert, run } = require('./_util');

test('throw str: caught by recover, value surfaces via text()', () => {
  const out = run(`
try
    throw "kaboom"
recover as err
    show "caught: " + text(err)
done
`);
  assert(out.includes('caught: kaboom'), `expected caught string:\n${out}`);
});

test('throw from a function is caught by the caller', () => {
  const out = run(`
make risky()
    throw "inner failure"
done
try
    remember x as risky()
    show "no error"
recover as err
    show "outer: " + text(err)
done
`);
  assert(out.includes('outer: inner failure'), `expected propagated error:\n${out}`);
});

test('recover: silent fallback still continues the program', () => {
  const out = run(`
try
    throw "nope"
done
show "survived"
`);
  assert(out.includes('survived'), `program must continue after swallowed error:\n${out}`);
});

test('jsonDecode failure is recoverable', () => {
  const out = run(`
try
    remember parsed as jsonDecode("{ bad")
    show parsed
recover as err
    show "fallback used"
done
`);
  assert(out.includes('fallback used'), `expected recover on JSON error:\n${out}`);
});

test('finally runs after recover and preserves the cleanup block', () => {
  const out = run(`
remember cleanup as false
try
    throw "failure"
recover as err
    show "caught"
finally
    cleanup becomes true
    show "cleaned"
done
show cleanup
`);
  assert(out.includes('caught') && out.includes('cleaned') && out.includes('true'),
    `expected recover and finally output:\n${out}`);
});

test('retry: retries N times then succeeds', () => {
  const out = run(`
remember attempts as 0
make flaky()
    attempts becomes attempts + 1
    if attempts is 1
        throw "first failure"
    done
    give "ok"
done
retry 3 times every 1 second
    remember result as flaky()
    show result
done
`);
  assert(out.includes('ok'), `expected retried success:\n${out}`);
});

const { summary } = require('./_util');
summary();
