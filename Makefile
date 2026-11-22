SHELL := /bin/bash

RUN_ID ?= lokal
GITHUB_REPO ?= specrun-lab/levelboard-$(RUN_ID)
LIVE_DOMAIN ?=
LIVE_URL ?= https://$(RUN_ID).$(LIVE_DOMAIN)
URL ?= http://127.0.0.1:8080
API_URL ?= http://127.0.0.1:8081

ENV = RUN_ID="$(RUN_ID)" GITHUB_REPO="$(GITHUB_REPO)" LIVE_DOMAIN="$(LIVE_DOMAIN)" LIVE_URL="$(LIVE_URL)" URL="$(URL)" API_URL="$(API_URL)"

.PHONY: level1 level2 level3 level4 level5 level6 level7 level8 level9 level10 check down restart-backend stop-backend

level1: down
	@$(ENV) bash scripts/up.sh 1

level2: down
	@$(ENV) bash scripts/up.sh 2

level3: down
	@$(ENV) bash scripts/up.sh 3

level4: down
	@$(ENV) bash scripts/up.sh 4

level5: down
	@$(ENV) bash scripts/up.sh 5

level6: down
	@$(ENV) bash scripts/up.sh 6

level7: down
	@$(ENV) bash scripts/up.sh 7

level8: down
	@$(ENV) bash scripts/up.sh 8

level9: down
	@$(ENV) bash scripts/up.sh 9

level10: down
	@$(ENV) bash scripts/up.sh 10

check:
	@N=$$(if [ -f .run/level ]; then cat .run/level; else echo 10; fi); \
	$(ENV) bash scripts/check.sh "$$N"

restart-backend:
	@bash scripts/restart-backend.sh

stop-backend:
	@bash scripts/stop-backend.sh

down:
	@bash scripts/down.sh
