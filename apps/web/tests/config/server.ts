import { APP_DIR, AUTH_SECRET, BASE_URL, PORT, TEST_DATABASE_URL } from "./env";

/** Start the production build on PORT against the test DB. Returns a stop function. */
export async function startApp(): Promise<() => Promise<void>> {
  if (await isUp()) throw new Error(`Port ${PORT} is already in use; stop that process first.`);

  const proc = Bun.spawn([process.execPath, "x", "next", "start", "-p", String(PORT)], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL, // process env wins over .env (next.config.ts)
      BETTER_AUTH_URL: BASE_URL,
      BETTER_AUTH_SECRET: AUTH_SECRET, // explicit: must match the cookie signer
      LOG_LEVEL: "warn", // keep test output readable; errors still show
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    await waitUntilUp(60_000);
  } catch (error) {
    killTree(proc.pid);
    // The app's own output is the fastest way to see why it didn't start.
    console.error(await new Response(proc.stderr).text());
    throw error;
  }

  return async () => {
    killTree(proc.pid);
    await proc.exited;
  };
}

/**
 * Stop the server AND its children. `bun x next start` runs Next in a child `node` process;
 * on Windows, killing the parent leaves that child alive, still holding the port.
 */
function killTree(pid: number): void {
  if (process.platform === "win32") {
    Bun.spawnSync(["taskkill", "/pid", String(pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } else {
    process.kill(pid);
  }
}

/** "Up" = a real route answers. 401 is the expected answer: no cookie sent. */
async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/hackathons`);
    return res.status === 401;
  } catch {
    return false; // connection refused: not listening yet
  }
}

async function waitUntilUp(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp()) return;
    await Bun.sleep(250);
  }
  throw new Error(`App didn't answer on ${BASE_URL} within ${timeoutMs} ms`);
}
