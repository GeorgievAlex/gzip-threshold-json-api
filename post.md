Title: How many bytes does gzip actually save on small JSON API responses (and where does the 1KB rule stop being true)?

Hi there,

The advice you will find repeated everywhere is: only gzip-compress HTTP responses larger than about 1KB, because compression overhead makes anything smaller worse. It shows up as a default threshold in reverse proxy configs and framework compression middleware, and most people who set that number never measured it against their own payload shape, they copied it from a blog post. That matters because a lot of JSON API responses (a single object, a short list, a status payload) sit well under 1KB, and if the 1KB rule is too conservative, those responses are shipping more bytes than they need to, on every request, forever.

I wanted an actual number instead of a repeated rule, so I built a small harness, measured real bytes on the wire and real latency across a sweep of response sizes, and found the crossover.

The one number to have in hand before looking at any results is the bytes-on-wire ratio: gzip bytes divided by raw bytes, for the same response. A ratio above 1.0 means gzip made the response bigger. A ratio near 0.1 means gzip shipped about a tenth of the original bytes. Before trusting this number against the real question, I pointed it at two known cases: a highly repetitive JSON payload (should compress a lot) and a base64-encoded blob of random bytes (should barely compress at all, since base64 is already close to its own entropy floor). At a nominal 5000-byte body, the repetitive JSON compressed to a ratio of 0.119 (an 88.1 percent reduction), and the random blob compressed to a ratio of 0.775 (a 22.5 percent reduction, matching the roughly 25 percent ceiling you would expect from base64 packing 6 bits of information per 8-bit byte). The instrument correctly told compressible from incompressible content apart before I pointed it at the real question.

Methodology, in the order I actually ran it:

1. Built a plain Node.js (v24.3.0) HTTP server with three routes: a synthetic generator producing repetitive JSON (an array of small objects with repeated field names, the shape a typical list endpoint returns) at a target byte size, a generator producing a base64-encoded random blob at a target byte size (the incompressible sanity check), and a route serving a real captured API response verbatim. Each route can serve its body raw or gzip-compressed via a query parameter, using Node's built-in `zlib` at its default compression level.
2. Built the measurement client as a raw TCP socket, not a buffering HTTP client library. This matters: an HTTP client that auto-decompresses or coalesces response chunks internally will hide the real wire size and blur the real timing, so the client here opens a fresh connection per request, writes a literal `GET` with `Connection: close`, counts every byte received on `data` events, and marks latency as the time from writing the request to the socket's `end` event, meaning the full response, not just the first byte, has arrived.
3. Fixed the trial policy before running anything: 30 trials per condition, discard the first 5 as warmup, report the mean and population standard deviation of the remaining 25. Decided in advance, not adjusted after looking at results.
4. A mistake that looks plausible but silently invalidates this kind of measurement: testing only against lorem-ipsum or random text instead of real JSON structure understates how compressible typical API responses are, because real JSON has heavy repetition in key names and short enum-like values that generic text does not. The synthetic generator here deliberately mimics that shape.
5. Environment check before trusting any of it: this is a CPU-bound question (compression time and header overhead), not a network-timing one, so it ran entirely over loopback (127.0.0.1) on one machine, no Droplet. That is a different situation from an investigation into real network or proxy timing behavior, where a local machine's virtualized networking can produce a phantom result that a real host would not. Byte counts and in-process compression cost do not depend on network path, so loopback was the right environment here, and that decision was made up front rather than discovered as a problem partway through.

Findings, main sweep (repetitive JSON, target body size 100 to 20000 bytes, raw bytes on wire vs gzip bytes on wire, and latency in milliseconds):

