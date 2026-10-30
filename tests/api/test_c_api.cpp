// The C ABI contract of cantus_call and friends.

#include <algorithm>
#include <atomic>
#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "cantus/cantus_c.h"
#include "json/json.h"

namespace {

struct Reply {
  CantusStatus status;
  std::string json;
};

Reply call(std::string_view op, std::string_view args, CantusCallbackFn cb = nullptr,
           void* ctx = nullptr) {
  char* out = nullptr;
  size_t len = 0;
  CantusStatus status =
      cantus_call(op.data(), op.size(), args.data(), args.size(), cb, ctx, &out, &len);
  REQUIRE(out != nullptr);
  CHECK(out[len] == '\0');
  Reply r{status, std::string(out, len)};
  cantus_free(out);
  return r;
}

cantus::json::Value field(const Reply& r, const char* key) {
  cantus::json::Value parsed = cantus::json::parse(r.json);
  const cantus::json::Value* v = parsed.as_object().find(key);
  REQUIRE(v != nullptr);
  return *v;
}

/** Callback context: re-enters cantus_call with `op` on the callback's arguments. */
struct Reenter {
  std::string op;
  std::string result;
  int calls = 0;
};

int32_t reenter(void* ctx, uint32_t, const char* args, size_t args_len, char** out,
                size_t* out_len) {
  auto* r = static_cast<Reenter*>(ctx);
  ++r->calls;
  // The callback's arguments are the array the inner op receives.
  Reply inner = call(r->op, std::string_view(args, args_len), reenter, ctx);
  if (inner.status != CANTUS_OK) {
    return 1;
  }
  r->result = inner.json;
  *out = r->result.data();
  *out_len = r->result.size();
  return 0;
}

/** Callback context: calls `$call` on itself until `max` frames deep, then `$echo`. */
struct Recurse {
  int max;
  int seen = 0;
  std::string result;
};

int32_t recurse(void* ctx, uint32_t, const char* args, size_t args_len, char** out,
                size_t* out_len) {
  auto* r = static_cast<Recurse*>(ctx);
  ++r->seen;
  std::string rest(args + 1, args_len - 1);
  Reply inner = r->seen < r->max ? call("$call", R"([{"$cb":0},)" + rest, recurse, ctx)
                                 : call("$echo", std::string_view(args, args_len));
  if (inner.status != CANTUS_OK) {
    return 1;
  }
  r->result = inner.json;
  *out = r->result.data();
  *out_len = r->result.size();
  return 0;
}

int32_t fail(void*, uint32_t, const char*, size_t, char**, size_t*) { return 7; }

int32_t garbage(void* ctx, uint32_t, const char*, size_t, char** out, size_t* out_len) {
  auto* text = static_cast<std::string*>(ctx);
  *out = text->data();
  *out_len = text->size();
  return 0;
}

int32_t echo_id(void* ctx, uint32_t id, const char*, size_t, char** out, size_t* out_len) {
  auto* text = static_cast<std::string*>(ctx);
  *text = std::to_string(id);
  *out = text->data();
  *out_len = text->size();
  return 0;
}

}  // namespace

TEST_CASE("cantus_call initializes the out-parameters", "[c_api]") {
  char sentinel = 'x';
  char* out = &sentinel;
  size_t len = 123;
  CHECK(cantus_call("$echo", 5, "[1]", 3, nullptr, nullptr, &out, &len) == CANTUS_OK);
  CHECK(std::string(out, len) == "1");
  cantus_free(out);

  out = &sentinel;
  CHECK(cantus_call("$echo", 5, "[1]", 3, nullptr, nullptr, &out, nullptr) == CANTUS_BAD_REQUEST);
  CHECK(out == nullptr);
  len = 123;
  CHECK(cantus_call("$echo", 5, "[1]", 3, nullptr, nullptr, nullptr, &len) == CANTUS_BAD_REQUEST);
  CHECK(len == 0);
  out = &sentinel;
  len = 123;
  CHECK(cantus_list_ops(&out, nullptr) == CANTUS_BAD_REQUEST);
  CHECK(out == nullptr);
  cantus_free(nullptr);
}

TEST_CASE("errors come back as {code, name, message}", "[c_api]") {
  Reply r = call("noSuchOp", "[]");
  CHECK(r.status == CANTUS_UNKNOWN_OP);
  CHECK(r.json == R"({"code":"UNKNOWN_OP","name":"Error","message":"unknown op \"noSuchOp\""})");
}

