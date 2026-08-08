import { Organization } from '../entities/organization.entity';

/**
 * An organization row enriched with the display name of its staff user.
 * `organizations` stores `contactEmail` but no person name — the admin review
 * screens show who submitted the application, which lives on `users.name`.
 */
export interface OrganizationWithContact extends Organization {
  contactPerson?: string;
}
