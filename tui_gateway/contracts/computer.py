"""Read-only work-feed contract for the Desktop Computer pane."""

from __future__ import annotations

from pydantic import Field

from .base import Params, Result, WireEnum
from .registry import method


class ComputerStepKind(WireEnum):
    browser = "browser"
    terminal = "terminal"
    code = "code"
    search = "search"
    plan = "plan"
    delegate = "delegate"
    memory = "memory"
    ask = "ask"
    other = "other"


class ComputerStepStatus(WireEnum):
    running = "running"
    ok = "ok"
    error = "error"


class ComputerFeedParams(Params):
    """``profile`` selects the served home; ``session_id`` is its canonical Bot Chat tip."""

    session_id: str = Field(min_length=1)
    profile: str | None = None
    after: int = Field(default=0, ge=0)
    limit: int = Field(default=240, ge=1, le=500)


class ComputerSession(Result):
    id: str
    title: str = ""
    model: str = ""
    started_at: float = 0
    last_activity_at: float | None = None
    ended_at: float | None = None
    status: str = "idle"
    tool_calls: int = 0


class ComputerStep(Result):
    id: str
    seq: int
    ts: float = 0
    done_ts: float | None = None
    tool: str
    kind: ComputerStepKind
    status: ComputerStepStatus
    title: str
    preview: str | None = None
    error: str | None = None


class ComputerPlanStep(Result):
    id: str
    title: str
    status: str = "not_started"


class ComputerPlan(Result):
    id: str
    goal: str = ""
    status: str = "active"
    steps: list[ComputerPlanStep] = Field(default_factory=list)
    done: int = 0
    total: int = 0
    current: str | None = None


class ComputerHelper(Result):
    id: str
    title: str = ""
    goal: str | None = None
    status: str = "idle"
    started_at: float = 0
    ended_at: float | None = None
    last_activity_at: float | None = None
    tool_calls: int = 0
    last_step: str | None = None


class ComputerFeedResult(Result):
    session: ComputerSession
    cursor: int = 0
    steps: list[ComputerStep] = Field(default_factory=list)
    plan: ComputerPlan | None = None
    helpers: list[ComputerHelper] = Field(default_factory=list)
    say: str | None = None
    now: float


method(
    "computer.feed",
    params=ComputerFeedParams,
    result=ComputerFeedResult,
    doc="Bounded, redacted tool timeline for one profile's canonical Bot Chat.",
)
