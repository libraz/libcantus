# Catch2 tests for src/js and src/json. Configures standalone (cmake -S tests/js) or as a
# subdirectory of the root build, which then supplies Catch2 and the compile flags.
cmake_minimum_required(VERSION 3.20)

if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
  project(cantus_js_tests LANGUAGES CXX)
  set(CMAKE_CXX_STANDARD 17)
  set(CMAKE_CXX_STANDARD_REQUIRED ON)
  set(CMAKE_CXX_EXTENSIONS OFF)
  if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release)
  endif()
  add_compile_options(-ffp-contract=off -fno-fast-math -Wall -Wextra -Wpedantic -Wshadow)
  enable_testing()
endif()

if(NOT TARGET Catch2::Catch2WithMain)
  include(FetchContent)
  FetchContent_Declare(
    Catch2
    URL https://github.com/catchorg/Catch2/archive/refs/tags/v3.7.1.tar.gz
    URL_HASH SHA256=c991b247a1a0d7bb9c39aa35faf0fe9e19764213f28ffba3109388e62ee0269c
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
  FetchContent_MakeAvailable(Catch2)
endif()
if(DEFINED catch2_SOURCE_DIR)
  list(APPEND CMAKE_MODULE_PATH ${catch2_SOURCE_DIR}/extras)
endif()
include(Catch)

set(CANTUS_SRC_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../src)
set(CANTUS_JS_JSON_SOURCES
    ${CANTUS_SRC_DIR}/js/decimal.cpp
    ${CANTUS_SRC_DIR}/js/format.cpp
    ${CANTUS_SRC_DIR}/js/ieee754.cpp
    ${CANTUS_SRC_DIR}/js/math.cpp
    ${CANTUS_SRC_DIR}/js/number.cpp
    ${CANTUS_SRC_DIR}/js/utf16.cpp
    ${CANTUS_SRC_DIR}/json/parse.cpp
    ${CANTUS_SRC_DIR}/json/value.cpp
    ${CANTUS_SRC_DIR}/json/write.cpp)

# The library as the platform builds it, and once more with the strtod / snprintf fallbacks
# forced, so both conversion paths are exercised on every platform.
add_library(cantus_js_test_lib STATIC ${CANTUS_JS_JSON_SOURCES})
target_include_directories(cantus_js_test_lib PUBLIC ${CANTUS_SRC_DIR})

add_library(cantus_js_test_lib_fallback STATIC ${CANTUS_JS_JSON_SOURCES})
target_include_directories(cantus_js_test_lib_fallback PUBLIC ${CANTUS_SRC_DIR})
target_compile_definitions(cantus_js_test_lib_fallback
                           PUBLIC CANTUS_JS_HAVE_FROM_CHARS_DOUBLE=0 CANTUS_JS_HAVE_TO_CHARS_DOUBLE=0)

# ieee754_fused.cpp rebuilds the V8 port with contraction, as Node's clang build does (clang's
# default "on"; GCC only contracts with "fast"), to tell Node's FMA rounding from a porting error.
set(CANTUS_JS_FUSED_OPTIONS $<IF:$<CXX_COMPILER_ID:GNU>,-ffp-contract=fast,-ffp-contract=on>)
if(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|AMD64")
  list(APPEND CANTUS_JS_FUSED_OPTIONS -mfma)
endif()
set_source_files_properties(ieee754_fused.cpp PROPERTIES COMPILE_OPTIONS "${CANTUS_JS_FUSED_OPTIONS}")

add_executable(cantus_js_tests
    ieee754_fused.cpp test_format.cpp test_json.cpp test_math.cpp test_number.cpp
    test_vectors.cpp)
target_link_libraries(cantus_js_tests PRIVATE cantus_js_test_lib Catch2::Catch2WithMain)
target_compile_definitions(cantus_js_tests
                           PRIVATE CANTUS_JS_VECTOR_DIR="${CMAKE_CURRENT_SOURCE_DIR}/vectors")
catch_discover_tests(cantus_js_tests TEST_PREFIX "js.")

add_executable(cantus_js_tests_fallback
    ieee754_fused.cpp test_json.cpp test_number.cpp test_vectors.cpp)
target_link_libraries(cantus_js_tests_fallback
                      PRIVATE cantus_js_test_lib_fallback Catch2::Catch2WithMain)
target_compile_definitions(cantus_js_tests_fallback
                           PRIVATE CANTUS_JS_VECTOR_DIR="${CMAKE_CURRENT_SOURCE_DIR}/vectors")
catch_discover_tests(cantus_js_tests_fallback TEST_PREFIX "js.fallback.")
