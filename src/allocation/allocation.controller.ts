import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpException,
  HttpStatus,
  Put,
  UseGuards,
  Req,
  HttpCode,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  OnModuleInit,
  Inject,
} from '@nestjs/common';
import { AuthGuard } from 'src/auth/auth.guard';
import { JwtService } from '@nestjs/jwt';
import { AccountManageService } from 'src/account-manage/account-manage.service';

import { AllocationService } from './allocation.service';
import { CapacityService } from 'src/capacity/capacity.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { FileUploadService } from 'src/grpc/file-service.service';
import { Observable, ReplaySubject, Subject } from 'rxjs';
import { ClientGrpc, GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
import { uploadFilsTemp } from 'src/common/utils/uploadFileIn';
import { MeteringManagementService } from 'src/metering-management/metering-management.service';

interface MulterFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

interface ExampleService {
  getData(data: { param: string }): Observable<{ data: string }>;
  sendData?(data: { param: string }): Observable<{ data: string }>;
}

@Controller('allocation')
export class AllocationController implements OnModuleInit {

  private exampleService: ExampleService;
  constructor(
    private jwtService: JwtService,
    private readonly allocationService: AllocationService,
    private readonly accountManageService: AccountManageService,
    private readonly fileUploadService: FileUploadService,
    private readonly meteringManagementService: MeteringManagementService,
    @Inject('EXAMPLE_SERVICE') private readonly client: ClientGrpc,
  ) { }

  onModuleInit() {
    this.exampleService = this.client.getService<ExampleService>('ExampleService');
  }

  private safeParseJSON(data: any, defaultValue: any = null) {
    if (!data) return defaultValue;
    try {
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
      console.error('JSON parse error:', e);
      return defaultValue;
    }
  }

  @GrpcMethod('ExampleService')
  sendData(data: { param: string }): { data: string } {
    if (data?.param == 'execute allo&bal') {
      const executeData = this.allocationService.executeData(
        null,
        null,
      );
      return { data: 'Executed' };
    }
    else if (data?.param?.includes('update_execute_status')) {
      const payload = this.safeParseJSON(data.param.replace('update_execute_status:', ''));
      const updateExecuteStatus = this.meteringManagementService.updateExecuteStatus(
        payload,
        null,
      );
      return { data: 'Update Execute Status' };
    }
    else {
      return { data: 'Failed. Please try again.' };
    }
  }

  @GrpcStreamMethod('ExampleService')
  getData(data: { param: string }): { data: string } {
    return { data: 'Failed. Please try again.' };
  }

  // @UseGuards(AuthGuard)
  @Get('allocation-status')
  allocationStatusMaster() {
    return this.allocationService.allocationStatusMaster();
  }

  @UseGuards(AuthGuard)
  @Get('allocation-review')
  allocationReview(@Query() query: any, @Req() req: any) {
    const { start_date, end_date, skip, limit } = query;

    // return this.allocationService.allocationManagement(query, req?.user?.sub);
    // return this.allocationService.allocationManagementNewReview(
    return this.allocationService.allocationManagementNew(
      query,
      req?.user?.sub,
    );
  }

  // {{API_URL}}/master/allocation/allocation-management?start_date=2025-01-01&end_date=2025-02-28&skip=100&limit=100
  @UseGuards(AuthGuard)
  @Get('allocation-management')
  allocationManagement(@Query() query: any, @Req() req: any) {
    const { start_date, end_date, skip, limit } = query;

    return this.allocationService.allocationManagementNew(
      query,
      req?.user?.sub,
    );
  }

  @UseGuards(AuthGuard)
  @Patch('shipper-allocation-review/:id')
  async shipperAllocationReview(
    @Body() body: any,
    @Param('id') id: any,
    @Req() req: any,
  ) {
    const { shipper_allocation_review, comment, row_data } = body;

    if (!id || !shipper_allocation_review || !row_data) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const shipperAllocationReview =
      await this.allocationService.shipperAllocationReview(
        id,
        body,
        req?.user?.sub,
      );
    const createByOnce = await this.allocationService.createByOnce(
      req?.user?.sub,
    );

    // const his = await this.allocationService.findOnce(id);
    // create/update date

    //  "systemAllocation": 43805.7405,
    // "intradaySystem": 43805.741,
    // "previousAllocationTPAforReview": 43805.7405,

    const { id: ids, ...TempDatas } = shipperAllocationReview;

    await this.allocationService.writeReq(
      req,
      `allocation-review`,
      'shipper-allocation-review',
      {
        id: Number(id),
        create: createByOnce,
        // ...body,
        shipper_allocation_review: body?.shipper_allocation_review || null,
        comment: body?.comment || null,
        systemAllocation: body?.row_data?.systemAllocation || null,
        intradaySystem: body?.row_data?.intradaySystem || null,
        previousAllocationTPAforReview:
          body?.row_data?.previousAllocationTPAforReview || null,
        ...TempDatas,
        // "allocation_status": {
        //     "id": 2,
        //     "name": "Shipper Reviewed",
        //     "color": "#D0E5FD"
        // },
      },
    );

    return shipperAllocationReview;
  }

  @UseGuards(AuthGuard)
  @Patch('allocation-manage-change-status')
  async allocationManageChangeStatus(
    @Body() body: any,
    @Param('id') id: any,
    @Req() req: any,
  ) {
    const { status, comment, rowArray } = body;

    if (!status || !rowArray) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const allocationManageChangeStatus =
      await this.allocationService.allocationManageChangeStatus(
        body,
        req?.user?.sub,
      );
    const createByOnce = await this.allocationService.createByOnce(
      req?.user?.sub,
    );
    // const his = await this.allocationService.findOnce(id);
    // create/update date

    // req?.user?.sub

    const findStatus = await this.allocationStatusMaster()
    const fn = findStatus?.find((f: any) => f?.id === status)

    for (let i = 0; i < rowArray.length; i++) {
      await this.allocationService.writeReq(
        req,
        `allocation-manage`,
        'change-status',
        { status: fn?.id, comment, create: createByOnce, ...rowArray[i], allocation_status: fn },
      );
      await this.allocationService.writeReq(
        req,
        `allocation-review`,
        'shipper-allocation-review',
        { status: fn?.id, comment, create: createByOnce, ...rowArray[i], allocation_status: fn },
      );
    }

    return allocationManageChangeStatus;
  }

  @UseGuards(AuthGuard)
  @Patch('allocation-manage-change-status-validate')
  async allocationManageChangeStatusValidate(
    @Body() body: any,
    @Param('id') id: any,
    @Req() req: any,
  ) {
    const { status, comment, rowArray } = body;

    if (!status || !rowArray) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const changeStatusValidate =
      await this.allocationService.allocationManageChangeStatusValidate(
        body,
        req?.user?.sub,
      );

    return changeStatusValidate;
  }

  @UseGuards(AuthGuard)
  @Post('execute-data')
  async executeData(@Body() body: any, @Req() req: any) {
    const { } = body;

    const executeData = await this.allocationService.executeData(
      body,
      req?.user?.sub,
    );

    return executeData;
  }

  // versionExe
  @UseGuards(AuthGuard)
  @Get('version-exe')
  versionExe(@Query() query: any, @Req() req: any) {
    const { start_date, end_date, skip, limit } = query;

    return this.allocationService.versionExe(query, req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Get('allocation-query')
  allocationQuery(@Query() query: any, @Req() req: any) {
    const { start_date, end_date, skip, limit } = query;

    // return this.allocationService.allocationQuery(query, req?.user?.sub);
    return this.allocationService.allocationQueryNew(query, req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Get('allocation-query-version')
  allocationQueryVersion(@Query() query: any, @Req() req: any) {
    const { start_date, end_date, skip, limit } = query;

    return this.allocationService.allocationQueryVersion(query, req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Get('allocation-report')
  allocationReport(@Query() query: any, @Req() req: any) {
    const { start_date, end_date, skip, limit } = query;

    return this.allocationService.allocationReport(query, req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Get('allocation-report-view')
  allocationReportView(@Query() query: any, @Req() req: any) {
    const { start_date, end_date, skip, limit } = query;

    return this.allocationService.allocationReportView(query, req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Get('publication-center')
  publicationCenter(@Query() query: any, @Req() req: any) {
    return this.allocationService.publicationCenter(query, req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Post('publication-center')
  async publicationCenterGen(@Body() body: any, @Req() req: any) {
    const { execute_timestamp, gas_day } = body;

    if (!execute_timestamp || !gas_day) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const publicationCenterGen =
      await this.allocationService.publicationCenterGen(body, req?.user?.sub);
    // const createByOnce = await this.allocationService.createByOnce(req?.user?.sub);

    // const his = await this.allocationService.findOnce(id);
    // create/update date
    // await this.allocationService.writeReq(
    //   req,
    //   `allocation-review`,
    //   'shipper-allocation-review',
    //   { id: Number(id),  create:createByOnce, ...body },
    // );

    return publicationCenterGen;
  }

  // template
  // http://10.100.101.15:8010/master/allocation/gen-excel-template-url?contract_code_name=2016-CLF-001&shipper_code=NGP-S01-001
  @Get('gen-excel-template-url')
  async genExcelTemplateUrl(
    @Res() res: any,
    @Req() req: any,
    @Query() query: any,
  ) {
    const { contract_code_name, shipper_code } = query;

    const { excelBuffer, nameFile } =
      await this.allocationService.genExcelTemplate({
        contract_code_name,
        shipper_code,
      });

    // res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // res.setHeader('Content-Disposition', `attachment; filename=${nameFile}.xlsx`);
    // res.send(excelBuffer);

    // ✅ 2. อัปโหลดไฟล์ไปยัง API อัปโหลด
    const uploadResponse = await uploadFilsTemp({
      buffer: excelBuffer,
      originalname: `${nameFile}.xlsx`,
    });

    return res.json(uploadResponse);
  }

  // allocation-review-import
  @UseGuards(AuthGuard)
  @Post('allocation-review-import')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: MulterFile,
    @Req() req: any,
    // @Body('comment') comment: string,
    // @Body('tabType') tabType: string,
    @Query() query: any,
  ) {
    if (
      file.mimetype !==
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
      file.mimetype !== 'application/vnd.ms-excel'
    ) {
      throw new BadRequestException(
        'Only Excel files (xlsx or xls) are allowed.',
      );
    }

    if (file.buffer.length === 0) {
      throw new Error('Buffer is empty before sending to gRPC');
    }
    // ส่ง buffer ไปยัง gRPC
    const grpcTransform = await this.fileUploadService.uploadFileTempMultiSheet(
      file.buffer,
    );

    if (!file) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const { ignore } = query;

    const uploadFile = await this.allocationService.uploadFile(
      grpcTransform,
      file,
      req?.user?.sub,
      req,
      ignore?.trim()?.toLowerCase() === 'true'
    );

    return uploadFile;
  }


  @UseGuards(AuthGuard)
  @Get('monthly-report-version-exe')
  allocationMonthlyVersionExe(@Query() query: any, @Req() req: any) {
    const {
      shipperId,
      month,
      year
    } = query;

    if (!month || !year) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.allocationService.allocationMonthlyVersionExe(query, req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Get('allocation-monthly-report')
  allocationMonthlyReport(@Query() query: any, @Req() req: any) {
    const {
      start_date,
      end_date,
      skip,
      limit,
      shipperId,
      month,
      year,
      version,
      contractCode,
    } = query;

    if (!month || !year) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.allocationService.allocationMonthlyReport(
      query,
      req?.user?.sub,
    );
  }

  @UseGuards(AuthGuard)
  @Get('allocation-monthly-report-approved')
  allocationMonthlyReportApproved(@Query() query: any, @Req() req: any) {
    const {
      start_date,
      end_date,
      skip,
      limit,
      shipperId,
      month,
      year,
      version,
      contractCode,
    } = query;

    if (!month || !year) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.allocationService.allocationMonthlyReportApproved(
      query,
      req?.user?.sub,
    );
  }

  @UseGuards(AuthGuard)
  @Get('allocation-monthly-report-download')
  allocationMonthlyReportDownload(@Req() req: any) {
    return this.allocationService.allocationMonthlyReportDownload();
  }

  @UseGuards(AuthGuard)
  @Patch('allocation-monthly-report-download/:id')
  allocationMonthlyReportDownloadUse(
    @Res() res: Response,
    @Param('id') id: any,
    @Req() req: any,
  ) {
    return this.allocationService.allocationMonthlyReportDownloadUse(res, id, req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Get('curtailments-allocation')
  curtailmentsAllocation(@Query() query: any, @Req() req: any) {
    return this.allocationService.curtailmentsAllocation(query, req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Get('curtailments-allocation-get-max-cap')
  curtailmentsAllocationGetMaxCap(@Query() query: any, @Req() req: any) {
    return this.allocationService.curtailmentsAllocationGetMaxCap(
      query,
      req?.user?.sub,
    );
  }

  @UseGuards(AuthGuard)
  @Get('curtailments-allocation-calc')
  curtailmentsAllocationCalc(@Query() query: any, @Req() req: any) {
    return this.allocationService.curtailmentsAllocationCalc(
      query,
      req?.user?.sub,
    );
  }

  @UseGuards(AuthGuard)
  @Get('select-nomination')
  selectNomination(@Query() query: any, @Req() req: any) {
    return this.allocationService.selectNomination(query, req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Post('curtailments-allocation-calc-save')
  async curtailmentsAllocationCalcSave(@Body() body: any, @Req() req: any) {
    const { gasDay, area, nominationPoint, unit, type, maxCapacity } = body;

    if (!gasDay || !area || !type || !maxCapacity || !unit) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const curtailmentsAllocationCalcSave =
      await this.allocationService.curtailmentsAllocationCalcSave(
        body,
        req?.user?.sub,
      );
    // const createByOnce = await this.allocationService.createByOnce(req?.user?.sub);

    // const his = await this.allocationService.findOnce(id);
    // create/update date
    // await this.allocationService.writeReq(
    //   req,
    //   `allocation-review`,
    //   'shipper-allocation-review',
    //   { id: Number(id),  create:createByOnce, ...body },
    // );

    return curtailmentsAllocationCalcSave;
  }

  @UseGuards(AuthGuard)
  @Post('allocation-shipper-report')
  allocationShipperReport(@Body() body: any, @Req() req: any) {
    const {
      start_date,
      end_date,
      skip,
      limit,
      nomination_point_arr,
      shipper_arr,
      share,
    } = body;

    return this.allocationService.allocationShipperReportCallOnlyByNomination(
      { ...body, tab: '1' },
      req?.user?.sub,
    );
  }

  @UseGuards(AuthGuard)
  @Post('allocation-shipper-report-download')
  allocationShipperReportDownload(@Body() body: any, @Req() req: any) {
    const {
      start_date,
      end_date,
      skip,
      limit,
      nomination_point_arr,
      shipper_arr,
      share,
    } = body;

    return this.allocationService.allocationShipperReportDownload(
      { ...body, tab: '1' },
      req?.user?.sub,
    );
  }

  @UseGuards(AuthGuard)
  @Get('allocation-shipper-report-download-get')
  allocationShipperReportDownloadGet(@Query() query: any, @Req() req: any) {
    return this.allocationService.allocationShipperReportDownloadGet();
  }

  // test
  @Get('testMeterOnce')
  testMeterOnce() {
    return this.allocationService.testMeterOnce();
  }

  @UseGuards(AuthGuard)
  @Get('allocation-management/send-email')
  allocationManagementSendEmailGet(@Req() req: any) {
    return this.allocationService.allocationManagementSendEmailGet(
      req?.user?.sub,
    );
  }

  @UseGuards(AuthGuard)
  @Post('allocation-management/send-email')
  allocationManagementSendEmail(@Body() body: any, @Req() req: any) {
    return this.allocationService.allocationManagementSendEmail(
      body,
      req?.user?.sub,
    );
  }


  // @UseGuards(AuthGuard)
  @Post('execute-noti-inapp')
  executeNotiInapp(@Body() body: any, @Req() req: any) {
    return this.allocationService.executeNotiInapp(
      body,
      // req?.user?.sub,
    );
  }
}
