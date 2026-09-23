/**
 * Choose a template — the one picker, shared by every surface that stores a template
 * reference.
 *
 * FINDING 41 IS WHY THIS IS A COMPONENT AND NOT AN INLINE SELECT. Templates are
 * versioned and cloneable (FR-011), so "Epic Claim Validation" can legitimately exist
 * three times over. A picker that shows only the name gives a user no way to tell those
 * three apart, and the wrong one is invisible afterwards: the test case looks correctly
 * configured and asks the wrong questions. TemplateListPage.tsx's header records the
 * requirement that every consuming picker show the same identity the list shows — name,
 * version, active — and there are two consumers, `pmo_uattestcase.pmo_template` (here,
 * T025) and `pmo_uatprojectsetting.pmo_defaulttemplate` (T044). One component means the
 * two cannot drift apart; two inline selects would have to be kept in step by memory.
 *
 * IT OFFERS ACTIVE TEMPLATES AND STILL DISPLAYS AN INACTIVE ONE THAT IS ALREADY STORED.
 * Choosing a retired version for new work is a mistake, so retired versions are not in
 * the list. But a stored reference can go stale — a project's default template can be
 * retired months after it was chosen — and dropping it from the display would silently
 * read as "no template selected", which is a different and wrong statement. So a value
 * that is not among the active templates is fetched and shown, marked inactive, with the
 * consequence spelled out rather than left for the user to infer.
 */
import { AlertTriangle } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { Label } from '../../../components/ui/label';
import { useActiveUatTemplates, useUatTemplate } from '../../../hooks/useUatTemplates';
import type { UatTemplate } from '../../../models/uatTemplate.model';

/**
 * The sentinel for "deliberately no template".
 *
 * Radix Select cannot carry an empty-string item value, and a null template is a real
 * choice here rather than an absence of one — FR-013 requires a test case to be
 * creatable ad hoc — so the option needs a value of its own.
 */
export const NO_TEMPLATE_VALUE = '__none__';

export interface TemplatePickerProps {
  id: string;
  label: string;
  /** The stored template id, or null for none. */
  value: string | null;
  onChange: (templateId: string | null) => void;
  /**
   * Wording for the no-template option. The two consumers mean different things by it:
   * a test case with no template is ad hoc, a project with no default template just has
   * no default. A shared component that guessed would be wrong on one of them.
   */
  noneLabel: string;
  /** Shown under the control. The caller owns the explanation; this owns the identity. */
  description?: string;
  disabled?: boolean;
}

/** Name, version and active state — the three facts that distinguish two versions. */
export function templateIdentity(template: UatTemplate): string {
  const version = `v${template.pmo_version ?? 1}`;
  return template.pmo_isactive === false
    ? `${template.pmo_name} · ${version} · inactive`
    : `${template.pmo_name} · ${version}`;
}

export function TemplatePicker({
  id,
  label,
  value,
  onChange,
  noneLabel,
  description,
  disabled,
}: TemplatePickerProps) {
  const { data: templates = [], isLoading, isError } = useActiveUatTemplates();
  const isKnown = !!value && templates.some((t) => t.pmo_uattemplateid === value);

  // Only for a stored value the active list does not contain. `enabled` is driven by the
  // id being undefined, so the common case costs no request.
  const { data: strandedTemplate } = useUatTemplate(!value || isKnown ? undefined : value);
  const stranded = !isKnown && value ? strandedTemplate : undefined;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ?? NO_TEMPLATE_VALUE}
        disabled={disabled || isLoading}
        onValueChange={(next) => onChange(next === NO_TEMPLATE_VALUE ? null : next)}
      >
        <SelectTrigger id={id} aria-describedby={`${id}-help`}>
          <SelectValue placeholder={isLoading ? 'Loading templates…' : noneLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_TEMPLATE_VALUE}>{noneLabel}</SelectItem>
          {/* The stranded value first, so a stale stored reference is visible rather
              than being the one option that cannot be re-selected. */}
          {stranded && (
            <SelectItem value={stranded.pmo_uattemplateid}>
              {templateIdentity(stranded)}
            </SelectItem>
          )}
          {templates.map((template) => (
            <SelectItem key={template.pmo_uattemplateid} value={template.pmo_uattemplateid}>
              {templateIdentity(template)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {description}
      </p>

      {/* An empty active list is not an error and must not read as one. */}
      {!isLoading && !isError && templates.length === 0 && !stranded && (
        <p className="text-xs text-muted-foreground">
          No active templates yet. Create one under UAT → Templates, or continue without one.
        </p>
      )}

      {isError && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          Templates could not be loaded. You can still continue without one.
        </p>
      )}

      {stranded && (
        <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          This template is inactive. It stays selected until you change it, and new runs
          will still read its questions.
        </p>
      )}
    </div>
  );
}
