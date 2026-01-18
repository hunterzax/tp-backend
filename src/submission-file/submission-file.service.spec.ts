import { Test, TestingModule } from '@nestjs/testing';
import { SubmissionFileService } from './submission-file.service';

describe('SubmissionFileService', () => {
  let service: SubmissionFileService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SubmissionFileService],
    }).compile();

    service = module.get<SubmissionFileService>(SubmissionFileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
