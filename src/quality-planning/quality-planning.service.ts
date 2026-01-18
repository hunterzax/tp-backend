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

import isBetween from 'dayjs/plugin/isBetween'; // นำเข้า plugin isBetween
import { CapacityService } from 'src/capacity/capacity.service';
import { UploadTemplateForShipperService } from 'src/upload-template-for-shipper/upload-template-for-shipper.service';
import { MeteredMicroService } from 'src/grpc/metered-service.service';
import {
  getTodayEndAdd7,
  getTodayNow,
  getTodayStartAdd7,
} from 'src/common/utils/date.util';
import { buildActiveDataForDates } from 'src/common/utils/allcation.util';
import {
  parseToNumber,
  parseToNumber3Decimal,
} from 'src/common/utils/number.util';

dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);

@Injectable()
export class QualityPlanningService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    // @Inject(CACHE_MANAGER) private cacheService: Cache,
    private readonly meteredMicroService: MeteredMicroService,
  ) {}

  async findAllOld() {
    // https://app.clickup.com/t/86etuazuc
    // https://app.clickup.com/t/86etub4u6
    const resData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        query_shipper_nomination_status: {
          id: {
            in: [2, 5],
          },
        },
        AND: [
          {
            OR: [{ del_flag: false }, { del_flag: null }],
          },
        ],
      },
      include: {
        nomination_version: {
          where: {
            flag_use: true,
          },
          include: {
            nomination_full_json: true,
            nomination_row_json: true,
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
    // query_shipper_nomination_type_id 1
    // console.log('resData : ', resData);
    const dailyData = [];

    const resDataCv = resData.map((e: any) => {
      const nomination_version = e['nomination_version'].map((nv: any) => {
        const nomination_full_json = nv['nomination_full_json'].map(
          (nfj: any) => {
            nfj['data_temp'] = JSON.parse(nfj['data_temp']);
            return { ...nfj };
          },
        );
        const nomination_row_json = nv['nomination_row_json'].map(
          (nfj: any) => {
            nfj['data_temp'] = JSON.parse(nfj['data_temp']);
            return { ...nfj };
          },
        );
        const nomination_row_json_use = nomination_row_json.filter((f: any) => {
          return (
            f?.query_shipper_nomination_type_id === 1 &&
            f?.data_temp['9'] === 'MMSCFD'
          );
        });
        // console.log('nomination_row_json_use : ', nomination_row_json_use);

        if (nomination_row_json_use.length > 0) {
          nomination_row_json_use.map((nx: any) => {
            dailyData.push({
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
            });

            return nx;
          });
        }

        return { ...nv, nomination_full_json, nomination_row_json_use };
      });

      return { ...e, nomination_version };
    });

    const dailyArr = dailyData.filter((f: any) => {
      return f?.nomination_type_id === 1;
    });
    const weeklyArr = dailyData.filter((f: any) => {
      return f?.nomination_type_id === 2;
    });
    const areaGroup = [
      ...new Set(dailyArr.map((gr: any) => gr?.nomination_row_json?.area_text)),
    ];
    // console.log('weeklyArr : ', weeklyArr);
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
      include: {},
    });
    const zoneData = await this.prisma.zone.findMany({
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
        zone_master_quality: true,
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
      },
    });
    const contractCodeData = await this.prisma.contract_code.findMany({});

    const gasdayArrDaily = [
      ...new Set(dailyArr.map((es: any) => es?.gas_day_text)),
    ];
    const newDaily = gasdayArrDaily.flatMap((e: any) => {
      const fil = dailyArr.filter((f: any) => f?.gas_day_text === e);
      const areaGroupF = [
        ...new Set(fil.map((gr: any) => gr?.nomination_row_json?.area_text)),
      ];

      const areaAll = areaGroupF.flatMap((es: any, ies: any, aes: any) => {
        const filAreaGF = fil.filter((fGf: any) => {
          return fGf?.nomination_row_json?.area_text === es;
        });

        const zoneTextObj =
          zoneData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.zone_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const areaTextObj =
          areaData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.area_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const gasDayText = filAreaGF[0]?.gas_day_text || null;
        const contractCodeId =
          contractCodeData.find(
            (f: any) => f?.id === filAreaGF[0]?.contract_code_id,
          ) || null;

        const aFil = filAreaGF.filter((f: any) => {
          return f?.nomination_row_json?.area_text === areaTextObj?.name;
        });
        const hvXvi =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    parseToNumber(item.nomination_row_json?.data_temp['38']),
                0,
              )
            : null; //wi excl
        const viAll =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['38']),
                0,
              )
            : null; //wi excl
        // // https://app.clickup.com/t/86etzch5z
        // const sgXvi = aFil.length > 0 && viAll ? aFil.reduce((sum, item) => sum + (Number(viAll) * parseToNumber(item.nomination_row_json?.data_temp["38"])), 0) : null; //wi excl
        const sgXvi =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    parseToNumber(item.nomination_row_json?.data_temp['38']),
                0,
              )
            : null; //wi excl

        // hv = sum(hv*vi)/ vi all
        const hv = hvXvi / viAll;
        // console.log('hv : ', hv);
        // wi = (sum(hv*vi)/0.982596)/(sqrt( sum(sg*vi) * vi all ))
        const wi = hvXvi / 0.982596 / Math.sqrt(sgXvi * viAll);
        // sg = sum(sg*vi)/ vi all
        const sg = sgXvi / viAll;

        return [
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'HV',
            valueBtuScf: hv,
            contractCodeId,
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'WI',
            valueBtuScf: wi,
            contractCodeId,
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'SG',
            valueBtuScf: sg,
            contractCodeId,
          },
        ];
      });

      return [...areaAll];
    });

    const gasdayArrWeekly = [
      ...new Set(weeklyArr.map((es: any) => es?.gas_day_text)),
    ];
    const newWeekly = gasdayArrWeekly.flatMap((e: any) => {
      const fil = weeklyArr.filter((f: any) => f?.gas_day_text === e);

      const areaGroupF = [
        ...new Set(fil.map((gr: any) => gr?.nomination_row_json?.area_text)),
      ];
      console.log('fil : ', fil);
      console.log('areaGroupF : ', areaGroupF);
      const areaAll = areaGroupF.flatMap((es: any, ies: any, aes: any) => {
        const filAreaGF = fil.filter((fGf: any) => {
          return fGf?.nomination_row_json?.area_text === es;
        });

        const zoneTextObj =
          zoneData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.zone_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const areaTextObj =
          areaData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.area_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const gasDayText = filAreaGF[0]?.gas_day_text || null;
        const contractCodeId =
          contractCodeData.find(
            (f: any) => f?.id === filAreaGF[0]?.contract_code_id,
          ) || null;
        console.log('areaTextObj : ', areaTextObj);
        console.log('filAreaGF[0] : ', filAreaGF[0]);
        const sunday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['14'];
        const monday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['15'];
        const tuesday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['16'];
        const wednesday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['17'];
        const thursday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['18'];
        const friday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['19'];
        const saturday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['20'];

        const vi1 = filAreaGF[0]?.nomination_row_json?.data_temp[14]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[14])
          : null;
        const vi2 = filAreaGF[0]?.nomination_row_json?.data_temp[15]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[15])
          : null;
        const vi3 = filAreaGF[0]?.nomination_row_json?.data_temp[16]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[16])
          : null;
        const vi4 = filAreaGF[0]?.nomination_row_json?.data_temp[17]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[17])
          : null;
        const vi5 = filAreaGF[0]?.nomination_row_json?.data_temp[18]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[18])
          : null;
        const vi6 = filAreaGF[0]?.nomination_row_json?.data_temp[19]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[19])
          : null;
        const vi7 = filAreaGF[0]?.nomination_row_json?.data_temp[20]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[20])
          : null;
        // console.log('vi1 : ', vi1);
        //wi nomination_row_json?.data_temp["11"]
        //hv nomination_row_json?.data_temp["12"]
        //sg nomination_row_json?.data_temp["13"]
        const aFil = filAreaGF.filter((f: any) => {
          return f?.nomination_row_json?.area_text === areaTextObj?.name;
        });
        // console.log('aFil : ', aFil);
        // // https://app.clickup.com/t/86etzch5z
        const hvXvi1 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi1,
                0,
              )
            : null;
        const viAll1 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi1, 0) : null;
        const sgXvi1 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    vi1,
                0,
              )
            : null;
        // const sgXvi1 = aFil.length > 0 && viAll1 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * Number(viAll1)), 0) : null;
        // console.log('hvXvi1 : ', hvXvi1);
        // console.log('viAll1 : ', viAll1);
        // console.log('sgXvi1 : ', sgXvi1);
        const hvXvi2 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi2,
                0,
              )
            : null;
        const viAll2 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi2, 0) : null;
        const sgXvi2 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    vi2,
                0,
              )
            : null;
        // const sgXvi2 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * Number(viAll2)), 0) : null;

        const hvXvi3 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi3,
                0,
              )
            : null;
        const viAll3 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi3, 0) : null;
        const sgXvi3 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    vi3,
                0,
              )
            : null;
        // const sgXvi3 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * Number(viAll3)), 0) : null;

        const hvXvi4 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi4,
                0,
              )
            : null;
        const viAll4 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi4, 0) : null;
        const sgXvi4 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    vi4,
                0,
              )
            : null;
        // const sgXvi4 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * Number(viAll4)), 0) : null;

        const hvXvi5 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi5,
                0,
              )
            : null;
        const viAll5 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi5, 0) : null;
        const sgXvi5 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    vi5,
                0,
              )
            : null;
        // const sgXvi5 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * Number(viAll5)), 0) : null;

        const hvXvi6 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi6,
                0,
              )
            : null;
        const viAll6 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi6, 0) : null;
        const sgXvi6 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    vi6,
                0,
              )
            : null;
        // const sgXvi6 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * Number(viAll6)), 0) : null;

        const hvXvi7 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi7,
                0,
              )
            : null;
        const viAll7 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi7, 0) : null;
        const sgXvi7 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    vi7,
                0,
              )
            : null;
        // const sgXvi7 = aFil.length > 0 && viAll7 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * Number(viAll7)), 0) : null;

        // hv = sum(hv*vi)/ vi all
        const hv1 = hvXvi1 / viAll1;
        // console.log('hv1 : ', hv1);
        // wi = (sum(hv*vi)/0.982596)/(sqrt( sum(sg*vi) * vi all ))
        const wi1 = hvXvi1 / 0.982596 / Math.sqrt(sgXvi1 * viAll1);
        // console.log('wi1 : ', wi1);
        // sg = sum(sg*vi)/ vi all
        const sg1 = sgXvi1 / viAll1;
        // console.log('sg1 : ', sg1);

        const hv2 = hvXvi2 / viAll2;
        const wi2 = hvXvi2 / 0.982596 / Math.sqrt(sgXvi2 * viAll2);
        const sg2 = sgXvi2 / viAll2;

        const hv3 = hvXvi3 / viAll3;
        const wi3 = hvXvi3 / 0.982596 / Math.sqrt(sgXvi3 * viAll3);
        const sg3 = sgXvi3 / viAll3;

        const hv4 = hvXvi4 / viAll4;
        const wi4 = hvXvi4 / 0.982596 / Math.sqrt(sgXvi4 * viAll4);
        const sg4 = sgXvi4 / viAll4;

        const hv5 = hvXvi5 / viAll5;
        const wi5 = hvXvi5 / 0.982596 / Math.sqrt(sgXvi5 * viAll5);
        const sg5 = sgXvi5 / viAll5;

        const hv6 = hvXvi6 / viAll6;
        const wi6 = hvXvi6 / 0.982596 / Math.sqrt(sgXvi6 * viAll6);
        const sg6 = sgXvi6 / viAll6;

        const hv7 = hvXvi7 / viAll7;
        const wi7 = hvXvi7 / 0.982596 / Math.sqrt(sgXvi7 * viAll7);
        const sg7 = sgXvi7 / viAll7;

        return [
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'HV',
            contractCodeId,
            sunday: {
              date: sunday,
              value: hv1,
            },
            monday: {
              date: monday,
              value: hv2,
            },
            tuesday: {
              date: tuesday,
              value: hv3,
            },
            wednesday: {
              date: wednesday,
              value: hv4,
            },
            thursday: {
              date: thursday,
              value: hv5,
            },
            friday: {
              date: friday,
              value: hv6,
            },
            saturday: {
              date: saturday,
              value: hv7,
            },
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'WI',
            contractCodeId,
            sunday: {
              date: sunday,
              value: wi1,
            },
            monday: {
              date: monday,
              value: wi2,
            },
            tuesday: {
              date: tuesday,
              value: wi3,
            },
            wednesday: {
              date: wednesday,
              value: wi4,
            },
            thursday: {
              date: thursday,
              value: wi5,
            },
            friday: {
              date: friday,
              value: wi6,
            },
            saturday: {
              date: saturday,
              value: wi7,
            },
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'SG',
            contractCodeId,
            sunday: {
              date: sunday,
              value: sg1,
            },
            monday: {
              date: monday,
              value: sg2,
            },
            tuesday: {
              date: tuesday,
              value: sg3,
            },
            wednesday: {
              date: wednesday,
              value: sg4,
            },
            thursday: {
              date: thursday,
              value: sg5,
            },
            friday: {
              date: friday,
              value: sg6,
            },
            saturday: {
              date: saturday,
              value: sg7,
            },
          },
        ];
      });

      return [...areaAll];
    });
    // console.log('newWeekly : ', newWeekly);

    // *** ทำเพิ่ม

    const day = (
      newDaily.length > 0 ? newDaily : newWeekly.length > 0 ? newWeekly : []
    ).map((e: any) => e?.gasday);
    // console.log('day : ', day);
    const daySet = [...new Set(day)].map((e: any) =>
      dayjs(e, 'DD/MM/YYYY').format('YYYY-MM-DD'),
    );
    // console.log('daySet : ', daySet);
    const findMinMaxDate = (dateArray) => {
      if (!dateArray || dateArray.length === 0) {
        return { minDate: null, maxDate: null };
      }

      let minDate = dateArray[0];
      let maxDate = dateArray[0];

      for (const dateStr of dateArray) {
        if (dateStr < minDate) {
          minDate = dateStr;
        }
        if (dateStr > maxDate) {
          maxDate = dateStr;
        }
      }

      return { minDate, maxDate };
    };

    const nDay = findMinMaxDate(daySet);
    // { minDate: '2025-06-10', maxDate: '2025-07-03' }
    // console.log('nDay : ', nDay);

    // Extract gas days and generate date array
    const getMeterFrom = nDay?.minDate ? getTodayNow(nDay.minDate) : null;
    const getMeterTo = nDay?.maxDate ? getTodayNow(nDay.maxDate) : null;
    if (!getMeterFrom || !getMeterTo) {
      return [];
    }
    const dateArray: string[] = [];
    // Fill dateArray with all dates between getMeterFrom and getMeterTo (inclusive) in YYYY-MM-DD format
    let current = getMeterFrom.clone();
    while (current.isSameOrBefore(getMeterTo, 'day')) {
      dateArray.push(current.format('YYYY-MM-DD'));
      current = current.add(1, 'day');
    }
    // Build active data for all dates
    const activeData = await buildActiveDataForDates(dateArray, this.prisma);

    // console.log('nDay?.minDate : ', nDay?.minDate);
    // const meteredMicroData = await this.meteredMicroService.sendMessage(
    //   JSON.stringify({
    //     case: 'getLastHour',
    //     mode: 'metering',
    //     // start_date: start_date,
    //     // end_date: end_date
    //     // start_date: getTodayNow(gDay).format('YYYY-MM-DD'),
    //     // end_date: gDay,
    //     // gas_day: gDay,
    //     // gas_day: nDay?.minDate,
    //     // gas_day: "2025-09-19",
    //     gas_day: "2025-09-01",
    //   }),
    // );

    // const meteredMicroData = await this.meteredMicroService.sendMessage(JSON.stringify({
    //     case: "getLastH",
    //     mode:"metering",

    //     start_date: nDay?.minDate,
    //     end_date: nDay?.maxDate
    // }),{
    //   activeData,
    //   prisma: this.prisma
    // });
    // console.log('meteredMicroData : ', meteredMicroData);
    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        // case: "getLast",
        case: 'getLastH',
        mode: 'metering',

        start_date: nDay?.minDate,
        end_date: nDay?.maxDate,
      }),
      {
        activeData,
        prisma: this.prisma,
      },
    );

    const reply =
      (!!meteredMicroData?.reply && JSON.parse(meteredMicroData?.reply)) ||
      null;
    // console.log('reply : ', reply);

    const gasDayArr = [];
    for (let i = 0; i < daySet.length; i++) {
      //   const meteredMicroData = await this.meteredMicroService.sendMessage(JSON.stringify({
      //     case: "getLast",
      //     mode:"metering",

      //     start_date: daySet[i],
      //     end_date: daySet[i]
      // }));

      // const reply = !!meteredMicroData?.reply && JSON.parse(meteredMicroData?.reply) || null
      // console.log('reply : ', reply);
      // gasDayArr.push({gasDay: daySet[i], data: reply})
      const fDaty = reply?.filter((f: any) => f?.gasDay === daySet[i]);
      gasDayArr.push({ gasDay: daySet[i], data: fDaty });
    }
    // console.log('meterData : ', meterData);
    // console.log('gasDayArr : ', gasDayArr);
    // meteringPointId
    // ZAWTIKA
    // insert_timestamp = '2025-10-01 09:30:00'
    // registerTimestamp = '2025-10-01T09:00:00'
    // gasHour
    const intraday = (
      newDaily.length > 0 ? newDaily : newWeekly.length > 0 ? newWeekly : []
    ).map((e: any) => {
      const fil = gasDayArr.filter((f: any) => {
        return (
          dayjs(f?.gasDay, 'YYYY-MM-DD').format('DD/MM/YYYY') === e?.gasday
        );
      });
      const fMeter = meterData
        .filter((f: any) => {
          return (
            f?.area?.name === e?.area?.name && f?.zone?.name === e?.zone?.name
          );
        })
        ?.map((mn: any) => mn?.metered_point_name);
      const filA = fil.map((fA: any) => fA?.data).flat();
      const filData = filA?.filter((f: any) => {
        return fMeter.includes(f?.meteringPointId);
      });
      // console.log('filData : ', filData);
      // registerTimestamp
      // energy
      // heatingValue
      // wobbeIndex
      // sg
      // volume

      // e?.parameter

      const fHrIn0 = (payl: any, hr: any) =>
        (payl || []).filter((f: any) => {
          return dayjs(f?.registerTimestamp).format('HH') === hr;
        });

      let fH1 = fHrIn0(filData, '00');
      let fH2 = fHrIn0(filData, '01');
      let fH3 = fHrIn0(filData, '02');
      let fH4 = fHrIn0(filData, '03');
      let fH5 = fHrIn0(filData, '04');
      let fH6 = fHrIn0(filData, '05');
      let fH7 = fHrIn0(filData, '06');
      let fH8 = fHrIn0(filData, '07');
      let fH9 = fHrIn0(filData, '08');
      let fH10 = fHrIn0(filData, '09');
      let fH11 = fHrIn0(filData, '10');
      let fH12 = fHrIn0(filData, '11');
      let fH13 = fHrIn0(filData, '12');
      let fH14 = fHrIn0(filData, '13');
      let fH15 = fHrIn0(filData, '14');
      let fH16 = fHrIn0(filData, '15');
      let fH17 = fHrIn0(filData, '16');
      let fH18 = fHrIn0(filData, '17');
      let fH19 = fHrIn0(filData, '18');
      let fH20 = fHrIn0(filData, '19');
      let fH21 = fHrIn0(filData, '20');
      let fH22 = fHrIn0(filData, '21');
      let fH23 = fHrIn0(filData, '22');
      let fH24 = fHrIn0(filData, '23');

      const calcParameter = (hourCalc: any) => {
        if (hourCalc.length > 0) {
          // console.log('e?.gasday : ', e?.gasday);
          // console.log('hourCalc : ', hourCalc);
          const hvXvi =
            hourCalc.length > 0
              ? hourCalc.reduce(
                  (sum, item) =>
                    sum + Number(item.heatingValue) * Number(item.volume),
                  0,
                )
              : null;
          const viAll =
            hourCalc.length > 0
              ? hourCalc.reduce((sum, item) => sum + Number(item.volume), 0)
              : null;
          const sgXvi =
            hourCalc.length > 0 && viAll
              ? hourCalc.reduce(
                  (sum, item) => sum + Number(item.sg) * Number(viAll),
                  0,
                )
              : null;
          // const sgXvi = hourCalc.length > 0 ? hourCalc.reduce((sum, item) => sum + (Number(item.sg) * Number(item.volume)), 0) : null;
          // hv = sum(hv*vi)/ vi all
          const hv = hvXvi / viAll;
          // wi = (sum(hv*vi)/0.982596)/(sqrt( sum(sg*vi) * vi all ))
          // const wi = (hv / 0.982596) / Math.sqrt((sgXvi * viAll))
          const wi = hvXvi / 0.982596 / Math.sqrt(sgXvi * viAll);
          // sg = sum(sg*vi)/ vi all
          const sg = sgXvi / viAll;

          if (e?.parameter === 'HV') {
            // console.log('hv : ', hv);
            return (hv !== Infinity && hv) || 'Div/0';
          } else if (e?.parameter === 'WI') {
            // console.log('wi : ', wi);
            return (wi !== Infinity && wi) || 'Div/0';
          } else if (e?.parameter === 'SG') {
            // console.log('sg : ', sg);
            return (sg !== Infinity && sg) || 'Div/0';
          } else {
            return null;
          }
        } else {
          return null;
        }
      };

      fH1 = calcParameter(fH1);
      fH2 = calcParameter(fH2);
      fH3 = calcParameter(fH3);
      fH4 = calcParameter(fH4);
      fH5 = calcParameter(fH5);
      fH6 = calcParameter(fH6);
      fH7 = calcParameter(fH7);
      fH8 = calcParameter(fH8);
      fH9 = calcParameter(fH9);
      fH10 = calcParameter(fH10);
      fH11 = calcParameter(fH11);
      fH12 = calcParameter(fH12);
      fH13 = calcParameter(fH13);
      fH14 = calcParameter(fH14);
      fH15 = calcParameter(fH15);
      fH16 = calcParameter(fH16);
      fH17 = calcParameter(fH17);
      fH18 = calcParameter(fH18);
      fH19 = calcParameter(fH19);
      fH20 = calcParameter(fH20);
      fH21 = calcParameter(fH21);
      fH22 = calcParameter(fH22);
      fH23 = calcParameter(fH23);
      fH24 = calcParameter(fH24);

      return {
        gasday: e?.gasday,
        zone: e?.zone,
        area: e?.area,
        parameter: e?.parameter,
        contractCodeId: e?.contractCodeId,
        h1: fH1,
        h2: fH2,
        h3: fH3,
        h4: fH4,
        h5: fH5,
        h6: fH6,
        h7: fH7,
        h8: fH8,
        h9: fH9,
        h10: fH10,
        h11: fH11,
        h12: fH12,
        h13: fH13,
        h14: fH14,
        h15: fH15,
        h16: fH16,
        h17: fH17,
        h18: fH18,
        h19: fH19,
        h20: fH20,
        h21: fH21,
        h22: fH22,
        h23: fH23,
        h24: fH24,
      };
    });

    return {
      intraday,
      newDaily,
      newWeekly,
    };
  }

  async findAllNoIntar() {
    const { nDay, activeData, daySet, newDaily, newWeekly, meterData } =
      await this.fnMiddleMain();

    return {
      newDaily,
      newWeekly,
    };
  }

  async findAll() {
    const { nDay, activeData, daySet, newDaily, newWeekly, meterData } =
      await this.fnMiddleMain();

    const intraday = await this.fnMiddleIntra(
      nDay,
      activeData,
      daySet,
      newDaily,
      newWeekly,
      meterData,
    );

    return {
      intraday,
      newDaily,
      newWeekly,
    };
  }

  // ...
  async fnMiddleMain(): Promise<any> {
    // https://app.clickup.com/t/86etuazuc
    // https://app.clickup.com/t/86etub4u6
    const resData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        query_shipper_nomination_status: {
          id: {
            in: [2, 5],
          },
        },
        AND: [
          {
            OR: [{ del_flag: false }, { del_flag: null }],
          },
        ],
      },
      include: {
        nomination_version: {
          where: {
            flag_use: true,
          },
          include: {
            nomination_full_json: true,
            nomination_row_json: true,
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
    // query_shipper_nomination_type_id 1
    // console.log('resData : ', resData);
    const dailyData = [];

    const resDataCv = resData.map((e: any) => {
      const nomination_version = e['nomination_version'].map((nv: any) => {
        const nomination_full_json = nv['nomination_full_json'].map(
          (nfj: any) => {
            nfj['data_temp'] = JSON.parse(nfj['data_temp']);
            return { ...nfj };
          },
        );
        const nomination_row_json = nv['nomination_row_json'].map(
          (nfj: any) => {
            nfj['data_temp'] = JSON.parse(nfj['data_temp']);
            return { ...nfj };
          },
        );
        const nomination_row_json_use = nomination_row_json.filter((f: any) => {
          return (
            f?.query_shipper_nomination_type_id === 1 &&
            f?.data_temp['9'] === 'MMSCFD'
          );
        });
        // console.log('nomination_row_json_use : ', nomination_row_json_use);

        if (nomination_row_json_use.length > 0) {
          nomination_row_json_use.map((nx: any) => {
            dailyData.push({
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
            });

            return nx;
          });
        }

        return { ...nv, nomination_full_json, nomination_row_json_use };
      });

      return { ...e, nomination_version };
    });

    const dailyArr = dailyData.filter((f: any) => {
      return f?.nomination_type_id === 1;
    });
    const weeklyArr = dailyData.filter((f: any) => {
      return f?.nomination_type_id === 2;
    });
    const areaGroup = [
      ...new Set(dailyArr.map((gr: any) => gr?.nomination_row_json?.area_text)),
    ];
    console.log('weeklyArr : ', weeklyArr);
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
      include: {},
    });
    const zoneData = await this.prisma.zone.findMany({
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
        zone_master_quality: true,
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
      },
    });
    const contractCodeData = await this.prisma.contract_code.findMany({});

    const gasdayArrDaily = [
      ...new Set(dailyArr.map((es: any) => es?.gas_day_text)),
    ];
    const newDaily = gasdayArrDaily.flatMap((e: any) => {
      const fil = dailyArr.filter((f: any) => f?.gas_day_text === e);
      const areaGroupF = [
        ...new Set(fil.map((gr: any) => gr?.nomination_row_json?.area_text)),
      ];

      const areaAll = areaGroupF.flatMap((es: any, ies: any, aes: any) => {
        const filAreaGF = fil.filter((fGf: any) => {
          return fGf?.nomination_row_json?.area_text === es;
        });

        const zoneTextObj =
          zoneData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.zone_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const areaTextObj =
          areaData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.area_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const gasDayText = filAreaGF[0]?.gas_day_text || null;
        const contractCodeId =
          contractCodeData.find(
            (f: any) => f?.id === filAreaGF[0]?.contract_code_id,
          ) || null;

        const aFil = filAreaGF.filter((f: any) => {
          return f?.nomination_row_json?.area_text === areaTextObj?.name;
        });
        const hvXvi =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    parseToNumber(item.nomination_row_json?.data_temp['38']),
                0,
              )
            : null; //wi excl
        const viAll =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['38']),
                0,
              )
            : null; //wi excl
        // // https://app.clickup.com/t/86etzch5z
        // const sgXvi = aFil.length > 0 && viAll ? aFil.reduce((sum, item) => sum + (Number(viAll) * parseToNumber(item.nomination_row_json?.data_temp["38"])), 0) : null; //wi excl
        const sgXvi =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    parseToNumber(item.nomination_row_json?.data_temp['38']),
                0,
              )
            : null; //wi excl

        // hv = sum(hv*vi)/ vi all
        const hv = hvXvi / viAll;
        // console.log('hv : ', hv);
        // wi = (sum(hv*vi)/0.982596)/(sqrt( sum(sg*vi) * vi all ))
        const wi = hvXvi / 0.982596 / Math.sqrt(sgXvi * viAll);
        // sg = sum(sg*vi)/ vi all
        const sg = sgXvi / viAll;

        return [
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'HV',
            valueBtuScf: hv,
            contractCodeId,
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'WI',
            valueBtuScf: wi,
            contractCodeId,
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'SG',
            valueBtuScf: sg,
            contractCodeId,
          },
        ];
      });

      return [...areaAll];
    });

    const gasdayArrWeekly = [
      ...new Set(weeklyArr.map((es: any) => es?.gas_day_text)),
    ];
    const newWeekly = gasdayArrWeekly.flatMap((e: any) => {
      const fil = weeklyArr.filter((f: any) => f?.gas_day_text === e);

      const areaGroupF = [
        ...new Set(fil.map((gr: any) => gr?.nomination_row_json?.area_text)),
      ];
      // console.log('fil : ', fil);
      // console.log('areaGroupF : ', areaGroupF);
      const areaAll = areaGroupF.flatMap((es: any, ies: any, aes: any) => {
        const filAreaGF = fil.filter((fGf: any) => {
          return fGf?.nomination_row_json?.area_text === es;
        });

        const zoneTextObj =
          zoneData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.zone_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const areaTextObj =
          areaData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.area_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const gasDayText = filAreaGF[0]?.gas_day_text || null;
        const contractCodeId =
          contractCodeData.find(
            (f: any) => f?.id === filAreaGF[0]?.contract_code_id,
          ) || null;
        // console.log('areaTextObj : ', areaTextObj);
        // console.log('filAreaGF[0] : ', filAreaGF[0]);
        const sunday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['14'];
        const monday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['15'];
        const tuesday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['16'];
        const wednesday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['17'];
        const thursday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['18'];
        const friday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['19'];
        const saturday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['20'];

        // const vi1 = filAreaGF[0]?.nomination_row_json?.data_temp[14]
        //   ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[14])
        //   : null;
        const vi2 = filAreaGF[0]?.nomination_row_json?.data_temp[15]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[15])
          : null;
        const vi3 = filAreaGF[0]?.nomination_row_json?.data_temp[16]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[16])
          : null;
        const vi4 = filAreaGF[0]?.nomination_row_json?.data_temp[17]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[17])
          : null;
        const vi5 = filAreaGF[0]?.nomination_row_json?.data_temp[18]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[18])
          : null;
        const vi6 = filAreaGF[0]?.nomination_row_json?.data_temp[19]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[19])
          : null;
        const vi7 = filAreaGF[0]?.nomination_row_json?.data_temp[20]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[20])
          : null;

        const viFind = (contract_code_id: any, day_: any) => {
          const filAreaGF_ = filAreaGF?.find(
            (f: any) => f?.contract_code_id === contract_code_id,
          );
          const viUse = filAreaGF_?.nomination_row_json?.data_temp[day_]
            ? parseToNumber(filAreaGF_.nomination_row_json.data_temp[day_])
            : null;
          return viUse;
        };

        // console.log('vi1 : ', vi1);
        //wi nomination_row_json?.data_temp["11"]
        //hv nomination_row_json?.data_temp["12"]
        //sg nomination_row_json?.data_temp["13"]
        const aFil = filAreaGF.filter((f: any) => {
          return f?.nomination_row_json?.area_text === areaTextObj?.name;
        });

        const hvxViFN = (day_: any) => {
          return aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    viFind(item?.contract_code_id, day_),
                0,
              )
            : null;
        };
        const viAllFN = (day_: any) => {
          return aFil.length > 0
            ? aFil.reduce(
                (sum, item) => sum + viFind(item?.contract_code_id, 14),
                0,
              )
            : null;
        };
        const sgxViFN = (day_: any) => {
          return aFil.length > 0
            ? aFil.reduce((sum, item) => {
                const calc = parseToNumber(
                  parseToNumber3Decimal(
                    item.nomination_row_json?.data_temp['13'],
                  ) * viFind(item?.contract_code_id, day_),
                );
                return sum + calc;
              }, 0)
            : null;
        };
        const hvXvi1 = hvxViFN(14);
        const viAll1 = viAllFN(14);
        const sgXvi1 = sgxViFN(14);

        const hvXvi2 = hvxViFN(15);
        const viAll2 = viAllFN(15);
        const sgXvi2 = sgxViFN(15);

        const hvXvi3 = hvxViFN(16);
        const viAll3 = viAllFN(16);
        const sgXvi3 = sgxViFN(16);

        const hvXvi4 = hvxViFN(17);
        const viAll4 = viAllFN(17);
        const sgXvi4 = sgxViFN(17);

        const hvXvi5 = hvxViFN(18);
        const viAll5 = viAllFN(18);
        const sgXvi5 = sgxViFN(18);

        const hvXvi6 = hvxViFN(19);
        const viAll6 = viAllFN(19);
        const sgXvi6 = sgxViFN(19);

        const hvXvi7 = hvxViFN(20);
        const viAll7 = viAllFN(20);
        const sgXvi7 = sgxViFN(20);
        // const sgXvi7 = aFil.length > 0 && viAll7 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * Number(viAll7)), 0) : null;

        const hv1 = hvXvi1 / viAll1;
        // console.log('hv1 : ', hv1);
        // wi = (sum(hv*vi)/0.982596)/(sqrt( sum(sg*vi) * vi all ))
        const wi1 = hvXvi1 / 0.982596 / Math.sqrt(sgXvi1 * viAll1);
        // console.log('wi1 : ', wi1);
        // sg = sum(sg*vi)/ vi all
        const sg1 = sgXvi1 / viAll1;
        // console.log('sg1 : ', sg1);

        const hv2 = hvXvi2 / viAll2;
        const wi2 = hvXvi2 / 0.982596 / Math.sqrt(sgXvi2 * viAll2);
        const sg2 = sgXvi2 / viAll2;

        const hv3 = hvXvi3 / viAll3;
        const wi3 = hvXvi3 / 0.982596 / Math.sqrt(sgXvi3 * viAll3);
        const sg3 = sgXvi3 / viAll3;

        const hv4 = hvXvi4 / viAll4;
        const wi4 = hvXvi4 / 0.982596 / Math.sqrt(sgXvi4 * viAll4);
        const sg4 = sgXvi4 / viAll4;

        const hv5 = hvXvi5 / viAll5;
        const wi5 = hvXvi5 / 0.982596 / Math.sqrt(sgXvi5 * viAll5);
        const sg5 = sgXvi5 / viAll5;

        const hv6 = hvXvi6 / viAll6;
        const wi6 = hvXvi6 / 0.982596 / Math.sqrt(sgXvi6 * viAll6);
        const sg6 = sgXvi6 / viAll6;

        const hv7 = hvXvi7 / viAll7;
        const wi7 = hvXvi7 / 0.982596 / Math.sqrt(sgXvi7 * viAll7);
        const sg7 = sgXvi7 / viAll7;

        return [
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'HV',
            contractCodeId,
            sunday: {
              date: sunday,
              value: hv1,
            },
            monday: {
              date: monday,
              value: hv2,
            },
            tuesday: {
              date: tuesday,
              value: hv3,
            },
            wednesday: {
              date: wednesday,
              value: hv4,
            },
            thursday: {
              date: thursday,
              value: hv5,
            },
            friday: {
              date: friday,
              value: hv6,
            },
            saturday: {
              date: saturday,
              value: hv7,
            },
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'WI',
            contractCodeId,
            sunday: {
              date: sunday,
              value: wi1,
            },
            monday: {
              date: monday,
              value: wi2,
            },
            tuesday: {
              date: tuesday,
              value: wi3,
            },
            wednesday: {
              date: wednesday,
              value: wi4,
            },
            thursday: {
              date: thursday,
              value: wi5,
            },
            friday: {
              date: friday,
              value: wi6,
            },
            saturday: {
              date: saturday,
              value: wi7,
            },
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'SG',
            contractCodeId,
            sunday: {
              date: sunday,
              value: sg1,
            },
            monday: {
              date: monday,
              value: sg2,
            },
            tuesday: {
              date: tuesday,
              value: sg3,
            },
            wednesday: {
              date: wednesday,
              value: sg4,
            },
            thursday: {
              date: thursday,
              value: sg5,
            },
            friday: {
              date: friday,
              value: sg6,
            },
            saturday: {
              date: saturday,
              value: sg7,
            },
          },
        ];
      });

      return [...areaAll];
    });
    console.log('newWeekly : ', newWeekly);
    // *** ทำเพิ่ม

    const day = (
      newDaily.length > 0 ? newDaily : newWeekly.length > 0 ? newWeekly : []
    ).map((e: any) => e?.gasday);
    const daySet = [...new Set(day)].map((e: any) =>
      dayjs(e, 'DD/MM/YYYY').format('YYYY-MM-DD'),
    );
    const findMinMaxDate = (dateArray) => {
      if (!dateArray || dateArray.length === 0) {
        return { minDate: null, maxDate: null };
      }

      let minDate = dateArray[0];
      let maxDate = dateArray[0];

      for (const dateStr of dateArray) {
        if (dateStr < minDate) {
          minDate = dateStr;
        }
        if (dateStr > maxDate) {
          maxDate = dateStr;
        }
      }

      return { minDate, maxDate };
    };

    const nDay = findMinMaxDate(daySet);

    // Extract gas days and generate date array
    const getMeterFrom = nDay?.minDate ? getTodayNow(nDay.minDate) : null;
    const getMeterTo = nDay?.maxDate ? getTodayNow(nDay.maxDate) : null;
    if (!getMeterFrom || !getMeterTo) {
      return [];
    }
    const dateArray: string[] = [];
    // Fill dateArray with all dates between getMeterFrom and getMeterTo (inclusive) in YYYY-MM-DD format
    let current = getMeterFrom.clone();
    while (current.isSameOrBefore(getMeterTo, 'day')) {
      dateArray.push(current.format('YYYY-MM-DD'));
      current = current.add(1, 'day');
    }
    // Build active data for all dates
    const activeData = await buildActiveDataForDates(dateArray, this.prisma);

    return {
      nDay,
      activeData,
      daySet,
      newDaily,
      newWeekly,
      meterData,
    };
  }

  async fnMiddleIntra(
    nDay,
    activeData,
    daySet,
    newDaily,
    newWeekly,
    meterData,
  ) {
    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        // case: "getLast",
        case: 'getLastH',
        mode: 'metering',

        start_date: nDay?.minDate,
        end_date: nDay?.maxDate,
      }),
      {
        activeData,
        prisma: this.prisma,
      },
    );

    const reply =
      (!!meteredMicroData?.reply && JSON.parse(meteredMicroData?.reply)) ||
      null;

    const gasDayArr = [];
    for (let i = 0; i < daySet.length; i++) {
      const fDaty = reply?.filter((f: any) => f?.gasDay === daySet[i]);
      gasDayArr.push({ gasDay: daySet[i], data: fDaty });
    }

    const intraday = (
      newDaily.length > 0 ? newDaily : newWeekly.length > 0 ? newWeekly : []
    ).map((e: any) => {
      const fil = gasDayArr.filter((f: any) => {
        return (
          dayjs(f?.gasDay, 'YYYY-MM-DD').format('DD/MM/YYYY') === e?.gasday
        );
      });
      const fMeter = meterData
        .filter((f: any) => {
          return (
            f?.area?.name === e?.area?.name && f?.zone?.name === e?.zone?.name
          );
        })
        ?.map((mn: any) => mn?.metered_point_name);
      const filA = fil.map((fA: any) => fA?.data).flat();
      const filData = filA?.filter((f: any) => {
        return fMeter.includes(f?.meteringPointId);
      });

      const fHrIn0 = (payl: any, hr: any) =>
        (payl || []).filter((f: any) => {
          return dayjs(f?.registerTimestamp).format('HH') === hr;
        });

      let fH1 = fHrIn0(filData, '00');
      let fH2 = fHrIn0(filData, '01');
      let fH3 = fHrIn0(filData, '02');
      let fH4 = fHrIn0(filData, '03');
      let fH5 = fHrIn0(filData, '04');
      let fH6 = fHrIn0(filData, '05');
      let fH7 = fHrIn0(filData, '06');
      let fH8 = fHrIn0(filData, '07');
      let fH9 = fHrIn0(filData, '08');
      let fH10 = fHrIn0(filData, '09');
      let fH11 = fHrIn0(filData, '10');
      let fH12 = fHrIn0(filData, '11');
      let fH13 = fHrIn0(filData, '12');
      let fH14 = fHrIn0(filData, '13');
      let fH15 = fHrIn0(filData, '14');
      let fH16 = fHrIn0(filData, '15');
      let fH17 = fHrIn0(filData, '16');
      let fH18 = fHrIn0(filData, '17');
      let fH19 = fHrIn0(filData, '18');
      let fH20 = fHrIn0(filData, '19');
      let fH21 = fHrIn0(filData, '20');
      let fH22 = fHrIn0(filData, '21');
      let fH23 = fHrIn0(filData, '22');
      let fH24 = fHrIn0(filData, '23');

  //     parseToNumber,
  // parseToNumber3Decimal,
      const calcParameter = (hourCalc: any) => {
        if (hourCalc.length > 0) {
          const hvXvi =
            hourCalc.length > 0
              ? hourCalc.reduce(
                  (sum, item) =>
                    sum + parseToNumber(item.heatingValue) * parseToNumber(item.volume),
                  0,
                )
              : null;
          const viAll =
            hourCalc.length > 0
              ? hourCalc.reduce((sum, item) => sum + parseToNumber(item.volume), 0)
              : null;
          const sgXvi =
            hourCalc.length > 0 && viAll
              ? hourCalc.reduce(
                  (sum, item) => sum + parseToNumber(item.sg) * parseToNumber(viAll),
                  0,
                )
              : null;
          const hv = hvXvi / viAll;
          const wi = (hvXvi / 0.982596) / Math.sqrt(sgXvi * viAll);
          const sg = sgXvi / viAll;

          if (e?.parameter === 'HV') {
            return (hv !== Infinity && hv) || 'Div/0';
          } else if (e?.parameter === 'WI') {
            return (wi !== Infinity && wi) || 'Div/0';
          } else if (e?.parameter === 'SG') {
            return (sg !== Infinity && sg) || 'Div/0';
          } else {
            return null;
          }
        } else {
          return null;
        }
      };

      fH1 = calcParameter(fH1);
      fH2 = calcParameter(fH2);
      fH3 = calcParameter(fH3);
      fH4 = calcParameter(fH4);
      fH5 = calcParameter(fH5);
      fH6 = calcParameter(fH6);
      fH7 = calcParameter(fH7);
      fH8 = calcParameter(fH8);
      fH9 = calcParameter(fH9);
      fH10 = calcParameter(fH10);
      fH11 = calcParameter(fH11);
      fH12 = calcParameter(fH12);
      fH13 = calcParameter(fH13);
      fH14 = calcParameter(fH14);
      fH15 = calcParameter(fH15);
      fH16 = calcParameter(fH16);
      fH17 = calcParameter(fH17);
      fH18 = calcParameter(fH18);
      fH19 = calcParameter(fH19);
      fH20 = calcParameter(fH20);
      fH21 = calcParameter(fH21);
      fH22 = calcParameter(fH22);
      fH23 = calcParameter(fH23);
      fH24 = calcParameter(fH24);

      return {
        gasday: e?.gasday,
        zone: e?.zone,
        area: e?.area,
        parameter: e?.parameter,
        contractCodeId: e?.contractCodeId,
        h1: fH1,
        h2: fH2,
        h3: fH3,
        h4: fH4,
        h5: fH5,
        h6: fH6,
        h7: fH7,
        h8: fH8,
        h9: fH9,
        h10: fH10,
        h11: fH11,
        h12: fH12,
        h13: fH13,
        h14: fH14,
        h15: fH15,
        h16: fH16,
        h17: fH17,
        h18: fH18,
        h19: fH19,
        h20: fH20,
        h21: fH21,
        h22: fH22,
        h23: fH23,
        h24: fH24,
      };
    });

    return intraday;
  }

  async intraday() {
    const resData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        query_shipper_nomination_status: {
          id: {
            in: [2, 5],
          },
        },
        AND: [
          {
            OR: [{ del_flag: false }, { del_flag: null }],
          },
        ],
      },
      include: {
        nomination_version: {
          where: {
            flag_use: true,
          },
          include: {
            nomination_full_json: true,
            nomination_row_json: true,
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
    // query_shipper_nomination_type_id 1

    const dailyData = [];

    const resDataCv = resData.map((e: any) => {
      const nomination_version = e['nomination_version'].map((nv: any) => {
        const nomination_full_json = nv['nomination_full_json'].map(
          (nfj: any) => {
            nfj['data_temp'] = JSON.parse(nfj['data_temp']);
            return { ...nfj };
          },
        );
        const nomination_row_json = nv['nomination_row_json'].map(
          (nfj: any) => {
            nfj['data_temp'] = JSON.parse(nfj['data_temp']);
            return { ...nfj };
          },
        );
        const nomination_row_json_use = nomination_row_json.filter((f: any) => {
          return (
            f?.query_shipper_nomination_type_id === 1 &&
            f?.data_temp['9'] === 'MMSCFD'
          );
        });
        // console.log('nomination_row_json_use : ', nomination_row_json_use);

        if (nomination_row_json_use.length > 0) {
          nomination_row_json_use.map((nx: any) => {
            dailyData.push({
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
            });

            return nx;
          });
        }

        return { ...nv, nomination_full_json, nomination_row_json_use };
      });

      return { ...e, nomination_version };
    });

    const dailyArr = dailyData.filter((f: any) => {
      return f?.nomination_type_id === 1;
    });
    const weeklyArr = dailyData.filter((f: any) => {
      return f?.nomination_type_id === 2;
    });
    const areaGroup = [
      ...new Set(dailyArr.map((gr: any) => gr?.nomination_row_json?.area_text)),
    ];

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
      include: {},
    });
    const zoneData = await this.prisma.zone.findMany({
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
        zone_master_quality: true,
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
      },
    });
    const contractCodeData = await this.prisma.contract_code.findMany({});

    const gasdayArrDaily = [
      ...new Set(dailyArr.map((es: any) => es?.gas_day_text)),
    ];
    const newDaily = gasdayArrDaily.flatMap((e: any) => {
      const fil = dailyArr.filter((f: any) => f?.gas_day_text === e);
      const areaGroupF = [
        ...new Set(fil.map((gr: any) => gr?.nomination_row_json?.area_text)),
      ];

      const areaAll = areaGroupF.flatMap((es: any, ies: any, aes: any) => {
        // fGf?.nomination_row_json?.area_text
        // console.log('fil : ', fil);
        // console.log('fil : ', fil);
        const filAreaGF = fil.filter((fGf: any) => {
          return fGf?.nomination_row_json?.area_text === es;
        });
        // console.log('zoneData : ', zoneData);
        // console.log('filAreaGF : ', filAreaGF);
        // filAreaGF[0]?.nomination_row_json?.data_temp["10"]
        // entry_exit_id
        const zoneTextObj =
          zoneData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.zone_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const areaTextObj =
          areaData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.area_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const gasDayText = filAreaGF[0]?.gas_day_text || null;
        const contractCodeId =
          contractCodeData.find(
            (f: any) => f?.id === filAreaGF[0]?.contract_code_id,
          ) || null;

        //wi nomination_row_json?.data_temp["11"]
        //hv nomination_row_json?.data_temp["12"]
        //sg nomination_row_json?.data_temp["13"]
        const aFil = filAreaGF.filter((f: any) => {
          return f?.nomination_row_json?.area_text === areaTextObj?.name;
        });
        const hvXvi =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    parseToNumber(item.nomination_row_json?.data_temp['38']),
                0,
              )
            : null; //wi excl
        const viAll =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['38']),
                0,
              )
            : null; //wi excl
        const sgXvi =
          aFil.length > 0 && viAll
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  Number(viAll) *
                    parseToNumber(item.nomination_row_json?.data_temp['38']),
                0,
              )
            : null; //wi excl
        // const sgXvi = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * parseToNumber(item.nomination_row_json?.data_temp["38"])), 0) : null; //wi excl

        // console.log(filAreaGF[0]?.nomination_row_json?.area_text);
        // console.log('hvXvi : ', hvXvi);
        // console.log('viAll : ', viAll);

        // for (let ii = 0; ii < aFil.length; ii++) {
        //   console.log(aFil[ii].nomination_row_json);
        //   console.log(`ii : ${aFil[ii].nomination_row_json?.data_temp["12"]} , vi : ${aFil[ii].nomination_row_json?.data_temp["38"]}`);

        // }
        // hv = sum(hv*vi)/ vi all
        const hv = hvXvi / viAll;
        // console.log('hv : ', hv);
        // wi = (sum(hv*vi)/0.982596)/(sqrt( sum(sg*vi) * vi all ))
        const wi = hvXvi / 0.982596 / Math.sqrt(sgXvi * viAll);
        // sg = sum(sg*vi)/ vi all
        const sg = sgXvi / viAll;

        return [
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'HV',
            valueBtuScf: hv,
            contractCodeId,
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'WI',
            valueBtuScf: wi,
            contractCodeId,
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'SG',
            valueBtuScf: sg,
            contractCodeId,
          },
        ];
      });

      return [...areaAll];
    });

    const gasdayArrWeekly = [
      ...new Set(weeklyArr.map((es: any) => es?.gas_day_text)),
    ];
    const newWeekly = gasdayArrWeekly.flatMap((e: any) => {
      const fil = weeklyArr.filter((f: any) => f?.gas_day_text === e);

      const areaGroupF = [
        ...new Set(fil.map((gr: any) => gr?.nomination_row_json?.area_text)),
      ];

      const areaAll = areaGroupF.flatMap((es: any, ies: any, aes: any) => {
        const filAreaGF = fil.filter((fGf: any) => {
          return fGf?.nomination_row_json?.area_text === es;
        });

        // const zoneTextObj = zoneData.find((f:any) => f?.name === filAreaGF[0]?.nomination_row_json?.zone_text) || null
        // const areaTextObj = areaData.find((f:any) => f?.name === filAreaGF[0]?.nomination_row_json?.area_text) || null
        const zoneTextObj =
          zoneData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.zone_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const areaTextObj =
          areaData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.area_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const gasDayText = filAreaGF[0]?.gas_day_text || null;
        const contractCodeId =
          contractCodeData.find(
            (f: any) => f?.id === filAreaGF[0]?.contract_code_id,
          ) || null;

        const sunday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['14'];
        const monday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['15'];
        const tuesday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['16'];
        const wednesday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['17'];
        const thursday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['18'];
        const friday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['19'];
        const saturday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['20'];

        const vi1 = filAreaGF[0]?.nomination_row_json?.data_temp[14]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[14])
          : null;
        const vi2 = filAreaGF[0]?.nomination_row_json?.data_temp[15]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[15])
          : null;
        const vi3 = filAreaGF[0]?.nomination_row_json?.data_temp[16]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[16])
          : null;
        const vi4 = filAreaGF[0]?.nomination_row_json?.data_temp[17]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[17])
          : null;
        const vi5 = filAreaGF[0]?.nomination_row_json?.data_temp[18]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[18])
          : null;
        const vi6 = filAreaGF[0]?.nomination_row_json?.data_temp[19]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[19])
          : null;
        const vi7 = filAreaGF[0]?.nomination_row_json?.data_temp[20]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[20])
          : null;
        //wi nomination_row_json?.data_temp["11"]
        //hv nomination_row_json?.data_temp["12"]
        //sg nomination_row_json?.data_temp["13"]
        const aFil = filAreaGF.filter((f: any) => {
          return f?.nomination_row_json?.area_text === areaTextObj?.name;
        });

        const hvXvi1 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi1,
                0,
              )
            : null;
        const viAll1 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi1, 0) : null;
        // const sgXvi1 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * vi1), 0) : null;
        const sgXvi1 =
          aFil.length > 0 && viAll1
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    Number(viAll1),
                0,
              )
            : null;

        const hvXvi2 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi2,
                0,
              )
            : null;
        const viAll2 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi2, 0) : null;
        // const sgXvi2 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * vi2), 0) : null;
        const sgXvi2 =
          aFil.length > 0 && viAll2
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    Number(viAll2),
                0,
              )
            : null;

        const hvXvi3 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi3,
                0,
              )
            : null;
        const viAll3 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi3, 0) : null;
        // const sgXvi3 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * vi3), 0) : null;
        const sgXvi3 =
          aFil.length > 0 && viAll3
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    Number(viAll3),
                0,
              )
            : null;

        const hvXvi4 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi4,
                0,
              )
            : null;
        const viAll4 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi4, 0) : null;
        // const sgXvi4 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * vi4), 0) : null;
        const sgXvi4 =
          aFil.length > 0 && viAll4
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    Number(viAll4),
                0,
              )
            : null;

        const hvXvi5 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi5,
                0,
              )
            : null;
        const viAll5 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi5, 0) : null;
        // const sgXvi5 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * vi5), 0) : null;
        const sgXvi5 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    Number(viAll5),
                0,
              )
            : null;

        const hvXvi6 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi6,
                0,
              )
            : null;
        const viAll6 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi6, 0) : null;
        // const sgXvi6 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * vi6), 0) : null;
        const sgXvi6 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    Number(viAll6),
                0,
              )
            : null;

        const hvXvi7 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi7,
                0,
              )
            : null;
        const viAll7 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi7, 0) : null;
        // const sgXvi7 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * vi7), 0) : null;
        const sgXvi7 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    Number(viAll7),
                0,
              )
            : null;

        // hv = sum(hv*vi)/ vi all
        const hv1 = hvXvi1 / viAll1;
        // wi = (sum(hv*vi)/0.982596)/(sqrt( sum(sg*vi) * vi all ))
        const wi1 = hvXvi1 / 0.982596 / Math.sqrt(sgXvi1 * viAll1);
        // sg = sum(sg*vi)/ vi all
        const sg1 = sgXvi1 / viAll1;

        const hv2 = hvXvi2 / viAll2;
        const wi2 = hvXvi2 / 0.982596 / Math.sqrt(sgXvi2 * viAll2);
        const sg2 = sgXvi2 / viAll2;

        const hv3 = hvXvi3 / viAll3;
        const wi3 = hvXvi3 / 0.982596 / Math.sqrt(sgXvi3 * viAll3);
        const sg3 = sgXvi3 / viAll3;

        const hv4 = hvXvi4 / viAll4;
        const wi4 = hvXvi4 / 0.982596 / Math.sqrt(sgXvi4 * viAll4);
        const sg4 = sgXvi4 / viAll4;

        const hv5 = hvXvi5 / viAll5;
        const wi5 = hvXvi5 / 0.982596 / Math.sqrt(sgXvi5 * viAll5);
        const sg5 = sgXvi5 / viAll5;

        const hv6 = hvXvi6 / viAll6;
        const wi6 = hvXvi6 / 0.982596 / Math.sqrt(sgXvi6 * viAll6);
        const sg6 = sgXvi6 / viAll6;

        const hv7 = hvXvi7 / viAll7;
        const wi7 = hvXvi7 / 0.982596 / Math.sqrt(sgXvi7 * viAll7);
        const sg7 = sgXvi7 / viAll7;

        return [
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'HV',
            contractCodeId,
            sunday: {
              date: sunday,
              value: hv1,
            },
            monday: {
              date: monday,
              value: hv2,
            },
            tuesday: {
              date: tuesday,
              value: hv3,
            },
            wednesday: {
              date: wednesday,
              value: hv4,
            },
            thursday: {
              date: thursday,
              value: hv5,
            },
            friday: {
              date: friday,
              value: hv6,
            },
            saturday: {
              date: saturday,
              value: hv7,
            },
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'WI',
            contractCodeId,
            sunday: {
              date: sunday,
              value: wi1,
            },
            monday: {
              date: monday,
              value: wi2,
            },
            tuesday: {
              date: tuesday,
              value: wi3,
            },
            wednesday: {
              date: wednesday,
              value: wi4,
            },
            thursday: {
              date: thursday,
              value: wi5,
            },
            friday: {
              date: friday,
              value: wi6,
            },
            saturday: {
              date: saturday,
              value: wi7,
            },
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'SG',
            contractCodeId,
            sunday: {
              date: sunday,
              value: sg1,
            },
            monday: {
              date: monday,
              value: sg2,
            },
            tuesday: {
              date: tuesday,
              value: sg3,
            },
            wednesday: {
              date: wednesday,
              value: sg4,
            },
            thursday: {
              date: thursday,
              value: sg5,
            },
            friday: {
              date: friday,
              value: sg6,
            },
            saturday: {
              date: saturday,
              value: sg7,
            },
          },
        ];
      });

      return [...areaAll];
    });

    // *** ทำเพิ่ม

    const day = (
      newDaily.length > 0 ? newDaily : newWeekly.length > 0 ? newWeekly : []
    ).map((e: any) => e?.gasday);
    // console.log('day : ', day);
    const daySet = [...new Set(day)].map((e: any) =>
      dayjs(e, 'DD/MM/YYYY').format('YYYY-MM-DD'),
    );
    // console.log('daySet : ', daySet);
    //   let gasDayArr = []
    //   for (let i = 0; i < daySet.length; i++) {
    //     const meteredMicroData = await this.meteredMicroService.sendMessage(JSON.stringify({
    //       case: "getLast",
    //       mode:"metering",

    //       start_date: daySet[i],
    //       end_date: daySet[i]
    //   }));

    //   const reply = !!meteredMicroData?.reply && JSON.parse(meteredMicroData?.reply) || null
    //   // console.log('reply : ', reply);

    //   gasDayArr.push({gasDay: daySet[i], data: reply})
    // }
    const findMinMaxDate = (dateArray) => {
      if (!dateArray || dateArray.length === 0) {
        return { minDate: null, maxDate: null };
      }

      let minDate = dateArray[0];
      let maxDate = dateArray[0];

      for (const dateStr of dateArray) {
        if (dateStr < minDate) {
          minDate = dateStr;
        }
        if (dateStr > maxDate) {
          maxDate = dateStr;
        }
      }

      return { minDate, maxDate };
    };

    const nDay = findMinMaxDate(daySet);
    // { minDate: '2025-06-10', maxDate: '2025-07-03' }
    // console.log('nDay : ', nDay);

    // Extract gas days and generate date array
    const getMeterFrom = nDay?.minDate ? getTodayNow(nDay.minDate) : null;
    const getMeterTo = nDay?.maxDate ? getTodayNow(nDay.maxDate) : null;
    if (!getMeterFrom || !getMeterTo) {
      return [];
    }
    const dateArray: string[] = [];
    // Fill dateArray with all dates between getMeterFrom and getMeterTo (inclusive) in YYYY-MM-DD format
    let current = getMeterFrom.clone();
    while (current.isSameOrBefore(getMeterTo, 'day')) {
      dateArray.push(current.format('YYYY-MM-DD'));
      current = current.add(1, 'day');
    }
    // Build active data for all dates
    const activeData = await buildActiveDataForDates(dateArray, this.prisma);

    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: 'getLast',
        mode: 'metering',

        start_date: nDay?.minDate,
        end_date: nDay?.maxDate,
      }),
      {
        activeData,
        prisma: this.prisma,
      },
    );
    const reply =
      (!!meteredMicroData?.reply && JSON.parse(meteredMicroData?.reply)) ||
      null;
    // console.log('reply : ', reply);

    const gasDayArr = [];
    for (let i = 0; i < daySet.length; i++) {
      //   const meteredMicroData = await this.meteredMicroService.sendMessage(JSON.stringify({
      //     case: "getLast",
      //     mode:"metering",

      //     start_date: daySet[i],
      //     end_date: daySet[i]
      // }));

      // const reply = !!meteredMicroData?.reply && JSON.parse(meteredMicroData?.reply) || null
      // console.log('reply : ', reply);
      // gasDayArr.push({gasDay: daySet[i], data: reply})
      const fDaty = reply?.filter((f: any) => f?.gasDay === daySet[i]);
      gasDayArr.push({ gasDay: daySet[i], data: fDaty });
    }
    // console.log('meterData : ', meterData);
    const intraday = (
      newDaily.length > 0 ? newDaily : newWeekly.length > 0 ? newWeekly : []
    ).map((e: any) => {
      const fil = gasDayArr.filter((f: any) => {
        return (
          dayjs(f?.gasDay, 'YYYY-MM-DD').format('DD/MM/YYYY') === e?.gasday
        );
      });
      const fMeter = meterData
        .filter((f: any) => {
          return (
            f?.area?.name === e?.area?.name && f?.zone?.name === e?.zone?.name
          );
        })
        ?.map((mn: any) => mn?.metered_point_name);
      const filA = fil.map((fA: any) => fA?.data).flat();
      const filData = filA?.filter((f: any) => {
        return fMeter.includes(f?.meteringPointId);
      });
      // console.log('filData : ', filData);
      // registerTimestamp
      // energy
      // heatingValue
      // wobbeIndex
      // sg
      // volume

      // e?.parameter

      const fHrIn0 = (payl: any, hr: any) =>
        (payl || []).filter((f: any) => {
          return dayjs(f?.registerTimestamp).format('HH') === hr;
        });

      let fH1 = fHrIn0(filData, '00');
      let fH2 = fHrIn0(filData, '01');
      let fH3 = fHrIn0(filData, '02');
      let fH4 = fHrIn0(filData, '03');
      let fH5 = fHrIn0(filData, '04');
      let fH6 = fHrIn0(filData, '05');
      let fH7 = fHrIn0(filData, '06');
      let fH8 = fHrIn0(filData, '07');
      let fH9 = fHrIn0(filData, '08');
      let fH10 = fHrIn0(filData, '09');
      let fH11 = fHrIn0(filData, '10');
      let fH12 = fHrIn0(filData, '11');
      let fH13 = fHrIn0(filData, '12');
      let fH14 = fHrIn0(filData, '13');
      let fH15 = fHrIn0(filData, '14');
      let fH16 = fHrIn0(filData, '15');
      let fH17 = fHrIn0(filData, '16');
      let fH18 = fHrIn0(filData, '17');
      let fH19 = fHrIn0(filData, '18');
      let fH20 = fHrIn0(filData, '19');
      let fH21 = fHrIn0(filData, '20');
      let fH22 = fHrIn0(filData, '21');
      let fH23 = fHrIn0(filData, '22');
      let fH24 = fHrIn0(filData, '23');

      const calcParameter = (hourCalc: any) => {
        if (hourCalc.length > 0) {
          // console.log('e?.gasday : ', e?.gasday);
          // console.log('hourCalc : ', hourCalc);
          const hvXvi =
            hourCalc.length > 0
              ? hourCalc.reduce(
                  (sum, item) =>
                    sum + Number(item.heatingValue) * Number(item.volume),
                  0,
                )
              : null;
          const viAll =
            hourCalc.length > 0
              ? hourCalc.reduce((sum, item) => sum + Number(item.volume), 0)
              : null;
          // const sgXvi = hourCalc.length > 0 ? hourCalc.reduce((sum, item) => sum + (Number(item.sg) * Number(item.volume)), 0) : null;
          const sgXvi =
            hourCalc.length > 0 && viAll
              ? hourCalc.reduce(
                  (sum, item) => sum + Number(item.sg) * Number(viAll),
                  0,
                )
              : null;
          // hv = sum(hv*vi)/ vi all
          const hv = hvXvi / viAll;
          // wi = (sum(hv*vi)/0.982596)/(sqrt( sum(sg*vi) * vi all ))
          // const wi = (hv / 0.982596) / Math.sqrt((sgXvi * viAll))
          const wi = hvXvi / 0.982596 / Math.sqrt(sgXvi * viAll);
          // sg = sum(sg*vi)/ vi all
          const sg = sgXvi / viAll;

          if (e?.parameter === 'HV') {
            // console.log('hv : ', hv);
            return (hv !== Infinity && hv) || 'Div/0';
          } else if (e?.parameter === 'WI') {
            // console.log('wi : ', wi);
            return (wi !== Infinity && wi) || 'Div/0';
          } else if (e?.parameter === 'SG') {
            // console.log('sg : ', sg);
            return (sg !== Infinity && sg) || 'Div/0';
          } else {
            return null;
          }
        } else {
          return null;
        }
      };

      fH1 = calcParameter(fH1);
      fH2 = calcParameter(fH2);
      fH3 = calcParameter(fH3);
      fH4 = calcParameter(fH4);
      fH5 = calcParameter(fH5);
      fH6 = calcParameter(fH6);
      fH7 = calcParameter(fH7);
      fH8 = calcParameter(fH8);
      fH9 = calcParameter(fH9);
      fH10 = calcParameter(fH10);
      fH11 = calcParameter(fH11);
      fH12 = calcParameter(fH12);
      fH13 = calcParameter(fH13);
      fH14 = calcParameter(fH14);
      fH15 = calcParameter(fH15);
      fH16 = calcParameter(fH16);
      fH17 = calcParameter(fH17);
      fH18 = calcParameter(fH18);
      fH19 = calcParameter(fH19);
      fH20 = calcParameter(fH20);
      fH21 = calcParameter(fH21);
      fH22 = calcParameter(fH22);
      fH23 = calcParameter(fH23);
      fH24 = calcParameter(fH24);

      return {
        gasday: e?.gasday,
        zone: e?.zone,
        area: e?.area,
        parameter: e?.parameter,
        contractCodeId: e?.contractCodeId,
        h1: fH1,
        h2: fH2,
        h3: fH3,
        h4: fH4,
        h5: fH5,
        h6: fH6,
        h7: fH7,
        h8: fH8,
        h9: fH9,
        h10: fH10,
        h11: fH11,
        h12: fH12,
        h13: fH13,
        h14: fH14,
        h15: fH15,
        h16: fH16,
        h17: fH17,
        h18: fH18,
        h19: fH19,
        h20: fH20,
        h21: fH21,
        h22: fH22,
        h23: fH23,
        h24: fH24,
      };
    });

    return {
      intraday,
      newDaily,
      newWeekly,
    };
  }

  async daily() {
    const resData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        query_shipper_nomination_status: {
          id: {
            in: [2, 5],
          },
        },
        AND: [
          {
            OR: [{ del_flag: false }, { del_flag: null }],
          },
        ],
      },
      include: {
        nomination_version: {
          where: {
            flag_use: true,
          },
          include: {
            nomination_full_json: true,
            nomination_row_json: true,
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
    // query_shipper_nomination_type_id 1

    const dailyData = [];

    const resDataCv = resData.map((e: any) => {
      const nomination_version = e['nomination_version'].map((nv: any) => {
        const nomination_full_json = nv['nomination_full_json'].map(
          (nfj: any) => {
            nfj['data_temp'] = JSON.parse(nfj['data_temp']);
            return { ...nfj };
          },
        );
        const nomination_row_json = nv['nomination_row_json'].map(
          (nfj: any) => {
            nfj['data_temp'] = JSON.parse(nfj['data_temp']);
            return { ...nfj };
          },
        );
        const nomination_row_json_use = nomination_row_json.filter((f: any) => {
          return (
            f?.query_shipper_nomination_type_id === 1 &&
            f?.data_temp['9'] === 'MMSCFD'
          );
        });
        // console.log('nomination_row_json_use : ', nomination_row_json_use);

        if (nomination_row_json_use.length > 0) {
          nomination_row_json_use.map((nx: any) => {
            dailyData.push({
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
            });

            return nx;
          });
        }

        return { ...nv, nomination_full_json, nomination_row_json_use };
      });

      return { ...e, nomination_version };
    });

    const dailyArr = dailyData.filter((f: any) => {
      return f?.nomination_type_id === 1;
    });

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
      include: {},
    });
    const zoneData = await this.prisma.zone.findMany({
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
        zone_master_quality: true,
      },
    });

    const contractCodeData = await this.prisma.contract_code.findMany({});

    const gasdayArrDaily = [
      ...new Set(dailyArr.map((es: any) => es?.gas_day_text)),
    ];
    const newDaily = gasdayArrDaily.flatMap((e: any) => {
      const fil = dailyArr.filter((f: any) => f?.gas_day_text === e);
      const areaGroupF = [
        ...new Set(fil.map((gr: any) => gr?.nomination_row_json?.area_text)),
      ];

      const areaAll = areaGroupF.flatMap((es: any, ies: any, aes: any) => {
        // fGf?.nomination_row_json?.area_text
        // console.log('fil : ', fil);
        // console.log('fil : ', fil);
        const filAreaGF = fil.filter((fGf: any) => {
          return fGf?.nomination_row_json?.area_text === es;
        });
        // console.log('zoneData : ', zoneData);
        // console.log('filAreaGF : ', filAreaGF);
        // filAreaGF[0]?.nomination_row_json?.data_temp["10"]
        // entry_exit_id
        const zoneTextObj =
          zoneData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.zone_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const areaTextObj =
          areaData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.area_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const gasDayText = filAreaGF[0]?.gas_day_text || null;
        const contractCodeId =
          contractCodeData.find(
            (f: any) => f?.id === filAreaGF[0]?.contract_code_id,
          ) || null;

        //wi nomination_row_json?.data_temp["11"]
        //hv nomination_row_json?.data_temp["12"]
        //sg nomination_row_json?.data_temp["13"]
        const aFil = filAreaGF.filter((f: any) => {
          return f?.nomination_row_json?.area_text === areaTextObj?.name;
        });
        const hvXvi =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    parseToNumber(item.nomination_row_json?.data_temp['38']),
                0,
              )
            : null; //wi excl
        const viAll =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['38']),
                0,
              )
            : null; //wi excl
        // const sgXvi = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * parseToNumber(item.nomination_row_json?.data_temp["38"])), 0) : null; //wi excl
        const sgXvi =
          aFil.length > 0 && viAll
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  Number(viAll) *
                    parseToNumber(item.nomination_row_json?.data_temp['38']),
                0,
              )
            : null; //wi excl

        // console.log(filAreaGF[0]?.nomination_row_json?.area_text);
        // console.log('hvXvi : ', hvXvi);
        // console.log('viAll : ', viAll);

        // for (let ii = 0; ii < aFil.length; ii++) {
        //   console.log(aFil[ii].nomination_row_json);
        //   console.log(`ii : ${aFil[ii].nomination_row_json?.data_temp["12"]} , vi : ${aFil[ii].nomination_row_json?.data_temp["38"]}`);

        // }
        // hv = sum(hv*vi)/ vi all
        const hv = hvXvi / viAll;
        // console.log('hv : ', hv);
        // wi = (sum(hv*vi)/0.982596)/(sqrt( sum(sg*vi) * vi all ))
        const wi = hvXvi / 0.982596 / Math.sqrt(sgXvi * viAll);
        // sg = sum(sg*vi)/ vi all
        const sg = sgXvi / viAll;

        return [
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'HV',
            valueBtuScf: hv,
            contractCodeId,
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'WI',
            valueBtuScf: wi,
            contractCodeId,
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'SG',
            valueBtuScf: sg,
            contractCodeId,
          },
        ];
      });

      return [...areaAll];
    });

    return {
      newDaily,
    };
  }

  async weekly() {
    const resData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        query_shipper_nomination_status: {
          id: {
            in: [2, 5],
          },
        },
        AND: [
          {
            OR: [{ del_flag: false }, { del_flag: null }],
          },
        ],
      },
      include: {
        nomination_version: {
          where: {
            flag_use: true,
          },
          include: {
            nomination_full_json: true,
            nomination_row_json: true,
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
    // query_shipper_nomination_type_id 1

    const dailyData = [];

    const resDataCv = resData.map((e: any) => {
      const nomination_version = e['nomination_version'].map((nv: any) => {
        const nomination_full_json = nv['nomination_full_json'].map(
          (nfj: any) => {
            nfj['data_temp'] = JSON.parse(nfj['data_temp']);
            return { ...nfj };
          },
        );
        const nomination_row_json = nv['nomination_row_json'].map(
          (nfj: any) => {
            nfj['data_temp'] = JSON.parse(nfj['data_temp']);
            return { ...nfj };
          },
        );
        const nomination_row_json_use = nomination_row_json.filter((f: any) => {
          return (
            f?.query_shipper_nomination_type_id === 1 &&
            f?.data_temp['9'] === 'MMSCFD'
          );
        });
        // console.log('nomination_row_json_use : ', nomination_row_json_use);

        if (nomination_row_json_use.length > 0) {
          nomination_row_json_use.map((nx: any) => {
            dailyData.push({
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
            });

            return nx;
          });
        }

        return { ...nv, nomination_full_json, nomination_row_json_use };
      });

      return { ...e, nomination_version };
    });

    const dailyArr = dailyData.filter((f: any) => {
      return f?.nomination_type_id === 1;
    });
    const weeklyArr = dailyData.filter((f: any) => {
      return f?.nomination_type_id === 2;
    });
    const areaGroup = [
      ...new Set(dailyArr.map((gr: any) => gr?.nomination_row_json?.area_text)),
    ];

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
      include: {},
    });
    const zoneData = await this.prisma.zone.findMany({
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
        zone_master_quality: true,
      },
    });
    const contractCodeData = await this.prisma.contract_code.findMany({});

    const gasdayArrWeekly = [
      ...new Set(weeklyArr.map((es: any) => es?.gas_day_text)),
    ];
    const newWeekly = gasdayArrWeekly.flatMap((e: any) => {
      const fil = weeklyArr.filter((f: any) => f?.gas_day_text === e);

      const areaGroupF = [
        ...new Set(fil.map((gr: any) => gr?.nomination_row_json?.area_text)),
      ];

      const areaAll = areaGroupF.flatMap((es: any, ies: any, aes: any) => {
        const filAreaGF = fil.filter((fGf: any) => {
          return fGf?.nomination_row_json?.area_text === es;
        });

        // const zoneTextObj = zoneData.find((f:any) => f?.name === filAreaGF[0]?.nomination_row_json?.zone_text) || null
        // const areaTextObj = areaData.find((f:any) => f?.name === filAreaGF[0]?.nomination_row_json?.area_text) || null
        const zoneTextObj =
          zoneData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.zone_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const areaTextObj =
          areaData.find(
            (f: any) =>
              f?.name === filAreaGF[0]?.nomination_row_json?.area_text &&
              (f?.entry_exit_id === 1 ? 'Entry' : 'Exit') ===
                filAreaGF[0]?.nomination_row_json?.data_temp['10'],
          ) || null;
        const gasDayText = filAreaGF[0]?.gas_day_text || null;
        const contractCodeId =
          contractCodeData.find(
            (f: any) => f?.id === filAreaGF[0]?.contract_code_id,
          ) || null;

        const sunday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['14'];
        const monday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['15'];
        const tuesday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['16'];
        const wednesday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['17'];
        const thursday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['18'];
        const friday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['19'];
        const saturday =
          filAreaGF[0]?.nomination_full_json?.data_temp?.headData['20'];

        const vi1 = filAreaGF[0]?.nomination_row_json?.data_temp[14]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[14])
          : null;
        const vi2 = filAreaGF[0]?.nomination_row_json?.data_temp[15]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[15])
          : null;
        const vi3 = filAreaGF[0]?.nomination_row_json?.data_temp[16]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[16])
          : null;
        const vi4 = filAreaGF[0]?.nomination_row_json?.data_temp[17]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[17])
          : null;
        const vi5 = filAreaGF[0]?.nomination_row_json?.data_temp[18]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[18])
          : null;
        const vi6 = filAreaGF[0]?.nomination_row_json?.data_temp[19]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[19])
          : null;
        const vi7 = filAreaGF[0]?.nomination_row_json?.data_temp[20]
          ? parseToNumber(filAreaGF[0].nomination_row_json.data_temp[20])
          : null;
        //wi nomination_row_json?.data_temp["11"]
        //hv nomination_row_json?.data_temp["12"]
        //sg nomination_row_json?.data_temp["13"]
        const aFil = filAreaGF.filter((f: any) => {
          return f?.nomination_row_json?.area_text === areaTextObj?.name;
        });

        const hvXvi1 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi1,
                0,
              )
            : null;
        const viAll1 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi1, 0) : null;
        // const sgXvi1 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * vi1), 0) : null;
        const sgXvi1 =
          aFil.length > 0 && viAll1
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    Number(viAll1),
                0,
              )
            : null;

        const hvXvi2 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi2,
                0,
              )
            : null;
        const viAll2 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi2, 0) : null;
        // const sgXvi2 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * vi2), 0) : null;
        const sgXvi2 =
          aFil.length > 0 && viAll2
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    Number(viAll2),
                0,
              )
            : null;

        const hvXvi3 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi3,
                0,
              )
            : null;
        const viAll3 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi3, 0) : null;
        // const sgXvi3 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * vi3), 0) : null;
        const sgXvi3 =
          aFil.length > 0 && viAll3
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    Number(viAll3),
                0,
              )
            : null;

        const hvXvi4 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi4,
                0,
              )
            : null;
        const viAll4 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi4, 0) : null;
        // const sgXvi4 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * vi4), 0) : null;
        const sgXvi4 =
          aFil.length > 0 && viAll4
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    Number(viAll4),
                0,
              )
            : null;

        const hvXvi5 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi5,
                0,
              )
            : null;
        const viAll5 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi5, 0) : null;
        // const sgXvi5 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * vi5), 0) : null;
        const sgXvi5 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    Number(viAll5),
                0,
              )
            : null;

        const hvXvi6 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi6,
                0,
              )
            : null;
        const viAll6 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi6, 0) : null;
        // const sgXvi6 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * vi6), 0) : null;
        const sgXvi6 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    Number(viAll6),
                0,
              )
            : null;

        const hvXvi7 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['12']) *
                    vi7,
                0,
              )
            : null;
        const viAll7 =
          aFil.length > 0 ? aFil.reduce((sum, item) => sum + vi7, 0) : null;
        // const sgXvi7 = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * vi7), 0) : null;
        const sgXvi7 =
          aFil.length > 0
            ? aFil.reduce(
                (sum, item) =>
                  sum +
                  parseToNumber(item.nomination_row_json?.data_temp['13']) *
                    Number(viAll7),
                0,
              )
            : null;

        // hv = sum(hv*vi)/ vi all
        const hv1 = hvXvi1 / viAll1;
        // wi = (sum(hv*vi)/0.982596)/(sqrt( sum(sg*vi) * vi all ))
        const wi1 = hvXvi1 / 0.982596 / Math.sqrt(sgXvi1 * viAll1);
        // sg = sum(sg*vi)/ vi all
        const sg1 = sgXvi1 / viAll1;

        const hv2 = hvXvi2 / viAll2;
        const wi2 = hvXvi2 / 0.982596 / Math.sqrt(sgXvi2 * viAll2);
        const sg2 = sgXvi2 / viAll2;

        const hv3 = hvXvi3 / viAll3;
        const wi3 = hvXvi3 / 0.982596 / Math.sqrt(sgXvi3 * viAll3);
        const sg3 = sgXvi3 / viAll3;

        const hv4 = hvXvi4 / viAll4;
        const wi4 = hvXvi4 / 0.982596 / Math.sqrt(sgXvi4 * viAll4);
        const sg4 = sgXvi4 / viAll4;

        const hv5 = hvXvi5 / viAll5;
        const wi5 = hvXvi5 / 0.982596 / Math.sqrt(sgXvi5 * viAll5);
        const sg5 = sgXvi5 / viAll5;

        const hv6 = hvXvi6 / viAll6;
        const wi6 = hvXvi6 / 0.982596 / Math.sqrt(sgXvi6 * viAll6);
        const sg6 = sgXvi6 / viAll6;

        const hv7 = hvXvi7 / viAll7;
        const wi7 = hvXvi7 / 0.982596 / Math.sqrt(sgXvi7 * viAll7);
        const sg7 = sgXvi7 / viAll7;

        return [
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'HV',
            contractCodeId,
            sunday: {
              date: sunday,
              value: hv1,
            },
            monday: {
              date: monday,
              value: hv2,
            },
            tuesday: {
              date: tuesday,
              value: hv3,
            },
            wednesday: {
              date: wednesday,
              value: hv4,
            },
            thursday: {
              date: thursday,
              value: hv5,
            },
            friday: {
              date: friday,
              value: hv6,
            },
            saturday: {
              date: saturday,
              value: hv7,
            },
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'WI',
            contractCodeId,
            sunday: {
              date: sunday,
              value: wi1,
            },
            monday: {
              date: monday,
              value: wi2,
            },
            tuesday: {
              date: tuesday,
              value: wi3,
            },
            wednesday: {
              date: wednesday,
              value: wi4,
            },
            thursday: {
              date: thursday,
              value: wi5,
            },
            friday: {
              date: friday,
              value: wi6,
            },
            saturday: {
              date: saturday,
              value: wi7,
            },
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: 'SG',
            contractCodeId,
            sunday: {
              date: sunday,
              value: sg1,
            },
            monday: {
              date: monday,
              value: sg2,
            },
            tuesday: {
              date: tuesday,
              value: sg3,
            },
            wednesday: {
              date: wednesday,
              value: sg4,
            },
            thursday: {
              date: thursday,
              value: sg5,
            },
            friday: {
              date: friday,
              value: sg6,
            },
            saturday: {
              date: saturday,
              value: sg7,
            },
          },
        ];
      });

      return [...areaAll];
    });

    return {
      newWeekly,
    };
  }

  // async test(){
  //   const meteredMicroData = await this.meteredMicroService.sendMessage(JSON.stringify({
  //       case: "getLastH",
  //       mode:"metering",

  //       start_date: "2025-09-01",
  //       end_date: "2025-09-21"
  //   }));
  //   console.log('meteredMicroData : ', meteredMicroData);
  //   return JSON.stringify(meteredMicroData)
  // }
}
