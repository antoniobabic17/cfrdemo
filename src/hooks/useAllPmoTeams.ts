import { useQuery } from '@tanstack/react-query';
import { usePmoTeamField } from '../providers/ConfigurationProvider';
import { fetchPmoTeams } from '../lib/pmoTeams';

interface PmoTeam {
  teamid: string;
  name: string;
}

export function useAllPmoTeams(opts?: { enabled?: boolean }): PmoTeam[] | undefined {
  const pmoTeamField = usePmoTeamField();
  const { data } = useQuery({
    queryKey: ['allPmoTeams', pmoTeamField],
    enabled: opts?.enabled === true,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchPmoTeams<PmoTeam>(pmoTeamField, ['teamid', 'name']),
  });
  return data;
}
