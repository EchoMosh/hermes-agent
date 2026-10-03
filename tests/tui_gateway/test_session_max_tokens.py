"""Per-session output ceilings used by bounded background chat surfaces."""

from __future__ import annotations

import json
import threading

from tui_gateway import server


def test_session_create_cap_reaches_deferred_build_without_affecting_plain_sessions(monkeypatch):
    monkeypatch.setattr(server, "_enable_gateway_prompts", lambda: None)
    monkeypatch.setattr(server, "_schedule_agent_build", lambda *_args, **_kwargs: None)
    server._sessions.clear()
    try:
        capped = server.handle_request({
            "id": "capped",
            "method": "session.create",
            "params": {
                "source": "desktop",
                "hidden": True,
                "room_plumbing": True,
                "follow_profile_config": True,
                "max_tokens": 4096,
            },
        })
        assert "error" not in capped, capped
        capped_record = server._sessions[capped["result"]["session_id"]]
        assert capped_record["max_tokens_override"] == 4096
        assert server._deferred_build_agent_kwargs(capped_record, None)["max_tokens_override"] == 4096

        plain = server.handle_request({
            "id": "plain", "method": "session.create", "params": {"source": "desktop"}
        })
        assert "error" not in plain, plain
        plain_record = server._sessions[plain["result"]["session_id"]]
        assert plain_record["max_tokens_override"] is None
        assert "max_tokens_override" not in server._deferred_build_agent_kwargs(plain_record, None)

        # A room made by an older client has no create-time cap. The bounded
        # caller can adopt that existing session on resume without replacing
        # it or changing any profile-wide setting.
        adopted = server.handle_request({
            "id": "adopted",
            "method": "session.resume",
            "params": {"session_id": plain["result"]["stored_session_id"], "max_tokens": 4096},
        })
        assert "error" not in adopted, adopted
        assert plain_record["max_tokens_override"] == 4096
    finally:
        server._sessions.clear()


def test_session_create_rejects_non_positive_output_cap():
    response = server.handle_request({
        "id": "bad", "method": "session.create", "params": {"max_tokens": 0}
    })
    assert response["error"]["code"] == -32602


def test_room_resume_restores_only_the_output_cap_from_stored_runtime():
    row = {
        "title": "Group: room-1 · thread-1",
        "hidden": 1,
        "model": "openai/gpt-6-luna",
        "model_config": json.dumps({
            "model": "openai/gpt-6-luna",
            "provider": "openrouter",
            "room_plumbing": True,
            "follow_profile_config": True,
            "max_tokens": 4096,
        }),
    }

    # Model/provider still follow the member profile; the group-owned safety
    # ceiling survives a backend restart with the hidden session.
    assert server._stored_session_runtime_overrides(row) == {"max_tokens_override": 4096}


def test_group_cap_persists_in_first_write_and_compute_host_frame(monkeypatch):
    session = {
        "agent": None,
        "attached_images": [],
        "cols": 80,
        "cwd": "/tmp",
        "history": [],
        "history_lock": threading.Lock(),
        "history_version": 0,
        "max_tokens_override": 4096,
        "model_override": None,
        "room_plumbing": True,
        "session_key": "group-key",
        "source": "desktop",
    }
    _model, config = server._workdir_row_model_config(session)
    assert config["max_tokens"] == 4096
    assert config["room_plumbing"] is True

    monkeypatch.setattr(server, "_session_cwd", lambda _session: "/tmp")
    frame = server._compute_host_turn_frame("rid", "sid", session, "hello")
    assert frame["max_tokens_override"] == 4096
