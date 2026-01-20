import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as XLSX from 'xlsx-js-style';
import * as XlsxPopulate from 'xlsx-populate';
import * as fs from 'fs';

import customParseFormat from 'dayjs/plugin/customParseFormat';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import isBetween from 'dayjs/plugin/isBetween'; // นำเข้า plugin isBetween

dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);

@Injectable()
export class PlanningDashboardService {
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

  groupYearlyData(data) {
    const yearMap = new Map();

    data.year.forEach((date, index) => {
      if (!date) return; // ข้ามค่า null หรือ undefined
      const match = date.match(/\d{4}$/); // ค้นหาปีจาก YYYY หรือ DD/MM/YYYY
      if (match) {
        const year = match[0]; // ดึงปีออกมา
        const value = data.value[index] || 0; // ถ้า value เป็น undefined ให้เป็น 0

        if (yearMap.has(year)) {
          yearMap.set(year, yearMap.get(year) + value); // รวมค่า value
        } else {
          yearMap.set(year, value);
        }
      }
    });

    // แปลง Map เป็น array แล้วเรียงลำดับปีจากน้อยไปมาก
    const sortedYears = [...yearMap.entries()].sort((a, b) => a[0] - b[0]);

    // แยกเป็นอาร์เรย์ year กับ value
    return {
      year: sortedYears.map(entry => entry[0]),
      value: sortedYears.map(entry => entry[1])
    };
  }

  // period ?

  async dashboardLong(userId: any) {
    const resData =
      await this.prisma.query_shipper_planning_files_temp_long.findMany({
        include: {
          query_shipper_planning_files: {
            include: {
              group: {
                select: {
                  id: true,
                  id_name: true,
                  name: true,
                  company_name: true,
                },
              },
              query_shipper_planning_files_temp_row: true,
            },
          },
        },
      });
    const convertData = resData.map((e: any) => {
      const byrow = (e?.['query_shipper_planning_files']?.[
        'query_shipper_planning_files_temp_row'
      ] || [])?.map((row: any) => {
        row['value'] = this.safeParseJSON(row?.['value'], {});
        const keys = Object.keys(row?.['value'] || {}).map(key => parseInt(key)).filter(k => !isNaN(k));
        const maxKey = keys?.length > 0 ? Math.max(...keys) : 0;

        const newData = {};
        for (let i = 6; i <= maxKey; i++) {
          const valObj = row?.['value']?.[i];
          if (valObj) {
            newData[i] = { year: valObj?.year, value: valObj?.value ? Number(valObj?.value.toString().replace(/,/g, '')) : 0 };
          }
        }

        // สร้างอ็อบเจ็กต์ที่จัดกลุ่มข้อมูลตามปี
        const groupedData = {};
        // ลูปผ่านข้อมูลเพื่อจัดกลุ่ม
        for (const key in newData) {
          const year = newData[key]?.year;
          const value = newData[key]?.value;
          if (!year) continue;

          if (!groupedData[year]) {
            groupedData[year] = { year: year, value: [] };
          }
          groupedData[year].value.push(value);
        }

        // สร้างอ็อบเจ็กต์ใหม่ที่จัดกลุ่มปีและรวมค่า value
        const result = {
          year: [],
          value: []
        };

        // ลูปผ่าน groupedData และรวมค่า value
        for (const year in groupedData) {
          const data = groupedData[year];
          result.year.push(data.year); // เพิ่มปี
          result.value.push(data.value.reduce((acc, curr) => {
            return acc + curr
          }, 0)); // รวมค่า value
        }

        const groupYear = this.groupYearlyData(result)

        return {
          id: row?.['id'],
          nomination_point: row?.['value']?.['2'],
          customer: row?.['value']?.['3'],
          area: row?.['value']?.['4'],
          unit: row?.['value']?.['5'],
          entry_exit_id: row?.['value']?.['1'] === "Entry" ? 1 : 2,
          entry_exit: row?.['value']?.['1'],
          ...groupYear
        };
      });

      e['byrow'] = byrow || [];

      e['planning_code_id'] = e?.['query_shipper_planning_files']?.['id'];
      e['planning_code'] = e?.['query_shipper_planning_files']?.['planning_code'];
      e['group'] = e?.['query_shipper_planning_files']?.['group'];
      e['start_date'] = e?.['query_shipper_planning_files']?.['start_date'];
      e['end_date'] = e?.['query_shipper_planning_files']?.['end_date'];
      e['shipper_file_submission_date'] =
        e?.['query_shipper_planning_files']?.['shipper_file_submission_date'];

      return {
        data: e['byrow'],
        planning_code_id: e['planning_code_id'],
        planning_code: e['planning_code'],
        group: e['group'],
        start_date: e['start_date'],
        end_date: e['end_date'],
        shipper_file_submission_date: e['shipper_file_submission_date'],
      };
    });
    console.log('convertData : ', convertData);
    const areaArr = convertData?.flatMap((e: any) => {
      const areaSp = e['data'].map((ar: any) => {
        return ar['area']
      })
      return areaSp
    })
    const areaDb = await this.prisma.area.findMany({
      where: {
        name: {
          in: areaArr || []
        }
      },
      select: {
        id: true,
        name: true,
        color: true,
      }
    })
    const newConvertData = convertData.map((e: any) => {
      e['data'] = e['data'].map((eData: any) => {
        const findArea = areaDb.find((f: any) => { return f?.name === eData['area'] })
        if (findArea) {
          eData['area'] = findArea
        } else {
          eData['area'] = {
            id: null,
            name: eData['area'],
            color: null,
          }
        }
        return eData
      })
      return e
    })

    return newConvertData;
  }

