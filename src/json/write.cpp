#include <cmath>
#include <vector>

#include "js/format.h"
#include "js/number.h"
#include "json/json.h"

namespace cantus::json {

void stringify_to(const Value& value, std::string& out) {
  // One frame per open container, so nesting depth costs heap, not native stack.
  struct Frame {
    const Value* container;
    std::size_t next;
  };
  std::vector<Frame> stack;
  const Value* current = &value;
  while (true) {
    switch (current->kind()) {
      case Kind::kNull:
        out += "null";
        break;
      case Kind::kBool:
        out += current->as_bool() ? "true" : "false";
        break;
      case Kind::kNumber: {
        double n = current->as_number();
        out += std::isfinite(n) ? js::to_string(n) : "null";
        break;
      }
      case Kind::kString:
        js::quote_to(current->as_string(), out);
        break;
      case Kind::kArray:
        out.push_back('[');
        stack.push_back(Frame{current, 0});
        break;
      case Kind::kObject:
        out.push_back('{');
        stack.push_back(Frame{current, 0});
        break;
    }
    // Advance to the next value to write, closing containers that are exhausted.
    while (true) {
      if (stack.empty()) {
        return;
      }
      Frame& frame = stack.back();
      const bool is_array = frame.container->is_array();
      const std::size_t size =
          is_array ? frame.container->as_array().size() : frame.container->as_object().size();
      if (frame.next == size) {
        out.push_back(is_array ? ']' : '}');
        stack.pop_back();
        continue;
      }
      if (frame.next > 0) {
        out.push_back(',');
      }
      if (is_array) {
        current = &frame.container->as_array()[frame.next];
      } else {
        const Member& member = frame.container->as_object().begin()[frame.next];
        js::quote_to(member.key, out);
        out.push_back(':');
        current = &member.value;
      }
      ++frame.next;
      break;
    }
  }
}

std::string stringify(const Value& value) {
  std::string out;
  stringify_to(value, out);
  return out;
}

}  // namespace cantus::json
