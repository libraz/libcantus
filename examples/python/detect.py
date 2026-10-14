"""Reads four bars of block chords through the Python binding."""

import libcantus

print(libcantus.detect_chord_best([60, 64, 67]))

chords = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]]
notes = [
    {"pitch": pitch, "startBeat": bar * 4, "durationBeat": 4}
    for bar, pitches in enumerate(chords)
    for pitch in pitches
]
timeline = libcantus.Score.of(notes).timeline()
numerals = [entry["roman"] for entry in timeline.roman()]
print(numerals)
assert numerals == ["I", "IV", "V7", "I"]

try:
    libcantus.detect_chord([128])
except libcantus.InvalidInputError as error:
    print(error)
else:
    raise SystemExit("expected InvalidInputError")
