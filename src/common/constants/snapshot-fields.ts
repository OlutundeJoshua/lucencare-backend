// TODO: Implement — see docs/modules/consents.md
// Single source of truth: ConsentPurpose → patient fields included in sharedDataSnapshot

import { ConsentPurpose } from 'src/common/enums';

export const SNAPSHOT_FIELDS: Record<ConsentPurpose, string[]> = {
  [ConsentPurpose.NGO_FUNDING]: ['name', 'conditionTags', 'locationState', 'directContactShared'],
  [ConsentPurpose.HMO_CARE]: [
    'name',
    'conditionTags',
    'locationState',
    'membershipNumber',
    'medicationList',
  ],
  [ConsentPurpose.CLINICAL_RESEARCH_RECRUITMENT]: [
    'name',
    'conditionTags',
    'locationState',
    'directContactShared',
    'medicationList',
  ],
};
