#!/usr/bin/env bash
# Launches the buyer MCP server from the repo root (Claude may start it from any directory).
cd "$(dirname "$0")/.." && exec node --import tsx examples/buyer-agent/mcp.ts
