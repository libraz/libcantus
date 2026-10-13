cmake_minimum_required(VERSION 3.24)
project(cantus_subdir_consumer LANGUAGES CXX)

# An outside project pulling the source tree in with add_subdirectory(), as FetchContent does.
# The targets keep the names they have when installed.

add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../.. cantus)

enable_testing()
add_executable(subdir_consumer main.cpp)
target_link_libraries(subdir_consumer PRIVATE cantus::cantus)
add_test(NAME subdir_consumer COMMAND subdir_consumer)
