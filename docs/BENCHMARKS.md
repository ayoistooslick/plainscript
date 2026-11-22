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

Earlier run on Node `v22.23.3`, 40 modules, 7 iterations (`npm run bench`); a
fresh 2.3 run on Node `v26.13.1` measured a 19.74 ms median cold compile and
6.23 ms typecheck:

| Measurement | min | median | max |
| --- | ---: | ---: | ---: |
| Cold compile | 9.78 ms | 14.65 ms | 28.50 ms |
| Typecheck | — | 4.50 ms | — |

These numbers cover tiny generated modules and should not be extrapolated to real
applications. A TypeScript/Vite baseline is deliberately absent because it would require a
pinned dependency installation; adding one without recording its exact versions and
configuration would not be a valid comparison. The roadmap tracks that work.

## 2.3 build cache

Measured with `node scripts/benchmark-cache.js 100 5` on Linux x64, Node
`v26.13.1`. The fixture has 100 independent modules and one entry importing all
of them (101 emitted modules). Times are end-to-end CLI wall time and include
Node startup.

| Measurement | Time |
| --- | ---: |
| Cold build (writes the cache) | 200.48 ms |
| Warm build, median of 5 (`min` 79.22, `max` 93.23) | 88.73 ms |
| Build with `--no-cache` | 136.16 ms |

The warm build reused all 101 modules. The cold build is slower than a no-cache
build because it also writes the cache. The cache is correctness-first: a hit
requires the source hash, compiler fingerprint, configuration and dependency
hashes to match; a miss falls back to a normal compile and a corrupt cache file
is ignored rather than trusted. These are synthetic independent modules, not a
real application benchmark.
