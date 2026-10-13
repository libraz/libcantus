# Node package (bindings/node): the Node-API addon over the C ABI and the facade bundled onto it.
#   make build-node   addon (cmake-js, bindings/node/build/) and dist/ (tsup)
#   make test-node    boundary test with the node backend, then the fixed corpus through replay_js

CANTUS_TARGETS += build-node test-node

NODE_PKG := bindings/node
NODE_BIN = $(CURDIR)/node_modules/.bin
# dist/ copies its declarations from the pure package's build.
NODE_CORPUS_FIXTURES = $(sort $(wildcard tests/corpus/fixtures/*.jsonl))

build-node: $(PURE_DTS)
	cd $(NODE_PKG) && $(NICE) $(NODE_BIN)/cmake-js build --out build --parallel $(JOBS) --log-level warn
	cd $(NODE_PKG) && $(NICE) $(NODE_BIN)/tsup --silent

test-node: build-node
	CANTUS_BOUNDARY_BACKEND=node $(NICE) $(VITEST) run -c bindings/js/vitest.config.ts \
	  --maxWorkers=$(JOBS) boundary.test.ts
	$(NODE) tools/corpus/replay_js.mjs --backend node $(NODE_CORPUS_FIXTURES)
