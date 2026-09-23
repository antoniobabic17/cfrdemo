import { ARTIFACT_TYPE, INTAKE_CONFIGURABLE_FIELDS } from './constants';
import type { GateSetTemplate, GateSetItem } from '../models/gateSetTemplate.model';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_ARTIFACT_TYPES = new Set<number>(Object.values(ARTIFACT_TYPE) as number[]);
const VALID_INTAKE_FIELDS = new Set(Object.keys(INTAKE_CONFIGURABLE_FIELDS));

const ALLOWED_PROJECT_FIELDS = new Set([
  'msdyn_subject',
  'msdyn_description',
  'msdyn_scheduledstart',
  'pmo_cfrcategory',
  'pmo_complexity',
  'pmo_strategicpriority',
  'proj_budget',
  'pmo_PrimaryTeam@odata.bind',
  'msdyn_projectmanager@odata.bind',
  'proj_ExecutiveSponsor@odata.bind',
]);

const ALLOWED_INTAKE_FIELDS_FOR_MAPPING = new Set([
  'pmo_name',
  'pmo_submissiontext',
  'pmo_description',
  'pmo_businessjustification',
  'pmo_lineofbusiness',
  'pmo_estimatedbudget',
  'pmo_requestedstartdate',
  'pmo_targetcompletiondate',
  'pmo_priority',
  '_pmo_targetteam_value',
  '_pmo_affectedsystem_value',
  'pmo_extractedfieldsjson',
]);

function tryParseJson(json: string): { value: unknown; error?: string } {
  try {
    return { value: JSON.parse(json) };
  } catch {
    return { value: null, error: 'Invalid JSON.' };
  }
}

export interface ConversionRule {
  intakeField: string;
  projectField: string;
  transform?: 'direct' | 'odata_bind';
}

