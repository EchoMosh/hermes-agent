"""The Computer feed is bound to one explicit profile/session and redacts output."""

from __future__ import annotations

import json

from hermes_state import SessionDB
from tui_gateway import server


_SESSION = "canonical-bot-chat"


def _store(home, marker: str, secret: str) -> None:
    home.mkdir(parents=True)
    db = SessionDB(db_path=home / "state.db")
    try:
        db.create_session(_SESSION, "desktop", model="test-model")
        db.set_session_title(_SESSION, "Bot Chat")
        call_id = f"call-{marker}"
        db.append_message(
            _SESSION,
            "assistant",
            tool_calls=[
                {
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": "terminal",
                        "arguments": json.dumps(
                            {"command": f"printf {marker}; API_KEY={secret}"}
                        ),
                    },
                }
            ],
            timestamp=100,
        )
        db.append_message(
            _SESSION,
            "tool",
            json.dumps({"output": f"{marker}\ntoken={secret}"}),
            tool_name="terminal",
            tool_call_id=call_id,
            timestamp=101,
        )
    finally:
        db.close()


def _feed(profile: str, *, after: int = 0):
    response = server.handle_request(
        {
            "id": profile,
            "method": "computer.feed",
            "params": {
                "after": after,
                "profile": profile,
                "session_id": _SESSION,
            },
        }
    )
    assert "error" not in response, response
    return response["result"]


def test_computer_feed_is_profile_safe_incremental_and_redacted(monkeypatch, tmp_path):
    alpha, beta = tmp_path / "alpha", tmp_path / "beta"
    _store(alpha, "ALPHA_ONLY", "alpha-super-secret")
    _store(beta, "BETA_ONLY", "beta-super-secret")

    homes = {"alpha": alpha, "beta": beta}
    monkeypatch.setattr(server, "_profile_home", lambda profile: homes[profile])

    first_alpha = _feed("alpha")
    beta_feed = _feed("beta")
    second_alpha = _feed("alpha")

    assert first_alpha["session"]["id"] == _SESSION
    assert first_alpha["session"]["title"] == "Bot Chat"
    assert [step["tool"] for step in first_alpha["steps"]] == ["terminal"]

    alpha_text = json.dumps(first_alpha)
    beta_text = json.dumps(beta_feed)
    assert "ALPHA_ONLY" in alpha_text
    assert "BETA_ONLY" not in alpha_text
    assert "alpha-super-secret" not in alpha_text
    assert "[redacted]" in alpha_text
    assert "BETA_ONLY" in beta_text
    assert "ALPHA_ONLY" not in beta_text
    assert "beta-super-secret" not in beta_text
    assert second_alpha["steps"] == first_alpha["steps"]

    # No new database row means an incremental read returns no duplicate step.
    after = first_alpha["cursor"]
    incremental = _feed("alpha", after=after)
    assert incremental["cursor"] == after
    assert incremental["steps"] == []


def test_computer_feed_never_falls_back_to_another_session(monkeypatch, tmp_path):
    alpha = tmp_path / "alpha"
    _store(alpha, "ALPHA_ONLY", "alpha-super-secret")
    monkeypatch.setattr(server, "_profile_home", lambda _profile: alpha)

    response = server.handle_request(
        {
            "id": "missing",
            "method": "computer.feed",
            "params": {"profile": "alpha", "session_id": "not-the-canonical-chat"},
        }
    )

    assert response["error"]["code"] == 5404
    assert "not found" in response["error"]["message"].lower()
