# C++ core: build, tests, install check, fast conformance gates, and the C++ part of
# format / format-check / lint.

CANTUS_TARGETS += build release test-cxx test-install conformance-fast \
                  format format-check lint format-cxx format-check-cxx lint-cxx

INSTALL_PREFIX ?= $(CURDIR)/$(INSTALL_BUILD_DIR)/prefix

# The oldest macOS every shipped binary runs on: the first whose libc++ has floating-point
# std::from_chars. A wheel tag never claims an older one.
MACOS_DEPLOYMENT_TARGET ?= 26.0

# Tracked and new C/C++ sources, minus generated files and test fixtures.
CXX_SOURCES = git ls-files -z --cached --others --exclude-standard -- \
  '*.h' '*.cpp' '*.c' ':!:**/*.gen.*' ':!:tools/data/fixtures/**'

build:
	$(NICE) $(CMAKE) -S . -B $(BUILD_DIR) -DCMAKE_BUILD_TYPE=$(BUILD_TYPE)
	$(NICE) $(CMAKE) --build $(BUILD_DIR) -j $(JOBS)

release:
	$(NICE) $(CMAKE) -S . -B $(RELEASE_DIR) -DCMAKE_BUILD_TYPE=Release \
	  -DCMAKE_OSX_DEPLOYMENT_TARGET=$(MACOS_DEPLOYMENT_TARGET)
	$(NICE) $(CMAKE) --build $(RELEASE_DIR) -j $(JOBS)

test-cxx: build
	$(NICE) $(CTEST) --test-dir $(BUILD_DIR) --no-tests=error --output-on-failure -j $(JOBS)

# Install into a scratch prefix, then build and run an outside find_package() project against it,
# and an add_subdirectory() project against the source tree.
test-install:
	rm -rf $(INSTALL_PREFIX)
	$(NICE) $(CMAKE) -S . -B $(INSTALL_BUILD_DIR) -DCMAKE_BUILD_TYPE=Release \
	  -DCANTUS_BUILD_TESTS=OFF -DCANTUS_BUILD_CLI=OFF -DCANTUS_BUILD_SHARED=ON \
	  -DCMAKE_INSTALL_PREFIX=$(INSTALL_PREFIX)
	$(NICE) $(CMAKE) --build $(INSTALL_BUILD_DIR) -j $(JOBS)
	$(CMAKE) --install $(INSTALL_BUILD_DIR)
	$(NICE) $(CMAKE) -S tests/cmake/consumer -B $(INSTALL_BUILD_DIR)/consumer \
	  -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH=$(INSTALL_PREFIX)
	$(NICE) $(CMAKE) --build $(INSTALL_BUILD_DIR)/consumer -j $(JOBS)
	$(CTEST) --test-dir $(INSTALL_BUILD_DIR)/consumer --no-tests=error --output-on-failure
	$(NICE) $(CMAKE) -S tests/cmake/subdir -B $(INSTALL_BUILD_DIR)/subdir -DCMAKE_BUILD_TYPE=Release
	$(NICE) $(CMAKE) --build $(INSTALL_BUILD_DIR)/subdir -j $(JOBS)
	$(CTEST) --test-dir $(INSTALL_BUILD_DIR)/subdir --no-tests=error --output-on-failure

# check_banned reads $(BUILD_DIR)/compile_commands.json, so the tree is configured first.
conformance-fast:
	$(NICE) $(CMAKE) -S . -B $(BUILD_DIR) -DCMAKE_BUILD_TYPE=$(BUILD_TYPE)
	$(PYTHON) tools/conformance/check_public_headers.py
	$(PYTHON) tools/conformance/check_banned.py --compile-commands $(BUILD_DIR)/compile_commands.json
	$(NODE) tools/data/gen_tables.mjs --check $(GEN_TABLES_FLAGS)
	$(MAKE) test-install

format-cxx:
	$(call LLVM_CHECK,$(CLANG_FORMAT))
	$(CXX_SOURCES) | xargs -0 $(CLANG_FORMAT) -i

format-check-cxx:
	$(call LLVM_CHECK,$(CLANG_FORMAT))
	$(CXX_SOURCES) | xargs -0 $(CLANG_FORMAT) --dry-run --Werror

lint-cxx:
	$(call LLVM_CHECK,$(CLANG_TIDY))
	$(NICE) $(CMAKE) -S . -B $(BUILD_DIR) -DCMAKE_BUILD_TYPE=$(BUILD_TYPE)
	git ls-files -z --cached --others --exclude-standard -- 'src/*.cpp' | \
	  xargs -0 $(NICE) $(CLANG_TIDY) -p $(BUILD_DIR) --quiet $(CLANG_TIDY_ARGS)

# The single auto-fix entry: every format-<area> of every fragment, then lint.
format: $$(filter-out format-check%,$$(filter format-%,$$(CANTUS_TARGETS)))
	$(MAKE) lint

format-check: $$(filter format-check-%,$$(CANTUS_TARGETS))

lint: $$(filter lint-%,$$(CANTUS_TARGETS))
