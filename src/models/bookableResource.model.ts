export interface BookableResource {
  bookableresourceid: string;
  name: string;
  resourcetype?: number; // 1=Generic 2=Contact 3=User 4=Equipment 5=Account 6=Crew
  statecode?: number;
  /** systemuserid the resource represents (only set for User-type resources). */
  '_userid_value'?: string;
}
