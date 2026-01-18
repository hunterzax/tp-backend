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
import { JwtService } from '@nestjs/jwt';
import { FileUploadService } from 'src/grpc/file-service.service';
import { AuthGuard } from 'src/auth/auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';

import { ParkingAllocationService } from './parking-allocation.service';

@Controller('parking-allocation')
export class ParkingAllocationController {
  constructor(
    private jwtService: JwtService,
    private readonly fileUploadService: FileUploadService,
    private readonly parkingAllocationService: ParkingAllocationService,
  ) {}

  // @UseGuards(AuthGuard)
  @Get()
  findAll(@Query() query:any) {

    return this.parkingAllocationService.findAll(query);
  }

  @UseGuards(AuthGuard)
  @Post('allocate')
  async allocate(@Body() body: any, @Req() req: any) {
    const { zone_id, gas_day  } = body;
    if (!zone_id || !gas_day) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const allocate = await this.parkingAllocationService.allocate(body,req?.user?.sub);
    // const his = await this.parkingAllocationService.findOnce(allocate?.id);
    // await this.balancingService.writeReq(
    //   req,
    //   `parking-allocation`,
    //   'create',
    //   his,
    // );
    return allocate
  }

  @Get("park-default")
  parkDefault(@Query() query:any) {
    const { gas_day } = query

    return this.parkingAllocationService.parkDefault(query);
  }

}
