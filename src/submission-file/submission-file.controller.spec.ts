import { Test, TestingModule } from '@nestjs/testing';
import { SubmissionFileController } from './submission-file.controller';
import { SubmissionFileService } from './submission-file.service';

describe('SubmissionFileController', () => {
  let controller: SubmissionFileController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubmissionFileController],
      providers: [SubmissionFileService],
    }).compile();

    controller = module.get<SubmissionFileController>(SubmissionFileController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
