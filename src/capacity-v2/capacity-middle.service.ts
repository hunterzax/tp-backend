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
import { Prisma } from '@prisma/client';
import { UploadTemplateForShipperService } from 'src/upload-template-for-shipper/upload-template-for-shipper.service';
import { FileUploadService } from 'src/grpc/file-service.service';
import {
  getTodayEndAdd7,
  getTodayNowAdd7,
  getTodayNowDDMMYYYYAdd7,
  getTodayNowDDMMYYYYDfault,
  getTodayNowDDMMYYYYDfaultAdd7,
  getTodayNowYYYYMMDDDfaultAdd7,
  getTodayStartAdd7,
} from 'src/common/utils/date.util';
import { uploadFilsTemp } from 'src/common/utils/uploadFileIn';
import { parseToNumber } from 'src/common/utils/number.util';
dayjs.extend(isSameOrBefore); // เปิดใช้งาน plugin isSameOrBefore
dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class CapacityMiddleService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private readonly uploadTemplateForShipperService: UploadTemplateForShipperService,
    private readonly fileUploadService: FileUploadService,
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

  genMD(startDate: string, endDate: string, mode: number): number | boolean {
    const starts = startDate ? getTodayNowDDMMYYYYAdd7(startDate) : null;
    const ends = endDate ? getTodayNowDDMMYYYYAdd7(endDate) : null;
    if (!starts || !ends) {
      return false;
    }
    let diff = 0;
    // คำนวณความแตกต่างตามโหมดที่กำหนด
    if (mode === 1) {
      diff = ends.diff(starts, 'day') + 1; // คำนวณต่างกันเป็นจำนวนวัน
    } else if (mode === 2) {
      // diff = ends.diff(starts, 'month'); // คำนวณต่างกันเป็นจำนวนเดือน
      diff = ends.diff(starts, 'month') + 1; // นับเดือนจากต้นเดือนถึงสิ้นเดือน
      // diff = ends.diff(starts, 'month') + 1; // นับเดือนจากต้นเดือนถึงสิ้นเดือน
      // diff = ends.endOf('month').diff(starts.startOf('month'), 'month') + 1; // นับเดือนจากต้นเดือนถึงสิ้นเดือน
    }
    return diff;
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

    if (!starts || !ends) return false;

    let diff;

    // console.log('**** s ***');
    // console.log('startDate : ', startDate);
    // console.log('endDate : ', endDate);
    // console.log('file_period_mode : ', file_period_mode);
    // console.log('min : ', min);
    // console.log('max : ', max);
    // console.log('**** e ***');

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
    // console.log('file_period_mode : ', file_period_mode);
    // console.log('starts : ', starts);
    // console.log('ends : ', ends);
    // console.log('diff : ', diff);
    // console.log('min : ', min);
    // console.log('max : ', max);
    // ตรวจสอบความแตกต่างว่าอยู่ในช่วง min และ max หรือไม่
    return diff >= min && diff <= max;
  }

  async getContractPointByName(name: any, group: any) {
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();

    return await this.prisma.contract_point.findFirst({
      select: {
        id: true,
        contract_point: true,
        area: {
          select: {
            id: true,
            name: true,
          },
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
        AND: [
          {
            contract_point_start_date: {
              lte: todayEnd, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
            },
          },
          {
            OR: [
              { contract_point_end_date: null }, // ถ้า end_date เป็น null
              { contract_point_end_date: { gte: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
            ],
          },
        ],
      },
    });
  }

  generateExpectedDates = (start, end, mode, fixday, todayday) => {
    const dates = [];
    if (!start || !end) return dates;
    let current = dayjs(start, 'DD/MM/YYYY');
    const endDay = dayjs(end, 'DD/MM/YYYY').subtract(1, 'day');

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
    // console.log('mode : ', mode);
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

      const isLengthMatching = actualDates.length === expectedDates.length;
      const areDatesMatching = actualDates.every((date) => {
        return expectedDates.includes(date);
      });

      const validationResult = isLengthMatching && areDatesMatching;

      result.date[key] = mode === 2 ? true : validationResult;
    }

    return result;
  };

  extractValidationResults = (result: any) => {
    return Object.values(result);
  };

  async getGroupByName(name: any) {
    return await this.prisma.group.findFirst({
      where: {
        name: name,
        user_type_id: 3,
      },
      include: {
        shipper_contract_point: {
          include: {
            contract_point: true,
          },
        },
      },
    });
  }

  typeOfContractNumToText(type: any) {
    const typeOfContract =
      type === '1'
        ? 'LONG'
        : type === '2'
          ? 'MEDIUM'
          : type === '3'
            ? 'SHORT_FIRM'
            : type === '4'
              ? 'SHORT_NON_FIRM'
              : 'error type';
    return typeOfContract;
  }

  typeOfContractTextToNum(typeOfContract: any) {
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
    return typeOfContractText;
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
        // console.log('keyOld : ', keyOld);

        // console.log('rowValueOld[keyOld] : ', rowValueOld[keyOld]);
        // เพิ่มข้อมูลลงใน result
        result[key] =
          keyOld && rowValueOld[keyOld] ? rowValueOld[keyOld] : null;
      }
    }

    return result;
  }


  mapKeyOldWithClosestValueNew(arg1: any, headerEntry: any, rowValueOld: any) {

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
        // console.log('keyOld : ', keyOld);

        // console.log('rowValueOld[keyOld] : ', rowValueOld[keyOld]);
        // เพิ่มข้อมูลลงใน result
        result[key] =
          keyOld && rowValueOld[keyOld] ? rowValueOld[keyOld] : null;
      }
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

  generateDateKeyMapNew(dates: string[], startKey: number) {
    const dateKeyMap: any = {};
    dates.forEach((date, index) => {
      dateKeyMap[date] = { key: String(startKey + index) };
      // dateKeyMap[date] = { key: startKey + index };
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

  sumKeysNew(entryValue: any[], startKey: number) {
    // console.log('val : ', entryValue);
    const result: Record<string, number> = {};

    entryValue.forEach((entry) => {
      for (const [key, value] of Object.entries(entry)) {
        const numericKey = Number(key); // แปลง key เป็นตัวเลข
        if (numericKey >= startKey) {
          // ถ้า key >= startKey ให้บวกค่า
          // result[key] = (result[key] || 0) + Number(value); // บวกค่าถ้ามีอยู่แล้ว หรือเริ่มต้นที่ 0
          result[key] = Math.round((result[key] || 0) + parseToNumber(value) * 1000) / 1000;
        }
      }
    });

    // console.log('result : ', result);

    return result;
  }

  sumKeys(entryValue: any[], startKey: number) {
    const result: Record<string, number> = {};

    entryValue.forEach((entry) => {
      for (const [key, value] of Object.entries(entry)) {
        const numericKey = Number(key); // แปลง key เป็นตัวเลข
        if (numericKey >= startKey) {
          // ถ้า key >= startKey ให้บวกค่า
          // result[key] = (result[key] || 0) + parseToNumber(value); // บวกค่าถ้ามีอยู่แล้ว หรือเริ่มต้นที่ 0
          result[key] = Math.round((result[key] || 0) + parseToNumber(value) * 1000) / 1000; // บวกค่าถ้ามีอยู่แล้ว หรือเริ่มต้นที่ 0
        }
      }
    });

    return result;
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
    const endDateParsed = dayjs(endDate, 'DD/MM/YYYY').subtract(1, 'day'); // แปลง endDate
    const shadowPeriod = configEndDate.add(shadow_period, unit); // คำนวณ shadowDate

    // เงื่อนไขที่ 1: endDate เท่ากับ configEnd และไม่เกิน shadowPeriod
    if (
      endDateParsed.isSame(configEndDate, 'day') ||
      endDateParsed.isBefore(shadowPeriod, 'day')
    ) {
      console.log('*1');
      // throw new HttpException(
      //   {
      //     status: HttpStatus.BAD_REQUEST,
      //     error: 'ไม่ตรงกับ เงื่อนไข shadow time or shadow period',
      //   },
      //   HttpStatus.BAD_REQUEST,
      // );
      return true;
    }

    // เงื่อนไขที่ : endDate ต้องไม่หลัง configEnd
    if (!endDateParsed.isBefore(configEndDate)) {
      console.log('*2');
      // console.log(
      //   '1 : ',
      //   endDateParsed.isSame(configEndDate, 'day') ||
      //     endDateParsed.isBefore(shadowPeriod, 'day'),
      // );
      // console.log('2 : ', !endDateParsed.isBefore(configEndDate));
      // console.log('configEnd : ', configEnd);
      // console.log('endDate : ', endDate);
      // console.log('endDateParsed : ', endDateParsed);
      // console.log('configEndDate : ', configEndDate);
      // console.log(
      //   'endDateParsed : ',
      //   dayjs(endDateParsed).format('DD/MM/YYYY'),
      // );
      // console.log(
      //   'configEndDate : ',
      //   dayjs(configEndDate).format('DD/MM/YYYY'),
      // );
      // throw new HttpException(
      //   {
      //     status: HttpStatus.BAD_REQUEST,
      //     error: 'ไม่ตรงกับ เงื่อนไข shadow time or shadow period',
      //   },
      //   HttpStatus.BAD_REQUEST,
      // );
      return false;
    }

    // เงื่อนไขที่ : endDate ต้องอยู่ระหว่าง shadowDate ถึง configEnd
    if (endDateParsed.isSameOrAfter(shadowDate, 'day')) {
      console.log('*3');
      // throw new HttpException(
      //   {
      //     status: HttpStatus.BAD_REQUEST,
      //     error: 'ไม่ตรงกับ เงื่อนไข shadow time or shadow period',
      //   },
      //   HttpStatus.BAD_REQUEST,
      // );
      return false;
    }

    // เงื่อนไขที่ : endDate อยู่ก่อน shadowDate แต่ต้องไม่น้อยกว่า configStart
    if (endDateParsed.isSameOrAfter(configStartDate, 'day')) {
      console.log('*4');
      // throw new HttpException(
      //   {
      //     status: HttpStatus.BAD_REQUEST,
      //     error: 'ไม่ตรงกับ เงื่อนไข shadow time or shadow period',
      //   },
      //   HttpStatus.BAD_REQUEST,
      // );
      return true;
    }

    // นอกเหนือจากนี้
    return false;
  };

  transformDataArrNew(data: any[]): string[][] {
    if (!data || !Array.isArray(data)) return [];
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

  extendDates(data, shadowPeriod, type) {
    if (!data || data.length === 0) return [];
    const clonedData = this.safeParseJSON(JSON.stringify(data));

    // หาวันที่มากที่สุดในข้อมูลเดิม
    const maxDate = dayjs(data[data.length - 1].date);
    // หาค่า value ของวันที่มากที่สุด
    const maxValue = data[data.length - 1].value;

    if (Number(type) === 1) {
      let newDate = maxDate;
      let i = 1;
      // console.log('------> : ', newDate);
      // while (newDate.isSameOrBefore(newMax)) {
      while (newDate.isBefore(Number(shadowPeriod))) {
        newDate = maxDate.add(i, 'day');
        clonedData.push({
          date: newDate.format('YYYY-MM-DD'),
          value: maxValue,
        });
        i++;
      }

      return clonedData; // คืนค่า clonedData ที่แก้ไขแล้ว
    } else {
      const newMax = maxDate.add(shadowPeriod, 'month');
      let newDate = maxDate;
      let i = 1;
      // console.log('------> : ', newDate);
      // while (newDate.isSameOrBefore(newMax)) {
      while (newDate.isBefore(newMax)) {
        newDate = maxDate.add(i, 'day');
        clonedData.push({
          date: newDate.format('YYYY-MM-DD'),
          value: maxValue,
        });
        i++;
      }

      return clonedData; // คืนค่า clonedData ที่แก้ไขแล้ว
    }
  }

  async uploadDateCapacityDate(updates: any) {
    if (!updates || !Array.isArray(updates)) return false;
    //   const batchSize = 100;

    // for (let i = 0; i < updates.length; i += batchSize) {
    //   const batchUpdates = updates.slice(i, i + batchSize);

    //   const caseStatements = {
    //     value: '',
    //     value_adjust: '',
    //     value_adjust_use: '',
    //   };

    //   const idList = batchUpdates
    //     .map((update) => `'${update.where.id}'`)
    //     .join(', ');

    //   batchUpdates.forEach((update) => {
    //     if (!!update.data.value || update.data.value !== "NaN") {
    //       caseStatements.value += `WHEN '${update.where.id}' THEN '${update.data.value}' `;
    //     }
    //     if (!!update.data.value_adjust || update.data.value_adjust !== "NaN") {
    //       caseStatements.value_adjust += `WHEN '${update.where.id}' THEN '${update.data.value_adjust}' `;
    //     }
    //     if (!!update.data.value_adjust_use || update.data.value_adjust_use !== "NaN") {
    //       caseStatements.value_adjust_use += `WHEN '${update.where.id}' THEN '${update.data.value_adjust_use}' `;
    //     }
    //   });

    //   const sql = `
    //     UPDATE capacity_publication_date
    //     SET
    //       value = CASE id ${caseStatements.value} ELSE value END,
    //       value_adjust = CASE id ${caseStatements.value_adjust} ELSE value_adjust END,
    //       value_adjust_use = CASE id ${caseStatements.value_adjust_use} ELSE value_adjust_use END
    //     WHERE id IN (${idList});
    //   `;

    //   // console.log('sql : ', sql);

    //   await this.prisma.$executeRawUnsafe(sql);
    // }

    // -----
    // console.log('updates : ', updates);

    //   const batchSize = 5000; // เพิ่ม Batch Size ให้เหมาะสม

    // for (let i = 0; i < updates.length; i += batchSize) {
    //   const batchUpdates = updates.slice(i, i + batchSize);

    //   const values = batchUpdates.map(update =>
    //     Prisma.sql`(${Prisma.raw(update.where.id)}, ${Prisma.raw(update.data.value || null)}, ${Prisma.raw(update.data.value_adjust || null)}, ${Prisma.raw(update.data.value_adjust_use || null)})`
    //   );

    //   const sqlString = `
    //     INSERT INTO capacity_publication_date (id, value, value_adjust, value_adjust_use)
    //     VALUES ${values.map(v => `(${v.where.id}, '${v.data.value || null}', '${v.data.value_adjust || null}', '${v.data.value_adjust_use || null}')`).join(", ")}
    //     ON CONFLICT (id) DO UPDATE SET
    //       value = EXCLUDED.value,
    //       value_adjust = EXCLUDED.value_adjust,
    //       value_adjust_use = EXCLUDED.value_adjust_use;
    //   `;

    //   await this.prisma.$executeRawUnsafe(sqlString);
    // }

    // await this.prisma.$transaction(
    //   updates.map((update) =>
    //     this.prisma.capacity_publication_date.update(update),
    //   ),
    // );

    // const batchSize = 1000; // กำหนดขนาด batch
    //   for (let i = 0; i < updates.length; i += batchSize) {
    //     const batchUpdates = updates.slice(i, i + batchSize);

    //     await this.prisma.$transaction(
    //       batchUpdates.map(update =>
    //         this.prisma.capacity_publication_date.updateMany({
    //           where: { id: update.where.id },
    //           data: update.data,
    //         }),
    //       ),
    //     );

    //   }
    // console.log('updates : ', updates);
    await this.prisma.$transaction(
      updates.map((update) =>
        this.prisma.capacity_publication_date.updateMany({
          where: { id: update.where.id },
          data: update.data,
        }),
      ),
    );

    return true;
  }

  pickByDate(arr: any, dateStr: any /* 'DD/MM/YYYY' */) {
    const target = dayjs(dateStr, 'DD/MM/YYYY', true).startOf('day');
    if (!target.isValid()) throw new Error('Invalid date');

    let best = null;
    let bestTs = -Infinity;
    const targetTs = target.valueOf();

    for (const item of arr) {
      if (!item?.start_date) continue;
      const s = dayjs(item.start_date).startOf('day');
      if (!s.isValid()) continue;

      const ts = s.valueOf();

      // เจอวันตรงกัน เป๊ะ ก็จบเลย
      if (ts === targetTs) return item;

      // เก็บตัวที่ไม่เกินวันเป้า และ "ล่าสุด" (ค่า ts มากที่สุดแต่ < เป้า)
      if (ts < targetTs && ts > bestTs) {
        bestTs = ts;
        best = item;
      }
    }
    return best; // อาจเป็น null ถ้าไม่มีตัวที่ <= วันเป้า
  }

  findNearestAfter(configs: any, startDate: any) {
    const target = dayjs(startDate).startOf('day');

    // คัดเฉพาะที่มากกว่า แล้วเรียงจากน้อยไปมาก เอาตัวแรก
    const next = configs
      .filter((c) => dayjs(c.start_date).startOf('day').isAfter(target)) // เงื่อนไข "มากกว่า"
      .sort((a, b) => dayjs(a.start_date).diff(dayjs(b.start_date)))[0];

    return next ?? null; // ถ้าไม่มีที่มากกว่าเลย ให้ได้ null
  }

  async middleBooking(id: any, plus: boolean, specificVersionId: number | null = null, newTerminateDate?: any) {
    // console.log('middleBooking id : ', id);
    // console.log('middleBooking plus : ', plus);
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const nowDates = getTodayNowAdd7().toDate();

    // -----

    console.log('middleBooking G1 process...');
    console.time('middleBooking G1');
    const fCPn = await this.capacityPublicationDateAll();
    console.timeEnd('middleBooking G1');

    let specificVersion = undefined;
    if (specificVersionId) {
      specificVersion = await this.prisma.booking_version.findFirst({
        where: {
          // contract_code_id: Number(specificVersionId),
          id: Number(specificVersionId),
        },
        include: {
          booking_row_json: true,
          booking_full_json: true,
          contract_code: true,
        },
      });
    }

    const contractCodePeriod = await this.prisma.contract_code.findFirst({
      where: { id: Number(id) },
      select: {
        contract_end_date: true,
        terminate_date: true,
        shadow_period: true,
        booking_version: {
          where: {
            contract_code_id: Number(id),
            flag_use: true,
          },
          include: {
            booking_row_json: true,
            booking_full_json: true,
          },
          orderBy: { id: 'desc' },
        },
      },
    });
    const contractPointAPI = await this.prisma.contract_point.findMany({
      where: {
        AND: [
          {
            contract_point_start_date: {
              lte: todayEnd, // start_date ต้องก่อนหรือเท่ากับสิ้นสุดวันนี้
            },
          },
          {
            OR: [
              { contract_point_end_date: null }, // ถ้า end_date เป็น null
              { contract_point_end_date: { gte: todayStart } }, // ถ้า end_date ไม่เป็น null ต้องหลังหรือเท่ากับเริ่มต้นวันนี้
            ],
          },
        ],
      },
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
    const areaDataArr = await this.prisma.area.findMany({
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
        name: true,
        area_nominal_capacity: true,
        entry_exit_id: true,
      },
    });
    const pathManagementArr = await this.prisma.path_management.findMany({
      where: {},
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
          where: {
            flag_use: true,
          },
        },
      },
      orderBy: {
        start_date: 'asc',
      },
    });

    console.log('middleBooking G2 process...');
    console.time('middleBooking G2');
    const npathManagementArr = pathManagementArr?.map((p: any) => {
      const { path_management_config, ...nP } = p;
      const npath_management_config = path_management_config.map((e: any) => {
        return {
          ...e,
          temps: this.safeParseJSON(e['temps']),
        };
      });
      // console.log('--------- npath_management_config : ', npath_management_config);
      const npathConfig = npath_management_config.map((e: any) => {
        const findId = e?.temps?.revised_capacity_path?.find((f: any) => {
          return f?.area?.entry_exit_id === 1;
        });

        const findExit = e?.temps?.revised_capacity_path?.map((tp: any) => {
          return {
            ...tp,
            source_id:
              e?.temps?.revised_capacity_path_edges?.find(
                (f: any) => f?.target_id === tp?.area?.id,
              )?.source_id || null,
          };
        });
        return {
          ...e,
          entryId: findId?.area?.id,
          entryName: findId?.area?.name,
          findExit,
        };
      });

      return {
        ...nP,
        path_management_config: npath_management_config,
        pathConfig: npathConfig || [],
      };
    });
    console.timeEnd('middleBooking G2');

    console.log('middleBooking G3 process...');
    console.time('middleBooking G3');
    if (npathManagementArr.length <= 0) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: `Default Capacity Path not found. Please set the default capacity path before confirming or approving.
`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    console.timeEnd('middleBooking G3');

    console.log('middleBooking G3.1 process...');
    console.time('middleBooking G3.1');
    // const getData = await this.bookingVersion(Number(id));
    console.log('contractCodePeriod : ', contractCodePeriod);
    console.log('specificVersion : ', specificVersion);
    const getData = specificVersion ?? contractCodePeriod?.['booking_version']?.[0]
    console.timeEnd('middleBooking G3.1');

    console.log('middleBooking G4 process...');
    console.time('middleBooking G4');
    const dataRow = getData?.['booking_row_json'] || [];
    const dataFull = this.safeParseJSON(getData?.['booking_full_json']?.[0]?.data_temp);
    const tempType = dataFull?.shipperInfo?.['1']?.['Type of Contract'];
    const contractType = this.typeOfContractTextToNum(tempType);
    const { bookingTemplate, modeDayAndMonth, file_period_mode } =
      await this.bookingTemplate(Number(contractType));

    const dailyBooking =
      dataFull?.['headerEntry']?.['Capacity Daily Booking (MMBTU/d)'];
    const shipperName = dataFull?.shipperInfo?.[0]?.['Shipper Name'] || null;
    const getGroupByName = await this.getGroupByName(shipperName);
    console.timeEnd('middleBooking G4');

    console.log('middleBooking G5 process...');
    console.time('middleBooking G5');
    const nkeys = Object.keys(dailyBooking)
      .filter((date) => dailyBooking[date]?.key) // กรองเฉพาะที่เป็นวันที่และมี key
      .map((date) => ({
        key: Number(dailyBooking[date].key), // แปลง key เป็นตัวเลข
        date: date, // ใช้ date เป็นค่า
      }))
      .sort((a, b) => a.key - b.key); // เรียงลำดับตาม key
    console.timeEnd('middleBooking G5');

    // console.log('nkeys : ', nkeys);
    // console.log('npathManagementArr : ', npathManagementArr);

    console.log('middleBooking G6 process...');
    console.time('middleBooking G6');
    const keys = nkeys?.map((d: any) => {
      const config = this.pickByDate(npathManagementArr, d?.date);
      const fNextConfig = this.findNearestAfter(
        npathManagementArr,
        config?.start_date,
      )?.start_date;
      const nconfig = { ...config, stopDate: fNextConfig || null };
      return {
        ...d,
        config: nconfig || null,
      };
    });
    // console.log('keys : ', keys);
    console.timeEnd('middleBooking G6');

    console.log('middleBooking G7 process...');
    console.time('middleBooking G7');
    const entryUse = dataRow.filter((f: any) => {
      return f?.entry_exit_id === 1;
    });

    const exitUse = dataRow.filter((f: any) => {
      return f?.entry_exit_id === 2;
    });
    console.timeEnd('middleBooking G7');

    const entryData: any = [];
    const exitData: any = [];

    console.log('middleBooking G8 process...');
    console.time('middleBooking G8');
    for (let i = 0; i < entryUse.length; i++) {
      const contractPoint = contractPointAPI.find((fNe: any) => {
        return fNe?.contract_point === this.safeParseJSON(entryUse[i]?.data_temp)?.['0'];
      });
      if (
        !contractPoint?.contract_point ||
        !contractPoint?.zone?.name ||
        !contractPoint?.area?.name
      ) {
        console.log('1 : Point is NOT match.');
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Point is NOT match.',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else {
        const fSP = getGroupByName?.shipper_contract_point.find((fSp: any) => {
          return (
            fSp?.contract_point?.contract_point ===
            contractPoint?.contract_point
          );
        });
        if (!fSP) {
          // console.log('getGroupByName : ', getGroupByName);
          // console.log('contractPoint : ', contractPoint?.contract_point);
          console.log('2 : Point is NOT match.');
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        entryUse[i].data_temp = this.safeParseJSON(entryUse[i].data_temp);
        entryData.push({
          contract_point: contractPoint?.contract_point,
          entry_exit_id: contractPoint?.entry_exit_id,
          zone_id: contractPoint?.zone?.id,
          zone: contractPoint?.zone?.name,
          area_id: contractPoint?.area?.id,
          area: contractPoint?.area?.name,
          area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
          entryUse: entryUse[i],
          // exitUse: entryUse[i],
        });
        // exitData.push({
        //   contract_point: contractPoint?.contract_point,
        //   entry_exit_id: contractPoint?.entry_exit_id,
        //   zone_id: contractPoint?.zone?.id,
        //   zone: contractPoint?.zone?.name,
        //   area_id: contractPoint?.area?.id,
        //   area: contractPoint?.area?.name,
        //   area_nominal_capacity: contractPoint?.area?.area_nominal_capacity,
        //   exitUse: entryUse[i],
        // });
      }
    }


    for (let i = 0; i < exitUse.length; i++) {
      const contractPoint = contractPointAPI.find((fNe: any) => {
        return fNe?.contract_point === this.safeParseJSON(exitUse[i]?.data_temp)?.['0'];
      });

      if (
        !contractPoint?.contract_point ||
        !contractPoint?.zone?.name ||
        !contractPoint?.area?.name
      ) {
        console.log('3 : Point is NOT match.');
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Point is NOT match.',
          },
          HttpStatus.BAD_REQUEST,
        );
      } else {
        const fSP = getGroupByName?.shipper_contract_point.find((fSp: any) => {
          return (
            fSp?.contract_point?.contract_point ===
            contractPoint?.contract_point
          );
        });
        if (!fSP) {
          console.log('getGroupByName?.shipper_contract_point : ', getGroupByName?.shipper_contract_point);
          console.log('contractPoint?.contract_point : ', contractPoint?.contract_point);
          console.log('4 : Point is NOT match.');
          throw new HttpException(
            {
              status: HttpStatus.BAD_REQUEST,
              error: 'Point is NOT match.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }
        exitUse[i].data_temp = this.safeParseJSON(exitUse[i].data_temp);
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
    console.timeEnd('middleBooking G8');

    console.log('middleBooking G9 process...');
    console.time('middleBooking G9');
    const terminateDate = newTerminateDate ? dayjs(newTerminateDate).isValid() ? dayjs(newTerminateDate).toDate() : undefined : undefined
    const resultNewDataEntry = this.generateValueExtend(
      keys,
      dataFull?.entryValue,
      file_period_mode,
      contractCodePeriod.contract_end_date,
      terminateDate
    );

    const resultNewDataExit = this.generateValueExtend(
      keys,
      dataFull?.exitValue,
      file_period_mode,
      contractCodePeriod.contract_end_date,
      terminateDate
    );
    console.timeEnd('middleBooking G9');
    console.log('middleBooking G10 process...');
    console.time('middleBooking G10');
    const nmatchData = [...entryData, ...exitData].map((ex: any, ix: any) => {
      const valueEx = [...resultNewDataEntry, ...resultNewDataExit]?.find(
        (f: any) => f?.contractPoint === ex?.contract_point,
      );
      return { ...ex, valueEx: valueEx };
    });
    console.timeEnd('middleBooking G10');

    console.log('middleBooking G11 process...');
    console.time('middleBooking G11');
    const pnmatchData = nmatchData?.map((nd: any) => {
      const {
        area,
        area_id,
        area_nominal_capacity,
        contract_point,
        entry_exit_id,
        zone,
        zone_id,
        valueEx,
      } = nd;
      const ncg = valueEx?.data?.map((ng: any) => {
        const nconfig = ng?.config?.pathConfig?.find((fn: any) => {
          return fn?.exit_name_temp === area;
        });

        return {
          date: ng?.date,
          key: ng?.key,
          value: ng?.value,
          pathConfig: {
            id: ng?.config?.id,
            version: ng?.config?.version,
            start_date: ng?.config?.start_date,
            stopDate: ng?.config?.stopDate,
            config_master_path_id: nconfig?.config_master_path_id,
            config_master_path: nconfig?.config_master_path,
            findExit: nconfig?.findExit,
            path_id: nconfig?.id,
          },
        };
      });
      return {
        area,
        area_id,
        area_nominal_capacity,
        contract_point,
        entry_exit_id,
        zone,
        zone_id,
        configPathDate: ncg || [],
      };
    });
    console.timeEnd('middleBooking G11');

    const logWarning = [];

    console.log('middleBooking G12 process...');
    console.time('middleBooking G12');

    // 
    const { setDataUse, logWarnings } = await this.setDataUsed(
      nmatchData,
      areaDataArr,
      fCPn,
      contractCodePeriod,
      modeDayAndMonth,
      logWarning,
      plus,
    );
    console.timeEnd('middleBooking G12');

    console.log('****** setDataUse : ', setDataUse);
    let tsetDataUse = []
    if (terminateDate) {
      console.log('******* terminateDate Day : ', dayjs(terminateDate).format("YYYY-MM-DD"));
      tsetDataUse = setDataUse?.map((sd: any) => {
        const { resCalcNew, ...nSd } = sd
        const nresCalcNew = resCalcNew?.map((rCn: any) => {
          const { calcNew, ...nRCn } = rCn
          const fcalcNew = calcNew?.filter((f: any) => {
            return (
              dayjs(f?.date, "YYYY-MM-DD").isSameOrAfter(dayjs(terminateDate).format("YYYY-MM-DD"))
            )
          })
          return {
            ...nRCn,
            calcNew: fcalcNew
          }
        })

        return {
          ...nSd,
          resCalcNew: nresCalcNew
        }
      })

    } else {
      tsetDataUse = setDataUse
    }
    console.log('@@@@@@@@@ tsetDataUse : ', tsetDataUse);

    return {
      pnmatchData,
      setDataUse: tsetDataUse,
      logWarnings,
      oldsetDataUse: setDataUse
    };
  }

  async bookingTemplate(contractType: any) {
    const todayStart = getTodayStartAdd7().toDate();
    const todayEnd = getTodayEndAdd7().toDate();
    const bookingTemplate = await this.prisma.booking_template.findFirst({
      where: {
        term_type_id: Number(contractType),
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

    const modeDayAndMonth = bookingTemplate?.term_type_id === 4 ? 1 : 2;
    const file_period_mode = bookingTemplate?.file_period_mode; // 1 = วัน, 2 = เดือน, 3 = ปี

    return {
      bookingTemplate,
      modeDayAndMonth,
      file_period_mode,
    };
  }

  async bookingVersion(id: any) {
    const getData = await this.prisma.booking_version.findFirst({
      where: {
        contract_code_id: Number(id),
        flag_use: true,
      },
      include: {
        booking_row_json: true,
        booking_full_json: true,
      },
      orderBy: { id: 'desc' },
    });
    return getData;
  }

  generateValueExtend(keys: any, exitValue: any, file_period_mode: any, contract_end_date?: Date, terminate_date?: Date) {
    const contractEndDate = contract_end_date ? dayjs(contract_end_date) : undefined;
    const terminateDate = terminate_date ? dayjs(terminate_date) : undefined;
    return exitValue.map((values: any) => {
      const fromData = values['5'];
      const endData = values['6'];

      const data = keys.map((keyItem: any) => ({
        key: keyItem.key,
        date: keyItem.date,      // 'DD/MM/YYYY'
        config: keyItem?.config,
        value: values[keyItem.key]
          ? parseFloat(String(values[keyItem.key]).trim().replace(/,/g, ''))
          : null,
      }));

      // ใช้ Map เพื่อกันวันที่ซ้ำ (ให้ “ค่าจากคีย์ท้ายสุด” ทับของเดิม)
      const valueByDate = new Map<string, number | null>();

      for (let i = 0; i < data.length; i++) {
        const current = data[i];
        const next = data[i + 1] || { date: endData }; // ถ้าเป็นคีย์สุดท้าย

        let startDate = dayjs(current.date, 'DD/MM/YYYY');
        let endDate = dayjs(next.date, 'DD/MM/YYYY');

        // --- แก้ boundary ให้ชัด ---
        if (file_period_mode === 1 || file_period_mode === 2) {
          // รายวัน / รายเดือน -> ปิดช่วงแบบ exclusive ของวันเริ่มคีย์ถัดไป
          endDate = endDate.subtract(1, 'day');
        } else if (file_period_mode === 3) {
          if (next.key) {
            // รายปี แต่ไม่ใช่คีย์สุดท้าย -> ก็ต้อง exclusive เหมือนกัน
            endDate = endDate.subtract(1, 'day');
          } else {
            // คีย์สุดท้ายในรายปี -> ไปจนถึง endData (รวมวัน)
            endDate = dayjs(endData, 'DD/MM/YYYY');
          }
        }

        const fromDay = dayjs(fromData, 'DD/MM/YYYY');

        if (contractEndDate && (startDate.isAfter(contractEndDate) || startDate.isSame(contractEndDate))) {
          continue;
        }

        while (startDate.isBefore(endDate) || startDate.isSame(endDate)) {
          if (startDate.isSameOrAfter(fromDay)) {
            const iso = startDate.format('YYYY-MM-DD');
            // ค่าท้ายสุดจะทับของเดิมโดยอัตโนมัติ (กันเบิ้ล)
            if (terminateDate && (startDate.isAfter(terminateDate) || startDate.isSame(terminateDate))) {
              valueByDate.set(iso, 0);
            }
            else {
              valueByDate.set(iso, current.value);
            }
          }
          // เดินวันละ 1 เสมอ
          startDate = startDate.add(1, 'day');
        }
      }

      // แปลงกลับเป็นอาเรย์ (ลำดับจะคงตามการ insert; ถ้าต้องการเรียงชัวร์ก็ sort อีกชั้น)
      const valueExtend = Array.from(valueByDate.entries()).map(([date, value]) => ({ date, value }));

      return {
        contractPoint: values['0'],
        endData,
        data,
        valueExtend,
      };
    });
  }


  generateValueExtendFnET(keys: any, exitValue: any, file_period_mode: any) {
    if (!exitValue || !Array.isArray(exitValue)) {
      return [];
    }

    const result = exitValue.map((values: any) => {
      const endData = values['6'];
      const data = keys.map((keyItem: any) => ({
        key: keyItem.key,
        date: keyItem.date,
        config: keyItem?.config,
        value: values[keyItem.key] || null,
      }));

      const valueExtend: { date: string; value: any }[] = [];

      for (let i = 0; i < data.length; i++) {
        const current = data[i];
        const next = data[i + 1] || { date: endData };

        let startDate = dayjs(current.date, 'DD/MM/YYYY');
        let endDate = dayjs(next.date, 'DD/MM/YYYY');

        if (file_period_mode === 1 || file_period_mode === 2) {
          endDate = endDate.subtract(1, 'day');
        } else if (file_period_mode === 3 && !next.key) {
          endDate = endDate.subtract(1, 'day');
        }

        while (startDate.isBefore(endDate) || startDate.isSame(endDate)) {
          valueExtend.push({
            date: startDate.format('YYYY-MM-DD'),
            value: current.value,
          });

          if (
            file_period_mode === 1 ||
            file_period_mode === 2 ||
            file_period_mode === 3
          ) {
            startDate = startDate.add(1, 'day');
          }
        }
      }

      return {
        contractPoint: values['0'],
        endData,
        data,
        valueExtend,
      };
    });

    return result;
  }

  findActiveConfig(configs, dateStr /* 'DD/MM/YYYY' */, areaName: any) {
    const target = dayjs(dateStr, 'DD/MM/YYYY', true).startOf('day');
    if (!target.isValid()) throw new Error('Invalid date string');

    const matches = configs.filter((c) => {
      const start = dayjs(c?.config?.start_date).startOf('day');
      const stop = c?.config?.stopDate
        ? dayjs(c?.config?.stopDate).startOf('day')
        : null;

      // รวม start, ตัด stop
      const meetLower = target.isSame(start) || target.isAfter(start);
      const meetUpper = !stop || target.isBefore(stop);
      return meetLower && meetUpper;
    });
    const fmatches = matches?.filter((f: any) => {
      return f?.areaData?.find((fa: any) => fa?.name === areaName);
    });

    if (fmatches.length === 0) return null;

    return {
      matches: fmatches,
      a: fmatches.sort((a, b) =>
        dayjs(b.start_date).diff(dayjs(a.start_date)),
      )[0],
    };
  }

  isDateMatching(targetDate: any, dbDate: any) {
    return dbDate.find((entry) => {
      return dayjs(entry.date_day).format('YYYY-MM-DD') === targetDate;
    });
  }

  async processGenPublicData(setDataUse: any, plus?: any) {
    // plus true ให้ + คืนกลับของเดิม
    // period
    console.log('***setDataUse : ', setDataUse);
    const publicDataPre = []
    for (let upi = 0; upi < setDataUse.length; upi++) {
      for (let fCp = 0; fCp < setDataUse[upi]?.resCalcNew.length; fCp++) {
        const fCapacityPublication: any =
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
        // console.log('setDataUse[upi] : ', setDataUse[upi]);
        // console.log('setDataUse[upi]?.resCalcNew[fCp]?.area_id : ', setDataUse[upi]?.resCalcNew[fCp]?.area_id);
        // console.log('fCapacityPublication : ', fCapacityPublication);
        // 2045-09-25
        if (fCapacityPublication) {
          fCapacityPublication._dateMap = new Map();
          fCapacityPublication?.capacity_publication_date.forEach((entry) => {
            fCapacityPublication._dateMap.set(
              dayjs(entry.date_day).format('YYYY-MM-DD'),
              entry,
            );
          });

          // plus

          const batchUpdates = setDataUse[upi]?.resCalcNew[fCp]?.calcNew.map(
            (calc) => {
              const ckDateMatch = fCapacityPublication._dateMap.get(
                dayjs(calc.date).format('YYYY-MM-DD'),
              );

              // const find = publicDataPre?.find((f:any) => {
              //   return (
              //     f?.area_id === setDataUse[upi]?.resCalcNew[fCp]?.area_id &&
              //     f?.entry_exit_id === setDataUse[upi]?.resCalcNew[fCp]?.entry_exit_id &&
              //     f?.date_day === getTodayNowAdd7(
              //       setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.date,
              //     ).toDate() 
              //   )
              // })
              // let value = (find && find?.value || 0) + Number(setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.value ?? 0)
              // publicDataPre.push({
              //   area_id: setDataUse[upi]?.resCalcNew[fCp]?.area_id,
              //   entry_exit_id: setDataUse[upi]?.resCalcNew[fCp]?.entry_exit_id,
              //   value: String(value),
              //   date_day: getTodayNowAdd7(
              //     setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.date,
              //   ).toDate(),
              // });

              if (ckDateMatch) {
                const updateDataDC = { ...ckDateMatch };
                if (ckDateMatch?.value_adjust_use) {
                  updateDataDC.value_adjust_use = plus ? String(Number(ckDateMatch?.value_adjust_use ?? 0) + Number(calc.value_adjust_use)) : String(Number(ckDateMatch?.value_adjust_use ?? 0) - Number(calc.value));
                  // updateDataDC.value_adjust_use = String(calc.cals);
                } else if (ckDateMatch?.value_adjust) {
                  updateDataDC.value_adjust = plus ? String(Number(ckDateMatch?.value_adjust ?? 0) + Number(calc.value_adjust)) : String(Number(ckDateMatch?.value_adjust ?? 0) - Number(calc.value));
                  // updateDataDC.value_adjust = plus ? String(Number(ckDateMatch?.value_adjust ?? 0) + Number(calc.value_adjust)) : String(Number(ckDateMatch?.value_adjust ?? 0) - Number(calc.value));
                  // updateDataDC.value_adjust_use = String(calc.cals);
                } else if (ckDateMatch?.value) {
                  updateDataDC.value = plus ? String(Number(ckDateMatch?.value ?? 0) + Number(calc.value)) : String(Number(ckDateMatch?.value ?? 0) - Number(calc.value));
                  // updateDataDC.value = String(calc.cals);
                } else {
                  updateDataDC.value = String(calc.cals);
                }

                return {
                  where: { id: Number(ckDateMatch.id) },
                  data: updateDataDC,
                };
              } else {
                return {
                  capacity_publication_id: fCapacityPublication?.id,
                  value: String(calc.cals),
                  date_day: getTodayNowAdd7(calc.date).toDate(),
                };
              }
            },
          );

          const updates = batchUpdates.filter((update) =>
            update.hasOwnProperty('where'),
          );
          const icpdData = batchUpdates.filter((insert) =>
            insert.hasOwnProperty('capacity_publication_id'),
          );

          if (updates.length > 0) {
            await this.prisma.capacity_publication_date.deleteMany({
              where: {
                id: {
                  in: updates.map((dc: any) => dc?.where?.id),
                },
              },
            });
            // ลบ top-level id และ id ที่ฝังอยู่ใน data
            const rows = (updates ?? [])
              .map((u: any) => {
                const { where, data } = u ?? {};
                if (!data) return null;

                // ตัด id (ทุก variation) ออกจาก data
                const { id, Id, ID, _id, ...rest } = data;
                return rest;
              })
              .filter(Boolean);

            await this.prisma.capacity_publication_date.createMany({
              data: rows,
              // skipDuplicates: true,
            });
          }

          if (icpdData.length > 0) {
            await this.prisma.capacity_publication_date.createMany({
              data: icpdData,
            });
          }
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
            // const find = publicDataPre?.find((f:any) => {
            //   return (
            //     f?.area_id === setDataUse[upi]?.resCalcNew[fCp]?.area_id &&
            //     f?.entry_exit_id === setDataUse[upi]?.resCalcNew[fCp]?.entry_exit_id &&
            //     f?.date_day === getTodayNowAdd7(
            //       setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.date,
            //     ).toDate() 
            //   )
            // })
            // let value = (find && find?.value || 0) + Number(setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.value ?? 0)
            // publicDataPre.push({
            //   area_id: setDataUse[upi]?.resCalcNew[fCp]?.area_id,
            //   entry_exit_id: setDataUse[upi]?.resCalcNew[fCp]?.entry_exit_id,
            //   value: String(value),
            //   date_day: getTodayNowAdd7(
            //     setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.date,
            //   ).toDate(),
            // });

            icpdData.push({
              capacity_publication_id: createCP?.id,
              value: String(
                setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.cals,
              ),
              date_day: getTodayNowAdd7(
                setDataUse[upi]?.resCalcNew[fCp]?.calcNew[iCpD]?.date,
              ).toDate(),
            });
          }

          // console.log('2 icpdData : ', icpdData);

          await this.prisma.capacity_publication_date.createMany({
            data: icpdData,
          });
        }
      }
      // console.log('- - - - ');
    }

    // console.log('^^^publicDataPre : ', publicDataPre);
  }

  async capacityPublicationWarning(id: any, logWarning: any, userId: any) {
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

  async capacityPublicationDateAll() {
    return await this.prisma.capacity_publication.findMany({
      select: {
        id: true,
        capacity_publication_date: true,
        area_id: true,
      },
    });
  }

  // *
  async setDataUsed(
    nmatchData: any,
    areaDataArr: any,
    fCPn: any,
    contractCodePeriod: any,
    modeDayAndMonth: any,
    logWarning: any,
    plus?: boolean,
  ) {
    // console.log('===> nmatchData : ', nmatchData);
    // console.log('===> areaDataArr : ', areaDataArr);
    // console.log('===> fCPn : ', fCPn);
    // console.log('===> modeDayAndMonth : ', modeDayAndMonth);

    console.log('setDataUsed G1 process...');
    console.time('setDataUsed G1');
    // let nsetDataUseZero = await Promise.all(
    const onsetDataUseZero = nmatchData.map((sets: any, iset: number) => {
      const resCalcNew: any = [];

      if (sets?.entry_exit_id === 1) {
        // console.log('setDataUsed G1 Entry process...');
        // console.time('setDataUsed G1 Entry');
        // const setArrAreaData = areaDataArr?.filter((f:any) => f?.id === sets?.area_id )

        // for (let ical = 0; ical < setArrAreaData.length; ical++) {
        //   let calcNew: any = [];
        //   const fCapacityPublication = fCPn.find((ffC: any) => {
        //     return ffC?.area_id === Number(setArrAreaData[ical]?.id);
        //   });

        //   const resultPeriodAdd = this.extendDates(
        //     sets?.valueEx?.valueExtend,
        //     contractCodePeriod?.shadow_period,
        //     modeDayAndMonth,
        //   );

        //   for (let icalAr = 0; icalAr < resultPeriodAdd.length; icalAr++) {

        //       const ckDateMatch =
        //         (!!fCapacityPublication &&
        //           this.isDateMatching(
        //             resultPeriodAdd[icalAr]?.date,
        //             fCapacityPublication?.capacity_publication_date,
        //           )) ||
        //         false;
        //       let mainCalc = null;
        //       let adjust = null;
        //       let adjustType = null;

        //       if (ckDateMatch) {
        //         if (!!ckDateMatch?.value_adjust_use) {
        //           adjustType = 'value_adjust_use';
        //           mainCalc = Number(ckDateMatch?.value_adjust_use);
        //           adjust = Number(ckDateMatch?.value_adjust_use);
        //         } else if (!!ckDateMatch?.value_adjust) {
        //           adjustType = 'value_adjust';
        //           mainCalc = Number(ckDateMatch?.value_adjust);
        //           adjust = Number(ckDateMatch?.value_adjust);
        //         } else if (!!ckDateMatch?.value) {
        //           adjustType = 'value';
        //           mainCalc = Number(ckDateMatch?.value);
        //           adjust = Number(ckDateMatch?.value);
        //         } else {
        //           adjustType = null;
        //           mainCalc = Number(
        //             setArrAreaData[ical]?.area_nominal_capacity,
        //           );
        //           adjust = Number(setArrAreaData[ical]?.area_nominal_capacity);
        //         }
        //       } else {
        //         adjustType = null;
        //         mainCalc = Number(setArrAreaData[ical]?.area_nominal_capacity);
        //         adjust = null;
        //       }

        //       let cals = plus
        //         ? mainCalc + Number(resultPeriodAdd[icalAr]?.value)
        //         : mainCalc - Number(resultPeriodAdd[icalAr]?.value);

        //       let ck_comparea = true;

        //       ck_comparea =
        //         icalAr === 0
        //           ? true
        //           : resultPeriodAdd[icalAr]?.value ===
        //               resultPeriodAdd[icalAr - 1]?.value
        //             ? true
        //             : false;
        //       calcNew.push({
        //         ...resultPeriodAdd[icalAr],
        //         cals: cals,
        //         ck_comparea: ck_comparea,
        //         adjust: adjust,
        //         adjustType: adjustType,
        //         config: null,
        //       });
        //   }

        //   resCalcNew.push({
        //     area_nominal_capacity: Number(
        //       setArrAreaData[ical]?.area_nominal_capacity,
        //     ),
        //     area_id: Number(setArrAreaData[ical]?.id),
        //     area_name: setArrAreaData[ical]?.name,
        //     calcNew: calcNew || [],
        //     entry_exit_id: setArrAreaData[ical]?.entry_exit_id,
        //     exitTemp: {
        //       id: sets?.exit_id_temp,
        //       name: sets?.exit_name_temp,
        //     },
        //   });
        // }

        // console.timeEnd('setDataUsed G1 Entry');

        console.log('sets?.area : ', sets?.area);

        // ======= FAST DROP-IN: G1 Entry (แทนทั้งบล็อคเดิม) =======

        // 1) PRE-INDEX (ทำครั้งเดียวต่อการเรียก; ถ้าเรียกบ่อยให้ย้ายไป cache ภายนอก)
        const areaById = new Map<number, any>(
          (areaDataArr ?? []).map((a: any) => [Number(a?.id), a]),
        );

        // fCPn: [{ area_id, capacity_publication_date: [{ date:'YYYY-MM-DD', value, value_adjust, ...}, ...] }, ...]
        const pubByAreaDate: Map<number, Map<string, any>> = (() => {
          const m = new Map<number, Map<string, any>>();
          for (const r of fCPn ?? []) {
            const aid = Number(r?.area_id);
            let mm = m.get(aid);
            if (!mm) {
              mm = new Map<string, any>();
              m.set(aid, mm);
            }
            for (const d of r?.capacity_publication_date ?? []) {
              // ถ้ามีซ้ำวันเดียวกัน ให้ “อันหลังทับอันก่อน” = latest-of-day
              mm.set(dayjs(d?.date_day).format('YYYY-MM-DD'), d);
            }
          }
          return m;
        })();

        const monthKeyFromYYYYMMDD = (s: string) => s?.slice(0, 7) as string; // 'YYYY-MM'

        const pubByAreaMonth = new Map<number, Map<string, any>>();
        for (const r of fCPn ?? []) {
          const aId = Number(r?.area_id);
          if (!pubByAreaMonth.has(aId)) pubByAreaMonth.set(aId, new Map());
          const mm = pubByAreaMonth.get(aId)!;

          for (const d of r?.capacity_publication_date ?? []) {
            // NOTE: ถ้าเดิม isDateMatching มีเงื่อนไขพิเศษ (เช่น เลือกอันล่าสุดในเดือน)
            // ให้ปรับ logic ที่นี่ ตอน set ค่าใน monthMap
            const mk = monthKeyFromYYYYMMDD(dayjs(d?.date_day).format('YYYY-MM')); // d.date = 'YYYY-MM-DD'
            mm.set(mk, d); // อันหลังทับอันหน้า = เทียบเท่า "ล่าสุดในเดือน"
          }
        }
        // helper: O(1) ดึงประกาศปรับรายวัน (ตรงกับ isDateMatching ของเดิม)
        // const matchAdjustDate = (areaId: number, isoDate: string) => {
        //   return pubByAreaDate.get(areaId)?.get(dayjs(isoDate).format('YYYY-MM-DD')) ?? null
        // };

        const matchAdjust = (areaId: number, mk: string) => pubByAreaMonth.get(areaId)?.get(mk) ?? null;



        console.log('setDataUsed G1 Entry process...');
        console.time('setDataUsed G1 Entry');

        // iset

        // 2) หา area ตรง ๆ แบบ O(1) (เดิม filter แล้วลูป ทั้งที่มีแค่ id เดียว)
        const area = areaById.get(Number(sets?.area_id));
        if (area) {
          const areaId = Number(area?.id);
          const areaCap = Number(area?.area_nominal_capacity) || 0;
          const entryExitId = area?.entry_exit_id;

          // 3) คำนวณช่วงเวลา “ครั้งเดียว” และเตรียม number ไว้เลย
          const resultPeriodAdd =
            this.extendDates(
              sets?.valueEx?.valueExtend,
              contractCodePeriod?.shadow_period,
              modeDayAndMonth,
            ) ?? [];

          const periods = resultPeriodAdd.map((p: any) => ({
            ...p,
            mk: monthKeyFromYYYYMMDD(p?.date), // 'YYYY-MM' จาก 'YYYY-MM-DD'
            valueN: Number(p?.value) || 0, // แปลงเป็น number ไว้เลย
          }));

          const dateEndExcel = sets?.valueEx?.valueExtend[sets?.valueEx?.valueExtend.length - 1]?.date
          // เตรียมอาร์เรย์ผลลัพธ์ล่วงหน้า (ลด push/spread)
          const calcNew: any[] = new Array(periods.length);
          console.log('calcNew : ', calcNew);
          let prevVal: number | undefined;

          for (let i = 0; i < periods.length; i++) {
            const rp = periods[i];
            const isoDate = rp?.date as string; // 'YYYY-MM-DD'
            const v = Number(rp?.value) || 0;

            // 4) ปรับตามประกาศแบบ O(1)
            // const m = matchAdjustDate(areaId, isoDate);
            const m = matchAdjust(areaId, rp.mk);

            let mainCalc = areaCap;
            let adjust: number | null = null;
            let adjustType: string | null = null;

            if (m) {
              if (m?.value_adjust_use != null) {
                adjustType = 'value_adjust_use';
                mainCalc = Number(m.value_adjust_use);
                adjust = mainCalc;
              } else if (m?.value_adjust != null) {
                adjustType = 'value_adjust';
                mainCalc = Number(m.value_adjust);
                adjust = mainCalc;
              } else if (m?.value != null) {
                adjustType = 'value';
                mainCalc = Number(m.value);
                adjust = mainCalc;
              }
              // else: คง areaCap
            }


            const cals = plus ? mainCalc + v : mainCalc - v;

            // if(i <= 2){
            //   console.log('ENTRY ################################');
            //   console.log('areaId : ', areaId);
            //   console.log('rp.mk : ', rp.mk);
            //   console.log('plus : ', plus);
            //   console.log('v : ', v);
            //   console.log('m : ', m);
            //   console.log('dateEndExcel : ', dateEndExcel);
            //   console.log('isoDate : ', isoDate);
            //   console.log('adjustType : ', adjustType);
            //   console.log('cals : ', cals);
            //   console.log('adjust : ', adjust);
            //   console.log(' - - - - - - ');
            // }
            const ck_comparea = i === 0 ? true : v === (prevVal ?? v);
            prevVal = v;

            // if(dayjs(dateEndExcel).isSameOrAfter(dayjs(isoDate))){
            // เขียน object แบบกำหนด field ชัด ๆ (เบากว่า spread ใน hot loop)
            calcNew[i] = {
              date: isoDate,
              value: rp?.value, // เก็บค่าเดิมไว้ถ้าต้องการชนิดเดิม
              cals,
              ck_comparea,
              adjust,
              adjustType,
              config: null,
            };
            // }
          }



          // 5) push ผลรวม (ไม่ต้องวน setArrAreaData อีก เพราะหา area ตรง ๆ แล้ว)
          resCalcNew.push({
            area_nominal_capacity: areaCap,
            area_id: areaId,
            area_name: area?.name,
            calcNew,
            entry_exit_id: entryExitId,
            exitTemp: { id: sets?.exit_id_temp, name: sets?.exit_name_temp },
          });
        }

        console.timeEnd('setDataUsed G1 Entry');
      } else {
        console.log('setDataUsed G1 Exit process...');
        console.time('setDataUsed G1 Exit');

        console.log('setDataUsed G1 Exit area process... ', iset);
        console.time('setDataUsed G1 Exit area');
        const pathAreaUsed1 = sets?.valueEx?.data?.map((vE: any) => {
          const npathConfig = vE?.config?.path_management_config?.find(
            (f: any) => {
              return f?.exit_name_temp === sets?.area;
            },
          );
          return {
            ...vE,
            ...npathConfig,
          };
        });

        const pathAreaUsed = pathAreaUsed1?.map((setsF: any) => {
          const path = setsF?.config_master_path?.revised_capacity_path?.map(
            (cmp: any) => {
              return cmp?.area?.id;
            },
          );

          const i = path.indexOf(setsF?.exit_id_temp);
          const uptoUsed = i >= 0 ? path.slice(0, i + 1)?.slice(1) : [];

          const areaData = areaDataArr?.filter((f: any) => {
            return uptoUsed?.includes(f?.id);
          });

          return {
            ...setsF,
            path: path || null,
            pathUsed: uptoUsed || null,
            areaData: areaData || [],
          };
        });
        console.timeEnd('setDataUsed G1 Exit area');


        console.log('setDataUsed G1 Exit areaAr Loop process...'); // ส่วนนี้ช้า
        console.time('setDataUsed G1 Exit areaAr Loop');
        // 0) helpers: คีย์เดือนจากสตริงวันที่ (เลี่ยง dayjs ในลูป)
        const monthKeyFromYYYYMMDD = (s: string) => s?.slice(0, 7) as string; // 'YYYY-MM'
        const monthKeyFromDDMMYYYY = (s: string) => {
          // 'DD/MM/YYYY' -> 'YYYY-MM'
          if (!s) return '';
          const [dd, mm, yyyy] = s.split('/');
          return `${yyyy}-${mm}`;
        };

        // 1) PRE-INDEX: ประกาศปรับ (capacity_publication_date) ต่อ area ต่อเดือน
        //    โครงสร้าง: Map<areaId, Map<'YYYY-MM', pubRecord>>
        const pubByAreaMonth = new Map<number, Map<string, any>>();
        for (const r of fCPn ?? []) {
          const aId = Number(r?.area_id);
          if (!pubByAreaMonth.has(aId)) pubByAreaMonth.set(aId, new Map());
          const mm = pubByAreaMonth.get(aId)!;

          for (const d of r?.capacity_publication_date ?? []) {
            // NOTE: ถ้าเดิม isDateMatching มีเงื่อนไขพิเศษ (เช่น เลือกอันล่าสุดในเดือน)
            // ให้ปรับ logic ที่นี่ ตอน set ค่าใน monthMap
            const mk = monthKeyFromYYYYMMDD(dayjs(d?.date_day).format('YYYY-MM')); // d.date = 'YYYY-MM-DD'
            mm.set(mk, d); // อันหลังทับอันหน้า = เทียบเท่า "ล่าสุดในเดือน"
          }
        }

        // helper: ดึง pubRecord รายเดือนแบบ O(1)
        const matchAdjust = (areaId: number, mk: string) =>
          pubByAreaMonth.get(areaId)?.get(mk) ?? null;

        // 2) PRE-INDEX: คอนฟิก path รายเดือน + ชุดชื่อพื้นที่รายเดือน (แทน findActiveConfig / findConfigDate)
        const pconfigByMonth = new Map<string, any>();
        const areaNameSetByMonth = new Map<string, Set<string>>();
        for (const pu of pathAreaUsed ?? []) {
          const mk = monthKeyFromDDMMYYYY(pu?.date); // pu.date = 'DD/MM/YYYY'
          pconfigByMonth.set(mk, pu);

          let nameSet = areaNameSetByMonth.get(mk);
          if (!nameSet) {
            nameSet = new Set<string>();
            areaNameSetByMonth.set(mk, nameSet);
          }
          for (const a of pu?.areaData ?? []) {
            if (a?.name) nameSet.add(a.name);
          }
        }

        // 3) รวมพื้นที่ที่จะใช้ (unique ตาม id) จาก pathAreaUsed
        const uniqAreasById = new Map<number, any>();
        for (const pu of pathAreaUsed ?? []) {
          for (const a of pu?.areaData ?? []) {
            if (a?.id != null) uniqAreasById.set(Number(a.id), a);
          }
        }
        const setArrAreaData: any[] = Array.from(uniqAreasById.values());

        // 4) คำนวณงวด/ช่วงเวลา ครั้งเดียวต่อ sets + เตรียมคีย์เดือน/ตัวเลขไว้ล่วงหน้า
        const resultPeriodAdd =
          this.extendDates(
            sets?.valueEx?.valueExtend,
            contractCodePeriod?.shadow_period,
            modeDayAndMonth,
          ) ?? [];

        // const dateEndExcel = monthKeyFromYYYYMMDD(sets?.valueEx?.valueExtend[sets?.valueEx?.valueExtend.length - 1]?.date)
        const dateEndExcel = sets?.valueEx?.valueExtend[sets?.valueEx?.valueExtend.length - 1]?.date

        const periods = resultPeriodAdd.map((p: any) => ({
          ...p,
          mk: monthKeyFromYYYYMMDD(p?.date), // 'YYYY-MM' จาก 'YYYY-MM-DD'
          valueN: Number(p?.value) || 0, // แปลงเป็น number ไว้เลย
        }));

        // 5) main loop (ทดแทนลูปเดิมทั้งหมด)
        const lastPathCfg =
          pathAreaUsed && pathAreaUsed.length > 0
            ? pathAreaUsed[pathAreaUsed.length - 1]
            : null;

        for (let ical = 0; ical < setArrAreaData.length; ical++) {
          const area = setArrAreaData[ical];
          const areaId = Number(area?.id);
          const areaCap = Number(area?.area_nominal_capacity) || 0;

          const calcNew: any[] = [];
          let prevVal: number | undefined;

          for (let i = 0; i < periods.length; i++) {
            const pd = periods[i];

            // แทน findActiveConfig + ckArea + findConfigDate ด้วย lookup O(1)
            const nameSet = areaNameSetByMonth.get(pd.mk);
            if (!nameSet || !nameSet.has(area?.name)) continue; // เดือนนี้ไม่มีพื้นที่นี้ในคอนฟิก → ข้าม

            // ปรับตามประกาศ (แทน isDateMatching ในลูป)...
            const m = matchAdjust(areaId, pd.mk);

            let mainCalc = areaCap;
            let adjust: number | null = null;
            let adjustType: string | null = null;

            if (m) {
              if (m?.value_adjust_use != null) {
                adjustType = 'value_adjust_use';
                mainCalc = Number(m.value_adjust_use);
                adjust = mainCalc;
              } else if (m?.value_adjust != null) {
                adjustType = 'value_adjust';
                mainCalc = Number(m.value_adjust);
                adjust = mainCalc;
              } else if (m?.value != null) {
                adjustType = 'value';
                mainCalc = Number(m.value);
                adjust = mainCalc;
              }
            }

            // calc ...
            const cals = plus ? mainCalc + pd.valueN : mainCalc - pd.valueN;

            if (cals <= 0) {
              logWarning.push(
                `${pd.date} | ${mainCalc} - ${pd.valueN} => calc 0 น้อยกว่า`,
              );
            }

            // if(i <= 2){
            //   console.log('EXIT ################################');
            //   console.log('areaId : ', areaId);
            //   console.log('pd.mk : ', pd.mk);
            //   console.log('plus : ', plus);
            //   console.log('v : ', pd.valueN);
            //   console.log('m : ', m);
            //   console.log('dateEndExcel : ', dateEndExcel);
            //   console.log('isoDate : ', pd?.date);
            //   console.log('adjustType : ', adjustType);
            //   console.log('cals : ', cals);
            //   console.log('adjust : ', adjust);
            //   console.log(' - - - - - - ');
            // }
            const ck_comparea =
              i === 0 ? true : pd.valueN === (prevVal ?? pd.valueN);
            prevVal = pd.valueN;

            // แทน findPconfig ด้วยคอนฟิกรายเดือน O(1) + fallback อันท้ายสุด
            const cfg = pconfigByMonth.get(pd.mk) ?? lastPathCfg;
            // date
            if (dayjs(dateEndExcel).isSameOrAfter(dayjs(pd?.date))) {
              calcNew.push({
                ...pd,
                cals,
                ck_comparea,
                adjust,
                adjustType,
                config: cfg,
              });
            }
          }

          resCalcNew.push({
            area_nominal_capacity: areaCap,
            area_id: areaId,
            area_name: area?.name,
            calcNew,
            entry_exit_id: area?.entry_exit_id,
            exitTemp: {
              id: sets?.exit_id_temp,
              name: sets?.exit_name_temp,
            },
          });
        }

        // ===== END FAST VERSION =====

        console.timeEnd('setDataUsed G1 Exit areaAr Loop');

        console.timeEnd('setDataUsed G1 Exit');
      }

      return { ...sets, resCalcNew: resCalcNew };
    });

    console.timeEnd('setDataUsed G1');

    console.log('##################################################');


    // console.log('G1 --> onsetDataUseZero : ', onsetDataUseZero);
    function dateRange(start: string, end: string, datas: any) {
      const s = dayjs(start).add(1, "day");
      const e = dayjs(end);
      const out: string[] = [];
      for (let d = s; !d.isAfter(e); d = d.add(1, "day")) {
        out.push({ ...datas, date: d.format("YYYY-MM-DD"), });
      }
      return out;
    }
    const nsetDataUseZero = onsetDataUseZero?.map((e: any) => {
      if (e?.entry_exit_id === 2) {
        const dateEndExcel = e?.valueEx?.valueExtend[e?.valueEx?.valueExtend.length - 1]?.date
        const resultPeriodAdd = this.extendDates(
          e?.valueEx?.valueExtend,
          contractCodePeriod?.shadow_period,
          modeDayAndMonth,
        ) ?? [];
        const extenDateEnd = resultPeriodAdd[resultPeriodAdd?.length - 1]?.date || null
        const { resCalcNew, ...nE } = e
        const _resCalcNew = resCalcNew?.map((eresCalcNew: any) => {

          const lastCalcEnd = eresCalcNew?.["calcNew"][eresCalcNew?.["calcNew"]?.length - 1]
          if (lastCalcEnd?.date === dateEndExcel && extenDateEnd) {
            const { calcNew, ...meresCalcNew } = eresCalcNew
            const daysExitExtend = dateRange(dateEndExcel, extenDateEnd, lastCalcEnd);
            const ncalcNew = [...calcNew, ...daysExitExtend,]
            // 
            return {
              ...meresCalcNew,
              calcNew: ncalcNew
            }
          } else {

            return eresCalcNew
          }
        })
        return {
          ...nE,
          resCalcNew: _resCalcNew,
        }
      } else {
        return e
      }
    })

    console.log('++__++n nsetDataUseZero : ', nsetDataUseZero);



    const resCalcNewMap = new Map();

    console.log('setDataUsed G2 process...');
    console.time('setDataUsed G2');
    for (const item of nsetDataUseZero) {
      const areaMap = new Map();
      for (const res of item.resCalcNew) {
        areaMap.set(res.area_name, res.calcNew);
      }
      resCalcNewMap.set(item.id, areaMap);
    }
    console.timeEnd('setDataUsed G2');

    // console.log('--- nsetDataUseZero : ', nsetDataUseZero);

    console.log('setDataUsed G3 process...');
    console.time('setDataUsed G3');
    const setDataUse = nsetDataUseZero.map((sd) => {
      const resCalcNewPala = sd.resCalcNew.map((sdc) => {
        const calcNewFinal = sdc.calcNew.map((c) => ({ ...c }));

        for (const [otherId, otherAreaMap] of resCalcNewMap) {
          if (otherId === sd.id) continue;

          const otherCalcNewArr = otherAreaMap.get(sdc.area_name);
          if (!otherCalcNewArr) continue;

          const otherCalcNewByDate = new Map();
          for (const item of otherCalcNewArr) {
            otherCalcNewByDate.set(item.date, item.value);
          }

          for (const c of calcNewFinal) {
            if (otherCalcNewByDate.has(c.date)) {
              c.cals = plus
                ? Number(c.cals || 0) +
                Number(otherCalcNewByDate.get(c.date) || 0)
                : Number(c.cals || 0) -
                Number(otherCalcNewByDate.get(c.date) || 0);
            }
          }
        }

        return { ...sdc, calcNew: calcNewFinal };
      });

      return { ...sd, resCalcNew: resCalcNewPala };
    });
    console.timeEnd('setDataUsed G3');

    console.log('#### --- setDataUse : ', setDataUse);

    return {
      setDataUse,
      logWarnings: logWarning,
    };
  }

  async genPathDetail(setDataUse: any, pnmatchData: any, id: any, userId: any) {
    console.log('setDataUse : ', setDataUse);
    console.log('pnmatchData : ', pnmatchData);
    console.log('id : ', id);
    // period

    console.log('path detail G1 process...');
    console.time('path detail G1');
    const versionLastUse = await this.prisma.booking_version.findFirst({
      where: {
        flag_use: true,
        contract_code_id: Number(id),
      },
    });
    console.timeEnd('path detail G1');

    const pathData = [];


    function assignNestedPeriodsOLDS(data: any[]) {
      const monthKeyFromISO = (s: string) => (s ? s.slice(0, 7) : '');
      const monthKeyFromDDMY = (s: string) => {
        if (!s) return '';
        const dd = s.slice(0, 2), mm = s.slice(3, 5), yyyy = s.slice(6, 10);
        return `${yyyy}-${mm}`;
      };
      const getNum = (x: any) => {
        const v = x?.cals ?? x?.value ?? 0;
        const n = Number(String(v).replace(/,/g, '').trim());
        return Number.isFinite(n) ? n : 0;
      };

      // helper: เลือก key ของ path (กันซ้ำด้วยตัวนี้)
      const getPathKey = (pc: any) => String(pc?.config_master_path_id ?? pc?.path_id ?? '');

      // ---- กันซ้ำ: จำว่าใน period X เคย push pathKey ไหนแล้วบ้าง ----
      const pushedByPeriod = new Map<number, Set<string>>();
      const pushPathOnce = (period: number, pc: any, makeSlim: (pc: any) => any) => {
        const key = getPathKey(pc);
        if (!key) return;
        let set = pushedByPeriod.get(period);
        if (!set) { set = new Set<string>(); pushedByPeriod.set(period, set); }
        if (set.has(key)) return;          // เคย push ไปแล้วใน period นี้ -> ข้าม
        set.add(key);
        pathData.push({ period, pathConfig: makeSlim(pc) });
      };

      // --- helper ทำ slim ---
      const makeSlim = (pc: any) => {
        const out: any = { ...pc };
        if (Array.isArray(pc?.findExit)) {
          out.findExit = pc.findExit.map((pF: any) => ({
            id: pF?.id,
            config_master_path_id: pF?.config_master_path_id,
            revised_capacity_path_type_id: pF?.revised_capacity_path_type_id,
            source_id: pF?.source_id ?? null,
            area: {
              id: pF?.area?.id,
              name: pF?.area?.name,
              area_nominal_capacity: pF?.area?.area_nominal_capacity,
              zone_id: pF?.area?.zone_id,
              entry_exit_id: pF?.area?.entry_exit_id,
              supply_reference_quality_area: pF?.area?.supply_reference_quality_area,
              color: pF?.area?.color,
            },
          }));
        }
        delete out.config_master_path;
        return out;
      };

      // === base period per month (จาก path version) ===
      const monthPeriodBase = new Map<string, number>();
      const prevSigByArea = new Map<string, string>();
      let basePeriodCounter = 0;

      // รวมเดือนทั้งหมดจาก pnmatchData แล้วเรียง
      const monthSet = new Set<string>();
      for (const a of (pnmatchData ?? [])) {
        for (const c of a?.configPathDate ?? []) {
          const mk = monthKeyFromDDMY(c?.date);
          if (mk) monthSet.add(mk);
        }
      }
      const monthsSorted = Array.from(monthSet).sort(); // 'YYYY-MM'

      // ★★ 0) ตั้ง BASELINE period 0 จากเดือนแรก (แต่ "ไม่รวม" path ซ้ำ) ★★
      const firstMonth = monthsSorted[0];
      if (firstMonth) {
        for (const a of (pnmatchData ?? [])) {
          const c = (a?.configPathDate ?? []).find(
            (x: any) => monthKeyFromDDMY(x?.date) === firstMonth
          );
          if (!c) continue;
          const pc = c?.pathConfig;

          // เซ็ต signature เริ่มต้นของ area นี้
          const sig = [(pc?.path_id ?? ''), (pc?.value ?? ''), (c?.value ?? '')].join('|');
          prevSigByArea.set(a?.area, sig);

          // push baseline period 0 : กันซ้ำด้วย pushPathOnce
          if (pc && pc?.config_master_path_id) {
            pushPathOnce(0, pc, makeSlim);
          }
        }
        monthPeriodBase.set(firstMonth, 0);
      }

      // 1) เดินตั้งแต่เดือนที่ 2 เป็นต้นไป เพื่อตรวจการเปลี่ยน version → period 1,2,...
      for (let i = 1; i < monthsSorted.length; i++) {
        const mk = monthsSorted[i];
        let changedThisMonth = false;

        for (const a of (pnmatchData ?? [])) {
          const c = (a?.configPathDate ?? []).find(
            (x: any) => monthKeyFromDDMY(x?.date) === mk
          );
          if (!c) continue;
          const pc = c?.pathConfig;
          const sig = [(pc?.path_id ?? ''), (pc?.value ?? ''), (c?.value ?? '')].join('|');

          if (sig !== prevSigByArea.get(a?.area)) {
            changedThisMonth = true;
          }
        }

        if (changedThisMonth) {
          basePeriodCounter++; // เปลี่ยนเวอร์ชัน -> เปิด period ใหม่ (1,2,...)

          // อัปเดต sig และ push pathData สำหรับเดือนนี้ (ไม่รวม path ซ้ำใน period เดียวกัน)
          for (const a of (pnmatchData ?? [])) {
            const c = (a?.configPathDate ?? []).find(
              (x: any) => monthKeyFromDDMY(x?.date) === mk
            );
            if (!c) continue;
            const pc = c?.pathConfig;
            const sig = [(pc?.path_id ?? ''), (pc?.value ?? ''), (c?.value ?? '')].join('|');
            prevSigByArea.set(a?.area, sig);

            if (pc && pc?.config_master_path_id) {
              pushPathOnce(basePeriodCounter, pc, makeSlim);
            }
          }
        }
        monthPeriodBase.set(mk, basePeriodCounter);
      }

      // ======= ที่เหลือ (ลูปรายวัน) ไม่แตะ เพราะ "ช่วงแรกแบ่ง period ถูก" อยู่แล้ว =======
      const allDates = new Set<string>();
      for (const row of data ?? []) {
        for (const res of row?.resCalcNew ?? []) {
          for (const c of res?.calcNew ?? []) if (c?.date) allDates.add(c.date);
        }
      }
      const datesAsc = Array.from(allDates).sort(); // 'YYYY-MM-DD'

      // >>> เติมเดือนที่ไม่มีคอนฟิกด้วยค่า base เดิม (carry-forward) <<<
      const monthsFromDates = Array.from(new Set(datesAsc.map(d => d.slice(0, 7)))).sort();
      let carry = 0;
      for (const mk of monthsFromDates) {
        if (monthPeriodBase.has(mk)) {
          carry = monthPeriodBase.get(mk)!;   // เดือนนี้มีคอนฟิก → อัปเดตฐาน
        }
        monthPeriodBase.set(mk, carry);       // ไม่มีคอนฟิก → ใช้ฐานเดิม
      }

      let lastSignature = '';
      let curPeriod = 0;
      let curMonth = '';

      for (const d of datesAsc) {
        const mk = monthKeyFromISO(d);
        const baseForMonth = monthPeriodBase.get(mk)!; // มีแน่หลัง carry-forward

        if (mk !== curMonth) {
          curMonth = mk;
          curPeriod = baseForMonth;
          lastSignature = '';
        }

        const sigParts: number[] = [];
        for (const row of data ?? []) {
          for (const res of row?.resCalcNew ?? []) {
            const cell = (res?.calcNew ?? []).find((x: any) => x?.date === d);
            sigParts.push(getNum(cell));
          }
        }
        const curSig = JSON.stringify(sigParts);

        if (lastSignature && curSig !== lastSignature) {
          curPeriod += 1;
        }
        lastSignature = curSig;

        for (const row of data ?? []) {
          for (const res of row?.resCalcNew ?? []) {
            const arr = res?.calcNew ?? [];
            const idx = arr.findIndex((x: any) => x?.date === d);
            if (idx >= 0) arr[idx] = { ...arr[idx], period: curPeriod };
          }
        }
      }

      return data;
    }


    function assignNestedPeriods(data: any[]) {
      const monthKeyFromISO = (s: string) => (s ? s.slice(0, 7) : '');
      const monthKeyFromDDMY = (s: string) => {
        if (!s) return '';
        const dd = s.slice(0, 2), mm = s.slice(3, 5), yyyy = s.slice(6, 10);
        return `${yyyy}-${mm}`;
      };
      const getNum = (x: any) => {
        const v = x?.cals ?? x?.value ?? 0;
        const n = Number(String(v).replace(/,/g, '').trim());
        return Number.isFinite(n) ? n : 0;
      };

      // ใช้ path_id เป็นหลัก (กันเคสหลาย path อยู่ใต้ master เดียวกัน)
      const getPathKey = (pc: any) =>
        String(pc?.path_id ?? pc?.config_master_path_id ?? '');

      // กันซ้ำรายการ path ต่อ period
      const pushedByPeriod = new Map<number, Set<string>>();
      const pushPathOnce = (period: number, pc: any, makeSlim: (pc: any) => any) => {
        const key = getPathKey(pc);
        if (!key) return;
        let set = pushedByPeriod.get(period);
        if (!set) { set = new Set<string>(); pushedByPeriod.set(period, set); }
        if (set.has(key)) return;
        set.add(key);
        pathData.push({ period, pathConfig: makeSlim(pc) });
      };

      // ทำ slim
      const makeSlim = (pc: any) => {
        const out: any = { ...pc };
        if (Array.isArray(pc?.findExit)) {
          out.findExit = pc.findExit.map((pF: any) => ({
            id: pF?.id,
            config_master_path_id: pF?.config_master_path_id,
            revised_capacity_path_type_id: pF?.revised_capacity_path_type_id,
            source_id: pF?.source_id ?? null,
            area: {
              id: pF?.area?.id,
              name: pF?.area?.name,
              area_nominal_capacity: pF?.area?.area_nominal_capacity,
              zone_id: pF?.area?.zone_id,
              entry_exit_id: pF?.area?.entry_exit_id,
              supply_reference_quality_area: pF?.area?.supply_reference_quality_area,
              color: pF?.area?.color,
            },
          }));
        }
        delete out.config_master_path;
        return out;
      };

      // === base period per month (จาก path version) ===
      const monthPeriodBase = new Map<string, number>();
      const prevSigByArea = new Map<string, string>();
      let basePeriodCounter = 0;

      // รวมเดือนจาก pnmatchData
      const monthSet = new Set<string>();
      for (const a of (pnmatchData ?? [])) {
        for (const c of a?.configPathDate ?? []) {
          const mk = monthKeyFromDDMY(c?.date);
          if (mk) monthSet.add(mk);
        }
      }
      const monthsSorted = Array.from(monthSet).sort(); // 'YYYY-MM'

      // ★★ baseline period 0 จากเดือนแรก (ไม่รวม path ซ้ำ แต่ "นับแยกตาม path_id") ★★
      const firstMonth = monthsSorted[0];
      if (firstMonth) {
        for (const a of (pnmatchData ?? [])) {
          const c = (a?.configPathDate ?? []).find(
            (x: any) => monthKeyFromDDMY(x?.date) === firstMonth
          );
          if (!c) continue;
          const pc = c?.pathConfig;

          const sig = [(pc?.path_id ?? ''), (pc?.value ?? ''), (c?.value ?? '')].join('|');
          prevSigByArea.set(a?.area, sig);

          // เดิมเช็คเฉพาะ config_master_path_id → กรณีมีหลาย path ใต้ master เดียวกันจะหาย
          // ปรับให้ push ได้ถ้าอย่างน้อยมี path_id หรือ config_master_path_id อย่างใดอย่างหนึ่ง
          if (pc && (pc?.path_id != null || pc?.config_master_path_id != null)) {
            pushPathOnce(0, pc, makeSlim);
          }
        }
        monthPeriodBase.set(firstMonth, 0);
      }

      // เดินเดือนถัดไปเพื่อหา basePeriodCounter (เปลี่ยน version)
      for (let i = 1; i < monthsSorted.length; i++) {
        const mk = monthsSorted[i];
        let changedThisMonth = false;

        for (const a of (pnmatchData ?? [])) {
          const c = (a?.configPathDate ?? []).find(
            (x: any) => monthKeyFromDDMY(x?.date) === mk
          );
          if (!c) continue;
          const pc = c?.pathConfig;
          const sig = [(pc?.path_id ?? ''), (pc?.value ?? ''), (c?.value ?? '')].join('|');

          if (sig !== prevSigByArea.get(a?.area)) {
            changedThisMonth = true;
          }
        }

        if (changedThisMonth) {
          basePeriodCounter++;

          for (const a of (pnmatchData ?? [])) {
            const c = (a?.configPathDate ?? []).find(
              (x: any) => monthKeyFromDDMY(x?.date) === mk
            );
            if (!c) continue;
            const pc = c?.pathConfig;
            const sig = [(pc?.path_id ?? ''), (pc?.value ?? ''), (c?.value ?? '')].join('|');
            prevSigByArea.set(a?.area, sig);

            if (pc && (pc?.path_id != null || pc?.config_master_path_id != null)) {
              pushPathOnce(basePeriodCounter, pc, makeSlim);
            }
          }
        }
        monthPeriodBase.set(mk, basePeriodCounter);
      }

      // ===== รวมวันที่จริงทั้งหมด =====
      const allDates = new Set<string>();
      for (const row of data ?? []) {
        for (const res of row?.resCalcNew ?? []) {
          for (const c of res?.calcNew ?? []) if (c?.date) allDates.add(c.date);
        }
      }
      const datesAsc = Array.from(allDates).sort(); // 'YYYY-MM-DD'

      // >>> carry-forward base period ให้ครบทุกเดือนที่มีข้อมูลจริง <<<
      const monthsFromDates = Array.from(new Set(datesAsc.map(d => d.slice(0, 7)))).sort();
      let carry = 0;
      for (const mk of monthsFromDates) {
        if (monthPeriodBase.has(mk)) {
          carry = monthPeriodBase.get(mk)!;
        }
        monthPeriodBase.set(mk, carry);
      }

      // ===== ใส่ period รายวัน =====
      let lastSignature = '';
      let curPeriod = 0;
      let curMonth = '';

      for (const d of datesAsc) {
        const mk = monthKeyFromISO(d);
        const baseForMonth = monthPeriodBase.get(mk)!;

        if (mk !== curMonth) {
          curMonth = mk;
          curPeriod = baseForMonth;
          lastSignature = '';
        }

        const sigParts: number[] = [];
        for (const row of data ?? []) {
          for (const res of row?.resCalcNew ?? []) {
            const cell = (res?.calcNew ?? []).find((x: any) => x?.date === d);
            sigParts.push(getNum(cell));
          }
        }
        const curSig = JSON.stringify(sigParts);

        if (lastSignature && curSig !== lastSignature) {
          curPeriod += 1;
        }
        lastSignature = curSig;

        for (const row of data ?? []) {
          for (const res of row?.resCalcNew ?? []) {
            const arr = res?.calcNew ?? [];
            const idx = arr.findIndex((x: any) => x?.date === d);
            if (idx >= 0) arr[idx] = { ...arr[idx], period: curPeriod };
          }
        }
      }

      return data;
    }




    // path_temp_json

    console.log('path detail G2 process...'); // ช้า 25181.385009765625 ms
    console.time('path detail G2');
    const resultC = assignNestedPeriods(setDataUse);
    console.timeEnd('path detail G2');

    console.log('===:> : ', resultC);

    const nowDate = getTodayNowAdd7().toDate();

    console.log('path detail G3 process...');
    console.time('path detail G3');
    await this.prisma.capacity_detail.updateMany({
      where: {
        contract_code_id: Number(id),
      },
      data: {
        flag_use: false,
      },
    });
    console.timeEnd('path detail G3');

    console.log('path detail G4 process...');
    console.time('path detail G4');
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
    console.timeEnd('path detail G4');

    // console.log('pathData : ', pathData);

    console.log('path detail G5 process...');
    console.time('path detail G5');
    // แบ่งตาม path period
    const batchCapacityDetailPoint = resultC.map(
      ({ resCalcNew, paths, ...newResultC }) => ({
        capacity_detail_id: Number(capacityDetail?.id),
        area_id: Number(newResultC?.area_id),
        create_by: Number(userId),
        // path_temp: JSON.stringify(paths),
        path_temp_json: pathData,
        // path_temp: JSON.stringify(pathData),
        // temp: JSON.stringify(newResultC),
        create_date: nowDate,
        create_date_num: getTodayNowAdd7().unix(),
      }),
    );
    console.timeEnd('path detail G5');

    console.log('path detail G6 process...');
    console.time('path detail G6');
    const savedPoints = await this.prisma.capacity_detail_point.createMany({
      data: batchCapacityDetailPoint,
      skipDuplicates: true, // ป้องกันการ Insert ซ้ำ
    });
    console.timeEnd('path detail G6');

    console.log('path detail G7 process...');
    console.time('path detail G7');
    const savedPoints1 = await this.prisma.capacity_detail_point.findMany({
      where: {
        capacity_detail_id: Number(capacityDetail?.id),
      },
      orderBy: {
        id: 'desc', // ดึง ID ล่าสุดที่ถูก Insert
      },
    });
    console.timeEnd('path detail G7');

    console.log('path detail G8 process...');
    console.time('path detail G8');
    const savedPointMap = new Map(
      savedPoints1.map((sp) => [sp.capacity_detail_id, sp.id]),
    );
    console.timeEnd('path detail G8');

    console.log('path detail G9 process...');
    console.time('path detail G9');
    const pointDate: any = [];
    resultC.forEach(({ resCalcNew }, index) => {
      const savePointId = savedPointMap.get(capacityDetail?.id); // ใช้ ID ที่ได้จาก createMany()

      resCalcNew.forEach(({ calcNew, ...newResCalcNew }) => {
        calcNew.forEach((calc) => {
          pointDate.push({
            capacity_detail_point_id: Number(savePointId),
            area_id: Number(newResCalcNew?.area_id),
            value: calc.value ? String(calc.value) : '0',
            cals: String(calc.cals),
            adjust: calc.adjust ? String(calc.adjust) : '0',
            adjust_type: calc.adjustType ? String(calc.adjustType) : null,
            ck_comparea: calc.ck_comparea,
            period: Number(calc.period),
            area_nominal_capacity: String(newResCalcNew?.area_nominal_capacity),
            date: getTodayNowAdd7(calc.date).toDate(),
            create_date: nowDate,
            create_by: Number(userId),
            create_date_num: getTodayNowAdd7().unix(),
            path_id: Number(calc?.config?.id),
          });
        });
      });
    });
    console.timeEnd('path detail G9');

    console.log('path detail G210 process...');
    console.time('path detail G10');
    if (pointDate.length > 0) {
      await this.prisma.capacity_detail_point_date.createMany({
        data: pointDate,
      });
    }
    console.timeEnd('path detail G10');
  }

  async capacityRequestManagementDownload(id: any) {
    const bookingVersion = await this.prisma.booking_version.findUnique({
      where: { id: Number(id) },
      include: {
        booking_full_json: true,
        booking_row_json: true,
      },
    });
    let newBK: any = null;
    newBK = bookingVersion;
    if (newBK?.['booking_full_json']) {
      newBK['booking_full_json'] = await newBK.booking_full_json.map(
        (e: any) => {
          const data_temp = this.safeParseJSON(e?.['data_temp']);
          return { ...e, data_temp: data_temp };
        },
      );
    }
    if (newBK?.['booking_row_json']) {
      newBK['booking_row_json'] = await newBK.booking_row_json.map((e: any) => {
        const data_temp = this.safeParseJSON(e?.['data_temp']);
        return { ...e, data_temp: data_temp };
      });
    }

    const shipperInfo =
      newBK?.['booking_full_json']?.[0]?.['data_temp']?.['shipperInfo'] || {};

    const ShipperName = Object.keys(shipperInfo)
      .map((key) => {
        return shipperInfo[key]?.['Shipper Name'];
      })
      .find((item) => item !== undefined);
    const typeOfContract: any = Object.keys(shipperInfo)
      .map((key) => {
        return shipperInfo[key]?.['Type of Contract'];
      })
      .find((item) => item !== undefined);
    const ContractCode = Object.keys(shipperInfo)
      .map((key) => {
        return shipperInfo[key]['Contract Code'];
      })
      .find((item) => item !== undefined);

    // headerEntry
    const headerEntryInfo1 =
      newBK?.['booking_full_json']?.[0]?.['data_temp']?.['headerEntry']?.[
      'Capacity Daily Booking (MMBTU/d)'
      ] || {};

    const headerEntryArr1 = Object.keys(headerEntryInfo1)
      .filter((key) => key !== 'key')
      .map((key) => {
        return key;
      })
      .sort((a, b) => {
        return (
          dayjs(a, 'DD/MM/YYYY').toDate().getTime() -
          dayjs(b, 'DD/MM/YYYY').toDate().getTime()
        );
      });
    const headerEntryInfo2 =
      newBK['booking_full_json'][0]['data_temp']['headerEntry'][
      'Maximum Hour Booking (MMBTU/h)'
      ];
    const headerEntryArr2 = Object.keys(headerEntryInfo2)
      .filter((key) => key !== 'key')
      .map((key) => {
        return key;
      })
      .sort((a, b) => {
        return (
          dayjs(a, 'DD/MM/YYYY').toDate().getTime() -
          dayjs(b, 'DD/MM/YYYY').toDate().getTime()
        );
      });
    const headerEntryInfo3 =
      newBK['booking_full_json'][0]['data_temp']['headerEntry'][
      'Capacity Daily Booking (MMscfd)'
      ];
    const headerEntryArr3 = Object.keys(headerEntryInfo3)
      .filter((key) => key !== 'key')
      .map((key) => {
        return key;
      })
      .sort((a, b) => {
        return (
          dayjs(a, 'DD/MM/YYYY').toDate().getTime() -
          dayjs(b, 'DD/MM/YYYY').toDate().getTime()
        );
      });
    const headerEntryInfo4 =
      newBK['booking_full_json'][0]['data_temp']['headerEntry'][
      'Maximum Hour Booking (MMscfh)'
      ];
    const headerEntryArr4 = Object.keys(headerEntryInfo4)
      .filter((key) => key !== 'key')
      .map((key) => {
        return key;
      })
      .sort((a, b) => {
        return (
          dayjs(a, 'DD/MM/YYYY').toDate().getTime() -
          dayjs(b, 'DD/MM/YYYY').toDate().getTime()
        );
      });

    const capacityDailyBookingArrayMMB = [
      'Capacity Daily Booking (MMBTU/d)',
      ...Array(headerEntryArr1.length - 1).fill(''),
    ];
    const maximumHourBookingMMBArray = [
      'Maximum Hour Booking (MMBTU/h)',
      ...Array(headerEntryArr2.length - 1).fill(''),
    ];
    const capacityDailyBookingMMsArray = [
      'Capacity Daily Booking (MMscfd)',
      ...Array(headerEntryArr3.length - 1).fill(''),
    ];
    const maximumHourBookingMMsArray = [
      'Maximum Hour Booking (MMscfh)',
      ...Array(headerEntryArr4.length - 1).fill(''),
    ];

    const headerExitInfo1 =
      newBK['booking_full_json'][0]['data_temp']['headerExit'][
      'Capacity Daily Booking (MMBTU/d)'
      ];
    const headerExitArr1 = Object.keys(headerExitInfo1)
      .filter((key) => key !== 'key')
      .map((key) => {
        return key;
      })
      .sort((a, b) => {
        return (
          dayjs(a, 'DD/MM/YYYY').toDate().getTime() -
          dayjs(b, 'DD/MM/YYYY').toDate().getTime()
        );
      });
    const headerExitInfo2 =
      newBK['booking_full_json'][0]['data_temp']['headerExit'][
      'Capacity Daily Booking (MMBTU/d)'
      ];
    const headerExitArr2 = Object.keys(headerExitInfo2)
      .filter((key) => key !== 'key')
      .map((key) => {
        return key;
      })
      .sort((a, b) => {
        return (
          dayjs(a, 'DD/MM/YYYY').toDate().getTime() -
          dayjs(b, 'DD/MM/YYYY').toDate().getTime()
        );
      });

    const capacityDailyBookingArrayMMBExit = [
      'Capacity Daily Booking (MMBTU/d)',
      ...Array(headerExitArr1.length - 1).fill(''),
    ];
    const maximumHourBookingMMBArrayExit = [
      'Maximum Hour Booking (MMBTU/h)',
      ...Array(headerExitArr2.length - 1).fill(''),
    ];

    const entryValue = newBK['booking_full_json'][0]['data_temp']['entryValue'];
    const newEntry = this.transformDataArrNew(entryValue);
    const exitValue = newBK['booking_full_json'][0]['data_temp']['exitValue'];
    const newExit = this.transformDataArrNew(exitValue);
    const sumEntry = newBK['booking_full_json'][0]['data_temp']['sumEntries'];
    const filteredDataSumEntry = Object.fromEntries(
      Object.entries(sumEntry).filter(([key]) => key !== '0'),
    );
    // สร้างอาร์เรย์ที่ตำแหน่ง 0 เป็น "Sum Entry"
    const maxIndexEntry = Math.max(
      ...Object.keys(filteredDataSumEntry).map(Number),
    ); // หาค่าคีย์สูงสุด
    const arrayResultEntry = Array.from(
      { length: maxIndexEntry + 1 },
      (_, i) => (i === 0 ? 'Sum Entry' : filteredDataSumEntry[i] || ''),
    );

    const sumExit = newBK['booking_full_json'][0]['data_temp']['sumExits'];
    const filteredDataSumExit = Object.fromEntries(
      Object.entries(sumExit).filter(([key]) => key !== '0'),
    );
    // สร้างอาร์เรย์ที่ตำแหน่ง 0 เป็น "Sum Exit"
    const maxIndexExit = Math.max(
      ...Object.keys(filteredDataSumExit).map(Number),
    ); // หาค่าคีย์สูงสุด
    const arrayResultExit = Array.from({ length: maxIndexExit + 1 }, (_, i) =>
      i === 0 ? 'Sum Exit' : filteredDataSumExit[i] || '',
    );

    const data = [
      [], // Row 0
      ['Shipper Name', 'Type of Contract', 'Contract Code'], // Row 1
      [ShipperName, typeOfContract, ContractCode], // Row 2
      [], // Row 3 (empty row)
      [
        'Entry',
        null,
        null,
        null,
        null,
        'Period',
        '',
        ...capacityDailyBookingArrayMMB,
        ...maximumHourBookingMMBArray,
        ...capacityDailyBookingMMsArray,
        ...maximumHourBookingMMsArray,
      ],
      [
        '',
        'Pressure Range',
        '',
        'Temperature Range',
        '',
        'From',
        'To',
        ...headerEntryArr1,
        ...headerEntryArr2,
        ...headerEntryArr3,
        ...headerEntryArr4,
      ],
      ['', 'Min', 'Max', 'Min', 'Max', '', ''],
      ...newEntry,
      arrayResultEntry,
      [],
      [
        'Exit',
        null,
        null,
        null,
        null,
        'Period',
        '',
        ...capacityDailyBookingArrayMMBExit,
        ...maximumHourBookingMMBArrayExit,
      ],
      [
        '',
        'Pressure Range',
        '',
        'Temperature Range',
        '',
        'From',
        'To',
        ...headerExitArr1,
        ...headerExitArr2,
      ],
      ['', 'Min', 'Max', 'Min', 'Max', '', ''],
      ...newExit,
      arrayResultExit,
    ];

    // console.log('data : ', data);
    // สร้าง workbook และ worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(data); // สร้าง sheet จาก array ของ array
    const workbook = XLSX.utils.book_new(); // สร้าง workbook ใหม่
    XLSX.utils.book_append_sheet(workbook, worksheet, typeOfContract); // เพิ่ม sheet ลงใน workbook

    // Merge cells สำหรับ header ที่มีการรวม (merge ข้ามคอลัมน์และแถว)
    worksheet['!merges'] = [
      // Merge คอลัมน์สำหรับ "Pressure Range" และ "Temperature Range"
      { s: { r: 5, c: 1 }, e: { r: 5, c: 2 } }, // Merge 'Pressure Range' header (c:6 to c:7)
      { s: { r: 5, c: 3 }, e: { r: 5, c: 4 } }, // Merge 'Temperature Range' header (c:8 to c:9)

      // Merge แถวสำหรับ "Zone" ที่รวมหลายแถว
      { s: { r: 4, c: 0 }, e: { r: 6, c: 0 } }, // Merge 'Entry' row header (r:4 to r:5)

      // period
      { s: { r: 4, c: 5 }, e: { r: 4, c: 6 } },
      // form to
      { s: { r: 5, c: 5 }, e: { r: 6, c: 5 } },
      { s: { r: 5, c: 6 }, e: { r: 6, c: 6 } },

      // Entry Merge dynamic สำหรับ capacityDailyBookingArrayMMB
      { s: { r: 4, c: 7 }, e: { r: 4, c: 7 + headerEntryArr1.length - 1 } },

      // Entry Merge dynamic สำหรับ maximumHourBookingMMBArray
      {
        s: { r: 4, c: 7 + headerEntryArr1.length },
        e: { r: 4, c: 7 + headerEntryArr1.length * 2 - 1 },
      },

      // Entry Merge dynamic สำหรับ capacityDailyBookingMMsArray
      {
        s: { r: 4, c: 7 + headerEntryArr1.length * 2 },
        e: { r: 4, c: 7 + headerEntryArr1.length * 3 - 1 },
      },

      // Entry Merge dynamic สำหรับ maximumHourBookingMMsArray
      {
        s: { r: 4, c: 7 + headerEntryArr1.length * 3 },
        e: { r: 4, c: 7 + headerEntryArr1.length * 4 - 1 },
      },

      //------
      {
        s: { r: 11 + (newEntry.length - 1), c: 1 },
        e: { r: 11 + (newEntry.length - 1), c: 2 },
      }, // Merge 'Pressure Range' header (c:6 to c:7)
      {
        s: { r: 11 + (newEntry.length - 1), c: 3 },
        e: { r: 11 + (newEntry.length - 1), c: 4 },
      }, // Merge 'Temperature Range' header (c:8 to c:9)

      {
        s: { r: 10 + (newEntry.length - 1), c: 0 },
        e: { r: 12 + (newEntry.length - 1), c: 0 },
      }, // Merge 'Entry' row header (r:4 to r:5)

      {
        s: { r: 10 + (newEntry.length - 1), c: 5 },
        e: { r: 10 + (newEntry.length - 1), c: 6 },
      },
      // // form to
      {
        s: { r: 11 + (newEntry.length - 1), c: 5 },
        e: { r: 12 + (newEntry.length - 1), c: 5 },
      },
      {
        s: { r: 11 + (newEntry.length - 1), c: 6 },
        e: { r: 12 + (newEntry.length - 1), c: 6 },
      },
      // Entry Merge dynamic สำหรับ capacityDailyBookingArrayMMBExit
      {
        s: { r: 10 + (newEntry.length - 1), c: 7 },
        e: {
          r: 10 + (newEntry.length - 1),
          c: 7 + headerEntryArr1.length - 1,
        },
      },
      // Entry Merge dynamic สำหรับ maximumHourBookingMMBArrayExit
      {
        s: { r: 10 + (newEntry.length - 1), c: 7 + headerEntryArr1.length },
        e: {
          r: 10 + (newEntry.length - 1),
          c: 7 + headerEntryArr1.length * 2 - 1,
        },
      },
    ];

    // console.log('newEntry.length : ', newEntry.length);

    // Merge cells สำหรับ resultDate กับ row อันล่าง
    const resultDateCount = headerEntryArr1.length;

    for (let i = 0; i < resultDateCount * 4; i++) {
      const startColumnIndex = 7 + i;

      worksheet['!merges'].push({
        s: { r: 5, c: startColumnIndex }, // จุดเริ่มต้นการ merge จากแถวที่ 5
        e: { r: 6, c: startColumnIndex }, // จุดสิ้นสุดการ merge ในแถวที่ 6
      });
    }
    for (let i = 0; i < resultDateCount * 2; i++) {
      const startColumnIndex = 7 + i;

      worksheet['!merges'].push({
        s: { r: 11 + (newEntry.length - 1), c: startColumnIndex }, // จุดเริ่มต้นการ merge จากแถวที่ 11
        e: { r: 12 + (newEntry.length - 1), c: startColumnIndex }, // จุดสิ้นสุดการ merge ในแถวที่ 12
      });
    }

    Object.keys(worksheet).forEach((cell) => {
      const rowNumber = parseInt(cell.replace(/[^0-9]/g, '')); // ดึงเลขแถวออกมา
      const columnLetter = cell.replace(/[0-9]/g, '');

      if (
        worksheet[cell] &&
        typeof worksheet[cell] === 'object' &&
        cell[0] !== '!'
      ) {
        worksheet[cell].z = '@'; // ใช้รูปแบบ '@' เพื่อระบุว่าเป็น Text
        worksheet[cell].s = worksheet[cell].s || {}; // สร้าง object s ถ้ายังไม่มี
        // ถ้าเป็นแถวที่ 3, 8, หรือ 14 จะไม่ใช้ตัวหนา
        if (rowNumber === 3 || rowNumber === 8 || rowNumber === 14) {
          worksheet[cell].s = {
            border: {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' },
            },
            alignment: {
              horizontal: 'center', // จัดกลางแนวนอน
              vertical: 'center', // จัดกลางแนวตั้ง
              wrapText: true,
            },
          };
        } else {
          // สำหรับแถวอื่น ๆ ใช้สไตล์ตัวหนา
          worksheet[cell].s = {
            border: {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' },
            },
            alignment: {
              horizontal: 'center', // จัดกลางแนวนอน
              vertical: 'center', // จัดกลางแนวตั้ง
              wrapText: true,
            },
            font: {
              bold: true, // ทำให้ข้อความในเซลล์เป็นตัวหนา
            },
          };
        }

        if (
          rowNumber === 6 &&
          columnLetter.charCodeAt(0) >= 'B'.charCodeAt(0) &&
          columnLetter.charCodeAt(0) <= 'E'.charCodeAt(0)
        ) {
          worksheet[cell].s.font = {
            color: { rgb: 'FF0000' },
            bold: true,
          };
        }

        if (rowNumber === 6 && columnLetter >= 'AA' && columnLetter <= 'AG') {
          worksheet[cell].s.font = {
            color: { rgb: 'FF0000' }, // เปลี่ยนสีข้อความเป็นสีแดง
            bold: true,
          };
        }

        if (
          rowNumber === 7 &&
          columnLetter.charCodeAt(0) >= 'B'.charCodeAt(0) &&
          columnLetter.charCodeAt(0) <= 'E'.charCodeAt(0)
        ) {
          worksheet[cell].s.font = {
            color: { rgb: 'FF0000' }, // เปลี่ยนสีข้อความเป็นสีแดง
            bold: true,
          };
        }

        if (rowNumber === 7 && columnLetter >= 'AA' && columnLetter <= 'AG') {
          worksheet[cell].s.font = {
            color: { rgb: 'FF0000' },
            bold: true,
          };
        }

        if (
          rowNumber === 12 &&
          columnLetter.charCodeAt(0) >= 'B'.charCodeAt(0) &&
          columnLetter.charCodeAt(0) <= 'E'.charCodeAt(0)
        ) {
          worksheet[cell].s.font = {
            color: { rgb: 'FF0000' },
            bold: true,
          };
        }

        if (
          rowNumber === 13 &&
          columnLetter.charCodeAt(0) >= 'B'.charCodeAt(0) &&
          columnLetter.charCodeAt(0) <= 'E'.charCodeAt(0)
        ) {
          worksheet[cell].s.font = {
            color: { rgb: 'FF0000' },
            bold: true,
          };
        }

        // แปลงค่า worksheet[cell].v เป็นสตริงในรูปแบบ 'DD/MM/YYYY'
        const cellDate = worksheet[cell].v ? worksheet[cell].v.toString() : '';
        if (
          (rowNumber === 6 || rowNumber === 12) &&
          headerEntryArr1.includes(cellDate)
        ) {
          worksheet[cell].s = worksheet[cell].s || {};
          worksheet[cell].s = {
            fill: {
              patternType: 'solid',
              fgColor: { rgb: '92D04F' },
            },
            font: {
              color: { rgb: 'FF0000' },
              bold: true,
            },
            border: {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' },
            },
            alignment: {
              horizontal: 'center',
              vertical: 'center',
              wrapText: true,
            },
          };
        }
      }
    });

    const excelBuffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    });

    const times = getTodayNowAdd7().format('YYYYMMDDHHmmss');

    return {
      excelBuffer,
      typeOfContract: `${ContractCode}_${bookingVersion?.version}_${times}`,
    };
  }
}
