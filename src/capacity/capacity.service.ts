import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as XLSX from 'xlsx-js-style';
import * as fs from 'fs';
import * as FormData from 'form-data';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import isBetween from 'dayjs/plugin/isBetween'; // นำเข้า plugin isBetween
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'; // นำเข้า plugin isSameOrBefore
import axios from 'axios';
import { PathManagementService } from 'src/path-management/path-management.service';
import {
  getTodayEndAdd7,
  getTodayNowAdd7,
  getTodayNowDDMMYYYYAdd7,
  getTodayNowDDMMYYYYDfaultAdd7,
  getTodayStartAdd7,
} from 'src/common/utils/date.util';
import { uploadFilsTemp } from 'src/common/utils/uploadFileIn';
dayjs.extend(isSameOrBefore); // เปิดใช้งาน plugin isSameOrBefore
dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class CapacityService {
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

  transformedDataObj(data: any) {
    if (!data || typeof data !== 'object') return [];
    return Object.entries(data).map(([key, value]) => {
      return { key, value };
    });
  }

  transformedKeys(data: any) {
    if (!data || !Array.isArray(data)) return [];
    return data.map((item: any) => {
      const transformedItem = {};
      if (!item) return transformedItem;
      Object.keys(item).forEach((key) => {
        // ดึงเฉพาะตัวเลขจากคีย์ __EMPTY และใช้มันเป็นคีย์ใหม่
        const match = key.match(/__EMPTY(?:_(\d+))?/);
        const newKey = match && match[1] ? match[1] : '0';
        transformedItem[newKey] = item[key];
      });

      return transformedItem;
    });
  }

  transformedKeysValue(data: any) {
    if (!data || typeof data !== 'object') return {};
    return Object.keys(data).reduce((acc, key) => {
      const newKey = data[key]; // ใช้ค่าเดิมเป็นคีย์ใหม่
      acc[newKey] = { key, value: null }; // สร้างอ็อบเจ็กต์ใหม่ที่มี key และ value เป็น null
      return acc;
    }, {});
  }

  objToArray(obj: any) {
    if (!obj || typeof obj !== 'object') return [];
    return Object.keys(obj).map((key) => ({
      key: key, // ใช้คีย์เดิม
      value: obj[key], // ค่าเดิมของอ็อบเจ็กต์
    }));
  }

  getKeyByValue(obj: any, value: any) {
    if (!obj || typeof obj !== 'object') return undefined;
    return Object.keys(obj).find((key) => obj[key] === value);
  }

  filteredDataKeyNum(data: any, num: any) {
    return Object.keys(data)
      .filter((key) => parseInt(key) < num) // กรองเฉพาะคีย์ที่มีค่าตัวเลขน้อยกว่า 48
      .reduce((obj, key) => {
        obj[key] = data[key]; // สร้างอ็อบเจ็กต์ใหม่จากคีย์ที่ผ่านการกรอง
        return obj;
      }, {});
  }

  filteredMoreKeyNum(data: any, num: any) {
    return Object.keys(data)
      .filter((key) => parseInt(key) >= num) // กรองเฉพาะคีย์ที่มีค่าตัวเลขน้อยกว่า 48
      .reduce((obj, key) => {
        obj[key] = data[key]; // สร้างอ็อบเจ็กต์ใหม่จากคีย์ที่ผ่านการกรอง
        return obj;
      }, {});
  }

  matchKeyValue(originalData: any, newData: any): any {
    Object.keys(originalData).forEach((key) => {
      const originalKey = originalData[key].key;
      if (newData.hasOwnProperty(originalKey)) {
        originalData[key].value = newData[originalKey]; // อัปเดต value
      }
    });
    return originalData; // คืนค่า originalData ที่อัปเดตแล้ว
  }

  excelDateToJSDate(serial: any) {
    const excelStartDate = new Date(1900, 0, 1); // วันที่ 1 มกราคม 1900
    const days = serial - 1; // Excel เริ่มนับจากวันที่ 1 มกราคม 1900 เป็น 1
    excelStartDate.setDate(excelStartDate.getDate() + days);
    return excelStartDate;
  }

  mergeData(mainObj: any, dataObj: any, e: any) {
    const keys = Object.keys(mainObj); // เก็บคีย์ทั้งหมดของ mainObj

    Object.keys(mainObj).forEach((key, index) => {
      const startKey = parseInt(mainObj[key].key); // จุดเริ่มต้นของช่วงใน mainObj
      let endKey = Number.MAX_SAFE_INTEGER; // กำหนดค่าเริ่มต้นของ endKey เป็น Max ถ้าไม่มีคีย์ถัดไป

      // ถ้ามีคีย์ถัดไปใน mainObj, ให้ endKey เป็น key ของลำดับถัดไป - 1
      if (index + 1 < keys.length) {
        const nextKey = parseInt(mainObj[keys[index + 1]].key);
        endKey = nextKey - 1; // กำหนด endKey เป็นคีย์ถัดไป - 1
      }

      // ตรวจสอบและเพิ่มข้อมูลจาก dataObj ที่อยู่ในช่วงที่กำหนด
      Object.keys(dataObj).forEach((dataKey) => {
        const numDataKey = parseInt(dataKey); // แปลงคีย์ของ dataObj เป็นตัวเลข
        if (numDataKey >= startKey && numDataKey <= endKey) {
          // อัปเดต value ของ mainObj ชั้นแรกให้ตรงกับค่าใน e หรือ dataObj
          if (mainObj[key].value === null && e[dataKey]) {
            mainObj[key].value = e[dataKey]; // ตั้งค่า value ของชั้นแรก
          }

          // ใช้ค่าจาก e สำหรับ value ของคีย์ที่ตรงกันในชั้นย่อย
          mainObj[key][dataObj[dataKey]] = {
            key: dataKey,
            value: e[dataKey] || dataObj[dataKey], // ใช้ค่า e[dataKey] ถ้ามี
          };
        }
      });
    });

    return mainObj;
  }

  mergeSumValues(mainObj: any, sumObj: any) {
    // วนลูปผ่านคีย์หลักใน mainObj
    Object.keys(mainObj).forEach((key) => {
      // วนลูปผ่านคีย์ย่อยใน mainObj
      Object.keys(mainObj[key]).forEach((subKey) => {
        // ตรวจสอบว่ามีค่า mainObj[key][subKey] และมี property 'key' อยู่ก่อน
        const subKeyAsNumber = mainObj[key][subKey]?.key; // ใช้ Optional chaining
        if (subKeyAsNumber && sumObj[subKeyAsNumber]) {
          // ถ้าคีย์ตรงกัน ให้เพิ่มค่า sum เข้าไป
          mainObj[key][subKey]['sum'] = sumObj[subKeyAsNumber];
        }
      });
    });

    return mainObj;
  }

  excelSerialToDate(serial: number): Date {
    const excelStartDate = new Date(1900, 0, 1); // วันที่ 1 มกราคม 1900
    const days = serial - 2; // 2 เนื่องจาก Excel มีบั๊ก leap year
    excelStartDate.setDate(excelStartDate.getDate() + days);
    return excelStartDate;
  }

  async transformData(tempShortTerm: any) {
    const groupedData: any = {
      shipperInfo: {},
      entries: [],
      exits: [],
      sumEntries: {},
      sumExits: {},
    };

    const checkShipperInfoHead = this.transformedDataObj(tempShortTerm[0]);
    if (checkShipperInfoHead && Array.isArray(checkShipperInfoHead)) {
      checkShipperInfoHead.map((e: any, i: any) => {
        if (e?.value && tempShortTerm && tempShortTerm[1] && e?.key) {
          groupedData.shipperInfo[
            (e.value).split(' ').join('').split('\r').join('').split('\n').join('')
          ] = tempShortTerm[1][e.key];
        }
        return e;
      });
    }

    const entryIndex = tempShortTerm.findIndex(
      (item: any) => item.__EMPTY && item.__EMPTY.trim() === 'Entry',
    );
    const exitIndex = tempShortTerm.findIndex(
      (item: any) => item.__EMPTY && item.__EMPTY.trim() === 'Exit',
    );

    const sumEntryIndex = tempShortTerm.findIndex((item, index) => {
      return (
        index >= 2 &&
        index <= exitIndex - 1 &&
        item.__EMPTY &&
        item.__EMPTY.trim() === 'Sum Entry'
      );
    });
    const sumExitIndex = tempShortTerm.findIndex((item, index) => {
      return (
        index >= exitIndex && item.__EMPTY && item.__EMPTY.trim() === 'Sum Exit'
      );
    });

    const subsetEntry = this.transformedKeys(
      tempShortTerm.slice(entryIndex + 3, sumEntryIndex),
    );
    const subsetExit = this.transformedKeys(
      tempShortTerm.slice(exitIndex + 3, sumExitIndex),
    );

    // entry
    const headEntry = {
      ...this.transformedKeys([tempShortTerm[entryIndex]])[0],
    };
    const headEntry1 = {
      ...this.transformedKeys([tempShortTerm[entryIndex + 1]])[0],
    };
    const headEntry2 = {
      ...this.transformedKeys([tempShortTerm[entryIndex + 2]])[0],
    };
    const periodKey = this.getKeyByValue(headEntry, 'Period');
    if (!periodKey) {
      console.warn('Period key not found in headEntry');
    }

    const headerMainNotPeriod = this.filteredDataKeyNum(
      headEntry1,
      Number(periodKey),
    );
    const headerMain = this.transformedKeysValue(headerMainNotPeriod);

    const headerMainMorePeriodMain = this.filteredMoreKeyNum(
      headEntry,
      Number(periodKey),
    );
    const headerMainMorePeriod: any = this.transformedKeysValue(
      headerMainMorePeriodMain,
    );
    const newEntry = subsetEntry.map((e: any, i: any) => {
      const valueNotPeriod = this.filteredDataKeyNum(e, Number(periodKey));
      const resultMatch = this.matchKeyValue(headerMain, valueNotPeriod);

      const path1 = this.mergeData(resultMatch, headEntry2, e);
      const path2 = this.mergeData(headerMainMorePeriod, headEntry1, e);

      return {
        ...path1,
        ...path2,
      };
    });
    groupedData.entries = newEntry;

    const { Period, ...filteredDataEntry } = headerMainMorePeriod;
    const sumEntryIndexKeys = {
      ...this.transformedKeys([tempShortTerm[sumEntryIndex]])[0],
    };
    const entrySum = this.mergeSumValues(filteredDataEntry, sumEntryIndexKeys);
    groupedData.sumEntries = entrySum;

    // exit
    const headExit = {
      ...this.transformedKeys([tempShortTerm[exitIndex]])[0],
    };
    const headExit1 = {
      ...this.transformedKeys([tempShortTerm[exitIndex + 1]])[0],
    };
    const headExit2 = {
      ...this.transformedKeys([tempShortTerm[exitIndex + 2]])[0],
    };
    const periodKeyExit = this.getKeyByValue(headExit, 'Period');
    if (!periodKeyExit) {
      console.warn('Period key not found in headExit');
    }

    const headerMainNotPeriodExit = this.filteredDataKeyNum(
      headExit1,
      Number(periodKeyExit),
    );
    const headerMainExit = this.transformedKeysValue(headerMainNotPeriodExit);

    const headerMainMorePeriodMainExit = this.filteredMoreKeyNum(
      headExit,
      Number(periodKeyExit),
    );
    const headerMainMorePeriodExit: any = this.transformedKeysValue(
      headerMainMorePeriodMainExit,
    );
    const newExit = subsetExit.map((e: any, i: any) => {
      const valueNotPeriod = this.filteredDataKeyNum(e, Number(periodKeyExit));
      const resultMatch = this.matchKeyValue(headerMainExit, valueNotPeriod);

      const path1 = this.mergeData(resultMatch, headExit2, e);
      const path2 = this.mergeData(headerMainMorePeriodExit, headExit1, e);

      return {
        ...path1,
        ...path2,
      };
    });
    groupedData.exits = newExit;

    const { Period: PeriodExit, ...filteredDataExit } =
      headerMainMorePeriodExit;
    const sumExitIndexKeys = {
      ...this.transformedKeys([tempShortTerm[sumExitIndex]])[0],
    };
    const exitSum = this.mergeSumValues(filteredDataExit, sumExitIndexKeys);
    groupedData.sumExits = exitSum;

    return groupedData;
  }

  async capacityRequestManagement() {
    const resData = await this.prisma.contract_code.findMany({
      include: {
        type_account: true,
        term_type: true,
        ref_contract_code_by: true,
        group: true,
        submission_comment_capacity_request_management: {
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
        status_capacity_request_management_process: true,
        status_capacity_request_management: true,
        file_capacity_request_management: {
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
        extend_contract_capacity_request_management: true,
        book_capacity_request_management: {
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
        booking_version: {
          include: {
            booking_version_comment: {
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
            booking_full_json: true,
            booking_row_json: true,
            booking_full_json_release: true,
            booking_row_json_release: true,
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
            status_capacity_request_management: true,
            type_account: true,
          },
          orderBy: {
            id: 'desc',
          },
        },
      },
      orderBy: { id: 'desc' },
    });

    return resData;
  }

  async getGroupByIdAccount(id: any) {
    return await this.prisma.group.findFirst({
      where: {
        account_manage: {
          some: {
            account_id: Number(id),
          },
        },
      },
    });
  }


  extendDates(data, shadowPeriod) {
    const clonedData = data ? this.safeParseJSON(JSON.stringify(data)) : null;

    if (!data || data.length === 0) return clonedData;

    // หาวันที่มากที่สุดในข้อมูลเดิม
    const maxDate = dayjs(data[data.length - 1].date);
    // หาค่า value ของวันที่มากที่สุด
    const maxValue = data[data.length - 1].value;

    // เพิ่มข้อมูลวันที่ใหม่

    //
    const newMax = maxDate.add(shadowPeriod, 'month');
    let newDate = maxDate;
    let i = 1;
    // console.log('------> : ', newDate);
    while (newDate.isSameOrBefore(newMax)) {
      newDate = maxDate.add(i, 'day');
      clonedData.push({ date: newDate.format('YYYY-MM-DD'), value: maxValue });
      i++;
    }

    return clonedData; // คืนค่า clonedData ที่แก้ไขแล้ว
  }

  async pathDetailCapacityRequestManagement(file: any, userId: any) {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // แปลงข้อมูลจาก Excel เป็น JSON
    const json = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false, // แปลงตัวเลขในฟอร์แมตที่ Excel ใช้
      dateNF: 'yyyy-mm-dd', // กำหนดฟอร์แมตวันที่
    });
    const transformedData = json.map((row: any) => {
      const transformedRow = {};

      row.forEach((cell, index) => {
        if (cell !== '' && cell !== null && cell !== undefined) {
          // กรองเฉพาะค่าสำคัญ
          const key = index === 0 ? '__EMPTY' : `__EMPTY_${index}`;
          transformedRow[key] = cell;

          // ถ้าเป็น serial date ให้แปลงเป็นวันที่
          if (typeof cell === 'number' && cell > 40000) {
            transformedRow[key] =
              this.excelSerialToDate(cell).toLocaleDateString();
          }
        }
      });

      return transformedRow;
    });

    const cleanedData = transformedData.filter(
      (row) => Object.keys(row).length > 0,
    ); // คงไว้เฉพาะแถวที่มีข้อมูล

    return {
      // file,
      cleanedData,
      originalname: file?.originalname,
      data: await this.transformData(cleanedData),
    };
  }

  termType() {
    return this.prisma.term_type.findMany({
      orderBy: {
        id: 'asc',
      },
    });
  }

  typeAccount() {
    return this.prisma.type_account.findMany({
      orderBy: {
        id: 'asc',
      },
    });
  }

  statusCapacityRequestManagement() {
    return this.prisma.status_capacity_request_management.findMany({
      orderBy: {
        id: 'asc',
      },
    });
  }

  statusCapacityRequestManagementProcess() {
    return this.prisma.status_capacity_request_management_process.findMany({
      orderBy: {
        id: 'asc',
      },
    });
  }


  generateMonthArray(
    startDate: string,
    endDate: string,
    fixDay: number,
  ): string[] {
    const starts = startDate ? getTodayNowDDMMYYYYAdd7(startDate) : null;
    const ends = endDate ? getTodayNowDDMMYYYYAdd7(endDate) : null;
    if (!starts || !ends) {
      return [];
    }
    const result = [];
    let current = starts.clone();

    while (current.isBefore(ends, 'month') || current.isSame(ends, 'month')) {
      // กำหนดวันที่เป็น fixDay หรือวันสุดท้ายของเดือนถ้า fixDay ไม่มีในเดือนนั้น
      const dayInMonth = current.daysInMonth();
      const dateToAdd = current.date(Math.min(fixDay, dayInMonth));

      // ตรวจสอบว่าหากวันของเดือนเกิน endDate แล้วให้หยุดการเพิ่มข้อมูล
      if (dateToAdd.isAfter(ends, 'day')) break;

      result.push(dateToAdd.format('DD/MM/YYYY'));
      current = current.add(1, 'month').startOf('month');
    }

    return result;
  }


  generateDailyArray(startDate: string, endDate: string): string[] {
    const starts = startDate ? getTodayNowDDMMYYYYAdd7(startDate) : null;
    const ends = endDate ? getTodayNowDDMMYYYYAdd7(endDate) : null;
    if (!starts || !ends) {
      return [];
    }
    const result = [];
    let current = starts.clone();

    while (current.isBefore(ends, 'day') || current.isSame(ends, 'day')) {
      result.push(current.format('DD/MM/YYYY'));
      current = current.add(1, 'day'); // เพิ่มทีละวัน
    }
    return result;
  }


  adjustStartDate(startDate: any, fixDay: any) {
    const today = dayjs(); // วันที่ปัจจุบัน
    let start = dayjs(startDate, 'DD/MM/YYYY', true); // วันที่เริ่มต้นจาก input

    // ตรวจสอบจำนวนวันในเดือนของ startDate
    const daysInMonth = start.daysInMonth();
    // ตรวจสอบว่า fixDay อยู่ในเดือนของ startDate หรือไม่
    if (fixDay <= daysInMonth) {
      // ตั้งวันที่เป็น fixDay ในเดือนปัจจุบัน
      start = start.date(fixDay);
    } else {
      // ถ้า fixDay ไม่มีในเดือนปัจจุบัน ให้เลื่อนไปวันสุดท้ายของเดือนถัดไป
      start = start.add(1, 'month');
      const nextDaysInMonth = start.daysInMonth();
      start = start.date(Math.min(fixDay, nextDaysInMonth));
    }

    return start.format('DD/MM/YYYY');
  }


  checkDateRange(
    startDate: string,
    endDate: string,
    file_period_mode: number,
    min: number,
    max: number,
  ): boolean {
    const starts = startDate ? getTodayNowDDMMYYYYAdd7(startDate) : null;
    const ends = endDate ? getTodayNowDDMMYYYYAdd7(endDate) : null;
    if (!starts || !ends) {
      return false;
    }
    let diff;

    // คำนวณความแตกต่างตามโหมดที่กำหนด
    if (file_period_mode === 1) {
      diff = ends.diff(starts, 'day'); // คำนวณต่างกันเป็นจำนวนวัน
    } else if (file_period_mode === 2) {
      // diff = ends.diff(starts, 'month'); // คำนวณต่างกันเป็นจำนวนเดือน
      diff = ends.endOf('month').diff(starts.startOf('month'), 'month'); // นับเดือนจากต้นเดือนถึงสิ้นเดือน
    } else if (file_period_mode === 3) {
      diff = ends.diff(starts, 'year'); // คำนวณต่างกันเป็นจำนวนปี
    } else {
      return false; // กรณี mode ไม่ตรงกับเงื่อนไขที่กำหนด
    }

    return diff >= min && diff <= max;
  }


  async getGroupByName(name: any) {
    return await this.prisma.group.findFirst({
      where: {
        name: name,
        user_type_id: 3,
      },
    });
  }


  async getContractPointByName(name: any, group: any) {
    // group เช็ค กับ shipper อีกที
    return await this.prisma.contract_point.findFirst({
      select: {
        id: true,
        contract_point: true,
        area: {
          select: {
            id: true,
            name: true,
          },
        },
        zone: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      where: {
        contract_point: name,
      },
    });
  }


  generateExpectedDates = (start, end, mode, fixday, todayday) => {
    const dates = [];
    let current = dayjs(start, 'DD/MM/YYYY');
    const endDay = dayjs(end, 'DD/MM/YYYY');

    if (mode === 1) {
      while (current.isBefore(endDay) || current.isSame(endDay)) {
        dates.push(current.format('DD/MM/YYYY'));
        current = current.add(1, 'day');
      }
    } else if (mode === 2) {
      while (current.isBefore(endDay) || current.isSame(endDay)) {
        let targetDate = current.date(fixday);
        if (targetDate.month() !== current.month()) {
          targetDate = targetDate.endOf('month'); // ใช้วันสุดท้ายของเดือนหาก fixday ไม่มีในเดือนนั้น
        }
        dates.push(targetDate.format('DD/MM/YYYY'));
        current = current.add(1, 'month');
      }
    } else if (mode === 3) {
      current = current.add(todayday, 'day');
      while (current.isBefore(endDay) || current.isSame(endDay)) {
        dates.push(current.format('DD/MM/YYYY'));
        current = current.add(1, 'day');
      }
    }

    return dates;
  };


  validateDateEntries = (data, mode, fixday, todayday, minDate, maxDate) => {
    const start = data.start;
    const end = data.end;

    const result = { start, end, date: {} };

    for (const key in data.date) {
      const expectedDates = this.generateExpectedDates(
        minDate,
        maxDate,
        mode,
        fixday,
        todayday,
      );
      const actualDates = data.date[key];
      // console.log('actualDates.length : ', actualDates);
      // เช็คว่าจำนวนวันที่ตรงกันและว่ามีวันที่ตรงกันทั้งหมด
      const isLengthMatching = actualDates.length === expectedDates.length;
      const areDatesMatching = actualDates.every((date) => {
        return expectedDates.includes(date);
      });

      // // console.log('actualDates : ', actualDates);
      // // console.log('expectedDates : ', expectedDates);

      // // หาเฉพาะวันที่ที่มีใน actualDates แต่ไม่มีใน expectedDates
      // const unmatchedFromActual = actualDates.filter(date => !expectedDates.includes(date));

      // // หาเฉพาะวันที่ที่มีใน expectedDates แต่ไม่มีใน actualDates
      // const unmatchedFromExpected = expectedDates.filter(date => !actualDates.includes(date));

      // แสดงผล
      // console.log('Dates in actualDates but not in expectedDates:', unmatchedFromActual);
      // console.log('Dates in expectedDates but not in actualDates:', unmatchedFromExpected);
      const validationResult = isLengthMatching && areDatesMatching;

      result.date[key] = mode === 2 ? true : validationResult;
    }

    return result;
  };


  extractValidationResults = (result: any) => {
    return Object.values(result);
  };


  validateEndDate = ({
    configStart,
    configEnd,
    file_period_mode,
    shadow_time,
    startdate,
    endDate,
    shadow_period,
  }) => {
    const configEndDate = dayjs(configEnd, 'DD/MM/YYYY'); // วันที่ configEnd
    const configStartDate = dayjs(configStart, 'DD/MM/YYYY'); // วันที่ configStart
    const unit = file_period_mode === 2 ? 'month' : 'day'; // ใช้ file_period_mode กำหนดหน่วย
    const shadowDate = configEndDate.subtract(shadow_time, unit); // คำนวณ shadowDate
    const endDateParsed = dayjs(endDate, 'DD/MM/YYYY'); // แปลง endDate
    const shadowPeriod = configEndDate.add(shadow_period, unit); // คำนวณ shadowDate

    // เงื่อนไขที่ 1: endDate เท่ากับ configEnd และไม่เกิน shadowPeriod
    if (
      endDateParsed.isSame(configEndDate, 'day') ||
      endDateParsed.isSameOrBefore(shadowPeriod, 'day')
    ) {
      return true;
    }

    // เงื่อนไขที่ : endDate ต้องไม่หลัง configEnd
    if (!endDateParsed.isBefore(configEndDate.add(1, 'day'))) {
      return false;
    }

    // เงื่อนไขที่ : endDate ต้องอยู่ระหว่าง shadowDate ถึง configEnd
    if (endDateParsed.isSameOrAfter(shadowDate, 'day')) {
      return false;
    }

    // เงื่อนไขที่ : endDate อยู่ก่อน shadowDate แต่ต้องไม่น้อยกว่า configStart
    if (endDateParsed.isSameOrAfter(configStartDate, 'day')) {
      return true;
    }

    // นอกเหนือจากนี้
    return false;
  };


  async pathDetailCapacityRequestManagementTranformOld(
    data: any,
    userId: any,
    file: any,
    token: any,
  ) {
    const resultTranform = this.safeParseJSON(data?.json_data);
    console.log('resultTranform : ', resultTranform);
    const headerEntry = resultTranform?.headerEntry || {};
    const entryValue = resultTranform?.entryValue || [];
    const headerExit = resultTranform?.headerExit || {};
    const exitValue = resultTranform?.exitValue || [];
    const sumEntries = resultTranform?.sumEntries || {};
    const sumExits = resultTranform?.sumExits || {};

    let shipperName = null;
    let typeOfContract = null;
    let contractCode = null;

    Object.values(resultTranform?.shipperInfo).forEach((info: any) => {
      if (info['Shipper Name']) {
        shipperName = info['Shipper Name'];
      }
      if (info['Type of Contract']) {
        typeOfContract = info['Type of Contract'];
      }
      if (info['Contract Code']) {
        contractCode = info['Contract Code'] || '';
      }
    });

    const typeOfContractText =
      typeOfContract === 'LONG'
        ? 1
        : typeOfContract === 'MEDIUM'
          ? 2
          : typeOfContract === 'SHORT_FIRM'
            ? 3
            : typeOfContract === 'SHORT_NON_FIRM'
              ? 4
              : null;

    const getGroupByName = await this.getGroupByName(shipperName);

    if (!getGroupByName || !typeOfContractText || !contractCode) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Shipper Info does not match the value.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    const bookingTemplate = await this.prisma.booking_template.findFirst({
      where: {
        term_type_id: Number(typeOfContractText),
        start_date: {
          lte: todayEnd,
        },
        end_date: {
          gte: todayStart,
        },
      },
    });

    if (!bookingTemplate) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'booking template date not match',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const checkValueSum = {
      entry: {
        'Capacity Daily Booking (MMBTU/d)': [],
        'Maximum Hour Booking (MMBTU/h)': [],
        'Capacity Daily Booking (MMscfd)': [],
        'Maximum Hour Booking (MMscfh)': [],
      },
      exit: {
        'Capacity Daily Booking (MMBTU/d)': [],
        'Maximum Hour Booking (MMBTU/h)': [],
      },
    };

    const entryCompareNotMatch = [];
    const exitCompareNotMatch = [];

    const compareEntryExit = {
      'Capacity Daily Booking (MMBTU/d)': [],
      'Maximum Hour Booking (MMBTU/h)': [],
    };

    // Populate checkValueSum.entry
    for (const key in checkValueSum.entry) {
      if (headerEntry[key]) {
        Object.keys(headerEntry[key]).forEach((date) => {
          if (date !== 'key') {
            const entryKey = headerEntry[key][date]?.key;
            let sum = 0;
            entryValue.forEach((entry) => {
              if (entry[entryKey] !== undefined) {
                sum += parseFloat(entry[entryKey]) || 0;
              }
            });
            checkValueSum.entry[key].push({
              key: entryKey,
              sum,
              headerKey: date,
            });
          }
        });
      }
    }

    // Populate checkValueSum.exit
    for (const key in checkValueSum.exit) {
      if (headerExit[key]) {
        Object.keys(headerExit[key]).forEach((date) => {
          if (date !== 'key') {
            const exitKey = headerExit[key][date]?.key;
            let sum = 0;
            exitValue.forEach((exit) => {
              if (exit[exitKey] !== undefined) {
                sum += parseFloat(exit[exitKey]) || 0;
              }
            });
            checkValueSum.exit[key].push({
              key: exitKey,
              sum,
              headerKey: date,
            });
          }
        });
      }
    }

    // Compare checkValueSum.entry with sumEntries
    for (const key in checkValueSum.entry) {
      checkValueSum.entry[key].forEach((entryItem) => {
        const { key: entryKey, sum: calculatedSum, headerKey } = entryItem;
        const expectedSum = parseFloat(sumEntries[entryKey]) || 0;

        if (calculatedSum !== expectedSum) {
          entryCompareNotMatch.push({
            headerKey, // This will be the date, such as "01/11/2024"
            key: entryKey,
            description: key,
            calculatedSum,
            expectedSum,
            status: 'Mismatch',
          });
        }
      });
    }

    // Compare checkValueSum.exit with sumExits
    for (const key in checkValueSum.exit) {
      checkValueSum.exit[key].forEach((exitItem) => {
        const { key: exitKey, sum: calculatedSum, headerKey } = exitItem;
        const expectedSum = parseFloat(sumExits[exitKey]) || 0;

        if (calculatedSum !== expectedSum) {
          exitCompareNotMatch.push({
            headerKey, // This will be the date, such as "01/11/2024"
            key: exitKey,
            description: key,
            calculatedSum,
            expectedSum,
            status: 'Mismatch',
          });
        }
      });
    }

    // Compare each entry item with its corresponding exit item in compareEntryExit
    for (const key of [
      'Capacity Daily Booking (MMBTU/d)',
      'Maximum Hour Booking (MMBTU/h)',
    ]) {
      checkValueSum.entry[key].forEach((entryItem) => {
        const { key: entryKey, sum: entrySum, headerKey } = entryItem;
        const exitItem = checkValueSum.exit[key].find(
          (exit) => exit.key === entryKey,
        );

        if (exitItem) {
          const exitSum = exitItem.sum;
          if (entrySum !== exitSum) {
            compareEntryExit[key].push({
              description: key,
              headerKey, // This will be the date, such as "01/11/2024"
              key: entryKey,
              entrySum,
              exitSum,
              status: 'Mismatch',
            });
          }
        } else {
          // If no matching exit item found, consider it a mismatch
          compareEntryExit[key].push({
            description: key,
            headerKey,
            key: entryKey,
            entrySum,
            exitSum: null, // Indicate no matching exit sum found
            status: 'Mismatch (No Matching Exit)',
          });
        }
      });
    }

    const keyEntryPoint =
      resultTranform?.['headerEntry']?.['Entry']?.['Entry Point']?.['key'];
    const keyExitPoint =
      resultTranform?.['headerExit']?.['Exit']?.['Entry Point']?.['key'];
    const warningData = [];
    const newData = getTodayNowAdd7().format('YYYY/MM/DD HH:mm');

    let dEntryA: any = null;
    let dExitA: any = null;

    const keyEntryFrom =
      resultTranform?.['headerEntry']?.['Period']?.['From']?.['key'];
    const keyEntryTo =
      resultTranform?.['headerEntry']?.['Period']?.['To']?.['key'];
    const keyExitFrom =
      resultTranform?.['headerExit']?.['Period']?.['From']?.['key'];
    const keyExitTo =
      resultTranform?.['headerExit']?.['Period']?.['To']?.['key'];

    const dateStartAll: any = [];
    const dateEndAll: any = [];

    const newEntry = await Promise.all(
      entryValue.map(async (e: any, i: any) => {
        const entryPointName = e[keyEntryPoint];
        // let newStartDayPlus = dayjs(todayStart).add(1, 'day');
        const newStartDayPlus = dayjs(todayStart);

        // console.log('e[keyEntryFrom] : ', e[keyEntryFrom]);
        console.log('e[keyEntryFrom] : ', e[keyEntryFrom]);
        const useStart = dayjs(e[keyEntryFrom], 'DD/MM/YYYY');
        // console.log('useStart : ', useStart);

        // console.log('newStartDayPlus : ', newStartDayPlus);
        const isCheckMoreDate = useStart.isAfter(newStartDayPlus);
        let checkMinMax = false;

        console.log('useStart : ', useStart);
        console.log('newStartDayPlus : ', newStartDayPlus);
        console.log('isCheckMoreDate : ', isCheckMoreDate);
        if (!isCheckMoreDate) {
          console.log('-----------');
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error:
                'Period From date in the template must be later than today.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        checkMinMax = this.checkDateRange(
          e[keyEntryFrom],
          e[keyEntryTo],
          bookingTemplate?.file_period_mode,
          bookingTemplate?.min,
          bookingTemplate?.max,
        );

        if (!checkMinMax) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Date is NOT match',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        const headerEntryDate = resultTranform?.['headerEntry'];
        console.log('headerEntryDate : ', headerEntryDate);
        const keysGreaterThanEntryTo = Object.keys(e).filter(
          (key) => Number(key) > Number(keyEntryTo),
        );
        for (let is = 0; is < keysGreaterThanEntryTo.length; is++) {
          if (headerEntryDate) {
            Object.keys(headerEntryDate).forEach((capacityKey) => {
              const capacityDates = headerEntryDate[capacityKey];
              Object.keys(capacityDates).forEach((dateKey) => {
                const keyValue = capacityDates[dateKey]?.['key'];
                if (keysGreaterThanEntryTo[is] === keyValue) {
                  const dateToCheckCk = dayjs(e[dateKey], 'DD/MM/YYYY');
                  const startDateCk = dayjs(e[keyEntryFrom], 'DD/MM/YYYY');
                  const endDateCk = dayjs(e[keyEntryTo], 'DD/MM/YYYY');
                  dateStartAll.push(e[keyEntryFrom]);
                  dateEndAll.push(e[keyEntryTo]);

                  const isInRangeZero = dayjs(dateKey, 'DD/MM/YYYY').isBetween(
                    dayjs(e[keyEntryFrom], 'DD/MM/YYYY'),
                    dayjs(e[keyEntryTo], 'DD/MM/YYYY'),
                    'day',
                    '[]',
                  );

                  // เงื่อนไขตรวจสอบความถูกต้อง
                  let resultZero: boolean;
                  // if (isInRangeZero && e[keyValue] > 0) {
                  //   // อยู่ในช่วง และ value > 0 = ถูกต้อง
                  //   resultZero = true;
                  // } else if (!isInRangeZero && e[keyValue] === 0) {
                  //   // ไม่อยู่ในช่วง และ value === 0 = ถูกต้อง
                  //   resultZero = true;
                  // } else {
                  //   // นอกเหนือจากนี้ = ผิด
                  //   console.log('capacityKey : ', capacityKey);
                  //   console.log('dateKey : ', dateKey);
                  //   console.log('-- : ', e[keyValue]);
                  //   resultZero = false;
                  // }
                  if (!isInRangeZero && e[keyValue] === 0) {
                    resultZero = true;
                  } else if (!isInRangeZero) {
                    resultZero = false;
                  } else {
                    resultZero = true;
                  }
                  if (!resultZero) {
                    console.log('!resultZero : ', !resultZero);
                    console.log('startDateCk : ', startDateCk);
                    console.log('endDateCk : ', endDateCk);
                    console.log('e[keyEntryFrom] : ', e[keyEntryFrom]);
                    console.log('e[keyEntryTo] : ', e[keyEntryTo]);
                    console.log('dateKey : ', dateKey);
                    console.log('------- 2');
                    throw new HttpException(
                      {
                        status: HttpStatus.BAD_REQUEST,
                        error: 'Date is NOT match.',
                      },
                      HttpStatus.BAD_REQUEST,
                    );
                  }

                  const isInRange = dateToCheckCk.isBetween(
                    startDateCk,
                    endDateCk,
                    null,
                    '[]',
                  );

                  if (isInRange) {
                    if (Number(e[keyValue]) <= 0) {
                      if (!isCheckMoreDate) {
                        warningData.push(
                          `${capacityKey} [date : [${dateKey}] value : ${e[keyValue]}] Entry Point: ${entryPointName} not match system ${newData}`,
                        );
                      }
                    }
                  } else {
                    if (Number(e[keyValue]) !== 0) {
                      warningData.push(
                        `${capacityKey} [date : [${dateKey}] value : ${e[keyValue]}] Entry Point: ${entryPointName} not match system ${newData}`,
                      );
                    }
                  }
                  if (!dEntryA) {
                    dEntryA = {};
                  }

                  // ตรวจสอบและกำหนดค่าเริ่มต้นให้กับ dEntryA[i]
                  if (!dEntryA[i]) {
                    dEntryA[i] = {
                      start: e[keyEntryFrom],
                      end: e[keyEntryTo],
                      date: { [capacityKey]: [] },
                    };
                  }

                  dEntryA = {
                    ...dEntryA,
                    [i]: {
                      start: e[keyEntryFrom],
                      end: e[keyEntryTo],
                      date: {
                        ...dEntryA[i]['date'],
                        [capacityKey]: [
                          ...(dEntryA[i]['date'][capacityKey] || []),
                          dateKey,
                        ],
                      },
                    },
                  };
                }
              });
            });
          }
        }

        const getContractPointByName = await this.getContractPointByName(
          entryPointName,
          getGroupByName?.id || null,
        );
        if (!getContractPointByName) {
          warningData.push(
            `Entry Point: ${entryPointName} not match system ${newData}`,
          );
        }
        return {
          data: e,
          contract_point: e['5'],
          area: e['1'] || null,
          zone: e['0'] || null,
          contractPointName: entryPointName || null,
        };
      }),
    );

    const newExit = await Promise.all(
      exitValue.map(async (e: any, i: any) => {
        const exitPointName = e[keyExitPoint];

        // let newStartDayPlus = dayjs(todayStart).add(1, 'day');
        const newStartDayPlus = dayjs(todayStart);
        const useStart = dayjs(e[keyExitFrom], 'DD/MM/YYYY');
        const isCheckMoreDate = useStart.isAfter(newStartDayPlus);
        let checkMinMax = false;

        if (!isCheckMoreDate) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error:
                'Period From date in the template must be later than today.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        checkMinMax = this.checkDateRange(
          e[keyExitFrom],
          e[keyExitTo],
          bookingTemplate?.file_period_mode,
          bookingTemplate?.min,
          bookingTemplate?.max,
        );
        if (!checkMinMax) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Date is NOT match',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        const headerExitDate = resultTranform?.['headerExit'];
        const keysGreaterThanExitTo = Object.keys(e).filter(
          (key) => Number(key) > Number(keyExitTo),
        );
        for (let is = 0; is < keysGreaterThanExitTo.length; is++) {
          if (headerExitDate) {
            Object.keys(headerExitDate).forEach((capacityKey) => {
              const capacityDates = headerExitDate[capacityKey];
              Object.keys(capacityDates).forEach((dateKey) => {
                const keyValue = capacityDates[dateKey]?.['key'];
                if (keysGreaterThanExitTo[is] === keyValue) {
                  const dateToCheckCk = dayjs(e[dateKey], 'DD/MM/YYYY');
                  const startDateCk = dayjs(e[keyExitFrom], 'DD/MM/YYYY');
                  const endDateCk = dayjs(e[keyExitTo], 'DD/MM/YYYY');
                  dateStartAll.push(e[keyEntryFrom]);
                  dateEndAll.push(e[keyEntryTo]);
                  const isInRange = dateToCheckCk.isBetween(
                    startDateCk,
                    endDateCk,
                    null,
                    '[]',
                  );
                  if (isInRange) {
                    if (Number(e[keyValue]) <= 0) {
                      if (!isCheckMoreDate) {
                        warningData.push(
                          `${capacityKey} [date : [${dateKey}] value : ${e[keyValue]}] Exit Point: ${exitPointName} not match system ${newData}`,
                        );
                      }
                    }
                  } else {
                    if (Number(e[keyValue]) !== 0) {
                      warningData.push(
                        `${capacityKey} [date : [${dateKey}] value : ${e[keyValue]}] Exit Point: ${exitPointName} not match system ${newData}`,
                      );
                    }
                  }
                  if (!dExitA) {
                    dExitA = {};
                  }

                  if (!dExitA[i]) {
                    dExitA[i] = {
                      start: e[keyExitFrom],
                      end: e[keyExitTo],
                      date: { [capacityKey]: [] },
                    };
                  }

                  dExitA = {
                    ...dExitA,
                    [i]: {
                      start: e[keyExitFrom],
                      end: e[keyExitTo],
                      date: {
                        ...dExitA[i]['date'],
                        [capacityKey]: [
                          ...(dExitA[i]['date'][capacityKey] || []),
                          dateKey,
                        ],
                      },
                    },
                  };
                }
              });
            });
          }
        }

        const getContractPointByName = await this.getContractPointByName(
          exitPointName,
          getGroupByName?.id || null,
        );
        if (!getContractPointByName) {
          warningData.push(
            `Exit Point: ${exitPointName} not match system ${newData}`,
          );
        }
        return {
          data: e,
          contract_point: e['5'],
          area: e['1'] || null,
          zone: e['0'] || null,
          contractPointName: exitPointName || null,
        };
      }),
    );

    const minDate = dateStartAll.reduce((min, current) => {
      return dayjs(current, 'DD/MM/YYYY').isBefore(dayjs(min, 'DD/MM/YYYY'))
        ? current
        : min;
    }, dateStartAll[0]);
    const maxDate = dateEndAll.reduce((max, current) => {
      return dayjs(current, 'DD/MM/YYYY').isAfter(dayjs(max, 'DD/MM/YYYY'))
        ? current
        : max;
    }, dateEndAll[0]);

    const checkContractCode = await this.prisma.contract_code.findFirst({
      select: {
        id: true,
        contract_code: true,
        status_capacity_request_management: true,
        file_period_mode: true,
        fixdayday: true,
        todayday: true,
        group: {
          select: {
            name: true,
          },
        },
        term_type_id: true,
      },
      where: {
        contract_code: contractCode,
      },
    });

    let resultContractCode: any;
    if (contractCode.includes('_Amd')) {
      const match = contractCode.match(/(.*)(_Amd.*)/);
      resultContractCode = [match[1], match[2]];
    } else {
      resultContractCode = [contractCode];
    }

    if (checkContractCode) {
      // มี
      if (shipperName !== checkContractCode?.group?.name) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'ShipperName ไม่เหมือนของเดิม',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (typeOfContractText !== checkContractCode?.term_type_id) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Term Type ไม่เหมือนของเดิม',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (
        checkContractCode?.file_period_mode !==
        bookingTemplate?.file_period_mode &&
        checkContractCode?.file_period_mode === 2
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'format date ไม่เหมือนของเดิม',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else if (
        bookingTemplate?.file_period_mode === 2 &&
        (checkContractCode?.file_period_mode === 1 ||
          checkContractCode?.file_period_mode === 3)
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'format date ไม่เหมือนของเดิม',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else {
        const dEntryArray = Object.values(dEntryA);
        for (let i = 0; i < dEntryArray.length; i++) {
          const calcCheckEntry = await this.validateDateEntries(
            dEntryArray[i],
            bookingTemplate?.file_period_mode,
            bookingTemplate?.fixdayday,
            bookingTemplate?.todayday,
            minDate,
            maxDate,
          );
          const objCalcEntry = this.extractValidationResults(
            calcCheckEntry?.date,
          );
          const findCalcEntry = objCalcEntry.filter((f: any) => {
            return f === false;
          });

          if (findCalcEntry.length > 0) {
            console.log('-----------------------------');
            console.log('findCalcEntry : ', findCalcEntry);
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'format date Entry มีวันที่/จำนวนไม่ถูกต้อง',
              },
              HttpStatus.BAD_REQUEST,
            );
          }
        }
        const dExitArray = Object.values(dExitA);
        for (let i = 0; i < dExitArray.length; i++) {
          const calcCheckExit = await this.validateDateEntries(
            dExitArray[i],
            bookingTemplate?.file_period_mode,
            bookingTemplate?.fixdayday,
            bookingTemplate?.todayday,
            minDate,
            maxDate,
          );
          const objCalcExit = this.extractValidationResults(
            calcCheckExit?.date,
          );
          const findCalcExit = objCalcExit.filter((f: any) => {
            return f === false;
          });
          if (findCalcExit.length > 0) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'format date Exit มีวันที่/จำนวนไม่ถูกต้อง',
              },
              HttpStatus.BAD_REQUEST,
            );
          }
        }
      }
    } else {
      const dEntryArray = Object.values(dEntryA);
      for (let i = 0; i < dEntryArray.length; i++) {
        const calcCheckEntry = await this.validateDateEntries(
          dEntryArray[i],
          bookingTemplate?.file_period_mode,
          bookingTemplate?.fixdayday,
          bookingTemplate?.todayday,
          minDate,
          maxDate,
        );
        const objCalcEntry = this.extractValidationResults(
          calcCheckEntry?.date,
        );
        const findCalcEntry = objCalcEntry.filter((f: any) => {
          return f === false;
        });

        if (findCalcEntry.length > 0) {
          // console.log('-----------------------------1');
          // console.log('calcCheckEntry?.date : ', dEntryArray[i]);
          // console.log('calcCheckEntry?.date : ', calcCheckEntry?.date);
          //   console.log('findCalcEntry : ', findCalcEntry);
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'format date Entry มีวันที่/จำนวนไม่ถูกต้อง',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }
      const dExitArray = Object.values(dExitA);
      for (let i = 0; i < dExitArray.length; i++) {
        const calcCheckExit = await this.validateDateEntries(
          dExitArray[i],
          bookingTemplate?.file_period_mode,
          bookingTemplate?.fixdayday,
          bookingTemplate?.todayday,
          minDate,
          maxDate,
        );
        const objCalcExit = this.extractValidationResults(calcCheckExit?.date);
        const findCalcExit = objCalcExit.filter((f: any) => {
          return f === false;
        });
        if (findCalcExit.length > 0) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'format date Exit มีวันที่/จำนวนไม่ถูกต้อง',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    if (entryCompareNotMatch.length > 0) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Total Entry & Total Exit is NOT match.',
          data: entryCompareNotMatch,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (exitCompareNotMatch.length > 0) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Total Entry & Total Exit is NOT match.',
          data: exitCompareNotMatch,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      compareEntryExit['Capacity Daily Booking (MMBTU/d)'].length > 0 ||
      compareEntryExit['Maximum Hour Booking (MMBTU/h)'].length > 0
    ) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Total Entry & Total Exit is NOT match.',
          data: compareEntryExit,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const checkContractCodeCheckLast = checkContractCode?.id
      ? await this.prisma.contract_code.findFirst({
        select: {
          id: true,
          status_capacity_request_management_id: true,
          contract_start_date: true,
          contract_end_date: true,
          terminate_date: true,
          status_capacity_request_management_process_id: true,
          ref_contract_code_by_main_id: true,
          ref_contract_code_by_id: true,
          shadow_period: true,
          shadow_time: true,
        },
        where: {
          ref_contract_code_by_main_id: checkContractCode?.id,
        },
        orderBy: {
          id: 'desc',
        },
      })
      : null;

    if (
      checkContractCodeCheckLast?.status_capacity_request_management_process_id ===
      4 ||
      checkContractCodeCheckLast?.status_capacity_request_management_id === 5
    ) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Contract Code End | Terminate',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    let versionFlag = false;
    let amdFlag = false;
    let newCreate = false;
    let contract_code = resultContractCode[0];
    const nowDate = getTodayNowAdd7().toDate();

    const hasContractStarted =
      dayjs(nowDate).isAfter(
        dayjs(checkContractCodeCheckLast?.contract_start_date),
      ) ||
      dayjs(nowDate).isSame(
        dayjs(checkContractCodeCheckLast?.contract_start_date),
      );
    let amdVersion: any = null;
    if (
      hasContractStarted &&
      checkContractCodeCheckLast?.status_capacity_request_management_id === 2
    ) {
      // ขึ้น _Amd01++
      const checkContractCodeCheckLength =
        await this.prisma.contract_code.count({
          where: {
            ref_contract_code_by_main_id: checkContractCode?.id,
          },
        });
      amdVersion =
        '_Amd' +
        String(
          checkContractCodeCheckLength > 9
            ? checkContractCodeCheckLength
            : '0' + checkContractCodeCheckLength,
        );
      contract_code = contract_code + amdVersion;
      amdFlag = true;
    } else if (
      !hasContractStarted &&
      checkContractCodeCheckLast?.status_capacity_request_management_id === 2
    ) {
      versionFlag = true;
    } else {
      if (checkContractCodeCheckLast) {
        versionFlag = true;
      } else {
        newCreate = true;
      }
    }
    console.log('amdVersion : ', amdVersion);

    const shipperId = await this.prisma.group.findFirst({
      select: {
        id: true,
        user_type_id: true,
      },
      where: {
        name: shipperName,
      },
    });
    const ckUserType = await this.prisma.user_type.findFirst({
      where: {
        group: {
          some: {
            account_manage: {
              some: {
                account_id: Number(userId),
              },
            },
          },
        },
      },
    });

    if (newCreate) {
      const createContractCode = await this.prisma.contract_code.create({
        data: {
          contract_code: contract_code,
          ...(!!typeOfContractText && {
            term_type: {
              connect: {
                id: typeOfContractText,
              },
            },
          }),
          ...(!!shipperId?.id && {
            group: {
              connect: {
                id: shipperId?.id,
              },
            },
          }),
          status_capacity_request_management_process: {
            connect: {
              id: 3,
            },
          },
          status_capacity_request_management: {
            connect: {
              id: 1,
            },
          },
          type_account: {
            connect: {
              id: 1,
            },
          },
          ...(!!checkContractCodeCheckLast?.ref_contract_code_by_main_id && {
            ref_contract_code_by_main: {
              connect: {
                id: checkContractCodeCheckLast?.ref_contract_code_by_main_id,
              },
            },
          }),
          ...(!!checkContractCodeCheckLast?.id && {
            ref_contract_code_by: {
              connect: {
                id: checkContractCodeCheckLast?.id,
              },
            },
          }),
          shadow_period: bookingTemplate?.shadow_period,
          shadow_time: bookingTemplate?.shadow_time,
          file_period_mode: bookingTemplate?.file_period_mode,
          fixdayday: bookingTemplate?.fixdayday,
          todayday: bookingTemplate?.todayday,
          contract_start_date: minDate
            ? getTodayNowDDMMYYYYDfaultAdd7(minDate).toDate()
            : null,
          contract_end_date: maxDate
            ? getTodayNowDDMMYYYYDfaultAdd7(maxDate).toDate()
            : null,
          submitted_timestamp: getTodayNowAdd7().toDate(),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });

      await this.prisma.contract_code.update({
        where: {
          id: createContractCode?.id,
        },
        data: {
          ref_contract_code_by_main_id: createContractCode?.id,
        },
      });

      const versId = await this.prisma.booking_version.create({
        data: {
          version: `v.1`,
          ...(!!createContractCode?.id && {
            // new create ..
            contract_code: {
              connect: {
                id: createContractCode?.id,
              },
            },
          }),
          flag_use: true,
          submitted_timestamp: getTodayNowAdd7().toDate(),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
          type_account: {
            connect: {
              id: 1,
            },
          },
          status_capacity_request_management: {
            connect: {
              id: 1,
            },
          },
        },
      });

      await this.prisma.booking_full_json.create({
        data: {
          ...(!!versId?.id && {
            booking_version: {
              connect: {
                id: versId?.id,
              },
            },
          }),
          data_temp: JSON.stringify(resultTranform),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });

      const mapDataRowJson = [];
      for (let i = 0; i < newEntry.length; i++) {
        mapDataRowJson.push({
          booking_version_id: versId?.id,
          entry_exit_id: 1,

          zone_text: newEntry[i]?.zone,
          area_text: newEntry[i]?.area,
          contract_point: newEntry[i]?.contract_point,
          flag_use: true,
          data_temp: JSON.stringify(newEntry[i]?.data),
          create_by: Number(userId),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }
      for (let i = 0; i < newExit.length; i++) {
        mapDataRowJson.push({
          booking_version_id: versId?.id,
          entry_exit_id: 2,

          zone_text: newExit[i]?.zone,
          area_text: newExit[i]?.area,
          contract_point: newExit[i]?.contract_point,
          flag_use: true,
          data_temp: JSON.stringify(newExit[i]?.data),
          create_by: Number(userId),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }

      await this.prisma.booking_row_json.createMany({
        data: mapDataRowJson,
      });

      await this.prisma.submission_comment_capacity_request_management.createMany(
        {
          data: (warningData || []).map((ew: any) => {
            return {
              remark: ew,
              contract_code_id: createContractCode?.id,
              create_by: Number(userId),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
            };
          }),
        },
      );

      const responseUpFile = await uploadFilsTemp(file);
      await this.fileCapacityBooking(
        responseUpFile?.file?.url,
        createContractCode?.id,
        userId,
      );

      if (ckUserType?.id === 2) {
        // createContractCode?.id
        await this.updateStatusCapacityRequestManagement(
          createContractCode?.id,
          {
            status_capacity_request_management_id: 2,
            terminate_date: null, // "2024-12-14", //status_capacity_request_management_id 5 ต้องมี ไม่ 5 ให้ null
            shadow_time: null, //status_capacity_request_management_id 2 ต้องมี ไม่ 2 ให้ null
            shadow_period: null, //status_capacity_request_management_id 2 ต้องมี ไม่ 2 ให้ null
            reject_reasons: null, //"comment.." //status_capacity_request_management_id 3 ต้องมี ไม่ 3 ให้ null
          },
          userId,
          null,
        );
      }

      // console.log('----');

      // await this.pathDetailCreate(createContractCode?.id, userId)
      // ok
    } else {
      if (versionFlag) {
        await this.prisma.contract_code.update({
          where: {
            id: checkContractCodeCheckLast?.id,
          },
          data: {
            ...(!!checkContractCodeCheckLast?.status_capacity_request_management_id && {
              status_capacity_request_management: {
                connect: {
                  id:
                    checkContractCodeCheckLast?.status_capacity_request_management_id ===
                      3
                      ? 1
                      : checkContractCodeCheckLast?.status_capacity_request_management_id,
                },
              },
            }),
            ...(!!checkContractCodeCheckLast?.status_capacity_request_management_id && {
              status_capacity_request_management_process: {
                connect: {
                  id:
                    checkContractCodeCheckLast?.status_capacity_request_management_id ===
                      3
                      ? 3
                      : checkContractCodeCheckLast?.status_capacity_request_management_process_id,
                },
              },
            }),

            file_period_mode: bookingTemplate?.file_period_mode,
            fixdayday: bookingTemplate?.fixdayday,
            todayday: bookingTemplate?.todayday,

            contract_start_date: minDate
              ? getTodayNowDDMMYYYYDfaultAdd7(minDate).toDate()
              : null,
            contract_end_date: maxDate
              ? getTodayNowDDMMYYYYDfaultAdd7(maxDate).toDate()
              : null,

            submitted_timestamp: getTodayNowAdd7().toDate(),
            update_date: getTodayNowAdd7().toDate(),
            update_date_num: getTodayNowAdd7().unix(),
            update_by_account: {
              connect: {
                id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
              },
            },
          },
        });

        await this.prisma.booking_version.updateMany({
          where: {
            contract_code_id: checkContractCodeCheckLast?.id,
          },
          data: {
            flag_use: false,
          },
        });

        const checkContractCodeCheckLength =
          await this.prisma.booking_version.count({
            where: {
              contract_code_id: checkContractCodeCheckLast?.id,
            },
          });

        const versId = await this.prisma.booking_version.create({
          data: {
            version: `v.${checkContractCodeCheckLength + 1}`,
            ...(!!checkContractCodeCheckLast?.id && {
              contract_code: {
                connect: {
                  id: checkContractCodeCheckLast?.id,
                },
              },
            }),
            flag_use: true,
            create_date: getTodayNowAdd7().toDate(),
            create_date_num: getTodayNowAdd7().unix(),
            create_by_account: {
              connect: {
                id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
              },
            },
            submitted_timestamp: getTodayNowAdd7().toDate(),
            type_account: {
              connect: {
                id: 1,
              },
            },
            ...(!!checkContractCodeCheckLast?.status_capacity_request_management_id && {
              status_capacity_request_management: {
                connect: {
                  id:
                    checkContractCodeCheckLast?.status_capacity_request_management_id ===
                      3
                      ? 1
                      : checkContractCodeCheckLast?.status_capacity_request_management_id,
                },
              },
            }),
          },
        });

        await this.prisma.booking_full_json.create({
          data: {
            ...(!!versId?.id && {
              booking_version: {
                connect: {
                  id: versId?.id,
                },
              },
            }),
            data_temp: JSON.stringify(resultTranform),
            create_date: getTodayNowAdd7().toDate(),
            create_date_num: getTodayNowAdd7().unix(),
            create_by_account: {
              connect: {
                id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
              },
            },
          },
        });

        const mapDataRowJson = [];
        for (let i = 0; i < newEntry.length; i++) {
          mapDataRowJson.push({
            booking_version_id: versId?.id,
            entry_exit_id: 1,

            zone_text: newEntry[i]?.zone,
            area_text: newEntry[i]?.area,
            contract_point: newEntry[i]?.contract_point,
            flag_use: true,
            data_temp: JSON.stringify(newEntry[i]?.data),
            create_by: Number(userId),
            create_date: getTodayNowAdd7().toDate(),
            create_date_num: getTodayNowAdd7().unix(),
          });
        }
        for (let i = 0; i < newExit.length; i++) {
          mapDataRowJson.push({
            booking_version_id: versId?.id,
            entry_exit_id: 2,

            zone_text: newExit[i]?.zone,
            area_text: newExit[i]?.area,
            contract_point: newExit[i]?.contract_point,
            flag_use: true,
            data_temp: JSON.stringify(newExit[i]?.data),
            create_by: Number(userId),
            create_date: getTodayNowAdd7().toDate(),
            create_date_num: getTodayNowAdd7().unix(),
          });
        }

        await this.prisma.booking_row_json.createMany({
          data: mapDataRowJson,
        });

        await this.prisma.submission_comment_capacity_request_management.createMany(
          {
            data: (warningData || []).map((ew: any) => {
              return {
                remark: ew,
                contract_code_id: checkContractCodeCheckLast?.id,
                create_date: getTodayNowAdd7().toDate(),
                create_by: Number(userId),
                create_date_num: getTodayNowAdd7().unix(),
              };
            }),
          },
        );

        const responseUpFile = await uploadFilsTemp(file);
        await this.fileCapacityBooking(
          responseUpFile?.file?.url,
          checkContractCodeCheckLast?.id,
          userId,
        );
      } else if (amdFlag) {
        const extendContractLast =
          await this.prisma.extend_contract_capacity_request_management.findFirst(
            {
              where: {
                contract_code_id: checkContractCodeCheckLast?.id,
              },
              orderBy: {
                id: 'desc',
              },
            },
          );
        const configStart = dayjs(extendContractLast?.start_date).format(
          'DD/MM/YYYY',
        );
        const configEnd = dayjs(extendContractLast?.end_date).format(
          'DD/MM/YYYY',
        );

        const resCk = await this.validateEndDate({
          configStart: configStart,
          configEnd: configEnd,
          file_period_mode: bookingTemplate?.file_period_mode,
          shadow_time: checkContractCodeCheckLast?.shadow_time,
          startdate: minDate,
          endDate: maxDate,
          shadow_period: checkContractCodeCheckLast?.shadow_period,
        });

        console.log('resCk : ', resCk);
        if (resCk) {
          console.log('--amd');
          // ได้

          const createContractCodeAmd = await this.prisma.contract_code.create({
            data: {
              contract_code: contract_code,
              ...(!!typeOfContractText && {
                term_type: {
                  connect: {
                    id: typeOfContractText,
                  },
                },
              }),
              ...(!!shipperId?.id && {
                group: {
                  connect: {
                    id: shipperId?.id,
                  },
                },
              }),
              status_capacity_request_management_process: {
                connect: {
                  id: 3,
                },
              },
              status_capacity_request_management: {
                connect: {
                  id: 2,
                },
              },
              type_account: {
                connect: {
                  id: 1,
                },
              },
              ...(!!checkContractCodeCheckLast?.ref_contract_code_by_main_id && {
                ref_contract_code_by_main: {
                  connect: {
                    id: checkContractCodeCheckLast?.ref_contract_code_by_main_id,
                  },
                },
              }),
              ...(!!checkContractCodeCheckLast?.id && {
                ref_contract_code_by: {
                  connect: {
                    id: checkContractCodeCheckLast?.id,
                  },
                },
              }),
              shadow_period: checkContractCodeCheckLast?.shadow_period,
              shadow_time: checkContractCodeCheckLast?.shadow_time,
              file_period_mode: bookingTemplate?.file_period_mode,
              fixdayday: bookingTemplate?.fixdayday,
              todayday: bookingTemplate?.todayday,
              contract_start_date: minDate
                ? getTodayNowDDMMYYYYDfaultAdd7(minDate).toDate()
                : null,
              contract_end_date: maxDate
                ? getTodayNowDDMMYYYYDfaultAdd7(maxDate).toDate()
                : null,
              submitted_timestamp: getTodayNowAdd7().toDate(),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
              create_by_account: {
                connect: {
                  id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
                },
              },
            },
          });

          await this.prisma.contract_code.update({
            where: {
              id: createContractCodeAmd?.id,
            },
            data: {
              ref_contract_code_by_main_id:
                checkContractCodeCheckLast?.ref_contract_code_by_main_id,
              ref_contract_code_by_id: checkContractCodeCheckLast?.id,
            },
          });

          const versId = await this.prisma.booking_version.create({
            data: {
              version: `v.1`,
              ...(!!createContractCodeAmd?.id && {
                contract_code: {
                  connect: {
                    id: createContractCodeAmd?.id,
                  },
                },
              }),
              flag_use: true,
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
              create_by_account: {
                connect: {
                  id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
                },
              },
              submitted_timestamp: getTodayNowAdd7().toDate(),
              type_account: {
                connect: {
                  id: 1,
                },
              },
              status_capacity_request_management: {
                connect: {
                  id: 2,
                },
              },
            },
          });

          await this.prisma.booking_full_json.create({
            data: {
              ...(!!versId?.id && {
                booking_version: {
                  connect: {
                    id: versId?.id,
                  },
                },
              }),
              data_temp: JSON.stringify(resultTranform),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
              create_by_account: {
                connect: {
                  id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
                },
              },
            },
          });

          const mapDataRowJson = [];
          for (let i = 0; i < newEntry.length; i++) {
            mapDataRowJson.push({
              booking_version_id: versId?.id,
              entry_exit_id: 1,

              zone_text: newEntry[i]?.zone,
              area_text: newEntry[i]?.area,
              contract_point: newEntry[i]?.contract_point,
              flag_use: true,
              data_temp: JSON.stringify(newEntry[i]?.data),
              create_by: Number(userId),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
            });
          }
          for (let i = 0; i < newExit.length; i++) {
            mapDataRowJson.push({
              booking_version_id: versId?.id,
              entry_exit_id: 2,

              zone_text: newExit[i]?.zone,
              area_text: newExit[i]?.area,
              contract_point: newExit[i]?.contract_point,
              flag_use: true,
              data_temp: JSON.stringify(newExit[i]?.data),
              create_by: Number(userId),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
            });
          }

          await this.prisma.booking_row_json.createMany({
            data: mapDataRowJson,
          });

          await this.prisma.submission_comment_capacity_request_management.createMany(
            {
              data: (warningData || []).map((ew: any) => {
                return {
                  remark: ew,
                  contract_code_id: checkContractCodeCheckLast?.id,
                  create_by: Number(userId),
                  create_date: getTodayNowAdd7().toDate(),
                  create_date_num: getTodayNowAdd7().unix(),
                };
              }),
            },
          );
          const responseUpFile = await uploadFilsTemp(file);
          await this.fileCapacityBooking(
            responseUpFile?.file?.url,
            checkContractCodeCheckLast?.id,
            userId,
          );
        } else {
          // ไม่ได้
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'ไม่ตรงกับ เงื่อนไข shadow time or shadow period',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      } else {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'error เงื่อนไข',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    return {
      message: 'Success.',
    };
  }


  async pathDetailCapacityRequestManagementTranformNew(
    data: any,
    userId: any,
    file: any,
    token: any,
  ) {
    const resultTranform = this.safeParseJSON(data?.json_data);
    console.log('resultTranform : ', resultTranform);
    const headerEntry = resultTranform?.headerEntry || {};
    const entryValue = resultTranform?.entryValue || [];
    const headerExit = resultTranform?.headerExit || {};
    const exitValue = resultTranform?.exitValue || [];
    const sumEntries = resultTranform?.sumEntries || {};
    const sumExits = resultTranform?.sumExits || {};

    let shipperName = null;
    let typeOfContract = null;
    let contractCode = null;

    Object.values(resultTranform?.shipperInfo).forEach((info: any) => {
      if (info['Shipper Name']) {
        shipperName = info['Shipper Name'];
      }
      if (info['Type of Contract']) {
        typeOfContract = info['Type of Contract'];
      }
      if (info['Contract Code']) {
        contractCode = info['Contract Code'] || '';
      }
    });

    const typeOfContractText =
      typeOfContract === 'LONG'
        ? 1
        : typeOfContract === 'MEDIUM'
          ? 2
          : typeOfContract === 'SHORT_FIRM'
            ? 3
            : typeOfContract === 'SHORT_NON_FIRM'
              ? 4
              : null;

    const getGroupByName = await this.getGroupByName(shipperName);

    if (!getGroupByName || !typeOfContractText || !contractCode) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Shipper Info does not match the value.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    const bookingTemplate = await this.prisma.booking_template.findFirst({
      where: {
        term_type_id: Number(typeOfContractText),
        start_date: {
          lte: todayEnd,
        },
        end_date: {
          gte: todayStart,
        },
      },
    });

    if (!bookingTemplate) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'booking template date not match',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const checkValueSum = {
      entry: {
        'Capacity Daily Booking (MMBTU/d)': [],
        'Maximum Hour Booking (MMBTU/h)': [],
        'Capacity Daily Booking (MMscfd)': [],
        'Maximum Hour Booking (MMscfh)': [],
      },
      exit: {
        'Capacity Daily Booking (MMBTU/d)': [],
        'Maximum Hour Booking (MMBTU/h)': [],
      },
    };

    const entryCompareNotMatch = [];
    const exitCompareNotMatch = [];

    const compareEntryExit = {
      'Capacity Daily Booking (MMBTU/d)': [],
      'Maximum Hour Booking (MMBTU/h)': [],
    };

    // Populate checkValueSum.entry
    for (const key in checkValueSum.entry) {
      if (headerEntry[key]) {
        Object.keys(headerEntry[key]).forEach((date) => {
          if (date !== 'key') {
            const entryKey = headerEntry[key][date]?.key;
            let sum = 0;
            entryValue.forEach((entry) => {
              if (entry[entryKey] !== undefined) {
                sum += parseFloat(entry[entryKey]) || 0;
              }
            });
            checkValueSum.entry[key].push({
              key: entryKey,
              sum,
              headerKey: date,
            });
          }
        });
      }
    }

    // Populate checkValueSum.exit
    for (const key in checkValueSum.exit) {
      if (headerExit[key]) {
        Object.keys(headerExit[key]).forEach((date) => {
          if (date !== 'key') {
            const exitKey = headerExit[key][date]?.key;
            let sum = 0;
            exitValue.forEach((exit) => {
              if (exit[exitKey] !== undefined) {
                sum += parseFloat(exit[exitKey]) || 0;
              }
            });
            checkValueSum.exit[key].push({
              key: exitKey,
              sum,
              headerKey: date,
            });
          }
        });
      }
    }

    // Compare checkValueSum.entry with sumEntries
    for (const key in checkValueSum.entry) {
      checkValueSum.entry[key].forEach((entryItem) => {
        const { key: entryKey, sum: calculatedSum, headerKey } = entryItem;
        const expectedSum = parseFloat(sumEntries[entryKey]) || 0;

        if (calculatedSum !== expectedSum) {
          entryCompareNotMatch.push({
            headerKey, // This will be the date, such as "01/11/2024"
            key: entryKey,
            description: key,
            calculatedSum,
            expectedSum,
            status: 'Mismatch',
          });
        }
      });
    }

    // Compare checkValueSum.exit with sumExits
    for (const key in checkValueSum.exit) {
      checkValueSum.exit[key].forEach((exitItem) => {
        const { key: exitKey, sum: calculatedSum, headerKey } = exitItem;
        const expectedSum = parseFloat(sumExits[exitKey]) || 0;

        if (calculatedSum !== expectedSum) {
          exitCompareNotMatch.push({
            headerKey, // This will be the date, such as "01/11/2024"
            key: exitKey,
            description: key,
            calculatedSum,
            expectedSum,
            status: 'Mismatch',
          });
        }
      });
    }

    // Compare each entry item with its corresponding exit item in compareEntryExit
    for (const key of [
      'Capacity Daily Booking (MMBTU/d)',
      'Maximum Hour Booking (MMBTU/h)',
    ]) {
      checkValueSum.entry[key].forEach((entryItem) => {
        const { key: entryKey, sum: entrySum, headerKey } = entryItem;
        const exitItem = checkValueSum.exit[key].find(
          (exit) => exit.key === entryKey,
        );

        if (exitItem) {
          const exitSum = exitItem.sum;
          if (entrySum !== exitSum) {
            compareEntryExit[key].push({
              description: key,
              headerKey, // This will be the date, such as "01/11/2024"
              key: entryKey,
              entrySum,
              exitSum,
              status: 'Mismatch',
            });
          }
        } else {
          // If no matching exit item found, consider it a mismatch
          compareEntryExit[key].push({
            description: key,
            headerKey,
            key: entryKey,
            entrySum,
            exitSum: null, // Indicate no matching exit sum found
            status: 'Mismatch (No Matching Exit)',
          });
        }
      });
    }

    const keyEntryPoint =
      resultTranform?.['headerEntry']?.['Entry']?.['Entry Point']?.['key'];
    const keyExitPoint =
      resultTranform?.['headerExit']?.['Exit']?.['Entry Point']?.['key'];
    const warningData = [];
    const newData = getTodayNowAdd7().format('YYYY/MM/DD HH:mm');

    let dEntryA: any = null;
    let dExitA: any = null;

    const keyEntryFrom =
      resultTranform?.['headerEntry']?.['Period']?.['From']?.['key'];
    const keyEntryTo =
      resultTranform?.['headerEntry']?.['Period']?.['To']?.['key'];
    const keyExitFrom =
      resultTranform?.['headerExit']?.['Period']?.['From']?.['key'];
    const keyExitTo =
      resultTranform?.['headerExit']?.['Period']?.['To']?.['key'];

    const dateStartAll: any = [];
    const dateEndAll: any = [];

    const newEntry = await Promise.all(
      entryValue.map(async (e: any, i: any) => {
        const entryPointName = e[keyEntryPoint];
        const newStartDayPlus = dayjs(todayStart);
        const useStart = dayjs(e[keyEntryFrom], 'DD/MM/YYYY');
        const isCheckMoreDate = useStart.isAfter(newStartDayPlus);
        let checkMinMax = false;
        if (!isCheckMoreDate) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error:
                'Period From date in the template must be later than today.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        checkMinMax = this.checkDateRange(
          e[keyEntryFrom],
          e[keyEntryTo],
          bookingTemplate?.file_period_mode,
          bookingTemplate?.min,
          bookingTemplate?.max,
        );

        if (!checkMinMax) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Date is NOT match',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        const headerEntryDate = resultTranform?.['headerEntry'];
        const keysGreaterThanEntryTo = Object.keys(e).filter(
          (key) => Number(key) > Number(keyEntryTo),
        );
        for (let is = 0; is < keysGreaterThanEntryTo.length; is++) {
          if (headerEntryDate) {
            Object.keys(headerEntryDate).forEach((capacityKey) => {
              const capacityDates = headerEntryDate[capacityKey];
              Object.keys(capacityDates).forEach((dateKey) => {
                const keyValue = capacityDates[dateKey]?.['key'];
                if (keysGreaterThanEntryTo[is] === keyValue) {
                  const dateToCheckCk = dayjs(e[dateKey], 'DD/MM/YYYY');
                  const startDateCk = dayjs(e[keyEntryFrom], 'DD/MM/YYYY');
                  const endDateCk = dayjs(e[keyEntryTo], 'DD/MM/YYYY');
                  dateStartAll.push(e[keyEntryFrom]);
                  dateEndAll.push(e[keyEntryTo]);

                  const isInRangeZero = dayjs(dateKey, 'DD/MM/YYYY').isBetween(
                    dayjs(e[keyEntryFrom], 'DD/MM/YYYY'),
                    dayjs(e[keyEntryTo], 'DD/MM/YYYY'),
                    'day',
                    '[]',
                  );
                  let resultZero: boolean;
                  if (!isInRangeZero && e[keyValue] === 0) {
                    resultZero = true;
                  } else if (!isInRangeZero) {
                    resultZero = false;
                  } else {
                    resultZero = true;
                  }
                  if (!resultZero) {
                    throw new HttpException(
                      {
                        status: HttpStatus.BAD_REQUEST,
                        error: 'Date is NOT match.',
                      },
                      HttpStatus.BAD_REQUEST,
                    );
                  }

                  const isInRange = dateToCheckCk.isBetween(
                    startDateCk,
                    endDateCk,
                    null,
                    '[]',
                  );

                  if (isInRange) {
                    if (Number(e[keyValue]) <= 0) {
                      if (!isCheckMoreDate) {
                        warningData.push(
                          `${capacityKey} [date : [${dateKey}] value : ${e[keyValue]}] Entry Point: ${entryPointName} not match system ${newData}`,
                        );
                      }
                    }
                  } else {
                    if (Number(e[keyValue]) !== 0) {
                      warningData.push(
                        `${capacityKey} [date : [${dateKey}] value : ${e[keyValue]}] Entry Point: ${entryPointName} not match system ${newData}`,
                      );
                    }
                  }
                  if (!dEntryA) {
                    dEntryA = {};
                  }

                  if (!dEntryA[i]) {
                    dEntryA[i] = {
                      start: e[keyEntryFrom],
                      end: e[keyEntryTo],
                      date: { [capacityKey]: [] },
                    };
                  }

                  dEntryA = {
                    ...dEntryA,
                    [i]: {
                      start: e[keyEntryFrom],
                      end: e[keyEntryTo],
                      date: {
                        ...dEntryA[i]['date'],
                        [capacityKey]: [
                          ...(dEntryA[i]['date'][capacityKey] || []),
                          dateKey,
                        ],
                      },
                    },
                  };
                }
              });
            });
          }
        }

        const getContractPointByName = await this.getContractPointByName(
          entryPointName,
          getGroupByName?.id || null,
        );
        if (!getContractPointByName) {
          warningData.push(
            `Entry Point: ${entryPointName} not match system ${newData}`,
          );
        }

        const contractPoints = await this.prisma.contract_point.findFirst({
          where: {
            contract_point: e['0'],
            entry_exit_id: 1,
          },
          include: {
            area: true,
            zone: true,
          },
        });

        return {
          data: e,
          contract_point: e['0'],
          area: contractPoints?.area?.name || null,
          zone: contractPoints?.zone?.name || null,
          contractPointName: entryPointName || null,
        };
      }),
    );

    const newExit = await Promise.all(
      exitValue.map(async (e: any, i: any) => {
        const exitPointName = e[keyExitPoint];

        // let newStartDayPlus = dayjs(todayStart).add(1, 'day');
        const newStartDayPlus = dayjs(todayStart);
        const useStart = dayjs(e[keyExitFrom], 'DD/MM/YYYY');
        const isCheckMoreDate = useStart.isAfter(newStartDayPlus);
        let checkMinMax = false;

        if (!isCheckMoreDate) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error:
                'Period From date in the template must be later than today.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        checkMinMax = this.checkDateRange(
          e[keyExitFrom],
          e[keyExitTo],
          bookingTemplate?.file_period_mode,
          bookingTemplate?.min,
          bookingTemplate?.max,
        );
        if (!checkMinMax) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Date is NOT match',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        const headerExitDate = resultTranform?.['headerExit'];
        const keysGreaterThanExitTo = Object.keys(e).filter(
          (key) => Number(key) > Number(keyExitTo),
        );
        for (let is = 0; is < keysGreaterThanExitTo.length; is++) {
          if (headerExitDate) {
            Object.keys(headerExitDate).forEach((capacityKey) => {
              const capacityDates = headerExitDate[capacityKey];
              Object.keys(capacityDates).forEach((dateKey) => {
                const keyValue = capacityDates[dateKey]?.['key'];
                if (keysGreaterThanExitTo[is] === keyValue) {
                  const dateToCheckCk = dayjs(e[dateKey], 'DD/MM/YYYY');
                  const startDateCk = dayjs(e[keyExitFrom], 'DD/MM/YYYY');
                  const endDateCk = dayjs(e[keyExitTo], 'DD/MM/YYYY');
                  dateStartAll.push(e[keyEntryFrom]);
                  dateEndAll.push(e[keyEntryTo]);
                  const isInRange = dateToCheckCk.isBetween(
                    startDateCk,
                    endDateCk,
                    null,
                    '[]',
                  );
                  if (isInRange) {
                    if (Number(e[keyValue]) <= 0) {
                      if (!isCheckMoreDate) {
                        warningData.push(
                          `${capacityKey} [date : [${dateKey}] value : ${e[keyValue]}] Exit Point: ${exitPointName} not match system ${newData}`,
                        );
                      }
                    }
                  } else {
                    if (Number(e[keyValue]) !== 0) {
                      warningData.push(
                        `${capacityKey} [date : [${dateKey}] value : ${e[keyValue]}] Exit Point: ${exitPointName} not match system ${newData}`,
                      );
                    }
                  }
                  if (!dExitA) {
                    dExitA = {};
                  }

                  if (!dExitA[i]) {
                    dExitA[i] = {
                      start: e[keyExitFrom],
                      end: e[keyExitTo],
                      date: { [capacityKey]: [] },
                    };
                  }

                  dExitA = {
                    ...dExitA,
                    [i]: {
                      start: e[keyExitFrom],
                      end: e[keyExitTo],
                      date: {
                        ...dExitA[i]['date'],
                        [capacityKey]: [
                          ...(dExitA[i]['date'][capacityKey] || []),
                          dateKey,
                        ],
                      },
                    },
                  };
                }
              });
            });
          }
        }

        const getContractPointByName = await this.getContractPointByName(
          exitPointName,
          getGroupByName?.id || null,
        );
        if (!getContractPointByName) {
          warningData.push(
            `Exit Point: ${exitPointName} not match system ${newData}`,
          );
        }

        const contractPoints = await this.prisma.contract_point.findFirst({
          where: {
            contract_point: e['0'],
            entry_exit_id: 2,
          },
          include: {
            area: true,
            zone: true,
          },
        });

        return {
          data: e,
          contract_point: e['0'],
          area: contractPoints?.area?.name || null,
          zone: contractPoints?.zone?.name || null,
          contractPointName: exitPointName || null,
        };
      }),
    );

    const minDate = dateStartAll.reduce((min, current) => {
      return dayjs(current, 'DD/MM/YYYY').isBefore(dayjs(min, 'DD/MM/YYYY'))
        ? current
        : min;
    }, dateStartAll[0]);
    const maxDate = dateEndAll.reduce((max, current) => {
      return dayjs(current, 'DD/MM/YYYY').isAfter(dayjs(max, 'DD/MM/YYYY'))
        ? current
        : max;
    }, dateEndAll[0]);

    const checkContractCode = await this.prisma.contract_code.findFirst({
      select: {
        id: true,
        contract_code: true,
        status_capacity_request_management: true,
        file_period_mode: true,
        fixdayday: true,
        todayday: true,
        group: {
          select: {
            name: true,
          },
        },
        term_type_id: true,
      },
      where: {
        contract_code: contractCode,
      },
    });

    let resultContractCode: any;
    if (contractCode.includes('_Amd')) {
      const match = contractCode.match(/(.*)(_Amd.*)/);
      resultContractCode = [match[1], match[2]];
    } else {
      resultContractCode = [contractCode];
    }

    if (checkContractCode) {
      // มี
      if (shipperName !== checkContractCode?.group?.name) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'ShipperName ไม่เหมือนของเดิม',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (typeOfContractText !== checkContractCode?.term_type_id) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Term Type ไม่เหมือนของเดิม',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (
        checkContractCode?.file_period_mode !==
        bookingTemplate?.file_period_mode &&
        checkContractCode?.file_period_mode === 2
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'format date ไม่เหมือนของเดิม',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else if (
        bookingTemplate?.file_period_mode === 2 &&
        (checkContractCode?.file_period_mode === 1 ||
          checkContractCode?.file_period_mode === 3)
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'format date ไม่เหมือนของเดิม',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else {
        const dEntryArray = Object.values(dEntryA);
        for (let i = 0; i < dEntryArray.length; i++) {
          const calcCheckEntry = await this.validateDateEntries(
            dEntryArray[i],
            bookingTemplate?.file_period_mode,
            bookingTemplate?.fixdayday,
            bookingTemplate?.todayday,
            minDate,
            maxDate,
          );
          const objCalcEntry = this.extractValidationResults(
            calcCheckEntry?.date,
          );
          const findCalcEntry = objCalcEntry.filter((f: any) => {
            return f === false;
          });

          if (findCalcEntry.length > 0) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'format date Entry มีวันที่/จำนวนไม่ถูกต้อง',
              },
              HttpStatus.BAD_REQUEST,
            );
          }
        }
        const dExitArray = Object.values(dExitA);
        for (let i = 0; i < dExitArray.length; i++) {
          const calcCheckExit = await this.validateDateEntries(
            dExitArray[i],
            bookingTemplate?.file_period_mode,
            bookingTemplate?.fixdayday,
            bookingTemplate?.todayday,
            minDate,
            maxDate,
          );
          const objCalcExit = this.extractValidationResults(
            calcCheckExit?.date,
          );
          const findCalcExit = objCalcExit.filter((f: any) => {
            return f === false;
          });
          if (findCalcExit.length > 0) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'format date Exit มีวันที่/จำนวนไม่ถูกต้อง',
              },
              HttpStatus.BAD_REQUEST,
            );
          }
        }
      }
    } else {
      const dEntryArray = Object.values(dEntryA);
      for (let i = 0; i < dEntryArray.length; i++) {
        const calcCheckEntry = await this.validateDateEntries(
          dEntryArray[i],
          bookingTemplate?.file_period_mode,
          bookingTemplate?.fixdayday,
          bookingTemplate?.todayday,
          minDate,
          maxDate,
        );
        const objCalcEntry = this.extractValidationResults(
          calcCheckEntry?.date,
        );
        const findCalcEntry = objCalcEntry.filter((f: any) => {
          return f === false;
        });

        if (findCalcEntry.length > 0) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'format date Entry มีวันที่/จำนวนไม่ถูกต้อง',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }
      const dExitArray = Object.values(dExitA);
      for (let i = 0; i < dExitArray.length; i++) {
        const calcCheckExit = await this.validateDateEntries(
          dExitArray[i],
          bookingTemplate?.file_period_mode,
          bookingTemplate?.fixdayday,
          bookingTemplate?.todayday,
          minDate,
          maxDate,
        );
        const objCalcExit = this.extractValidationResults(calcCheckExit?.date);
        const findCalcExit = objCalcExit.filter((f: any) => {
          return f === false;
        });
        if (findCalcExit.length > 0) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'format date Exit มีวันที่/จำนวนไม่ถูกต้อง',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    if (entryCompareNotMatch.length > 0) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Total Entry & Total Exit is NOT match.',
          data: entryCompareNotMatch,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (exitCompareNotMatch.length > 0) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Total Entry & Total Exit is NOT match.',
          data: exitCompareNotMatch,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      compareEntryExit['Capacity Daily Booking (MMBTU/d)'].length > 0 ||
      compareEntryExit['Maximum Hour Booking (MMBTU/h)'].length > 0
    ) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Total Entry & Total Exit is NOT match.',
          data: compareEntryExit,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const checkContractCodeCheckLast = checkContractCode?.id
      ? await this.prisma.contract_code.findFirst({
        select: {
          id: true,
          status_capacity_request_management_id: true,
          contract_start_date: true,
          contract_end_date: true,
          terminate_date: true,
          status_capacity_request_management_process_id: true,
          ref_contract_code_by_main_id: true,
          ref_contract_code_by_id: true,
          shadow_period: true,
          shadow_time: true,
        },
        where: {
          ref_contract_code_by_main_id: checkContractCode?.id,
        },
        orderBy: {
          id: 'desc',
        },
      })
      : null;

    if (
      checkContractCodeCheckLast?.status_capacity_request_management_process_id ===
      4 ||
      checkContractCodeCheckLast?.status_capacity_request_management_id === 5
    ) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Contract Code End | Terminate',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    let versionFlag = false;
    let amdFlag = false;
    let newCreate = false;
    let contract_code = resultContractCode[0];
    const nowDate = getTodayNowAdd7().toDate();

    const hasContractStarted =
      dayjs(nowDate).isAfter(
        dayjs(checkContractCodeCheckLast?.contract_start_date),
      ) ||
      dayjs(nowDate).isSame(
        dayjs(checkContractCodeCheckLast?.contract_start_date),
      );
    let amdVersion: any = null;
    if (
      hasContractStarted &&
      checkContractCodeCheckLast?.status_capacity_request_management_id === 2
    ) {
      // ขึ้น _Amd01++
      const checkContractCodeCheckLength =
        await this.prisma.contract_code.count({
          where: {
            ref_contract_code_by_main_id: checkContractCode?.id,
          },
        });
      amdVersion =
        '_Amd' +
        String(
          checkContractCodeCheckLength > 9
            ? checkContractCodeCheckLength
            : '0' + checkContractCodeCheckLength,
        );
      contract_code = contract_code + amdVersion;
      amdFlag = true;
    } else if (
      !hasContractStarted &&
      checkContractCodeCheckLast?.status_capacity_request_management_id === 2
    ) {
      versionFlag = true;
    } else {
      if (checkContractCodeCheckLast) {
        versionFlag = true;
      } else {
        newCreate = true;
      }
    }

    const shipperId = await this.prisma.group.findFirst({
      select: {
        id: true,
        user_type_id: true,
      },
      where: {
        name: shipperName,
      },
    });
    const ckUserType = await this.prisma.user_type.findFirst({
      where: {
        group: {
          some: {
            account_manage: {
              some: {
                account_id: Number(userId),
              },
            },
          },
        },
      },
    });

    if (newCreate) {
      const createContractCode = await this.prisma.contract_code.create({
        data: {
          contract_code: contract_code,
          ...(!!typeOfContractText && {
            term_type: {
              connect: {
                id: typeOfContractText,
              },
            },
          }),
          ...(!!shipperId?.id && {
            group: {
              connect: {
                id: shipperId?.id,
              },
            },
          }),
          status_capacity_request_management_process: {
            connect: {
              id: 3,
            },
          },
          status_capacity_request_management: {
            connect: {
              id: 1,
            },
          },
          type_account: {
            connect: {
              id: 1,
            },
          },
          ...(!!checkContractCodeCheckLast?.ref_contract_code_by_main_id && {
            ref_contract_code_by_main: {
              connect: {
                id: checkContractCodeCheckLast?.ref_contract_code_by_main_id,
              },
            },
          }),
          ...(!!checkContractCodeCheckLast?.id && {
            ref_contract_code_by: {
              connect: {
                id: checkContractCodeCheckLast?.id,
              },
            },
          }),
          shadow_period: bookingTemplate?.shadow_period,
          shadow_time: bookingTemplate?.shadow_time,
          file_period_mode: bookingTemplate?.file_period_mode,
          fixdayday: bookingTemplate?.fixdayday,
          todayday: bookingTemplate?.todayday,
          contract_start_date: minDate
            ? getTodayNowDDMMYYYYDfaultAdd7(minDate).toDate()
            : null,
          contract_end_date: maxDate
            ? getTodayNowDDMMYYYYDfaultAdd7(maxDate).toDate()
            : null,
          submitted_timestamp: getTodayNowAdd7().toDate(),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });

      await this.prisma.contract_code.update({
        where: {
          id: createContractCode?.id,
        },
        data: {
          ref_contract_code_by_main_id: createContractCode?.id,
        },
      });

      const versId = await this.prisma.booking_version.create({
        data: {
          version: `v.1`,
          ...(!!createContractCode?.id && {
            contract_code: {
              connect: {
                id: createContractCode?.id,
              },
            },
          }),
          flag_use: true,
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
          submitted_timestamp: getTodayNowAdd7().toDate(),
          type_account: {
            connect: {
              id: 1,
            },
          },
          status_capacity_request_management: {
            connect: {
              id: 1,
            },
          },
        },
      });

      await this.prisma.booking_full_json.create({
        data: {
          ...(!!versId?.id && {
            booking_version: {
              connect: {
                id: versId?.id,
              },
            },
          }),
          data_temp: JSON.stringify(resultTranform),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });

      const mapDataRowJson = [];
      for (let i = 0; i < newEntry.length; i++) {
        mapDataRowJson.push({
          booking_version_id: versId?.id,
          entry_exit_id: 1,

          zone_text: newEntry[i]?.zone,
          area_text: newEntry[i]?.area,
          contract_point: newEntry[i]?.contract_point,
          flag_use: true,
          data_temp: JSON.stringify(newEntry[i]?.data),
          create_date: getTodayNowAdd7().toDate(),
          create_by: Number(userId),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }
      for (let i = 0; i < newExit.length; i++) {
        mapDataRowJson.push({
          booking_version_id: versId?.id,
          entry_exit_id: 2,

          zone_text: newExit[i]?.zone,
          area_text: newExit[i]?.area,
          contract_point: newExit[i]?.contract_point,
          flag_use: true,
          data_temp: JSON.stringify(newExit[i]?.data),
          create_date: getTodayNowAdd7().toDate(),
          create_by: Number(userId),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }

      await this.prisma.booking_row_json.createMany({
        data: mapDataRowJson,
      });

      await this.prisma.submission_comment_capacity_request_management.createMany(
        {
          data: (warningData || []).map((ew: any) => {
            return {
              remark: ew,
              contract_code_id: createContractCode?.id,
              create_by: Number(userId),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
            };
          }),
        },
      );

      const responseUpFile = await uploadFilsTemp(file);
      await this.fileCapacityBooking(
        responseUpFile?.file?.url,
        createContractCode?.id,
        userId,
      );

      if (ckUserType?.id === 2) {
        // createContractCode?.id
        await this.updateStatusCapacityRequestManagement(
          createContractCode?.id,
          {
            status_capacity_request_management_id: 2,
            terminate_date: null, // "2024-12-14", //status_capacity_request_management_id 5 ต้องมี ไม่ 5 ให้ null
            shadow_time: null, //status_capacity_request_management_id 2 ต้องมี ไม่ 2 ให้ null
            shadow_period: null, //status_capacity_request_management_id 2 ต้องมี ไม่ 2 ให้ null
            reject_reasons: null, //"comment.." //status_capacity_request_management_id 3 ต้องมี ไม่ 3 ให้ null
          },
          userId,
          null,
        );
      }

      // console.log('----');

      // await this.pathDetailCreate(createContractCode?.id, userId)
      // ok
    } else {
      if (versionFlag) {
        await this.prisma.contract_code.update({
          where: {
            id: checkContractCodeCheckLast?.id,
          },
          data: {
            ...(!!checkContractCodeCheckLast?.status_capacity_request_management_id && {
              status_capacity_request_management: {
                connect: {
                  id:
                    checkContractCodeCheckLast?.status_capacity_request_management_id ===
                      3
                      ? 1
                      : checkContractCodeCheckLast?.status_capacity_request_management_id,
                },
              },
            }),
            ...(!!checkContractCodeCheckLast?.status_capacity_request_management_id && {
              status_capacity_request_management_process: {
                connect: {
                  id:
                    checkContractCodeCheckLast?.status_capacity_request_management_id ===
                      3
                      ? 3
                      : checkContractCodeCheckLast?.status_capacity_request_management_process_id,
                },
              },
            }),

            file_period_mode: bookingTemplate?.file_period_mode,
            fixdayday: bookingTemplate?.fixdayday,
            todayday: bookingTemplate?.todayday,
            contract_start_date: minDate
              ? getTodayNowDDMMYYYYDfaultAdd7(minDate).toDate()
              : null,
            contract_end_date: maxDate
              ? getTodayNowDDMMYYYYDfaultAdd7(maxDate).toDate()
              : null,
            submitted_timestamp: getTodayNowAdd7().toDate(),
            update_date: getTodayNowAdd7().toDate(),
            update_date_num: getTodayNowAdd7().unix(),
            update_by_account: {
              connect: {
                id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
              },
            },
          },
        });

        await this.prisma.booking_version.updateMany({
          where: {
            contract_code_id: checkContractCodeCheckLast?.id,
          },
          data: {
            flag_use: false,
          },
        });

        const checkContractCodeCheckLength =
          await this.prisma.booking_version.count({
            where: {
              contract_code_id: checkContractCodeCheckLast?.id,
            },
          });

        const versId = await this.prisma.booking_version.create({
          data: {
            version: `v.${checkContractCodeCheckLength + 1}`,
            ...(!!checkContractCodeCheckLast?.id && {
              contract_code: {
                connect: {
                  id: checkContractCodeCheckLast?.id,
                },
              },
            }),
            flag_use: true,
            create_date: getTodayNowAdd7().toDate(),
            create_date_num: getTodayNowAdd7().unix(),
            create_by_account: {
              connect: {
                id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
              },
            },
            submitted_timestamp: getTodayNowAdd7().toDate(),
            type_account: {
              connect: {
                id: 1,
              },
            },
            ...(!!checkContractCodeCheckLast?.status_capacity_request_management_id && {
              status_capacity_request_management: {
                connect: {
                  id:
                    checkContractCodeCheckLast?.status_capacity_request_management_id ===
                      3
                      ? 1
                      : checkContractCodeCheckLast?.status_capacity_request_management_id,
                },
              },
            }),
          },
        });

        await this.prisma.booking_full_json.create({
          data: {
            ...(!!versId?.id && {
              booking_version: {
                connect: {
                  id: versId?.id,
                },
              },
            }),
            data_temp: JSON.stringify(resultTranform),
            create_date: getTodayNowAdd7().toDate(),
            create_date_num: getTodayNowAdd7().unix(),
            create_by_account: {
              connect: {
                id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
              },
            },
          },
        });

        const mapDataRowJson = [];
        for (let i = 0; i < newEntry.length; i++) {
          mapDataRowJson.push({
            booking_version_id: versId?.id,
            entry_exit_id: 1,

            zone_text: newEntry[i]?.zone,
            area_text: newEntry[i]?.area,
            contract_point: newEntry[i]?.contract_point,
            flag_use: true,
            data_temp: JSON.stringify(newEntry[i]?.data),
            create_by: Number(userId),
            create_date: getTodayNowAdd7().toDate(),
            create_date_num: getTodayNowAdd7().unix(),
          });
        }
        for (let i = 0; i < newExit.length; i++) {
          mapDataRowJson.push({
            booking_version_id: versId?.id,
            entry_exit_id: 2,

            zone_text: newExit[i]?.zone,
            area_text: newExit[i]?.area,
            contract_point: newExit[i]?.contract_point,
            flag_use: true,
            data_temp: JSON.stringify(newExit[i]?.data),
            create_by: Number(userId),
            create_date: getTodayNowAdd7().toDate(),
            create_date_num: getTodayNowAdd7().unix(),
          });
        }

        await this.prisma.booking_row_json.createMany({
          data: mapDataRowJson,
        });

        await this.prisma.submission_comment_capacity_request_management.createMany(
          {
            data: (warningData || []).map((ew: any) => {
              return {
                remark: ew,
                contract_code_id: checkContractCodeCheckLast?.id,
                create_by: Number(userId),
                create_date: getTodayNowAdd7().toDate(),
                create_date_num: getTodayNowAdd7().unix(),
              };
            }),
          },
        );

        const responseUpFile = await uploadFilsTemp(file);
        await this.fileCapacityBooking(
          responseUpFile?.file?.url,
          checkContractCodeCheckLast?.id,
          userId,
        );
      } else if (amdFlag) {
        const extendContractLast =
          await this.prisma.extend_contract_capacity_request_management.findFirst(
            {
              where: {
                contract_code_id: checkContractCodeCheckLast?.id,
              },
              orderBy: {
                id: 'desc',
              },
            },
          );
        const configStart = dayjs(extendContractLast?.start_date).format(
          'DD/MM/YYYY',
        );
        const configEnd = dayjs(extendContractLast?.end_date).format(
          'DD/MM/YYYY',
        );

        const resCk = await this.validateEndDate({
          configStart: configStart,
          configEnd: configEnd,
          file_period_mode: bookingTemplate?.file_period_mode,
          shadow_time: checkContractCodeCheckLast?.shadow_time,
          startdate: minDate,
          endDate: maxDate,
          shadow_period: checkContractCodeCheckLast?.shadow_period,
        });

        console.log('resCk : ', resCk);
        if (resCk) {
          console.log('--amd');
          // ได้

          const createContractCodeAmd = await this.prisma.contract_code.create({
            data: {
              contract_code: contract_code,
              ...(!!typeOfContractText && {
                term_type: {
                  connect: {
                    id: typeOfContractText,
                  },
                },
              }),
              ...(!!shipperId?.id && {
                group: {
                  connect: {
                    id: shipperId?.id,
                  },
                },
              }),
              status_capacity_request_management_process: {
                connect: {
                  id: 3,
                },
              },
              status_capacity_request_management: {
                connect: {
                  id: 2,
                },
              },
              type_account: {
                connect: {
                  id: 1,
                },
              },
              ...(!!checkContractCodeCheckLast?.ref_contract_code_by_main_id && {
                ref_contract_code_by_main: {
                  connect: {
                    id: checkContractCodeCheckLast?.ref_contract_code_by_main_id,
                  },
                },
              }),
              ...(!!checkContractCodeCheckLast?.id && {
                ref_contract_code_by: {
                  connect: {
                    id: checkContractCodeCheckLast?.id,
                  },
                },
              }),
              shadow_period: checkContractCodeCheckLast?.shadow_period,
              shadow_time: checkContractCodeCheckLast?.shadow_time,
              file_period_mode: bookingTemplate?.file_period_mode,
              fixdayday: bookingTemplate?.fixdayday,
              todayday: bookingTemplate?.todayday,
              contract_start_date: minDate
                ? getTodayNowDDMMYYYYDfaultAdd7(minDate).toDate()
                : null,
              contract_end_date: maxDate
                ? getTodayNowDDMMYYYYDfaultAdd7(maxDate).toDate()
                : null,
              submitted_timestamp: getTodayNowAdd7().toDate(),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
              create_by_account: {
                connect: {
                  id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
                },
              },
            },
          });

          await this.prisma.contract_code.update({
            where: {
              id: createContractCodeAmd?.id,
            },
            data: {
              ref_contract_code_by_main_id:
                checkContractCodeCheckLast?.ref_contract_code_by_main_id,
              ref_contract_code_by_id: checkContractCodeCheckLast?.id,
            },
          });

          const versId = await this.prisma.booking_version.create({
            data: {
              version: `v.1`,
              ...(!!createContractCodeAmd?.id && {
                contract_code: {
                  connect: {
                    id: createContractCodeAmd?.id,
                  },
                },
              }),
              flag_use: true,
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
              create_by_account: {
                connect: {
                  id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
                },
              },
              submitted_timestamp: getTodayNowAdd7().toDate(),
              type_account: {
                connect: {
                  id: 1,
                },
              },
              status_capacity_request_management: {
                connect: {
                  id: 2,
                },
              },
            },
          });

          await this.prisma.booking_full_json.create({
            data: {
              ...(!!versId?.id && {
                booking_version: {
                  connect: {
                    id: versId?.id,
                  },
                },
              }),
              data_temp: JSON.stringify(resultTranform),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
              create_by_account: {
                connect: {
                  id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
                },
              },
            },
          });

          const mapDataRowJson = [];
          for (let i = 0; i < newEntry.length; i++) {
            mapDataRowJson.push({
              booking_version_id: versId?.id,
              entry_exit_id: 1,

              zone_text: newEntry[i]?.zone,
              area_text: newEntry[i]?.area,
              contract_point: newEntry[i]?.contract_point,
              flag_use: true,
              data_temp: JSON.stringify(newEntry[i]?.data),
              create_date: getTodayNowAdd7().toDate(),
              create_by: Number(userId),
              create_date_num: getTodayNowAdd7().unix(),
            });
          }
          for (let i = 0; i < newExit.length; i++) {
            mapDataRowJson.push({
              booking_version_id: versId?.id,
              entry_exit_id: 2,

              zone_text: newExit[i]?.zone,
              area_text: newExit[i]?.area,
              contract_point: newExit[i]?.contract_point,
              flag_use: true,
              data_temp: JSON.stringify(newExit[i]?.data),
              create_by: Number(userId),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
            });
          }

          await this.prisma.booking_row_json.createMany({
            data: mapDataRowJson,
          });

          await this.prisma.submission_comment_capacity_request_management.createMany(
            {
              data: (warningData || []).map((ew: any) => {
                return {
                  remark: ew,
                  contract_code_id: checkContractCodeCheckLast?.id,
                  create_by: Number(userId),
                  create_date: getTodayNowAdd7().toDate(),
                  create_date_num: getTodayNowAdd7().unix(),
                };
              }),
            },
          );
          const responseUpFile = await uploadFilsTemp(file);
          await this.fileCapacityBooking(
            responseUpFile?.file?.url,
            checkContractCodeCheckLast?.id,
            userId,
          );
        } else {
          // ไม่ได้
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'ไม่ตรงกับ เงื่อนไข shadow time or shadow period',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      } else {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'error เงื่อนไข',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    return {
      message: 'Success.',
    };
  }


  async fileCapacityBooking(url: any, contract_code_id: any, userId: any) {
    return await this.prisma.file_capacity_request_management.create({
      data: {
        url: url,
        contract_code_id: Number(contract_code_id),
        create_by: Number(userId),
        create_date: getTodayNowAdd7().toDate(),
        create_date_num: getTodayNowAdd7().unix(),
      },
    });
  }


  deepEqual(obj1, obj2) {
    if (obj1 === obj2) return true;
    if (
      typeof obj1 !== 'object' ||
      typeof obj2 !== 'object' ||
      obj1 === null ||
      obj2 === null
    ) {
      return false;
    }

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    return keys1.every((key) => this.deepEqual(obj1[key], obj2[key]));
  }

  arraysContainSameElements(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;

    // เปรียบเทียบทุก element โดยไม่สนใจลำดับ
    return arr1.every((item1) =>
      arr2.some((item2) => this.deepEqual(item1, item2)),
    );
  }

  async pathDetailCreate(id: any, userId: any) {
    const contractCodePeriod = await this.prisma.contract_code.findFirst({
      where: { id: Number(id) },
      select: { shadow_period: true },
    });

    const nowDates = getTodayNowAdd7().toDate();

    const pathManagement = await this.prisma.path_management.findFirst({
      where: {
        start_date: {
          lt: getTodayNowDDMMYYYYDfaultAdd7(nowDates).toDate() || null,
        },
      },
      include: {
        path_management_config: {
          include: {
            config_master_path: {
              include: {
                revised_capacity_path: {
                  include: {
                    area: true,
                  },
                },
                revised_capacity_path_edges: true,
              },
            },
          },
        },
      },
      orderBy: {
        start_date: 'desc',
      },
    });

    pathManagement['path_management_config'] = pathManagement[
      'path_management_config'
    ].map((e: any) => {
      return { ...e, temps: this.safeParseJSON(e?.['temps']) };
    });

    const pathConfig = pathManagement['path_management_config'].map(
      (e: any) => {
        const findId = e?.temps?.revised_capacity_path?.find((f: any) => {
          return f?.area?.entry_exit_id === 1;
        });
        const findExit = e?.temps?.revised_capacity_path?.filter((f: any) => {
          return f?.area?.entry_exit_id === 2;
        });

        return {
          ...e,
          entryId: findId?.area?.id,
          entryName: findId?.area?.name,
          findExit,
        };
      },
    );

    const getData = await this.prisma.booking_version.findFirst({
      where: {
        contract_code_id: Number(id),
      },
      include: {
        booking_row_json: true,
        booking_full_json: true,
      },
      orderBy: { id: 'desc' },
    });
    const dataFull = this.safeParseJSON(getData?.['booking_full_json']?.[0]?.data_temp);
    const dataRow = getData['booking_row_json'];
    const entryUse = dataRow.filter((f: any) => {
      return f?.entry_exit_id === 1;
    });
    const exitUse = dataRow.filter((f: any) => {
      return f?.entry_exit_id === 2;
    });

    const entryData: any = [];
    const exitData: any = [];

    for (let i = 0; i < entryUse.length; i++) {
      const contractPoint = await this.prisma.contract_point.findFirst({
        where: { contract_point: this.safeParseJSON(entryUse?.[i]?.data_temp)?.['0'] },
        include: {
          area: {
            select: {
              id: true,
              name: true,
              area_nominal_capacity: true,
            },
          },
          zone: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
      if (
        !contractPoint?.contract_point ||
        !contractPoint?.zone?.name ||
        !contractPoint?.area?.name
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Point is NOT match.',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else {
        entryData.push({
          contract_point: contractPoint?.contract_point,
          entry_exit_id: 1,
          zone_id: contractPoint?.zone?.id,
          zone: contractPoint?.zone?.name,
          area_id: contractPoint?.area?.id,
          area: contractPoint?.area?.name,
          area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
          entryUse: entryUse[i],
        });
      }
    }
    for (let i = 0; i < exitUse.length; i++) {
      const contractPoint = await this.prisma.contract_point.findFirst({
        where: { contract_point: this.safeParseJSON(exitUse?.[i]?.data_temp)?.['0'] },
        include: {
          area: {
            select: {
              id: true,
              name: true,
              area_nominal_capacity: true,
            },
          },
          zone: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
      if (
        !contractPoint?.contract_point ||
        !contractPoint?.zone?.name ||
        !contractPoint?.area?.name
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Point is NOT match.',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else {
        exitData.push({
          contract_point: contractPoint?.contract_point,
          entry_exit_id: contractPoint?.entry_exit_id,
          zone_id: contractPoint?.zone?.id,
          zone: contractPoint?.zone?.name,
          area_id: contractPoint?.area?.id,
          area: contractPoint?.area?.name,
          area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
          exitUse: exitUse[i],
        });
      }
    }
    const pathUsePoint: any = [];
    for (let i = 0; i < exitData.length; i++) {
      const findEx = pathConfig?.find((f: any) => {
        return f?.exit_name_temp === exitData[i]?.area;
      });
      if (!findEx) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Point is NOT match. config path',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else {
        const entryOnce = findEx?.temps?.revised_capacity_path?.find((f: any) => {
          return f?.area?.name === findEx?.exit_name_temp;
        });
        // let entryOnce = findEx?.temps?.revised_capacity_path?.find((f: any) => {
        //   return f?.area?.id === findEx?.entryId;
        // });
        const paths: any = [];
        const pathsFull: any = [];
        const targetIdStart = findEx?.temps?.revised_capacity_path_edges.find(
          (fr: any) => {
            return fr?.source_id === entryOnce?.area?.id;
          },
        );
        paths.push({
          ...entryOnce,
          sourceId: entryOnce?.area?.id,
          targetId: targetIdStart?.target_id,
        });
        pathsFull.push({
          ...entryOnce,
          sourceId: entryOnce?.area?.id,
          targetId: targetIdStart?.target_id,
        });
        for (
          let irs = 0;
          irs < findEx?.temps?.revised_capacity_path_edges.length;
          irs++
        ) {
          const finds = findEx?.temps?.revised_capacity_path.find((fp: any) => {
            return (
              fp?.area?.id ===
              findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
            );
          });
          paths.push({
            ...finds,
            sourceId:
              findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
            targetId:
              findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
          });
          if (finds?.area?.name === findEx?.exit_name_temp) {
            break;
          }
        }
        for (
          let irs = 0;
          irs < findEx?.temps?.revised_capacity_path_edges.length;
          irs++
        ) {
          const finds = findEx?.temps?.revised_capacity_path.find((fp: any) => {
            return (
              fp?.area?.id ===
              findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
            );
          });
          pathsFull.push({
            ...finds,
            sourceId:
              findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
            targetId:
              findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
          });
        }

        pathUsePoint.push({
          ...findEx,
          dataBook: exitData[i],
          paths: paths,
          pathsFull: pathsFull,
        });
      }
    }

    const tempType = dataFull?.shipperInfo['1']['Type of Contract'];
    const contractType =
      tempType === 'LONG'
        ? 1
        : tempType === 'MEDIUM'
          ? 2
          : tempType === 'SHORT_FIRM'
            ? 3
            : tempType === 'SHORT_NON_FIRM'
              ? 3
              : null;

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    const bookingTemplate = await this.prisma.booking_template.findFirst({
      where: {
        term_type_id: Number(contractType),
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

    if (!bookingTemplate) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'booking template date not match',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const file_period_mode = bookingTemplate?.file_period_mode; // 1 = วัน, 2 = เดือน, 3 = ปี
    // ดึงเฉพาะวันที่
    const dailyBooking =
      dataFull?.['headerEntry']?.['Capacity Daily Booking (MMBTU/d)'];
    if (!dailyBooking || typeof dailyBooking !== 'object') {
      return [];
    }
    // ดึง keys เฉพาะวันที่ (ไม่รวม key ที่เป็นของตัว entry เอง)
    const keys = Object.keys(dailyBooking)
      .filter((date) => dailyBooking[date]?.key) // กรองเฉพาะที่เป็นวันที่และมี key
      .map((date) => ({
        key: Number(dailyBooking[date].key), // แปลง key เป็นตัวเลข
        date: date, // ใช้ date เป็นค่า
      }))
      .sort((a, b) => a.key - b.key); // เรียงลำดับตาม key

    const exitValue = dataFull?.exitValue;

    function generateValueExtend(keys, exitValue, file_period_mode) {
      const result = exitValue.map((values) => {
        // const endData = values['34']; // ค่าที่ต้องใช้ใน key สุดท้าย
        const endData = values['6']; // ค่าที่ต้องใช้ใน key สุดท้าย
        const data = keys.map((keyItem) => ({
          key: keyItem.key,
          date: keyItem.date,
          value: values[keyItem.key] || null, // แมตช์ค่า value ตาม key
        }));

        const valueExtend = [];
        for (let i = 0; i < data.length; i++) {
          const current = data[i];
          const next = data[i + 1] || { date: endData }; // ใช้ endData หากเป็น key สุดท้าย

          let startDate = dayjs(current.date, 'DD/MM/YYYY'); // แปลงวันที่จาก DD/MM/YYYY เป็น dayjs object
          let endDate = dayjs(next.date, 'DD/MM/YYYY');

          // Adjust endDate based on file_period_mode
          if (file_period_mode === 1 || file_period_mode === 2) {
            endDate = endDate.subtract(1, 'day'); // Exclude next key's date for days/months
          } else if (file_period_mode === 3 && !next.key) {
            endDate = dayjs(endData, 'DD/MM/YYYY'); // Handle year mode for last key
          }

          while (startDate.isBefore(endDate) || startDate.isSame(endDate)) {
            // Push each date into valueExtend
            valueExtend.push({
              date: startDate.format('YYYY-MM-DD'), // แปลงกลับเป็น YYYY-MM-DD
              value: current.value,
            });

            if (
              file_period_mode === 1 ||
              file_period_mode === 2 ||
              file_period_mode === 3
            ) {
              startDate = startDate.add(1, 'day'); // เพิ่มวันทีละ 1
            }
          }
        }

        return {
          contractPoint: values['0'],
          endData: endData,
          data: data,
          valueExtend: valueExtend,
        };
      });

      return result;
    }

    const resultNewDataExit = generateValueExtend(
      keys,
      exitValue,
      file_period_mode,
    );

    const matchData = pathUsePoint.map((ex: any, ix: any) => {
      return { ...ex, valueEx: resultNewDataExit[ix] };
    });

    const setDataUse = await Promise.all(
      matchData.map(async (sets: any) => {
        const pathAreaId = sets?.paths.map((setsF: any) => {
          return setsF?.area?.id;
        });
        const areaData = await this.prisma.area.findMany({
          where: {
            id: {
              in: pathAreaId,
            },
          },
          select: {
            id: true,
            name: true,
            area_nominal_capacity: true,
            entry_exit_id: true,
          },
        });

        const resCalcNew: any = [];
        for (let ical = 0; ical < areaData.length; ical++) {
          const calcNew: any = [];
          const fCapacityPublication =
            await this.prisma.capacity_publication.findFirst({
              where: {
                area_id: Number(areaData[ical]?.id),
              },
              select: {
                id: true,
                capacity_publication_date: true,
              },
            });

          const resultPeriodAdd = this.extendDates(
            sets?.valueEx?.valueExtend,
            contractCodePeriod?.shadow_period,
          );

          for (let icalAr = 0; icalAr < resultPeriodAdd.length; icalAr++) {
            const isDateMatching = (targetDate, dbDate) => {
              return dbDate.find((entry) => {
                return (
                  dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate
                );
              });
            };
            const ckDateMatch =
              (!!fCapacityPublication &&
                isDateMatching(
                  resultPeriodAdd[icalAr]?.date,
                  fCapacityPublication?.capacity_publication_date,
                )) ||
              false;
            let mainCalc = null;
            let adjust = null;
            let adjustType = null;
            if (ckDateMatch) {
              if (ckDateMatch?.value_adjust_use) {
                adjustType = 'value_adjust_use';
                mainCalc = Number(ckDateMatch?.value_adjust_use);
                adjust = Number(ckDateMatch?.value_adjust_use);
              } else if (ckDateMatch?.value_adjust) {
                adjustType = 'value_adjust';
                mainCalc = Number(ckDateMatch?.value_adjust);
                adjust = Number(ckDateMatch?.value_adjust);
              } else if (ckDateMatch?.value) {
                adjustType = 'value';
                mainCalc = Number(ckDateMatch?.value);
                adjust = Number(ckDateMatch?.value);
              } else {
                adjustType = null;
                mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                adjust = Number(areaData[ical]?.area_nominal_capacity);
              }
            } else {
              adjustType = null;
              mainCalc = Number(areaData[ical]?.area_nominal_capacity);
              adjust = null;
            }

            const cals = mainCalc - Number(resultPeriodAdd[icalAr]?.value);

            let ck_comparea = true;
            ck_comparea =
              icalAr === 0
                ? true
                : resultPeriodAdd[icalAr]?.value ===
                  resultPeriodAdd[icalAr - 1]?.value
                  ? true
                  : false;
            calcNew.push({
              ...resultPeriodAdd[icalAr],
              cals: cals,
              ck_comparea: ck_comparea,
              adjust: adjust,
              adjustType: adjustType,
            });
          }
          resCalcNew.push({
            area_nominal_capacity: Number(
              areaData[ical]?.area_nominal_capacity,
            ),
            area_id: Number(areaData[ical]?.id),
            calcNew,
            entry_exit_id: areaData[ical]?.entry_exit_id,
          });
        }

        return { ...sets, resCalcNew: resCalcNew };
      }),
    );
    console.log('setDataUse : ', setDataUse);
    // ******

    const versionLastUse = await this.prisma.booking_version.findFirst({
      where: {
        flag_use: true,
        contract_code_id: Number(id),
      },
    });

    function assignNestedPeriods(data) {
      const dates = data[0].resCalcNew[0].calcNew.map((item) => item.date); // ดึงลำดับวันที่จาก array แรก
      let periodCounter = 1;

      const periods = dates.map((date, index) => {
        // ตรวจสอบค่าในแต่ละ calc ภายใน resCalcNew ทั้งหมด
        const values = data.flatMap((entry) =>
          entry.resCalcNew.map((res) => res.calcNew[index]?.value),
        );

        // เช็คว่าค่ามีความเปลี่ยนแปลงจากวันที่ก่อนหน้าหรือไม่
        if (index > 0) {
          const prevValues = data.flatMap((entry) =>
            entry.resCalcNew.map((res) => res.calcNew[index - 1]?.value),
          );

          if (!values.every((value, i) => value === prevValues[i])) {
            periodCounter++;
          }
        }

        return periodCounter;
      });

      // เพิ่ม period กลับเข้าไปที่แต่ละ calc ภายใน resCalcNew
      return data.map((entry) => ({
        ...entry,
        resCalcNew: entry.resCalcNew.map((res) => ({
          ...res,
          calcNew: res.calcNew.map((item, index) => ({
            ...item,
            period: periods[index],
          })),
        })),
      }));
    }

    const resultC = assignNestedPeriods(setDataUse);

    const nowDate = getTodayNowAdd7().toDate();

    await this.prisma.capacity_detail.updateMany({
      where: {
        contract_code_id: Number(id),
      },
      data: {
        flag_use: false,
      },
    });
    console.log('resultC : ', resultC);
    const capacityDetail = await this.prisma.capacity_detail.create({
      data: {
        contract_code: {
          connect: {
            id: Number(id),
          },
        },
        booking_version: {
          connect: {
            id: Number(versionLastUse?.id),
          },
        },
        flag_use: true,
        mode_temp: 'APPROVED',
        create_date: nowDate,
        create_date_num: getTodayNowAdd7().unix(),
        create_by_account: {
          connect: {
            id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
          },
        },
      },
    });
    const pointDate: any = [];
    for (let iSave = 0; iSave < resultC.length; iSave++) {
      const { resCalcNew, paths, ...newResultC } = resultC[iSave];

      const savePoint = await this.prisma.capacity_detail_point.create({
        data: {
          capacity_detail: {
            connect: {
              id: Number(capacityDetail?.id),
            },
          },
          area: {
            connect: {
              id: Number(newResultC?.exit_id_temp),
            },
          },
          path_temp: JSON.stringify(paths),
          temp: JSON.stringify(newResultC),
          create_date: nowDate,
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });
      for (
        let iSavePointDate = 0;
        iSavePointDate < resCalcNew.length;
        iSavePointDate++
      ) {
        console.log(
          'resCalcNew[iSavePointDate] : ',
          resCalcNew[iSavePointDate],
        );
        const { calcNew, ...newResCalcNew } = resCalcNew[iSavePointDate];
        for (
          let iSavePointDateCalcNew = 0;
          iSavePointDateCalcNew < calcNew.length;
          iSavePointDateCalcNew++
        ) {
          pointDate.push({
            capacity_detail_point_id: Number(savePoint?.id),
            area_id: Number(newResCalcNew?.area_id),
            value: calcNew[iSavePointDateCalcNew]?.value
              ? String(calcNew[iSavePointDateCalcNew]?.value)
              : null,
            cals: String(calcNew[iSavePointDateCalcNew]?.cals),
            adjust: calcNew[iSavePointDateCalcNew]?.adjust
              ? String(calcNew[iSavePointDateCalcNew]?.adjust)
              : null,
            adjust_type: calcNew[iSavePointDateCalcNew]?.adjustType
              ? String(calcNew[iSavePointDateCalcNew]?.adjustType)
              : null,
            ck_comparea: calcNew[iSavePointDateCalcNew]?.ck_comparea,
            period: Number(calcNew[iSavePointDateCalcNew]?.period),
            area_nominal_capacity: String(newResCalcNew?.area_nominal_capacity),
            date: getTodayNowAdd7(calcNew[iSavePointDateCalcNew]?.date).toDate(),

            create_date: nowDate,
            create_by: Number(userId),
            create_date_num: getTodayNowAdd7().unix(),
          });
        }
      }
    }
    console.log('pointDate : ', pointDate);
    if (pointDate.length > 0) {
      await this.prisma.capacity_detail_point_date.createMany({
        data: pointDate,
      });
    }

    // ******
  }


  async updateStatusCapacityRequestManagement(
    id: any,
    payload: any,
    userId: any,
    req: any,
  ) {
    const {
      status_capacity_request_management_id,
      terminate_date,
      shadow_time,
      shadow_period,
      reject_reasons,
    } = payload;
    let useData: any = null;

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    if (status_capacity_request_management_id === 2) {
      useData = {
        ...(status_capacity_request_management_id !== null && {
          status_capacity_request_management: {
            connect: {
              id: status_capacity_request_management_id,
            },
          },
        }),
        shadow_time: shadow_time,
        shadow_period: shadow_period,
        status_capacity_request_management_process: {
          connect: {
            id: 2,
          },
        },
      };
    } else if (status_capacity_request_management_id === 3) {
      useData = {
        ...(status_capacity_request_management_id !== null && {
          status_capacity_request_management: {
            connect: {
              id: status_capacity_request_management_id,
            },
          },
        }),
        reject_reasons: reject_reasons,
        status_capacity_request_management_process: {
          connect: {
            id: 5,
          },
        },
      };
    } else if (status_capacity_request_management_id === 5) {
      useData = {
        ...(status_capacity_request_management_id !== null && {
          status_capacity_request_management: {
            connect: {
              id: status_capacity_request_management_id,
            },
          },
        }),
        terminate_date: terminate_date ? getTodayNowAdd7(terminate_date).toDate() : null,

        status_capacity_request_management_process: {
          connect: {
            id: 4,
          },
        },
      };
    } else {
      useData = {
        ...(status_capacity_request_management_id !== null && {
          status_capacity_request_management: {
            connect: {
              id: status_capacity_request_management_id,
            },
          },
        }),
      };
    }

    // เพิ่ม shadow period
    if (
      status_capacity_request_management_id === 2 ||
      status_capacity_request_management_id === 4
    ) {
      const contractCodePeriod = await this.prisma.contract_code.findFirst({
        where: { id: Number(id) },
        select: { shadow_period: true },
      });

      const nowDates = getTodayNowAdd7().toDate();

      const pathManagement = await this.prisma.path_management.findFirst({
        where: {
          start_date: {
            lt: getTodayNowDDMMYYYYDfaultAdd7(nowDates).toDate() || null,
          },
        },
        include: {
          path_management_config: {
            include: {
              config_master_path: {
                include: {
                  revised_capacity_path: {
                    include: {
                      area: true,
                    },
                  },
                  revised_capacity_path_edges: true,
                },
              },
            },
          },
        },
        orderBy: {
          start_date: 'desc',
        },
      });
      // console.log('pathManagement : ', pathManagement); ///

      const groupPath = await this.groupPath();
      // console.log('groupPath : ', groupPath);

      pathManagement['path_management_config'] = pathManagement[
        'path_management_config'
      ].map((e: any) => {
        return { ...e, temps: this.safeParseJSON(e?.['temps']) };
      });

      const pathConfig = pathManagement['path_management_config'].map(
        (e: any) => {
          const findId = e?.temps?.revised_capacity_path?.find((f: any) => {
            return f?.area?.entry_exit_id === 1;
          });
          // const findExit = e?.temps?.revised_capacity_path?.filter((f: any) => {
          //   return f?.area?.entry_exit_id === 2;
          // });
          const findExit = e?.temps?.revised_capacity_path?.map((f: any) => {
            return f;
          });
          // console.log('findId : --- > ', findId);
          // console.log('findExit : --- > ', findExit);
          return {
            ...e,
            entryId: findId?.area?.id,
            entryName: findId?.area?.name,
            findExit,
          };
        },
      );
      // console.log('pathConfig : ', pathConfig);

      const getData = await this.prisma.booking_version.findFirst({
        where: {
          contract_code_id: Number(id),
        },
        include: {
          booking_row_json: true,
          booking_full_json: true,
        },
        orderBy: { id: 'desc' },
      });
      // console.log('getData : ', getData);
      const dataFull = this.safeParseJSON(getData?.['booking_full_json']?.[0]?.data_temp);
      const dataRow = getData['booking_row_json'];
      const entryUse = dataRow.filter((f: any) => {
        return f?.entry_exit_id === 1;
      });
      const exitUse = dataRow.filter((f: any) => {
        return f?.entry_exit_id === 2;
      });

      const entryData: any = [];
      const exitData: any = [];
      // console.log('exitUse : ', exitUse);

      for (let i = 0; i < entryUse.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: this.safeParseJSON(entryUse?.[i]?.data_temp)?.['0'] },
          include: {
            area: {
              select: {
                id: true,
                name: true,
                area_nominal_capacity: true,
              },
            },
            zone: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        if (
          !contractPoint?.contract_point ||
          !contractPoint?.zone?.name ||
          !contractPoint?.area?.name
        ) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match.',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          entryData.push({
            contract_point: contractPoint?.contract_point,
            entry_exit_id: 1,
            zone_id: contractPoint?.zone?.id,
            zone: contractPoint?.zone?.name,
            area_id: contractPoint?.area?.id,
            area: contractPoint?.area?.name,
            area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
            entryUse: entryUse[i],
          });
        }
      }
      for (let i = 0; i < exitUse.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: this.safeParseJSON(exitUse?.[i]?.data_temp)?.['0'] },
          include: {
            area: {
              select: {
                id: true,
                name: true,
                area_nominal_capacity: true,
              },
            },
            zone: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        if (
          !contractPoint?.contract_point ||
          !contractPoint?.zone?.name ||
          !contractPoint?.area?.name
        ) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match.',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          exitData.push({
            contract_point: contractPoint?.contract_point,
            entry_exit_id: contractPoint?.entry_exit_id,
            zone_id: contractPoint?.zone?.id,
            zone: contractPoint?.zone?.name,
            area_id: contractPoint?.area?.id,
            area: contractPoint?.area?.name,
            area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
            exitUse: exitUse[i],
          });
        }
      }
      const pathUsePoint: any = [];

      for (let i = 0; i < exitData.length; i++) {
        const findEx = pathConfig?.find((f: any) => {
          return f?.exit_name_temp === exitData[i]?.area;
        });
        // console.log('pathConfig : ', pathConfig);
        // console.log('exitData[i]?.area : ', exitData[i]?.area);
        // console.log('findEx : ', findEx);
        if (!findEx) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match. config path',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          // let entryOnce = findEx?.temps?.revised_capacity_path?.find(
          //   (f: any) => {
          //     return f?.area?.id === findEx?.entryId;
          //   },
          // );
          const entryOnce = findEx?.temps?.revised_capacity_path?.find(
            (f: any) => {
              return f?.area?.name === findEx?.entryName;
            },
          );
          // console.log('entryOnce : ', entryOnce);
          const paths: any = [];
          const pathsFull: any = [];
          const targetIdStart = findEx?.temps?.revised_capacity_path_edges.find(
            (fr: any) => {
              return fr?.source_id === entryOnce?.area?.id;
            },
          );
          // console.log('targetIdStart : ', targetIdStart);
          // console.log("*****************");

          if (!entryOnce?.area?.id || !targetIdStart?.target_id) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: `No path is found in this area.\nPlease configure area's path before approving.`,
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          paths.push({
            ...entryOnce,
            sourceId: entryOnce?.area?.id,
            targetId: targetIdStart?.target_id,
          });

          pathsFull.push({
            ...entryOnce,
            sourceId: entryOnce?.area?.id,
            targetId: targetIdStart?.target_id,
          });
          for (
            let irs = 0;
            irs < findEx?.temps?.revised_capacity_path_edges.length;
            irs++
          ) {
            const finds = findEx?.temps?.revised_capacity_path.find(
              (fp: any) => {
                return (
                  fp?.area?.id ===
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                );
              },
            );
            paths.push({
              ...finds,
              sourceId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
              targetId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
            });
            // if (finds?.area?.name === findEx?.exit_name_temp) {
            //   break;
            // }
          }

          for (
            let irs = 0;
            irs < findEx?.temps?.revised_capacity_path_edges.length;
            irs++
          ) {
            const finds = findEx?.temps?.revised_capacity_path.find(
              (fp: any) => {
                return (
                  fp?.area?.id ===
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                );
              },
            );
            pathsFull.push({
              ...finds,
              sourceId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
              targetId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
            });
          }

          pathUsePoint.push({
            ...findEx,
            dataBook: exitData[i],
            paths: paths,
            pathsFull: pathsFull,
          });
        }
      }
      // console.log('pathUsePoint : ', pathUsePoint);
      const tempType = dataFull?.shipperInfo['1']['Type of Contract'];
      const contractType =
        tempType === 'LONG'
          ? 1
          : tempType === 'MEDIUM'
            ? 2
            : tempType === 'SHORT_FIRM'
              ? 3
              : tempType === 'SHORT_NON_FIRM'
                ? 3
                : null;

      const bookingTemplate = await this.prisma.booking_template.findFirst({
        where: {
          term_type_id: Number(contractType),
          start_date: {
            lte: todayEnd,
          },
          end_date: {
            gte: todayStart,
          },
        },
      });

      if (!bookingTemplate) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'booking template date not match',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const file_period_mode = bookingTemplate?.file_period_mode; // 1 = วัน, 2 = เดือน, 3 = ปี
      // ดึงเฉพาะวันที่
      const dailyBooking =
        dataFull['headerEntry']['Capacity Daily Booking (MMBTU/d)'];
      // ดึง keys เฉพาะวันที่ (ไม่รวม key ที่เป็นของตัว entry เอง)
      const keys = Object.keys(dailyBooking)
        .filter((date) => dailyBooking[date]?.key) // กรองเฉพาะที่เป็นวันที่และมี key
        .map((date) => ({
          key: Number(dailyBooking[date].key), // แปลง key เป็นตัวเลข
          date: date, // ใช้ date เป็นค่า
        }))
        .sort((a, b) => a.key - b.key); // เรียงลำดับตาม key

      const exitValue = dataFull?.exitValue;

      function generateValueExtend(keys, exitValue, file_period_mode) {
        const result = exitValue.map((values) => {
          // const endData = values['34']; // ค่าที่ต้องใช้ใน key สุดท้าย
          const endData = values['6']; // ค่าที่ต้องใช้ใน key สุดท้าย
          const data = keys.map((keyItem) => ({
            key: keyItem.key,
            date: keyItem.date,
            value: values[keyItem.key] || null, // แมตช์ค่า value ตาม key
          }));

          const valueExtend = [];
          for (let i = 0; i < data.length; i++) {
            const current = data[i];
            const next = data[i + 1] || { date: endData }; // ใช้ endData หากเป็น key สุดท้าย

            let startDate = dayjs(current.date, 'DD/MM/YYYY'); // แปลงวันที่จาก DD/MM/YYYY เป็น dayjs object
            let endDate = dayjs(next.date, 'DD/MM/YYYY');

            // Adjust endDate based on file_period_mode
            if (file_period_mode === 1 || file_period_mode === 2) {
              endDate = endDate.subtract(1, 'day'); // Exclude next key's date for days/months
            } else if (file_period_mode === 3 && !next.key) {
              endDate = dayjs(endData, 'DD/MM/YYYY'); // Handle year mode for last key
            }

            while (startDate.isBefore(endDate) || startDate.isSame(endDate)) {
              // Push each date into valueExtend
              valueExtend.push({
                date: startDate.format('YYYY-MM-DD'), // แปลงกลับเป็น YYYY-MM-DD
                value: current.value,
              });

              if (
                file_period_mode === 1 ||
                file_period_mode === 2 ||
                file_period_mode === 3
              ) {
                startDate = startDate.add(1, 'day'); // เพิ่มวันทีละ 1
              }
            }
          }

          return {
            contractPoint: values['0'],
            endData: endData,
            data: data,
            valueExtend: valueExtend,
          };
        });

        return result;
      }

      const resultNewDataExit = generateValueExtend(
        keys,
        exitValue,
        file_period_mode,
      );

      const matchData = pathUsePoint.map((ex: any, ix: any) => {
        return { ...ex, valueEx: resultNewDataExit[ix] };
      });
      console.log('matchData ++++=> : ', matchData);
      const newAreaCompare = matchData.map((cp: any) => {
        return {
          exit_name_temp: cp?.exit_name_temp,
          area: cp?.paths?.map((cpPath: any) => cpPath?.area?.name),
        };
      });

      const logWarning = [];
      const setDataUseZero = await Promise.all(
        matchData.map(async (sets: any) => {
          const pathAreaId = sets?.paths.map((setsF: any) => {
            return setsF?.area?.id;
          });
          const areaData = await this.prisma.area.findMany({
            where: {
              id: {
                in: pathAreaId,
              },
            },
            select: {
              id: true,
              name: true,
              area_nominal_capacity: true,
              entry_exit_id: true,
            },
          });

          const resCalcNew: any = [];
          for (let ical = 0; ical < areaData.length; ical++) {
            const calcNew: any = [];
            const fCapacityPublication =
              await this.prisma.capacity_publication.findFirst({
                where: {
                  area_id: Number(areaData[ical]?.id),
                },
                select: {
                  id: true,
                  capacity_publication_date: true,
                },
              });

            const resultPeriodAdd = this.extendDates(
              sets?.valueEx?.valueExtend,
              contractCodePeriod?.shadow_period,
            );
            // console.log('sets id : ', sets);
            // console.log('sets : ', sets?.exit_name_temp);

            // console.log('sets?.paths : ', sets?.paths.map((ar:any) => ar?.area?.name));
            // console.log('pathAreaId : ', pathAreaId);
            // console.log('resultPeriodAdd : ', resultPeriodAdd);

            for (let icalAr = 0; icalAr < resultPeriodAdd.length; icalAr++) {
              const isDateMatching = (targetDate, dbDate) => {
                return dbDate.find((entry) => {
                  return (
                    dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate
                  );
                });
              };
              const ckDateMatch =
                (!!fCapacityPublication &&
                  isDateMatching(
                    resultPeriodAdd[icalAr]?.date,
                    fCapacityPublication?.capacity_publication_date,
                  )) ||
                false;
              let mainCalc = null;
              let adjust = null;
              let adjustType = null;
              if (ckDateMatch) {
                if (ckDateMatch?.value_adjust_use) {
                  adjustType = 'value_adjust_use';
                  mainCalc = Number(ckDateMatch?.value_adjust_use);
                  adjust = Number(ckDateMatch?.value_adjust_use);
                } else if (ckDateMatch?.value_adjust) {
                  adjustType = 'value_adjust';
                  mainCalc = Number(ckDateMatch?.value_adjust);
                  adjust = Number(ckDateMatch?.value_adjust);
                } else if (ckDateMatch?.value) {
                  adjustType = 'value';
                  mainCalc = Number(ckDateMatch?.value);
                  adjust = Number(ckDateMatch?.value);
                } else {
                  adjustType = null;
                  mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                  adjust = Number(areaData[ical]?.area_nominal_capacity);
                }
              } else {
                adjustType = null;
                mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                adjust = null;
              }

              const cals = mainCalc - Number(resultPeriodAdd[icalAr]?.value);
              if (cals <= 0) {
                logWarning.push(
                  `${resultPeriodAdd[icalAr]?.date} | ${mainCalc} - ${resultPeriodAdd[icalAr]?.value} => calc 0 น้อยกว่า`,
                );
              }
              let ck_comparea = true;
              ck_comparea =
                icalAr === 0
                  ? true
                  : resultPeriodAdd[icalAr]?.value ===
                    resultPeriodAdd[icalAr - 1]?.value
                    ? true
                    : false;
              calcNew.push({
                ...resultPeriodAdd[icalAr],
                cals: cals,
                ck_comparea: ck_comparea,
                adjust: adjust,
                adjustType: adjustType,
              });
            }
            resCalcNew.push({
              area_nominal_capacity: Number(
                areaData[ical]?.area_nominal_capacity,
              ),
              area_id: Number(areaData[ical]?.id),
              area_name: areaData[ical]?.name,
              calcNew,
              entry_exit_id: areaData[ical]?.entry_exit_id,
              exitTemp: {
                id: sets?.exit_id_temp,
                name: sets?.exit_name_temp,
              },
            });
          }

          return { ...sets, resCalcNew: resCalcNew };
        }),
      );
      // setDataUse

      const setDataUse = setDataUseZero.map((sd: any) => {
        const findNotMe = setDataUseZero.filter((fm: any) => {
          return fm?.id != sd?.id;
        });
        const resCalcNewPala = sd['resCalcNew'].map((sdc: any) => {
          const calcNewFinal = sdc['calcNew'].map((dnw: any) => dnw);
          const tempFNM = [];
          findNotMe?.map((fnm: any) => {
            const findCalcNM = fnm['resCalcNew'].find((ffnm: any) => {
              return ffnm['area_name'] === sdc['area_name'];
            });
            if (findCalcNM) {
              tempFNM.push(findCalcNM);
            }
            return fnm;
          });
          for (let cFm = 0; cFm < calcNewFinal.length; cFm++) {
            for (let cFms = 0; cFms < tempFNM.length; cFms++) {
              const findCNF = tempFNM[cFms]?.['calcNew']?.find((fCmf: any) => {
                return fCmf?.date === calcNewFinal[cFm]?.date;
              });
              if (findCNF) {
                const calculatesValue =
                  Number(calcNewFinal[cFm]?.cals) - Number(findCNF?.value);
                calcNewFinal[cFm] = {
                  ...calcNewFinal[cFm],
                  cals: calculatesValue,
                };
              }
            }
          }
          return { ...sdc, calcNew: calcNewFinal };
        });

        return { ...sd, resCalcNew: resCalcNewPala };
      });
      // console.log('setDataUse : ', setDataUse);
      // return null

      for (let upi = 0; upi < setDataUse.length; upi++) {
        for (let fCp = 0; fCp < setDataUse[upi]?.resCalcNew.length; fCp++) {
          const fCapacityPublication =
            await this.prisma.capacity_publication.findFirst({
              where: {
                area_id: Number(setDataUse[upi]?.resCalcNew[fCp]?.area_id),
              },
              select: {
                id: true,
                capacity_publication_date: true,
                area: true,
              },
            });
          // -----
          // continue

          if (status_capacity_request_management_id === 2) {
            if (fCapacityPublication) {
              const icpdData = [];
              const updates = []; // อาร์เรย์เก็บข้อมูลการอัปเดต
              for (
                let iCpD = 0;
                iCpD < setDataUse[upi]?.resCalcNew[fCp]?.calcNew?.length;
                iCpD++
              ) {
                const isDateMatching = (targetDate, dbDate) => {
                  return dbDate.find((entry) => {
                    return (
                      dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate
                    );
                  });
                };
                const ckDateMatch = isDateMatching(
                  setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.date,
                  fCapacityPublication?.capacity_publication_date,
                );
                let updateData = {};
                if (ckDateMatch) {
                  if (ckDateMatch?.value_adjust_use) {
                    updateData = {
                      value_adjust_use: String(
                        setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                      ),
                    };
                  } else if (ckDateMatch?.value_adjust) {
                    updateData = {
                      value_adjust_use: String(
                        setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                      ),
                    };
                  } else if (ckDateMatch?.value) {
                    updateData = {
                      value: String(
                        setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                      ),
                    };
                  } else {
                    updateData = {
                      value: String(
                        setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                      ),
                    };
                  }
                  updates.push({
                    where: { id: Number(ckDateMatch?.id) },
                    data: updateData,
                  });
                } else {
                  icpdData.push({
                    capacity_publication_id: fCapacityPublication?.id,
                    value: String(
                      setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                    ),
                    date_day: getTodayNowAdd7(setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.date).toDate(),
                  });
                }
              }

              if (updates.length > 0) {
                await this.prisma.$transaction(
                  updates.map((update) =>
                    this.prisma.capacity_publication_date.update(update),
                  ),
                );
              }
              await this.prisma.capacity_publication_date.createMany({
                data: icpdData,
              });
            } else {
              const createCP = await this.prisma.capacity_publication.create({
                data: {
                  area: {
                    connect: {
                      id: setDataUse[upi]?.resCalcNew[fCp]?.area_id,
                    },
                  },
                  entry_exit: {
                    connect: {
                      id: setDataUse[upi]?.resCalcNew[fCp]?.entry_exit_id,
                    },
                  },
                },
              });
              const icpdData = [];
              for (
                let iCpD = 0;
                iCpD < setDataUse[upi]?.resCalcNew[fCp]?.calcNew?.length;
                iCpD++
              ) {
                icpdData.push({
                  capacity_publication_id: createCP?.id,
                  value: String(
                    setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                  ),
                  date_day: getTodayNowAdd7(setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.date).toDate(),
                });
              }

              await this.prisma.capacity_publication_date.createMany({
                data: icpdData,
              });
            }
          }
        }
      }

      if (logWarning.length > 0) {
        await this.prisma.capacity_publication_warning.createMany({
          data: (logWarning || []).map((ew: any) => {
            return {
              remark: ew,
              contract_code_id: Number(id),
              create_by: Number(userId),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
            };
          }),
        });
      }
      // path detail

      if (
        status_capacity_request_management_id === 2 ||
        status_capacity_request_management_id === 4
      ) {
        const versionLastUse = await this.prisma.booking_version.findFirst({
          where: {
            flag_use: true,
            contract_code_id: Number(id),
          },
        });

        function assignNestedPeriods(data) {
          const dates = data[0].resCalcNew[0].calcNew.map((item) => item.date); // ดึงลำดับวันที่จาก array แรก
          let periodCounter = 1;

          const periods = dates.map((date, index) => {
            // ตรวจสอบค่าในแต่ละ calc ภายใน resCalcNew ทั้งหมด
            const values = data.flatMap((entry) =>
              entry.resCalcNew.map((res) => res.calcNew[index]?.value),
            );

            // เช็คว่าค่ามีความเปลี่ยนแปลงจากวันที่ก่อนหน้าหรือไม่
            if (index > 0) {
              const prevValues = data.flatMap((entry) =>
                entry.resCalcNew.map((res) => res.calcNew[index - 1]?.value),
              );

              if (!values.every((value, i) => value === prevValues[i])) {
                periodCounter++;
              }
            }

            return periodCounter;
          });

          // เพิ่ม period กลับเข้าไปที่แต่ละ calc ภายใน resCalcNew
          return data.map((entry) => ({
            ...entry,
            resCalcNew: entry.resCalcNew.map((res) => ({
              ...res,
              calcNew: res.calcNew.map((item, index) => ({
                ...item,
                period: periods[index],
              })),
            })),
          }));
        }

        const resultC = assignNestedPeriods(setDataUse);

        const nowDate = getTodayNowAdd7().toDate();

        await this.prisma.capacity_detail.updateMany({
          where: {
            contract_code_id: Number(id),
          },
          data: {
            flag_use: false,
          },
        });
        const capacityDetail = await this.prisma.capacity_detail.create({
          data: {
            contract_code: {
              connect: {
                id: Number(id),
              },
            },
            booking_version: {
              connect: {
                id: Number(versionLastUse?.id),
              },
            },
            flag_use: true,
            mode_temp: 'APPROVED',
            create_date: nowDate,
            create_date_num: getTodayNowAdd7().unix(),
            create_by_account: {
              connect: {
                id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
              },
            },
          },
        });
        const pointDate: any = [];
        for (let iSave = 0; iSave < resultC.length; iSave++) {
          const { resCalcNew, paths, ...newResultC } = resultC[iSave];
          const savePoint = await this.prisma.capacity_detail_point.create({
            data: {
              capacity_detail: {
                connect: {
                  id: Number(capacityDetail?.id),
                },
              },
              area: {
                connect: {
                  id: Number(newResultC?.exit_id_temp),
                },
              },
              path_temp: JSON.stringify(paths),
              temp: JSON.stringify(newResultC),
              create_date: nowDate,
              create_date_num: getTodayNowAdd7().unix(),
              create_by_account: {
                connect: {
                  id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
                },
              },
            },
          });
          for (
            let iSavePointDate = 0;
            iSavePointDate < resCalcNew.length;
            iSavePointDate++
          ) {
            const { calcNew, ...newResCalcNew } = resCalcNew[iSavePointDate];
            for (
              let iSavePointDateCalcNew = 0;
              iSavePointDateCalcNew < calcNew.length;
              iSavePointDateCalcNew++
            ) {
              pointDate.push({
                capacity_detail_point_id: Number(savePoint?.id),
                area_id: Number(newResCalcNew?.area_id),
                value: calcNew[iSavePointDateCalcNew]?.value
                  ? String(calcNew[iSavePointDateCalcNew]?.value)
                  : null,
                cals: String(calcNew[iSavePointDateCalcNew]?.cals),
                adjust: calcNew[iSavePointDateCalcNew]?.adjust
                  ? String(calcNew[iSavePointDateCalcNew]?.adjust)
                  : null,
                adjust_type: calcNew[iSavePointDateCalcNew]?.adjustType
                  ? String(calcNew[iSavePointDateCalcNew]?.adjustType)
                  : null,
                ck_comparea: calcNew[iSavePointDateCalcNew]?.ck_comparea,
                period: Number(calcNew[iSavePointDateCalcNew]?.period),
                area_nominal_capacity: String(
                  newResCalcNew?.area_nominal_capacity,
                ),
                date_day: getTodayNowAdd7(calcNew[iSavePointDateCalcNew]?.date).toDate(),
                create_date: nowDate,
                create_by: Number(userId),
                create_date_num: getTodayNowAdd7().unix(),
              });
            }
          }
        }
        if (pointDate.length > 0) {
          await this.prisma.capacity_detail_point_date.createMany({
            data: pointDate,
          });
        }
      }
    }

    if (status_capacity_request_management_id === 5) {
      const contrCodeCk = await this.prisma.contract_code.findFirst({
        where: {
          id: Number(id),
        },
        select: {
          status_capacity_request_management_id: true,
        },
      });

      if (contrCodeCk?.status_capacity_request_management_id === 2) {
        const contractCodePeriod = await this.prisma.contract_code.findFirst({
          where: { id: Number(id) },
          select: { shadow_period: true },
        });

        const nowDates = getTodayNowAdd7().toDate();

        const pathManagement = await this.prisma.path_management.findFirst({
          where: {
            start_date: {
              lt: getTodayNowDDMMYYYYDfaultAdd7(nowDates).toDate() || null,
            },
          },
          include: {
            path_management_config: {
              include: {
                config_master_path: {
                  include: {
                    revised_capacity_path: {
                      include: {
                        area: true,
                      },
                    },
                    revised_capacity_path_edges: true,
                  },
                },
              },
            },
          },
          orderBy: {
            start_date: 'desc',
          },
        });

        pathManagement['path_management_config'] = pathManagement[
          'path_management_config'
        ].map((e: any) => {
          return { ...e, temps: this.safeParseJSON(e?.['temps']) };
        });

        const pathConfig = pathManagement['path_management_config'].map(
          (e: any) => {
            const findId = e?.temps?.revised_capacity_path?.find((f: any) => {
              return f?.area?.entry_exit_id === 1;
            });
            const findExit = e?.temps?.revised_capacity_path?.filter(
              (f: any) => {
                return f?.area?.entry_exit_id === 2;
              },
            );

            return {
              ...e,
              entryId: findId?.area?.id,
              entryName: findId?.area?.name,
              findExit,
            };
          },
        );

        const getData = await this.prisma.booking_version.findFirst({
          where: {
            contract_code_id: Number(id),
          },
          include: {
            booking_row_json: true,
            booking_full_json: true,
          },
          orderBy: { id: 'desc' },
        });
        const dataFull = this.safeParseJSON(getData?.['booking_full_json']?.[0]?.data_temp);
        const dataRow = getData['booking_row_json'];
        const entryUse = dataRow.filter((f: any) => {
          return f?.entry_exit_id === 1;
        });
        const exitUse = dataRow.filter((f: any) => {
          return f?.entry_exit_id === 2;
        });

        const entryData: any = [];
        const exitData: any = [];

        for (let i = 0; i < entryUse.length; i++) {
          const contractPoint = await this.prisma.contract_point.findFirst({
            where: { contract_point: this.safeParseJSON(entryUse?.[i]?.data_temp)?.['0'] },
            include: {
              area: {
                select: {
                  id: true,
                  name: true,
                  area_nominal_capacity: true,
                },
              },
              zone: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          });
          if (
            !contractPoint?.contract_point ||
            !contractPoint?.zone?.name ||
            !contractPoint?.area?.name
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Point is NOT match.',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else {
            entryData.push({
              contract_point: contractPoint?.contract_point,
              entry_exit_id: 1,
              zone_id: contractPoint?.zone?.id,
              zone: contractPoint?.zone?.name,
              area_id: contractPoint?.area?.id,
              area: contractPoint?.area?.name,
              area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
              entryUse: entryUse[i],
            });
          }
        }
        for (let i = 0; i < exitUse.length; i++) {
          const contractPoint = await this.prisma.contract_point.findFirst({
            where: { contract_point: this.safeParseJSON(exitUse?.[i]?.data_temp)?.['0'] },
            include: {
              area: {
                select: {
                  id: true,
                  name: true,
                  area_nominal_capacity: true,
                },
              },
              zone: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          });
          if (
            !contractPoint?.contract_point ||
            !contractPoint?.zone?.name ||
            !contractPoint?.area?.name
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Point is NOT match.',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else {
            exitData.push({
              contract_point: contractPoint?.contract_point,
              entry_exit_id: contractPoint?.entry_exit_id,
              zone_id: contractPoint?.zone?.id,
              zone: contractPoint?.zone?.name,
              area_id: contractPoint?.area?.id,
              area: contractPoint?.area?.name,
              area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
              exitUse: exitUse[i],
            });
          }
        }
        const pathUsePoint: any = [];
        for (let i = 0; i < exitData.length; i++) {
          const findEx = pathConfig?.find((f: any) => {
            return f?.exit_name_temp === exitData[i]?.area;
          });
          if (!findEx) {
            console.log('----2');
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Point is NOT match. config path',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else {
            const entryOnce = findEx?.temps?.revised_capacity_path?.find(
              (f: any) => {
                return f?.area?.name === findEx?.exit_name_temp;
              },
            );
            // let entryOnce = findEx?.temps?.revised_capacity_path?.find(
            //   (f: any) => {
            //     return f?.area?.id === findEx?.entryId;
            //   },
            // );
            const paths: any = [];
            const pathsFull: any = [];
            const targetIdStart =
              findEx?.temps?.revised_capacity_path_edges.find((fr: any) => {
                return fr?.source_id === entryOnce?.area?.id;
              });
            paths.push({
              ...entryOnce,
              sourceId: entryOnce?.area?.id,
              targetId: targetIdStart?.target_id,
            });
            pathsFull.push({
              ...entryOnce,
              sourceId: entryOnce?.area?.id,
              targetId: targetIdStart?.target_id,
            });
            for (
              let irs = 0;
              irs < findEx?.temps?.revised_capacity_path_edges.length;
              irs++
            ) {
              const finds = findEx?.temps?.revised_capacity_path.find(
                (fp: any) => {
                  return (
                    fp?.area?.id ===
                    findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                  );
                },
              );
              paths.push({
                ...finds,
                sourceId:
                  findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
                targetId:
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
              });
              if (finds?.area?.name === findEx?.exit_name_temp) {
                break;
              }
            }
            for (
              let irs = 0;
              irs < findEx?.temps?.revised_capacity_path_edges.length;
              irs++
            ) {
              const finds = findEx?.temps?.revised_capacity_path.find(
                (fp: any) => {
                  return (
                    fp?.area?.id ===
                    findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                  );
                },
              );
              pathsFull.push({
                ...finds,
                sourceId:
                  findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
                targetId:
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
              });
            }

            pathUsePoint.push({
              ...findEx,
              dataBook: exitData[i],
              paths: paths,
              pathsFull: pathsFull,
            });
          }
        }

        const tempType = dataFull?.shipperInfo['1']['Type of Contract'];
        const contractType =
          tempType === 'LONG'
            ? 1
            : tempType === 'MEDIUM'
              ? 2
              : tempType === 'SHORT_FIRM'
                ? 3
                : tempType === 'SHORT_NON_FIRM'
                  ? 3
                  : null;

        const bookingTemplate = await this.prisma.booking_template.findFirst({
          where: {
            term_type_id: Number(contractType),
            start_date: {
              lte: todayEnd,
            },
            end_date: {
              gte: todayStart,
            },
          },
        });

        if (!bookingTemplate) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'booking template date not match',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        const file_period_mode = bookingTemplate?.file_period_mode; // 1 = วัน, 2 = เดือน, 3 = ปี
        // ดึงเฉพาะวันที่
        const dailyBooking =
          dataFull['headerEntry']['Capacity Daily Booking (MMBTU/d)'];
        // ดึง keys เฉพาะวันที่ (ไม่รวม key ที่เป็นของตัว entry เอง)
        const keys = Object.keys(dailyBooking)
          .filter((date) => dailyBooking[date]?.key) // กรองเฉพาะที่เป็นวันที่และมี key
          .map((date) => ({
            key: Number(dailyBooking[date].key), // แปลง key เป็นตัวเลข
            date: date, // ใช้ date เป็นค่า
          }))
          .sort((a, b) => a.key - b.key); // เรียงลำดับตาม key

        const exitValue = dataFull?.exitValue;

        function generateValueExtend(keys, exitValue, file_period_mode) {
          const result = exitValue.map((values) => {
            // const endData = values['34']; // ค่าที่ต้องใช้ใน key สุดท้าย
            const endData = values['6']; // ค่าที่ต้องใช้ใน key สุดท้าย
            const data = keys.map((keyItem) => ({
              key: keyItem.key,
              date: keyItem.date,
              value: values[keyItem.key] || null, // แมตช์ค่า value ตาม key
            }));

            const valueExtend = [];
            for (let i = 0; i < data.length; i++) {
              const current = data[i];
              const next = data[i + 1] || { date: endData }; // ใช้ endData หากเป็น key สุดท้าย

              let startDate = dayjs(current.date, 'DD/MM/YYYY'); // แปลงวันที่จาก DD/MM/YYYY เป็น dayjs object
              let endDate = dayjs(next.date, 'DD/MM/YYYY');

              // Adjust endDate based on file_period_mode
              if (file_period_mode === 1 || file_period_mode === 2) {
                endDate = endDate.subtract(1, 'day'); // Exclude next key's date for days/months
              } else if (file_period_mode === 3 && !next.key) {
                endDate = dayjs(endData, 'DD/MM/YYYY'); // Handle year mode for last key
              }

              while (startDate.isBefore(endDate) || startDate.isSame(endDate)) {
                // Push each date into valueExtend
                valueExtend.push({
                  date: startDate.format('YYYY-MM-DD'), // แปลงกลับเป็น YYYY-MM-DD
                  value: current.value,
                });

                if (
                  file_period_mode === 1 ||
                  file_period_mode === 2 ||
                  file_period_mode === 3
                ) {
                  startDate = startDate.add(1, 'day'); // เพิ่มวันทีละ 1
                }
              }
            }

            return {
              contractPoint: values['0'],
              endData: endData,
              data: data,
              valueExtend: valueExtend,
            };
          });

          return result;
        }

        const resultNewDataExit = generateValueExtend(
          keys,
          exitValue,
          file_period_mode,
        );

        const matchData = pathUsePoint.map((ex: any, ix: any) => {
          return { ...ex, valueEx: resultNewDataExit[ix] };
        });

        const logWarning = [];
        const setDataUse = await Promise.all(
          matchData.map(async (sets: any) => {
            const pathAreaId = sets?.paths.map((setsF: any) => {
              return setsF?.area?.id;
            });
            const areaData = await this.prisma.area.findMany({
              where: {
                id: {
                  in: pathAreaId,
                },
              },
              select: {
                id: true,
                name: true,
                area_nominal_capacity: true,
                entry_exit_id: true,
              },
            });

            const resCalcNew: any = [];
            for (let ical = 0; ical < areaData.length; ical++) {
              const calcNew: any = [];
              const fCapacityPublication =
                await this.prisma.capacity_publication.findFirst({
                  where: {
                    area_id: Number(areaData[ical]?.id),
                  },
                  select: {
                    id: true,
                    capacity_publication_date: true,
                  },
                });

              const resultPeriodAdd = this.extendDates(
                sets?.valueEx?.valueExtend,
                contractCodePeriod?.shadow_period,
              );

              for (let icalAr = 0; icalAr < resultPeriodAdd.length; icalAr++) {
                const isDateMatching = (targetDate, dbDate) => {
                  return dbDate.find((entry) => {
                    return (
                      dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate
                    );
                  });
                };
                // เรียกใช้งาน
                const ckDateMatch =
                  (!!fCapacityPublication &&
                    isDateMatching(
                      resultPeriodAdd[icalAr]?.date,
                      fCapacityPublication?.capacity_publication_date,
                    )) ||
                  false;
                let mainCalc = null;
                let adjust = null;
                let adjustType = null;
                if (ckDateMatch) {
                  if (ckDateMatch?.value_adjust_use) {
                    adjustType = 'value_adjust_use';
                    mainCalc = Number(ckDateMatch?.value_adjust_use);
                    adjust = Number(ckDateMatch?.value_adjust_use);
                  } else if (ckDateMatch?.value_adjust) {
                    adjustType = 'value_adjust';
                    mainCalc = Number(ckDateMatch?.value_adjust);
                    adjust = Number(ckDateMatch?.value_adjust);
                  } else if (ckDateMatch?.value) {
                    adjustType = 'value';
                    mainCalc = Number(ckDateMatch?.value);
                    adjust = null;
                  } else {
                    adjustType = null;
                    mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                    adjust = null;
                  }
                } else {
                  adjustType = null;
                  mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                  adjust = null;
                }

                const cals = Number(resultPeriodAdd[icalAr]?.value) + mainCalc;

                let ck_comparea = true;
                ck_comparea =
                  icalAr === 0
                    ? true
                    : resultPeriodAdd[icalAr]?.value ===
                      resultPeriodAdd[icalAr - 1]?.value
                      ? true
                      : false;
                calcNew.push({
                  ...resultPeriodAdd[icalAr],
                  cals: cals,
                  ck_comparea: ck_comparea,
                  adjust: adjust,
                  adjustType: adjustType,
                });
              }
              resCalcNew.push({
                area_nominal_capacity: Number(
                  areaData[ical]?.area_nominal_capacity,
                ),
                area_id: Number(areaData[ical]?.id),
                calcNew,
                entry_exit_id: areaData[ical]?.entry_exit_id,
              });
            }

            for (let fCp = 0; fCp < resCalcNew.length; fCp++) {
              const fCapacityPublication =
                await this.prisma.capacity_publication.findFirst({
                  where: {
                    area_id: Number(resCalcNew[fCp]?.area_id),
                  },
                  select: {
                    id: true,
                    capacity_publication_date: true,
                    area: true,
                  },
                });
              if (fCapacityPublication) {
                const updates = []; // อาร์เรย์เก็บข้อมูลการอัปเดต
                for (
                  let iCpD = 0;
                  iCpD < resCalcNew[fCp]?.calcNew?.length;
                  iCpD++
                ) {
                  const isDateMatching = (targetDate, dbDate) => {
                    return dbDate.find((entry) => {
                      return (
                        dayjs(entry.date_day).format('YYYY-MM-DD') ===
                        targetDate
                      );
                    });
                  };
                  const ckDateMatch = isDateMatching(
                    resCalcNew[fCp]?.calcNew[iCpD]?.date,
                    fCapacityPublication?.capacity_publication_date,
                  );

                  if (
                    dayjs(ckDateMatch?.date_day).isSameOrAfter(
                      dayjs(terminate_date),
                    )
                  ) {
                    let updateData = {};

                    if (ckDateMatch?.value_adjust_use) {
                      updateData = {
                        value_adjust_use: String(
                          resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                        ),
                      };
                    } else if (ckDateMatch?.value_adjust) {
                      updateData = {
                        value_adjust_use: String(
                          resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                        ),
                      };
                    } else if (ckDateMatch?.value) {
                      updateData = {
                        value: String(resCalcNew[fCp]?.calcNew[iCpD]?.cals),
                      };
                    } else {
                      updateData = {
                        value: String(resCalcNew[fCp]?.calcNew[iCpD]?.cals),
                      };
                    }
                    updates.push({
                      where: { id: Number(ckDateMatch?.id) },
                      data: updateData,
                    });
                  }
                }

                if (updates.length > 0) {
                  await this.prisma.$transaction(
                    updates.map((update) =>
                      this.prisma.capacity_publication_date.update(update),
                    ),
                  );
                }
              }
            }

            return { ...sets, resCalcNew: resCalcNew };
          }),
        );
      }
    }

    if (status_capacity_request_management_id === 3) {
      console.log('reject');

      const contrCodeCk = await this.prisma.contract_code.findFirst({
        where: {
          id: Number(id),
        },
        select: {
          status_capacity_request_management_id: true,
        },
      });

      if (contrCodeCk?.status_capacity_request_management_id === 2) {
        const contractCodePeriod = await this.prisma.contract_code.findFirst({
          where: { id: Number(id) },
          select: { shadow_period: true },
        });

        const nowDates = getTodayNowAdd7().toDate();

        const pathManagement = await this.prisma.path_management.findFirst({
          where: {
            start_date: {
              lt: getTodayNowDDMMYYYYDfaultAdd7(nowDates).toDate() || null,
            },
          },
          include: {
            path_management_config: {
              include: {
                config_master_path: {
                  include: {
                    revised_capacity_path: {
                      include: {
                        area: true,
                      },
                    },
                    revised_capacity_path_edges: true,
                  },
                },
              },
            },
          },
          orderBy: {
            start_date: 'desc',
          },
        });

        pathManagement['path_management_config'] = pathManagement[
          'path_management_config'
        ].map((e: any) => {
          return { ...e, temps: this.safeParseJSON(e?.['temps']) };
        });

        const pathConfig = pathManagement['path_management_config'].map(
          (e: any) => {
            const findId = e?.temps?.revised_capacity_path?.find((f: any) => {
              return f?.area?.entry_exit_id === 1;
            });
            const findExit = e?.temps?.revised_capacity_path?.filter(
              (f: any) => {
                return f?.area?.entry_exit_id === 2;
              },
            );

            return {
              ...e,
              entryId: findId?.area?.id,
              entryName: findId?.area?.name,
              findExit,
            };
          },
        );

        const getData = await this.prisma.booking_version.findFirst({
          where: {
            contract_code_id: Number(id),
          },
          include: {
            booking_row_json: true,
            booking_full_json: true,
          },
          orderBy: { id: 'desc' },
        });
        const dataFull = this.safeParseJSON(getData?.['booking_full_json']?.[0]?.data_temp);
        const dataRow = getData['booking_row_json'];
        const entryUse = dataRow.filter((f: any) => {
          return f?.entry_exit_id === 1;
        });
        const exitUse = dataRow.filter((f: any) => {
          return f?.entry_exit_id === 2;
        });

        const entryData: any = [];
        const exitData: any = [];

        for (let i = 0; i < entryUse.length; i++) {
          const contractPoint = await this.prisma.contract_point.findFirst({
            where: { contract_point: this.safeParseJSON(entryUse?.[i]?.data_temp)?.['0'] },
            include: {
              area: {
                select: {
                  id: true,
                  name: true,
                  area_nominal_capacity: true,
                },
              },
              zone: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          });
          if (
            !contractPoint?.contract_point ||
            !contractPoint?.zone?.name ||
            !contractPoint?.area?.name
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Point is NOT match.',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else {
            entryData.push({
              contract_point: contractPoint?.contract_point,
              entry_exit_id: 1,
              zone_id: contractPoint?.zone?.id,
              zone: contractPoint?.zone?.name,
              area_id: contractPoint?.area?.id,
              area: contractPoint?.area?.name,
              area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
              entryUse: entryUse[i],
            });
          }
        }
        for (let i = 0; i < exitUse.length; i++) {
          const contractPoint = await this.prisma.contract_point.findFirst({
            where: { contract_point: this.safeParseJSON(exitUse?.[i]?.data_temp)?.['0'] },
            include: {
              area: {
                select: {
                  id: true,
                  name: true,
                  area_nominal_capacity: true,
                },
              },
              zone: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          });
          if (
            !contractPoint?.contract_point ||
            !contractPoint?.zone?.name ||
            !contractPoint?.area?.name
          ) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Point is NOT match.',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else {
            exitData.push({
              contract_point: contractPoint?.contract_point,
              entry_exit_id: contractPoint?.entry_exit_id,
              zone_id: contractPoint?.zone?.id,
              zone: contractPoint?.zone?.name,
              area_id: contractPoint?.area?.id,
              area: contractPoint?.area?.name,
              area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
              exitUse: exitUse[i],
            });
          }
        }
        const pathUsePoint: any = [];
        for (let i = 0; i < exitData.length; i++) {
          const findEx = pathConfig?.find((f: any) => {
            return f?.exit_name_temp === exitData[i]?.area;
          });
          if (!findEx) {
            console.log('----3');
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'Point is NOT match. config path',
              },
              HttpStatus.BAD_REQUEST,
            );
          } else {
            const entryOnce = findEx?.temps?.revised_capacity_path?.find(
              (f: any) => {
                return f?.area?.name === findEx?.exit_name_temp;
              },
            );
            // let entryOnce = findEx?.temps?.revised_capacity_path?.find(
            //   (f: any) => {
            //     return f?.area?.id === findEx?.entryId;
            //   },
            // );
            const paths: any = [];
            const pathsFull: any = [];
            const targetIdStart =
              findEx?.temps?.revised_capacity_path_edges.find((fr: any) => {
                return fr?.source_id === entryOnce?.area?.id;
              });
            paths.push({
              ...entryOnce,
              sourceId: entryOnce?.area?.id,
              targetId: targetIdStart?.target_id,
            });
            pathsFull.push({
              ...entryOnce,
              sourceId: entryOnce?.area?.id,
              targetId: targetIdStart?.target_id,
            });
            for (
              let irs = 0;
              irs < findEx?.temps?.revised_capacity_path_edges.length;
              irs++
            ) {
              const finds = findEx?.temps?.revised_capacity_path.find(
                (fp: any) => {
                  return (
                    fp?.area?.id ===
                    findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                  );
                },
              );
              paths.push({
                ...finds,
                sourceId:
                  findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
                targetId:
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
              });
              if (finds?.area?.name === findEx?.exit_name_temp) {
                break;
              }
            }
            for (
              let irs = 0;
              irs < findEx?.temps?.revised_capacity_path_edges.length;
              irs++
            ) {
              const finds = findEx?.temps?.revised_capacity_path.find(
                (fp: any) => {
                  return (
                    fp?.area?.id ===
                    findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                  );
                },
              );
              pathsFull.push({
                ...finds,
                sourceId:
                  findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
                targetId:
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
              });
            }

            pathUsePoint.push({
              ...findEx,
              dataBook: exitData[i],
              paths: paths,
              pathsFull: pathsFull,
            });
          }
        }

        const tempType = dataFull?.shipperInfo['1']['Type of Contract'];
        const contractType =
          tempType === 'LONG'
            ? 1
            : tempType === 'MEDIUM'
              ? 2
              : tempType === 'SHORT_FIRM'
                ? 3
                : tempType === 'SHORT_NON_FIRM'
                  ? 3
                  : null;

        const bookingTemplate = await this.prisma.booking_template.findFirst({
          where: {
            term_type_id: Number(contractType),
            start_date: {
              lte: todayEnd,
            },
            end_date: {
              gte: todayStart,
            },
          },
        });

        if (!bookingTemplate) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'booking template date not match',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        const file_period_mode = bookingTemplate?.file_period_mode; // 1 = วัน, 2 = เดือน, 3 = ปี
        // ดึงเฉพาะวันที่
        const dailyBooking =
          dataFull['headerEntry']['Capacity Daily Booking (MMBTU/d)'];
        // ดึง keys เฉพาะวันที่ (ไม่รวม key ที่เป็นของตัว entry เอง)
        const keys = Object.keys(dailyBooking)
          .filter((date) => dailyBooking[date]?.key) // กรองเฉพาะที่เป็นวันที่และมี key
          .map((date) => ({
            key: Number(dailyBooking[date].key), // แปลง key เป็นตัวเลข
            date: date, // ใช้ date เป็นค่า
          }))
          .sort((a, b) => a.key - b.key); // เรียงลำดับตาม key

        const exitValue = dataFull?.exitValue;

        function generateValueExtend(keys, exitValue, file_period_mode) {
          const result = exitValue.map((values) => {
            // const endData = values['34']; // ค่าที่ต้องใช้ใน key สุดท้าย
            const endData = values['6']; // ค่าที่ต้องใช้ใน key สุดท้าย
            const data = keys.map((keyItem) => ({
              key: keyItem.key,
              date: keyItem.date,
              value: values[keyItem.key] || null, // แมตช์ค่า value ตาม key
            }));

            const valueExtend = [];
            for (let i = 0; i < data.length; i++) {
              const current = data[i];
              const next = data[i + 1] || { date: endData }; // ใช้ endData หากเป็น key สุดท้าย

              let startDate = dayjs(current.date, 'DD/MM/YYYY'); // แปลงวันที่จาก DD/MM/YYYY เป็น dayjs object
              let endDate = dayjs(next.date, 'DD/MM/YYYY');

              // Adjust endDate based on file_period_mode
              if (file_period_mode === 1 || file_period_mode === 2) {
                endDate = endDate.subtract(1, 'day'); // Exclude next key's date for days/months
              } else if (file_period_mode === 3 && !next.key) {
                endDate = dayjs(endData, 'DD/MM/YYYY'); // Handle year mode for last key
              }

              while (startDate.isBefore(endDate) || startDate.isSame(endDate)) {
                // Push each date into valueExtend
                valueExtend.push({
                  date: startDate.format('YYYY-MM-DD'), // แปลงกลับเป็น YYYY-MM-DD
                  value: current.value,
                });

                if (
                  file_period_mode === 1 ||
                  file_period_mode === 2 ||
                  file_period_mode === 3
                ) {
                  startDate = startDate.add(1, 'day'); // เพิ่มวันทีละ 1
                }
              }
            }

            return {
              contractPoint: values['0'],
              endData: endData,
              data: data,
              valueExtend: valueExtend,
            };
          });

          return result;
        }

        const resultNewDataExit = generateValueExtend(
          keys,
          exitValue,
          file_period_mode,
        );

        const matchData = pathUsePoint.map((ex: any, ix: any) => {
          return { ...ex, valueEx: resultNewDataExit[ix] };
        });

        const logWarning = [];
        const setDataUse = await Promise.all(
          matchData.map(async (sets: any) => {
            const pathAreaId = sets?.paths.map((setsF: any) => {
              return setsF?.area?.id;
            });
            const areaData = await this.prisma.area.findMany({
              where: {
                id: {
                  in: pathAreaId,
                },
              },
              select: {
                id: true,
                name: true,
                area_nominal_capacity: true,
                entry_exit_id: true,
              },
            });

            const resCalcNew: any = [];
            for (let ical = 0; ical < areaData.length; ical++) {
              const calcNew: any = [];
              const fCapacityPublication =
                await this.prisma.capacity_publication.findFirst({
                  where: {
                    area_id: Number(areaData[ical]?.id),
                  },
                  select: {
                    id: true,
                    capacity_publication_date: true,
                  },
                });

              const resultPeriodAdd = this.extendDates(
                sets?.valueEx?.valueExtend,
                contractCodePeriod?.shadow_period,
              );

              for (let icalAr = 0; icalAr < resultPeriodAdd.length; icalAr++) {
                const isDateMatching = (targetDate, dbDate) => {
                  return dbDate.find((entry) => {
                    return (
                      dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate
                    );
                  });
                };
                // เรียกใช้งาน
                const ckDateMatch =
                  (!!fCapacityPublication &&
                    isDateMatching(
                      resultPeriodAdd[icalAr]?.date,
                      fCapacityPublication?.capacity_publication_date,
                    )) ||
                  false;
                let mainCalc = null;
                let adjust = null;
                let adjustType = null;
                if (ckDateMatch) {
                  if (ckDateMatch?.value_adjust_use) {
                    adjustType = 'value_adjust_use';
                    mainCalc = Number(ckDateMatch?.value_adjust_use);
                    adjust = Number(ckDateMatch?.value_adjust_use);
                  } else if (ckDateMatch?.value_adjust) {
                    adjustType = 'value_adjust';
                    mainCalc = Number(ckDateMatch?.value_adjust);
                    adjust = Number(ckDateMatch?.value_adjust);
                  } else if (ckDateMatch?.value) {
                    adjustType = 'value';
                    mainCalc = Number(ckDateMatch?.value);
                    adjust = null;
                  } else {
                    adjustType = null;
                    mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                    adjust = null;
                  }
                } else {
                  adjustType = null;
                  mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                  adjust = null;
                }

                const cals = Number(resultPeriodAdd[icalAr]?.value) + mainCalc;

                let ck_comparea = true;
                ck_comparea =
                  icalAr === 0
                    ? true
                    : resultPeriodAdd[icalAr]?.value ===
                      resultPeriodAdd[icalAr - 1]?.value
                      ? true
                      : false;
                calcNew.push({
                  ...resultPeriodAdd[icalAr],
                  cals: cals,
                  ck_comparea: ck_comparea,
                  adjust: adjust,
                  adjustType: adjustType,
                });
              }
              resCalcNew.push({
                area_nominal_capacity: Number(
                  areaData[ical]?.area_nominal_capacity,
                ),
                area_id: Number(areaData[ical]?.id),
                calcNew,
                entry_exit_id: areaData[ical]?.entry_exit_id,
              });
            }

            for (let fCp = 0; fCp < resCalcNew.length; fCp++) {
              const fCapacityPublication =
                await this.prisma.capacity_publication.findFirst({
                  where: {
                    area_id: Number(resCalcNew[fCp]?.area_id),
                  },
                  select: {
                    id: true,
                    capacity_publication_date: true,
                    area: true,
                  },
                });
              if (fCapacityPublication) {
                const updates = []; // อาร์เรย์เก็บข้อมูลการอัปเดต
                for (
                  let iCpD = 0;
                  iCpD < resCalcNew[fCp]?.calcNew?.length;
                  iCpD++
                ) {
                  const isDateMatching = (targetDate, dbDate) => {
                    return dbDate.find((entry) => {
                      return (
                        dayjs(entry.date_day).format('YYYY-MM-DD') ===
                        targetDate
                      );
                    });
                  };
                  // // เรียกใช้งาน
                  const ckDateMatch = isDateMatching(
                    resCalcNew[fCp]?.calcNew[iCpD]?.date,
                    fCapacityPublication?.capacity_publication_date,
                  );
                  if (ckDateMatch) {
                    let updateData = {};
                    if (ckDateMatch?.value_adjust_use) {
                      updateData = {
                        ckDateMatch,
                        value_adjust_use: String(
                          resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                        ),
                      };
                    } else if (ckDateMatch?.value_adjust) {
                      updateData = {
                        ckDateMatch,
                        value_adjust_use: String(
                          resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                        ),
                      };
                    } else if (ckDateMatch?.value) {
                      updateData = {
                        ckDateMatch,
                        value: String(resCalcNew[fCp]?.calcNew[iCpD]?.cals),
                      };
                    } else {
                      updateData = {
                        ckDateMatch,
                        value: String(resCalcNew[fCp]?.calcNew[iCpD]?.cals),
                      };
                    }
                    updates.push({
                      where: { id: Number(ckDateMatch?.id) },
                      data: updateData,
                    });
                  }
                }
                if (updates.length > 0) {
                  await this.prisma.$transaction(
                    updates.map((update) =>
                      this.prisma.capacity_publication_date.update(update),
                    ),
                  );
                }
              }
            }

            return { ...sets, resCalcNew: resCalcNew };
          }),
        );
      }
    }

    if (status_capacity_request_management_id === 5) {
      const updateResult = await this.prisma.query_shipper_nomination_file.updateMany({
        where: {
          contract_code_id: Number(id),
        },
        data: {
          query_shipper_nomination_status_id: 3,
        },
      });
    }

    const resData = await this.prisma.contract_code.update({
      where: {
        id: Number(id),
      },
      data: {
        ...useData,
        update_by_account: {
          connect: {
            id: Number(userId),
          },
        },
        update_date: getTodayNowAdd7().toDate(),
        update_date_num: getTodayNowAdd7().unix(),
      },
    });

    const { status_capacity_request_management } = useData;

    const bookingVersionLast = await this.prisma.booking_version.findFirst({
      where: {
        contract_code_id: Number(id),
      },
      orderBy: {
        id: 'desc',
      },
      take: 1,
    });

    await this.prisma.booking_version.update({
      where: {
        id: Number(bookingVersionLast?.id),
      },
      data: {
        status_capacity_request_management,
        submitted_timestamp: getTodayNowAdd7().toDate(),
        update_date: getTodayNowAdd7().toDate(),
        update_date_num: getTodayNowAdd7().unix(),
        update_by_account: {
          connect: {
            id: Number(userId),
          },
        },
      },
    });

    return resData;
  }


  async updateStatusCapacityRequestManagementCheck(
    id: any,
    payload: any,
    userId: any,
    req: any,
  ) {
    const {
      status_capacity_request_management_id,
      terminate_date,
      shadow_time,
      shadow_period,
      reject_reasons,
    } = payload;
    let useData: any = null;
    // console.log('id : ', id);
    // console.log('payload : ', payload);

    if (status_capacity_request_management_id === 2) {
      useData = {
        ...(status_capacity_request_management_id !== null && {
          status_capacity_request_management: {
            connect: {
              id: status_capacity_request_management_id,
            },
          },
        }),
        shadow_time: shadow_time,
        shadow_period: shadow_period,
        status_capacity_request_management_process: {
          connect: {
            id: 2,
          },
        },
      };
    } else if (status_capacity_request_management_id === 3) {
      useData = {
        ...(status_capacity_request_management_id !== null && {
          status_capacity_request_management: {
            connect: {
              id: status_capacity_request_management_id,
            },
          },
        }),
        reject_reasons: reject_reasons,
        status_capacity_request_management_process: {
          connect: {
            id: 5,
          },
        },
      };
    } else if (status_capacity_request_management_id === 5) {
      useData = {
        ...(status_capacity_request_management_id !== null && {
          status_capacity_request_management: {
            connect: {
              id: status_capacity_request_management_id,
            },
          },
        }),
        terminate_date: terminate_date ? getTodayNowAdd7(terminate_date).toDate() : null,
        status_capacity_request_management_process: {
          connect: {
            id: 4,
          },
        },
      };
    } else {
      useData = {
        ...(status_capacity_request_management_id !== null && {
          status_capacity_request_management: {
            connect: {
              id: status_capacity_request_management_id,
            },
          },
        }),
      };
    }

    // เพิ่ม shadow period
    if (
      status_capacity_request_management_id === 2 ||
      status_capacity_request_management_id === 4
    ) {
      const contractCodePeriod = await this.prisma.contract_code.findFirst({
        where: { id: Number(id) },
        select: { shadow_period: true },
      });

      const nowDates = getTodayNowAdd7().toDate();

      const pathManagement = await this.prisma.path_management.findFirst({
        where: {
          start_date: {
            lt: getTodayNowDDMMYYYYDfaultAdd7(nowDates).toDate() || null,
          },
        },
        include: {
          path_management_config: {
            include: {
              config_master_path: {
                include: {
                  revised_capacity_path: {
                    include: {
                      area: true,
                    },
                  },
                  revised_capacity_path_edges: true,
                },
              },
            },
          },
        },
        orderBy: {
          start_date: 'desc',
        },
      });
      // console.log('pathManagement : ', pathManagement); ///

      const groupPath = await this.groupPath();
      // console.log('groupPath : ', groupPath);

      pathManagement['path_management_config'] = pathManagement[
        'path_management_config'
      ].map((e: any) => {
        return { ...e, temps: this.safeParseJSON(e?.['temps']) };
      });

      const pathConfig = pathManagement['path_management_config'].map(
        (e: any) => {
          const findId = e?.temps?.revised_capacity_path?.find((f: any) => {
            return f?.area?.entry_exit_id === 1;
          });
          // const findExit = e?.temps?.revised_capacity_path?.filter((f: any) => {
          //   return f?.area?.entry_exit_id === 2;
          // });
          const findExit = e?.temps?.revised_capacity_path?.map((f: any) => {
            return f;
          });
          // console.log('findId : --- > ', findId);
          // console.log('findExit : --- > ', findExit);
          return {
            ...e,
            entryId: findId?.area?.id,
            entryName: findId?.area?.name,
            findExit,
          };
        },
      );
      // console.log('pathConfig : ', pathConfig);

      const getData = await this.prisma.booking_version.findFirst({
        where: {
          contract_code_id: Number(id),
        },
        include: {
          booking_row_json: true,
          booking_full_json: true,
        },
        orderBy: { id: 'desc' },
      });
      // console.log('getData : ', getData);
      const dataFull = this.safeParseJSON(getData?.['booking_full_json']?.[0]?.data_temp);
      const dataRow = getData['booking_row_json'];
      const entryUse = dataRow.filter((f: any) => {
        return f?.entry_exit_id === 1;
      });
      const exitUse = dataRow.filter((f: any) => {
        return f?.entry_exit_id === 2;
      });

      const entryData: any = [];
      const exitData: any = [];
      // console.log('exitUse : ', exitUse);

      for (let i = 0; i < entryUse.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: this.safeParseJSON(entryUse?.[i]?.data_temp)?.['0'] },
          include: {
            area: {
              select: {
                id: true,
                name: true,
                area_nominal_capacity: true,
              },
            },
            zone: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        if (
          !contractPoint?.contract_point ||
          !contractPoint?.zone?.name ||
          !contractPoint?.area?.name
        ) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match.',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          entryData.push({
            contract_point: contractPoint?.contract_point,
            entry_exit_id: 1,
            zone_id: contractPoint?.zone?.id,
            zone: contractPoint?.zone?.name,
            area_id: contractPoint?.area?.id,
            area: contractPoint?.area?.name,
            area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
            entryUse: entryUse[i],
          });
        }
      }
      for (let i = 0; i < exitUse.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: this.safeParseJSON(exitUse?.[i]?.data_temp)?.['0'] },
          include: {
            area: {
              select: {
                id: true,
                name: true,
                area_nominal_capacity: true,
              },
            },
            zone: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        if (
          !contractPoint?.contract_point ||
          !contractPoint?.zone?.name ||
          !contractPoint?.area?.name
        ) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match.',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          exitData.push({
            contract_point: contractPoint?.contract_point,
            entry_exit_id: contractPoint?.entry_exit_id,
            zone_id: contractPoint?.zone?.id,
            zone: contractPoint?.zone?.name,
            area_id: contractPoint?.area?.id,
            area: contractPoint?.area?.name,
            area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
            exitUse: exitUse[i],
          });
        }
      }
      const pathUsePoint: any = [];

      for (let i = 0; i < exitData.length; i++) {
        const findEx = pathConfig?.find((f: any) => {
          return f?.exit_name_temp === exitData[i]?.area;
        });
        // console.log('pathConfig : ', pathConfig);
        // console.log('exitData[i]?.area : ', exitData[i]?.area);
        // console.log('findEx : ', findEx);
        if (!findEx) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match. config path',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          // let entryOnce = findEx?.temps?.revised_capacity_path?.find(
          //   (f: any) => {
          //     return f?.area?.id === findEx?.entryId;
          //   },
          // );
          const entryOnce = findEx?.temps?.revised_capacity_path?.find(
            (f: any) => {
              return f?.area?.name === findEx?.entryName;
            },
          );
          // console.log('entryOnce : ', entryOnce);
          const paths: any = [];
          const pathsFull: any = [];
          const targetIdStart = findEx?.temps?.revised_capacity_path_edges.find(
            (fr: any) => {
              return fr?.source_id === entryOnce?.area?.id;
            },
          );
          // console.log('targetIdStart : ', targetIdStart);
          // console.log("*****************");

          if (!entryOnce?.area?.id || !targetIdStart?.target_id) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: `No path is found in this area.\nPlease configure area's path before approving.`,
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          paths.push({
            ...entryOnce,
            sourceId: entryOnce?.area?.id,
            targetId: targetIdStart?.target_id,
          });

          pathsFull.push({
            ...entryOnce,
            sourceId: entryOnce?.area?.id,
            targetId: targetIdStart?.target_id,
          });
          for (
            let irs = 0;
            irs < findEx?.temps?.revised_capacity_path_edges.length;
            irs++
          ) {
            const finds = findEx?.temps?.revised_capacity_path.find(
              (fp: any) => {
                return (
                  fp?.area?.id ===
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                );
              },
            );
            paths.push({
              ...finds,
              sourceId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
              targetId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
            });
            // if (finds?.area?.name === findEx?.exit_name_temp) {
            //   break;
            // }
          }

          for (
            let irs = 0;
            irs < findEx?.temps?.revised_capacity_path_edges.length;
            irs++
          ) {
            const finds = findEx?.temps?.revised_capacity_path.find(
              (fp: any) => {
                return (
                  fp?.area?.id ===
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                );
              },
            );
            pathsFull.push({
              ...finds,
              sourceId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
              targetId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
            });
          }

          pathUsePoint.push({
            ...findEx,
            dataBook: exitData[i],
            paths: paths,
            pathsFull: pathsFull,
          });
        }
      }
      // console.log('pathUsePoint : ', pathUsePoint);
      const tempType = dataFull?.shipperInfo['1']['Type of Contract'];
      const contractType =
        tempType === 'LONG'
          ? 1
          : tempType === 'MEDIUM'
            ? 2
            : tempType === 'SHORT_FIRM'
              ? 3
              : tempType === 'SHORT_NON_FIRM'
                ? 3
                : null;

      const todayStart = getTodayStartAdd7().toDate();
      const todayEnd = getTodayEndAdd7().toDate();

      const bookingTemplate = await this.prisma.booking_template.findFirst({
        where: {
          term_type_id: Number(contractType),
          start_date: {
            lte: todayEnd,
          },
          end_date: {
            gte: todayStart,
          },
        },
      });

      if (!bookingTemplate) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'booking template date not match',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const file_period_mode = bookingTemplate?.file_period_mode; // 1 = วัน, 2 = เดือน, 3 = ปี
      // ดึงเฉพาะวันที่
      const dailyBooking =
        dataFull['headerEntry']['Capacity Daily Booking (MMBTU/d)'];
      // ดึง keys เฉพาะวันที่ (ไม่รวม key ที่เป็นของตัว entry เอง)
      const keys = Object.keys(dailyBooking)
        .filter((date) => dailyBooking[date]?.key) // กรองเฉพาะที่เป็นวันที่และมี key
        .map((date) => ({
          key: Number(dailyBooking[date].key), // แปลง key เป็นตัวเลข
          date: date, // ใช้ date เป็นค่า
        }))
        .sort((a, b) => a.key - b.key); // เรียงลำดับตาม key

      const exitValue = dataFull?.exitValue;

      function generateValueExtend(keys, exitValue, file_period_mode) {
        const result = exitValue.map((values) => {
          // const endData = values['34']; // ค่าที่ต้องใช้ใน key สุดท้าย
          const endData = values['6']; // ค่าที่ต้องใช้ใน key สุดท้าย
          const data = keys.map((keyItem) => ({
            key: keyItem.key,
            date: keyItem.date,
            value: values[keyItem.key] || null, // แมตช์ค่า value ตาม key
          }));

          const valueExtend = [];
          for (let i = 0; i < data.length; i++) {
            const current = data[i];
            const next = data[i + 1] || { date: endData }; // ใช้ endData หากเป็น key สุดท้าย

            let startDate = dayjs(current.date, 'DD/MM/YYYY'); // แปลงวันที่จาก DD/MM/YYYY เป็น dayjs object
            let endDate = dayjs(next.date, 'DD/MM/YYYY');

            // Adjust endDate based on file_period_mode
            if (file_period_mode === 1 || file_period_mode === 2) {
              endDate = endDate.subtract(1, 'day'); // Exclude next key's date for days/months
            } else if (file_period_mode === 3 && !next.key) {
              endDate = dayjs(endData, 'DD/MM/YYYY'); // Handle year mode for last key
            }

            while (startDate.isBefore(endDate) || startDate.isSame(endDate)) {
              // Push each date into valueExtend
              valueExtend.push({
                date: startDate.format('YYYY-MM-DD'), // แปลงกลับเป็น YYYY-MM-DD
                value: current.value,
              });

              if (
                file_period_mode === 1 ||
                file_period_mode === 2 ||
                file_period_mode === 3
              ) {
                startDate = startDate.add(1, 'day'); // เพิ่มวันทีละ 1
              }
            }
          }

          return {
            contractPoint: values['0'],
            endData: endData,
            data: data,
            valueExtend: valueExtend,
          };
        });

        return result;
      }

      const resultNewDataExit = generateValueExtend(
        keys,
        exitValue,
        file_period_mode,
      );

      const matchData = pathUsePoint.map((ex: any, ix: any) => {
        return { ...ex, valueEx: resultNewDataExit[ix] };
      });
      console.log('matchData ++++=> : ', matchData);
      const newAreaCompare = matchData.map((cp: any) => {
        return {
          exit_name_temp: cp?.exit_name_temp,
          area: cp?.paths?.map((cpPath: any) => cpPath?.area?.name),
        };
      });

      const logWarning = [];
      const setDataUseZero = await Promise.all(
        matchData.map(async (sets: any) => {
          const pathAreaId = sets?.paths.map((setsF: any) => {
            return setsF?.area?.id;
          });
          const areaData = await this.prisma.area.findMany({
            where: {
              id: {
                in: pathAreaId,
              },
            },
            select: {
              id: true,
              name: true,
              area_nominal_capacity: true,
              entry_exit_id: true,
            },
          });

          const resCalcNew: any = [];
          for (let ical = 0; ical < areaData.length; ical++) {
            const calcNew: any = [];
            const fCapacityPublication =
              await this.prisma.capacity_publication.findFirst({
                where: {
                  area_id: Number(areaData[ical]?.id),
                },
                select: {
                  id: true,
                  capacity_publication_date: true,
                },
              });

            const resultPeriodAdd = this.extendDates(
              sets?.valueEx?.valueExtend,
              contractCodePeriod?.shadow_period,
            );

            for (let icalAr = 0; icalAr < resultPeriodAdd.length; icalAr++) {
              const isDateMatching = (targetDate, dbDate) => {
                return dbDate.find((entry) => {
                  return (
                    dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate
                  );
                });
              };
              const ckDateMatch =
                (!!fCapacityPublication &&
                  isDateMatching(
                    resultPeriodAdd[icalAr]?.date,
                    fCapacityPublication?.capacity_publication_date,
                  )) ||
                false;
              let mainCalc = null;
              let adjust = null;
              let adjustType = null;
              if (ckDateMatch) {
                if (ckDateMatch?.value_adjust_use) {
                  adjustType = 'value_adjust_use';
                  mainCalc = Number(ckDateMatch?.value_adjust_use);
                  adjust = Number(ckDateMatch?.value_adjust_use);
                } else if (ckDateMatch?.value_adjust) {
                  adjustType = 'value_adjust';
                  mainCalc = Number(ckDateMatch?.value_adjust);
                  adjust = Number(ckDateMatch?.value_adjust);
                } else if (ckDateMatch?.value) {
                  adjustType = 'value';
                  mainCalc = Number(ckDateMatch?.value);
                  adjust = Number(ckDateMatch?.value);
                } else {
                  adjustType = null;
                  mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                  adjust = Number(areaData[ical]?.area_nominal_capacity);
                }
              } else {
                adjustType = null;
                mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                adjust = null;
              }

              const cals = mainCalc - Number(resultPeriodAdd[icalAr]?.value);
              if (cals <= 0) {
                logWarning.push(
                  `${resultPeriodAdd[icalAr]?.date} | ${mainCalc} - ${resultPeriodAdd[icalAr]?.value} => calc 0 น้อยกว่า`,
                );
              }
              let ck_comparea = true;
              ck_comparea =
                icalAr === 0
                  ? true
                  : resultPeriodAdd[icalAr]?.value ===
                    resultPeriodAdd[icalAr - 1]?.value
                    ? true
                    : false;
              calcNew.push({
                ...resultPeriodAdd[icalAr],
                cals: cals,
                ck_comparea: ck_comparea,
                adjust: adjust,
                adjustType: adjustType,
              });
            }
            resCalcNew.push({
              area_nominal_capacity: Number(
                areaData[ical]?.area_nominal_capacity,
              ),
              area_id: Number(areaData[ical]?.id),
              area_name: areaData[ical]?.name,
              calcNew,
              entry_exit_id: areaData[ical]?.entry_exit_id,
              exitTemp: {
                id: sets?.exit_id_temp,
                name: sets?.exit_name_temp,
              },
            });
          }

          return { ...sets, resCalcNew: resCalcNew };
        }),
      );
      // setDataUse

      const setDataUse = setDataUseZero.map((sd: any) => {
        const findNotMe = setDataUseZero.filter((fm: any) => {
          return fm?.id != sd?.id;
        });
        const resCalcNewPala = sd['resCalcNew'].map((sdc: any) => {
          const calcNewFinal = sdc['calcNew'].map((dnw: any) => dnw);
          const tempFNM = [];
          findNotMe?.map((fnm: any) => {
            const findCalcNM = fnm['resCalcNew'].find((ffnm: any) => {
              return ffnm['area_name'] === sdc['area_name'];
            });
            if (findCalcNM) {
              tempFNM.push(findCalcNM);
            }
            return fnm;
          });
          for (let cFm = 0; cFm < calcNewFinal.length; cFm++) {
            for (let cFms = 0; cFms < tempFNM.length; cFms++) {
              const findCNF = tempFNM[cFms]?.['calcNew']?.find((fCmf: any) => {
                return fCmf?.date === calcNewFinal[cFm]?.date;
              });
              if (findCNF) {
                const calculatesValue =
                  Number(calcNewFinal[cFm]?.cals) - Number(findCNF?.value);
                calcNewFinal[cFm] = {
                  ...calcNewFinal[cFm],
                  cals: calculatesValue,
                };
              }
            }
          }
          return { ...sdc, calcNew: calcNewFinal };
        });

        return { ...sd, resCalcNew: resCalcNewPala };
      });
      // console.log('setDataUse : ', setDataUse);
      // return null

      if (logWarning.length > 0) {
        return { messageWarning: JSON.stringify(logWarning) };
      }
    }

    return true;
  }


  async extendCapacityRequestManagement(
    id: any,
    payload: any,
    userId: any,
    req: any,
  ) {
    const {
      shadow_time,
      shadow_period,
      contract_start_date,
      contract_end_date,
    } = payload;

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    const contractCode = await this.prisma.contract_code.findFirst({
      where: { id: Number(id) },
    });

    const jsonFull = await this.prisma.booking_full_json.findFirst({
      where: {
        booking_version: {
          contract_code_id: Number(id),
          flag_use: true,
        },
      },
    });
    if (jsonFull) jsonFull['data_temp'] = this.safeParseJSON(jsonFull?.['data_temp']);

    const jsonRow = await this.prisma.booking_row_json.findMany({
      where: {
        booking_version: {
          contract_code_id: Number(id),
          flag_use: true,
        },
      },
    });
    const jsonRowArr = jsonRow.map((e: any) => {
      return { ...e, data_temp: this.safeParseJSON(e?.['data_temp']) };
    });

    let resultDate = null;
    let startDate = contract_start_date;
    const endDateDate = contract_end_date;
    let flagAmd = false;
    let contract_code: any = null;

    const nowDate = getTodayNowAdd7().toDate();
    const hasContractStarted =
      dayjs(nowDate).isAfter(dayjs(contractCode?.contract_start_date)) ||
      dayjs(nowDate).isSame(dayjs(contractCode?.contract_start_date));

    if (
      contractCode?.status_capacity_request_management_id === 2 &&
      !hasContractStarted
    ) {
      console.log('--amd');
      // amd
      flagAmd = true;
      const checkContractCodeCheckLength =
        await this.prisma.contract_code.count({
          where: {
            ref_contract_code_by_main_id:
              contractCode?.ref_contract_code_by_main_id,
          },
        });
      const amdVersion =
        '_Amd' +
        String(
          checkContractCodeCheckLength > 9
            ? checkContractCodeCheckLength
            : '0' + checkContractCodeCheckLength,
        );
      let resultContractCode: any;
      if (contractCode?.contract_code.includes('_Amd')) {
        const match = contractCode?.contract_code.match(/(.*)(_Amd.*)/);
        resultContractCode = [match[1], match[2]];
      } else {
        resultContractCode = [contractCode?.contract_code];
      }

      const bookingTemplate = await this.prisma.booking_template.findFirst({
        where: {
          // file_period_mode: contractCode?.file_period_mode,
          term_type_id: contractCode?.term_type_id,
          start_date: {
            lte: todayEnd,
          },
          end_date: {
            gte: todayStart,
          },
        },
      });

      if (!bookingTemplate) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'booking template date not match',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      let checkMinMax = false;
      // shadow_pe
      checkMinMax = this.checkDateRange(
        contract_start_date,
        contract_end_date,
        bookingTemplate?.file_period_mode,
        bookingTemplate?.min,
        bookingTemplate?.max,
      );
      if (!checkMinMax) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Date is NOT match',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const createContractCodeAmd = await this.prisma.contract_code.create({
        data: {
          contract_code: contract_code,
          ...(!!contractCode?.term_type_id && {
            term_type: {
              connect: {
                id: contractCode?.term_type_id,
              },
            },
          }),
          ...(!!contractCode?.group_id && {
            group: {
              connect: {
                id: contractCode?.group_id,
              },
            },
          }),
          status_capacity_request_management_process: {
            connect: {
              id: 1,
            },
          },
          status_capacity_request_management: {
            connect: {
              id: 2,
            },
          },
          type_account: {
            connect: {
              id: contractCode?.type_account_id,
            },
          },
          ...(!!contractCode?.ref_contract_code_by_main_id && {
            ref_contract_code_by_main: {
              connect: {
                id: contractCode?.ref_contract_code_by_main_id,
              },
            },
          }),
          ...(!!contractCode?.id && {
            ref_contract_code_by: {
              connect: {
                id: contractCode?.id,
              },
            },
          }),
          shadow_period: shadow_period,
          shadow_time: shadow_time,
          file_period_mode: bookingTemplate?.file_period_mode,
          fixdayday: bookingTemplate?.fixdayday,
          todayday: bookingTemplate?.todayday,
          contract_start_date: contract_start_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_start_date).toDate()
            : null,
          contract_end_date: contract_end_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_end_date).toDate()
            : null,

          submitted_timestamp: getTodayNowAdd7().toDate(),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });

      await this.prisma.contract_code.update({
        where: {
          id: createContractCodeAmd?.id,
        },
        data: {
          ref_contract_code_by_main_id:
            contractCode?.ref_contract_code_by_main_id,
          ref_contract_code_by_id: contractCode?.id,
        },
      });

      await this.prisma.extend_contract_capacity_request_management.create({
        data: {
          shadow_time: contractCode?.shadow_time,
          shadow_period: contractCode?.shadow_period || 0,
          new_shadow_time: shadow_period,
          new_shadow_period: shadow_period,
          start_date: contract_start_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_start_date).toDate()
            : null,
          end_date: contract_end_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_end_date).toDate()
            : null,
          contract_code_id: createContractCodeAmd?.id,
          temp_submitted_timestamp: getTodayNowAdd7().toDate(),
          file_period_mode: contractCode?.file_period_mode,
        },
      });

      const headerEntry: any = {
        'Capacity Daily Booking (MMBTU/d)': null,
        'Maximum Hour Booking (MMBTU/h)': null,
        'Capacity Daily Booking (MMscfd)': null,
        'Maximum Hour Booking (MMscfh)': null,
      };
      const headerExit: any = {
        'Capacity Daily Booking (MMBTU/d)': null,
        'Maximum Hour Booking (MMBTU/h)': null,
      };

      const keySDate = Number(
        Object.values(
          jsonFull['data_temp']['headerEntry'][
          'Capacity Daily Booking (MMBTU/d)'
          ],
        ).reduce((min, current: any) => {
          return current.key < min ? current.key : min;
        }, Infinity),
      );
      const keyEDate = Number(
        Object.values(
          jsonFull['data_temp']['headerExit'][
          'Capacity Daily Booking (MMBTU/d)'
          ],
        ).reduce((min, current: any) => {
          return current.key < min ? current.key : min;
        }, Infinity),
      );

      if (bookingTemplate?.file_start_date_mode === 1) {
        resultDate = this.generateDailyArray(startDate, endDateDate);
      }

      if (bookingTemplate?.file_start_date_mode === 3) {
        startDate = dayjs(startDate, 'DD/MM/YYYY', true)
          .add(bookingTemplate?.todayday, 'day')
          .format('DD/MM/YYYY');
        resultDate = this.generateDailyArray(startDate, endDateDate);
      }

      if (bookingTemplate?.file_start_date_mode === 2) {
        startDate = this.adjustStartDate(startDate, bookingTemplate?.fixdayday);
        console.log('startDate : ', startDate);
        console.log('endDateDate : ', endDateDate);
        resultDate = this.generateMonthArray(
          startDate,
          endDateDate,
          bookingTemplate?.fixdayday,
        );
        console.log('resultDate : ', resultDate);
        console.log('keySDate : ', keySDate);
      }

      // เรียง key ตามวันที่และเพิ่ม entry
      headerEntry['Capacity Daily Booking (MMBTU/d)'] =
        this.generateDateKeyMapNew(resultDate, keySDate);
      // เพิ่ม key ที่เริ่มต้นจาก keySDate + ความต่าง
      headerEntry['Maximum Hour Booking (MMBTU/h)'] =
        this.generateDateKeyMapNew(resultDate, keySDate + resultDate.length);

      headerEntry['Capacity Daily Booking (MMscfd)'] =
        this.generateDateKeyMapNew(
          resultDate,
          keySDate + resultDate.length * 2,
        );

      headerEntry['Maximum Hour Booking (MMscfh)'] = this.generateDateKeyMapNew(
        resultDate,
        keySDate + resultDate.length * 3,
      );

      headerExit['Capacity Daily Booking (MMBTU/d)'] =
        this.generateDateKeyMapNew(resultDate, keySDate);
      // เพิ่ม key ที่เริ่มต้นจาก keySDate + ความต่าง
      headerExit['Maximum Hour Booking (MMBTU/h)'] = this.generateDateKeyMapNew(
        resultDate,
        keySDate + resultDate.length,
      );

      const newVEntry = await this.transformToKeyArrayHValue(headerEntry);
      const newVExit = await this.transformToKeyArrayHValue(headerExit);

      const filteredDataEntry = jsonFull['data_temp']['entryValue'].map(
        (entry: any) => {
          // ใช้ Object.entries เพื่อแปลง entry เป็น key-value pairs
          const rowOld = Object.fromEntries(
            Object.entries(entry).filter(
              ([key]) => Number(key) < Number(keySDate),
            ),
          );
          const rowValueOld = Object.fromEntries(
            Object.entries(entry).filter(
              ([key]) => Number(key) >= Number(keySDate),
            ),
          );
          const valueNew = this.mapKeyOldWithClosestValue(
            newVEntry,
            jsonFull['data_temp']['headerEntry'],
            rowValueOld,
          );
          // rowOld['34'] = contract_end_date;
          rowOld['6'] = contract_end_date;
          return { ...rowOld, ...valueNew };
        },
      );

      const filteredDataExit = jsonFull['data_temp']['exitValue'].map(
        (exit: any) => {
          const rowOld = Object.fromEntries(
            Object.entries(exit).filter(
              ([key]) => Number(key) < Number(keyEDate),
            ),
          );
          const rowValueOld = Object.fromEntries(
            Object.entries(exit).filter(
              ([key]) => Number(key) >= Number(keyEDate),
            ),
          );
          const valueNew = this.mapKeyOldWithClosestValue(
            newVExit,
            jsonFull['data_temp']['headerExit'],
            rowValueOld,
          );
          // rowOld['34'] = contract_end_date;
          rowOld['6'] = contract_end_date;
          return { ...rowOld, ...valueNew };
        },
      );
      const data_temp: any = {
        headerEntry: null,
        headerExit: null,
        entryValue: null,
        exitValue: null,
        sumEntries: null,
        sumExits: null,
      };

      data_temp['shipperInfo'] = jsonFull['data_temp']['shipperInfo'];
      data_temp['headerEntry'] = headerEntry;
      data_temp['headerExit'] = headerExit;
      data_temp['entryValue'] = filteredDataEntry;
      data_temp['exitValue'] = filteredDataExit;
      const sumEntries = this.sumKeys(filteredDataEntry, Number(keySDate));

      const sumEntsumExitsries = this.sumKeys(
        filteredDataExit,
        Number(keyEDate),
      );

      data_temp['sumEntries'] = { '0': 'Sum Entry', ...sumEntries };
      data_temp['sumExits'] = { '0': 'Sum Exit', ...sumEntsumExitsries };

      const newEntry = data_temp['entryValue'];
      const newExit = data_temp['exitValue'];

      await this.prisma.booking_version.updateMany({
        where: {
          contract_code_id: createContractCodeAmd?.id,
        },
        data: {
          flag_use: false,
        },
      });

      const checkContractCodeCheckLength1 =
        await this.prisma.booking_version.count({
          where: {
            contract_code_id: createContractCodeAmd?.id,
          },
        });

      const versId = await this.prisma.booking_version.create({
        data: {
          version: `v.${checkContractCodeCheckLength1 + 1}`,
          ...(!!createContractCodeAmd?.id && {
            contract_code: {
              connect: {
                id: createContractCodeAmd?.id,
              },
            },
          }),
          flag_use: true,
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
          submitted_timestamp: getTodayNowAdd7().toDate(),
          type_account: {
            connect: {
              id: 1,
            },
          },
          status_capacity_request_management: {
            connect: {
              id: 2,
            },
          },
        },
      });

      await this.prisma.booking_full_json.create({
        data: {
          ...(!!versId?.id && {
            // new create ..
            booking_version: {
              connect: {
                id: versId?.id,
              },
            },
          }),
          data_temp: JSON.stringify(data_temp),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });

      const mapDataRowJson = [];
      for (let i = 0; i < newEntry.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: newExit[i]['0'] },
          select: {
            area: { select: { name: true } },
            zone: { select: { name: true } },
          },
        });
        mapDataRowJson.push({
          booking_version_id: versId?.id,
          entry_exit_id: 1,

          zone_text: contractPoint?.zone?.name,
          area_text: contractPoint?.area?.name,
          contract_point: newExit[i]['0'],
          flag_use: true,
          data_temp: JSON.stringify(newExit[i]),
          create_by: Number(userId),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }
      for (let i = 0; i < newExit.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: newExit[i]['0'] },
          select: {
            area: { select: { name: true } },
            zone: { select: { name: true } },
          },
        });
        mapDataRowJson.push({
          booking_version_id: versId?.id,
          entry_exit_id: 2,

          zone_text: contractPoint?.zone?.name,
          area_text: contractPoint?.area?.name,
          contract_point: newExit[i]['0'],
          flag_use: true,
          data_temp: JSON.stringify(newExit[i]),
          create_date: getTodayNowAdd7().toDate(),
          create_by: Number(userId),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }

      await this.prisma.booking_row_json.createMany({
        data: mapDataRowJson,
      });

      // -------

      const terminateDate = dayjs(nowDate).format('YYYY-MM-DD');
      console.log('terminateDate : ', terminateDate);

      // terminate
      await this.prisma.contract_code.updateMany({
        where: {
          id: Number(id),
        },
        data: {
          status_capacity_request_management_id: 5,
          terminate_date: terminateDate ? getTodayNowAdd7(terminateDate).toDate() : null,
        },
      });

      console.log('terminate');

      const contractCodePeriod = await this.prisma.contract_code.findFirst({
        where: { id: Number(id) },
        select: { shadow_period: true },
      });

      const nowDatesT = getTodayNowAdd7().toDate();

      const pathManagementT = await this.prisma.path_management.findFirst({
        where: {
          start_date: {
            lt: getTodayNowDDMMYYYYDfaultAdd7(nowDatesT).toDate() || null,
          },
        },
        include: {
          path_management_config: {
            include: {
              config_master_path: {
                include: {
                  revised_capacity_path: {
                    include: {
                      area: true,
                    },
                  },
                  revised_capacity_path_edges: true,
                },
              },
            },
          },
        },
        orderBy: {
          start_date: 'desc',
        },
      });

      pathManagementT['path_management_config'] = pathManagementT[
        'path_management_config'
      ].map((e: any) => {
        return { ...e, temps: this.safeParseJSON(e?.['temps']) };
      });

      const pathConfigT = pathManagementT['path_management_config'].map(
        (e: any) => {
          const findId = e?.temps?.revised_capacity_path?.find((f: any) => {
            return f?.area?.entry_exit_id === 1;
          });
          const findExit = e?.temps?.revised_capacity_path?.filter((f: any) => {
            return f?.area?.entry_exit_id === 2;
          });

          return {
            ...e,
            entryId: findId?.area?.id,
            entryName: findId?.area?.name,
            findExit,
          };
        },
      );

      const getDataT = await this.prisma.booking_version.findFirst({
        where: {
          contract_code_id: Number(id),
        },
        include: {
          booking_row_json: true,
          booking_full_json: true,
        },
        orderBy: { id: 'desc' },
      });
      const dataFullT = this.safeParseJSON(getDataT?.['booking_full_json']?.[0]?.data_temp);
      const dataRowT = getDataT['booking_row_json'];
      const entryUseT = dataRowT.filter((f: any) => {
        return f?.entry_exit_id === 1;
      });
      const exitUseT = dataRowT.filter((f: any) => {
        return f?.entry_exit_id === 2;
      });
      const entryDataT: any = [];
      const exitDataT: any = [];
      for (let i = 0; i < entryUseT.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: this.safeParseJSON(entryUseT?.[i]?.data_temp)?.['0'] },
          include: {
            area: {
              select: {
                id: true,
                name: true,
                area_nominal_capacity: true,
              },
            },
            zone: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        if (
          !contractPoint?.contract_point ||
          !contractPoint?.zone?.name ||
          !contractPoint?.area?.name
        ) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match.',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          entryDataT.push({
            contract_point: contractPoint?.contract_point,
            entry_exit_id: 1,
            zone_id: contractPoint?.zone?.id,
            zone: contractPoint?.zone?.name,
            area_id: contractPoint?.area?.id,
            area: contractPoint?.area?.name,
            area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
            entryUse: entryUseT[i],
          });
        }
      }
      for (let i = 0; i < exitUseT.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: this.safeParseJSON(exitUseT?.[i]?.data_temp)?.['0'] },
          include: {
            area: {
              select: {
                id: true,
                name: true,
                area_nominal_capacity: true,
              },
            },
            zone: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        if (
          !contractPoint?.contract_point ||
          !contractPoint?.zone?.name ||
          !contractPoint?.area?.name
        ) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match.',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          exitDataT.push({
            contract_point: contractPoint?.contract_point,
            entry_exit_id: contractPoint?.entry_exit_id,
            zone_id: contractPoint?.zone?.id,
            zone: contractPoint?.zone?.name,
            area_id: contractPoint?.area?.id,
            area: contractPoint?.area?.name,
            area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
            exitUse: exitUseT[i],
          });
        }
      }

      const pathUsePointT: any = [];
      for (let i = 0; i < exitDataT.length; i++) {
        const findEx = pathConfigT?.find((f: any) => {
          return f?.exit_name_temp === exitDataT[i]?.area;
        });
        if (!findEx) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match. config path',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          const entryOnce = findEx?.temps?.revised_capacity_path?.find(
            (f: any) => {
              return f?.area?.name === findEx?.exit_name_temp;
            },
          );
          // let entryOnce = findEx?.temps?.revised_capacity_path?.find(
          //   (f: any) => {
          //     return f?.area?.id === findEx?.entryId;
          //   },
          // );
          const paths: any = [];
          const pathsFull: any = [];
          const targetIdStart = findEx?.temps?.revised_capacity_path_edges.find(
            (fr: any) => {
              return fr?.source_id === entryOnce?.area?.id;
            },
          );
          paths.push({
            ...entryOnce,
            sourceId: entryOnce?.area?.id,
            targetId: targetIdStart?.target_id,
          });
          pathsFull.push({
            ...entryOnce,
            sourceId: entryOnce?.area?.id,
            targetId: targetIdStart?.target_id,
          });
          for (
            let irs = 0;
            irs < findEx?.temps?.revised_capacity_path_edges.length;
            irs++
          ) {
            const finds = findEx?.temps?.revised_capacity_path.find(
              (fp: any) => {
                return (
                  fp?.area?.id ===
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                );
              },
            );
            paths.push({
              ...finds,
              sourceId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
              targetId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
            });
            if (finds?.area?.name === findEx?.exit_name_temp) {
              break;
            }
          }
          for (
            let irs = 0;
            irs < findEx?.temps?.revised_capacity_path_edges.length;
            irs++
          ) {
            const finds = findEx?.temps?.revised_capacity_path.find(
              (fp: any) => {
                return (
                  fp?.area?.id ===
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                );
              },
            );
            pathsFull.push({
              ...finds,
              sourceId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
              targetId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
            });
          }

          pathUsePointT.push({
            ...findEx,
            dataBook: exitDataT[i],
            paths: paths,
            pathsFull: pathsFull,
          });
        }
      }

      const tempTypeT = dataFullT?.shipperInfo['1']['Type of Contract'];
      const contractTypeT =
        tempTypeT === 'LONG'
          ? 1
          : tempTypeT === 'MEDIUM'
            ? 2
            : tempTypeT === 'SHORT_FIRM'
              ? 3
              : tempTypeT === 'SHORT_NON_FIRM'
                ? 3
                : null;

      const bookingTemplateT = await this.prisma.booking_template.findFirst({
        where: {
          term_type_id: Number(contractTypeT),
          start_date: {
            lte: todayEnd,
          },
          end_date: {
            gte: todayStart,
          },
        },
      });

      if (!bookingTemplateT) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'booking template date not match',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      const file_period_modeT = bookingTemplateT?.file_period_mode; // 1 = วัน, 2 = เดือน, 3 = ปี
      // ดึงเฉพาะวันที่
      const dailyBookingT =
        dataFullT['headerEntry']['Capacity Daily Booking (MMBTU/d)'];
      // ดึง keys เฉพาะวันที่ (ไม่รวม key ที่เป็นของตัว entry เอง)
      const keysT = Object.keys(dailyBookingT)
        .filter((date) => dailyBookingT[date]?.key) // กรองเฉพาะที่เป็นวันที่และมี key
        .map((date) => ({
          key: Number(dailyBookingT[date].key), // แปลง key เป็นตัวเลข
          date: date, // ใช้ date เป็นค่า
        }))
        .sort((a, b) => a.key - b.key); // เรียงลำดับตาม key

      const exitValueT = dataFullT?.exitValue;
      function generateValueExtendT(keys, exitValue, file_period_mode) {
        const result = exitValue.map((values) => {
          // const endData = values['34']; // ค่าที่ต้องใช้ใน key สุดท้าย
          const endData = values['6']; // ค่าที่ต้องใช้ใน key สุดท้าย
          const data = keys.map((keyItem) => ({
            key: keyItem.key,
            date: keyItem.date,
            value: values[keyItem.key] || null, // แมตช์ค่า value ตาม key
          }));

          const valueExtend = [];
          for (let i = 0; i < data.length; i++) {
            const current = data[i];
            const next = data[i + 1] || { date: endData }; // ใช้ endData หากเป็น key สุดท้าย

            let startDate = dayjs(current.date, 'DD/MM/YYYY'); // แปลงวันที่จาก DD/MM/YYYY เป็น dayjs object
            let endDate = dayjs(next.date, 'DD/MM/YYYY');

            // Adjust endDate based on file_period_mode
            if (file_period_mode === 1 || file_period_mode === 2) {
              endDate = endDate.subtract(1, 'day'); // Exclude next key's date for days/months
            } else if (file_period_mode === 3 && !next.key) {
              endDate = dayjs(endData, 'DD/MM/YYYY'); // Handle year mode for last key
            }

            while (startDate.isBefore(endDate) || startDate.isSame(endDate)) {
              // Push each date into valueExtend
              valueExtend.push({
                date: startDate.format('YYYY-MM-DD'), // แปลงกลับเป็น YYYY-MM-DD
                value: current.value,
              });

              if (
                file_period_mode === 1 ||
                file_period_mode === 2 ||
                file_period_mode === 3
              ) {
                startDate = startDate.add(1, 'day'); // เพิ่มวันทีละ 1
              }
            }
          }

          return {
            contractPoint: values['0'],
            endData: endData,
            data: data,
            valueExtend: valueExtend,
          };
        });

        return result;
      }

      const resultNewDataExitT = generateValueExtendT(
        keysT,
        exitValueT,
        file_period_modeT,
      );

      const matchDataT = pathUsePointT.map((ex: any, ix: any) => {
        return { ...ex, valueEx: resultNewDataExitT[ix] };
      });
      const setDataUseT = await Promise.all(
        matchDataT.map(async (sets: any) => {
          const pathAreaId = sets?.paths.map((setsF: any) => {
            return setsF?.area?.id;
          });
          const areaData = await this.prisma.area.findMany({
            where: {
              id: {
                in: pathAreaId,
              },
            },
            select: {
              id: true,
              name: true,
              area_nominal_capacity: true,
              entry_exit_id: true,
            },
          });

          const resCalcNewT: any = [];
          for (let ical = 0; ical < areaData.length; ical++) {
            const calcNew: any = [];
            const fCapacityPublication =
              await this.prisma.capacity_publication.findFirst({
                where: {
                  area_id: Number(areaData[ical]?.id),
                },
                select: {
                  id: true,
                  capacity_publication_date: true,
                },
              });

            const resultPeriodAdd = this.extendDates(
              sets?.valueEx?.valueExtend,
              contractCodePeriod?.shadow_period || 0,
            );

            for (let icalAr = 0; icalAr < resultPeriodAdd.length; icalAr++) {
              const isDateMatching = (targetDate, dbDate) => {
                return dbDate.find((entry) => {
                  return (
                    dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate
                  );
                });
              };
              // เรียกใช้งาน
              const ckDateMatch =
                (!!fCapacityPublication &&
                  isDateMatching(
                    resultPeriodAdd[icalAr]?.date,
                    fCapacityPublication?.capacity_publication_date,
                  )) ||
                false;
              let mainCalc = null;
              let adjust = null;
              let adjustType = null;
              if (ckDateMatch) {
                if (ckDateMatch?.value_adjust_use) {
                  adjustType = 'value_adjust_use';
                  mainCalc = Number(ckDateMatch?.value_adjust_use);
                  adjust = Number(ckDateMatch?.value_adjust_use);
                } else if (ckDateMatch?.value_adjust) {
                  adjustType = 'value_adjust';
                  mainCalc = Number(ckDateMatch?.value_adjust);
                  adjust = Number(ckDateMatch?.value_adjust);
                } else if (ckDateMatch?.value) {
                  adjustType = 'value';
                  mainCalc = Number(ckDateMatch?.value);
                  adjust = null;
                } else {
                  adjustType = null;
                  mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                  adjust = null;
                }
              } else {
                adjustType = null;
                mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                adjust = null;
              }

              const cals = Number(resultPeriodAdd[icalAr]?.value) + mainCalc;

              let ck_comparea = true;
              ck_comparea =
                icalAr === 0
                  ? true
                  : resultPeriodAdd[icalAr]?.value ===
                    resultPeriodAdd[icalAr - 1]?.value
                    ? true
                    : false;
              calcNew.push({
                ...resultPeriodAdd[icalAr],
                cals: cals,
                ck_comparea: ck_comparea,
                adjust: adjust,
                adjustType: adjustType,
              });
            }
            resCalcNewT.push({
              area_nominal_capacity: Number(
                areaData[ical]?.area_nominal_capacity,
              ),
              area_id: Number(areaData[ical]?.id),
              calcNew,
              entry_exit_id: areaData[ical]?.entry_exit_id,
            });
          }

          for (let fCp = 0; fCp < resCalcNewT.length; fCp++) {
            const fCapacityPublication =
              await this.prisma.capacity_publication.findFirst({
                where: {
                  area_id: Number(resCalcNewT[fCp]?.area_id),
                },
                select: {
                  id: true,
                  capacity_publication_date: true,
                  area: true,
                },
              });
            if (fCapacityPublication) {
              const updates = []; // อาร์เรย์เก็บข้อมูลการอัปเดต
              for (
                let iCpD = 0;
                iCpD < resCalcNewT[fCp]?.calcNew?.length;
                iCpD++
              ) {
                const isDateMatching = (targetDate, dbDate) => {
                  return dbDate.find((entry) => {
                    return (
                      dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate
                    );
                  });
                };
                // // เรียกใช้งาน
                const ckDateMatch = isDateMatching(
                  resCalcNewT[fCp]?.calcNew[iCpD]?.date,
                  fCapacityPublication?.capacity_publication_date,
                );

                if (
                  dayjs(ckDateMatch?.date_day).isSameOrAfter(
                    dayjs(terminateDate),
                  )
                ) {
                  let updateData = {};

                  if (ckDateMatch?.value_adjust_use) {
                    updateData = {
                      value_adjust_use: String(
                        resCalcNewT[fCp]?.calcNew[iCpD]?.cals,
                      ),
                    };
                  } else if (ckDateMatch?.value_adjust) {
                    updateData = {
                      value_adjust_use: String(
                        resCalcNewT[fCp]?.calcNew[iCpD]?.cals,
                      ),
                    };
                  } else if (ckDateMatch?.value) {
                    updateData = {
                      value: String(resCalcNewT[fCp]?.calcNew[iCpD]?.cals),
                    };
                  } else {
                    updateData = {
                      value: String(resCalcNewT[fCp]?.calcNew[iCpD]?.cals),
                    };
                  }
                  updates.push({
                    where: { id: Number(ckDateMatch?.id) },
                    data: updateData,
                  });
                }
              }

              if (updates.length > 0) {
                await this.prisma.$transaction(
                  updates.map((update) =>
                    this.prisma.capacity_publication_date.update(update),
                  ),
                );
              }
            }
          }

          return { ...sets, resCalcNew: resCalcNewT };
        }),
      );

      const contractCodePeriodA = await this.prisma.contract_code.findFirst({
        where: { id: Number(createContractCodeAmd?.id) },
        select: { shadow_period: true },
      });

      const nowDates = getTodayNowAdd7().toDate();

      const pathManagement = await this.prisma.path_management.findFirst({
        where: {
          start_date: {
            lt: getTodayNowDDMMYYYYDfaultAdd7(nowDates).toDate() || null,
          },
        },
        include: {
          path_management_config: {
            include: {
              config_master_path: {
                include: {
                  revised_capacity_path: {
                    include: {
                      area: true,
                    },
                  },
                  revised_capacity_path_edges: true,
                },
              },
            },
          },
        },
        orderBy: {
          start_date: 'desc',
        },
      });

      pathManagement['path_management_config'] = pathManagement[
        'path_management_config'
      ].map((e: any) => {
        return { ...e, temps: this.safeParseJSON(e?.['temps']) };
      });

      const pathConfig = pathManagement['path_management_config'].map(
        (e: any) => {
          const findId = e?.temps?.revised_capacity_path?.find((f: any) => {
            return f?.area?.entry_exit_id === 1;
          });
          const findExit = e?.temps?.revised_capacity_path?.filter((f: any) => {
            return f?.area?.entry_exit_id === 2;
          });

          return {
            ...e,
            entryId: findId?.area?.id,
            entryName: findId?.area?.name,
            findExit,
          };
        },
      );

      const getData = await this.prisma.booking_version.findFirst({
        where: {
          contract_code_id: Number(createContractCodeAmd?.id),
        },
        include: {
          booking_row_json: true,
          booking_full_json: true,
        },
        orderBy: { id: 'desc' },
      });
      const dataFull = this.safeParseJSON(getData?.['booking_full_json']?.[0]?.data_temp);
      const dataRow = getData['booking_row_json'];
      const entryUse = dataRow.filter((f: any) => {
        return f?.entry_exit_id === 1;
      });
      const exitUse = dataRow.filter((f: any) => {
        return f?.entry_exit_id === 2;
      });

      const entryData: any = [];
      const exitData: any = [];

      for (let i = 0; i < entryUse.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: this.safeParseJSON(entryUse?.[i]?.data_temp)?.['0'] },
          include: {
            area: {
              select: {
                id: true,
                name: true,
                area_nominal_capacity: true,
              },
            },
            zone: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        if (
          !contractPoint?.contract_point ||
          !contractPoint?.zone?.name ||
          !contractPoint?.area?.name
        ) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match.',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          entryData.push({
            contract_point: contractPoint?.contract_point,
            entry_exit_id: 1,
            zone_id: contractPoint?.zone?.id,
            zone: contractPoint?.zone?.name,
            area_id: contractPoint?.area?.id,
            area: contractPoint?.area?.name,
            area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
            entryUse: entryUse[i],
          });
        }
      }
      for (let i = 0; i < exitUse.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: this.safeParseJSON(exitUse?.[i]?.data_temp)?.['0'] },
          include: {
            area: {
              select: {
                id: true,
                name: true,
                area_nominal_capacity: true,
              },
            },
            zone: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        if (
          !contractPoint?.contract_point ||
          !contractPoint?.zone?.name ||
          !contractPoint?.area?.name
        ) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match.',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          exitData.push({
            contract_point: contractPoint?.contract_point,
            entry_exit_id: contractPoint?.entry_exit_id,
            zone_id: contractPoint?.zone?.id,
            zone: contractPoint?.zone?.name,
            area_id: contractPoint?.area?.id,
            area: contractPoint?.area?.name,
            area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
            exitUse: exitUse[i],
          });
        }
      }
      // console.log('exitData : ', exitData);
      const pathUsePoint: any = [];
      for (let i = 0; i < exitData.length; i++) {
        const findEx = pathConfig?.find((f: any) => {
          return f?.exit_name_temp === exitData[i]?.area;
        });
        if (!findEx) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match. config path',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          const entryOnce = findEx?.temps?.revised_capacity_path?.find(
            (f: any) => {
              return f?.area?.name === findEx?.exit_name_temp;
            },
          );
          // let entryOnce = findEx?.temps?.revised_capacity_path?.find(
          //   (f: any) => {
          //     return f?.area?.id === findEx?.entryId;
          //   },
          // );
          const paths: any = [];
          const pathsFull: any = [];
          const targetIdStart = findEx?.temps?.revised_capacity_path_edges.find(
            (fr: any) => {
              return fr?.source_id === entryOnce?.area?.id;
            },
          );
          paths.push({
            ...entryOnce,
            sourceId: entryOnce?.area?.id,
            targetId: targetIdStart?.target_id,
          });
          pathsFull.push({
            ...entryOnce,
            sourceId: entryOnce?.area?.id,
            targetId: targetIdStart?.target_id,
          });
          for (
            let irs = 0;
            irs < findEx?.temps?.revised_capacity_path_edges.length;
            irs++
          ) {
            const finds = findEx?.temps?.revised_capacity_path.find(
              (fp: any) => {
                return (
                  fp?.area?.id ===
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                );
              },
            );
            paths.push({
              ...finds,
              sourceId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
              targetId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
            });
            if (finds?.area?.name === findEx?.exit_name_temp) {
              break;
            }
          }
          for (
            let irs = 0;
            irs < findEx?.temps?.revised_capacity_path_edges.length;
            irs++
          ) {
            const finds = findEx?.temps?.revised_capacity_path.find(
              (fp: any) => {
                return (
                  fp?.area?.id ===
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                );
              },
            );
            pathsFull.push({
              ...finds,
              sourceId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
              targetId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
            });
          }

          pathUsePoint.push({
            ...findEx,
            dataBook: exitData[i],
            paths: paths,
            pathsFull: pathsFull,
          });
        }
      }

      const tempType = dataFull?.shipperInfo['1']['Type of Contract'];
      const contractType =
        tempType === 'LONG'
          ? 1
          : tempType === 'MEDIUM'
            ? 2
            : tempType === 'SHORT_FIRM'
              ? 3
              : tempType === 'SHORT_NON_FIRM'
                ? 3
                : null;

      const bookingTemplateA = await this.prisma.booking_template.findFirst({
        where: {
          term_type_id: Number(contractType),
          start_date: {
            lte: todayEnd,
          },
          end_date: {
            gte: todayStart,
          },
        },
      });

      if (!bookingTemplateA) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'booking template date not match',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const file_period_mode = bookingTemplateA?.file_period_mode; // 1 = วัน, 2 = เดือน, 3 = ปี
      // ดึงเฉพาะวันที่
      const dailyBooking =
        dataFull['headerEntry']['Capacity Daily Booking (MMBTU/d)'];
      // ดึง keys เฉพาะวันที่ (ไม่รวม key ที่เป็นของตัว entry เอง)
      const keys = Object.keys(dailyBooking)
        .filter((date) => dailyBooking[date]?.key) // กรองเฉพาะที่เป็นวันที่และมี key
        .map((date) => ({
          key: Number(dailyBooking[date].key), // แปลง key เป็นตัวเลข
          date: date, // ใช้ date เป็นค่า
        }))
        .sort((a, b) => a.key - b.key); // เรียงลำดับตาม key

      const exitValue = dataFull?.exitValue;

      function generateValueExtend(keys, exitValue, file_period_mode) {
        const result = exitValue.map((values) => {
          // const endData = values['34']; // ค่าที่ต้องใช้ใน key สุดท้าย
          const endData = values['6']; // ค่าที่ต้องใช้ใน key สุดท้าย
          const data = keys.map((keyItem) => ({
            key: keyItem.key,
            date: keyItem.date,
            value: values[keyItem.key] || null, // แมตช์ค่า value ตาม key
          }));

          const valueExtend = [];
          for (let i = 0; i < data.length; i++) {
            const current = data[i];
            const next = data[i + 1] || { date: endData }; // ใช้ endData หากเป็น key สุดท้าย

            let startDate = dayjs(current.date, 'DD/MM/YYYY'); // แปลงวันที่จาก DD/MM/YYYY เป็น dayjs object
            let endDate = dayjs(next.date, 'DD/MM/YYYY');

            // Adjust endDate based on file_period_mode
            if (file_period_mode === 1 || file_period_mode === 2) {
              endDate = endDate.subtract(1, 'day'); // Exclude next key's date for days/months
            } else if (file_period_mode === 3 && !next.key) {
              endDate = dayjs(endData, 'DD/MM/YYYY'); // Handle year mode for last key
            }

            while (startDate.isBefore(endDate) || startDate.isSame(endDate)) {
              // Push each date into valueExtend
              valueExtend.push({
                date: startDate.format('YYYY-MM-DD'), // แปลงกลับเป็น YYYY-MM-DD
                value: current.value,
              });

              if (
                file_period_mode === 1 ||
                file_period_mode === 2 ||
                file_period_mode === 3
              ) {
                startDate = startDate.add(1, 'day'); // เพิ่มวันทีละ 1
              }
            }
          }

          return {
            contractPoint: values['0'],
            endData: endData,
            data: data,
            valueExtend: valueExtend,
          };
        });

        return result;
      }

      const resultNewDataExit = generateValueExtend(
        keys,
        exitValue,
        file_period_mode,
      );

      const matchData = pathUsePoint.map((ex: any, ix: any) => {
        return { ...ex, valueEx: resultNewDataExit[ix] };
      });

      const logWarning = [];
      const setDataUse = await Promise.all(
        matchData.map(async (sets: any) => {
          const pathAreaId = sets?.paths.map((setsF: any) => {
            return setsF?.area?.id;
          });
          const areaData = await this.prisma.area.findMany({
            where: {
              id: {
                in: pathAreaId,
              },
            },
            select: {
              id: true,
              name: true,
              area_nominal_capacity: true,
              entry_exit_id: true,
            },
          });

          const resCalcNew: any = [];
          for (let ical = 0; ical < areaData.length; ical++) {
            const calcNew: any = [];
            const fCapacityPublication =
              await this.prisma.capacity_publication.findFirst({
                where: {
                  area_id: Number(areaData[ical]?.id),
                },
                select: {
                  id: true,
                  capacity_publication_date: true,
                },
              });

            const resultPeriodAddA = this.extendDates(
              sets?.valueEx?.valueExtend,
              contractCodePeriodA?.shadow_period || 0,
            );

            for (let icalAr = 0; icalAr < resultPeriodAddA.length; icalAr++) {
              const isDateMatching = (targetDate, dbDate) => {
                return dbDate.find((entry) => {
                  return (
                    dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate
                  );
                });
              };
              // เรียกใช้งาน
              const ckDateMatch =
                (!!fCapacityPublication &&
                  isDateMatching(
                    resultPeriodAddA[icalAr]?.date,
                    fCapacityPublication?.capacity_publication_date,
                  )) ||
                false;
              let mainCalc = null;
              let adjust = null;
              let adjustType = null;
              if (ckDateMatch) {
                if (ckDateMatch?.value_adjust_use) {
                  adjustType = 'value_adjust_use';
                  mainCalc = Number(ckDateMatch?.value_adjust_use);
                  adjust = Number(ckDateMatch?.value_adjust_use);
                } else if (ckDateMatch?.value_adjust) {
                  adjustType = 'value_adjust';
                  mainCalc = Number(ckDateMatch?.value_adjust);
                  adjust = Number(ckDateMatch?.value_adjust);
                } else if (ckDateMatch?.value) {
                  adjustType = 'value';
                  mainCalc = Number(ckDateMatch?.value);
                  adjust = Number(ckDateMatch?.value);
                } else {
                  adjustType = null;
                  mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                  adjust = Number(areaData[ical]?.area_nominal_capacity);
                }
              } else {
                adjustType = null;
                mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                adjust = null;
              }

              // -----
              const cals = mainCalc - Number(resultPeriodAddA[icalAr]?.value);
              if (cals <= 0) {
                logWarning.push(
                  `${resultPeriodAddA[icalAr]?.date} | ${mainCalc} - ${resultPeriodAddA[icalAr]?.value} => calc 0 น้อยกว่า`,
                );
              }
              let ck_comparea = true;
              ck_comparea =
                icalAr === 0
                  ? true
                  : resultPeriodAddA[icalAr]?.value ===
                    resultPeriodAddA[icalAr - 1]?.value
                    ? true
                    : false;
              calcNew.push({
                ...resultPeriodAddA[icalAr],
                cals: cals,
                ck_comparea: ck_comparea,
                adjust: adjust,
                adjustType: adjustType,
              });
            }
            resCalcNew.push({
              area_nominal_capacity: Number(
                areaData[ical]?.area_nominal_capacity,
              ),
              area_id: Number(areaData[ical]?.id),
              calcNew,
              entry_exit_id: areaData[ical]?.entry_exit_id,
            });
          }

          for (let fCp = 0; fCp < resCalcNew.length; fCp++) {
            const fCapacityPublication =
              await this.prisma.capacity_publication.findFirst({
                where: {
                  area_id: Number(resCalcNew[fCp]?.area_id),
                },
                select: {
                  id: true,
                  capacity_publication_date: true,
                  area: true,
                },
              });

            // approved update calc book
            if (fCapacityPublication) {
              // มี
              const icpdData = [];
              const updates = []; // อาร์เรย์เก็บข้อมูลการอัปเดต
              for (
                let iCpD = 0;
                iCpD < resCalcNew[fCp]?.calcNew?.length;
                iCpD++
              ) {
                const isDateMatching = (targetDate, dbDate) => {
                  return dbDate.find((entry) => {
                    return (
                      dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate
                    );
                  });
                };
                // // เรียกใช้งาน
                const ckDateMatch = isDateMatching(
                  resCalcNew[fCp]?.calcNew[iCpD]?.date,
                  fCapacityPublication?.capacity_publication_date,
                );
                let updateData = {};
                if (ckDateMatch) {
                  if (ckDateMatch?.value_adjust_use) {
                    updateData = {
                      value_adjust_use: String(
                        resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                      ),
                    };
                  } else if (ckDateMatch?.value_adjust) {
                    updateData = {
                      value_adjust_use: String(
                        resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                      ),
                    };
                  } else if (ckDateMatch?.value) {
                    updateData = {
                      value: String(resCalcNew[fCp]?.calcNew[iCpD]?.cals),
                    };
                  } else {
                    updateData = {
                      value: String(resCalcNew[fCp]?.calcNew[iCpD]?.cals),
                    };
                  }
                  updates.push({
                    where: { id: Number(ckDateMatch?.id) },
                    data: updateData,
                  });
                } else {
                  // create
                  icpdData.push({
                    capacity_publication_id: fCapacityPublication?.id,
                    value: String(resCalcNew[fCp]?.calcNew[iCpD]?.cals),
                    date_day: getTodayNowAdd7(resCalcNew[fCp]?.calcNew[iCpD]?.date).toDate(),
                  });
                }
              }
              if (updates.length > 0) {
                await this.prisma.$transaction(
                  updates.map((update) =>
                    this.prisma.capacity_publication_date.update(update),
                  ),
                );
              }
              await this.prisma.capacity_publication_date.createMany({
                data: icpdData,
              });
            } else {
              const createCP = await this.prisma.capacity_publication.create({
                data: {
                  area: {
                    connect: {
                      id: resCalcNew[fCp]?.area_id,
                    },
                  },
                  entry_exit: {
                    connect: {
                      id: resCalcNew[fCp]?.entry_exit_id,
                    },
                  },
                },
              });
              const icpdData = [];
              for (
                let iCpD = 0;
                iCpD < resCalcNew[fCp]?.calcNew?.length;
                iCpD++
              ) {
                icpdData.push({
                  capacity_publication_id: createCP?.id,
                  value: String(resCalcNew[fCp]?.calcNew[iCpD]?.cals),
                  date_day: getTodayNowAdd7(resCalcNew[fCp]?.calcNew[iCpD]?.date).toDate(),
                });
              }

              await this.prisma.capacity_publication_date.createMany({
                data: icpdData,
              });
            }
          }

          return { ...sets, resCalcNew: resCalcNew };
        }),
      );

      const versionLastUse = await this.prisma.booking_version.findFirst({
        where: {
          flag_use: true,
          contract_code_id: Number(createContractCodeAmd?.id),
        },
      });

      function assignNestedPeriods(data) {
        const dates = data[0].resCalcNew[0].calcNew.map((item) => item.date); // ดึงลำดับวันที่จาก array แรก
        let periodCounter = 1;

        const periods = dates.map((date, index) => {
          // ตรวจสอบค่าในแต่ละ calc ภายใน resCalcNew ทั้งหมด
          const values = data.flatMap((entry) =>
            entry.resCalcNew.map((res) => res.calcNew[index]?.value),
          );

          // เช็คว่าค่ามีความเปลี่ยนแปลงจากวันที่ก่อนหน้าหรือไม่
          if (index > 0) {
            const prevValues = data.flatMap((entry) =>
              entry.resCalcNew.map((res) => res.calcNew[index - 1]?.value),
            );

            if (!values.every((value, i) => value === prevValues[i])) {
              periodCounter++;
            }
          }

          return periodCounter;
        });

        // เพิ่ม period กลับเข้าไปที่แต่ละ calc ภายใน resCalcNew
        return data.map((entry) => ({
          ...entry,
          resCalcNew: entry.resCalcNew.map((res) => ({
            ...res,
            calcNew: res.calcNew.map((item, index) => ({
              ...item,
              period: periods[index],
            })),
          })),
        }));
      }

      const resultC = assignNestedPeriods(setDataUse);

      await this.prisma.capacity_detail.updateMany({
        where: {
          contract_code_id: Number(createContractCodeAmd?.id),
        },
        data: {
          flag_use: false,
        },
      });
      const capacityDetail = await this.prisma.capacity_detail.create({
        data: {
          contract_code: {
            connect: {
              id: Number(createContractCodeAmd?.id),
            },
          },
          booking_version: {
            connect: {
              id: Number(versionLastUse?.id),
            },
          },
          flag_use: true,
          mode_temp: 'APPROVED',
          create_date: nowDate,
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });
      const pointDate: any = [];
      for (let iSave = 0; iSave < resultC.length; iSave++) {
        const { resCalcNew, paths, ...newResultC } = resultC[iSave];
        const savePoint = await this.prisma.capacity_detail_point.create({
          data: {
            capacity_detail: {
              connect: {
                id: Number(capacityDetail?.id),
              },
            },
            area: {
              connect: {
                id: Number(newResultC?.exit_id_temp),
              },
            },
            path_temp: JSON.stringify(paths),
            temp: JSON.stringify(newResultC),
            create_date: nowDate,
            create_date_num: getTodayNowAdd7().unix(),
            create_by_account: {
              connect: {
                id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
              },
            },
          },
        });
        for (
          let iSavePointDate = 0;
          iSavePointDate < resCalcNew.length;
          iSavePointDate++
        ) {
          const { calcNew, ...newResCalcNew } = resCalcNew[iSavePointDate];
          for (
            let iSavePointDateCalcNew = 0;
            iSavePointDateCalcNew < calcNew.length;
            iSavePointDateCalcNew++
          ) {
            pointDate.push({
              capacity_detail_point_id: Number(savePoint?.id),
              area_id: Number(newResCalcNew?.area_id),
              value: calcNew[iSavePointDateCalcNew]?.value
                ? String(calcNew[iSavePointDateCalcNew]?.value)
                : null,
              cals: String(calcNew[iSavePointDateCalcNew]?.cals),
              adjust: calcNew[iSavePointDateCalcNew]?.adjust
                ? String(calcNew[iSavePointDateCalcNew]?.adjust)
                : null,
              adjust_type: calcNew[iSavePointDateCalcNew]?.adjustType
                ? String(calcNew[iSavePointDateCalcNew]?.adjustType)
                : null,
              ck_comparea: calcNew[iSavePointDateCalcNew]?.ck_comparea,
              period: Number(calcNew[iSavePointDateCalcNew]?.period),
              area_nominal_capacity: String(
                newResCalcNew?.area_nominal_capacity,
              ),
              date_day: getTodayNowAdd7(calcNew[iSavePointDateCalcNew]?.date).toDate(),
              create_date: nowDate,
              create_by: Number(userId),
              create_date_num: getTodayNowAdd7().unix(),
            });
          }
        }
      }
      if (pointDate.length > 0) {
        await this.prisma.capacity_detail_point_date.createMany({
          data: pointDate,
        });
      }
    } else {
      flagAmd = false;
      contract_code = contractCode?.contract_code;

      const bookingTemplate = await this.prisma.booking_template.findFirst({
        where: {
          term_type_id: contractCode?.term_type_id,
          start_date: {
            lte: todayEnd,
          },
          end_date: {
            gte: todayStart,
          },
        },
      });

      if (!bookingTemplate) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'booking template date not match',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      let checkMinMax = false;

      checkMinMax = this.checkDateRange(
        contract_start_date,
        contract_end_date,
        bookingTemplate?.file_period_mode,
        bookingTemplate?.min,
        bookingTemplate?.max,
      );

      if (!checkMinMax) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Date is NOT match',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      await this.prisma.extend_contract_capacity_request_management.create({
        data: {
          shadow_time: contractCode?.shadow_time,
          shadow_period: contractCode?.shadow_period || 0,
          new_shadow_time: shadow_period,
          new_shadow_period: shadow_period,
          start_date: contract_start_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_start_date).toDate()
            : null,
          end_date: contract_end_date
            ? getTodayNowDDMMYYYYDfaultAdd7(contract_end_date).toDate()
            : null,
          contract_code_id: contractCode?.id,
          temp_submitted_timestamp: getTodayNowAdd7().toDate(),
          file_period_mode: contractCode?.file_period_mode,
        },
      });

      const headerEntry: any = {
        'Capacity Daily Booking (MMBTU/d)': null,
        'Maximum Hour Booking (MMBTU/h)': null,
        'Capacity Daily Booking (MMscfd)': null,
        'Maximum Hour Booking (MMscfh)': null,
      };
      const headerExit: any = {
        'Capacity Daily Booking (MMBTU/d)': null,
        'Maximum Hour Booking (MMBTU/h)': null,
      };
      const keySDate = Number(
        Object.values(
          jsonFull['data_temp']['headerEntry'][
          'Capacity Daily Booking (MMBTU/d)'
          ],
        ).reduce((min, current: any) => {
          return current.key < min ? current.key : min;
        }, Infinity),
      );
      const keyEDate = Number(
        Object.values(
          jsonFull['data_temp']['headerExit'][
          'Capacity Daily Booking (MMBTU/d)'
          ],
        ).reduce((min, current: any) => {
          return current.key < min ? current.key : min;
        }, Infinity),
      );

      if (bookingTemplate?.file_start_date_mode === 1) {
        resultDate = this.generateDailyArray(startDate, endDateDate);
      }

      if (bookingTemplate?.file_start_date_mode === 3) {
        startDate = dayjs(startDate, 'DD/MM/YYYY', true)
          .add(bookingTemplate?.todayday, 'day')
          .format('DD/MM/YYYY');
        resultDate = this.generateDailyArray(startDate, endDateDate);
      }

      if (bookingTemplate?.file_start_date_mode === 2) {
        startDate = this.adjustStartDate(startDate, bookingTemplate?.fixdayday);
        resultDate = this.generateMonthArray(
          startDate,
          endDateDate,
          bookingTemplate?.fixdayday,
        );
      }

      // เรียง key ตามวันที่และเพิ่ม entry
      headerEntry['Capacity Daily Booking (MMBTU/d)'] =
        this.generateDateKeyMapNew(resultDate, keySDate);
      // เพิ่ม key ที่เริ่มต้นจาก keySDate + ความต่าง
      headerEntry['Maximum Hour Booking (MMBTU/h)'] =
        this.generateDateKeyMapNew(resultDate, keySDate + resultDate.length);

      headerEntry['Capacity Daily Booking (MMscfd)'] =
        this.generateDateKeyMapNew(
          resultDate,
          keySDate + resultDate.length * 2,
        );

      headerEntry['Maximum Hour Booking (MMscfh)'] = this.generateDateKeyMapNew(
        resultDate,
        keySDate + resultDate.length * 3,
      );

      headerExit['Capacity Daily Booking (MMBTU/d)'] =
        this.generateDateKeyMapNew(resultDate, keySDate);
      // เพิ่ม key ที่เริ่มต้นจาก keySDate + ความต่าง
      headerExit['Maximum Hour Booking (MMBTU/h)'] = this.generateDateKeyMapNew(
        resultDate,
        keySDate + resultDate.length,
      );

      const newVEntry = await this.transformToKeyArrayHValue(headerEntry);
      const newVExit = await this.transformToKeyArrayHValue(headerExit);

      const filteredDataEntry = jsonFull['data_temp']['entryValue'].map(
        (entry: any) => {
          // ใช้ Object.entries เพื่อแปลง entry เป็น key-value pairs
          const rowOld = Object.fromEntries(
            Object.entries(entry).filter(
              ([key]) => Number(key) < Number(keySDate),
            ),
          );
          const rowValueOld = Object.fromEntries(
            Object.entries(entry).filter(
              ([key]) => Number(key) >= Number(keySDate),
            ),
          );
          const valueNew = this.mapKeyOldWithClosestValue(
            newVEntry,
            jsonFull['data_temp']['headerEntry'],
            rowValueOld,
          );
          // rowOld['34'] = contract_end_date;
          rowOld['6'] = contract_end_date;
          return { ...rowOld, ...valueNew };
        },
      );

      const filteredDataExit = jsonFull['data_temp']['exitValue'].map(
        (exit: any) => {
          // ใช้ Object.entries เพื่อแปลง exit เป็น key-value pairs
          const rowOld = Object.fromEntries(
            Object.entries(exit).filter(
              ([key]) => Number(key) < Number(keyEDate),
            ),
          );
          const rowValueOld = Object.fromEntries(
            Object.entries(exit).filter(
              ([key]) => Number(key) >= Number(keyEDate),
            ),
          );
          const valueNew = this.mapKeyOldWithClosestValue(
            newVExit,
            jsonFull['data_temp']['headerExit'],
            rowValueOld,
          );
          // rowOld['34'] = contract_end_date;
          rowOld['6'] = contract_end_date;
          return { ...rowOld, ...valueNew };
        },
      );

      const data_temp: any = {
        headerEntry: null,
        headerExit: null,
        entryValue: null,
        exitValue: null,
        sumEntries: null,
        sumExits: null,
      };

      data_temp['shipperInfo'] = jsonFull['data_temp']['shipperInfo'];
      data_temp['headerEntry'] = headerEntry;
      data_temp['headerExit'] = headerExit;
      data_temp['entryValue'] = filteredDataEntry;
      data_temp['exitValue'] = filteredDataExit;
      const sumEntries = this.sumKeys(filteredDataEntry, Number(keySDate));

      const sumEntsumExitsries = this.sumKeys(
        filteredDataExit,
        Number(keyEDate),
      );

      data_temp['sumEntries'] = { '0': 'Sum Entry', ...sumEntries };
      data_temp['sumExits'] = { '0': 'Sum Exit', ...sumEntsumExitsries };

      const newEntry = data_temp['entryValue'];
      const newExit = data_temp['exitValue'];

      // เพิ่ม version
      await this.prisma.booking_version.updateMany({
        where: {
          contract_code_id: contractCode?.id,
        },
        data: {
          flag_use: false,
        },
      });

      const checkContractCodeCheckLength =
        await this.prisma.booking_version.count({
          where: {
            contract_code_id: contractCode?.id,
          },
        });

      const versId = await this.prisma.booking_version.create({
        data: {
          version: `v.${checkContractCodeCheckLength + 1}`,
          ...(!!contractCode?.id && {
            // new create ..
            contract_code: {
              connect: {
                id: contractCode?.id,
              },
            },
          }),
          flag_use: true,
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
          submitted_timestamp: getTodayNowAdd7().toDate(),
          type_account: {
            connect: {
              id: contractCode?.type_account_id,
            },
          },
          status_capacity_request_management: {
            connect: {
              id: contractCode?.status_capacity_request_management_id,
            },
          },
        },
      });

      console.log('versId : ', versId);

      await this.prisma.booking_full_json.create({
        data: {
          ...(!!versId?.id && {
            booking_version: {
              connect: {
                id: versId?.id,
              },
            },
          }),
          data_temp: JSON.stringify(data_temp),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });

      const mapDataRowJson = [];
      for (let i = 0; i < newEntry.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: newExit[i]['0'] },
          select: {
            area: { select: { name: true } },
            zone: { select: { name: true } },
          },
        });
        mapDataRowJson.push({
          booking_version_id: versId?.id,
          entry_exit_id: 1,

          zone_text: contractPoint?.zone?.name,
          area_text: contractPoint?.area?.name,
          contract_point: newExit[i]['0'],
          flag_use: true,
          data_temp: JSON.stringify(newExit[i]),
          create_by: Number(userId),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }
      for (let i = 0; i < newExit.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: newExit[i]['0'] },
          select: {
            area: { select: { name: true } },
            zone: { select: { name: true } },
          },
        });
        mapDataRowJson.push({
          booking_version_id: versId?.id,
          entry_exit_id: 2,

          zone_text: contractPoint?.zone?.name,
          area_text: contractPoint?.area?.name,
          contract_point: newExit[i]['0'],
          flag_use: true,
          data_temp: JSON.stringify(newExit[i]),
          create_by: Number(userId),
          create_date: getTodayNowAdd7().toDate(),
          create_date_num: getTodayNowAdd7().unix(),
        });
      }

      await this.prisma.booking_row_json.createMany({
        data: mapDataRowJson,
      });
      const terminateDate = dayjs(nowDate).format('YYYY-MM-DD');

      const contractCodePeriod = await this.prisma.contract_code.findFirst({
        where: { id: Number(id) },
        select: { shadow_period: true },
      });

      const nowDatesT = getTodayNowAdd7().toDate();

      const pathManagementT = await this.prisma.path_management.findFirst({
        where: {
          start_date: {
            lt: getTodayNowDDMMYYYYDfaultAdd7(nowDatesT).toDate() || null,
          },
        },
        include: {
          path_management_config: {
            include: {
              config_master_path: {
                include: {
                  revised_capacity_path: {
                    include: {
                      area: true,
                    },
                  },
                  revised_capacity_path_edges: true,
                },
              },
            },
          },
        },
        orderBy: {
          start_date: 'desc',
        },
      });

      pathManagementT['path_management_config'] = pathManagementT[
        'path_management_config'
      ].map((e: any) => {
        return { ...e, temps: this.safeParseJSON(e?.['temps']) };
      });

      const pathConfigT = pathManagementT['path_management_config'].map(
        (e: any) => {
          const findId = e?.temps?.revised_capacity_path?.find((f: any) => {
            return f?.area?.entry_exit_id === 1;
          });
          const findExit = e?.temps?.revised_capacity_path?.filter((f: any) => {
            return f?.area?.entry_exit_id === 2;
          });

          return {
            ...e,
            entryId: findId?.area?.id,
            entryName: findId?.area?.name,
            findExit,
          };
        },
      );

      const getDataT = await this.prisma.booking_version.findFirst({
        where: {
          contract_code_id: Number(id),
        },
        include: {
          booking_row_json: true,
          booking_full_json: true,
        },
        orderBy: { id: 'desc' },
      });
      const dataFullT = this.safeParseJSON(getDataT?.['booking_full_json']?.[0]?.data_temp);
      const dataRowT = getDataT['booking_row_json'];
      const entryUseT = dataRowT.filter((f: any) => {
        return f?.entry_exit_id === 1;
      });
      const exitUseT = dataRowT.filter((f: any) => {
        return f?.entry_exit_id === 2;
      });
      const entryDataT: any = [];
      const exitDataT: any = [];
      for (let i = 0; i < entryUseT.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: this.safeParseJSON(entryUseT?.[i]?.data_temp)?.['0'] },
          include: {
            area: {
              select: {
                id: true,
                name: true,
                area_nominal_capacity: true,
              },
            },
            zone: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        if (
          !contractPoint?.contract_point ||
          !contractPoint?.zone?.name ||
          !contractPoint?.area?.name
        ) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match.',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          entryDataT.push({
            contract_point: contractPoint?.contract_point,
            entry_exit_id: 1,
            zone_id: contractPoint?.zone?.id,
            zone: contractPoint?.zone?.name,
            area_id: contractPoint?.area?.id,
            area: contractPoint?.area?.name,
            area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
            entryUse: entryUseT[i],
          });
        }
      }
      for (let i = 0; i < exitUseT.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: this.safeParseJSON(exitUseT?.[i]?.data_temp)?.['0'] },
          include: {
            area: {
              select: {
                id: true,
                name: true,
                area_nominal_capacity: true,
              },
            },
            zone: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        if (
          !contractPoint?.contract_point ||
          !contractPoint?.zone?.name ||
          !contractPoint?.area?.name
        ) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match.',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          exitDataT.push({
            contract_point: contractPoint?.contract_point,
            entry_exit_id: contractPoint?.entry_exit_id,
            zone_id: contractPoint?.zone?.id,
            zone: contractPoint?.zone?.name,
            area_id: contractPoint?.area?.id,
            area: contractPoint?.area?.name,
            area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
            exitUse: exitUseT[i],
          });
        }
      }

      const pathUsePointT: any = [];
      for (let i = 0; i < exitDataT.length; i++) {
        const findEx = pathConfigT?.find((f: any) => {
          return f?.exit_name_temp === exitDataT[i]?.area;
        });
        if (!findEx) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match. config path',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          const entryOnce = findEx?.temps?.revised_capacity_path?.find(
            (f: any) => {
              return f?.area?.name === findEx?.exit_name_temp;
            },
          );
          // let entryOnce = findEx?.temps?.revised_capacity_path?.find(
          //   (f: any) => {
          //     return f?.area?.id === findEx?.entryId;
          //   },
          // );
          const paths: any = [];
          const pathsFull: any = [];
          const targetIdStart = findEx?.temps?.revised_capacity_path_edges.find(
            (fr: any) => {
              return fr?.source_id === entryOnce?.area?.id;
            },
          );
          paths.push({
            ...entryOnce,
            sourceId: entryOnce?.area?.id,
            targetId: targetIdStart?.target_id,
          });
          pathsFull.push({
            ...entryOnce,
            sourceId: entryOnce?.area?.id,
            targetId: targetIdStart?.target_id,
          });
          for (
            let irs = 0;
            irs < findEx?.temps?.revised_capacity_path_edges.length;
            irs++
          ) {
            const finds = findEx?.temps?.revised_capacity_path.find(
              (fp: any) => {
                return (
                  fp?.area?.id ===
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                );
              },
            );
            paths.push({
              ...finds,
              sourceId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
              targetId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
            });
            if (finds?.area?.name === findEx?.exit_name_temp) {
              break;
            }
          }
          for (
            let irs = 0;
            irs < findEx?.temps?.revised_capacity_path_edges.length;
            irs++
          ) {
            const finds = findEx?.temps?.revised_capacity_path.find(
              (fp: any) => {
                return (
                  fp?.area?.id ===
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                );
              },
            );
            pathsFull.push({
              ...finds,
              sourceId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
              targetId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
            });
          }

          pathUsePointT.push({
            ...findEx,
            dataBook: exitDataT[i],
            paths: paths,
            pathsFull: pathsFull,
          });
        }
      }

      const tempTypeT = dataFullT?.shipperInfo['1']['Type of Contract'];
      const contractTypeT =
        tempTypeT === 'LONG'
          ? 1
          : tempTypeT === 'MEDIUM'
            ? 2
            : tempTypeT === 'SHORT_FIRM'
              ? 3
              : tempTypeT === 'SHORT_NON_FIRM'
                ? 3
                : null;

      const bookingTemplateT = await this.prisma.booking_template.findFirst({
        where: {
          term_type_id: Number(contractTypeT),
          start_date: {
            lte: todayEnd,
          },
          end_date: {
            gte: todayStart,
          },
        },
      });

      if (!bookingTemplateT) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'booking template date not match',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      const file_period_modeT = bookingTemplateT?.file_period_mode; // 1 = วัน, 2 = เดือน, 3 = ปี
      // ดึงเฉพาะวันที่
      const dailyBookingT =
        dataFullT['headerEntry']['Capacity Daily Booking (MMBTU/d)'];
      // ดึง keys เฉพาะวันที่ (ไม่รวม key ที่เป็นของตัว entry เอง)
      const keysT = Object.keys(dailyBookingT)
        .filter((date) => dailyBookingT[date]?.key) // กรองเฉพาะที่เป็นวันที่และมี key
        .map((date) => ({
          key: Number(dailyBookingT[date].key), // แปลง key เป็นตัวเลข
          date: date, // ใช้ date เป็นค่า
        }))
        .sort((a, b) => a.key - b.key); // เรียงลำดับตาม key

      const exitValueT = dataFullT?.exitValue;
      function generateValueExtendT(keys, exitValue, file_period_mode) {
        const result = exitValue.map((values) => {
          // const endData = values['34']; // ค่าที่ต้องใช้ใน key สุดท้าย
          const endData = values['6']; // ค่าที่ต้องใช้ใน key สุดท้าย
          const data = keys.map((keyItem) => ({
            key: keyItem.key,
            date: keyItem.date,
            value: values[keyItem.key] || null, // แมตช์ค่า value ตาม key
          }));

          const valueExtend = [];
          for (let i = 0; i < data.length; i++) {
            const current = data[i];
            const next = data[i + 1] || { date: endData }; // ใช้ endData หากเป็น key สุดท้าย

            let startDate = dayjs(current.date, 'DD/MM/YYYY'); // แปลงวันที่จาก DD/MM/YYYY เป็น dayjs object
            let endDate = dayjs(next.date, 'DD/MM/YYYY');

            // Adjust endDate based on file_period_mode
            if (file_period_mode === 1 || file_period_mode === 2) {
              endDate = endDate.subtract(1, 'day'); // Exclude next key's date for days/months
            } else if (file_period_mode === 3 && !next.key) {
              endDate = dayjs(endData, 'DD/MM/YYYY'); // Handle year mode for last key
            }

            while (startDate.isBefore(endDate) || startDate.isSame(endDate)) {
              // Push each date into valueExtend
              valueExtend.push({
                date: startDate.format('YYYY-MM-DD'), // แปลงกลับเป็น YYYY-MM-DD
                value: current.value,
              });

              if (
                file_period_mode === 1 ||
                file_period_mode === 2 ||
                file_period_mode === 3
              ) {
                startDate = startDate.add(1, 'day'); // เพิ่มวันทีละ 1
              }
            }
          }

          return {
            contractPoint: values['0'],
            endData: endData,
            data: data,
            valueExtend: valueExtend,
          };
        });

        return result;
      }

      const resultNewDataExitT = generateValueExtendT(
        keysT,
        exitValueT,
        file_period_modeT,
      );

      const matchDataT = pathUsePointT.map((ex: any, ix: any) => {
        return { ...ex, valueEx: resultNewDataExitT[ix] };
      });
      const setDataUseT = await Promise.all(
        matchDataT.map(async (sets: any) => {
          const pathAreaId = sets?.paths.map((setsF: any) => {
            return setsF?.area?.id;
          });
          const areaData = await this.prisma.area.findMany({
            where: {
              id: {
                in: pathAreaId,
              },
            },
            select: {
              id: true,
              name: true,
              area_nominal_capacity: true,
              entry_exit_id: true,
            },
          });

          const resCalcNewT: any = [];
          for (let ical = 0; ical < areaData.length; ical++) {
            const calcNew: any = [];
            const fCapacityPublication =
              await this.prisma.capacity_publication.findFirst({
                where: {
                  area_id: Number(areaData[ical]?.id),
                },
                select: {
                  id: true,
                  capacity_publication_date: true,
                },
              });

            const resultPeriodAdd = this.extendDates(
              sets?.valueEx?.valueExtend,
              contractCodePeriod?.shadow_period || 0,
            );

            for (let icalAr = 0; icalAr < resultPeriodAdd.length; icalAr++) {
              const isDateMatching = (targetDate, dbDate) => {
                return dbDate.find((entry) => {
                  return (
                    dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate
                  );
                });
              };
              // เรียกใช้งาน
              const ckDateMatch =
                (!!fCapacityPublication &&
                  isDateMatching(
                    resultPeriodAdd[icalAr]?.date,
                    fCapacityPublication?.capacity_publication_date,
                  )) ||
                false;
              let mainCalc = null;
              let adjust = null;
              let adjustType = null;
              if (ckDateMatch) {
                if (ckDateMatch?.value_adjust_use) {
                  adjustType = 'value_adjust_use';
                  mainCalc = Number(ckDateMatch?.value_adjust_use);
                  adjust = Number(ckDateMatch?.value_adjust_use);
                } else if (ckDateMatch?.value_adjust) {
                  adjustType = 'value_adjust';
                  mainCalc = Number(ckDateMatch?.value_adjust);
                  adjust = Number(ckDateMatch?.value_adjust);
                } else if (ckDateMatch?.value) {
                  adjustType = 'value';
                  mainCalc = Number(ckDateMatch?.value);
                  adjust = null;
                } else {
                  adjustType = null;
                  mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                  adjust = null;
                }
              } else {
                adjustType = null;
                mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                adjust = null;
              }

              // -----
              const cals = Number(resultPeriodAdd[icalAr]?.value) + mainCalc;

              let ck_comparea = true;
              ck_comparea =
                icalAr === 0
                  ? true
                  : resultPeriodAdd[icalAr]?.value ===
                    resultPeriodAdd[icalAr - 1]?.value
                    ? true
                    : false;
              calcNew.push({
                ...resultPeriodAdd[icalAr],
                cals: cals,
                ck_comparea: ck_comparea,
                adjust: adjust,
                adjustType: adjustType,
              });
            }
            resCalcNewT.push({
              area_nominal_capacity: Number(
                areaData[ical]?.area_nominal_capacity,
              ),
              area_id: Number(areaData[ical]?.id),
              calcNew,
              entry_exit_id: areaData[ical]?.entry_exit_id,
            });
          }

          for (let fCp = 0; fCp < resCalcNewT.length; fCp++) {
            const fCapacityPublication =
              await this.prisma.capacity_publication.findFirst({
                where: {
                  area_id: Number(resCalcNewT[fCp]?.area_id),
                },
                select: {
                  id: true,
                  capacity_publication_date: true,
                  area: true,
                },
              });
            if (fCapacityPublication) {
              const updates = []; // อาร์เรย์เก็บข้อมูลการอัปเดต
              for (
                let iCpD = 0;
                iCpD < resCalcNewT[fCp]?.calcNew?.length;
                iCpD++
              ) {
                const isDateMatching = (targetDate, dbDate) => {
                  return dbDate.find((entry) => {
                    return (
                      dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate
                    );
                  });
                };
                // // เรียกใช้งาน
                const ckDateMatch = isDateMatching(
                  resCalcNewT[fCp]?.calcNew[iCpD]?.date,
                  fCapacityPublication?.capacity_publication_date,
                );
                if (
                  !!ckDateMatch &&
                  !!dayjs(ckDateMatch?.date_day).isSameOrAfter(
                    dayjs(terminateDate),
                  )
                ) {
                  let updateData = {};

                  if (ckDateMatch?.value_adjust_use) {
                    updateData = {
                      value_adjust_use: String(
                        resCalcNewT[fCp]?.calcNew[iCpD]?.cals,
                      ),
                    };
                  } else if (ckDateMatch?.value_adjust) {
                    updateData = {
                      value_adjust_use: String(
                        resCalcNewT[fCp]?.calcNew[iCpD]?.cals,
                      ),
                    };
                  } else if (ckDateMatch?.value) {
                    updateData = {
                      value: String(resCalcNewT[fCp]?.calcNew[iCpD]?.cals),
                    };
                  } else {
                    updateData = {
                      value: String(resCalcNewT[fCp]?.calcNew[iCpD]?.cals),
                    };
                  }
                  updates.push({
                    where: { id: Number(ckDateMatch?.id) },
                    data: updateData,
                  });
                }
              }

              if (updates.length > 0) {
                await this.prisma.$transaction(
                  updates.map((update) =>
                    this.prisma.capacity_publication_date.update(update),
                  ),
                );
              }
            }
          }

          return { ...sets, resCalcNew: resCalcNewT };
        }),
      );

      const contractCodePeriodA = await this.prisma.contract_code.findFirst({
        where: { id: Number(id) },
        select: { shadow_period: true },
      });

      const nowDates = getTodayNowAdd7().toDate();

      const pathManagement = await this.prisma.path_management.findFirst({
        where: {
          start_date: {
            lt: getTodayNowDDMMYYYYDfaultAdd7(nowDates).toDate() || null,
          },
        },
        include: {
          path_management_config: {
            include: {
              config_master_path: {
                include: {
                  revised_capacity_path: {
                    include: {
                      area: true,
                    },
                  },
                  revised_capacity_path_edges: true,
                },
              },
            },
          },
        },
        orderBy: {
          start_date: 'desc',
        },
      });

      pathManagement['path_management_config'] = pathManagement[
        'path_management_config'
      ].map((e: any) => {
        return { ...e, temps: this.safeParseJSON(e?.['temps']) };
      });

      const pathConfig = pathManagement['path_management_config'].map(
        (e: any) => {
          const findId = e?.temps?.revised_capacity_path?.find((f: any) => {
            return f?.area?.entry_exit_id === 1;
          });
          const findExit = e?.temps?.revised_capacity_path?.filter((f: any) => {
            return f?.area?.entry_exit_id === 2;
          });

          return {
            ...e,
            entryId: findId?.area?.id,
            entryName: findId?.area?.name,
            findExit,
          };
        },
      );

      const getData = await this.prisma.booking_version.findFirst({
        where: {
          contract_code_id: Number(id),
        },
        include: {
          booking_row_json: true,
          booking_full_json: true,
        },
        orderBy: { id: 'desc' },
      });
      const dataFull = this.safeParseJSON(getData?.['booking_full_json']?.[0]?.data_temp);
      const dataRow = getData['booking_row_json'];
      const entryUse = dataRow.filter((f: any) => {
        return f?.entry_exit_id === 1;
      });
      const exitUse = dataRow.filter((f: any) => {
        return f?.entry_exit_id === 2;
      });

      const entryData: any = [];
      const exitData: any = [];

      for (let i = 0; i < entryUse.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: this.safeParseJSON(entryUse?.[i]?.data_temp)?.['0'] },
          include: {
            area: {
              select: {
                id: true,
                name: true,
                area_nominal_capacity: true,
              },
            },
            zone: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        if (
          !contractPoint?.contract_point ||
          !contractPoint?.zone?.name ||
          !contractPoint?.area?.name
        ) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match.',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          entryData.push({
            contract_point: contractPoint?.contract_point,
            entry_exit_id: 1,
            zone_id: contractPoint?.zone?.id,
            zone: contractPoint?.zone?.name,
            area_id: contractPoint?.area?.id,
            area: contractPoint?.area?.name,
            area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
            entryUse: entryUse[i],
          });
        }
      }
      for (let i = 0; i < exitUse.length; i++) {
        const contractPoint = await this.prisma.contract_point.findFirst({
          where: { contract_point: this.safeParseJSON(exitUse?.[i]?.data_temp)?.['0'] },
          include: {
            area: {
              select: {
                id: true,
                name: true,
                area_nominal_capacity: true,
              },
            },
            zone: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        if (
          !contractPoint?.contract_point ||
          !contractPoint?.zone?.name ||
          !contractPoint?.area?.name
        ) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match.',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          exitData.push({
            contract_point: contractPoint?.contract_point,
            entry_exit_id: contractPoint?.entry_exit_id,
            zone_id: contractPoint?.zone?.id,
            zone: contractPoint?.zone?.name,
            area_id: contractPoint?.area?.id,
            area: contractPoint?.area?.name,
            area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
            exitUse: exitUse[i],
          });
        }
      }
      const pathUsePoint: any = [];
      for (let i = 0; i < exitData.length; i++) {
        const findEx = pathConfig?.find((f: any) => {
          return f?.exit_name_temp === exitData[i]?.area;
        });
        if (!findEx) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match. config path',
            },
            HttpStatus.BAD_REQUEST,
          );
        } else {
          const entryOnce = findEx?.temps?.revised_capacity_path?.find(
            (f: any) => {
              return f?.area?.name === findEx?.exit_name_temp;
            },
          );
          // let entryOnce = findEx?.temps?.revised_capacity_path?.find(
          //   (f: any) => {
          //     return f?.area?.id === findEx?.entryId;
          //   },
          // );
          const paths: any = [];
          const pathsFull: any = [];
          const targetIdStart = findEx?.temps?.revised_capacity_path_edges.find(
            (fr: any) => {
              return fr?.source_id === entryOnce?.area?.id;
            },
          );
          paths.push({
            ...entryOnce,
            sourceId: entryOnce?.area?.id,
            targetId: targetIdStart?.target_id,
          });
          pathsFull.push({
            ...entryOnce,
            sourceId: entryOnce?.area?.id,
            targetId: targetIdStart?.target_id,
          });
          for (
            let irs = 0;
            irs < findEx?.temps?.revised_capacity_path_edges.length;
            irs++
          ) {
            const finds = findEx?.temps?.revised_capacity_path.find(
              (fp: any) => {
                return (
                  fp?.area?.id ===
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                );
              },
            );
            paths.push({
              ...finds,
              sourceId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
              targetId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
            });
            if (finds?.area?.name === findEx?.exit_name_temp) {
              break;
            }
          }
          for (
            let irs = 0;
            irs < findEx?.temps?.revised_capacity_path_edges.length;
            irs++
          ) {
            const finds = findEx?.temps?.revised_capacity_path.find(
              (fp: any) => {
                return (
                  fp?.area?.id ===
                  findEx?.temps?.revised_capacity_path_edges[irs]?.target_id
                );
              },
            );
            pathsFull.push({
              ...finds,
              sourceId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.source_id,
              targetId:
                findEx?.temps?.revised_capacity_path_edges[irs]?.target_id,
            });
          }

          pathUsePoint.push({
            ...findEx,
            dataBook: exitData[i],
            paths: paths,
            pathsFull: pathsFull,
          });
        }
      }

      const tempType = dataFull?.shipperInfo['1']['Type of Contract'];
      const contractType =
        tempType === 'LONG'
          ? 1
          : tempType === 'MEDIUM'
            ? 2
            : tempType === 'SHORT_FIRM'
              ? 3
              : tempType === 'SHORT_NON_FIRM'
                ? 3
                : null;

      const bookingTemplateA = await this.prisma.booking_template.findFirst({
        where: {
          term_type_id: Number(contractType),
          start_date: {
            lte: todayEnd,
          },
          end_date: {
            gte: todayStart,
          },
        },
      });

      if (!bookingTemplateA) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'booking template date not match',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const file_period_mode = bookingTemplateA?.file_period_mode; // 1 = วัน, 2 = เดือน, 3 = ปี
      // ดึงเฉพาะวันที่
      const dailyBooking =
        dataFull['headerEntry']['Capacity Daily Booking (MMBTU/d)'];
      // ดึง keys เฉพาะวันที่ (ไม่รวม key ที่เป็นของตัว entry เอง)
      const keys = Object.keys(dailyBooking)
        .filter((date) => dailyBooking[date]?.key) // กรองเฉพาะที่เป็นวันที่และมี key
        .map((date) => ({
          key: Number(dailyBooking[date].key), // แปลง key เป็นตัวเลข
          date: date, // ใช้ date เป็นค่า
        }))
        .sort((a, b) => a.key - b.key); // เรียงลำดับตาม key

      const exitValue = dataFull?.exitValue;

      function generateValueExtend(keys, exitValue, file_period_mode) {
        const result = exitValue.map((values) => {
          // const endData = values['34']; // ค่าที่ต้องใช้ใน key สุดท้าย
          const endData = values['6']; // ค่าที่ต้องใช้ใน key สุดท้าย
          const data = keys.map((keyItem) => ({
            key: keyItem.key,
            date: keyItem.date,
            value: values[keyItem.key] || null, // แมตช์ค่า value ตาม key
          }));

          const valueExtend = [];
          for (let i = 0; i < data.length; i++) {
            const current = data[i];
            const next = data[i + 1] || { date: endData }; // ใช้ endData หากเป็น key สุดท้าย

            let startDate = dayjs(current.date, 'DD/MM/YYYY'); // แปลงวันที่จาก DD/MM/YYYY เป็น dayjs object
            let endDate = dayjs(next.date, 'DD/MM/YYYY');

            // Adjust endDate based on file_period_mode
            if (file_period_mode === 1 || file_period_mode === 2) {
              endDate = endDate.subtract(1, 'day'); // Exclude next key's date for days/months
            } else if (file_period_mode === 3 && !next.key) {
              endDate = dayjs(endData, 'DD/MM/YYYY'); // Handle year mode for last key
            }

            while (startDate.isBefore(endDate) || startDate.isSame(endDate)) {
              // Push each date into valueExtend
              valueExtend.push({
                date: startDate.format('YYYY-MM-DD'), // แปลงกลับเป็น YYYY-MM-DD
                value: current.value,
              });

              if (
                file_period_mode === 1 ||
                file_period_mode === 2 ||
                file_period_mode === 3
              ) {
                startDate = startDate.add(1, 'day'); // เพิ่มวันทีละ 1
              }
            }
          }

          return {
            contractPoint: values['0'],
            endData: endData,
            data: data,
            valueExtend: valueExtend,
          };
        });

        return result;
      }

      const resultNewDataExit = generateValueExtend(
        keys,
        exitValue,
        file_period_mode,
      );

      const matchData = pathUsePoint.map((ex: any, ix: any) => {
        return { ...ex, valueEx: resultNewDataExit[ix] };
      });

      const logWarning = [];
      const setDataUse = await Promise.all(
        matchData.map(async (sets: any) => {
          const pathAreaId = sets?.paths.map((setsF: any) => {
            return setsF?.area?.id;
          });
          const areaData = await this.prisma.area.findMany({
            where: {
              id: {
                in: pathAreaId,
              },
            },
            select: {
              id: true,
              name: true,
              area_nominal_capacity: true,
              entry_exit_id: true,
            },
          });

          const resCalcNew: any = [];
          for (let ical = 0; ical < areaData.length; ical++) {
            const calcNew: any = [];
            const fCapacityPublication =
              await this.prisma.capacity_publication.findFirst({
                where: {
                  area_id: Number(areaData[ical]?.id),
                },
                select: {
                  id: true,
                  capacity_publication_date: true,
                },
              });

            const resultPeriodAddA = this.extendDates(
              sets?.valueEx?.valueExtend,
              contractCodePeriodA?.shadow_period || 0,
            );

            for (let icalAr = 0; icalAr < resultPeriodAddA.length; icalAr++) {
              const isDateMatching = (targetDate, dbDate) => {
                return dbDate.find((entry) => {
                  return (
                    dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate
                  );
                });
              };
              // เรียกใช้งาน
              const ckDateMatch =
                (!!fCapacityPublication &&
                  isDateMatching(
                    resultPeriodAddA[icalAr]?.date,
                    fCapacityPublication?.capacity_publication_date,
                  )) ||
                false;
              let mainCalc = null;
              let adjust = null;
              let adjustType = null;
              if (ckDateMatch) {
                if (ckDateMatch?.value_adjust_use) {
                  adjustType = 'value_adjust_use';
                  mainCalc = Number(ckDateMatch?.value_adjust_use);
                  adjust = Number(ckDateMatch?.value_adjust_use);
                } else if (ckDateMatch?.value_adjust) {
                  adjustType = 'value_adjust';
                  mainCalc = Number(ckDateMatch?.value_adjust);
                  adjust = Number(ckDateMatch?.value_adjust);
                } else if (ckDateMatch?.value) {
                  adjustType = 'value';
                  mainCalc = Number(ckDateMatch?.value);
                  adjust = Number(ckDateMatch?.value);
                } else {
                  adjustType = null;
                  mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                  adjust = Number(areaData[ical]?.area_nominal_capacity);
                }
              } else {
                adjustType = null;
                mainCalc = Number(areaData[ical]?.area_nominal_capacity);
                adjust = null;
              }

              const cals = mainCalc - Number(resultPeriodAddA[icalAr]?.value);
              if (cals <= 0) {
                logWarning.push(
                  `${resultPeriodAddA[icalAr]?.date} | ${mainCalc} - ${resultPeriodAddA[icalAr]?.value} => calc 0 น้อยกว่า`,
                );
              }
              let ck_comparea = true;
              ck_comparea =
                icalAr === 0
                  ? true
                  : resultPeriodAddA[icalAr]?.value ===
                    resultPeriodAddA[icalAr - 1]?.value
                    ? true
                    : false;
              calcNew.push({
                ...resultPeriodAddA[icalAr],
                cals: cals,
                ck_comparea: ck_comparea,
                adjust: adjust,
                adjustType: adjustType,
              });
            }
            resCalcNew.push({
              area_nominal_capacity: Number(
                areaData[ical]?.area_nominal_capacity,
              ),
              area_id: Number(areaData[ical]?.id),
              calcNew,
              entry_exit_id: areaData[ical]?.entry_exit_id,
            });
          }

          for (let fCp = 0; fCp < resCalcNew.length; fCp++) {
            const fCapacityPublication =
              await this.prisma.capacity_publication.findFirst({
                where: {
                  area_id: Number(resCalcNew[fCp]?.area_id),
                },
                select: {
                  id: true,
                  capacity_publication_date: true,
                  area: true,
                },
              });

            // approved update calc book
            if (fCapacityPublication) {
              // มี
              const icpdData = [];
              const updates = []; // อาร์เรย์เก็บข้อมูลการอัปเดต
              for (
                let iCpD = 0;
                iCpD < resCalcNew[fCp]?.calcNew?.length;
                iCpD++
              ) {
                const isDateMatching = (targetDate, dbDate) => {
                  return dbDate.find((entry) => {
                    return (
                      dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate
                    );
                  });
                };
                // // เรียกใช้งาน
                const ckDateMatch = isDateMatching(
                  resCalcNew[fCp]?.calcNew[iCpD]?.date,
                  fCapacityPublication?.capacity_publication_date,
                );
                let updateData = {};
                if (ckDateMatch) {
                  if (ckDateMatch?.value_adjust_use) {
                    updateData = {
                      value_adjust_use: String(
                        resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                      ),
                    };
                  } else if (ckDateMatch?.value_adjust) {
                    updateData = {
                      value_adjust_use: String(
                        resCalcNew[fCp]?.calcNew[iCpD]?.cals,
                      ),
                    };
                  } else if (ckDateMatch?.value) {
                    updateData = {
                      value: String(resCalcNew[fCp]?.calcNew[iCpD]?.cals),
                    };
                  } else {
                    updateData = {
                      value: String(resCalcNew[fCp]?.calcNew[iCpD]?.cals),
                    };
                  }
                  updates.push({
                    where: { id: Number(ckDateMatch?.id) },
                    data: updateData,
                  });
                } else {
                  // create
                  icpdData.push({
                    capacity_publication_id: fCapacityPublication?.id,
                    value: String(resCalcNew[fCp]?.calcNew[iCpD]?.cals),
                    date_day: getTodayNowAdd7(resCalcNew[fCp]?.calcNew[iCpD]?.date).toDate(),
                  });
                }
              }
              if (updates.length > 0) {
                await this.prisma.$transaction(
                  updates.map((update) =>
                    this.prisma.capacity_publication_date.update(update),
                  ),
                );
              }
              await this.prisma.capacity_publication_date.createMany({
                data: icpdData,
              });
            } else {
              const createCP = await this.prisma.capacity_publication.create({
                data: {
                  area: {
                    connect: {
                      id: resCalcNew[fCp]?.area_id,
                    },
                  },
                  entry_exit: {
                    connect: {
                      id: resCalcNew[fCp]?.entry_exit_id,
                    },
                  },
                },
              });
              const icpdData = [];
              for (
                let iCpD = 0;
                iCpD < resCalcNew[fCp]?.calcNew?.length;
                iCpD++
              ) {
                icpdData.push({
                  capacity_publication_id: createCP?.id,
                  value: String(resCalcNew[fCp]?.calcNew[iCpD]?.cals),
                  date_day: getTodayNowAdd7(resCalcNew[fCp]?.calcNew[iCpD]?.date).toDate(),
                });
              }

              await this.prisma.capacity_publication_date.createMany({
                data: icpdData,
              });
            }
          }

          return { ...sets, resCalcNew: resCalcNew };
        }),
      );

      const versionLastUse = await this.prisma.booking_version.findFirst({
        where: {
          flag_use: true,
          contract_code_id: Number(id),
        },
      });

      function assignNestedPeriods(data) {
        const dates = data[0].resCalcNew[0].calcNew.map((item) => item.date); // ดึงลำดับวันที่จาก array แรก
        let periodCounter = 1;

        const periods = dates.map((date, index) => {
          // ตรวจสอบค่าในแต่ละ calc ภายใน resCalcNew ทั้งหมด
          const values = data.flatMap((entry) =>
            entry.resCalcNew.map((res) => res.calcNew[index]?.value),
          );

          // เช็คว่าค่ามีความเปลี่ยนแปลงจากวันที่ก่อนหน้าหรือไม่
          if (index > 0) {
            const prevValues = data.flatMap((entry) =>
              entry.resCalcNew.map((res) => res.calcNew[index - 1]?.value),
            );

            if (!values.every((value, i) => value === prevValues[i])) {
              periodCounter++;
            }
          }

          return periodCounter;
        });

        // เพิ่ม period กลับเข้าไปที่แต่ละ calc ภายใน resCalcNew
        return data.map((entry) => ({
          ...entry,
          resCalcNew: entry.resCalcNew.map((res) => ({
            ...res,
            calcNew: res.calcNew.map((item, index) => ({
              ...item,
              period: periods[index],
            })),
          })),
        }));
      }

      const resultC = assignNestedPeriods(setDataUse);

      await this.prisma.capacity_detail.updateMany({
        where: {
          contract_code_id: Number(id),
        },
        data: {
          flag_use: false,
        },
      });
      const capacityDetail = await this.prisma.capacity_detail.create({
        data: {
          contract_code: {
            connect: {
              id: Number(id),
            },
          },
          booking_version: {
            connect: {
              id: Number(versionLastUse?.id),
            },
          },
          flag_use: true,
          mode_temp: 'APPROVED',
          create_date: nowDate,
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });
      const pointDate: any = [];
      for (let iSave = 0; iSave < resultC.length; iSave++) {
        const { resCalcNew, paths, ...newResultC } = resultC[iSave];
        const savePoint = await this.prisma.capacity_detail_point.create({
          data: {
            capacity_detail: {
              connect: {
                id: Number(capacityDetail?.id),
              },
            },
            area: {
              connect: {
                id: Number(newResultC?.exit_id_temp),
              },
            },
            path_temp: JSON.stringify(paths),
            temp: JSON.stringify(newResultC),
            create_date: nowDate,
            create_date_num: getTodayNowAdd7().unix(),
            create_by_account: {
              connect: {
                id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
              },
            },
          },
        });
        for (
          let iSavePointDate = 0;
          iSavePointDate < resCalcNew.length;
          iSavePointDate++
        ) {
          const { calcNew, ...newResCalcNew } = resCalcNew[iSavePointDate];
          for (
            let iSavePointDateCalcNew = 0;
            iSavePointDateCalcNew < calcNew.length;
            iSavePointDateCalcNew++
          ) {
            pointDate.push({
              capacity_detail_point_id: Number(savePoint?.id),
              area_id: Number(newResCalcNew?.area_id),
              value: calcNew[iSavePointDateCalcNew]?.value
                ? String(calcNew[iSavePointDateCalcNew]?.value)
                : null,
              cals: String(calcNew[iSavePointDateCalcNew]?.cals),
              adjust: calcNew[iSavePointDateCalcNew]?.adjust
                ? String(calcNew[iSavePointDateCalcNew]?.adjust)
                : null,
              adjust_type: calcNew[iSavePointDateCalcNew]?.adjustType
                ? String(calcNew[iSavePointDateCalcNew]?.adjustType)
                : null,
              ck_comparea: calcNew[iSavePointDateCalcNew]?.ck_comparea,
              period: Number(calcNew[iSavePointDateCalcNew]?.period),
              area_nominal_capacity: String(
                newResCalcNew?.area_nominal_capacity,
              ),
              date: getTodayNowAdd7(calcNew[iSavePointDateCalcNew]?.date).toDate(),
              create_date: nowDate,
              create_by: Number(userId),
              create_date_num: getTodayNowAdd7().unix(),
            });
          }
        }
      }
      if (pointDate.length > 0) {
        await this.prisma.capacity_detail_point_date.createMany({
          data: pointDate,
        });
      }
    }

    return {
      message: 'Success',
    };
  }


  mapKeyOldWithValue(arg1: any, headerEntry: any, rowValueOld: any) {
    const result: any = {};

    for (const [key, value] of Object.entries(arg1)) {
      const { main, key: date } = value as { main: string; key: string }; // ระบุโครงสร้างของ value
      let keyOld = null;

      if (headerEntry[main] && headerEntry[main][date]) {
        keyOld = headerEntry[main][date].key; // ดึงค่า keyOld
      }

      result[key] = {
        ...(value as { main: string; key: string }), // ระบุว่าคุณกำลังคัดลอกออบเจ็กต์
        keyOld,
        value: keyOld && rowValueOld[keyOld] ? rowValueOld[keyOld] : null,
      };
    }

    return result;
  }


  mapKeyOldWithClosestValue(arg1: any, headerEntry: any, rowValueOld: any) {
    const result: any = {};

    // Helper function: หา keyOld ที่ใกล้เคียงที่สุด
    const findClosestKeyOld = (
      main: string,
      targetDate: string,
    ): string | null => {
      if (!headerEntry[main]) return null;

      let closestDate: string | null = null;
      let closestKey: string | null = null;

      for (const [date, entry] of Object.entries(headerEntry[main])) {
        if (entry && typeof entry === 'object' && 'key' in entry) {
          const entryKey = (entry as { key: string }).key;

          // เปรียบเทียบความต่างของวันที่โดยใช้ dayjs
          const currentDiff = Math.abs(
            dayjs(date, 'DD/MM/YYYY').diff(
              dayjs(targetDate, 'DD/MM/YYYY'),
              'day',
            ),
          );
          const closestDiff = closestDate
            ? Math.abs(
              dayjs(closestDate, 'DD/MM/YYYY').diff(
                dayjs(targetDate, 'DD/MM/YYYY'),
                'day',
              ),
            )
            : Infinity;

          if (currentDiff < closestDiff) {
            closestDate = date;
            closestKey = entryKey;
          }
        }
      }

      return closestKey;
    };

    // วนลูปแต่ละ key ใน arg1
    for (const [key, value] of Object.entries(arg1)) {
      if (
        value &&
        typeof value === 'object' &&
        'main' in value &&
        'key' in value
      ) {
        const {
          main,
          key: date,
          value: existingValue,
        } = value as {
          main: string;
          key: string;
          value: any;
        };

        let keyOld = null;

        // ตรวจสอบว่า main และวันที่มีอยู่ใน headerEntry หรือไม่
        if (headerEntry[main] && headerEntry[main][date]) {
          keyOld = headerEntry[main][date].key; // ดึง keyOld จาก headerEntry ถ้าตรง
        } else if (!existingValue) {
          // ถ้าไม่มี value ให้หา keyOld ที่ใกล้เคียงที่สุด
          keyOld = findClosestKeyOld(main, date);
        }

        // เพิ่มข้อมูลลงใน result
        result[key] =
          keyOld && rowValueOld[keyOld] ? rowValueOld[keyOld] : null;
      }
    }

    return result;
  }


  sumKeys(entryValue: any[], startKey: number) {
    const result: Record<string, number> = {};

    entryValue.forEach((entry) => {
      for (const [key, value] of Object.entries(entry)) {
        const numericKey = Number(key); // แปลง key เป็นตัวเลข
        if (numericKey >= startKey) {
          // ถ้า key >= startKey ให้บวกค่า
          result[key] = (result[key] || 0) + Number(value); // บวกค่าถ้ามีอยู่แล้ว หรือเริ่มต้นที่ 0
        }
      }
    });

    return result;
  }

  transformRowValueOldV2(rowValueOld: any, headerEntry: any) {
    const rowValueOldV2: any = {};

    // วนลูปแต่ละประเภทใน headerEntry
    for (const [category, dates] of Object.entries(headerEntry)) {
      if (!rowValueOldV2[category]) {
        rowValueOldV2[category] = {};
      }

      // วนลูป key-value ภายใน category
      for (const [date, { key }] of Object.entries(dates)) {
        // ตรวจสอบว่า key อยู่ใน rowValueOld หรือไม่
        if (rowValueOld[key]) {
          // ถ้ามี key ใน rowValueOld ให้เพิ่มค่าใน rowValueOldV2
          rowValueOldV2[category][key] = { [date]: rowValueOld[key] };
        }
      }
    }

    return rowValueOldV2;
  }


  generateDateKeyMapNew(dates: string[], startKey: number) {
    const dateKeyMap: any = {};
    dates.forEach((date, index) => {
      dateKeyMap[date] = { key: startKey + index };
    });
    return dateKeyMap;
  }


  transformToKeyArrayHValue(data: any) {
    const result: Record<number, { main: string; key: string }> = {};

    for (const [main, dates] of Object.entries(data)) {
      for (const [date, value] of Object.entries(dates)) {
        // ตรวจสอบว่า value มี property 'key'
        if (value && typeof value === 'object' && 'key' in value) {
          const { key } = value as { key: number }; // Type Assertion แบบปลอดภัย
          result[key] = {
            main,
            key: date,
          };
        }
      }
    }

    return result;
  }

  mapKeyOld(arg1: any, headerEntry: any) {
    const result: Record<number, { main: string; key: string; keyOld: string | null }> = {};

    // วนลูปแต่ละ key ใน arg1
    for (const [key, value] of Object.entries(arg1)) {
      const { main, key: date } = value as { main: string; key: string };

      // ตรวจสอบว่า main มีอยู่ใน headerEntry
      if (headerEntry[main] && headerEntry[main][date]) {
        result[Number(key)] = {
          ...(value as { main: string; key: string }),
          keyOld: headerEntry[main][date].key,
        };
      } else {
        result[Number(key)] = {
          ...(value as { main: string; key: string }),
          keyOld: null,
        };
      }
    }

    return result;
  }

  transformDataArrNew(data: any[]): string[][] {
    // ค้นหาคีย์สูงสุดใน data เพื่อกำหนดความยาวสูงสุด
    const maxKeys = data.reduce((max, obj) => {
      const keys = Object.keys(obj).map(Number);
      return Math.max(max, ...keys);
    }, 0);

    // แปลงข้อมูลเป็น array ของ array
    return data.map((entry) => {
      const row: string[] = [];
      for (let i = 0; i <= maxKeys; i++) {
        row[i] = entry[i] || ''; // ใส่ "" หากไม่มี key
      }
      return row;
    });
  }

  async importTemplate(
    data: any,
    userId: any,
    file: any,
    token: any,
    id: any,
    terminateDate: any,
    amd: any,
  ) {
    const resultTranform = this.safeParseJSON(data?.json_data);
    const headerEntry = resultTranform?.headerEntry || {};
    const entryValue = resultTranform?.entryValue || [];
    const headerExit = resultTranform?.headerExit || {};
    const exitValue = resultTranform?.exitValue || [];
    const sumEntries = resultTranform?.sumEntries || {};
    const sumExits = resultTranform?.sumExits || {};

    let shipperName = null;
    let typeOfContract = null;
    let contractCode = null;

    Object.values(resultTranform?.shipperInfo).forEach((info: any) => {
      if (info['Shipper Name']) {
        shipperName = info['Shipper Name'];
      }
      if (info['Type of Contract']) {
        typeOfContract = info['Type of Contract'];
      }
      if (info['Contract Code']) {
        contractCode = info['Contract Code'];
      }
    });

    let resultContractCode: any;
    if (contractCode.includes('_Amd')) {
      const match = contractCode.match(/(.*)(_Amd.*)/);
      resultContractCode = [match[1], match[2]];
    } else {
      resultContractCode = [contractCode];
    }

    const typeOfContractText =
      typeOfContract === 'LONG'
        ? 1
        : typeOfContract === 'MEDIUM'
          ? 2
          : typeOfContract === 'SHORT_FIRM'
            ? 3
            : typeOfContract === 'SHORT_NON_FIRM'
              ? 4
              : null;

    const checkHead = await this.prisma.contract_code.findFirst({
      where: {
        id: Number(id),
        ref_contract_code_by_main: {
          contract_code: resultContractCode[0],
        },
        group: {
          name: shipperName,
        },
        term_type_id: typeOfContractText,
      },
    });

    if (!checkHead) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Shipper Info does not match the value.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const getGroupByName = await this.getGroupByName(shipperName);

    if (!getGroupByName || !typeOfContractText || !contractCode) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Shipper Info does not match the value.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    const bookingTemplate = await this.prisma.booking_template.findFirst({
      where: {
        term_type_id: Number(typeOfContractText),
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

    if (!bookingTemplate) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'booking template date not match',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const checkValueSum = {
      entry: {
        'Capacity Daily Booking (MMBTU/d)': [],
        'Maximum Hour Booking (MMBTU/h)': [],
        'Capacity Daily Booking (MMscfd)': [],
        'Maximum Hour Booking (MMscfh)': [],
      },
      exit: {
        'Capacity Daily Booking (MMBTU/d)': [],
        'Maximum Hour Booking (MMBTU/h)': [],
      },
    };

    const entryCompareNotMatch = [];
    const exitCompareNotMatch = [];

    const compareEntryExit = {
      'Capacity Daily Booking (MMBTU/d)': [],
      'Maximum Hour Booking (MMBTU/h)': [],
    };

    // Populate checkValueSum.entry
    for (const key in checkValueSum.entry) {
      if (headerEntry[key]) {
        Object.keys(headerEntry[key]).forEach((date) => {
          if (date !== 'key') {
            const entryKey = headerEntry[key][date]?.key;
            let sum = 0;
            entryValue.forEach((entry) => {
              if (entry[entryKey] !== undefined) {
                sum += parseFloat(entry[entryKey]) || 0;
              }
            });
            checkValueSum.entry[key].push({
              key: entryKey,
              sum,
              headerKey: date,
            });
          }
        });
      }
    }

    // Populate checkValueSum.exit
    for (const key in checkValueSum.exit) {
      if (headerExit[key]) {
        Object.keys(headerExit[key]).forEach((date) => {
          if (date !== 'key') {
            const exitKey = headerExit[key][date]?.key;
            let sum = 0;
            exitValue.forEach((exit) => {
              if (exit[exitKey] !== undefined) {
                sum += parseFloat(exit[exitKey]) || 0;
              }
            });
            checkValueSum.exit[key].push({
              key: exitKey,
              sum,
              headerKey: date,
            });
          }
        });
      }
    }

    // Compare checkValueSum.entry with sumEntries
    for (const key in checkValueSum.entry) {
      checkValueSum.entry[key].forEach((entryItem) => {
        const { key: entryKey, sum: calculatedSum, headerKey } = entryItem;
        const expectedSum = parseFloat(sumEntries[entryKey]) || 0;

        if (calculatedSum !== expectedSum) {
          entryCompareNotMatch.push({
            headerKey, // This will be the date, such as "01/11/2024"
            key: entryKey,
            description: key,
            calculatedSum,
            expectedSum,
            status: 'Mismatch',
          });
        }
      });
    }

    // Compare checkValueSum.exit with sumExits
    for (const key in checkValueSum.exit) {
      checkValueSum.exit[key].forEach((exitItem) => {
        const { key: exitKey, sum: calculatedSum, headerKey } = exitItem;
        const expectedSum = parseFloat(sumExits[exitKey]) || 0;

        if (calculatedSum !== expectedSum) {
          exitCompareNotMatch.push({
            headerKey, // This will be the date, such as "01/11/2024"
            key: exitKey,
            description: key,
            calculatedSum,
            expectedSum,
            status: 'Mismatch',
          });
        }
      });
    }

    // Compare each entry item with its corresponding exit item in compareEntryExit
    for (const key of [
      'Capacity Daily Booking (MMBTU/d)',
      'Maximum Hour Booking (MMBTU/h)',
    ]) {
      checkValueSum.entry[key].forEach((entryItem) => {
        const { key: entryKey, sum: entrySum, headerKey } = entryItem;
        const exitItem = checkValueSum.exit[key].find(
          (exit) => exit.key === entryKey,
        );

        if (exitItem) {
          const exitSum = exitItem.sum;
          if (entrySum !== exitSum) {
            compareEntryExit[key].push({
              description: key,
              headerKey, // This will be the date, such as "01/11/2024"
              key: entryKey,
              entrySum,
              exitSum,
              status: 'Mismatch',
            });
          }
        } else {
          // If no matching exit item found, consider it a mismatch
          compareEntryExit[key].push({
            description: key,
            headerKey,
            key: entryKey,
            entrySum,
            exitSum: null, // Indicate no matching exit sum found
            status: 'Mismatch (No Matching Exit)',
          });
        }
      });
    }

    const keyEntryPoint =
      resultTranform?.['headerEntry']?.['Entry']?.['Entry Point']?.['key'];
    const keyExitPoint =
      resultTranform?.['headerExit']?.['Exit']?.['Entry Point']?.['key'];
    const warningData = [];
    const newData = getTodayNowAdd7().format('YYYY/MM/DD HH:mm');

    let dEntryA: any = null;

    let dExitA: any = null;

    const keyEntryFrom =
      resultTranform?.['headerEntry']?.['Period']?.['From']?.['key'];
    const keyEntryTo =
      resultTranform?.['headerEntry']?.['Period']?.['To']?.['key'];
    const keyExitFrom =
      resultTranform?.['headerExit']?.['Period']?.['From']?.['key'];
    const keyExitTo =
      resultTranform?.['headerExit']?.['Period']?.['To']?.['key'];

    const dateStartAll: any = [];
    const dateEndAll: any = [];

    const newEntry = await Promise.all(
      entryValue.map(async (e: any, i: any) => {
        const entryPointName = e[keyEntryPoint];

        // let newStartDayPlus = dayjs(todayStart).add(1, 'day');
        // let newStartDayPlus = dayjs(todayStart).add(1, 'day');
        const newStartDayPlus = dayjs(todayStart);
        const useStart = dayjs(e[keyEntryFrom], 'DD/MM/YYYY');

        const isCheckMoreDate = useStart.isAfter(newStartDayPlus);
        let checkMinMax = false;

        if (!isCheckMoreDate && amd === 'on') {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error:
                'Period From date in the template must be later than today.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        checkMinMax = this.checkDateRange(
          e[keyEntryFrom],
          e[keyEntryTo],
          bookingTemplate?.file_period_mode,
          bookingTemplate?.min,
          bookingTemplate?.max,
        );

        if (!checkMinMax) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Date is NOT match',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        const headerEntryDate = resultTranform?.['headerEntry'];
        const keysGreaterThanEntryTo = Object.keys(e).filter(
          (key) => Number(key) > Number(keyEntryTo),
        );
        for (let is = 0; is < keysGreaterThanEntryTo.length; is++) {
          if (headerEntryDate) {
            Object.keys(headerEntryDate).forEach((capacityKey) => {
              const capacityDates = headerEntryDate[capacityKey];
              Object.keys(capacityDates).forEach((dateKey) => {
                const keyValue = capacityDates[dateKey]?.['key'];
                if (keysGreaterThanEntryTo[is] === keyValue) {
                  const dateToCheckCk = dayjs(e[dateKey], 'DD/MM/YYYY');
                  const startDateCk = dayjs(e[keyEntryFrom], 'DD/MM/YYYY');
                  const endDateCk = dayjs(e[keyEntryTo], 'DD/MM/YYYY');
                  dateStartAll.push(e[keyEntryFrom]);
                  dateEndAll.push(e[keyEntryTo]);

                  const isInRangeZero = dayjs(dateKey, 'DD/MM/YYYY').isBetween(
                    dayjs(e[keyEntryFrom], 'DD/MM/YYYY'),
                    dayjs(e[keyEntryTo], 'DD/MM/YYYY'),
                    'day',
                    '[]',
                  );

                  // เงื่อนไขตรวจสอบความถูกต้อง
                  let resultZero: boolean;
                  // if (isInRangeZero && e[keyValue] > 0) {
                  //   // อยู่ในช่วง และ value > 0 = ถูกต้อง
                  //   resultZero = true;
                  // } else if (!isInRangeZero && e[keyValue] === 0) {
                  //   // ไม่อยู่ในช่วง และ value === 0 = ถูกต้อง
                  //   resultZero = true;
                  // } else {
                  //   // นอกเหนือจากนี้ = ผิด
                  //   resultZero = false;
                  // }
                  if (!isInRangeZero && e[keyValue] === 0) {
                    resultZero = true;
                  } else if (!isInRangeZero) {
                    resultZero = false;
                  } else {
                    resultZero = true;
                  }
                  if (!resultZero) {
                    console.log('------- 3');
                    throw new HttpException(
                      {
                        status: HttpStatus.BAD_REQUEST,
                        error: 'Date is NOT match.',
                      },
                      HttpStatus.BAD_REQUEST,
                    );
                  }

                  const isInRange = dateToCheckCk.isBetween(
                    startDateCk,
                    endDateCk,
                    null,
                    '[]',
                  );

                  if (isInRange) {
                    if (Number(e[keyValue]) <= 0) {
                      if (!isCheckMoreDate) {
                        warningData.push(
                          `${capacityKey} [date : [${dateKey}] value : ${e[keyValue]}] Entry Point: ${entryPointName} not match system ${newData}`,
                        );
                      }
                    }
                  } else {
                    if (Number(e[keyValue]) !== 0) {
                      warningData.push(
                        `${capacityKey} [date : [${dateKey}] value : ${e[keyValue]}] Entry Point: ${entryPointName} not match system ${newData}`,
                      );
                    }
                  }
                  if (!dEntryA) {
                    dEntryA = {};
                  }

                  if (!dEntryA[i]) {
                    dEntryA[i] = {
                      start: e[keyEntryFrom],
                      end: e[keyEntryTo],
                      date: { [capacityKey]: [] },
                    };
                  }

                  dEntryA = {
                    ...dEntryA,
                    [i]: {
                      start: e[keyEntryFrom],
                      end: e[keyEntryTo],
                      date: {
                        ...dEntryA[i]['date'],
                        [capacityKey]: [
                          ...(dEntryA[i]['date'][capacityKey] || []),
                          dateKey,
                        ],
                      },
                    },
                  };
                }
              });
            });
          }
        }

        const getContractPointByName = await this.getContractPointByName(
          entryPointName,
          getGroupByName?.id || null,
        );
        if (!getContractPointByName) {
          warningData.push(
            `Entry Point: ${entryPointName} not match system ${newData}`,
          );
        }
        const contractPoints = await this.prisma.contract_point.findFirst({
          where: {
            contract_point: e['0'],
            entry_exit_id: 1,
          },
          include: {
            area: true,
            zone: true,
          },
        });

        return {
          data: e,

          contract_point: e['0'],
          area: contractPoints?.area?.name || null,
          zone: contractPoints?.zone?.name || null,
          // area: e['1'] || null,
          // zone: e['0'] || null,
          contractPointName: entryPointName || null,
        };
      }),
    );

    const newExit = await Promise.all(
      exitValue.map(async (e: any, i: any) => {
        const exitPointName = e[keyExitPoint];

        // let newStartDayPlus = dayjs(todayStart).add(1, 'day');
        // let newStartDayPlus = dayjs(todayStart).add(1, 'day');
        const newStartDayPlus = dayjs(todayStart);
        const useStart = dayjs(e[keyExitFrom], 'DD/MM/YYYY');
        const isCheckMoreDate = useStart.isAfter(newStartDayPlus);
        let checkMinMax = false;

        if (!isCheckMoreDate && amd === 'on') {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error:
                'Period From date in the template must be later than today.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        checkMinMax = this.checkDateRange(
          e[keyExitFrom],
          e[keyExitTo],
          bookingTemplate?.file_period_mode,
          bookingTemplate?.min,
          bookingTemplate?.max,
        );
        if (!checkMinMax) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Date is NOT match',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        const headerExitDate = resultTranform?.['headerExit'];
        const keysGreaterThanExitTo = Object.keys(e).filter(
          (key) => Number(key) > Number(keyExitTo),
        );
        for (let is = 0; is < keysGreaterThanExitTo.length; is++) {
          if (headerExitDate) {
            Object.keys(headerExitDate).forEach((capacityKey) => {
              const capacityDates = headerExitDate[capacityKey];
              Object.keys(capacityDates).forEach((dateKey) => {
                const keyValue = capacityDates[dateKey]?.['key'];
                if (keysGreaterThanExitTo[is] === keyValue) {
                  const dateToCheckCk = dayjs(e[dateKey], 'DD/MM/YYYY');
                  const startDateCk = dayjs(e[keyExitFrom], 'DD/MM/YYYY');
                  const endDateCk = dayjs(e[keyExitTo], 'DD/MM/YYYY');
                  dateStartAll.push(e[keyEntryFrom]);
                  dateEndAll.push(e[keyEntryTo]);
                  const isInRange = dateToCheckCk.isBetween(
                    startDateCk,
                    endDateCk,
                    null,
                    '[]',
                  );
                  if (isInRange) {
                    if (Number(e[keyValue]) <= 0) {
                      if (!isCheckMoreDate) {
                        warningData.push(
                          `${capacityKey} [date : [${dateKey}] value : ${e[keyValue]}] Exit Point: ${exitPointName} not match system ${newData}`,
                        );
                      }
                    }
                  } else {
                    if (Number(e[keyValue]) !== 0) {
                      warningData.push(
                        `${capacityKey} [date : [${dateKey}] value : ${e[keyValue]}] Exit Point: ${exitPointName} not match system ${newData}`,
                      );
                    }
                  }
                  if (!dExitA) {
                    dExitA = {};
                  }

                  if (!dExitA[i]) {
                    dExitA[i] = {
                      start: e[keyExitFrom],
                      end: e[keyExitTo],
                      date: { [capacityKey]: [] },
                    };
                  }

                  dExitA = {
                    ...dExitA,
                    [i]: {
                      start: e[keyExitFrom],
                      end: e[keyExitTo],
                      date: {
                        ...dExitA[i]['date'],
                        [capacityKey]: [
                          ...(dExitA[i]['date'][capacityKey] || []),
                          dateKey,
                        ],
                      },
                    },
                  };
                }
              });
            });
          }
        }

        const getContractPointByName = await this.getContractPointByName(
          exitPointName,
          getGroupByName?.id || null,
        );
        if (!getContractPointByName) {
          warningData.push(
            `Exit Point: ${exitPointName} not match system ${newData}`,
          );
        }
        const contractPoints = await this.prisma.contract_point.findFirst({
          where: {
            contract_point: e['0'],
            entry_exit_id: 1,
          },
          include: {
            area: true,
            zone: true,
          },
        });

        return {
          data: e,

          contract_point: e['0'],
          area: contractPoints?.area?.name || null,
          zone: contractPoints?.zone?.name || null,
          // area: e['1'] || null,
          // zone: e['0'] || null,
          contractPointName: exitPointName || null,
        };
      }),
    );

    const minDate = dateStartAll.reduce((min, current) => {
      return dayjs(current, 'DD/MM/YYYY').isBefore(dayjs(min, 'DD/MM/YYYY'))
        ? current
        : min;
    }, dateStartAll[0]);
    const maxDate = dateEndAll.reduce((max, current) => {
      return dayjs(current, 'DD/MM/YYYY').isAfter(dayjs(max, 'DD/MM/YYYY'))
        ? current
        : max;
    }, dateEndAll[0]);

    const checkContractCode = await this.prisma.contract_code.findFirst({
      select: {
        id: true,
        contract_code: true,
        status_capacity_request_management: true,
        file_period_mode: true,
        fixdayday: true,
        todayday: true,
        group: {
          select: {
            name: true,
          },
        },
        term_type_id: true,
      },
      where: {
        contract_code: contractCode,
      },
    });

    if (checkContractCode) {
      // มี
      if (shipperName !== checkContractCode?.group?.name) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'ShipperName ไม่เหมือนของเดิม',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (typeOfContractText !== checkContractCode?.term_type_id) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Term Type ไม่เหมือนของเดิม',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (
        checkContractCode?.file_period_mode !==
        bookingTemplate?.file_period_mode &&
        checkContractCode?.file_period_mode === 2
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'format date ไม่เหมือนของเดิม',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else if (
        bookingTemplate?.file_period_mode === 2 &&
        (checkContractCode?.file_period_mode === 1 ||
          checkContractCode?.file_period_mode === 3)
      ) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'format date ไม่เหมือนของเดิม',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else {
        const dEntryArray = Object.values(dEntryA);
        for (let i = 0; i < dEntryArray.length; i++) {
          const calcCheckEntry = await this.validateDateEntries(
            dEntryArray[i],
            bookingTemplate?.file_period_mode,
            bookingTemplate?.fixdayday,
            bookingTemplate?.todayday,
            minDate,
            maxDate,
          );
          const objCalcEntry = this.extractValidationResults(
            calcCheckEntry?.date,
          );
          const findCalcEntry = objCalcEntry.filter((f: any) => {
            return f === false;
          });

          if (findCalcEntry.length > 0) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'format date Entry มีวันที่/จำนวนไม่ถูกต้อง',
              },
              HttpStatus.BAD_REQUEST,
            );
          }
        }
        const dExitArray = Object.values(dExitA);
        for (let i = 0; i < dExitArray.length; i++) {
          const calcCheckExit = await this.validateDateEntries(
            dExitArray[i],
            bookingTemplate?.file_period_mode,
            bookingTemplate?.fixdayday,
            bookingTemplate?.todayday,
            minDate,
            maxDate,
          );
          const objCalcExit = this.extractValidationResults(
            calcCheckExit?.date,
          );
          const findCalcExit = objCalcExit.filter((f: any) => {
            return f === false;
          });
          if (findCalcExit.length > 0) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'format date Exit มีวันที่/จำนวนไม่ถูกต้อง',
              },
              HttpStatus.BAD_REQUEST,
            );
          }
        }
      }
    } else {
      // ไม่มี
      const dEntryArray = Object.values(dEntryA);
      for (let i = 0; i < dEntryArray.length; i++) {
        const calcCheckEntry = await this.validateDateEntries(
          dEntryArray[i],
          bookingTemplate?.file_period_mode,
          bookingTemplate?.fixdayday,
          bookingTemplate?.todayday,
          minDate,
          maxDate,
        );
        const objCalcEntry = this.extractValidationResults(
          calcCheckEntry?.date,
        );
        const findCalcEntry = objCalcEntry.filter((f: any) => {
          return f === false;
        });

        if (findCalcEntry.length > 0) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'format date Entry มีวันที่/จำนวนไม่ถูกต้อง',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }
      const dExitArray = Object.values(dExitA);
      for (let i = 0; i < dExitArray.length; i++) {
        const calcCheckExit = await this.validateDateEntries(
          dExitArray[i],
          bookingTemplate?.file_period_mode,
          bookingTemplate?.fixdayday,
          bookingTemplate?.todayday,
          minDate,
          maxDate,
        );
        const objCalcExit = this.extractValidationResults(calcCheckExit?.date);
        const findCalcExit = objCalcExit.filter((f: any) => {
          return f === false;
        });
        if (findCalcExit.length > 0) {
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'format date Exit มีวันที่/จำนวนไม่ถูกต้อง',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    if (entryCompareNotMatch.length > 0) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Total Entry & Total Exit is NOT match.',
          data: entryCompareNotMatch,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (exitCompareNotMatch.length > 0) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Total Entry & Total Exit is NOT match.',
          data: exitCompareNotMatch,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      compareEntryExit['Capacity Daily Booking (MMBTU/d)'].length > 0 ||
      compareEntryExit['Maximum Hour Booking (MMBTU/h)'].length > 0
    ) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Total Entry & Total Exit is NOT match.',
          data: compareEntryExit,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const checkContractCodeCheckLast =
      await this.prisma.contract_code.findFirst({
        select: {
          id: true,
          status_capacity_request_management_id: true,
          contract_start_date: true,
          contract_end_date: true,
          terminate_date: true,
          status_capacity_request_management_process_id: true,
          ref_contract_code_by_main_id: true,
          ref_contract_code_by_id: true,
          shadow_period: true,
          shadow_time: true,
          type_account_id: true,
        },
        where: {
          ref_contract_code_by_main_id: checkContractCode?.id,
        },
        orderBy: {
          id: 'desc',
        },
      });

    if (
      checkContractCodeCheckLast?.status_capacity_request_management_process_id ===
      4 ||
      checkContractCodeCheckLast?.status_capacity_request_management_id === 5
    ) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Contract Code End | Terminate',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    let versionFlag = false;
    let amdFlag = false;
    let newCreate = false;
    let contract_code = resultContractCode[0];
    const nowDate = getTodayNowAdd7().toDate();

    const hasContractStarted =
      dayjs(nowDate).isAfter(
        dayjs(checkContractCodeCheckLast?.contract_start_date),
      ) ||
      dayjs(nowDate).isSame(
        dayjs(checkContractCodeCheckLast?.contract_start_date),
      );
    let amdVersion: any = null;
    if (
      hasContractStarted &&
      checkContractCodeCheckLast?.status_capacity_request_management_id === 2
    ) {
      const checkContractCodeCheckLength =
        await this.prisma.contract_code.count({
          where: {
            ref_contract_code_by_main_id: checkContractCode?.id,
          },
        });
      amdVersion =
        '_Amd' +
        String(
          checkContractCodeCheckLength > 9
            ? checkContractCodeCheckLength
            : '0' + checkContractCodeCheckLength,
        );
      contract_code = contract_code + amdVersion;
      amdFlag = true;
    } else if (
      !hasContractStarted &&
      checkContractCodeCheckLast?.status_capacity_request_management_id === 2
    ) {
      versionFlag = true;
    } else {
      if (checkContractCodeCheckLast) {
        versionFlag = true;
      } else {
        newCreate = true;
      }
    }

    const shipperId = await this.prisma.group.findFirst({
      select: {
        id: true,
      },
      where: {
        name: shipperName,
      },
    });



    if (newCreate) {
      console.log('new');
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'error เงื่อนไข ไม่ตรง',
        },
        HttpStatus.BAD_REQUEST,
      );
    } else {

      // https://app.clickup.com/t/86erqt8g5
      const ckAreaDup = [...newEntry, ...newExit]?.map((ar: any) => ar?.area)
      const hasDuplicate = new Set(ckAreaDup).size !== ckAreaDup.length;
      if (hasDuplicate) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Area is Contract Point Duplicate.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (versionFlag && amd === 'off') {
        console.log('versionFlag');

        await this.prisma.contract_code.update({
          where: {
            id: Number(id),
          },
          data: {
            contract_start_date: minDate
              ? getTodayNowDDMMYYYYDfaultAdd7(minDate).toDate()
              : null,
            contract_end_date: maxDate
              ? getTodayNowDDMMYYYYDfaultAdd7(maxDate).toDate()
              : null,
            submitted_timestamp: getTodayNowAdd7().toDate(),
            update_date: getTodayNowAdd7().toDate(),
            update_date_num: getTodayNowAdd7().unix(),
            update_by_account: {
              connect: {
                id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
              },
            },
          },
        });

        await this.prisma.booking_version.updateMany({
          where: {
            contract_code_id: Number(id),
          },
          data: {
            flag_use: false,
          },
        });

        const checkContractCodeCheckLength =
          await this.prisma.booking_version.count({
            where: {
              contract_code_id: Number(id),
            },
          });

        const versId = await this.prisma.booking_version.create({
          data: {
            version: `v.${checkContractCodeCheckLength + 1}`,
            ...(!!checkContractCodeCheckLast?.id && {
              contract_code: {
                connect: {
                  id: checkContractCodeCheckLast?.id,
                },
              },
            }),
            flag_use: true,
            create_date: getTodayNowAdd7().toDate(),
            create_date_num: getTodayNowAdd7().unix(),
            create_by_account: {
              connect: {
                id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
              },
            },
            submitted_timestamp: getTodayNowAdd7().toDate(),
            type_account: {
              connect: {
                id: checkContractCodeCheckLast?.type_account_id,
              },
            },
            status_capacity_request_management: {
              connect: {
                id: checkContractCodeCheckLast?.status_capacity_request_management_id,
              },
            },
          },
        });

        await this.prisma.booking_full_json.create({
          data: {
            ...(!!versId?.id && {
              booking_version: {
                connect: {
                  id: versId?.id,
                },
              },
            }),
            data_temp: JSON.stringify(resultTranform),
            create_date: getTodayNowAdd7().toDate(),
            create_date_num: getTodayNowAdd7().unix(),
            create_by_account: {
              connect: {
                id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
              },
            },
          },
        });

        const mapDataRowJson = [];
        for (let i = 0; i < newEntry.length; i++) {
          mapDataRowJson.push({
            booking_version_id: versId?.id,
            entry_exit_id: 1,

            zone_text: newEntry[i]?.zone,
            area_text: newEntry[i]?.area,
            contract_point: newEntry[i]?.contract_point,
            flag_use: true,
            data_temp: JSON.stringify(newEntry[i]?.data),
            create_by: Number(userId),
            create_date: getTodayNowAdd7().toDate(),
            create_date_num: getTodayNowAdd7().unix(),
          });
        }
        for (let i = 0; i < newExit.length; i++) {
          mapDataRowJson.push({
            booking_version_id: versId?.id,
            entry_exit_id: 2,

            zone_text: newExit[i]?.zone,
            area_text: newExit[i]?.area,
            contract_point: newExit[i]?.contract_point,
            flag_use: true,
            data_temp: JSON.stringify(newExit[i]?.data),
            create_by: Number(userId),
            create_date: getTodayNowAdd7().toDate(),
            create_date_num: getTodayNowAdd7().unix(),
          });
        }

        await this.prisma.booking_row_json.createMany({
          data: mapDataRowJson,
        });

        const responseUpFile = await uploadFilsTemp(file);
        await this.fileCapacityBooking(
          responseUpFile?.file?.url,
          checkContractCodeCheckLast?.id,
          userId,
        );
      } else if (amdFlag && amd === 'on') {
        const extendContractLast =
          await this.prisma.extend_contract_capacity_request_management.findFirst(
            {
              where: {
                contract_code_id: checkContractCodeCheckLast?.id,
              },
              orderBy: {
                id: 'desc',
              },
            },
          );
        const configStart = dayjs(extendContractLast?.start_date).format(
          'DD/MM/YYYY',
        );
        const configEnd = dayjs(extendContractLast?.end_date).format(
          'DD/MM/YYYY',
        );

        const resCk = await this.validateEndDate({
          configStart: configStart,
          configEnd: configEnd,
          file_period_mode: bookingTemplate?.file_period_mode,
          shadow_time: checkContractCodeCheckLast?.shadow_time,
          startdate: minDate,
          endDate: maxDate,
          shadow_period: checkContractCodeCheckLast?.shadow_period,
        });

        if (resCk) {
          console.log('--amd');
          if (minDate !== terminateDate) {
            throw new HttpException(
              {
                status: HttpStatus.BAD_REQUEST,
                error: 'terminateDate ไม่สอดคล้อง',
                data: compareEntryExit,
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          const createContractCodeAmd = await this.prisma.contract_code.create({
            data: {
              contract_code: contract_code,
              ...(!!typeOfContractText && {
                term_type: {
                  connect: {
                    id: typeOfContractText,
                  },
                },
              }),
              ...(!!shipperId?.id && {
                group: {
                  connect: {
                    id: shipperId?.id,
                  },
                },
              }),
              status_capacity_request_management_process: {
                connect: {
                  id: 1,
                },
              },
              status_capacity_request_management: {
                connect: {
                  id: 2,
                },
              },
              type_account: {
                connect: {
                  id: 1,
                },
              },
              ...(!!checkContractCodeCheckLast?.ref_contract_code_by_main_id && {
                ref_contract_code_by_main: {
                  connect: {
                    id: checkContractCodeCheckLast?.ref_contract_code_by_main_id,
                  },
                },
              }),
              ...(!!checkContractCodeCheckLast?.id && {
                ref_contract_code_by: {
                  connect: {
                    id: checkContractCodeCheckLast?.id,
                  },
                },
              }),
              shadow_period: checkContractCodeCheckLast?.shadow_period,
              shadow_time: checkContractCodeCheckLast?.shadow_time,
              file_period_mode: bookingTemplate?.file_period_mode,
              fixdayday: bookingTemplate?.fixdayday,
              todayday: bookingTemplate?.todayday,
              contract_start_date: minDate
                ? getTodayNowDDMMYYYYDfaultAdd7(minDate).toDate()
                : null,
              contract_end_date: maxDate
                ? getTodayNowDDMMYYYYDfaultAdd7(maxDate).toDate()
                : null,
              submitted_timestamp: getTodayNowAdd7().toDate(),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
              create_by_account: {
                connect: {
                  id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
                },
              },
            },
          });

          await this.prisma.contract_code.update({
            where: {
              id: createContractCodeAmd?.id,
            },
            data: {
              ref_contract_code_by_main_id:
                checkContractCodeCheckLast?.ref_contract_code_by_main_id,
              ref_contract_code_by_id: checkContractCodeCheckLast?.id,
            },
          });

          const versId = await this.prisma.booking_version.create({
            data: {
              version: `v.1`,
              ...(!!createContractCodeAmd?.id && {
                // new create ..
                contract_code: {
                  connect: {
                    id: createContractCodeAmd?.id,
                  },
                },
              }),
              flag_use: true,
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
              create_by_account: {
                connect: {
                  id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
                },
              },
              submitted_timestamp: getTodayNowAdd7().toDate(),
              type_account: {
                connect: {
                  id: createContractCodeAmd?.type_account_id,
                },
              },
              status_capacity_request_management: {
                connect: {
                  id: createContractCodeAmd?.status_capacity_request_management_id,
                },
              },
            },
          });

          await this.prisma.booking_full_json.create({
            data: {
              ...(!!versId?.id && {
                booking_version: {
                  connect: {
                    id: versId?.id,
                  },
                },
              }),
              data_temp: JSON.stringify(resultTranform),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
              create_by_account: {
                connect: {
                  id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
                },
              },
            },
          });

          const mapDataRowJson = [];
          for (let i = 0; i < newEntry.length; i++) {
            const checkZAC = await this.prisma.contract_point.findFirst({
              where: {
                contract_point: newEntry[i]?.contract_point,
                area: {
                  name: newEntry[i]?.area || '',
                },
                zone: {
                  name: newEntry[i]?.zone || '',
                },
                entry_exit_id: 1,
              },
            });
            if (!checkZAC) {
              throw new HttpException(
                {
                  status: HttpStatus.BAD_REQUEST,
                  error: 'zone & area & contract point ไม่สอดคล้อง',
                },
                HttpStatus.BAD_REQUEST,
              );
            }
            mapDataRowJson.push({
              booking_version_id: versId?.id,
              entry_exit_id: 1,
              zone_text: newEntry[i]?.zone,
              area_text: newEntry[i]?.area,
              contract_point: newEntry[i]?.contract_point,
              flag_use: true,
              data_temp: JSON.stringify(newEntry[i]?.data),
              create_by: Number(userId),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
            });
          }
          for (let i = 0; i < newExit.length; i++) {
            const checkZAC = await this.prisma.contract_point.findFirst({
              where: {
                contract_point: newExit[i]?.contract_point,
                area: {
                  name: newExit[i]?.area || '',
                },
                zone: {
                  name: newExit[i]?.zone || '',
                },
                entry_exit_id: 2,
              },
            });
            if (!checkZAC) {
              throw new HttpException(
                {
                  status: HttpStatus.BAD_REQUEST,
                  error: 'zone & area & contract point ไม่สอดคล้อง',
                },
                HttpStatus.BAD_REQUEST,
              );
            }

            mapDataRowJson.push({
              booking_version_id: versId?.id,
              entry_exit_id: 2,
              zone_text: newExit[i]?.zone,
              area_text: newExit[i]?.area,
              contract_point: newExit[i]?.contract_point,
              flag_use: true,
              data_temp: JSON.stringify(newExit[i]?.data),
              create_by: Number(userId),
              create_date: getTodayNowAdd7().toDate(),
              create_date_num: getTodayNowAdd7().unix(),
            });
          }

          await this.prisma.booking_row_json.createMany({
            data: mapDataRowJson,
          });

          const responseUpFile = await uploadFilsTemp(file);
          await this.fileCapacityBooking(
            responseUpFile?.file?.url,
            checkContractCodeCheckLast?.id,
            userId,
          );

          await this.prisma.contract_code.updateMany({
            where: {
              id: Number(checkContractCodeCheckLast?.id),
            },
            data: {
              status_capacity_request_management_id: 5,
            },
          });
        } else {
          // ไม่ได้
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'ไม่ตรงกับ เงื่อนไข shadow time or shadow period',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      } else {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'error เงื่อนไข',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    return {
      message: 'Success.',
    };
  }

  async commentVersion(payload: any, id: any, userId: any) {
    const { comment } = payload;
    const dateCre = getTodayNowAdd7();

    const createCommentVersion =
      await this.prisma.booking_version_comment.create({
        data: {
          ...(!!id && {
            booking_version: {
              connect: {
                id: Number(id),
              },
            },
          }),
          comment: comment,
          create_date: dateCre.toDate(),
          create_date_num: getTodayNowAdd7().unix(),
          create_by_account: {
            connect: {
              id: Number(userId), // Prisma จะใช้ connect แทนการใช้ create_by โดยตรง
            },
          },
        },
      });
    return createCommentVersion;
  }

  async capacityDetail(period: any) {
    return period;
  }

  async groupPath() {
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    const configPath = await this.prisma.config_master_path.findMany({
      include: {
        revised_capacity_path: {
          include: {
            area: true,
          },
          orderBy: {
            area_id: 'desc',
          },
        },
        revised_capacity_path_edges: true,
      },
      where: {
        active: true,
        revised_capacity_path: {
          some: {
            area: {
              AND: [
                {
                  start_date: {
                    lte: todayEnd, // วันที่เริ่มต้นน้อยกว่าหรือเท่ากับวันนี้
                  },
                },
                {
                  OR: [
                    {
                      end_date: {
                        gte: todayStart, // วันที่สิ้นสุดมากกว่าหรือเท่ากับวันนี้
                      },
                    },
                    {
                      end_date: null, // หรือไม่มี end_date (null)
                    },
                  ],
                },
              ],
            },
          },
        },
      },
      orderBy: { id: 'desc' },
    });

    const exitArrId: any = [];
    const pathConfigs = configPath.map((e: any) => {
      for (let iex = 0; iex < e?.revised_capacity_path.length; iex++) {
        if (e?.revised_capacity_path[iex]?.area?.entry_exit_id === 2) {
          const area = e?.revised_capacity_path[iex]?.area;
          if (!exitArrId.find((item) => item.id === area?.id)) {
            exitArrId.push(area);
          }
        }
      }

      return e;
    });

    const exitArrResult = exitArrId.map((e: any) => {
      // pathConfigs
      // revised_capacity_path
      // area?.id
      const filId = pathConfigs?.filter((f: any) => {
        const filData = f?.revised_capacity_path?.find((fs: any) => {
          return fs?.area?.id === e?.id;
        });
        return !!filData;
      });

      return { ...e, pathConfigs: filId };
    });

    const newData = (exitArrResult || []).filter((item) => {
      const startDate = item.start_date ? new Date(item.start_date) : null;
      const endDate = item.end_date ? new Date(item.end_date) : null;

      // ✅ กรอง start_date: เอาเฉพาะที่ start_date <= วันนี้
      const isStartDateValid = startDate && startDate <= todayStart;

      // ✅ กรอง end_date:
      //  - ถ้ามีค่า → ต้อง >= วันนี้
      //  - ถ้าเป็น null → ให้ผ่าน
      const isEndDateValid = !endDate || endDate >= todayStart;

      return isStartDateValid && isEndDateValid;
    });

    return newData || [];
  }
}
