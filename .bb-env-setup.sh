#!/usr/bin/env bash
set -euo pipefail

# .worktreeinclude cannot copy nested Git repositories. Reuse local clones.
bun run repos clone

# Record whether BB and the SDK pin are current in the provisioning transcript.
# Findings must never fail worktree creation.
bun run preflight || true
