"""Cost growth of calls on a retained receiver: the data must not travel on every call."""

from __future__ import annotations

import time
from collections.abc import Callable

import libcantus

# The input grows by GROWTH; a linear cost grows by as much, a constant one not at all.
GROWTH = 4
# A per-call cost may grow by this factor between the two sizes; linear would be GROWTH.
TOLERANCE = 2.0
CALLS = 200
SAMPLES = 5
# Slack in seconds per call: 1 ms per run of CALLS calls, so two readings in the timer noise pass.
SLACK = 0.001 / CALLS


def per_call(run: Callable[[], None]) -> float:
    """The best of several runs of ``run``, in seconds per call."""
    run()
    best = float("inf")
    for _ in range(SAMPLES):
        started = time.perf_counter()
        run()
        best = min(best, (time.perf_counter() - started) / CALLS)
    return best


def score_of(size: int) -> libcantus.Score:
    notes = [{"pitch": 60 + i % 12, "startBeat": i, "durationBeat": 1} for i in range(size)]
    score: libcantus.Score = libcantus.Score.of(notes)
    return score


def loop_cost(size: int) -> float:
    score = score_of(size)

    def run() -> None:
        for i in range(CALLS):
            score.seconds_at(i % 8)

    return per_call(run)


def test_seconds_at_per_call_cost_does_not_grow_with_the_score() -> None:
    small_size = 500
    small = loop_cost(small_size)
    large = loop_cost(small_size * GROWTH)
    assert large < small * TOLERANCE + SLACK, (
        f"{small_size} notes: {small * 1e6:.1f}us/call, "
        f"{small_size * GROWTH} notes: {large * 1e6:.1f}us/call"
    )
