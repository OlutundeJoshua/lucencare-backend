import { RefillUrgency } from './refill-urgency.type';

export interface RefillAlertTarget {
  userId: string;
  medicationId: string;
  medicationName: string;
  urgency: RefillUrgency;
}
