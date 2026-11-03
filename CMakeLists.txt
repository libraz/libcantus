cmake_minimum_required(VERSION 3.24)

# ts/package.json is the one source of the version; include/cantus/version.h must agree.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/ts/package.json" _cantus_package_json)
string(JSON CANTUS_PACKAGE_VERSION GET "${_cantus_package_json}" version)
project(cantus VERSION ${CANTUS_PACKAGE_VERSION} LANGUAGES C CXX)

file(STRINGS "${PROJECT_SOURCE_DIR}/include/cantus/version.h" _cantus_version_line
     REGEX "^#define CANTUS_VERSION_STRING ")
if(NOT _cantus_version_line MATCHES "\"${PROJECT_VERSION}\"")
  message(FATAL_ERROR "include/cantus/version.h does not say ${PROJECT_VERSION} (ts/package.json)")
endif()
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
             "${PROJECT_SOURCE_DIR}/ts/package.json" "${PROJECT_SOURCE_DIR}/include/cantus/version.h")

if(WIN32)
  message(FATAL_ERROR "Windows is not a supported platform; build under WSL2.")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
# The archives also go into the Python shared library and the Node addon.
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
# Only the C ABI (CANTUS_C_API) is exported from a shared object.
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)

include(GNUInstallDirs)
list(APPEND CMAKE_MODULE_PATH "${PROJECT_SOURCE_DIR}/cmake")

if(PROJECT_IS_TOP_LEVEL AND NOT EMSCRIPTEN)
  set(_cantus_install_default ON)
else()
  set(_cantus_install_default OFF)
endif()
option(CANTUS_BUILD_TESTS "Build the Catch2 tests" ${PROJECT_IS_TOP_LEVEL})
option(CANTUS_BUILD_CLI "Build the cantus command-line tool" ${PROJECT_IS_TOP_LEVEL})
option(CANTUS_BUILD_SHARED "Build the C ABI shared library (Python binding)" OFF)
option(CANTUS_INSTALL "Generate install and find_package() rules" ${_cantus_install_default})

# Floating point is bit-identical across platforms and build types: no contraction into FMA, no
# fast-math, and SSE2 rather than x87 on x86-64. Every target of this tree gets these.
add_compile_options(-ffp-contract=off -fno-fast-math)
if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(x86_64|AMD64|amd64)$" AND NOT EMSCRIPTEN)
  add_compile_options(-msse2 -mfpmath=sse)
endif()
# The library throws internally; WebAssembly needs exception support in every translation unit.
# Native wasm exceptions rather than the JS-emulated kind: the module is 18% smaller raw and the
# corpus replays in half the time, and every engine since 2022 (Node 17) runs them.
if(EMSCRIPTEN)
  add_compile_options(-fwasm-exceptions)
  add_link_options(-fwasm-exceptions)
endif()

set(CANTUS_WARNINGS -Wall -Wextra -Wpedantic -Wshadow)
if(PROJECT_IS_TOP_LEVEL)
  list(APPEND CANTUS_WARNINGS -Werror)
  # GCC's optimizer reports uninitialized reads inside std::optional and std::variant that cannot
  # happen; the warning stays visible but does not fail the build.
  if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
    list(APPEND CANTUS_WARNINGS -Wno-error=maybe-uninitialized)
  endif()
endif()

# Translation units that are still stubs have no symbols; keep macOS ranlib quiet about them.
if(APPLE)
  set(CMAKE_CXX_ARCHIVE_CREATE "<CMAKE_AR> Scr <TARGET> <LINK_FLAGS> <OBJECTS>")
  set(CMAKE_CXX_ARCHIVE_FINISH "<CMAKE_RANLIB> -no_warning_for_no_symbols -c <TARGET>")
endif()

# cantus::cantus — the typed C++ API. JSON stays internal: no public header names it.
add_library(cantus STATIC)
add_library(cantus::cantus ALIAS cantus)
set_target_properties(cantus PROPERTIES EXPORT_NAME cantus)
target_compile_features(cantus PUBLIC cxx_std_17)
target_include_directories(cantus
  PUBLIC $<BUILD_INTERFACE:${PROJECT_SOURCE_DIR}/include>
         $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
  PRIVATE ${PROJECT_SOURCE_DIR}/src)
target_compile_options(cantus PRIVATE ${CANTUS_WARNINGS})
target_sources(cantus PRIVATE
  src/js/decimal.cpp
  src/js/format.cpp
  src/js/ieee754.cpp
  src/js/math.cpp
  src/js/number.cpp
  src/js/utf16.cpp
  src/js/value.cpp
  src/json/parse.cpp
  src/json/value.cpp
  src/json/write.cpp)

# cantus::ops — the JSON op layer and the C ABI every binding goes through.
add_library(cantus_ops STATIC)
add_library(cantus::ops ALIAS cantus_ops)
set_target_properties(cantus_ops PROPERTIES EXPORT_NAME ops)
target_include_directories(cantus_ops
  PUBLIC $<BUILD_INTERFACE:${PROJECT_SOURCE_DIR}/include>
         $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
  PRIVATE ${PROJECT_SOURCE_DIR}/src)
target_compile_options(cantus_ops PRIVATE ${CANTUS_WARNINGS})
target_link_libraries(cantus_ops PUBLIC cantus)

# One directory per ts/src module (and per layer, for the files beside each index.ts); each adds
# its own sources with target_sources(cantus PRIVATE ...).
set(CANTUS_MODULE_DIRS
  core
  core/duration
  core/errors
  core/event_index
  core/instrument
  core/interval
  core/meter
  core/pitch
  core/random
  core/tempo
  core/tuning
  core/validation
  theory
  theory/chord
  theory/chordscale
  theory/counterpoint
  theory/figured_bass
  theory/harmony
  theory/partwriting
  theory/safety
  theory/scale
  theory/spelling
  theory/symbol
  theory/tendency
  theory/transposition
  theory/voicing
  analyze
  analyze/arrange
  analyze/detect
  analyze/form
  analyze/functional
  analyze/keys
  analyze/melody
  analyze/reduction
  analyze/reference
  analyze/rhythm
  analyze/spelling
  analyze/timeline
  analyze/voice
  generate
  generate/bass
  generate/context
  generate/countermelody
  generate/drums
  generate/groove
  generate/harmonize
  generate/melody
  generate/motif
  generate/ornament
  generate/plan
  generate/progression
  generate/reharmony
  generate/rhythm
  generate/vocabulary
  model)
foreach(_cantus_dir IN LISTS CANTUS_MODULE_DIRS)
  add_subdirectory(src/${_cantus_dir})
endforeach()
add_subdirectory(src/ops)
add_subdirectory(src/c_api)

# cantus_shared — libcantus.{so,dylib} exporting the C ABI only, loaded by the Python binding.
if(CANTUS_BUILD_SHARED)
  add_library(cantus_shared SHARED src/c_api/shared_library.cpp)
  set_target_properties(cantus_shared PROPERTIES
    EXPORT_NAME shared
    OUTPUT_NAME cantus
    VERSION ${PROJECT_VERSION}
    SOVERSION ${PROJECT_VERSION_MAJOR})
  target_link_libraries(cantus_shared PRIVATE "$<LINK_LIBRARY:WHOLE_ARCHIVE,cantus_ops>" cantus)
endif()

if(EMSCRIPTEN)
  include(CantusWasm)
endif()

if(CANTUS_BUILD_CLI AND NOT EMSCRIPTEN)
  add_subdirectory(tools/cli)
endif()

if(CANTUS_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()

if(CANTUS_INSTALL)
  include(CantusInstall)
endif()
