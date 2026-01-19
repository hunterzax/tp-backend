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
import { getTodayEndAdd7, getTodayNowAdd7, getTodayNowDDMMYYYYAdd7, getTodayStartAdd7, getWeekRange } from 'src/common/utils/date.util';
import { isMatch } from 'src/common/utils/allcation.util';
import { parseToNumber, parseToNumber3Decimal } from 'src/common/utils/number.util';

dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);

@Injectable()
export class QualityEvaluationService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    // @Inject(CACHE_MANAGER) private cacheService: Cache,
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

  async findAll(query?: {
    gasDay?: string;
  }) {
    // https://app.clickup.com/t/86etubk74
    // https://app.clickup.com/t/86etubavw
    const andInWhere: any[] = [
      {
        query_shipper_nomination_status: {
          id: {
            in: [1, 2, 5],
          },
        }
      },
      {
        OR: [{ del_flag: false }, { del_flag: null }],
      }
    ]

    if (query?.gasDay) {
      andInWhere.push({
        gas_day: {
          equals: getTodayStartAdd7(query.gasDay).toDate()
        }
      });
    }

    const resData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        AND: andInWhere,
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

    const dailyData = []

    const resDataCv = resData.map((e: any) => {
      const nomination_version = e["nomination_version"].map((nv: any) => {
        const nomination_full_json = nv["nomination_full_json"].map((nfj: any) => {
          nfj["data_temp"] = this.safeParseJSON(nfj["data_temp"])
          return { ...nfj }
        })
        const nomination_row_json = nv["nomination_row_json"].map((nfj: any) => {
          nfj["data_temp"] = this.safeParseJSON(nfj["data_temp"])
          return { ...nfj }
        })
        const nomination_row_json_use = nomination_row_json.filter((f: any) => { return f?.query_shipper_nomination_type_id === 1 && f?.data_temp["9"] === "MMSCFD" })
        // console.log('nomination_row_json_use : ', nomination_row_json_use);

        if (nomination_row_json_use.length > 0) {
          nomination_row_json_use.map((nx: any) => {
            dailyData.push({
              nomination_type_id: e?.nomination_type_id,
              nomination_code: e?.nomination_code,
              gas_day: e?.gas_day,
              gas_day_text: dayjs(e?.gas_day).format("DD/MM/YYYY"),
              contract_code_id: e?.contract_code_id,
              group_id: e?.group_id,
              query_shipper_nomination_file_renom_id: e?.query_shipper_nomination_file_renom_id,
              submitted_timestamp: e?.submitted_timestamp,
              nomination_full_json: nomination_full_json[0],
              nomination_row_json: nx
            })

            return nx
          })
        }

        return { ...nv, nomination_full_json, nomination_row_json_use }
      })

      return { ...e, nomination_version }
    })

    const dailyArr = dailyData.filter((f: any) => { return f?.nomination_type_id === 1 })
    const weeklyArr = dailyData.filter((f: any) => { return f?.nomination_type_id === 2 })
    const areaGroup = [...new Set(dailyArr.map((gr: any) => gr?.nomination_row_json?.area_text))]

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

      },
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
    const contractCodeData = await this.prisma.contract_code.findMany({
    });

    const gasdayArrDaily = [...new Set(dailyArr.map((es: any) => es?.gas_day_text))]
    const newDaily = gasdayArrDaily.flatMap((e: any) => {
      const fil = dailyArr.filter((f: any) => f?.gas_day_text === e)

      const areaGroupF = [...new Set(fil.map((gr: any) => gr?.nomination_row_json?.area_text))]

      const areaAll = areaGroupF.flatMap((es: any, ies: any, aes: any) => {
        const filAreaGF = fil.filter((fGf: any) => { return fGf?.nomination_row_json?.area_text === es })
        // entry_exit_id
        const areaTextObj = areaData.find((f: any) => f?.name === filAreaGF[0]?.nomination_row_json?.area_text && f?.entry_exit_id === filAreaGF[0]?.nomination_row_json?.entry_exit_id) || null
        const zoneTextObj = zoneData.find((f: any) => f?.name === filAreaGF[0]?.nomination_row_json?.zone_text && f?.entry_exit_id === filAreaGF[0]?.nomination_row_json?.entry_exit_id) || null
        const gasDayText = filAreaGF[0]?.gas_day_text || null
        const contractCodeId = contractCodeData.find((f: any) => f?.id === filAreaGF[0]?.contract_code_id) || null

        //wi nomination_row_json?.data_temp["11"]
        //hv nomination_row_json?.data_temp["12"]
        //sg nomination_row_json?.data_temp["13"]
        const aFil = filAreaGF.filter((f: any) => { return f?.nomination_row_json?.area_text === areaTextObj?.name })
        const hvXvi = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["12"]) * parseToNumber(item.nomination_row_json?.data_temp["38"])), 0) : null; //wi excl
        const sgXvi = aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["13"]) * parseToNumber(item.nomination_row_json?.data_temp["38"])), 0) : null; //wi excl
        const viAll = aFil.length > 0 ? aFil.reduce((sum, item) => sum + parseToNumber(item.nomination_row_json?.data_temp["38"]), 0) : null; //wi excl

        // hv = sum(hv*vi)/ vi all
        const hv = hvXvi / viAll
        // wi = (sum(hv*vi)/0.982596)/(sqrt( sum(sg*vi) * vi all )) 
        const wi = (hvXvi / 0.982596) / Math.sqrt((sgXvi * viAll))
        // sg = sum(sg*vi)/ vi all
        const sg = sgXvi / viAll

        return [
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: "HV",
            valueBtuScf: hv,
            contractCodeId
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: "WI",
            valueBtuScf: wi,
            contractCodeId
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: "SG",
            valueBtuScf: sg,
            contractCodeId
          }
        ]
      })

      return [
        ...areaAll
      ]

    })

    const gasdayArrWeekly = [...new Set(weeklyArr.map((es: any) => es?.gas_day_text))]
    const newWeekly = gasdayArrWeekly.flatMap((e: any) => {
      const fil = weeklyArr.filter((f: any) => f?.gas_day_text === e)

      const areaGroupF = [...new Set(fil.map((gr: any) => gr?.nomination_row_json?.area_text))]
      // console.log('fil : ', fil);
      // console.log('areaGroupF : ', areaGroupF);
      const areaAll = areaGroupF.flatMap((es: any, ies: any, aes: any) => {
        const filAreaGF = fil.filter((fGf: any) => { return fGf?.nomination_row_json?.area_text === es })

        const zoneTextObj = zoneData.find((f: any) => f?.name === filAreaGF[0]?.nomination_row_json?.zone_text && ((f?.entry_exit_id === 1 ? "Entry" : "Exit") === filAreaGF[0]?.nomination_row_json?.data_temp["10"])) || null
        const areaTextObj = areaData.find((f: any) => f?.name === filAreaGF[0]?.nomination_row_json?.area_text && ((f?.entry_exit_id === 1 ? "Entry" : "Exit") === filAreaGF[0]?.nomination_row_json?.data_temp["10"])) || null
        const gasDayText = filAreaGF[0]?.gas_day_text || null
        const contractCodeId = contractCodeData.find((f: any) => f?.id === filAreaGF[0]?.contract_code_id) || null
        // console.log('areaTextObj : ', areaTextObj);
        // console.log('filAreaGF[0] : ', filAreaGF[0]);
        const sunday = filAreaGF[0]?.nomination_full_json?.data_temp?.headData["14"]
        const monday = filAreaGF[0]?.nomination_full_json?.data_temp?.headData["15"]
        const tuesday = filAreaGF[0]?.nomination_full_json?.data_temp?.headData["16"]
        const wednesday = filAreaGF[0]?.nomination_full_json?.data_temp?.headData["17"]
        const thursday = filAreaGF[0]?.nomination_full_json?.data_temp?.headData["18"]
        const friday = filAreaGF[0]?.nomination_full_json?.data_temp?.headData["19"]
        const saturday = filAreaGF[0]?.nomination_full_json?.data_temp?.headData["20"]

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
          const filAreaGF_ = filAreaGF?.find((f: any) => f?.contract_code_id === contract_code_id)
          const viUse = filAreaGF_?.nomination_row_json?.data_temp[day_]
            ? parseToNumber(filAreaGF_?.nomination_row_json?.data_temp[day_])
            : null;
          return viUse
        }

        // console.log('vi1 : ', vi1);
        //wi nomination_row_json?.data_temp["11"]
        //hv nomination_row_json?.data_temp["12"]
        //sg nomination_row_json?.data_temp["13"]
        const aFil = filAreaGF.filter((f: any) => { return f?.nomination_row_json?.area_text === areaTextObj?.name })

        const hvxViFN = (day_: any) => {
          return aFil.length > 0 ? aFil.reduce((sum, item) => sum + (parseToNumber(item.nomination_row_json?.data_temp["12"]) * viFind(item?.contract_code_id, day_)), 0) : null;
        }
        const viAllFN = (day_: any) => {
          return aFil.length > 0 ? aFil.reduce((sum, item) => sum + viFind(item?.contract_code_id, 14), 0) : null;
        }
        const sgxViFN = (day_: any) => {
          return aFil.length > 0 ? aFil.reduce((sum, item) => {
            const calc = parseToNumber((parseToNumber3Decimal(item.nomination_row_json?.data_temp["13"]) * viFind(item?.contract_code_id, day_)))
            return sum + calc
          }, 0) : null;
        }
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

        const hv1 = hvXvi1 / viAll1
        // console.log('hv1 : ', hv1);
        // wi = (sum(hv*vi)/0.982596)/(sqrt( sum(sg*vi) * vi all )) 
        const wi1 = (hvXvi1 / 0.982596) / Math.sqrt((sgXvi1 * viAll1))
        // console.log('wi1 : ', wi1);
        // sg = sum(sg*vi)/ vi all
        const sg1 = sgXvi1 / viAll1
        // console.log('sg1 : ', sg1);

        const hv2 = hvXvi2 / viAll2
        const wi2 = (hvXvi2 / 0.982596) / Math.sqrt((sgXvi2 * viAll2))
        const sg2 = sgXvi2 / viAll2

        const hv3 = hvXvi3 / viAll3
        const wi3 = (hvXvi3 / 0.982596) / Math.sqrt((sgXvi3 * viAll3))
        const sg3 = sgXvi3 / viAll3

        const hv4 = hvXvi4 / viAll4
        const wi4 = (hvXvi4 / 0.982596) / Math.sqrt((sgXvi4 * viAll4))
        const sg4 = sgXvi4 / viAll4

        const hv5 = hvXvi5 / viAll5
        const wi5 = (hvXvi5 / 0.982596) / Math.sqrt((sgXvi5 * viAll5))
        const sg5 = sgXvi5 / viAll5

        const hv6 = hvXvi6 / viAll6
        const wi6 = (hvXvi6 / 0.982596) / Math.sqrt((sgXvi6 * viAll6))
        const sg6 = sgXvi6 / viAll6

        const hv7 = hvXvi7 / viAll7
        const wi7 = (hvXvi7 / 0.982596) / Math.sqrt((sgXvi7 * viAll7))
        const sg7 = sgXvi7 / viAll7

        return [
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: "HV",
            contractCodeId,
            sunday: {
              date: sunday,
              value: hv1
            },
            monday: {
              date: monday,
              value: hv2
            },
            tuesday: {
              date: tuesday,
              value: hv3
            },
            wednesday: {
              date: wednesday,
              value: hv4
            },
            thursday: {
              date: thursday,
              value: hv5
            },
            friday: {
              date: friday,
              value: hv6
            },
            saturday: {
              date: saturday,
              value: hv7
            },
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: "WI",
            contractCodeId,
            sunday: {
              date: sunday,
              value: wi1
            },
            monday: {
              date: monday,
              value: wi2
            },
            tuesday: {
              date: tuesday,
              value: wi3
            },
            wednesday: {
              date: wednesday,
              value: wi4
            },
            thursday: {
              date: thursday,
              value: wi5
            },
            friday: {
              date: friday,
              value: wi6
            },
            saturday: {
              date: saturday,
              value: wi7
            },
          },
          {
            gasday: gasDayText,
            zone: zoneTextObj,
            area: areaTextObj,
            parameter: "SG",
            contractCodeId,
            sunday: {
              date: sunday,
              value: sg1
            },
            monday: {
              date: monday,
              value: sg2
            },
            tuesday: {
              date: tuesday,
              value: sg3
            },
            wednesday: {
              date: wednesday,
              value: sg4
            },
            thursday: {
              date: thursday,
              value: sg5
            },
            friday: {
              date: friday,
              value: sg6
            },
            saturday: {
              date: saturday,
              value: sg7
            },
          },
        ]
      })

      return [
        ...areaAll
      ]

    })


    return {
      newDaily,
      newWeekly,
    }
  }

  async findHVByDateAndArea(payload: any, userId: any) {
    const { gasDay, area } = payload;
    const gasDayjs = gasDay ? getTodayNowDDMMYYYYAdd7(gasDay) : null;
    if (!gasDayjs || !gasDayjs.isValid()) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: 'Invalid gas day format',
          error: 'Invalid gas day format',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const { weekStart, weekEnd } = getWeekRange(gasDayjs.toDate());

    const res = await this.findAll({ gasDay: gasDayjs.tz('Asia/Bangkok').format('YYYY-MM-DD') })
    const weekStartDayjs = weekStart ? getTodayNowAdd7(weekStart) : null;

    if ((!res?.newWeekly || !Array.isArray(res.newWeekly) || res.newWeekly.length < 1) && weekStartDayjs && !weekStartDayjs.isSame(gasDayjs, 'day')) {
      const resForWeekly = await this.findAll({ gasDay: weekStartDayjs.tz('Asia/Bangkok').format('YYYY-MM-DD') })
      if (resForWeekly?.newWeekly && Array.isArray(resForWeekly.newWeekly) && resForWeekly.newWeekly.length > 0) {
        res.newWeekly = resForWeekly.newWeekly
      }
    }
    const hvDaily = res?.newDaily?.find((f: any) => isMatch(f?.parameter, 'HV') && isMatch(f?.area?.name, area))?.valueBtuScf
    let hvWeekly: number | null
    if (!hvDaily) {
      for (const f of res?.newWeekly) {
        if (isMatch(f?.parameter, 'HV') && isMatch(f?.area?.name, area)) {
          if (isMatch(f?.sunday?.date, gasDay)) {
            hvWeekly = f?.sunday?.value
            break;
          }
          else if (isMatch(f?.monday?.date, gasDay)) {
            hvWeekly = f?.monday?.value
            break
          }
          else if (isMatch(f?.tuesday?.date, gasDay)) {
            hvWeekly = f?.tuesday?.value
            break
          }
          else if (isMatch(f?.wednesday?.date, gasDay)) {
            hvWeekly = f?.wednesday?.value
            break
          }
          else if (isMatch(f?.thursday?.date, gasDay)) {
            hvWeekly = f?.thursday?.value
            break
          }
          else if (isMatch(f?.friday?.date, gasDay)) {
            hvWeekly = f?.friday?.value
            break
          }
          else if (isMatch(f?.saturday?.date, gasDay)) {
            hvWeekly = f?.saturday?.value
            break
          }
        }
      }
    }

    const hv = hvDaily || hvWeekly
    if (!hv) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: 'HV not found.',
          error: 'HV not found.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return hv
  }
}
