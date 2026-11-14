// GET/PATCH /api/me: my profile. Completeness (GitHub username + one skill) gates registering.
import { expect, test } from "bun:test";

import { db } from "../config/db";
import { api } from "../config/http";
import { createUsers } from "../config/seed";
import { withTestApp } from "../config/suite";

withTestApp();

const patch = (cookie: string, body: unknown) => api("PATCH", "/api/me", { cookie, body });

test("a new user: incomplete profile, says what's missing; no cookie → 401", async () => {
  const [me] = await createUsers(1, "fresh");

  const res = await api("GET", "/api/me", { cookie: me!.cookie });
  const anon = await api("GET", "/api/me", { cookie: null });

  expect(res.status).toBe(200);
  expect(res.data).toMatchObject({
    id: me!.id,
    email: me!.email,
    role: "USER",
    githubUsername: null,
    githubVerified: false,
    skills: {},
    profileComplete: false,
    missing: ["githubUsername", "skills"],
  });
  expect(anon.status).toBe(401);
});

test("PATCH fills the profile: values normalized, complete afterwards", async () => {
  const [me] = await createUsers(1, "fill");

  const res = await patch(me!.cookie, {
    name: "  Asha Rao  ",
    githubUsername: "@Asha-Rao", // "@" dropped, lowercased
    portfolioUrl: "https://asha.dev",
    timezone: "europe/berlin", // stored in its canonical IANA spelling
    skills: { FRONTEND: 4, AI_ML: 2 },
  });

  expect(res.status).toBe(200);
  expect(res.data).toMatchObject({
    name: "Asha Rao",
    githubUsername: "asha-rao",
    portfolioUrl: "https://asha.dev",
    timezone: "Europe/Berlin",
    skills: { FRONTEND: 4, AI_ML: 2 },
    profileComplete: true,
    missing: [],
  });
  // GET returns the same thing: it was stored, not just echoed.
  const again = await api("GET", "/api/me", { cookie: me!.cookie });
  expect(again.data).toEqual(res.data);
});

test("skills: the PATCH replaces the whole set; level 0 removes one", async () => {
  const [me] = await createUsers(1, "skills");
  await patch(me!.cookie, { skills: { FRONTEND: 4, BACKEND: 3 } });

  const res = await patch(me!.cookie, { skills: { BACKEND: 0, DATA: 5 } });

  expect(res.status).toBe(200);
  expect(res.data.skills).toEqual({ DATA: 5 }); // FRONTEND gone (not sent), BACKEND removed (0)
  expect(await db.userSkill.count({ where: { userId: me!.id } })).toBe(1);
});

test("a partial PATCH leaves other fields alone; portfolio null clears it", async () => {
  const [me] = await createUsers(1, "partial");
  await patch(me!.cookie, { githubUsername: "keep-me", portfolioUrl: "https://a.dev" });

  const res = await patch(me!.cookie, { portfolioUrl: null });

  expect(res.data).toMatchObject({ githubUsername: "keep-me", portfolioUrl: null });
});

test("invalid PATCHes → 400 naming the field; nothing changes", async () => {
  const [me] = await createUsers(1, "invalid");
  await patch(me!.cookie, { githubUsername: "set-once", skills: { BACKEND: 3 } });

  const cases: [unknown, string][] = [
    [{}, "(root)"], // nothing to update
    [{ githubUsername: null }, "githubUsername"], // can't clear once set: it gates registering
    [{ githubUsername: "-bad-" }, "githubUsername"],
    [{ githubUsername: "x".repeat(40) }, "githubUsername"],
    [{ skills: { BACKEND: 0 } }, "skills"], // at least one skill must stay
    [{ skills: { COOKING: 3 } }, "skills"], // an unknown key is reported on the record itself
    [{ skills: { BACKEND: 6 } }, "skills.BACKEND"],
    [{ portfolioUrl: "http://plain.dev" }, "portfolioUrl"], // https only
    [{ portfolioUrl: "javascript:alert(1)" }, "portfolioUrl"],
    [{ timezone: "Mars/Olympus" }, "timezone"],
    [{ name: "" }, "name"],
  ];
  for (const [body, field] of cases) {
    const res = await patch(me!.cookie, body);
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(res.error?.code).toBe("VALIDATION_FAILED");
    const paths = (res.error?.details as { path: string }[]).map((d) => d.path);
    expect(paths, JSON.stringify(body)).toContain(field);
  }
  const after = await api("GET", "/api/me", { cookie: me!.cookie });
  expect(after.data).toMatchObject({ githubUsername: "set-once", skills: { BACKEND: 3 } });
});

test("can't make yourself admin or change your email: unknown fields are rejected", async () => {
  const [me] = await createUsers(1, "sneaky");

  for (const body of [
    { role: "ADMIN" },
    { email: "boss@test.local" },
    { name: "Me", role: "ADMIN" },
  ]) {
    const res = await patch(me!.cookie, body);
    expect([res.status, res.error?.code]).toEqual([400, "VALIDATION_FAILED"]);
  }
  const row = await db.user.findUniqueOrThrow({ where: { id: me!.id } });
  expect(row.role).toBe("USER");
  expect(row.email).toBe(me!.email);
});
