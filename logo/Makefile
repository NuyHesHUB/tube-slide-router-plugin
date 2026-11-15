CC ?= cc
CFLAGS ?= -O2 -Wall -Wextra -std=c11

all: tube-slide-red tube-slide-combo

tube-slide-red: tube_slide_red.c
	$(CC) $(CFLAGS) -o $@ $< -lm

tube-slide-combo: tube_slide_combo.c
	$(CC) $(CFLAGS) -o $@ $< -lm

clean:
	rm -f tube-slide-red tube-slide-combo

.PHONY: all clean
