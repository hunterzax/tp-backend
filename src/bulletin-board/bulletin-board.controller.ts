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
import { BulletinBoardService } from './bulletin-board.service';
import { Response } from 'express';

@Controller('bulletin-board')
export class BulletinBoardController {
  constructor(
    private readonly accountManageService: AccountManageService,
    private readonly bulletinBoardService: BulletinBoardService,
    private jwtService: JwtService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('old')
  async createExcelTemplate(
    @Res() res: Response,
    @Req() req: any,
    @Query() query: any,
  ) {
    const { startDate, endDateDate, ContractCode, type } = query;
    if (!startDate || !endDateDate || !ContractCode || !type) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    // http://10.100.101.15:8010/master/bulletin-board?startDate=10/28/2024&endDateDate=12/29/2024&ContractCode=test&type=3
    const idAccount = req?.user?.sub;
    // const idAccount = 25
    const getGroup =
      await this.bulletinBoardService.getGroupByIdAccount(idAccount);
    const { id, id_name, name } = getGroup;

    const { excelBuffer, typeOfContract } =
      await this.bulletinBoardService.createExcelTemplateNew(
        query,
        { id, id_name, name },
        idAccount,
      );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=${typeOfContract}.xlsx`,
    );

    res.send(excelBuffer);
  }

  @UseGuards(AuthGuard)
  @Get()
  async createExcelTemplateV2(
    @Res() res: Response,
    @Req() req: any,
    @Query() query: any,
  ) {
    const { startDate, endDateDate, ContractCode, type } = query;
    if (!startDate || !endDateDate || !ContractCode || !type) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    // http://10.100.101.15:8010/master/bulletin-board?startDate=10/28/2024&endDateDate=12/29/2024&ContractCode=test&type=3
    // https://tpa-gateway.nueamek.app/master/bulletin-board?startDate=05/03/2025&endDateDate=30/06/2025&ContractCode=FA&type=1
    const idAccount = req?.user?.sub;
    // const idAccount = 99999
    const getGroup =
      await this.bulletinBoardService.getGroupByIdAccount(idAccount);
    const { id, id_name, name } = getGroup;

    const { excelBuffer, typeOfContract } =
      await this.bulletinBoardService.createExcelTemplateNewV2(
        query,
        { id, id_name, name },
        idAccount,
      );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=${typeOfContract}.xlsx`,
    );

    res.send(excelBuffer);
  }
}