export function validateConversionRules(json: string): ValidationResult {
  const errors: string[] = [];
  const { value, error } = tryParseJson(json);
  if (error) return { valid: false, errors: ['Invalid JSON — expected an array of conversion rule objects.'] };
  if (!Array.isArray(value)) return { valid: false, errors: ['Invalid JSON — expected an array of conversion rule objects.'] };

  const seenIntake = new Set<string>();
  const seenProject = new Set<string>();

  for (let i = 0; i < (value as unknown[]).length; i++) {
    const rule = value[i] as Record<string, unknown>;
    const idx = i + 1;

    if (typeof rule.intakeField !== 'string' || !rule.intakeField) {
      errors.push(`Rule ${idx}: intakeField is required.`);
    } else if (!ALLOWED_INTAKE_FIELDS_FOR_MAPPING.has(rule.intakeField)) {
      errors.push(`Rule ${idx}: intakeField '${rule.intakeField}' is not a recognized intake field.`);
    } else if (seenIntake.has(rule.intakeField)) {
      errors.push(`Duplicate intake field: '${rule.intakeField}' appears in multiple rules.`);
    } else {
      seenIntake.add(rule.intakeField);
    }

    if (typeof rule.projectField !== 'string' || !rule.projectField) {
      errors.push(`Rule ${idx}: projectField is required.`);
    } else if (!ALLOWED_PROJECT_FIELDS.has(rule.projectField)) {
      errors.push(`Rule ${idx}: projectField '${rule.projectField}' is not a recognized project field.`);
    } else if (seenProject.has(rule.projectField)) {
      errors.push(`Duplicate project field: '${rule.projectField}' appears in multiple rules.`);
    } else {
      seenProject.add(rule.projectField);
    }

    if (rule.transform !== undefined && rule.transform !== 'direct' && rule.transform !== 'odata_bind') {
      errors.push(`Rule ${idx}: transform must be 'direct' or 'odata_bind'.`);
    }

    if (rule.transform === 'odata_bind' && typeof rule.projectField === 'string' && !rule.projectField.endsWith('@odata.bind')) {
      errors.push(`Rule ${idx}: projectField must end with '@odata.bind' when transform is 'odata_bind'.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateRequiredFields(json: string): ValidationResult {
  const errors: string[] = [];
  const { value, error } = tryParseJson(json);
  if (error) return { valid: false, errors: ['Invalid JSON — expected an array of field names.'] };
  if (!Array.isArray(value)) return { valid: false, errors: ['Invalid JSON — expected an array of field names.'] };

  const seen = new Set<string>();
  for (const field of value as unknown[]) {
    if (typeof field !== 'string') {
      errors.push(`Each element must be a string field name.`);
      continue;
    }
    if (!VALID_INTAKE_FIELDS.has(field)) {
      errors.push(`'${field}' is not a valid intake field name.`);
    }
    if (seen.has(field)) {
      errors.push(`Duplicate field: '${field}'.`);
    }
    seen.add(field);
  }

  return { valid: errors.length === 0, errors };
}

export function validateRequiredArtifactTypes(json: string): ValidationResult {
  const errors: string[] = [];
  const { value, error } = tryParseJson(json);
  if (error) return { valid: false, errors: ['Invalid JSON — expected an array of artifact type codes.'] };
  if (!Array.isArray(value)) return { valid: false, errors: ['Invalid JSON — expected an array of artifact type codes.'] };

  const seen = new Set<number>();
  for (const item of value as unknown[]) {
    if (typeof item !== 'number' || !Number.isInteger(item)) {
      errors.push(`Each element must be an integer artifact type code.`);
      continue;
    }
    if (!VALID_ARTIFACT_TYPES.has(item)) {
      errors.push(`'${item}' is not a valid artifact type.`);
    }
    if (seen.has(item)) {
      errors.push(`Duplicate artifact type: '${item}'.`);
    }
    seen.add(item);
  }

  return { valid: errors.length === 0, errors };
}

export interface StageDataEntry {
  completedAt: string;
  completedBy: string;
  fields: Record<string, unknown>;
}

export function validateStageData(json: string): ValidationResult {
  const errors: string[] = [];
  const { value, error } = tryParseJson(json);
  if (error) return { valid: false, errors: ['Invalid JSON for stage data.'] };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { valid: false, errors: ['Stage data must be a JSON object.'] };
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!/^stage_\d+$/.test(key)) {
      errors.push(`Invalid stage key: '${key}'. Expected format: stage_N.`);
      continue;
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.completedAt !== 'string') errors.push(`${key}: completedAt must be a string.`);
    if (typeof e.completedBy !== 'string') errors.push(`${key}: completedBy must be a string.`);
    if (typeof e.fields !== 'object' || e.fields === null) errors.push(`${key}: fields must be an object.`);
  }

  return { valid: errors.length === 0, errors };
}

export interface StageArtifact {
  stageOrder: number;
  artifactType: number;
  annotationId: string;
  fileName: string;
  uploadedAt: string;
}

export function validateStageArtifacts(json: string): ValidationResult {
  const errors: string[] = [];
  const { value, error } = tryParseJson(json);
  if (error) return { valid: false, errors: ['Invalid JSON for stage artifacts.'] };
  if (!Array.isArray(value)) return { valid: false, errors: ['Stage artifacts must be a JSON array.'] };

  for (let i = 0; i < (value as unknown[]).length; i++) {
    const a = value[i] as Record<string, unknown>;
    const idx = i + 1;
    if (typeof a.stageOrder !== 'number' || a.stageOrder < 0) errors.push(`Artifact ${idx}: stageOrder must be a non-negative integer.`);
    if (typeof a.artifactType !== 'number' || !VALID_ARTIFACT_TYPES.has(a.artifactType)) errors.push(`Artifact ${idx}: artifactType is invalid.`);
    if (typeof a.annotationId !== 'string' || !a.annotationId) errors.push(`Artifact ${idx}: annotationId is required.`);
    if (typeof a.fileName !== 'string') errors.push(`Artifact ${idx}: fileName must be a string.`);
    if (typeof a.uploadedAt !== 'string') errors.push(`Artifact ${idx}: uploadedAt must be a string.`);
  }

  return { valid: errors.length === 0, errors };
}

export type ApprovalActionType = 'approved' | 'sent_back' | 'resubmitted' | 'rejected';

export interface ApprovalAction {
  stageOrder: number;
  action: ApprovalActionType;
  actorId: string;
  actorName: string;
  timestamp: string;
  rationale: string;
  clarificationQuestion?: string;
  clarificationResponse?: string;
}

const VALID_ACTIONS = new Set<string>(['approved', 'sent_back', 'resubmitted', 'rejected']);

export function validateApprovalChain(json: string): ValidationResult {
  const errors: string[] = [];
  const { value, error } = tryParseJson(json);
  if (error) return { valid: false, errors: ['Invalid JSON for approval chain.'] };
  if (!Array.isArray(value)) return { valid: false, errors: ['Approval chain must be a JSON array.'] };

  for (let i = 0; i < (value as unknown[]).length; i++) {
    const a = value[i] as Record<string, unknown>;
    const idx = i + 1;
    if (typeof a.stageOrder !== 'number' || a.stageOrder < 0) errors.push(`Entry ${idx}: stageOrder must be a non-negative integer.`);
    if (typeof a.action !== 'string' || !VALID_ACTIONS.has(a.action)) errors.push(`Entry ${idx}: action must be one of: approved, sent_back, resubmitted, rejected.`);
    if (typeof a.actorId !== 'string' || !a.actorId) errors.push(`Entry ${idx}: actorId is required.`);
    if (typeof a.actorName !== 'string') errors.push(`Entry ${idx}: actorName must be a string.`);
    if (typeof a.timestamp !== 'string') errors.push(`Entry ${idx}: timestamp must be a string.`);
  }

  return { valid: errors.length === 0, errors };
}

export function validateWorkflowIntegrity(workflow: GateSetTemplate, stages: GateSetItem[]): ValidationResult {
  const errors: string[] = [];

  if (!workflow.pmo_name?.trim()) {
    errors.push('Workflow name is required.');
  }

  if (stages.length === 0) {
    errors.push('Workflow must have at least one stage.');
    return { valid: false, errors };
  }

  let hasNameField = false;
  const orders = new Set<number>();

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const label = stage.pmo_stagelabel || stage.pmo_name || `Stage ${i + 1}`;

    if (!stage.pmo_stagelabel?.trim() && !stage.pmo_name?.trim()) {
      errors.push(`Stage ${i + 1}: label is required.`);
    }

    if (orders.has(stage.pmo_gateorder)) {
      errors.push(`Stage ${i + 1} (${label}): duplicate gate order ${stage.pmo_gateorder}.`);
    }
    orders.add(stage.pmo_gateorder);

    if (stage.pmo_requiresapproval && !stage.pmo_approvergroupid?.trim()) {
      errors.push(`Stage "${label}": approver group is required when approval is enabled.`);
    }

    if (stage.pmo_requiredfieldsjson) {
      const fieldResult = validateRequiredFields(stage.pmo_requiredfieldsjson);
      if (!fieldResult.valid) {
        for (const err of fieldResult.errors) {
          errors.push(`Stage "${label}" required fields: ${err}`);
        }
      } else {
        const fields = JSON.parse(stage.pmo_requiredfieldsjson) as string[];
        if (fields.includes('pmo_name')) hasNameField = true;
      }
    }

    if (stage.pmo_requiredartifacttypesjson) {
      const artResult = validateRequiredArtifactTypes(stage.pmo_requiredartifacttypesjson);
      if (!artResult.valid) {
        for (const err of artResult.errors) {
          errors.push(`Stage "${label}" artifact types: ${err}`);
        }
      }
    }
  }

  if (!hasNameField) {
    errors.push("At least one stage must require the 'pmo_name' field.");
  }

  const sortedOrders = [...orders].sort((a, b) => a - b);
  for (let i = 0; i < sortedOrders.length; i++) {
    if (sortedOrders[i] !== i) {
      errors.push(`Gate order values must be sequential starting from 0. Found gap at position ${i}.`);
      break;
    }
  }

  if (workflow.pmo_conversionrulesjson) {
    const ruleResult = validateConversionRules(workflow.pmo_conversionrulesjson);
    if (!ruleResult.valid) {
      for (const err of ruleResult.errors) {
        errors.push(`Conversion rules: ${err}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
