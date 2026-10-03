"""Profile-scoped read-only projection for Desktop's contextual Computer pane.

The pane is deliberately a projection of persisted Hermes state. It does not
replay tools, read browser history, or manufacture a recording from screenshots.
``computer.feed`` opens the currently scoped profile's state database read-only
and returns bounded, redacted labels/previews for one explicit session.
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path

from .method_ctx import HandlerRegistry, bind_module

logger = logging.getLogger(__name__)
_registry = HandlerRegistry()
method = _registry.method
_profile_scoped = _registry.profile_scoped

_COMPUTER_RUNNING_WINDOW_S = 90.0
_COMPUTER_TITLE_LIMIT = 100
_COMPUTER_PREVIEW_LIMIT = 1600
_COMPUTER_SAY_LIMIT = 600

_COMPUTER_TERMINAL_TOOLS = {"terminal", "process", "execute_code", "shell", "bash"}
_COMPUTER_CODE_TOOLS = {
    "apply_patch",
    "edit_file",
    "patch",
    "read_file",
    "search_files",
    "write_file",
}
_COMPUTER_SEARCH_TOOLS = {"web_extract", "web_search", "rescuer_fetch"}

_COMPUTER_SECRET_ASSIGNMENT = re.compile(
    r"(?i)(\b(?:api[_-]?key|access[_-]?token|auth(?:orization)?|bearer|cookie|credential|password|"
    r"private[_-]?key|refresh[_-]?token|secret|session[_-]?token|token)\b\s*[\"']?\s*[:=]\s*[\"']?)"
    r"([^\s,;\"']+|\"[^\"]*\"|'[^']*')"
)
_COMPUTER_BEARER = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{8,}")
_COMPUTER_PROVIDER_KEY = re.compile(
    r"\b(?:sk|rk|pk|ghp|github_pat|xox[baprs]|AKIA)[-_A-Za-z0-9]{12,}\b"
)
_COMPUTER_PEM = re.compile(
    r"-----BEGIN [^-\n]*(?:PRIVATE KEY|CERTIFICATE)-----.*?-----END [^-\n]+-----",
    re.DOTALL,
)
_COMPUTER_PLAN_ID = re.compile(r'"plan_id"\s*:\s*"([A-Za-z0-9_-]+)"')
_COMPUTER_URL = re.compile(r"https?://[^\s'\"<>)\]}]+")


class _ComputerCall:
    __slots__ = ("call_id", "seq", "position", "ts", "name", "raw_args")

    def __init__(self, call_id, seq, position, ts, name, raw_args):
        self.call_id = call_id
        self.seq = seq
        self.position = position
        self.ts = ts
        self.name = name
        self.raw_args = raw_args


def _computer_redact(value, limit=_COMPUTER_PREVIEW_LIMIT):
    text = str(value or "")
    text = _COMPUTER_PEM.sub("[redacted private material]", text)
    text = _COMPUTER_BEARER.sub("Bearer [redacted]", text)
    text = _COMPUTER_SECRET_ASSIGNMENT.sub(lambda hit: hit.group(1) + "[redacted]", text)
    text = _COMPUTER_PROVIDER_KEY.sub("[redacted credential]", text)
    if len(text) > limit:
        text = text[: max(0, limit - 1)].rstrip() + "…"
    return text


def _computer_one_line(value, limit=_COMPUTER_TITLE_LIMIT):
    return _computer_redact(" ".join(str(value or "").split()), limit)


def _computer_args(raw):
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        loaded = json.loads(raw)
        return loaded if isinstance(loaded, dict) else {}
    except (TypeError, ValueError):
        # Persisted previews can end midway through a JSON string. Recover only
        # the small display fields we understand; unknown text is never echoed.
        out = {}
        for key in ("action", "command", "goal", "path", "query", "step", "url"):
            hit = re.search(rf'[\"\']{key}[\"\']\s*:\s*[\"\']([^\"\'\n]{{0,1200}})', raw)
            if hit:
                out[key] = hit.group(1)
        return out


def _computer_expand(name, raw_args):
    args = _computer_args(raw_args)
    if name != "tool_call":
        return [(name, args)]
    calls = args.get("calls")
    if isinstance(calls, str):
        try:
            calls = json.loads(calls)
        except ValueError:
            calls = None
    if not isinstance(calls, list):
        calls = [args] if args.get("name") else []
    expanded = []
    for call in calls:
        if not isinstance(call, dict) or not isinstance(call.get("name"), str):
            continue
        expanded.append((call["name"], _computer_args(call.get("arguments"))))
    return expanded or [(name, args)]


def _computer_kind(name):
    lowered = str(name or "").lower()
    if lowered in _COMPUTER_TERMINAL_TOOLS or lowered.startswith(("terminal_", "process_")):
        return "terminal"
    if lowered in _COMPUTER_CODE_TOOLS or any(part in lowered for part in ("write_file", "read_file", "patch")):
        return "code"
    if lowered in _COMPUTER_SEARCH_TOOLS or "search_engine" in lowered or "scrape" in lowered:
        return "search"
    if lowered.startswith("browser") or lowered.startswith("computer_use"):
        return "browser"
    if lowered in {"handflow", "create_goal", "update_goal", "update_plan"}:
        return "plan"
    if lowered in {"delegate_task", "spawn_agent", "send_message", "wait_agent"}:
        return "delegate"
    if lowered == "memory" or lowered.startswith("hindsight_"):
        return "memory"
    if lowered in {"ask_user", "clarify", "request_user_input"}:
        return "ask"
    return "other"


def _computer_host(value):
    hit = _COMPUTER_URL.search(str(value or ""))
    if not hit:
        return ""
    try:
        from urllib.parse import urlparse

        return (urlparse(hit.group(0)).hostname or "").removeprefix("www.")
    except ValueError:
        return ""


def _computer_title(name, kind, args):
    if kind == "terminal":
        command = args.get("command") or args.get("cmd") or args.get("code")
        return _computer_one_line(f"Running {command}" if command else f"Running {name}")
    if kind == "code":
        path = args.get("path") or args.get("file_path") or args.get("file")
        verb = "Reading" if "read" in name else "Searching" if "search" in name else "Editing"
        return _computer_one_line(f"{verb} {path}" if path else name.replace("_", " ").title())
    if kind == "search":
        query = args.get("query") or args.get("q") or args.get("url")
        return _computer_one_line(f"Searching for {query}" if query else name.replace("_", " ").title())
    if kind == "browser":
        host = _computer_host(args.get("url") or args.get("code") or "")
        return _computer_one_line(f"Opening {host}" if host else "Working in the browser")
    if kind == "plan":
        action = args.get("action") or args.get("step")
        return _computer_one_line(f"Plan · {action}" if action else "Updating the plan")
    if kind == "delegate":
        goal = args.get("goal") or args.get("task") or args.get("message")
        return _computer_one_line(f"Helping with {goal}" if goal else "Coordinating a helper")
    label = name.replace("__", " · ").replace("_", " ").strip()
    return _computer_one_line(label[:1].upper() + label[1:] if label else "Tool activity")


def _computer_result_error(content):
    text = str(content or "")
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        data = None
    if isinstance(data, dict):
        if data.get("success") is False or data.get("ok") is False or data.get("status") in {"error", "failed"}:
            return _computer_one_line(data.get("error") or data.get("message") or "Tool failed", 400)
        code = data.get("exit_code")
        if isinstance(code, int) and code != 0:
            return _computer_one_line(data.get("error") or f"Exit code {code}", 400)
    if text.lower().startswith("error:"):
        return _computer_one_line(text, 400)
    return None


def _computer_preview(kind, content):
    if content in (None, ""):
        return None
    text = str(content)
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        data = None
    if isinstance(data, dict):
        for key in ("output", "result", "summary", "message", "content"):
            value = data.get(key)
            if isinstance(value, (str, int, float)) and str(value).strip():
                text = str(value)
                break
    # Terminal output is most useful from the end; other activity reads from
    # the beginning. Redaction happens after the slice so no secret-shaped
    # value can survive either path.
    if kind == "terminal" and len(text) > _COMPUTER_PREVIEW_LIMIT:
        text = "…\n" + text[-(_COMPUTER_PREVIEW_LIMIT - 2) :]
    return _computer_redact(text, _COMPUTER_PREVIEW_LIMIT)


def _computer_connect():
    import sqlite3

    from hermes_constants import get_hermes_home

    path = Path(get_hermes_home()) / "state.db"
    if not path.is_file():
        raise FileNotFoundError(f"Session storage is unavailable under {path.parent}")
    from urllib.parse import quote

    uri = f"file:{quote(str(path))}?mode=ro"
    try:
        from hermes_cli.sqlite_safe_read import connect_tracked

        conn = connect_tracked(uri, tracking_path=path, uri=True, timeout=2.0, check_same_thread=False)
    except ImportError:
        conn = sqlite3.connect(uri, uri=True, timeout=2.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = 1")
    return conn


def _computer_calls(conn, session_id):
    calls = []
    seen = set()
    rows = conn.execute(
        "SELECT id, timestamp, tool_calls FROM messages "
        "WHERE session_id = ? AND role = 'assistant' AND tool_calls IS NOT NULL ORDER BY id",
        (session_id,),
    )
    for row in rows:
        try:
            items = json.loads(row["tool_calls"])
        except (TypeError, ValueError):
            continue
        if not isinstance(items, list):
            continue
        for position, call in enumerate(items):
            if not isinstance(call, dict):
                continue
            fn = call.get("function") if isinstance(call.get("function"), dict) else call
            call_id = call.get("id") or call.get("call_id")
            name = fn.get("name")
            if not isinstance(call_id, str) or not call_id or call_id in seen or not isinstance(name, str) or not name:
                continue
            seen.add(call_id)
            calls.append(_ComputerCall(call_id, int(row["id"]), position, float(row["timestamp"] or 0), name, fn.get("arguments")))
    return calls


def _computer_results(conn, session_id):
    out = {}
    rows = conn.execute(
        "SELECT id, tool_call_id, timestamp, content FROM messages "
        "WHERE session_id = ? AND role = 'tool' AND tool_call_id IS NOT NULL ORDER BY id",
        (session_id,),
    )
    for row in rows:
        out.setdefault(
            row["tool_call_id"],
            (int(row["id"]), float(row["timestamp"] or 0), row["content"]),
        )
    return out


def _computer_steps(conn, session_id, after, limit, ended):
    results = _computer_results(conn, session_id)
    units = []
    for call in _computer_calls(conn, session_id):
        result = results.get(call.call_id)
        if after and call.seq <= after and (not result or result[0] <= after):
            continue
        expanded = _computer_expand(call.name, call.raw_args)
        for index, (name, args) in enumerate(expanded):
            step_id = call.call_id if len(expanded) == 1 else f"{call.call_id}#{index}"
            units.append((step_id, call, name, args, result))
    steps = []
    for step_id, call, name, args, result in units[-limit:]:
        kind = _computer_kind(name)
        error = _computer_result_error(result[2]) if result else None
        status = "error" if error or (ended and not result) else "ok" if result else "running"
        if status == "error" and not error:
            error = "No result was recorded for this call"
        steps.append(
            {
                "id": step_id,
                "seq": call.seq,
                "ts": call.ts,
                "done_ts": result[1] if result else None,
                "tool": name,
                "kind": kind,
                "status": status,
                "title": _computer_title(name, kind, args),
                "preview": _computer_preview(kind, result[2]) if result else None,
                "error": error,
            }
        )
    return steps


def _computer_message_marks(conn, session_id):
    row = conn.execute(
        "SELECT COALESCE(MAX(id), 0), MAX(timestamp) FROM messages WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    return int(row[0] or 0), float(row[1]) if row and row[1] is not None else None


def _computer_session(conn, row, now, marks=None):
    marks = marks or _computer_message_marks(conn, row["id"])
    activity_values = [value for value in (row["last_activity_at"], marks[1]) if value is not None]
    activity = max(float(value) for value in activity_values) if activity_values else None
    ended = float(row["ended_at"]) if row["ended_at"] is not None else None
    status = "ended" if ended is not None else "running" if activity and now - activity <= _COMPUTER_RUNNING_WINDOW_S else "idle"
    return {
        "id": row["id"],
        "title": str(row["title"] or ""),
        "model": str(row["model"] or ""),
        "started_at": float(row["started_at"] or 0),
        "last_activity_at": activity,
        "ended_at": ended,
        "status": status,
        "tool_calls": int(row["tool_call_count"] or 0),
    }


def _computer_last_step(conn, session_id):
    row = conn.execute(
        "SELECT tool_calls FROM messages WHERE session_id = ? AND role = 'assistant' "
        "AND tool_calls IS NOT NULL ORDER BY id DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    if not row:
        return None
    try:
        calls = json.loads(row[0])
    except (TypeError, ValueError):
        return None
    if not isinstance(calls, list) or not calls or not isinstance(calls[-1], dict):
        return None
    call = calls[-1]
    fn = call.get("function") if isinstance(call.get("function"), dict) else call
    expanded = _computer_expand(str(fn.get("name") or ""), fn.get("arguments"))
    name, args = expanded[-1]
    return _computer_title(name, _computer_kind(name), args)


def _computer_helpers(conn, parent, now):
    rows = conn.execute(
        "SELECT id, title, model, source, started_at, ended_at, last_activity_at, tool_call_count, model_config "
        "FROM sessions WHERE parent_session_id = ? ORDER BY started_at DESC LIMIT 24",
        (parent["id"],),
    ).fetchall()
    helpers = []
    for row in rows:
        config = {}
        try:
            config = json.loads(row["model_config"] or "{}")
        except (TypeError, ValueError):
            pass
        delegated = row["source"] == "subagent" or bool(config.get("_delegate_from"))
        if not delegated:
            continue
        marks = _computer_message_marks(conn, row["id"])
        activity_values = [value for value in (row["last_activity_at"], marks[1]) if value is not None]
        activity = max(float(value) for value in activity_values) if activity_values else None
        ended = float(row["ended_at"]) if row["ended_at"] is not None else None
        status = "done" if ended is not None else "running" if activity and now - activity <= _COMPUTER_RUNNING_WINDOW_S else "idle"
        goal_row = conn.execute(
            "SELECT content FROM messages WHERE session_id = ? AND role = 'user' "
            "AND COALESCE(_compressed_summary, 0) = 0 ORDER BY id LIMIT 1",
            (row["id"],),
        ).fetchone()
        helpers.append(
            {
                "id": row["id"],
                "title": _computer_one_line(row["title"] or "", 160),
                "goal": _computer_one_line(goal_row[0], 240) if goal_row and goal_row[0] else None,
                "status": status,
                "started_at": float(row["started_at"] or 0),
                "ended_at": ended,
                "last_activity_at": activity,
                "tool_calls": int(row["tool_call_count"] or 0),
                "last_step": _computer_last_step(conn, row["id"]),
            }
        )
    return helpers


def _computer_plan(conn, session_id):
    rows = conn.execute(
        "SELECT id, tool_call_id, substr(content, 1, 2000) FROM messages "
        "WHERE session_id = ? AND role = 'tool' AND tool_name IN ('handflow', 'tool_call') ORDER BY id",
        (session_id,),
    ).fetchall()
    plan_id = None
    for row in rows:
        hit = _COMPUTER_PLAN_ID.search(str(row[2] or ""))
        if hit:
            plan_id = hit.group(1)
    if not plan_id:
        return None
    from hermes_constants import get_hermes_home

    path = Path(get_hermes_home()) / "handflow" / "plans" / f"{plan_id}.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    steps = []
    current = None
    done = 0
    for index, item in enumerate(raw.get("steps") or []):
        if not isinstance(item, dict):
            continue
        step_id = str(item.get("id") or f"s{index + 1:02d}")
        status = str(item.get("status") or "not_started")
        if status == "completed":
            done += 1
        if status == "in_progress" and current is None:
            current = step_id
        steps.append(
            {
                "id": step_id,
                "title": _computer_one_line(item.get("title") or f"Step {index + 1}", 240),
                "status": status,
            }
        )
    return {
        "id": str(raw.get("id") or plan_id),
        "goal": _computer_redact(raw.get("goal") or "", 500),
        "status": str(raw.get("status") or "active"),
        "steps": steps,
        "done": done,
        "total": len(steps),
        "current": current,
    }


def _computer_say(conn, session_id):
    row = conn.execute(
        "SELECT content FROM messages WHERE session_id = ? AND role = 'assistant' "
        "AND content IS NOT NULL AND length(trim(content)) > 0 "
        "AND COALESCE(_compressed_summary, 0) = 0 ORDER BY id DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    return _computer_redact(row[0], _COMPUTER_SAY_LIMIT) if row and row[0] else None


@method("computer.feed")
@_profile_scoped
def _(rid, params):
    import sqlite3

    session_id = str(params.get("session_id") or "").strip()
    after = max(0, int(params.get("after") or 0))
    limit = min(500, max(1, int(params.get("limit") or 240)))
    try:
        conn = _computer_connect()
    except (OSError, sqlite3.Error) as exc:
        logger.warning("computer.feed: profile storage unavailable: %s", exc)
        return _err(rid, 5503, "Session storage is unavailable")
    try:
        row = conn.execute(
            "SELECT id, title, model, source, started_at, ended_at, end_reason, last_activity_at, "
            "tool_call_count, parent_session_id, model_config FROM sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        if row is None:
            return _err(rid, 5404, "Canonical Bot Chat session was not found in this profile")
        now = time.time()
        marks = _computer_message_marks(conn, session_id)
        return _ok(
            rid,
            {
                "session": _computer_session(conn, row, now, marks),
                "cursor": max(after, marks[0]),
                "steps": _computer_steps(conn, session_id, after, limit, row["ended_at"] is not None)
                if not after or marks[0] > after
                else [],
                "plan": _computer_plan(conn, session_id),
                "helpers": _computer_helpers(conn, row, now),
                "say": _computer_say(conn, session_id),
                "now": now,
            },
        )
    except sqlite3.Error:
        logger.exception("computer.feed failed for %s", session_id)
        return _err(rid, 5503, "Session storage is temporarily unavailable")
    finally:
        conn.close()


def register(server):
    bind_module(globals(), server, skip=("_",))
