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
import { UploadTemplateForShipperService } from './upload-template-for-shipper.service';
import { FileUploadService } from 'src/grpc/file-service.service';
import { AuthGuard } from 'src/auth/auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { uploadFilsTemp } from 'src/common/utils/uploadFileIn';

@Controller('upload-template-for-shipper')
export class UploadTemplateForShipperController {
  constructor(
    private readonly uploadTemplateForShipperService: UploadTemplateForShipperService,
    private readonly fileUploadService: FileUploadService,
  ) {}

  @Get()
  findAll() {
    return this.uploadTemplateForShipperService.findAll();
  }

  @Get('shipper-contract-approved')
  shipperContractApproved() {
    return this.uploadTemplateForShipperService.shipperContractApproved();
  }

  @UseGuards(AuthGuard)
  @Post('create')
  @UseInterceptors(FileInterceptor('file'))
  async createTemplates(
    @UploadedFile() file: any,
    @Req() req: any,
    @Body('shipper_id') shipper_id: string,
    @Body('contract_code_id') contract_code_id: string,
    @Body('nomination_type_id') nomination_type_id: string,
    @Body('comment') comment: string,
  ) {
    if (!file && !!comment) {
      const { id, message } =
        await this.uploadTemplateForShipperService.editComment(
          { shipper_id, contract_code_id, nomination_type_id, comment },
          req?.user?.sub,
          req,
        );
      const his = await this.uploadTemplateForShipperService.findOnce(id);
      //
      await this.uploadTemplateForShipperService.writeReq(
        req,
        `upload-template-for-shipper`,
        message, //create | edit
        his,
      );

      return { id, message };
    } else {
      if (
        file.mimetype !==
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
        file.mimetype !== 'application/vnd.ms-excel'
      ) {
        throw new BadRequestException(
          'Only Excel files (xlsx or xls) are allowed.',
        );
      }

      if (file.buffer.length === 0) {
        throw new Error('Buffer is empty before sending to gRPC');
      }
      const grpcTransform =
        await this.fileUploadService.uploadFileTempMultiSheet(file.buffer);

      if (!shipper_id || !contract_code_id || !nomination_type_id || !file) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Missing required fields',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const { id, message } =
        await this.uploadTemplateForShipperService.createTemplates(
          grpcTransform,
          file,
          { shipper_id, contract_code_id, nomination_type_id, comment },
          req?.user?.sub,
          req,
        );
      const his = await this.uploadTemplateForShipperService.findOnce(id);

      return { id, message };
    }
  }

  @UseGuards(AuthGuard)
  @Post('regenerate')
  async regenerate(@Body() body: any, @Req() req: any) {
    const { id } = body;

    if (!id || id.length <= 0) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const regenerate = await this.uploadTemplateForShipperService.regenerate(
      id,
      req?.user?.sub,
      req,
    );

    return regenerate;
  }

  @Get('gen-excel-template-url')
  async genExcelTemplateUrl(
    @Res() res: Response,
    @Req() req: any,
    @Query() query: any,
  ) {
    const { id, type } = query;
    const contract_code_id = Number(id); //78
    const types = type; //1 daily 2 weekly

    const { excelBuffer, typeOfNomination } =
      await this.uploadTemplateForShipperService.genExcelTemplate({
        contract_code_id,
        types,
      });

    const uploadResponse = await uploadFilsTemp({
      buffer: excelBuffer,
      originalname: `${typeOfNomination}.xlsx`,
    });

    return res.json(uploadResponse);
  }
}