TEST_CASE("op names and payloads are length-delimited", "[c_api]") {
  std::string op("$echo\0x", 7);
  Reply r = call(op, "[]");
  CHECK(r.status == CANTUS_UNKNOWN_OP);
  CHECK(field(r, "message").as_string() == R"(unknown op "$echo\u0000x")");

  CHECK(call(std::string_view("$echo", 5), "[1]").json == "1");
  // A shorter length ends the name early; the bytes after it are not read.
  CHECK(call(std::string_view("$echoXYZ", 5), "[2]").json == "2");

  std::string args("[1]\0[2]", 7);
  CHECK(call("$echo", args).status == CANTUS_BAD_REQUEST);
  std::string raw_nul("[\"a\0b\"]", 7);
  CHECK(call("$echo", raw_nul).status == CANTUS_BAD_REQUEST);

  Reply escaped = call("$echo", R"(["a\u0000b"])");
  CHECK(escaped.status == CANTUS_OK);
  CHECK(escaped.json == R"("a\u0000b")");

  char* out = nullptr;
  size_t len = 0;
  CHECK(cantus_call(nullptr, 3, "[]", 2, nullptr, nullptr, &out, &len) == CANTUS_BAD_REQUEST);
  REQUIRE(out != nullptr);
  cantus_free(out);
  CHECK(cantus_call("$echo", 5, nullptr, 2, nullptr, nullptr, &out, &len) == CANTUS_BAD_REQUEST);
  cantus_free(out);
  CHECK(cantus_call("$echo", 5, nullptr, 0, nullptr, nullptr, &out, &len) == CANTUS_OK);
  CHECK(std::string(out, len) == R"({"$u":1})");
  cantus_free(out);
}

TEST_CASE("callbacks re-enter cantus_call", "[c_api]") {
  Reenter echo{"$echo", "", 0};
  Reply r = call("$call", R"([{"$cb":0},{"x":[1,{"$n":"-0"}]}])", reenter, &echo);
  CHECK(r.status == CANTUS_OK);
  CHECK(r.json == R"({"x":[1,{"$n":"-0"}]})");
  CHECK(echo.calls == 1);

  // $call -> callback -> $call -> callback -> $call -> callback -> $echo.
  Recurse deep{3, 0, ""};
  Reply nested = call("$call", R"([{"$cb":0},"deep"])", recurse, &deep);
  CHECK(nested.status == CANTUS_OK);
  CHECK(nested.json == R"("deep")");
  CHECK(deep.seen == 3);
}

TEST_CASE("callback ids reach the host unchanged", "[c_api]") {
  std::string text;
  CHECK(call("$call", R"([{"$cb":4294967295}])", echo_id, &text).json == "4294967295");
}

TEST_CASE("a failing callback is CALLBACK_FAILED", "[c_api]") {
  Reply r = call("$call", R"([{"$cb":3}])", fail, nullptr);
  CHECK(r.status == CANTUS_CALLBACK_FAILED);
  CHECK(r.json == R"({"code":"CALLBACK_FAILED","name":"Error","message":"callback 3 failed"})");
}

TEST_CASE("a callback result must be wire JSON", "[c_api]") {
  std::string bad = "{";
  CHECK(call("$call", R"([{"$cb":0}])", garbage, &bad).status == CANTUS_BAD_REQUEST);
  std::string tag = R"({"$what":1})";
  CHECK(call("$call", R"([{"$cb":0}])", garbage, &tag).status == CANTUS_BAD_REQUEST);
  std::string empty;
  CHECK(call("$call", R"([{"$cb":0}])", garbage, &empty).json == R"({"$u":1})");
}

TEST_CASE("handles are released and then refused", "[c_api]") {
  auto live = [] { return cantus::json::parse(call("$live", "[]").json).as_number(); };
  double base = live();
  Reply h = call("$counter", "[]");
  REQUIRE(h.status == CANTUS_OK);
  CHECK(live() == base + 1);
  std::string self = "[" + h.json + "]";
  CHECK(call("$counter#next", self).json == "1");
  auto id = static_cast<uint64_t>(field(h, "$h").as_number());
  cantus_release(id);
  CHECK(live() == base);
  Reply gone = call("$counter#next", self);
  CHECK(gone.status == CANTUS_RELEASED_HANDLE);
  CHECK(field(gone, "name").as_string() == "Error");
  CHECK(field(gone, "code").as_string() == "RELEASED_HANDLE");
  cantus_release(id);
  cantus_release(0);
  cantus_release(UINT64_MAX);
  CHECK(live() == base);

  CHECK(call("$counter#next", R"([{"$h":9007199254740991,"$type":"$counter"}])").status ==
        CANTUS_BAD_REQUEST);
  Reply other = call("$counter", "[]");
  std::string wrong = other.json;
  wrong.replace(wrong.find("$counter"), 8, "Rng");
  CHECK(call("$counter#next", "[" + wrong + "]").status == CANTUS_BAD_REQUEST);
  cantus_release(static_cast<uint64_t>(field(other, "$h").as_number()));
}

