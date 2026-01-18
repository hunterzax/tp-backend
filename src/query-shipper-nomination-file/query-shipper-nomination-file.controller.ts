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
import { Response } from 'express';

import { QueryShipperNominationFileService } from './query-shipper-nomination-file.service';

@Controller('query-shipper-nomination-file')
export class QueryShipperNominationFileController {
  constructor(
    private readonly queryShipperNominationFileService: QueryShipperNominationFileService,
    private readonly accountManageService: AccountManageService,
    private jwtService: JwtService,
    private readonly fileUploadService: FileUploadService,
  ) {}

  @UseGuards(AuthGuard)
  @Get()
  findAll(@Req() req: any) {
    return this.queryShipperNominationFileService.findAll(req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Get("status")
  status(@Req() req: any) {
    return this.queryShipperNominationFileService.status();
  }

  @UseGuards(AuthGuard)
  @Get('shipper-nomination-report')
  shipperNominationReport(@Req() req: any, @Query('gasDay') gasDay?: string) {
    return this.queryShipperNominationFileService.shipperNominationReport({gasDay});
  }

}
