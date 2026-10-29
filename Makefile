TARGET ?= .
install: ; ./install.sh $(ARGS) $(TARGET)
dry:     ; ./install.sh --dry-run $(ARGS) $(TARGET)
detect:  ; ./install.sh --detect-only $(TARGET)
render:  ; ./install.sh --render $(ARGS) $(TARGET)
export:  ; scripts/export.sh $(TARGET) --profile $(or $(PROFILE),$(error defina PROFILE=nome)) $(ARGS)
test:    ; tests/run.sh
dashboard: ; node dashboard/server.mjs --project $(TARGET) $(ARGS)
hub:     ; node dashboard/server.mjs --hub $(HUB) $(ARGS)
.PHONY: install dry detect render export test dashboard hub
