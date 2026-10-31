cmake_minimum_required(VERSION 3.24)

# The Node-API addon over the C ABI, built by cmake-js (Node-API mode: headers come from the
# node-api-headers package, so no Node distribution is downloaded).
project(cantus_node LANGUAGES C CXX)

# The library tree as a subproject: not top level, so its tests, CLI and install rules stay off.
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../.. ${CMAKE_CURRENT_BINARY_DIR}/cantus EXCLUDE_FROM_ALL)

# package.json `binary.napi_versions` is the one source of the Node-API version.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/package.json" _cantus_node_package_json)
string(JSON CANTUS_NAPI_VERSION GET "${_cantus_node_package_json}" binary napi_versions 0)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
             "${CMAKE_CURRENT_SOURCE_DIR}/package.json")

add_library(cantus_node SHARED src/addon.cpp ${CMAKE_JS_SRC})
set_target_properties(cantus_node PROPERTIES
  PREFIX ""
  SUFFIX ".node"
  CXX_STANDARD 17
  CXX_STANDARD_REQUIRED ON
  CXX_EXTENSIONS OFF
  CXX_VISIBILITY_PRESET hidden)
target_include_directories(cantus_node SYSTEM PRIVATE ${CMAKE_JS_INC})
target_compile_definitions(cantus_node PRIVATE
  NAPI_VERSION=${CANTUS_NAPI_VERSION} NAPI_CPP_EXCEPTIONS)
target_compile_options(cantus_node PRIVATE -Wall -Wextra -Wpedantic -Wshadow -Werror
  $<$<CXX_COMPILER_ID:GNU>:-Wno-error=maybe-uninitialized>)
target_link_libraries(cantus_node PRIVATE cantus::ops ${CMAKE_JS_LIB})
