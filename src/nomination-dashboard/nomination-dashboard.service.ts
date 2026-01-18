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
import { getTodayEndAdd7, getTodayNowAdd7, getTodayStartAdd7 } from 'src/common/utils/date.util';
import { QualityEvaluationService } from 'src/quality-evaluation/quality-evaluation.service';
import { SummaryNominationReportService } from 'src/summary-nomination-report/summary-nomination-report.service';
import { QueryShipperNominationFileService } from 'src/query-shipper-nomination-file/query-shipper-nomination-file.service';
import { parseToNumber } from 'src/common/utils/number.util';

dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);

@Injectable()
export class NominationDashboardService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private readonly qualityEvaluationService: QualityEvaluationService,
    private readonly summaryNominationReportService: SummaryNominationReportService,
    private readonly queryShipperNominationFileService: QueryShipperNominationFileService,

    // @Inject(CACHE_MANAGER) private cacheService: Cache,
  ) { }


  async findAll(payload: any = null) {
    const { gas_day } = payload ?? {}
    // console.log('gas_day : ', gas_day);
    // console.log('getTodayNowAdd7(gas_day).toDate() : ', getTodayNowAdd7(gas_day).toDate());
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const eva = await this.qualityEvaluationService.findAll()
    const nomination = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        // ...(gas_day && { gas_day: getTodayNowAdd7(gas_day).add(7, "hour").toDate() }), // สำหรับ test
        query_shipper_nomination_status: {
          id: {
            notIn: [3, 4,] // https://app.clickup.com/t/86ev18ayj
          }
        },
        ...(gas_day && { gas_day: getTodayNowAdd7(gas_day).toDate() }),
        AND: [
          {
            OR: [
              { del_flag: false },
              { del_flag: null }
            ]
          }
        ]
      },
      include: {
        group: {
          select: {
            id: true,
            id_name: true,
            name: true,
          }
        },
        nomination_version: {
          include: {
            nomination_full_json: true,
            nomination_row_json: true,
            nomination_full_json_sheet2: true,
          },
          where: {
            flag_use: true,
          }
        },
        contract_code: {
          select: {
            id: true,
            contract_code: true,
            booking_version: {
              include: {
                booking_full_json: true,
                booking_row_json: true,
              },
              where: {
                flag_use: true,
              }
            }
          }
        },
        nomination_type: true,
      },
      orderBy: {
        id: "desc"
      },
      distinct: ['contract_code_id', 'nomination_type_id'],
    })

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
      include: {
        zone_master_quality: true,
      }
    });

    // console.log('zoneMaster : ', zoneMaster);

    const areaMaster = await this.prisma.area.findMany({
      where: { // ไม่กรองตามหน้าบ้านใน summary ไม่งั้นเดะไม่เหมือน
        // AND: [ 
        //   {
        //     start_date: {
        //       lte: todayEnd, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
        //     },
        //   },
        //   {
        //     OR: [
        //       { end_date: null }, // ถ้า end_date เป็น null
        //       { end_date: { gte: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
        //     ],
        //   },
        // ],
      },
      include: {
      }
    });

    // console.log('areaMaster : ', areaMaster);

    const summaryNominationReport = await this.summaryNominationReportService.findAll({ gas_day_text: getTodayNowAdd7(gas_day).format("DD/MM/YYYY") })
    // console.log('summaryNominationReport : ', summaryNominationReport);

    const fAreaQuantityD = summaryNominationReport?.area?.daily?.MMBTUD || []
    const fAreaQuantityW = summaryNominationReport?.area?.weekly?.MMBTUD || []

    const dailyNom = nomination.filter((f: any) => { return f?.nomination_type_id === 1 })
    const weeklyNom = nomination.filter((f: any) => { return f?.nomination_type_id === 2 })
    const filDayDFormEva = eva?.newDaily?.filter((f: any) => f?.gasday === dayjs(gas_day, "YYYY-MM-DD").format("DD/MM/YYYY"))?.filter((f: any) => f?.parameter === "HV" || f?.parameter === "WI") || []
    const filDayWFormEva = eva?.newWeekly?.filter((f: any) => f?.gasday === dayjs(gas_day, "YYYY-MM-DD").format("DD/MM/YYYY"))?.filter((f: any) => f?.parameter === "HV" || f?.parameter === "WI") || []

    // ปรับข้อมูล

    const daily = dailyNom.map((e: any) => {
      const { entry_quality, overuse_quantity, over_maximum_hour_capacity_right, ...nE } = e //เอาค่า validate ตอน upload ออก
      return { ...nE }
    })
    const weekly = weeklyNom.map((e: any) => {
      const { entry_quality, overuse_quantity, over_maximum_hour_capacity_right, ...nE } = e //เอาค่า validate ตอน upload ออก
      return { ...nE }
    })

    // console.log('daily : ', daily);
    // console.log('weekly : ', weekly);

    // ✔ false
    // ✖ true

    const fnCheckDay = (valValidate: any) => {
      // daily valueBookDay คือค่าจาก Day Capacity Daily Booking (MMBTU/d)
      if (parseToNumber(valValidate?.value) > parseToNumber(valValidate?.valueBookDay)) {
        return true
      }
    }

    const fnCheck = (valValidate: any) => {
      // daily valueBook คือค่าจาก Hour Maximum Hour Booking (MMBTU/h)
      // weekly valueBook คือค่าจาก Day Capacity Daily Booking (MMBTU/d)
      if (parseToNumber(valValidate?.value) > parseToNumber(valValidate?.valueBook)) {
        return true
      }
    }


    const fnCheckSheet2 = (valValidate: any, zone: any) => {

      let validate = false
      for (let i = 0; i < valValidate.length; i++) {
        // const find = zoneMaster?.zone_master_quality?.[0]
        const findZone = zoneMaster?.filter((f: any) => f?.name === valValidate[i]?.["0"])
        if (findZone?.length > 0) {
          for (let iz = 0; iz < findZone.length; iz++) {
            // key 2 'CO2' Carbon - v2_carbon_dioxide_min v2_carbon_dioxide_max
            if (!!valValidate[i]?.["2"] && (findZone?.[iz]?.zone_master_quality?.[0]?.v2_carbon_dioxide_min !== null || findZone?.[iz]?.zone_master_quality?.[0]?.v2_carbon_dioxide_max !== null)) {
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_carbon_dioxide_min !== null && Number(valValidate[i]?.["2"]) < findZone?.[iz]?.zone_master_quality?.[0]?.v2_carbon_dioxide_min) {
                validate = true
                break
              }
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_carbon_dioxide_max !== null && Number(valValidate[i]?.["2"]) > findZone?.[iz]?.zone_master_quality?.[0]?.v2_carbon_dioxide_max) {
                validate = true
                break
              }
            }
            // key 3 'C1' dioxide	Methane - v2_methane_min v2_methane_max
            if (!!valValidate[i]?.["3"] && (findZone?.[iz]?.zone_master_quality?.[0]?.v2_methane_min !== null || findZone?.[iz]?.zone_master_quality?.[0]?.v2_methane_max !== null)) {
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_methane_min !== null && Number(valValidate[i]?.["3"]) < findZone?.[iz]?.zone_master_quality?.[0]?.v2_methane_min) {
                validate = true
                break
              }
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_methane_max !== null && Number(valValidate[i]?.["3"]) > findZone?.[iz]?.zone_master_quality?.[0]?.v2_methane_max) {
                validate = true
                break
              }
            }
            // key 12 'C2+' C2+	- v2_c2_plus_min v2_c2_plus_max
            if (!!valValidate[i]?.["12"] && (findZone?.[iz]?.zone_master_quality?.[0]?.v2_c2_plus_min !== null || findZone?.[iz]?.zone_master_quality?.[0]?.v2_c2_plus_max !== null)) {
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_c2_plus_min !== null && Number(valValidate[i]?.["12"]) < findZone?.[iz]?.zone_master_quality?.[0]?.v2_c2_plus_min) {
                validate = true
                break
              }
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_c2_plus_max !== null && Number(valValidate[i]?.["12"]) > findZone?.[iz]?.zone_master_quality?.[0]?.v2_c2_plus_max) {
                validate = true
                break
              }
            }
            // key 13 'N2' Nitrogen	- v2_nitrogen_min v2_nitrogen_max
            if (!!valValidate[i]?.["13"] && (findZone?.[iz]?.zone_master_quality?.[0]?.v2_nitrogen_min !== null || findZone?.[iz]?.zone_master_quality?.[0]?.v2_nitrogen_max !== null)) {
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_nitrogen_min !== null && Number(valValidate[i]?.["13"]) < findZone?.[iz]?.zone_master_quality?.[0]?.v2_nitrogen_min) {
                validate = true
                break
              }
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_nitrogen_max !== null && Number(valValidate[i]?.["13"]) > findZone?.[iz]?.zone_master_quality?.[0]?.v2_nitrogen_max) {
                validate = true
                break
              }
            }
            // key 14 'O2' Oxgen - v2_oxygen_min v2_oxygen_max
            if (!!valValidate[i]?.["14"] && (findZone?.[iz]?.zone_master_quality?.[0]?.v2_oxygen_min !== null || findZone?.[iz]?.zone_master_quality?.[0]?.v2_oxygen_max !== null)) {
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_oxygen_min !== null && Number(valValidate[i]?.["14"]) < findZone?.[iz]?.zone_master_quality?.[0]?.v2_oxygen_min) {
                validate = true
                break
              }
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_oxygen_max !== null && Number(valValidate[i]?.["14"]) > findZone?.[iz]?.zone_master_quality?.[0]?.v2_oxygen_max) {
                validate = true
                break
              }
            }
            // key 15 'H2S' Hydrogen Sulfide - v2_hydrogen_sulfide_min v2_hydrogen_sulfide_max
            if (!!valValidate[i]?.["15"] && (findZone?.[iz]?.zone_master_quality?.[0]?.v2_hydrogen_sulfide_min !== null || findZone?.[iz]?.zone_master_quality?.[0]?.v2_hydrogen_sulfide_max !== null)) {
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_hydrogen_sulfide_min !== null && Number(valValidate[i]?.["15"]) < findZone?.[iz]?.zone_master_quality?.[0]?.v2_hydrogen_sulfide_min) {
                validate = true
                break
              }
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_hydrogen_sulfide_max !== null && Number(valValidate[i]?.["15"]) > findZone?.[iz]?.zone_master_quality?.[0]?.v2_hydrogen_sulfide_max) {
                validate = true
                break
              }
            }
            // key 16 'S' Total Sulphur - v2_total_sulphur_min v2_total_sulphur_max
            if (!!valValidate[i]?.["16"] && (findZone?.[iz]?.zone_master_quality?.[0]?.v2_total_sulphur_min !== null || findZone?.[iz]?.zone_master_quality?.[0]?.v2_total_sulphur_max !== null)) {
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_total_sulphur_min !== null && Number(valValidate[i]?.["16"]) < findZone?.[iz]?.zone_master_quality?.[0]?.v2_total_sulphur_min) {
                validate = true
                break
              }
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_total_sulphur_max !== null && Number(valValidate[i]?.["16"]) > findZone?.[iz]?.zone_master_quality?.[0]?.v2_total_sulphur_max) {
                validate = true
                break
              }
            }
            // key 17 'Hg' Mercury - v2_mercury_min v2_mercury_max
            if (!!valValidate[i]?.["17"] && (findZone?.[iz]?.zone_master_quality?.[0]?.v2_mercury_min !== null || findZone?.[iz]?.zone_master_quality?.[0]?.v2_mercury_max !== null)) {
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_mercury_min !== null && Number(valValidate[i]?.["17"]) < findZone?.[iz]?.zone_master_quality?.[0]?.v2_mercury_min) {
                validate = true
                break
              }
              if (findZone?.[iz]?.zone_master_quality?.[0]?.v2_mercury_max !== null && Number(valValidate[i]?.["17"]) > findZone?.[iz]?.zone_master_quality?.[0]?.v2_mercury_max) {
                validate = true
                break
              }
            }
          }
        }
        if (validate) {
          break
        }
        // console.log('findZone : ', findZone);
      }
      // console.log('- - - - - - - - -');

      return validate
    }

    // daily
    const nDaily = []
    if (daily?.length > 0) {
      for (let i = 0; i < daily.length; i++) {
        const validate = await this.queryShipperNominationFileService.versionValidate({
          "nomination_type_id": 1,
          "contract_code_id": daily[i]?.contract_code_id,
          "nomination_version_id": daily[i]?.nomination_version?.[0]?.id
        }, null)
        const validateCut = (validate || [])?.filter((f: any) => f?.query_shipper_nomination_type_id === 1)
        // console.log('validateCut : ', validateCut);
        const validateData = (validateCut || [])?.map((e: any) => e?.newObj)
        // console.log('validateData : ', validateData);
        const sheet2 = daily[i]?.nomination_version?.[0]?.nomination_full_json_sheet2
        const convertSheet2 = (sheet2 || [])?.length > 0 ? JSON.parse(sheet2?.[0]?.data_temp) : null
        // console.log('convertSheet2 : ', convertSheet2);
        // fnCheckSheet2
        // DW entry_quality -- sheet 2 nom
        let entry_quality = false
        if (convertSheet2 !== null && (convertSheet2?.valueData || [])?.length > 0) {
          const checkSheet2 = fnCheckSheet2(convertSheet2?.valueData, zoneMaster)
          entry_quality = checkSheet2
        }

        // DW overuse_quantity
        let overuse_quantity = false
        for (let val = 0; val < validateData.length; val++) {
          const H1 = fnCheckDay(validateData[val]["14"])
          if (H1) {
            overuse_quantity = true;
            break
          }
          const H2 = fnCheckDay(validateData[val]["15"])
          if (H2) {
            overuse_quantity = true;
            break
          }
          const H3 = fnCheckDay(validateData[val]["16"])
          if (H3) {
            overuse_quantity = true;
            break
          }
          const H4 = fnCheckDay(validateData[val]["17"])
          if (H4) {
            overuse_quantity = true;
            break
          }
          const H5 = fnCheckDay(validateData[val]["18"])
          if (H5) {
            overuse_quantity = true;
            break
          }
          const H6 = fnCheckDay(validateData[val]["19"])
          if (H6) {
            overuse_quantity = true;
            break
          }
          const H7 = fnCheckDay(validateData[val]["20"])
          if (H7) {
            overuse_quantity = true;
            break
          }
          const H8 = fnCheckDay(validateData[val]["21"])
          if (H8) {
            overuse_quantity = true;
            break
          }
          const H9 = fnCheckDay(validateData[val]["22"])
          if (H9) {
            overuse_quantity = true;
            break
          }
          const H10 = fnCheckDay(validateData[val]["23"])
          if (H10) {
            overuse_quantity = true;
            break
          }
          const H11 = fnCheckDay(validateData[val]["24"])
          if (H11) {
            overuse_quantity = true;
            break
          }
          const H12 = fnCheckDay(validateData[val]["25"])
          if (H12) {
            overuse_quantity = true;
            break
          }
          const H13 = fnCheckDay(validateData[val]["26"])
          if (H13) {
            overuse_quantity = true;
            break
          }
          const H14 = fnCheckDay(validateData[val]["27"])
          if (H14) {
            overuse_quantity = true;
            break
          }
          const H15 = fnCheckDay(validateData[val]["28"])
          if (H15) {
            overuse_quantity = true;
            break
          }
          const H16 = fnCheckDay(validateData[val]["29"])
          if (H16) {
            overuse_quantity = true;
            break
          }
          const H17 = fnCheckDay(validateData[val]["30"])
          if (H17) {
            overuse_quantity = true;
            break
          }
          const H18 = fnCheckDay(validateData[val]["31"])
          if (H18) {
            overuse_quantity = true;
            break
          }
          const H19 = fnCheckDay(validateData[val]["32"])
          if (H19) {
            overuse_quantity = true;
            break
          }
          const H20 = fnCheckDay(validateData[val]["33"])
          if (H20) {
            overuse_quantity = true;
            break
          }
          const H21 = fnCheckDay(validateData[val]["34"])
          if (H21) {
            overuse_quantity = true;
            break
          }
          const H22 = fnCheckDay(validateData[val]["35"])
          if (H22) {
            overuse_quantity = true;
            break
          }
          const H23 = fnCheckDay(validateData[val]["36"])
          if (H23) {
            overuse_quantity = true;
            break
          }
          const H24 = fnCheckDay(validateData[val]["37"])
          if (H24) {
            overuse_quantity = true;
            break
          }
        }

        // D over_maximum_hour_capacity_right H
        let over_maximum_hour_capacity_right = false
        for (let val = 0; val < validateData.length; val++) {
          const H1 = fnCheck(validateData[val]["14"])
          if (H1) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H2 = fnCheck(validateData[val]["15"])
          if (H2) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H3 = fnCheck(validateData[val]["16"])
          if (H3) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H4 = fnCheck(validateData[val]["17"])
          if (H4) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H5 = fnCheck(validateData[val]["18"])
          if (H5) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H6 = fnCheck(validateData[val]["19"])
          if (H6) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H7 = fnCheck(validateData[val]["20"])
          if (H7) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H8 = fnCheck(validateData[val]["21"])
          if (H8) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H9 = fnCheck(validateData[val]["22"])
          if (H9) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H10 = fnCheck(validateData[val]["23"])
          if (H10) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H11 = fnCheck(validateData[val]["24"])
          if (H11) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H12 = fnCheck(validateData[val]["25"])
          if (H12) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H13 = fnCheck(validateData[val]["26"])
          if (H13) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H14 = fnCheck(validateData[val]["27"])
          if (H14) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H15 = fnCheck(validateData[val]["28"])
          if (H15) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H16 = fnCheck(validateData[val]["29"])
          if (H16) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H17 = fnCheck(validateData[val]["30"])
          if (H17) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H18 = fnCheck(validateData[val]["31"])
          if (H18) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H19 = fnCheck(validateData[val]["32"])
          if (H19) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H20 = fnCheck(validateData[val]["33"])
          if (H20) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H21 = fnCheck(validateData[val]["34"])
          if (H21) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H22 = fnCheck(validateData[val]["35"])
          if (H22) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H23 = fnCheck(validateData[val]["36"])
          if (H23) {
            over_maximum_hour_capacity_right = true;
            break
          }
          const H24 = fnCheck(validateData[val]["37"])
          if (H24) {
            over_maximum_hour_capacity_right = true;
            break
          }
        }

        nDaily?.push({
          ...daily[i],
          entry_quality: entry_quality,
          overuse_quantity: overuse_quantity,
          over_maximum_hour_capacity_right: over_maximum_hour_capacity_right,
        })
      }
    }

    const nWeekly = []
    if (weekly?.length > 0) {
      for (let i = 0; i < weekly.length; i++) {
        const validate = await this.queryShipperNominationFileService.versionValidate({
          "nomination_type_id": 2,
          "contract_code_id": weekly[i]?.contract_code_id,
          "nomination_version_id": weekly[i]?.nomination_version?.[0]?.id
        }, null)
        const validateCut = (validate || [])?.filter((f: any) => f?.query_shipper_nomination_type_id === 1)
        const validateData = (validateCut || [])?.map((e: any) => e?.newObj)
        // console.log('w validateData : ', validateData);
        const sheet2 = daily[i]?.nomination_version?.[0]?.nomination_full_json_sheet2
        const convertSheet2 = (sheet2 || [])?.length > 0 ? JSON.parse(sheet2?.[0]?.data_temp) : null
        // DW entry_quality
        // -- sheet 2 nom
        let entry_quality = false
        if (convertSheet2 !== null && (convertSheet2?.valueData || [])?.length > 0) {
          const checkSheet2 = fnCheckSheet2(convertSheet2?.valueData, zoneMaster)
          entry_quality = checkSheet2
        }

        // DW overuse_quantity Day
        let overuse_quantity = false
        for (let val = 0; val < validateData.length; val++) {
          const sunday = fnCheck(validateData[val]["14"])
          if (sunday) {
            overuse_quantity = true;
            break
          }
          const monday = fnCheck(validateData[val]["15"])
          if (monday) {
            overuse_quantity = true;
            break
          }
          const tuesday = fnCheck(validateData[val]["16"])
          if (tuesday) {
            overuse_quantity = true;
            break
          }
          const wednesday = fnCheck(validateData[val]["17"])
          if (wednesday) {
            overuse_quantity = true;
            break
          }
          const thursday = fnCheck(validateData[val]["18"])
          if (thursday) {
            overuse_quantity = true;
            break
          }
          const friday = fnCheck(validateData[val]["19"])
          if (friday) {
            overuse_quantity = true;
            break
          }
          const saturday = fnCheck(validateData[val]["20"])
          if (saturday) {
            overuse_quantity = true;
            break
          }
        }

        nWeekly?.push({
          ...weekly[i],
          entry_quality: entry_quality,
          overuse_quantity: overuse_quantity,
        })
      }
    }


    // system
    // system - mix quality HV WI
    let sysDaily = false
    for (let i = 0; i < filDayDFormEva.length; i++) {
      if (!!filDayDFormEva[i]?.valueBtuScf || filDayDFormEva[i]?.valueBtuScf === 0) {
        if (filDayDFormEva[i]?.parameter === "HV") {
          if (filDayDFormEva[i]?.valueBtuScf < filDayDFormEva[i]?.zone?.zone_master_quality?.[0]?.v2_sat_heating_value_min || filDayDFormEva[i]?.valueBtuScf > filDayDFormEva[i]?.zone?.zone_master_quality?.[0]?.v2_sat_heating_value_max) {
            sysDaily = true
          }
        } else if (filDayDFormEva[i]?.parameter === "WI") {
          if (filDayDFormEva[i]?.valueBtuScf < filDayDFormEva[i]?.zone?.zone_master_quality?.[0]?.v2_wobbe_index_min || filDayDFormEva[i]?.valueBtuScf > filDayDFormEva[i]?.zone?.zone_master_quality?.[0]?.v2_wobbe_index_max) {
            sysDaily = true
          }
        }

      }
    }
    let sysWeekly = false
    for (let i = 0; i < filDayWFormEva.length; i++) {
      if (!!filDayWFormEva[i]?.sunday?.value || filDayWFormEva[i]?.sunday?.value === 0) {
        // console.log('filDayWFormEva[i] : ', filDayWFormEva[i]);
        if (filDayWFormEva[i]?.parameter === "HV") {
          if (filDayWFormEva[i]?.sunday?.value < filDayWFormEva[i]?.zone?.zone_master_quality?.[0]?.v2_sat_heating_value_min || filDayWFormEva[i]?.sunday?.value > filDayWFormEva[i]?.zone?.zone_master_quality?.[0]?.v2_sat_heating_value_max) {
            sysWeekly = true
          }
        } else if (filDayWFormEva[i]?.parameter === "WI") {
          if (filDayWFormEva[i]?.sunday?.value < filDayWFormEva[i]?.zone?.zone_master_quality?.[0]?.v2_wobbe_index_min || filDayWFormEva[i]?.sunday?.value > filDayWFormEva[i]?.zone?.zone_master_quality?.[0]?.v2_wobbe_index_max) {
            sysWeekly = true
          }
        }
      }
    }

    // system - quantity 
    let sysQuantityD = false
    fAreaQuantityD?.map((e: any) => {
      const find_validate = areaMaster?.find((f: any) => f?.name === e?.area_text)

      const total_cap_validate = find_validate?.area_nominal_capacity > e?.totalCap
      const h1_validate = find_validate?.area_nominal_capacity > e?.H1
      const h2_validate = find_validate?.area_nominal_capacity > e?.H2
      const h3_validate = find_validate?.area_nominal_capacity > e?.H3
      const h4_validate = find_validate?.area_nominal_capacity > e?.H4
      const h5_validate = find_validate?.area_nominal_capacity > e?.H5
      const h6_validate = find_validate?.area_nominal_capacity > e?.H6
      const h7_validate = find_validate?.area_nominal_capacity > e?.H7
      const h8_validate = find_validate?.area_nominal_capacity > e?.H8
      const h9_validate = find_validate?.area_nominal_capacity > e?.H9
      const h10_validate = find_validate?.area_nominal_capacity > e?.H10
      const h11_validate = find_validate?.area_nominal_capacity > e?.H11
      const h12_validate = find_validate?.area_nominal_capacity > e?.H12
      const h13_validate = find_validate?.area_nominal_capacity > e?.H13
      const h14_validate = find_validate?.area_nominal_capacity > e?.H14
      const h15_validate = find_validate?.area_nominal_capacity > e?.H15
      const h16_validate = find_validate?.area_nominal_capacity > e?.H16
      const h17_validate = find_validate?.area_nominal_capacity > e?.H17
      const h18_validate = find_validate?.area_nominal_capacity > e?.H18
      const h19_validate = find_validate?.area_nominal_capacity > e?.H19
      const h20_validate = find_validate?.area_nominal_capacity > e?.H20
      const h21_validate = find_validate?.area_nominal_capacity > e?.H21
      const h22_validate = find_validate?.area_nominal_capacity > e?.H22
      const h23_validate = find_validate?.area_nominal_capacity > e?.H23
      const h24_validate = find_validate?.area_nominal_capacity > e?.H24
      if (
        total_cap_validate ||
        h1_validate ||
        h2_validate ||
        h3_validate ||
        h4_validate ||
        h5_validate ||
        h6_validate ||
        h7_validate ||
        h8_validate ||
        h9_validate ||
        h10_validate ||
        h11_validate ||
        h12_validate ||
        h13_validate ||
        h14_validate ||
        h15_validate ||
        h16_validate ||
        h17_validate ||
        h18_validate ||
        h19_validate ||
        h20_validate ||
        h21_validate ||
        h22_validate ||
        h23_validate ||
        h24_validate
      ) {
        sysQuantityD = true
      }
      return e
    })

    let sysQuantityW = false
    fAreaQuantityW?.map((e: any) => {
      const find_validate = areaMaster?.find((f: any) => f?.name === e?.area_text)
      const total_cap_validate = find_validate?.area_nominal_capacity > e?.totalCap
      const sunday_validate = find_validate?.area_nominal_capacity > e?.sunday
      const monday_validate = find_validate?.area_nominal_capacity > e?.monday
      const tuesday_validate = find_validate?.area_nominal_capacity > e?.tuesday
      const wednesday_validate = find_validate?.area_nominal_capacity > e?.wednesday
      const thursday_validate = find_validate?.area_nominal_capacity > e?.thursday
      const friday_validate = find_validate?.area_nominal_capacity > e?.friday
      const saturday_validate = find_validate?.area_nominal_capacity > e?.saturday

      if (
        total_cap_validate ||
        sunday_validate ||
        monday_validate ||
        tuesday_validate ||
        wednesday_validate ||
        thursday_validate ||
        friday_validate ||
        saturday_validate
      ) {
        sysQuantityW = true
      }

      return e
    })

    const resultData = {
      // note:"true คือเกินให้ ✖ นอกนั้น ✔",
      // note2:"system?.mixQuality ไม่รู้คำนวนจากอะไร ผมเลยใส่ null ไปก่อน ",
      // note3:"system?.quality ไม่รู้คำนวนจากอะไร ผมเลยใส่ null ไปก่อน ",
      data: {
        daily: {
          table: nDaily,
          system: {
            mixQuality: sysDaily,
            quality: sysQuantityD,
          }
        },
        weekly: {
          table: nWeekly,
          system: {
            mixQuality: sysWeekly,
            quality: sysQuantityW,
          }
        },
      }
    }
    return resultData;
  }

}
