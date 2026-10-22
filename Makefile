TARGET ?= .
PROFILE ?= plato
install: ; ./install.sh $(ARGS) $(TARGET)
dry:     ; ./install.sh --dry-run $(ARGS) $(TARGET)
detect:  ; ./install.sh --detect-only $(TARGET)
render:  ; ./install.sh --render $(ARGS) $(TARGET)
export:  ; scripts/export.sh $(TARGET) --profile $(PROFILE) $(ARGS)
test:    ; tests/run.sh
dashboard: ; node dashboard/server.mjs --project $(TARGET) $(ARGS)
.PHONY: install dry detect render export test dashboard
