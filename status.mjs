// Builds the public status page (status.xenkloud.com) into _site/ from this repo's issues:
// "Down: <target>" issues opened and closed by check.mjs are the outage record, and issues labelled
// "incident", written by us, are the notes people read. Only the components in components.json are
// shown; customers' own sites are checked but never listed.
// Prints changed=true to $GITHUB_OUTPUT when the page differs from the live one, so it is published
// only then, not every 5 minutes.
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DAY = 86_400_000;
const DAYS = 90;
const STAFF = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const BOT = "github-actions[bot]";

/** Down minutes inside [from, to) for a list of [start, end] intervals, overlaps counted once. */
function downMs(intervals, from, to) {
  const cut = intervals
    .map(([s, e]) => [Math.max(s, from), Math.min(e, to)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [cs, ce] = [0, 0];
  for (const [s, e] of cut) {
    if (s > ce) {
      total += ce - cs;
      [cs, ce] = [s, e];
    } else ce = Math.max(ce, e);
  }
  return total + ce - cs;
}

/**
 * The page's data. An outage still going on counts up to the start of the current hour, so the
 * numbers (and the published page) change at most hourly while it lasts.
 */
export function buildStatus(config, issues, comments, now) {
  const today = Math.floor(now / DAY) * DAY;
  const hour = Math.floor(now / 3_600_000) * 3_600_000;
  const since = Date.parse(config.since);
  const outages = issues.filter((i) => i.user?.login === BOT && i.labels.some((l) => (l.name ?? l) === "down"));

  const components = config.components.map((c) => {
    const mine = outages.filter((i) => c.targets.some((t) => i.title === `Down: ${t}`));
    const intervals = mine.map((i) => [Date.parse(i.created_at), i.closed_at ? Date.parse(i.closed_at) : hour]);
    const days = [];
    for (let d = today - (DAYS - 1) * DAY; d <= today; d += DAY) {
      const date = new Date(d).toISOString().slice(0, 10);
      days.push(d < since ? { date } : { date, down_minutes: Math.round(downMs(intervals, d, d + DAY) / 60_000) });
    }
    const from = Math.max(since, today - (DAYS - 1) * DAY);
    const span = Math.max(hour - from, DAY);
    const uptime = Math.floor((1 - downMs(intervals, from, hour) / span) * 10_000) / 100;
    return { name: c.name, about: c.about, status: mine.some((i) => i.state === "open") ? "down" : "up", uptime, days };
  });

  const incidents = issues
    .filter((i) => i.labels.some((l) => (l.name ?? l) === "incident") && STAFF.has(i.author_association))
    .filter((i) => Date.parse(i.created_at) > today - DAYS * DAY)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((i) => ({
      title: i.title,
      state: i.state === "open" ? "investigating" : "resolved",
      started: i.created_at,
      resolved: i.closed_at,
      updates: [
        ...(i.body ? [{ at: i.created_at, text: i.body }] : []),
        ...(comments[i.number] ?? []).filter((c) => STAFF.has(c.author_association)).map((c) => ({ at: c.created_at, text: c.body })),
      ],
    }));

  return { region: config.region, since: config.since, components, incidents };
}

async function github(path) {
  const res = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function allIssues(label, since) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await github(`/issues?labels=${label}&state=all&since=${since}&per_page=100&page=${page}`);
    out.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return out;
}

async function live(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = JSON.parse(readFileSync("components.json", "utf8"));
  const since = new Date(Date.now() - DAYS * DAY).toISOString();
  const byNumber = new Map([...(await allIssues("down", since)), ...(await allIssues("incident", since))].map((i) => [i.number, i]));
  const issues = [...byNumber.values()];
  const comments = {};
  for (const i of issues.filter((i) => i.labels.some((l) => l.name === "incident") && i.comments > 0))
    comments[i.number] = await github(`/issues/${i.number}/comments?per_page=100`);

  const json = `${JSON.stringify(buildStatus(config, issues, comments, Date.now()), null, 1)}\n`;
  mkdirSync("_site", { recursive: true });
  writeFileSync("_site/status.json", json);
  copyFileSync("page/index.html", "_site/index.html");

  const base = process.env.STATUS_URL ?? "https://status.xenkloud.com";
  const changed = (await live(`${base}/status.json`)) !== json || (await live(`${base}/`)) !== readFileSync("page/index.html", "utf8");
  console.log(changed ? "status page changed: publishing" : "status page unchanged");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}
