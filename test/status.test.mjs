import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStatus } from "../status.mjs";

const config = {
  since: "2026-11-20",
  region: "Canada",
  components: [
    { name: "Sites", about: "Hosting", targets: ["sites api health", "api.xenkloud.com"] },
    { name: "Console", about: "Console", targets: ["console.xenkloud.com"] },
  ],
};
const bot = { login: "github-actions[bot]" };
const down = (n, target, from, to) => ({
  number: n, title: `Down: ${target}`, user: bot, labels: [{ name: "down" }], author_association: "NONE",
  state: to ? "closed" : "open", created_at: from, closed_at: to ?? null,
});
const now = Date.parse("2026-11-26T15:20:00Z");

test("overlapping outages of one component count once, and days before monitoring have no data", () => {
  const s = buildStatus(config, [
    down(1, "sites api health", "2026-11-25T10:00:00Z", "2026-11-25T10:30:00Z"),
    down(2, "api.xenkloud.com", "2026-11-25T10:10:00Z", "2026-11-25T10:40:00Z"),
  ], {}, now);
  const sites = s.components[0];
  assert.equal(sites.status, "up");
  assert.equal(sites.days.length, 90);
  assert.deepEqual(sites.days.at(-2), { date: "2026-11-25", down_minutes: 40 });
  assert.equal(sites.days.at(-8).down_minutes, undefined, "Nov 19 is before monitoring");
  assert.equal(sites.days.at(-7).down_minutes, 0);
  assert.ok(sites.uptime < 100 && sites.uptime > 99);
  assert.equal(s.components[1].uptime, 100);
});

test("an outage still going on shows as down and counts only up to the current hour", () => {
  const a = buildStatus(config, [down(3, "console.xenkloud.com", "2026-11-26T14:30:00Z")], {}, now);
  const b = buildStatus(config, [down(3, "console.xenkloud.com", "2026-11-26T14:30:00Z")], {}, now + 20 * 60_000);
  assert.equal(a.components[1].status, "down");
  assert.equal(a.components[1].days.at(-1).down_minutes, 30);
  assert.deepEqual(a, b, "no change within the hour, so nothing is republished");
});

test("customer sites and issues from outsiders never reach the page", () => {
  const s = buildStatus(config, [
    down(4, "trsupplements.ca", "2026-11-26T10:00:00Z"),
    { ...down(5, "console.xenkloud.com", "2026-11-26T10:00:00Z"), user: { login: "someone" } },
    { number: 6, title: "Spam", labels: [{ name: "incident" }], author_association: "NONE", state: "open", created_at: "2026-11-26T10:00:00Z" },
    { number: 7, title: "Sites deploys are slow", body: "Looking into it.", labels: [{ name: "incident" }], author_association: "OWNER", state: "closed", created_at: "2026-11-26T10:00:00Z", closed_at: "2026-11-26T11:00:00Z" },
  ], { 7: [{ author_association: "OWNER", created_at: "2026-11-26T11:00:00Z", body: "Fixed." }, { author_association: "NONE", created_at: "2026-11-26T11:01:00Z", body: "spam" }] }, now);
  assert.ok(s.components.every((c) => c.status === "up" && c.uptime === 100));
  assert.ok(!JSON.stringify(s).includes("trsupplements"));
  assert.equal(s.incidents.length, 1);
  assert.equal(s.incidents[0].state, "resolved");
  assert.deepEqual(s.incidents[0].updates.map((u) => u.text), ["Looking into it.", "Fixed."]);
});
