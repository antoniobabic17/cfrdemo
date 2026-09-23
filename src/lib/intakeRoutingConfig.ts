export interface EnrichmentQuestion {
  field: string;
  prompt: string;
  required: boolean;
}

export interface EnrichmentPack {
  id: string;
  questions: EnrichmentQuestion[];
}

export interface IntakeRoutingEntry {
  teamDomain: string;
  systemKeywords: string[];
  functionalKeywords: string[];
  workTypeSignals: string[];
  projectSignalTypes: string[];
  operationalSignalTypes: string[];
  confidenceFloor: number;
  enrichmentPack: string;
}

export const INTAKE_ROUTING_CONFIG: IntakeRoutingEntry[] = [
  {
    teamDomain: 'BPR',
    systemKeywords: ['Epic', 'ACIS', 'MediAR', 'HC360', 'workflow', 'change control', 'CTP'],
    functionalKeywords: [
      'billing', 'cash', 'claims', 'collections', 'denials', 'revenue integrity',
      'workflow', 'patient resolution', 'new process', 'update process',
      'Epic enhancement', 'Epic release',
    ],
    workTypeSignals: [
      'new process', 'update existing', 'Epic enhancement', 'project management',
      'change control', 'workflow build',
    ],
    projectSignalTypes: ['Epic Enhancement', 'Project Management', 'New Process'],
    operationalSignalTypes: ['Inquiry', 'CTP Maintenance'],
    confidenceFloor: 60,
    enrichmentPack: 'bpr-pack',
  },
  {
    teamDomain: 'CapEx',
    systemKeywords: ['ACIS', 'Epic', 'ePremis', 'HC360', 'FHA', 'RCM', 'ServiceNow'],
    functionalKeywords: [
      'capital', 'capital funding', 'CapEx', 'ROI', 'investment', 'funding',
      'budget request', 'IT project', 'digital project',
    ],
    workTypeSignals: ['capital investment', 'capital request', 'fund', 'unfunded risk'],
    projectSignalTypes: ['Digital Projects', 'IT Projects', 'Non-IT Projects'],
    operationalSignalTypes: [],
    confidenceFloor: 70,
    enrichmentPack: 'capex-pack',
  },
  {
    teamDomain: 'BI',
    systemKeywords: [
      'Power BI', 'dashboard', 'report', 'Nexus', 'RCM solution', 'SharePoint',
      'DL', 'distribution list', 'mailbox', 'ServiceNow', 'security',
    ],
    functionalKeywords: [
      'report', 'dashboard', 'data', 'analytics', 'break fix', 'fix',
      'BI report', 'refresh schedule', 'access', 'group', 'mailbox',
    ],
    workTypeSignals: [
      'modify dashboard', 'new report', 'break fix', 'fix issue',
      'create group', 'update group', 'add user', 'remove user',
    ],
    projectSignalTypes: ['New Project Request'],
    operationalSignalTypes: [
      'Break/Fix', 'General Inquiry', 'DL/Group Management',
      'IT Ticket Approver', 'Security Issue',
    ],
    confidenceFloor: 55,
    enrichmentPack: 'bi-pack',
  },
  {
    teamDomain: 'Training',
    systemKeywords: ['ACIS', 'Epic', 'MediAR', 'ePremis', 'Availity', 'ServiceNow', 'SharePoint', 'Power BI'],
    functionalKeywords: [
      'training', 'job aid', 'curriculum', 'tip sheet', 'memo blast',
      'quick start guide', 'onboarding', 'QA', 'quality assurance',
      'teach', 'train', 'schedule training', 'instruction',
    ],
    workTypeSignals: [
      'new job aid', 'update job aid', 'training delivery', 'new curriculum',
      'schedule training', 'memo blast',
    ],
    projectSignalTypes: [
      'Project', 'Training Delivery – New Curriculum',
      'Training Delivery – Update Existing Curriculum',
    ],
    operationalSignalTypes: [
      'New Job Aid', 'Update Job Aid', 'Memo Blast',
      'Training Delivery – Schedule Training',
    ],
    confidenceFloor: 65,
    enrichmentPack: 'training-pack',
  },
  {
    teamDomain: 'Systems',
    systemKeywords: [
      'Availity', 'ePremis', 'EDI', '835', '837', 'EFT', 'ACH',
      'clearinghouse', 'CPID', 'enrollment', 'payer enrollment',
    ],
    functionalKeywords: [
      'EDI rejection', 'enrollment', 'clearinghouse', '835', '837',
      'EFT enrollment', 'ACH', 'payer enrollment', 'ePremis issue',
      'Availity issue', 'system improvement',
    ],
    workTypeSignals: ['EDI', 'enrollment', 'rejection fix', 'payer setup', 'EFT'],
    projectSignalTypes: [],
    operationalSignalTypes: [
      'Availity', 'CPID', 'EDI Rejections', 'ePremis', 'General',
      '835 Enrollment', '837 Enrollment', 'EFT/ACH Enrollment',
    ],
    confidenceFloor: 65,
    enrichmentPack: 'systems-pack',
  },
  {
    teamDomain: 'RiskMgmt',
    systemKeywords: [],
    functionalKeywords: [
      'policy', 'procedure', 'P&P', 'PPR', 'risk', 'risk consultation',
      'compliance', 'regulatory', 'QA audit', 'audit', 'quality assurance',
    ],
    workTypeSignals: [
      'policy revision', 'procedure update', 'risk consultation',
      'QA review', 'internal audit', 'target audit',
    ],
    projectSignalTypes: [],
    operationalSignalTypes: ['Policy & Procedure Revision', 'Risk Consultation', 'QA'],
    confidenceFloor: 70,
    enrichmentPack: 'riskmgmt-pack',
  },
  {
    teamDomain: 'PayerIssues',
    systemKeywords: ['Epic', 'Availity', 'NPI', '837', 'NCPDP', 'clearinghouse'],
    functionalKeywords: [
      'payer', 'payer issue', 'contract', 'auth', 'authorization',
      'claim', 'NPI', 'credentialing', 'pricing discrepancy', 'fee schedule',
      'primary secondary', 'billing related', 'payer rules',
    ],
    workTypeSignals: [
      'payer issue', 'auth discrepancy', 'pricing discrepancy',
      'NPI issue', 'claim issue', 'enrollment issue',
    ],
    projectSignalTypes: [],
    operationalSignalTypes: [
      '837 Issue', 'Auth/No Auth Discrepancy', 'Billing Related',
      'NPI/Credentialing', 'Pricing/Fee Schedule Discrepancy',
      'Payer Rules Inquiry', 'Requirements Change',
    ],
    confidenceFloor: 60,
    enrichmentPack: 'payer-pack',
  },
];

