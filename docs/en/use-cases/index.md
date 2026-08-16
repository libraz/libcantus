# Use cases

These guides start with the data an application already has and show what to do with the result. They complement the domain pages and the generated API reference.

Each one is written in the class API, since a flow that runs end to end is what the classes are for: a `Score` holds the notes with their meter, tempo and key, a `Composer` holds the key, tempo and seed one piece is written under, and a chain of questions asks each one once. Where a step has no class to hold it, the guide calls the function and says why.

Analysis and inspection:

- [DAW workflow](daw-workflow.md): infer harmony from tracks with `Score`, then write a bass line against it with `Composer`.
- [Piece analysis](piece-analysis.md): one score's key regions, cadences, reduction, phrases, sections, and motifs.
- [Modulation report](modulation-report.md): present key changes with their pivots, confidences, and the relation between consecutive keys.
- [Harmony exercise checker](harmony-exercise-checker.md): report part-writing and species-counterpoint violations on a `Voicing`.

Producing material:

- [Generative arrangement](generative-arrangement.md): one seeded `Composer` writing a progression, parts, and drums, then a playability check.
- [Chord chart import](chord-chart-import.md): turn typed chord symbols into a `Timeline`, voicings, and a bass line.
- [Part preparation](part-preparation.md): fit a part to an `Instrument` and write it at the pitch its player reads.

All examples use MIDI pitch numbers and quarter-note beats. File I/O, MIDI parsing, notation, audio analysis, and playback remain the host application's job; see [Interoperability](../interoperability.md) for the conversions at that boundary.
