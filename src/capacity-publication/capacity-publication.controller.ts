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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { AuthGuard } from 'src/auth/auth.guard';
import { JwtService } from '@nestjs/jwt';
import { CapacityPublicationService } from './capacity-publication.service';
import { AccountManageService } from 'src/account-manage/account-manage.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';

@Controller('capacity-publication')
export class CapacityPublicationController {
  constructor(
    private readonly accountManageService: AccountManageService,
    private readonly capacityPublicationService: CapacityPublicationService,
    private jwtService: JwtService,
  ) {}


  @Get()
  findAll() {
    return this.capacityPublicationService.findAll();
  }

  @Get('demo')
  demo() {
    return this.capacityPublicationService.demo();
  }

  @Get('zone')
  zoneFind() {
    return this.capacityPublicationService.zoneFind();
  }

  @UseGuards(AuthGuard)
  @Post('detail')
  async detailCreate(@Body() body: any, @Req() req: any) {
    // const { start_date } = body;

    // if (!start_date) {
    //   throw new HttpException(
    //     {
    //       status: HttpStatus.BAD_REQUEST,
    //       error: 'Missing required fields',
    //     },
    //     HttpStatus.BAD_REQUEST,
    //   );
    // }
    const detailCreate =
      await this.capacityPublicationService.detailCreate(body, req?.user?.sub);
    // const his = await this.pathManagementService.pathManagementOnce(
    //   detailCreate?.id,
    // );
    // await this.pathManagementService.writeReq(
    //   req,
    //   `path-management`,
    //   'create',
    //   his,
    // );

    return detailCreate;
  }

  @Get('show-detail')
  showDetail() {
    return this.capacityPublicationService.showDetail();
  }

  @Get('daily')
  getDays(@Query() query: any) {
    const { date } = query
    // return this.capacityPublicationService.getDays(date);
    return this.capacityPublicationService.getDays2(date);
  }

  @Get('monthly')
  getMonthly(@Query() query: any) {
    const { startMonth, endMonth } = query
    // return this.capacityPublicationService.getMonthly(startMonth, endMonth);
    return this.capacityPublicationService.getMonthly2(startMonth, endMonth);
  }

  @Get('yearly')
  getYearly(@Query() query: any) {
    const { startYear, endYear } = query
    // return this.capacityPublicationService.getYearly(startYear, endYear);
    return this.capacityPublicationService.getYearly2(startYear, endYear);
  }

}
