/**
 * Application rows carry only `userId`. The admin review screens need to show
 * who applied, so list responses are enriched with the applicant's identity
 * from `users`. Professional applications have no name column of their own.
 */
export interface ApplicationWithUser {
  email: string;
  name?: string;
}
