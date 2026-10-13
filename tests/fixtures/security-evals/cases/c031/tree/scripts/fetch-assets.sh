#!/usr/bin/env bash
set -euo pipefail
aws s3 cp s3://acme-site-assets-prod/logo.svg public/logo.svg --expected-bucket-owner 111122223333
