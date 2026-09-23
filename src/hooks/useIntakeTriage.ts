import { useQuery } from '@tanstack/react-query';
import { useProjectRequest, useProjectRequests } from './useProjectRequests';
import { listDocuments } from '../lib/sharePointClient';
import { listSystems } from '../api/systems.api';
import { keywordOverlapScore } from '../lib/intakeRoutingConfig';
import { REQUEST_STATUS } from '../lib/constants';
import { useConfig } from '../providers/ConfigurationProvider';
import type { ProjectRequest } from '../models/projectRequest.model';

export interface SimilarRequest {
  request: ProjectRequest;
  score: number;
}

function findSimilarRequests(
  current: ProjectRequest,
  all: ProjectRequest[],
  lookbackDays: number,
  minScore: number,
  topN: number,
): SimilarRequest[] {
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const searchText = [current.pmo_name, current.pmo_submissiontext].filter(Boolean).join(' ');

  return all
    .filter((r) => {
      if (r.pmo_projectrequestid === current.pmo_projectrequestid) return false;
      if (r.pmo_status === REQUEST_STATUS.Rejected || r.pmo_status === REQUEST_STATUS.Converted) return false;
      if (r.createdon && new Date(r.createdon).getTime() < cutoff) return false;
      return true;
    })
    .map((r) => {
      const candidateText = [r.pmo_name, r.pmo_submissiontext].filter(Boolean).join(' ');
      return { request: r, score: keywordOverlapScore(searchText, candidateText) };
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

export function useIntakeTriage(id: string) {
  const { config: { intakeTriageSimilarity } } = useConfig();
  const requestQuery = useProjectRequest(id);
  const allRequestsQuery = useProjectRequests();

  const attachmentsQuery = useQuery({
    queryKey: ['intakeAttachments', id],
    queryFn: () => listDocuments({ recordType: 'Intake Request', recordId: id }),
    enabled: !!id,
  });

  const systemsQuery = useQuery({
    queryKey: ['crSystems'],
    queryFn: listSystems,
    staleTime: Infinity,
  });

  const req = requestQuery.data;
  const allRequests = allRequestsQuery.data ?? [];

  const similarRequests: SimilarRequest[] = req
    ? findSimilarRequests(
        req,
        allRequests,
        intakeTriageSimilarity.lookbackDays,
        intakeTriageSimilarity.minScore,
        intakeTriageSimilarity.topN,
      )
    : [];

  const isLoading =
    requestQuery.isLoading || allRequestsQuery.isLoading || attachmentsQuery.isLoading;

  return {
    request: req,
    attachments: attachmentsQuery.data ?? [],
    similarRequests,
    systems: systemsQuery.data ?? [],
    isLoading,
    error: requestQuery.error ?? allRequestsQuery.error ?? attachmentsQuery.error,
  };
}

export function computeSimilarRequests(
  current: ProjectRequest,
  all: ProjectRequest[],
  lookbackDays = 90,
  minScore = 0.1,
  topN = 3,
): SimilarRequest[] {
  return findSimilarRequests(current, all, lookbackDays, minScore, topN);
}