// ─── Admin-editable format (§4.6) ────────────────────────────────────────────

/** Simplified routing domain stored in Dataverse (admin-manageable). */
export interface RoutingDomain {
  domainName: string;      // display name; non-empty
  teamId: string;          // Dataverse team GUID (empty string = not yet linked)
  keywords: string[];      // flat keyword list, equal-weight scoring
  confidenceFloor: number; // integer 30–90 inclusive
}

/** Convert the static IntakeRoutingEntry[] to admin-editable RoutingDomain[]. */
export function intakeEntriesToRoutingDomains(entries: IntakeRoutingEntry[]): RoutingDomain[] {
  return entries.map((e) => ({
    domainName: e.teamDomain,
    teamId: '',
    keywords: [...e.systemKeywords, ...e.functionalKeywords, ...e.workTypeSignals],
    confidenceFloor: e.confidenceFloor,
  }));
}

/** Score submission text against an admin-managed RoutingDomain[] (equal-weight keywords).
 *  Returns the best match above its confidence floor, or the best overall if none qualify. */
export function scoreAgainstDomains(
  submissionText: string,
  domains: RoutingDomain[],
): { domainName: string; teamId: string; confidence: number; matched: string[]; meetsFloor: boolean } | null {
  if (!submissionText.trim() || domains.length === 0) return null;
  const text = submissionText.toLowerCase();
  const scored = domains
    .filter((d) => d.keywords.length > 0)
    .map((domain) => {
      const matched = domain.keywords.filter((kw) => kw && text.includes(kw.toLowerCase()));
      const confidence = Math.min(100, Math.round((matched.length / domain.keywords.length) * 100));
      return { domainName: domain.domainName, teamId: domain.teamId, confidence, matched, meetsFloor: confidence >= domain.confidenceFloor };
    });
  if (scored.length === 0) return null;
  const aboveFloor = scored.filter((s) => s.meetsFloor);
  return aboveFloor.length > 0
    ? aboveFloor.reduce((a, b) => (a.confidence >= b.confidence ? a : b))
    : scored.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
}

/** Client-side keyword overlap score (Jaccard-style) between two text strings. */
export function keywordOverlapScore(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const setA = tokenize(a);
  const setB = tokenize(b);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

/** Score submission text against all routing domains and return the best match. */
export function scoreSubmissionText(submissionText: string): {
  domain: string;
  confidence: number;
  explanation: string;
} | null {
  if (!submissionText.trim()) return null;

  let best: { domain: string; confidence: number; explanation: string } | null = null;

  for (const entry of INTAKE_ROUTING_CONFIG) {
    const text = submissionText.toLowerCase();
    let score = 0;
    const matched: string[] = [];

    for (const kw of entry.systemKeywords) {
      if (text.includes(kw.toLowerCase())) { score += 2; matched.push(kw); }
    }
    for (const kw of entry.functionalKeywords) {
      if (text.includes(kw.toLowerCase())) { score += 1; matched.push(kw); }
    }
    for (const kw of entry.workTypeSignals) {
      if (text.includes(kw.toLowerCase())) { score += 0.5; matched.push(kw); }
    }

    const maxScore = entry.systemKeywords.length * 2 + entry.functionalKeywords.length + entry.workTypeSignals.length * 0.5;
    const normalized = maxScore > 0 ? Math.min(100, Math.round((score / maxScore) * 100)) : 0;

    if (!best || normalized > best.confidence) {
      best = {
        domain: entry.teamDomain,
        confidence: normalized,
        explanation: matched.length > 0
          ? `Matched signals: ${matched.slice(0, 5).join(', ')}`
          : 'No strong keyword matches found.',
      };
    }
  }

  return best;
}
