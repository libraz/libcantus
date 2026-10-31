// The groove generator of ts/src/generate/drums/index.ts.

#include "generate/drums/drums.h"

#include <algorithm>
#include <cmath>
#include <iterator>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/meter.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "generate/drums/beat.h"
#include "generate/drums/euclid.h"
#include "generate/drums/fills.h"
#include "generate/drums/hihat.h"
#include "generate/drums/hit.h"
#include "generate/drums/internal.h"
#include "generate/drums/kick.h"
#include "generate/drums/percussion.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/**
 * Drop the strokes a player at this ceiling could not reach in time (`underCeiling`). Strokes are
 * settled in the order the rhythmic dial brings them in, then in time, and one too close to a
 * stroke already kept is dropped, so raising the dial only adds strokes. Exempt onsets stay.
 */
std::vector<DrumHit> under_ceiling(const std::vector<DrumHit>& hits, double bpm,
                                   std::optional<double> difficulty,
                                   const std::set<std::string>& exempt,
                                   const HitList<DrumHit>& track) {
  if (!difficulty) {
    return hits;
  }
  std::vector<double> entries;
  std::vector<std::size_t> order;
  for (std::size_t index = 0; index < hits.size(); ++index) {
    entries.push_back(track.entry_of(hits[index].pitch, hits[index].startBeat));
    order.push_back(index);
  }
  std::stable_sort(order.begin(), order.end(),
                   [&entries](std::size_t a, std::size_t b) { return entries[a] < entries[b]; });
  // The kept onsets of each pitch, in time order.
  std::map<int, std::set<double>> kept_beats;
  std::vector<bool> kept(hits.size(), false);
  for (std::size_t index : order) {
    const DrumHit& hit = hits[index];
    std::set<double>& beats = kept_beats[hit.pitch];
    auto next = beats.upper_bound(hit.startBeat);
    bool reachable =
        exempt.count(onset_key(hit.pitch, hit.startBeat)) > 0 ||
        ((next == beats.begin() ||
          sustains_strokes(hit.startBeat - *std::prev(next), bpm, difficulty)) &&
         (next == beats.end() || sustains_strokes(*next - hit.startBeat, bpm, difficulty)));
    if (!reachable) {
      continue;
    }
    kept[index] = true;
    beats.insert(hit.startBeat);
  }
  std::vector<DrumHit> out;
  for (std::size_t index = 0; index < hits.size(); ++index) {
    if (kept[index]) {
      out.push_back(hits[index]);
    }
  }
  return out;
}

}  // namespace

