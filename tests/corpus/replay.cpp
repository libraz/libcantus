// Replays call-corpus files through the C ABI and byte-compares the normalized results.
//
// A corpus file is JSONL, one call per line:
//   {"op": "...", "args": [...], "result": <wire value>}
//   {"op": "...", "args": [...], "error": {"code", "name", "message", "at"?}}
// `args_raw` (a string) replaces `args` to send text verbatim; a line with `skip` is counted and
// not replayed; other keys (`file`, `seq`) are ignored. Expected and actual output are both parsed
// and re-serialized by the op layer's writer before the comparison, so only content can differ.
// Handle ids (`$h`) and identity tokens (`$id`) depend on process history: the first time an
// expected id meets an actual one they are paired, and later lines of the same file must agree.
// A `$cb` argument is answered by a host callback that returns its argument array.
//
// Usage:
//   cantus_corpus_replay [--min N] FILE...   replay; fails on a mismatch or fewer than N calls
//   cantus_corpus_replay --list              print the registered op names, one per line

#include <cstdint>
#include <cstdlib>
#include <deque>
#include <fstream>
#include <iostream>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/cantus_c.h"
#include "json/json.h"
#include "ops/codec.h"
#include "ops/error_map.h"

namespace {

using cantus::json::Array;
using cantus::json::Member;
using cantus::json::Object;
using cantus::json::Value;

/** Longest excerpt of a value printed for a mismatch. */
constexpr std::size_t kExcerpt = 400;

struct Reply {
  CantusStatus status;
  std::string json;
};

/** Buffers handed back by the callback; they must outlive the cantus_call that asked. */
struct CallbackBuffers {
  std::deque<std::string> held;
};

int32_t echo_arguments(void* ctx, uint32_t, const char* args, size_t args_len, char** out,
                       size_t* out_len) {
  auto* buffers = static_cast<CallbackBuffers*>(ctx);
  buffers->held.emplace_back(args, args_len);
  *out = buffers->held.back().data();
  *out_len = buffers->held.back().size();
  return 0;
}

Reply call(std::string_view op, std::string_view args) {
  CallbackBuffers buffers;
  char* out = nullptr;
  size_t len = 0;
  CantusStatus status = cantus_call(op.data(), op.size(), args.data(), args.size(),
                                    echo_arguments, &buffers, &out, &len);
  Reply reply{status, out == nullptr ? std::string() : std::string(out, len)};
  cantus_free(out);
  return reply;
}

std::string excerpt(const std::string& s) {
  return s.size() <= kExcerpt ? s : s.substr(0, kExcerpt) + "...";
}

/** Pairs the `$h` and `$id` values of a recording with those of this process. */
class IdMap {
 public:
  /**
   * Rewrite the ids in `expected` to the ones `actual` carries at the same place, pairing ids not
   * seen before. Returns false when either id is already paired with a different one.
   */
  bool bind(Value& expected, const Value& actual) {
    if (expected.is_array() && actual.is_array()) {
      Array& e = expected.as_array();
      const Array& a = actual.as_array();
      for (std::size_t i = 0; i < e.size() && i < a.size(); ++i) {
        if (!bind(e[i], a[i])) {
          return false;
        }
      }
      return true;
    }
    if (!expected.is_object() || !actual.is_object()) {
      return true;
    }
    Object& e = expected.as_object();
    const Object& a = actual.as_object();
    std::vector<std::string> keys;
    for (const Member& m : e) {
      keys.push_back(m.key);
    }
    for (const std::string& key : keys) {
      Value* ev = e.find(key);
      const Value* av = a.find(key);
      if (av == nullptr) {
        continue;
      }
      if ((key == "$h" || key == "$id") && ev->is_number() && av->is_number()) {
        bool handle = key == "$h";
        std::map<double, double>& pairs = handle ? handles_ : identities_;
        std::map<double, double>& reverse = handle ? handles_back_ : identities_back_;
        auto [it, inserted] = pairs.emplace(ev->as_number(), av->as_number());
        auto [back, fresh] = reverse.emplace(av->as_number(), ev->as_number());
        if ((!inserted && it->second != av->as_number()) ||
            (!fresh && back->second != ev->as_number())) {
          return false;
        }
        *ev = Value(av->as_number());
      } else if (!bind(*ev, *av)) {
        return false;
      }
    }
    return true;
  }

  /** Rewrite the recorded handle ids in `args` to this process's ones. */
  void apply(Value& args) const {
    if (args.is_array()) {
      for (Value& v : args.as_array()) {
        apply(v);
      }
      return;
    }
    if (!args.is_object()) {
      return;
    }
    Object& o = args.as_object();
    std::vector<std::string> keys;
    for (const Member& m : o) {
      keys.push_back(m.key);
    }
    for (const std::string& key : keys) {
      Value* v = o.find(key);
      if (key == "$h" && v->is_number()) {
        auto it = handles_.find(v->as_number());
        if (it != handles_.end()) {
          *v = Value(it->second);
        }
      } else {
        apply(*v);
      }
    }
  }

