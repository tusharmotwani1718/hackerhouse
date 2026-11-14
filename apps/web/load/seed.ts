/**
 * Load-test seed (step 10.3): 10,000 users and 2,000 teams in ONE hackathon (`load-jam`), in a
 * separate database (`hacker_house_load`), plus a signed session cookie for every user, written
 * to load/.output/sessions.json for k6 (06 §9.2: no HTTP sign-in during the load test).
 *
 *   bun run load:seed                  (from the repo root)
 *
 * - Same data every run: a seeded random generator (only the session tokens are truly random).
 * - Every run starts by emptying the load database (and creates + migrates it if missing).
 * - Refuses any database whose name doesn't end in `_load`.
 * - Bulk inserts (spike S6 (b)): one password hash reused, cookies signed here, a sample checked
 *   through Better Auth's own getSession at the end.
 *
 * Standalone like the admin CLI: no imports from the app's server-only modules.
 */
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

import { createDbClient, type DbClient, type Skill } from "@hacker-house/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { hashPassword } from "better-auth/crypto";

// ------------------------------------------------------------------------------- settings

const USERS = 10_000;
const TEAMS = 2_000;
const MAX_TEAM_SIZE = 5;
const SLUG = "load-jam";
const PASSWORD = "load-test-password"; // every seeded user (and the admin) can sign in with it
const RANDOM_SEED = 20261114;
const BATCH = 1_000;
const DAY = 24 * 60 * 60 * 1000;
const SESSION_DAYS = 7;

/** Team sizes 1–5: mean ≈ 3.1 → ≈ 6,200 people in teams, ≈ 3,800 without one. */
const SIZE_WEIGHTS: [number, number][] = [
  [1, 15],
  [2, 20],
  [3, 25],
  [4, 20],
  [5, 20],
];

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const OUTPUT_DIR = path.join(import.meta.dirname, ".output");
const SESSIONS_FILE = path.join(OUTPUT_DIR, "sessions.json");

// ------------------------------------------------------------------------------------ env

