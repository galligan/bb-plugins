#!/usr/bin/env bash
set -euo pipefail

# .worktreeinclude cannot copy nested Git repositories. Reuse local clones.
bun run repos clone

# Refresh upstream documentation for skills and plugin development.
bun run docs:bb
