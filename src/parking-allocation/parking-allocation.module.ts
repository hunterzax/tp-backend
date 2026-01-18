import { forwardRef, Module } from '@nestjs/common';
import { ParkingAllocationService } from './parking-allocation.service';
import { ParkingAllocationController } from './parking-allocation.controller';
import { GrpcModule } from 'src/grpc/grpc.module';
import { BalancingService } from 'src/balancing/balancing.service';
import { CapacityV2Service } from 'src/capacity-v2/capacity-v2.service';
import { ExportFilesService } from 'src/export-files/export-files.service';
import { UploadTemplateForShipperService } from 'src/upload-template-for-shipper/upload-template-for-shipper.service';
import { CapacityMiddleService } from 'src/capacity-v2/capacity-middle.service';
import { CapacityPublicationService } from 'src/capacity-publication/capacity-publication.service';
import { ReleaseCapacitySubmissionService } from 'src/release-capacity-submission/release-capacity-submission.service';
import { UseItOrLoseItService } from 'src/use-it-or-lose-it/use-it-or-lose-it.service';
import { PathManagementService } from 'src/path-management/path-management.service';
import { MeteringManagementService } from 'src/metering-management/metering-management.service';
import { QualityEvaluationService } from 'src/quality-evaluation/quality-evaluation.service';
import { QualityPlanningService } from 'src/quality-planning/quality-planning.service';
import { AllocationModeService } from 'src/allocation-mode/allocation-mode.service';
import { UploadTemplateForShipperModule } from 'src/upload-template-for-shipper/upload-template-for-shipper.module';
import { ExportFilesModule } from 'src/export-files/export-files.module';
import { AllocationService } from 'src/allocation/allocation.service';
import { SummaryNominationReportService } from 'src/summary-nomination-report/summary-nomination-report.service';
import { NominationDashboardService } from 'src/nomination-dashboard/nomination-dashboard.service';
import { QueryShipperNominationFileService } from 'src/query-shipper-nomination-file/query-shipper-nomination-file.service';
import { DailyAdjustmentService } from 'src/daily-adjustment/daily-adjustment.service';

@Module({
  imports: [
    // JwtModule.register({
    //   global: true,
    //   secret: jwtConstants.secret,
    //   signOptions: { expiresIn: '300000s' },
    // }),
    GrpcModule,
    UploadTemplateForShipperModule,
    forwardRef(() => ExportFilesModule),
  ],
  controllers: [ParkingAllocationController],
  providers: [
    ParkingAllocationService,
    BalancingService,
    CapacityV2Service,
    CapacityMiddleService,
  ],
  exports: [ParkingAllocationService],
})
export class ParkingAllocationModule {}
