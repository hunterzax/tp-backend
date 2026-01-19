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
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import isBetween from 'dayjs/plugin/isBetween';
import { UploadTemplateForShipperService } from 'src/upload-template-for-shipper/upload-template-for-shipper.service';
import { CapacityV2Service } from 'src/capacity-v2/capacity-v2.service';
import {
  getTodayEndAdd7,
  getTodayNow,
  getTodayNowAdd7,
  getTodayNowDDMMYYYYDfault,
  getTodayNowDDMMYYYYDfaultAdd7,
  getTodayStartAdd7,
} from 'src/common/utils/date.util';
import * as _ from 'lodash';
import { parseToNumber } from 'src/common/utils/number.util';
import { QualityEvaluationService } from 'src/quality-evaluation/quality-evaluation.service';
import { QualityPlanningService } from 'src/quality-planning/quality-planning.service';

dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);

@Injectable()
export class SummaryNominationReportService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    // @Inject(CACHE_MANAGER) private cacheService: Cache,
    private readonly qualityEvaluationService: QualityEvaluationService,
    private readonly qualityPlanningService: QualityPlanningService,
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

  // findAllNoIntar
  async findAll(payload: any) {
    console.log('****************************');
    // "gas_day_text": "18/05/2025",
    const { gas_day_text } = payload;
    // console.log(getTodayNowDDMMYYYYDfaultAdd7("11/05/2025").toDate());
    const resData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        OR: [{ del_flag: false }, { del_flag: null }],
        // gas_day: getTodayNow("11/05/2025").toDate()
        // gas_day: dayjs("11/05/2025", "DD/MM/YYYY").add(7, "hour").toDate()
        // gas_day: getTodayNowDDMMYYYYDfaultAdd7("11/05/2025").toDate()
        // id: 59
        query_shipper_nomination_status: {
          id: {
            in: [2, 5],
          },
        },

        // nomination_type_id:2,
        // id: {
        //   in: [114, 105]
        // //   // in: [120]
        // //   // in: [114]
        // },
      },
      include: {
        group: true,
        query_shipper_nomination_status: true,
        contract_code: true,
        submission_comment_query_shipper_nomination_file: true,
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
        query_shipper_nomination_file_renom: true,
        query_shipper_nomination_file_url: {
          include: {
            nomination_version: true,
            query_shipper_nomination_status: true,
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
        query_shipper_nomination_file_comment: {
          include: {
            query_shipper_nomination_type_comment: true,
            query_shipper_nomination_status: true,
            nomination_version: true,
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
      },
      orderBy: {
        id: 'desc',
      },
    });
    // console.log('resData : ', resData);
    // return resData
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    const areaData = await this.prisma.area.findMany({
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
        supply_reference_quality_area_by: {
          include: {
            zone: true,
          }
        },
      },
    });

    // console.log('0000 areaData : ', areaData);
    // const zoneData = await this.prisma.zone.findMany({
    //   where: {
    //     AND: [
    //       {
    //         start_date: {
    //           lte: todayEnd, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
    //         },
    //       },
    //       {
    //         OR: [
    //           { end_date: null }, // ถ้า end_date เป็น null
    //           { end_date: { gte: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
    //         ],
    //       },
    //     ],
    //   },
    //   include: {
    //     zone_master_quality: true,
    //   },
    // });
    // const contractCodeData = await this.prisma.contract_code.findMany({});
    const nomData = await this.prisma.nomination_point.findMany({
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
              { end_date: { gt: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
            ],
          },
        ],
      },
      include: {
        zone: {
          select: {
            name: true,
          },
        },
        area: {
          select: {
            name: true,
          },
        },
        entry_exit: true,
      },
    });
    const eva = await this.qualityPlanningService.findAllNoIntar();
    // console.log('nomData : ', nomData);
    const dailyWeeklyData = [];

    const resDataCv = resData.map((e: any) => {
      const nomination_version = e['nomination_version']?.map((nv: any) => {
        const nomination_full_json = nv['nomination_full_json']?.map(
          (nfj: any) => {
            nfj['data_temp'] = this.safeParseJSON(nfj['data_temp']);
            return { ...nfj };
          },
        );
        const nomination_row_json = nv['nomination_row_json']?.map(
          (nfj: any) => {
            nfj['data_temp'] = this.safeParseJSON(nfj['data_temp']);
            return { ...nfj };
          },
        );

        if (nomination_row_json.length > 0) {
          nomination_row_json.map((nx: any) => {
            dailyWeeklyData.push({
              nomination_type_id: e?.nomination_type_id,
              nomination_code: e?.nomination_code,
              gas_day: e?.gas_day,
              gas_day_text: dayjs(e?.gas_day).format('DD/MM/YYYY'),
              contract_code_id: e?.contract_code_id,
              group_id: e?.group_id,
              query_shipper_nomination_file_renom_id:
                e?.query_shipper_nomination_file_renom_id,
              submitted_timestamp: e?.submitted_timestamp,
              nomination_full_json: nomination_full_json[0],
              nomination_row_json: nx,
              unix: nx['data_temp']['9'],
              query_shipper_nomination_type_id:
                nx?.query_shipper_nomination_type_id,
              query_shipper_nomination_type: nx?.query_shipper_nomination_type,
              entry_exit_id: nx?.entry_exit_id,
              nomination_point: nx['data_temp']['3'],
              area_text: nx['data_temp']['2'],
              zone_text: nx['data_temp']['0'],
            });

            return nx;
          });
        }

        return { ...nv, nomination_full_json, nomination_row_json };
      });

      return { ...e, nomination_version };
    });

    // const dailyDataNew = dailyWeeklyData?.filter((f: any) => {
    //   return f?.gas_day_text === gas_day_text;
    // });
    const dailyDataNewD = dailyWeeklyData?.filter(
      (f: any) => f?.gas_day_text === gas_day_text,
    );
    // วันอาทิตย์ของสัปดาห์นี้
    const wsunday = getTodayNowDDMMYYYYDfault(gas_day_text)
      .startOf('week')
      .format('DD/MM/YYYY');
    const dailyDataNewW = dailyWeeklyData?.filter(
      (f: any) => f?.gas_day_text === wsunday,
    );
    // console.log('wsunday : ', wsunday);

    const dailyArr = dailyDataNewD.filter((f: any) => {
      return f?.nomination_type_id === 1;
    });
    const weeklyArr = dailyDataNewW.filter((f: any) => {
      return f?.nomination_type_id === 2;
    });

    const adailyArrNom = dailyArr?.filter((f: any) => {
      return f?.query_shipper_nomination_type_id !== 1;
    });
    const aweeklyArrNom = weeklyArr?.filter((f: any) => {
      return f?.query_shipper_nomination_type_id !== 1;
    });
    // const adailyArrNom = dailyArr?.filter((f:any) => { return f?.query_shipper_nomination_type_id === 2 })
    // const aweeklyArrNom = weeklyArr?.filter((f:any) => { return f?.query_shipper_nomination_type_id === 2 })

    const dailyArrNom = dailyArr?.filter((f: any) => {
      return f?.query_shipper_nomination_type_id === 1;
    });
    const weeklyArrNom = weeklyArr?.filter((f: any) => {
      return f?.query_shipper_nomination_type_id === 1;
    });

    const dailyArrNomMMSCFD = dailyArrNom?.filter((f: any) => {
      return f?.unix === 'MMSCFD';
    });
    const dailyArrNomMMBTUD = dailyArrNom?.filter((f: any) => {
      return f?.unix === 'MMBTU/D';
    });
    const weeklyArrNomMMSCFD = weeklyArrNom?.filter((f: any) => {
      return f?.unix === 'MMSCFD';
    });
    const weeklyArrNomMMBTUD = weeklyArrNom?.filter((f: any) => {
      return f?.unix === 'MMBTU/D';
    });
    // concept
    const ccdailyArrNomMMSCFD = adailyArrNom?.filter((f: any) => {
      return f?.unix === 'MMSCFD';
    });
    const ccdailyArrNomMMBTUD = adailyArrNom?.filter((f: any) => {
      return f?.unix === 'MMBTU/D';
    });
    const ccweeklyArrNomMMSCFD = aweeklyArrNom?.filter((f: any) => {
      return f?.unix === 'MMSCFD';
    });
    const ccweeklyArrNomMMBTUD = aweeklyArrNom?.filter((f: any) => {
      return f?.unix === 'MMBTU/D';
    });

    // --------

    // const gasdayArrDaily = [
    //   ...new Set(dailyArr.map((es: any) => es?.gas_day_text)),
    // ];
    // const newDaily = gasdayArrDaily.flatMap((e: any) => {
    //   const fil = dailyArr.filter((f: any) => f?.gas_day_text === e);
    //   const areaGroupF = [
    //     ...new Set(fil.map((gr: any) => gr?.nomination_row_json?.area_text)),
    //   ];

    //   const areaAll = areaGroupF.flatMap((es: any, ies: any, aes: any) => {
    //     const filAreaGF = fil.filter((fGf: any) => {
    //       return fGf?.nomination_row_json?.area_text === es;
    //     });

    //     const zoneTextObj =
    //       zoneData.find(
    //         (f: any) =>
    //           f?.name === filAreaGF[0]?.nomination_row_json?.zone_text &&
    //           (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
    //             filAreaGF[0]?.nomination_row_json?.data_temp['10'],
    //       ) || null;
    //     const areaTextObj =
    //       areaData.find(
    //         (f: any) =>
    //           f?.name === filAreaGF[0]?.nomination_row_json?.area_text &&
    //           (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
    //             filAreaGF[0]?.nomination_row_json?.data_temp['10'],
    //       ) || null;
    //     const gasDayText = filAreaGF[0]?.gas_day_text || null;
    //     const contractCodeId =
    //       contractCodeData.find(
    //         (f: any) => f?.id === filAreaGF[0]?.contract_code_id,
    //       ) || null;

    //     const aFil = filAreaGF.filter((f: any) => {
    //       return f?.nomination_row_json?.area_text === areaTextObj?.name;
    //     });
    //     const hvXvi =
    //       aFil.length > 0
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               sum +
    //               Number(item.nomination_row_json?.data_temp['12']) *
    //                 Number(item.nomination_row_json?.data_temp['38']),
    //             0,
    //           )
    //         : null; //hv excl

    //     const viAll =
    //       aFil.length > 0
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               sum + Number(item.nomination_row_json?.data_temp['38']),
    //             0,
    //           )
    //         : null; //wi excl

    //     const sgXvi =
    //       aFil.length > 0 && viAll
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               // sum + Number(item.nomination_row_json?.data_temp['13']) * Number(item.nomination_row_json?.data_temp['38']),
    //               sum +
    //               Number(viAll) *
    //                 Number(item.nomination_row_json?.data_temp['38']), // https://app.clickup.com/t/86etzchfg
    //             0,
    //           )
    //         : null; //sg excl

    //     const hv = hvXvi / viAll;
    //     const wi = hvXvi / 0.982596 / Math.sqrt(sgXvi * viAll);
    //     const sg = sgXvi / viAll;

    //     return [
    //       {
    //         gasday: gasDayText,
    //         zone: zoneTextObj,
    //         area: areaTextObj,
    //         parameter: 'HV',
    //         valueBtuScf: hv,
    //         contractCodeId,
    //       },
    //       {
    //         gasday: gasDayText,
    //         zone: zoneTextObj,
    //         area: areaTextObj,
    //         parameter: 'WI',
    //         valueBtuScf: wi,
    //         contractCodeId,
    //       },
    //       {
    //         gasday: gasDayText,
    //         zone: zoneTextObj,
    //         area: areaTextObj,
    //         parameter: 'SG',
    //         valueBtuScf: sg,
    //         contractCodeId,
    //       },
    //     ];
    //   });

    //   return [...areaAll];
    // });

    // const gasdayArrWeekly = [
    //   ...new Set(weeklyArr.map((es: any) => es?.gas_day_text)),
    // ];
    // const newWeekly = gasdayArrWeekly.flatMap((e: any) => {
    //   const fil = weeklyArr.filter((f: any) => f?.gas_day_text === e);

    //   const areaGroupF = [
    //     ...new Set(fil.map((gr: any) => gr?.nomination_row_json?.area_text)),
    //   ];

    //   const areaAll = areaGroupF.flatMap((es: any, ies: any, aes: any) => {
    //     const filAreaGF = fil.filter((fGf: any) => {
    //       return fGf?.nomination_row_json?.area_text === es;
    //     });

    //     // const zoneTextObj = zoneData.find((f:any) => f?.name === filAreaGF[0]?.nomination_row_json?.zone_text) || null
    //     // const areaTextObj = areaData.find((f:any) => f?.name === filAreaGF[0]?.nomination_row_json?.area_text) || null
    //     const zoneTextObj =
    //       zoneData.find(
    //         (f: any) =>
    //           f?.name === filAreaGF[0]?.nomination_row_json?.zone_text &&
    //           (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
    //             filAreaGF[0]?.nomination_row_json?.data_temp['10'],
    //       ) || null;
    //     const areaTextObj =
    //       areaData.find(
    //         (f: any) =>
    //           f?.name === filAreaGF[0]?.nomination_row_json?.area_text &&
    //           (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
    //             filAreaGF[0]?.nomination_row_json?.data_temp['10'],
    //       ) || null;
    //     const gasDayText = filAreaGF[0]?.gas_day_text || null;
    //     const contractCodeId =
    //       contractCodeData.find(
    //         (f: any) => f?.id === filAreaGF[0]?.contract_code_id,
    //       ) || null;

    //     const sunday =
    //       filAreaGF[0]?.nomination_full_json?.data_temp?.headData['14'];
    //     const monday =
    //       filAreaGF[0]?.nomination_full_json?.data_temp?.headData['15'];
    //     const tuesday =
    //       filAreaGF[0]?.nomination_full_json?.data_temp?.headData['16'];
    //     const wednesday =
    //       filAreaGF[0]?.nomination_full_json?.data_temp?.headData['17'];
    //     const thursday =
    //       filAreaGF[0]?.nomination_full_json?.data_temp?.headData['18'];
    //     const friday =
    //       filAreaGF[0]?.nomination_full_json?.data_temp?.headData['19'];
    //     const saturday =
    //       filAreaGF[0]?.nomination_full_json?.data_temp?.headData['20'];

    //     const vi1 = filAreaGF[0]?.nomination_row_json?.data_temp[14]
    //       ? Number(
    //           filAreaGF[0].nomination_row_json.data_temp[14].replace(/,/g, ''),
    //         )
    //       : null;
    //     const vi2 = filAreaGF[0]?.nomination_row_json?.data_temp[15]
    //       ? Number(
    //           filAreaGF[0].nomination_row_json.data_temp[15].replace(/,/g, ''),
    //         )
    //       : null;
    //     const vi3 = filAreaGF[0]?.nomination_row_json?.data_temp[16]
    //       ? Number(
    //           filAreaGF[0].nomination_row_json.data_temp[16].replace(/,/g, ''),
    //         )
    //       : null;
    //     const vi4 = filAreaGF[0]?.nomination_row_json?.data_temp[17]
    //       ? Number(
    //           filAreaGF[0].nomination_row_json.data_temp[17].replace(/,/g, ''),
    //         )
    //       : null;
    //     const vi5 = filAreaGF[0]?.nomination_row_json?.data_temp[18]
    //       ? Number(
    //           filAreaGF[0].nomination_row_json.data_temp[18].replace(/,/g, ''),
    //         )
    //       : null;
    //     const vi6 = filAreaGF[0]?.nomination_row_json?.data_temp[19]
    //       ? Number(
    //           filAreaGF[0].nomination_row_json.data_temp[19].replace(/,/g, ''),
    //         )
    //       : null;
    //     const vi7 = filAreaGF[0]?.nomination_row_json?.data_temp[20]
    //       ? Number(
    //           filAreaGF[0].nomination_row_json.data_temp[20].replace(/,/g, ''),
    //         )
    //       : null;
    //     //wi nomination_row_json?.data_temp["11"]
    //     //hv nomination_row_json?.data_temp["12"]
    //     //sg nomination_row_json?.data_temp["13"]
    //     const aFil = filAreaGF.filter((f: any) => {
    //       return f?.nomination_row_json?.area_text === areaTextObj?.name;
    //     });

    //     const hvXvi1 =
    //       aFil.length > 0
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               sum + Number(item.nomination_row_json?.data_temp['12']) * vi1,
    //             0,
    //           )
    //         : null;
    //     const viAll1 =
    //       aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi1, 0) : null;
    //     const sgXvi1 =
    //       aFil.length > 0 && viAll1
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               sum +
    //               Number(item.nomination_row_json?.data_temp['13']) * viAll1,
    //             // sum + Number(item.nomination_row_json?.data_temp['13']) * vi1, // https://app.clickup.com/t/86etzchf7 // https://app.clickup.com/t/86etzcher
    //             0,
    //           )
    //         : null;

    //     const hvXvi2 =
    //       aFil.length > 0
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               sum + Number(item.nomination_row_json?.data_temp['12']) * vi2,
    //             0,
    //           )
    //         : null;
    //     const viAll2 =
    //       aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi2, 0) : null;
    //     const sgXvi2 =
    //       aFil.length > 0 && viAll2
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               // sum + Number(item.nomination_row_json?.data_temp['13']) * vi2,
    //               sum +
    //               Number(item.nomination_row_json?.data_temp['13']) * viAll2, // https://app.clickup.com/t/86etzchf7 // https://app.clickup.com/t/86etzcher
    //             0,
    //           )
    //         : null;

    //     const hvXvi3 =
    //       aFil.length > 0
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               sum + Number(item.nomination_row_json?.data_temp['12']) * vi3,
    //             0,
    //           )
    //         : null;
    //     const viAll3 =
    //       aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi3, 0) : null;
    //     const sgXvi3 =
    //       aFil.length > 0 && viAll3
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               // sum + Number(item.nomination_row_json?.data_temp['13']) * vi3,
    //               sum +
    //               Number(item.nomination_row_json?.data_temp['13']) * viAll3, // https://app.clickup.com/t/86etzchf7 // https://app.clickup.com/t/86etzcher
    //             0,
    //           )
    //         : null;

    //     const hvXvi4 =
    //       aFil.length > 0
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               sum + Number(item.nomination_row_json?.data_temp['12']) * vi4,
    //             0,
    //           )
    //         : null;
    //     const viAll4 =
    //       aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi4, 0) : null;
    //     const sgXvi4 =
    //       aFil.length > 0 && viAll4
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               // sum + Number(item.nomination_row_json?.data_temp['13']) * vi4,
    //               sum +
    //               Number(item.nomination_row_json?.data_temp['13']) * viAll4, // https://app.clickup.com/t/86etzchf7 // https://app.clickup.com/t/86etzcher
    //             0,
    //           )
    //         : null;

    //     const hvXvi5 =
    //       aFil.length > 0
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               sum + Number(item.nomination_row_json?.data_temp['12']) * vi5,
    //             0,
    //           )
    //         : null;
    //     const viAll5 =
    //       aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi5, 0) : null;
    //     const sgXvi5 =
    //       aFil.length > 0 && viAll5
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               // sum + Number(item.nomination_row_json?.data_temp['13']) * vi5,
    //               sum +
    //               Number(item.nomination_row_json?.data_temp['13']) * viAll5, // https://app.clickup.com/t/86etzchf7 // https://app.clickup.com/t/86etzcher
    //             0,
    //           )
    //         : null;

    //     const hvXvi6 =
    //       aFil.length > 0
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               sum + Number(item.nomination_row_json?.data_temp['12']) * vi6,
    //             0,
    //           )
    //         : null;
    //     const viAll6 =
    //       aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi6, 0) : null;
    //     const sgXvi6 =
    //       aFil.length > 0 && viAll6
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               // sum + Number(item.nomination_row_json?.data_temp['13']) * vi6,
    //               sum +
    //               Number(item.nomination_row_json?.data_temp['13']) * viAll6, // https://app.clickup.com/t/86etzchf7 // https://app.clickup.com/t/86etzcher
    //             0,
    //           )
    //         : null;

    //     const hvXvi7 =
    //       aFil.length > 0
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               sum + Number(item.nomination_row_json?.data_temp['12']) * vi7,
    //             0,
    //           )
    //         : null;
    //     const viAll7 =
    //       aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi7, 0) : null;
    //     const sgXvi7 =
    //       aFil.length > 0 && viAll7
    //         ? aFil.reduce(
    //             (sum, item) =>
    //               // sum + Number(item.nomination_row_json?.data_temp['13']) * vi7,
    //               sum +
    //               Number(item.nomination_row_json?.data_temp['13']) * viAll7, // https://app.clickup.com/t/86etzchf7 // https://app.clickup.com/t/86etzcher
    //             0,
    //           )
    //         : null;

    //     // hv = sum(hv*vi)/ vi all
    //     const hv1 = hvXvi1 / viAll1;
    //     // wi = (sum(hv*vi)/0.982596)/(sqrt( sum(sg*vi) * vi all ))
    //     const wi1 = hvXvi1 / 0.982596 / Math.sqrt(sgXvi1 * viAll1);
    //     // sg = sum(sg*vi)/ vi all
    //     const sg1 = sgXvi1 / viAll1;

    //     const hv2 = hvXvi2 / viAll2;
    //     const wi2 = hvXvi2 / 0.982596 / Math.sqrt(sgXvi2 * viAll2);
    //     const sg2 = sgXvi2 / viAll2;

    //     const hv3 = hvXvi3 / viAll3;
    //     const wi3 = hvXvi3 / 0.982596 / Math.sqrt(sgXvi3 * viAll3);
    //     const sg3 = sgXvi3 / viAll3;

    //     const hv4 = hvXvi4 / viAll4;
    //     const wi4 = hvXvi4 / 0.982596 / Math.sqrt(sgXvi4 * viAll4);
    //     const sg4 = sgXvi4 / viAll4;

    //     const hv5 = hvXvi5 / viAll5;
    //     const wi5 = hvXvi5 / 0.982596 / Math.sqrt(sgXvi5 * viAll5);
    //     const sg5 = sgXvi5 / viAll5;

    //     const hv6 = hvXvi6 / viAll6;
    //     const wi6 = hvXvi6 / 0.982596 / Math.sqrt(sgXvi6 * viAll6);
    //     const sg6 = sgXvi6 / viAll6;

    //     const hv7 = hvXvi7 / viAll7;
    //     const wi7 = hvXvi7 / 0.982596 / Math.sqrt(sgXvi7 * viAll7);
    //     const sg7 = sgXvi7 / viAll7;

    //     return [
    //       {
    //         gasday: gasDayText,
    //         zone: zoneTextObj,
    //         area: areaTextObj,
    //         parameter: 'HV',
    //         contractCodeId,
    //         sunday: {
    //           date: sunday,
    //           value: hv1,
    //         },
    //         monday: {
    //           date: monday,
    //           value: hv2,
    //         },
    //         tuesday: {
    //           date: tuesday,
    //           value: hv3,
    //         },
    //         wednesday: {
    //           date: wednesday,
    //           value: hv4,
    //         },
    //         thursday: {
    //           date: thursday,
    //           value: hv5,
    //         },
    //         friday: {
    //           date: friday,
    //           value: hv6,
    //         },
    //         saturday: {
    //           date: saturday,
    //           value: hv7,
    //         },
    //       },
    //       {
    //         gasday: gasDayText,
    //         zone: zoneTextObj,
    //         area: areaTextObj,
    //         parameter: 'WI',
    //         contractCodeId,
    //         sunday: {
    //           date: sunday,
    //           value: wi1,
    //         },
    //         monday: {
    //           date: monday,
    //           value: wi2,
    //         },
    //         tuesday: {
    //           date: tuesday,
    //           value: wi3,
    //         },
    //         wednesday: {
    //           date: wednesday,
    //           value: wi4,
    //         },
    //         thursday: {
    //           date: thursday,
    //           value: wi5,
    //         },
    //         friday: {
    //           date: friday,
    //           value: wi6,
    //         },
    //         saturday: {
    //           date: saturday,
    //           value: wi7,
    //         },
    //       },
    //       {
    //         gasday: gasDayText,
    //         zone: zoneTextObj,
    //         area: areaTextObj,
    //         parameter: 'SG',
    //         contractCodeId,
    //         sunday: {
    //           date: sunday,
    //           value: sg1,
    //         },
    //         monday: {
    //           date: monday,
    //           value: sg2,
    //         },
    //         tuesday: {
    //           date: tuesday,
    //           value: sg3,
    //         },
    //         wednesday: {
    //           date: wednesday,
    //           value: sg4,
    //         },
    //         thursday: {
    //           date: thursday,
    //           value: sg5,
    //         },
    //         friday: {
    //           date: friday,
    //           value: sg6,
    //         },
    //         saturday: {
    //           date: saturday,
    //           value: sg7,
    //         },
    //       },
    //     ];
    //   });

    //   return [...areaAll];
    // });

    let dMMSCFD1 = dailyArrNomMMSCFD.map((e: any) => {
      const hourDay = {
        H1: e['nomination_row_json']?.['data_temp']?.['14'],
        H2: e['nomination_row_json']?.['data_temp']?.['15'],
        H3: e['nomination_row_json']?.['data_temp']?.['16'],
        H4: e['nomination_row_json']?.['data_temp']?.['17'],
        H5: e['nomination_row_json']?.['data_temp']?.['18'],
        H6: e['nomination_row_json']?.['data_temp']?.['19'],
        H7: e['nomination_row_json']?.['data_temp']?.['20'],
        H8: e['nomination_row_json']?.['data_temp']?.['21'],
        H9: e['nomination_row_json']?.['data_temp']?.['22'],
        H10: e['nomination_row_json']?.['data_temp']?.['23'],
        H11: e['nomination_row_json']?.['data_temp']?.['24'],
        H12: e['nomination_row_json']?.['data_temp']?.['25'],
        H13: e['nomination_row_json']?.['data_temp']?.['26'],
        H14: e['nomination_row_json']?.['data_temp']?.['27'],
        H15: e['nomination_row_json']?.['data_temp']?.['28'],
        H16: e['nomination_row_json']?.['data_temp']?.['29'],
        H17: e['nomination_row_json']?.['data_temp']?.['30'],
        H18: e['nomination_row_json']?.['data_temp']?.['31'],
        H19: e['nomination_row_json']?.['data_temp']?.['32'],
        H20: e['nomination_row_json']?.['data_temp']?.['33'],
        H21: e['nomination_row_json']?.['data_temp']?.['34'],
        H22: e['nomination_row_json']?.['data_temp']?.['35'],
        H23: e['nomination_row_json']?.['data_temp']?.['36'],
        H24: e['nomination_row_json']?.['data_temp']?.['37'],
        total: e['nomination_row_json']?.['data_temp']?.['38'],
      };

      const calcMMBTUDTotal = (hDay: any) => {
        const H1 = hDay?.["H1"]
          ? parseToNumber(hDay?.["H1"])
          : 0;
        const H2 = hDay?.["H2"]
          ? parseToNumber(hDay?.["H2"])
          : 0;
        const H3 = hDay?.["H3"]
          ? parseToNumber(hDay?.["H3"])
          : 0;
        const H4 = hDay?.["H4"]
          ? parseToNumber(hDay?.["H4"])
          : 0;
        const H5 = hDay?.["H5"]
          ? parseToNumber(hDay?.["H5"])
          : 0;
        const H6 = hDay?.["H6"]
          ? parseToNumber(hDay?.["H6"])
          : 0;
        const H7 = hDay?.["H7"]
          ? parseToNumber(hDay?.["H7"])
          : 0;
        const H8 = hDay?.["H8"]
          ? parseToNumber(hDay?.["H8"])
          : 0;
        const H9 = hDay?.["H9"]
          ? parseToNumber(hDay?.["H9"])
          : 0;
        const H10 = hDay?.["H10"]
          ? parseToNumber(hDay?.["H10"])
          : 0;
        const H11 = hDay?.["H11"]
          ? parseToNumber(hDay?.["H11"])
          : 0;
        const H12 = hDay?.["H12"]
          ? parseToNumber(hDay?.["H12"])
          : 0;
        const H13 = hDay?.["H13"]
          ? parseToNumber(hDay?.["H13"])
          : 0;
        const H14 = hDay?.["H14"]
          ? parseToNumber(hDay?.["H14"])
          : 0;
        const H15 = hDay?.["H15"]
          ? parseToNumber(hDay?.["H15"])
          : 0;
        const H16 = hDay?.["H16"]
          ? parseToNumber(hDay?.["H16"])
          : 0;
        const H17 = hDay?.["H17"]
          ? parseToNumber(hDay?.["H17"])
          : 0;
        const H18 = hDay?.["H18"]
          ? parseToNumber(hDay?.["H18"])
          : 0;
        const H19 = hDay?.["H19"]
          ? parseToNumber(hDay?.["H19"])
          : 0;
        const H20 = hDay?.["H20"]
          ? parseToNumber(hDay?.["H20"])
          : 0;
        const H21 = hDay?.["H21"]
          ? parseToNumber(hDay?.["H21"])
          : 0;
        const H22 = hDay?.["H22"]
          ? parseToNumber(hDay?.["H22"])
          : 0;
        const H23 = hDay?.["H23"]
          ? parseToNumber(hDay?.["H23"])
          : 0;
        const H24 = hDay?.["H24"]
          ? parseToNumber(hDay?.["H24"])
          : 0;


        const vl =
          H1 +
          H2 +
          H3 +
          H4 +
          H5 +
          H6 +
          H7 +
          H8 +
          H9 +
          H10 +
          H11 +
          H12 +
          H13 +
          H14 +
          H15 +
          H16 +
          H17 +
          H18 +
          H19 +
          H20 +
          H21 +
          H22 +
          H23 +
          H24;
        // console.log('--vl : ', vl);
        // console.log('-hv : ', hv);
        const calcFD = vl || 0;
        // console.log('calcFD : ', calcFD);
        return calcFD;
      };

      const totalCap = calcMMBTUDTotal(hourDay);
      const total = calcMMBTUDTotal(hourDay);

      // let totalCap =
      //   e['nomination_row_json']?.['data_temp']?.['38']?.replace(/,/g, '') ||
      //   null;
      const nomPoint = nomData?.find((f: any) => {
        return f?.nomination_point === e['nomination_point'];
      });
      const utilization =
        (Number(totalCap) / Number(nomPoint?.maximum_capacity ?? 0)) * 100;



      return { ...e, totalCap, total, utilization, ...hourDay };
    });
    // new calc hv
    const dMMBTUD1 = dailyArrNomMMBTUD.map((e: any) => {
      // https://app.clickup.com/t/86ettxg45
      // let totalCap =
      //   e['nomination_row_json']?.['data_temp']?.['38']?.replace(/,/g, '') ||
      //   null;




      // https://app.clickup.com/t/86etzchfj
      const filDayWFormEva =
        eva?.newDaily
          ?.filter((f: any) => f?.parameter === 'HV')
          ?.filter((f: any) => f?.gasday === e?.gas_day_text)
          ?.filter((f: any) => f?.zone?.name === e?.zone_text)
          ?.filter((f: any) => f?.area?.name === e?.area_text)?.[0] || null;

      const hv = filDayWFormEva?.valueBtuScf || 0;

      const nomPoint = nomData?.find((f: any) => {
        return f?.nomination_point === e['nomination_point'];
      });

      const hourDay = {
        H1: e['nomination_row_json']?.['data_temp']?.['14'],
        H2: e['nomination_row_json']?.['data_temp']?.['15'],
        H3: e['nomination_row_json']?.['data_temp']?.['16'],
        H4: e['nomination_row_json']?.['data_temp']?.['17'],
        H5: e['nomination_row_json']?.['data_temp']?.['18'],
        H6: e['nomination_row_json']?.['data_temp']?.['19'],
        H7: e['nomination_row_json']?.['data_temp']?.['20'],
        H8: e['nomination_row_json']?.['data_temp']?.['21'],
        H9: e['nomination_row_json']?.['data_temp']?.['22'],
        H10: e['nomination_row_json']?.['data_temp']?.['23'],
        H11: e['nomination_row_json']?.['data_temp']?.['24'],
        H12: e['nomination_row_json']?.['data_temp']?.['25'],
        H13: e['nomination_row_json']?.['data_temp']?.['26'],
        H14: e['nomination_row_json']?.['data_temp']?.['27'],
        H15: e['nomination_row_json']?.['data_temp']?.['28'],
        H16: e['nomination_row_json']?.['data_temp']?.['29'],
        H17: e['nomination_row_json']?.['data_temp']?.['30'],
        H18: e['nomination_row_json']?.['data_temp']?.['31'],
        H19: e['nomination_row_json']?.['data_temp']?.['32'],
        H20: e['nomination_row_json']?.['data_temp']?.['33'],
        H21: e['nomination_row_json']?.['data_temp']?.['34'],
        H22: e['nomination_row_json']?.['data_temp']?.['35'],
        H23: e['nomination_row_json']?.['data_temp']?.['36'],
        H24: e['nomination_row_json']?.['data_temp']?.['37'],
        total: e['nomination_row_json']?.['data_temp']?.['38'],
      };

      const calcMMBTUDTotal = (hDay: any) => {
        const H1 = hDay?.["H1"]
          ? parseToNumber(hDay?.["H1"])
          : 0;
        const H2 = hDay?.["H2"]
          ? parseToNumber(hDay?.["H2"])
          : 0;
        const H3 = hDay?.["H3"]
          ? parseToNumber(hDay?.["H3"])
          : 0;
        const H4 = hDay?.["H4"]
          ? parseToNumber(hDay?.["H4"])
          : 0;
        const H5 = hDay?.["H5"]
          ? parseToNumber(hDay?.["H5"])
          : 0;
        const H6 = hDay?.["H6"]
          ? parseToNumber(hDay?.["H6"])
          : 0;
        const H7 = hDay?.["H7"]
          ? parseToNumber(hDay?.["H7"])
          : 0;
        const H8 = hDay?.["H8"]
          ? parseToNumber(hDay?.["H8"])
          : 0;
        const H9 = hDay?.["H9"]
          ? parseToNumber(hDay?.["H9"])
          : 0;
        const H10 = hDay?.["H10"]
          ? parseToNumber(hDay?.["H10"])
          : 0;
        const H11 = hDay?.["H11"]
          ? parseToNumber(hDay?.["H11"])
          : 0;
        const H12 = hDay?.["H12"]
          ? parseToNumber(hDay?.["H12"])
          : 0;
        const H13 = hDay?.["H13"]
          ? parseToNumber(hDay?.["H13"])
          : 0;
        const H14 = hDay?.["H14"]
          ? parseToNumber(hDay?.["H14"])
          : 0;
        const H15 = hDay?.["H15"]
          ? parseToNumber(hDay?.["H15"])
          : 0;
        const H16 = hDay?.["H16"]
          ? parseToNumber(hDay?.["H16"])
          : 0;
        const H17 = hDay?.["H17"]
          ? parseToNumber(hDay?.["H17"])
          : 0;
        const H18 = hDay?.["H18"]
          ? parseToNumber(hDay?.["H18"])
          : 0;
        const H19 = hDay?.["H19"]
          ? parseToNumber(hDay?.["H19"])
          : 0;
        const H20 = hDay?.["H20"]
          ? parseToNumber(hDay?.["H20"])
          : 0;
        const H21 = hDay?.["H21"]
          ? parseToNumber(hDay?.["H21"])
          : 0;
        const H22 = hDay?.["H22"]
          ? parseToNumber(hDay?.["H22"])
          : 0;
        const H23 = hDay?.["H23"]
          ? parseToNumber(hDay?.["H23"])
          : 0;
        const H24 = hDay?.["H24"]
          ? parseToNumber(hDay?.["H24"])
          : 0;


        const vl =
          H1 +
          H2 +
          H3 +
          H4 +
          H5 +
          H6 +
          H7 +
          H8 +
          H9 +
          H10 +
          H11 +
          H12 +
          H13 +
          H14 +
          H15 +
          H16 +
          H17 +
          H18 +
          H19 +
          H20 +
          H21 +
          H22 +
          H23 +
          H24;
        // console.log('--vl : ', vl);
        // console.log('-hv : ', hv);
        const calcFD = vl || 0;
        // console.log('calcFD : ', calcFD);
        return calcFD;
      };

      const totalCap = calcMMBTUDTotal(hourDay);
      const total = calcMMBTUDTotal(hourDay);

      const utilization =
        hv === 0
          ? 0
          : (Number(totalCap) /
            (Number(nomPoint?.maximum_capacity ?? 0) * Number(hv))) *
          100;



      return { ...e, totalCap, total, utilization, ...hourDay };
    });

    // console.log('dailyArrNomMMBTUD : ', dailyArrNomMMBTUD);
    // new calc hv sp
    const dExitMMBTUDtoMMSCFD1 = dailyArrNomMMBTUD
      ?.filter((f: any) => {
        return f?.entry_exit_id === 2;
      })
      .map((e: any) => {

        // areaData

        const supplyRef = areaData?.find((f: any) => {

          return (
            f?.name === e?.area_text
          )
        })
        const filDayWFormEva =
          eva?.newDaily
            ?.filter((f: any) => f?.parameter === 'HV')
            ?.filter((f: any) => f?.gasday === e?.gas_day_text)
            ?.filter((f: any) => f?.zone?.name === supplyRef?.supply_reference_quality_area_by?.zone?.name)
            ?.filter((f: any) => f?.area?.name === supplyRef?.supply_reference_quality_area_by?.name)?.[0] || null;
        // ?.filter((f: any) => f?.zone?.name === e?.zone_text)
        // ?.filter((f: any) => f?.area?.name === e?.area_text)?.[0] || null;
        // console.log('- - -');
        // console.log('e?.gas_day_text : ', e?.gas_day_text);
        // console.log('e?.nomination_point : ', e?.nomination_point);
        // console.log('e?.zone_text : ', e?.zone_text);
        // console.log('e?.area_text : ', e?.area_text);

        const hv = filDayWFormEva?.valueBtuScf || 0;


        const nomPoint = nomData?.find((f: any) => {
          return f?.nomination_point === e['nomination_point'];
        });

        // console.log('hv : ', hv);
        // console.log('nomPoint?.maximum_capacity : ', nomPoint?.maximum_capacity);


        const calcMMBTUDtoMMSCFD = (key: any) => {
          const vl = e['nomination_row_json']?.['data_temp']?.[key]
            ? parseToNumber(e['nomination_row_json']?.['data_temp']?.[key])
            : 0;
          // console.log('--vl : ', vl);
          // console.log('-hv : ', hv);
          const calcFD = !!vl && hv !== 0 ? vl / hv : 0;
          // console.log('calcFD : ', calcFD);
          return calcFD;
        };
        const calcMMBTUDtoMMSCFDTotal = (hDay: any) => {
          const H1 = hDay?.["H1"]
            ? parseToNumber(hDay?.["H1"])
            : 0;
          const H2 = hDay?.["H2"]
            ? parseToNumber(hDay?.["H2"])
            : 0;
          const H3 = hDay?.["H3"]
            ? parseToNumber(hDay?.["H3"])
            : 0;
          const H4 = hDay?.["H4"]
            ? parseToNumber(hDay?.["H4"])
            : 0;
          const H5 = hDay?.["H5"]
            ? parseToNumber(hDay?.["H5"])
            : 0;
          const H6 = hDay?.["H6"]
            ? parseToNumber(hDay?.["H6"])
            : 0;
          const H7 = hDay?.["H7"]
            ? parseToNumber(hDay?.["H7"])
            : 0;
          const H8 = hDay?.["H8"]
            ? parseToNumber(hDay?.["H8"])
            : 0;
          const H9 = hDay?.["H9"]
            ? parseToNumber(hDay?.["H9"])
            : 0;
          const H10 = hDay?.["H10"]
            ? parseToNumber(hDay?.["H10"])
            : 0;
          const H11 = hDay?.["H11"]
            ? parseToNumber(hDay?.["H11"])
            : 0;
          const H12 = hDay?.["H12"]
            ? parseToNumber(hDay?.["H12"])
            : 0;
          const H13 = hDay?.["H13"]
            ? parseToNumber(hDay?.["H13"])
            : 0;
          const H14 = hDay?.["H14"]
            ? parseToNumber(hDay?.["H14"])
            : 0;
          const H15 = hDay?.["H15"]
            ? parseToNumber(hDay?.["H15"])
            : 0;
          const H16 = hDay?.["H16"]
            ? parseToNumber(hDay?.["H16"])
            : 0;
          const H17 = hDay?.["H17"]
            ? parseToNumber(hDay?.["H17"])
            : 0;
          const H18 = hDay?.["H18"]
            ? parseToNumber(hDay?.["H18"])
            : 0;
          const H19 = hDay?.["H19"]
            ? parseToNumber(hDay?.["H19"])
            : 0;
          const H20 = hDay?.["H20"]
            ? parseToNumber(hDay?.["H20"])
            : 0;
          const H21 = hDay?.["H21"]
            ? parseToNumber(hDay?.["H21"])
            : 0;
          const H22 = hDay?.["H22"]
            ? parseToNumber(hDay?.["H22"])
            : 0;
          const H23 = hDay?.["H23"]
            ? parseToNumber(hDay?.["H23"])
            : 0;
          const H24 = hDay?.["H24"]
            ? parseToNumber(hDay?.["H24"])
            : 0;


          const vl =
            H1 +
            H2 +
            H3 +
            H4 +
            H5 +
            H6 +
            H7 +
            H8 +
            H9 +
            H10 +
            H11 +
            H12 +
            H13 +
            H14 +
            H15 +
            H16 +
            H17 +
            H18 +
            H19 +
            H20 +
            H21 +
            H22 +
            H23 +
            H24;
          // console.log('--vl : ', vl);
          // console.log('-hv : ', hv);
          const calcFD = !!vl && hv !== 0 ? vl / hv : 0;
          // console.log('calcFD : ', calcFD);
          return calcFD;
        };

        const hourDay = {
          H1: calcMMBTUDtoMMSCFD('14'),
          H2: calcMMBTUDtoMMSCFD('15'),
          H3: calcMMBTUDtoMMSCFD('16'),
          H4: calcMMBTUDtoMMSCFD('17'),
          H5: calcMMBTUDtoMMSCFD('18'),
          H6: calcMMBTUDtoMMSCFD('19'),
          H7: calcMMBTUDtoMMSCFD('20'),
          H8: calcMMBTUDtoMMSCFD('21'),
          H9: calcMMBTUDtoMMSCFD('22'),
          H10: calcMMBTUDtoMMSCFD('23'),
          H11: calcMMBTUDtoMMSCFD('24'),
          H12: calcMMBTUDtoMMSCFD('25'),
          H13: calcMMBTUDtoMMSCFD('26'),
          H14: calcMMBTUDtoMMSCFD('27'),
          H15: calcMMBTUDtoMMSCFD('28'),
          H16: calcMMBTUDtoMMSCFD('29'),
          H17: calcMMBTUDtoMMSCFD('30'),
          H18: calcMMBTUDtoMMSCFD('31'),
          H19: calcMMBTUDtoMMSCFD('32'),
          H20: calcMMBTUDtoMMSCFD('33'),
          H21: calcMMBTUDtoMMSCFD('34'),
          H22: calcMMBTUDtoMMSCFD('35'),
          H23: calcMMBTUDtoMMSCFD('36'),
          H24: calcMMBTUDtoMMSCFD('37'),
        };

        // let totalCap = calcMMBTUDtoMMSCFD('38');
        // let total = calcMMBTUDtoMMSCFD('38');
        const totalCap = calcMMBTUDtoMMSCFDTotal(hourDay);
        const total = calcMMBTUDtoMMSCFDTotal(hourDay);
        // total
        // console.log('totalCap : ', totalCap);
        // console.log('a : ', e['nomination_row_json']?.['data_temp']?.['38']);

        const utilization =
          hv === 0
            ? 0
            : (Number(totalCap) /
              (Number(nomPoint?.maximum_capacity ?? 0) * Number(hv))) *
            100;



        return { ...e, totalCap, total, utilization, ...hourDay };
      });

    // console.log('dExitMMBTUDtoMMSCFD1 : ', dExitMMBTUDtoMMSCFD1);
    dMMSCFD1 = [...dExitMMBTUDtoMMSCFD1, ...dMMSCFD1];

    // console.log('----dMMSCFD1 : ', dMMSCFD1);

    // cc
    let ccdMMSCFD1 = ccdailyArrNomMMSCFD.map((e: any) => {

      // let totalCap =
      //   e['nomination_row_json']?.['data_temp']?.['38']?.replace(/,/g, '') ||
      //   null;
      const nomPoint = nomData?.find((f: any) => {
        return f?.nomination_point === e['nomination_point'];
      });

      const hourDay = {
        H1: e['nomination_row_json']?.['data_temp']?.['14'],
        H2: e['nomination_row_json']?.['data_temp']?.['15'],
        H3: e['nomination_row_json']?.['data_temp']?.['16'],
        H4: e['nomination_row_json']?.['data_temp']?.['17'],
        H5: e['nomination_row_json']?.['data_temp']?.['18'],
        H6: e['nomination_row_json']?.['data_temp']?.['19'],
        H7: e['nomination_row_json']?.['data_temp']?.['20'],
        H8: e['nomination_row_json']?.['data_temp']?.['21'],
        H9: e['nomination_row_json']?.['data_temp']?.['22'],
        H10: e['nomination_row_json']?.['data_temp']?.['23'],
        H11: e['nomination_row_json']?.['data_temp']?.['24'],
        H12: e['nomination_row_json']?.['data_temp']?.['25'],
        H13: e['nomination_row_json']?.['data_temp']?.['26'],
        H14: e['nomination_row_json']?.['data_temp']?.['27'],
        H15: e['nomination_row_json']?.['data_temp']?.['28'],
        H16: e['nomination_row_json']?.['data_temp']?.['29'],
        H17: e['nomination_row_json']?.['data_temp']?.['30'],
        H18: e['nomination_row_json']?.['data_temp']?.['31'],
        H19: e['nomination_row_json']?.['data_temp']?.['32'],
        H20: e['nomination_row_json']?.['data_temp']?.['33'],
        H21: e['nomination_row_json']?.['data_temp']?.['34'],
        H22: e['nomination_row_json']?.['data_temp']?.['35'],
        H23: e['nomination_row_json']?.['data_temp']?.['36'],
        H24: e['nomination_row_json']?.['data_temp']?.['37'],
        // total: e['nomination_row_json']?.['data_temp']?.['38'],
      };

      const calcTotal = (hDay: any) => {
        const H1 = hDay?.["H1"]
          ? parseToNumber(hDay?.["H1"])
          : 0;
        const H2 = hDay?.["H2"]
          ? parseToNumber(hDay?.["H2"])
          : 0;
        const H3 = hDay?.["H3"]
          ? parseToNumber(hDay?.["H3"])
          : 0;
        const H4 = hDay?.["H4"]
          ? parseToNumber(hDay?.["H4"])
          : 0;
        const H5 = hDay?.["H5"]
          ? parseToNumber(hDay?.["H5"])
          : 0;
        const H6 = hDay?.["H6"]
          ? parseToNumber(hDay?.["H6"])
          : 0;
        const H7 = hDay?.["H7"]
          ? parseToNumber(hDay?.["H7"])
          : 0;
        const H8 = hDay?.["H8"]
          ? parseToNumber(hDay?.["H8"])
          : 0;
        const H9 = hDay?.["H9"]
          ? parseToNumber(hDay?.["H9"])
          : 0;
        const H10 = hDay?.["H10"]
          ? parseToNumber(hDay?.["H10"])
          : 0;
        const H11 = hDay?.["H11"]
          ? parseToNumber(hDay?.["H11"])
          : 0;
        const H12 = hDay?.["H12"]
          ? parseToNumber(hDay?.["H12"])
          : 0;
        const H13 = hDay?.["H13"]
          ? parseToNumber(hDay?.["H13"])
          : 0;
        const H14 = hDay?.["H14"]
          ? parseToNumber(hDay?.["H14"])
          : 0;
        const H15 = hDay?.["H15"]
          ? parseToNumber(hDay?.["H15"])
          : 0;
        const H16 = hDay?.["H16"]
          ? parseToNumber(hDay?.["H16"])
          : 0;
        const H17 = hDay?.["H17"]
          ? parseToNumber(hDay?.["H17"])
          : 0;
        const H18 = hDay?.["H18"]
          ? parseToNumber(hDay?.["H18"])
          : 0;
        const H19 = hDay?.["H19"]
          ? parseToNumber(hDay?.["H19"])
          : 0;
        const H20 = hDay?.["H20"]
          ? parseToNumber(hDay?.["H20"])
          : 0;
        const H21 = hDay?.["H21"]
          ? parseToNumber(hDay?.["H21"])
          : 0;
        const H22 = hDay?.["H22"]
          ? parseToNumber(hDay?.["H22"])
          : 0;
        const H23 = hDay?.["H23"]
          ? parseToNumber(hDay?.["H23"])
          : 0;
        const H24 = hDay?.["H24"]
          ? parseToNumber(hDay?.["H24"])
          : 0;


        const vl =
          H1 +
          H2 +
          H3 +
          H4 +
          H5 +
          H6 +
          H7 +
          H8 +
          H9 +
          H10 +
          H11 +
          H12 +
          H13 +
          H14 +
          H15 +
          H16 +
          H17 +
          H18 +
          H19 +
          H20 +
          H21 +
          H22 +
          H23 +
          H24;
        // console.log('--vl : ', vl);
        // console.log('-hv : ', hv);
        const calcFD = vl || 0;
        // console.log('calcFD : ', calcFD);
        return calcFD;
      };

      const totalCap = calcTotal(hourDay);
      const total = calcTotal(hourDay);

      const utilization =
        (Number(totalCap) / Number(nomPoint?.maximum_capacity ?? 0)) * 100;



      return { ...e, totalCap, total, utilization, ...hourDay };
    });

    // new calc hv utilization
    const ccdMMBTUD1 = ccdailyArrNomMMBTUD.map((e: any) => {

      // let totalCap =
      //   e['nomination_row_json']?.['data_temp']?.['38']?.replace(/,/g, '') ||
      //   null;


      const hourDay = {
        H1: e['nomination_row_json']?.['data_temp']?.['14'],
        H2: e['nomination_row_json']?.['data_temp']?.['15'],
        H3: e['nomination_row_json']?.['data_temp']?.['16'],
        H4: e['nomination_row_json']?.['data_temp']?.['17'],
        H5: e['nomination_row_json']?.['data_temp']?.['18'],
        H6: e['nomination_row_json']?.['data_temp']?.['19'],
        H7: e['nomination_row_json']?.['data_temp']?.['20'],
        H8: e['nomination_row_json']?.['data_temp']?.['21'],
        H9: e['nomination_row_json']?.['data_temp']?.['22'],
        H10: e['nomination_row_json']?.['data_temp']?.['23'],
        H11: e['nomination_row_json']?.['data_temp']?.['24'],
        H12: e['nomination_row_json']?.['data_temp']?.['25'],
        H13: e['nomination_row_json']?.['data_temp']?.['26'],
        H14: e['nomination_row_json']?.['data_temp']?.['27'],
        H15: e['nomination_row_json']?.['data_temp']?.['28'],
        H16: e['nomination_row_json']?.['data_temp']?.['29'],
        H17: e['nomination_row_json']?.['data_temp']?.['30'],
        H18: e['nomination_row_json']?.['data_temp']?.['31'],
        H19: e['nomination_row_json']?.['data_temp']?.['32'],
        H20: e['nomination_row_json']?.['data_temp']?.['33'],
        H21: e['nomination_row_json']?.['data_temp']?.['34'],
        H22: e['nomination_row_json']?.['data_temp']?.['35'],
        H23: e['nomination_row_json']?.['data_temp']?.['36'],
        H24: e['nomination_row_json']?.['data_temp']?.['37'],
        // total: e['nomination_row_json']?.['data_temp']?.['38'],
      };

      const calcTotal = (hDay: any) => {
        const H1 = hDay?.["H1"]
          ? parseToNumber(hDay?.["H1"])
          : 0;
        const H2 = hDay?.["H2"]
          ? parseToNumber(hDay?.["H2"])
          : 0;
        const H3 = hDay?.["H3"]
          ? parseToNumber(hDay?.["H3"])
          : 0;
        const H4 = hDay?.["H4"]
          ? parseToNumber(hDay?.["H4"])
          : 0;
        const H5 = hDay?.["H5"]
          ? parseToNumber(hDay?.["H5"])
          : 0;
        const H6 = hDay?.["H6"]
          ? parseToNumber(hDay?.["H6"])
          : 0;
        const H7 = hDay?.["H7"]
          ? parseToNumber(hDay?.["H7"])
          : 0;
        const H8 = hDay?.["H8"]
          ? parseToNumber(hDay?.["H8"])
          : 0;
        const H9 = hDay?.["H9"]
          ? parseToNumber(hDay?.["H9"])
          : 0;
        const H10 = hDay?.["H10"]
          ? parseToNumber(hDay?.["H10"])
          : 0;
        const H11 = hDay?.["H11"]
          ? parseToNumber(hDay?.["H11"])
          : 0;
        const H12 = hDay?.["H12"]
          ? parseToNumber(hDay?.["H12"])
          : 0;
        const H13 = hDay?.["H13"]
          ? parseToNumber(hDay?.["H13"])
          : 0;
        const H14 = hDay?.["H14"]
          ? parseToNumber(hDay?.["H14"])
          : 0;
        const H15 = hDay?.["H15"]
          ? parseToNumber(hDay?.["H15"])
          : 0;
        const H16 = hDay?.["H16"]
          ? parseToNumber(hDay?.["H16"])
          : 0;
        const H17 = hDay?.["H17"]
          ? parseToNumber(hDay?.["H17"])
          : 0;
        const H18 = hDay?.["H18"]
          ? parseToNumber(hDay?.["H18"])
          : 0;
        const H19 = hDay?.["H19"]
          ? parseToNumber(hDay?.["H19"])
          : 0;
        const H20 = hDay?.["H20"]
          ? parseToNumber(hDay?.["H20"])
          : 0;
        const H21 = hDay?.["H21"]
          ? parseToNumber(hDay?.["H21"])
          : 0;
        const H22 = hDay?.["H22"]
          ? parseToNumber(hDay?.["H22"])
          : 0;
        const H23 = hDay?.["H23"]
          ? parseToNumber(hDay?.["H23"])
          : 0;
        const H24 = hDay?.["H24"]
          ? parseToNumber(hDay?.["H24"])
          : 0;


        const vl =
          H1 +
          H2 +
          H3 +
          H4 +
          H5 +
          H6 +
          H7 +
          H8 +
          H9 +
          H10 +
          H11 +
          H12 +
          H13 +
          H14 +
          H15 +
          H16 +
          H17 +
          H18 +
          H19 +
          H20 +
          H21 +
          H22 +
          H23 +
          H24;
        // console.log('--vl : ', vl);
        // console.log('-hv : ', hv);
        const calcFD = vl || 0;
        // console.log('calcFD : ', calcFD);
        return calcFD;
      };

      const totalCap = calcTotal(hourDay);
      const total = calcTotal(hourDay);


      const filDayWFormEva =
        eva?.newDaily
          ?.filter((f: any) => f?.parameter === 'HV')
          ?.filter((f: any) => f?.gasday === e?.gas_day_text)
          ?.filter((f: any) => f?.zone?.name === e?.zone_text)
          ?.filter((f: any) => f?.area?.name === e?.area_text)?.[0] || null;
      // console.log('=-=-=-=eva?.newDaily : ', eva?.newDaily);
      // console.log('e : ', e);
      // console.log('=-=-=-=filDayWFormEva : ', filDayWFormEva);
      const hv = filDayWFormEva?.valueBtuScf || 0;
      const nomPoint = nomData?.find((f: any) => {
        return f?.nomination_point === e['nomination_point'];
      });

      // let utilization = (Number(totalCap) / Number(fareaData)) * 100;

      const utilization =
        hv === 0
          ? 0
          : (Number(totalCap) /
            (Number(nomPoint?.maximum_capacity ?? 0) * Number(hv))) *
          100;



      return { ...e, totalCap, total, utilization, ...hourDay };
    });

    // new calc hv sp
    const ccdExitMMBTUDtoMMSCFD1 = ccdailyArrNomMMBTUD
      ?.filter((f: any) => {
        return f?.entry_exit_id === 2;
      })
      .map((e: any) => {

        // https://app.clickup.com/t/86etzchfj
        const supplyRef = areaData?.find((f: any) => {

          return (
            f?.name === e?.area_text
          )
        })
        const filDayWFormEva =
          eva?.newDaily
            ?.filter((f: any) => f?.parameter === 'HV')
            ?.filter((f: any) => f?.gasday === e?.gas_day_text)
            ?.filter((f: any) => f?.zone?.name === supplyRef?.supply_reference_quality_area_by?.zone?.name)
            ?.filter((f: any) => f?.area?.name === supplyRef?.supply_reference_quality_area_by?.name)?.[0] || null;

        // let filDayWFormEva =
        //   eva?.newDaily
        //     ?.filter((f: any) => f?.parameter === 'HV')
        //     ?.filter((f: any) => f?.gasday === e?.gas_day_text)
        //     ?.filter((f: any) => f?.zone?.name === e?.zone_text)
        //     ?.filter((f: any) => f?.area?.name === e?.area_text)?.[0] || null;
        const hv = filDayWFormEva?.valueBtuScf || 0;
        const nomPoint = nomData?.find((f: any) => {
          return f?.nomination_point === e['nomination_point'];
        });

        const calcMMBTUDtoMMSCFD = (key: any) => {
          const vl = e['nomination_row_json']?.['data_temp']?.[key]
            ? Number(e['nomination_row_json']?.['data_temp']?.[key])
            : null;
          const calcFD = !!vl && hv !== 0 ? vl / hv : null;
          return calcFD;
        };

        const totalCap = calcMMBTUDtoMMSCFD('38') || null;

        // let utilization = (Number(totalCap) / Number(fareaData)) * 100;
        const utilization =
          hv === 0
            ? 0
            : (Number(totalCap) /
              (Number(nomPoint?.maximum_capacity ?? 0) * Number(hv))) *
            100;

        const hourDay = {
          H1: calcMMBTUDtoMMSCFD('14'),
          H2: calcMMBTUDtoMMSCFD('15'),
          H3: calcMMBTUDtoMMSCFD('16'),
          H4: calcMMBTUDtoMMSCFD('17'),
          H5: calcMMBTUDtoMMSCFD('18'),
          H6: calcMMBTUDtoMMSCFD('19'),
          H7: calcMMBTUDtoMMSCFD('20'),
          H8: calcMMBTUDtoMMSCFD('21'),
          H9: calcMMBTUDtoMMSCFD('22'),
          H10: calcMMBTUDtoMMSCFD('23'),
          H11: calcMMBTUDtoMMSCFD('24'),
          H12: calcMMBTUDtoMMSCFD('25'),
          H13: calcMMBTUDtoMMSCFD('26'),
          H14: calcMMBTUDtoMMSCFD('27'),
          H15: calcMMBTUDtoMMSCFD('28'),
          H16: calcMMBTUDtoMMSCFD('29'),
          H17: calcMMBTUDtoMMSCFD('30'),
          H18: calcMMBTUDtoMMSCFD('31'),
          H19: calcMMBTUDtoMMSCFD('32'),
          H20: calcMMBTUDtoMMSCFD('33'),
          H21: calcMMBTUDtoMMSCFD('34'),
          H22: calcMMBTUDtoMMSCFD('35'),
          H23: calcMMBTUDtoMMSCFD('36'),
          H24: calcMMBTUDtoMMSCFD('37'),
          total: calcMMBTUDtoMMSCFD('38'),
        };

        return { ...e, totalCap, utilization, ...hourDay };
      });

    ccdMMSCFD1 = [...ccdExitMMBTUDtoMMSCFD1, ...ccdMMSCFD1];

    // console.log('***** weeklyArrNomMMSCFD : ', weeklyArrNomMMSCFD);

    let wMMSCFD1 = weeklyArrNomMMSCFD.map((e: any) => {
      const sundayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['14']?.replace(/,/g, '') ||
        null;
      const mondayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['15']?.replace(/,/g, '') ||
        null;
      const tuesdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['16']?.replace(/,/g, '') ||
        null;
      const wednesdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['17']?.replace(/,/g, '') ||
        null;
      const thursdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['18']?.replace(/,/g, '') ||
        null;
      const fridayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['19']?.replace(/,/g, '') ||
        null;
      const saturdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['20']?.replace(/,/g, '') ||
        null;
      const nomPoint = nomData?.find((f: any) => {
        return f?.nomination_point === e['nomination_point'];
      });

      const calcWeek = (cap: any, maximum_capacity: any) => {
        if (Number.isFinite((Number(cap ?? 0) / Number(maximum_capacity ?? 0)) * 100)) {
          return (Number(cap ?? 0) / Number(maximum_capacity ?? 0)) * 100
        } else {
          return 0
        }
      }

      const dayWeek = {
        gas_day_sunday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(0, 'day')
          .format('DD/MM/YYYY'),
        sunday: e['nomination_row_json']?.['data_temp']?.['14'] || 0,
        sunday_utilization: calcWeek(sundayTotalCap, nomPoint?.maximum_capacity),
        gas_day_monday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(1, 'day')
          .format('DD/MM/YYYY'),
        monday: e['nomination_row_json']?.['data_temp']?.['15'] || 0,
        monday_utilization: calcWeek(mondayTotalCap, nomPoint?.maximum_capacity),
        gas_day_tuesday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(2, 'day')
          .format('DD/MM/YYYY'),
        tuesday: e['nomination_row_json']?.['data_temp']?.['16'] || 0,
        tuesday_utilization: calcWeek(tuesdayTotalCap, nomPoint?.maximum_capacity),
        gas_day_wednesday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(3, 'day')
          .format('DD/MM/YYYY'),
        wednesday: e['nomination_row_json']?.['data_temp']?.['17'] || 0,
        wednesday_utilization: calcWeek(wednesdayTotalCap, nomPoint?.maximum_capacity),
        gas_day_thursday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(4, 'day')
          .format('DD/MM/YYYY'),
        thursday: e['nomination_row_json']?.['data_temp']?.['18'] || 0,
        thursday_utilization: calcWeek(thursdayTotalCap, nomPoint?.maximum_capacity),
        gas_day_friday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(5, 'day')
          .format('DD/MM/YYYY'),
        friday: e['nomination_row_json']?.['data_temp']?.['19'] || 0,
        friday_utilization: calcWeek(fridayTotalCap, nomPoint?.maximum_capacity),
        gas_day_saturday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(6, 'day')
          .format('DD/MM/YYYY'),
        saturday: e['nomination_row_json']?.['data_temp']?.['20'] || 0,
        saturday_utilization: calcWeek(saturdayTotalCap, nomPoint?.maximum_capacity),
      };

      return { ...e, ...dayWeek };
    });

    // console.log('***** wMMSCFD1 : ', wMMSCFD1);

    // new calc hv
    const wMMBTUD1 = weeklyArrNomMMBTUD.map((e: any) => {
      const sundayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['14']?.replace(/,/g, '') ||
        null;
      const mondayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['15']?.replace(/,/g, '') ||
        null;
      const tuesdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['16']?.replace(/,/g, '') ||
        null;
      const wednesdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['17']?.replace(/,/g, '') ||
        null;
      const thursdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['18']?.replace(/,/g, '') ||
        null;
      const fridayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['19']?.replace(/,/g, '') ||
        null;
      const saturdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['20']?.replace(/,/g, '') ||
        null;

      // https://app.clickup.com/t/86etzchey
      const filDayWFormEva =
        eva?.newWeekly
          ?.filter((f: any) => f?.parameter === 'HV')
          ?.filter((f: any) => f?.gasday === e?.gas_day_text)
          ?.filter((f: any) => f?.zone?.name === e?.zone_text)
          ?.filter((f: any) => f?.area?.name === e?.area_text)?.[0] || null;
      // console.log('filDayWFormEva : ', filDayWFormEva);
      // console.log('---------***---------');
      // console.log('e : ', e);
      const findHvsundayHv = filDayWFormEva?.sunday?.value || 0;
      // newWeekly?.find((f: any) => {
      //   return (
      //     f?.['sunday']?.date === e?.gas_day_text && f?.parameter === 'HV'
      //   );
      // })?.['saturday']?.['value'] || 0;
      const findHvmondayHv = filDayWFormEva?.monday?.value || 0;
      // newWeekly?.find((f: any) => {
      //   return (
      //     f?.['monday']?.date ===
      //       dayjs(e?.gas_day_text, 'DD/MM/YYYY')
      //         .add(1, 'day')
      //         .format('DD/MM/YYYY') && f?.parameter === 'HV'
      //   );
      // })?.['monday']?.['value'] || 0;
      const findHvtuesdayHv = filDayWFormEva?.tuesday?.value || 0;
      // newWeekly?.find((f: any) => {
      //   return (
      //     f?.['tuesday']?.date ===
      //       dayjs(e?.gas_day_text, 'DD/MM/YYYY')
      //         .add(2, 'day')
      //         .format('DD/MM/YYYY') && f?.parameter === 'HV'
      //   );
      // })?.['tuesday']?.['value'] || 0;
      const findHvwednesdayHv = filDayWFormEva?.wednesday?.value || 0;
      // newWeekly?.find((f: any) => {
      //   return (
      //     f?.['wednesday']?.date ===
      //       dayjs(e?.gas_day_text, 'DD/MM/YYYY')
      //         .add(3, 'day')
      //         .format('DD/MM/YYYY') && f?.parameter === 'HV'
      //   );
      // })?.['wednesday']?.['value'] || 0;
      const findHvthursdayHv = filDayWFormEva?.thursday?.value || 0;
      // newWeekly?.find((f: any) => {
      //   return (
      //     f?.['thursday']?.date ===
      //       dayjs(e?.gas_day_text, 'DD/MM/YYYY')
      //         .add(4, 'day')
      //         .format('DD/MM/YYYY') && f?.parameter === 'HV'
      //   );
      // })?.['thursday']?.['value'] || 0;
      const findHvfridayHv = filDayWFormEva?.friday?.value || 0;
      // newWeekly?.find((f: any) => {
      //   return (
      //     f?.['friday']?.date ===
      //       dayjs(e?.gas_day_text, 'DD/MM/YYYY')
      //         .add(5, 'day')
      //         .format('DD/MM/YYYY') && f?.parameter === 'HV'
      //   );
      // })?.['friday']?.['value'] || 0;
      const findHvsaturdayHv = filDayWFormEva?.saturday?.value || 0;
      // newWeekly?.find((f: any) => {
      //   return (
      //     f?.['saturday']?.date ===
      //       dayjs(e?.gas_day_text, 'DD/MM/YYYY')
      //         .add(6, 'day')
      //         .format('DD/MM/YYYY') && f?.parameter === 'HV'
      //   );
      // })?.['saturday']?.['value'] || 0;

      const nomPoint = nomData?.find((f: any) => {
        return f?.nomination_point === e['nomination_point'];
      });

      // hv จาก Eva


      const calcWeek = (cap: any, maximum_capacity: any, cHv: any) => {
        if (Number.isFinite((Number(cap ?? 0) / (Number(maximum_capacity ?? 0) * Number(cHv ?? 0))) * 100)) {
          return (Number(cap ?? 0) / (Number(maximum_capacity ?? 0) * Number(cHv ?? 0))) * 100
        } else {
          return 0
        }
      }

      const dayWeek = {
        sunday: e['nomination_row_json']?.['data_temp']?.['14'] || 0,
        sunday_utilization: calcWeek(sundayTotalCap, nomPoint?.maximum_capacity, findHvsundayHv),
        monday: e['nomination_row_json']?.['data_temp']?.['15'] || 0,
        monday_utilization: calcWeek(mondayTotalCap, nomPoint?.maximum_capacity, findHvmondayHv),
        tuesday: e['nomination_row_json']?.['data_temp']?.['16'] || 0,
        tuesday_utilization: calcWeek(tuesdayTotalCap, nomPoint?.maximum_capacity, findHvtuesdayHv),
        wednesday: e['nomination_row_json']?.['data_temp']?.['17'] || 0,
        wednesday_utilization: calcWeek(wednesdayTotalCap, nomPoint?.maximum_capacity, findHvwednesdayHv),
        thursday: e['nomination_row_json']?.['data_temp']?.['18'] || 0,
        thursday_utilization: calcWeek(thursdayTotalCap, nomPoint?.maximum_capacity, findHvthursdayHv),
        friday: e['nomination_row_json']?.['data_temp']?.['19'] || 0,
        friday_utilization: calcWeek(fridayTotalCap, nomPoint?.maximum_capacity, findHvfridayHv),
        saturday: e['nomination_row_json']?.['data_temp']?.['20'] || 0,
        saturday_utilization: calcWeek(saturdayTotalCap, nomPoint?.maximum_capacity, findHvsaturdayHv),
      };

      // console.log('1 dayWeek : ', dayWeek);

      return { ...e, ...dayWeek };
    });

    // new calc hv sp
    const wExitMMBTUDtoMMSCFD1 = weeklyArrNomMMBTUD
      ?.filter((f: any) => {
        return f?.entry_exit_id === 2;
      })
      .map((e: any) => {

        const sundayTotalCap =
          e['nomination_row_json']?.['data_temp']?.['14']?.replace(/,/g, '') ||
          null;
        const mondayTotalCap =
          e['nomination_row_json']?.['data_temp']?.['15']?.replace(/,/g, '') ||
          null;
        const tuesdayTotalCap =
          e['nomination_row_json']?.['data_temp']?.['16']?.replace(/,/g, '') ||
          null;
        const wednesdayTotalCap =
          e['nomination_row_json']?.['data_temp']?.['17']?.replace(/,/g, '') ||
          null;
        const thursdayTotalCap =
          e['nomination_row_json']?.['data_temp']?.['18']?.replace(/,/g, '') ||
          null;
        const fridayTotalCap =
          e['nomination_row_json']?.['data_temp']?.['19']?.replace(/,/g, '') ||
          null;
        const saturdayTotalCap =
          e['nomination_row_json']?.['data_temp']?.['20']?.replace(/,/g, '') ||
          null;

        const supplyRef = areaData?.find((f: any) => {
          return (
            f?.name === e?.area_text
          )
        })
        const filDayWFormEva =
          eva?.newWeekly
            ?.filter((f: any) => f?.parameter === 'HV')
            ?.filter((f: any) => f?.gasday === e?.gas_day_text)
            ?.filter((f: any) => f?.zone?.name === supplyRef?.supply_reference_quality_area_by?.zone?.name)
            ?.filter((f: any) => f?.area?.name === supplyRef?.supply_reference_quality_area_by?.name)?.[0] || null;

        // let filDayWFormEva = eva?.newWeekly
        //   ?.filter((f: any) => f?.parameter === 'HV')
        //   ?.filter((f: any) => f?.gasday === e?.gas_day_text)
        //   ?.filter((f: any) => f?.zone?.name === e?.zone_text)
        //   ?.filter((f: any) => f?.area?.name === e?.area_text)?.[0] || null;

        // console.log('----- e : ', e);

        const findHvsundayHv = filDayWFormEva?.sunday?.value || 0;
        const findHvmondayHv = filDayWFormEva?.monday?.value || 0;
        const findHvtuesdayHv = filDayWFormEva?.tuesday?.value || 0;
        const findHvwednesdayHv = filDayWFormEva?.wednesday?.value || 0;
        const findHvthursdayHv = filDayWFormEva?.thursday?.value || 0;
        const findHvfridayHv = filDayWFormEva?.friday?.value || 0;
        const findHvsaturdayHv = filDayWFormEva?.saturday?.value || 0;

        const nomPoint = nomData?.find((f: any) => {
          return f?.nomination_point === e['nomination_point'];
        });

        const calcMMBTUDtoMMSCFD = (key: any, hv: any) => {
          const vl = e['nomination_row_json']?.['data_temp']?.[key]
            ? Number(e['nomination_row_json']?.['data_temp']?.[key])
            : null;
          const calcFD = !!vl && hv !== 0 ? vl / hv : null;
          return calcFD;
        };

        const calcWeek = (cap: any, maximum_capacity: any, cHv: any) => {
          if (Number.isFinite((Number(cap ?? 0) / (Number(maximum_capacity ?? 0) * Number(cHv ?? 0))) * 100)) {
            return (Number(cap ?? 0) / (Number(maximum_capacity ?? 0) * Number(cHv ?? 0))) * 100
          } else {
            return 0
          }
        }

        const dayWeek = {
          gas_day_sunday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
            .add(0, 'day')
            .format('DD/MM/YYYY'),
          sunday: calcMMBTUDtoMMSCFD('14', findHvsundayHv),
          sunday_utilization: calcWeek(sundayTotalCap, nomPoint?.maximum_capacity, findHvsundayHv),
          monday: calcMMBTUDtoMMSCFD('15', findHvmondayHv),
          monday_utilization: calcWeek(mondayTotalCap, nomPoint?.maximum_capacity, findHvmondayHv),
          tuesday: calcMMBTUDtoMMSCFD('16', findHvtuesdayHv),
          tuesday_utilization: calcWeek(tuesdayTotalCap, nomPoint?.maximum_capacity, findHvtuesdayHv),
          wednesday: calcMMBTUDtoMMSCFD('17', findHvwednesdayHv),
          wednesday_utilization: calcWeek(wednesdayTotalCap, nomPoint?.maximum_capacity, findHvwednesdayHv),
          thursday: calcMMBTUDtoMMSCFD('18', findHvthursdayHv),
          thursday_utilization: calcWeek(thursdayTotalCap, nomPoint?.maximum_capacity, findHvthursdayHv),
          friday: calcMMBTUDtoMMSCFD('19', findHvfridayHv),
          friday_utilization: calcWeek(fridayTotalCap, nomPoint?.maximum_capacity, findHvfridayHv),
          saturday: calcMMBTUDtoMMSCFD('20', findHvsaturdayHv),
          saturday_utilization: calcWeek(saturdayTotalCap, nomPoint?.maximum_capacity, findHvsaturdayHv),
        };

        return { ...e, ...dayWeek };
      });

    // console.log('***** weeklyArrNomMMBTUD : ', weeklyArrNomMMBTUD);
    // console.log('***** wExitMMBTUDtoMMSCFD1 : ', wExitMMBTUDtoMMSCFD1);

    wMMSCFD1 = [...wExitMMBTUDtoMMSCFD1, ...wMMSCFD1];


    // cc
    let ccwMMSCFD1 = ccweeklyArrNomMMSCFD.map((e: any) => {
      const sundayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['14']?.replace(/,/g, '') ||
        null;
      const mondayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['15']?.replace(/,/g, '') ||
        null;
      const tuesdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['16']?.replace(/,/g, '') ||
        null;
      const wednesdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['17']?.replace(/,/g, '') ||
        null;
      const thursdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['18']?.replace(/,/g, '') ||
        null;
      const fridayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['19']?.replace(/,/g, '') ||
        null;
      const saturdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['20']?.replace(/,/g, '') ||
        null;
      const nomPoint = nomData?.find((f: any) => {
        return f?.nomination_point === e['nomination_point'];
      });

      const calcWeek = (cap: any, maximum_capacity: any) => {
        if (Number.isFinite((Number(cap ?? 0) / Number(maximum_capacity ?? 0)) * 100)) {
          return (Number(cap ?? 0) / Number(maximum_capacity ?? 0)) * 100
        } else {
          return 0
        }
      }

      const dayWeek = {
        gas_day_sunday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(0, 'day')
          .format('DD/MM/YYYY'),
        sunday: e['nomination_row_json']?.['data_temp']?.['14'] || 0,
        sunday_utilization: calcWeek(sundayTotalCap, nomPoint?.maximum_capacity),
        gas_day_monday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(1, 'day')
          .format('DD/MM/YYYY'),
        monday: e['nomination_row_json']?.['data_temp']?.['15'] || 0,
        monday_utilization: calcWeek(mondayTotalCap, nomPoint?.maximum_capacity),
        gas_day_tuesday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(2, 'day')
          .format('DD/MM/YYYY'),
        tuesday: e['nomination_row_json']?.['data_temp']?.['16'] || 0,
        tuesday_utilization: calcWeek(tuesdayTotalCap, nomPoint?.maximum_capacity),
        gas_day_wednesday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(3, 'day')
          .format('DD/MM/YYYY'),
        wednesday: e['nomination_row_json']?.['data_temp']?.['17'] || 0,
        wednesday_utilization: calcWeek(wednesdayTotalCap, nomPoint?.maximum_capacity),
        gas_day_thursday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(4, 'day')
          .format('DD/MM/YYYY'),
        thursday: e['nomination_row_json']?.['data_temp']?.['18'] || 0,
        thursday_utilization: calcWeek(thursdayTotalCap, nomPoint?.maximum_capacity),
        gas_day_friday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(5, 'day')
          .format('DD/MM/YYYY'),
        friday: e['nomination_row_json']?.['data_temp']?.['19'] || 0,
        friday_utilization: calcWeek(fridayTotalCap, nomPoint?.maximum_capacity),
        gas_day_saturday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(6, 'day')
          .format('DD/MM/YYYY'),
        saturday: e['nomination_row_json']?.['data_temp']?.['20'] || 0,
        saturday_utilization: calcWeek(saturdayTotalCap, nomPoint?.maximum_capacity),
      };

      return { ...e, ...dayWeek };
    });

    // new calc hv
    const ccwMMBTUD1 = ccweeklyArrNomMMBTUD.map((e: any) => {

      const sundayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['14']?.replace(/,/g, '') ||
        null;
      const mondayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['15']?.replace(/,/g, '') ||
        null;
      const tuesdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['16']?.replace(/,/g, '') ||
        null;
      const wednesdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['17']?.replace(/,/g, '') ||
        null;
      const thursdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['18']?.replace(/,/g, '') ||
        null;
      const fridayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['19']?.replace(/,/g, '') ||
        null;
      const saturdayTotalCap =
        e['nomination_row_json']?.['data_temp']?.['20']?.replace(/,/g, '') ||
        null;

      const filDayWFormEva = eva?.newWeekly
        ?.filter((f: any) => f?.parameter === 'HV')
        ?.filter((f: any) => f?.gasday === e?.gas_day_text)
        ?.filter((f: any) => f?.zone?.name === e?.zone_text)
        ?.filter((f: any) => f?.area?.name === e?.area_text)?.[0] || null;

      const findHvsundayHv = filDayWFormEva?.sunday?.value || 0;
      const findHvmondayHv = filDayWFormEva?.monday?.value || 0;
      const findHvtuesdayHv = filDayWFormEva?.tuesday?.value || 0;
      const findHvwednesdayHv = filDayWFormEva?.wednesday?.value || 0;
      const findHvthursdayHv = filDayWFormEva?.thursday?.value || 0;
      const findHvfridayHv = filDayWFormEva?.friday?.value || 0;
      const findHvsaturdayHv = filDayWFormEva?.saturday?.value || 0;

      const nomPoint = nomData?.find((f: any) => {
        return f?.nomination_point === e['nomination_point'];
      });

      const calcWeek = (cap: any, maximum_capacity: any, cHv: any) => {
        if (Number.isFinite((Number(cap ?? 0) / (Number(maximum_capacity ?? 0) * Number(cHv ?? 0))) * 100)) {
          return (Number(cap ?? 0) / (Number(maximum_capacity ?? 0) * Number(cHv ?? 0))) * 100
        } else {
          return 0
        }
      }

      const dayWeek = {
        gas_day_sunday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(0, 'day')
          .format('DD/MM/YYYY'),
        sunday: e['nomination_row_json']?.['data_temp']?.['14'] || 0,
        sunday_utilization: calcWeek(sundayTotalCap, nomPoint?.maximum_capacity, findHvsundayHv),
        gas_day_monday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(1, 'day')
          .format('DD/MM/YYYY'),
        monday: e['nomination_row_json']?.['data_temp']?.['15'] || 0,
        monday_utilization: calcWeek(mondayTotalCap, nomPoint?.maximum_capacity, findHvmondayHv),
        gas_day_tuesday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(2, 'day')
          .format('DD/MM/YYYY'),
        tuesday: e['nomination_row_json']?.['data_temp']?.['16'] || 0,
        tuesday_utilization: calcWeek(tuesdayTotalCap, nomPoint?.maximum_capacity, findHvtuesdayHv),
        gas_day_wednesday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(3, 'day')
          .format('DD/MM/YYYY'),
        wednesday: e['nomination_row_json']?.['data_temp']?.['17'] || 0,
        wednesday_utilization: calcWeek(wednesdayTotalCap, nomPoint?.maximum_capacity, findHvwednesdayHv),
        gas_day_thursday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(4, 'day')
          .format('DD/MM/YYYY'),
        thursday: e['nomination_row_json']?.['data_temp']?.['18'] || 0,
        thursday_utilization: calcWeek(thursdayTotalCap, nomPoint?.maximum_capacity, findHvthursdayHv),
        gas_day_friday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(5, 'day')
          .format('DD/MM/YYYY'),
        friday: e['nomination_row_json']?.['data_temp']?.['19'] || 0,
        friday_utilization: calcWeek(fridayTotalCap, nomPoint?.maximum_capacity, findHvfridayHv),
        gas_day_saturday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(6, 'day')
          .format('DD/MM/YYYY'),
        saturday: e['nomination_row_json']?.['data_temp']?.['20'] || 0,
        saturday_utilization: calcWeek(saturdayTotalCap, nomPoint?.maximum_capacity, findHvsaturdayHv),
      };


      // const calcWeek = (cap:any, maximum_capacity:any) => {
      //     if(Number.isFinite((Number(cap ?? 0) / Number(maximum_capacity ?? 0)) * 100)){
      //       return (Number(cap ?? 0) / Number(maximum_capacity ?? 0)) * 100
      //     }else{
      //       return 0
      //     }
      //   }

      // const dayWeek = {
      //   gas_day_sunday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
      //     .add(0, 'day')
      //     .format('DD/MM/YYYY'),
      //   sunday: e['nomination_row_json']?.['data_temp']?.['14'] || 0,
      //   sunday_utilization: calcWeek(sundayTotalCap, nomPoint?.maximum_capacity),
      //   gas_day_monday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
      //   .add(1, 'day')
      //   .format('DD/MM/YYYY'),
      //   monday: e['nomination_row_json']?.['data_temp']?.['15'] || 0,
      //   monday_utilization: calcWeek(mondayTotalCap, nomPoint?.maximum_capacity),
      //   gas_day_tuesday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
      //   .add(2, 'day')
      //   .format('DD/MM/YYYY'),
      //   tuesday: e['nomination_row_json']?.['data_temp']?.['16'] || 0,
      //   tuesday_utilization: calcWeek(tuesdayTotalCap, nomPoint?.maximum_capacity),
      //   gas_day_wednesday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
      //   .add(3, 'day')
      //   .format('DD/MM/YYYY'),
      //   wednesday: e['nomination_row_json']?.['data_temp']?.['17'] || 0,
      //   wednesday_utilization: calcWeek(wednesdayTotalCap, nomPoint?.maximum_capacity),
      //   gas_day_thursday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
      //   .add(4, 'day')
      //   .format('DD/MM/YYYY'),
      //   thursday: e['nomination_row_json']?.['data_temp']?.['18'] || 0,
      //   thursday_utilization: calcWeek(thursdayTotalCap, nomPoint?.maximum_capacity),
      //   gas_day_friday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
      //   .add(5, 'day')
      //   .format('DD/MM/YYYY'),
      //   friday: e['nomination_row_json']?.['data_temp']?.['19'] || 0,
      //   friday_utilization: calcWeek(fridayTotalCap, nomPoint?.maximum_capacity),
      //   gas_day_saturday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
      //   .add(6, 'day')
      //   .format('DD/MM/YYYY'),
      //   saturday: e['nomination_row_json']?.['data_temp']?.['20'] || 0,
      //   saturday_utilization: calcWeek(saturdayTotalCap, nomPoint?.maximum_capacity),
      // };

      return { ...e, ...dayWeek };
    });

    // new calc hv sp
    const ccwExitMMBTUDtoMMSCFD1 = ccweeklyArrNomMMBTUD
      ?.filter((f: any) => {
        return f?.entry_exit_id === 2;
      })
      .map((e: any) => {

        const sundayTotalCap =
          e['nomination_row_json']?.['data_temp']?.['14']?.replace(/,/g, '') ||
          null;
        const mondayTotalCap =
          e['nomination_row_json']?.['data_temp']?.['15']?.replace(/,/g, '') ||
          null;
        const tuesdayTotalCap =
          e['nomination_row_json']?.['data_temp']?.['16']?.replace(/,/g, '') ||
          null;
        const wednesdayTotalCap =
          e['nomination_row_json']?.['data_temp']?.['17']?.replace(/,/g, '') ||
          null;
        const thursdayTotalCap =
          e['nomination_row_json']?.['data_temp']?.['18']?.replace(/,/g, '') ||
          null;
        const fridayTotalCap =
          e['nomination_row_json']?.['data_temp']?.['19']?.replace(/,/g, '') ||
          null;
        const saturdayTotalCap =
          e['nomination_row_json']?.['data_temp']?.['20']?.replace(/,/g, '') ||
          null;

        // https://app.clickup.com/t/86etzchey // https://app.clickup.com/t/86etzchep
        const supplyRef = areaData?.find((f: any) => {

          return (
            f?.name === e?.area_text
          )
        })
        const filDayWFormEva =
          eva?.newWeekly
            ?.filter((f: any) => f?.parameter === 'HV')
            ?.filter((f: any) => f?.gasday === e?.gas_day_text)
            ?.filter((f: any) => f?.zone?.name === supplyRef?.supply_reference_quality_area_by?.zone?.name)
            ?.filter((f: any) => f?.area?.name === supplyRef?.supply_reference_quality_area_by?.name)?.[0] || null;
        // let filDayWFormEva =
        //   eva?.newWeekly
        //     ?.filter((f: any) => f?.parameter === 'HV')
        //     ?.filter((f: any) => f?.gasday === e?.gas_day_text)
        //     ?.filter((f: any) => f?.zone?.name === e?.zone_text)
        //     ?.filter((f: any) => f?.area?.name === e?.area_text)?.[0] || null;
        // console.log('e : ', e);
        const findHvsundayHv = filDayWFormEva?.sunday?.value || 0;
        // newWeekly?.find((f: any) => {
        //   return (
        //     f?.['sunday']?.date === e?.gas_day_text && f?.parameter === 'HV'
        //   );
        // })?.['saturday']?.['value'] || 0;
        const findHvmondayHv = filDayWFormEva?.monday?.value || 0;
        // newWeekly?.find((f: any) => {
        //   return (
        //     f?.['monday']?.date ===
        //       dayjs(e?.gas_day_text, 'DD/MM/YYYY')
        //         .add(1, 'day')
        //         .format('DD/MM/YYYY') && f?.parameter === 'HV'
        //   );
        // })?.['monday']?.['value'] || 0;
        const findHvtuesdayHv = filDayWFormEva?.tuesday?.value || 0;
        // newWeekly?.find((f: any) => {
        //   return (
        //     f?.['tuesday']?.date ===
        //       dayjs(e?.gas_day_text, 'DD/MM/YYYY')
        //         .add(2, 'day')
        //         .format('DD/MM/YYYY') && f?.parameter === 'HV'
        //   );
        // })?.['tuesday']?.['value'] || 0;
        const findHvwednesdayHv = filDayWFormEva?.wednesday?.value || 0;
        // newWeekly?.find((f: any) => {
        //   return (
        //     f?.['wednesday']?.date ===
        //       dayjs(e?.gas_day_text, 'DD/MM/YYYY')
        //         .add(3, 'day')
        //         .format('DD/MM/YYYY') && f?.parameter === 'HV'
        //   );
        // })?.['wednesday']?.['value'] || 0;
        const findHvthursdayHv = filDayWFormEva?.thursday?.value || 0;
        // newWeekly?.find((f: any) => {
        //   return (
        //     f?.['thursday']?.date ===
        //       dayjs(e?.gas_day_text, 'DD/MM/YYYY')
        //         .add(4, 'day')
        //         .format('DD/MM/YYYY') && f?.parameter === 'HV'
        //   );
        // })?.['thursday']?.['value'] || 0;
        const findHvfridayHv = filDayWFormEva?.friday?.value || 0;
        // newWeekly?.find((f: any) => {
        //   return (
        //     f?.['friday']?.date ===
        //       dayjs(e?.gas_day_text, 'DD/MM/YYYY')
        //         .add(5, 'day')
        //         .format('DD/MM/YYYY') && f?.parameter === 'HV'
        //   );
        // })?.['friday']?.['value'] || 0;
        const findHvsaturdayHv = filDayWFormEva?.saturday?.value || 0;
        // newWeekly?.find((f: any) => {
        //   return (
        //     f?.['saturday']?.date ===
        //       dayjs(e?.gas_day_text, 'DD/MM/YYYY')
        //         .add(6, 'day')
        //         .format('DD/MM/YYYY') && f?.parameter === 'HV'
        //   );
        // })?.['saturday']?.['value'] || 0;

        const nomPoint = nomData?.find((f: any) => {
          return f?.nomination_point === e['nomination_point'];
        });

        const calcWeek = (cap: any, maximum_capacity: any, cHv: any) => {
          if (Number.isFinite((Number(cap ?? 0) / (Number(maximum_capacity ?? 0) * Number(cHv ?? 0))) * 100)) {
            return (Number(cap ?? 0) / (Number(maximum_capacity ?? 0) * Number(cHv ?? 0))) * 100
          } else {
            return 0
          }
        }
        const dayWeek = {
          sunday: e['nomination_row_json']?.['data_temp']?.['14'] || 0,
          sunday_utilization: calcWeek(sundayTotalCap, nomPoint?.maximum_capacity, findHvsundayHv),
          monday: e['nomination_row_json']?.['data_temp']?.['15'] || 0,
          monday_utilization: calcWeek(mondayTotalCap, nomPoint?.maximum_capacity, findHvmondayHv),
          tuesday: e['nomination_row_json']?.['data_temp']?.['16'] || 0,
          tuesday_utilization: calcWeek(tuesdayTotalCap, nomPoint?.maximum_capacity, findHvtuesdayHv),
          wednesday: e['nomination_row_json']?.['data_temp']?.['17'] || 0,
          wednesday_utilization: calcWeek(wednesdayTotalCap, nomPoint?.maximum_capacity, findHvwednesdayHv),
          thursday: e['nomination_row_json']?.['data_temp']?.['18'] || 0,
          thursday_utilization: calcWeek(thursdayTotalCap, nomPoint?.maximum_capacity, findHvthursdayHv),
          friday: e['nomination_row_json']?.['data_temp']?.['19'] || 0,
          friday_utilization: calcWeek(fridayTotalCap, nomPoint?.maximum_capacity, findHvfridayHv),
          saturday: e['nomination_row_json']?.['data_temp']?.['20'] || 0,
          saturday_utilization: calcWeek(saturdayTotalCap, nomPoint?.maximum_capacity, findHvsaturdayHv),
        };

        return { ...e, ...dayWeek };
      });
    ccwMMSCFD1 = [...ccwExitMMBTUDtoMMSCFD1, ...ccwMMSCFD1];

    // -----

    const groupByKeys = (item: any) =>
      `${item.gas_day_text}${item.nomination_point}`;

    const horuss = [
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
    // console.log('))))dMMSCFD1 : ', dMMSCFD1);
    const dMMSCFD: any = Object.values(
      dMMSCFD1.reduce(
        (acc, item) => {
          const key = groupByKeys(item);

          if (!acc[key]) {
            // clone object สำหรับกลุ่มใหม่
            acc[key] = { ...item, id: key };
          } else {
            for (const day of horuss) {
              // รวมค่า number ในแต่ละวัน (string → number → string)
              acc[key]['id'] = key;
              const base = parseFloat(
                (acc[key][day] || '0').toString().replace(/,/g, '').trim(),
              );
              const current = parseFloat(
                (item[day] || '0').toString().replace(/,/g, '').trim(),
              );
              acc[key][day] = (base + current).toFixed(3).padStart(8, ' '); // จัด spacing เหมือนเดิม
            }
          }

          return acc;
        },
        {} as Record<string, any>,
      ),
    );
    const dMMBTUD: any = Object.values(
      dMMBTUD1.reduce(
        (acc, item) => {
          const key = groupByKeys(item);

          if (!acc[key]) {
            // clone object สำหรับกลุ่มใหม่
            acc[key] = { ...item, id: key };
          } else {
            for (const day of horuss) {
              // รวมค่า number ในแต่ละวัน (string → number → string)
              acc[key]['id'] = key;
              const base = parseFloat(
                (acc[key][day] || '0').toString().replace(/,/g, '').trim(),
              );
              const current = parseFloat(
                (item[day] || '0').toString().replace(/,/g, '').trim(),
              );
              acc[key][day] = (base + current).toFixed(3).padStart(8, ' '); // จัด spacing เหมือนเดิม
            }
          }

          return acc;
        },
        {} as Record<string, any>,
      ),
    );

    // cc
    const ccdMMSCFD: any = Object.values(
      ccdMMSCFD1.reduce(
        (acc, item) => {
          const key = groupByKeys(item);

          if (!acc[key]) {
            // clone object สำหรับกลุ่มใหม่
            acc[key] = { ...item, id: key };
          } else {
            for (const day of horuss) {
              // รวมค่า number ในแต่ละวัน (string → number → string)
              acc[key]['id'] = key;
              const base = parseFloat(
                (acc[key][day] || '0').toString().replace(/,/g, '').trim(),
              );
              const current = parseFloat(
                (item[day] || '0').toString().replace(/,/g, '').trim(),
              );
              acc[key][day] = (base + current).toFixed(3).padStart(8, ' '); // จัด spacing เหมือนเดิม
            }
          }

          return acc;
        },
        {} as Record<string, any>,
      ),
    );
    //
    const ccdMMBTUD: any = Object.values(
      ccdMMBTUD1.reduce(
        (acc, item) => {
          const key = groupByKeys(item);

          if (!acc[key]) {
            // clone object สำหรับกลุ่มใหม่
            acc[key] = { ...item, id: key };
          } else {
            for (const day of horuss) {
              // รวมค่า number ในแต่ละวัน (string → number → string)
              acc[key]['id'] = key;
              const base = parseFloat(
                (acc[key][day] || '0').toString().replace(/,/g, '').trim(),
              );
              const current = parseFloat(
                (item[day] || '0').toString().replace(/,/g, '').trim(),
              );
              acc[key][day] = (base + current).toFixed(3).padStart(8, ' '); // จัด spacing เหมือนเดิม
            }
          }

          return acc;
        },
        {} as Record<string, any>,
      ),
    );

    const days = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];

    const wMMSCFD: any = Object.values(
      wMMSCFD1.reduce(
        (acc, item) => {
          const key = groupByKeys(item);

          if (!acc[key]) {
            // clone object สำหรับกลุ่มใหม่
            // acc[key] = { ...item, id: key };
            acc[key] = {
              ...(acc[key] || {}), // ดึงค่าเดิมไว้ก่อน
              ...item,
              id: key,
            };
          } else {
            for (const day of days) {
              // รวมค่า number ในแต่ละวัน (string → number → string)
              acc[key]['id'] = key;
              const base = parseFloat(
                (acc[key][day] || '0').toString().replace(/,/g, '').trim(),
              );
              const current = parseFloat(
                (item[day] || '0').toString().replace(/,/g, '').trim(),
              );
              acc[key][day] = (base + current).toFixed(3).padStart(8, ' '); // จัด spacing เหมือนเดิม

              // รวม utilization
              acc[key][`${day}_utilization`] += item[`${day}_utilization`];
              acc[key][`${day}_utilization`] =
                +acc[key][`${day}_utilization`].toFixed(2); // ปัดทศนิยม
            }
          }

          return acc;
        },
        {} as Record<string, any>,
      ),
    );

    const allwMMSCFD = wMMSCFD?.map((all: any) => {
      const {
        nomination_type_id,
        nomination_code,
        contract_code_id,
        group_id,
        query_shipper_nomination_file_renom_id,
        submitted_timestamp,
        nomination_full_json,
        nomination_row_json,
        unix,
        query_shipper_nomination_type_id,
        query_shipper_nomination_type,
        entry_exit_id,
        nomination_point,
        area_text,
        zone_text,
        id,
        parkUnparkInstructedFlows,
        customerType,
        units,
        wi,
        hv,
        sg,
      } = all;

      const checkDy = getTodayNowDDMMYYYYDfault(gas_day_text).day();
      // console.log('checkDy : ', checkDy);
      // console.log(Object.keys(all));
      let totalW = null;
      let utilizationW = null;

      switch (checkDy) {
        case 0:
          totalW = all?.sunday || 0;
          utilizationW = all?.sunday_utilization || 0;
          break;

        case 1:
          totalW = all?.monday || 0;
          utilizationW = all?.monday_utilization || 0;
          break;

        case 2:
          totalW = all?.tuesday || 0;
          utilizationW = all?.tuesday_utilization || 0;
          break;

        case 3:
          totalW = all?.wednesday || 0;
          utilizationW = all?.wednesday_utilization || 0;
          break;

        case 4:
          totalW = all?.thursday || 0;
          utilizationW = all?.thursday_utilization || 0;
          break;

        case 5:
          totalW = all?.friday || 0;
          utilizationW = all?.friday_utilization || 0;
          break;

        case 6:
          totalW = all?.saturday || 0;
          utilizationW = all?.saturday_utilization || 0;
          break;

        default:
          break;
      }

      return {
        nomination_type_id,
        nomination_code,
        contract_code_id,
        group_id,
        query_shipper_nomination_file_renom_id,
        submitted_timestamp,
        nomination_full_json,
        nomination_row_json,
        unix,
        query_shipper_nomination_type_id,
        query_shipper_nomination_type,
        entry_exit_id,
        nomination_point,
        area_text,
        zone_text,
        id,
        parkUnparkInstructedFlows,
        customerType,
        units,
        wi,
        hv,
        sg,
        gas_day: getTodayNowDDMMYYYYDfault(gas_day_text).toDate(),
        gas_day_text: gas_day_text,
        totalCap: totalW,
        utilization: utilizationW,
        H1: totalW / 24 || 0,
        H2: totalW / 24 || 0,
        H3: totalW / 24 || 0,
        H4: totalW / 24 || 0,
        H5: totalW / 24 || 0,
        H6: totalW / 24 || 0,
        H7: totalW / 24 || 0,
        H8: totalW / 24 || 0,
        H9: totalW / 24 || 0,
        H10: totalW / 24 || 0,
        H11: totalW / 24 || 0,
        H12: totalW / 24 || 0,
        H13: totalW / 24 || 0,
        H14: totalW / 24 || 0,
        H15: totalW / 24 || 0,
        H16: totalW / 24 || 0,
        H17: totalW / 24 || 0,
        H18: totalW / 24 || 0,
        H19: totalW / 24 || 0,
        H20: totalW / 24 || 0,
        H21: totalW / 24 || 0,
        H22: totalW / 24 || 0,
        H23: totalW / 24 || 0,
        H24: totalW / 24 || 0,
        total: totalW,
      };
    });

    const wMMBTUD: any = Object.values(
      wMMBTUD1.reduce(
        (acc, item) => {
          const key = groupByKeys(item);

          if (!acc[key]) {
            // clone object สำหรับกลุ่มใหม่
            acc[key] = { ...item, id: key, gas_day_text: item['gas_day_text'] };
          } else {
            for (const day of days) {
              // รวมค่า number ในแต่ละวัน (string → number → string)
              acc[key]['id'] = key;
              acc[key]['gas_day_text'] = item['gas_day_text'];
              const base = parseFloat(
                (acc[key][day] || '0').toString().replace(/,/g, '').trim(),
              );
              const current = parseFloat(
                (item[day] || '0').toString().replace(/,/g, '').trim(),
              );
              acc[key][day] = (base + current).toFixed(3).padStart(8, ' '); // จัด spacing เหมือนเดิม

              // รวม utilization
              acc[key][`${day}_utilization`] += item[`${day}_utilization`];
              acc[key][`${day}_utilization`] =
                +acc[key][`${day}_utilization`].toFixed(2); // ปัดทศนิยม
            }
          }

          return acc;
        },
        {} as Record<string, any>,
      ),
    );

    // console.log('wMMBTUD : ', wMMBTUD);

    const allwMMBTUD = wMMBTUD?.map((all: any) => {
      const {
        nomination_type_id,
        nomination_code,
        contract_code_id,
        group_id,
        query_shipper_nomination_file_renom_id,
        submitted_timestamp,
        nomination_full_json,
        nomination_row_json,
        unix,
        query_shipper_nomination_type_id,
        query_shipper_nomination_type,
        entry_exit_id,
        nomination_point,
        area_text,
        zone_text,
        id,
        parkUnparkInstructedFlows,
        customerType,
        units,
        wi,
        hv,
        sg,
      } = all;

      const checkDy = getTodayNowDDMMYYYYDfault(gas_day_text).day();
      // console.log('checkDy : ', checkDy);
      // console.log(Object.keys(all));
      let totalW = null;
      let utilizationW = null;

      switch (checkDy) {
        case 0:
          totalW = all?.sunday || 0;
          utilizationW = all?.sunday_utilization || 0;
          break;

        case 1:
          totalW = all?.monday || 0;
          utilizationW = all?.monday_utilization || 0;
          break;

        case 2:
          totalW = all?.tuesday || 0;
          utilizationW = all?.tuesday_utilization || 0;
          break;

        case 3:
          totalW = all?.wednesday || 0;
          utilizationW = all?.wednesday_utilization || 0;
          break;

        case 4:
          totalW = all?.thursday || 0;
          utilizationW = all?.thursday_utilization || 0;
          break;

        case 5:
          totalW = all?.friday || 0;
          utilizationW = all?.friday_utilization || 0;
          break;

        case 6:
          totalW = all?.saturday || 0;
          utilizationW = all?.saturday_utilization || 0;
          break;

        default:
          break;
      }

      return {
        nomination_type_id,
        nomination_code,
        contract_code_id,
        group_id,
        query_shipper_nomination_file_renom_id,
        submitted_timestamp,
        nomination_full_json,
        nomination_row_json,
        unix,
        query_shipper_nomination_type_id,
        query_shipper_nomination_type,
        entry_exit_id,
        nomination_point,
        area_text,
        zone_text,
        id,
        parkUnparkInstructedFlows,
        customerType,
        units,
        wi,
        hv,
        sg,
        gas_day: getTodayNowDDMMYYYYDfault(gas_day_text).toDate(),
        gas_day_text: gas_day_text,
        totalCap: totalW,
        utilization: utilizationW,
        H1: totalW / 24 || 0,
        H2: totalW / 24 || 0,
        H3: totalW / 24 || 0,
        H4: totalW / 24 || 0,
        H5: totalW / 24 || 0,
        H6: totalW / 24 || 0,
        H7: totalW / 24 || 0,
        H8: totalW / 24 || 0,
        H9: totalW / 24 || 0,
        H10: totalW / 24 || 0,
        H11: totalW / 24 || 0,
        H12: totalW / 24 || 0,
        H13: totalW / 24 || 0,
        H14: totalW / 24 || 0,
        H15: totalW / 24 || 0,
        H16: totalW / 24 || 0,
        H17: totalW / 24 || 0,
        H18: totalW / 24 || 0,
        H19: totalW / 24 || 0,
        H20: totalW / 24 || 0,
        H21: totalW / 24 || 0,
        H22: totalW / 24 || 0,
        H23: totalW / 24 || 0,
        H24: totalW / 24 || 0,
        total: totalW,
      };
    });

    const ccwMMSCFD: any = Object.values(
      ccwMMSCFD1.reduce(
        (acc, item) => {
          const key = groupByKeys(item);

          if (!acc[key]) {
            // clone object สำหรับกลุ่มใหม่
            acc[key] = { ...item, id: key };
          } else {
            for (const day of days) {
              // รวมค่า number ในแต่ละวัน (string → number → string)
              acc[key]['id'] = key;
              const base = parseFloat(
                (acc[key][day] || '0').toString().replace(/,/g, '').trim(),
              );
              const current = parseFloat(
                (item[day] || '0').toString().replace(/,/g, '').trim(),
              );
              acc[key][day] = (base + current).toFixed(3).padStart(8, ' '); // จัด spacing เหมือนเดิม

              // รวม utilization
              acc[key][`${day}_utilization`] += item[`${day}_utilization`];
              acc[key][`${day}_utilization`] =
                +acc[key][`${day}_utilization`].toFixed(2); // ปัดทศนิยม
            }
          }

          return acc;
        },
        {} as Record<string, any>,
      ),
    );

    const allccwMMSCFD = ccwMMSCFD?.map((all: any) => {
      const {
        nomination_type_id,
        nomination_code,
        contract_code_id,
        group_id,
        query_shipper_nomination_file_renom_id,
        submitted_timestamp,
        nomination_full_json,
        nomination_row_json,
        unix,
        query_shipper_nomination_type_id,
        query_shipper_nomination_type,
        entry_exit_id,
        nomination_point,
        area_text,
        zone_text,
        id,
        parkUnparkInstructedFlows,
        customerType,
        units,
        wi,
        hv,
        sg,
      } = all;

      const checkDy = getTodayNowDDMMYYYYDfault(gas_day_text).day();
      // console.log('checkDy : ', checkDy);
      // console.log(Object.keys(all));
      let totalW = null;
      let utilizationW = null;

      switch (checkDy) {
        case 0:
          totalW = all?.sunday || 0;
          utilizationW = all?.sunday_utilization || 0;
          break;

        case 1:
          totalW = all?.monday || 0;
          utilizationW = all?.monday_utilization || 0;
          break;

        case 2:
          totalW = all?.tuesday || 0;
          utilizationW = all?.tuesday_utilization || 0;
          break;

        case 3:
          totalW = all?.wednesday || 0;
          utilizationW = all?.wednesday_utilization || 0;
          break;

        case 4:
          totalW = all?.thursday || 0;
          utilizationW = all?.thursday_utilization || 0;
          break;

        case 5:
          totalW = all?.friday || 0;
          utilizationW = all?.friday_utilization || 0;
          break;

        case 6:
          totalW = all?.saturday || 0;
          utilizationW = all?.saturday_utilization || 0;
          break;

        default:
          break;
      }

      return {
        nomination_type_id,
        nomination_code,
        contract_code_id,
        group_id,
        query_shipper_nomination_file_renom_id,
        submitted_timestamp,
        nomination_full_json,
        nomination_row_json,
        unix,
        query_shipper_nomination_type_id,
        query_shipper_nomination_type,
        entry_exit_id,
        nomination_point,
        area_text,
        zone_text,
        id,
        parkUnparkInstructedFlows,
        customerType,
        units,
        wi,
        hv,
        sg,
        gas_day: getTodayNowDDMMYYYYDfault(gas_day_text).toDate(),
        gas_day_text: gas_day_text,
        totalCap: totalW,
        utilization: utilizationW,
        H1: totalW / 24 || 0,
        H2: totalW / 24 || 0,
        H3: totalW / 24 || 0,
        H4: totalW / 24 || 0,
        H5: totalW / 24 || 0,
        H6: totalW / 24 || 0,
        H7: totalW / 24 || 0,
        H8: totalW / 24 || 0,
        H9: totalW / 24 || 0,
        H10: totalW / 24 || 0,
        H11: totalW / 24 || 0,
        H12: totalW / 24 || 0,
        H13: totalW / 24 || 0,
        H14: totalW / 24 || 0,
        H15: totalW / 24 || 0,
        H16: totalW / 24 || 0,
        H17: totalW / 24 || 0,
        H18: totalW / 24 || 0,
        H19: totalW / 24 || 0,
        H20: totalW / 24 || 0,
        H21: totalW / 24 || 0,
        H22: totalW / 24 || 0,
        H23: totalW / 24 || 0,
        H24: totalW / 24 || 0,
        total: totalW,
      };
    });

    const ccwMMBTUD: any = Object.values(
      ccwMMBTUD1.reduce(
        (acc, item) => {
          const key = groupByKeys(item);

          if (!acc[key]) {
            // clone object สำหรับกลุ่มใหม่
            acc[key] = { ...item, id: key, gas_day_text: item['gas_day_text'] };
          } else {
            for (const day of days) {
              // รวมค่า number ในแต่ละวัน (string → number → string)
              acc[key]['id'] = key;
              acc[key]['gas_day_text'] = item['gas_day_text'];
              const base = parseFloat(
                (acc[key][day] || '0').toString().replace(/,/g, '').trim(),
              );
              const current = parseFloat(
                (item[day] || '0').toString().replace(/,/g, '').trim(),
              );
              acc[key][day] = (base + current).toFixed(3).padStart(8, ' '); // จัด spacing เหมือนเดิม

              // รวม utilization
              acc[key][`${day}_utilization`] += item[`${day}_utilization`];
              acc[key][`${day}_utilization`] =
                +acc[key][`${day}_utilization`].toFixed(2); // ปัดทศนิยม
            }
          }

          return acc;
        },
        {} as Record<string, any>,
      ),
    );

    const allccwMMBTUD = ccwMMBTUD?.map((all: any) => {
      const {
        nomination_type_id,
        nomination_code,
        contract_code_id,
        group_id,
        query_shipper_nomination_file_renom_id,
        submitted_timestamp,
        nomination_full_json,
        nomination_row_json,
        unix,
        query_shipper_nomination_type_id,
        query_shipper_nomination_type,
        entry_exit_id,
        nomination_point,
        area_text,
        zone_text,
        id,
        parkUnparkInstructedFlows,
        customerType,
        units,
        wi,
        hv,
        sg,
      } = all;

      const checkDy = getTodayNowDDMMYYYYDfault(gas_day_text).day();
      // console.log('checkDy : ', checkDy);
      // console.log(Object.keys(all));
      let totalW = null;
      let utilizationW = null;

      switch (checkDy) {
        case 0:
          totalW = all?.sunday || 0;
          utilizationW = all?.sunday_utilization || 0;
          break;

        case 1:
          totalW = all?.monday || 0;
          utilizationW = all?.monday_utilization || 0;
          break;

        case 2:
          totalW = all?.tuesday || 0;
          utilizationW = all?.tuesday_utilization || 0;
          break;

        case 3:
          totalW = all?.wednesday || 0;
          utilizationW = all?.wednesday_utilization || 0;
          break;

        case 4:
          totalW = all?.thursday || 0;
          utilizationW = all?.thursday_utilization || 0;
          break;

        case 5:
          totalW = all?.friday || 0;
          utilizationW = all?.friday_utilization || 0;
          break;

        case 6:
          totalW = all?.saturday || 0;
          utilizationW = all?.saturday_utilization || 0;
          break;

        default:
          break;
      }

      return {
        nomination_type_id,
        nomination_code,
        contract_code_id,
        group_id,
        query_shipper_nomination_file_renom_id,
        submitted_timestamp,
        nomination_full_json,
        nomination_row_json,
        unix,
        query_shipper_nomination_type_id,
        query_shipper_nomination_type,
        entry_exit_id,
        nomination_point,
        area_text,
        zone_text,
        id,
        parkUnparkInstructedFlows,
        customerType,
        units,
        wi,
        hv,
        sg,
        gas_day: getTodayNowDDMMYYYYDfault(gas_day_text).toDate(),
        gas_day_text: gas_day_text,
        totalCap: totalW,
        utilization: utilizationW,
        H1: totalW / 24 || 0,
        H2: totalW / 24 || 0,
        H3: totalW / 24 || 0,
        H4: totalW / 24 || 0,
        H5: totalW / 24 || 0,
        H6: totalW / 24 || 0,
        H7: totalW / 24 || 0,
        H8: totalW / 24 || 0,
        H9: totalW / 24 || 0,
        H10: totalW / 24 || 0,
        H11: totalW / 24 || 0,
        H12: totalW / 24 || 0,
        H13: totalW / 24 || 0,
        H14: totalW / 24 || 0,
        H15: totalW / 24 || 0,
        H16: totalW / 24 || 0,
        H17: totalW / 24 || 0,
        H18: totalW / 24 || 0,
        H19: totalW / 24 || 0,
        H20: totalW / 24 || 0,
        H21: totalW / 24 || 0,
        H22: totalW / 24 || 0,
        H23: totalW / 24 || 0,
        H24: totalW / 24 || 0,
        total: totalW,
      };
    });

    const dAreaMMBTUD = dMMBTUD.reduce((acc, item) => {
      const key = `${item.gas_day_text}-${item.area_text}`;

      if (!acc[key]) {
        acc[key] = {
          gas_day_text: item.gas_day_text,
          area_text: item.area_text,
          nomination_point: item.nomination_point,
          data: [],
        };
      }

      acc[key].data.push(item);

      return acc;
    }, {});
    const dArea = Object.values(dAreaMMBTUD);
    const dAreaFil = dArea.map((e: any) => {
      const fareaData =
        areaData?.find((f: any) => {
          return f?.name === e?.area_text;
        })?.area_nominal_capacity || 0;
      const totalCap =
        e['data']?.reduce(
          (acc, item) => acc + (Number(item?.total?.replace(/,/g, '')) || 0),
          0,
        ) || 0;

      const hv =
        e['data']?.reduce(
          (acc, item) =>
            acc +
            (item?.['nomination_row_json']?.['data_temp']?.['12']?.replace(
              /,/g,
              '',
            ) || 0),
          0,
        ) || 0;
      const nomPoint = nomData?.find((f: any) => {
        return f?.nomination_point === e['nomination_point'];
      });

      const utilization = (Number(totalCap) / Number(fareaData)) * 100;
      // let utilization = (Number(totalCap) / (Number(nomPoint?.maximum_capacity ?? 0) * Number(hv))) * 100;

      const hourDay = {
        H1: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H1?.replace(/,/g, '')) || 0),
          0,
        ),
        H2: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H2?.replace(/,/g, '')) || 0),
          0,
        ),
        H3: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H3?.replace(/,/g, '')) || 0),
          0,
        ),
        H4: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H4?.replace(/,/g, '')) || 0),
          0,
        ),
        H5: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H5?.replace(/,/g, '')) || 0),
          0,
        ),
        H6: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H6?.replace(/,/g, '')) || 0),
          0,
        ),
        H7: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H7?.replace(/,/g, '')) || 0),
          0,
        ),
        H8: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H8?.replace(/,/g, '')) || 0),
          0,
        ),
        H9: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H9?.replace(/,/g, '')) || 0),
          0,
        ),
        H10: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H10?.replace(/,/g, '')) || 0),
          0,
        ),
        H11: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H11?.replace(/,/g, '')) || 0),
          0,
        ),
        H12: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H12?.replace(/,/g, '')) || 0),
          0,
        ),
        H13: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H13?.replace(/,/g, '')) || 0),
          0,
        ),
        H14: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H14?.replace(/,/g, '')) || 0),
          0,
        ),
        H15: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H15?.replace(/,/g, '')) || 0),
          0,
        ),
        H16: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H16?.replace(/,/g, '')) || 0),
          0,
        ),
        H17: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H17?.replace(/,/g, '')) || 0),
          0,
        ),
        H18: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H18?.replace(/,/g, '')) || 0),
          0,
        ),
        H19: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H19?.replace(/,/g, '')) || 0),
          0,
        ),
        H20: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H20?.replace(/,/g, '')) || 0),
          0,
        ),
        H21: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H21?.replace(/,/g, '')) || 0),
          0,
        ),
        H22: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H22?.replace(/,/g, '')) || 0),
          0,
        ),
        H23: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H23?.replace(/,/g, '')) || 0),
          0,
        ),
        H24: e['data']?.reduce(
          (acc, item) => acc + (Number(item?.H24?.replace(/,/g, '')) || 0),
          0,
        ),
      };

      // delete e["data"]
      const { data, ...nE } = e;
      return { ...nE, totalCap, utilization, ...hourDay };
    });

    const wAreaMMBTUD = wMMBTUD.reduce((acc, item) => {
      const key = `${item.gas_day_text}-${item.area_text}`;

      if (!acc[key]) {
        acc[key] = {
          gas_day_text: item.gas_day_text,
          area_text: item.area_text,
          nomination_point: item.nomination_point,
          data: [],
        };
      }

      acc[key].data.push(item);

      return acc;
    }, {});

    const wArea = Object.values(wAreaMMBTUD);
    const wAreaFil = wArea.map((e: any) => {
      // let hv = e["data"]?.reduce((acc, item) => acc + (item?.["nomination_row_json"]["data_temp"]["12"]?.replace(/,/g, '') || 0), 0) || 0
      // const nomPoint = nomData?.find((f:any) => { return f?.nomination_point === e["nomination_point"] })

      // nomination_code

      const hv =
        e['data']?.reduce(
          (acc, item) =>
            acc +
            (item?.['nomination_row_json']?.['data_temp']?.['12']?.replace(
              /,/g,
              '',
            ) || 0),
          0,
        ) || 0;
      const sundayTotalCap =
        e['data']?.reduce(
          (acc, item) =>
            acc +
            (Number(
              item?.['nomination_row_json']?.['data_temp']?.['14']?.replace(
                /,/g,
                '',
              ),
            ) || 0),
          0,
        ) || null;
      const mondayTotalCap =
        e['data']?.reduce(
          (acc, item) =>
            acc +
            (Number(
              item?.['nomination_row_json']?.['data_temp']?.['15']?.replace(
                /,/g,
                '',
              ),
            ) || 0),
          0,
        ) || null;
      const tuesdayTotalCap =
        e['data']?.reduce(
          (acc, item) =>
            acc +
            (Number(
              item?.['nomination_row_json']?.['data_temp']?.['16']?.replace(
                /,/g,
                '',
              ),
            ) || 0),
          0,
        ) || null;
      const wednesdayTotalCap =
        e['data']?.reduce(
          (acc, item) =>
            acc +
            (Number(
              item?.['nomination_row_json']?.['data_temp']?.['17']?.replace(
                /,/g,
                '',
              ),
            ) || 0),
          0,
        ) || null;
      const thursdayTotalCap =
        e['data']?.reduce(
          (acc, item) =>
            acc +
            (Number(
              item?.['nomination_row_json']?.['data_temp']?.['18']?.replace(
                /,/g,
                '',
              ),
            ) || 0),
          0,
        ) || null;
      const fridayTotalCap =
        e['data']?.reduce(
          (acc, item) =>
            acc +
            (Number(
              item?.['nomination_row_json']?.['data_temp']?.['19']?.replace(
                /,/g,
                '',
              ),
            ) || 0),
          0,
        ) || null;
      const saturdayTotalCap =
        e['data']?.reduce(
          (acc, item) =>
            acc +
            (Number(
              item?.['nomination_row_json']?.['data_temp']?.['20']?.replace(
                /,/g,
                '',
              ),
            ) || 0),
          0,
        ) || null;
      const nomPoint = nomData?.find((f: any) => {
        return f?.nomination_point === e['nomination_point'];
      });
      const fareaData =
        areaData?.find((f: any) => {
          return f?.name === e?.area_text;
        })?.area_nominal_capacity || 0;

      const totalCap =
        [
          sundayTotalCap,
          mondayTotalCap,
          tuesdayTotalCap,
          wednesdayTotalCap,
          thursdayTotalCap,
          fridayTotalCap,
          saturdayTotalCap,
        ]?.reduce((acc, item) => acc + item, 0) || 0;

      const calcWeek = (cap: any, fArea: any) => {
        if (Number.isFinite((Number(cap ?? 0) / Number(fArea)) * 100)) {
          return (Number(cap ?? 0) / Number(fArea)) * 100
        } else {
          return 0
        }
      }

      const dayWeek = {
        gas_day_sunday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(0, 'day')
          .format('DD/MM/YYYY'),
        sunday: sundayTotalCap,
        sunday_utilization: calcWeek(sundayTotalCap, fareaData),
        gas_day_monday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(1, 'day')
          .format('DD/MM/YYYY'),
        monday: mondayTotalCap,
        monday_utilization: calcWeek(sundayTotalCap, fareaData),
        gas_day_tuesday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(2, 'day')
          .format('DD/MM/YYYY'),
        tuesday: tuesdayTotalCap,
        tuesday_utilization: calcWeek(tuesdayTotalCap, fareaData),
        gas_day_wednesday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(3, 'day')
          .format('DD/MM/YYYY'),
        wednesday: wednesdayTotalCap,
        wednesday_utilization: calcWeek(wednesdayTotalCap, fareaData),
        gas_day_thursday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(4, 'day')
          .format('DD/MM/YYYY'),
        thursday: thursdayTotalCap,
        thursday_utilization: calcWeek(thursdayTotalCap, fareaData),
        gas_day_friday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(5, 'day')
          .format('DD/MM/YYYY'),
        friday: fridayTotalCap,
        friday_utilization: calcWeek(fridayTotalCap, fareaData),
        gas_day_saturday: getTodayNowDDMMYYYYDfault(e?.gas_day_text)
          .add(6, 'day')
          .format('DD/MM/YYYY'),
        saturday: saturdayTotalCap,
        saturday_utilization: calcWeek(saturdayTotalCap, fareaData),
      };

      // delete e["data"]
      const { data, ...nE } = e;
      return { ...nE, totalCap, ...dayWeek };
    });

    // console.log('dAreaFil : ', dAreaFil);
    // console.log('wAreaFil : ', wAreaFil);

    const allAreaFil = wAreaFil.map((all: any) => {
      const checkDy = getTodayNowDDMMYYYYDfault(gas_day_text).day();
      // console.log('checkDy : ', checkDy);
      // console.log(Object.keys(all));
      let totalW = null;
      let utilizationW = null;

      switch (checkDy) {
        case 0:
          totalW = all?.sunday || 0;
          utilizationW = all?.sunday_utilization || 0;
          break;

        case 1:
          totalW = all?.monday || 0;
          utilizationW = all?.monday_utilization || 0;
          break;

        case 2:
          totalW = all?.tuesday || 0;
          utilizationW = all?.tuesday_utilization || 0;
          break;

        case 3:
          totalW = all?.wednesday || 0;
          utilizationW = all?.wednesday_utilization || 0;
          break;

        case 4:
          totalW = all?.thursday || 0;
          utilizationW = all?.thursday_utilization || 0;
          break;

        case 5:
          totalW = all?.friday || 0;
          utilizationW = all?.friday_utilization || 0;
          break;

        case 6:
          totalW = all?.saturday || 0;
          utilizationW = all?.saturday_utilization || 0;
          break;

        default:
          break;
      }

      return {
        gas_day_text: gas_day_text,
        area_text: all?.area_text,
        nomination_point: all?.nomination_point,
        totalCap: totalW,
        utilization: utilizationW,
        H1: totalW / 24 || 0,
        H2: totalW / 24 || 0,
        H3: totalW / 24 || 0,
        H4: totalW / 24 || 0,
        H5: totalW / 24 || 0,
        H6: totalW / 24 || 0,
        H7: totalW / 24 || 0,
        H8: totalW / 24 || 0,
        H9: totalW / 24 || 0,
        H10: totalW / 24 || 0,
        H11: totalW / 24 || 0,
        H12: totalW / 24 || 0,
        H13: totalW / 24 || 0,
        H14: totalW / 24 || 0,
        H15: totalW / 24 || 0,
        H16: totalW / 24 || 0,
        H17: totalW / 24 || 0,
        H18: totalW / 24 || 0,
        H19: totalW / 24 || 0,
        H20: totalW / 24 || 0,
        H21: totalW / 24 || 0,
        H22: totalW / 24 || 0,
        H23: totalW / 24 || 0,
        H24: totalW / 24 || 0,
        total: totalW,
      };
    });

    // return {
    //   dAreaFil,
    //   wAreaFil,
    // }
    // -------

    const dImbalanceMMBTUD = dMMBTUD.reduce((acc, item) => {
      const key = `${item.gas_day_text}`;

      if (!acc[key]) {
        acc[key] = {
          gas_day_text: item.gas_day_text,
          data: [],
        };
      }

      acc[key].data.push(item);

      return acc;
    }, {});
    const dImbalanceMMBTUDObj = Object.values(dImbalanceMMBTUD);
    const dImbalance = dImbalanceMMBTUDObj.map((e: any) => {
      // { entryExit: 2, text: 'Park' }
      const tpark = adailyArrNom.filter((f: any) => {
        return f?.nomination_row_json['data_temp']['5'] === 'Park';
      });
      const park = tpark.reduce(
        (acc, item) =>
          acc +
          (Number(
            item?.nomination_row_json['data_temp']['38']?.replace(/,/g, ''),
          ) || 0),
        0,
      );
      // { entryExit: 1, text: 'Unpark' }
      const tunpark = adailyArrNom.filter((f: any) => {
        return f?.nomination_row_json['data_temp']['5'] === 'Unpark';
      });
      const unpark = tunpark.reduce(
        (acc, item) =>
          acc +
          (Number(
            item?.nomination_row_json['data_temp']['38']?.replace(/,/g, ''),
          ) || 0),
        0,
      );
      // { entryExit: 2, text: 'Min_Inventory_Change' }
      const tchange_min_invent = adailyArrNom.filter((f: any) => {
        return (
          f?.nomination_row_json['data_temp']['5'] === 'Min_Inventory_Change'
        );
      });
      const change_min_invent = tchange_min_invent.reduce(
        (acc, item) =>
          acc +
          (Number(
            item?.nomination_row_json['data_temp']['38']?.replace(/,/g, ''),
          ) || 0),
        0,
      );
      // { entryExit: 2, text: 'Shrinkage_Volume' }
      const tshrinkage = adailyArrNom.filter((f: any) => {
        return f?.nomination_row_json['data_temp']['5'] === 'Shrinkage_Volume';
      });
      const shrinkage = tshrinkage.reduce(
        (acc, item) =>
          acc +
          (Number(
            item?.nomination_row_json['data_temp']['38']?.replace(/,/g, ''),
          ) || 0),
        0,
      );
      // totalEntry - totalExit - change_min_invent - park + unpark - shrinkage
      const entry = dailyArrNom.filter((f: any) => {
        return (
          f?.unix === 'MMBTU/D' && f?.nomination_row_json?.entry_exit_id === 1
        );
      });
      const tentry = entry.reduce(
        (acc, item) =>
          acc +
          (Number(
            item?.nomination_row_json['data_temp']['38']?.replace(/,/g, ''),
          ) || 0),
        0,
      );
      const exit = dailyArrNom.filter((f: any) => {
        return (
          f?.unix === 'MMBTU/D' && f?.nomination_row_json?.entry_exit_id === 2
        );
      });
      const texit = exit.reduce(
        (acc, item) =>
          acc +
          (Number(
            item?.nomination_row_json['data_temp']['38']?.replace(/,/g, ''),
          ) || 0),
        0,
      );
      // https://app.clickup.com/t/86ettycre
      const imbalance =
        tentry - texit - change_min_invent - park + unpark - shrinkage;
      // const imbalance = tentry - texit;
      // imbalance / totalEntry
      // const imbalance_percent = imbalance / tentry;
      const imbalance_percent = (imbalance / tentry) * 100;

      // delete e["data"]
      const { data, ...nE } = e;
      return {
        ...nE,
        park,
        unpark,
        change_min_invent,
        shrinkage,
        imbalance,
        imbalance_percent,
      };
    });

    const wImbalanceMMBTUD = wMMBTUD.reduce((acc, item) => {
      const key = `${item.gas_day_text}`;

      if (!acc[key]) {
        acc[key] = {
          gas_day_text: item.gas_day_text,
          data: [],
        };
      }

      acc[key].data.push(item);

      return acc;
    }, {});
    const wImbalanceMMBTUDObj = Object.values(wImbalanceMMBTUD);
    const wImbalance = wImbalanceMMBTUDObj.flatMap((e: any) => {
      // { entryExit: 2, text: 'Park' }
      const tpark = aweeklyArrNom.filter((f: any) => {
        return f?.nomination_row_json['data_temp']['5'] === 'Park';
      });
      // console.log('tpark : ', tpark);
      const park = (index: any) =>
        tpark.reduce(
          (acc, item) =>
            acc +
            (Number(
              item?.nomination_row_json['data_temp'][index]?.replace(/,/g, ''),
            ) || 0),
          0,
        );
      // { entryExit: 1, text: 'Unpark' }
      const tunpark = aweeklyArrNom.filter((f: any) => {
        return f?.nomination_row_json['data_temp']['5'] === 'Unpark';
      });
      // console.log('tunpark : ', tunpark);
      // console.log(tunpark.map((tt:any) => tt?.nomination_row_json['data_temp'][14]));
      const unpark = (index: any) =>
        tunpark.reduce(
          (acc, item) =>
            acc +
            (Number(
              item?.nomination_row_json['data_temp'][index]?.replace(/,/g, ''),
            ) || 0),
          0,
        );
      // { entryExit: 2, text: 'Min_Inventory_Change' }
      const tchange_min_invent = aweeklyArrNom.filter((f: any) => {
        return (
          f?.nomination_row_json['data_temp']['5'] === 'Min_Inventory_Change'
        );
      });
      const change_min_invent = (index: any) =>
        tchange_min_invent.reduce(
          (acc, item) =>
            acc +
            (Number(
              item?.nomination_row_json['data_temp'][index]?.replace(/,/g, ''),
            ) || 0),
          0,
        );
      // { entryExit: 2, text: 'Shrinkage_Volume' }
      const tshrinkage = aweeklyArrNom.filter((f: any) => {
        return f?.nomination_row_json['data_temp']['5'] === 'Shrinkage_Volume';
      });
      const shrinkage = (index: any) =>
        tshrinkage.reduce(
          (acc, item) =>
            acc +
            (Number(
              item?.nomination_row_json['data_temp'][index]?.replace(/,/g, ''),
            ) || 0),
          0,
        );
      // totalEntry - totalExit - change_min_invent - park + unpark - shrinkage
      const entry = dailyArrNom.filter((f: any) => {
        return (
          f?.unix === 'MMBTU/D' && f?.nomination_row_json?.entry_exit_id === 1
        );
      });
      const tentry = (index: any) =>
        entry.reduce(
          (acc, item) =>
            acc +
            (Number(
              item?.nomination_row_json['data_temp'][index]?.replace(/,/g, ''),
            ) || 0),
          0,
        );
      const exit = dailyArrNom.filter((f: any) => {
        return (
          f?.unix === 'MMBTU/D' && f?.nomination_row_json?.entry_exit_id === 2
        );
      });
      const texit = (index: any) =>
        exit.reduce(
          (acc, item) =>
            acc +
            (Number(
              item?.nomination_row_json['data_temp'][index]?.replace(/,/g, ''),
            ) || 0),
          0,
        );
      // const imbalance = (index: any) => tentry(index) - texit(index);
      const imbalance = (index: any) =>
        tentry(index) -
        texit(index) -
        change_min_invent(index) -
        park(index) +
        unpark(index) -
        shrinkage(index);
      // imbalance / totalEntry
      // const imbalance_percent = (index: any) => imbalance(index) / tentry(index);
      // https://app.clickup.com/t/86etu0c88

      const imbalance_percent = (index: any) =>
        (imbalance(index) / tentry(index)) * 100;

      // delete e["data"]
      const { data, ...nE } = e;
      return [
        {
          // ...nE,
          gas_day_text: getTodayNowDDMMYYYYDfault(nE?.gas_day_text)
            .add(0, 'day')
            .format('DD/MM/YYYY'),
          park: park('14'),
          unpark: unpark('14'),
          change_min_invent: change_min_invent('14'),
          shrinkage: shrinkage('14'),
          imbalance: imbalance('14'),
          imbalance_percent: imbalance_percent('14'),
        },
        {
          gas_day_text: getTodayNowDDMMYYYYDfault(nE?.gas_day_text)
            .add(1, 'day')
            .format('DD/MM/YYYY'),
          park: park('15'),
          unpark: unpark('15'),
          change_min_invent: change_min_invent('15'),
          shrinkage: shrinkage('15'),
          imbalance: imbalance('15'),
          imbalance_percent: imbalance_percent('15'),
        },
        {
          gas_day_text: getTodayNowDDMMYYYYDfault(nE?.gas_day_text)
            .add(2, 'day')
            .format('DD/MM/YYYY'),
          park: park('16'),
          unpark: unpark('16'),
          change_min_invent: change_min_invent('16'),
          shrinkage: shrinkage('16'),
          imbalance: imbalance('16'),
          imbalance_percent: imbalance_percent('16'),
        },
        {
          gas_day_text: getTodayNowDDMMYYYYDfault(nE?.gas_day_text)
            .add(3, 'day')
            .format('DD/MM/YYYY'),
          park: park('17'),
          unpark: unpark('17'),
          change_min_invent: change_min_invent('17'),
          shrinkage: shrinkage('17'),
          imbalance: imbalance('17'),
          imbalance_percent: imbalance_percent('17'),
        },
        {
          gas_day_text: getTodayNowDDMMYYYYDfault(nE?.gas_day_text)
            .add(4, 'day')
            .format('DD/MM/YYYY'),
          park: park('18'),
          unpark: unpark('18'),
          change_min_invent: change_min_invent('18'),
          shrinkage: shrinkage('18'),
          imbalance: imbalance('18'),
          imbalance_percent: imbalance_percent('18'),
        },
        {
          gas_day_text: getTodayNowDDMMYYYYDfault(nE?.gas_day_text)
            .add(5, 'day')
            .format('DD/MM/YYYY'),
          park: park('19'),
          unpark: unpark('19'),
          change_min_invent: change_min_invent('19'),
          shrinkage: shrinkage('19'),
          imbalance: imbalance('19'),
          imbalance_percent: imbalance_percent('19'),
        },
        {
          gas_day_text: getTodayNowDDMMYYYYDfault(nE?.gas_day_text)
            .add(6, 'day')
            .format('DD/MM/YYYY'),
          park: park('20'),
          unpark: unpark('20'),
          change_min_invent: change_min_invent('20'),
          shrinkage: shrinkage('20'),
          imbalance: imbalance('20'),
          imbalance_percent: imbalance_percent('20'),
        },
      ];
    });

    const allImbalance = wImbalance?.filter((f: any) => {
      return f?.gas_day_text === gas_day_text;
    });

    const dTotal = [...dMMSCFD, ...dMMBTUD, ...ccdMMSCFD, ...ccdMMBTUD].map(
      (e: any) => {
        e['parkUnparkInstructedFlows'] =
          e['nomination_row_json']?.['data_temp']?.['5'] || null;
        e['customerType'] =
          e['nomination_row_json']?.['data_temp']?.['6'] || null;
        e['units'] = e['nomination_row_json']?.['data_temp']?.['9'] || null;
        e['wi'] = e['nomination_row_json']?.['data_temp']?.['11'] || null;
        e['hv'] = e['nomination_row_json']?.['data_temp']?.['12'] || null;
        e['sg'] = e['nomination_row_json']?.['data_temp']?.['13'] || null;

        return { ...e };
      },
    );

    // Group wTotal by area_text, zone_text, nomination_point, customerType, units, parkUnparkInstructedFlows, and entry_exit_id
    const groupedDTotal = dTotal.reduce((acc: any, item: any) => {
      const groupKey = `${item.area_text || 'null'}_${item.zone_text || 'null'}_${item.nomination_point || 'null'}_${item.entry_exit_id || 'null'}_${item.customerType || 'null'}_${item.units || 'null'}_${item.parkUnparkInstructedFlows || 'null'}`;

      if (!acc[groupKey]) {
        acc[groupKey] = {
          area_text: item.area_text,
          zone_text: item.zone_text,
          nomination_point: item.nomination_point,
          entry_exit_id: item.entry_exit_id,
          customerType: item.customerType,
          units: item.units,
          parkUnparkInstructedFlows: item.parkUnparkInstructedFlows,
          wi: null,
          hv: null,
          sg: null,
          total: null,
          totalCap: null,
          utilization: null,
          H1: null,
          H2: null,
          H3: null,
          H4: null,
          H5: null,
          H6: null,
          H7: null,
          H8: null,
          H9: null,
          H10: null,
          H11: null,
          H12: null,
          H13: null,
          H14: null,
          H15: null,
          H16: null,
          H17: null,
          H18: null,
          H19: null,
          H20: null,
          H21: null,
          H22: null,
          H23: null,
          H24: null,
          items: [],
        };
      }

      acc[groupKey].wi = acc[groupKey].wi
        ? acc[groupKey].wi + (parseToNumber(item.wi) ?? 0)
        : parseToNumber(item.wi);
      acc[groupKey].hv = acc[groupKey].hv
        ? acc[groupKey].hv + (parseToNumber(item.hv) ?? 0)
        : parseToNumber(item.hv);
      acc[groupKey].sg = acc[groupKey].sg
        ? acc[groupKey].sg + (parseToNumber(item.sg) ?? 0)
        : parseToNumber(item.sg);
      acc[groupKey].total = acc[groupKey].total
        ? acc[groupKey].total + (parseToNumber(item.total) ?? 0)
        : parseToNumber(item.total);
      acc[groupKey].totalCap = acc[groupKey].totalCap
        ? acc[groupKey].totalCap + (parseToNumber(item.totalCap) ?? 0)
        : parseToNumber(item.totalCap);
      acc[groupKey].utilization = acc[groupKey].utilization
        ? acc[groupKey].utilization + (parseToNumber(item.utilization) ?? 0)
        : parseToNumber(item.utilization);
      acc[groupKey].H1 = acc[groupKey].H1
        ? acc[groupKey].H1 + (parseToNumber(item.H1) ?? 0)
        : parseToNumber(item.H1);
      acc[groupKey].H2 = acc[groupKey].H2
        ? acc[groupKey].H2 + (parseToNumber(item.H2) ?? 0)
        : parseToNumber(item.H2);
      acc[groupKey].H3 = acc[groupKey].H3
        ? acc[groupKey].H3 + (parseToNumber(item.H3) ?? 0)
        : parseToNumber(item.H3);
      acc[groupKey].H4 = acc[groupKey].H4
        ? acc[groupKey].H4 + (parseToNumber(item.H4) ?? 0)
        : parseToNumber(item.H4);
      acc[groupKey].H5 = acc[groupKey].H5
        ? acc[groupKey].H5 + (parseToNumber(item.H5) ?? 0)
        : parseToNumber(item.H5);
      acc[groupKey].H6 = acc[groupKey].H6
        ? acc[groupKey].H6 + (parseToNumber(item.H6) ?? 0)
        : parseToNumber(item.H6);
      acc[groupKey].H7 = acc[groupKey].H7
        ? acc[groupKey].H7 + (parseToNumber(item.H7) ?? 0)
        : parseToNumber(item.H7);
      acc[groupKey].H8 = acc[groupKey].H8
        ? acc[groupKey].H8 + (parseToNumber(item.H8) ?? 0)
        : parseToNumber(item.H8);
      acc[groupKey].H9 = acc[groupKey].H9
        ? acc[groupKey].H9 + (parseToNumber(item.H9) ?? 0)
        : parseToNumber(item.H9);
      acc[groupKey].H10 = acc[groupKey].H10
        ? acc[groupKey].H10 + (parseToNumber(item.H10) ?? 0)
        : parseToNumber(item.H10);
      acc[groupKey].H11 = acc[groupKey].H11
        ? acc[groupKey].H11 + (parseToNumber(item.H11) ?? 0)
        : parseToNumber(item.H11);
      acc[groupKey].H12 = acc[groupKey].H12
        ? acc[groupKey].H12 + (parseToNumber(item.H12) ?? 0)
        : parseToNumber(item.H12);
      acc[groupKey].H13 = acc[groupKey].H13
        ? acc[groupKey].H13 + (parseToNumber(item.H13) ?? 0)
        : parseToNumber(item.H13);
      acc[groupKey].H14 = acc[groupKey].H14
        ? acc[groupKey].H14 + (parseToNumber(item.H14) ?? 0)
        : parseToNumber(item.H14);
      acc[groupKey].H15 = acc[groupKey].H15
        ? acc[groupKey].H15 + (parseToNumber(item.H15) ?? 0)
        : parseToNumber(item.H15);
      acc[groupKey].H16 = acc[groupKey].H16
        ? acc[groupKey].H16 + (parseToNumber(item.H16) ?? 0)
        : parseToNumber(item.H16);
      acc[groupKey].H17 = acc[groupKey].H17
        ? acc[groupKey].H17 + (parseToNumber(item.H17) ?? 0)
        : parseToNumber(item.H17);
      acc[groupKey].H18 = acc[groupKey].H18
        ? acc[groupKey].H18 + (parseToNumber(item.H18) ?? 0)
        : parseToNumber(item.H18);
      acc[groupKey].H19 = acc[groupKey].H19
        ? acc[groupKey].H19 + (parseToNumber(item.H19) ?? 0)
        : parseToNumber(item.H19);
      acc[groupKey].H20 = acc[groupKey].H20
        ? acc[groupKey].H20 + (parseToNumber(item.H20) ?? 0)
        : parseToNumber(item.H20);
      acc[groupKey].H21 = acc[groupKey].H21
        ? acc[groupKey].H21 + (parseToNumber(item.H21) ?? 0)
        : parseToNumber(item.H21);
      acc[groupKey].H22 = acc[groupKey].H22
        ? acc[groupKey].H22 + (parseToNumber(item.H22) ?? 0)
        : parseToNumber(item.H22);
      acc[groupKey].H23 = acc[groupKey].H23
        ? acc[groupKey].H23 + (parseToNumber(item.H23) ?? 0)
        : parseToNumber(item.H23);
      acc[groupKey].H24 = acc[groupKey].H24
        ? acc[groupKey].H24 + (parseToNumber(item.H24) ?? 0)
        : parseToNumber(item.H24);

      acc[groupKey].items.push(item);
      return acc;
    }, {});

    // Convert grouped object to array format
    const groupedDTotalArray = Object.values(groupedDTotal);

    const wTotal = [...wMMSCFD, ...wMMBTUD, ...ccwMMSCFD, ...ccwMMBTUD].map(
      (e: any) => {
        e['parkUnparkInstructedFlows'] =
          e?.['nomination_row_json']?.['data_temp']?.['5'] || null;
        e['customerType'] =
          e?.['nomination_row_json']?.['data_temp']?.['6'] || null;
        e['units'] = e?.['nomination_row_json']?.['data_temp']?.['9'] || null;
        e['wi'] = e?.['nomination_row_json']?.['data_temp']?.['11'] || null;
        e['hv'] = e?.['nomination_row_json']?.['data_temp']?.['12'] || null;
        e['sg'] = e?.['nomination_row_json']?.['data_temp']?.['13'] || null;

        return { ...e };
      },
    );

    // Group wTotal by area_text, zone_text, nomination_point, customerType, units, parkUnparkInstructedFlows, and entry_exit_id
    const groupedWTotal = wTotal.reduce((acc: any, item: any) => {
      const groupKey = `${item.area_text || 'null'}_${item.zone_text || 'null'}_${item.nomination_point || 'null'}_${item.entry_exit_id || 'null'}_${item.customerType || 'null'}_${item.units || 'null'}_${item.parkUnparkInstructedFlows || 'null'}`;

      if (!acc[groupKey]) {
        acc[groupKey] = {
          area_text: item.area_text,
          zone_text: item.zone_text,
          nomination_point: item.nomination_point,
          entry_exit_id: item.entry_exit_id,
          customerType: item.customerType,
          units: item.units,
          parkUnparkInstructedFlows: item.parkUnparkInstructedFlows,
          wi: null,
          hv: null,
          sg: null,
          monday: null,
          monday_utilization: null,
          tuesday: null,
          tuesday_utilization: null,
          wednesday: null,
          wednesday_utilization: null,
          thursday: null,
          thursday_utilization: null,
          friday: null,
          friday_utilization: null,
          saturday: null,
          saturday_utilization: null,
          sunday: null,
          sunday_utilization: null,
          items: [],
        };
      }

      acc[groupKey].wi = acc[groupKey].wi
        ? acc[groupKey].wi + (parseToNumber(item.wi) ?? 0)
        : parseToNumber(item.wi);
      acc[groupKey].hv = acc[groupKey].hv
        ? acc[groupKey].hv + (parseToNumber(item.hv) ?? 0)
        : parseToNumber(item.hv);
      acc[groupKey].sg = acc[groupKey].sg
        ? acc[groupKey].sg + (parseToNumber(item.sg) ?? 0)
        : parseToNumber(item.sg);
      acc[groupKey].monday = acc[groupKey].monday
        ? acc[groupKey].monday + (parseToNumber(item.monday) ?? 0)
        : parseToNumber(item.monday);
      acc[groupKey].monday_utilization = acc[groupKey].monday_utilization
        ? acc[groupKey].monday_utilization +
        (parseToNumber(item.monday_utilization) ?? 0)
        : parseToNumber(item.monday_utilization);
      acc[groupKey].tuesday = acc[groupKey].tuesday
        ? acc[groupKey].tuesday + (parseToNumber(item.tuesday) ?? 0)
        : parseToNumber(item.tuesday);
      acc[groupKey].tuesday_utilization = acc[groupKey].tuesday_utilization
        ? acc[groupKey].tuesday_utilization +
        (parseToNumber(item.tuesday_utilization) ?? 0)
        : parseToNumber(item.tuesday_utilization);
      acc[groupKey].wednesday = acc[groupKey].wednesday
        ? acc[groupKey].wednesday + (parseToNumber(item.wednesday) ?? 0)
        : parseToNumber(item.wednesday);
      acc[groupKey].wednesday_utilization = acc[groupKey].wednesday_utilization
        ? acc[groupKey].wednesday_utilization +
        (parseToNumber(item.wednesday_utilization) ?? 0)
        : parseToNumber(item.wednesday_utilization);
      acc[groupKey].thursday = acc[groupKey].thursday
        ? acc[groupKey].thursday + (parseToNumber(item.thursday) ?? 0)
        : parseToNumber(item.thursday);
      acc[groupKey].thursday_utilization = acc[groupKey].thursday_utilization
        ? acc[groupKey].thursday_utilization +
        (parseToNumber(item.thursday_utilization) ?? 0)
        : parseToNumber(item.thursday_utilization);
      acc[groupKey].friday = acc[groupKey].friday
        ? acc[groupKey].friday + (parseToNumber(item.friday) ?? 0)
        : parseToNumber(item.friday);
      acc[groupKey].friday_utilization = acc[groupKey].friday_utilization
        ? acc[groupKey].friday_utilization +
        (parseToNumber(item.friday_utilization) ?? 0)
        : parseToNumber(item.friday_utilization);
      acc[groupKey].saturday = acc[groupKey].saturday
        ? acc[groupKey].saturday + (parseToNumber(item.saturday) ?? 0)
        : parseToNumber(item.saturday);
      acc[groupKey].saturday_utilization = acc[groupKey].saturday_utilization
        ? acc[groupKey].saturday_utilization +
        (parseToNumber(item.saturday_utilization) ?? 0)
        : parseToNumber(item.saturday_utilization);
      acc[groupKey].sunday = acc[groupKey].sunday
        ? acc[groupKey].sunday + (parseToNumber(item.sunday) ?? 0)
        : parseToNumber(item.sunday);
      acc[groupKey].sunday_utilization = acc[groupKey].sunday_utilization
        ? acc[groupKey].sunday_utilization +
        (parseToNumber(item.sunday_utilization) ?? 0)
        : parseToNumber(item.sunday_utilization);

      acc[groupKey].items.push(item);
      return acc;
    }, {});

    // Convert grouped object to array format
    const groupedWTotalArray = Object.values(groupedWTotal);

    // console.log('dMMSCFD : ', dMMSCFD); // contract_code_id
    // const dDatesdMMSCFD = new Set(dMMSCFD.map((item) => item.gas_day_text));
    // const dDatesdMMSCFD = new Set(dMMSCFD.map((item) => item.gas_day_text));
    // console.log('__dDatesdMMSCFD : ', dDatesdMMSCFD);
    // console.log('__allwMMSCFD : ', allwMMSCFD); // contract_code_id
    // const resultallwMMSCFD = allwMMSCFD.filter(
    //   (item) => !dDatesdMMSCFD.has(item.gas_day_text),
    // );
    // const resultallwMMSCFD = allwMMSCFD.filter(
    //   (item) => {

    //     return (
    //        dMMSCFD?.map((e:any) => ({ gas_day_text: e?.gas_day_text, contract_code_id: e?.contract_code_id }))?.includes(item?.gas_day_text && item?.contract_code_id)
    //     )
    //   },
    // );


    const resultallwMMSCFD = (allwMMSCFD ?? []).filter(
      (item) =>
        !(dMMSCFD ?? []).some(
          (e) =>
            e?.gas_day_text === item?.gas_day_text &&
            e?.contract_code_id === item?.contract_code_id,
        ),
    );
    const fDWaMMSCFDcalc = [...dMMSCFD, ...resultallwMMSCFD];

    // console.log('|---- dMMSCFD : ', dMMSCFD);
    // console.log('|---- resultallwMMSCFD : ', resultallwMMSCFD);
    // console.log('---- fDWaMMSCFDcalc : ', fDWaMMSCFDcalc);



    let fDWaMMSCFD = [
      ...fDWaMMSCFDcalc?.filter((f: any) => f?.nomination_type_id === 1),
    ];
    const fDWaMMSCFDW = [
      ...fDWaMMSCFDcalc?.filter((f: any) => f?.nomination_type_id === 2),
    ];
    // console.log('aaaaaaaaaaaaaaaaaaaaaaaaaa');

    const addfDWaMMSCFDW = [];
    if (fDWaMMSCFD.length > 0) {
      fDWaMMSCFDW?.map((e: any) => {
        const findW = fDWaMMSCFD?.find((f: any) => {
          return (
            f?.gas_day_text === e?.gas_day_text &&
            f?.nomination_point === e?.nomination_point
          );
        });
        if (findW) {
          const {
            total,
            totalCap,
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
            ...newE
          } = e;
          const nData = {
            ...findW,
            total:
              (total ? parseToNumber(total) : 0) +
              (findW?.total
                ? parseToNumber(findW.total)
                : 0),
            totalCap:
              (totalCap ? parseToNumber(totalCap) : 0) +
              (findW?.totalCap
                ? parseToNumber(findW.totalCap)
                : 0),
            H1:
              H1 +
              (findW?.H1 ? parseToNumber(findW.H1) : 0),
            H2:
              H2 +
              (findW?.H2 ? parseToNumber(findW.H2) : 0),
            H3:
              H3 +
              (findW?.H3 ? parseToNumber(findW.H3) : 0),
            H4:
              H4 +
              (findW?.H4 ? parseToNumber(findW.H4) : 0),
            H5:
              H5 +
              (findW?.H5 ? parseToNumber(findW.H5) : 0),
            H6:
              H6 +
              (findW?.H6 ? parseToNumber(findW.H6) : 0),
            H7:
              H7 +
              (findW?.H7 ? parseToNumber(findW.H7) : 0),
            H8:
              H8 +
              (findW?.H8 ? parseToNumber(findW.H8) : 0),
            H9:
              H9 +
              (findW?.H9 ? parseToNumber(findW.H9) : 0),
            H10:
              H10 +
              (findW?.H10 ? parseToNumber(findW.H10) : 0),
            H11:
              H11 +
              (findW?.H11 ? parseToNumber(findW.H11) : 0),
            H12:
              H12 +
              (findW?.H12 ? parseToNumber(findW.H12) : 0),
            H13:
              H13 +
              (findW?.H13 ? parseToNumber(findW.H13) : 0),
            H14:
              H14 +
              (findW?.H14 ? parseToNumber(findW.H14) : 0),
            H15:
              H15 +
              (findW?.H15 ? parseToNumber(findW.H15) : 0),
            H16:
              H16 +
              (findW?.H16 ? parseToNumber(findW.H16) : 0),
            H17:
              H17 +
              (findW?.H17 ? parseToNumber(findW.H17) : 0),
            H18:
              H18 +
              (findW?.H18 ? parseToNumber(findW.H18) : 0),
            H19:
              H19 +
              (findW?.H19 ? parseToNumber(findW.H19) : 0),
            H20:
              H20 +
              (findW?.H20 ? parseToNumber(findW.H20) : 0),
            H21:
              H21 +
              (findW?.H21 ? parseToNumber(findW.H21) : 0),
            H22:
              H22 +
              (findW?.H22 ? parseToNumber(findW.H22) : 0),
            H23:
              H23 +
              (findW?.H23 ? parseToNumber(findW.H23) : 0),
            H24:
              H24 +
              (findW?.H24 ? parseToNumber(findW.H24) : 0),
          };
          fDWaMMSCFD = fDWaMMSCFD?.map((old: any) => {
            if (
              findW?.gas_day_text === old?.gas_day_text &&
              findW?.nomination_point === old?.nomination_point
            ) {
              return nData;
            } else {
              return old;
            }
          });
        } else {
          addfDWaMMSCFDW?.push(e);
        }
        return e;
      });
      fDWaMMSCFD = [...fDWaMMSCFD, ...addfDWaMMSCFDW];
    } else {
      fDWaMMSCFD = fDWaMMSCFDcalc;
    }

    // console.log('fDWaMMSCFD : ', fDWaMMSCFD);

    // const dDatesdMMBTUD = new Set(dMMBTUD.map((item) => item.gas_day_text));
    // const resultallwMMBTUD = allwMMBTUD.filter(
    //   (item) => !dDatesdMMBTUD.has(item.gas_day_text),
    // );

    // new
    const resultallwMMBTUD = (allwMMBTUD ?? []).filter(
      (item) =>
        !(dMMBTUD ?? []).some(
          (e) =>
            e?.gas_day_text === item?.gas_day_text &&
            e?.contract_code_id === item?.contract_code_id,
        ),
    );
    const fDWallwMMBTUDcalc = [...dMMBTUD, ...resultallwMMBTUD];

    let fDWallwMMBTUD = [
      ...fDWallwMMBTUDcalc?.filter((f: any) => f?.nomination_type_id === 1),
    ];
    const fDWallwMMBTUDW = [
      ...fDWallwMMBTUDcalc?.filter((f: any) => f?.nomination_type_id === 2),
    ];
    const addfDWallwMMBTUDDW = [];
    if (fDWallwMMBTUD.length > 0) {
      fDWallwMMBTUDW?.map((e: any) => {
        const findW = fDWallwMMBTUD?.find((f: any) => {
          return (
            f?.gas_day_text === e?.gas_day_text &&
            f?.nomination_point === e?.nomination_point
          );
        });
        if (findW) {
          const {
            total,
            totalCap,
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
            ...newE
          } = e;
          const nData = {
            ...findW,
            total:
              (total ? parseToNumber(total) : 0) +
              (findW?.total
                ? parseToNumber(findW.total)
                : 0),
            totalCap:
              (totalCap ? parseToNumber(totalCap) : 0) +
              (findW?.totalCap
                ? parseToNumber(findW.totalCap)
                : 0),
            H1:
              H1 +
              (findW?.H1 ? parseToNumber(findW.H1) : 0),
            H2:
              H2 +
              (findW?.H2 ? parseToNumber(findW.H2) : 0),
            H3:
              H3 +
              (findW?.H3 ? parseToNumber(findW.H3) : 0),
            H4:
              H4 +
              (findW?.H4 ? parseToNumber(findW.H4) : 0),
            H5:
              H5 +
              (findW?.H5 ? parseToNumber(findW.H5) : 0),
            H6:
              H6 +
              (findW?.H6 ? parseToNumber(findW.H6) : 0),
            H7:
              H7 +
              (findW?.H7 ? parseToNumber(findW.H7) : 0),
            H8:
              H8 +
              (findW?.H8 ? parseToNumber(findW.H8) : 0),
            H9:
              H9 +
              (findW?.H9 ? parseToNumber(findW.H9) : 0),
            H10:
              H10 +
              (findW?.H10 ? parseToNumber(findW.H10) : 0),
            H11:
              H11 +
              (findW?.H11 ? parseToNumber(findW.H11) : 0),
            H12:
              H12 +
              (findW?.H12 ? parseToNumber(findW.H12) : 0),
            H13:
              H13 +
              (findW?.H13 ? parseToNumber(findW.H13) : 0),
            H14:
              H14 +
              (findW?.H14 ? parseToNumber(findW.H14) : 0),
            H15:
              H15 +
              (findW?.H15 ? parseToNumber(findW.H15) : 0),
            H16:
              H16 +
              (findW?.H16 ? parseToNumber(findW.H16) : 0),
            H17:
              H17 +
              (findW?.H17 ? parseToNumber(findW.H17) : 0),
            H18:
              H18 +
              (findW?.H18 ? parseToNumber(findW.H18) : 0),
            H19:
              H19 +
              (findW?.H19 ? parseToNumber(findW.H19) : 0),
            H20:
              H20 +
              (findW?.H20 ? parseToNumber(findW.H20) : 0),
            H21:
              H21 +
              (findW?.H21 ? parseToNumber(findW.H21) : 0),
            H22:
              H22 +
              (findW?.H22 ? parseToNumber(findW.H22) : 0),
            H23:
              H23 +
              (findW?.H23 ? parseToNumber(findW.H23) : 0),
            H24:
              H24 +
              (findW?.H24 ? parseToNumber(findW.H24) : 0),
          };
          fDWallwMMBTUD = fDWallwMMBTUD?.map((old: any) => {
            if (
              findW?.gas_day_text === old?.gas_day_text &&
              findW?.nomination_point === old?.nomination_point
            ) {
              return nData;
            } else {
              return old;
            }
          });
        } else {
          addfDWallwMMBTUDDW?.push(e);
        }
        return e;
      });
      fDWallwMMBTUD = [...fDWallwMMBTUD, ...addfDWallwMMBTUDDW];
    } else {
      fDWallwMMBTUD = fDWallwMMBTUDcalc;
    }

    // const dDatesccdMMSCFD = new Set(ccdMMSCFD.map((item) => item.gas_day_text));
    // const resultallccwMMSCFD = allccwMMSCFD.filter(
    //   (item) => !dDatesccdMMSCFD.has(item.gas_day_text),
    // );
    const resultallccwMMSCFD = (allccwMMSCFD ?? []).filter(
      (item) =>
        !(ccdMMSCFD ?? []).some(
          (e) =>
            e?.gas_day_text === item?.gas_day_text &&
            e?.contract_code_id === item?.contract_code_id,
        ),
    );
    const fDWallccwMMSCFD = [...ccdMMSCFD, ...resultallccwMMSCFD];

    // const dDatesccdMMBTUD = new Set(ccdMMBTUD.map((item) => item.gas_day_text));
    // const resultallccwMMBTUD = allccwMMBTUD.filter(
    //   (item) => !dDatesccdMMBTUD.has(item.gas_day_text),
    // );
    const resultallccwMMBTUD = (allccwMMBTUD ?? []).filter(
      (item) =>
        !(ccdMMBTUD ?? []).some(
          (e) =>
            e?.gas_day_text === item?.gas_day_text &&
            e?.contract_code_id === item?.contract_code_id,
        ),
    );

    // console.log('.allccwMMBTUD : ', allccwMMBTUD);
    // console.log('.ccdMMBTUD : ', ccdMMBTUD);
    const fDWallallccwMMBTUD = [...ccdMMBTUD, ...resultallccwMMBTUD];

    const aTotal = [
      ...fDWaMMSCFD,
      ...fDWallwMMBTUD,
      ...fDWallccwMMSCFD,
      ...fDWallallccwMMBTUD,
    ].map((e: any) => {
      e['parkUnparkInstructedFlows'] =
        e['nomination_row_json']?.['data_temp']?.['5'] || null;
      e['customerType'] =
        e['nomination_row_json']?.['data_temp']?.['6'] || null;
      e['units'] = e['nomination_row_json']?.['data_temp']?.['9'] || null;
      e['wi'] = e['nomination_row_json']?.['data_temp']?.['11'] || null;
      e['hv'] = e['nomination_row_json']?.['data_temp']?.['12'] || null;
      e['sg'] = e['nomination_row_json']?.['data_temp']?.['13'] || null;

      return { ...e };
    });

    // console.log('aTotal : ', aTotal);

    // Group wTotal by area_text, zone_text, nomination_point, customerType, units, parkUnparkInstructedFlows, and entry_exit_id
    const groupedATotal = aTotal.reduce((acc: any, item: any) => {
      const groupKey = `${item.area_text || 'null'}_${item.zone_text || 'null'}_${item.nomination_point || 'null'}_${item.entry_exit_id || 'null'}_${item.customerType || 'null'}_${item.units || 'null'}_${item.parkUnparkInstructedFlows || 'null'}`;

      if (!acc[groupKey]) {
        acc[groupKey] = {
          area_text: item.area_text,
          zone_text: item.zone_text,
          nomination_point: item.nomination_point,
          entry_exit_id: item.entry_exit_id,
          customerType: item.customerType,
          units: item.units,
          parkUnparkInstructedFlows: item.parkUnparkInstructedFlows,
          wi: null,
          hv: null,
          sg: null,
          total: null,
          totalCap: null,
          utilization: null,
          H1: null,
          H2: null,
          H3: null,
          H4: null,
          H5: null,
          H6: null,
          H7: null,
          H8: null,
          H9: null,
          H10: null,
          H11: null,
          H12: null,
          H13: null,
          H14: null,
          H15: null,
          H16: null,
          H17: null,
          H18: null,
          H19: null,
          H20: null,
          H21: null,
          H22: null,
          H23: null,
          H24: null,
          items: [],
        };
      }

      acc[groupKey].wi = acc[groupKey].wi
        ? acc[groupKey].wi + (parseToNumber(item.wi) ?? 0)
        : parseToNumber(item.wi);
      acc[groupKey].hv = acc[groupKey].hv
        ? acc[groupKey].hv + (parseToNumber(item.hv) ?? 0)
        : parseToNumber(item.hv);
      acc[groupKey].sg = acc[groupKey].sg
        ? acc[groupKey].sg + (parseToNumber(item.sg) ?? 0)
        : parseToNumber(item.sg);
      acc[groupKey].total = acc[groupKey].total
        ? acc[groupKey].total + (parseToNumber(item.total) ?? 0)
        : parseToNumber(item.total);
      acc[groupKey].totalCap = acc[groupKey].totalCap
        ? acc[groupKey].totalCap + (parseToNumber(item.totalCap) ?? 0)
        : parseToNumber(item.totalCap);
      acc[groupKey].utilization = acc[groupKey].utilization
        ? acc[groupKey].utilization + (parseToNumber(item.utilization) ?? 0)
        : parseToNumber(item.utilization);
      acc[groupKey].H1 = acc[groupKey].H1
        ? acc[groupKey].H1 + (parseToNumber(item.H1) ?? 0)
        : parseToNumber(item.H1);
      acc[groupKey].H2 = acc[groupKey].H2
        ? acc[groupKey].H2 + (parseToNumber(item.H2) ?? 0)
        : parseToNumber(item.H2);
      acc[groupKey].H3 = acc[groupKey].H3
        ? acc[groupKey].H3 + (parseToNumber(item.H3) ?? 0)
        : parseToNumber(item.H3);
      acc[groupKey].H4 = acc[groupKey].H4
        ? acc[groupKey].H4 + (parseToNumber(item.H4) ?? 0)
        : parseToNumber(item.H4);
      acc[groupKey].H5 = acc[groupKey].H5
        ? acc[groupKey].H5 + (parseToNumber(item.H5) ?? 0)
        : parseToNumber(item.H5);
      acc[groupKey].H6 = acc[groupKey].H6
        ? acc[groupKey].H6 + (parseToNumber(item.H6) ?? 0)
        : parseToNumber(item.H6);
      acc[groupKey].H7 = acc[groupKey].H7
        ? acc[groupKey].H7 + (parseToNumber(item.H7) ?? 0)
        : parseToNumber(item.H7);
      acc[groupKey].H8 = acc[groupKey].H8
        ? acc[groupKey].H8 + (parseToNumber(item.H8) ?? 0)
        : parseToNumber(item.H8);
      acc[groupKey].H9 = acc[groupKey].H9
        ? acc[groupKey].H9 + (parseToNumber(item.H9) ?? 0)
        : parseToNumber(item.H9);
      acc[groupKey].H10 = acc[groupKey].H10
        ? acc[groupKey].H10 + (parseToNumber(item.H10) ?? 0)
        : parseToNumber(item.H10);
      acc[groupKey].H11 = acc[groupKey].H11
        ? acc[groupKey].H11 + (parseToNumber(item.H11) ?? 0)
        : parseToNumber(item.H11);
      acc[groupKey].H12 = acc[groupKey].H12
        ? acc[groupKey].H12 + (parseToNumber(item.H12) ?? 0)
        : parseToNumber(item.H12);
      acc[groupKey].H13 = acc[groupKey].H13
        ? acc[groupKey].H13 + (parseToNumber(item.H13) ?? 0)
        : parseToNumber(item.H13);
      acc[groupKey].H14 = acc[groupKey].H14
        ? acc[groupKey].H14 + (parseToNumber(item.H14) ?? 0)
        : parseToNumber(item.H14);
      acc[groupKey].H15 = acc[groupKey].H15
        ? acc[groupKey].H15 + (parseToNumber(item.H15) ?? 0)
        : parseToNumber(item.H15);
      acc[groupKey].H16 = acc[groupKey].H16
        ? acc[groupKey].H16 + (parseToNumber(item.H16) ?? 0)
        : parseToNumber(item.H16);
      acc[groupKey].H17 = acc[groupKey].H17
        ? acc[groupKey].H17 + (parseToNumber(item.H17) ?? 0)
        : parseToNumber(item.H17);
      acc[groupKey].H18 = acc[groupKey].H18
        ? acc[groupKey].H18 + (parseToNumber(item.H18) ?? 0)
        : parseToNumber(item.H18);
      acc[groupKey].H19 = acc[groupKey].H19
        ? acc[groupKey].H19 + (parseToNumber(item.H19) ?? 0)
        : parseToNumber(item.H19);
      acc[groupKey].H20 = acc[groupKey].H20
        ? acc[groupKey].H20 + (parseToNumber(item.H20) ?? 0)
        : parseToNumber(item.H20);
      acc[groupKey].H21 = acc[groupKey].H21
        ? acc[groupKey].H21 + (parseToNumber(item.H21) ?? 0)
        : parseToNumber(item.H21);
      acc[groupKey].H22 = acc[groupKey].H22
        ? acc[groupKey].H22 + (parseToNumber(item.H22) ?? 0)
        : parseToNumber(item.H22);
      acc[groupKey].H23 = acc[groupKey].H23
        ? acc[groupKey].H23 + (parseToNumber(item.H23) ?? 0)
        : parseToNumber(item.H23);
      acc[groupKey].H24 = acc[groupKey].H24
        ? acc[groupKey].H24 + (parseToNumber(item.H24) ?? 0)
        : parseToNumber(item.H24);

      acc[groupKey].items.push(item);
      return acc;
    }, {});

    // Convert grouped object to array format
    const groupedATotalArray = Object.values(groupedATotal);

    const dDatesdAreaFil = new Set(
      dAreaFil.map((item) => `${item?.gas_day_text}`),
    );
    const resultallAreaFil = allAreaFil.filter(
      (item) => !dDatesdAreaFil.has(`${item?.gas_day_text}`),
    );
    const fDWallallAreaFil = [...dAreaFil, ...resultallAreaFil];

    // allImbalance
    const dDatesdImbalance = new Set(
      dImbalance.map((item) => `${item?.gas_day_text}`),
    );
    // const resultallImbalance = allImbalance.filter(
    //   (item) => !dDatesdImbalance.has(`${item?.gas_day_text}`),
    // );

    // console.log('dImbalance : ', dImbalance);
    // console.log('allImbalance : ', allImbalance);

    const resultallImbalance = (allImbalance ?? []).filter(
      (item) =>
        !(dImbalance ?? []).some((e) => e?.gas_day_text === item?.gas_day_text),
    );
    // console.log('resultallImbalance : ', resultallImbalance);
    const fDWallImbalance = [...dImbalance, ...resultallImbalance];
    // console.log('+ wMMSCFD : ', wMMSCFD);
    const dataType = {
      nomination: {
        daily: {
          MMSCFD: _.orderBy(dMMSCFD, ['nomination_point'], ['desc']),
          MMBTUD: _.orderBy(dMMBTUD, ['nomination_point'], ['desc']),
        },
        weekly: {
          MMSCFD: _.orderBy(wMMSCFD, ['nomination_point'], ['desc']),
          MMBTUD: _.orderBy(wMMBTUD, ['nomination_point'], ['desc']),
        },
        all: {
          MMSCFD: _.orderBy(fDWaMMSCFD, ['nomination_point'], ['desc']),
          MMBTUD: _.orderBy(fDWallwMMBTUD, ['nomination_point'], ['desc']),
        },
      },
      area: {
        daily: {
          MMBTUD: dAreaFil,
          Imbalance: dImbalance,
        },
        weekly: {
          MMBTUD: wAreaFil,
          Imbalance: wImbalance,
        },
        all: {
          MMBTUD: fDWallallAreaFil,
          Imbalance: fDWallImbalance,
        },
      },
      total: {
        daily: groupedDTotalArray,
        weekly: groupedWTotalArray,
        all: groupedATotalArray,
      },
      nomData: nomData,
    };

    // console.log('dataType : ', dataType);

    return dataType;
  }
}
