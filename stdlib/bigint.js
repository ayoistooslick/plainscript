// The language has native bigint literals and arithmetic. These helpers cover
// the boundary operations where a conversion or a guard is required.

export function parse(text, radix = 10) {
  if (!Number.isInteger(radix) || radix < 2 || radix > 36) {
    throw new RangeError('std/bigint.parse: radix must be an integer between 2 and 36');
  }
  const trimmed = String(text).trim();
  if (!trimmed) throw new SyntaxError('std/bigint.parse: empty input');
  // BigInt() understands 0x/0b/0o and decimal, but not an arbitrary radix.
  if (radix === 10) return BigInt(trimmed);
  let negative = false;
  let digits = trimmed;
  if (digits[0] === '+' || digits[0] === '-') {
    negative = digits[0] === '-';
    digits = digits.slice(1);
  }
  if (!/^[0-9a-zA-Z]+$/.test(digits)) throw new SyntaxError('std/bigint.parse: invalid digit');
  let result = 0n;
  const base = BigInt(radix);
  for (const character of digits.toLowerCase()) {
    const value = character >= '0' && character <= '9'
      ? character.charCodeAt(0) - 48
      : character.charCodeAt(0) - 87;
    if (value < 0 || value >= radix) throw new SyntaxError(`std/bigint.parse: digit ${JSON.stringify(character)} is not valid in base ${radix}`);
    result = result * base + BigInt(value);
  }
  return negative ? -result : result;
}

export function tryParse(text, radix = 10) {
  try {
    return parse(text, radix);
  } catch {
    return null;
  }
}

export function fromNumber(value) {
  if (!Number.isInteger(value)) throw new RangeError('std/bigint.fromNumber: value is not an integer');
  return BigInt(value);
}

export function toNumber(value) {
  return Number(value);
}

export function toText(value, radix = 10) {
  return value.toString(radix);
}

export function abs(value) {
  return value < 0n ? -value : value;
}

export function min(left, right) {
  return left < right ? left : right;
}

export function max(left, right) {
  return left > right ? left : right;
}

export function gcd(left, right) {
  let a = abs(left);
  let b = abs(right);
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

export function pow(base, exponent) {
  if (exponent < 0n) throw new RangeError('std/bigint.pow: negative exponent');
  return base ** exponent;
}

export function modPow(base, exponent, modulus) {
  if (modulus <= 0n) throw new RangeError('std/bigint.modPow: modulus must be positive');
  if (exponent < 0n) throw new RangeError('std/bigint.modPow: negative exponent');
  let result = 1n;
  let factor = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }
  return result;
}

export function isEven(value) {
  return (value & 1n) === 0n;
}

export function compare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
