'use strict';
// Fine-grained follow-up sweep to pin down the exact byte-size crossover
// found by client.js's coarse sweep (gzip lost at 100 bytes, won by 300).
// Same measurement method as client.js: raw TCP socket, 30 trials per
// condition, first 5 discarded as warmup, mean over the remaining 25.
// Kept as a separate script (rather than folded into client.js) because it
// exists only to refine one boundary already established by the main sweep.

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
      const req = `GET ${reqPath} HTTP/1.1\r\nHost: ${HOST}\r\nConnection: close\r\n\r\n`;
      const t0 = process.hrtime.bigint();
      socket.write(req);
      let bytes = 0;
      socket.on('data', (chunk) => { bytes += chunk.length; });
      socket.on('end', () => {
        const t1 = process.hrtime.bigint();
        resolve({ bytes, latencyMs: Number(t1 - t0) / 1e6 });
      });
      socket.on('error', reject);
    });
    socket.on('error', reject);
  });
}
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

async function measure(reqPath) {
  const results = [];
  for (let i = 0; i < TRIALS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await oneRequest(reqPath));
  }
  const kept = results.slice(WARMUP);
  return Math.round(mean(kept.map((r) => r.bytes)));
}

async function main() {
  const sizes = [100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300];
  const rows = [];
  for (const size of sizes) {
    // eslint-disable-next-line no-await-in-loop
    const raw = await measure(`/json?bytes=${size}&gzip=0`);
    // eslint-disable-next-line no-await-in-loop
    const gz = await measure(`/json?bytes=${size}&gzip=1`);
    rows.push({ size, raw, gz, gzipSmaller: gz < raw });
  }
  fs.writeFileSync(path.join(__dirname, 'crossover-results.json'), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error('MEASUREMENT FAILED:', err);
  process.exit(1);
});
