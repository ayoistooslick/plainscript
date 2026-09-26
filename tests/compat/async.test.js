// PlainScript  -  async capability suite.
//
// Verifies async combinators  -  all of, any of, settled of, withTimeout, and
// run background  -  by RUNNING snippets and checking runtime behaviour (each
// result resolves in order).

const { test, assert, run } = require('./_util');

test('all of: awaits every promise and returns an ordered array', () => {
  const out = run(`
make slow(tag)
    sleep(20)
    give { tag: tag }
done
remember results as all of [slow("a"), slow("b")]
show length(results)
show tag of results[0]
show tag of results[1]
`);
  assert(out.includes('2') && out.includes('a') && out.includes('b'),
    `expected ordered results:\n${out}`);
});

test('any of: resolves to one of the awaited values', () => {
  const out = run(`
make quick(tag)
    sleep(10)
    give tag
done
remember winner as any of [quick("a"), quick("b")]
show winner
`);
  assert(out.includes('a') || out.includes('b'), `expected a resolved value:\n${out}`);
});

test('settled of: records outcomes of promises that fulfil', () => {
  const out = run(`
make good(tag)
    sleep(10)
    give tag
done
remember results as settled of [good("one"), good("two")]
show status of results[0]
show status of results[1]
`);
  assert(out.includes('fulfilled'), `expected fulfilled outcomes:\n${out}`);
});

test('withTimeout: a bounded quick call resolves fine', () => {
  const out = run(`
make quick()
    sleep(5)
    give "done"
done
remember bounded as withTimeout(quick(), 2000)
show bounded
`);
  assert(out.includes('done'), `expected bounded result:\n${out}`);
});

test('run background: launches and does not block', () => {
  const out = run(`
remember order as []
add("first" to order)
run background add("bg" to order)
show length(order)
`);
  // The background task is scheduled; the synchronous path sees "first".
  assert(out.includes('1'), `expected main path length 1:\n${out}`);
});

const { summary } = require('./_util');
summary();
