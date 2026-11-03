# Cross-surface gates: API parity (parity), every check CI runs, in one local command (ci-local),
# and the pre-tag checks of what a release publishes (release-check).
#   make parity         generated artifacts up to date, file map, member-level API parity
#   make ci-local       format, lint, every build and test of every surface, corpus, spec counts
#   make release-check  versions, CHANGELOG, package contents, wasm size budget

CANTUS_TARGETS += parity ci-local release-check

# The corpus stays as recorded while ts/src, bindings/js and tests/spec are unchanged.
CORPUS_FRESH = $(NODE) --input-type=module \
  -e "import('./tools/corpus/lib.mjs').then((m) => m.requireFreshCorpus('ci-local'))"
SPEC_COUNT = $(NODE) tools/spec/count.mjs --max-workers $(JOBS)

parity: build
	$(NODE) tools/api/extract_manifest.mjs --check
	$(NODE) tools/api/gen_facade.mjs --check
	$(NODE) tools/api/gen_python.mjs --check
	$(NODE) tools/conformance/check_file_map.mjs
	$(NODE) tools/parity/check.mjs --cli $(CLI_BIN)

# One step at a time, cheapest first, so the first failure stops the run. The package builds come
# from their own targets; nothing here configures a tree of its own.
ci-local:
	$(MAKE) format-check
	$(MAKE) lint
	$(YARN) lint
	$(YARN) workspace @libraz/libcantus typecheck
	$(NICE) $(YARN) workspace @libraz/libcantus test --maxWorkers=$(JOBS)
	$(YARN) workspace @libraz/libcantus docs
	$(PYTHON) tools/release/check_versions.py
	$(PYTHON) tools/conformance/check_error_tables.py
	$(SPEC_COUNT)
	$(MAKE) test-cxx
	$(MAKE) test-cxx BUILD_DIR=$(RELEASE_DIR) BUILD_TYPE=Release
	$(MAKE) conformance-fast
	$(MAKE) parity
	$(CORPUS_FRESH) 2>/dev/null || $(MAKE) corpus
	$(MAKE) corpus-check UNIT=all
	$(MAKE) corpus-check UNIT=all BUILD_DIR=$(RELEASE_DIR) BUILD_TYPE=Release
	$(NODE) tools/corpus/coverage.mjs
	$(NODE) tools/conformance/check_shapes.mjs
	$(MAKE) test-cli
	$(MAKE) test-python
	$(MAKE) test-node
	$(MAKE) test-wasm
	$(PYTHON) tools/conformance/check_wasm_flags.py --compile-commands $(WASM_BUILD_DIR)/compile_commands.json
	$(NODE) tools/release/check_wasm_size.mjs
	$(SPEC_COUNT) --compare facade-ts
	$(SPEC_COUNT) --compare node
	$(SPEC_COUNT) --compare wasm
	$(if $(filter examples,$(CANTUS_TARGETS)),$(MAKE) examples)

release-check: parity wasm $(PURE_DTS)
	$(PYTHON) tools/release/check_versions.py
	$(NODE) tools/release/check_wasm_size.mjs
	$(NODE) tools/release/check_release.mjs
