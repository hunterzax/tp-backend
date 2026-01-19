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
export class ParameterUserGuideService {
  constructor(private prisma: PrismaService) { }

  userGuideRoleAll() {
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    return this.prisma.role.findMany({
      where: {
        start_date: {
          lte: todayEnd,
        },
        end_date: {
          gte: todayStart,
        },
      },
      select: {
        id: true,
        name: true,
        user_type: true,
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
  }

  async userGuide(userId: any) {
    // const userType = await this.prisma.user_type.findFirst({
    //   where:{
    //     account_manage:{
    //       some:{
    //         account_id: Number(userId)
    //       },
    //     }
    //   },
    // })

    // console.log('userType : ', userType);

    return this.prisma.user_guide.findMany({
      where: {},
      include: {
        user_guide_match: {
          include: {
            role: {
              include: {
                user_type: true,
              },
            },
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
  }

  userGuideOnce(id: any) {
    return this.prisma.user_guide.findUnique({
      where: {
        id: (id !== undefined && id !== null) ? Number(id) : -1,
      },
      include: {
        user_guide_match: {
          include: {
            role: {
              include: {
                user_type: true,
              },
            },
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
    });
  }

  async userGuideCreate(payload: any, userId: any) {
    if (!payload) {
      throw new HttpException('Payload is required', HttpStatus.BAD_REQUEST);
    }
    const { role, ...dataWithout } = payload;

    // document_name

    const ckName = await this.prisma.user_guide.findFirst({
      where: {
        document_name: dataWithout?.document_name,
      },
    });

    if (ckName) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'มี document name นี้ในระบบ',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const userGuideCreate = await this.prisma.user_guide.create({
      data: {
        ...dataWithout,
        // active: true,
        create_date: getTodayNowAdd7().toDate(),
        create_date_num: getTodayNowAdd7().unix(),
        create_by_account: {
          connect: {
            id: (userId !== undefined && userId !== null) ? Number(userId) : -1, // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
          },
        },
      },
    });

    if (role?.length > 0) {
      await this.prisma.user_guide_match.createMany({
        data: role?.map((e: any) => {
          return { user_guide_id: userGuideCreate?.id, role_id: e?.id };
        }),
      });
    }

    return userGuideCreate;
  }

  async userGuideEdit(payload: any, userId: any, id: any) {
    if (!payload) {
      throw new HttpException('Payload is required', HttpStatus.BAD_REQUEST);
    }
    const { role, ...dataWithout } = payload;

    const ckName = await this.prisma.user_guide.findFirst({
      where: {
        document_name: dataWithout?.document_name,
        id: {
          not: (id !== undefined && id !== null) ? Number(id) : -1,
        },
      },
    });

    if (ckName) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'มี document name นี้ในระบบ',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const userGuideEdit = await this.prisma.user_guide.update({
      where: {
        id: (id !== undefined && id !== null) ? Number(id) : -1,
      },
      data: {
        ...dataWithout,
        // active: true,
        update_date: getTodayNowAdd7().toDate(),
        update_by_account: {
          connect: {
            id: (userId !== undefined && userId !== null) ? Number(userId) : -1,
          },
        },
        update_date_num: getTodayNowAdd7().unix(),
      },
    });

    await this.prisma.user_guide_match.deleteMany({
      where: { user_guide_id: (id !== undefined && id !== null) ? Number(id) : -1 },
    });

    if (role?.length > 0) {
      await this.prisma.user_guide_match.createMany({
        data: role?.map((e: any) => {
          return { user_guide_id: userGuideEdit?.id, role_id: e?.id };
        }),
      });
    }

    return userGuideEdit;
  }

}
