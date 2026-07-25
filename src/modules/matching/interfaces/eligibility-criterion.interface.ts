export interface EligibilityCriterion {
  field: string;
  operator: 'eq' | 'in' | 'gte' | 'lte' | 'contains';
  value: unknown;
}
