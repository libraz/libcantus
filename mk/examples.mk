# Runnable examples under examples/: each one is built or run against the installed or built
# artifact of its surface and exits non-zero when its output is not the documented one.
#   make examples          every example below
#   make examples-cpp      examples/cpp against an install tree of the C++ core
#   make examples-python   examples/python against the shared library
#   make examples-node     examples/node/node.mjs against the native addon
#   make examples-wasm     examples/node/wasm.mjs against the WebAssembly package

CANTUS_TARGETS += examples examples-cpp examples-python examples-node examples-wasm

EXAMPLES_DIR ?= build-examples
EXAMPLES_PREFIX ?= $(CURDIR)/$(EXAMPLES_DIR)/prefix

examples: examples-cpp examples-python examples-node examples-wasm

# Install the built core into a scratch prefix, then build and run the consumer project on it.
examples-cpp: build
	rm -rf $(EXAMPLES_PREFIX)
	$(CMAKE) --install $(BUILD_DIR) --prefix $(EXAMPLES_PREFIX)
	$(NICE) $(CMAKE) -S examples/cpp -B $(EXAMPLES_DIR)/cpp -DCMAKE_BUILD_TYPE=Release \
	  -DCMAKE_PREFIX_PATH=$(EXAMPLES_PREFIX)
	$(NICE) $(CMAKE) --build $(EXAMPLES_DIR)/cpp -j $(JOBS)
	$(CTEST) --test-dir $(EXAMPLES_DIR)/cpp --no-tests=error --output-on-failure

# The binding finds build-shared/ in a source checkout.
examples-python: build-shared
	PYTHONPATH=bindings/python/src $(PYTHON) examples/python/detect.py

examples-node: build-node
	$(NODE) examples/node/node.mjs

examples-wasm: wasm
	$(NODE) examples/node/wasm.mjs
