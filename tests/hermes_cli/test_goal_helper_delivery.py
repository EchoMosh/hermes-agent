"""Live helpers defer goal gates; queued results are admitted first and defer only the judge (#1259, #1265)."""

import queue
import sys
import time
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from agent.runtime_cwd import reset_session_cwd, set_session_cwd
from hermes_cli import goals
from tools import async_delegation as ad


@pytest.fixture
def isolated_goal(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    token = set_session_cwd(str(tmp_path))
    goals._DB_CACHE.clear()
    monkeypatch.setattr(ad, "_records", {})
    yield tmp_path
    goals._DB_CACHE.clear()
    reset_session_cwd(token)


def test_live_helpers_defer_gates_and_budget_until_results_or_deadline(isolated_goal, monkeypatch):
    home = isolated_goal
    report = home / "report.md"
    calls = home / "gate-calls"
    gate = home / "gate.py"
    gate.write_text(
        "from pathlib import Path\n"
        "p = Path('gate-calls')\n"
        "p.write_text(p.read_text() + 'x' if p.exists() else 'x')\n"
        "raise SystemExit(0 if Path('report.md').exists() else 1)\n"
    )
    mgr = goals.GoalManager("helper-parent", default_max_turns=3)
    mgr.set("write the research report")
    mgr.add_gate(f'"{sys.executable}" "{gate}"')
    judge = Mock(return_value=("done", "verified report", False, None, False))
    monkeypatch.setattr(goals, "judge_goal", judge)
    ad._records.update({
        "first": {"status": "running", "parent_session_id": mgr.session_id},
        "second": {"status": "running", "parent_session_id": mgr.session_id},
        "other": {"status": "running", "parent_session_id": "another-parent"},
    })

    def evaluate():
        return mgr.evaluate_after_turn("Waiting for research", active_delegations=goals.count_active_delegations(mgr.session_id))

    decision = evaluate()
    assert decision["verdict"] == "waiting" and not decision["should_continue"]
    assert mgr.state.turns_used == mgr.state.gates[0].attempts == 0
    assert not calls.exists()
    judge.assert_not_called()
    deadline = mgr.state.waiting_until
    assert 0 < deadline - time.time() <= goals._MAX_BARRIER_WAIT_S
    mgr = goals.GoalManager(mgr.session_id)
    assert mgr.is_waiting() and mgr.state.waiting_on_delegations == 2
    evaluate()
    assert mgr.state.waiting_until == deadline and mgr.state.turns_used == 0

    ad._records["first"]["status"] = "completed"
    assert not mgr.is_waiting()  # One completion wakes the native barrier.
    assert evaluate()["verdict"] == "waiting"  # The remaining helper still owns work.
    assert mgr.state.waiting_on_delegations == 1 and not calls.exists()
    ad._records["second"]["status"] = "completed"
    assert not mgr.is_waiting()
    assert evaluate()["verdict"] == "gate_failed"
    assert calls.read_text() == "x" and mgr.state.turns_used == 1
    judge.assert_not_called()
    report.write_text("Research complete")
    assert evaluate()["status"] == "done"
    assert calls.read_text() == "xx" and mgr.state.turns_used == 2
    judge.assert_called_once()

    # The native idle hook clears an expired barrier BEFORE the resumed model turn.
    # That expiry must survive manager reloads and still spend a normal evaluation.
    mgr.set("bounded helper wait", max_turns=1)
    mgr.add_gate(f'"{sys.executable}" "{gate}"')
    judge.return_value = ("continue", "helper is still running", False, None, False)
    ad._records["second"]["status"] = "running"
    assert evaluate()["verdict"] == "waiting"
    mgr.state.waiting_until = time.time() - 1
    mgr._save()
    from hermes_cli.cli_loops_mixin import CLILoopsMixin
    idle_cli = SimpleNamespace(_pending_input=queue.Queue(), _get_goal_manager=lambda: mgr)
    CLILoopsMixin._maybe_resume_parked_goal(idle_cli)
    assert "Continuing toward your standing goal" in idle_cli._pending_input.get_nowait()
    assert not mgr.is_waiting() and mgr.state.waiting_until == 0.0
    assert mgr.state.delegation_wait_expired
    mgr = goals.GoalManager(mgr.session_id)
    assert evaluate()["status"] == "paused"
    assert mgr.state.turns_used == 1 and calls.read_text() == "xxx"
    assert not mgr.state.delegation_wait_expired
    mgr.set("cancel helper wait")
    assert evaluate()["verdict"] == "waiting"
    mgr.state.waiting_until = time.time() - 1
    assert not mgr.is_waiting() and mgr.state.delegation_wait_expired
    mgr.pause(reason="cancelled")
    assert not mgr.is_waiting() and evaluate()["verdict"] == "inactive"
    assert not mgr.state.delegation_wait_expired


@pytest.fixture
def post_turn(isolated_goal, monkeypatch):
    """Registry, judge mock and goal-decision recorder for driving ``_tui_after_turn`` on a CLI stub."""
    from tools.process_registry import ProcessRegistry

    registry = ProcessRegistry()
    monkeypatch.setattr("tools.process_registry.process_registry", registry)
    monkeypatch.setattr("cli.CLI_CONFIG", {})
    monkeypatch.setattr("cli._cprint", lambda *args: None)
    judge = Mock(return_value=("continue", "integrate results", False, None, False))
    monkeypatch.setattr(goals, "judge_goal", judge)
    decisions = []
    monkeypatch.setattr("hermes_cli.cli_loops_mixin._print_decision_message", decisions.append)
    return SimpleNamespace(registry=registry, judge=judge, decisions=decisions)


def _post_turn_cli(mgr, *, interrupted=False):
    """A HermesCLI stub holding only what ``_tui_after_turn`` touches, bound to ``mgr``'s session."""
    from cli import HermesCLI

    sid = mgr.session_id
    cli = HermesCLI.__new__(HermesCLI)
    for attr, value in {
        "session_id": sid, "agent": SimpleNamespace(session_id=sid), "_goal_manager": mgr,
        "_pending_input": queue.Queue(), "_interrupt_queue": queue.Queue(),
        "_last_turn_interrupted": interrupted, "_pending_tool_info": {}, "_voice_mode": False,
        "conversation_history": [{"role": "assistant", "content": "Research is running"}],
        "_app": SimpleNamespace(invalidate=lambda: None), "_pet_react_turn_end": lambda: None,
        "_turn_summary_emit": lambda: None, "_recover_terminal_after_interrupt": lambda: None,
        "_maybe_complete_loop_tick_after_turn": lambda: None,
    }.items():
        setattr(cli, attr, value)
    return cli


def _queue_completion(registry, sid):
    """Persist and enqueue a completed delegation owned by ``sid``; returns its event."""
    event = {"type": "async_delegation", "delegation_id": f"deleg-{sid}", "session_key": sid,
             "parent_session_id": sid, "status": "completed", "goal": "research",
             "summary": "Verified research results", "completed_at": time.time()}
    ad._persist_dispatch({**event, "dispatched_at": time.time() - 60})
    ad._persist_completion(event, {"status": "completed", "summary": event["summary"]})
    registry.completion_queue.put(event)
    registry._completions_restored = True
    return event


def test_post_turn_admits_durable_results_before_goal_and_preserves_interrupt(post_turn):
    from tools.process_registry_notifications import format_process_notification

    for interrupted in (False, True):
        mgr = goals.GoalManager(f"parent-{interrupted}")
        mgr.set("integrate research")
        cli = _post_turn_cli(mgr, interrupted=interrupted)
        event = _queue_completion(post_turn.registry, mgr.session_id)

        cli._tui_after_turn()
        completion = cli._pending_input.get_nowait()
        assert completion == format_process_notification(event)
        assert cli._pending_input.empty()  # No goal continuation can get ahead of this result.
        assert ad.get_durable_delegation(event["delegation_id"])["delivery_state"] == "delivered"
        post_turn.judge.assert_not_called()
        assert mgr.state.turns_used == 0
        if interrupted:
            assert mgr.state.status == "paused"
            assert not post_turn.decisions  # Ctrl+C pauses before anything is evaluated.
        else:
            assert mgr.state.status == "active"
            # No gates: nothing is checkable until the model has read the result, so the verdict waits.
            assert post_turn.decisions.pop()["verdict"] == "deferred"
            cli.conversation_history.append({"role": "assistant", "content": "Integrated research results"})
            cli._tui_after_turn()
            assert "Continuing toward your standing goal" in cli._pending_input.get_nowait()
            assert mgr.state.turns_used == 1
            post_turn.judge.assert_called_once()
            assert post_turn.decisions.pop()["verdict"] == "continue"
            post_turn.judge.reset_mock()


def test_post_turn_runs_gates_behind_queued_results_but_yields_to_human_input(post_turn):
    from tools.process_registry_notifications import format_process_notification

    mgr = goals.GoalManager("gated-parent")
    mgr.set("write the research report")
    mgr.add_gate("echo report.md is missing; exit 7")
    cli = _post_turn_cli(mgr)
    event = _queue_completion(post_turn.registry, mgr.session_id)

    cli._tui_after_turn()
    # The helper result still reaches the model first; the deterministic gate feedback follows it.
    assert cli._pending_input.get_nowait() == format_process_notification(event)
    feedback = cli._pending_input.get_nowait()
    assert "quality gate" in feedback.lower() and "exit 7" in feedback and "report.md is missing" in feedback
    assert cli._pending_input.empty()
    assert mgr.state.gates[0].attempts == 1 and mgr.state.turns_used == 1
    assert post_turn.decisions.pop()["verdict"] == "gate_failed"
    post_turn.judge.assert_not_called()

    # A human message already queued preempts everything, gates included.
    cli._pending_input.put("hold on, let me look first")
    cli._tui_after_turn()
    assert list(cli._pending_input.queue) == ["hold on, let me look first"]
    assert mgr.state.gates[0].attempts == 1 and mgr.state.turns_used == 1
    assert not post_turn.decisions
    post_turn.judge.assert_not_called()


def test_post_turn_runs_gates_behind_a_plain_string_watch_match_notice(post_turn):
    """A watch_match reaches ``_pending_input`` as a plain ``str`` (the drain wraps only delegations and
    diagnostics in ``TimelineNotification``): the notification prefix, not the wrapper type, must classify
    it as synthetic, or the gate is silenced exactly as it was for queued helper results."""
    from agent.context_compressor import _BACKGROUND_PROCESS_NOTIFICATION_PREFIX
    from tools.process_registry_notifications import format_process_notification

    mgr = goals.GoalManager("watched-parent")
    mgr.set("write the research report")
    mgr.add_gate("echo report.md is missing; exit 7")
    cli = _post_turn_cli(mgr)
    sid = mgr.session_id
    event = {"type": "watch_match", "session_id": "proc_w1", "session_key": sid, "task_id": sid,
             "owner_task_id": None, "command": "python crawl.py", "pattern": "READY",
             "output": "crawler READY on :8080", "suppressed": 0}
    post_turn.registry.completion_queue.put(event)
    post_turn.registry._completions_restored = True

    cli._tui_after_turn()
    # The drain still queues the match as the same plain string it always did; the gate feedback follows it.
    notice = cli._pending_input.get_nowait()
    assert notice == format_process_notification(event)
    assert type(notice) is str and notice.startswith(_BACKGROUND_PROCESS_NOTIFICATION_PREFIX)
    feedback = cli._pending_input.get_nowait()
    assert "quality gate" in feedback.lower() and "exit 7" in feedback and "report.md is missing" in feedback
    assert cli._pending_input.empty()
    assert mgr.state.gates[0].attempts == 1 and mgr.state.turns_used == 1
    assert post_turn.decisions.pop()["verdict"] == "gate_failed"
    post_turn.judge.assert_not_called()

    # A plain human string is still human input and preempts the gate.
    cli._pending_input.put("hold on, let me look first")
    cli._tui_after_turn()
    assert list(cli._pending_input.queue) == ["hold on, let me look first"]
    assert mgr.state.gates[0].attempts == 1 and mgr.state.turns_used == 1
    assert not post_turn.decisions
    post_turn.judge.assert_not_called()
