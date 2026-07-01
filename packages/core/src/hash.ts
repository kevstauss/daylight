import { createHash } from "node:crypto";

/** sha256 hex digest of a UTF-8 string. Idempotency keys are built on this. */
export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
