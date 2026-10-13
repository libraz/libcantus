#include "ops/register_all.h"

namespace cantus::ops {

void register_all() {
  register_builtins();
  register_c1();
  register_c2();
  register_t1();
  register_t2();
  register_t3();
  register_t4();
  register_a1a();
  register_a1b();
  register_a1c();
  register_a2();
  register_a3();
  register_a4();
  register_a5();
  register_g1();
  register_g2a();
  register_g2b();
  register_g3();
  register_g4();
  register_m1();
  register_m2();
  register_m3();
}

}  // namespace cantus::ops
