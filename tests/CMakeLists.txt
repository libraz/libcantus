# Catch2 tests of the C++-specific foundation: js helpers and JSON (js/), the C ABI (api/), the
# op layer (ops/), the corpus replay (corpus/), and optional per-module tests of the typed API
# (tests/<layer>/<module>/, picked up when they have a CMakeLists.txt).

include(FetchContent)
FetchContent_Declare(
  Catch2
  URL https://github.com/catchorg/Catch2/archive/refs/tags/v3.7.1.tar.gz
  URL_HASH SHA256=c991b247a1a0d7bb9c39aa35faf0fe9e19764213f28ffba3109388e62ee0269c
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(Catch2)
list(APPEND CMAKE_MODULE_PATH ${catch2_SOURCE_DIR}/extras)
include(Catch)

# cantus_add_test(<name> <sources>...): a Catch2 executable over cantus::ops (which includes
# cantus::cantus), with src/ on the include path; its tests are registered as "<name>.*".
function(cantus_add_test name)
  add_executable(${name} ${ARGN})
  target_link_libraries(${name} PRIVATE cantus_ops Catch2::Catch2WithMain)
  target_include_directories(${name} PRIVATE ${PROJECT_SOURCE_DIR}/src)
  target_compile_options(${name} PRIVATE ${CANTUS_WARNINGS})
  catch_discover_tests(${name} TEST_PREFIX "${name}.")
endfunction()

add_subdirectory(js)
add_subdirectory(api)
add_subdirectory(ops)
add_subdirectory(corpus)

foreach(_cantus_dir IN LISTS CANTUS_MODULE_DIRS)
  if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/${_cantus_dir}/CMakeLists.txt)
    add_subdirectory(${_cantus_dir})
  endif()
endforeach()
