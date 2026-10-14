cmake_minimum_required(VERSION 3.24)
project(cantus_examples LANGUAGES C CXX)

# Consumer of an installed libcantus: pass -DCMAKE_PREFIX_PATH=<install prefix>.
find_package(cantus REQUIRED)

enable_testing()

# The typed C++ API.
add_executable(typed typed.cpp)
target_link_libraries(typed PRIVATE cantus::cantus)
add_test(NAME typed COMMAND typed)

# The JSON op layer, for hosts that exchange JSON.
add_executable(ops ops.cpp)
target_link_libraries(ops PRIVATE cantus::ops)
add_test(NAME ops COMMAND ops)
