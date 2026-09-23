export interface ProjectMeetingLink {
  pmo_projectmeetinglinkid: string;
  pmo_name: string;
  pmo_meetingsubject: string;
  pmo_meetingdatetime: string;
  pmo_meetingurl?: string;
  pmo_notes?: string;
  pmo_grapheventid?: string;
  pmo_attendeesjson?: string;
  pmo_duration?: number;
  pmo_location?: string;
  pmo_summary?: string;
  pmo_agendanotes?: string;
  statecode?: 0 | 1;
  createdon?: string;
  '_pmo_project_value'?: string;
  '_pmo_program_value'?: string;
}

export type ProjectMeetingLinkCreate = {
  pmo_name: string;
  pmo_meetingsubject: string;
  pmo_meetingdatetime: string;
  pmo_meetingurl?: string;
  pmo_notes?: string;
  pmo_grapheventid?: string;
  pmo_attendeesjson?: string;
  pmo_duration?: number;
  pmo_location?: string;
  pmo_agendanotes?: string;
  'pmo_Project@odata.bind'?: string;
  'pmo_Program@odata.bind'?: string;
};

export type ProjectMeetingLinkUpdate = Partial<
  Pick<ProjectMeetingLink, 'pmo_meetingsubject' | 'pmo_meetingdatetime' | 'pmo_meetingurl' | 'pmo_notes' | 'pmo_grapheventid' | 'pmo_attendeesjson' | 'pmo_duration' | 'pmo_location' | 'pmo_summary' | 'pmo_agendanotes'>
>;
