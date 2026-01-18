import { Test, TestingModule } from '@nestjs/testing';
import { AccountManageService } from './account-manage.service';

describe('AccountManageService', () => {
  let service: AccountManageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AccountManageService],
    }).compile();

    service = module.get<AccountManageService>(AccountManageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
