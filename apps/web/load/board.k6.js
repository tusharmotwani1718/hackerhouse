/**
 * Load test of the board (step 10.4): 100 people browsing the board of `load-jam (hackathon name)` at the same
 * time, each pausing 1–3 s between requests, like someone reading the cards.
 * Goal: p95 of the board < 200 ms, no 429s, < 1% failed requests.
 *
 *   bun run load:serve        terminal 1: the app on :3200 against the load database
 *   bun run load:board        terminal 2: this script (k6 run apps/web/load/board.k6.js)
 *
 * Quick try-out with fewer people:  k6 run -e VUS=10 -e HOLD=20s apps/web/load/board.k6.js
 * Live charts in the browser:       set K6_WEB_DASHBOARD=true before k6 run (localhost:5665)
 *
 * This runs in k6, not in Node or Bun: no fs, no fetch, no npm. Only k6's own modules.
 * Background SSE streams (100 open /stream connections) are not part of this run yet.
 */
import { check, fail, sleep } from "k6";
import { SharedArray } from "k6/data";
import http from "k6/http";
import { Counter } from "k6/metrics";

// --------------------------------------------------------------------------------- settings

const BASE_URL = __ENV.BASE_URL || "http://localhost:3200"; // app instance for load test
const SLUG = "load-jam"; // hackathon seeded in load db
const BOARD = `${BASE_URL}/api/hackathons/${SLUG}/board`;
const VUS = Number(__ENV.VUS || 100); // virtual users from k6
const HOLD = __ENV.HOLD || "3m"; // run the test in a loop till hold

// Words that really appear in the seeded team names ("<Adjective> <Noun>", see seed.ts), so
// searches return results like a real person's would.
// search in the seeded team names:
const SEARCH_WORDS = ["Rocket", "Quantum", "Neon", "Solar", "Pixel", "Otters", "Wizards", "Foxes"];

// ------------------------------------------------------------------------------- init code
// Runs once per VU at startup. The only place `open()` (read a file) is allowed.

// One read-only copy shared by all VUs (a plain array would be parsed and held with the sessions 100 times).
// `open()` paths are relative to THIS file.
const cookies = new SharedArray("sessions", () => JSON.parse(open("./.output/sessions.json")));

// Our own metric: how many 429s. The threshold below requires zero.
const rateLimited = new Counter("rate_limited");

// --------------------------------------------------------------------------------- options

export const options = {
  scenarios: {
    browse: {
      executor: "ramping-vus", // VUs over time, in stages
      startVUs: 0,
      stages: [
        { duration: "30s", target: VUS }, // warm up: people arrive over 30 s, not all at once
        { duration: HOLD, target: VUS }, // the measured part: VUS people browsing
        { duration: "10s", target: 0 }, // wind down
      ],
      gracefulRampDown: "10s", // let a leaving VU finish its current request
    },
  },

  // Pass/fail rules. Any ✗ → k6 exits with code 99 (CI can use that).
  thresholds: {
    http_req_duration: ["p(95)<200"], // THE requirement: 95% of all board requests < 200 ms
    // The same rule per kind of request (tagged below), so one slow kind can't hide in the mix.
    "http_req_duration{name:board_first}": ["p(95)<200"],
    "http_req_duration{name:board_next}": ["p(95)<200"],
    "http_req_duration{name:board_filter}": ["p(95)<200"],
    "http_req_duration{name:board_search}": ["p(95)<200"],
    http_req_failed: ["rate<0.01"], // under 1% errors (k6 counts any 4xx/5xx as failed)
    checks: ["rate>0.99"], // our checks held
    rate_limited: ["count==0"], // we measured the board, not the rate limiter
  },

  // Show p99 and max too: their distance from p95 says how bad the worst cases are.
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

// ----------------------------------------------------------------------------------- setup
// Runs ONCE before any VU starts. Fail fast if the server isn't the one we think it is,
// instead of 3.5 minutes of errors.

export function setup() {
  const res = http.get(BOARD, { headers: { cookie: cookies[0] }, tags: { name: "setup" } });
  if (res.status === 401) {
    fail("401: the cookies don't match the server (wrong database or BETTER_AUTH_SECRET?)");
  }
  if (res.status === 404) fail(`404: no hackathon "${SLUG}" (run bun run load:seed)`);
  if (res.status !== 200) fail(`Board answered ${res.status} (is bun run load:serve running?)`);
  const total = res.json("data.totalCount");
  console.log(`Board reachable: ${total} listed teams, ${cookies.length} sessions, ${VUS} VUs`);
}

// ------------------------------------------------------------------------------ one visit
// Each VU runs this again and again until the scenario ends. One run = one visit.

export default function visit() {
  // Each VU is one fixed person (__VU starts at 1). At ~1 request every 2 s that's ~30/min,
  // far under the read.user limit of 300/min; reads are limited per user, not per IP.
  const cookie = cookies[(__VU - 1) % cookies.length];

  const roll = Math.random();
  if (roll < 0.6) browse(cookie);
  else if (roll < 0.85) filter(cookie);
  else search(cookie);
}

/** ~60%: open the board, then go 1–3 pages deeper following nextCursor. */
function browse(cookie) {
  let page = board(cookie, "", "board_first");
  const deeper = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < deeper && page && page.nextCursor; i++) {
    page = board(cookie, `cursor=${encodeURIComponent(page.nextCursor)}`, "board_next");
  }
}

/** ~25%: filter by join policy (sometimes also public only), sometimes look at page 2. */
function filter(cookie) {
  let query = `policy=${Math.random() < 0.5 ? "OPEN" : "APPROVAL"}`;
  if (Math.random() < 0.4) query += "&access=PUBLIC";
  const page = board(cookie, query, "board_filter");
  if (page && page.nextCursor && Math.random() < 0.5) {
    board(cookie, `${query}&cursor=${encodeURIComponent(page.nextCursor)}`, "board_filter");
  }
}

/** ~15%: search team names. */
function search(cookie) {
  const word = SEARCH_WORDS[Math.floor(Math.random() * SEARCH_WORDS.length)];
  board(cookie, `q=${encodeURIComponent(word)}`, "board_search");
}

/**
 * One board request, then the think time. Returns { nextCursor } or null if it failed (the
 * visit then stops: following a cursor from a failed page would only add more errors).
 *
 * The `name` tag groups the metrics: every cursor URL is different, and without it k6 would
 * keep thousands of one-request URL series ("too many URLs" warning).
 */
function board(cookie, query, name) {
  const url = query ? `${BOARD}?${query}` : BOARD;
  const res = http.get(url, { headers: { cookie }, tags: { name } });

  if (res.status === 429) rateLimited.add(1);
  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "has teams": (r) => r.status === 200 && Array.isArray(r.json("data.teams")),
  });

  sleep(1 + Math.random() * 2); // 1–3 s reading the cards (seconds, not ms)
  return ok ? { nextCursor: res.json("nextCursor") } : null;
}
