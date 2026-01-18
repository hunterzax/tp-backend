import { Module } from '@nestjs/common';
import { SummaryNominationReportService } from './summary-nomination-report.service';
import { SummaryNominationReportController } from './summary-nomination-report.controller';
import { GrpcModule } from 'src/grpc/grpc.module';
import { AccountManageService } from 'src/account-manage/account-manage.service';
import { QueryShipperNominationFileService } from 'src/query-shipper-nomination-file/query-shipper-nomination-file.service';
import { QualityEvaluationService } from 'src/quality-evaluation/quality-evaluation.service';
import { QualityPlanningService } from 'src/quality-planning/quality-planning.service';

@Module({
  imports: [
    // JwtModule.register({
    //   global: true,
    //   secret: jwtConstants.secret,
    //   signOptions: { expiresIn: '300000s' },
    // }),
    GrpcModule,
  ],
  controllers: [SummaryNominationReportController],
  providers: [
    SummaryNominationReportService,
    AccountManageService,
    QueryShipperNominationFileService,
    QualityEvaluationService,
    QualityPlanningService,
  ],
  exports: [SummaryNominationReportService],
})
export class SummaryNominationReportModule {}
