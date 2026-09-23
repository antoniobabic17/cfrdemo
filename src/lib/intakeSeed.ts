/**
 * intakeSeed — one-shot, in-memory handoff for pre-filling the project intake
 * wizard WITHOUT pre-creating a pmo_projectrequest row.
 *
 * Callers (Create Project from a Payer Inquiry; the assigned-team action on a
 * cross-team request) set a seed, then navigate to `/intake/new?seed=1`. The
 * wizard reads the seed ONCE on mount (take* clears it) and pre-populates its
 * form values + target team, so all of the wizard's own team-driven rules
 * (required fields, visibility, Payer Initiatives default program, conversion)
 * run exactly as a normal fresh intake — no bespoke parallel flow, no orphan
 * draft rows if the user cancels.
 *
 * In-memory (module singleton) is deliberate: the seed must NOT survive a hard
 * refresh or a shared link — it's a transient navigation handoff only.
 */
export interface IntakeSeed {
  /** Team GUID to apply as the intake's Primary/Target team. Applied through the
   *  wizard's own team-change handler so team-driven prefills (e.g. the PI default
   *  program) fire as if the user picked it. */
  targetTeamId?: string;
  /** Direct wizard form values to seed, keyed by the wizard's field keys
   *  (e.g. pmo_name, pmo_description, pmo_businessjustification). */
  values?: Record<string, unknown>;
  /** Payer Initiatives payer-inquiry ids to pre-attach (extras.payerIssueIds). */
  payerIssueIds?: string[];
}

let pending: IntakeSeed | null = null;

/** Stash a seed for the next wizard mount. Overwrites any prior unconsumed seed. */
export function setIntakeSeed(seed: IntakeSeed): void {
  pending = seed;
}

/** Consume the pending seed (returns it and clears it). Returns null if none. */
export function takeIntakeSeed(): IntakeSeed | null {
  const s = pending;
  pending = null;
  return s;
}
