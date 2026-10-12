# Optional focused source review

Read with `skill_view(name="arxiv-source-check", path="references/focused-review.md")`.
Use native `terminal` to run the bundled helper only within authorized paid-call
scope. Its review path sends one candidate's evidence and original page image to
the chosen OpenRouter vision model; it sends no expected counts or report answers.

```bash
python3 /absolute/skill/path/scripts/source_check.py \
  --pin VERSIONED_ARXIV_ID --output-dir /absolute/evidence/paper \
  --review-live --review-model VISION_MODEL_ID \
  --max-review-candidates 2 --review-estimate-usd CONSERVATIVE_CALL_ESTIMATE \
  --review-max-cost-usd 0.20 \
  --review-ledger /absolute/evidence/shared-review-ledger.jsonl
```

Use the saved-source flags from the main skill when reviewing offline artifacts.
Offline mode requires an explicit `--review-live` to make any review calls. Each
render is limited to its candidate's original page at 150 DPI through LiteParse.
Source provenance/binding errors must be repaired first; only unresolved PDF
caption candidates enter the review path.

The owner must supply a conservative per-call estimate for the actual model and
request. Before each request, the helper locks the shared JSONL ledger, fsyncs an
intent, and saves `focused-usage-checkpoint.json`. An intent without an outcome,
or an outcome with unknown usage, stops subsequent calls. Retain these records
after failures and include them in the run's accounting.

The default review cap is $0.20 of provider-reported known usage. The ledger has
a fixed $0.80 ceiling and reserves $0.20 for unknown usage: known prior usage plus
the next conservative estimate plus reserve must fit before another call. The
review cap is configurable up to $0.80. These are admission checks using an
estimate; a request can exceed its estimate. They do not enforce an account-wide
provider billing limit or include main-agent calls and other independent ledgers.

After each answer, the helper records returned prompt tokens, completion tokens,
and `usage.cost`. These values are provider-reported usage, not an independently
reconciled invoice. Missing usage stops review; do not present unknown cost as
zero. The outer run owner must reconcile its complete spend separately.

Review accepts only complementary caption/prose predicates with literal evidence
bound to the candidate, unchanged original-source hashes, a retained page image,
and known usage. Ambiguous predicates remain unresolved. A PDF-only caption's
main/appendix placement is accepted only when it precedes every uniquely bound
appendix heading; missing or ambiguous section evidence needs further inspection.

For compatibility with existing run environments, the helper recognizes
`HERMES_SOURCE_REVIEW_ENABLED=1`, `HERMES_SOURCE_REVIEW_MODEL`,
`HERMES_SOURCE_REVIEW_ESTIMATE_USD`, `HERMES_SOURCE_REVIEW_LEDGER`, and
`HERMES_SOURCE_REVIEW_MAX_COST_USD`; `HERMES_LIT_BIN` selects LiteParse.
`HERMES_REPLAY_RUN_ID` supplies the manifest run ID. These inherited values do not
replace paid-call authorization. Prefer explicit CLI flags for non-secret settings;
do not put behavioral settings into Hermes's credential `.env` file.
