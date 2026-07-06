#!/bin/bash
exec env -u ANTHROPIC_BASE_URL -u CLAUDE_CODE_SUBAGENT_MODEL /home/trinity/.local/bin/claude --dangerously-skip-permissions --remote-control
