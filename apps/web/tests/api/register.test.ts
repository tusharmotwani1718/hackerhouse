import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { db, migrateTestDb, resetDb } from "../config/db";
import { assertTestDatabase } from "../config/env";
import { api } from "../config/http";
import { createHackathon, completeProfiles, createUsers } from "../config/seed";
import { startApp } from "../config/server";

let stopApp: (() => Promise<void>) | undefined;

beforeAll(async () => {
  assertTestDatabase(); //check we are not into main db
  migrateTestDb();
  stopApp = await startApp(); // start an app instance
}, 120_000); // starting the app may take some time

afterAll(async () => {
  await stopApp?.(); // stopApp could be undefined
  await db.$disconnect();
});

beforeEach(resetDb);

test("complete profile -> 201, one participant row, one audit row", async () => {
  // create the environment for the test
  const hackathon = await createHackathon(4);
  const [user] = await createUsers(1, "register");
  await completeProfiles([user!]);

  const res = await api("POST", `/api/hackathons/${hackathon.slug}/register`, {
    cookie: user?.cookie,
  });

  // assert the response:
  expect(res.status).toBe(201);
  expect(res.data.registered).toBe(true);

  // assert the db
  expect(
    await db.participant.count({ where: { userId: user!.id, hackathonId: hackathon.id } }),
  ).toBe(1);
  expect(
    await db.auditLog.count({
      where: { action: "PARTICIPANT_REGISTERED", hackathonId: hackathon.id },
    }),
  ).toBe(1);
});

test("registering twice → 409 ALREADY_REGISTERED, still one row", async () => {
  const hackathon = await createHackathon(4);
  const [user] = await createUsers(1, "register");
  await completeProfiles([user!]);

  // register for the first time:
  const first = await api("POST", `/api/hackathons/${hackathon.slug}/register`, {
    cookie: user!.cookie,
  });

  expect(first.status).toBe(201); // precondition: the first registration really happened

  // register same user for the second time:
  const registerUserAgain = await api("POST", `/api/hackathons/${hackathon.slug}/register`, {
    cookie: user!.cookie
  });


  // assert the response:
  expect(registerUserAgain.status).toBe(409);
  expect(registerUserAgain.error?.code).toBe("ALREADY_REGISTERED");

  // assert the db:
  expect(
    await db.participant.count({ where: { userId: user?.id, hackathonId: hackathon.id } }),
  ).toBe(1);
});
