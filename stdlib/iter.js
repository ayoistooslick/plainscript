// Lazy sequence helpers. Every input is accepted as any JavaScript iterable so
// generators, lists, maps and text can be composed without conversion. Every
// function that produces values is itself a generator, which means an infinite
// source stays lazy until a consumer asks for more.

function* asIterator(value) {
  yield* value;
}

export function* range(from, to, step = 1) {
  if (step === 0) throw new RangeError('std/iter.range: step must not be zero');
  if (step > 0) {
    for (let value = from; value <= to; value += step) yield value;
  } else {
    for (let value = from; value >= to; value += step) yield value;
  }
}

export function* repeat(value, count) {
  for (let index = 0; index < count; index += 1) yield value;
}

export function* fromList(items) {
  yield* items;
}

export function toList(items) {
  return Array.from(items);
}

export function* map(items, f) {
  for (const value of items) yield f(value);
}

export function* filter(items, keep) {
  for (const value of items) if (keep(value)) yield value;
}

export function* take(items, count) {
  if (count <= 0) return;
  let taken = 0;
  for (const value of items) {
    yield value;
    taken += 1;
    if (taken >= count) return;
  }
}

export function* drop(items, count) {
  let index = 0;
  for (const value of items) {
    if (index >= count) yield value;
    index += 1;
  }
}

export function* chain(first, second) {
  yield* first;
  yield* second;
}

export function* enumerate(items) {
  let index = 0;
  for (const value of items) {
    yield [index, value];
    index += 1;
  }
}

export function* zip(left, right) {
  const a = asIterator(left);
  const b = asIterator(right);
  while (true) {
    const nextA = a.next();
    const nextB = b.next();
    if (nextA.done || nextB.done) return;
    yield [nextA.value, nextB.value];
  }
}

export function reduce(items, initial, combine) {
  let result = initial;
  for (const value of items) result = combine(result, value);
  return result;
}

export function count(items) {
  let total = 0;
  for (const _ of items) total += 1;
  return total;
}

export function some(items, test) {
  for (const value of items) if (test(value)) return true;
  return false;
}

export function every(items, test) {
  for (const value of items) if (!test(value)) return false;
  return true;
}

export function find(items, test) {
  for (const value of items) if (test(value)) return value;
  return null;
}

export function forEach(items, visit) {
  for (const value of items) visit(value);
}
