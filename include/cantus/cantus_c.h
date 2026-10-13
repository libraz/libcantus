/**
 * @file cantus_c.h
 * @brief The C ABI every binding goes through: one JSON op entry point plus handle release.
 *
 * Every string crossing this boundary is length-delimited UTF-8 (WTF-8 for lone surrogates), so
 * an embedded NUL never truncates an op name or a payload. Values use the wire tags of the op
 * layer (`$n`, `$u`, `$h`, `$cb`, ...). Memory returned through an out-parameter is owned by the
 * caller and must be released with cantus_free().
 */
#ifndef CANTUS_CANTUS_C_H_
#define CANTUS_CANTUS_C_H_

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#define CANTUS_C_API __declspec(dllexport)
#else
#define CANTUS_C_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
#define CANTUS_NOEXCEPT noexcept
#else
#define CANTUS_NOEXCEPT
#endif

/** Version of this header's calling convention; bindings refuse a library reporting another. */
#define CANTUS_ABI_VERSION 1

#ifdef __cplusplus
extern "C" {
#endif

/** Outcome of a call. Values are fixed; new ones are only ever appended. */
typedef enum CantusStatus {
  CANTUS_OK = 0,
  CANTUS_INVALID_INPUT = 1,
  CANTUS_NO_SOLUTION = 2,
  CANTUS_BUDGET_EXCEEDED = 3,
  CANTUS_HOST_TYPE_ERROR = 4,
  CANTUS_UNKNOWN_OP = 10,
  CANTUS_BAD_REQUEST = 11,
  CANTUS_CALLBACK_FAILED = 12,
  CANTUS_RELEASED_HANDLE = 13,
  CANTUS_INTERNAL = 99
} CantusStatus;

/**
 * Host function behind every `{"$cb": id}` argument of one cantus_call.
 *
 * @param ctx The `cb_ctx` given to cantus_call.
 * @param callback_id The id from the `$cb` tag.
 * @param args_json Wire JSON array of the callback's arguments (not NUL-terminated).
 * @param args_len Length of args_json in bytes.
 * @param out_json Receives the wire JSON of the return value. The buffer stays owned by the host
 *        and must remain valid until the enclosing cantus_call returns; the core copies it.
 * @param out_len Receives the length of *out_json in bytes.
 * @return 0 on success; any other value reports CANTUS_CALLBACK_FAILED to the op's caller.
 */
typedef int32_t (*CantusCallbackFn)(void* ctx, uint32_t callback_id, const char* args_json,
                                    size_t args_len, char** out_json, size_t* out_len);

/**
 * Run one op.
 *
 * On entry `*out_json` is set to NULL and `*out_len` to 0. On CANTUS_OK the output is the wire
 * JSON of the result; on any other status it is `{"code","name","message","at"?}`. Never throws.
 * Reentrant: a callback may call cantus_call again.
 *
 * @param op Op name, e.g. `detectChord`, `Score#transpose`, `$echo` (not NUL-terminated).
 * @param op_len Length of op in bytes.
 * @param args_json Wire JSON array of positional arguments; an empty payload means `[]`.
 * @param args_len Length of args_json in bytes.
 * @param cb Host function for `$cb` arguments, or NULL when the call passes none.
 * @param cb_ctx Passed through to cb.
 * @param out_json Receives a malloc'd buffer; release with cantus_free().
 * @param out_len Receives the buffer's length in bytes (excluding the trailing NUL it carries).
 */
CANTUS_C_API CantusStatus cantus_call(const char* op, size_t op_len, const char* args_json,
                                      size_t args_len, CantusCallbackFn cb, void* cb_ctx,
                                      char** out_json, size_t* out_len) CANTUS_NOEXCEPT;

/** Release a buffer returned by cantus_call() or cantus_list_ops(). NULL is ignored. */
CANTUS_C_API void cantus_free(char* p) CANTUS_NOEXCEPT;

/** Release a handle (`{"$h": id}`). Unknown and already released ids are ignored. */
CANTUS_C_API void cantus_release(uint64_t handle) CANTUS_NOEXCEPT;

/** Library version, e.g. "1.3.0". Static storage. */
CANTUS_C_API const char* cantus_version(void) CANTUS_NOEXCEPT;

/** Generator algorithm version this build produces by default. */
CANTUS_C_API uint32_t cantus_algorithm_version(void) CANTUS_NOEXCEPT;

/** CANTUS_ABI_VERSION of the library. */
CANTUS_C_API uint32_t cantus_abi_version(void) CANTUS_NOEXCEPT;

/**
 * List the registered ops as a JSON array of `{"name","callbacks","handles"}`, sorted by name.
 *
 * @param out_json Receives a malloc'd buffer; release with cantus_free().
 * @param out_len Receives the buffer's length in bytes.
 */
CANTUS_C_API CantusStatus cantus_list_ops(char** out_json, size_t* out_len) CANTUS_NOEXCEPT;

#ifdef __cplusplus
}
#endif

#endif  // CANTUS_CANTUS_C_H_
