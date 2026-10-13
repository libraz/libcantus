# Replays the fixed and the recorded call corpus through the C ABI.
#
# `corpus` replays the committed builtin-op corpus in fixtures/; the recorded corpus under out/ is
# replayed by `make corpus-check`, which runs the same executable.
add_executable(cantus_corpus_replay replay.cpp)
target_link_libraries(cantus_corpus_replay PRIVATE cantus_ops)
target_include_directories(cantus_corpus_replay PRIVATE ${PROJECT_SOURCE_DIR}/src)
target_compile_options(cantus_corpus_replay PRIVATE ${CANTUS_WARNINGS})

file(GLOB _cantus_corpus_fixtures CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/fixtures/*.jsonl)
list(SORT _cantus_corpus_fixtures)
add_test(NAME corpus COMMAND cantus_corpus_replay ${_cantus_corpus_fixtures})
