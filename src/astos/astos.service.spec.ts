import { Test, TestingModule } from '@nestjs/testing';
import { AstosService } from './astos.service';

describe('AstosService', () => {
  let service: AstosService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AstosService],
    }).compile();

    service = module.get<AstosService>(AstosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
