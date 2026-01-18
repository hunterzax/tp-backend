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
import { SubmissionFileService } from './submission-file.service';
import { SubmissionFileService2 } from './submission-file2.service';
import { SubmissionFileRefactoredService } from './submission-file-refactored.service';


@Controller('submission-file')
export class SubmissionFileController {
  constructor(
    private readonly accountManageService: AccountManageService,
    private jwtService: JwtService,
    private readonly fileUploadService: FileUploadService,
    private readonly submissionFileService: SubmissionFileService,
    private readonly submissionFileService2: SubmissionFileService2,
    private readonly submissionFileRefactoredService: SubmissionFileRefactoredService
  ) {}

  /**
   * Upload nomination file endpoint
   * Expected file format: ['SHIPPER ID', 'CONTRACT CODE', 'START DATE']
   * 
   * @param file - Excel file (xlsx or xls)
   * @param req - Request object containing user information
   * @param comment - Optional comment for the submission
   * @param tabType - Type of nomination (1 = Daily, 2 = Weekly)
   * @returns Upload result with validation status
   */
  @UseGuards(AuthGuard) // Require authentication
  @Post('upload')
  @UseInterceptors(FileInterceptor('file')) // Handle file upload
  async uploadFile(
    @UploadedFile() file: any,
    @Req() req: any,
    @Body('comment') comment: string,
    @Body('tabType') tabType: string,
  ) {
    // Validate file type - only allow Excel files
    if (
      file.mimetype !==
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
      file.mimetype !== 'application/vnd.ms-excel'
    ) {
      throw new BadRequestException(
        'Only Excel files (xlsx or xls) are allowed.',
      );
    }

    // Check if file buffer is not empty
    if (file.buffer.length === 0) {
      throw new Error('Buffer is empty before sending to gRPC');
    }

    // Validate file size - limit to 10MB (10 * 1024 * 1024 bytes)
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestException(
        'File size over limit. Maximum allowed size is 10MB.',
      );
    }

    // Send file buffer to gRPC service for processing
    const grpcTransform = await this.fileUploadService.uploadFileTempMultiSheet(
      file.buffer,
    );

    // Validate file existence
    if (!file) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Process the uploaded file through service layer
    // const uploadFile =
    //   await this.submissionFileService.uploadFile(
    //     grpcTransform, // Processed file data from gRPC
    //     file,          // Original file object
    //     req?.user?.sub, // User ID from JWT token
    //     comment,       // Optional comment
    //     tabType        // Nomination type
    //   );

    const uploadFile =
      await this.submissionFileRefactoredService.uploadFile(
        grpcTransform, // Processed file data from gRPC
        file,          // Original file object
        req?.user?.sub, // User ID from JWT token
        comment,       // Optional comment
        tabType        // Nomination type
      );
    return uploadFile;
  }

}
