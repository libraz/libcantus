# Call corpus: record it from the pure TS backend (corpus), replay a unit's recorded calls through
# the C ABI (corpus-check), and run the spec files whose ops are all registered (spec-ready).
#   make corpus-check UNIT=<id>|all     ops of the unit per api/units.json
#   make spec-ready IMPL=node|wasm|...  CANTUS_IMPL of the run; UNIT=<id> also checks the unit's files

CANTUS_TARGETS += corpus corpus-check spec-ready

UNIT ?=
IMPL ?= node
YARN ?= yarn
VITEST ?= node_modules/.bin/vitest

# The surface build a spec-ready run needs, once the fragment defining it exists.
SPEC_READY_BUILD = $(filter $(if $(filter node,$(IMPL)),build-node)$(if $(filter wasm,$(IMPL)),wasm),$(CANTUS_TARGETS))

corpus:
	$(YARN) corpus

corpus-check: build
	@test -n "$(UNIT)" || { echo "corpus-check: set UNIT=<id> (api/units.json) or UNIT=all" >&2; exit 2; }
	$(NODE) tools/corpus/check.mjs --unit $(UNIT) --build-dir $(BUILD_DIR)

spec-ready: build $$(SPEC_READY_BUILD)
	files="$$($(NODE) tools/corpus/select.mjs --build-dir $(BUILD_DIR) $(if $(UNIT),--unit $(UNIT)))" && \
	  CANTUS_IMPL=$(IMPL) $(NICE) $(VITEST) run -c tests/spec/vitest.config.ts \
	    --maxWorkers=$(JOBS) $$files
