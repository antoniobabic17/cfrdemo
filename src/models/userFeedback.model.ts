/** pmo_userfeedback — User-submitted bug reports and enhancement suggestions. */
export interface UserFeedback {
  pmo_userfeedbackid: string;
  pmo_title: string;
  pmo_description?: string;
  pmo_feedbacktype?: number;
  pmo_status?: number;
  pmo_priority?: number;
  pmo_responsecomments?: string;
  pmo_sourcecontext?: string;
  /**
   * Date the feedback was marked Resolved. Auto-stamped by the app when status
   * transitions to Resolved; cleared when status moves to anything else. Not
   * user-editable in the UI.
   */
  pmo_dateresolved?: string | null;
  'pmo_feedbacktype@OData.Community.Display.V1.FormattedValue'?: string;
  'pmo_status@OData.Community.Display.V1.FormattedValue'?: string;
  'pmo_priority@OData.Community.Display.V1.FormattedValue'?: string;
  createdon?: string;
  '_createdby_value'?: string;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;
  /** ownerid - polymorphic systemuser/team. The "Assigned To" column. */
  '_ownerid_value'?: string;
  '_ownerid_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname'?: string;
  /** pmo_AssignedTo — dedicated systemuser lookup, distinct from ownerid. Blank
   *  on creation; set explicitly from the grid. This is the "Assigned To" column. */
  '_pmo_assignedto_value'?: string;
  '_pmo_assignedto_value@OData.Community.Display.V1.FormattedValue'?: string;
  statecode?: 0 | 1;
}

export interface UserFeedbackCreate {
  pmo_title: string;
  pmo_description?: string;
  pmo_feedbacktype: number;
  pmo_status?: number;
  pmo_priority?: number;
  pmo_sourcecontext?: string;
  /** Lookup to systemusers - bind value like '/systemusers(<guid>)'. */
  'ownerid@odata.bind'?: string;
  /** Assigned-To lookup bind, e.g. '/systemusers(<guid>)'. null clears it. */
  'pmo_AssignedTo@odata.bind'?: string | null;
}
