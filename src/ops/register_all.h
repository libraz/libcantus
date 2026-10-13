/**
 * @file register_all.h
 * @brief Registration entry points: one per group of modules, plus the builtin ops.
 *
 * register_<group>() lives in src/ops/<group>.cpp and calls ops::def() for that group's ops;
 * the types it returns get their CANTUS_JSON_FIELDS lines in src/ops/codec_<group>.h.
 */
#ifndef CANTUS_SRC_OPS_REGISTER_ALL_H_
#define CANTUS_SRC_OPS_REGISTER_ALL_H_

namespace cantus::ops {

/** Run every registration function below. Called once by the registry. */
void register_all();

/** The `$`-prefixed boundary ops (src/ops/builtins.cpp). */
void register_builtins();

/** core (layer root), core/validation, core/instrument, core/meter */
void register_c1();
/** core/pitch, core/interval, core/random, core/duration, core/tempo, core/tuning, core/event-index
 */
void register_c2();
/** theory/chord, theory/scale, theory/spelling */
void register_t1();
/** theory/symbol, theory/tendency, theory/counterpoint, theory/transposition, theory/harmony,
 * theory/chordscale, theory/figured-bass */
void register_t2();
/** theory/partwriting, theory/voicing */
void register_t3();
/** theory/safety */
void register_t4();
/** analyze (layer root), analyze/functional */
void register_a1a();
/** analyze/detect, analyze/keys */
void register_a1b();
/** analyze/voice, analyze/melody */
void register_a1c();
/** analyze/timeline, analyze/spelling, analyze/reduction */
void register_a2();
/** analyze/form, analyze/rhythm */
void register_a3();
/** analyze/arrange */
void register_a4();
/** analyze/reference */
void register_a5();
/** generate (layer root), generate/context, generate/vocabulary, generate/drums */
void register_g1();
/** generate/bass, generate/countermelody */
void register_g2a();
/** generate/motif, generate/ornament, generate/groove, generate/rhythm, generate/progression */
void register_g2b();
/** generate/melody, generate/plan */
void register_g3();
/** generate/harmonize, generate/reharmony */
void register_g4();
/** model/{shared, note, interval, duration, meter, tempo, tuning, instrument, voicing} */
void register_m1();
/** model/{key, chord, progression, timeline, score} */
void register_m2();
/** model/{motif, rhythm, arrangement, composer} */
void register_m3();

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_REGISTER_ALL_H_
