# Pinned toolchain versions read by the build fragments and CI.

# Emscripten SDK for the WebAssembly build.
EMSDK_VERSION := 6.0.3

# LLVM release whose clang-tidy and clang-format the checks are written against. On macOS
# clang-tidy reads that release's own libc++ headers: the SDK's can be newer than it parses.
LLVM_VERSION := 18
# A GCC build's compile commands carry GCC-only warning flags that clang-tidy does not know.
CLANG_TIDY_ARGS += --extra-arg=-Wno-unknown-warning-option
ifeq ($(shell uname -s),Darwin)
LLVM_PREFIX ?= $(shell brew --prefix llvm@$(LLVM_VERSION) 2>/dev/null)
CLANG_TIDY_ARGS += --extra-arg=-nostdinc++ --extra-arg=-isystem$(LLVM_PREFIX)/include/c++/v1
endif
# Recipe line refusing a clang tool of another release: $(call LLVM_CHECK,$(CLANG_FORMAT)).
LLVM_CHECK = @$(1) --version | grep -q 'version $(LLVM_VERSION)\.' || \
  { echo "$(1) is not LLVM $(LLVM_VERSION): $$($(1) --version | head -1)" >&2; exit 1; }
