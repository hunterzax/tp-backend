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
import { AuthGuard } from 'src/auth/auth.guard';
import { Response } from 'express';


import { QualityEvaluationService } from './quality-evaluation.service';

@Controller('quality-evaluation')
export class QualityEvaluationController {
  constructor(
    private readonly accountManageService: AccountManageService,
    private jwtService: JwtService,
    private readonly qualityEvaluationService: QualityEvaluationService
  ) {}

  @Get()
  findAll(@Query('gasDay') gasDay?: string,) {
    return this.qualityEvaluationService.findAll({gasDay});
  }

}
