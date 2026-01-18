import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import * as bcrypt from 'bcrypt';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  checkStartEndBoom,
  getTodayEndAdd7,
  getTodayNowAdd7,
  getTodayNowDDMMYYYYDfaultAdd7,
  getTodayStartAdd7,
} from 'src/common/utils/date.util';
import axios from 'axios';
import {
  findMoveEndDatePoints,
  findMoveStartDatePoints,
  getConflictReason,
  shouldAddOldPointToEndDateArray,
  shouldAddOldPointToStartDateArray,
  shouldBlockNewPeriod,
} from 'src/common/utils/asset.util';
import { parseToNumber } from 'src/common/utils/number.util';
import { writeReq } from 'src/common/utils/write-req.util';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Bangkok');

@Injectable()
export class AssetAreaService {
  constructor(private prisma: PrismaService) {}

  area() {
    return this.prisma.area.findMany({
      where: {
        // active: true,
      },
      include: {
        supply_reference_quality_area_by: true,
        zone: true,
        entry_exit: true,
        create_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        update_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
      },
      orderBy: { id: 'desc' },
    });
  }

  areaEntry() {
    return this.prisma.area.findMany({
      where: {
        // active: true,
        entry_exit_id: 1,
      },
      include: {
        supply_reference_quality_area_by: true,
        zone: true,
        entry_exit: true,
        create_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        update_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
      },
      orderBy: { id: 'desc' },
    });
  }

  areaOnce(id: any) {
    return this.prisma.area.findUnique({
      where: {
        id: Number(id),
      },
      include: {
        zone: true,
        entry_exit: true,
        supply_reference_quality_area_by: true,
        create_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        update_by_account: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });
  }

  async areaCreate(payload: any, userId: any) {
    const { start_date, end_date, name, ...dataWithout } = payload;

    const startDate = start_date
      ? getTodayNowAdd7(start_date).toDate()
      : null;
    const endDate = end_date
      ? getTodayNowAdd7(end_date).toDate()
      : null;

    const areaCk = await this.prisma.area.findFirst({
      where: {
        name: name,
        OR: [
          {
            AND: [
              {
                start_date: {
                  lte: startDate
                },
              },
              {
                OR: [
                  {
                    end_date: null
                  },
                  {
                    end_date: {
                      gt: startDate
                    }
                  }
                ]
              },
            ]
          },
          {
            AND: [
              {
                start_date: {
                  gte: startDate
                }
              },
              ...(
                endDate ? [
                  {
                    start_date: {
                      lt: endDate
                    }
                  }
                ]
                :
                []
              )
            ]
          }
        ]
      },
    });

    if (areaCk) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'area is already exist',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const zoneMaster = await this.prisma.area.create({
      data: {
        ...dataWithout,
        name: name,
        active: true,
        start_date: start_date ? getTodayNowAdd7(start_date).toDate() : null,
        end_date: end_date ? getTodayNowAdd7(end_date).toDate() : null,
        create_date: getTodayNowAdd7().toDate(),
        create_by: Number(userId),
        create_date_num: getTodayNowAdd7().unix(),
      },
    });

    return zoneMaster;
  }

  async areaUpdate(payload: any, userId: any, id: any) {
    const { start_date, end_date, name, ...dataWithout } = payload;

    const startDate = start_date
      ? getTodayNowAdd7(start_date).toDate()
      : null;
    const endDate = end_date
      ? getTodayNowAdd7(end_date).toDate()
      : null;

    const areaCk = await this.prisma.area.findFirst({
      where: {
        name: name,
        id: { not: Number(id) },
        OR: [
          {
            AND: [
              {
                start_date: {
                  lte: startDate
                },
              },
              {
                OR: [
                  {
                    end_date: null
                  },
                  {
                    end_date: {
                      gt: startDate
                    }
                  }
                ]
              },
            ]
          },
          {
            AND: [
              {
                start_date: {
                  gte: startDate
                }
              },
              ...(
                endDate ? [
                  {
                    start_date: {
                      lt: endDate
                    }
                  }
                ]
                :
                []
              )
            ]
          }
        ]
      },
    });
    if (areaCk) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'area is already exist',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const zoneMaster = await this.prisma.area.update({
      where: {
        id: Number(id),
      },
      data: {
        ...dataWithout,
        name: name,
        start_date: start_date ? getTodayNowAdd7(start_date).toDate() : null,
        end_date: end_date ? getTodayNowAdd7(end_date).toDate() : null,
        update_date: getTodayNowAdd7().toDate(),
        update_by: Number(userId),
        update_date_num: getTodayNowAdd7().unix(),
      },
    });

    return zoneMaster;
  }
}
