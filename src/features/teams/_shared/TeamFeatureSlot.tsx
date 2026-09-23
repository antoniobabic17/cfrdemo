/**
 * TeamFeatureSlot — host-page extension point.
 *
 * Renders zero or more components contributed by active team feature packs
 * for a given slot id. Host pages drop one of these where they want
 * extensions to appear (see IntakeDetailPage for the canonical example).
 *
 * Slot props are passed through verbatim. The host owns the contract for
 * each slot id; pack authors cast `unknown` to the slot's documented props.
 */
import { Fragment } from 'react';
import { useActiveTeamFeatures } from './useActiveTeamFeatures';
import type { SlotProps, TeamFeatureSlotId } from './types';

interface Props {
  slot: TeamFeatureSlotId;
  /** Forwarded to every component contributed to this slot. */
  [key: string]: unknown;
}

export function TeamFeatureSlot(props: Props) {
  const { slot, ...rest } = props;
  const active = useActiveTeamFeatures();
  const Components = active
    .map((m) => m.slots?.[slot])
    .filter((c): c is NonNullable<typeof c> => !!c);
  if (Components.length === 0) return null;
  return (
    <>
      {Components.map((Comp, i) => (
        <Fragment key={i}>
          <Comp {...(rest as SlotProps)} />
        </Fragment>
      ))}
    </>
  );
}
