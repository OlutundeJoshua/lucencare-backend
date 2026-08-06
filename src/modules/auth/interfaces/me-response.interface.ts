import { BenefactorApplication } from 'src/modules/applications/entities/benefactor-application.entity';
import { ProfessionalApplication } from 'src/modules/applications/entities/professional-application.entity';
import { Organization } from 'src/modules/organizations/entities/organization.entity';

/**
 * Live account state for the authenticated user.
 *
 * The access token is stateless and carries no status, so a client holding a
 * token issued before an admin approval would otherwise never learn it was
 * approved. This endpoint is the single source of truth the frontend guards,
 * pending screens and profile pages read from.
 */
export interface MeResponse {
  id: string;
  name?: string;
  email: string;
  /** Short-form client role (`ngo`, `hmo`, `admin`, …) — not the internal UserRole. */
  role: string;
  status: string;
  orgId?: string;
  /** Present for professional and benefactor users who have completed onboarding. */
  application?: ProfessionalApplication | BenefactorApplication;
  /** Present for NGO and HMO staff users. */
  organization?: Organization;
}
