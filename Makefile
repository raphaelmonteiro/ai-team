TARGET ?= .
install: ; ./install.sh $(ARGS) $(TARGET)
dry:     ; ./install.sh --dry-run $(ARGS) $(TARGET)
detect:  ; ./install.sh --detect-only $(TARGET)
render:  ; ./install.sh --render $(ARGS) $(TARGET)
export:  ; scripts/export.sh $(TARGET) --profile $(or $(PROFILE),$(error set PROFILE=name)) $(ARGS)
test:    ; tests/run.sh
# one node test file with the runner's guards (never the machine's notify/token/hub config): make test-node T=board
test-node: ; @d=$$(mktemp -d); AI_TEAM_NOTIFY_FILE=$$d/notify.json AI_TEAM_TOKEN_FILE=$$d/token AI_TEAM_HUB=$$d/hub.json node tests/$(or $(T),$(error set T=<name> for tests/<name>.test.mjs)).test.mjs
dashboard: ; node dashboard/server.mjs --project $(TARGET) $(ARGS)
hub:     ; node dashboard/server.mjs --hub $(HUB) $(ARGS)
bench:   ; node scripts/bench-collect.mjs $(ARGS)
.PHONY: install dry detect render export test test-node dashboard hub bench
