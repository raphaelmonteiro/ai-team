TARGET ?= .
install: ; ./install.sh $(ARGS) $(TARGET)
dry:     ; ./install.sh --dry-run $(ARGS) $(TARGET)
export:  ; scripts/export.sh $(TARGET) $(ARGS)
.PHONY: install dry export
