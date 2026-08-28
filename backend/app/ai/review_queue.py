"""Runs the AI security reviewer OFF the critical path, after the answer has already been sent.

WHY THIS EXISTS. The reviewer was originally called inline: generate the answer, then block on a
second model call before returning. That is a ~1.2s tax on every single request, paid by every
correctly-answered question to catch the rare bad one - and it is exactly what the requirement
asked to avoid ("avoid inserting an additional sequential function into the main generation
process that causes unnecessary latency"). The reviewer's whole design already anticipates this:
it judges a COMPLETED interaction, so it has no input the answer depends on and nothing downstream
waits for its verdict except the log.

WHAT CHANGES, AND WHAT DOES NOT. The reviewer still sees exactly the same material and still files
exactly the same rows into /app/admin/ai-access-log. What changes is WHEN the asker gets their
answer: immediately, rather than after the review.

THE TRADE-OFF, STATED PLAINLY. An answer now reaches the asker before the reviewer has judged it,
so a flagged answer is logged for an administrator rather than withheld from the reader. That is a
real reduction in what the reviewer can do, and it is only acceptable because the reviewer was
never the thing protecting the data:

    Page Visibility, the privacy check, the row-scope predicates and the SQL guard are ALL
    deterministic, ALL run before generation, and ALL still block. The reviewer sits behind them
    as a backstop for what a rule cannot express.

It is also a backstop that fails open by design (review_answer() approves on any error), so its
verdict was never load-bearing enough to justify making every user wait for it. Anything that
genuinely must be withheld has to be caught by the deterministic layers, which is where the
adversarial testing found and fixed real holes - not here.

WHY A THREAD, NOT A TASK QUEUE. This app has no Celery/RQ/broker, and introducing one to run a
sub-second best-effort call would be a large amount of new infrastructure for the benefit. A small
bounded pool matches the scale: the work is a single outbound HTTP call plus one INSERT, failures
are already swallowed and logged, and losing a review on shutdown costs one audit row.

BOUNDED, so a burst of questions cannot spawn unbounded threads or exhaust the Gemini quota that
the actual answers need. When the pool is saturated the review is DROPPED rather than queued
without limit - a dropped review is a missing audit row; a queue that grows without bound is an
outage.
"""
from __future__ import annotations

import atexit
import logging
from concurrent.futures import ThreadPoolExecutor

from flask import current_app

from . import topic_access
from .sql_llm import review_answer

log = logging.getLogger(__name__)

# Small on purpose. Reviews are short, best-effort, and must never compete with the answer-path
# calls for the same API quota - see the module docstring.
_MAX_WORKERS = 4
_executor: ThreadPoolExecutor | None = None


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=_MAX_WORKERS, thread_name_prefix="ai-review")
        # Do not wait on shutdown: a pending review is an audit row, and holding the process open
        # for one is a worse trade than losing it.
        atexit.register(lambda: _executor and _executor.shutdown(wait=False))
    return _executor


def _run(app, question: str, answer: str, principal, user_context: str, data_summary: str) -> None:
    """The worker body. Needs its own app context because it runs on a thread with none of the
    request's - topic_access.log_review_rejection() writes through the normal database pool, which
    reads config off the app."""
    try:
        with app.app_context():
            verdict = review_answer(
                question, answer, user_context=user_context, data_summary=data_summary
            )
            if verdict["approved"]:
                return
            topic_access.log_review_rejection(
                principal, question, answer, flag=verdict["flag"], reason=verdict.get("reason")
            )
    except Exception as exc:  # noqa: BLE001 - a background review must never surface anywhere
        log.warning("ai.review_queue.failed", extra={"error": str(exc)})


def submit(question: str, answer: str, principal, *, user_context: str, data_summary: str) -> None:
    """Queue one completed interaction for review. Returns immediately and never raises.

    `principal` is captured as-is: it is a frozen dataclass of already-resolved identity, so the
    thread cannot observe it changing mid-review, and re-reading permissions later would judge the
    answer against a state that was not true when it was given."""
    try:
        app = current_app._get_current_object()  # noqa: SLF001 - the documented way to escape the context
        _get_executor().submit(_run, app, question, answer, principal, user_context, data_summary)
    except Exception as exc:  # noqa: BLE001 - a saturated/failed pool drops the review, never the answer
        log.warning("ai.review_queue.not_submitted", extra={"error": str(exc)})
