"use client";

import type { ReactNode } from "react";

/**
 * A submit button that asks for confirmation before it submits. Used for Publish (accept) — the one
 * review action that crosses the human gate and makes a finding PUBLIC on /redtape; Hold and Reject
 * stay private and reversible, so they don't need it. Progressive-enhancement note: without JS the
 * onClick never runs and the button submits normally — the DB-layer human gate still holds, so the
 * confirm is a UX safeguard, not the security boundary. The bound server action passes through as
 * `formAction` (server actions are prop-safe across the client boundary).
 */
export function ConfirmSubmit({
  formAction,
  message,
  className,
  children,
}: {
  formAction: (formData: FormData) => void | Promise<void>;
  message: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      formAction={formAction}
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
