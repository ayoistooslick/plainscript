// Standard library: std/json
// JSON is a recursive data type expressed in PlainScript's own type language:
// `Json` is declared in json.d.pln, not hard-coded in the compiler.

export function encode(value, indent) {
  return JSON.stringify(value, null, indent === undefined ? 0 : indent);
}

export function decode(text) {
  return JSON.parse(text);
}

export function tryDecode(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
