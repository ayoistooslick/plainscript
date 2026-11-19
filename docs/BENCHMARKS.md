# Compiler benchmarks

The benchmark is synthetic and PlainScript-only. It exists to detect regressions and to
make the build path measurable without a network install. It does **not** support a claim
that PlainScript is faster than TypeScript.

## Reproduce

```bash
npm run bench
# or choose modules and iterations
node scripts/benchmark.js 40 7
```

`scripts/benchmark.js` writes a temporary project of independent modules, warms the
compiler, then measures full graph compile and checker time. Values are milliseconds on the
machine that runs it; compare results only on the same machine and Node version.

## Recorded result

Node `v22.23.3`, 40 modules, 7 iterations (`npm run bench`):

| Measurement | min | median | max |
| --- | ---: | ---: | ---: |
| Cold compile | 9.76 ms | 16.95 ms | 27.87 ms |
| Typecheck | — | 3.68 ms | — |

These numbers cover tiny generated modules and should not be extrapolated to real
applications. A TypeScript/Vite baseline is deliberately absent because it would require a
pinned dependency installation; adding one without recording its exact versions and
configuration would not be a valid comparison. The roadmap tracks that work.
