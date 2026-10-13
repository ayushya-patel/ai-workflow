#!/usr/bin/env bash
set -euo pipefail
aws s3 cp s3://acme-legacy-tools/agent/install.sh - | bash
