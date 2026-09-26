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

const aliasAndCollections = ast(`type UserId is number
type Pair is tuple of number, text
type Scores is map of text to number
make getId() returns UserId
  give 42
done
remember id as getId()
remember scores as { "ada": 10 }
remember pair as tuple with 1, "one" done`);
assert.strictEqual(checkTypes(aliasAndCollections).diagnostics.length, 0);
const invalidMatch = checkTypes(ast(`remember flag as true
match flag against
  true -> show "yes"
done`));
assert(invalidMatch.diagnostics.some(item => item.code === 'PLN-MATCH-NONEXHAUSTIVE'));
const duplicateMatch = checkTypes(ast(`remember flag as true
match flag against
  true -> show "a"
  true -> show "b"
  false -> show "c"
done`));
assert(duplicateMatch.diagnostics.some(item => item.code === 'PLN-MATCH-DUPLICATE'));
