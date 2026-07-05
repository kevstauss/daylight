// Computed health per module — distinguishes a healthy worker from a silently-dead one (a stopped
// scheduler otherwise shows "ok" forever) and from a module that is deferred-by-design (flag off).

import { statusRows } from "./data";
import { flags, type Flags } from "./flags";

const CADENCE: Record<string, { maxHours: number; expected: string; flag: keyof Flags }> = {
  ledger: { maxHours: 36, expected: "daily", flag: "registry" },
  lookout: { maxHours: 40, expected: "nightly", flag: "lookout" },
  floodlight: { maxHours: 24 * 8, expected: "weekly (Mon)", flag: "floodlight" },
  // Receipts & Redtape both run Mon+Thu (2x/week). Max normal gap is the Thu→Mon stretch (~4 days),
  // so 5 days is overdue — tight enough that a dead scheduler surfaces within days, not weeks.
  receipts: { maxHours: 24 * 5, expected: "twice weekly (Mon & Thu)", flag: "receipts" },
  redtape: { maxHours: 24 * 5, expected: "twice weekly (Mon & Thu)", flag: "redtape" },
  foundry: { maxHours: 36, expected: "daily", flag: "foundry" },
};

export type ModuleState = "ok" | "overdue" | "error" | "running" | "not-scanned" | "deferred";

export interface ModuleStatus {
  module: string;
  configured: boolean; // its feature flag is on
  state: ModuleState;
  lastRun: string | null;
  ageHours: number | null;
  expected: string;
  itemsSeen: number | null;
  changesEmitted: number | null;
  error: string | null;
}

export function statusReport(now: Date = new Date()): ModuleStatus[] {
  const rows = statusRows();
  const byModule = new Map(rows.map((r) => [r.module, r]));
  const f = flags();
  return Object.entries(CADENCE).map(([module, cfg]) => {
    const r = byModule.get(module);
    const configured = !!f[cfg.flag];
    const lastRun = r?.finished_at ?? r?.started_at ?? null;
    const ageHours = lastRun ? (now.getTime() - new Date(lastRun).getTime()) / 3.6e6 : null;
    let state: ModuleState;
    if (!configured) state = "deferred";
    else if (!r) state = "not-scanned";
    else if (r.finished_at === null) state = "running";
    else if (r.ok !== 1) state = "error";
    else if (ageHours !== null && ageHours > cfg.maxHours) state = "overdue";
    else state = "ok";
    return {
      module,
      configured,
      state,
      lastRun,
      ageHours,
      expected: cfg.expected,
      itemsSeen: r?.items_seen ?? null,
      changesEmitted: r?.changes_emitted ?? null,
      error: r?.error ?? null,
    };
  });
}

/** True when any configured module is overdue or errored — the "watchdog is unhealthy" signal. */
export function anyUnhealthy(report: ModuleStatus[]): boolean {
  return report.some((m) => m.state === "overdue" || m.state === "error");
}
