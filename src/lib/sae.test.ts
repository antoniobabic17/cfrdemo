import { describe, expect, it } from 'vitest';
import { readSae, resolveSaeDisplay, saeWritePayload, hasSae } from './sae';
import type { Project } from '../models/project.model';

const FV = '@OData.Community.Display.V1.FormattedValue';

describe('sae — direct-AAD helpers', () => {
  it('readSae prefers the AAD snapshot columns', () => {
    const p = {
      pmo_payerinitiatives_saeaadobjectid: 'aad-1',
      pmo_payerinitiatives_saedisplayname: 'Erenberg, Eileen',
      pmo_payerinitiatives_saeemail: 'eileen@coramhc.com',
    } as unknown as Project;
    expect(readSae(p)).toEqual({ aadId: 'aad-1', displayName: 'Erenberg, Eileen', email: 'eileen@coramhc.com' });
  });

  it('readSae falls back to the legacy systemuser lookup FormattedValue', () => {
    const p = {
      ['_pmo_payerinitiatives_strategicaccountexecutive_value' + FV]: 'Legacy Sam',
    } as unknown as Project;
    expect(readSae(p)).toEqual({ displayName: 'Legacy Sam' });
  });

  it('readSae returns {} when nothing is set', () => {
    expect(readSae({} as Project)).toEqual({});
  });

  it('resolveSaeDisplay prefers name, then email, then empty', () => {
    expect(resolveSaeDisplay({ pmo_payerinitiatives_saedisplayname: 'A B' } as unknown as Project)).toBe('A B');
    expect(resolveSaeDisplay({ pmo_payerinitiatives_saeemail: 'a@b.com' } as unknown as Project)).toBe('a@b.com');
    expect(resolveSaeDisplay({} as Project)).toBe('');
  });

  it('saeWritePayload writes the three columns', () => {
    expect(saeWritePayload({ aadId: 'aad-1', displayName: 'A B', email: 'a@b.com' })).toEqual({
      pmo_payerinitiatives_saeaadobjectid: 'aad-1',
      pmo_payerinitiatives_saedisplayname: 'A B',
      pmo_payerinitiatives_saeemail: 'a@b.com',
    });
  });

  it('saeWritePayload nulls all three columns to clear', () => {
    expect(saeWritePayload(undefined)).toEqual({
      pmo_payerinitiatives_saeaadobjectid: null,
      pmo_payerinitiatives_saedisplayname: null,
      pmo_payerinitiatives_saeemail: null,
    });
    expect(saeWritePayload({})).toEqual({
      pmo_payerinitiatives_saeaadobjectid: null,
      pmo_payerinitiatives_saedisplayname: null,
      pmo_payerinitiatives_saeemail: null,
    });
  });

  it('hasSae detects any identifying field', () => {
    expect(hasSae({ aadId: 'x' })).toBe(true);
    expect(hasSae({ email: 'a@b.com' })).toBe(true);
    expect(hasSae({})).toBe(false);
    expect(hasSae(undefined)).toBe(false);
  });
});
