const assert = require('assert');
const { tokenize } = require('../compiler/lexer');
const { parse } = require('../compiler/parser');
const { generate } = require('../compiler/generator');
const { checkTypes } = require('../compiler/type-checker');

function ast(source) { return parse(tokenize(source)); }

const generic = ast(`make identity<T>(value as T) returns T
  give value
done
remember numberValue as identity(42)
remember textValue as identity("ok")`);
assert.deepStrictEqual(generic.body[0].genericParams, ['T']);
assert.strictEqual(checkTypes(generic).diagnostics.length, 0);

const js = generate(ast(`remember token as cancellationToken()
remember ignored as cancel(token)
show isCancelled(token)`));
assert(js.includes('AbortController'));
assert(js.includes('__plainCancel'));
assert(js.includes('__plainDispose'));

const typed = checkTypes(ast(`make first<T>(items as list of T) returns T
  give items[0]
done
remember value as first([1, 2])`));
assert.strictEqual(typed.diagnostics.length, 0);

console.log('Completeness foundations: 3 tests passed');
