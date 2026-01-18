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
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException
} from '@nestjs/common';
import { AuthGuard } from 'src/auth/auth.guard';
import { JwtService } from '@nestjs/jwt';
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
import { PlanningSubmissionFileService } from './planning-submission-file.service';

@Controller('planning-submission-file')
export class PlanningSubmissionFileController {
  constructor(
    private readonly planningSubmissionFileService: PlanningSubmissionFileService,
    private readonly accountManageService: AccountManageService,
    private jwtService: JwtService,
    private readonly fileUploadService: FileUploadService,
  ) {}


  @UseGuards(AuthGuard)
  @Get('download')
  async createExcelTemplate(@Res() res: Response, 
  @Req() req:any, 
  @Query() query:any) {
   
    const {startDate,type} = query
    if (!startDate || !type || !req?.user?.sub) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    // http://10.100.101.15:8010/master/bulletin-board?startDate=10/28/2024&endDateDate=12/29/2024&ContractCode=test&type=3
    // console.log(req);
    // http://10.100.101.15:8010/master/bulletin-board?startDate=28/10/2024&endDateDate=29/10/2024&ContractCode=test&type=3
    // console.log(req);
    // http://10.100.101.15:8010/master/bulletin-board?startDate=12/10/2024&endDateDate=12/12/2024&ContractCode=test&type=3
    // http://10.100.101.15:8010/master/bulletin-board?startDate=04/10/2024&endDateDate=03/04/2025&ContractCode=test&type=3
    // http://10.100.101.15:8010/master/bulletin-board?startDate=01/10/2024&endDateDate=03/04/2025&ContractCode=Con-01&type=4
    const idAccount = req?.user?.sub 
    // const idAccount = 38
    // const getGroup = await this.planningSubmissionFileService.getGroupByIdAccount(idAccount)
    // const { id, id_name, name } = getGroup
    // const {excelBuffer, typeOfContract} = await this.planningSubmissionFileService.createExcelTemplate(query,{id, id_name, name},idAccount);
    const {excelBuffer, typeOfContract} = await this.planningSubmissionFileService.createExcelTemplate(query,null,idAccount);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${typeOfContract}.xlsx`);

    // ส่ง buffer กลับใน response
    res.send(excelBuffer);
  }

  @UseGuards(AuthGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async importTemplate(
    @UploadedFile() file: MulterFile,
    @Req() req: any,
    // @Body('terminateDate') terminateDate: string,
    @Body('shipper_id') shipper_id: string,
    @Body('startDate') startDate: string,
    @Body('type') type: string,
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
    const grpcTransform = await this.fileUploadService.uploadFileTempMultiSheet(file.buffer);
    // const grpcTransform = await this.fileUploadService.uploadFileTemp(file.buffer);
    // const authHeader = req.headers['authorization'];
    // const token = authHeader.split(' ')[1]; // คำสั่งนี้จะแยก "Bearer <token>" ออกมาเป็น <token>
    const resData = await this.planningSubmissionFileService.uploadElsx(grpcTransform,file, shipper_id, req?.user?.sub, startDate, type);


    return  resData
  }

  // planning-deadline-use
  @Get('planning-deadline-use/:id')
  planningDeadlineUse(@Param('id') id:any) {
    return this.planningSubmissionFileService.planningDeadlineUse(id);
  }
 
}