function loadRootEnv(): void {
  const file = path.join(REPO_ROOT, ".env");
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (copy .env.example to .env)`);
  return value;
}

/** LOAD_DATABASE_URL, or the dev URL with the database name swapped for hacker_house_load. */
function loadDatabaseUrl(): string {
  if (process.env.LOAD_DATABASE_URL) return process.env.LOAD_DATABASE_URL;
  const url = new URL(required("DATABASE_URL"));
  url.pathname = "/hacker_house_load";
  return url.toString();
}

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

// ------------------------------------------------------------------- deterministic random

/** mulberry32: tiny, fast, good enough for test data; the same seed → the same sequence. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const weighted = <T>(items: readonly (readonly [T, number])[]): T => {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let roll = next() * total;
    for (const [item, w] of items) {
      roll -= w;
      if (roll < 0) return item;
    }
    return items.at(-1)![0];
  };
  const shuffle = <T>(items: T[]): T[] => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  };
  return { next, int, pick, weighted, shuffle, chance: (p: number) => next() < p };
}

// -------------------------------------------------------------------------- data pools

// prettier-ignore
const FIRST = ["Aarav", "Asha", "Ben", "Chen", "Diya", "Elena", "Farah", "Gabriel", "Hana", "Ishaan", "Jonas", "Kavya", "Leo", "Maya", "Nikhil", "Olivia", "Priya", "Quinn", "Rohan", "Sara", "Tomás", "Uma", "Vikram", "Wei", "Yuki", "Zara"];
// prettier-ignore
const LAST = ["Agarwal", "Brown", "Costa", "Das", "Evans", "Fischer", "Gupta", "Haddad", "Ito", "Joshi", "Kim", "Lopez", "Mehta", "Nair", "Okafor", "Patel", "Rao", "Silva", "Tanaka", "Usman", "Verma", "Wang", "Yilmaz", "Zhou"];
// prettier-ignore
const ADJECTIVES = ["Rapid", "Quantum", "Silent", "Bright", "Clever", "Cosmic", "Crimson", "Electric", "Golden", "Hidden", "Iron", "Lucky", "Midnight", "Neon", "Nimble", "Orbit", "Pixel", "Rocket", "Shadow", "Solar", "Swift", "Turbo", "Velvet", "Wild"];
// prettier-ignore
const NOUNS = ["Otters", "Falcons", "Coders", "Builders", "Hackers", "Wizards", "Pandas", "Owls", "Foxes", "Rangers", "Pilots", "Makers", "Ninjas", "Comets", "Lynx", "Tigers", "Bytes", "Sparks", "Wolves", "Drifters"];
// prettier-ignore
const BLURBS = ["", "", "Building something fun this weekend.", "Looking for people who ship fast.", "AI-first idea, need a designer.", "Mobile app for local communities.", "Climate data dashboard.", "We have an idea and snacks."];
const TIMEZONES: [string, number][] = [
  ["Asia/Kolkata", 40],
  ["Europe/Berlin", 8],
  ["Europe/London", 8],
  ["America/New_York", 10],
  ["America/Los_Angeles", 7],
  ["Asia/Singapore", 6],
  ["Asia/Tokyo", 4],
  ["Australia/Sydney", 4],
  ["America/Sao_Paulo", 5],
  ["Africa/Lagos", 4],
  ["Asia/Dubai", 4],
];
// prettier-ignore
const SKILLS: Skill[] = ["FRONTEND", "BACKEND", "MOBILE", "AI_ML", "DATA", "DEVOPS_CLOUD", "UI_UX_DESIGN", "PRODUCT", "BLOCKCHAIN", "SECURITY", "HARDWARE_IOT", "GAME_DEV"];
const LEVELS: [number, number][] = [
  [1, 10],
  [2, 25],
  [3, 30],
  [4, 25],
  [5, 10],
];
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// ------------------------------------------------------------------------------- helpers

function chunks<T>(items: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Same format the app accepts (spike S6; tests/config/seed.ts). */
function sessionCookie(token: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

function step(label: string, startedAt: number): void {
  console.log(`  ${label.padEnd(34)} ${((performance.now() - startedAt) / 1000).toFixed(1)} s`);
}

// --------------------------------------------------------------------- database prepare

async function prepareDatabase(url: string): Promise<void> {
  const name = databaseName(url);
  if (!name.endsWith("_load")) {
    throw new Error(`Refusing to seed "${name}": the load database's name must end in "_load".`);
  }
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Unexpected database name "${name}".`);

  // Create it if missing (connected to the server's default "postgres" database).
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = createDbClient({ connectionString: adminUrl.toString(), poolMax: 1 });
  try {
    const exists = await admin.$queryRaw<{ one: number }[]>`
      SELECT 1 AS one FROM pg_database WHERE datname = ${name}`;
    if (exists.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); // name checked above
      console.log(`  created database ${name}`);
    }
  } finally {
    await admin.$disconnect();
  }

  // The same migrations production runs.
  const migrate = Bun.spawnSync([process.execPath, "x", "prisma", "migrate", "deploy"], {
    cwd: path.join(REPO_ROOT, "packages/db"),
    env: { ...process.env, DATABASE_URL: url },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (migrate.exitCode !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${migrate.stderr.toString()}`);
  }
}

