import { flag } from "@daylight/core";

/** Feature flags that gate unfinished surfaces (PRD §4.3). Read server-side from env. */
export interface Flags {
  /** 1a — /registry search + /domain/{name} owner pages. */
  registry: boolean;
  /** 1b — /ledger/feed.* + change emission. */
  feed: boolean;
  /** 1c — H1–H4 heuristics + person/org watches + severity routing. */
  heuristics: boolean;
  /** Phase 2 — /lookout subdomain feed + cert timelines. */
  lookout: boolean;
  /** Phase 3 — /floodlight tracker scorecards + hall of shame. */
  floodlight: boolean;
  /** Phase 3a — the live "scan this URL" box (needs a browser + ~1GB RAM). */
  floodlightScan: boolean;
  /** Phase 4 — /receipts removal ledger + snapshot history. */
  receipts: boolean;
  /** Phase 5 — /redtape human-reviewed PIA/SORN gap list. */
  redtape: boolean;
  /** Phase 6 — /foundry vendor build-graph (CT×registry join). */
  foundry: boolean;
  /** Site Scanning breadth net — GSA daily scan ingest that promotes candidates into Floodlight.
   *  Not a module/tile; this flag gates the scheduled ingest + its /status row. */
  siteScanning: boolean;
  /** Federal GitHub org monitoring — new repos / first commits surface as Lookout events. Not a
   *  module/tile; this flag gates the scheduled poll + its 'github' /status row. */
  github: boolean;
}

export function flags(): Flags {
  return {
    registry: flag("FLAG_LEDGER_REGISTRY"),
    feed: flag("FLAG_LEDGER_FEED"),
    heuristics: flag("FLAG_LEDGER_HEURISTICS"),
    lookout: flag("FLAG_LOOKOUT"),
    floodlight: flag("FLAG_FLOODLIGHT"),
    floodlightScan: flag("FLAG_FLOODLIGHT_SCAN"),
    receipts: flag("FLAG_RECEIPTS"),
    redtape: flag("FLAG_REDTAPE"),
    foundry: flag("FLAG_FOUNDRY"),
    siteScanning: flag("FLAG_SITESCANNING"),
    github: flag("FLAG_GITHUB"),
  };
}
