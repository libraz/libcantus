# Shared variables only. Targets live in the fragments: mk/*.mk for the core, bindings/*/*.mk and
# tools/cli/*.mk for each surface. A fragment lists its targets in CANTUS_TARGETS; `format`,
# `format-check` and `lint` collect the format-<area>, format-check-<area> and lint-<area> ones.

CMAKE ?= cmake
CTEST ?= ctest
PYTHON ?= python3
NODE ?= node
YARN ?= yarn
CLANG_FORMAT ?= clang-format
CLANG_TIDY ?= clang-tidy

# The machine is shared: two compile jobs, at lower priority, unless asked otherwise.
JOBS ?= 2
NICE ?= nice -n 10
export CMAKE_BUILD_PARALLEL_LEVEL ?= $(JOBS)
export CTEST_PARALLEL_LEVEL ?= $(JOBS)

BUILD_DIR ?= build
BUILD_TYPE ?= Debug
RELEASE_DIR ?= build-release
INSTALL_BUILD_DIR ?= build-install

CANTUS_TARGETS :=

# Pure TS typings that the wasm and node packages copy; the rule is in mk/ts.mk.
PURE_DTS := ts/dist/index.d.ts

.DEFAULT_GOAL := build
.SECONDEXPANSION:

-include $(sort $(wildcard mk/*.mk bindings/*/*.mk tools/cli/*.mk))

.PHONY: $(CANTUS_TARGETS)
