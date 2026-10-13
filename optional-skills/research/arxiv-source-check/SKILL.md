---
name: arxiv-source-check
description: Verify figure and table counts against arXiv sources.
version: 1.0.0
author: Moshi Karim (@EchoMosh), Hermes Agent
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [research, arxiv, source-verification, liteparse]
    category: research
    related_skills: [arxiv, grounded-citations]
    requires_toolsets: [terminal]
required_environment_variables:
  - name: OPENROUTER_API_KEY
    prompt: OpenRouter key for optional focused source review
    help: https://openrouter.ai/settings/keys
    required_for: Optional paid review only; acquisition and offline checks need no key.
---

# arXiv Source Check Skill

Verifies separately captioned figures and tables in one versioned arXiv
manuscript, split into main text and appendix. It binds original HTML identities
to PDF text and preserves evidence; it does not assess paper relevance or verify
an entire research report.

## When to Use

- Research requires defensible figure/table counts from a pinned original paper.
- A supplied count needs an independent check against source captions.
- Saved originals and a source-bound LiteParse extraction need offline validation.

## Prerequisites

- Python 3.10+ and native Hermes `skill_view` and `terminal` tools.
- LiteParse CLI available in the execution backend for new PDF extraction and
  optional page screenshots. Supply its executable with `--lit-bin` if needed.
  Saved extraction JSON and receipts can be checked without LiteParse installed.
- Network access to arxiv.org for acquisition; `--offline` uses only saved files.
- A versioned arXiv ID chosen from the original source and a separate evidence
  directory for each paper. All paths must be accessible to the same backend.
- Optional live review requires an existing `OPENROUTER_API_KEY`, a chosen vision
  model, a conservative call estimate, a shared ledger, and user authorization
  for paid calls. A credential alone never enables review.

Install with `hermes skills install official/research/arxiv-source-check`.
Its focused-review ledger uses POSIX
`fcntl` locking; Windows is unsupported.

## How to Run

Load the complete instructions with `skill_view(name="arxiv-source-check")`.
Resolve `scripts/source_check.py` relative to the skill directory returned by
`skill_view`, then run it through `terminal`:

```bash
python3 /absolute/skill/path/scripts/source_check.py \
  --pin VERSIONED_ARXIV_ID --output-dir /absolute/evidence/paper \
  --run-id RESEARCH_RUN_ID
```

The helper fetches versioned HTML/PDF originals, saves hashes and receipts,
parses the PDF once using LiteParse JSON with OCR disabled, and writes
`inventory.json`. Reuse those files for subsequent inspection.

For saved originals, pass every provenance input explicitly:

```bash
python3 /absolute/skill/path/scripts/source_check.py \
  --pin VERSIONED_ARXIV_ID --output-dir /absolute/evidence/paper \
  --offline --html /absolute/sources/original.html \
  --pdf /absolute/sources/original.pdf \
  --lit-json /absolute/sources/original.lit.json \
  --html-receipt /absolute/sources/html-source.json \
  --lit-receipt /absolute/sources/lit-source.json \
  --run-id RESEARCH_RUN_ID
```

## Quick Reference

| Input or output | Meaning |
|---|---|
| `--pin` | Explicit arXiv ID including `vN`; unversioned IDs fail closed. |
| `--output-dir` | Paper-specific evidence directory and manifest destination. |
| `--lit-bin` | Existing LiteParse executable; defaults to `lit`. |
| `--offline` | Disables acquisition, extraction, and environment-triggered review. |
| `--run-id` | Manifest run identity; an existing `HERMES_REPLAY_RUN_ID` takes precedence. |
| `--reviews PATH` | Previously saved source-bound focused-review receipt. |
| Exit `0` | Verified; `accepted_counts` contains main/appendix/total counts. |
| Exit `2` | Needs inspection; `accepted_counts` is null. |
| `inspection_candidates[].evidence` | `source_provenance` rows: expected versus observed values behind the failed check. |
| `tables[]` | Each HTML table's rows with the caption from the same element (`identity`, `caption_text`, `rows`). Read table values here: in flattened page text a caption can sit next to a different table. |
| `pinned_revision`, `revision_history`, `revision_note` | The pinned revision and every revision's submission date from the abstract page (also in the summary line as `revisions`). Counts describe the pinned revision only. Information only: a missing page sets `revision_history_issue` and never changes verification. |
| `current_record_authors` | Author names from the current abstract record, as whole name segments, with `current_record_author_count`, `current_record_authors_issue` and `current_record_source` (page sha256). The summary line shows up to five names; the full list is in `inventory.json`. |
| `--abs-html` | A saved unversioned abstract page for offline runs; supplies the revision history and current authors. |
| `first_appendix_heading` | First sectional heading (h1-h6) of the appendix region, verbatim; null when there is no appendix. A title banner such as a supplementary-material subtitle starts the region but is not a heading. |
| `inspection_candidates[].binding` | `html_pdf_binding` rows: `ambiguous` or `unmatched`, with `pdf_match_count`; matched captions emit no row. |

