import {
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as fs from 'fs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import buddhistEra from 'dayjs/plugin/buddhistEra';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import * as pdfMake from 'pdfmake/build/pdfmake';
import {
  vfs,
  logoPtt,
  used,
  notUsed,
  checkBoxCheck,
  checkBox,
} from '../fonts/vfs_fonts';
import isBetween from 'dayjs/plugin/isBetween';
import {
  getTodayEndAdd7,
  getTodayEndDDMMYYYYDfaultAdd7,
  getTodayEndYYYYMMDDDfaultAdd7,
  getTodayNow,
  getTodayNowAdd7,
  getTodayNowYYYYMMDDDfaultAdd7,
  getTodayStartAdd7,
  getTodayStartDDMMYYYYDfaultAdd7,
  getTodayStartYYYYMMDDDfaultAdd7,
  getYearEndAdd7,
  getYearStartAdd7,
} from 'src/common/utils/date.util';
import * as archiver from 'archiver';
import * as nodemailer from 'nodemailer';
import JSZip from 'jszip';
import { AllocationService } from 'src/allocation/allocation.service';
import { ExportFilesService } from 'src/export-files/export-files.service';
import { BalancingService } from 'src/balancing/balancing.service';
import axios from 'axios';
import {
  ABS_VALUE_ADJ_DAILY_NEGATIVE_IMB_TOLERANCE_ID,
  ABS_VALUE_ADJ_DAILY_POSITIVE_IMB_TOLERANCE_ID,
  DAMAGE_CHARGE_FEE_ID,
  DAMAGE_CO_EFF_ID,
  ENTRY_CAP_OVER_USE_CO_EFF_ID,
  EXIT_CAP_OVER_USE_CO_EFF_ID,
  EXIT_COMMDOITY_OVER_USE_FOR_ALL_CONTRACT_TYPE_CHARGE_FEE_ID,
  getCapacityChargeFeeSystemParameterIDByTermTypeID,
  getEntryCapacityOveruseChargeFeeSystemParameterIDByTermTypeID,
  getExitCapacityOveruseChargeFeeSystemParameterIDByTermTypeID,
  getExitCommodityChargeFeeSystemParameterIDByTermTypeID,
  getLatestSystemParameterValue,
  NEGATIVE_BAL_CHARGE_PENALTY_FEE_ID,
  POSITIVE_BAL_CHARGE_PENALTY_FEE_ID,
  systemParameterPopulate,
  systemParameterWithRelations,
  TARIFF_SYSTEM_PARAMETER,
} from 'src/common/utils/tariff.util';
import { parseToNumber } from 'src/common/utils/number.util';
import { middleNotiInapp } from 'src/common/utils/inapp.util';

dayjs.extend(isBetween);
dayjs.extend(isSameOrBefore);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);
dayjs.extend(buddhistEra);
dayjs.tz.setDefault('Asia/Bangkok');

