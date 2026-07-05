#!/usr/bin/env bash
#
# analytics-exclude-ip.sh — add IP(s) to the operator-exclusion allowlist without clobbering it.
#
# DAYLIGHT_ANALYTICS_EXCLUDE_IPS is a Fly *secret* (write-only, and deliberately not in fly.toml so
# no home IP ever lands in git). "Adding" therefore means: read the current value off the running
# machine, merge + de-dupe, and re-set it. This script does exactly that. IPs are only ever passed
# as arguments — none are stored in this file or the repo.
#
# An entry is either an exact address (e.g. 203.0.113.7 / 2001:db8::1) or a PREFIX ending in "."
# for an IPv4 block (203.0.113.) or ":" for an IPv6 range (2600:1700:ff8:5ff:). Matching is on the
# raw Fly-Client-IP string, so list an address in the same form it arrives (see
# isExcludedClientIp in packages/core/src/analytics.ts).
#
# Usage:
#   scripts/analytics-exclude-ip.sh 24.211.83.126                 # add one
#   scripts/analytics-exclude-ip.sh 24.211.83.126 2600:1700:abc:  # add several / a prefix
#   scripts/analytics-exclude-ip.sh --me                          # add THIS machine's public v4+v6
#   scripts/analytics-exclude-ip.sh --dry-run 24.211.83.126       # preview, don't set
#
# `fly secrets set` rolls the machine to apply — a brief restart. Workers are idempotent, so an
# interrupted cron re-runs cleanly.
set -euo pipefail

APP="daylight-watchdog"
KEY="DAYLIGHT_ANALYTICS_EXCLUDE_IPS"

dry_run=false
add=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --me)
      v4="$(curl -4 -s --max-time 8 https://api.ipify.org || true)"
      v6="$(curl -6 -s --max-time 8 https://api6.ipify.org || true)"
      [ -n "$v4" ] && add+=("$v4") && echo "detected public IPv4: $v4" >&2
      [ -n "$v6" ] && add+=("$v6") && echo "detected public IPv6: $v6" >&2
      [ -z "$v4$v6" ] && { echo "could not detect a public IP" >&2; exit 1; }
      ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) add+=("$arg") ;;
  esac
done

if [ "${#add[@]}" -eq 0 ]; then
  echo "usage: $0 [--dry-run] [--me] [<ip-or-prefix> ...]" >&2
  exit 2
fi

# Current value. The 'Connecting…' notice goes to stderr; the value is the sole stdout line.
# Empty when the secret is unset (printenv exits non-zero → swallowed).
current="$(fly ssh console -a "$APP" -C "printenv $KEY" 2>/dev/null || true)"
current="$(printf '%s' "$current" | tr -d '\r' | tail -n1)"

# Merge existing + new: split on comma/whitespace, drop blanks, de-dupe preserving first-seen order.
merged="$(printf '%s %s' "$current" "${add[*]}" \
  | tr ', \t' '\n\n\n\n' \
  | awk 'NF && !seen[$0]++' \
  | paste -sd, -)"

echo "current: ${current:-(empty)}"
echo "new    : $merged"

if $dry_run; then
  echo "(dry run — secret not changed)"
  exit 0
fi

fly secrets set -a "$APP" "$KEY=$merged"
echo "done — $KEY updated; machine rolling to apply."
