# WebAssembly module exporting the C ABI (cantus_call and friends) for bindings/wasm.
#
# Output: cantus.js (an ES module factory, MODULARIZE + EXPORT_ES6) and cantus.wasm. The JS side
# reaches the core through the exported C functions only; a single host callback trampoline is
# installed with addFunction. -fwasm-exceptions comes from the top-level CMakeLists for every TU
# and the link (tools/conformance/check_wasm_flags.py checks it).

add_executable(cantus_wasm src/wasm/module.cpp)
set_target_properties(cantus_wasm PROPERTIES OUTPUT_NAME cantus SUFFIX ".js")
target_compile_options(cantus_wasm PRIVATE ${CANTUS_WARNINGS})
target_link_libraries(cantus_wasm PRIVATE cantus_ops cantus)

# The op layer only marshals values across the boundary, so it and the link's wasm-opt take -Oz
# while the core keeps -O3: gzip -20% with the corpus replay time unchanged, where -Oz on the core
# as well reached -40% but replayed 1.4 times slower.
set(CANTUS_WASM_GLUE_OPT_FLAGS $<$<CONFIG:Release>:-Oz>)
target_compile_options(cantus_ops PRIVATE ${CANTUS_WASM_GLUE_OPT_FLAGS})
target_link_options(cantus_wasm PRIVATE ${CANTUS_WASM_GLUE_OPT_FLAGS})

set(_cantus_wasm_exports
  _cantus_call _cantus_free _cantus_release _cantus_version _cantus_algorithm_version
  _cantus_abi_version _cantus_list_ops _malloc _free)
list(JOIN _cantus_wasm_exports "," _cantus_wasm_exports)

target_link_options(cantus_wasm PRIVATE
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createCantusModule
  -sENVIRONMENT=web,worker,node
  -sEXPORTED_FUNCTIONS=${_cantus_wasm_exports}
  -sEXPORTED_RUNTIME_METHODS=addFunction,HEAPU8,HEAPU32
  -sALLOW_TABLE_GROWTH=1
  -sALLOW_MEMORY_GROWTH=1
  # The JSON parser nests 4,096 deep; the default 64 KiB stack does not hold that.
  -sSTACK_SIZE=8388608
  -sFILESYSTEM=0)