TEST_CASE("handle getters carry a stable $id until the state changes", "[c_api]") {
  Reply h = call("$counter", "[10]");
  std::string self = "[" + h.json + "]";
  Reply a = call("$counter#value", self);
  Reply b = call("$counter#value", self);
  CHECK(a.json == b.json);
  call("$counter#next", self);
  Reply c = call("$counter#value", self);
  CHECK(field(c, "$id").as_number() != field(a, "$id").as_number());
  CHECK(field(c, "count").as_number() == 11);
  cantus_release(static_cast<uint64_t>(field(h, "$h").as_number()));
}

TEST_CASE("the handle table is shared safely between threads", "[c_api]") {
  auto live = [] { return cantus::json::parse(call("$live", "[]").json).as_number(); };
  double base = live();
  std::atomic<int> failures{0};
  std::vector<std::thread> threads;
  for (int t = 0; t < 4; ++t) {
    threads.emplace_back([&failures] {
      for (int i = 0; i < 200; ++i) {
        char* out = nullptr;
        size_t len = 0;
        if (cantus_call("$counter", 8, "[]", 2, nullptr, nullptr, &out, &len) != CANTUS_OK) {
          ++failures;
          continue;
        }
        auto tag = cantus::json::parse(std::string_view(out, len));
        cantus_free(out);
        std::string self = "[" + cantus::json::stringify(tag) + "]";
        if (cantus_call("$counter#next", 13, self.data(), self.size(), nullptr, nullptr, &out,
                        &len) != CANTUS_OK ||
            std::string(out, len) != "1") {
          ++failures;
        }
        cantus_free(out);
        cantus_release(static_cast<uint64_t>(tag.as_object().find("$h")->as_number()));
      }
    });
  }
  for (std::thread& t : threads) {
    t.join();
  }
  CHECK(failures == 0);
  CHECK(live() == base);
}

TEST_CASE("one id shared by threads may be released by another while calls run", "[c_api]") {
  auto live = [] { return cantus::json::parse(call("$live", "[]").json).as_number(); };
  double base = live();
  std::string notes;
  for (int i = 0; i < 300; ++i) {
    notes += (i == 0 ? "" : ",") + std::string(R"({"pitch":60,"startBeat":)") + std::to_string(i) +
             R"(,"durationBeat":1})";
  }
  const std::string score = R"({"$class":"Score","notes":[)" + notes +
                            R"(],"meters":[{"startBeat":0,"ts":{"numerator":4,"denominator":4}}],)"
                            R"("tempo":[{"startBeat":0,"bpm":120}]})";
  const std::string expected = call("Score#secondsAt", "[" + score + ",250]").json;
  Reply ref = call("$retain", "[" + score + "]");
  Reply counter = call("$counter", "[]");
  REQUIRE(ref.status == CANTUS_OK);
  REQUIRE(counter.status == CANTUS_OK);
  const std::string on_ref = "[" + ref.json + ",250]";
  const std::string on_counter = "[" + counter.json + "]";

  std::atomic<bool> released{false};
  std::atomic<int> failures{0};
  std::atomic<int> refused{0};
  // A counter handle is used by one thread at a time; its release is not.
  std::mutex counter_turn;
  std::vector<std::thread> threads;
  for (int t = 0; t < 4; ++t) {
    threads.emplace_back([&] {
      // Calls run until a few have started after the release.
      for (int late = 0; late < 20;) {
        bool after = released.load();
        late += after ? 1 : 0;
        Reply r = call("Score#secondsAt", on_ref);
        if (r.status == CANTUS_RELEASED_HANDLE) {
          ++refused;
        } else if (after || r.status != CANTUS_OK || r.json != expected) {
          ++failures;
        }
        std::lock_guard<std::mutex> turn(counter_turn);
        after = released.load();
        Reply c = call("$counter#next", on_counter);
        if (c.status == CANTUS_RELEASED_HANDLE) {
          ++refused;
        } else if (after || c.status != CANTUS_OK) {
          ++failures;
        }
      }
    });
  }
  threads.emplace_back([&] {
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
    cantus_release(static_cast<uint64_t>(field(ref, "$ref").as_number()));
    cantus_release(static_cast<uint64_t>(field(counter, "$h").as_number()));
    released = true;
  });
  for (std::thread& t : threads) {
    t.join();
  }
  CHECK(failures == 0);
  CHECK(refused > 0);
  CHECK(call("Score#secondsAt", on_ref).status == CANTUS_RELEASED_HANDLE);
  CHECK(call("$counter#next", on_counter).status == CANTUS_RELEASED_HANDLE);
  CHECK(live() == base);
}

