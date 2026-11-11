#!/usr/bin/env bash
# Retain the old entrypoint so historical instructions fail with migration guidance.
printf '%s\n' \
  'bb-test-instance: retired; no command was run.' \
  'Use an existing isolated BB instance through the repository command:' \
  '  bun run bb-target --url <server-url> --data-dir <path> [--daemon-port <port>] [--cli <bb-entry>] -- <bb arguments>' \
  'See docs/dev/verification.md. bb-target verifies the target; it does not start or stop an instance.' >&2
exit 1
