// Checks every address in targets.json (and extra-targets.json) and keeps one open GitHub issue per
// address that is down: opened when it goes down, closed with a comment when it is back.
// Runs on GitHub Actions, outside the data centre it watches. Needs GITHUB_TOKEN and GITHUB_REPOSITORY.
import { existsSync, readFileSync } from "node:fs";

const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : []);
const targets = [...read("targets.json"), ...read("extra-targets.json")];
const LABEL = "down";

/** null when fine, otherwise what went wrong. Tries twice, 20 seconds apart, before calling it down. */
async function problem(t) {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, Number(process.env.RETRY_MS ?? 20_000)));
    try {
      const res = await fetch(t.url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
      const ok = t.expect === "healthy" ? res.status >= 200 && res.status < 300 : res.status < 500;
      if (ok) return null;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err.cause?.code ?? err.cause?.message ?? err.message;
    }
  }
  return last;
}

async function github(method, path, body) {
  const res = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const title = (t) => `Down: ${t.name}`;
const now = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

const results = await Promise.all(targets.map(async (t) => ({ t, problem: await problem(t) })));
const open = await github("GET", `/issues?state=open&labels=${LABEL}&per_page=100`);

for (const { t, problem: p } of results) {
  const issue = open.find((i) => i.title === title(t));
  console.log(`${p ? "DOWN" : "ok  "} ${t.name}${p ? `: ${p}` : ""}`);
  if (p && !issue) await github("POST", "/issues", { title: title(t), labels: [LABEL], body: `${t.url} stopped answering at ${now}.\n\nWhat we saw: ${p}` });
  if (!p && issue) {
    const minutes = Math.round((Date.now() - Date.parse(issue.created_at)) / 60_000);
    await github("POST", `/issues/${issue.number}/comments`, { body: `Back up at ${now}, after about ${minutes} minutes.` });
    await github("PATCH", `/issues/${issue.number}`, { state: "closed", state_reason: "completed" });
  }
}
