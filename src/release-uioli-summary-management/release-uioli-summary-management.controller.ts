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
import { ReleaseUioliSummaryManagementService } from './release-uioli-summary-management.service';

@Controller('release-uioli-summary-management')
export class ReleaseUioliSummaryManagementController {
  constructor(
    private readonly releaseUioliSummaryManagementService: ReleaseUioliSummaryManagementService,
  ) {}

  @UseGuards(AuthGuard)
  @Get()
  findAll(@Req() req: any) {
    const userId = req?.user?.sub;
    return this.releaseUioliSummaryManagementService.findAll(userId);
  }

  @UseGuards(AuthGuard)
  @Post('comment')
  async comment(@Body() body: any, @Req() req: any) {
    const { comments, id } = body;

    if (!comments || !id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const comment = await this.releaseUioliSummaryManagementService.comment(
      body,
      req?.user?.sub,
    );

    return comment;
  }

  @UseGuards(AuthGuard)
  @Post('confirm-capacity')
  async confirmCapacity(@Body() body: any, @Req() req: any) {
    const { id, mmbtu_d, mmscfd_d } = body;

    if (!id || !mmbtu_d || !mmscfd_d) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const confirmCapacity =
      await this.releaseUioliSummaryManagementService.confirmCapacity(
        body,
        req?.user?.sub,
      );

    return confirmCapacity;
  }
}
