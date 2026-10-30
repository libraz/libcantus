// Retained values: `$retain`, `{"$class"|"$hy": T, "$ref": id}` arguments, and what they save.

#include <catch2/catch_test_macros.hpp>
#include <cstdint>
#include <string>
#include <thread>
#include <vector>

#include "cantus/cantus_c.h"
#include "cantus/ops.h"
#include "js/number.h"
#include "json/json.h"
#include "ops/codec.h"
#include "ops/counters.h"
#include "ops/dispatch.h"
#include "ops/handles.h"

namespace {

namespace json = cantus::json;
namespace counters = cantus::ops::counters;
using cantus::ops::call;
using cantus::ops::Result;

std::string num(double n) { return cantus::js::to_string(n); }

/** The result of a call that must succeed. */
std::string ok(const std::string& op, const std::string& args) {
  Result r = call(op, args);
  INFO(op << " " << r.json);
  REQUIRE(r.status == CANTUS_OK);
  return r.json;
}

std::string message(const Result& r) {
  return json::parse(r.json).as_object().find("message")->as_string();
}

std::uint64_t ref_of(const std::string& result) {
  return static_cast<std::uint64_t>(json::parse(result).as_object().find("$ref")->as_number());
}

/** A result's text with its `$ref` member left out. */
std::string without_ref(const std::string& result) {
  json::Value parsed = json::parse(result);
  json::Object kept;
  for (const json::Member& m : parsed.as_object()) {
    if (m.key != "$ref") {
      kept.set(m.key, m.value);
    }
  }
  return cantus::ops::stringify(json::Value(std::move(kept)));
}

double live() { return json::parse(ok("$live", "[]")).as_number(); }

std::uint64_t decodes() { return counters::class_decodes.load(); }

/** A score of `n` notes under a few tempo and meter changes. */
std::string score_wire(int n) {
  std::string notes;
  for (int i = 0; i < n; ++i) {
    notes += (i == 0 ? "" : ",");
    notes += R"({"pitch":)" + num(48 + (i * 7) % 36) + R"(,"startBeat":)" + num(i * 0.5) +
             R"(,"durationBeat":0.5})";
  }
  return R"({"$class":"Score","notes":[)" + notes +
         R"(],"meters":[{"startBeat":0,"ts":{"numerator":4,"denominator":4}},)"
         R"({"startBeat":16,"ts":{"numerator":3,"denominator":4}}],)"
         R"("tempo":[{"startBeat":0,"bpm":120},{"startBeat":8,"bpm":90.5},{"startBeat":20,"bpm":60}]})";
}

/** Segments of `n` chords, two beats each. */
std::string segments_wire(int n) {
  std::string out;
  for (int i = 0; i < n; ++i) {
    out += (i == 0 ? "" : ",");
    out += R"({"startBeat":)" + num(i * 2) + R"(,"endBeat":)" + num(i * 2 + 2) +
           R"(,"chord":{"rootPc":)" + num((i * 5) % 12) +
           R"(,"quality":"maj","intervals":[0,4,7]}})";
  }
  return "[" + out + "]";
}

const char* const kArrangement =
    R"({"$class":"Arrangement","tracks":[)"
    R"({"notes":[{"pitch":48,"startBeat":0,"durationBeat":4},{"pitch":60,"startBeat":0,"durationBeat":4},)"
    R"({"pitch":64,"startBeat":0,"durationBeat":4},{"pitch":67,"startBeat":0,"durationBeat":4},)"
    R"({"pitch":41,"startBeat":4,"durationBeat":4},{"pitch":60,"startBeat":4,"durationBeat":4},)"
    R"({"pitch":65,"startBeat":4,"durationBeat":4},{"pitch":69,"startBeat":4,"durationBeat":4},)"
    R"({"pitch":43,"startBeat":8,"durationBeat":4},{"pitch":59,"startBeat":8,"durationBeat":4},)"
    R"({"pitch":62,"startBeat":8,"durationBeat":4},{"pitch":65,"startBeat":8,"durationBeat":4}],)"
    R"("name":"keys","role":"harmony"},)"
    R"({"notes":[{"pitch":72,"startBeat":0,"durationBeat":4},{"pitch":72,"startBeat":4,"durationBeat":4},)"
    R"({"pitch":74,"startBeat":8,"durationBeat":4}],"name":"lead","role":"melody"}],)"
    R"("settings":{"key":{"scale":{"rootPc":0,"modeMask12":2741},"tonic":{"letter":0,"alter":0},)"
    R"("variant":"major"}}})";

/** An edit of the lead line, its second note moved to `pitch`. */
std::string lead_edit(int pitch) {
  return R"([{"trackIndex":1,"notes":[{"pitch":72,"startBeat":0,"durationBeat":4},{"pitch":)" +
         num(pitch) +
         R"(,"startBeat":4,"durationBeat":4},{"pitch":74,"startBeat":8,"durationBeat":4}]}])";
}

}  // namespace

