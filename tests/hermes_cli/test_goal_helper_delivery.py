"""Live helpers defer goal gates; completed results preempt CLI continuations (#1259)."""

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

    # A helper that never finishes cannot renew an expired barrier at this boundary.
    mgr.set("bounded helper wait")
    mgr.add_gate(f'"{sys.executable}" "{gate}"')
    ad._records["second"]["status"] = "running"
    assert evaluate()["verdict"] == "waiting"
    mgr.state.waiting_until = time.time() - 1
    assert evaluate()["status"] == "done"
    assert mgr.state.turns_used == 1 and calls.read_text() == "xxx"
    mgr.set("cancel helper wait")
    assert evaluate()["verdict"] == "waiting"
    mgr.pause(reason="cancelled")
    assert not mgr.is_waiting() and evaluate()["verdict"] == "inactive"


def test_post_turn_admits_durable_results_before_goal_and_preserves_interrupt(isolated_goal, monkeypatch):
    from cli import HermesCLI
    from tools.process_registry import ProcessRegistry
    from tools.process_registry_notifications import format_process_notification

    registry = ProcessRegistry()
    monkeypatch.setattr("tools.process_registry.process_registry", registry)
    monkeypatch.setattr("cli.CLI_CONFIG", {})
    monkeypatch.setattr("cli._cprint", lambda *args: None)
    judge = Mock(return_value=("continue", "integrate results", False, None, False))
    monkeypatch.setattr(goals, "judge_goal", judge)

    for interrupted in (False, True):
        sid = f"parent-{interrupted}"
        mgr = goals.GoalManager(sid)
        mgr.set("integrate research")
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
        event = {"type": "async_delegation", "delegation_id": f"deleg-{sid}", "session_key": sid,
                 "parent_session_id": sid, "status": "completed", "goal": "research",
                 "summary": "Verified research results", "completed_at": time.time()}
        ad._persist_dispatch({**event, "dispatched_at": time.time() - 60})
        ad._persist_completion(event, {"status": "completed", "summary": event["summary"]})
        registry.completion_queue.put(event)
        registry._completions_restored = True

        cli._tui_after_turn()
        completion = cli._pending_input.get_nowait()
        assert completion == format_process_notification(event)
        assert cli._pending_input.empty()  # No goal continuation can get ahead of this result.
        assert ad.get_durable_delegation(event["delegation_id"])["delivery_state"] == "delivered"
        judge.assert_not_called()
        assert mgr.state.turns_used == 0
        if interrupted:
            assert mgr.state.status == "paused"
        else:
            assert mgr.state.status == "active"
            cli.conversation_history.append({"role": "assistant", "content": "Integrated research results"})
            cli._tui_after_turn()
            assert "Continuing toward your standing goal" in cli._pending_input.get_nowait()
            assert mgr.state.turns_used == 1
            judge.assert_called_once()
            judge.reset_mock()
