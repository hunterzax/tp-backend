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
import { AccountManageService } from 'src/account-manage/account-manage.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';

import { ReleaseCapacityManagementService } from './release-capacity-management.service';
import { ReleaseCapacitySubmissionService } from 'src/release-capacity-submission/release-capacity-submission.service';

@Controller('release-capacity-management')
export class ReleaseCapacityManagementController {
  constructor(
    private readonly accountManageService: AccountManageService,
    private readonly releaseCapacityManagementService: ReleaseCapacityManagementService,
    private readonly releaseCapacitySubmissionService: ReleaseCapacitySubmissionService,
    private jwtService: JwtService,
  ) {}

  @UseGuards(AuthGuard)
  @Get()
  findAll(@Req() req: any) {
    return this.releaseCapacityManagementService.findAll(req?.user?.sub);
  }

  @Get("status")
  status() {
    return this.releaseCapacityManagementService.status();
  }

  @UseGuards(AuthGuard)
  @Patch("status/:id")
  changeStatus(@Body() body: any, @Req() req: any, @Param('id') id: any) {
    const {
      status,
    } = body;
    if (
      !status
    ) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.releaseCapacitySubmissionService.changeStatus(body, id, req?.user?.sub);
  }

}
