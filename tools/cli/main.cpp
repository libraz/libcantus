// The cantus command-line tool: one op per invocation through the C ABI, JSON in and out.
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <string_view>
#include <system_error>

#include "cantus/cantus_c.h"
#include "exit_codes.h"
#include "js/utf16.h"

namespace {

constexpr const char* kUsage =
    "usage: cantus <op> [ARGS_JSON | @file | -]\n"
    "       cantus list | describe <op> | version\n";

int exit_code(ExitCode code) { return static_cast<int>(code); }

ExitCode from_status(CantusStatus status) {
  switch (status) {
    case CANTUS_OK:
      return ExitCode::kOk;
    case CANTUS_INVALID_INPUT:
      return ExitCode::kInvalidInput;
    case CANTUS_NO_SOLUTION:
      return ExitCode::kNoSolution;
    case CANTUS_BUDGET_EXCEEDED:
      return ExitCode::kBudgetExceeded;
    case CANTUS_HOST_TYPE_ERROR:
      return ExitCode::kHostTypeError;
    case CANTUS_UNKNOWN_OP:
      return ExitCode::kUnknownOp;
    case CANTUS_BAD_REQUEST:
      return ExitCode::kBadRequest;
    case CANTUS_CALLBACK_FAILED:
    case CANTUS_RELEASED_HANDLE:
    case CANTUS_INTERNAL:
      return ExitCode::kInternal;
  }
  return ExitCode::kInternal;
}

std::string json_quote(std::string_view s) {
  std::string out = "\"";
  for (char c : s) {
    unsigned char u = static_cast<unsigned char>(c);
    if (c == '"' || c == '\\') {
      out += '\\';
      out += c;
    } else if (u < 0x20) {
      char buf[8];
      std::snprintf(buf, sizeof buf, "\\u%04x", u);
      out += buf;
    } else {
      out += c;
    }
  }
  return out + '"';
}

/** Argument text as an error message may quote it: ill-formed UTF-8 shown as U+FFFD. */
std::string shown(std::string_view s) { return cantus::js::replace_ill_formed_utf8(s); }

int fail(ExitCode code, const std::string& code_name, const std::string& message) {
  std::cerr << "{\"code\":" << json_quote(code_name)
            << ",\"name\":\"Error\",\"message\":" << json_quote(message) << "}\n";
  return exit_code(code);
}

int bad_request(const std::string& message) {
  return fail(ExitCode::kBadRequest, "BAD_REQUEST", message);
}

/** Writes `text` and a newline, then flushes; false when the stream did not take all of it. */
bool write_line(std::ostream& out, std::string_view text) {
  out << text << '\n';
  out.flush();
  return static_cast<bool>(out);
}

/** Writes `text` to `out` and returns `ok`, or INTERNAL when the output could not be written. */
int emit(std::ostream& out, std::string_view text, ExitCode ok = ExitCode::kOk) {
  if (write_line(out, text)) return exit_code(ok);
  return fail(ExitCode::kInternal, "INTERNAL", "cannot write output");
}

/** Calls the library; returns the exit code after printing to stdout or stderr. */
int print_result(CantusStatus status, char* json, size_t len) {
  std::string body = json != nullptr ? std::string(json, len) : std::string();
  cantus_free(json);
  return emit(status == CANTUS_OK ? std::cout : std::cerr, body, from_status(status));
}

bool list_ops(std::string* out) {
  char* json = nullptr;
  size_t len = 0;
  CantusStatus status = cantus_list_ops(&json, &len);
  if (status != CANTUS_OK || json == nullptr) {
    cantus_free(json);
    return false;
  }
  out->assign(json, len);
  cantus_free(json);
  return true;
}

/** Reports that list_ops() failed; the exit code to return. */
int list_failure() { return fail(ExitCode::kInternal, "INTERNAL", "cannot list ops"); }

/** The `{...}` entry of `op` in the flat list array, or an empty string. */
std::string find_entry(const std::string& list, const std::string& op) {
  std::string needle = "\"name\":" + json_quote(op) + ",";
  size_t at = list.find(needle);
  if (at == std::string::npos) return "";
  size_t begin = list.rfind('{', at);
  size_t end = list.find('}', at);
  if (begin == std::string::npos || end == std::string::npos) return "";
  return list.substr(begin, end - begin + 1);
}

bool read_stream(std::istream& in, std::string* out) {
  out->clear();
  char buffer[4096];
  while (in.read(buffer, sizeof buffer) || in.gcount() > 0) out->append(buffer, in.gcount());
  // A clean read ends at end of file; anything else is a read error.
  return in.eof() && !in.bad();
}

/** Reads all of standard input; false when it is closed or fails, rather than empty. */
bool read_stdin(std::string* out) {
  // A closed descriptor reads as end of file through the stream; only the C stream knows.
  std::clearerr(stdin);
  return read_stream(std::cin, out) && std::ferror(stdin) == 0;
}

int run_op(const std::string& op, const char* arg) {
  std::string list;
  if (!list_ops(&list)) return list_failure();
  std::string entry = find_entry(list, op);
  if (!entry.empty() && (entry.find("\"callbacks\":true") != std::string::npos ||
                         entry.find("\"handles\":true") != std::string::npos)) {
    return bad_request("callback arguments are not available from the CLI");
  }

  std::string args;
  if (arg == nullptr) {
    // No payload means no arguments.
  } else if (std::string_view(arg) == "-") {
    if (!read_stdin(&args)) return bad_request("cannot read standard input");
  } else if (arg[0] == '@') {
    std::error_code ec;
    std::ifstream file;
    // Only a directory is refused up front; FIFOs and /dev/fd paths are read as streams.
    if (!std::filesystem::is_directory(arg + 1, ec)) file.open(arg + 1, std::ios::binary);
    if (!file.is_open() || !read_stream(file, &args)) {
      return bad_request("cannot read " + shown(arg + 1));
    }
  } else {
    args = arg;
  }

  char* json = nullptr;
  size_t len = 0;
  CantusStatus status =
      cantus_call(op.data(), op.size(), args.data(), args.size(), nullptr, nullptr, &json, &len);
  return print_result(status, json, len);
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << kUsage;
    return bad_request("missing op");
  }
  std::string command = argv[1];
  if (command == "version") {
    return emit(std::cout, json_quote(cantus_version()));
  }
  if (command == "list") {
    std::string list;
    if (!list_ops(&list)) return list_failure();
    return emit(std::cout, list);
  }
  if (command == "describe") {
    if (argc != 3) return bad_request("describe takes one op name");
    std::string list;
    if (!list_ops(&list)) return list_failure();
    std::string entry = find_entry(list, argv[2]);
    if (entry.empty()) {
      return fail(ExitCode::kUnknownOp, "UNKNOWN_OP", "unknown op " + json_quote(shown(argv[2])));
    }
    return emit(std::cout, entry);
  }
  if (argc > 3) return bad_request("too many arguments");
  return run_op(command, argc == 3 ? argv[2] : nullptr);
}
