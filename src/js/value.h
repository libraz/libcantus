/**
 * @file value.h
 * @brief JS semantics of wire values: `typeof`, truthiness and `ToNumber`.
 *
 * A json::Value stands for the JS value its D4 tag (`$n`, `$u`, `$big`, `$sym`, `$tojson`,
 * `$cb`) names; these read it the way the JS operators read that value. Tags are assumed to be
 * well formed.
 */
#ifndef CANTUS_JS_VALUE_H_
#define CANTUS_JS_VALUE_H_

#include <string>

#include "json/json.h"

namespace cantus::js {

/** `typeof v` of the JS value a wire value stands for. */
std::string type_of(const json::Value& v);

/** JS truthiness of a wire value. */
bool truthy(const json::Value& v);

/**
 * `ToNumber(v)` as a relational comparison applies it.
 * @throws TypeError for a Symbol.
 */
double to_number(const json::Value& v);

/**
 * `ToNumber(v)` as `Math.max`, `Math.min` and the other `Math` functions apply it: as to_number(),
 * but a bigint is refused.
 * @throws TypeError for a Symbol or a bigint.
 */
double to_math_number(const json::Value& v);

/**
 * `lhs + rhs` for a number on the left: a number for a number, boolean, null or undefined on the
 * right, and the concatenated text for a string, array or object.
 * @throws TypeError for a Symbol or a bigint on the right.
 */
json::Value add_number(double lhs, const json::Value& rhs);

/**
 * `lhs > rhs` for wire values: text against text (strings, arrays, plain objects) compares by
 * UTF-16 code units, anything else compares as numbers.
 * @throws TypeError for a Symbol.
 */
bool greater_than(const json::Value& lhs, const json::Value& rhs);

}  // namespace cantus::js

#endif  // CANTUS_JS_VALUE_H_
