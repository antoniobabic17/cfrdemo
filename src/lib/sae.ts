/**
 * Strategic Account Executive (Payer Initiatives team feature) — direct AAD
 * identity helpers.
 *
 * SAE is stored on the project as a snapshot of an Entra (AAD) identity across
 * three columns, NOT as a systemuser lookup:
 *
 *   pmo_payerinitiatives_saeaadobjectid   Entra object id (GUID) — stable key
 *   pmo_payerinitiatives_saedisplayname   displayName snapshot   — render/fallback
 *   pmo_payerinitiatives_saeemail         mail / UPN snapshot     — legible + legacy
 *
 * The legacy systemuser lookup
 * (_pmo_payerinitiatives_strategicaccountexecutive_value) is kept as a READ
 * FALLBACK only — most real SAEs never had a systemuser row. See
 * docs/planning/sae-systemuser-to-aad-transition-plan.md.
 */
import type { Project, ProjectUpdate } from '../models/project.model';

const FV = '@OData.Community.Display.V1.FormattedValue';

/** A Strategic Account Executive identity, sourced from Microsoft Graph. */
export interface SaeValue {
  /** Entra object id (GUID). Empty/undefined means "no SAE". */
  aadId?: string;
  displayName?: string;
  email?: string;
}

/** True when the value carries any identifying data. */
export function hasSae(sae: SaeValue | undefined | null): boolean {
  return !!(sae && (sae.aadId || sae.displayName || sae.email));
}

/**
 * Read the SAE identity off a project row. Prefers the AAD snapshot columns;
 * falls back to the legacy systemuser lookup's FormattedValue so migrated /
 * pre-transition projects still surface a name.
 */
export function readSae(project: Project): SaeValue {
  const aadId = project.pmo_payerinitiatives_saeaadobjectid ?? undefined;
  const displayName = project.pmo_payerinitiatives_saedisplayname ?? undefined;
  const email = project.pmo_payerinitiatives_saeemail ?? undefined;
  if (aadId || displayName || email) return { aadId, displayName, email };
  // Fallback: legacy systemuser lookup.
  const legacy = (project as unknown as Record<string, unknown>)[
    '_pmo_payerinitiatives_strategicaccountexecutive_value' + FV
  ] as string | undefined;
  return legacy ? { displayName: legacy } : {};
}

/**
 * The display string for the SAE on read surfaces (Key People, grids).
 * Returns '' when there is no SAE.
 */
export function resolveSaeDisplay(project: Project): string {
  const sae = readSae(project);
  return sae.displayName || sae.email || '';
}

/**
 * Build the PATCH/create payload fragment for an SAE change. Writes the three
 * AAD columns; passing an empty value clears all three (null). Never emits the
 * legacy @odata.bind.
 */
export function saeWritePayload(sae: SaeValue | undefined | null): ProjectUpdate {
  if (!hasSae(sae)) {
    return {
      pmo_payerinitiatives_saeaadobjectid: null,
      pmo_payerinitiatives_saedisplayname: null,
      pmo_payerinitiatives_saeemail: null,
    };
  }
  return {
    pmo_payerinitiatives_saeaadobjectid: sae!.aadId ?? null,
    pmo_payerinitiatives_saedisplayname: sae!.displayName ?? null,
    pmo_payerinitiatives_saeemail: sae!.email ?? null,
  };
}
