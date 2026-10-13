"""Tests for the optional wall-clock run budget (agent.run_budget_seconds / --run-budget).

Covers:

1. Stale-timeout deadline scaling in
   ``run_agent.py:AIAgent._compute_non_stream_stale_timeout``:
   - an active run budget CAPS an implicit stale timeout (default 90s and
     reasoning floors like deepseek's 600s) at ``max(60, remaining * 0.5)``;
   - the cap never RAISES the timeout above what it would otherwise be;
   - explicit user configuration (provider ``stale_timeout_seconds`` or the
     ``HERMES_API_CALL_STALE_TIMEOUT`` env var) always wins untouched;
   - no budget => completely unchanged behavior.

2. One-time-ness of the 80% wrap-up notice injection in
   ``agent.conversation_loop._maybe_inject_run_budget_wrapup``:
   - fires once (latched), not repeatedly;
   - never fires when no budget is set or before the 80% threshold;
   - appended to the newest tool message (cache-safe /steer channel), no
     synthetic user message.

3. Normalization of the config/CLI value
   (``agent.agent_init._normalize_run_budget_seconds``): dormant on
   null/invalid/non-positive input.

4. Turn-clock stamping in ``agent.turn_context.build_turn_context``: the clock
   is per RUN, not per turn — a genuine user turn restarts it, a synthetic turn
   (typed row or canonical synthetic prefix) keeps it, no budget => None.
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest

def _write_config(tmp_path: Path, body: str) -> None:
    (tmp_path / "config.yaml").write_text(body or "{}\n", encoding="utf-8")

def _make_agent(tmp_path, monkeypatch, config_body: str = "", **overrides):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / ".env").write_text("", encoding="utf-8")
    monkeypatch.delenv("HERMES_API_CALL_STALE_TIMEOUT", raising=False)
    monkeypatch.delenv("HERMES_STREAM_STALE_TIMEOUT", raising=False)
    monkeypatch.delenv("HERMES_LOCAL_STREAM_STALE_TIMEOUT", raising=False)
    _write_config(tmp_path, config_body)

    from run_agent import AIAgent
    kwargs = dict(
        model="gpt-5.5",
        provider="openai",
        api_key="sk-dummy",
        base_url="https://api.openai.com/v1",
        quiet_mode=True,
        skip_context_files=True,
        skip_memory=True,
        platform="cli",
    )
    kwargs.update(overrides)
    return AIAgent(**kwargs)

# ── normalization ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    (None, None),
    (0, None),
    (-5, None),
    ("abc", None),
    (True, None),   # YAML `true` must not become a 1-second budget
    (False, None),
    (float("nan"), None),
    (900, 900.0),
    ("850", 850.0),
    (0.5, 0.5),
])
def test_normalize_run_budget_seconds(raw, expected):
    from agent.agent_init import _normalize_run_budget_seconds
    assert _normalize_run_budget_seconds(raw) == expected

# ── constructor / config plumbing ─────────────────────────────────────────

def test_config_key_sets_budget(monkeypatch, tmp_path):
    agent = _make_agent(
        tmp_path, monkeypatch,
        config_body="agent:\n  run_budget_seconds: 750\n",
    )
    assert agent.run_budget_seconds == 750.0

def test_constructor_arg_wins_over_config(monkeypatch, tmp_path):
    agent = _make_agent(
        tmp_path, monkeypatch,
        config_body="agent:\n  run_budget_seconds: 750\n",
        run_budget_seconds=900,
    )
    assert agent.run_budget_seconds == 900.0

# ── stale-timeout deadline scaling ─────────────────────────────────────────

def test_no_budget_stale_timeout_unchanged(monkeypatch, tmp_path):
    """Without a run budget the implicit 90s default is untouched."""
    import run_agent
    monkeypatch.setattr(run_agent, "get_provider_stale_timeout", lambda *a, **k: None)
    agent = _make_agent(tmp_path, monkeypatch)
    base, _implicit = agent._resolved_api_call_stale_timeout_base()
    assert agent._compute_non_stream_stale_timeout({"input": "hi"}) == base

def test_active_budget_caps_implicit_reasoning_floor(monkeypatch, tmp_path):
    """deepseek-v4-pro's 600s implicit floor yields to a tighter deadline cap.

    900s budget, 800s elapsed -> remaining 100s -> cap = max(60, 50) = 60s.
    """
    import run_agent
    monkeypatch.setattr(run_agent, "get_provider_stale_timeout", lambda *a, **k: None)
    agent = _make_agent(
        tmp_path, monkeypatch,
        model="deepseek/deepseek-v4-pro",
        run_budget_seconds=900,
    )
    agent._run_budget_started_at = time.time() - 800
    assert agent._compute_non_stream_stale_timeout({"input": "hi"}) == 60.0

def test_active_budget_cap_half_remaining(monkeypatch, tmp_path):
    """Cap is remaining * 0.5 when that exceeds the 60s floor."""
    import run_agent
    monkeypatch.setattr(run_agent, "get_provider_stale_timeout", lambda *a, **k: None)
    agent = _make_agent(
        tmp_path, monkeypatch,
        model="deepseek/deepseek-v4-pro",
        run_budget_seconds=900,
    )
    agent._run_budget_started_at = time.time() - 100  # remaining ~800 -> cap ~400
    timeout = agent._compute_non_stream_stale_timeout({"input": "hi"})
    assert 395.0 <= timeout <= 400.0

def test_active_budget_never_raises_timeout(monkeypatch, tmp_path):
    """The deadline cap NEVER loosens an already-tighter implicit timeout.

    90s default with lots of remaining budget (cap would be ~445s) -> stays 90s.
    """
    import run_agent
    monkeypatch.setattr(run_agent, "get_provider_stale_timeout", lambda *a, **k: None)
    agent = _make_agent(tmp_path, monkeypatch, run_budget_seconds=900)
    base, _implicit = agent._resolved_api_call_stale_timeout_base()
    agent._run_budget_started_at = time.time() - 10
    assert agent._compute_non_stream_stale_timeout({"input": "hi"}) == base

def test_explicit_provider_config_wins_over_budget_cap(monkeypatch, tmp_path):
    """Explicit stale_timeout_seconds is never capped by the run budget."""
    import run_agent
    monkeypatch.setattr(run_agent, "get_provider_stale_timeout", lambda *a, **k: 1800.0)
    agent = _make_agent(tmp_path, monkeypatch, run_budget_seconds=900)
    agent._run_budget_started_at = time.time() - 800
    assert agent._compute_non_stream_stale_timeout({"input": "hi"}) == 1800.0

def test_explicit_env_var_wins_over_budget_cap(monkeypatch, tmp_path):
    """HERMES_API_CALL_STALE_TIMEOUT is explicit config — never capped."""
    import run_agent
    monkeypatch.setattr(run_agent, "get_provider_stale_timeout", lambda *a, **k: None)
    agent = _make_agent(tmp_path, monkeypatch, run_budget_seconds=900)
    monkeypatch.setenv("HERMES_API_CALL_STALE_TIMEOUT", "1200")
    agent._run_budget_started_at = time.time() - 800
    assert agent._compute_non_stream_stale_timeout({"input": "hi"}) == 1200.0

def test_budget_without_started_clock_is_inert(monkeypatch, tmp_path):
    """A configured budget with no running turn clock changes nothing."""
    import run_agent
    monkeypatch.setattr(run_agent, "get_provider_stale_timeout", lambda *a, **k: None)
    agent = _make_agent(
        tmp_path, monkeypatch,
        model="deepseek/deepseek-v4-pro",
        run_budget_seconds=900,
    )
    agent._run_budget_started_at = None
    base, _implicit = agent._resolved_api_call_stale_timeout_base()
    assert agent._compute_non_stream_stale_timeout({"input": "hi"}) == base


@pytest.mark.parametrize(
    "config_body,env_value,expected",
    [
        ("", None, 60.0),
        ("providers:\n  openai:\n    stale_timeout_seconds: 1200\n", None, 1200.0),
        ("", "900", 900.0),
    ],
)
def test_cloud_stream_budget_preserves_explicit_deadlines(
    monkeypatch, tmp_path, config_body, env_value, expected
):
    """Both stream owners cap implicit patience without changing explicit precedence."""
    from agent import chat_completion_helpers as helpers

    agent = _make_agent(
        tmp_path,
        monkeypatch,
        config_body,
        model="deepseek/deepseek-v4-pro",
        run_budget_seconds=900,
    )
    if env_value is not None:
        monkeypatch.setenv("HERMES_STREAM_STALE_TIMEOUT", env_value)
    monkeypatch.setattr(helpers.time, "time", lambda: 1000.0)
    agent._run_budget_started_at = 1000.0 - 800
    payload = {"model": agent.model, "messages": [{"role": "user", "content": "hi"}]}
    call = helpers._StreamingCall(agent, payload, None)
    call._resolve_stale_timeout()
    assert call._stream_stale_timeout == expected


def test_local_stream_patience_is_independent_of_run_budget(monkeypatch, tmp_path):
    """A short remaining run budget does not shorten local model prefill grace."""
    from agent import chat_completion_helpers as helpers

    agent = _make_agent(
        tmp_path,
        monkeypatch,
        base_url="http://127.0.0.1:11434/v1",
        run_budget_seconds=900,
    )
    call = helpers._StreamingCall(agent, {"model": agent.model}, None)
    call._resolve_stale_timeout()
    without_clock = call._stream_stale_timeout
    agent._run_budget_started_at = time.time() - 800
    call._resolve_stale_timeout()
    assert call._stream_stale_timeout == without_clock == 900.0


# ── wrap-up injection one-time-ness ────────────────────────────────────────

class _StubAgent:
    def __init__(self, budget=None, started=None):
        self.run_budget_seconds = budget
        self._run_budget_started_at = started
        self._run_budget_wrapup_injected = False

def _tool_messages():
    return [
        {"role": "user", "content": "do the task"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "t1"}]},
        {"role": "tool", "tool_call_id": "t1", "content": "result one"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "t2"}]},
        {"role": "tool", "tool_call_id": "t2", "content": "result two"},
    ]

def test_wrapup_not_injected_when_unset():
    from agent.conversation_loop import _maybe_inject_run_budget_wrapup
    agent = _StubAgent(budget=None, started=time.time() - 10_000)
    messages = _tool_messages()
    assert _maybe_inject_run_budget_wrapup(agent, messages) is False
    assert messages == _tool_messages()

def test_wrapup_not_injected_before_threshold():
    from agent.conversation_loop import _maybe_inject_run_budget_wrapup
    agent = _StubAgent(budget=900, started=time.time() - 100)  # 11% elapsed
    messages = _tool_messages()
    assert _maybe_inject_run_budget_wrapup(agent, messages) is False
    assert agent._run_budget_wrapup_injected is False

def test_wrapup_injected_once_after_threshold():
    from agent.conversation_loop import (
        RUN_BUDGET_WRAPUP_NOTICE,
        _maybe_inject_run_budget_wrapup,
    )
    agent = _StubAgent(budget=900, started=time.time() - 800)  # 89% elapsed
    messages = _tool_messages()
    assert _maybe_inject_run_budget_wrapup(agent, messages) is True
    assert agent._run_budget_wrapup_injected is True
    # Appended to the NEWEST tool message; earlier messages untouched.
    assert RUN_BUDGET_WRAPUP_NOTICE in messages[-1]["content"]
    assert messages[-1]["content"].startswith("result two")
    assert messages[2]["content"] == "result one"
    # No synthetic user message was inserted.
    assert [m["role"] for m in messages] == [
        "user", "assistant", "tool", "assistant", "tool",
    ]

    # Second call: latched, no re-injection.
    snapshot = [dict(m) for m in messages]
    assert _maybe_inject_run_budget_wrapup(agent, messages) is False
    assert messages == snapshot
    assert messages[-1]["content"].count(RUN_BUDGET_WRAPUP_NOTICE) == 1

def test_wrapup_retries_when_no_tool_message_yet():
    """First iteration (no tool results) can't inject; the latch stays open
    so the next iteration with a tool result delivers the notice."""
    from agent.conversation_loop import (
        RUN_BUDGET_WRAPUP_NOTICE,
        _maybe_inject_run_budget_wrapup,
    )
    agent = _StubAgent(budget=900, started=time.time() - 800)
    messages = [{"role": "user", "content": "do the task"}]
    assert _maybe_inject_run_budget_wrapup(agent, messages) is False
    assert agent._run_budget_wrapup_injected is False

    messages += [
        {"role": "assistant", "content": "", "tool_calls": [{"id": "t1"}]},
        {"role": "tool", "tool_call_id": "t1", "content": "result"},
    ]
    assert _maybe_inject_run_budget_wrapup(agent, messages) is True
    assert RUN_BUDGET_WRAPUP_NOTICE in messages[-1]["content"]

def test_wrapup_not_injected_without_turn_clock():
    from agent.conversation_loop import _maybe_inject_run_budget_wrapup
    agent = _StubAgent(budget=900, started=None)
    messages = _tool_messages()
    assert _maybe_inject_run_budget_wrapup(agent, messages) is False

def test_wrapup_skips_already_persisted_tool_row():
    """An already-flushed tool row is append-only; mutating it would diverge the
    replayed transcript from the live wire bytes and break the prompt cache (same
    contract as _maybe_inject_iteration_budget_warning)."""
    from agent.context_compressor import _DB_PERSISTED_MARKER
    from agent.conversation_loop import _maybe_inject_run_budget_wrapup

    agent = _StubAgent(budget=900, started=time.time() - 800)
    messages = _tool_messages()
    messages[-1][_DB_PERSISTED_MARKER] = True
    snapshot = [dict(m) for m in messages]

    assert _maybe_inject_run_budget_wrapup(agent, messages) is False
    assert agent._run_budget_wrapup_injected is False
    assert messages == snapshot

def test_wrapup_multimodal_tool_content():
    """Content-blocks tool results get a text block appended, not clobbered."""
    from agent.conversation_loop import (
        RUN_BUDGET_WRAPUP_NOTICE,
        _maybe_inject_run_budget_wrapup,
    )
    agent = _StubAgent(budget=900, started=time.time() - 800)
    messages = [
        {"role": "user", "content": "task"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "t1"}]},
        {"role": "tool", "tool_call_id": "t1",
         "content": [{"type": "text", "text": "block"}]},
    ]
    assert _maybe_inject_run_budget_wrapup(agent, messages) is True
    blocks = messages[-1]["content"]
    assert blocks[0] == {"type": "text", "text": "block"}
    assert blocks[-1] == {"type": "text", "text": RUN_BUDGET_WRAPUP_NOTICE}

# ── pre-flush wiring (the notice must reach durable bytes) ─────────────────

def test_wrapup_lands_in_the_persisted_row_via_pre_flush_hook(monkeypatch, tmp_path):
    """The wrap-up notice must be injected BEFORE the tool row is flushed, or it
    never reaches SQLite: prepare_iteration's own call always runs on an
    already-persisted row (the previous iteration's flush already ran)."""
    from hermes_state import SessionDB
    from agent.tool_executor import _flush_session_db_after_tool_progress
    from agent.conversation_loop import RUN_BUDGET_WRAPUP_NOTICE

    session_db = SessionDB(db_path=tmp_path / "proof.db")
    try:
        agent = _make_agent(tmp_path, monkeypatch, session_db=session_db, run_budget_seconds=900)
        agent._run_budget_started_at = time.time() - 800  # 89% elapsed
        messages = _tool_messages()

        assert _flush_session_db_after_tool_progress(agent, messages, stage="checkpoint")

        persisted = session_db.get_messages(agent.session_id)
        assert any(RUN_BUDGET_WRAPUP_NOTICE in str(row["content"]) for row in persisted)
        assert agent._run_budget_wrapup_injected is True
    finally:
        session_db.close()

# ── turn clock stamping ────────────────────────────────────────────────────

AUTO_CONTINUE_NOTE = "[System note: Your previous turn was interrupted mid-run …]\n\nkeep going"


@pytest.fixture()
def turn_agent(tmp_path, monkeypatch):
    """Real AIAgent + SessionDB so build_turn_context runs its full prologue."""
    from hermes_state import SessionDB

    db = SessionDB(db_path=tmp_path / "turns.db")
    sid = "sess-run-budget"
    db.create_session(session_id=sid, source="cli", model="gpt-5.5")
    agent = _make_agent(
        tmp_path, monkeypatch, session_db=db, session_id=sid, run_budget_seconds=900,
    )
    agent._session_db_created = True
    agent._cached_system_prompt = "SYSTEM"
    agent._skip_mcp_refresh = True
    try:
        yield agent
    finally:
        db.close()


def _turn(agent, user_message="do the task", **overrides):
    import types
    from unittest.mock import patch
    from agent.turn_context import build_turn_context

    kwargs = dict(
        agent=agent, user_message=user_message, system_message=None,
        conversation_history=None, task_id=None, stream_callback=None,
        persist_user_message=None,
        restore_or_build_system_prompt=lambda *a, **k: None,
        install_safe_stdio=lambda: None, sanitize_surrogates=lambda s: s,
        summarize_user_message_for_log=lambda s: s,
        set_session_context=lambda _sid: None, set_current_write_origin=lambda _o: None,
        ra=lambda: types.SimpleNamespace(_set_interrupt=lambda *a, **k: None),
    )
    kwargs.update(overrides)
    with patch("agent.auxiliary_client.set_runtime_main", lambda *a, **k: None):
        return build_turn_context(**kwargs)


def test_user_turn_stamps_fresh_clock(turn_agent):
    turn_agent._run_budget_started_at = time.time() - 300
    before = time.time()
    _turn(turn_agent, "do the task")
    assert turn_agent._run_budget_started_at >= before


def test_synthetic_turn_via_display_kind_keeps_clock(turn_agent):
    carried = time.time() - 300
    turn_agent._run_budget_started_at = carried
    _turn(turn_agent, AUTO_CONTINUE_NOTE, persist_user_display_kind="auto_continue")
    assert turn_agent._run_budget_started_at == carried


def test_cli_timeline_notification_turn_keeps_clock(turn_agent):
    """A background helper result staged by the CLI carries its display_kind on the
    pending row, not the persist_user_display_kind argument."""
    from agent.message_metadata import stamp_message_timestamp

    carried = time.time() - 300
    turn_agent._run_budget_started_at = carried
    text = "Background job 42 finished: 3 files written."
    turn_agent._pending_cli_user_message = stamp_message_timestamp(
        {"role": "user", "content": text, "display_kind": "async_delegation_complete"}
    )
    _turn(turn_agent, text)
    assert turn_agent._run_budget_started_at == carried


def _goal_continuation():
    from hermes_cli.goals import CONTINUATION_PROMPT_TEMPLATE
    return CONTINUATION_PROMPT_TEMPLATE.format(goal="ship the report")


def _kanban_continuation():
    from hermes_cli.goals import KANBAN_GOAL_CONTINUATION_TEMPLATE
    return KANBAN_GOAL_CONTINUATION_TEMPLATE.format(reason="tests still red")


def _kanban_finalize():
    from hermes_cli.goals import KANBAN_GOAL_FINALIZE_TEMPLATE
    return KANBAN_GOAL_FINALIZE_TEMPLATE.format(reason="diff landed, card still open")


def _loop_wakeup():
    from hermes_cli.loops import WAKEUP_PROMPT_TEMPLATE
    return WAKEUP_PROMPT_TEMPLATE.format(tick=3, cadence=" (every 5m)", prompt="check CI")


@pytest.mark.parametrize(
    "prompt", [_goal_continuation, _kanban_continuation, _kanban_finalize, _loop_wakeup]
)
def test_synthetic_prefix_turn_keeps_clock(turn_agent, prompt):
    """CLI goal continuations, kanban goal-mode judge nudges and loop wakeups arrive as bare
    prompts (no display_kind); the canonical synthetic prefix is what identifies them."""
    carried = time.time() - 300
    turn_agent._run_budget_started_at = carried
    _turn(turn_agent, prompt())
    assert turn_agent._run_budget_started_at == carried


def test_synthetic_first_turn_stamps_now(turn_agent):
    turn_agent._run_budget_started_at = None
    before = time.time()
    _turn(turn_agent, _goal_continuation())
    assert turn_agent._run_budget_started_at is not None
    assert turn_agent._run_budget_started_at >= before


def test_user_turn_after_synthetic_turns_restarts_clock(turn_agent):
    carried = time.time() - 300
    turn_agent._run_budget_started_at = carried
    _turn(turn_agent, _goal_continuation())
    _turn(turn_agent, AUTO_CONTINUE_NOTE, persist_user_display_kind="auto_continue")
    assert turn_agent._run_budget_started_at == carried
    before = time.time()
    _turn(turn_agent, "new instructions from the human")
    assert turn_agent._run_budget_started_at >= before


def test_no_budget_leaves_clock_unset(turn_agent):
    turn_agent.run_budget_seconds = None
    for user_message, kind in (
        ("do the task", None),
        (AUTO_CONTINUE_NOTE, "auto_continue"),
        (_goal_continuation(), None),
    ):
        turn_agent._run_budget_started_at = time.time() - 300  # stale stamp must not survive
        _turn(turn_agent, user_message, persist_user_display_kind=kind)
        assert turn_agent._run_budget_started_at is None


def test_wrapup_fires_in_synthetic_turn_with_carried_clock(turn_agent):
    """Clock per run, notice per turn: a synthetic turn past 80% re-arms the latch and
    injects the notice on its first tool result."""
    from agent.conversation_loop import RUN_BUDGET_WRAPUP_NOTICE, _maybe_inject_run_budget_wrapup

    turn_agent._run_budget_started_at = time.time() - 800  # 89% of 900s
    turn_agent._run_budget_wrapup_injected = True  # latched by the previous turn
    _turn(turn_agent, AUTO_CONTINUE_NOTE, persist_user_display_kind="auto_continue")
    assert turn_agent._run_budget_wrapup_injected is False
    messages = _tool_messages()
    assert _maybe_inject_run_budget_wrapup(turn_agent, messages) is True
    assert RUN_BUDGET_WRAPUP_NOTICE in messages[-1]["content"]
    assert _maybe_inject_run_budget_wrapup(turn_agent, messages) is False


def test_remaining_budget_shrinks_across_synthetic_turn(turn_agent):
    """cap_to_run_budget reads the carried stamp: 100s already elapsed caps at 400s,
    where a restarted clock would allow 450s."""
    from agent.chat_completion_helpers import cap_to_run_budget

    turn_agent._run_budget_started_at = time.time() - 100
    _turn(turn_agent, _goal_continuation())
    assert cap_to_run_budget(turn_agent, 10_000) < 401 < 450

