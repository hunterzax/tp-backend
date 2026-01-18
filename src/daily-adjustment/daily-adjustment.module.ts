import { Module } from '@nestjs/common';
import { DailyAdjustmentService } from './daily-adjustment.service';
import { DailyAdjustmentController } from './daily-adjustment.controller';
import { GrpcModule } from 'src/grpc/grpc.module';
import { AccountManageService } from 'src/account-manage/account-manage.service';
import { AstosService } from 'src/astos/astos.service';
import { AstosModule } from 'src/astos/astos.module';
import { AstosRepository } from 'src/astos/astos.repository';
import { AstosUtils } from 'src/astos/astos.utils';

@Module({
  imports: [
    // JwtModule.register({
    //   global: true,
    //   secret: jwtConstants.secret,
    //   signOptions: { expiresIn: '300000s' },
    // }),
    GrpcModule,
    AstosModule
  ],
  controllers: [DailyAdjustmentController],
  providers: [DailyAdjustmentService, AccountManageService, AstosService, AstosRepository, AstosUtils],
  exports:[DailyAdjustmentService]
})
export class DailyAdjustmentModule {}
