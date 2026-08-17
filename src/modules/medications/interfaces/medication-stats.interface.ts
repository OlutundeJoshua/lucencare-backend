export interface MedicationStats {
  activeMeds: number;
  takenToday: number;
  dueToday: number;
  /** Doses whose grace period elapsed today with nothing logged. Disjoint from dueToday. */
  missedToday: number;
  adherenceStreakDays: number;
}
