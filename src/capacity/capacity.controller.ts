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
import { CapacityService } from './capacity.service';
import { AccountManageService } from 'src/account-manage/account-manage.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { FileUploadService } from 'src/grpc/file-service.service';

interface MulterFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@Controller('capacity')
export class CapacityController {
  constructor(
    private readonly capacityService: CapacityService,
    private readonly fileUploadService: FileUploadService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('capacity-request-management')
  capacityRequestManagement() {
    return this.capacityService.capacityRequestManagement();
  }

  @Get('term-type')
  termType() {
    return this.capacityService.termType();
  }

  @Get('type-account')
  typeAccount() {
    return this.capacityService.typeAccount();
  }

  @Get('status-capacity-request-management')
  statusCapacityRequestManagement() {
    return this.capacityService.statusCapacityRequestManagement();
  }

  @Get('status-capacity-request-management-process')
  statusCapacityRequestManagementProcess() {
    return this.capacityService.statusCapacityRequestManagementProcess();
  }

  @UseGuards(AuthGuard)
  @Post('file-capacity-request-management')
  async fileCapacityBooking(@Body() body: any, @Req() req: any) {
    const { url, contract_code_id } = body;

    if (!url || !contract_code_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const fileCapacityBooking = await this.capacityService.fileCapacityBooking(
      body?.url,
      body?.contract_code_id,
      req?.user?.sub,
    );
 
    return fileCapacityBooking;
  }

  @Post('path-capacity-request-management/upload')
  @UseInterceptors(FileInterceptor('file'))
  async pathDetailCapacityRequestManagement(
    @UploadedFile() file: MulterFile,
    // @Req() req:any
  ) {
    if (
      file.mimetype !==
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && // .xlsx
      file.mimetype !== 'application/vnd.ms-excel' // .xls
    ) {
      throw new BadRequestException(
        'Only Excel files (xlsx or xls) are allowed.',
      );
    }
    return this.capacityService.pathDetailCapacityRequestManagement(file, null);
   
  }

  @UseGuards(AuthGuard)
  @Post('path-capacity-request-management/import-template/:id')
  @UseInterceptors(FileInterceptor('file'))
  async importTemplate(
    @UploadedFile() file: MulterFile,
    @Req() req: any,
    @Param('id') id: any,
    @Body('terminateDate') terminateDate: string,
    @Body('amd') amd: string,
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

    console.log('File buffer size in NestJS:', file.buffer.length); // ตรวจสอบขนาดของ buffer ใน NestJS

    if (file.buffer.length === 0) {
      throw new Error('Buffer is empty before sending to gRPC');
    }
    // ส่ง buffer ไปยัง gRPC
    const grpcTransform = await this.fileUploadService.uploadFile(file.buffer);
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      throw new BadRequestException('Authorization header is missing');
    }
    const tokenParts = authHeader.split(' ');
    const token = tokenParts.length > 1 ? tokenParts[1] : null; // คำสั่งนี้จะแยก "Bearer <token>" ออกมาเป็น <token>
    if (!token) {
      throw new BadRequestException('Invalid authorization header format');
    }

    return this.capacityService.importTemplate(
      grpcTransform,
      req?.user?.sub,
      file,
      token,
      id,
      terminateDate,
      amd,
    );
  }

  @UseGuards(AuthGuard)
  @Post('comment-version/:id')
  async commentVersion(
    @Body() body: any,
    @Param('id') id: any,
    @Req() req: any,
  ) {
    const { comment } = body;

    if (!comment || !id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const commentVersion = await this.capacityService.commentVersion(
      body,
      id,
      req?.user?.sub,
    );

    return commentVersion;
  }

  @UseGuards(AuthGuard)
  @Get('capacity-detail')
  capacityDetail(@Query() query: any) {
    const { period } = query;
    return this.capacityService.capacityDetail(period);
  }
}
