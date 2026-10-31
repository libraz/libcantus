# The cantus command-line tool (JSON in, JSON out) over cantus::ops.
add_executable(cantus_cli main.cpp)
set_target_properties(cantus_cli PROPERTIES OUTPUT_NAME cantus)
target_compile_options(cantus_cli PRIVATE ${CANTUS_WARNINGS})
target_link_libraries(cantus_cli PRIVATE cantus::ops)
# The CLI quotes argv through the core's own UTF-8 reading.
target_include_directories(cantus_cli PRIVATE ${PROJECT_SOURCE_DIR}/src)
# The Linux release binary is fully static, so it starts on any distribution whatever its glibc.
if(CMAKE_SYSTEM_NAME STREQUAL "Linux" AND CMAKE_BUILD_TYPE STREQUAL "Release")
  target_link_options(cantus_cli PRIVATE -static)
endif()
