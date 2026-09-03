#!/usr/bin/env bash
# Runs the storage benchmark for all three canonical fixtures, each as its
# own fresh Node process (see bench/storage-benchmark.ts's doc comment for
# why: cross-fixture RSS contamination in a single shared process).
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="postgresql://datalize:datalize@localhost:5433/datalize"
export ANALYTICAL_DATABASE_URL="postgresql://datalize:datalize@localhost:5433/datalize"
export BETTER_AUTH_SECRET="bench-secret-that-is-at-least-32-characters-long"
export BETTER_AUTH_URL="http://localhost:3000"
export NODE_ENV="development"

EXTRA_ARGS="${1:-}"

if [ "$EXTRA_ARGS" != "--small" ]; then
  if [ ! -f tests/fixtures/generated/transactions_stripe_large.csv ]; then
    echo "Generating the 1,000,000-row fixtures (npx tsx scripts/fixtures/generate.ts --large)..."
    npx tsx scripts/fixtures/generate.ts --large
  fi
  echo "Trimming each to the 50 MiB byte ceiling (bench/trim-to-ceiling.mjs)..."
  node bench/trim-to-ceiling.mjs
fi

for fixture in transactions_stripe customers_saaS events_product; do
  echo "############################################################"
  echo "# $fixture"
  echo "############################################################"
  npx tsx --expose-gc bench/storage-benchmark.ts --fixture="$fixture" $EXTRA_ARGS
done
