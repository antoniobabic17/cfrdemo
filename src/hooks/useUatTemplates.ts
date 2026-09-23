/**
 * UAT template and template-question hooks.
 *
 * EVERY write here goes through useAppMutation. That is not style: bare
 * `useMutation` holds a rejection privately, so a 403 / 500 / timeout produced no
 * toast and no Error Log row. useAppMutation owns the 60s timeout, the shared
 * transient-retry policy, the red toast and the pmo_telemetryevent row. See its
 * header for the PROD incident that created it.
 *
 * NOTE ON onError: useAppMutation owns the toast, and its contract says callers must
 * NOT toast from their own onError. Some older hooks in this repo do anyway and
 * double-toast on failure — see progress.md finding 34. onError here is used only for
 * optimistic rollback.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  listUatTemplates,
  listActiveUatTemplates,
  getUatTemplate,
  createUatTemplate,
  updateUatTemplate,
  listUatTemplateQuestions,
  createUatTemplateQuestion,
  updateUatTemplateQuestion,
  deleteUatTemplateQuestion,
} from '../api/uatTemplates.api';
import type {
  UatTemplateCreate,
  UatTemplateUpdate,
  UatTemplateQuestion,
  UatTemplateQuestionCreate,
  UatTemplateQuestionUpdate,
} from '../models/uatTemplate.model';

const TEMPLATES_QK = ['uatTemplates'] as const;
const TEMPLATE_QK = (id: string) => ['uatTemplate', id] as const;
const QUESTIONS_QK = (templateId: string) => ['uatTemplateQuestions', templateId] as const;

export function useUatTemplates() {
  return useQuery({
    queryKey: TEMPLATES_QK,
    queryFn: () => listUatTemplates(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useActiveUatTemplates() {
  return useQuery({
    queryKey: [...TEMPLATES_QK, 'active'],
    queryFn: () => listActiveUatTemplates(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUatTemplate(id: string | undefined) {
  return useQuery({
    queryKey: TEMPLATE_QK(id ?? ''),
    queryFn: () => getUatTemplate(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Questions for one template, in display order.
 *
 * pmo_section is null on ten of the thirteen seeded questions and
 * pmo_observedvaluelabel is null on all of them — the source plan does not supply
 * either (progress.md finding 31). Consumers must group unsectioned questions into an
 * "Ungrouped" bucket and fall back to a generic observed-value label. Rendering the
 * raw null, or inventing a heading, are both wrong.
 */
export function useUatTemplateQuestions(templateId: string | undefined) {
  return useQuery({
    queryKey: QUESTIONS_QK(templateId ?? ''),
    queryFn: () => listUatTemplateQuestions(templateId!),
    enabled: !!templateId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateUatTemplate() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'create UAT template',
    entityType: 'pmo_uattemplate',
    mutationFn: (payload: UatTemplateCreate) => createUatTemplate(payload),
    onSettled: () => qc.invalidateQueries({ queryKey: TEMPLATES_QK }),
  });
}

export function useUpdateUatTemplate() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update UAT template',
    entityType: 'pmo_uattemplate',
    entityId: (vars: { id: string; payload: UatTemplateUpdate }) => vars.id,
    mutationFn: ({ id, payload }: { id: string; payload: UatTemplateUpdate }) =>
      updateUatTemplate(id, payload),
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: TEMPLATES_QK });
      void qc.invalidateQueries({ queryKey: TEMPLATE_QK(vars.id) });
    },
  });
}

/**
 * Clone a template to a new version, questions and all.
 *
 * ONE mutation, not a create plus N calls to useCreateUatTemplateQuestion. That hook
 * takes its templateId purely to build cache keys, so driving a clone through it would
 * snapshot, roll back and invalidate the ORIGINAL template's question list while the
 * writes landed on the copy — the new template's list would stay stale and the original's
 * would churn for no reason. The new id only exists inside mutationFn, which is exactly
 * where the invalidation has to happen, so the clone owns its own mutation.
 *
 * The copy is also one logical operation to a user, so one telemetry row and one toast
 * is the honest accounting. The original is never written to; on a mid-way failure the
 * partial copy is a new row the user can delete, and the source is untouched.
 */
