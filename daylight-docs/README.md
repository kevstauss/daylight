# Daylight — documentation set (README)

A public, observational watchdog for federal `.gov` infrastructure: who owns it, what certificates it issues, what's tracking you on it, whether it filed the privacy paperwork the law requires, and what quietly changed or disappeared. Built on already-public data (Certificate Transparency logs, CISA's public registrant repo, live public page source). Same lane as EFF / The Markup / EPIC.

## What's in here

| File | What it is |
|------|-----------|
| `Daylight-PRD.md` | The product requirements doc (v2). Vision, findings brief, the six modules, deployment philosophy, guardrails, metrics, risks, roadmap. **Read this first.** |
| `Daylight-Phase-0-1-Build-Spec.md` | Engineering spec: Foundation (walking skeleton) + **Ledger** (registrant/contact watcher). Ships `v0.1`, `v0.2`. |
| `Daylight-Phase-2-Lookout-Build-Spec.md` | **Lookout** — certificate-transparency subdomain watcher. Ships `v0.3`. |
| `Daylight-Phase-3-Floodlight-Build-Spec.md` | **Floodlight** — tracker & session-replay scanner ("Blacklight for .gov"). Ships `v0.4`. |
| `Daylight-Phase-4-Receipts-Build-Spec.md` | **Receipts** — snapshot archive + removal ledger. Ships `v0.5`. |
| `Daylight-Phase-5-Redtape-Build-Spec.md` | **Redtape** — PIA/SORN gap-finder (AI agent + human gate). Ships `v0.6`. |
| `Daylight-Phase-6-Dashboard-Build-Spec.md` | **Daylight** — unified per-domain dashboard. Ships `v1.0`. |
| `config/watchlist.yaml` | Seed watchlist (verified against live data 2026-07-01) that drives every module. |

## Build order
`Phase 0 → 1 → 2 → 3 → 4 → 5 → 6`. Each phase deploys a **usable public product** — value at every step, not only at the end. Every phase ends live in production, tagged, with a plain-language `/changelog` entry.

## How to run this with Claude Code
1. Drop this whole folder at your repo root.
2. Point Code at `Daylight-PRD.md` + `Daylight-Phase-0-1-Build-Spec.md` and paste that spec's §7 kickoff prompt. Build + deploy `v0.1` (walking skeleton) and `v0.2` (Ledger).
3. Move to the next phase's spec; paste its kickoff prompt. Repeat through `v1.0`.
4. Each spec says "write the acceptance tests first" — hold Code to that; the tests are grounded in real fixtures.

## The one line you cannot cross
Everything is **observational, on public endpoints.** Noting that a certificate / subdomain / login page **exists** is fine. **Never** authenticate past any access wall (e.g. the `loveisaskill` Cloudflare Access gate), probe, scan, or crawl. Stay observational and the project is legally clean and press-credible — that's the whole strategy.

## Credit
Research + product design assisted by **Claude (Anthropic)**; tooling built with **Claude Code**. Suggested public line: *"Built with Claude Code. Research assisted by Claude (Anthropic)."* (Anthropic's Mythos/Fable tier isn't publicly available right now — build on current models and keep the Redtape agent model-agnostic so Fable can swap in later.)
