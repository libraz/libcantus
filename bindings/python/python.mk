# Python binding: the shared library it loads, and its tests and checks.

CANTUS_TARGETS += build-shared test-python format-python format-check-python lint-python

SHARED_DIR ?= build-shared
SHARED_BUILD_TYPE ?= Release
PY_DIR = bindings/python
PY_VENV = $(PY_DIR)/.venv
PY_BIN = $(CURDIR)/$(PY_VENV)/bin
PY_STAMP = $(PY_VENV)/.synced
RYE ?= rye

# libcantus.{so,dylib} (cantus_shared) in its own tree, which the binding finds without help.
build-shared:
	$(NICE) $(CMAKE) -S . -B $(SHARED_DIR) -DCMAKE_BUILD_TYPE=$(SHARED_BUILD_TYPE) \
	  -DCANTUS_BUILD_SHARED=ON -DCANTUS_BUILD_TESTS=OFF -DCANTUS_BUILD_CLI=OFF
	$(NICE) $(CMAKE) --build $(SHARED_DIR) --target cantus_shared -j $(JOBS)

# The environment with pytest, ruff and mypy: rye when installed, else venv + pip.
$(PY_STAMP): $(PY_DIR)/pyproject.toml
	if command -v $(RYE) >/dev/null 2>&1; then \
	  (cd $(PY_DIR) && $(RYE) sync --quiet); \
	else \
	  $(PYTHON) -m venv $(PY_VENV) && \
	  $(PY_BIN)/python -m pip install --quiet -e $(PY_DIR) pytest ruff mypy; \
	fi
	touch $(PY_STAMP)

# The generated modules, the boundary tests, and the fixed corpus replayed through ctypes.
test-python: build-shared $(PY_STAMP)
	$(NODE) tools/api/gen_python.mjs --check
	cd $(PY_DIR) && $(PY_BIN)/python -m pytest -q

format-python: $(PY_STAMP)
	cd $(PY_DIR) && $(PY_BIN)/ruff check --fix . && $(PY_BIN)/ruff format .

format-check-python: $(PY_STAMP)
	cd $(PY_DIR) && $(PY_BIN)/ruff format --check .

lint-python: $(PY_STAMP)
	cd $(PY_DIR) && $(PY_BIN)/ruff check . && $(PY_BIN)/mypy
