import {
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import * as XLSX from 'xlsx-js-style';

import axios from 'axios';
import * as https from 'https';
import { MeteredMicroService } from 'src/grpc/metered-service.service';
import { ExportFilesService } from 'src/export-files/export-files.service';
import { MeteringManagementService } from 'src/metering-management/metering-management.service';
import { CapacityService } from 'src/capacity/capacity.service';
import { FileUploadService } from 'src/grpc/file-service.service';
import {
  getTodayEndAdd7,
  getTodayEndYYYYMMDDDfaultAdd7,
  getTodayNow,
  getTodayNowAdd7,
  getTodayNowDDMMYYYYAdd7,
  getTodayNowDDMMYYYYDfaultAdd7,
  getTodayNowYYYYMMDDDfaultAdd7,
  getTodayStartAdd7,
  getTodayStartYYYYMMDDDfaultAdd7,
  getWeekRange,
} from 'src/common/utils/date.util';
import {
  isMatch,
  extractAndGenerateDateArray,
  buildActiveDataForDates,
  validateContractAndShipper,
  validatePointByType,
  transformToShipperReportStructure,
} from 'src/common/utils/allcation.util';
import * as nodemailer from 'nodemailer';
import { Prisma } from '@prisma/client';
import { QualityEvaluationService } from 'src/quality-evaluation/quality-evaluation.service';
import { findMinMaxExeDate } from 'src/common/utils/balancing.util';
import { parseToNumber } from 'src/common/utils/number.util';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Bangkok');

const headAllo = ['Zone', 'Area', 'POINT_ID', 'Unit', 'Entry_Exit'];

@Injectable()
export class AllocationService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    // @Inject(CACHE_MANAGER) private cacheService: Cache,
    private readonly meteredMicroService: MeteredMicroService,
    private readonly meteringManagementService: MeteringManagementService,
    private readonly fileUploadService: FileUploadService,
    private readonly qualityEvaluationService: QualityEvaluationService,

    @Inject(forwardRef(() => ExportFilesService))
    private readonly exportFilesService: ExportFilesService,
  ) { }

  private safeParseJSON(data: any, defaultValue: any = null) {
    if (data === undefined || data === null) return defaultValue;
    try {
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
      console.error('JSON parse error:', e);
      return defaultValue;
    }
  }

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
      module: 'ALLOCATION',
      ...(!!reqUser?.user?.sub && {
        create_by_account: {
          connect: {
            id: Number(reqUser?.user?.sub), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
          },
        },
      }),
    };
    await this.prisma.history.create({
      data: usedData,
    });
    return true;
  }

  async evidenApiAllocationEod(payload: any, callback?: (total_record: number) => void) {
    const { start_date, end_date, skip, limit } = payload;

    const agent = new https.Agent({
      rejectUnauthorized: true,
    });

    const data = JSON.stringify({
      start_date: start_date,
      end_date: end_date,
      skip: Number(skip),
      limit: Number(limit),
    });

    const config = {
      method: `${process.env.METHOD_EVIDEN}`,
      maxBodyLength: Infinity,
      url: `${process.env.IP_EVIDEN}/allocation_eod`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: process.env.TOKEN_EVIDEN,
      },
      httpsAgent: agent,
      data: data,
    };
    try {
      const resEviden = await axios.request(config);

      let evidenData = [];
      if (resEviden?.status === 200 && !!resEviden?.data) {
        if (Array.isArray(resEviden.data) && resEviden.data.length > 0) {
          let total_record = undefined;
          resEviden?.data?.map((resEvidenData: any) => {
            if (
              resEvidenData?.data &&
              Array.isArray(resEvidenData.data) &&
              resEvidenData.data.length > 0
            ) {
              if (resEvidenData?.total_record) {
                if (total_record) {
                  total_record += resEvidenData?.total_record;
                } else {
                  total_record = resEvidenData?.total_record;
                }
              }
              evidenData.push(...resEvidenData.data);
            }
          });
          if (callback && total_record) {
            callback(total_record);
          }
        } else {
          if (callback && resEviden?.data?.total_record) {
            callback(resEviden.data.total_record);
          }
          evidenData = resEviden?.data?.data;
        }
      }

      return evidenData;
    } catch (error) {
      // Avoid logging full error objects that may contain sensitive data
      console.log('error during evidenApiAllocationEod');
      // return [];
      // เช็คว่ามี response หรือไม่
      if (error.response) {
        console.log('Eviden API Error Status:', error.response.status);
      } else {
        console.log('Eviden API Error');
      }

      // ไม่ให้แตก → return [] แทน
      return [];
    }
  }

  async evidenApiAllocationIntraday(payload: any, callback?: (total_record: number) => void) {
    const { gas_day, start_hour, end_hour, skip, limit } = payload;

    const agent = new https.Agent({
      rejectUnauthorized: true,
    });

    const data = JSON.stringify({
      gas_day: gas_day,
      start_hour: Number(start_hour),
      end_hour: Number(end_hour),
      skip: Number(skip),
      limit: Number(limit),
    });

    const config = {
      method: `${process.env.METHOD_EVIDEN}`,
      maxBodyLength: Infinity,
      url: `${process.env.IP_EVIDEN}/allocation_intraday`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: process.env.TOKEN_EVIDEN,
      },
      httpsAgent: agent,
      data: data,
    };

    try {
      const resEviden = await axios.request(config);

      let evidenData = [];
      if (resEviden?.status === 200 && !!resEviden?.data) {
        if (Array.isArray(resEviden.data) && resEviden.data.length > 0) {
          let total_record = undefined;
          resEviden?.data?.map((resEvidenData: any) => {
            if (
              resEvidenData?.data &&
              Array.isArray(resEvidenData.data) &&
              resEvidenData.data.length > 0
            ) {
              if (resEvidenData?.total_record) {
                if (total_record) {
                  total_record += resEvidenData?.total_record;
                } else {
                  total_record = resEvidenData?.total_record;
                }
              }
              evidenData.push(...resEvidenData.data);
            }
          });
          if (callback && total_record) {
            callback(total_record);
          }
        } else {
          if (callback && resEviden?.data?.total_record) {
            callback(resEviden.data.total_record);
          }
          evidenData = resEviden?.data?.data;
        }
      }

      return evidenData;
    } catch (error) {
      // เช็คว่ามี response หรือไม่
      console.log('Eviden API Error:', error.message);

      // ไม่ให้แตก → return [] แทน
      return [];
    }
  }

  async evidenApiAllocationContractPoint(payload: any, callback?: (total_record: number) => void) {
    const { start_date, end_date, skip, limit } = payload;

    const agent = new https.Agent({
      rejectUnauthorized: true,
    });

    const data = JSON.stringify({
      start_date: start_date,
      end_date: end_date,
      skip: Number(skip),
      limit: Number(limit),
    });

    const config = {
      method: `${process.env.METHOD_EVIDEN}`,
      maxBodyLength: Infinity,
      // 10.100.98.49
      url: `${process.env.IP_EVIDEN}/allocation_allocation_report_by_contract_point`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: process.env.TOKEN_EVIDEN,
      },
      httpsAgent: agent,
      data: data,
    };

    try {
      const resEviden = await axios.request(config);

      let evidenData = [];
      if (resEviden?.status === 200 && !!resEviden?.data) {
        if (Array.isArray(resEviden.data) && resEviden.data.length > 0) {
          let total_record = undefined;
          resEviden?.data?.map((resEvidenData: any) => {
            if (resEvidenData?.total_record) {
              try {
                const totalRecord = Number(resEvidenData?.total_record);
                if (!Number.isNaN(totalRecord)) {
                  if (total_record) {
                    total_record += totalRecord;
                  } else {
                    total_record = totalRecord;
                  }
                }
              } catch (error) {
                if (total_record) {
                  total_record += 0;
                }
              }
            }
            if (
              resEvidenData?.data &&
              Array.isArray(resEvidenData.data) &&
              resEvidenData.data.length > 0
            ) {
              evidenData.push(...resEvidenData.data);
            }
          });
          if (callback && total_record) {
            callback(total_record);
          }
        } else {
          if (callback && resEviden?.data?.total_record) {
            callback(resEviden.data.total_record);
          }
          evidenData = resEviden?.data?.data;
        }
      }

      return evidenData;
    } catch (error) {
      console.log('Eviden API Error:', error.message);

      // ไม่ให้แตก → return [] แทน
      return [];
    }
  }

  async evidenApiAllocationContractPointIntraday(payload: any, callback?: (total_record: number) => void) {
    const { start_date, end_date, skip, limit } = payload;

    const agent = new https.Agent({
      rejectUnauthorized: true,
    });

    const data = JSON.stringify({
      start_date: start_date,
      end_date: end_date,
      start_hour: 1,
      end_hour: 24,
      skip: Number(skip),
      limit: Number(limit),
    });

    console.log('----');
    const config = {
      method: `${process.env.METHOD_EVIDEN}`,
      maxBodyLength: Infinity,
      url: `${process.env.IP_EVIDEN}/allocation_allocation_report_intraday_by_contract_point`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: process.env.TOKEN_EVIDEN,
      },
      httpsAgent: agent,
      data: data,
    };

    try {
      const resEviden = await axios.request(config);

      let evidenData = [];
      if (resEviden?.status === 200 && !!resEviden?.data) {
        if (Array.isArray(resEviden.data) && resEviden.data.length > 0) {
          let total_record = undefined;
          resEviden?.data?.map((resEvidenData: any) => {
            if (resEvidenData?.total_record) {
              try {
                const totalRecord = Number(resEvidenData?.total_record);
                if (!Number.isNaN(totalRecord)) {
                  if (total_record) {
                    total_record += totalRecord;
                  } else {
                    total_record = totalRecord;
                  }
                }
              } catch (error) {
                if (total_record) {
                  total_record += 0;
                }
              }
            }
            if (
              resEvidenData?.data &&
              Array.isArray(resEvidenData.data) &&
              resEvidenData.data.length > 0
            ) {
              evidenData.push(...resEvidenData.data);
            }
          });
          if (callback && total_record) {
            callback(total_record);
          }
        } else {
          if (callback && resEviden?.data?.total_record) {
            callback(resEviden.data.total_record);
          }
          evidenData = resEviden?.data?.data;
        }
      }

      return evidenData;
    } catch (error) {
      console.log('Eviden API Error:', error.message);

      // ไม่ให้แตก → return [] แทน
      return [];
    }
  }

  async evidenApiAllocationContractPointByNom(payload: any, callback?: (total_record: number) => void) {
    const { start_date, end_date, skip, limit } = payload;

    const agent = new https.Agent({
      rejectUnauthorized: true,
    });

    const data = JSON.stringify({
      start_date: start_date,
      end_date: end_date,
      skip: Number(skip),
      limit: Number(limit),
    });

    const config = {
      method: `${process.env.METHOD_EVIDEN}`,
      maxBodyLength: Infinity,
      // 10.100.98.49
      url: `${process.env.IP_EVIDEN}/allocation_allocation_report_by_nomination_point`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: process.env.TOKEN_EVIDEN,
      },
      httpsAgent: agent,
      data: data,
    };

    try {
      const resEviden = await axios.request(config);

      let evidenData = [];
      if (resEviden?.status === 200 && !!resEviden?.data) {
        if (Array.isArray(resEviden.data) && resEviden.data.length > 0) {
          let total_record = undefined;
          resEviden?.data?.map((resEvidenData: any) => {
            if (resEvidenData?.total_record) {
              try {
                const totalRecord = Number(resEvidenData?.total_record);
                if (!Number.isNaN(totalRecord)) {
                  if (total_record) {
                    total_record += totalRecord;
                  } else {
                    total_record = totalRecord;
                  }
                }
              } catch (error) {
                if (total_record) {
                  total_record += 0;
                }
              }
            }
            if (
              resEvidenData?.data &&
              Array.isArray(resEvidenData.data) &&
              resEvidenData.data.length > 0
            ) {
              evidenData.push(...resEvidenData.data);
            }
          });
          if (callback && total_record) {
            callback(total_record);
          }
        } else {
          if (callback && resEviden?.data?.total_record) {
            callback(resEviden.data.total_record);
          }
          evidenData = resEviden?.data?.data;
        }
      }

      return evidenData;
    } catch (error) {
      console.log('Eviden API Error:', error.message);

      // ไม่ให้แตก → return [] แทน
      return [];
    }
  }

  async evidenApiAllocationContractPointIntradayByNom(payload: any, callback?: (total_record: number) => void) {
    const { start_date, end_date, skip, limit } = payload;

    const agent = new https.Agent({
      rejectUnauthorized: true,
    });

    const data = JSON.stringify({
      start_date: start_date,
      end_date: end_date,
      start_hour: 1,
      end_hour: 24,
      skip: Number(skip),
      //part 1 = 0, part 2 = 100, part 3 = 200, part 4 = 300, part 5 = 400, part 6 = 500, part 7 = 600, part 8 = 700
      limit: Number(limit),
    });

    const config = {
      method: `${process.env.METHOD_EVIDEN}`,
      maxBodyLength: Infinity,
      url: `${process.env.IP_EVIDEN}/allocation_allocation_report_intraday_by_nomination_point`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: process.env.TOKEN_EVIDEN,
      },
      httpsAgent: agent,
      data: data,
    };

    try {
      const resEviden = await axios.request(config);

      let evidenData = [];
      if (resEviden?.status === 200 && !!resEviden?.data) {
        if (Array.isArray(resEviden.data) && resEviden.data.length > 0) {
          let total_record = undefined;
          resEviden?.data?.map((resEvidenData: any) => {
            if (resEvidenData?.total_record) {
              try {
                const totalRecord = Number(resEvidenData?.total_record);
                if (!Number.isNaN(totalRecord)) {
                  if (total_record) {
                    total_record += totalRecord;
                  } else {
                    total_record = totalRecord;
                  }
                }
              } catch (error) {
                if (total_record) {
                  total_record += 0;
                }
              }
            }
            if (
              resEvidenData?.data &&
              Array.isArray(resEvidenData.data) &&
              resEvidenData.data.length > 0
            ) {
              evidenData.push(...resEvidenData.data);
            }
          })
          if (callback && total_record) {
            callback(total_record);
          }
        }
        else {
          if (callback && resEviden?.data?.total_record) {
            callback(resEviden.data.total_record);
          }
          evidenData = resEviden?.data?.data;
        }
      }

      return evidenData;
    } catch (error) {
      // เช็คว่ามี response หรือไม่
      console.log('Eviden API Error:', error.message);

      // ไม่ให้แตก → return [] แทน
      return [];
    }
  }

  async allocationStatusMaster() {
    return this.prisma.allocation_status.findMany({
      orderBy: { id: 'asc' },
    });
  }

  async allocationManagement(payload: any, userId: any) {
    const { start_date, end_date, skip, limit } = payload;

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

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

    const groupMaster = await this.prisma.group.findMany({
      where: {
        user_type_id: 3,
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

    const meterMaster = await this.prisma.metering_point.findMany({
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
        nomination_point: true,
      },
    });


    const nominationFile =
      await this.prisma.query_shipper_nomination_file.findMany({
        where: {
          query_shipper_nomination_status: {
            id: {
              in: [2, 5],
            },
          },
        },
        include: {
          contract_code: true,
          group: true,
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
      });

    const convertNomFile = (nominationFile || []).map((e: any) => {
      // nomination_type_id 1 daily, 2 weekly
      e['gas_day'] = dayjs(e['gas_day']).format('YYYY-MM-DD');
      e['nomination_version'] = (e['nomination_version'] || []).map((nv: any) => {
        nv['nomination_full_json'] = nv['nomination_full_json'].map(
          (nj: any) => {
            nj['data_temp'] = this.safeParseJSON(nj['data_temp']);
            return { ...nj };
          },
        );
        nv['nomination_row_json'] = nv['nomination_row_json'].map((nj: any) => {
          nj['data_temp'] = this.safeParseJSON(nj['data_temp']);
          return { ...nj };
        });
        return { ...nv };
      });
      const fullData = e['nomination_version'][0]?.['nomination_full_json'][0];
      const rowData = e['nomination_version'][0]?.['nomination_row_json'];
      delete e['nomination_version'];
      return { ...e, fullData, rowData };
    });

    const evidenApiAllocationEod = await this.evidenApiAllocationEod({
      start_date,
      end_date,
      skip,
      limit,
    });

    const start = start_date ? getTodayStartAdd7(start_date) : null;
    const end = end_date ? getTodayEndAdd7(end_date) : null;

    if (!start || !end || !start.isValid() || !end.isValid()) {
      throw new Error('⛔ Invalid date format');
    }

    if (end.isBefore(start)) {
      throw new Error('⛔ End date must be after or equal to start date');
    }

    const dateArray: string[] = [];

    let current = start;

    while (current.isSameOrBefore(end)) {
      dateArray.push(current.format('YYYY-MM-DD'));
      current = current.add(1, 'day');
    }

    const intradayEviden = [];

    // List รายการที่ต้องกลับมาแก้ mock ต้องปิด
    const evidenApiAllocationIntraday = await this.evidenApiAllocationIntraday({
      //test
      gas_day: '2025-02-28',
      start_hour: 1,
      end_hour: 24,
      skip: 0,
      limit: 100,
    });
    for (let i = 0; i < dateArray.length; i++) {
      try {
        // List รายการที่ต้องกลับมาแก้ ของจริงต้องเปิด
        // const evidenApiAllocationIntraday = await this.evidenApiAllocationIntraday({
        //   gas_day: dateArray[i],
        //   start_hour: 1,
        //   end_hour: 24,
        //   skip: 0,
        //   limit: 100,
        // });
        intradayEviden.push({
          gasday: dateArray[i],
          data: evidenApiAllocationIntraday,
        });
      } catch (error) {
        intradayEviden.push({
          gasday: dateArray[i],
          data: [],
        });
      }
    }

    const nomExtPoint = convertNomFile.flatMap((e: any) => {
      const pointType1 = e['rowData'].filter((f: any) => {
        return (
          f?.query_shipper_nomination_type_id === 1 &&
          f?.data_temp['9'] === 'MMBTU/D'
        );
      });
      const point = pointType1.map((pt: any) => {
        const { rowData, ...nE } = e;
        return { ...nE, point: { ...pt } };
      });
      return point;
    });
    const findGasday = nomExtPoint.filter((f: any) => {
      return (evidenApiAllocationEod || [])
        .map((e: any) => e?.gas_day)
        .includes(f?.gas_day);
    });
    const findGasdayAddEviden = findGasday.map((e: any) => {
      const eviden_data_gas_day = evidenApiAllocationEod.filter(
        (f: any) => f?.gas_day === e?.gas_day,
      );
      // headData

      let evidenUse = null;
      let use = 0;
      for (let iEviden = 0; iEviden < eviden_data_gas_day.length; iEviden++) {
        for (
          let iEvidenData = 0;
          iEvidenData < eviden_data_gas_day[iEviden]?.data.length;
          iEvidenData++
        ) {
          if (
            eviden_data_gas_day[iEviden]?.data[iEvidenData]?.contract ===
            e?.contract_code?.contract_code &&
            eviden_data_gas_day[iEviden]?.data[iEvidenData]?.shipper ===
            e?.group?.id_name
          ) {
            const point = eviden_data_gas_day[iEviden]?.data[
              iEvidenData
            ]?.data.find((f: any) => {
              return f?.['point'] === e['point']?.['data_temp']?.['3'];
            });
            if (point) {
              if (
                point?.['area'] === e['point']?.['data_temp']?.['2'] &&
                point?.['zone'] === e['point']?.['data_temp']?.['0'] &&
                point?.['entry_exit'].toUpperCase() ===
                e['point']?.['data_temp']?.['10'].toUpperCase()
              ) {
                //
                if (use <= eviden_data_gas_day[iEviden]?.request_number) {
                  use = eviden_data_gas_day[iEviden]?.request_number;
                  evidenUse = {
                    request_number:
                      eviden_data_gas_day[iEviden]?.request_number,
                    execute_timestamp:
                      eviden_data_gas_day[iEviden]?.execute_timestamp,
                    gas_day: eviden_data_gas_day[iEviden]?.gas_day,
                    data: point,
                    contract:
                      eviden_data_gas_day[iEviden]?.data[iEvidenData]?.contract,
                    shipper:
                      eviden_data_gas_day[iEviden]?.data[iEvidenData]?.shipper,
                  };
                }
              }
            }
            // const zone = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["zone"]
            // const area = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["area"]
            // const entry_exit = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["entry_exit"]
            // * const customer_type = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["customer_type"]
            // * const point_type = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["point_type"]
            // * const relation_point = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["relation_point"]
            // * const relation_point_type = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["relation_point_type"]
            // * const previous_value = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["previous_value"]
            // * const value = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["value"]

            // "data_temp": {
            //       "0": "WEST",
            //       "1": "Supply",
            //       "2": "Y",
            //       "3": "YDANA",
            //       "4": "",
            //       "5": "",
            //       "6": "Supply",
            //       "7": "",
            //       "8": "",
            //       "9": "MMBTU/D",
            //       "10": "Entry",
          }
        }
      }

      return { ...e, evidenUse };
    });

    const evidenUse = findGasdayAddEviden.filter((f: any) => !!f?.evidenUse);

    const ckEvidenUse = evidenUse.map((e: any) => {
      const nominationValue =
        e['nomination_type_id'] === 1
          ? e['point']['data_temp']['38']
          : e['point']['data_temp']['14']; // รอทำ weekly

      const systemAllocation = e['evidenUse']?.['data']?.['value'];
      const previousAllocationTPAforReview =
        e['evidenUse']?.['data']?.['previous_value'];

      // intradayEviden
      const intraFil =
        intradayEviden.find((f: any) => {
          return f?.gasday === e['gas_day'];
        })?.data || [];
      const intraFilValue = intraFil.filter((f: any) => {
        return f?.data?.filter((ff: any) => {
          return (
            ff?.contract === e['evidenUse']?.['contract'] &&
            ff?.shipper === e['evidenUse']?.['shipper'] &&
            ff?.data?.filter((fff: any) => {
              return fff?.point === e['evidenUse']?.['data']?.['point'];
            })
          );
        });
      });
      // const intraDay = intraFilValue[intraFilValue.length - 1] || null;
      // const { data: dataIntraDay = null, ...nIntraDay }: any = intraDay;
      const { data: dataIntraDay = null, ...nIntraDay } =
        intraFilValue.at(-1) ?? {};
      const intradayFind = dataIntraDay?.find((f: any) => {
        return (
          f?.contract === e['evidenUse']?.['contract'] &&
          f?.shipper === e['evidenUse']?.['shipper']
        );
      });
      const { data: dataIntradayFind, ...nIntradayFind } = intradayFind ?? {};
      const intradayData = dataIntradayFind?.find((f: any) => {
        return f?.point === e['evidenUse']?.['data']?.['point'];
      });
      const intradayUse = {
        ...nIntraDay,
        ...nIntradayFind,
        data: intradayData,
      };
      const intradaySystem = intradayUse?.data?.value || null; //----

      // meteringValue
      const meteringValue = null; //----
      const meterFil = meterMaster.filter((f: any) => {
        return (
          f?.nomination_point?.nomination_point ===
          e['evidenUse']?.['data']?.['point']
        );
      });
      const meterName = meterFil?.map((mF: any) => mF?.metered_point_name);

      // areaMaster
      const area_obj = areaMaster.find((f: any) => {
        return f?.name === e['evidenUse']?.['data']?.['area'];
      });
      const zone_obj = zoneMaster.find((f: any) => {
        return f?.name === e['evidenUse']?.['data']?.['zone'];
      });
      const entry_exit_obj = entryExitMaster.find((f: any) => {
        return (
          f?.name.toUpperCase() ===
          e['evidenUse']?.['data']?.['entry_exit'].toUpperCase()
        );
      });

      const checkDb = {
        gas_day_text: e['gas_day'], //
        shipper_name_text: e['evidenUse']?.['shipper'], //
        contract_code_text: e['evidenUse']?.['contract'], //
        point_text: e['evidenUse']?.['data']?.['point'], //
        entry_exit_text: e['evidenUse']?.['data']?.['entry_exit'], //
        area_text: e['evidenUse']?.['data']?.['area'],
        zone_text: e['evidenUse']?.['data']?.['zone'],
      };

      delete e['fullData']; //full json

      return {
        ...e,
        intradayUse,
        nominationValue,
        systemAllocation,
        intradaySystem,
        previousAllocationTPAforReview,
        meteringValue,
        checkDb,
        area_obj,
        zone_obj,
        entry_exit_obj,
        meterName,
      };
    });

    const newData = [];
    let meterArr = [];

    for (let i = 0; i < ckEvidenUse.length; i++) {
      const formateMeterG = ckEvidenUse[i]?.meterName?.map((e: any) => ({
        meterPointId: e,
        gasDay: ckEvidenUse[i]?.gas_day,
      }));
      meterArr = [...new Set([...meterArr, ...formateMeterG])];
    }
    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: 'get-last-once',
        mode: 'metering',
        meter_gas: meterArr,
      }),
    );
    const reply =
      (!!meteredMicroData?.reply && this.safeParseJSON(meteredMicroData?.reply)) ||
      null;

    let allocationMaster = await this.prisma.allocation_management.findMany({
      include: {
        allocation_management_comment: {
          include: {
            allocation_status: true,
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
          // orderBy: { id: "desc" }
        },
        allocation_management_shipper_review: {
          include: {},
          take: 1,
          orderBy: {
            id: 'desc',
          },
        },
        allocation_status: true,
      },
    });

    const newAllocation = [];

    for (let i = 0; i < ckEvidenUse.length; i++) {
      const findAllocationMaster = allocationMaster.find((f: any) => {
        return (
          f?.gas_day_text === ckEvidenUse[i]?.checkDb?.gas_day_text &&
          f?.shipper_name_text === ckEvidenUse[i]?.checkDb?.shipper_name_text &&
          f?.contract_code_text ===
          ckEvidenUse[i]?.checkDb?.contract_code_text &&
          f?.point_text === ckEvidenUse[i]?.checkDb?.point_text &&
          f?.entry_exit_text === ckEvidenUse[i]?.checkDb?.entry_exit_text &&
          f?.area_text === ckEvidenUse[i]?.checkDb?.area_text &&
          f?.zone_text === ckEvidenUse[i]?.checkDb?.zone_text
        );
      });

      if (!findAllocationMaster) {
        newAllocation.push({
          allocation_status_id: 1,
          shipper_name_text: ckEvidenUse[i]?.checkDb?.shipper_name_text,
          gas_day_text: ckEvidenUse[i]?.checkDb?.gas_day_text,
          contract_code_text: ckEvidenUse[i]?.checkDb?.contract_code_text,
          point_text: ckEvidenUse[i]?.checkDb?.point_text,
          entry_exit_text: ckEvidenUse[i]?.checkDb?.entry_exit_text,
          area_text: ckEvidenUse[i]?.checkDb?.area_text,
          zone_text: ckEvidenUse[i]?.checkDb?.zone_text,
          gas_day: getTodayNowYYYYMMDDDfaultAdd7(
            ckEvidenUse[i]?.checkDb?.gas_day_text + 'T00:00:00Z',
          ).toDate(),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by: Number(userId),
        });
      }
    }

    if (newAllocation.length > 0) {
      // create
      await this.prisma.allocation_management.createMany({
        data: newAllocation,
      });

      allocationMaster = await this.prisma.allocation_management.findMany({
        include: {
          allocation_management_comment: {
            include: {
              allocation_status: true,
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
            // orderBy: { id: "desc" }
          },
          allocation_management_shipper_review: {
            include: {},
            take: 1,
            orderBy: {
              id: 'desc',
            },
          },
          allocation_status: true,
        },
      });
    }


    for (let i = 0; i < ckEvidenUse.length; i++) {
      const formateMeterG = ckEvidenUse[i]?.meterName?.map((e: any) => ({
        meterPointId: e,
        gasDay: ckEvidenUse[i]?.gas_day,
      }));
      let matchMeter = 0;
      for (let iM = 0; iM < formateMeterG.length; iM++) {
        const matchM = reply?.filter((f: any) => {
          return (
            f?.gasDay === formateMeterG[iM]?.gasDay &&
            f?.meterPointId === formateMeterG[iM]?.meterPointId
          );
        });
        const matchValue = matchM
          ?.map((nM: any) => nM?.value?.energy)
          .reduce((total, num) => total + (num ?? 0), 0);
        matchMeter += matchValue;
      }
      ckEvidenUse[i].meteringValue = matchMeter;

      const findAllocationMaster = allocationMaster.find((f: any) => {
        return (
          f?.gas_day_text === ckEvidenUse[i]?.checkDb?.gas_day_text &&
          f?.shipper_name_text === ckEvidenUse[i]?.checkDb?.shipper_name_text &&
          f?.contract_code_text ===
          ckEvidenUse[i]?.checkDb?.contract_code_text &&
          f?.point_text === ckEvidenUse[i]?.checkDb?.point_text &&
          f?.entry_exit_text === ckEvidenUse[i]?.checkDb?.entry_exit_text &&
          f?.area_text === ckEvidenUse[i]?.checkDb?.area_text &&
          f?.zone_text === ckEvidenUse[i]?.checkDb?.zone_text
        );
      });
      if (findAllocationMaster) {
        // ckEvidenUse[i].nom_id = ckEvidenUse[i]?.id;
        ckEvidenUse[i].id = findAllocationMaster?.id;
        ckEvidenUse[i].allocation_status =
          findAllocationMaster?.allocation_status;
        ckEvidenUse[i].review_code = findAllocationMaster?.review_code;
        ckEvidenUse[i].allocation_management_comment =
          findAllocationMaster?.allocation_management_comment;
        ckEvidenUse[i].allocation_management_shipper_review =
          findAllocationMaster?.allocation_management_shipper_review;
        ckEvidenUse[i].point_text = findAllocationMaster?.point_text;
        ckEvidenUse[i].shipper_id_text =
          findAllocationMaster?.shipper_name_text;
        ckEvidenUse[i].contract_code_text =
          findAllocationMaster?.contract_code_text;
        ckEvidenUse[i].gas_day_text = findAllocationMaster?.gas_day_text;
        const finG = groupMaster.find((f: any) => {
          return f?.id_name === findAllocationMaster?.shipper_name_text;
        });
        ckEvidenUse[i].shipper_name_text = finG?.name;

        // group
        // id_name

        // name
      }

      const {
        nomination_code,
        create_date,
        update_date,
        create_date_num,
        update_date_num,
        create_by,
        update_by,
        nomination_type_id,
        query_shipper_nomination_status_id,
        contract_code_id,
        group_id,
        file_name,
        query_shipper_nomination_file_renom_id,
        submitted_timestamp,
        del_flag,
        group,
        contract_code,
        point,
        ...nckEvidenUse
      } = ckEvidenUse[i];

      newData.push(nckEvidenUse);
    }

    return newData;
  }

  async allocationManagementNewReview(payload: any, userId: any) {
    const { start_date, end_date, skip, limit } = payload;

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

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

    const groupMaster = await this.prisma.group.findMany({
      where: {
        user_type_id: 3,
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

    const meterMaster = await this.prisma.metering_point.findMany({
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
        nomination_point: true,
      },
    });

    // https://app.clickup.com/t/86eu48j4n
    const nominationFile =
      await this.prisma.query_shipper_nomination_file.findMany({
        where: {
          query_shipper_nomination_status: {
            id: {
              in: [2, 5],
            },
          },
        },
        include: {
          contract_code: true,
          group: true,
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
      });

    const convertNomFile = (nominationFile || []).map((e: any) => {
      // nomination_type_id 1 daily, 2 weekly
      e['gas_day'] = dayjs(e['gas_day']).format('YYYY-MM-DD');
      e['nomination_version'] = (e['nomination_version'] || []).map((nv: any) => {
        nv['nomination_full_json'] = nv['nomination_full_json'].map(
          (nj: any) => {
            nj['data_temp'] = this.safeParseJSON(nj['data_temp']);
            return { ...nj };
          },
        );
        nv['nomination_row_json'] = nv['nomination_row_json'].map((nj: any) => {
          nj['data_temp'] = this.safeParseJSON(nj['data_temp']);
          return { ...nj };
        });
        return { ...nv };
      });
      const fullData = e['nomination_version'][0]?.['nomination_full_json'][0];
      const rowData = e['nomination_version'][0]?.['nomination_row_json'];
      delete e['nomination_version'];
      return { ...e, fullData, rowData };
    });
    // log('-----start');
    const evidenApiAllocationEod = await this.evidenApiAllocationEod({
      start_date,
      end_date,
      skip,
      limit,
    });

    const start = start_date ? getTodayStartAdd7(start_date) : null;
    const end = end_date ? getTodayEndAdd7(end_date) : null;

    if (!start || !end || !start.isValid() || !end.isValid()) {
      throw new Error('⛔ Invalid date format');
    }

    if (end.isBefore(start)) {
      throw new Error('⛔ End date must be after or equal to start date');
    }

    const dateArray: string[] = [];

    let current = start;

    while (current.isSameOrBefore(end)) {
      dateArray.push(current.format('YYYY-MM-DD'));
      current = current.add(1, 'day');
    }

    const intradayEviden = [];
    // List รายการที่ต้องกลับมาแก้ mock ต้องปิด
    const evidenApiAllocationIntraday = await this.evidenApiAllocationIntraday({
      //test
      gas_day: '2025-02-28',
      start_hour: 1,
      end_hour: 24,
      skip: 0,
      limit: 100,
    });

    for (let i = 0; i < dateArray.length; i++) {
      try {
        // List รายการที่ต้องกลับมาแก้ ของจริงต้องเปิด
        // const evidenApiAllocationIntraday = await this.evidenApiAllocationIntraday({
        //   gas_day: dateArray[i],
        //   start_hour: 1,
        //   end_hour: 24,
        //   skip: 0,
        //   limit: 100,
        // });
        intradayEviden.push({
          gasday: dateArray[i],
          data: evidenApiAllocationIntraday,
        });
      } catch (error) {
        intradayEviden.push({
          gasday: dateArray[i],
          data: [],
        });
      }
    }

    const newEOD = evidenApiAllocationEod.flatMap((fm: any) => {
      const { data: data1, ...fmD } = fm;

      const nData = data1?.flatMap((dFm: any) => {
        const { data: data2, ...fmD2 } = dFm;
        const nData2 = data2.map((dFm2: any) => {
          return { ...fmD, ...fmD2, ...dFm2 };
        });

        return [...nData2];
      });

      return [...nData];
    });

    let allocationMaster = await this.prisma.allocation_management.findMany({
      include: {
        allocation_management_comment: {
          include: {
            allocation_status: true,
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
          // orderBy: { id: "desc" }
        },
        allocation_management_shipper_review: {
          include: {},
          take: 1,
          orderBy: {
            id: 'desc',
          },
        },
        allocation_status: true,
      },
    });

    const newAllocation = [];

    const resultEodLast: any = Object.values(
      newEOD.reduce((acc, curr) => {
        const key = `${curr.gas_day}|${curr.shipper}|${curr.contract}|${curr.point}|${curr.entry_exit}|${curr.area}|${curr.zone}`;
        if (!acc[key] || acc[key].execute_timestamp < curr.execute_timestamp) {
          acc[key] = curr;
        }
        return acc;
      }, {}),
    );

    for (let i = 0; i < resultEodLast.length; i++) {
      const findAllocationMaster = allocationMaster.find((f: any) => {
        return (
          f?.gas_day_text === resultEodLast[i]?.gas_day &&
          f?.shipper_name_text === resultEodLast[i]?.shipper &&
          f?.contract_code_text === resultEodLast[i]?.contract &&
          f?.point_text === resultEodLast[i]?.point &&
          f?.entry_exit_text === resultEodLast[i]?.entry_exit &&
          f?.area_text === resultEodLast[i]?.area &&
          f?.zone_text === resultEodLast[i]?.zone
        );
      });
      // X3
      // contract: 2025-CNF-002
      // ENTRY
      // gas_day: 2025-02-21
      // point_text: LMPT2
      // shipper: NGP-S01-002
      // EAST

      if (!findAllocationMaster) {
        newAllocation.push({
          allocation_status_id: 1,
          shipper_name_text: resultEodLast[i]?.shipper,
          gas_day_text: resultEodLast[i]?.gas_day,
          contract_code_text: resultEodLast[i]?.contract,
          point_text: resultEodLast[i]?.point,
          entry_exit_text: resultEodLast[i]?.entry_exit,
          area_text: resultEodLast[i]?.area,
          zone_text: resultEodLast[i]?.zone,
          gas_day: getTodayNowYYYYMMDDDfaultAdd7(
            resultEodLast[i]?.gas_day + 'T00:00:00Z',
          ).toDate(),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by: Number(userId),
        });
      }
    }

    if (newAllocation.length > 0) {
      // create
      await this.prisma.allocation_management.createMany({
        data: newAllocation,
      });

      allocationMaster = await this.prisma.allocation_management.findMany({
        include: {
          allocation_management_comment: {
            include: {
              allocation_status: true,
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
            // orderBy: { id: "desc" }
          },
          allocation_management_shipper_review: {
            include: {},
            take: 1,
            orderBy: {
              id: 'desc',
            },
          },
          allocation_status: true,
        },
      });
    }
    const nEodPorp = resultEodLast.map((eod: any) => {
      const alloc = convertNomFile?.find((f: any) => {
        return (
          f?.gas_day === eod['gas_day'] &&
          f?.group?.id_name === eod['shipper'] &&
          f?.contract_code?.contract_code === eod['contract']
        );
      });

      const pointN = alloc?.['rowData']?.find((f: any) => {
        return (
          f?.query_shipper_nomination_type_id === 1 &&
          f?.data_temp['9'] === 'MMBTU/D' &&
          f?.area_text === eod['area'] &&
          f?.zone_text === eod['zone']
        );
      });

      const nominationValue =
        (!!alloc &&
          !!pointN &&
          (alloc?.nomination_type_id === 1
            ? pointN['data_temp']['38']
            : pointN['data_temp']['14'])) ||
        null;

      const systemAllocation = eod['value'];
      const previousAllocationTPAforReview = eod['previous_value'];

      const intraFil =
        intradayEviden.find((f: any) => {
          return f?.gasday === eod['gas_day'];
        })?.data || [];
      const intraFilValue = intraFil.filter((f: any) => {
        return f?.data?.filter((ff: any) => {
          return (
            ff?.contract === eod['contract'] &&
            ff?.shipper === eod['shipper'] &&
            ff?.data?.filter((fff: any) => {
              return fff?.point === eod['data']?.['point'];
            })
          );
        });
      });
      const { data: dataIntraDay = null, ...nIntraDay } =
        intraFilValue.at(-1) ?? {};
      const intradayFind = dataIntraDay?.find((f: any) => {
        return f?.contract === eod['contract'] && f?.shipper === eod['shipper'];
      });
      const { data: dataIntradayFind, ...nIntradayFind } = intradayFind ?? {};
      const intradayData = dataIntradayFind?.find((f: any) => {
        return f?.point === eod['point'];
      });
      const intradayUse = {
        ...nIntraDay,
        ...nIntradayFind,
        data: intradayData,
      };
      const intradaySystem = intradayUse?.data?.value || null; //----

      const meterFil = meterMaster.filter((f: any) => {
        return f?.nomination_point?.nomination_point === eod['point'];
      });
      const meterName = [
        ...new Set([...meterFil?.map((mF: any) => mF?.metered_point_name)]),
      ];

      const area_obj = areaMaster.find((f: any) => {
        return f?.name === eod['area'];
      });
      const zone_obj = zoneMaster.find((f: any) => {
        return f?.name === eod['zone'];
      });
      const entry_exit_obj = entryExitMaster.find((f: any) => {
        return f?.name?.toUpperCase() === eod['entry_exit']?.toUpperCase();
      });

      return {
        ...eod,
        nominationValue,
        systemAllocation,
        previousAllocationTPAforReview,
        intradaySystem,
        // meteringValue,
        meterName,
        area_obj,
        zone_obj,
        entry_exit_obj,
      };
    });

    let meterArr = [];
    for (let i = 0; i < nEodPorp.length; i++) {
      if (nEodPorp[i]?.meterName.length > 0) {
        const formateMeterG = nEodPorp[i]?.meterName?.map((e: any) =>
          JSON.stringify({
            meterPointId: e,
            gasDay: nEodPorp[i]?.gas_day,
          }),
        );
        meterArr = [...new Set([...meterArr, ...formateMeterG])];
      }
    }
    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: 'get-last-once',
        mode: 'metering',
        meter_gas: meterArr?.map((es: any) => this.safeParseJSON(es)) || [],
      }),
    );

    const reply =
      (!!meteredMicroData?.reply && this.safeParseJSON(meteredMicroData?.reply)) ||
      null;

    const nEodPorpRes = [];
    for (let iMt = 0; iMt < nEodPorp.length; iMt++) {
      const formateMeterG = nEodPorp[iMt]['meterName'].map((e: any) => ({
        meterPointId: e,
        gasDay: nEodPorp[iMt]['gas_day'],
      }));

      let matchMeter = 0;

      for (let iM = 0; iM < formateMeterG.length; iM++) {
        const matchM = reply?.filter((f: any) => {
          return (
            f?.gasDay === formateMeterG[iM]?.gasDay &&
            f?.meterPointId === formateMeterG[iM]?.meterPointId
          );
        });
        const matchValue = matchM
          ?.map((nM: any) => nM?.value?.energy)
          .reduce((total, num) => total + (num ?? 0), 0);
        matchMeter += matchValue;
      }
      const meteringValue = matchMeter;

      const aMaster = allocationMaster.find((f: any) => {
        return (
          f?.gas_day_text === nEodPorp[iMt]?.gas_day &&
          f?.shipper_name_text === nEodPorp[iMt]?.shipper &&
          f?.contract_code_text === nEodPorp[iMt]?.contract &&
          f?.point_text === nEodPorp[iMt]?.point &&
          f?.entry_exit_text === nEodPorp[iMt]?.entry_exit &&
          f?.area_text === nEodPorp[iMt]?.area &&
          f?.zone_text === nEodPorp[iMt]?.zone
        );
      });

      const finG = groupMaster.find((f: any) => {
        return f?.id_name === nEodPorp[iMt]?.shipper;
      });

      nEodPorpRes.push({
        ...nEodPorp[iMt],
        id: aMaster?.['id'] || null,
        allocation_status: aMaster?.['allocation_status'] || null,
        review_code: aMaster?.['review_code'] || null,
        allocation_management_comment:
          aMaster?.['allocation_management_comment'] || [],
        allocation_management_shipper_review:
          aMaster?.['allocation_management_shipper_review'] || [],
        meteringValue,
        group: finG,
        // aMaster,
      });
    }

    return nEodPorpRes;
  }

  async allocationManagementNew(payload: any, userId: any) {
    const { start_date, end_date, skip, limit } = payload;

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const startDate = getTodayStartAdd7(start_date == 'undefined' ? undefined : start_date);
    const endDate = getTodayEndAdd7(end_date == 'undefined' ? undefined : end_date);

    const executeEodList = await this.prisma.execute_eod.findMany({
      where: {
        status: {
          equals: 'OK',
          mode: 'insensitive',
        },
        start_date_date: {
          lte: endDate.toDate(),
        },
        end_date_date: {
          gte: startDate.toDate(),
        }
      }
    })

    const executeIntradayList = await this.prisma.execute_intraday.findMany({
      where: {
        status: {
          equals: 'OK',
          mode: 'insensitive',
        },
        gas_day_date: {
          gte: startDate.toDate(),
          lte: endDate.toDate()
        }
      }
    })

    const publicationCenterDeletedList = await this.prisma.publication_center.findMany({
      where: {
        AND: [
          {
            gas_day: {
              gte: startDate.toDate(),
            }
          },
          {
            gas_day: {
              lte: endDate.toDate(),
            }
          },
          {
            del_flag: true,
          }
        ]
      },
    })

    const entryExitMaster = await this.prisma.entry_exit.findMany({
      where: {},
    });

    const meterMaster = await this.prisma.metering_point.findMany({
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
        nomination_point: true,
      },
    });

    // https://app.clickup.com/t/86eu49dch
    const nominationFile =
      await this.prisma.query_shipper_nomination_file.findMany({
        where: {
          query_shipper_nomination_status: {
            id: {
              in: [2, 5],
            },
          },
          OR: [
            // Daily nominations: exact date match
            {
              nomination_type: {
                id: 1,
              },
              gas_day: {
                gte: startDate.toDate(),
                lte: endDate.toDate(),
              },
            },
            // Weekly nominations: same week
            {
              nomination_type: {
                id: 2,
              },
              gas_day: {
                gte: startDate.startOf('week').toDate(),
                lte: endDate.endOf('week').toDate(),
              },
            },
          ],
        },
        include: {
          contract_code: true,
          group: true,
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
      });

    const convertNomFile = (nominationFile || []).map((e: any) => {
      // nomination_type_id 1 daily, 2 weekly
      e['gas_day'] = dayjs(e['gas_day']).format('YYYY-MM-DD');
      e['nomination_version'] = (e['nomination_version'] || []).map((nv: any) => {
        nv['nomination_full_json'] = nv['nomination_full_json'].map(
          (nj: any) => {
            nj['data_temp'] = this.safeParseJSON(nj['data_temp']);
            return { ...nj };
          },
        );
        nv['nomination_row_json'] = nv['nomination_row_json'].map((nj: any) => {
          nj['data_temp'] = this.safeParseJSON(nj['data_temp']);
          return { ...nj };
        });
        return { ...nv };
      });
      const fullData = e['nomination_version'][0]?.['nomination_full_json'][0];
      const rowData = e['nomination_version'][0]?.['nomination_row_json'];
      delete e['nomination_version'];
      return { ...e, fullData, rowData };
    });
    // console.log('---s--');
    const { minDate, maxDate } = await findMinMaxExeDate(this.prisma, start_date, end_date);

    // console.log('eviden minDate : ', minDate);
    // console.log('eviden maxDate : ', maxDate);
    let totalRecord: number | undefined = undefined;
    minDate && await this.evidenApiAllocationEod({
      start_date: minDate.format("YYYY-MM-DD"),
      end_date: maxDate.format("YYYY-MM-DD"),
      skip: 0,
      limit: 1,
    }, (total_record: number) => {
      totalRecord = total_record;
    });
    const evidenApiAllocationEod = minDate && await this.evidenApiAllocationEod({
      start_date: minDate.format("YYYY-MM-DD"),
      end_date: maxDate.format("YYYY-MM-DD"),
      skip: totalRecord ? 0 : skip,
      limit: totalRecord ? totalRecord : limit,
    }) || [];

    const matchWithExecuteList = evidenApiAllocationEod.filter((item: any) => {
      const itemGasDay = getTodayNowYYYYMMDDDfaultAdd7(item.gas_day);
      return executeEodList?.some((executeData: any) => {
        const executeStart = executeData?.start_date_date ? getTodayNowAdd7(executeData.start_date_date) : null;
        const executeEnd = executeData?.end_date_date ? getTodayNowAdd7(executeData.end_date_date) : null;
        return executeData.request_number_id == item.request_number &&
          executeStart && executeEnd &&
          executeStart.isSameOrBefore(itemGasDay, 'day') &&
          executeEnd.isSameOrAfter(itemGasDay, 'day')
      })
    })

    const publishData = matchWithExecuteList.filter((evidenData: any) => {
      return !publicationCenterDeletedList?.some((unpublishData: any) => {
        return (
          unpublishData?.execute_timestamp === evidenData.execute_timestamp &&
          unpublishData?.gas_day_text === evidenData.gas_day
        );
      })
    })

    // Get the latest execute_timestamp for each unique combination of gas_day
    const latestPublishData = publishData.reduce((acc: any[], current: any) => {
      const existingIndex = acc.findIndex(item =>
        item.gas_day === current.gas_day
      );

      if (existingIndex < 0) {
        acc.push(current);
      } else if (current.execute_timestamp > acc[existingIndex].execute_timestamp) {
        acc[existingIndex] = current;
      }

      return acc;
    }, []);

    // console.log('---e--');
    const dateArray = extractAndGenerateDateArray(latestPublishData);

    // Build active data for all dates
    const activeData = await buildActiveDataForDates(
      dateArray,
      this.prisma
    );

    // Filter based on active records
    const newEOD = latestPublishData.flatMap((fm: any) => {
      const { data: data1, ...fmD } = fm;

      // Find active data for this gas_day
      const activeDataForDate = activeData.find((ad) => ad.date === fm.gas_day);

      const nData = data1?.flatMap((dFm: any) => {
        const { data: data2, ...fmD2 } = dFm;

        // Validate contract and shipper existence
        const contractValidation = validateContractAndShipper(dFm, activeDataForDate);
        // if (!contractValidation.isValid) {
        //   return [];
        // }

        const nData2 = data2
          // .filter((dFm2: any) => {
          //   return validatePointByType(dFm2, activeDataForDate);
          // })
          .map((dFm2: any) => {
            validatePointByType(dFm2, activeDataForDate);
            return { ...fmD, ...fmD2, ...dFm2, group: contractValidation.shipperObj };
          });

        return [...nData2];
      });

      return [...nData];
    });

    // Generate dateArrayForIntraday based on actual gas_day values from newEOD
    const dateArrayForIntraday: string[] = [];

    if (newEOD && newEOD.length > 0) {
      // Extract all unique gas_day values and convert to dayjs objects for proper date comparison
      const gasDays = [...new Set(newEOD.map((item: any) => item.gas_day))];

      if (gasDays.length > 0) {
        // Convert to dayjs objects for proper date comparison
        const gasDayObjects = gasDays.map((date) => getTodayStartAdd7(date));

        // Find min and max gas_day using dayjs comparison
        const minGasDayObj = gasDayObjects.reduce((min, current) =>
          current.isBefore(min) ? current : min,
        );
        const maxGasDayObj = gasDayObjects.reduce((max, current) =>
          current.isAfter(max) ? current : max,
        );

        if (minGasDayObj.isValid() && maxGasDayObj.isValid()) {
          let current = minGasDayObj;

          while (current.isSameOrBefore(maxGasDayObj)) {
            dateArrayForIntraday.push(current.format('YYYY-MM-DD'));
            current = current.add(1, 'day');
          }
        }
      }
    }

    const intradayEviden = (
      await Promise.all(
        dateArrayForIntraday.map(async (date) => {
          try {
            const evidenApiAllocationIntraday =
              await this.evidenApiAllocationIntraday({
                gas_day: date,
                start_hour: 1,
                end_hour: 24,
                skip: skip,
                limit: limit,
              });
            return evidenApiAllocationIntraday;
          } catch (error) {
            return [];
          }
        }),
      )
    ).flat();

    const matchWithExecuteIntradayList = intradayEviden.filter((item: any) => {
      const itemGasDay = getTodayNowYYYYMMDDDfaultAdd7(item.gas_day);
      return executeIntradayList?.some((executeData: any) => {
        const executeGasDay = getTodayNowAdd7(executeData.gas_day);
        return executeData.request_number_id == item.request_number &&
          executeData.gas_hour == item.gas_hour &&
          executeGasDay.isSame(itemGasDay, 'day')
      })
    })

    const publishIntradayData = matchWithExecuteIntradayList.filter((evidenData: any) => {
      return !publicationCenterDeletedList?.some((unpublishData: any) => {
        return (
          unpublishData?.execute_timestamp === evidenData.execute_timestamp &&
          unpublishData?.gas_day_text === evidenData.gas_day &&
          (unpublishData?.gas_hour === evidenData?.gas_hour)
        );
      })
    })

    // Get the latest execute_timestamp for each unique combination of gas_day
    const latestPublishIntradayData = publishIntradayData.reduce((acc: any[], current: any) => {
      const existingIndex = acc.findIndex(item =>
        item.gas_day === current.gas_day
      );

      if (existingIndex < 0) {
        acc.push(current);
      } else if (current.gas_hour > acc[existingIndex].gas_hour) {
        acc[existingIndex] = current;
      }
      else if (current.gas_hour == acc[existingIndex].gas_hour && current.execute_timestamp > acc[existingIndex].execute_timestamp) {
        acc[existingIndex] = current;
      }

      return acc;
    }, []);

    let allocationMaster = await this.prisma.allocation_management.findMany({
      include: {
        allocation_management_comment: {
          include: {
            allocation_status: true,
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
          // orderBy: { id: "desc" }
        },
        allocation_management_shipper_review: {
          include: {},
          take: 1,
          orderBy: {
            id: 'desc',
          },
        },
        allocation_status: true,
      },
    });

    const newAllocation = [];
    const resultEodLast: any = Object.values(
      newEOD.reduce((acc, curr) => {
        const key = `${curr.gas_day}|${curr.shipper}|${curr.contract}|${curr.point}|${curr.entry_exit}|${curr.area}|${curr.zone}`;
        if (!acc[key] || acc[key].execute_timestamp < curr.execute_timestamp) {
          acc[key] = curr;
        }
        return acc;
      }, {}),
    );

    for (let i = 0; i < resultEodLast.length; i++) {
      const findAllocationMaster = allocationMaster.find((f: any) => {
        return (
          f?.gas_day_text === resultEodLast[i]?.gas_day &&
          f?.shipper_name_text === resultEodLast[i]?.shipper &&
          f?.contract_code_text === resultEodLast[i]?.contract &&
          f?.point_text === resultEodLast[i]?.point &&
          f?.entry_exit_text === resultEodLast[i]?.entry_exit &&
          f?.area_text === resultEodLast[i]?.area &&
          f?.zone_text === resultEodLast[i]?.zone
        );
      });
      // X3
      // contract: 2025-CNF-002
      // ENTRY
      // gas_day: 2025-02-21
      // point_text: LMPT2
      // shipper: NGP-S01-002
      // EAST

      if (!findAllocationMaster) {
        newAllocation.push({
          allocation_status_id: 1,
          shipper_name_text: resultEodLast[i]?.shipper,
          gas_day_text: resultEodLast[i]?.gas_day,
          contract_code_text: resultEodLast[i]?.contract,
          point_text: resultEodLast[i]?.point,
          entry_exit_text: resultEodLast[i]?.entry_exit,
          area_text: resultEodLast[i]?.area,
          zone_text: resultEodLast[i]?.zone,
          gas_day: getTodayNowYYYYMMDDDfaultAdd7(
            resultEodLast[i]?.gas_day + 'T00:00:00Z',
          ).toDate(),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by: Number(userId),
        });
      }
    }

    if (newAllocation.length > 0) {
      // create
      await this.prisma.allocation_management.createMany({
        data: newAllocation,
      });

      allocationMaster = await this.prisma.allocation_management.findMany({
        include: {
          allocation_management_comment: {
            include: {
              allocation_status: true,
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
            // orderBy: { id: "desc" }
          },
          allocation_management_shipper_review: {
            include: {},
            take: 1,
            orderBy: {
              id: 'desc',
            },
          },
          allocation_status: true,
        },
      });
    }

    const nEodPorp = resultEodLast.map((eod: any) => {
      const alloc = convertNomFile?.find((f: any) => {
        return (
          f?.gas_day === eod['gas_day'] &&
          f?.group?.id_name === eod['shipper'] &&
          f?.contract_code?.contract_code === eod['contract']
        );
      });

      const pointN = alloc?.['rowData']?.find((f: any) => {
        return (
          f?.query_shipper_nomination_type_id === 1 &&
          f?.data_temp['3'] === eod['point'] &&
          f?.data_temp['9'] === 'MMBTU/D' &&
          f?.area_text === eod['area'] &&
          f?.zone_text === eod['zone']
        );
      });

      let nominationValue = null
      if (alloc?.nomination_type_id && pointN) {
        if (alloc?.nomination_type_id === 1) {
          nominationValue = pointN['data_temp']['38']
        } else {
          const dayOfWeek = Number(getTodayStartAdd7(eod['gas_day']).format('d')) // The day of the week, with Sunday as 0
          nominationValue = pointN['data_temp'][`${14 + dayOfWeek}`]
        }
      }

      const systemAllocation = eod['value'];
      const previousAllocationTPAforReview = eod['previous_value'];

      const intradayDataByGasDay = latestPublishIntradayData.find((f: any) => {
        return (f?.gasday ?? f.gas_day) === eod['gas_day'];
      });
      const { data: intraFil = [], ...intradayByGasDay } = intradayDataByGasDay ?? {};

      const intraFilValue = intraFil
        .filter((f: any) =>
          f?.data?.some((ff: any) => ff?.point === eod?.['point']) &&
          f?.contract === eod['contract'] &&
          f?.shipper === eod['shipper']
        )
        .map((f: any) => {
          const data = f?.data?.find((ff: any) => {
            return ff?.point === eod?.['point'] &&
              ff?.point_type === eod?.point_type &&
              ff?.area === eod?.area &&
              ff?.zone === eod?.zone &&
              ff?.entry_exit === eod?.entry_exit
          }) ?? []
          return { ...f, data: data }
        });
      const { data: dataIntraDay = null, ...nIntraDay } =
        intraFilValue.at(-1) ?? {};

      const intradayUse = {
        ...nIntraDay,
        ...intradayByGasDay,
        data: dataIntraDay
      };
      const intradaySystem = intradayUse?.data?.value

      // Find active data for this gas_day
      const activeDataForDate = activeData.find((ad) => ad.date === eod['gas_day']);
      let meterName: string[] = [];
      if (activeDataForDate?.activeMeteringPoints && isMatch(eod['point_type'], 'NOM')) {
        meterName = activeDataForDate.activeMeteringPoints?.filter((meteringPoint: any) => isMatch(meteringPoint.nomination_point?.nomination_point, eod['point'])).map((meteringPoint: any) => meteringPoint.metered_point_name);
      }
      else if (activeDataForDate?.activeConceptPoints && isMatch(eod['point_type'], 'CONCEPT')) {
        meterName = activeDataForDate.activeConceptPoints?.filter((conceptPoint: any) => (conceptPoint.type_concept_point?.name?.toUpperCase()?.includes('METERING') && isMatch(conceptPoint.concept_point, eod['point']))).map((conceptPoint: any) => conceptPoint.concept_point);
      }
      else {
        const meterFil = meterMaster.filter((f: any) => {
          return f?.nomination_point?.nomination_point === eod['point'];
        });
        meterName = [
          ...new Set([...meterFil?.map((mF: any) => mF?.metered_point_name)]),
        ];
      }

      const entry_exit_obj = entryExitMaster.find((f: any) => {
        return isMatch(f?.name, eod['entry_exit']);
      });

      return {
        ...eod,
        nominationValue,
        systemAllocation,
        previousAllocationTPAforReview,
        intradaySystem,
        // meteringValue,
        meterName,
        entry_exit_obj
      };
    });
    let meterArr = [];
    for (let i = 0; i < nEodPorp.length; i++) {
      if (nEodPorp[i]?.meterName.length > 0) {
        const formateMeterG = nEodPorp[i]?.meterName?.map((e: any) =>
          JSON.stringify({
            meterPointId: e,
            gasDay: nEodPorp[i]?.gas_day,
          }),
        );
        meterArr = [...new Set([...meterArr, ...formateMeterG])];
      }
    }
    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: 'get-last-once',
        mode: 'metering',
        meter_gas: meterArr?.map((es: any) => this.safeParseJSON(es)) || [],
      }),
      {
        activeData,
        prisma: this.prisma
      }
    );

    let reply =
      (!!meteredMicroData?.reply && this.safeParseJSON(meteredMicroData?.reply)) ||
      null;
    if (!Array.isArray(reply)) {
      reply = null
    }
    // console.log('reply : ', reply);

    const nEodPorpRes = [];
    for (let iMt = 0; iMt < nEodPorp.length; iMt++) {
      const formateMeterG = nEodPorp[iMt]['meterName'].map((e: any) => ({
        meterPointId: e,
        gasDay: nEodPorp[iMt]['gas_day'],
      }));

      let matchMeter = 0;

      for (let iM = 0; iM < formateMeterG.length; iM++) {
        const matchM = reply?.filter((f: any) => {
          return (
            f?.gasDay === formateMeterG[iM]?.gasDay &&
            f?.meterPointId === formateMeterG[iM]?.meterPointId
          );
        });
        const matchValue = matchM
          ?.map((nM: any) => parseToNumber(nM?.value?.energy))
          .reduce((total, num) => total + (num ?? 0), 0);
        matchMeter += matchValue;
      }
      const meteringValue = matchMeter;

      const aMaster = allocationMaster.find((f: any) => {
        return (
          f?.gas_day_text === nEodPorp[iMt]?.gas_day &&
          f?.shipper_name_text === nEodPorp[iMt]?.shipper &&
          f?.contract_code_text === nEodPorp[iMt]?.contract &&
          f?.point_text === nEodPorp[iMt]?.point &&
          f?.entry_exit_text === nEodPorp[iMt]?.entry_exit &&
          f?.area_text === nEodPorp[iMt]?.area &&
          f?.zone_text === nEodPorp[iMt]?.zone
        );
      });


      nEodPorpRes.push({
        ...nEodPorp[iMt],
        id: aMaster?.['id'] || null,
        allocation_status: aMaster?.['allocation_status'] || null,
        review_code: aMaster?.['review_code'] || null,
        allocation_management_comment:
          aMaster?.['allocation_management_comment'] || [],
        allocation_management_shipper_review:
          aMaster?.['allocation_management_shipper_review'] || [],
        meteringValue,
        // aMaster,
      });
    }

    return nEodPorpRes;
  }
  // nominationValue

  async allcationOnceId(payload: any, userId: any) {
    const { idAr, ...nPayload } = payload;
    const allocationManagement = await this.allocationManagementNew(
      nPayload,
      userId,
    );

    return allocationManagement;
    // const fil = allocationManagement.filter((f: any) => {
    //   return idAr.includes(f?.id);
    // });

    // return fil;
  }

  async shipperAllocationReview(id: any, payload: any, userId: any) {
    const { shipper_allocation_review, comment, row_data } = payload;
    const idN = Number(id);

    const allocation = await this.prisma.allocation_management.findFirst({
      where: {
        id: Number(idN),
      },
    });

    const nowAt = getTodayNowAdd7();

    const toDayReviewCodeStartWith = `${nowAt.tz('Asia/Bangkok').format('YYYYMMDD')}-ALP-`

    // const shipperAllocationReviewCreate =
    //   await this.prisma.allocation_management_shipper_review.create({
    //     data: {
    //       allocation_status_id: allocation?.allocation_status_id,
    //       allocation_management_id: Number(idN),
    //       shipper_allocation_review: shipper_allocation_review,
    //       create_date: nowAt.toDate(),
    //       create_date_num: nowAt.unix(),
    //       create_by: Number(userId),
    //     },
    //   });

    if (allocation?.allocation_status_id === 1 && !allocation?.review_code) {
      const allocationCount = await this.prisma.allocation_management.count({
        where: {
          review_code: {
            startsWith: toDayReviewCodeStartWith,
          },
          // create_date: {
          //   gte: todayStart,  // มากกว่าหรือเท่ากับเวลาเริ่มต้นของวันนี้
          //   lte: todayEnd,    // น้อยกว่าหรือเท่ากับเวลาสิ้นสุดของวันนี้
          // },
        },
      });

      const reviewCodeNum = `${toDayReviewCodeStartWith}${(allocationCount > 0 ? allocationCount + 1 : 1).toString().padStart(4, '0')}`;
      const update = await this.prisma.allocation_management.updateMany({
        where: {
          id: Number(idN),
        },
        data: {
          review_code: reviewCodeNum,
          allocation_status_id: 2,
        },
      });
      if (comment) {
        await this.prisma.allocation_management_comment.create({
          data: {
            allocation_status_id: Number(2),
            allocation_management_id: Number(idN),
            remark: comment,
            create_date: nowAt.toDate(),
            create_date_num: nowAt.unix(),
            create_by: Number(userId),
          },
        });
      }

      const shipperAllocationReviewCreate =
        await this.prisma.allocation_management_shipper_review.create({
          data: {
            allocation_status_id: 2,
            allocation_management_id: Number(idN),
            shipper_allocation_review: shipper_allocation_review,
            create_date: nowAt.toDate(),
            create_date_num: nowAt.unix(),
            create_by: Number(userId),
          },
          include: {
            allocation_status: true,
            allocation_management: true,
          },
        });

      const allocationFn = await this.prisma.allocation_management.findFirst({
        where: {
          id: Number(idN),
        },
        include: {
          allocation_management_comment: {
            include: {
              allocation_status: true,
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
            // orderBy: { id: "desc" }
          },
          allocation_management_shipper_review: {
            include: {},
            take: 1,
            orderBy: {
              id: 'desc',
            },
          },
          allocation_status: true,
        }
      });

      return allocationFn;
    } else {
      const update = await this.prisma.allocation_management.updateMany({
        where: {
          id: Number(idN),
        },
        data: {
          allocation_status_id: 2,
        },
      });
      if (comment) {
        await this.prisma.allocation_management_comment.create({
          data: {
            allocation_status_id: 2,
            allocation_management_id: Number(idN),
            remark: comment,
            create_date: nowAt.toDate(),
            create_date_num: nowAt.unix(),
            create_by: Number(userId),
          },
        });
      }

      const shipperAllocationReviewCreate =
        await this.prisma.allocation_management_shipper_review.create({
          data: {
            allocation_status_id: 2,
            allocation_management_id: Number(idN),
            shipper_allocation_review: shipper_allocation_review,
            create_date: nowAt.toDate(),
            create_date_num: nowAt.unix(),
            create_by: Number(userId),
          },
          include: {
            allocation_status: true,
            allocation_management: true,
          },
        });

      const allocationFn = await this.prisma.allocation_management.findFirst({
        where: {
          id: Number(idN),
        },
        include: {
          allocation_management_comment: {
            include: {
              allocation_status: true,
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
            // orderBy: { id: "desc" }
          },
          allocation_management_shipper_review: {
            include: {},
            take: 1,
            orderBy: {
              id: 'desc',
            },
          },
          allocation_status: true,
        }
      });

      return allocationFn;
    }

    // return payload;
  }

  async createByOnce(userId: any) {
    const user = await this.prisma.account.findFirst({
      where: {
        id: Number(userId),
      },
      include: {},
    });

    const nowAt = getTodayNowAdd7();

    return {
      create_date: nowAt.toDate(),
      create_date_num: nowAt.unix(),
      create_by: user,
    };
  }

  async allocationManageChangeStatus(payload: any, userId: any) {
    const { status, comment, rowArray } = payload;
    const nowAt = getTodayNowAdd7();

    for (let i = 0; i < rowArray.length; i++) {
      const now = dayjs();
      const update = await this.prisma.allocation_management.updateMany({
        where: {
          id: Number(rowArray[i]?.id),
        },
        data: {
          allocation_status_id: Number(status),
          update_date: now.toDate(),
          update_date_num: now.unix()
        },
      });
      if (comment) {
        await this.prisma.allocation_management_comment.create({
          data: {
            allocation_status_id: Number(status),
            allocation_management_id: Number(rowArray[i]?.id),
            remark: comment,
            create_date: nowAt.toDate(),
            create_date_num: nowAt.unix(),
            create_by: Number(userId),
            reasons: true,
          },
        });
      }
    }

    return true;
  }

  async allocationManageChangeStatusValidate(payload: any, userId: any) {
    const { status, rowArray } = payload;
    const nowAt = getTodayNowAdd7();

    //check only when Accepted
    if (status == 3) {
      const checkSE = await this.prisma.system_parameter.findFirst({
        where: {
          system_parameter_id: 2,
          start_date: {
            lte: nowAt.toDate(),
          },
        },
        orderBy: {
          start_date: 'desc',
        },
      });

      const sysT = (!!checkSE?.value && Number(checkSE?.value)) || 0;
      // (ABS(Shipper review - Original system allocation) / Original system allocation)*100 > Maximum tolerance %
      const logErr = [];
      for (let i = 0; i < rowArray.length; i++) {
        const sR =
          (!!rowArray[i]?.allocation_management_shipper_review &&
            Number(rowArray[i]?.allocation_management_shipper_review)) ||
          0;
        const calc =
          Math.abs(
            (sR - rowArray[i]?.systemAllocation) / rowArray[i]?.systemAllocation,
          ) *
          100 >
          sysT;
        if (!calc) {
          logErr.push(
            `Shipper allocation review ${dayjs(rowArray[i]?.gas_day, 'YYYY-MM-DD').format('DD/MM/YYYY')} - ${rowArray[i]?.point} exceeds allocation tolerance`,
            // `Shipper allocation review ${dayjs(rowArray[i]?.gas_day, 'YYYY-MM-DD').format('DD/MM/YYYY')} - ${rowArray[i]?.checkDb?.point_text} exceeds allocation tolerance`,
          );
        }
      }
      if (logErr.length > 0) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: `${logErr.map((e: any) => e).join(',')}`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    return true;
  }

  async evidenApiCenter(payload: any, url: any) {
    // const { start_date, end_date, skip, limit } = payload;

    const agent = new https.Agent({
      rejectUnauthorized: true,
    });

    const data = JSON.stringify(payload);

    // SSRF guard: ensure provided path is a safe relative path
    try {
      const { assertSafeServicePath } = await import('src/common/utils/url.util');
      assertSafeServicePath(String(url));
    } catch (e) {
      console.log('Invalid service path');
      return [];
    }

    const config = {
      method: `${process.env.METHOD_EVIDEN}`,
      maxBodyLength: Infinity,
      url: `${process.env.IP_EVIDEN}/${url}`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: process.env.TOKEN_EVIDEN,
      },
      httpsAgent: agent,
      data: data,
    };

    try {
      const resEviden = await axios.request(config);

      let evidenData = [];
      if (resEviden?.status === 200 && !!resEviden?.data) {
        evidenData = resEviden?.data;
      }

      return evidenData;
    } catch (error) {
      // เช็คว่ามี response หรือไม่
      console.log('Eviden API Error:', error.message);

      // ไม่ให้แตก → return [] แทน
      return [];
    }
  }

  async evidenApiCenterPost(payload: any, url: any) {
    const agent = new https.Agent({
      rejectUnauthorized: true,
    });

    const data = JSON.stringify(payload);

    // SSRF guard: ensure provided path is a safe relative path
    try {
      const { assertSafeServicePath } = await import('src/common/utils/url.util');
      assertSafeServicePath(String(url));
    } catch (e) {
      console.log('Invalid service path (post)');
      return [];
    }

    const config = {
      method: `${process.env.METHOD_EVIDEN}`,
      maxBodyLength: Infinity,
      url: `${process.env.IP_EVIDEN}/${url}`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: process.env.TOKEN_EVIDEN,
      },
      httpsAgent: agent,
      data: data,
    };
    const resEviden = await axios.request(config);
    let evidenData = [];
    if (resEviden?.status === 200 && !!resEviden?.data) {
      evidenData = resEviden?.data;
    }
    return evidenData;
  }

  async getStartDateForEod() {
    // * check update data to find start date
    const lastEodExeucte = await this.prisma.execute_eod.findFirst({
      select: { id: true, execute_timestamp: true },
      where: { status: 'OK' },
      orderBy: { execute_timestamp: 'desc' }
    })
    let tsLastEodDate;
    if (lastEodExeucte) {
      tsLastEodDate = new Date(lastEodExeucte.execute_timestamp * 1000);
    } else {
      tsLastEodDate = new Date(0); // 1970-01-01 UTC
    }
    console.log('last eod execute: ', dayjs(tsLastEodDate).format('YYYY-MM-DD HH:mm:ss'))
    let start_date = getTodayStartAdd7().toDate();
    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: 'get-lated-gasday',
        mode: 'metering',
        timestamp: dayjs(tsLastEodDate).format('YYYY-MM-DD HH:mm:ss')
      }));
    let meterData: any[] = [];
    try {
      meterData = this.safeParseJSON(meteredMicroData?.reply ?? '[]');
    } catch {
      meterData = [];
    }

    if (Array.isArray(meterData) && meterData.length > 0) {
      const minGasDay =
        meterData
          .map((r: any) => r?.gasDay)
          .filter(Boolean)
          .map((s: string) => dayjs(s))
          .filter((d) => d.isValid())
          .sort((a, b) => a.valueOf() - b.valueOf())[0] ?? null;

      if (minGasDay) {
        const new_start_date = minGasDay.startOf('day').toDate();
        console.log(`update start_date from meter: old ${start_date} new ${new_start_date}`);
        start_date = new_start_date;
      }
    }

    // check update allocation shipper review
    const updatedReview = await this.prisma.allocation_management.findFirst({
      select: { gas_day: true },
      where: {
        allocation_management_shipper_review: {
          some: {
            OR: [
              { create_date: { gte: tsLastEodDate } },
              { update_date: { gte: tsLastEodDate } }
            ]
          }
        },
        allocation_status: {
          name: { in: ["Accepted"] }
        },
        gas_day: { lt: start_date }
      },
      orderBy: { gas_day: 'asc' }
    });

    if (updatedReview) {
      const new_start_date = new Date(updatedReview?.gas_day);
      console.log(`update start_date from shipper review: old ${start_date} new ${new_start_date}`)
      start_date = new_start_date;
    }
    // check adjustment by shipper
    const updatedAdjDailyImb = await this.prisma.balancing_adjustment_daily_imbalance.findFirst({
      select: { gas_day: true },
      where: {
        OR: [{ create_date: { gte: tsLastEodDate } }, { update_date: { gte: tsLastEodDate } }],
        gas_day: { lt: start_date }
      },
      orderBy: { gas_day: 'asc' }
    })
    if (updatedAdjDailyImb) {
      const new_start_date = new Date(updatedAdjDailyImb?.gas_day);
      console.log(`update start_date from adjust daily imb: old ${start_date} new ${new_start_date}`)
      start_date = new_start_date;
    }
    const updatedAdjAccImb = await this.prisma.balancing_adjust_accumulated_imbalance.findFirst({
      select: { gas_day: true },
      where: {
        OR: [{ create_date: { gte: tsLastEodDate } }, { update_date: { gte: tsLastEodDate } }],
        gas_day: { lt: start_date }
      },
      orderBy: { gas_day: 'asc' }
    })
    if (updatedAdjAccImb) {
      const new_start_date = new Date(updatedAdjAccImb?.gas_day);
      console.log(`update start_date from adjust acc imb: old ${start_date} new ${new_start_date}`)
      start_date = new_start_date;
    }
    const updatedVCO = await this.prisma.vent_commissioning_other_gas.findFirst({
      select: { gas_day: true },
      where: {
        OR: [{ create_date: { gte: tsLastEodDate } }, { update_date: { gte: tsLastEodDate } }],
        gas_day: { lt: start_date }
      },
      orderBy: { gas_day: 'asc' }
    })
    if (updatedVCO) {
      const new_start_date = new Date(updatedVCO.gas_day);
      console.log(`update start_date from vco: old ${start_date} new ${new_start_date}`)
      start_date = new_start_date;
    }
    // verify dam system parameter 
    const updatedDam = await this.prisma.system_parameter.findFirst({
      select: { start_date: true },
      where: {
        OR: [{ create_date: { gte: tsLastEodDate } }, { update_date: { gte: tsLastEodDate } }],
        start_date: { lt: start_date },
        system_parameter: { name: { startsWith: 'Intraday' } }
      },
      orderBy: { start_date: 'asc' }
    })
    if (updatedDam) {
      const new_start_date = new Date(updatedDam.start_date);
      console.log(`update start_date from dam: old ${start_date} new ${new_start_date}`)
      start_date = new_start_date;
    }

    // verify close balance 
    const closedBal = await this.prisma.closed_balancing_report.findFirst({
      select: { date_balance: true },
      orderBy: { id: 'desc' }
    });

    if (closedBal) {
      const closedBalDate = dayjs(closedBal?.date_balance).add(1, 'month').toDate();
      if (start_date) {
        if (start_date < closedBalDate) {
          console.log(`compare close balance: start_date ${start_date} < close balance ${closedBalDate}`)
          start_date = closedBalDate
        }
      }
    }

    const min_start_date_str = process.env.MIN_ALLOC_BAL_DATE
    if (min_start_date_str) {
      const min_start_date = dayjs(min_start_date_str, "DD/MM/YYYY").toDate();
      if (start_date < min_start_date) {
        console.log(`[WARN] start_date ${start_date} below min_start_date ${min_start_date}`)
        start_date = min_start_date
      }
    }

    return start_date
  }

  async createExerIntradayLog(createNumberId, rq_eod, execute_timestamp, request_number_previous_hour, gas_day, hour) {
    try {
      const createIntraday = await this.prisma.execute_intraday.create({
        data: {
          request_number: {
            connect: {
              id: Number(createNumberId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
          request_number_eod: {
            connect: {
              id: rq_eod, // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
          execute_timestamp: execute_timestamp,
          request_number_previous_hour: request_number_previous_hour,
          gas_day_date: dayjs(gas_day).toDate(),
          gas_day: gas_day,
          gas_hour: hour,
        },
        include: {
          request_number: true,
        },
      });
      return createIntraday
    }
    catch (error) {
      return null
    }
  }

  async isPublish(execute_timestamp: any, gasHour: any, gasDay: string) {
    const lastPublic = await this.prisma.publication_center.findFirst({
      select: { execute_timestamp: true, gas_day: true, gas_hour: true },
      where: {
        execute_timestamp: execute_timestamp,
        gas_day_text: gasDay,
        gas_hour: gasHour,
        del_flag: true
      },
      orderBy: [{ create_date_num: 'desc' }, { update_date_num: 'desc' }]
    });
    return lastPublic ? false : true
  }

  async executeData(payload: any, userId: any) {
    const execute_timestamp = dayjs().unix();
    const now = getTodayNow();
    const nowAt = getTodayNowAdd7();
    const sleep = (ms: number) =>
      new Promise(resolve => setTimeout(resolve, ms));
    let yesterday = now.subtract(1, 'day').format('YYYY-MM-DD');
    let today = now.format('YYYY-MM-DD');
    let currentHour = nowAt.hour();
    let start_date_eod = await this.getStartDateForEod()
    let end_date_eod = getTodayStartAdd7().toDate()

    if (currentHour === 0) {
      end_date_eod = getTodayStartAdd7().subtract(1, 'day').toDate()
      currentHour = 24;
      today = yesterday;
      yesterday = now.subtract(2, 'day').format('YYYY-MM-DD');
    }
    if (start_date_eod > end_date_eod) { start_date_eod = end_date_eod }

    console.log(`lunch execute alloc&bal: ${today} at hour ${currentHour}`)

    const fnCreateNumber = async (type: any) => {
      const runnum = await this.prisma.execute_runnumber.create({
        data: {
          request_number_type: type,
        },
      });
      return runnum?.id;
    };
    const createNumberId = await fnCreateNumber('eod');
    console.log('create record in execute_eod table')
    const createEod = await this.prisma.execute_eod.create({
      data: {
        request_number: {
          connect: {
            id: Number(createNumberId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
          },
        },
        execute_timestamp: execute_timestamp,
        start_date_date: start_date_eod,
        start_date: dayjs(start_date_eod).format('YYYY-MM-DD'),
        end_date_date: end_date_eod,
        end_date: dayjs(end_date_eod).format('YYYY-MM-DD'),
      },
      include: {
        request_number: true,
      },
    });

    // * execute eod
    const sendEod = {
      request_number: createEod?.request_number_id,
      execute_timestamp: createEod?.execute_timestamp,
      start_date: createEod?.start_date,
      end_date: createEod?.end_date,
    };
    console.log('create record in log_execute_eod table')
    await this.prisma.log_execute_eod.create({
      data: {
        request_number: createEod?.request_number_id,
        execute_timestamp: createEod?.execute_timestamp,
        start_date: createEod?.start_date,
        end_date: createEod?.end_date,
        create_date: nowAt.toDate(),
        create_date_num: nowAt.unix(),
        create_by: userId ? Number(userId) : undefined,
      }
    })
    console.log(`execute_eod (${createEod?.request_number_id}): ${createEod?.start_date} - ${createEod?.end_date}`)
    await this.evidenApiCenterPost(sendEod, 'execute_eod');
    const diffDays = dayjs(end_date_eod).diff(dayjs(start_date_eod), 'day');
    console.log(`wait for execute_eod complete`)
    await sleep(2500 + (diffDays * 100));
    // TODO: Include Public logic
    // *execute Intrday
    console.log(`find reqeust number eod for intraday process`)
    const refEodExeucte1 = await this.prisma.execute_eod.findFirst({
      select: { id: true },
      where: {
        start_date_date: { 'lt': dayjs(today, "YYYY-MM-DD").toDate() },
        end_date_date: { 'gte': dayjs(today, "YYYY-MM-DD").subtract(1, "day").toDate() }
      },
      orderBy: { execute_timestamp: 'desc' }
    });
    const rq_eod_1 = Number(refEodExeucte1?.id);
    const refEodExeucte2 = await this.prisma.execute_eod.findFirst({
      select: { id: true },
      where: {
        start_date_date: { 'lt': dayjs(yesterday, "YYYY-MM-DD").toDate() },
        end_date_date: { 'gte': dayjs(yesterday, "YYYY-MM-DD").subtract(1, "day").toDate() }
      },
      orderBy: { execute_timestamp: 'desc' }
    });
    const rq_eod_2 = Number(refEodExeucte2?.id);

    const useData = [];
    const is_recal = createEod?.start_date != today;
    console.log(`is recal ${is_recal}`);
    console.log(`list intraday execute`);
    if (is_recal) {
      // *recal yesterday at 24
      const meteredMicroDataYester = await this.meteredMicroService.sendMessage(
        JSON.stringify({
          case: 'get-last-gashour',
          mode: 'metering',
          gas_day: today
        }));
      const parsedYester = (!!meteredMicroDataYester?.reply && this.safeParseJSON(meteredMicroDataYester.reply)) || null;
      let rowsYester: any[] = [];
      rowsYester = parsedYester; // microservice returned an array
      console.log(`meterData (array) length ${rowsYester.length}`);
      const hoursYester = [...new Set(rowsYester.map(r => Number(r?.gasHour)).filter(Number.isFinite))].sort((a, b) => a - b);
      if (hoursYester.length === 0) {
        console.log('no hours yester returned from metering — skipping intraday');
      }
      // get last exe timestamp
      const exeIntraday = await this.prisma.execute_intraday.findMany({
        select: { request_number_id: true, gas_day: true, gas_hour: true, execute_timestamp: true },
        where: { status: 'OK', gas_day: yesterday, gas_hour: { 'lt': hoursYester[0] } },
        orderBy: [
          { gas_day: 'desc' },
          { gas_hour: 'desc' },
          { execute_timestamp: 'desc' }
        ]
      });
      let request_number_previous_hour = null
      for (let i = 0; i < exeIntraday.length; i++) {
        const exeTime = exeIntraday[i]?.execute_timestamp;
        const gh = exeIntraday[i]?.gas_hour;
        const gd = exeIntraday[i]?.gas_day;
        const is_publish = this.isPublish(exeTime, gh, gd);
        if (is_publish) { request_number_previous_hour = exeIntraday[i].request_number_id; break; }
      }

      const createNumberId = await fnCreateNumber('intraday');
      const createIntraday = await this.createExerIntradayLog(createNumberId, rq_eod_2,
        execute_timestamp, request_number_previous_hour, yesterday, 24);
      if (createIntraday) {
        request_number_previous_hour = createNumberId
        useData.push(createIntraday);
      } else { console.log(`skip hour 24: createExerIntradayLog returned null`); }
      // *recal today
      // get gasHour
      const meteredMicroData = await this.meteredMicroService.sendMessage(
        JSON.stringify({
          case: 'get-gashour',
          mode: 'metering',
          gas_day: today
        }));
      const parsed = (!!meteredMicroData?.reply && this.safeParseJSON(meteredMicroData.reply)) || null;
      let rows: any[] = [];
      rows = parsed; // microservice returned an array
      console.log(`meterData (array) length ${rows.length}`);
      const hours = [...new Set(rows.map(r => Number(r?.gasHour)).filter(Number.isFinite))].sort((a, b) => a - b);
      if (hours.length === 0) {
        console.log('no hours returned from metering — skipping intraday');
      }

      for (const iHour of hours) {
        const createNumberId = await fnCreateNumber('intraday');
        const createIntraday = await this.createExerIntradayLog(createNumberId, rq_eod_1, execute_timestamp, request_number_previous_hour, today, iHour);
        if (createIntraday) {
          request_number_previous_hour = createNumberId
          useData.push(createIntraday);
        } else { console.log(`skip hour ${iHour}: createExerIntradayLog returned null`); }
      }
    }
    else {
      // get gas hour
      const meteredMicroData = await this.meteredMicroService.sendMessage(
        JSON.stringify({
          case: 'get-last-gashour',
          mode: 'metering',
          gas_day: today
        }));
      const parsed = (!!meteredMicroData?.reply && this.safeParseJSON(meteredMicroData.reply)) || null;
      let rows: any[] = [];
      rows = Array.isArray(parsed) ? parsed : []; // microservice returned an array
      console.log(`meterData (array) length ${rows.length}`);
      const hours = [...new Set(rows.map(r => Number(r?.gasHour)).filter(Number.isFinite))].sort((a, b) => a - b);
      if (hours.length === 0) {
        console.log('no hours returned from metering — skipping intraday');
      }

      // get last exe timestamp
      const exeIntraday = await this.prisma.execute_intraday.findMany({
        select: { request_number_id: true, gas_day: true, gas_hour: true, execute_timestamp: true },
        where: {
          status: 'OK',
          OR: [
            { AND: [{ gas_hour: { 'lt': hours[0] } }, { gas_day: today }], },
            { gas_day: yesterday }
          ]
        },
        orderBy: [
          { gas_day: 'desc' },
          { gas_hour: 'desc' },
          { execute_timestamp: 'desc' }
        ]
      });
      let request_number_previous_hour = null
      for (let i = 0; i < exeIntraday.length; i++) {
        const exeTime = exeIntraday[i]?.execute_timestamp;
        const gh = exeIntraday[i]?.gas_hour;
        const gd = exeIntraday[i]?.gas_day;
        const is_publish = this.isPublish(exeTime, gh, gd);
        if (is_publish) { request_number_previous_hour = exeIntraday[i].request_number_id; break; }
      }

      for (const iHour of hours) {
        const createNumberId = await fnCreateNumber('intraday');
        const createIntraday = await this.createExerIntradayLog(createNumberId, rq_eod_1, execute_timestamp, request_number_previous_hour, today, iHour);
        if (createIntraday) {
          request_number_previous_hour = createNumberId
          useData.push(createIntraday);
        } else { console.log(`skip hour ${iHour}: createExerIntradayLog returned null`); }
      }
    }
    // execute_intraday
    console.log(`execute intraday`);
    for (let i = 0; i < useData.length; i++) {
      const reqEod = useData[i]?.gas_day === today ? rq_eod_1 : rq_eod_2;
      const sendIntraday = {
        request_number: useData[i]?.request_number_id,
        execute_timestamp: useData[i]?.execute_timestamp,
        request_number_previous_hour: useData[i]?.request_number_previous_hour,
        request_number_eod: reqEod,
        gas_day: useData[i]?.gas_day,
        gas_hour: useData[i]?.gas_hour,
      };
      await this.prisma.log_execute_intraday.create({
        data: {
          request_number: useData[i]?.request_number_id,
          execute_timestamp: useData[i]?.execute_timestamp,
          request_number_previous_hour: useData[i]?.request_number_previous_hour,
          request_number_eod: reqEod,
          gas_day: useData[i]?.gas_day,
          gas_hour: useData[i]?.gas_hour,
          create_date: now.toDate(),
          create_date_num: now.unix(),
          create_by: Number(userId),
        }
      })
      // ปิดก่อน
      await this.evidenApiCenterPost(
        sendIntraday,
        'execute_intraday',
      );
      await sleep(1000);
    }

    try {
      await this.prisma.allocation_management.updateMany({
        where: {
          allocation_status_id: 3, // Accepted
        },
        data: {
          allocation_status_id: 4, // Allocated
        },
      });

      await this.prisma.allocation_management_shipper_review.updateMany({
        where: {
          allocation_status_id: 3, // Accepted
        },
        data: {
          allocation_status_id: 4, // Allocated
        },
      });
    } catch (error) {
      console.log('update allocation status error : ', error);
    }

    return { eod: sendEod, intraday: useData };
  }

  async versionExe(payload: any, userId: any) {
    const temp = [
      {
        request_number: 813,
        execute_timestamp: 1740072000,
        gas_day: '2025-02-20',
        type: 'eod',
        success: true,
      },
      {
        request_number: 818,
        execute_timestamp: 1740097800,
        gas_day: '2025-02-20',
        type: 'eod',
        success: true,
      },
      {
        request_number: 348,
        execute_timestamp: 1737318000,
        request_number_previous_hour: 347,
        request_number_eod: 346,
        gas_day: '2025-01-20',
        gas_hour: 3,
        type: 'intraday',
        success: true,
      },
    ];

    return temp;
  }

  async allcationOnceIdQuery(payload: any, userId: any) {
    const { idAr, ...nPayload } = payload;
    const allocationQuery = await this.allocationQueryNew(nPayload, userId);
    const fil = allocationQuery.filter((f: any) => {
      return idAr.includes(f?.id);
    });

    return fil;
  }
  // 
  async allocationQuery(payload: any, userId: any) {
    const { start_date, end_date, skip, limit, tab } = payload;
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

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

    const groupMaster = await this.prisma.group.findMany({
      where: {
        user_type_id: 3,
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

    const meterMaster = await this.prisma.metering_point.findMany({
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
        nomination_point: true,
      },
    });

    const nominationFile =
      await this.prisma.query_shipper_nomination_file.findMany({
        where: {
          query_shipper_nomination_status: {
            id: {
              in: [2, 5],
            },
          },
        },
        include: {
          contract_code: true,
          group: true,
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
      });

    const convertNomFile = (nominationFile || []).map((e: any) => {
      // nomination_type_id 1 daily, 2 weekly
      e['gas_day'] = dayjs(e['gas_day']).format('YYYY-MM-DD');
      e['nomination_version'] = (e['nomination_version'] || []).map((nv: any) => {
        nv['nomination_full_json'] = nv['nomination_full_json'].map(
          (nj: any) => {
            nj['data_temp'] = this.safeParseJSON(nj['data_temp']);
            return { ...nj };
          },
        );
        nv['nomination_row_json'] = nv['nomination_row_json'].map((nj: any) => {
          nj['data_temp'] = this.safeParseJSON(nj['data_temp']);
          return { ...nj };
        });
        return { ...nv };
      });
      const fullData = e['nomination_version'][0]?.['nomination_full_json'][0];
      const rowData = e['nomination_version'][0]?.['nomination_row_json'];
      delete e['nomination_version'];
      return { ...e, fullData, rowData };
    });

    let intradayEviden = [];
    if (tab === '2') {
      intradayEviden = await this.evidenApiAllocationIntraday({
        gas_day: '2025-02-28',
        start_hour: 1,
        end_hour: 24,
        skip: 0,
        limit: 100,
      });
      // for (let i = 0; i < dateArray.length; i++) {
      //   try {
      //     // List รายการที่ต้องกลับมาแก้ ของจริงต้องเปิด
      //     // const evidenApiAllocationIntraday = await this.evidenApiAllocationIntraday({
      //     //   gas_day: dateArray[i],
      //     //   start_hour: 1,
      //     //   end_hour: 24,
      //     //   skip: 0,
      //     //   limit: 100,
      //     // });
      //     intradayEviden.push({
      //       gasday: dateArray[i],
      //       data: evidenApiAllocationIntraday,
      //     });
      //   } catch (error) {
      //     intradayEviden.push({
      //       gasday: dateArray[i],
      //       data: [],
      //     });
      //   }
      // }
    }


    const evidenApiAllocationEod =
      tab === '1'
        ? await this.evidenApiAllocationEod({
          start_date,
          end_date,
          skip,
          limit,
        })
        : intradayEviden;

    const start = start_date ? getTodayStartAdd7(start_date) : null;
    const end = end_date ? getTodayEndAdd7(end_date) : null;

    if (!start || !end || !start.isValid() || !end.isValid()) {
      throw new Error('⛔ Invalid date format');
    }

    if (end.isBefore(start)) {
      throw new Error('⛔ End date must be after or equal to start date');
    }

    const dateArray: string[] = [];

    let current = start;

    while (current.isSameOrBefore(end)) {
      dateArray.push(current.format('YYYY-MM-DD'));
      current = current.add(1, 'day');
    }

    // List รายการที่ต้องกลับมาแก้ mock ต้องปิด
    // const evidenApiAllocationIntraday = await this.evidenApiAllocationIntraday({
    //   //test
    //   gas_day: '2025-02-28',
    //   start_hour: 1,
    //   end_hour: 24,
    //   skip: 0,
    //   limit: 100,
    // });
    // for (let i = 0; i < dateArray.length; i++) {
    //   try {
    //     // List รายการที่ต้องกลับมาแก้ ของจริงต้องเปิด
    //     // const evidenApiAllocationIntraday = await this.evidenApiAllocationIntraday({
    //     //   gas_day: dateArray[i],
    //     //   start_hour: 1,
    //     //   end_hour: 24,
    //     //   skip: 0,
    //     //   limit: 100,
    //     // });
    //     intradayEviden.push({
    //       gasday: dateArray[i],
    //       data: evidenApiAllocationIntraday,
    //     });
    //   } catch (error) {
    //     intradayEviden.push({
    //       gasday: dateArray[i],
    //       data: [],
    //     });
    //   }
    // }

    const nomExtPoint = convertNomFile.flatMap((e: any) => {
      const pointType1 = e['rowData'].filter((f: any) => {
        return (
          f?.query_shipper_nomination_type_id === 1 &&
          f?.data_temp['9'] === 'MMBTU/D'
        );
      });
      const point = pointType1.map((pt: any) => {
        const { rowData, ...nE } = e;
        return { ...nE, point: { ...pt } };
      });
      return point;
    });
    const findGasday = nomExtPoint.filter((f: any) => {
      return (evidenApiAllocationEod || [])
        .map((e: any) => e?.gas_day)
        .includes(f?.gas_day);
    });
    const findGasdayAddEviden = findGasday.map((e: any) => {
      const eviden_data_gas_day = evidenApiAllocationEod.filter(
        (f: any) => f?.gas_day === e?.gas_day,
      );
      // headData

      let evidenUse = null;
      let use = 0;
      for (let iEviden = 0; iEviden < eviden_data_gas_day.length; iEviden++) {
        for (
          let iEvidenData = 0;
          iEvidenData < eviden_data_gas_day[iEviden]?.data.length;
          iEvidenData++
        ) {
          if (
            eviden_data_gas_day[iEviden]?.data[iEvidenData]?.contract ===
            e?.contract_code?.contract_code &&
            eviden_data_gas_day[iEviden]?.data[iEvidenData]?.shipper ===
            e?.group?.id_name
          ) {
            // eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data
            const point = eviden_data_gas_day[iEviden]?.data[
              iEvidenData
            ]?.data.find((f: any) => {
              return f?.['point'] === e['point']?.['data_temp']?.['3'];
            });
            if (point) {
              if (
                point?.['area'] === e['point']?.['data_temp']?.['2'] &&
                point?.['zone'] === e['point']?.['data_temp']?.['0'] &&
                point?.['entry_exit'].toUpperCase() ===
                e['point']?.['data_temp']?.['10'].toUpperCase()
              ) {
                //
                if (use <= eviden_data_gas_day[iEviden]?.request_number) {
                  use = eviden_data_gas_day[iEviden]?.request_number;
                  evidenUse = {
                    request_number:
                      eviden_data_gas_day[iEviden]?.request_number,
                    execute_timestamp:
                      eviden_data_gas_day[iEviden]?.execute_timestamp,
                    gas_day: eviden_data_gas_day[iEviden]?.gas_day,
                    data: point,
                    contract:
                      eviden_data_gas_day[iEviden]?.data[iEvidenData]?.contract,
                    shipper:
                      eviden_data_gas_day[iEviden]?.data[iEvidenData]?.shipper,
                  };
                }
              }
            }
            // const zone = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["zone"]
            // const area = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["area"]
            // const entry_exit = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["entry_exit"]
            // * const customer_type = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["customer_type"]
            // * const point_type = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["point_type"]
            // * const relation_point = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["relation_point"]
            // * const relation_point_type = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["relation_point_type"]
            // * const previous_value = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["previous_value"]
            // * const value = eviden_data_gas_day[iEviden]?.data[iEvidenData]?.data["value"]

            // "data_temp": {
            //       "0": "WEST",
            //       "1": "Supply",
            //       "2": "Y",
            //       "3": "YDANA",
            //       "4": "",
            //       "5": "",
            //       "6": "Supply",
            //       "7": "",
            //       "8": "",
            //       "9": "MMBTU/D",
            //       "10": "Entry",
          }
        }
      }

      return { ...e, evidenUse };
    });

    const evidenUse = findGasdayAddEviden.filter((f: any) => !!f?.evidenUse);

    const ckEvidenUse = evidenUse.map((e: any) => {
      const nominationValue =
        e['nomination_type_id'] === 1
          ? e['point']['data_temp']['38']
          : e['point']['data_temp']['14']; // รอทำ weekly

      const systemAllocation = e['evidenUse']?.['data']?.['value'];
      const previousAllocationTPAforReview =
        e['evidenUse']?.['data']?.['previous_value'];

      // intradayEviden

      // const intraDay = intraFilValue[intraFilValue.length - 1] || null;
      // const { data: dataIntraDay = null, ...nIntraDay }: any = intraDay;

      // meteringValue
      const meteringValue = null; //----
      const meterFil = meterMaster.filter((f: any) => {
        return (
          f?.nomination_point?.nomination_point ===
          e['evidenUse']?.['data']?.['point']
        );
      });
      const meterName = meterFil?.map((mF: any) => mF?.metered_point_name);

      // areaMaster
      const area_obj = areaMaster.find((f: any) => {
        return f?.name === e['evidenUse']?.['data']?.['area'];
      });
      const zone_obj = zoneMaster.find((f: any) => {
        return f?.name === e['evidenUse']?.['data']?.['zone'];
      });
      const entry_exit_obj = entryExitMaster.find((f: any) => {
        return (
          f?.name.toUpperCase() ===
          e['evidenUse']?.['data']?.['entry_exit'].toUpperCase()
        );
      });

      const checkDb = {
        gas_day_text: e['gas_day'], //
        shipper_name_text: e['evidenUse']?.['shipper'], //
        contract_code_text: e['evidenUse']?.['contract'], //
        point_text: e['evidenUse']?.['data']?.['point'], //
        entry_exit_text: e['evidenUse']?.['data']?.['entry_exit'], //
        area_text: e['evidenUse']?.['data']?.['area'],
        zone_text: e['evidenUse']?.['data']?.['zone'],
      };

      delete e['fullData']; //full json

      return {
        ...e,
        nominationValue,
        systemAllocation,
        previousAllocationTPAforReview,
        meteringValue,
        checkDb,
        area_obj,
        zone_obj,
        entry_exit_obj,
        meterName,
      };
    });

    const newData = [];
    let meterArr = [];

    for (let i = 0; i < ckEvidenUse.length; i++) {
      const formateMeterG = ckEvidenUse[i]?.meterName?.map((e: any) => ({
        meterPointId: e,
        gasDay: ckEvidenUse[i]?.gas_day,
      }));
      meterArr = [...new Set([...meterArr, ...formateMeterG])];
    }

    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: 'get-last-once',
        mode: 'metering',
        meter_gas: meterArr,
      }),
    );
    const reply =
      (!!meteredMicroData?.reply && this.safeParseJSON(meteredMicroData?.reply)) ||
      null;

    for (let i = 0; i < ckEvidenUse.length; i++) {
      const formateMeterG = ckEvidenUse[i]?.meterName?.map((e: any) => ({
        meterPointId: e,
        gasDay: ckEvidenUse[i]?.gas_day,
      }));
      let matchMeter = 0;
      for (let iM = 0; iM < formateMeterG.length; iM++) {
        const matchM = reply?.filter((f: any) => {
          return (
            f?.gasDay === formateMeterG[iM]?.gasDay &&
            f?.meterPointId === formateMeterG[iM]?.meterPointId
          );
        });
        const matchValue = matchM
          ?.map((nM: any) => nM?.value?.energy)
          .reduce((total, num) => total + (num ?? 0), 0);
        matchMeter += matchValue;
      }
      ckEvidenUse[i].meteringValue = matchMeter;

      const findAllocationMaster = ckEvidenUse[i];

      if (findAllocationMaster) {
        ckEvidenUse[i].id = findAllocationMaster?.id;
        ckEvidenUse[i].allocation_status =
          findAllocationMaster?.allocation_status;
        ckEvidenUse[i].review_code = findAllocationMaster?.review_code;
        ckEvidenUse[i].allocation_management_comment =
          findAllocationMaster?.allocation_management_comment;
        ckEvidenUse[i].allocation_management_shipper_review =
          findAllocationMaster?.allocation_management_shipper_review;
        ckEvidenUse[i].point_text = findAllocationMaster?.point_text;
        ckEvidenUse[i].shipper_id_text =
          findAllocationMaster?.shipper_name_text;
        ckEvidenUse[i].contract_code_text =
          findAllocationMaster?.contract_code_text;
        ckEvidenUse[i].gas_day_text = findAllocationMaster?.gas_day_text;
        const finG = groupMaster.find((f: any) => {
          return f?.id_name === findAllocationMaster?.shipper_name_text;
        });
        ckEvidenUse[i].shipper_name_text = finG?.name;
      }

      const {
        nomination_code,
        create_date,
        update_date,
        create_date_num,
        update_date_num,
        create_by,
        update_by,
        nomination_type_id,
        query_shipper_nomination_status_id,
        contract_code_id,
        group_id,
        file_name,
        query_shipper_nomination_file_renom_id,
        submitted_timestamp,
        del_flag,
        group,
        contract_code,
        point,
        ...nckEvidenUse
      } = ckEvidenUse[i];

      newData.push(nckEvidenUse);
    }

    return newData;
  }

  // กรอง วันที่ใน array ในช่วง min max
  filterDatesInRange(
    dates: (string | Date)[],
    minDate: string | Date,
    maxDate: string | Date,
  ) {
    const min = dayjs(minDate).startOf('day');
    const max = dayjs(maxDate).endOf('day'); // รวมวันสุดท้าย

    return dates
      .map(d => dayjs(d))                                   // แปลงเป็น dayjs
      .filter(dt => !dt.isBefore(min, 'day') && !dt.isAfter(max, 'day')) // อยู่ในช่วงแบบ inclusive
      .map(dt => dt.format('YYYY-MM-DD'));                  // รูปแบบผลลัพธ์
  }

  async allocationQueryNew(payload: any, userId: any) {
    const { start_date, end_date, is_last_version, version, skip, limit, tab } = payload;

    const startDate = getTodayStartAdd7(start_date);
    const endDate = getTodayEndAdd7(end_date);


    const entryExitMaster = await this.prisma.entry_exit.findMany({
      where: {},
    });

    const nominationFile =
      await this.prisma.query_shipper_nomination_file.findMany({
        where: {
          query_shipper_nomination_status: {
            id: {
              in: [2, 5],
            },
          },
          OR: [
            // Daily nominations: exact date match
            {
              nomination_type: {
                id: 1
              },
              gas_day: {
                gte: startDate.toDate(),
                lte: endDate.toDate(),
              },
            },
            // Weekly nominations: same week
            {
              nomination_type: {
                id: 2,
              },
              gas_day: {
                gte: startDate.startOf('week').toDate(),
                lte: endDate.endOf('week').toDate(),
              },
            },
          ],
        },
        include: {
          contract_code: true,
          group: true,
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
      });

    const convertNomFile = (nominationFile || []).map((e: any) => {
      // nomination_type_id 1 daily, 2 weekly
      e['gas_day'] = dayjs(e['gas_day']).format('YYYY-MM-DD');
      e['nomination_version'] = (e['nomination_version'] || []).map((nv: any) => {
        nv['nomination_full_json'] = nv['nomination_full_json'].map(
          (nj: any) => {
            nj['data_temp'] = this.safeParseJSON(nj['data_temp']);
            return { ...nj };
          },
        );
        nv['nomination_row_json'] = nv['nomination_row_json'].map((nj: any) => {
          nj['data_temp'] = this.safeParseJSON(nj['data_temp']);
          return { ...nj };
        });
        return { ...nv };
      });
      const fullData = e['nomination_version'][0]?.['nomination_full_json'][0];
      const rowData = e['nomination_version'][0]?.['nomination_row_json'];
      delete e['nomination_version'];
      return { ...e, fullData, rowData };
    });

    const start = start_date ? getTodayStartAdd7(start_date) : null;
    const end = end_date ? getTodayEndAdd7(end_date) : null;

    if (!start || !end || !start.isValid() || !end.isValid()) {
      throw new Error('⛔ Invalid date format');
    }

    if (end.isBefore(start)) {
      throw new Error('⛔ End date must be after or equal to start date');
    }

    const dateArray: string[] = [];

    let current = start;

    while (current.isSameOrBefore(end)) {
      dateArray.push(current.format('YYYY-MM-DD'));
      current = current.add(1, 'day');
    }

    // -------- แก้
    // console.log('dateArray : ', dateArray);

    // const startDate = getTodayStartAdd7(start_date).toDate();
    // const endDate = getTodayEndAdd7(end_date).toDate();

    // ถ้าเรียกไปเกินวันที่มี eviden จะ error ต้องรอเขาแก้ก่อน
    const { minDate, maxDate } = await findMinMaxExeDate(this.prisma, start_date, end_date);

    // console.log('eviden minDate : ', minDate);
    // console.log('eviden maxDate : ', maxDate);
    let evidenApiAllocationEod = [];
    let intradayEviden = [];
    if (tab === '2') {
      // minDate && await this.evidenApiAllocationContractPoint({
      //   start_date: minDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
      //   end_date: maxDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
      //   skip: 0,
      //   limit: 1,
      // }, (total_record: number) => {
      //   totalRecord = total_record;
      // });
      intradayEviden = minDate && (await Promise.all(this.filterDatesInRange(dateArray, minDate.format("YYYY-MM-DD"), maxDate.format("YYYY-MM-DD")).map(async (date) => {
        console.log('date : ', date);
        try {
          let totalRecord: number | undefined = undefined;
          await this.evidenApiAllocationIntraday({
            gas_day: date,
            start_hour: 1,
            end_hour: 24,
            skip: 0,
            limit: 1,
          }, (total_record: number) => {
            totalRecord = total_record;
          });
          const evidenApiAllocationIntraday = await this.evidenApiAllocationIntraday({
            gas_day: date,
            start_hour: 1,
            end_hour: 24,
            skip: totalRecord ? 0 : skip,
            limit: totalRecord ? totalRecord : limit,
          });
          return evidenApiAllocationIntraday;
        } catch (error) {
          return [];
        }
      }))).flat();
      evidenApiAllocationEod = intradayEviden;
    }
    else if (tab === '1') {
      let totalRecord: number | undefined = undefined;
      await this.evidenApiAllocationEod({
        start_date: minDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        end_date: maxDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        skip: 0,
        limit: 1,
      }, (total_record: number) => {
        totalRecord = total_record;
      });
      evidenApiAllocationEod = await this.evidenApiAllocationEod({
        start_date: minDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        end_date: maxDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        skip: totalRecord ? 0 : skip,
        limit: totalRecord ? totalRecord : limit,
      });
    }
    // console.log('----');

    // Extract gas days and generate date array
    const dateArrayFromService = extractAndGenerateDateArray(evidenApiAllocationEod);

    // Build active data for all dates
    const activeData = await buildActiveDataForDates(
      dateArrayFromService,
      this.prisma
    );

    // evidenApiAllocationEod
    evidenApiAllocationEod = version ? evidenApiAllocationEod.filter((item: any) => version.includes(item?.execute_timestamp)) : evidenApiAllocationEod;
    const newEOD = evidenApiAllocationEod?.flatMap((fm: any) => {
      const { data: data1, ...fmD } = fm;

      // Find active data for this gas_day
      const activeDataForDate = activeData.find((ad) => ad.date === fm.gas_day);

      const nData = data1?.flatMap((dFm: any) => {
        const { data: data2, ...fmD2 } = dFm;

        // Validate contract and shipper existence
        const contractValidation = validateContractAndShipper(dFm, activeDataForDate);
        // if (!contractValidation.isValid) {
        //   return [];
        // }

        const nData2 = data2
          // .filter((dFm2: any) => {
          //   return validatePointByType(dFm2, activeDataForDate);
          // })
          .map((dFm2: any) => {
            validatePointByType(dFm2, activeDataForDate);
            return { ...fmD, ...fmD2, ...dFm2, group: contractValidation.shipperObj };
          });

        return [...nData2];
      });

      return [...nData];
    }) || [];

    const allocationMaster = await this.prisma.allocation_management.findMany({
      include: {
        allocation_management_comment: {
          include: {
            allocation_status: true,
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
          // orderBy: { id: "desc" }
        },
        allocation_management_shipper_review: {
          include: {},
          take: 1,
          orderBy: {
            id: 'desc',
          },
        },
        allocation_status: true,
      },
    });

    const resultEodLast: any = is_last_version ? Object.values(
      newEOD.reduce((acc, curr) => {
        const key = `${curr.gas_day}|${curr.shipper}|${curr.contract}|${curr.point}|${curr.entry_exit}|${curr.area}|${curr.zone}`;
        if (!acc[key] || acc[key].execute_timestamp < curr.execute_timestamp) {
          acc[key] = curr;
        }
        return acc;
      }, {}),
    ) : Object.values(
      newEOD.reduce((acc, curr) => {
        const key = `${curr.gas_day}|${curr.shipper}|${curr.contract}|${curr.point}|${curr.entry_exit}|${curr.area}|${curr.zone}|${curr.execute_timestamp}`;
        if (!acc[key]) {
          acc[key] = curr;
        }
        return acc;
      }, {}),
    );

    const nEodPorp = resultEodLast.map((eod: any) => {
      const alloc = convertNomFile?.find((f: any) => {
        return (
          f?.gas_day === eod['gas_day'] &&
          f?.group?.id_name === eod['shipper'] &&
          f?.contract_code?.contract_code === eod['contract']
        );
      });

      const pointN = alloc?.['rowData']?.find((f: any) => {
        return (
          f?.query_shipper_nomination_type_id === 1 &&
          f?.data_temp['3'] === eod['point'] &&
          f?.data_temp['9'] === 'MMBTU/D' &&
          f?.area_text === eod['area'] &&
          f?.zone_text === eod['zone']
        );
      });

      let nominationValue: number | null = null
      if (alloc?.nomination_type_id && pointN) {
        if (alloc?.nomination_type_id === 1) {
          nominationValue = parseToNumber(pointN['data_temp']['38'])
          if (eod?.gas_hour) {
            let i = 0
            let acc: number | null = null
            do {
              const valuePerHour: number | null = parseToNumber(pointN['data_temp'][`${14 + i}`])
              if (acc) {
                if (valuePerHour) {
                  acc = acc + valuePerHour
                }
              }
              else {
                acc = valuePerHour
              }
              i++
            } while (i < eod?.gas_hour)
            nominationValue = acc
          }
        } else {
          const dayOfWeek = Number(getTodayStartAdd7(eod['gas_day']).format('d')) // The day of the week, with Sunday as 0
          nominationValue = parseToNumber(pointN['data_temp'][`${14 + dayOfWeek}`])
          if (eod?.gas_hour) {
            nominationValue = nominationValue / 24 * eod?.gas_hour
          }
        }
      }

      const systemAllocation = eod['value'];
      const previousAllocationTPAforReview = eod['previous_value'];

      const intraFil =
        intradayEviden.find((f: any) => {
          return f?.gasday === eod['gas_day'];
        })?.data || [];
      // console.log('intraFil : ', intraFil);
      const intraFilValue = intraFil.filter((f: any) => {
        return f?.data?.filter((ff: any) => {
          return (
            ff?.contract === eod['contract'] &&
            ff?.shipper === eod['shipper'] &&
            ff?.data?.filter((fff: any) => {
              return fff?.point === eod['data']?.['point'];
            })
          );
        });
      });
      // console.log('intraFilValue : ', intraFilValue);
      const { data: dataIntraDay = null, ...nIntraDay } = intraFilValue.at(-1) ?? {};
      const intradayFind = dataIntraDay?.find((f: any) => {
        return f?.contract === eod['contract'] && f?.shipper === eod['shipper'];
      });
      const { data: dataIntradayFind, ...nIntradayFind } = intradayFind ?? {};
      const intradayData = dataIntradayFind?.find((f: any) => {
        return f?.point === eod['point'];
      });
      const intradayUse = {
        ...nIntraDay,
        ...nIntradayFind,
        data: intradayData,
      };
      const intradaySystem = intradayUse?.data?.value || null; //----
      // console.log('intradaySystem : ', intradaySystem);
      const entry_exit_obj = entryExitMaster.find((f: any) => {
        return f?.name?.toUpperCase() === eod['entry_exit']?.toUpperCase();
      });

      return {
        ...eod,
        nominationValue,
        systemAllocation,
        previousAllocationTPAforReview,
        intradaySystem,
        entry_exit_obj,
      };
    });
    // contract = '2025-CSF-FAT02'
    // shipper = 'NGP-S16-001' PTT id 67
    // console.log('--- nEodPorp : ', nEodPorp);
    // console.log('--- intradayEviden : ', intradayEviden);
    const nEodPorpRes = [];
    for (let iMt = 0; iMt < nEodPorp.length; iMt++) {
      const aMaster = allocationMaster.find((f: any) => {
        return (
          f?.gas_day_text === nEodPorp[iMt]?.gas_day &&
          f?.shipper_name_text === nEodPorp[iMt]?.shipper &&
          f?.contract_code_text === nEodPorp[iMt]?.contract &&
          f?.point_text === nEodPorp[iMt]?.point &&
          f?.entry_exit_text === nEodPorp[iMt]?.entry_exit &&
          f?.area_text === nEodPorp[iMt]?.area &&
          f?.zone_text === nEodPorp[iMt]?.zone
        );
      });

      nEodPorpRes.push({
        ...nEodPorp[iMt],
        id: aMaster?.['id'] || null,
        allocation_status: aMaster?.['allocation_status'] || null,
        review_code: aMaster?.['review_code'] || null,
        allocation_management_comment:
          aMaster?.['allocation_management_comment'] || [],
        allocation_management_shipper_review:
          aMaster?.['allocation_management_shipper_review'] || []
        // aMaster,
      });
    }

    if (tab === '2') {
      // nEodPorpRes
      // f?.gas_day_text === nEodPorp[iMt]?.gas_day &&
      // f?.shipper_name_text === nEodPorp[iMt]?.shipper &&
      // f?.contract_code_text === nEodPorp[iMt]?.contract &&
      // f?.point_text === nEodPorp[iMt]?.point &&
      // f?.entry_exit_text === nEodPorp[iMt]?.entry_exit &&
      // f?.area_text === nEodPorp[iMt]?.area &&
      // f?.zone_text === nEodPorp[iMt]?.zone

    }

    return nEodPorpRes;
  }

  async allocationQueryVersion(payload: any, userId: any) {
    const { start_date, end_date, is_last_version, skip, limit, tab } = payload;

    const start = start_date ? getTodayStartAdd7(start_date) : null;
    const end = end_date ? getTodayEndAdd7(end_date) : null;

    if (!start || !end || !start.isValid() || !end.isValid()) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: '⛔ Invalid date format',
          error: '⛔ Invalid date format',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (end.isBefore(start)) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: '⛔ End date must be after or equal to start date',
          error: '⛔ End date must be after or equal to start date',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const dateArray: string[] = [];

    let current = start;

    while (current.isSameOrBefore(end)) {
      dateArray.push(current.format('YYYY-MM-DD'));
      current = current.add(1, 'day');
    }

    let evidenApiAllocationEod = [];
    let intradayEviden = [];
    intradayEviden = (await Promise.all(dateArray.map(async (date) => {
      try {
        let totalRecord: number | undefined = undefined;
        await this.evidenApiAllocationIntraday({
          gas_day: date,
          start_hour: 1,
          end_hour: 24,
          skip: 0,
          limit: 1,
        }, (total_record: number) => {
          totalRecord = total_record;
        });
        const evidenApiAllocationIntraday = await this.evidenApiAllocationIntraday({
          gas_day: date,
          start_hour: 1,
          end_hour: 24,
          skip: totalRecord ? 0 : skip,
          limit: totalRecord ? totalRecord : limit,
        });
        return evidenApiAllocationIntraday;
      } catch (error) {
        return [];
      }
    }))).flat();

    let totalRecord: number | undefined = undefined;
    await this.evidenApiAllocationEod({
      start_date,
      end_date,
      skip: 0,
      limit: 1,
    }, (total_record: number) => {
      totalRecord = total_record;
    });
    evidenApiAllocationEod = await this.evidenApiAllocationEod({
      start_date,
      end_date,
      skip: totalRecord ? 0 : skip,
      limit: totalRecord ? totalRecord : limit,
    });

    const result = []

    evidenApiAllocationEod.map((item: any) => {
      if (result.some((f: any) => f?.execute_timestamp === item?.execute_timestamp)) return;
      result.push({
        request_number: item?.request_number,
        execute_timestamp: item?.execute_timestamp,
        gas_day: item?.gas_day,
        type: 'eod',
        success: true,
      })
    })

    intradayEviden.map((item: any) => {
      if (result.some((f: any) => f?.execute_timestamp === item?.execute_timestamp)) return;
      result.push({
        request_number: item?.request_number,
        execute_timestamp: item?.execute_timestamp,
        request_number_previous_hour: item?.request_number_previous_hour,
        request_number_eod: item?.request_number_eod,
        gas_day: item?.gas_day,
        gas_hour: item?.gas_hour,
        type: 'intraday',
        success: true,
      })
    })

    return result;
  }

  // point
  async allocationReport(payload: any, userId: any) {
    const { start_date, end_date, skip, limit, tab } = payload;

    const startDate = getTodayStartAdd7(start_date).toDate();
    const endDate = getTodayEndAdd7(end_date).toDate();

    // ถ้าเรียกไปเกินวันที่มี eviden จะ error ต้องรอเขาแก้ก่อน
    const { minDate, maxDate } = await findMinMaxExeDate(this.prisma, start_date, end_date);

    // let data = JSON.stringify({
    //   "start_date":"2025-01-01",
    //   "end_date": "2025-02-28",
    //   "skip": 100, //part 1 = 0, part 2 = 100
    //   "limit": 100
    // });

    //  {
    //     "start_date":"2025-01-01",
    //     "end_date": "2025-02-28",
    //     "start_hour": 1,
    //     "end_hour": 24,
    //     "skip": 700,
    //     //part 1 = 0, part 2 = 100, part 3 = 200, part 4 = 300, part 5 = 400, part 6 = 500, part 7 = 600, part 8 = 700
    //     "limit": 100
    // }

    let evidenApi = [];
    if (tab === '1') {
      let totalRecord: number | undefined = undefined;
      minDate && await this.evidenApiAllocationContractPoint({
        start_date: minDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        end_date: maxDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        skip: 0,
        limit: 1,
      }, (total_record: number) => {
        totalRecord = total_record;
      });
      evidenApi = minDate ? await this.evidenApiAllocationContractPoint({
        // "start_date":"2025-01-01",
        // "end_date": "2025-02-28",
        // "skip": 100,
        // "limit": 100
        start_date: minDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        end_date: maxDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        skip: totalRecord ? 0 : skip,
        limit: totalRecord ? totalRecord : limit,
      }) : []
    }
    else {
      let totalRecord: number | undefined = undefined;
      minDate && await this.evidenApiAllocationContractPointIntraday({
        start_date: minDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        end_date: maxDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        skip: 0,
        limit: 1,
      }, (total_record: number) => {
        totalRecord = total_record;
      });
      console.log('evidenApi : ', evidenApi);
      evidenApi = minDate ? await this.evidenApiAllocationContractPointIntraday({
        start_date: minDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        end_date: maxDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        skip: totalRecord ? 0 : skip,
        limit: totalRecord ? totalRecord : limit,
      }) : []
    }

    console.log('evidenApi : ', evidenApi);

    const entryExitMaster = await this.prisma.entry_exit.findMany({
      where: {},
    });

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

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

    // Extract gas days and generate date array
    const dateArray = extractAndGenerateDateArray(evidenApi);

    // Build active data for all dates
    const activeData = await buildActiveDataForDates(
      dateArray,
      this.prisma
    );

    const newEOD = evidenApi?.flatMap((fm: any) => {
      const { data: data1, ...fmD } = fm;

      // Find active data for this gas_day
      const activeDataForDate = activeData.find((ad) => ad.date === fm.gas_day);

      const nData = data1?.flatMap((dFm: any) => {
        const { data: data2, ...fmD2 } = dFm;

        // Validate contract and shipper existence
        const contractValidation = validateContractAndShipper(dFm, activeDataForDate);
        // if (!contractValidation.isValid) {
        //   return [];
        // }

        const nData2 = data2
          // .filter((dFm2: any) => {
          //   return validatePointByType(dFm2, activeDataForDate);
          // })
          .map((dFm2: any) => {
            validatePointByType(dFm2, activeDataForDate);
            return { ...fmD, ...fmD2, ...dFm2, group: contractValidation.shipperObj };
          });

        return [...nData2];
      });

      return [...nData];
    }) || [];

    const resultEodLast: any = tab === '1' ? Object.values(
      newEOD.reduce((acc, curr) => {
        const key = `${curr.gas_day}|${curr.shipper}|${curr.contract}|${curr.point}|${curr.entry_exit}|${curr.area}|${curr.zone}`;
        if (!acc[key] || acc[key].execute_timestamp < curr.execute_timestamp) {
          acc[key] = curr;
        }
        return acc;
      }, {}),
    ) : Object.values(
      newEOD.reduce((acc, curr) => {
        const key = `${curr.gas_day}|${curr.gas_hour}|${curr.shipper}|${curr.contract}|${curr.point}|${curr.entry_exit}|${curr.area}|${curr.zone}|${curr.execute_timestamp}`;
        if (!acc[key]) {
          acc[key] = curr;
        }
        return acc;
      }, {}),
    );

    // db
    const allocationReportWhere: Prisma.allocation_reportWhereInput = {
      OR: [
        {
          gas_day: {
            gte: startDate,
            lte: endDate,
          }
        },
        {
          gas_day_text: {
            in: dateArray,
          },
        },
      ]
    }
    let allocationReport = await this.prisma.allocation_report.findMany({
      where: allocationReportWhere,
      include: {},
    });

    const newAllocation = [];

    for (let i = 0; i < resultEodLast.length; i++) {
      const findAllocationReport = allocationReport.find((f: any) => {
        return (
          f?.gas_day_text === resultEodLast[i]?.gas_day &&
          f?.shipper_name_text === resultEodLast[i]?.shipper &&
          f?.contract_code_text === resultEodLast[i]?.contract &&
          f?.point_text === resultEodLast[i]?.contract_point &&
          f?.entry_exit_text === resultEodLast[i]?.entry_exit &&
          f?.area_text === resultEodLast[i]?.area &&
          f?.zone_text === resultEodLast[i]?.zone
        );
      });

      if (!findAllocationReport) {
        newAllocation.push({
          shipper_name_text: resultEodLast[i]?.shipper,
          gas_day_text: resultEodLast[i]?.gas_day,
          contract_code_text: resultEodLast[i]?.contract,
          point_text: resultEodLast[i]?.contract_point,
          entry_exit_text: resultEodLast[i]?.entry_exit,
          area_text: resultEodLast[i]?.area,
          zone_text: resultEodLast[i]?.zone,

          gas_day: getTodayNowYYYYMMDDDfaultAdd7(
            resultEodLast[i]?.gas_day + 'T00:00:00Z',
          ).toDate(),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by: Number(userId),
        });
      }
    }

    if (newAllocation.length > 0) {
      // create
      await this.prisma.allocation_report.createMany({
        data: newAllocation,
      });

      allocationReport = await this.prisma.allocation_report.findMany({
        where: allocationReportWhere,
        include: {},
      });
    }

    const publicationCenter = await this.publicationCenter();

    const newEODF = await Promise.all(resultEodLast?.map(async (eod: any) => {
      const contractCapacity =
        eod['values']?.find((f: any) => f?.tag === 'contractCapacity')?.value ??
        null;
      const nominationValue =
        eod['values']?.find((f: any) => f?.tag === 'nominatedValue')?.value ??
        null;
      const allocatedValue =
        eod['values']?.find((f: any) => f?.tag === 'allocatedValue')?.value ??
        null;
      const overusage =
        eod['values']?.find((f: any) => f?.tag === 'overusage')?.value ?? null;
      const intradaySystemAllocation = null;

      const entry_exit_obj = entryExitMaster.find((f: any) => {
        return f?.name?.toUpperCase() === eod['entry_exit']?.toUpperCase();
      });

      const area_obj = areaMaster.find((f: any) => {
        const entx = eod['entry_exit']?.toUpperCase() === "ENTRY" ? 1 : 2
        return f?.name?.toUpperCase() === eod['area']?.toUpperCase() && f?.entry_exit_id === entx;
      });

      // --- area

      const findAllocationReport = allocationReport.find((f: any) => {
        return (
          f?.gas_day_text === eod?.['gas_day'] &&
          f?.shipper_name_text === eod?.['shipper'] &&
          f?.contract_code_text === eod?.['contract'] &&
          f?.point_text === eod?.['contract_point'] &&
          f?.entry_exit_text === eod?.['entry_exit'] &&
          f?.area_text === eod?.['area'] &&
          f?.zone_text === eod?.['zone']
        );
      });

      const { values, ...nEod } = eod;
      let isNotExitInDb = false
      const findPublication = publicationCenter.find((f: any) => {
        return (
          f?.execute_timestamp === eod['execute_timestamp'] &&
          f?.gas_day_text === eod['gas_day'] &&
          (eod['gas_hour'] ? f?.gas_hour === eod['gas_hour'] : f?.gas_hour == null)
        );
      });

      if (!findPublication) {
        const publicationCenter = await this.prisma.publication_center.findMany({
          where: {
            execute_timestamp: eod['execute_timestamp'],
            gas_day_text: eod['gas_day'],
            gas_hour: (eod['gas_hour'] ? eod['gas_hour'] : null)
          },
        })

        isNotExitInDb = publicationCenter.length < 1
      }

      return {
        publication: !!findPublication || isNotExitInDb,
        id: findAllocationReport?.id,
        ...eod,
        contractCapacity,
        nominationValue,
        allocatedValue,
        overusage,
        intradaySystemAllocation,
        entry_exit_obj: entry_exit_obj || null,
        area_obj: area_obj || null,
      };
    }));

    return newEODF;
  }

  async publicationCenter(payload?: any, userId?: any) {
    const resData = await this.prisma.publication_center.findMany({
      where: {
        OR: [
          {
            del_flag: null,
          },
          {
            del_flag: false,
          }
        ],
      },
    });

    return resData;
  }

  async publicationCenterGen(payload: any, userId: any) {
    const { execute_timestamp, gas_day, gas_hour } = payload;

    const resData = await this.prisma.publication_center.findFirst({
      where: {
        execute_timestamp: execute_timestamp,
        gas_day_text: gas_day,
        gas_hour: gas_hour ? gas_hour : null,
      },
    });
    const nowAt = getTodayNowAdd7();

    if (resData) {
      // del_flag
      console.log('d');
      await this.prisma.publication_center.updateMany({
        where: {
          execute_timestamp: execute_timestamp,
          gas_day_text: gas_day,
          gas_hour: gas_hour ? gas_hour : null,
        },
        data: {
          update_date: nowAt.toDate(),
          update_date_num: nowAt.unix(),
          update_by: Number(userId),
          del_flag: resData.del_flag != true ? true : null,
        },
      });
    } else {
      console.log('c');
      // create
      await this.prisma.publication_center.create({
        data: {
          execute_timestamp: execute_timestamp,
          gas_day_text: gas_day,
          gas_day: getTodayNowYYYYMMDDDfaultAdd7(gas_day).toDate(),
          gas_hour: gas_hour ? gas_hour : null,
          create_date: nowAt.toDate(),
          create_date_num: nowAt.unix(),
          create_by: Number(userId),
          del_flag: true
        },
      });
    }

    return payload;
  }

  async allocationReportView(payload: any, userId: any) {
    const {
      start_date,
      end_date,
      skip,
      limit,
      tab,
      contract,
      shipper,
      gas_day,
      id,
    } = payload;

    let evidenApi = [];
    if (tab === '1') {
      let totalRecord: number | undefined = undefined;
      await this.evidenApiAllocationContractPointByNom({
        start_date,
        end_date,
        skip: 0,
        limit: 1,
      }, (total_record: number) => {
        totalRecord = total_record;
      });
      evidenApi = await this.evidenApiAllocationContractPointByNom({
        start_date,
        end_date,
        skip: totalRecord ? 0 : skip,
        limit: totalRecord ? totalRecord : limit,
      });
    }
    else {
      let totalRecord: number | undefined = undefined;
      await this.evidenApiAllocationContractPointIntradayByNom({
        start_date,
        end_date,
        skip: 0,
        limit: 1,
      }, (total_record: number) => {
        totalRecord = total_record;
      });
      evidenApi = await this.evidenApiAllocationContractPointIntradayByNom({
        start_date,
        end_date,
        skip: totalRecord ? 0 : skip,
        limit: totalRecord ? totalRecord : limit,
      });
    }

    const entryExitMaster = await this.prisma.entry_exit.findMany({
      where: {},
    });

    const start = start_date ? getTodayStartAdd7(start_date) : null;
    const end = end_date ? getTodayEndAdd7(end_date) : null;

    if (!start || !end || !start.isValid() || !end.isValid()) {
      throw new Error('⛔ Invalid date format');
    }

    if (end.isBefore(start)) {
      throw new Error('⛔ End date must be after or equal to start date');
    }

    // Extract gas days and generate date array
    const dateArray = extractAndGenerateDateArray(evidenApi);

    // Build active data for all dates
    const activeData = await buildActiveDataForDates(
      dateArray,
      this.prisma
    );

    const newEOD = evidenApi?.flatMap((fm: any) => {
      const { data: data1, ...fmD } = fm;

      // Find active data for this gas_day
      const activeDataForDate = activeData.find((ad) => ad.date === fm.gas_day);

      const nData = data1?.flatMap((dFm: any) => {
        const { data: data2, ...fmD2 } = dFm;

        // Validate contract and shipper existence
        const contractValidation = validateContractAndShipper(dFm, activeDataForDate);
        // if (!contractValidation.isValid) {
        //   return [];
        // }

        const nData2 = data2
          // .filter((dFm2: any) => {
          //   return validatePointByType(dFm2, activeDataForDate);
          // })
          .map((dFm2: any) => {
            validatePointByType(dFm2, activeDataForDate);
            return { ...fmD, ...fmD2, ...dFm2, group: contractValidation.shipperObj };
          });

        return [...nData2];
      });

      return [...nData];
    }) || [];

    const resultEodLast1: any = Object.values(
      newEOD.reduce((acc, curr) => {
        const key = `${curr.gas_day}|${curr.shipper}|${curr.contract}|${curr.point}|${curr.entry_exit}|${curr.area}|${curr.zone}`;
        if (!acc[key] || acc[key].execute_timestamp < curr.execute_timestamp) {
          acc[key] = curr;
        }
        return acc;
      }, {}),
    );

    //  db
    const resultEodLast = resultEodLast1?.filter((f: any) => {
      return (
        ((!contract || contract == 'undefined' || contract == 'null') || f?.contract === contract) &&
        ((!shipper || shipper == 'undefined' || shipper == 'null') || f?.shipper === shipper) &&
        ((!gas_day || gas_day == 'undefined' || gas_day == 'null') || f?.gas_day === gas_day)
      );
    });
    let allocationReportView =
      await this.prisma.allocation_report_view.findMany({
        include: {},
      });

    const newAllocation = [];

    for (let i = 0; i < resultEodLast.length; i++) {
      const findAllocationReport = allocationReportView.find((f: any) => {
        return (
          f?.allocation_report_id === Number(id) &&
          f?.gas_day_text === resultEodLast[i]?.gas_day &&
          f?.shipper_name_text === resultEodLast[i]?.shipper &&
          f?.contract_code_text === resultEodLast[i]?.contract &&
          f?.point_text === resultEodLast[i]?.point &&
          f?.entry_exit_text === resultEodLast[i]?.entry_exit &&
          f?.area_text === resultEodLast[i]?.area &&
          f?.zone_text === resultEodLast[i]?.zone
        );
      });

      if (!findAllocationReport) {
        newAllocation.push({
          allocation_report_id: Number(id),
          shipper_name_text: resultEodLast[i]?.shipper,
          gas_day_text: resultEodLast[i]?.gas_day,
          contract_code_text: resultEodLast[i]?.contract,
          point_text: resultEodLast[i]?.point,
          entry_exit_text: resultEodLast[i]?.entry_exit,
          area_text: resultEodLast[i]?.area,
          zone_text: resultEodLast[i]?.zone,

          gas_day: getTodayNowYYYYMMDDDfaultAdd7(
            resultEodLast[i]?.gas_day + 'T00:00:00Z',
          ).toDate(),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by: Number(userId),
        });
      }
    }

    if (newAllocation.length > 0) {
      // create
      await this.prisma.allocation_report_view.createMany({
        data: newAllocation,
      });

      allocationReportView = await this.prisma.allocation_report_view.findMany({
        include: {},
      });
    }

    const newEODF = resultEodLast?.map((eod: any) => {
      const contractCapacity =
        eod['values']?.find((f: any) => f?.tag === 'contractCapacity')?.value ??
        null;
      const nominationValue =
        eod['values']?.find((f: any) => f?.tag === 'nominatedValue')?.value ??
        null;
      const allocatedValue =
        eod['values']?.find((f: any) => f?.tag === 'allocatedValue')?.value ??
        null;
      // const overusage = eod['values']?.find((f:any) => f?.tag === "overusage")?.value ?? null
      // const intradaySystemAllocation = null

      const entry_exit_obj = entryExitMaster.find((f: any) => {
        return f?.name?.toUpperCase() === eod['entry_exit']?.toUpperCase();
      });

      const findAllocationReport = allocationReportView.find((f: any) => {
        return (
          f?.allocation_report_id === Number(id) &&
          f?.gas_day_text === eod?.['gas_day'] &&
          f?.shipper_name_text === eod?.['shipper'] &&
          f?.contract_code_text === eod?.['contract'] &&
          f?.point_text === eod?.['point'] &&
          f?.entry_exit_text === eod?.['entry_exit'] &&
          f?.area_text === eod?.['area'] &&
          f?.zone_text === eod?.['zone']
        );
      });

      const { values, ...nEod } = eod;

      return {
        id: findAllocationReport?.id,
        ...eod,
        contractCapacity,
        nominationValue,
        allocatedValue,
        // overusage,
        // intradaySystemAllocation,
        entry_exit_obj,
      };
    });
    // contract_point
    // point_type
    return newEODF;
  }

  getMinMaxDatesFromArray(dates: string[]): { min: string; max: string } {
    const sorted = dates
      .map((date) => dayjs(date, 'DD/MM/YYYY'))
      .sort((a, b) => a.unix() - b.unix());

    const min = sorted[0].format('DD/MM/YYYY');
    const max = sorted[sorted.length - 1].format('DD/MM/YYYY');

    return { min, max };
  }

  async genExcelTemplate(payload: any) {
    const { contract_code_name, shipper_code } = payload;
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    // const weeklyPrev7 = this.getPrev7Dates();
    const weeklyPrev7 = this.getPrev7DatesMinut1();
    // ของจริงเปิด
    const { min: start_date, max: end_date } = this.getMinMaxDatesFromArray(weeklyPrev7)
    // const start_date = '2025-01-01';
    // const end_date = '2025-02-28';

    const evidenApiAllocationEod = await this.evidenApiAllocationEod({
      start_date: dayjs(start_date, "DD/MM/YYYY").format("YYYY-MM-DD"),
      end_date: dayjs(end_date, "DD/MM/YYYY").format("YYYY-MM-DD"),
      skip: 0,
      limit: 1000,
      // skip: 100,
      // limit: 100,
    });


    const newEOD = evidenApiAllocationEod.flatMap((fm: any) => {
      const { data: data1, ...fmD } = fm;

      const nData = data1?.flatMap((dFm: any) => {
        const { data: data2, ...fmD2 } = dFm;
        const nData2 = data2.map((dFm2: any) => {
          return { ...fmD, ...fmD2, ...dFm2 };
        });

        return [...nData2];
      });

      return [...nData];
    });

    const resultEodLast1: any = Object.values(
      newEOD.reduce((acc, curr) => {
        const key = `${curr.gas_day}|${curr.shipper}|${curr.contract}|${curr.point}|${curr.entry_exit}|${curr.area}|${curr.zone}`;
        if (!acc[key] || acc[key].execute_timestamp < curr.execute_timestamp) {
          acc[key] = curr;
        }
        return acc;
      }, {}),
    );
    const eodApi = resultEodLast1.filter((f: any) => {
      return f?.contract === contract_code_name && f?.shipper === shipper_code;
    });
    // const eodApiFil = eodApi.map(({ zone, area, point, entry_exit }) => ({ zone, area, point, unit: "MMBTU/D", entry_exit }))
    const eodApiFil = Array.from(
      new Map(
        eodApi.map(({ zone, area, point, entry_exit }) => {
          const key = `${zone}|${area}|${point}|${entry_exit}`;
          return [key, { zone, area, point, unit: 'MMBTU/D', entry_exit }];
        }),
      ).values(),
    );

    return this.genExcelTemplateFinal({
      todayStart,
      todayEnd,
      weeklyPrev7,
      contract_code_name,
      shipper_code,
      eodApi: eodApiFil,
    });
  }

  getPrev7Dates() {
    const today = dayjs();

    // สร้าง array 7 วันย้อนหลัง (รวมวันนี้)
    const weekDates = Array.from({ length: 7 }, (_, i) =>
      today.add(i - 6, 'day').format('DD/MM/YYYY'),
    );

    return weekDates;
  }

  getPrev7DatesMinut1() {
    const today = dayjs().subtract(1, "day");

    // สร้าง array 7 วันย้อนหลัง (รวมวันนี้)
    const weekDates = Array.from({ length: 7 }, (_, i) =>
      today.add(i - 6, 'day').format('DD/MM/YYYY'),
    );

    return weekDates;
  }

  async componentGenExcelAllocation(
    data: any,
    data2: any,
    data3: any,
    typeOfNomination: any,
  ) {
    // สร้าง workbook และ worksheet
    const workbook = XLSX.utils.book_new(); // สร้าง workbook ใหม่
    const worksheet1 = XLSX.utils.aoa_to_sheet(data); // สร้าง sheet จาก array ของ array
    // const worksheet2 = XLSX.utils.aoa_to_sheet(data2); // สร้าง sheet จาก array ของ array
    // const worksheet3 = XLSX.utils.aoa_to_sheet(data3); // สร้าง sheet จาก array ของ array
    XLSX.utils.book_append_sheet(workbook, worksheet1, typeOfNomination); // เพิ่ม sheet ลงใน workbook
    // XLSX.utils.book_append_sheet(workbook, worksheet2, 'Quality'); // เพิ่ม sheet ลงใน workbook
    // XLSX.utils.book_append_sheet(workbook, worksheet3, 'Lists'); // เพิ่ม sheet ลงใน workbook
    const defaultColumnWidth = 20; // กำหนดค่าความกว้างมาตรฐานที่ต้องการ
    const defaultColumnWidthSheet2 = 10; // กำหนดค่าความกว้างมาตรฐานที่ต้องการ

    Object.keys(worksheet1).forEach((cell) => {
      const rowNumber = parseInt(cell.replace(/[^0-9]/g, '')); // ดึงเลขแถวออกมา
      const columnLetter = cell.replace(/[0-9]/g, '');

      if (
        worksheet1[cell] &&
        typeof worksheet1[cell] === 'object' &&
        cell[0] !== '!'
      ) {
        worksheet1[cell].z = '@'; // ใช้รูปแบบ '@' เพื่อระบุว่าเป็น Text
        worksheet1[cell].t = 's';
        worksheet1['!cols'] = Array(30)
          .fill(null)
          .map((_, index) => ({
            wch: index === 5 ? 25 : defaultColumnWidth, // คอลัมน์แรก (A) กว้าง 25, ที่เหลือกว้าง 20
          }));

        // ✅ ถ้า row 2 และเซลล์มีข้อมูล ให้ใส่สีพื้นหลังดำและข้อความสีขาว
        if (rowNumber === 2 && worksheet1[cell].v) {
          worksheet1[cell].s = worksheet1[cell].s || {}; // ตรวจสอบว่าเซลล์มี object style หรือไม่
          worksheet1[cell].s.fill = {
            patternType: 'solid', // ✅ เติมสีพื้นหลังแบบทึบ
            fgColor: { rgb: '000000' }, // ✅ สีพื้นหลังดำ (Black)
          };
          worksheet1[cell].s.font = {
            color: { rgb: 'FFFFFF' }, // ✅ สีข้อความเป็นสีขาว (White)
            bold: true, // ✅ ทำให้ตัวอักษรหนา
          };
        }
        // ✅ ถ้า row 4 และเซลล์มีข้อมูล ให้ใส่สีพื้นหลังดำและข้อความสีขาว
        if (rowNumber === 4 && worksheet1[cell].v) {
          worksheet1[cell].s = worksheet1[cell].s || {}; // ตรวจสอบว่าเซลล์มี object style หรือไม่
          worksheet1[cell].s.fill = {
            patternType: 'solid', // ✅ เติมสีพื้นหลังแบบทึบ
            fgColor: { rgb: '000000' }, // ✅ สีพื้นหลังดำ (Black)
          };
          worksheet1[cell].s.font = {
            color: { rgb: 'FFFFFF' }, // ✅ สีข้อความเป็นสีขาว (White)
            bold: true, // ✅ ทำให้ตัวอักษรหนา
          };
        }
        // ✅ ค้นหาแถวสุดท้ายที่มีข้อมูล
        const lastRowWithData = Math.max(
          ...Object.keys(worksheet1)
            .map((c) => parseInt(c.replace(/[^0-9]/g, ''), 10))
            .filter((n) => !isNaN(n)),
        );
        // ✅ ตั้งค่าขอบเขต (Border) สำหรับทุกเซลล์ตั้งแต่แถวที่ 5 เป็นต้นไป
        if (rowNumber >= 5) {
          worksheet1[cell].s = worksheet1[cell].s || {};
          worksheet1[cell].s.border = worksheet1[cell].s.border || {};

          // ✅ ใส่เส้นแนวตั้ง (ทุกแถว)
          worksheet1[cell].s.border.left = { style: 'thin' };
          worksheet1[cell].s.border.right = { style: 'thin' };

          // ✅ ใส่เส้นแนวนอนเฉพาะแถวสุดท้ายที่มีข้อมูล
          if (rowNumber === lastRowWithData) {
            worksheet1[cell].s.border.bottom = { style: 'thin' };
          }
        }
      }
    });

    // http://10.100.101.15:8010/master/upload-template-for-shipper/gen-excel-template
    const excelBuffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    });

    // ส่ง buffer กลับไปเพื่อให้ controller สามารถใช้งานต่อไปได้
    return excelBuffer;
  }

  async genExcelTemplateFinal(payload: any) {
    const {
      todayStart,
      todayEnd,
      weeklyPrev7,
      contract_code_name,
      shipper_code,
      eodApi,
    } = payload;


    // ***************************

    const eodData = eodApi.flatMap((e: any) => {
      return [
        [
          e?.zone || '',
          e?.area || '',
          e?.point || '',
          e?.unit || '',
          e?.entry_exit || '',
          ...Array(weeklyPrev7.length).fill(''),
        ],
      ];
    });

    const data = [
      [], // Row 0
      ['SHIPPER ID', 'CONTRACT CODE'], // Row 1
      [`${shipper_code}`, `${contract_code_name}`], // Row 2
      [...headAllo, ...weeklyPrev7], // Row 3
      ...eodData,
    ];

    const excelBuffer = await this.componentGenExcelAllocation(
      data,
      [],
      [],
      'Allocation Review',
    );

    // ส่ง buffer กลับไปเพื่อให้ controller สามารถใช้งานต่อไปได้
    return { excelBuffer, nameFile: `Allocation_Review` };
  }

  // MMSCFD
  // Only MMBTU/D unit is allowed, other units ignored.
  async uploadFile(grpcTransform: any, file: any, userId: any, req: any, isSaveByIgnoreWaring: boolean) {

    const dataStartAtRow = 5

    const createByOnce = await this.createByOnce(
      userId,
    );

    // const todayStart = getTodayStartAdd7().toDate();
    // const todayEnd = getTodayEndAdd7().toDate();

    // const activeNominationPoints = await this.prisma.nomination_point.findMany({
    //       where: {
    //         OR: [{ end_date: null }, { end_date: { gt: todayStart } }],
    //         start_date: { lte: todayEnd },
    //       },
    //       include: {
    //         area: {
    //           select: {
    //             name: true,
    //           },
    //         },
    //         zone: {
    //           select: {
    //             name: true,
    //           },
    //         },
    //         contract_point_list: {
    //           select: {
    //             contract_point: true,
    //           },
    //         },
    //         metering_point: true
    //       },
    // })

    const allocationManage = await this.prisma.allocation_management.findMany({
      where: {
        allocation_status_id: 3,
      }
    })



    const convertSheet = grpcTransform?.jsonDataMultiSheet ? this.safeParseJSON(grpcTransform.jsonDataMultiSheet) : null;
    const sheet =
      convertSheet?.find((f: any) => f?.sheet === 'Allocation Review')?.data ||
      [];
    const shipperIdSheet = sheet[1]['0'];
    const contractCodeSheet = sheet[1]['1'];
    const headSheet = sheet[2];
    if (!headSheet || Object.keys(headSheet).length < 5 || !isMatch(headSheet['0'], 'Zone') || !isMatch(headSheet['1'], 'Area') || !isMatch(headSheet['2'], 'POINT_ID') || !isMatch(headSheet['3'], 'Unit') || !isMatch(headSheet['4'], 'Entry_Exit')) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: 'Missing required columns, Please check the file structure.',
          error: 'Missing required columns, Please check the file structure.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const lastKey = Math.max(...Object.keys(headSheet).map(Number));
    const resultKeyEnd = Object.keys(headSheet)
      .filter((key) => Number(key) >= 5)
      .reduce(
        (acc, key) => {
          acc[key] = headSheet[key];
          return acc;
        },
        {} as Record<string, string>,
      );
    const resultDateKey = Object.entries(resultKeyEnd).map(([key, date]) => ({
      key: Number(key),
      date,
    }));

    const validateList = []
    const dateArr = resultDateKey?.map((e: any) => {
      if (!dayjs(e?.date?.trim(), "DD/MM/YYYY").isValid()) {
        validateList.push(`${e?.date} is invalid gas day format.`)
      }
      return e?.date
    });

    // 3 เช็ค วัน ซ้ำ
    const hasDuplicate = new Set(dateArr).size !== dateArr.length;
    if (hasDuplicate) {
      validateList.push('Date should not overlap.')
    }
    // 4 max วัน ไม่เกิน 31
    if (dateArr.length >= 31) {
      validateList.push('Date should not over max 31 day.')
    }

    // 5 -> lastKey 11
    const valueSheet = sheet.slice(3);

    // ดึง
    // 1 MMBTU/D
    const checkNotMMBTUD = valueSheet?.find(
      (f: any) => f?.['3'] !== 'MMBTU/D',
    );

    if (checkNotMMBTUD) {
      validateList.push('Only MMBTU/D unit is allowed, other units ignored.')
    }

    if (validateList.length > 0) {
      const message = validateList.join('<br/>');
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          key: message,
          error: message,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const { min: start_date, max: end_date } = this.getMinMaxDatesFromArray(dateArr)
    // const start_date = '2025-01-01';
    // const end_date = '2025-02-28';
    const evidenApiAllocationEod = await this.evidenApiAllocationEod({
      start_date: dayjs(start_date, "DD/MM/YYYY").format("YYYY-MM-DD"),
      end_date: dayjs(end_date, "DD/MM/YYYY").format("YYYY-MM-DD"),
      skip: 0,
      limit: 1000,
    });

    // Extract gas days and generate date array
    const dateArray = extractAndGenerateDateArray(evidenApiAllocationEod);

    // Build active data for all dates
    const activeData = await buildActiveDataForDates(
      dateArray,
      this.prisma
    );

    const newEOD = evidenApiAllocationEod.flatMap((fm: any) => {
      const { data: data1, ...fmD } = fm;

      const nData = data1?.flatMap((dFm: any) => {
        const { data: data2, ...fmD2 } = dFm;
        const nData2 = data2.map((dFm2: any) => {
          return { ...fmD, ...fmD2, ...dFm2 };
        });

        return [...nData2];
      });

      return [...nData];
    });

    const resultEodLast1: any = Object.values(
      newEOD.reduce((acc, curr) => {
        const key = `${curr.gas_day}|${curr.shipper}|${curr.contract}|${curr.point}|${curr.entry_exit}|${curr.area}|${curr.zone}`;
        if (!acc[key] || acc[key].execute_timestamp < curr.execute_timestamp) {
          acc[key] = curr;
        }
        return acc;
      }, {}),
    );

    const eodApi = resultEodLast1.filter((f: any) => {
      return f?.contract === contractCodeSheet && f?.shipper === shipperIdSheet;
    });

    const valueSheetMMBTU = valueSheet//?.filter((f: any) => f?.['3'] === 'MMBTU/D',);
    // 2 s,c ใน วันมีไหม
    const checkGasdayShipperContractCk = eodApi?.find((f: any) => {
      return (
        shipperIdSheet &&
        f?.contract &&
        contractCodeSheet
      );
    });
    if (!checkGasdayShipperContractCk) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          // error: `Date is not match`,
          error: `Contract Code & Shipper does not match`,
          // error: `${logErr.map((e: any) => e).join(',')}`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const checkGasdayShipperContract = eodApi?.find((f: any) => {
      return (
        dateArr.includes(
          dayjs(f?.gas_day, 'YYYY-MM-DD').format('DD/MM/YYYY'),
        ) &&
        f?.shipper &&
        shipperIdSheet &&
        f?.contract &&
        contractCodeSheet
      );
    });
    if (!checkGasdayShipperContract) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: `Date is not match`,
          // error: `Contract Code && Shipper does not match`,
          // error: `${logErr.map((e: any) => e).join(',')}`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const logWarning: any = [];
    const dataUseDB: any = [];
    let warningArr: any = [];
    // warning
    // 5 เช็ค ข้อมูลใน row ว่ามีตรงไหม วันไหนไม่มี warning
    for (let i = 0; i < valueSheetMMBTU.length; i++) {
      const zone = valueSheetMMBTU[i]['0'] || "";
      const area = valueSheetMMBTU[i]['1'] || "";
      const point = valueSheetMMBTU[i]['2'] || "";
      const unit = valueSheetMMBTU[i]['3'] || "";
      const entry_exit = valueSheetMMBTU[i]['4'] ? valueSheetMMBTU[i]['4']?.toUpperCase() : "";

      if (unit != 'MMBTU/D') {
        continue;
      }

      const resultDateValue = Object.entries(valueSheetMMBTU[i])
        .filter(([key]) => {
          const numKey = parseInt(key, 10);
          return numKey >= 5 && numKey <= lastKey;
        })
        .map(([key, value]) => ({
          key,
          value,
        }));

      if (resultDateValue.length === 0) continue;
      for (let iDate = 0; iDate < resultDateValue.length; iDate++) {
        const dateConvertKey = resultDateKey?.find((f: any) => {
          return f?.key === Number(resultDateValue[iDate]['key']);
        });
        const activeDataForDate = activeData.find((ad) => getTodayNowYYYYMMDDDfaultAdd7(ad.date).format('DD/MM/YYYY') === dateConvertKey?.date);
        const findNomMaster = activeDataForDate?.activeNominationPoints?.find((f: any) => f?.nomination_point === point)
        const activeConceptPoint = activeDataForDate?.activeConceptPoints?.find((f: any) => f?.concept_point === point)
        if (findNomMaster) {
          let isWarning = false;
          if (!isMatch(findNomMaster?.zone?.name, zone)) {
            warningArr.push(`Invalid Zone on ${dateConvertKey?.date} in row ${i + dataStartAtRow} ; not saved.`)
            isWarning = true;
          }
          if (!isMatch(findNomMaster?.area?.name, area)) {
            warningArr.push(`Invalid Area on ${dateConvertKey?.date} in row ${i + dataStartAtRow} ; not saved.`)
            isWarning = true;
          }
          if (!isMatch(findNomMaster?.entry_exit?.name, entry_exit)) {
            warningArr.push(`Invalid Entry/Exit on ${dateConvertKey?.date} in row ${i + dataStartAtRow} ; not saved.`)
            isWarning = true;
          }
          if (isWarning) {
            continue;
          }
        }
        else if (!activeConceptPoint) {
          warningArr.push(`Invalid POINT_ID on ${dateConvertKey?.date} in row ${i + dataStartAtRow} ; not saved.`)
          continue;
        }
        const dateValue = resultDateValue[iDate]['value'];
        const eodApiCheck = eodApi?.find((f: any) => {
          return (
            f?.zone === zone &&
            f?.area === area &&
            f?.point === point &&
            f?.entry_exit === entry_exit &&
            dayjs(f?.gas_day, 'YYYY-MM-DD').format('DD/MM/YYYY') ===
            dateConvertKey?.date
          );
        });

        const findAllocationAccept = allocationManage?.find((f: any) => {
          return (
            f?.point_text === eodApiCheck?.point &&
            f?.gas_day_text === eodApiCheck?.gas_day &&
            f?.zone_text === eodApiCheck?.zone &&
            f?.area_text === eodApiCheck?.area &&
            f?.entry_exit_text === eodApiCheck?.entry_exit
          )
        })

        if (eodApiCheck && (findNomMaster || activeConceptPoint) && !findAllocationAccept) {
          console.log('มี');
          const notData = {
            shipperIdSheet,
            contractCodeSheet,
            zone,
            area,
            point,
            unit: valueSheetMMBTU[i]['3'],
            entry_exit,
            gas_day: dayjs(dateConvertKey?.date, 'DD/MM/YYYY').format(
              'YYYY-MM-DD',
            ),
            value: dateValue,
            system_allocation: eodApiCheck.value,
            previous_value: eodApiCheck.previous_value
          };
          dataUseDB.push(notData);
        } else {
          if (eodApiCheck && (findNomMaster || activeConceptPoint) && findAllocationAccept) {
            // https://app.clickup.com/t/86eu48dnq
            warningArr.push(`Point ${eodApiCheck?.point} on ${dateConvertKey?.date} has already been accepted and will not be imported`)
          } else if (eodApiCheck && !findNomMaster && !activeConceptPoint) {
            warningArr.push(`Point ${eodApiCheck?.point} is inactive on ${dateConvertKey?.date} , valid rows saved.`)
          } else {
            const notData = {
              shipperIdSheet,
              contractCodeSheet,
              zone,
              area,
              point,
              unit: valueSheetMMBTU[i]['3'],
              entry_exit,
              gas_day: dayjs(dateConvertKey?.date, 'DD/MM/YYYY').format(
                'YYYY-MM-DD',
              ),
              value: dateValue,
              note: 'not have eviden',
            };
            logWarning.push(notData);
          }
        }

      }
    }
    const dataDb = [];
    if (dataUseDB.length > 0) {
      const allocationCheck = await this.prisma.allocation_management.findMany({
        where: {},
      });
      for (let i = 0; i < dataUseDB.length; i++) {
        const findAllo = allocationCheck?.find((f: any) => {
          return (
            f?.zone_text === dataUseDB[i]?.zone &&
            f?.area_text === dataUseDB[i]?.area &&
            f?.point_text === dataUseDB[i]?.point &&
            f?.entry_exit_text === dataUseDB[i]?.entry_exit &&
            f?.shipper_name_text === dataUseDB[i]?.shipperIdSheet &&
            f?.contract_code_text === dataUseDB[i]?.contractCodeSheet &&
            f?.gas_day_text === dataUseDB[i]?.gas_day
          );
        });
        if (findAllo) {
          if (findAllo?.allocation_status_id === 3) {
            // accept ห้าม update ให้ warning
            const notData = {
              shipperIdSheet,
              contractCodeSheet,
              zone: dataUseDB[i]?.zone,
              area: dataUseDB[i]?.area,
              point: dataUseDB[i]?.point,
              unit: dataUseDB[i]?.unit,
              entry_exit: dataUseDB[i]?.entry_exit,
              gas_day: dataUseDB[i]?.gas_day,
              value: dataUseDB[i]?.value,
              note: 'not have update status accept',
            };
            logWarning.push(notData);
          } else {
            // update status 2
            const notData = {
              id: findAllo?.id,
              shipperIdSheet,
              contractCodeSheet,
              zone: dataUseDB[i]?.zone,
              area: dataUseDB[i]?.area,
              point: dataUseDB[i]?.point,
              unit: dataUseDB[i]?.unit,
              entry_exit: dataUseDB[i]?.entry_exit,
              gas_day: dataUseDB[i]?.gas_day,
              value: dataUseDB[i]?.value,
              note: 'update',
              system_allocation: dataUseDB[i]?.system_allocation,
              previous_value: dataUseDB[i]?.previous_value
            };
            dataDb.push(notData);
          }
        } else {
          // ไม่มี ให้ create & update status 2
          const notData = {
            id: null,
            shipperIdSheet,
            contractCodeSheet,
            zone: dataUseDB[i]?.zone,
            area: dataUseDB[i]?.area,
            point: dataUseDB[i]?.point,
            unit: dataUseDB[i]?.unit,
            entry_exit: dataUseDB[i]?.entry_exit,
            gas_day: dataUseDB[i]?.gas_day,
            value: dataUseDB[i]?.value,
            note: 'create',
          };
          dataDb.push(notData);
        }
      }
    }

    if (warningArr.length == 0 || isSaveByIgnoreWaring) {
      // eodApiCheck
      console.log('***');

      // return

      const nowAt = getTodayNowAdd7();
      const toDayReviewCodeStartWith = `${dayjs().tz('Asia/Bangkok').format('YYYYMMDD')}-ALP-`

      for (let i = 0; i < dataDb.length; i++) {
        if (dataDb[i]?.note === 'create') {
          // create

          const create = await this.prisma.allocation_management.create({
            data: {
              allocation_status_id: 1,
              shipper_name_text: dataDb[i]?.shipperIdSheet,
              gas_day_text: dataDb[i]?.gas_day,
              contract_code_text: dataDb[i]?.contractCodeSheet,
              point_text: dataDb[i]?.point,
              entry_exit_text: dataDb[i]?.entry_exit,
              area_text: dataDb[i]?.area,
              zone_text: dataDb[i]?.zone,

              gas_day: getTodayNowYYYYMMDDDfaultAdd7(
                dataDb[i]?.gas_day + 'T00:00:00Z',
              ).toDate(),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
              create_by: Number(userId),
            },
          });

          const allocationCount = await this.prisma.allocation_management.count({
            where: {
              review_code: {
                startsWith: toDayReviewCodeStartWith,
              },
              // create_date: {
              //   gte: todayStart,  // มากกว่าหรือเท่ากับเวลาเริ่มต้นของวันนี้
              //   lte: todayEnd,    // น้อยกว่าหรือเท่ากับเวลาสิ้นสุดของวันนี้
              // },
            },
          });
          const reviewCodeNum = `${toDayReviewCodeStartWith}${(allocationCount > 0 ? allocationCount + 1 : 1).toString().padStart(4, '0')}`;
          const shipperAllocationReviewCreate =
            await this.prisma.allocation_management_shipper_review.create({
              data: {
                allocation_status_id: dataDb[i]?.allocation_status_id,
                allocation_management_id: create?.id,
                shipper_allocation_review: dataDb[i]?.value.replace(/,/g, ''),
                create_date: nowAt.toDate(),
                create_date_num: nowAt.unix(),
                create_by: Number(userId),

              },
            });
          const update = await this.prisma.allocation_management.updateMany({
            where: {
              id: create?.id,
            },
            data: {
              review_code: reviewCodeNum,
              allocation_status_id: 2,
            },
          });

          // history
          const findAM = await this.prisma.allocation_management.findFirst({
            where: { id: create?.id, }, include: {
              allocation_management_comment: {
                include: {
                  allocation_status: true,
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
                // orderBy: { id: "desc" }
              },
              allocation_management_shipper_review: {
                include: {},
                take: 1,
                orderBy: {
                  id: 'desc',
                },
              },
              allocation_status: true,
            },
          })
          await this.writeReq(
            req,
            `allocation-review`,
            'shipper-allocation-review',
            {
              create: createByOnce,
              shipper_allocation_review: dataDb[i]?.value.replace(/,/g, '') || null,
              systemAllocation: dataDb[i]?.system_allocation || null,
              // intradaySystem: body?.row_data?.intradaySystem || null,
              previousAllocationTPAforReview: dataDb[i]?.previous_value || null,
              ...findAM
            },
          );


        } else {
          const shipperAllocationReviewCreate =
            await this.prisma.allocation_management_shipper_review.create({
              data: {
                allocation_status_id: 2,
                allocation_management_id: dataDb[i]?.id,
                shipper_allocation_review: dataDb[i]?.value.replace(/,/g, ''),
                create_date: nowAt.toDate(),
                create_date_num: nowAt.unix(),
                create_by: Number(userId),
              },
            });

          //     const update = await this.prisma.allocation_management.updateMany({
          //   where: {
          //     id: create?.id,
          //   },
          //   data: {
          //     review_code: reviewCodeNum,
          //     allocation_status_id: 2,
          //   },
          // });

          const findAMReview = await this.prisma.allocation_management.findFirst({ where: { id: dataDb[i]?.id, }, })
          if (!findAMReview?.review_code) {
            const allocationCount = await this.prisma.allocation_management.count({
              where: {
                review_code: {
                  startsWith: toDayReviewCodeStartWith,
                },
                // create_date: {
                //   gte: todayStart,  // มากกว่าหรือเท่ากับเวลาเริ่มต้นของวันนี้
                //   lte: todayEnd,    // น้อยกว่าหรือเท่ากับเวลาสิ้นสุดของวันนี้
                // },
              },
            });
            const reviewCodeNum = `${toDayReviewCodeStartWith}${(allocationCount > 0 ? allocationCount + 1 : 1).toString().padStart(4, '0')}`;
            const update = await this.prisma.allocation_management.updateMany({
              where: {
                id: dataDb[i]?.id,
              },
              data: {
                review_code: reviewCodeNum,
                allocation_status_id: 2,
              },
            });

          } else {

            const update = await this.prisma.allocation_management.updateMany({
              where: {
                id: dataDb[i]?.id,
              },
              data: {
                // review_code: reviewCodeNum,
                allocation_status_id: 2,
              },
            });
          }


          const findAM = await this.prisma.allocation_management.findFirst({
            where: { id: dataDb[i]?.id, }, include: {
              allocation_management_comment: {
                include: {
                  allocation_status: true,
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
                // orderBy: { id: "desc" }
              },
              allocation_management_shipper_review: {
                include: {},
                take: 1,
                orderBy: {
                  id: 'desc',
                },
              },
              allocation_status: true,
            },
          })
          await this.writeReq(
            req,
            `allocation-review`,
            'shipper-allocation-review',
            {
              create: createByOnce,
              shipper_allocation_review: dataDb[i]?.value.replace(/,/g, '') || null,
              systemAllocation: dataDb[i]?.system_allocation || null,
              // intradaySystem: body?.row_data?.intradaySystem || null,
              previousAllocationTPAforReview: dataDb[i]?.previous_value || null,
              ...findAM
            },
          );

        }
      }
      warningArr = []
    }
    warningArr = []

    // success
    // 7 update status 2 ที่สำเร็จ
    // value

    return {
      warning: warningArr,
      data: {
        headSheet,
        eodApi,
        resultDateKey,
        valueSheetMMBTU,
        dateArr,
        logWarning,
        // dataUseDB,
        dataDb,
      }
    };
  }

  async allocationReportViewGet(payload: any, userId: any) {
    const { start_date, end_date, skip, limit } = payload;

    // ถ้าเรียกไปเกินวันที่มี eviden จะ error ต้องรอเขาแก้ก่อน
    const { minDate, maxDate } = await findMinMaxExeDate(this.prisma, start_date, end_date);

    let evidenApi = minDate ? await this.evidenApiAllocationContractPointByNom({
      start_date: minDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
      end_date: maxDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
      skip,
      limit,
    }) : [];
    if (minDate && evidenApi.length === 0) {
      let totalRecord: number | undefined = undefined;
      await this.evidenApiAllocationContractPointByNom({
        start_date: minDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        end_date: maxDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        skip: 0,
        limit: 1,
      }, (total_record: number) => {
        totalRecord = total_record;
      });
      evidenApi = await this.evidenApiAllocationContractPointByNom({
        start_date: minDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        end_date: maxDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        skip: totalRecord ? 0 : skip,
        limit: totalRecord ? totalRecord : limit,
      });
    }
    // console.log('evidenApi : ', evidenApi);

    const entryExitMaster = await this.prisma.entry_exit.findMany({
      where: {},
    });

    const start = start_date ? getTodayStartAdd7(start_date) : null;
    const end = end_date ? getTodayEndAdd7(end_date) : null;

    if (!start || !end || !start.isValid() || !end.isValid()) {
      throw new Error('⛔ Invalid date format');
    }

    if (end.isBefore(start)) {
      throw new Error('⛔ End date must be after or equal to start date');
    }

    // let totalRecord = 0;
    // await this.evidenApiAllocationContractPointByNom({
    //   start_date,
    //   end_date,
    //   skip: 0,
    //   limit: 1,
    // }, (total_record: number) => {
    //   totalRecord = total_record;
    // });

    // Extract gas days and generate date array
    const dateArray = extractAndGenerateDateArray(evidenApi);

    // Build active data for all dates
    const activeData = await buildActiveDataForDates(
      dateArray,
      this.prisma
    );

    const newEOD = evidenApi?.flatMap((fm: any) => {
      const { data: data1, ...fmD } = fm;

      // Find active data for this gas_day
      const activeDataForDate = activeData.find((ad) => ad.date === fm.gas_day);

      const nData = data1?.flatMap((dFm: any) => {
        const { data: data2, ...fmD2 } = dFm;

        // Validate contract and shipper existence
        const contractValidation = validateContractAndShipper(dFm, activeDataForDate);
        // if (!contractValidation.isValid) {
        //   return [];
        // }

        const nData2 = data2
          // .filter((dFm2: any) => {
          //   return validatePointByType(dFm2, activeDataForDate);
          // })
          .map((dFm2: any) => {
            validatePointByType(dFm2, activeDataForDate);
            return { ...fmD, ...fmD2, ...dFm2, group: contractValidation.shipperObj };
          });

        return [...nData2];
      });

      return [...nData];
    }) || [];

    const resultEodLast: any = Object.values(
      newEOD.reduce((acc, curr) => {
        const key = `${curr.gas_day}|${curr.shipper}|${curr.contract}|${curr.point}|${curr.entry_exit}|${curr.area}|${curr.zone}`;
        if (!acc[key] || acc[key].execute_timestamp < curr.execute_timestamp) {
          acc[key] = curr;
        }
        return acc;
      }, {}),
    );

    //  db
    const publicationCenter = await this.publicationCenter();

    const allocationReportView =
      await this.prisma.allocation_report_view.findMany({
        include: {
          allocation_report: true,
        },
      });

    const newEODF = await Promise.all(resultEodLast?.map(async (eod: any) => {
      const contractCapacity =
        eod['values']?.find((f: any) => f?.tag === 'contractCapacity')?.value ??
        null;
      const nominationValue =
        eod['values']?.find((f: any) => f?.tag === 'nominatedValue')?.value ??
        null;
      const allocatedValue =
        eod['values']?.find((f: any) => f?.tag === 'allocatedValue')?.value ??
        null;
      // const overusage = eod['values']?.find((f:any) => f?.tag === "overusage")?.value ?? null
      // const intradaySystemAllocation = null

      const entry_exit_obj = entryExitMaster.find((f: any) => {
        return f?.name?.toUpperCase() === eod['entry_exit']?.toUpperCase();
      });

      const findAllocationReport = allocationReportView.find((f: any) => {
        return (
          f?.gas_day_text === eod?.['gas_day'] &&
          f?.shipper_name_text === eod?.['shipper'] &&
          f?.contract_code_text === eod?.['contract'] &&
          f?.point_text === eod?.['point'] &&
          f?.entry_exit_text === eod?.['entry_exit'] &&
          f?.area_text === eod?.['area'] &&
          f?.zone_text === eod?.['zone']
        );
      });

      let isNotExitInDb = false
      const findPublication = publicationCenter.find((f: any) => {
        return (
          f?.execute_timestamp === eod['execute_timestamp'] &&
          f?.gas_day_text === eod['gas_day'] &&
          (eod['gas_hour'] ? f?.gas_hour === eod['gas_hour'] : f?.gas_hour == null)
        );
      });

      if (!findPublication) {
        const publicationCenter = await this.prisma.publication_center.findMany({
          where: {
            execute_timestamp: eod['execute_timestamp'],
            gas_day_text: eod['gas_day'],
            gas_hour: (eod['gas_hour'] ? eod['gas_hour'] : null)
          },
        })

        isNotExitInDb = publicationCenter.length < 1
      }

      const { values, ...nEod } = eod;

      return {
        publication: !!findPublication || isNotExitInDb,
        id: findAllocationReport?.id,
        ...eod,
        contractCapacity,
        nominationValue,
        allocatedValue,
        entry_exit_obj,
        findAllocationReport,
      };
    }));
    // contract_point
    // point_type
    return newEODF;
  }

  findMinMaxGasDay = (array: any[]) => {
    if (!array.length) return { min: null, max: null };

    let minDate = array[0].gas_day;
    let maxDate = array[0].gas_day;

    for (const item of array) {
      if (item.gas_day < minDate) {
        minDate = item.gas_day;
      }
      if (item.gas_day > maxDate) {
        maxDate = item.gas_day;
      }
    }

    return { min: minDate, max: maxDate };
  };

  generateDatesInMonth = (year: number, month: number) => {
    const start = dayjs(`${year}-${String(month).padStart(2, '0')}-01`);
    const daysInMonth = start.daysInMonth();

    const dates = Array.from({ length: daysInMonth }, (_, i) =>
      start.add(i, 'day').format('YYYY-MM-DD'),
    );

    return dates;
  };

  async allocationMonthlyGetData(payload: any, userId: any) {
    const {
      start_date,
      end_date,
      skip,
      limit,
      shipperId,
      month,
      year,
      version,
      contractCode,
    } = payload;

    const allocationReportViewGet = await this.allocationReportViewGet(
      { start_date, end_date, skip, limit },
      userId,
    );
    // พี่แนนให้เอาตัวกรอก  publication ออกวันที่ 11 ก.ค. 2568
    // const publicationFilter = allocationReportViewGet?.filter((f: any) => {
    //   return f?.publication;
    // });
    const shipperIdFilter = shipperId
      ? allocationReportViewGet?.filter((f: any) => {
        return f?.shipper === shipperId;
      })
      : allocationReportViewGet;
    const monthFilter = month
      ? shipperIdFilter?.filter((f: any) => {
        return dayjs(f?.gas_day, 'YYYY-MM-DD').format('MM') === month;
      })
      : shipperIdFilter;
    const versionFilter = version
      ? monthFilter?.filter((f: any) => {
        return f?.execute_timestamp === Number(version);
      })
      : monthFilter;
    const contractCodeFilter =
      !!contractCode && contractCode !== 'Summary'
        ? versionFilter?.filter((f: any) => {
          return f?.contract === contractCode;
        })
        : versionFilter;

    return contractCodeFilter
  }

  async allocationMonthlyReport(payload: any, userId: any, ext?: any) {
    const {
      start_date,
      end_date,
      skip,
      limit,
      shipperId,
      month,
      year,
      version,
      contractCode,
    } = payload;
    const contractCodeFilter = await this.allocationMonthlyGetData(payload, userId);
    const type_report =
      !!contractCode && contractCode !== 'Summary' ? contractCode : 'Summary';

    const groupByContract = (array: any[]) => {
      const grouped: Record<string, any> = {};

      for (const item of array) {
        const contractKey = item.contract;
        if (!grouped[contractKey]) {
          grouped[contractKey] = {
            contract: contractKey, // กำหนดค่า contract
            data: [], // เตรียม array ว่างไว้
          };
        }
        grouped[contractKey].data.push(item); // push ข้อมูลเข้า array
      }

      const resultGroupByContract: any = Object.values(grouped);
      return resultGroupByContract;
    };

    const resultG =
      !!contractCode && contractCode !== 'Summary'
        ? groupByContract(contractCodeFilter)
        : [
          ...groupByContract(contractCodeFilter),
          { contract: 'Summary', data: contractCodeFilter },
        ];
    const dates = this.generateDatesInMonth(Number(year), Number(month));

    const resultGArea = resultG?.map((e: any) => {
      // const { min, max } = this.findMinMaxGasDay(e["data"])

      const grouped: Record<string, any> = {};
      for (const item of e['data']) {
        const areaKey = item.area;
        if (!grouped[areaKey]) {
          grouped[areaKey] = {
            area: areaKey, // กำหนดค่า contract
            data: [], // เตรียม array ว่างไว้
          };
        }
        grouped[areaKey].data.push(item); // push ข้อมูลเข้า array
      }

      const resultGroupByArea: any = Object.values(grouped);

      const dateRow = resultGroupByArea.map((dR: any) => {
        const dateRowData = dR['data'].map((dRData: any) => {
          return {
            gas_day: dRData['gas_day'],
            point: dRData['point'],
            customer_type: dRData['customer_type'],
            value: dRData['allocatedValue'],
          };
        });
        const combineGroupedValues = (data: any[]) => {
          const grouped: Record<string, any> = {};

          data.forEach(({ gas_day, point, customer_type, value }) => {
            const key = `${gas_day}|${point}|${customer_type}`;
            if (!grouped[key]) {
              grouped[key] = { gas_day, point, customer_type, value };
            } else {
              grouped[key].value += value;
            }
          });

          return Object.values(grouped);
        };
        const resultCB = combineGroupedValues(dateRowData);

        function groupByPointAndCustomerType(resa: any[], headDate: string[]) {
          const grouped: Record<
            string,
            {
              point: string;
              customer_type: string;
              data: { date: string; value: number }[];
            }
          > = {};

          for (const item of resa) {
            const key = `${item.point}|${item.customer_type}`;

            if (!grouped[key]) {
              grouped[key] = {
                point: item.point,
                customer_type: item.customer_type,
                data: [],
              };
            }
          }

          // สร้าง data array สำหรับแต่ละกลุ่ม โดยไล่ตาม headDate
          for (const key in grouped) {
            const [point, customer_type] = key.split('|');
            const valuesMap = resa
              .filter(
                (r) => r.point === point && r.customer_type === customer_type,
              )
              .reduce((acc: Record<string, number>, curr) => {
                acc[curr.gas_day] = (acc[curr.gas_day] || 0) + curr.value;
                return acc;
              }, {});

            grouped[key].data = headDate.map((date) => ({
              date,
              value: valuesMap[date] ?? 0,
            }));
          }

          return Object.values(grouped);
        }
        const resultCBDate = groupByPointAndCustomerType(resultCB, dates);

        function sumByDate(at: any[]) {
          const dateSumMap: Record<string, number> = {};

          for (const item of at) {
            if (Array.isArray(item.data)) {
              for (const entry of item.data) {
                if (!dateSumMap[entry.date]) {
                  dateSumMap[entry.date] = 0;
                }
                dateSumMap[entry.date] += entry.value;
              }
            }
          }

          // แปลงกลับเป็น array พร้อมเรียงวัน
          const result = Object.keys(dateSumMap)
            .sort((a, b) => (a > b ? 1 : -1)) // เรียงวันที่
            .map((date) => ({
              date,
              value: dateSumMap[date],
            }));

          return result;
        }
        const resultTotal = sumByDate(resultCBDate);

        return {
          ...dR,
          total: resultTotal,
          data: resultCBDate,
        };
      });

      return {
        ...e,
        data: dateRow,
      };
    });

    return { headDate: dates, data: resultGArea, typeReport: type_report };
  }

  async allocationMonthlyVersionExe(payload: any, userId: any) {
    const {
      start_date,
      end_date,
      skip,
      limit,
      shipperId,
      month,
      year,
      version,
      contractCode,
    } = payload;

    const contractCodeFilter = await this.allocationMonthlyGetData(payload, userId);

    // return contractCodeFilter

    // Group data by shipper, then get the execute_timestamp for each shipper
    const groupedData = contractCodeFilter.reduce((acc: any, item: any) => {
      const key = `${item.shipper}`;

      if (!acc[key]) {
        acc[key] = {
          "shipper": item.shipper,
          "group": item.group,
          data: []
        };
      }

      if (!acc[key].data.some((f: any) => f.request_number === item.request_number)) {
        acc[key].data.push({
          "request_number": item.request_number,
          "execute_timestamp": item.execute_timestamp,
        });
      }

      return acc;
    }, {});

    return Object.values(groupedData);
  }

  async allocationMonthlyReportApproved(payload: any, userId: any, ext?: any) {
    const allocationMonthlyReport = await this.allocationMonthlyReport(
      payload,
      userId,
      ext,
    );

    function getMonthNameFromNumber(monthNumber: string) {
      const month = dayjs(`2025-${monthNumber}-01`); // ใส่วันที่สมมติ เช่น 1 วัน เพื่อให้ dayjs สร้าง
      return month.format('MMMM'); // 'MMMM' จะได้ชื่อเดือนเต็ม เช่น June
    }

    const monthText = getMonthNameFromNumber(payload?.month);
    const contractCode =
      !!payload?.contractCode && payload?.contractCode !== 'Summary'
        ? payload?.contractCode
        : null;
    const typeReport =
      !!contractCode && contractCode !== 'Summary'
        ? 'By Contract Code'
        : 'Summary';

    const newDate = getTodayNowAdd7();

    const monthStart = newDate.startOf('month').toDate(); // วันที่ 1 ของเดือนนี้ เวลา 00:00:00
    const monthEnd = newDate.endOf('month').toDate(); // วันสุดท้ายของเดือนนี้ เวลา 23:59:59

    const monthlyCount =
      await this.prisma.allocation_monthly_report_approved.count({
        where: {
          create_date: {
            gte: monthStart, // มากกว่าหรือเท่ากับวันที่ 1
            lte: monthEnd, // น้อยกว่าหรือเท่ากับวันสุดท้าย
          },
        },
      });
    const fileRun = `${dayjs(newDate).format('YYYYMMDD')} Monthly Report ${monthlyCount > 0 ? monthlyCount + 1 : 1}`;
    const monthlyCountAll =
      await this.prisma.allocation_monthly_report_approved.count({
        where: {},
      });
    const version = `V.${monthlyCountAll > 0 ? monthlyCountAll + 1 : 1}`;

    const create = await this.prisma.allocation_monthly_report_approved.create({
      data: {
        monthText,
        contractCode,
        file: fileRun,
        version,
        typeReport,
        jsonData: JSON.stringify(allocationMonthlyReport),
        create_date_num: newDate.unix(),
        create_date: newDate.toDate(),
        create_by_account: {
          connect: {
            id: Number(userId),
          },
        },
      },
    });
    return {
      monthText,
      contractCode,
      file: fileRun,
      version,
      typeReport,
      jsonData: JSON.stringify(allocationMonthlyReport),
    };
  }

  async allocationMonthlyReportDownload() {
    const allMonthly =
      await this.prisma.allocation_monthly_report_approved.findMany({
        where: {},
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

    return allMonthly;
  }

  async allocationMonthlyReportDownloadUse(response: any, id: any, userId: any) {
    const allMonthly =
      await this.prisma.allocation_monthly_report_approved.findFirst({
        where: {
          id: Number(id),
        },
      });

    const dataD = allMonthly['jsonData'] ? this.safeParseJSON(allMonthly['jsonData']) : null;

    await this.exportFilesService.exportDataToExcelNewMontly(
      dataD,
      response,
      allMonthly['file'],
      userId,
    );
    // return nAllMonthly
  }

  async curtailmentsAllocation(payload: any, userId: any) {
    const { type } = payload;
    const resData = await this.prisma.curtailments_allocation.findMany({
      where: {
        curtailments_allocation_type_id: Number(type),
      },
      include: {
        curtailments_allocation_type: true,
        curtailments_allocation_calc: {
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
      orderBy: {
        id: 'desc',
      },
    });
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

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

    const nResData = resData?.map((e: any) => {
      const areaObj = areaMaster?.find((f: any) => {
        return f?.name === e?.area;
      });
      const nomination_value = e['curtailments_allocation_calc'].reduce(
        (sum, item) => sum + Number(item['nomination_value']),
        0,
      );

      const formatNumberFDecimal = (number: any) => {
        if (isNaN(number)) return number; // Handle invalid numbers gracefully

        // Convert number to a fixed 4-decimal format
        const fixedNumber = parseFloat(number).toFixed(4);

        // Add thousand separators
        return fixedNumber.replace(/\B(?=(\d{4})+(?!\d))/g, ',');
      };

      return {
        ...e,
        areaObj,
        nomination_value: nomination_value,
      };
    });

    return nResData;
  }

  async selectNomination(payload: any, userId: any) {
    const { gasDay, area, nominationPoint, unit, type } = payload;

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

    const resData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        OR: [{ del_flag: false }, { del_flag: null }],
        query_shipper_nomination_status: {
          id: {
            in: [2, 5],
          },
        },
        // id: 47,
        // nomination_type_id: 2,
      },
      include: {
        group: true,
        query_shipper_nomination_status: true,
        contract_code: {
          include: {
            booking_version: {
              include: {
                booking_full_json: true,
                booking_row_json: true,
                booking_full_json_release: true,
                booking_row_json_release: true,
              },
              take: 1,
              where: {
                flag_use: true,
              },
              orderBy: {
                id: 'desc',
              },
            },
          },
        },
        submission_comment_query_shipper_nomination_file: true,
        nomination_type: true,
        nomination_version: {
          include: {
            nomination_full_json: true,
            // nomination_full_json_sheet2: true,
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
        // query_shipper_nomination_file_renom: true,
        // query_shipper_nomination_file_url: {
        //   include: {
        //     nomination_version: true,
        //     query_shipper_nomination_status: true,
        //     create_by_account: {
        //       select: {
        //         id: true,
        //         email: true,
        //         first_name: true,
        //         last_name: true,
        //       },
        //     },
        //     update_by_account: {
        //       select: {
        //         id: true,
        //         email: true,
        //         first_name: true,
        //         last_name: true,
        //       },
        //     },
        //   },
        //   orderBy: {
        //     id: 'desc',
        //   },
        // },
        // query_shipper_nomination_file_comment: {
        //   include: {
        //     query_shipper_nomination_type_comment: true,
        //     query_shipper_nomination_status: true,
        //     nomination_version: true,
        //     create_by_account: {
        //       select: {
        //         id: true,
        //         email: true,
        //         first_name: true,
        //         last_name: true,
        //       },
        //     },
        //     update_by_account: {
        //       select: {
        //         id: true,
        //         email: true,
        //         first_name: true,
        //         last_name: true,
        //       },
        //     },
        //   },
        //   orderBy: {
        //     id: 'desc',
        //   },
        // },
      },
      orderBy: {
        id: 'desc',
      },
    });

    const grouped = {};
    for (const curr of resData) {
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
              eDataNomJson['data_temp'] = eDataNomJson['data_temp'] ? this.safeParseJSON(eDataNomJson['data_temp']) : null;
              return { ...eDataNomJson };
            });
            // eDataNom["nomination_full_json_sheet2"] = eDataNom["nomination_full_json_sheet2"]?.map((eDataNomJson:any) => {
            //   eDataNomJson["data_temp"] = JSON.parse(eDataNomJson["data_temp"])
            //   return { ...eDataNomJson }
            // })
            eDataNom['nomination_row_json'] = eDataNom[
              'nomination_row_json'
            ]?.map((eDataNomJson: any) => {
              eDataNomJson['data_temp'] = eDataNomJson['data_temp'] ? this.safeParseJSON(eDataNomJson['data_temp']) : null;
              return { ...eDataNomJson };
            });
            return { ...eDataNom };
          },
        );
        return { ...eData };
      });

      const gas_day_text = dayjs(e['gas_day']).format('DD/MM/YYYY');
      const shipper_name = e['shipper_name'];
      // const daily = e["data"]?.filter((f:any) => { return f?.nomination_type_id === 1 })
      // const weekly = e["data"]?.filter((f:any) => { return f?.nomination_type_id === 2 })
      // return { shipper_name, gas_day_text, daily, weekly }
      // const daily = e["data"]?.filter((f:any) => { return f?.nomination_type_id === 1 })
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
          });
        }
      } else {
        // daily
        dataE.push({
          ...e,
          total: Number(e['data_temp']['38']?.trim()?.replace(/,/g, '')) || 0,
          totalType: 'daily',
          gasDayUse: e?.gas_day_text,
        });
      }

      return [...dataE];
    });

    const nomExt = nomTypeExt?.map((e: any) => {
      const {
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
        ...nE
      } = e;
      const entryExitId = entryExit === 'Entry' ? 1 : 2;
      const areaObj = areaMaster?.find((f: any) => {
        return f?.name === area_text && f?.entry_exit_id === entryExitId;
      });
      return {
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
        areaObj,
      };
    });

    const pointAll = nomExt
      ?.filter((f: any) => {
        return f?.area_text === area;
      })
      ?.map((e: any) => {
        return e?.point;
      });

    // gasDay, area, nominationPoint, unit, type

    return [...new Set(pointAll)];
  }

  async curtailmentsAllocationGetMaxCap(payload: any, userId: any) {
    try {
      const { gasDay, area, nominationPoint, unit, type } = payload;

      if (!gasDay || !area || !unit || !type) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            key: 'Missing required fields',
            error: 'Missing required fields',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const gasDayjs = getTodayNowDDMMYYYYAdd7(gasDay)
      if (!gasDayjs.isValid()) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            key: 'Invalid gas day format',
            error: 'Invalid gas day format',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const targetGasDay = gasDayjs.format('YYYY-MM-DD')
      const activeData = await buildActiveDataForDates([targetGasDay], this.prisma)
      const activeDataForDate = activeData.find((ad) => ad.date === targetGasDay); // activeData[0]

      if (nominationPoint && isMatch(type, '2')) {
        const activeNominationPoint = activeDataForDate?.activeNominationPoints?.find((f: any) => f?.nomination_point === nominationPoint)
        if (!activeNominationPoint) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              key: 'Nomination point not found',
              error: 'Nomination point not found',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        if (isMatch(unit, 'MMBTU/D')) {
          const hv = await this.qualityEvaluationService.findHVByDateAndArea({ gasDay, area }, userId)
          return activeNominationPoint.maximum_capacity * hv
        }
        else {
          return activeNominationPoint.maximum_capacity
        }
      }
      else {
        const activeArea = activeDataForDate?.activeAreas?.find((f: any) => f?.name === area)
        if (!activeArea) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              key: 'Area not found',
              error: 'Area not found',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        if (isMatch(unit, 'MMBTU/D')) {
          return activeArea.area_nominal_capacity
        }
        else {
          const hv = await this.qualityEvaluationService.findHVByDateAndArea({ gasDay, area }, userId)
          return activeArea.area_nominal_capacity / hv
        }
      }
    } catch (error) {
      throw error
    }
  }

  async curtailmentsAllocationCalc(payload: any, userId: any) {
    const { gasDay, area, nominationPoint, unit, type, maxCapacity } = payload;

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

    const resData = await this.prisma.query_shipper_nomination_file.findMany({
      where: {
        OR: [{ del_flag: false }, { del_flag: null }],
        query_shipper_nomination_status: {
          id: {
            in: [2, 5, 1],
          },
        },
        // id: 47,
        // nomination_type_id: 2,
      },
      include: {
        group: true,
        query_shipper_nomination_status: true,
        contract_code: {
          include: {
            booking_version: {
              include: {
                booking_full_json: true,
                booking_row_json: true,
                booking_full_json_release: true,
                booking_row_json_release: true,
              },
              take: 1,
              where: {
                flag_use: true,
              },
              orderBy: {
                id: 'desc',
              },
            },
          },
        },
        submission_comment_query_shipper_nomination_file: true,
        nomination_type: true,
        nomination_version: {
          include: {
            nomination_full_json: true,
            // nomination_full_json_sheet2: true,
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
        // query_shipper_nomination_file_renom: true,
        // query_shipper_nomination_file_url: {
        //   include: {
        //     nomination_version: true,
        //     query_shipper_nomination_status: true,
        //     create_by_account: {
        //       select: {
        //         id: true,
        //         email: true,
        //         first_name: true,
        //         last_name: true,
        //       },
        //     },
        //     update_by_account: {
        //       select: {
        //         id: true,
        //         email: true,
        //         first_name: true,
        //         last_name: true,
        //       },
        //     },
        //   },
        //   orderBy: {
        //     id: 'desc',
        //   },
        // },
        // query_shipper_nomination_file_comment: {
        //   include: {
        //     query_shipper_nomination_type_comment: true,
        //     query_shipper_nomination_status: true,
        //     nomination_version: true,
        //     create_by_account: {
        //       select: {
        //         id: true,
        //         email: true,
        //         first_name: true,
        //         last_name: true,
        //       },
        //     },
        //     update_by_account: {
        //       select: {
        //         id: true,
        //         email: true,
        //         first_name: true,
        //         last_name: true,
        //       },
        //     },
        //   },
        //   orderBy: {
        //     id: 'desc',
        //   },
        // },
      },
      orderBy: {
        id: 'desc',
      },
    });

    const grouped = {};
    for (const curr of resData) {
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
              eDataNomJson['data_temp'] = eDataNomJson['data_temp'] ? this.safeParseJSON(eDataNomJson['data_temp']) : null;
              return { ...eDataNomJson };
            });
            // eDataNom["nomination_full_json_sheet2"] = eDataNom["nomination_full_json_sheet2"]?.map((eDataNomJson:any) => {
            //   eDataNomJson["data_temp"] = JSON.parse(eDataNomJson["data_temp"])
            //   return { ...eDataNomJson }
            // })
            eDataNom['nomination_row_json'] = eDataNom[
              'nomination_row_json'
            ]?.map((eDataNomJson: any) => {
              eDataNomJson['data_temp'] = eDataNomJson['data_temp'] ? this.safeParseJSON(eDataNomJson['data_temp']) : null;
              return { ...eDataNomJson };
            });
            return { ...eDataNom };
          },
        );
        return { ...eData };
      });

      const gas_day_text = dayjs(e['gas_day']).format('DD/MM/YYYY');
      const shipper_name = e['shipper_name'];
      // const daily = e["data"]?.filter((f:any) => { return f?.nomination_type_id === 1 })
      // const weekly = e["data"]?.filter((f:any) => { return f?.nomination_type_id === 2 })
      // return { shipper_name, gas_day_text, daily, weekly }
      // const daily = e["data"]?.filter((f:any) => { return f?.nomination_type_id === 1 })
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
      // NONTPA
      const nom = nomination_row_json?.map((eD: any) => {
        if (eD['data_temp']['6'] === 'NONTPA') {
        }
        return {
          contract: nE?.contract_code?.contract_code,
          unit: eD['data_temp']['9'],
          point: eD['data_temp']['3'],
          entryExit: eD['data_temp']['10'],
          nomVersionId: nER?.id,
          nomVersionVersion: nER?.version,
          nomVersionFull: nER?.nomination_full_json,
          NONTPA: eD['data_temp']['6'] || null,
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
        });
      }

      return [...dataE];
    });

    const nomExt = nomTypeExt?.map((e: any) => {
      const {
        rowId,
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
        NONTPA,
        ...nE
      } = e;
      const entryExitId = entryExit === 'Entry' ? 1 : 2;
      const areaObj = areaMaster?.find((f: any) => {
        return f?.name === area_text && f?.entry_exit_id === entryExitId;
      });
      // term_type_id
      return {
        rowId,
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
        term: contract_code?.term_type_id === 4 ? 'non-firm' : 'firm',
        NONTPA,
      };
    });
    const nomExtFilter =
      type === '1'
        ? nomExt?.filter((f: any) => {
          return f?.area_text === area && f?.gasDayUse === gasDay;
        })
        : nomExt?.filter((f: any) => {
          return (
            f?.area_text === area &&
            f?.gasDayUse === gasDay &&
            f?.point === nominationPoint
          );
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
        ].join('|');

        if (!map.has(key)) {
          map.set(key, []);
        }

        map.get(key).push(item);
      }

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

    const filteredDataDW = deduplicateByKeys(nomExtFilter);
    const groupedArea = {};
    for (const curr of filteredDataDW) {
      const key = `${curr.gasDayUse}|${curr.shipper_name}|${curr?.contract}|${curr?.area_text}`;

      if (!groupedArea[key]) {
        groupedArea[key] = {
          gasDayUse: curr.gasDayUse,
          shipper_name: curr.shipper_name,
          contract: curr?.contract,
          area_text: curr?.area_text,
          data: [],
        };
      }

      groupedArea[key].data.push({ ...curr });
    }
    const resultGroupArea: any = Object.values(groupedArea);
    const calcHvResultGroupArea = resultGroupArea.map((e: any) => {
      const hvXvi =
        e['data'].length > 0
          ? e['data'].reduce(
            (sum, item) => sum + Number(item['HV']) * Number(item['total']),
            0,
          )
          : null; //wi excl
      const viAll =
        e['data'].length > 0
          ? e['data'].reduce(
            (sum, item) =>
              item['NONTPA'] === 'NONTPA'
                ? sum - Number(item['total'])
                : sum + Number(item['total']),
            0,
          )
          : null; //wi excl
      const calcHv = hvXvi / viAll;

      // entryExit Entry Exit
      const entry =
        e['data'].length > 0
          ? e['data']?.filter((f: any) => {
            return f?.entryExit === 'Entry';
          })
          : null;
      const exit =
        e['data'].length > 0
          ? e['data']?.filter((f: any) => {
            return f?.entryExit === 'Exit';
          })
          : null;
      const entryMMBTU =
        entry.filter((f: any) => {
          return f?.unit === 'MMBTU/D';
        }) || null;
      const entryMMSCFD =
        entry.filter((f: any) => {
          return f?.unit === 'MMSCFD';
        }) || null;
      const exitMMBTU =
        exit.filter((f: any) => {
          return f?.unit === 'MMBTU/D';
        }) || null;

      let nominationValue = 0;
      if (unit === 'MMBTU/D') {
        const nominationValueEntry = entryMMBTU.reduce(
          (sum, item) =>
            item['NONTPA'] === 'NONTPA'
              ? sum - Number(item['total'])
              : sum + Number(item['total']),
          0,
        );
        const nominationValueExit = exitMMBTU.reduce(
          (sum, item) =>
            item['NONTPA'] === 'NONTPA'
              ? sum - Number(item['total'])
              : sum + Number(item['total']),
          0,
        );
        nominationValue = nominationValueEntry + nominationValueExit;
      } else if (unit === 'MMSCFD') {
        const nominationValueEntry = entryMMSCFD.reduce(
          (sum, item) =>
            item['NONTPA'] === 'NONTPA'
              ? sum - Number(item['total'])
              : sum + Number(item['total']),
          0,
        );
        //  let nominationValueExit = calcHv === 0 ? null : exitMMBTU.reduce((sum, item) => sum + Number(item["total"]), 0) / calcHv
        //  nominationValue = nominationValueEntry + nominationValueExit
        nominationValue = nominationValueEntry;
      }
      const { data, ...nE } = e;
      return {
        calcHv,
        nominationValue: nominationValue,
        maxCapacity: Number(maxCapacity?.trim()?.replace(/,/g, '')) || 0,
        term: data[0]?.term || null,
        ...nE,
      };
    });

    const firmValueAll =
      calcHvResultGroupArea
        ?.filter((f: any) => f?.term === 'firm')
        .reduce((sum, item) => {
          const value = Number(item['nominationValue'] ?? 0); // ถ้า null หรือ undefined จะกลายเป็น 0
          return sum + value;
        }, 0) || 0;
    const nonfirmValueAll =
      calcHvResultGroupArea
        ?.filter((f: any) => f?.term === 'non-firm')
        .reduce((sum, item) => {
          const value = Number(item['nominationValue'] ?? 0); // ถ้า null หรือ undefined จะกลายเป็น 0
          return sum + value;
        }, 0) || 0;

    const calcRemain = calcHvResultGroupArea?.map((e: any) => {
      let remainingCapacity = null;

      if (e['term'] === 'firm') {
        const checkFirm =
          firmValueAll < Number(maxCapacity)
            ? e['nominationValue']
            : Number(maxCapacity) * (e['nominationValue'] / firmValueAll);

        remainingCapacity = checkFirm;
      } else {
        const checkNonFirm =
          firmValueAll < Number(maxCapacity)
            ? (Number(maxCapacity) - firmValueAll) *
            (e['nominationValue'] / nonfirmValueAll)
            : 0;
        remainingCapacity = checkNonFirm;
      }

      return {
        ...e,
        remainingCapacity,
      };
    });

    // gasDay, area, nominationPoint, unit, type

    return calcRemain;
  }

  async curtailmentsAllocationCalcSave(payload: any, userId: any) {
    const { gasDay, area, nominationPoint, unit, type, maxCapacity } = payload;

    const calcRemain = await this.curtailmentsAllocationCalc(payload, userId);
    const newDate = getTodayNowAdd7();
    const curtailCount = await this.prisma.curtailments_allocation.count({
      where: {
        create_date: {
          gte: getTodayStartAdd7().toDate(), // เริ่มต้นวันตามเวลาประเทศไทย
          lte: getTodayEndAdd7().toDate(), // สิ้นสุดวันตามเวลาประเทศไทย
        },
        curtailments_allocation_type_id: Number(type),
      },
    });
    const curtailId =
      type === '1'
        ? `${dayjs().format('YYYYMMDD')}-CAA-${String(curtailCount + 1).padStart(4, '0')}`
        : `${dayjs().format('YYYYMMDD')}-CAN-${String(curtailCount + 1).padStart(4, '0')}`;

    // gasDay, area, nominationPoint, unit, type
    const dataUse = {
      case_id: curtailId,
      gas_day: getTodayNowDDMMYYYYDfaultAdd7(gasDay).toDate(),
      gas_day_text: gasDay,
      area: area,
      nomination_point: type === '1' ? null : nominationPoint, //type = 1 ไม่ต้องส่งมา
      unit: unit, //MMBTU/D    MMSCFD
      curtailments_allocation_type_id: Number(type),
      max_capacity: maxCapacity,
      data: calcRemain,
      create_date_num: newDate.unix(),
      create_date: newDate.toDate(),
      create_by: Number(userId),
      // create_by_account: {
      //   connect: {
      //     id: Number(userId),
      //   },
      // },
    };
    const { data: datDB, ...ndataUse } = dataUse;
    const create = await this.prisma.curtailments_allocation.create({
      data: ndataUse,
    });

    for (let i = 0; i < datDB.length; i++) {
      await this.prisma.curtailments_allocation_calc.create({
        data: {
          curtailments_allocation_id: Number(create?.id),
          gas_day: getTodayNowDDMMYYYYDfaultAdd7(datDB[i]?.gasDayUse).toDate(),
          gas_day_text: datDB[i]?.gasDayUse,
          calc_hv: String(datDB[i]?.calcHv),
          nomination_value: String(datDB[i]?.nominationValue),
          max_capacity: String(datDB[i]?.max_capacity),
          term: datDB[i]?.term,
          shipper_name: datDB[i]?.shipper_name,
          contract: datDB[i]?.contract,
          area_text: datDB[i]?.area_text,
          remaining_capacity: String(datDB[i]?.remainingCapacity),
          create_date_num: newDate.unix(),
          create_date: newDate.toDate(),
          create_by: Number(userId),
        },
      });
    }

    return dataUse;
  }

  async allocationReportViewSpeed(payload: any, userId: any) {
    const {
      start_date,
      end_date,
      skip,
      limit,
      tab,
      contract,
      shipper,
      gas_day,
      id,
      evidenApi,
      areaMaster,
      zoneMaster,
      groupMaster,
      entryExitMaster,
    } = payload;

    const start = start_date ? getTodayStartAdd7(start_date) : null;
    const end = end_date ? getTodayEndAdd7(end_date) : null;

    if (!start || !end || !start.isValid() || !end.isValid()) {
      throw new Error('⛔ Invalid date format');
    }

    if (end.isBefore(start)) {
      throw new Error('⛔ End date must be after or equal to start date');
    }

    // Extract gas days and generate date array
    const dateArray = extractAndGenerateDateArray(evidenApi);

    // Build active data for all dates
    const activeData = await buildActiveDataForDates(
      dateArray,
      this.prisma
    );

    const newEOD = evidenApi?.flatMap((fm: any) => {
      const { data: data1, ...fmD } = fm;

      // Find active data for this gas_day
      const activeDataForDate = activeData.find((ad) => ad.date === fm.gas_day);

      const nData = data1?.flatMap((dFm: any) => {
        const { data: data2, ...fmD2 } = dFm;

        // Validate contract and shipper existence
        const contractValidation = validateContractAndShipper(dFm, activeDataForDate);
        // if (!contractValidation.isValid) {
        //   return [];
        // }

        const nData2 = data2
          // .filter((dFm2: any) => {
          //   return validatePointByType(dFm2, activeDataForDate);
          // })
          .map((dFm2: any) => {
            validatePointByType(dFm2, activeDataForDate);
            return { ...fmD, ...fmD2, ...dFm2, group: contractValidation.shipperObj };
          });

        return [...nData2];
      });

      return [...nData];
    }) || [];

    const resultEodLast1: any = Object.values(
      newEOD.reduce((acc, curr) => {
        const key = `${curr.gas_day}|${curr.shipper}|${curr.contract}|${curr.point}|${curr.entry_exit}|${curr.area}|${curr.zone}`;
        if (!acc[key] || acc[key].execute_timestamp < curr.execute_timestamp) {
          acc[key] = curr;
        }
        return acc;
      }, {}),
    );

    //  db

    const resultEodLast = resultEodLast1?.filter((f: any) => {
      return (
        f?.contract === contract &&
        f?.shipper === shipper &&
        f?.gas_day === gas_day
      );
    });

    let allocationReportView =
      await this.prisma.allocation_report_view.findMany({
        include: {},
      });

    const newAllocation = [];

    for (let i = 0; i < resultEodLast.length; i++) {
      const findAllocationReport = allocationReportView.find((f: any) => {
        return (
          f?.allocation_report_id === Number(id) &&
          f?.gas_day_text === resultEodLast[i]?.gas_day &&
          f?.shipper_name_text === resultEodLast[i]?.shipper &&
          f?.contract_code_text === resultEodLast[i]?.contract &&
          f?.point_text === resultEodLast[i]?.point &&
          f?.entry_exit_text === resultEodLast[i]?.entry_exit &&
          f?.area_text === resultEodLast[i]?.area &&
          f?.zone_text === resultEodLast[i]?.zone
        );
      });

      if (!findAllocationReport) {
        newAllocation.push({
          allocation_report_id: Number(id),
          shipper_name_text: resultEodLast[i]?.shipper,
          gas_day_text: resultEodLast[i]?.gas_day,
          contract_code_text: resultEodLast[i]?.contract,
          point_text: resultEodLast[i]?.point,
          entry_exit_text: resultEodLast[i]?.entry_exit,
          area_text: resultEodLast[i]?.area,
          zone_text: resultEodLast[i]?.zone,

          gas_day: getTodayNowYYYYMMDDDfaultAdd7(
            resultEodLast[i]?.gas_day + 'T00:00:00Z',
          ).toDate(),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by: Number(userId),
        });
      }
    }

    if (newAllocation.length > 0) {
      // create
      await this.prisma.allocation_report_view.createMany({
        data: newAllocation,
      });

      allocationReportView = await this.prisma.allocation_report_view.findMany({
        include: {},
      });
    }

    const newEODF = resultEodLast?.map((eod: any) => {
      const contractCapacity =
        eod['values']?.find((f: any) => f?.tag === 'contractCapacity')?.value ??
        null;
      const nominationValue =
        eod['values']?.find((f: any) => f?.tag === 'nominatedValue')?.value ??
        null;
      const allocatedValue =
        eod['values']?.find((f: any) => f?.tag === 'allocatedValue')?.value ??
        null;
      // const overusage = eod['values']?.find((f:any) => f?.tag === "overusage")?.value ?? null
      // const intradaySystemAllocation = null

      const entry_exit_obj = entryExitMaster.find((f: any) => {
        return f?.name?.toUpperCase() === eod['entry_exit']?.toUpperCase();
      });

      const findAllocationReport = allocationReportView.find((f: any) => {
        return (
          f?.allocation_report_id === Number(id) &&
          f?.gas_day_text === eod?.['gas_day'] &&
          f?.shipper_name_text === eod?.['shipper'] &&
          f?.contract_code_text === eod?.['contract'] &&
          f?.point_text === eod?.['point'] &&
          f?.entry_exit_text === eod?.['entry_exit'] &&
          f?.area_text === eod?.['area'] &&
          f?.zone_text === eod?.['zone']
        );
      });

      const { values, ...nEod } = eod;

      return {
        id: findAllocationReport?.id,
        ...eod,
        contractCapacity,
        nominationValue,
        allocatedValue,
        // overusage,
        // intradaySystemAllocation,
        entry_exit_obj,
      };
    });
    // contract_point
    // point_type
    return newEODF;
  }

  async allocationShipperReport(payload: any, userId: any) {
    const {
      start_date,
      end_date,
      skip,
      limit,
      tab,
      nomination_point_arr,
      shipper_arr,
      share,
    } = payload;

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

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

    const groupMaster = await this.prisma.group.findMany({
      where: {
        user_type_id: 3,
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

    const allocationShipperReport = await this.allocationReport(
      payload,
      userId,
    );

    // meter
    const getDataLogic =
      await this.meteringManagementService.getDataLogicNoCondept({
        share,
        start_date,
        end_date,
      },
        true
      );

    // พี่แนนให้เอาตัวกรอก  publication ออกวันที่ 11 ก.ค. 2568
    // const publication = allocationShipperReport?.filter((f: any) => {
    //   return f?.publication === true;
    // });

    const publicationNewVew = [];

    let evidenApi = [];
    if (tab === '1') {
      let totalRecord: number | undefined = undefined;
      await this.evidenApiAllocationContractPointByNom({
        start_date,
        end_date,
        skip: 0,
        limit: 1,
      }, (total_record: number) => {
        totalRecord = total_record;
      });
      evidenApi = await this.evidenApiAllocationContractPointByNom({
        start_date,
        end_date,
        skip: totalRecord ? 0 : skip,
        limit: totalRecord ? totalRecord : limit,
      });
    }
    else {
      let totalRecord: number | undefined = undefined;
      await this.evidenApiAllocationContractPointIntradayByNom({
        start_date,
        end_date,
        skip: 0,
        limit: 1,
      }, (total_record: number) => {
        totalRecord = total_record;
      });
      evidenApi = await this.evidenApiAllocationContractPointIntradayByNom({
        start_date,
        end_date,
        skip: totalRecord ? 0 : skip,
        limit: totalRecord ? totalRecord : limit,
      });
    }


    for (let i = 0; i < allocationShipperReport.length; i++) {
      const allocationReportView = await this.allocationReportViewSpeed(
        {
          start_date,
          end_date,
          skip,
          limit,
          tab,
          contract: allocationShipperReport[i]?.contract,
          shipper: allocationShipperReport[i]?.shipper,
          gas_day: allocationShipperReport[i]?.gas_day,
          id: allocationShipperReport[i]?.id,
          evidenApi,
          areaMaster,
          zoneMaster,
          groupMaster,
          entryExitMaster,
        },
        userId,
      );

      const nomViewPoint = allocationReportView?.map((e: any) => {
        return {
          point: e['point'],
          point_type: e['point_type'],
          allocatedValue: e['values']?.find((f: any) => {
            return f?.tag === 'allocatedValue';
          })?.value,
        };
      });

      publicationNewVew.push({
        ...allocationShipperReport[i],
        nomViewPoint: nomViewPoint || [],
      });
    }

    const newDataUse = publicationNewVew?.map((e: any) => {
      return {
        id: e['id'] || null,
        request_number: e['request_number'] || null,
        execute_timestamp: e['execute_timestamp'] || null,
        gas_day: e['gas_day'] || null,
        contract: e['contract'] || null,
        shipper_id: e['shipper'] || null,
        shipper_name: e['group']?.['name'] || null,
        contract_point: e['contract_point'] || null,
        area: e['area'] || null,
        zone: e['zone'] || null,
        entry_exit: e['entry_exit'] || null,
        nomViewPoint: e['nomViewPoint'] || null,
      };
    });

    const newDataUsePoint = newDataUse?.flatMap((e: any) => {
      const { nomViewPoint, ...nE } = e;
      const nomViewPointNew = nomViewPoint?.map((nv: any) => {
        return {
          ...nE,
          ...nv,
        };
      });

      return [...nomViewPointNew];
    });


    const filterNom =
      nomination_point_arr.length > 0
        ? newDataUsePoint?.filter((f: any) => {
          return nomination_point_arr.includes(f?.point);
        })
        : newDataUsePoint;
    const filterShipper =
      shipper_arr.length > 0
        ? filterNom?.filter((f: any) => {
          return shipper_arr.includes(f?.shipper_id);
        })
        : filterNom;

    const groupedByGasday = Object.values(
      filterShipper.reduce((acc, item) => {
        const key = `${item.gas_day}`;
        if (!acc[key]) {
          acc[key] = {
            gas_day: item.gas_day,
            data: [],
          };
        }
        acc[key].data.push(item);
        return acc;
      }, {}),
    );

    const newGroupedByGasday = groupedByGasday?.map((e: any) => {
      const { data, ...nE } = e;

      const groupedByNompoint = Object.values(
        data.reduce((acc, item) => {
          const key = `${item.point}`;
          if (!acc[key]) {
            acc[key] = {
              point: item.point,
              data: [],
            };
          }
          acc[key].data.push(item);
          return acc;
        }, {}),
      );

      const groupedByNompointNew = groupedByNompoint?.map((gbn: any) => {
        const { data: nData, ...nGbn } = gbn;

        const grouped = Object.values(
          nData.reduce((acc, curr) => {
            const key = `${curr.shipper_id}`;
            if (!acc[key]) {
              acc[key] = {
                gas_day: curr.gas_day,
                shipper_id: curr.shipper_id,
                shipper_name: curr.shipper_name,
                allocatedValue: 0,
              };
            }
            acc[key].allocatedValue += curr.allocatedValue;
            return acc;
          }, {}),
        );

        const findGasDay = (getDataLogic?.meter || [])?.filter((f: any) => {
          return f?.gasDay === nE['gas_day'] || f?.gasDay === nE['gasDay'];
        });
        const findNomPoint = (getDataLogic?.meterNom || [])?.filter(
          (f: any) => {
            return f?.nomination_point?.nomination_point === nGbn['point'];
          },
        );
        let meterValue = null;
        if (findNomPoint.length > 0 && findGasDay.length > 0) {
          for (let iNom = 0; iNom < findNomPoint.length; iNom++) {
            const findMeter = findGasDay?.filter((f: any) => {
              return (
                f?.meteringPointId === findNomPoint[iNom]['metered_point_name']
              );
            });
            const findMeterUse = findMeter?.length > 0 ? findMeter[0] : null;
            if (findMeterUse) {
              meterValue += findMeterUse?.energy;
            }
          }
        }

        return {
          ...nGbn,
          data: grouped,
          total: grouped.reduce(
            (sum, item: any) => sum + (item?.allocatedValue || 0),
            0,
          ),
          meterValue: meterValue,
        };
      });

      return {
        ...nE,
        nomPoint: groupedByNompointNew,
      };
    });

    return newGroupedByGasday;
  }

  async allocationShipperReportCallOnlyByNomination(payload: any, userId: any) {
    const {
      start_date,
      end_date,
      skip,
      limit,
      tab,
      nomination_point_arr,
      shipper_arr,
      share,
    } = payload;

    let startDate = start_date ? getTodayNowYYYYMMDDDfaultAdd7(start_date) : null;
    let endDate = end_date ? getTodayNowYYYYMMDDDfaultAdd7(end_date) : null;
    const today = getTodayEndAdd7();

    const { minDate, maxDate } = await findMinMaxExeDate(this.prisma, start_date, end_date);

    if (!startDate || !startDate.isValid()) {
      if (minDate?.isValid?.()) {
        startDate = minDate;
      } else {
        startDate = today.startOf('month');
      }
    }

    if (!endDate || !endDate.isValid()) {
      if (maxDate?.isValid?.()) {
        endDate = maxDate;
      } else {
        endDate = today;
      }
    }

    if (endDate.isAfter(today)) {
      endDate = today;
    }

    if (!startDate || !endDate || !startDate.isValid() || !endDate.isValid()) {
      throw new Error('⛔ Invalid date format');
    }

    if (endDate.isBefore(startDate)) {
      throw new Error('⛔ End date must be after or equal to start date');
    }

    // meter
    const getDataLogic =
      await this.meteringManagementService.getDataLogicNoCondept({
        share,
        start_date,
        end_date,
      },
        true
      );

    // ถ้าเรียกไปเกินวันที่มี eviden จะ error ต้องรอเขาแก้ก่อน
    let startForEviden = startDate;
    let endForEviden = endDate;
    if (endForEviden.isAfter(today)) {
      endForEviden = today;
    }
    let evidenApi = [];
    if (tab === '1') {
      let totalRecord: number | undefined = undefined;
      minDate && await this.evidenApiAllocationContractPointByNom({
        // start_date: minDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        // end_date: maxDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        start_date: startForEviden?.tz('Asia/Bangkok')?.format('YYYY-MM-DD'),
        end_date: endForEviden?.tz('Asia/Bangkok')?.format('YYYY-MM-DD'),
        skip: 0,
        limit: 1,
      }, (total_record: number) => {
        totalRecord = total_record;
      });
      const evidenData = minDate && await this.evidenApiAllocationContractPointByNom({
        // start_date: minDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        // end_date: maxDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        start_date: startForEviden?.tz('Asia/Bangkok')?.format('YYYY-MM-DD'),
        end_date: endForEviden?.tz('Asia/Bangkok')?.format('YYYY-MM-DD'),
        skip: totalRecord ? 0 : skip,
        limit: totalRecord ? totalRecord : limit,
      }) || [];

      const executeEodList = await this.prisma.execute_eod.findMany({
        where: {
          status: {
            equals: 'OK',
            mode: 'insensitive',
          },
          start_date_date: {
            lte: endDate.toDate(),
          },
          end_date_date: {
            gte: startDate.toDate(),
          }
        }
      })

      evidenApi = evidenData.filter((item: any) => {
        const itemGasDay = getTodayNowYYYYMMDDDfaultAdd7(item.gas_day);
        return executeEodList?.some((executeData: any) => {
          const executeStart = getTodayNowAdd7(executeData?.start_date_date);
          const executeEnd = getTodayNowAdd7(executeData?.end_date_date);
          return executeData.request_number_id == item.request_number &&
            executeStart.isSameOrBefore(itemGasDay, 'day') &&
            executeEnd.isSameOrAfter(itemGasDay, 'day')
        })
      })
    }
    else {
      let totalRecord: number | undefined = undefined;
      minDate && await this.evidenApiAllocationContractPointIntradayByNom({
        start_date: minDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        end_date: maxDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        skip: 0,
        limit: 1,
      }, (total_record: number) => {
        totalRecord = total_record;
      });
      const evidenData = minDate && await this.evidenApiAllocationContractPointIntradayByNom({
        start_date: minDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        end_date: maxDate.tz('Asia/Bangkok').format('YYYY-MM-DD'),
        skip: totalRecord ? 0 : skip,
        limit: totalRecord ? totalRecord : limit,
      }) || [];

      const executeIntradayList = await this.prisma.execute_intraday.findMany({
        where: {
          status: {
            equals: 'OK',
            mode: 'insensitive',
          },
          gas_day_date: {
            gte: startDate.toDate(),
            lte: endDate.toDate()
          }
        }
      })

      evidenApi = evidenData.filter((item: any) => {
        const itemGasDay = getTodayNowYYYYMMDDDfaultAdd7(item.gas_day);
        return executeIntradayList?.some((executeData: any) => {
          const executeGasDay = getTodayNowAdd7(executeData.gas_day);
          return executeData.request_number_id == item.request_number &&
            executeGasDay.isSame(itemGasDay, 'day') &&
            executeData.gas_hour == item.gas_hour
        })
      })
    }

    const publicationCenterDeletedList = await this.prisma.publication_center.findMany({
      where: {
        AND: [
          {
            gas_day: {
              gte: startDate.toDate(),
            }
          },
          {
            gas_day: {
              lte: endDate.toDate(),
            }
          },
          {
            del_flag: true,
          }
        ]
      },
    })

    // พี่แนนให้เอาตัวกรอก  publication ออกวันที่ 11 ก.ค. 2568
    const latestByGasDay = evidenApi
      // .filter((item:any)=>{
      //   return !publicationCenterDeletedList?.some((f: any) => {
      //     return (
      //       f?.execute_timestamp === item.execute_timestamp &&
      //       f?.gas_day_text === item.gas_day
      //     );
      //   })
      // })
      .reduce((acc: any, current: any) => {
        const gasDay = current.gas_day;

        if (!acc[gasDay] || current.execute_timestamp > acc[gasDay].execute_timestamp) {
          acc[gasDay] = current;
        }

        return acc;
      }, {});
    // Convert back to array and update the response
    const filteredData = Object.values(latestByGasDay)

    // Extract gas days and generate date array
    const dateArray = extractAndGenerateDateArray(filteredData);

    // Build active data for all dates
    const activeData = await buildActiveDataForDates(
      dateArray,
      this.prisma
    );

    // Filter based on active records
    const filteredEvidenApi = filteredData.flatMap((fm: any) => {
      const { data: data1, ...fmD } = fm;

      // Find active data for this gas_day
      const activeDataForDate = activeData.find((ad) => ad.date === fm.gas_day);

      const nData = data1?.flatMap((dFm: any) => {
        const { data: data2, ...fmD2 } = dFm;

        // Validate contract and shipper existence
        const contractValidation = validateContractAndShipper(dFm, activeDataForDate);
        // if (!contractValidation.isValid) {
        //   return [];
        // }



        const nData2 = data2
          // .filter((dFm2: any) => {
          //   return validatePointByType(dFm2, activeDataForDate);
          // })
          .map((dFm2: any) => {
            validatePointByType(dFm2, activeDataForDate);
            return { ...fmD, ...fmD2, ...dFm2, group: contractValidation.shipperObj };
          });


        return [...nData2];
      });

      return [...nData];
    });


    // พี่แนนให้เอาตัวกรอก  publication ออกวันที่ 11 ก.ค. 2568
    // const publication = filteredEvidenApi?.filter((f: any) => {
    //   return f?.publication === true;
    // });

    // Apply additional filtering based on nomination_point_arr and shipper_arr
    let finalFilteredData = filteredEvidenApi;

    // Filter by nomination_point_arr if provided
    if (nomination_point_arr && nomination_point_arr.length > 0) {
      finalFilteredData = finalFilteredData.filter((item: any) => {
        return nomination_point_arr.includes(item.point);
      });
    }

    // Filter by shipper_arr if provided
    if (shipper_arr && shipper_arr.length > 0) {
      finalFilteredData = finalFilteredData.filter((item: any) => {
        return shipper_arr.includes(item.shipper);
      });
    }

    // Transform to expected result structure
    const transformedResult = transformToShipperReportStructure(finalFilteredData, getDataLogic, activeData);

    return transformedResult;
  }

  async allocationShipperReportDownload(payload: any, userId: any) {
    const allocationShipperReport = await this.allocationShipperReport(
      payload,
      userId,
    );

    const newDate = getTodayNowAdd7();

    const jsonString = JSON.stringify(allocationShipperReport);
    // const buffer = Buffer.from(jsonString, 'utf-8')

    const create = await this.prisma.allocation_shipper_report_approved.create({
      data: {
        gas_day_from: payload?.start_date,
        gas_day_from_d: getTodayNowAdd7(payload?.start_date).toDate(),
        gas_day_to: payload?.end_date,
        gas_day_to_d: getTodayNowAdd7(payload?.end_date).toDate(),
        file: 'Allocation Summary Shipper Report',
        jsonData: jsonString,
        nomination_point_arr_temp: JSON.stringify(
          payload?.nomination_point_arr,
        ),
        shipper_arr_temp: JSON.stringify(payload?.shipper_arr),
        share_temp: JSON.stringify(payload?.share),
        skip_temp: JSON.stringify(payload?.skip),
        limit_temp: JSON.stringify(payload?.share),
        create_date_num: newDate.unix(),
        create_date: newDate.toDate(),
        create_by_account: {
          connect: {
            id: Number(userId),
          },
        },
      },
    });

    return create;
  }

  async allocationShipperReportDownloadGet() {
    const resData =
      await this.prisma.allocation_shipper_report_approved.findMany({
        where: {},
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
    return resData;
  }

  async testMeterOnce() {

    const start = Date.now();

    const meteredMicroData = await this.meteredMicroService.sendMessage(
      JSON.stringify({
        case: 'getLast',
        mode: 'metering',

        start_date: '2025-01-01',
        end_date: '2025-07-01',
      }),
    );

    const end = Date.now();
    const durationMs = end - start;

    return {
      durationMs,
      meteredMicroData: meteredMicroData,
    };
  }

  // allowcation_management_sent_email
  // prover email
  async sendEmailProviderCustom(
    header: any,
    subject: any,
    sendEmail: any,
    detail: any,
    excelBuffer: any,
    type: any,
  ) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: { rejectUnauthorized: true },
    });

    const info = await transporter.sendMail({
      from: `<${process.env.SMTP_USER}>`,
      to: sendEmail,
      subject: subject || '',
      attachments: [
        {
          filename: 'AllocationManagement.xlsx',
          content: excelBuffer,
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ],
      html: `<!DOCTYPE html>
              <html lang="en">
                  <head>
                      <meta charset="UTF-8">
                      <meta name="viewport" content="width=device-width, initial-scale=1.0">
                      <title>Document</title>
                  </head>
                  <body>
                      <div 
                          style="width: 500px; 
                          border: 1px solid #D6D6D6; 
                          height: auto; 
                          border-radius: 15px;
                          margin: 10px auto;
                          padding: 15px;"
                      >
                          <div
                              style="display: flex;
                              margin-bottom: 50px;"
                          >
                              <img
                                  src="https://nu-test01.nueamek.app/exynos/20241203082755_logo-ptt.png"
                                  alt="logo-ptt"
                                  style="margin: 0 auto; width: 120px; object-fit: contain;"
                              />
                          </div>
                          <div
                              style="display: flex;
                              margin-bottom: 40px;"
                          >
                              <img
                                  src="https://nu-test01.nueamek.app/exynos/20241203082741_email-img.png"
                                  alt="img-email"
                                  style="margin: 0 auto; object-fit: contain;"
                              />
                          </div>
                          <div
                              style="text-align: center;
                              font-size: 20px;
                              font-weight: 700;"
                          >
                              ${header || '-'}
                          </div>
                          <div
                              style="line-height: 40px;
                              margin-top: 20px;
                              text-align: center;
                              font-size: 15px;
                              "
                          >
                              ${detail || '-'}
                          </div>
                        
                          <div style="margin-top: 30px; font-size: 15px;">
                              <div style="text-align: center;">
                                  Thank You,
                              </div>
                              <div style="text-align: center;">
                                  TPA, Systems
                              </div>
                          </div>
                          <div style="margin-top: 40px; text-align: center; font-size: 14px;">
                              <span>If you did not initiate this request, please contact us immediately at </span>
                              <a href="#">support@ptt.com.</a>
                          </div>
                      </div>
                  </body>
              </html>`,
    });

    return info;
  }

  async allocationManagementSendEmailGet(userId: any) {
    const resData =
      await this.prisma.allowcation_management_sent_email?.findFirst({
        where: {},
        orderBy: {
          id: 'desc',
        },
      });

    return resData;
  }

  async allocationManagementSendEmail(payload: any, userId: any) {
    const { subject, sendEmail, sendEmailGroup, userType, detail, exportFile } =
      payload;

    const header = 'Allocation Management';

    const resData = await this.allcationOnceId(exportFile?.bodys, null);

    if (!resData || (Array.isArray(resData) && resData?.length === 0)) {
      const startDate = exportFile?.bodys?.start_date
      const endDate = exportFile?.bodys?.end_date
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: `Data not found ${startDate ? `Since ${startDate}` : ''} ${(endDate && startDate) ? `to ${endDate}` : ''}. The email cannot be sent. Please try again later.`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    let aresData = [];

    if (userType === 3) {
      const emails = [];
      // shipper
      // กรอง shipper แยก

      for (let i = 0; i < sendEmailGroup.length; i++) {
        if (sendEmailGroup[i]?.email) {
          emails.push(sendEmailGroup[i].email);
        }
        const { account } = sendEmailGroup[i];
        for (let iAcc = 0; iAcc < account.length; iAcc++) {
          if (account[iAcc].email) {
            emails.push(account[iAcc].email);
          }
        }

        const findShipper = resData?.filter((f: any) => {
          return f?.group?.id === sendEmailGroup[i]?.id;
        });
        if (findShipper.length > 0) {
          // รายการที่ Diff ระหว่าง Shipper Allocation Review และ System Allocation
          const diffGreen = findShipper?.filter((f: any) => {
            const shipperReview = f?.allocation_management_shipper_review?.[0]
              ?.shipper_allocation_review
              ? Number(
                f?.allocation_management_shipper_review?.[0]
                  ?.shipper_allocation_review,
              )
              : 0;
            return shipperReview !== f?.systemAllocation;
          });
          if (diffGreen.length > 0) {
            const emailText = emails.join(', ');
            // const emailText ='teerapong.songsan@gmail.com, miniforzen@gmail.com';
            aresData.push({
              shipperId: sendEmailGroup[i]?.id, // แยกส่งตามข้อมูล shipper
              userType: userType,
              data: findShipper,
              emailText: emailText,
            });
          }
        }
      }
    } else {
      const emails = [];
      // tso อื่นๆ // เอาทุกเมล
      for (let i = 0; i < sendEmailGroup.length; i++) {
        if (sendEmailGroup[i]?.email) {
          emails.push(sendEmailGroup[i].email);
        }
        const { account } = sendEmailGroup[i];
        for (let iAcc = 0; iAcc < account.length; iAcc++) {
          if (account[iAcc].email) {
            emails.push(account[iAcc].email);
          }
        }
      }

      const emailText = emails.join(', ');
      // const emailText = 'teerapong.songsan@gmail.com, miniforzen@gmail.com';

      aresData = [
        {
          shipperId: null, // tso ส่งเหมือนกันหมด ไม่ต้องแยกแบบ shipper
          userType: userType,
          data: resData,
          emailText: emailText,
        },
      ];
    }

    for (let i = 0; i < aresData.length; i++) {
      const excelBuffer: any =
        await this.exportFilesService.epAllocationAllocationManagementSentEmailOnly(
          null,
          exportFile,
          userId,
          aresData[i]?.data,
          aresData[i]?.userType,
          aresData[i]?.shipperId,
        );

      // ทำแยกส่งตาม user type
      const info = await this.sendEmailProviderCustom(
        header,
        subject,
        aresData[i]?.emailText,
        detail,
        excelBuffer,
        null,
      );
    }

    const newDate = getTodayNowAdd7();

    const create = await this.prisma.allowcation_management_sent_email.create({
      data: {
        subject: subject || null,
        detail: detail || null,
        create_date_num: newDate.unix(),
        create_date: newDate.toDate(),
        create_by: Number(userId),
      },
    });

    return create;
  }

  // https://app.clickup.com/t/86eu48rpe
  async executeNotiInapp(payload: any) {
    const roleMenuAllocationManagementNoticeInapp = await this.prisma.account.findMany({
      where: {
        id: {
          not: 99999
        },
        account_manage: {
          some: {
            account_role: {
              some: {
                role: {
                  menus_config: {
                    some: {
                      menus_id: 82,
                      f_noti_inapp: 1
                    },
                  }
                }
              }
            }
          }
        }
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
                role: true
              }
            }
          }
        }
      },
      // where:{
      //   id:{
      //     not: 1
      //   },
      //   menus_config:{
      //     some:{
      //       menus_id: 82,
      //       f_noti_inapp: 1
      //     },
      //   }
      // },
      // include:{
      //   account_role:{
      //     include:{
      //       account_manage:{
      //         include:{
      //           account:true,
      //         },
      //       }
      //     }
      //   },
      //   menus_config:{
      //     include:{
      //       menus:true,
      //     },
      //     where:{
      //       menus_id: 82, //Allocation Management
      //       f_noti_inapp: 1
      //     },
      //   }
      // },
      orderBy: {
        id: "asc"
      },
    })

    const nAccount = roleMenuAllocationManagementNoticeInapp?.map((e: any) => {
      const { account_manage, ...nE } = e
      const role = account_manage?.[0]?.account_role?.[0]?.role?.name || null
      return {
        ...nE,
        role_name: role || null
      }
    })

    //     EOD
    //  The allocation and balancing process for all shippers and the following period of time: {01/09/2021 to 13/05/2025} {has finished OK} {(process executed on 13/05/2025 09:24:02)}.

    // Intraday
    //  The allocation and balancing process for all shippers and the following time: {01/09/2021} {has finished OK} {(process executed on 13/05/2025 09:24:02)}.

    // Case Error : EOD
    // The allocation and balancing process for all shippers and the following period of time: {01/09/2021 to 13/05/2025} has failed {(process attempted on 13/05/2025 09:24:02)}.

    // Case Error : Intraday
    // The allocation and balancing process for all shippers and the following time: {01/09/2021} has failed {(process attempted on 13/05/2025 09:24:02)}.


    // const message = `The allocation and balancing process for all shippers and the following period of time: {01/09/2021 ? 13/05/2025} {has finished OK} {(process executed on 13/05/2025 09:24:02)}.`

    return nAccount
  }

}
