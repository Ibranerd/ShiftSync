#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_FILE=""
if [ -f "${PROJECT_ROOT}/.env.local" ]; then
  ENV_FILE="${PROJECT_ROOT}/.env.local"
elif [ -f "${PROJECT_ROOT}/.env" ]; then
  ENV_FILE="${PROJECT_ROOT}/.env"
elif [ -f "${PROJECT_ROOT}/.env copy.local" ]; then
  ENV_FILE="${PROJECT_ROOT}/.env copy.local"
fi

if [ -n "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [ -z "${SUPABASE_URL:-}" ] && [ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ]; then
  export SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL}"
fi

missing=()
if [ -z "${SUPABASE_URL:-}" ]; then
  missing+=("SUPABASE_URL")
fi
if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && [ -n "${NEXT_SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  export SUPABASE_SERVICE_ROLE_KEY="${NEXT_SUPABASE_SERVICE_ROLE_KEY}"
fi

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  missing+=("SUPABASE_SERVICE_ROLE_KEY")
fi

if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing ${missing[*]} in environment."
  echo "Set them in ${ENV_FILE:-.env.local} before running this script."
  exit 1
fi

node "${PROJECT_ROOT}/db/seed.ts"
