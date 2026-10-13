# The cantus command-line tool (JSON in, JSON out) over cantus::ops.
add_executable(cantus_cli main.cpp)
set_target_properties(cantus_cli PROPERTIES OUTPUT_NAME cantus)
target_compile_options(cantus_cli PRIVATE ${CANTUS_WARNINGS})
target_link_libraries(cantus_cli PRIVATE cantus::ops)
