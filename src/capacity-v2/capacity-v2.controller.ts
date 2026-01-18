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
import { CapacityV2Service } from './capacity-v2.service';

import { AccountManageService } from 'src/account-manage/account-manage.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { FileUploadService } from 'src/grpc/file-service.service';
import { PathManagementService } from 'src/path-management/path-management.service';

interface MulterFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@Controller('capacity')
export class CapacityV2Controller {
  constructor(
    private readonly accountManageService: AccountManageService,
    private readonly capacityV2Service: CapacityV2Service,
    private jwtService: JwtService,
    private readonly fileUploadService: FileUploadService,
    private readonly pathManagementService: PathManagementService,
  ) {}
  //
  @UseGuards(AuthGuard)
  @Post('path-capacity-request-management/upload-tranform')
  @UseInterceptors(FileInterceptor('file'))
  async pathDetailCapacityRequestManagementTranform(
    @UploadedFile() file: MulterFile,
    @Req() req: any,
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

    // console.log('File buffer size in NestJS:', file.buffer.length); // ตรวจสอบขนาดของ buffer ใน NestJS

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

    // console.log('grpcTransform : ', grpcTransform);

    const resData =
      await this.capacityV2Service.pathDetailCapacityRequestManagementTranformNew(
        grpcTransform,
        req?.user?.sub,
        file,
        token,
      );

    const his = await this.capacityV2Service.capacityRequestManagementOnce(
      resData?.id,
    );
    await this.pathManagementService.writeReq(
      req,
      `capacity-management`,
      `${resData?.event}`,
      his,
    );

    return resData;
  }

  @UseGuards(AuthGuard)
  @Patch('update-status-capacity-request-management/:id')
  async updateStatusCapacityRequestManagement(
    @Body() body: any,
    @Param('id') id: any,
    @Req() req: any,
  ) {
    const {
      status_capacity_request_management_id,
      terminate_date,
      shadow_time,
      shadow_period,
      reject_reasons,
    } = body;

    if (!id || !status_capacity_request_management_id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (status_capacity_request_management_id === 2) {
      if (!shadow_period) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Missing required fields',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    } else if (status_capacity_request_management_id === 3) {
      if (!reject_reasons) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Missing required fields',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    } else if (status_capacity_request_management_id === 5) {
      if (!terminate_date) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Missing required fields',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const updateStatusCapacityRequestManagement =
      await this.capacityV2Service.updateStatusCapacityRequestManagement(
        id,
        body,
        req?.user?.sub,
        req,
        true
      );

    return updateStatusCapacityRequestManagement;
  }

  @UseGuards(AuthGuard)
  @Patch('extend-capacity-request-management/:id')
  async extendCapacityRequestManagement(
    @Body() body: any,
    @Param('id') id: any,
    @Req() req: any,
  ) {
    const {
      shadow_time,
      shadow_period,
      contract_start_date,
      contract_end_date,
    } = body;

    if (
      !id ||
      // !shadow_time ||
      // !shadow_period ||
      !contract_start_date ||
      !contract_end_date
    ) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const extendCapacityRequestManagement =
      await this.capacityV2Service.extendCapacityRequestManagement(
        id,
        body,
        req?.user?.sub,
        req,
      );

    return extendCapacityRequestManagement;
  }

  @UseGuards(AuthGuard)
  @Post('edit-version/:id')
  async editVersion(@Body() body: any, @Param('id') id: any, @Req() req: any) {
    const { booking_full_json, booking_row_json } = body;
    if (
      !id ||
      !booking_full_json ||
      booking_full_json.length === 0 ||
      !booking_row_json ||
      booking_row_json.length === 0
    ) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const editVersion = await this.capacityV2Service.editVersion(
      body,
      id,
      req?.user?.sub,
    );

    return editVersion;
  }

  @UseGuards(AuthGuard)
  @Get('capacity-request-management-download/:id')
  async capacityRequestManagementDownload(
    @Param('id') id: any,
    @Res() res: Response,
    //  @Req() req: any
  ) {
    const { excelBuffer, typeOfContract } =
      await this.capacityV2Service.capacityRequestManagementDownload(id);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=${typeOfContract}.xlsx`,
    );

    // ส่ง buffer กลับใน response
    res.send(excelBuffer);
  }

  @UseGuards(AuthGuard)
  @Get('capacity-detail-period')
  getPeriod(@Query() query: any) {
    const { id } = query;
    console.log('id : ', id);
    return this.capacityV2Service.getPeriod(id);
  }
  // @UseGuards(AuthGuard)

  // @Get('capacity-detail-period')
  // async getPeriod(@Query('id') id: string, @Res() res: Response) {
  //   // ป้องกัน proxy บัฟเฟอร์/ดัดแปลง
  //   res.setHeader('Content-Type', 'application/json; charset=utf-8');
  //   res.setHeader('Transfer-Encoding', 'chunked');
  //   res.setHeader('Cache-Control', 'no-cache, no-transform');
  //   res.setHeader('X-Accel-Buffering', 'no'); // nginx/kong
  //   res.setHeader('Alt-Svc', 'clear');        // บอก browser เลิก h3 สำหรับ origin นี้
  //   (res as any).flushHeaders?.();

  //   await this.capacityV2Service.streamGetPeriodOld(Number(id), res);
  // }

  // @Get('capacity-detail-period')
  // async streamCapacityDetailPeriod(
  //   @Query('id') id: string,
  //   @Res() res: Response,
  // ) {
  //   // อย่า return อะไร ให้ service เขียนใส่ res โดยตรง
  //   await this.capacityV2Service.streamPeriod(Number(id), res);
  // }

  // @Get('capacity-detail-period')
  // async streamCapacityDetailPeriod(
  //   @Query('id') id: string,
  //   @Res() res: Response,
  //   @Req() req: Request,
  // ) {
  //   // สำคัญ: ปิดการบัฟเฟอร์/ดัดแปลงเนื้อหา
  //   res.setHeader('Content-Type', 'application/json; charset=utf-8');
  //   res.setHeader('Transfer-Encoding', 'chunked');
  //   res.setHeader('Connection', 'keep-alive');
  //   res.setHeader('Cache-Control', 'no-cache, no-transform');
  //   res.setHeader('X-Accel-Buffering', 'no'); // Nginx
  //   // ถ้าใช้ Cloudflare/Proxy อื่นๆ จะช่วยลดโอกาสโดน transform
  //   (res as any).flushHeaders?.();

  //   try {
  //     await this.capacityV2Service.streamPeriod(Number(id), res);
  //   } catch (e) {
  //     // ถ้า error ระหว่างสตรีม ให้ end ทันที (ตัว client จะรู้ว่าไม่ครบ)
  //     // ห้ามพยายามเขียนซ่อม JSON ตอนนี้
  //     try { res.end(); } catch {}
  //   }
  // }

  @UseGuards(AuthGuard)
  @Post('duplicate-version/:id')
  async duplicateVersion(
    @Body() body: any,
    @Param('id') id: any,
    @Req() req: any,
  ) {
    if (!id) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const duplicateVersion = await this.capacityV2Service.duplicateVersion(
      id,
      req?.user?.sub,
    );

    return duplicateVersion;
  }
}
