// The V8 port built a second time with floating-point contraction allowed, as Node's own
// binary is built on FMA targets. Renaming the namespace keeps it apart from the real port.
#define cantus cantus_fused
#include "../../src/js/ieee754.cpp"  // NOLINT(bugprone-suspicious-include)
#undef cantus