TEST_CASE("a request naming one retained value many times holds one snapshot", "[c_api]") {
  std::string notes;
  for (int i = 0; i < 2000; ++i) {
    notes += (i == 0 ? "" : ",") + std::string(R"({"pitch":)") + std::to_string(40 + i % 40) +
             R"(,"startBeat":)" + std::to_string(i) + R"(,"durationBeat":1})";
  }
  const std::string score = R"({"$class":"Score","notes":[)" + notes +
                            R"(],"meters":[{"startBeat":0,"ts":{"numerator":4,"denominator":4}}],)"
                            R"("tempo":[{"startBeat":0,"bpm":120}]})";
  Reply ref = call("$retain", "[" + score + "]");
  REQUIRE(ref.status == CANTUS_OK);
  std::string many = "[";
  for (int i = 0; i < 20000; ++i) {
    many += (i == 0 ? "" : ",") + ref.json;
  }
  many += "]";
  Reply r = call("Score#totalBeats", "[" + ref.json + "," + many + "]");
  CHECK(r.status == CANTUS_OK);
  CHECK(r.json == call("Score#totalBeats", "[" + score + "]").json);
  cantus_release(static_cast<uint64_t>(field(ref, "$ref").as_number()));
}

TEST_CASE("nesting beyond the parser limit is BAD_REQUEST", "[c_api]") {
  auto nested = [](std::size_t depth) { return std::string(depth, '[') + std::string(depth, ']'); };
  CHECK(call("$echo", nested(cantus::json::kMaxDepth)).status == CANTUS_OK);
  Reply r = call("$echo", nested(cantus::json::kMaxDepth + 1));
  CHECK(r.status == CANTUS_BAD_REQUEST);
  CHECK(field(r, "code").as_string() == "BAD_REQUEST");
}

TEST_CASE("no exception escapes, whatever the input", "[c_api]") {
  const char* inputs[] = {"",
                          "[",
                          "]",
                          "null",
                          "{}",
                          "[{\"$cb\":0}]",
                          "[1e400]",
                          "\xff\xfe",
                          "[\"\\ud800\"]",
                          "[{\"$h\":1,\"$type\":\"x\"}]",
                          "[[[[[[[[[[]]]]]]]]]]"};
  char* out = nullptr;
  size_t len = 0;
  REQUIRE(cantus_list_ops(&out, &len) == CANTUS_OK);
  auto ops = cantus::json::parse(std::string_view(out, len));
  cantus_free(out);
  std::size_t calls = 0;
  for (const auto& op : ops.as_array()) {
    const std::string& name = op.as_object().find("name")->as_string();
    for (const char* in : inputs) {
      CantusStatus status =
          cantus_call(name.data(), name.size(), in, std::strlen(in), fail, nullptr, &out, &len);
      CHECK(out != nullptr);
      if (status != CANTUS_OK) {
        auto err = cantus::json::parse(std::string_view(out, len));
        CHECK(err.as_object().contains("code"));
        CHECK(err.as_object().contains("message"));
      } else if (name == "$counter") {
        cantus_release(static_cast<uint64_t>(
            cantus::json::parse(std::string_view(out, len)).as_object().find("$h")->as_number()));
      }
      cantus_free(out);
      ++calls;
    }
  }
  CHECK(calls > 0);
}

TEST_CASE("version accessors", "[c_api]") {
  CHECK(std::string(cantus_version()) == "1.3.0");
  CHECK(cantus_abi_version() == CANTUS_ABI_VERSION);
  CHECK(cantus_algorithm_version() == 1);
}

TEST_CASE("cantus_list_ops lists the builtin ops sorted, with their needs", "[c_api]") {
  char* out = nullptr;
  size_t len = 0;
  REQUIRE(cantus_list_ops(&out, &len) == CANTUS_OK);
  std::string json(out, len);
  cantus_free(out);
  auto ops = cantus::json::parse(json);
  std::vector<std::string> names;
  for (const auto& op : ops.as_array()) {
    names.push_back(op.as_object().find("name")->as_string());
  }
  std::vector<std::string> builtins;
  for (const std::string& n : names) {
    if (!n.empty() && n[0] == '$' && n.rfind("$const:", 0) != 0) {
      builtins.push_back(n);
    }
  }
  CHECK(builtins == std::vector<std::string>{"$call", "$counter", "$counter#next", "$counter#value",
                                             "$echo", "$live", "$retain", "$throw", "$version"});
  CHECK(std::is_sorted(names.begin(), names.end()));
  CHECK(json.find(R"({"name":"$call","callbacks":true,"handles":false})") != std::string::npos);
  CHECK(json.find(R"({"name":"$counter#next","callbacks":false,"handles":true})") !=
        std::string::npos);
}
