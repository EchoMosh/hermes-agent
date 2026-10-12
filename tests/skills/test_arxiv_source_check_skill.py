"""Offline behavior controls for the optional arXiv source-check workflow.

Synthetic originals exercise the same helpers and CLI users run. No paper corpus,
network, provider credentials, LiteParse install, or supplied answer files are used.
"""

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


SKILL = (
    Path(__file__).resolve().parents[2]
    / "optional-skills" / "research" / "arxiv-source-check"
)
SCRIPT = SKILL / "scripts" / "source_check.py"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def helpers(monkeypatch):
    inventory = _load("arxiv_test_inventory", SKILL / "scripts" / "caption_inventory.py")
    monkeypatch.setitem(sys.modules, "caption_inventory", inventory)
    source = _load("arxiv_test_source", SCRIPT)

    def forbidden(*args, **kwargs):
        pytest.fail("Offline controls must never acquire sources or call a provider")

    monkeypatch.setattr(source.urllib.request, "urlopen", forbidden)
    monkeypatch.setattr(source.subprocess, "run", forbidden)
    for name in tuple(os.environ):
        if name.startswith("HERMES_SOURCE_REVIEW_") or name in {
            "OPENROUTER_API_KEY", "HERMES_REPLAY_RUN_ID", "HERMES_LIT_BIN"
        }:
            monkeypatch.delenv(name, raising=False)
    return source, inventory


def caption(kind, label, text, ident):
    return (
        f'<figure class="ltx_{kind}" id="{ident}"><figcaption>'
        f'<span class="ltx_tag_{kind}">{kind.title()} {label}:</span>'
        f'{text}</figcaption></figure>'
    )


def text_item(text, x=10, y=40):
    return {"text": text, "x": x, "y": y, "width": 300, "height": 10}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture
def originals(tmp_path):
    def make(extra=False):
        pin = "9999.00001v2"
        html = tmp_path / "original.html"
        pdf = tmp_path / "original.pdf"
        lit = tmp_path / "original.lit.json"
        hr = tmp_path / "html-receipt.json"
        lr = tmp_path / "lit-receipt.json"
        html.write_text(
            f'<a href="https://arxiv.org/abs/{pin}">Original</a>'
            '<article class="ltx_document">'
            + caption("figure", "S7", "Synthetic source caption words here.", "s7")
            + "</article>", encoding="utf-8",
        )
        pdf.write_bytes(b"%PDF-1.7\nsynthetic offline original")
        items = [text_item("Figure S7: Synthetic source caption words here.")]
        if extra:
            items.append(text_item("Table C5: Additional original caption words.", y=80))
        lit.write_text(json.dumps({"pages": [{
            "page": 1, "text": "arXiv:" + pin, "text_items": items,
        }]}), encoding="utf-8")
        hr.write_text(json.dumps({
            "pin": pin, "url": "https://arxiv.org/html/" + pin,
            "sha256": digest(html), "bytes": html.stat().st_size,
        }), encoding="utf-8")
        lr.write_text(json.dumps({
            "tool": "LiteParse", "pdf_sha256": digest(pdf),
            "extraction_sha256": digest(lit),
        }), encoding="utf-8")
        return SimpleNamespace(
            pin=pin, output_dir=tmp_path / "out", html=html, pdf=pdf,
            lit_json=lit, html_receipt=hr, lit_receipt=lr, offline=True,
            lit_bin="unavailable-liteparse", run_id="synthetic-research-run",
            reviews=None, review_live=False,
        )
    return make


# The original eight controls, using new source objects instead of corpus answers.

