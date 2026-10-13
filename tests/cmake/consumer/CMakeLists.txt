cmake_minimum_required(VERSION 3.24)
project(cantus_find_package_consumer LANGUAGES C CXX)

# An outside project using the installed package through find_package(cantus). Driven by
# `make test-install`, which installs into a scratch prefix and points CMAKE_PREFIX_PATH at it.

find_package(cantus REQUIRED)
find_package(Python3 REQUIRED COMPONENTS Interpreter)

enable_testing()

# The typed C++ API alone; its link line must not name cantus_ops.
add_executable(consumer main.cpp)
target_link_libraries(consumer PRIVATE cantus::cantus)
add_test(NAME consumer COMMAND consumer)
add_test(NAME consumer_link_line
         COMMAND ${CMAKE_COMMAND} -DBUILD_DIR=${CMAKE_CURRENT_BINARY_DIR} -DTARGET=consumer
                 -P ${CMAKE_CURRENT_SOURCE_DIR}/../check_link_line.cmake)

# The C ABI from C, through cantus::ops.
add_executable(consumer_c consumer_c.c)
target_link_libraries(consumer_c PRIVATE cantus::ops)
add_test(NAME consumer_c COMMAND consumer_c)

# Link closure: every member of each archive is linked in whole, so a symbol missing from a
# target's link interface is a link error here rather than in whichever consumer reaches it first.
# link_closure_<lib>.cpp is generated from the archive's member list at build time.
foreach(_lib IN ITEMS cantus ops)
  set(_src ${CMAKE_CURRENT_BINARY_DIR}/link_closure_${_lib}.cpp)
  add_custom_command(
    OUTPUT ${_src}
    COMMAND Python3::Interpreter ${CMAKE_CURRENT_SOURCE_DIR}/../gen_link_closure.py
            --archive $<TARGET_FILE:cantus::${_lib}> --ar ${CMAKE_AR} --out ${_src}
    DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/../gen_link_closure.py $<TARGET_FILE:cantus::${_lib}>
    VERBATIM)
  add_executable(link_closure_${_lib} ${_src})
  target_link_libraries(link_closure_${_lib} PRIVATE "$<LINK_LIBRARY:WHOLE_ARCHIVE,cantus::${_lib}>")
  add_test(NAME link_closure_${_lib} COMMAND link_closure_${_lib})
endforeach()
