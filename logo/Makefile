CC ?= cc
CFLAGS ?= -O2 -Wall -Wextra -std=c11

all: tube-slide-red tube-slide-combo tube-slide-portable

tube-slide-red: tube_slide_red.c
	$(CC) $(CFLAGS) -o $@ $< -lm

tube-slide-combo: tube_slide_combo.c
	$(CC) $(CFLAGS) -o $@ $< -lm

tube-slide-portable: tube_slide_portable.c
	$(CC) $(CFLAGS) -o $@ $< -lm

clean:
	rm -f tube-slide-red tube-slide-combo tube-slide-portable

.PHONY: all clean
