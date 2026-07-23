import { RefillUrgency } from './refill-urgency.type';

export interface RefillAlertResult {
  medicationId: string;
  name: string;
  pillsLeft: number;
  refillDateISO: string;
  urgency: RefillUrgency;
}
