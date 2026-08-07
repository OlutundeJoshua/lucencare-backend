import { Program } from '../entities/program.entity';
import { ProgramLifecycle } from './program-lifecycle.type';

/**
 * A programme as an NGO sees it: the stored row plus its derived lifecycle state.
 *
 * `status` remains the platform review state; `lifecycle` is the operational one.
 * Both are returned so the UI can distinguish "awaiting platform approval" from
 * "approved but full".
 */
export interface ProgramView extends Program {
  lifecycle: ProgramLifecycle;
  slotsAvailable: number;
}
