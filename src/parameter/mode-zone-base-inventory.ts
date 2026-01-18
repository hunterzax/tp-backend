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
import axios from 'axios';
dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class ParameterModeZoneBaseInventoryService {
  constructor(private prisma: PrismaService) {}

  async modeZoneUse() {
    const bookingTemplate = await this.prisma.zone.findMany({
      select: {
        id: true,
        name: true,
        color: true,
        config_mode_zone_base_inventory: {
          select: {
            id: true,
            mode: true,
          },
        },
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
      orderBy: {
        id: 'desc',
      },
    });
    return bookingTemplate;
  }

  async changeModeZoneBaseInventoryOnce(id: any) {
    const bookingTemplate =
      await this.prisma.mode_zone_base_inventory.findUnique({
        where: {
          id: Number(id),
        },
        include: {
          zone: true,
          mode: true,
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
    return bookingTemplate;
  }

  async changeModeZoneBaseInventory() {
    const bookingTemplate = await this.prisma.mode_zone_base_inventory.findMany(
      {
        include: {
          zone: true,
          mode: true,
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
        orderBy: {
          id: 'desc',
        },
      },
    );
    return bookingTemplate;
  }

  async changeModeZoneBaseInventoryCreate(payload: any, userId: any) {
    const { start_date, zone_id, mode_id, ...dataWithout } = payload;

    const changeModeZoneBaseInventoryCreate =
      await this.prisma.mode_zone_base_inventory.create({
        data: {
          ...dataWithout,
          ...(zone_id !== null && {
            zone: {
              connect: {
                id: zone_id,
              },
            },
          }),
          ...(mode_id !== null && {
            mode: {
              connect: {
                id: mode_id,
              },
            },
          }),
          start_date: start_date ? getTodayNowAdd7(start_date).toDate() : null,
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });
    return changeModeZoneBaseInventoryCreate;
  }

}
