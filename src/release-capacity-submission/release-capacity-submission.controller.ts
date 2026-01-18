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

import { ReleaseCapacitySubmissionService } from './release-capacity-submission.service';

@Controller('release-capacity-submission')
export class ReleaseCapacitySubmissionController {
  constructor(
    private readonly releaseCapacitySubmissionService: ReleaseCapacitySubmissionService,
  ) {}

  // @UseGuards(AuthGuard)
  @Get('contract-code')
  contractCode() {
    // @Req() req: any,
    return this.releaseCapacitySubmissionService.contractCode();
  }

  @Get()
  findAll(
    // @Req() req: any,
    @Query() query: any,
  ) {
    const { contract_code_id } = query;

    if (!contract_code_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.releaseCapacitySubmissionService.getRelease(query);
    // ถ้าจะเปิด getReleaseGroupByEntryAreaAndDate ไปเปิด region หาทุก exit ในทุก entry ที่ frontend ด้วย
    // return this.releaseCapacitySubmissionService.getReleaseGroupByEntryAreaAndDate(query);
  }

  // @UseGuards(AuthGuard)
  @Get('document-file/:id')
  documentFile(
    // @Req() req: any,
    @Param('id') id: any,
  ) {
    return this.releaseCapacitySubmissionService.documentFile(id);
  }

  @UseGuards(AuthGuard)
  @Post('document-file-create')
  async documentFileCreate(@Body() body: any, @Req() req: any) {
    const { contract_code_id, url } = body;

    if (!contract_code_id || !url) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const documentFileCreate =
      await this.releaseCapacitySubmissionService.documentFileCreate(
        body,
        req?.user?.sub,
      );

    return documentFileCreate;
  }

  @UseGuards(AuthGuard)
  @Put('document-file-inactive')
  async documentFileInactive(@Body() body: any, @Req() req: any) {
    const { id } = body;

    if (!id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const documentFileInactive =
      await this.releaseCapacitySubmissionService.documentFileInactive(
        body,
        req?.user?.sub,
      );

    return documentFileInactive;
  }

  @UseGuards(AuthGuard)
  @Post('submission')
  async submission(@Body() body: any, @Req() req: any) {
    const { contract_code_id, data } = body;

    if (!contract_code_id || !data || data.length === 0) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const submission = await this.releaseCapacitySubmissionService.submissionV2(
      body,
      req?.user?.sub,
    );

    return submission;
  }



  @Get('approved-release-capacity-submission-detail')
  getApprovedReleaseCapacitySubmissionDetail(
    // @Req() req: any,
    @Query() query: any,
  ) {
    const { contract_code_id } = query;

    if (!contract_code_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.releaseCapacitySubmissionService.getApprovedReleaseCapacitySubmissionDetail(contract_code_id);
  }
}