export function useCloneUatTemplate() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'clone UAT template',
    entityType: 'pmo_uattemplate',
    mutationFn: async ({
      template,
      questions,
    }: {
      template: UatTemplateCreate;
      questions: Omit<UatTemplateQuestionCreate, 'pmo_Template@odata.bind'>[];
    }) => {
      const created = await createUatTemplate(template);
      // Sequential, in sequence order, so a partial failure leaves a prefix of the
      // questions rather than an arbitrary subset.
      for (const question of questions) {
        await createUatTemplateQuestion({
          ...question,
          'pmo_Template@odata.bind': `/pmo_uattemplates(${created.pmo_uattemplateid})`,
        });
      }
      return created;
    },
    onSettled: (data) => {
      void qc.invalidateQueries({ queryKey: TEMPLATES_QK });
      if (data) {
        // The copy's own question list — the key useCreateUatTemplateQuestion could not
        // have known.
        void qc.invalidateQueries({ queryKey: QUESTIONS_QK(data.pmo_uattemplateid) });
      }
    },
  });
}

/**
 * Add a question to a template.
 *
 * This is THE operation the whole configuration layer exists for: in the legacy tool
 * a fourteenth question meant a schema change plus edits to two business rules plus a
 * form edit. Here it is one insert.
 */
export function useCreateUatTemplateQuestion(templateId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'add UAT template question',
    entityType: 'pmo_uattemplatequestion',
    mutationFn: (payload: UatTemplateQuestionCreate) => createUatTemplateQuestion(payload),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: QUESTIONS_QK(templateId) });
      return { previous: qc.getQueryData<UatTemplateQuestion[]>(QUESTIONS_QK(templateId)) };
    },
    onError: (_err, _vars, ctx) => {
      // Rollback only. useAppMutation owns the toast and the telemetry row.
      if (ctx?.previous) {
        qc.setQueryData<UatTemplateQuestion[]>(QUESTIONS_QK(templateId), ctx.previous);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUESTIONS_QK(templateId) }),
  });
}

export function useUpdateUatTemplateQuestion(templateId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update UAT template question',
    entityType: 'pmo_uattemplatequestion',
    entityId: (vars: { id: string; payload: UatTemplateQuestionUpdate }) => vars.id,
    mutationFn: ({ id, payload }: { id: string; payload: UatTemplateQuestionUpdate }) =>
      updateUatTemplateQuestion(id, payload),
    onSettled: () => qc.invalidateQueries({ queryKey: QUESTIONS_QK(templateId) }),
  });
}

/**
 * Reorder questions by rewriting pmo_sequence.
 *
 * A reorder REWRITES the sequence rather than moving rows, so this issues one update
 * per moved question. Each goes through useAppMutation individually — a partial
 * failure leaves a recoverable ordering and a logged error, rather than a silent
 * half-applied reorder.
 */
export function useReorderUatTemplateQuestions(templateId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'reorder UAT template questions',
    entityType: 'pmo_uattemplatequestion',
    mutationFn: async (ordered: { id: string; sequence: number }[]) => {
      for (const item of ordered) {
        await updateUatTemplateQuestion(item.id, { pmo_sequence: item.sequence });
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUESTIONS_QK(templateId) }),
  });
}

export function useDeleteUatTemplateQuestion(templateId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'delete UAT template question',
    entityType: 'pmo_uattemplatequestion',
    entityId: (id: string) => id,
    mutationFn: (id: string) => deleteUatTemplateQuestion(id),
    onSettled: () => qc.invalidateQueries({ queryKey: QUESTIONS_QK(templateId) }),
  });
}
