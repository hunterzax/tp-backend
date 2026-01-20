import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as XLSX from 'xlsx-js-style';
// import * as XlsxPopulate from 'xlsx-populate';
import * as fs from 'fs';

import customParseFormat from 'dayjs/plugin/customParseFormat';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import isBetween from 'dayjs/plugin/isBetween'; // นำเข้า plugin isBetween
import { UploadTemplateForShipperService } from 'src/upload-template-for-shipper/upload-template-for-shipper.service';
import { CapacityV2Service } from 'src/capacity-v2/capacity-v2.service';
import { MeteredMicroService } from 'src/grpc/metered-service.service';
import { getTodayEndAdd7, getTodayEndDDMMYYYYAdd7, getTodayNow, getTodayNowAdd7, getTodayNowDDMMYYYYAdd7, getTodayNowDDMMYYYYDfault, getTodayNowYYYYMMDDDfaultAdd7, getTodayStartAdd7, getTodayStartDDMMYYYYAdd7, getWeekRange, timeToMinutes } from 'src/common/utils/date.util';
import { buildActiveDataForDates } from 'src/common/utils/allcation.util';
import { AstosService } from 'src/astos/astos.service';
import { parseToNumber, parseToNumber3Decimal } from 'src/common/utils/number.util';
import { isMatch } from 'src/common/utils/allcation.util';
import { group } from 'console';
import { readNomFromJsonAs3Decimal } from 'src/common/utils/nomination.util';

dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