async function emptyDatabase(db: DbClient): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE audit_logs, idempotency_keys, join_requests, invite_codes, teams, participants,
             hackathons, user_skills, session, account, verification, users
    RESTART IDENTITY CASCADE`);
}

// ---------------------------------------------------------------------------------- seed

type SeededUser = { id: string; timezone: string };
type TeamPlan = {
  name: string;
  description: string;
  joinPolicy: "OPEN" | "APPROVAL";
  access: "PUBLIC" | "INVITE_ONLY";
  isLooking: boolean;
  createdAt: Date;
  members: number[]; // indexes into the users array; [0] leads
};

async function main(): Promise<void> {
  const started = performance.now();
  loadRootEnv();
  const url = loadDatabaseUrl();
  const secret = required("BETTER_AUTH_SECRET");
  const random = createRandom(RANDOM_SEED);
  const now = Date.now();

  console.log(`Seeding ${databaseName(url)}: ${USERS} users, ${TEAMS} teams\n`);
  await prepareDatabase(url);
  const db = createDbClient({ connectionString: url, poolMax: 4, txTimeoutMs: 60_000 });

  try {
    await emptyDatabase(db);
    step("database ready (migrated, emptied)", started);

    // ---------------------------------------------------------------- users + accounts
    const passwordHash = await hashPassword(PASSWORD); // ONE scrypt hash for everyone (S6)
    const userRows = Array.from({ length: USERS }, (_, i) => {
      const first = random.pick(FIRST);
      const last = random.pick(LAST);
      const n = String(i + 1).padStart(5, "0");
      return {
        name: `${first} ${last}`,
        email: `load-user-${n}@load.test`, // lowercase, as Better Auth stores emails
        emailVerified: true,
        githubUsername: `${first}-${last}-${n}`
          .normalize("NFD")
          .replace(/[^a-zA-Z0-9-]/g, "")
          .toLowerCase(),
        timezone: random.weighted(TIMEZONES),
        portfolioUrl: random.chance(0.3) ? `https://portfolio.load.test/u${n}` : null,
      };
    });
    const users: SeededUser[] = [];
    for (const batch of chunks(userRows)) {
      users.push(
        ...(await db.user.createManyAndReturn({
          data: batch,
          select: { id: true, timezone: true },
        })),
      );
    }
    const [admin] = await db.user.createManyAndReturn({
      data: [
        { name: "Load Admin", email: "load-admin@load.test", emailVerified: true, role: "ADMIN" },
      ],
      select: { id: true },
    });
    const everyone = [...users.map((u) => u.id), admin!.id];
    for (const batch of chunks(everyone)) {
      await db.account.createMany({
        data: batch.map((id) => ({
          userId: id,
          accountId: id, // Better Auth's credential account: accountId = the user id
          providerId: "credential",
          password: passwordHash,
        })),
      });
    }
    step(`users + accounts (${users.length} + admin)`, started);

    // -------------------------------------------------------------------------- skills
    const skillRows = users.flatMap((user) =>
      random
        .shuffle([...SKILLS])
        .slice(0, random.int(1, 4))
        .map((skill) => ({ userId: user.id, skill, level: random.weighted(LEVELS) })),
    );
    for (const batch of chunks(skillRows, 5_000)) await db.userSkill.createMany({ data: batch });
    step(`skills (${skillRows.length})`, started);

    // ------------------------------------------------------------ hackathon + participants
    const hackathon = await db.hackathon.create({
      data: {
        name: "Load Jam",
        slug: SLUG,
        description: "Seeded for the load test (step 10.3).",
        minTeamSize: 1,
        maxTeamSize: MAX_TEAM_SIZE,
        createdByUserId: admin!.id,
        createdAt: new Date(now - 30 * DAY),
        updatedAt: new Date(now - 30 * DAY),
      },
    });
    // participantIds[i] belongs to users[i] (matched by user id, not by the returned order).
    const participantOf = new Map<string, string>();
    for (const batch of chunks(users)) {
      const rows = await db.participant.createManyAndReturn({
        data: batch.map((u) => ({
          userId: u.id,
          hackathonId: hackathon.id,
          createdAt: new Date(now - 30 * DAY + random.int(0, 14 * DAY)), // registered before teams
        })),
        select: { id: true, userId: true },
      });
      for (const row of rows) participantOf.set(row.userId, row.id);
    }
    const participantIds = users.map((u) => participantOf.get(u.id)!);
    step(`participants (${participantIds.length})`, started);

    // --------------------------------------------------------------------------- teams
    // Members: a shuffled slice of the users; the rest stay teamless (suggestion candidates).
    const order = random.shuffle(users.map((_, i) => i));
    let cursor = 0;
    const span = 14 * DAY;
    const plans: TeamPlan[] = Array.from({ length: TEAMS }, (_, i) => {
      const size = random.weighted(SIZE_WEIGHTS);
      const members = order.slice(cursor, cursor + size);
      cursor += size;
      return {
        // "#<n>" keeps names unique (case-insensitive index) and searchable (q=Rocket).
        name: `${random.pick(ADJECTIVES)} ${random.pick(NOUNS)} ${i + 1}`,
        description: random.pick(BLURBS),
        joinPolicy: random.chance(0.5) ? "OPEN" : "APPROVAL",
        access: random.chance(0.8) ? "PUBLIC" : "INVITE_ONLY",
        isLooking: random.chance(0.85),
        // Distinct times over 14 days, oldest first; ms jitter inside each slot.
        createdAt: new Date(now - span + Math.floor((i * span) / TEAMS) + random.int(0, 999)),
        members,
      };
    });
    const teamless = order.slice(cursor);
    if (teamless.length < 1_000) throw new Error("Team sizes used up almost every user.");

    const teamIds: string[] = [];
    for (const batch of chunks(plans, 250)) {
      // One transaction per batch: the leader FK is DEFERRED (checked at COMMIT), so teams and
      // their members' team_id must land together.
      const ids = await db.$transaction(async (tx) => {
        const teams = await tx.team.createManyAndReturn({
          data: batch.map((plan) => ({
            hackathonId: hackathon.id,
            name: plan.name,
            description: plan.description,
            joinPolicy: plan.joinPolicy,
            access: plan.access,
            isLooking: plan.isLooking,
            leaderParticipantId: participantIds[plan.members[0]!]!,
            memberCount: plan.members.length,
            maxSize: MAX_TEAM_SIZE,
            createdAt: plan.createdAt,
            updatedAt: plan.createdAt,
          })),
          select: { id: true, name: true },
        });
        const idByName = new Map(teams.map((t) => [t.name, t.id])); // names are unique
        const batchIds = batch.map((plan) => idByName.get(plan.name)!);
        // Members joined in order after the team was created (the leader at creation).
        const pids: string[] = [];
        const tids: string[] = [];
        const joined: string[] = [];
        batch.forEach((plan, b) => {
          const created = plan.createdAt.getTime();
          const room = Math.max(0, now - created - 10 * 60_000); // everyone joined before now
          plan.members.forEach((member, k) => {
            pids.push(participantIds[member]!);
            tids.push(batchIds[b]!);
            const later =
              k === 0 ? 0 : Math.min(room, k * 60_000 + random.int(0, Math.floor(room / 2)));
            joined.push(new Date(created + later).toISOString());
          });
        });
        await tx.$executeRaw`
          UPDATE participants AS p SET team_id = v.team_id, team_joined_at = v.joined_at
          FROM unnest(${pids}::uuid[], ${tids}::uuid[], ${joined}::timestamptz[])
            AS v(participant_id, team_id, joined_at)
          WHERE p.id = v.participant_id`;
        return batchIds;
      });
      teamIds.push(...ids);
    }
    step(`teams (${teamIds.length}) + memberships`, started);

    // ---------------------------------------------------------------------- invite codes
    const usedCodes = new Set<string>();
    const codeRows = plans.map((plan, i) => {
      let code: string;
      do {
        code = Array.from({ length: 10 }, () => CROCKFORD[random.int(0, 31)]).join("");
      } while (usedCodes.has(code));
      usedCodes.add(code);
      return {
        teamId: teamIds[i]!,
        code,
        createdByUserId: users[plan.members[0]!]!.id,
        createdAt: plan.createdAt,
        expiresAt: new Date(now + 7 * DAY),
      };
    });
    for (const batch of chunks(codeRows)) await db.inviteCode.createMany({ data: batch });
    step(`invite codes (${codeRows.length})`, started);

    // --------------------------------------------------------------------- join requests
    // Pending requests from teamless people to APPROVAL teams with a free seat.
    const askable = plans
      .map((plan, i) => ({ plan, id: teamIds[i]! }))
      .filter(({ plan }) => plan.joinPolicy === "APPROVAL" && plan.members.length < MAX_TEAM_SIZE);
    const requestRows: {
      hackathonId: string;
      participantId: string;
      teamId: string;
      createdAt: Date;
    }[] = [];
    for (const person of teamless) {
      const count = random.weighted([
        [0, 50],
        [1, 30],
        [2, 15],
        [3, 5],
      ] as const);
      const targets = new Set<number>();
      while (targets.size < count) targets.add(random.int(0, askable.length - 1));
      for (const t of targets) {
        const { plan, id } = askable[t]!;
        requestRows.push({
          hackathonId: hackathon.id,
          participantId: participantIds[person]!,
          teamId: id,
          createdAt: new Date(
            plan.createdAt.getTime() +
              random.int(60_000, Math.max(60_000, now - plan.createdAt.getTime() - 60_000)),
          ),
        });
      }
    }
    for (const batch of chunks(requestRows)) await db.joinRequest.createMany({ data: batch });
    step(`join requests (${requestRows.length})`, started);

    // -------------------------------------------------------------------------- sessions
    const tokens = users.map(() => randomBytes(24).toString("hex"));
    const expiresAt = new Date(now + SESSION_DAYS * DAY);
    for (const batch of chunks(
      users.map((u, i) => ({ userId: u.id, token: tokens[i]!, expiresAt })),
    )) {
      await db.session.createMany({ data: batch });
    }
    const cookies = tokens.map((token) => sessionCookie(token, secret));
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(SESSIONS_FILE, JSON.stringify(cookies));
    step(`sessions (${cookies.length}) → sessions.json`, started);

    // ----------------------------------------------------------------------- self-check
    await selfCheck(db, {
      secret,
      hackathonId: hackathon.id,
      expected: {
        users: USERS + 1,
        participants: USERS,
        teams: TEAMS,
        inTeams: plans.reduce((sum, p) => sum + p.members.length, 0),
        inviteCodes: TEAMS,
        joinRequests: requestRows.length,
        sessions: USERS,
      },
      sampleCookies: Array.from({ length: 5 }, () => random.pick(cookies)),
    });

    const listed = plans.filter((p) => p.isLooking && p.members.length < MAX_TEAM_SIZE).length;
    console.log(`
Done in ${((performance.now() - started) / 1000).toFixed(1)} s
  hackathon       ${SLUG}  (team size 1–${MAX_TEAM_SIZE})
  people          ${plans.reduce((s, p) => s + p.members.length, 0)} in teams, ${teamless.length} without a team
  board           ${listed} listed teams (looking and not full) = ${Math.ceil(listed / 20)} pages of 20
  sessions        ${path.relative(REPO_ROOT, SESSIONS_FILE)} (${cookies.length} cookies, ${SESSION_DAYS} days)
  sign in by hand load-user-00001@load.test … load-user-${String(USERS).padStart(5, "0")}@load.test,
                  load-admin@load.test (ADMIN); password "${PASSWORD}"`);
  } finally {
    await db.$disconnect();
  }
}

