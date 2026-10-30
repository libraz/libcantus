cantus_add_test(ops test_codec.cpp test_builtins.cpp test_accessors.cpp test_depth.cpp test_wire_decode.cpp)

find_package(Threads REQUIRED)
target_link_libraries(ops PRIVATE Threads::Threads)
