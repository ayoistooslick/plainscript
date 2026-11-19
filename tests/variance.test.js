'use strict';

// PlainScript has structural types, so variance is derived from the shape of a
// type rather than from nominal declarations. Function parameters are
// contravariant, results are covariant, records are width-subtyped and
// containers are covariant. These tests pin that model down in both directions.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSource } = require('./helpers');

test('function parameters are contravariant and results are covariant', () => {
  const result = runSource(`type Handler = (value: number) -> number
let acceptsAny: Handler = (value: any) => 1
let returnsNarrow: () -> number or text = () => 1
let alsoWide: Handler = acceptsAny
`);
  assert.equal(result.status, 0, result.stderr);
});

test('incompatible function parameters and results are rejected', () => {
  const result = runSource(`type Handler = (value: number) -> number
let invalidParam: Handler = (value: text) => 1
let invalidReturn: () -> number = () => "no"
`);
  assert.equal(result.status, 1);
  const codes = result.compiler.diagnostics.map((diagnostic) => diagnostic.code);
  assert.ok(codes.includes('PS3311'));
  assert.ok(result.compiler.diagnostics.some((diagnostic) =>
    /Cannot initialise "invalidParam"/.test(diagnostic.message)));
});

test('records are width-subtyped and lists are covariant', () => {
  const result = runSource(`type Named = { id: number, name: text }
type Identified = { id: number }
let full: Named = { id: 1, name: "Ada" }
let narrow: Identified = full
let numbers: list of number = [1, 2]
let values: list of number or text = numbers
`);
  assert.equal(result.status, 0, result.stderr);
});

test('covariance does not erase incompatible element types', () => {
  const result = runSource(`let values: list of number or text = [1, "two"]
let bad: list of number = values
`);
  assert.equal(result.status, 1);
  assert.ok(result.compiler.diagnostics.some((diagnostic) =>
    diagnostic.code === 'PS3311' && /Cannot initialise "bad"/.test(diagnostic.message)));
});

test('generic aliases preserve function variance after substitution', () => {
  const result = runSource(`type Mapper<T> = (value: T) -> T
let identity: Mapper<number> = (value: any) => value
let invalid: Mapper<number> = (value: text) => 1
`);
  assert.equal(result.status, 1);
  assert.ok(result.compiler.diagnostics.some((diagnostic) =>
    diagnostic.code === 'PS3311' && /invalid/.test(diagnostic.message)));
});