| target body bytes | raw bytes on wire | gzip bytes on wire | gzip/raw ratio | raw latency (ms) | gzip latency (ms) |
|---|---|---|---|---|---|
| 100 | 250 | 274 | 1.096 | 0.097 | 0.147 |
| 300 | 425 | 309 | 0.727 | 0.104 | 0.146 |
| 500 | 627 | 327 | 0.522 | 0.074 | 0.155 |
| 800 | 925 | 350 | 0.378 | 0.101 | 0.154 |
| 1000 | 1125 | 366 | 0.325 | 0.337 | 0.127 |
| 1300 | 1426 | 381 | 0.267 | 0.077 | 0.113 |
| 1500 | 1626 | 398 | 0.245 | 0.074 | 0.113 |
| 2000 | 2126 | 434 | 0.204 | 0.100 | 0.182 |
| 3000 | 3126 | 494 | 0.158 | 0.083 | 0.139 |
| 5000 | 5126 | 610 | 0.119 | 0.137 | 0.159 |
| 10000 | 10134 | 910 | 0.090 | 0.183 | 0.246 |
| 20000 | 20127 | 1565 | 0.078 | 0.327 | 0.458 |

At the 100-byte row, gzip made the response 9.6 percent bigger on the wire, exactly what the folk advice warns about. But that stopped being true well before 1KB. A finer sweep between 100 and 300 bytes pins down where:

| target body bytes | raw bytes on wire | gzip bytes on wire | gzip smaller? |
|---|---|---|---|
| 100 | 250 | 274 | no |
| 120 | 250 | 274 | no |
| 140 | 265 | 282 | no |
| 160 | 285 | 284 | yes, by 1 byte |
| 180 | 305 | 284 | yes |
| 200 | 325 | 284 | yes |
| 220 | 345 | 284 | yes |
| 240 | 365 | 284 | yes |
| 260 | 385 | 309 | yes |
| 280 | 405 | 309 | yes |
| 300 | 425 | 309 | yes |

For this JSON shape, the crossover sits between 140 and 160 bytes of body content, roughly 270 to 285 bytes once HTTP headers are counted. That is close to an order of magnitude below the commonly cited 1KB threshold.

As a validation pass, I pointed the same harness at one real payload instead of the synthetic generator: the actual response body of `GET https://jsonplaceholder.typicode.com/users`, fetched once and replayed unmodified (5645 bytes). Raw bytes on the wire were 5774, gzip bytes on the wire were 2000, a ratio of 0.346. That is a smaller reduction than the synthetic generator's 5000-byte row (ratio 0.119), because this real payload is less repetitive than the synthetic one, but it still compresses heavily and the direction and order of magnitude match. This pass is validation, not proof on its own, since it is a single real payload shape rather than a broad corpus of real APIs, but it is a cheap and useful check that the synthetic sweep is not an artifact of the generator.

Caveats, named plainly:

- This was measured entirely over loopback with no real network hop. The latency deltas above are the in-process CPU cost of calling gzip, not what a client would feel once real network round-trip time is added on top. A Droplet or a two-host setup was not used because this question does not depend on network timing, but that also means these latency numbers should not be read as "what a real user would feel," only as "what compression itself costs the server."
- Noise floor: every latency stdev in the main sweep is under 0.1ms except the 1000-byte row's raw-path stdev, at 1.062ms. That is a clear outlier against every other row and almost certainly a single slow trial (a garbage collection pause or OS scheduling blip) rather than a real effect of that specific size. It was left in rather than quietly dropped, since the exclusion policy (discard the first 5 of 30 trials as warmup, keep the rest) was fixed before running and does not include discarding mid-run outliers.
- Exclusion rate: exactly 5 of 30 trials (16.7 percent) were discarded per condition, as warmup, by a rule fixed in advance. No other exclusions were applied.
- The gzip compression level was left at Node's default and was not swept. A higher compression level could shift the crossover point in either direction and was not tested.
- Only one real-world payload shape was validated. A broader corpus of real API responses (different field name lengths, nesting depth, string content) would likely shift the exact crossover byte count without changing its order of magnitude relative to 1KB.

The takeaway: for JSON shaped like a typical list or object response, with the field-name repetition real API payloads actually have, gzip starts paying off in raw bytes transferred at around 150 to 160 bytes of body content, not 1KB. A blanket 1KB compression threshold leaves a real, measurable amount of bandwidth savings unclaimed for a wide range of genuinely small responses. If you cannot measure your own payload shape, the safer default for typical repetitive JSON is a threshold closer to 150 to 200 bytes, not 1000, and the actual cost of finding that out here was zero dollars and an afternoon on a laptop, no Droplet required.

Regards
