# WebAssembly surface: build the emscripten module and bindings/wasm/dist (wasm), then run the
# boundary test, the package checks and the fixed corpus through it (test-wasm).

CANTUS_TARGETS += wasm test-wasm

WASM_BUILD_DIR ?= build-wasm
EMCMAKE ?= emcmake
EMCC ?= emcc
VITEST ?= node_modules/.bin/vitest
# emscripten's launcher takes the first python3 on PATH, which may be a shim or one too old;
# hand it the interpreter python3 resolves to. emsdk sets this itself.
export EMSDK_PYTHON ?= $(shell $(PYTHON) -c 'import sys; print(sys.executable)')

WASM_DIST = bindings/wasm/dist
WASM_FIXTURES = $(sort $(wildcard tests/corpus/fixtures/*.jsonl))

# The copied declarations are pure TS's build output. bindings/node/node.mk needs the same rule;
# whichever fragment is read first defines it.
wasm: $(PURE_DTS)
	$(call EMSDK_CHECK,$(EMCC))
	$(NICE) $(EMCMAKE) $(CMAKE) -S . -B $(WASM_BUILD_DIR) -DCMAKE_BUILD_TYPE=Release \
	  -DCANTUS_BUILD_TESTS=OFF -DCANTUS_BUILD_CLI=OFF
	$(NICE) $(CMAKE) --build $(WASM_BUILD_DIR) --target cantus_wasm -j $(JOBS)
	$(NODE) bindings/wasm/build.mjs --wasm-dir $(WASM_BUILD_DIR)
	@printf 'cantus.wasm: %s bytes, %s bytes gzip -9\n' \
	  "$$(wc -c < $(WASM_DIST)/cantus.wasm | tr -d ' ')" \
	  "$$(gzip -9c $(WASM_DIST)/cantus.wasm | wc -c | tr -d ' ')"

test-wasm: wasm
	CANTUS_BOUNDARY_BACKEND=wasm $(NICE) $(VITEST) run -c bindings/js/vitest.config.ts \
	  --maxWorkers=$(JOBS) test/boundary.test.ts test/wasm-package.test.ts
	$(NODE) tools/corpus/replay_js.mjs --backend wasm $(WASM_FIXTURES)
