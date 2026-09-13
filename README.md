# gzip-threshold-json-api

Does the common advice "only gzip-compress HTTP responses larger than
about 1KB, since compression overhead makes smaller ones worse" hold for
real JSON API responses, measured in actual bytes transferred and
latency?

This repo is a small local harness that answers that with real numbers
instead of folk wisdom: a JSON API server that can serve any response
either raw or gzip-compressed, and a raw-socket client that measures the
real bytes on the wire and real latency for both, across a sweep of
response sizes plus one real public API's actual response body.

Full writeup with methodology, findings, and caveats: see `post.md`.
Raw captured numbers: see `results.md` and `raw-results.json` /
`crossover-results.json` / `sanity-incompressible.json`.

## What's here

- `server.js` — plain Node `http` server, three routes:
  - `GET /json?bytes=<n>&gzip=<0|1>` — synthetic, repetitive JSON payload
    of approximately `n` bytes, served raw or gzip-compressed.
  - `GET /random?bytes=<n>&gzip=<0|1>` — base64-encoded random bytes in a
    JSON envelope, approximately `n` bytes. Used only as a sanity check
    (known near-incompressible content).
  - `GET /real?gzip=<0|1>` — serves `fixture.json` verbatim, raw or
    gzip-compressed.
- `client.js` — raw TCP socket measurement harness. Opens a fresh
  connection per request, sends a literal `GET` with `Connection: close`,
  and measures total bytes received and wall-clock latency to the last
  byte. Runs the main sweep (12 sizes from 100 to 20000 bytes, raw vs.
  gzip, 30 trials each) plus the sanity check and the real-fixture
  validation pass. Writes `raw-results.json`.
- `crossover.js` — a finer-grained follow-up sweep (100-300 bytes in
  steps of 20) to pin down the exact byte-size crossover the main sweep
  located between the 100 and 300 rows. Writes `crossover-results.json`.
- `fixture.json` — the real, unmodified JSON response body of
  `GET https://jsonplaceholder.typicode.com/users` (5645 bytes), fetched
  once, used for the validation pass.
- `results.md` — every captured number, in tables, with the methodology
  restated.
- `post.md` — the drafted DigitalOcean Community post, written using
  only the numbers in `results.md`.

## Prerequisites

- Node.js (tested on v24.3.0; no external dependencies, stdlib only).

## How to run it

```bash
# terminal 1
node server.js
# listens on http://127.0.0.1:8085

# terminal 2
node client.js       # main sweep + sanity checks + real-fixture pass
node crossover.js     # fine-grained crossover sweep, 100-300 bytes
```

Both scripts print their results as JSON to stdout and also write them
to `raw-results.json` / `crossover-results.json` in the working
directory.

## Method notes

- A raw TCP socket is used instead of a buffering HTTP client
  specifically so the byte count reflects exactly what crossed the wire,
  not what a client library reports after its own internal buffering.
- Every condition uses a fresh connection with `Connection: close`, so
  the client can measure "time to last byte" by waiting for the socket's
  `end` event rather than guessing from a `Content-Length` header.
- 30 trials per condition, first 5 discarded as warmup, mean and
  population standard deviation reported over the remaining 25. This is
  a fixed policy decided before running, not tuned after seeing results.
- This is a loopback-only measurement (no Droplet, no real network hop).
  See `post.md`'s caveats section for what that does and doesn't mean for
  the results.
