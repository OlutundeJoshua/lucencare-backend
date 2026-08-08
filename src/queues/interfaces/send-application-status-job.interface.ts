import { ApplicantRole, ApplicationEmailEvent } from 'src/common/enums';

/**
 * One payload for all three application lifecycle emails. The processor composes the
 * message from `role` and `event`, so producers only supply the facts.
 */
export interface SendApplicationStatusJob {
  to: string;
  /** Display name for the greeting — an organisation name or a person's name. */
  applicantName: string;
  role: ApplicantRole;
  event: ApplicationEmailEvent;
  /** Only meaningful on REJECTED. Omitted rather than empty when none was given. */
  reason?: string;
}
