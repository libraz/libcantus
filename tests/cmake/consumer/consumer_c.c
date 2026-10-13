/* A C program calling the installed C ABI. */

#include <cantus/cantus_c.h>
#include <string.h>

int main(void) {
  char* out = NULL;
  size_t len = 0;
  CantusStatus status = cantus_call("$echo", 5, "[\"hi\"]", 6, NULL, NULL, &out, &len);
  int ok = status == CANTUS_OK && len == 4 && memcmp(out, "\"hi\"", 4) == 0 &&
           cantus_abi_version() == CANTUS_ABI_VERSION;
  cantus_free(out);
  return ok ? 0 : 1;
}
