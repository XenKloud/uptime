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
