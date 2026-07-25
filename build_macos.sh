#!/usr/bin/env bash
# Compatibility wrapper for the canonical EnergyRadar build.
set -euo pipefail

cd "$(dirname "$0")"
python3 tools/build.py
