/**
 * @file codec_m3.h
 * @brief Wire codec of the types of model/{motif, rhythm, arrangement, composer}: the `$class`
 *        form of each class and the readers of the data its factories take.
 *
 * The wire forms are the TS backend's: `{"$class": X, ...toJSON()}`, and a Composer holding a
 * caller's source carries it beside its data under `rng`. Each reader replays the TS
 * constructor's copy over a wire value, with the fields of the value it was handed read through
 * that value's public surface, and writes the copy in the key order TS writes it. The readers
 * that resolve a key or a context reach the function's own op under `context`.
 */
#ifndef CANTUS_SRC_OPS_CODEC_M3_H_
#define CANTUS_SRC_OPS_CODEC_M3_H_

#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>

#include "json/json.h"
#include "ops/args.h"
#include "ops/codec.h"

namespace cantus::ops {

/** Op `op` called with wire arguments under a call's host. */
json::Value call_op(const CallContext& context, std::string_view op, json::Array args);

/** `copyCheckedTimeSignature(ts, name)` over a wire value. */
json::Value copy_checked_time_signature_wire(const json::Value& ts, std::string_view name);

/** `new Motif(cell)`: the cell's data, `{notes}`. */
json::Value motif_data(const json::Value& cell);
/** `{"$class": "Motif", ...data}` */
json::Value motif_wire(const json::Value& data);

/** `new Rhythm(data)`: the pattern's data, `{events, ts}`, its onsets in time order. */
json::Value rhythm_data(const json::Value& data);
/** `{"$class": "Rhythm", ...data}` */
json::Value rhythm_wire(const json::Value& data);

/** `new Arrangement(data)`: the arrangement's data, `{tracks, settings?}`. */
json::Value arrangement_data(const json::Value& data, const CallContext& context);
/** `copyNotes(notes, name, budget)`: zero-length notes accepted, the count held to the budget. */
json::Value arrangement_notes(const json::Value& notes, const std::string& name,
                              const json::Value& budget);
/** `{"$class": "Arrangement", ...data}` */
json::Value arrangement_wire(const json::Value& data);

/**
 * `new Composer(options)`: the settings the composer holds, in its data's key order, with a
 * caller's source last under `rng`.
 */
json::Value composer_options(const json::Value& options, const CallContext& context);
/** A composer's `data`: its settings without the source. */
json::Value composer_data(const json::Value& held);
/** `contextOf(settings)`: the context half of the settings, as the generators read it. */
json::Value composer_context(const json::Value& held, const CallContext& context);
/** `{"$class": "Composer", ...data, rng?}` */
json::Value composer_wire(const json::Value& held);

/** The data of the `$class` instance in argument `i`. @throws RequestError for another class. */
json::Value read_motif_instance(const Args& a, std::size_t i);
json::Value read_rhythm_instance(const Args& a, std::size_t i);
/** The settings the `$class` Composer in argument `i` holds (composer_options()). */
json::Value read_composer_instance(const Args& a, std::size_t i);

class SessionHandle;

/** A decoded Arrangement: its data, and the session its analysis getters read. */
class DecodedArrangement final : public Decoded {
 public:
  /**
   * `data` as arrangement_data() wrote it; `session`, when given, is adopted (TS `#adopt`). The key
   * indices of both are built here, before the decode can be shared.
   */
  explicit DecodedArrangement(json::Value data,
                              std::shared_ptr<const SessionHandle> session = nullptr);

  /** The arrangement's data. */
  const json::Value& data() const noexcept { return data_; }

  /**
   * The session (TS `#session()`): made by `open` on the first ask and kept, under a mutex, so
   * several threads may ask at once; a failure is not kept, and the next ask tries again.
   */
  std::shared_ptr<const SessionHandle> session(
      const std::function<std::shared_ptr<SessionHandle>()>& open) const;

  /**
   * `update` run over the session, opened as session() opens it. An update takes the evidence it
   * reuses out of the session it starts from, so the updates of one arrangement run one at a time.
   */
  std::shared_ptr<SessionHandle> update(
      const std::function<std::shared_ptr<SessionHandle>()>& open,
      const std::function<std::shared_ptr<SessionHandle>(const SessionHandle&)>& update) const;

 private:
  json::Value data_;
  mutable std::mutex mutex_;
  mutable std::mutex update_mutex_;
  mutable std::shared_ptr<const SessionHandle> session_;
};

/** The Arrangement of argument `i`, decoded at most once a call (never for a snapshot). */
const DecodedArrangement& arrangement_instance(const Args& a, std::size_t i);

/**
 * Validate a `$class` value of a class of this group, setting `kept` to its decode; false when the
 * name is not one.
 */
bool decode_m3_class(const json::Value& value, std::string_view name,
                     std::shared_ptr<const Decoded>& kept);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_M3_H_
