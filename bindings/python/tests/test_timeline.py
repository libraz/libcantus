"""Chord timelines read through the shared core."""

from __future__ import annotations

from typing import Any

import libcantus


def held(pitches: list[int], start: float, duration: float = 4) -> list[dict[str, Any]]:
    return [{"pitch": pitch, "startBeat": start, "durationBeat": duration} for pitch in pitches]


class TestLonePitchClassArrival:
    def test_a_held_tonic_after_the_dominant_closes_an_authentic_cadence(self) -> None:
        notes = held([60, 64, 67], 0) + held([55, 59, 62], 4) + held([60], 8, 8)
        result = libcantus.chord_timeline_from_notes(notes, key="C major")
        segments = result["timeline"].segments
        last = segments[-1]
        assert (last["startBeat"], last["endBeat"]) == (8, 16)
        assert (last["chord"]["rootPc"], last["chord"]["quality"]) == (0, "maj")
        hits = libcantus.detect_cadences(result["timeline"], result["prevailingKey"])
        assert [(hit["atBeat"], hit["cadence"]["type"]) for hit in hits] == [
            (4, "half"),
            (8, "authentic"),
        ]

    def test_a_lone_pitch_class_on_its_own_still_names_no_chord(self) -> None:
        result = libcantus.chord_timeline_from_notes(held([60], 0), key="C major")
        assert result["timeline"].segments == []