@pytest.mark.platforms("linux", "macos")
def test_pending_and_unknown_paid_usage_block_next_intent(helpers, tmp_path):
    source, _ = helpers
    ledger = tmp_path / "ledger.jsonl"
    source.ledger_event(ledger, {
        "event": "intent", "call_id": "first", "estimated_cost_usd": 0.05,
    }, 0.05)
    with pytest.raises(ValueError, match="pending_or_unknown"):
        source.ledger_event(ledger, {"event": "intent", "call_id": "second"}, 0.05)
    source.ledger_event(ledger, {
        "event": "outcome", "call_id": "first", "usage_known": False,
        "cost_usd": None,
    })
    with pytest.raises(ValueError, match="pending_or_unknown"):
        source.ledger_event(ledger, {"event": "intent", "call_id": "second"}, 0.05)
    assert [row["call_id"] for row in map(json.loads, ledger.read_text().splitlines())] == [
        "first", "first",
    ]


def test_native_appendix_ancestry_and_nonnumeric_identities(helpers):
    _, inventory = helpers
    html = (
        '<article class="ltx_document">'
        + caption("figure", "R9", "Main source caption.", "r")
        + '<section class="ltx_appendix"><h2>Appendix Material</h2>'
        + caption("table", "B4", "Appendix table caption.", "b")
        + "<section>" + caption("figure", "Z13", "Nested source caption.", "z")
        + "</section></section><section>"
        + caption("figure", "5", "Later main caption.", "m")
        + "</section></article>"
    )
    captions, _, _, warnings = inventory.parse_html(html)
    assert [(c["identity"], c["region"]) for c in captions] == [
        ("figure:R9", "main"), ("table:B4", "appendix"),
        ("figure:Z13", "appendix"), ("figure:5", "main"),
    ]
    assert not warnings


def test_standalone_supplement_heading_scope_does_not_bleed(helpers):
    _, inventory = helpers
    html = (
        '<article class="ltx_document"><section><h2>Supplementary Material</h2>'
        + caption("figure", "B4", "Supplement caption.", "b")
        + "</section><section>" + caption("figure", "R9", "Main caption.", "r")
        + "</section></article>"
    )
    assert [c["region"] for c in inventory.parse_html(html)[0]] == ["appendix", "main"]


def test_missing_and_duplicate_html_captions_fail_closed(helpers):
    _, inventory = helpers
    html = (
        '<article class="ltx_document"><figure class="ltx_figure" id="missing">'
        '<img src="unread.png"></figure>'
        + caption("figure", "R9", "First caption.", "one")
        + caption("figure", "R9", "Second caption.", "two") + "</article>"
    )
    captions, _, _, warnings = inventory.parse_html(html)
    assert len(captions) == 1
    assert any("missing_html_caption" in row for row in warnings)
    assert any("duplicate_caption_identity" in row for row in warnings)


def test_split_pdf_prefix_preserves_caption_identity(helpers):
    _, inventory = helpers
    lit = {"pages": [{"page": 3, "text_items": [
        text_item("Figure", x=10), text_item("Z13:", x=50),
        text_item("Synthetic caption words.", x=90),
    ]}]}
    candidates = inventory.pdf_candidates(lit)
    assert len(candidates) == 1
    assert candidates[0]["identity"] == "figure:Z13"
    assert candidates[0]["page"] == 3


def test_dotted_label_and_plain_table_without_caption(helpers):
    _, inventory = helpers
    lit = {"pages": [{"page": 1, "text_items": [
        text_item("Table B.4: Original dotted label."),
    ]}]}
    assert inventory.pdf_candidates(lit)[0]["identity"] == "table:B.4"
    html = '<article class="ltx_document"><table id="bare"><tr><td>Data</td></tr></table></article>'
    assert any(row.get("missing_html_caption") == "bare" for row in inventory.parse_html(html)[3])


def test_verified_inventory_is_source_derived_and_uses_runtime_identity(helpers, originals, monkeypatch):
    source, _ = helpers
    args = originals()
    monkeypatch.setenv("HERMES_REPLAY_RUN_ID", "runtime-owned-run")
    result = source.run(args)
    assert result["verification_status"] == "verified"
    assert result["producer_run_id"] == "runtime-owned-run"
    identities = result["native_caption_identities"]
    assert [c["identity"] for c in identities] == ["figure:S7"]
    assert all(c["section"] == "main" and c["verification"] == "verified" for c in identities)
    assert result["accepted_counts"]["total"]["figure"] == len(identities)
    assert result["accepted_counts"]["main"] == result["accepted_counts"]["total"]
    assert result["accepted_counts"]["appendix"] == {"figure": 0, "table": 0}
    assert result["expected_counts_supplied"] is False
    assert result["source"]["pdf_sha256"] == digest(args.pdf)
    assert json.loads((args.output_dir / "inventory.json").read_text()) == result