  async dashboardMedium(userId: any) {
    const resData =
      await this.prisma.query_shipper_planning_files_temp_medium.findMany({
        include: {
          query_shipper_planning_files: {
            include: {
              group: {
                select: {
                  id: true,
                  id_name: true,
                  name: true,
                  company_name: true,
                },
              },
              query_shipper_planning_files_temp_row: true,
            },
          },
        },
      });

    const convertData = resData.map((e: any) => {
      e['byrow'] = (e?.['query_shipper_planning_files']?.[
        'query_shipper_planning_files_temp_row'
      ] || [])?.map((row: any) => {
        row['value'] = this.safeParseJSON(row?.['value'], {});
        const keys = Object.keys(row?.['value'] || {}).map(key => parseInt(key)).filter(k => !isNaN(k));
        const maxKey = keys?.length > 0 ? Math.max(...keys) : 0;

        const newData = {};
        for (let i = 6; i <= maxKey; i++) {
          const valObj = row?.['value']?.[i];
          if (valObj) {
            newData[i] = { month: valObj?.month, value: valObj?.value ? Number(valObj?.value.toString().replace(/,/g, '')) : 0 };
          }
        }

        // สร้างอ็อบเจ็กต์ที่จัดกลุ่มข้อมูลตามปี
        const groupedData = {};

        // ลูปผ่านข้อมูลเพื่อจัดกลุ่ม
        for (const key in newData) {
          const month = newData[key]?.month;
          const value = newData[key]?.value;
          if (!month) continue;

          if (!groupedData[month]) {
            groupedData[month] = { month: month, value: [] };
          }
          groupedData[month].value.push(value);
        }

        // สร้างอ็อบเจ็กต์ใหม่ที่จัดกลุ่มปีและรวมค่า value
        const result = {
          month: [],
          value: []
        };

        // ลูปผ่าน groupedData และรวมค่า value
        for (const month in groupedData) {
          const data = groupedData[month];
          result.month.push(data.month); // เพิ่มปี
          result.value.push(data.value.reduce((acc, curr) => acc + curr, 0)); // รวมค่า value
        }


        return {
          id: row?.['id'],
          nomination_point: row?.['value']?.['2'],
          customer: row?.['value']?.['3'],
          area: row?.['value']?.['4'],
          unit: row?.['value']?.['5'],
          entry_exit_id: row?.['value']?.['1'] === "Entry" ? 1 : 2,
          entry_exit: row?.['value']?.['1'],
          ...result
        };
      });

      e['planning_code_id'] = e?.['query_shipper_planning_files']?.['id'];
      e['planning_code'] = e?.['query_shipper_planning_files']?.['planning_code'];
      e['group'] = e?.['query_shipper_planning_files']?.['group'];
      e['start_date'] = e?.['query_shipper_planning_files']?.['start_date'];
      e['end_date'] = e?.['query_shipper_planning_files']?.['end_date'];
      e['shipper_file_submission_date'] =
        e?.['query_shipper_planning_files']?.['shipper_file_submission_date'];

      return {
        data: e['byrow'],
        planning_code_id: e['planning_code_id'],
        planning_code: e['planning_code'],
        group: e['group'],
        start_date: e['start_date'],
        end_date: e['end_date'],
        shipper_file_submission_date: e['shipper_file_submission_date'],
      };
    });

    const areaArr = convertData?.flatMap((e: any) => {
      const areaSp = e['data'].map((ar: any) => {
        return ar['area']
      })
      return areaSp
    })
    const areaDb = await this.prisma.area.findMany({
      where: {
        name: {
          in: areaArr || []
        }
      },
      select: {
        id: true,
        name: true,
        color: true,
      }
    })
    const newConvertData = convertData.map((e: any) => {
      e['data'] = e['data'].map((eData: any) => {
        const findArea = areaDb.find((f: any) => { return f?.name === eData['area'] })
        if (findArea) {
          eData['area'] = findArea
        } else {
          eData['area'] = {
            id: null,
            name: eData['area'],
            color: null,
          }
        }
        return eData
      })
      return e
    })

    return newConvertData;
  }

