/**
 * UAT configuration layer: a template and its questions.
 *
 * pmo_uattemplatequestion is what replaces the legacy tool's 39 fixed result
 * columns and 25 mirrored yes/no columns. A question is a ROW, so adding one is an
 * insert rather than a schema change plus two business-rule edits plus a form edit.
 *
 * Parent and child live in one file because they are never used apart: a template
 * without its questions is not a thing any screen shows.
 */
import type { ActiveState } from './common.model';

export interface UatTemplate extends ActiveState {
  pmo_uattemplateid: string;
  pmo_name: string;
  pmo_description: string | null;
  pmo_version: number | null;
  pmo_isactive: boolean | null;
  pmo_defaultestimatedminutes: number | null;
  _pmo_owner_value: string | null;
  createdon: string;
  modifiedon: string;
  /**
   * pmo_category is DELIBERATELY ABSENT. data-model.md 1.1 names its option set
   * (pmo_uattemplatecategory) but no vocabulary for it exists anywhere in the spec,
   * so the column was not created — see progress.md finding 27. Add it here when the
   * members are settled; do not add a speculative field for it.
   */
}

/** Update payload. Never sends the id or platform-managed columns. */
export interface UatTemplateUpdate {
  pmo_name?: string;
  pmo_description?: string | null;
  pmo_version?: number | null;
  pmo_isactive?: boolean | null;
  pmo_defaultestimatedminutes?: number | null;
  /** Lookup to systemusers: '/systemusers(<guid>)' or null to clear. */
  'pmo_Owner@odata.bind'?: string | null;
}

export interface UatTemplateCreate extends UatTemplateUpdate {
  pmo_name: string;
}

export interface UatTemplateQuestion extends ActiveState {
  pmo_uattemplatequestionid: string;
  /** This table's primary name, so the platform requires it. */
  pmo_questiontext: string;
  _pmo_template_value: string;
  pmo_sequence: number | null;
  pmo_helptext: string | null;
  pmo_expectedresult: string | null;
  /** Bound to the global pmo_uatresponsetype set: the INPUT type, not the outcome. */
  pmo_responsetype: number | null;
  pmo_isrequired: boolean | null;
  pmo_capturesobservedvalue: boolean | null;
  /**
   * The legacy "in system" label. Null on all 13 seeded questions: the source plan
   * never enumerates the per-question labels (progress.md finding 31). Callers must
   * tolerate null and fall back to a generic label rather than showing "null".
   */
  pmo_observedvaluelabel: string | null;
  pmo_allowscomment: boolean | null;
  pmo_allowsattachment: boolean | null;
  /**
   * Null on seeded questions 3-12: the source plan elides ten of the thirteen legacy
   * section names behind an ellipsis (finding 31). Group by section only where it is
   * populated; an "Ungrouped" bucket is correct here, an invented heading is not.
   */
  pmo_section: string | null;
  createdon: string;
  modifiedon: string;
}

export interface UatTemplateQuestionUpdate {
  pmo_questiontext?: string;
  pmo_sequence?: number | null;
  pmo_helptext?: string | null;
  pmo_expectedresult?: string | null;
  pmo_responsetype?: number | null;
  pmo_isrequired?: boolean | null;
  pmo_capturesobservedvalue?: boolean | null;
  pmo_observedvaluelabel?: string | null;
  pmo_allowscomment?: boolean | null;
  pmo_allowsattachment?: boolean | null;
  pmo_section?: string | null;
}

export interface UatTemplateQuestionCreate extends UatTemplateQuestionUpdate {
  pmo_questiontext: string;
  /** '/pmo_uattemplates(<guid>)'. Cascade parent: required. */
  'pmo_Template@odata.bind': string;
}
