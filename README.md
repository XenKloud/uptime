# Xenkloud uptime

Checks every Xenkloud address every 5 minutes from GitHub, outside our data centre. When an address
stops answering, an issue titled "Down: <name>" opens (GitHub notifies you); when it answers again,
the issue is closed with how long it was down.

- `targets.json`: generated from the site manifests in the Platform repo. Refresh it after adding or
  removing a domain: `npx tsx scripts/uptime-targets.ts > ../uptime/targets.json` from the Platform repo.
- `extra-targets.json`: addresses that aren't in the manifests (Emit, CliniqSync). Edit by hand.
- `expect`: `up` means the server answered below 500 (a redirect or 404 still counts as up);
  `healthy` means a health route answered 2xx.

An address counts as down only after two failed tries 20 seconds apart, so a single slow answer
doesn't open an issue.

## Status page (status.xenkloud.com)

After each check, `status.mjs` rebuilds the public status page from the issues and publishes it to
GitHub Pages, only when something changed. It runs outside our servers, so it stays up when they don't.

- `components.json`: the services the page shows and which addresses each one covers. Customers' own
  sites are checked but never shown.
- Outages come from the "Down: …" issues the checker opens and closes. Nothing to do by hand.
- To tell people what's happening, open an issue with the label `incident`: its text and your comments
  appear on the page as updates; close it when it's resolved. Only issues and comments by the repo's
  owner or members appear.
- Tests: `node --test test/status.test.mjs`
