# The cantus command-line tool: build it and test its contract.

CANTUS_TARGETS += test-cli

CLI_BIN = $(BUILD_DIR)/tools/cli/cantus

# Runs the CLI contract tests and replays the fixed corpus (the CLI's own fixture until
# tests/corpus/fixtures exists).
test-cli: build
	$(PYTHON) tools/cli/tests/test_cli.py $(CLI_BIN)
	$(PYTHON) tools/conformance/replay_cli.py --cli $(CLI_BIN)
