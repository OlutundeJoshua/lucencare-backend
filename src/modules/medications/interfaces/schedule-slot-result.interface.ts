import { ScheduledDoseResult } from './scheduled-dose-result.interface';

export interface ScheduleSlotResult {
  time: string;
  doses: ScheduledDoseResult[];
}