TEST_CASE("$retain returns the tag and the id, and $live counts the snapshot", "[retain]") {
  double before = live();
  std::string ref = ok("$retain", "[" + score_wire(4) + "]");
  std::uint64_t id = ref_of(ref);
  CHECK(ref == R"({"$class":"Score","$ref":)" + num(static_cast<double>(id)) + "}");
  CHECK(live() == before + 1);
  std::string hybrid =
      ok("$retain", R"([{"$hy":"ChordTimeline","segments":)" + segments_wire(3) + "}]");
  CHECK(hybrid ==
        R"({"$hy":"ChordTimeline","$ref":)" + num(static_cast<double>(ref_of(hybrid))) + "}");
  CHECK(live() == before + 2);
  cantus::ops::release_handle(id);
  cantus::ops::release_handle(ref_of(hybrid));
  CHECK(live() == before);
}

TEST_CASE("Score, Timeline and ChordTimeline methods on a ref answer as the plain path",
          "[retain]") {
  const std::string score = score_wire(400);
  const std::string ref = ok("$retain", "[" + score + "]");
  for (double beat : {-1.0, 0.0, 3.25, 8.0, 17.5, 150.0, 199.75}) {
    for (const char* op : {"Score#secondsAt", "Score#barAt", "Score#meterAt"}) {
      INFO(op << " " << beat);
      CHECK(ok(op, "[" + ref + "," + num(beat) + "]") ==
            ok(op, "[" + score + "," + num(beat) + "]"));
    }
  }
  for (const char* op : {"Score#notes", "Score#totalBeats", "Score#data", "Score#tempo"}) {
    INFO(op);
    CHECK(ok(op, "[" + ref + "]") == ok(op, "[" + score + "]"));
  }
  CHECK(ok("Score#equals", "[" + ref + "," + ref + "]") == "true");
  CHECK(ok("Score#equals", "[" + score + "," + ref + "]") == "true");

  const std::string timeline =
      R"({"$class":"Timeline","segments":)" + segments_wire(50) + R"(,"totalBeats":100})";
  const std::string timeline_ref = ok("$retain", "[" + timeline + "]");
  const std::string hybrid = R"({"$hy":"ChordTimeline","segments":)" + segments_wire(50) + "}";
  const std::string hybrid_ref = ok("$retain", "[" + hybrid + "]");
  for (double beat : {0.0, 1.5, 33.0, 99.0, 100.0, -2.0}) {
    INFO(beat);
    CHECK(ok("Timeline#at", "[" + timeline_ref + "," + num(beat) + "]") ==
          ok("Timeline#at", "[" + timeline + "," + num(beat) + "]"));
    CHECK(ok("ChordTimeline#at", "[" + hybrid_ref + "," + num(beat) + "]") ==
          ok("ChordTimeline#at", "[" + hybrid + "," + num(beat) + "]"));
  }
  for (const std::string& r : {ref, timeline_ref, hybrid_ref}) {
    cantus::ops::release_handle(ref_of(r));
  }
}

TEST_CASE("a ref is decoded once, when it is retained", "[retain]") {
  const std::string score = score_wire(2000);
  std::uint64_t start = decodes();
  ok("Score#secondsAt", "[" + score + ",3]");
  // The plain path decodes its receiver once a call.
  CHECK(decodes() - start == 1);

  start = decodes();
  const std::string ref = ok("$retain", "[" + score + "]");
  for (int i = 0; i < 1000; ++i) {
    ok("Score#secondsAt", "[" + ref + "," + num(i * 0.25) + "]");
  }
  CHECK(decodes() - start == 1);
  start = decodes();
  for (int i = 0; i < 1000; ++i) {
    ok("Score#barAt", "[" + ref + "," + num(i * 0.25) + "]");
  }
  CHECK(decodes() - start == 0);

  const std::string hybrid = R"({"$hy":"ChordTimeline","segments":)" + segments_wire(2000) + "}";
  start = decodes();
  const std::string hybrid_ref = ok("$retain", "[" + hybrid + "]");
  for (int i = 0; i < 1000; ++i) {
    ok("ChordTimeline#at", "[" + hybrid_ref + "," + num(i * 3.5) + "]");
  }
  // A hybrid has no factory to run.
  CHECK(decodes() - start == 0);
  cantus::ops::release_handle(ref_of(ref));
  cantus::ops::release_handle(ref_of(hybrid_ref));
}

