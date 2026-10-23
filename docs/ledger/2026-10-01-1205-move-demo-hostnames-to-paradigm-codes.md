# 2026-10-01 12:05 CDT - move demo hostnames to paradigm.codes
- **Who:** Claude (subagent of the main session), for Drew, who authorized the move on 2026-10-01.
- **Change:** verifierConfigFromEnv fallbacks now name the live values (JWKS on portal.paradigm.codes, issuer auth.paradigm.codes) instead of portal.projectnexuscode.org; SITE_URL, footer and banner links, and verify/smoke.yml deploy_url move to paradigm.codes.
- **Why:** projectnexuscode.org lapses around 2026-10-31. The demos move to <name>.paradigm.codes additively: both names serve, then the legacy names 301, then they are removed. Sequencing is in cloudflare-config docs/demos/MIGRATE_TO_PARADIGM_CODES_2026-10.md.
- **State after:** Not merged or deployed. Production sets the PORTAL_* env explicitly, so the fallback change only matters for a container started without them, which would otherwise reject every token once the old domain lapses. Merge after the new host is live (smoke.yml targets it). vitest and next build pass.
- **Refs:** cloudflare-config docs/demos/MIGRATE_TO_PARADIGM_CODES_2026-10.md (runbook, step 3).
