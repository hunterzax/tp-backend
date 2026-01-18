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
import { WeeklyManagementService } from './weekly-management.service';
import { QueryShipperNominationFileService } from 'src/query-shipper-nomination-file/query-shipper-nomination-file.service';

@Controller('weekly-management')
export class WeeklyManagementController {
  constructor(
    private readonly accountManageService: AccountManageService,
    private jwtService: JwtService,
    private readonly fileUploadService: FileUploadService,
    private readonly weeklyManagementService: WeeklyManagementService,
    private readonly queryShipperNominationFileService: QueryShipperNominationFileService,
  ) {}

  @UseGuards(AuthGuard)
  @Post("comment")
  comments(@Req() req: any, @Body() body: any) {

    const { comment, query_shipper_nomination_file_id } = body;

    if (!comment || !query_shipper_nomination_file_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.queryShipperNominationFileService.comments(body, req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Post("edit-row/:id")
  editRowJSON(@Req() req: any, @Body() body: any, @Param("id") id:any) {

    const { rowChange } = body;

    if (!id || !rowChange || rowChange.length <= 0) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.queryShipperNominationFileService.editRowJSON(id, body, req?.user?.sub);
  }

  @UseGuards(AuthGuard)
  @Post("version-validate")
  versionValidate(@Req() req: any, @Body() body: any) {

    const { nomination_type_id, contract_code_id, nomination_version_id } = body;

    if (!nomination_type_id || !contract_code_id || !nomination_version_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.queryShipperNominationFileService.versionValidate(body, req?.user?.sub);
  }


  @UseGuards(AuthGuard)
  @Post("update-status")
  updateStatus(@Req() req: any, @Body() body: any) {

    const { id, status } = body;

    if (!id || id.length <= 0 || !status) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.queryShipperNominationFileService.updateStatus(body, req?.user?.sub);
  }

}
