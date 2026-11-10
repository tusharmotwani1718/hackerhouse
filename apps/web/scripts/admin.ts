/**
 * Admin CLI (step 1.2). The only way to create admins or change roles (R14) — never via the API.
 *
 *   bun run admin <command> [options]      (from the repo root)
 *
 * Standalone on purpose: it does not import the app's `server/*` modules (server-only, need
 * Next). It uses @hacker-house/db + Better Auth's own hashPassword, so hashes match sign-in.
 */
import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";

import { createDbClient, Prisma, type AuditAction } from "@hacker-house/db";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";

const USAGE = `Usage: bun run admin <command> [options]

Commands:
  create          --email <e> --name <n>   Create a new ADMIN account
  promote         --email <e>              Make an existing user ADMIN
  demote          --email <e>              Make an ADMIN a regular USER (never the last admin)
  list                                     List all admins
  reset-password  --email <e>              Set a new password and sign the user out everywhere

Options:
  --password-stdin   Read the password from standard input instead of prompting
  -h, --help         Show this help

Passwords are never accepted as command-line arguments (shell history, process list).`;

class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- env + db

/** Same single env source as the app: the repo-root .env (process env wins). */
function loadRootEnv() {
  const file = path.resolve(import.meta.dirname, "../../../.env");
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (!URL.canParse(url) || !["postgres:", "postgresql:"].includes(new URL(url).protocol)) {
    throw new CliError("DATABASE_URL is missing or invalid (copy .env.example to .env).");
  }
  return url;
}

// ---------------------------------------------------------------- input rules (same as sign-up)

const emailSchema = z
  .string({ error: "--email is required" })
  .trim()
  .toLowerCase() // Better Auth stores emails lowercased; scripts must match (07 §6, 1.1)
  .pipe(z.email({ error: "--email must be a valid email address" }));
const nameSchema = z
  .string({ error: "--name is required" })
  .trim()
  .min(1, { error: "--name must be 1-80 characters" })
  .max(80, { error: "--name must be 1-80 characters" });
const passwordSchema = z
  .string()
  .min(8, { error: "Password must be at least 8 characters" })
  .max(128, { error: "Password must be at most 128 characters" });

function check<T>(schema: z.ZodType<T>, value: unknown, exitCode = 2): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CliError(result.error.issues[0]!.message, exitCode);
  return result.data;
}

// ---------------------------------------------------------------- password input

/** Read one line from the terminal without echoing it. */
function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          return reject(new CliError("Cancelled.", 130));
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, ""); // drop one trailing newline
}

async function readNewPassword(fromStdin: boolean): Promise<string> {
  if (fromStdin) return check(passwordSchema, await readStdin(), 1);
  if (!process.stdin.isTTY) {
    throw new CliError("No terminal to prompt on. Pipe the password with --password-stdin.", 2);
  }
  const first = check(passwordSchema, await promptHidden("New password: "), 1);
  const second = await promptHidden("Repeat password: ");
  if (first !== second) throw new CliError("Passwords do not match.");
  return first;
}

// ---------------------------------------------------------------- commands

type Db = ReturnType<typeof createDbClient>;
type Options = { email?: string; name?: string; "password-stdin"?: boolean };

const LOCK_TIMEOUT = "SET LOCAL lock_timeout = '5s'";

function osUser(): string {
  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
}

/**
 * Audit row for a CLI action (step 3.1, D4), written in the action's own transaction.
 * No hackathon, no signed-in actor (NULL = CLI), no request id; `osUser` says who ran it.
 * Same columns as the app's writeAudit, which this script can't import (server-only).
 */
async function auditCli(
  tx: Prisma.TransactionClient,
  action: Extract<
    AuditAction,
    "ADMIN_CREATED" | "USER_PROMOTED" | "USER_DEMOTED" | "PASSWORD_RESET"
  >,
  targetUserId: string,
  metadata: Record<string, string | number>,
) {
  await tx.auditLog.create({
    data: {
      action,
      hackathonId: null,
      actorUserId: null,
      targetUserId,
      requestId: null,
      metadata: { via: "cli", osUser: osUser(), ...metadata },
    },
  });
}

async function findUser(db: Db, email: string) {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new CliError(`No user with email ${email}.`);
  return user;
}

async function create(db: Db, options: Options) {
  const email = check(emailSchema, options.email);
  const name = check(nameSchema, options.name);
  if (await db.user.findUnique({ where: { email } })) {
    throw new CliError(`${email} already exists. Use: bun run admin promote --email ${email}`);
  }
  const password = await readNewPassword(Boolean(options["password-stdin"]));
  const hash = await hashPassword(password); // scrypt (~70 ms) — before the transaction, not inside

  try {
    // One transaction: user + credential account + audit row exist together or not at all.
    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { email, name, role: "ADMIN" } });
      await tx.account.create({
        data: {
          userId: created.id,
          accountId: created.id,
          providerId: "credential",
          password: hash,
        },
      });
      await auditCli(tx, "ADMIN_CREATED", created.id, { email });
      return created;
    });
    console.log(`✔ Created admin ${user.email} (id ${user.id})`);
  } catch (error) {
    // Someone created the same email between our check and the insert.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new CliError(`${email} already exists. Use: bun run admin promote --email ${email}`);
    }
    throw error;
  }
}

