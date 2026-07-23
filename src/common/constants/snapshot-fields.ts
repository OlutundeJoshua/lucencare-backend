// Single source of truth: ConsentPurpose → patient fields included in sharedDataSnapshot

import { ConsentPurpose } from 'src/common/enums';

// Contact fields stripped from sharedDataSnapshot when directContactShared=false.
export const CONTACT_FIELDS = ['email', 'phone', 'contactEmail', 'contactPhone'];

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