async function selfCheck(
  db: DbClient,
  input: {
    secret: string;
    hackathonId: string;
    expected: Record<string, number>;
    sampleCookies: string[];
  },
): Promise<void> {
  const [counts] = await db.$queryRaw<Record<string, bigint>[]>`
    SELECT
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM participants WHERE hackathon_id = ${input.hackathonId}::uuid) AS participants,
      (SELECT count(*) FROM teams) AS teams,
      (SELECT count(*) FROM participants WHERE team_id IS NOT NULL) AS "inTeams",
      (SELECT count(*) FROM invite_codes WHERE revoked_at IS NULL) AS "inviteCodes",
      (SELECT count(*) FROM join_requests WHERE status = 'PENDING') AS "joinRequests",
      (SELECT count(*) FROM session) AS sessions`;
  const wrong = Object.entries(input.expected).filter(([key, n]) => Number(counts![key]) !== n);
  if (wrong.length > 0) {
    throw new Error(
      `Counts don't match: ${wrong.map(([k, n]) => `${k} ${counts![k]} (expected ${n})`).join(", ")}`,
    );
  }
  // member_count must equal the real number of members, for every team.
  const drift = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM teams t
    WHERE t.member_count <> (SELECT count(*) FROM participants p WHERE p.team_id = t.id)`;
  if (Number(drift[0]!.n) !== 0) throw new Error(`${drift[0]!.n} teams have a wrong member_count`);

  // The cookies k6 will send: checked by Better Auth itself, so a format change on an upgrade
  // fails HERE, not as 10,000 confusing 401s in the load test.
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: input.secret,
    database: prismaAdapter(db, { provider: "postgresql" }),
    advanced: { database: { generateId: false } },
    logger: { disabled: true },
  });
  for (const cookie of input.sampleCookies) {
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!session) throw new Error("Better Auth rejected a seeded session cookie.");
  }
  const tampered = input.sampleCookies[0]!.replace(/.{4}$/, "AAAA");
  if (await auth.api.getSession({ headers: new Headers({ cookie: tampered }) })) {
    throw new Error("Better Auth accepted a TAMPERED cookie: the check above proves nothing.");
  }
  console.log(
    `  self-check: counts, member_count, ${input.sampleCookies.length} cookies via getSession ✓`,
  );
}

main().catch((error: unknown) => {
  console.error(`\nSeed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