  async dashboardShort(userId: any) {
    const resData =
      await this.prisma.query_shipper_planning_files_temp_short.findMany({
        include: {
          query_shipper_planning_files: {
            include: {
              group: {
                select: {
                  id: true,
                  id_name: true,
                  name: true,
                  company_name: true,
                },
              },
              query_shipper_planning_files_temp_row: true,
            },
          },
        },
      });

    const convertData = resData.map((e: any) => {
      e['byrow'] = (e?.['query_shipper_planning_files']?.[
        'query_shipper_planning_files_temp_row'
      ] || [])?.map((row: any) => {
        row['value'] = this.safeParseJSON(row?.['value'], {});
        const keys = Object.keys(row?.['value'] || {}).map(key => parseInt(key)).filter(k => !isNaN(k));
        const maxKey = keys?.length > 0 ? Math.max(...keys) : 0;

        const newData = {};
        for (let i = 6; i <= maxKey; i++) {
          const valObj = row?.['value']?.[i];
          if (valObj) {
            newData[i] = { day: valObj?.day, value: valObj?.value ? Number(valObj?.value.toString().replace(/,/g, '')) : 0 };
          }
        }

        // สร้างอ็อบเจ็กต์ที่จัดกลุ่มข้อมูลตามปี
        const groupedData = {};

        // ลูปผ่านข้อมูลเพื่อจัดกลุ่ม
        for (const key in newData) {
          const day = newData[key]?.day;
          const value = newData[key]?.value;
          if (!day) continue;

          if (!groupedData[day]) {
            groupedData[day] = { day: day, value: [] };
          }
          groupedData[day].value.push(value);
        }

        // สร้างอ็อบเจ็กต์ใหม่ที่จัดกลุ่มปีและรวมค่า value
        const result = {
          day: [],
          value: []
        };

        // ลูปผ่าน groupedData และรวมค่า value
        for (const day in groupedData) {
          const data = groupedData[day];
          result.day.push(data.day); // เพิ่มปี
          result.value.push(data.value.reduce((acc, curr) => acc + curr, 0)); // รวมค่า value
        }


        return {
          id: row?.['id'],
          nomination_point: row?.['value']?.['2'],
          customer: row?.['value']?.['3'],
          area: row?.['value']?.['4'],
          unit: row?.['value']?.['5'],
          entry_exit_id: row?.['value']?.['1'] === "Entry" ? 1 : 2,
          entry_exit: row?.['value']?.['1'],
          ...result
        };
      });

      e['planning_code_id'] = e?.['query_shipper_planning_files']?.['id'];
      e['planning_code'] = e?.['query_shipper_planning_files']?.['planning_code'];
      e['group'] = e?.['query_shipper_planning_files']?.['group'];
      e['start_date'] = e?.['query_shipper_planning_files']?.['start_date'];
      e['end_date'] = e?.['query_shipper_planning_files']?.['end_date'];
      e['shipper_file_submission_date'] =
        e?.['query_shipper_planning_files']?.['shipper_file_submission_date'];

      return {
        data: e['byrow'],
        planning_code_id: e['planning_code_id'],
        planning_code: e['planning_code'],
        group: e['group'],
        start_date: e['start_date'],
        end_date: e['end_date'],
        shipper_file_submission_date: e['shipper_file_submission_date'],
      };
    });

    const areaArr = convertData?.flatMap((e: any) => {
      const areaSp = e['data'].map((ar: any) => {
        return ar['area']
      })
      return areaSp
    })
    const areaDb = await this.prisma.area.findMany({
      where: {
        name: {
          in: areaArr || []
        }
      },
      select: {
        id: true,
        name: true,
        color: true,
      }
    })
    const newConvertData = convertData.map((e: any) => {
      e['data'] = e['data'].map((eData: any) => {
        const findArea = areaDb.find((f: any) => { return f?.name === eData['area'] })
        if (findArea) {
          eData['area'] = findArea
        } else {
          eData['area'] = {
            id: null,
            name: eData['area'],
            color: null,
          }
        }
        return eData
      })
      return e
    })

    return newConvertData;
  }
}