TEST_CASE("a small class receiver is decoded once a call, by dispatch", "[retain]") {
  const std::string note = R"({"$class":"Note","letter":0,"alter":1,"octave":4})";
  const std::string key =
      R"({"$class":"Key","scale":{"rootPc":0,"modeMask12":2741},"tonic":{"letter":0,"alter":0},)"
      R"("variant":"major"})";
  for (const char* op : {"Note#midi", "Note#name", "Note#toString"}) {
    INFO(op);
    std::uint64_t start = decodes();
    ok(op, "[" + note + "]");
    CHECK(decodes() - start == 1);
  }
  std::uint64_t start = decodes();
  ok("Key#scaleName", "[" + key + "]");
  CHECK(decodes() - start == 1);

  start = decodes();
  const std::string ref = ok("$retain", "[" + note + "]");
  for (int i = 0; i < 100; ++i) {
    CHECK(ok("Note#midi", "[" + ref + "]") == ok("Note#midi", "[" + note + "]"));
  }
  // The retain and the 100 plain calls; the ref calls decode nothing.
  CHECK(decodes() - start == 101);
  cantus::ops::release_handle(ref_of(ref));
}

TEST_CASE("Arrangement#update on a ref adopts the session: one full analysis, then increments",
          "[retain]") {
  // The plain path, edit after edit, as the expected bytes.
  const int pitches[] = {73, 74, 76, 77};
  std::vector<std::string> plain{kArrangement};
  std::vector<std::string> plain_analysis;
  std::vector<std::string> plain_conflicts;
  for (int pitch : pitches) {
    plain.push_back(ok("Arrangement#update", "[" + plain.back() + "," + lead_edit(pitch) + "]"));
    CHECK(json::parse(plain.back()).as_object().find("$ref") == nullptr);
    plain_analysis.push_back(ok("Arrangement#analysis", "[" + plain.back() + "]"));
    plain_conflicts.push_back(ok("Arrangement#conflicts", "[" + plain.back() + "]"));
  }

  double before = live();
  std::uint64_t full = counters::full_analyses.load();
  std::uint64_t incremental = counters::incremental_analyses.load();
  std::string current = ok("$retain", std::string("[") + kArrangement + "]");
  std::vector<std::uint64_t> made{ref_of(current)};
  CHECK(counters::full_analyses.load() == full);
  for (std::size_t step = 0; step < 4; ++step) {
    INFO("edit " << step);
    std::string result =
        ok("Arrangement#update", "[" + current + "," + lead_edit(pitches[step]) + "]");
    // The data the plain path writes, then `$ref` as the last member.
    CHECK(without_ref(result) == plain[step + 1]);
    CHECK(result.compare(0, plain[step + 1].size() - 1, plain[step + 1], 0,
                         plain[step + 1].size() - 1) == 0);
    made.push_back(ref_of(result));
    current = R"({"$class":"Arrangement","$ref":)" + num(static_cast<double>(made.back())) + "}";
    CHECK(ok("Arrangement#analysis", "[" + current + "]") == plain_analysis[step]);
    CHECK(ok("Arrangement#conflicts", "[" + current + "]") == plain_conflicts[step]);
    CHECK(ok("Arrangement#analysis", "[" + current + "]") == plain_analysis[step]);
    // Retain, then the first update, open one session; every edit after it adds one increment.
    CHECK(counters::full_analyses.load() - full == 1);
    CHECK(counters::incremental_analyses.load() - incremental == step + 1);
  }
  CHECK(live() == before + 5);
  for (std::uint64_t id : made) {
    cantus::ops::release_handle(id);
  }
  CHECK(live() == before);
}