def test_pdf_only_candidate_and_changed_original_leave_counts_unaccepted(helpers, originals):
    source, _ = helpers
    args = originals(extra=True)
    result = source.run(args)
    assert result["verification_status"] == "needs_inspection"
    assert result["accepted_counts"] is None
    assert result["inspection_candidates"][0]["candidate"]["identity"] == "table:C5"
    args.pdf.write_bytes(args.pdf.read_bytes() + b"altered")
    result = source.run(args)
    assert result["accepted_counts"] is None
    assert any(row.get("detail") == "pdf_source_hash_mismatch" for row in result["inspection_candidates"])


@pytest.mark.parametrize("artifact,detail", [
    ("html", "html_provenance_hash_or_size_mismatch"),
    ("lit_json", "extraction_hash_mismatch"),
])
def test_changed_artifact_invalidates_previous_receipt(helpers, originals, artifact, detail):
    source, _ = helpers
    args = originals()
    path = getattr(args, artifact)
    path.write_bytes(path.read_bytes() + b" ")
    result = source.run(args)
    assert result["verification_status"] == "needs_inspection"
    assert result["accepted_counts"] is None
    assert any(row.get("detail") == detail for row in result["inspection_candidates"])


@pytest.mark.parametrize("artifact,detail", [
    ("html", "offline_html_missing"),
    ("pdf", "offline_pdf_missing"),
    ("lit_json", "offline_liteparse_extraction_missing"),
    ("html_receipt", "html_source_receipt_missing"),
    ("lit_receipt", "pdf_extraction_receipt_missing"),
])
def test_offline_missing_artifact_never_falls_back_to_network(helpers, originals, artifact, detail):
    source, _ = helpers
    args = originals()
    getattr(args, artifact).unlink()
    with pytest.raises(ValueError, match=detail):
        source.run(args)


def _cli_args(args):
    command = [str(SCRIPT), "--pin", args.pin, "--output-dir", str(args.output_dir), "--offline"]
    for name in ("html", "pdf", "lit_json", "html_receipt", "lit_receipt"):
        command.extend(["--" + name.replace("_", "-"), str(getattr(args, name))])
    command.extend(["--run-id", args.run_id])
    return command


@pytest.mark.parametrize("extra", [False, True])
def test_real_python_cli_emits_status_exit_code_and_manifest(originals, extra):
    args = originals(extra=extra)
    proc = subprocess.run(
        [sys.executable, *_cli_args(args)], capture_output=True, text=True,
        env={"PATH": os.environ.get("PATH", "")}, timeout=20,
    )
    summary = json.loads(proc.stdout)
    result = json.loads((args.output_dir / "inventory.json").read_text())
    assert proc.returncode == (2 if extra else 0), proc.stderr
    assert summary["verification_status"] == result["verification_status"]
    assert summary["accepted_counts"] == result["accepted_counts"]
    assert summary["inspection_candidate_count"] == len(result["inspection_candidates"])
    assert Path(summary["evidence_path"]) == (args.output_dir / "inventory.json").resolve()


@pytest.mark.parametrize("failure", ["unversioned", "not_pdf", "missing_receipt"])
def test_cli_failure_writes_inspection_manifest(helpers, originals, monkeypatch, capsys, failure):
    source, _ = helpers
    args = originals()
    if failure == "unversioned":
        args.pin = args.pin.rsplit("v", 1)[0]
    elif failure == "not_pdf":
        args.pdf.write_bytes(b"HTML error response")
    else:
        args.lit_receipt.unlink()
    monkeypatch.setattr(sys, "argv", _cli_args(args))
    assert source.main() == 2
    summary = json.loads(capsys.readouterr().out)
    result = json.loads((args.output_dir / "inventory.json").read_text())
    assert summary["verification_status"] == "needs_inspection"
    assert result["accepted_counts"] is None
    assert result["inspection_candidates"][0]["issue"] == "source_workflow_failed"


