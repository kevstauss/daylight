import { flag } from "@daylight/core";

/** Feature flags that gate unfinished surfaces (PRD §4.3). Read server-side from env. */
export interface Flags {
  /** 1a — /registry search + /domain/{name} owner pages. */
  registry: boolean;
  /** 1b — /ledger/feed.* + change emission. */
  feed: boolean;
  /** 1c — H1–H4 heuristics + person/org watches + severity routing. */
  heuristics: boolean;
}

export function flags(): Flags {
  return {
    registry: flag("FLAG_LEDGER_REGISTRY"),
    feed: flag("FLAG_LEDGER_FEED"),
    heuristics: flag("FLAG_LEDGER_HEURISTICS"),
  };
}
