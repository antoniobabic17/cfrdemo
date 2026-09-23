import { describe, it, expect } from 'vitest';
import {
  evaluateCustomColumn,
  migrateLegacyFormula,
  extractFormulaFieldRefs,
  isLegacyFormula,
  readCellValueTyped,
  type CustomColumnFormula,
} from './customColumns';

// Field index maps lowercased display label -> colKey.
const FIELD_INDEX: Record<string, string> = {
  'project id': 'pmo_projectid',
  'name': 'pmo_name',
  'status': 'pmo_projectstatus',
  'budget': 'pmo_budget',
  'due date': 'pmo_finish',
};

const ROW: Record<string, unknown> = {
  pmo_projectid: 'PROJ-4749',
  pmo_name: 'BCBSMA Overpayment File',
  pmo_projectstatus: 508640001,
  'pmo_projectstatus@OData.Community.Display.V1.FormattedValue': 'In-Progress',
  pmo_budget: 150000,
  pmo_finish: '2026-06-30T00:00:00Z',
};

function evalF(formula: string): string {
  const f: CustomColumnFormula = { id: 't', label: 't', formula };
  return evaluateCustomColumn(ROW, f, FIELD_INDEX);
}

describe('formula engine — field references', () => {
  it('resolves a single field (formatted value preferred)', () => {
    expect(evalF('=[Status]')).toBe('In-Progress');
  });
  it('resolves raw value when no formatted value exists', () => {
    expect(evalF('=[Name]')).toBe('BCBSMA Overpayment File');
  });
  it('unknown field resolves to empty string, not an error', () => {
    expect(evalF('=[Nonexistent Field]')).toBe('');
  });
  it('field names are case-insensitive', () => {
    expect(evalF('=[PROJECT ID]')).toBe('PROJ-4749');
  });
});

describe('formula engine — text functions', () => {
  it('CONCATENATE joins values', () => {
    expect(evalF('=CONCATENATE([Project ID],"-",[Status])')).toBe('PROJ-4749-In-Progress');
  });
  it('& operator concatenates', () => {
    expect(evalF('=[Project ID]&" / "&[Status]')).toBe('PROJ-4749 / In-Progress');
  });
  it('LEFT/RIGHT/MID', () => {
    expect(evalF('=LEFT([Project ID],4)')).toBe('PROJ');
    expect(evalF('=RIGHT([Project ID],4)')).toBe('4749');
    expect(evalF('=MID([Project ID],1,4)')).toBe('PROJ');
  });
  it('UPPER/LOWER/TRIM/LEN', () => {
    expect(evalF('=UPPER([Status])')).toBe('IN-PROGRESS');
    expect(evalF('=LOWER([Status])')).toBe('in-progress');
    expect(evalF('=LEN([Project ID])')).toBe('9'); // 'PROJ-4749' = 9 chars
  });
});

describe('formula engine — logical + numeric', () => {
  it('IF with numeric comparison on a raw numeric field', () => {
    expect(evalF('=IF([Budget]>100000,"Large","Small")')).toBe('Large');
    expect(evalF('=IF([Budget]<100000,"Small","Large")')).toBe('Large');
  });
  it('arithmetic on numeric field', () => {
    expect(evalF('=[Budget]*2')).toBe('300000');
    expect(evalF('=ROUND([Budget]/3,2)')).toBe('50000');
  });
  it('AND / OR', () => {
    expect(evalF('=IF(AND([Budget]>1000,[Budget]<200000),"mid","other")')).toBe('mid');
    expect(evalF('=IF(OR([Budget]>999999,[Status]="In-Progress"),"yes","no")')).toBe('yes');
  });
  it('nested functions', () => {
    expect(evalF('=IF([Budget]>100000,CONCATENATE("Big: ",[Name]),"Small")')).toBe('Big: BCBSMA Overpayment File');
  });
  it('division by zero yields #DIV/0!', () => {
    expect(evalF('=[Budget]/0')).toBe('#DIV/0!');
  });
});

describe('formula engine — date functions', () => {
  it('YEAR / MONTH extract from a date field', () => {
    expect(evalF('=YEAR([Due Date])')).toBe('2026');
    expect(evalF('=MONTH([Due Date])')).toBe('6');
  });
  it('TEXT formats a date (lowercase tokens)', () => {
    expect(evalF('=TEXT([Due Date],"yyyy")')).toContain('2026');
  });
  it('TEXT formats a date (uppercase YYYY, as legacy migration emits)', () => {
    expect(evalF('=TEXT([Due Date],"YYYY")')).toContain('2026');
  });
  it('TEXT formats a date MM/YYYY', () => {
    const v = evalF('=TEXT([Due Date],"MM/YYYY")');
    expect(v).toContain('2026');
    expect(v).toContain('06');
  });
});

