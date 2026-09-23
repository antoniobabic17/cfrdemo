import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { BookableResource } from '../models/bookableResource.model';

const SELECT = ['bookableresourceid', 'name', 'resourcetype', '_userid_value'];

export async function listBookableResources(): Promise<BookableResource[]> {
  return dv.list<BookableResource>(ENTITY_SETS.bookableResource, {
    $select: SELECT,
    $filter: 'statecode eq 0',
    $orderby: 'name asc',
    $top: 300,
  });
}
