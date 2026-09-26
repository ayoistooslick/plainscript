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

const recursiveAlias = checkTypes(ast(`type Tree is number or list of Tree
remember tree as [1, [2]]`));
assert.deepStrictEqual(recursiveAlias.diagnostics, []);

const recursiveAliasMismatch = checkTypes(ast(`type Tree is number or list of Tree
make bad(value as Tree) returns text
  give value
done`));
assert(recursiveAliasMismatch.diagnostics.some(item => item.code === 'PLN-TYPE-RETURN'));

const structuralUnion = checkTypes(ast(`type Left
  left is number
done
type Right
  right is text
done
type Either is Left or Right
make read(value as Either) returns number
  give value.left
done`));
assert.deepStrictEqual(structuralUnion.diagnostics, []);

const utc = generate(ast(`remember d as newDate(2026, 1, 2, 3, 4, 5, 6)
show formatDateUTC(d, "YYYY-MM-DD HH:mm:ss SSS")`));
assert(utc.includes('__formatDateUTC'));
assert(utc.includes('(1 - 1)'));

const invalidCollections = checkTypes(ast(`type UserId is number
let scores as map of text to number is dictionary with "ada" is "bad" done
let tags as set of text is set with 1 done
let pair as tuple of number, text is tuple with "bad", "ok" done
let ids as map of UserId to text is dictionary with "wrong" is "Ada" done`));
assert(invalidCollections.diagnostics.filter(item => item.code === 'PLN-TYPE-ARG').length >= 3);

const validCollections = checkTypes(ast(`type UserId is number
let scores as map of text to number is dictionary with "ada" is 10 done
let tags as set of text is set with "a", "b" done
let pair as tuple of number, text is tuple with 1, "ok" done
let ids as map of UserId to text is dictionary with 1 is "Ada" done`));
assert.strictEqual(validCollections.diagnostics.length, 0);

const invalidPut = checkTypes(ast(`let scores as map of text to number is dictionary with "ada" is 10 done
put 1 as "bad" in scores`));
assert(invalidPut.diagnostics.some(item => item.code === 'PLN-TYPE-ASSIGN'));

const aliasRuntime = generate(ast(`type UserId is number
make id() returns UserId
  give 42
done
show id()`));
assert(aliasRuntime.includes('__plainTypes["UserId"]'));
