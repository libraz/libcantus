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

}  // namespace cantus::js

#endif  // CANTUS_JS_VALUE_H_
