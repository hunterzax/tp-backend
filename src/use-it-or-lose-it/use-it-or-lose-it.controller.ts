import { UseItOrLoseItService } from './use-it-or-lose-it.service';
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

@Controller('use-it-or-lose-it')
export class UseItOrLoseItController {
  constructor(private readonly useItOrLoseItService: UseItOrLoseItService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.useItOrLoseItService.findAll2(query);
  }

  @UseGuards(AuthGuard)
  @Post('release')
  async release(@Body() body: any, @Req() req: any) {
    const { contract_code_id, group_id, data } = body;

    if (!contract_code_id || !group_id || !data || data.length === 0) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Missing required fields',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const release = await this.useItOrLoseItService.release(
      body,
      req?.user?.sub,
    );

    return release;
  }
}
