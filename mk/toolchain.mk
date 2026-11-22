# Pinned toolchain versions read by the build fragments and CI.

# Emscripten SDK for the WebAssembly build.
EMSDK_VERSION := 7.0.1
# Recipe line refusing an emcc of another release, whose module differs from the shipped one even
# when it builds: $(call EMSDK_CHECK,$(EMCC)).
EMSDK_CHECK = @$(1) --version | head -1 | grep -qF ') $(EMSDK_VERSION) (' || \
  { echo "$(1) is not emscripten $(EMSDK_VERSION): $$($(1) --version | head -1)" >&2; exit 1; }

# LLVM release whose clang-tidy and clang-format the checks are written against. On macOS
# clang-tidy reads that release's own libc++ headers: the SDK's can be newer than it parses.
LLVM_VERSION := 23
# A GCC build's compile commands carry GCC-only warning flags that clang-tidy does not know.
CLANG_TIDY_ARGS += --extra-arg=-Wno-unknown-warning-option
ifeq ($(shell uname -s),Darwin)
LLVM_PREFIX ?= $(shell brew --prefix llvm@$(LLVM_VERSION) 2>/dev/null)
CLANG_TIDY_ARGS += --extra-arg=-nostdinc++ --extra-arg=-isystem$(LLVM_PREFIX)/include/c++/v1
# Homebrew keeps the release keg-only, so its tools are taken from the keg rather than PATH.
ifneq ($(LLVM_PREFIX),)
CLANG_FORMAT ?= $(LLVM_PREFIX)/bin/clang-format
CLANG_TIDY ?= $(LLVM_PREFIX)/bin/clang-tidy
endif
endif
CLANG_FORMAT ?= clang-format
CLANG_TIDY ?= clang-tidy
# Recipe line refusing a clang tool of another release: $(call LLVM_CHECK,$(CLANG_FORMAT)).
LLVM_CHECK = @$(1) --version | grep -q 'version $(LLVM_VERSION)\.' || \
  { echo "$(1) is not LLVM $(LLVM_VERSION): $$($(1) --version | head -1)" >&2; exit 1; }