@Injectable()
export class DailyAdjustmentService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    // @Inject(CACHE_MANAGER) private cacheService: Cache,
    private readonly meteredMicroService: MeteredMicroService,
    private readonly astosService: AstosService,
  ) { }

  private safeParseJSON(data: any, defaultValue: any = null) {
    if (!data) return defaultValue;
    try {
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
      console.error('JSON parse error:', e);
      return defaultValue;
    }
  }

  async shipperData() {
    const statusShow = [2, 5];
    const groups = await this.prisma.group.findMany({
      where: {
        user_type_id: 3,
        query_shipper_nomination_file: {
          some: {
            query_shipper_nomination_status: {
              id: { in: statusShow },
            },
            AND: [
              {
                OR: [{ del_flag: false }, { del_flag: null }],
              },
            ],
          },
        },
      },
      include: {
        query_shipper_nomination_file: {
          include: {
            nomination_type: true,
            nomination_version: {
              include: {
                nomination_row_json: true,
              },
              where: {
                flag_use: true,
              },
              orderBy: {
                id: 'desc',
              },
            },
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });

    // ✅ Filter ข้อมูล query_shipper_nomination_file ให้ตรงเงื่อนไข
    const filStatus = groups.map((group) => ({
      ...group,
      query_shipper_nomination_file: group.query_shipper_nomination_file.filter(
        (file) => statusShow.includes(file.query_shipper_nomination_status_id),
      ),
    }));

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const area = await this.prisma.area.findMany({
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
      include: {
        zone: true,
      },
      orderBy: {
        id: 'desc',
      },
    });

    const nomData = filStatus.map((e: any) => {
      const query_shipper_nomination_file = e[
        'query_shipper_nomination_file'
      ].map((eq: any) => {
        const nomination_version = eq['nomination_version'].map((ev: any) => {
          const nomination_row_json = ev['nomination_row_json'].map(
            (erj: any) => {
              const area_text = erj['area_text'];
              const zone_text = erj['zone_text'];
              const entry_exit_id = erj['entry_exit_id'];
              const findArea = area.find((f: any) => {
                return (
                  f?.name === area_text &&
                  f?.entry_exit_id === entry_exit_id &&
                  f?.zone?.name === zone_text
                );
              });
              const areaId = (!!findArea && findArea?.id) || null;

              return { ...erj, areaId };
            },
          );

          return { ...ev, nomination_row_json };
        });

        return { ...eq, nomination_version };
      });

      return { ...e, query_shipper_nomination_file };
    });

    return nomData;
  }
  // heating_value
  async nominationPointData(payload: any) {
    const { shipper_id, entry_exit_id, area_id, gas_day, time } = payload || {};
    const gasDayDate = new Date(gas_day);
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const area = await this.prisma.area.findMany({
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
      include: {
        zone: true,
      },
      orderBy: {
        id: 'desc',
      },
    });
    // console.log('gas_day : ', gas_day);
    // console.log('gasDayDate : ', gasDayDate);
    // console.log('getTodayNowAdd7(gas_day).toDate() : ', getTodayNowAdd7(gas_day).toDate());

    const nomData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        gas_day: getTodayNowAdd7(gas_day).toDate(),
        query_shipper_nomination_status: {
          id: { in: [2, 5] },
        },
        group: {
          id: {
            in: (this.safeParseJSON(shipper_id) || []).map((e: any) => Number(e)),
          },
        },
        AND: [
          {
            OR: [{ del_flag: false }, { del_flag: null }],
          },
        ],
      },
      include: {
        nomination_type: true,
        query_shipper_nomination_status: true,
        nomination_version: {
          include: {
            // nomination_full_json:true,
            nomination_row_json: {
              where: {
                query_shipper_nomination_type_id: 1,
              },
            },
          },
          where: {
            flag_use: true,
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });

    console.log('nomData : ', nomData);

    const converData = nomData.map((e: any) => {
      const nomination_version = e['nomination_version'].map((eN: any) => {
        const nomination_row_json = eN['nomination_row_json'].map(
          (eRj: any) => {
            const data_temp = this.safeParseJSON(eRj['data_temp']);
            const nomPoint = data_temp['3'];
            return { ...eRj, data_temp, nomPoint };
          },
        );

        return { ...eN, nomination_row_json };
      });

      return { ...e, nomination_version };
    });

    const nominationPoint = [];
    for (let i = 0; i < converData.length; i++) {
      for (let i1 = 0; i1 < converData[i]?.nomination_version.length; i1++) {
        for (
          let i2 = 0;
          i2 <
          converData[i]?.nomination_version[i1]?.nomination_row_json.length;
          i2++
        ) {
          nominationPoint.push({
            id: converData[i]?.nomination_version[i1]?.nomination_row_json[i2]
              ?.id,
            nomPoint:
              converData[i]?.nomination_version[i1]?.nomination_row_json[i2]
                ?.nomPoint,
            area_text:
              converData[i]?.nomination_version[i1]?.nomination_row_json[i2]
                ?.area_text,
            zone_text:
              converData[i]?.nomination_version[i1]?.nomination_row_json[i2]
                ?.zone_text,
            entry_exit_id:
              converData[i]?.nomination_version[i1]?.nomination_row_json[i2]
                ?.entry_exit_id,
            query_shipper_nomination_type_id:
              converData[i]?.nomination_version[i1]?.nomination_row_json[i2]
                ?.query_shipper_nomination_type_id,
            nomination_version_id: converData[i]?.nomination_version[i1]?.id,
            contract_code_id: converData[i]?.contract_code_id,
            nomination_type_id: converData[i]?.nomination_type?.id,
            row_id: converData[i]?.id,
            unit:
              converData[i]?.nomination_version[i1]?.nomination_row_json[i2]
                ?.data_temp['9'] || null,
          });
        }
      }
    }

    const nominationPointApi = await this.prisma.nomination_point.findMany({
      where: {
        AND: [
          {
            nomination_point: {
              in: (nominationPoint || []).map((e: any) => e?.nomPoint) || [],
            },
          },
          {
            start_date: {
              lte: gasDayDate, // start_date must be before or same as gas day
            },
          },
          {
            OR: [
              { end_date: null }, // if end_date is null
              { end_date: { gt: gasDayDate } }, // if end_date is not null, must be after gas day
            ],
          },
        ],
      },
      include: {
        metering_point: true,
      },
    });

    // Extract gas days and generate date array
    const gasDayDateString = gasDayDate.toISOString().split('T')[0]
    const dateArray: string[] = [gasDayDateString]

    // Build active data for all dates
    const activeData = await buildActiveDataForDates(
      dateArray,
      this.prisma
    );

    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: 'getLast',
        mode: 'metering',
        start_date: gasDayDateString,
        end_date: gasDayDateString,
        // start_date: "2025-03-08",
        // end_date:"2025-03-10"
      }),
      {
        activeData,
        prisma: this.prisma
      }
    );
    const dataConvert =
      (!!meteredMicroData?.reply && this.safeParseJSON(meteredMicroData?.reply)) ||
      null;

    // console.log('dataConvert : ', dataConvert);
    const resData = nominationPointApi.map((e: any) => {
      // console.log('**** e : ', e);
      const meterMaster = e?.metering_point?.map(
        (es: any) => es?.metered_point_name,
      );
      // console.log('meterMaster : ', meterMaster);
      const resultCon = dataConvert.filter((item) =>
        meterMaster.includes(item.meteringPointId),
      );
      // console.log('resultCon : ', resultCon);
      const totalHeatingValue =
        resultCon.length > 0
          ? resultCon.reduce(
            (sum, item) => sum + item.heatingValue * item.volume,
            0,
          )
          : null;

      // console.log('totalHeatingValue : ', totalHeatingValue);

      const volumeSum =
        resultCon.length > 0
          ? resultCon.reduce((sum, item) => sum + item.volume, 0)
          : null;

      // console.log('volumeSum : ', volumeSum);

      const sumHVall =
        resultCon.length > 0
          ? Number((totalHeatingValue / volumeSum).toFixed(3))
          : null;
      // SUM(heatingValue * volume) / volumeSum

      // console.log('sumHVall : ', sumHVall);
      // console.log('***************************************'); 


      const heating_value = sumHVall;
      const valumeMMSCFD = null;
      const valumeMMSCFH = null;
      const valumeMMSCFD2 = null;
      const valumeMMSCFH2 = null;
      return {
        ...e,
        calc: {
          heating_value,
          valumeMMSCFD,
          valumeMMSCFH,
          valumeMMSCFD2,
          valumeMMSCFH2,
        },
      };
    });

    return {
      gas_day: gas_day,
      nom: resData,
    };
  }

  async findAll(userId: any) {
    const userType = await this.prisma.user_type.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: Number(userId),
          },
        },
      },
    });

    if (userType?.id === 3) {
      const shipper = await this.prisma.group.findFirst({
        where: {
          account_manage: {
            some: {
              account_id: Number(userId),
            },
          },
        },
      });

      const resData = await this.prisma.daily_adjustment.findMany({
        where: {
          daily_adjustment_group: {
            some: {
              group_id: Number(shipper?.id),
            },
          },
        },
        include: {
          daily_adjustment_group: {
            include: {
              group: {
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
            },
          },
          daily_adjustment_nom: {
            include: {
              nomination_point: true,
            },
          },
          daily_adjustment_status: true,
          daily_adjustment_reason: {
            include: {
              daily_adjustment_status: true,
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
        orderBy: {
          id: 'desc',
        },
      });

      return resData;
    } else {
      const resData = await this.prisma.daily_adjustment.findMany({
        where: {},
        include: {
          daily_adjustment_group: {
            include: {
              group: {
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
            },
          },
          daily_adjustment_nom: {
            include: {
              nomination_point: true,
            },
          },
          daily_adjustment_status: true,
          daily_adjustment_reason: {
            include: {
              daily_adjustment_status: true,
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
        orderBy: {
          id: 'desc',
        },
      });

      return resData;
    }
  }

  async create(payload: any, userId: any) {
    if (payload === undefined || payload === null) {
      throw new HttpException('Missing payload', HttpStatus.BAD_REQUEST);
    }
    const { gas_day, time, shipper_id, area_id, entry_exit_id, nom } = payload;

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();



    const userType = await this.prisma.user_type.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: Number(userId),
          },
        },
      },
    });

    const findDaily = await this.prisma.daily_adjustment.findFirst({
      where: {
        // area_id: area_id,
        // entry_exit_id: entry_exit_id,
        gas_day: getTodayNowYYYYMMDDDfaultAdd7(gas_day).toDate(),
        time: time,
        daily_adjustment_group: { // https://sharing.clickup.com/9018502823/t/h/86euy4dbp/N835NAAH9X1KOFL
          some: {
            group: {
              id: {
                in: shipper_id
              }
            }
          }
        }
      },
      include: {
        daily_adjustment_group: {
          include: {
            group: true,
          }
        }
      }
    });

    // daily_adjustment_group

    // console.log('findDaily : ', findDaily);

    if (findDaily) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: `Daily Adjustment already exit for ${findDaily?.daily_adjustment_group?.map((e: any) => e?.group?.name)} at ${gas_day} ${time}`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // gas_day
    // time
    // shipper_id []

    // return

    const nominationPoint = await this.prisma.nomination_point.findMany({
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
      select: {
        id: true,
        nomination_point: true,
        area: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // check area nom https://app.clickup.com/t/86eth5yx8
    for (let i = 0; i < nom.length; i++) {
      const findNomArea = nominationPoint?.find((f: any) => {

        return (
          f?.nomination_point === nom[i]?.nomination_point &&
          f?.area?.id === area_id
        )
      })
      if (!findNomArea) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Area Missing Nomination Point',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    console.log('nom : ', nom);
    console.log('findDaily : ', findDaily);

    // if(findDaily){
    //   // update

    //   const dailyAdjustment = await this.prisma.daily_adjustment.update({
    //     where:{
    //       id: Number(findDaily?.id)
    //     },
    //     data: {
    //       daily_adjustment_status: {
    //         connect: {
    //           id: userType?.id === 3 ? 1 : 2,
    //         },
    //       },
    //       area: {
    //         connect: {
    //           id: area_id,
    //         },
    //       },
    //       entry_exit: {
    //         connect: {
    //           id: entry_exit_id,
    //         },
    //       },
    //       update_date: getTodayNowAdd7().toDate(),
    //       update_date_num: getTodayNowAdd7().unix(),
    //       update_by_account: {
    //         connect: {
    //           id: Number(userId),
    //         },
    //       },
    //     },
    //   });

    //   let dataShipper = [];
    //   for (let i = 0; i < shipper_id.length; i++) {
    //     dataShipper.push({
    //       daily_adjustment_id: findDaily?.id,
    //       group_id: Number(shipper_id[i]),
    //     });
    //   }
    //   console.log('dataShipper : ', dataShipper);
    //   await this.prisma.daily_adjustment_group.deleteMany({
    //     where: {
    //       daily_adjustment_id: findDaily?.id
    //     },
    //   });
    //   await this.prisma.daily_adjustment_group.createMany({
    //     data: dataShipper,
    //   });

    //   let dataNom = [];
    //   for (let i = 0; i < nom.length; i++) {
    //     dataNom.push({
    //       daily_adjustment_id: findDaily?.id,
    //       nomination_point_id: nom[i]?.nomination_point_id,
    //       heating_value:
    //         (!!nom[i]?.heating_value && String(nom[i]?.heating_value)) || null,
    //       valume_mmscfd: nom[i]?.valumeMMSCFD,
    //       valume_mmscfh: nom[i]?.valumeMMSCFH,
    //       valume_mmscfd2: nom[i]?.valumeMMSCFD2,
    //       valume_mmscfh2: nom[i]?.valumeMMSCFH2,
    //       create_date: getTodayNowAdd7().toDate(),
    //       create_date_num: getTodayNowAdd7().unix(),
    //       create_by: Number(userId),
    //     });
    //   }

    //   await this.prisma.daily_adjustment_nom.deleteMany({
    //     where: {
    //       daily_adjustment_id: findDaily?.id
    //     },
    //   });

    //   await this.prisma.daily_adjustment_nom.createMany({
    //     data: dataNom,
    //   });

    // }else{

    const dailyAdjustmentCount = await this.prisma.daily_adjustment.count({
      where: {
        create_date: {
          gte: getTodayStartAdd7().toDate(), // เริ่มต้นวันตามเวลาประเทศไทย
          lte: getTodayEndAdd7().toDate(), // สิ้นสุดวันตามเวลาประเทศไทย
        },
      },
    });

    const numDaily = `${dayjs().format('YYYYMMDD')}-DA-${String(dailyAdjustmentCount + 1).padStart(4, '0')}`;

    const dailyAdjustment = await this.prisma.daily_adjustment.create({
      data: {
        daily_code: numDaily,
        daily_adjustment_status: {
          connect: {
            id: userType?.id === 3 ? 1 : 2,
          },
        },
        area: {
          connect: {
            id: area_id,
          },
        },
        entry_exit: {
          connect: {
            id: entry_exit_id,
          },
        },
        gas_day: getTodayNowYYYYMMDDDfaultAdd7(gas_day).toDate(),
        time: time,
        create_date: getTodayNowAdd7().toDate(),
        create_date_num: getTodayNowAdd7().unix(),
        create_by_account: {
          connect: {
            id: Number(userId),
          },
        },
      },
    });

    const dataShipper = [];
    for (let i = 0; i < shipper_id.length; i++) {
      dataShipper.push({
        daily_adjustment_id: dailyAdjustment?.id,
        group_id: Number(shipper_id[i]),
      });
    }
    console.log('dataShipper : ', dataShipper);
    await this.prisma.daily_adjustment_group.createMany({
      data: dataShipper,
    });

    const dataNom = [];
    for (let i = 0; i < nom.length; i++) {
      dataNom.push({
        daily_adjustment_id: dailyAdjustment?.id,
        nomination_point_id: nom[i]?.nomination_point_id,
        heating_value:
          (!!nom[i]?.heating_value && String(nom[i]?.heating_value)) || null,
        valume_mmscfd: nom[i]?.valumeMMSCFD,
        valume_mmscfh: nom[i]?.valumeMMSCFH,
        valume_mmscfd2: nom[i]?.valumeMMSCFD2,
        valume_mmscfh2: nom[i]?.valumeMMSCFH2,
        create_date: getTodayNowAdd7().toDate(),
        create_date_num: getTodayNowAdd7().unix(),
        create_by: Number(userId),
      });
    }
    await this.prisma.daily_adjustment_nom.createMany({
      data: dataNom,
    });

    // }

    return payload;
  }

  async updateStatus(id: any, payload: any, userId: any) {
    if (id === undefined || id === null || payload === undefined || payload === null) {
      throw new HttpException('Missing id or payload', HttpStatus.BAD_REQUEST);
    }
    const { status, reason } = payload;
    const dailyAdjustment = await this.prisma.daily_adjustment.updateMany({
      where: {
        id: Number(id),
      },
      data: {
        daily_adjustment_status_id: status,
        update_date: getTodayNowAdd7().toDate(),
        update_date_num: getTodayNowAdd7().unix(),
        update_by: Number(userId),
      },
    });

    if (reason) {
      await this.prisma.daily_adjustment_reason.create({
        data: {
          reason: reason,
          daily_adjustment: {
            connect: {
              id: Number(id),
            },
          },
          daily_adjustment_status: {
            connect: {
              id: status,
            },
          },
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId),
            },
          },
        },
      });
    }

    return dailyAdjustment;
  }

  // https://app.clickup.com/t/86eth5ywz
  async dailyAdjustmentSummary(payload: any, userId: any) {
    const { checkAdjustment, startDate, endDate, contractCode } = payload || {};

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const daysOfWeek = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];

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

    const entryExitMaster = await this.prisma.entry_exit.findMany({
      where: {},
    });

    const dailyAdjust = await this.prisma.daily_adjustment.findMany({
      where: {
        daily_adjustment_status_id: 2,
      },
      include: {
        area: true,
        entry_exit: true,
        daily_adjustment_group: {
          include: {
            group: {
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
          },
        },
        daily_adjustment_nom: {
          include: {
            nomination_point: true,
          },
        },
        daily_adjustment_status: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    const nominationData =
      await this.prisma.query_shipper_nomination_file.findMany({
        where: {
          // gas_day: {
          //   gte: dayjs(startDate, 'DD/MM/YYYY').toDate(),
          //   lte: dayjs(endDate, 'DD/MM/YYYY').endOf('day').toDate(),
          // },
          OR: [{ del_flag: false }, { del_flag: null }],
          query_shipper_nomination_status: {
            id: {
              in: [2, 5],
            },
          },
        },
        include: {
          group: true,
          query_shipper_nomination_status: true,
          contract_code: true,
          nomination_type: true,
          nomination_version: {
            include: {
              nomination_full_json: true,
              nomination_full_json_sheet2: true,
              nomination_row_json: {
                include: {
                  query_shipper_nomination_type: true,
                },
                orderBy: {
                  id: 'asc',
                },
              },
            },
            where: {
              flag_use: true,
            },
          },
        },
        orderBy: {
          id: 'desc',
        },
      });

    const grouped = {};
    for (const curr of nominationData) {
      const key = `${curr.gas_day}|${curr.group?.name}|${curr?.nomination_type?.id}`;

      if (!grouped[key]) {
        grouped[key] = {
          gas_day: curr.gas_day,
          shipper_name: curr.group?.name,
          nomination_type: curr?.nomination_type,
          data: [],
        };
      }

      grouped[key].data.push({ ...curr });
    }
    const resultGroup: any = Object.values(grouped);
    const resultGroupType = resultGroup.map((e: any) => {
      e['data'] = e['data']?.map((eData: any) => {
        eData['nomination_version'] = eData['nomination_version']?.map(
          (eDataNom: any) => {
            eDataNom['nomination_full_json'] = eDataNom[
              'nomination_full_json'
            ]?.map((eDataNomJson: any) => {
              if (!!eDataNomJson && eDataNomJson?.['data_temp']) {
                eDataNomJson['data_temp'] = this.safeParseJSON(eDataNomJson['data_temp']);
              }
              return { ...eDataNomJson };
            });

            eDataNom['nomination_row_json'] = eDataNom[
              'nomination_row_json'
            ]?.map((eDataNomJson: any) => {
              if (eDataNomJson?.['data_temp']) {
                eDataNomJson['data_temp'] = this.safeParseJSON(eDataNomJson['data_temp']);
              }
              return { ...eDataNomJson };
            });
            return { ...eDataNom };
          },
        );
        return { ...eData };
      });

      const gas_day_text = dayjs(e['gas_day']).format('DD/MM/YYYY');
      const shipper_name = e['shipper_name'];

      return {
        shipper_name,
        gas_day: gas_day_text,
        gas_day_text,
        dataDW: e['data'],
        nomination_type: e['nomination_type'],
      };
    });
    const nomFlat = resultGroupType?.flatMap((e: any) => {
      const { dataDW, ...nE } = e;
      const nom = dataDW?.map((eD: any) => {
        return {
          ...nE,
          ...eD,
        };
      });

      return [...nom];
    });

    const nomJsonRowFlat = nomFlat?.flatMap((e: any) => {
      const { nomination_version, ...nE } = e;
      const nomination_version_one = e?.nomination_version[0] || [];
      nomination_version_one.nomination_full_json =
        nomination_version_one.nomination_full_json[0];
      const { nomination_row_json, ...nER } = nomination_version_one;

      const nom = nomination_row_json?.map((eD: any) => {
        return {
          nomination_code: nE?.contract_code?.contract_code,
          contract: nE?.contract_code?.contract_code,
          unit: eD['data_temp']['9'],
          point: eD['data_temp']['3'],
          entryExit: eD['data_temp']['10'],
          nomVersionId: nER?.id,
          nomVersionVersion: nER?.version,
          nomVersionFull: nER?.nomination_full_json,
          ...nE,
          ...eD,
        };
      });

      return [...nom];
    });

    const nomData = nomJsonRowFlat?.filter((f: any) => {
      return f?.query_shipper_nomination_type_id === 1;
    });
    const nomTypeExt = nomData?.flatMap((e: any) => {
      const dataE = [];
      if (e['nomination_type_id'] === 2) {
        // weekly
        for (let i = 0; i < daysOfWeek.length; i++) {
          //
          dataE.push({
            ...e,
            total:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) ||
              0,
            totalType: daysOfWeek[i],
            gasDayUse: e?.nomVersionFull?.data_temp?.headData[`${14 + i}`],
            HV: Number(e['data_temp']['12']?.trim()?.replace(/,/g, '')) || 0,
            rowId: e?.id,
            H1:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H2:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H3:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H4:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H5:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H6:
              (Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
                24) ||
              0,
            H7:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H8:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H9:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H10:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H11:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H12:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H13:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H14:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H15:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H16:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H17:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H18:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H19:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H20:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H21:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H22:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H23:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H24:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
          });
        }
      } else {
        // daily
        dataE.push({
          ...e,
          total: Number(e['data_temp']['38']?.trim()?.replace(/,/g, '')) || 0,
          totalType: 'daily',
          gasDayUse: e?.gas_day_text,
          HV: Number(e['data_temp']['12']?.trim()?.replace(/,/g, '')) || 0,
          rowId: e?.id,
          H1: Number(e['data_temp']['14']?.trim()?.replace(/,/g, '')) || 0,
          H2: Number(e['data_temp']['15']?.trim()?.replace(/,/g, '')) || 0,
          H3: Number(e['data_temp']['16']?.trim()?.replace(/,/g, '')) || 0,
          H4: Number(e['data_temp']['17']?.trim()?.replace(/,/g, '')) || 0,
          H5: Number(e['data_temp']['18']?.trim()?.replace(/,/g, '')) || 0,
          H6: Number(e['data_temp']['19']?.trim()?.replace(/,/g, '')) || 0,
          H7: Number(e['data_temp']['20']?.trim()?.replace(/,/g, '')) || 0,
          H8: Number(e['data_temp']['21']?.trim()?.replace(/,/g, '')) || 0,
          H9: Number(e['data_temp']['22']?.trim()?.replace(/,/g, '')) || 0,
          H10: Number(e['data_temp']['23']?.trim()?.replace(/,/g, '')) || 0,
          H11: Number(e['data_temp']['24']?.trim()?.replace(/,/g, '')) || 0,
          H12: Number(e['data_temp']['25']?.trim()?.replace(/,/g, '')) || 0,
          H13: Number(e['data_temp']['26']?.trim()?.replace(/,/g, '')) || 0,
          H14: Number(e['data_temp']['27']?.trim()?.replace(/,/g, '')) || 0,
          H15: Number(e['data_temp']['28']?.trim()?.replace(/,/g, '')) || 0,
          H16: Number(e['data_temp']['29']?.trim()?.replace(/,/g, '')) || 0,
          H17: Number(e['data_temp']['30']?.trim()?.replace(/,/g, '')) || 0,
          H18: Number(e['data_temp']['31']?.trim()?.replace(/,/g, '')) || 0,
          H19: Number(e['data_temp']['32']?.trim()?.replace(/,/g, '')) || 0,
          H20: Number(e['data_temp']['33']?.trim()?.replace(/,/g, '')) || 0,
          H21: Number(e['data_temp']['34']?.trim()?.replace(/,/g, '')) || 0,
          H22: Number(e['data_temp']['35']?.trim()?.replace(/,/g, '')) || 0,
          H23: Number(e['data_temp']['36']?.trim()?.replace(/,/g, '')) || 0,
          H24: Number(e['data_temp']['37']?.trim()?.replace(/,/g, '')) || 0,
        });
      }

      return [...dataE];
    });

    const nomExt = nomTypeExt?.map((e: any) => {
      const {
        rowId,
        nomination_code,
        HV,
        gasDayUse,
        contract,
        shipper_name,
        zone_text,
        area_text,
        unit,
        point,
        entryExit,
        total,
        totalType,
        contract_code,
        nomination_type_id,
        H1,
        H2,
        H3,
        H4,
        H5,
        H6,
        H7,
        H8,
        H9,
        H10,
        H11,
        H12,
        H13,
        H14,
        H15,
        H16,
        H17,
        H18,
        H19,
        H20,
        H21,
        H22,
        H23,
        H24,
        ...nE
      } = e;
      const entryExitId = entryExit === 'Entry' ? 1 : 2;
      const areaObj = areaMaster?.find((f: any) => {
        return f?.name === area_text && f?.entry_exit_id === entryExitId;
      });
      const entryExitObj = entryExitMaster?.find((f: any) => {
        return f?.id === entryExitId;
      });

      return {
        rowId,
        nomination_code,
        HV,
        contract,
        gasDayUse,
        shipper_name,
        zone_text,
        area_text,
        unit,
        point,
        entryExit,
        total,
        totalType,
        // contract_code,
        contract_code_id: contract_code?.id,
        areaObj,
        entryExitObj,
        term: contract_code?.term_type_id === 4 ? 'non-firm' : 'firm',
        nomination_type_id,
        H1,
        H2,
        H3,
        H4,
        H5,
        H6,
        H7,
        H8,
        H9,
        H10,
        H11,
        H12,
        H13,
        H14,
        H15,
        H16,
        H17,
        H18,
        H19,
        H20,
        H21,
        H22,
        H23,
        H24,
      };
    });
    // MMSCFD

    // nomExtFilter

    // const deduplicateByKeys = (data) => {
    //   const map = new Map();

    //   for (const item of data) {
    //     const key = [
    //       item.gasDayUse,
    //       item.contract,
    //       item.shipper_name,
    //       item.area_text,
    //       item.zone_text,
    //       item.point,
    //       item.unit,
    //     ].join('|');

    //     if (!map.has(key)) {
    //       map.set(key, []);
    //     }

    //     map.get(key).push(item);
    //   }

    //   const result = [];

    //   for (const [_, group] of map.entries()) {
    //     if (group.length === 1) {
    //       result.push(group[0]); // ไม่ซ้ำ
    //     } else {
    //       const daily = group.find((g) => g.totalType === 'daily');
    //       if (daily) result.push(daily); // ซ้ำแต่มี daily
    //     }
    //   }

    //   return result;
    // };

    const deduplicateByKeys = (data) => {
      const map = new Map();

      for (const item of data) {
        const key = [
          item.gasDayUse,
          item.contract,
          item.shipper_name,
          item.area_text,
          item.zone_text,
          item.point,
          item.unit,
          item.nomination_type_id,
          item.nomination_code,
        ].join('|');

        if (!map.has(key)) {
          map.set(key, []);
        }

        map.get(key).push(item);
      }
      // console.log('map : ', map);
      const result = [];

      for (const [_, group] of map.entries()) {
        if (group.length === 1) {
          result.push(group[0]); // ไม่ซ้ำ
        } else {
          const daily = group.find((g) => g.totalType === 'daily');
          if (daily) result.push(daily); // ซ้ำแต่มี daily
        }
      }

      return result;
    };

    const filteredDataDW = deduplicateByKeys(nomExt);
    // unit

    const noMMSCFD = filteredDataDW?.filter((f: any) => {
      // return f?.unit === 'MMSCFD';
      return f?.unit !== 'MMSCFD';
    });
    console.log('noMMSCFD : ', noMMSCFD);
    const calcAdjustFind = noMMSCFD?.flatMap((e: any) => {
      // area
      // daily_adjustment_group[]?.group?.name
      const dailyAdjustFind = dailyAdjust
        ?.filter((f: any) => {
          return (
            f['daily_adjustment_group']
              ?.map((dag: any) => dag?.group?.name)
              ?.includes(e['shipper_name']) &&
            f?.area?.name === e['area_text'] &&
            dayjs(f?.gas_day).format('DD/MM/YYYY') === e['gasDayUse']
          );
        })
        ?.flatMap((np: any) => [
          ...np?.daily_adjustment_nom.map((t: any) => {
            return {
              timeUse: np?.time,
              gas_day: dayjs(np?.gas_day).format('DD/MM/YYYY'),
              ...t,
            };
          }),
        ]);
      const dailyAdjustFindPoint = dailyAdjustFind?.filter((f: any) => {
        return f?.nomination_point?.nomination_point === e['point'];
      });

      console.log('dailyAdjustFindPoint : ', dailyAdjustFindPoint);
      if (dailyAdjustFindPoint?.length > 0) {
        const adjustData = dailyAdjustFindPoint?.map((da: any) => {
          return {
            // ...da,
            create_date: da?.create_date,
            timeUse: da?.timeUse,
            gas_day: da?.gas_day,
            heating_value: da?.heating_value,
            hour: Number(da?.timeUse.split(':')[0]) ?? null,
            minute: Number(da?.timeUse.split(':')[1]) ?? null,
            hourTime: `H${Number(da?.timeUse.split(':')[0]) + 1}`,
            adjustH: da?.valume_mmscfh2
              ? Number(da?.valume_mmscfh2)
              : Number(da?.valume_mmscfd2) / 24,
            djustHFlag: !!da?.valume_mmscfh2
          };
        });

        return [
          {
            dailyAdjustFindPoint: adjustData,
            adjustment: 'YES',
            ...e,
          },
          {
            dailyAdjustFindPoint: [],
            adjustment: 'NO',
            ...e,
          },
        ];
      } else {
        return [
          {
            dailyAdjustFindPoint: [],
            adjustment: 'NO',
            ...e,
          },
        ];
      }
    });

    // console.log('calcAdjustFind : ', calcAdjustFind);
    // console.log('s : ', String(contractCode)?.length > 2);
    // console.log('s : ', contractCode?.length > 0 );
    // console.log('-- : ', String(contractCode));
    const filContract = (contractCode === null || contractCode === "" || (Array.isArray(contractCode) && contractCode.length == 0))
      ? calcAdjustFind
      : Array.isArray(contractCode)
        ? calcAdjustFind?.filter((f: any) => {
          return contractCode?.includes(f?.contract);
        })
        : calcAdjustFind?.filter((f: any) => {
          return f?.contract === contractCode;
        })

    const startDateArr = dayjs(startDate, 'DD/MM/YYYY');
    const endDateArr = dayjs(endDate, 'DD/MM/YYYY');

    console.log('filContract : ', filContract);

    const filteredDate = filContract.filter((item) => {
      const gasDay = dayjs(item.gasDayUse, 'DD/MM/YYYY');
      return (
        gasDay.isSameOrAfter(startDateArr) && gasDay.isSameOrBefore(endDateArr)
      );
    });
    console.log('checkAdjustment : ', checkAdjustment);

    // checkAdjustment
    const filCheckAdjustment = checkAdjustment
      ? filteredDate?.filter((f: any) => {
        return f?.adjustment === 'YES';
      })
      : filteredDate;

    const hourTime = [
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'H7',
      'H8',
      'H9',
      'H10',
      'H11',
      'H12',
      'H13',
      'H14',
      'H15',
      'H16',
      'H17',
      'H18',
      'H19',
      'H20',
      'H21',
      'H22',
      'H23',
      'H24',
    ];

    console.log('filCheckAdjustment : ', filCheckAdjustment);

    const calcAdjust = filCheckAdjustment?.map((e: any) => {
      if (e['adjustment'] === 'YES') {
        const adjustedHours = { ...e };

        for (let hI = 0; hI < hourTime.length; hI++) {
          const currentHour = hourTime[hI];

          const findH = e['dailyAdjustFindPoint']?.filter((f: any) => {
            return f?.hourTime === currentHour;
          });

          if (findH.length > 0) {
            const sumAllH = {};
            const fil = filCheckAdjustment?.filter((f: any) =>
              f?.adjustment === 'YES' &&
              f?.shipper_name === e?.shipper_name &&
              f?.gasDayUse === e?.gasDayUse &&
              f?.area_text === e?.area_text &&
              f?.contract === e?.contract
            );
            for (const hour of hourTime) {
              sumAllH[hour] = fil
                ?.map((sH: any) => Number(sH[hour]) || 0)
                .reduce((acc, val) => acc + val, 0);
            }

            const originalPointRowH = Number(e[currentHour]) ?? 0;
            const sumAllPointRowH = Number(sumAllH[currentHour]) ?? 0;
            let calcResult = 0;
            let adjustValue = 0;

            if (findH.length > 1) {
              const sorted = [...findH].sort((a, b) => {
                if (a.minute !== b.minute) return a.minute - b.minute;
                return dayjs(a.create_date).isBefore(dayjs(b.create_date)) ? -1 : 1;
              });

              let minuteSum = 0;
              let oldMinute = 0;
              for (const item of sorted) {
                adjustValue = Number(item?.adjustH) ?? 0;
                let calcStep1 = 0;
                if (sumAllPointRowH !== 0) {
                  calcStep1 = (originalPointRowH / sumAllPointRowH) * adjustValue;
                }
                const calcStep2 = calcStep1 * ((item.minute - oldMinute) / 60);
                oldMinute = item.minute;
                minuteSum += calcStep2;
              }
              calcResult = minuteSum;

            } else {
              adjustValue = Number(findH[0]?.adjustH) ?? 0;
              let calcStep1 = 0;
              if (sumAllPointRowH !== 0) {
                calcStep1 = (originalPointRowH / sumAllPointRowH) * adjustValue;
              }

              if (findH[0]?.minute !== 0) {
                const calcStep2 = (calcStep1 / 60) * (60 - findH[0].minute);
                const calcStep3 = calcStep2 + (sumAllPointRowH / 60) * findH[0].minute;
                calcResult = calcStep3;
              } else {
                calcResult = calcStep1;
              }
            }

            adjustedHours[currentHour] = isNaN(calcResult) ? 0 : calcResult;

            for (let j = hI + 1; j < hourTime.length; j++) {
              adjustedHours[hourTime[j]] = adjustValue;
            }

            break;
          }
        }

        const totalH1ToH24Adjust = hourTime.reduce((sum, hour) => {
          return sum + (Number(adjustedHours[hour]) || 0);
        }, 0);

        return {
          ...adjustedHours,
          totalH1ToH24Adjust,
        };
      }

      // กรณีไม่มี adjustment ให้คำนวณผลรวมจากค่าเดิม
      const totalH1ToH24Adjust = hourTime.reduce((sum, hour) => {
        return sum + (Number(e[hour]) || 0);
      }, 0);

      return {
        ...e,
        totalH1ToH24Adjust,
      };
    });

    return calcAdjust;
  }

  async dailyAdjustmentReportNow(payload: any, userId: any) {
    const { checkAdjustment, startDate, endDate, contractCode } = payload || {};

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const daysOfWeek = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];

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

    const entryExitMaster = await this.prisma.entry_exit.findMany({
      where: {},
    });

    const dailyAdjust = await this.prisma.daily_adjustment.findMany({
      where: {
        daily_adjustment_status_id: 2,
      },
      include: {
        area: true,
        entry_exit: true,
        daily_adjustment_group: {
          include: {
            group: {
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
          },
        },
        daily_adjustment_nom: {
          include: {
            nomination_point: true,
          },
        },
        daily_adjustment_status: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    const meterData = await this.prisma.metering_point.findMany({
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
      include: {
        zone: true,
        area: true,
        nomination_point: true,
      },
    });

    // Extract gas days and generate date array
    const getMeterFrom = getTodayNowDDMMYYYYDfault(startDate)
    const getMeterTo = getTodayNowDDMMYYYYDfault(endDate)
    const dateArray: string[] = []
    // Fill dateArray with all dates between getMeterFrom and getMeterTo (inclusive) in YYYY-MM-DD format
    let current = getMeterFrom.clone();
    while (current.isSameOrBefore(getMeterTo, 'day')) {
      dateArray.push(current.format('YYYY-MM-DD'));
      current = current.add(1, 'day');
    }
    // Build active data for all dates
    const activeData = await buildActiveDataForDates(
      dateArray,
      this.prisma
    );

    const meteredMicroData = await this.meteredMicroService.sendMessage(JSON.stringify({
      case: "getLast",
      mode: "metering",
      start_date: getMeterFrom.format("YYYY-MM-DD"),
      end_date: getMeterTo.format("YYYY-MM-DD")
      // start_date: "2025-06-09",
      // end_date:"2025-06-13"
    }),
      {
        activeData,
        prisma: this.prisma
      });

    const nominationData =
      await this.prisma.query_shipper_nomination_file.findMany({
        where: {
          // gas_day: {
          //   gte: dayjs(startDate, 'DD/MM/YYYY').toDate(),
          //   lte: dayjs(endDate, 'DD/MM/YYYY').endOf('day').toDate(),
          // },
          OR: [{ del_flag: false }, { del_flag: null }],
          query_shipper_nomination_status: {
            id: {
              in: [2, 5],
            },
          },
        },
        include: {
          group: true,
          query_shipper_nomination_status: true,
          contract_code: true,
          nomination_type: true,
          nomination_version: {
            include: {
              nomination_full_json: true,
              nomination_full_json_sheet2: true,
              nomination_row_json: {
                include: {
                  query_shipper_nomination_type: true,
                },
                orderBy: {
                  id: 'asc',
                },
              },
            },
            where: {
              flag_use: true,
            },
          },
        },
        orderBy: {
          id: 'desc',
        },
      });

    const grouped = {};
    for (const curr of nominationData) {
      const key = `${curr.gas_day}|${curr.group?.name}|${curr?.nomination_type?.id}`;

      if (!grouped[key]) {
        grouped[key] = {
          gas_day: curr.gas_day,
          shipper_name: curr.group?.name,
          nomination_type: curr?.nomination_type,
          data: [],
        };
      }

      grouped[key].data.push({ ...curr });
    }
    const resultGroup: any = Object.values(grouped);
    const resultGroupType = resultGroup.map((e: any) => {
      e['data'] = e['data']?.map((eData: any) => {
        eData['nomination_version'] = eData['nomination_version']?.map(
          (eDataNom: any) => {
            eDataNom['nomination_full_json'] = eDataNom[
              'nomination_full_json'
            ]?.map((eDataNomJson: any) => {
              eDataNomJson['data_temp'] = this.safeParseJSON(eDataNomJson['data_temp']);
              return { ...eDataNomJson };
            });
            // eDataNom["nomination_full_json_sheet2"] = eDataNom["nomination_full_json_sheet2"]?.map((eDataNomJson:any) => {
            //   eDataNomJson["data_temp"] = JSON.parse(eDataNomJson["data_temp"])
            //   return { ...eDataNomJson }
            // })
            eDataNom['nomination_row_json'] = eDataNom[
              'nomination_row_json'
            ]?.map((eDataNomJson: any) => {
              eDataNomJson['data_temp'] = this.safeParseJSON(eDataNomJson['data_temp']);
              return { ...eDataNomJson };
            });
            return { ...eDataNom };
          },
        );
        return { ...eData };
      });

      const gas_day_text = dayjs(e['gas_day']).format('DD/MM/YYYY');
      const shipper_name = e['shipper_name'];

      return {
        shipper_name,
        gas_day: gas_day_text,
        gas_day_text,
        dataDW: e['data'],
        nomination_type: e['nomination_type'],
      };
    });
    const nomFlat = resultGroupType?.flatMap((e: any) => {
      const { dataDW, ...nE } = e;
      const nom = dataDW?.map((eD: any) => {
        return {
          ...nE,
          ...eD,
        };
      });

      return [...nom];
    });

    const nomJsonRowFlat = nomFlat?.flatMap((e: any) => {
      const { nomination_version, ...nE } = e;
      const nomination_version_one = e?.nomination_version[0] || [];
      nomination_version_one.nomination_full_json =
        nomination_version_one.nomination_full_json[0];
      const { nomination_row_json, ...nER } = nomination_version_one;

      const nom = nomination_row_json?.map((eD: any) => {
        return {
          nomination_code: nE?.contract_code?.contract_code,
          contract: nE?.contract_code?.contract_code,
          unit: eD['data_temp']['9'],
          point: eD['data_temp']['3'],
          entryExit: eD['data_temp']['10'],
          nomVersionId: nER?.id,
          nomVersionVersion: nER?.version,
          nomVersionFull: nER?.nomination_full_json,
          ...nE,
          ...eD,
        };
      });

      return [...nom];
    });

    const nomData = nomJsonRowFlat?.filter((f: any) => {
      return f?.query_shipper_nomination_type_id === 1;
    });
    const nomTypeExt = nomData?.flatMap((e: any) => {
      const dataE = [];
      if (e['nomination_type_id'] === 2) {
        // weekly
        for (let i = 0; i < daysOfWeek.length; i++) {
          //
          dataE.push({
            ...e,
            total:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) ||
              0,
            totalType: daysOfWeek[i],
            gasDayUse: e?.nomVersionFull?.data_temp?.headData[`${14 + i}`],
            HV: Number(e['data_temp']['12']?.trim()?.replace(/,/g, '')) || 0,
            rowId: e?.id,
            H1:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H2:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H3:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H4:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H5:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H6:
              (Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
                24) |
              0,
            H7:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H8:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H9:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H10:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H11:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H12:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H13:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H14:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H15:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H16:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H17:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H18:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H19:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H20:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H21:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H22:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H23:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H24:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
          });
        }
      } else {
        // daily
        dataE.push({
          ...e,
          total: Number(e['data_temp']['38']?.trim()?.replace(/,/g, '')) || 0,
          totalType: 'daily',
          gasDayUse: e?.gas_day_text,
          HV: Number(e['data_temp']['12']?.trim()?.replace(/,/g, '')) || 0,
          rowId: e?.id,
          H1: Number(e['data_temp']['14']?.trim()?.replace(/,/g, '')) || 0,
          H2: Number(e['data_temp']['15']?.trim()?.replace(/,/g, '')) || 0,
          H3: Number(e['data_temp']['16']?.trim()?.replace(/,/g, '')) || 0,
          H4: Number(e['data_temp']['17']?.trim()?.replace(/,/g, '')) || 0,
          H5: Number(e['data_temp']['18']?.trim()?.replace(/,/g, '')) || 0,
          H6: Number(e['data_temp']['19']?.trim()?.replace(/,/g, '')) || 0,
          H7: Number(e['data_temp']['20']?.trim()?.replace(/,/g, '')) || 0,
          H8: Number(e['data_temp']['21']?.trim()?.replace(/,/g, '')) || 0,
          H9: Number(e['data_temp']['22']?.trim()?.replace(/,/g, '')) || 0,
          H10: Number(e['data_temp']['23']?.trim()?.replace(/,/g, '')) || 0,
          H11: Number(e['data_temp']['24']?.trim()?.replace(/,/g, '')) || 0,
          H12: Number(e['data_temp']['25']?.trim()?.replace(/,/g, '')) || 0,
          H13: Number(e['data_temp']['26']?.trim()?.replace(/,/g, '')) || 0,
          H14: Number(e['data_temp']['27']?.trim()?.replace(/,/g, '')) || 0,
          H15: Number(e['data_temp']['28']?.trim()?.replace(/,/g, '')) || 0,
          H16: Number(e['data_temp']['29']?.trim()?.replace(/,/g, '')) || 0,
          H17: Number(e['data_temp']['30']?.trim()?.replace(/,/g, '')) || 0,
          H18: Number(e['data_temp']['31']?.trim()?.replace(/,/g, '')) || 0,
          H19: Number(e['data_temp']['32']?.trim()?.replace(/,/g, '')) || 0,
          H20: Number(e['data_temp']['33']?.trim()?.replace(/,/g, '')) || 0,
          H21: Number(e['data_temp']['34']?.trim()?.replace(/,/g, '')) || 0,
          H22: Number(e['data_temp']['35']?.trim()?.replace(/,/g, '')) || 0,
          H23: Number(e['data_temp']['36']?.trim()?.replace(/,/g, '')) || 0,
          H24: Number(e['data_temp']['37']?.trim()?.replace(/,/g, '')) || 0,
        });
      }

      return [...dataE];
    });
    const nomExt = nomTypeExt?.map((e: any) => {
      const {
        rowId,
        nomination_code,
        HV,
        gasDayUse,
        contract,
        shipper_name,
        zone_text,
        area_text,
        unit,
        point,
        entryExit,
        total,
        totalType,
        contract_code,
        nomination_type_id,
        H1,
        H2,
        H3,
        H4,
        H5,
        H6,
        H7,
        H8,
        H9,
        H10,
        H11,
        H12,
        H13,
        H14,
        H15,
        H16,
        H17,
        H18,
        H19,
        H20,
        H21,
        H22,
        H23,
        H24,
        ...nE
      } = e;
      const entryExitId = entryExit === 'Entry' ? 1 : 2;
      const areaObj = areaMaster?.find((f: any) => {
        return f?.name === area_text && f?.entry_exit_id === entryExitId;
      });
      const entryExitObj = entryExitMaster?.find((f: any) => {
        return f?.id === entryExitId;
      });

      return {
        rowId,
        nomination_code,
        HV,
        contract,
        gasDayUse,
        shipper_name,
        zone_text,
        area_text,
        unit,
        point,
        entryExit,
        total,
        totalType,
        // contract_code,
        contract_code_id: contract_code?.id,
        areaObj,
        entryExitObj,
        term: contract_code?.term_type_id === 4 ? 'non-firm' : 'firm',
        nomination_type_id,
        H1,
        H2,
        H3,
        H4,
        H5,
        H6,
        H7,
        H8,
        H9,
        H10,
        H11,
        H12,
        H13,
        H14,
        H15,
        H16,
        H17,
        H18,
        H19,
        H20,
        H21,
        H22,
        H23,
        H24,
      };
    });

    const deduplicateByKeys = (data) => {
      const map = new Map();

      for (const item of data) {
        const key = [
          item.gasDayUse,
          item.contract,
          item.shipper_name,
          item.area_text,
          item.zone_text,
          item.point,
          item.unit,
          item.nomination_type_id,
          item.nomination_code,
        ].join('|');

        if (!map.has(key)) {
          map.set(key, []);
        }

        map.get(key).push(item);
      }
      // console.log('map : ', map);
      const result = [];

      for (const [_, group] of map.entries()) {
        if (group.length === 1) {
          result.push(group[0]); // ไม่ซ้ำ
        } else {
          const daily = group.find((g) => g.totalType === 'daily');
          if (daily) result.push(daily); // ซ้ำแต่มี daily
        }
      }

      return result;
    };

    const filteredDataDW = deduplicateByKeys(nomExt);

    const nDaily = filteredDataDW?.filter((f: any) => {
      return f?.nomination_type_id === 1;
    });
    const nWeekly = filteredDataDW?.filter((f: any) => {
      return f?.nomination_type_id === 2;
    });

    const nDailyEntry = nDaily?.filter((f: any) => {
      return f?.entryExit === 'Entry';
    })?.filter((f: any) => {
      return f?.unit === 'MMSCFD';
    });
    const nDailyEXit = nDaily?.filter((f: any) => {
      return f?.entryExit === 'Exit';
    })?.filter((f: any) => {
      return f?.unit === 'MMBTU/D';
    });
    const nWeeklyEntry = nWeekly?.filter((f: any) => {
      return f?.entryExit === 'Entry';
    })?.filter((f: any) => {
      return f?.unit === 'MMSCFD';
    });
    const nWeeklyEXit = nWeekly?.filter((f: any) => {
      return f?.entryExit === 'Exit';
    })?.filter((f: any) => {
      return f?.unit === 'MMBTU/D';
    });

    const dataConvert = !!meteredMicroData?.reply && this.safeParseJSON(meteredMicroData?.reply) || null

    const hvFn = (eValue: any, hour: any) => {
      const hvDefault = 1005
      const hourTime = [
        '00',
        '01',
        '02',
        '03',
        '04',
        '05',
        '06',
        '07',
        '08',
        '09',
        '10',
        '11',
        '12',
        '13',
        '14',
        '15',
        '16',
        '17',
        '18',
        '19',
        '20',
        '21',
        '22',
        '23',
      ]
      const findMeter: any = meterData?.find((f: any) => {
        return (
          f?.nomination_point?.nomination_point === eValue?.point
        )
      })?.metered_point_name

      const fMeter = dataConvert?.filter((f: any) => {
        return (
          f?.meteringPointId === findMeter &&
          getTodayNow(f?.registerTimestamp).format("HH") === hourTime[hour]
        )
      })

      const hvXvi = fMeter.length > 0 ? fMeter.reduce((sum, item) => sum + (Number(item.heatingValue) * Number(item.volume)), 0) : null;
      const viAll = fMeter.length > 0 ? fMeter.reduce((sum, item) => sum + Number(item.volume), 0) : null;

      const hv = hvXvi / viAll
      const hvX = hv ? Number(hv) : hvDefault

      return hvX
    }

    const hvnDailyEntry = nDailyEntry?.map((e: any) => {
      // MMSCFD * 24
      const {
        H1,
        H2,
        H3,
        H4,
        H5,
        H6,
        H7,
        H8,
        H9,
        H10,
        H11,
        H12,
        H13,
        H14,
        H15,
        H16,
        H17,
        H18,
        H19,
        H20,
        H21,
        H22,
        H23,
        H24,
        ...nE
      } = e
      return {
        H1: H1 * 24,
        H2: H2 * 24,
        H3: H3 * 24,
        H4: H4 * 24,
        H5: H5 * 24,
        H6: H6 * 24,
        H7: H7 * 24,
        H8: H8 * 24,
        H9: H9 * 24,
        H10: H10 * 24,
        H11: H11 * 24,
        H12: H12 * 24,
        H13: H13 * 24,
        H14: H14 * 24,
        H15: H15 * 24,
        H16: H16 * 24,
        H17: H17 * 24,
        H18: H18 * 24,
        H19: H19 * 24,
        H20: H20 * 24,
        H21: H21 * 24,
        H22: H22 * 24,
        H23: H23 * 24,
        H24: H24 * 24,
        ...nE
      }
    })

    const hvnDailyEXit = nDailyEXit?.map((e: any) => {
      // (MMBTU/D / hv) * 24

      const {
        H1,
        H2,
        H3,
        H4,
        H5,
        H6,
        H7,
        H8,
        H9,
        H10,
        H11,
        H12,
        H13,
        H14,
        H15,
        H16,
        H17,
        H18,
        H19,
        H20,
        H21,
        H22,
        H23,
        H24,
        ...nE
      } = e

      return {
        H1: (H1 / hvFn(e, 0)) * 24,
        H2: (H2 / hvFn(e, 1)) * 24,
        H3: (H3 / hvFn(e, 2)) * 24,
        H4: (H4 / hvFn(e, 3)) * 24,
        H5: (H5 / hvFn(e, 4)) * 24,
        H6: (H6 / hvFn(e, 5)) * 24,
        H7: (H7 / hvFn(e, 6)) * 24,
        H8: (H8 / hvFn(e, 7)) * 24,
        H9: (H9 / hvFn(e, 8)) * 24,
        H10: (H10 / hvFn(e, 9)) * 24,
        H11: (H11 / hvFn(e, 10)) * 24,
        H12: (H12 / hvFn(e, 11)) * 24,
        H13: (H13 / hvFn(e, 12)) * 24,
        H14: (H14 / hvFn(e, 13)) * 24,
        H15: (H15 / hvFn(e, 14)) * 24,
        H16: (H16 / hvFn(e, 15)) * 24,
        H17: (H17 / hvFn(e, 16)) * 24,
        H18: (H18 / hvFn(e, 17)) * 24,
        H19: (H19 / hvFn(e, 18)) * 24,
        H20: (H20 / hvFn(e, 19)) * 24,
        H21: (H21 / hvFn(e, 20)) * 24,
        H22: (H22 / hvFn(e, 21)) * 24,
        H23: (H23 / hvFn(e, 22)) * 24,
        H24: (H24 / hvFn(e, 23)) * 24,
        ...nE
      }
    })


    const hvnWeeklyEXit = nWeeklyEXit?.map((e: any) => {
      // (MMBTU/D / hv)
      const {
        H1,
        H2,
        H3,
        H4,
        H5,
        H6,
        H7,
        H8,
        H9,
        H10,
        H11,
        H12,
        H13,
        H14,
        H15,
        H16,
        H17,
        H18,
        H19,
        H20,
        H21,
        H22,
        H23,
        H24,
        ...nE
      } = e

      return {
        H1: H1 / hvFn(e, 0),
        H2: H2 / hvFn(e, 1),
        H3: H3 / hvFn(e, 2),
        H4: H4 / hvFn(e, 3),
        H5: H5 / hvFn(e, 4),
        H6: H6 / hvFn(e, 5),
        H7: H7 / hvFn(e, 6),
        H8: H8 / hvFn(e, 7),
        H9: H9 / hvFn(e, 0),
        H10: H10 / hvFn(e, 0),
        H11: H11 / hvFn(e, 0),
        H12: H12 / hvFn(e, 0),
        H13: H13 / hvFn(e, 0),
        H14: H14 / hvFn(e, 0),
        H15: H15 / hvFn(e, 0),
        H16: H16 / hvFn(e, 0),
        H17: H17 / hvFn(e, 0),
        H18: H18 / hvFn(e, 0),
        H19: H19 / hvFn(e, 0),
        H20: H20 / hvFn(e, 0),
        H21: H21 / hvFn(e, 0),
        H22: H22 / hvFn(e, 0),
        H23: H23 / hvFn(e, 0),
        H24: H24 / hvFn(e, 0),
        ...nE
      }
    })

    const noMMSCFD = [...hvnDailyEntry, ...hvnDailyEXit, ...nWeeklyEntry, ...hvnWeeklyEXit]

    // daily entry MMSCFD * 24
    // daily exit (MMBTU/D / hv) * 24
    // weekly entry MMSCFD
    // weekly exit (MMBTU/D / hv)


    const calcAdjustFind = noMMSCFD?.flatMap((e: any) => {
      const dailyAdjustFind = dailyAdjust
        ?.filter((f: any) => {
          return (
            f['daily_adjustment_group']
              ?.map((dag: any) => dag?.group?.name)
              ?.includes(e['shipper_name']) &&
            f?.area?.name === e['area_text'] &&
            dayjs(f?.gas_day).format('DD/MM/YYYY') === e['gasDayUse']
          );
        })
        ?.flatMap((np: any) => [
          ...np?.daily_adjustment_nom.map((t: any) => {
            return {
              timeUse: np?.time,
              gas_day: dayjs(np?.gas_day).format('DD/MM/YYYY'),
              ...t,
            };
          }),
        ]);
      const dailyAdjustFindPoint = dailyAdjustFind?.filter((f: any) => {
        return f?.nomination_point?.nomination_point === e['point'];
      });

      if (dailyAdjustFindPoint?.length > 0) {
        const adjustData = dailyAdjustFindPoint?.map((da: any) => {
          return {
            // ...da,
            create_date: da?.create_date,
            timeUse: da?.timeUse,
            gas_day: da?.gas_day,
            heating_value: da?.heating_value,
            hour: Number(da?.timeUse.split(':')[0]) ?? null,
            minute: Number(da?.timeUse.split(':')[1]) ?? null,
            hourTime: `H${Number(da?.timeUse.split(':')[0]) + 1}`,
            adjustH: da?.valume_mmscfh2
              ? Number(da?.valume_mmscfh2)
              // : Number(da?.valume_mmscfd2),
              : Number(da?.valume_mmscfd2) / 24,
            adjustHFlag: !!da?.valume_mmscfh2
          };
        });

        return [
          {
            dailyAdjustFindPoint: adjustData,
            adjustment: 'YES',
            ...e,
          },
          {
            dailyAdjustFindPoint: [],
            adjustment: 'NO',
            ...e,
          },
        ];
      } else {
        return [
          {
            dailyAdjustFindPoint: [],
            adjustment: 'NO',
            ...e,
          },
        ];
      }
    });

    const filContract = contractCode
      ? calcAdjustFind?.filter((f: any) => {
        return f?.contract === contractCode;
      })
      : calcAdjustFind;
    const startDateArr = dayjs(startDate, 'DD/MM/YYYY');
    const endDateArr = dayjs(endDate, 'DD/MM/YYYY');

    const filteredDate = filContract.filter((item) => {
      const gasDay = dayjs(item.gasDayUse, 'DD/MM/YYYY');
      return (
        gasDay.isSameOrAfter(startDateArr) && gasDay.isSameOrBefore(endDateArr)
      );
    });

    const filCheckAdjustment = checkAdjustment
      ? filteredDate?.filter((f: any) => {
        return f?.adjustment === 'YES';
      })
      : filteredDate;

    const hourTime = [
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'H7',
      'H8',
      'H9',
      'H10',
      'H11',
      'H12',
      'H13',
      'H14',
      'H15',
      'H16',
      'H17',
      'H18',
      'H19',
      'H20',
      'H21',
      'H22',
      'H23',
      'H24',
    ];

    const calcAdjust = filCheckAdjustment?.map((e: any) => {
      const timeShow: any = [];

      if (e['adjustment'] === 'YES') {
        console.log('yes : ', e);

        for (let hI = 0; hI < hourTime.length; hI++) {
          const sumAllH = {};
          if (e['adjustment'] === 'YES') {
            const fil = filCheckAdjustment?.filter((f: any) => {
              return (
                f?.adjustment === 'YES' &&
                f?.shipper_name === e?.shipper_name &&
                f?.gasDayUse === e?.gasDayUse &&
                f?.area_text === e?.area_text &&
                f?.contract === e?.contract
              );
            });
            console.log('fil : ', fil);
            for (let hI = 0; hI < hourTime.length; hI++) {
              const sumWithInitial = fil
                ?.map((sH: any) => Number(sH[hourTime[hI]]) || 0)
                .reduce(
                  (accumulator, currentValue) => accumulator + currentValue,
                  0,
                );
              sumAllH[hourTime[hI]] = sumWithInitial;
            }
          }
          const findH = e['dailyAdjustFindPoint']?.filter((f: any) => {
            return f?.hourTime === hourTime[hI];
          });
          if (findH.length > 0) {
            const originalPointRowH = Number(e[hourTime[hI]]) ?? 0;
            const sumAllPointRowH = Number(sumAllH[hourTime[hI]]) ?? 0; //**********
            let calcResult = 0;
            if (findH.length > 1) {
              const sorted = [...findH].sort((a, b) => {
                if (a.minute !== b.minute) {
                  return a.minute - b.minute; // เรียงตาม minute ก่อน
                }

                return dayjs(a.create_date).isBefore(dayjs(b.create_date))
                  ? -1
                  : 1;
              });

              let minuteSum = 0;
              const oldMinute = 0;
              let adjustHFlag = false;
              for (let mS = 0; mS < sorted.length; mS++) {
                const adjustValue = Number(sorted[mS]?.adjustH) ?? 0;
                const calcStep1 =
                  (originalPointRowH / sumAllPointRowH) * adjustValue;

                // const calcStep2 = calcStep1 * (( sorted[mS]?.minute - oldMinute) / 60)
                // oldMinute = sorted[mS]?.minute
                // minuteSum += calcStep2
                minuteSum += calcStep1;
                adjustHFlag = sorted[mS]?.adjustHFlag
              }

              calcResult = adjustHFlag ? minuteSum * 24 : minuteSum;
              // adjustHFlag: !!da?.valume_mmscfh2 t = h * 24 , f = d
            } else {
              // 1 calc ปกติ
              const adjustValue = Number(findH[0]?.adjustH) ?? 0;
              const calcStep1 =
                (originalPointRowH / sumAllPointRowH) * adjustValue;
              // calcResult = calcStep1;
              calcResult = findH[0]?.adjustHFlag ? calcStep1 * 24 : calcStep1;


            }

            // (nrow/nsum)/adjust
            // e[findH[0]?.timeUse] = calcResult
            timeShow.push({ time: findH[0]?.timeUse, value: calcResult }); //https://app.clickup.com/t/86etnehdr
            // timeShow.push({ time: findH[0]?.timeUse, value: calcResult });

            for (let i = 0; i < hourTime.length; i++) {
              if (i === hI) {
                e[hourTime[i]] = calcResult; // เริ่มเปลี่ยนที่ H3
                for (let j = i + 1; j < hourTime.length; j++) {
                  e[hourTime[j]] = calcResult; // เปลี่ยนตำแหน่งถัดไปทั้งหมด
                }
                break; // จบ loop หลัง cascade
              }
            }
          } else {
            e[hourTime[hI]] = e[hourTime[hI]];
          }
        }
      }

      // const totalH1ToH24Adjust =
      //   e['H1'] +
      //   e['H2'] +
      //   e['H3'] +
      //   e['H4'] +
      //   e['H5'] +
      //   e['H6'] +
      //   e['H7'] +
      //   e['H8'] +
      //   e['H9'] +
      //   e['H10'] +
      //   e['H11'] +
      //   e['H12'] +
      //   e['H13'] +
      //   e['H14'] +
      //   e['H15'] +
      //   e['H16'] +
      //   e['H17'] +
      //   e['H18'] +
      //   e['H19'] +
      //   e['H20'] +
      //   e['H21'] +
      //   e['H22'] +
      //   e['H23'] +
      //   e['H24'];

      // timeShow
      const hourT = [
        '00:00',
        '01:00',
        '02:00',
        '03:00',
        '04:00',
        '05:00',
        '06:00',
        '07:00',
        '08:00',
        '09:00',
        '10:00',
        '11:00',
        '12:00',
        '13:00',
        '14:00',
        '15:00',
        '16:00',
        '17:00',
        '18:00',
        '19:00',
        '20:00',
        '21:00',
        '22:00',
        '23:00',
      ];
      for (let i = 0; i < hourT.length; i++) {
        // timeShow
        const findTS = timeShow?.find((f: any) => {
          return f?.time === hourT[i];
        });
        if (!findTS) {
          timeShow.push({
            time: hourT[i],
            value: e[`H${Number(hourT[i]?.split(':')[0]) + 1}`] * 24,
          }); //https://app.clickup.com/t/86etnehdr
          // timeShow.push({
          //   time: hourT[i],
          //   value: e[`H${Number(hourT[i]?.split(':')[0]) + 1}`],
          // });
        }
      }
      const {
        H1,
        H2,
        H3,
        H4,
        H5,
        H6,
        H7,
        H8,
        H9,
        H10,
        H11,
        H12,
        H13,
        H14,
        H15,
        H16,
        H17,
        H18,
        H19,
        H20,
        H21,
        H22,
        H23,
        H24,
        ...nE
      } = e;

      return {
        ...nE,
        timeShow,
        // totalH1ToH24Adjust,
      };
    });

    const cutNo = calcAdjust?.map((e: any) => {
      const check = calcAdjust?.find((f: any) => {
        return (
          f?.adjustment === "YES" &&
          f?.gasDayUse === e["gasDayUse"] &&
          f?.point === e["point"] &&
          f?.shipper_name === e["shipper_name"]
        )
      })

      const uData = check && e["adjustment"] === "NO" ? null : { ...e }

      return uData
    })?.filter((f: any) => { return f !== null })
    console.log('cutNo : ', cutNo);

    // https://app.clickup.com/t/86etnehdr
    const ncutNo = cutNo?.map((e: any) => {
      const { total, ...nE } = e
      return {
        ...nE,
        total: total * 24
      }
    })

    console.log('cutNo : ', cutNo);



    console.log('ncutNo : ', ncutNo);
    const groupedByContract = Object.values(
      ncutNo.reduce((acc, item) => {
        const key = `${item?.point}|${item?.shipper_name}`;
        if (!acc[key]) {
          acc[key] = {
            point: item?.point,
            shipper_name: item?.shipper_name,
            timeShow: [],
          };
        }
        acc[key].timeShow.push(item?.timeShow);
        return acc;
      }, {}),
    );
    const tgroupedByContract = groupedByContract?.map((e: any) => {
      const { timeShow, ...nE } = e
      const merged = {};
      for (const group of e?.timeShow) {
        for (const item of group) {
          if (!merged[item.time]) {
            merged[item.time] = { ...item }; // clone object
          } else {
            merged[item.time].value += item.value;
          }
        }
      }
      const timeShowx = Object.values(merged);

      return {
        ...nE,
        timeShow: timeShowx
      }
    })

    // console.log('tgroupedByContract : ', tgroupedByContract);

    function getLatestDataPoint(data: any) {
      const now = new Date()

      // แปลงเวลาแต่ละรายการให้เป็น date object (เฉพาะเวลา)
      const formatted = data.map(item => ({
        ...item,
        timeDate: new Date(now.toDateString() + ' ' + item.time),
      }))
      // กรองรายการที่ไม่เกินเวลาปัจจุบัน
      const pastItems = formatted.filter(item => item.timeDate <= now).sort((a, b) => dayjs(b.time, 'HH:mm').diff(dayjs(a.time, 'HH:mm')))
      // ถ้ามีรายการที่ผ่านแล้ว → เอารายการสุดท้าย
      if (pastItems.length > 0) {
        const latest = pastItems[0]
        return { time: latest.time, value: latest.value }
      }

      // ถ้าไม่เจอ → return null หรือ fallback
      return null
    }

    const useTimeLastNom = tgroupedByContract?.map((e: any) => {
      const { timeShow, ...nE } = e
      const timeShows = getLatestDataPoint(timeShow)
      return {
        ...nE,
        timeShow: timeShows
      }
    })

    // 
    const nuseTimeLastNom = useTimeLastNom?.map((e: any) => {
      const { timeShow, ...nE } = e
      return {
        ...e,
        timeShow: {
          ...timeShow,
          time: getTodayNow().format("HH:mm")
        }
      }
    })

    return nuseTimeLastNom;
  }


  async dailyAdjustmentReport(payload: any, userId: any) {
    const { checkAdjustment, startDate, endDate, contractCode } = payload || {};

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const daysOfWeek = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];

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

    const entryExitMaster = await this.prisma.entry_exit.findMany({
      where: {},
    });

    const dailyAdjust = await this.prisma.daily_adjustment.findMany({
      where: {
        daily_adjustment_status_id: 2,
      },
      include: {
        area: true,
        entry_exit: true,
        daily_adjustment_group: {
          include: {
            group: {
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
          },
        },
        daily_adjustment_nom: {
          include: {
            nomination_point: true,
          },
        },
        daily_adjustment_status: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    const meterData = await this.prisma.metering_point.findMany({
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
      include: {
        zone: true,
        area: true,
        nomination_point: true,
      },
    });

    // Extract gas days and generate date array
    const getMeterFrom = getTodayNowDDMMYYYYDfault(startDate)
    const getMeterTo = getTodayNowDDMMYYYYDfault(endDate)
    const dateArray: string[] = []
    // Fill dateArray with all dates between getMeterFrom and getMeterTo (inclusive) in YYYY-MM-DD format
    let current = getMeterFrom.clone();
    while (current.isSameOrBefore(getMeterTo, 'day')) {
      dateArray.push(current.format('YYYY-MM-DD'));
      current = current.add(1, 'day');
    }
    // Build active data for all dates
    const activeData = await buildActiveDataForDates(
      dateArray,
      this.prisma
    );

    const meteredMicroData = await this.meteredMicroService.sendMessage(JSON.stringify({
      case: "getLast",
      mode: "metering",
      start_date: getMeterFrom.format("YYYY-MM-DD"),
      end_date: getMeterTo.format("YYYY-MM-DD")
      // start_date: "2025-06-09",
      // end_date:"2025-06-13"
    }),
      {
        activeData,
        prisma: this.prisma
      });

    const nominationData =
      await this.prisma.query_shipper_nomination_file.findMany({
        where: {
          // gas_day: {
          //   gte: dayjs(startDate, 'DD/MM/YYYY').toDate(),
          //   lte: dayjs(endDate, 'DD/MM/YYYY').endOf('day').toDate(),
          // },
          OR: [{ del_flag: false }, { del_flag: null }],
          query_shipper_nomination_status: {
            id: {
              in: [2, 5],
            },
          },
        },
        include: {
          group: true,
          query_shipper_nomination_status: true,
          contract_code: true,
          nomination_type: true,
          nomination_version: {
            include: {
              nomination_full_json: true,
              nomination_full_json_sheet2: true,
              nomination_row_json: {
                include: {
                  query_shipper_nomination_type: true,
                },
                orderBy: {
                  id: 'asc',
                },
              },
            },
            where: {
              flag_use: true,
            },
          },
        },
        orderBy: {
          id: 'desc',
        },
      });

    const grouped = {};
    for (const curr of nominationData) {
      const key = `${curr.gas_day}|${curr.group?.name}|${curr?.nomination_type?.id}`;

      if (!grouped[key]) {
        grouped[key] = {
          gas_day: curr.gas_day,
          shipper_name: curr.group?.name,
          nomination_type: curr?.nomination_type,
          data: [],
        };
      }

      grouped[key].data.push({ ...curr });
    }
    const resultGroup: any = Object.values(grouped);
    const resultGroupType = resultGroup.map((e: any) => {
      e['data'] = e['data']?.map((eData: any) => {
        eData['nomination_version'] = eData['nomination_version']?.map(
          (eDataNom: any) => {
            eDataNom['nomination_full_json'] = eDataNom[
              'nomination_full_json'
            ]?.map((eDataNomJson: any) => {
              eDataNomJson['data_temp'] = this.safeParseJSON(eDataNomJson['data_temp']);
              return { ...eDataNomJson };
            });
            // eDataNom["nomination_full_json_sheet2"] = eDataNom["nomination_full_json_sheet2"]?.map((eDataNomJson:any) => {
            //   eDataNomJson["data_temp"] = JSON.parse(eDataNomJson["data_temp"])
            //   return { ...eDataNomJson }
            // })
            eDataNom['nomination_row_json'] = eDataNom[
              'nomination_row_json'
            ]?.map((eDataNomJson: any) => {
              eDataNomJson['data_temp'] = this.safeParseJSON(eDataNomJson['data_temp']);
              return { ...eDataNomJson };
            });
            return { ...eDataNom };
          },
        );
        return { ...eData };
      });

      const gas_day_text = dayjs(e['gas_day']).format('DD/MM/YYYY');
      const shipper_name = e['shipper_name'];

      return {
        shipper_name,
        gas_day: gas_day_text,
        gas_day_text,
        dataDW: e['data'],
        nomination_type: e['nomination_type'],
      };
    });
    const nomFlat = resultGroupType?.flatMap((e: any) => {
      const { dataDW, ...nE } = e;
      const nom = dataDW?.map((eD: any) => {
        return {
          ...nE,
          ...eD,
        };
      });

      return [...nom];
    });

    const nomJsonRowFlat = nomFlat?.flatMap((e: any) => {
      const { nomination_version, ...nE } = e;
      const nomination_version_one = e?.nomination_version[0] || [];
      nomination_version_one.nomination_full_json =
        nomination_version_one.nomination_full_json[0];
      const { nomination_row_json, ...nER } = nomination_version_one;

      const nom = nomination_row_json?.map((eD: any) => {
        return {
          nomination_code: nE?.contract_code?.contract_code,
          contract: nE?.contract_code?.contract_code,
          unit: eD['data_temp']['9'],
          point: eD['data_temp']['3'],
          entryExit: eD['data_temp']['10'],
          nomVersionId: nER?.id,
          nomVersionVersion: nER?.version,
          nomVersionFull: nER?.nomination_full_json,
          ...nE,
          ...eD,
        };
      });

      return [...nom];
    });

    const nomData = nomJsonRowFlat?.filter((f: any) => {
      return f?.query_shipper_nomination_type_id === 1;
    });
    const nomTypeExt = nomData?.flatMap((e: any) => {
      const dataE = [];
      if (e['nomination_type_id'] === 2) {
        // weekly
        for (let i = 0; i < daysOfWeek.length; i++) {
          //
          dataE.push({
            ...e,
            total:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) ||
              0,
            totalType: daysOfWeek[i],
            gasDayUse: e?.nomVersionFull?.data_temp?.headData[`${14 + i}`],
            HV: Number(e['data_temp']['12']?.trim()?.replace(/,/g, '')) || 0,
            rowId: e?.id,
            H1:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H2:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H3:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H4:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H5:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H6:
              (Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
                24) |
              0,
            H7:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H8:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H9:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H10:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H11:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H12:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H13:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H14:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H15:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H16:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H17:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H18:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H19:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H20:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H21:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H22:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H23:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
            H24:
              Number(e['data_temp'][`${14 + i}`]?.trim()?.replace(/,/g, '')) /
              24 || 0,
          });
        }
      } else {
        // daily
        dataE.push({
          ...e,
          total: Number(e['data_temp']['38']?.trim()?.replace(/,/g, '')) || 0,
          totalType: 'daily',
          gasDayUse: e?.gas_day_text,
          HV: Number(e['data_temp']['12']?.trim()?.replace(/,/g, '')) || 0,
          rowId: e?.id,
          H1: Number(e['data_temp']['14']?.trim()?.replace(/,/g, '')) || 0,
          H2: Number(e['data_temp']['15']?.trim()?.replace(/,/g, '')) || 0,
          H3: Number(e['data_temp']['16']?.trim()?.replace(/,/g, '')) || 0,
          H4: Number(e['data_temp']['17']?.trim()?.replace(/,/g, '')) || 0,
          H5: Number(e['data_temp']['18']?.trim()?.replace(/,/g, '')) || 0,
          H6: Number(e['data_temp']['19']?.trim()?.replace(/,/g, '')) || 0,
          H7: Number(e['data_temp']['20']?.trim()?.replace(/,/g, '')) || 0,
          H8: Number(e['data_temp']['21']?.trim()?.replace(/,/g, '')) || 0,
          H9: Number(e['data_temp']['22']?.trim()?.replace(/,/g, '')) || 0,
          H10: Number(e['data_temp']['23']?.trim()?.replace(/,/g, '')) || 0,
          H11: Number(e['data_temp']['24']?.trim()?.replace(/,/g, '')) || 0,
          H12: Number(e['data_temp']['25']?.trim()?.replace(/,/g, '')) || 0,
          H13: Number(e['data_temp']['26']?.trim()?.replace(/,/g, '')) || 0,
          H14: Number(e['data_temp']['27']?.trim()?.replace(/,/g, '')) || 0,
          H15: Number(e['data_temp']['28']?.trim()?.replace(/,/g, '')) || 0,
          H16: Number(e['data_temp']['29']?.trim()?.replace(/,/g, '')) || 0,
          H17: Number(e['data_temp']['30']?.trim()?.replace(/,/g, '')) || 0,
          H18: Number(e['data_temp']['31']?.trim()?.replace(/,/g, '')) || 0,
          H19: Number(e['data_temp']['32']?.trim()?.replace(/,/g, '')) || 0,
          H20: Number(e['data_temp']['33']?.trim()?.replace(/,/g, '')) || 0,
          H21: Number(e['data_temp']['34']?.trim()?.replace(/,/g, '')) || 0,
          H22: Number(e['data_temp']['35']?.trim()?.replace(/,/g, '')) || 0,
          H23: Number(e['data_temp']['36']?.trim()?.replace(/,/g, '')) || 0,
          H24: Number(e['data_temp']['37']?.trim()?.replace(/,/g, '')) || 0,
        });
      }

      return [...dataE];
    });
    console.log('nomTypeExt : ', nomTypeExt);
    const nomExt = nomTypeExt?.map((e: any) => {
      const {
        rowId,
        nomination_code,
        HV,
        gasDayUse,
        contract,
        shipper_name,
        zone_text,
        area_text,
        unit,
        point,
        entryExit,
        total,
        totalType,
        contract_code,
        nomination_type_id,
        H1,
        H2,
        H3,
        H4,
        H5,
        H6,
        H7,
        H8,
        H9,
        H10,
        H11,
        H12,
        H13,
        H14,
        H15,
        H16,
        H17,
        H18,
        H19,
        H20,
        H21,
        H22,
        H23,
        H24,
        ...nE
      } = e;
      const entryExitId = entryExit === 'Entry' ? 1 : 2;
      const areaObj = areaMaster?.find((f: any) => {
        return f?.name === area_text && f?.entry_exit_id === entryExitId;
      });
      const entryExitObj = entryExitMaster?.find((f: any) => {
        return f?.id === entryExitId;
      });

      return {
        rowId,
        nomination_code,
        HV,
        contract,
        gasDayUse,
        shipper_name,
        zone_text,
        area_text,
        unit,
        point,
        entryExit,
        total,
        totalType,
        // contract_code,
        contract_code_id: contract_code?.id,
        areaObj,
        entryExitObj,
        term: contract_code?.term_type_id === 4 ? 'non-firm' : 'firm',
        nomination_type_id,
        H1,
        H2,
        H3,
        H4,
        H5,
        H6,
        H7,
        H8,
        H9,
        H10,
        H11,
        H12,
        H13,
        H14,
        H15,
        H16,
        H17,
        H18,
        H19,
        H20,
        H21,
        H22,
        H23,
        H24,
      };
    });

    // const deduplicateByKeys = (data) => {
    //   const map = new Map();

    //   for (const item of data) {
    //     const key = [
    //       item.gasDayUse,
    //       item.contract,
    //       item.shipper_name,
    //       item.area_text,
    //       item.zone_text,
    //       item.point,
    //       item.unit,
    //     ].join('|');

    //     if (!map.has(key)) {
    //       map.set(key, []);
    //     }

    //     map.get(key).push(item);
    //   }

    //   const result = [];

    //   for (const [_, group] of map.entries()) {
    //     if (group.length === 1) {
    //       result.push(group[0]); // ไม่ซ้ำ
    //     } else {
    //       const daily = group.find((g) => g.totalType === 'daily');
    //       if (daily) result.push(daily); // ซ้ำแต่มี daily
    //     }
    //   }

    //   return result;
    // };

    const deduplicateByKeys = (data) => {
      const map = new Map();

      for (const item of data) {
        const key = [
          item.gasDayUse,
          item.contract,
          item.shipper_name,
          item.area_text,
          item.zone_text,
          item.point,
          item.unit,
          item.nomination_type_id,
          item.nomination_code,
        ].join('|');

        if (!map.has(key)) {
          map.set(key, []);
        }

        map.get(key).push(item);
      }
      // console.log('map : ', map);
      const result = [];

      for (const [_, group] of map.entries()) {
        if (group.length === 1) {
          result.push(group[0]); // ไม่ซ้ำ
        } else {
          const daily = group.find((g) => g.totalType === 'daily');
          if (daily) result.push(daily); // ซ้ำแต่มี daily
        }
      }

      return result;
    };

    const filteredDataDW = deduplicateByKeys(nomExt);
    // unit
    // console.log('filteredDataDW : ', filteredDataDW);
    // const noMMSCFD = filteredDataDW?.filter((f: any) => {
    //   // return f?.unit !== 'MMSCFD';
    //   return f?.unit === 'MMSCFD';
    // });
    const nDaily = filteredDataDW?.filter((f: any) => {
      return f?.nomination_type_id === 1;
    });
    const nWeekly = filteredDataDW?.filter((f: any) => {
      return f?.nomination_type_id === 2;
    });

    const nDailyEntry = nDaily?.filter((f: any) => {
      return f?.entryExit === 'Entry';
    })?.filter((f: any) => {
      return f?.unit === 'MMSCFD';
    });
    const nDailyEXit = nDaily?.filter((f: any) => {
      return f?.entryExit === 'Exit';
    })?.filter((f: any) => {
      return f?.unit === 'MMBTU/D';
    });
    const nWeeklyEntry = nWeekly?.filter((f: any) => {
      return f?.entryExit === 'Entry';
    })?.filter((f: any) => {
      return f?.unit === 'MMSCFD';
    });
    const nWeeklyEXit = nWeekly?.filter((f: any) => {
      return f?.entryExit === 'Exit';
    })?.filter((f: any) => {
      return f?.unit === 'MMBTU/D';
    });

    // console.log('meterData : ', meterData);
    const dataConvert = !!meteredMicroData?.reply && this.safeParseJSON(meteredMicroData?.reply) || null
    // console.log('dataConvert : ', dataConvert);

    //   datasource =
    // 'Daily_Billing'
    // energy =
    // 2360.31
    // gasDay =
    // '2025-06-09'
    // heatingValue =
    // 978.713
    // in_time =
    // 1749511039.166888
    // insert_timestamp =
    // '2025-06-10 13:21:06'
    //   metering_retrieving_id =
    // '20250610-MET-0104'
    // meteringPointId =
    // 'TPL'
    // registerTimestamp =
    // '2025-06-09T23:17:19.166885'
    // rw =
    // true
    // sg =
    // 0.589
    // volume =
    // 2.25
    // wobbeIndex =
    // 1297.747

    const hvFn = (eValue: any, hour: any) => {
      const hvDefault = 1005
      const hourTime = [
        '00',
        '01',
        '02',
        '03',
        '04',
        '05',
        '06',
        '07',
        '08',
        '09',
        '10',
        '11',
        '12',
        '13',
        '14',
        '15',
        '16',
        '17',
        '18',
        '19',
        '20',
        '21',
        '22',
        '23',
      ]
      const findMeter: any = meterData?.find((f: any) => {
        return (
          f?.nomination_point?.nomination_point === eValue?.point
        )
      })?.metered_point_name

      const fMeter = dataConvert?.filter((f: any) => {
        return (
          f?.meteringPointId === findMeter &&
          getTodayNow(f?.registerTimestamp).format("HH") === hourTime[hour]
        )
      })

      const hvXvi = fMeter.length > 0 ? fMeter.reduce((sum, item) => sum + (Number(item.heatingValue) * Number(item.volume)), 0) : null;
      const viAll = fMeter.length > 0 ? fMeter.reduce((sum, item) => sum + Number(item.volume), 0) : null;

      const hv = hvXvi / viAll
      const hvX = hv ? Number(hv) : hvDefault

      return hvX
    }

    const hvnDailyEntry = nDailyEntry?.map((e: any) => {
      // MMSCFD * 24
      const {
        H1,
        H2,
        H3,
        H4,
        H5,
        H6,
        H7,
        H8,
        H9,
        H10,
        H11,
        H12,
        H13,
        H14,
        H15,
        H16,
        H17,
        H18,
        H19,
        H20,
        H21,
        H22,
        H23,
        H24,
        ...nE
      } = e
      return {
        H1: H1 * 24,
        H2: H2 * 24,
        H3: H3 * 24,
        H4: H4 * 24,
        H5: H5 * 24,
        H6: H6 * 24,
        H7: H7 * 24,
        H8: H8 * 24,
        H9: H9 * 24,
        H10: H10 * 24,
        H11: H11 * 24,
        H12: H12 * 24,
        H13: H13 * 24,
        H14: H14 * 24,
        H15: H15 * 24,
        H16: H16 * 24,
        H17: H17 * 24,
        H18: H18 * 24,
        H19: H19 * 24,
        H20: H20 * 24,
        H21: H21 * 24,
        H22: H22 * 24,
        H23: H23 * 24,
        H24: H24 * 24,
        ...nE
      }
    })
    console.log('hvnDailyEntry : ', hvnDailyEntry);

    const hvnDailyEXit = nDailyEXit?.map((e: any) => {
      // (MMBTU/D / hv) * 24

      const {
        H1,
        H2,
        H3,
        H4,
        H5,
        H6,
        H7,
        H8,
        H9,
        H10,
        H11,
        H12,
        H13,
        H14,
        H15,
        H16,
        H17,
        H18,
        H19,
        H20,
        H21,
        H22,
        H23,
        H24,
        ...nE
      } = e

      return {
        H1: (H1 / hvFn(e, 0)) * 24,
        H2: (H2 / hvFn(e, 1)) * 24,
        H3: (H3 / hvFn(e, 2)) * 24,
        H4: (H4 / hvFn(e, 3)) * 24,
        H5: (H5 / hvFn(e, 4)) * 24,
        H6: (H6 / hvFn(e, 5)) * 24,
        H7: (H7 / hvFn(e, 6)) * 24,
        H8: (H8 / hvFn(e, 7)) * 24,
        H9: (H9 / hvFn(e, 8)) * 24,
        H10: (H10 / hvFn(e, 9)) * 24,
        H11: (H11 / hvFn(e, 10)) * 24,
        H12: (H12 / hvFn(e, 11)) * 24,
        H13: (H13 / hvFn(e, 12)) * 24,
        H14: (H14 / hvFn(e, 13)) * 24,
        H15: (H15 / hvFn(e, 14)) * 24,
        H16: (H16 / hvFn(e, 15)) * 24,
        H17: (H17 / hvFn(e, 16)) * 24,
        H18: (H18 / hvFn(e, 17)) * 24,
        H19: (H19 / hvFn(e, 18)) * 24,
        H20: (H20 / hvFn(e, 19)) * 24,
        H21: (H21 / hvFn(e, 20)) * 24,
        H22: (H22 / hvFn(e, 21)) * 24,
        H23: (H23 / hvFn(e, 22)) * 24,
        H24: (H24 / hvFn(e, 23)) * 24,
        ...nE
      }
    })
    console.log('hvnDailyEXit : ', hvnDailyEXit);

    const hvnWeeklyEXit = nWeeklyEXit?.map((e: any) => {
      // (MMBTU/D / hv)
      const {
        H1,
        H2,
        H3,
        H4,
        H5,
        H6,
        H7,
        H8,
        H9,
        H10,
        H11,
        H12,
        H13,
        H14,
        H15,
        H16,
        H17,
        H18,
        H19,
        H20,
        H21,
        H22,
        H23,
        H24,
        ...nE
      } = e

      return {
        H1: H1 / hvFn(e, 0),
        H2: H2 / hvFn(e, 1),
        H3: H3 / hvFn(e, 2),
        H4: H4 / hvFn(e, 3),
        H5: H5 / hvFn(e, 4),
        H6: H6 / hvFn(e, 5),
        H7: H7 / hvFn(e, 6),
        H8: H8 / hvFn(e, 7),
        H9: H9 / hvFn(e, 0),
        H10: H10 / hvFn(e, 0),
        H11: H11 / hvFn(e, 0),
        H12: H12 / hvFn(e, 0),
        H13: H13 / hvFn(e, 0),
        H14: H14 / hvFn(e, 0),
        H15: H15 / hvFn(e, 0),
        H16: H16 / hvFn(e, 0),
        H17: H17 / hvFn(e, 0),
        H18: H18 / hvFn(e, 0),
        H19: H19 / hvFn(e, 0),
        H20: H20 / hvFn(e, 0),
        H21: H21 / hvFn(e, 0),
        H22: H22 / hvFn(e, 0),
        H23: H23 / hvFn(e, 0),
        H24: H24 / hvFn(e, 0),
        ...nE
      }
    })
    console.log('hvnWeeklyEXit : ', hvnWeeklyEXit);
    // console.log('noMMSCFDtemp : ', noMMSCFDtemp);
    // const noMMSCFD = filteredDataDW
    const noMMSCFD = [...hvnDailyEntry, ...hvnDailyEXit, ...nWeeklyEntry, ...hvnWeeklyEXit]

    // daily entry MMSCFD * 24
    // daily exit (MMBTU/D / hv) * 24
    // weekly entry MMSCFD
    // weekly exit (MMBTU/D / hv)


    const calcAdjustFind = noMMSCFD?.flatMap((e: any) => {
      const dailyAdjustFind = dailyAdjust
        ?.filter((f: any) => {
          return (
            f['daily_adjustment_group']
              ?.map((dag: any) => dag?.group?.name)
              ?.includes(e['shipper_name']) &&
            f?.area?.name === e['area_text'] &&
            dayjs(f?.gas_day).format('DD/MM/YYYY') === e['gasDayUse']
          );
        })
        ?.flatMap((np: any) => [
          ...np?.daily_adjustment_nom.map((t: any) => {
            return {
              timeUse: np?.time,
              gas_day: dayjs(np?.gas_day).format('DD/MM/YYYY'),
              ...t,
            };
          }),
        ]);
      const dailyAdjustFindPoint = dailyAdjustFind?.filter((f: any) => {
        return f?.nomination_point?.nomination_point === e['point'];
      });

      if (dailyAdjustFindPoint?.length > 0) {
        const adjustData = dailyAdjustFindPoint?.map((da: any) => {
          return {
            // ...da,
            create_date: da?.create_date,
            timeUse: da?.timeUse,
            gas_day: da?.gas_day,
            heating_value: da?.heating_value,
            hour: Number(da?.timeUse.split(':')[0]) ?? null,
            minute: Number(da?.timeUse.split(':')[1]) ?? null,
            hourTime: `H${Number(da?.timeUse.split(':')[0]) + 1}`,
            adjustH: da?.valume_mmscfh2
              ? Number(da?.valume_mmscfh2)
              // : Number(da?.valume_mmscfd2),
              : Number(da?.valume_mmscfd2) / 24,
            adjustHFlag: !!da?.valume_mmscfh2
          };
        });

        return [
          {
            dailyAdjustFindPoint: adjustData,
            adjustment: 'YES',
            ...e,
          },
          {
            dailyAdjustFindPoint: [],
            adjustment: 'NO',
            ...e,
          },
        ];
      } else {
        return [
          {
            dailyAdjustFindPoint: [],
            adjustment: 'NO',
            ...e,
          },
        ];
      }
    });

    const filContract = contractCode
      ? calcAdjustFind?.filter((f: any) => {
        return f?.contract === contractCode;
      })
      : calcAdjustFind;
    const startDateArr = dayjs(startDate, 'DD/MM/YYYY');
    const endDateArr = dayjs(endDate, 'DD/MM/YYYY');

    const filteredDate = filContract.filter((item) => {
      const gasDay = dayjs(item.gasDayUse, 'DD/MM/YYYY');
      return (
        gasDay.isSameOrAfter(startDateArr) && gasDay.isSameOrBefore(endDateArr)
      );
    });

    const filCheckAdjustment = checkAdjustment
      ? filteredDate?.filter((f: any) => {
        return f?.adjustment === 'YES';
      })
      : filteredDate;

    const hourTime = [
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'H7',
      'H8',
      'H9',
      'H10',
      'H11',
      'H12',
      'H13',
      'H14',
      'H15',
      'H16',
      'H17',
      'H18',
      'H19',
      'H20',
      'H21',
      'H22',
      'H23',
      'H24',
    ];

    const calcAdjust = filCheckAdjustment?.map((e: any) => {
      const timeShow: any = [];

      if (e['adjustment'] === 'YES') {
        console.log('yes : ', e);

        for (let hI = 0; hI < hourTime.length; hI++) {
          const sumAllH = {};
          if (e['adjustment'] === 'YES') {
            const fil = filCheckAdjustment?.filter((f: any) => {
              return (
                f?.adjustment === 'YES' &&
                f?.shipper_name === e?.shipper_name &&
                f?.gasDayUse === e?.gasDayUse &&
                f?.area_text === e?.area_text &&
                f?.contract === e?.contract
              );
            });
            console.log('fil : ', fil);
            for (let hI = 0; hI < hourTime.length; hI++) {
              const sumWithInitial = fil
                ?.map((sH: any) => Number(sH[hourTime[hI]]) || 0)
                .reduce(
                  (accumulator, currentValue) => accumulator + currentValue,
                  0,
                );
              sumAllH[hourTime[hI]] = sumWithInitial;
            }
          }
          const findH = e['dailyAdjustFindPoint']?.filter((f: any) => {
            return f?.hourTime === hourTime[hI];
          });
          if (findH.length > 0) {
            const originalPointRowH = Number(e[hourTime[hI]]) ?? 0;
            const sumAllPointRowH = Number(sumAllH[hourTime[hI]]) ?? 0; //**********
            let calcResult = 0;
            if (findH.length > 1) {
              const sorted = [...findH].sort((a, b) => {
                if (a.minute !== b.minute) {
                  return a.minute - b.minute; // เรียงตาม minute ก่อน
                }

                return dayjs(a.create_date).isBefore(dayjs(b.create_date))
                  ? -1
                  : 1;
              });

              let minuteSum = 0;
              const oldMinute = 0;
              let adjustHFlag = false;
              for (let mS = 0; mS < sorted.length; mS++) {
                const adjustValue = Number(sorted[mS]?.adjustH) ?? 0;
                const calcStep1 =
                  (originalPointRowH / sumAllPointRowH) * adjustValue;

                // const calcStep2 = calcStep1 * (( sorted[mS]?.minute - oldMinute) / 60)
                // oldMinute = sorted[mS]?.minute
                // minuteSum += calcStep2
                minuteSum += calcStep1;
                adjustHFlag = sorted[mS]?.adjustHFlag
              }

              calcResult = adjustHFlag ? minuteSum * 24 : minuteSum;
              // adjustHFlag: !!da?.valume_mmscfh2 t = h * 24 , f = d
            } else {
              // 1 calc ปกติ
              const adjustValue = Number(findH[0]?.adjustH) ?? 0;
              const calcStep1 =
                (originalPointRowH / sumAllPointRowH) * adjustValue;
              // calcResult = calcStep1;
              calcResult = findH[0]?.adjustHFlag ? calcStep1 * 24 : calcStep1;


            }

            // (nrow/nsum)/adjust
            // e[findH[0]?.timeUse] = calcResult
            timeShow.push({ time: findH[0]?.timeUse, value: calcResult }); //https://app.clickup.com/t/86etnehdr
            // timeShow.push({ time: findH[0]?.timeUse, value: calcResult });

            for (let i = 0; i < hourTime.length; i++) {
              if (i === hI) {
                e[hourTime[i]] = calcResult; // เริ่มเปลี่ยนที่ H3
                for (let j = i + 1; j < hourTime.length; j++) {
                  e[hourTime[j]] = calcResult; // เปลี่ยนตำแหน่งถัดไปทั้งหมด
                }
                break; // จบ loop หลัง cascade
              }
            }
          } else {
            e[hourTime[hI]] = e[hourTime[hI]];
          }
        }
      }

      // const totalH1ToH24Adjust =
      //   e['H1'] +
      //   e['H2'] +
      //   e['H3'] +
      //   e['H4'] +
      //   e['H5'] +
      //   e['H6'] +
      //   e['H7'] +
      //   e['H8'] +
      //   e['H9'] +
      //   e['H10'] +
      //   e['H11'] +
      //   e['H12'] +
      //   e['H13'] +
      //   e['H14'] +
      //   e['H15'] +
      //   e['H16'] +
      //   e['H17'] +
      //   e['H18'] +
      //   e['H19'] +
      //   e['H20'] +
      //   e['H21'] +
      //   e['H22'] +
      //   e['H23'] +
      //   e['H24'];

      // timeShow
      const hourT = [
        '00:00',
        '01:00',
        '02:00',
        '03:00',
        '04:00',
        '05:00',
        '06:00',
        '07:00',
        '08:00',
        '09:00',
        '10:00',
        '11:00',
        '12:00',
        '13:00',
        '14:00',
        '15:00',
        '16:00',
        '17:00',
        '18:00',
        '19:00',
        '20:00',
        '21:00',
        '22:00',
        '23:00',
      ];
      for (let i = 0; i < hourT.length; i++) {
        // timeShow
        const findTS = timeShow?.find((f: any) => {
          return f?.time === hourT[i];
        });
        if (!findTS) {
          timeShow.push({
            time: hourT[i],
            value: e[`H${Number(hourT[i]?.split(':')[0]) + 1}`] * 24,
          }); //https://app.clickup.com/t/86etnehdr
          // timeShow.push({
          //   time: hourT[i],
          //   value: e[`H${Number(hourT[i]?.split(':')[0]) + 1}`],
          // });
        }
      }
      const {
        H1,
        H2,
        H3,
        H4,
        H5,
        H6,
        H7,
        H8,
        H9,
        H10,
        H11,
        H12,
        H13,
        H14,
        H15,
        H16,
        H17,
        H18,
        H19,
        H20,
        H21,
        H22,
        H23,
        H24,
        ...nE
      } = e;

      return {
        ...nE,
        timeShow,
        // totalH1ToH24Adjust,
      };
    });

    const cutNo = calcAdjust?.map((e: any) => {
      const check = calcAdjust?.find((f: any) => {
        return (
          f?.adjustment === "YES" &&
          f?.gasDayUse === e["gasDayUse"] &&
          f?.point === e["point"] &&
          f?.shipper_name === e["shipper_name"]
        )
      })

      const uData = check && e["adjustment"] === "NO" ? null : { ...e }

      return uData
    })?.filter((f: any) => { return f !== null })
    console.log('cutNo : ', cutNo);

    // https://app.clickup.com/t/86etnehdr
    const ncutNo = cutNo?.map((e: any) => {
      const { total, ...nE } = e
      return {
        ...nE,
        total: total * 24
      }
    })

    console.log('ncutNo : ', ncutNo);
    const groupedByContract = Object.values(
      ncutNo.reduce((acc, item) => {
        const key = `${item?.point}|${item?.shipper_name}`;
        if (!acc[key]) {
          acc[key] = {
            point: item?.point,
            shipper_name: item?.shipper_name,
            "zone_text": item?.zone_text,
            "area_text": item?.area_text,
            timeShow: [],
          };
        }
        acc[key].timeShow.push(item?.timeShow);
        return acc;
      }, {}),
    );
    console.log('groupedByContract : ', groupedByContract);
    const tgroupedByContract = groupedByContract?.map((e: any) => {
      const { timeShow, ...nE } = e
      const merged = {};
      for (const group of e?.timeShow) {
        for (const item of group) {
          if (!merged[item.time]) {
            merged[item.time] = { ...item }; // clone object
          } else {
            merged[item.time].value += item.value;
          }
        }
      }
      const timeShowx = Object.values(merged);

      return {
        ...nE,
        timeShow: timeShowx
      }
    })

    console.log('tgroupedByContract : ', tgroupedByContract);

    return tgroupedByContract;
  }


  /**
   * สร้างสรุปการปรับแต่งรายวัน (Daily Adjustment Summary)
   * รวบรวมข้อมูล nomination และ adjustment ตามช่วงวันที่ที่กำหนด
   * แสดงข้อมูลทั้งแบบเดิมและแบบที่ปรับแต่งแล้ว
   * 
   * @param payload - ข้อมูลที่ส่งมา { checkAdjustment, startDate, endDate, contractCode }
   * @param userId - ID ของผู้ใช้
   * @returns รายการข้อมูลการ nomination และปรับแต่งแบบสรุป
   */
  async dailyAdjustmentSummary2(payload: any, userId: any) {
    const { checkAdjustment, startDate, endDate, contractCode } = payload || {};

    // แปลงวันที่เริ่มต้นและสิ้นสุดเป็น Dayjs object และ Date object
    const startDayjs = getTodayNowDDMMYYYYAdd7(startDate)
    const endDayjs = getTodayNowDDMMYYYYAdd7(endDate)
    const todayStart = startDayjs.toDate();
    const todayEnd = endDayjs.toDate();

    // ดึงข้อมูลพื้นที่ (Area) ที่ใช้งานอยู่ในช่วงวันที่ที่กำหนด
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
              { end_date: null }, // ถ้า end_date เป็น null (ยังใช้งานอยู่)
              { end_date: { gte: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
            ],
          },
        ],
      },
    });

    // ดึงข้อมูล Entry/Exit ทั้งหมด
    const entryExitMaster = await this.prisma.entry_exit.findMany({
      where: {},
    });

    // คำนวณช่วงสัปดาห์สำหรับการ nomination ประเภทสัปดาห์
    const { weekStart: targetWeekStart } = getWeekRange(todayStart);
    const { weekEnd: targetWeekEnd } = getWeekRange(todayEnd);

    // ดึงข้อมูลการเสนอราคา (nomination) ทั้งรายวันและรายสัปดาห์
    const nominationData =
      await this.prisma.query_shipper_nomination_file.findMany({
        where: {
          AND: [
            {
              OR: [
                // การเสนอราคารายวัน: ตรงกับวันที่ที่กำหนด
                {
                  nomination_type: {
                    id: 1,
                  },
                  gas_day: {
                    gte: todayStart,
                    lte: todayEnd
                  },
                },
                // การเสนอราคารายสัปดาห์: อยู่ในสัปดาห์เดียวกัน
                {
                  nomination_type: {
                    id: 2,
                  },
                  gas_day: {
                    gte: targetWeekStart,
                    lte: targetWeekEnd,
                  },
                },
              ],
            },
            // กรองเฉพาะข้อมูลที่ไม่ได้ถูกลบ
            {
              OR: [{ del_flag: false }, { del_flag: null }],
            },
            // กรองเฉพาะสถานะที่ได้รับการอนุมัติ (id: 2, 5)
            {
              query_shipper_nomination_status: {
                id: {
                  in: [2, 5],
                },
              },
            }
          ]
        },
        include: {
          group: true,
          query_shipper_nomination_status: true,
          contract_code: true,
          nomination_type: true,
          nomination_version: {
            include: {
              nomination_full_json: true,
              nomination_full_json_sheet2: true,
              nomination_row_json: {
                include: {
                  query_shipper_nomination_type: true,
                },
                orderBy: {
                  id: 'asc',
                },
              },
            },
            where: {
              flag_use: true,
            },
          },
        },
        orderBy: {
          id: 'desc',
        },
      });

    // เริ่มต้นตัวแปรสำหรับเก็บผลลัพธ์
    let result = []
    let currentDate = endDayjs;

    // วนลูปผ่านแต่ละวันจากวันที่สิ้นสุดไปยังวันที่เริ่มต้น
    while (currentDate.isSameOrAfter(startDayjs)) {
      // ดึงข้อมูลการปรับแต่งสำหรับวันที่ปัจจุบันจาก ASTOS service
      const adjustList = await this.astosService.daily_adjustment_summary({ gas_day: currentDate.format('YYYY-MM-DD'), start_hour: 1, end_hour: 24, skip: 0, limit: 0 })

      // กรองข้อมูลการเสนอราคารายวันสำหรับวันที่ปัจจุบัน
      const dailyNominationList = nominationData.filter(
        nominationFile =>
          dayjs(nominationFile.gas_day).isSame(currentDate, 'day')
          && nominationFile.nomination_type_id == 1
      )

      // กรองข้อมูลการเสนอราคารายสัปดาห์สำหรับสัปดาห์ปัจจุบัน
      // และไม่ซ้ำกับข้อมูลรายวันที่มีสัญญาเดียวกัน
      const weeklyNominationList = nominationData.filter(nominationFile => {
        return dayjs(nominationFile.gas_day).isSame(currentDate, 'week')
          && nominationFile.nomination_type_id == 2
          && !dailyNominationList.some(daily => daily.contract_code_id == nominationFile.contract_code_id)
      })

      // ประมวลผลข้อมูลการ nomination รายวัน
      dailyNominationList.map(dailyNomination => {
        // กรองข้อมูลการปรับแต่งที่ตรงกับสัญญาและผู้ใช้
        const adjustListOfContract = adjustList?.filter((adjust: any) => {
          return adjust.gas_day === currentDate.format('YYYY-MM-DD')
            && adjust.contract === dailyNomination.contract_code?.contract_code
            && adjust.shipper === dailyNomination.group?.id_name
        }) ?? []

        const dailyNominationVersion = dailyNomination.nomination_version.map(nominationVersion => {
          // ประมวลผลข้อมูลในแต่ละแถวของการ nomination
          nominationVersion.nomination_row_json.map(nominationRowJson => {
            // ประมวลผลข้อมูลในแต่ละแถวของการ nomination
            const nominationRowJsonDataTemp = this.safeParseJSON(nominationRowJson?.['data_temp'])
            if (!nominationRowJsonDataTemp) return;

            // ดึงข้อมูลจาก JSON ตาม index
            const zone = nominationRowJsonDataTemp['0']
            const area = nominationRowJsonDataTemp['2']
            const point = nominationRowJsonDataTemp['3']
            const unit = nominationRowJsonDataTemp['9']
            const entryExit = nominationRowJsonDataTemp['10']
            const hv = parseToNumber(nominationRowJsonDataTemp['12'])
            const total = readNomFromJsonAs3Decimal(nominationRowJsonDataTemp, '38')

            // ตรวจสอบเงื่อนไข: ต้องเป็นหน่วย MMBTU/D และมีโซนและพื้นที่ (เป็น nomination point)
            if (unit !== 'MMBTU/D' || !zone || !area) { return; }

            const entryExitId = entryExit === 'Entry' ? 1 : 2;
            const entryExitObj = entryExitMaster?.find((f: any) => {
              return f?.id === entryExitId;
            });

            const areaObj = (areaMaster && Array.isArray(areaMaster)) ? areaMaster.find((area: any) => {
              if (!area || !area.start_date) return false;
              const startDate = dayjs(area.start_date).tz('Asia/Bangkok');
              const endDate = area.end_date ? dayjs(area.end_date).tz('Asia/Bangkok') : null;
              return area?.name === nominationRowJson.area_text
                && startDate.isValid() && startDate.isSameOrBefore(currentDate)
                && (endDate == null || (endDate.isValid() && endDate.isAfter(currentDate)));
            }) : null;

            // สร้างข้อมูลพื้นฐานสำหรับแต่ละแถว
            const baseAttribute = {
              "rowId": nominationRowJson.id,
              "nomination_code": dailyNomination.nomination_code,
              "HV": hv,
              "contract": dailyNomination.contract_code?.contract_code,
              "gasDayUse": currentDate.format('DD/MM/YYYY'),
              "shipper_name": dailyNomination.group?.name,
              "zone_text": nominationRowJson.zone_text,
              "area_text": nominationRowJson.area_text,
              "unit": unit,
              "point": point,
              "entryExit": entryExit,
              "total": total,
              "totalType": 'daily',
              "contract_code_id": dailyNomination.contract_code?.id,
              "areaObj": areaObj,
              "entryExitObj": entryExitObj,
              "term": dailyNomination.contract_code?.term_type_id === 4 ? 'non-firm' : 'firm',
              "nomination_type_id": dailyNomination.nomination_type_id,
            }

            // สร้าง object สำหรับข้อมูลเดิม (ไม่มีการปรับแต่ง)
            const originalNom: any = {
              "adjustment": "NO",
            }

            // สร้าง object สำหรับข้อมูลที่ปรับแต่งแล้ว
            const adjustedNom: any = {
              "adjustment": "YES",
            }

            const dailyAdjustFindPoint: any[] = [] // เก็บรายละเอียดการปรับแต่ง
            let sumAllHourlyValue: number | undefined = undefined // รวมค่าทั้งหมดแบบเดิม
            let sumAllHourlyAdjustValue: number | undefined = undefined // รวมค่าทั้งหมดแบบปรับแต่ง
            const h1KeyMinus1 = 13 //h1 = 14 (index ใน JSON)

            // วนลูปประมวลผลข้อมูลรายชั่วโมง (H1-H24)
            for (let i = 1; i <= 24; i++) {
              // ดึงค่าปริมาณรายชั่วโมงจาก JSON
              const hourlyValue = readNomFromJsonAs3Decimal(nominationRowJsonDataTemp, `${h1KeyMinus1 + i}`)
              originalNom[`H${i}`] = hourlyValue // เก็บค่าเดิม
              let isSumAdjust = false // ตรวจสอบว่ามีการปรับแต่งหรือไม่

              // ตรวจสอบการปรับแต่งสำหรับชั่วโมงนี้
              adjustListOfContract.map((adjust: any) => {
                const data = (adjust.data?.filter((adjustData: any) => {
                  const adjustValue3Decimal = adjustData.value == null ? null : parseFloat(adjustData.value.toFixed(3))
                  // ตรวจสอบเงื่อนไขการปรับแต่ง: จุด, พื้นที่, โซน, เข้า/ออก, ชั่วโมง, และค่าต่างจากเดิม
                  return adjustData.point === point
                    && adjustData.area == nominationRowJson.area_text
                    && adjustData.zone == nominationRowJson.zone_text
                    && isMatch(adjustData.entry_exit, entryExit)
                    && adjust.gas_hour === i
                    && adjustValue3Decimal != hourlyValue
                }) ?? [])
                  .map((adjustData: any) => {
                    const adjustValue3Decimal = adjustData.value == null ? null : parseFloat(adjustData.value.toFixed(3))
                    isSumAdjust = true
                    if (adjustValue3Decimal != null) {
                      if (sumAllHourlyAdjustValue) {
                        sumAllHourlyAdjustValue += adjustValue3Decimal
                      }
                      else {
                        sumAllHourlyAdjustValue = adjustValue3Decimal
                      }
                      adjustedNom[`H${i}`] = adjustValue3Decimal
                    }
                    return {
                      // "create_date": "2025-09-04T11:06:21.811Z",
                      // "timeUse": "18:30",
                      // "gas_day": "04/09/2025",
                      // "heating_value": "1047.52",
                      // "hour": 18,
                      // "minute": 30,
                      "hourTime": `H${adjust.gas_hour}`,
                      // "adjustH": 26188,
                      // "djustHFlag": true
                      "valueAfterAdjust": adjustValue3Decimal,
                    }
                  })
                dailyAdjustFindPoint.push(...data)
                return data
              })

              if (!isSumAdjust) {
                adjustedNom[`H${i}`] = hourlyValue
              }


              if (hourlyValue != null) {
                if (sumAllHourlyValue) {
                  sumAllHourlyValue += hourlyValue
                }
                else {
                  sumAllHourlyValue = hourlyValue
                }

                if (!isSumAdjust) {
                  if (sumAllHourlyAdjustValue) {
                    sumAllHourlyAdjustValue += hourlyValue
                  }
                  else {
                    sumAllHourlyAdjustValue = hourlyValue
                  }
                }
              }
            }


            result.push({
              "dailyAdjustFindPoint": [],
              ...baseAttribute,
              ...originalNom,
              "totalH1ToH24Adjust": sumAllHourlyValue,
            })

            if (dailyAdjustFindPoint.length > 0) {
              result.push({
                "dailyAdjustFindPoint": dailyAdjustFindPoint,
                ...baseAttribute,
                ...adjustedNom,
                "totalH1ToH24Adjust": sumAllHourlyAdjustValue
              })
            }
          })
        })
      })

      weeklyNominationList.map(weeklyNomination => {
        const adjustListOfContract = adjustList?.filter((adjust: any) => {
          return adjust.gas_day === currentDate.format('YYYY-MM-DD')
            && adjust.contract === weeklyNomination.contract_code?.contract_code
            && adjust.shipper === weeklyNomination.group?.id_name
        }) ?? []

        const weeklyNominationVersion = weeklyNomination.nomination_version.map(nominationVersion => {
          nominationVersion.nomination_row_json.map(nominationRowJson => {
            const nominationRowJsonDataTemp = this.safeParseJSON(nominationRowJson?.['data_temp'])
            if (!nominationRowJsonDataTemp) return;

            const zone = nominationRowJsonDataTemp['0']
            const area = nominationRowJsonDataTemp['2']
            const point = nominationRowJsonDataTemp['3']
            const unit = nominationRowJsonDataTemp['9']
            const entryExit = nominationRowJsonDataTemp['10']
            const hv = parseToNumber(nominationRowJsonDataTemp['12'])

            if (unit !== 'MMBTU/D' || !zone || !area) { return; }

            const entryExitId = entryExit === 'Entry' ? 1 : 2;
            const entryExitObj = entryExitMaster?.find((f: any) => {
              return f?.id === entryExitId;
            });

            const areaObj = (areaMaster && Array.isArray(areaMaster)) ? areaMaster.find((area: any) => {
              if (!area || !area.start_date) return false;
              const startDate = dayjs(area.start_date).tz('Asia/Bangkok');
              const endDate = area.end_date ? dayjs(area.end_date).tz('Asia/Bangkok') : null;
              return area?.name === nominationRowJson.area_text
                && startDate.isValid() && startDate.isSameOrBefore(currentDate)
                && (endDate == null || (endDate.isValid() && endDate.isAfter(currentDate)));
            }) : null;

            const dayOfWeek = Number(currentDate.format('d')) // The day of the week, with Sunday as 0
            const thisDayValue3Decimal = readNomFromJsonAs3Decimal(nominationRowJsonDataTemp, `${14 + dayOfWeek}`)
            const hourlyValue = thisDayValue3Decimal == null ? null : parseFloat((thisDayValue3Decimal / 24).toFixed(3))

            const baseAttribute = {
              "rowId": nominationRowJson.id,
              "nomination_code": weeklyNomination.nomination_code,
              "HV": hv,
              "contract": weeklyNomination.contract_code?.contract_code,
              "gasDayUse": currentDate.format('DD/MM/YYYY'),
              "shipper_name": weeklyNomination.group?.name,
              "zone_text": nominationRowJson.zone_text,
              "area_text": nominationRowJson.area_text,
              "unit": unit,
              "point": point,
              "entryExit": entryExit,
              "total": thisDayValue3Decimal,
              "totalType": currentDate.format('dddd'),
              "contract_code_id": weeklyNomination.contract_code?.id,
              "areaObj": areaObj,
              "entryExitObj": entryExitObj,
              "term": weeklyNomination.contract_code?.term_type_id === 4 ? 'non-firm' : 'firm',
              "nomination_type_id": weeklyNomination.nomination_type_id,
            }

            const originalNom: any = {
              "adjustment": "NO",
              "H1": hourlyValue,
              "H2": hourlyValue,
              "H3": hourlyValue,
              "H4": hourlyValue,
              "H5": hourlyValue,
              "H6": hourlyValue,
              "H7": hourlyValue,
              "H8": hourlyValue,
              "H9": hourlyValue,
              "H10": hourlyValue,
              "H11": hourlyValue,
              "H12": hourlyValue,
              "H13": hourlyValue,
              "H14": hourlyValue,
              "H15": hourlyValue,
              "H16": hourlyValue,
              "H17": hourlyValue,
              "H18": hourlyValue,
              "H19": hourlyValue,
              "H20": hourlyValue,
              "H21": hourlyValue,
              "H22": hourlyValue,
              "H23": hourlyValue,
              "H24": hourlyValue,
              "totalH1ToH24Adjust": thisDayValue3Decimal
            }

            const adjustedNom: any = {
              "adjustment": "YES",
            }

            // "dailyAdjustFindPoint": [
            //     {
            //         "create_date": "2025-09-04T11:06:21.811Z",
            //         "timeUse": "18:30",
            //         "gas_day": "04/09/2025",
            //         "heating_value": "1047.52",
            //         "hour": 18,
            //         "minute": 30,
            //         "hourTime": "H19",
            //         "adjustH": 26188,
            //         "djustHFlag": true
            //     }
            // ],
            let sumAllHourlyAdjustValue: number | undefined = undefined
            const dailyAdjustFindPoint: any[] = []
            adjustListOfContract.map((adjust: any) => {
              const gasHour = `H${adjust.gas_hour}`
              const data = (adjust.data?.filter((adjustData: any) => {
                const adjustValue3Decimal = adjustData.value == null ? null : parseFloat(adjustData.value.toFixed(3))
                return adjustData.point === point
                  && adjustData.area == nominationRowJson.area_text
                  && adjustData.zone == nominationRowJson.zone_text
                  && isMatch(adjustData.entry_exit, entryExit)
                  && adjustValue3Decimal != hourlyValue
              }) ?? [])
                .map((adjustData: any) => {
                  const adjustValue3Decimal = adjustData.value == null ? null : parseFloat(adjustData.value.toFixed(3))
                  if (adjustValue3Decimal != null) {
                    if (sumAllHourlyAdjustValue) {
                      sumAllHourlyAdjustValue += adjustValue3Decimal
                    }
                    else {
                      sumAllHourlyAdjustValue = adjustValue3Decimal
                    }
                    adjustedNom[gasHour] = adjustValue3Decimal
                  }
                  return {
                    // "create_date": "2025-09-04T11:06:21.811Z",
                    // "timeUse": "18:30",
                    // "gas_day": "04/09/2025",
                    // "heating_value": "1047.52",
                    // "hour": 18,
                    // "minute": 30,
                    "hourTime": gasHour,
                    // "adjustH": 26188,
                    // "djustHFlag": true
                    "valueAfterAdjust": adjustValue3Decimal,
                  }
                })

              if (!adjustedNom[gasHour]) {
                adjustedNom[gasHour] = hourlyValue
              }
              dailyAdjustFindPoint.push(...data)
              return data
            })


            result.push({
              "dailyAdjustFindPoint": [],
              ...baseAttribute,
              ...originalNom,
            })

            if (dailyAdjustFindPoint.length > 0) {
              result.push({
                "dailyAdjustFindPoint": dailyAdjustFindPoint,
                ...baseAttribute,
                ...adjustedNom,
                "totalH1ToH24Adjust": sumAllHourlyAdjustValue
              })
            }
          })
        })
      })


      // ลดวันที่ลง 1 วันเพื่อประมวลผลวันถัดไป
      currentDate = currentDate.subtract(1, 'day');
    }

    // กรองผลลัพธ์ตามเงื่อนไขที่กำหนด
    if (checkAdjustment == true) {
      // กรองเฉพาะข้อมูลที่มีการปรับแต่ง
      result = result.filter((f: any) => {
        return f?.adjustment === 'YES';
      });
    }

    if (contractCode) {
      if (Array.isArray(contractCode) && contractCode.length > 0) {
        // กรองตามรหัสสัญญาหลายตัว (array)
        result = result.filter((f: any) => {
          return contractCode.includes(f?.contract);
        });
      }
      else {
        // กรองตามรหัสสัญญาเดียว
        result = result.filter((f: any) => {
          return f?.contract === contractCode;
        });
      }
    }

    // Sort groupByNomPoint by gas_day, point, and shipper_name
    result.sort((a: any, b: any) => {
      // First sort by gas_day
      const dateA = dayjs(a.gasDayUse, 'DD/MM/YYYY');
      const dateB = dayjs(b.gasDayUse, 'DD/MM/YYYY');
      if (!dateA.isSame(dateB)) {
        return dateA.isBefore(dateB) ? 1 : -1;
      }

      // Then sort by point
      if (a.point !== b.point) {
        return a.point.localeCompare(b.point);
      }

      // Finally sort by shipper_name
      return a.shipper_name.localeCompare(b.shipper_name);
    });

    return result
  }

  /**
   * สร้างรายงาน Daily Adjustment Report แบบละเอียด
   * @param payload - ข้อมูล payload ที่มี startDate และ endDate
   * @param userId - ID ของผู้ใช้
   * @returns รายงานที่จัดกลุ่มตาม nomination point พร้อมข้อมูลรายชั่วโมง
   */
  async dailyAdjustmentReport2(payload: any, userId: any) {
    const { startDate, endDate } = payload || {};

    // แปลงวันที่เริ่มต้นและสิ้นสุดเป็น dayjs object
    const startDayjs = getTodayNowDDMMYYYYAdd7(startDate);
    const endDayjs = getTodayNowDDMMYYYYAdd7(endDate);
    const todayStart = startDayjs.toDate();
    const todayEnd = endDayjs.toDate();

    // หาช่วงสัปดาห์ที่ครอบคลุมวันที่เริ่มต้นและสิ้นสุด (สำหรับดึงข้อมูล weekly nomination)
    const { weekStart: targetWeekStart } = getWeekRange(todayStart);
    const { weekEnd: targetWeekEnd } = getWeekRange(todayEnd);

    // ดึงข้อมูล nomination files ทั้งแบบรายวัน (type 1) และรายสัปดาห์ (type 2)
    const nominationData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        AND: [
          {
            OR: [
              {
                // nomination รายวัน (type 1) ที่อยู่ในช่วงวันที่ที่เลือก
                nomination_type: { id: 1 },
                gas_day: { gte: todayStart, lte: todayEnd },
              },
              {
                // nomination รายสัปดาห์ (type 2) ที่อยู่ในช่วงสัปดาห์ที่ครอบคลุมวันที่เลือก
                nomination_type: { id: 2 },
                gas_day: { gte: targetWeekStart, lte: targetWeekEnd },
              },
            ],
          },
          // เฉพาะรายการที่ไม่ถูกลบ
          { OR: [{ del_flag: false }, { del_flag: null }] },
          // เฉพาะ status 2 (Approved) และ 5 (Approved by System)
          { query_shipper_nomination_status: { id: { in: [2, 5] } } },
        ],
      },
      include: {
        group: true,
        query_shipper_nomination_status: true,
        contract_code: true,
        nomination_type: true,
        nomination_version: {
          include: {
            nomination_full_json: true,
            nomination_full_json_sheet2: true,
            nomination_row_json: {
              include: { query_shipper_nomination_type: true },
              orderBy: { id: 'asc' },
            },
          },
          where: { flag_use: true },
        },
      },
      orderBy: { id: 'desc' },
    });

    // ดึงข้อมูล daily adjustment ที่ถูก approve (status 2) ในช่วงวันที่ที่เลือก
    const dailyAdjust = await this.prisma.daily_adjustment.findMany({
      where: {
        daily_adjustment_status_id: 2, // เฉพาะที่ approved
        gas_day: {
          gte: getTodayStartDDMMYYYYAdd7(startDate).toDate(),
          lte: getTodayEndDDMMYYYYAdd7(endDate).toDate(),
        },
      },
      orderBy: { create_date: 'asc' }, // เรียงตามวันที่สร้างเพื่อประมวลผล adjustment ตามลำดับเวลา
      select: {
        id: true, create_date: true, gas_day: true, time: true, daily_code: true,
        daily_adjustment_group: { select: { group: { select: { id: true, id_name: true, name: true } } } },
        daily_adjustment_nom: {
          select: {
            heating_value: true, // heating value (BTU/SCF)
            valume_mmscfd: true, // ปริมาณต่อวัน (MMSCFD)
            valume_mmscfh: true, // ปริมาณต่อชั่วโมง (MMSCFH)
            valume_mmscfd2: true, // energy ต่อวัน (MMBTU/D)
            valume_mmscfh2: true, // energy ต่อชั่วโมง (MMBTU/H)
            nomination_point: { select: { nomination_point: true, zone: true, area: true, entry_exit: true } },
          },
        },
      },
      // orderBy: [
      //   {
      //     gas_day: 'asc',
      //   },
      //   {
      //     time: 'asc',
      //   },
      // ],
    });

    const meteringPointList = await this.prisma.metering_point.findMany({
      where: {
        start_date: {
          lte: todayEnd,
        },
        OR: [
          { end_date: null },
          { end_date: { gte: todayStart } },
        ],
      },
      select: {
        id: true,
        metered_id: true,
        metered_point_name: true,
        nomination_point: true,
      }
    });

    // สร้าง array สำหรับเก็บผลลัพธ์
    const result: any[] = [];
    const meterDataList: any[] = [];
    let currentDate = endDayjs;

    // วนลูปย้อนหลังจากวันสุดท้ายไปวันแรก
    while (currentDate.isSameOrAfter(startDayjs)) {
      const meteredMicroData = await this.meteredMicroService.sendMessage(
        JSON.stringify({
          case: 'getLastHour',
          mode: 'metering',
          gas_day: currentDate.format('YYYY-MM-DD'),
        }),
      );
      const meterData = (!!meteredMicroData?.reply && this.safeParseJSON(meteredMicroData?.reply)) || null;
      if (meterData && Array.isArray(meterData)) {
        meterDataList.push(...meterData);
      }

      // กรอง nomination แบบรายวันสำหรับวันที่กำลังประมวลผล
      const dailyNominationList = nominationData.filter(
        nominationFile =>
          dayjs(nominationFile.gas_day).isSame(currentDate, 'day') &&
          nominationFile.nomination_type_id == 1
      );

      // กรอง nomination แบบรายสัปดาห์สำหรับสัปดาห์ที่กำลังประมวลผล
      // ข้ามถ้ามี daily nomination สำหรับ contract เดียวกันแล้ว (daily nomination มีลำดับความสำคัญสูงกว่า)
      const weeklyNominationList = nominationData.filter(
        nominationFile =>
          dayjs(nominationFile.gas_day).isSame(currentDate, 'week') &&
          nominationFile.nomination_type_id == 2 &&
          !dailyNominationList.some(daily => daily.contract_code_id == nominationFile.contract_code_id)
      );

      // ประมวลผล daily nomination
      dailyNominationList.map(dailyNomination => {
        const dailyNominationVersion = dailyNomination.nomination_version.map(nominationVersion => {
          nominationVersion.nomination_row_json.map(nominationRowJson => {
            // แปลง JSON string เป็น object
            const nominationRowJsonDataTemp = this.safeParseJSON(nominationRowJson?.['data_temp'])
            if (!nominationRowJsonDataTemp) return;

            // อ่านข้อมูลจาก JSON ตามตำแหน่งที่กำหนด
            const zone = nominationRowJsonDataTemp['0']
            const area = nominationRowJsonDataTemp['2']
            const point = nominationRowJsonDataTemp['3']
            const unit = nominationRowJsonDataTemp['9']
            const entryExit = nominationRowJsonDataTemp['10']
            const total = readNomFromJsonAs3Decimal(nominationRowJsonDataTemp, '38')

            // ข้ามถ้าไม่มีข้อมูล zone, area (ต้องเป็น nomination point)
            if (!zone || !area) { return; }

            // หาว่ามี point นี้ใน result แล้วหรือยัง (เช็คตาม point, zone, area, entryExit, gas_day, group, contract, nomination)
            let existPointIndex = result.findIndex((f: any) => {
              return f?.point === point
                && f?.zone_text === nominationRowJson.zone_text
                && f?.area_text === nominationRowJson.area_text
                && f?.entryExit === entryExit
                && f?.gas_day === currentDate.format('DD/MM/YYYY')
                && f?.group_id === dailyNomination.group_id
                && f?.contract_code_id === dailyNomination.contract_code_id
                && f?.nomination_id === dailyNomination.id
            })

            let timeShow = []

            // ถ้ายังไม่มี point นี้ใน result ให้สร้างใหม่
            if (existPointIndex < 0) {
              existPointIndex = result.length
              result.push({
                "gas_day": currentDate.format('DD/MM/YYYY'),
                "group_id": dailyNomination.group_id,
                "shipper_name": dailyNomination.group?.name,
                "shipper_id_name": dailyNomination.group?.id_name,
                "contract": dailyNomination.contract_code?.contract_code,
                "contract_code_id": dailyNomination.contract_code_id,
                "nomination_id": dailyNomination.id,
                "nomination_code": dailyNomination.nomination_code,
                "zone_text": nominationRowJson.zone_text,
                "area_text": nominationRowJson.area_text,
                // "unit": unit,
                "point": point,
                "entryExit": entryExit,
                "total": total,
                "totalType": 'daily',
                "nomination_type_id": dailyNomination.nomination_type_id,
                "timeShow": [],
              })
            }
            else {
              // ถ้ามี point นี้แล้ว ให้ใช้ timeShow ที่มีอยู่
              timeShow = result[existPointIndex].timeShow
            }

            // ดึงข้อมูลรายชั่วโมง (24 ชั่วโมง) จาก JSON
            // ข้อมูลชั่วโมงเริ่มที่ตำแหน่ง 14 (H1 = 00:00, H2 = 01:00, ..., H24 = 23:00)
            const h1Key = 14
            for (let i = 0; i <= 23; i++) {
              const hourlyValue = readNomFromJsonAs3Decimal(nominationRowJsonDataTemp, `${h1Key + i}`)
              const key = `${i.toString().padStart(2, '0')}:00`

              // หาว่ามีเวลานี้ใน timeShow แล้วหรือยัง
              const timeShowIndex = timeShow.findIndex((f: any) => { return f.time === key })
              if (timeShowIndex < 0) {
                const heatingValueFromMeterList: { metering_point_id: any, gas_day: any, gas_hour: any, heatingValue: number, volume: number }[] = []
                const volumeFromMeterList: { metering_point_id: any, gas_day: any, gas_hour: any, heatingValue: number, volume: number }[] = []
                let valueMmscfd = null
                if (isMatch(unit, 'MMBTU/D') && isMatch(entryExit, 'Exit')) {
                  const meterUnderNom = meteringPointList.filter((meterPoint: any) => meterPoint.nomination_point?.nomination_point == point)

                  if (meterUnderNom.length > 0) {
                    let sumHeatingValueMutipleByVolume: number | undefined
                    let sumVolume: number | undefined
                    const targetMeterDataList = meterDataList.filter((meterData: any) => {
                      return meterUnderNom.some((meterPoint: any) => meterPoint.metered_point_name == meterData.meteringPointId) &&
                        meterData.gasDay == currentDate.format('YYYY-MM-DD')
                    })

                    let gasHourMeterDataList = targetMeterDataList.filter((meterData: any) => meterData.gasHour == i)
                    if (gasHourMeterDataList.length == 0) {
                      const beforeGasHourMeterDataList = targetMeterDataList.filter((meterData: any) => meterData.gasHour <= i)
                      if (beforeGasHourMeterDataList.length > 0) {
                        const lastestGasHour = beforeGasHourMeterDataList.sort((a: any, b: any) => b.gasHour - a.gasHour)[0].gasHour
                        gasHourMeterDataList = targetMeterDataList.filter((meterData: any) => meterData.gasHour == lastestGasHour)
                      }
                    }

                    gasHourMeterDataList.map((meterData: any) => {
                      const heatingValueFromMeter = parseToNumber3Decimal(meterData.heatingValue) ?? parseToNumber3Decimal(meterData.data_temp?.heatingValue)
                      const volumeFromMeter = parseToNumber3Decimal(meterData.volume) ?? parseToNumber3Decimal(meterData.data_temp?.volume)
                      if (volumeFromMeter != null) {
                        volumeFromMeterList.push({
                          metering_point_id: meterData.meteringPointId,
                          gas_day: meterData.gasDay,
                          gas_hour: meterData.gasHour,
                          heatingValue: heatingValueFromMeter,
                          volume: volumeFromMeter
                        })
                        if (heatingValueFromMeter != null) {
                          heatingValueFromMeterList.push({
                            metering_point_id: meterData.meteringPointId,
                            gas_day: meterData.gasDay,
                            gas_hour: meterData.gasHour,
                            heatingValue: heatingValueFromMeter,
                            volume: volumeFromMeter
                          })
                          if (sumHeatingValueMutipleByVolume) {
                            sumHeatingValueMutipleByVolume += heatingValueFromMeter * volumeFromMeter
                          }
                          else {
                            sumHeatingValueMutipleByVolume = heatingValueFromMeter * volumeFromMeter
                          }
                        }

                        if (sumVolume) {
                          sumVolume += volumeFromMeter
                        }
                        else {
                          sumVolume = volumeFromMeter
                        }
                      }
                    })

                    if (sumHeatingValueMutipleByVolume && sumVolume) {
                      const calculatedHeatingValueFromMeter = sumHeatingValueMutipleByVolume / sumVolume
                      valueMmscfd = hourlyValue / calculatedHeatingValueFromMeter
                    }
                  }
                }

                // ถ้ายังไม่มี ให้สร้างใหม่
                if (isMatch(unit, 'MMBTU/D')) {
                  timeShow.push({
                    time: key,
                    value: hourlyValue,
                    valueMmscfd: valueMmscfd,
                    heatingValueFromMeter: heatingValueFromMeterList,
                    heatingValueFromAdjust: null,
                    volumeFromMeter: volumeFromMeterList,
                    volumeFromAdjust: null
                  })
                }
                else if (isMatch(unit, 'MMSCFD')) {
                  timeShow.push({
                    time: key,
                    value: null,
                    valueMmscfd: hourlyValue,
                    heatingValueFromMeter: heatingValueFromMeterList,
                    heatingValueFromAdjust: null,
                    volumeFromMeter: volumeFromMeterList,
                    volumeFromAdjust: null
                  })
                }
              }
              else {
                // ถ้ามีแล้ว ให้บวกค่าเข้าไป (กรณีมีหลาย row สำหรับ point เดียวกัน)
                if (isMatch(unit, 'MMBTU/D') || isMatch(unit, 'MMSCFD')) {
                  let timeShowValue = isMatch(unit, 'MMBTU/D') ? timeShow[timeShowIndex].value : timeShow[timeShowIndex].valueMmscfd
                  if (timeShowValue != null) {
                    if (hourlyValue != null) {
                      timeShowValue += hourlyValue
                    }
                  }
                  else {
                    timeShowValue = hourlyValue
                  }
                  if (isMatch(unit, 'MMBTU/D')) {
                    timeShow[timeShowIndex].value = timeShowValue
                  }
                  else {
                    timeShow[timeShowIndex].valueMmscfd = timeShowValue
                  }
                }
              }
            }
            result[existPointIndex].timeShow = timeShow
          })
        })
      })

      // ประมวลผล weekly nomination (สำหรับวันที่ไม่มี daily nomination)
      weeklyNominationList.map(weeklyNomination => {
        const weeklyNominationVersion = weeklyNomination.nomination_version.map(nominationVersion => {
          nominationVersion.nomination_row_json.map(nominationRowJson => {
            // แปลง JSON string เป็น object
            const nominationRowJsonDataTemp = this.safeParseJSON(nominationRowJson.data_temp)

            // อ่านข้อมูลจาก JSON
            const zone = nominationRowJsonDataTemp['0']
            const area = nominationRowJsonDataTemp['2']
            const point = nominationRowJsonDataTemp['3']
            const unit = nominationRowJsonDataTemp['9']
            const entryExit = nominationRowJsonDataTemp['10']
            // สำหรับ weekly nomination: คำนวณค่ารายชั่วโมงจากค่ารายวัน
            // ดึงค่าตามวันในสัปดาห์ (Sunday = 0, Monday = 1, ..., Saturday = 6)
            const dayOfWeek = Number(currentDate.format('d')) // วันในสัปดาห์ (0 = Sunday, 6 = Saturday)
            const thisDayValue3Decimal = readNomFromJsonAs3Decimal(nominationRowJsonDataTemp, `${14 + dayOfWeek}`)
            // แบ่งค่ารายวันด้วย 24 เพื่อได้ค่ารายชั่วโมง
            const hourlyValue = thisDayValue3Decimal == null ? null : parseFloat((thisDayValue3Decimal / 24).toFixed(3))

            // ข้ามถ้าไม่มีข้อมูล zone, area (ต้องเป็น nomination point)
            if (!zone || !area) { return; }

            let existPointIndex = result.findIndex((f: any) => {
              return f?.point === point
                && f?.zone_text === nominationRowJson.zone_text
                && f?.area_text === nominationRowJson.area_text
                && f?.entryExit === entryExit
                && f?.gas_day === currentDate.format('DD/MM/YYYY')
                && f?.group_id === weeklyNomination.group_id
                && f?.contract_code_id === weeklyNomination.contract_code_id
                && f?.nomination_id === weeklyNomination.id
            })

            let timeShow = []

            if (existPointIndex < 0) {
              existPointIndex = result.length
              result.push({
                "gas_day": currentDate.format('DD/MM/YYYY'),
                "group_id": weeklyNomination.group_id,
                "shipper_name": weeklyNomination.group?.name,
                "shipper_id_name": weeklyNomination.group?.id_name,
                "contract": weeklyNomination.contract_code?.contract_code,
                "contract_code_id": weeklyNomination.contract_code_id,
                "nomination_id": weeklyNomination.id,
                "nomination_code": weeklyNomination.nomination_code,
                "zone_text": nominationRowJson.zone_text,
                "area_text": nominationRowJson.area_text,
                // "unit": unit,
                "point": point,
                "entryExit": entryExit,
                "total": thisDayValue3Decimal,
                "totalType": currentDate.format('dddd'),
                "nomination_type_id": weeklyNomination.nomination_type_id,
                "timeShow": [],
              })
            }
            else {
              // ถ้ามี point นี้แล้ว ให้ใช้ timeShow ที่มีอยู่
              timeShow = result[existPointIndex].timeShow
            }

            // สร้างค่ารายชั่วโมงเท่ากันทุกชั่วโมง (24 ชั่วโมง)
            for (let i = 0; i <= 23; i++) {
              const key = `${i.toString().padStart(2, '0')}:00`

              const timeShowIndex = timeShow.findIndex((f: any) => { return f.time === key })
              if (timeShowIndex < 0) {
                const heatingValueFromMeterList: { metering_point_id: any, gas_day: any, gas_hour: any, heatingValue: number, volume: number }[] = []
                const volumeFromMeterList: { metering_point_id: any, gas_day: any, gas_hour: any, heatingValue: number, volume: number }[] = []
                let valueMmscfd = null
                if (isMatch(unit, 'MMBTU/D') && isMatch(entryExit, 'Exit')) {
                  const meterUnderNom = meteringPointList.filter((meterPoint: any) => meterPoint.nomination_point?.nomination_point == point)

                  if (meterUnderNom.length > 0) {
                    let sumHeatingValueMutipleByVolume: number | undefined
                    let sumVolume: number | undefined
                    const targetMeterDataList = meterDataList.filter((meterData: any) => {
                      return meterUnderNom.some((meterPoint: any) => meterPoint.metered_point_name == meterData.meteringPointId) &&
                        meterData.gasDay == currentDate.format('YYYY-MM-DD')
                    })

                    let gasHourMeterDataList = targetMeterDataList.filter((meterData: any) => meterData.gasHour == i)
                    if (gasHourMeterDataList.length == 0) {
                      const beforeGasHourMeterDataList = targetMeterDataList.filter((meterData: any) => meterData.gasHour <= i)
                      if (beforeGasHourMeterDataList.length > 0) {
                        const lastestGasHour = beforeGasHourMeterDataList.sort((a: any, b: any) => b.gasHour - a.gasHour)[0].gasHour
                        gasHourMeterDataList = targetMeterDataList.filter((meterData: any) => meterData.gasHour == lastestGasHour)
                      }
                    }

                    gasHourMeterDataList.map((meterData: any) => {
                      const heatingValueFromMeter = parseToNumber3Decimal(meterData.heatingValue) ?? parseToNumber3Decimal(meterData.data_temp?.heatingValue)
                      const volumeFromMeter = parseToNumber3Decimal(meterData.volume) ?? parseToNumber3Decimal(meterData.data_temp?.volume)
                      if (volumeFromMeter != null) {
                        volumeFromMeterList.push({
                          metering_point_id: meterData.meteringPointId,
                          gas_day: meterData.gasDay,
                          gas_hour: meterData.gasHour,
                          heatingValue: heatingValueFromMeter,
                          volume: volumeFromMeter
                        })
                        if (heatingValueFromMeter != null) {
                          heatingValueFromMeterList.push({
                            metering_point_id: meterData.meteringPointId,
                            gas_day: meterData.gasDay,
                            gas_hour: meterData.gasHour,
                            heatingValue: heatingValueFromMeter,
                            volume: volumeFromMeter
                          })
                          if (sumHeatingValueMutipleByVolume) {
                            sumHeatingValueMutipleByVolume += heatingValueFromMeter * volumeFromMeter
                          }
                          else {
                            sumHeatingValueMutipleByVolume = heatingValueFromMeter * volumeFromMeter
                          }
                        }

                        if (sumVolume) {
                          sumVolume += volumeFromMeter
                        }
                        else {
                          sumVolume = volumeFromMeter
                        }
                      }
                    })

                    if (sumHeatingValueMutipleByVolume && sumVolume) {
                      const calculatedHeatingValueFromMeter = sumHeatingValueMutipleByVolume / sumVolume
                      valueMmscfd = hourlyValue / calculatedHeatingValueFromMeter
                    }
                  }
                }

                // ถ้ายังไม่มี ให้สร้างใหม่
                if (isMatch(unit, 'MMBTU/D')) {
                  timeShow.push({
                    time: key,
                    value: hourlyValue,
                    valueMmscfd: valueMmscfd,
                    heatingValueFromMeter: heatingValueFromMeterList,
                    heatingValueFromAdjust: null,
                    volumeFromMeter: volumeFromMeterList,
                    volumeFromAdjust: null
                  })
                }
                else if (isMatch(unit, 'MMSCFD')) {
                  timeShow.push({
                    time: key,
                    value: null,
                    valueMmscfd: hourlyValue,
                    heatingValueFromMeter: heatingValueFromMeterList,
                    heatingValueFromAdjust: null,
                    volumeFromMeter: volumeFromMeterList,
                    volumeFromAdjust: null
                  })
                }
              }
              else {
                // ถ้ามีแล้ว ให้บวกค่าเข้าไป (กรณีมีหลาย row สำหรับ point เดียวกัน)
                if (isMatch(unit, 'MMBTU/D') || isMatch(unit, 'MMSCFD')) {
                  let timeShowValue = isMatch(unit, 'MMBTU/D') ? timeShow[timeShowIndex].value : timeShow[timeShowIndex].valueMmscfd
                  if (timeShowValue != null) {
                    if (hourlyValue != null) {
                      timeShowValue += hourlyValue
                    }
                  }
                  else {
                    timeShowValue = hourlyValue
                  }
                  if (isMatch(unit, 'MMBTU/D')) {
                    timeShow[timeShowIndex].value = timeShowValue
                  }
                  else {
                    timeShow[timeShowIndex].valueMmscfd = timeShowValue
                  }
                }
              }
            }
            result[existPointIndex].timeShow = timeShow
          })
        })
      })


      // ไปวันก่อนหน้า
      currentDate = currentDate.subtract(1, 'day');
    }

    // เก็บประวัติการ adjust เพื่อจัดการกับการ adjust ซ้อนทับกัน
    const adjustHistory: {
      nomination_point: string
      zone_text: string
      area_text: string
      entry_exit_name: string
      gas_day: string
      group_id: number
      timeMinutes: number
      time: string
    }[] = []

    // ประมวลผล daily adjustment ทีละรายการ (เรียงตามเวลาที่สร้าง)
    for (const adjust of dailyAdjust) {
      const adjustTime = adjust.time; // เวลาที่ทำการ adjust (เช่น "14:30")
      // แปลง adjustment time เป็นนาที (เพื่อใช้ในการเปรียบเทียบ)
      const adjustTimeMinutes = timeToMinutes(adjustTime);

      // วนลูปแต่ละ nomination point ที่ต้องการ adjust
      for (const dailyAdjustmentNom of adjust.daily_adjustment_nom) {
        // ดึงค่า adjust value (ใช้ค่ารายชั่วโมงถ้ามี ถ้าไม่มีให้แบ่งค่ารายวันด้วย 24)
        const adjustValue = parseToNumber3Decimal(dailyAdjustmentNom.valume_mmscfh2) ?? (parseToNumber3Decimal(dailyAdjustmentNom.valume_mmscfd2) / 24)
        const volume = parseToNumber3Decimal(dailyAdjustmentNom.valume_mmscfh) ?? (parseToNumber3Decimal(dailyAdjustmentNom.valume_mmscfd) / 24)
        const heatingValue = parseToNumber3Decimal(dailyAdjustmentNom.heating_value)
        const heatingValueFromMeterList: { metering_point_id: any, gas_day: any, gas_hour: any, heatingValue: number, volume: number }[] = []
        const volumeFromMeterList: { metering_point_id: any, gas_day: any, gas_hour: any, heatingValue: number, volume: number }[] = []
        let calculatedHeatingValueFromMeter: number | null = null

        // เก็บค่าก่อน adjust ของแต่ละ result item ที่ตรงกับเงื่อนไข (key = index ใน result, value = ค่าก่อน adjust)
        const valueBeforeAdjustInThisRound = new Map<number, number>();

        // หา result items ที่ต้องการ adjust (ต้องตรงกับ point, zone, area, entry/exit, gas_day และอยู่ใน group ที่กำหนด)
        for (let index = 0; index < result.length; index++) {
          const target = result[index]
          if (
            target?.point == dailyAdjustmentNom.nomination_point.nomination_point
            && target?.zone_text == dailyAdjustmentNom.nomination_point.zone.name
            && target?.area_text == dailyAdjustmentNom.nomination_point.area.name
            && isMatch(target?.entryExit, dailyAdjustmentNom.nomination_point.entry_exit.name)
            && target?.gas_day === dayjs(adjust.gas_day).tz('Asia/Bangkok').format('DD/MM/YYYY')
            && (adjust.daily_adjustment_group && Array.isArray(adjust.daily_adjustment_group)) && adjust.daily_adjustment_group.map(item => item?.group?.id).includes(result[index]?.group_id)
          ) {
            if (target.timeShow && target.timeShow.length > 0) {
              // หาค่าล่าสุดก่อนเวลา adjustment (เพื่อใช้ในการคำนวณสัดส่วนการกระจายค่า adjust)

              // กรอง timeShow ที่มีเวลาก่อน adjustment time
              const timeShowBeforeAdjust = target.timeShow.filter((timeItem: any) => {
                const timeItemMinutes = timeToMinutes(timeItem.time);
                return timeItemMinutes < adjustTimeMinutes;
              });

              // หา timeShow item ล่าสุด (เรียงตามเวลา)
              if (timeShowBeforeAdjust.length > 0) {
                const latestTimeShow = timeShowBeforeAdjust.reduce((latest: any, current: any) => {
                  const latestMinutes = timeToMinutes(latest.time);
                  const currentMinutes = timeToMinutes(current.time);
                  return currentMinutes > latestMinutes ? current : latest;
                });

                // เก็บค่าก่อน adjust ของ result item นี้
                valueBeforeAdjustInThisRound.set(index, latestTimeShow.value)
              }
            }
          }
          else {
            continue;
          }
        }

        // รวมค่าก่อน adjust ทั้งหมด (เพื่อใช้คำนวณสัดส่วน)
        const sumValueBeforeAdjustInThisRound = Array.from(valueBeforeAdjustInThisRound.values()).reduce((sum, value) => {
          return sum + value
        }, 0)
        // ประมวลผลแต่ละ result item ที่ต้องการ adjust
        for (const [index, valueBeforeAdjust] of valueBeforeAdjustInThisRound) {
          const target = result[index]

          const meterUnderNom = meteringPointList.filter((meterPoint: any) => meterPoint.nomination_point?.nomination_point == target.point)

          if (meterUnderNom.length > 0) {
            let sumHeatingValueMutipleByVolume: number | undefined
            let sumVolume: number | undefined
            const targetMeterDataList = meterDataList.filter((meterData: any) => {
              return meterUnderNom.some((meterPoint: any) => meterPoint.metered_point_name == meterData.meteringPointId) &&
                meterData.gasDay == dayjs(target.gas_day, 'DD/MM/YYYY').tz('Asia/Bangkok').format('YYYY-MM-DD')
            })

            const adjustGasHour = parseToNumber(dayjs(adjustTime, 'HH:mm').format('H'))
            let gasHourMeterDataList = targetMeterDataList.filter((meterData: any) => meterData.gasHour == adjustGasHour)
            if (gasHourMeterDataList.length == 0) {
              const beforeGasHourMeterDataList = targetMeterDataList.filter((meterData: any) => meterData.gasHour <= adjustGasHour)
              if (beforeGasHourMeterDataList.length > 0) {
                const lastestGasHour = beforeGasHourMeterDataList.sort((a: any, b: any) => b.gasHour - a.gasHour)[0].gasHour
                gasHourMeterDataList = targetMeterDataList.filter((meterData: any) => meterData.gasHour == lastestGasHour)
              }
            }

            gasHourMeterDataList.map((meterData: any) => {
              const heatingValueFromMeter = parseToNumber3Decimal(meterData.heatingValue) ?? parseToNumber3Decimal(meterData.data_temp?.heatingValue)
              const volumeFromMeter = parseToNumber3Decimal(meterData.volume) ?? parseToNumber3Decimal(meterData.data_temp?.volume)
              if (volumeFromMeter != null) {
                volumeFromMeterList.push({
                  metering_point_id: meterData.meteringPointId,
                  gas_day: meterData.gasDay,
                  gas_hour: meterData.gasHour,
                  heatingValue: heatingValueFromMeter,
                  volume: volumeFromMeter
                })
                if (heatingValueFromMeter != null) {
                  heatingValueFromMeterList.push({
                    metering_point_id: meterData.meteringPointId,
                    gas_day: meterData.gasDay,
                    gas_hour: meterData.gasHour,
                    heatingValue: heatingValueFromMeter,
                    volume: volumeFromMeter
                  })
                  if (sumHeatingValueMutipleByVolume) {
                    sumHeatingValueMutipleByVolume += heatingValueFromMeter * volumeFromMeter
                  }
                  else {
                    sumHeatingValueMutipleByVolume = heatingValueFromMeter * volumeFromMeter
                  }
                }

                if (sumVolume) {
                  sumVolume += volumeFromMeter
                }
                else {
                  sumVolume = volumeFromMeter
                }
              }
            })

            if (sumHeatingValueMutipleByVolume && sumVolume) {
              calculatedHeatingValueFromMeter = sumHeatingValueMutipleByVolume / sumVolume
            }
          }

          // หาประวัติการ adjust ที่เกิดขึ้นหลังจากเวลา adjust ปัจจุบัน (สำหรับ point, zone, area, entry/exit, gas_day, group เดียวกัน)
          // เพื่อไม่ให้ adjustment ปัจจุบันไปแก้ไขค่าหลังจาก adjustment ที่เกิดขึ้นในภายหลัง
          const activeHistory = adjustHistory.filter(history =>
            history.nomination_point == target.point
            && history.zone_text == target.zone_text
            && history.area_text == target.area_text
            && history.entry_exit_name == target.entryExit
            && history.gas_day == target.gas_day
            && history.group_id == target.group_id
            && history.timeMinutes > adjustTimeMinutes
          )
          // หาเวลาที่ไม่ควร adjust (เวลาของ adjustment ที่เกิดขึ้นหลังจากนี้)
          const doNotAdjustAfterTime = activeHistory.length > 0 ? Math.min(...activeHistory.map(history => history.timeMinutes)) : undefined

          // คำนวณค่าใหม่ตามสัดส่วน: (ค่าเดิม / ผลรวมค่าเดิมทั้งหมด) * ค่า adjust ที่ต้องการ
          const newValue = (valueBeforeAdjust / sumValueBeforeAdjustInThisRound) * adjustValue
          let newValueMmscfd = null
          if (heatingValue != null || calculatedHeatingValueFromMeter != null) {
            newValueMmscfd = newValue / (heatingValue ?? calculatedHeatingValueFromMeter ?? 1)
          }

          // อัพเดทค่าใน timeShow ตั้งแต่เวลา adjustment เป็นต้นไป (จนถึงเวลาของ adjustment ถัดไป ถ้ามี)
          for (let timeShowIndex = 0; timeShowIndex < target.timeShow.length; timeShowIndex++) {
            const timeShow = target.timeShow[timeShowIndex]
            const timeShowMinutes = timeToMinutes(timeShow.time)
            if (timeShowMinutes >= adjustTimeMinutes && (!doNotAdjustAfterTime || timeShowMinutes < doNotAdjustAfterTime)) {
              result[index].timeShow[timeShowIndex].value = newValue
              result[index].timeShow[timeShowIndex].valueMmscfd = newValueMmscfd
              result[index].timeShow[timeShowIndex].heatingValueFromMeter = heatingValueFromMeterList
              result[index].timeShow[timeShowIndex].heatingValueFromAdjust = heatingValue
              result[index].timeShow[timeShowIndex].volumeFromMeter = volumeFromMeterList
              result[index].timeShow[timeShowIndex].volumeFromAdjust = volume
            }
          }

          // เพิ่มจุดเวลา adjustment เข้าไปใน timeShow (เพื่อแสดงว่ามีการ adjust ที่เวลานี้)
          result[index].timeShow.push({
            time: adjustTime,
            value: newValue,
            valueMmscfd: newValueMmscfd,
            heatingValueFromMeter: heatingValueFromMeterList,
            heatingValueFromAdjust: heatingValue,
            volumeFromMeter: volumeFromMeterList,
            volumeFromAdjust: volume
          })

          // บันทึกประวัติการ adjust
          adjustHistory.push({
            nomination_point: target.point,
            zone_text: target.zone_text,
            area_text: target.area_text,
            entry_exit_name: target.entryExit,
            gas_day: target.gas_day,
            group_id: target.group_id,
            timeMinutes: adjustTimeMinutes,
            time: adjustTime,
          })
        }
      }
    }

    // รวมผลลัพธ์ตาม nomination point (รวม contract ต่างๆ ของ shipper เดียวกัน ที่มี point, zone, area, entry/exit, gas_day เดียวกัน)
    const groupByNomPoint = []
    for (const item of result) {
      // หาว่ามี point นี้ใน groupByNomPoint แล้วหรือยัง
      const existPointIndex = groupByNomPoint.findIndex((f: any) => {
        return f?.point === item.point
          && f?.zone_text === item.zone_text
          && f?.area_text === item.area_text
          && f?.entry_exit_name === item.entryExit
          && f?.gas_day === item.gas_day
          && f?.shipper_name === item.shipper_name
      })

      // ถ้ายังไม่มี point นี้ ให้สร้างใหม่
      if (existPointIndex < 0) {
        groupByNomPoint.push({
          "gas_day": item.gas_day,
          "shipper_name": item.shipper_name,
          "zone_text": item.zone_text,
          "area_text": item.area_text,
          "point": item.point,
          "entry_exit_name": item.entryExit,
          "timeShow": item.timeShow,
        })
      }
      else {
        // ถ้ามี point นี้แล้ว ให้รวมค่า timeShow เข้าไป
        const existPoint = groupByNomPoint[existPointIndex]
        for (const timeShow of item.timeShow) {
          const timeShowIndex = existPoint.timeShow.findIndex((existTimeShow: any) => existTimeShow.time === timeShow.time)
          if (timeShowIndex >= 0) {
            // ถ้ามีเวลานี้แล้ว ให้บวกค่าเข้าไป
            let timeShowValue = existPoint.timeShow[timeShowIndex].value
            let timeShowValueMmscfd = existPoint.timeShow[timeShowIndex].valueMmscfd
            if (timeShowValue != null) {
              if (timeShow.value != null) {
                timeShowValue += timeShow.value
              }
            }
            else {
              timeShowValue = timeShow.value
            }
            if (timeShowValueMmscfd != null) {
              if (timeShow.valueMmscfd != null) {
                timeShowValueMmscfd += timeShow.valueMmscfd
              }
            }
            else {
              timeShowValueMmscfd = timeShow.valueMmscfd
            }
            groupByNomPoint[existPointIndex].timeShow[timeShowIndex].value = timeShowValue
            groupByNomPoint[existPointIndex].timeShow[timeShowIndex].valueMmscfd = timeShowValueMmscfd
          }
          else {
            // ถ้ายังไม่มีเวลานี้ ให้เพิ่มเข้าไป
            groupByNomPoint[existPointIndex].timeShow.push(timeShow)
          }
        }
      }
    }

    // Sort groupByNomPoint by gas_day, point, and shipper_name
    groupByNomPoint.sort((a: any, b: any) => {
      // First sort by gas_day
      const dateA = dayjs(a.gas_day, 'DD/MM/YYYY');
      const dateB = dayjs(b.gas_day, 'DD/MM/YYYY');
      if (!dateA.isSame(dateB)) {
        return dateA.isBefore(dateB) ? 1 : -1;
      }

      // Then sort by point
      if (a.point !== b.point) {
        return a.point.localeCompare(b.point);
      }

      // Finally sort by shipper_name
      return a.shipper_name.localeCompare(b.shipper_name);
    });

    // คืนค่าผลลัพธ์ที่จัดกลุ่มตาม nomination point แล้ว
    return groupByNomPoint
  }

  async dailyAdjustmentReportNow2(payload: any, userId: any) {
    const now = getTodayNow().tz('Asia/Bangkok');
    const today = now.format('DD/MM/YYYY')
    const nowTime = now.format("HH:mm");
    const nowMinutes = timeToMinutes(nowTime);
    const wholeDayData = await this.dailyAdjustmentReport2({ startDate: today, endDate: today }, userId);

    // Get all unique times from all timeShow arrays across wholeDayData
    const uniqueTimes = Array.from(new Set(
      wholeDayData.flatMap((data: any) =>
        data.timeShow.map((timeShow: any) => timeShow.time)
      )
    )).sort((a, b) => timeToMinutes(a) - timeToMinutes(b));

    // Filter times up to current time
    const uniqueTimesUpToNow = uniqueTimes.filter(time =>
      timeToMinutes(time) <= nowMinutes
    );

    const result = wholeDayData.map((data: any) => {
      const timeShow = data.timeShow.filter((timeShow: any) => {
        const timeShowMinutes = timeToMinutes(timeShow.time);
        return timeShowMinutes <= nowMinutes;
      })

      const missingTimes = uniqueTimesUpToNow.filter((time: any) => {
        return !timeShow.some((timeShow: any) => timeShow.time === time);
      });

      // Add missing times to timeShow with value from latest entry before missing time
      missingTimes.map((missingTime: any) => {
        // Find the latest timeShow before the missing time
        const beforeMissingTimeList = timeShow
          .filter((ts: any) => timeToMinutes(ts.time) < timeToMinutes(missingTime))
          .sort((a: any, b: any) => timeToMinutes(b.time) - timeToMinutes(a.time));
        let latestBeforeMissing: any = null;
        if (beforeMissingTimeList.length > 0) {
          latestBeforeMissing = beforeMissingTimeList[0]
        }

        // Use the value from latest entry before missing time
        timeShow.push({
          time: missingTime,
          value: latestBeforeMissing?.value ?? null,
          valueMmscfd: latestBeforeMissing?.valueMmscfd ?? null,
          heatingValueFromMeter: latestBeforeMissing?.heatingValueFromMeter ?? null,
          heatingValueFromAdjust: latestBeforeMissing?.heatingValueFromAdjust ?? null,
          volumeFromMeter: latestBeforeMissing?.volumeFromMeter ?? null,
          volumeFromAdjust: latestBeforeMissing?.volumeFromAdjust ?? null
        });
      });

      // Sort timeShow by time
      timeShow.sort((a: any, b: any) => timeToMinutes(b.time) - timeToMinutes(a.time));

      return {
        "point": data.point,
        "shipper_name": data.shipper_name,
        "timeShow": timeShow.length > 0 ? timeShow[0] : { time: nowTime, value: null }
      };
    }).sort((a: any, b: any) => a.point - b.point);

    return result;
  }


}
