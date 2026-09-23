import { describe, it, expect } from 'vitest';
import { parseTaskPayload, serializeTaskPayload } from './taskTemplate.model';

describe('taskTemplate payload helpers', () => {
  it('parse: unset/blank/malformed => []', () => {
    expect(parseTaskPayload(undefined)).toEqual([]);
    expect(parseTaskPayload(null)).toEqual([]);
    expect(parseTaskPayload('')).toEqual([]);
    expect(parseTaskPayload('{not json')).toEqual([]);
    expect(parseTaskPayload('{"a":1}')).toEqual([]); // not an array
  });

  it('parse: keeps subject + isMilestone + duration, drops junk + empty subjects', () => {
    const out = parseTaskPayload(JSON.stringify([
      { subject: 'Kickoff', duration: 8 },
      { subject: 'Sign-off', isMilestone: true },
      { subject: '   ' },                 // dropped (empty)
      { notASubject: 'x' },               // dropped (no subject)
      42,                                  // dropped (not object)
    ]));
    expect(out).toEqual([
      { subject: 'Kickoff', isMilestone: false, duration: 8 },
      { subject: 'Sign-off', isMilestone: true, duration: undefined },
    ]);
  });

  it('serialize: trims, drops empty, omits falsey milestone + missing duration', () => {
    const json = serializeTaskPayload([
      { subject: '  Plan  ', duration: 16 },
      { subject: 'Go-live', isMilestone: true },
      { subject: '   ', isMilestone: true }, // dropped
    ]);
    expect(JSON.parse(json)).toEqual([
      { subject: 'Plan', duration: 16 },
      { subject: 'Go-live', isMilestone: true },
    ]);
  });

  it('round-trips a normal template', () => {
    const tasks = [
      { subject: 'Requirements', isMilestone: false, duration: 16 },
      { subject: 'Approved', isMilestone: true, duration: undefined },
    ];
    expect(parseTaskPayload(serializeTaskPayload(tasks))).toEqual(tasks);
  });
});
