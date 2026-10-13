// Church-mode candidates for detect_key(): ts/src/analyze/detect/modes.ts.

#include "analyze/detect/modes.h"

#include <algorithm>

namespace cantus {

namespace {

constexpr std::size_t kModeCount = static_cast<std::size_t>(ModalScaleName::kLocrian) + 1;

/** MODAL_SCALE_NAMES, indexed by ModalScaleName. */
constexpr std::array<std::string_view, kModeCount> kModalScaleNames = {
#include "analyze/detect/modal_scale_names.gen.inc"
};
static_assert(!kModalScaleNames.back().empty(), "MODAL_SCALE_NAMES and ModalScaleName disagree");

/** One modal candidate as the table writes it. */
struct ModalCandidateRow {
  std::string_view scaleName;
  std::string_view mode;
  int mask;
  std::vector<std::array<int, 2>> substitutions;
};

/** The table of modal candidates (`MODAL_CANDIDATES`). */
const std::vector<ModalCandidateRow>& candidate_rows() {
  static const std::vector<ModalCandidateRow> rows =
#include "analyze/detect/modal_candidates.gen.inc"
      ;
  return rows;
}

std::vector<ModalCandidate> build_candidates() {
  std::vector<ModalCandidate> out;
  for (const ModalCandidateRow& row : candidate_rows()) {
    ModalCandidate candidate;
    candidate.scaleName = *parse_modal_scale_name(row.scaleName);
    candidate.mode = *parse_key_name_mode(row.mode);
    candidate.mask = row.mask;
    candidate.substitutions = row.substitutions;
    out.push_back(std::move(candidate));
  }
  return out;
}

}  // namespace

std::string_view to_string(ModalScaleName name) {
  return kModalScaleNames[static_cast<std::size_t>(name)];
}

std::optional<ModalScaleName> parse_modal_scale_name(std::string_view name) {
  for (std::size_t i = 0; i < kModalScaleNames.size(); ++i) {
    if (kModalScaleNames[i] == name) {
      return static_cast<ModalScaleName>(i);
    }
  }
  return std::nullopt;
}

std::vector<ModalScaleName> modal_scale_names() {
  std::vector<ModalScaleName> out;
  for (const ModalCandidate& candidate : modal_candidates()) {
    out.push_back(candidate.scaleName);
  }
  return out;
}

const std::vector<ModalCandidate>& modal_candidates() {
  static const std::vector<ModalCandidate> candidates = build_candidates();
  return candidates;
}

std::array<double, 12> modal_profile_vector(const KeyProfilePair& profile,
                                            const ModalCandidate& candidate) {
  const std::array<double, 12>& parent =
      candidate.mode == KeyNameMode::kMajor ? profile.major : profile.minor;
  std::array<double, 12> vector = parent;
  for (const std::array<int, 2>& pair : candidate.substitutions) {
    auto replaced = static_cast<std::size_t>(pair[0]);
    auto replacing = static_cast<std::size_t>(pair[1]);
    vector[replacing] = parent[replaced];
    vector[replaced] = parent[replacing];
  }
  return vector;
}

std::vector<ModalCandidate> resolve_modal_candidates(
    const std::optional<std::variant<bool, std::vector<ModalScaleName>>>& modes) {
  if (!modes) {
    return {};
  }
  if (const bool* all = std::get_if<bool>(&*modes)) {
    return *all ? modal_candidates() : std::vector<ModalCandidate>{};
  }
  const std::vector<ModalScaleName>& requested = std::get<std::vector<ModalScaleName>>(*modes);
  std::vector<ModalCandidate> out;
  for (const ModalCandidate& candidate : modal_candidates()) {
    if (std::find(requested.begin(), requested.end(), candidate.scaleName) != requested.end()) {
      out.push_back(candidate);
    }
  }
  return out;
}

}  // namespace cantus
