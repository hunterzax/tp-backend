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
  getTodayEndYYYYMMDDDfaultAdd7,
  getTodayNow,
  getTodayNowAdd7,
  getTodayNowYYYYMMDDDfaultAdd7,
  getTodayStartAdd7,
  getTodayStartYYYYMMDDDfaultAdd7,
} from 'src/common/utils/date.util';
import { AstosService } from 'src/astos/astos.service';
import { buildActiveDataForDates, isMatch } from 'src/common/utils/allcation.util';
import { middleNotiInapp } from 'src/common/utils/inapp.util';
import { Prisma } from '@prisma/client';


dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);

@Injectable()
export class MeteringManagementService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    // @Inject(CACHE_MANAGER) private cacheService: Cache,
    private readonly meteredMicroService: MeteredMicroService,
    // private readonly astosService: AstosService,
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

  async allId() {
    const resData = await this.prisma.metered_run_number.findMany({
      orderBy: {
        id: 'desc',
      },
    });
    return resData;
  }

  async retrievingNumber() {
    const resData = await this.prisma.metered_run_number.findMany({
      orderBy: {
        id: 'asc',
      },
    });
    return resData;
  }

  async meteredMasterAll(start_date?: any, end_date?: any) {
    const todayStart = start_date ? getTodayStartYYYYMMDDDfaultAdd7(start_date).toDate() : getTodayStartAdd7().toDate();
    const todayEnd = end_date ? getTodayEndYYYYMMDDDfaultAdd7(end_date).toDate() : getTodayEndAdd7().toDate();
    const resData = await this.prisma.metering_point.findMany({
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
        customer_type: true,
        non_tpa_point: {
          include: {
            nomination_point: {
              include: {
                customer_type: true,
                // contract_point:{
                contract_point_list: {
                  include: {
                    area: true,
                    zone: true,
                    shipper_contract_point: {
                      include: {
                        group: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        nomination_point: {
          include: {
            customer_type: true,
            // contract_point
            contract_point_list: {
              include: {
                area: true,
                zone: true,
                shipper_contract_point: {
                  include: {
                    group: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
    // console.log('resData : ', resData);
    return resData;
  }

  async shareShipper(payload: any) {
    // console.log('payload : ', payload);
    // const shareData = payload?.filter((f:any) => {
    //   return f?.nomination_point?.contract_point?.shipper_contract_point.length > 1
    // })
    const shareData = payload?.filter((f: any) => {
      return f?.nomination_point?.contract_point_list?.some(
        (cp: any) => cp?.shipper_contract_point.length > 1,
      );
    });
    // console.log('shareData : ', shareData);
    return shareData;
  }

  // async meteredCompare(master:any, meter:any){

  //   let dataResult = []
  //   for (let i = 0; i < master.length; i++) {
  //     const findMeter = meter?.data?.find((f:any) => { return f?.meteringPointId === master[i]?.metered_point_name })
  //     if(findMeter){

  //       const area = !!master[i]?.non_tpa_point ? master[i]?.non_tpa_point?.nomination_point?.contract_point?.area : master[i]?.nomination_point?.contract_point?.area
  //       const zone = !!master[i]?.non_tpa_point ? master[i]?.non_tpa_point?.nomination_point?.contract_point?.zone : master[i]?.nomination_point?.contract_point?.zone
  //       const customer_type = !!master[i]?.non_tpa_point ? master[i]?.non_tpa_point?.nomination_point?.customer_type : master[i]?.nomination_point?.customer_type
  //       dataResult.push({id: i + 1, ...findMeter, prop:{ area:area, zone:zone, customer_type:customer_type }})
  //     }
  //   }

  //   return dataResult
  // }
  async meteredCompare(master: any, meter: any, gasDay?: string) {
    const dataResult = [];
    if (Array.isArray(meter)) {
      const conceptPoint = await this.prisma.concept_point.findMany({
        where: {
          type_concept_point_id: 4,
        },
      });

      // console.log('conceptPoint : ', conceptPoint);

      // console.log('master : ', master);
      // console.log('meter : ', meter);

      const mConcpetPoint = conceptPoint.map((e: any) => {
        return { metered_point_name: e?.concept_point };
      });
      // console.log('mConcpetPoint : ', mConcpetPoint);

      master = [...master, ...mConcpetPoint];

      for (let i = 0; i < master.length; i++) {
        const findMeter = meter?.filter(
          (f: any) => f?.meteringPointId === master[i]?.metered_point_name && (gasDay ? f?.gasDay === gasDay : true),
        ) || [];
        // console.log('findMeter : ', findMeter);
        if (findMeter.length > 0) {
          for (let iM = 0; iM < findMeter.length; iM++) {
            const contractPoints = master[i]?.non_tpa_point
              ? master[i]?.non_tpa_point?.nomination_point?.contract_point_list
              : master[i]?.nomination_point?.contract_point_list;

            const firstContractPoint = contractPoints?.[0] || {};
            const area = firstContractPoint?.area || master[i]?.area || null;
            const zone = firstContractPoint?.zone || master[i]?.zone || null;
            const customer_type = master[i]?.non_tpa_point
              ? master[i]?.non_tpa_point?.nomination_point?.customer_type
              : master[i]?.nomination_point?.customer_type;

            dataResult.push({
              id: i + 1 + iM + 1,
              ...findMeter[iM],
              prop: { area: area, zone: zone, customer_type: customer_type },
            });
          }
        }

        //
      }
    }

    return dataResult;
  }

  async meteringRetrievingLimit(
    limit = 100,
    offset = 0,
    startDate?: any,
    endDate?: any,
    metered_run_number_id?: any,
  ) {
    const page_ = offset;
    let limit_ = limit;
    let total = 0
    const offset_ = (page_) * limit_;

    //     const page = 701;
    // const limit = 10;
    // const offset = (page - 1) * limit;
    // 

    // const records = metered_run_number_id ? await this.prisma.metered_retrieving.findMany({
    //   where: {
    //     del_flag: null,
    //     type: 'retrieving',
    //     metered_run_number_id: Number(metered_run_number_id),
    //     // gas_day: { gte: dayjs(startDate, "YYYY-MM-DD").toDate(), lte: dayjs(endDate, "YYYY-MM-DD").toDate() }
    //   },
    //   orderBy: { id: 'desc' },
    //   skip: Number(offset_),
    //   take: Number(limit_),
    //   select: { id: true },  // ดึง id พอ
    // }) : await this.prisma.metered_retrieving.findMany({
    //   where: {
    //     del_flag: null,
    //     type: 'retrieving',
    //     // gas_day: { gte: dayjs(startDate, "YYYY-MM-DD").toDate(), lte: dayjs(endDate, "YYYY-MM-DD").toDate() }
    //   },
    //   orderBy: { id: 'desc' },
    //   skip: Number(offset_),
    //   take: Number(limit_),
    //   select: { id: true },  // ดึง id พอ
    // });

    // console.log('offset_ : ', offset_);
    // console.log('limit_ : ', limit_);
    // console.log('records : ', records);

    const andWhere: Prisma.metered_retrievingWhereInput[] = [
      {
        del_flag: null
      },
      {
        type: 'retrieving'
      }
    ]

    if (metered_run_number_id) {
      andWhere.push({
        metered_run_number_id: Number(metered_run_number_id),
      })
    }

    const start = dayjs(startDate, "YYYY-MM-DD");
    const end = dayjs(endDate, "YYYY-MM-DD");
    if (start.isValid() || end.isValid()) {
      if (start.isValid()) {
        andWhere.push({
          gas_day: { gte: start.toDate() }
        })
      }
      if (end.isValid()) {
        andWhere.push({
          gas_day: { lte: end.toDate() }
        })
      }
    }
    total = await this.prisma.metered_retrieving.count({
      where: {
        AND: andWhere
      }
    })
    if (limit == 40000 && offset == 0) {
      limit_ = total
    }

    // 1. Query ข้อมูลหลัก
    const resData = await this.prisma.metered_retrieving.findMany({
      where: {
        AND: andWhere
      },
      include: { metered_run_number: true },
      orderBy: { id: 'desc' },
      skip: Number(offset_),
      take: Number(limit_),
    })
    // const resData = metered_run_number_id ? await this.prisma.metered_retrieving.findMany({
    //   where: {
    //     // id: { in: records.map(r => r.id) },
    //     metered_run_number_id: Number(metered_run_number_id),
    //     del_flag: null,
    //     type: 'retrieving',
    //     // gas_day: { gte: dayjs(startDate, "YYYY-MM-DD").toDate(), lte: dayjs(endDate, "YYYY-MM-DD").toDate() }
    //   },
    //   include: { metered_run_number: true },
    //   orderBy: { id: 'desc' },
    //   skip: Number(offset_),
    //   take: Number(limit_),

    // }) : await this.prisma.metered_retrieving.findMany({
    //   where: {
    //     // id: { in: records.map(r => r.id) },
    //     del_flag: null,
    //     type: 'retrieving',
    //     // gas_day: { gte: dayjs(startDate, "YYYY-MM-DD").toDate(), lte: dayjs(endDate, "YYYY-MM-DD").toDate() }
    //   },
    //   include: { metered_run_number: true },
    //   orderBy: { id: 'desc' },
    //   skip: Number(offset_),
    //   take: Number(limit_),

    // });
    // console.log('resData : ', resData.length);

    // "gasDay": "2025-06-27",

    // 2. Query นับ total

    // 3. Process data
    const newResData = resData.map((e: any) => {
      e['data'] = this.safeParseJSON(e?.['temp']);
      e['gasDay'] = e['data']?.['gasDay'] || null;
      const { temp, ...nE } = e;
      return { ...nE };
    });

    // startDate?: any,
    // endDate?: any,

    // const total = metered_run_number_id ? await this.prisma.metered_retrieving.count({
    //   where: {
    //     del_flag: null, type: 'retrieving', metered_run_number_id: Number(metered_run_number_id),
    //     // gas_day: { gte: dayjs(startDate, "YYYY-MM-DD").toDate(), lte: dayjs(endDate, "YYYY-MM-DD").toDate() }
    //   },
    // }) : await this.prisma.metered_retrieving.count({
    //   where: {
    //     del_flag: null, type: 'retrieving',
    //     // gas_day: { gte: dayjs(startDate, "YYYY-MM-DD").toDate(), lte: dayjs(endDate, "YYYY-MM-DD").toDate() }
    //   },
    // });



    // 4. Return แบบรองรับ frontend
    return {
      total: total,
      // data: filteredStartEnd,
      data: newResData,
      limit: Number(limit),
      offset: Number(offset),
    };
  }

  async meteringRetrievingMasterCheckLimit(
    limit = 100,
    offset = 0,
    metered_run_number_id?: any
  ) {
    // 1. Query ข้อมูลหลัก
    const resData = metered_run_number_id ? await this.prisma.metered_retrieving.findMany({
      where: { del_flag: null, type: 'mastering data check', metered_run_number_id: Number(metered_run_number_id), },
      include: { metered_run_number: true },
      orderBy: { id: 'desc' },
      skip: Number(offset),
      take: Number(limit),
    }) : await this.prisma.metered_retrieving.findMany({
      where: { del_flag: null, type: 'mastering data check' },
      include: { metered_run_number: true },
      orderBy: { id: 'desc' },
      skip: Number(offset),
      take: Number(limit),
    });

    // Avoid logging full database records in logs
    if (process.env.NODE_ENV !== 'production') {
      console.log('resData count: ', resData?.length || 0);
    }
    // 2. Query นับ total
    const total = metered_run_number_id ? await this.prisma.metered_retrieving.count({
      where: { del_flag: null, type: 'mastering data check', metered_run_number_id: Number(metered_run_number_id) },
    }) : await this.prisma.metered_retrieving.count({
      where: { del_flag: null, type: 'mastering data check' },
    });

    // 3. Process data
    const newResData = resData.map((e: any) => {
      e['data'] = this.safeParseJSON(e?.['temp']);
      delete e['temp'];
      return { ...e };
    });

    // 4. Return แบบรองรับ frontend
    return {
      total,
      data: newResData,
      limit: Number(limit),
      offset: Number(offset),
    };
  }

  async meteringRetrieving() {
    const resData = await this.prisma.metered_retrieving.findMany({
      where: {
        del_flag: null,
      },
      include: {
        metered_run_number: true,
      },
      orderBy: {
        id: 'desc',
      },
      // skip: offset,
      // take: limit,
    });

    const newResData = resData.map((e: any) => {
      e['data'] = this.safeParseJSON(e?.['temp']);
      delete e['temp'];
      return { ...e };
    });

    return newResData;
  }

  async lastRetrieving() {
    const resData = await this.prisma.metered_run_number.findFirst({
      orderBy: {
        id: 'desc',
      },
    });
    return resData;
  }


  async checkData() {
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const meteredMaster = await this.prisma.metering_point.findMany({
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
        metered_point_name: true,
      },
      orderBy: {
        id: 'desc',
      },
    });

    const resData = await this.prisma.metered_retrieving.findMany({
      where: {
        del_flag: null,
        type: 'mastering data check',
      },
      select: {
        id: true,
        metering_point_sys: true,
      },
      orderBy: {
        id: 'desc',
      },
    });
    const dataSet: any = [];
    for (let i = 0; i < resData.length; i++) {
      const find = meteredMaster.find((f: any) => {
        return f?.metered_point_name === resData[i]?.metering_point_sys;
      });
      if (find) {
        dataSet.push(resData[i]?.id);
      }
    }
    if (dataSet.length > 0) {
      await this.prisma.metered_retrieving.updateMany({
        where: {
          id: {
            in: dataSet,
          },
        },
        data: {
          del_flag: true,
        },
      });
    }

    return {
      count: dataSet.length,
    };
  }

  async getDataLogicNoCondept(query: any, isReplaceMissingMeterWithNomination?: boolean) {
    console.time('getDataLogicNoCondept');
    const { share, start_date, end_date } = query;

    let activeData: any[] | undefined = undefined;
    if (isReplaceMissingMeterWithNomination) {
      try {
        // Extract gas days and generate date array
        const getMeterFrom = getTodayNow(start_date)
        const getMeterTo = getTodayNow(end_date)
        const dateArray: string[] = []
        // Fill dateArray with all dates between getMeterFrom and getMeterTo (inclusive) in YYYY-MM-DD format
        let current = getMeterFrom.clone();
        while (current.isSameOrBefore(getMeterTo, 'day')) {
          dateArray.push(current.format('YYYY-MM-DD'));
          current = current.add(1, 'day');
        }
        // Build active data for all dates
        activeData = await buildActiveDataForDates(
          dateArray,
          this.prisma
        );
      } catch (error) {
        activeData = undefined;
      }
    }

    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: 'getLast',
        mode: 'metering',
        start_date: start_date,
        end_date: end_date,
      }),
      (isReplaceMissingMeterWithNomination && activeData) ? {
        activeData: activeData,
        prisma: this.prisma
      } : undefined
    );
    console.timeEnd('getDataLogicNoCondept');
    // console.log(JSON.parse(meteredMicroData?.reply));
    const dataConvert = this.safeParseJSON(meteredMicroData?.reply);
    const meteredPoint = await this.meteredMasterAll(start_date, end_date);
    const shareShipper = await this.shareShipper(meteredPoint);
    const ckShare = (share === 'on' || share == true) ? shareShipper : meteredPoint;

    return { meterNom: ckShare, meter: dataConvert };
  }

  async getRetrievingID(query: any, userId: any) {
    const { start_date, end_date } = query;

    const startDate = getTodayNowYYYYMMDDDfaultAdd7(start_date)
    const endDate = getTodayNowYYYYMMDDDfaultAdd7(end_date)
    if (!startDate.isValid() || !endDate.isValid()) {
      throw new Error('⛔ Invalid date format');
    }
    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: "get-retrieving-id",
        mode: "metering",
        start_date: start_date,
        end_date: end_date
      }),
    );
    const reply = this.safeParseJSON(meteredMicroData?.reply);

    return reply;
  }

  async getDataByRetrievingID(query: any, isReplaceMissingMeterWithNomination?: boolean) {
    console.log('*****run***');
    const { share, metering_retrieving_id } = query;

    let activeData: any[] | undefined = undefined;
    const payload = JSON.stringify({
      case: 'get-metering-by-retrieving-id',
      mode: 'metering',
      metering_retrieving_id: metering_retrieving_id,
    })

    const meteredMicroData = await this.meteredMicroService.sendMessage(payload);
    console.log('****end****');

    let dataConvert = this.safeParseJSON(meteredMicroData?.reply);

    const dateArray: string[] = Array.from(
      new Set(dataConvert?.map((item: any) => String(item.gasDay)) || [])
    );

    if (isReplaceMissingMeterWithNomination) {
      try {
        // Build active data for all dates
        activeData = await buildActiveDataForDates(
          dateArray,
          this.prisma
        );
        const meteredMicroDataReplaceMissingMeterWithNomination = await this.meteredMicroService.replaceMissingMeterWithNomination(
          payload,
          activeData ? {
            activeData: activeData,
            prisma: this.prisma
          } : undefined,
          meteredMicroData
        )

        dataConvert = this.safeParseJSON(meteredMicroDataReplaceMissingMeterWithNomination?.reply);
      } catch (error) {
        activeData = undefined;
      }
    }

    // return dataConvert
    const compareMeterEachDay = await Promise.all(dateArray.map(async (date) => {
      // Find active data for this gas_day
      const activeDataForDate = activeData?.find((ad) => ad.date === date);
      if (activeDataForDate) {
        const meteredPoint = activeDataForDate?.activeMeteringPoints || []
        const shareShipper = await this.shareShipper(meteredPoint);
        const ckShare = share === 'on' ? shareShipper : meteredPoint;

        const compareMeter = await this.meteredCompare(ckShare, dataConvert, date);
        return compareMeter;
      }
    }))
    return compareMeterEachDay.flat();
  }

  async getDataLogic(query: any, isReplaceMissingMeterWithNomination?: boolean) {
    console.log('*****run***');
    const { share, start_date, end_date } = query;

    let activeData: any[] | undefined = undefined;
    const dateArray: string[] = []
    if (isReplaceMissingMeterWithNomination) {
      try {
        // Extract gas days and generate date array
        const getMeterFrom = getTodayNow(start_date)
        const getMeterTo = getTodayNow(end_date)
        // Fill dateArray with all dates between getMeterFrom and getMeterTo (inclusive) in YYYY-MM-DD format
        let current = getMeterFrom.clone();
        while (current.isSameOrBefore(getMeterTo, 'day')) {
          dateArray.push(current.format('YYYY-MM-DD'));
          current = current.add(1, 'day');
        }
        // Build active data for all dates
        activeData = await buildActiveDataForDates(
          dateArray,
          this.prisma
        );
      } catch (error) {
        activeData = undefined;
      }
    }

    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: 'get-last-have-value',
        // mode: 'metering',
        mode: 'metering',
        start_date: start_date,
        end_date: end_date,
        // start_date: "2025-03-08",
        // end_date:"2025-03-10"
      }),
      (isReplaceMissingMeterWithNomination && activeData) ? {
        activeData: activeData,
        prisma: this.prisma
      } : undefined
    );
    console.log('****end****');
    // console.log('start_date : ', start_date);
    // console.log('end_date : ', end_date);
    // console.log(JSON.parse(meteredMicroData?.reply));
    const dataConvert = this.safeParseJSON(meteredMicroData?.reply);
    // console.log('dataConvert : ', dataConvert);

    // return dataConvert
    const compareMeterEachDay = await Promise.all(dateArray.map(async (date) => {
      // Find active data for this gas_day
      const activeDataForDate = activeData?.find((ad) => ad.date === date);
      if (activeDataForDate) {
        const meteredPoint = activeDataForDate?.activeMeteringPoints || []
        // console.log('meteredPoint : ', meteredPoint);
        const shareShipper = await this.shareShipper(meteredPoint);
        const ckShare = share === 'on' ? shareShipper : meteredPoint;

        const compareMeter = await this.meteredCompare(ckShare, dataConvert, date);
        // console.log('compareMeter : ', compareMeter);
        return compareMeter;
      }
    }))
    return compareMeterEachDay.flat();
  }

  // exceljs
  async componentGenExcelMeter(data: any, data2: any, data3: any, name: any) {
    // สร้าง workbook และ worksheet
    const workbook = XLSX.utils.book_new(); // สร้าง workbook ใหม่
    const worksheet1 = XLSX.utils.aoa_to_sheet(data); // สร้าง sheet จาก array ของ array
    // const worksheet2 = XLSX.utils.aoa_to_sheet(data2); // สร้าง sheet จาก array ของ array
    // const worksheet3 = XLSX.utils.aoa_to_sheet(data3); // สร้าง sheet จาก array ของ array
    XLSX.utils.book_append_sheet(workbook, worksheet1, name); // เพิ่ม sheet ลงใน workbook
    // XLSX.utils.book_append_sheet(workbook, worksheet2, 'Quality'); // เพิ่ม sheet ลงใน workbook
    // XLSX.utils.book_append_sheet(workbook, worksheet3, 'Lists'); // เพิ่ม sheet ลงใน workbook
    const defaultColumnWidth = 20; // กำหนดค่าความกว้างมาตรฐานที่ต้องการ
    const startRow = 2;
    const endRow = 5;
    const startCol = 0; // A = index 0
    const endCol = 26; // AA = index 26
    const targetRow = 4;
    const specialCols = ['A', 'B', 'D'];
    const specialColor = 'B8CCE4';
    const defaultColor = '92D050';
    const boldRows = [2, 4];

    boldRows.forEach((row) => {
      for (let col = 0; col <= 26; col++) {
        // A (0) → AA (26)
        const colLetter = XLSX.utils.encode_col(col); // เช่น 0 -> 'A'
        const cellAddress = `${colLetter}${row}`;

        if (!worksheet1[cellAddress]) {
          worksheet1[cellAddress] = { t: 's', v: '' }; // สร้างเซลล์เปล่าถ้ายังไม่มี
        }

        worksheet1[cellAddress].s = worksheet1[cellAddress].s || {};
        worksheet1[cellAddress].s.font = {
          ...(worksheet1[cellAddress].s.font || {}),
          bold: true,
        };
      }
    });

    // ใส่สีให้ row 4
    for (let col = 0; col <= 26; col++) {
      // A (0) → AA (26)
      const colLetter = XLSX.utils.encode_col(col); // เช่น 0 -> 'A'
      const cellAddress = `${colLetter}${targetRow}`;

      if (!worksheet1[cellAddress]) {
        worksheet1[cellAddress] = { t: 's', v: '' }; // สร้างเซลล์ถ้าไม่มี
      }

      worksheet1[cellAddress].s = worksheet1[cellAddress].s || {};
      worksheet1[cellAddress].s.fill = {
        patternType: 'solid',
        fgColor: {
          rgb: specialCols.includes(colLetter) ? specialColor : defaultColor,
        },
      };

      // (เลือก) ถ้าอยากให้ text ชัดเจน ใส่ font เพิ่มได้
      // worksheet1[cellAddress].s.font = {
      //   bold: true,
      //   color: { rgb: '000000' },
      // };
    }

    Object.keys(worksheet1).forEach((cell) => {
      const rowNumber = parseInt(cell.replace(/[^0-9]/g, ''));
      const columnLetter = cell.replace(/[0-9]/g, '');

      // ข้ามถ้า cell เป็น metadata เช่น !ref
      if (cell[0] === '!') return;

      // 🔧 ถ้าเซลล์ยังไม่มี ให้สร้างก่อน
      if (!worksheet1[cell]) {
        worksheet1[cell] = { t: 's', v: '' };
      }

      // ✅ ตั้งค่าประเภทข้อความ
      worksheet1[cell].z = '@';
      worksheet1[cell].t = 's';

      // ✅ เตรียม style object
      worksheet1[cell].s = worksheet1[cell].s || {};
      worksheet1[cell].s.border = worksheet1[cell].s.border || {};

      // ✅ ใส่ border บน-ล่าง เฉพาะแถวที่กำหนด
      if (rowNumber === startRow) {
        worksheet1[cell].s.border.top = {
          style: 'thin',
          color: { rgb: '92D050' },
        };
      }

      if (rowNumber === endRow) {
        worksheet1[cell].s.border.bottom = {
          style: 'thin',
          color: { rgb: '92D050' },
        };
      }

      // ✅ ใส่ border ซ้าย-ขวา เฉพาะคอลัมน์แรกและสุดท้าย
      const colIndex = XLSX.utils.decode_col(columnLetter);
      if (colIndex === startCol) {
        worksheet1[cell].s.border.left = {
          style: 'thin',
          color: { rgb: '92D050' },
        };
      }

      if (colIndex === endCol) {
        worksheet1[cell].s.border.right = {
          style: 'thin',
          color: { rgb: '92D050' },
        };
      }
    });

    const excelBuffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    });

    // ส่ง buffer กลับไปเพื่อให้ controller สามารถใช้งานต่อไปได้
    return excelBuffer;
  }

  async genExcelTemplateFinalMeter(payload: any) {
    const { gasDay } = payload;
    const data = [
      [], // Row 0
      [
        'Gas Day',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ], // Row 1
      [
        `${gasDay}`,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ],
      [
        'POINT_ID',
        'REGISTER_TIMSTAMP',
        'VOLUME',
        'ENERGY',
        'HV',
        'WI',
        'CO2',
        'C1',
        'C2',
        'C2+',
        'C3',
        'iC4',
        'nC4',
        'iC5',
        'nC5',
        'C6',
        'C7',
        'N2',
        'O2',
        'H2S',
        'S',
        'Hg',
        'Pressure',
        'Moisture',
        'DewPoint',
        'SG',
        'Datasource',
      ],
      [
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ],
    ];
    const data2 = [];
    const data3 = [];
    const nameFile = `Daily Metering Data`;
    const excelBuffer = await this.componentGenExcelMeter(
      data,
      data2,
      data3,
      nameFile,
    );

    // ส่ง buffer กลับไปเพื่อให้ controller สามารถใช้งานต่อไปได้
    return { excelBuffer, nameFile: `${nameFile}` };
  }

  async uploadFile(
    file: any,
    fileOriginal: any,
    // userId: any,
  ) {
    if (file === undefined || file === null) {
      throw new HttpException('Missing file', HttpStatus.BAD_REQUEST);
    }

    const newDate = getTodayNow();
    try {
      const newDate7 = getTodayNowAdd7();
      const todayStart = getTodayStartAdd7().toDate();
      const todayEnd = getTodayEndAdd7().toDate();
      const findData = this.safeParseJSON(file?.jsonDataMultiSheet);

      const meteredCount = await this.prisma.metered_run_number.count({
        where: {
          create_date: {
            gte: todayStart, // มากกว่าหรือเท่ากับเวลาเริ่มต้นของวันนี้
            lte: todayEnd, // น้อยกว่าหรือเท่ากับเวลาสิ้นสุดของวันนี้
          },
        },
      });
      const meteringRetrievingId = `${newDate7.format('YYYYMMDD')}-MET-${(meteredCount > 0 ? meteredCount + 1 : 1).toString().padStart(4, '0')}`;
      const insertTimestamp = newDate.format('YYYY-MM-DD HH:mm:ss');
      console.log('meteringRetrievingId : ', meteringRetrievingId);
      console.log('insertTimestamp : ', insertTimestamp);
      let meterArr = []

      const sheetArr = findData.filter((f: any) => {
        return /^Daily Metering Data(\s\(\d+\))?$/.test(f?.sheet || '');
      });

      if (sheetArr.length <= 0) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Sheet name is invalid.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      for (let i = 0; i < sheetArr.length; i++) {
        const sheet1 = sheetArr[i]

        const gasDay = sheet1.data[1];
        const headerCol = sheet1.data[2];
        const valueCol = sheet1.data.slice(3);
        // console.log('valueCol : ', valueCol);
        function isValidGasDay(value) {
          // ต้องเป็น string ก่อน
          console.log('value : ', value);
          if (typeof value?.[0] !== "string") return false;

          // ตรวจว่าเป็นรูปแบบ YYYY-MM-DD และเป็นวันจริง
          return dayjs(value?.[0], "YYYY-MM-DD", true).isValid();
        }

        if (!isValidGasDay(gasDay)) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Gas Day is required.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        if (valueCol.length === 0) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Required field is missing: Point_ID / Register Timestamp / Energy.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
        // 2025-07-09T11:30:00.569+01:00

        function isValidStrictIsoDatetime(value) {
          if (typeof value !== "string") return false;

          const regex =
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/;

          return regex.test(value);
        }

        console.log('headerCol : ', headerCol);
        const correctHeaders = [
          'POINT_ID',
          'REGISTER_TIMSTAMP',
          'VOLUME',
          'ENERGY',
          'HV',
          'WI',
          'CO2',
          'C1',
          'C2',
          'C2+',
          'C3',
          'iC4',
          'nC4',
          'iC5',
          'nC5',
          'C6',
          'C7',
          'N2',
          'O2',
          'H2S',
          'S',
          'Hg',
          'Pressure',
          'Moisture',
          'DewPoint',
          'SG',
          'Datasource',
        ];

        function validateHeaderCol(headerCol, correctHeaders) {
          // แปลง object → array
          const values = Object.values(headerCol);

          // ตรวจว่าความยาวต้องเท่ากัน
          if (values.length !== correctHeaders.length) {
            console.log('❌ จำนวน header ไม่เท่ากัน');
            return false;
          }

          // เช็คค่าทีละตัว
          for (let i = 0; i < values.length; i++) {
            if (values[i] !== correctHeaders[i]) {
              console.log(`❌ Header ผิดที่ index ${i} → ${values[i]} ≠ ${correctHeaders[i]}`);
              return false;
            }
          }

          console.log('✅ Header ถูกต้องทั้งหมด');
          return true;
        }

        if (!validateHeaderCol(headerCol, correctHeaders)) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Template format is invalid.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        // Required field is missing: Point_ID / Register Timestamp / Energy.
        const newValue = valueCol.map((e: any) => {
          const headerRow = Object.keys(headerCol).map((obj: any) => {
            if (Number(obj) >= 2) {
              const value = e[obj];
              if (value !== undefined && value !== null) {
                if (Number(value) < 0) {
                  console.log('เจอติดลบ');
                  throw new HttpException(
                    {
                      status: HttpStatus.BAD_REQUEST,
                      error: 'Negative values are not allowed in Volume, Energy, HV, or WI.',
                    },
                    HttpStatus.BAD_REQUEST,
                  );
                }
              }
            }
            if (Number(obj) === 1) {
              if (!e[obj]) { // https://app.clickup.com/t/86eub6d6p
                throw new HttpException(
                  {
                    status: HttpStatus.BAD_REQUEST,
                    error: 'Required field is missing: Point_ID / Register Timestamp / Energy.',
                  },
                  HttpStatus.BAD_REQUEST,
                );
              }
              const ckRegis = isValidStrictIsoDatetime(e[obj])
              if (!ckRegis) {
                throw new HttpException(
                  {
                    status: HttpStatus.BAD_REQUEST,
                    error: 'Register Timestamp must be earlier or equal to Current date.',
                  },
                  HttpStatus.BAD_REQUEST,
                );
              }

            }
            return {
              [headerCol[obj]]: {
                key: obj,
                value: e[obj] || null,
              },
            };
          });

          const merged = Object.assign({}, ...headerRow);
          return merged;
        });

        const newData = {
          gasDay: gasDay['0'],
          data: newValue,
          tempExcel: findData,
        };

        if (!newData?.gasDay) {
          console.log('gasday');
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Date is NOT match',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
        const ckDay = newDate7.isBefore(dayjs(newData?.gasDay, 'YYYY-MM-DD'));
        if (ckDay) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Date is NOT match',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        for (let i = 0; i < newData.data.length; i++) {
          // ห้ามว่าง
          // newData.data[i]?.POINT_ID?.value
          // newData.data[i]?.REGISTER_TIMSTAMP?.value
          // newData.data[i]?.ENERGY?.value
          if (!newData.data[i]?.POINT_ID?.value) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Required field is missing: Point_ID',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else if (!newData.data[i]?.REGISTER_TIMSTAMP?.value) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Required field is missing: Register Timestamp',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else if (!newData.data[i]?.ENERGY?.value) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Required field is missing: Energy.',
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          // ห้ามติดลบ
          // newData.data[i]?.VOLUME?.value
          // newData.data[i]?.ENERGY?.value
          // newData.data[i]?.HV?.value
          // newData.data[i]?.WI?.value
          if (
            !!newData.data[i]?.VOLUME?.value &&
            Number(newData.data[i]?.VOLUME?.value) < 0
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Date is NOT match',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else if (
            !!newData.data[i]?.ENERGY?.value &&
            Number(newData.data[i]?.ENERGY?.value) < 0
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Date is NOT match',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else if (
            !!newData.data[i]?.HV?.value &&
            Number(newData.data[i]?.HV?.value) < 0
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Date is NOT match',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else if (
            !!newData.data[i]?.WI?.value &&
            Number(newData.data[i]?.WI?.value) < 0
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Date is NOT match',
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          // newData.data[i]?.REGISTER_TIMSTAMP?.value -> 2024-03-15T11:30:00.569+01:00
          const registerTime = dayjs(newData.data[i]?.REGISTER_TIMSTAMP?.value);
          const ckRg = dayjs.utc(newDate7).isBefore(registerTime);
          if (ckRg) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Register Timestamp must be earlier or equal to Current date.',
              },
              HttpStatus.BAD_REQUEST,
            );
          }
        }

        meterArr = [...meterArr, newData]

      }

      let countMeter = 0
      for (let i = 0; i < meterArr.length; i++) {

        const meteredMicroData = await this.meteredMicroService.sendMessage(
          JSON.stringify({
            case: 'upload-json',
            mode: 'metering',
            metering_retrieving_id: meteringRetrievingId,
            insert_timestamp: insertTimestamp,
            json_data: meterArr[i],
          }),
        );

        const reply = this.safeParseJSON(meteredMicroData?.reply);
        console.log('reply : ', reply);

        if (reply?.status) {
          const metered_run_number = await this.prisma.metered_run_number.create({
            data: {
              metering_retrieving_id: meteringRetrievingId,
              create_date: newDate7.toDate(),
              create_date_num: newDate7.unix(),
            },
          });

          const resData = await this.prisma.metering_point.findMany({
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
              non_tpa_point: {
                include: {
                  nomination_point: {
                    include: {
                      contract_point: {
                        include: {
                          area: true,
                          zone: true,
                          shipper_contract_point: {
                            include: {
                              group: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              nomination_point: {
                include: {
                  contract_point: {
                    include: {
                      area: true,
                      zone: true,
                      shipper_contract_point: {
                        include: {
                          group: true,
                        },
                      },
                    },
                  },
                },
              },
            },
            orderBy: {
              id: 'desc',
            },
          });
          const logsData = [];

          for (let i = 0; i < (reply?.data?.length || 0); i++) {
            const findMeterDam = resData?.find((f: any) => {
              return f?.metered_point_name === reply?.data[i]?.meteringPointId;
            });
            if (findMeterDam) {
              if (Number(reply?.data[i]?.energy) <= 0) {
                // มี แต่ energy 0
                console.log('มี แต่ energy 0 : ', reply?.data[i]?.energy);
                logsData.push({
                  metered_run_number_id: metered_run_number?.id,
                  temp: JSON.stringify(reply?.data[i]),
                  type: 'retrieving',
                  description: 'The mandatory field energy must be informed',
                  timestamp: newDate7.toDate(),
                  metering_point_sys: reply?.data[i]?.meteringPointId,
                  gas_day: dayjs(reply?.data[i]?.gasDay ?? reply?.data[i]?.data?.gasDay, "YYYY-MM-DD").toDate()
                });
              }
            } else {
              // ไม่มี
              console.log('ไม่มี : ', reply?.data[i]);
              logsData.push({
                metered_run_number_id: metered_run_number?.id,
                temp: JSON.stringify(reply?.data[i]),
                type: 'retrieving',
                description: `The point ${reply?.data[i]?.meteringPointId} does not exist in TPA system or is not valid`,
                timestamp: newDate7.toDate(),
                metering_point_sys: reply?.data[i]?.meteringPointId,
                gas_day: dayjs(reply?.data[i]?.gasDay ?? reply?.data[i]?.data?.gasDay, "YYYY-MM-DD").toDate()
              });

              logsData.push({
                metered_run_number_id: metered_run_number?.id,
                temp: JSON.stringify(reply?.data[i]),
                type: 'mastering data check',
                description: `The point ${reply?.data[i]?.meteringPointId} does not exist in TPA system or is not valid`,
                timestamp: newDate7.toDate(),
                metering_point_sys: reply?.data[i]?.meteringPointId,
                gas_day: dayjs(reply?.data[i]?.gasDay ?? reply?.data[i]?.data?.gasDay, "YYYY-MM-DD").toDate()
              });
            }
          }
          if (logsData.length > 0) {
            await this.prisma.metered_retrieving.createMany({
              data: logsData,
            });
          }
        }
        countMeter = + 1
      }

      await middleNotiInapp(
        this.prisma,
        'Metering', // 'Metering Management',
        `Metering Interface: Data retrieving from file ${fileOriginal.originalname && String(fileOriginal.originalname) || ""}.xlsx executed on ${insertTimestamp}[finished OK}   (Metering Input Code ${meteringRetrievingId})}. {${countMeter}/${meterArr.length} registers inserted. Allocation and Balancing process should be executed.`,
        77, // Metering Management menus_id
        1,
      );

      return "success";

    } catch (error) {
      await middleNotiInapp(
        this.prisma,
        'Metering', // 'Metering Management',
        `Metering Interface: Data retrieving from file ${fileOriginal.originalname && String(fileOriginal.originalname) || ""}.xlsx executed on ${newDate.format('YYYY-MM-DD HH:mm:ss')} {Error}.`,
        77, // Metering Management menus_id
        1,
      );
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: error.response.error,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async meteredCompareAll(master: any, meter: any) {
    const dataResultByMaster = [];
    const dataResultByMeter = [];
    console.log('master : ', master);
    console.log('meter : ', meter);

    for (let i = 0; i < master.length; i++) {
      const findMeter = meter?.find(
        (f: any) => f?.meteringPointId === master[i]?.metered_point_name,
      );

      if (findMeter) {
        // ✅ ดึง contract_point_list ถ้ามีข้อมูล
        const contractPoints = master[i]?.non_tpa_point
          ? master[i]?.non_tpa_point?.nomination_point?.contract_point_list
          : master[i]?.nomination_point?.contract_point_list;
        // ✅ เลือกค่าแรกใน contract_point_list หรือกำหนดค่าเริ่มต้น * จะตำแหน่งไหน area/zone เหมือนกัน
        const firstContractPoint = contractPoints?.[0] || {};

        // ✅ Extract ค่า area, zone, customer_type จาก contract_point_list
        const area = firstContractPoint?.area || null;
        const zone = firstContractPoint?.zone || null;
        const customer_type = master[i]?.non_tpa_point
          ? master[i]?.non_tpa_point?.nomination_point?.customer_type
          : master[i]?.nomination_point?.customer_type;

        // ✅ เพิ่มข้อมูลเข้า array
        dataResultByMaster.push({
          id: i + 1,
          meteringPointId: findMeter?.meteringPointId,
          prop: { area: area, zone: zone, customer_type: customer_type },
        });
      }
    }

    for (let i = 0; i < meter.length; i++) {
      const findMaster = master?.find(
        (f: any) => f?.metered_point_name === meter[i]?.meteringPointId,
      );

      if (findMaster) {
        // ✅ เพิ่มข้อมูลเข้า array
        dataResultByMeter.push({
          ...meter[i],
          // prop: { area: area, zone: zone, customer_type: customer_type },
        });
      }
    }

    console.log('dataResultByMeter : ', dataResultByMeter);

    const dataResultByMasterNew = dataResultByMaster.map((e: any) => {
      const fil = dataResultByMeter.filter((f: any) => {
        return f?.meteringPointId === e?.meteringPointId;
      });

      return { ...e, data: fil };
    });

    return dataResultByMasterNew;
  }


  // registerTimestamp
  async meteringChecking(payload: any) {
    const { gasDay } = payload;
    // "gasDay": "2025-03-30",
    // console.log('gasDay : ', gasDay);
    const gDay = gasDay ? gasDay : getTodayNow().format('YYYY-MM-DD');
    // console.log('gDay : ', gDay);

    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: 'getLastHour',
        mode: 'metering',
        // start_date: start_date,
        // end_date: end_date
        // start_date: getTodayNow(gDay).format('YYYY-MM-DD'),
        // end_date: gDay,
        gas_day: gDay,
      }),
    );
    const dataConvert = this.safeParseJSON(meteredMicroData?.reply);
    const meteredPoint = await this.meteredMasterAll(gDay, gDay);
    const todayStart = getTodayStartYYYYMMDDDfaultAdd7(gDay).toDate();
    const todayEnd = getTodayEndYYYYMMDDDfaultAdd7(gDay).toDate();

    const checkCondition = await this.prisma.check_condition.findFirst({
      where: {
        AND: [
          {
            start_date: {
              lte: todayEnd,
            },
          },
          {
            OR: [
              { end_date: null },
              { end_date: { gte: todayStart } },
            ],
          },
        ],
      },
    });

    // console.log('checkCondition : ', checkCondition);

    const newData = meteredPoint.map((e: any) => {

      const filMeter = dataConvert?.filter((f: any) => {
        return f?.meteringPointId === e?.metered_point_name;
      });

      const grouped: any = Object.values(
        filMeter.reduce((acc, item, index) => {
          const key = item.metering_retrieving_id;
          if (!acc[key]) {
            acc[key] = {
              index: index,
              group: key,
              metered_point_name: e?.metered_point_name,
              data: [],
            };
          }
          acc[key].data.push(item);
          return acc;
        }, {}),
      );

      const fHrIn0 = (payl: any, hr: any) => {

        return (payl || []).find((f: any) => {
          return (
            // f?.hour === hr &&
            (f?.hour || f?.gasHour) === hr && // new
            f?.gasDay === gDay
          );
        });
      }



      let fH1 = null;
      let fH2 = null;
      let fH3 = null;
      let fH4 = null;
      let fH5 = null;
      let fH6 = null;
      let fH7 = null;
      let fH8 = null;
      let fH9 = null;
      let fH10 = null;
      let fH11 = null;
      let fH12 = null;
      let fH13 = null;
      let fH14 = null;
      let fH15 = null;
      let fH16 = null;
      let fH17 = null;
      let fH18 = null;
      let fH19 = null;
      let fH20 = null;
      let fH21 = null;
      let fH22 = null;
      let fH23 = null;
      let fH24 = null;
      // console.log('grouped : ', grouped);
      // หาวัน และ เวลา h ตั้งต้น
      for (let iTime = 1; iTime <= grouped.length; iTime++) {
        if (!fH1?.data) {
          fH1 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 1),
            // data: fHrIn0(grouped[iTime]?.data, 0),
          };
          // console.log('grouped[iTime]?.data : ', grouped[iTime]?.data);
          // console.log('fH1 : ', fH1);
        }
        if (!fH2?.data) {
          fH2 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 2),
          };
        }
        if (!fH3?.data) {
          fH3 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 3),
          };
        }
        if (!fH4?.data) {
          fH4 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 4),
          };
        }
        if (!fH5?.data) {
          fH5 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 5),
          };
        }
        if (!fH6?.data) {
          fH6 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 6),
          };
        }
        if (!fH7?.data) {
          fH7 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 7),
          };
        }
        if (!fH8?.data) {
          fH8 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 8),
          };
        }
        if (!fH9?.data) {
          fH9 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 9),
          };
        }
        if (!fH10?.data) {
          fH10 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 10),
          };
        }
        if (!fH11?.data) {
          fH11 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 11),
          };
        }
        if (!fH12?.data) {
          fH12 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 12),
          };
        }
        if (!fH13?.data) {
          fH13 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 13),
          };
        }
        if (!fH14?.data) {
          fH14 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 14),
          };
        }
        if (!fH15?.data) {
          fH15 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 15),
          };
        }
        if (!fH16?.data) {
          fH16 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 16),
          };
        }
        if (!fH17?.data) {
          fH17 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 17),
          };
        }
        if (!fH18?.data) {
          fH18 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 18),
          };
        }
        if (!fH19?.data) {
          fH19 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 19),
          };
        }
        if (!fH20?.data) {
          fH20 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 20),
          };
        }
        if (!fH21?.data) {
          fH21 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 21),
          };
        }
        if (!fH22?.data) {
          fH22 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 22),
          };
        }
        if (!fH23?.data) {
          fH23 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 23),
          };
        }
        if (!fH24?.data) {
          fH24 = {
            ix: iTime,
            data: fHrIn0(grouped[iTime]?.data, 24),
          };
        }
      }

      const hNumber = (hr: any) => {
        if (hr === '00') {
          return 1;
        } else if (hr === '01') {
          return 2;
        } else if (hr === '02') {
          return 3;
        } else if (hr === '03') {
          return 4;
        } else if (hr === '04') {
          return 5;
        } else if (hr === '05') {
          return 6;
        } else if (hr === '06') {
          return 7;
        } else if (hr === '07') {
          return 8;
        } else if (hr === '08') {
          return 9;
        } else if (hr === '09') {
          return 10;
        } else if (hr === '10') {
          return 11;
        } else if (hr === '11') {
          return 12;
        } else if (hr === '12') {
          return 13;
        } else if (hr === '13') {
          return 14;
        } else if (hr === '14') {
          return 15;
        } else if (hr === '15') {
          return 16;
        } else if (hr === '16') {
          return 17;
        } else if (hr === '17') {
          return 18;
        } else if (hr === '18') {
          return 19;
        } else if (hr === '19') {
          return 20;
        } else if (hr === '20') {
          return 21;
        } else if (hr === '21') {
          return 22;
        } else if (hr === '22') {
          return 23;
        } else if (hr === '23') {
          return 24;
        }
      };

      const calcHf = (hourN: any) => {
        if (hourN?.data) {

          const calcArrH = grouped.slice(hourN?.ix + 1);
          const h_step_main = hourN?.data;
          const h_step_h1 = calcArrH[0]?.data[0] || null;
          const h_step_h2 = calcArrH[1]?.data[0] || null;

          const checkMandH1 =
            h_step_main?.gasDay !== h_step_h1?.gasDay ? true : false; // true 0 คือ ข้ามวัน
          const checkH1andhH2 =
            h_step_h1?.gasDay !== h_step_h2?.gasDay ? true : false; // true 0 คือ ข้ามวัน
          const hourM =
            (!!h_step_main?.energy && Number(h_step_main?.energy)) || 0;
          const hourH1 = checkMandH1
            ? 0
            : (!!h_step_h1?.energy && Number(h_step_h1?.energy)) || 0;
          const hourH2 = checkH1andhH2
            ? 0
            : (!!h_step_h2?.energy && Number(h_step_h2?.energy)) || 0;

          const nhourM = hNumber(
            dayjs(h_step_main?.registerTimestamp)
              .format('HH'),
          );
          const nhourH1 = checkMandH1
            ? 0
            : hNumber(
              dayjs(h_step_h1?.registerTimestamp)
                .format('HH'),
            );
          const nhourH2 = checkH1andhH2
            ? 0
            : hNumber(
              dayjs(h_step_h2?.registerTimestamp)
                .format('HH'),
            );
          // สูตร ABS((h1-0)/(1-0)-(h24-h23)/(24-23)) h1 => 1 ชั่งโมงตัวเอง, 0 = ข้ามวัน, (1-0 คือชั่วโมงตัวเองลบชั่วโมงก่อนหน้า ถ้าก่อนหน้าข้ามวันให้ 0), (24-23 คือชั่วโมงตัวก่อนหน้าลบชั่วโมงก่อนหน้า2ชม ถ้าก่อนหน้าลบชั่วโมงก่อนหน้า2ชมข้ามวันให้ 0)
          const calcCondition1 = Math.abs(
            (hourM - hourH1) / (nhourM - nhourH1) -
            (hourH1 - hourH2) / (nhourH1 - nhourH2),
          );

          if (calcCondition1 === Infinity) {
            return { url: 'Div/0', type: 'Div/0' };
          }
          if (calcCondition1 < 0) {
            return { url: checkCondition?.red_url || null, type: 'red_url' };
          }
          if (calcCondition1 < checkCondition?.thershold) {
            return {
              url: checkCondition?.green_url || null,
              type: 'green_url',
            };
          } else {
            // สูตร ((h1-h2)/(t1-t2))/(ABS(h2-h3)/(T2-T3))*100
            const calcCondition2 =
              ((hourM - hourH1) /
                (nhourM - nhourH1) /
                (Math.abs(hourH1 - hourH2) / (nhourH1 - nhourH2))) *
              100;
            if (calcCondition2 === Infinity) {
              return { url: 'Div/0', type: 'Div/0' };
            }
            if (calcCondition2 > checkCondition?.orange_value) {
              return { url: '>%high', type: '>%high' };
            }
            if (calcCondition2 < checkCondition?.yellow_value) {
              if (calcCondition2 < 0) {
                return {
                  url: checkCondition?.red_url || null,
                  type: 'red_url',
                };
              } else if (calcCondition2 === 0) {
                return {
                  url: checkCondition?.purple_url || null,
                  type: 'purple_url',
                };
              } else {
                return { url: '<%low', type: '<%low' };
              }
            } else {
              return {
                url: checkCondition?.green_url || null,
                type: 'green_url',
              };
            }
          }
        } else {
          return { url: checkCondition?.gray_url || null, type: 'gray_url' };
        }
      };
      // console.log('fH1 : ', fH1);
      const nFH1 = calcHf(fH1);
      const nFH2 = calcHf(fH2);
      const nFH3 = calcHf(fH3);
      const nFH4 = calcHf(fH4);
      const nFH5 = calcHf(fH5);
      const nFH6 = calcHf(fH6);
      const nFH7 = calcHf(fH7);
      const nFH8 = calcHf(fH8);
      const nFH9 = calcHf(fH9);
      const nFH10 = calcHf(fH10);
      const nFH11 = calcHf(fH11);
      const nFH12 = calcHf(fH12);
      const nFH13 = calcHf(fH13);
      const nFH14 = calcHf(fH14);
      const nFH15 = calcHf(fH15);
      const nFH16 = calcHf(fH16);
      const nFH17 = calcHf(fH17);
      const nFH18 = calcHf(fH18);
      const nFH19 = calcHf(fH19);
      const nFH20 = calcHf(fH20);
      const nFH21 = calcHf(fH21);
      const nFH22 = calcHf(fH22);
      const nFH23 = calcHf(fH23);
      const nFH24 = calcHf(fH24);

      const timeHr = {
        '00:00': nFH1?.url,
        '01:00': nFH2?.url,
        '02:00': nFH3?.url,
        '03:00': nFH4?.url,
        '04:00': nFH5?.url,
        '05:00': nFH6?.url,
        '06:00': nFH7?.url,
        '07:00': nFH8?.url,
        '08:00': nFH9?.url,
        '09:00': nFH10?.url,
        '10:00': nFH11?.url,
        '11:00': nFH12?.url,
        '12:00': nFH13?.url,
        '13:00': nFH14?.url,
        '14:00': nFH15?.url,
        '15:00': nFH16?.url,
        '16:00': nFH17?.url,
        '17:00': nFH18?.url,
        '18:00': nFH19?.url,
        '19:00': nFH20?.url,
        '20:00': nFH21?.url,
        '21:00': nFH22?.url,
        '22:00': nFH23?.url,
        '23:00': nFH24?.url,
        'type_00:00': nFH1?.type,
        'type_01:00': nFH2?.type,
        'type_02:00': nFH3?.type,
        'type_03:00': nFH4?.type,
        'type_04:00': nFH5?.type,
        'type_05:00': nFH6?.type,
        'type_06:00': nFH7?.type,
        'type_07:00': nFH8?.type,
        'type_08:00': nFH9?.type,
        'type_09:00': nFH10?.type,
        'type_10:00': nFH11?.type,
        'type_11:00': nFH12?.type,
        'type_12:00': nFH13?.type,
        'type_13:00': nFH14?.type,
        'type_14:00': nFH15?.type,
        'type_15:00': nFH16?.type,
        'type_16:00': nFH17?.type,
        'type_17:00': nFH18?.type,
        'type_18:00': nFH19?.type,
        'type_19:00': nFH20?.type,
        'type_20:00': nFH21?.type,
        'type_21:00': nFH22?.type,
        'type_22:00': nFH23?.type,
        'type_23:00': nFH24?.type,
      };

      return {
        ...e,
        gasDay,
        meteringPointId: e?.metered_point_name,
        ...timeHr,
      };
    });

    return newData;
  }

  // async providerNotiInapp(type: any, message: any, email: any) {

  //   const axios = require('axios');
  //   let data = JSON.stringify({
  //     "extras": {
  //       "email": email,
  //     },
  //     "message": message || "",
  //     "priority": 1,
  //     "title": type || ""
  //   });

  //   let config = {
  //     method: 'post',
  //     maxBodyLength: Infinity,
  //     url: `${process.env.IN_APP_URL}`,
  //     headers: {
  //       'Content-Type': 'application/json',
  //       'Authorization': 'Bearer AejdWIi3v4neWDV'
  //     },
  //     data: data
  //   };

  //   const sendData = await axios.request(config)

  // }

  async procressMetered(payload: any, userId: any) {
    const { startDate, endDate } = payload;

    const newDate = dayjs()
    const todayStart = dayjs().startOf('day').toDate();
    const todayEnd = dayjs().endOf('day').toDate();

    const meteredCount = await this.prisma.metered_run_number.count({
      where: {
        create_date: {
          gte: todayStart, // มากกว่าหรือเท่ากับเวลาเริ่มต้นของวันนี้
          lte: todayEnd, // น้อยกว่าหรือเท่ากับเวลาสิ้นสุดของวันนี้
        },
      },
    });
    const meteringRetrievingId = `${newDate.format("YYYYMMDD")}-MET-${(meteredCount > 0 ? meteredCount + 1 : 1).toString().padStart(4, '0')}`
    const insertTimestamp = newDate.format("YYYY-MM-DD HH:mm:ss")
    const insertTimestampDDMMYYYY = dayjs().format('DD/MM/YYYY HH:mm:ss');
    console.log('meteringRetrievingId : ', meteringRetrievingId);
    console.log('insertTimestamp : ', insertTimestamp);
    const metered_run_number = await this.prisma.metered_run_number.create({
      data: {
        metering_retrieving_id: meteringRetrievingId,
        create_date: newDate.toDate(),
        create_date_num: dayjs().unix(),
      },
    });

    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: 'execute-date',
        mode: 'metering',
        metering_retrieving_id: meteringRetrievingId,
        insert_timestamp: insertTimestamp,
        start_date: startDate,
        end_date: endDate,
      }),
    );
    const reply = this.safeParseJSON(meteredMicroData?.reply);
    console.log('reply : ', reply);

    if (reply?.status && reply.data.length > 0) {
      console.log('--status----');

      const resData = await this.prisma.metering_point.findMany({
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
          non_tpa_point: {
            include: {
              nomination_point: {
                include: {
                  contract_point: {
                    include: {
                      area: true,
                      zone: true,
                      shipper_contract_point: {
                        include: {
                          group: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          nomination_point: {
            include: {
              contract_point: {
                include: {
                  area: true,
                  zone: true,
                  shipper_contract_point: {
                    include: {
                      group: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          id: 'desc',
        },
      });
      const logsData = [];
      for (let i = 0; i < reply?.data.length; i++) {
        const findMeterDam = resData?.find((f: any) => {
          return f?.metered_point_name === reply?.data[i]?.meteringPointId;
        });
        if (findMeterDam) {
          if (Number(reply?.data[i]?.energy) <= 0) {
            // มี แต่ energy 0
            logsData.push({
              metered_run_number_id: metered_run_number?.id,
              temp: JSON.stringify(reply?.data[i]),
              type: 'retrieving',
              description: 'The mandatory field energy must be informed',
              timestamp: newDate.toDate(),
              metering_point_sys: reply?.data[i]?.meteringPointId,
            });
          }
        } else {
          // ไม่มี
          logsData.push({
            metered_run_number_id: metered_run_number?.id,
            temp: JSON.stringify(reply?.data[i]),
            type: 'retrieving',
            description: `The point ${reply?.data[i]?.meteringPointId} does not exist in TPA system or is not valid`,
            timestamp: newDate.toDate(),
            metering_point_sys: reply?.data[i]?.meteringPointId,
          });

          logsData.push({
            metered_run_number_id: metered_run_number?.id,
            temp: JSON.stringify(reply?.data[i]),
            type: 'mastering data check',
            description: `The point ${reply?.data[i]?.meteringPointId} does not exist in TPA system or is not valid`,
            timestamp: newDate.toDate(),
            metering_point_sys: reply?.data[i]?.meteringPointId,
            gas_day: reply?.data[i]?.gasDay ? dayjs(reply?.data[i]?.gasDay, "YYYY-MM-DD").toDate() : null,
          });
        }
      }
      // console.log('logsData : ', logsData);
      if (logsData.length > 0) {
        await this.prisma.metered_retrieving.createMany({
          data: logsData,
        });
      }
    }

    // const user = await this.prisma.account.findFirst({
    //   where: {
    //     id: Number(userId)
    //   },
    // })
    // console.log('email : ', user?.email);
    // if (reply?.status) {
    //   const message = `Metering Interface: Data retrieving for the period {${startDate} - ${endDate}} and executed on {${insertTimestampDDMMYYYY}} {finished OK}   {(Metering Input Code ${meteringRetrievingId})}. {${reply.data}/${reply.data} registers inserted}. Allocation and Balancing process should be executed.`
    //   // await this.providerNotiInapp("Meter Execute", message, [user?.email])
    //   await middleNotiInapp(
    //     this.prisma,
    //     'Metering Management',
    //     message,
    //     77, // Metering Management menus_id
    //     1,
    //   );
    // } else {
    //   const message = `Metering Interface: Data retrieving for the period {${startDate} - ${endDate}} and executed on {${insertTimestampDDMMYYYY}} {Error}.`
    //   // await this.providerNotiInapp("Meter Execute", message, [user?.email])
    //   await middleNotiInapp(
    //     this.prisma,
    //     'Metering Management',
    //     message,
    //     77, // Metering Management menus_id
    //     1,
    //   );
    // }


    return reply;
  }

  async updateExecuteStatus(payload: any, userId: any) {
    if (payload?.is_success) {
      const message = `Metering Interface: Data retrieving for the period ${payload.start_date} - ${payload.end_date} and executed on ${payload.insert_timestamp} finished OK   (Metering Input Code ${payload.metering_retrieving_id}). ${payload.susscess_points}/${payload.total_points} registers inserted. Allocation and Balancing process should be executed.`
      await middleNotiInapp(
        this.prisma,
        'Metering',
        message,
        77, // Metering Management menus_id
        1,
      );
    } else {
      const message = `Metering Interface: Data retrieving for the period ${payload.start_date} - ${payload.end_date} and executed on ${payload.insert_timestamp} ${payload.message}.`
      await middleNotiInapp(
        this.prisma,
        'Metering',
        message,
        77, // Metering Management menus_id
        1,
      );
    }

    return true;
  }

  async test(query: any) {
    console.log('*****run***');
    const { share, start_date, end_date } = query;

    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: 'getLast',
        mode: 'metering',
        // start_date: start_date,
        // end_date: end_date
        start_date: '2025-07-10',
        end_date: '2025-07-10',
      }),
    );

    console.log('****end****');
    // console.log('start_date : ', start_date);
    // console.log('end_date : ', end_date);
    console.log(this.safeParseJSON(meteredMicroData?.reply));
    const dataConvert = this.safeParseJSON(meteredMicroData?.reply);
    console.log('dataConvert : ', dataConvert);
    return dataConvert;
  }

  // #region ปรับ mastering data check ไปเป็นถ้าไม่มีค่า energy เลยในช่วงเวลาที่เลือกถึงจะไปแสดงผลที่หน้าบ้าน
  async meteringRetrievingMasterCheckLimit2(
    limit = 100,
    offset = 0,
    startDate?: any,
    endDate?: any,
    metered_run_number_id?: any
  ) {
    const andWhere: Prisma.metered_retrievingWhereInput[] = [
      {
        type: 'mastering data check'
      }
    ]

    if (metered_run_number_id) {
      andWhere.push({
        metered_run_number_id: Number(metered_run_number_id),
      })
    }

    const start = dayjs(startDate, "YYYY-MM-DD");
    const end = dayjs(endDate, "YYYY-MM-DD");
    if (start.isValid() || end.isValid()) {
      if (start.isValid()) {
        andWhere.push({
          gas_day: { gte: start.toDate() }
        })
      }
      if (end.isValid()) {
        andWhere.push({
          gas_day: { lte: end.toDate() }
        })
      }
    }

    // 1. Query ข้อมูลหลัก
    const resData = await this.prisma.metered_retrieving.findMany({
      where: {
        AND: andWhere
      },
      include: { metered_run_number: true },
      orderBy: { id: 'desc' },
    })
    const activeMeteringPoint = await this.prisma.metering_point.findMany({
      where: {
        start_date: {
          lte: end.toDate()
        },
        OR: [
          { end_date: null },
          { end_date: { gte: start.toDate() } }
        ]
      }
    })
    // const activeConceptPoint = await this.prisma.concept_point.findMany({
    //   where: {
    //     type_concept_point_id: 2, // Metering Physical gas concept
    //     start_date: {
    //       lte: end.toDate()
    //     },
    //     OR: [
    //       { end_date: null },
    //       { end_date: { gte: start.toDate() } }
    //     ]
    //   }
    // })

    // Group data by metering_point_sys
    const groupedData = resData.reduce((acc: any, item: any) => {
      const meteringPointSys = item.metering_point_sys;
      if (!acc[meteringPointSys]) {
        acc[meteringPointSys] = [];
      }
      acc[meteringPointSys].push(item);
      return acc;
    }, {});

    // ถ้ามีตัวใดตัวนึง del_flag เป็น true หมายความว่า มีตัวนั้นมีค่ามาแล้วให้ลบออก
    const removedMeterThatHaveEnergy = Object.values(groupedData).filter((meteredRetrievingList: any) => !meteredRetrievingList.some((meteredRetrieving: any) => meteredRetrieving.del_flag == true))
    const removedMeterPointThatHaveEnergy = activeMeteringPoint.filter(meteringPoint => !resData.some((e: any) => isMatch(e.metering_point_sys, meteringPoint.metered_point_name) && e.del_flag == true))
    // const removedConceptPointThatHaveEnergy = activeConceptPoint.filter(conceptPoint => !resData.some((e: any) => isMatch(e.metering_point_sys, conceptPoint.concept_point) && e.del_flag == true))

    // ทำให้เหลือแค่ meter อย่างละตัว
    // Get the latest gas_day for each meteredRetrievingList
    const meteredRetrievingWithLatestGasDay = removedMeterThatHaveEnergy.map((meteredRetrievingList: any) => {
      // Find the latest gas_day in this group
      const latestRecord = meteredRetrievingList.reduce((latest: any, current: any) => {
        if (!latest || !latest.gas_day) return current;
        if (!current.gas_day) return latest;

        // Compare gas_day dates
        const latestDate = new Date(latest.gas_day);
        const currentDate = new Date(current.gas_day);

        return currentDate > latestDate ? current : latest;
      }, null);

      // return {
      //   meteringPointSys: meteredRetrievingList[0]?.metering_point_sys,
      //   latestGasDay: latestRecord?.gas_day,
      //   latestRecord: latestRecord,
      //   allRecords: meteredRetrievingList
      // };
      return latestRecord;
    });
    removedMeterPointThatHaveEnergy
      .filter(meteringPoint => !meteredRetrievingWithLatestGasDay.some((meteredRetrieving: any) => isMatch(meteredRetrieving.metering_point_sys, meteringPoint.metered_point_name)))
      .map(meteringPoint => {
        meteredRetrievingWithLatestGasDay.push({
          "type": "mastering data check",
          "description": `The point ${meteringPoint.metered_point_name} does not retrieved Metering data`,
          "metering_point_sys": meteringPoint.metered_point_name,
          "gas_day": end.toISOString(),
          "temp": JSON.stringify({
            "gasDay": end.format("YYYY-MM-DD"),
            "meteringPointId": meteringPoint.metered_point_name,
          })
        })
      })

    // removedConceptPointThatHaveEnergy
    // .filter(conceptPoint => !meteredRetrievingWithLatestGasDay.some((meteredRetrieving: any) => isMatch(meteredRetrieving.metering_point_sys, conceptPoint.concept_point)))
    // .map(conceptPoint => {
    //   meteredRetrievingWithLatestGasDay.push({
    //     "type": "mastering data check",
    //     "description": `The point ${conceptPoint.concept_point} does not retrieved Metering data`,
    //     "metering_point_sys": conceptPoint.concept_point,
    //     "gas_day": end.toISOString(),
    //     "temp": JSON.stringify({
    //       "gasDay": end.format("YYYY-MM-DD"),
    //       "meteringPointId": conceptPoint.concept_point,
    //     })
    //   })
    // })

    // 2. Query นับ total
    const total = meteredRetrievingWithLatestGasDay.length;

    // 3. Process data
    const newResData = meteredRetrievingWithLatestGasDay.map((e: any) => {
      e['data'] = this.safeParseJSON(e?.['temp']);
      delete e['temp'];
      return { ...e };
    });

    // 4. Return แบบรองรับ frontend
    return {
      total,
      // data: newResData.slice(Number(offset), Number(offset) + Number(limit)),
      data: newResData,
      limit: Number(limit),
      offset: Number(offset),
    };
  }

  async checkData2() {
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const meteredMaster = await this.prisma.metering_point.findMany({
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
        metered_point_name: true,
      },
      orderBy: {
        id: 'desc',
      },
    });

    const resData = await this.prisma.metered_retrieving.findMany({
      where: {
        del_flag: null,
        type: 'mastering data check',
      },
      select: {
        id: true,
        metering_point_sys: true,
      },
      orderBy: {
        id: 'desc',
      },
    });
    const dataSet: any = [];
    for (let i = 0; i < resData.length; i++) {
      const find = meteredMaster.find((f: any) => {
        return f?.metered_point_name === resData[i]?.metering_point_sys;
      });
      if (find) {
        dataSet.push(resData[i]?.id);
      }
    }
    // if (dataSet.length > 0) {
    //   await this.prisma.metered_retrieving.updateMany({
    //     where: {
    //       id: {
    //         in: dataSet,
    //       },
    //     },
    //     data: {
    //       del_flag: true,
    //     },
    //   });
    // }

    return {
      count: dataSet.length,
    };
  }

  async uploadFile2(
    file: any,
    fileOriginal: any,
    // userId: any,
  ) {

    const newDate = getTodayNow();
    try {
      const newDate7 = getTodayNowAdd7();
      const todayStart = getTodayStartAdd7().toDate();
      const todayEnd = getTodayEndAdd7().toDate();
      const findData = this.safeParseJSON(file?.jsonDataMultiSheet);

      const meteredCount = await this.prisma.metered_run_number.count({
        where: {
          create_date: {
            gte: todayStart, // มากกว่าหรือเท่ากับเวลาเริ่มต้นของวันนี้
            lte: todayEnd, // น้อยกว่าหรือเท่ากับเวลาสิ้นสุดของวันนี้
          },
        },
      });
      const meteringRetrievingId = `${newDate7.format('YYYYMMDD')}-MET-${(meteredCount > 0 ? meteredCount + 1 : 1).toString().padStart(4, '0')}`;
      const insertTimestamp = newDate.format('YYYY-MM-DD HH:mm:ss');
      // console.log('meteringRetrievingId : ', meteringRetrievingId);
      // console.log('insertTimestamp : ', insertTimestamp);
      let meterArr = []

      const sheetArr = findData.filter((f: any) => {
        return /^Daily Metering Data(\s\(\d+\))?$/.test(f?.sheet || '');
      });

      if (sheetArr.length <= 0) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Sheet name is invalid.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      for (let i = 0; i < sheetArr.length; i++) {
        const sheet1 = sheetArr[i]

        const gasDay = sheet1.data[1];
        const headerCol = sheet1.data[2];
        const valueCol = sheet1.data.slice(3);
        // console.log('valueCol : ', valueCol);
        function isValidGasDay(value) {
          // ต้องเป็น string ก่อน
          console.log('value : ', value);
          if (typeof value?.[0] !== "string") return false;

          // ตรวจว่าเป็นรูปแบบ YYYY-MM-DD และเป็นวันจริง
          return dayjs(value?.[0], "YYYY-MM-DD", true).isValid();
        }

        if (!isValidGasDay(gasDay)) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Gas Day is required.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        if (valueCol.length === 0) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Required field is missing: Point_ID / Register Timestamp / Energy.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
        // 2025-07-09T11:30:00.569+01:00

        function isValidStrictIsoDatetime(value) {
          if (typeof value !== "string") return false;

          const regex =
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/;

          return regex.test(value);
        }

        // console.log('headerCol : ', headerCol);
        const correctHeaders = [
          'POINT_ID',
          'REGISTER_TIMSTAMP',
          'VOLUME',
          'ENERGY',
          'HV',
          'WI',
          'CO2',
          'C1',
          'C2',
          'C2+',
          'C3',
          'iC4',
          'nC4',
          'iC5',
          'nC5',
          'C6',
          'C7',
          'N2',
          'O2',
          'H2S',
          'S',
          'Hg',
          'Pressure',
          'Moisture',
          'DewPoint',
          'SG',
          'Datasource',
        ];

        function validateHeaderCol(headerCol, correctHeaders) {
          // แปลง object → array
          const values = Object.values(headerCol);

          // ตรวจว่าความยาวต้องเท่ากัน
          if (values.length !== correctHeaders.length) {
            console.log('❌ จำนวน header ไม่เท่ากัน');
            return false;
          }

          // เช็คค่าทีละตัว
          for (let i = 0; i < values.length; i++) {
            if (values[i] !== correctHeaders[i]) {
              console.log(`❌ Header ผิดที่ index ${i} → ${values[i]} ≠ ${correctHeaders[i]}`);
              return false;
            }
          }

          console.log('✅ Header ถูกต้องทั้งหมด');
          return true;
        }

        if (!validateHeaderCol(headerCol, correctHeaders)) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Template format is invalid.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        // Required field is missing: Point_ID / Register Timestamp / Energy.
        const newValue = valueCol.map((e: any) => {
          const headerRow = Object.keys(headerCol).map((obj: any) => {
            if (Number(obj) >= 2) {
              const value = e[obj];
              if (value !== undefined && value !== null) {
                if (Number(value) < 0) {
                  console.log('เจอติดลบ');
                  throw new HttpException(
                    {
                      status: HttpStatus.BAD_REQUEST,
                      error: 'Negative values are not allowed in Volume, Energy, HV, or WI.',
                    },
                    HttpStatus.BAD_REQUEST,
                  );
                }
              }
            }
            if (Number(obj) === 1) {
              if (!e[obj]) { // https://app.clickup.com/t/86eub6d6p
                throw new HttpException(
                  {
                    status: HttpStatus.BAD_REQUEST,
                    error: 'Required field is missing: Point_ID / Register Timestamp / Energy.',
                  },
                  HttpStatus.BAD_REQUEST,
                );
              }
              const ckRegis = isValidStrictIsoDatetime(e[obj])
              if (!ckRegis) {
                throw new HttpException(
                  {
                    status: HttpStatus.BAD_REQUEST,
                    error: 'Register Timestamp must be earlier or equal to Current date.',
                  },
                  HttpStatus.BAD_REQUEST,
                );
              }
              e[obj] = e[obj].split('+')[0]
            }
            return {
              [headerCol[obj]]: {
                key: obj,
                value: e[obj] || null,
              },
            };
          });

          const merged = Object.assign({}, ...headerRow);
          return merged;
        });

        const newData = {
          gasDay: gasDay['0'],
          data: newValue,
          tempExcel: findData,
        };

        if (!newData?.gasDay) {
          console.log('gasday');
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Date is NOT match',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
        const ckDay = newDate7.isBefore(dayjs(newData?.gasDay, 'YYYY-MM-DD'));
        if (ckDay) {
          console.log('ckDay');
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Date is NOT match',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        for (let i = 0; i < newData.data.length; i++) {
          // ห้ามว่าง
          // newData.data[i]?.POINT_ID?.value
          // newData.data[i]?.REGISTER_TIMSTAMP?.value
          // newData.data[i]?.ENERGY?.value
          if (!newData.data[i]?.POINT_ID?.value) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Required field is missing: Point_ID',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else if (!newData.data[i]?.REGISTER_TIMSTAMP?.value) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Required field is missing: Register Timestamp',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else if (!newData.data[i]?.ENERGY?.value) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Required field is missing: Energy.',
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          // ห้ามติดลบ
          // newData.data[i]?.VOLUME?.value
          // newData.data[i]?.ENERGY?.value
          // newData.data[i]?.HV?.value
          // newData.data[i]?.WI?.value
          if (
            !!newData.data[i]?.VOLUME?.value &&
            Number(newData.data[i]?.VOLUME?.value) < 0
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Date is NOT match',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else if (
            !!newData.data[i]?.ENERGY?.value &&
            Number(newData.data[i]?.ENERGY?.value) < 0
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Date is NOT match',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else if (
            !!newData.data[i]?.HV?.value &&
            Number(newData.data[i]?.HV?.value) < 0
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Date is NOT match',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else if (
            !!newData.data[i]?.WI?.value &&
            Number(newData.data[i]?.WI?.value) < 0
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Date is NOT match',
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          // newData.data[i]?.REGISTER_TIMSTAMP?.value -> 2024-03-15T11:30:00.569+01:00
          // newData.data[i]?.REGISTER_TIMSTAMP?.value -> 2024-03-15T11:30:00.569
          const registerTime = dayjs(newData.data[i]?.REGISTER_TIMSTAMP?.value);
          const ckRg = newDate7.isBefore(registerTime);
          if (ckRg) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Register Timestamp must be earlier or equal to Current date.',
              },
              HttpStatus.BAD_REQUEST,
            );
          }
        }

        meterArr = [...meterArr, newData]

      }

      let countMeter = 0
      for (let i = 0; i < meterArr.length; i++) {

        const meteredMicroData = await this.meteredMicroService.sendMessage(
          JSON.stringify({
            case: 'upload-json',
            mode: 'metering',
            metering_retrieving_id: meteringRetrievingId,
            insert_timestamp: insertTimestamp,
            json_data: meterArr[i],
          }),
        );

        const reply = this.safeParseJSON(meteredMicroData?.reply);
        // console.log('reply : ', reply);

        if (reply?.status) {
          const metered_run_number = await this.prisma.metered_run_number.create({
            data: {
              metering_retrieving_id: meteringRetrievingId,
              create_date: newDate7.toDate(),
              create_date_num: newDate7.unix(),
            },
          });

          const gasDay = dayjs(reply?.data[i]?.gasDay ?? reply?.data[i]?.data?.gasDay ?? meterArr[i].gasDay, "YYYY-MM-DD").toDate();
          const resData = await this.prisma.metering_point.findMany({
            where: {
              AND: [
                {
                  start_date: {
                    lte: gasDay, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
                  },
                },
                {
                  OR: [
                    { end_date: null }, // ถ้า end_date เป็น null
                    { end_date: { gte: gasDay } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
                  ],
                },
              ],
            },
            include: {
              non_tpa_point: {
                include: {
                  nomination_point: {
                    include: {
                      contract_point: {
                        include: {
                          area: true,
                          zone: true,
                          shipper_contract_point: {
                            include: {
                              group: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              nomination_point: {
                include: {
                  contract_point: {
                    include: {
                      area: true,
                      zone: true,
                      shipper_contract_point: {
                        include: {
                          group: true,
                        },
                      },
                    },
                  },
                },
              },
            },
            orderBy: {
              id: 'desc',
            },
          });
          const logsData = [];

          for (let i = 0; i < (reply?.data?.length || 0); i++) {
            const findMeterDam = resData?.find((f: any) => {
              return f?.metered_point_name === reply?.data[i]?.meteringPointId;
            });

            if (!reply?.data[i]?.energy && reply?.data[i]?.energy != 0) {
              // ไม่มี energy
              if (findMeterDam) {
                // ไม่มี energy แต่ มีใน DAM 
                logsData.push({
                  metered_run_number_id: metered_run_number?.id,
                  temp: JSON.stringify(reply?.data[i]),
                  type: 'mastering data check',
                  description: `The point ${reply?.data[i]?.meteringPointId} does not retrieved Metering data`,
                  timestamp: newDate7.toDate(),
                  metering_point_sys: reply?.data[i]?.meteringPointId,
                  gas_day: gasDay,
                  create_date: newDate.toDate(),
                  create_date_num: newDate.unix(),
                });
              }
            }
            else {
              // มี energy
              if (reply?.data[i]?.meteringPointId) {
                // เอาไปใส่ mastering data check เพื่อให้เวลาหาเป็นช่วงเวลาจะได้รู้ว่า meter นี้มีค่ามาแล้ว
                const count = await this.prisma.metered_retrieving.count({
                  where: { del_flag: true, type: 'mastering data check', metered_run_number_id: metered_run_number?.id, metering_point_sys: reply?.data[i]?.meteringPointId },
                })
                if (count == 0) {
                  logsData.push({
                    metered_run_number_id: metered_run_number?.id,
                    temp: JSON.stringify(reply?.data[i]),
                    type: 'mastering data check',
                    description: `The point ${reply?.data[i]?.meteringPointId} already retrieved Metering data`,
                    timestamp: newDate7.toDate(),
                    metering_point_sys: reply?.data[i]?.meteringPointId,
                    gas_day: gasDay,
                    del_flag: true,
                    create_date: newDate.toDate(),
                    create_date_num: newDate.unix(),
                  });
                }

                if (!findMeterDam) {
                  // มี energy แต่ ไม่มีใน DAM 
                  logsData.push({
                    metered_run_number_id: metered_run_number?.id,
                    temp: JSON.stringify(reply?.data[i]),
                    type: 'retrieving',
                    description: `The point ${reply?.data[i]?.meteringPointId} does not exist in TPA system or is not valid`,
                    timestamp: newDate7.toDate(),
                    metering_point_sys: reply?.data[i]?.meteringPointId,
                    gas_day: gasDay,
                    create_date: newDate.toDate(),
                    create_date_num: newDate.unix(),
                  });
                }
                // else{
                //   // มี energy และ มีใน DAM
                // }
              }
              else {
                // มี energy แต่ ไม่มี meteringPointId
                logsData.push({
                  metered_run_number_id: metered_run_number?.id,
                  temp: JSON.stringify(reply?.data[i]),
                  type: 'retrieving',
                  description: 'The mandatory field Metering Point ID must be informed',
                  timestamp: newDate7.toDate(),
                  metering_point_sys: reply?.data[i]?.meteringPointId,
                  gas_day: gasDay,
                  create_date: newDate.toDate(),
                  create_date_num: newDate.unix(),
                });
              }
            }
          }
          if (logsData.length > 0) {
            await this.prisma.metered_retrieving.createMany({
              data: logsData,
            });
          }
        }
        countMeter = + 1
      }

      await middleNotiInapp(
        this.prisma,
        'Metering', // 'Metering Management',
        `Metering Interface: Data retrieving from file ${fileOriginal.originalname && String(fileOriginal.originalname) || ""}.xlsx executed on ${insertTimestamp}[finished OK}   (Metering Input Code ${meteringRetrievingId})}. {${countMeter}/${meterArr.length} registers inserted. Allocation and Balancing process should be executed.`,
        77, // Metering Management menus_id
        1,
      );

      return "success";

    } catch (error) {
      await middleNotiInapp(
        this.prisma,
        'Metering', // 'Metering Management',
        `Metering Interface: Data retrieving from file ${fileOriginal.originalname && String(fileOriginal.originalname) || ""}.xlsx executed on ${newDate.format('YYYY-MM-DD HH:mm:ss')} {Error}.`,
        77, // Metering Management menus_id
        1,
      );
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: error.response.error,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async procressMetered2(payload: any, userId: any) {
    const { startDate, endDate } = payload;

    const newDate = dayjs()
    const todayStart = dayjs().startOf('day').toDate();
    const todayEnd = dayjs().endOf('day').toDate();
    const start = dayjs(startDate, "YYYY-MM-DD").toDate();
    const end = dayjs(endDate, "YYYY-MM-DD").toDate();

    const meteredCount = await this.prisma.metered_run_number.count({
      where: {
        create_date: {
          gte: todayStart, // มากกว่าหรือเท่ากับเวลาเริ่มต้นของวันนี้
          lte: todayEnd, // น้อยกว่าหรือเท่ากับเวลาสิ้นสุดของวันนี้
        },
      },
    });
    const meteringRetrievingId = `${newDate.format("YYYYMMDD")}-MET-${(meteredCount > 0 ? meteredCount + 1 : 1).toString().padStart(4, '0')}`
    const insertTimestamp = newDate.format("YYYY-MM-DD HH:mm:ss")
    const metered_run_number = await this.prisma.metered_run_number.create({
      data: {
        metering_retrieving_id: meteringRetrievingId,
        create_date: newDate.toDate(),
        create_date_num: dayjs().unix(),
      },
    });

    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: 'execute-date',
        mode: 'metering',
        metering_retrieving_id: meteringRetrievingId,
        insert_timestamp: insertTimestamp,
        start_date: startDate,
        end_date: endDate,
      }),
    );
    const reply = this.safeParseJSON(meteredMicroData?.reply);

    if (reply?.status && reply.data.length > 0) {
      const resData = await this.prisma.metering_point.findMany({
        where: {
          AND: [
            {
              start_date: {
                lte: end, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
              },
            },
            {
              OR: [
                { end_date: null }, // ถ้า end_date เป็น null
                { end_date: { gte: start } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
              ],
            },
          ],
        },
        include: {
          non_tpa_point: {
            include: {
              nomination_point: {
                include: {
                  contract_point: {
                    include: {
                      area: true,
                      zone: true,
                      shipper_contract_point: {
                        include: {
                          group: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          nomination_point: {
            include: {
              contract_point: {
                include: {
                  area: true,
                  zone: true,
                  shipper_contract_point: {
                    include: {
                      group: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          id: 'desc',
        },
      });
      const logsData = [];
      for (let i = 0; i < reply?.data.length; i++) {
        let gasDay: dayjs.Dayjs | null = reply?.data[i]?.gasDay ? dayjs(reply?.data[i]?.gasDay, "YYYY-MM-DD") : null;
        gasDay = gasDay?.isValid() ? gasDay : null;
        const findMeterDam = resData?.find((f: any) => {
          return f?.metered_point_name === reply?.data[i]?.meteringPointId &&
            dayjs(f?.start_date).isSameOrBefore(gasDay, "day") &&
            ((!f?.end_date) || dayjs(f?.end_date).isAfter(gasDay, "day"));
        });
        if (!reply?.data[i]?.energy && reply?.data[i]?.energy != 0) {
          // ไม่มี energy
          if (findMeterDam) {
            // ไม่มี energy แต่ มีใน DAM 
            logsData.push({
              metered_run_number_id: metered_run_number?.id,
              temp: JSON.stringify(reply?.data[i]),
              type: 'mastering data check',
              description: `The point ${reply?.data[i]?.meteringPointId} does not retrieved Metering data`,
              timestamp: newDate.toDate(),
              metering_point_sys: reply?.data[i]?.meteringPointId,
              gas_day: gasDay,
              create_date: newDate.toDate(),
              create_date_num: newDate.unix(),
            });
          }
        }
        else {
          // มี energy
          // เอาไปใส่ mastering data check เพื่อให้เวลาหาเป็นช่วงเวลาจะได้รู้ว่า meter นี้มีค่ามาแล้ว
          if (reply?.data[i]?.meteringPointId) {
            const count = await this.prisma.metered_retrieving.count({
              where: { del_flag: true, type: 'mastering data check', metered_run_number_id: metered_run_number?.id, metering_point_sys: reply?.data[i]?.meteringPointId },
            })
            if (count == 0) {
              logsData.push({
                metered_run_number_id: metered_run_number?.id,
                temp: JSON.stringify(reply?.data[i]),
                type: 'mastering data check',
                description: `The point ${reply?.data[i]?.meteringPointId} already retrieved Metering data`,
                timestamp: newDate.toDate(),
                metering_point_sys: reply?.data[i]?.meteringPointId,
                gas_day: gasDay,
                del_flag: true,
                create_date: newDate.toDate(),
                create_date_num: newDate.unix(),
              });
            }

            if (!findMeterDam) {
              // มี energy แต่ ไม่มีใน DAM 
              logsData.push({
                metered_run_number_id: metered_run_number?.id,
                temp: JSON.stringify(reply?.data[i]),
                type: 'retrieving',
                description: `The point ${reply?.data[i]?.meteringPointId} does not exist in TPA system or is not valid`,
                timestamp: newDate.toDate(),
                metering_point_sys: reply?.data[i]?.meteringPointId,
                gas_day: gasDay,
                create_date: newDate.toDate(),
                create_date_num: newDate.unix(),
              });
            }
            // else{
            //   // มี energy และ มีใน DAM
            // }
          }
          else {
            // มี energy แต่ ไม่มี meteringPointId
            logsData.push({
              metered_run_number_id: metered_run_number?.id,
              temp: JSON.stringify(reply?.data[i]),
              type: 'retrieving',
              description: 'The mandatory field Metering Point ID must be informed',
              timestamp: newDate.toDate(),
              metering_point_sys: reply?.data[i]?.meteringPointId,
              gas_day: gasDay,
              create_date: newDate.toDate(),
              create_date_num: newDate.unix(),
            });
          }
        }
      }
      if (logsData.length > 0) {
        await this.prisma.metered_retrieving.createMany({
          data: logsData,
        });
      }
    }

    return reply;
  }
  // #endregion ปรับ mastering data check ไปเป็นถ้าไม่มีค่า energy เลยในช่วงเวลาที่เลือกถึงจะไปแสดงผลที่หน้าบ้าน
}
