import { useQuery } from '@tanstack/react-query';
import { listBookableResources } from '../api/bookableResources.api';

export function useBookableResources() {
  return useQuery({
    queryKey: ['bookableResources'],
    queryFn: listBookableResources,
    staleTime: 10 * 60 * 1000, // 10 min — bookable resource list changes rarely
  });
}
