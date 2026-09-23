import { describe, it, expect, vi } from 'vitest';
import { compileFilter, applyOrderBy, applyQuery, DemoFilterParseError, type AnyResolver } from './demoFilter';

type Rec = Record<string, unknown>;

const rows: Rec[] = [
  { id: '1', statecode: 0, msdyn_subject: 'Alpha', _pmo_project_value: 'P1', pmo_status: 3, isdocument: false, createdon: '2026-01-01' },
  { id: '2', statecode: 0, msdyn_subject: 'Beta', _pmo_project_value: 'P1', pmo_status: 1, isdocument: true, createdon: '2026-02-01' },
  { id: '3', statecode: 1, msdyn_subject: 'Gamma', _pmo_project_value: 'P2', pmo_status: 3, isdocument: false, createdon: '2026-03-01' },
];

function ids(rs: Rec[]): string[] { return rs.map((r) => r.id as string); }

describe('compileFilter — comparisons', () => {
  it('eq on number', () => {
    expect(ids(rows.filter(compileFilter('pmo_status eq 3')))).toEqual(['1', '3']);
  });
  it('eq on quoted string (case-insensitive)', () => {
    expect(ids(rows.filter(compileFilter("msdyn_subject eq 'alpha'")))).toEqual(['1']);
  });
  it('eq on statecode 0', () => {
    expect(ids(rows.filter(compileFilter('statecode eq 0')))).toEqual(['1', '2']);
  });
  it('ne', () => {
    expect(ids(rows.filter(compileFilter('pmo_status ne 3')))).toEqual(['2']);
  });
  it('eq on boolean false', () => {
    expect(ids(rows.filter(compileFilter('isdocument eq false')))).toEqual(['1', '3']);
  });
  it('lookup value eq quoted guid', () => {
    expect(ids(rows.filter(compileFilter("_pmo_project_value eq 'P1'")))).toEqual(['1', '2']);
  });
  it('comparison ge/le on dates', () => {
    expect(ids(rows.filter(compileFilter("createdon ge 2026-02-01")))).toEqual(['2', '3']);
    expect(ids(rows.filter(compileFilter("createdon lt 2026-02-01")))).toEqual(['1']);
  });
});

describe('compileFilter — logic + parens', () => {
  it('and', () => {
    expect(ids(rows.filter(compileFilter("pmo_status eq 3 and statecode eq 0")))).toEqual(['1']);
  });
  it('or', () => {
    expect(ids(rows.filter(compileFilter("_pmo_project_value eq 'P1' or _pmo_project_value eq 'P2'")))).toEqual(['1', '2', '3']);
  });
  it('grouped or AND statecode (real intake shape)', () => {
    const f = "(_pmo_project_value eq 'P1' or _pmo_project_value eq 'P2') and statecode eq 0";
    expect(ids(rows.filter(compileFilter(f)))).toEqual(['1', '2']);
  });
});

describe('compileFilter — functions', () => {
  it('contains (case-insensitive)', () => {
    expect(ids(rows.filter(compileFilter("contains(msdyn_subject,'et')")))).toEqual(['2']);
  });
  it('startswith', () => {
    expect(ids(rows.filter(compileFilter("startswith(msdyn_subject,'Ga')")))).toEqual(['3']);
  });
  it('people-search nameFilter shape', () => {
    const people = [
      { id: 'a', firstname: 'Alex', lastname: 'Rivera', fullname: 'Alex Rivera', isdisabled: false },
      { id: 'b', firstname: 'Jordan', lastname: 'Kim', fullname: 'Jordan Kim', isdisabled: false },
    ];
    const f = "isdisabled eq false and (contains(lastname,'kim') or contains(firstname,'kim') or contains(fullname,'kim'))";
    expect(ids(people.filter(compileFilter(f)))).toEqual(['b']);
  });
});

describe('compileFilter — membership any()', () => {
  const users: Rec[] = [
    { systemuserid: 'u1', fullname: 'Alex' },
    { systemuserid: 'u2', fullname: 'Jordan' },
    { systemuserid: 'u3', fullname: 'Sam' },
  ];
  // u1 + u2 are on team T1; u3 on T2
  const membership: Record<string, string[]> = { u1: ['T1'], u2: ['T1'], u3: ['T2'] };
  const resolver: AnyResolver = (rec, navField) => {
    if (navField === 'teammembership_association') {
      return (membership[rec.systemuserid as string] ?? []).map((teamid) => ({ teamid }));
    }
    return [];
  };

  it('resolves team membership via any()', () => {
    const f = "teammembership_association/any(t: t/teamid eq 'T1')";
    const matched = users.filter(compileFilter(f, resolver)).map((u) => u.systemuserid);
    expect(matched).toEqual(['u1', 'u2']);
  });

  it('membership combined with base filter (real shape)', () => {
    const f = "isdisabled eq false and teammembership_association/any(t: t/teamid eq 'T2')";
    const usersWithFlag: Rec[] = users.map((u) => ({ ...u, isdisabled: false }));
    const matched = usersWithFlag.filter(compileFilter(f, resolver)).map((u) => u.systemuserid);
    expect(matched).toEqual(['u3']);
  });

  it('bare (unquoted) guid in any()', () => {
    const f = "teammembership_association/any(t: t/teamid eq T2)";
    const matched = users.filter(compileFilter(f, resolver)).map((u) => u.systemuserid);
    expect(matched).toEqual(['u3']);
  });
});

describe('applyOrderBy', () => {
  it('asc by date', () => {
    expect(ids(applyOrderBy(rows, 'createdon asc'))).toEqual(['1', '2', '3']);
  });
  it('desc by date', () => {
    expect(ids(applyOrderBy(rows, 'createdon desc'))).toEqual(['3', '2', '1']);
  });
  it('string localeCompare', () => {
    expect(ids(applyOrderBy(rows, 'msdyn_subject desc'))).toEqual(['3', '2', '1']);
  });
  it('does not mutate input', () => {
    const copy = [...rows];
    applyOrderBy(rows, 'createdon desc');
    expect(rows).toEqual(copy);
  });
});

describe('applyQuery — filter + orderby + top', () => {
  it('combines all three', () => {
    const out = applyQuery(rows, { $filter: 'statecode eq 0', $orderby: 'createdon desc', $top: 1 });
    expect(ids(out)).toEqual(['2']);
  });
  it('empty params returns all', () => {
    expect(ids(applyQuery(rows, undefined))).toEqual(['1', '2', '3']);
  });
  it('unparseable filter returns unfiltered (no throw) + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = applyQuery(rows, { $filter: 'this is (not valid odata' });
    expect(ids(out)).toEqual(['1', '2', '3']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('DemoFilterParseError', () => {
  it('throws on dangling operator', () => {
    expect(() => compileFilter('pmo_status eq')).toThrow(DemoFilterParseError);
  });
  it('throws on unterminated string', () => {
    expect(() => compileFilter("msdyn_subject eq 'oops")).toThrow(DemoFilterParseError);
  });
});
