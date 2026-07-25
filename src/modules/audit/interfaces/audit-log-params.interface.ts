import { AuditAction } from 'src/common/enums';

export interface AuditLogParams {
  actorId: string;
  action: AuditAction;
  resourceId: string;
  resourceType: string;
  metadata?: object;
}