An HTML acquisition receipt contains `pin`, original versioned `url`, `sha256`,
and `bytes`; a receipt list must contain exactly one entry for the pin. A
LiteParse extraction receipt contains `tool: LiteParse`, `pdf_sha256`, and
`extraction_sha256`. Retain receipts created during acquisition/extraction.
Rehashing arbitrary JSON does not prove which PDF produced it.

## Procedure

1. Discover and pin the paper using the `arxiv` skill or native `web_search` /
   `web_extract`. Pin the revision the request is about. Feed and API IDs and
   unversioned URLs name the newest revision. When the request names a date or
   period (submitted on, as of, during), pin the newest revision dated on or
   before it: the abstract page's Submission history lists each revision's
   date, and the API's `published` and `updated` fields give the first and
   newest dates. With no date in the request, pin the newest revision. Record
   the pinned revision's date with its evidence. The pin governs content: figure
   and table counts and table values. For author names, use the current record
   (`current_record_authors`; the full list is in `inventory.json`), which carries
   later corrections and name changes, unless the request asks who wrote a
   specific revision; then use that revision's own author list. When
   `current_record_authors` is null or `current_record_authors_issue` is set, read
   the unversioned abstract page or the API's `<author>` entries; do not substitute
   the pinned revision's names. The helper's summary line
   lists every revision's date beside the pinned one; re-pin when the pinned
   revision is not the one the request is about.
2. Run the bundled helper through `terminal`. Read `inventory.json` with
   `read_file`; keep originals, extraction, and receipts together.
3. Accept counts only when `verification_status` is `verified` and
   `accepted_counts` is present. Cite the versioned original URL and retain the
   evidence path. `candidate_counts` are observations while anything is unresolved.
4. For `needs_inspection`, inspect `inspection_candidates`, including the exact
   source page, bounding box, literal text, and issue code. `source_provenance`
   rows carry `evidence` (expected versus observed values; the watermark check
   includes the literal page-1 text), and `html_pdf_binding` rows name only
   captions whose `binding` is `ambiguous` or `unmatched`. When every caption
   reports `binding: matched` with `verification: blocked_by_provenance`, repair
   the provenance predicate from its evidence first. Repair provenance,
   conversion, or HTML/PDF bindings before attempting focused visual review.
5. When text and DOM evidence cannot resolve caption versus body reference,
   inspect the original candidate page. For explicitly authorized automated
   review, load `references/focused-review.md` using `skill_view` and follow its
   bounded review command. Never derive captions from numbering gaps.
6. Include the manifest and any review ledger/checkpoint in the research handoff.
   The helper verifies this source claim; the main research workflow still owns
   report completion and its total cost accounting.

## Pitfalls

- Native DOM caption identities determine object counts. Panels, algorithms,
  linked mentions, and repeated text do not create additional objects.
- Appendix ancestry takes precedence. A standalone supplement heading applies
  within its structural DOM scope, not to unrelated later main sections.
- A PDF-only candidate requires a source-bound focused review. A confirmed
  caption is accepted as main only when strictly before all uniquely bound
  appendix headings; other section placements remain unresolved.
- Missing HTML, missing receipts, duplicate identities, changed hashes, poor
  extraction, conversion warnings, or uncertain review leave counts unaccepted.
- Offline provenance checks bind supplied artifacts to receipts; they do not
  establish that an untrusted party's receipts are authentic acquisition records.
- Environment-enabled review is supported for already configured run owners.
  Use explicit CLI flags for new runs; load the review reference for its rules.

## Verification

Confirm `producer_run_id`, versioned source URLs, acquisition/extraction hashes,
and caption identities belong to this run. Every accepted figure/table must have
one source identity and a PDF binding or an accepted focused-review receipt.
Do not replace unresolved evidence with guessed counts.

When modifying this skill, run its offline controls from the Hermes repository
through `terminal`:

```bash
scripts/run_tests.sh tests/skills/test_arxiv_source_check_skill.py -q
```

These tests use synthetic originals and receipts, exercise the Python CLI, and
make no network requests or paid calls. Live arXiv acquisition, LiteParse parsing,
and provider review require separate verification in the configured backend.
