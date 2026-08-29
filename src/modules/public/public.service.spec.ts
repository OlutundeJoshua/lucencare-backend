import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ProgramStatus } from 'src/common/enums';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { Program } from 'src/modules/programs/entities/program.entity';

import { PublicService } from './public.service';

const NOW = 1_800_000_000_000;
const TTL_MS = 5 * 60 * 1000;

describe('PublicService', () => {
  let service: PublicService;
  let patientRepo: { count: jest.Mock };
  let programRepo: { count: jest.Mock };

  beforeEach(async () => {
    patientRepo = { count: jest.fn().mockResolvedValue(12) };
    programRepo = { count: jest.fn().mockResolvedValue(4) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicService,
        { provide: getRepositoryToken(Patient), useValue: patientRepo },
        { provide: getRepositoryToken(Program), useValue: programRepo },
      ],
    }).compile();

    service = module.get<PublicService>(PublicService);
  });

  describe('getStats', () => {
    it('returns the patient and approved-programme totals', async () => {
      await expect(service.getStats(NOW)).resolves.toEqual({ patients: 12, ngoPrograms: 4 });
    });

    // A draft or pending programme is not something the platform has delivered,
    // so advertising it on the landing page would overstate the number.
    it('counts only approved programmes', async () => {
      await service.getStats(NOW);

      expect(programRepo.count).toHaveBeenCalledWith({
        where: { status: ProgramStatus.APPROVED },
      });
    });

    it('serves a second call inside the TTL from cache', async () => {
      await service.getStats(NOW);
      await service.getStats(NOW + TTL_MS - 1);

      expect(patientRepo.count).toHaveBeenCalledTimes(1);
      expect(programRepo.count).toHaveBeenCalledTimes(1);
    });

    // The whole point of the cache: an unauthenticated page cannot be allowed to
    // turn visitor volume into COUNT(*) volume.
    it('recomputes once the TTL has elapsed', async () => {
      await service.getStats(NOW);
      patientRepo.count.mockResolvedValue(13);

      await expect(service.getStats(NOW + TTL_MS)).resolves.toEqual({
        patients: 13,
        ngoPrograms: 4,
      });
      expect(patientRepo.count).toHaveBeenCalledTimes(2);
    });

    it('does not cache a failed lookup', async () => {
      patientRepo.count.mockRejectedValueOnce(new Error('db down'));

      await expect(service.getStats(NOW)).rejects.toThrow('db down');

      patientRepo.count.mockResolvedValue(12);
      await expect(service.getStats(NOW)).resolves.toEqual({ patients: 12, ngoPrograms: 4 });
    });
  });
});
