'use strict';

// The single source of truth for the compiler version. package.json is kept in
// sync by tools/check-version.js, which the test suite runs.
const VERSION = '2.0.0';

module.exports = { VERSION };
