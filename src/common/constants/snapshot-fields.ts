// Single source of truth: ConsentPurpose → patient fields included in sharedDataSnapshot

import { ConsentPurpose } from 'src/common/enums';

export const SNAPSHOT_FIELDS: Record<ConsentPurpose, string[]> = {
  [ConsentPurpose.NGO_FUNDING]: ['name', 'conditionTags', 'address', 'directContactShared'],
  [ConsentPurpose.HMO_CARE]: [
    'name',
    'conditionTags',
    'address',
    'membershipNumber',
    'medicationList',
  ],
  [ConsentPurpose.CLINICAL_RESEARCH_RECRUITMENT]: [
    'name',
    'conditionTags',
    'address',
    'directContactShared',
    'medicationList',
  ],
};