TEST_CASE("Arrangement getters on a ref open the session once", "[retain]") {
  const char* const ops[] = {
      "Arrangement#analysis", "Arrangement#conflicts", "Arrangement#timeline", "Arrangement#tracks",
      "Arrangement#data",     "Arrangement#reference", "Arrangement#tension"};
  std::vector<std::string> expected;
  for (const char* op : ops) {
    expected.push_back(ok(op, std::string("[") + kArrangement + "]"));
  }
  const std::string track =
      ok("Arrangement#track", std::string("[") + kArrangement + R"(,"lead"])");

  std::uint64_t full = counters::full_analyses.load();
  std::uint64_t incremental = counters::incremental_analyses.load();
  const std::string ref = ok("$retain", std::string("[") + kArrangement + "]");
  for (std::size_t i = 0; i < expected.size(); ++i) {
    INFO(ops[i]);
    CHECK(ok(ops[i], "[" + ref + "]") == expected[i]);
  }
  CHECK(ok("Arrangement#track", "[" + ref + R"(,"lead"])") == track);
  CHECK(counters::full_analyses.load() - full == 1);
  CHECK(counters::incremental_analyses.load() == incremental);
  // A plain receiver opens a session of its own each call.
  ok("Arrangement#conflicts", std::string("[") + kArrangement + "]");
  CHECK(counters::full_analyses.load() - full == 2);
  cantus::ops::release_handle(ref_of(ref));
}

TEST_CASE("$ref wire errors", "[retain]") {
  const std::string score = score_wire(4);
  const std::string ref = ok("$retain", "[" + score + "]");
  const std::string id = num(static_cast<double>(ref_of(ref)));

  Result r = call("Score#notes", R"([{"$class":"Score","$ref":)" + id + R"(,"notes":[]}])");
  CHECK(r.status == CANTUS_BAD_REQUEST);
  CHECK(message(r) == R"(malformed "$class" tag)");
  r = call("ChordTimeline#at", R"([{"$hy":"ChordTimeline","$ref":)" + id + R"(,"segments":[]},0])");
  CHECK(message(r) == R"(malformed "$hy" tag)");
  for (const char* bad : {"0", "1.5", "-3", "\"7\"", "9007199254740992"}) {
    INFO(bad);
    r = call("Score#notes", std::string(R"([{"$class":"Score","$ref":)") + bad + "}]");
    CHECK(r.status == CANTUS_BAD_REQUEST);
    CHECK(message(r) == R"(malformed "$ref" tag)");
  }
  r = call("Score#notes", R"([{"$ref":3}])");
  CHECK(message(r) == R"(unknown wire tag "$ref")");

  r = call("Score#notes", R"([{"$class":"Score","$ref":9007199254740991}])");
  CHECK(r.status == CANTUS_BAD_REQUEST);
  CHECK(message(r) == "unknown handle 9007199254740991");

  r = call("Timeline#at", "[" + ref + ",0]");
  CHECK(r.status == CANTUS_BAD_REQUEST);
  CHECK(message(r) == R"(expected a "Timeline" instance)");
  r = call("Timeline#at", R"([{"$class":"Timeline","$ref":)" + id + "},0]");
  CHECK(message(r) == R"(expected a "Timeline" instance)");
  r = call("ChordTimeline#at", R"([{"$hy":"Score","$ref":)" + id + "},0]");
  CHECK(message(r) == R"(expected a "Score" hybrid)");
  std::string counter = ok("$counter", "[]");
  std::string counter_id = num(json::parse(counter).as_object().find("$h")->as_number());
  r = call("Score#notes", R"([{"$class":"Score","$ref":)" + counter_id + "}]");
  CHECK(message(r) == R"(expected a "Score" instance)");
  cantus::ops::release_handle(ref_of(R"({"$ref":)" + counter_id + "}"));

  cantus::ops::release_handle(ref_of(ref));
  r = call("Score#notes", "[" + ref + "]");
  CHECK(r.status == CANTUS_RELEASED_HANDLE);
  CHECK(message(r) == "Score handle " + id + " has been released");
}