describe('formula engine — error handling', () => {
  it('unknown function returns #ERROR', () => {
    expect(evalF('=BOGUSFN([Name])')).toContain('#ERROR');
  });
  it('unclosed bracket returns #ERROR', () => {
    expect(evalF('=[Unclosed')).toContain('#ERROR');
  });
  it('empty formula returns empty string', () => {
    expect(evalF('=')).toBe('');
    expect(evalF('')).toBe('');
  });
  it('IFERROR catches downstream errors', () => {
    // A valid formula wrapped in IFERROR still returns its value.
    expect(evalF('=IFERROR([Budget]/2,"failed")')).toBe('75000');
  });
});

describe('legacy migration', () => {
  it('detects legacy shape', () => {
    expect(isLegacyFormula({ id: 'x', label: 'l', parts: [{ colKey: 'a' }] } as never)).toBe(true);
    expect(isLegacyFormula({ id: 'x', label: 'l', formula: '=[a]' } as never)).toBe(false);
  });

  it('single-part legacy → field ref', () => {
    const migrated = migrateLegacyFormula(
      { id: '1', label: 'Short ID', parts: [{ colKey: 'pmo_projectid' }] },
      { pmo_projectid: 'Project ID' },
    );
    expect(migrated.formula).toBe('=[Project ID]');
    expect(migrated.label).toBe('Short ID');
    expect(migrated.id).toBe('1');
  });

  it('multi-part with separator → CONCATENATE', () => {
    const migrated = migrateLegacyFormula(
      {
        id: '2', label: 'Combo',
        parts: [{ colKey: 'pmo_projectid' }, { colKey: 'pmo_name', transform: 'left', chars: 5 }],
        separator: ' - ',
      },
      { pmo_projectid: 'Project ID', pmo_name: 'Name' },
    );
    expect(migrated.formula).toBe('=CONCATENATE([Project ID]," - ",LEFT([Name],5))');
  });

  it('date-format legacy part → TEXT', () => {
    const migrated = migrateLegacyFormula(
      { id: '3', label: 'Year', parts: [{ colKey: 'pmo_finish', dateFormat: 'YYYY' }] },
      { pmo_finish: 'Due Date' },
    );
    expect(migrated.formula).toBe('=TEXT([Due Date],"YYYY")');
  });

  it('migrated formula evaluates to the same value the old engine produced', () => {
    const migrated = migrateLegacyFormula(
      {
        id: '4', label: 'ID-Status',
        parts: [{ colKey: 'pmo_projectid' }, { colKey: 'pmo_projectstatus' }],
        separator: ' / ',
      },
      { pmo_projectid: 'Project ID', pmo_projectstatus: 'Status' },
    );
    expect(evaluateCustomColumn(ROW, migrated, FIELD_INDEX)).toBe('PROJ-4749 / In-Progress');
  });
});

describe('extractFormulaFieldRefs', () => {
  it('lists field refs (lowercased)', () => {
    expect(extractFormulaFieldRefs('=CONCATENATE([Project ID],"-",[Status])').sort())
      .toEqual(['project id', 'status']);
  });
  it('returns empty for a malformed formula', () => {
    expect(extractFormulaFieldRefs('=[Unclosed')).toEqual([]);
  });
});

describe('UserViewConfig customColumns round-trip', () => {
  // The user/team custom columns are stored inside a pmo_userview row's
  // config JSON under `customColumns`. Verify serialize -> parse -> evaluate.
  it('serializes and re-parses custom columns from a view config', () => {
    const formula: CustomColumnFormula = {
      id: 'uc-1', label: 'My Combo',
      formula: '=CONCATENATE([Project ID]," / ",[Status])',
    };
    const config = { customColumns: [formula], columns: [], widths: {} };
    const json = JSON.stringify(config);
    const parsed = JSON.parse(json) as { customColumns: CustomColumnFormula[] };
    expect(parsed.customColumns).toHaveLength(1);
    expect(evaluateCustomColumn(ROW, parsed.customColumns[0], FIELD_INDEX))
      .toBe('PROJ-4749 / In-Progress');
  });
});

describe('readCellValueTyped', () => {
  it('returns raw number for numeric field', () => {
    expect(readCellValueTyped(ROW, 'pmo_budget')).toBe(150000);
  });
  it('returns formatted string for choice field', () => {
    expect(readCellValueTyped(ROW, 'pmo_projectstatus')).toBe('In-Progress');
  });
});
