# The op layer: shared machinery, then per module group an adapter file <group>.cpp and its
# codec_<group>.{h,cpp} (see register_all.h for the groups).
target_sources(cantus_ops PRIVATE
  accessors.cpp
  args.cpp
  builtins.cpp
  callbacks.cpp
  codec.cpp
  dispatch.cpp
  error_map.cpp
  handles.cpp
  register_all.cpp
  registry.cpp
  validate.cpp)

set(CANTUS_OP_GROUPS c1 c2 t1 t2 t3 t4 a1a a1b a1c a2 a3 a4 a5 g1 g2a g2b g3 g4 m1 m2 m3)
foreach(_cantus_group IN LISTS CANTUS_OP_GROUPS)
  target_sources(cantus_ops PRIVATE ${_cantus_group}.cpp codec_${_cantus_group}.cpp)
endforeach()
