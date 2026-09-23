import { useCallback, useEffect, useRef } from 'react';
import { SearchableSelect } from './SearchableSelect';
import { usePeopleSearch, type Person } from '../../lib/peopleSearch';
import type { SaeValue } from '../../lib/sae';

/**
 * Strategic Account Executive picker. Searches people through the unified
 * people-search service (systemuser or Office 365 directory, per the
 * pmo.people_source admin setting) and emits a {@link SaeValue} (AAD object id
 * + display name + email snapshot). See
 * docs/planning/sae-systemuser-to-aad-transition-plan.md.
 *
 * Wraps the shared {@link SearchableSelect} (value=string). The bound string is
 * the picker's opaque Person.id; a session cache maps id -> Person so onChange
 * can rebuild the SaeValue (preferring the AAD object id) and resolveLabel can
 * render without a round-trip.
 */
interface SaePickerProps {
  value: SaeValue | undefined;
  onChange: (sae: SaeValue | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
}

const optionLabel = (displayName: string, email?: string) =>
  email ? `${displayName} (${email})` : displayName;

export function SaePicker({ value, onChange, placeholder, disabled }: SaePickerProps) {
  const { searchPeople, resolvePerson } = usePeopleSearch();
  // Person.id -> Person seen this session.
  const cache = useRef<Map<string, Person>>(new Map());

  // The bound value: prefer the stored AAD id (o365 ids ARE the aadId; in
  // systemuser mode we still key the picker on aadId when we have it so a
  // stored snapshot round-trips). Falls back to email/'' when no id is stored.
  const boundId = value?.aadId ?? '';

  // Seed the cache so a stored SAE renders immediately without a lookup.
  useEffect(() => {
    if (boundId && !cache.current.has(boundId)) {
      cache.current.set(boundId, {
        id: boundId,
        aadId: value?.aadId,
        displayName: value?.displayName ?? value?.email ?? boundId,
        email: value?.email,
      });
    }
  }, [boundId, value]);

  const onSearch = useCallback(async (query: string) => {
    const people = await searchPeople(query);
    return people.map((p) => {
      // Key the cache + option by aadId when present so the stored SaeValue is
      // always AAD-centric (the SAE column stores the AAD object id).
      const key = p.aadId ?? p.id;
      cache.current.set(key, p);
      return { value: key, label: optionLabel(p.displayName, p.email) };
    });
  }, [searchPeople]);

  const resolveLabel = useCallback(async (id: string): Promise<string> => {
    const cached = cache.current.get(id);
    if (cached) return optionLabel(cached.displayName, cached.email);
    const person = await resolvePerson(id);
    if (person) {
      const key = person.aadId ?? person.id;
      cache.current.set(key, person);
      return optionLabel(person.displayName, person.email);
    }
    return value?.displayName || value?.email || id;
  }, [resolvePerson, value]);

  const handleChange = useCallback((id: string) => {
    if (!id) { onChange(undefined); return; }
    const p = cache.current.get(id);
    onChange({
      aadId: p?.aadId ?? id,
      displayName: p?.displayName,
      email: p?.email,
    });
  }, [onChange]);

  return (
    <SearchableSelect
      value={boundId}
      onChange={handleChange}
      onSearch={onSearch}
      resolveLabel={resolveLabel}
      placeholder={placeholder ?? 'Type 2+ characters to search\u2026'}
      disabled={disabled}
    />
  );
}
