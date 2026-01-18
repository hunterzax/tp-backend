import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import isBetween from 'dayjs/plugin/isBetween'; // นำเข้า plugin isBetween
import {
  checkStartEndBoom,
  getTodayEndAdd7,
  getTodayNowAdd7,
  getTodayStartAdd7,
} from 'src/common/utils/date.util';
dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class ParameterAuditLogService {
  constructor(private prisma: PrismaService) {}

  auditLogModule() {
    return this.prisma.menus.findMany({
      where: {
        parent: 0,
      },
      include: {},
      orderBy: {
        id: 'asc',
      },
    });
  }

  async auditLog(id: any, date: any, module: any) {
    const todayStart = getTodayStartAdd7(date).toDate();
    const todayEnd = getTodayEndAdd7(date).toDate();

    const dateWhere = {
      create_date: {
        lte: todayEnd,
        gte: todayStart,
      },
    };

    const auditLog = await this.prisma.history.findMany({
      where: {
        ...(!!date && { ...dateWhere }),
        ...(!!id && { id: Number(id) }),
        ...(!!module && { module: module }),
      },
      select: {
        id: true,
        reqUser: true,
        type: true,
        module: true,
        create_date: true,
        create_date_num: true,
        method: true,
        // value:true,
      },
      orderBy: {
        id: 'desc',
      },
    });

    return auditLog;
  }

}
