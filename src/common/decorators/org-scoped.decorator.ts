import { SetMetadata } from '@nestjs/common';

export const ORG_SCOPED_KEY = 'orgScoped';

export const OrgScoped = () => SetMetadata(ORG_SCOPED_KEY, true);