std::vector<DrumHit> generate_drums_with(const DrumsRequest& request,
                                         const ResolvedContext& resolved) {
  HitList<DrumHit> track;
  Draw draw = resolved.part("drums");
  double bpm = resolved.bpm.value_or(DRUMS_DEFAULT_BPM);
  double rhythmic = resolved.rhythmic.value_or(DRUM_DEFAULT_RHYTHMIC);
  // Ghosts follow the ornament dial; with none named the rhythmic dial stands in.
  double ornament_dial = resolved.ornament.value_or(rhythmic);
  std::optional<double> difficulty = resolved.difficulty;
  StyleMapping mapping = map_style(request.style);
  DrumStyle style = mapping.style;
  GrooveFeel feel = request.feel.value_or(mapping.feel);
  DrumRole role = request.role;
  double bar_beats = beats_per_bar(request.ts);
  // fxOnly leaves only the fx and auxiliary voices.
  bool play_main_voices = role != DrumRole::kFxOnly;
  SectionType section = map_section(request.section);
  double swing_amount = feel_swing_amount(feel);
  double density_mult = section_density_multiplier(section) * backing_scale(rhythmic);

  SectionCtx sec{style,
                 feel,
                 request.feel.has_value(),
                 density_mult,
                 rhythmic,
                 ornament_dial,
                 !resolved.ornament.has_value(),
                 difficulty,
                 mapping.ghostBoost,
                 should_use_ride_for_section(section, style),
                 should_use_foot_hi_hat(section, role),
                 role,
                 ghost_mood_category(style),
                 mapping.snareBeat3};

  double ohh_bar_interval = open_hi_hat_bar_interval(section, style);
  SectionEnergy energy = section_energy(section);
  double fill_start_beat = get_fill_start_beat(energy);
  double fill_velocity = calculate_velocity(section, fill_start_beat);
  PercMoodCategory perc_mood = perc_mood_category(style);

  // The final-bar fill is shaped by the section it leads into; within-section when none is named.
  SectionType next_section = request.nextSection ? map_section(*request.nextSection) : section;
  SectionEnergy next_energy = section_energy(next_section);

  // Fills a caller brought, filtered by the conditions they state and offered after the table.
  VocabularyQuery fill_query;
  fill_query.section = request.section;
  fill_query.bpm = bpm;
  fill_query.difficulty = difficulty;
  std::vector<Vocabulary<FillArchetype>> supplied_fills =
      vocabulary_of_kind<FillArchetype>(resolved.vocabulary);
  // Read for its strokes here, as a caller's drum pattern is.
  for (std::size_t index = 0; index < supplied_fills.size(); ++index) {
    assert_fill_archetype(supplied_fills[index].material,
                          "drum fill vocabulary[" + index_text(index) + "]");
  }
  std::vector<Vocabulary<FillArchetype>> caller_fill_entries =
      select_vocabulary(supplied_fills, fill_query);
  SuppliedFills caller_fills;
  std::vector<std::string> caller_fill_ids;
  for (const Vocabulary<FillArchetype>& entry : caller_fill_entries) {
    caller_fills.emplace_back(entry.id, entry.material);
    caller_fill_ids.push_back(entry.id);
  }

  std::optional<std::vector<bool>> euclid_kick;
  double euclid_steps = request.euclidean ? request.euclidean->steps : 16;
  if (request.euclidean) {
    euclid_kick =
        euclidean_rhythm(request.euclidean->pulses, euclid_steps, request.euclidean->rotation);
  }

  bool reuse_section_kick = (section == SectionType::kB || section == SectionType::kChorus) &&
                            style != DrumStyle::kSparse;
  std::optional<KickEntries> section_kick;

  // Onsets written from a pattern the caller named, which the ceiling spares.
  std::set<std::string> exempt_onsets;

  for (int bar_index = 0; bar_index < request.bars; ++bar_index) {
    double bar = bar_index;
    double bar_start = bar * bar_beats;
    bool is_last_bar = bar_index == request.bars - 1;
    HiHatBar hi_hat = get_hi_hat_bar(section, style, rhythmic, bpm, draw, difficulty, bar);

    if (bar_index == 0 && section == SectionType::kChorus) {
      track.add(kGm.CRASH, bar_start, 0.5, 100 * density_mult);
    }

    bool bar_has_open_hh = false;
    double open_hh_beat_index = 3;
    if (ohh_bar_interval > 0 && std::fmod(bar, ohh_bar_interval) == ohh_bar_interval - 1) {
      open_hh_beat_index = open_hi_hat_beat(section, draw, bar);
      bar_has_open_hh = !track.has_crash_near(bar_start + open_hh_beat_index);
    }

    std::optional<KickEntries> kick;
    if (!euclid_kick && reuse_section_kick) {
      if (!section_kick) {
        section_kick = get_kick_entries(section, style, 0, draw, rhythmic);
      }
      kick = section_kick;
    } else if (!euclid_kick) {
      kick = get_kick_entries(section, style, bar, draw, rhythmic);
    }

    // The lift is a build into a chorus, so what follows decides it.
    bool in_lift =
        is_in_pre_chorus_lift(section, bar, request.bars, next_section == SectionType::kChorus);
    const FillArchetype* current_fill =
        &FILL_ARCHETYPES[static_cast<std::size_t>(FillType::kSnareRoll)];

    for (double beat = 0; beat < bar_beats; beat += 1) {
      double beat_tick = bar_start + beat;
      double velocity = calculate_velocity(section, beat);

      if (request.fills && is_last_bar && !in_lift && beat >= fill_start_beat) {
        if (beat == fill_start_beat) {
          // An archetype whose strokes run faster than the ceiling sustains leaves the table.
          std::optional<std::string> chosen = select_fill_type(
              section, next_section, style, next_energy, draw, bar, caller_fill_ids,
              [&](const std::string& id) {
                const FillArchetype* candidate = fill_archetype_for(id, caller_fills);
                return candidate != nullptr &&
                       fill_within_ceiling(*candidate, fill_start_beat, bar_beats, bpm, difficulty);
              });
          current_fill = chosen ? fill_archetype_for(*chosen, caller_fills) : nullptr;
        }
        if (play_main_voices) {
          std::size_t before = track.hits().size();
          if (current_fill != nullptr) {
            // One base velocity for the whole fill, read at the beat it starts on.
            generate_fill(
                track, beat_tick, beat, *current_fill, fill_velocity,
                [&sec, swing_amount](double tick) { return swing16(tick, sec, swing_amount); });
          }
          if (track.hits().size() > before) {
            continue;
          }
          // An archetype silent on this beat falls through to the groove.
        } else {
          continue;
        }
      }

      BeatCtx ctx{track,
                  beat_tick,
                  beat,
                  velocity,
                  section,
                  bpm,
                  bar,
                  static_cast<double>(request.bars),
                  in_lift,
                  swing_amount,
                  bar_has_open_hh,
                  open_hh_beat_index,
                  hi_hat.level,
                  hi_hat.entries,
                  draw};

      if (play_main_voices) {
        if (in_lift) {
          generate_pre_chorus_buildup(ctx, sec, is_last_bar);
        }
        if (euclid_kick && !in_lift) {
          double step_length = bar_beats / euclid_steps;
          for (std::size_t step = 0; step < euclid_kick->size(); ++step) {
            double onset = static_cast<double>(step) * step_length;
            if ((*euclid_kick)[step] && std::floor(onset) == beat) {
              bool whole_beat = std::abs(onset - js::round(onset)) < 1e-9;
              double tick = swing16(bar_start + onset, sec, swing_amount);
              // Naming the pattern is the request that it be written as given.
              exempt_onsets.insert(onset_key(kGm.BD, tick));
              track.add(kGm.BD, tick, js::min(0.5, step_length),
                        velocity * (whole_beat ? 1 : 0.85));
            }
          }
        } else if (kick) {
          generate_kick_for_beat(ctx, sec, *kick);
        }
        generate_snare_for_beat(ctx, sec, section == SectionType::kIntro && bar_index == 0);
        if (!in_lift) {
          generate_ghost_notes_for_beat(ctx, sec);
        }
      }
      generate_hi_hat_for_beat(ctx, sec);
    }

    if (sec.useFootHh && should_play_hi_hat(role)) {
      for (double fhh_beat = 0; fhh_beat < bar_beats; fhh_beat += 2) {
        double fhh_tick = bar_start + fhh_beat;
        if (!track.has_onset(kGm.FHH, fhh_tick)) {
          track.add(kGm.FHH, fhh_tick, 0.5, foot_hi_hat_velocity(draw, bar, fhh_beat));
        }
      }
    }

    PercussionConfig percussion_config = get_percussion_config(perc_mood, section);
    if (role == DrumRole::kFxOnly && !percussion_config.tambourine && !percussion_config.shaker &&
        !percussion_config.handclap) {
      percussion_config = PercussionConfig{false, true, false, false};
    }
    generate_aux_percussion_for_bar(track, bar_start, percussion_config, role, density_mult, draw,
                                    bpm, sec, swing_amount, bar_beats);
  }

  // Foot hi-hats and auxiliary percussion are appended after the beat loop, so sort.
  double end_beat = request.bars * bar_beats;
  std::vector<DrumHit> written;
  for (const DrumHit& hit : track.hits()) {
    if (hit.startBeat < end_beat && (!request.playable || request.playable(hit.pitch))) {
      written.push_back(hit);
    }
  }
  std::stable_sort(written.begin(), written.end(), [](const DrumHit& a, const DrumHit& b) {
    return a.startBeat != b.startBeat ? a.startBeat < b.startBeat : a.pitch < b.pitch;
  });
  return under_ceiling(written, bpm, difficulty, exempt_onsets, track);
}

