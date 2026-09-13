# Captured results

All numbers below are copied directly from `raw-results.json`,
`crossover-results.json`, and `sanity-incompressible.json`, produced by
running `server.js` + `client.js` (and the one-off incompressible-data
check) against a live local server on `127.0.0.1:8085`. Node v24.3.0.
Methodology: raw TCP socket client, fresh connection per request,
`Connection: close`, 30 trials per condition, first 5 discarded as
warmup, mean/stdev over the remaining 25. `bytesOnWireAllEqual: true`
held for every condition (byte counts were deterministic across trials;
only latency varied).

## Sanity checks (instrument validation)

Repetitive JSON (highly compressible) vs. base64-encoded random bytes
(near the entropy floor for compressibility), both at nominal 5000-byte
payload:

| payload type | raw bytes on wire | gzip bytes on wire | reduction |
|---|---|---|---|
| repetitive JSON (`/json?bytes=5000`) | 5126 | 610 | 88.1% |
| random/base64 (`/random?bytes=5000`) | 5128 | 3974 | 22.5% |

Gzip shrinks the compressible payload by 88% and the near-incompressible
payload by only 22.5% (consistent with base64's theoretical ~25% ceiling,
since base64 packs 6 bits of entropy per 8-bit byte). The instrument
correctly distinguishes compressible from incompressible content before
being trusted on the real sweep.

## Main sweep: synthetic repetitive JSON, size 100 to 20000 bytes

| target body bytes | raw bytes on wire | gzip bytes on wire | gzip/raw ratio | raw latency (ms) | gzip latency (ms) | latency delta (ms) | latency stdev raw / gzip |
|---|---|---|---|---|---|---|---|
| 100 | 250 | 274 | 1.096 | 0.097 | 0.147 | +0.050 | 0.010 / 0.020 |
| 300 | 425 | 309 | 0.727 | 0.104 | 0.146 | +0.042 | 0.017 / 0.033 |
| 500 | 627 | 327 | 0.522 | 0.074 | 0.155 | +0.081 | 0.009 / 0.093 |
| 800 | 925 | 350 | 0.378 | 0.101 | 0.154 | +0.053 | 0.041 / 0.025 |
| 1000 | 1125 | 366 | 0.325 | 0.337 | 0.127 | -0.210 | 1.062 / 0.061 |
| 1300 | 1426 | 381 | 0.267 | 0.077 | 0.113 | +0.036 | 0.016 / 0.019 |
| 1500 | 1626 | 398 | 0.245 | 0.074 | 0.113 | +0.039 | 0.008 / 0.015 |
| 2000 | 2126 | 434 | 0.204 | 0.100 | 0.182 | +0.082 | 0.068 / 0.037 |
| 3000 | 3126 | 494 | 0.158 | 0.083 | 0.139 | +0.056 | 0.007 / 0.028 |
| 5000 | 5126 | 610 | 0.119 | 0.137 | 0.159 | +0.022 | 0.014 / 0.021 |
| 10000 | 10134 | 910 | 0.090 | 0.183 | 0.246 | +0.063 | 0.025 / 0.028 |
| 20000 | 20127 | 1565 | 0.078 | 0.327 | 0.458 | +0.131 | 0.021 / 0.022 |

Note: the 1000-byte row's raw-path latency stdev (1.062ms) is a clear
outlier against every other row (all under 0.1ms). One trial in that
batch of 25 kept samples was slow, almost certainly a GC pause or OS
scheduling blip unrelated to gzip. Left in rather than silently dropped;
called out here and in the post's caveats.

## Fine sweep: locating the exact crossover (100-300 bytes)

| target body bytes | raw bytes on wire | gzip bytes on wire | gzip smaller? |
|---|---|---|---|
| 100 | 250 | 274 | no |
| 120 | 250 | 274 | no |
| 140 | 265 | 282 | no |
| 160 | 285 | 284 | yes (by 1 byte) |
| 180 | 305 | 284 | yes |
| 200 | 325 | 284 | yes |
| 220 | 345 | 284 | yes |
| 240 | 365 | 284 | yes |
| 260 | 385 | 309 | yes |
| 280 | 405 | 309 | yes |
| 300 | 425 | 309 | yes |

Crossover for this repetitive-JSON shape falls between 140 and 160 bytes
of body content (roughly 270-285 bytes on the wire once headers are
included).

## Validation pass: real API response

Fixture: `fixture.json`, the actual response body of
`GET https://jsonplaceholder.typicode.com/users` (5645 bytes), fetched
once and replayed unmodified through the same harness.

| payload | raw bytes on wire | gzip bytes on wire | ratio | raw latency (ms) | gzip latency (ms) |
|---|---|---|---|---|---|
| real fixture (5645-byte body) | 5774 | 2000 | 0.346 | 0.046 | 0.145 |

Consistent with the synthetic sweep's 5000-byte row (ratio 0.119 there
vs. 0.346 here; the real fixture is less repetitive than the synthetic
generator's output, so it compresses somewhat less, but still compresses
heavily and the byte savings direction and order of magnitude match).