async function promote(db: Db, options: Options) {
  const email = check(emailSchema, options.email);
  const user = await findUser(db, email);
  // Conditional update instead of "read role, then update": if two promotes race, only the
  // one that actually changes the role gets count 1 and writes the audit row.
  const promoted = await db.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: user.id, role: "USER" },
      data: { role: "ADMIN" },
    });
    if (count === 1) await auditCli(tx, "USER_PROMOTED", user.id, { email });
    return count === 1;
  });
  if (!promoted) return console.log(`• ${email} is already an admin.`);
  console.log(`✔ ${email} is now an admin (effective on their next request).`);
}

async function demote(db: Db, options: Options) {
  const email = check(emailSchema, options.email);
  const testHoldMs = Number(process.env.HH_CLI_TEST_HOLD_MS ?? 0); // test aid: widen the race window

  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(LOCK_TIMEOUT);
    // Lock EVERY admin row (sorted → consistent lock order), then count. A concurrent demote
    // waits here; when it resumes, Postgres re-checks `role = 'ADMIN'` on rows changed in the
    // meantime, so it sees the new, smaller set. Count-then-update without the lock is
    // check-then-act: two demotes could both see "2 admins" and leave zero.
    const admins = await tx.$queryRaw<{ id: string; email: string }[]>`
      SELECT id, email FROM users WHERE role = 'ADMIN' ORDER BY id FOR UPDATE`;
    const target = admins.find((admin) => admin.email === email);
    if (!target) {
      const exists = await tx.user.findUnique({ where: { email } });
      throw new CliError(exists ? `${email} is not an admin.` : `No user with email ${email}.`);
    }
    if (admins.length <= 1) {
      throw new CliError(`${email} is the last admin; promote someone else first.`);
    }
    if (testHoldMs > 0) await new Promise((resolve) => setTimeout(resolve, testHoldMs));
    await tx.user.update({ where: { id: target.id }, data: { role: "USER" } });
    await auditCli(tx, "USER_DEMOTED", target.id, { email });
  });
  console.log(`✔ ${email} is now a regular user (effective on their next request).`);
}

async function list(db: Db) {
  const admins = await db.user.findMany({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { email: true, name: true, createdAt: true },
  });
  if (admins.length === 0) return console.log("No admins yet. Create one: bun run admin create");
  for (const admin of admins) {
    console.log(
      `${admin.email.padEnd(36)} ${admin.name.padEnd(24)} ${admin.createdAt.toISOString()}`,
    );
  }
  console.log(`${admins.length} admin(s).`);
}

async function resetPassword(db: Db, options: Options) {
  const email = check(emailSchema, options.email);
  const user = await findUser(db, email);
  const account = await db.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
  });
  if (!account) throw new CliError(`${email} has no password sign-in to reset.`);

  const password = await readNewPassword(Boolean(options["password-stdin"]));
  const hash = await hashPassword(password);

  // One transaction: new hash + every session revoked (a stolen cookie dies too) + audit row.
  const revoked = await db.$transaction(async (tx) => {
    await tx.account.update({ where: { id: account.id }, data: { password: hash } });
    const { count } = await tx.session.deleteMany({ where: { userId: user.id } });
    await auditCli(tx, "PASSWORD_RESET", user.id, { email, sessionsRevoked: count });
    return count;
  });
  console.log(`✔ Password reset for ${email}; signed out of ${revoked} session(s).`);
  console.log("  Ask them to change it after signing in (POST /api/auth/change-password).");
}

// ---------------------------------------------------------------- main

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        email: { type: "string" },
        name: { type: "string" },
        "password-stdin": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    console.error(`✖ ${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }

  const [command, ...extra] = parsed.positionals;
  if (parsed.values.help || !command) {
    console.log(USAGE);
    return command || parsed.values.help ? 0 : 2;
  }
  if (extra.length > 0) {
    console.error(`✖ Unexpected argument: ${extra[0]}\n\n${USAGE}`);
    return 2;
  }

  const commands: Record<string, (db: Db, options: Options) => Promise<void>> = {
    create,
    promote,
    demote,
    list,
    "reset-password": resetPassword,
  };
  const run = commands[command];
  if (!run) {
    console.error(`✖ Unknown command: ${command}\n\n${USAGE}`);
    return 2;
  }

  loadRootEnv();
  let db: Db | undefined;
  try {
    db = createDbClient({ connectionString: databaseUrl(), poolMax: 2 });
    await run(db, parsed.values);
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`✖ ${error.message}`);
      return error.exitCode;
    }
    console.error("✖ Unexpected error:", error);
    return 1;
  } finally {
    await db?.$disconnect();
  }
}

process.exitCode = await main();