std::vector<DrumHit> generate_drums(const DrumsOptions& opts) {
  assert_positive_int(opts.bars, "drum bars");
  // Generation is linear in bar count, so the estimate is the hit count itself.
  assert_generation_budget(opts.bars * MAX_HITS_PER_BAR, "drum hits", opts.budget);
  DrumsRequest request;
  if (opts.euclideanKick) {
    double steps = opts.euclideanKick->steps.value_or(16);
    assert_integer(steps, "euclidean steps", 1, 16);
    assert_integer(static_cast<double>(opts.euclideanKick->pulses), "euclidean pulses");
    double rotation = static_cast<double>(opts.euclideanKick->rotation.value_or(0));
    assert_integer(rotation, "euclidean rotation");
    request.euclidean =
        EuclideanPlan{static_cast<double>(opts.euclideanKick->pulses), steps, rotation};
  }
  request.bars = opts.bars;
  request.style = opts.style;
  request.section = opts.section;
  request.nextSection = opts.nextSection;
  ResolvedContext resolved = resolve_context(opts.ctx);
  request.fills = opts.fills.value_or(false);
  request.feel = opts.feel;
  request.role = opts.role.value_or(DrumRole::kFull);
  // The groove is written against a four-beat bar throughout, so a map is read whole.
  ResolveMetersOptions meter_options;
  meter_options.ts = opts.ts;
  MeterMap meters = resolve_meters(meter_options, "ts");
  for (const MeterChange& change : meters) {
    if (change.ts.numerator != 4 || change.ts.denominator != 4) {
      throw InvalidInputError("drum time signature must be 4/4 throughout; received " +
                              js::to_string(change.ts.numerator) + "/" +
                              js::to_string(change.ts.denominator) + " at beat " +
                              js::to_string(change.startBeat));
    }
  }
  request.ts = meter_at(0, meters);
  std::optional<InstrumentProfile> kit = resolved.instrument("drums");
  if (kit) {
    request.playable = [kit](int pitch) { return can_sound(*kit, pitch); };
  }
  return generate_drums_with(request, resolved);
}

}  // namespace cantus
