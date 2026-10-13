/**
 * @file format.h
 * @brief Message formatting shared by the typed and the JSON-level validators.
 *
 * The json::Value overloads read the D4 value tags (`$n`, `$u`, `$big`, `$sym`, `$tojson` /
 * `$repr`, `$cb`) so that a value arriving over the op boundary is described exactly as the
 * TS validator describes the JS value it stands for.
 */
#ifndef CANTUS_JS_FORMAT_H_
#define CANTUS_JS_FORMAT_H_

#include <stdexcept>
#include <string>
#include <string_view>

#include "json/json.h"

namespace cantus::js {

/** The TypeError JS raises when a Symbol is converted to a string. */
class TypeError : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

/** `JSON.stringify(s)` of a WTF-8 string; lone surrogates are written as `\udXXX`. */
std::string quote(std::string_view s);

/** Append `JSON.stringify(s)` to `out`. */
void quote_to(std::string_view s, std::string& out);

/**
 * `${v}` of the JS value `v` stands for: arrays comma-join (null/undefined elements empty),
 * plain objects give "[object Object]".
 * @throws TypeError for a Symbol (`$sym`), anywhere in the value.
 * @throws std::invalid_argument for a callback (`$cb`), whose source text is not available.
 */
std::string template_string(const json::Value& v);

}  // namespace cantus::js

#endif  // CANTUS_JS_FORMAT_H_