 private:
  std::map<double, double> handles_;
  std::map<double, double> identities_;
  std::map<double, double> handles_back_;
  std::map<double, double> identities_back_;
};

struct Totals {
  std::size_t replayed = 0;
  std::size_t skipped = 0;
  std::size_t mismatched = 0;
};

const Value* field(const Object& o, const char* key) { return o.find(key); }

/** The C ABI status an error reply's `code` stands for. */
std::optional<CantusStatus> status_of(const Value& error) {
  if (!error.is_object()) {
    return std::nullopt;
  }
  const Value* code = error.as_object().find("code");
  if (code == nullptr || !code->is_string()) {
    return std::nullopt;
  }
  std::optional<cantus::ErrorCode> parsed = cantus::ops::parse_error_code(code->as_string());
  if (!parsed) {
    return std::nullopt;
  }
  return cantus::ops::error_info(*parsed)->status;
}

/** Replay one line; returns an empty string when it matched, else what went wrong. */
std::string replay_line(const Object& record, IdMap& ids, Totals& totals) {
  const Value* op = field(record, "op");
  if (op == nullptr || !op->is_string()) {
    return "record has no \"op\"";
  }
  if (record.contains("skip")) {
    ++totals.skipped;
    return std::string();
  }
  std::string args;
  if (const Value* raw = field(record, "args_raw")) {
    if (!raw->is_string()) {
      return "\"args_raw\" is not a string";
    }
    args = raw->as_string();
  } else {
    const Value* recorded = field(record, "args");
    Value sent = recorded == nullptr ? Value(Array()) : *recorded;
    ids.apply(sent);
    args = cantus::ops::stringify(sent);
  }
  const Value* result = field(record, "result");
  const Value* error = field(record, "error");
  if ((result == nullptr) == (error == nullptr)) {
    return "record needs exactly one of \"result\" and \"error\"";
  }
  ++totals.replayed;
  Reply reply = call(op->as_string(), args);
  Value actual;
  try {
    actual = cantus::json::parse(reply.json);
  } catch (const cantus::json::ParseError& e) {
    return std::string("output is not JSON: ") + e.what();
  }
  Value expected = result != nullptr ? *result : *error;
  if (result != nullptr && reply.status != CANTUS_OK) {
    return "expected a result, got status " + std::to_string(reply.status) + ": " +
           excerpt(reply.json);
  }
  if (error != nullptr) {
    std::optional<CantusStatus> want = status_of(*error);
    if (!want) {
      return "expected error has no known \"code\"";
    }
    if (reply.status != *want) {
      return "expected status " + std::to_string(*want) + ", got " +
             std::to_string(reply.status) + ": " + excerpt(reply.json);
    }
  }
  if (!ids.bind(expected, actual)) {
    return "handle or identity ids disagree with an earlier line";
  }
  std::string want = cantus::ops::stringify(expected);
  std::string got = cantus::ops::stringify(actual);
  if (want != got) {
    return "args " + excerpt(args) + "\n  expected " + excerpt(want) + "\n  actual   " +
           excerpt(got);
  }
  return std::string();
}

bool replay_file(const std::string& path, IdMap& ids, Totals& totals) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    std::cerr << path << ": cannot open\n";
    return false;
  }
  std::string line;
  std::size_t number = 0;
  while (std::getline(in, line)) {
    ++number;
    if (line.empty()) {
      continue;
    }
    std::string problem;
    try {
      Value record = cantus::json::parse(line);
      problem = record.is_object() ? replay_line(record.as_object(), ids, totals)
                                   : std::string("record is not an object");
    } catch (const cantus::json::ParseError& e) {
      problem = std::string("record is not JSON: ") + e.what();
    }
    if (!problem.empty()) {
      ++totals.mismatched;
      std::cerr << path << ":" << number << ": " << problem << "\n";
    }
  }
  return true;
}

int list_ops() {
  char* out = nullptr;
  size_t len = 0;
  if (cantus_list_ops(&out, &len) != CANTUS_OK) {
    std::cerr << "cantus_list_ops failed\n";
    cantus_free(out);
    return 1;
  }
  Value ops = cantus::json::parse(std::string_view(out, len));
  cantus_free(out);
  for (const Value& entry : ops.as_array()) {
    std::cout << entry.as_object().find("name")->as_string() << "\n";
  }
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  std::vector<std::string> files;
  std::size_t min = 1;
  for (int i = 1; i < argc; ++i) {
    std::string arg = argv[i];
    if (arg == "--list") {
      return list_ops();
    }
    if (arg == "--min" && i + 1 < argc) {
      min = static_cast<std::size_t>(std::strtoull(argv[++i], nullptr, 10));
      continue;
    }
    files.push_back(arg);
  }
  if (files.empty()) {
    std::cerr << "usage: cantus_corpus_replay [--min N] FILE... | --list\n";
    return 2;
  }
  Totals totals;
  bool readable = true;
  for (const std::string& f : files) {
    IdMap ids;
    readable = replay_file(f, ids, totals) && readable;
  }
  std::cout << "corpus: replayed " << totals.replayed << " calls from " << files.size()
            << " files (" << totals.skipped << " skipped), " << totals.mismatched
            << " mismatched\n";
  if (!readable || totals.mismatched > 0) {
    return 1;
  }
  if (totals.replayed < min || totals.replayed == 0) {
    std::cerr << "corpus: replayed " << totals.replayed << " calls, expected at least "
              << (min == 0 ? 1 : min) << "\n";
    return 1;
  }
  return 0;
}
