// The kick vocabulary of ts/src/generate/drums/kick.ts.

#include "generate/drums/kick.h"

#include <cmath>
#include <limits>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "js/math.h"

namespace cantus {

namespace {

/** A generated kick slot, with its sections still by name. */
struct KickSlotRecord {
  int step;
  std::optional<double> probability;
  std::optional<std::string_view> slot;
  std::optional<int> barParity;
  GeneratedList<std::string_view> sections;
};

/** One KICK_FIGURES row: a style's name and its figure. */
struct KickFigureRow {
  std::string_view style;
  std::vector<KickSlotRecord> figure;
};

KickFigure make_figure(const std::vector<KickSlotRecord>& records) {
  KickFigure figure;
  for (const KickSlotRecord& record : records) {
    KickSlot slot;
    slot.step = record.step;
    slot.probability = record.probability;
    if (record.slot) {
      slot.slot = std::string(*record.slot);
    }
    slot.barParity = record.barParity;
    if (record.sections.value) {
      slot.sections.emplace();
      for (std::string_view name : *record.sections.value) {
        slot.sections->push_back(*parse_section(name));
      }
    }
    figure.push_back(std::move(slot));
  }
  return figure;
}

std::vector<std::pair<DrumStyle, KickFigure>> make_kick_figures() {
  static const std::vector<KickFigureRow> rows =
#include "generate/drums/kick_figures.gen.inc"
      ;
  std::vector<std::pair<DrumStyle, KickFigure>> out;
  for (const KickFigureRow& row : rows) {
    out.emplace_back(*parse_drum_style(row.style), make_figure(row.figure));
  }
  return out;
}

/** The kick under every phrase end: two half notes (`OUTRO_FIGURE`). */
const KickFigure& outro_figure() {
  static const KickFigure figure = make_figure(
#include "generate/drums/outro_figure.gen.inc"
  );
  return figure;
}

/** The figure a style with no entry of its own plays (`DEFAULT_FIGURE`). */
const KickFigure& default_figure() {
  static const KickFigure figure = make_figure(
#include "generate/drums/default_figure.gen.inc"
  );
  return figure;
}

/** The onsets a figure states outright, with none of the slots a dial fills (`statedSlots`). */
KickFigure stated_slots(const KickFigure& figure) {
  KickFigure out;
  for (const KickSlot& slot : figure) {
    if (!slot.probability && !slot.sections && !slot.barParity) {
      out.push_back(slot);
    }
  }
  return out;
}

}  // namespace

const std::vector<std::pair<DrumStyle, KickFigure>> KICK_FIGURES = make_kick_figures();

bool is_in_pre_chorus_lift(SectionType section, double bar, double section_bars,
                           bool next_is_chorus) {
  if (section != SectionType::kB || !next_is_chorus || section_bars < 3) {
    return false;
  }
  return bar >= section_bars - 2;
}

namespace {

/** Whether each slot of a realised bar sounds. */
KickPattern pattern_of(const KickEntries& entries) {
  KickPattern pattern;
  for (const std::optional<double>& entry : entries) {
    pattern.push_back(entry.has_value());
  }
  return pattern;
}

}  // namespace

KickEntries realise_kick_entries(const KickFigure& figure, SectionType section, double bar,
                                 const Draw& draw, double rhythmic) {
  KickEntries entries(static_cast<std::size_t>(KICK_STEPS));
  for (const KickSlot& slot : figure) {
    if (slot.step < 0 || slot.step >= KICK_STEPS) {
      continue;
    }
    if (slot.sections) {
      bool named = false;
      for (Section name : *slot.sections) {
        named = named || map_section(name) == section;
      }
      if (!named) {
        continue;
      }
    }
    if (slot.barParity && std::fmod(bar, 2) != *slot.barParity) {
      continue;
    }
    std::size_t index = static_cast<std::size_t>(slot.step);
    if (!slot.probability) {
      entries[index] = -std::numeric_limits<double>::infinity();
      continue;
    }
    SeedSegment address =
        slot.slot ? SeedSegment(*slot.slot) : SeedSegment(static_cast<double>(slot.step));
    // The slot sounds while its draw is under the leaned chance: from `at / probability - 0.5` up.
    double at = draw.at({"kick", bar, address});
    if (at < leaned_by(*slot.probability, rhythmic)) {
      entries[index] = js::min(entries[index].value_or(std::numeric_limits<double>::infinity()),
                               at / *slot.probability - 0.5);
    }
  }
  return entries;
}

KickPattern get_kick_pattern(SectionType section, DrumStyle style, double bar, const Draw& draw,
                             double rhythmic) {
  return pattern_of(get_kick_entries(section, style, bar, draw, rhythmic));
}

KickEntries get_kick_entries(SectionType section, DrumStyle style, double bar, const Draw& draw,
                             double rhythmic) {
  const KickFigure* own = &default_figure();
  for (const auto& [name, figure] : KICK_FIGURES) {
    if (name == style) {
      own = &figure;
      break;
    }
  }
  if (section != SectionType::kOutro) {
    return realise_kick_entries(*own, section, bar, draw, rhythmic);
  }
  KickFigure figure = outro_figure();
  KickFigure stated = stated_slots(*own);
  figure.insert(figure.end(), stated.begin(), stated.end());
  return realise_kick_entries(figure, section, bar, draw, rhythmic);
}

}  // namespace cantus
