# Pure TS package build that the wasm and node packages take their typings from.

$(PURE_DTS): $(shell find ts/src -name '*.ts') ts/tsup.config.ts ts/package.json
	$(NICE) $(YARN) workspace @libraz/libcantus build