TEST_CASE("$retain refuses what the plain path refuses, with the same error", "[retain]") {
  Result r = call("$retain", "[1]");
  CHECK(r.status == CANTUS_BAD_REQUEST);
  CHECK(message(r) == R"($retain needs a "$class" or "$hy" value)");
  CHECK(message(call("$retain", "[]")) == R"($retain needs a "$class" or "$hy" value)");

  const std::string bad = R"({"$class":"Score","notes":[{"pitch":60,"startBeat":0}],"tempo":[]})";
  Result plain = call("Score#notes", "[" + bad + "]");
  REQUIRE(plain.status != CANTUS_OK);
  Result retained = call("$retain", "[" + bad + "]");
  CHECK(retained.status == plain.status);
  CHECK(retained.json == plain.json);
  CHECK(call("$retain", R"([{"$class":"NoSuchClass"}])").json ==
        call("Score#notes", R"([{"$class":"NoSuchClass"}])").json);

  // A snapshot cannot hold a host function.
  auto host = [](void*, std::uint32_t, const char*, std::size_t, char**,
                 std::size_t*) -> std::int32_t { return 0; };
  Result cb = cantus::ops::dispatch("$retain",
                                    R"([{"$hy":"ChordTimeline","segments":[],"pick":{"$cb":1}}])",
                                    cantus::ops::CallContext(host, nullptr));
  CHECK(cb.status == CANTUS_BAD_REQUEST);
  CHECK(message(cb) == "$retain: a value holding a callback cannot be retained");
}

TEST_CASE("a nested $ref is expanded to its data", "[retain]") {
  const std::string c = R"({"$class":"Chord","rootPc":0,"quality":"maj","intervals":[0,4,7]})";
  const std::string g = R"({"$class":"Chord","rootPc":7,"quality":"dom7","intervals":[0,4,7,10]})";
  const std::string key = R"("C major")";
  const std::string c_ref = ok("$retain", "[" + c + "]");
  const std::string g_ref = ok("$retain", "[" + g + "]");
  CHECK(
      ok("Progression.constructor", "[[" + c_ref + "," + g_ref + "," + c_ref + "]," + key + "]") ==
      ok("Progression.constructor", "[[" + c + "," + g + "," + c + "]," + key + "]"));
  // $retain over a value holding a ref keeps a copy of the data.
  const std::string again = ok("$retain", "[" + c_ref + "]");
  CHECK(ref_of(again) != ref_of(c_ref));
  cantus::ops::release_handle(ref_of(c_ref));
  CHECK(ok("Chord#data", "[" + again + "]") == ok("Chord#data", "[" + c + "]"));
  // A builtin takes its arguments as sent.
  CHECK(ok("$echo", "[" + again + "]") == again);
  cantus::ops::release_handle(ref_of(again));
  cantus::ops::release_handle(ref_of(g_ref));
}

TEST_CASE("one ref serves several threads at once", "[retain]") {
  const std::string score = score_wire(500);
  const std::string ref = ok("$retain", "[" + score + "]");
  const std::string arrangement = ok("$retain", std::string("[") + kArrangement + "]");
  std::vector<std::string> expected;
  for (int i = 0; i < 50; ++i) {
    expected.push_back(ok("Score#secondsAt", "[" + score + "," + num(i * 4.5) + "]"));
  }
  const std::string conflicts = ok("Arrangement#conflicts", std::string("[") + kArrangement + "]");
  const std::string updated =
      ok("Arrangement#update", std::string("[") + kArrangement + "," + lead_edit(76) + "]");
  double before = live();
  std::vector<int> mismatches(8, 0);
  std::vector<std::thread> threads;
  for (int t = 0; t < 8; ++t) {
    threads.emplace_back([&, t] {
      for (int round = 0; round < 20; ++round) {
        if (round % 5 == 0) {
          // Updates of one snapshot run one at a time; each result is a snapshot of its own.
          Result u = call("Arrangement#update", "[" + arrangement + "," + lead_edit(76) + "]");
          if (u.status != CANTUS_OK || without_ref(u.json) != updated) {
            ++mismatches[static_cast<std::size_t>(t)];
          } else {
            cantus::ops::release_handle(ref_of(u.json));
          }
        }
        for (int i = 0; i < 50; ++i) {
          Result r = call("Score#secondsAt", "[" + ref + "," + num(i * 4.5) + "]");
          if (r.status != CANTUS_OK || r.json != expected[static_cast<std::size_t>(i)]) {
            ++mismatches[static_cast<std::size_t>(t)];
          }
        }
        Result r = call("Arrangement#conflicts", "[" + arrangement + "]");
        if (r.status != CANTUS_OK || r.json != conflicts) {
          ++mismatches[static_cast<std::size_t>(t)];
        }
      }
    });
  }
  for (std::thread& t : threads) {
    t.join();
  }
  for (int m : mismatches) {
    CHECK(m == 0);
  }
  CHECK(live() == before);
  cantus::ops::release_handle(ref_of(ref));
  cantus::ops::release_handle(ref_of(arrangement));
}
