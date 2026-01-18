import { Module } from '@nestjs/common';
import { NominationDashboardService } from './nomination-dashboard.service';
import { NominationDashboardController } from './nomination-dashboard.controller';
import { GrpcModule } from 'src/grpc/grpc.module';
import { AccountManageService } from 'src/account-manage/account-manage.service';
import { QualityEvaluationService } from 'src/quality-evaluation/quality-evaluation.service';
import { SummaryNominationReportService } from 'src/summary-nomination-report/summary-nomination-report.service';
import { QualityPlanningService } from 'src/quality-planning/quality-planning.service';
import { QueryShipperNominationFileService } from 'src/query-shipper-nomination-file/query-shipper-nomination-file.service';

@Module({
  imports: [
    // JwtModule.register({
    //   global: true,
    //   secret: jwtConstants.secret,
    //   signOptions: { expiresIn: '300000s' },
    // }),
    GrpcModule,
  ],
  controllers: [NominationDashboardController],
  providers: [NominationDashboardService, AccountManageService, QualityEvaluationService, SummaryNominationReportService, QualityPlanningService, QueryShipperNominationFileService],
  exports: [NominationDashboardService],
})
export class NominationDashboardModule { }