def test_offline_mode_ignores_environment_triggered_paid_review(helpers, originals, monkeypatch, capsys):
    source, _ = helpers
    args = originals(extra=True)
    monkeypatch.setenv("HERMES_SOURCE_REVIEW_ENABLED", "1")
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic-never-used")
    monkeypatch.setattr(sys, "argv", _cli_args(args))
    monkeypatch.setattr(source, "review_candidates", lambda *a: pytest.fail("Offline mode enabled paid review"))
    assert source.main() == 2
    assert json.loads(capsys.readouterr().out)["accepted_counts"] is None


@pytest.mark.platforms("linux", "macos")
@pytest.mark.parametrize("ceiling", ["own", "shared"])
def test_review_budget_admission_precedes_intent(helpers, tmp_path, ceiling):
    source, _ = helpers
    ledger = tmp_path / "ledger.jsonl"
    source.ledger_event(ledger, {"event": "intent", "call_id": "done"}, 0.1)
    source.ledger_event(ledger, {
        "event": "outcome", "call_id": "done", "usage_known": True, "cost_usd": 0.1,
    })
    before = ledger.read_bytes()
    with pytest.raises(ValueError, match="own_cost_cap" if ceiling == "own" else "budget_exhausted"):
        source.ledger_event(
            ledger, {"event": "intent", "call_id": "blocked"},
            0.15 if ceiling == "own" else 0.6, max_cost=0.2 if ceiling == "own" else 0.8,
        )
    assert ledger.read_bytes() == before


def test_saved_review_must_match_candidate_and_original_sources(helpers, originals, tmp_path):
    source, inventory = helpers
    args = originals(extra=True)
    result = source.run(args)
    evidence = inventory.analyze(args.html, args.lit_json, args.pdf, args.lit_receipt,
                                 json.loads(args.html_receipt.read_text()))
    candidate = result["inspection_candidates"][0]
    image = tmp_path / "retained-page.png"
    image.write_bytes(b"synthetic focused page")
    case = {
        "candidate_key": candidate["candidate_key"], "candidate": candidate["candidate"],
        "source": dict(result["source"], pdf_sha256="unrelated-original"),
        "usage_known": True, "image_path": str(image), "image_sha256": digest(image),
        "predicates": {"caption": False, "prose_reference": True,
                       "evidence_quote": candidate["candidate"]["text"]},
    }
    source.apply_reviews(result, evidence, {"cases": [case]})
    assert result["verification_status"] == "needs_inspection"
    assert result["accepted_counts"] is None
    assert result["inspection_candidates"] == [candidate]


def test_requested_pin_cannot_relabel_another_valid_original(helpers, originals):
    source, _ = helpers
    args = originals()
    assert source.run(args)['verification_status'] == 'verified'
    args.pin = '9999.00002v2'
    with pytest.raises(ValueError, match='requested_pin_does_not_match_source_receipt'):
        source.run(args)


@pytest.mark.parametrize('watermark,verified', [
    ('arX iv: 9999.00001 v2 [cs.CV]', True),
    ('arXiv:9999.00001v20 [cs.CV]', False),
    ('arXiv:9999.00002v2 [cs.CV]', False),
])
def test_spatial_watermark_preserves_exact_version(helpers, originals, watermark, verified):
    source, _ = helpers
    args = originals()
    data = json.loads(args.lit_json.read_text())
    data['pages'][0]['text'] = watermark
    args.lit_json.write_text(json.dumps(data))
    receipt = json.loads(args.lit_receipt.read_text())
    receipt['extraction_sha256'] = digest(args.lit_json)
    args.lit_receipt.write_text(json.dumps(receipt))
    result = source.run(args)
    assert (result['verification_status'] == 'verified') is verified
    assert (result['accepted_counts'] is not None) is verified
