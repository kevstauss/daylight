# Daylight — Phase 5 Build Spec: **Redtape** (PIA/SORN gap-finder)
### Companion to `Daylight-PRD.md` v2 · engineering handoff for Claude Code · ships `v0.6`

**One line.** Automate the exact violation experts flagged: sites collecting PII with **no** published Privacy Impact Assessment (E-Gov Act §208) or System of Records Notice (Privacy Act) — cross-referencing collection evidence against filings, with an **AI research agent behind a human-approval gate** (your PLAINLY pattern).

**Flagship cases.** (1) The NDS tracking layer running with **no** PIA/SORN. (2) The Trump Accounts Treasury SORN that **exists but omits PostHog** — a filed-but-incomplete gap, not just a missing one. Redtape must distinguish these.

---

## 1. Scope & what ships
- New worker `workers/redtape` + an AI-agent module + a human review queue. Reuses `core/db/feeds`; consumes Floodlight/Receipts collection evidence.
- Ships: an **internal** review queue first, then a **public** human-reviewed gap list with evidence + negative-search trails. Tag `v0.6`.

## 2. Data sources
- **Federal Register API** (SORNs): `https://www.federalregister.gov/api/v1/documents.json?conditions[term]=<query>&conditions[type][]=NOTICE` (+ agency/date filters). Public JSON.
- **Agency PIA inventories** — scattered agency pages + a few central lists; scrape + normalize (the messy part; agent-assisted).
- **Collection evidence** — from Floodlight (`forms`, trackers) + Receipts (form fields) for watchlist sites.

## 3. Schema additions
```sql
CREATE TABLE gaps (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL, url TEXT,
  collects_pii_evidence_json TEXT,     -- what/where we saw collection
  pia_found BOOLEAN, pia_refs_json TEXT,
  sorn_found BOOLEAN, sorn_refs_json TEXT,
  queries_run_json TEXT,               -- the exact searches (makes the NEGATIVE checkable)
  sources_checked_json TEXT,
  gap_assessment TEXT,                 -- 'no_filing' | 'incomplete_filing' | 'covered'
  confidence REAL,
  fact_vs_inference_notes TEXT,
  human_reviewed BOOLEAN DEFAULT FALSE,
  reviewer_note TEXT,
  published BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL
);
```

## 4. Core logic (agent + gate)
1. **Candidates** = watchlist sites where Floodlight/Receipts detected PII collection or tracking.
2. **AI research agent** (Claude via the Anthropic API; model-agnostic behind an interface — Opus/Sonnet now, Fable swappable later). For each candidate it: queries the Federal Register API for matching SORNs; searches PIA inventories; returns **either** filing refs **or** a documented "no filing found" with **the exact queries run and sources checked**. It must classify `gap_assessment ∈ {no_filing, incomplete_filing, covered}` and label every statement fact vs inference with a confidence.
   - **Structured output contract:** the agent returns **JSON only** (no prose, no markdown fences). Parse safely; on malformed output, retry once then queue for manual handling. Shape:
     ```json
     { "pia_found": false, "pia_refs": [], "sorn_found": true, "sorn_refs": ["FR 2026-..."],
       "gap_assessment": "incomplete_filing", "confidence": 0.7,
       "queries_run": ["..."], "sources_checked": ["federalregister.gov/...","dhs.gov/pia..."],
       "fact_vs_inference_notes": "SORN exists but does not enumerate the analytics processor (inference)." }
     ```
3. **Human approval gate (mandatory).** Agent output lands in `gaps` with `human_reviewed=false, published=false` → shows in the **internal review queue**. A human edits/approves/rejects. **Only `human_reviewed=true AND published=true` is ever served publicly** — enforce this in the DB query layer, not just the UI.
4. Re-sweep monthly + on newly-detected collection.

## 5. UI surfaces
- **Internal (5a):** `/review` queue — candidate, agent findings, evidence, the query trail; approve/edit/reject controls. Auth-gated, not public.
- **Public (5b):** `/redtape` — reviewed gap list; each entry shows (a) **collection evidence** and (b) the **negative-search trail** (queries run + sources checked) so a stranger can re-verify the absence. Copy is maximally careful: *"No published PIA was found as of {date}; searches below,"* never "illegal." Distinguish `no_filing` vs `incomplete_filing` clearly.
- Feeds `/redtape/feed.*` — newly-published reviewed gaps only.

## 6. Deployable sub-increments
**5a** agent + internal review queue (internal-only deploy) → **5b** public reviewed gap list. Tag `v0.6` at 5b.

## 7. Fixtures & acceptance tests
1. **No false gap:** a candidate with a known real SORN → pipeline finds + links it → `gap_assessment='covered'`, not published as a gap.
2. **Incomplete filing:** the Trump Accounts case (SORN exists, omits the analytics processor) → `incomplete_filing` with refs + the specific omission noted.
3. **No filing:** a candidate with collection + no PIA/SORN → `no_filing` with evidence + query trail.
4. **Hard gate (critical):** an unreviewed `gaps` row is **never** returned by the public route — test the query filter directly (`published AND human_reviewed`).
5. **Agent robustness:** malformed/non-JSON agent output → safe handling (retry once, then manual queue), no crash, nothing auto-published.
6. Every public gap carries a non-empty `queries_run` + `sources_checked`.

## 8. Guardrails
- Legal-adjacent claims → maximally careful, dated, evidence-linked copy; never "illegal."
- **Human gate enforced at the data layer.** Nothing agent-generated reaches the public without human approval.
- Fact/inference labels preserved end-to-end; the agent must cite sources or explicitly report none.
- Model-agnostic agent interface; keep prompts + output schema versioned.

## 9. Kickoff prompt
```
Build Phase 5 (Redtape) of Daylight. Read the PRD + prior specs + this file. New worker
workers/redtape with an AI research agent (Claude via Anthropic API, model-agnostic behind an
interface) + a human review gate. Candidates come from Floodlight/Receipts collection evidence. The
agent queries the Federal Register API for SORNs and PIA inventories and returns JSON ONLY:
filing refs OR a documented "no filing found" with the exact queries_run + sources_checked, plus a
gap_assessment of no_filing|incomplete_filing|covered and fact/inference notes. ENFORCE the human
gate at the DB query layer: only human_reviewed AND published rows are ever public. Write §7 tests
first — especially the "no false gap" and "unreviewed never public" cases, and the Trump-Accounts
incomplete-filing case. Copy is dated + evidence-linked, never "illegal." Ship 5a (internal) → 5b
(public); tag v0.6.
```
