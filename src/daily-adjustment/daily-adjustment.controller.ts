import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
  Put,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res,
  Query,
} from '@nestjs/common';
import { AccountManageService } from 'src/account-manage/account-manage.service';
import { JwtService } from '@nestjs/jwt';
import { FileUploadService } from 'src/grpc/file-service.service';
import { AuthGuard } from 'src/auth/auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
// import { query, Response } from 'express';

import { DailyAdjustmentService } from './daily-adjustment.service';
import { MeteredMicroService } from 'src/grpc/metered-service.service';

@Controller('daily-adjustment')
export class DailyAdjustmentController {
  constructor(
    private readonly accountManageService: AccountManageService,
    private jwtService: JwtService,
    private readonly fileUploadService: FileUploadService,
    private readonly dailyAdjustmentService: DailyAdjustmentService,
    private readonly meteredMicroService: MeteredMicroService,
  ) {}

  @UseGuards(AuthGuard)
  @Get()
  findAll(@Req() req: any,) {
    return this.dailyAdjustmentService.findAll(req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Post("create")
  create(@Req() req: any, @Body() body: any) {

    const {  } = body;

    // if (!) {
    //   throw new HttpException(
    //     {
    //       status: HttpStatus.BAD_REQUEST,
    //       error: 'Missing required fields',
    //     },
    //     HttpStatus.BAD_REQUEST,
    //   );
    // }

    return this.dailyAdjustmentService.create(body, req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Put("update-status/:id")
  updateStatus(@Req() req: any, @Body() body: any, @Param("id") id:any) {

    const { status } = body;

    if (!status) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.dailyAdjustmentService.updateStatus(id, body, req?.user?.sub);
  }

  @Get("shipper-data")
  shipperData() {

    return this.dailyAdjustmentService.shipperData();
  }

  @Get("nomination-point-data")
  nominationPointData(@Query() query:any) {

    return this.dailyAdjustmentService.nominationPointData(query);
  }
  
  @UseGuards(AuthGuard)
  @Post("daily-adjustment-summary")
  dailyAdjustmentSummary(@Body() body:any, @Req() req: any,) {

    // return this.dailyAdjustmentService.dailyAdjustmentSummary(body, req?.user?.sub);
    return this.dailyAdjustmentService.dailyAdjustmentSummary2(body, req?.user?.sub);
  }
  
  @UseGuards(AuthGuard)
  @Post("daily-adjustment-report-now")
  dailyAdjustmentReportNow(@Body() body:any, @Req() req: any,) {

    // return this.dailyAdjustmentService.dailyAdjustmentReportNow(body, req?.user?.sub);
    return this.dailyAdjustmentService.dailyAdjustmentReportNow2(body, req?.user?.sub);
  }
  
  @UseGuards(AuthGuard)
  @Post("daily-adjustment-report")
  dailyAdjustmentReport(@Body() body:any, @Req() req: any,) {

    // return this.dailyAdjustmentService.dailyAdjustmentReport(body, req?.user?.sub);
    return this.dailyAdjustmentService.dailyAdjustmentReport2(body, req?.user?.sub);
  }
}
