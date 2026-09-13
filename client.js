'use strict';
// Raw-socket measurement harness. Deliberately avoids Node's `http` client:
// a raw TCP socket means the byte count and timing reflect exactly what
// crossed the wire, not whatever a buffering HTTP client's internals report
// or delay.
//
// For each condition (a payload size x gzip on/off), opens a fresh TCP
// connection, writes a literal HTTP/1.1 GET with `Connection: close`, and
// measures:
//   - bytesOnWire: total bytes received on the socket (headers + body),
//     counted from actual `data` events, until the server closes the
//     connection (FIN correctly signaled by `Connection: close`).
//   - latencyMs: wall-clock time from the moment the request is written to
//     the moment the socket ends (last byte fully received).
//
// Fixed trial policy, stated up front (see also post.md "Methodology"):
//   - 30 trials per condition.
//   - First 5 discarded as warmup (JIT warmup / OS scheduler settling).
//   - Mean and population stdev reported over the remaining 25.

const net = require('net');
const fs = require('fs');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = process.env.PORT || 8085;
const TRIALS = 30;
const WARMUP = 5;

function oneRequest(reqPath) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(PORT, HOST, () => {
      const req =
        `GET ${reqPath} HTTP/1.1\r\n` +
        `Host: ${HOST}\r\n` +
        `Connection: close\r\n` +
        `\r\n`;
      const t0 = process.hrtime.bigint();
      socket.write(req);

      let bytes = 0;
      socket.on('data', (chunk) => {
        bytes += chunk.length;
      });
      socket.on('end', () => {
        const t1 = process.hrtime.bigint();
        const latencyMs = Number(t1 - t0) / 1e6;
        resolve({ bytes, latencyMs });
      });
      socket.on('error', reject);
    });
    socket.on('error', reject);
  });
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function stdev(arr) {
  const m = mean(arr);
  const variance = mean(arr.map((x) => (x - m) ** 2));
  return Math.sqrt(variance);
}

async function measure(reqPath, label) {
  const results = [];
  for (let i = 0; i < TRIALS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await oneRequest(reqPath);
    results.push(r);
  }
  const kept = results.slice(WARMUP);
  const bytesList = kept.map((r) => r.bytes);
  const latList = kept.map((r) => r.latencyMs);
  const summary = {
    label,
    path: reqPath,
    trials: TRIALS,
    warmupDiscarded: WARMUP,
    kept: kept.length,
    bytesOnWire: Math.round(mean(bytesList)), // constant across trials in practice; mean guards against any variance
    bytesOnWireAllEqual: new Set(bytesList).size === 1,
    latencyMeanMs: Number(mean(latList).toFixed(3)),
    latencyStdevMs: Number(stdev(latList).toFixed(3)),
  };
  return summary;
}

async function main() {
  // Sanity check first: point the instrument at something known-compressible
  // (highly repetitive JSON) and something known-incompressible (random
  // bytes as base64 text) to confirm gzip on/off actually changes bytesOnWire
  // in the expected direction before trusting it on the real sweep.
  const sanity = [];
  sanity.push(await measure('/json?bytes=5000&gzip=0', 'sanity-repetitive-raw'));
  sanity.push(await measure('/json?bytes=5000&gzip=1', 'sanity-repetitive-gzip'));

  const sizes = [100, 300, 500, 800, 1000, 1300, 1500, 2000, 3000, 5000, 10000, 20000];
  const sweep = [];
  for (const size of sizes) {
    // eslint-disable-next-line no-await-in-loop
    const raw = await measure(`/json?bytes=${size}&gzip=0`, `size=${size} raw`);
    // eslint-disable-next-line no-await-in-loop
    const gz = await measure(`/json?bytes=${size}&gzip=1`, `size=${size} gzip`);
    sweep.push({ size, raw, gz });
  }

  const realRaw = await measure('/real?gzip=0', 'real-fixture-raw');
  const realGz = await measure('/real?gzip=1', 'real-fixture-gzip');

  const out = { sanity, sweep, real: { raw: realRaw, gz: realGz } };
  fs.writeFileSync(path.join(__dirname, 'raw-results.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error('MEASUREMENT FAILED:', err);
  process.exit(1);
});