@Injectable()
export class TariffService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private readonly allocationService: AllocationService,
    @Inject(forwardRef(() => ExportFilesService))
    private readonly exportFilesService: ExportFilesService,
    private readonly balancingService: BalancingService,
    private readonly configService: ConfigService,
  ) { }

  async useReqs(req: any) {
    const ip = req?.headers?.['x-forwarded-for'] || req?.ip;
    return {
      ip: ip,
      sub: req?.user?.sub,
      first_name: req?.user?.first_name,
      last_name: req?.user?.last_name,
      username: req?.user?.username,
      originalUrl: req?.originalUrl,
    };
  }

  async writeReq(reqUser: any, type: any, method: any, value: any) {
    const usedData = {
      reqUser: reqUser ? JSON.stringify(await this.useReqs(reqUser)) : null,
      type: type,
      method: method,
      value: JSON.stringify(value),
      id_value: value?.id,
      create_date: getTodayNowAdd7().toDate(),
      create_date_num: getTodayNowAdd7().unix(),
      module: 'TARIFF',
      ...(!!reqUser?.user?.sub && {
        create_by_account: {
          connect: {
            id: Number(reqUser?.user?.sub),
          },
        },
      }),
    };
    await this.prisma.history.create({
      data: usedData,
    });
    return true;
  }

  async tariffType() {
    const results = await this.prisma.tariff_type.findMany({
      orderBy: {
        id: 'asc',
      },
    });
    return results;
  }

  async tariffInvoiceSent() {
    const results = await this.prisma.tariff_invoice_sent.findMany({
      orderBy: {
        id: 'asc',
      },
    });
    return results;
  }

  async shipperMonthActive(date: any) {
    const todayStart = getTodayStartYYYYMMDDDfaultAdd7(date).toDate();
    const todayEnd = getTodayNowAdd7().toDate();
    const results = await this.prisma.group.findMany({
      where: {
        AND: [
          {
            start_date: {
              gte: todayStart, // start_date มากกว่านหรือเท่ากับสิ้นสุดวันนี้
            },
          },
          {
            OR: [
              { end_date: null }, // ถ้า end_date เป็น null
              { end_date: { gte: todayEnd } }, // ถ้า end_date ไม่เป็น null มากกว่าหรือเท่ากับเริ่มต้นวันนี้
            ],
          },
        ],
        id: {
          not: 1,
        },
        status: true,
        user_type_id: 3,
      },
      orderBy: {
        id: 'asc',
      },
    });
    return results;
  }

  async tariffChargeType() {
    const results = await this.prisma.tariff_type_charge.findMany({
      orderBy: {
        id: 'asc',
      },
    });
    return results;
  }

  async tariffChargeReportFindId(payload: any, userId: any) {
    const { month_year_charge, shipper_id } = payload;

    const base =
      month_year_charge && dayjs(month_year_charge).tz('Asia/Bangkok');
    const monthStart = base && base.startOf('month').toDate();
    const nextMonthStart =
      base && base.startOf('month').add(1, 'month').toDate();

    const results = await this.prisma.tariff.findMany({
      where: {
        ...(shipper_id && {
          shipper_id: Number(shipper_id),
        }),
        ...(month_year_charge && {
          month_year_charge: {
            gte: monthStart,
            lt: nextMonthStart,
          },
        }),
      },
      select: {
        id: true,
        tariff_id: true,
        shipper_id: true,
        month_year_charge: true,
        tariff_invoice_sent: true,
        tariff_invoice_sent_id: true,
      },
      orderBy: {
        id: 'desc',
      },
    });
    return results;
  }

  async chargeEdit(id: any, payload: any, userId: any) {
    const { quantity_operator, amount_operator } = payload;

    const nowAt = getTodayNowAdd7();

    const result = await this.prisma.$transaction(
      async (prisma) => {
        const result = await prisma.tariff_charge.update({
          where: {
            id: Number(id),
          },
          data: {
            quantity_operator: quantity_operator || null,
            amount_operator: amount_operator || null,
            update_date: nowAt.toDate(),
            update_date_num: nowAt.unix(),
            update_by_account: {
              connect: {
                id: Number(userId),
              },
            },
          },
        });

        await prisma.tariff.updateMany({
          where: {
            tariff_charge: {
              some: {
                id: result.tariff_id
              }
            },
            tariff_type_id: 1,
          },
          data: {
            tariff_type_id: 2,
          },
        });

        return result;
      },
      {
        timeout: 60000, // เพิ่มเป็น 1 นาที
        maxWait: 60000, // รอให้ transaction พร้อม
      },
    );

    return result;
  }

  async invoiceSent(id: any, payload: any, userId: any) {
    const nowAt = getTodayNowAdd7();

    const resultCkSelf = await this.prisma.tariff.findFirst({
      where: {
        id: Number(id),
      },
      select: {
        id: true,
        month_year_charge: true,
        shipper_id: true,
      },
    });

    if (!resultCkSelf?.month_year_charge) return [];

    const base = dayjs(resultCkSelf.month_year_charge).tz('Asia/Bangkok'); // ให้ชัวร์เรื่องโซนเวลา
    const monthStart = base.startOf('month').toDate();
    const nextMonthStart = base.startOf('month').add(1, 'month').toDate();

    const resultCk = await this.prisma.tariff.findMany({
      where: {
        id: {
          not: Number(id),
        },
        shipper_id: resultCkSelf?.shipper_id,
        month_year_charge: {
          gte: monthStart,
          lt: nextMonthStart, // ใช้ lt แทน lte endOf('month') เพื่อกันเศษวินาที
        },
      },
    });
    console.log('resultCk : ', resultCk);
    const idArr = resultCk?.map((e: any) => e?.id) || [];

    const result = await this.prisma.tariff.update({
      where: {
        id: Number(id),
      },
      data: {
        tariff_invoice_sent: {
          connect: {
            id: Number(1),
          },
        },
        update_date: nowAt.toDate(),
        update_date_num: nowAt.unix(),
        update_by_account: {
          connect: {
            id: Number(userId),
          },
        },
      },
    });

    await this.prisma.tariff.updateMany({
      where: {
        id: {
          in: idArr,
        },
      },
      data: {
        tariff_invoice_sent_id: 2,
      },
    });
    return result;
  }

  toArray(input: any): any[] {
    if (input == null) return [];
    if (Array.isArray(input)) return input;

    if (typeof input === 'string') {
      const s = input.trim();
      if (s === '') return [];

      // ลอง parse JSON ก่อน (เช่น '["a","b"]', '123', 'true', 'null')
      try {
        const parsed = JSON.parse(s);
        return Array.isArray(parsed) ? parsed : (parsed == null ? [] : [parsed]);
      } catch {
        // ไม่ใช่ JSON → รองรับ comma-separated เช่น 'a,b,c'
        if (s.includes(',')) {
          return s.split(',').map(x => x.trim()).filter(Boolean);
        }
        return [s]; // สตริงเดี่ยว
      }
    }

    // กรณี object/number/boolean
    return [input];
  }

  async tariffChargeReportFindAll(payload: any, userId: any) {
    const { month_year_charge, id, limit, offset } = payload;
    const limit_ = Number(limit);
    const offset_ = Number(offset);

    const group = await this.prisma.group.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: Number(userId),
          },
        },
      },
      select: {
        id: true,
        user_type: {
          select: {
            id: true,
          },
        },
      },
    });
    const userTypeId = group?.user_type?.id;
    const groupId = group?.id;

    console.log('payload : ', payload);

    const todayStartMY =
      (month_year_charge &&
        getTodayStartYYYYMMDDDfaultAdd7(month_year_charge).toDate()) ||
      null;
    // const ids = (id && Number(id)) || null; 

    // console.log('ids : ', ids);
    const results = await this.prisma.tariff.findMany({
      where: {
        ...(userTypeId === 3 && {
          shipper_id: groupId,
        }),
        ...(todayStartMY && {
          month_year_charge: todayStartMY,
        }),
        // ...(ids && {
        //   id: ids,
        // }),
        ...(this.toArray(id).length > 0 && {
          id: {
            in: this.toArray(id)
          }
        }),
      },
      skip: Number(offset_),
      take: Number(limit_),
      include: {
        shipper: {
          select: {
            id: true,
            name: true,
            id_name: true,
          },
        },
        tariff_type: true,
        tariff_comment: {
          include: {
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
        },
        tariff_invoice_sent: true,
        tariff_type_ab: true,
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
    const count = await this.prisma.tariff.count({
      where: {
        ...(userTypeId === 3 && {
          shipper_id: groupId,
        }),
        ...(todayStartMY && {
          month_year_charge: todayStartMY,
        }),
        // ...(ids && {
        //   id: ids,
        // }),
        ...(this.toArray(id).length > 0 && {
          id: {
            in: this.toArray(id)
          }
        }),
      },
    });

    // คอลัมน์ Amount Operator (Bath) มาจากค่า Quantity Operator x Fee
    // ในกรณีที่เป็น Type Damage
    // Charge จะเป็น Quantity Operator x Coefficient x Fee
    //  | ทศนิยม 2 ตำแหน่ง

    // คอลัมน์ Amount Compare (Bath)
    // ถ้ามีค่า amount operator เอาค่านี้ขึ้นก่อน
    // ถ้าไม่มี operator ค่อยมาเอา amount
    // ยึด operator เป็นหลัก

    // คอลัมน์ Difference
    // คอลัมน์ Amount Operator - คอลัมน์ Amount Compare

    return {
      total: count,
      data: results,
    };
  }

  async chargeFindAll(payload: any, userId: any) {
    const { id, contractCode, comodity, limit, offset } = payload;
    const limit_ = Number(limit);
    const offset_ = Number(offset);
    const contractCodeArr = (contractCode && JSON.parse(contractCode)) || [];

    const group = await this.prisma.group.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: Number(userId),
          },
        },
      },
      select: {
        id: true,
        user_type: {
          select: {
            id: true,
          },
        },
      },
    });
    const userTypeId = group?.user_type?.id;
    const groupId = group?.id;

    const results = await this.prisma.tariff_charge.findMany({
      where: {
        // ...(userTypeId === 3 && {
        //   shipper_id: groupId,
        // }),
        ...(contractCodeArr.length > 0 && {
          contract_code: {
            id: {
              in: contractCodeArr,
            },
          },
        }),
        ...(comodity && {
          OR: [{ comonity_type: Number(comodity) }, { comonity_type: null }],
        }),
        tariff_id: Number(id),
      },
      skip: Number(offset_),
      take: Number(limit_),
      include: {
        tariff_type_charge: true,
        contract_code: true,
        term_type: true,
        tariff: {
          include: {
            shipper: {
              select: {
                id: true,
                name: true,
                id_name: true,
              },
            },
            tariff_type: true,
            tariff_comment: {
              include: {
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
            },
            tariff_compare: {
              include: {
                compare_with: true,
              },
              orderBy: {
                create_date: 'desc',
              },
              take: 1,
            },
            tariff_invoice_sent: true,
            tariff_type_ab: true,
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
    const count = await this.prisma.tariff_charge.count({
      where: {
        ...(contractCodeArr.length > 0 && {
          contract_code: {
            id: {
              in: contractCodeArr,
            },
          },
        }),
        ...(comodity && {
          OR: [{ comonity_type: Number(comodity) }, { comonity_type: null }],
        }),
        tariff_id: Number(id),
      },
    });
    return {
      total: count,
      data: results,
    };
  }

  async chargeView(payload: any, userId: any) {
    const { id } = payload;

    const results = await this.prisma.tariff_view_date.findMany({
      where: {
        tariff_charge_id: Number(id),
      },
      include: {
        tariff_charge: {
          include: {
            contract_code: true,
            tariff: {
              include: {
                shipper: true,
              },
            },
            tariff_type_charge: true,
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

    if (results?.length > 0) {
      const resultsFinal = results?.map((e: any) => {
        const { temps, ...nE } = e;
        const data = (temps && JSON.parse(temps)) || [];
        return {
          ...nE,
          data,
        };
      });

      return resultsFinal;
    } else {
      const result = await this.prisma.tariff_charge.findFirst({
        where: {
          id: Number(id),
        },
        include: {
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

      return [
        {
          tariff_charge: result,
        },
      ];
    }
  }

  async comments(payload: any, userId: any) {
    const { id, comment } = payload;
    const nowAt = getTodayNowAdd7();

    const result = await this.prisma.tariff_comment.create({
      data: {
        tariff: {
          connect: {
            id: Number(id),
          },
        },
        comment: comment || null,
        create_date: nowAt.toDate(),
        create_date_num: nowAt.unix(),
        create_by_account: {
          connect: {
            id: Number(userId),
          },
        },
      },
    });

    await this.prisma.tariff.updateMany({
      where: {
        id: Number(id),
      },
      data: {
        update_date: nowAt.toDate(),
        update_date_num: nowAt.unix(),
        update_by: Number(userId),
      },
    });

    return result;
  }

  async runtariff(payload: any, userId: any) {
    const { month_year, shipper_id } = payload;
    const todayStart = getYearStartAdd7().toDate();
    const todayEnd = getYearEndAdd7().toDate();

    const shipperMaster = await this.prisma.group.findFirst({
      where: {
        id: Number(shipper_id),
      },
      select: {
        id: true,
        id_name: true,
        name: true,
      },
    });


    try {
      const todayStartMY = getTodayStartYYYYMMDDDfaultAdd7(month_year).toDate();
      const todayEndMY = getTodayNowAdd7(month_year).toDate();
      const nowAt = getTodayNowAdd7();
      const formateDDMMYYYY = dayjs(month_year, 'YYYY-MM-DD').format(
        'DD/MM/YYYY',
      );

      let monthStartDayjs: dayjs.Dayjs | null = null;
      let monthEndDayjs: dayjs.Dayjs | null = null;
      try {
        const base = getTodayNowAdd7(month_year);
        if (base.isValid()) {
          monthStartDayjs = base.startOf('month');
          monthEndDayjs = base.endOf('month');
        }
      } catch (error) {
        console.log('Get start and end of month error : ', error);
      }
      const monthStart =
        monthStartDayjs?.tz('Asia/Bangkok')?.format('YYYY-MM-DD') ?? '';
      const monthEnd =
        monthEndDayjs?.tz('Asia/Bangkok')?.format('YYYY-MM-DD') ?? '';



      // 1 System คือยังไม่มีการ Edit
      // 2 Manual คือ มีการ edit ค่าแล้ว
      // 20241021-TAR-0002-A (13:08:45)
      // 20241021-TAR-0002-B (13:08:45)
      // Tariff ID-A คำนวณค่าแต่ละรายการโดยยังไม่ปัดทศนิยมแบบ Round และจะปัดทศนิยมครั้งเดียวที่ผลรวม
      // Tariff ID-B การคำนวณค่าแต่ละรายการ ให้ปัดทศนิยมแบบ Round ได้เลย และปัดทศนิยมอีกครั้งเมื่อแสดงผลรวม

      // term_type_id 1, 2, 3 M | 4 D
      // file_period_mode

      // ...


      // Create array of all TARIFF_SYSTEM_PARAMETER enum values dynamically
      const tariffSystemParameterIds = Object.values(
        TARIFF_SYSTEM_PARAMETER,
      ).filter((value) => typeof value === 'number') as number[];

      const systemParameter: systemParameterWithRelations[] =
        await this.prisma.system_parameter.findMany({
          where: {
            system_parameter: {
              id: {
                in: tariffSystemParameterIds,
              },
            },
            AND: [
              {
                start_date: {
                  lte: monthEndDayjs?.toDate() ?? todayEnd, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
                },
              },
              {
                OR: [
                  { end_date: null }, // ถ้า end_date เป็น null
                  { end_date: { gte: monthStartDayjs?.toDate() ?? todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
                ],
              },
            ],
          },
          ...systemParameterPopulate,
        });

      // 
      let entryCapOverCoEff = getLatestSystemParameterValue(systemParameter, [
        ENTRY_CAP_OVER_USE_CO_EFF_ID,
      ]);
      let exitCapOverCoEff = getLatestSystemParameterValue(systemParameter, [
        EXIT_CAP_OVER_USE_CO_EFF_ID,
      ]);
      let damageCoEff = getLatestSystemParameterValue(systemParameter, [
        DAMAGE_CO_EFF_ID,
      ]);
      exitCapOverCoEff = exitCapOverCoEff ? String(exitCapOverCoEff) : null;
      entryCapOverCoEff = entryCapOverCoEff ? String(entryCapOverCoEff) : null;
      damageCoEff = damageCoEff ? String(damageCoEff) : null;
      const comodityFeeShipper = getLatestSystemParameterValue(systemParameter, [
        EXIT_COMMDOITY_OVER_USE_FOR_ALL_CONTRACT_TYPE_CHARGE_FEE_ID,
      ]);
      const imbalancesPenaltyPositiveFee = getLatestSystemParameterValue(
        systemParameter,
        [POSITIVE_BAL_CHARGE_PENALTY_FEE_ID],
      );
      const imbalancesPenaltyNegativeFee = getLatestSystemParameterValue(
        systemParameter,
        [NEGATIVE_BAL_CHARGE_PENALTY_FEE_ID],
      );
      const damageChargeFee = getLatestSystemParameterValue(systemParameter, [
        DAMAGE_CHARGE_FEE_ID,
      ]);
      const toleranceP = getLatestSystemParameterValue(systemParameter, [
        ABS_VALUE_ADJ_DAILY_POSITIVE_IMB_TOLERANCE_ID,
      ]);
      const toleranceN = getLatestSystemParameterValue(systemParameter, [
        ABS_VALUE_ADJ_DAILY_NEGATIVE_IMB_TOLERANCE_ID,
      ]);

      const zoneMaster = await this.prisma.zone.findMany({
        where: {
          AND: [
            {
              start_date: {
                lte: todayEnd, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
              },
            },
            {
              OR: [
                { end_date: null }, // ถ้า end_date เป็น null
                { end_date: { gte: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
              ],
            },
          ],
        },
      });

      const areaMaster = await this.prisma.area.findMany({
        where: {
          AND: [
            {
              start_date: {
                lte: todayEnd, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
              },
            },
            {
              OR: [
                { end_date: null }, // ถ้า end_date เป็น null
                { end_date: { gte: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
              ],
            },
          ],
        },
      });

      const tariffData = {
        shipper: {
          connect: {
            id: Number(shipper_id),
          },
        },
        month_year_charge: getTodayNowAdd7(month_year).toDate(),
        tariff_type: {
          connect: {
            id: Number(1),
          },
        },
        tariff_invoice_sent: {
          connect: {
            id: Number(2),
          },
        },
        create_date: nowAt.toDate(),
        create_date_num: nowAt.unix(),
        create_by_account: {
          connect: {
            id: Number(userId),
          },
        },
      };

      // contract
      const contract_code = await this.prisma.contract_code.findMany({
        where: {
          AND: [
            {
              group_id: shipper_id,
            },
            { contract_start_date: { lte: monthEndDayjs?.toDate() ?? todayEnd } }, // Started before or on target date
            // Not rejected
            {
              status_capacity_request_management: {
                NOT: {
                  id: 3,
                  // name: {
                  //   equals: 'Rejected',
                  //   mode: 'insensitive',
                  // },
                },
              },
            },
            // If terminate_date exists and targetDate >= terminate_date, exclude (inactive)
            {
              OR: [
                { terminate_date: null }, // No terminate date
                {
                  terminate_date: { gt: monthStartDayjs?.toDate() ?? todayStart },
                }, // Terminate date is after target date
              ],
            },
            // Use extend_deadline if available, otherwise use contract_end_date
            {
              OR: [
                // If extend_deadline exists, use it as end date
                {
                  AND: [
                    { extend_deadline: { not: null } },
                    {
                      extend_deadline: {
                        gt: monthStartDayjs?.toDate() ?? todayStart,
                      },
                    },
                  ],
                },
                // If extend_deadline is null, use contract_end_date
                {
                  AND: [
                    { extend_deadline: null },
                    {
                      OR: [
                        { contract_end_date: null },
                        {
                          contract_end_date: {
                            gt: monthStartDayjs?.toDate() ?? todayStart,
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          // group_id: shipper_id,
          // status_capacity_request_management_id: 2,
          // status_capacity_request_management_process_id: 1,
          // AND: [
          //   {
          //     contract_start_date: {
          //       lte: todayStartMY, // start_date มากกว่านหรือเท่ากับสิ้นสุดวันนี้
          //     },
          //   },
          //   {
          //     OR: [
          //       { contract_end_date: null }, // ถ้า end_date เป็น null
          //       { contract_end_date: { gte: todayEndMY } }, // ถ้า end_date ไม่เป็น null น้อยกว่าหรือเท่ากับเริ่มต้นวันนี้
          //     ],
          //   },
          // ],
        },
        include: {
          term_type: true,
          booking_version: {
            where: {
              flag_use: true,
            },
            include: {
              booking_row_json: true,
              booking_full_json: true,
              booking_row_json_release: true,
              booking_full_json_release: true,
            },
            take: 1,
            orderBy: {
              id: 'desc',
            },
          },
        },
      });

      const contract_code_final = contract_code.map((e: any) => {
        const { booking_version, ...nE } = e;
        const booking_version_use = booking_version?.[0];
        const booking_full_json_use = booking_version_use?.booking_full_json_release?.length > 0 ?
          (booking_version_use?.booking_full_json_release?.[0]?.data_temp && JSON.parse(booking_version_use?.booking_full_json_release?.[0]?.data_temp))
          : (booking_version_use?.booking_full_json?.[0]?.data_temp && JSON.parse(booking_version_use?.booking_full_json?.[0]?.data_temp))
          || null;

        const entryDailyBooking =
          booking_full_json_use?.['headerEntry']?.[
          'Capacity Daily Booking (MMBTU/d)'
          ];
        const keyHead = entryDailyBooking?.[formateDDMMYYYY]?.['key'];

        let shortTermNonFirmKeyHead = [];
        if (e?.term_type_id === 4) {
          const formateMMYYYY = getTodayStartYYYYMMDDDfaultAdd7(month_year)
            .tz('Asia/Bangkok')
            .format('MM/YYYY');
          shortTermNonFirmKeyHead = Object.keys(entryDailyBooking)
            .filter((key: any) => key.includes(`/${formateMMYYYY}`))
            .map((key: any) => entryDailyBooking[key]?.['key']);
        }

        const booking_row_json_use = (
          booking_version?.booking_full_json_release?.length > 0
            ? booking_version?.[0]?.booking_row_json_release
            : booking_version?.[0]?.booking_row_json
            || []
        )?.map(
          (brj: any) => {
            const {
              data_temp,
              id,
              zone_text,
              area_text,
              entry_exit_id,
              ...nBrj
            } = brj;
            const row_json_use = (data_temp && JSON.parse(data_temp)) || null;
            console.log('row_json_use : ', row_json_use);
            console.log('keyHead : ', keyHead);
            console.log('row_json_use?.[keyHead] : ', row_json_use?.[keyHead]);
            const useData = {
              key: keyHead || null,
              contractPoint: row_json_use?.[0] || null,
              capacityMMBTUValue: row_json_use?.[keyHead] || null,
            };
            let shortTermNonFirmUseData = [];
            if (shortTermNonFirmKeyHead.length > 0) {
              let capacityMMBTUValue: number | null = null;
              shortTermNonFirmUseData = shortTermNonFirmKeyHead.map(
                (key: any) => {
                  const value = row_json_use?.[key] || null;
                  if (value) {
                    const valueNumber: number | null = parseToNumber(value);
                    if (valueNumber) {
                      if (capacityMMBTUValue) {
                        capacityMMBTUValue = capacityMMBTUValue + valueNumber;
                      } else {
                        capacityMMBTUValue = valueNumber;
                      }
                    }
                  }

                  return {
                    key,
                    capacityMMBTUValue: value,
                  };
                },
              );
              useData.capacityMMBTUValue = capacityMMBTUValue;
            }

            return {
              id,
              zone_text,
              area_text,
              entry_exit_id,
              ...useData,
              shortTermNonFirmUseData,
              areaObj:
                areaMaster?.find((f: any) => {
                  return (
                    f?.entry_exit_id === entry_exit_id && f?.name === area_text
                  );
                }) || null,
              zoneObj:
                zoneMaster?.find((f: any) => {
                  return (
                    f?.entry_exit_id === entry_exit_id && f?.name === zone_text
                  );
                }) || null,
            };
          },
        );

        return {
          ...nE,
          booking_version_id: booking_version?.[0]?.id || null,
          keyHead: keyHead,
          booking_row_json_use,
        };
      });
      console.log('-----');
      // allocation
      const allocationReportViewGet =
        await this.allocationService.allocationReportViewGet(
          { start_date: monthStart, end_date: monthEnd, skip: 0, limit: 10000 },
          userId,
        );

      // console.log('allocationReportViewGet : ', allocationReportViewGet);
      const allocationReportViewGetPublic = allocationReportViewGet
        ?.filter((f: any) => {
          return (
            f?.publication &&
            f?.shipper === shipperMaster?.id_name &&
            contract_code?.some((e: any) => e?.contract_code == f?.contract)
          );
        })
        // ?.filter((f: any) => f?.publication)
        // ?.filter((f: any) => f?.shipper === shipperMaster?.id_name)
        // ?.filter((f: any) =>
        //   f?.contract?.includes(contract_code?.map((e: any) => e?.id_name)),
        // )
        ?.map((e: any) => {
          const contract = contract_code?.find(
            (f: any) => f?.contract_code === e?.contract,
          );
          return {
            contract_code_id: contract?.id,
            term_type: contract?.term_type,
            ...e,
          };
        });

      console.log('allocationReportViewGetPublic : ', allocationReportViewGetPublic);

      const allocationReportViewGetPublicNoFuel =
        allocationReportViewGetPublic?.filter(
          (f: any) => f?.customer_type !== 'Fuel',
        );
      const Fuel = allocationReportViewGetPublic?.filter(
        (f: any) => f?.customer_type === 'Fuel',
      );
      const allocationReportViewGetPublicExit =
        allocationReportViewGetPublicNoFuel?.filter(
          (f: any) => f?.entry_exit === 'EXIT',
        );

      console.log('--- allocationReportViewGetPublicExit : ', allocationReportViewGetPublicExit);
      // tempDateArr
      const contractGrouped = {};
      for (const curr of allocationReportViewGetPublicExit) {
        const key = `${curr.contract}`;
        if (!contractGrouped[key]) {
          contractGrouped[key] = {
            contract_code_id: curr.contract_code_id || null,
            contract: curr.contract || null,
            term_type_id: curr.term_type?.id || null,
            term_type: curr.term_type?.name || null,
            data: [],
          };
        }
        contractGrouped[key].data.push({ ...curr });
      }
      console.log('--- contractGrouped : ', contractGrouped);

      const finalContract: any = Object.values(contractGrouped)?.filter(
        (f: any) => f?.term_type_id !== null,
      ); // Comodity by contract
      console.log('--- finalContract : ', finalContract);
      const termGrouped = {};
      for (const curr of allocationReportViewGetPublicExit) {
        const key = `${curr.term_type?.id}`;
        if (!termGrouped[key]) {
          termGrouped[key] = {
            id: null,
            contract: null,
            term_type_id: curr.term_type?.id || null,
            term_type: curr.term_type?.name || null,
            data: [],
          };
        }
        termGrouped[key].data.push({ ...curr });
      }
      const finalTerm: any = Object.values(termGrouped)?.filter(
        (f: any) => f?.term_type_id !== null,
      ); // Comodity by shipper

      // A : SUM((Point A (Exit) ค่าทั้งเดือน = 3100.3770 ~ 3100 ) + (Point B (Exit) ค่าทั้งเดือน = 3100.7000 ~ 3101 ) + (Point C (Exit) ค่าทั้งเดือน = 3100.7000 ~ 3101 )) -> 9302
      const groupDatas = (arr: any, keys: any) => {
        const nGrouped = {};
        for (const curr of arr) {
          const key = `${curr[keys]}`;
          if (!nGrouped[key]) {
            nGrouped[key] = {
              [keys]: curr[keys],
              data: [],
            };
          }
          nGrouped[key].data.push({ ...curr });
        }
        const resultData = Object.values(nGrouped);
        return resultData;
      };

      // ใช้ nominatedValue ตามพีบีมบอก | key ที่เหลือ allocatedValue, contractCapacity เผื่อเปลี่ยน
      const comodityByContractA = finalContract?.map((e: any) => {
        const { id, contract_code_id, contract, term_type_id, term_type, data } =
          e;
        const nom = groupDatas(data, 'point');
        console.log('nom : ', nom);
        const value = nom?.map((n: any) => {
          const dValue = n?.['data']
            ?.map((dV: any) => {
              return (
                // dV?.values?.find((f: any) => f?.tag === 'nominatedValue') // allocatedValue หรือ nominatedValue
                dV?.values?.find((f: any) => f?.tag === 'allocatedValue') // allocatedValue หรือ nominatedValue // https://app.clickup.com/t/86euzxxkm
                  ?.value ?? 0
              );
            })
            ?.reduce(
              (accumulator, currentValue) => accumulator + currentValue,
              0,
            );
          return {
            point: n?.point,
            customer_type: n?.customer_type,
            calc: dValue || dValue === 0 ? Math.round(dValue) : 0,
            calcNotRound: dValue ?? 0,
            tempDateArr: n?.['data'] || [],
          };
        });

        const quantity = value?.reduce(
          (accumulator, currentValue) => accumulator + currentValue?.calc,
          0,
        );

        const totalNotRound = value?.reduce(
          (accumulator, currentValue) => accumulator + currentValue?.calcNotRound,
          0,
        );

        return {
          id: id || null,
          contract_code_id: contract_code_id || null,
          contract: contract || null,
          term_type_id: term_type_id || null,
          term_type: term_type || null,
          value: value ?? 0,
          quantity: quantity ?? 0,
          totalNotRound: totalNotRound ?? 0,
          type: 'comodityByContract',
        };
      });

      console.log('comodityByContractA : ', comodityByContractA);

      const comodityByShipperA = finalTerm?.map((e: any) => {
        const { id, contract, term_type_id, term_type, data } = e;
        const nom = groupDatas(data, 'point');
        const value = nom?.map((n: any) => {
          const dValue = n?.['data']
            ?.map((dV: any) => {
              return (
                // dV?.values?.find((f: any) => f?.tag === 'nominatedValue')
                dV?.values?.find((f: any) => f?.tag === 'allocatedValue') // // allocatedValue หรือ nominatedValue // https://app.clickup.com/t/86euzxxkm
                  ?.value ?? 0
              );
            })
            ?.reduce(
              (accumulator, currentValue) => accumulator + currentValue,
              0,
            );
          return {
            point: n?.point,
            customer_type: n?.customer_type,
            calc: dValue || dValue === 0 ? Math.round(dValue) : 0,
            calcNotRound: dValue ?? 0,
            tempDateArr: n?.['data'] || [],
          };
        });

        const quantity = value?.reduce(
          (accumulator, currentValue) => accumulator + currentValue?.calc,
          0,
        );

        const totalNotRound = value?.reduce(
          (accumulator, currentValue) => accumulator + currentValue?.calcNotRound,
          0,
        );

        return {
          id: id || null,
          contract: contract || null,
          term_type_id: term_type_id || null,
          term_type: term_type || null,
          value: value ?? 0,
          quantity: quantity ?? 0,
          totalNotRound: totalNotRound ?? 0,
          type: 'comodityByShipper',
        };
      });

      const comodityA = [...comodityByContractA, ...comodityByShipperA];

      // B : SUM( Gas Day 01-05-2025((Point A (Exit) sum ค่ารายวัน = 100.0121) + (Point B (Exit) sum ค่ารายวัน = 100.0226) + (Point C (Exit) sum ค่ารายวัน = 100.0226) ( -> 300.0573 ~ 300) ) + Gas Day วันต่อไป .... )
      const comodityByContractB = finalContract?.map((e: any) => {
        const { id, contract_code_id, contract, term_type_id, term_type, data } =
          e;
        const dayGroup = groupDatas(data, 'gas_day');
        const day = dayGroup?.map((dG: any) => {
          const { contract, term_type_id, term_type, data: dataDay } = dG;
          const nom = groupDatas(dataDay, 'point');
          const value = nom?.map((n: any) => {
            const dValue = n?.['data']
              ?.map((dV: any) => {
                return (
                  // dV?.values?.find((f: any) => f?.tag === 'nominatedValue') 
                  dV?.values?.find((f: any) => f?.tag === 'allocatedValue') // allocatedValue หรือ nominatedValue // https://app.clickup.com/t/86euzxxkm
                    ?.value ?? 0
                );
              })
              ?.reduce(
                (accumulator, currentValue) => accumulator + currentValue,
                0,
              );
            return {
              point: n?.point,
              customer_type: n?.customer_type,
              calc: dValue || dValue === 0 ? Math.round(dValue) : 0,
              calcNotRound: dValue ?? 0,
              tempDateArr: n?.['data'] || [],
            };
          });

          const totalRoundRound = value?.reduce(
            (accumulator, currentValue) => accumulator + currentValue?.calc,
            0,
          );

          const totalNotRound = value?.reduce(
            (accumulator, currentValue) =>
              accumulator + currentValue?.calcNotRound,
            0,
          );
          return {
            gas_day: dG?.gas_day || null,
            value: value ?? 0,
            totalRoundRound: totalRoundRound ?? 0,
            totalNotRound: totalNotRound ?? 0,
          };
        });

        const quantity = day?.reduce(
          (accumulator, currentValue) =>
            accumulator + currentValue?.totalRoundRound,
          0,
        );
        const totalNotRound = day?.reduce(
          (accumulator, currentValue) =>
            accumulator + currentValue?.totalNotRound,
          0,
        );

        return {
          id: id || null,
          contract_code_id: contract_code_id || null,
          contract: contract || null,
          term_type_id: term_type_id || null,
          term_type: term_type || null,
          day,
          quantity: quantity ?? 0,
          totalNotRound: totalNotRound ?? 0,
          type: 'comodityByContract',
        };
      });

      const comodityByShipperB = finalTerm?.map((e: any) => {
        const { id, contract, term_type_id, term_type, data } = e;
        const dayGroup = groupDatas(data, 'gas_day');
        const day = dayGroup?.map((dG: any) => {
          const { contract, term_type_id, term_type, data: dataDay } = dG;
          const nom = groupDatas(dataDay, 'point');
          const value = nom?.map((n: any) => {
            const dValue = n?.['data']
              ?.map((dV: any) => {
                return (
                  // dV?.values?.find((f: any) => f?.tag === 'nominatedValue')
                  dV?.values?.find((f: any) => f?.tag === 'allocatedValue') // // allocatedValue หรือ nominatedValue // https://app.clickup.com/t/86euzxxkm
                    ?.value ?? 0
                );
              })
              ?.reduce(
                (accumulator, currentValue) => accumulator + currentValue,
                0,
              );
            return {
              point: n?.point,
              customer_type: n?.customer_type,
              calc: dValue || dValue === 0 ? Math.round(dValue) : 0,
              calcNotRound: dValue ?? 0,
              tempDateArr: n?.['data'] || [],
            };
          });

          const totalRoundRound = value?.reduce(
            (accumulator, currentValue) => accumulator + currentValue?.calc,
            0,
          );

          const totalNotRound = value?.reduce(
            (accumulator, currentValue) =>
              accumulator + currentValue?.calcNotRound,
            0,
          );
          return {
            gas_day: dG?.gas_day || null,
            value: value ?? 0,
            totalRoundRound: totalRoundRound ?? 0,
            totalNotRound: totalNotRound ?? 0,
          };
        });

        const quantity = day?.reduce(
          (accumulator, currentValue) =>
            accumulator + currentValue?.totalRoundRound,
          0,
        );
        const totalNotRound = day?.reduce(
          (accumulator, currentValue) =>
            accumulator + currentValue?.totalNotRound,
          0,
        );

        // const toleranceP =
        //       systemParameter?.find((f: any) => {
        //         const idSP = 44;
        //         return f?.system_parameter_id === idSP;
        //       })?.value || null;

        return {
          id: id || null,
          contract: contract || null,
          term_type_id: term_type_id || null,
          term_type: term_type || null,
          day,
          quantity: quantity ?? 0,
          totalNotRound: totalNotRound ?? 0,
          type: 'comodityByShipper',
        };
      });

      const comodityB = [...comodityByContractB, ...comodityByShipperB];

      // balance report

      const balancReport: any = await this.balancingService.balancReport(
        { start_date: monthStart, end_date: monthEnd, skip: 0, limit: 10000 },
        userId,
      );
      const balancReportArr = balancReport?.data || [];
      const balancReportClean = balancReportArr
        ?.filter((e: any) =>
          e?.shipper_data?.some(
            (shipperData: any) => shipperData?.shipper === shipperMaster?.id_name,
          ),
        )
        ?.map((e: any) => {
          const {
            request_number,
            execute_timestamp,
            gas_day,
            shipper_data,
            values,
            ...nE
          } = e;

          const shipperData =
            shipper_data?.filter(
              (f: any) => f?.shipper === shipperMaster?.id_name,
            ) || [];
          const shipperDataObj = shipperData.length > 0 ? shipperData[0] : null;

          const findTag = (keyArr: any) => {
            const valTag = keyArr
              ?.map((ka: any) => {
                const findValues = shipperDataObj?.['values']?.find(
                  (f: any) => f?.tag === ka,
                )?.value;
                return findValues;
              })
              ?.filter((f: any) => !!f);
            const cK =
              valTag?.length === 0
                ? null
                : valTag.reduce(
                  (accumulator, currentValue) => accumulator + currentValue,
                  0,
                );
            return cK;
          };
          const aip =
            shipperDataObj?.['values']?.find((f: any) => f?.tag === 'aip')
              ?.value || null;
          const ain =
            shipperDataObj?.['values']?.find((f: any) => f?.tag === 'ain')
              ?.value || null;

          const getFuel =
            Fuel?.find((f: any) => f?.gas_day === gas_day)?.values?.find(
              (f: any) => f?.tag === 'nominatedValue',
            )?.value || null;
          const entryValue =
            findTag([
              'total_entry_east',
              'total_entry_west',
              'total_entry_east-west',
            ]) ??
            // ?? (shipperDataObj?.contract_data
            //   ?.map((contractData: any) =>
            //     contractData?.values
            //       ?.filter((value: any) => value?.tag?.includes('total_entry_') && value?.value)
            //       ?.map((value: any) => value.value)
            //       ?.reduce(
            //         (accumulator, currentValue) => {
            //           if(accumulator){
            //             return accumulator + currentValue
            //           }
            //           return currentValue
            //         },
            //         null,
            //       )
            //   )
            //   ?.reduce(
            //     (accumulator, currentValue) => {
            //       if(accumulator){
            //         return accumulator + currentValue
            //       }
            //       return currentValue
            //     },
            //     null,
            //   )
            // )
            null;

          const exitValue =
            findTag([
              'total_exit_east',
              'total_exit_west',
              'total_exit_east-west',
            ]) ??
            // ?? (shipperDataObj?.contract_data
            //   ?.map((contractData: any) =>
            //     contractData?.values
            //       ?.filter((value: any) => value?.tag?.includes('total_exit_') && value?.value)
            //       ?.map((value: any) => value.value)
            //       ?.reduce(
            //         (accumulator, currentValue) => {
            //           if(accumulator){
            //             return accumulator + currentValue
            //           }
            //           return currentValue
            //         },
            //         null,
            //       )
            //   )
            //   ?.reduce(
            //     (accumulator, currentValue) => {
            //       if(accumulator){
            //         return accumulator + currentValue
            //       }
            //       return currentValue
            //     },
            //     null,
            //   )
            // )
            null;

          const positive =
            aip !== null && toleranceP !== null && entryValue !== null
              ? aip - Number(toleranceP) - entryValue
              : null;
          const negative =
            ain !== null && toleranceN !== null && entryValue !== null
              ? ain - Number(toleranceN) - entryValue
              : null;

          return {
            gas_day,
            entry: entryValue,
            exit: exitValue,
            fuel_gas: getFuel || null,
            balancing_gas: findTag(['reserveBal_east', 'reserveBal_west']),
            change_in_ivent: findTag([
              'minInventoryChange_east',
              'minInventoryChange_west',
              'minInventoryChange_east-west',
            ]),
            shrinkage: findTag([
              'shrinkage_east',
              'shrinkage_west',
              'shrinkage_east-west',
            ]),
            commissioning: findTag([
              'commissioningGas_east',
              'commissioningGas_west',
            ]),
            gas_vent: findTag(['ventGas_east', 'ventGas_west']),
            other_gas: findTag(['otherGas_east', 'otherGas_west']),
            imbalance: findTag(['dailyImb_east', 'dailyImb_west']),
            imbalance_over_5_percen: null,
            positive: positive,
            negative: negative,
          };
        });
      const positive = balancReportClean?.map((e: any) => {
        const { imbalance_over_5_percen, positive, negative, ...nE } = e;
        return {
          ...nE,
          imbalance_over_5_percen:
            positive !== null ? (positive <= 0 ? 0 : positive) : null,
        };
      });
      const negative = balancReportClean?.map((e: any) => {
        const { imbalance_over_5_percen, positive, negative, ...nE } = e;
        return {
          ...nE,
          imbalance_over_5_percen:
            negative !== null ? (negative <= 0 ? 0 : negative) : null,
        };
      });

      // a & b
      const imbalancesPenaltyPositive = {
        id: null,
        contract: null,
        term_type_id: null,
        term_type: null,
        quantity: positive
          ?.map((f: any) => f?.imbalance_over_5_percen)
          ?.filter((f: any) => f !== null)
          ?.reduce((accumulator, currentValue) => accumulator + currentValue, 0),
        data: positive,
      };

      // a & b
      const imbalancesPenaltyNegative = {
        id: null,
        contract: null,
        term_type_id: null,
        term_type: null,
        quantity: negative
          ?.map((f: any) => f?.imbalance_over_5_percen)
          ?.filter((f: any) => f !== null)
          ?.reduce((accumulator, currentValue) => accumulator + currentValue, 0),
        data: negative,
      };

      // AIP Positive
      // aip − Tolerance × Entry
      // เอาค่ามาจาก AIP ของเมนู Balance Report ตรง row ฟ้า shipper_data
      // Tolerance = DAM > System Parameter
      // Entry =  Total Entry ของ row สีฟ้า (sum ทุก zone รวมกัน)

      // ถ้าค่าที่คำนวณ > 0 เป็นค่าเดิม
      // ถ้า <=0 ให้แสดงเป็น 0

      // AIN Negative
      // ain − Tolerance × Entry
      // เอาค่ามาจาก AIP ของเมนู Balance Report ตรง row ฟ้า shipper_data
      // Tolerance = DAM > System Parameter
      // Entry =  Total Entry ของ row สีฟ้า (sum ทุก zone รวมกัน)

      // ถ้าค่าที่คำนวณ > 0 เป็นค่าเดิม
      // ถ้า <=0 ให้แสดงเป็น 0

      // return {
      //   // Fuel,
      //   imbalancesPenaltyPositive,
      //   imbalancesPenaltyNegative,
      // }

      // allocationReport
      const allocationReport = await this.allocationService.allocationReport(
        {
          start_date: monthStart,
          end_date: monthEnd,
          skip: 0,
          limit: 10000,
          tab: '1',
        },
        userId,
      );
      console.log('allocationReport : ', allocationReport);
      console.log('shipperMaster?.id_name : ', shipperMaster?.id_name);
      // console.log('contract_code : ', contract_code);
      const allocationReportViewGetPublicOveruse = allocationReport
        ?.filter((f: any) => {
          return (
            f?.publication &&
            f?.shipper === shipperMaster?.id_name &&
            contract_code
              ?.map((e: any) => e?.contract_code)
              ?.includes(f?.contract)
          );
        })
        ?.map((e: any) => {
          const { id, ...nE } = e;
          return {
            id:
              contract_code?.find((f: any) => f?.contract_code === e?.contract)
                ?.id || null,
            term_type:
              contract_code?.find((f: any) => f?.contract_code === e?.contract)
                ?.term_type || null,
            ...nE,
          };
        })
        ?.filter((f: any) => f?.term_type !== null);
      console.log('***allocationReportViewGetPublicOveruse : ', allocationReportViewGetPublicOveruse);
      const allocationReportViewGetPublicOveruseEntry =
        allocationReportViewGetPublicOveruse?.filter(
          (f: any) => f?.entry_exit === 'ENTRY',
        );
      const allocationReportViewGetPublicOveruseExit =
        allocationReportViewGetPublicOveruse?.filter(
          (f: any) => f?.entry_exit === 'EXIT',
        );

      console.log('***allocationReportViewGetPublicOveruseEntry : ', allocationReportViewGetPublicOveruseEntry);
      console.log('***allocationReportViewGetPublicOveruseExit : ', allocationReportViewGetPublicOveruseExit);


      const groupContractOveruse = (val: any) => {
        const contractGroupedOveruse = {};
        for (const curr of val) {
          const key = `${curr.contract}`;
          if (!contractGroupedOveruse[key]) {
            contractGroupedOveruse[key] = {
              id: curr.id || null,
              contract: curr.contract || null,
              term_type_id: curr.term_type?.id || null,
              term_type: curr.term_type?.name || null,
              data: [],
            };
          }
          contractGroupedOveruse[key].data.push({ ...curr });
        }
        const results: any = Object.values(contractGroupedOveruse)?.filter(
          (f: any) => f?.term_type_id !== null,
        );

        return results;
      };
      // console.log('allocationReportViewGetPublicOveruseEntry : ', allocationReportViewGetPublicOveruseEntry);

      const finalContractOveruseEntry = groupContractOveruse(
        allocationReportViewGetPublicOveruseEntry,
      );
      const finalContractOveruseExit = groupContractOveruse(
        allocationReportViewGetPublicOveruseExit,
      );

      const groupOveruse = (val: any) => {
        const nGrouped = {};
        for (const curr of val) {
          const key = `${curr?.area}`;
          if (!nGrouped[key]) {
            nGrouped[key] = {
              area: curr?.area,
              area_obj: curr?.area_obj,
              entry_exit: curr?.entry_exit,
              entry_exit_obj: curr?.entry_exit_obj,
              zone: curr?.zone,
              data: [],
            };
          }
          nGrouped[key].data.push({ ...curr });
        }
        const overuse = Object.values(nGrouped);
        return overuse;
      };

      const overuseCalcTag = (arr: any, keys: any) => {
        return (
          arr
            ?.filter((f: any) => f[keys] !== null && f[keys] !== undefined)
            ?.reduce(
              (accumulator, currentValue) => accumulator + currentValue?.[keys],
              0,
            ) ?? 0
        );
      };

      const fnOveruse = (arrs: any) => {
        const resultData = arrs?.map((v: any) => {
          const { data: dataMain, ...nV } = v;
          const overuseGroup = groupOveruse(dataMain);
          const overuseUse = overuseGroup?.map((e: any) => {
            const { data, ...nE } = e;
            const bookQuantity = overuseCalcTag(data, 'contractCapacity');
            const allocationQuantity = overuseCalcTag(data, 'allocatedValue');
            const overuse = overuseCalcTag(data, 'overusage');
            return {
              ...nE,
              bookQuantity: bookQuantity ?? 0,
              allocationQuantity: allocationQuantity ?? 0,
              overuse: overuse ?? 0,
              tempDateArr: data,
            };
          });

          const quantity =
            overuseUse?.reduce(
              (accumulator, currentValue) => accumulator + currentValue?.overuse,
              0,
            ) ?? 0;

          return {
            ...nV,
            data: overuseUse || [],
            quantity: quantity ?? 0,
          };
        });

        return resultData;
      };
      const contractOveruseEntry = fnOveruse(finalContractOveruseEntry);
      const contractOveruseExit = fnOveruse(finalContractOveruseExit);
      console.log('contractOveruseEntry : ', contractOveruseEntry);
      console.log('contractOveruseExit : ', contractOveruseExit);

      const result = await this.prisma.$transaction(
        async (prisma) => {
          const tariffNumberCount =
            (await prisma.tariff.count({
              where: {
                create_date: {
                  gte: todayStart,
                  lte: todayEnd,
                },
              },
            })) / 2;
          // create tariff a
          const tariffA = await prisma.tariff.create({
            data: {
              tariff_id: `${nowAt.format('YYYYMMDD')}-TAR-${(tariffNumberCount > 0 ? tariffNumberCount + 1 : 1).toString().padStart(4, '0')}-A (${nowAt.format('HH:mm:ss')})`,
              ...tariffData,
              tariff_type_ab: {
                connect: {
                  id: Number(1), // a, b
                },
              },
            },
          });
          // create tariff b
          const tariffB = await prisma.tariff.create({
            data: {
              tariff_id: `${nowAt.format('YYYYMMDD')}-TAR-${(tariffNumberCount > 0 ? tariffNumberCount + 1 : 1).toString().padStart(4, '0')}-B (${nowAt.format('HH:mm:ss')})`,
              ...tariffData,
              tariff_type_ab: {
                connect: {
                  id: Number(2), // a, b
                },
              },
            },
          });

          // 1 Capacity Charge
          const tariffCapacityCharge = contract_code_final?.flatMap((e: any) => {
            // แสดงเฉพาะค่า Entry รวมทุก area (booking)
            const quantity = e?.booking_row_json_use
              ?.filter((f: any) => {
                return f?.entry_exit_id === 1;
              })
              .reduce(
                (accumulator, currentValue) =>
                  accumulator +
                  (currentValue?.capacityMMBTUValue
                    ? parseToNumber(currentValue?.capacityMMBTUValue)
                    : 0),
                0,
              );
            // มาจาก DAM > System Parameter | ต้องสามารถ แยก Fee ตาม Type
            const idSP = getCapacityChargeFeeSystemParameterIDByTermTypeID(
              e?.term_type_id,
            );
            const fee = getLatestSystemParameterValue(systemParameter, [idSP]);

            // Quantity x Fee | ทศนิยม 2 ตำแหน่ง
            const amount =
              fee !== null || quantity !== null
                ? Number(quantity ?? 0) * Number(fee ?? 0)
                : null;

            const tariffChargeDataA = {
              tariff: {
                connect: {
                  id: Number(tariffA?.id),
                },
              },
              tariff_type_charge: {
                connect: {
                  id: Number(1), // 1 Capacity Charge
                },
              },
              contract_code: {
                connect: {
                  id: Number(e?.id),
                },
              },
              term_type: {
                connect: {
                  id: Number(e?.term_type_id),
                },
              },
              quantity_operator: null,
              quantity: quantity || quantity === 0 ? String(quantity) : null,
              unit: 'MMBTU',
              co_efficient: null,
              fee: (!!fee && String(fee)) || null,
              amount: (!!amount && String(amount)) || null,
              amount_operator: null,
              amount_compare: null,
              difference: null,
              create_date: nowAt.toDate(),
              create_date_num: nowAt.unix(),
              create_by_account: {
                connect: {
                  id: Number(userId),
                },
              },
              tariff_view_date: {
                create: {
                  temps: JSON.stringify(e),
                  create_date: nowAt.toDate(),
                  create_date_num: nowAt.unix(),
                  create_by_account: {
                    connect: {
                      id: Number(userId),
                    },
                  },
                },
              },
            };
            const tariffChargeDataB = {
              tariff: {
                connect: {
                  id: Number(tariffB?.id),
                },
              },
              tariff_type_charge: {
                connect: {
                  id: Number(1), // 1 Capacity Charge
                },
              },
              contract_code: {
                connect: {
                  id: Number(e?.id),
                },
              },
              term_type: {
                connect: {
                  id: Number(e?.term_type_id),
                },
              },
              quantity_operator: null,
              quantity: quantity || quantity === 0 ? String(quantity) : null,
              unit: 'MMBTU',
              co_efficient: null,
              fee: (!!fee && String(fee)) || null,
              amount: (!!amount && String(amount)) || null,
              amount_operator: null,
              amount_compare: null,
              difference: null,
              create_date: nowAt.toDate(),
              create_date_num: nowAt.unix(),
              create_by_account: {
                connect: {
                  id: Number(userId),
                },
              },
              tariff_view_date: {
                create: {
                  temps: JSON.stringify(e),
                  create_date: nowAt.toDate(),
                  create_date_num: nowAt.unix(),
                  create_by_account: {
                    connect: {
                      id: Number(userId),
                    },
                  },
                },
              },
            };
            return [tariffChargeDataA, tariffChargeDataB];
          });

          // -------

          // 2 Commodity Charge
          const comodityDataA = comodityA?.map((e: any) => {
            const quantity = e?.quantity;
            // มาจาก DAM > System Parameter | ต้องสามารถ แยก Fee ตาม Type
            const idSP = getExitCommodityChargeFeeSystemParameterIDByTermTypeID(
              e?.term_type_id,
            );
            const feeDefault = getLatestSystemParameterValue(systemParameter, [
              idSP,
            ]);

            const fee = e?.type === "comodityByContract" ? feeDefault : comodityFeeShipper;

            // Quantity x Fee | ทศนิยม 2 ตำแหน่ง
            const amount =
              fee !== null || quantity !== null
                ? Number(quantity ?? 0) * Number(fee ?? 0)
                : null;

            return {
              tariff: {
                connect: {
                  id: Number(tariffA?.id),
                },
              },
              tariff_type_charge: {
                connect: {
                  id: Number(2), // 1 Capacity Charge
                },
              },
              ...(e?.contract_code_id && {
                contract_code: {
                  connect: {
                    id: Number(e?.contract_code_id),
                  },
                },
              }),
              term_type: {
                connect: {
                  id: Number(e?.term_type_id),
                },
              },
              quantity_operator: null,
              quantity: quantity || quantity === 0 ? String(quantity) : null,
              unit: 'MMBTU',
              co_efficient: null,
              fee: (!!fee && String(fee)) || null,
              amount: (!!amount && String(amount)) || null,
              amount_operator: null,
              amount_compare: null,
              difference: null,
              create_date: nowAt.toDate(),
              create_date_num: nowAt.unix(),
              create_by_account: {
                connect: {
                  id: Number(userId),
                },
              },
              comonity_type: e?.type === 'comodityByContract' ? 1 : 2,
              tariff_view_date: {
                create: {
                  temps: JSON.stringify(e),
                  create_date: nowAt.toDate(),
                  create_date_num: nowAt.unix(),
                  create_by_account: {
                    connect: {
                      id: Number(userId),
                    },
                  },
                },
              },
            };
          });
          const comodityDataB = comodityB?.map((e: any) => {
            const quantity = e?.quantity;
            // มาจาก DAM > System Parameter | ต้องสามารถ แยก Fee ตาม Type
            const idSP = getExitCommodityChargeFeeSystemParameterIDByTermTypeID(
              e?.term_type_id,
            );
            const feeDefault = getLatestSystemParameterValue(systemParameter, [
              idSP,
            ]);

            const fee = e?.type === "comodityByContract" ? feeDefault : comodityFeeShipper;

            // Quantity x Fee | ทศนิยม 2 ตำแหน่ง
            const amount =
              fee !== null || quantity !== null
                ? Number(quantity ?? 0) * Number(fee ?? 0)
                : null;

            return {
              tariff: {
                connect: {
                  id: Number(tariffB?.id),
                },
              },
              tariff_type_charge: {
                connect: {
                  id: Number(2), // 1 Capacity Charge
                },
              },
              ...(e?.contract_code_id && {
                contract_code: {
                  connect: {
                    id: Number(e?.contract_code_id),
                  },
                },
              }),
              term_type: {
                connect: {
                  id: Number(e?.term_type_id),
                },
              },
              quantity_operator: null,
              quantity: quantity || quantity === 0 ? String(quantity) : null,
              unit: 'MMBTU',
              co_efficient: null,
              fee: (!!fee && String(fee)) || null,
              amount: (!!amount && String(amount)) || null,
              amount_operator: null,
              amount_compare: null,
              difference: null,
              create_date: nowAt.toDate(),
              create_date_num: nowAt.unix(),
              create_by_account: {
                connect: {
                  id: Number(userId),
                },
              },
              comonity_type: e?.type === 'comodityByContract' ? 1 : 2,
              tariff_view_date: {
                create: {
                  temps: JSON.stringify(e),
                  create_date: nowAt.toDate(),
                  create_date_num: nowAt.unix(),
                  create_by_account: {
                    connect: {
                      id: Number(userId),
                    },
                  },
                },
              },
            };
          });

          // -------

          // 3 Imbalances Penalty Charge (Positive)
          const imbalancesPenaltyPositiveA = [imbalancesPenaltyPositive]?.map(
            (e: any) => {
              const quantity = e?.quantity;

              // Quantity x Fee | ทศนิยม 2 ตำแหน่ง
              const amount =
                imbalancesPenaltyPositiveFee !== null || quantity !== null
                  ? Number(quantity ?? 0) *
                  Number(imbalancesPenaltyPositiveFee ?? 0)
                  : null;

              return {
                tariff: {
                  connect: {
                    id: Number(tariffA?.id),
                  },
                },
                tariff_type_charge: {
                  connect: {
                    id: Number(3), // 3
                  },
                },
                quantity_operator: null,
                quantity: quantity || quantity === 0 ? String(quantity) : null,
                unit: 'MMBTU',
                co_efficient: null,
                fee:
                  (!!imbalancesPenaltyPositiveFee &&
                    String(imbalancesPenaltyPositiveFee)) ||
                  null,
                amount: (!!amount && String(amount)) || null,
                amount_operator: null,
                amount_compare: null,
                difference: null,
                create_date: nowAt.toDate(),
                create_date_num: nowAt.unix(),
                create_by_account: {
                  connect: {
                    id: Number(userId),
                  },
                },
                tariff_view_date: {
                  create: {
                    temps: JSON.stringify(e),
                    create_date: nowAt.toDate(),
                    create_date_num: nowAt.unix(),
                    create_by_account: {
                      connect: {
                        id: Number(userId),
                      },
                    },
                  },
                },
              };
            },
          );
          const imbalancesPenaltyPositiveB = [imbalancesPenaltyPositive]?.map(
            (e: any) => {
              const quantity = e?.quantity;

              // Quantity x Fee | ทศนิยม 2 ตำแหน่ง
              const amount =
                imbalancesPenaltyPositiveFee !== null || quantity !== null
                  ? Number(quantity ?? 0) *
                  Number(imbalancesPenaltyPositiveFee ?? 0)
                  : null;

              return {
                tariff: {
                  connect: {
                    id: Number(tariffB?.id),
                  },
                },
                tariff_type_charge: {
                  connect: {
                    id: Number(3), // 3
                  },
                },
                quantity_operator: null,
                quantity: quantity || quantity === 0 ? String(quantity) : null,
                unit: 'MMBTU',
                co_efficient: null,
                fee:
                  (!!imbalancesPenaltyPositiveFee &&
                    String(imbalancesPenaltyPositiveFee)) ||
                  null,
                amount: (!!amount && String(amount)) || null,
                amount_operator: null,
                amount_compare: null,
                difference: null,
                create_date: nowAt.toDate(),
                create_date_num: nowAt.unix(),
                create_by_account: {
                  connect: {
                    id: Number(userId),
                  },
                },
                tariff_view_date: {
                  create: {
                    temps: JSON.stringify(e),
                    create_date: nowAt.toDate(),
                    create_date_num: nowAt.unix(),
                    create_by_account: {
                      connect: {
                        id: Number(userId),
                      },
                    },
                  },
                },
              };
            },
          );

          // -------

          // 4 Imbalances Penalty Charge (Negative)
          const imbalancesPenaltyNegativeA = [imbalancesPenaltyNegative]?.map(
            (e: any) => {
              const quantity = e?.quantity;

              // Quantity x Fee | ทศนิยม 2 ตำแหน่ง
              const amount =
                imbalancesPenaltyNegativeFee !== null || quantity !== null
                  ? Number(quantity ?? 0) *
                  Number(imbalancesPenaltyNegativeFee ?? 0)
                  : null;

              return {
                tariff: {
                  connect: {
                    id: Number(tariffA?.id),
                  },
                },
                tariff_type_charge: {
                  connect: {
                    id: Number(4), // 4
                  },
                },
                quantity_operator: null,
                quantity: quantity || quantity === 0 ? String(quantity) : null,
                unit: 'MMBTU',
                co_efficient: null,
                fee:
                  (!!imbalancesPenaltyNegativeFee &&
                    String(imbalancesPenaltyNegativeFee)) ||
                  null,
                amount: (!!amount && String(amount)) || null,
                amount_operator: null,
                amount_compare: null,
                difference: null,
                create_date: nowAt.toDate(),
                create_date_num: nowAt.unix(),
                create_by_account: {
                  connect: {
                    id: Number(userId),
                  },
                },
                tariff_view_date: {
                  create: {
                    temps: JSON.stringify(e),
                    create_date: nowAt.toDate(),
                    create_date_num: nowAt.unix(),
                    create_by_account: {
                      connect: {
                        id: Number(userId),
                      },
                    },
                  },
                },
              };
            },
          );
          const imbalancesPenaltyNegativeB = [imbalancesPenaltyNegative]?.map(
            (e: any) => {
              const quantity = e?.quantity;

              // Quantity x Fee | ทศนิยม 2 ตำแหน่ง
              const amount =
                imbalancesPenaltyNegativeFee !== null || quantity !== null
                  ? Number(quantity ?? 0) *
                  Number(imbalancesPenaltyNegativeFee ?? 0)
                  : null;

              return {
                tariff: {
                  connect: {
                    id: Number(tariffB?.id),
                  },
                },
                tariff_type_charge: {
                  connect: {
                    id: Number(4), // 4
                  },
                },
                quantity_operator: null,
                quantity: quantity || quantity === 0 ? String(quantity) : null,
                unit: 'MMBTU',
                co_efficient: null,
                fee:
                  (!!imbalancesPenaltyNegativeFee &&
                    String(imbalancesPenaltyNegativeFee)) ||
                  null,
                amount: (!!amount && String(amount)) || null,
                amount_operator: null,
                amount_compare: null,
                difference: null,
                create_date: nowAt.toDate(),
                create_date_num: nowAt.unix(),
                create_by_account: {
                  connect: {
                    id: Number(userId),
                  },
                },
                tariff_view_date: {
                  create: {
                    temps: JSON.stringify(e),
                    create_date: nowAt.toDate(),
                    create_date_num: nowAt.unix(),
                    create_by_account: {
                      connect: {
                        id: Number(userId),
                      },
                    },
                  },
                },
              };
            },
          );

          // -------

          // 5 Capacity Overuse Charge (Entry)
          const contractOveruseEntryA = contractOveruseEntry?.map((e: any) => {
            const quantity = e?.quantity;
            // มาจาก DAM > System Parameter | ต้องสามารถ แยก Fee ตาม Type
            const idSP =
              getEntryCapacityOveruseChargeFeeSystemParameterIDByTermTypeID(
                e?.term_type_id,
              );
            const fee = getLatestSystemParameterValue(systemParameter, [idSP]);

            // Quantity x Fee | ทศนิยม 2 ตำแหน่ง
            const amount =
              fee !== null || quantity !== null
                ? Number(quantity ?? 0) * Number(fee ?? 0)
                : null;

            return {
              tariff: {
                connect: {
                  id: Number(tariffA?.id),
                },
              },
              tariff_type_charge: {
                connect: {
                  id: Number(5),
                },
              },
              ...(e?.id && {
                contract_code: {
                  connect: {
                    id: Number(e?.id),
                  },
                },
              }),
              ...(e?.term_type_id && {
                term_type: {
                  connect: {
                    id: Number(e?.term_type_id),
                  },
                },
              }),
              quantity_operator: null,
              quantity: quantity || quantity === 0 ? String(quantity) : null,
              unit: 'MMBTU',
              co_efficient: entryCapOverCoEff,
              fee: (!!fee && String(fee)) || null,
              amount: (!!amount && String(amount)) || null,
              amount_operator: null,
              amount_compare: null,
              difference: null,
              create_date: nowAt.toDate(),
              create_date_num: nowAt.unix(),
              create_by_account: {
                connect: {
                  id: Number(userId),
                },
              },
              tariff_view_date: {
                create: {
                  temps: JSON.stringify(e),
                  create_date: nowAt.toDate(),
                  create_date_num: nowAt.unix(),
                  create_by_account: {
                    connect: {
                      id: Number(userId),
                    },
                  },
                },
              },
            };
          });
          const contractOveruseExitA = contractOveruseExit?.map((e: any) => {
            const quantity = e?.quantity;
            // มาจาก DAM > System Parameter | ต้องสามารถ แยก Fee ตาม Type
            const idSP =
              getExitCapacityOveruseChargeFeeSystemParameterIDByTermTypeID(
                e?.term_type_id,
              );
            const fee = getLatestSystemParameterValue(systemParameter, [idSP]);

            // Quantity x Fee | ทศนิยม 2 ตำแหน่ง
            const amount =
              fee !== null || quantity !== null
                ? Number(quantity ?? 0) * Number(fee ?? 0)
                : null;

            return {
              tariff: {
                connect: {
                  id: Number(tariffA?.id),
                },
              },
              tariff_type_charge: {
                connect: {
                  id: Number(6),
                },
              },
              ...(e?.id && {
                contract_code: {
                  connect: {
                    id: Number(e?.id),
                  },
                },
              }),
              ...(e?.term_type_id && {
                term_type: {
                  connect: {
                    id: Number(e?.term_type_id),
                  },
                },
              }),
              quantity_operator: null,
              quantity: quantity || quantity === 0 ? String(quantity) : null,
              unit: 'MMBTU',
              co_efficient: exitCapOverCoEff,
              fee: (!!fee && String(fee)) || null,
              amount: (!!amount && String(amount)) || null,
              amount_operator: null,
              amount_compare: null,
              difference: null,
              create_date: nowAt.toDate(),
              create_date_num: nowAt.unix(),
              create_by_account: {
                connect: {
                  id: Number(userId),
                },
              },
              tariff_view_date: {
                create: {
                  temps: JSON.stringify(e),
                  create_date: nowAt.toDate(),
                  create_date_num: nowAt.unix(),
                  create_by_account: {
                    connect: {
                      id: Number(userId),
                    },
                  },
                },
              },
            };
          });

          // -------

          // 6 Capacity Overuse Charge (Exit)
          const contractOveruseEntryB = contractOveruseEntry?.map((e: any) => {
            const quantity = e?.quantity;
            // มาจาก DAM > System Parameter | ต้องสามารถ แยก Fee ตาม Type
            const idSP =
              getEntryCapacityOveruseChargeFeeSystemParameterIDByTermTypeID(
                e?.term_type_id,
              );
            const fee = getLatestSystemParameterValue(systemParameter, [idSP]);

            // Quantity x Fee | ทศนิยม 2 ตำแหน่ง
            const amount =
              fee !== null || quantity !== null
                ? Number(quantity ?? 0) * Number(fee ?? 0)
                : null;

            return {
              tariff: {
                connect: {
                  id: Number(tariffB?.id),
                },
              },
              tariff_type_charge: {
                connect: {
                  id: Number(5),
                },
              },
              ...(e?.id && {
                contract_code: {
                  connect: {
                    id: Number(e?.id),
                  },
                },
              }),
              ...(e?.term_type_id && {
                term_type: {
                  connect: {
                    id: Number(e?.term_type_id),
                  },
                },
              }),
              quantity_operator: null,
              quantity: quantity || quantity === 0 ? String(quantity) : null,
              unit: 'MMBTU',
              co_efficient: entryCapOverCoEff,
              fee: (!!fee && String(fee)) || null,
              amount: (!!amount && String(amount)) || null,
              amount_operator: null,
              amount_compare: null,
              difference: null,
              create_date: nowAt.toDate(),
              create_date_num: nowAt.unix(),
              create_by_account: {
                connect: {
                  id: Number(userId),
                },
              },
              tariff_view_date: {
                create: {
                  temps: JSON.stringify(e),
                  create_date: nowAt.toDate(),
                  create_date_num: nowAt.unix(),
                  create_by_account: {
                    connect: {
                      id: Number(userId),
                    },
                  },
                },
              },
            };
          });
          const contractOveruseExitB = contractOveruseExit?.map((e: any) => {
            const quantity = e?.quantity;
            // มาจาก DAM > System Parameter | ต้องสามารถ แยก Fee ตาม Type
            const idSP =
              getExitCapacityOveruseChargeFeeSystemParameterIDByTermTypeID(
                e?.term_type_id,
              );
            const fee = getLatestSystemParameterValue(systemParameter, [idSP]);

            // Quantity x Fee | ทศนิยม 2 ตำแหน่ง
            const amount =
              fee !== null || quantity !== null
                ? Number(quantity ?? 0) * Number(fee ?? 0)
                : null;

            return {
              tariff: {
                connect: {
                  id: Number(tariffB?.id),
                },
              },
              tariff_type_charge: {
                connect: {
                  id: Number(6),
                },
              },
              ...(e?.id && {
                contract_code: {
                  connect: {
                    id: Number(e?.id),
                  },
                },
              }),
              ...(e?.term_type_id && {
                term_type: {
                  connect: {
                    id: Number(e?.term_type_id),
                  },
                },
              }),
              quantity_operator: null,
              quantity: quantity || quantity === 0 ? String(quantity) : null,
              unit: 'MMBTU',
              co_efficient: exitCapOverCoEff,
              fee: (!!fee && String(fee)) || null,
              amount: (!!amount && String(amount)) || null,
              amount_operator: null,
              amount_compare: null,
              difference: null,
              create_date: nowAt.toDate(),
              create_date_num: nowAt.unix(),
              create_by_account: {
                connect: {
                  id: Number(userId),
                },
              },
              tariff_view_date: {
                create: {
                  temps: JSON.stringify(e),
                  create_date: nowAt.toDate(),
                  create_date_num: nowAt.unix(),
                  create_by_account: {
                    connect: {
                      id: Number(userId),
                    },
                  },
                },
              },
            };
          });

          // -------

          // 7 Damage Charge
          const damageChageA = [null]?.map((e: any) => {
            const quantity = null;

            // Quantity x Fee | ทศนิยม 2 ตำแหน่ง
            const amount =
              damageChargeFee !== null || quantity !== null
                ? Number(quantity ?? 0) * Number(damageChargeFee ?? 0)
                : null;

            return {
              tariff: {
                connect: {
                  id: Number(tariffA?.id),
                },
              },
              tariff_type_charge: {
                connect: {
                  id: Number(7), // 1 Capacity Charge
                },
              },
              quantity_operator: null,
              quantity: quantity || quantity === 0 ? String(quantity) : null,
              unit: 'AU',
              co_efficient: damageCoEff,
              fee: (!!damageChargeFee && String(damageChargeFee)) || null,
              amount: (!!amount && String(amount)) || null,
              amount_operator: null,
              amount_compare: null,
              difference: null,
              create_date: nowAt.toDate(),
              create_date_num: nowAt.unix(),
              create_by_account: {
                connect: {
                  id: Number(userId),
                },
              },
            };
          });
          const damageChageB = [null]?.map((e: any) => {
            const quantity = null;

            // Quantity x Fee | ทศนิยม 2 ตำแหน่ง
            const amount =
              damageChargeFee !== null || quantity !== null
                ? Number(quantity ?? 0) * Number(damageChargeFee ?? 0)
                : null;

            return {
              tariff: {
                connect: {
                  id: Number(tariffB?.id),
                },
              },
              tariff_type_charge: {
                connect: {
                  id: Number(7), // 1 Capacity Charge
                },
              },
              quantity_operator: null,
              quantity: quantity || quantity === 0 ? String(quantity) : null,
              unit: 'AU',
              co_efficient: damageCoEff,
              fee: (!!damageChargeFee && String(damageChargeFee)) || null,
              amount: (!!amount && String(amount)) || null,
              amount_operator: null,
              amount_compare: null,
              difference: null,
              create_date: nowAt.toDate(),
              create_date_num: nowAt.unix(),
              create_by_account: {
                connect: {
                  id: Number(userId),
                },
              },
            };
          });

          // -------

          const chargeDatas = [
            ...tariffCapacityCharge,
            ...comodityDataA,
            ...comodityDataB,
            ...imbalancesPenaltyPositiveA,
            ...imbalancesPenaltyPositiveB,
            ...imbalancesPenaltyNegativeA,
            ...imbalancesPenaltyNegativeB,
            ...contractOveruseEntryA,
            ...contractOveruseExitA,
            ...contractOveruseEntryB,
            ...contractOveruseExitB,
            ...damageChageA,
            ...damageChageB,
          ];

          console.log('chargeDatas : ', chargeDatas);
          for (let i = 0; i < chargeDatas.length; i++) {
            await prisma.tariff_charge.create({
              data: chargeDatas[i],
            });
          }

          return {
            tariffA,
            tariffB,
          };
        },
        {
          timeout: 60000, // เพิ่มเป็น 1 นาที
          maxWait: 60000, // รอให้ transaction พร้อม
        },
      );
      console.log('tariffData : ', tariffData);


      await middleNotiInapp(
        this.prisma,
        'Tariff',
        `Charge Calculation for shipper ${shipperMaster?.name || "-"} and ${dayjs(month_year, 'YYYY-MM-DD').format('MMMM')}/${dayjs(month_year, 'YYYY-MM-DD').format('YYYY')} has finished OK.`,
        102, // Tafiff menus_id
        1,
      );
      return result;

    } catch (error) {
      await middleNotiInapp(
        this.prisma,
        'Tariff',
        `Charge Calculation for shipper ${shipperMaster?.name || "-"} and ${dayjs(month_year, 'YYYY-MM-DD').format('MMMM')}/${dayjs(month_year, 'YYYY-MM-DD').format('YYYY')} has failed.`,
        102, // Tafiff menus_id
        1,
      );
    }

  }

  // amount = amount_operator -> amount_compare
  // ถ้ามีค่า amount operator เอาค่านี้ขึ้นก่อน
  // ถ้าไม่มี ค่อยมาเอา amount
  // ยึด operator เป็นหลัก

  // difference = amount_operator - amount_compare
  // เอา amount operator- amount compare
  // ถ้าไม่มี operator ก็ใช้ amount
  async bacCalc(id: any, source: any, userId: any) {
    const ids = Number(id);
    const nowAt = getTodayNowAdd7();

    const findTariffUse = async (ids: any, tx: any) => {
      const results = await tx.tariff.findFirst({
        where: {
          id: Number(ids),
        },
        include: {
          tariff_charge: true,
        },
      });
      return results;
    };
    const findTariff = await findTariffUse(ids, this.prisma);
    const targetTariff = await findTariffUse(source, this.prisma);

    const tariff_id = targetTariff?.id;
    const tariff_charge = targetTariff?.tariff_charge.map((e: any) => {
      const compareTariffCharge = findTariff?.tariff_charge.find(
        (tariffChange: any) =>
          tariffChange.tariff_type_charge_id === e.tariff_type_charge_id &&
          tariffChange.contract_code_id === e.contract_code_id &&
          tariffChange.term_type_id === e.term_type_id,
      );
      const compareAmount = parseToNumber(
        compareTariffCharge?.amount_operator ?? compareTariffCharge?.amount,
      );

      const { id, amount, amount_operator } = e;
      let amountCompareCalc = null;
      let differenceCalc = null;
      const sourceAmount = parseToNumber(amount_operator ?? amount);
      if (sourceAmount || compareAmount) {
        amountCompareCalc = compareAmount ?? 0;
        differenceCalc = (sourceAmount ?? 0) - (compareAmount ?? 0);
      }

      return {
        id: id || null,
        amount_compare:
          amountCompareCalc !== null ? String(amountCompareCalc) : null,
        difference: differenceCalc !== null ? String(differenceCalc) : null,
      };
    });

    const updateUse = {
      update_date: nowAt.toDate(),
      update_date_num: nowAt.unix(),
      update_by: Number(userId),
    };
    const result = await this.prisma.$transaction(
      async (prisma) => {
        for (let i = 0; i < tariff_charge.length; i++) {
          const { id: idC, ...tariffCharge } = tariff_charge[i];
          await prisma.tariff_charge.updateMany({
            where: {
              id: Number(idC),
            },
            data: {
              ...tariffCharge,
              ...updateUse,
            },
          });
        }
        await prisma.tariff.updateMany({
          where: {
            id: Number(tariff_id),
          },
          data: {
            ...updateUse,
          },
        });

        await prisma.tariff_compare.create({
          data: {
            tariff: {
              connect: {
                id: Number(tariff_id),
              },
            },
            compare_with: {
              connect: {
                id: Number(findTariff?.id),
              },
            },
            create_date: nowAt.toDate(),
            create_date_num: nowAt.unix(),
            create_by_account: {
              connect: {
                id: Number(userId),
              },
            },
          },
        });

        const updatedTariff = await findTariffUse(tariff_id, prisma);
        return updatedTariff;
      },
      {
        timeout: 60000, // เพิ่มเป็น 1 นาที
        maxWait: 60000, // รอให้ transaction พร้อม
      },
    );

    return result;
  }

  // creadit/debit note

  async selectShipper(payload: any, userId: any) {
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const results = await this.prisma.group.findMany({
      where: {
        AND: [
          {
            start_date: {
              lte: todayEnd,
            },
          },
          {
            OR: [{ end_date: null }, { end_date: { gte: todayStart } }],
          },
        ],
        id: {
          not: 1,
        },
        status: true,
        user_type_id: 3,
      },
      orderBy: {
        id: 'asc',
      },
    });
    return results;
  }

  async selectCNDNType(payload: any, userId: any) {
    const results = await this.prisma.tariff_credit_debit_note_type.findMany({
      orderBy: {
        id: 'asc',
      },
    });
    return results;
  }

  async typeCharge(payload: any, userId: any) {
    const results = await this.prisma.tariff_type_charge.findMany({
      orderBy: {
        id: 'asc',
      },
    });
    return results;
  }

  async selectContract(payload: any, userId: any) {
    const { month_year, shipper_id, type_charge_id } = payload;
    const todayStartMY = getTodayStartYYYYMMDDDfaultAdd7(month_year).toDate();
    const todayEndMY = getTodayNowAdd7(month_year).toDate();
    const contract_code = await this.prisma.contract_code.findMany({
      where: {
        AND: [
          {
            group_id: shipper_id,
          },
          {
            status_capacity_request_management_id: { //Approved , Terminated
              in: [2, 5],
            },
          },
          { contract_start_date: { lte: todayEndMY } }, // Started before or on target date
          // If terminate_date exists and targetDate >= terminate_date, exclude (inactive)
          {
            OR: [
              { terminate_date: null }, // No terminate date
              { terminate_date: { gt: todayStartMY } }, // Terminate date is after target date
            ],
          },
          // Use extend_deadline if available, otherwise use contract_end_date
          {
            OR: [
              // If extend_deadline exists, use it as end date
              {
                AND: [
                  { extend_deadline: { not: null } },
                  { extend_deadline: { gt: todayStartMY } },
                ],
              },
              // If extend_deadline is null, use contract_end_date
              {
                AND: [
                  { extend_deadline: null },
                  {
                    OR: [
                      { contract_end_date: null },
                      { contract_end_date: { gt: todayStartMY } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      include: {
        term_type: true,
        booking_version: {
          include: {
            booking_row_json: true,
            booking_full_json: true,
            // booking_row_json_release: true,
            // booking_full_json_release: true,
          },
          take: 1,
          orderBy: {
            id: 'desc',
          },
        },
      },
    });
    return contract_code;
  }

  async selectTariffId(payload: any, userId: any) {
    const { month_year, shipper_id, type_charge_id } = payload;
    const todayStart = getTodayStartYYYYMMDDDfaultAdd7(month_year).toDate();
    const todayEnd = getTodayEndYYYYMMDDDfaultAdd7(month_year).toDate();

    const results = await this.prisma.tariff.findMany({
      where: {
        shipper_id: shipper_id,
        AND: [
          {
            month_year_charge: {
              lte: todayEnd,
            },
          },
          {
            month_year_charge: {
              gte: todayStart,
            },
          },
        ],
      },
      include: {},
    });
    return results;
  }

  async genData(payload: any, userId: any) {
    const { month_year, shipper_id, tariff_type_charge_id, type_id } = payload;
    const todayStart = getTodayStartYYYYMMDDDfaultAdd7(month_year).toDate();
    const todayEnd = getTodayEndYYYYMMDDDfaultAdd7(month_year).toDate();

    const results = await this.prisma.tariff_charge.findMany({
      where: {
        tariff_type_charge_id: Number(tariff_type_charge_id),
        tariff: {
          shipper_id: shipper_id,
          ...(type_id && {
            id: Number(type_id),
          }),
          AND: [
            {
              month_year_charge: {
                lte: todayEnd,
              },
            },
            {
              month_year_charge: {
                gte: todayStart,
              },
            },
          ],
        },
      },
      select: {
        id: true,
        tariff_id: true,
        tariff: true,
        quantity: true,
        unit: true,
        fee: true,
        amount: true,
        contract_code: {
          select: {
            id: true,
            contract_code: true,
          },
        },
        term_type: true,
      },
    });
    return results;
  }

  async findTariffCreditDebitNote(id: any, userId: any) {
    const results = await this.prisma.tariff_credit_debit_note.findFirst({
      where: {
        id: Number(id),
      },
      include: {
        shipper: true,
        tariff_type_charge: true,
        tariff_credit_debit_note_type: true,
        tariff_credit_debit_note_detail: true,
        tariff_credit_debit_note_comment: {
          include: {
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
    return results;
  }

  async findTariffCreditDebitNoteDetail(id: any, userId: any) {
    const results = await this.prisma.tariff_credit_debit_note_detail.findFirst(
      {
        where: {
          id: Number(id),
        },
        include: {
          contract_code: true,
          term_type: true,
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
      },
    );
    return results;
  }

  async findAllTariffCreditDebitNote(payload: any, userId: any) {
    const {
      shipper_id,
      month_year_charge,
      cndn_id,
      tariff_credit_debit_note_type_id,
      tariff_type_charge_id,
      limit,
      offset,
    } = payload;

    const limit_ = Number(limit);
    const offset_ = Number(offset);

    const group = await this.prisma.group.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: Number(userId),
          },
        },
      },
      select: {
        id: true,
        user_type: {
          select: {
            id: true,
          },
        },
      },
    });
    const userTypeId = group?.user_type?.id;
    const groupId = group?.id;

    const todayStartMY =
      (month_year_charge &&
        getTodayStartYYYYMMDDDfaultAdd7(month_year_charge).toDate()) ||
      null;

    const results = await this.prisma.tariff_credit_debit_note.findMany({
      where: {
        ...(userTypeId === 3
          ? {
            shipper_id: groupId,
          }
          : this.toArray(shipper_id).length > 0
          && {
            shipper_id: {
              in: this.toArray(shipper_id)
            }
          }),
        ...(todayStartMY && {
          month_year_charge: todayStartMY,
        }),
        ...(tariff_credit_debit_note_type_id && {
          tariff_credit_debit_note_type_id: Number(
            tariff_credit_debit_note_type_id,
          ),
        }),
        ...(tariff_type_charge_id && {
          tariff_type_charge_id: Number(tariff_type_charge_id),
        }),
        cndn_id: {
          contains: cndn_id,
        },
        // cndn_id,
      },
      skip: Number(offset_),
      take: Number(limit_),
      include: {
        shipper: true,
        tariff_type_charge: true,
        tariff_credit_debit_note_type: true,
        tariff_credit_debit_note_detail: true,
        tariff_credit_debit_note_comment: {
          include: {
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

    const count = await this.prisma.tariff_credit_debit_note.count({
      where: {
        // ...(userTypeId === 3
        //   ? {
        //       shipper_id: groupId,
        //     }
        //   : !!shipper_id
        //     ? {
        //         shipper_id: Number(shipper_id),
        //       }
        //     : {}),
        ...(userTypeId === 3
          ? {
            shipper_id: groupId,
          }
          : this.toArray(shipper_id).length > 0
          && {
            shipper_id: {
              in: this.toArray(shipper_id)
            }
          }),
        ...(todayStartMY && {
          month_year_charge: todayStartMY,
        }),
        ...(tariff_credit_debit_note_type_id && {
          tariff_credit_debit_note_type_id: Number(
            tariff_credit_debit_note_type_id,
          ),
        }),
        ...(tariff_type_charge_id && {
          tariff_type_charge_id: Number(tariff_type_charge_id),
        }),
        cndn_id: {
          contains: cndn_id,
        },
        // cndn_id,
      },
    });
    return {
      total: count,
      data: results,
    };
  }
  // tariff_credit_debit_note_type
  // prisma.tariff_credit_debit_note.findFirst
  async create(payload: any, userId: any) {
    const {
      shipper_id,
      month_year_charge,
      cndn_id,
      tariff_credit_debit_note_type_id,
      tariff_type_charge_id,
      detail,
      comments,
    } = payload;

    const nowAt = getTodayNowAdd7();
    const shipperName = await this.prisma.group.findFirst({
      where: { id: Number(shipper_id) },
      select: { name: true },
    });
    console.log('month_year_charge : ', month_year_charge);
    // try {

    const ck = await this.prisma.tariff_credit_debit_note.findFirst({
      where: {
        cndn_id: cndn_id,
      },
    });
    if (ck) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'The CNDN ID is duplicated.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.prisma.$transaction(
      async (prisma) => {
        const createTariffCredibitDebitNote =
          await prisma.tariff_credit_debit_note.create({
            data: {
              shipper: {
                connect: {
                  id: Number(shipper_id),
                },
              },
              month_year_charge: getTodayNowAdd7(month_year_charge).toDate(),
              cndn_id: cndn_id,
              tariff_credit_debit_note_type: {
                connect: {
                  id: Number(tariff_credit_debit_note_type_id),
                },
              },
              tariff_type_charge: {
                connect: {
                  id: Number(tariff_type_charge_id),
                },
              },
              create_date: nowAt.toDate(),
              create_date_num: nowAt.unix(),
              create_by_account: {
                connect: {
                  id: Number(userId),
                },
              },
            },
          });

        if (detail.length > 0) {
          for (let i = 0; i < detail.length; i++) {
            await prisma.tariff_credit_debit_note_detail.create({
              data: {
                tariff_credit_debit_note: {
                  connect: {
                    id: Number(createTariffCredibitDebitNote?.id),
                  },
                },
                term_type: {
                  connect: {
                    id: Number(detail[i]?.term_type),
                  },
                },
                contract_code: {
                  connect: {
                    id: Number(detail[i]?.contract_code_id),
                  },
                },
                quantity: detail[i]?.quantity || null,
                unit: detail[i]?.unit || null,
                fee: detail[i]?.fee || null,
                amount: detail[i]?.amount || null,

                create_date: nowAt.toDate(),
                create_date_num: nowAt.unix(),
                create_by_account: {
                  connect: {
                    id: Number(userId),
                  },
                },
              },
            });
          }
        }

        if (comments.length > 0) {
          for (let i = 0; i < comments.length; i++) {
            await prisma.tariff_credit_debit_note_comment.create({
              data: {
                tariff_credit_debit_note: {
                  connect: {
                    id: Number(createTariffCredibitDebitNote?.id),
                  },
                },
                comment: comments[i]?.comment || null,
                create_date: nowAt.toDate(),
                create_date_num: nowAt.unix(),
                create_by_account: {
                  connect: {
                    id: Number(userId),
                  },
                },
              },
            });
          }
        }

        return createTariffCredibitDebitNote;
      },
      {
        timeout: 60000, // เพิ่มเป็น 1 นาที
        maxWait: 60000, // รอให้ transaction พร้อม
      },
    );

    const findOne = await this.findTariffCreditDebitNote(result?.id, userId);
    const type =
      tariff_credit_debit_note_type_id === 1 ? 'Credit Note' : 'Dedit Note';

    const message = `${type} was created for Shipper ${shipperName?.name || '-'} on ${getTodayNowAdd7(month_year_charge).format('MMM')}/${getTodayNowAdd7(month_year_charge).format('YYYY')} (CNDN ID: ${cndn_id})`;
    console.log('message : ', message);
    // await this.tariffNotiInapp(`Tariff Credit/Debit Note`, message);
    await middleNotiInapp(
      this.prisma,
      'Tariff',
      message,
      102, // Tafiff menus_id
      1,
    );
    // await middleNotiInapp(
    //   this.prisma,
    //   'Tariff',
    //   `Charge Calculation for shipper ${shipperName?.name || "-"} and ${getTodayNowAdd7(getTodayNowAdd7).format('MMMM')}/${getTodayNowAdd7(getTodayNowAdd7).format('YYYY')} has finished OK.`,
    //   102, // Tafiff menus_id
    //   1,
    // );

    return findOne;
    // } catch (error) {
    //   console.log('error : ', error);
    //   // await middleNotiInapp(
    //   //   this.prisma,
    //   //   'Tariff',
    //   //   `Charge Calculation for shipper ${shipperName?.name || "-"} and ${getTodayNowAdd7(getTodayNowAdd7).format('MMMM')}/${getTodayNowAdd7(getTodayNowAdd7).format('YYYY')} has failed.`,
    //   //   102, // Tafiff menus_id
    //   //   1,
    //   // );

    //   return null
    // }

    // Tariff Charge Calculation for shipper {PTT} and {February/2025} has finished OK.


  }

  // edit
  async edit(id: any, payload: any, userId: any) {
    const { cndn_id, detail, comments } = payload;

    const nowAt = getTodayNowAdd7();

    const ck = await this.prisma.tariff_credit_debit_note.findFirst({
      where: {
        id: {
          not: Number(id),
        },
        cndn_id: cndn_id,
      },
    });
    if (ck) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'The CNDN ID is duplicated.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    console.log('ck : ', ck);

    const result = await this.prisma.$transaction(
      async (prisma) => {
        const update = await prisma.tariff_credit_debit_note.updateMany({
          where: {
            id: Number(id),
          },
          data: {
            cndn_id: cndn_id,
            update_date: nowAt.toDate(),
            update_date_num: nowAt.unix(),
            update_by: Number(userId),
          },
        });

        await prisma.tariff_credit_debit_note_detail.deleteMany({
          where: {
            tariff_credit_debit_note_id: Number(id),
          },
        });
        console.log('detail : ', detail);
        if (detail.length > 0) {
          for (let i = 0; i < detail.length; i++) {
            await prisma.tariff_credit_debit_note_detail.create({
              data: {
                tariff_credit_debit_note: {
                  connect: {
                    id: Number(id),
                  },
                },
                ...(detail[i]?.term_type && {
                  term_type: {
                    connect: {
                      id: Number(detail[i]?.term_type),
                    },
                  },
                }),
                ...(detail[i]?.contract_code_id && {
                  contract_code: {
                    connect: {
                      id: Number(detail[i]?.contract_code_id),
                    },
                  },
                }),
                quantity: detail[i]?.quantity || null,
                unit: detail[i]?.unit || null,
                fee: detail[i]?.fee || null,
                amount: detail[i]?.amount || null,

                create_date: nowAt.toDate(),
                create_date_num: nowAt.unix(),
                create_by_account: {
                  connect: {
                    id: Number(userId),
                  },
                },
              },
            });
          }
        }

        if (comments.length > 0) {
          for (let i = 0; i < comments.length; i++) {
            await prisma.tariff_credit_debit_note_comment.create({
              data: {
                tariff_credit_debit_note: {
                  connect: {
                    id: Number(id),
                  },
                },
                comment: comments[i]?.comment || null,
                create_date: nowAt.toDate(),
                create_date_num: nowAt.unix(),
                create_by_account: {
                  connect: {
                    id: Number(userId),
                  },
                },
              },
            });
          }
        }

        return { id: Number(id) };
      },
      {
        timeout: 60000, // เพิ่มเป็น 1 นาที
        maxWait: 60000, // รอให้ transaction พร้อม
      },
    );

    const findOne = await this.findTariffCreditDebitNote(result?.id, userId);

    return findOne;
  }

  async tariffCreditDebitNoteComments(payload: any, userId: any) {
    const { id, comment } = payload;
    const nowAt = getTodayNowAdd7();

    const result = await this.prisma.tariff_credit_debit_note_comment.create({
      data: {
        tariff_credit_debit_note: {
          connect: {
            id: Number(id),
          },
        },
        comment: comment || null,
        create_date: nowAt.toDate(),
        create_date_num: nowAt.unix(),
        create_by_account: {
          connect: {
            id: Number(userId),
          },
        },
      },
    });
    return result;
  }

  // noti

  async tariffNotiInapp(type: any, message: any) {
    const roleMenuAllocationManagementNoticeInapp =
      await this.prisma.account.findMany({
        where: {
          id: {
            not: 99999,
          },
          account_manage: {
            some: {
              account_role: {
                some: {
                  role: {
                    user_type_id: 2,
                    menus_config: {
                      some: {
                        menus_id: 102,
                        f_noti_inapp: 1,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          telephone: true,
          account_manage: {
            include: {
              account_role: {
                include: {
                  role: true,
                },
              },
            },
          },
        },
        orderBy: {
          id: 'asc',
        },
      });

    const nAccount = roleMenuAllocationManagementNoticeInapp?.map((e: any) => {
      const { account_manage, ...nE } = e;
      const role = account_manage?.[0]?.account_role?.[0]?.role?.name || null;
      return {
        ...nE,
        role_name: role || null,
      };
    });
    const emailArr = nAccount?.map((e: any) => e?.email);
    // const emailArr = nAccount?.map((e:any) => "devk@gmail.com")
    // console.log('emailArrT : ', emailArrT);
    console.log('emailArr : ', emailArr);
    if (emailArr?.length > 0) {
      await this.providerNotiInapp(type, message, emailArr);
    }
  }

  async providerNotiInapp(type: any, message: any, email: any) {
    const data = JSON.stringify({
      extras: {
        email: email,
      },
      message: message || '',
      priority: 1,
      title: type || '',
    });

    // basic safety: ensure configured endpoint uses http/https
    try {
      const u = new URL(String(process.env.IN_APP_URL));
      if (!['http:', 'https:'].includes(u.protocol)) {
        throw new Error('IN_APP_URL must use http/https');
      }
    } catch (e) {
      throw new Error(`Invalid IN_APP_URL: ${e?.message || 'unknown'}`);
    }

    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: `${process.env.IN_APP_URL}`,
      headers: {
        'Content-Type': 'application/json',
        ...(this.configService.get('IN_APP_BEARER_TOKEN')
          ? { Authorization: `Bearer ${this.configService.get('IN_APP_BEARER_TOKEN')}` }
          : {}),
      },
      data: data,
    };

    const sendData = await axios.request(config);
    // console.log('sendData : ', sendData);
  }

  // const message = `Metering Interface: Data retrieving for the period {${startDate} - ${endDate}} and executed on {${insertTimestampDDMMYYYY}} {finished OK}   {(Metering Input Code ${meteringRetrievingId})}. {${reply.data}/${reply.data} registers inserted}. Allocation and Balancing process should be executed.`
  // await this.providerNotiInapp("Meter Execute", message, [user?.email])
}
